import { encodeRgbaToZlibB64 } from '../ecs/EcsCustomSpriteCompiler.ts';
import type { EcsCustomSpriteDef, EcsProjectV2 } from '../ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand } from '../ecs/EcsStudioSession.ts';
import type { EcsMapLayerName } from '../ecs/EcsTilemapTypes.ts';
import { hexToRgb01Into, linearRgbToOklab, srgbToLinear } from '../math/ColorMath.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import { pickNextCustomTileId, sanitizeInteropId } from './InteropTypes.ts';

export type PixelForgePaletteId =
  | 'asylum_horror'
  | 'obsidian_dungeon'
  | 'cozy_vn'
  | 'cyber_neon'
  | 'endesga_32';

export interface PixelForgePaletteDef {
  readonly id: PixelForgePaletteId;
  readonly label: string;
  readonly genre: string;
  readonly colors: readonly string[];
}

export const PIXEL_FORGE_PALETTES: readonly PixelForgePaletteDef[] = [
  {
    id: 'asylum_horror',
    label: '陰森古宅恐怖 (Asylum Horror · 16色)',
    genre: 'horror',
    colors: [
      '#090a0f', '#151821', '#262b36', '#3e4452',
      '#5c6370', '#8d95a5', '#c5cad4', '#eae6df',
      '#3a0d12', '#6e1620', '#a8242e', '#d64949',
      '#283629', '#4a5d46', '#9b6b2f', '#e0b468',
    ],
  },
  {
    id: 'obsidian_dungeon',
    label: '黑曜赤月地牢 (Obsidian Dungeon · 16色)',
    genre: 'dungeon',
    colors: [
      '#080912', '#17192b', '#2b304d', '#495275',
      '#7885a8', '#b7c2db', '#f4f6fc', '#45121d',
      '#8f1d2c', '#d93848', '#ff8266', '#613318',
      '#a86428', '#e6ad45', '#1d5e7a', '#48c7e8',
    ],
  },
  {
    id: 'cozy_vn',
    label: '暖色手帳物語 (Cozy Visual Novel · 24色)',
    genre: 'visual_novel',
    colors: [
      '#1e141a', '#38252d', '#5e3f45', '#875c5b',
      '#b88378', '#deae9b', '#f5d7c6', '#fff2e8',
      '#3b2a1e', '#6e4c36', '#a3754e', '#d9a96c',
      '#243d32', '#3f6951', '#6ba174', '#aad49a',
      '#283754', '#46618f', '#6f96c7', '#a9cef2',
      '#70344b', '#ab4e6e', '#e07b94', '#f7cbd4',
    ],
  },
  {
    id: 'cyber_neon',
    label: '霓虹賽博龐克 (Cyber Neon · 16色)',
    genre: 'scifi',
    colors: [
      '#05060f', '#12152b', '#23284a', '#3d4573',
      '#6977a8', '#b0c0eb', '#f0f7ff', '#6b124d',
      '#bd1c7d', '#ff3ea5', '#0e5b6e', '#14a3b8',
      '#38f2e6', '#217545', '#52e078', '#ffe854',
    ],
  },
  {
    id: 'endesga_32',
    label: 'ENDESGA 32 萬用像素色盤 (32色)',
    genre: 'universal',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672',
      '#b86f50', '#733e39', '#3e2731', '#a22633',
      '#e43b44', '#f77622', '#feae34', '#fee761',
      '#63c74d', '#3e8948', '#265c42', '#193c3e',
      '#124e89', '#0099db', '#2ce8f5', '#ffffff',
      '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c',
      '#b55088', '#f6757a', '#e8b796', '#c28569',
    ],
  },
];

export type PixelForgeDownscaleMode = 'grid_majority' | 'lossless';
export type PixelForgeColorMode = 'true_color' | 'adaptive_kmeans' | 'palette_lock';
export type PixelForgeBakingProfileId =
  | 'custom'
  | 'wall_top_side'
  | 'billboard_actor'
  | 'emissive_light_prop'
  | 'portrait_160x192';

export interface PixelForgeBakingProfileDef {
  readonly id: PixelForgeBakingProfileId;
  readonly label: string;
  readonly description: string;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly downscaleMode: PixelForgeDownscaleMode;
  readonly colorMode: PixelForgeColorMode;
  readonly maxColors: number;
  readonly stripBackground: boolean;
  readonly cropOpaque: boolean;
  readonly outlineHex: string | null;
  readonly dither: boolean;
  readonly registerPrefab: boolean;
  readonly registerTileLayer?: EcsMapLayerName;
  readonly tileSolid?: boolean;
  readonly tileExtrudeH?: number;
  readonly attachLight?: boolean;
  readonly prefabCategory?: string;
}

export const PIXEL_FORGE_BAKING_PROFILES: readonly PixelForgeBakingProfileDef[] = [
  {
    id: 'wall_top_side',
    label: '3D 牆體頂側組 (Wall Top + Side · 32×32)',
    description: '自動生成 HD-2D 牆頂與牆側雙貼圖，並註冊為可繪製的阻擋牆瓦片。',
    targetWidth: 32,
    targetHeight: 32,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: false,
    cropOpaque: false,
    outlineHex: null,
    dither: true,
    registerPrefab: false,
    registerTileLayer: 'wall',
    tileSolid: true,
    tileExtrudeH: 28,
  },
  {
    id: 'billboard_actor',
    label: '3D Billboard 角色 / 怪物 (48×64)',
    description: '去背、緊密裁切、1px 輪廓描邊，註冊為直立 3D Billboard 角色印章。',
    targetWidth: 48,
    targetHeight: 64,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: '#090b12',
    dither: true,
    registerPrefab: true,
    prefabCategory: 'actor',
  },
  {
    id: 'emissive_light_prop',
    label: '高亮自發光掛點光源道具 (32×32 + Light)',
    description: '自動偵測高光像素主色並為 Prefab 掛載動態 LightSource 與自發光 Bloom。',
    targetWidth: 32,
    targetHeight: 32,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: '#090b12',
    dither: true,
    registerPrefab: true,
    attachLight: true,
    prefabCategory: 'light_prop',
  },
  {
    id: 'portrait_160x192',
    label: '160×192 半身立繪 (Visual Novel Portrait)',
    description: '高精細 Oklab 64 色立繪烘焙，直接註冊為 Pass 1B 過場與對話立繪資產。',
    targetWidth: 160,
    targetHeight: 192,
    downscaleMode: 'grid_majority',
    colorMode: 'adaptive_kmeans',
    maxColors: 64,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: null,
    dither: true,
    registerPrefab: false,
  },
  {
    id: 'custom',
    label: '自訂洗圖參數 (Custom)',
    description: '自由搭配尺寸、調色盤、切幀與註冊目標。',
    targetWidth: 32,
    targetHeight: 32,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: null,
    dither: true,
    registerPrefab: true,
  },
];

