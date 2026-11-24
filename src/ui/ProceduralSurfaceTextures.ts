import {
  hexToRgb01Into,
  linearRgbToOklab,
  linearToSrgb,
  mixOklabRgb01,
  oklabToLinearRgbGamut,
  rgb01ToHex,
  srgbToLinear,
} from '../core/math/ColorMath.ts';
import { simplex2D } from '../core/math/NoiseMath.ts';

export type DeskSurfaceStyle = 'quilt' | 'oak' | 'mat';

export interface DeskSurfaceMeta {
  id: DeskSurfaceStyle;
  label: string;
  shortLabel: string;
}

export const DESK_SURFACE_STYLES: readonly DeskSurfaceMeta[] = [
  { id: 'quilt', label: '床沿拼布被', shortLabel: '拼布床沿' },
  { id: 'oak', label: '原木工作桌', shortLabel: '原木桌面' },
  { id: 'mat', label: '像素繪圖墊', shortLabel: '繪圖墊' },
];

export function getDeskSurfaceMeta(style: DeskSurfaceStyle): DeskSurfaceMeta {
  return DESK_SURFACE_STYLES.find((s) => s.id === style) ?? DESK_SURFACE_STYLES[0];
}

export function nextDeskSurfaceStyle(current: DeskSurfaceStyle): DeskSurfaceStyle {
  const idx = DESK_SURFACE_STYLES.findIndex((s) => s.id === current);
  return DESK_SURFACE_STYLES[(idx + 1) % DESK_SURFACE_STYLES.length].id;
}

const TAU = Math.PI * 2;
const RGB_A = new Float32Array(3);
const RGB_B = new Float32Array(3);
const RGB_OUT = new Float32Array(3);
const LAB_SCRATCH = new Float32Array(3);
const URL_CACHE = new Map<string, string>();
const MAX_CACHE_ENTRIES = 64;

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
let scratchImg: ImageData | null = null;

function getScratchSurface(w: number, h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
} | null {
  if (typeof document === 'undefined') return null;
  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
  }
  if (
    scratchCanvas.width !== w ||
    scratchCanvas.height !== h ||
    !scratchCtx ||
    !scratchImg ||
    scratchImg.width !== w ||
    scratchImg.height !== h
  ) {
    scratchCanvas.width = w;
    scratchCanvas.height = h;
    scratchCtx = scratchCanvas.getContext('2d');
    if (!scratchCtx) return null;
    scratchImg = scratchCtx.createImageData(w, h);
  }
  return { canvas: scratchCanvas, ctx: scratchCtx, img: scratchImg };
}

