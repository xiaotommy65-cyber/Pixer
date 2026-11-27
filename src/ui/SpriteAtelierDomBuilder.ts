import { PALETTE_THEMES } from '../assets/sprites/PaletteData.ts';
import { PARKOUR_SPRITE_GRIDS } from '../assets/sprites/ParkourSprites.ts';
import { DEFAULT_HERO_FRAME_A, DEFAULT_HERO_FRAME_B } from '../assets/TextureAtlas.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import { btn, el } from './dom.ts';
import {
  BEAR_PRESET_A,
  BEAR_PRESET_B,
  BUNNY_PRESET_A,
  BUNNY_PRESET_B,
  PIXEL_STAMPS,
  type StampDef,
} from './SpriteAtelierPixelOps.ts';

export type SlotKey = 'hero' | 'custom_enemy' | 'custom_item' | 'custom_tile' | 'studio_claw';
export type PaintTool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

export interface SlotState {
  label: string;
  gridW: number;
  gridH: number;
  frameCount: 2 | 3 | 4;
  frames: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

export interface SpriteAtelierDomRefs {
  head: HTMLElement;
  sidebar: HTMLElement;
  paletteEls: HTMLButtonElement[];
  slotBtns: Map<SlotKey, HTMLButtonElement>;
  frameBtns: HTMLButtonElement[];
  frameCountSelect: HTMLSelectElement;
  sizeBtn: HTMLButtonElement;
  themeSelect: HTMLSelectElement;
  stampBtns: Map<string, HTMLButtonElement>;
  pencilBtn: HTMLButtonElement;
  eraserBtn: HTMLButtonElement;
  fillBtn: HTMLButtonElement;
  eyedropBtn: HTMLButtonElement;
  onionBtn: HTMLButtonElement;
  mirrorBtn: HTMLButtonElement;
  undoBtn: HTMLButtonElement;
  importInput: HTMLInputElement;
  importBtn: HTMLButtonElement;
  importStatusEl: HTMLElement;
  previewCanvas: HTMLCanvasElement;
  previewCtx: CanvasRenderingContext2D | null;
  lightCoordEl: HTMLElement;
  publishNameInput: HTMLInputElement;
  publishLayerSelect: HTMLSelectElement;
  publishSolidCheck: HTMLInputElement;
  publishHazardCheck: HTMLInputElement;
  publishLightCheck: HTMLInputElement;
  publishStatusEl: HTMLElement;
}

export interface SpriteAtelierDomCallbacks {
  signal: AbortSignal;
  previewCanvasPx: number;
  slots: Record<SlotKey, SlotState>;
  onSelectSlot: (key: SlotKey) => void;
  onToggleGridSize: () => void;
  onChangeFrameCount: (nextCount: 2 | 3 | 4) => void;
  onSelectFrame: (idx: number) => void;
  onToggleOnionSkin: () => void;
  onPreviewPointerMove: (normX: number, normY: number) => void;
  onPreviewPointerLeave: () => void;
  onSelectTheme: (themeIdx: number) => void;
  onSelectPaletteColor: (colorIdx: number) => void;
  onSelectTool: (tool: PaintTool | 'toggle_fill' | 'toggle_eyedropper') => void;
  onToggleMirrorX: () => void;
  onUndo: () => void;
  onCopyPrevFrame: () => void;
  onAutoOutline: () => void;
  onImportFile: (file: File) => void;
  onToggleStamp: (stamp: StampDef) => void;
  onApplyHeroPreset: (gridA: string[], gridB: string[]) => void;
  onPublishMapTile: () => void;
  onPublishPrefabStamp: () => void;
}

/**
 * Builds the header (slot selector + frame/resolution controls) and sidebar
 * (normal-lit preview, 16-color LUT palette, tools, stamps, presets, and publish form)
 * for `SpriteAtelierView`.
 */
export function buildSpriteAtelierDom(cb: SpriteAtelierDomCallbacks): SpriteAtelierDomRefs {
  const { signal } = cb;

  const head = el('div', 'studio-head');
  const headTitleWrap = el('div');
  headTitleWrap.append(
    el('h2', undefined, '🎨 精靈畫室 3.1（16×16 / 32×32 / 48×64 HD-2D 像素工坊）'),
    el(
      'p',
      'studio-sub',
      '支援多尺寸畫布、PNG 圖片 Oklab 量化匯入、自動描邊立體化、法線打光預覽，並可一鍵發佈為地圖瓦片與物件印章！',
    ),
  );
  head.appendChild(headTitleWrap);

  const slotBtns = new Map<SlotKey, HTMLButtonElement>();
  const slotRow = el('div', 'tool-row');
  (Object.keys(cb.slots) as SlotKey[]).forEach((key) => {
    const b = btn(
      key === 'hero' ? 'toy-btn is-active' : 'toy-btn',
      cb.slots[key].label,
      undefined,
      () => cb.onSelectSlot(key),
      signal,
    );
    slotBtns.set(key, b);
    slotRow.appendChild(b);
  });

  const frameBar = el('div', 'tool-row');
  const sizeBtn = btn(
    'toy-btn is-mint',
    '📐 16×16',
    '循環切換目前槽位解析度：16×16 → 32×32 → 48×64（自動保留像素縮放）',
    cb.onToggleGridSize,
    signal,
  );
  frameBar.appendChild(sizeBtn);

  const frameCountSelect = el('select', 'atelier-select');
  frameCountSelect.title = '動畫總幀數';
  for (const n of [2, 3, 4] as const) {
    const opt = el('option');
    opt.value = String(n);
    opt.textContent = `${n} 幀動畫`;
    frameCountSelect.appendChild(opt);
  }
  frameCountSelect.addEventListener(
    'change',
    () => cb.onChangeFrameCount(Number(frameCountSelect.value) as 2 | 3 | 4),
    { signal },
  );
  frameBar.appendChild(frameCountSelect);

  const frameBtns: HTMLButtonElement[] = [];
  ['A', 'B', 'C', 'D'].forEach((label, idx) => {
    const fBtn = btn(
      idx === 0 ? 'toy-btn is-active' : 'toy-btn',
      `幀 ${label}`,
      undefined,
      () => cb.onSelectFrame(idx),
      signal,
    );
    frameBtns.push(fBtn);
    frameBar.appendChild(fBtn);
  });

  const onionBtn = btn(
    'toy-btn',
    '🧅 洋蔥皮',
    '在背景半透明顯示前一幀參考線（不寫入紋理）',
    cb.onToggleOnionSkin,
    signal,
  );
  frameBar.appendChild(onionBtn);
  head.append(slotRow, frameBar);

  const sidebar = el('div', 'atelier-sidebar');

  // Interactive 96x96 HD-2D Normal + Point-Light Preview Card
  const previewCard = el('div', 'atelier-preview-card');
  const previewCanvas = el('canvas', 'atelier-preview-canvas');
  previewCanvas.width = cb.previewCanvasPx;
  previewCanvas.height = cb.previewCanvasPx;
  const previewCtx = previewCanvas.getContext('2d');
  if (previewCtx) {
    previewCtx.imageSmoothingEnabled = false;
  }

  previewCanvas.addEventListener(
    'pointermove',
    (e) => {
      const rect = previewCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
      const ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
      cb.onPreviewPointerMove(nx, ny);
    },
    { passive: true, signal },
  );
  previewCanvas.addEventListener('pointerleave', cb.onPreviewPointerLeave, { signal });

  const previewMeta = el('div', 'atelier-preview-meta');
  const previewTitle = el('strong', undefined, 'HD-2D 即時法線打光預覽');
  const lightCoordEl = el('div', 'atelier-light-readout', '光源角度 -130° (-0.55, -0.65)');

  const themeSelect = el('select', 'atelier-select');
  themeSelect.title = '切換 8 組 LUT 主題預設';
  PALETTE_THEMES.forEach((t, idx) => {
    const opt = el('option');
    opt.value = String(idx);
    opt.textContent = `🎨 ${idx}: ${t.label}`;
    themeSelect.appendChild(opt);
  });
  themeSelect.addEventListener(
    'change',
    () => cb.onSelectTheme(Number(themeSelect.value) || 0),
    { signal },
  );
  previewMeta.append(previewTitle, lightCoordEl, themeSelect);
  previewCard.append(previewCanvas, previewMeta);

  // 16-Color LUT Palette (14..15 marked as Bloom glow)
  const paletteEls: HTMLButtonElement[] = [];
  const paletteGrid = el('div', 'palette-grid');
  for (let idx = 0; idx < 16; idx++) {
    const isGlow = idx === 14 || idx === 15;
    const chip = btn(
      idx === 0 ? 'palette-chip is-eraser' : isGlow ? 'palette-chip is-emissive' : 'palette-chip',
      isGlow ? '✨' : '',
      idx === 0 ? '透明橡皮擦' : isGlow ? `色號 ${idx} (Bloom 發光色)` : `色號 ${idx}`,
      () => cb.onSelectPaletteColor(idx),
      signal,
    );
    paletteEls.push(chip);
    paletteGrid.appendChild(chip);
  }

  // Core Studio Tools
  const tools = el('div', 'tool-row atelier-tool-group');
  const pencilBtn = btn('toy-btn is-active', '✏️ 畫筆', undefined, () => cb.onSelectTool('pencil'), signal);
  const eraserBtn = btn(
    'toy-btn',
    '🧽 橡皮',
    '切換橡皮擦工具（亦可於畫布上按右鍵擦除）',
    () => cb.onSelectTool('eraser'),
    signal,
  );
  const fillBtn = btn('toy-btn', '🪣 油漆桶', undefined, () => cb.onSelectTool('toggle_fill'), signal);
  const eyedropBtn = btn(
    'toy-btn',
    '💧 吸色',
    '點擊畫布吸取色號（亦可按住 Alt 點擊）',
    () => cb.onSelectTool('toggle_eyedropper'),
    signal,
  );
  const mirrorBtn = btn('toy-btn', '🪞 左右對稱', undefined, cb.onToggleMirrorX, signal);
  const undoBtn = btn('toy-btn', '↩ 復原', '最多支援 20 步復原', cb.onUndo, signal);
  const copyPrevBtn = btn('toy-btn', '📋 複製上幀', undefined, cb.onCopyPrevFrame, signal);
  tools.append(pencilBtn, eraserBtn, fillBtn, eyedropBtn, mirrorBtn, undoBtn, copyPrevBtn);

  // Pro Actions: Auto-Outline/Bevel + PNG/AI Image Import
  const proRow = el('div', 'tool-row atelier-tool-group');
  const autoOutlineBtn = btn(
    'toy-btn is-honey',
    '✨ 自動描邊立體化',
    '為目前圖層加上 1px 深色輪廓並提亮左上方高光邊緣',
    cb.onAutoOutline,
    signal,
  );

  const importInput = el('input', 'panel-hidden');
  importInput.type = 'file';
  importInput.accept = 'image/png,image/webp,image/jpeg';
  importInput.addEventListener(
    'change',
    () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (file) cb.onImportFile(file);
    },
    { signal },
  );