export interface PixelForgeDetectedLight {
  color: string;
  radius: number;
  intensity: number;
  emissive: number;
  brightRatio: number;
}

export interface PixelForgeOptions {
  id: string;
  name?: string;
  bakingProfile?: PixelForgeBakingProfileId;
  targetWidth: number;
  targetHeight: number;
  downscaleMode?: PixelForgeDownscaleMode;
  colorMode?: PixelForgeColorMode;
  maxColors?: number;
  paletteId?: PixelForgePaletteId;
  customPalette?: readonly string[];
  stripBackground?: boolean;
  bgTolerance?: number;
  cropOpaque?: boolean;
  outlineHex?: string | null;
  dither?: boolean;
  preserveAspect?: boolean;
  sheetCols?: number;
  sheetRows?: number;
}

export interface PixelForgePreviewFrame {
  id: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface PixelForgeOutput {
  sprites: EcsCustomSpriteDef[];
  animations: AnimationStateMachineDef[];
  detectedBlockSize: number;
  previewFrames: PixelForgePreviewFrame[];
  bakingProfile?: PixelForgeBakingProfileId;
  wallSideSpriteId?: string;
  detectedLight?: PixelForgeDetectedLight;
}

export interface PixelForgeCommitOptions {
  registerTileLayer?: EcsMapLayerName;
  tileSolid?: boolean;
  tileExtrudeH?: number;
  sideSprite?: string;
  roughness?: number;
  metallic?: number;
  emissive?: number;
  registerPrefab?: boolean;
  prefabSolid?: boolean;
  prefabCategory?: string;
  prefabTag?: string;
  attachLight?: boolean;
}

const BAYER4 = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

function clampDim(v: number): number {
  return Math.max(8, Math.min(256, Math.round(v)));
}

function rgbMaxDiff(
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number,
): number {
  const dr = Math.abs(r0 - r1);
  const dg = Math.abs(g0 - g1);
  const db = Math.abs(b0 - b1);
  return dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
}

/**
 * Removes uniform opaque edge backgrounds via corner consensus + 4-way flood fill
 * plus 1px anti-fringe edge cleanup, returning a fresh RGBA buffer.
 */
export function stripEdgeBackgroundRgba(
  rgba: Uint8Array,
  w: number,
  h: number,
  tolerance = 48,
): Uint8Array {
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  const out = new Uint8Array(safeW * safeH * 4);
  out.set(rgba.subarray(0, out.length));
  if (safeW < 2 || safeH < 2) return out;

  const corners = [
    0,
    (safeW - 1) * 4,
    (safeH - 1) * safeW * 4,
    (safeH * safeW - 1) * 4,
  ];
  const opaqueCorners: number[] = [];
  for (const off of corners) {
    if ((out[off + 3] ?? 0) >= 180) opaqueCorners.push(off);
  }
  if (opaqueCorners.length < 3) return out;

  let refOff = -1;
  let agreeCount = 0;
  for (let i = 0; i < opaqueCorners.length; i++) {
    const a = opaqueCorners[i];
    let cnt = 0;
    for (let j = 0; j < opaqueCorners.length; j++) {
      const b = opaqueCorners[j];
      if (rgbMaxDiff(out[a], out[a + 1], out[a + 2], out[b], out[b + 1], out[b + 2]) <= tolerance) {
        cnt++;
      }
    }
    if (cnt >= 3 && cnt > agreeCount) {
      agreeCount = cnt;
      refOff = a;
    }
  }
  if (refOff < 0) return out;

  const bgR = out[refOff];
  const bgG = out[refOff + 1];
  const bgB = out[refOff + 2];
  const visited = new Uint8Array(safeW * safeH);
  const removed = new Uint8Array(safeW * safeH);
  const stack: number[] = [];

  for (let x = 0; x < safeW; x++) {
    stack.push(x, (safeH - 1) * safeW + x);
  }
  for (let y = 1; y < safeH - 1; y++) {
    stack.push(y * safeW, y * safeW + safeW - 1);
  }

  while (stack.length > 0) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const off = p * 4;
    const a = out[off + 3];
    if (a >= 32 && rgbMaxDiff(out[off], out[off + 1], out[off + 2], bgR, bgG, bgB) > tolerance) {
      continue;
    }
    out[off] = 0;
    out[off + 1] = 0;
    out[off + 2] = 0;
    out[off + 3] = 0;
    removed[p] = 1;

    const x = p % safeW;
    const y = (p - x) / safeW;
    if (x > 0) stack.push(p - 1);
    if (x < safeW - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - safeW);
    if (y < safeH - 1) stack.push(p + safeW);
  }

