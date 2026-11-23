import type { PaletteThemeSpec } from '../assets/sprites/PaletteData.ts';
import { TILE_PX } from '../assets/TextureAtlas.ts';
import { linearRgbToOklab, srgbToLinear } from '../core/math/ColorMath.ts';

const HEX_DIGITS = '.123456789abcdef';

export type GridPresetKey = '16x16' | '32x32' | '48x64';

export interface StampDef {
  id: string;
  label: string;
  grid: readonly string[];
}

export const GRID_PRESETS: readonly { key: GridPresetKey; w: number; h: number; label: string }[] = [
  { key: '16x16', w: 16, h: 16, label: '16×16' },
  { key: '32x32', w: 32, h: 32, label: '32×32' },
  { key: '48x64', w: 48, h: 64, label: '48×64' },
];

export const PIXEL_STAMPS: readonly StampDef[] = [
  { id: 'eye', label: '👁 眼睛', grid: ['.11.', '1211', '.11.'] },
  { id: 'crown', label: '👑 皇冠', grid: ['8.8.8', '88888', '94849'] },
  { id: 'flame', label: '🔥 火焰', grid: ['..e..', '.e8e.', 'e898e', '.949.'] },
  { id: 'wing', label: '🪽 翅膀', grid: ['22...', '232..', '.232.', '..22.'] },
  { id: 'sword', label: '⚔ 劍', grid: ['..2.', '.2e.', '81..', '18..'] },
  { id: 'gem', label: '💎 寶石', grid: ['.ee.', 'e2fe', 'efae', '.ee.'] },
];

