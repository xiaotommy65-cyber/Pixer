import { hexToRgb01Into, mixOklabRgb01, rgb01ToHex } from '../core/math/ColorMath.ts';

/**
 * Phase A Engine-First Art Registry for PA-13 «星脈共鳴 Pulse Resonance».
 * Zero photorealistic AI JPEG wallpapers — renders crisp 64×64 Oklab + Bayer 4×4
 * procedural pixel-craft album jackets using Pixer's own ColorMath primitives
 * while Phase B migrates the full 3D concert stage onto `GpuEngine` (WebGPU/WebGL2 PBR).
 */

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
] as const;

const MIX_A = new Float32Array(3);
const MIX_B = new Float32Array(3);
const MIX_OUT = new Float32Array(3);

function mixOklabHex(hexA: string, hexB: string, t: number): string {
  hexToRgb01Into(hexA, MIX_A, 0);
  hexToRgb01Into(hexB, MIX_B, 0);
  mixOklabRgb01(MIX_A[0], MIX_A[1], MIX_A[2], MIX_B[0], MIX_B[1], MIX_B[2], t, MIX_OUT, 0);
  return rgb01ToHex(MIX_OUT[0], MIX_OUT[1], MIX_OUT[2]);
}

interface PixelJacketSpec {
  primary: string;
  secondary: string;
  bgDark: string;
  emblem: 'star' | 'corridor' | 'blade' | 'eclipse';
}

const PIXEL_JACKET_SPECS: Record<string, PixelJacketSpec> = {
  'starlight-overture': {
    primary: '#38bdf8',
    secondary: '#f59e0b',
    bgDark: '#071124',
    emblem: 'star',
  },
  'neon-corridor': {
    primary: '#22d3ee',
    secondary: '#fb923c',
    bgDark: '#0b1026',
    emblem: 'corridor',
  },
  'frostblade-sprint': {
    primary: '#60a5fa',
    secondary: '#facc15',
    bgDark: '#081529',
    emblem: 'blade',
  },
  'singularity-pulse': {
    primary: '#fb7185',
    secondary: '#f59e0b',
    bgDark: '#160917',
    emblem: 'eclipse',
  },
};

const jacketUrlCache = new Map<string, string>();
const imageCache = new Map<string, HTMLImageElement>();

function synthesizePixelJacketDataUrl(songId: string): string | null {
  if (typeof document === 'undefined') return null;
  const spec = PIXEL_JACKET_SPECS[songId];
  if (!spec) return null;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  const midTone = mixOklabHex(spec.bgDark, spec.primary, 0.34);
  const brightTone = mixOklabHex(spec.primary, '#ffffff', 0.28);
  const warmTone = mixOklabHex(spec.secondary, '#ffffff', 0.18);

  // Bayer 4×4 ordered-dither Oklab gradient backdrop
  for (let y = 0; y < size; y++) {
    const ty = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const tx = (x - size * 0.5) / (size * 0.5);
      const radial = Math.max(0, 1 - Math.hypot(tx, (y - size * 0.44) / (size * 0.52)));
      const bayer = (BAYER_4X4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const v = radial * 0.65 + (1 - ty) * 0.35;
      ctx.fillStyle = v > bayer * 0.95 ? midTone : spec.bgDark;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Pixel horizon grid floor
  ctx.fillStyle = spec.bgDark;
  ctx.fillRect(0, 44, size, 20);
  ctx.fillStyle = spec.primary;
  for (let gx = 4; gx < size; gx += 8) {
    ctx.fillRect(gx, 44, 1, 20);
  }
  for (let gy = 45; gy < size; gy += 4) {
    ctx.fillRect(0, gy, size, 1);
  }

  // Crisp pixel emblem centerpiece
  const cx = 32;
  const cy = 26;
  if (spec.emblem === 'star') {
    ctx.fillStyle = spec.secondary;
    ctx.fillRect(cx - 1, cy - 14, 2, 28);
    ctx.fillRect(cx - 14, cy - 1, 28, 2);
    ctx.fillStyle = brightTone;
    for (let d = -8; d <= 8; d++) {
      ctx.fillRect(cx + d, cy + d, 1, 1);
      ctx.fillRect(cx + d, cy - d, 1, 1);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
  } else if (spec.emblem === 'corridor') {
    for (let r = 18; r >= 4; r -= 4) {
      ctx.fillStyle = r % 8 === 2 ? spec.secondary : brightTone;
      ctx.fillRect(cx - r, cy - r + 4, r * 2, 1);
      ctx.fillRect(cx - r, cy + r - 4, r * 2, 1);
      ctx.fillRect(cx - r, cy - r + 4, 1, r * 2 - 8);
      ctx.fillRect(cx + r - 1, cy - r + 4, 1, r * 2 - 8);
    }
    ctx.fillStyle = warmTone;
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  } else if (spec.emblem === 'blade') {
    ctx.fillStyle = brightTone;
    for (let i = -14; i <= 14; i++) {
      const w = Math.max(1, 5 - Math.floor(Math.abs(i) / 3));
      ctx.fillRect(cx + i - Math.floor(w / 2), cy - i, w, 2);
    }
    ctx.fillStyle = warmTone;
    ctx.fillRect(cx - 10, cy + 8, 20, 2);
  } else {
    // Eclipse ring
    for (let y = -14; y <= 14; y++) {
      for (let x = -14; x <= 14; x++) {
        const d = Math.hypot(x, y);
        if (d >= 9.5 && d <= 13.2) {
          ctx.fillStyle = y < 0 ? warmTone : spec.primary;
          ctx.fillRect(cx + x, cy + y, 1, 1);
        } else if (d < 9.5) {
          ctx.fillStyle = spec.bgDark;
          ctx.fillRect(cx + x, cy + y, 1, 1);
        }
      }
    }
  }

  // Pixel atelier inner brass frame border
  ctx.fillStyle = spec.secondary;
  ctx.fillRect(2, 2, size - 4, 1);
  ctx.fillRect(2, size - 3, size - 4, 1);
  ctx.fillRect(2, 2, 1, size - 4);
  ctx.fillRect(size - 3, 2, 1, size - 4);

  return canvas.toDataURL('image/png');
}

export function getStageDomeUrl(): string | null {
  return null;
}

export function getStageDomeImage(): HTMLImageElement | null {
  return null;
}

export function getSongJacketUrl(songId: string): string | null {
  const cached = jacketUrlCache.get(songId);
  if (cached) return cached;
  const generated = synthesizePixelJacketDataUrl(songId);
  if (generated) jacketUrlCache.set(songId, generated);
  return generated;
}

export function loadCachedArtImage(url: string): HTMLImageElement {
  const existing = imageCache.get(url);
  if (existing) return existing;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  imageCache.set(url, img);
  return img;
}

export function getSongJacketImage(songId: string): HTMLImageElement | null {
  const url = getSongJacketUrl(songId);
  return url ? loadCachedArtImage(url) : null;
}

/**
 * Guaranteed non-empty CSS gradient fallback for custom imported songs or while loading.
 */
export function buildJacketFallbackGradient(primary: string, secondary: string): string {
  return `radial-gradient(circle at 28% 24%, ${primary} 0%, #0f172a 58%, #040814 100%), linear-gradient(135deg, ${primary}44 0%, ${secondary}33 100%)`;
}
