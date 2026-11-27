import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import type { EcsMapRoomDef } from '../core/ecs/EcsTilemapTypes.ts';
import {
  ECS_VOXEL_SHAPES,
  MAX_VOXEL_STORIES,
  type EcsVoxelShape,
} from '../core/ecs/EcsVoxelVolume.ts';
import type {
  MapDesignerState,
  MapEditLayer,
  MapGizmoMode,
  MapSliceCutawayMode,
  MapToolMode,
} from './EcsMapDesignerPanelTypes.ts';

const STAIR_CYCLE: readonly EcsVoxelShape[] = ['stair_n', 'stair_e', 'stair_s', 'stair_w'];
const SLOPE_CYCLE: readonly EcsVoxelShape[] = ['slope_n', 'slope_e', 'slope_s', 'slope_w'];

/**
 * Pure helper cycling directional 3D voxel shapes (`stair_*` and `slope_*`) clockwise (`1`) or
 * counter-clockwise (`-1`), leaving non-directional shapes (`cube`, `half_slab`, `arch`) unchanged.
 */
export function rotateVoxelShape(shape: EcsVoxelShape, dir: 1 | -1 = 1): EcsVoxelShape {
  const step = dir < 0 ? 3 : 1;
  const stairIdx = STAIR_CYCLE.indexOf(shape);
  if (stairIdx !== -1) return STAIR_CYCLE[(stairIdx + step) % 4];
  const slopeIdx = SLOPE_CYCLE.indexOf(shape);
  if (slopeIdx !== -1) return SLOPE_CYCLE[(slopeIdx + step) % 4];
  return shape;
}

export const MAP_TOOL_BUTTONS: readonly { id: MapToolMode; label: string; title: string }[] = [
  { id: 'select', label: '選取', title: '點選或框選實體並拖曳 3D Gizmo (V)' },
  { id: 'brush', label: '筆刷', title: '拖曳繪製瓦片 (B)' },
  { id: 'rect', label: '矩形', title: '拖曳框選填滿區域 (R)' },
  { id: 'fill', label: '油漆桶', title: '連通區域填色 (G)' },
  { id: 'erase', label: '橡皮擦', title: '清除目前圖層瓦片 (E)' },
  { id: 'eyedropper', label: '吸管', title: '吸取游標下瓦片 (I)' },
  { id: 'pan', label: '平移', title: '中鍵或按住 Space + 左鍵平移 (Space)' },
];

export const MAP_LAYER_BUTTONS: readonly { id: MapEditLayer; label: string }[] = [
  { id: 'ground', label: '地板' },
  { id: 'wall', label: '城牆立面' },
  { id: 'decor', label: '裝飾' },
  { id: 'voxel3d', label: '3D 體素' },
];

const GIZMO_BUTTONS: readonly { id: MapGizmoMode; label: string }[] = [
  { id: 'move', label: '移動' },
  { id: 'rotate', label: '旋轉' },
  { id: 'scale', label: '縮放' },
];

const SNAP_OPTIONS: readonly { step: number; label: string }[] = [
  { step: 0, label: '關閉' },
  { step: 8, label: '8px' },
  { step: 16, label: '16px' },
  { step: 32, label: '32px' },
];

const SLICE_CUTAWAY_BUTTONS: readonly { id: MapSliceCutawayMode; label: string }[] = [
  { id: 'all', label: '全部顯示' },
  { id: 'ghost_above', label: '上層虛化' },
  { id: 'solo_floor', label: '僅當前樓層' },
];

const VOXEL_SHAPE_LABELS: Readonly<Record<EcsVoxelShape, string>> = {
  cube: '方塊 cube',
  half_slab: '半磚 half_slab',
  slope_n: '斜坡北 slope_n',
  slope_e: '斜坡東 slope_e',
  slope_s: '斜坡南 slope_s',
  slope_w: '斜坡西 slope_w',
  stair_n: '階梯北 stair_n',
  stair_e: '階梯東 stair_e',
  stair_s: '階梯南 stair_s',
  stair_w: '階梯西 stair_w',
  arch: '拱門 arch',
};

export interface MapToolsControlCallbacks {
  onStateChange: () => void;
  onEnterEditMode: () => void;
}

