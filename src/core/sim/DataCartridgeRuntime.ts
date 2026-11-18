import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { GAME_H, GAME_W, resolveLogicalViewport, type LogicalViewport } from '../gpu/GpuTypes.ts';
import { InputMap } from '../input/InputMap.ts';
import { SpatialHash } from '../math/SpatialHash.ts';
import { SeededRng } from '../runtime/SeededRng.ts';
import type { ShmupFighterSummary } from '../types/HudTypes.ts';
import {
  clamp,
  type BgCloudDesc,
  type BgParallaxLayerDesc,
  type BgStarDesc,
  type ComboTrackingCartridge,
  type DebuggableCartridge,
  type DebugRectDesc,
  type EntityDesc,
  type InputState,
  type LightDesc,
  type ParticleDesc,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type SimEvent,
  type StageProgressInfo,
  type TileDesc,
} from '../types/WorldTypes.ts';
import {
  validateCartridgeJson,
  type CartridgeArchetypeDef,
  type CartridgeJsonV1,
  type CartridgeTag,
  type CartridgeTileChunkDef,
} from './CartridgeSchema.ts';
import {
  applyShmupLoadout,
  buildShmupHudFromPool,
  getActiveLoadout,
  getChargeTier,
  spawnShmupWaveFromJson,
  stepShmupSystem,
  syncFunnelSlots,
  triggerShmupBomb,
  type RuntimeShmupState,
  type ShmupRuntimeContext,
} from './DataRuntimeShmup.ts';
import {
  EventActionVm,
  type VmButtonEdge,
  type VmButtonId,
  type VmCollisionPair,
  type VmHostBridge,
} from './EventActionVm.ts';
import { JuiceSystem, stepSquashSpring } from './JuiceSystem.ts';
import {
  BM_MOVING_PLATFORM,
  BM_ORBIT,
  BM_PATROL,
  BM_PLATFORMER_CTRL,
  BM_TOPDOWN_MOVE,
  EF_ADDITIVE,
  EF_ALIVE,
  EF_BOSS,
  EF_BOUNCY,
  EF_BULLET,
  EF_COLLECTIBLE,
  EF_EMISSIVE,
  EF_ENEMY,
  EF_FACING_LEFT,
  EF_FLIP_X,
  EF_GRAVITY,
  EF_HAZARD,
  EF_ONE_WAY,
  EF_PICKUP,
  EF_PIERCING,
  EF_PLAYER,
  EF_SOLID,
  EF_STOMPABLE,
  EF_WEAK_POINT,
  MAX_ENTITIES,
  SoaEntityPool,
} from './SoaEntityPool.ts';
import {
  CHUNK_SHIFT,
  CHUNK_SIZE,
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
  type TileAabbStepResult,
} from './TilemapGrid.ts';

interface RuntimeArchetype {
  id: string;
  def: CartridgeArchetypeDef;
  flags: number;
  behaviorMask: number;
  scoreValue: number;
  dropKind?: string;
}

interface RuntimeSnapshotBank {
  snapshot: RenderSceneSnapshot;
  stageInfo: StageProgressInfo;
  viewport: { width: number; height: number };
  tileSlots: TileDesc[];
  fgTileSlots: TileDesc[];
  entitySlots: EntityDesc[];
  lightSlots: LightDesc[];
  debugRectSlots: DebugRectDesc[];
  tiles: TileDesc[];
  fgTiles: TileDesc[];
  entities: EntityDesc[];
  particles: ParticleDesc[];
  lights: LightDesc[];
  debugRects: DebugRectDesc[];
}

function createRuntimeBank(cartridgeId: string, vp: LogicalViewport): RuntimeSnapshotBank {
  const viewport = { width: vp.width, height: vp.height };
  const stageInfo: StageProgressInfo = { index: 1, total: 1, name: '' };
  const tiles: TileDesc[] = [];
  const fgTiles: TileDesc[] = [];
  const entities: EntityDesc[] = [];
  const particles: ParticleDesc[] = [];
  const lights: LightDesc[] = [];
  const debugRects: DebugRectDesc[] = [];
  return {
    viewport,
    stageInfo,
    tileSlots: [],
    fgTileSlots: [],
    entitySlots: [],
    lightSlots: [],
    debugRectSlots: [],
    tiles,
    fgTiles,
    entities,
    particles,
    lights,
    debugRects,
    snapshot: {
      cartridgeId,
      skyTop: '#76c7ff',
      skyBottom: '#fff3df',
      cozyFilter: true,
      glowIntensity: 1,
      paletteRow: 0,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 0,
      comboCount: 0,
      starsCollected: 0,
      starsTotal: 0,
      hasKey: false,
      hearts: 3,
      maxHearts: 3,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      cameraZoom: 1,
      viewport,
      ambientDarkness: 0,
      ambientColor: '#120e24',
      screenFlashAlpha: 0,
      screenFlashColor: '#fffaf0',
      bgStars: [],
      bgParallaxLayers: undefined,
      bgClouds: [],
      tiles,
      fgTiles: undefined,
      entities,
      particles,
      lights,
      debugRects: undefined,
      statusBanner: '',
      stage: stageInfo,
      bgmTheme: undefined,
      shmupHud: undefined,
    },
  };
}

function acquireTileSlot(pool: TileDesc[], idx: number): TileDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { sprite: 'stone', x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };
    pool[idx] = slot;
  }
  return slot;
}

function acquireEntitySlot(pool: EntityDesc[], idx: number): EntityDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { id: '', sprite: 'star_a', x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };
    pool[idx] = slot;
  }
  return slot;
}

function acquireLightSlot(pool: LightDesc[], idx: number): LightDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, radius: 24, color: '#ffd447', intensity: 0.4 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireDebugRectSlot(pool: DebugRectDesc[], idx: number): DebugRectDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE, color: '#56d39c' };
    pool[idx] = slot;
  }
  return slot;
}

const STARFIELD_PALETTE = ['#fffaf0', '#ffd447', '#5ec2f7', '#ff8ec6', '#e0aaff'] as const;
const MAX_VM_COLLISION_PAIRS = 256;
const HERO_HB = { x: 2, y: 2, w: 12, h: 14 };

function compileTagsToFlags(tags: readonly CartridgeTag[]): number {
  let f = EF_ALIVE;
  for (let i = 0; i < tags.length; i++) {
    switch (tags[i]) {
      case 'player': f |= EF_PLAYER; break;
      case 'solid': f |= EF_SOLID; break;
      case 'oneway': f |= EF_ONE_WAY; break;
      case 'hazard': f |= EF_HAZARD; break;
      case 'collectible': f |= EF_COLLECTIBLE; break;
      case 'stompable': f |= EF_STOMPABLE; break;
      case 'bouncy': f |= EF_BOUNCY; break;
      case 'gravity': f |= EF_GRAVITY; break;
      case 'enemy': f |= EF_ENEMY; break;
      case 'boss': f |= EF_BOSS; break;
      case 'weak_point': f |= EF_WEAK_POINT; break;
      case 'bullet': f |= EF_BULLET; break;
      case 'enemy_bullet': f |= EF_BULLET | EF_ENEMY; break;
      case 'pickup': f |= EF_PICKUP; break;
      case 'funnel': f |= EF_ALIVE; break;
    }
  }
  return f;
}

/**
 * Unified Zero-GC data-driven cartridge runtime executing validated CartridgeJsonV1 files.
 * Unifies platformer and arcade shooter simulations through SoaEntityPool, TilemapGrid, and EventActionVm.
 */
export class DataCartridgeRuntime implements DebuggableCartridge, ComboTrackingCartridge, ShmupRuntimeContext {
  public readonly scriptError: string | null = null;
  public readonly def: CartridgeJsonV1;
  public readonly pool = new SoaEntityPool();
  public readonly input = new InputMap();
  public readonly juice = new JuiceSystem();
  public readonly rng = new SeededRng(0x20260002);
  public readonly vm = new EventActionVm();
  public readonly lastHitGroupByTarget = new Int32Array(MAX_ENTITIES);

  private readonly archetypes: RuntimeArchetype[] = [];
  private readonly archetypeIdxById = new Map<string, number>();
  public readonly archetypeMetaByIdx: { id: string; scoreValue: number; dropKind?: string }[] = [];

  private tilemap = new TilemapGrid(46, 12);
  private fgTilemap = new TilemapGrid(46, 12);
  private hasFgTilemapTiles = false;
  private readonly tileSpriteLut: (SpriteId | undefined)[] = [];
  private readonly fgSpriteLut: (SpriteId | undefined)[] = [];
  private readonly fgAlphaLut = new Float32Array(256).fill(1);
  private readonly fgExtraTiles: TileDesc[] = [];
  private readonly bgParallaxLayers: BgParallaxLayerDesc[] = [];
  private stageWorldW = GAME_W;
  private stageWorldH = GAME_H;
  private bgClouds: BgCloudDesc[] = [];
  private bgStars: BgStarDesc[] = [];

  public stageIdx = 0;
  public playerSlot = -1;
  public bossSlot = -1;
  public hearts = 3;
  public maxHearts = 3;
  public score = 0;
  public starsCollected = 0;
  public elapsedSec = 0;
  public status: 'playing' | 'won' | 'lost' = 'playing';
  public statusBanner = '';
  public noticeTimer = 0;
  public debugHitboxes = false;