  // 1px fringe cleanup on semi-transparent anti-aliased boundary pixels matching bg
  const fringeTol = Math.min(255, tolerance + 20);
  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const p = y * safeW + x;
      const off = p * 4;
      const a = out[off + 3];
      if (a === 0 || a >= 160) continue;
      const touchesRemoved =
        (x > 0 && removed[p - 1]) ||
        (x < safeW - 1 && removed[p + 1]) ||
        (y > 0 && removed[p - safeW]) ||
        (y < safeH - 1 && removed[p + safeW]);
      if (touchesRemoved && rgbMaxDiff(out[off], out[off + 1], out[off + 2], bgR, bgG, bgB) <= fringeTol) {
        out[off] = 0;
        out[off + 1] = 0;
        out[off + 2] = 0;
        out[off + 3] = 0;
      }
    }
  }
  return out;
}

/**
 * Tight-crops an RGBA image to the bounding box of pixels with `alpha >= 48`.
 */
export function cropOpaqueBoundsRgba(
  rgba: Uint8Array,
  w: number,
  h: number,
  pad = 0,
): { rgba: Uint8Array; width: number; height: number; cropped: boolean } {
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  let minX = safeW;
  let minY = safeH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      if ((rgba[(y * safeW + x) * 4 + 3] ?? 0) >= 48) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    const copy = new Uint8Array(safeW * safeH * 4);
    copy.set(rgba.subarray(0, copy.length));
    return { rgba: copy, width: safeW, height: safeH, cropped: false };
  }

  const safePad = Math.max(0, Math.floor(pad));
  const x0 = Math.max(0, minX - safePad);
  const y0 = Math.max(0, minY - safePad);
  const x1 = Math.min(safeW - 1, maxX + safePad);
  const y1 = Math.min(safeH - 1, maxY + safePad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  if (cw === safeW && ch === safeH) {
    const copy = new Uint8Array(safeW * safeH * 4);
    copy.set(rgba.subarray(0, copy.length));
    return { rgba: copy, width: safeW, height: safeH, cropped: false };
  }

  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcStart = ((y0 + y) * safeW + x0) * 4;
    out.set(rgba.subarray(srcStart, srcStart + cw * 4), y * cw * 4);
  }
  return { rgba: out, width: cw, height: ch, cropped: true };
}

/**
 * Estimates integer pixel upscale factor (1..16) by analyzing X/Y transition periodicity
 * across opaque pixels (distinguishing crisp k*k upscaled blocks from 1:1 native art or smooth blurs).
 */
export function detectPixelBlockSize(rgba: Uint8Array, w: number, h: number): number {
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  if (safeW < 16 || safeH < 16) return 1;

  const colGrad = new Float64Array(safeW);
  const rowGrad = new Float64Array(safeH);

  for (let y = 0; y < safeH; y++) {
    for (let x = 1; x < safeW; x++) {
      const a = (y * safeW + x - 1) * 4;
      const b = (y * safeW + x) * 4;
      const diff =
        (Math.abs(rgba[b] - rgba[a]) +
          Math.abs(rgba[b + 1] - rgba[a + 1]) +
          Math.abs(rgba[b + 2] - rgba[a + 2]) +
          Math.abs(rgba[b + 3] - rgba[a + 3])) /
        1020;
      colGrad[x] += diff;
    }
  }
  for (let y = 1; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const a = ((y - 1) * safeW + x) * 4;
      const b = (y * safeW + x) * 4;
      const diff =
        (Math.abs(rgba[b] - rgba[a]) +
          Math.abs(rgba[b + 1] - rgba[a + 1]) +
          Math.abs(rgba[b + 2] - rgba[a + 2]) +
          Math.abs(rgba[b + 3] - rgba[a + 3])) /
        1020;
      rowGrad[y] += diff;
    }
  }
  for (let x = 1; x < safeW; x++) colGrad[x] /= safeH;
  for (let y = 1; y < safeH; y++) rowGrad[y] /= safeW;

  const maxK = Math.min(16, Math.floor(Math.min(safeW, safeH) / 4));
  let bestK = 1;
  let bestScore = 0;

  for (let k = 2; k <= maxK; k++) {
    let bestAxisX = 0;
    for (let p = 0; p < k; p++) {
      let bSum = 0;
      let bCnt = 0;
      let iSum = 0;
      let iCnt = 0;
      for (let x = 1; x < safeW; x++) {
        if (x % k === p) {
          bSum += colGrad[x];
          bCnt++;
        } else {
          iSum += colGrad[x];
          iCnt++;
        }
      }
      const bMean = bCnt > 0 ? bSum / bCnt : 0;
      const iMean = iCnt > 0 ? iSum / iCnt : 0;
      const score = bMean > 0.005 ? bMean / (iMean + 0.002) : 0;
      if (score > bestAxisX) bestAxisX = score;
    }

    let bestAxisY = 0;
    for (let p = 0; p < k; p++) {
      let bSum = 0;
      let bCnt = 0;
      let iSum = 0;
      let iCnt = 0;
      for (let y = 1; y < safeH; y++) {
        if (y % k === p) {
          bSum += rowGrad[y];
          bCnt++;
        } else {
          iSum += rowGrad[y];
          iCnt++;
        }
      }
      const bMean = bCnt > 0 ? bSum / bCnt : 0;
      const iMean = iCnt > 0 ? iSum / iCnt : 0;
      const score = bMean > 0.005 ? bMean / (iMean + 0.002) : 0;
      if (score > bestAxisY) bestAxisY = score;
    }

    const combined = Math.min(bestAxisX, bestAxisY) * 0.65 + (bestAxisX + bestAxisY) * 0.175;
    if (combined > bestScore) {
      bestScore = combined;
      bestK = k;
    }
  }

  return bestScore >= 2.2 ? bestK : 1;
}

/**
 * Downscales or fits source RGBA into exact `dstW × dstH` pixel grid.
 * `'grid_majority'` trims outer 15% edge bleed in each cell >= 3px and picks the dominant quantized
 * color bucket with hard alpha cutout; `'lossless'` performs pure center nearest-neighbor sampling.
 */
