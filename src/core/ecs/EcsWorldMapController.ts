import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { OCCLUSION_GRID_MAX } from '../gpu/GpuTypes.ts';
import {
  computeSymmetricFovInto,
  createSymmetricFovScratch,
  hasGridLineOfSight,
} from '../math/Visibility2D.ts';
import {
  createPathfinderWorkspace,
  findAStarPathInto,
} from '../sim/GridPathfinder.ts';
import type {
  InputState,
  LightDesc,
  OcclusionGridDesc,
  SimEvent,
  TileDesc,
  VoxelRenderDesc,
} from '../types/WorldTypes.ts';
import { EcsCinematicDirector, type EcsCutsceneShotDef } from './EcsCinematicDirector.ts';
import type { EcsProjectV2 } from './EcsProjectSchema.ts';
import {
  getCastleTileDef,
  isRoomCellHazard,
  isRoomCellSolid,
  type EcsMapRoomDef,
  type EcsTileDef,
} from './EcsTilemapTypes.ts';
import { RoomVoxelVolume } from './EcsVoxelVolume.ts';
import type { EcsWorld } from './EcsWorld.ts';
import {
  clampWorldCamera,
  computeWorldUnlockMask,
  findTriggeredPortalInRoom,
  rebuildWorldTilesAndVoxels,
  moveWithTileCollisionPure,
  updateActorVoxelElevationPure,
  type WorldMapStepCallbacks,
  type WorldTileRebuildOutput,
} from './EcsWorldMapPhysics.ts';
import {
  createWorldMapCombatState,
  damageHeroInWorld,
  findWorldAiProfile,
  findWorldInteractionRule,
  performWorldMeleeHitCheck,
  stepWorldAiEntities,
  stepWorldInteractions,
  stepWorldTorchFlicker,
  type WorldMapCombatState,
} from './EcsWorldMapSystems.ts';

