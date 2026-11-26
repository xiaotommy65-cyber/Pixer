import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import {
  emitModel3DToGpu,
  validateModel3DDef,
  type EcsCuboidFacesDef,
  type EcsCuboidPartDef,
  type EcsModel3DAnimClip,
  type EcsModel3DDef,
  type EcsRawMesh3DData,
} from '../core/ecs/EcsModel3D.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import { GpuEngine } from '../core/gpu/GpuEngine.ts';
import {
  buildSampleBbmodelJson,
  parseBbmodelToModel3D,
} from '../core/interop/BbmodelImporter.ts';
import {
  buildSampleGlbCube,
  parseGlbToModel3D,
  type ImportedModel3DDef,
} from '../core/interop/GlbImporter.ts';
import { sanitizeInteropId } from '../core/interop/InteropTypes.ts';
import type { Camera3DProjectionMode } from '../core/math/Perspective3DMath.ts';

export interface ModelAtelierModalCallbacks {
  atlas: TextureAtlas;
  getProject: () => EcsProjectV2;
  getSpriteOptions: (proj: EcsProjectV2) => readonly { id: SpriteId; label: string }[];
  onSaveModel3D: (model: EcsModel3DDef) => void;
  onDeleteModel3D?: (modelId: string) => void;
  onSpawnModelEntity?: (modelId: string) => void;
}

type ProjectWithModels3D = EcsProjectV2 & {
  models3d?: Record<string, EcsModel3DDef>;
};

type ModelViewMode = Camera3DProjectionMode | 'quad';

interface MutableCuboidPart {
  id: string;
  parentId?: string;
  origin: [number, number, number];
  size: [number, number, number];
  pivot: [number, number, number];
  rotDeg: [number, number, number];
  faces: EcsCuboidFacesDef;
  tint: string;
  alpha: number;
  paletteRow: number;
  roughness: number;
  metallic: number;
  emissive: number;
}

interface MutableModel3D {
  id: string;
  name: string;
  parts: MutableCuboidPart[];
  rawMesh?: EcsRawMesh3DData;
  clips?: readonly EcsModel3DAnimClip[];
  boundsSize?: [number, number, number];
}

const FACE_SLOTS: readonly { key: keyof EcsCuboidFacesDef; label: string }[] = [
  { key: 'top', label: '頂面 (Top +Z)' },
  { key: 'bottom', label: '底面 (Bottom -Z)' },
  { key: 'north', label: '北面 (North -Y)' },
  { key: 'south', label: '南面 (South +Y)' },
  { key: 'east', label: '東面 (East +X)' },
  { key: 'west', label: '西面 (West -X)' },
  { key: 'side', label: '側面通用 (Side)' },
];

const VIEW_MODE_BUTTONS: readonly { mode: ModelViewMode; label: string }[] = [
  { mode: 'perspective', label: '3D 透視' },
  { mode: 'ortho_top', label: '頂視 XY' },
  { mode: 'ortho_front', label: '前視 XZ' },
  { mode: 'ortho_side', label: '側視 YZ' },
  { mode: 'ortho_iso', label: '等軸' },
  { mode: 'quad', label: '四視圖' },
];

const CANVAS_W = 480;
const CANVAS_H = 360;
const DEFAULT_YAW_DEG = -32;
const DEFAULT_PITCH_DEG = 34;
const DEFAULT_ZOOM = 5.5;

function cloneRawMesh(raw: EcsRawMesh3DData | ImportedModel3DDef['rawMesh']): EcsRawMesh3DData | undefined {
  if (!raw) return undefined;
  return {
    positions:
      raw.positions instanceof Float32Array ? new Float32Array(raw.positions) : [...raw.positions],
    normals: raw.normals instanceof Float32Array ? new Float32Array(raw.normals) : [...raw.normals],
    uvs:
      raw.uvs == null
        ? undefined
        : raw.uvs instanceof Float32Array
          ? new Float32Array(raw.uvs)
          : [...raw.uvs],
    indices:
      raw.indices instanceof Uint32Array
        ? new Uint32Array(raw.indices)
        : raw.indices instanceof Uint16Array
          ? new Uint16Array(raw.indices)
          : [...raw.indices],
    spriteId: raw.spriteId ?? undefined,
    tint: raw.tint,
    alpha: raw.alpha,
    paletteRow: 'paletteRow' in raw ? raw.paletteRow : -1,
    roughness: raw.roughness,
    metallic: raw.metallic,
    emissive: raw.emissive,
  };
}

function toMutableModel(src: EcsModel3DDef | ImportedModel3DDef): MutableModel3D {
  const parts: MutableCuboidPart[] = src.parts.map((p, idx) => {
    const ox = p.origin[0];
    const oy = p.origin[1];
    const oz = p.origin[2];
    const sx = p.size[0];
    const sy = p.size[1];
    const sz = p.size[2];
    const rawFaces = p.faces as EcsCuboidFacesDef & { all?: SpriteId | null };
    const allFallback = rawFaces.all ?? null;
    const faces: EcsCuboidFacesDef = {
      top: rawFaces.top ?? allFallback,
      bottom: rawFaces.bottom ?? allFallback,
      side: rawFaces.side ?? allFallback,
      ...(rawFaces.north !== undefined ? { north: rawFaces.north } : {}),
      ...(rawFaces.south !== undefined ? { south: rawFaces.south } : {}),
      ...(rawFaces.east !== undefined ? { east: rawFaces.east } : {}),
      ...(rawFaces.west !== undefined ? { west: rawFaces.west } : {}),
    };
    return {
      id: p.id || `part_${idx + 1}`,
      ...(p.parentId ? { parentId: p.parentId } : {}),
      origin: [ox, oy, oz],
      size: [sx, sy, sz],
      pivot: p.pivot
        ? [p.pivot[0], p.pivot[1], p.pivot[2]]
        : [ox + sx * 0.5, oy + sy * 0.5, oz + sz * 0.5],
      rotDeg: p.rotDeg ? [p.rotDeg[0], p.rotDeg[1], p.rotDeg[2]] : [0, 0, 0],
      faces,
      tint: p.tint ?? '#ffffff',
      alpha: p.alpha ?? 1,
      paletteRow: 'paletteRow' in p && typeof p.paletteRow === 'number' ? p.paletteRow : -1,
      roughness: p.roughness ?? 0.58,
      metallic: p.metallic ?? 0.08,
      emissive: p.emissive ?? 0,
    };
  });

  return {
    id: sanitizeInteropId(src.id, 'model_3d'),
    name: src.name || src.id || '3D 積木模型',
    parts,
    ...(src.rawMesh ? { rawMesh: cloneRawMesh(src.rawMesh) } : {}),
    ...(src.clips ? { clips: JSON.parse(JSON.stringify(src.clips)) as EcsModel3DAnimClip[] } : {}),
    ...(src.boundsSize
      ? { boundsSize: [src.boundsSize[0], src.boundsSize[1], src.boundsSize[2]] }
      : {}),
  };
}

