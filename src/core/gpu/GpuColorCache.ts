export const INV_255 = 1 / 255;
const MAX_COLOR_CACHE_ENTRIES = 512;
const PACKED_RGB_CACHE = new Map<string, number>();

export function packHexRgb(hex: string): number {
  const cached = PACKED_RGB_CACHE.get(hex);
  if (cached !== undefined) return cached;

  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const parsed = clean.length === 6 ? parseInt(clean, 16) : 0xffffff;
  const packed = Number.isNaN(parsed) ? 0xffffff : parsed & 0xffffff;
  if (PACKED_RGB_CACHE.size >= MAX_COLOR_CACHE_ENTRIES) {
    PACKED_RGB_CACHE.clear();
  }
  PACKED_RGB_CACHE.set(hex, packed);
  return packed;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const n = packHexRgb(hex);
  return [((n >> 16) & 255) * INV_255, ((n >> 8) & 255) * INV_255, (n & 255) * INV_255];
}
