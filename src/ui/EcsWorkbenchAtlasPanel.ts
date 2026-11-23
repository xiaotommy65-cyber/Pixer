import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { createAtlasThumbCanvas } from './EcsMapDesignerPanel.ts';

export interface AtlasPanelCallbacks {
  onOpenExternalImport: () => void;
  onOpenSpriteAtelier: () => void;
  onSyncAtlasAndRefresh: () => void;
}

/**
 * Modular Atlas Pool & Sprite Sheet Slicer panel extracted from `EcsWorkbenchView.ts`.
 * Displays multi-page TextureAtlas stats, project-embedded custom pixel sprites,
 * local PNG sheet slicing, and procedural sample sheet generation.
 */
export function renderAtlasPanel(
  container: HTMLElement,
  atlas: TextureAtlas,
  session: EcsStudioSession,
  callbacks: AtlasPanelCallbacks,
): void {
  const stats = atlas.getAtlasStats();
  const sheets = atlas.listSpriteSheets();

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
  openInteropBtn.addEventListener('click', () => callbacks.onOpenExternalImport());
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
    void importPngSpriteSheetIntoAtlas(atlas, file, cols, rowsVal).then((ok) => {
      if (ok) callbacks.onSyncAtlasAndRefresh();
    });
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
    generateProceduralSampleSheetIntoAtlas(atlas);
    callbacks.onSyncAtlasAndRefresh();
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
  const customList = Object.values(session.getProject().customSprites ?? {});
  csTitle.textContent = `專案自訂像素精靈 (${customList.length})`;
  const csAddBtn = document.createElement('button');
  csAddBtn.type = 'button';
  csAddBtn.className = 'p7-btn p7-btn-xs p7-btn-accent';
  csAddBtn.textContent = '+ 畫室繪製';
  csAddBtn.addEventListener('click', () => callbacks.onOpenSpriteAtelier());
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
      const thumb = createAtlasThumbCanvas(atlas, cs.id, 32);
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
        session.dispatch({ type: 'remove_custom_sprite', spriteId: cs.id });
      });
      row.append(thumb, meta, delBtn);
      customSec.appendChild(row);
    }
  }

  container.append(statSec, customSec, sliceSec, listSec);
}

async function importPngSpriteSheetIntoAtlas(
  atlas: TextureAtlas,
  file: File,
  cols: number,
  rows: number,
): Promise<boolean> {
  const bmp = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(bmp, 0, 0);
    const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const cleanId = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'sheet';
    atlas.importSpriteSheet(cleanId, new Uint8Array(imgData.data.buffer), canvas.width, canvas.height, cols, rows);
    return true;
  } finally {
    bmp.close();
  }
}

function generateProceduralSampleSheetIntoAtlas(atlas: TextureAtlas): void {
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
  const id = `star_crystal_sheet_${atlas.listSpriteSheets().length + 1}`;
  atlas.importSpriteSheet(id, rgba, imgW, imgH, cols, rows);
}
