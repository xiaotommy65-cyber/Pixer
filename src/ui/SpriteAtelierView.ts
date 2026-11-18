import { PALETTE_THEMES } from '../assets/sprites/PaletteData.ts';
import {
  DEFAULT_HERO_FRAME_A,
  DEFAULT_HERO_FRAME_B,
  parseGridToIndices,
  TILE_PX,
} from '../assets/TextureAtlas.ts';
import { BUILTIN_SPRITE_GRIDS } from '../assets/AtlasSpritesData.ts';
import type { ToySynth } from '../core/audio/ToySynth.ts';
import type { GpuEngine } from '../core/gpu/GpuEngine.ts';
import type { SaveService } from '../core/runtime/SaveService.ts';
import { drawIndexBufferToCanvas } from './MomoMascot.ts';
import { btn, el } from './dom.ts';

const HEX_DIGITS = '.123456789abcdef';

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

type SlotKey = 'hero' | 'custom_enemy' | 'custom_item' | 'custom_tile';

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

interface SlotState {
  label: string;
  frameCount: 2 | 3 | 4;
  frames: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

function hexToRgb(hex: string): [number, number, number] {
  if (!hex || hex === 'transparent' || !hex.startsWith('#')) return [0, 0, 0];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class SpriteAtelierView {
  public readonly element: HTMLElement;

  private gpu: GpuEngine;
  private synth: ToySynth;
  private save: SaveService;
  private onHeroSaved?: () => void;

  private slots: Record<SlotKey, SlotState>;
  private activeSlot: SlotKey = 'hero';
  private activeFrameIdx = 0;
  private selectedColor = 4;
  private selectedThemeIdx = 0;
  private activeStamp: StampDef | null = null;
  private onionSkin = true;
  private mirrorX = false;
  private fillMode = false;
  private isDrawing = false;
  private undoSnapshot: { slot: SlotKey; frameIdx: number; data: Uint8Array } | null = null;

  private cellEls: HTMLDivElement[] = [];
  private paletteEls: HTMLButtonElement[] = [];
  private slotBtns = new Map<SlotKey, HTMLButtonElement>();
  private frameBtns: HTMLButtonElement[] = [];
  private frameCountSelect: HTMLSelectElement;
  private themeSelect: HTMLSelectElement;
  private stampBtns = new Map<string, HTMLButtonElement>();
  private onionBtn: HTMLButtonElement;
  private mirrorBtn: HTMLButtonElement;
  private fillBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private previewCanvas: HTMLCanvasElement;
  private animPhase = 0;
  private readonly ac = new AbortController();

  constructor(gpu: GpuEngine, synth: ToySynth, save: SaveService, onHeroSaved?: () => void) {
    this.gpu = gpu;
    this.synth = synth;
    this.save = save;
    this.onHeroSaved = onHeroSaved;
    this.restoreFromStorage();

    this.slots = {
      hero: {
        label: '🧑 主角',
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
        frameCount: 2,
        frames: [
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A),
          parseGridToIndices(BUILTIN_SPRITE_GRIDS.grass ?? DEFAULT_HERO_FRAME_A),
        ],
      },
    };

    this.element = el('section', 'studio-card');

    const head = el('div', 'studio-head');
    head.innerHTML = `
      <div>
        <h2>🎨 精靈畫室（16×16 多槽位動畫工作台）</h2>
        <p class="studio-sub">支援 2–4 幀洋蔥皮、8 組 LUT 發光主題與圖章，主角會即時同步 GPU 圖集，自訂槽位可打包進工坊卡匣！</p>
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

    // Frame count + 4 frame tabs + Onion skin
    const frameBar = el('div', 'tool-row');
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
      'toy-btn is-active',
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

    // 16x16 Pixel Canvas Grid
    const board = el('div', 'pixel-board');
    let lastPaintedKey = -1;
    const stopDrawing = () => {
      this.isDrawing = false;
      lastPaintedKey = -1;
    };
    const paintFromEvent = (clientX: number, clientY: number) => {
      const rect = board.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = Math.floor(((clientX - rect.left) / rect.width) * TILE_PX);
      const y = Math.floor(((clientY - rect.top) / rect.height) * TILE_PX);
      if (x < 0 || x >= TILE_PX || y < 0 || y >= TILE_PX) return;
      const key = y * TILE_PX + x;
      if (key === lastPaintedKey) return;
      lastPaintedKey = key;
      this.applyPaintAt(x, y);
    };

    board.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        this.synth.unlock();
        this.saveUndoSnapshot();
        this.isDrawing = true;
        lastPaintedKey = -1;
        try {
          board.setPointerCapture(e.pointerId);
        } catch {
          // Safe fallback if pointer capture is unavailable
        }
        paintFromEvent(e.clientX, e.clientY);
      },
      { signal: this.ac.signal },
    );
    board.addEventListener(
      'pointermove',
      (e) => {
        if (!this.isDrawing || this.fillMode || this.activeStamp) return;
        paintFromEvent(e.clientX, e.clientY);
      },
      { signal: this.ac.signal },
    );
    board.addEventListener('pointercancel', stopDrawing, { signal: this.ac.signal });
    board.addEventListener('pointerup', stopDrawing, { signal: this.ac.signal });
    window.addEventListener('pointerup', stopDrawing, { signal: this.ac.signal });
    window.addEventListener('blur', stopDrawing, { signal: this.ac.signal });

    for (let i = 0; i < TILE_PX * TILE_PX; i++) {
      this.cellEls.push(el('div', 'pixel-cell'));
    }
    board.append(...this.cellEls);

    // Sidebar controls
    const sidebar = el('div', 'atelier-sidebar');

    const previewStrip = el('div', 'preview-strip');
    this.previewCanvas = el('canvas', 'preview-canvas');
    this.previewCanvas.width = 16;
    this.previewCanvas.height = 16;
    const previewInfo = el('div');
    previewInfo.innerHTML =
      '<strong>即時動畫預覽</strong><div class="studio-sub">自動循環播放目前槽位影格</div>';

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
    previewStrip.append(this.previewCanvas, previewInfo, this.themeSelect);

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
          this.syncPaletteSelection();
          this.syncToolbarState();
        },
        this.ac.signal,
      );
      this.paletteEls.push(chip);
      paletteGrid.appendChild(chip);
    }

    // Paint Tools
    const tools = el('div', 'tool-row');
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
    this.fillBtn = btn(
      'toy-btn',
      '🪣 油漆桶',
      undefined,
      () => {
        this.fillMode = !this.fillMode;
        this.activeStamp = null;
        this.syncToolbarState();
      },
      this.ac.signal,
    );
    this.undoBtn = btn(
      'toy-btn',
      '↩ 復原',
      '單步復原上一次筆畫／圖章／填色',
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
    tools.append(this.mirrorBtn, this.fillBtn, this.undoBtn, copyPrevBtn);

    // 6 Pixel Stamps
    const stampRow = el('div', 'tool-row');
    for (const stamp of PIXEL_STAMPS) {
      const sBtn = btn(
        'toy-btn is-mint',
        stamp.label,
        `點擊畫布蓋上「${stamp.label}」像素圖章`,
        () => {
          this.activeStamp = this.activeStamp?.id === stamp.id ? null : stamp;
          this.fillMode = false;
          this.syncToolbarState();
        },
        this.ac.signal,
      );
      this.stampBtns.set(stamp.id, sBtn);
      stampRow.appendChild(sBtn);
    }

    // Hero Presets
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
            parseGridToIndices(gridA, this.slots.hero.frames[0]);
            parseGridToIndices(gridB, this.slots.hero.frames[1]);
            this.commitAtlasUpdate();
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

    sidebar.append(previewStrip, paletteGrid, tools, stampRow, presetRow);
    layout.append(board, sidebar);
    this.element.append(head, layout);

    this.syncPaletteColors();
    this.syncPaletteSelection();
    this.syncToolbarState();
    this.renderBoard();
  }

  public destroy(): void {
    this.isDrawing = false;
    this.ac.abort();
  }

  public getSelectedPaletteRow(): number {
    return this.selectedThemeIdx;
  }

  /** Packages current Sprite Studio slots into CartridgeJsonV1.sprites grids. */
  public exportCartridgeSprites(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const prefixMap: Record<SlotKey, string> = {
      hero: 'studio_hero',
      custom_enemy: 'studio_enemy',
      custom_item: 'studio_item',
      custom_tile: 'studio_tile',
    };
    const suffixes = ['a', 'b', 'c', 'd'];
    for (const key of Object.keys(this.slots) as SlotKey[]) {
      const slot = this.slots[key];
      const count = key === 'custom_tile' ? 1 : slot.frameCount;
      for (let i = 0; i < count; i++) {
        const sid = key === 'custom_tile' ? prefixMap[key] : `${prefixMap[key]}_${suffixes[i]}`;
        out[sid] = indicesToGrid(slot.frames[i]);
      }
    }
    return out;
  }

  private getCurrentBuffer(): Uint8Array {
    return this.slots[this.activeSlot].frames[this.activeFrameIdx];
  }

  private saveUndoSnapshot(): void {
    this.undoSnapshot = {
      slot: this.activeSlot,
      frameIdx: this.activeFrameIdx,
      data: new Uint8Array(this.getCurrentBuffer()),
    };
    this.undoBtn.disabled = false;
  }

  private undoLastEdit(): void {
    if (!this.undoSnapshot) return;
    const snap = this.undoSnapshot;
    this.activeSlot = snap.slot;
    this.activeFrameIdx = snap.frameIdx;
    this.slots[snap.slot].frames[snap.frameIdx].set(snap.data);
    this.undoSnapshot = null;
    this.synth.playPreset('snap');
    this.commitAtlasUpdate();
    this.syncToolbarState();
    this.renderBoard();
  }

  private applyStampAt(buf: Uint8Array, cx: number, cy: number, stamp: StampDef): void {
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
        if (tx >= 0 && tx < TILE_PX && ty >= 0 && ty < TILE_PX) {
          buf[ty * TILE_PX + tx] = colorIdx;
          if (this.mirrorX) {
            buf[ty * TILE_PX + (TILE_PX - 1 - tx)] = colorIdx;
          }
        }
      }
    }
  }

  private applyPaintAt(x: number, y: number): void {
    const buf = this.getCurrentBuffer();
    if (this.activeStamp) {
      this.applyStampAt(buf, x, y, this.activeStamp);
      this.synth.playPreset('star');
    } else if (this.fillMode) {
      this.floodFill(buf, x, y, this.selectedColor);
      this.synth.playPreset('bounce');
    } else {
      buf[y * TILE_PX + x] = this.selectedColor;
      if (this.mirrorX) {
        buf[y * TILE_PX + (TILE_PX - 1 - x)] = this.selectedColor;
      }
      this.synth.playPreset('snap');
    }
    this.commitAtlasUpdate();
    this.renderBoard();
  }

  private floodFill(buf: Uint8Array, sx: number, sy: number, targetColor: number): void {
    const orig = buf[sy * TILE_PX + sx];
    if (orig === targetColor) return;
    const queue: [number, number][] = [[sx, sy]];
    while (queue.length > 0) {
      const [cx, cy] = queue.pop()!;
      const idx = cy * TILE_PX + cx;
      if (buf[idx] !== orig) continue;
      buf[idx] = targetColor;
      if (cx > 0) queue.push([cx - 1, cy]);
      if (cx < TILE_PX - 1) queue.push([cx + 1, cy]);
      if (cy > 0) queue.push([cx, cy - 1]);
      if (cy < TILE_PX - 1) queue.push([cx, cy + 1]);
    }
  }

  private commitAtlasUpdate(): void {
    if (this.activeSlot === 'hero' && (this.activeFrameIdx === 0 || this.activeFrameIdx === 1)) {
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
    this.frameCountSelect.value = String(slot.frameCount);
    this.frameBtns.forEach((b, i) => {
      b.classList.toggle('panel-hidden', i >= slot.frameCount);
      b.classList.toggle('is-active', i === this.activeFrameIdx);
    });
    this.onionBtn.classList.toggle('is-active', this.onionSkin);
    this.mirrorBtn.classList.toggle('is-active', this.mirrorX);
    this.fillBtn.classList.toggle('is-active', this.fillMode);
    this.undoBtn.disabled = !this.undoSnapshot;
    for (const [id, b] of this.stampBtns.entries()) {
      b.classList.toggle('is-active', this.activeStamp?.id === id);
    }
  }

  public renderBoard(): void {
    const slot = this.slots[this.activeSlot];
    const buf = this.getCurrentBuffer();
    const prevIdx = (this.activeFrameIdx - 1 + slot.frameCount) % slot.frameCount;
    const prevBuf = this.onionSkin && slot.frameCount > 1 && prevIdx !== this.activeFrameIdx ? slot.frames[prevIdx] : null;
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];

    for (let i = 0; i < TILE_PX * TILE_PX; i++) {
      const idx = buf[i];
      const cell = this.cellEls[i];
      if (idx > 0) {
        cell.style.backgroundColor = theme.colors[idx] ?? '#ffffff';
        cell.classList.remove('is-onion');
      } else if (prevBuf && prevBuf[i] > 0) {
        const [r, g, b] = hexToRgb(theme.colors[prevBuf[i]] ?? '#ffffff');
        cell.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.28)`;
        cell.classList.add('is-onion');
      } else {
        cell.style.backgroundColor = 'transparent';
        cell.classList.remove('is-onion');
      }
    }
  }

  public tickPreview(dt: number): void {
    this.animPhase += dt * 4;
    const slot = this.slots[this.activeSlot];
    const idx = Math.floor(this.animPhase) % slot.frameCount;
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    drawIndexBufferToCanvas(slot.frames[idx], this.previewCanvas, TILE_PX, TILE_PX, theme.colors);
  }
}