function setCachedUrl(key: string, url: string): string {
  if (URL_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldest = URL_CACHE.keys().next().value;
    if (oldest !== undefined) URL_CACHE.delete(oldest);
  }
  URL_CACHE.set(key, url);
  return url;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mixHex(a: string, b: string, t: number): string {
  hexToRgb01Into(a, RGB_A, 0);
  hexToRgb01Into(b, RGB_B, 0);
  mixOklabRgb01(RGB_A[0], RGB_A[1], RGB_A[2], RGB_B[0], RGB_B[1], RGB_B[2], t, RGB_OUT, 0);
  return rgb01ToHex(RGB_OUT[0], RGB_OUT[1], RGB_OUT[2]);
}

/**
 * Computes a clean Oklab-shifted sRGB byte triplet [R, G, B] into `palette` at slot `slotIdx`,
 * preserving pastel hue integrity without forcing wide dark shadow mud.
 */
function writeOklabTone(
  baseHex: string,
  deltaL: number,
  chromaScale: number,
  palette: Uint8Array,
  slotIdx: number,
): void {
  hexToRgb01Into(baseHex, RGB_OUT, 0);
  linearRgbToOklab(
    srgbToLinear(RGB_OUT[0]),
    srgbToLinear(RGB_OUT[1]),
    srgbToLinear(RGB_OUT[2]),
    LAB_SCRATCH,
    0,
  );
  const L = Math.max(0.06, Math.min(0.985, LAB_SCRATCH[0] + deltaL));
  const a = LAB_SCRATCH[1] * chromaScale;
  const b = LAB_SCRATCH[2] * chromaScale;
  oklabToLinearRgbGamut(L, a, b, RGB_OUT, 0);
  const dst = slotIdx * 3;
  palette[dst] = Math.round(clamp01(linearToSrgb(RGB_OUT[0])) * 255);
  palette[dst + 1] = Math.round(clamp01(linearToSrgb(RGB_OUT[1])) * 255);
  palette[dst + 2] = Math.round(clamp01(linearToSrgb(RGB_OUT[2])) * 255);
}

function putPalettePixel(
  data: Uint8ClampedArray,
  dstOffset: number,
  palette: Uint8Array,
  slotIdx: number,
  alpha = 255,
): void {
  const src = slotIdx * 3;
  data[dstOffset] = palette[src];
  data[dstOffset + 1] = palette[src + 1];
  data[dstOffset + 2] = palette[src + 2];
  data[dstOffset + 3] = alpha;
}

const PAL_SCRATCH = new Uint8Array(6 * 3);

/**
 * Generates a 32x32 seamless cozy Japanese bedroom striped wallpaper tile
 * with tiny pixel diamond motifs (clean Oklab contrast, zero dirty grit).
 */
export function renderWallTextureUrl(wallTopHex: string, wallBotHex: string): string {
  const key = `wall2:${wallTopHex}:${wallBotHex}`;
  const hit = URL_CACHE.get(key);
  if (hit) return hit;

  const w = 32;
  const h = 32;
  const surf = getScratchSurface(w, h);
  if (!surf) return '';

  const baseHex = mixHex(wallTopHex, wallBotHex, 0.35);
  // 0: base, 1: soft stripe, 2: gentle highlight, 3: tiny motif dot
  writeOklabTone(baseHex, 0.01, 0.96, PAL_SCRATCH, 0);
  writeOklabTone(baseHex, -0.016, 1.02, PAL_SCRATCH, 1);
  writeOklabTone(baseHex, 0.024, 0.92, PAL_SCRATCH, 2);
  writeOklabTone(baseHex, -0.028, 1.05, PAL_SCRATCH, 3);

  const data = surf.img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const colMod = x % 16;
      const rowMod = y % 16;
      let slot = 0;
      if (colMod < 6) {
        slot = 1;
      } else if (colMod === 6) {
        slot = 2;
      }
      // Delicate staggered 1px pixel cross-dot floral motif on cream band
      const isMotifA = Math.abs(colMod - 11) + Math.abs(rowMod - 4) <= 1;
      const isMotifB = Math.abs(colMod - 3) + Math.abs(rowMod - 12) <= 1;
      if ((isMotifA || isMotifB) && (colMod === 11 || rowMod === 4 || colMod === 3 || rowMod === 12)) {
        if (colMod === 11 && rowMod === 4) slot = 3;
        else if (colMod === 3 && rowMod === 12) slot = 2;
      }
      putPalettePixel(data, (y * w + x) * 4, PAL_SCRATCH, slot, 232);
    }
  }
  surf.ctx.putImageData(surf.img, 0, 0);
  return setCachedUrl(key, surf.canvas.toDataURL());
}

/**
 * Generates a 64x32 crisp illustrated honey-oak wood grain tile for the window frame and sill.
 */
export function renderWoodTextureUrl(baseHex = '#a66f45'): string {
  const key = `wood2:${baseHex}`;
  const hit = URL_CACHE.get(key);
  if (hit) return hit;

  const w = 64;
  const h = 32;
  const surf = getScratchSurface(w, h);
  if (!surf) return '';

  // 0: highlight, 1: mid wood, 2: deep vein, 3: board seam
  writeOklabTone(baseHex, 0.048, 0.94, PAL_SCRATCH, 0);
  writeOklabTone(baseHex, 0, 1.0, PAL_SCRATCH, 1);
  writeOklabTone(baseHex, -0.048, 1.05, PAL_SCRATCH, 2);
  writeOklabTone(baseHex, -0.09, 1.08, PAL_SCRATCH, 3);

  const data = surf.img.data;
  for (let y = 0; y < h; y++) {
    const rowMod = y % 16;
    for (let x = 0; x < w; x++) {
      let slot = 1;
      if (rowMod === 0) {
        slot = 3;
      } else if (rowMod === 1) {
        slot = 0;
      } else {
        const ax = (x / w) * TAU;
        const wave = Math.sin(ax) * 1.15 + Math.cos(ax * 2.0 + 0.7) * 0.55;
        const ring = Math.sin((y * 0.58 + wave) * 1.15);
        if (ring > 0.62) slot = 0;
        else if (ring < -0.58) slot = 2;
      }
      putPalettePixel(data, (y * w + x) * 4, PAL_SCRATCH, slot);
    }
  }
  surf.ctx.putImageData(surf.img, 0, 0);
  return setCachedUrl(key, surf.canvas.toDataURL());
}