  // Platformer state
  private cameraX = 0;
  private cameraY = 0;
  private cameraZoom = 1.0;
  private stageViewport: LogicalViewport = { width: GAME_W, height: GAME_H };
  private scoutMode = false;
  private hasKey = false;
  private stageHasKey = false;
  private gateUnlocked = false;
  private bestStarsByStage: number[] = [];
  private stageStarsTotal = 0;
  private stageStarsCollected = 0;
  private totalCampaignStars = 0;
  private checkpointX = 24;
  private checkpointY = 120;
  private coyote = 0;
  private airJumpsLeft = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private pulseCooldown = 0;
  private invulnTimer = 0;
  private walkAnim = 0;
  private relics = { doubleJump: false, airDash: false };
  private heroSquash = { scaleX: 1, scaleY: 1 };
  private readonly aabbRes: TileAabbStepResult = { onGround: false, hitWall: false, hitCeiling: false, hitHazard: false, landVy: 0 };

  // Shmup state
  public readonly shmup: RuntimeShmupState;

  // Pre-allocated snapshot, spatial query & VM buffers (Zero-GC)
  private readonly eventsOut: SimEvent[] = [];
  private readonly platformerQuerySlots = new Int32Array(MAX_ENTITIES);
  private readonly entityIdCache: string[] = new Array<string>(MAX_ENTITIES);
  private readonly entityIdArchIdx = new Int16Array(MAX_ENTITIES).fill(-2);
  private snapshotBankIdx: 0 | 1 = 0;
  private readonly snapshotBanks: [RuntimeSnapshotBank, RuntimeSnapshotBank];
  private readonly vmCollisions: VmCollisionPair[] = Array.from({ length: MAX_VM_COLLISION_PAIRS }, () => ({
    selfSlot: -1, otherSlot: -1, selfTag: '', otherTag: '',
  }));
  private vmCollisionCount = 0;

  private readonly vmHost: VmHostBridge = {
    isButton: (b: VmButtonId, edge: VmButtonEdge) =>
      edge === 'held' ? this.input.held(b) : edge === 'released' ? this.input.justReleased(b) : this.input.justPressed(b),
    spawn: (aid, anchor, x, y, vx, vy, selfSlot, otherSlot) => {
      let bx = 0;
      let by = 0;
      if (anchor === 'player' && this.playerSlot >= 0) {
        bx = this.pool.x[this.playerSlot];
        by = this.pool.y[this.playerSlot];
      } else if (anchor === 'self' && selfSlot >= 0) {
        bx = this.pool.x[selfSlot];
        by = this.pool.y[selfSlot];
      } else if (anchor === 'other' && otherSlot >= 0) {
        bx = this.pool.x[otherSlot];
        by = this.pool.y[otherSlot];
      }
      this.spawnArchetype(aid, bx + x, by + y, vx, vy);
    },
    destroy: (target, tag, selfSlot, otherSlot) => {
      if (target === 'self' && selfSlot >= 0) this.pool.free(selfSlot);
      else if (target === 'other' && otherSlot >= 0) this.pool.free(otherSlot);
      else if (target === 'byTag' && tag) {
        for (let i = this.pool.activeCount - 1; i >= 0; i--) {
          const s = this.pool.activeIndices[i];
          const aid = this.pool.archetypeIdx[s] >= 0 ? this.archetypeMetaByIdx[this.pool.archetypeIdx[s]].id : '';
          if (aid === tag) this.pool.free(s);
        }
      }
    },
    impulse: (target, vx, vy, setVel, selfSlot, otherSlot) => {
      const slot = target === 'player' ? this.playerSlot : target === 'other' ? otherSlot : selfSlot;
      if (slot < 0) return;
      if (setVel) {
        this.pool.vx[slot] = vx;
        this.pool.vy[slot] = vy;
      } else {
        this.pool.vx[slot] += vx;
        this.pool.vy[slot] += vy;
      }
    },
    playSfx: (preset) => {
      this.eventsOut.push(preset);
    },
    triggerJuice: (act) => {
      if (act.preset) this.juice.applyPreset(act.preset);
      if (act.hitstopFrames) this.juice.triggerHitstop(act.hitstopFrames / 60);
      if (act.trauma) this.juice.addTrauma(act.trauma);
      if (act.flashColor) this.juice.triggerFlash(act.flashColor, act.flashAlpha ?? 0.25);
      if (act.squashX && act.squashY) {
        this.heroSquash.scaleX = act.squashX;
        this.heroSquash.scaleY = act.squashY;
      }
    },
    endGame: (outcome, targetStage) => {
      if (outcome === 'nextStage') {
        const next = targetStage ?? this.stageIdx + 1;
        if (next < this.def.stages.length) this.enterStage(next);
        else this.status = 'won';
      } else {
        this.status = outcome;
      }
    },
  };

  constructor(
    rawJson: unknown,
    opts?: { initialStage?: number; initialFighter?: string; skipHangar?: boolean },
  ) {
    const validated = validateCartridgeJson(rawJson);
    if (!validated.ok) {
      throw new Error(`Invalid Cartridge JSON: ${validated.errors.join('; ')}`);
    }
    this.def = validated.data;
    this.stageViewport = resolveLogicalViewport(this.def.meta.viewport);
    this.snapshotBanks = [
      createRuntimeBank(this.def.meta.id, this.stageViewport),
      createRuntimeBank(this.def.meta.id, this.stageViewport),
    ];
    this.maxHearts = this.def.player.maxHearts;
    this.hearts = this.maxHearts;

    for (const [id, def] of Object.entries(this.def.archetypes)) {
      const idx = this.archetypes.length;
      let bm = 0;
      if (def.behavior?.kind === 'patrol') bm |= BM_PATROL;
      else if (def.behavior?.kind === 'orbit') bm |= BM_ORBIT;
      this.archetypes.push({
        id,
        def,
        flags: compileTagsToFlags(def.tags),
        behaviorMask: bm,
        scoreValue: def.scoreValue ?? 75,
        dropKind: def.dropTable?.onDestroyKind,
      });
      this.archetypeIdxById.set(id, idx);
      this.archetypeMetaByIdx.push({ id, scoreValue: def.scoreValue ?? 75, dropKind: def.dropTable?.onDestroyKind });
    }

    let totalStars = 0;
    this.bestStarsByStage = this.def.stages.map((st) => {
      let c = 0;
      for (const sp of st.spawns ?? []) if (sp.archetype === 'star') c++;
      totalStars += c;
      return 0;
    });
    this.totalCampaignStars = totalStars;

    const cachedFighters: ShmupFighterSummary[] = (this.def.player.loadouts ?? []).map((f) => ({
      id: f.id, name: f.name, code: f.code, tagline: f.tagline,
      speedStat: f.speedStat, armorStat: f.armorStat, fireStat: f.fireStat,
      ultLabel: f.ultLabel, accentHex: f.accentHex,
    }));

    const firstLoadout = this.def.player.loadouts?.[0];
    this.shmup = {
      phase: this.def.player.bootInHangar && !opts?.skipHangar ? 'hangar' : 'sortie',
      selectedLoadoutIdx: 0,
      fighterId: firstLoadout?.id ?? 'starfalcon',
      weaponKind: firstLoadout?.defaultWeapon ?? 'crimson',
      weaponLevel: 1,
      bombs: firstLoadout?.initialBombs ?? 2,
      maxBombs: this.def.player.bomb?.maxBombs ?? 4,
      funnelCount: firstLoadout?.initialFunnels ?? 0,
      chargeSec: 0,
      funnelOverdriveTimer: 0,
      overdriveShieldTimer: 0,
      grazeCount: 0,
      grazeMeter: 0,
      shootCooldown: 0,
      invulnTimer: 0,
      waveIndex: 0,
      waveTimer: 0,
      thrusterTimer: 0,
      chargeParticleTimer: 0,
      hangarNavCooldown: 0,
      nextPierceGroup: 1,
      squash: { scaleX: 1, scaleY: 1 },
      funnelSlots: new Int16Array(4).fill(-1),
      cachedFighters,
      targetHash: new SpatialHash(MAX_ENTITIES, 24, 4096, MAX_ENTITIES * 4, 36),
      targetEnemySlots: new Uint16Array(MAX_ENTITIES),
      playerBulletSlots: new Uint16Array(MAX_ENTITIES),
      querySlots: new Int32Array(MAX_ENTITIES),
    };

    const starCount = this.def.stages[0]?.bgStarsCount ?? 0;
    for (let i = 0; i < starCount; i++) {
      this.bgStars.push({
        x: (i * 59 + 17) % GAME_W,
        y: (i * 37 + 11) % GAME_H,
        size: i % 4 === 0 ? 2 : 1,
        phase: i * 0.7,
        color: STARFIELD_PALETTE[i % STARFIELD_PALETTE.length],
      });
    }

    if (this.def.player.controller === 'shmup') {
      applyShmupLoadout(this, opts?.initialFighter ?? this.shmup.fighterId);
      if (this.shmup.phase === 'hangar') {
        this.spawnPlayerAt(34, 84);
        this.statusBanner = '🛫 選擇出擊戰機：方向鍵切換 · 按 A 或點擊「出擊」升空！';
      } else {
        this.enterStage(opts?.initialStage ?? 0);
      }
    } else {
      this.enterStage(opts?.initialStage ?? 0);
    }
  }