export type { WorldMapStepCallbacks } from './EcsWorldMapPhysics.ts';

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
  public readonly voxelVolume = new RoomVoxelVolume();
  private readonly voxelRenderPool: VoxelRenderDesc[] = [];
  public readonly outVoxels3d: VoxelRenderDesc[] = [];
  public outVoxels3dCount = 0;
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

  // Camera state (world top-left in logical pixels + smooth Z focus height)
  public cameraX = 0;
  public cameraY = 0;
  public cameraZ = 0;
  private editorCamOverride = false;
  private editorCamX = 0;
  private editorCamY = 0;

  private readonly sim: WorldMapCombatState = createWorldMapCombatState();
  private readonly cachedAmbientLights: LightDesc[] = [];
  private cachedAmbientLightCount = 0;
  private readonly rebuildResultScratch: WorldTileRebuildOutput = {
    outVoxels3dCount: 0,
    cachedAmbientLightCount: 0,
    unlockMask: 0,
  };
  private readonly slashVisualScratch: {
    active: boolean;
    sprite: SpriteId | null;
    color: string;
    x: number;
    y: number;
    rot: number;
    alpha: number;
  } = {
    active: false,
    sprite: null,
    color: '#fef08a',
    x: 0,
    y: 0,
    rot: 0,
    alpha: 0,
  };
  private readonly heroHpScratch = { hp: 0, maxHp: 10 };
  private readonly bossInfoScratch = { name: '', hp: 0, maxHp: 0 };
  private readonly pathWorkspace = createPathfinderWorkspace(OCCLUSION_GRID_MAX * OCCLUSION_GRID_MAX);
  private readonly fovScratch = createSymmetricFovScratch(512);
  private currentGlobalsRef: ReadonlyMap<string, number> | null = null;
  private readonly setCurrentGlobalsBound = (globals: ReadonlyMap<string, number>): void => {
    this.currentGlobalsRef = globals;
  };
  private readonly rebuildTilesCurrentBound = (): void => {
    if (this.currentGlobalsRef) this.rebuildTiles(this.currentGlobalsRef);
  };
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
  private readonly isWallTileSolidForVoxel = (tileId: number): boolean => {
    const wm = this.project.worldMap;
    const def = getCastleTileDef(tileId, wm?.tileDefs);
    if (!def || !def.solid) return false;
    if (def.unlockGlobal && this.currentGlobalsRef && (this.currentGlobalsRef.get(def.unlockGlobal) ?? 0) >= 1) {
      return false;
    }
    return true;
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

  public getStoryHeight(): number {
    return this.activeRoom ? (this.activeRoom.storyHeight ?? this.activeRoom.wallExtrudeH ?? 24) : 24;
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
    return this.sim.roomBannerTimer > 0 ? this.sim.roomBannerText : '';
  }

  public getBossInfo(): { name: string; hp: number; maxHp: number } {
    this.bossInfoScratch.name = this.sim.bossName;
    this.bossInfoScratch.hp = this.sim.bossHp;
    this.bossInfoScratch.maxHp = this.sim.bossMaxHp;
    return this.bossInfoScratch;
  }

  public getHeroHp(): { hp: number; maxHp: number } {
    this.heroHpScratch.hp = Math.max(0, this.sim.heroHpCarry);
    this.heroHpScratch.maxHp = this.sim.heroMaxHpCarry;
    return this.heroHpScratch;
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
    const s = this.slashVisualScratch;
    s.active = this.sim.slashActiveTimer > 0 && Boolean(hc?.slashSprite);
    s.sprite = hc?.slashSprite ?? null;
    s.color = hc?.slashColor ?? '#fef08a';
    s.x = this.sim.slashX;
    s.y = this.sim.slashY;
    s.rot = Math.atan2(this.sim.facingY, this.sim.facingX);
    s.alpha = Math.min(1, this.sim.slashActiveTimer / 0.14);
    return s;
  }

  public setEditorCamera(x: number, y: number): void {
    this.editorCamOverride = true;
    this.editorCamX = x;
    this.editorCamY = y;
    this.cameraX = x;
    this.cameraY = y;
    this.sim.cameraX = x;
    this.sim.cameraY = y;
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
      this.outVoxels3d.length = 0;
      this.outVoxels3dCount = 0;
      this.cachedAmbientLightCount = 0;
      this.cameraX = 0;
      this.cameraY = 0;
      this.cameraZ = 0;
      this.sim.cameraX = 0;
      this.sim.cameraY = 0;
      return;
    }
    const desiredId =
      preserveRoom && wm.rooms.some((r) => r.id === this.activeRoomId)
        ? this.activeRoomId
        : wm.startRoomId;
    this.reset(world, vpW, vpH, desiredId);
  }

  public reset(world: EcsWorld, vpW: number, vpH: number, roomIdOverride?: string): void {
    const s = this.sim;
    s.clearedEntityIds.clear();
    s.aiTimers.clear();
    this.director.reset(true);
    this.cameraZ = 0;
    s.heroHpCarry = -1;
    s.heroMaxHpCarry = 10;
    s.facingX = 0;
    s.facingY = -1;
    s.dashTimer = 0;
    s.dashCooldown = 0;
    s.slashCooldown = 0;
    s.slashActiveTimer = 0;
    s.heroInvulnTimer = 0;
    s.portalCooldown = 0.25;
    s.footstepTimer = 0;
    s.bossName = '';
    s.bossPhase = 1;
    s.bossHp = 0;
    s.bossMaxHp = 0;
    s.prevAction = false;
    s.prevJump = false;

    const wm = this.project.worldMap;
    if (!wm || wm.rooms.length === 0) {
      this.activeRoom = null;
      this.activeRoomId = '';
      this.cachedAmbientLightCount = 0;
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

    const s = this.sim;
    this.activeRoom = room;
    this.activeRoomId = room.id;
    s.bossName = '';
    s.bossHp = 0;
    s.bossMaxHp = 0;
    s.bossPhase = 1;
    s.aiTimers.clear();

    world.core.clear();
    world.globals.clear();
    world.paths.clear();
    world.animDefs.clear();
    world.prefabs.clear();
    world.models3d.clear();

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
    if (this.project.models3d) {
      for (const [k, m3d] of Object.entries(this.project.models3d)) {
        world.models3d.set(k, m3d);
      }
    }

    const core = world.core;
    const c = core.components;
    let heroFoundX = spawnX ?? room.cols * wm.tileSize * 0.5;
    let heroFoundY = spawnY ?? (room.rows - 3) * wm.tileSize;
    let heroFoundZ = 0;

    for (let i = 0; i < this.project.entities.length; i++) {
      const init = this.project.entities[i];
      const isHeroInit = init.id === 'hero' || init.components.tag === 'hero';
      if (!isHeroInit && init.roomId && init.roomId !== room.id) continue;
      if (!isHeroInit && !init.roomId && room.id !== wm.startRoomId) continue;

      const tagGuess =
        init.components.tag ?? (init.prefabId ? this.project.prefabs[init.prefabId]?.components.tag : '') ?? '';
      const isCleared = s.clearedEntityIds.has(init.id);
      const aiProfile = findWorldAiProfile(this.project, tagGuess);
      const interactRule = findWorldInteractionRule(this.project, tagGuess);

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
        const heroSp = core.getComponent(h, c.Spatial3D);
        heroFoundZ = heroSp ? heroSp.z : 0;
        if (hp) {
          if (s.heroHpCarry > 0) {
            hp.hp = Math.min(hp.maxHp, s.heroHpCarry);
          } else {
            s.heroHpCarry = hp.hp;
            s.heroMaxHpCarry = hp.maxHp;
          }
        }
      }

      // Restore swapped sprite for previously triggered persistent props (chests/switches)
      if (isCleared && mat && interactRule?.swapSprite) {
        mat.spriteId = interactRule.swapSprite;
      }

      // Track active boss entity dynamically using its real project entity name
      if (aiProfile?.isBoss && hp) {
        s.bossName = init.name || 'BOSS';
        s.bossHp = hp.hp;
        s.bossMaxHp = hp.maxHp;
        s.bossPhase = 1;
        s.aiTimers.set(init.id, aiProfile.projectileInterval ?? 1.6);
      }
    }

    if (!this.editorCamOverride) {
      this.snapCameraTo(heroFoundX, heroFoundY, vpW, vpH);
      this.cameraZ = heroFoundZ;
    } else {
      this.clampCamera(vpW, vpH, 1.0);
    }
    this.director.syncLivePose(
      this.cameraX,
      this.cameraY,
      1.0,
      this.project.atmosphere.tiltShiftBlur ?? 0,
      this.project.atmosphere.tiltShiftFocusY ?? 0.52,
    );

    s.roomBannerText = room.name;
    s.roomBannerTimer = 2.6;
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

  /**
   * Rebuilds the pooled `TileDesc[]` array for the active room (ground + decor + HD-2D extruded walls)
   * and caches static ambient tile lights so 60Hz snapshots never rescan the wall grid.
   */
  public rebuildTiles(globals: ReadonlyMap<string, number>): void {
    this.currentGlobalsRef = globals;
    rebuildWorldTilesAndVoxels(
      this.activeRoom,
      this.project.worldMap,
      globals,
      this.tilePool,
      this.outTiles,
      this.voxelVolume,
      this.voxelRenderPool,
      this.outVoxels3d,
      this.occlusionGrid,
      this.cachedAmbientLights,
      this.isWallTileSolidForVoxel,
      this.rebuildResultScratch,
    );
    this.outVoxels3dCount = this.rebuildResultScratch.outVoxels3dCount;
    this.cachedAmbientLightCount = this.rebuildResultScratch.cachedAmbientLightCount;
    this.lastUnlockMask = this.rebuildResultScratch.unlockMask;
    if (this.activeRoom && this.project.worldMap) {
      this.occlusionVersion++;
    }
  }

  private clampCamera(vpW: number, vpH: number, zoom = 1.0): void {
    clampWorldCamera(
      this.activeRoom,
      this.project.worldMap,
      this.cameraX,
      this.cameraY,
      vpW,
      vpH,
      zoom,
      this.sim.scratchPos,
    );
    this.cameraX = this.sim.scratchPos[0];
    this.cameraY = this.sim.scratchPos[1];
    this.sim.cameraX = this.cameraX;
    this.sim.cameraY = this.cameraY;
  }

  private snapCameraTo(targetX: number, targetY: number, vpW: number, vpH: number): void {
    this.cameraX = targetX - vpW * 0.5;
    this.cameraY = targetY - vpH * 0.5;
    this.clampCamera(vpW, vpH, 1.0);
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
    directorDt = dt,
  ): void {
    const room = this.activeRoom;
    const wm = this.project.worldMap;
    if (!room || !wm) return;

    this.currentGlobalsRef = world.globals;
    const s = this.sim;

    // Auto-rebuild room tiles & 2D GPU occlusion grid whenever any gate/portal global changes
    const unlockMask = computeWorldUnlockMask(wm, world.globals);
    if (unlockMask !== this.lastUnlockMask) {
      this.rebuildTiles(world.globals);
    }

    if (s.roomBannerTimer > 0) s.roomBannerTimer = Math.max(0, s.roomBannerTimer - directorDt);
    if (s.dashTimer > 0) s.dashTimer = Math.max(0, s.dashTimer - dt);
    if (s.dashCooldown > 0) s.dashCooldown = Math.max(0, s.dashCooldown - dt);
    if (s.slashCooldown > 0) s.slashCooldown = Math.max(0, s.slashCooldown - dt);
    if (s.slashActiveTimer > 0) s.slashActiveTimer = Math.max(0, s.slashActiveTimer - dt);
    if (s.heroInvulnTimer > 0) s.heroInvulnTimer = Math.max(0, s.heroInvulnTimer - dt);
    if (s.portalCooldown > 0) s.portalCooldown = Math.max(0, s.portalCooldown - dt);

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
      const aiP = findWorldAiProfile(this.project, td.tag);
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
    const baseBlur = this.project.atmosphere.tiltShiftBlur ?? 0;
    const baseFocusY = this.project.atmosphere.tiltShiftFocusY ?? 0.52;
    const activeDimMask = this.project.projection?.activeDimensionMask ?? 3;

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
            directorDt,
            world,
            heroCx,
            heroCy,
            s.facingX,
            s.facingY,
            false,
            bossCx,
            bossCy,
            vpW,
            vpH,
            roomWorldW,
            roomWorldH,
            baseBlur,
            undefined,
            baseFocusY,
          );
          if (!this.editorCamOverride) {
            this.cameraX = this.director.cameraX;
            this.cameraY = this.director.cameraY;
            this.clampCamera(vpW, vpH, this.director.cameraZoom);
            const hSpCut = core.getComponent(heroHandle, c.Spatial3D);
            const targetZ = hSpCut ? hSpCut.z : 0;
            const zRate = 1 - Math.exp(-Math.max(0, directorDt) * 8.5);
            this.cameraZ += (targetZ - this.cameraZ) * zRate;
            if (Math.abs(targetZ - this.cameraZ) < 0.05) this.cameraZ = targetZ;
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
            s.facingX = mx;
            s.facingY = my;
            if (hMat && mx !== 0) hMat.flipX = mx < 0;
            s.walkAnimAccum += dt * 7.5;
            if (!hAnim && hMat && hc?.walkSpriteA && hc?.walkSpriteB) {
              hMat.spriteId = (Math.floor(s.walkAnimAccum) & 1) === 0 ? hc.walkSpriteA : hc.walkSpriteB;
            }
            s.footstepTimer -= dt;
            if (s.footstepTimer <= 0 && s.dashTimer <= 0) {
              s.footstepTimer = 0.24;
              cb.onFootstep?.(hTr.x + hTr.w * 0.5, hTr.y + hTr.h * 0.88);
            }
          } else {
            s.footstepTimer = Math.min(s.footstepTimer, 0.08);
          }

          const jumpJust = input.jump && !s.prevJump;
          if (jumpJust && s.dashCooldown <= 0) {
            s.dashTimer = 0.16;
            s.dashCooldown = 0.52;
            s.dashDirX = moving ? mx : s.facingX;
            s.dashDirY = moving ? my : s.facingY;
            s.heroInvulnTimer = Math.max(s.heroInvulnTimer, 0.22);
            eventsOut.push('jump');
            cb.onDash?.(hTr.x + hTr.w * 0.5, hTr.y + hTr.h * 0.84, s.dashDirX, s.dashDirY, heroHandle);
          }

          const baseSpeed = hMotor?.moveSpeed ?? 138;
          const dashMult = hc?.dashSpeedMultiplier ?? 2.55;
          const speed = s.dashTimer > 0 ? baseSpeed * dashMult : baseSpeed;
          const vx = s.dashTimer > 0 ? s.dashDirX * speed : mx * speed;
          const vy = s.dashTimer > 0 ? s.dashDirY * speed : my * speed;

          moveWithTileCollisionPure(
            hTr.x,
            hTr.y,
            hTr.w,
            hTr.h,
            vx * dt,
            vy * dt,
            room,
            wm,
            world,
            this.voxelVolume,
            activeDimMask,
            s.scratchPos,
            heroHandle,
          );
          hTr.x = s.scratchPos[0];
          hTr.y = s.scratchPos[1];
          const hasVoxels = Boolean(room.voxels && room.voxels.length > 0);
          if (hasVoxels) {
            updateActorVoxelElevationPure(world, this.voxelVolume, heroHandle, dt);
          }

          const heroCx = hTr.x + hTr.w * 0.5;
          const heroCy = hTr.y + hTr.h * 0.5;

          // 2. Melee Slash
          const actionJust = input.action && !s.prevAction;
          if (actionJust && s.slashCooldown <= 0) {
            s.slashCooldown = 0.24;
            s.slashActiveTimer = 0.15;
            s.slashX = heroCx + s.facingX * 22;
            s.slashY = heroCy + s.facingY * 22;
            eventsOut.push('snap');
            cb.onMeleeSwing?.(s.slashX, s.slashY, s.facingX, s.facingY, hc?.slashColor ?? '#fef08a', heroHandle);
            performWorldMeleeHitCheck(
              this.project,
              room,
              s,
              this.director,
              this.voxelVolume,
              activeDimMask,
              world,
              hHp,
              eventsOut,
              cb,
              this.rebuildTilesCurrentBound,
            );
          } else if (s.slashActiveTimer > 0) {
            s.slashX = heroCx + s.facingX * 22;
            s.slashY = heroCy + s.facingY * 22;
          }

          // Sync Animator state machine params AFTER melee slash so frame-0 attack pose renders immediately (even in hitstop)
          if (hAnim?.runtime) {
            hAnim.runtime.setParam('speed', Math.hypot(vx, vy));
            hAnim.runtime.setParam('dashing', s.dashTimer > 0 ? 1 : 0);
            hAnim.runtime.setParam('attacking', s.slashActiveTimer > 0 ? 1 : 0);
            hAnim.runtime.setParam('hurt', (hHp?.hitFlash ?? 0) > 0.05 ? 1 : 0);
          }

          // 3. Floor Hazard Check (elevated 3D actors above ground bridges clear ground-level hazards)
          const heroCol = Math.floor(heroCx / wm.tileSize);
          const heroRow = Math.floor((hTr.y + hTr.h * 0.72) / wm.tileSize);
          const heroSp = core.getComponent(heroHandle, c.Spatial3D);
          const heroZ = heroSp ? heroSp.z : 0;
          if (heroZ <= 4 && s.heroInvulnTimer <= 0 && isRoomCellHazard(room, heroCol, heroRow, wm.tileDefs)) {
            damageHeroInWorld(s, hHp, 1, heroCx, heroCy, heroHandle, eventsOut, cb);
          }

          // 4. Data-Driven Prop Interactions
          stepWorldInteractions(
            this.project,
            s,
            this.director,
            world,
            heroCx,
            heroCy,
            hHp,
            eventsOut,
            cb,
            this.rebuildTilesCurrentBound,
          );

          // 5. Data-Driven Enemy & Boss AI + Hostile Projectiles
          stepWorldAiEntities(
            this.project,
            room,
            s,
            this.voxelVolume,
            activeDimMask,
            this.pathWorkspace,
            this.isCellOpaquePredicate,
            this.isCellWalkablePredicate,
            this.setCurrentGlobalsBound,
            dt,
            world,
            heroCx,
            heroCy,
            heroHandle,
            hHp,
            eventsOut,
            cb,
          );

          // 6. Director-Driven Live Framing (Lead-Room Look-Ahead, Toric Boss Framing) & Phase-3 Seamless Handback
          this.director.step(
            directorDt,
            world,
            heroCx,
            heroCy,
            s.facingX,
            s.facingY,
            moving,
            bossCx,
            bossCy,
            vpW,
            vpH,
            roomWorldW,
            roomWorldH,
            baseBlur,
            undefined,
            baseFocusY,
          );
          if (this.editorCamOverride) {
            this.cameraX = this.editorCamX;
            this.cameraY = this.editorCamY;
            this.clampCamera(vpW, vpH, 1.0);
          } else {
            this.cameraX = this.director.cameraX;
            this.cameraY = this.director.cameraY;
            this.clampCamera(vpW, vpH, this.director.cameraZoom);
            const zRate = 1 - Math.exp(-Math.max(0, directorDt) * 8.5);
            this.cameraZ += (heroZ - this.cameraZ) * zRate;
            if (Math.abs(heroZ - this.cameraZ) < 0.05) this.cameraZ = heroZ;
          }

          // 7. Room Portal Traversal
          if (s.portalCooldown <= 0) {
            const portal = findTriggeredPortalInRoom(wm, this.activeRoomId, heroCx, heroCy, wm.tileSize);
            if (portal) {
              const unlocked = !portal.requiresGlobal || (world.globals.get(portal.requiresGlobal) ?? 0) >= 1;
              if (unlocked) {
                s.portalCooldown = 0.55;
                if (hHp) s.heroHpCarry = hHp.hp;
                eventsOut.push('key');
                this.loadRoomIntoWorld(world, portal.toRoomId, vpW, vpH, portal.targetX, portal.targetY, true);
                cb.onRoomBanner(this.activeRoom?.name ?? portal.name);
              } else {
                s.portalCooldown = 0.9;
                cb.onPopup(portal.lockedHint ?? 'LOCKED', heroCx, heroCy - 18, '#fbbf24');
                eventsOut.push('hurt');
              }
            }
          }
        }
      }
    }

    // Organic ambient light flicker for entities tagged 'torch' or 'brazier'
    stepWorldTorchFlicker(world, s.walkAnimAccum);

    s.prevAction = input.action;
    s.prevJump = input.jump;
  }

  /** Live non-transactional tile PBR/sprite preview update for workbench sliders. */
  public patchLiveTileDef(tileDef: EcsTileDef, globals: ReadonlyMap<string, number>): void {
    const wm = this.project.worldMap;
    if (!wm) return;
    const defs = [...(wm.tileDefs ?? [])];
    const idx = defs.findIndex((d) => d.id === tileDef.id);
    if (idx >= 0) defs[idx] = tileDef;
    else defs.push(tileDef);
    wm.tileDefs = defs;
    this.rebuildTiles(globals);
  }

  /**
   * Emits subtle ambient light pools cached from `EcsTileDef.ambientLight` during `rebuildTiles()`.
   */
  public appendAmbientTileLights(
    acquireLight: (idx: number) => LightDesc,
    outLights: LightDesc[],
    startIdx: number,
  ): number {
    let idx = startIdx;
    for (let i = 0; i < this.cachedAmbientLightCount && idx < 22; i++) {
      const src = this.cachedAmbientLights[i];
      const l = acquireLight(idx);
      l.x = src.x;
      l.y = src.y;
      l.z = src.z;
      l.radius = src.radius;
      l.color = src.color;
      l.intensity = src.intensity;
      l.falloffPower = undefined;
      outLights[idx++] = l;
    }
    return idx;
  }
}