function toImmutableModel(src: MutableModel3D): EcsModel3DDef {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const parts: EcsCuboidPartDef[] = src.parts.map((p) => {
    const x0 = p.origin[0];
    const y0 = p.origin[1];
    const z0 = p.origin[2];
    const x1 = x0 + p.size[0];
    const y1 = y0 + p.size[1];
    const z1 = z0 + p.size[2];
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (z0 < minZ) minZ = z0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
    if (z1 > maxZ) maxZ = z1;

    const faces: EcsCuboidFacesDef = {};
    if (p.faces.top) faces.top = p.faces.top;
    if (p.faces.bottom) faces.bottom = p.faces.bottom;
    if (p.faces.side) faces.side = p.faces.side;
    if (p.faces.north) faces.north = p.faces.north;
    if (p.faces.south) faces.south = p.faces.south;
    if (p.faces.east) faces.east = p.faces.east;
    if (p.faces.west) faces.west = p.faces.west;

    return {
      id: p.id,
      ...(p.parentId ? { parentId: p.parentId } : {}),
      origin: [p.origin[0], p.origin[1], p.origin[2]],
      size: [p.size[0], p.size[1], p.size[2]],
      pivot: [p.pivot[0], p.pivot[1], p.pivot[2]],
      rotDeg: [p.rotDeg[0], p.rotDeg[1], p.rotDeg[2]],
      faces,
      tint: p.tint,
      alpha: p.alpha,
      paletteRow: p.paletteRow,
      roughness: p.roughness,
      metallic: p.metallic,
      emissive: p.emissive,
    };
  });

  const boundsSize: [number, number, number] =
    parts.length > 0
      ? [
          Math.max(1, maxX - minX),
          Math.max(1, maxY - minY),
          Math.max(1, maxZ - minZ),
        ]
      : src.boundsSize
        ? [src.boundsSize[0], src.boundsSize[1], src.boundsSize[2]]
        : [16, 16, 16];

  return {
    id: sanitizeInteropId(src.id, 'model_3d'),
    name: src.name.trim() || src.id || '3D 積木模型',
    parts,
    ...(src.rawMesh ? { rawMesh: cloneRawMesh(src.rawMesh) } : {}),
    ...(src.clips ? { clips: JSON.parse(JSON.stringify(src.clips)) as EcsModel3DAnimClip[] } : {}),
    boundsSize,
  };
}

function createDefaultCuboidModel(id: string, name: string, primarySprite: SpriteId, capSprite: SpriteId): MutableModel3D {
  return {
    id: sanitizeInteropId(id, 'cuboid_model_01'),
    name,
    parts: [
      {
        id: 'base_plinth',
        origin: [-8, -8, 0],
        size: [16, 16, 6],
        pivot: [0, 0, 3],
        rotDeg: [0, 0, 0],
        faces: {
          top: primarySprite,
          bottom: primarySprite,
          side: primarySprite,
        },
        tint: '#cbd5e1',
        alpha: 1,
        paletteRow: -1,
        roughness: 0.68,
        metallic: 0.12,
        emissive: 0,
      },
      {
        id: 'upper_crate',
        origin: [-6, -6, 6],
        size: [12, 12, 12],
        pivot: [0, 0, 12],
        rotDeg: [0, 0, 0],
        faces: {
          top: capSprite,
          bottom: capSprite,
          side: capSprite,
        },
        tint: '#f59e0b',
        alpha: 1,
        paletteRow: -1,
        roughness: 0.52,
        metallic: 0.18,
        emissive: 0,
      },
    ],
    boundsSize: [16, 16, 18],
  };
}

function makeButton(cls: string, text: string, title?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  if (title) b.title = title;
  return b;
}

/**
 * Phase C Blockbench-Style 3D Model Atelier Modal:
 * Multi-part cuboid modeling, 6-face TextureAtlas mapping, `.glb` / `.bbmodel` import,
 * 4-view quad-split & orbit preview rendered lazily via `GpuEngine`.
 */
export class ModelAtelierModalView {
  public readonly element: HTMLDivElement;

  private readonly ac = new AbortController();
  private readonly callbacks: ModelAtelierModalCallbacks;

  private readonly modelSelect: HTMLSelectElement;
  private readonly fileInput: HTMLInputElement;
  private readonly partsListEl: HTMLDivElement;
  private readonly viewBarBtns = new Map<ModelViewMode, HTMLButtonElement>();
  private readonly canvasHostEl: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private readonly statusLineEl: HTMLDivElement;
  private readonly rightPanelEl: HTMLDivElement;
  private readonly footerStatusEl: HTMLDivElement;

  private previewGpu: GpuEngine | null = null;
  private gpuInitialized = false;
  private rafId = 0;
  private destroyed = false;

  private activeModel: MutableModel3D;
  private selectedPartIdx = 0;
  private viewMode: ModelViewMode = 'perspective';
  private previewYawDeg = DEFAULT_YAW_DEG;
  private previewPitchDeg = DEFAULT_PITCH_DEG;
  private previewZoom = DEFAULT_ZOOM;

  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastStatusText = '';
  private importNotice = '';