  public getStageCount(): number {
    return this.def.stages.length;
  }

  public getStageIndex(): number {
    return this.stageIdx;
  }

  public getSectorIndex(): number {
    return this.stageIdx;
  }

  public getFighterId(): string {
    return this.shmup.fighterId;
  }

  public getWeaponKind(): string {
    return this.shmup.weaponKind;
  }

  public getWeaponLevel(): number {
    return this.shmup.weaponLevel;
  }

  public getBombCount(): number {
    return this.shmup.bombs;
  }

  public getChargeTier(): 0 | 1 | 2 {
    return getChargeTier(this.def, this.shmup.chargeSec);
  }

  public getActiveFunnelCount(): number {
    let c = 0;
    for (let i = 0; i < this.pool.activeCount; i++) {
      const s = this.pool.activeIndices[i];
      if ((this.pool.behaviorMask[s] & BM_ORBIT) !== 0) c++;
    }
    return c;
  }

  public loadStage(idx: number): void {
    this.enterStage(idx);
  }

  public enterSector(idx: number): void {
    this.shmup.phase = 'sortie';
    this.enterStage(idx);
  }

  public enterStage(idx: number): void {
    this.stageIdx = clamp(idx, 0, this.def.stages.length - 1);
    const st = this.def.stages[this.stageIdx];
    this.stageViewport = resolveLogicalViewport(st.viewport ?? this.def.meta.viewport);
    const worldH = st.worldHeight ?? this.stageViewport.height;
    this.stageWorldW = st.worldWidth;
    this.stageWorldH = worldH;

    this.pool.reset();
    this.lastHitGroupByTarget.fill(0);
    this.juice.reset();
    this.playerSlot = -1;
    this.bossSlot = -1;
    this.status = 'playing';
    this.scoutMode = false;
    this.cameraZoom = 1.0;
    this.hasKey = false;
    this.stageHasKey = false;
    this.gateUnlocked = false;
    this.stageStarsTotal = 0;
    this.stageStarsCollected = 0;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.pulseCooldown = 0;
    this.invulnTimer = 0;
    this.coyote = 0;
    this.airJumpsLeft = this.relics.doubleJump ? 1 : 0;
    this.statusBanner = st.hint;

    const cols = Math.ceil(st.worldWidth / TILE_SIZE);
    const rows = Math.ceil(worldH / TILE_SIZE);
    this.tilemap = new TilemapGrid(cols, rows);
    this.fgTilemap = new TilemapGrid(cols, rows);
    this.hasFgTilemapTiles = false;
    this.fgExtraTiles.length = 0;
    this.bgParallaxLayers.length = 0;

    this.tileSpriteLut.length = 0;
    this.fgSpriteLut.length = 0;
    this.fgAlphaLut.fill(1);
    this.tileSpriteLut[1] = st.groundTop ?? 'grass';
    this.tileSpriteLut[2] = st.groundFill ?? 'dirt';
    this.tileSpriteLut[3] = 'cloud_l';
    this.tileSpriteLut[4] = 'cloud_m';
    this.tileSpriteLut[5] = 'cloud_r';
    this.tileSpriteLut[6] = 'stone';
    this.fgSpriteLut[1] = 'tree_canopy';
    this.fgSpriteLut[2] = 'stone';
    this.fgSpriteLut[3] = 'cloud_m';

    if (st.tileGrid?.spriteMap) {
      for (const [k, sp] of Object.entries(st.tileGrid.spriteMap)) {
        const id = Number(k);
        if (Number.isInteger(id) && id > 0) {
          this.tileSpriteLut[id] = sp;
          this.fgSpriteLut[id] = sp;
        }
      }
    }

    if (st.tileChunks) {
      for (let ci = 0; ci < st.tileChunks.length; ci++) {
        const ch: CartridgeTileChunkDef = st.tileChunks[ci];
        const sm = ch.spriteMap;
        if (sm) {
          for (const k of Object.keys(sm)) {
            const sp = sm[k];
            const id = Number(k);
            if (Number.isInteger(id) && id > 0) {
              this.tileSpriteLut[id] = sp;
              this.fgSpriteLut[id] = sp;
            }
          }
        }
        const baseCol = ch.cx * CHUNK_SIZE;
        const baseRow = ch.cy * CHUNK_SIZE;
        for (let lr = 0; lr < CHUNK_SIZE; lr++) {
          const r = baseRow + lr;
          if (r >= rows) break;
          const rowOff = lr * CHUNK_SIZE;
          for (let lc = 0; lc < CHUNK_SIZE; lc++) {
            const c = baseCol + lc;
            if (c >= cols) break;
            const i = rowOff + lc;
            const tid = ch.tiles[i];
            const colKind = ch.collision[i];
            if (tid !== 0 || colKind !== 0) {
              this.tilemap.setTile(c, r, tid, colKind, false);
            }
            if (ch.fgTiles) {
              const ftid = ch.fgTiles[i];
              if (ftid !== 0) {
                this.fgTilemap.setTile(c, r, ftid, COLLISION_EMPTY, false);
                this.hasFgTilemapTiles = true;
              }
            }
          }
        }
      }
    }

    if (st.tileGrid) {
      for (let r = 0; r < st.tileGrid.rows && r < rows; r++) {
        for (let c = 0; c < st.tileGrid.cols && c < cols; c++) {
          const i = r * st.tileGrid.cols + c;
          const tid = st.tileGrid.tiles[i];
          const colKind = st.tileGrid.collision[i];
          if (tid !== 0 || colKind !== 0) {
            this.tilemap.setTile(c, r, tid, colKind, false);
          }
          if (st.tileGrid.fgTiles) {
            const ftid = st.tileGrid.fgTiles[i];
            if (ftid !== 0) {
              this.fgTilemap.setTile(c, r, ftid, COLLISION_EMPTY, false);
              this.hasFgTilemapTiles = true;
            }
          }
        }
      }
    } else if (!st.tileChunks) {
      for (const isl of st.islands ?? []) {
        const topRow = clamp(Math.round(isl.topY / TILE_SIZE), 0, rows - 1);
        const endC = Math.min(cols, isl.startTile + isl.countTiles);
        for (let c = Math.max(0, isl.startTile); c < endC; c++) {
          this.tilemap.setTile(c, topRow, 1, COLLISION_SOLID, false);
          for (let row = topRow + 1; row < rows; row++) {
            if (row * TILE_SIZE >= worldH) break;
            this.tilemap.setTile(c, row, 2, COLLISION_SOLID, false);
          }
        }
      }
      for (const cl of st.clouds ?? []) {
        const row = clamp(Math.round(cl.y / TILE_SIZE), 0, rows - 1);
        const startC = Math.round(cl.x / TILE_SIZE);
        for (let i = 0; i < cl.tilesWide; i++) {
          const tid = i === 0 ? 3 : i === cl.tilesWide - 1 ? 5 : 4;
          this.tilemap.setTile(startC + i, row, tid, COLLISION_CLOUD, false);
        }
      }
    }

    for (const fg of st.fgIslands ?? []) {
      const sprite: SpriteId = fg.sprite ?? 'tree_canopy';
      const alpha = fg.alpha ?? 1;
      let fgId = -1;
      for (let id = 1; id < 256; id++) {
        if (this.fgSpriteLut[id] === sprite && Math.abs(this.fgAlphaLut[id] - alpha) < 1e-4) {
          fgId = id;
          break;
        }
      }
      if (fgId < 0) {
        for (let id = 4; id < 256; id++) {
          if (this.fgSpriteLut[id] === undefined) {
            this.fgSpriteLut[id] = sprite;
            this.fgAlphaLut[id] = alpha;
            fgId = id;
            break;
          }
        }
      }
      const topRow = clamp(Math.round(fg.topY / TILE_SIZE), 0, rows - 1);
      const spanRows = clamp(Math.round(fg.rows ?? 1), 1, rows - topRow);
      const c0 = Math.max(0, fg.startTile);
      const c1 = Math.min(cols - 1, fg.startTile + fg.countTiles - 1);
      if (fgId > 0) {
        for (let r = topRow; r < topRow + spanRows; r++) {
          for (let c = c0; c <= c1; c++) {
            this.fgTilemap.setTile(c, r, fgId, COLLISION_EMPTY, false);
            this.hasFgTilemapTiles = true;
          }
        }
      } else {
        for (let r = topRow; r < topRow + spanRows; r++) {
          for (let c = c0; c <= c1; c++) {
            this.fgExtraTiles.push({
              sprite,
              x: c * TILE_SIZE,
              y: r * TILE_SIZE,
              w: TILE_SIZE,
              h: TILE_SIZE,
              alpha,
            });
          }
        }
      }
    }

    for (const ft of st.fgTiles ?? []) {
      this.fgExtraTiles.push({
        sprite: ft.sprite,
        x: ft.x,
        y: ft.y,
        w: ft.w ?? TILE_SIZE,
        h: ft.h ?? TILE_SIZE,
        tint: ft.tint,
        alpha: ft.alpha,
        flipX: ft.flipX,
        elevationZ: ft.elevationZ,
        sortY: ft.sortY,
      });
    }

    for (const ly of st.bgParallaxLayers ?? []) {
      this.bgParallaxLayers.push({ ...ly });
    }

    this.tilemap.recomputeAutoMask();
    if (this.hasFgTilemapTiles) {
      this.fgTilemap.recomputeAutoMask();
    }

    for (const mp of st.movingPlatforms ?? []) {
      const slot = this.spawnArchetype('moving_plat', mp.x, mp.y, mp.vx ?? 0, mp.vy ?? 0);
      if (slot >= 0) {
        this.pool.w[slot] = clamp(Math.round(mp.tilesWide), 2, 6) * TILE_SIZE;
        this.pool.h[slot] = 10;
        this.pool.behaviorMask[slot] |= BM_MOVING_PLATFORM;
        this.pool.paramA[slot] = mp.minX ?? mp.x;
        this.pool.paramB[slot] = mp.maxX ?? mp.x;
        this.pool.paramC[slot] = mp.minY ?? mp.y;
        this.pool.paramD[slot] = mp.maxY ?? mp.y;
      }
    }

    this.spawnPlayerAt(st.spawn.x, st.spawn.y);
    this.checkpointX = st.spawn.x;
    this.checkpointY = st.spawn.y;

    const maxCamX = Math.max(0, st.worldWidth - this.stageViewport.width);
    const maxCamY = Math.max(0, worldH - this.stageViewport.height);
    this.cameraX = clamp(st.spawn.x - this.stageViewport.width * 0.42, 0, maxCamX);
    this.cameraY = clamp(st.spawn.y - this.stageViewport.height * 0.55, 0, maxCamY);

    for (const sp of st.spawns ?? []) {
      const s = this.spawnArchetype(sp.archetype, sp.x, sp.y, sp.vx ?? 0, sp.vy ?? 0);
      if (s >= 0) {
        if (sp.hp !== undefined) {
          this.pool.hp[s] = sp.hp;
          this.pool.maxHp[s] = sp.hp;
        }
        if (sp.minX !== undefined) this.pool.paramA[s] = sp.minX;
        if (sp.maxX !== undefined) this.pool.paramB[s] = sp.maxX;
        if (sp.archetype === 'star') this.stageStarsTotal++;
        if (sp.archetype === 'key') this.stageHasKey = true;
        if ((this.pool.flags[s] & EF_BOSS) !== 0) this.bossSlot = s;
      }
    }
    if (!this.stageHasKey && !st.boss) this.gateUnlocked = true;

    this.bgClouds = st.bgClouds
      ? [...st.bgClouds]
      : (st.ambientDarkness ?? 0) > 0.3 || this.def.player.controller === 'shmup'
        ? []
        : [
            { x: 40, y: 34, scale: 1.1, speed: 6, tint: '#ffffff', alpha: 0.78 },
            { x: 190, y: 24, scale: 0.9, speed: 4, tint: '#fffaf0', alpha: 0.68 },
            { x: 350, y: 46, scale: 1.25, speed: 7, tint: '#ffffff', alpha: 0.72 },
            { x: 540, y: 28, scale: 1.0, speed: 5, tint: '#fffaf0', alpha: 0.76 },
          ];

    const combinedRules = [...(this.def.rules ?? []), ...(st.rules ?? [])];
    this.vm.loadRules(combinedRules, this.def.initialVars);

    if (this.def.player.controller === 'shmup') {
      this.shmup.waveIndex = 0;
      this.shmup.waveTimer = 0;
      syncFunnelSlots(this, 0);
      if (this.shmup.phase === 'sortie') {
        spawnShmupWaveFromJson(this);
      }
    }
  }