  const importBtn = btn(
    'toy-btn is-mint',
    '📥 匯入 PNG / AI 圖',
    '自動去背裁切並以 Oklab 感知色距量化至 Toybox 16 色盤',
    () => importInput.click(),
    signal,
  );
  const importStatusEl = el('span', 'studio-sub');
  proRow.append(autoOutlineBtn, importBtn, importInput, importStatusEl);

  // 6 Pixel Stamps
  const stampBtns = new Map<string, HTMLButtonElement>();
  const stampRow = el('div', 'tool-row');
  for (const stamp of PIXEL_STAMPS) {
    const sBtn = btn(
      'toy-btn is-mint',
      stamp.label,
      `點擊畫布蓋上「${stamp.label}」像素圖章`,
      () => cb.onToggleStamp(stamp),
      signal,
    );
    stampBtns.set(stamp.id, sBtn);
    stampRow.appendChild(sBtn);
  }

  // 4 Hero Presets
  const presetRow = el('div', 'tool-row');
  const addPresetBtn = (label: string, gridA: string[], gridB: string[]) => {
    presetRow.appendChild(
      btn('toy-btn is-honey', label, undefined, () => cb.onApplyHeroPreset(gridA, gridB), signal),
    );
  };
  addPresetBtn('🌱 嫩芽騎士', DEFAULT_HERO_FRAME_A, DEFAULT_HERO_FRAME_B);
  addPresetBtn('🍓 草莓小兔', BUNNY_PRESET_A, BUNNY_PRESET_B);
  addPresetBtn('🍯 蜂蜜小熊', BEAR_PRESET_A, BEAR_PRESET_B);
  addPresetBtn('🧣 緋空跑酷俠', PARKOUR_SPRITE_GRIDS.parkour_hero_idle, PARKOUR_SPRITE_GRIDS.parkour_hero_dash);

