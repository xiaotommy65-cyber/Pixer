import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { InputMap } from '../../core/input/InputMap.ts';
import { solveTwoBoneIkInto, VerletChain } from '../../core/math/SpringDynamics.ts';
import { raycastGrid2DInto } from '../../core/math/Visibility2D.ts';
import { CameraDirector } from '../../core/sim/CameraDirector.ts';
import { JuiceSystem, stepSquashSpring, triggerSquash, type SquashSpring } from '../../core/sim/JuiceSystem.ts';
import {
  COLLISION_EMPTY,
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
  type TileAabbStepResult,
} from '../../core/sim/TilemapGrid.ts';
import {
  clamp,
  type BgStarDesc,
  type ComboTrackingCartridge,
  type DebuggableCartridge,
  type DebugRectDesc,
  type EntityDesc,
  type Hd2dDepthConfig,
  type HudPrimitiveDesc,
  type InputState,
  type LightDesc,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type SimEvent,
  type StageProgressInfo,
  type TileDesc,
} from '../../core/types/WorldTypes.ts';
import {
  compileParkourStage,
  PARKOUR_STAGES,
  PARKOUR_VIEWPORT_H,
  PARKOUR_VIEWPORT_W,
  type CompiledParkourStage,
} from './ParkourLevels.ts';

type GrappleState = 'idle' | 'shooting' | 'swinging' | 'pulling';
type GrappleMode = 'swing' | 'pull';
type GrappleTargetKind = 'none' | 'wall' | 'ring' | 'zip';

interface RuntimeZipBlock {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  speed: number;
  phase: 'rest' | 'surging' | 'returning';
  waitTimer: number;
}

interface RuntimeCrumbleBlock {
  x: number;
  y: number;
  w: number;
  col: number;
  row: number;
  wCols: number;
  state: 'intact' | 'shaking' | 'broken';
  timer: number;
}

interface RuntimeCrystal {
  x: number;
  y: number;
  cooldown: number;
}

interface RuntimeLaser {
  x: number;
  y: number;
  w: number;
  h: number;
  period: number;
  onDuration: number;
  phase: number;
  active: boolean;
  warning: boolean;
}

interface RuntimeCheckpoint {
  x: number;
  y: number;
  activated: boolean;
}

interface AfterimageSlot {
  active: boolean;
  x: number;
  y: number;
  sprite: SpriteId;
  flipX: boolean;
  life: number;
  maxLife: number;
  tint: string;
}

interface FloatingPopupSlot {
  active: boolean;
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

interface ParkourSnapshotBank {
  snapshot: RenderSceneSnapshot;
  viewport: { width: number; height: number };
  tileSlots: TileDesc[];
  fgTileSlots: TileDesc[];
  entitySlots: EntityDesc[];
  lightSlots: LightDesc[];
  debugRectSlots: DebugRectDesc[];
  aimLineSlot: HudPrimitiveDesc;
  popupSlots: [HudPrimitiveDesc, HudPrimitiveDesc, HudPrimitiveDesc, HudPrimitiveDesc];
  tiles: TileDesc[];
  fgTiles: TileDesc[];
  entities: EntityDesc[];
  lights: LightDesc[];
  debugRects: DebugRectDesc[];
  hudPrimitives: HudPrimitiveDesc[];
}

const HB_X = 3;
const HB_Y = 2;
const HB_W = 10;
const HB_H = 14;

const GRAPPLE_SHOOT_SPEED = 720;
const GRAPPLE_PULL_SPEED = 350;
const GRAPPLE_MAX_RANGE = 165;
const MAGNET_RADIUS = 155;
const MAGNET_COS_HALF_ANGLE = Math.cos((26 * Math.PI) / 180);
const AIM_ROT_SPEED = 28;
const RESPAWN_DELAY_SEC = 0.18;
const GHOST_MAX_SAMPLES = 256;
const GHOST_SAMPLE_INTERVAL = 0.08;
const AFTERIMAGE_COUNT = 6;
const GRAPPLE_LINKS = 7;

const SCARF_COLOR_READY = '#ff5d8f';
const SCARF_COLOR_SPENT = '#5ec2f7';

function wrapAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function createSnapshotBank(viewportW: number, viewportH: number): ParkourSnapshotBank {
  const viewport = { width: viewportW, height: viewportH };
  const tiles: TileDesc[] = [];
  const fgTiles: TileDesc[] = [];
  const entities: EntityDesc[] = [];
  const lights: LightDesc[] = [];
  const debugRects: DebugRectDesc[] = [];
  const hudPrimitives: HudPrimitiveDesc[] = [];
  const aimLineSlot: HudPrimitiveDesc = {
    kind: 'aim_line',
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    x2: 0,
    y2: 0,
    color: '#5ec2f7',
    alpha: 0.45,
    worldSpace: true,
  };
  const makePopupSlot = (): HudPrimitiveDesc => ({
    kind: 'text',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    text: '',
    scale: 1,
    align: 'center',
    shadowColor: '#120d1e',
    color: '#fffaf0',
    alpha: 1,
    worldSpace: true,
  });
  return {
    viewport,
    tileSlots: [],
    fgTileSlots: [],
    entitySlots: [],
    lightSlots: [],
    debugRectSlots: [],
    aimLineSlot,
    popupSlots: [makePopupSlot(), makePopupSlot(), makePopupSlot(), makePopupSlot()],
    tiles,
    fgTiles,
    entities,
    lights,
    debugRects,
    hudPrimitives,
    snapshot: {
      cartridgeId: 'celestial-parkour',
      skyTop: '#16112e',
      skyBottom: '#ff5d8f',
      cozyFilter: true,
      glowIntensity: 1,
      paletteRow: 1,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 0,
      comboCount: 0,
      starsCollected: 0,
      starsTotal: PARKOUR_STAGES.length,
      hasKey: false,
      hearts: 1,
      maxHearts: 1,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      cameraZoom: 1,
      cameraLetterbox: 0,
      viewport,
      ambientDarkness: 0,
      ambientColor: '#120e24',
      screenFlashAlpha: 0,
      screenFlashColor: '#fffaf0',
      hd2dDepth: undefined,
      bgStars: [],
      bgParallaxLayers: undefined,
      bgClouds: [],
      tiles,
      fgTiles,
      entities,
      particles: [],
      lights,
      debugRects: undefined,
      hudPrimitives: undefined,
      statusBanner: '',
      stage: undefined,
      bgmTheme: 'meadow',
    },
  };
}

function acquireTileSlot(pool: TileDesc[], idx: number): TileDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { sprite: 'stone', x: 0, y: 0, w: 16, h: 16 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireEntitySlot(pool: EntityDesc[], idx: number): EntityDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { id: '', sprite: 'parkour_hero_idle', x: 0, y: 0, w: 16, h: 16 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireLightSlot(pool: LightDesc[], idx: number): LightDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, radius: 24, color: '#ff5d8f', intensity: 0.4 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireDebugRectSlot(pool: DebugRectDesc[], idx: number): DebugRectDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, w: 16, h: 16, color: '#56d39c' };
    pool[idx] = slot;
  }
  return slot;
}

function makeIdList(prefix: string, count: number): string[] {
  const arr: string[] = [];
  for (let i = 0; i < count; i++) {
    arr.push(`${prefix}-${i}`);
  }
  return arr;
}

/**
 * PA-06 Flagship Action Platformer: 《緋空殘響：飛鉤跑酷》 (Celestial Parkour)
 * Features 360° dual-mode grappling hook (pendulum swing + zip-pull),
 * Celeste-grade Wave-Dash / Coyote / Wall-Jump kinematics, and live Engine 3.0 integrations
 * (VerletChain scarf, curlNoise2DInto updrafts, Two-Bone IK Boss Claw, Oklab parallax fog, and Zero-GC ping-pong snapshots).
 */
export class CelestialParkourGame implements DebuggableCartridge, ComboTrackingCartridge {
  public readonly scriptError: string | null = null;

  private readonly input = new InputMap();
  private readonly juice = new JuiceSystem();
  private readonly camera = new CameraDirector();
  private readonly scarf = new VerletChain(8, 3.2);

  // Pre-allocated Zero-GC math & step scratch buffers
  private readonly rayScratch = new Float64Array(8);
  private readonly ikScratch = new Float64Array(4);
  private readonly heroBox = { x: 0, y: 0, vx: 0, vy: 0 };
  private readonly aabbOut: TileAabbStepResult = {
    onGround: false,
    hitWall: false,
    hitCeiling: false,
    hitHazard: false,
    landVy: 0,
  };
  private readonly stepEvents: SimEvent[] = [];

  // Double-buffered Zero-GC RenderSceneSnapshot banks
  private bankIndex: 0 | 1 = 0;
  private readonly banks: [ParkourSnapshotBank, ParkourSnapshotBank] = [
    createSnapshotBank(PARKOUR_VIEWPORT_W, PARKOUR_VIEWPORT_H),
    createSnapshotBank(PARKOUR_VIEWPORT_W, PARKOUR_VIEWPORT_H),
  ];

  // Pre-allocated metadata objects & string ID caches (no per-frame heap allocs)
  private readonly hd2dConfig: Hd2dDepthConfig = {
    enabled: true,
    sortByDepthY: false,
    perspectiveSkew: 0,
    horizonHazeColor: '#16112e',
    horizonHazeAlpha: 0.14,
    tiltShiftAlpha: 0.12,
    pixelPerfect: true,
  };
  private readonly stageProgressInfo: StageProgressInfo = {
    index: 1,
    total: PARKOUR_STAGES.length,
    name: '',
  };
  private readonly bgStars: BgStarDesc[] = [];
  private readonly afterimages: AfterimageSlot[] = [];
  private readonly popups: FloatingPopupSlot[] = [];
  private popupCursor = 0;

  private readonly ringIds = makeIdList('ring', 32);
  private readonly zipIds = makeIdList('zip', 16);
  private readonly zipTrackIds = makeIdList('ziptrk', 64);
  private readonly crumbleIds = makeIdList('crumble', 32);
  private readonly crystalIds = makeIdList('crystal', 32);
  private readonly laserIds = makeIdList('laser', 128);
  private readonly laserHubIds = makeIdList('lhub', 32);
  private readonly cpIds = makeIdList('cp', 16);
  private readonly scarfIds = makeIdList('scarf', 8);
  private readonly linkIds = makeIdList('glink', GRAPPLE_LINKS);
  private readonly afterimageIds = makeIdList('after', AFTERIMAGE_COUNT);
  private readonly ikSegIds = makeIdList('ikseg', 16);
  private readonly ghostDotIds = makeIdList('ghost', 8);

  // Speedrun ghost trail TypedArrays (Zero-GC)
  private readonly currGhostX = new Float32Array(GHOST_MAX_SAMPLES);
  private readonly currGhostY = new Float32Array(GHOST_MAX_SAMPLES);
  private currGhostCount = 0;
  private ghostSampleTimer = 0;

  private readonly bestGhostX = new Float32Array(GHOST_MAX_SAMPLES);
  private readonly bestGhostY = new Float32Array(GHOST_MAX_SAMPLES);
  private bestGhostCount = 0;
  private bestGhostStageIdx = -1;

  // Stage runtime data
  private stageIdx = 0;
  private compiled!: CompiledParkourStage;
  private tilemap!: TilemapGrid;
  private zips: RuntimeZipBlock[] = [];
  private crumbles: RuntimeCrumbleBlock[] = [];
  private crystals: RuntimeCrystal[] = [];
  private lasers: RuntimeLaser[] = [];
  private checkpoints: RuntimeCheckpoint[] = [];

  // Campaign / progression state
  private status: 'playing' | 'won' | 'lost' = 'playing';
  private score = 0;
  private deathsCount = 0;
  private elapsedSec = 0;
  private stageElapsedSec = 0;
  private clearedStagesCount = 0;
  private debugHitboxes = false;
  private scoutMode = false;
  private noticeBanner = '';
  private noticeTimer = 0;

  // Hero state
  private hx = 64;
  private hy = 400;
  private hvx = 0;
  private hvy = 0;
  private prevHx = 64;
  private prevHy = 400;
  private onGround = false;
  private onWall: -1 | 0 | 1 = 0;
  private lastWallDir: -1 | 0 | 1 = 0;
  private coyoteTimer = 0;
  private wallCoyoteTimer = 0;
  private wallJumpLockTimer = 0;
  private wallSlideFxTimer = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private airDashSpent = false;
  private dashDirX = 1;
  private dashDirY = 0;
  private diagDownDashWindow = 0;
  private airJumpsLeft = 1;
  private facingLeft = false;
  private waveDashed = false;
  private slingshotAir = false;
  private walkAnim = 0;
  private afterimageSpawnTimer = 0;
  private afterimageCursor = 0;
  private squash: SquashSpring = { scaleX: 1, scaleY: 1, vx: 0, vy: 0 };

  // Checkpoint & respawn
  private checkpointX = 64;
  private checkpointY = 400;
  private respawnTimer = 0;
  private curlSpawnTimer = 0;

  // Grapple state
  private grappleState: GrappleState = 'idle';
  private grappleMode: GrappleMode = 'swing';
  private grappleAnchorX = 0;
  private grappleAnchorY = 0;
  private grappleTipX = 0;
  private grappleTipY = 0;
  private ropeLength = 96;
  private aimAngle = -Math.PI * 0.25;
  private grappleTargetKind: GrappleTargetKind = 'none';
  private grappleTargetZipIdx = -1;
  private grappleHoldViaInput = false;
  private grappleWaveTimer = 0;
  private grappleSwingElapsed = 0;
  private grapplePullElapsed = 0;

  // Reticle preview target (updated every step without allocation)
  private previewHitX = 0;
  private previewHitY = 0;
  private previewKind: GrappleTargetKind = 'none';
  private previewZipIdx = -1;