  private spawnPlayerAt(x: number, y: number): void {
    const slot = this.pool.alloc(x, y, this.def.player.w, this.def.player.h);
    if (slot < 0) return;
    this.playerSlot = slot;
    this.pool.flags[slot] |= EF_PLAYER;
    this.pool.behaviorMask[slot] |= this.def.player.controller === 'shmup' ? BM_TOPDOWN_MOVE : BM_PLATFORMER_CTRL;
    this.pool.pivotX[slot] = 0.5;
    this.pool.pivotY[slot] = this.def.player.controller === 'platformer' ? 1.0 : 0.5;
  }

  public spawnArchetype(archetypeId: string, x: number, y: number, vx = 0, vy = 0, parentSlot = -1): number {
    const idx = this.archetypeIdxById.get(archetypeId);
    if (idx === undefined) return -1;
    const arch = this.archetypes[idx];
    const slot = this.pool.alloc(x, y, arch.def.w, arch.def.h);
    if (slot < 0) return -1;
    this.pool.archetypeIdx[slot] = idx;
    this.pool.flags[slot] = arch.flags;
    this.pool.behaviorMask[slot] = arch.behaviorMask;
    this.pool.hp[slot] = arch.def.hp ?? 1;
    this.pool.maxHp[slot] = arch.def.hp ?? 1;
    this.pool.vx[slot] = vx !== 0 ? vx : arch.def.behavior?.speedX ?? 0;
    this.pool.vy[slot] = vy !== 0 ? vy : arch.def.behavior?.speedY ?? 0;
    this.pool.parentSlot[slot] = parentSlot;
    this.pool.paramA[slot] = x * 0.1; // phase seed
    this.pool.pivotX[slot] = 0.5;
    this.pool.pivotY[slot] = arch.def.castShadow ? 1.0 : 0.5;
    if (arch.def.paletteRow !== undefined) this.pool.paletteRow[slot] = arch.def.paletteRow;
    if (arch.def.emissive && arch.def.emissive > 0) this.pool.flags[slot] |= EF_EMISSIVE;
    return slot;
  }

  public setDebugHitboxes(enabled: boolean): void {
    this.debugHitboxes = enabled;
  }

  public getComboCount(): number {
    return this.juice.comboCount;
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    return this.status;
  }

  public prepareFixedStep(): void {
    this.pool.capturePrev();
  }

  public retryCurrentStage(): void {
    this.hearts = this.maxHearts;
    if (this.def.player.controller === 'shmup') {
      this.shmup.invulnTimer = 1.35;
      this.shmup.chargeSec = 0;
      this.shmup.funnelOverdriveTimer = 0;
      this.shmup.overdriveShieldTimer = 0;
      this.shmup.phase = 'sortie';
    }
    this.enterStage(this.stageIdx);
  }

  public retryStage(): void {
    this.retryCurrentStage();
  }

  public dispatchCommand(commandId: string): SimEvent[] {
    this.eventsOut.length = 0;
    if (this.def.player.controller !== 'shmup') return this.eventsOut;

    if (commandId.startsWith('select_fighter:')) {
      const id = commandId.slice('select_fighter:'.length);
      applyShmupLoadout(this, id);
      this.eventsOut.push('snap');
      return this.eventsOut;
    }
    if (commandId === 'launch_sortie') {
      if (this.shmup.phase === 'hangar') {
        this.score = 0;
        this.starsCollected = 0;
        this.elapsedSec = 0;
        this.shmup.phase = 'sortie';
        this.enterStage(0);
        this.eventsOut.push('key');
      }
      return this.eventsOut;
    }
    if (commandId === 'cycle_weapon') {
      const order: readonly ('crimson' | 'azure' | 'violet')[] = ['crimson', 'azure', 'violet'];
      this.shmup.weaponKind = order[(order.indexOf(this.shmup.weaponKind) + 1) % order.length];
      this.shmup.squash.scaleX = 1.2;
      this.shmup.squash.scaleY = 0.85;
      this.eventsOut.push('snap');
      return this.eventsOut;
    }
    if (commandId.startsWith('weapon:')) {
      const w = commandId.slice('weapon:'.length);
      if (w === 'crimson' || w === 'azure' || w === 'violet') {
        this.shmup.weaponKind = w;
        this.shmup.squash.scaleX = 1.2;
        this.shmup.squash.scaleY = 0.85;
        this.eventsOut.push('snap');
      }
      return this.eventsOut;
    }
    if (commandId === 'bomb') {
      triggerShmupBomb(this, this.eventsOut, {
        moveSpeed: 100, jumpPower: 240, gravityScale: 1, enemyCount: 3, sparkleDensity: 1, cozyFilter: 1, glowIntensity: 1, shakeScale: 1,
      });
      return this.eventsOut;
    }
    return this.eventsOut;
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    this.eventsOut.length = 0;
    this.input.update(rawInput, dt);
    const simDt = this.juice.advanceRealTime(dt, params.shakeScale);
    if (this.noticeTimer > 0) this.noticeTimer = Math.max(0, this.noticeTimer - dt);

    for (let i = 0; i < this.bgStars.length; i++) {
      const s = this.bgStars[i];
      s.x -= (s.size > 1 ? 36 : 19) * (1 + this.stageIdx * 0.15) * dt;
      if (s.x < 0) s.x += GAME_W;
    }
    for (let i = 0; i < this.bgClouds.length; i++) {
      const c = this.bgClouds[i];
      c.x -= c.speed * dt;
      if (c.x < -48) c.x += Math.max(GAME_W, this.stageWorldW) + 64;
    }

    // Decay visual flash timers across active entities
    for (let i = 0; i < this.pool.activeCount; i++) {
      const s = this.pool.activeIndices[i];
      if (this.pool.flash[s] > 0) this.pool.flash[s] = Math.max(0, this.pool.flash[s] - dt * 6);
    }

    if (this.def.player.controller === 'shmup') {
      if (simDt > 0 && this.shmup.phase === 'sortie') this.elapsedSec += simDt;
      stepShmupSystem(this, dt, simDt, this.eventsOut, params);
      this.vm.stepTick(this.vmHost, this.vmCollisions, 0);
      return this.eventsOut;
    }

    // Platformer step
    stepSquashSpring(this.heroSquash, dt, 14);
    if (this.input.justPressed('shoulderL')) {
      this.retryCurrentStage();
      this.eventsOut.push('snap');
      return this.eventsOut;
    }
    if (this.input.justPressed('skillX') && this.def.player.scoutZoom) {
      this.scoutMode = !this.scoutMode;
      this.eventsOut.push('snap');
    }
    const targetZoom = this.scoutMode ? (this.def.player.scoutZoom ?? 0.78) : 1.0;
    this.cameraZoom += (targetZoom - this.cameraZoom) * Math.min(1, dt * 8);

    if (simDt > 0 && this.status === 'playing' && this.playerSlot >= 0) {
      this.elapsedSec += simDt;
      this.stepPlatformer(simDt, params);
    }

    this.vm.stepTick(this.vmHost, this.vmCollisions, this.vmCollisionCount);
    this.vmCollisionCount = 0;
    return this.eventsOut;
  }

