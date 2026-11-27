import { BUILTIN_SPRITE_GRIDS } from '../assets/AtlasSpritesData.ts';
import { PALETTE_THEMES } from '../assets/sprites/PaletteData.ts';
import { PARKOUR_SPRITE_GRIDS } from '../assets/sprites/ParkourSprites.ts';
import {
  DEFAULT_HERO_FRAME_A,
  DEFAULT_HERO_FRAME_B,
  parseGridToIndices,
  TILE_PX,
} from '../assets/TextureAtlas.ts';
import type { ExternalAudioBank } from '../core/audio/ExternalAudioBank.ts';
import type { EcsCustomSpriteDef } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import type { GpuEngine } from '../core/gpu/GpuEngine.ts';
import type { SaveService } from '../core/runtime/SaveService.ts';
import { el } from './dom.ts';
import {
  buildSpriteAtelierDom,
  syncAtelierPaletteColors,
  syncAtelierPaletteSelection,
  syncAtelierToolbarState,
  type PaintTool,
  type SlotKey,
  type SlotState,
  type SpriteAtelierDomRefs,
} from './SpriteAtelierDomBuilder.ts';
import {
  applyOutlineAndBevelBuffer,
  floodFillBuffer,
  GRID_PRESETS,
  hexToRgb,
  indicesToGrid,
  loadImageFileSource,
  quantizeImageToPaletteBuffer,
  renderNormalLitPreview,
  resampleBuffer,
  type StampDef,
} from './SpriteAtelierPixelOps.ts';

export { indicesToGrid };

const BOARD_CANVAS_PX = 384;
const PREVIEW_CANVAS_PX = 96;
const MAX_UNDO_STEPS = 20;

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

interface UndoEntry {
  slot: SlotKey;
  frameIdx: number;
  gridW: number;
  gridH: number;
  data: Uint8Array;
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
  private synth: ExternalAudioBank;
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
  private readonly dom: SpriteAtelierDomRefs;
  private previewImgData: ImageData | null = null;

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
    synth: ExternalAudioBank,
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
    const layout = el('div', 'atelier-grid-layout');

    // Interactive Canvas Drawing Surface
    const boardWrap = el('div', 'atelier-workbench-panel');
    this.boardCanvas = el('canvas', 'atelier-pixel-canvas');
    this.boardCanvas.width = BOARD_CANVAS_PX;
    this.boardCanvas.height = BOARD_CANVAS_PX;
    this.boardCtx = this.boardCanvas.getContext('2d');
    boardWrap.appendChild(this.boardCanvas);
    this.bindBoardPointerEvents();