export function downscaleToPixelGridRgba(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: PixelForgeDownscaleMode = 'grid_majority',
  preserveAspect = true,
): Uint8Array {
  const sw = Math.max(1, Math.floor(srcW));
  const sh = Math.max(1, Math.floor(srcH));
  const tw = clampDim(dstW);
  const th = clampDim(dstH);
  const out = new Uint8Array(tw * th * 4);

  let dw = tw;
  let dh = th;
  let dx = 0;
  let dy = 0;
  if (preserveAspect) {
    const scale = Math.min(tw / sw, th / sh);
    dw = Math.max(1, Math.round(sw * scale));
    dh = Math.max(1, Math.round(sh * scale));
    dx = Math.floor((tw - dw) * 0.5);
    dy = Math.floor((th - dh) * 0.5);
  }

  if (mode === 'lossless' || (sw <= dw && sh <= dh)) {
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
        const srcOff = (sy * sw + sx) * 4;
        const dstOff = ((dy + y) * tw + (dx + x)) * 4;
        const a = rgba[srcOff + 3] ?? 0;
        if (a < 128) continue;
        out[dstOff] = rgba[srcOff] ?? 0;
        out[dstOff + 1] = rgba[srcOff + 1] ?? 0;
        out[dstOff + 2] = rgba[srcOff + 2] ?? 0;
        out[dstOff + 3] = 255;
      }
    }
    return out;
  }

  const bucketCounts = new Int32Array(4096);
  const touchedBuckets: number[] = [];

  for (let y = 0; y < dh; y++) {
    const rawY0 = Math.floor((y * sh) / dh);
    const rawY1 = Math.max(rawY0 + 1, Math.floor(((y + 1) * sh) / dh));
    const spanY = rawY1 - rawY0;
    const insetY = spanY >= 3 ? Math.floor(spanY * 0.15) : 0;
    const y0 = rawY0 + insetY;
    const y1 = Math.max(y0 + 1, rawY1 - insetY);

    for (let x = 0; x < dw; x++) {
      const rawX0 = Math.floor((x * sw) / dw);
      const rawX1 = Math.max(rawX0 + 1, Math.floor(((x + 1) * sw) / dw));
      const spanX = rawX1 - rawX0;
      const insetX = spanX >= 3 ? Math.floor(spanX * 0.15) : 0;
      const x0 = rawX0 + insetX;
      const x1 = Math.max(x0 + 1, rawX1 - insetX);

      let total = 0;
      let opaque = 0;
      let bestBucket = -1;
      let bestCount = 0;
      touchedBuckets.length = 0;

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          total++;
          const off = (py * sw + px) * 4;
          if ((rgba[off + 3] ?? 0) < 96) continue;
          opaque++;
          const bKey = ((rgba[off] >> 4) << 8) | ((rgba[off + 1] >> 4) << 4) | (rgba[off + 2] >> 4);
          const nextCnt = bucketCounts[bKey] + 1;
          if (bucketCounts[bKey] === 0) touchedBuckets.push(bKey);
          bucketCounts[bKey] = nextCnt;
          if (nextCnt > bestCount) {
            bestCount = nextCnt;
            bestBucket = bKey;
          }
        }
      }

      if (bestBucket >= 0 && total > 0 && opaque / total >= 0.45) {
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let cnt = 0;
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const off = (py * sw + px) * 4;
            if ((rgba[off + 3] ?? 0) < 96) continue;
            const bKey = ((rgba[off] >> 4) << 8) | ((rgba[off + 1] >> 4) << 4) | (rgba[off + 2] >> 4);
            if (bKey === bestBucket) {
              sumR += rgba[off];
              sumG += rgba[off + 1];
              sumB += rgba[off + 2];
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          const dstOff = ((dy + y) * tw + (dx + x)) * 4;
          out[dstOff] = Math.round(sumR / cnt);
          out[dstOff + 1] = Math.round(sumG / cnt);
          out[dstOff + 2] = Math.round(sumB / cnt);
          out[dstOff + 3] = 255;
        }
      }

      for (let bi = 0; bi < touchedBuckets.length; bi++) {
        bucketCounts[touchedBuckets[bi]] = 0;
      }
    }
  }

  return out;
}

