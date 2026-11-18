import {
  BOSS_SLIME_KING_32,
  BOSS_UFO_GRID_32,
  BUILTIN_SPRITE_GRIDS,
  DEFAULT_HERO_FRAME_A,
  DEFAULT_HERO_FRAME_B,
  TOYBOX_PALETTE,
  type SpriteId,
} from './AtlasSpritesData.ts';
import { buildPaletteLutRgba, PALETTE_THEME_COUNT } from './sprites/PaletteData.ts';
import type { SpriteRect } from '../core/gpu/GpuTypes.ts';

export { DEFAULT_HERO_FRAME_A, DEFAULT_HERO_FRAME_B, PALETTE_THEME_COUNT, TOYBOX_PALETTE };
export type { SpriteId };

export const ATLAS_SIZE = 512;
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

const SLOTS_PER_ROW = ATLAS_SIZE / TILE_PX; // 32 slots per row on 512x512
const DYNAMIC_START_Y = 128; // Reserve top 128px (8 rows x 32 cols = 256 slots) for built-in tiles

/**
 * Dynamic 512x512 Texture Atlas supporting built-in 16-color indexed sprites (with 16xN Palette LUT),
 * live Sprite Atelier hero editing, and runtime 32-bit RGBA / dynamic shelf allocation
 * for plugins and AI-synthesized pixel art.
 */
export class TextureAtlas {
  public readonly width = ATLAS_SIZE;
  public readonly height = ATLAS_SIZE;
  public readonly pixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  /** Per-texel palette index: 0 = transparent, 1..15 = LUT index, 255 = full RGBA passthrough */
  public readonly indexPixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE);
  public readonly paletteLut = buildPaletteLutRgba();
  public readonly paletteRows = PALETTE_THEME_COUNT;
  public readonly rects = new Map<SpriteId, SpriteRect>();
  public readonly heroPixelsA = new Uint8Array(TILE_PX * TILE_PX);
  public readonly heroPixelsB = new Uint8Array(TILE_PX * TILE_PX);

  private shelfX = 0;
  private shelfY = DYNAMIC_START_Y;
  private shelfRowH = 0;
  private dirty = false;

  constructor() {
    this.buildInitialAtlas();
  }

  private pixelUv(x0: number, y0: number, w: number, h: number): SpriteRect {
    const pad = 0.00015;
    return {
      u0: x0 / ATLAS_SIZE + pad,
      v0: y0 / ATLAS_SIZE + pad,
      u1: (x0 + w) / ATLAS_SIZE - pad,
      v1: (y0 + h) / ATLAS_SIZE - pad,
      w,
      h,
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
  }

  public syncHeroSlots(): void {
    this.blitIndexBuffer(1, 0, this.heroPixelsA);
    this.blitIndexBuffer(2, 0, this.heroPixelsB);
    this.rects.set('hero_a', this.slotUv(1, 0));
    this.rects.set('hero_b', this.slotUv(2, 0));
    this.dirty = true;
  }

  private allocateDynamicRegion(w: number, h: number): { x: number; y: number } {
    if (this.shelfX + w > ATLAS_SIZE) {
      this.shelfX = 0;
      this.shelfY += Math.max(TILE_PX, this.shelfRowH);
      this.shelfRowH = 0;
    }
    if (this.shelfY + h > ATLAS_SIZE) {
      // Wrap safely within dynamic zone if exhausted by excessive registrations
      this.shelfX = 0;
      this.shelfY = DYNAMIC_START_Y;
      this.shelfRowH = 0;
    }
    const x = this.shelfX;
    const y = this.shelfY;
    this.shelfX += w;
    this.shelfRowH = Math.max(this.shelfRowH, h);
    return { x, y };
  }

  /**
   * Registers or updates a runtime 32-bit RGBA sprite (full-color, unlimited palette)
   * for custom plugins, procedurally generated art, or AI-synthesized textures.
   */
  public registerDynamicRgbaSprite(id: string, w: number, h: number, rgba: Uint8Array): SpriteRect {
    const safeW = Math.max(1, Math.min(128, Math.round(w)));
    const safeH = Math.max(1, Math.min(128, Math.round(h)));
    const existing = this.rects.get(id);
    if (existing && existing.w === safeW && existing.h === safeH) {
      const startX = Math.floor(existing.u0 * ATLAS_SIZE);
      const startY = Math.floor(existing.v0 * ATLAS_SIZE);
      if (startY >= DYNAMIC_START_Y) {
        this.blitRgbaBuffer(startX, startY, safeW, safeH, rgba);
        this.dirty = true;
        return existing;
      }
    }
    const { x, y } = this.allocateDynamicRegion(safeW, safeH);
    this.blitRgbaBuffer(x, y, safeW, safeH, rgba);
    const rect = this.pixelUv(x, y, safeW, safeH);
    this.rects.set(id, rect);
    this.dirty = true;
    return rect;
  }

  /** Registers or updates a palette-indexed pixel grid dynamically at runtime (>=128px dynamic region). */
  public registerDynamicGridSprite(id: string, grid: readonly string[]): SpriteRect {
    const safeH = Math.max(1, Math.min(128, grid.length));
    const safeW = Math.max(1, Math.min(128, grid[0]?.length ?? TILE_PX));
    const indices = parseGridToIndices(grid);
    const existing = this.rects.get(id);
    if (existing && existing.w === safeW && existing.h === safeH) {
      const startX = Math.floor(existing.u0 * ATLAS_SIZE);
      const startY = Math.floor(existing.v0 * ATLAS_SIZE);
      if (startY >= DYNAMIC_START_Y) {
        this.blitIndexBufferAt(startX, startY, indices, safeW, safeH);
        this.dirty = true;
        return existing;
      }
    }
    const { x, y } = this.allocateDynamicRegion(safeW, safeH);
    this.blitIndexBufferAt(x, y, indices, safeW, safeH);
    const rect = this.pixelUv(x, y, safeW, safeH);
    this.rects.set(id, rect);
    this.dirty = true;
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
}
