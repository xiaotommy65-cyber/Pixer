import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { OCCLUSION_GRID_MAX } from '../gpu/GpuTypes.ts';
import {
  computeSymmetricFovInto,
  createSymmetricFovScratch,
  hasGridLineOfSight,
} from '../math/Visibility2D.ts';
import {
  createPathfinderWorkspace,
  findAStarNextCell,
  findAStarPathInto,
} from '../sim/GridPathfinder.ts';
import type {
  InputState,
  LightDesc,
  OcclusionGridDesc,
  SimEvent,
  TileDesc,
} from '../types/WorldTypes.ts';
import { EcsCinematicDirector, type EcsCutsceneShotDef } from './EcsCinematicDirector.ts';
import type { EcsProjectV2 } from './EcsProjectSchema.ts';
import {
  getCastleTileDef,
  isRoomCellHazard,
  isRoomCellSolid,
  type EcsMapInteractionRule,
  type EcsMapPortalDef,
  type EcsMapRoomDef,
  type EcsTopDownAiProfile,
} from './EcsTilemapTypes.ts';
import type { EcsWorld } from './EcsWorld.ts';

export interface WorldMapStepCallbacks {
  onScoreDelta: (delta: number) => void;
  onStatusChange: (status: 'playing' | 'won' | 'lost') => void;
  onPopup: (text: string, x: number, y: number, color: string) => void;
  onRoomBanner: (banner: string) => void;
  onMeleeSwing?: (x: number, y: number, dirX: number, dirY: number, color: string, heroHandle: number) => void;
  onHitImpact?: (x: number, y: number, dirX: number, dirY: number, killed: boolean, isBoss: boolean, targetHandle: number) => void;
  onHeroHurt?: (x: number, y: number, heroHandle: number) => void;
  onDash?: (x: number, y: number, dirX: number, dirY: number, heroHandle: number) => void;
  onFootstep?: (x: number, y: number) => void;
  onInteract?: (x: number, y: number, color: string) => void;
  onBossPhase?: (x: number, y: number) => void;
}

/**
 * Pure, DOM-free, Zero-GC Generic Multi-Room HD-2D Tilemap & Top-Down Adventure Engine Controller.
 *
 * 100% Data-Driven — contains ZERO game-specific sprites, entity IDs, global keys, or story strings.
 * All tile geometry (`renderH`, `extrudeH`, `ambientLight`, `unlockGlobal`), hero animation/melee
 * config (`heroConfig`), interactive prop triggers (`interactions`), and enemy/boss AI (`aiProfiles`)
 * are read purely from `project.worldMap`.
 */
export class EcsWorldMapController {
  private project: EcsProjectV2;
  private activeRoomId = '';
  private activeRoom: EcsMapRoomDef | null = null;
  public readonly director = new EcsCinematicDirector();

  // Pre-allocated tile snapshot pool & 2D wall shadow occlusion grid (Zero-GC per frame)
  private readonly tilePool: TileDesc[] = [];
  public readonly outTiles: TileDesc[] = [];
  private readonly occlusionGrid = new Uint8Array(OCCLUSION_GRID_MAX * OCCLUSION_GRID_MAX);
  private occlusionVersion = 0;
  private lastUnlockMask = -1;
  private readonly occlusionDesc: OcclusionGridDesc = {
    cols: 0,
    rows: 0,
    originX: 0,
    originY: 0,
    tileSize: 32,
    data: this.occlusionGrid,
    version: 0,
    shadowStrength: 0.85,
    shadowSoftness: 0.36,
  };

  // Camera state (world top-left in logical pixels)
  public cameraX = 0;
  public cameraY = 0;
  private editorCamOverride = false;
  private editorCamX = 0;
  private editorCamY = 0;

  // Top-down hero combat & exploration timers
  private facingX = 0;
  private facingY = -1;
  private dashTimer = 0;
  private dashCooldown = 0;
  private dashDirX = 0;
  private dashDirY = -1;
  private slashCooldown = 0;
  private slashActiveTimer = 0;
  private slashX = 0;
  private slashY = 0;
  private heroInvulnTimer = 0;
  private portalCooldown = 0;
  private walkAnimAccum = 0;
  private footstepTimer = 0;

  // Generic boss tracking (driven by any entity whose tag has `aiProfiles[tag].isBoss === true`)
  private bossName = '';
  private bossMaxHp = 0;
  private bossHp = 0;
  private bossPhase = 1;
  private readonly aiTimers = new Map<string, number>();

  // Persisted per-entity completion state across room transitions (one-shot props / defeated foes)
  private readonly clearedEntityIds = new Set<string>();
  private heroHpCarry = -1;
  private heroMaxHpCarry = 10;

  // Room banner timer
  private roomBannerText = '';
  private roomBannerTimer = 0;

  // Previous button edges
  private prevAction = false;
  private prevJump = false;

