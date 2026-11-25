import type { EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand } from '../core/ecs/EcsStudioSession.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import {
  buildAssetPackInstallCommands,
  buildBuiltinStarterPack,
  buildPixelForgeCommitCommands,
  BUILTIN_STARTER_PACK_SUMMARIES,
  exportProjectAsAssetPack,
  forgeImageToCustomSprites,
  PIXEL_FORGE_BAKING_PROFILES,
  PIXEL_FORGE_PALETTES,
  validateAssetPackManifest,
  type BuiltinStarterPackGenre,
  type PixelForgeBakingProfileId,
  type PixelForgeColorMode,
  type PixelForgeDownscaleMode,
  type PixelForgeOutput,
  type PixelForgePaletteId,
} from '../core/interop/index.ts';

export interface PixelForgeImportTabCallbacks {
  getProject: () => EcsProjectV2;
  onCommitCommands: (
    cmds: EcsStudioCommand[],
    summary: string,
    focusHint?: { leftTab?: 'map' | 'prefabs' | 'atlas' },
  ) => void;
  onRequestClose: () => void;
}

interface TargetSizePreset {
  readonly id: string;
  readonly label: string;
  readonly w: number;
  readonly h: number;
}

const TARGET_SIZE_PRESETS: readonly TargetSizePreset[] = [
  { id: '16x16', label: '16×16 微型圖示 / 子彈', w: 16, h: 16 },
  { id: '32x32', label: '32×32 地磚 / 道具 (推薦)', w: 32, h: 32 },
  { id: '48x64', label: '48×64 角色 / 怪物立體塊', w: 48, h: 64 },
  { id: '96x128', label: '96×128 大物件 / Boss 體型', w: 96, h: 128 },
  { id: '160x192', label: '160×192 文字冒險半身立繪', w: 160, h: 192 },
  { id: '256x256', label: '256×256 高精細立繪 / 肖像', w: 256, h: 256 },
];

async function decodeImageFileToRgba(
  file: File,
): Promise<{ width: number; height: number; rgba: Uint8Array } | null> {
  let src: CanvasImageSource;
  let w = 0;
  let h = 0;
  let cleanup = () => {};

  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    src = bmp;
    w = bmp.width;
    h = bmp.height;
    cleanup = () => bmp.close();
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image load failed'));
        el.src = url;
      });
      src = img;
      w = img.naturalWidth || img.width;
      h = img.naturalHeight || img.height;
      cleanup = () => URL.revokeObjectURL(url);
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
  }

  try {
    const maxDim = 1024;
    const scale = Math.min(1, maxDim / Math.max(1, Math.max(w, h)));
    const sw = Math.max(1, Math.round(w * scale));
    const sh = Math.max(1, Math.round(h * scale));
    const cv = document.createElement('canvas');
    cv.width = sw;
    cv.height = sh;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, sw, sh);
    const imgData = ctx.getImageData(0, 0, sw, sh);
    return { width: sw, height: sh, rgba: new Uint8Array(imgData.data) };
  } finally {
    cleanup();
  }
}

function buildDemoHighResArt(): { name: string; width: number; height: number; rgba: Uint8Array } {
  // Build a crisp 128x128 (4x upscaled from 32x32) gothic lantern on solid magenta (#ff00ff)
  const w = 128;
  const h = 128;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, w, h);

  const px = (gx: number, gy: number, gw: number, gh: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(gx * 4, gy * 4, gw * 4, gh * 4);
  };

  // Iron top ring & cap
  px(14, 3, 4, 2, '#64748b');
  px(11, 5, 10, 3, '#1e293b');
  px(12, 6, 8, 1, '#94a3b8');
  // Lantern frame & warm glowing flame glass
  px(9, 8, 14, 15, '#0f172a');
  px(11, 10, 10, 11, '#b45309');
  px(12, 11, 8, 9, '#f59e0b');
  px(14, 13, 4, 5, '#fef08a');
  px(15, 14, 2, 3, '#ffffff');
  // Iron ribs & pedestal base
  px(15, 9, 2, 13, '#1e293b');
  px(10, 23, 12, 4, '#334155');
  px(11, 24, 10, 2, '#64748b');
  px(8, 27, 16, 2, '#0f172a');

  const data = ctx.getImageData(0, 0, w, h).data;
  return { name: 'gothic_lantern_demo.png', width: w, height: h, rgba: new Uint8Array(data) };
}