function buildAdaptiveKmeansPalette(rgba: Uint8Array, pixelCount: number, maxColors: number): Uint8Array {
  const kTarget = Math.max(2, Math.min(64, Math.round(maxColors)));
  const uniqueRgb: number[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < pixelCount; i++) {
    const off = i * 4;
    if ((rgba[off + 3] ?? 0) < 128) continue;
    const packed = (rgba[off] << 16) | (rgba[off + 1] << 8) | rgba[off + 2];
    if (!seen.has(packed)) {
      seen.add(packed);
      uniqueRgb.push(packed);
    }
  }

  if (uniqueRgb.length === 0) {
    return new Uint8Array([0, 0, 0]);
  }
  if (uniqueRgb.length <= kTarget) {
    const pal = new Uint8Array(uniqueRgb.length * 3);
    for (let i = 0; i < uniqueRgb.length; i++) {
      const c = uniqueRgb[i];
      pal[i * 3] = (c >>> 16) & 255;
      pal[i * 3 + 1] = (c >>> 8) & 255;
      pal[i * 3 + 2] = c & 255;
    }
    return pal;
  }

  // Deterministic K-Means++ seeding in Oklab space over unique opaque colors
  const uLab = new Float32Array(uniqueRgb.length * 3);
  const tmpLab = new Float32Array(3);
  for (let i = 0; i < uniqueRgb.length; i++) {
    const c = uniqueRgb[i];
    linearRgbToOklab(
      srgbToLinear(((c >>> 16) & 255) / 255),
      srgbToLinear(((c >>> 8) & 255) / 255),
      srgbToLinear((c & 255) / 255),
      tmpLab,
      0,
    );
    uLab[i * 3] = tmpLab[0];
    uLab[i * 3 + 1] = tmpLab[1];
    uLab[i * 3 + 2] = tmpLab[2];
  }

  const centroidsLab = new Float32Array(kTarget * 3);
  const centroidsRgb = new Uint8Array(kTarget * 3);
  const minDistSq = new Float32Array(uniqueRgb.length);
  minDistSq.fill(Number.POSITIVE_INFINITY);

  // Pick darkest-to-mid anchor deterministically (index 0)
  let seedIdx = 0;
  let minLum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < uniqueRgb.length; i++) {
    if (uLab[i * 3] < minLum) {
      minLum = uLab[i * 3];
      seedIdx = i;
    }
  }

  for (let k = 0; k < kTarget; k++) {
    const cOff = k * 3;
    const sOff = seedIdx * 3;
    centroidsLab[cOff] = uLab[sOff];
    centroidsLab[cOff + 1] = uLab[sOff + 1];
    centroidsLab[cOff + 2] = uLab[sOff + 2];
    const pk = uniqueRgb[seedIdx];
    centroidsRgb[cOff] = (pk >>> 16) & 255;
    centroidsRgb[cOff + 1] = (pk >>> 8) & 255;
    centroidsRgb[cOff + 2] = pk & 255;

    let farthestIdx = 0;
    let farthestDist = -1;
    for (let i = 0; i < uniqueRgb.length; i++) {
      const iOff = i * 3;
      const dL = uLab[iOff] - centroidsLab[cOff];
      const da = uLab[iOff + 1] - centroidsLab[cOff + 1];
      const db = uLab[iOff + 2] - centroidsLab[cOff + 2];
      const d2 = dL * dL + da * da + db * db;
      if (d2 < minDistSq[i]) minDistSq[i] = d2;
      if (minDistSq[i] > farthestDist) {
        farthestDist = minDistSq[i];
        farthestIdx = i;
      }
    }
    seedIdx = farthestIdx;
  }

  const sumR = new Float64Array(kTarget);
  const sumG = new Float64Array(kTarget);
  const sumB = new Float64Array(kTarget);
  const sumL = new Float64Array(kTarget);
  const sumA = new Float64Array(kTarget);
  const sumBb = new Float64Array(kTarget);
  const counts = new Int32Array(kTarget);

  for (let iter = 0; iter < 8; iter++) {
    sumR.fill(0);
    sumG.fill(0);
    sumB.fill(0);
    sumL.fill(0);
    sumA.fill(0);
    sumBb.fill(0);
    counts.fill(0);

    for (let i = 0; i < uniqueRgb.length; i++) {
      const iOff = i * 3;
      const pL = uLab[iOff];
      const pa = uLab[iOff + 1];
      const pb = uLab[iOff + 2];
      let bestK = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let k = 0; k < kTarget; k++) {
        const cOff = k * 3;
        const dL = pL - centroidsLab[cOff];
        const da = pa - centroidsLab[cOff + 1];
        const db = pb - centroidsLab[cOff + 2];
        const d2 = dL * dL + da * da + db * db;
        if (d2 < bestD) {
          bestD = d2;
          bestK = k;
        }
      }
      const pk = uniqueRgb[i];
      sumR[bestK] += (pk >>> 16) & 255;
      sumG[bestK] += (pk >>> 8) & 255;
      sumB[bestK] += pk & 255;
      sumL[bestK] += pL;
      sumA[bestK] += pa;
      sumBb[bestK] += pb;
      counts[bestK]++;
    }

    for (let k = 0; k < kTarget; k++) {
      if (counts[k] === 0) continue;
      const cOff = k * 3;
      const inv = 1 / counts[k];
      centroidsLab[cOff] = sumL[k] * inv;
      centroidsLab[cOff + 1] = sumA[k] * inv;
      centroidsLab[cOff + 2] = sumBb[k] * inv;
      centroidsRgb[cOff] = Math.round(sumR[k] * inv);
      centroidsRgb[cOff + 1] = Math.round(sumG[k] * inv);
      centroidsRgb[cOff + 2] = Math.round(sumB[k] * inv);
    }
  }

  return centroidsRgb;
}

/**
 * Quantizes an RGBA buffer in perceptual Oklab color space using `'true_color'`,
 * `'adaptive_kmeans'`, or `'palette_lock'` (curated cross-genre palettes) with optional Bayer 4x4 dithering.
 */