  constructor(callbacks: ModelAtelierModalCallbacks) {
    this.callbacks = callbacks;
    const { signal } = this.ac;

    const proj = this.callbacks.getProject();
    const spriteOpts = this.callbacks.getSpriteOptions(proj);
    const defaultSprite = spriteOpts[0]?.id ?? 'brick';
    const altSprite = spriteOpts[1]?.id ?? defaultSprite;
    this.activeModel = createDefaultCuboidModel('cuboid_model_01', '積木模型 01', defaultSprite, altSprite);

    this.element = document.createElement('div');
    this.element.className = 'p7-model-atelier-backdrop';
    this.element.dataset.testid = 'model-atelier-modal';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', '3D 積木模型工坊 (Model Atelier)');

    const dialog = document.createElement('div');
    dialog.className = 'p7-model-atelier-dialog';

    // Header
    const header = document.createElement('div');
    header.className = 'p7-model-atelier-header';
    const titleEl = document.createElement('h2');
    titleEl.className = 'p7-section-title';
    titleEl.textContent = '3D 積木模型工坊 (Model Atelier)';
    const closeBtn = makeButton('p7-btn p7-btn-xs', '關閉 (Esc)');
    closeBtn.addEventListener('click', () => this.close(), { signal });
    header.append(titleEl, closeBtn);

    // 3-Column Body
    const body = document.createElement('div');
    body.className = 'p7-model-atelier-body';

    // Left Panel: Model library + Importers + Cuboid Parts
    const left = document.createElement('div');
    left.className = 'p7-model-atelier-left';

    const modelLabel = document.createElement('div');
    modelLabel.className = 'p7-section-title';
    modelLabel.textContent = '專案 3D 模型';

    this.modelSelect = document.createElement('select');
    this.modelSelect.className = 'p7-select';
    this.modelSelect.setAttribute('aria-label', '選擇專案 3D 模型');
    this.modelSelect.addEventListener(
      'change',
      () => {
        const chosenId = this.modelSelect.value;
        const models = this.getProjectModelsMap();
        if (models[chosenId]) {
          this.loadExistingModel(models[chosenId]);
        }
      },
      { signal },
    );

    const modelActions = document.createElement('div');
    modelActions.className = 'p7-prefab-actions';
    const newModelBtn = makeButton('p7-btn p7-btn-xs p7-btn-accent', '+ 新建積木模型');
    newModelBtn.addEventListener('click', () => this.handleCreateNewModel(), { signal });
    const delModelBtn = makeButton('p7-btn p7-btn-xs p7-btn-danger', '刪除模型');
    delModelBtn.addEventListener('click', () => this.handleDeleteActiveModel(), { signal });
    modelActions.append(newModelBtn, delModelBtn);

    // Import controls
    const importTitle = document.createElement('div');
    importTitle.className = 'p7-section-title';
    importTitle.textContent = '.glb / .bbmodel 匯入';

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.glb,.bbmodel,.json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener(
      'change',
      () => {
        const file = this.fileInput.files?.[0];
        if (file) {
          void this.handleImportFile(file);
          this.fileInput.value = '';
        }
      },
      { signal },
    );

    const importFileBtn = makeButton('p7-btn p7-btn-xs', '匯入 .glb / .bbmodel');
    importFileBtn.dataset.testid = 'model-atelier-import-file';
    importFileBtn.addEventListener('click', () => this.fileInput.click(), { signal });

    const sampleGlbBtn = makeButton('p7-btn p7-btn-xs', '載入範例 .glb');
    sampleGlbBtn.addEventListener('click', () => this.handleLoadSampleGlb(), { signal });

    const sampleBbBtn = makeButton('p7-btn p7-btn-xs', '載入範例 .bbmodel');
    sampleBbBtn.addEventListener('click', () => this.handleLoadSampleBbmodel(), { signal });

    const importActions = document.createElement('div');
    importActions.className = 'p7-prefab-actions';
    importActions.append(importFileBtn, sampleGlbBtn, sampleBbBtn);

    // Parts list controls
    const partsTitle = document.createElement('div');
    partsTitle.className = 'p7-section-title';
    partsTitle.textContent = '積木方塊部件 (Parts)';

    const partBtns = document.createElement('div');
    partBtns.className = 'p7-prefab-actions';
    const addPartBtn = makeButton('p7-btn p7-btn-xs p7-btn-accent', '+ 新增方塊');
    addPartBtn.addEventListener('click', () => this.handleAddPart(), { signal });
    const dupPartBtn = makeButton('p7-btn p7-btn-xs', '複製方塊');
    dupPartBtn.addEventListener('click', () => this.handleDuplicatePart(), { signal });
    const delPartBtn = makeButton('p7-btn p7-btn-xs p7-btn-danger', '刪除方塊');
    delPartBtn.addEventListener('click', () => this.handleDeletePart(), { signal });
    partBtns.append(addPartBtn, dupPartBtn, delPartBtn);

    this.partsListEl = document.createElement('div');
    this.partsListEl.className = 'p7-model-atelier-parts';

    left.append(
      modelLabel,
      this.modelSelect,
      modelActions,
      importTitle,
      this.fileInput,
      importActions,
      partsTitle,
      partBtns,
      this.partsListEl,
    );

    // Center Panel: View Bar + Live 3D GPU Canvas + Status
    const center = document.createElement('div');
    center.className = 'p7-model-atelier-center';

    const viewBar = document.createElement('div');
    viewBar.className = 'p7-model-atelier-viewbar';
    for (const def of VIEW_MODE_BUTTONS) {
      const b = makeButton('p7-seg-btn', def.label);
      b.addEventListener(
        'click',
        () => {
          this.setViewMode(def.mode);
        },
        { signal },
      );
      this.viewBarBtns.set(def.mode, b);
      viewBar.appendChild(b);
    }
    const resetViewBtn = makeButton('p7-btn p7-btn-xs', '重設視角');
    resetViewBtn.addEventListener('click', () => this.resetCameraView(), { signal });
    viewBar.appendChild(resetViewBtn);

    this.canvasHostEl = document.createElement('div');
    this.canvasHostEl.className = 'p7-canvas-frame';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'p7-model-atelier-canvas';
    this.canvas.dataset.testid = 'model-atelier-canvas';
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.bindCanvasEvents(this.canvas);
    this.canvasHostEl.appendChild(this.canvas);

    this.statusLineEl = document.createElement('div');
    this.statusLineEl.className = 'p7-meta-line p7-mono';
    this.statusLineEl.textContent = '模型就緒';

    center.append(viewBar, this.canvasHostEl, this.statusLineEl);

    // Right Panel: Model Meta + Part Transform/Material/6-Face Inspector
    this.rightPanelEl = document.createElement('div');
    this.rightPanelEl.className = 'p7-model-atelier-right';

    body.append(left, center, this.rightPanelEl);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'p7-model-atelier-footer';

    this.footerStatusEl = document.createElement('div');
    this.footerStatusEl.className = 'p7-meta-line';
    this.footerStatusEl.textContent = '拖曳畫布旋轉視角 · 滾輪縮放 · 支援 6 面 TextureAtlas 貼圖';

    const footerActions = document.createElement('div');
    footerActions.className = 'p7-head-actions';

    const spawnBtn = makeButton('p7-btn', '在房間生成實體');
    spawnBtn.addEventListener('click', () => this.handleSpawnInRoom(), { signal });

    const saveBtn = makeButton('p7-primary-cta', '套用並儲存至專案');
    saveBtn.dataset.testid = 'model-atelier-save';
    saveBtn.addEventListener('click', () => this.handleSaveModel(), { signal });

    footerActions.append(spawnBtn, saveBtn);
    footer.append(this.footerStatusEl, footerActions);

    dialog.append(header, body, footer);
    this.element.appendChild(dialog);

    // Backdrop click & Escape key close
    this.element.addEventListener(
      'click',
      (e) => {
        if (e.target === this.element) {
          this.close();
        }
      },
      { signal },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && !this.element.hidden) {
          this.close();
        }
      },
      { signal },
    );

    this.syncViewBarActive();
  }

  private bindCanvasEvents(target: HTMLCanvasElement): void {
    const { signal } = this.ac;

    target.addEventListener(
      'pointerdown',
      (e) => {
        this.dragging = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          // Ignore synthetic pointer events in tests
        }
      },
      { signal },
    );

    target.addEventListener(
      'pointermove',
      (e) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;

        if (
          this.viewMode === 'ortho_top' ||
          this.viewMode === 'ortho_front' ||
          this.viewMode === 'ortho_side' ||
          this.viewMode === 'ortho_iso'
        ) {
          this.viewMode = 'perspective';
          this.syncViewBarActive();
        }

        this.previewYawDeg = (this.previewYawDeg + dx * 0.65) % 360;
        this.previewPitchDeg = Math.max(-85, Math.min(85, this.previewPitchDeg + dy * 0.55));
      },
      { signal },
    );

    const stopDrag = (): void => {
      this.dragging = false;
    };
    target.addEventListener('pointerup', stopDrag, { signal });
    target.addEventListener('pointercancel', stopDrag, { signal });

    target.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        this.previewZoom = Math.max(0.8, Math.min(20, this.previewZoom * factor));
      },
      { signal, passive: false },
    );
  }

  private getProjectModelsMap(): Record<string, EcsModel3DDef> {
    const proj = this.callbacks.getProject() as ProjectWithModels3D;
    return proj.models3d ?? {};
  }

  private getDefaultSprites(): [SpriteId, SpriteId] {
    const opts = this.callbacks.getSpriteOptions(this.callbacks.getProject());
    const first = opts[0]?.id ?? 'brick';
    const second = opts[1]?.id ?? first;
    return [first, second];
  }

  public isOpen(): boolean {
    return !this.destroyed && !this.element.hidden;
  }

  public open(initialModelId?: string): void {
    if (this.destroyed) return;
    this.element.hidden = false;

    const models = this.getProjectModelsMap();
    const keys = Object.keys(models);
    if (initialModelId && models[initialModelId]) {
      this.loadExistingModel(models[initialModelId]);
    } else if (keys.length > 0) {
      this.loadExistingModel(models[keys[0]]);
    } else {
      const [s0, s1] = this.getDefaultSprites();
      this.activeModel = createDefaultCuboidModel('cuboid_model_01', '積木模型 01', s0, s1);
      this.selectedPartIdx = 0;
      this.importNotice = '';
      this.refreshAllUi();
    }

    this.ensurePreviewGpuInit();
    this.startRaf();
  }

  public close(): void {
    this.stopRaf();
    this.dragging = false;
    this.element.hidden = true;
  }

  public destroy(): void {
    this.destroyed = true;
    this.stopRaf();
    this.ac.abort();
    this.previewGpu?.dispose();
    this.previewGpu = null;
    this.gpuInitialized = false;
    this.element.remove();
  }

  private ensurePreviewGpuInit(): void {
    if (!this.previewGpu) {
      this.previewGpu = new GpuEngine(
        this.canvas,
        (_kind, nextCanvas) => {
          if (nextCanvas && nextCanvas !== this.canvas) {
            nextCanvas.dataset.testid = 'model-atelier-canvas';
            this.canvas = nextCanvas;
            this.bindCanvasEvents(nextCanvas);
          }
        },
        this.callbacks.atlas,
      );
      this.previewGpu.setLogicalViewport(CANVAS_W, CANVAS_H);
      this.previewGpu.resize(CANVAS_W, CANVAS_H);
    }

    if (this.gpuInitialized) {
      this.previewGpu.syncAtlasToGpu();
      return;
    }

    this.gpuInitialized = true;
    const gpu = this.previewGpu;
    void gpu.init().then(() => {
      if (this.destroyed || this.previewGpu !== gpu) return;
      gpu.setLogicalViewport(CANVAS_W, CANVAS_H);
      gpu.resize(CANVAS_W, CANVAS_H);
      gpu.syncAtlasToGpu();
    });
  }

  private startRaf(): void {
    if (this.rafId !== 0 || this.destroyed || this.element.hidden) return;
    const tick = (nowMs: number): void => {
      this.rafId = 0;
      if (this.destroyed || this.element.hidden) return;
      this.renderPreviewFrame(nowMs);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private computeModelCenterZ(): number {
    if (this.activeModel.parts.length > 0) {
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of this.activeModel.parts) {
        if (p.origin[2] < minZ) minZ = p.origin[2];
        if (p.origin[2] + p.size[2] > maxZ) maxZ = p.origin[2] + p.size[2];
      }
      if (Number.isFinite(minZ) && Number.isFinite(maxZ)) {
        return Math.max(4, Math.min(48, (minZ + maxZ) * 0.5));
      }
    }
    if (this.activeModel.boundsSize) {
      return Math.max(4, Math.min(48, this.activeModel.boundsSize[2] * 0.5));
    }
    return 12;
  }

  private renderPreviewFrame(nowMs: number): void {
    const gpu = this.previewGpu;
    if (!gpu || !gpu.hasBackend()) return;

    gpu.beginFrame('#0f172a', '#1e293b', false, 0, 0, 0, 0);
    gpu.setQuadViewEnabled(this.viewMode === 'quad');

    const projMode: Camera3DProjectionMode =
      this.viewMode === 'quad' ? 'perspective' : this.viewMode;
    const centerZ = this.computeModelCenterZ();

    gpu.setCamera3D(
      0,
      0,
      this.previewZoom,
      this.previewPitchDeg,
      38,
      0,
      0,
      32,
      this.previewYawDeg,
      0,
      centerZ,
      projMode,
    );
    gpu.setSunLight3D(0.55, 0.45, 0.85, true, 0.42);
    gpu.drawOrthoGrid3D(-64, -64, 64, 64, 0, 16, 4);
    gpu.drawAxisGizmo3D(0, 0, 0.4, 36);
    gpu.pushDynamicLight3D(40, 48, 64, 220, '#fff3d6', 1.2, 1.8);
    emitModel3DToGpu(gpu, this.activeModel, 0, 0, 0);

    const stats = gpu.flush(nowMs * 0.001);
    const meshStats = gpu.getMesh3DStats();
    const rawVerts = this.activeModel.rawMesh
      ? Math.floor(this.activeModel.rawMesh.positions.length / 3)
      : 0;
    const vertCount = Math.max(meshStats.opaqueVertices + meshStats.alphaVertices, rawVerts);
    const fallbackNote = gpu.supports3D() ? '' : ' [2D 保底模式]';
    const nextStatus =
      `模型 ${this.activeModel.id} · 部件 ${this.activeModel.parts.length} · 頂點 ${vertCount}` +
      ` · 視角 ${this.viewMode} (${Math.round(this.previewYawDeg)}°/${Math.round(this.previewPitchDeg)}° x${this.previewZoom.toFixed(1)})` +
      ` · ${stats.backend}${fallbackNote}`;

    if (nextStatus !== this.lastStatusText) {
      this.lastStatusText = nextStatus;
      this.statusLineEl.textContent = nextStatus;
    }
  }

  private setViewMode(mode: ModelViewMode): void {
    this.viewMode = mode;
    if (mode === 'ortho_top') {
      this.previewYawDeg = 0;
      this.previewPitchDeg = 90;
    } else if (mode === 'ortho_front') {
      this.previewYawDeg = 0;
      this.previewPitchDeg = 0;
    } else if (mode === 'ortho_side') {
      this.previewYawDeg = 90;
      this.previewPitchDeg = 0;
    } else if (mode === 'ortho_iso') {
      this.previewYawDeg = 45;
      this.previewPitchDeg = 35.26;
    }
    this.syncViewBarActive();
  }

  private resetCameraView(): void {
    this.viewMode = 'perspective';
    this.previewYawDeg = DEFAULT_YAW_DEG;
    this.previewPitchDeg = DEFAULT_PITCH_DEG;
    this.previewZoom = DEFAULT_ZOOM;
    this.syncViewBarActive();
  }

  private syncViewBarActive(): void {
    for (const [mode, b] of this.viewBarBtns) {
      b.classList.toggle('is-active', mode === this.viewMode);
    }
  }

  private loadExistingModel(def: EcsModel3DDef): void {
    this.activeModel = toMutableModel(def);
    this.selectedPartIdx = this.activeModel.parts.length > 0 ? 0 : -1;
    this.importNotice = '';
    this.refreshAllUi();
  }

  private handleCreateNewModel(): void {
    const models = this.getProjectModelsMap();
    let idx = Object.keys(models).length + 1;
    let id = `cuboid_model_${String(idx).padStart(2, '0')}`;
    while (models[id]) {
      idx++;
      id = `cuboid_model_${String(idx).padStart(2, '0')}`;
    }
    const [s0, s1] = this.getDefaultSprites();
    this.activeModel = createDefaultCuboidModel(id, `積木模型 ${idx}`, s0, s1);
    this.selectedPartIdx = 0;
    this.importNotice = `已新建模型 ${id}`;
    this.refreshAllUi();
  }

  private handleDeleteActiveModel(): void {
    const id = this.activeModel.id;
    const models = this.getProjectModelsMap();
    if (models[id]) {
      this.callbacks.onDeleteModel3D?.(id);
    }
    const remaining = Object.values(this.getProjectModelsMap()).filter((m) => m.id !== id);
    if (remaining.length > 0) {
      this.loadExistingModel(remaining[0]);
    } else {
      const [s0, s1] = this.getDefaultSprites();
      this.activeModel = createDefaultCuboidModel('cuboid_model_01', '積木模型 01', s0, s1);
      this.selectedPartIdx = 0;
      this.importNotice = `已移除模型 ${id}`;
      this.refreshAllUi();
    }
  }

  private async handleImportFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'imported_model';
    const [defaultSprite] = this.getDefaultSprites();
    try {
      if (lower.endsWith('.glb')) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const res = parseGlbToModel3D(buf, {
          modelId: sanitizeInteropId(baseName, 'glb_model'),
          name: baseName,
          targetHeightPx: 32,
          spriteId: defaultSprite,
        });
        this.activeModel = toMutableModel(res.model);
        this.selectedPartIdx = this.activeModel.parts.length > 0 ? 0 : -1;
        const warn = res.warnings.length > 0 ? ` (${res.warnings[0]})` : '';
        this.importNotice = `已匯入 GLB：${res.stats.vertexCount} 頂點 / ${res.stats.triangleCount} 三角面${warn}`;
      } else {
        const text = await file.text();
        const res = parseBbmodelToModel3D(text, {
          modelId: sanitizeInteropId(baseName, 'bbmodel_prop'),
          name: baseName,
          defaultSpriteId: defaultSprite,
        });
        this.activeModel = toMutableModel(res.model);
        this.selectedPartIdx = this.activeModel.parts.length > 0 ? 0 : -1;
        const warn = res.warnings.length > 0 ? ` (${res.warnings[0]})` : '';
        this.importNotice = `已匯入 BBModel：${res.partCount} 個方塊${warn}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.importNotice = `匯入失敗：${msg}`;
    }
    this.refreshAllUi();
  }

  private handleLoadSampleGlb(): void {
    const [defaultSprite] = this.getDefaultSprites();
    const res = parseGlbToModel3D(buildSampleGlbCube(), {
      modelId: 'sample_glb_cube',
      name: '範例 GLB 立方體',
      targetHeightPx: 28,
      spriteId: defaultSprite,
    });
    this.activeModel = toMutableModel(res.model);
    this.selectedPartIdx = -1;
    this.importNotice = `已載入範例 .glb（${res.stats.vertexCount} 頂點 / ${res.stats.triangleCount} 三角面）`;
    this.refreshAllUi();
  }

  private handleLoadSampleBbmodel(): void {
    const [defaultSprite] = this.getDefaultSprites();
    const res = parseBbmodelToModel3D(buildSampleBbmodelJson(), {
      defaultSpriteId: defaultSprite,
    });
    this.activeModel = toMutableModel(res.model);
    this.selectedPartIdx = this.activeModel.parts.length > 0 ? 0 : -1;
    this.importNotice = `已載入範例 .bbmodel（${res.partCount} 個積木方塊）`;
    this.refreshAllUi();
  }

  private handleAddPart(): void {
    const [defaultSprite] = this.getDefaultSprites();
    let idx = this.activeModel.parts.length + 1;
    const used = new Set(this.activeModel.parts.map((p) => p.id));
    let id = `part_${idx}`;
    while (used.has(id)) {
      idx++;
      id = `part_${idx}`;
    }
    this.activeModel.parts.push({
      id,
      origin: [-4, -4, 0],
      size: [8, 8, 8],
      pivot: [0, 0, 4],
      rotDeg: [0, 0, 0],
      faces: {
        top: defaultSprite,
        bottom: defaultSprite,
        side: defaultSprite,
      },
      tint: '#ffffff',
      alpha: 1,
      paletteRow: -1,
      roughness: 0.58,
      metallic: 0.08,
      emissive: 0,
    });
    this.selectedPartIdx = this.activeModel.parts.length - 1;
    this.refreshAllUi();
  }

  private handleDuplicatePart(): void {
    const src = this.activeModel.parts[this.selectedPartIdx];
    if (!src) return;
    const used = new Set(this.activeModel.parts.map((p) => p.id));
    let suffix = 2;
    let id = `${src.id}_copy`;
    while (used.has(id)) {
      id = `${src.id}_copy_${suffix++}`;
    }
    const clone: MutableCuboidPart = {
      id,
      ...(src.parentId ? { parentId: src.parentId } : {}),
      origin: [src.origin[0] + 2, src.origin[1] + 2, src.origin[2]],
      size: [src.size[0], src.size[1], src.size[2]],
      pivot: [src.pivot[0] + 2, src.pivot[1] + 2, src.pivot[2]],
      rotDeg: [src.rotDeg[0], src.rotDeg[1], src.rotDeg[2]],
      faces: { ...src.faces },
      tint: src.tint,
      alpha: src.alpha,
      paletteRow: src.paletteRow,
      roughness: src.roughness,
      metallic: src.metallic,
      emissive: src.emissive,
    };
    this.activeModel.parts.push(clone);
    this.selectedPartIdx = this.activeModel.parts.length - 1;
    this.refreshAllUi();
  }

  private handleDeletePart(): void {
    if (this.selectedPartIdx < 0 || this.selectedPartIdx >= this.activeModel.parts.length) return;
    this.activeModel.parts.splice(this.selectedPartIdx, 1);
    if (this.activeModel.parts.length === 0) {
      this.selectedPartIdx = -1;
    } else if (this.selectedPartIdx >= this.activeModel.parts.length) {
      this.selectedPartIdx = this.activeModel.parts.length - 1;
    }
    this.refreshAllUi();
  }

  private handleSaveModel(): EcsModel3DDef | null {
    const cloned = toImmutableModel(this.activeModel);
    const errors = validateModel3DDef(cloned, cloned.id);
    if (errors.length > 0) {
      this.importNotice = `儲存驗證失敗：${errors[0]}`;
      this.footerStatusEl.textContent = this.importNotice;
      return null;
    }
    this.activeModel.id = cloned.id;
    this.activeModel.name = cloned.name;
    this.callbacks.onSaveModel3D(cloned);
    this.importNotice = `已儲存模型「${cloned.name}」(${cloned.id})`;
    this.refreshAllUi();
    return cloned;
  }

  private handleSpawnInRoom(): void {
    const saved = this.handleSaveModel();
    if (!saved) return;
    this.callbacks.onSpawnModelEntity?.(saved.id);
  }

  private refreshAllUi(): void {
    this.renderModelSelect();
    this.renderPartsList();
    this.renderRightPanel();
    this.footerStatusEl.textContent =
      this.importNotice || '拖曳畫布旋轉視角 · 滾輪縮放 · 支援 6 面 TextureAtlas 貼圖';
  }

  private renderModelSelect(): void {
    const models = this.getProjectModelsMap();
    const entries = Object.values(models);
    this.modelSelect.textContent = '';

    let hasActive = false;
    for (const m of entries) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.id})`;
      if (m.id === this.activeModel.id) hasActive = true;
      this.modelSelect.appendChild(opt);
    }

    if (!hasActive) {
      const draftOpt = document.createElement('option');
      draftOpt.value = this.activeModel.id;
      draftOpt.textContent = `${this.activeModel.name} (${this.activeModel.id}) *未儲存`;
      this.modelSelect.appendChild(draftOpt);
    }
    this.modelSelect.value = this.activeModel.id;
  }

  private renderPartsList(): void {
    this.partsListEl.textContent = '';
    if (this.activeModel.parts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'p7-meta-line';
      empty.textContent = this.activeModel.rawMesh
        ? '目前為 GLB 網格模型（可附加積木方塊）'
        : '尚無積木方塊，請點擊「+ 新增方塊」';
      this.partsListEl.appendChild(empty);
      return;
    }

    for (let i = 0; i < this.activeModel.parts.length; i++) {
      const part = this.activeModel.parts[i];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'p7-model-atelier-part-row';
      if (i === this.selectedPartIdx) row.classList.add('is-selected');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = part.id;
      const dimSpan = document.createElement('span');
      dimSpan.className = 'p7-mono';
      dimSpan.textContent = `${Math.round(part.size[0])}×${Math.round(part.size[1])}×${Math.round(part.size[2])}`;

      row.append(nameSpan, dimSpan);
      row.addEventListener('click', () => {
        this.selectedPartIdx = i;
        this.renderPartsList();
        this.renderRightPanel();
      });
      this.partsListEl.appendChild(row);
    }
  }

  private renderRightPanel(): void {
    this.rightPanelEl.textContent = '';
    const proj = this.callbacks.getProject();
    const spriteOptions = this.callbacks.getSpriteOptions(proj);

    // Model Metadata section
    const metaSec = document.createElement('div');
    metaSec.className = 'p7-section';
    const metaTitle = document.createElement('h3');
    metaTitle.className = 'p7-section-title';
    metaTitle.textContent = '模型基本資訊';

    const idField = this.createTextField('模型 ID', this.activeModel.id, (val) => {
      this.activeModel.id = sanitizeInteropId(val, 'model_3d');
      this.renderModelSelect();
    });
    const nameField = this.createTextField('模型名稱', this.activeModel.name, (val) => {
      this.activeModel.name = val.trim() || this.activeModel.id;
      this.renderModelSelect();
    });
    metaSec.append(metaTitle, idField, nameField);
    this.rightPanelEl.appendChild(metaSec);

    const part = this.activeModel.parts[this.selectedPartIdx];
    if (part) {
      // Part Transform Section
      const xformSec = document.createElement('div');
      xformSec.className = 'p7-section';
      const xformTitle = document.createElement('h3');
      xformTitle.className = 'p7-section-title';
      xformTitle.textContent = `方塊屬性：${part.id}`;

      const partIdField = this.createTextField('方塊 ID', part.id, (val) => {
        const clean = sanitizeInteropId(val, part.id);
        part.id = clean;
        this.renderPartsList();
      });

      const originRow = this.createVec3Field('起點 Origin [X, Y, Z]', part.origin, 0.5, false, (i, v) => {
        part.origin[i] = v;
      });
      const sizeRow = this.createVec3Field('尺寸 Size [W, D, H]', part.size, 0.5, true, (i, v) => {
        part.size[i] = Math.max(0.1, v);
        this.renderPartsList();
      });
      const pivotRow = this.createVec3Field('軸心 Pivot [X, Y, Z]', part.pivot, 0.5, false, (i, v) => {
        part.pivot[i] = v;
      });
      const rotRow = this.createVec3Field('旋轉 RotDeg [X, Y, Z]', part.rotDeg, 1, false, (i, v) => {
        part.rotDeg[i] = v;
      });

      xformSec.append(xformTitle, partIdField, originRow, sizeRow, pivotRow, rotRow);
      this.rightPanelEl.appendChild(xformSec);

      // Part PBR Material Section
      const matSec = document.createElement('div');
      matSec.className = 'p7-section';
      const matTitle = document.createElement('h3');
      matTitle.className = 'p7-section-title';
      matTitle.textContent = 'PBR 材質與色調';

      const tintRow = document.createElement('div');
      tintRow.className = 'p7-color-row';
      const tintLbl = document.createElement('span');
      tintLbl.textContent = '色調 Tint';
      const tintInp = document.createElement('input');
      tintInp.type = 'color';
      tintInp.className = 'p7-color-input';
      tintInp.value = /^#[0-9a-fA-F]{6}$/.test(part.tint) ? part.tint : '#ffffff';
      tintInp.addEventListener('input', () => {
        part.tint = tintInp.value;
      });
      tintRow.append(tintLbl, tintInp);

      const pbrGrid = document.createElement('div');
      pbrGrid.className = 'p7-prop-grid';
      pbrGrid.append(
        this.createNumField('粗糙度 Roughness', part.roughness, 0, 1, 0.05, (v) => {
          part.roughness = Math.max(0, Math.min(1, v));
        }),
        this.createNumField('金屬度 Metallic', part.metallic, 0, 1, 0.05, (v) => {
          part.metallic = Math.max(0, Math.min(1, v));
        }),
        this.createNumField('自發光 Emissive', part.emissive, 0, 2, 0.05, (v) => {
          part.emissive = Math.max(0, Math.min(2, v));
        }),
      );

      matSec.append(matTitle, tintRow, pbrGrid);
      this.rightPanelEl.appendChild(matSec);

      // 6-Face TextureAtlas Sprite Selectors
      const faceSec = document.createElement('div');
      faceSec.className = 'p7-section';
      const faceTitle = document.createElement('h3');
      faceTitle.className = 'p7-section-title';
      faceTitle.textContent = '6 面 TextureAtlas 貼圖';
      faceSec.appendChild(faceTitle);

      for (const slot of FACE_SLOTS) {
        const field = document.createElement('div');
        field.className = 'p7-field';
        const lbl = document.createElement('label');
        lbl.textContent = slot.label;
        const sel = document.createElement('select');
        sel.className = 'p7-select';
        sel.setAttribute('aria-label', slot.label);

        const inheritOpt = document.createElement('option');
        inheritOpt.value = '';
        inheritOpt.textContent = '(繼承 / 無貼圖)';
        sel.appendChild(inheritOpt);

        for (const optDef of spriteOptions) {
          const o = document.createElement('option');
          o.value = optDef.id;
          o.textContent = optDef.label;
          sel.appendChild(o);
        }
        const curFace = part.faces[slot.key];
        sel.value = curFace ?? '';
        sel.addEventListener('change', () => {
          const val = sel.value;
          if (val) {
            part.faces[slot.key] = val as SpriteId;
          } else {
            delete part.faces[slot.key];
          }
        });
        field.append(lbl, sel);
        faceSec.appendChild(field);
      }

      this.rightPanelEl.appendChild(faceSec);
    }

    // Optional RawMesh Inspector (for .glb imports)
    if (this.activeModel.rawMesh) {
      const raw = this.activeModel.rawMesh;
      const rawSec = document.createElement('div');
      rawSec.className = 'p7-section';
      const rawTitle = document.createElement('h3');
      rawTitle.className = 'p7-section-title';
      rawTitle.textContent = 'GLB 網格 (RawMesh)';

      const rawMeta = document.createElement('div');
      rawMeta.className = 'p7-meta-line p7-mono';
      rawMeta.textContent = `頂點 ${Math.floor(raw.positions.length / 3)} · 三角面 ${Math.floor(raw.indices.length / 3)}`;

      const rawSpriteField = document.createElement('div');
      rawSpriteField.className = 'p7-field';
      const rawSpriteLbl = document.createElement('label');
      rawSpriteLbl.textContent = '網格貼圖 (Sprite)';
      const rawSpriteSel = document.createElement('select');
      rawSpriteSel.className = 'p7-select';
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '(純色 PBR)';
      rawSpriteSel.appendChild(noneOpt);
      for (const optDef of spriteOptions) {
        const o = document.createElement('option');
        o.value = optDef.id;
        o.textContent = optDef.label;
        rawSpriteSel.appendChild(o);
      }
      rawSpriteSel.value = raw.spriteId ?? '';
      rawSpriteSel.addEventListener('change', () => {
        raw.spriteId = rawSpriteSel.value ? (rawSpriteSel.value as SpriteId) : null;
      });
      rawSpriteField.append(rawSpriteLbl, rawSpriteSel);

      const rawTintRow = document.createElement('div');
      rawTintRow.className = 'p7-color-row';
      const rawTintLbl = document.createElement('span');
      rawTintLbl.textContent = '網格色調 Tint';
      const rawTintInp = document.createElement('input');
      rawTintInp.type = 'color';
      rawTintInp.className = 'p7-color-input';
      rawTintInp.value = raw.tint && /^#[0-9a-fA-F]{6}$/.test(raw.tint) ? raw.tint : '#ffffff';
      rawTintInp.addEventListener('input', () => {
        raw.tint = rawTintInp.value;
      });
      rawTintRow.append(rawTintLbl, rawTintInp);

      const rawGrid = document.createElement('div');
      rawGrid.className = 'p7-prop-grid';
      rawGrid.append(
        this.createNumField('粗糙度 Roughness', raw.roughness ?? 0.58, 0, 1, 0.05, (v) => {
          raw.roughness = Math.max(0, Math.min(1, v));
        }),
        this.createNumField('金屬度 Metallic', raw.metallic ?? 0.1, 0, 1, 0.05, (v) => {
          raw.metallic = Math.max(0, Math.min(1, v));
        }),
        this.createNumField('自發光 Emissive', raw.emissive ?? 0, 0, 2, 0.05, (v) => {
          raw.emissive = Math.max(0, Math.min(2, v));
        }),
      );

      rawSec.append(rawTitle, rawMeta, rawSpriteField, rawTintRow, rawGrid);
      this.rightPanelEl.appendChild(rawSec);
    }
  }

  private createTextField(label: string, value: string, onCommit: (val: string) => void): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'p7-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'p7-input';
    inp.value = value;
    inp.setAttribute('aria-label', label);
    inp.addEventListener('change', () => onCommit(inp.value));
    field.append(lbl, inp);
    return field;
  }

  private createNumField(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (val: number) => void,
  ): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'p7-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'p7-input p7-mono';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(Number(value.toFixed(2)));
    inp.setAttribute('aria-label', label);
    inp.addEventListener('input', () => {
      const n = Number(inp.value);
      if (Number.isFinite(n)) onChange(n);
    });
    field.append(lbl, inp);
    return field;
  }

  private createVec3Field(
    label: string,
    vec: [number, number, number],
    step: number,
    positiveOnly: boolean,
    onChange: (axis: 0 | 1 | 2, val: number) => void,
  ): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'p7-field';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const row = document.createElement('div');
    row.className = 'p7-model-atelier-vec3';

    const axes: readonly [0 | 1 | 2, string][] = [
      [0, 'X'],
      [1, 'Y'],
      [2, 'Z'],
    ];
    for (const [idx, axisLabel] of axes) {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'p7-input p7-mono';
      inp.step = String(step);
      if (positiveOnly) inp.min = '0.1';
      inp.value = String(Number(vec[idx].toFixed(2)));
      inp.setAttribute('aria-label', `${label} ${axisLabel}`);
      inp.addEventListener('input', () => {
        const n = Number(inp.value);
        if (Number.isFinite(n)) onChange(idx, n);
      });
      row.appendChild(inp);
    }

    field.append(lbl, row);
    return field;
  }
}
