import { compileCustomSpriteToRgba } from '../core/ecs/EcsCustomSpriteCompiler.ts';
import type { EcsCustomSpriteDef, EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand } from '../core/ecs/EcsStudioSession.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import {
  buildSampleAsepriteFile,
  buildSampleLdtkSample,
  buildSampleTiledZlibSample,
  type InteropBundleFile,
  type InteropCommitOptions,
  type InteropImportResult,
} from '../core/interop/index.ts';
import { InteropWorkerClient } from './InteropWorkerClient.ts';
import { PixelForgeImportTab } from './PixelForgeImportTab.ts';

export interface ExternalImportModalCallbacks {
  onCommit: (result: InteropImportResult, options: InteropCommitOptions) => void;
  getProject?: () => EcsProjectV2;
  onCommitCommands?: (
    cmds: EcsStudioCommand[],
    summary: string,
    focusHint?: { leftTab?: 'map' | 'prefabs' | 'atlas' },
  ) => void;
}

function renderCustomSpriteThumb(def: EcsCustomSpriteDef, boxSize = 48): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'p7-interop-thumb';
  canvas.width = boxSize;
  canvas.height = boxSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const compiled = compileCustomSpriteToRgba(def);
  const tmp = document.createElement('canvas');
  tmp.width = compiled.width;
  tmp.height = compiled.height;
  const tctx = tmp.getContext('2d');
  if (!tctx) return canvas;

  const imgData = tctx.createImageData(compiled.width, compiled.height);
  imgData.data.set(compiled.rgba.subarray(0, imgData.data.length));
  tctx.putImageData(imgData, 0, 0);

  ctx.imageSmoothingEnabled = false;
  const scale = Math.min(boxSize / def.width, boxSize / def.height);
  const dw = Math.max(1, Math.round(def.width * scale));
  const dh = Math.max(1, Math.round(def.height * scale));
  const dx = Math.floor((boxSize - dw) * 0.5);
  const dy = Math.floor((boxSize - dh) * 0.5);
  ctx.drawImage(tmp, 0, 0, def.width, def.height, dx, dy, dw, dh);
  return canvas;
}

const FORMAT_BADGE_LABEL: Record<InteropImportResult['format'], string> = {
  aseprite_bin: 'ASEPRITE 二進位',
  aseprite_json: 'ASEPRITE JSON',
  ldtk: 'LDtk 多房間專案',
  tiled: 'Tiled (.tmj / JSON)',
};

/**
 * Workstation External Standard Format Importer Modal:
 * Supports Aseprite (.ase/.aseprite + JSON/PNG), LDtk (.ldtk), Tiled (.tmj/.json), and .zip bundles
 * parsed off the main thread via `InteropWorkerClient`.
 */
export class ExternalImportModalView {
  public readonly element: HTMLDivElement;
  private readonly ac = new AbortController();
  private readonly workerClient = new InteropWorkerClient();
  private readonly callbacks: ExternalImportModalCallbacks;

  private readonly fileInput: HTMLInputElement;
  private readonly supplementPngInput: HTMLInputElement;
  private readonly standardPaneEl: HTMLDivElement;
  private readonly dropzoneEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly previewEl: HTMLDivElement;
  private readonly footerEl: HTMLDivElement;
  private readonly commitBtn: HTMLButtonElement;
  private readonly tabStandardBtn: HTMLButtonElement;
  private readonly tabForgeBtn: HTMLButtonElement;
  private readonly tabPacksBtn: HTMLButtonElement;
  private readonly forgeTab: PixelForgeImportTab | null;

  private activeTab: 'standard' | 'forge' | 'packs' = 'standard';

  private currentFiles: InteropBundleFile[] = [];
  private parsedResult: InteropImportResult | null = null;
  private wallExtrudeH = 24;
  private replaceWorldMap = true;
  private createPrefabFromSprite = true;
  private createTileFromSprite = false;
  private spriteTileLayer: EcsMapLayerName = 'decor';
  private spriteTileSolid = false;