function createControlLabel(text: string): HTMLSpanElement {
  const lbl = document.createElement('span');
  lbl.className = 'p7-meta-line';
  lbl.textContent = text;
  return lbl;
}

/**
 * Builds the 3D Z-level floor slicer and voxel shape selector shown for `hd2d_3d` / `voxel3d` editing.
 */
export function buildVoxelSliceControls(
  activeRoom: EcsMapRoomDef,
  session: EcsStudioSession,
  state: MapDesignerState,
  cb: MapToolsControlCallbacks,
): HTMLDivElement {
  const storyH = activeRoom.storyHeight ?? activeRoom.wallExtrudeH ?? 24;
  const zSliceWrap = document.createElement('div');
  zSliceWrap.className = 'p7-slider-group';

  const zHead = document.createElement('div');
  zHead.className = 'p7-section-head';
  const zLabel = document.createElement('span');
  zLabel.className = 'p7-mono';
  zLabel.textContent = `3D 樓層切片 Z = L${state.activeZLevel} (+${state.activeZLevel * storyH}px)`;
  const clearZBtn = document.createElement('button');
  clearZBtn.type = 'button';
  clearZBtn.className = 'p7-btn p7-btn-xs';
  clearZBtn.textContent = '清除此層';
  clearZBtn.addEventListener('click', () => {
    cb.onEnterEditMode();
    session.dispatch({ type: 'clear_room_voxels', roomId: activeRoom.id, zLevel: state.activeZLevel });
  });
  zHead.append(zLabel, clearZBtn);

  const zSlider = document.createElement('input');
  zSlider.type = 'range';
  zSlider.min = '0';
  zSlider.max = String(MAX_VOXEL_STORIES - 1);
  zSlider.step = '1';
  zSlider.value = String(state.activeZLevel);
  zSlider.className = 'p7-range';
  zSlider.dataset.testid = 'z-slice-slider';
  zSlider.setAttribute('aria-label', '3D 體素樓層切片 Z');
  zSlider.addEventListener('input', () => {
    state.activeZLevel = Math.max(0, Math.min(MAX_VOXEL_STORIES - 1, Math.round(Number(zSlider.value) || 0)));
    zLabel.textContent = `3D 樓層切片 Z = L${state.activeZLevel} (+${state.activeZLevel * storyH}px)`;
    cb.onStateChange();
  });

  const shapeSelect = document.createElement('select');
  shapeSelect.className = 'p7-select p7-select-full p7-mono';
  shapeSelect.dataset.testid = 'voxel-shape-select';
  shapeSelect.setAttribute('aria-label', '3D 體素形狀');
  for (const sh of ECS_VOXEL_SHAPES) {
    const o = document.createElement('option');
    o.value = sh;
    o.textContent = VOXEL_SHAPE_LABELS[sh];
    shapeSelect.appendChild(o);
  }
  shapeSelect.value = state.voxelShape;
  shapeSelect.addEventListener('change', () => {
    state.voxelShape = shapeSelect.value as EcsVoxelShape;
    cb.onStateChange();
  });

  zSliceWrap.append(zHead, zSlider, shapeSelect);
  return zSliceWrap;
}

/**
 * Builds compact Workstation 2.0 controls: Gizmo Mode, Grid Snap, 3D Slice Cutaway, and
 * Multi-Story Voxel Quick Tools (Rotate Q + Rect Extrude Stories 1..8).
 */
