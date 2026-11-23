import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { GAME_H, GAME_W, resolveLogicalViewport, type LogicalViewport } from '../gpu/GpuTypes.ts';
import { InputMap } from '../input/InputMap.ts';
import { SpatialHash } from '../math/SpatialHash.ts';
import { stepSpringInto } from '../math/SpringDynamics.ts';
import { SeededRng } from '../runtime/SeededRng.ts';
import type { ShmupFighterSummary } from '../types/HudTypes.ts';
import {
  clamp,
  type BgCloudDesc,
  type BgParallaxLayerDesc,
  type BgStarDesc,
  type ComboTrackingCartridge,
  type DebuggableCartridge,
  type Hd2dDepthConfig,
  type InputState,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type SimEvent,
  type TileDesc,
} from '../types/WorldTypes.ts';
import { CardDeckEngine, type CardEngineStepHooks } from './CardDeckEngine.ts';
import {
  validateCartridgeJson,
  type CartridgeArchetypeDef,
  type CartridgeJsonV1,
  type CartridgeTag,
  type CartridgeTileChunkDef,
} from './CartridgeSchema.ts';
import {
  EF_CRUMBLE_TILE,
  EF_CRYSTAL_RESET,
  EF_GRAPPLE_TARGET,
  EF_ZIP_BLOCK,
  MAX_VM_COLLISION_PAIRS,
  RT_GRAPPLE_LINKS,
  stepDataDualPerspectiveStage,
  stepDataPlatformer,
  type DataPlatformerContext,
} from './DataRuntimePlatformer.ts';
import {
  applyShmupLoadout,
  getChargeTier,
  spawnShmupWaveFromJson,
  stepShmupSystem,
  syncFunnelSlots,
  triggerShmupBomb,
  type RuntimeShmupState,
  type ShmupRuntimeContext,
} from './DataRuntimeShmup.ts';
import {
  createRuntimeBank,
  MAX_FLOATING_TEXTS,
  projectDataCartridgeSnapshot,
  type DataSnapshotProjectorContext,
  type FloatingTextSlot,
  type RuntimeSnapshotBank,
} from './DataRuntimeSnapshot.ts';
import {
  DualPerspectiveRuntime,
  type DualPerspectiveStepResult,
} from './DualPerspectiveRuntime.ts';
import {
  EventActionVm,
  type VmButtonEdge,
  type VmButtonId,
  type VmCollisionPair,
  type VmHostBridge,
} from './EventActionVm.ts';
import { FighterFrameEngine, type FighterStepHooks } from './FighterFrameEngine.ts';
import {
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
import {
  applyOklabParallaxFog,
  compileProceduralStage,
  resolveStageArtMood,
} from './ProceduralStageCompiler.ts';
import { ProceduralVisualRigRuntime } from './ProceduralVisualRig.ts';
import {
  BM_CHASE,
  BM_MOVING_PLATFORM,
  BM_ORBIT,
  BM_PATROL,
  BM_PLATFORMER_CTRL,
  BM_SIN_FLOAT,
  BM_TOPDOWN_MOVE,
  EF_ALIVE,
  EF_BOSS,
  EF_BOUNCY,
  EF_BULLET,
  EF_COLLECTIBLE,
  EF_EMISSIVE,
  EF_ENEMY,
  EF_GRAVITY,
  EF_HAZARD,
  EF_ONE_WAY,
  EF_PICKUP,
  EF_PLAYER,
  EF_SOLID,
  EF_STOMPABLE,
  EF_WEAK_POINT,
  MAX_ENTITIES,
  SoaEntityPool,
} from './SoaEntityPool.ts';
import {
  CHUNK_SIZE,
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
  type TileAabbStepResult,
} from './TilemapGrid.ts';
import { TweenSystem } from './TweenSystem.ts';

export { MAX_FLOATING_TEXTS, type FloatingTextSlot };

interface RuntimeArchetype {
  id: string;
  def: CartridgeArchetypeDef;
  flags: number;
  behaviorMask: number;
  scoreValue: number;
  dropKind?: string;
}

const STARFIELD_PALETTE = ['#fffaf0', '#ffd447', '#5ec2f7', '#ff8ec6', '#e0aaff'] as const;

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
      case 'zip_block': f |= EF_GRAPPLE_TARGET | EF_SOLID | EF_EMISSIVE | EF_ZIP_BLOCK; break;
      case 'crystal_reset': f |= EF_CRYSTAL_RESET | EF_EMISSIVE; break;
      case 'crumble_tile': f |= EF_SOLID | EF_CRUMBLE_TILE; break;
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
 * Unifies platformer, arcade shooter, card, fighter, and topdown simulations through SoaEntityPool, TilemapGrid, and EventActionVm.
 */
export class DataCartridgeRuntime
  implements
    DebuggableCartridge,
    ComboTrackingCartridge,
    ShmupRuntimeContext,
    GenreRuntimeContext,
    DataPlatformerContext,
    DataSnapshotProjectorContext
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
  public fgTilemap = new TilemapGrid(46, 12);
  public hasFgTilemapTiles = false;
  public readonly tileSpriteLut: (SpriteId | undefined)[] = [];
  public readonly fgSpriteLut: (SpriteId | undefined)[] = [];
  public readonly fgAlphaLut = new Float32Array(256).fill(1);
  public readonly fgExtraTiles: TileDesc[] = [];
  public readonly bgParallaxLayers: BgParallaxLayerDesc[] = [];
  public stageWorldW = GAME_W;
  public stageWorldH = GAME_H;
  public bgClouds: BgCloudDesc[] = [];
  public bgStars: BgStarDesc[] = [];

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
  public stageSkyTop = '#76c7ff';
  public stageSkyBottom = '#fff3df';
  public stageAmbientColor = '#120e24';
  public cameraX = 0;
  public cameraY = 0;
  public prevCameraX = 0;
  public prevCameraY = 0;
  private camVelX = 0;
  private camVelY = 0;
  private prevCamTargetX = 0;
  private prevCamTargetY = 0;
  private springCamFreq = 0;
  private springCamDamping = 1;
  private readonly camSpringOut = new Float64Array(2);
  public readonly isTileOpaque = (tx: number, ty: number): boolean => this.tilemap.getCollision(tx, ty) === COLLISION_SOLID;
  public readonly grappleEnabled: boolean;
  public readonly grappleMaxRange: number;
  public readonly grappleAttachWalls: boolean;
  public readonly grapplePullSpeed: number;
  public grappleState: 'idle' | 'shooting' | 'swinging' | 'pulling' = 'idle';
  public grappleMode: 'swing' | 'pull' = 'swing';
  public grappleAnchorX = 0;
  public grappleAnchorY = 0;
  public grappleTipX = 0;
  public grappleTipY = 0;
  public grappleRopeLength = 80;
  public grappleAimAngle = -0.7854;
  public grappleHoldViaInput = false;
  public grappleSwingElapsed = 0;
  public grapplePullElapsed = 0;
  public grapplePreviewKind: 'none' | 'wall' | 'ring' = 'none';
  public grapplePreviewX = 0;
  public grapplePreviewY = 0;
  public grappleTargetSlot = -1;
  public readonly grappleRayScratch = new Float64Array(8);
  public readonly grappleLinkIds = Array.from({ length: RT_GRAPPLE_LINKS }, (_, i) => `rt-glink-${i}`);
  public cameraZoom = 1.0;
  public stageViewport: LogicalViewport = { width: GAME_W, height: GAME_H };
  private scoutMode = false;
  public hasKey = false;
  public stageHasKey = false;
  public gateUnlocked = false;
  public bestStarsByStage: number[] = [];
  private stageStarsTotal = 0;
  public stageStarsCollected = 0;
  public totalCampaignStars = 0;
  public checkpointX = 24;
  public checkpointY = 120;
  public coyote = 0;
  public airJumpsLeft = 0;
  public dashTimer = 0;
  public dashCooldown = 0;
  public pulseCooldown = 0;
  public invulnTimer = 0;
  public walkAnim = 0;
  public relics = { doubleJump: false, airDash: false };
  public readonly heroSquash = { scaleX: 1, scaleY: 1 };
  public readonly aabbBox = { x: 0, y: 0, vx: 0, vy: 0 };
  public readonly aabbRes: TileAabbStepResult = { onGround: false, hitWall: false, hitCeiling: false, hitHazard: false, landVy: 0 };

  // Shmup, Visual Rig, Dual-Perspective & Orthogonal Genre Engines
  public readonly shmup: RuntimeShmupState;
  public readonly cardEngine: CardDeckEngine | null = null;
  public readonly fighterEngine: FighterFrameEngine | null = null;
  public readonly visualRig = new ProceduralVisualRigRuntime();
  public readonly dualPerspective = new DualPerspectiveRuntime();
  public readonly dualPerspectiveStepOut: DualPerspectiveStepResult = { toggled: false, slashed: false, hits: 0 };
  public readonly hd2dConfig: Hd2dDepthConfig = { enabled: false };
  public lastHeroSprite: SpriteId = 'hero_a';

  // Pre-allocated snapshot, spatial query, floating pixel text & VM buffers (Zero-GC)
  public readonly eventsOut: SimEvent[] = [];
  private readonly orthogonalStepHooks: CardEngineStepHooks & FighterStepHooks;
  public readonly querySlots = new Int32Array(MAX_ENTITIES);
  private readonly entityIdCache: string[] = new Array<string>(MAX_ENTITIES);
  private readonly entityIdArchIdx = new Int16Array(MAX_ENTITIES).fill(-2);
  private snapshotBankIdx: 0 | 1 = 0;
  private readonly snapshotBanks: [RuntimeSnapshotBank, RuntimeSnapshotBank];
  public readonly floatingTexts: FloatingTextSlot[] = Array.from({ length: MAX_FLOATING_TEXTS }, () => ({
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
      if (target === 'self' && selfSlot >= 0) {
        this.pool.free(selfSlot);
        this.vm.clearEntityVars(selfSlot);
      } else if (target === 'other' && otherSlot >= 0) {
        this.pool.free(otherSlot);
        this.vm.clearEntityVars(otherSlot);
      } else if (target === 'byTag' && tag) {
        for (let i = this.pool.activeCount - 1; i >= 0; i--) {
          const s = this.pool.activeIndices[i];
          const aid = this.pool.archetypeIdx[s] >= 0 ? this.archetypeMetaByIdx[this.pool.archetypeIdx[s]].id : '';
          if (aid === tag) {
            this.pool.free(s);
            this.vm.clearEntityVars(s);
          }
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
    this.orthogonalStepHooks = {
      vm: this.vm,
      juice: this.juice,
      spawnFloatingText: (text, wx, wy, color) => this.spawnFloatingText(text, wx, wy, color),
      eventsOut: this.eventsOut,
    };
    if (this.def.cardEngine) {
      this.cardEngine = new CardDeckEngine(this.def.cardEngine);
    }
    if (this.def.fighterEngine) {
      this.fighterEngine = new FighterFrameEngine(this.def.fighterEngine);
    }
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
          ];

    const combinedRules = [...(this.def.rules ?? []), ...(st.rules ?? [])];
    this.vm.loadRules(combinedRules, this.def.initialVars);
    initGenreStageState(this);

    if (this.def.player.parkourMechanics?.waveDash || this.grappleEnabled) {
      this.relics.airDash = true;
    }

    this.lastHeroSprite = this.def.player.sprite;
    this.visualRig.configure(
      this.def.player.visualRig,
      st.atmosphere,
      st.spawn.x,
      st.spawn.y,
      this.stageViewport.width,
      this.stageViewport.height,
    );
    const atm = st.atmosphere;
    if (
      atm &&
      (atm.waterLevelY !== undefined ||
        atm.horizonHazeAlpha !== undefined ||
        atm.tiltShiftAlpha !== undefined ||
        atm.splitToneWarmth !== undefined)
    ) {
      this.hd2dConfig.enabled = true;
      this.hd2dConfig.sortByDepthY = false;
      this.hd2dConfig.waterLevelY = atm.waterLevelY;
      this.hd2dConfig.waterTint = atm.waterTint ?? '#2e5d8a';
      this.hd2dConfig.horizonHazeColor = atm.horizonHazeColor ?? this.stageSkyBottom;
      this.hd2dConfig.horizonHazeAlpha = atm.horizonHazeAlpha ?? 0.22;
      this.hd2dConfig.tiltShiftAlpha = atm.tiltShiftAlpha ?? 0.14;
      this.hd2dConfig.splitToneWarmth = atm.splitToneWarmth;
    } else {
      this.hd2dConfig.enabled = false;
      this.hd2dConfig.waterLevelY = undefined;
    }

    this.dualPerspective.configure(this.def.perspective, this.tilemap);

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
    this.pool.paramA[slot] = (arch.behaviorMask & BM_CHASE) !== 0 ? 0 : x * 0.1;
    this.pool.paramB[slot] = (arch.behaviorMask & BM_SIN_FLOAT) !== 0 ? y : 0;
    if ((arch.flags & EF_ZIP_BLOCK) !== 0) {
      this.pool.paramA[slot] = x;
      this.pool.paramB[slot] = x + 64;
      this.pool.paramC[slot] = y;
      this.pool.aiState[slot] = 0;
    } else if ((arch.flags & EF_CRUMBLE_TILE) !== 0) {
      this.pool.aiState[slot] = 0;
      this.pool.timerA[slot] = 0;
    }
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
    if (this.fighterEngine) {
      this.fighterEngine.debugBoxesVisible = enabled;
    }
  }

  public getComboCount(): number {
    if (this.fighterEngine) return this.fighterEngine.p1.comboCount;
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
    if (this.cardEngine) {
      this.cardEngine.resetRun();
      this.status = 'playing';
      this.score = 0;
      this.statusBanner = this.cardEngine.lastActionBanner;
      return;
    }
    if (this.fighterEngine) {
      this.fighterEngine.resetRound();
      this.status = 'playing';
      this.score = 0;
      this.statusBanner = this.fighterEngine.lastBanner;
      return;
    }
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
    if (this.cardEngine) {
      if (this.status !== 'playing' && this.input.justPressed('shoulderL')) {
        this.retryCurrentStage();
        this.eventsOut.push('snap');
        return this.eventsOut;
      }
      if (simDt > 0) {
        this.elapsedSec += simDt;
        this.tweens.step(simDt, this.onTweenUpdate);
      }
      this.cardEngine.step(this.input, dt, this.stageViewport.width, this.stageViewport.height, this.orthogonalStepHooks);
      this.score = this.cardEngine.score;
      this.hearts = Math.max(0, Math.ceil((this.cardEngine.heroHp / Math.max(1, this.cardEngine.heroMaxHp)) * this.maxHearts));
      this.status = this.cardEngine.phase === 'won' ? 'won' : this.cardEngine.phase === 'lost' ? 'lost' : 'playing';
      this.statusBanner = this.cardEngine.lastActionBanner;
      this.vm.stepTick(this.vmHost, this.vmCollisions, 0);
      return this.eventsOut;
    }

    if (this.fighterEngine) {
      if (this.status !== 'playing' && this.input.justPressed('shoulderL')) {
        this.retryCurrentStage();
        this.eventsOut.push('snap');
        return this.eventsOut;
      }
      if (simDt > 0) {
        this.elapsedSec += simDt;
        this.tweens.step(simDt, this.onTweenUpdate);
      }
      this.fighterEngine.step(this.input, dt, this.orthogonalStepHooks);
      this.score = this.fighterEngine.score;
      this.hearts = Math.max(0, Math.ceil((this.fighterEngine.p1.hp / Math.max(1, this.fighterEngine.p1.maxHp)) * this.maxHearts));
      this.status = this.fighterEngine.status;
      this.cameraX = this.fighterEngine.cameraX;
      this.cameraY = this.fighterEngine.cameraY;
      this.cameraZoom = this.fighterEngine.cameraZoom;
      this.statusBanner = this.fighterEngine.lastBanner;
      this.vm.stepTick(this.vmHost, this.vmCollisions, 0);
      return this.eventsOut;
    }

    if (ctrl === 'shmup') {
      if (simDt > 0 && this.shmup.phase === 'sortie') this.elapsedSec += simDt;
      if (simDt > 0) this.tweens.step(simDt, this.onTweenUpdate);
      stepShmupSystem(this, dt, simDt, this.eventsOut, params);
      this.vm.stepTick(this.vmHost, this.vmCollisions, 0);
      return this.eventsOut;
    }

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
        if (this.dualPerspective.isEnabled()) {
          stepDataDualPerspectiveStage(this, simDt, params);
        } else if (ctrl === 'fighter') {
          stepFighterController(this, simDt, params, this.eventsOut);
        } else if (ctrl === 'topdown') {
          stepTopdownController(this, simDt, params, this.eventsOut);
        } else {
          stepDataPlatformer(this, simDt, params);
        }
      }
    }

    this.vm.stepTick(this.vmHost, this.vmCollisions, this.vmCollisionCount);
    this.vmCollisionCount = 0;
    return this.eventsOut;
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

  public getEntityId(slot: number, archIdx: number): string {
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
    return projectDataCartridgeSnapshot(this, bank, params, alpha);
  }
}
