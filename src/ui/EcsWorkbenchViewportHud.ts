import { MAX_VOXEL_STORIES } from '../core/ecs/EcsVoxelVolume.ts';
import type {
  MapDesignerState,
  MapGizmoMode,
  MapSliceCutawayMode,
  MapToolMode,
} from './EcsMapDesignerPanelTypes.ts';
import { WORKBENCH_SNAP_STEPS, type WorkbenchSnapStep } from './EcsWorkbenchPreferences.ts';

export interface ViewportHudDeps {
  mapState: MapDesignerState;
  isVisible: () => boolean;
  getZoom: () => number;
  onToolOrLayerChanged: () => void;
  onSnapChanged: (snapStep: WorkbenchSnapStep) => void;
  onSliceChanged: (cutawayMode?: MapSliceCutawayMode) => void;
  onResetCamera: () => void;
  onOpenCommandPalette: () => void;
  onOpenShortcuts: () => void;
}

const HUD_TOOLS: readonly [MapToolMode, string, string][] = [
  ['select', 'V 選', '選取與 Gizmo (V)'],
  ['brush', 'B 筆', '筆刷繪製 (B)'],
  ['rect', 'R 矩', '矩形填充 / 3D 拉高 (R)'],
  ['fill', 'G 填', '油漆桶填色 (G)'],
  ['erase', 'E 擦', '橡皮擦清除 (E)'],
  ['eyedropper', 'I 吸', '吸管取樣 (I)'],
];

const HUD_GIZMOS: readonly [MapGizmoMode, string, string][] = [
  ['move', '移', 'Gizmo 移動模式'],
  ['rotate', '旋', 'Gizmo 旋轉模式'],
  ['scale', '縮', 'Gizmo 縮放模式'],
];

const CUTAWAY_ORDER: readonly MapSliceCutawayMode[] = ['all', 'ghost_above', 'solo_floor'];
const CUTAWAY_LABELS: Readonly<Record<MapSliceCutawayMode, string>> = {
  all: '全顯',
  ghost_above: '虛化',
  solo_floor: '單層',
};

function makeGroup(): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'p7-vp-hud-group';
  return g;
}

function makeHudBtn(
  label: string,
  title: string,
  mono: boolean,
  signal: AbortSignal,
  onClick: () => void,
  testId?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = mono ? 'p7-vp-hud-btn p7-mono' : 'p7-vp-hud-btn';
  btn.textContent = label;
  btn.title = title;
  if (testId) btn.dataset.testid = testId;
  btn.addEventListener('click', onClick, { signal });
  return btn;
}

/**
 * Compact translucent Floating Viewport HUD overlaid at the top-left of `.p7-canvas-frame`.
 * Gives 1-click access to tools, 2D/3D layer, gizmo mode, snap, Z-floor cutaway, zoom reset,
 * Command Palette (`Ctrl+K`), and Shortcut Cheatsheet (`?`) with dirty-checked zero-churn `sync()`.
 */
export class EcsWorkbenchViewportHud {
  public readonly element: HTMLDivElement;
  private readonly ac = new AbortController();
  private readonly deps: ViewportHudDeps;
  private readonly toolBtns = new Map<MapToolMode, HTMLButtonElement>();
  private readonly gizmoBtns = new Map<MapGizmoMode, HTMLButtonElement>();
  private readonly layerToggleBtn: HTMLButtonElement;
  private readonly snapBtn: HTMLButtonElement;
  private readonly zDecBtn: HTMLButtonElement;
  private readonly zLabelEl: HTMLSpanElement;
  private readonly zIncBtn: HTMLButtonElement;
  private readonly cutawayBtn: HTMLButtonElement;
  private readonly zoomBtn: HTMLButtonElement;

  private lastVisible: boolean | null = null;
  private lastTool: MapToolMode | null = null;
  private lastIsVoxel: boolean | null = null;
  private lastGizmo: MapGizmoMode | null = null;
  private lastSnap: number | null = null;
  private lastZ: number | null = null;
  private lastCutaway: MapSliceCutawayMode | null = null;
  private lastZoomPct: number | null = null;