  private stepPlatformer(dt: number, params: RuntimeParams): void {
    const p = this.playerSlot;
    const pool = this.pool;
    const worldH = this.stageWorldH;

    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.dashCooldown > 0) this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    if (this.pulseCooldown > 0) this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);

    // 1. Controls & Physics
    const dir = this.input.axisX();
    if (this.dashTimer > 0) {
      this.dashTimer = Math.max(0, this.dashTimer - dt);
      pool.vy[p] = 0;
    } else if (dir !== 0) {
      if (dir < 0) pool.flags[p] |= EF_FACING_LEFT;
      else pool.flags[p] &= ~EF_FACING_LEFT;
      const targetVx = dir * params.moveSpeed;
      const accel = (pool.flags[p] & EF_FLIP_X) !== 0 ? 640 : 960;
      const onG = this.aabbRes.onGround;
      const a = onG ? 960 : accel;
      pool.vx[p] = pool.vx[p] < targetVx ? Math.min(targetVx, pool.vx[p] + a * dt) : Math.max(targetVx, pool.vx[p] - a * dt);
      this.walkAnim += dt * 9;
    } else {
      const decel = this.aabbRes.onGround ? 880 : 300;
      pool.vx[p] = pool.vx[p] > 0 ? Math.max(0, pool.vx[p] - decel * dt) : Math.min(0, pool.vx[p] + decel * dt);
    }

    if (this.aabbRes.onGround) this.airJumpsLeft = this.relics.doubleJump ? 1 : 0;
    if (this.input.justPressed('jump') || this.input.justPressed('up')) this.input.primeBuffer('jump', 0.13);
    this.coyote = this.aabbRes.onGround ? 0.11 : Math.max(0, this.coyote - dt);

    if (this.input.hasBuffered('jump') && this.coyote > 0) {
      this.input.consumeBuffer('jump');
      pool.vy[p] = -params.jumpPower;
      this.coyote = 0;
      this.heroSquash = { scaleX: 0.78, scaleY: 1.24 };
      this.eventsOut.push('jump');
      this.juice.spawnBurst(pool.x[p] + 8, pool.y[p] + 15, ['#fffaf0', '#56d39c'], 4, params.sparkleDensity);
    } else if (this.input.hasBuffered('jump') && this.relics.doubleJump && this.airJumpsLeft > 0 && !this.aabbRes.onGround) {
      this.input.consumeBuffer('jump');
      this.airJumpsLeft--;
      pool.vy[p] = -params.jumpPower * 0.94;
      this.dashTimer = 0;
      this.heroSquash = { scaleX: 0.74, scaleY: 1.28 };
      this.eventsOut.push('jump');
      this.juice.spawnBurst(pool.x[p] + 8, pool.y[p] + 15, ['#5ec2f7', '#fffaf0'], 7, params.sparkleDensity);
    }

    if (this.dashTimer <= 0 && !this.input.held('jump') && !this.input.held('up') && pool.vy[p] < -60) {
      pool.vy[p] *= 0.86;
    }
    if (this.dashTimer <= 0) {
      const apex = !this.aabbRes.onGround && Math.abs(pool.vy[p]) < 38 ? 0.56 : 1.0;
      pool.vy[p] = Math.min(340, pool.vy[p] + 590 * params.gravityScale * apex * dt);
    }

    const facingLeft = (pool.flags[p] & EF_FACING_LEFT) !== 0;
    const sign = facingLeft ? -1 : 1;
    if (facingLeft) pool.flags[p] |= EF_FLIP_X;
    else pool.flags[p] &= ~EF_FLIP_X;

    if (this.input.justPressed('action') || this.input.justPressed('shoulderR')) {
      if (this.relics.airDash && !this.aabbRes.onGround && this.dashCooldown <= 0) {
        this.dashTimer = 0.14;
        this.dashCooldown = 0.55;
        pool.vx[p] = sign * 235;
        pool.vy[p] = 0;
        this.heroSquash = { scaleX: 1.32, scaleY: 0.72 };
        this.eventsOut.push('snap');
      } else {
        const sp = this.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 7, sign * 155, -22);
        if (sp >= 0) pool.timerA[sp] = 0.42;
        this.heroSquash = { scaleX: 1.15, scaleY: 0.88 };
        this.eventsOut.push('ignite');
      }
    }
    if (this.input.justPressed('skillY') && this.pulseCooldown <= 0) {
      this.pulseCooldown = 0.36;
      const s1 = this.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 5, sign * 172, -46);
      const s2 = this.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 9, sign * 164, 8);
      if (s1 >= 0) pool.timerA[s1] = 0.48;
      if (s2 >= 0) pool.timerA[s2] = 0.48;
      this.eventsOut.push('ignite');
    }

    // 2. Tilemap O(1) resolution + moving platform ride
    const box = { x: pool.x[p], y: pool.y[p], vx: pool.vx[p], vy: pool.vy[p] };
    const wasOnGround = this.aabbRes.onGround;
    this.tilemap.resolveAabbMotion(box, HERO_HB.x, HERO_HB.y, HERO_HB.w, HERO_HB.h, dt, this.aabbRes);

    // Check moving platforms & step entities
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const s = pool.activeIndices[i];
      if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
      if ((pool.behaviorMask[s] & BM_MOVING_PLATFORM) !== 0) {
        const prevMpX = pool.x[s];
        const prevMpY = pool.y[s];
        pool.x[s] += pool.vx[s] * dt;
        pool.y[s] += pool.vy[s] * dt;
        if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
        else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
        if (pool.y[s] < pool.paramC[s]) { pool.y[s] = pool.paramC[s]; pool.vy[s] = Math.abs(pool.vy[s]); }
        else if (pool.y[s] > pool.paramD[s]) { pool.y[s] = pool.paramD[s]; pool.vy[s] = -Math.abs(pool.vy[s]); }

        const hbR = box.x + HERO_HB.x + HERO_HB.w;
        const hbL = box.x + HERO_HB.x;
        const hbBot = box.y + HERO_HB.y + HERO_HB.h;
        if (hbR > pool.x[s] && hbL < pool.x[s] + pool.w[s] && box.vy >= 0 && hbBot >= pool.y[s] - 2 && hbBot <= prevMpY + 8) {
          box.x += pool.x[s] - prevMpX;
          box.y = pool.y[s] - HERO_HB.y - HERO_HB.h;
          box.vy = 0;
          this.aabbRes.onGround = true;
        }
      } else if ((pool.behaviorMask[s] & BM_PATROL) !== 0) {
        pool.x[s] += pool.vx[s] * dt;
        if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
        else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
        if (pool.vx[s] < 0) pool.flags[s] |= EF_FLIP_X;
        else pool.flags[s] &= ~EF_FLIP_X;
      } else if ((pool.flags[s] & EF_BULLET) !== 0) {
        pool.x[s] += pool.vx[s] * dt;
        pool.y[s] += pool.vy[s] * dt;
        pool.vy[s] += 260 * dt;
        pool.timerA[s] -= dt;
        if (pool.timerA[s] <= 0) pool.free(s);
      }
    }

    pool.x[p] = box.x;
    pool.y[p] = box.y;
    pool.vx[p] = box.vx;
    pool.vy[p] = box.vy;
    pool.sx[p] = this.heroSquash.scaleX;
    pool.sy[p] = this.heroSquash.scaleY;
    pool.skewX[p] = Math.abs(pool.vx[p]) > 10 ? clamp(pool.vx[p] / 460, -0.24, 0.24) : 0;

    if (!wasOnGround && this.aabbRes.onGround && this.aabbRes.landVy > 95) {
      const amt = Math.min(0.28, (this.aabbRes.landVy / 320) * 0.28);
      this.heroSquash = { scaleX: 1 + amt, scaleY: 1 - amt * 0.9 };
    }

    // 3. Abyss rescue
    if (pool.y[p] > worldH + 18) {
      this.hearts--;
      this.eventsOut.push('hurt');
      this.juice.applyPreset('player_hurt');
      if (this.hearts <= 0) {
        this.status = 'lost';
        return;
      }
      pool.teleport(p, this.checkpointX, this.checkpointY);
      pool.vx[p] = 0;
      pool.vy[p] = 0;
      this.invulnTimer = 1.25;
    }

    // 4. SpatialHash broad-phase O(1) Entity Interactions & VM collision recording
    pool.rebuildSpatialHash();
    const hcx = pool.x[p] + 8;
    const hcy = pool.y[p] + 8;
    const candCount = pool.queryRect(hcx - 76, hcy - 76, hcx + 76, hcy + 76, this.platformerQuerySlots);
    for (let i = 1; i < candCount; i++) {
      const key = this.platformerQuerySlots[i];
      const keyPos = pool.getActivePos(key);
      let j = i - 1;
      while (j >= 0 && pool.getActivePos(this.platformerQuerySlots[j]) < keyPos) {
        this.platformerQuerySlots[j + 1] = this.platformerQuerySlots[j];
        j--;
      }
      this.platformerQuerySlots[j + 1] = key;
    }

    for (let i = 0; i < candCount; i++) {
      const s = this.platformerQuerySlots[i];
      if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
      const archIdx = pool.archetypeIdx[s];
      const meta = archIdx >= 0 ? this.archetypeMetaByIdx[archIdx] : undefined;
      const aid = meta?.id ?? '';
      const f = pool.flags[s];
      const ecx = pool.x[s] + pool.w[s] * 0.5;
      const ecy = pool.y[s] + pool.h[s] * 0.5;
      const dist = Math.hypot(hcx - ecx, hcy - ecy);

      if ((f & EF_COLLECTIBLE) !== 0 && dist < 14) {
        pool.free(s);
        this.juice.registerCombo();
        if (aid === 'star') {
          this.stageStarsCollected++;
          if (this.stageStarsCollected > this.bestStarsByStage[this.stageIdx]) {
            this.bestStarsByStage[this.stageIdx] = this.stageStarsCollected;
          }
          this.score += 100;
          this.eventsOut.push('star');
        } else if (aid === 'key') {
          this.hasKey = true;
          this.gateUnlocked = true;
          this.score += 150;
          this.eventsOut.push('key');
        } else {
          const arch = archIdx >= 0 ? this.archetypes[archIdx].def : undefined;
          if (arch?.relicGrant === 'doubleJump') {
            this.relics.doubleJump = true;
            this.airJumpsLeft = 1;
          } else if (arch?.relicGrant === 'airDash') {
            this.relics.airDash = true;
          }
          this.score += meta?.scoreValue ?? 50;
          this.eventsOut.push('star');
        }
        this.juice.spawnBurst(ecx, ecy, ['#ffd447', '#fffaf0', '#ff708d'], 8, params.sparkleDensity);
      } else if (aid === 'checkpoint_flag' && dist < 18 && pool.aiState[s] === 0) {
        pool.aiState[s] = 1;
        this.checkpointX = pool.x[s];
        this.checkpointY = pool.y[s] - 4;
        this.eventsOut.push('key');
      } else if ((f & EF_BOUNCY) !== 0 && dist < 15 && pool.vy[p] >= -20) {
        pool.vy[p] = -(this.archetypes[archIdx]?.def.bounceVy ?? 315);
        this.heroSquash = { scaleX: 0.72, scaleY: 1.32 };
        this.eventsOut.push('bounce');
      } else if ((f & EF_STOMPABLE) !== 0 && dist < (pool.w[s] * 0.5 + 8)) {
        if (pool.vy[p] > 35 && pool.y[p] + 12 < pool.y[s] + pool.h[s] * 0.65) {
          pool.vy[p] = -215;
          pool.hp[s] -= 1;
          pool.flash[s] = 0.22;
          this.juice.triggerHitstop(0.035);
          this.juice.addTrauma(0.24);
          this.eventsOut.push('stomp');
          if (pool.hp[s] <= 0) {
            const wasBoss = (f & EF_BOSS) !== 0;
            pool.free(s);
            this.score += meta?.scoreValue ?? 120;
            if (wasBoss) {
              this.bossSlot = -1;
              this.gateUnlocked = true;
              this.eventsOut.push('explode');
            }
          }
        } else if (this.invulnTimer <= 0) {
          this.hearts--;
          this.invulnTimer = 1.25;
          pool.flash[p] = 0.35;
          this.eventsOut.push('hurt');
          this.juice.applyPreset('player_hurt');
          if (this.hearts <= 0) this.status = 'lost';
        }
      } else if (aid === 'gate' && this.gateUnlocked && dist < 16) {
        if (this.stageIdx + 1 < this.def.stages.length) {
          this.hearts = Math.min(this.maxHearts, this.hearts + 1);
          this.enterStage(this.stageIdx + 1);
          this.juice.triggerFlash('#fffaf0', 0.25);
          this.eventsOut.push('key');
          return;
        } else {
          this.status = 'won';
          this.eventsOut.push('win');
        }
      }

      if (this.vmCollisionCount < MAX_VM_COLLISION_PAIRS && dist < 16) {
        const cp = this.vmCollisions[this.vmCollisionCount++];
        cp.selfSlot = p;
        cp.otherSlot = s;
        cp.selfTag = 'player';
        cp.otherTag = aid;
      }
    }

    // 5. Camera track
    const zoom = Math.max(0.5, this.cameraZoom);
    const viewW = this.stageViewport.width / zoom;
    const viewH = this.stageViewport.height / zoom;
    const maxCamX = Math.max(0, this.stageWorldW - viewW);
    const maxCamY = Math.max(0, this.stageWorldH - viewH);
    const desiredCamX = clamp(pool.x[p] - viewW * 0.42, 0, maxCamX);
    const desiredCamY = clamp(pool.y[p] - viewH * 0.55, 0, maxCamY);
    const camAlpha = Math.min(1, dt * 8);
    this.cameraX += (desiredCamX - this.cameraX) * camAlpha;
    this.cameraY += (desiredCamY - this.cameraY) * camAlpha;
  }

  public serializeSave(): unknown {
    if (this.def.player.controller === 'shmup') {
      return {
        v: 3,
        sectorIdx: this.stageIdx,
        score: this.score,
        starsCollected: this.starsCollected,
        fighterId: this.shmup.fighterId,
        hearts: this.hearts,
        weaponKind: this.shmup.weaponKind,
        weaponLevel: this.shmup.weaponLevel,
        bombs: this.shmup.bombs,
        funnelCount: this.shmup.funnelCount,
        grazeCount: this.shmup.grazeCount,
        grazeMeter: this.shmup.grazeMeter,
      };
    }
    return {
      v: 1,
      stageIdx: this.stageIdx,
      score: this.score,
      hearts: this.hearts,
      relics: { ...this.relics },
      bestStarsByStage: [...this.bestStarsByStage],
    };
  }

  public hydrateSave(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as Record<string, unknown>;
    if (this.def.player.controller === 'shmup') {
      if ((s.v !== 1 && s.v !== 2 && s.v !== 3) || typeof s.sectorIdx !== 'number') return false;
      applyShmupLoadout(this, typeof s.fighterId === 'string' ? s.fighterId : this.shmup.fighterId);
      this.score = Number(s.score ?? 0);
      this.starsCollected = Number(s.starsCollected ?? 0);
      this.hearts = clamp(Number(s.hearts ?? this.maxHearts), 1, this.maxHearts);
      if (s.weaponKind === 'crimson' || s.weaponKind === 'azure' || s.weaponKind === 'violet') {
        this.shmup.weaponKind = s.weaponKind;
      }
      this.shmup.weaponLevel = clamp(Number(s.weaponLevel ?? 1), 1, 3) as 1 | 2 | 3;
      this.shmup.bombs = clamp(Number(s.bombs ?? 2), 0, this.shmup.maxBombs);
      this.shmup.funnelCount = clamp(Number(s.funnelCount ?? 0), 0, 4);
      this.shmup.grazeCount = Number(s.grazeCount ?? 0);
      this.shmup.grazeMeter = clamp(Number(s.grazeMeter ?? 0), 0, 99);
      this.shmup.phase = 'sortie';
      this.enterStage(s.sectorIdx);
      return true;
    }

    if (s.v !== 1 || typeof s.stageIdx !== 'number') return false;
    this.score = Number(s.score ?? 0);
    this.hearts = clamp(Number(s.hearts ?? this.maxHearts), 1, this.maxHearts);
    const rel = s.relics as { doubleJump?: boolean; airDash?: boolean } | undefined;
    this.relics = { doubleJump: Boolean(rel?.doubleJump), airDash: Boolean(rel?.airDash) };
    const savedBest = s.bestStarsByStage;
    if (Array.isArray(savedBest)) {
      this.bestStarsByStage = this.def.stages.map((_, i) => Number(savedBest[i] ?? 0));
    }
    this.enterStage(s.stageIdx);
    return true;
  }

  private getEntityId(slot: number, archIdx: number): string {
    if (this.entityIdArchIdx[slot] === archIdx) {
      return this.entityIdCache[slot];
    }
    const prefix = archIdx >= 0 ? (this.archetypeMetaByIdx[archIdx]?.id ?? 'e') : 'e';
    const id = `${prefix}-${slot}`;
    this.entityIdArchIdx[slot] = archIdx;
    this.entityIdCache[slot] = id;
    return id;
  }

  public snapshot(params: RuntimeParams, alpha = 1): RenderSceneSnapshot {
    const bankIdx = this.snapshotBankIdx;
    this.snapshotBankIdx = bankIdx === 0 ? 1 : 0;
    const bank = this.snapshotBanks[bankIdx];

    const outTiles = bank.tiles;
    const outFgTiles = bank.fgTiles;
    const outEntities = bank.entities;
    const outLights = bank.lights;
    outTiles.length = 0;
    outFgTiles.length = 0;
    outEntities.length = 0;
    outLights.length = 0;

    const st = this.def.stages[this.stageIdx];
    const t = this.juice.visualTime;
    const glow = params.glowIntensity;
    const isShmup = this.def.player.controller === 'shmup';
    const loadout = isShmup ? getActiveLoadout(this.def, this.shmup.fighterId) : undefined;
    const camZoom = isShmup ? 1.0 : this.cameraZoom;
    const camX = this.cameraX + this.juice.shakeX + this.juice.kickX;
    const camY = this.cameraY + this.juice.shakeY + this.juice.kickY;
    const safeZoom = Math.max(0.5, camZoom);
    const viewW = this.stageViewport.width / safeZoom;
    const viewH = this.stageViewport.height / safeZoom;
    const margin = 96 / safeZoom;
    const visMinX = camX - margin;
    const visMinY = camY - margin;
    const visMaxX = camX + viewW + margin;
    const visMaxY = camY + viewH + margin;

    let tileSlotCount = 0;
    const midChunks = this.tilemap.updateActiveChunks(visMinX, visMinY, visMaxX, visMaxY, 0);
    for (let ci = 0; ci < midChunks; ci++) {
      const slot = this.tilemap.activeChunkIds[ci];
      const baseCol = this.tilemap.activeChunkCols[ci] << CHUNK_SHIFT;
      const baseRow = this.tilemap.activeChunkRows[ci] << CHUNK_SHIFT;
      const baseSlab = slot << 8;
      for (let lr = 0; lr < CHUNK_SIZE; lr++) {
        const y = (baseRow + lr) * TILE_SIZE;
        if (y + TILE_SIZE < visMinY || y > visMaxY) continue;
        const h = Math.min(TILE_SIZE, Math.max(1, this.stageWorldH - y));
        const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
        for (let lc = 0; lc < CHUNK_SIZE; lc++) {
          const tid = this.tilemap.tilesSlab[rowSlab | lc];
          if (tid === 0) continue;
          const x = (baseCol + lc) * TILE_SIZE;
          if (x + TILE_SIZE < visMinX || x > visMaxX) continue;
          const dst = acquireTileSlot(bank.tileSlots, tileSlotCount++);
          dst.sprite = this.tileSpriteLut[tid] ?? 'stone';
          dst.x = x;
          dst.y = y;
          dst.w = TILE_SIZE;
          dst.h = h;
          dst.tint = undefined;
          dst.unlockable = undefined;
          dst.extrudeH = undefined;
          dst.extrudeAtY = undefined;
          dst.wallColor = undefined;
          dst.wallMaterial = undefined;
          dst.elevationZ = undefined;
          dst.sortY = undefined;
          dst.castShadow = undefined;
          dst.alpha = undefined;
          dst.flipX = undefined;
          outTiles.push(dst);
        }
      }
    }

    let fgSlotCount = 0;
    if (this.hasFgTilemapTiles) {
      const fgChunks = this.fgTilemap.updateActiveChunks(visMinX, visMinY, visMaxX, visMaxY, 0);
      for (let ci = 0; ci < fgChunks; ci++) {
        const slot = this.fgTilemap.activeChunkIds[ci];
        const baseCol = this.fgTilemap.activeChunkCols[ci] << CHUNK_SHIFT;
        const baseRow = this.fgTilemap.activeChunkRows[ci] << CHUNK_SHIFT;
        const baseSlab = slot << 8;
        for (let lr = 0; lr < CHUNK_SIZE; lr++) {
          const y = (baseRow + lr) * TILE_SIZE;
          if (y + TILE_SIZE < visMinY || y > visMaxY) continue;
          const h = Math.min(TILE_SIZE, Math.max(1, this.stageWorldH - y));
          const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
          for (let lc = 0; lc < CHUNK_SIZE; lc++) {
            const ftid = this.fgTilemap.tilesSlab[rowSlab | lc];
            if (ftid === 0) continue;
            const x = (baseCol + lc) * TILE_SIZE;
            if (x + TILE_SIZE < visMinX || x > visMaxX) continue;
            const dst = acquireTileSlot(bank.fgTileSlots, fgSlotCount++);
            dst.sprite = this.fgSpriteLut[ftid] ?? 'tree_canopy';
            dst.x = x;
            dst.y = y;
            dst.w = TILE_SIZE;
            dst.h = h;
            dst.tint = undefined;
            dst.unlockable = undefined;
            dst.extrudeH = undefined;
            dst.extrudeAtY = undefined;
            dst.wallColor = undefined;
            dst.wallMaterial = undefined;
            dst.elevationZ = undefined;
            dst.sortY = undefined;
            dst.castShadow = false;
            dst.alpha = this.fgAlphaLut[ftid];
            dst.flipX = undefined;
            outFgTiles.push(dst);
          }
        }
      }
    }
    for (let i = 0; i < this.fgExtraTiles.length; i++) {
      const ft = this.fgExtraTiles[i];
      if (ft.x + ft.w < visMinX || ft.x > visMaxX || ft.y + ft.h < visMinY || ft.y > visMaxY) continue;
      const dst = acquireTileSlot(bank.fgTileSlots, fgSlotCount++);
      dst.sprite = ft.sprite;
      dst.x = ft.x;
      dst.y = ft.y;
      dst.w = ft.w;
      dst.h = ft.h;
      dst.tint = ft.tint;
      dst.unlockable = undefined;
      dst.extrudeH = undefined;
      dst.extrudeAtY = undefined;
      dst.wallColor = undefined;
      dst.wallMaterial = undefined;
      dst.elevationZ = ft.elevationZ;
      dst.sortY = ft.sortY;
      dst.castShadow = false;
      dst.alpha = ft.alpha;
      dst.flipX = ft.flipX;
      outFgTiles.push(dst);
    }

    let bossHp = 0;
    let bossMaxHp = 0;
    let entSlotCount = 0;
    let lightSlotCount = 0;

    for (let i = 0; i < this.pool.activeCount; i++) {
      const s = this.pool.activeIndices[i];
      const f = this.pool.flags[s];
      if ((f & EF_ALIVE) === 0) continue;

      if ((f & EF_BOSS) !== 0) {
        bossHp = Math.max(0, this.pool.hp[s]);
        bossMaxHp = this.pool.maxHp[s];
      }

      const rx = this.pool.renderX(s, alpha);
      const ry = this.pool.renderY(s, alpha);
      const ew = this.pool.w[s];
      const eh = this.pool.h[s];

      if ((this.pool.behaviorMask[s] & BM_MOVING_PLATFORM) !== 0) {
        if (rx + ew < visMinX || rx > visMaxX || ry + 20 < visMinY || ry > visMaxY) continue;
        for (let tx = 0; tx < ew; tx += TILE_SIZE) {
          const dst = acquireTileSlot(bank.tileSlots, tileSlotCount++);
          dst.sprite = 'moving_plat';
          dst.x = rx + tx;
          dst.y = ry;
          dst.w = Math.min(TILE_SIZE, ew - tx);
          dst.h = 16;
          dst.tint = undefined;
          dst.unlockable = undefined;
          dst.extrudeH = 3;
          dst.extrudeAtY = ry + 6;
          dst.wallColor = '#344c66';
          dst.wallMaterial = 'timber';
          dst.elevationZ = undefined;
          dst.sortY = undefined;
          dst.castShadow = undefined;
          dst.alpha = undefined;
          dst.flipX = undefined;
          outTiles.push(dst);
        }
        continue;
      }

      const rrot = this.pool.renderRot(s, alpha);

      if (s === this.playerSlot) {
        const inv = isShmup ? this.shmup.invulnTimer : this.invulnTimer;
        const blink = inv > 0 && Math.floor(inv * 16) % 2 === 1;
        if (blink && this.pool.flash[s] <= 0) continue;

        let sprite: SpriteId = this.def.player.sprite;
        if (isShmup && loadout) {
          sprite = Math.floor(t * 12) % 2 === 0 ? loadout.spriteA : loadout.spriteB;
        } else if (!isShmup && this.def.player.spriteB) {
          const moving = Math.abs(this.pool.vx[s]) > 8 || !this.aabbRes.onGround;
          sprite = moving && Math.floor(this.walkAnim) % 2 === 1 ? this.def.player.spriteB : this.def.player.sprite;
        }

        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = isShmup ? 'ship' : 'hero';
        dst.sprite = sprite;
        dst.x = rx;
        dst.y = ry;
        dst.w = ew;
        dst.h = eh;
        dst.scaleX = this.pool.sx[s];
        dst.scaleY = this.pool.sy[s];
        dst.anchorY = isShmup ? 0.5 : 1;
        dst.skewX = this.pool.skewX[s];
        dst.rot = rrot;
        dst.flash = Math.min(1, this.pool.flash[s]);
        dst.flipX = (f & EF_FLIP_X) !== 0;
        dst.additive = undefined;
        dst.emissive = undefined;
        dst.tint = undefined;
        dst.alpha = undefined;
        dst.paletteRow = this.pool.paletteRow[s] || undefined;
        dst.elevationZ = undefined;
        dst.shadowOffsetY = undefined;
        dst.castShadow = !isShmup;
        dst.shadowRadius = 6;
        dst.sortY = undefined;
        outEntities.push(dst);

        if (glow > 0.05) {
          const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
          l.x = rx + 8;
          l.y = ry + 8;
          l.radius = isShmup ? 32 : 36;
          l.color = loadout?.accentHex ?? '#fff3d0';
          l.intensity = 0.35 * glow;
          l.falloffPower = undefined;
          outLights.push(l);
        }
        continue;
      }

      const archIdx = this.pool.archetypeIdx[s];
      const arch = archIdx >= 0 ? this.archetypes[archIdx] : undefined;
      const lr = arch?.def.light ? arch.def.light.radius : 0;
      const inLightFrustum =
        lr > 0 && glow > 0.05 && rx + ew + lr >= visMinX && rx - lr <= visMaxX && ry + eh + lr >= visMinY && ry - lr <= visMaxY;
      const inEntFrustum = rx + ew >= visMinX && rx <= visMaxX && ry + eh >= visMinY && ry <= visMaxY;
      if (!inEntFrustum && !inLightFrustum) continue;

      if (inEntFrustum) {
        let sprite: SpriteId = arch?.def.sprite ?? 'star_a';
        if (arch?.def.spriteB && Math.floor((t * (arch.def.animFps ?? 4) + this.pool.paramA[s]) % 2) === 1) {
          sprite = arch.def.spriteB;
        }
        if (arch?.id === 'checkpoint_flag' && this.pool.aiState[s] === 1) {
          sprite = 'flag_on';
        }
        if (arch?.id === 'gate' && this.gateUnlocked) {
          sprite = 'gate_open';
        }

        let tint = arch?.def.tint;
        if (arch?.id === 'cargo') {
          const cyc = Math.floor(t / 1.1) % 4;
          tint = cyc === 0 ? '#ff708d' : cyc === 1 ? '#5ec2f7' : cyc === 2 ? '#e0aaff' : '#ffd447';
        } else if (isShmup && (f & EF_BOSS) !== 0 && this.pool.aiState[s] === 2) {
          tint = Math.floor(t * 8) % 2 === 0 ? '#ff708d' : '#e0aaff';
        }

        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = this.getEntityId(s, archIdx);
        dst.sprite = sprite;
        dst.x = rx;
        dst.y = ry;
        dst.w = ew;
        dst.h = eh;
        dst.rot = rrot;
        dst.scaleX = this.pool.sx[s];
        dst.scaleY = this.pool.sy[s];
        dst.anchorY = isShmup ? 0.5 : 1;
        dst.skewX = undefined;
        dst.flash = Math.min(1, this.pool.flash[s] * 4);
        dst.flipX = (f & EF_FLIP_X) !== 0;
        dst.additive = (f & EF_ADDITIVE) !== 0;
        dst.emissive = (f & EF_EMISSIVE) !== 0 ? (arch?.def.emissive ?? ((f & EF_PIERCING) !== 0 ? 1.1 : 0.8)) : undefined;
        dst.tint = tint;
        dst.alpha = undefined;
        dst.paletteRow = this.pool.paletteRow[s] || undefined;
        dst.elevationZ = undefined;
        dst.shadowOffsetY = undefined;
        dst.castShadow = arch?.def.castShadow;
        dst.shadowRadius = ew * 0.36;
        dst.sortY = undefined;
        outEntities.push(dst);
      }

      if (inLightFrustum && arch?.def.light) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = rx + ew * 0.5;
        l.y = ry + eh * 0.5;
        l.radius = lr;
        l.color = arch.def.light.color;
        l.intensity = arch.def.light.intensity * glow;
        l.falloffPower = undefined;
        outLights.push(l);
      }
    }

    let debugRects: DebugRectDesc[] | undefined;
    if (this.debugHitboxes) {
      debugRects = bank.debugRects;
      debugRects.length = 0;
      let dCount = 0;
      const c0 = Math.max(0, Math.floor(visMinX / TILE_SIZE));
      const c1 = Math.min(this.tilemap.cols - 1, Math.floor(visMaxX / TILE_SIZE));
      const r0 = Math.max(0, Math.floor(visMinY / TILE_SIZE));
      const r1 = Math.min(this.tilemap.rows - 1, Math.floor(visMaxY / TILE_SIZE));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const colKind = this.tilemap.getCollision(c, r);
          if (colKind === COLLISION_EMPTY) continue;
          const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
          dr.x = c * TILE_SIZE;
          dr.y = r * TILE_SIZE;
          dr.w = TILE_SIZE;
          dr.h = colKind === COLLISION_CLOUD ? 10 : TILE_SIZE;
          dr.color = colKind === COLLISION_CLOUD ? '#5ec2f7' : '#56d39c';
          debugRects.push(dr);
        }
      }
      for (let i = 0; i < outEntities.length; i++) {
        const e = outEntities[i];
        const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
        dr.x = e.x;
        dr.y = e.y;
        dr.w = e.w;
        dr.h = e.h;
        dr.color = e.id === 'hero' || e.id === 'ship' ? '#ffd447' : '#e0aaff';
        debugRects.push(dr);
      }
    }

    bank.particles.length = 0;
    const jp = this.juice.particles;
    for (let i = 0; i < jp.length; i++) bank.particles.push(jp[i]);

    let totalCollected = 0;
    if (!isShmup) {
      for (let i = 0; i < this.def.stages.length; i++) {
        totalCollected += i === this.stageIdx ? Math.max(this.bestStarsByStage[i], this.stageStarsCollected) : this.bestStarsByStage[i];
      }
    } else {
      totalCollected = this.starsCollected;
    }

    bank.viewport.width = this.stageViewport.width;
    bank.viewport.height = this.stageViewport.height;
    bank.stageInfo.index = this.stageIdx + 1;
    bank.stageInfo.total = this.def.stages.length;
    bank.stageInfo.name = st.name;

    const snap = bank.snapshot;
    snap.cartridgeId = this.def.meta.id;
    snap.skyTop = st.skyTop;
    snap.skyBottom = st.skyBottom;
    snap.cozyFilter = params.cozyFilter > 0;
    snap.glowIntensity = glow;
    snap.paletteRow = st.paletteRow ?? this.def.meta.paletteRow ?? 0;
    snap.timeSec = t;
    snap.elapsedSec = this.elapsedSec;
    snap.status = this.status;
    snap.score = this.score;
    snap.comboCount = this.juice.comboCount;
    snap.starsCollected = totalCollected;
    snap.starsTotal = isShmup ? Math.max(12, totalCollected + 3) : this.totalCampaignStars;
    snap.hasKey = this.hasKey;
    snap.hearts = Math.max(0, this.hearts);
    snap.maxHearts = this.maxHearts;
    snap.bossHp = bossHp;
    snap.bossMaxHp = bossMaxHp;
    snap.cameraX = camX;
    snap.cameraY = camY;
    snap.cameraZoom = camZoom;
    snap.viewport = bank.viewport;
    snap.ambientDarkness = st.ambientDarkness ?? 0;
    snap.ambientColor = st.ambientColor ?? '#120e24';
    snap.screenFlashAlpha = this.juice.flashAlpha;
    snap.screenFlashColor = this.juice.flashColor;
    snap.bgStars = this.bgStars;
    snap.bgParallaxLayers = this.bgParallaxLayers.length > 0 ? this.bgParallaxLayers : undefined;
    snap.bgClouds = this.bgClouds;
    snap.tiles = outTiles;
    snap.fgTiles = outFgTiles.length > 0 ? outFgTiles : undefined;
    snap.entities = outEntities;
    snap.particles = bank.particles;
    snap.lights = outLights;
    snap.debugRects = debugRects;
    snap.statusBanner = this.statusBanner;
    snap.stage = bank.stageInfo;
    snap.bgmTheme = st.bgmTheme;
    snap.shmupHud = isShmup ? buildShmupHudFromPool(this) : undefined;
    return snap;
  }
}
