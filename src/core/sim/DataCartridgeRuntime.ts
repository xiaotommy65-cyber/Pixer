import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { GAME_H, GAME_W, resolveLogicalViewport, type LogicalViewport } from '../gpu/GpuTypes.ts';
import { InputMap } from '../input/InputMap.ts';
import { SpatialHash } from '../math/SpatialHash.ts';
import { stepSpringInto } from '../math/SpringDynamics.ts';
import { hasGridLineOfSight, raycastGrid2DInto } from '../math/Visibility2D.ts';
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
  type HudPrimitiveDesc,
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
import {
  acquireHudSlot,
  buildGenreHudPrimitives,
  createRuntimeGenreState,
  EF_FIGHTER_P2,
  EF_LOGIC_SWITCH,
  EF_PUSHABLE_CRATE,
  initGenreStageState,
  stepCardController,
  stepFighterController,
  stepTopdownController,
  type GenreRuntimeContext,
  type RuntimeGenreState,
} from './GenreControllers.ts';
import { JuiceSystem, stepSquashSpring } from './JuiceSystem.ts';
import { TweenSystem } from './TweenSystem.ts';
import {
  applyOklabParallaxFog,
  compileProceduralStage,
  resolveStageArtMood,
} from './ProceduralStageCompiler.ts';
import {
  BM_CHASE,
  BM_MOVING_PLATFORM,
  BM_ORBIT,
  BM_PATROL,
  BM_PLATFORMER_CTRL,
  BM_SIN_FLOAT,
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
  hudSlots: HudPrimitiveDesc[];
  tiles: TileDesc[];
  fgTiles: TileDesc[];
  entities: EntityDesc[];
  particles: ParticleDesc[];
  lights: LightDesc[];
  debugRects: DebugRectDesc[];
  hudPrimitives: HudPrimitiveDesc[];
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
  const hudPrimitives: HudPrimitiveDesc[] = [];
  return {
    viewport,
    stageInfo,
    tileSlots: [],
    fgTileSlots: [],
    entitySlots: [],
    lightSlots: [],
    debugRectSlots: [],
    hudSlots: [],
    tiles,
    fgTiles,
    entities,
    particles,
    lights,
    debugRects,
    hudPrimitives,
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
      hudPrimitives: undefined,
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
export const MAX_FLOATING_TEXTS = 24;
const HERO_HB = { x: 2, y: 2, w: 12, h: 14 };
const EF_GRAPPLE_TARGET = 1 << 23;
const EF_CRYSTAL_RESET = 1 << 24;
const RT_GRAPPLE_SHOOT_SPEED = 720;
const RT_AIM_ROT_SPEED = 28;
const RT_MAGNET_COS = Math.cos((26 * Math.PI) / 180);
const RT_GRAPPLE_LINKS = 5;

export interface FloatingTextSlot {
  active: boolean;
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

function wrapAimAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

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
      case 'grapple_ring': f |= EF_GRAPPLE_TARGET | EF_EMISSIVE; break;
      case 'zip_block': f |= EF_GRAPPLE_TARGET | EF_SOLID | EF_EMISSIVE; break;
      case 'crystal_reset': f |= EF_CRYSTAL_RESET | EF_EMISSIVE; break;
      case 'crumble_tile': f |= EF_SOLID; break;
      case 'updraft': f |= EF_EMISSIVE; break;
      case 'fighter_p2': f |= EF_ENEMY | EF_STOMPABLE | EF_FIGHTER_P2; break;
      case 'card_slot': f |= EF_EMISSIVE; break;
      case 'logic_switch': f |= EF_EMISSIVE | EF_LOGIC_SWITCH; break;
    }
  }
  return f;
}

/**
 * Unified Zero-GC data-driven cartridge runtime executing validated CartridgeJsonV1 files.
 * Unifies platformer and arcade shooter simulations through SoaEntityPool, TilemapGrid, and EventActionVm.
 */