/**
 * Generates the foreground bedside / desk surface tile for one of three crisp craft styles:
 * - 'quilt': Clean cozy pastel gingham & stitched linen bedspread
 * - 'oak':   Warm staggered honey-maple studio planks
 * - 'mat':   Clean mint-sage pixel cutting mat with crisp 1px ruler grid
 */
export function renderForegroundSurfaceUrl(style: DeskSurfaceStyle, ambientTintHex: string): string {
  const key = `fg2:${style}:${ambientTintHex}`;
  const hit = URL_CACHE.get(key);
  if (hit) return hit;

  if (style === 'oak') {
    const w = 96;
    const h = 48;
    const surf = getScratchSurface(w, h);
    if (!surf) return '';

    const baseHex = mixHex('#e2be92', ambientTintHex, 0.1);
    writeOklabTone(baseHex, 0.036, 0.94, PAL_SCRATCH, 0); // bevel/highlight
    writeOklabTone(baseHex, 0.008, 1.0, PAL_SCRATCH, 1);  // plank light
    writeOklabTone(baseHex, -0.016, 1.02, PAL_SCRATCH, 2); // plank mid
    writeOklabTone(baseHex, -0.044, 1.04, PAL_SCRATCH, 3); // grain streak
    writeOklabTone(baseHex, -0.082, 1.05, PAL_SCRATCH, 4); // joint seam

    const data = surf.img.data;
    for (let y = 0; y < h; y++) {
      const plankRow = Math.floor(y / 24);
      const rowY = y % 24;
      const jointX = plankRow === 0 ? 28 : 74;
      for (let x = 0; x < w; x++) {
        let slot = plankRow === 0 ? 1 : 2;
        if (rowY === 0 || x === jointX) {
          slot = 4;
        } else if (rowY === 1 || x === (jointX + 1) % w) {
          slot = 0;
        } else {
          const ax = ((x + plankRow * 31) / w) * TAU;
          const wave = Math.sin(ax) * 1.3 + Math.sin(ax * 2 + 1.1) * 0.6;
          const grain = Math.sin((rowY * 0.45 + wave) * 1.45);
          if (grain > 0.72) slot = 0;
          else if (grain < -0.68) slot = 3;
        }
        putPalettePixel(data, (y * w + x) * 4, PAL_SCRATCH, slot);
      }
    }
    surf.ctx.putImageData(surf.img, 0, 0);
    return setCachedUrl(key, surf.canvas.toDataURL());
  }

  if (style === 'mat') {
    const w = 64;
    const h = 64;
    const surf = getScratchSurface(w, h);
    if (!surf) return '';

    const baseHex = mixHex('#5d8579', ambientTintHex, 0.1);
    writeOklabTone(baseHex, 0.01, 0.98, PAL_SCRATCH, 0);   // matte highlight
    writeOklabTone(baseHex, -0.005, 1.0, PAL_SCRATCH, 1);  // matte base
    writeOklabTone(baseHex, 0.085, 0.72, PAL_SCRATCH, 2);  // subtle sub-tick
    writeOklabTone(baseHex, 0.155, 0.64, PAL_SCRATCH, 3);  // crisp mint grid line

    const data = surf.img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let slot = ((x + y) & 1) === 0 ? 0 : 1;
        const onMajorX = x % 32 === 0;
        const onMajorY = y % 32 === 0;
        const onMidX = x % 16 === 0;
        const onMidY = y % 16 === 0;
        if (onMajorX || onMajorY) {
          slot = 3;
        } else if ((onMidX && (y & 3) === 0) || (onMidY && (x & 3) === 0)) {
          slot = 2;
        }
        putPalettePixel(data, (y * w + x) * 4, PAL_SCRATCH, slot);
      }
    }
    surf.ctx.putImageData(surf.img, 0, 0);
    return setCachedUrl(key, surf.canvas.toDataURL());
  }

  // Default: 'quilt' — Cozy Pastel Gingham & Quilted Linen Bedspread
  const w = 64;
  const h = 64;
  const surf = getScratchSurface(w, h);
  if (!surf) return '';

  const baseHex = mixHex('#f5e8d4', ambientTintHex, 0.11);
  writeOklabTone(baseHex, 0.032, 0.85, PAL_SCRATCH, 0);  // 0: soft cream square
  writeOklabTone(baseHex, -0.004, 1.02, PAL_SCRATCH, 1); // 1: warm apricot gingham band
  writeOklabTone(baseHex, -0.028, 1.08, PAL_SCRATCH, 2); // 2: gingham intersection
  writeOklabTone(baseHex, -0.056, 1.1, PAL_SCRATCH, 3);  // 3: quilting seam stitch
  writeOklabTone(baseHex, 0.048, 0.72, PAL_SCRATCH, 4);  // 4: puff catchlight edge

  const data = surf.img.data;
  for (let y = 0; y < h; y++) {
    const bandY = (y % 32) < 16 ? 1 : 0;
    const seamY = y % 32;
    for (let x = 0; x < w; x++) {
      const bandX = (x % 32) < 16 ? 1 : 0;
      const seamX = x % 32;
      const bandSum = bandX + bandY;

      let slot = bandSum; // 0 (cream), 1 (stripe), 2 (check intersection)
      // Tiny linen micro-weave on single stripe band only (no muddy checkers)
      if (bandSum === 1 && ((x + y) & 1) === 0) {
        slot = 0;
      }

      // Crisp quilted seam & dashed embroidery stitch every 32px
      if (seamX === 0 || seamY === 0) {
        const dash = seamX === 0 ? (y & 3) < 2 : (x & 3) < 2;
        slot = dash ? 3 : 1;
      } else if (seamX === 1 || seamY === 1) {
        if (bandSum === 0) slot = 4;
      }
      // Little embroidered corner tack at patch centers
      if (Math.abs(seamX - 16) + Math.abs(seamY - 16) === 1) {
        slot = 3;
      }
      putPalettePixel(data, (y * w + x) * 4, PAL_SCRATCH, slot);
    }
  }
  surf.ctx.putImageData(surf.img, 0, 0);
  return setCachedUrl(key, surf.canvas.toDataURL());
}

