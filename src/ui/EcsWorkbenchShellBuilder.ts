import type { EcsProjectionMode, EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { ViewportPreset } from '../core/gpu/GpuTypes.ts';
import { BUILTIN_ECS_PROJECTS, VIEWPORT_OPTIONS } from './EcsWorkbenchCatalog.ts';

export type WorkbenchLeftTab = 'map' | 'rules' | 'hierarchy' | 'prefabs' | 'atlas';
export type WorkbenchCenterMode = 'viewport' | 'event_graph';

export interface EcsWorkbenchShellRefs {
  rootEl: HTMLElement;
  projectSelectEl: HTMLSelectElement;
  roomQuickSelectEl: HTMLSelectElement;
  leftContentEl: HTMLElement;
  rightContentEl: HTMLElement;
  rightTitleEl: HTMLElement;
  statusLeftEl: HTMLElement;
  statusRightEl: HTMLElement;
  viewportSelectEl: HTMLSelectElement;
  projectionSelectEl: HTMLSelectElement;
  dimensionSelectEl: HTMLSelectElement;
  playPauseBtn: HTMLButtonElement;
  overlayBtn: HTMLButtonElement;
  hitABtn: HTMLButtonElement;
  hitBBtn: HTMLButtonElement;
  shiftRealmBtn: HTMLButtonElement;
  undoBtn: HTMLButtonElement;
  redoBtn: HTMLButtonElement;
  leftTabMapBtn: HTMLButtonElement;
  leftTabRulesBtn: HTMLButtonElement;
  leftTabHierarchyBtn: HTMLButtonElement;
  leftTabPrefabsBtn: HTMLButtonElement;
  leftTabAtlasBtn: HTMLButtonElement;
  centerTabViewportBtn: HTMLButtonElement;
  centerTabGraphBtn: HTMLButtonElement;
  viewportStageEl: HTMLDivElement;
  previewCanvas: HTMLCanvasElement;
  mapOverlayCanvas: HTMLCanvasElement;
}

export interface EcsWorkbenchShellCallbacks {
  initialProject: EcsProjectV2;
  initialLeftTab: WorkbenchLeftTab;
  initialPlayPauseLabel: string;
  eventGraphEl: HTMLElement;
  externalImportModalEl: HTMLElement;
  signal: AbortSignal;
  onOpenExternalImport: () => void;
  onOpenClassicWorkshop: () => void;
  onSelectBuiltinProject: (project: EcsProjectV2) => void;
  onSelectLeftTab: (tab: WorkbenchLeftTab) => void;
  onSelectViewportPreset: (preset: ViewportPreset) => void;
  onTogglePlayPause: () => void;
  onStepFrame: () => void;
  onResetRuntime: () => void;
  onToggleDebugOverlay: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRunDiagnostics: () => void;
  onSelectCenterMode: (mode: WorkbenchCenterMode) => void;
  onSwitchRoom: (roomId: string) => void;
  onHitActionA: () => void;
  onHitActionB: () => void;
  onShiftRealm: () => void;
  onLaunchArcade: () => void;
  onSelectProjection: (mode: EcsProjectionMode) => void;
  onSelectDimensionMask: (mask: number) => void;
}

/**
 * Pure declarative DOM shell builder for the 3-pane ECS Workstation
 * (Left Asset/Hierarchy Pane | Center GPU Viewport & Toolbar | Right Inspector Pane).
 * Keeps `EcsWorkbenchView` focused strictly on state orchestration and lifecycle.
 */
export function buildEcsWorkbenchShell(cb: EcsWorkbenchShellCallbacks): EcsWorkbenchShellRefs {
  const { initialProject, initialLeftTab, signal } = cb;

  const rootEl = document.createElement('section');
  rootEl.className = 'p7-workbench';
  rootEl.setAttribute('aria-label', 'Pixer 7.0 創作工作站');

  // ================= LEFT PANE =================
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
  importBtn.addEventListener('click', cb.onOpenExternalImport, { signal });

  const classicBtn = document.createElement('button');
  classicBtn.type = 'button';
  classicBtn.className = 'p7-btn p7-btn-xs';
  classicBtn.textContent = '像素畫室';
  classicBtn.title = '開啟經典像素畫室與積木正交工坊';
  classicBtn.addEventListener('click', cb.onOpenClassicWorkshop, { signal });
  headBtns.append(importBtn, classicBtn);
  leftHeadRow.append(leftTitle, headBtns);

  const projectSelectEl = document.createElement('select');
  projectSelectEl.className = 'p7-select p7-select-full p7-mono';
  projectSelectEl.setAttribute('aria-label', '切換內建純 ECS 專案');
  for (const item of BUILTIN_ECS_PROJECTS) {
    const o = document.createElement('option');
    o.value = item.id;
    o.textContent = item.label;
    projectSelectEl.appendChild(o);
  }
  projectSelectEl.value = initialProject.meta.id;
  projectSelectEl.addEventListener(
    'change',
    () => {
      const picked = BUILTIN_ECS_PROJECTS.find((p) => p.id === projectSelectEl.value);
      if (picked) cb.onSelectBuiltinProject(picked.project);
    },
    { signal },
  );

  const seg = document.createElement('div');
  seg.className = 'p7-segmented p7-segmented-full';
  const makeTabBtn = (label: string, tab: WorkbenchLeftTab): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = initialLeftTab === tab ? 'p7-seg-btn is-active' : 'p7-seg-btn';
    b.textContent = label;
    b.addEventListener('click', () => cb.onSelectLeftTab(tab), { signal });
    return b;
  };
  const leftTabMapBtn = makeTabBtn('地圖', 'map');
  const leftTabRulesBtn = makeTabBtn('規則', 'rules');
  const leftTabHierarchyBtn = makeTabBtn('階層', 'hierarchy');
  const leftTabPrefabsBtn = makeTabBtn('物件庫', 'prefabs');
  const leftTabAtlasBtn = makeTabBtn('圖集', 'atlas');
  seg.append(leftTabMapBtn, leftTabRulesBtn, leftTabHierarchyBtn, leftTabPrefabsBtn, leftTabAtlasBtn);

  leftHead.append(leftHeadRow, projectSelectEl, seg);
  const leftContentEl = document.createElement('div');
  leftContentEl.className = 'p7-pane-scroll';
  leftPane.append(leftHead, leftContentEl);

  // ================= CENTER FOCAL ANCHOR (Live GPU Viewport) =================
  const centerPane = document.createElement('main');
  centerPane.className = 'p7-center';

  const toolbar = document.createElement('div');
  toolbar.className = 'p7-viewport-toolbar';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'p7-toolbar-group';

  const viewportSelectEl = document.createElement('select');
  viewportSelectEl.className = 'p7-select p7-mono';
  viewportSelectEl.setAttribute('aria-label', '邏輯視口解析度');
  for (const opt of VIEWPORT_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    viewportSelectEl.appendChild(o);
  }
  viewportSelectEl.value = initialProject.viewport.preset ?? 'hd_plus';
  viewportSelectEl.addEventListener(
    'change',
    () => cb.onSelectViewportPreset(viewportSelectEl.value as ViewportPreset),
    { signal },
  );

  const playPauseBtn = document.createElement('button');
  playPauseBtn.type = 'button';
  playPauseBtn.className = 'p7-btn p7-btn-accent';
  playPauseBtn.textContent = cb.initialPlayPauseLabel;
  playPauseBtn.addEventListener('click', cb.onTogglePlayPause, { signal });

  const stepBtn = document.createElement('button');
  stepBtn.type = 'button';
  stepBtn.className = 'p7-btn';
  stepBtn.textContent = '單步';
  stepBtn.addEventListener('click', cb.onStepFrame, { signal });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'p7-btn';
  resetBtn.textContent = '重置';
  resetBtn.addEventListener('click', cb.onResetRuntime, { signal });

  const overlayBtn = document.createElement('button');
  overlayBtn.type = 'button';
  overlayBtn.className = 'p7-btn';
  overlayBtn.textContent = '路徑覆疊';
  overlayBtn.addEventListener('click', cb.onToggleDebugOverlay, { signal });

  leftGroup.append(viewportSelectEl, playPauseBtn, stepBtn, resetBtn, overlayBtn);

  const rightGroup = document.createElement('div');
  rightGroup.className = 'p7-toolbar-group';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'p7-btn';
  undoBtn.textContent = '復原';
  undoBtn.addEventListener('click', cb.onUndo, { signal });

  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className = 'p7-btn';
  redoBtn.textContent = '重做';
  redoBtn.addEventListener('click', cb.onRedo, { signal });

  const diagBtn = document.createElement('button');
  diagBtn.type = 'button';
  diagBtn.className = 'p7-btn';
  diagBtn.textContent = '空間診斷';
  diagBtn.title = 'AI 空間與試玩診斷';
  diagBtn.addEventListener('click', cb.onRunDiagnostics, { signal });

  const centerModeSeg = document.createElement('div');
  centerModeSeg.className = 'p7-segmented';
  const centerTabViewportBtn = document.createElement('button');
  centerTabViewportBtn.type = 'button';
  centerTabViewportBtn.className = 'p7-seg-btn is-active';
  centerTabViewportBtn.textContent = '即時視口';
  centerTabViewportBtn.addEventListener('click', () => cb.onSelectCenterMode('viewport'), { signal });

  const centerTabGraphBtn = document.createElement('button');
  centerTabGraphBtn.type = 'button';
  centerTabGraphBtn.className = 'p7-seg-btn';
  centerTabGraphBtn.textContent = '腳本事件圖';
  centerTabGraphBtn.addEventListener('click', () => cb.onSelectCenterMode('event_graph'), { signal });
  centerModeSeg.append(centerTabViewportBtn, centerTabGraphBtn);

  rightGroup.append(centerModeSeg, undoBtn, redoBtn, diagBtn);
  toolbar.append(leftGroup, rightGroup);

  const viewportStageEl = document.createElement('div');
  viewportStageEl.className = 'p7-viewport-stage';

  const canvasFrame = document.createElement('div');
  canvasFrame.className = 'p7-canvas-frame';

  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'p7-live-canvas';
  previewCanvas.setAttribute('data-testid', 'ecs-preview-canvas');
  previewCanvas.width = initialProject.viewport.width;
  previewCanvas.height = initialProject.viewport.height;

  const mapOverlayCanvas = document.createElement('canvas');
  mapOverlayCanvas.className = 'p7-map-overlay';
  mapOverlayCanvas.setAttribute('data-testid', 'ecs-map-overlay');
  mapOverlayCanvas.width = initialProject.viewport.width;
  mapOverlayCanvas.height = initialProject.viewport.height;
  canvasFrame.append(previewCanvas, mapOverlayCanvas);

  // Interactive play bar directly beneath viewport
  const playBar = document.createElement('div');
  playBar.className = 'p7-play-bar';

  const roomQuickSelectEl = document.createElement('select');
  roomQuickSelectEl.className = 'p7-select p7-mono';
  roomQuickSelectEl.setAttribute('aria-label', '快速切換地圖房間');
  roomQuickSelectEl.addEventListener('change', () => cb.onSwitchRoom(roomQuickSelectEl.value), { signal });

  const hitABtn = document.createElement('button');
  hitABtn.type = 'button';
  hitABtn.className = 'p7-btn p7-btn-accent';
  hitABtn.textContent = '打擊上軌星拍 [A]';
  hitABtn.addEventListener('click', cb.onHitActionA, { signal });

  const hitBBtn = document.createElement('button');
  hitBBtn.type = 'button';
  hitBBtn.className = 'p7-btn';
  hitBBtn.textContent = '打擊下軌蒼拍 [B]';
  hitBBtn.addEventListener('click', cb.onHitActionB, { signal });

  const shiftRealmBtn = document.createElement('button');
  shiftRealmBtn.type = 'button';
  shiftRealmBtn.className = 'p7-btn';
  shiftRealmBtn.textContent = '切換表裡世界 [R]';
  shiftRealmBtn.addEventListener('click', cb.onShiftRealm, { signal });

  const launchArcadeBtn = document.createElement('button');
  launchArcadeBtn.type = 'button';
  launchArcadeBtn.className = 'p7-btn';
  launchArcadeBtn.textContent = '掌機試玩';
  launchArcadeBtn.title = '同步至掌機外殼試玩';
  launchArcadeBtn.addEventListener('click', cb.onLaunchArcade, { signal });

  const projectionSelectEl = document.createElement('select');
  projectionSelectEl.className = 'p7-select p7-mono';
  projectionSelectEl.setAttribute('aria-label', '多維投影視角模式');
  const projOptions: readonly { id: EcsProjectionMode; label: string }[] = [
    { id: 'hd2d_3d', label: '真 3D 透視 (HD-2D)' },
    { id: 'hd2d_iso', label: '3/4 強立體 (2.5D)' },
    { id: 'ortho_2d', label: '2D 純平正交' },
    { id: 'first_person_25d', label: '1P 2.5D 視角' },
  ];
  for (const opt of projOptions) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    projectionSelectEl.appendChild(o);
  }
  projectionSelectEl.value = initialProject.projection?.mode ?? 'hd2d_3d';
  projectionSelectEl.addEventListener(
    'change',
    () => cb.onSelectProjection(projectionSelectEl.value as EcsProjectionMode),
    { signal },
  );

  const dimensionSelectEl = document.createElement('select');
  dimensionSelectEl.className = 'p7-select p7-mono';
  dimensionSelectEl.setAttribute('aria-label', '目前檢視維度位面');
  const dimOptions: readonly { mask: number; label: string }[] = [
    { mask: 3, label: '全維度 [3]' },
    { mask: 1, label: '表世界 [1]' },
    { mask: 2, label: '裡世界 [2]' },
  ];
  for (const opt of dimOptions) {
    const o = document.createElement('option');
    o.value = String(opt.mask);
    o.textContent = opt.label;
    dimensionSelectEl.appendChild(o);
  }
  dimensionSelectEl.value = String(initialProject.projection?.activeDimensionMask ?? 3);
  dimensionSelectEl.addEventListener(
    'change',
    () => cb.onSelectDimensionMask(Number(dimensionSelectEl.value) || 3),
    { signal },
  );

  playBar.append(
    roomQuickSelectEl,
    hitABtn,
    hitBBtn,
    shiftRealmBtn,
    projectionSelectEl,
    dimensionSelectEl,
    launchArcadeBtn,
  );
  viewportStageEl.append(canvasFrame, playBar);

  const statusStrip = document.createElement('div');
  statusStrip.className = 'p7-status-strip p7-mono';
  const statusLeftEl = document.createElement('span');
  const statusRightEl = document.createElement('span');
  statusStrip.append(statusLeftEl, statusRightEl);

  centerPane.append(toolbar, viewportStageEl, cb.eventGraphEl, statusStrip);

  // ================= RIGHT PANE =================
  const rightPane = document.createElement('aside');
  rightPane.className = 'p7-pane p7-pane-right';

  const rightHead = document.createElement('div');
  rightHead.className = 'p7-pane-header';
  const rightTitleEl = document.createElement('h2');
  rightTitleEl.className = 'p7-pane-title';
  rightTitleEl.textContent = 'ECS 元件檢查器與沙盒腳本';
  rightHead.appendChild(rightTitleEl);

  const rightContentEl = document.createElement('div');
  rightContentEl.className = 'p7-pane-scroll';
  rightPane.append(rightHead, rightContentEl);

  rootEl.append(leftPane, centerPane, rightPane, cb.externalImportModalEl);

  return {
    rootEl,
    projectSelectEl,
    roomQuickSelectEl,
    leftContentEl,
    rightContentEl,
    rightTitleEl,
    statusLeftEl,
    statusRightEl,
    viewportSelectEl,
    projectionSelectEl,
    dimensionSelectEl,
    playPauseBtn,
    overlayBtn,
    hitABtn,
    hitBBtn,
    shiftRealmBtn,
    undoBtn,
    redoBtn,
    leftTabMapBtn,
    leftTabRulesBtn,
    leftTabHierarchyBtn,
    leftTabPrefabsBtn,
    leftTabAtlasBtn,
    centerTabViewportBtn,
    centerTabGraphBtn,
    viewportStageEl,
    previewCanvas,
    mapOverlayCanvas,
  };
}
