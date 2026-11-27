import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import { emitModel3DToGpu, type EcsModel3DDef } from '../core/ecs/EcsModel3D.ts';
import { GpuEngine } from '../core/gpu/GpuEngine.ts';
import type { Camera3DProjectionMode } from '../core/math/Perspective3DMath.ts';
import { makeButton } from './ModelAtelierInspector.ts';

export type ModelViewMode = Camera3DProjectionMode | 'quad';

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

/**
 * Interactive 3D/Quad-Split Preview Viewport for `ModelAtelierModalView`:
 * manages lazy `GpuEngine` lifecycle, orbit/zoom pointer controls, and RAF preview loop.
 */
export class ModelAtelierViewport {
  public readonly element: HTMLDivElement;

  private readonly signal: AbortSignal;
  private readonly atlas: TextureAtlas;
  private readonly getActiveModel: () => EcsModel3DDef;
  private readonly isModalVisible: () => boolean;

  private readonly viewBarBtns = new Map<ModelViewMode, HTMLButtonElement>();
  private readonly canvasHostEl: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private readonly statusLineEl: HTMLDivElement;

  private previewGpu: GpuEngine | null = null;
  private gpuInitialized = false;
  private rafId = 0;
  private destroyed = false;

  private viewMode: ModelViewMode = 'perspective';
  private previewYawDeg = DEFAULT_YAW_DEG;
  private previewPitchDeg = DEFAULT_PITCH_DEG;
  private previewZoom = DEFAULT_ZOOM;

  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private lastStatusText = '';

  constructor(
    atlas: TextureAtlas,
    signal: AbortSignal,
    getActiveModel: () => EcsModel3DDef,
    isModalVisible: () => boolean,
  ) {
    this.atlas = atlas;
    this.signal = signal;
    this.getActiveModel = getActiveModel;
    this.isModalVisible = isModalVisible;

    this.element = document.createElement('div');
    this.element.className = 'p7-model-atelier-center';

    const viewBar = document.createElement('div');
    viewBar.className = 'p7-model-atelier-viewbar';
    for (const def of VIEW_MODE_BUTTONS) {
      const b = makeButton('p7-seg-btn', def.label);
      b.addEventListener('click', () => this.setViewMode(def.mode), { signal });
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

    this.element.append(viewBar, this.canvasHostEl, this.statusLineEl);
    this.syncViewBarActive();
  }

  private bindCanvasEvents(target: HTMLCanvasElement): void {
    const { signal } = this;

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

  public ensurePreviewGpuInit(): void {
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
        this.atlas,
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

  public startRaf(): void {
    if (this.rafId !== 0 || this.destroyed || !this.isModalVisible()) return;
    const tick = (nowMs: number): void => {
      this.rafId = 0;
      if (this.destroyed || !this.isModalVisible()) return;
      this.renderPreviewFrame(nowMs);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public stopRaf(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.dragging = false;
  }

  public destroy(): void {
    this.destroyed = true;
    this.stopRaf();
    this.previewGpu?.dispose();
    this.previewGpu = null;
    this.gpuInitialized = false;
  }

  private computeModelCenterZ(model: EcsModel3DDef): number {
    if (model.parts.length > 0) {
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of model.parts) {
        if (p.origin[2] < minZ) minZ = p.origin[2];
        if (p.origin[2] + p.size[2] > maxZ) maxZ = p.origin[2] + p.size[2];
      }
      if (Number.isFinite(minZ) && Number.isFinite(maxZ)) {
        return Math.max(4, Math.min(48, (minZ + maxZ) * 0.5));
      }
    }
    if (model.boundsSize) {
      return Math.max(4, Math.min(48, model.boundsSize[2] * 0.5));
    }
    return 12;
  }

  private renderPreviewFrame(nowMs: number): void {
    const gpu = this.previewGpu;
    if (!gpu || !gpu.hasBackend()) return;

    const model = this.getActiveModel();
    gpu.beginFrame('#0f172a', '#1e293b', false, 0, 0, 0, 0);
    gpu.setQuadViewEnabled(this.viewMode === 'quad');

    const projMode: Camera3DProjectionMode =
      this.viewMode === 'quad' ? 'perspective' : this.viewMode;
    const centerZ = this.computeModelCenterZ(model);

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
    emitModel3DToGpu(gpu, model, 0, 0, 0);

    const stats = gpu.flush(nowMs * 0.001);
    const meshStats = gpu.getMesh3DStats();
    const rawVerts = model.rawMesh ? Math.floor(model.rawMesh.positions.length / 3) : 0;
    const vertCount = Math.max(meshStats.opaqueVertices + meshStats.alphaVertices, rawVerts);
    const fallbackNote = gpu.supports3D() ? '' : ' [2D 保底模式]';
    const nextStatus =
      `模型 ${model.id} · 部件 ${model.parts.length} · 頂點 ${vertCount}` +
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
}