  constructor(callbacks: ExternalImportModalCallbacks) {
    this.callbacks = callbacks;
    const { signal } = this.ac;

    this.element = document.createElement('div');
    this.element.className = 'p7-interop-backdrop';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', '外部格式匯入（Aseprite / LDtk / Tiled）');

    const dialog = document.createElement('div');
    dialog.className = 'p7-interop-dialog';

    // Header
    const header = document.createElement('div');
    header.className = 'p7-interop-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'p7-interop-title-wrap';
    const title = document.createElement('h2');
    title.className = 'p7-interop-title';
    title.textContent = '外部格式匯入 · Aseprite / LDtk / Tiled';
    const subtitle = document.createElement('div');
    subtitle.className = 'p7-interop-subtitle';
    subtitle.textContent =
      '支援 .ase/.aseprite 二進位、.ldtk 多房關卡、.tmj (Base64/Zlib/Gzip) 與 .zip 圖集打包，匯入採原子批次可一鍵復原。';
    titleWrap.append(title, subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'p7-btn p7-btn-xs';
    closeBtn.textContent = '關閉 (Esc)';
    closeBtn.addEventListener('click', () => this.close(), { signal });
    header.append(titleWrap, closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'p7-interop-body';

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.multiple = true;
    this.fileInput.accept = '.ase,.aseprite,.ldtk,.tmj,.json,.png,.zip';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener(
      'change',
      () => {
        if (this.fileInput.files && this.fileInput.files.length > 0) {
          void this.handleFileList(this.fileInput.files, false);
          this.fileInput.value = '';
        }
      },
      { signal },
    );

    this.supplementPngInput = document.createElement('input');
    this.supplementPngInput.type = 'file';
    this.supplementPngInput.multiple = true;
    this.supplementPngInput.accept = '.png';
    this.supplementPngInput.hidden = true;
    this.supplementPngInput.addEventListener(
      'change',
      () => {
        if (this.supplementPngInput.files && this.supplementPngInput.files.length > 0) {
          void this.handleFileList(this.supplementPngInput.files, true);
          this.supplementPngInput.value = '';
        }
      },
      { signal },
    );

    // Dropzone
    this.dropzoneEl = document.createElement('div');
    this.dropzoneEl.className = 'p7-interop-dropzone';
    const dzHead = document.createElement('div');
    dzHead.className = 'p7-interop-dz-head';
    dzHead.textContent = '拖曳檔案到此處，或點擊選取專案檔與伴隨 PNG / ZIP';
    const dzHint = document.createElement('div');
    dzHint.className = 'p7-interop-dz-hint p7-mono';
    dzHint.textContent = '.ase · .aseprite · .ldtk · .tmj · .json + .png · .zip';
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'p7-btn p7-btn-accent';
    pickBtn.textContent = '選擇本機檔案 / ZIP';
    pickBtn.addEventListener('click', () => this.fileInput.click(), { signal });
    this.dropzoneEl.append(dzHead, dzHint, pickBtn);

    this.dropzoneEl.addEventListener(
      'dragover',
      (e) => {
        e.preventDefault();
        this.dropzoneEl.classList.add('is-dragover');
      },
      { signal },
    );
    this.dropzoneEl.addEventListener(
      'dragleave',
      () => {
        this.dropzoneEl.classList.remove('is-dragover');
      },
      { signal },
    );
    this.dropzoneEl.addEventListener(
      'drop',
      (e) => {
        e.preventDefault();
        this.dropzoneEl.classList.remove('is-dragover');
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          void this.handleFileList(e.dataTransfer.files, false);
        }
      },
      { signal },
    );

    // Built-in 1-click spec-compliant sample buttons
    const sampleRow = document.createElement('div');
    sampleRow.className = 'p7-interop-samples';
    const sampleLabel = document.createElement('span');
    sampleLabel.className = 'p7-interop-sample-label';
    sampleLabel.textContent = '內建標準範例一鍵試載：';

    const btnSampleAse = document.createElement('button');
    btnSampleAse.type = 'button';
    btnSampleAse.className = 'p7-btn p7-btn-xs';
    btnSampleAse.dataset.interopSample = 'aseprite';
    btnSampleAse.textContent = '試載 Aseprite (.aseprite)';
    btnSampleAse.addEventListener(
      'click',
      () => void this.loadBundleFiles([buildSampleAsepriteFile()]),
      { signal },
    );

    const btnSampleLdtk = document.createElement('button');
    btnSampleLdtk.type = 'button';
    btnSampleLdtk.className = 'p7-btn p7-btn-xs';
    btnSampleLdtk.dataset.interopSample = 'ldtk';
    btnSampleLdtk.textContent = '試載 LDtk 雙房關卡 (.ldtk)';
    btnSampleLdtk.addEventListener(
      'click',
      () => void this.loadBundleFiles([buildSampleLdtkSample()]),
      { signal },
    );

    const btnSampleTiled = document.createElement('button');
    btnSampleTiled.type = 'button';
    btnSampleTiled.className = 'p7-btn p7-btn-xs';
    btnSampleTiled.dataset.interopSample = 'tiled';
    btnSampleTiled.textContent = '試載 Tiled Zlib 地圖 (.tmj)';
    btnSampleTiled.addEventListener(
      'click',
      () => void this.loadBundleFiles([buildSampleTiledZlibSample()]),
      { signal },
    );

    sampleRow.append(sampleLabel, btnSampleAse, btnSampleLdtk, btnSampleTiled);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'p7-interop-status';
    this.statusEl.hidden = true;

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'p7-interop-preview';

    const tabSeg = document.createElement('div');
    tabSeg.className = 'p7-segmented';
    this.tabStandardBtn = document.createElement('button');
    this.tabStandardBtn.type = 'button';
    this.tabStandardBtn.className = 'p7-seg-btn is-active';
    this.tabStandardBtn.textContent = '標準格式 (Aseprite / LDtk / Tiled)';
    this.tabStandardBtn.addEventListener('click', () => this.switchTab('standard'), { signal });

    this.tabForgeBtn = document.createElement('button');
    this.tabForgeBtn.type = 'button';
    this.tabForgeBtn.className = 'p7-seg-btn';
    this.tabForgeBtn.setAttribute('data-testid', 'interop-tab-forge');
    this.tabForgeBtn.textContent = 'Pixel Forge 任意圖洗圖';
    this.tabForgeBtn.addEventListener('click', () => this.switchTab('forge'), { signal });

    this.tabPacksBtn = document.createElement('button');
    this.tabPacksBtn.type = 'button';
    this.tabPacksBtn.className = 'p7-seg-btn';
    this.tabPacksBtn.setAttribute('data-testid', 'interop-tab-packs');
    this.tabPacksBtn.textContent = '題材資產包 (Asset Packs)';
    this.tabPacksBtn.addEventListener('click', () => this.switchTab('packs'), { signal });
    tabSeg.append(this.tabStandardBtn, this.tabForgeBtn, this.tabPacksBtn);

    this.standardPaneEl = document.createElement('div');
    this.standardPaneEl.className = 'p7-interop-options';
    this.standardPaneEl.append(this.fileInput, this.supplementPngInput, this.dropzoneEl, sampleRow, this.statusEl, this.previewEl);

    if (callbacks.getProject && callbacks.onCommitCommands) {
      this.forgeTab = new PixelForgeImportTab({
        getProject: callbacks.getProject,
        onCommitCommands: callbacks.onCommitCommands,
        onRequestClose: () => this.close(),
      });
      body.append(tabSeg, this.standardPaneEl, this.forgeTab.forgePaneEl, this.forgeTab.packsPaneEl);
    } else {
      this.forgeTab = null;
      this.tabForgeBtn.hidden = true;
      this.tabPacksBtn.hidden = true;
      body.append(this.standardPaneEl);
    }

    // Footer
    this.footerEl = document.createElement('div');
    this.footerEl.className = 'p7-interop-footer';
    const footNote = document.createElement('div');
    footNote.className = 'p7-meta-line';
    footNote.textContent = '像素以無損 Zlib RGBA / Oklab PBR 寫入動態 MaxRects 圖集池，純本機解析不上傳伺服器。';

    const footActions = document.createElement('div');
    footActions.className = 'p7-interop-footer-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'p7-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => this.close(), { signal });

    this.commitBtn = document.createElement('button');
    this.commitBtn.type = 'button';
    this.commitBtn.className = 'p7-primary-cta';
    this.commitBtn.dataset.interopCommit = '1';
    this.commitBtn.textContent = '原子匯入至工作站（支援復原）';
    this.commitBtn.disabled = true;
    this.commitBtn.addEventListener('click', () => this.handleCommit(), { signal });

    footActions.append(cancelBtn, this.commitBtn);
    this.footerEl.append(footNote, footActions);

    dialog.append(header, body, this.footerEl);
    this.element.appendChild(dialog);

    // Backdrop & Escape close
    this.element.addEventListener(
      'click',
      (e) => {
        if (e.target === this.element) this.close();
      },
      { signal },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.element.hidden && e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      },
      { signal },
    );
  }

  private switchTab(tab: 'standard' | 'forge' | 'packs'): void {
    this.activeTab = tab;
    this.tabStandardBtn.classList.toggle('is-active', tab === 'standard');
    this.tabForgeBtn.classList.toggle('is-active', tab === 'forge');
    this.tabPacksBtn.classList.toggle('is-active', tab === 'packs');
    this.standardPaneEl.hidden = tab !== 'standard';
    this.footerEl.hidden = tab !== 'standard';
    if (this.forgeTab) {
      this.forgeTab.forgePaneEl.hidden = tab !== 'forge';
      this.forgeTab.packsPaneEl.hidden = tab !== 'packs';
    }
  }

  public open(): void {
    this.switchTab(this.activeTab);
    this.element.hidden = false;
    this.renderPreview();
  }

  public close(): void {
    this.element.hidden = true;
  }

  public isOpen(): boolean {
    return !this.element.hidden;
  }

  private async handleFileList(list: FileList, appendToExisting: boolean): Promise<void> {
    const incoming: InteropBundleFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const buf = await f.arrayBuffer();
      incoming.push({ name: f.name, bytes: new Uint8Array(buf) });
    }
    const merged = appendToExisting ? [...this.currentFiles, ...incoming] : incoming;
    await this.loadBundleFiles(merged);
  }

  private async loadBundleFiles(files: InteropBundleFile[]): Promise<void> {
    this.currentFiles = files;
    this.setStatus('正在於背景 Worker 解析外部檔案...', false);
    this.commitBtn.disabled = true;
    try {
      const res = await this.workerClient.parseFiles(files, {
        wallExtrudeH: this.wallExtrudeH,
      });
      this.parsedResult = res;
      this.setStatus(`解析完成：${res.summary}`, false);
      this.commitBtn.disabled = false;
      this.renderPreview();
    } catch (err) {
      this.parsedResult = null;
      this.setStatus(err instanceof Error ? err.message : String(err), true);
      this.renderPreview();
    }
  }

  private setStatus(msg: string, isError: boolean): void {
    this.statusEl.hidden = !msg;
    this.statusEl.textContent = msg;
    this.statusEl.className = isError ? 'p7-interop-status is-error' : 'p7-interop-status is-ok';
  }

  private renderPreview(): void {
    this.previewEl.textContent = '';
    const res = this.parsedResult;
    if (!res) {
      const empty = document.createElement('div');
      empty.className = 'p7-interop-empty';
      empty.textContent = '尚未載入檔案。請拖曳本機專案檔，或點擊上方「內建標準範例一鍵試載」立即體驗。';
      this.previewEl.appendChild(empty);
      return;
    }

    // Top metadata & stats bar
    const metaBar = document.createElement('div');
    metaBar.className = 'p7-interop-meta-bar';
    const badge = document.createElement('span');
    badge.className = 'p7-interop-badge p7-mono';
    badge.textContent = FORMAT_BADGE_LABEL[res.format];
    const fileLabel = document.createElement('strong');
    fileLabel.className = 'p7-interop-filename p7-mono';
    fileLabel.textContent = res.sourceName;
    metaBar.append(badge, fileLabel);

    const statsGrid = document.createElement('div');
    statsGrid.className = 'p7-interop-stats p7-mono';
    const stats: [string, string][] = [
      ['自訂精靈', `${res.customSprites.length}`],
      ['地圖房間', `${res.rooms.length}`],
      ['瓦片定義', `${res.tileDefs.length}`],
      ['傳送門', `${res.portals.length}`],
      ['實體數量', `${res.entities.length}`],
    ];
    for (const [k, v] of stats) {
      const cell = document.createElement('div');
      cell.className = 'p7-interop-stat';
      const l = document.createElement('span');
      l.textContent = k;
      const val = document.createElement('b');
      val.textContent = v;
      cell.append(l, val);
      statsGrid.appendChild(cell);
    }

    this.previewEl.append(metaBar, statsGrid);

    // Animation tags (for Aseprite)
    if (res.animationTags && res.animationTags.length > 0) {
      const tagRow = document.createElement('div');
      tagRow.className = 'p7-interop-tags';
      const tHead = document.createElement('span');
      tHead.className = 'p7-meta-line';
      tHead.textContent = '動畫標籤：';
      tagRow.appendChild(tHead);
      for (const t of res.animationTags) {
        const chip = document.createElement('span');
        chip.className = 'p7-interop-tag p7-mono';
        chip.textContent = `${t.name} [${t.fromFrame}..${t.toFrame}] (${t.direction})`;
        tagRow.appendChild(chip);
      }
      this.previewEl.appendChild(tagRow);
    }

    // Missing companion PNG banner
    if (res.missingAssetPaths.length > 0) {
      const missBox = document.createElement('div');
      missBox.className = 'p7-interop-warning-box';
      const missTxt = document.createElement('div');
      missTxt.textContent = `偵測到缺少伴隨圖檔：${res.missingAssetPaths.join('、')}（已自動套用 Oklab+Bayer 程序化 PBR 像素磚填補）`;
      const addPngBtn = document.createElement('button');
      addPngBtn.type = 'button';
      addPngBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
      addPngBtn.textContent = '補傳伴隨 PNG';
      addPngBtn.addEventListener('click', () => this.supplementPngInput.click());
      missBox.append(missTxt, addPngBtn);
      this.previewEl.appendChild(missBox);
    }

    // Pixel sprite thumbnails strip
    if (res.customSprites.length > 0) {
      const thumbHead = document.createElement('div');
      thumbHead.className = 'p7-section-title';
      thumbHead.textContent = `像素精靈預覽（顯示前 ${Math.min(12, res.customSprites.length)} / ${res.customSprites.length} 張）`;
      const thumbGrid = document.createElement('div');
      thumbGrid.className = 'p7-interop-thumbs';
      for (const sp of res.customSprites.slice(0, 12)) {
        const card = document.createElement('div');
        card.className = 'p7-interop-thumb-card';
        const cv = renderCustomSpriteThumb(sp, 44);
        const cap = document.createElement('span');
        cap.className = 'p7-interop-thumb-cap p7-mono';
        cap.textContent = `${sp.name ?? sp.id}`;
        const dim = document.createElement('span');
        dim.className = 'p7-interop-thumb-dim p7-mono';
        dim.textContent = `${sp.width}×${sp.height}`;
        card.append(cv, cap, dim);
        thumbGrid.appendChild(card);
      }
      this.previewEl.append(thumbHead, thumbGrid);
    }

    // Import Options Panel
    const optBox = document.createElement('div');
    optBox.className = 'p7-interop-options';
    const isMap = res.rooms.length > 0;

    if (isMap) {
      const modeRow = document.createElement('label');
      modeRow.className = 'p7-interop-check';
      const replaceChk = document.createElement('input');
      replaceChk.type = 'checkbox';
      replaceChk.checked = this.replaceWorldMap;
      replaceChk.addEventListener('change', () => {
        this.replaceWorldMap = replaceChk.checked;
      });
      const modeSpan = document.createElement('span');
      modeSpan.textContent = '取代目前專案的世界地圖與實體（取消勾選則改為附加新房間）';
      modeRow.append(replaceChk, modeSpan);

      const extRow = document.createElement('div');
      extRow.className = 'p7-interop-range-row';
      const extLabel = document.createElement('span');
      extLabel.className = 'p7-meta-line p7-mono';
      extLabel.textContent = `HD-2D 牆面立體擠出高度 (wallExtrudeH)：${this.wallExtrudeH}px`;
      const extSlider = document.createElement('input');
      extSlider.type = 'range';
      extSlider.min = '8';
      extSlider.max = '40';
      extSlider.step = '2';
      extSlider.value = String(this.wallExtrudeH);
      extSlider.addEventListener('input', () => {
        this.wallExtrudeH = Number(extSlider.value);
        extLabel.textContent = `HD-2D 牆面立體擠出高度 (wallExtrudeH)：${this.wallExtrudeH}px`;
      });
      extRow.append(extLabel, extSlider);
      optBox.append(modeRow, extRow);
    } else {
      const prefRow = document.createElement('label');
      prefRow.className = 'p7-interop-check';
      const prefChk = document.createElement('input');
      prefChk.type = 'checkbox';
      prefChk.checked = this.createPrefabFromSprite;
      prefChk.addEventListener('change', () => {
        this.createPrefabFromSprite = prefChk.checked;
      });
      const prefSpan = document.createElement('span');
      prefSpan.textContent = '同步註冊為物件庫 Prefab 印章（可直接蓋印到地圖）';
      prefRow.append(prefChk, prefSpan);

      const tileRow = document.createElement('label');
      tileRow.className = 'p7-interop-check';
      const tileChk = document.createElement('input');
      tileChk.type = 'checkbox';
      tileChk.checked = this.createTileFromSprite;
      tileChk.addEventListener('change', () => {
        this.createTileFromSprite = tileChk.checked;
        layerSel.disabled = !tileChk.checked;
      });
      const tileSpan = document.createElement('span');
      tileSpan.textContent = '同步註冊為地圖可繪製瓦片：';
      const layerSel = document.createElement('select');
      layerSel.className = 'p7-select';
      layerSel.disabled = !this.createTileFromSprite;
      const layerOpts: [EcsMapLayerName, string, boolean][] = [
        ['decor', '裝飾層 (可通行)', false],
        ['ground', '地板層 (可通行)', false],
        ['wall', '城牆立面層 (實心阻擋)', true],
      ];
      for (const [val, txt] of layerOpts) {
        const o = document.createElement('option');
        o.value = val;
        o.textContent = txt;
        layerSel.appendChild(o);
      }
      layerSel.value = this.spriteTileLayer;
      layerSel.addEventListener('change', () => {
        this.spriteTileLayer = layerSel.value as EcsMapLayerName;
        this.spriteTileSolid = this.spriteTileLayer === 'wall';
      });
      tileRow.append(tileChk, tileSpan, layerSel);
      optBox.append(prefRow, tileRow);
    }
    this.previewEl.appendChild(optBox);

    // Warnings list
    if (res.warnings.length > 0) {
      const warnList = document.createElement('div');
      warnList.className = 'p7-interop-notes';
      for (const w of res.warnings) {
        const item = document.createElement('div');
        item.className = 'p7-meta-line';
        item.textContent = `• ${w}`;
        warnList.appendChild(item);
      }
      this.previewEl.appendChild(warnList);
    }
  }

  private handleCommit(): void {
    if (!this.parsedResult) return;
    const opts: InteropCommitOptions = {
      replaceWorldMap: this.replaceWorldMap,
      wallExtrudeH: this.wallExtrudeH,
      createPrefabFromSprite: this.createPrefabFromSprite,
      ...(this.createTileFromSprite
        ? { createTileFromSprite: { layer: this.spriteTileLayer, solid: this.spriteTileSolid } }
        : {}),
    };
    this.callbacks.onCommit(this.parsedResult, opts);
    this.close();
  }

  public destroy(): void {
    this.forgeTab?.destroy();
    this.workerClient.destroy();
    this.ac.abort();
    this.element.remove();
  }
}
