import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { GAME_H, GAME_W, resolveLogicalViewport, type LogicalViewport } from '../gpu/GpuTypes.ts';
import { InputMap } from '../input/InputMap.ts';
import { SeededRng } from '../runtime/SeededRng.ts';
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
import { validateCartridgeJson, type CartridgeJsonV1 } from './CartridgeSchema.ts';
import {
  compileArchetypes,
  configureStageAtmosphereAndRig,
  countCampaignStars,
  createDataVmHostBridge,
  createInitialBgStars,
  createInitialShmupState,
  hydrateCartridgeRuntimeSave,
  populateStageTileLayers,
  serializeCartridgeRuntimeSave,
  spawnArchetypeIntoPool,
  spawnFloatingTextInSlots,
  spawnStagePlatformsAndEntities,
  stepAmbientAndFloatingTexts,
  stepSpringOrLerpCamera,
  type CameraTrackState,
  type RuntimeArchetype,
} from './DataRuntimeHelpers.ts';
import {
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
  type VmCollisionPair,
  type VmHostBridge,
} from './EventActionVm.ts';
import { FighterFrameEngine, type FighterStepHooks } from './FighterFrameEngine.ts';
import {
  createRuntimeGenreState,
  initGenreStageState,
  stepCardController,
  stepFighterController,
  stepTopdownController,
  type GenreRuntimeContext,
  type RuntimeGenreState,
} from './GenreControllers.ts';
import { JuiceSystem, stepSquashSpring } from './JuiceSystem.ts';
import { resolveStageArtMood } from './ProceduralStageCompiler.ts';
import { ProceduralVisualRigRuntime } from './ProceduralVisualRig.ts';
import {
  BM_ORBIT,
  BM_PLATFORMER_CTRL,
  BM_TOPDOWN_MOVE,
  EF_PLAYER,
  MAX_ENTITIES,
  SoaEntityPool,
} from './SoaEntityPool.ts';
import {
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
  type TileAabbStepResult,
} from './TilemapGrid.ts';
import { TweenSystem } from './TweenSystem.ts';

export { MAX_FLOATING_TEXTS, type FloatingTextSlot };

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
    DataSnapshotProjectorContext,
    CameraTrackState
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

  public readonly archetypes: RuntimeArchetype[];
  private readonly archetypeIdxById: Map<string, number>;
  public readonly archetypeMetaByIdx: { id: string; scoreValue: number; dropKind?: string }[];

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
  public camVelX = 0;
  public camVelY = 0;
  public prevCamTargetX = 0;
  public prevCamTargetY = 0;
  public springCamFreq = 0;
  public springCamDamping = 1;
  public readonly camSpringOut = new Float64Array(2);
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
  private readonly vmHost: VmHostBridge = createDataVmHostBridge(this);

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

    const compiled = compileArchetypes(this.def.archetypes);
    this.archetypes = compiled.archetypes;
    this.archetypeIdxById = compiled.archetypeIdxById;
    this.archetypeMetaByIdx = compiled.archetypeMetaByIdx;

    const starsSummary = countCampaignStars(this.def.stages, this.archetypeIdxById.has('star'));
    this.bestStarsByStage = starsSummary.bestStarsByStage;
    this.totalCampaignStars = starsSummary.totalCampaignStars;

    this.shmup = createInitialShmupState(this.def, opts?.skipHangar);
    this.bgStars = createInitialBgStars(this.def.stages[0]?.bgStarsCount ?? 0);

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
    this.fgExtraTiles.length = 0;
    this.bgParallaxLayers.length = 0;

    this.hasFgTilemapTiles = populateStageTileLayers({
      stage: st,
      cols,
      rows,
      worldH,
      mood,
      tilemap: this.tilemap,
      fgTilemap: this.fgTilemap,
      tileSpriteLut: this.tileSpriteLut,
      fgSpriteLut: this.fgSpriteLut,
      fgAlphaLut: this.fgAlphaLut,
      fgExtraTiles: this.fgExtraTiles,
      bgParallaxLayers: this.bgParallaxLayers,
      stageSkyBottom: this.stageSkyBottom,
      archetypeIdxById: this.archetypeIdxById,
      archetypes: this.archetypes,
      spawnArchetype: (aid, ax, ay) => this.spawnArchetype(aid, ax, ay),
      onStarSpawned: () => {
        this.stageStarsTotal++;
      },
    });

    const spawned = spawnStagePlatformsAndEntities(
      st,
      this.pool,
      (aid, ax, ay, avx, avy) => this.spawnArchetype(aid, ax, ay, avx, avy),
    );
    this.bossSlot = spawned.bossSlot;
    this.stageHasKey = spawned.stageHasKey;
    this.stageStarsTotal += spawned.starsCounted;

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

    if (!this.stageHasKey && !st.boss) this.gateUnlocked = true;
    if (this.def.stages.length === 1) {
      this.totalCampaignStars = this.stageStarsTotal;
    }

    this.bgClouds = configureStageAtmosphereAndRig(
      st,
      this.def,
      this.stageSkyBottom,
      this.stageViewport,
      this.visualRig,
      this.hd2dConfig,
    );

    const combinedRules = [...(this.def.rules ?? []), ...(st.rules ?? [])];
    this.vm.loadRules(combinedRules, this.def.initialVars);
    initGenreStageState(this);

    if (this.def.player.parkourMechanics?.waveDash || this.grappleEnabled) {
      this.relics.airDash = true;
    }

    this.lastHeroSprite = this.def.player.sprite;
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
    return spawnArchetypeIntoPool(
      this.pool,
      this.archetypes,
      this.archetypeIdxById,
      archetypeId,
      x,
      y,
      vx,
      vy,
      parentSlot,
    );
  }

  public spawnFloatingText(text: string, wx: number, wy: number, color = '#fffaf0'): void {
    this.floatTextCursor = spawnFloatingTextInSlots(
      this.floatingTexts,
      this.floatTextCursor,
      text,
      wx,
      wy,
      color,
    );
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

    stepAmbientAndFloatingTexts(
      this.bgStars,
      this.bgClouds,
      this.pool,
      this.floatingTexts,
      this.stageIdx,
      this.stageWorldW,
      dt,
    );

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
    stepSpringOrLerpCamera(this, targetX, targetY, dt);
  }

  public serializeSave(): unknown {
    return serializeCartridgeRuntimeSave(this);
  }

  public hydrateSave(raw: unknown): boolean {
    return hydrateCartridgeRuntimeSave(this, raw);
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
