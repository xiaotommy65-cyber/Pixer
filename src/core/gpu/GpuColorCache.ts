export const INV_255 = 1 / 255;
const MAX_COLOR_CACHE_ENTRIES = 512;
const PACKED_RGB_CACHE = new Map<string, number>();

function hexDigitVal(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // 0-9
  if (code >= 65 && code <= 70) return code - 55; // A-F
  if (code >= 97 && code <= 102) return code - 87; // a-f
  return -1;
}

function parseHexStrict(hex: string): number {
  const start = hex.charCodeAt(0) === 35 ? 1 : 0; // '#'
  const len = hex.length - start;
  if (len === 6 || len === 8) {
    let val = 0;
    for (let i = 0; i < 6; i++) {
      const d = hexDigitVal(hex.charCodeAt(start + i));
      if (d < 0) return 0xffffff;
      val = (val << 4) | d;
    }
    return val;
  }
  if (len === 3) {
    const r = hexDigitVal(hex.charCodeAt(start));
    const g = hexDigitVal(hex.charCodeAt(start + 1));
    const b = hexDigitVal(hex.charCodeAt(start + 2));
    if (r < 0 || g < 0 || b < 0) return 0xffffff;
    return ((r * 17) << 16) | ((g * 17) << 8) | (b * 17);
  }
  return 0xffffff;
}

export function packHexRgb(hex: string): number {
  const cached = PACKED_RGB_CACHE.get(hex);
  if (cached !== undefined) return cached;

  const packed = parseHexStrict(hex);
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