export function quantizeRgbaOklab(
  rgba: Uint8Array,
  w: number,
  h: number,
  opts: {
    colorMode: PixelForgeColorMode;
    maxColors?: number;
    paletteId?: PixelForgePaletteId;
    customPalette?: readonly string[];
    dither?: boolean;
  },
): Uint8Array {
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  const pixelCount = safeW * safeH;
  const out = new Uint8Array(pixelCount * 4);

  if (opts.colorMode === 'true_color') {
    for (let i = 0; i < pixelCount; i++) {
      const off = i * 4;
      if ((rgba[off + 3] ?? 0) < 128) continue;
      out[off] = rgba[off];
      out[off + 1] = rgba[off + 1];
      out[off + 2] = rgba[off + 2];
      out[off + 3] = 255;
    }
    return out;
  }

  let palRgb: Uint8Array;
  if (opts.colorMode === 'adaptive_kmeans') {
    palRgb = buildAdaptiveKmeansPalette(rgba, pixelCount, opts.maxColors ?? 32);
  } else {
    const palDef = PIXEL_FORGE_PALETTES.find((p) => p.id === opts.paletteId) ?? PIXEL_FORGE_PALETTES[0];
    const hexList = opts.customPalette && opts.customPalette.length > 0 ? opts.customPalette : palDef.colors;
    palRgb = new Uint8Array(hexList.length * 3);
    const tmpRgb = new Float32Array(3);
    for (let i = 0; i < hexList.length; i++) {
      hexToRgb01Into(hexList[i], tmpRgb, 0);
      palRgb[i * 3] = Math.round(tmpRgb[0] * 255);
      palRgb[i * 3 + 1] = Math.round(tmpRgb[1] * 255);
      palRgb[i * 3 + 2] = Math.round(tmpRgb[2] * 255);
    }
  }

  const palCount = Math.max(1, Math.floor(palRgb.length / 3));
  const palLab = new Float32Array(palCount * 3);
  for (let k = 0; k < palCount; k++) {
    const o = k * 3;
    linearRgbToOklab(
      srgbToLinear(palRgb[o] / 255),
      srgbToLinear(palRgb[o + 1] / 255),
      srgbToLinear(palRgb[o + 2] / 255),
      palLab,
      o,
    );
  }

  const okTmp = new Float32Array(3);
  const useDither = opts.dither === true;
  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const i = y * safeW + x;
      const off = i * 4;
      if ((rgba[off + 3] ?? 0) < 128) continue;

      linearRgbToOklab(
        srgbToLinear(rgba[off] / 255),
        srgbToLinear(rgba[off + 1] / 255),
        srgbToLinear(rgba[off + 2] / 255),
        okTmp,
        0,
      );
      const lBias = useDither ? ((BAYER4[(y & 3) * 4 + (x & 3)] / 15) - 0.5) * 0.08 : 0;
      const qL = okTmp[0] + lBias;
      const qa = okTmp[1];
      const qb = okTmp[2];

      let bestK = 0;
      let bestD2 = Number.POSITIVE_INFINITY;
      for (let k = 0; k < palCount; k++) {
        const o = k * 3;
        const dL = (qL - palLab[o]) * 1.25;
        const da = qa - palLab[o + 1];
        const db = qb - palLab[o + 2];
        const d2 = dL * dL + da * da + db * db;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestK = k;
        }
      }

      const po = bestK * 3;
      out[off] = palRgb[po];
      out[off + 1] = palRgb[po + 1];
      out[off + 2] = palRgb[po + 2];
      out[off + 3] = 255;
    }
  }

  return out;
}

/**
 * Adds a crisp 1px 4-neighbor ink outline around opaque silhouettes (`alpha >= 128`).
 */
export function applyRgbaOutline(
  rgba: Uint8Array,
  w: number,
  h: number,
  outlineHex = '#090b12',
): Uint8Array {
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  const out = new Uint8Array(safeW * safeH * 4);
  out.set(rgba.subarray(0, out.length));

  const rgbTmp = new Float32Array(3);
  hexToRgb01Into(outlineHex, rgbTmp, 0);
  const or = Math.round(rgbTmp[0] * 255);
  const og = Math.round(rgbTmp[1] * 255);
  const ob = Math.round(rgbTmp[2] * 255);

  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const i = y * safeW + x;
      const off = i * 4;
      if ((rgba[off + 3] ?? 0) >= 128) continue;
      const up = y > 0 && (rgba[((y - 1) * safeW + x) * 4 + 3] ?? 0) >= 128;
      const dn = y < safeH - 1 && (rgba[((y + 1) * safeW + x) * 4 + 3] ?? 0) >= 128;
      const lf = x > 0 && (rgba[(y * safeW + x - 1) * 4 + 3] ?? 0) >= 128;
      const rt = x < safeW - 1 && (rgba[(y * safeW + x + 1) * 4 + 3] ?? 0) >= 128;
      if (up || dn || lf || rt) {
        out[off] = or;
        out[off + 1] = og;
        out[off + 2] = ob;
        out[off + 3] = 255;
      }
    }
  }
  return out;
}

function sliceSubRgba(
  rgba: Uint8Array,
  srcW: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Uint8Array {
  const out = new Uint8Array(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const start = ((sy + y) * srcW + sx) * 4;
    out.set(rgba.subarray(start, start + sw * 4), y * sw * 4);
  }
  return out;
}

function rgbToHex2(r: number, g: number, b: number): string {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));
  return `#${((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1)}`;
}

/**
 * Analyzes an RGBA sprite for glowing/bright pixels (lantern flames, crystals, runes)
 * and synthesizes a matching dynamic point light & emissive bloom profile.
 */
export function detectEmissiveLightFromRgba(
  rgba: Uint8Array,
  w: number,
  h: number,
): PixelForgeDetectedLight {
  const total = Math.max(1, Math.floor(w) * Math.floor(h));
  let opaqueCount = 0;
  let brightCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumW = 0;

  for (let i = 0; i < total; i++) {
    const off = i * 4;
    if ((rgba[off + 3] ?? 0) < 128) continue;
    opaqueCount++;
    const r = rgba[off];
    const g = rgba[off + 1];
    const b = rgba[off + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    if (luma >= 0.64 || (luma >= 0.48 && sat >= 0.52)) {
      brightCount++;
      // Weight colorful bright pixels slightly stronger than pure white highlights
      const weight = 0.6 + sat * 1.4;
      sumR += r * weight;
      sumG += g * weight;
      sumB += b * weight;
      sumW += weight;
    }
  }

  const brightRatio = opaqueCount > 0 ? brightCount / opaqueCount : 0;
  const color = sumW > 0 ? rgbToHex2(sumR / sumW, sumG / sumW, sumB / sumW) : '#f59e0b';
  const clampedRatio = Math.max(0, Math.min(1, brightRatio));
  const radius = Math.round(88 + clampedRatio * 68);
  const intensity = Number((0.68 + Math.min(0.45, clampedRatio * 1.1)).toFixed(2));
  const emissive = Number((0.55 + Math.min(0.75, clampedRatio * 1.6)).toFixed(2));

  return { color, radius, intensity, emissive, brightRatio: Number(brightRatio.toFixed(3)) };
}

/**
 * Derives a subtle beveled top-cap tile from a vertical wall facade texture when
 * baking a single image under `'wall_top_side'` mode.
 */
export function synthesizeWallTopCapRgba(sideRgba: Uint8Array, w: number, h: number): Uint8Array {
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  const out = new Uint8Array(safeW * safeH * 4);
  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const off = (y * safeW + x) * 4;
      const a = sideRgba[off + 3] ?? 0;
      if (a < 128) {
        out[off] = 24;
        out[off + 1] = 26;
        out[off + 2] = 38;
        out[off + 3] = 255;
        continue;
      }
      const isEdge = x === 0 || y === 0 || x === safeW - 1 || y === safeH - 1;
      const isInnerRim = !isEdge && (x === 1 || y === 1 || x === safeW - 2 || y === safeH - 2);
      const scale = isEdge ? 0.54 : isInnerRim ? 0.92 : 0.72;
      out[off] = Math.min(255, Math.round(sideRgba[off] * scale));
      out[off + 1] = Math.min(255, Math.round(sideRgba[off + 1] * scale));
      out[off + 2] = Math.min(255, Math.round(sideRgba[off + 2] * scale));
      out[off + 3] = 255;
    }
  }
  return out;
}