export class DataCartridgeRuntime
  implements DebuggableCartridge, ComboTrackingCartridge, ShmupRuntimeContext, GenreRuntimeContext
{
  public readonly scriptError: string | null = null;
  public readonly def: CartridgeJsonV1;
  public readonly pool = new SoaEntityPool();
  public readonly input = new InputMap();
  public readonly juice = new JuiceSystem();
  public readonly rng = new SeededRng(0x20260002);
  public readonly vm = new EventActionVm();
  public readonly tweens = new TweenSystem();
  public readonly genre: RuntimeGenreState = createRuntimeGenreState();
  public readonly lastHitGroupByTarget = new Int32Array(MAX_ENTITIES);

  public readonly archetypes: RuntimeArchetype[] = [];
  private readonly archetypeIdxById = new Map<string, number>();
  public readonly archetypeMetaByIdx: { id: string; scoreValue: number; dropKind?: string }[] = [];

  public tilemap = new TilemapGrid(46, 12);
  private fgTilemap = new TilemapGrid(46, 12);
  private hasFgTilemapTiles = false;
  private readonly tileSpriteLut: (SpriteId | undefined)[] = [];
  private readonly fgSpriteLut: (SpriteId | undefined)[] = [];
  private readonly fgAlphaLut = new Float32Array(256).fill(1);
  private readonly fgExtraTiles: TileDesc[] = [];
  private readonly bgParallaxLayers: BgParallaxLayerDesc[] = [];
  public stageWorldW = GAME_W;
  public stageWorldH = GAME_H;
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
  private stageSkyTop = '#76c7ff';
  private stageSkyBottom = '#fff3df';
  private stageAmbientColor = '#120e24';
  public cameraX = 0;
  public cameraY = 0;
  private prevCameraX = 0;
  private prevCameraY = 0;
  private camVelX = 0;
  private camVelY = 0;
  private prevCamTargetX = 0;
  private prevCamTargetY = 0;
  private springCamFreq = 0;
  private springCamDamping = 1;
  private readonly camSpringOut = new Float64Array(2);
  public readonly isTileOpaque = (tx: number, ty: number): boolean => this.tilemap.getCollision(tx, ty) === COLLISION_SOLID;
  private readonly grappleEnabled: boolean;
  private readonly grappleMaxRange: number;
  private readonly grappleAttachWalls: boolean;
  private readonly grapplePullSpeed: number;
  private grappleState: 'idle' | 'shooting' | 'swinging' | 'pulling' = 'idle';
  private grappleMode: 'swing' | 'pull' = 'swing';
  private grappleAnchorX = 0;
  private grappleAnchorY = 0;
  private grappleTipX = 0;
  private grappleTipY = 0;
  private grappleRopeLength = 80;
  private grappleAimAngle = -0.7854;
  private grappleHoldViaInput = false;
  private grappleSwingElapsed = 0;
  private grapplePullElapsed = 0;
  private grapplePreviewKind: 'none' | 'wall' | 'ring' = 'none';
  private grapplePreviewX = 0;
  private grapplePreviewY = 0;
  private grappleTargetSlot = -1;
  private readonly grappleRayScratch = new Float64Array(8);
  private readonly grappleLinkIds = Array.from({ length: RT_GRAPPLE_LINKS }, (_, i) => `rt-glink-${i}`);
  public cameraZoom = 1.0;
  public stageViewport: LogicalViewport = { width: GAME_W, height: GAME_H };
  private scoutMode = false;
  public hasKey = false;
  public stageHasKey = false;
  public gateUnlocked = false;
  private bestStarsByStage: number[] = [];
  private stageStarsTotal = 0;
  public stageStarsCollected = 0;
  private totalCampaignStars = 0;
  public checkpointX = 24;
  public checkpointY = 120;
  private coyote = 0;
  private airJumpsLeft = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private pulseCooldown = 0;
  public invulnTimer = 0;
  public walkAnim = 0;
  private relics = { doubleJump: false, airDash: false };
  public readonly heroSquash = { scaleX: 1, scaleY: 1 };
  public readonly aabbBox = { x: 0, y: 0, vx: 0, vy: 0 };
  public readonly aabbRes: TileAabbStepResult = { onGround: false, hitWall: false, hitCeiling: false, hitHazard: false, landVy: 0 };

  // Shmup state
  public readonly shmup: RuntimeShmupState;

  // Pre-allocated snapshot, spatial query, floating pixel text & VM buffers (Zero-GC)
  private readonly eventsOut: SimEvent[] = [];
  public readonly querySlots = new Int32Array(MAX_ENTITIES);
  private readonly platformerQuerySlots = this.querySlots;
  private readonly entityIdCache: string[] = new Array<string>(MAX_ENTITIES);
  private readonly entityIdArchIdx = new Int16Array(MAX_ENTITIES).fill(-2);
  private snapshotBankIdx: 0 | 1 = 0;
  private readonly snapshotBanks: [RuntimeSnapshotBank, RuntimeSnapshotBank];
  private readonly floatingTexts: FloatingTextSlot[] = Array.from({ length: MAX_FLOATING_TEXTS }, () => ({
    active: false,
    text: '',
    x: 0,
    y: 0,
    vy: -26,
    life: 0,
    maxLife: 0.85,
    color: '#fffaf0',
  }));
  private floatTextCursor = 0;
  private readonly onTweenUpdate = (key: string, value: number): void => {
    this.vm.setVar(key, value);
  };
  public readonly vmCollisions: VmCollisionPair[] = Array.from({ length: MAX_VM_COLLISION_PAIRS }, () => ({
    selfSlot: -1, otherSlot: -1, selfTag: '', otherTag: '',
  }));
  public vmCollisionCount = 0;

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
    emitSignal: () => {
      // Queue already populated by EventActionVm.emitSignal(); hook kept for bridge completeness
    },
    floatText: (text, color, anchor, x, y, selfSlot, otherSlot) => {
      let wx = x;
      let wy = y;
      if (anchor === 'player' && this.playerSlot >= 0) {
        wx += this.pool.x[this.playerSlot] + this.pool.w[this.playerSlot] * 0.5;
        wy += this.pool.y[this.playerSlot] - 6;
      } else if (anchor === 'self' && selfSlot >= 0) {
        wx += this.pool.x[selfSlot] + this.pool.w[selfSlot] * 0.5;
        wy += this.pool.y[selfSlot] - 6;
      } else if (anchor === 'other' && otherSlot >= 0) {
        wx += this.pool.x[otherSlot] + this.pool.w[otherSlot] * 0.5;
        wy += this.pool.y[otherSlot] - 6;
      } else if (anchor === 'other' && this.genre.p2Slot >= 0) {
        const p2 = this.genre.p2Slot;
        wx += this.pool.x[p2] + this.pool.w[p2] * 0.5;
        wy += this.pool.y[p2] - 6;
      }
      this.spawnFloatingText(text, wx, wy, color ?? '#fffaf0');
    },
    tweenVar: (name, to, duration, ease) => {
      this.tweens.start(name, this.vm.getVar(name, 0), to, duration, ease);
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
    const gc = this.def.player.grappleConfig;
    this.grappleEnabled = this.def.player.controller === 'platformer' && Boolean(gc?.enabled);
    this.grappleMaxRange = clamp(gc?.maxRange ?? 165, 24, 512);
    this.grappleAttachWalls = gc?.attachWalls ?? true;
    this.grapplePullSpeed = clamp(gc?.pullSpeed ?? 350, 80, 1600);
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
      else if (def.behavior?.kind === 'sine') bm |= BM_SIN_FLOAT;
      else if (def.behavior?.kind === 'chase_los') bm |= BM_CHASE;
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
      if (st.procedural?.autoSpawns?.stars && this.archetypeIdxById.has('star')) {
        c += Math.min(32, Math.round(st.procedural.autoSpawns.stars));
      }
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

    const mood = resolveStageArtMood(st);
    this.stageSkyTop = mood.skyTop;
    this.stageSkyBottom = mood.skyBottom;
    this.stageAmbientColor = mood.ambientColor;
    this.springCamFreq = st.springCamera?.freqHz ?? 0;
    this.springCamDamping = st.springCamera?.dampingRatio ?? 1;
    this.camVelX = 0;
    this.camVelY = 0;

    this.pool.reset();
    this.lastHitGroupByTarget.fill(0);
    this.juice.reset();
    this.tweens.reset();
    this.floatTextCursor = 0;
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      this.floatingTexts[i].active = false;
    }
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
    this.grappleState = 'idle';
    this.grappleTargetSlot = -1;
    this.grappleHoldViaInput = false;
    this.grapplePreviewKind = 'none';
    this.grappleAimAngle = -0.7854;
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
    } else if (st.procedural) {
      compileProceduralStage({
        stage: st,
        worldW: st.worldWidth,
        worldH,
        tilemap: this.tilemap,
        fgExtraTiles: this.fgExtraTiles,
        bgParallaxLayers: this.bgParallaxLayers,
        mood,
        hasArchetype: (id) => this.archetypeIdxById.has(id),
        pickEnemyArchetype: () => {
          for (let i = 0; i < this.archetypes.length; i++) {
            if ((this.archetypes[i].flags & EF_ENEMY) !== 0) return this.archetypes[i].id;
          }
          return null;
        },
        spawnArchetype: (aid, ax, ay) => this.spawnArchetype(aid, ax, ay),
        onStarSpawned: () => {
          this.stageStarsTotal++;
        },
      });
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
    if (mood.parallaxFog > 0 && this.bgParallaxLayers.length > 0) {
      applyOklabParallaxFog(this.bgParallaxLayers, this.stageSkyBottom, mood.parallaxFog);
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
    this.prevCameraX = this.cameraX;
    this.prevCameraY = this.cameraY;
    this.prevCamTargetX = this.cameraX;
    this.prevCamTargetY = this.cameraY;

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
    if (this.def.stages.length === 1) {
      this.totalCampaignStars = this.stageStarsTotal;
    }

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
    initGenreStageState(this);

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
    this.pool.pivotY[slot] = this.def.player.controller === 'shmup' ? 0.5 : 1.0;
  }

  public spawnArchetype(archetypeId: string, x: number, y: number, vx = 0, vy = 0, parentSlot = -1): number {
    const idx = this.archetypeIdxById.get(archetypeId);
    if (idx === undefined) return -1;
    const arch = this.archetypes[idx];
    const slot = this.pool.alloc(x, y, arch.def.w, arch.def.h);
    if (slot < 0) return -1;
    this.pool.archetypeIdx[slot] = idx;
    this.pool.flags[slot] = arch.flags;
    if (archetypeId === 'crate' || ((arch.flags & EF_SOLID) !== 0 && !arch.def.tags.includes('zip_block'))) {
      this.pool.flags[slot] |= EF_PUSHABLE_CRATE;
    }
    this.pool.behaviorMask[slot] = arch.behaviorMask;
    this.pool.hp[slot] = arch.def.hp ?? 1;
    this.pool.maxHp[slot] = arch.def.hp ?? 1;
    this.pool.vx[slot] = vx !== 0 ? vx : arch.def.behavior?.speedX ?? 0;
    this.pool.vy[slot] = vy !== 0 ? vy : arch.def.behavior?.speedY ?? 0;
    this.pool.parentSlot[slot] = parentSlot;
    this.pool.paramA[slot] = (arch.behaviorMask & BM_CHASE) !== 0 ? 0 : x * 0.1; // phase seed or minX default
    this.pool.paramB[slot] = (arch.behaviorMask & BM_SIN_FLOAT) !== 0 ? y : 0;
    this.pool.pivotX[slot] = 0.5;
    this.pool.pivotY[slot] = arch.def.castShadow ? 1.0 : 0.5;
    if (arch.def.paletteRow !== undefined) this.pool.paletteRow[slot] = arch.def.paletteRow;
    if (arch.def.emissive && arch.def.emissive > 0) this.pool.flags[slot] |= EF_EMISSIVE;
    return slot;
  }

  public spawnFloatingText(text: string, wx: number, wy: number, color = '#fffaf0'): void {
    if (!text) return;
    let slotIdx = -1;
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      if (!this.floatingTexts[i].active) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx < 0) {
      slotIdx = this.floatTextCursor;
      this.floatTextCursor = (this.floatTextCursor + 1) % MAX_FLOATING_TEXTS;
    }
    const ft = this.floatingTexts[slotIdx];
    ft.active = true;
    ft.text = text;
    ft.x = wx;
    ft.y = wy;
    ft.vy = -26;
    ft.life = 0;
    ft.maxLife = 0.85;
    ft.color = color;
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
    this.prevCameraX = this.cameraX;
    this.prevCameraY = this.cameraY;
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

  private updateRuntimeAim(dt: number, hcx: number, hcy: number): void {
    if (this.input.pointerActive()) {
      const safeZoom = Math.max(0.5, this.cameraZoom);
      const mouseWorldX = this.cameraX + this.input.pointerX() * (this.stageViewport.width / safeZoom);
      const mouseWorldY = this.cameraY + this.input.pointerY() * (this.stageViewport.height / safeZoom);
      this.grappleAimAngle = Math.atan2(mouseWorldY - hcy, mouseWorldX - hcx);
      return;
    }

    const rx = this.input.rightAxisX();
    const ry = this.input.rightAxisY();
    let hasDesired = false;
    let desired = this.grappleAimAngle;
    if (rx * rx + ry * ry > 0.04) {
      desired = Math.atan2(ry, rx);
      hasDesired = true;
    } else {
      const mx = this.input.axisX();
      const my = this.input.axisY();
      if (mx !== 0 || my !== 0) {
        desired = Math.atan2(my, mx);
        hasDesired = true;
      }
    }
    if (hasDesired) {
      const diff = wrapAimAngle(desired - this.grappleAimAngle);
      const maxStep = RT_AIM_ROT_SPEED * dt;
      this.grappleAimAngle =
        Math.abs(diff) <= maxStep
          ? desired
          : wrapAimAngle(this.grappleAimAngle + Math.sign(diff) * maxStep);
    }
  }

  private refreshRuntimeGrapplePreview(hcx: number, hcy: number): void {
    const ndx = Math.cos(this.grappleAimAngle);
    const ndy = Math.sin(this.grappleAimAngle);
    const maxR = this.grappleMaxRange;
    let bestDist = maxR + 1;
    let bestSlot = -1;
    let bestX = 0;
    let bestY = 0;

    const pool = this.pool;
    for (let i = 0; i < pool.activeCount; i++) {
      const s = pool.activeIndices[i];
      if ((pool.flags[s] & EF_GRAPPLE_TARGET) === 0) continue;
      const ax = pool.x[s] + pool.w[s] * 0.5;
      const ay = pool.y[s] + pool.h[s] * 0.5;
      const vx = ax - hcx;
      const vy = ay - hcy;
      const dist = Math.hypot(vx, vy);
      if (dist < 10 || dist > maxR || dist >= bestDist) continue;
      const dot = (vx / dist) * ndx + (vy / dist) * ndy;
      if (dot < RT_MAGNET_COS) continue;
      bestDist = dist;
      bestSlot = s;
      bestX = ax;
      bestY = ay;
    }

    if (bestSlot >= 0) {
      this.grapplePreviewKind = 'ring';
      this.grapplePreviewX = bestX;
      this.grapplePreviewY = bestY;
      this.grappleTargetSlot = bestSlot;
      return;
    }

    if (this.grappleAttachWalls) {
      const hit = raycastGrid2DInto(
        this.tilemap.cols,
        this.tilemap.rows,
        hcx,
        hcy,
        ndx,
        ndy,
        maxR,
        this.isTileOpaque,
        this.grappleRayScratch,
        0,
        TILE_SIZE,
      );
      if (hit && this.grappleRayScratch[1] >= 6) {
        this.grapplePreviewKind = 'wall';
        this.grapplePreviewX = this.grappleRayScratch[2];
        this.grapplePreviewY = this.grappleRayScratch[3];
        this.grappleTargetSlot = -1;
        return;
      }
    }

    this.grapplePreviewKind = 'none';
    const previewDist = Math.min(64, maxR);
    this.grapplePreviewX = hcx + ndx * previewDist;
    this.grapplePreviewY = hcy + ndy * previewDist;
    this.grappleTargetSlot = -1;
  }

  private fireRuntimeGrapple(mode: 'swing' | 'pull', hcx: number, hcy: number): boolean {
    if (this.grapplePreviewKind === 'none') return false;
    this.grappleState = 'shooting';
    this.grappleMode = mode;
    this.grappleAnchorX = this.grapplePreviewX;
    this.grappleAnchorY = this.grapplePreviewY;
    this.grappleTipX = hcx;
    this.grappleTipY = hcy;
    this.grappleSwingElapsed = 0;
    this.grapplePullElapsed = 0;
    return true;
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    this.eventsOut.length = 0;
    this.prevCameraX = this.cameraX;
    this.prevCameraY = this.cameraY;
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

    // Decay visual flash timers & floating pixel text pool
    for (let i = 0; i < this.pool.activeCount; i++) {
      const s = this.pool.activeIndices[i];
      if (this.pool.flash[s] > 0) this.pool.flash[s] = Math.max(0, this.pool.flash[s] - dt * 6);
    }
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) continue;
      ft.life += dt;
      if (ft.life >= ft.maxLife) {
        ft.active = false;
        continue;
      }
      ft.y += ft.vy * dt;
      ft.vy *= 0.94;
    }

    const ctrl = this.def.player.controller;
    if (ctrl === 'shmup') {
      if (simDt > 0 && this.shmup.phase === 'sortie') this.elapsedSec += simDt;
      if (simDt > 0) this.tweens.step(simDt, this.onTweenUpdate);
      stepShmupSystem(this, dt, simDt, this.eventsOut, params);
      this.vm.stepTick(this.vmHost, this.vmCollisions, 0);
      return this.eventsOut;
    }

    // Platformer / Fighter / Card / TopDown step
    stepSquashSpring(this.heroSquash, dt, 14);
    if (this.input.justPressed('shoulderL')) {
      this.retryCurrentStage();
      this.eventsOut.push('snap');
      return this.eventsOut;
    }
    if (ctrl === 'platformer' && this.input.justPressed('skillX') && this.def.player.scoutZoom) {
      this.scoutMode = !this.scoutMode;
      this.eventsOut.push('snap');
    }
    const targetZoom = this.scoutMode ? (this.def.player.scoutZoom ?? 0.78) : 1.0;
    this.cameraZoom += (targetZoom - this.cameraZoom) * Math.min(1, dt * 8);

    if (this.status === 'playing' && this.playerSlot >= 0) {
      if (ctrl === 'card') {
        if (simDt > 0) {
          this.elapsedSec += simDt;
          this.tweens.step(simDt, this.onTweenUpdate);
        }
        stepCardController(this, dt, params, this.eventsOut);
      } else if (simDt > 0) {
        this.elapsedSec += simDt;
        this.tweens.step(simDt, this.onTweenUpdate);
        if (ctrl === 'fighter') {
          stepFighterController(this, simDt, params, this.eventsOut);
        } else if (ctrl === 'topdown') {
          stepTopdownController(this, simDt, params, this.eventsOut);
        } else {
          this.stepPlatformer(simDt, params);
        }
      }
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

    // 1. Controls & Physics (plus optional Grapple system when grappleConfig.enabled)
    let grappleHandledMotion = false;
    let grappleBlockActions = false;
    let grappleBlockJump = false;

    if (this.grappleEnabled) {
      const ghcx = pool.x[p] + 8;
      const ghcy = pool.y[p] + 8;
      this.updateRuntimeAim(dt, ghcx, ghcy);
      this.refreshRuntimeGrapplePreview(ghcx, ghcy);

      if (this.grappleState === 'idle') {
        if (this.input.justPressed('skillY') || this.input.pointerPrimaryJustPressed()) {
          if (this.fireRuntimeGrapple('swing', ghcx, ghcy)) {
            this.grappleHoldViaInput = true;
            this.eventsOut.push('rail');
            grappleBlockActions = true;
          }
        } else if (this.input.justPressed('shoulderR') || this.input.pointerSecondaryJustPressed()) {
          if (this.fireRuntimeGrapple('pull', ghcx, ghcy)) {
            this.grappleHoldViaInput = false;
            this.eventsOut.push('rail');
            grappleBlockActions = true;
          }
        }
      }

      if (
        (this.input.held('skillY') || this.input.pointerPrimaryHeld()) &&
        (this.grappleState === 'shooting' || this.grappleState === 'swinging')
      ) {
        this.grappleHoldViaInput = true;
      }

      if (this.grappleState === 'shooting') {
        if (this.grappleTargetSlot >= 0 && (pool.flags[this.grappleTargetSlot] & EF_ALIVE) !== 0) {
          this.grappleAnchorX = pool.x[this.grappleTargetSlot] + pool.w[this.grappleTargetSlot] * 0.5;
          this.grappleAnchorY = pool.y[this.grappleTargetSlot] + pool.h[this.grappleTargetSlot] * 0.5;
        }
        const dx = this.grappleAnchorX - this.grappleTipX;
        const dy = this.grappleAnchorY - this.grappleTipY;
        const rem = Math.hypot(dx, dy);
        const stepDist = RT_GRAPPLE_SHOOT_SPEED * dt;
        if (rem <= stepDist + 6) {
          this.grappleTipX = this.grappleAnchorX;
          this.grappleTipY = this.grappleAnchorY;
          this.juice.triggerHitstop(0.018);
          this.juice.addTrauma(0.14);
          this.juice.registerCombo();
          this.eventsOut.push('snap');
          this.juice.spawnBurst(
            this.grappleAnchorX,
            this.grappleAnchorY,
            ['#ffd447', '#ff5d8f', '#fffaf0'],
            6,
            params.sparkleDensity,
          );
          this.dashCooldown = 0;
          this.airJumpsLeft = 1;
          this.dashTimer = 0;
          if (this.grappleMode === 'swing') {
            this.grappleState = 'swinging';
            this.grappleSwingElapsed = 0;
            this.grappleRopeLength = clamp(
              Math.hypot(ghcx - this.grappleAnchorX, ghcy - this.grappleAnchorY),
              24,
              this.grappleMaxRange,
            );
          } else {
            this.grappleState = 'pulling';
            this.grapplePullElapsed = 0;
          }
        } else {
          this.grappleTipX += (dx / rem) * stepDist;
          this.grappleTipY += (dy / rem) * stepDist;
        }
      }

      if (this.grappleState === 'swinging') {
        this.grappleSwingElapsed += dt;
        grappleBlockActions = true;
        if (this.input.justPressed('action') || this.input.pointerSecondaryJustPressed()) {
          this.grappleMode = 'pull';
          this.grappleState = 'pulling';
          this.grapplePullElapsed = 0;
          this.grappleHoldViaInput = false;
          this.eventsOut.push('snap');
        } else if (
          (this.grappleHoldViaInput &&
            !(this.input.held('skillY') || this.input.pointerPrimaryHeld()) &&
            this.grappleSwingElapsed > 0.02) ||
          this.input.justPressed('jump')
        ) {
          this.grappleState = 'idle';
          this.grappleHoldViaInput = false;
          pool.vx[p] *= 1.18;
          pool.vy[p] = Math.min(pool.vy[p] * 1.1, -125);
          this.dashCooldown = 0;
          this.airJumpsLeft = 1;
          this.heroSquash.scaleX = 0.8;
          this.heroSquash.scaleY = 1.24;
          this.eventsOut.push('jump');
          grappleBlockJump = true;
        } else {
          grappleHandledMotion = true;
          const reel = this.input.axisY();
          if (reel !== 0) {
            this.grappleRopeLength = clamp(this.grappleRopeLength + reel * 115 * dt, 24, this.grappleMaxRange);
          }
          const rx = ghcx - this.grappleAnchorX;
          const ry = ghcy - this.grappleAnchorY;
          const rDist = Math.max(1, Math.hypot(rx, ry));
          const tx = -ry / rDist;
          const ty = rx / rDist;
          const pump = this.input.axisX();
          if (pump !== 0) {
            const signT = ty >= 0 ? -pump : pump;
            const thrust = 260 * dt;
            pool.vx[p] += tx * signT * thrust;
            pool.vy[p] += ty * signT * thrust;
            if (pump < 0) pool.flags[p] |= EF_FACING_LEFT;
            else pool.flags[p] &= ~EF_FACING_LEFT;
          }
          pool.vy[p] = Math.min(340, pool.vy[p] + 520 * params.gravityScale * dt);
        }
      }

      if (this.grappleState === 'pulling') {
        this.grapplePullElapsed += dt;
        grappleBlockActions = true;
        const dx = this.grappleAnchorX - ghcx;
        const dy = this.grappleAnchorY - ghcy;
        const dist = Math.hypot(dx, dy);
        if (dist < 14 || this.grapplePullElapsed > 0.7 || this.input.justPressed('jump')) {
          this.grappleState = 'idle';
          this.grappleHoldViaInput = false;
          this.dashCooldown = 0;
          this.airJumpsLeft = 1;
          pool.vy[p] = Math.min(pool.vy[p], -125);
          this.eventsOut.push('jump');
          grappleBlockJump = true;
        } else {
          grappleHandledMotion = true;
          pool.vx[p] = (dx / dist) * this.grapplePullSpeed;
          pool.vy[p] = (dy / dist) * this.grapplePullSpeed;
          if (dx < -2) pool.flags[p] |= EF_FACING_LEFT;
          else if (dx > 2) pool.flags[p] &= ~EF_FACING_LEFT;
        }
      }
    }

    const dir = this.input.axisX();
    if (!grappleHandledMotion) {
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
      if (!grappleBlockJump && (this.input.justPressed('jump') || this.input.justPressed('up'))) this.input.primeBuffer('jump', 0.13);
      this.coyote = this.aabbRes.onGround ? 0.11 : Math.max(0, this.coyote - dt);

      if (!grappleBlockJump && this.input.hasBuffered('jump') && this.coyote > 0) {
        this.input.consumeBuffer('jump');
        pool.vy[p] = -params.jumpPower;
        this.coyote = 0;
        this.heroSquash.scaleX = 0.78;
        this.heroSquash.scaleY = 1.24;
        this.eventsOut.push('jump');
        this.juice.spawnBurst(pool.x[p] + 8, pool.y[p] + 15, ['#fffaf0', '#56d39c'], 4, params.sparkleDensity);
      } else if (!grappleBlockJump && this.input.hasBuffered('jump') && this.relics.doubleJump && this.airJumpsLeft > 0 && !this.aabbRes.onGround) {
        this.input.consumeBuffer('jump');
        this.airJumpsLeft--;
        pool.vy[p] = -params.jumpPower * 0.94;
        this.dashTimer = 0;
        this.heroSquash.scaleX = 0.74;
        this.heroSquash.scaleY = 1.28;
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
    }

    const facingLeft = (pool.flags[p] & EF_FACING_LEFT) !== 0;
    const sign = facingLeft ? -1 : 1;
    if (facingLeft) pool.flags[p] |= EF_FLIP_X;
    else pool.flags[p] &= ~EF_FLIP_X;

    if (!grappleBlockActions && (this.input.justPressed('action') || (!this.grappleEnabled && this.input.justPressed('shoulderR')))) {
      if (this.relics.airDash && !this.aabbRes.onGround && this.dashCooldown <= 0) {
        this.dashTimer = 0.14;
        this.dashCooldown = 0.55;
        pool.vx[p] = sign * 235;
        pool.vy[p] = 0;
        this.heroSquash.scaleX = 1.32;
        this.heroSquash.scaleY = 0.72;
        this.eventsOut.push('snap');
      } else if (!this.grappleEnabled) {
        const sp = this.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 7, sign * 155, -22);
        if (sp >= 0) pool.timerA[sp] = 0.42;
        this.heroSquash.scaleX = 1.15;
        this.heroSquash.scaleY = 0.88;
        this.eventsOut.push('ignite');
      }
    }
    if (!grappleBlockActions && !this.grappleEnabled && this.input.justPressed('skillY') && this.pulseCooldown <= 0) {
      this.pulseCooldown = 0.36;
      const s1 = this.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 5, sign * 172, -46);
      const s2 = this.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 9, sign * 164, 8);
      if (s1 >= 0) pool.timerA[s1] = 0.48;
      if (s2 >= 0) pool.timerA[s2] = 0.48;
      this.eventsOut.push('ignite');
    }

    // 2. Tilemap O(1) resolution + moving platform ride
    const box = this.aabbBox;
    box.x = pool.x[p];
    box.y = pool.y[p];
    box.vx = pool.vx[p];
    box.vy = pool.vy[p];
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
        if (
          hbR > pool.x[s] &&
          hbL < pool.x[s] + pool.w[s] &&
          box.vy >= 0 &&
          hbBot >= Math.min(prevMpY, pool.y[s]) - 2 &&
          hbBot <= prevMpY + 8
        ) {
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
      } else if ((pool.behaviorMask[s] & BM_SIN_FLOAT) !== 0) {
        const archIdx = pool.archetypeIdx[s];
        const beh = archIdx >= 0 ? this.archetypes[archIdx].def.behavior : undefined;
        const amp = beh?.amplitude ?? 12;
        const freq = beh?.freq ?? 2.6;
        const speedX = beh?.speedX ?? 0;
        if (speedX !== 0) {
          pool.x[s] += speedX * dt;
          if (pool.x[s] < 0) pool.x[s] = 0;
          else if (pool.x[s] > this.stageWorldW - pool.w[s]) pool.x[s] = this.stageWorldW - pool.w[s];
        }
        pool.timerA[s] += dt * freq;
        pool.y[s] = pool.paramB[s] + Math.sin(pool.timerA[s] + pool.paramA[s]) * amp;
      } else if ((pool.behaviorMask[s] & BM_CHASE) !== 0) {
        const archIdx = pool.archetypeIdx[s];
        const beh = archIdx >= 0 ? this.archetypes[archIdx].def.behavior : undefined;
        const sightRange = beh?.sightRange ?? 160;
        const chaseSpeed = beh?.chaseSpeed ?? Math.max(24, Math.abs(beh?.speedX ?? 44));
        const ecx = pool.x[s] + pool.w[s] * 0.5;
        const ecy = pool.y[s] + pool.h[s] * 0.5;
        const pcx = pool.x[p] + pool.w[p] * 0.5;
        const pcy = pool.y[p] + pool.h[p] * 0.5;
        const dx = pcx - ecx;
        const dy = pcy - ecy;
        const seesPlayer =
          dx * dx + dy * dy <= sightRange * sightRange &&
          hasGridLineOfSight(
            Math.floor(ecx / TILE_SIZE),
            Math.floor(ecy / TILE_SIZE),
            Math.floor(pcx / TILE_SIZE),
            Math.floor(pcy / TILE_SIZE),
            this.isTileOpaque,
          );
        pool.aiState[s] = seesPlayer ? 1 : 0;
        if (seesPlayer) {
          const dirX = dx > 2 ? 1 : dx < -2 ? -1 : 0;
          pool.vx[s] = dirX * chaseSpeed;
          if ((pool.flags[s] & EF_GRAVITY) === 0) {
            const dirY = dy > 2 ? 1 : dy < -2 ? -1 : 0;
            pool.vy[s] = dirY * (chaseSpeed * 0.65);
          }
        } else if (pool.paramB[s] > pool.paramA[s]) {
          if (Math.abs(pool.vx[s]) < 1) pool.vx[s] = beh?.speedX ?? 24;
          if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
          else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
        } else {
          pool.vx[s] = 0;
          if ((pool.flags[s] & EF_GRAVITY) === 0) pool.vy[s] = 0;
        }
        const nextEx = pool.x[s] + pool.vx[s] * dt;
        const probeCol = Math.floor((nextEx + (pool.vx[s] >= 0 ? pool.w[s] - 1 : 1)) / TILE_SIZE);
        const probeRow = Math.floor((pool.y[s] + pool.h[s] * 0.5) / TILE_SIZE);
        if (this.tilemap.getCollision(probeCol, probeRow) !== COLLISION_SOLID) {
          pool.x[s] = clamp(nextEx, 0, Math.max(0, this.stageWorldW - pool.w[s]));
        }
        if ((pool.flags[s] & EF_GRAVITY) === 0) {
          const nextEy = pool.y[s] + pool.vy[s] * dt;
          const vProbeRow = Math.floor((nextEy + (pool.vy[s] >= 0 ? pool.h[s] - 1 : 1)) / TILE_SIZE);
          const vProbeCol = Math.floor((pool.x[s] + pool.w[s] * 0.5) / TILE_SIZE);
          if (this.tilemap.getCollision(vProbeCol, vProbeRow) !== COLLISION_SOLID) {
            pool.y[s] = clamp(nextEy, 0, Math.max(0, this.stageWorldH - pool.h[s]));
          }
        }
        if (pool.vx[s] < -1) pool.flags[s] |= EF_FLIP_X;
        else if (pool.vx[s] > 1) pool.flags[s] &= ~EF_FLIP_X;
      } else if ((pool.flags[s] & EF_BULLET) !== 0) {
        pool.x[s] += pool.vx[s] * dt;
        pool.y[s] += pool.vy[s] * dt;
        pool.vy[s] += 260 * dt;
        pool.timerA[s] -= dt;
        if (pool.timerA[s] <= 0) pool.free(s);
      } else if ((pool.flags[s] & EF_CRYSTAL_RESET) !== 0 && pool.timerA[s] > 0) {
        pool.timerA[s] = Math.max(0, pool.timerA[s] - dt);
      }
    }

    pool.x[p] = box.x;
    pool.y[p] = box.y;
    pool.vx[p] = box.vx;
    pool.vy[p] = box.vy;
    if (this.grappleEnabled && this.grappleState === 'swinging') {
      const rdx = pool.x[p] + 8 - this.grappleAnchorX;
      const rdy = pool.y[p] + 8 - this.grappleAnchorY;
      const rDist = Math.hypot(rdx, rdy);
      if (rDist > this.grappleRopeLength && rDist > 1e-4) {
        const ux = rdx / rDist;
        const uy = rdy / rDist;
        pool.x[p] = this.grappleAnchorX + ux * this.grappleRopeLength - 8;
        pool.y[p] = this.grappleAnchorY + uy * this.grappleRopeLength - 8;
        const vDotU = pool.vx[p] * ux + pool.vy[p] * uy;
        if (vDotU > 0) {
          pool.vx[p] -= vDotU * ux;
          pool.vy[p] -= vDotU * uy;
        }
      }
    }
    pool.sx[p] = this.heroSquash.scaleX;
    pool.sy[p] = this.heroSquash.scaleY;
    pool.skewX[p] = Math.abs(pool.vx[p]) > 10 ? clamp(pool.vx[p] / 460, -0.24, 0.24) : 0;

    if (!wasOnGround && this.aabbRes.onGround && this.aabbRes.landVy > 95) {
      const amt = Math.min(0.28, (this.aabbRes.landVy / 320) * 0.28);
      this.heroSquash.scaleX = 1 + amt;
      this.heroSquash.scaleY = 1 - amt * 0.9;
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
      this.grappleState = 'idle';
      this.grappleHoldViaInput = false;
      this.grappleTargetSlot = -1;
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
        this.heroSquash.scaleX = 0.72;
        this.heroSquash.scaleY = 1.32;
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
      } else if ((f & EF_CRYSTAL_RESET) !== 0 && pool.timerA[s] <= 0 && dist < 16) {
        pool.timerA[s] = 2.2;
        pool.flash[s] = 0.25;
        this.dashCooldown = 0;
        this.airJumpsLeft = 1;
        this.juice.registerCombo();
        this.eventsOut.push('star');
        this.juice.spawnBurst(ecx, ecy, ['#5ec2f7', '#fffaf0'], 6, params.sparkleDensity);
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
    this.trackCameraTarget(pool.x[p], pool.y[p], dt);
  }

  public trackCameraTarget(targetX: number, targetY: number, dt: number): void {
    const zoom = Math.max(0.5, this.cameraZoom);
    const viewW = this.stageViewport.width / zoom;
    const viewH = this.stageViewport.height / zoom;
    const maxCamX = Math.max(0, this.stageWorldW - viewW);
    const maxCamY = Math.max(0, this.stageWorldH - viewH);
    const desiredCamX = clamp(targetX - viewW * 0.42, 0, maxCamX);
    const desiredCamY = clamp(targetY - viewH * 0.55, 0, maxCamY);
    if (this.springCamFreq > 0) {
      stepSpringInto(
        this.cameraX,
        this.camVelX,
        desiredCamX,
        this.prevCamTargetX,
        this.springCamFreq,
        this.springCamDamping,
        0,
        dt,
        this.camSpringOut,
        0,
      );
      this.cameraX = clamp(this.camSpringOut[0], 0, maxCamX);
      this.camVelX = this.camSpringOut[1];
      stepSpringInto(
        this.cameraY,
        this.camVelY,
        desiredCamY,
        this.prevCamTargetY,
        this.springCamFreq,
        this.springCamDamping,
        0,
        dt,
        this.camSpringOut,
        0,
      );
      this.cameraY = clamp(this.camSpringOut[0], 0, maxCamY);
      this.camVelY = this.camSpringOut[1];
      this.prevCamTargetX = desiredCamX;
      this.prevCamTargetY = desiredCamY;
    } else {
      const camAlpha = Math.min(1, dt * 8);
      this.cameraX += (desiredCamX - this.cameraX) * camAlpha;
      this.cameraY += (desiredCamY - this.cameraY) * camAlpha;
    }
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
    const interpCamX = alpha < 1 ? this.prevCameraX + (this.cameraX - this.prevCameraX) * alpha : this.cameraX;
    const interpCamY = alpha < 1 ? this.prevCameraY + (this.cameraY - this.prevCameraY) * alpha : this.cameraY;
    const camX = interpCamX + this.juice.shakeX + this.juice.kickX;
    const camY = interpCamY + this.juice.shakeY + this.juice.kickY;
    const safeZoom = Math.max(0.5, camZoom);
    const viewW = this.stageViewport.width / safeZoom;
    const viewH = this.stageViewport.height / safeZoom;
    const margin = 96 / safeZoom;
    const visMinX = camX - margin;
    const visMinY = camY - margin;
    const visMaxX = camX + viewW + margin;
    const visMaxY = camY + viewH + margin;

    let tileSlotCount = 0;
    const gh = this.def.meta.genreHud;
    const autoTileEnabled = gh === 'parkour' || gh === 'fighter' || gh === 'card' || gh === 'grid';
    const midChunks = this.tilemap.updateActiveChunks(visMinX, visMinY, visMaxX, visMaxY, 0);
    for (let ci = 0; ci < midChunks; ci++) {
      const slot = this.tilemap.activeChunkIds[ci];
      const baseCol = this.tilemap.activeChunkCols[ci] << CHUNK_SHIFT;
      const baseRow = this.tilemap.activeChunkRows[ci] << CHUNK_SHIFT;
      const baseSlab = slot << 8;
      for (let lr = 0; lr < CHUNK_SIZE; lr++) {
        const row = baseRow + lr;
        const y = row * TILE_SIZE;
        if (y + TILE_SIZE < visMinY || y > visMaxY) continue;
        const h = Math.min(TILE_SIZE, Math.max(1, this.stageWorldH - y));
        const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
        for (let lc = 0; lc < CHUNK_SIZE; lc++) {
          const tid = this.tilemap.tilesSlab[rowSlab | lc];
          if (tid === 0) continue;
          const col = baseCol + lc;
          const x = col * TILE_SIZE;
          if (x + TILE_SIZE < visMinX || x > visMaxX) continue;
          const dst = acquireTileSlot(bank.tileSlots, tileSlotCount++);
          let sprite = this.tileSpriteLut[tid] ?? 'stone';
          let autoMask: number | undefined;
          if (autoTileEnabled) {
            if (sprite === 'stone') {
              const mask = this.tilemap.getAutoMask(col, row);
              sprite = `cliff_m${mask}`;
              autoMask = mask;
            } else if (sprite === 'grass') {
              const mask = this.tilemap.getAutoMask(col, row);
              sprite = `grass_m${mask}`;
              autoMask = mask;
            }
          }
          dst.sprite = sprite;
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
          dst.autoMask = autoMask;
          dst.variant = undefined;
          dst.windSway = undefined;
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
        const ctrl = this.def.player.controller;
        if (isShmup && loadout) {
          sprite = Math.floor(t * 12) % 2 === 0 ? loadout.spriteA : loadout.spriteB;
        } else if (!isShmup && this.def.player.spriteB) {
          const moving =
            ctrl === 'topdown'
              ? Math.hypot(this.pool.vx[s], this.pool.vy[s]) > 8
              : ctrl === 'card'
                ? false
                : Math.abs(this.pool.vx[s]) > 8 || !this.aabbRes.onGround;
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
        dst.tint = ctrl === 'fighter' && this.genre.p1.state === 'block' ? '#5ec2f7' : undefined;
        dst.alpha = undefined;
        dst.paletteRow = this.pool.paletteRow[s] || undefined;
        dst.elevationZ = undefined;
        dst.shadowOffsetY = undefined;
        dst.castShadow = !isShmup;
        dst.shadowRadius = 6;
        dst.sortY = undefined;
        outEntities.push(dst);

        if (glow > 0.05) {
          const isDark = (st.ambientDarkness ?? 0) > 0.16;
          const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
          l.x = rx + 8;
          l.y = ry + 8;
          l.radius = isShmup ? 24 : isDark ? 42 : 22;
          l.color = loadout?.accentHex ?? '#ffe8a8';
          l.intensity = (isShmup ? 0.18 : isDark ? 0.42 : 0.09) * glow;
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
        if ((f & EF_LOGIC_SWITCH) !== 0 && this.pool.aiState[s] === 1) {
          sprite = 'switch_on';
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
        } else if (this.def.player.controller === 'fighter' && s === this.genre.p2Slot && this.genre.p2.state === 'block') {
          tint = '#5ec2f7';
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
        dst.alpha = (f & EF_CRYSTAL_RESET) !== 0 && this.pool.timerA[s] > 0 ? 0.28 : undefined;
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

    // Emit runtime grapple rope & aiming reticle when grappleConfig is active
    if (this.grappleEnabled && this.playerSlot >= 0 && (this.pool.flags[this.playerSlot] & EF_ALIVE) !== 0) {
      const hx = this.pool.renderX(this.playerSlot, alpha) + this.pool.w[this.playerSlot] * 0.5;
      const hy = this.pool.renderY(this.playerSlot, alpha) + this.pool.h[this.playerSlot] * 0.5;
      if (this.grappleState !== 'idle') {
        const endX = this.grappleState === 'shooting' ? this.grappleTipX : this.grappleAnchorX;
        const endY = this.grappleState === 'shooting' ? this.grappleTipY : this.grappleAnchorY;
        const dx = endX - hx;
        const dy = endY - hy;
        const ang = Math.atan2(dy, dx);
        for (let k = 0; k < RT_GRAPPLE_LINKS; k++) {
          const u = (k + 1) / (RT_GRAPPLE_LINKS + 1);
          const lDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
          lDst.id = this.grappleLinkIds[k];
          lDst.sprite = 'grapple_link';
          lDst.x = hx + dx * u - 5;
          lDst.y = hy + dy * u - 4;
          lDst.w = 10;
          lDst.h = 8;
          lDst.rot = ang;
          lDst.scaleX = 1;
          lDst.scaleY = 1;
          lDst.anchorY = 0.5;
          lDst.skewX = undefined;
          lDst.flash = 0;
          lDst.flipX = false;
          lDst.additive = false;
          lDst.emissive = 0.7;
          lDst.tint = this.grappleMode === 'swing' ? '#ff5d8f' : '#5ec2f7';
          lDst.alpha = 1;
          lDst.paletteRow = undefined;
          lDst.elevationZ = undefined;
          lDst.shadowOffsetY = undefined;
          lDst.castShadow = false;
          lDst.shadowRadius = undefined;
          lDst.sortY = undefined;
          outEntities.push(lDst);
        }
        const cDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        cDst.id = 'rt-grapple-claw';
        cDst.sprite = 'grapple_claw';
        cDst.x = endX - 7;
        cDst.y = endY - 7;
        cDst.w = 14;
        cDst.h = 14;
        cDst.rot = ang;
        cDst.scaleX = 1;
        cDst.scaleY = 1;
        cDst.anchorY = 0.5;
        cDst.skewX = undefined;
        cDst.flash = 0;
        cDst.flipX = false;
        cDst.additive = false;
        cDst.emissive = 0.9;
        cDst.tint = undefined;
        cDst.alpha = 1;
        cDst.paletteRow = undefined;
        cDst.elevationZ = undefined;
        cDst.shadowOffsetY = undefined;
        cDst.castShadow = false;
        cDst.shadowRadius = undefined;
        cDst.sortY = undefined;
        outEntities.push(cDst);
      } else if (this.grapplePreviewKind !== 'none') {
        const rDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        rDst.id = 'rt-grapple-reticle';
        rDst.sprite = 'grapple_reticle';
        rDst.x = this.grapplePreviewX - 7;
        rDst.y = this.grapplePreviewY - 7;
        rDst.w = 14;
        rDst.h = 14;
        rDst.rot = t * 5;
        rDst.scaleX = 1;
        rDst.scaleY = 1;
        rDst.anchorY = 0.5;
        rDst.skewX = undefined;
        rDst.flash = 0;
        rDst.flipX = false;
        rDst.additive = false;
        rDst.emissive = 0.92;
        rDst.tint = this.grapplePreviewKind === 'ring' ? '#ffd447' : '#5ec2f7';
        rDst.alpha = 0.95;
        rDst.paletteRow = undefined;
        rDst.elevationZ = undefined;
        rDst.shadowOffsetY = undefined;
        rDst.castShadow = false;
        rDst.shadowRadius = undefined;
        rDst.sortY = undefined;
        outEntities.push(rDst);
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
    snap.skyTop = this.stageSkyTop;
    snap.skyBottom = this.stageSkyBottom;
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
    snap.ambientColor = this.stageAmbientColor;
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
    const hideCtrl = this.def.player.controller;
    snap.hideClassicHud =
      hideCtrl === 'fighter' ||
      hideCtrl === 'card' ||
      hideCtrl === 'topdown' ||
      gh === 'fighter' ||
      gh === 'card' ||
      gh === 'grid';
    snap.hudPrimitives = this.buildHudPrimitives(bank, bossHp, bossMaxHp, alpha);
    snap.statusBanner = this.statusBanner;
    snap.stage = bank.stageInfo;
    snap.bgmTheme = st.bgmTheme;
    snap.shmupHud = isShmup ? buildShmupHudFromPool(this) : undefined;
    return snap;
  }

  private buildHudPrimitives(
    bank: RuntimeSnapshotBank,
    bossHp: number,
    bossMaxHp: number,
    alpha: number,
  ): HudPrimitiveDesc[] | undefined {
    const ctrl = this.def.player.controller;
    const genreHud =
      this.def.meta.genreHud ??
      (ctrl === 'fighter' ? 'fighter' : ctrl === 'card' ? 'card' : ctrl === 'topdown' ? 'grid' : undefined);
    const needsAimLine =
      this.grappleEnabled &&
      this.grappleState === 'idle' &&
      this.playerSlot >= 0 &&
      (this.pool.flags[this.playerSlot] & EF_ALIVE) !== 0;

    let hasActiveFloatText = false;
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      if (this.floatingTexts[i].active) {
        hasActiveFloatText = true;
        break;
      }
    }

    if (!needsAimLine && !hasActiveFloatText && (!genreHud || genreHud === 'platformer')) {
      return undefined;
    }

    const out = bank.hudPrimitives;
    out.length = 0;
    let count = 0;
    const vw = bank.viewport.width;
    const vh = bank.viewport.height;

    if (needsAimLine) {
      const hx = this.pool.renderX(this.playerSlot, alpha) + this.pool.w[this.playerSlot] * 0.5;
      const hy = this.pool.renderY(this.playerSlot, alpha) + this.pool.h[this.playerSlot] * 0.5;
      const locked = this.grapplePreviewKind !== 'none';
      const slot = acquireHudSlot(bank.hudSlots, count++);
      slot.kind = 'aim_line';
      slot.x = hx;
      slot.y = hy;
      if (locked) {
        slot.x2 = this.grapplePreviewX;
        slot.y2 = this.grapplePreviewY;
      } else {
        const len = Math.min(148, this.grappleMaxRange * 0.9);
        slot.x2 = hx + Math.cos(this.grappleAimAngle) * len;
        slot.y2 = hy + Math.sin(this.grappleAimAngle) * len;
      }
      slot.w = 2;
      slot.h = 2;
      slot.color = locked ? '#ffd447' : '#5ec2f7';
      slot.alpha = locked ? 0.85 : 0.45;
      slot.worldSpace = true;
      out.push(slot);
    }

    if (genreHud === 'parkour') {
      const ready = this.dashCooldown <= 0 && this.grappleState === 'idle';
      const bar = acquireHudSlot(bank.hudSlots, count++);
      bar.kind = 'bar';
      bar.x = 8;
      bar.y = 8;
      bar.w = 68;
      bar.h = 6;
      bar.ratio = ready ? 1 : clamp(1 - this.dashCooldown / 0.55, 0.15, 0.95);
      bar.color = ready ? '#ff5d8f' : '#5ec2f7';
      bar.bgColor = '#120e24';
      bar.alpha = 0.9;
      out.push(bar);
    } else if (genreHud === 'fighter' || genreHud === 'card' || genreHud === 'grid') {
      count = buildGenreHudPrimitives(this, genreHud, out, bank.hudSlots, count, vw, vh, bossHp, bossMaxHp);
    }

    // Floating pixel text popups (world-space)
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) continue;
      const tSlot = acquireHudSlot(bank.hudSlots, count++);
      tSlot.kind = 'text';
      tSlot.x = ft.x;
      tSlot.y = ft.y;
      tSlot.w = 0;
      tSlot.h = 0;
      tSlot.text = ft.text;
      tSlot.scale = 1;
      tSlot.align = 'center';
      tSlot.color = ft.color;
      tSlot.shadowColor = '#120d1e';
      tSlot.alpha = clamp(1 - (ft.life / ft.maxLife) * 0.4, 0.25, 1);
      tSlot.worldSpace = true;
      out.push(tSlot);
    }

    return count > 0 ? out : undefined;
  }
}