  constructor(deps: ViewportHudDeps) {
    this.deps = deps;
    const { signal } = this.ac;

    this.element = document.createElement('div');
    this.element.className = 'p7-vp-hud';
    this.element.dataset.testid = 'viewport-hud';
    this.element.setAttribute('aria-label', '視口快速浮動工具列');

    const toolGroup = makeGroup();
    for (const [id, label, title] of HUD_TOOLS) {
      const btn = makeHudBtn(label, title, true, signal, () => {
        this.deps.mapState.tool = id;
        this.deps.mapState.selectedStampPrefabId = null;
        this.deps.onToolOrLayerChanged();
        this.sync();
      });
      btn.dataset.hudTool = id;
      this.toolBtns.set(id, btn);
      toolGroup.appendChild(btn);
    }

    const layerGroup = makeGroup();
    this.layerToggleBtn = makeHudBtn('2D', '切換 2D 瓦片圖層 / 3D 體素圖層', false, signal, () => {
      const ms = this.deps.mapState;
      ms.editLayer = ms.editLayer === 'voxel3d' ? ms.layer : 'voxel3d';
      this.deps.onToolOrLayerChanged();
      this.sync();
    }, 'vp-hud-layer-toggle');
    layerGroup.appendChild(this.layerToggleBtn);

    const gizmoGroup = makeGroup();
    for (const [id, label, title] of HUD_GIZMOS) {
      const btn = makeHudBtn(label, title, false, signal, () => {
        this.deps.mapState.gizmoMode = id;
        this.deps.onToolOrLayerChanged();
        this.sync();
      });
      btn.dataset.hudGizmo = id;
      this.gizmoBtns.set(id, btn);
      gizmoGroup.appendChild(btn);
    }

    const snapGroup = makeGroup();
    this.snapBtn = makeHudBtn('磁吸: 16px', '循環切換網格磁吸間距 (0 / 8 / 16 / 32px)', true, signal, () => {
      const idx = WORKBENCH_SNAP_STEPS.indexOf(this.deps.mapState.snapStep as WorkbenchSnapStep);
      const next = WORKBENCH_SNAP_STEPS[(idx + 1) % WORKBENCH_SNAP_STEPS.length];
      this.deps.mapState.snapStep = next;
      this.deps.onSnapChanged(next);
      this.sync();
    }, 'vp-hud-snap');
    snapGroup.appendChild(this.snapBtn);

    const sliceGroup = makeGroup();
    const stepZ = (delta: number): void => {
      const next = Math.max(0, Math.min(MAX_VOXEL_STORIES - 1, this.deps.mapState.activeZLevel + delta));
      if (next === this.deps.mapState.activeZLevel) return;
      this.deps.mapState.activeZLevel = next;
      this.deps.onSliceChanged();
      this.sync();
    };
    this.zDecBtn = makeHudBtn('−', '降低 Z 樓層 ([)', true, signal, () => stepZ(-1));
    this.zLabelEl = document.createElement('span');
    this.zLabelEl.className = 'p7-vp-hud-val p7-mono';
    this.zIncBtn = makeHudBtn('+', '升高 Z 樓層 (])', true, signal, () => stepZ(1));
    this.cutawayBtn = makeHudBtn('全顯', '切換樓層剖切顯示（全顯 / 虛化 / 單層）', false, signal, () => {
      const idx = CUTAWAY_ORDER.indexOf(this.deps.mapState.sliceCutawayMode);
      const next = CUTAWAY_ORDER[(idx + 1) % CUTAWAY_ORDER.length];
      this.deps.mapState.sliceCutawayMode = next;
      this.deps.onSliceChanged(next);
      this.sync();
    }, 'vp-hud-cutaway');
    sliceGroup.append(this.zDecBtn, this.zLabelEl, this.zIncBtn, this.cutawayBtn);

    const utilGroup = makeGroup();
    this.zoomBtn = makeHudBtn('100%', '目前縮放比例，點擊重設視角與縮放 (0 / Home)', true, signal, () => {
      this.deps.onResetCamera();
      this.sync();
    }, 'vp-hud-zoom');
    const cmdBtn = makeHudBtn('⌘K', '快速指令與跳轉面板 (Ctrl+K)', true, signal, () => this.deps.onOpenCommandPalette());
    const helpBtn = makeHudBtn('?', '快捷鍵總覽 (?)', true, signal, () => this.deps.onOpenShortcuts());
    utilGroup.append(this.zoomBtn, cmdBtn, helpBtn);

    this.element.append(toolGroup, layerGroup, gizmoGroup, snapGroup, sliceGroup, utilGroup);
    this.sync();
  }

  public sync(): void {
    const visible = this.deps.isVisible();
    if (this.lastVisible !== visible) {
      this.lastVisible = visible;
      this.element.classList.toggle('panel-hidden', !visible);
    }
    if (!visible) return;

    const ms = this.deps.mapState;
    if (this.lastTool !== ms.tool) {
      this.lastTool = ms.tool;
      for (const [id, btn] of this.toolBtns) btn.classList.toggle('is-active', id === ms.tool);
    }
    const isVoxel = ms.editLayer === 'voxel3d';
    if (this.lastIsVoxel !== isVoxel) {
      this.lastIsVoxel = isVoxel;
      this.layerToggleBtn.textContent = isVoxel ? '3D體素' : '2D';
      this.layerToggleBtn.classList.toggle('is-active', isVoxel);
    }
    if (this.lastGizmo !== ms.gizmoMode) {
      this.lastGizmo = ms.gizmoMode;
      for (const [id, btn] of this.gizmoBtns) btn.classList.toggle('is-active', id === ms.gizmoMode);
    }
    if (this.lastSnap !== ms.snapStep) {
      this.lastSnap = ms.snapStep;
      this.snapBtn.textContent = ms.snapStep > 0 ? `磁吸: ${ms.snapStep}px` : '磁吸: 關';
      this.snapBtn.classList.toggle('is-active', ms.snapStep > 0);
    }
    if (this.lastZ !== ms.activeZLevel) {
      this.lastZ = ms.activeZLevel;
      this.zLabelEl.textContent = `Z${ms.activeZLevel}`;
      this.zDecBtn.disabled = ms.activeZLevel <= 0;
      this.zIncBtn.disabled = ms.activeZLevel >= MAX_VOXEL_STORIES - 1;
    }
    if (this.lastCutaway !== ms.sliceCutawayMode) {
      this.lastCutaway = ms.sliceCutawayMode;
      this.cutawayBtn.textContent = CUTAWAY_LABELS[ms.sliceCutawayMode];
      this.cutawayBtn.classList.toggle('is-active', ms.sliceCutawayMode !== 'all');
    }
    const zoomPct = Math.round(this.deps.getZoom() * 100);
    if (this.lastZoomPct !== zoomPct) {
      this.lastZoomPct = zoomPct;
      this.zoomBtn.textContent = `${zoomPct}%`;
      this.zoomBtn.classList.toggle('is-active', zoomPct !== 100);
    }
  }

  public destroy(): void {
    this.ac.abort();
    this.element.remove();
  }
}
