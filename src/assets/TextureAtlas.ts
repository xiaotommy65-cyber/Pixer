import {
  BOSS_SLIME_KING_32,
  BOSS_UFO_GRID_32,
  BUILTIN_SPRITE_GRIDS,
  DEFAULT_HERO_FRAME_A,
  DEFAULT_HERO_FRAME_B,
  TOYBOX_PALETTE,
  type SpriteId,
} from './AtlasSpritesData.ts';
import { AUTO_TILE_SPRITE_GRIDS } from './sprites/AutoTileSprites.ts';
import { buildCastleSprites } from './sprites/CastleSprites.ts';
import { buildHdMaterialSprites } from './sprites/HdMaterialSprites.ts';
import { buildPaletteLutRgba, PALETTE_THEME_COUNT } from './sprites/PaletteData.ts';
import { PIXEL_FONT_5X7 } from './sprites/PixelFontData.ts';
import { MaxRectsBin } from 'maxrects-packer';
import { MAX_ATLAS_PAGES, type AtlasPoolStats, type SpriteRect } from '../core/gpu/GpuTypes.ts';

export { DEFAULT_HERO_FRAME_A, DEFAULT_HERO_FRAME_B, MAX_ATLAS_PAGES, PALETTE_THEME_COUNT, TOYBOX_PALETTE };
export type { AtlasPoolStats, SpriteId };

export const ATLAS_SIZE = 1024;
export const TILE_PX = 16;

export const PALETTE_RGB: readonly [number, number, number, number][] = TOYBOX_PALETTE.map((hex, i) => {
  if (i === 0) return [0, 0, 0, 0];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
});

const CHAR_MAP: Record<string, number> = {
  '.': 0,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, a: 10, b: 11, c: 12, d: 13, e: 14, f: 15,
};

export function parseGridToIndices(grid: readonly string[], out?: Uint8Array): Uint8Array {
  const h = grid.length;
  const w = grid[0]?.length ?? TILE_PX;
  const buf = out ?? new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowStr = grid[y] ?? '';
    for (let x = 0; x < w; x++) {
      buf[y * w + x] = CHAR_MAP[rowStr[x] ?? '.'] ?? 0;
    }
  }
  return buf;
}

const SLOTS_PER_ROW = ATLAS_SIZE / TILE_PX; // 64 slots per row on 1024x1024
const DYNAMIC_START_Y = 128; // Reserve top 128px (8 rows x 64 cols = 512 slots) for built-in tiles

const MAXRECTS_BIN_OPTIONS = {
  smart: false,
  pot: false,
  square: false,
  allowRotation: false,
  border: 0,
};

interface DynamicAtlasSlot {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AtlasExtraPage {
  pixels: Uint8Array;
  indexPixels: Uint8Array;
  bin: MaxRectsBin;
}

export interface SpriteSheetMeta {
  sheetId: string;
  cols: number;
  rows: number;
  frameW: number;
  frameH: number;
  frameIds: string[];
  pageIndex: number;
}

/**
 * Multi-page 1024x1024 Texture Atlas Pool (up to 8 pages) supporting built-in 16-color indexed
 * sprites (with 16xN Palette LUT), live Sprite Atelier hero editing, external PNG sprite-sheet
 * slicing, and runtime 32-bit RGBA dynamic slot allocation with safe recycling.
 */
export class TextureAtlas {
  public static readonly FONT_GLYPH_W = 6;
  public static readonly FONT_GLYPH_H = 8;

  public readonly width = ATLAS_SIZE;
  public readonly height = ATLAS_SIZE;
  public readonly pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  /** Per-texel palette index: 0 = transparent, 1..15 = LUT index, 255 = full RGBA passthrough */
  public readonly indexPixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE);
  public readonly paletteLut = buildPaletteLutRgba();
  public readonly paletteRows = PALETTE_THEME_COUNT;
  public readonly rects = new Map<SpriteId, SpriteRect>();
  private readonly glyphRects = new Map<number, SpriteRect>();
  private readonly dynamicSlots = new Map<string, DynamicAtlasSlot>();
  private readonly freeDynamicSlots: DynamicAtlasSlot[] = [];
  private readonly extraPages: AtlasExtraPage[] = [];
  private readonly spriteSheets = new Map<string, SpriteSheetMeta>();
  private builtinSpriteCount = 0;
  public readonly heroPixelsA = new Uint8Array(TILE_PX * TILE_PX);
  public readonly heroPixelsB = new Uint8Array(TILE_PX * TILE_PX);