/**
 * Full DOM-free Pixel Forge pipeline: converts any external/AI RGBA buffer into crisp `8..256`
 * lossless zlib `EcsCustomSpriteDef` assets (single sprites, portraits, wall top/side pairs, or sliced animated sheets).
 */
export function forgeImageToCustomSprites(
  input: { id: string; name?: string; rgba: Uint8Array; width: number; height: number },
  opts: PixelForgeOptions,
): PixelForgeOutput {
  const baseId = sanitizeInteropId(opts.id || input.id, 'forged_sprite', 48);
  const displayName = (opts.name || input.name || baseId).trim();
  const targetW = clampDim(opts.targetWidth);
  const targetH = clampDim(opts.targetHeight);
  const downMode = opts.downscaleMode ?? 'grid_majority';
  const colorMode = opts.colorMode ?? 'adaptive_kmeans';
  const preserveAspect = opts.preserveAspect !== false;
  const cols = Math.max(1, Math.min(16, Math.round(opts.sheetCols ?? 1)));
  const rows = Math.max(1, Math.min(16, Math.round(opts.sheetRows ?? 1)));

  let workRgba: Uint8Array = new Uint8Array(Math.max(1, input.width) * Math.max(1, input.height) * 4);
  workRgba.set(input.rgba.subarray(0, workRgba.length));
  let workW = Math.max(1, Math.floor(input.width));
  let workH = Math.max(1, Math.floor(input.height));

  if (opts.stripBackground !== false) {
    workRgba = stripEdgeBackgroundRgba(workRgba, workW, workH, opts.bgTolerance ?? 48);
  }

  const isSheet = cols > 1 || rows > 1;
  if (!isSheet && opts.cropOpaque !== false) {
    const cropped = cropOpaqueBoundsRgba(workRgba, workW, workH, 0);
    workRgba = cropped.rgba;
    workW = cropped.width;
    workH = cropped.height;
  }

  const detectedBlockSize = detectPixelBlockSize(workRgba, workW, workH);
  const sprites: EcsCustomSpriteDef[] = [];
  const previewFrames: PixelForgePreviewFrame[] = [];

  const pushEncoded = (frameId: string, frameName: string, forged: Uint8Array): void => {
    sprites.push({
      id: frameId,
      name: frameName,
      width: targetW,
      height: targetH,
      kind: 'rgba_b64',
      rgbaB64: encodeRgbaToZlibB64(forged),
    });
    previewFrames.push({ id: frameId, width: targetW, height: targetH, rgba: forged });
  };

  const processCell = (cellRgba: Uint8Array, cw: number, ch: number, frameId: string, frameName: string): Uint8Array => {
    let forged = downscaleToPixelGridRgba(cellRgba, cw, ch, targetW, targetH, downMode, preserveAspect);
    forged = quantizeRgbaOklab(forged, targetW, targetH, {
      colorMode,
      maxColors: opts.maxColors,
      paletteId: opts.paletteId,
      customPalette: opts.customPalette,
      dither: opts.dither,
    });
    if (opts.outlineHex) {
      forged = applyRgbaOutline(forged, targetW, targetH, opts.outlineHex);
    }
    pushEncoded(frameId, frameName, forged);
    return forged;
  };

  if (!isSheet) {
    if (opts.bakingProfile === 'wall_top_side') {
      const sideRgba = downscaleToPixelGridRgba(workRgba, workW, workH, targetW, targetH, downMode, preserveAspect);
      const qSide = quantizeRgbaOklab(sideRgba, targetW, targetH, {
        colorMode,
        maxColors: opts.maxColors,
        paletteId: opts.paletteId,
        customPalette: opts.customPalette,
        dither: opts.dither,
      });
      const topRgba = synthesizeWallTopCapRgba(qSide, targetW, targetH);
      const topId = sanitizeInteropId(`${baseId}_top`, 'wall_top', 48);
      const sideId = sanitizeInteropId(`${baseId}_side`, 'wall_side', 48);
      pushEncoded(topId, `${displayName} (牆頂)`, topRgba);
      pushEncoded(sideId, `${displayName} (牆側)`, qSide);
      return {
        sprites,
        animations: [],
        detectedBlockSize,
        previewFrames,
        bakingProfile: opts.bakingProfile,
        wallSideSpriteId: sideId,
      };
    }

    const forged = processCell(workRgba, workW, workH, baseId, displayName);
    const detectedLight = detectEmissiveLightFromRgba(forged, targetW, targetH);
    return {
      sprites,
      animations: [],
      detectedBlockSize,
      previewFrames,
      bakingProfile: opts.bakingProfile,
      detectedLight,
    };
  }

  const cellW = Math.max(1, Math.floor(workW / cols));
  const cellH = Math.max(1, Math.floor(workH / rows));
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = sliceSubRgba(workRgba, workW, c * cellW, r * cellH, cellW, cellH);
      processCell(cell, cellW, cellH, `${baseId}_f${idx}`, `${displayName} #${idx + 1}`);
      idx++;
    }
  }

  if (opts.bakingProfile === 'wall_top_side' && sprites.length >= 2) {
    return {
      sprites,
      animations: [],
      detectedBlockSize,
      previewFrames,
      bakingProfile: opts.bakingProfile,
      wallSideSpriteId: sprites[1].id,
    };
  }

  const animations: AnimationStateMachineDef[] = [];
  if (sprites.length >= 2) {
    const frameIds = sprites.map((s) => s.id);
    animations.push({
      id: sanitizeInteropId(`anim_${baseId}`, 'anim_forged', 56),
      initialState: 'idle',
      clips: [
        { name: 'idle', frames: frameIds.slice(0, Math.min(2, frameIds.length)), fps: 4, loop: true },
        { name: 'walk', frames: frameIds, fps: 8, loop: true },
      ],
      transitions: [
        { from: 'idle', to: 'walk', param: 'speed', op: 'gt', value: 10, priority: 1 },
        { from: 'walk', to: 'idle', param: 'speed', op: 'lte', value: 10, priority: 1 },
      ],
    });
  }

  const detectedLight = previewFrames[0]
    ? detectEmissiveLightFromRgba(previewFrames[0].rgba, previewFrames[0].width, previewFrames[0].height)
    : undefined;

  return {
    sprites,
    animations,
    detectedBlockSize,
    previewFrames,
    bakingProfile: opts.bakingProfile,
    detectedLight,
  };
}