/**
 * Generates a crisp 48x48 dot-grid cream sketchbook paper tile (1:1 CSS pixels).
 */
export function renderPaperTextureUrl(): string {
  const key = 'paper2:studio';
  const hit = URL_CACHE.get(key);
  if (hit) return hit;

  const w = 48;
  const h = 48;
  const surf = getScratchSurface(w, h);
  if (!surf) return '';

  writeOklabTone('#fffdf8', 0, 1.0, PAL_SCRATCH, 0);
  writeOklabTone('#fffdf8', -0.095, 1.0, PAL_SCRATCH, 1); // soft taupe dot-grid

  const data = surf.img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const isDot = x % 12 === 6 && y % 12 === 6;
      putPalettePixel(data, (y * w + x) * 4, PAL_SCRATCH, isDot ? 1 : 0);
    }
  }
  surf.ctx.putImageData(surf.img, 0, 0);
  return setCachedUrl(key, surf.canvas.toDataURL());
}

/**
 * Generates a clean 32x32 soft oatmeal linen twill tile for the Cartridge Rack prop.
 */
export function renderTrayFeltTextureUrl(): string {
  const key = 'felt2:tray';
  const hit = URL_CACHE.get(key);
  if (hit) return hit;

  const w = 32;
  const h = 32;
  const surf = getScratchSurface(w, h);
  if (!surf) return '';

  writeOklabTone('#f6ecda', 0.008, 0.96, PAL_SCRATCH, 0);
  writeOklabTone('#f6ecda', -0.014, 1.02, PAL_SCRATCH, 1);

  const data = surf.img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const twill = ((x + y) & 3) === 0;
      putPalettePixel(data, (y * w + x) * 4, PAL_SCRATCH, twill ? 1 : 0);
    }
  }
  surf.ctx.putImageData(surf.img, 0, 0);
  return setCachedUrl(key, surf.canvas.toDataURL());
}