  // Stage 5 Two-Bone IK Boss Claw state
  private ikActive = false;
  private ikRootX = 0;
  private ikRootY = 0;
  private ikJointX = 0;
  private ikJointY = 0;
  private ikEndX = 0;
  private ikEndY = 0;
  private ikTargetX = 0;
  private ikTargetY = 0;
  private ikLungeTimer = 0;
  private ikLungeCooldown = 1.6;
  private ikAttacking = false;

  // Stable bound tile opacity probe (allocated once in constructor)
  private readonly isCellOpaque = (col: number, row: number): boolean => this.tilemap.isSolidAt(col, row);

  constructor(initialStage = 0) {
    this.camera.setViewport(PARKOUR_VIEWPORT_W, PARKOUR_VIEWPORT_H);

    for (let i = 0; i < 28; i++) {
      this.bgStars.push({
        x: (i * 79 + 19) % PARKOUR_VIEWPORT_W,
        y: (i * 43 + 11) % Math.round(PARKOUR_VIEWPORT_H * 0.72),
        size: i % 4 === 0 ? 2 : 1,
        phase: i * 0.65,
        color: i % 3 === 0 ? '#ff5d8f' : i % 2 === 0 ? '#5ec2f7' : '#fffaf0',
      });
    }

    for (let i = 0; i < AFTERIMAGE_COUNT; i++) {
      this.afterimages.push({
        active: false,
        x: 0,
        y: 0,
        sprite: 'parkour_hero_dash',
        flipX: false,
        life: 0,
        maxLife: 0.22,
        tint: '#5ec2f7',
      });
    }

    for (let i = 0; i < 8; i++) {
      this.popups.push({
        active: false,
        text: '',
        x: 0,
        y: 0,
        vy: -26,
        life: 0,
        maxLife: 0.72,
        color: '#fffaf0',
      });
    }

    this.loadStage(initialStage);
  }

  public getStageIndex(): number {
    return this.stageIdx;
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    return this.status;
  }

  public getComboCount(): number {
    return this.juice.comboCount;
  }

  public getDeathsCount(): number {
    return this.deathsCount;
  }

  public setDebugHitboxes(enabled: boolean): void {
    this.debugHitboxes = enabled;
  }

  public getScarfChain(): VerletChain {
    return this.scarf;
  }

  public getHeroState(): {
    x: number;
    y: number;
    vx: number;
    vy: number;
    onGround: boolean;
    onWall: -1 | 0 | 1;
    dashCooldown: number;
    dashTimer: number;
    airJumpsLeft: number;
    facingLeft: boolean;
    waveDashed: boolean;
  } {
    return {
      x: this.hx,
      y: this.hy,
      vx: this.hvx,
      vy: this.hvy,
      onGround: this.onGround,
      onWall: this.onWall,
      dashCooldown: this.dashCooldown,
      dashTimer: this.dashTimer,
      airJumpsLeft: this.airJumpsLeft,
      facingLeft: this.facingLeft,
      waveDashed: this.waveDashed,
    };
  }

  public getGrappleState(): {
    state: GrappleState;
    mode: GrappleMode;
    anchorX: number;
    anchorY: number;
    tipX: number;
    tipY: number;
    ropeLength: number;
    aimAngle: number;
    targetKind: GrappleTargetKind;
  } {
    return {
      state: this.grappleState,
      mode: this.grappleMode,
      anchorX: this.grappleAnchorX,
      anchorY: this.grappleAnchorY,
      tipX: this.grappleTipX,
      tipY: this.grappleTipY,
      ropeLength: this.ropeLength,
      aimAngle: this.aimAngle,
      targetKind: this.grappleTargetKind,
    };
  }

  public getIkClawJoints(): {
    rootX: number;
    rootY: number;
    jointX: number;
    jointY: number;
    endX: number;
    endY: number;
    active: boolean;
  } {
    return {
      rootX: this.ikRootX,
      rootY: this.ikRootY,
      jointX: this.ikJointX,
      jointY: this.ikJointY,
      endX: this.ikEndX,
      endY: this.ikEndY,
      active: this.ikActive,
    };
  }

  public loadStage(idx: number): void {
    const safeIdx = Math.max(0, Math.min(PARKOUR_STAGES.length - 1, idx | 0));
    this.stageIdx = safeIdx;
    this.compiled = compileParkourStage(safeIdx);
    this.tilemap = this.compiled.tilemap;
    const spec = this.compiled.spec;

    this.stageProgressInfo.index = safeIdx + 1;
    this.stageProgressInfo.total = PARKOUR_STAGES.length;
    this.stageProgressInfo.name = spec.name;

    this.hd2dConfig.horizonHazeColor = this.compiled.mood.skyBottom;
    this.hd2dConfig.pixelPerfect = true;
    if (safeIdx === 0 || safeIdx === 2) {
      this.hd2dConfig.waterLevelY = spec.worldHeight - 44;
      this.hd2dConfig.waterTint = '#3d2858';
    } else {
      this.hd2dConfig.waterLevelY = undefined;
      this.hd2dConfig.waterTint = undefined;
    }

    for (let i = 0; i < this.popups.length; i++) {
      this.popups[i].active = false;
    }

    this.zips = spec.zipBlocks.map((z) => ({
      startX: z.x,
      startY: z.y,
      endX: z.endX,
      endY: z.endY,
      x: z.x,
      y: z.y,
      vx: 0,
      vy: 0,
      w: z.w,
      h: z.h,
      speed: z.speed,
      phase: 'rest',
      waitTimer: 0,
    }));

    this.crumbles = spec.crumbleBlocks.map((c) => ({
      x: c.x,
      y: c.y,
      w: c.w,
      col: Math.max(0, Math.floor(c.x / TILE_SIZE)),
      row: Math.max(0, Math.floor(c.y / TILE_SIZE)),
      wCols: Math.max(1, Math.round(c.w / TILE_SIZE)),
      state: 'intact',
      timer: 0,
    }));

    this.crystals = spec.resetCrystals.map((c) => ({ x: c.x, y: c.y, cooldown: 0 }));
    this.lasers = spec.lasers.map((l) => ({
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      period: l.period,
      onDuration: l.onDuration,
      phase: l.phase,
      active: false,
      warning: false,
    }));
    this.checkpoints = spec.checkpoints.map((cp) => ({ x: cp.x, y: cp.y, activated: false }));

    this.status = 'playing';
    this.stageElapsedSec = 0;
    this.currGhostCount = 0;
    this.ghostSampleTimer = 0;
    this.noticeBanner = spec.hint;
    this.noticeTimer = 4.2;

    this.juice.reset();
    this.checkpointX = spec.spawn.x;
    this.checkpointY = spec.spawn.y;
    this.resetHeroToCheckpoint(true);

    this.camera.reset(this.hx + 8, this.hy + 8, 1.0, {
      minX: 0,
      minY: 0,
      maxX: spec.worldWidth,
      maxY: spec.worldHeight,
    });

    // Initialize Stage 5 Two-Bone IK Boss Claw
    this.ikActive = spec.hasIkBoss;
    if (this.ikActive) {
      this.ikRootX = Math.max(16, this.hx - 54);
      this.ikRootY = Math.max(24, this.hy - 88);
      this.ikTargetX = this.hx + 8;
      this.ikTargetY = this.hy + 8;
      this.ikLungeTimer = 0;
      this.ikLungeCooldown = 1.6;
      this.ikAttacking = false;
      this.solveIkClaw();
    } else {
      this.ikRootX = 0;
      this.ikRootY = 0;
      this.ikJointX = 0;
      this.ikJointY = 0;
      this.ikEndX = 0;
      this.ikEndY = 0;
    }

    this.refreshPreviewTarget();
  }

  public retryStage(): void {
    this.loadStage(this.stageIdx);
  }

  public dispatchCommand(commandId: string): SimEvent[] {
    if (commandId === 'retry_stage') {
      this.retryStage();
      return ['snap'];
    }
    if (commandId === 'cycle_weapon' || (commandId === 'next_stage' && this.stageIdx + 1 < PARKOUR_STAGES.length)) {
      this.loadStage((this.stageIdx + 1) % PARKOUR_STAGES.length);
      return ['snap'];
    }
    if (commandId === 'prev_stage' && this.stageIdx > 0) {
      this.loadStage(this.stageIdx - 1);
      return ['snap'];
    }
    return [];
  }

  public serializeSave(): unknown {
    return {
      v: 1,
      stageIdx: this.stageIdx,
      score: this.score,
      deathsCount: this.deathsCount,
      clearedStagesCount: this.clearedStagesCount,
      elapsedSec: Math.round(this.elapsedSec * 100) / 100,
    };
  }

  public hydrateSave(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const d = raw as {
      v?: number;
      stageIdx?: number;
      score?: number;
      deathsCount?: number;
      clearedStagesCount?: number;
      elapsedSec?: number;
    };
    if (d.v !== 1 || typeof d.stageIdx !== 'number') return false;
    this.score = Math.max(0, Math.round(d.score ?? 0));
    this.deathsCount = Math.max(0, Math.round(d.deathsCount ?? 0));
    this.clearedStagesCount = clamp(Math.round(d.clearedStagesCount ?? 0), 0, PARKOUR_STAGES.length);
    this.elapsedSec = Math.max(0, Number(d.elapsedSec ?? 0));
    this.loadStage(clamp(Math.round(d.stageIdx), 0, PARKOUR_STAGES.length - 1));
    return true;
  }

  public fireGrappleAt(dirX: number, dirY: number, mode: GrappleMode): boolean {
    const len = Math.hypot(dirX, dirY);
    if (len <= 1e-5) return false;
    const ndx = dirX / len;
    const ndy = dirY / len;
    this.aimAngle = Math.atan2(ndy, ndx);

    const ox = this.hx + 8;
    const oy = this.hy + 8;
    this.resolveGrappleTarget(ox, oy, ndx, ndy);
    if (this.previewKind === 'none') return false;

    this.grappleState = 'shooting';
    this.grappleMode = mode;
    this.grappleHoldViaInput = false;
    this.grappleAnchorX = this.previewHitX;
    this.grappleAnchorY = this.previewHitY;
    this.grappleTipX = ox;
    this.grappleTipY = oy;
    this.grappleTargetKind = this.previewKind;
    this.grappleTargetZipIdx = this.previewZipIdx;
    this.grappleSwingElapsed = 0;
    this.grapplePullElapsed = 0;
    return true;
  }

  private resetHeroToCheckpoint(fullReset: boolean): void {
    this.hx = this.checkpointX;
    this.hy = this.checkpointY;
    this.prevHx = this.hx;
    this.prevHy = this.hy;
    this.hvx = 0;
    this.hvy = 0;
    this.onGround = false;
    this.onWall = 0;
    this.lastWallDir = 0;
    this.coyoteTimer = 0;
    this.wallCoyoteTimer = 0;
    this.wallJumpLockTimer = 0;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.airDashSpent = false;
    this.diagDownDashWindow = 0;
    this.airJumpsLeft = 1;
    this.facingLeft = false;
    this.waveDashed = false;
    this.slingshotAir = false;
    this.respawnTimer = 0;
    this.grappleState = 'idle';
    this.grappleTargetKind = 'none';
    this.grappleTargetZipIdx = -1;
    this.grappleHoldViaInput = false;
    this.grappleWaveTimer = 0;
    this.squash = { scaleX: 1, scaleY: 1, vx: 0, vy: 0 };
    this.scarf.reset(this.hx + 6, this.hy + 7, -1, 0);

    for (let i = 0; i < this.afterimages.length; i++) {
      this.afterimages[i].active = false;
    }

    // Restore crumble blocks & crystals on respawn
    for (let i = 0; i < this.crumbles.length; i++) {
      const cb = this.crumbles[i];
      cb.state = 'intact';
      cb.timer = 0;
      this.tilemap.fillRectTiles(cb.col, cb.row, cb.wCols, 1, 2, COLLISION_SOLID);
    }
    for (let i = 0; i < this.crystals.length; i++) {
      this.crystals[i].cooldown = 0;
    }
    if (fullReset) {
      for (let i = 0; i < this.zips.length; i++) {
        const zb = this.zips[i];
        zb.x = zb.startX;
        zb.y = zb.startY;
        zb.vx = 0;
        zb.vy = 0;
        zb.phase = 'rest';
        zb.waitTimer = 0;
      }
    }
    if (this.ikActive) {
      this.ikRootX = Math.max(16, this.hx - 54);
      this.ikRootY = Math.max(24, this.hy - 88);
      this.ikTargetX = this.hx + 8;
      this.ikTargetY = this.hy + 8;
      this.ikLungeTimer = 0;
      this.ikLungeCooldown = 1.6;
      this.ikAttacking = false;
      this.solveIkClaw();
    }
  }