function paintRgbaOnCanvas(canvas: HTMLCanvasElement, rgba: Uint8Array, w: number, h: number): void {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imgData = ctx.createImageData(w, h);
  imgData.data.set(rgba.subarray(0, imgData.data.length));
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Workstation Universal Pixel Forge & Cross-Genre Asset Packs Tab Controller:
 * turns any AI/external image into clean grid-aligned Oklab-quantized `8..256` sprites or
 * animated sheets, and installs/exports portable `PixerAssetPackManifest` v1 bundles.
 */
export class PixelForgeImportTab {
  public readonly forgePaneEl: HTMLDivElement;
  public readonly packsPaneEl: HTMLDivElement;
  private readonly ac = new AbortController();
  private readonly callbacks: PixelForgeImportTabCallbacks;

  private readonly forgeFileInput: HTMLInputElement;
  private readonly bakingProfileSelect: HTMLSelectElement;
  private readonly idInput: HTMLInputElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly downscaleSelect: HTMLSelectElement;
  private readonly colorModeSelect: HTMLSelectElement;
  private readonly paletteSelect: HTMLSelectElement;
  private readonly stripBgChk: HTMLInputElement;
  private readonly cropChk: HTMLInputElement;
  private readonly outlineChk: HTMLInputElement;
  private readonly ditherChk: HTMLInputElement;
  private readonly sheetColsInput: HTMLInputElement;
  private readonly sheetRowsInput: HTMLInputElement;
  private readonly registerPrefabChk: HTMLInputElement;
  private readonly attachLightChk: HTMLInputElement;
  private readonly registerTileChk: HTMLInputElement;
  private readonly tileLayerSelect: HTMLSelectElement;
  private readonly forgeStatusEl: HTMLDivElement;
  private readonly srcCanvas: HTMLCanvasElement;
  private readonly dstCanvas: HTMLCanvasElement;
  private readonly commitForgeBtn: HTMLButtonElement;

  private readonly packFileInput: HTMLInputElement;
  private readonly applyAtmosphereChk: HTMLInputElement;
  private readonly packStatusEl: HTMLDivElement;

  private loadedSource: { name: string; width: number; height: number; rgba: Uint8Array } | null = null;
  private currentOutput: PixelForgeOutput | null = null;

  constructor(callbacks: PixelForgeImportTabCallbacks) {
    this.callbacks = callbacks;
    const { signal } = this.ac;

    // ==================== TAB 1: UNIVERSAL PIXEL FORGE ====================
    this.forgePaneEl = document.createElement('div');
    this.forgePaneEl.className = 'p7-interop-preview';
    this.forgePaneEl.setAttribute('data-testid', 'pixel-forge-pane');
    this.forgePaneEl.hidden = true;

    this.forgeFileInput = document.createElement('input');
    this.forgeFileInput.type = 'file';
    this.forgeFileInput.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
    this.forgeFileInput.hidden = true;
    this.forgeFileInput.addEventListener(
      'change',
      () => {
        const file = this.forgeFileInput.files?.[0];
        if (file) {
          void this.loadExternalImageFile(file);
          this.forgeFileInput.value = '';
        }
      },
      { signal },
    );

    const dropBar = document.createElement('div');
    dropBar.className = 'p7-interop-dropzone';
    const dzHead = document.createElement('div');
    dzHead.className = 'p7-interop-dz-head';
    dzHead.textContent = '萬用像素煉金爐 (Pixel Forge) — 支援 AI 大圖 / 手繪 PNG / Sprite Sheet';
    const dzHint = document.createElement('div');
    dzHint.className = 'p7-interop-dz-hint';
    dzHint.textContent = '自動偵測網格、四角去背、Oklab 調色盤量化與切幀動畫（最高支援 256×256 立繪）';
    const btnGrp = document.createElement('div');
    btnGrp.className = 'p7-toolbar-group';

    const pickImgBtn = document.createElement('button');
    pickImgBtn.type = 'button';
    pickImgBtn.className = 'p7-btn p7-btn-accent';
    pickImgBtn.textContent = '選擇圖片 (.png / .jpg / .webp)';
    pickImgBtn.addEventListener('click', () => this.forgeFileInput.click(), { signal });

    const demoBtn = document.createElement('button');
    demoBtn.type = 'button';
    demoBtn.className = 'p7-btn';
    demoBtn.setAttribute('data-testid', 'pixel-forge-load-demo');
    demoBtn.textContent = '載入測試示範高解析圖';
    demoBtn.addEventListener(
      'click',
      () => {
        this.loadedSource = buildDemoHighResArt();
        this.idInput.value = 'gothic_lantern_forged';
        this.reprocessPreview();
      },
      { signal },
    );

    btnGrp.append(pickImgBtn, demoBtn);
    dropBar.append(dzHead, dzHint, btnGrp);

    dropBar.addEventListener(
      'dragover',
      (e) => {
        e.preventDefault();
        dropBar.classList.add('is-dragover');
      },
      { signal },
    );
    dropBar.addEventListener(
      'dragleave',
      () => dropBar.classList.remove('is-dragover'),
      { signal },
    );
    dropBar.addEventListener(
      'drop',
      (e) => {
        e.preventDefault();
        dropBar.classList.remove('is-dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) void this.loadExternalImageFile(file);
      },
      { signal },
    );

    this.forgeStatusEl = document.createElement('div');
    this.forgeStatusEl.className = 'p7-interop-status';
    this.forgeStatusEl.textContent = '請選取圖片或點擊「載入測試示範高解析圖」即時預覽像素洗圖效果。';

    // Controls Grid
    const cfgCard = document.createElement('div');
    cfgCard.className = 'p7-rule-card';

    this.bakingProfileSelect = document.createElement('select');
    this.bakingProfileSelect.className = 'p7-select';
    this.bakingProfileSelect.setAttribute('data-testid', 'pixel-forge-profile');
    for (const prof of PIXEL_FORGE_BAKING_PROFILES) {
      const o = document.createElement('option');
      o.value = prof.id;
      o.textContent = prof.label;
      if (prof.id === 'custom') o.selected = true;
      this.bakingProfileSelect.appendChild(o);
    }

    this.idInput = document.createElement('input');
    this.idInput.type = 'text';
    this.idInput.className = 'p7-input p7-mono';
    this.idInput.value = 'forged_asset';

    this.sizeSelect = document.createElement('select');
    this.sizeSelect.className = 'p7-select p7-mono';
    for (const p of TARGET_SIZE_PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      if (p.id === '32x32') opt.selected = true;
      this.sizeSelect.appendChild(opt);
    }

    this.downscaleSelect = document.createElement('select');
    this.downscaleSelect.className = 'p7-select';
    for (const [val, txt] of [
      ['grid_majority', '網格眾數降採樣 (AI/放大圖推薦，不糊邊)'],
      ['lossless', '最近鄰無損直通 (標準像素圖)'],
    ] as const) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = txt;
      this.downscaleSelect.appendChild(o);
    }

    this.colorModeSelect = document.createElement('select');
    this.colorModeSelect.className = 'p7-select';
    for (const [val, txt] of [
      ['palette_lock', '鎖定主題調色盤 (Oklab 風格統一)'],
      ['adaptive_kmeans_32', '自適應 Oklab 32 色萃取'],
      ['adaptive_kmeans_64', '自適應 Oklab 64 色萃取 (立繪推薦)'],
      ['true_color', '原色硬邊 Alpha 直通 (True Color)'],
    ] as const) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = txt;
      this.colorModeSelect.appendChild(o);
    }

    this.paletteSelect = document.createElement('select');
    this.paletteSelect.className = 'p7-select';
    for (const pal of PIXEL_FORGE_PALETTES) {
      const o = document.createElement('option');
      o.value = pal.id;
      o.textContent = pal.label;
      this.paletteSelect.appendChild(o);
    }

    const sheetPair = document.createElement('div');
    sheetPair.className = 'p7-rule-pair';
    this.sheetColsInput = document.createElement('input');
    this.sheetColsInput.type = 'number';
    this.sheetColsInput.min = '1';
    this.sheetColsInput.max = '16';
    this.sheetColsInput.value = '1';
    this.sheetColsInput.className = 'p7-input p7-mono';
    this.sheetColsInput.title = 'Sprite Sheet 欄數 (1=單張)';
    this.sheetRowsInput = document.createElement('input');
    this.sheetRowsInput.type = 'number';
    this.sheetRowsInput.min = '1';
    this.sheetRowsInput.max = '16';
    this.sheetRowsInput.value = '1';
    this.sheetRowsInput.className = 'p7-input p7-mono';
    this.sheetRowsInput.title = 'Sprite Sheet 列數 (1=單張)';
    sheetPair.append(this.sheetColsInput, this.sheetRowsInput);

    cfgCard.append(
      this.wrapField('跨管線烘焙預設 (Baking Profile)', this.bakingProfileSelect),
      this.wrapField('精靈 ID', this.idInput),
      this.wrapField('目標像素規格 (最高 256×256)', this.sizeSelect),
      this.wrapField('降採樣策略', this.downscaleSelect),
      this.wrapField('色彩量化模式', this.colorModeSelect),
      this.wrapField('主題調色盤 (Palette Lock)', this.paletteSelect),
      this.wrapField('Sprite Sheet 切幀 (欄 × 列，大於 1×1 自動建立動畫狀態機)', sheetPair),
    );

    // Toggle options
    const togglesBox = document.createElement('div');
    togglesBox.className = 'p7-interop-options';
    this.stripBgChk = this.makeCheckRow(togglesBox, '自動四角去背（移除純色底圖與毛邊）', true);
    this.cropChk = this.makeCheckRow(togglesBox, '緊密裁切透明外框（僅單張模式）', true);
    this.outlineChk = this.makeCheckRow(togglesBox, '1px 暗線輪廓描邊（強化剪影）', false);
    this.ditherChk = this.makeCheckRow(togglesBox, 'Bayer 4×4 有序抖動（細膩過渡）', true);
    this.registerPrefabChk = this.makeCheckRow(togglesBox, '同步註冊為物件庫 Prefab 印章', true);
    this.attachLightChk = this.makeCheckRow(togglesBox, '自動偵測高光色並掛載動態 LightSource + 自發光', false);

    const tileRow = document.createElement('label');
    tileRow.className = 'p7-interop-check';
    this.registerTileChk = document.createElement('input');
    this.registerTileChk.type = 'checkbox';
    this.registerTileChk.checked = false;
    const tileLbl = document.createElement('span');
    tileLbl.textContent = '同步註冊為地圖瓦片層：';
    this.tileLayerSelect = document.createElement('select');
    this.tileLayerSelect.className = 'p7-select';
    this.tileLayerSelect.disabled = true;
    for (const [val, txt] of [
      ['decor', '裝飾層 (decor)'],
      ['ground', '地板層 (ground)'],
      ['wall', '立體牆面層 (wall · 阻擋)'],
    ] as const) {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = txt;
      this.tileLayerSelect.appendChild(o);
    }
    this.registerTileChk.addEventListener(
      'change',
      () => {
        this.tileLayerSelect.disabled = !this.registerTileChk.checked;
      },
      { signal },
    );
    tileRow.append(this.registerTileChk, tileLbl, this.tileLayerSelect);
    togglesBox.appendChild(tileRow);

    // Side-by-side Live Preview Canvases
    const previewPair = document.createElement('div');
    previewPair.className = 'p7-rule-pair';

    const srcCard = document.createElement('div');
    srcCard.className = 'p7-interop-thumb-card';
    this.srcCanvas = document.createElement('canvas');
    this.srcCanvas.className = 'p7-interop-thumb';
    this.srcCanvas.style.width = '96px';
    this.srcCanvas.style.height = '96px';
    const srcCap = document.createElement('span');
    srcCap.className = 'p7-interop-thumb-cap p7-mono';
    srcCap.textContent = '原始來源圖';
    srcCard.append(this.srcCanvas, srcCap);

    const dstCard = document.createElement('div');
    dstCard.className = 'p7-interop-thumb-card';
    this.dstCanvas = document.createElement('canvas');
    this.dstCanvas.className = 'p7-interop-thumb';
    this.dstCanvas.setAttribute('data-testid', 'pixel-forge-preview-canvas');
    this.dstCanvas.style.width = '96px';
    this.dstCanvas.style.height = '96px';
    const dstCap = document.createElement('span');
    dstCap.className = 'p7-interop-thumb-cap p7-mono';
    dstCap.textContent = '煉金成品 (Crisp Pixel)';
    dstCard.append(this.dstCanvas, dstCap);

    previewPair.append(srcCard, dstCard);

    this.commitForgeBtn = document.createElement('button');
    this.commitForgeBtn.type = 'button';
    this.commitForgeBtn.className = 'p7-primary-cta';
    this.commitForgeBtn.setAttribute('data-testid', 'pixel-forge-commit');
    this.commitForgeBtn.textContent = '寫入專案圖集與工作站（支援復原）';
    this.commitForgeBtn.disabled = true;
    this.commitForgeBtn.addEventListener('click', () => this.commitForgedSprites(), { signal });

    this.bakingProfileSelect.addEventListener(
      'change',
      () => {
        this.applyBakingProfilePreset(this.bakingProfileSelect.value as PixelForgeBakingProfileId);
        this.reprocessPreview();
      },
      { signal },
    );

    for (const ctrl of [
      this.sizeSelect,
      this.downscaleSelect,
      this.colorModeSelect,
      this.paletteSelect,
      this.stripBgChk,
      this.cropChk,
      this.outlineChk,
      this.ditherChk,
      this.sheetColsInput,
      this.sheetRowsInput,
      this.attachLightChk,
    ]) {
      ctrl.addEventListener('change', () => {
        this.paletteSelect.disabled = this.colorModeSelect.value !== 'palette_lock';
        this.reprocessPreview();
      }, { signal });
    }

    this.forgePaneEl.append(
      dropBar,
      this.forgeStatusEl,
      previewPair,
      cfgCard,
      togglesBox,
      this.commitForgeBtn,
    );

    // ==================== TAB 2: CROSS-GENRE ASSET PACKS ====================
    this.packsPaneEl = document.createElement('div');
    this.packsPaneEl.className = 'p7-interop-preview';
    this.packsPaneEl.setAttribute('data-testid', 'asset-packs-pane');
    this.packsPaneEl.hidden = true;

    const packsHead = document.createElement('div');
    packsHead.className = 'p7-section-title';
    packsHead.textContent = '跨題材標準資產包 (PixerAssetPack v1) — 一鍵替換／混搭引擎武器庫';

    this.applyAtmosphereChk = this.makeCheckRow(
      this.packsPaneEl,
      '安裝時一併套用該題材的氛圍光影預設 (ambientDarkness / particles)',
      true,
    );

    this.packStatusEl = document.createElement('div');
    this.packStatusEl.className = 'p7-interop-status';
    this.packStatusEl.textContent = '點選任意內建題材包安裝（支援單步復原），或匯入／匯出可攜式 .pixer-pack.json。';

    const packsList = document.createElement('div');
    packsList.className = 'p7-interop-options';

    for (const summary of BUILTIN_STARTER_PACK_SUMMARIES) {
      const card = document.createElement('div');
      card.className = 'p7-rule-card';
      const head = document.createElement('div');
      head.className = 'p7-rule-card-head';
      const title = document.createElement('strong');
      title.textContent = summary.name;
      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
      installBtn.setAttribute('data-testid', `install-pack-${summary.genre}`);
      installBtn.textContent = '一鍵安裝資產包';
      installBtn.addEventListener('click', () => this.installStarterPack(summary.genre), { signal });
      head.append(title, installBtn);

      const desc = document.createElement('div');
      desc.className = 'p7-meta-line';
      desc.textContent = summary.description;
      card.append(head, desc);
      packsList.appendChild(card);
    }

    this.packFileInput = document.createElement('input');
    this.packFileInput.type = 'file';
    this.packFileInput.accept = '.json,.pixer-pack.json,application/json';
    this.packFileInput.hidden = true;
    this.packFileInput.addEventListener(
      'change',
      () => {
        const file = this.packFileInput.files?.[0];
        if (file) {
          void this.installUploadedPack(file);
          this.packFileInput.value = '';
        }
      },
      { signal },
    );

    const ioBar = document.createElement('div');
    ioBar.className = 'p7-toolbar-group';
    const importPackBtn = document.createElement('button');
    importPackBtn.type = 'button';
    importPackBtn.className = 'p7-btn';
    importPackBtn.textContent = '匯入外部 .pixer-pack.json';
    importPackBtn.addEventListener('click', () => this.packFileInput.click(), { signal });

    const exportPackBtn = document.createElement('button');
    exportPackBtn.type = 'button';
    exportPackBtn.className = 'p7-btn p7-btn-accent';
    exportPackBtn.setAttribute('data-testid', 'export-asset-pack');
    exportPackBtn.textContent = '將目前專案匯出為 .pixer-pack.json';
    exportPackBtn.addEventListener('click', () => this.exportCurrentProjectPack(), { signal });
    ioBar.append(importPackBtn, exportPackBtn);

    this.packsPaneEl.prepend(packsHead);
    this.packsPaneEl.append(this.packStatusEl, packsList, this.packFileInput, ioBar);
  }

  private wrapField(label: string, control: HTMLElement): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'p7-rule-field';
    const sp = document.createElement('span');
    sp.textContent = label;
    row.append(sp, control);
    return row;
  }

  private makeCheckRow(parent: HTMLElement, text: string, checked: boolean): HTMLInputElement {
    const row = document.createElement('label');
    row.className = 'p7-interop-check';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = checked;
    const sp = document.createElement('span');
    sp.textContent = text;
    row.append(chk, sp);
    parent.appendChild(row);
    return chk;
  }

  private applyBakingProfilePreset(profileId: PixelForgeBakingProfileId): void {
    const prof = PIXEL_FORGE_BAKING_PROFILES.find((p) => p.id === profileId);
    if (!prof || prof.id === 'custom') return;
    this.sizeSelect.value = `${prof.targetWidth}x${prof.targetHeight}`;
    this.downscaleSelect.value = prof.downscaleMode;
    this.colorModeSelect.value =
      prof.colorMode === 'adaptive_kmeans'
        ? prof.maxColors >= 64
          ? 'adaptive_kmeans_64'
          : 'adaptive_kmeans_32'
        : prof.colorMode;
    this.paletteSelect.disabled = this.colorModeSelect.value !== 'palette_lock';
    this.stripBgChk.checked = prof.stripBackground;
    this.cropChk.checked = prof.cropOpaque;
    this.outlineChk.checked = Boolean(prof.outlineHex);
    this.ditherChk.checked = prof.dither;
    this.registerPrefabChk.checked = prof.registerPrefab;
    this.attachLightChk.checked = Boolean(prof.attachLight);
    if (prof.registerTileLayer) {
      this.registerTileChk.checked = true;
      this.tileLayerSelect.disabled = false;
      this.tileLayerSelect.value = prof.registerTileLayer;
    } else {
      this.registerTileChk.checked = false;
      this.tileLayerSelect.disabled = true;
    }
  }

  private async loadExternalImageFile(file: File): Promise<void> {
    this.forgeStatusEl.className = 'p7-interop-status';
    this.forgeStatusEl.textContent = `正在讀取與洗圖：${file.name}...`;
    const decoded = await decodeImageFileToRgba(file);
    if (!decoded) {
      this.forgeStatusEl.className = 'p7-interop-status is-error';
      this.forgeStatusEl.textContent = `無法解碼圖片「${file.name}」，請確認為有效的 PNG/JPG/WebP。`;
      return;
    }
    const cleanId = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
    this.idInput.value = cleanId || 'forged_sprite';
    this.loadedSource = { name: file.name, ...decoded };
    this.reprocessPreview();
  }

  private reprocessPreview(): void {
    if (!this.loadedSource) return;
    paintRgbaOnCanvas(
      this.srcCanvas,
      this.loadedSource.rgba,
      this.loadedSource.width,
      this.loadedSource.height,
    );

    const preset = TARGET_SIZE_PRESETS.find((p) => p.id === this.sizeSelect.value) ?? TARGET_SIZE_PRESETS[1];
    const modeRaw = this.colorModeSelect.value;
    let colorMode: PixelForgeColorMode = 'palette_lock';
    let maxColors = 32;
    if (modeRaw === 'adaptive_kmeans_32') {
      colorMode = 'adaptive_kmeans';
      maxColors = 32;
    } else if (modeRaw === 'adaptive_kmeans_64') {
      colorMode = 'adaptive_kmeans';
      maxColors = 64;
    } else if (modeRaw === 'true_color') {
      colorMode = 'true_color';
    }

    const bakingProfile = this.bakingProfileSelect.value as PixelForgeBakingProfileId;
    const out = forgeImageToCustomSprites(
      {
        id: this.idInput.value.trim() || 'forged_sprite',
        name: this.loadedSource.name,
        width: this.loadedSource.width,
        height: this.loadedSource.height,
        rgba: this.loadedSource.rgba,
      },
      {
        id: this.idInput.value.trim() || 'forged_sprite',
        bakingProfile,
        targetWidth: preset.w,
        targetHeight: preset.h,
        downscaleMode: this.downscaleSelect.value as PixelForgeDownscaleMode,
        colorMode,
        maxColors,
        paletteId: this.paletteSelect.value as PixelForgePaletteId,
        stripBackground: this.stripBgChk.checked,
        cropOpaque: this.cropChk.checked,
        outlineHex: this.outlineChk.checked ? '#090b12' : null,
        dither: this.ditherChk.checked,
        sheetCols: Math.max(1, Number(this.sheetColsInput.value) || 1),
        sheetRows: Math.max(1, Number(this.sheetRowsInput.value) || 1),
      },
    );

    this.currentOutput = out;
    const first = out.previewFrames[0];
    if (first) {
      paintRgbaOnCanvas(this.dstCanvas, first.rgba, first.width, first.height);
    }
    this.commitForgeBtn.disabled = out.sprites.length === 0;
    this.forgeStatusEl.className = 'p7-interop-status is-ok';
    const extraNotes: string[] = [];
    if (out.wallSideSpriteId) {
      extraNotes.push(`牆頂/牆側雙貼圖 (${out.sprites[0]?.id} + ${out.wallSideSpriteId})`);
    }
    if (this.attachLightChk.checked && out.detectedLight) {
      extraNotes.push(`自動光源 ${out.detectedLight.color} R=${out.detectedLight.radius}`);
    }
    if (out.animations.length > 0) {
      extraNotes.push(`自動生成動畫 ${out.animations[0].id}`);
    }
    this.forgeStatusEl.textContent =
      `已煉製 ${out.sprites.length} 張精靈 (${preset.w}×${preset.h}) · 偵測原圖像素塊=${out.detectedBlockSize}×` +
      (extraNotes.length > 0 ? ` · ${extraNotes.join(' · ')}` : '');
  }

  private commitForgedSprites(): void {
    if (!this.currentOutput) return;
    const project = this.callbacks.getProject();
    const profId = this.bakingProfileSelect.value as PixelForgeBakingProfileId;
    const prof = PIXEL_FORGE_BAKING_PROFILES.find((p) => p.id === profId);
    const cmds = buildPixelForgeCommitCommands(this.currentOutput, project, {
      registerPrefab: this.registerPrefabChk.checked,
      attachLight: this.attachLightChk.checked,
      prefabCategory: prof?.prefabCategory,
      registerTileLayer: this.registerTileChk.checked
        ? (this.tileLayerSelect.value as EcsMapLayerName)
        : undefined,
      tileSolid: prof?.tileSolid,
      tileExtrudeH: prof?.tileExtrudeH,
    });
    if (cmds.length === 0) return;

    const label = this.currentOutput.sprites[0]?.id ?? 'forged_sprite';
    this.callbacks.onCommitCommands(cmds, `Pixel Forge 寫入 ${label}`, {
      leftTab: this.registerTileChk.checked ? 'map' : this.registerPrefabChk.checked ? 'prefabs' : 'atlas',
    });
    this.callbacks.onRequestClose();
  }

  private installStarterPack(genre: BuiltinStarterPackGenre): void {
    const pack = buildBuiltinStarterPack(genre);
    const cmds = buildAssetPackInstallCommands(pack, this.callbacks.getProject(), {
      applyAtmosphere: this.applyAtmosphereChk.checked,
    });
    this.callbacks.onCommitCommands(cmds, `安裝資產包：${pack.name}`, {
      leftTab: pack.tileDefs?.length ? 'map' : 'prefabs',
    });
    this.packStatusEl.className = 'p7-interop-status is-ok';
    this.packStatusEl.textContent =
      `已安裝「${pack.name}」（${pack.sprites.length} 張精靈 · ${pack.tileDefs?.length ?? 0} 瓦片 · ${Object.keys(pack.prefabs ?? {}).length} Prefab）！`;
  }

  private async installUploadedPack(file: File): Promise<void> {
    try {
      const text = await file.text();
      const valid = validateAssetPackManifest(JSON.parse(text));
      if (!valid.ok) {
        this.packStatusEl.className = 'p7-interop-status is-error';
        this.packStatusEl.textContent = `資產包驗證失敗：${valid.errors[0] ?? '格式不符'}`;
        return;
      }
      const cmds = buildAssetPackInstallCommands(valid.pack, this.callbacks.getProject(), {
        applyAtmosphere: this.applyAtmosphereChk.checked,
      });
      this.callbacks.onCommitCommands(cmds, `匯入資產包：${valid.pack.name}`, {
        leftTab: valid.pack.tileDefs?.length ? 'map' : 'prefabs',
      });
      this.packStatusEl.className = 'p7-interop-status is-ok';
      this.packStatusEl.textContent = `已匯入「${valid.pack.name}」（${valid.pack.sprites.length} 張精靈）！`;
    } catch (err) {
      this.packStatusEl.className = 'p7-interop-status is-error';
      this.packStatusEl.textContent = `解析資產包失敗：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private exportCurrentProjectPack(): void {
    const proj = this.callbacks.getProject();
    const pack = exportProjectAsAssetPack(proj);
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pack.id}.pixer-pack.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.packStatusEl.className = 'p7-interop-status is-ok';
    this.packStatusEl.textContent = `已匯出資產包：${pack.id}.pixer-pack.json（含 ${pack.sprites.length} 張自訂精靈）`;
  }

  public destroy(): void {
    this.ac.abort();
    this.forgePaneEl.remove();
    this.packsPaneEl.remove();
  }
}
