import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import {
  analyzeActionReachability,
  analyzeWorldMapReachability,
  observeSceneSemantics,
} from '../core/ai/EcsSpatialOracle.ts';
import {
  buildInteropStudioCommands,
  type InteropCommitOptions,
  type InteropImportResult,
} from '../core/interop/index.ts';
import { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import { syncProjectCustomSpritesToAtlas } from '../core/ecs/EcsCustomSpriteCompiler.ts';
import {
  countEntityOverrides,
  getEntityPrefabId,
  resolveEntityComponents,
  type EcsAmbientParticleTheme,
  type EcsEntityInitDef,
  type EcsPrefabDef,
  type EcsProjectionMode,
  type EcsProjectV2,
} from '../core/ecs/EcsProjectSchema.ts';
import type { EcsAttachableComponent, EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { GpuEngine } from '../core/gpu/GpuEngine.ts';
import type { ViewportPreset } from '../core/gpu/GpuTypes.ts';
import {
  computeCamera3D,
  createComputedCamera3D,
  DEFAULT_HD2D_3D_FOV_DEG,
  DEFAULT_HD2D_3D_PITCH_DEG,
  projectWorld3DToScreen,
  screenToWorldPlaneZ,
  type ComputedCamera3D,
  type ScreenPoint3D,
} from '../core/math/Perspective3DMath.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import { SceneGpuBridge } from '../core/runtime/SceneGpuBridge.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../core/types/WorldTypes.ts';
import { ASTRAL_RIFT_PROJECT } from '../game/astralRift/AstralRiftProject.ts';
import { EMERALD_RUINS_PROJECT } from '../game/emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../game/obsidianCitadel/ObsidianCitadelProject.ts';
import { RHYTHM_BASTION_PROJECT } from '../game/rhythmBastion/RhythmBastionProject.ts';
import { getRoomTile, type EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import {
  createAtlasThumbCanvas,
  createDefaultMapDesignerState,
  drawMapEditorOverlay,
  renderMapDesignerPane,
  type MapDesignerState,
} from './EcsMapDesignerPanel.ts';
import { EventGraphEditorView } from './EventGraphEditorView.ts';
import { ExternalImportModalView } from './ExternalImportModalView.ts';

export interface EcsWorkbenchCallbacks {
  onLaunchInArcade: (proj: EcsProjectV2) => void;
  onOpenClassicWorkshop: () => void;
  onOpenSpriteAtelierForTile?: (layer: EcsMapLayerName) => void;
  onAtlasMutated: () => void;
}

const BUILTIN_ECS_PROJECTS: { id: string; label: string; project: EcsProjectV2 }[] = [
  { id: OBSIDIAN_CITADEL_PROJECT.meta.id, label: 'PA-14 黑曜魔王城：赤月王座 (HD-2D)', project: OBSIDIAN_CITADEL_PROJECT },
  { id: EMERALD_RUINS_PROJECT.meta.id, label: 'PA-15 翠律遺跡：星露聖域 (自訂瓦片 M1)', project: EMERALD_RUINS_PROJECT },
  { id: RHYTHM_BASTION_PROJECT.meta.id, label: 'PA-11 星軌節奏塔防', project: RHYTHM_BASTION_PROJECT },
  { id: ASTRAL_RIFT_PROJECT.meta.id, label: 'PA-12 時空裂隙 (9.0 旗艦)', project: ASTRAL_RIFT_PROJECT },
];

const VIEWPORT_OPTIONS: { id: ViewportPreset; label: string }[] = [
  { id: 'classic', label: '320×180 經典像素' },
  { id: 'hd', label: '480×270 寬像素' },
  { id: 'hd_plus', label: '640×360 HD-2D' },
  { id: 'qhd', label: '960×540 高解析' },
  { id: 'hd720', label: '1280×720 720p' },
];

const HD_SPRITE_OPTIONS: { id: SpriteId; label: string }[] = [
  { id: 'castle_hero_a', label: '魔王城騎士 (32px)' },
  { id: 'castle_demon_lord', label: '魔王馬拉科爾 (48×64)' },
  { id: 'castle_throne', label: '黑曜魔王王座 (48×64)' },
  { id: 'castle_sentinel', label: '黑曜赤戟守衛 (32px)' },
  { id: 'castle_torch_brazier', label: '黑曜火焰火盆 (32px)' },
  { id: 'castle_pillar_tall', label: '哥德石柱 (32×48)' },
  { id: 'castle_banner_crimson', label: '赤月長旗幟 (32×48)' },
  { id: 'castle_chest_closed', label: '魔王城寶箱 (32px)' },
  { id: 'castle_switch_off', label: '符文踏板 (32px)' },
  { id: 'castle_chalice', label: '治癒聖杯 (32px)' },
  { id: 'castle_portal_arch', label: '赤月傳送拱門 (32×48)' },
  { id: 'hd_turret_solar', label: '日輪星塔 (64px)' },
  { id: 'hd_turret_prism', label: '稜鏡星塔 (64px)' },
  { id: 'hd_turret_jade', label: '翠輝星塔 (64px)' },
  { id: 'hd_sanctum_core', label: '星軌聖核 (64px)' },
  { id: 'hd_void_slime', label: '虛空史萊姆 (48px)' },
  { id: 'hd_star_bolt', label: '星軌光彈 (32px)' },
  { id: 'hd_beat_orb_a', label: 'A 軌星拍 (32px)' },
  { id: 'hd_beat_orb_b', label: 'B 軌蒼拍 (32px)' },
  { id: 'hd_arena_tile', label: '星台地磚 (64px)' },
];

const COMPONENT_CATALOG: {
  key: EcsAttachableComponent;
  label: string;
  createDefault: () => unknown;
}[] = [
  {
    key: 'sprite',
    label: 'Material 精靈材質',
    createDefault: () => ({
      sprite: 'hd_turret_solar',
      tint: '#ffffff',
      castShadow: true,
      metallic: 0.75,
      roughness: 0.22,
      emissive: 0.2,
    }),
  },
  {
    key: 'light',
    label: 'LightSource 動態光源',
    createDefault: () => ({ radius: 80, color: '#f59e0b', intensity: 0.92, falloffPower: 1.8 }),
  },
  {
    key: 'body2d',
    label: 'Velocity2D 物理剛體',
    createDefault: () => ({ vx: 0, vy: 0, gravityScale: 0, drag: 0.2 }),
  },
  {
    key: 'health',
    label: 'Health 生命與陣營',
    createDefault: () => ({ hp: 5, maxHp: 5, team: 1 }),
  },
  {
    key: 'collider',
    label: 'Collider 圓形碰撞體',
    createDefault: () => ({ radius: 14, isProjectile: false, damage: 1, hitTag: 'enemy' }),
  },
  {
    key: 'pathFollower',
    label: 'PathFollower 路徑巡航',
    createDefault: () => ({ pathId: 'void_march', speed: 48, loop: true }),
  },
  {
    key: 'rhythmLane',
    label: 'RhythmLane 節拍軌道',
    createDefault: () => ({ lane: 0, judgeX: 112, windowPx: 32 }),
  },
  {
    key: 'characterMotor2d',
    label: 'CharacterMotor2D 動作馬達',
    createDefault: () => ({
      moveSpeed: 150,
      accel: 1200,
      airControl: 0.65,
      gravity: 720,
      maxFallSpeed: 420,
      jumpVelocity: 290,
      coyoteTimeSec: 0.12,
      jumpBufferSec: 0.12,
      dashSpeed: 340,
      dashDurationSec: 0.14,
      dashCooldownSec: 0.55,
      floorY: 224,
    }),
  },
  {
    key: 'grappleAnchor',
    label: 'GrappleAnchor 鉤索錨點',
    createDefault: () => ({
      anchorRadius: 150,
      swingTension: 0.98,
      reelSpeed: 96,
      minLength: 24,
      enabled: true,
    }),
  },
  {
    key: 'triggerZone',
    label: 'TriggerZone 互動感測區',
    createDefault: () => ({
      shape: 'circle',
      radius: 36,
      width: 48,
      height: 48,
      filterTag: '',
      onEnterEvent: 'zone_enter',
      onStayEvent: '',
      onExitEvent: 'zone_exit',
      oneShot: false,
      cooldownSec: 0.25,
    }),
  },
  {
    key: 'verletChain',
    label: 'VerletChain 柔體鍊條',
    createDefault: () => ({
      nodeCount: 6,
      segmentLength: 10,
      gravity: 420,
      damping: 0.96,
      iterations: 4,
      pinStart: true,
      attachOffsetX: 0,
      attachOffsetY: 6,
      color: '#f59e0b',
      thickness: 2,
    }),
  },
  {
    key: 'spatial3d',
    label: 'Spatial3D 立體高度與維度',
    createDefault: () => ({
      z: 24,
      height: 16,
      groundZ: 0,
      gravityZ: 0,
      jumpZVelocity: 190,
      dimensionMask: 1,
      shadowScale: 1.0,
    }),
  },
  {
    key: 'lifetime',
    label: 'Lifetime 存活計時',
    createDefault: () => 4.0,
  },
];

/**
 * Pixer 7.0 Primary Studio Workstation UI:
 * - Left: ECS Entity Hierarchy + Multi-Page Texture Atlas & Sprite Sheet Slicer
 * - Center: Live 60Hz GPU Viewport (320x180..1280x720) with interactive controls & diagnostics
 * - Right: ECS Component Inspector, Sandboxed Script VM Rules & Transaction History
 */
export class EcsWorkbenchView {
  public readonly element: HTMLElement;
  private readonly ac = new AbortController();
  private readonly host: EngineHost;
  private readonly atlas: TextureAtlas;
  private readonly session: EcsStudioSession;
  private readonly callbacks: EcsWorkbenchCallbacks;
  private readonly unsubSession: () => void;

  private readonly previewCanvas: HTMLCanvasElement;
  private readonly mapOverlayCanvas: HTMLCanvasElement;
  private readonly mapOverlayCtx: CanvasRenderingContext2D | null;
  private readonly previewGpu: GpuEngine;
  private readonly previewBridge = new SceneGpuBridge();
  private readonly runtime: EcsCartridgeRuntime;
  private readonly liveInput = createEmptyInputState();

  private leftTab: 'map' | 'hierarchy' | 'prefabs' | 'atlas' = 'map';
  private centerMode: 'viewport' | 'event_graph' = 'viewport';
  private selectedEntityId: string | null = null;
  private selectedPrefabId: string | null = null;
  private filterQuery = '';
  private prefabFilterQuery = '';
  private simRunning = true;
  private debugOverlay = false;
  private visible = false;
  private previewGpuInitialized = false;
  private syncedCustomSpriteIds = new Set<string>();
  private lastLoadedProjectId: string;
  private readonly mapState: MapDesignerState = createDefaultMapDesignerState();
  private hoverTileCol = -1;
  private hoverTileRow = -1;
  private pointerMode: 'none' | 'brush' | 'rect' | 'pan' = 'none';
  private pendingBrushMap = new Map<string, { col: number; row: number; tileId: number }>();
  private rectDrag: { c0: number; r0: number; c1: number; r1: number } | null = null;
  private panOrigin = { clientX: 0, clientY: 0, camX: 0, camY: 0 };
  private readonly editCam3D: ComputedCamera3D = createComputedCamera3D();
  private readonly pickWorldScratch: [number, number] = [0, 0];
  private readonly overlayPtsScratch: readonly [ScreenPoint3D, ScreenPoint3D, ScreenPoint3D, ScreenPoint3D] = [
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
    { x: 0, y: 0, scale: 1, depth: 1, visible: true },
  ];
  private pulseActionFrames = 0;
  private pulseJumpFrames = 0;
  private pulseShiftFrames = 0;
  private readonly heldKeys = {
    left: false,
    right: false,
    up: false,
    down: false,
    dash: false,
  };

  // Dynamic UI refs
  private readonly projectSelectEl: HTMLSelectElement;
  private readonly roomQuickSelectEl: HTMLSelectElement;
  private readonly leftContentEl: HTMLElement;
  private readonly rightContentEl: HTMLElement;
  private readonly rightTitleEl: HTMLElement;
  private readonly statusLeftEl: HTMLElement;
  private readonly statusRightEl: HTMLElement;
  private readonly viewportSelectEl: HTMLSelectElement;
  private readonly projectionSelectEl: HTMLSelectElement;
  private readonly dimensionSelectEl: HTMLSelectElement;
  private readonly playPauseBtn: HTMLButtonElement;
  private readonly hitABtn: HTMLButtonElement;
  private readonly hitBBtn: HTMLButtonElement;
  private readonly shiftRealmBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly leftTabMapBtn: HTMLButtonElement;
  private readonly leftTabHierarchyBtn: HTMLButtonElement;
  private readonly leftTabPrefabsBtn: HTMLButtonElement;
  private readonly leftTabAtlasBtn: HTMLButtonElement;
  private readonly centerTabViewportBtn: HTMLButtonElement;
  private readonly centerTabGraphBtn: HTMLButtonElement;
  private readonly viewportStageEl: HTMLDivElement;
  private readonly eventGraphView: EventGraphEditorView;
  private readonly externalImportModal: ExternalImportModalView;
  private lastDiagReport: { ok: boolean; headline: string; lines: string[] } | null = null;
  private lastStatusSyncAccum = 0;
  private renderPixelW = 1280;
  private renderPixelH = 720;

  constructor(
    host: EngineHost,
    atlas: TextureAtlas,
    session: EcsStudioSession,
    callbacks: EcsWorkbenchCallbacks,
  ) {
    this.host = host;
    this.atlas = atlas;
    this.session = session;
    this.callbacks = callbacks;

    const initialProj = session.getProject();
    this.syncedCustomSpriteIds = syncProjectCustomSpritesToAtlas(
      this.atlas,
      initialProj,
      this.syncedCustomSpriteIds,
    );
    this.lastLoadedProjectId = initialProj.meta.id;
    this.selectedEntityId = initialProj.entities[0]?.id ?? null;
    this.leftTab = initialProj.worldMap ? 'map' : 'hierarchy';
    this.simRunning = !initialProj.worldMap;
    this.runtime = new EcsCartridgeRuntime(initialProj);

    const { signal } = this.ac;

    this.element = document.createElement('section');
    this.element.className = 'p7-workbench';
    this.element.setAttribute('aria-label', 'Pixer 7.0 創作工作站');

    // ================= LEFT PANE (Hierarchy / Prefab Library / Multi-Page Atlas) =================
    const leftPane = document.createElement('aside');
    leftPane.className = 'p7-pane p7-pane-left';

    const leftHead = document.createElement('div');
    leftHead.className = 'p7-pane-header-stack';

    const leftHeadRow = document.createElement('div');
    leftHeadRow.className = 'p7-pane-head-row';
    const leftTitle = document.createElement('h2');
    leftTitle.className = 'p7-pane-title';
    leftTitle.textContent = '專案資產與階層';

    const headBtns = document.createElement('div');
    headBtns.className = 'p7-toolbar-group';

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
    importBtn.dataset.openExternalImport = '1';
    importBtn.textContent = '外部匯入';
    importBtn.title = '匯入 Aseprite / LDtk / Tiled 外部專案與範例';
    importBtn.addEventListener('click', () => this.openExternalImportModal(), { signal });

    const classicBtn = document.createElement('button');
    classicBtn.type = 'button';
    classicBtn.className = 'p7-btn p7-btn-xs';
    classicBtn.textContent = '像素畫室';
    classicBtn.title = '開啟經典像素畫室與積木正交工坊';
    classicBtn.addEventListener('click', () => this.callbacks.onOpenClassicWorkshop(), { signal });
    headBtns.append(importBtn, classicBtn);
    leftHeadRow.append(leftTitle, headBtns);

    this.projectSelectEl = document.createElement('select');
    this.projectSelectEl.className = 'p7-select p7-select-full p7-mono';
    this.projectSelectEl.setAttribute('aria-label', '切換內建純 ECS 專案');
    for (const item of BUILTIN_ECS_PROJECTS) {
      const o = document.createElement('option');
      o.value = item.id;
      o.textContent = item.label;
      this.projectSelectEl.appendChild(o);
    }
    this.projectSelectEl.value = initialProj.meta.id;
    this.projectSelectEl.addEventListener(
      'change',
      () => {
        const picked = BUILTIN_ECS_PROJECTS.find((p) => p.id === this.projectSelectEl.value);
        if (!picked) return;
        this.lastDiagReport = null;
        this.selectedPrefabId = null;
        this.session.dispatch({ type: 'load_project', project: picked.project });
      },
      { signal },
    );

    const seg = document.createElement('div');
    seg.className = 'p7-segmented p7-segmented-full';
    this.leftTabMapBtn = document.createElement('button');
    this.leftTabMapBtn.type = 'button';
    this.leftTabMapBtn.className = this.leftTab === 'map' ? 'p7-seg-btn is-active' : 'p7-seg-btn';
    this.leftTabMapBtn.textContent = '地圖';

    this.leftTabHierarchyBtn = document.createElement('button');
    this.leftTabHierarchyBtn.type = 'button';
    this.leftTabHierarchyBtn.className = this.leftTab === 'hierarchy' ? 'p7-seg-btn is-active' : 'p7-seg-btn';
    this.leftTabHierarchyBtn.textContent = '階層';

    this.leftTabPrefabsBtn = document.createElement('button');
    this.leftTabPrefabsBtn.type = 'button';
    this.leftTabPrefabsBtn.className = 'p7-seg-btn';
    this.leftTabPrefabsBtn.textContent = '物件庫';

    this.leftTabAtlasBtn = document.createElement('button');
    this.leftTabAtlasBtn.type = 'button';
    this.leftTabAtlasBtn.className = 'p7-seg-btn';
    this.leftTabAtlasBtn.textContent = '圖集';

    this.leftTabMapBtn.addEventListener('click', () => this.setLeftTab('map'), { signal });
    this.leftTabHierarchyBtn.addEventListener('click', () => this.setLeftTab('hierarchy'), { signal });
    this.leftTabPrefabsBtn.addEventListener('click', () => this.setLeftTab('prefabs'), { signal });
    this.leftTabAtlasBtn.addEventListener('click', () => this.setLeftTab('atlas'), { signal });
    seg.append(this.leftTabMapBtn, this.leftTabHierarchyBtn, this.leftTabPrefabsBtn, this.leftTabAtlasBtn);

    leftHead.append(leftHeadRow, this.projectSelectEl, seg);
    this.leftContentEl = document.createElement('div');
    this.leftContentEl.className = 'p7-pane-scroll';
    leftPane.append(leftHead, this.leftContentEl);

    // ================= CENTER FOCAL ANCHOR (Live GPU Viewport) =================
    const centerPane = document.createElement('main');
    centerPane.className = 'p7-center';

    const toolbar = document.createElement('div');
    toolbar.className = 'p7-viewport-toolbar';

    const leftGroup = document.createElement('div');
    leftGroup.className = 'p7-toolbar-group';

    this.viewportSelectEl = document.createElement('select');
    this.viewportSelectEl.className = 'p7-select p7-mono';
    this.viewportSelectEl.setAttribute('aria-label', '邏輯視口解析度');
    for (const opt of VIEWPORT_OPTIONS) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      this.viewportSelectEl.appendChild(o);
    }
    this.viewportSelectEl.value = initialProj.viewport.preset ?? 'hd_plus';
    this.viewportSelectEl.addEventListener(
      'change',
      () => {
        const preset = this.viewportSelectEl.value as ViewportPreset;
        this.session.dispatch({ type: 'set_viewport', preset });
      },
      { signal },
    );

    this.playPauseBtn = document.createElement('button');
    this.playPauseBtn.type = 'button';
    this.playPauseBtn.className = 'p7-btn p7-btn-accent';
    this.playPauseBtn.textContent = this.getPlayPauseLabel();
    this.playPauseBtn.addEventListener(
      'click',
      () => {
        this.setSimRunning(!this.simRunning);
      },
      { signal },
    );

    const stepBtn = document.createElement('button');
    stepBtn.type = 'button';
    stepBtn.className = 'p7-btn';
    stepBtn.textContent = '單步';
    stepBtn.addEventListener(
      'click',
      () => {
        this.setSimRunning(false);
        this.runtime.step(1 / 60, this.liveInput, DEFAULT_RUNTIME_PARAMS);
        this.renderPreviewNow();
      },
      { signal },
    );

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'p7-btn';
    resetBtn.textContent = '重置';
    resetBtn.addEventListener(
      'click',
      () => {
        this.runtime.reset();
        this.renderPreviewNow();
      },
      { signal },
    );

    const overlayBtn = document.createElement('button');
    overlayBtn.type = 'button';
    overlayBtn.className = 'p7-btn';
    overlayBtn.textContent = '路徑覆疊';
    overlayBtn.addEventListener(
      'click',
      () => {
        this.debugOverlay = !this.debugOverlay;
        this.runtime.setDebugHitboxes(this.debugOverlay);
        overlayBtn.classList.toggle('p7-btn-accent', this.debugOverlay);
      },
      { signal },
    );

    leftGroup.append(this.viewportSelectEl, this.playPauseBtn, stepBtn, resetBtn, overlayBtn);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'p7-toolbar-group';

    this.undoBtn = document.createElement('button');
    this.undoBtn.type = 'button';
    this.undoBtn.className = 'p7-btn';
    this.undoBtn.textContent = '復原';
    this.undoBtn.addEventListener('click', () => this.session.undo(), { signal });

    this.redoBtn = document.createElement('button');
    this.redoBtn.type = 'button';
    this.redoBtn.className = 'p7-btn';
    this.redoBtn.textContent = '重做';
    this.redoBtn.addEventListener('click', () => this.session.redo(), { signal });

    const diagBtn = document.createElement('button');
    diagBtn.type = 'button';
    diagBtn.className = 'p7-btn';
    diagBtn.textContent = '空間診斷';
    diagBtn.title = 'AI 空間與試玩診斷';
    diagBtn.addEventListener(
      'click',
      () => {
        const proj = this.session.getProject();
        const rep = this.session.runHeadlessPlaytest(180);
        const sem = observeSceneSemantics(proj);
        const reach = analyzeActionReachability(proj);
        const lines: string[] = [
          `狀態 ${rep.status} · 分數 ${rep.score} · 實體 ${rep.activeEntities} · ${rep.systems.length} 系統 · VM ${rep.vmOpsLastFrame} ops/f`,
          `多維空間：${sem.projection.mode} · 啟用位面 [${sem.projection.activeDimensionMask}] · ${sem.entityCount} 實體 · ${sem.solidPlatforms.length} 平台 · ${sem.grappleAnchors.length} 鉤索 · ${sem.triggerZones.length} 感測區`,
        ];
        if (reach.hasActionMotor && reach.kinematics) {
          lines.push(
            `可達性神諭：${reach.pass ? '全部可通關' : '偵測到不可達/軟鎖'} · 節點 ${reach.reachableNodeIds.length}/${reach.nodes.length} · 跳高 ${reach.kinematics.maxJumpHeight}px`,
          );
          if (reach.diagnostics.length > 0) {
            lines.push(`風險：${reach.diagnostics[0]}`);
          }
        } else if (sem.warnings.length > 0) {
          lines.push(`結構提醒：${sem.warnings[0]}`);
        } else {
          lines.push('結構神諭：0 結構異常（未啟用 CharacterMotor2D 平台跳躍）');
        }
        this.lastDiagReport = {
          ok: reach.pass && sem.warnings.length === 0,
          headline: reach.pass ? '180 幀真 ECS 與 AI 空間神諭通過' : 'AI 空間可達性偵測到關卡異常',
          lines,
        };
        this.renderRightPanel();
      },
      { signal },
    );

    const centerModeSeg = document.createElement('div');
    centerModeSeg.className = 'p7-segmented';
    this.centerTabViewportBtn = document.createElement('button');
    this.centerTabViewportBtn.type = 'button';
    this.centerTabViewportBtn.className = 'p7-seg-btn is-active';
    this.centerTabViewportBtn.textContent = '即時視口';
    this.centerTabViewportBtn.addEventListener('click', () => this.setCenterMode('viewport'), { signal });

    this.centerTabGraphBtn = document.createElement('button');
    this.centerTabGraphBtn.type = 'button';
    this.centerTabGraphBtn.className = 'p7-seg-btn';
    this.centerTabGraphBtn.textContent = '腳本事件圖';
    this.centerTabGraphBtn.addEventListener('click', () => this.setCenterMode('event_graph'), { signal });
    centerModeSeg.append(this.centerTabViewportBtn, this.centerTabGraphBtn);

    rightGroup.append(centerModeSeg, this.undoBtn, this.redoBtn, diagBtn);
    toolbar.append(leftGroup, rightGroup);

    const stage = document.createElement('div');
    stage.className = 'p7-viewport-stage';
    this.viewportStageEl = stage;

    this.eventGraphView = new EventGraphEditorView(this.session);
    this.eventGraphView.element.classList.add('panel-hidden');

    const canvasFrame = document.createElement('div');
    canvasFrame.className = 'p7-canvas-frame';

    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.className = 'p7-live-canvas';
    this.previewCanvas.setAttribute('data-testid', 'ecs-preview-canvas');
    this.previewCanvas.width = initialProj.viewport.width;
    this.previewCanvas.height = initialProj.viewport.height;

    this.mapOverlayCanvas = document.createElement('canvas');
    this.mapOverlayCanvas.className = 'p7-map-overlay';
    this.mapOverlayCanvas.setAttribute('data-testid', 'ecs-map-overlay');
    this.mapOverlayCanvas.width = initialProj.viewport.width;
    this.mapOverlayCanvas.height = initialProj.viewport.height;
    this.mapOverlayCtx = this.mapOverlayCanvas.getContext('2d');
    canvasFrame.append(this.previewCanvas, this.mapOverlayCanvas);
    this.bindMapCanvasEvents(signal);

    // Direct interactive play controls right beneath viewport
    const playBar = document.createElement('div');
    playBar.className = 'p7-play-bar';

    this.roomQuickSelectEl = document.createElement('select');
    this.roomQuickSelectEl.className = 'p7-select p7-mono';
    this.roomQuickSelectEl.setAttribute('aria-label', '快速切換地圖房間');
    this.roomQuickSelectEl.addEventListener(
      'change',
      () => {
        this.switchActiveRoom(this.roomQuickSelectEl.value);
      },
      { signal },
    );

    this.hitABtn = document.createElement('button');
    this.hitABtn.type = 'button';
    this.hitABtn.className = 'p7-btn p7-btn-accent';
    this.hitABtn.textContent = '打擊上軌星拍 [A]';
    this.hitABtn.addEventListener(
      'click',
      () => {
        this.host.unlockAudio();
        if (this.session.getProject().worldMap && !this.simRunning) {
          this.setSimRunning(true);
        }
        this.pulseActionFrames = 4;
      },
      { signal },
    );

    this.hitBBtn = document.createElement('button');
    this.hitBBtn.type = 'button';
    this.hitBBtn.className = 'p7-btn';
    this.hitBBtn.textContent = '打擊下軌蒼拍 [B]';
    this.hitBBtn.addEventListener(
      'click',
      () => {
        this.host.unlockAudio();
        if (this.session.getProject().worldMap && !this.simRunning) {
          this.setSimRunning(true);
        }
        this.pulseJumpFrames = 4;
      },
      { signal },
    );

    this.shiftRealmBtn = document.createElement('button');
    this.shiftRealmBtn.type = 'button';
    this.shiftRealmBtn.className = 'p7-btn';
    this.shiftRealmBtn.textContent = '切換表裡世界 [R]';
    this.shiftRealmBtn.addEventListener(
      'click',
      () => {
        this.host.unlockAudio();
        this.pulseShiftFrames = 2;
      },
      { signal },
    );

    const launchArcadeBtn = document.createElement('button');
    launchArcadeBtn.type = 'button';
    launchArcadeBtn.className = 'p7-btn';
    launchArcadeBtn.textContent = '掌機試玩';
    launchArcadeBtn.title = '同步至掌機外殼試玩';
    launchArcadeBtn.addEventListener(
      'click',
      () => {
        this.callbacks.onLaunchInArcade(this.session.getProject());
      },
      { signal },
    );

    this.projectionSelectEl = document.createElement('select');
    this.projectionSelectEl.className = 'p7-select p7-mono';
    this.projectionSelectEl.setAttribute('aria-label', '多維投影視角模式');
    const projOptions: { id: EcsProjectionMode; label: string }[] = [
      { id: 'hd2d_3d', label: '真 3D 透視 (HD-2D)' },
      { id: 'hd2d_iso', label: '3/4 強立體 (2.5D)' },
      { id: 'ortho_2d', label: '2D 純平正交' },
      { id: 'first_person_25d', label: '1P 2.5D 視角' },
    ];
    for (const opt of projOptions) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      this.projectionSelectEl.appendChild(o);
    }
    this.projectionSelectEl.value = initialProj.projection?.mode ?? 'hd2d_3d';
    this.projectionSelectEl.addEventListener(
      'change',
      () => {
        this.session.dispatch({
          type: 'set_projection',
          patch: { mode: this.projectionSelectEl.value as EcsProjectionMode },
        });
      },
      { signal },
    );

    this.dimensionSelectEl = document.createElement('select');
    this.dimensionSelectEl.className = 'p7-select p7-mono';
    this.dimensionSelectEl.setAttribute('aria-label', '目前檢視維度位面');
    const dimOptions: { mask: number; label: string }[] = [
      { mask: 3, label: '全維度 [3]' },
      { mask: 1, label: '表世界 [1]' },
      { mask: 2, label: '裡世界 [2]' },
    ];
    for (const opt of dimOptions) {
      const o = document.createElement('option');
      o.value = String(opt.mask);
      o.textContent = opt.label;
      this.dimensionSelectEl.appendChild(o);
    }
    this.dimensionSelectEl.value = String(initialProj.projection?.activeDimensionMask ?? 3);
    this.dimensionSelectEl.addEventListener(
      'change',
      () => {
        const mask = Number(this.dimensionSelectEl.value) || 3;
        this.runtime.setActiveDimensionMask(mask);
        this.session.dispatch({
          type: 'set_projection',
          patch: { activeDimensionMask: mask },
        });
      },
      { signal },
    );

    playBar.append(
      this.roomQuickSelectEl,
      this.hitABtn,
      this.hitBBtn,
      this.shiftRealmBtn,
      this.projectionSelectEl,
      this.dimensionSelectEl,
      launchArcadeBtn,
    );
    stage.append(canvasFrame, playBar);

    const statusStrip = document.createElement('div');
    statusStrip.className = 'p7-status-strip p7-mono';
    this.statusLeftEl = document.createElement('span');
    this.statusRightEl = document.createElement('span');
    statusStrip.append(this.statusLeftEl, this.statusRightEl);

    centerPane.append(toolbar, stage, this.eventGraphView.element, statusStrip);

    // ================= RIGHT PANE (ECS Inspector & Script VM) =================
    const rightPane = document.createElement('aside');
    rightPane.className = 'p7-pane p7-pane-right';

    const rightHead = document.createElement('div');
    rightHead.className = 'p7-pane-header';
    this.rightTitleEl = document.createElement('h2');
    this.rightTitleEl.className = 'p7-pane-title';
    this.rightTitleEl.textContent = 'ECS 元件檢查器與沙盒腳本';
    rightHead.appendChild(this.rightTitleEl);

    this.rightContentEl = document.createElement('div');
    this.rightContentEl.className = 'p7-pane-scroll';
    rightPane.append(rightHead, this.rightContentEl);

    this.externalImportModal = new ExternalImportModalView({
      onCommit: (result, options) => this.handleExternalImportCommit(result, options),
    });

    this.element.append(leftPane, centerPane, rightPane, this.externalImportModal.element);

    // Dedicated preview GPU engine bound to shared TextureAtlas (lazy-initialized on first show)
    this.previewGpu = new GpuEngine(this.previewCanvas, undefined, this.atlas);

    // Keyboard shortcuts when Studio Workstation is visible
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.visible || this.externalImportModal.isOpen()) return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const proj = this.session.getProject();
        const isWorldMap = Boolean(proj.worldMap);
        const hasMotor =
          this.runtime.world.core.getStore(this.runtime.world.core.components.CharacterMotor2D).size() > 0;

        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey) this.session.redo();
          else this.session.undo();
          return;
        }

        if (isWorldMap) {
          if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.heldKeys.left = true;
          else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.heldKeys.right = true;
          else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.heldKeys.up = true;
          else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.heldKeys.down = true;
          else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.heldKeys.dash = true;
          else if (e.code === 'Space' || e.code === 'KeyK') {
            e.preventDefault();
            this.host.unlockAudio();
            this.pulseJumpFrames = 4;
          } else if (e.code === 'KeyJ' || e.code === 'KeyZ' || e.code === 'Enter') {
            this.host.unlockAudio();
            this.pulseActionFrames = 4;
          } else if (!this.simRunning) {
            if (e.code === 'KeyB') { this.mapState.tool = 'brush'; this.renderLeftPanel(); }
            else if (e.code === 'KeyR') { this.mapState.tool = 'rect'; this.renderLeftPanel(); }
            else if (e.code === 'KeyG') { this.mapState.tool = 'fill'; this.renderLeftPanel(); }
            else if (e.code === 'KeyE') { this.mapState.tool = 'erase'; this.renderLeftPanel(); }
            else if (e.code === 'KeyI') { this.mapState.tool = 'eyedropper'; this.renderLeftPanel(); }
          }
          return;
        }

        if (e.code === 'ArrowLeft') {
          this.heldKeys.left = true;
        } else if (e.code === 'ArrowRight') {
          this.heldKeys.right = true;
        } else if (e.code === 'ArrowUp') {
          this.heldKeys.up = true;
        } else if (e.code === 'ArrowDown') {
          this.heldKeys.down = true;
        } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          this.heldKeys.dash = true;
        } else if (e.code === 'Space') {
          this.host.unlockAudio();
          if (hasMotor) this.pulseJumpFrames = 3;
          else this.pulseActionFrames = 3;
        } else if (e.code === 'KeyA' || e.code === 'KeyJ') {
          this.host.unlockAudio();
          this.pulseActionFrames = 3;
        } else if (e.code === 'KeyB' || e.code === 'KeyK') {
          this.host.unlockAudio();
          this.pulseJumpFrames = 3;
        } else if (e.code === 'KeyR') {
          this.host.unlockAudio();
          this.pulseShiftFrames = 2;
        }
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.heldKeys.left = false;
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.heldKeys.right = false;
        else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.heldKeys.up = false;
        else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.heldKeys.down = false;
        else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.heldKeys.dash = false;
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        this.heldKeys.left = false;
        this.heldKeys.right = false;
        this.heldKeys.up = false;
        this.heldKeys.down = false;
        this.heldKeys.dash = false;
      },
      { signal },
    );

    this.unsubSession = this.session.onChange((proj) => {
      const sameProject = proj.meta.id === this.lastLoadedProjectId;
      this.lastLoadedProjectId = proj.meta.id;
      this.syncProjectCustomSprites(proj);
      this.runtime.reloadProject(proj, sameProject);
      if (!sameProject) {
        this.runtime.clearEditorCamera();
        this.simRunning = !proj.worldMap;
        this.setLeftTab(proj.worldMap ? 'map' : 'hierarchy');
        const customGround = proj.worldMap?.tileDefs?.find((t) => t.layer === 'ground');
        if (customGround) {
          this.mapState.layer = 'ground';
          this.mapState.selectedTileId = customGround.id;
          this.mapState.tool = 'brush';
          this.mapState.selectedStampPrefabId = null;
        }
      }
      this.syncViewportSize(proj);
      if (this.selectedEntityId && !proj.entities.some((e) => e.id === this.selectedEntityId)) {
        this.selectedEntityId = proj.entities[0]?.id ?? null;
      }
      if (this.selectedPrefabId && !proj.prefabs[this.selectedPrefabId]) {
        this.selectedPrefabId = null;
      }
      this.renderAllPanels();
      this.renderPreviewNow();
    });

    this.renderAllPanels();
  }

  private syncProjectCustomSprites(proj: EcsProjectV2): void {
    this.syncedCustomSpriteIds = syncProjectCustomSpritesToAtlas(
      this.atlas,
      proj,
      this.syncedCustomSpriteIds,
    );
    this.previewGpu.syncAtlasIfDirty();
    this.callbacks.onAtlasMutated();
  }

  public focusPublishedTile(layer: EcsMapLayerName, tileId: number): void {
    this.mapState.layer = layer;
    this.mapState.selectedTileId = tileId;
    this.mapState.tool = 'brush';
    this.mapState.selectedStampPrefabId = null;
    if (this.simRunning) this.setSimRunning(false);
    this.setLeftTab('map');
    this.renderAllPanels();
    this.renderPreviewNow();
  }

  public focusPublishedPrefab(prefabId: string): void {
    this.mapState.tool = 'stamp';
    this.mapState.selectedStampPrefabId = prefabId;
    this.selectedPrefabId = prefabId;
    if (this.simRunning) this.setSimRunning(false);
    this.setLeftTab(this.session.getProject().worldMap ? 'map' : 'prefabs');
    this.renderAllPanels();
    this.renderPreviewNow();
  }

  private getPlayPauseLabel(): string {
    const hasMap = Boolean(this.session.getProject().worldMap);
    if (hasMap) return this.simRunning ? '返回編輯地圖' : '開始試玩';
    return this.simRunning ? '暫停模擬' : '繼續模擬';
  }

  private setSimRunning(running: boolean): void {
    this.simRunning = running;
    if (running) {
      this.runtime.clearEditorCamera();
      this.pointerMode = 'none';
      this.rectDrag = null;
      this.pendingBrushMap.clear();
    }
    this.playPauseBtn.textContent = this.getPlayPauseLabel();
    this.syncMapOverlayInteractivity();
    this.renderPreviewNow();
  }

  private isMapEditingActive(): boolean {
    return Boolean(this.session.getProject().worldMap) && !this.simRunning && this.centerMode === 'viewport';
  }

  private syncMapOverlayInteractivity(): void {
    const active = this.isMapEditingActive();
    this.mapOverlayCanvas.classList.toggle('is-interactive', active);
    this.mapOverlayCanvas.classList.toggle('is-pan', active && this.mapState.tool === 'pan');
    if (!active && this.mapOverlayCtx) {
      this.mapOverlayCtx.clearRect(0, 0, this.mapOverlayCanvas.width, this.mapOverlayCanvas.height);
    }
  }

  private switchActiveRoom(roomId: string): void {
    this.runtime.switchRoomForEditor(roomId);
    const proj = this.session.getProject();
    const room = proj.worldMap?.rooms.find((r) => r.id === roomId);
    if (!this.simRunning && room && proj.worldMap) {
      const ts = proj.worldMap.tileSize;
      const worldW = room.cols * ts;
      const centerX = Math.max(0, (worldW - proj.viewport.width) * 0.5);
      if (typeof room.editorFocusY === 'number') {
        this.runtime.setEditorCamera(centerX, room.editorFocusY);
      } else {
        this.runtime.clearEditorCamera();
      }
    } else {
      this.runtime.clearEditorCamera();
    }
    this.renderAllPanels();
    this.renderPreviewNow();
  }

  private computeActiveEditorCamera3D(proj: EcsProjectV2): ComputedCamera3D | null {
    if (proj.projection?.mode !== 'hd2d_3d' || !this.previewGpu.supports3D()) {
      return null;
    }
    const cam = this.runtime.getCamera();
    const viewW = proj.viewport.width;
    const viewH = proj.viewport.height;
    return computeCamera3D(
      {
        camCenterX: Math.round(cam.x) + viewW * 0.5,
        camCenterY: Math.round(cam.y) + viewH * 0.5,
        zoom: 1,
        viewW,
        viewH,
        pitchDeg: proj.projection.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG,
        fovDeg: proj.projection.fovDeg ?? DEFAULT_HD2D_3D_FOV_DEG,
      },
      this.editCam3D,
    );
  }

  private screenToTile(clientX: number, clientY: number): { col: number; row: number; worldX: number; worldY: number } | null {
    const proj = this.session.getProject();
    if (!proj.worldMap) return null;
    const rect = this.mapOverlayCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    const ts = Math.max(8, proj.worldMap.tileSize);

    const cam3d = this.computeActiveEditorCamera3D(proj);
    let worldX: number;
    let worldY: number;
    if (cam3d) {
      const screenX = relX * proj.viewport.width;
      const screenY = relY * proj.viewport.height;
      if (!screenToWorldPlaneZ(screenX, screenY, cam3d, this.pickWorldScratch, 0)) {
        return null;
      }
      worldX = this.pickWorldScratch[0];
      worldY = this.pickWorldScratch[1];
    } else {
      const cam = this.runtime.getCamera();
      worldX = cam.x + relX * proj.viewport.width;
      worldY = cam.y + relY * proj.viewport.height;
    }
    return {
      col: Math.floor(worldX / ts),
      row: Math.floor(worldY / ts),
      worldX,
      worldY,
    };
  }

  private bindMapCanvasEvents(signal: AbortSignal): void {
    this.mapOverlayCanvas.addEventListener(
      'contextmenu',
      (e) => {
        if (this.isMapEditingActive()) e.preventDefault();
      },
      { signal },
    );

    this.mapOverlayCanvas.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.isMapEditingActive()) return;
        const proj = this.session.getProject();
        const wm = proj.worldMap;
        const roomId = this.runtime.getActiveRoomId();
        if (!wm || !roomId) return;
        const room = wm.rooms.find((r) => r.id === roomId);
        if (!room) return;

        this.mapOverlayCanvas.setPointerCapture(e.pointerId);

        if (e.button === 2 || e.button === 1 || this.mapState.tool === 'pan') {
          const cam = this.runtime.getCamera();
          this.pointerMode = 'pan';
          this.panOrigin = { clientX: e.clientX, clientY: e.clientY, camX: cam.x, camY: cam.y };
          return;
        }

        const hit = this.screenToTile(e.clientX, e.clientY);
        if (!hit || hit.col < 0 || hit.col >= room.cols || hit.row < 0 || hit.row >= room.rows) return;
        this.hoverTileCol = hit.col;
        this.hoverTileRow = hit.row;

        if (this.mapState.tool === 'eyedropper') {
          const tid = getRoomTile(room, this.mapState.layer, hit.col, hit.row);
          if (tid > 0) {
            this.mapState.selectedTileId = tid;
            this.mapState.tool = 'brush';
            this.renderLeftPanel();
          }
          return;
        }

        if (this.mapState.tool === 'fill') {
          this.session.dispatch({
            type: 'flood_fill',
            roomId: room.id,
            layer: this.mapState.layer,
            col: hit.col,
            row: hit.row,
            tileId: this.mapState.selectedTileId,
          });
          return;
        }

        if (this.mapState.tool === 'stamp' && this.mapState.selectedStampPrefabId) {
          const ts = wm.tileSize;
          const res = this.session.dispatch({
            type: 'instantiate_prefab',
            prefabId: this.mapState.selectedStampPrefabId,
            x: hit.col * ts + ts * 0.5,
            y: hit.row * ts + ts * 0.5,
            roomId: room.id,
          });
          if (res.ok && res.createdEntityId) {
            this.selectedEntityId = res.createdEntityId;
            this.renderRightPanel();
          }
          return;
        }

        if (this.mapState.tool === 'rect') {
          this.pointerMode = 'rect';
          this.rectDrag = { c0: hit.col, r0: hit.row, c1: hit.col, r1: hit.row };
          return;
        }

        if (this.mapState.tool === 'brush' || this.mapState.tool === 'erase') {
          this.pointerMode = 'brush';
          this.pendingBrushMap.clear();
          const tileId = this.mapState.tool === 'erase' ? 0 : this.mapState.selectedTileId;
          this.pendingBrushMap.set(`${hit.col},${hit.row}`, { col: hit.col, row: hit.row, tileId });
        }
      },
      { signal },
    );

    this.mapOverlayCanvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.isMapEditingActive()) return;
        const proj = this.session.getProject();
        const wm = proj.worldMap;
        const roomId = this.runtime.getActiveRoomId();
        if (!wm || !roomId) return;
        const room = wm.rooms.find((r) => r.id === roomId);
        if (!room) return;

        if (this.pointerMode === 'pan') {
          const rect = this.mapOverlayCanvas.getBoundingClientRect();
          const scaleX = proj.viewport.width / Math.max(1, rect.width);
          const scaleY = proj.viewport.height / Math.max(1, rect.height);
          const dx = (e.clientX - this.panOrigin.clientX) * scaleX;
          const dy = (e.clientY - this.panOrigin.clientY) * scaleY;
          this.runtime.setEditorCamera(this.panOrigin.camX - dx, this.panOrigin.camY - dy);
          return;
        }

        const hit = this.screenToTile(e.clientX, e.clientY);
        if (!hit) return;
        this.hoverTileCol = hit.col;
        this.hoverTileRow = hit.row;

        if (this.pointerMode === 'rect' && this.rectDrag) {
          this.rectDrag.c1 = Math.max(0, Math.min(room.cols - 1, hit.col));
          this.rectDrag.r1 = Math.max(0, Math.min(room.rows - 1, hit.row));
        } else if (this.pointerMode === 'brush') {
          if (hit.col >= 0 && hit.col < room.cols && hit.row >= 0 && hit.row < room.rows) {
            const tileId = this.mapState.tool === 'erase' ? 0 : this.mapState.selectedTileId;
            this.pendingBrushMap.set(`${hit.col},${hit.row}`, { col: hit.col, row: hit.row, tileId });
          }
        }
      },
      { signal },
    );

    const finishPointer = () => {
      if (this.pointerMode === 'none') return;
      const roomId = this.runtime.getActiveRoomId();
      if (this.pointerMode === 'brush' && roomId && this.pendingBrushMap.size > 0) {
        this.session.dispatch({
          type: 'paint_tiles',
          roomId,
          layer: this.mapState.layer,
          changes: Array.from(this.pendingBrushMap.values()),
        });
      } else if (this.pointerMode === 'rect' && roomId && this.rectDrag) {
        this.session.dispatch({
          type: 'fill_rect',
          roomId,
          layer: this.mapState.layer,
          c0: this.rectDrag.c0,
          r0: this.rectDrag.r0,
          c1: this.rectDrag.c1,
          r1: this.rectDrag.r1,
          tileId: this.mapState.selectedTileId,
        });
      }
      this.pointerMode = 'none';
      this.rectDrag = null;
      this.pendingBrushMap.clear();
    };

    this.mapOverlayCanvas.addEventListener('pointerup', finishPointer, { signal });
    this.mapOverlayCanvas.addEventListener('pointercancel', finishPointer, { signal });
    this.mapOverlayCanvas.addEventListener(
      'pointerleave',
      () => {
        if (this.pointerMode === 'none') {
          this.hoverTileCol = -1;
          this.hoverTileRow = -1;
        }
      },
      { signal },
    );
  }

  private ensurePreviewGpuInit(): void {
    if (this.previewGpuInitialized) return;
    this.previewGpuInitialized = true;
    void this.previewGpu.init().then(() => {
      this.syncViewportSize(this.session.getProject());
      this.previewGpu.syncAtlasToGpu();
      if (this.visible) this.renderPreviewNow();
    });
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.classList.toggle('panel-hidden', !visible);
    if (visible) {
      this.ensurePreviewGpuInit();
      this.previewGpu.syncAtlasToGpu();
      this.renderAllPanels();
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public setLeftTab(tab: 'map' | 'hierarchy' | 'prefabs' | 'atlas'): void {
    this.leftTab = tab;
    this.leftTabMapBtn.classList.toggle('is-active', tab === 'map');
    this.leftTabHierarchyBtn.classList.toggle('is-active', tab === 'hierarchy');
    this.leftTabPrefabsBtn.classList.toggle('is-active', tab === 'prefabs');
    this.leftTabAtlasBtn.classList.toggle('is-active', tab === 'atlas');
    this.renderLeftPanel();
  }

  public setCenterMode(mode: 'viewport' | 'event_graph', focusScriptId?: string): void {
    this.centerMode = mode;
    this.centerTabViewportBtn.classList.toggle('is-active', mode === 'viewport');
    this.centerTabGraphBtn.classList.toggle('is-active', mode === 'event_graph');
    this.viewportStageEl.classList.toggle('panel-hidden', mode !== 'viewport');
    this.eventGraphView.element.classList.toggle('panel-hidden', mode !== 'event_graph');
    if (mode === 'event_graph') {
      this.eventGraphView.syncProject(this.session.getProject(), focusScriptId);
      this.eventGraphView.updateLiveTrace(this.runtime.vm);
    }
  }

  public getPreviewCanvas(): HTMLCanvasElement {
    return this.previewCanvas;
  }

  public syncAtlasToPreview(): void {
    this.previewGpu.syncAtlasToGpu();
    if (this.leftTab === 'atlas') {
      this.renderLeftPanel();
    }
  }

  private syncViewportSize(proj: EcsProjectV2): void {
    const w = proj.viewport.width;
    const h = proj.viewport.height;
    // DPR-aware supersampling: 1280x720 on standard displays, up to 1920x1080 on Retina/HiDPI displays
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const maxW = dpr >= 1.75 ? 1920 : 1280;
    const maxH = dpr >= 1.75 ? 1080 : 720;
    let scale = 3;
    while (scale > 1 && (w * scale > maxW || h * scale > maxH)) {
      scale--;
    }
    this.renderPixelW = w * scale;
    this.renderPixelH = h * scale;
    this.previewGpu.setLogicalViewport(w, h);
    this.previewGpu.resize(this.renderPixelW, this.renderPixelH);
    this.mapOverlayCanvas.width = w;
    this.mapOverlayCanvas.height = h;
    this.previewCanvas.classList.toggle('is-smooth', w >= 640);
    if (proj.viewport.preset) {
      this.viewportSelectEl.value = proj.viewport.preset;
    }
  }

  public tick(dt: number): void {
    if (!this.visible) return;
    const proj = this.session.getProject();
    if (this.simRunning) {
      this.liveInput.left = this.heldKeys.left;
      this.liveInput.right = this.heldKeys.right;
      this.liveInput.up = this.heldKeys.up;
      this.liveInput.down = this.heldKeys.down;
      this.liveInput.skillX = this.heldKeys.dash;
      this.liveInput.action = this.pulseActionFrames > 0;
      this.liveInput.jump = this.pulseJumpFrames > 0;
      this.liveInput.shoulderR = this.pulseShiftFrames > 0;
      if (this.pulseActionFrames > 0) this.pulseActionFrames--;
      if (this.pulseJumpFrames > 0) this.pulseJumpFrames--;
      if (this.pulseShiftFrames > 0) this.pulseShiftFrames--;

      const events = this.runtime.step(Math.min(1 / 30, dt), this.liveInput, DEFAULT_RUNTIME_PARAMS);
      for (let i = 0; i < events.length; i++) {
        if (events[i] === 'star') this.host.playStereoTick(880, 0, 0.14);
        else if (events[i] === 'snap' || events[i] === 'jump') this.host.playStereoTick(660, 0, 0.1);
      }
    } else if (proj.worldMap) {
      // Smooth keyboard camera pan while editing large scrolling castle maps
      const panSpeed = 240 * Math.min(1 / 20, dt);
      const dx = (this.heldKeys.right ? 1 : 0) - (this.heldKeys.left ? 1 : 0);
      const dy = (this.heldKeys.down ? 1 : 0) - (this.heldKeys.up ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const cam = this.runtime.getCamera();
        this.runtime.setEditorCamera(cam.x + dx * panSpeed, cam.y + dy * panSpeed);
      }
    }
    if (this.centerMode === 'viewport') {
      this.renderPreviewNow();
    } else {
      this.eventGraphView.updateLiveTrace(this.runtime.vm);
    }

    this.lastStatusSyncAccum += dt;
    if (this.lastStatusSyncAccum >= 0.25) {
      this.lastStatusSyncAccum = 0;
      this.updateStatusStrip();
    }
  }

  private renderPreviewNow(): void {
    const snap = this.runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    this.previewBridge.render(this.previewGpu, snap, null);
    this.renderMapOverlayNow();
  }

  private renderMapOverlayNow(): void {
    if (!this.mapOverlayCtx) return;
    if (!this.isMapEditingActive()) {
      this.mapOverlayCtx.clearRect(0, 0, this.mapOverlayCanvas.width, this.mapOverlayCanvas.height);
      return;
    }
    const proj = this.session.getProject();
    const wm = proj.worldMap;
    const activeRoomId = this.runtime.getActiveRoomId();
    const room = wm?.rooms.find((r) => r.id === activeRoomId);
    if (!wm || !room) return;
    const cam = this.runtime.getCamera();
    const cam3d = this.computeActiveEditorCamera3D(proj);
    drawMapEditorOverlay(this.mapOverlayCanvas, this.mapOverlayCtx, {
      room,
      portals: wm.portals.filter((p) => p.fromRoomId === room.id),
      tileSize: wm.tileSize,
      camX: cam.x,
      camY: cam.y,
      viewW: proj.viewport.width,
      viewH: proj.viewport.height,
      state: this.mapState,
      hoverCol: this.hoverTileCol,
      hoverRow: this.hoverTileRow,
      rectDrag: this.rectDrag,
      camera3D: cam3d,
    });

    // Live pending brush stroke cells highlight before pointerup commit
    if (this.pendingBrushMap.size > 0) {
      const sx = this.mapOverlayCanvas.width / Math.max(1, proj.viewport.width);
      const sy = this.mapOverlayCanvas.height / Math.max(1, proj.viewport.height);
      const ts = wm.tileSize;
      this.mapOverlayCtx.fillStyle =
        this.mapState.tool === 'erase' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.38)';
      if (cam3d) {
        const [p0, p1, p2, p3] = this.overlayPtsScratch;
        for (const edit of this.pendingBrushMap.values()) {
          const x0 = edit.col * ts;
          const y0 = edit.row * ts;
          projectWorld3DToScreen(x0, y0, 0, cam3d, p0);
          projectWorld3DToScreen(x0 + ts, y0, 0, cam3d, p1);
          projectWorld3DToScreen(x0 + ts, y0 + ts, 0, cam3d, p2);
          projectWorld3DToScreen(x0, y0 + ts, 0, cam3d, p3);
          if (!p0.visible || !p1.visible || !p2.visible || !p3.visible) continue;
          this.mapOverlayCtx.beginPath();
          this.mapOverlayCtx.moveTo(p0.x * sx, p0.y * sy);
          this.mapOverlayCtx.lineTo(p1.x * sx, p1.y * sy);
          this.mapOverlayCtx.lineTo(p2.x * sx, p2.y * sy);
          this.mapOverlayCtx.lineTo(p3.x * sx, p3.y * sy);
          this.mapOverlayCtx.closePath();
          this.mapOverlayCtx.fill();
        }
      } else {
        for (const edit of this.pendingBrushMap.values()) {
          this.mapOverlayCtx.fillRect(
            (edit.col * ts - cam.x) * sx,
            (edit.row * ts - cam.y) * sy,
            ts * sx,
            ts * sy,
          );
        }
      }
    }
  }

  private updateStatusStrip(): void {
    const proj = this.session.getProject();
    const stats = this.atlas.getAtlasStats();
    const snap = this.runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    const sysCount = this.runtime.world.getSystemPipeline().length;
    const activeRoomId = this.runtime.getActiveRoomId();
    const activeRoom = proj.worldMap?.rooms.find((r) => r.id === activeRoomId);
    const roomPart = activeRoom ? ` · 房間 ${activeRoom.name} (${activeRoom.cols}×${activeRoom.rows})` : '';
    this.statusLeftEl.textContent =
      `${proj.meta.code} ${proj.meta.title}${roomPart} · 視口 ${proj.viewport.width}×${proj.viewport.height}` +
      ` · ECS ${this.runtime.world.activeCount} 實體 / ${sysCount} 系統`;
    this.statusRightEl.textContent =
      `圖集 ${stats.pageCount}/${stats.maxPages} 頁 · ${this.simRunning ? '試玩中' : '編輯模式'} · 分數 ${snap.score} · 修訂 #${this.session.getRevision()}`;
  }

  private renderAllPanels(): void {
    const proj = this.session.getProject();
    if (BUILTIN_ECS_PROJECTS.some((p) => p.id === proj.meta.id)) {
      this.projectSelectEl.value = proj.meta.id;
    }
    const isWorldMap = Boolean(proj.worldMap);
    const isRhythm = Boolean(proj.rhythmTrack?.enabled);
    this.playPauseBtn.textContent = this.getPlayPauseLabel();
    this.hitABtn.textContent = isWorldMap
      ? '揮劍斬擊 [J]'
      : isRhythm
        ? '打擊上軌星拍 [A]'
        : '鉤索 / 動作 [A]';
    this.hitBBtn.textContent = isWorldMap
      ? '翻滾衝刺 [Space]'
      : isRhythm
        ? '打擊下軌蒼拍 [B]'
        : '跳躍 [B]';
    this.shiftRealmBtn.classList.toggle('panel-hidden', isWorldMap || !proj.projection?.allowDimensionShift);
    this.dimensionSelectEl.classList.toggle('panel-hidden', isWorldMap);
    this.roomQuickSelectEl.classList.toggle('panel-hidden', !isWorldMap);

    if (proj.worldMap) {
      const activeRoomId = this.runtime.getActiveRoomId() ?? proj.worldMap.startRoomId;
      this.roomQuickSelectEl.textContent = '';
      for (const r of proj.worldMap.rooms) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        this.roomQuickSelectEl.appendChild(opt);
      }
      this.roomQuickSelectEl.value = activeRoomId;
    }

    this.projectionSelectEl.value = proj.projection?.mode ?? 'hd2d_iso';
    this.dimensionSelectEl.value = String(proj.projection?.activeDimensionMask ?? 3);
    this.undoBtn.disabled = !this.session.canUndo();
    this.redoBtn.disabled = !this.session.canRedo();
    this.syncMapOverlayInteractivity();
    this.eventGraphView.syncProject(proj);
    this.renderLeftPanel();
    this.renderRightPanel();
    this.updateStatusStrip();
  }

  private renderLeftPanel(): void {
    this.leftContentEl.textContent = '';
    if (this.leftTab === 'map') {
      renderMapDesignerPane(
        this.leftContentEl,
        this.session.getProject(),
        this.session,
        this.atlas,
        this.runtime.getActiveRoomId(),
        this.mapState,
        {
          onStateChange: () => {
            this.syncMapOverlayInteractivity();
            this.renderLeftPanel();
            this.renderMapOverlayNow();
          },
          onSwitchRoom: (roomId) => this.switchActiveRoom(roomId),
          onSelectEntity: (entityId) => {
            this.selectedEntityId = entityId;
            this.renderRightPanel();
          },
          onEnterEditMode: () => {
            if (this.simRunning) this.setSimRunning(false);
          },
          onOpenSpriteAtelierForTile: () => {
            if (this.callbacks.onOpenSpriteAtelierForTile) {
              this.callbacks.onOpenSpriteAtelierForTile(this.mapState.layer);
            } else {
              this.callbacks.onOpenClassicWorkshop();
            }
          },
          onOpenExternalImport: () => this.openExternalImportModal(),
        },
      );
    } else if (this.leftTab === 'hierarchy') {
      this.renderHierarchyPane();
    } else if (this.leftTab === 'prefabs') {
      this.renderPrefabsPane();
    } else {
      this.renderAtlasPane();
    }
  }

  private saveEntityAsPrefabQuick(entityId: string, customName?: string): void {
    const proj = this.session.getProject();
    const ent = proj.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const baseId = `${ent.id.replace(/[^a-zA-Z0-9_-]/g, '_')}_tpl`;
    let pid = baseId;
    let seq = 2;
    while (proj.prefabs[pid]) {
      pid = `${baseId}_${seq++}`;
    }
    const cleanName = customName?.trim() || `${ent.name} 模板`;
    const res = this.session.dispatch({
      type: 'save_entity_as_prefab',
      entityId: ent.id,
      prefabId: pid,
      name: cleanName,
      linkSourceEntity: true,
    });
    if (res.ok && res.createdPrefabId) {
      this.selectedEntityId = ent.id;
      this.selectedPrefabId = null;
      this.renderAllPanels();
    }
  }

  private instantiatePrefabOntoViewport(prefabId: string): void {
    const proj = this.session.getProject();
    const pref = proj.prefabs[prefabId];
    if (!pref) return;
    const count = this.session.getPrefabInstanceCount(prefabId);
    const vw = proj.viewport.width;
    const vh = proj.viewport.height;
    const maxY = proj.rhythmTrack?.enabled ? Math.max(96, proj.rhythmTrack.yTop - 56) : Math.max(120, vh - 64);
    const x = Math.round(140 + ((count * 76) % Math.max(120, vw - 240)));
    const y = Math.round(84 + ((count * 34) % Math.max(48, maxY - 84)));
    const res = this.session.dispatch({
      type: 'instantiate_prefab',
      prefabId,
      x,
      y,
    });
    if (res.ok && res.createdEntityId) {
      this.selectedEntityId = res.createdEntityId;
      this.selectedPrefabId = null;
      this.renderAllPanels();
    }
  }

  private renderPrefabsPane(): void {
    const proj = this.session.getProject();
    const summaries = this.session.listPrefabs();
    const selectedEnt = proj.entities.find((e) => e.id === this.selectedEntityId);

    const saveSec = document.createElement('div');
    saveSec.className = 'p7-section';
    const saveTitle = document.createElement('h3');
    saveTitle.className = 'p7-section-title';
    saveTitle.textContent = '從目前實體建立 Prefab';

    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'p7-input';
    nameInp.placeholder = selectedEnt ? `${selectedEnt.name} 模板` : '請先於階層選取實體';
    nameInp.setAttribute('aria-label', '新 Prefab 模板名稱');

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'p7-btn p7-btn-accent';
    saveBtn.disabled = !selectedEnt;
    saveBtn.textContent = '+ 將目前實體存為 Prefab';
    saveBtn.title = selectedEnt ? `將「${selectedEnt.name}」存為 Prefab` : '請先於階層選取實體';
    saveBtn.addEventListener('click', () => {
      if (!selectedEnt) return;
      this.saveEntityAsPrefabQuick(selectedEnt.id, nameInp.value);
    });
    saveSec.append(saveTitle, nameInp, saveBtn);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'p7-input';
    search.placeholder = '篩選 Prefab 模板...';
    search.value = this.prefabFilterQuery;
    search.setAttribute('aria-label', '篩選 Prefab 模板');
    search.addEventListener('input', () => {
      this.prefabFilterQuery = search.value.trim().toLowerCase();
      this.renderLeftPanel();
    });

    const list = document.createElement('div');
    list.className = 'p7-prefab-list';

    const filtered = summaries.filter((p) => {
      if (!this.prefabFilterQuery) return true;
      return (
        p.name.toLowerCase().includes(this.prefabFilterQuery) ||
        p.id.toLowerCase().includes(this.prefabFilterQuery) ||
        p.category.toLowerCase().includes(this.prefabFilterQuery)
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '尚無符合條件的 Prefab 模板。';
      list.appendChild(empty);
    } else {
      for (const pref of filtered) {
        const card = document.createElement('div');
        card.className = 'p7-prefab-card';
        if (this.selectedPrefabId === pref.id) card.classList.add('is-selected');

        const nm = document.createElement('span');
        nm.className = 'p7-entity-name';
        nm.textContent = pref.name;

        const meta = document.createElement('span');
        meta.className = 'p7-meta-line p7-mono';
        meta.textContent = `${pref.id} · ${pref.instanceCount} 實例 · ${pref.componentKeys.length} 元件`;

        const actions = document.createElement('div');
        actions.className = 'p7-prefab-actions';

        const spawnBtn = document.createElement('button');
        spawnBtn.type = 'button';
        spawnBtn.className = 'p7-btn p7-btn-accent p7-btn-xs';
        spawnBtn.textContent = '+ 生成實例';
        spawnBtn.setAttribute('aria-label', `生成 ${pref.name} 實例`);
        spawnBtn.addEventListener('click', () => this.instantiatePrefabOntoViewport(pref.id));

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = this.selectedPrefabId === pref.id ? 'p7-btn p7-btn-xs p7-btn-accent' : 'p7-btn p7-btn-xs';
        editBtn.textContent = '編輯模板';
        editBtn.setAttribute('aria-label', `編輯 ${pref.name} 模板`);
        editBtn.addEventListener('click', () => {
          this.selectedPrefabId = pref.id;
          this.renderAllPanels();
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
        delBtn.textContent = '刪除';
        delBtn.setAttribute('aria-label', `刪除 ${pref.name} 模板`);
        delBtn.addEventListener('click', () => {
          this.session.dispatch({ type: 'delete_prefab', prefabId: pref.id, mode: 'unlink' });
        });

        actions.append(spawnBtn, editBtn, delBtn);
        card.append(nm, meta, actions);
        list.appendChild(card);
      }
    }

    this.leftContentEl.append(saveSec, search, list);
  }

  private renderHierarchyPane(): void {
    const proj = this.session.getProject();

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'p7-input';
    search.placeholder = '篩選實體或標籤...';
    search.value = this.filterQuery;
    search.addEventListener('input', () => {
      this.filterQuery = search.value.trim().toLowerCase();
      this.renderHierarchyPane();
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'p7-btn';
    addBtn.textContent = proj.prefabs.solar_turret
      ? '+ 新增自律星軌砲塔'
      : proj.prefabs.rift_crystal
        ? '+ 新增星界裂隙結晶'
        : '+ 新增場景實體';
    addBtn.addEventListener('click', () => {
      if (proj.prefabs.solar_turret) {
        this.instantiatePrefabOntoViewport('solar_turret');
        return;
      }
      if (proj.prefabs.rift_crystal) {
        this.instantiatePrefabOntoViewport('rift_crystal');
        return;
      }
      const idx = proj.entities.length + 1;
      const newEnt: EcsEntityInitDef = {
        id: `turret_custom_${idx}`,
        name: `星軌砲塔 #${idx}`,
        components: {
          transform: { x: 180 + ((idx * 53) % 280), y: 112 + ((idx * 29) % 80), w: 34, h: 34, zOrder: 3 },
          sprite: {
            sprite: 'hd_turret_solar',
            tint: '#ffffff',
            castShadow: true,
            metallic: 0.85,
            roughness: 0.18,
            emissive: 0.25,
          },
          light: { radius: 76, color: '#f59e0b', intensity: 0.9 },
          scripts: ['turret_ai'],
          tag: 'turret',
        },
      };
      const res = this.session.dispatch({ type: 'spawn_entity', entity: newEnt });
      if (res.ok) {
        this.selectedEntityId = newEnt.id;
        this.selectedPrefabId = null;
        this.renderAllPanels();
      }
    });

    const list = document.createElement('div');
    list.className = 'p7-entity-list';

    const filtered = proj.entities.filter((e) => {
      if (!this.filterQuery) return true;
      const resolved = resolveEntityComponents(e, proj.prefabs);
      const pid = getEntityPrefabId(e) ?? '';
      return (
        e.name.toLowerCase().includes(this.filterQuery) ||
        e.id.toLowerCase().includes(this.filterQuery) ||
        pid.toLowerCase().includes(this.filterQuery) ||
        (resolved.tag ?? '').toLowerCase().includes(this.filterQuery)
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '目前沒有符合條件的實體，可點擊上方按鈕新增。';
      list.appendChild(empty);
    } else {
      for (const ent of filtered) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'p7-entity-row';
        if (!this.selectedPrefabId && ent.id === this.selectedEntityId) row.classList.add('is-selected');

        const resolved = resolveEntityComponents(ent, proj.prefabs);
        const pid = getEntityPrefabId(ent);

        const nameEl = document.createElement('span');
        nameEl.className = 'p7-entity-name';
        nameEl.textContent = ent.name;

        const meta = document.createElement('span');
        meta.className = 'p7-meta-line p7-mono';
        const compCount = Object.keys(resolved).length;
        meta.textContent = pid
          ? `Prefab:${pid} · ${compCount} 元件`
          : `${resolved.tag || 'entity'} · ${compCount} 元件`;

        row.append(nameEl, meta);
        row.addEventListener('click', () => {
          this.selectedEntityId = ent.id;
          this.selectedPrefabId = null;
          this.renderAllPanels();
        });
        list.appendChild(row);
      }
    }

    this.leftContentEl.append(search, addBtn, list);
  }

  private renderAtlasPane(): void {
    const stats = this.atlas.getAtlasStats();
    const sheets = this.atlas.listSpriteSheets();

    const statSec = document.createElement('div');
    statSec.className = 'p7-section';
    const stTitle = document.createElement('h3');
    stTitle.className = 'p7-section-title';
    stTitle.textContent = '多頁紋理圖集池狀態';

    const kv = document.createElement('div');
    kv.className = 'p7-kv-list p7-mono';
    const rows: [string, string][] = [
      ['啟用頁數', `${stats.pageCount} / ${stats.maxPages} 頁 (${stats.pageSize}px)`],
      ['內建精靈', `${stats.builtinSprites}`],
      ['動態精靈', `${stats.dynamicSprites}`],
      ['精靈表數量', `${stats.spriteSheets}`],
      ['圖集記憶體', `${(stats.totalBytes / (1024 * 1024)).toFixed(1)} MB`],
    ];
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.className = 'p7-kv-row';
      const s1 = document.createElement('span');
      s1.textContent = k;
      const s2 = document.createElement('span');
      s2.textContent = v;
      r.append(s1, s2);
      kv.appendChild(r);
    }
    const openInteropBtn = document.createElement('button');
    openInteropBtn.type = 'button';
    openInteropBtn.className = 'p7-btn p7-btn-accent p7-select-full';
    openInteropBtn.textContent = '匯入 Aseprite / LDtk / Tiled / ZIP';
    openInteropBtn.addEventListener('click', () => this.openExternalImportModal());
    statSec.append(stTitle, kv, openInteropBtn);

    const sliceSec = document.createElement('div');
    sliceSec.className = 'p7-section';
    const slTitle = document.createElement('h3');
    slTitle.className = 'p7-section-title';
    slTitle.textContent = '精靈表切片匯入器';

    const colsInput = document.createElement('input');
    colsInput.type = 'number';
    colsInput.min = '1';
    colsInput.max = '16';
    colsInput.value = '4';
    colsInput.className = 'p7-input p7-mono';

    const rowsInput = document.createElement('input');
    rowsInput.type = 'number';
    rowsInput.min = '1';
    rowsInput.max = '16';
    rowsInput.value = '2';
    rowsInput.className = 'p7-input p7-mono';

    const grid = document.createElement('div');
    grid.className = 'p7-prop-grid';
    const f1 = document.createElement('div');
    f1.className = 'p7-field';
    const l1 = document.createElement('label');
    l1.textContent = '水平欄數 (Cols)';
    f1.append(l1, colsInput);
    const f2 = document.createElement('div');
    f2.className = 'p7-field';
    const l2 = document.createElement('label');
    l2.textContent = '垂直列數 (Rows)';
    f2.append(l2, rowsInput);
    grid.append(f1, f2);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/webp';
    fileInput.className = 'panel-hidden';
    fileInput.setAttribute('aria-label', '選擇本機 PNG 精靈表');
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const cols = Math.max(1, Number(colsInput.value) || 4);
      const rowsVal = Math.max(1, Number(rowsInput.value) || 2);
      void this.importPngSpriteSheet(file, cols, rowsVal);
    });

    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.className = 'p7-btn';
    uploadBtn.textContent = '選擇本機 PNG 精靈表...';
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });

    const sampleBtn = document.createElement('button');
    sampleBtn.type = 'button';
    sampleBtn.className = 'p7-btn p7-btn-accent';
    sampleBtn.textContent = '生成 4×2 星軌精靈表並切片';
    sampleBtn.addEventListener('click', () => {
      this.generateProceduralSampleSheet();
    });

    sliceSec.append(slTitle, grid, fileInput, uploadBtn, sampleBtn);

    const listSec = document.createElement('div');
    listSec.className = 'p7-section';
    const lsTitle = document.createElement('h3');
    lsTitle.className = 'p7-section-title';
    lsTitle.textContent = '已切片精靈表清單';

    if (sheets.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '尚未匯入外部精靈表，可上傳 PNG 或一鍵生成範例精靈表測試多頁圖集池。';
      listSec.append(lsTitle, empty);
    } else {
      listSec.appendChild(lsTitle);
      for (const sh of sheets) {
        const item = document.createElement('div');
        item.className = 'p7-script-item';
        const nm = document.createElement('strong');
        nm.className = 'p7-item-title';
        nm.textContent = sh.sheetId;
        const meta = document.createElement('span');
        meta.className = 'p7-meta-line p7-mono';
        meta.textContent = `${sh.cols}×${sh.rows} 格 · ${sh.frameW}×${sh.frameH}px · 第 ${sh.pageIndex + 1} 頁`;
        item.append(nm, meta);
        listSec.appendChild(item);
      }
    }

    const customSec = document.createElement('div');
    customSec.className = 'p7-section';
    const csHead = document.createElement('div');
    csHead.className = 'p7-section-head';
    const csTitle = document.createElement('h3');
    csTitle.className = 'p7-section-title';
    const customList = Object.values(this.session.getProject().customSprites ?? {});
    csTitle.textContent = `專案自訂像素精靈 (${customList.length})`;
    const csAddBtn = document.createElement('button');
    csAddBtn.type = 'button';
    csAddBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
    csAddBtn.textContent = '+ 畫室繪製';
    csAddBtn.addEventListener('click', () => {
      if (this.callbacks.onOpenSpriteAtelierForTile) {
        this.callbacks.onOpenSpriteAtelierForTile(this.mapState.layer);
      } else {
        this.callbacks.onOpenClassicWorkshop();
      }
    });
    csHead.append(csTitle, csAddBtn);
    customSec.appendChild(csHead);

    if (customList.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '尚未建立專案自訂精靈，可開啟像素畫室一鍵發佈或透過 MCP upsert_custom_sprite 生成。';
      customSec.appendChild(empty);
    } else {
      for (const cs of customList) {
        const row = document.createElement('div');
        row.className = 'p7-custom-sprite-row';
        const thumb = createAtlasThumbCanvas(this.atlas, cs.id, 32);
        const meta = document.createElement('div');
        meta.className = 'p7-custom-sprite-meta';
        const nm = document.createElement('strong');
        nm.className = 'p7-item-title';
        nm.textContent = cs.name || cs.id;
        const sub = document.createElement('span');
        sub.className = 'p7-meta-line p7-mono';
        sub.textContent = `${cs.width}×${cs.height} · ${cs.kind === 'procedural' ? `PBR:${cs.recipe?.pattern ?? 'proc'}` : '像素格'}`;
        meta.append(nm, sub);
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'p7-btn p7-btn-xs';
        delBtn.textContent = '刪';
        delBtn.title = `移除自訂精靈 ${cs.id}`;
        delBtn.addEventListener('click', () => {
          this.session.dispatch({ type: 'remove_custom_sprite', spriteId: cs.id });
        });
        row.append(thumb, meta, delBtn);
        customSec.appendChild(row);
      }
    }

    this.leftContentEl.append(statSec, customSec, sliceSec, listSec);
  }

  private async importPngSpriteSheet(file: File, cols: number, rows: number): Promise<void> {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return;
    }
    ctx.drawImage(bmp, 0, 0);
    const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    const cleanId = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'sheet';
    this.atlas.importSpriteSheet(cleanId, new Uint8Array(imgData.data.buffer), canvas.width, canvas.height, cols, rows);
    this.previewGpu.syncAtlasToGpu();
    this.callbacks.onAtlasMutated();
    this.renderAllPanels();
  }

  private generateProceduralSampleSheet(): void {
    const cols = 4;
    const rows = 2;
    const fw = 32;
    const fh = 32;
    const imgW = cols * fw;
    const imgH = rows * fh;
    const rgba = new Uint8Array(imgW * imgH * 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hueR = r === 0 ? 245 : 56;
        const hueG = r === 0 ? 158 + c * 18 : 189;
        const hueB = r === 0 ? 11 + c * 22 : 248 - c * 18;
        for (let y = 0; y < fh; y++) {
          for (let x = 0; x < fw; x++) {
            const dx = x - fw * 0.5;
            const dy = y - fh * 0.5;
            const dist = Math.hypot(dx, dy);
            const rad = 8 + c * 1.6;
            if (dist <= rad) {
              const dst = ((r * fh + y) * imgW + (c * fw + x)) * 4;
              const edge = dist > rad - 2.5 ? 1.15 : 0.9;
              rgba[dst] = Math.min(255, Math.round(hueR * edge));
              rgba[dst + 1] = Math.min(255, Math.round(hueG * edge));
              rgba[dst + 2] = Math.min(255, Math.round(hueB * edge));
              rgba[dst + 3] = 255;
            }
          }
        }
      }
    }
    const id = `star_crystal_sheet_${this.atlas.listSpriteSheets().length + 1}`;
    this.atlas.importSpriteSheet(id, rgba, imgW, imgH, cols, rows);
    this.previewGpu.syncAtlasToGpu();
    this.callbacks.onAtlasMutated();
    this.renderAllPanels();
  }

  private mutateLiveMaterial(
    entityId: string,
    patch: { metallic?: number; roughness?: number; emissive?: number },
  ): void {
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      if (tagStore.getDenseDataAt(i).entityId === entityId) {
        const h = tagStore.getDenseEntityAt(i);
        const mat = core.getComponent(h, core.components.Material);
        if (mat) {
          if (patch.metallic !== undefined) mat.metallic = patch.metallic;
          if (patch.roughness !== undefined) mat.roughness = patch.roughness;
          if (patch.emissive !== undefined) mat.emissive = patch.emissive;
        }
        break;
      }
    }
    this.renderPreviewNow();
  }

  private mutateLiveLight(
    entityId: string,
    patch: { radius?: number; intensity?: number; color?: string },
  ): void {
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      if (tagStore.getDenseDataAt(i).entityId === entityId) {
        const h = tagStore.getDenseEntityAt(i);
        const ls = core.getComponent(h, core.components.LightSource);
        if (ls) {
          if (patch.radius !== undefined) ls.radius = patch.radius;
          if (patch.intensity !== undefined) ls.intensity = patch.intensity;
          if (patch.color !== undefined) ls.color = patch.color;
        }
        break;
      }
    }
    this.renderPreviewNow();
  }

  private mutateLiveMotor(
    entityId: string,
    patch: { gravity?: number; jumpVelocity?: number; moveSpeed?: number; coyoteTimeSec?: number; floorY?: number },
  ): void {
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      if (tagStore.getDenseDataAt(i).entityId === entityId) {
        const h = tagStore.getDenseEntityAt(i);
        const m = core.getComponent(h, core.components.CharacterMotor2D);
        if (m) {
          if (patch.gravity !== undefined) m.gravity = patch.gravity;
          if (patch.jumpVelocity !== undefined) m.jumpVelocity = patch.jumpVelocity;
          if (patch.moveSpeed !== undefined) m.moveSpeed = patch.moveSpeed;
          if (patch.coyoteTimeSec !== undefined) m.coyoteTimeSec = patch.coyoteTimeSec;
          if (patch.floorY !== undefined) m.floorY = patch.floorY;
        }
        break;
      }
    }
    this.renderPreviewNow();
  }

  private mutateLiveGrapple(
    entityId: string,
    patch: { anchorRadius?: number; swingTension?: number; reelSpeed?: number },
  ): void {
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      if (tagStore.getDenseDataAt(i).entityId === entityId) {
        const h = tagStore.getDenseEntityAt(i);
        const g = core.getComponent(h, core.components.GrappleAnchor);
        if (g) {
          if (patch.anchorRadius !== undefined) g.anchorRadius = patch.anchorRadius;
          if (patch.swingTension !== undefined) g.swingTension = patch.swingTension;
          if (patch.reelSpeed !== undefined) g.reelSpeed = patch.reelSpeed;
        }
        break;
      }
    }
    this.renderPreviewNow();
  }

  private mutateLiveVerlet(
    entityId: string,
    patch: { nodeCount?: number; segmentLength?: number; gravity?: number; damping?: number; color?: string },
  ): void {
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      if (tagStore.getDenseDataAt(i).entityId === entityId) {
        const h = tagStore.getDenseEntityAt(i);
        const vc = core.getComponent(h, core.components.VerletChain);
        if (vc) {
          if (patch.nodeCount !== undefined) {
            vc.nodeCount = Math.max(2, Math.min(16, Math.round(patch.nodeCount)));
            vc.initialized = false;
          }
          if (patch.segmentLength !== undefined) vc.segmentLength = patch.segmentLength;
          if (patch.gravity !== undefined) vc.gravity = patch.gravity;
          if (patch.damping !== undefined) vc.damping = patch.damping;
          if (patch.color !== undefined) vc.color = patch.color;
        }
        break;
      }
    }
    this.renderPreviewNow();
  }

  private mutateLiveSpatial3D(
    entityId: string,
    patch: { z?: number; height?: number; gravityZ?: number; jumpZVelocity?: number; dimensionMask?: number },
  ): void {
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      if (tagStore.getDenseDataAt(i).entityId === entityId) {
        const h = tagStore.getDenseEntityAt(i);
        const sp = core.getComponent(h, core.components.Spatial3D);
        if (sp) {
          if (patch.z !== undefined) {
            sp.z = patch.z;
            sp.prevZ = patch.z;
          }
          if (patch.height !== undefined) sp.height = patch.height;
          if (patch.gravityZ !== undefined) sp.gravityZ = patch.gravityZ;
          if (patch.jumpZVelocity !== undefined) sp.jumpZVelocity = patch.jumpZVelocity;
          if (patch.dimensionMask !== undefined) sp.dimensionMask = patch.dimensionMask;
        }
        break;
      }
    }
    this.renderPreviewNow();
  }

  private createSliderRow(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    fmt: (v: number) => string,
    onLive: (v: number) => void,
    onCommit: (v: number) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'p7-slider-row';

    const head = document.createElement('div');
    head.className = 'p7-slider-head';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const valEl = document.createElement('span');
    valEl.className = 'p7-slider-val p7-mono';
    valEl.textContent = fmt(value);
    head.append(lbl, valEl);

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'p7-range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    range.setAttribute('aria-label', label);
    range.addEventListener('input', () => {
      const n = Number(range.value);
      valEl.textContent = fmt(n);
      onLive(n);
    });
    range.addEventListener('change', () => {
      const n = Number(range.value);
      valEl.textContent = fmt(n);
      onCommit(n);
    });

    row.append(head, range);
    return row;
  }

  private mutateLivePrefabMaterial(
    prefabId: string,
    patch: { metallic?: number; roughness?: number; emissive?: number },
  ): void {
    const proj = this.session.getProject();
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (const e of proj.entities) {
      if (getEntityPrefabId(e) !== prefabId) continue;
      if (e.detachedComponents?.includes('sprite')) continue;
      for (let i = 0; i < tagStore.size(); i++) {
        if (tagStore.getDenseDataAt(i).entityId === e.id) {
          const h = tagStore.getDenseEntityAt(i);
          const mat = core.getComponent(h, core.components.Material);
          if (mat) {
            if (patch.metallic !== undefined && e.overrides?.sprite?.metallic === undefined) {
              mat.metallic = patch.metallic;
            }
            if (patch.roughness !== undefined && e.overrides?.sprite?.roughness === undefined) {
              mat.roughness = patch.roughness;
            }
            if (patch.emissive !== undefined && e.overrides?.sprite?.emissive === undefined) {
              mat.emissive = patch.emissive;
            }
          }
          break;
        }
      }
    }
    this.renderPreviewNow();
  }

  private mutateLivePrefabLight(
    prefabId: string,
    patch: { radius?: number; intensity?: number; color?: string },
  ): void {
    const proj = this.session.getProject();
    const core = this.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    for (const e of proj.entities) {
      if (getEntityPrefabId(e) !== prefabId) continue;
      if (e.detachedComponents?.includes('light')) continue;
      for (let i = 0; i < tagStore.size(); i++) {
        if (tagStore.getDenseDataAt(i).entityId === e.id) {
          const h = tagStore.getDenseEntityAt(i);
          const ls = core.getComponent(h, core.components.LightSource);
          if (ls) {
            if (patch.radius !== undefined && e.overrides?.light?.radius === undefined) ls.radius = patch.radius;
            if (patch.intensity !== undefined && e.overrides?.light?.intensity === undefined) {
              ls.intensity = patch.intensity;
            }
            if (patch.color !== undefined && e.overrides?.light?.color === undefined) ls.color = patch.color;
          }
          break;
        }
      }
    }
    this.renderPreviewNow();
  }

  private renderPrefabInspector(proj: EcsProjectV2, prefab: EcsPrefabDef): void {
    this.rightTitleEl.textContent = `Prefab 模板：${prefab.name}`;
    const instCount = this.session.getPrefabInstanceCount(prefab.id);

    // Header Section
    const headSec = document.createElement('div');
    headSec.className = 'p7-section';

    const topRow = document.createElement('div');
    topRow.className = 'p7-section-head';
    const titleEl = document.createElement('h3');
    titleEl.className = 'p7-section-title';
    titleEl.textContent = `模板 ID：${prefab.id}`;
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'p7-btn p7-btn-xs';
    backBtn.textContent = '返回實體';
    backBtn.addEventListener('click', () => {
      this.selectedPrefabId = null;
      this.renderAllPanels();
    });
    topRow.append(titleEl, backBtn);

    const syncMeta = document.createElement('div');
    syncMeta.className = 'p7-meta-line p7-mono';
    syncMeta.textContent = `同步連結 ${instCount} 個實例 · 修改模板屬性將自動傳播至所有未覆寫實例`;

    const nameField = document.createElement('div');
    nameField.className = 'p7-field';
    const nameLbl = document.createElement('label');
    nameLbl.textContent = '模板顯示名稱';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.className = 'p7-input';
    nameInp.value = prefab.name;
    nameInp.setAttribute('aria-label', '模板顯示名稱');
    nameInp.addEventListener('change', () => {
      if (nameInp.value.trim()) {
        this.session.dispatch({ type: 'update_prefab', prefabId: prefab.id, name: nameInp.value.trim() });
      }
    });
    nameField.append(nameLbl, nameInp);

    const actRow = document.createElement('div');
    actRow.className = 'p7-prefab-actions';
    const spawnBtn = document.createElement('button');
    spawnBtn.type = 'button';
    spawnBtn.className = 'p7-btn p7-btn-accent';
    spawnBtn.textContent = '+ 立即生成實例';
    spawnBtn.addEventListener('click', () => this.instantiatePrefabOntoViewport(prefab.id));
    actRow.appendChild(spawnBtn);

    headSec.append(topRow, syncMeta, nameField, actRow);

    // Component Attach / Detach on Prefab
    const compSec = document.createElement('div');
    compSec.className = 'p7-section';
    const compTitle = document.createElement('h3');
    compTitle.className = 'p7-section-title';
    compTitle.textContent = '模板元件插槽';
    const compList = document.createElement('div');
    compList.className = 'p7-comp-list';

    const compRec = prefab.components as unknown as Record<string, unknown>;
    const unmounted: typeof COMPONENT_CATALOG = [];
    for (const def of COMPONENT_CATALOG) {
      if (compRec[def.key] !== undefined) {
        const row = document.createElement('div');
        row.className = 'p7-comp-row';
        const nm = document.createElement('span');
        nm.className = 'p7-comp-name';
        nm.textContent = def.label;
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
        rmBtn.textContent = '移除';
        rmBtn.addEventListener('click', () => {
          this.session.dispatch({ type: 'update_prefab', prefabId: prefab.id, detachComponent: def.key });
        });
        row.append(nm, rmBtn);
        compList.appendChild(row);
      } else {
        unmounted.push(def);
      }
    }
    compSec.append(compTitle, compList);
    if (unmounted.length > 0) {
      const attachBar = document.createElement('div');
      attachBar.className = 'p7-attach-bar';
      const sel = document.createElement('select');
      sel.className = 'p7-select';
      sel.setAttribute('aria-label', '選擇要掛載至模板的元件');
      for (const def of unmounted) {
        const opt = document.createElement('option');
        opt.value = def.key;
        opt.textContent = def.label;
        sel.appendChild(opt);
      }
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'p7-btn p7-btn-accent';
      addBtn.textContent = '+ 掛載至模板';
      addBtn.addEventListener('click', () => {
        const chosen = unmounted.find((u) => u.key === sel.value) ?? unmounted[0];
        if (!chosen) return;
        this.session.dispatch({
          type: 'update_prefab',
          prefabId: prefab.id,
          attachComponent: { component: chosen.key, value: chosen.createDefault() },
        });
      });
      attachBar.append(sel, addBtn);
      compSec.appendChild(attachBar);
    }

    const sections: HTMLElement[] = [headSec, compSec];

    // Prefab PBR Material Inspector (propagates live to all linked clones!)
    if (prefab.components.sprite) {
      const sp = prefab.components.sprite;
      const matSec = document.createElement('div');
      matSec.className = 'p7-section';
      const matTitle = document.createElement('h3');
      matTitle.className = 'p7-section-title';
      matTitle.textContent = '模板 PBR 材質（同步傳播）';

      const sprField = document.createElement('div');
      sprField.className = 'p7-field';
      const sprLbl = document.createElement('label');
      sprLbl.textContent = '模板精靈資產';
      const sprSel = document.createElement('select');
      sprSel.className = 'p7-select p7-mono';
      sprSel.setAttribute('aria-label', '模板精靈紋理選擇');
      const seen = new Set<string>();
      for (const cs of Object.values(proj.customSprites ?? {})) {
        seen.add(cs.id);
        const o = document.createElement('option');
        o.value = cs.id;
        o.textContent = `[自訂] ${cs.name || cs.id} (${cs.width}×${cs.height})`;
        sprSel.appendChild(o);
      }
      for (const opt of HD_SPRITE_OPTIONS) {
        if (seen.has(opt.id)) continue;
        seen.add(opt.id);
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label;
        sprSel.appendChild(o);
      }
      if (!seen.has(sp.sprite)) {
        const o = document.createElement('option');
        o.value = sp.sprite;
        o.textContent = sp.sprite;
        sprSel.appendChild(o);
      }
      sprSel.value = sp.sprite;
      sprSel.addEventListener('change', () => {
        this.session.dispatch({
          type: 'update_prefab',
          prefabId: prefab.id,
          patch: { sprite: { sprite: sprSel.value as SpriteId } },
        });
      });
      sprField.append(sprLbl, sprSel);

      const sliders = document.createElement('div');
      sliders.className = 'p7-slider-group';
      sliders.append(
        this.createSliderRow(
          '模板金屬度 Metallic',
          0,
          1,
          0.05,
          sp.metallic ?? 0.25,
          (v) => v.toFixed(2),
          (v) => this.mutateLivePrefabMaterial(prefab.id, { metallic: v }),
          (v) => this.session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { sprite: { metallic: v } } }),
        ),
        this.createSliderRow(
          '模板粗糙度 Roughness',
          0.05,
          1,
          0.05,
          sp.roughness ?? 0.42,
          (v) => v.toFixed(2),
          (v) => this.mutateLivePrefabMaterial(prefab.id, { roughness: v }),
          (v) => this.session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { sprite: { roughness: v } } }),
        ),
        this.createSliderRow(
          '模板自發光 Emissive',
          0,
          1.5,
          0.05,
          sp.emissive ?? 0,
          (v) => v.toFixed(2),
          (v) => this.mutateLivePrefabMaterial(prefab.id, { emissive: v }),
          (v) => this.session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { sprite: { emissive: v } } }),
        ),
      );
      matSec.append(matTitle, sprField, sliders);
      sections.push(matSec);
    }

    // Prefab Light Inspector
    if (prefab.components.light) {
      const lt = prefab.components.light;
      const lightSec = document.createElement('div');
      lightSec.className = 'p7-section';
      const lightTitle = document.createElement('h3');
      lightTitle.className = 'p7-section-title';
      lightTitle.textContent = '模板動態光源（同步傳播）';

      const colRow = document.createElement('div');
      colRow.className = 'p7-color-row';
      const colLbl = document.createElement('span');
      colLbl.textContent = '模板光色 Color';
      const colRight = document.createElement('div');
      colRight.className = 'p7-toolbar-group';
      const colHexText = document.createElement('span');
      colHexText.className = 'p7-mono p7-slider-val';
      colHexText.textContent = lt.color.toUpperCase();
      const colInput = document.createElement('input');
      colInput.type = 'color';
      colInput.className = 'p7-color-input';
      colInput.value = lt.color;
      colInput.setAttribute('aria-label', '模板光源顏色');
      colInput.addEventListener('input', () => {
        colHexText.textContent = colInput.value.toUpperCase();
        this.mutateLivePrefabLight(prefab.id, { color: colInput.value });
      });
      colInput.addEventListener('change', () => {
        this.session.dispatch({
          type: 'update_prefab',
          prefabId: prefab.id,
          patch: { light: { color: colInput.value } },
        });
      });
      colRight.append(colHexText, colInput);
      colRow.append(colLbl, colRight);

      const lightSliders = document.createElement('div');
      lightSliders.className = 'p7-slider-group';
      lightSliders.append(
        this.createSliderRow(
          '模板照射半徑 Radius',
          16,
          180,
          4,
          lt.radius,
          (v) => `${Math.round(v)}px`,
          (v) => this.mutateLivePrefabLight(prefab.id, { radius: v }),
          (v) => this.session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { light: { radius: v } } }),
        ),
        this.createSliderRow(
          '模板光照強度 Intensity',
          0.1,
          2.0,
          0.05,
          lt.intensity ?? 0.9,
          (v) => v.toFixed(2),
          (v) => this.mutateLivePrefabLight(prefab.id, { intensity: v }),
          (v) => this.session.dispatch({ type: 'update_prefab', prefabId: prefab.id, patch: { light: { intensity: v } } }),
        ),
      );
      lightSec.append(lightTitle, colRow, lightSliders);
      sections.push(lightSec);
    }

    // Linked Instances List
    const linked = proj.entities.filter((e) => getEntityPrefabId(e) === prefab.id);
    const linkSec = document.createElement('div');
    linkSec.className = 'p7-section';
    const linkTitle = document.createElement('h3');
    linkTitle.className = 'p7-section-title';
    linkTitle.textContent = `已連結實例清單 (${linked.length})`;
    linkSec.appendChild(linkTitle);
    if (linked.length === 0) {
      const note = document.createElement('p');
      note.className = 'p7-empty-note';
      note.textContent = '目前尚無場景實例連結至此模板，可點擊上方「+ 立即生成實例」。';
      linkSec.appendChild(note);
    } else {
      for (const inst of linked) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'p7-entity-row';
        const nm = document.createElement('span');
        nm.className = 'p7-entity-name';
        nm.textContent = inst.name;
        const meta = document.createElement('span');
        meta.className = 'p7-meta-line p7-mono';
        const ov = countEntityOverrides(inst);
        meta.textContent = `${inst.id} · ${ov} 項覆寫`;
        btn.append(nm, meta);
        btn.addEventListener('click', () => {
          this.selectedEntityId = inst.id;
          this.selectedPrefabId = null;
          this.renderAllPanels();
        });
        linkSec.appendChild(btn);
      }
    }
    sections.push(linkSec);

    this.rightContentEl.append(...sections);
  }

  private renderRightPanel(): void {
    this.rightContentEl.textContent = '';
    const proj = this.session.getProject();

    if (this.lastDiagReport) {
      const diagBox = document.createElement('div');
      diagBox.className = 'p7-diag-box p7-mono';
      const head = document.createElement('div');
      head.className = this.lastDiagReport.ok ? 'p7-diag-ok' : 'p7-diag-warn';
      head.textContent = this.lastDiagReport.headline;
      diagBox.appendChild(head);
      for (const line of this.lastDiagReport.lines) {
        const row = document.createElement('div');
        row.className = 'p7-meta-line';
        row.textContent = line;
        diagBox.appendChild(row);
      }
      this.rightContentEl.appendChild(diagBox);
    }

    if (this.selectedPrefabId && proj.prefabs[this.selectedPrefabId]) {
      this.renderPrefabInspector(proj, proj.prefabs[this.selectedPrefabId]);
      return;
    }

    this.rightTitleEl.textContent = 'ECS 元件檢查器與沙盒腳本';
    const ent = proj.entities.find((e) => e.id === this.selectedEntityId);
    if (!ent) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '請從左側階層樹選取任一實體以檢視或編輯其 ECS 元件與 PBR 材質。';
      this.rightContentEl.appendChild(empty);
      return;
    }

    const resolved = resolveEntityComponents(ent, proj.prefabs);
    const linkedPrefabId = getEntityPrefabId(ent);
    const linkedPrefab = linkedPrefabId ? proj.prefabs[linkedPrefabId] : undefined;
    const overrideCount = linkedPrefab ? countEntityOverrides(ent) : 0;

    // Section 1: Transform & Entity Header
    const trSec = document.createElement('div');
    trSec.className = 'p7-section';
    const trHead = document.createElement('div');
    trHead.className = 'p7-section-head';
    const trTitle = document.createElement('h3');
    trTitle.className = 'p7-section-title';
    trTitle.textContent = `實體：${ent.name}`;
    trTitle.title = ent.name;

    const headBtns = document.createElement('div');
    headBtns.className = 'p7-head-actions';

    const savePrefBtn = document.createElement('button');
    savePrefBtn.type = 'button';
    savePrefBtn.className = 'p7-btn p7-btn-xs';
    savePrefBtn.textContent = '存為 Prefab';
    savePrefBtn.addEventListener('click', () => {
      this.saveEntityAsPrefabQuick(ent.id);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
    delBtn.textContent = '刪除實體';
    delBtn.addEventListener('click', () => {
      this.session.dispatch({ type: 'remove_entity', entityId: ent.id });
    });
    headBtns.append(savePrefBtn, delBtn);
    trHead.append(trTitle, headBtns);

    if (linkedPrefab) {
      const linkBar = document.createElement('div');
      linkBar.className = 'p7-prefab-link-bar';
      const linkInfo = document.createElement('span');
      linkInfo.className = 'p7-meta-line p7-mono';
      linkInfo.textContent = `繼承模板：${linkedPrefab.name} (${linkedPrefab.id}) · ${overrideCount} 項覆寫`;

      const linkActs = document.createElement('div');
      linkActs.className = 'p7-prefab-actions';

      const editTplBtn = document.createElement('button');
      editTplBtn.type = 'button';
      editTplBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
      editTplBtn.textContent = '編輯模板';
      editTplBtn.addEventListener('click', () => {
        this.selectedPrefabId = linkedPrefab.id;
        this.renderAllPanels();
      });

      const revertBtn = document.createElement('button');
      revertBtn.type = 'button';
      revertBtn.className = 'p7-btn p7-btn-xs';
      revertBtn.textContent = '重置覆寫';
      revertBtn.disabled = overrideCount === 0;
      revertBtn.addEventListener('click', () => {
        this.session.dispatch({ type: 'revert_prefab_overrides', entityId: ent.id, keepPosition: true });
      });

      const unlinkBtn = document.createElement('button');
      unlinkBtn.type = 'button';
      unlinkBtn.className = 'p7-btn p7-btn-xs';
      unlinkBtn.textContent = '斷開連結';
      unlinkBtn.addEventListener('click', () => {
        this.session.dispatch({ type: 'unlink_prefab', entityId: ent.id });
      });

      linkActs.append(editTplBtn, revertBtn, unlinkBtn);
      linkBar.append(linkInfo, linkActs);
      trSec.append(trHead, linkBar);
    } else {
      trSec.append(trHead);
    }

    const grid = document.createElement('div');
    grid.className = 'p7-prop-grid';
    const tr = resolved.transform;

    const addNumField = (label: string, val: number, onCommit: (n: number) => void) => {
      const wrap = document.createElement('div');
      wrap.className = 'p7-field';
      const lbl = document.createElement('label');
      lbl.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'p7-input p7-mono';
      inp.value = String(Math.round(val));
      inp.addEventListener('change', () => {
        const parsed = Number(inp.value);
        if (Number.isFinite(parsed)) onCommit(parsed);
      });
      wrap.append(lbl, inp);
      grid.appendChild(wrap);
    };

    const commitTransform = (partial: Partial<typeof tr>) => {
      this.session.dispatch({ type: 'patch_entity', entityId: ent.id, patch: { transform: partial } });
    };

    addNumField('X 座標', tr.x, (x) => commitTransform({ x }));
    addNumField('Y 座標', tr.y, (y) => commitTransform({ y }));
    addNumField('寬度 W', tr.w ?? 16, (w) => commitTransform({ w }));
    addNumField('高度 H', tr.h ?? 16, (h) => commitTransform({ h }));

    trSec.append(grid);

    // Section 2: Dynamic ECS Component Attach / Detach Manager
    const compSec = document.createElement('div');
    compSec.className = 'p7-section';
    const compHead = document.createElement('div');
    compHead.className = 'p7-section-head';
    const compTitle = document.createElement('h3');
    compTitle.className = 'p7-section-title';
    compTitle.textContent = 'ECS 元件插槽';
    const pipeNote = document.createElement('span');
    pipeNote.className = 'p7-meta-line p7-mono';
    pipeNote.textContent = `5 階段 · ${this.runtime.world.getSystemPipeline().length} 系統`;
    compHead.append(compTitle, pipeNote);

    const compList = document.createElement('div');
    compList.className = 'p7-comp-list';

    const coreRow = document.createElement('div');
    coreRow.className = 'p7-comp-row';
    const coreNm = document.createElement('span');
    coreNm.className = 'p7-comp-name p7-mono';
    coreNm.textContent = 'Transform2D';
    const coreMeta = document.createElement('span');
    coreMeta.className = 'p7-comp-meta p7-mono';
    coreMeta.textContent = '核心必要';
    coreRow.append(coreNm, coreMeta);
    compList.appendChild(coreRow);

    const compRecord = resolved as unknown as Record<string, unknown>;
    const overrideRecord = (ent.overrides ?? {}) as Record<string, unknown>;
    const unmounted: typeof COMPONENT_CATALOG = [];
    for (const def of COMPONENT_CATALOG) {
      if (compRecord[def.key] !== undefined) {
        const row = document.createElement('div');
        row.className = 'p7-comp-row';
        const nm = document.createElement('span');
        nm.className = 'p7-comp-name';
        nm.textContent = def.label;
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'p7-btn p7-btn-danger p7-btn-xs';
        rmBtn.textContent = '移除';
        rmBtn.dataset.detachComponent = def.key;
        rmBtn.addEventListener('click', () => {
          this.session.dispatch({ type: 'detach_component', entityId: ent.id, component: def.key });
        });
        if (linkedPrefab && overrideRecord[def.key] !== undefined) {
          const ovMark = document.createElement('span');
          ovMark.className = 'p7-override-mark p7-mono';
          ovMark.textContent = '已覆寫';
          row.append(nm, ovMark, rmBtn);
        } else {
          row.append(nm, rmBtn);
        }
        compList.appendChild(row);
      } else {
        unmounted.push(def);
      }
    }

    compSec.append(compHead, compList);

    if (unmounted.length > 0) {
      const attachBar = document.createElement('div');
      attachBar.className = 'p7-attach-bar';
      const sel = document.createElement('select');
      sel.className = 'p7-select';
      sel.setAttribute('aria-label', '選擇要掛載的 ECS 元件');
      for (const def of unmounted) {
        const opt = document.createElement('option');
        opt.value = def.key;
        opt.textContent = def.label;
        sel.appendChild(opt);
      }
      const addCompBtn = document.createElement('button');
      addCompBtn.type = 'button';
      addCompBtn.className = 'p7-btn p7-btn-accent';
      addCompBtn.textContent = '+ 掛載元件';
      addCompBtn.addEventListener('click', () => {
        const chosen = unmounted.find((u) => u.key === sel.value) ?? unmounted[0];
        if (!chosen) return;
        this.session.dispatch({
          type: 'attach_component',
          entityId: ent.id,
          component: chosen.key,
          value: chosen.createDefault(),
        });
      });
      attachBar.append(sel, addCompBtn);
      compSec.appendChild(attachBar);
    }

    const sections: HTMLElement[] = [trSec, compSec];

    // Section 3: Live GPU PBR Material Inspector (when Sprite/Material mounted)
    if (resolved.sprite) {
      const sp = resolved.sprite;
      const matSec = document.createElement('div');
      matSec.className = 'p7-section';
      const matTitle = document.createElement('h3');
      matTitle.className = 'p7-section-title';
      matTitle.textContent = 'PBR 材質與精靈圖集';

      const sprField = document.createElement('div');
      sprField.className = 'p7-field';
      const sprLbl = document.createElement('label');
      sprLbl.textContent = '高解析精靈資產 (Multi-Page Atlas)';
      const sprSel = document.createElement('select');
      sprSel.className = 'p7-select p7-mono';
      sprSel.setAttribute('aria-label', '精靈紋理選擇');

      const seen = new Set<string>();
      for (const cs of Object.values(proj.customSprites ?? {})) {
        seen.add(cs.id);
        const o = document.createElement('option');
        o.value = cs.id;
        o.textContent = `[自訂] ${cs.name || cs.id} (${cs.width}×${cs.height})`;
        sprSel.appendChild(o);
      }
      for (const opt of HD_SPRITE_OPTIONS) {
        if (seen.has(opt.id)) continue;
        seen.add(opt.id);
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label;
        sprSel.appendChild(o);
      }
      for (const sheet of this.atlas.listSpriteSheets()) {
        for (const fid of sheet.frameIds.slice(0, 8)) {
          if (seen.has(fid)) continue;
          seen.add(fid);
          const o = document.createElement('option');
          o.value = fid;
          o.textContent = `${fid} (P${sheet.pageIndex + 1})`;
          sprSel.appendChild(o);
        }
      }
      if (!seen.has(sp.sprite)) {
        const o = document.createElement('option');
        o.value = sp.sprite;
        o.textContent = sp.sprite;
        sprSel.appendChild(o);
      }
      const commitSprite = (partial: Partial<typeof sp>) => {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: ent.id,
          patch: { sprite: partial },
        });
      };

      sprSel.value = sp.sprite;
      sprSel.addEventListener('change', () => {
        commitSprite({ sprite: sprSel.value as SpriteId });
      });
      sprField.append(sprLbl, sprSel);

      const sliders = document.createElement('div');
      sliders.className = 'p7-slider-group';

      sliders.append(
        this.createSliderRow(
          '金屬度 Metallic',
          0,
          1,
          0.05,
          sp.metallic ?? 0.25,
          (v) => v.toFixed(2),
          (v) => this.mutateLiveMaterial(ent.id, { metallic: v }),
          (v) => commitSprite({ metallic: v }),
        ),
        this.createSliderRow(
          '粗糙度 Roughness',
          0.05,
          1,
          0.05,
          sp.roughness ?? 0.42,
          (v) => v.toFixed(2),
          (v) => this.mutateLiveMaterial(ent.id, { roughness: v }),
          (v) => commitSprite({ roughness: v }),
        ),
        this.createSliderRow(
          '自發光 Emissive',
          0,
          1.5,
          0.05,
          sp.emissive ?? 0,
          (v) => v.toFixed(2),
          (v) => this.mutateLiveMaterial(ent.id, { emissive: v }),
          (v) => commitSprite({ emissive: v }),
        ),
      );

      matSec.append(matTitle, sprField, sliders);
      sections.push(matSec);
    }

    // Section 4: Live Dynamic Light Controls (when LightSource mounted)
    if (resolved.light) {
      const lt = resolved.light;
      const lightSec = document.createElement('div');
      lightSec.className = 'p7-section';
      const lightTitle = document.createElement('h3');
      lightTitle.className = 'p7-section-title';
      lightTitle.textContent = '動態點光源 LightSource';

      const colRow = document.createElement('div');
      colRow.className = 'p7-color-row';
      const colLbl = document.createElement('span');
      colLbl.textContent = '光色 Color';
      const colRight = document.createElement('div');
      colRight.className = 'p7-toolbar-group';
      const colHexText = document.createElement('span');
      colHexText.className = 'p7-mono p7-slider-val';
      colHexText.textContent = lt.color.toUpperCase();
      const colInput = document.createElement('input');
      colInput.type = 'color';
      colInput.className = 'p7-color-input';
      colInput.value = lt.color;
      colInput.setAttribute('aria-label', '光源顏色');
      colInput.addEventListener('input', () => {
        colHexText.textContent = colInput.value.toUpperCase();
        this.mutateLiveLight(ent.id, { color: colInput.value });
      });
      const commitLight = (partial: Partial<typeof lt>) => {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: ent.id,
          patch: { light: partial },
        });
      };

      colInput.addEventListener('change', () => {
        commitLight({ color: colInput.value });
      });
      colRight.append(colHexText, colInput);
      colRow.append(colLbl, colRight);

      const lightSliders = document.createElement('div');
      lightSliders.className = 'p7-slider-group';
      lightSliders.append(
        this.createSliderRow(
          '照射半徑 Radius',
          16,
          180,
          4,
          lt.radius,
          (v) => `${Math.round(v)}px`,
          (v) => this.mutateLiveLight(ent.id, { radius: v }),
          (v) => commitLight({ radius: v }),
        ),
        this.createSliderRow(
          '光照強度 Intensity',
          0.1,
          2.0,
          0.05,
          lt.intensity ?? 0.9,
          (v) => v.toFixed(2),
          (v) => this.mutateLiveLight(ent.id, { intensity: v }),
          (v) => commitLight({ intensity: v }),
        ),
      );

      lightSec.append(lightTitle, colRow, lightSliders);
      sections.push(lightSec);
    }

    // Section 4b: Live CharacterMotor2D Action Physics Inspector
    if (resolved.characterMotor2d) {
      const m = resolved.characterMotor2d;
      const motorSec = document.createElement('div');
      motorSec.className = 'p7-section';
      const motorTitle = document.createElement('h3');
      motorTitle.className = 'p7-section-title';
      motorTitle.textContent = 'CharacterMotor2D 動作馬達';

      const commitMotor = (partial: Partial<typeof m>) => {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: ent.id,
          patch: { characterMotor2d: partial },
        });
      };

      const motorSliders = document.createElement('div');
      motorSliders.className = 'p7-slider-group';
      motorSliders.append(
        this.createSliderRow(
          '重力 Gravity',
          100,
          1600,
          20,
          m.gravity ?? 720,
          (v) => `${Math.round(v)} px/s²`,
          (v) => this.mutateLiveMotor(ent.id, { gravity: v }),
          (v) => commitMotor({ gravity: v }),
        ),
        this.createSliderRow(
          '跳躍初速 Jump',
          120,
          560,
          10,
          m.jumpVelocity ?? 290,
          (v) => `${Math.round(v)} px/s`,
          (v) => this.mutateLiveMotor(ent.id, { jumpVelocity: v }),
          (v) => commitMotor({ jumpVelocity: v }),
        ),
        this.createSliderRow(
          '移動速度 Speed',
          40,
          360,
          10,
          m.moveSpeed ?? 150,
          (v) => `${Math.round(v)} px/s`,
          (v) => this.mutateLiveMotor(ent.id, { moveSpeed: v }),
          (v) => commitMotor({ moveSpeed: v }),
        ),
        this.createSliderRow(
          '土狼時間 Coyote',
          0,
          0.3,
          0.02,
          m.coyoteTimeSec ?? 0.12,
          (v) => `${v.toFixed(2)}s`,
          (v) => this.mutateLiveMotor(ent.id, { coyoteTimeSec: v }),
          (v) => commitMotor({ coyoteTimeSec: v }),
        ),
        this.createSliderRow(
          '地面高度 Floor Y',
          0,
          360,
          4,
          m.floorY ?? 224,
          (v) => (v <= 0 ? '視口底部' : `${Math.round(v)}px`),
          (v) => this.mutateLiveMotor(ent.id, { floorY: v }),
          (v) => commitMotor({ floorY: v }),
        ),
      );
      motorSec.append(motorTitle, motorSliders);
      sections.push(motorSec);
    }

    // Section 4c: Live GrappleAnchor Inspector
    if (resolved.grappleAnchor) {
      const g = resolved.grappleAnchor;
      const grapSec = document.createElement('div');
      grapSec.className = 'p7-section';
      const grapTitle = document.createElement('h3');
      grapTitle.className = 'p7-section-title';
      grapTitle.textContent = 'GrappleAnchor 鉤索錨點';

      const commitGrapple = (partial: Partial<typeof g>) => {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: ent.id,
          patch: { grappleAnchor: partial },
        });
      };

      const grapSliders = document.createElement('div');
      grapSliders.className = 'p7-slider-group';
      grapSliders.append(
        this.createSliderRow(
          '捕獲半徑 Radius',
          40,
          280,
          10,
          g.anchorRadius ?? 150,
          (v) => `${Math.round(v)}px`,
          (v) => this.mutateLiveGrapple(ent.id, { anchorRadius: v }),
          (v) => commitGrapple({ anchorRadius: v }),
        ),
        this.createSliderRow(
          '擺盪張力 Tension',
          0.8,
          1.0,
          0.01,
          g.swingTension ?? 0.98,
          (v) => v.toFixed(2),
          (v) => this.mutateLiveGrapple(ent.id, { swingTension: v }),
          (v) => commitGrapple({ swingTension: v }),
        ),
        this.createSliderRow(
          '捲繩速度 Reel',
          20,
          240,
          8,
          g.reelSpeed ?? 96,
          (v) => `${Math.round(v)} px/s`,
          (v) => this.mutateLiveGrapple(ent.id, { reelSpeed: v }),
          (v) => commitGrapple({ reelSpeed: v }),
        ),
      );
      grapSec.append(grapTitle, grapSliders);
      sections.push(grapSec);
    }

    // Section 4d: Live TriggerZone Sensor Inspector
    if (resolved.triggerZone) {
      const tz = resolved.triggerZone;
      const tzSec = document.createElement('div');
      tzSec.className = 'p7-section';
      const tzTitle = document.createElement('h3');
      tzTitle.className = 'p7-section-title';
      tzTitle.textContent = 'TriggerZone 互動感測區';

      const commitZone = (partial: Partial<typeof tz>) => {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: ent.id,
          patch: { triggerZone: partial },
        });
      };

      const tzGrid = document.createElement('div');
      tzGrid.className = 'p7-prop-grid';

      const shapeWrap = document.createElement('div');
      shapeWrap.className = 'p7-field';
      const shapeLbl = document.createElement('label');
      shapeLbl.textContent = '感測形狀 Shape';
      const shapeSel = document.createElement('select');
      shapeSel.className = 'p7-select p7-mono';
      shapeSel.setAttribute('aria-label', '感測區形狀');
      for (const sh of ['circle', 'rect'] as const) {
        const o = document.createElement('option');
        o.value = sh;
        o.textContent = sh === 'circle' ? '圓形 Circle' : '矩形 Rect';
        shapeSel.appendChild(o);
      }
      shapeSel.value = tz.shape ?? 'circle';
      shapeSel.addEventListener('change', () => commitZone({ shape: shapeSel.value as 'circle' | 'rect' }));
      shapeWrap.append(shapeLbl, shapeSel);

      const tagWrap = document.createElement('div');
      tagWrap.className = 'p7-field';
      const tagLbl = document.createElement('label');
      tagLbl.textContent = '目標標籤 Filter Tag';
      const tagInp = document.createElement('input');
      tagInp.type = 'text';
      tagInp.className = 'p7-input p7-mono';
      tagInp.placeholder = '留空偵測全部';
      tagInp.value = tz.filterTag ?? '';
      tagInp.addEventListener('change', () => commitZone({ filterTag: tagInp.value.trim() }));
      tagWrap.append(tagLbl, tagInp);

      const enterWrap = document.createElement('div');
      enterWrap.className = 'p7-field';
      const enterLbl = document.createElement('label');
      enterLbl.textContent = '進入事件 Enter';
      const enterInp = document.createElement('input');
      enterInp.type = 'text';
      enterInp.className = 'p7-input p7-mono';
      enterInp.value = tz.onEnterEvent ?? 'zone_enter';
      enterInp.addEventListener('change', () => commitZone({ onEnterEvent: enterInp.value.trim() }));
      enterWrap.append(enterLbl, enterInp);

      const exitWrap = document.createElement('div');
      exitWrap.className = 'p7-field';
      const exitLbl = document.createElement('label');
      exitLbl.textContent = '離開事件 Exit';
      const exitInp = document.createElement('input');
      exitInp.type = 'text';
      exitInp.className = 'p7-input p7-mono';
      exitInp.value = tz.onExitEvent ?? 'zone_exit';
      exitInp.addEventListener('change', () => commitZone({ onExitEvent: exitInp.value.trim() }));
      exitWrap.append(exitLbl, exitInp);

      tzGrid.append(shapeWrap, tagWrap, enterWrap, exitWrap);

      const radSlider = this.createSliderRow(
        '感測半徑 Radius',
        12,
        140,
        4,
        tz.radius ?? 36,
        (v) => `${Math.round(v)}px`,
        () => {},
        (v) => commitZone({ radius: v }),
      );

      const oneShotBtn = document.createElement('button');
      oneShotBtn.type = 'button';
      oneShotBtn.className = tz.oneShot ? 'p7-btn p7-btn-accent' : 'p7-btn';
      oneShotBtn.textContent = tz.oneShot ? '單次觸發 One-Shot：開啟' : '單次觸發 One-Shot：關閉';
      oneShotBtn.addEventListener('click', () => commitZone({ oneShot: !tz.oneShot }));

      tzSec.append(tzTitle, tzGrid, radSlider, oneShotBtn);
      sections.push(tzSec);
    }

    // Section 4e: Live VerletChain Rope/Cape Inspector
    if (resolved.verletChain) {
      const vc = resolved.verletChain;
      const vcSec = document.createElement('div');
      vcSec.className = 'p7-section';
      const vcTitle = document.createElement('h3');
      vcTitle.className = 'p7-section-title';
      vcTitle.textContent = 'VerletChain 柔體鍊條';

      const commitVerlet = (partial: Partial<typeof vc>) => {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: ent.id,
          patch: { verletChain: partial },
        });
      };

      const vcColRow = document.createElement('div');
      vcColRow.className = 'p7-color-row';
      const vcColLbl = document.createElement('span');
      vcColLbl.textContent = '鍊條色 Color';
      const vcColRight = document.createElement('div');
      vcColRight.className = 'p7-toolbar-group';
      const vcHex = document.createElement('span');
      vcHex.className = 'p7-mono p7-slider-val';
      vcHex.textContent = (vc.color ?? '#f59e0b').toUpperCase();
      const vcColInp = document.createElement('input');
      vcColInp.type = 'color';
      vcColInp.className = 'p7-color-input';
      vcColInp.value = vc.color ?? '#f59e0b';
      vcColInp.setAttribute('aria-label', '鍊條顏色');
      vcColInp.addEventListener('input', () => {
        vcHex.textContent = vcColInp.value.toUpperCase();
        this.mutateLiveVerlet(ent.id, { color: vcColInp.value });
      });
      vcColInp.addEventListener('change', () => commitVerlet({ color: vcColInp.value }));
      vcColRight.append(vcHex, vcColInp);
      vcColRow.append(vcColLbl, vcColRight);

      const vcSliders = document.createElement('div');
      vcSliders.className = 'p7-slider-group';
      vcSliders.append(
        this.createSliderRow(
          '節點數量 Nodes',
          2,
          16,
          1,
          vc.nodeCount ?? 6,
          (v) => `${Math.round(v)} 節`,
          (v) => this.mutateLiveVerlet(ent.id, { nodeCount: v }),
          (v) => commitVerlet({ nodeCount: v }),
        ),
        this.createSliderRow(
          '節段長度 Segment',
          4,
          28,
          1,
          vc.segmentLength ?? 10,
          (v) => `${Math.round(v)}px`,
          (v) => this.mutateLiveVerlet(ent.id, { segmentLength: v }),
          (v) => commitVerlet({ segmentLength: v }),
        ),
        this.createSliderRow(
          '柔體重力 Gravity',
          0,
          1200,
          20,
          vc.gravity ?? 420,
          (v) => `${Math.round(v)}`,
          (v) => this.mutateLiveVerlet(ent.id, { gravity: v }),
          (v) => commitVerlet({ gravity: v }),
        ),
      );
      vcSec.append(vcTitle, vcColRow, vcSliders);
      sections.push(vcSec);
    }

    // Section 4f: Live Spatial3D Elevation & Dimension Mask Inspector
    if (resolved.spatial3d) {
      const sp = resolved.spatial3d;
      const spSec = document.createElement('div');
      spSec.className = 'p7-section';
      const spTitle = document.createElement('h3');
      spTitle.className = 'p7-section-title';
      spTitle.textContent = 'Spatial3D 立體高度與維度';

      const commitSpatial = (partial: Partial<typeof sp>) => {
        this.session.dispatch({
          type: 'patch_entity',
          entityId: ent.id,
          patch: { spatial3d: partial },
        });
      };

      const realmField = document.createElement('div');
      realmField.className = 'p7-field';
      const realmLbl = document.createElement('label');
      realmLbl.textContent = '所屬維度位面 (Dimension Mask)';
      const realmSel = document.createElement('select');
      realmSel.className = 'p7-select p7-mono';
      realmSel.setAttribute('aria-label', '實體所屬維度位面');
      for (const opt of [
        { v: 1, t: '表世界 [1]' },
        { v: 2, t: '裡世界 [2]' },
        { v: 3, t: '全維度共用 [3]' },
      ]) {
        const o = document.createElement('option');
        o.value = String(opt.v);
        o.textContent = opt.t;
        realmSel.appendChild(o);
      }
      realmSel.value = String(sp.dimensionMask ?? 1);
      realmSel.addEventListener('change', () => {
        const mask = Number(realmSel.value) || 1;
        this.mutateLiveSpatial3D(ent.id, { dimensionMask: mask });
        commitSpatial({ dimensionMask: mask });
      });
      realmField.append(realmLbl, realmSel);

      const spSliders = document.createElement('div');
      spSliders.className = 'p7-slider-group';
      spSliders.append(
        this.createSliderRow(
          '海拔高度 Z',
          0,
          120,
          2,
          sp.z ?? 0,
          (v) => `${Math.round(v)}px`,
          (v) => this.mutateLiveSpatial3D(ent.id, { z: v }),
          (v) => commitSpatial({ z: v }),
        ),
        this.createSliderRow(
          '垂直厚度 Height',
          4,
          64,
          2,
          sp.height ?? 16,
          (v) => `${Math.round(v)}px`,
          (v) => this.mutateLiveSpatial3D(ent.id, { height: v }),
          (v) => commitSpatial({ height: v }),
        ),
        this.createSliderRow(
          'Z 軸重力 GravityZ',
          0,
          1200,
          20,
          sp.gravityZ ?? 0,
          (v) => (v <= 0 ? '懸浮 (0)' : `${Math.round(v)} px/s²`),
          (v) => this.mutateLiveSpatial3D(ent.id, { gravityZ: v }),
          (v) => commitSpatial({ gravityZ: v }),
        ),
        this.createSliderRow(
          'Z 跳躍初速 JumpZ',
          0,
          420,
          10,
          sp.jumpZVelocity ?? 190,
          (v) => `${Math.round(v)} px/s`,
          (v) => this.mutateLiveSpatial3D(ent.id, { jumpZVelocity: v }),
          (v) => commitSpatial({ jumpZVelocity: v }),
        ),
      );
      spSec.append(spTitle, realmField, spSliders);
      sections.push(spSec);
    }

    // Section 5: Sandboxed Script VM Rules
    const scrSec = document.createElement('div');
    scrSec.className = 'p7-section';
    const scrTitle = document.createElement('h3');
    scrTitle.className = 'p7-section-title';
    scrTitle.textContent = '沙盒腳本虛擬機規則';
    scrSec.appendChild(scrTitle);

    const attachedScripts = resolved.scripts ?? [];
    if (attachedScripts.length === 0) {
      const note = document.createElement('p');
      note.className = 'p7-empty-note';
      note.textContent = '此實體尚未掛載沙盒腳本。';
      scrSec.appendChild(note);
    } else {
      for (const sid of attachedScripts) {
        const def = proj.scripts[sid];
        if (!def) continue;
        const item = document.createElement('div');
        item.className = 'p7-script-item';
        const itemHead = document.createElement('div');
        itemHead.className = 'p7-section-head';
        const nm = document.createElement('strong');
        nm.className = 'p7-item-title';
        nm.textContent = `${def.name} (${def.id})`;
        const openGraphBtn = document.createElement('button');
        openGraphBtn.type = 'button';
        openGraphBtn.className = 'p7-btn p7-btn-xs';
        openGraphBtn.textContent = '編輯事件圖';
        openGraphBtn.setAttribute('aria-label', `編輯 ${def.name} 事件圖`);
        openGraphBtn.addEventListener('click', () => this.setCenterMode('event_graph', def.id));
        itemHead.append(nm, openGraphBtn);

        const desc = document.createElement('span');
        desc.className = 'p7-meta-line';
        const totalOps = def.rules.reduce((acc, r) => acc + r.ops.length, 0);
        desc.textContent = `${def.rules.length} 條規則 · ${totalOps} 指令 · ${def.description ?? '確定性位元碼'}`;
        item.append(itemHead, desc);
        scrSec.appendChild(item);
      }
    }
    sections.push(scrSec);

    // Section 6: Atmosphere, HD-2D Shadow Occlusion, Tilt-Shift DoF & Combat Feel
    const atmSec = document.createElement('div');
    atmSec.className = 'p7-section';
    const atmTitle = document.createElement('h3');
    atmTitle.className = 'p7-section-title';
    atmTitle.textContent = 'HD-2D 立體視角、光影與景深';

    const curProjMode: EcsProjectionMode = proj.projection?.mode ?? 'hd2d_3d';
    const projModeRow = document.createElement('div');
    projModeRow.className = 'p7-prefab-actions';
    const mode3dBtn = document.createElement('button');
    mode3dBtn.type = 'button';
    mode3dBtn.className = curProjMode === 'hd2d_3d' ? 'p7-btn p7-btn-accent' : 'p7-btn';
    mode3dBtn.setAttribute('data-testid', 'proj-mode-hd2d-3d');
    mode3dBtn.textContent = '真 3D 透視';
    mode3dBtn.addEventListener('click', () => {
      this.session.dispatch({ type: 'set_projection', patch: { mode: 'hd2d_3d' } });
    });
    const modeIsoBtn = document.createElement('button');
    modeIsoBtn.type = 'button';
    modeIsoBtn.className = curProjMode === 'hd2d_iso' ? 'p7-btn p7-btn-accent' : 'p7-btn';
    modeIsoBtn.setAttribute('data-testid', 'proj-mode-hd2d-iso');
    modeIsoBtn.textContent = '3/4 強立體';
    modeIsoBtn.addEventListener('click', () => {
      this.session.dispatch({ type: 'set_projection', patch: { mode: 'hd2d_iso' } });
    });
    const modeOrthoBtn = document.createElement('button');
    modeOrthoBtn.type = 'button';
    modeOrthoBtn.className = curProjMode === 'ortho_2d' ? 'p7-btn p7-btn-accent' : 'p7-btn';
    modeOrthoBtn.setAttribute('data-testid', 'proj-mode-ortho-2d');
    modeOrthoBtn.textContent = '2D 正交';
    modeOrthoBtn.addEventListener('click', () => {
      this.session.dispatch({ type: 'set_projection', patch: { mode: 'ortho_2d' } });
    });
    projModeRow.append(mode3dBtn, modeIsoBtn, modeOrthoBtn);

    const commitProj = (patch: Partial<NonNullable<EcsProjectV2['projection']>>) => {
      this.session.dispatch({ type: 'set_projection', patch });
    };
    const projSliders = document.createElement('div');
    projSliders.className = 'p7-slider-group';
    projSliders.append(
      this.createSliderRow(
        '相機俯角 Pitch',
        22,
        70,
        1,
        proj.projection?.pitchDeg ?? DEFAULT_HD2D_3D_PITCH_DEG,
        (v) => `${Math.round(v)}°`,
        (v) => {
          this.runtime.patchLiveProjection({ pitchDeg: v });
          this.renderPreviewNow();
        },
        (v) => commitProj({ pitchDeg: v }),
      ),
      this.createSliderRow(
        '透視視野 FOV',
        24,
        60,
        1,
        proj.projection?.fovDeg ?? DEFAULT_HD2D_3D_FOV_DEG,
        (v) => `${Math.round(v)}°`,
        (v) => {
          this.runtime.patchLiveProjection({ fovDeg: v });
          this.renderPreviewNow();
        },
        (v) => commitProj({ fovDeg: v }),
      ),
      this.createSliderRow(
        '牆體高度倍率 Wall Height',
        0.6,
        2.2,
        0.05,
        proj.projection?.wallHeightScale ?? 1.25,
        (v) => `${v.toFixed(2)}×`,
        (v) => {
          this.runtime.patchLiveProjection({ wallHeightScale: v });
          this.renderPreviewNow();
        },
        (v) => commitProj({ wallHeightScale: v }),
      ),
      this.createSliderRow(
        '紙片人仰角 Billboard Tilt',
        0,
        32,
        1,
        proj.projection?.billboardTiltDeg ?? 12,
        (v) => `${Math.round(v)}°`,
        (v) => {
          this.runtime.patchLiveProjection({ billboardTiltDeg: v });
          this.renderPreviewNow();
        },
        (v) => commitProj({ billboardTiltDeg: v }),
      ),
    );

    const waterRow = document.createElement('div');
    waterRow.className = 'p7-prefab-actions';

    const shadowOn = proj.atmosphere.shadowOcclusion !== false;
    const toggleShadowBtn = document.createElement('button');
    toggleShadowBtn.type = 'button';
    toggleShadowBtn.className = shadowOn ? 'p7-btn p7-btn-accent' : 'p7-btn';
    toggleShadowBtn.textContent = shadowOn ? '2D 陰影遮蔽：開' : '2D 陰影遮蔽：關';
    toggleShadowBtn.addEventListener('click', () => {
      this.session.dispatch({
        type: 'set_atmosphere',
        patch: { shadowOcclusion: !shadowOn },
      });
    });

    const waterOn = (proj.atmosphere.waterLevelNorm ?? 0) > 0;
    const toggleWaterBtn = document.createElement('button');
    toggleWaterBtn.type = 'button';
    toggleWaterBtn.className = waterOn ? 'p7-btn p7-btn-accent' : 'p7-btn';
    toggleWaterBtn.textContent = waterOn ? '水面反射：開' : '水面反射：關';
    toggleWaterBtn.addEventListener('click', () => {
      this.session.dispatch({
        type: 'set_atmosphere',
        patch: { waterLevelNorm: waterOn ? 0 : 0.81 },
      });
    });

    const shiftOn = Boolean(proj.projection?.allowDimensionShift);
    const toggleShiftBtn = document.createElement('button');
    toggleShiftBtn.type = 'button';
    toggleShiftBtn.className = shiftOn ? 'p7-btn p7-btn-accent' : 'p7-btn';
    toggleShiftBtn.textContent = shiftOn ? 'R 鍵切界：開' : 'R 鍵切界：關';
    toggleShiftBtn.addEventListener('click', () => {
      this.session.dispatch({
        type: 'set_projection',
        patch: { allowDimensionShift: !shiftOn },
      });
    });

    waterRow.append(toggleShadowBtn, toggleWaterBtn, toggleShiftBtn);

    const particleField = document.createElement('div');
    particleField.className = 'p7-field';
    const particleLbl = document.createElement('label');
    particleLbl.textContent = '環境微粒主題 (GPU Particles)';
    const particleSel = document.createElement('select');
    particleSel.className = 'p7-select p7-mono';
    particleSel.setAttribute('aria-label', '環境微粒主題');
    const particleOptions: Array<{ v: EcsAmbientParticleTheme; t: string }> = [
      { v: 'none', t: '關閉 (None)' },
      { v: 'embers', t: '熾熱火星 (Embers)' },
      { v: 'fireflies', t: '螢火微光 (Fireflies)' },
      { v: 'dust', t: '浮塵光屑 (Dust)' },
      { v: 'snow', t: '飄雪冰晶 (Snow)' },
    ];
    for (const opt of particleOptions) {
      const o = document.createElement('option');
      o.value = opt.v;
      o.textContent = opt.t;
      particleSel.appendChild(o);
    }
    particleSel.value = proj.atmosphere.ambientParticles ?? 'none';
    particleSel.addEventListener('change', () => {
      this.session.dispatch({
        type: 'set_atmosphere',
        patch: { ambientParticles: particleSel.value as EcsAmbientParticleTheme },
      });
    });
    particleField.append(particleLbl, particleSel);

    const commitAtm = (patch: Partial<EcsProjectV2['atmosphere']>) => {
      this.session.dispatch({ type: 'set_atmosphere', patch });
    };
    const atmSliders = document.createElement('div');
    atmSliders.className = 'p7-slider-group';
    atmSliders.append(
      this.createSliderRow(
        '陰影遮蔽深度 Shadow',
        0,
        1,
        0.05,
        proj.atmosphere.shadowStrength ?? 0.88,
        (v) => `${Math.round(v * 100)}%`,
        (v) => {
          this.runtime.patchLiveAtmosphere({ shadowStrength: v });
          this.renderPreviewNow();
        },
        (v) => commitAtm({ shadowStrength: v }),
      ),
      this.createSliderRow(
        '移軸景深 Tilt-Shift DoF',
        0,
        1,
        0.05,
        proj.atmosphere.tiltShiftBlur ?? 0.32,
        (v) => `${Math.round(v * 100)}%`,
        (v) => {
          this.runtime.patchLiveAtmosphere({ tiltShiftBlur: v });
          this.renderPreviewNow();
        },
        (v) => commitAtm({ tiltShiftBlur: v }),
      ),
      this.createSliderRow(
        '打擊頓幀震屏 Juice Scale',
        0,
        2,
        0.1,
        proj.atmosphere.juiceScale ?? 1.0,
        (v) => `${v.toFixed(1)}×`,
        (v) => {
          this.runtime.patchLiveAtmosphere({ juiceScale: v });
        },
        (v) => commitAtm({ juiceScale: v }),
      ),
    );

    atmSec.append(atmTitle, projModeRow, projSliders, waterRow, particleField, atmSliders);
    sections.push(atmSec);

    // Section 7: Transaction History
    const histSec = document.createElement('div');
    histSec.className = 'p7-section';
    const histTitle = document.createElement('h3');
    histTitle.className = 'p7-section-title';
    histTitle.textContent = '交易式修訂歷程';
    histSec.appendChild(histTitle);

    const recent = this.session.getHistory().slice(-5).reverse();
    for (const h of recent) {
      const row = document.createElement('div');
      row.className = 'p7-meta-line p7-mono';
      row.textContent = `#${h.revision} · ${h.summary}`;
      histSec.appendChild(row);
    }
    sections.push(histSec);

    this.rightContentEl.append(...sections);
  }

  public openExternalImportModal(): void {
    this.externalImportModal.open();
  }

  private handleExternalImportCommit(result: InteropImportResult, options: InteropCommitOptions): void {
    const cmds = buildInteropStudioCommands(result, this.session.getProject(), options);
    if (cmds.length === 0) return;
    const batchRes = this.session.dispatchBatch(cmds, `外部匯入 ${result.sourceName}`);
    if (!batchRes.ok) {
      this.statusLeftEl.textContent = `外部匯入失敗：${batchRes.errors.join('; ') || batchRes.summary}`;
      return;
    }

    const updatedProj = this.session.getProject();
    this.syncedCustomSpriteIds = syncProjectCustomSpritesToAtlas(
      this.atlas,
      updatedProj,
      this.syncedCustomSpriteIds,
    );
    if (this.previewGpuInitialized) {
      this.previewGpu.syncAtlasIfDirty();
    }
    this.callbacks.onAtlasMutated();

    if (result.rooms.length > 0) {
      this.setLeftTab('map');
      this.switchActiveRoom(result.rooms[0].id);
      const reach = analyzeWorldMapReachability(updatedProj);
      this.lastDiagReport = {
        ok: reach.pass,
        headline: `外部匯入完成 · ${result.sourceName} (${reach.softLockRisks.length} 軟鎖)`,
        lines: [
          result.summary,
          `可達房間：${reach.reachableRoomIds.length} / ${updatedProj.worldMap?.rooms.length ?? 0}`,
          ...(reach.softLockRisks.length > 0 ? reach.softLockRisks.slice(0, 3) : ['BFS 連通性與鑰匙依賴驗證全數通過']),
        ],
      };
      this.statusLeftEl.textContent =
        `已匯入 ${result.sourceName}：${result.rooms.length} 房間 · ${result.tileDefs.length} 瓦片 · ` +
        `${reach.softLockRisks.length} 軟鎖（可按復原還原）`;
      this.renderRightPanel();
    } else {
      this.setLeftTab(options.createTileFromSprite ? 'map' : 'atlas');
      this.statusLeftEl.textContent =
        `已匯入 ${result.sourceName}：${result.customSprites.length} 張無損精靈至 MaxRects 圖集池（可按復原還原）`;
    }
  }

  public destroy(): void {
    this.unsubSession();
    this.ac.abort();
    this.externalImportModal.destroy();
    this.eventGraphView.destroy();
    this.previewGpu.dispose();
    this.element.remove();
  }
}