  private resolveGrappleTarget(ox: number, oy: number, ndx: number, ndy: number): void {
    let bestKind: GrappleTargetKind = 'none';
    let bestDist = Infinity;
    let bestX = ox + ndx * 64;
    let bestY = oy + ndy * 64;
    let bestZipIdx = -1;

    // 1. Smart Magnetic Cone Assist (±26° and 155px radius) for grappleRing & zipBlock
    const rings = this.compiled.spec.grappleRings;
    for (let i = 0; i < rings.length; i++) {
      const rg = rings[i];
      const vx = rg.x - ox;
      const vy = rg.y - oy;
      const dist = Math.hypot(vx, vy);
      if (dist < 10 || dist > MAGNET_RADIUS || dist >= bestDist) continue;
      const dot = (vx * ndx + vy * ndy) / dist;
      if (dot < MAGNET_COS_HALF_ANGLE) continue;
      // Ensure no solid tile blocks line of sight before reaching the ring
      if (
        dist > 14 &&
        raycastGrid2DInto(
          this.tilemap.cols,
          this.tilemap.rows,
          ox,
          oy,
          vx / dist,
          vy / dist,
          dist - 6,
          this.isCellOpaque,
          this.rayScratch,
          0,
          TILE_SIZE,
        )
      ) {
        continue;
      }
      bestKind = 'ring';
      bestDist = dist;
      bestX = rg.x;
      bestY = rg.y;
      bestZipIdx = -1;
    }

    for (let i = 0; i < this.zips.length; i++) {
      const zb = this.zips[i];
      const zx = zb.x + zb.w * 0.5;
      const zy = zb.y + zb.h * 0.5;
      const vx = zx - ox;
      const vy = zy - oy;
      const dist = Math.hypot(vx, vy);
      if (dist < 10 || dist > MAGNET_RADIUS || dist >= bestDist) continue;
      const dot = (vx * ndx + vy * ndy) / dist;
      if (dot < MAGNET_COS_HALF_ANGLE) continue;
      if (
        dist > 16 &&
        raycastGrid2DInto(
          this.tilemap.cols,
          this.tilemap.rows,
          ox,
          oy,
          vx / dist,
          vy / dist,
          dist - 10,
          this.isCellOpaque,
          this.rayScratch,
          0,
          TILE_SIZE,
        )
      ) {
        continue;
      }
      bestKind = 'zip';
      bestDist = dist;
      bestX = zx;
      bestY = zy;
      bestZipIdx = i;
    }

    if (bestKind !== 'none') {
      this.previewKind = bestKind;
      this.previewHitX = bestX;
      this.previewHitY = bestY;
      this.previewZipIdx = bestZipIdx;
      return;
    }

    // 2. Fallback: exact Zero-GC 2D DDA raycast against tilemap collision grid
    const hit = raycastGrid2DInto(
      this.tilemap.cols,
      this.tilemap.rows,
      ox,
      oy,
      ndx,
      ndy,
      GRAPPLE_MAX_RANGE,
      this.isCellOpaque,
      this.rayScratch,
      0,
      TILE_SIZE,
    );
    if (hit && this.rayScratch[1] >= 6) {
      this.previewKind = 'wall';
      this.previewHitX = this.rayScratch[2];
      this.previewHitY = this.rayScratch[3];
      this.previewZipIdx = -1;
    } else {
      this.previewKind = 'none';
      this.previewHitX = ox + ndx * 64;
      this.previewHitY = oy + ndy * 64;
      this.previewZipIdx = -1;
    }
  }

  private refreshPreviewTarget(): void {
    const ox = this.hx + 8;
    const oy = this.hy + 8;
    this.resolveGrappleTarget(ox, oy, Math.cos(this.aimAngle), Math.sin(this.aimAngle));
  }

  private updateAim(dt: number): void {
    if (this.input.pointerActive()) {
      const zoom = Math.max(0.5, this.camera.zoom);
      const mouseWorldX = this.camera.x + (this.input.pointerX() - 0.5) * (PARKOUR_VIEWPORT_W / zoom);
      const mouseWorldY = this.camera.y + (this.input.pointerY() - 0.5) * (PARKOUR_VIEWPORT_H / zoom);
      this.aimAngle = Math.atan2(mouseWorldY - (this.hy + 8), mouseWorldX - (this.hx + 8));
      return;
    }

    const rx = this.input.rightAxisX();
    const ry = this.input.rightAxisY();
    let hasDesired = false;
    let desiredAngle = this.aimAngle;

    if (rx * rx + ry * ry > 0.04) {
      desiredAngle = Math.atan2(ry, rx);
      hasDesired = true;
    } else {
      const mx = this.input.axisX();
      const my = this.input.axisY();
      if (mx !== 0 || my !== 0) {
        desiredAngle = Math.atan2(my, mx);
        hasDesired = true;
      }
    }

    if (hasDesired) {
      const diff = wrapAngle(desiredAngle - this.aimAngle);
      const maxStep = AIM_ROT_SPEED * dt;
      if (Math.abs(diff) <= maxStep) {
        this.aimAngle = desiredAngle;
      } else {
        this.aimAngle = wrapAngle(this.aimAngle + Math.sign(diff) * maxStep);
      }
    }
  }

  private probeWalls(): -1 | 0 | 1 {
    const y0 = this.hy + HB_Y + 2;
    const y1 = this.hy + HB_Y + HB_H - 3;
    const r0 = Math.max(0, Math.floor(y0 / TILE_SIZE));
    const r1 = Math.min(this.tilemap.rows - 1, Math.floor(y1 / TILE_SIZE));

    const leftCol = Math.floor((this.hx + HB_X - 1) / TILE_SIZE);
    if (leftCol >= 0) {
      for (let r = r0; r <= r1; r++) {
        if (this.tilemap.isSolidAt(leftCol, r)) return -1;
      }
    }
    const rightCol = Math.floor((this.hx + HB_X + HB_W + 1) / TILE_SIZE);
    if (rightCol < this.tilemap.cols) {
      for (let r = r0; r <= r1; r++) {
        if (this.tilemap.isSolidAt(rightCol, r)) return 1;
      }
    }
    return 0;
  }

  private findFloorDropY(cx: number, bottomY: number): number | null {
    const col = Math.floor(cx / TILE_SIZE);
    if (col < 0 || col >= this.tilemap.cols) return null;
    const rStart = Math.max(0, Math.floor((bottomY - 2) / TILE_SIZE));
    const rEnd = Math.min(this.tilemap.rows - 1, Math.floor((bottomY + 46) / TILE_SIZE));
    for (let r = rStart; r <= rEnd; r++) {
      if (this.tilemap.isSolidAt(col, r) || this.tilemap.isOneWayAt(col, r)) {
        const delta = r * TILE_SIZE - bottomY;
        if (delta >= -2) return Math.max(0, delta);
      }
    }
    return null;
  }

  private resolveHeroTileMotion(dt: number): void {
    this.heroBox.x = this.hx;
    this.heroBox.y = this.hy;
    this.heroBox.vx = this.hvx;
    this.heroBox.vy = this.hvy;
    this.tilemap.resolveAabbMotion(this.heroBox, HB_X, HB_Y, HB_W, HB_H, dt, this.aabbOut);
    this.hx = this.heroBox.x;
    this.hy = this.heroBox.y;
    this.hvx = this.heroBox.vx;
    this.hvy = this.heroBox.vy;
    this.onGround = this.aabbOut.onGround;

    // Also allow standing on top of zipBlocks as dynamic moving platforms
    const hbLeft = this.hx + HB_X;
    const hbRight = hbLeft + HB_W;
    const hbBot = this.hy + HB_Y + HB_H;
    const prevBot = hbBot - this.hvy * dt;
    for (let i = 0; i < this.zips.length; i++) {
      const zb = this.zips[i];
      if (hbRight > zb.x + 1 && hbLeft < zb.x + zb.w - 1) {
        if (this.hvy >= 0 && prevBot <= zb.y + 6 && hbBot >= zb.y) {
          this.hy = zb.y - HB_Y - HB_H;
          this.hvy = 0;
          this.onGround = true;
          this.hx = clamp(this.hx + zb.vx * dt, 0, this.compiled.spec.worldWidth - 16);
        }
      }
    }
  }

  private spawnPopup(text: string, x: number, y: number, color: string, maxLife = 0.72): void {
    let target = this.popups[this.popupCursor];
    for (let i = 0; i < this.popups.length; i++) {
      if (!this.popups[i].active) {
        target = this.popups[i];
        break;
      }
    }
    this.popupCursor = (this.popupCursor + 1) % this.popups.length;
    target.active = true;
    target.text = text;
    target.x = x;
    target.y = y;
    target.vy = -26;
    target.life = 0;
    target.maxLife = maxLife;
    target.color = color;
  }

  private spawnAfterimage(tint: string): void {
    const slot = this.afterimages[this.afterimageCursor];
    this.afterimageCursor = (this.afterimageCursor + 1) % AFTERIMAGE_COUNT;
    slot.active = true;
    slot.x = this.hx;
    slot.y = this.hy;
    slot.sprite = this.dashTimer > 0 ? 'parkour_hero_dash' : 'parkour_hero_jump';
    slot.flipX = this.facingLeft;
    slot.life = 0.22;
    slot.maxLife = 0.22;
    slot.tint = tint;
  }

  private triggerWaveDashJump(params: RuntimeParams, dirSign: number, sparkDensity: number): void {
    this.input.consumeBuffer('jump');
    this.waveDashed = true;
    this.hvx = dirSign * Math.max(params.moveSpeed * 1.85, 195);
    this.hvy = -params.jumpPower * 0.92;
    this.dashTimer = 0;
    this.diagDownDashWindow = 0;
    this.onGround = false;
    this.coyoteTimer = 0;
    this.airDashSpent = false;
    this.dashCooldown = 0;
    this.airJumpsLeft = 1;
    this.facingLeft = dirSign < 0;
    triggerSquash(this.squash, 1.44, 0.62);
    this.juice.applyPreset('dash_kick', { dirX: dirSign, dirY: -0.4 });
    this.juice.registerCombo();
    this.juice.spawnCurlStream(this.hx + 8, this.hy + 14, ['#ff5d8f', '#ffd447', '#fffaf0'], 10, {
      vx: -dirSign * 42,
      vy: -24,
      spread: 28,
      curlStrength: 65,
      maxLife: 0.45,
      size: 4,
      sprite: 'sparkle',
      additive: true,
    });
    this.juice.spawnBurst(this.hx + 8, this.hy + 15, ['#ff5d8f', '#ffd447'], 6, sparkDensity, {
      gravity: 100,
      liftY: -18,
    });
    this.spawnPopup('WAVE DASH!', this.hx + 8, this.hy - 8, '#ff5d8f');
    this.stepEvents.push('jump', 'snap');
  }

  private releaseSwing(boost: boolean, sparkDensity: number): void {
    this.grappleState = 'idle';
    this.grappleTargetKind = 'none';
    this.grappleTargetZipIdx = -1;
    this.grappleHoldViaInput = false;
    this.coyoteTimer = 0;
    this.input.consumeBuffer('jump');
    this.airDashSpent = false;
    this.dashCooldown = 0;
    this.airJumpsLeft = 1;

    if (boost) {
      this.slingshotAir = true;
      this.hvx *= 1.22;
      this.hvy = Math.min(this.hvy * 1.22 - 70, -135);
      // Cap extreme slingshot launch so controls remain responsive
      const spd = Math.hypot(this.hvx, this.hvy);
      if (spd > 420) {
        const s = 420 / spd;
        this.hvx *= s;
        this.hvy *= s;
      }
      triggerSquash(this.squash, 0.74, 1.28);
      this.juice.registerCombo();
      this.juice.spawnCurlStream(this.hx + 8, this.hy + 8, ['#ff5d8f', '#ffd447', '#fffaf0'], 8, {
        vx: this.hvx * 0.25,
        vy: this.hvy * 0.25,
        spread: 32,
        curlStrength: 55,
        maxLife: 0.42,
        sprite: 'sparkle',
        additive: true,
      });
      this.juice.spawnBurst(this.hx + 8, this.hy + 8, ['#ffd447', '#ff5d8f'], 6, sparkDensity, {
        gravity: 80,
        liftY: -20,
      });
      this.spawnPopup('SLINGSHOT!', this.hx + 8, this.hy - 8, '#ffd447');
      this.stepEvents.push('jump');
    }
  }

  private solveIkClaw(): void {
    solveTwoBoneIkInto(
      this.ikRootX,
      this.ikRootY,
      this.ikTargetX,
      this.ikTargetY,
      74,
      68,
      -1,
      this.ikScratch,
      0,
    );
    this.ikJointX = this.ikScratch[0];
    this.ikJointY = this.ikScratch[1];
    this.ikEndX = this.ikScratch[2];
    this.ikEndY = this.ikScratch[3];
  }

  private killHero(sparkDensity: number): void {
    if (this.respawnTimer > 0 || this.status !== 'playing') return;
    this.deathsCount++;
    this.respawnTimer = RESPAWN_DELAY_SEC;
    this.grappleState = 'idle';
    this.grappleTargetKind = 'none';
    this.grappleTargetZipIdx = -1;
    this.grappleHoldViaInput = false;
    this.dashTimer = 0;
    this.waveDashed = false;
    this.slingshotAir = false;
    this.juice.applyPreset('player_hurt');
    this.juice.spawnBurst(this.hx + 8, this.hy + 8, ['#ff5d8f', '#ffd447', '#fffaf0'], 14, sparkDensity, {
      gravity: 90,
      liftY: -20,
    });
    this.stepEvents.push('hurt');
  }

  private stepWorldProps(dt: number, sparkDensity: number): void {
    // 1. Update ZipBlocks along track
    for (let i = 0; i < this.zips.length; i++) {
      const zb = this.zips[i];
      if (zb.phase === 'surging') {
        const dx = zb.endX - zb.x;
        const dy = zb.endY - zb.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= zb.speed * dt + 1) {
          zb.x = zb.endX;
          zb.y = zb.endY;
          zb.vx = 0;
          zb.vy = 0;
          zb.phase = 'returning';
          zb.waitTimer = 0.35;
        } else {
          zb.vx = (dx / dist) * zb.speed;
          zb.vy = (dy / dist) * zb.speed;
          zb.x += zb.vx * dt;
          zb.y += zb.vy * dt;
        }
      } else if (zb.phase === 'returning') {
        if (zb.waitTimer > 0) {
          zb.waitTimer -= dt;
          zb.vx = 0;
          zb.vy = 0;
        } else {
          const dx = zb.startX - zb.x;
          const dy = zb.startY - zb.y;
          const dist = Math.hypot(dx, dy);
          const retSpd = zb.speed * 0.38;
          if (dist <= retSpd * dt + 1) {
            zb.x = zb.startX;
            zb.y = zb.startY;
            zb.vx = 0;
            zb.vy = 0;
            zb.phase = 'rest';
          } else {
            zb.vx = (dx / dist) * retSpd;
            zb.vy = (dy / dist) * retSpd;
            zb.x += zb.vx * dt;
            zb.y += zb.vy * dt;
          }
        }
      }
    }

