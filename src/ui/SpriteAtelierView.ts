import { BUILTIN_SPRITE_GRIDS } from '../assets/AtlasSpritesData.ts';
import { PALETTE_THEMES } from '../assets/sprites/PaletteData.ts';
import { PARKOUR_SPRITE_GRIDS } from '../assets/sprites/ParkourSprites.ts';
import {
  DEFAULT_HERO_FRAME_A,
  DEFAULT_HERO_FRAME_B,
  parseGridToIndices,
  TILE_PX,
} from '../assets/TextureAtlas.ts';
import type { ToySynth } from '../core/audio/ToySynth.ts';
import type { EcsCustomSpriteDef } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import type { GpuEngine } from '../core/gpu/GpuEngine.ts';
import { linearRgbToOklab, srgbToLinear } from '../core/math/ColorMath.ts';
import type { SaveService } from '../core/runtime/SaveService.ts';
import { btn, el } from './dom.ts';

const HEX_DIGITS = '.123456789abcdef';
const BOARD_CANVAS_PX = 384;
const PREVIEW_CANVAS_PX = 96;
const MAX_UNDO_STEPS = 20;

export function indicesToGrid(buf: Uint8Array, w = TILE_PX, h = TILE_PX): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      row += HEX_DIGITS[buf[y * w + x] ?? 0] ?? '.';
    }
    rows.push(row);
  }
  return rows;
}

export interface PublishMapTileRequest {
  sprite: EcsCustomSpriteDef;
  name: string;
  layer: EcsMapLayerName;
  solid: boolean;
  hazard: boolean;
  extrudeH?: number;
  renderH?: number;
  ambientLight?: { radius: number; color: string; intensity: number };
}

export interface PublishPrefabStampRequest {
  sprite: EcsCustomSpriteDef;
  name: string;
  solid: boolean;
  ambientLight?: { radius: number; color: string; intensity: number };
}

export interface PublishActionResult {
  ok: boolean;
  message: string;
}

export interface SpriteAtelierPublishBridge {
  onPublishMapTile: (req: PublishMapTileRequest) => PublishActionResult;
  onPublishPrefabStamp: (req: PublishPrefabStampRequest) => PublishActionResult;
}

type SlotKey = 'hero' | 'custom_enemy' | 'custom_item' | 'custom_tile' | 'studio_claw';
type GridPresetKey = '16x16' | '32x32' | '48x64';
type PaintTool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

const GRID_PRESETS: readonly { key: GridPresetKey; w: number; h: number; label: string }[] = [
  { key: '16x16', w: 16, h: 16, label: '16×16' },
  { key: '32x32', w: 32, h: 32, label: '32×32' },
  { key: '48x64', w: 48, h: 64, label: '48×64' },
];

interface StampDef {
  id: string;
  label: string;
  grid: readonly string[];
}

const PIXEL_STAMPS: readonly StampDef[] = [
  { id: 'eye', label: '👁 眼睛', grid: ['.11.', '1211', '.11.'] },
  { id: 'crown', label: '👑 皇冠', grid: ['8.8.8', '88888', '94849'] },
  { id: 'flame', label: '🔥 火焰', grid: ['..e..', '.e8e.', 'e898e', '.949.'] },
  { id: 'wing', label: '🪽 翅膀', grid: ['22...', '232..', '.232.', '..22.'] },
  { id: 'sword', label: '⚔ 劍', grid: ['..2.', '.2e.', '81..', '18..'] },
  { id: 'gem', label: '💎 寶石', grid: ['.ee.', 'e2fe', 'efae', '.ee.'] },
];

const BUNNY_PRESET_A: string[] = [
  '..11........11..',
  '.1441......1441.',
  '.1431......1341.',
  '.14411111111441.',
  '1222222222222221',
  '1221122222211221',
  '1233222442223321',
  '.12222222222221.',
  '..111448844111..',
  '..144448844441..',
  '..144224422441..',
  '...1444444441...',
  '...1122112211...',
  '...1221..1221...',
  '..1111....1111..',
  '................',
];

const BUNNY_PRESET_B: string[] = [
  '..11........11..',
  '.1441......1441.',
  '.1431......1341.',
  '.14411111111441.',
  '1222222222222221',
  '1221122222211221',
  '1233222442223321',
  '.12222222222221.',
  '..111448844111..',
  '.14444488444441.',
  '..144224422441..',
  '...1444444441...',
  '..11221..12211..',
  '..1221....1221..',
  '.1111......1111.',
  '................',
];

const BEAR_PRESET_A: string[] = [
  '.111........111.',
  '1898111111118981',
  '1888888888888881',
  '1882288888822881',
  '1881188338811881',
  '1888883113888881',
  '.18888333388881.',
  '..111aaaaa1111..',
  '..1aaaaaaaaaa1..',
  '..1aaa8888aaa1..',
  '...1aaaaaaaa1...',
  '...1199119911...',
  '...1991..1991...',
  '..1111....1111..',
  '................',
  '................',
];

const BEAR_PRESET_B: string[] = [
  '.111........111.',
  '1898111111118981',
  '1888888888888881',
  '1882288888822881',
  '1881188338811881',
  '1888883113888881',
  '.18888333388881.',
  '..111aaaaa1111..',
  '.1aaaaaaaaaaaa1.',
  '..1aaa8888aaa1..',
  '...1aaaaaaaa1...',
  '..11991..19911..',
  '..1991....1991..',
  '.1111......1111.',
  '................',
  '................',
];

const BEVEL_PROMOTE_MAP: Readonly<Record<number, number>> = {
  3: 2,
  5: 4,
  7: 6,
  9: 8,
  11: 10,
  13: 12,
  15: 14,
};

interface SlotState {
  label: string;
  gridW: number;
  gridH: number;
  frameCount: 2 | 3 | 4;
  frames: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

interface UndoEntry {
  slot: SlotKey;
  frameIdx: number;
  gridW: number;
  gridH: number;
  data: Uint8Array;
}

function hexToRgb(hex: string): [number, number, number] {
  if (!hex || hex === 'transparent' || !hex.startsWith('#')) return [0, 0, 0];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function resampleBuffer(
  src: Uint8Array,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
): Uint8Array {
  if (oldW === newW && oldH === newH) return new Uint8Array(src);
  const dst = new Uint8Array(newW * newH);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min(oldH - 1, Math.floor((y * oldH) / newH));
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(oldW - 1, Math.floor((x * oldW) / newW));
      dst[y * newW + x] = src[sy * oldW + sx] ?? 0;
    }
  }
  return dst;
}

/**
 * Pixel Studio 3.1: HTML5 Canvas pixel editor supporting 16x16 / 32x32 / 48x64 grids,
 * 2-4 frame animation, onion skin, mirror-X, 20-step undo, auto-outline/bevel,
 * PNG/AI image Oklab quantization import, live HD-2D Auto-Sobel point-light preview,
 * and one-click publishing directly into EcsMapDesigner tiles & prefabs.
 */
export class SpriteAtelierView {
  public readonly element: HTMLElement;

  private gpu: GpuEngine;
  private synth: ToySynth;
  private save: SaveService;
  private onHeroSaved?: () => void;
  private publishBridge: SpriteAtelierPublishBridge | null = null;
  private publishCounter = 1;

  private slots: Record<SlotKey, SlotState>;
  private activeSlot: SlotKey = 'hero';
  private activeFrameIdx = 0;
  private selectedColor = 4;
  private selectedThemeIdx = 0;
  private activeTool: PaintTool = 'pencil';
  private activeStamp: StampDef | null = null;
  private onionSkin = false;
  private mirrorX = false;
  private isDrawing = false;
  private activeStrokeEraser = false;
  private hoverX = -1;
  private hoverY = -1;
  private undoStack: UndoEntry[] = [];