  private readonly scratchPos: [number, number] = [0, 0];
  private readonly pathWorkspace = createPathfinderWorkspace(OCCLUSION_GRID_MAX * OCCLUSION_GRID_MAX);
  private readonly fovScratch = createSymmetricFovScratch(512);
  private currentGlobalsRef: ReadonlyMap<string, number> | null = null;
  private readonly isCellWalkablePredicate = (c: number, r: number): boolean => {
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm || !this.currentGlobalsRef) return false;
    return !isRoomCellSolid(room, c, r, this.currentGlobalsRef, wm.tileDefs);
  };
  private readonly isCellOpaquePredicate = (c: number, r: number): boolean => {
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm || !this.currentGlobalsRef) return true;
    return isRoomCellSolid(room, c, r, this.currentGlobalsRef, wm.tileDefs);
  };

  constructor(project: EcsProjectV2) {
    this.project = project;
  }

  public hasWorldMap(): boolean {
    return Boolean(this.project.worldMap && this.project.worldMap.rooms.length > 0);
  }

  public getActiveRoom(): EcsMapRoomDef | null {
    return this.activeRoom;
  }

  public getActiveRoomId(): string {
    return this.activeRoomId;
  }

  /**
   * Zero-GC symmetric integer-rational grid line-of-sight check across the active room.
   */
  public hasRoomLineOfSight(
    c0: number,
    r0: number,
    c1: number,
    r1: number,
    globals: ReadonlyMap<string, number>,
  ): boolean {
    if (!this.activeRoom) return false;
    this.currentGlobalsRef = globals;
    return hasGridLineOfSight(c0, r0, c1, r1, this.isCellOpaquePredicate);
  }

  /**
   * Zero-GC Binary Min-Heap A* pathfinder across the active room, writing `[startCell, ..., goalCell]`
   * (`row * cols + col`) into `outCells` and returning the path length (`0` if unreachable).
   */
  public findRoomPathCells(
    startCol: number,
    startRow: number,
    goalCol: number,
    goalRow: number,
    globals: ReadonlyMap<string, number>,
    outCells: Int32Array | Uint16Array,
  ): number {
    const room = this.activeRoom;
    if (!room) return 0;
    this.currentGlobalsRef = globals;
    return findAStarPathInto(
      room.cols,
      room.rows,
      startCol,
      startRow,
      goalCol,
      goalRow,
      this.isCellWalkablePredicate,
      outCells,
      undefined,
      undefined,
      1,
      this.pathWorkspace,
    );
  }

  /**
   * Zero-GC Euclidean Symmetric Shadowcasting FOV across the active room, writing `1` (visible) or `0` (hidden)
   * into `outMask` and returning the count of visible grid cells.
   */
  public computeRoomFovMask(
    originCol: number,
    originRow: number,
    radius: number,
    globals: ReadonlyMap<string, number>,
    outMask: Uint8Array,
  ): number {
    const room = this.activeRoom;
    if (!room) return 0;
    this.currentGlobalsRef = globals;
    return computeSymmetricFovInto(
      room.cols,
      room.rows,
      originCol,
      originRow,
      radius,
      this.isCellOpaquePredicate,
      outMask,
      this.fovScratch,
    );
  }

  public getRoomBanner(): string {
    return this.roomBannerTimer > 0 ? this.roomBannerText : '';
  }

  public getBossInfo(): { name: string; hp: number; maxHp: number } {
    return { name: this.bossName, hp: this.bossHp, maxHp: this.bossMaxHp };
  }

  public getHeroHp(): { hp: number; maxHp: number } {
    return { hp: Math.max(0, this.heroHpCarry), maxHp: this.heroMaxHpCarry };
  }

  public getSlashVisual(): {
    active: boolean;
    sprite: SpriteId | null;
    color: string;
    x: number;
    y: number;
    rot: number;
    alpha: number;
  } {
    const hc = this.project.worldMap?.heroConfig;
    return {
      active: this.slashActiveTimer > 0 && Boolean(hc?.slashSprite),
      sprite: hc?.slashSprite ?? null,
      color: hc?.slashColor ?? '#fef08a',
      x: this.slashX,
      y: this.slashY,
      rot: Math.atan2(this.facingY, this.facingX),
      alpha: Math.min(1, this.slashActiveTimer / 0.14),
    };
  }

  public setEditorCamera(x: number, y: number): void {
    this.editorCamOverride = true;
    this.editorCamX = x;
    this.editorCamY = y;
    this.cameraX = x;
    this.cameraY = y;
  }

  public clearEditorCamera(): void {
    this.editorCamOverride = false;
  }

  public isEditorCameraOverride(): boolean {
    return this.editorCamOverride;
  }

  public getOcclusionGrid(shadowStrength = 0.85, shadowSoftness = 0.36): OcclusionGridDesc | undefined {
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm) return undefined;
    this.occlusionDesc.cols = Math.min(OCCLUSION_GRID_MAX, room.cols);
    this.occlusionDesc.rows = Math.min(OCCLUSION_GRID_MAX, room.rows);
    this.occlusionDesc.originX = 0;
    this.occlusionDesc.originY = 0;
    this.occlusionDesc.tileSize = wm.tileSize;
    this.occlusionDesc.version = this.occlusionVersion;
    this.occlusionDesc.shadowStrength = Math.max(0, Math.min(1, shadowStrength));
    this.occlusionDesc.shadowSoftness = Math.max(0, Math.min(1, shadowSoftness));
    return this.occlusionDesc;
  }

  public reloadProject(
    project: EcsProjectV2,
    world: EcsWorld,
    vpW: number,
    vpH: number,
    preserveRoom = false,
  ): void {
    this.project = project;
    const wm = project.worldMap;
    if (!wm || wm.rooms.length === 0) {
      this.activeRoom = null;
      this.activeRoomId = '';
      this.outTiles.length = 0;
      this.cameraX = 0;
      this.cameraY = 0;
      return;
    }
    const desiredId =
      preserveRoom && wm.rooms.some((r) => r.id === this.activeRoomId)
        ? this.activeRoomId
        : wm.startRoomId;
    this.reset(world, vpW, vpH, desiredId);
  }

  public reset(world: EcsWorld, vpW: number, vpH: number, roomIdOverride?: string): void {
    this.clearedEntityIds.clear();
    this.aiTimers.clear();
    this.director.reset(true);
    this.heroHpCarry = -1;
    this.heroMaxHpCarry = 10;
    this.facingX = 0;
    this.facingY = -1;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.slashCooldown = 0;
    this.slashActiveTimer = 0;
    this.heroInvulnTimer = 0;
    this.portalCooldown = 0.25;
    this.footstepTimer = 0;
    this.bossName = '';
    this.bossPhase = 1;
    this.bossHp = 0;
    this.bossMaxHp = 0;
    this.prevAction = false;
    this.prevJump = false;

    const wm = this.project.worldMap;
    if (!wm || wm.rooms.length === 0) {
      this.activeRoom = null;
      this.activeRoomId = '';
      return;
    }

    const startId =
      roomIdOverride && wm.rooms.some((r) => r.id === roomIdOverride)
        ? roomIdOverride
        : wm.startRoomId;
    this.loadRoomIntoWorld(world, startId, vpW, vpH, undefined, undefined, false);
  }

  public playCutsceneById(
    cutsceneId: string,
    onShotStart?: (shot: EcsCutsceneShotDef) => void,
  ): boolean {
    const cs = this.project.cutscenes?.find((c) => c.id === cutsceneId);
    if (!cs) return false;
    return this.director.startCutscene(cs, this.cameraX, this.cameraY, this.director.cameraZoom, onShotStart);
  }

  public switchRoomForEditor(world: EcsWorld, roomId: string, vpW: number, vpH: number): boolean {
    const wm = this.project.worldMap;
    if (!wm) return false;
    if (!wm.rooms.some((r) => r.id === roomId)) return false;
    this.loadRoomIntoWorld(world, roomId, vpW, vpH, undefined, undefined, true);
    return true;
  }

  private findInteractionRule(tag: string): EcsMapInteractionRule | undefined {
    const rules = this.project.worldMap?.interactions;
    if (!rules) return undefined;
    for (let i = 0; i < rules.length; i++) {
      if (rules[i].tag === tag) return rules[i];
    }
    return undefined;
  }

  private findAiProfile(tag: string): EcsTopDownAiProfile | undefined {
    return this.project.worldMap?.aiProfiles?.[tag];
  }

  private loadRoomIntoWorld(
    world: EcsWorld,
    roomId: string,
    vpW: number,
    vpH: number,
    spawnX?: number,
    spawnY?: number,
    preserveGlobals = true,
  ): void {
    const wm = this.project.worldMap;
    if (!wm) return;
    const room = wm.rooms.find((r) => r.id === roomId) ?? wm.rooms[0];
    if (!room) return;

    const savedGlobals: [string, number][] = [];
    if (preserveGlobals) {
      for (const [k, v] of world.globals.entries()) {
        savedGlobals.push([k, v]);
      }
    }

    this.activeRoom = room;
    this.activeRoomId = room.id;
    this.bossName = '';
    this.bossHp = 0;
    this.bossMaxHp = 0;
    this.bossPhase = 1;
    this.aiTimers.clear();

    world.core.clear();
    world.globals.clear();
    world.paths.clear();
    world.animDefs.clear();
    world.prefabs.clear();

    for (const [k, v] of Object.entries(this.project.globals)) {
      world.globals.set(k, v);
    }
    if (preserveGlobals) {
      for (let i = 0; i < savedGlobals.length; i++) {
        world.globals.set(savedGlobals[i][0], savedGlobals[i][1]);
      }
    }
    for (const [k, pts] of Object.entries(this.project.paths)) {
      world.paths.set(k, pts);
    }
    for (let i = 0; i < this.project.animations.length; i++) {
      world.animDefs.set(this.project.animations[i].id, this.project.animations[i]);
    }
    for (const [k, pref] of Object.entries(this.project.prefabs)) {
      world.prefabs.set(k, pref);
    }

    const core = world.core;
    const c = core.components;
    let heroFoundX = spawnX ?? room.cols * wm.tileSize * 0.5;
    let heroFoundY = spawnY ?? (room.rows - 3) * wm.tileSize;

    for (let i = 0; i < this.project.entities.length; i++) {
      const init = this.project.entities[i];
      const isHeroInit = init.id === 'hero' || init.components.tag === 'hero';
      if (!isHeroInit && init.roomId && init.roomId !== room.id) continue;
      if (!isHeroInit && !init.roomId && room.id !== wm.startRoomId) continue;

      const tagGuess =
        init.components.tag ?? (init.prefabId ? this.project.prefabs[init.prefabId]?.components.tag : '') ?? '';
      const isCleared = this.clearedEntityIds.has(init.id);
      const aiProfile = this.findAiProfile(tagGuess);
      const interactRule = this.findInteractionRule(tagGuess);

      // Skip already defeated enemies or destroyed one-shot pickups
      if (isCleared && (aiProfile || interactRule?.destroyOnUse)) {
        continue;
      }

      const h = world.spawnEntityInit(init);
      const tr = core.getComponent(h, c.Transform2D);
      const mat = core.getComponent(h, c.Material);
      const hp = core.getComponent(h, c.Health);

      if (isHeroInit && tr) {
        if (spawnX !== undefined && spawnY !== undefined) {
          tr.x = spawnX;
          tr.y = spawnY;
          tr.prevX = spawnX;
          tr.prevY = spawnY;
        }
        heroFoundX = tr.x + tr.w * 0.5;
        heroFoundY = tr.y + tr.h * 0.5;
        if (hp) {
          if (this.heroHpCarry > 0) {
            hp.hp = Math.min(hp.maxHp, this.heroHpCarry);
          } else {
            this.heroHpCarry = hp.hp;
            this.heroMaxHpCarry = hp.maxHp;
          }
        }
      }

      // Restore swapped sprite for previously triggered persistent props (chests/switches)
      if (isCleared && mat && interactRule?.swapSprite) {
        mat.spriteId = interactRule.swapSprite;
      }

      // Track active boss entity dynamically using its real project entity name
      if (aiProfile?.isBoss && hp) {
        this.bossName = init.name || 'BOSS';
        this.bossHp = hp.hp;
        this.bossMaxHp = hp.maxHp;
        this.bossPhase = 1;
        this.aiTimers.set(init.id, aiProfile.projectileInterval ?? 1.6);
      }
    }

    if (!this.editorCamOverride) {
      this.snapCameraTo(heroFoundX, heroFoundY, vpW, vpH);
    } else {
      this.clampCamera(vpW, vpH);
    }
    this.director.cameraX = this.cameraX;
    this.director.cameraY = this.cameraY;

    this.roomBannerText = room.name;
    this.roomBannerTimer = 2.6;
    this.rebuildTiles(world.globals);

    if (this.project.cutscenes) {
      for (let i = 0; i < this.project.cutscenes.length; i++) {
        const cs = this.project.cutscenes[i];
        if (
          cs.trigger === 'on_room_enter' &&
          cs.roomId === room.id &&
          !this.director.hasCompletedCutscene(cs.id)
        ) {
          this.director.startCutscene(cs, this.cameraX, this.cameraY, this.director.cameraZoom);
          break;
        }
      }
    }
  }

  private acquireTile(idx: number): TileDesc {
    let slot = this.tilePool[idx];
    if (!slot) {
      slot = { sprite: 'solid', x: 0, y: 0, w: 32, h: 32 };
      this.tilePool[idx] = slot;
    }
    return slot;
  }

  /**
   * Rebuilds the pooled `TileDesc[]` array for the active room (ground + decor + HD-2D extruded walls).
   */
  public rebuildTiles(globals: ReadonlyMap<string, number>): void {
    this.outTiles.length = 0;
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm) return;

    let count = 0;
    const ts = wm.tileSize;
    const cols = room.cols;
    const rows = room.rows;
    const defaultExtrude = room.wallExtrudeH ?? 26;
    const customDefs = wm.tileDefs;

    // 1. Ground Layer
    for (let r = 0; r < rows; r++) {
      const wy = r * ts;
      for (let c = 0; c < cols; c++) {
        const tid = room.ground[r * cols + c] ?? 0;
        if (tid <= 0) continue;
        const def = getCastleTileDef(tid, customDefs);
        if (!def) continue;
        const slot = this.acquireTile(count++);
        slot.sprite = def.sprite;
        slot.x = c * ts;
        slot.y = wy;
        slot.w = ts;
        slot.h = ts;
        slot.alpha = 1;
        slot.tint = def.tint ?? '#ffffff';
        slot.extrudeH = 0;
        slot.elevationZ = 0;
        slot.wallMaterial = undefined;
        slot.autoMask = 0;
        slot.sortY = -1000;
        slot.castShadow = false;
        this.outTiles.push(slot);
      }
    }

    // 2. Decor Layer (reads data-driven `def.renderH` for tall 48px props)
    for (let r = 0; r < rows; r++) {
      const wy = r * ts;
      for (let c = 0; c < cols; c++) {
        const tid = room.decor[r * cols + c] ?? 0;
        if (tid <= 0) continue;
        const def = getCastleTileDef(tid, customDefs);
        if (!def) continue;
        const rh = def.renderH ?? ts;
        const isTall = rh > ts;
        const slot = this.acquireTile(count++);
        slot.sprite = def.sprite;
        slot.x = c * ts;
        slot.y = isTall ? wy - (rh - ts) : wy;
        slot.w = ts;
        slot.h = rh;
        slot.alpha = 1;
        slot.tint = def.tint ?? '#ffffff';
        slot.extrudeH = 0;
        slot.elevationZ = isTall ? 0.5 : 0;
        slot.wallMaterial = undefined;
        slot.autoMask = 0;
        slot.sortY = isTall ? wy + ts + 2 : -900;
        slot.castShadow = isTall;
        this.outTiles.push(slot);
      }
    }

    // Helper: checks whether a room cell holds an extruded solid wall (for 4-bit N/E/S/W culling)
    const isExtrudedWallCell = (cc: number, rr: number): boolean => {
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return false;
      const nTid = room.wall[rr * cols + cc] ?? 0;
      if (nTid <= 0) return false;
      const nDef = getCastleTileDef(nTid, customDefs);
      if (!nDef) return false;
      if (nDef.unlockGlobal && (globals.get(nDef.unlockGlobal) ?? 0) >= 1) return false;
      return (nDef.extrudeH ?? defaultExtrude) > 4;
    };

    // 3. Wall Layer (HD-2D extruded walls & dynamic global-gated doors)
    for (let r = 0; r < rows; r++) {
      const wy = r * ts;
      for (let c = 0; c < cols; c++) {
        const tid = room.wall[r * cols + c] ?? 0;
        if (tid <= 0) continue;
        const def = getCastleTileDef(tid, customDefs);
        if (!def) continue;
        const isUnlocked = def.unlockGlobal ? (globals.get(def.unlockGlobal) ?? 0) >= 1 : false;
        const sprite = isUnlocked && def.unlockedSprite ? def.unlockedSprite : def.sprite;
        let mask = 0;
        if (!isUnlocked) {
          if (isExtrudedWallCell(c, r - 1)) mask |= 1; // North
          if (isExtrudedWallCell(c + 1, r)) mask |= 2; // East
          if (isExtrudedWallCell(c, r + 1)) mask |= 4; // South
          if (isExtrudedWallCell(c - 1, r)) mask |= 8; // West
        }
        const slot = this.acquireTile(count++);
        slot.sprite = sprite;
        slot.x = c * ts;
        slot.y = wy;
        slot.w = ts;
        slot.h = ts;
        slot.alpha = 1;
        slot.tint = def.tint ?? '#ffffff';
        slot.extrudeH = isUnlocked ? 4 : (def.extrudeH ?? defaultExtrude);
        slot.elevationZ = 0;
        slot.wallMaterial = def.wallMaterial ?? 'stone';
        slot.autoMask = mask;
        slot.sortY = wy + ts;
        slot.castShadow = !isUnlocked;
        this.outTiles.push(slot);
      }
    }

    // 4. Rebuild GPU 2D Wall Shadow Occlusion Grid (64x64 R8, only uploaded on version bump)
    this.occlusionGrid.fill(0);
    const maxR = Math.min(OCCLUSION_GRID_MAX, rows);
    const maxC = Math.min(OCCLUSION_GRID_MAX, cols);
    for (let r = 0; r < maxR; r++) {
      const rowOff = r * OCCLUSION_GRID_MAX;
      for (let c = 0; c < maxC; c++) {
        if (isRoomCellSolid(room, c, r, globals, customDefs)) {
          this.occlusionGrid[rowOff + c] = 255;
        }
      }
    }
    this.occlusionVersion++;
    this.lastUnlockMask = this.computeUnlockMask(globals);
  }

  private computeUnlockMask(globals: ReadonlyMap<string, number>): number {
    const wm = this.project.worldMap;
    if (!wm) return 0;
    let mask = 0;
    let bit = 0;
    if (wm.tileDefs) {
      for (let i = 0; i < wm.tileDefs.length && bit < 31; i++) {
        const key = wm.tileDefs[i].unlockGlobal;
        if (!key) continue;
        if ((globals.get(key) ?? 0) >= 1) mask |= 1 << bit;
        bit++;
      }
    }
    for (let i = 0; i < wm.portals.length && bit < 31; i++) {
      const key = wm.portals[i].requiresGlobal;
      if (!key) continue;
      if ((globals.get(key) ?? 0) >= 1) mask |= 1 << bit;
      bit++;
    }
    return mask;
  }

  private clampCamera(vpW: number, vpH: number): void {
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm) return;
    const worldW = room.cols * wm.tileSize;
    const worldH = room.rows * wm.tileSize;
    const maxX = Math.max(0, worldW - vpW);
    const maxY = Math.max(0, worldH - vpH);
    this.cameraX = Math.max(0, Math.min(maxX, this.cameraX));
    this.cameraY = Math.max(0, Math.min(maxY, this.cameraY));
  }

  private snapCameraTo(targetX: number, targetY: number, vpW: number, vpH: number): void {
    this.cameraX = targetX - vpW * 0.5;
    this.cameraY = targetY - vpH * 0.5;
    this.clampCamera(vpW, vpH);
  }

  /**
   * Resolves AABB tilemap + solid prop collisions cleanly with per-axis wall sliding.
   */
  private moveWithTileCollision(
    x: number,
    y: number,
    w: number,
    h: number,
    dx: number,
    dy: number,
    world: EcsWorld,
    outPos: [number, number],
  ): void {
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm) {
      outPos[0] = x + dx;
      outPos[1] = y + dy;
      return;
    }
    const ts = wm.tileSize;
    const padX = Math.max(4, w * 0.24);
    const footTop = h * 0.48;
    const footBot = h - 3;

    const core = world.core;
    const colStore = core.getStore(core.components.Collider);

    const collides = (tx: number, ty: number): boolean => {
      const left = tx + padX;
      const right = tx + w - padX;
      const top = ty + footTop;
      const bottom = ty + footBot;
      const c0 = Math.floor(left / ts);
      const c1 = Math.floor(right / ts);
      const r0 = Math.floor(top / ts);
      const r1 = Math.floor(bottom / ts);
      for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
          if (isRoomCellSolid(room, cc, rr, world.globals, wm.tileDefs)) return true;
        }
      }
      const cx = tx + w * 0.5;
      const cy = ty + h * 0.72;
      for (let i = 0; i < colStore.size(); i++) {
        const col = colStore.getDenseDataAt(i);
        if (!col.isSolid) continue;
        const eh = colStore.getDenseEntityAt(i);
        const etr = core.getComponent(eh, core.components.Transform2D);
        if (!etr) continue;
        const ex = etr.x + etr.w * 0.5;
        const ey = etr.y + etr.h * 0.78;
        if (Math.hypot(cx - ex, cy - ey) < col.radius + 8) return true;
      }
      return false;
    };

    let nx = x;
    let ny = y;
    if (dx !== 0 && !collides(nx + dx, ny)) {
      nx += dx;
    }
    if (dy !== 0 && !collides(nx, ny + dy)) {
      ny += dy;
    }
    outPos[0] = nx;
    outPos[1] = ny;
  }

  /**
   * Steps generic top-down exploration, melee slash, data-driven prop interactions,
   * data-driven enemy/boss AI, room portals, and smooth clamped follow camera.
   */
  public step(
    dt: number,
    world: EcsWorld,
    input: InputState,
    vpW: number,
    vpH: number,
    eventsOut: SimEvent[],
    cb: WorldMapStepCallbacks,
  ): void {
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm) return;

    // Auto-rebuild room tiles & 2D GPU occlusion grid whenever any gate/portal global changes
    const unlockMask = this.computeUnlockMask(world.globals);
    if (unlockMask !== this.lastUnlockMask) {
      this.rebuildTiles(world.globals);
    }

    if (this.roomBannerTimer > 0) this.roomBannerTimer = Math.max(0, this.roomBannerTimer - dt);
    if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (this.dashCooldown > 0) this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (this.slashCooldown > 0) this.slashCooldown = Math.max(0, this.slashCooldown - dt);
    if (this.slashActiveTimer > 0) this.slashActiveTimer = Math.max(0, this.slashActiveTimer - dt);
    if (this.heroInvulnTimer > 0) this.heroInvulnTimer = Math.max(0, this.heroInvulnTimer - dt);
    if (this.portalCooldown > 0) this.portalCooldown = Math.max(0, this.portalCooldown - dt);

    const core = world.core;
    const c = core.components;
    const tagStore = core.getStore(c.Tag);

    let heroHandle = 0;
    let bossCx: number | null = null;
    let bossCy: number | null = null;
    for (let i = 0; i < tagStore.size(); i++) {
      const td = tagStore.getDenseDataAt(i);
      const eh = tagStore.getDenseEntityAt(i);
      if (!heroHandle && (td.tag === 'hero' || td.tag === 'player')) {
        heroHandle = eh;
      }
      const aiP = this.findAiProfile(td.tag);
      if (aiP?.isBoss) {
        const bTr = core.getComponent(eh, c.Transform2D);
        if (bTr) {
          bossCx = bTr.x + bTr.w * 0.5;
          bossCy = bTr.y + bTr.h * 0.5;
        }
      }
    }

    if (this.director.isCutscenePlaying() && input.skillY) {
      this.director.skipCutscene();
    }

    const roomWorldW = room.cols * wm.tileSize;
    const roomWorldH = room.rows * wm.tileSize;
    const baseBlur = this.project.atmosphere.tiltShiftBlur ?? 0.34;

    if (heroHandle) {
      const hTr = core.getComponent(heroHandle, c.Transform2D);
      const hMat = core.getComponent(heroHandle, c.Material);
      const hHp = core.getComponent(heroHandle, c.Health);
      const hMotor = core.getComponent(heroHandle, c.CharacterMotor2D);
      const hAnim = core.getComponent(heroHandle, c.Animator);
      const hc = wm.heroConfig;

      if (hTr) {
        if (this.director.isBlockingGameplayInput()) {
          const heroCx = hTr.x + hTr.w * 0.5;
          const heroCy = hTr.y + hTr.h * 0.5;
          if (hAnim?.runtime) {
            hAnim.runtime.setParam('speed', 0);
            hAnim.runtime.setParam('dashing', 0);
            hAnim.runtime.setParam('attacking', 0);
          }
          this.director.step(
            dt,
            world,
            heroCx,
            heroCy,
            this.facingX,
            this.facingY,
            false,
            bossCx,
            bossCy,
            vpW,
            vpH,
            roomWorldW,
            roomWorldH,
            baseBlur,
          );
          if (!this.editorCamOverride) {
            this.cameraX = this.director.cameraX;
            this.cameraY = this.director.cameraY;
            this.clampCamera(vpW, vpH);
          }
        } else {
          // 1. 8-Directional Movement + Dash
          let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
          let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
          const moving = mx !== 0 || my !== 0;
          if (moving) {
            const inv = 1 / Math.hypot(mx, my);
            mx *= inv;
            my *= inv;
            this.facingX = mx;
            this.facingY = my;
            if (hMat && mx !== 0) hMat.flipX = mx < 0;
            this.walkAnimAccum += dt * 7.5;
            if (!hAnim && hMat && hc?.walkSpriteA && hc?.walkSpriteB) {
              hMat.spriteId = (Math.floor(this.walkAnimAccum) & 1) === 0 ? hc.walkSpriteA : hc.walkSpriteB;
            }
            this.footstepTimer -= dt;
            if (this.footstepTimer <= 0 && this.dashTimer <= 0) {
              this.footstepTimer = 0.24;
              cb.onFootstep?.(hTr.x + hTr.w * 0.5, hTr.y + hTr.h * 0.88);
            }
          } else {
            this.footstepTimer = Math.min(this.footstepTimer, 0.08);
          }

          const jumpJust = input.jump && !this.prevJump;
          if (jumpJust && this.dashCooldown <= 0) {
            this.dashTimer = 0.16;
            this.dashCooldown = 0.52;
            this.dashDirX = moving ? mx : this.facingX;
            this.dashDirY = moving ? my : this.facingY;
            this.heroInvulnTimer = Math.max(this.heroInvulnTimer, 0.22);
            eventsOut.push('jump');
            cb.onDash?.(hTr.x + hTr.w * 0.5, hTr.y + hTr.h * 0.84, this.dashDirX, this.dashDirY, heroHandle);
          }

          const baseSpeed = hMotor?.moveSpeed ?? 138;
          const dashMult = hc?.dashSpeedMultiplier ?? 2.55;
          const speed = this.dashTimer > 0 ? baseSpeed * dashMult : baseSpeed;
          const vx = this.dashTimer > 0 ? this.dashDirX * speed : mx * speed;
          const vy = this.dashTimer > 0 ? this.dashDirY * speed : my * speed;

          this.moveWithTileCollision(hTr.x, hTr.y, hTr.w, hTr.h, vx * dt, vy * dt, world, this.scratchPos);
          hTr.x = this.scratchPos[0];
          hTr.y = this.scratchPos[1];

          const heroCx = hTr.x + hTr.w * 0.5;
          const heroCy = hTr.y + hTr.h * 0.5;

          // 2. Melee Slash
          const actionJust = input.action && !this.prevAction;
          if (actionJust && this.slashCooldown <= 0) {
            this.slashCooldown = 0.24;
            this.slashActiveTimer = 0.15;
            this.slashX = heroCx + this.facingX * 22;
            this.slashY = heroCy + this.facingY * 22;
            eventsOut.push('snap');
            cb.onMeleeSwing?.(this.slashX, this.slashY, this.facingX, this.facingY, hc?.slashColor ?? '#fef08a', heroHandle);
            this.performMeleeHitCheck(world, hHp, eventsOut, cb);
          } else if (this.slashActiveTimer > 0) {
            this.slashX = heroCx + this.facingX * 22;
            this.slashY = heroCy + this.facingY * 22;
          }

          // Sync Animator state machine params AFTER melee slash so frame-0 attack pose renders immediately (even in hitstop)
          if (hAnim?.runtime) {
            hAnim.runtime.setParam('speed', Math.hypot(vx, vy));
            hAnim.runtime.setParam('dashing', this.dashTimer > 0 ? 1 : 0);
            hAnim.runtime.setParam('attacking', this.slashActiveTimer > 0 ? 1 : 0);
            hAnim.runtime.setParam('hurt', (hHp?.hitFlash ?? 0) > 0.05 ? 1 : 0);
          }

          // 3. Floor Hazard Check
          const heroCol = Math.floor(heroCx / wm.tileSize);
          const heroRow = Math.floor((hTr.y + hTr.h * 0.72) / wm.tileSize);
          if (this.heroInvulnTimer <= 0 && isRoomCellHazard(room, heroCol, heroRow, wm.tileDefs)) {
            this.damageHero(hHp, 1, heroCx, heroCy, heroHandle, eventsOut, cb);
          }

          // 4. Data-Driven Prop Interactions
          this.stepInteractions(world, heroCx, heroCy, hHp, eventsOut, cb);

          // 5. Data-Driven Enemy & Boss AI + Hostile Projectiles
          this.stepAiEntities(dt, world, heroCx, heroCy, heroHandle, hHp, eventsOut, cb);

          // 6. Clamped Follow Camera & Phase-3 Seamless Director Handback
          const inHandback = this.director.getPhase() === 'handback';
          this.director.step(
            dt,
            world,
            heroCx,
            heroCy,
            this.facingX,
            this.facingY,
            moving,
            bossCx,
            bossCy,
            vpW,
            vpH,
            roomWorldW,
            roomWorldH,
            baseBlur,
          );
          if (this.editorCamOverride) {
            this.cameraX = this.editorCamX;
            this.cameraY = this.editorCamY;
            this.clampCamera(vpW, vpH);
          } else if (inHandback) {
            this.cameraX = this.director.cameraX;
            this.cameraY = this.director.cameraY;
            this.clampCamera(vpW, vpH);
          } else {
            const targetCamX = heroCx - vpW * 0.5;
            const targetCamY = heroCy - vpH * 0.5;
            const lerp = Math.min(1, dt * 8.5);
            this.cameraX += (targetCamX - this.cameraX) * lerp;
            this.cameraY += (targetCamY - this.cameraY) * lerp;
            this.clampCamera(vpW, vpH);
            this.director.cameraX = this.cameraX;
            this.director.cameraY = this.cameraY;
          }

          // 7. Room Portal Traversal
          if (this.portalCooldown <= 0) {
            const portal = this.findTriggeredPortal(heroCx, heroCy, wm.tileSize);
            if (portal) {
              const unlocked = !portal.requiresGlobal || (world.globals.get(portal.requiresGlobal) ?? 0) >= 1;
              if (unlocked) {
                this.portalCooldown = 0.55;
                if (hHp) this.heroHpCarry = hHp.hp;
                eventsOut.push('key');
                this.loadRoomIntoWorld(world, portal.toRoomId, vpW, vpH, portal.targetX, portal.targetY, true);
                cb.onRoomBanner(this.activeRoom?.name ?? portal.name);
              } else {
                this.portalCooldown = 0.9;
                cb.onPopup(portal.lockedHint ?? 'LOCKED', heroCx, heroCy - 18, '#fbbf24');
                eventsOut.push('hurt');
              }
            }
          }
        }
      }
    }

    // Organic ambient light flicker for entities tagged 'torch' or 'brazier'
    const lightStore = core.getStore(c.LightSource);
    for (let i = 0; i < lightStore.size(); i++) {
      const h = lightStore.getDenseEntityAt(i);
      const td = core.getComponent(h, c.Tag);
      if (td?.tag === 'torch' || td?.tag === 'brazier') {
        const ls = lightStore.getDenseDataAt(i);
        const tr = core.getComponent(h, c.Transform2D);
        const seed = (tr ? tr.x * 0.13 + tr.y * 0.07 : i) + this.walkAnimAccum * 1.4;
        ls.intensity = 0.86 + Math.sin(seed * 3.1) * 0.08 + Math.cos(seed * 5.7) * 0.05;
      }
    }

    this.prevAction = input.action;
    this.prevJump = input.jump;
  }

  private damageHero(
    hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
    dmg: number,
    hx: number,
    hy: number,
    heroHandle: number,
    eventsOut: SimEvent[],
    cb: WorldMapStepCallbacks,
  ): void {
    if (!hHp || this.heroInvulnTimer > 0) return;
    hHp.hp = Math.max(0, hHp.hp - dmg);
    hHp.hitFlash = 0.25;
    this.heroHpCarry = hHp.hp;
    this.heroInvulnTimer = 0.85;
    eventsOut.push('hurt');
    cb.onPopup(`-${dmg}`, hx, hy - 14, '#fb7185');
    cb.onHeroHurt?.(hx, hy, heroHandle);
    if (hHp.hp <= 0) {
      cb.onStatusChange('lost');
    }
  }

  private triggerCutscenesForGlobal(globalKey: string): void {
    if (!this.project.cutscenes) return;
    for (let i = 0; i < this.project.cutscenes.length; i++) {
      const cs = this.project.cutscenes[i];
      if (
        cs.trigger === 'on_global_set' &&
        cs.triggerGlobal === globalKey &&
        !this.director.hasCompletedCutscene(cs.id)
      ) {
        this.director.startCutscene(cs, this.cameraX, this.cameraY, this.director.cameraZoom);
        return;
      }
    }
  }

  private executeInteractionRule(
    rule: EcsMapInteractionRule,
    world: EcsWorld,
    eh: number,
    entityId: string,
    ex: number,
    ey: number,
    hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
    eventsOut: SimEvent[],
    cb: WorldMapStepCallbacks,
    toDestroy: number[],
  ): void {
    if (rule.oneShot) {
      this.clearedEntityIds.add(entityId);
    }
    if (rule.swapSprite) {
      const mat = world.core.getComponent(eh, world.core.components.Material);
      if (mat) mat.spriteId = rule.swapSprite;
    }
    if (rule.destroyOnUse) {
      toDestroy.push(eh);
    }
    if (rule.healAmount && hHp) {
      hHp.hp = Math.min(hHp.maxHp, hHp.hp + rule.healAmount);
      this.heroHpCarry = hHp.hp;
    }
    let tilesNeedRebuild = false;
    if (rule.setGlobal) {
      world.setGlobal(rule.setGlobal, rule.setGlobalValue ?? 1);
      tilesNeedRebuild = true;
      this.triggerCutscenesForGlobal(rule.setGlobal);
    }
    let thresholdReached = false;
    let addedValue = 0;
    let targetValue = 0;
    if (rule.addGlobal) {
      addedValue = (world.getGlobal(rule.addGlobal) ?? 0) + (rule.addGlobalDelta ?? 1);
      world.setGlobal(rule.addGlobal, addedValue);
      targetValue = rule.thresholdTargetGlobal
        ? (world.getGlobal(rule.thresholdTargetGlobal) || rule.thresholdCount || 1)
        : (rule.thresholdCount ?? 0);
      if (rule.thresholdUnlockGlobal && targetValue > 0 && addedValue >= targetValue) {
        world.setGlobal(rule.thresholdUnlockGlobal, 1);
        tilesNeedRebuild = true;
        thresholdReached = true;
        this.triggerCutscenesForGlobal(rule.thresholdUnlockGlobal);
      }
    }
    if (tilesNeedRebuild) {
      this.rebuildTiles(world.globals);
    }
    if (rule.scoreDelta) {
      cb.onScoreDelta(rule.scoreDelta);
    }
    if (rule.soundEvent) {
      eventsOut.push(rule.soundEvent);
    }
    cb.onInteract?.(ex, ey, thresholdReached ? (rule.thresholdPopupColor ?? '#38bdf8') : (rule.popupColor ?? '#fde047'));
    if (thresholdReached && rule.thresholdPopup) {
      cb.onPopup(rule.thresholdPopup, ex, ey - 20, rule.thresholdPopupColor ?? '#38bdf8');
      eventsOut.push('win');
    } else if (rule.popupText) {
      const formatted = rule.popupText
        .replace('{val}', String(addedValue))
        .replace('{max}', String(targetValue));
      cb.onPopup(formatted, ex, ey - 18, rule.popupColor ?? '#fde047');
    }
  }

  private performMeleeHitCheck(
    world: EcsWorld,
    hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
    eventsOut: SimEvent[],
    cb: WorldMapStepCallbacks,
  ): void {
    const core = world.core;
    const c = core.components;
    const tagStore = core.getStore(c.Tag);
    const toDestroy: number[] = [];
    const baseReach = this.project.worldMap?.heroConfig?.slashReach ?? 34;

    for (let i = 0; i < tagStore.size(); i++) {
      const eh = tagStore.getDenseEntityAt(i);
      const td = tagStore.getDenseDataAt(i);
      const etr = core.getComponent(eh, c.Transform2D);
      if (!etr) continue;
      const ex = etr.x + etr.w * 0.5;
      const ey = etr.y + etr.h * 0.5;

      const aiProfile = this.findAiProfile(td.tag);
      if (aiProfile) {
        const reach = baseReach + (aiProfile.hitReachBonus ?? 0);
        if (Math.hypot(ex - this.slashX, ey - this.slashY) > reach) continue;
        const hp = core.getComponent(eh, c.Health);
        if (!hp) continue;

        hp.hp -= 1;
        hp.hitFlash = 0.22;
        eventsOut.push('stomp');
        cb.onPopup(aiProfile.hitPopup ?? '-1', ex, ey - 16, '#fde047');

        const kDist = Math.max(1, Math.hypot(ex - this.slashX, ey - this.slashY));
        const dirX = (ex - this.slashX) / kDist;
        const dirY = (ey - this.slashY) / kDist;
        const kb = aiProfile.knockback ?? 14;
        this.moveWithTileCollision(
          etr.x,
          etr.y,
          etr.w,
          etr.h,
          dirX * kb,
          dirY * kb,
          world,
          this.scratchPos,
        );
        etr.x = this.scratchPos[0];
        etr.y = this.scratchPos[1];

        const killed = hp.hp <= 0;
        this.director.triggerCombatImpact(
          killed ? (aiProfile.isBoss ? 'finisher' : 'heavy') : 'light',
          ex,
          ey,
        );
        cb.onHitImpact?.(ex, ey, dirX, dirY, killed, Boolean(aiProfile.isBoss), eh);

        if (aiProfile.isBoss) {
          this.bossHp = Math.max(0, hp.hp);
          if (
            aiProfile.phase2HpRatio !== undefined &&
            hp.hp <= hp.maxHp * aiProfile.phase2HpRatio &&
            this.bossPhase === 1
          ) {
            this.bossPhase = 2;
            this.director.triggerCombatImpact('boss_phase', ex, ey);
            if (aiProfile.phase2Popup) {
              cb.onPopup(aiProfile.phase2Popup, ex, ey - 28, '#fb7185');
            }
            cb.onBossPhase?.(ex, ey);
            eventsOut.push('explode');
            if (this.project.cutscenes) {
              for (let cIdx = 0; cIdx < this.project.cutscenes.length; cIdx++) {
                const cs = this.project.cutscenes[cIdx];
                if (cs.trigger === 'on_boss_phase' && !this.director.hasCompletedCutscene(cs.id)) {
                  this.director.startCutscene(cs, this.cameraX, this.cameraY, this.director.cameraZoom);
                  break;
                }
              }
            }
          }
        }

        if (killed) {
          this.clearedEntityIds.add(td.entityId);
          toDestroy.push(eh);
          if (aiProfile.scoreOnDefeat) cb.onScoreDelta(aiProfile.scoreOnDefeat);
          if (aiProfile.defeatPopup) cb.onPopup(aiProfile.defeatPopup, ex, ey - 24, '#fef08a');
          if (aiProfile.winOnDefeat) {
            eventsOut.push('win');
            cb.onStatusChange('won');
          } else {
            eventsOut.push('explode');
          }
        }
        continue;
      }

      const rule = this.findInteractionRule(td.tag);
      if (
        rule &&
        rule.trigger === 'slash_or_touch' &&
        !this.clearedEntityIds.has(td.entityId) &&
        Math.hypot(ex - this.slashX, ey - this.slashY) <= baseReach
      ) {
        this.executeInteractionRule(rule, world, eh, td.entityId, ex, ey, hHp, eventsOut, cb, toDestroy);
      }
    }

    for (let i = 0; i < toDestroy.length; i++) {
      core.destroyEntity(toDestroy[i]);
    }
  }

  private stepInteractions(
    world: EcsWorld,
    heroCx: number,
    heroCy: number,
    hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
    eventsOut: SimEvent[],
    cb: WorldMapStepCallbacks,
  ): void {
    const rules = this.project.worldMap?.interactions;
    if (!rules || rules.length === 0) return;

    const core = world.core;
    const c = core.components;
    const tagStore = core.getStore(c.Tag);
    const toDestroy: number[] = [];

    for (let i = 0; i < tagStore.size(); i++) {
      const eh = tagStore.getDenseEntityAt(i);
      const td = tagStore.getDenseDataAt(i);
      if (this.clearedEntityIds.has(td.entityId)) continue;
      const rule = this.findInteractionRule(td.tag);
      if (!rule) continue;
      const etr = core.getComponent(eh, c.Transform2D);
      if (!etr) continue;
      const ex = etr.x + etr.w * 0.5;
      const ey = etr.y + etr.h * 0.5;
      if (Math.hypot(heroCx - ex, heroCy - ey) < rule.radius) {
        this.executeInteractionRule(rule, world, eh, td.entityId, ex, ey, hHp, eventsOut, cb, toDestroy);
      }
    }

    for (let i = 0; i < toDestroy.length; i++) {
      core.destroyEntity(toDestroy[i]);
    }
  }

  private stepAiEntities(
    dt: number,
    world: EcsWorld,
    heroCx: number,
    heroCy: number,
    heroHandle: number,
    hHp: { hp: number; maxHp: number; hitFlash: number } | undefined,
    eventsOut: SimEvent[],
    cb: WorldMapStepCallbacks,
  ): void {
    const core = world.core;
    const c = core.components;
    const tagStore = core.getStore(c.Tag);
    const toDestroy: number[] = [];
    const projTag = this.project.worldMap?.hostileProjectileTag ?? 'enemy_orb';

    for (let i = 0; i < tagStore.size(); i++) {
      const eh = tagStore.getDenseEntityAt(i);
      const td = tagStore.getDenseDataAt(i);
      const etr = core.getComponent(eh, c.Transform2D);
      if (!etr) continue;

      const ex = etr.x + etr.w * 0.5;
      const ey = etr.y + etr.h * 0.5;
      const dx = heroCx - ex;
      const dy = heroCy - ey;
      const dist = Math.hypot(dx, dy);

      const profile = this.findAiProfile(td.tag);
      if (profile) {
        const isPhase2 = Boolean(profile.isBoss && this.bossPhase >= 2);
        if (profile.isBoss) {
          const hp = core.getComponent(eh, c.Health);
          if (hp) {
            this.bossHp = hp.hp;
            this.bossMaxHp = hp.maxHp;
          }
        }

        const spd = isPhase2 && profile.phase2Speed !== undefined ? profile.phase2Speed : profile.moveSpeed;
        const chasing = dist < profile.chaseRange && dist > profile.stopRange;
        if (chasing) {
          let moveDirX = dx / dist;
          let moveDirY = dy / dist;
          const room = this.activeRoom;
          const wm = this.project.worldMap;
          if (room && wm) {
            const ts = wm.tileSize;
            const eCol = Math.max(0, Math.min(room.cols - 1, Math.floor(ex / ts)));
            const eRow = Math.max(0, Math.min(room.rows - 1, Math.floor(ey / ts)));
            const hCol = Math.max(0, Math.min(room.cols - 1, Math.floor(heroCx / ts)));
            const hRow = Math.max(0, Math.min(room.rows - 1, Math.floor(heroCy / ts)));
            this.currentGlobalsRef = world.globals;
            if (!hasGridLineOfSight(eCol, eRow, hCol, hRow, this.isCellOpaquePredicate)) {
              const nextCell = findAStarNextCell(
                room.cols,
                room.rows,
                eCol,
                eRow,
                hCol,
                hRow,
                this.isCellWalkablePredicate,
                undefined,
                1,
                this.pathWorkspace,
              );
              if (nextCell >= 0) {
                const nextCol = nextCell % room.cols;
                const nextRow = (nextCell - nextCol) / room.cols;
                const ndx = (nextCol + 0.5) * ts - ex;
                const ndy = (nextRow + 0.5) * ts - ey;
                const ndist = Math.hypot(ndx, ndy);
                if (ndist > 0.001) {
                  moveDirX = ndx / ndist;
                  moveDirY = ndy / ndist;
                }
              }
            }
          }
          const origX = etr.x;
          const origY = etr.y;
          this.moveWithTileCollision(
            origX,
            origY,
            etr.w,
            etr.h,
            moveDirX * spd * dt,
            moveDirY * spd * dt,
            world,
            this.scratchPos,
          );
          if (
            room &&
            wm &&
            Math.hypot(this.scratchPos[0] - origX, this.scratchPos[1] - origY) < spd * dt * 0.15
          ) {
            const ts = wm.tileSize;
            const eCol = Math.max(0, Math.min(room.cols - 1, Math.floor(ex / ts)));
            const eRow = Math.max(0, Math.min(room.rows - 1, Math.floor(ey / ts)));
            const hCol = Math.max(0, Math.min(room.cols - 1, Math.floor(heroCx / ts)));
            const hRow = Math.max(0, Math.min(room.rows - 1, Math.floor(heroCy / ts)));
            this.currentGlobalsRef = world.globals;
            const nextCell = findAStarNextCell(
              room.cols,
              room.rows,
              eCol,
              eRow,
              hCol,
              hRow,
              this.isCellWalkablePredicate,
              undefined,
              1,
              this.pathWorkspace,
            );
            if (nextCell >= 0) {
              const nextCol = nextCell % room.cols;
              const nextRow = (nextCell - nextCol) / room.cols;
              const ndx = (nextCol + 0.5) * ts - ex;
              const ndy = (nextRow + 0.5) * ts - ey;
              const ndist = Math.hypot(ndx, ndy);
              if (ndist > 0.001) {
                this.moveWithTileCollision(
                  origX,
                  origY,
                  etr.w,
                  etr.h,
                  (ndx / ndist) * spd * dt,
                  (ndy / ndist) * spd * dt,
                  world,
                  this.scratchPos,
                );
              }
            }
          }
          etr.x = this.scratchPos[0];
          etr.y = this.scratchPos[1];
          const mat = core.getComponent(eh, c.Material);
          if (mat) mat.flipX = dx < 0;
        }
        const eAnim = core.getComponent(eh, c.Animator);
        if (eAnim?.runtime) {
          eAnim.runtime.setParam('speed', chasing ? spd : 0);
        }
        if (dist < profile.contactRange) {
          this.damageHero(hHp, profile.contactDamage, heroCx, heroCy, heroHandle, eventsOut, cb);
        }

        if (profile.projectilePrefab && profile.projectileInterval) {
          const timer = (this.aiTimers.get(td.entityId) ?? profile.projectileInterval) - dt;
          if (timer <= 0 && dist < profile.chaseRange) {
            const nextInt = isPhase2
              ? (profile.projectilePhase2Interval ?? profile.projectileInterval)
              : profile.projectileInterval;
            this.aiTimers.set(td.entityId, nextInt);
            const baseAng = Math.atan2(dy, dx);
            const count = Math.max(
              1,
              isPhase2 ? (profile.projectilePhase2Count ?? profile.projectileCount ?? 5) : (profile.projectileCount ?? 3),
            );
            const spread = isPhase2
              ? (profile.projectilePhase2SpreadRad ?? profile.projectileSpreadRad ?? 1.2)
              : (profile.projectileSpreadRad ?? 0.9);
            const bSpd = isPhase2
              ? (profile.projectilePhase2Speed ?? profile.projectileSpeed ?? 150)
              : (profile.projectileSpeed ?? 125);
            for (let k = 0; k < count; k++) {
              const frac = count > 1 ? k / (count - 1) - 0.5 : 0;
              const ang = baseAng + frac * spread;
              const orb = world.spawnFromPrefab(profile.projectilePrefab, ex - 10, ey - 10);
              if (orb) {
                const b = core.getComponent(orb, c.Velocity2D);
                if (b) {
                  b.vx = Math.cos(ang) * bSpd;
                  b.vy = Math.sin(ang) * bSpd;
                }
              }
            }
            eventsOut.push('snap');
          } else {
            this.aiTimers.set(td.entityId, timer);
          }
        }
      } else if (td.tag === projTag) {
        if (dist < 18) {
          this.damageHero(hHp, 1, heroCx, heroCy, heroHandle, eventsOut, cb);
          toDestroy.push(eh);
        } else if (this.activeRoom && this.project.worldMap) {
          const ts = this.project.worldMap.tileSize;
          if (
            isRoomCellSolid(
              this.activeRoom,
              Math.floor(ex / ts),
              Math.floor(ey / ts),
              world.globals,
              this.project.worldMap.tileDefs,
            )
          ) {
            toDestroy.push(eh);
          }
        }
      }
    }

    for (let i = 0; i < toDestroy.length; i++) {
      core.destroyEntity(toDestroy[i]);
    }
  }

  private findTriggeredPortal(heroCx: number, heroCy: number, ts: number): EcsMapPortalDef | null {
    const wm = this.project.worldMap;
    if (!wm) return null;
    for (let i = 0; i < wm.portals.length; i++) {
      const p = wm.portals[i];
      if (p.fromRoomId !== this.activeRoomId) continue;
      const x0 = p.col * ts;
      const y0 = p.row * ts;
      const x1 = (p.col + p.cols) * ts;
      const y1 = (p.row + p.rows) * ts;
      if (heroCx >= x0 && heroCx <= x1 && heroCy >= y0 && heroCy <= y1) {
        return p;
      }
    }
    return null;
  }

  /**
   * Emits subtle ambient light pools defined declaratively by `EcsTileDef.ambientLight`.
   */
  public appendAmbientTileLights(
    acquireLight: (idx: number) => LightDesc,
    outLights: LightDesc[],
    startIdx: number,
  ): number {
    let idx = startIdx;
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm) return idx;
    const ts = wm.tileSize;
    const customDefs = wm.tileDefs;

    for (let r = 0; r < room.rows && idx < 22; r++) {
      for (let c = 0; c < room.cols && idx < 22; c++) {
        const tid = room.wall[r * room.cols + c] ?? 0;
        if (tid <= 0) continue;
        const def = getCastleTileDef(tid, customDefs);
        if (!def?.ambientLight) continue;
        const l = acquireLight(idx++);
        l.x = c * ts + ts * 0.5;
        l.y = r * ts + ts * 1.1;
        l.radius = def.ambientLight.radius;
        l.color = def.ambientLight.color;
        l.intensity = def.ambientLight.intensity;
        outLights.push(l);
      }
    }
    return idx;
  }
}