    // 2. Update CrumbleBlocks (touch triggers 0.45s shake, then collapses for 2.4s)
    const hbLeft = this.hx + HB_X;
    const hbRight = hbLeft + HB_W;
    const hbBot = this.hy + HB_Y + HB_H;
    for (let i = 0; i < this.crumbles.length; i++) {
      const cb = this.crumbles[i];
      if (cb.state === 'intact') {
        const standingOn = this.onGround && Math.abs(hbBot - cb.y) <= 2 && hbRight > cb.x && hbLeft < cb.x + cb.w;
        const wallTouch =
          this.onWall !== 0 &&
          this.hy + HB_Y + HB_H > cb.y &&
          this.hy + HB_Y < cb.y + TILE_SIZE &&
          ((this.onWall === 1 && Math.abs(hbRight - cb.x) <= 2) || (this.onWall === -1 && Math.abs(hbLeft - (cb.x + cb.w)) <= 2));
        if (standingOn || wallTouch) {
          cb.state = 'shaking';
          cb.timer = 0.45;
          this.stepEvents.push('bounce');
        }
      } else if (cb.state === 'shaking') {
        cb.timer -= dt;
        if (cb.timer <= 0) {
          cb.state = 'broken';
          cb.timer = 2.4;
          this.tilemap.fillRectTiles(cb.col, cb.row, cb.wCols, 1, 0, COLLISION_EMPTY);
          this.juice.spawnBurst(cb.x + cb.w * 0.5, cb.y + 8, ['#f59b23', '#fffaf0'], 8, sparkDensity, {
            gravity: 160,
            liftY: -10,
          });
        }
      } else {
        cb.timer -= dt;
        if (cb.timer <= 0) {
          cb.state = 'intact';
          this.tilemap.fillRectTiles(cb.col, cb.row, cb.wCols, 1, 2, COLLISION_SOLID);
        }
      }
    }

    // 3. Update Reset Crystals
    const hcx = this.hx + 8;
    const hcy = this.hy + 8;
    for (let i = 0; i < this.crystals.length; i++) {
      const cr = this.crystals[i];
      if (cr.cooldown > 0) {
        cr.cooldown = Math.max(0, cr.cooldown - dt);
        continue;
      }
      if (Math.hypot(hcx - cr.x, hcy - cr.y) <= 15) {
        cr.cooldown = 2.4;
        this.airDashSpent = false;
        this.dashCooldown = 0;
        this.airJumpsLeft = 1;
        this.juice.triggerHitstop(0.018);
        this.juice.registerCombo();
        this.juice.spawnBurst(cr.x, cr.y, ['#56d39c', '#fffaf0', '#5ec2f7'], 10, sparkDensity, {
          gravity: 40,
          liftY: -16,
        });
        this.spawnPopup('DASH RESET!', cr.x, cr.y - 12, '#56d39c');
        this.stepEvents.push('star');
      }
    }

    // 4. Update Timed Lasers
    for (let i = 0; i < this.lasers.length; i++) {
      const lz = this.lasers[i];
      const cyc = (this.stageElapsedSec + lz.phase) % lz.period;
      lz.active = cyc < lz.onDuration;
      lz.warning = !lz.active && cyc > lz.period - 0.35;
      if (lz.active) {
        if (
          this.hx + HB_X + HB_W > lz.x + 3 &&
          this.hx + HB_X < lz.x + lz.w - 3 &&
          this.hy + HB_Y + HB_H > lz.y &&
          this.hy + HB_Y < lz.y + lz.h
        ) {
          this.killHero(sparkDensity);
          return;
        }
      }
    }

    // 5. Update Updraft Wind Zones & Curl Noise Particle Streams
    const camCenterX = this.camera.x;
    const camCenterY = this.camera.y;
    this.curlSpawnTimer -= dt;
    const emitCurl = this.curlSpawnTimer <= 0;
    if (emitCurl) this.curlSpawnTimer = 0.08;

    const updrafts = this.compiled.spec.updrafts;
    for (let i = 0; i < updrafts.length; i++) {
      const u = updrafts[i];
      // Hero lift force when inside updraft zone (disabled during dash/zip-pull)
      if (
        this.dashTimer <= 0 &&
        this.grappleState !== 'pulling' &&
        hcx >= u.x &&
        hcx <= u.x + u.w &&
        hcy >= u.y &&
        hcy <= u.y + u.h
      ) {
        this.hvy = Math.max(-210, this.hvy - u.liftAccel * dt);
        if (u.windX) this.hvx += u.windX * dt;
      }

      // Spawn divergence-free curlNoise2DInto stream particles in visible updrafts
      if (
        emitCurl &&
        u.x + u.w >= camCenterX - 320 &&
        u.x <= camCenterX + 320 &&
        u.y + u.h >= camCenterY - 220 &&
        u.y <= camCenterY + 220
      ) {
        const px = u.x + ((this.stageElapsedSec * 197 + i * 53) % Math.max(16, u.w));
        const py = u.y + u.h - 14 - ((i * 29) % 24);
        this.juice.spawnCurlStream(
          px,
          py,
          this.stageIdx === 0 ? ['#ff5d8f', '#ffd447', '#fffaf0'] : ['#72efdd', '#5ec2f7', '#fffaf0'],
          2,
          {
            vx: u.windX ?? 0,
            vy: -92,
            spread: 18,
            curlStrength: 85,
            curlScale: 0.022,
            maxLife: 0.95,
            size: 3.5,
            sprite: 'sparkle',
            additive: true,
          },
        );
      }
    }

    // 6. Update Stage 5 Two-Bone IK Boss Claw Pursuit
    if (this.ikActive) {
      const spec = this.compiled.spec;
      const desiredRootX = clamp(this.hx - 48 + Math.sin(this.stageElapsedSec * 1.4) * 16, 24, spec.worldWidth - 32);
      const desiredRootY = clamp(this.hy - 84 + Math.cos(this.stageElapsedSec * 1.8) * 14, 24, spec.worldHeight - 48);
      const rootLerp = Math.min(1, dt * 4.5);
      this.ikRootX += (desiredRootX - this.ikRootX) * rootLerp;
      this.ikRootY += (desiredRootY - this.ikRootY) * rootLerp;

      if (this.ikAttacking) {
        this.ikLungeTimer -= dt;
        const aimLerp = Math.min(1, dt * 9.5);
        this.ikTargetX += (hcx - this.ikTargetX) * aimLerp;
        this.ikTargetY += (hcy - this.ikTargetY) * aimLerp;
        if (this.ikLungeTimer <= 0) {
          this.ikAttacking = false;
          this.ikLungeCooldown = 1.45;
        }
      } else {
        this.ikLungeCooldown -= dt;
        const hoverX = hcx - 26 + Math.cos(this.stageElapsedSec * 2.5) * 18;
        const hoverY = hcy - 28 + Math.sin(this.stageElapsedSec * 3.1) * 14;
        const trackLerp = Math.min(1, dt * 5.2);
        this.ikTargetX += (hoverX - this.ikTargetX) * trackLerp;
        this.ikTargetY += (hoverY - this.ikTargetY) * trackLerp;
        if (this.ikLungeCooldown <= 0) {
          this.ikAttacking = true;
          this.ikLungeTimer = 0.55;
        }
      }

      this.solveIkClaw();

      // Claw strike check during lunge (dash i-frames grant clean evade!)
      if (this.ikAttacking && this.dashTimer <= 0 && Math.hypot(hcx - this.ikEndX, hcy - this.ikEndY) < 11) {
        this.killHero(sparkDensity);
        return;
      }
    }