    this.dom = buildSpriteAtelierDom({
      signal: this.ac.signal,
      previewCanvasPx: PREVIEW_CANVAS_PX,
      slots: this.slots,
      onSelectSlot: (key) => {
        this.activeSlot = key;
        this.activeFrameIdx = Math.min(this.activeFrameIdx, this.slots[key].frameCount - 1);
        this.syncToolbarState();
        this.renderBoard();
      },
      onToggleGridSize: () => this.toggleSlotGridSize(),
      onChangeFrameCount: (nextCount) => {
        this.slots[this.activeSlot].frameCount = nextCount;
        if (this.activeFrameIdx >= nextCount) this.activeFrameIdx = nextCount - 1;
        this.editEpoch++;
        this.syncToolbarState();
        this.renderBoard();
      },
      onSelectFrame: (idx) => {
        this.activeFrameIdx = idx;
        this.syncToolbarState();
        this.renderBoard();
      },
      onToggleOnionSkin: () => {
        this.onionSkin = !this.onionSkin;
        this.syncToolbarState();
        this.renderBoard();
      },
      onPreviewPointerMove: (nx, ny) => {
        this.lightHover = true;
        this.lightNormX = nx;
        this.lightNormY = ny;
        this.lightAngle = Math.atan2(ny, nx);
        this.updateLightReadout();
      },
      onPreviewPointerLeave: () => {
        this.lightHover = false;
      },
      onSelectTheme: (themeIdx) => {
        this.selectedThemeIdx = themeIdx;
        this.syncPaletteColors();
        this.renderBoard();
      },
      onSelectPaletteColor: (idx) => {
        this.selectedColor = idx;
        this.activeStamp = null;
        if (idx === 0) this.activeTool = 'eraser';
        else if (this.activeTool === 'eraser' || this.activeTool === 'eyedropper') this.activeTool = 'pencil';
        this.syncPaletteSelection();
        this.syncToolbarState();
      },
      onSelectTool: (tool) => {
        if (tool === 'toggle_fill') {
          this.activeTool = this.activeTool === 'fill' ? 'pencil' : 'fill';
        } else if (tool === 'toggle_eyedropper') {
          this.activeTool = this.activeTool === 'eyedropper' ? 'pencil' : 'eyedropper';
        } else {
          this.activeTool = tool;
        }
        this.activeStamp = null;
        this.syncToolbarState();
      },
      onToggleMirrorX: () => {
        this.mirrorX = !this.mirrorX;
        this.syncToolbarState();
      },
      onUndo: () => this.undoLastEdit(),
      onCopyPrevFrame: () => {
        const slot = this.slots[this.activeSlot];
        const prevIdx = (this.activeFrameIdx - 1 + slot.frameCount) % slot.frameCount;
        this.saveUndoSnapshot();
        slot.frames[this.activeFrameIdx].set(slot.frames[prevIdx]);
        this.commitAtlasUpdate();
        this.renderBoard();
      },
      onAutoOutline: () => this.applyAutoOutlineAndBevel(),
      onImportFile: (file) => void this.importImageFile(file),
      onToggleStamp: (stamp) => {
        this.activeStamp = this.activeStamp?.id === stamp.id ? null : stamp;
        if (this.activeStamp && this.activeTool === 'fill') this.activeTool = 'pencil';
        this.syncToolbarState();
      },
      onApplyHeroPreset: (gridA, gridB) => {
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
      onPublishMapTile: () => this.handlePublishMapTile(),
      onPublishPrefabStamp: () => this.handlePublishPrefabStamp(),
    });

    if (this.dom.previewCtx) {
      this.previewImgData = this.dom.previewCtx.createImageData(PREVIEW_CANVAS_PX, PREVIEW_CANVAS_PX);
    }

    layout.append(boardWrap, this.dom.sidebar);
    this.element.append(this.dom.head, layout);

    this.syncPaletteColors();
    this.syncPaletteSelection();
    this.syncToolbarState();
    this.updateLightReadout();
    this.renderBoard();
  }