  // One-Click Publish to Workstation Map Designer (M1)
  const publishCard = el('div', 'atelier-publish-card');
  const pubTitle = el('strong', 'atelier-publish-title', '🚀 一鍵發佈至工作站地圖 (動態 GPU 圖集)');

  const pubForm = el('div', 'atelier-publish-grid');
  const publishNameInput = el('input', 'atelier-input');
  publishNameInput.type = 'text';
  publishNameInput.placeholder = '自訂資產名稱（例：翠玉地磚）';
  publishNameInput.value = '自訂像素磚 #1';
  publishNameInput.setAttribute('aria-label', '自訂資產名稱');

  const publishLayerSelect = el('select', 'atelier-select');
  publishLayerSelect.setAttribute('aria-label', '目標地圖圖層');
  const layerOpts: [EcsMapLayerName, string][] = [
    ['ground', '圖層：地板 (ground)'],
    ['wall', '圖層：立體城牆 (wall · 20px)'],
    ['decor', '圖層：裝飾 (decor)'],
  ];
  for (const [val, text] of layerOpts) {
    const o = el('option');
    o.value = val;
    o.textContent = text;
    publishLayerSelect.appendChild(o);
  }
  pubForm.append(publishNameInput, publishLayerSelect);

  const flagsRow = el('div', 'atelier-publish-flags');
  const mkFlag = (labelText: string, checked: boolean): HTMLInputElement => {
    const lbl = el('label', 'atelier-flag-label');
    const cbInput = el('input');
    cbInput.type = 'checkbox';
    cbInput.checked = checked;
    lbl.append(cbInput, document.createTextNode(labelText));
    flagsRow.appendChild(lbl);
    return cbInput;
  };
  const publishSolidCheck = mkFlag('實體碰撞', false);
  const publishHazardCheck = mkFlag('傷害陷阱', false);
  const publishLightCheck = mkFlag('附帶光源', false);