    // 7. Checkpoints & Exit Gate
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      if (!cp.activated && Math.hypot(hcx - (cp.x + 8), hcy - (cp.y + 8)) < 18) {
        cp.activated = true;
        this.checkpointX = cp.x;
        this.checkpointY = cp.y - 2;
        this.score += 150;
        this.noticeBanner = '🚩 已啟動檢查點！瞬時重生點更新';
        this.noticeTimer = 2.2;
        this.juice.spawnBurst(cp.x + 8, cp.y + 8, ['#56d39c', '#ffd447', '#fffaf0'], 10, sparkDensity, {
          gravity: 70,
          liftY: -20,
        });
        this.spawnPopup('CHECKPOINT!', cp.x + 8, cp.y - 16, '#ffd447');
        this.stepEvents.push('star');
      }
    }

    const gate = this.compiled.spec.exitGate;
    if (Math.hypot(hcx - (gate.x + 12), hcy - (gate.y + 12)) < 20) {
      // Save speedrun ghost trail on stage completion
      this.bestGhostCount = this.currGhostCount;
      this.bestGhostStageIdx = this.stageIdx;
      for (let i = 0; i < this.currGhostCount; i++) {
        this.bestGhostX[i] = this.currGhostX[i];
        this.bestGhostY[i] = this.currGhostY[i];
      }

      this.score += 500;
      this.clearedStagesCount = Math.max(this.clearedStagesCount, this.stageIdx + 1);
      this.stepEvents.push('win');
      if (this.stageIdx + 1 < PARKOUR_STAGES.length) {
        this.loadStage(this.stageIdx + 1);
      } else {
        this.status = 'won';
        this.noticeBanner = '🏆 全 5 大試煉突破！緋空傳說達成！';
        this.noticeTimer = 99;
      }
    }
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    this.stepEvents.length = 0;
    this.input.update(rawInput, dt);

    if (this.input.justPressed('shoulderL')) {
      this.retryStage();
      this.stepEvents.push('snap');
      return this.stepEvents;
    }

    if (this.noticeTimer > 0) this.noticeTimer = Math.max(0, this.noticeTimer - dt);
    this.scoutMode = this.input.held('skillX');

    const simDt = this.juice.advanceRealTime(dt, params.shakeScale);
    if (this.grappleWaveTimer > 0) this.grappleWaveTimer = Math.max(0, this.grappleWaveTimer - dt);

    // Update afterimage ring buffer & Zero-GC floating popup pool timers
    for (let i = 0; i < AFTERIMAGE_COUNT; i++) {
      const af = this.afterimages[i];
      if (af.active) {
        af.life -= dt;
        if (af.life <= 0) af.active = false;
      }
    }
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
      } else {
        p.y += p.vy * dt;
        p.vy *= Math.pow(0.25, dt);
      }
    }

    if (this.status !== 'playing') {
      this.camera.step(dt, this.hx + 8, this.hy + 8, 0, 0);
      return this.stepEvents;
    }

    if (simDt <= 0) {
      this.camera.step(dt, this.hx + 8, this.hy + 8, this.hvx, this.hvy);
      return this.stepEvents;
    }

    this.elapsedSec += simDt;
    this.stageElapsedSec += simDt;

    // 0.18s Zero-wait checkpoint respawn
    if (this.respawnTimer > 0) {
      this.respawnTimer = Math.max(0, this.respawnTimer - simDt);
      if (this.respawnTimer <= 0) {
        this.resetHeroToCheckpoint(false);
        this.juice.spawnBurst(this.hx + 8, this.hy + 8, ['#5ec2f7', '#fffaf0'], 8, params.sparkleDensity, {
          gravity: 50,
          liftY: -12,
        });
      }
      this.camera.step(simDt, this.hx + 8, this.hy + 8, 0, 0);
      return this.stepEvents;
    }

    this.prevHx = this.hx;
    this.prevHy = this.hy;
    stepSquashSpring(this.squash, simDt, 14);

    if (this.diagDownDashWindow > 0) {
      this.diagDownDashWindow = Math.max(0, this.diagDownDashWindow - simDt);
    }
    if (this.wallJumpLockTimer > 0) {
      this.wallJumpLockTimer = Math.max(0, this.wallJumpLockTimer - simDt);
    }

    // Update 360-deg smooth aiming & preview target
    this.updateAim(simDt);
    this.refreshPreviewTarget();

    // Handle Grapple Shoot inputs
    if (this.grappleState === 'idle') {
      if (this.input.justPressed('skillY') || this.input.pointerPrimaryJustPressed()) {
        if (this.fireGrappleAt(Math.cos(this.aimAngle), Math.sin(this.aimAngle), 'swing')) {
          this.grappleHoldViaInput = true;
          this.stepEvents.push('rail');
        }
      } else if (this.input.justPressed('shoulderR') || this.input.pointerSecondaryJustPressed()) {
        if (this.fireGrappleAt(Math.cos(this.aimAngle), Math.sin(this.aimAngle), 'pull')) {
          this.grappleHoldViaInput = false;
          this.stepEvents.push('rail');
        }
      }
    }

    if (
      (this.input.held('skillY') || this.input.pointerPrimaryHeld()) &&
      (this.grappleState === 'shooting' || this.grappleState === 'swinging')
    ) {
      this.grappleHoldViaInput = true;
    }

    // 1. Grapple Shooting Flight (720 px/s)
    if (this.grappleState === 'shooting') {
      if (this.grappleTargetZipIdx >= 0) {
        const zb = this.zips[this.grappleTargetZipIdx];
        this.grappleAnchorX = zb.x + zb.w * 0.5;
        this.grappleAnchorY = zb.y + zb.h * 0.5;
      }
      const dx = this.grappleAnchorX - this.grappleTipX;
      const dy = this.grappleAnchorY - this.grappleTipY;
      const rem = Math.hypot(dx, dy);
      const stepDist = GRAPPLE_SHOOT_SPEED * simDt;
      if (rem <= stepDist + 6) {
        this.grappleTipX = this.grappleAnchorX;
        this.grappleTipY = this.grappleAnchorY;
        this.grappleWaveTimer = 0.28;
        this.juice.triggerHitstop(0.018);
        this.juice.addTrauma(0.14);
        this.juice.registerCombo();
        this.stepEvents.push('snap');
        this.juice.spawnBurst(
          this.grappleAnchorX,
          this.grappleAnchorY,
          ['#ffd447', '#ff5d8f', '#fffaf0'],
          8,
          params.sparkleDensity,
          { gravity: 60, liftY: -10 },
        );
        this.juice.spawnCurlStream(this.grappleAnchorX, this.grappleAnchorY, ['#ff5d8f', '#ffd447'], 5, {
          vx: 0,
          vy: -16,
          spread: 36,
          curlStrength: 60,
          maxLife: 0.36,
          sprite: 'sparkle',
          additive: true,
        });
        this.airDashSpent = false;
        this.dashCooldown = 0;
        this.airJumpsLeft = 1;
        this.dashTimer = 0;
        this.coyoteTimer = 0;
        this.slingshotAir = false;

        if (this.grappleMode === 'swing') {
          this.grappleState = 'swinging';
          this.grappleSwingElapsed = 0;
          const distToHero = Math.hypot(this.hx + 8 - this.grappleAnchorX, this.hy + 8 - this.grappleAnchorY);
          this.ropeLength = clamp(distToHero, 26, 140);
        } else {
          this.grappleState = 'pulling';
          this.grapplePullElapsed = 0;
          if (this.grappleTargetZipIdx >= 0) {
            const zb = this.zips[this.grappleTargetZipIdx];
            zb.phase = 'surging';
            zb.waitTimer = 0;
          }
        }
      } else {
        this.grappleTipX += (dx / rem) * stepDist;
        this.grappleTipY += (dy / rem) * stepDist;
      }
    }

    // 2. Hero Locomotion / Swing / Pull / Omni-Dash Physics
    let handledMotion = false;
    let releasedSwingByJump = false;

    if (this.grappleState === 'swinging') {
      this.grappleSwingElapsed += simDt;

      // Press A or Right Mouse Click while swinging -> Zip-Pull toward anchor!
      if (this.input.justPressed('action') || this.input.pointerSecondaryJustPressed()) {
        this.grappleMode = 'pull';
        this.grappleState = 'pulling';
        this.grapplePullElapsed = 0;
        this.grappleHoldViaInput = false;
        if (this.grappleTargetZipIdx >= 0) {
          const zb = this.zips[this.grappleTargetZipIdx];
          zb.phase = 'surging';
          zb.waitTimer = 0;
        }
        this.stepEvents.push('snap');
      } else if (
        (this.grappleHoldViaInput &&
          !(this.input.held('skillY') || this.input.pointerPrimaryHeld()) &&
          this.grappleSwingElapsed > 0.02) ||
        this.input.justPressed('jump')
      ) {
        releasedSwingByJump = this.input.justPressed('jump');
        this.releaseSwing(true, params.sparkleDensity);
      } else {
        // Circular Pendulum Swing physics
        handledMotion = true;
        if (!this.onGround) this.coyoteTimer = 0;
        if (this.grappleTargetZipIdx >= 0) {
          const zb = this.zips[this.grappleTargetZipIdx];
          this.grappleAnchorX = zb.x + zb.w * 0.5;
          this.grappleAnchorY = zb.y + zb.h * 0.5;
        }

        const reel = this.input.axisY();
        if (reel !== 0) {
          this.ropeLength = clamp(this.ropeLength + reel * 115 * simDt, 26, 140);
        }

        // Gravity
        this.hvy += 620 * params.gravityScale * simDt;

        // Tangential pump & pre-integration radial cancellation
        const hcx = this.hx + 8;
        const hcy = this.hy + 8;
        const dx0 = hcx - this.grappleAnchorX;
        const dy0 = hcy - this.grappleAnchorY;
        const r0 = Math.hypot(dx0, dy0);
        if (r0 > 1e-4) {
          const ux = dx0 / r0;
          const uy = dy0 / r0;
          const tx = uy;
          const ty = -ux;
          const pump = this.input.axisX();
          if (pump !== 0) {
            this.hvx += tx * pump * 480 * simDt;
            this.hvy += ty * pump * 480 * simDt;
            this.facingLeft = pump < 0;
          }
          const vDotU0 = this.hvx * ux + this.hvy * uy;
          if (vDotU0 > 0) {
            this.hvx -= vDotU0 * ux;
            this.hvy -= vDotU0 * uy;
          }
        }

        const spd = Math.hypot(this.hvx, this.hvy);
        if (spd > 460) {
          const s = 460 / spd;
          this.hvx *= s;
          this.hvy *= s;
        }

        this.resolveHeroTileMotion(simDt);

        // Post-integration radial clamp (r > L) + cancel outward radial velocity (v·u)u
        const cx1 = this.hx + 8;
        const cy1 = this.hy + 8;
        const dx1 = cx1 - this.grappleAnchorX;
        const dy1 = cy1 - this.grappleAnchorY;
        const r1 = Math.hypot(dx1, dy1);
        if (r1 > this.ropeLength && r1 > 1e-4) {
          const ux = dx1 / r1;
          const uy = dy1 / r1;
          const targetHx = this.grappleAnchorX + ux * this.ropeLength - 8;
          const targetHy = this.grappleAnchorY + uy * this.ropeLength - 8;
          const stepDx = targetHx - this.hx;
          const stepDy = targetHy - this.hy;
          const invDt = 1 / Math.max(1e-5, simDt);
          // Slide safely against solid tiles when snapping back onto circle
          this.heroBox.x = this.hx;
          this.heroBox.y = this.hy;
          this.heroBox.vx = stepDx * invDt;
          this.heroBox.vy = stepDy * invDt;
          this.tilemap.resolveAabbMotion(this.heroBox, HB_X, HB_Y, HB_W, HB_H, simDt, this.aabbOut);
          this.hx = this.heroBox.x;
          this.hy = this.heroBox.y;
          if (stepDy < -0.01) this.onGround = false;

          const vDotU1 = this.hvx * ux + this.hvy * uy;
          if (vDotU1 > 0) {
            this.hvx -= vDotU1 * ux;
            this.hvy -= vDotU1 * uy;
          }
        }

        this.onWall = this.probeWalls();
        this.grappleTipX = this.grappleAnchorX;
        this.grappleTipY = this.grappleAnchorY;
      }
    }

    if (!handledMotion && this.grappleState === 'pulling') {
      handledMotion = true;
      this.grapplePullElapsed += simDt;
      if (this.grappleTargetZipIdx >= 0) {
        const zb = this.zips[this.grappleTargetZipIdx];
        this.grappleAnchorX = zb.x + zb.w * 0.5;
        this.grappleAnchorY = zb.y + zb.h * 0.5;
      }
      this.grappleTipX = this.grappleAnchorX;
      this.grappleTipY = this.grappleAnchorY;

      if (this.input.justPressed('jump')) {
        this.input.consumeBuffer('jump');
        this.coyoteTimer = 0;
        this.grappleState = 'idle';
        this.grappleTargetKind = 'none';
        this.grappleTargetZipIdx = -1;
        this.hvy = -params.jumpPower * 0.95;
        this.airDashSpent = false;
        this.dashCooldown = 0;
        this.airJumpsLeft = 1;
        this.stepEvents.push('jump');
      } else {
        const dx = this.grappleAnchorX - (this.hx + 8);
        const dy = this.grappleAnchorY - (this.hy + 8);
        const dist = Math.hypot(dx, dy);
        if (dist > 1e-3) {
          this.hvx = (dx / dist) * GRAPPLE_PULL_SPEED;
          this.hvy = (dy / dist) * GRAPPLE_PULL_SPEED;
          this.facingLeft = this.hvx < 0;
        }
        this.afterimageSpawnTimer -= simDt;
        if (this.afterimageSpawnTimer <= 0) {
          this.afterimageSpawnTimer = 0.03;
          this.spawnAfterimage('#5ec2f7');
        }
        this.resolveHeroTileMotion(simDt);
        this.onWall = this.probeWalls();

        if (dist < 14 || this.aabbOut.hitWall || this.aabbOut.hitCeiling || this.grapplePullElapsed > 0.75) {
          const wasZip = this.grappleTargetZipIdx >= 0;
          const zipIdx = this.grappleTargetZipIdx;
          const wasRing = this.grappleTargetKind === 'ring';
          this.grappleState = 'idle';
          this.grappleTargetKind = 'none';
          this.grappleTargetZipIdx = -1;
          this.airDashSpent = false;
          this.dashCooldown = 0;
          this.airJumpsLeft = 1;

          if (wasZip && zipIdx >= 0) {
            const zb = this.zips[zipIdx];
            this.hvx = zb.vx * 1.15;
            this.hvy = Math.min(zb.vy * 1.15 - 80, -110);
          } else if (wasRing) {
            this.hvx *= 0.85;
            this.hvy = Math.min(this.hvy * 0.85, -135);
          } else if (this.onWall !== 0) {
            this.hvx = 0;
            this.hvy = Math.min(Math.max(this.hvy * 0.25, -35), 40);
          } else {
            this.hvx *= 0.6;
            this.hvy *= 0.6;
          }
          triggerSquash(this.squash, 1.24, 0.78);
          this.stepEvents.push('snap');
        }
      }
    }

    if (!handledMotion) {
      // Standard Precision Platformer + 8-Way Omni-Dash + Wave-Dash + Wall Slide/Jump
      const mx = this.input.axisX();
      const my = this.input.axisY();

      // Omni-Dash activation (A button)
      if (this.input.justPressed('action') && this.dashCooldown <= 0 && !this.airDashSpent) {
        let dx = mx;
        let dy = my;
        if (dx === 0 && dy === 0) {
          dx = this.facingLeft ? -1 : 1;
        }
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;

        this.dashDirX = dx;
        this.dashDirY = dy;
        this.dashTimer = 0.15;
        this.dashCooldown = 0.42;
        this.airDashSpent = true;
        this.waveDashed = false;
        this.slingshotAir = false;
        if (dx !== 0) this.facingLeft = dx < 0;
        if (dy > 0.25 && Math.abs(dx) > 0.25) {
          this.diagDownDashWindow = 0.24;
        }

        const dashSpeed = 275;
        this.hvx = dx * dashSpeed;
        this.hvy = dy * dashSpeed;
        triggerSquash(this.squash, Math.abs(dx) >= Math.abs(dy) ? 1.36 : 0.74, Math.abs(dx) >= Math.abs(dy) ? 0.7 : 1.32);
        this.juice.applyPreset('dash_kick', { dirX: dx, dirY: dy });
        this.spawnAfterimage('#5ec2f7');
        this.afterimageSpawnTimer = 0.025;
        this.juice.spawnCurlStream(this.hx + 8, this.hy + 8, ['#5ec2f7', '#ff5d8f', '#fffaf0'], 6, {
          vx: -dx * 35,
          vy: -dy * 35,
          spread: 24,
          curlStrength: 55,
          maxLife: 0.38,
          sprite: 'sparkle',
          additive: true,
        });
        this.stepEvents.push('snap');
      }

      if (this.dashTimer > 0) {
        this.dashTimer = Math.max(0, this.dashTimer - simDt);
        this.afterimageSpawnTimer -= simDt;
        if (this.afterimageSpawnTimer <= 0) {
          this.afterimageSpawnTimer = 0.026;
          this.spawnAfterimage('#5ec2f7');
        }
        // Preserve horizontal speed if diagonal-down dash touches floor (setting up Wave-Dash!)
        if (this.onGround && this.dashDirY > 0.25 && Math.abs(this.dashDirX) > 0.25) {
          this.hvy = 0;
          this.hvx = Math.sign(this.dashDirX) * 260;
        } else {
          this.hvx = this.dashDirX * 275;
          this.hvy = this.dashDirY * 275;
        }
      } else {
        const moveSpd = params.moveSpeed * 1.18;
        if (this.wallJumpLockTimer <= 0) {
          if (mx !== 0) {
            this.facingLeft = mx < 0;
            const targetVx = mx * moveSpd;
            const accel = this.onGround ? 1120 : 740;
            if (Math.sign(this.hvx) === mx && Math.abs(this.hvx) > Math.abs(targetVx)) {
              // Preserve hyper-speed momentum (Wave-Dash / Slingshot) with gentle drag
              const drag = this.onGround ? 360 : 95;
              this.hvx = this.hvx > targetVx ? Math.max(targetVx, this.hvx - drag * simDt) : Math.min(targetVx, this.hvx + drag * simDt);
            } else {
              this.hvx = this.hvx < targetVx ? Math.min(targetVx, this.hvx + accel * simDt) : Math.max(targetVx, this.hvx - accel * simDt);
            }
            this.walkAnim += simDt * 11;
          } else {
            const decel = this.onGround ? (this.waveDashed ? 420 : 1050) : 220;
            this.hvx = this.hvx > 0 ? Math.max(0, this.hvx - decel * simDt) : Math.min(0, this.hvx + decel * simDt);
          }
        }
      }

      // Coyote & Wall-Coyote timers
      if (releasedSwingByJump) {
        this.coyoteTimer = 0;
        this.input.consumeBuffer('jump');
      } else {
        this.coyoteTimer = this.onGround ? 0.11 : Math.max(0, this.coyoteTimer - simDt);
      }
      if (!this.onGround && this.onWall !== 0) {
        this.wallCoyoteTimer = 0.09;
        this.lastWallDir = this.onWall;
      } else {
        this.wallCoyoteTimer = Math.max(0, this.wallCoyoteTimer - simDt);
      }

      if (!releasedSwingByJump && this.input.justPressed('jump')) {
        this.input.primeBuffer('jump', 0.13);
      }

      // Check Jump / Wave-Dash / Wall-Jump / Air-Jump
      if (!releasedSwingByJump && this.input.hasBuffered('jump')) {
        const canWaveDash =
          (this.onGround || this.coyoteTimer > 0) &&
          ((this.dashTimer > 0 && this.dashDirY > 0.2 && Math.abs(this.dashDirX) > 0.2) ||
            this.diagDownDashWindow > 0);

        if (canWaveDash) {
          const dirSign = this.dashDirX !== 0 ? Math.sign(this.dashDirX) : this.facingLeft ? -1 : 1;
          this.triggerWaveDashJump(params, dirSign, params.sparkleDensity);
        } else if (this.coyoteTimer > 0) {
          this.input.consumeBuffer('jump');
          this.hvy = -params.jumpPower;
          this.onGround = false;
          this.coyoteTimer = 0;
          triggerSquash(this.squash, 0.76, 1.26);
          this.juice.spawnBurst(this.hx + 8, this.hy + 15, ['#fffaf0', '#ff5d8f'], 4, params.sparkleDensity);
          this.stepEvents.push('jump');
        } else if (this.onWall !== 0 || this.wallCoyoteTimer > 0) {
          this.input.consumeBuffer('jump');
          const wDir = this.onWall !== 0 ? this.onWall : this.lastWallDir;
          this.hvx = -wDir * Math.max(165, params.moveSpeed * 1.7);
          this.hvy = -params.jumpPower * 0.96;
          this.facingLeft = wDir > 0;
          this.wallJumpLockTimer = 0.11;
          this.wallCoyoteTimer = 0;
          this.dashTimer = 0;
          this.waveDashed = false;
          triggerSquash(this.squash, 0.72, 1.28);
          this.juice.spawnBurst(this.hx + (wDir > 0 ? 14 : 2), this.hy + 8, ['#5ec2f7', '#fffaf0'], 6, params.sparkleDensity);
          this.stepEvents.push('jump');
        } else if (this.airJumpsLeft > 0) {
          this.input.consumeBuffer('jump');
          this.airJumpsLeft--;
          this.hvy = -params.jumpPower * 0.92;
          this.dashTimer = 0;
          triggerSquash(this.squash, 0.74, 1.26);
          this.juice.spawnBurst(this.hx + 8, this.hy + 15, ['#5ec2f7', '#fffaf0'], 6, params.sparkleDensity);
          this.stepEvents.push('jump');
        }
      }

      // Variable jump cut
      if (this.dashTimer <= 0 && !this.input.held('jump') && this.hvy < -55 && !this.waveDashed && !this.slingshotAir) {
        this.hvy *= Math.pow(0.06, simDt * 12);
      }

      // Gravity + Apex Hang + Wall Slide clamp (vy <= 75)
      if (this.dashTimer <= 0) {
        const apexScale = !this.onGround && Math.abs(this.hvy) < 42 ? 0.55 : 1.0;
        this.hvy = Math.min(340, this.hvy + 620 * params.gravityScale * apexScale * simDt);
        if (!this.onGround && this.onWall !== 0 && this.hvy > 75 && (mx === this.onWall || mx === 0)) {
          this.hvy = 75;
          this.wallSlideFxTimer -= simDt;
          if (this.wallSlideFxTimer <= 0) {
            this.wallSlideFxTimer = 0.09;
            this.juice.spawnBurst(
              this.hx + (this.onWall > 0 ? 14 : 2),
              this.hy + 10,
              ['#fffaf0', '#5ec2f7'],
              2,
              params.sparkleDensity,
              { gravity: 80, liftY: -4, speedMin: 8, speedMax: 24 },
            );
          }
        }
      }

      if (this.waveDashed && !this.onGround) {
        this.afterimageSpawnTimer -= simDt;
        if (this.afterimageSpawnTimer <= 0) {
          this.afterimageSpawnTimer = 0.045;
          this.spawnAfterimage('#ff5d8f');
        }
      }

      const wasGrounded = this.onGround;
      const preVy = this.hvy;
      this.resolveHeroTileMotion(simDt);
      this.onWall = this.probeWalls();

      if (!wasGrounded && this.onGround) {
        if (preVy > 95) {
          const amt = Math.min(0.28, (preVy / 340) * 0.28);
          triggerSquash(this.squash, 1 + amt, 1 - amt * 0.9);
          this.juice.spawnBurst(this.hx + 8, this.hy + 15, ['#fffaf0', '#c7d4e6'], 3, params.sparkleDensity);
        }
        if (this.dashTimer <= 0) {
          this.waveDashed = false;
          this.slingshotAir = false;
        }
      }

      // Dash cooldown ticks cleanly on ground, stays >= 0.15 in mid-air until landing/crystal/grapple
      if (this.onGround && this.dashTimer <= 0) {
        this.airDashSpent = false;
        this.airJumpsLeft = 1;
        this.dashCooldown = Math.max(0, this.dashCooldown - simDt * 2.5);
      } else if (this.airDashSpent) {
        this.dashCooldown = Math.max(0.15, this.dashCooldown - simDt);
      } else {
        this.dashCooldown = Math.max(0, this.dashCooldown - simDt);
      }
    }

    // Clamp hero inside horizontal world bounds
    this.hx = clamp(this.hx, 0, this.compiled.spec.worldWidth - 16);

    // Hazard / Abyss collision check
    if (
      this.aabbOut.hitHazard ||
      this.tilemap.isHazardOverlapping(this.hx + HB_X, this.hy + HB_Y, HB_W, HB_H) ||
      this.hy > this.compiled.spec.worldHeight + 24
    ) {
      this.killHero(params.sparkleDensity);
      this.camera.step(simDt, this.hx + 8, this.hy + 8, 0, 0);
      return this.stepEvents;
    }

    // 3. Step world props, updrafts, crystals, lasers, Stage 5 Two-Bone IK Boss, checkpoints & gate
    this.stepWorldProps(simDt, params.sparkleDensity);
    if (this.status !== 'playing' || this.respawnTimer > 0) {
      this.camera.step(simDt, this.hx + 8, this.hy + 8, 0, 0);
      return this.stepEvents;
    }

    // 4. Step 8-node VerletChain scarf attached to hero neck
    const neckX = this.hx + (this.facingLeft ? 10 : 6);
    const neckY = this.hy + 7;
    const scarfWindX = -this.hvx * 1.45 + (this.facingLeft ? 58 : -58);
    this.scarf.step(simDt, neckX, neckY, scarfWindX, 175, 0.92, 8);

    // 5. Record Speedrun Ghost Trail into pre-allocated Float32Array
    this.ghostSampleTimer -= simDt;
    if (this.ghostSampleTimer <= 0 && this.currGhostCount < GHOST_MAX_SAMPLES) {
      this.ghostSampleTimer = GHOST_SAMPLE_INTERVAL;
      this.currGhostX[this.currGhostCount] = this.hx;
      this.currGhostY[this.currGhostCount] = this.hy;
      this.currGhostCount++;
    }

    // 6. Step CameraDirector with velocity look-ahead and speed zoom
    const speed = Math.hypot(this.hvx, this.hvy);
    const desiredZoom = this.scoutMode ? 0.85 : clamp(1.04 - (speed / 380) * 0.14, 0.9, 1.04);
    this.camera.setTargetZoom(desiredZoom);
    const lookStickX = this.input.rightAxisX() * 28;
    const lookStickY = this.input.rightAxisY() * 20;
    this.camera.step(simDt, this.hx + 8 + lookStickX, this.hy + 8 + lookStickY, this.hvx, this.hvy);

    return this.stepEvents;
  }

  public snapshot(params: RuntimeParams, alpha = 1): RenderSceneSnapshot {
    const bankIdx = this.bankIndex;
    this.bankIndex = bankIdx === 0 ? 1 : 0;
    const bank = this.banks[bankIdx];

    const outTiles = bank.tiles;
    const outFgTiles = bank.fgTiles;
    const outEntities = bank.entities;
    const outLights = bank.lights;
    outTiles.length = 0;
    outFgTiles.length = 0;
    outEntities.length = 0;
    outLights.length = 0;

    const camFields = this.camera.toSnapshotFields(this.juice.shakeX, this.juice.shakeY);
    const zoom = camFields.cameraZoom;
    const camX = camFields.cameraX;
    const camY = camFields.cameraY;
    const viewW = PARKOUR_VIEWPORT_W / zoom;
    const viewH = PARKOUR_VIEWPORT_H / zoom;
    const margin = 96 / zoom;
    const visMinX = camX - margin;
    const visMinY = camY - margin;
    const visMaxX = camX + viewW + margin;
    const visMaxY = camY + viewH + margin;

    const t = this.juice.visualTime;
    const glow = params.glowIntensity;
    const spec = this.compiled.spec;

    // 1. Frustum-culled static tiles into pre-allocated bank slots
    let tileSlotCount = 0;
    const srcTiles = this.compiled.tiles;
    for (let i = 0; i < srcTiles.length; i++) {
      const st = srcTiles[i];
      if (st.x + st.w < visMinX || st.x > visMaxX || st.y + st.h < visMinY || st.y > visMaxY) continue;
      const dst = acquireTileSlot(bank.tileSlots, tileSlotCount++);
      dst.sprite = st.sprite;
      dst.x = st.x;
      dst.y = st.y;
      dst.w = st.w;
      dst.h = st.h;
      dst.tint = st.tint;
      dst.unlockable = undefined;
      dst.extrudeH = st.extrudeH;
      dst.extrudeAtY = st.extrudeAtY;
      dst.wallColor = st.wallColor;
      dst.wallMaterial = st.wallMaterial;
      dst.elevationZ = st.elevationZ;
      dst.sortY = st.sortY;
      dst.castShadow = st.castShadow;
      dst.alpha = st.alpha;
      dst.flipX = st.flipX;
      dst.autoMask = st.autoMask;
      dst.variant = st.variant;
      dst.windSway = st.windSway;
      outTiles.push(dst);
    }

    // 2. Frustum-culled foreground tiles
    let fgSlotCount = 0;
    const srcFg = this.compiled.fgTiles;
    for (let i = 0; i < srcFg.length; i++) {
      const ft = srcFg[i];
      if (ft.x + ft.w < visMinX || ft.x > visMaxX || ft.y + ft.h < visMinY || ft.y > visMaxY) continue;
      const dst = acquireTileSlot(bank.fgTileSlots, fgSlotCount++);
      dst.sprite = ft.sprite;
      dst.x = ft.x;
      dst.y = ft.y;
      dst.w = ft.w;
      dst.h = ft.h;
      dst.tint = ft.tint;
      dst.unlockable = undefined;
      dst.extrudeH = ft.extrudeH;
      dst.extrudeAtY = ft.extrudeAtY;
      dst.wallColor = ft.wallColor;
      dst.wallMaterial = ft.wallMaterial;
      dst.elevationZ = ft.elevationZ;
      dst.sortY = ft.sortY;
      dst.castShadow = ft.castShadow;
      dst.alpha = ft.alpha;
      dst.flipX = ft.flipX;
      dst.autoMask = ft.autoMask;
      dst.variant = ft.variant;
      dst.windSway = ft.windSway;
      outFgTiles.push(dst);
    }

    let entSlotCount = 0;
    let lightSlotCount = 0;

    // 3. Crumble Blocks
    for (let i = 0; i < this.crumbles.length; i++) {
      const cb = this.crumbles[i];
      if (cb.state === 'broken') continue;
      if (cb.x + cb.w < visMinX || cb.x > visMaxX || cb.y + 16 < visMinY || cb.y > visMaxY) continue;
      const shakeX = cb.state === 'shaking' ? Math.sin(t * 65 + i) * 1.5 : 0;
      const shakeY = cb.state === 'shaking' ? Math.cos(t * 53 + i) * 1.0 : 0;
      for (let seg = 0; seg < cb.wCols; seg++) {
        const idx = i * 4 + seg;
        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = this.crumbleIds[idx < this.crumbleIds.length ? idx : 0];
        dst.sprite = 'crumble_tile';
        dst.x = cb.x + seg * TILE_SIZE + shakeX;
        dst.y = cb.y + shakeY;
        dst.w = TILE_SIZE;
        dst.h = TILE_SIZE;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 0.5;
        dst.flash = cb.state === 'shaking' ? 0.35 : 0;
        dst.skewX = undefined;
        dst.emissive = cb.state === 'shaking' ? 0.45 : undefined;
        dst.paletteRow = undefined;
        dst.flipX = false;
        dst.rot = undefined;
        dst.tint = undefined;
        dst.alpha = 1;
        dst.additive = false;
        dst.elevationZ = undefined;
        dst.castShadow = false;
        dst.shadowOffsetY = undefined;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        outEntities.push(dst);
      }
    }

    // 4. ZipBlocks + Track Guides
    let trackCursor = 0;
    for (let i = 0; i < this.zips.length; i++) {
      const zb = this.zips[i];
      const scx = zb.startX + zb.w * 0.5;
      const scy = zb.startY + zb.h * 0.5;
      const ecx = zb.endX + zb.w * 0.5;
      const ecy = zb.endY + zb.h * 0.5;
      const minZx = Math.min(zb.startX, zb.endX) - 16;
      const maxZx = Math.max(zb.startX, zb.endX) + zb.w + 16;
      const minZy = Math.min(zb.startY, zb.endY) - 16;
      const maxZy = Math.max(zb.startY, zb.endY) + zb.h + 16;
      if (maxZx < visMinX || minZx > visMaxX || maxZy < visMinY || minZy > visMaxY) continue;

      const trAngle = Math.atan2(ecy - scy, ecx - scx);
      for (let s = 0; s < 4; s++) {
        const u = s / 3;
        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = this.zipTrackIds[trackCursor < this.zipTrackIds.length ? trackCursor++ : 0];
        dst.sprite = 'sparkle';
        dst.x = scx + (ecx - scx) * u - 2.5;
        dst.y = scy + (ecy - scy) * u - 2.5;
        dst.w = 5;
        dst.h = 5;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 0.5;
        dst.flash = 0;
        dst.skewX = undefined;
        dst.emissive = 0.55;
        dst.paletteRow = 0;
        dst.flipX = false;
        dst.rot = trAngle;
        dst.tint = '#5ec2f7';
        dst.alpha = 0.48;
        dst.additive = true;
        dst.elevationZ = undefined;
        dst.castShadow = false;
        dst.shadowOffsetY = undefined;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        outEntities.push(dst);
      }

      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = this.zipIds[i];
      dst.sprite = 'zip_block';
      dst.x = zb.x;
      dst.y = zb.y;
      dst.w = zb.w;
      dst.h = zb.h;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 0.5;
      dst.flash = zb.phase === 'surging' ? 0.3 : 0;
      dst.skewX = undefined;
      dst.emissive = zb.phase === 'surging' ? 0.95 : 0.65;
      dst.paletteRow = undefined;
      dst.flipX = false;
      dst.rot = undefined;
      dst.tint = undefined;
      dst.alpha = 1;
      dst.additive = false;
      dst.elevationZ = undefined;
      dst.castShadow = false;
      dst.shadowOffsetY = undefined;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      outEntities.push(dst);

      if (glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = zb.x + zb.w * 0.5;
        l.y = zb.y + zb.h * 0.5;
        l.radius = zb.phase === 'surging' ? 42 : 28;
        l.color = zb.phase === 'surging' ? '#ffd447' : '#5ec2f7';
        l.intensity = 0.55 * glow;
        l.falloffPower = 2.0;
        outLights.push(l);
      }
    }

    // 5. Grapple Rings
    const rings = spec.grappleRings;
    for (let i = 0; i < rings.length; i++) {
      const rg = rings[i];
      if (rg.x + 24 < visMinX || rg.x - 24 > visMaxX || rg.y + 24 < visMinY || rg.y - 24 > visMaxY) continue;
      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = this.ringIds[i];
      dst.sprite = 'grapple_ring';
      dst.x = rg.x - 8;
      dst.y = rg.y - 8;
      dst.w = 16;
      dst.h = 16;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 0.5;
      dst.flash = 0;
      dst.skewX = undefined;
      dst.emissive = 0.85;
      dst.paletteRow = spec.paletteRow;
      dst.flipX = false;
      dst.rot = t * 1.4 + i * 0.5;
      dst.tint = undefined;
      dst.alpha = 1;
      dst.additive = false;
      dst.elevationZ = undefined;
      dst.castShadow = false;
      dst.shadowOffsetY = undefined;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      outEntities.push(dst);

      if (glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = rg.x;
        l.y = rg.y;
        l.radius = 28;
        l.color = '#ffd447';
        l.intensity = 0.48 * glow;
        l.falloffPower = 2.0;
        outLights.push(l);
      }
    }

    // 6. Reset Crystals
    for (let i = 0; i < this.crystals.length; i++) {
      const cr = this.crystals[i];
      if (cr.x + 24 < visMinX || cr.x - 24 > visMaxX || cr.y + 24 < visMinY || cr.y - 24 > visMaxY) continue;
      const ready = cr.cooldown <= 0;
      const bob = ready ? Math.sin(t * 4.2 + i) * 2.5 : 0;
      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = this.crystalIds[i];
      dst.sprite = 'crystal_reset';
      dst.x = cr.x - 8;
      dst.y = cr.y - 8 + bob;
      dst.w = 16;
      dst.h = 16;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 0.5;
      dst.flash = 0;
      dst.skewX = undefined;
      dst.emissive = ready ? 0.9 : 0.1;
      dst.paletteRow = ready ? spec.paletteRow : 0;
      dst.flipX = false;
      dst.rot = undefined;
      dst.tint = undefined;
      dst.alpha = ready ? 1 : 0.28;
      dst.additive = false;
      dst.elevationZ = undefined;
      dst.castShadow = false;
      dst.shadowOffsetY = undefined;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      outEntities.push(dst);

      if (ready && glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = cr.x;
        l.y = cr.y + bob;
        l.radius = 26;
        l.color = '#56d39c';
        l.intensity = 0.5 * glow;
        l.falloffPower = 1.9;
        outLights.push(l);
      }
    }

    // 7. Timed Lasers (anchored by emitter hubs)
    let lSegCursor = 0;
    for (let i = 0; i < this.lasers.length; i++) {
      const lz = this.lasers[i];
      if (lz.x + lz.w < visMinX || lz.x > visMaxX || lz.y + lz.h < visMinY || lz.y > visMaxY) continue;
      const cx = lz.x + lz.w * 0.5;

      // Top & Bottom Emitter Hubs
      for (let end = 0; end < 2; end++) {
        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = this.laserHubIds[i * 2 + end];
        dst.sprite = 'ik_joint';
        dst.x = cx - 6;
        dst.y = (end === 0 ? lz.y : lz.y + lz.h) - 6;
        dst.w = 12;
        dst.h = 12;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 0.5;
        dst.flash = lz.warning ? 0.5 : 0;
        dst.skewX = undefined;
        dst.emissive = lz.active ? 0.85 : 0.3;
        dst.paletteRow = undefined;
        dst.flipX = false;
        dst.rot = undefined;
        dst.tint = lz.active ? '#ff5d8f' : '#ffd447';
        dst.alpha = 1;
        dst.additive = false;
        dst.elevationZ = undefined;
        dst.castShadow = false;
        dst.shadowOffsetY = undefined;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        outEntities.push(dst);
      }

      if (lz.active || lz.warning) {
        for (let ly = lz.y + 8; ly < lz.y + lz.h; ly += 16) {
          const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
          dst.id = this.laserIds[lSegCursor < this.laserIds.length ? lSegCursor++ : 0];
          dst.sprite = 'laser_beam';
          dst.x = cx - 8;
          dst.y = ly - 8;
          dst.w = 16;
          dst.h = 16;
          dst.scaleX = 1;
          dst.scaleY = lz.active ? 1 : 0.35;
          dst.anchorY = 0.5;
          dst.flash = 0;
          dst.skewX = undefined;
          dst.emissive = lz.active ? 1.0 : 0.4;
          dst.paletteRow = undefined;
          dst.flipX = false;
          dst.rot = Math.PI * 0.5;
          dst.tint = lz.active ? '#ff4d8d' : '#ffd447';
          dst.alpha = lz.active ? 0.95 : 0.42;
          dst.additive = true;
          dst.elevationZ = undefined;
          dst.castShadow = false;
          dst.shadowOffsetY = undefined;
          dst.shadowRadius = undefined;
          dst.sortY = undefined;
          outEntities.push(dst);
        }
        if (lz.active && glow > 0.05) {
          const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
          l.x = cx;
          l.y = lz.y + lz.h * 0.5;
          l.radius = 48;
          l.color = '#ff4d8d';
          l.intensity = 0.65 * glow;
          l.falloffPower = 1.8;
          outLights.push(l);
        }
      }
    }

    // 8. Checkpoints & Exit Gate
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      if (cp.x + 24 < visMinX || cp.x - 24 > visMaxX || cp.y + 24 < visMinY || cp.y - 24 > visMaxY) continue;
      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = this.cpIds[i];
      dst.sprite = cp.activated ? 'flag_on' : 'flag_off';
      dst.x = cp.x;
      dst.y = cp.y;
      dst.w = 16;
      dst.h = 16;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 1;
      dst.flash = 0;
      dst.skewX = undefined;
      dst.emissive = cp.activated ? 0.65 : undefined;
      dst.paletteRow = undefined;
      dst.flipX = false;
      dst.rot = undefined;
      dst.tint = undefined;
      dst.alpha = 1;
      dst.additive = false;
      dst.elevationZ = undefined;
      dst.castShadow = false;
      dst.shadowOffsetY = undefined;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      outEntities.push(dst);

      if (cp.activated && glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = cp.x + 8;
        l.y = cp.y + 8;
        l.radius = 34;
        l.color = '#56d39c';
        l.intensity = 0.52 * glow;
        l.falloffPower = 2.0;
        outLights.push(l);
      }
    }

    const gate = spec.exitGate;
    if (gate.x + 32 >= visMinX && gate.x - 16 <= visMaxX && gate.y + 32 >= visMinY && gate.y - 16 <= visMaxY) {
      const gDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      gDst.id = 'exit-gate';
      gDst.sprite = 'gate_open';
      gDst.x = gate.x;
      gDst.y = gate.y;
      gDst.w = 24;
      gDst.h = 24;
      gDst.scaleX = 1;
      gDst.scaleY = 1;
      gDst.anchorY = 1;
      gDst.flash = 0;
      gDst.skewX = undefined;
      gDst.emissive = 0.95;
      gDst.paletteRow = undefined;
      gDst.flipX = false;
      gDst.rot = undefined;
      gDst.tint = undefined;
      gDst.alpha = 1;
      gDst.additive = false;
      gDst.elevationZ = undefined;
      gDst.castShadow = false;
      gDst.shadowOffsetY = undefined;
      gDst.shadowRadius = undefined;
      gDst.sortY = undefined;
      outEntities.push(gDst);

      if (glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = gate.x + 12;
        l.y = gate.y + 12;
        l.radius = 52;
        l.color = '#ffd447';
        l.intensity = 0.72 * glow;
        l.falloffPower = 1.7;
        outLights.push(l);
      }
    }

    // 9. Speedrun Ghost Trail (best run ghost + faint breadcrumb trail)
    if (this.bestGhostStageIdx === this.stageIdx && this.bestGhostCount > 1) {
      const sampleIdx = Math.min(this.bestGhostCount - 1, Math.floor(this.stageElapsedSec / GHOST_SAMPLE_INTERVAL));
      const gx = this.bestGhostX[sampleIdx];
      const gy = this.bestGhostY[sampleIdx];
      if (gx + 16 >= visMinX && gx <= visMaxX && gy + 16 >= visMinY && gy <= visMaxY) {
        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = 'best-ghost';
        dst.sprite = 'parkour_hero_dash';
        dst.x = gx;
        dst.y = gy;
        dst.w = 16;
        dst.h = 16;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 1;
        dst.flash = 0;
        dst.skewX = undefined;
        dst.emissive = 0.55;
        dst.paletteRow = 0;
        dst.flipX = false;
        dst.rot = undefined;
        dst.tint = '#5ec2f7';
        dst.alpha = 0.3;
        dst.additive = true;
        dst.elevationZ = undefined;
        dst.castShadow = false;
        dst.shadowOffsetY = undefined;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        outEntities.push(dst);
      }
    }

    const recentTrailCount = Math.min(6, this.currGhostCount);
    for (let i = 0; i < recentTrailCount; i++) {
      const idx = this.currGhostCount - 1 - i * 2;
      if (idx < 0) break;
      const gx = this.currGhostX[idx] + 6;
      const gy = this.currGhostY[idx] + 6;
      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = this.ghostDotIds[i];
      dst.sprite = 'sparkle';
      dst.x = gx;
      dst.y = gy;
      dst.w = 5;
      dst.h = 5;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 0.5;
      dst.flash = 0;
      dst.skewX = undefined;
      dst.emissive = 0.5;
      dst.paletteRow = 0;
      dst.flipX = false;
      dst.rot = t * 4 + i;
      dst.tint = '#ff5d8f';
      dst.alpha = 0.28 - i * 0.035;
      dst.additive = true;
      dst.elevationZ = undefined;
      dst.castShadow = false;
      dst.shadowOffsetY = undefined;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      outEntities.push(dst);
    }

    // 10. 6-Slot Afterimages
    for (let i = 0; i < AFTERIMAGE_COUNT; i++) {
      const af = this.afterimages[i];
      if (!af.active) continue;
      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = this.afterimageIds[i];
      dst.sprite = af.sprite;
      dst.x = af.x;
      dst.y = af.y;
      dst.w = 16;
      dst.h = 16;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 1;
      dst.flash = 0;
      dst.skewX = undefined;
      dst.emissive = 0.65;
      dst.paletteRow = 0;
      dst.flipX = af.flipX;
      dst.rot = undefined;
      dst.tint = af.tint;
      dst.alpha = (af.life / af.maxLife) * 0.5;
      dst.additive = true;
      dst.elevationZ = undefined;
      dst.castShadow = false;
      dst.shadowOffsetY = undefined;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      outEntities.push(dst);
    }

    // 11. 8-Node VerletChain Scarf (Crimson when dash ready, Ice Blue when dash spent)
    const scarfColor = !this.airDashSpent && this.dashCooldown <= 0 ? SCARF_COLOR_READY : SCARF_COLOR_SPENT;
    for (let i = this.scarf.count - 1; i >= 0; i--) {
      const sz = 7 - i * 0.42;
      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = this.scarfIds[i];
      dst.sprite = 'scarf_node';
      dst.x = this.scarf.posX[i] - sz * 0.5;
      dst.y = this.scarf.posY[i] - sz * 0.5;
      dst.w = sz;
      dst.h = sz;
      dst.scaleX = 1;
      dst.scaleY = 1;
      dst.anchorY = 0.5;
      dst.flash = 0;
      dst.skewX = undefined;
      dst.emissive = 0.45;
      dst.paletteRow = 0;
      dst.flipX = false;
      dst.rot = undefined;
      dst.tint = scarfColor;
      dst.alpha = 0.96;
      dst.additive = false;
      dst.elevationZ = undefined;
      dst.castShadow = false;
      dst.shadowOffsetY = undefined;
      dst.shadowRadius = undefined;
      dst.sortY = undefined;
      outEntities.push(dst);
    }

    // 12. Hero Entity (interpolated smoothly if alpha < 1)
    const heroX = alpha < 1 ? this.prevHx + (this.hx - this.prevHx) * alpha : this.hx;
    const heroY = alpha < 1 ? this.prevHy + (this.hy - this.prevHy) * alpha : this.hy;
    if (this.respawnTimer <= 0) {
      let heroSprite: SpriteId = 'parkour_hero_idle';
      let heroFlip = this.facingLeft;
      if (this.dashTimer > 0 || (this.waveDashed && !this.onGround && Math.abs(this.hvx) > 140)) {
        heroSprite = 'parkour_hero_dash';
      } else if (!this.onGround && this.onWall !== 0) {
        heroSprite = 'parkour_hero_wall';
        heroFlip = this.onWall < 0;
      } else if (!this.onGround) {
        heroSprite = 'parkour_hero_jump';
      } else if (Math.abs(this.hvx) > 14) {
        heroSprite = Math.floor(this.walkAnim) % 2 === 0 ? 'parkour_hero_run_a' : 'parkour_hero_run_b';
      }

      const heroDrop = this.findFloorDropY(heroX + 8, heroY + 16);
      const heroSkew = Math.abs(this.hvx) > 16 ? clamp(this.hvx / 440, -0.26, 0.26) : 0;

      const hDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      hDst.id = 'hero';
      hDst.sprite = heroSprite;
      hDst.x = heroX;
      hDst.y = heroY;
      hDst.w = 16;
      hDst.h = 16;
      hDst.scaleX = this.squash.scaleX;
      hDst.scaleY = this.squash.scaleY;
      hDst.anchorY = 1;
      hDst.flash = 0;
      hDst.skewX = heroSkew;
      hDst.emissive = 0.25;
      hDst.paletteRow = undefined;
      hDst.flipX = heroFlip;
      hDst.rot = undefined;
      hDst.tint = undefined;
      hDst.alpha = 1;
      hDst.additive = false;
      hDst.elevationZ = undefined;
      hDst.castShadow = heroDrop !== null;
      hDst.shadowOffsetY = heroDrop ?? 0;
      hDst.shadowRadius = 6;
      hDst.sortY = undefined;
      outEntities.push(hDst);

      if (glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = heroX + 8;
        l.y = heroY + 8;
        l.radius = 36;
        l.color = scarfColor;
        l.intensity = 0.36 * glow;
        l.falloffPower = 2.0;
        outLights.push(l);
      }
    }

    // 13. Grappling Hook: 7 grapple_link segments (with damped post-hit sine wave) + grapple_claw + reticle
    const hcx = heroX + 8;
    const hcy = heroY + 8;
    if (this.grappleState !== 'idle') {
      const endX = this.grappleState === 'shooting' ? this.grappleTipX : this.grappleAnchorX;
      const endY = this.grappleState === 'shooting' ? this.grappleTipY : this.grappleAnchorY;
      const dx = endX - hcx;
      const dy = endY - hcy;
      const len = Math.max(1, Math.hypot(dx, dy));
      const ang = Math.atan2(dy, dx);
      const nx = -dy / len;
      const ny = dx / len;
      const waveAmp = (this.grappleWaveTimer / 0.28) * 5.2;

      for (let k = 0; k < GRAPPLE_LINKS; k++) {
        const u = (k + 1) / (GRAPPLE_LINKS + 1);
        const wave = waveAmp > 0.02 ? Math.sin(u * Math.PI * 3 + t * 44) * Math.sin(u * Math.PI) * waveAmp : 0;
        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = this.linkIds[k];
        dst.sprite = 'grapple_link';
        dst.x = hcx + dx * u + nx * wave - 5;
        dst.y = hcy + dy * u + ny * wave - 4;
        dst.w = 10;
        dst.h = 8;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 0.5;
        dst.flash = 0;
        dst.skewX = undefined;
        dst.emissive = 0.72;
        dst.paletteRow = undefined;
        dst.flipX = false;
        dst.rot = ang;
        dst.tint = this.grappleMode === 'swing' ? '#ff5d8f' : '#5ec2f7';
        dst.alpha = 1;
        dst.additive = false;
        dst.elevationZ = undefined;
        dst.castShadow = false;
        dst.shadowOffsetY = undefined;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        outEntities.push(dst);
      }

      const cDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      cDst.id = 'grapple-claw';
      cDst.sprite = 'grapple_claw';
      cDst.x = endX - 7;
      cDst.y = endY - 7;
      cDst.w = 14;
      cDst.h = 14;
      cDst.scaleX = 1;
      cDst.scaleY = 1;
      cDst.anchorY = 0.5;
      cDst.flash = this.grappleWaveTimer > 0.16 ? 0.45 : 0;
      cDst.skewX = undefined;
      cDst.emissive = 0.92;
      cDst.paletteRow = spec.paletteRow;
      cDst.flipX = false;
      cDst.rot = ang;
      cDst.tint = undefined;
      cDst.alpha = 1;
      cDst.additive = false;
      cDst.elevationZ = undefined;
      cDst.castShadow = false;
      cDst.shadowOffsetY = undefined;
      cDst.shadowRadius = undefined;
      cDst.sortY = undefined;
      outEntities.push(cDst);

      if (glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = endX;
        l.y = endY;
        l.radius = 38;
        l.color = this.grappleMode === 'swing' ? '#ff5d8f' : '#5ec2f7';
        l.intensity = 0.74 * glow;
        l.falloffPower = 1.8;
        outLights.push(l);
      }
    } else {
      // Spinning Aim Reticle when locked onto a real target, subtle aim glint in open sky
      const locked = this.previewKind !== 'none';
      const rSz = locked ? 14 : 8;
      const rDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      rDst.id = 'grapple-reticle';
      rDst.sprite = locked ? 'grapple_reticle' : 'sparkle';
      rDst.x = this.previewHitX - rSz * 0.5;
      rDst.y = this.previewHitY - rSz * 0.5;
      rDst.w = rSz;
      rDst.h = rSz;
      rDst.scaleX = this.previewKind === 'ring' || this.previewKind === 'zip' ? 1.18 : 1;
      rDst.scaleY = rDst.scaleX;
      rDst.anchorY = 0.5;
      rDst.flash = 0;
      rDst.skewX = undefined;
      rDst.emissive = locked ? 0.95 : 0.4;
      rDst.paletteRow = locked ? spec.paletteRow : 0;
      rDst.flipX = false;
      rDst.rot = t * (locked ? 5 : 2.5);
      rDst.tint = this.previewKind === 'ring' || this.previewKind === 'zip' ? '#ffd447' : '#5ec2f7';
      rDst.alpha = locked ? 0.95 : 0.45;
      rDst.additive = !locked;
      rDst.elevationZ = undefined;
      rDst.castShadow = false;
      rDst.shadowOffsetY = undefined;
      rDst.shadowRadius = undefined;
      rDst.sortY = undefined;
      outEntities.push(rDst);
    }

    // 14. Stage 5 Two-Bone IK Mechanical Boss Claw (ik_joint chain + ik_claw)
    if (this.ikActive) {
      let segIdx = 0;
      for (let s = 0; s < 5; s++) {
        const u = s / 5;
        const jx = this.ikRootX + (this.ikJointX - this.ikRootX) * u;
        const jy = this.ikRootY + (this.ikJointY - this.ikRootY) * u;
        const sz = 14 - s * 0.4;
        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = this.ikSegIds[segIdx++];
        dst.sprite = 'ik_joint';
        dst.x = jx - sz * 0.5;
        dst.y = jy - sz * 0.5;
        dst.w = sz;
        dst.h = sz;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 0.5;
        dst.flash = 0;
        dst.skewX = undefined;
        dst.emissive = s === 0 ? 0.75 : 0.45;
        dst.paletteRow = undefined;
        dst.flipX = false;
        dst.rot = undefined;
        dst.tint = undefined;
        dst.alpha = 1;
        dst.additive = false;
        dst.elevationZ = undefined;
        dst.castShadow = false;
        dst.shadowOffsetY = undefined;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        outEntities.push(dst);
      }
      for (let s = 0; s < 5; s++) {
        const u = s / 5;
        const jx = this.ikJointX + (this.ikEndX - this.ikJointX) * u;
        const jy = this.ikJointY + (this.ikEndY - this.ikJointY) * u;
        const sz = 13 - s * 0.5;
        const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
        dst.id = this.ikSegIds[segIdx++];
        dst.sprite = 'ik_joint';
        dst.x = jx - sz * 0.5;
        dst.y = jy - sz * 0.5;
        dst.w = sz;
        dst.h = sz;
        dst.scaleX = 1;
        dst.scaleY = 1;
        dst.anchorY = 0.5;
        dst.flash = 0;
        dst.skewX = undefined;
        dst.emissive = s === 0 ? 0.8 : 0.5;
        dst.paletteRow = undefined;
        dst.flipX = false;
        dst.rot = undefined;
        dst.tint = undefined;
        dst.alpha = 1;
        dst.additive = false;
        dst.elevationZ = undefined;
        dst.castShadow = false;
        dst.shadowOffsetY = undefined;
        dst.shadowRadius = undefined;
        dst.sortY = undefined;
        outEntities.push(dst);
      }

      const clawRot = Math.atan2(this.ikEndY - this.ikJointY, this.ikEndX - this.ikJointX);
      const clawDst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      clawDst.id = 'ik-claw-head';
      clawDst.sprite = 'ik_claw';
      clawDst.x = this.ikEndX - 11;
      clawDst.y = this.ikEndY - 11;
      clawDst.w = 22;
      clawDst.h = 22;
      clawDst.scaleX = 1;
      clawDst.scaleY = 1;
      clawDst.anchorY = 0.5;
      clawDst.flash = this.ikAttacking ? 0.35 : 0;
      clawDst.skewX = undefined;
      clawDst.emissive = this.ikAttacking ? 1.0 : 0.72;
      clawDst.paletteRow = spec.paletteRow;
      clawDst.flipX = false;
      clawDst.rot = clawRot;
      clawDst.tint = undefined;
      clawDst.alpha = 1;
      clawDst.additive = false;
      clawDst.elevationZ = undefined;
      clawDst.castShadow = false;
      clawDst.shadowOffsetY = undefined;
      clawDst.shadowRadius = undefined;
      clawDst.sortY = undefined;
      outEntities.push(clawDst);

      if (glow > 0.05) {
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
        l.x = this.ikEndX;
        l.y = this.ikEndY;
        l.radius = this.ikAttacking ? 56 : 40;
        l.color = '#ff5d8f';
        l.intensity = (this.ikAttacking ? 0.88 : 0.58) * glow;
        l.falloffPower = 1.75;
        outLights.push(l);
      }
    }

    // 15. Optional Debug Hitbox Visualization
    let debugRects: DebugRectDesc[] | undefined;
    if (this.debugHitboxes) {
      debugRects = bank.debugRects;
      debugRects.length = 0;
      let dCount = 0;
      const hdr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
      hdr.x = heroX + HB_X;
      hdr.y = heroY + HB_Y;
      hdr.w = HB_W;
      hdr.h = HB_H;
      hdr.color = '#ffd447';
      debugRects.push(hdr);

      for (let i = 0; i < this.zips.length; i++) {
        const zb = this.zips[i];
        const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
        dr.x = zb.x;
        dr.y = zb.y;
        dr.w = zb.w;
        dr.h = zb.h;
        dr.color = '#5ec2f7';
        debugRects.push(dr);
      }
      for (let i = 0; i < this.lasers.length; i++) {
        const lz = this.lasers[i];
        if (!lz.active) continue;
        const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
        dr.x = lz.x + 3;
        dr.y = lz.y;
        dr.w = lz.w - 6;
        dr.h = lz.h;
        dr.color = '#ff5d8f';
        debugRects.push(dr);
      }
    }

    // 16. Zero-GC 360-deg Aim Sight-Line & Floating Pixel Text Popups
    bank.hudPrimitives.length = 0;
    if (this.grappleState === 'idle' && this.respawnTimer <= 0) {
      const aimSlot = bank.aimLineSlot;
      const locked = this.previewKind !== 'none';
      aimSlot.kind = 'aim_line';
      aimSlot.x = hcx;
      aimSlot.y = hcy;
      if (locked) {
        aimSlot.x2 = this.previewHitX;
        aimSlot.y2 = this.previewHitY;
      } else {
        aimSlot.x2 = hcx + Math.cos(this.aimAngle) * 148;
        aimSlot.y2 = hcy + Math.sin(this.aimAngle) * 148;
      }
      aimSlot.w = 2;
      aimSlot.h = 2;
      aimSlot.color = locked ? '#ffd447' : '#5ec2f7';
      aimSlot.alpha = locked ? 0.85 : 0.45;
      aimSlot.worldSpace = true;
      bank.hudPrimitives.push(aimSlot);
    }

    let popupEmitCount = 0;
    for (let i = 0; i < this.popups.length && popupEmitCount < 4; i++) {
      const p = this.popups[i];
      if (!p.active) continue;
      const slot = bank.popupSlots[popupEmitCount++];
      slot.kind = 'text';
      slot.x = p.x;
      slot.y = p.y;
      slot.w = 0;
      slot.h = 0;
      slot.text = p.text;
      slot.scale = 1;
      slot.align = 'center';
      slot.shadowColor = '#120d1e';
      slot.color = p.color;
      slot.alpha = clamp(1 - Math.max(0, p.life / p.maxLife - 0.55) / 0.45, 0, 1);
      slot.worldSpace = true;
      bank.hudPrimitives.push(slot);
    }

    const outHudPrimitives = bank.hudPrimitives.length > 0 ? bank.hudPrimitives : undefined;

    const snap = bank.snapshot;
    snap.cartridgeId = 'celestial-parkour';
    snap.skyTop = this.compiled.mood.skyTop;
    snap.skyBottom = this.compiled.mood.skyBottom;
    snap.cozyFilter = params.cozyFilter > 0.5;
    snap.glowIntensity = params.glowIntensity;
    snap.paletteRow = 0;
    snap.timeSec = t;
    snap.elapsedSec = this.elapsedSec;
    snap.status = this.status;
    snap.score = this.score;
    snap.comboCount = this.juice.comboCount;
    snap.starsCollected = this.clearedStagesCount;
    snap.starsTotal = PARKOUR_STAGES.length;
    snap.hasKey = this.grappleState !== 'idle';
    snap.hearts = 1;
    snap.maxHearts = 1;
    snap.bossHp = 0;
    snap.bossMaxHp = 0;
    snap.cameraX = camX;
    snap.cameraY = camY;
    snap.cameraZoom = zoom;
    snap.cameraLetterbox = camFields.cameraLetterbox;
    snap.viewport = bank.viewport;
    snap.ambientDarkness = spec.ambientDarkness;
    snap.ambientColor = this.compiled.mood.ambientColor;
    snap.screenFlashAlpha = this.juice.flashAlpha;
    snap.screenFlashColor = this.juice.flashColor;
    snap.hd2dDepth = this.hd2dConfig;
    snap.bgStars = this.bgStars;
    snap.bgParallaxLayers = this.compiled.bgParallaxLayers;
    snap.bgClouds = this.compiled.bgClouds;
    snap.tiles = outTiles;
    snap.fgTiles = outFgTiles;
    snap.entities = outEntities;
    snap.particles = this.juice.particles;
    snap.lights = outLights;
    snap.debugRects = debugRects;
    snap.hudPrimitives = outHudPrimitives;
    snap.statusBanner = this.noticeTimer > 0 ? this.noticeBanner : spec.name;
    snap.stage = this.stageProgressInfo;
    snap.bgmTheme = spec.bgmTheme;
    return snap;
  }
}