export function buildWorkstation2ToolsBlock(
  proj: EcsProjectV2,
  state: MapDesignerState,
  cb: MapToolsControlCallbacks,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'p7-slider-group';
  wrap.dataset.testid = 'workstation2-tools';

  // 1. Gizmo Mode (移動 / 旋轉 / 縮放)
  const gizmoSeg = document.createElement('div');
  gizmoSeg.className = 'p7-segmented p7-segmented-full';
  for (const gm of GIZMO_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.gizmoMode === gm.id ? 'p7-seg-btn is-active' : 'p7-seg-btn';
    btn.textContent = gm.label;
    btn.dataset.testid = `gizmo-mode-${gm.id}`;
    btn.addEventListener('click', () => {
      state.gizmoMode = gm.id;
      cb.onEnterEditMode();
      cb.onStateChange();
    });
    gizmoSeg.appendChild(btn);
  }
  wrap.append(createControlLabel('Gizmo 模式'), gizmoSeg);

  // 2. Grid Snap (關閉 / 8px / 16px / 32px)
  const snapSeg = document.createElement('div');
  snapSeg.className = 'p7-segmented p7-segmented-full';
  for (const opt of SNAP_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.snapStep === opt.step ? 'p7-seg-btn is-active' : 'p7-seg-btn';
    btn.textContent = opt.label;
    btn.dataset.testid = `snap-step-${opt.step}`;
    btn.addEventListener('click', () => {
      state.snapStep = opt.step;
      cb.onStateChange();
    });
    snapSeg.appendChild(btn);
  }
  wrap.append(createControlLabel('磁吸對齊'), snapSeg);

  // 3. 3D Floor Slice Cutaway (全部顯示 / 上層虛化 / 僅當前樓層)
  const cutawaySeg = document.createElement('div');
  cutawaySeg.className = 'p7-segmented p7-segmented-full';
  for (const cm of SLICE_CUTAWAY_BUTTONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.sliceCutawayMode === cm.id ? 'p7-seg-btn is-active' : 'p7-seg-btn';
    btn.textContent = cm.label;
    btn.dataset.testid = `slice-cutaway-${cm.id}`;
    btn.addEventListener('click', () => {
      state.sliceCutawayMode = cm.id;
      cb.onStateChange();
    });
    cutawaySeg.appendChild(btn);
  }
  wrap.append(createControlLabel('3D 樓層剖面檢視'), cutawaySeg);

  // 4. Voxel Quick Tools (Rotate Q + Rect Extrude Stories 1..8)
  if (proj.projection?.mode === 'hd2d_3d' || state.editLayer === 'voxel3d') {
    const voxelRow = document.createElement('div');
    voxelRow.className = 'p7-section-head';
    voxelRow.dataset.testid = 'voxel-quick-tools';

    const rotBtn = document.createElement('button');
    rotBtn.type = 'button';
    rotBtn.className = 'p7-btn p7-btn-xs';
    rotBtn.textContent = '旋轉 Q';
    rotBtn.title = `順時針旋轉階梯/斜坡朝向 (目前：${state.voxelShape}，快捷鍵 Q / Shift+Q)`;
    rotBtn.dataset.testid = 'voxel-rotate-btn';
    rotBtn.addEventListener('click', () => {
      state.voxelShape = rotateVoxelShape(state.voxelShape, 1);
      cb.onEnterEditMode();
      cb.onStateChange();
    });

    const stepper = document.createElement('div');
    stepper.className = 'p7-toolbar-group';

    const stepLbl = document.createElement('span');
    stepLbl.className = 'p7-meta-line';
    stepLbl.textContent = '拉高層數';

    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = 'p7-btn p7-btn-xs';
    decBtn.textContent = '−';
    decBtn.title = '減少矩形拉高層數';
    decBtn.disabled = state.extrudeStories <= 1;
    decBtn.dataset.testid = 'voxel-extrude-dec';
    decBtn.addEventListener('click', () => {
      state.extrudeStories = Math.max(1, state.extrudeStories - 1);
      cb.onStateChange();
    });

    const valEl = document.createElement('span');
    valEl.className = 'p7-mono p7-slider-val';
    valEl.textContent = `${state.extrudeStories} 層`;
    valEl.dataset.testid = 'voxel-extrude-val';

    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'p7-btn p7-btn-xs';
    incBtn.textContent = '+';
    incBtn.title = '增加矩形拉高層數 (最多 8 層)';
    incBtn.disabled = state.extrudeStories >= MAX_VOXEL_STORIES;
    incBtn.dataset.testid = 'voxel-extrude-inc';
    incBtn.addEventListener('click', () => {
      state.extrudeStories = Math.min(MAX_VOXEL_STORIES, state.extrudeStories + 1);
      cb.onStateChange();
    });

    stepper.append(stepLbl, decBtn, valEl, incBtn);
    voxelRow.append(rotBtn, stepper);
    wrap.append(createControlLabel('體素快速工具'), voxelRow);
  }

  return wrap;
}