  publishLayerSelect.addEventListener(
    'change',
    () => {
      if (publishLayerSelect.value === 'wall') {
        publishSolidCheck.checked = true;
      }
    },
    { signal },
  );

  const pubBtns = el('div', 'tool-row atelier-publish-actions');
  const pubTileBtn = btn(
    'toy-btn is-honey',
    '🧩 發佈為地圖瓦片',
    '將目前畫布即時編譯進動態 GPU 圖集並加入地圖瓦片盤',
    cb.onPublishMapTile,
    signal,
  );
  pubTileBtn.setAttribute('data-atelier-publish-tile', 'true');

  const pubPrefabBtn = btn(
    'toy-btn is-mint',
    '📌 發佈為物件印章',
    '將目前畫布即時編譯並註冊為可放置的 ECS Prefab 印章',
    cb.onPublishPrefabStamp,
    signal,
  );
  pubPrefabBtn.setAttribute('data-atelier-publish-prefab', 'true');

  pubBtns.append(pubTileBtn, pubPrefabBtn);
  const publishStatusEl = el(
    'div',
    'studio-sub atelier-publish-status',
    '支援 16×16 / 32×32 / 48×64 即時熱編譯，無需重開專案。',
  );
  publishCard.append(pubTitle, pubForm, flagsRow, pubBtns, publishStatusEl);