/**
 * Converts a `PixelForgeOutput` into an atomic array of transactional `EcsStudioCommand`s
 * (registering sprites, optional AnimationStateMachine, optional Prefab stamp w/ LightSource, and optional TileDef w/ sideSprite).
 */
export function buildPixelForgeCommitCommands(
  output: PixelForgeOutput,
  project: EcsProjectV2,
  opts: PixelForgeCommitOptions = {},
): EcsStudioCommand[] {
  const cmds: EcsStudioCommand[] = [];
  for (const sprite of output.sprites) {
    cmds.push({ type: 'upsert_custom_sprite', sprite });
  }
  for (const animation of output.animations) {
    cmds.push({ type: 'upsert_animation', animation });
  }

  const primary = output.sprites[0];
  if (!primary) return cmds;

  const useLight = Boolean(opts.attachLight || output.bakingProfile === 'emissive_light_prop');
  const lightSpec = output.detectedLight;

  if (opts.registerPrefab) {
    const prefabId = sanitizeInteropId(`prefab_${primary.id}`, 'prefab_forged', 48);
    if (project.prefabs[prefabId]) {
      cmds.push({ type: 'delete_prefab', prefabId, mode: 'unlink' });
    }
    const anim = output.animations[0];
    const emissiveVal = opts.emissive ?? (useLight && lightSpec ? lightSpec.emissive : 0);
    cmds.push({
      type: 'create_prefab',
      prefab: {
        id: prefabId,
        name: primary.name ?? primary.id,
        category: opts.prefabCategory ?? (output.bakingProfile === 'billboard_actor' ? 'actor' : 'forged'),
        components: {
          tag: opts.prefabTag ?? (output.bakingProfile === 'billboard_actor' ? 'npc' : 'prop'),
          transform: {
            x: 0,
            y: 0,
            w: Math.max(16, Math.min(96, primary.width)),
            h: Math.max(16, Math.min(128, primary.height)),
          },
          sprite: {
            sprite: primary.id,
            tint: '#ffffff',
            castShadow: true,
            roughness: opts.roughness ?? 0.52,
            metallic: opts.metallic ?? 0.14,
            ...(emissiveVal > 0 ? { emissive: emissiveVal } : {}),
          },
          ...(useLight
            ? {
                light: {
                  radius: lightSpec?.radius ?? 108,
                  color: lightSpec?.color ?? '#f59e0b',
                  intensity: lightSpec?.intensity ?? 0.85,
                  falloffPower: 1.85,
                },
              }
            : {}),
          ...(opts.prefabSolid ? { collider: { radius: 12, isSolid: true } } : {}),
          ...(anim ? { animatorId: anim.id } : {}),
        },
      },
    });
  }

  if (opts.registerTileLayer) {
    if (!project.worldMap) {
      cmds.push({ type: 'ensure_world_map', cols: 22, rows: 14, roomName: '主場景' });
    }
    const tileId = pickNextCustomTileId(project);
    const layer = opts.registerTileLayer;
    const sideSprite = opts.sideSprite ?? output.wallSideSpriteId;
    cmds.push({
      type: 'upsert_tile_def',
      tileDef: {
        id: tileId,
        name: primary.name ?? primary.id,
        layer,
        sprite: primary.id,
        ...(layer === 'wall' && sideSprite ? { sideSprite } : {}),
        solid: opts.tileSolid ?? layer === 'wall',
        ...(layer === 'wall' ? { extrudeH: opts.tileExtrudeH ?? 28, wallMaterial: 'stone' as const } : {}),
        ...(layer === 'decor' && primary.height > primary.width ? { renderH: primary.height } : {}),
        roughness: opts.roughness ?? 0.62,
        metallic: opts.metallic ?? 0.12,
        ...(opts.emissive && opts.emissive > 0 ? { emissive: opts.emissive } : {}),
      },
    });
  }

  return cmds;
}