export const BUNNY_PRESET_A: string[] = [
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

export const BUNNY_PRESET_B: string[] = [
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

export const BEAR_PRESET_A: string[] = [
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

export const BEAR_PRESET_B: string[] = [
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

export function hexToRgb(hex: string): [number, number, number] {
  if (!hex || hex === 'transparent' || !hex.startsWith('#')) return [0, 0, 0];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function resampleBuffer(
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

export function floodFillBuffer(
  buf: Uint8Array,
  gw: number,
  gh: number,
  sx: number,
  sy: number,
  targetColor: number,
): void {
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

/** Applies 4-neighbor ink outlining + top-left bevel highlight promotion in-place. Returns true if pixels changed. */
export function applyOutlineAndBevelBuffer(buf: Uint8Array, gw: number, gh: number): boolean {
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
  return changed;
}

/** Loads an uploaded image File into an ImageBitmap or HTMLImageElement with safe cleanup. */
export async function loadImageFileSource(
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

/**
 * Strips uniform opaque edge background, tight-crops opaque silhouette, and quantizes
 * into the active 16-color palette using perceptual Oklab distance.
 */
export function quantizeImageToPaletteBuffer(
  loaded: { img: CanvasImageSource; w: number; h: number },
  gw: number,
  gh: number,
  theme: PaletteThemeSpec,
  targetBuf: Uint8Array,
  oklabPaletteScratch: Float32Array,
  okTmp: Float32Array,
): 'ok' | 'transparent' | 'no_ctx' {
  const maxDim = 256;
  const scale = Math.min(1, maxDim / Math.max(1, Math.max(loaded.w, loaded.h)));
  const sw = Math.max(1, Math.round(loaded.w * scale));
  const sh = Math.max(1, Math.round(loaded.h * scale));
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) return 'no_ctx';
  srcCtx.imageSmoothingEnabled = true;
  srcCtx.drawImage(loaded.img, 0, 0, sw, sh);

  const srcImg = srcCtx.getImageData(0, 0, sw, sh);
  const px = srcImg.data;

  // Auto-remove uniform opaque edge background via corner flood-fill when all 4 corners match
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
      for (let x = 0; x < sw; x++) stack.push(x, (sh - 1) * sw + x);
      for (let y = 1; y < sh - 1; y++) stack.push(y * sw, y * sw + sw - 1);
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
  if (maxX < minX || maxY < minY) return 'transparent';

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = gw;
  dstCanvas.height = gh;
  const dstCtx = dstCanvas.getContext('2d');
  if (!dstCtx) return 'no_ctx';

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

  for (let idx = 1; idx < 16; idx++) {
    const [pr, pg, pb] = hexToRgb(theme.colors[idx] ?? '#ffffff');
    linearRgbToOklab(srgbToLinear(pr / 255), srgbToLinear(pg / 255), srgbToLinear(pb / 255), oklabPaletteScratch, idx * 3);
  }

  for (let i = 0; i < gw * gh; i++) {
    const off = i * 4;
    if (qData[off + 3] < 96) {
      targetBuf[i] = 0;
      continue;
    }
    linearRgbToOklab(srgbToLinear(qData[off] / 255), srgbToLinear(qData[off + 1] / 255), srgbToLinear(qData[off + 2] / 255), okTmp, 0);
    let bestIdx = 1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let idx = 1; idx < 16; idx++) {
      const pOff = idx * 3;
      const dL = (okTmp[0] - oklabPaletteScratch[pOff]) * 1.25;
      const da = okTmp[1] - oklabPaletteScratch[pOff + 1];
      const db = okTmp[2] - oklabPaletteScratch[pOff + 2];
      const d2 = dL * dL + da * da + db * db;
      if (d2 < bestDist) {
        bestDist = d2;
        bestIdx = idx;
      }
    }
    targetBuf[i] = bestIdx;
  }
  return 'ok';
}

/** Zero-GC real-time HD-2D Auto-Sobel point-light preview rasterizer. */
export function renderNormalLitPreview(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  previewPx: number,
  buf: Uint8Array,
  gw: number,
  gh: number,
  theme: PaletteThemeSpec,
  lightNormX: number,
  lightNormY: number,
  texelHeightScratch: Float32Array,
  texelRgbScratch: Uint8Array,
): void {
  for (let i = 0; i < gw * gh; i++) {
    const idx = buf[i] ?? 0;
    const p = i * 4;
    if (idx === 0) {
      texelHeightScratch[i] = 0;
      texelRgbScratch[p] = 0;
      texelRgbScratch[p + 1] = 0;
      texelRgbScratch[p + 2] = 0;
      texelRgbScratch[p + 3] = 0;
    } else {
      const [r, g, b] = hexToRgb(theme.colors[idx] ?? '#ffffff');
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      texelHeightScratch[i] = 0.65 + 0.35 * luma;
      texelRgbScratch[p] = r;
      texelRgbScratch[p + 1] = g;
      texelRgbScratch[p + 2] = b;
      texelRgbScratch[p + 3] =
        (idx === 14 && theme.emissive14 > 0) || (idx === 15 && theme.emissive15 > 0) ? 255 : 1;
    }
  }

  const lightPx = (lightNormX * 0.5 + 0.5) * previewPx;
  const lightPy = (lightNormY * 0.5 + 0.5) * previewPx;
  const lightZ = 34;
  const maxBox = 72;
  const fit = Math.min(maxBox / gw, maxBox / gh);
  const drawW = Math.max(1, Math.round(gw * fit));
  const drawH = Math.max(1, Math.round(gh * fit));
  const marginX = (previewPx - drawW) * 0.5;
  const marginY = (previewPx - drawH) * 0.5;
  const texScaleX = gw / drawW;
  const texScaleY = gh / drawH;
  const out = img.data;

  for (let py = 0; py < previewPx; py++) {
    for (let px = 0; px < previewPx; px++) {
      const dst = (py * previewPx + px) * 4;
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
        if (texelRgbScratch[tOff + 3] > 0) {
          const hL = tx > 0 ? texelHeightScratch[tIdx - 1] : 0;
          const hR = tx < gw - 1 ? texelHeightScratch[tIdx + 1] : 0;
          const hU = ty > 0 ? texelHeightScratch[tIdx - gw] : 0;
          const hD = ty < gh - 1 ? texelHeightScratch[tIdx + gw] : 0;
          const nx = -(hR - hL) * 1.4;
          const ny = -(hD - hU) * 1.4;
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

          const hC = texelHeightScratch[tIdx];
          const hBR = tx < gw - 1 && ty < gh - 1 ? texelHeightScratch[tIdx + gw + 1] : 0;
          const rim = hC - hBR > 0.45 ? 0.14 * atten : 0;
          const glow = texelRgbScratch[tOff + 3] === 255 ? 0.22 : 0;
          const mul = diffuse + glow;

          bgR = texelRgbScratch[tOff] * mul + (spec + rim) * 255;
          bgG = texelRgbScratch[tOff + 1] * mul + (spec + rim) * 245;
          bgB = texelRgbScratch[tOff + 2] * mul + (spec + rim) * 235;
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