  sidebar.append(previewCard, paletteGrid, tools, proRow, stampRow, presetRow, publishCard);

  return {
    head,
    sidebar,
    paletteEls,
    slotBtns,
    frameBtns,
    frameCountSelect,
    sizeBtn,
    themeSelect,
    stampBtns,
    pencilBtn,
    eraserBtn,
    fillBtn,
    eyedropBtn,
    onionBtn,
    mirrorBtn,
    undoBtn,
    importInput,
    importBtn,
    importStatusEl,
    previewCanvas,
    previewCtx,
    lightCoordEl,
    publishNameInput,
    publishLayerSelect,
    publishSolidCheck,
    publishHazardCheck,
    publishLightCheck,
    publishStatusEl,
  };
}

/** Updates LUT swatch chip background colors and emissive badges for the selected palette theme. */
export function syncAtelierPaletteColors(
  paletteEls: readonly HTMLButtonElement[],
  themeIdx: number,
): void {
  const theme = PALETTE_THEMES[themeIdx] ?? PALETTE_THEMES[0];
  paletteEls.forEach((chip, idx) => {
    if (idx === 0) return;
    const hex = theme.colors[idx] ?? '#ffffff';
    chip.style.backgroundColor = hex;
    const isGlow = (idx === 14 && theme.emissive14 > 0) || (idx === 15 && theme.emissive15 > 0);
    chip.classList.toggle('is-emissive-active', isGlow);
  });
}

/** Updates active selection highlight across the 16 palette swatches. */
export function syncAtelierPaletteSelection(
  paletteEls: readonly HTMLButtonElement[],
  selectedColor: number,
): void {
  paletteEls.forEach((chip, i) => {
    chip.classList.toggle('is-selected', i === selectedColor);
  });
}

/** Syncs all toolbar active toggles, frame tabs, grid size label, and undo availability. */
export function syncAtelierToolbarState(
  refs: SpriteAtelierDomRefs,
  state: {
    activeSlot: SlotKey;
    slot: SlotState;
    activeFrameIdx: number;
    activeTool: PaintTool;
    activeStamp: StampDef | null;
    onionSkin: boolean;
    mirrorX: boolean;
    undoCount: number;
  },
): void {
  for (const [key, b] of refs.slotBtns.entries()) {
    b.classList.toggle('is-active', key === state.activeSlot);
  }
  refs.sizeBtn.textContent = `📐 ${state.slot.gridW}×${state.slot.gridH}`;
  refs.sizeBtn.classList.toggle('is-active', state.slot.gridW !== 16 || state.slot.gridH !== 16);
  refs.frameCountSelect.value = String(state.slot.frameCount);
  refs.frameBtns.forEach((b, i) => {
    b.classList.toggle('panel-hidden', i >= state.slot.frameCount);
    b.classList.toggle('is-active', i === state.activeFrameIdx);
  });
  refs.pencilBtn.classList.toggle('is-active', state.activeTool === 'pencil' && !state.activeStamp);
  refs.eraserBtn.classList.toggle('is-active', state.activeTool === 'eraser' && !state.activeStamp);
  refs.fillBtn.classList.toggle('is-active', state.activeTool === 'fill' && !state.activeStamp);
  refs.eyedropBtn.classList.toggle('is-active', state.activeTool === 'eyedropper' && !state.activeStamp);
  refs.onionBtn.classList.toggle('is-active', state.onionSkin);
  refs.mirrorBtn.classList.toggle('is-active', state.mirrorX);
  refs.undoBtn.disabled = state.undoCount === 0;
  for (const [id, b] of refs.stampBtns.entries()) {
    b.classList.toggle('is-active', state.activeStamp?.id === id);
  }
}