/**
 * Generates a soft edge-feathered architectural sunlight / moonlight beam & hearth glow overlay (128x96)
 * radiating cleanly from `sunNormX` with smooth 4-edge falloff so no rectangular cut ever appears.
 */
export function renderWindowLightBeamUrl(
  warmTintHex: string,
  fireIntensity: number,
  sunNormX = 0.42,
): string {
  const safeSunX = clamp01(sunNormX);
  const fireBucket = Math.round(clamp01(fireIntensity) * 4);
  const sunBucket = Math.round(safeSunX * 10);
  const key = `beam3:${warmTintHex}:${fireBucket}:${sunBucket}`;
  const hit = URL_CACHE.get(key);
  if (hit) return hit;

  const w = 128;
  const h = 96;
  const surf = getScratchSurface(w, h);
  if (!surf) return '';

  hexToRgb01Into(warmTintHex, RGB_OUT, 0);
  const tr = Math.round(RGB_OUT[0] * 255);
  const tg = Math.round(RGB_OUT[1] * 255);
  const tb = Math.round(RGB_OUT[2] * 255);

  const data = surf.img.data;
  const isNightSpill = fireIntensity >= 0.65;
  const beamSlope = (0.5 - safeSunX) * 0.44;
  for (let y = 0; y < h; y++) {
    const ny = y / (h - 1);
    const edgeY = Math.sin(ny * Math.PI);
    const vFade = edgeY * (0.45 + 0.55 * Math.sin(clamp01(ny * 0.92) * Math.PI));
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1);
      const edgeX = Math.sin(nx * Math.PI);
      const edgeMask = edgeX * edgeX * vFade;

      let outR = tr;
      let outG = tg;
      let outB = tb;
      let intensity = 0;
      if (isNightSpill) {
        const dx = (nx - safeSunX * 0.95) * 1.4;
        const dy = (ny - 0.24) * 1.5;
        const moonSpill = Math.pow(Math.max(0, 1 - Math.hypot(dx, dy) * 1.35), 2) * edgeMask * 0.22;
        const hx = (nx - 0.34) * 1.35;
        const hy = (ny - 0.58) * 1.35;
        const hearth = Math.pow(Math.max(0, 1 - Math.hypot(hx, hy) * 1.4), 2) * edgeMask * 0.26;
        const total = moonSpill + hearth;
        if (total > 0.001) {
          const wMoon = moonSpill / total;
          outR = Math.round(166 * wMoon + tr * (1 - wMoon));
          outG = Math.round(206 * wMoon + tg * (1 - wMoon));
          outB = Math.round(255 * wMoon + tb * (1 - wMoon));
          intensity = Math.min(0.32, total);
        }
      } else {
        const shiftX = nx - ny * beamSlope - safeSunX;
        const paneA = Math.max(0, 1 - Math.abs(shiftX + 0.16) * 5.8);
        const paneB = Math.max(0, 1 - Math.abs(shiftX) * 4.8);
        const paneC = Math.max(0, 1 - Math.abs(shiftX - 0.17) * 5.8);
        const beam = Math.max(paneA * 0.82, paneB, paneC * 0.78);
        const gentleWave = 0.9 + 0.1 * simplex2D(nx * 3.2, ny * 2.8, 29);
        intensity = beam * beam * edgeMask * gentleWave * 0.34;
      }

      const dst = (y * w + x) * 4;
      data[dst] = outR;
      data[dst + 1] = outG;
      data[dst + 2] = outB;
      data[dst + 3] = Math.round(clamp01(intensity) * 255);
    }
  }
  surf.ctx.putImageData(surf.img, 0, 0);
  return setCachedUrl(key, surf.canvas.toDataURL());
}