  private page0Bin = new MaxRectsBin(ATLAS_SIZE, ATLAS_SIZE - DYNAMIC_START_Y, 0, MAXRECTS_BIN_OPTIONS);
  private dirty = false;
  private revision = 0;

  constructor() {
    this.buildInitialAtlas();
    this.builtinSpriteCount = this.rects.size;
  }

  public getRevision(): number {
    return this.revision;
  }

  private pixelUv(x0: number, y0: number, w: number, h: number, page = 0): SpriteRect {
    const pad = 0.075 / ATLAS_SIZE;
    return {
      u0: x0 / ATLAS_SIZE + pad,
      v0: y0 / ATLAS_SIZE + pad,
      u1: (x0 + w) / ATLAS_SIZE - pad,
      v1: (y0 + h) / ATLAS_SIZE - pad,
      w,
      h,
      page,
    };
  }

  private slotUv(col: number, row: number, spanCols = 1, spanRows = 1): SpriteRect {
    return this.pixelUv(col * TILE_PX, row * TILE_PX, spanCols * TILE_PX, spanRows * TILE_PX);
  }

  private blitIndexBufferAt(startX: number, startY: number, buf: Uint8Array, w = TILE_PX, h = TILE_PX): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = buf[y * w + x] ?? 0;
        const [r, g, b, a] = PALETTE_RGB[idx] ?? [0, 0, 0, 0];
        const texIdx = (startY + y) * ATLAS_SIZE + (startX + x);
        this.indexPixels[texIdx] = idx;
        const px = texIdx * 4;
        this.pixels[px] = r;
        this.pixels[px + 1] = g;
        this.pixels[px + 2] = b;
        this.pixels[px + 3] = a;
      }
    }
  }

  private blitIndexBuffer(col: number, row: number, buf: Uint8Array, w = TILE_PX, h = TILE_PX): void {
    this.blitIndexBufferAt(col * TILE_PX, row * TILE_PX, buf, w, h);
  }

  private blitRgbaBuffer(startX: number, startY: number, w: number, h: number, rgba: Uint8Array): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * 4;
        const texIdx = (startY + y) * ATLAS_SIZE + (startX + x);
        this.indexPixels[texIdx] = 255;
        const dst = texIdx * 4;
        this.pixels[dst] = rgba[src] ?? 0;
        this.pixels[dst + 1] = rgba[src + 1] ?? 0;
        this.pixels[dst + 2] = rgba[src + 2] ?? 0;
        this.pixels[dst + 3] = rgba[src + 3] ?? 0;
      }
    }
  }

  private buildInitialAtlas(): void {
    // Slot (0,0): solid white pixel tile (full RGBA passthrough)
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const texIdx = y * ATLAS_SIZE + x;
        this.indexPixels[texIdx] = 255;
        const px = texIdx * 4;
        this.pixels[px] = 255;
        this.pixels[px + 1] = 255;
        this.pixels[px + 2] = 255;
        this.pixels[px + 3] = 255;
      }
    }
    this.rects.set('solid', this.slotUv(0, 0));

    // Load default hero frames into mutable index buffers
    parseGridToIndices(DEFAULT_HERO_FRAME_A, this.heroPixelsA);
    parseGridToIndices(DEFAULT_HERO_FRAME_B, this.heroPixelsB);
    this.syncHeroSlots();

    const orderedIds: SpriteId[] = [
      'slime_a', 'slime_b', 'cloud_l', 'cloud_m', 'cloud_r',
      'grass', 'dirt', 'star_a', 'star_b', 'key',
      'gate_closed', 'gate_open', 'heart_full', 'heart_empty',
      'ship_a', 'ship_b', 'jelly_ufo', 'meteor', 'bolt', 'sparkle',
      'momo_idle', 'momo_happy',
      'crate', 'spring', 'bomb', 'torch', 'switch_off', 'switch_on', 'stone',
    ];

    let slot = 3; // 0 = solid, 1 = hero_a, 2 = hero_b
    for (const id of orderedIds) {
      const col = slot % 16;
      const row = Math.floor(slot / 16);
      const grid = (BUILTIN_SPRITE_GRIDS as Record<string, string[] | undefined>)[id];
      if (grid) {
        this.blitIndexBuffer(col, row, parseGridToIndices(grid));
      }
      this.rects.set(id, this.slotUv(col, row));
      slot++;
    }

    // 32x16 wide boss UFO at row 2, col 0..1
    this.blitIndexBuffer(0, 2, parseGridToIndices(BOSS_UFO_GRID_32), 32, 16);
    this.rects.set('boss_ufo', this.slotUv(0, 2, 2, 1));

    // RPG / D&D dungeon tiles & monsters starting cleanly at row 2, col 2 (slot 34..45)
    const rpgIds: SpriteId[] = [
      'dungeon_floor', 'door_closed', 'door_open', 'stairs_down',
      'chest_closed', 'chest_open', 'goblin', 'skeleton',
      'dragon', 'potion', 'npc_sage', 'trap',
    ];
    let rpgSlot = 34;
    for (const id of rpgIds) {
      const col = rpgSlot % 16;
      const row = Math.floor(rpgSlot / 16);
      const grid = (BUILTIN_SPRITE_GRIDS as Record<string, string[] | undefined>)[id];
      if (grid) {
        this.blitIndexBuffer(col, row, parseGridToIndices(grid));
      }
      this.rects.set(id, this.slotUv(col, row));
      rpgSlot++;
    }

    // 32x16 Slime King Boss at row 3, col 0..1 (slots 48..49)
    this.blitIndexBuffer(0, 3, parseGridToIndices(BOSS_SLIME_KING_32), 32, 16);
    this.rects.set('slime_king', this.slotUv(0, 3, 2, 1));

    // Campaign / RPG / Puzzle expansion sprites starting at row 3, col 2 (slots 50..83, wrapping cleanly onto 32-col rows)
    const extIds: SpriteId[] = [
      'campfire', 'merchant', 'shaman', 'gargoyle', 'portal',
      'flag_off', 'flag_on', 'relic_feather', 'relic_dash', 'coin',
      'moving_plat', 'laser_beam', 'option_orb', 'sword_icon', 'shield_icon',
      'ship_titan', 'ship_prism', 'enemy_interceptor', 'enemy_frigate',
      'enemy_carrier', 'missile_pod', 'pickup_bomb', 'boss_wing', 'pickup_crystal',
      'shrine', 'npc_elder', 'slime_knight', 'ember_warden', 'frost_mage',
      'sword_slash', 'tree_canopy', 'anvil_forge', 'astral_core', 'relic_flame',
      'momo_run_a', 'momo_run_b', 'momo_jump', 'momo_slide', 'momo_wave_a', 'momo_wave_b',
      'meadow_floor',
      'parkour_hero_idle', 'parkour_hero_run_a', 'parkour_hero_run_b',
      'parkour_hero_jump', 'parkour_hero_wall', 'parkour_hero_dash',
      'grapple_claw', 'grapple_ring', 'grapple_link', 'grapple_reticle',
      'scarf_node', 'crystal_reset', 'crumble_tile', 'zip_block', 'ik_joint', 'ik_claw',
    ];
    let extSlot = 50;
    for (const id of extIds) {
      const col = extSlot % 16;
      const row = Math.floor(extSlot / 16);
      const grid = (BUILTIN_SPRITE_GRIDS as Record<string, string[] | undefined>)[id];
      if (grid && row * TILE_PX < DYNAMIC_START_Y && col < SLOTS_PER_ROW) {
        this.blitIndexBuffer(col, row, parseGridToIndices(grid));
      }
      this.rects.set(id, this.slotUv(col, row));
      extSlot++;
    }

    // 4-bit N/E/S/W Auto-Tiling & decal grids packed into free static region col 16..63, row 0..4
    const autoIds = Object.keys(AUTO_TILE_SPRITE_GRIDS) as SpriteId[];
    let autoCol = 16;
    let autoRow = 0;
    for (const id of autoIds) {
      const grid = AUTO_TILE_SPRITE_GRIDS[id];
      if (grid && autoRow <= 4) {
        this.blitIndexBuffer(autoCol, autoRow, parseGridToIndices(grid));
      }
      this.rects.set(id, this.slotUv(autoCol, autoRow));
      autoCol++;
      if (autoCol >= SLOTS_PER_ROW) {
        autoCol = 16;
        autoRow++;
      }
    }

    // Pack 5x7 GPU Bitmap Font (ASCII 32..95) into col 16..63, rows 6..7 (y = 96 and y = 104)
    const glyphCell = new Uint8Array(8 * 8 * 4);
    for (let code = 32; code <= 95; code++) {
      const idx = code - 32;
      const gxIdx = idx % 32;
      const gyIdx = Math.floor(idx / 32);
      const px = 16 * TILE_PX + gxIdx * 8;
      const py = 96 + gyIdx * 8;
      glyphCell.fill(0);
      const pattern = PIXEL_FONT_5X7[String.fromCharCode(code)];
      if (pattern) {
        for (let gy = 0; gy < 7; gy++) {
          const rowStr = pattern[gy] ?? '';
          for (let gx = 0; gx < 5; gx++) {
            if (rowStr[gx] === '#') {
              const dst = (gy * 8 + gx) * 4;
              glyphCell[dst] = 255;
              glyphCell[dst + 1] = 255;
              glyphCell[dst + 2] = 255;
              glyphCell[dst + 3] = 255;
            }
          }
        }
      }
      this.blitRgbaBuffer(px, py, 8, 8, glyphCell);
      this.glyphRects.set(code, this.pixelUv(px, py, TextureAtlas.FONT_GLYPH_W, TextureAtlas.FONT_GLYPH_H));
    }

    // Default procedural 96x48 16-bit twilight mountain + spire silhouette RGBA backdrop
    this.registerDynamicRgbaSprite('parallax_twilight_bg', 96, 48, this.buildProceduralTwilightMountains());

    // Pixer 7.0+ High-Definition 64x64 / 48x48 Procedural Material Sprites (32-bit RGBA)
    const hdSprites = buildHdMaterialSprites();
    for (let i = 0; i < hdSprites.length; i++) {
      const sp = hdSprites[i];
      this.registerDynamicRgbaSprite(sp.id, sp.width, sp.height, sp.rgba);
    }

    // Pixer 10.0 HD-2D Demon Castle 32x32 / 32x48 / 48x64 PBR Pixel Architecture & Props
    const castleSprites = buildCastleSprites();
    for (let i = 0; i < castleSprites.length; i++) {
      const sp = castleSprites[i];
      this.registerDynamicRgbaSprite(sp.id, sp.width, sp.height, sp.rgba);
    }
  }

  private buildProceduralTwilightMountains(): Uint8Array {
    const w = 96;
    const h = 48;
    const rgba = new Uint8Array(w * h * 4);
    const tau = Math.PI * 2;
    for (let x = 0; x < w; x++) {
      const u = (x / w) * tau;
      const farY = Math.round(14 + Math.sin(u) * 5 + Math.cos(u * 2 + 0.8) * 3 + Math.sin(u * 4) * 1.2);
      const midY = Math.round(25 + Math.cos(u + 1.3) * 4.5 + Math.sin(u * 3 + 0.4) * 2.5);
      const isTowerCol = x >= 58 && x <= 66;
      const towerCrest =
        x === 58 || x === 60 || x === 62 || x === 64 || x === 66 ? 10 : isTowerCol ? 12 : 99;
      const effMidY = Math.min(midY, towerCrest);
      const farSlopeLit = Math.cos(u) > 0;
      const midSlopeLit = -Math.sin(u + 1.3) > 0;

      for (let y = 0; y < h; y++) {
        const dst = (y * w + x) * 4;
        if (y < farY && y < effMidY) {
          continue;
        }
        if (y >= effMidY) {
          const isTowerBody = isTowerCol && y < midY;
          const isWindow = (x === 61 || x === 63) && (y === 15 || y === 16);
          if (isWindow) {
            rgba[dst] = 255;
            rgba[dst + 1] = 212;
            rgba[dst + 2] = 71;
            rgba[dst + 3] = 255;
          } else if (y === effMidY) {
            // Rim light along mid mountain ridge / tower top
            rgba[dst] = isTowerBody || midSlopeLit ? 184 : 118;
            rgba[dst + 1] = isTowerBody || midSlopeLit ? 114 : 90;
            rgba[dst + 2] = isTowerBody || midSlopeLit ? 156 : 146;
            rgba[dst + 3] = 255;
          } else if (y >= 41) {
            // Soft bottom horizon mist fade
            const mistT = (y - 40) / 7;
            rgba[dst] = Math.round(42 + mistT * 46);
            rgba[dst + 1] = Math.round(29 + mistT * 38);
            rgba[dst + 2] = Math.round(68 + mistT * 52);
            rgba[dst + 3] = Math.round(255 - mistT * 75);
          } else if (isTowerBody && x === 58) {
            rgba[dst] = 152;
            rgba[dst + 1] = 96;
            rgba[dst + 2] = 136;
            rgba[dst + 3] = 255;
          } else {
            const band = ((y + (x >> 2)) & 3) === 0;
            rgba[dst] = midSlopeLit ? (band ? 62 : 50) : (band ? 44 : 36);
            rgba[dst + 1] = midSlopeLit ? (band ? 43 : 35) : (band ? 31 : 25);
            rgba[dst + 2] = midSlopeLit ? (band ? 98 : 82) : (band ? 74 : 62);
            rgba[dst + 3] = 255;
          }
        } else {
          // Far atmospheric mountain ridge
          if (y === farY) {
            rgba[dst] = farSlopeLit ? 156 : 118;
            rgba[dst + 1] = farSlopeLit ? 128 : 102;
            rgba[dst + 2] = farSlopeLit ? 186 : 158;
            rgba[dst + 3] = 235;
          } else {
            rgba[dst] = farSlopeLit ? 82 : 66;
            rgba[dst + 1] = farSlopeLit ? 64 : 52;
            rgba[dst + 2] = farSlopeLit ? 124 : 104;
            rgba[dst + 3] = 240;
          }
        }
      }
    }
    return rgba;
  }

  public syncHeroSlots(): void {
    this.blitIndexBuffer(1, 0, this.heroPixelsA);
    this.blitIndexBuffer(2, 0, this.heroPixelsB);
    this.rects.set('hero_a', this.slotUv(1, 0));
    this.rects.set('hero_b', this.slotUv(2, 0));
    this.dirty = true;
    this.revision++;
  }

  private getPageBuffers(page: number): { pixels: Uint8Array; indexPixels: Uint8Array } {
    if (page <= 0 || page > this.extraPages.length) {
      return { pixels: this.pixels, indexPixels: this.indexPixels };
    }
    const p = this.extraPages[page - 1];
    return { pixels: p.pixels, indexPixels: p.indexPixels };
  }

  private clearAtlasRect(page: number, startX: number, startY: number, w: number, h: number): void {
    const { pixels, indexPixels } = this.getPageBuffers(page);
    for (let y = 0; y < h; y++) {
      const rowBase = (startY + y) * ATLAS_SIZE + startX;
      indexPixels.fill(0, rowBase, rowBase + w);
      pixels.fill(0, rowBase * 4, (rowBase + w) * 4);
    }
  }

  private blitRgbaToPage(page: number, startX: number, startY: number, w: number, h: number, rgba: Uint8Array): void {
    if (page === 0) {
      this.blitRgbaBuffer(startX, startY, w, h, rgba);
      return;
    }
    const { pixels, indexPixels } = this.getPageBuffers(page);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * 4;
        const a = rgba[src + 3] ?? 0;
        const dstIdx = (startY + y) * ATLAS_SIZE + (startX + x);
        const dst = dstIdx * 4;
        if (a === 0) {
          indexPixels[dstIdx] = 0;
          pixels[dst] = 0;
          pixels[dst + 1] = 0;
          pixels[dst + 2] = 0;
          pixels[dst + 3] = 0;
        } else {
          indexPixels[dstIdx] = 255;
          pixels[dst] = rgba[src] ?? 0;
          pixels[dst + 1] = rgba[src + 1] ?? 0;
          pixels[dst + 2] = rgba[src + 2] ?? 0;
          pixels[dst + 3] = a;
        }
      }
    }
  }

  private allocateDynamicRegion(w: number, h: number): DynamicAtlasSlot | null {
    // 1. Prefer best-fit recycled free slot to avoid shelf growth and fragmentation
    let bestIdx = -1;
    let bestWaste = Infinity;
    for (let i = 0; i < this.freeDynamicSlots.length; i++) {
      const slot = this.freeDynamicSlots[i];
      if (slot.w >= w && slot.h >= h) {
        const waste = slot.w * slot.h - w * h;
        if (waste < bestWaste) {
          bestWaste = waste;
          bestIdx = i;
          if (waste === 0) break;
        }
      }
    }
    if (bestIdx >= 0) {
      const chosen = this.freeDynamicSlots[bestIdx];
      const last = this.freeDynamicSlots.pop()!;
      if (bestIdx < this.freeDynamicSlots.length) {
        this.freeDynamicSlots[bestIdx] = last;
      }
      return chosen;
    }

    // 2. Pack into primary page 0 dynamic MaxRectsBin (yOffset = DYNAMIC_START_Y)
    const p0Rect = this.page0Bin.add(w, h, null);
    if (p0Rect && p0Rect.x + w <= ATLAS_SIZE && p0Rect.y + h <= ATLAS_SIZE - DYNAMIC_START_Y) {
      return { page: 0, x: p0Rect.x, y: DYNAMIC_START_Y + p0Rect.y, w, h };
    }

    // 3. Spill into existing extra pages (1..MAX_ATLAS_PAGES-1) via MaxRectsBin
    for (let i = 0; i < this.extraPages.length; i++) {
      const ep = this.extraPages[i];
      const epRect = ep.bin.add(w, h, null);
      if (epRect && epRect.x + w <= ATLAS_SIZE && epRect.y + h <= ATLAS_SIZE) {
        return { page: i + 1, x: epRect.x, y: epRect.y, w, h };
      }
    }

    // 4. Allocate a brand new atlas page on demand up to MAX_ATLAS_PAGES
    if (this.extraPages.length + 1 < MAX_ATLAS_PAGES) {
      const bin = new MaxRectsBin(ATLAS_SIZE, ATLAS_SIZE, 0, MAXRECTS_BIN_OPTIONS);
      const placed = bin.add(w, h, null);
      if (!placed) return null;
      const newPage: AtlasExtraPage = {
        pixels: new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4),
        indexPixels: new Uint8Array(ATLAS_SIZE * ATLAS_SIZE),
        bin,
      };
      this.extraPages.push(newPage);
      return { page: this.extraPages.length, x: placed.x, y: placed.y, w, h };
    }

    return null;
  }

  /** Releases a previously allocated dynamic sprite slot back to the free-list for safe reuse. */
  public releaseDynamicSprite(id: string): boolean {
    const slot = this.dynamicSlots.get(id);
    if (!slot) return false;
    this.dynamicSlots.delete(id);
    this.rects.delete(id);
    this.clearAtlasRect(slot.page, slot.x, slot.y, slot.w, slot.h);
    this.freeDynamicSlots.push(slot);
    if (this.dynamicSlots.size === 0) {
      this.freeDynamicSlots.length = 0;
      this.page0Bin = new MaxRectsBin(ATLAS_SIZE, ATLAS_SIZE - DYNAMIC_START_Y, 0, MAXRECTS_BIN_OPTIONS);
      this.extraPages.length = 0;
    }
    this.dirty = true;
    this.revision++;
    return true;
  }

  /** Releases all dynamic sprites matching a prefix (e.g. on cartridge unload). */
  public releaseDynamicByPrefix(prefix: string): number {
    if (!prefix) return 0;
    let released = 0;
    for (const id of [...this.dynamicSlots.keys()]) {
      if (id.startsWith(prefix) && this.releaseDynamicSprite(id)) {
        released++;
      }
    }
    return released;
  }

  public getDynamicSlotCount(): number {
    return this.dynamicSlots.size;
  }

  public getPageCount(): number {
    return 1 + this.extraPages.length;
  }

  public getPagePixels(page: number): Uint8Array | null {
    if (page === 0) return this.pixels;
    return this.extraPages[page - 1]?.pixels ?? null;
  }

  public getPageIndexPixels(page: number): Uint8Array | null {
    if (page === 0) return this.indexPixels;
    return this.extraPages[page - 1]?.indexPixels ?? null;
  }

  public getExtraPages(): { pixels: Uint8Array; indexPixels: Uint8Array }[] {
    return this.extraPages.map((p) => ({ pixels: p.pixels, indexPixels: p.indexPixels }));
  }

  public getAtlasStats(): AtlasPoolStats {
    const pageCount = this.getPageCount();
    const bytesPerPage = ATLAS_SIZE * ATLAS_SIZE * 5; // 4B RGBA + 1B index
    return {
      pageCount,
      maxPages: MAX_ATLAS_PAGES,
      pageSize: ATLAS_SIZE,
      builtinSprites: this.builtinSpriteCount,
      dynamicSprites: this.dynamicSlots.size,
      spriteSheets: this.spriteSheets.size,
      totalBytes: pageCount * bytesPerPage,
    };
  }

  public listSpriteSheets(): SpriteSheetMeta[] {
    return Array.from(this.spriteSheets.values()).map((s) => ({
      ...s,
      frameIds: [...s.frameIds],
    }));
  }

  /**
   * Slices an external or procedurally generated RGBA sprite sheet into `cols x rows` frames
   * and registers them as `${sheetId}:0..N-1` inside the multi-page dynamic atlas pool.
   */
  public importSpriteSheet(
    sheetId: string,
    rgba: Uint8Array,
    imgW: number,
    imgH: number,
    cols: number,
    rows: number,
  ): SpriteSheetMeta {
    const safeCols = Math.max(1, Math.min(32, Math.round(cols)));
    const safeRows = Math.max(1, Math.min(32, Math.round(rows)));
    const frameW = Math.max(1, Math.min(512, Math.floor(imgW / safeCols)));
    const frameH = Math.max(1, Math.min(256, Math.floor(imgH / safeRows)));
    const frameBuf = new Uint8Array(frameW * frameH * 4);
    const frameIds: string[] = [];
    let lastPage = 0;

    let idx = 0;
    for (let r = 0; r < safeRows; r++) {
      for (let c = 0; c < safeCols; c++) {
        for (let y = 0; y < frameH; y++) {
          const srcY = r * frameH + y;
          const srcRow = (srcY * imgW + c * frameW) * 4;
          const dstRow = y * frameW * 4;
          frameBuf.set(rgba.subarray(srcRow, srcRow + frameW * 4), dstRow);
        }
        const fid = `${sheetId}:${idx++}`;
        const rect = this.registerDynamicRgbaSprite(fid, frameW, frameH, frameBuf);
        lastPage = rect.page ?? 0;
        frameIds.push(fid);
      }
    }

    const meta: SpriteSheetMeta = {
      sheetId,
      cols: safeCols,
      rows: safeRows,
      frameW,
      frameH,
      frameIds,
      pageIndex: lastPage,
    };
    this.spriteSheets.set(sheetId, meta);
    return { ...meta, frameIds: [...meta.frameIds] };
  }

  /**
   * Registers or updates a runtime 32-bit RGBA sprite (full-color, unlimited palette)
   * for custom plugins, procedurally generated art, or AI-synthesized textures.
   */
  public registerDynamicRgbaSprite(id: string, w: number, h: number, rgba: Uint8Array): SpriteRect {
    const safeW = Math.max(1, Math.min(512, Math.round(w)));
    const safeH = Math.max(1, Math.min(256, Math.round(h)));
    const existingSlot = this.dynamicSlots.get(id);
    if (existingSlot && existingSlot.w >= safeW && existingSlot.h >= safeH) {
      if (existingSlot.w !== safeW || existingSlot.h !== safeH) {
        this.clearAtlasRect(existingSlot.page, existingSlot.x, existingSlot.y, existingSlot.w, existingSlot.h);
      }
      this.blitRgbaToPage(existingSlot.page, existingSlot.x, existingSlot.y, safeW, safeH, rgba);
      const rect = this.pixelUv(existingSlot.x, existingSlot.y, safeW, safeH, existingSlot.page);
      this.rects.set(id, rect);
      this.dirty = true;
      this.revision++;
      return rect;
    }
    if (existingSlot) {
      this.releaseDynamicSprite(id);
    }
    const slot = this.allocateDynamicRegion(safeW, safeH);
    if (!slot) {
      return this.rects.get('solid')!;
    }
    this.dynamicSlots.set(id, slot);
    this.blitRgbaToPage(slot.page, slot.x, slot.y, safeW, safeH, rgba);
    const rect = this.pixelUv(slot.x, slot.y, safeW, safeH, slot.page);
    this.rects.set(id, rect);
    this.dirty = true;
    this.revision++;
    return rect;
  }

  /** Registers or updates a palette-indexed pixel grid dynamically at runtime (>=128px dynamic region). */
  public registerDynamicGridSprite(id: string, grid: readonly string[]): SpriteRect {
    const safeH = Math.max(1, Math.min(128, grid.length));
    const safeW = Math.max(1, Math.min(128, grid[0]?.length ?? TILE_PX));
    const indices = parseGridToIndices(grid);
    const existingSlot = this.dynamicSlots.get(id);
    if (existingSlot && existingSlot.page === 0 && existingSlot.w >= safeW && existingSlot.h >= safeH) {
      if (existingSlot.w !== safeW || existingSlot.h !== safeH) {
        this.clearAtlasRect(0, existingSlot.x, existingSlot.y, existingSlot.w, existingSlot.h);
      }
      this.blitIndexBufferAt(existingSlot.x, existingSlot.y, indices, safeW, safeH);
      const rect = this.pixelUv(existingSlot.x, existingSlot.y, safeW, safeH, 0);
      this.rects.set(id, rect);
      this.dirty = true;
      this.revision++;
      return rect;
    }
    if (existingSlot) {
      this.releaseDynamicSprite(id);
    }
    const slot = this.allocateDynamicRegion(safeW, safeH);
    if (!slot) {
      return this.rects.get('solid')!;
    }
    this.dynamicSlots.set(id, slot);
    if (slot.page === 0) {
      this.blitIndexBufferAt(slot.x, slot.y, indices, safeW, safeH);
    } else {
      const rgba = new Uint8Array(safeW * safeH * 4);
      for (let i = 0; i < safeW * safeH; i++) {
        const idx = indices[i] ?? 0;
        const c = PALETTE_RGB[idx] ?? [0, 0, 0, 0];
        rgba[i * 4] = c[0];
        rgba[i * 4 + 1] = c[1];
        rgba[i * 4 + 2] = c[2];
        rgba[i * 4 + 3] = c[3];
      }
      this.blitRgbaToPage(slot.page, slot.x, slot.y, safeW, safeH, rgba);
    }
    const rect = this.pixelUv(slot.x, slot.y, safeW, safeH, slot.page);
    this.rects.set(id, rect);
    this.dirty = true;
    this.revision++;
    return rect;
  }

  public hasSprite(id: SpriteId): boolean {
    return this.rects.has(id);
  }

  public isDirty(): boolean {
    return this.dirty;
  }

  public clearDirty(): void {
    this.dirty = false;
  }

  public getRect(id: SpriteId): SpriteRect {
    return this.rects.get(id) ?? this.rects.get('solid')!;
  }

  public getGlyphRect(charCode: number): SpriteRect | undefined {
    return this.glyphRects.get(charCode);
  }
}