  private boardCanvas: HTMLCanvasElement;
  private boardCtx: CanvasRenderingContext2D | null;
  private paletteEls: HTMLButtonElement[] = [];
  private slotBtns = new Map<SlotKey, HTMLButtonElement>();
  private frameBtns: HTMLButtonElement[] = [];
  private frameCountSelect: HTMLSelectElement;
  private sizeBtn: HTMLButtonElement;
  private themeSelect: HTMLSelectElement;
  private stampBtns = new Map<string, HTMLButtonElement>();
  private pencilBtn: HTMLButtonElement;
  private eraserBtn: HTMLButtonElement;
  private fillBtn: HTMLButtonElement;
  private eyedropBtn: HTMLButtonElement;
  private onionBtn: HTMLButtonElement;
  private mirrorBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private importInput: HTMLInputElement;
  private importBtn: HTMLButtonElement;
  private importStatusEl: HTMLElement;
  private previewCanvas: HTMLCanvasElement;
  private previewCtx: CanvasRenderingContext2D | null;
  private previewImgData: ImageData | null = null;
  private lightCoordEl: HTMLElement;
  private publishNameInput: HTMLInputElement;
  private publishLayerSelect: HTMLSelectElement;
  private publishSolidCheck: HTMLInputElement;
  private publishHazardCheck: HTMLInputElement;
  private publishLightCheck: HTMLInputElement;
  private publishStatusEl: HTMLElement;

  private readonly texelHeightScratch = new Float32Array(48 * 64);
  private readonly texelRgbScratch = new Uint8Array(48 * 64 * 4);
  private readonly oklabPaletteScratch = new Float32Array(16 * 3);
  private readonly okTmp = new Float32Array(3);

  private lightNormX = -0.55;
  private lightNormY = -0.65;
  private lightAngle = -2.25;
  private lightHover = false;
  private lastLightReadout = '';
  private animPhase = 0;
  private editEpoch = 0;
  private readonly ac = new AbortController();