  private bindBoardPointerEvents(): void {
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
    this.dom.publishLayerSelect.value = defaultLayer;
    this.dom.publishSolidCheck.checked = defaultLayer === 'wall';
    this.dom.publishHazardCheck.checked = false;
    this.dom.publishNameInput.value = `自訂像素磚 #${this.publishCounter}`;
    this.dom.publishStatusEl.textContent = `已切換至 ${width}×${height} 瓦片槽位，繪製後可一鍵發佈。`;
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
      this.dom.publishStatusEl.textContent = '工作站發佈通道未連線';
      return;
    }
    const slot = this.slots[this.activeSlot];
    const layer = (this.dom.publishLayerSelect.value as EcsMapLayerName) || 'ground';
    const rawName = this.dom.publishNameInput.value.trim() || `自訂瓦片 #${this.publishCounter}`;
    const sprite = this.buildCurrentCustomSpriteDef('atelier_tile', rawName);
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    const lightHex = theme.colors[14] || theme.colors[15] || '#ffd447';
    const res = this.publishBridge.onPublishMapTile({
      sprite,
      name: rawName,
      layer,
      solid: this.dom.publishSolidCheck.checked || layer === 'wall',
      hazard: this.dom.publishHazardCheck.checked,
      ...(layer === 'wall' ? { extrudeH: 20 } : {}),
      ...(layer === 'decor' && slot.gridH > 32 ? { renderH: Math.min(64, slot.gridH) } : {}),
      ...(this.dom.publishLightCheck.checked
        ? { ambientLight: { radius: 96, color: lightHex, intensity: 0.72 } }
        : {}),
    });
    this.synth.unlock();
    this.synth.playPreset(res.ok ? 'star' : 'snap');
    this.dom.publishStatusEl.textContent = res.message;
    if (res.ok) {
      this.dom.publishNameInput.value = `自訂像素磚 #${this.publishCounter}`;
    }
  }

  private handlePublishPrefabStamp(): void {
    if (!this.publishBridge) {
      this.dom.publishStatusEl.textContent = '工作站發佈通道未連線';
      return;
    }
    const rawName = this.dom.publishNameInput.value.trim() || `自訂物件 #${this.publishCounter}`;
    const sprite = this.buildCurrentCustomSpriteDef('atelier_prop', rawName);
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    const lightHex = theme.colors[14] || theme.colors[15] || '#ffd447';
    const res = this.publishBridge.onPublishPrefabStamp({
      sprite,
      name: rawName,
      solid: this.dom.publishSolidCheck.checked,
      ...(this.dom.publishLightCheck.checked
        ? { ambientLight: { radius: 96, color: lightHex, intensity: 0.72 } }
        : {}),
    });
    this.synth.unlock();
    this.synth.playPreset(res.ok ? 'star' : 'snap');
    this.dom.publishStatusEl.textContent = res.message;
    if (res.ok) {
      this.dom.publishNameInput.value = `自訂物件 #${this.publishCounter}`;
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
    this.dom.undoBtn.disabled = false;
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
      floodFillBuffer(buf, gw, gh, x, y, this.selectedColor);
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

  private applyAutoOutlineAndBevel(): void {
    const slot = this.slots[this.activeSlot];
    const buf = this.getCurrentBuffer();
    this.saveUndoSnapshot();
    const changed = applyOutlineAndBevelBuffer(buf, slot.gridW, slot.gridH);
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
    this.dom.importStatusEl.textContent = '量化中…';
    let pushedUndo = false;
    try {
      const loaded = await loadImageFileSource(file);
      if (!loaded) {
        this.dom.importStatusEl.textContent = '無法讀取圖片';
        return;
      }

      const slot = this.slots[this.activeSlot];
      const gw = slot.gridW;
      const gh = slot.gridH;
      const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
      this.saveUndoSnapshot();
      pushedUndo = true;

      let res: 'ok' | 'transparent' | 'no_ctx';
      try {
        res = quantizeImageToPaletteBuffer(
          loaded,
          gw,
          gh,
          theme,
          this.getCurrentBuffer(),
          this.oklabPaletteScratch,
          this.okTmp,
        );
      } finally {
        loaded.cleanup();
      }

      if (res !== 'ok') {
        this.undoStack.pop();
        pushedUndo = false;
        this.syncToolbarState();
        this.dom.importStatusEl.textContent = res === 'transparent' ? '圖片完全透明' : '無法建立畫布';
        return;
      }

      this.synth.unlock();
      this.synth.playPreset('star');
      this.commitAtlasUpdate();
      this.syncToolbarState();
      this.renderBoard();
      this.dom.importStatusEl.textContent = `已匯入 ${gw}×${gh} Oklab 量化`;
    } catch {
      if (pushedUndo) {
        this.undoStack.pop();
        this.syncToolbarState();
      }
      this.dom.importStatusEl.textContent = '圖片解析失敗';
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
    syncAtelierPaletteColors(this.dom.paletteEls, this.selectedThemeIdx);
  }

  private syncPaletteSelection(): void {
    syncAtelierPaletteSelection(this.dom.paletteEls, this.selectedColor);
  }

  private syncToolbarState(): void {
    syncAtelierToolbarState(this.dom, {
      activeSlot: this.activeSlot,
      slot: this.slots[this.activeSlot],
      activeFrameIdx: this.activeFrameIdx,
      activeTool: this.activeTool,
      activeStamp: this.activeStamp,
      onionSkin: this.onionSkin,
      mirrorX: this.mirrorX,
      undoCount: this.undoStack.length,
    });
  }

  private updateLightReadout(): void {
    const deg = Math.round((this.lightAngle * 180) / Math.PI);
    const next = `光源角度 ${deg}° (${this.lightNormX.toFixed(2)}, ${this.lightNormY.toFixed(2)})`;
    if (next !== this.lastLightReadout) {
      this.lastLightReadout = next;
      this.dom.lightCoordEl.textContent = next;
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

    const ctx = this.dom.previewCtx;
    const img = this.previewImgData;
    if (!ctx || !img) return;

    const slot = this.slots[this.activeSlot];
    const frameIdx = Math.floor(this.animPhase) % slot.frameCount;
    const theme = PALETTE_THEMES[this.selectedThemeIdx] ?? PALETTE_THEMES[0];
    renderNormalLitPreview(
      ctx,
      img,
      PREVIEW_CANVAS_PX,
      slot.frames[frameIdx],
      slot.gridW,
      slot.gridH,
      theme,
      this.lightNormX,
      this.lightNormY,
      this.texelHeightScratch,
      this.texelRgbScratch,
    );
  }
}
