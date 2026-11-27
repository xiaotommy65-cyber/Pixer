import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import { validateModel3DDef, type EcsModel3DDef } from '../core/ecs/EcsModel3D.ts';
import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import {
  buildSampleBbmodelJson,
  parseBbmodelToModel3D,
} from '../core/interop/BbmodelImporter.ts';
import {
  buildSampleGlbCube,
  parseGlbToModel3D,
} from '../core/interop/GlbImporter.ts';
import { sanitizeInteropId } from '../core/interop/InteropTypes.ts';
import {
  createDefaultCuboidModel,
  makeButton,
  renderModelInspectorPanel,
  renderModelPartsList,
  toImmutableModel,
  toMutableModel,
  type MutableCuboidPart,
  type MutableModel3D,
} from './ModelAtelierInspector.ts';
import { ModelAtelierViewport } from './ModelAtelierViewport.ts';

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

/**
 * Phase C Blockbench-Style 3D Model Atelier Modal:
 * Multi-part cuboid modeling, 6-face TextureAtlas mapping, `.glb` / `.bbmodel` import,
 * 4-view quad-split & orbit preview rendered lazily via `ModelAtelierViewport`.
 */
export class ModelAtelierModalView {
  public readonly element: HTMLDivElement;

  private readonly ac = new AbortController();
  private readonly callbacks: ModelAtelierModalCallbacks;

  private readonly modelSelect: HTMLSelectElement;
  private readonly fileInput: HTMLInputElement;
  private readonly partsListEl: HTMLDivElement;
  private readonly viewport: ModelAtelierViewport;
  private readonly rightPanelEl: HTMLDivElement;
  private readonly footerStatusEl: HTMLDivElement;

  private destroyed = false;
  private activeModel: MutableModel3D;
  private selectedPartIdx = 0;
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
    this.viewport = new ModelAtelierViewport(
      this.callbacks.atlas,
      signal,
      () => this.activeModel,
      () => !this.element.hidden,
    );

    // Right Panel: Model Meta + Part Transform/Material/6-Face Inspector
    this.rightPanelEl = document.createElement('div');
    this.rightPanelEl.className = 'p7-model-atelier-right';

    body.append(left, this.viewport.element, this.rightPanelEl);

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

    this.viewport.ensurePreviewGpuInit();
    this.viewport.startRaf();
  }

  public close(): void {
    this.viewport.stopRaf();
    this.element.hidden = true;
  }

  public destroy(): void {
    this.destroyed = true;
    this.viewport.destroy();
    this.ac.abort();
    this.element.remove();
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
    this.renderParts();
    this.renderInspector();
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

  private renderParts(): void {
    renderModelPartsList(this.partsListEl, this.activeModel, this.selectedPartIdx, (idx) => {
      this.selectedPartIdx = idx;
      this.renderParts();
      this.renderInspector();
    });
  }

  private renderInspector(): void {
    const proj = this.callbacks.getProject();
    const spriteOptions = this.callbacks.getSpriteOptions(proj);
    renderModelInspectorPanel(this.rightPanelEl, this.activeModel, this.selectedPartIdx, spriteOptions, {
      onModelMetaChanged: () => this.renderModelSelect(),
      onPartsListChanged: () => this.renderParts(),
    });
  }
}