  constructor(
    gpu: GpuEngine,
    synth: ToySynth,
    save: SaveService,
    onHeroSaved?: () => void,
    publishBridge?: SpriteAtelierPublishBridge,
  ) {
    this.gpu = gpu;
    this.synth = synth;
    this.save = save;
    this.onHeroSaved = onHeroSaved;
    this.publishBridge = publishBridge ?? null;
    this.restoreFromStorage();

    this.slots = {
      hero: {
        label: '🧑 主角',
        gridW: 16,
        gridH: 16,
        frameCount: 2,
        frames: [
          this.gpu.atlas.heroPixelsA,
          this.gpu.atlas.heroPixelsB,
          new Uint8Array(this.gpu.atlas.heroPixelsA),
          new Uint8Array(this.gpu.atlas.heroPixelsB),
        ],
      },
      custom_enemy: {
        label: '👾 自訂敵人',
        gridW: 16,
        gridH: 16,
        frameCount: 2,
        frames: [
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.slime_a ?? DEFAULT_HERO_FRAME_A),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.slime_b ?? DEFAULT_HERO_FRAME_B),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.slime_a ?? DEFAULT_HERO_FRAME_A),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.slime_b ?? DEFAULT_HERO_FRAME_B),
        ],
      },
      custom_item: {
        label: '⭐ 自訂道具',
        gridW: 16,
        gridH: 16,
        frameCount: 2,
        frames: [
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.star_a ?? DEFAULT_HERO_FRAME_A),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.star_b ?? DEFAULT_HERO_FRAME_B),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.star_a ?? DEFAULT_HERO_FRAME_A),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.star_b ?? DEFAULT_HERO_FRAME_B),
        ],
      },
      custom_tile: {
        label: '🧱 自訂磚塊',
        gridW: 32,
        gridH: 32,
        frameCount: 2,
        frames: [
          resampleBuffer(parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A), 16, 16, 32, 32),
          resampleBuffer(parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A), 16, 16, 32, 32),
          resampleBuffer(parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A), 16, 16, 32, 32),
          resampleBuffer(parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A), 16, 16, 32, 32),
        ],
      },
      studio_claw: {
        label: '🦾 飛鉤機爪',
        gridW: 16,
        gridH: 16,
        frameCount: 2,
        frames: [
          parseGridToIndices(PARKOUR_SPRITE_GRIDS.ik_claw),
          parseGridToIndices(PARKOUR_SPRITE_GRIDS.grapple_claw),
          parseGridToIndices(PARKOUR_SPRITE_GRIDS.ik_joint),
          parseGridToIndices(PARKOUR_SPRITE_GRIDS.grapple_ring),
        ],
      },
    };

    this.element = el('section', 'studio-card');

    const head = el('div', 'studio-head');
    head.innerHTML = `
      <div>
        <h2>🎨 精靈畫室 3.1（16×16 / 32×32 / 48×64 HD-2D 像素工坊）</h2>
        <p class="studio-sub">支援多尺寸畫布、PNG 圖片 Oklab 量化匯入、自動描邊立體化、法線打光預覽，並可一鍵發佈為地圖瓦片與物件印章！</p>
      </div>
    `;

    // Slot selector row
    const slotRow = el('div', 'tool-row');
    (Object.keys(this.slots) as SlotKey[]).forEach((key) => {
      const b = btn(
        key === 'hero' ? 'toy-btn is-active' : 'toy-btn',
        this.slots[key].label,
        undefined,
        () => {
          this.activeSlot = key;
          this.activeFrameIdx = Math.min(this.activeFrameIdx, this.slots[key].frameCount - 1);
          this.syncToolbarState();
          this.renderBoard();
        },
        this.ac.signal,
      );
      this.slotBtns.set(key, b);
      slotRow.appendChild(b);
    });

    // Frame count + 4 frame tabs + Size toggle + Onion skin
    const frameBar = el('div', 'tool-row');
    this.sizeBtn = btn(
      'toy-btn is-mint',
      '📐 16×16',
      '循環切換目前槽位解析度：16×16 → 32×32 → 48×64（自動保留像素縮放）',
      () => this.toggleSlotGridSize(),
      this.ac.signal,
    );
    frameBar.appendChild(this.sizeBtn);

    this.frameCountSelect = el('select', 'atelier-select');
    this.frameCountSelect.title = '動畫總幀數';
    for (const n of [2, 3, 4] as const) {
      const opt = el('option');
      opt.value = String(n);
      opt.textContent = `${n} 幀動畫`;
      this.frameCountSelect.appendChild(opt);
    }
    this.frameCountSelect.addEventListener(
      'change',
      () => {
        const nextCount = Number(this.frameCountSelect.value) as 2 | 3 | 4;
        this.slots[this.activeSlot].frameCount = nextCount;
        if (this.activeFrameIdx >= nextCount) this.activeFrameIdx = nextCount - 1;
        this.editEpoch++;
        this.syncToolbarState();
        this.renderBoard();
      },
      { signal: this.ac.signal },
    );
    frameBar.appendChild(this.frameCountSelect);

    ['A', 'B', 'C', 'D'].forEach((label, idx) => {
      const fBtn = btn(
        idx === 0 ? 'toy-btn is-active' : 'toy-btn',
        `幀 ${label}`,
        undefined,
        () => {
          this.activeFrameIdx = idx;
          this.syncToolbarState();
          this.renderBoard();
        },
        this.ac.signal,
      );
      this.frameBtns.push(fBtn);
      frameBar.appendChild(fBtn);
    });

    this.onionBtn = btn(
      'toy-btn',
      '🧅 洋蔥皮',
      '在背景半透明顯示前一幀參考線（不寫入紋理）',
      () => {
        this.onionSkin = !this.onionSkin;
        this.syncToolbarState();
        this.renderBoard();
      },
      this.ac.signal,
    );
    frameBar.appendChild(this.onionBtn);

    head.append(slotRow, frameBar);

    const layout = el('div', 'atelier-grid-layout');

    // Interactive Canvas Drawing Surface
    const boardWrap = el('div', 'atelier-workbench-panel');
    this.boardCanvas = el('canvas', 'atelier-pixel-canvas');
    this.boardCanvas.width = BOARD_CANVAS_PX;
    this.boardCanvas.height = BOARD_CANVAS_PX;
    this.boardCtx = this.boardCanvas.getContext('2d');
    boardWrap.appendChild(this.boardCanvas);

    let lastPaintedKey = -1;
    const stopDrawing = () => {
      this.isDrawing = false;
      this.activeStrokeEraser = false;
      lastPaintedKey = -1;
    };

    const resolveCellFromClient = (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = this.boardCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const slot = this.slots[this.activeSlot];
      const { ox, oy, cellPx } = this.getBoardLayout(slot.gridW, slot.gridH);
      const canvasX = ((clientX - rect.left) / rect.width) * BOARD_CANVAS_PX;
      const canvasY = ((clientY - rect.top) / rect.height) * BOARD_CANVAS_PX;
      const x = Math.floor((canvasX - ox) / cellPx);
      const y = Math.floor((canvasY - oy) / cellPx);
      if (x < 0 || x >= slot.gridW || y < 0 || y >= slot.gridH) return null;
      return { x, y };
    };

    const paintFromEvent = (clientX: number, clientY: number, altKey: boolean, rightBtn: boolean) => {
      const cell = resolveCellFromClient(clientX, clientY);
      if (!cell) return;
      const slot = this.slots[this.activeSlot];
      const key = cell.y * slot.gridW + cell.x;
      if (key === lastPaintedKey) return;
      lastPaintedKey = key;

      if (altKey || this.activeTool === 'eyedropper') {
        this.pickColorAt(cell.x, cell.y);
        return;
      }
      this.applyPaintAt(cell.x, cell.y, rightBtn || this.activeStrokeEraser);
    };

    this.boardCanvas.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        this.synth.unlock();
        const rightBtn = e.button === 2 || (e.buttons & 2) !== 0;
        if (e.altKey || this.activeTool === 'eyedropper') {
          const cell = resolveCellFromClient(e.clientX, e.clientY);
          if (cell) this.pickColorAt(cell.x, cell.y);
          return;
        }
        this.saveUndoSnapshot();
        this.isDrawing = true;
        this.activeStrokeEraser = rightBtn;
        lastPaintedKey = -1;
        try {
          this.boardCanvas.setPointerCapture(e.pointerId);
        } catch {
          // Safe fallback when synthetic events lack active pointerId
        }
        paintFromEvent(e.clientX, e.clientY, e.altKey, rightBtn);
      },
      { signal: this.ac.signal },
    );

    this.boardCanvas.addEventListener(
      'pointermove',
      (e) => {
        const cell = resolveCellFromClient(e.clientX, e.clientY);
        const nx = cell ? cell.x : -1;
        const ny = cell ? cell.y : -1;
        if (nx !== this.hoverX || ny !== this.hoverY) {
          this.hoverX = nx;
          this.hoverY = ny;
          if (!this.isDrawing) this.renderBoard();
        }
        if (!this.isDrawing || this.activeTool === 'fill' || this.activeStamp) return;
        paintFromEvent(e.clientX, e.clientY, e.altKey, (e.buttons & 2) !== 0);
      },
      { signal: this.ac.signal },
    );

    this.boardCanvas.addEventListener(
      'pointerleave',
      () => {
        if (this.hoverX !== -1 || this.hoverY !== -1) {
          this.hoverX = -1;
          this.hoverY = -1;
          this.renderBoard();
        }
      },
      { signal: this.ac.signal },
    );

    this.boardCanvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: this.ac.signal });
    this.boardCanvas.addEventListener('pointercancel', stopDrawing, { signal: this.ac.signal });
    this.boardCanvas.addEventListener('pointerup', stopDrawing, { signal: this.ac.signal });
    window.addEventListener('pointerup', stopDrawing, { signal: this.ac.signal });
    window.addEventListener('blur', stopDrawing, { signal: this.ac.signal });

    // Sidebar controls
    const sidebar = el('div', 'atelier-sidebar');

    // Interactive 96x96 HD-2D Normal + Point-Light Preview Card
    const previewCard = el('div', 'atelier-preview-card');
    this.previewCanvas = el('canvas', 'atelier-preview-canvas');
    this.previewCanvas.width = PREVIEW_CANVAS_PX;
    this.previewCanvas.height = PREVIEW_CANVAS_PX;
    this.previewCtx = this.previewCanvas.getContext('2d');
    if (this.previewCtx) {
      this.previewImgData = this.previewCtx.createImageData(PREVIEW_CANVAS_PX, PREVIEW_CANVAS_PX);
    }

    this.previewCanvas.addEventListener(
      'pointermove',
      (e) => {
        const rect = this.previewCanvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        this.lightHover = true;
        this.lightNormX = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
        this.lightNormY = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
        this.lightAngle = Math.atan2(this.lightNormY, this.lightNormX);
        this.updateLightReadout();
      },
      { passive: true, signal: this.ac.signal },
    );
    this.previewCanvas.addEventListener(
      'pointerleave',
      () => {
        this.lightHover = false;
      },
      { signal: this.ac.signal },
    );

    const previewMeta = el('div', 'atelier-preview-meta');
    const previewTitle = el('strong', undefined, 'HD-2D 即時法線打光預覽');
    this.lightCoordEl = el('div', 'atelier-light-readout', '光源角度 -130° (-0.55, -0.65)');

    this.themeSelect = el('select', 'atelier-select');
    this.themeSelect.title = '切換 8 組 LUT 主題預設';
    PALETTE_THEMES.forEach((t, idx) => {
      const opt = el('option');
      opt.value = String(idx);
      opt.textContent = `🎨 ${idx}: ${t.label}`;
      this.themeSelect.appendChild(opt);
    });
    this.themeSelect.addEventListener(
      'change',
      () => {
        this.selectedThemeIdx = Number(this.themeSelect.value) || 0;
        this.syncPaletteColors();
        this.renderBoard();
      },
      { signal: this.ac.signal },
    );
    previewMeta.append(previewTitle, this.lightCoordEl, this.themeSelect);
    previewCard.append(this.previewCanvas, previewMeta);

    // 16-Color LUT Palette (14..15 marked as Bloom glow)
    const paletteGrid = el('div', 'palette-grid');
    for (let idx = 0; idx < 16; idx++) {
      const isGlow = idx === 14 || idx === 15;
      const chip = btn(
        idx === 0 ? 'palette-chip is-eraser' : isGlow ? 'palette-chip is-emissive' : 'palette-chip',
        isGlow ? '✨' : '',
        idx === 0 ? '透明橡皮擦' : isGlow ? `色號 ${idx} (Bloom 發光色)` : `色號 ${idx}`,
        () => {
          this.selectedColor = idx;
          this.activeStamp = null;
          if (idx === 0) this.activeTool = 'eraser';
          else if (this.activeTool === 'eraser' || this.activeTool === 'eyedropper') this.activeTool = 'pencil';
          this.syncPaletteSelection();
          this.syncToolbarState();
        },
        this.ac.signal,
      );
      this.paletteEls.push(chip);
      paletteGrid.appendChild(chip);
    }

    // Core Studio Tools
    const tools = el('div', 'tool-row atelier-tool-group');
    this.pencilBtn = btn(
      'toy-btn is-active',
      '✏️ 畫筆',
      undefined,
      () => {
        this.activeTool = 'pencil';
        this.activeStamp = null;
        this.syncToolbarState();
      },
      this.ac.signal,
    );
    this.eraserBtn = btn(
      'toy-btn',
      '🧽 橡皮',
      '切換橡皮擦工具（亦可於畫布上按右鍵擦除）',
      () => {
        this.activeTool = 'eraser';
        this.activeStamp = null;
        this.syncToolbarState();
      },
      this.ac.signal,
    );
    this.fillBtn = btn(
      'toy-btn',
      '🪣 油漆桶',
      undefined,
      () => {
        this.activeTool = this.activeTool === 'fill' ? 'pencil' : 'fill';
        this.activeStamp = null;
        this.syncToolbarState();
      },
      this.ac.signal,
    );
    this.eyedropBtn = btn(
      'toy-btn',
      '💧 吸色',
      '點擊畫布吸取色號（亦可按住 Alt 點擊）',
      () => {
        this.activeTool = this.activeTool === 'eyedropper' ? 'pencil' : 'eyedropper';
        this.activeStamp = null;
        this.syncToolbarState();
      },
      this.ac.signal,
    );
    this.mirrorBtn = btn(
      'toy-btn',
      '🪞 左右對稱',
      undefined,
      () => {
        this.mirrorX = !this.mirrorX;
        this.syncToolbarState();
      },
      this.ac.signal,
    );
    this.undoBtn = btn(
      'toy-btn',
      '↩ 復原',
      '最多支援 20 步復原',
      () => this.undoLastEdit(),
      this.ac.signal,
    );
    const copyPrevBtn = btn(
      'toy-btn',
      '📋 複製上幀',
      undefined,
      () => {
        const slot = this.slots[this.activeSlot];
        const prevIdx = (this.activeFrameIdx - 1 + slot.frameCount) % slot.frameCount;
        this.saveUndoSnapshot();
        slot.frames[this.activeFrameIdx].set(slot.frames[prevIdx]);
        this.commitAtlasUpdate();
        this.renderBoard();
      },
      this.ac.signal,
    );
    tools.append(
      this.pencilBtn,
      this.eraserBtn,
      this.fillBtn,
      this.eyedropBtn,
      this.mirrorBtn,
      this.undoBtn,
      copyPrevBtn,
    );

    // Pro Actions: Auto-Outline/Bevel + PNG/AI Image Import
    const proRow = el('div', 'tool-row atelier-tool-group');
    const autoOutlineBtn = btn(
      'toy-btn is-honey',
      '✨ 自動描邊立體化',
      '為目前圖層加上 1px 深色輪廓並提亮左上方高光邊緣',
      () => this.applyAutoOutlineAndBevel(),
      this.ac.signal,
    );

    this.importInput = el('input', 'panel-hidden');
    this.importInput.type = 'file';
    this.importInput.accept = 'image/png,image/webp,image/jpeg';
    this.importInput.addEventListener(
      'change',
      () => {
        const file = this.importInput.files?.[0];
        this.importInput.value = '';
        if (file) void this.importImageFile(file);
      },
      { signal: this.ac.signal },
    );

    this.importBtn = btn(
      'toy-btn is-mint',
      '📥 匯入 PNG / AI 圖',
      '自動去背裁切並以 Oklab 感知色距量化至 Toybox 16 色盤',
      () => this.importInput.click(),
      this.ac.signal,
    );
    this.importStatusEl = el('span', 'studio-sub');
    proRow.append(autoOutlineBtn, this.importBtn, this.importInput, this.importStatusEl);

    // 6 Pixel Stamps
    const stampRow = el('div', 'tool-row');
    for (const stamp of PIXEL_STAMPS) {
      const sBtn = btn(
        'toy-btn is-mint',
        stamp.label,
        `點擊畫布蓋上「${stamp.label}」像素圖章`,
        () => {
          this.activeStamp = this.activeStamp?.id === stamp.id ? null : stamp;
          if (this.activeStamp && this.activeTool === 'fill') this.activeTool = 'pencil';
          this.syncToolbarState();
        },
        this.ac.signal,
      );
      this.stampBtns.set(stamp.id, sBtn);
      stampRow.appendChild(sBtn);
    }

    // 4 Hero Presets
    const presetRow = el('div', 'tool-row');
    const addPresetBtn = (label: string, gridA: string[], gridB: string[]) => {
      presetRow.appendChild(
        btn(
          'toy-btn is-honey',
          label,
          undefined,
          () => {
            this.synth.unlock();
            this.synth.playPreset('star');
            this.activeSlot = 'hero';
            this.saveUndoSnapshot();
            this.ensureHeroSize16();
            parseGridToIndices(gridA, this.slots.hero.frames[0]);
            parseGridToIndices(gridB, this.slots.hero.frames[1]);
            this.commitAtlasUpdate(true);
            this.syncToolbarState();
            this.renderBoard();
          },
          this.ac.signal,
        ),
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
    this.publishNameInput = el('input', 'atelier-input');
    this.publishNameInput.type = 'text';
    this.publishNameInput.placeholder = '自訂資產名稱（例：翠玉地磚）';
    this.publishNameInput.value = '自訂像素磚 #1';
    this.publishNameInput.setAttribute('aria-label', '自訂資產名稱');

    this.publishLayerSelect = el('select', 'atelier-select');
    this.publishLayerSelect.setAttribute('aria-label', '目標地圖圖層');
    const layerOpts: [EcsMapLayerName, string][] = [
      ['ground', '圖層：地板 (ground)'],
      ['wall', '圖層：立體城牆 (wall · 20px)'],
      ['decor', '圖層：裝飾 (decor)'],
    ];
    for (const [val, text] of layerOpts) {
      const o = el('option');
      o.value = val;
      o.textContent = text;
      this.publishLayerSelect.appendChild(o);
    }
    this.publishLayerSelect.addEventListener(
      'change',
      () => {
        if (this.publishLayerSelect.value === 'wall') {
          this.publishSolidCheck.checked = true;
        }
      },
      { signal: this.ac.signal },
    );
    pubForm.append(this.publishNameInput, this.publishLayerSelect);

    const flagsRow = el('div', 'atelier-publish-flags');
    const mkFlag = (labelText: string, checked: boolean): HTMLInputElement => {
      const lbl = el('label', 'atelier-flag-label');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      lbl.append(cb, document.createTextNode(labelText));
      flagsRow.appendChild(lbl);
      return cb;
    };
    this.publishSolidCheck = mkFlag('實體碰撞', false);
    this.publishHazardCheck = mkFlag('傷害陷阱', false);
    this.publishLightCheck = mkFlag('附帶光源', false);

    const pubBtns = el('div', 'tool-row atelier-publish-actions');
    const pubTileBtn = btn(
      'toy-btn is-honey',
      '🧩 發佈為地圖瓦片',
      '將目前畫布即時編譯進動態 GPU 圖集並加入地圖瓦片盤',
      () => this.handlePublishMapTile(),
      this.ac.signal,
    );
    pubTileBtn.setAttribute('data-atelier-publish-tile', 'true');

    const pubPrefabBtn = btn(
      'toy-btn is-mint',
      '📌 發佈為物件印章',
      '將目前畫布即時編譯並註冊為可放置的 ECS Prefab 印章',
      () => this.handlePublishPrefabStamp(),
      this.ac.signal,
    );
    pubPrefabBtn.setAttribute('data-atelier-publish-prefab', 'true');

    pubBtns.append(pubTileBtn, pubPrefabBtn);
    this.publishStatusEl = el('div', 'studio-sub atelier-publish-status', '支援 16×16 / 32×32 / 48×64 即時熱編譯，無需重開專案。');
    publishCard.append(pubTitle, pubForm, flagsRow, pubBtns, this.publishStatusEl);

    sidebar.append(previewCard, paletteGrid, tools, proRow, stampRow, presetRow, publishCard);
    layout.append(boardWrap, sidebar);
    this.element.append(head, layout);

    this.syncPaletteColors();
    this.syncPaletteSelection();
    this.syncToolbarState();
    this.updateLightReadout();
    this.renderBoard();
  }

  public destroy(): void {
    this.isDrawing = false;
    this.activeStrokeEraser = false;
    this.previewImgData = null;
    this.undoStack.length = 0;
    this.ac.abort();
  }

  public getSelectedPaletteRow(): number {
    return this.selectedThemeIdx;
  }

  public getEditEpoch(): number {
    return this.editEpoch;
  }

  public setPublishBridge(bridge: SpriteAtelierPublishBridge | null): void {
    this.publishBridge = bridge;
  }

  /** Switches editor to the custom tile slot at 32x32 (or custom size) for immediate tile authoring. */
  public prepareForMapTile(width = 32, height = 32, defaultLayer: EcsMapLayerName = 'ground'): void {
    this.activeSlot = 'custom_tile';
    this.activeFrameIdx = 0;
    this.applySlotGridSize('custom_tile', width, height);
    this.publishLayerSelect.value = defaultLayer;
    this.publishSolidCheck.checked = defaultLayer === 'wall';
    this.publishHazardCheck.checked = false;
    this.publishNameInput.value = `自訂像素磚 #${this.publishCounter}`;
    this.publishStatusEl.textContent = `已切換至 ${width}×${height} 瓦片槽位，繪製後可一鍵發佈。`;
    this.syncToolbarState();
    this.renderBoard();
  }

  private buildCurrentCustomSpriteDef(prefix: string, displayName: string): EcsCustomSpriteDef {
    const slot = this.slots[this.activeSlot];
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    const id = `${prefix}_${Date.now().toString(36)}_${this.publishCounter++}`;
    return {
      id,
      name: displayName,
      width: slot.gridW,
      height: slot.gridH,
      kind: 'grid',
      paletteRow: this.selectedThemeIdx,
      palette: [...theme.colors],
      pixels: indicesToGrid(this.getCurrentBuffer(), slot.gridW, slot.gridH),
    };
  }

  private handlePublishMapTile(): void {
    if (!this.publishBridge) {
      this.publishStatusEl.textContent = '工作站發佈通道未連線';
      return;
    }
    const slot = this.slots[this.activeSlot];
    const layer = (this.publishLayerSelect.value as EcsMapLayerName) || 'ground';
    const rawName = this.publishNameInput.value.trim() || `自訂瓦片 #${this.publishCounter}`;
    const sprite = this.buildCurrentCustomSpriteDef('atelier_tile', rawName);
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    const lightHex = theme.colors[14] || theme.colors[15] || '#ffd447';
    const res = this.publishBridge.onPublishMapTile({
      sprite,
      name: rawName,
      layer,
      solid: this.publishSolidCheck.checked || layer === 'wall',
      hazard: this.publishHazardCheck.checked,
      ...(layer === 'wall' ? { extrudeH: 20 } : {}),
      ...(layer === 'decor' && slot.gridH > 32 ? { renderH: Math.min(64, slot.gridH) } : {}),
      ...(this.publishLightCheck.checked
        ? { ambientLight: { radius: 96, color: lightHex, intensity: 0.72 } }
        : {}),
    });
    this.synth.unlock();
    this.synth.playPreset(res.ok ? 'star' : 'snap');
    this.publishStatusEl.textContent = res.message;
    if (res.ok) {
      this.publishNameInput.value = `自訂像素磚 #${this.publishCounter}`;
    }
  }

  private handlePublishPrefabStamp(): void {
    if (!this.publishBridge) {
      this.publishStatusEl.textContent = '工作站發佈通道未連線';
      return;
    }
    const rawName = this.publishNameInput.value.trim() || `自訂物件 #${this.publishCounter}`;
    const sprite = this.buildCurrentCustomSpriteDef('atelier_prop', rawName);
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    const lightHex = theme.colors[14] || theme.colors[15] || '#ffd447';
    const res = this.publishBridge.onPublishPrefabStamp({
      sprite,
      name: rawName,
      solid: this.publishSolidCheck.checked,
      ...(this.publishLightCheck.checked
        ? { ambientLight: { radius: 96, color: lightHex, intensity: 0.72 } }
        : {}),
    });
    this.synth.unlock();
    this.synth.playPreset(res.ok ? 'star' : 'snap');
    this.publishStatusEl.textContent = res.message;
    if (res.ok) {
      this.publishNameInput.value = `自訂物件 #${this.publishCounter}`;
    }
  }

  private getBoardLayout(gridW: number, gridH: number): { ox: number; oy: number; cellPx: number; drawW: number; drawH: number } {
    const cellPx = Math.floor(Math.min(BOARD_CANVAS_PX / gridW, BOARD_CANVAS_PX / gridH));
    const drawW = cellPx * gridW;
    const drawH = cellPx * gridH;
    const ox = Math.floor((BOARD_CANVAS_PX - drawW) * 0.5);
    const oy = Math.floor((BOARD_CANVAS_PX - drawH) * 0.5);
    return { ox, oy, cellPx, drawW, drawH };
  }

  /** Packages current Sprite Studio slots into CartridgeJsonV1.sprites grids (16x16, 32x32, or 48x64). */
  public exportCartridgeSprites(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const prefixMap: Record<SlotKey, string> = {
      hero: 'studio_hero',
      custom_enemy: 'studio_enemy',
      custom_item: 'studio_item',
      custom_tile: 'studio_tile',
      studio_claw: 'studio_claw',
    };
    const suffixes = ['a', 'b', 'c', 'd'];
    for (const key of Object.keys(this.slots) as SlotKey[]) {
      const slot = this.slots[key];
      const count = key === 'custom_tile' ? 1 : slot.frameCount;
      for (let i = 0; i < count; i++) {
        const sid = key === 'custom_tile' ? prefixMap[key] : `${prefixMap[key]}_${suffixes[i]}`;
        out[sid] = indicesToGrid(slot.frames[i], slot.gridW, slot.gridH);
      }
      if (key === 'studio_claw') {
        out.studio_claw = indicesToGrid(slot.frames[0], slot.gridW, slot.gridH);
      }
    }
    return out;
  }

  private getCurrentBuffer(): Uint8Array {
    return this.slots[this.activeSlot].frames[this.activeFrameIdx];
  }

  private ensureHeroSize16(): void {
    const hero = this.slots.hero;
    if (hero.gridW === 16 && hero.gridH === 16) return;
    const f0 = resampleBuffer(hero.frames[0], hero.gridW, hero.gridH, 16, 16);
    const f1 = resampleBuffer(hero.frames[1], hero.gridW, hero.gridH, 16, 16);
    const f2 = resampleBuffer(hero.frames[2], hero.gridW, hero.gridH, 16, 16);
    const f3 = resampleBuffer(hero.frames[3], hero.gridW, hero.gridH, 16, 16);
    this.gpu.atlas.heroPixelsA.set(f0);
    this.gpu.atlas.heroPixelsB.set(f1);
    hero.gridW = 16;
    hero.gridH = 16;
    hero.frames = [this.gpu.atlas.heroPixelsA, this.gpu.atlas.heroPixelsB, f2, f3];
  }

  private applySlotGridSize(slotKey: SlotKey, targetW: number, targetH: number): void {
    const slot = this.slots[slotKey];
    if (slot.gridW === targetW && slot.gridH === targetH) return;
    if (slotKey === 'hero' && targetW === 16 && targetH === 16) {
      this.ensureHeroSize16();
      return;
    }
    const oldW = slot.gridW;
    const oldH = slot.gridH;
    slot.frames = [
      resampleBuffer(slot.frames[0], oldW, oldH, targetW, targetH),
      resampleBuffer(slot.frames[1], oldW, oldH, targetW, targetH),
      resampleBuffer(slot.frames[2], oldW, oldH, targetW, targetH),
      resampleBuffer(slot.frames[3], oldW, oldH, targetW, targetH),
    ];
    slot.gridW = targetW;
    slot.gridH = targetH;
  }

  private toggleSlotGridSize(): void {
    const slot = this.slots[this.activeSlot];
    const curIdx = GRID_PRESETS.findIndex((p) => p.w === slot.gridW && p.h === slot.gridH);
    const next = GRID_PRESETS[(curIdx + 1) % GRID_PRESETS.length];
    this.saveUndoSnapshot();
    this.applySlotGridSize(this.activeSlot, next.w, next.h);
    this.synth.unlock();
    this.synth.playPreset('bounce');
    this.commitAtlasUpdate(true);
    this.syncToolbarState();
    this.renderBoard();
  }

  private saveUndoSnapshot(): void {
    const slot = this.slots[this.activeSlot];
    this.undoStack.push({
      slot: this.activeSlot,
      frameIdx: this.activeFrameIdx,
      gridW: slot.gridW,
      gridH: slot.gridH,
      data: new Uint8Array(this.getCurrentBuffer()),
    });
    if (this.undoStack.length > MAX_UNDO_STEPS) {
      this.undoStack.shift();
    }
    this.undoBtn.disabled = false;
  }

  private undoLastEdit(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.activeSlot = snap.slot;
    this.activeFrameIdx = snap.frameIdx;
    this.applySlotGridSize(snap.slot, snap.gridW, snap.gridH);
    this.slots[snap.slot].frames[snap.frameIdx].set(snap.data);
    this.synth.playPreset('snap');
    this.commitAtlasUpdate(true);
    this.syncToolbarState();
    this.renderBoard();
  }

  private pickColorAt(x: number, y: number): void {
    const slot = this.slots[this.activeSlot];
    const idx = this.getCurrentBuffer()[y * slot.gridW + x] ?? 0;
    this.selectedColor = idx;
    this.activeStamp = null;
    this.activeTool = idx === 0 ? 'eraser' : 'pencil';
    this.synth.playPreset('snap');
    this.syncPaletteSelection();
    this.syncToolbarState();
  }

  private applyStampAt(buf: Uint8Array, cx: number, cy: number, stamp: StampDef): void {
    const slot = this.slots[this.activeSlot];
    const gw = slot.gridW;
    const gh = slot.gridH;
    const sh = stamp.grid.length;
    const sw = stamp.grid[0]?.length ?? 0;
    const ox = cx - Math.floor(sw / 2);
    const oy = cy - Math.floor(sh / 2);
    const parsed = parseGridToIndices(stamp.grid);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const colorIdx = parsed[y * sw + x] ?? 0;
        if (colorIdx === 0) continue;
        const tx = ox + x;
        const ty = oy + y;
        if (tx >= 0 && tx < gw && ty >= 0 && ty < gh) {
          buf[ty * gw + tx] = colorIdx;
          if (this.mirrorX) {
            buf[ty * gw + (gw - 1 - tx)] = colorIdx;
          }
        }
      }
    }
  }

  private applyPaintAt(x: number, y: number, forceErase = false): void {
    const buf = this.getCurrentBuffer();
    const slot = this.slots[this.activeSlot];
    const gw = slot.gridW;
    const gh = slot.gridH;
    if (this.activeStamp && !forceErase) {
      this.applyStampAt(buf, x, y, this.activeStamp);
      this.synth.playPreset('star');
    } else if (this.activeTool === 'fill' && !forceErase) {
      this.floodFill(buf, gw, gh, x, y, this.selectedColor);
      this.synth.playPreset('bounce');
    } else {
      const paintIdx = forceErase || this.activeTool === 'eraser' ? 0 : this.selectedColor;
      buf[y * gw + x] = paintIdx;
      if (this.mirrorX) {
        buf[y * gw + (gw - 1 - x)] = paintIdx;
      }
      this.synth.playPreset('snap');
    }
    this.commitAtlasUpdate();
    this.renderBoard();
  }

  private floodFill(buf: Uint8Array, gw: number, gh: number, sx: number, sy: number, targetColor: number): void {
    const orig = buf[sy * gw + sx];
    if (orig === targetColor) return;
    const queue: [number, number][] = [[sx, sy]];
    while (queue.length > 0) {
      const [cx, cy] = queue.pop()!;
      const idx = cy * gw + cx;
      if (buf[idx] !== orig) continue;
      buf[idx] = targetColor;
      if (cx > 0) queue.push([cx - 1, cy]);
      if (cx < gw - 1) queue.push([cx + 1, cy]);
      if (cy > 0) queue.push([cx, cy - 1]);
      if (cy < gh - 1) queue.push([cx, cy + 1]);
    }
  }

  private applyAutoOutlineAndBevel(): void {
    const slot = this.slots[this.activeSlot];
    const gw = slot.gridW;
    const gh = slot.gridH;
    const buf = this.getCurrentBuffer();
    this.saveUndoSnapshot();
    const snap = new Uint8Array(buf);
    let changed = false;

    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (snap[i] !== 0) continue;
        const up = y > 0 ? snap[(y - 1) * gw + x] : 0;
        const dn = y < gh - 1 ? snap[(y + 1) * gw + x] : 0;
        const lf = x > 0 ? snap[y * gw + x - 1] : 0;
        const rt = x < gw - 1 ? snap[y * gw + x + 1] : 0;
        if (up > 1 || dn > 1 || lf > 1 || rt > 1) {
          buf[i] = 1;
          changed = true;
        }
      }
    }

    const postOutline = new Uint8Array(buf);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const cur = postOutline[i];
        if (cur <= 1) continue;
        const up = y > 0 ? postOutline[(y - 1) * gw + x] : 0;
        const lf = x > 0 ? postOutline[y * gw + x - 1] : 0;
        const dn = y < gh - 1 ? postOutline[(y + 1) * gw + x] : 0;
        const rt = x < gw - 1 ? postOutline[y * gw + x + 1] : 0;
        const exposedTopLeft = up <= 1 || lf <= 1;
        const supportedBotRight = dn > 1 || rt > 1;
        if (exposedTopLeft && supportedBotRight) {
          const promoted = BEVEL_PROMOTE_MAP[cur];
          if (promoted !== undefined) {
            buf[i] = promoted;
            changed = true;
          }
        }
      }
    }

    if (changed) {
      this.synth.unlock();
      this.synth.playPreset('star');
      this.commitAtlasUpdate();
      this.renderBoard();
    } else {
      this.undoStack.pop();
      this.syncToolbarState();
    }
  }

  private async importImageFile(file: File): Promise<void> {
    this.importStatusEl.textContent = '量化中…';
    try {
      const loaded = await this.loadImageSource(file);
      if (!loaded) {
        this.importStatusEl.textContent = '無法讀取圖片';
        return;
      }

      const maxDim = 256;
      const scale = Math.min(1, maxDim / Math.max(1, Math.max(loaded.w, loaded.h)));
      const sw = Math.max(1, Math.round(loaded.w * scale));
      const sh = Math.max(1, Math.round(loaded.h * scale));
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = sw;
      srcCanvas.height = sh;
      const srcCtx = srcCanvas.getContext('2d');
      if (!srcCtx) return;
      srcCtx.imageSmoothingEnabled = true;
      srcCtx.drawImage(loaded.img, 0, 0, sw, sh);
      loaded.cleanup();

      const srcImg = srcCtx.getImageData(0, 0, sw, sh);
      const px = srcImg.data;

      // Auto-remove uniform opaque edge background via corner flood-fill when corners match
      const cTL = 0;
      const cTR = (sw - 1) * 4;
      const cBL = (sh - 1) * sw * 4;
      const cBR = (sh * sw - 1) * 4;
      const allOpaqueCorners = px[cTL + 3] > 200 && px[cTR + 3] > 200 && px[cBL + 3] > 200 && px[cBR + 3] > 200;
      if (allOpaqueCorners) {
        const bgR = px[cTL];
        const bgG = px[cTL + 1];
        const bgB = px[cTL + 2];
        const closeToBg = (off: number) =>
          Math.abs(px[off] - bgR) + Math.abs(px[off + 1] - bgG) + Math.abs(px[off + 2] - bgB) < 60;
        if (closeToBg(cTR) && closeToBg(cBL) && closeToBg(cBR)) {
          const visited = new Uint8Array(sw * sh);
          const stack: number[] = [];
          for (let x = 0; x < sw; x++) {
            stack.push(x, (sh - 1) * sw + x);
          }
          for (let y = 1; y < sh - 1; y++) {
            stack.push(y * sw, y * sw + sw - 1);
          }
          while (stack.length > 0) {
            const p = stack.pop()!;
            if (visited[p]) continue;
            visited[p] = 1;
            const off = p * 4;
            if (!closeToBg(off)) continue;
            px[off + 3] = 0;
            const cx = p % sw;
            const cy = Math.floor(p / sw);
            if (cx > 0) stack.push(p - 1);
            if (cx < sw - 1) stack.push(p + 1);
            if (cy > 0) stack.push(p - sw);
            if (cy < sh - 1) stack.push(p + sw);
          }
          srcCtx.putImageData(srcImg, 0, 0);
        }
      }

      // Compute tight bounding box of opaque pixels
      let minX = sw;
      let minY = sh;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (px[(y * sw + x) * 4 + 3] >= 48) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX || maxY < minY) {
        this.importStatusEl.textContent = '圖片完全透明';
        return;
      }

      const slot = this.slots[this.activeSlot];
      const gw = slot.gridW;
      const gh = slot.gridH;
      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = gw;
      dstCanvas.height = gh;
      const dstCtx = dstCanvas.getContext('2d');
      if (!dstCtx) return;

      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;
      const fitScale = Math.min(gw / cropW, gh / cropH);
      const dw = Math.max(1, Math.round(cropW * fitScale));
      const dh = Math.max(1, Math.round(cropH * fitScale));
      const dx = Math.floor((gw - dw) * 0.5);
      const dy = Math.floor((gh - dh) * 0.5);
      dstCtx.imageSmoothingEnabled = Math.max(cropW, cropH) > Math.max(gw, gh) * 2;
      dstCtx.drawImage(srcCanvas, minX, minY, cropW, cropH, dx, dy, dw, dh);
      const qData = dstCtx.getImageData(0, 0, gw, gh).data;

      // Precompute Oklab coordinates for active LUT theme indices 1..15
      const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
      for (let idx = 1; idx < 16; idx++) {
        const [pr, pg, pb] = hexToRgb(theme.colors[idx] ?? '#ffffff');
        linearRgbToOklab(
          srgbToLinear(pr / 255),
          srgbToLinear(pg / 255),
          srgbToLinear(pb / 255),
          this.oklabPaletteScratch,
          idx * 3,
        );
      }

      this.saveUndoSnapshot();
      const targetBuf = this.getCurrentBuffer();
      for (let i = 0; i < gw * gh; i++) {
        const off = i * 4;
        if (qData[off + 3] < 96) {
          targetBuf[i] = 0;
          continue;
        }
        linearRgbToOklab(
          srgbToLinear(qData[off] / 255),
          srgbToLinear(qData[off + 1] / 255),
          srgbToLinear(qData[off + 2] / 255),
          this.okTmp,
          0,
        );
        let bestIdx = 1;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let idx = 1; idx < 16; idx++) {
          const pOff = idx * 3;
          const dL = (this.okTmp[0] - this.oklabPaletteScratch[pOff]) * 1.25;
          const da = this.okTmp[1] - this.oklabPaletteScratch[pOff + 1];
          const db = this.okTmp[2] - this.oklabPaletteScratch[pOff + 2];
          const d2 = dL * dL + da * da + db * db;
          if (d2 < bestDist) {
            bestDist = d2;
            bestIdx = idx;
          }
        }
        targetBuf[i] = bestIdx;
      }

      this.synth.unlock();
      this.synth.playPreset('star');
      this.commitAtlasUpdate();
      this.syncToolbarState();
      this.renderBoard();
      this.importStatusEl.textContent = `已匯入 ${gw}×${gh} Oklab 量化`;
    } catch {
      this.importStatusEl.textContent = '圖片解析失敗';
    }
  }

  private async loadImageSource(
    file: File,
  ): Promise<{ img: CanvasImageSource; w: number; h: number; cleanup: () => void } | null> {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file);
      return { img: bmp, w: bmp.width, h: bmp.height, cleanup: () => bmp.close() };
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const elImg = new Image();
        elImg.onload = () => resolve(elImg);
        elImg.onerror = () => reject(new Error('Image load failed'));
        elImg.src = url;
      });
      return {
        img,
        w: img.naturalWidth || img.width,
        h: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(url),
      };
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
  }

  private commitAtlasUpdate(forceHeroSync = false): void {
    this.editEpoch++;
    const hero = this.slots.hero;
    if (
      this.activeSlot === 'hero' &&
      hero.gridW === 16 &&
      hero.gridH === 16 &&
      (forceHeroSync || this.activeFrameIdx === 0 || this.activeFrameIdx === 1)
    ) {
      this.gpu.atlas.syncHeroSlots();
      this.gpu.syncAtlasToGpu();
      this.save.saveHeroSprites(this.gpu.atlas.heroPixelsA, this.gpu.atlas.heroPixelsB);
      this.onHeroSaved?.();
    }
  }

  private restoreFromStorage(): void {
    const parsed = this.save.getHeroSprites();
    if (!parsed) return;
    if (Array.isArray(parsed.a) && parsed.a.length === TILE_PX * TILE_PX) {
      this.gpu.atlas.heroPixelsA.set(parsed.a);
    }
    if (Array.isArray(parsed.b) && parsed.b.length === TILE_PX * TILE_PX) {
      this.gpu.atlas.heroPixelsB.set(parsed.b);
    }
    this.gpu.atlas.syncHeroSlots();
    this.gpu.syncAtlasToGpu();
  }

  private syncPaletteColors(): void {
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    this.paletteEls.forEach((chip, idx) => {
      if (idx === 0) return;
      const hex = theme.colors[idx] ?? '#ffffff';
      chip.style.backgroundColor = hex;
      const isGlow = (idx === 14 && theme.emissive14 > 0) || (idx === 15 && theme.emissive15 > 0);
      chip.classList.toggle('is-emissive-active', isGlow);
    });
  }

  private syncPaletteSelection(): void {
    this.paletteEls.forEach((chip, i) => {
      chip.classList.toggle('is-selected', i === this.selectedColor);
    });
  }

  private syncToolbarState(): void {
    const slot = this.slots[this.activeSlot];
    for (const [key, b] of this.slotBtns.entries()) {
      b.classList.toggle('is-active', key === this.activeSlot);
    }
    this.sizeBtn.textContent = `📐 ${slot.gridW}×${slot.gridH}`;
    this.sizeBtn.classList.toggle('is-active', slot.gridW !== 16 || slot.gridH !== 16);
    this.frameCountSelect.value = String(slot.frameCount);
    this.frameBtns.forEach((b, i) => {
      b.classList.toggle('panel-hidden', i >= slot.frameCount);
      b.classList.toggle('is-active', i === this.activeFrameIdx);
    });
    this.pencilBtn.classList.toggle('is-active', this.activeTool === 'pencil' && !this.activeStamp);
    this.eraserBtn.classList.toggle('is-active', this.activeTool === 'eraser' && !this.activeStamp);
    this.fillBtn.classList.toggle('is-active', this.activeTool === 'fill' && !this.activeStamp);
    this.eyedropBtn.classList.toggle('is-active', this.activeTool === 'eyedropper' && !this.activeStamp);
    this.onionBtn.classList.toggle('is-active', this.onionSkin);
    this.mirrorBtn.classList.toggle('is-active', this.mirrorX);
    this.undoBtn.disabled = this.undoStack.length === 0;
    for (const [id, b] of this.stampBtns.entries()) {
      b.classList.toggle('is-active', this.activeStamp?.id === id);
    }
  }

  private updateLightReadout(): void {
    const deg = Math.round((this.lightAngle * 180) / Math.PI);
    const next = `光源角度 ${deg}° (${this.lightNormX.toFixed(2)}, ${this.lightNormY.toFixed(2)})`;
    if (next !== this.lastLightReadout) {
      this.lastLightReadout = next;
      this.lightCoordEl.textContent = next;
    }
  }

  public renderBoard(): void {
    const ctx = this.boardCtx;
    if (!ctx) return;

    const slot = this.slots[this.activeSlot];
    const gw = slot.gridW;
    const gh = slot.gridH;
    const { ox, oy, cellPx, drawW, drawH } = this.getBoardLayout(gw, gh);
    const buf = this.getCurrentBuffer();
    const prevIdx = (this.activeFrameIdx - 1 + slot.frameCount) % slot.frameCount;
    const prevBuf =
      this.onionSkin && slot.frameCount > 1 && prevIdx !== this.activeFrameIdx ? slot.frames[prevIdx] : null;
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];

    ctx.fillStyle = '#18141d';
    ctx.fillRect(0, 0, BOARD_CANVAS_PX, BOARD_CANVAS_PX);

    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const px = ox + x * cellPx;
        const py = oy + y * cellPx;
        ctx.fillStyle = (x + y) % 2 === 0 ? '#faf3e5' : '#efe4cf';
        ctx.fillRect(px, py, cellPx, cellPx);

        const i = y * gw + x;
        const idx = buf[i] ?? 0;
        if (idx > 0) {
          ctx.fillStyle = theme.colors[idx] ?? '#ffffff';
          ctx.fillRect(px, py, cellPx, cellPx);
          const isGlow = (idx === 14 && theme.emissive14 > 0) || (idx === 15 && theme.emissive15 > 0);
          if (isGlow && cellPx >= 10) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillRect(px + 2, py + 2, Math.max(2, Math.floor(cellPx * 0.22)), Math.max(2, Math.floor(cellPx * 0.22)));
          }
        } else if (prevBuf && prevBuf[i] > 0) {
          const [r, g, b] = hexToRgb(theme.colors[prevBuf[i]] ?? '#ffffff');
          const mr = Math.round(r * 0.45 + 94 * 0.55);
          const mg = Math.round(g * 0.45 + 194 * 0.55);
          const mb = Math.round(b * 0.45 + 247 * 0.55);
          ctx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, 0.36)`;
          ctx.fillRect(px, py, cellPx, cellPx);
        }
      }
    }

    // Subtle pixel gridlines + center symmetry guides
    ctx.strokeStyle = 'rgba(56, 40, 32, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 1; gx < gw; gx++) {
      const pos = ox + gx * cellPx + 0.5;
      ctx.moveTo(pos, oy);
      ctx.lineTo(pos, oy + drawH);
    }
    for (let gy = 1; gy < gh; gy++) {
      const pos = oy + gy * cellPx + 0.5;
      ctx.moveTo(ox, pos);
      ctx.lineTo(ox + drawW, pos);
    }
    ctx.stroke();

    const midX = ox + drawW * 0.5 + 0.5;
    const midY = oy + drawH * 0.5 + 0.5;
    ctx.strokeStyle = this.mirrorX ? 'rgba(255, 93, 143, 0.55)' : 'rgba(56, 40, 32, 0.2)';
    ctx.beginPath();
    ctx.moveTo(midX, oy);
    ctx.lineTo(midX, oy + drawH);
    ctx.moveTo(ox, midY);
    ctx.lineTo(ox + drawW, midY);
    ctx.stroke();

    if (this.hoverX >= 0 && this.hoverX < gw && this.hoverY >= 0 && this.hoverY < gh) {
      ctx.strokeStyle = '#ff5d8f';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + this.hoverX * cellPx + 1, oy + this.hoverY * cellPx + 1, cellPx - 2, cellPx - 2);
      if (this.mirrorX) {
        const mx = gw - 1 - this.hoverX;
        if (mx !== this.hoverX) {
          ctx.strokeStyle = 'rgba(94, 194, 247, 0.85)';
          ctx.strokeRect(ox + mx * cellPx + 1, oy + this.hoverY * cellPx + 1, cellPx - 2, cellPx - 2);
        }
      }
    }
  }

  public tickPreview(dt: number): void {
    this.animPhase += dt * 4;
    if (!this.lightHover) {
      this.lightAngle = ((this.lightAngle + dt * 0.85 + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.lightNormX = Math.cos(this.lightAngle) * 0.72;
      this.lightNormY = Math.sin(this.lightAngle) * 0.72;
      this.updateLightReadout();
    }

    const ctx = this.previewCtx;
    const img = this.previewImgData;
    if (!ctx || !img) return;

    const slot = this.slots[this.activeSlot];
    const gw = slot.gridW;
    const gh = slot.gridH;
    const frameIdx = Math.floor(this.animPhase) % slot.frameCount;
    const buf = slot.frames[frameIdx];
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];

    for (let i = 0; i < gw * gh; i++) {
      const idx = buf[i] ?? 0;
      const p = i * 4;
      if (idx === 0) {
        this.texelHeightScratch[i] = 0;
        this.texelRgbScratch[p] = 0;
        this.texelRgbScratch[p + 1] = 0;
        this.texelRgbScratch[p + 2] = 0;
        this.texelRgbScratch[p + 3] = 0;
      } else {
        const [r, g, b] = hexToRgb(theme.colors[idx] ?? '#ffffff');
        const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        this.texelHeightScratch[i] = 0.65 + 0.35 * luma;
        this.texelRgbScratch[p] = r;
        this.texelRgbScratch[p + 1] = g;
        this.texelRgbScratch[p + 2] = b;
        this.texelRgbScratch[p + 3] =
          (idx === 14 && theme.emissive14 > 0) || (idx === 15 && theme.emissive15 > 0) ? 255 : 1;
      }
    }

    const lightPx = (this.lightNormX * 0.5 + 0.5) * PREVIEW_CANVAS_PX;
    const lightPy = (this.lightNormY * 0.5 + 0.5) * PREVIEW_CANVAS_PX;
    const lightZ = 34;
    const maxBox = 72;
    const fit = Math.min(maxBox / gw, maxBox / gh);
    const drawW = Math.max(1, Math.round(gw * fit));
    const drawH = Math.max(1, Math.round(gh * fit));
    const marginX = (PREVIEW_CANVAS_PX - drawW) * 0.5;
    const marginY = (PREVIEW_CANVAS_PX - drawH) * 0.5;
    const texScaleX = gw / drawW;
    const texScaleY = gh / drawH;
    const out = img.data;

    for (let py = 0; py < PREVIEW_CANVAS_PX; py++) {
      for (let px = 0; px < PREVIEW_CANVAS_PX; px++) {
        const dst = (py * PREVIEW_CANVAS_PX + px) * 4;
        const ldx = lightPx - px;
        const ldy = lightPy - py;
        const dist2 = ldx * ldx + ldy * ldy;
        const halo = 1 / (1 + dist2 * 0.0012);

        let bgR = 24 + halo * 38;
        let bgG = 19 + halo * 28;
        let bgB = 46 + halo * 52;

        const sx = px - marginX;
        const sy = py - marginY;
        if (sx >= 0 && sx < drawW && sy >= 0 && sy < drawH) {
          const tx = Math.min(gw - 1, Math.floor(sx * texScaleX));
          const ty = Math.min(gh - 1, Math.floor(sy * texScaleY));
          const tIdx = ty * gw + tx;
          const tOff = tIdx * 4;
          if (this.texelRgbScratch[tOff + 3] > 0) {
            const hL = tx > 0 ? this.texelHeightScratch[tIdx - 1] : 0;
            const hR = tx < gw - 1 ? this.texelHeightScratch[tIdx + 1] : 0;
            const hU = ty > 0 ? this.texelHeightScratch[tIdx - gw] : 0;
            const hD = ty < gh - 1 ? this.texelHeightScratch[tIdx + gw] : 0;
            const gx = hR - hL;
            const gy = hD - hU;
            const nx = -gx * 1.4;
            const ny = -gy * 1.4;
            const nz = 1.0;
            const invN = 1 / Math.hypot(nx, ny, nz);

            const lLen = Math.hypot(ldx, ldy, lightZ);
            const lx = ldx / lLen;
            const ly = ldy / lLen;
            const lz = lightZ / lLen;

            const ndl = (nx * lx + ny * ly + nz * lz) * invN;
            const atten = 1 / (1 + dist2 / (64 * 64));
            const diffuse = Math.max(0.55, Math.min(1.36, 0.72 + ndl * 0.58 * atten));

            const hx = lx;
            const hy = ly;
            const hz = lz + 1;
            const invH = 1 / Math.hypot(hx, hy, hz);
            const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) * invN * invH);
            const spec = Math.pow(ndh, 12) * 0.35 * atten;

            const hC = this.texelHeightScratch[tIdx];
            const hBR = tx < gw - 1 && ty < gh - 1 ? this.texelHeightScratch[tIdx + gw + 1] : 0;
            const rim = hC - hBR > 0.45 ? 0.14 * atten : 0;
            const glow = this.texelRgbScratch[tOff + 3] === 255 ? 0.22 : 0;
            const mul = diffuse + glow;

            bgR = this.texelRgbScratch[tOff] * mul + (spec + rim) * 255;
            bgG = this.texelRgbScratch[tOff + 1] * mul + (spec + rim) * 245;
            bgB = this.texelRgbScratch[tOff + 2] * mul + (spec + rim) * 235;
          }
        }

        if (dist2 < 12) {
          const orb = 1 - Math.sqrt(dist2) / 3.5;
          bgR = bgR * (1 - orb) + 255 * orb;
          bgG = bgG * (1 - orb) + 236 * orb;
          bgB = bgB * (1 - orb) + 170 * orb;
        }

        out[dst] = Math.max(0, Math.min(255, Math.round(bgR)));
        out[dst + 1] = Math.max(0, Math.min(255, Math.round(bgG)));
        out[dst + 2] = Math.max(0, Math.min(255, Math.round(bgB)));
        out[dst + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }
}
