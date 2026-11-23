import { Unzlib, zlibSync } from 'fflate';
import { PALETTE_THEMES } from '../../assets/sprites/PaletteData.ts';
import type { TextureAtlas } from '../../assets/TextureAtlas.ts';
import {
  buildHueShiftedRamp,
  hexToRgb01Into,
  mixOklabRgb01,
  rgb01ToHex,
} from '../math/ColorMath.ts';
import type {
  EcsCustomSpriteDef,
  EcsProceduralSpriteRecipe,
  EcsProjectV2,
} from './EcsProjectSchema.ts';

export interface CompiledCustomSpriteRgba {
  id: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

const BAYER4 = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

function hash2d(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed | 0, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

function parseHexRgba(hex: string | undefined): [number, number, number, number] {
  if (!hex || hex === 'transparent' || !hex.startsWith('#')) return [0, 0, 0, 0];
  const clean = hex.slice(1);
  if (clean.length === 6) {
    const n = parseInt(clean, 16);
    if (Number.isNaN(n)) return [0, 0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  if (clean.length === 8) {
    const n = parseInt(clean, 16);
    if (Number.isNaN(n)) return [0, 0, 0, 0];
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  return [0, 0, 0, 0];
}

function decodeHexDigit(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code === 46 || code === 32 || code === 48) return 0; // '.', ' ', '0'
  if (code >= 49 && code <= 57) return code - 48; // '1'..'9'
  if (code >= 97 && code <= 102) return code - 87; // 'a'..'f'
  if (code >= 65 && code <= 70) return code - 55; // 'A'..'F'
  if (code >= 103 && code <= 118) return code - 87; // 'g'..'v' (16..31)
  return 0;
}

function setPixel(
  rgba: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const off = (y * w + x) * 4;
  rgba[off] = clampByte(r);
  rgba[off + 1] = clampByte(g);
  rgba[off + 2] = clampByte(b);
  rgba[off + 3] = clampByte(a);
}

function setRampPixel(
  rgba: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  ramp: Uint8Array,
  steps: number,
  t: number,
  dither: boolean,
  a = 255,
): void {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const clamped = Math.max(0, Math.min(1, t));
  let idx: number;
  if (dither) {
    const scaled = clamped * (steps - 1);
    const lo = Math.floor(scaled);
    const hi = Math.min(steps - 1, lo + 1);
    const frac = scaled - lo;
    const thresh = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
    idx = frac > thresh ? hi : lo;
  } else {
    idx = Math.round(clamped * (steps - 1));
  }
  const o = idx * 4;
  setPixel(rgba, w, h, x, y, ramp[o], ramp[o + 1], ramp[o + 2], a);
}

function compileGridSprite(def: EcsCustomSpriteDef): Uint8Array {
  const w = Math.max(8, Math.min(128, Math.round(def.width)));
  const h = Math.max(8, Math.min(128, Math.round(def.height)));
  const rgba = new Uint8Array(w * h * 4);
  const themeIdx = Math.max(0, Math.min(PALETTE_THEMES.length - 1, def.paletteRow ?? 0));
  const rawPalette = def.palette && def.palette.length > 0 ? def.palette : PALETTE_THEMES[themeIdx].colors;
  const lut = rawPalette.map((hex) => parseHexRgba(hex));
  const rows = def.pixels ?? [];

  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < w; x++) {
      const idx = x < row.length ? decodeHexDigit(row[x]) : 0;
      if (idx <= 0 || idx >= lut.length) continue;
      const c = lut[idx];
      if (c[3] <= 0) continue;
      const off = (y * w + x) * 4;
      rgba[off] = c[0];
      rgba[off + 1] = c[1];
      rgba[off + 2] = c[2];
      rgba[off + 3] = c[3];
    }
  }
  return rgba;
}

function applyOutlinePass(
  rgba: Uint8Array,
  w: number,
  h: number,
  outlineHex: string,
): void {
  const [or, og, ob, oa] = parseHexRgba(outlineHex);
  if (oa <= 0) return;
  const alphaSnap = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alphaSnap[i] = rgba[i * 4 + 3];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alphaSnap[i] > 16) continue;
      const up = y > 0 ? alphaSnap[i - w] : 0;
      const dn = y < h - 1 ? alphaSnap[i + w] : 0;
      const lf = x > 0 ? alphaSnap[i - 1] : 0;
      const rt = x < w - 1 ? alphaSnap[i + 1] : 0;
      if (up > 128 || dn > 128 || lf > 128 || rt > 128) {
        setPixel(rgba, w, h, x, y, or, og, ob, oa);
      }
    }
  }
}

function compileProceduralSprite(def: EcsCustomSpriteDef): Uint8Array {
  const w = Math.max(8, Math.min(128, Math.round(def.width)));
  const h = Math.max(8, Math.min(128, Math.round(def.height)));
  const rgba = new Uint8Array(w * h * 4);
  const recipe: EcsProceduralSpriteRecipe = def.recipe ?? { pattern: 'cobble', baseHex: '#64748b' };
  const seed = recipe.seed ?? 1337;
  const dither = recipe.dither !== false;
  const bevel = recipe.bevel !== false;

  const baseRgb = new Float32Array(3);
  const secRgb = new Float32Array(3);
  const accRgb = new Float32Array(3);
  const mixTmp = new Float32Array(3);
  hexToRgb01Into(recipe.baseHex, baseRgb, 0);
  if (recipe.secondaryHex) {
    hexToRgb01Into(recipe.secondaryHex, secRgb, 0);
  } else {
    mixOklabRgb01(baseRgb[0], baseRgb[1], baseRgb[2], 0.08, 0.1, 0.16, 0.35, secRgb, 0);
  }
  if (recipe.accentHex) {
    hexToRgb01Into(recipe.accentHex, accRgb, 0);
  } else {
    mixOklabRgb01(baseRgb[0], baseRgb[1], baseRgb[2], 0.98, 0.95, 0.82, 0.55, accRgb, 0);
  }

  const secHex = recipe.secondaryHex ?? rgb01ToHex(secRgb[0], secRgb[1], secRgb[2]);
  const accHex = recipe.accentHex ?? rgb01ToHex(accRgb[0], accRgb[1], accRgb[2]);

  const RAMP_STEPS = 7;
  const baseRamp = buildHueShiftedRamp(recipe.baseHex, RAMP_STEPS, new Uint8Array(RAMP_STEPS * 4), {
    hueShiftStrength: 0.45,
    lightnessSpan: 0.58,
  });
  const secRamp = buildHueShiftedRamp(secHex, RAMP_STEPS, new Uint8Array(RAMP_STEPS * 4), {
    hueShiftStrength: 0.4,
    lightnessSpan: 0.52,
  });
  const accRamp = buildHueShiftedRamp(accHex, RAMP_STEPS, new Uint8Array(RAMP_STEPS * 4), {
    hueShiftStrength: 0.32,
    lightnessSpan: 0.54,
  });

  const pat = recipe.pattern;

  if (pat === 'cobble' || pat === 'bricks' || pat === 'planks' || pat === 'metal_panel' || pat === 'rune_floor') {
    const cellW = pat === 'planks' ? w : pat === 'metal_panel' ? Math.max(8, Math.floor(w / 2)) : 8;
    const cellH = pat === 'planks' ? 6 : pat === 'metal_panel' ? Math.max(8, Math.floor(h / 2)) : 8;
    for (let y = 0; y < h; y++) {
      const rowIdx = Math.floor(y / cellH);
      const stagger = pat === 'bricks' || pat === 'cobble' ? ((rowIdx & 1) * Math.floor(cellW / 2)) : 0;
      for (let x = 0; x < w; x++) {
        const sx = (x + stagger) % w;
        const colIdx = Math.floor(sx / cellW);
        const lx = sx % cellW;
        const ly = y % cellH;
        const isMortar = lx === 0 || ly === 0 || (pat === 'cobble' && ((lx === 1 && ly === 1) || (lx === cellW - 1 && ly === cellH - 1)));
        const cellNoise = hash2d(colIdx, rowIdx, seed);
        const grain = (hash2d(x, y, seed + 17) - 0.5) * 0.14;

        if (isMortar) {
          setRampPixel(rgba, w, h, x, y, secRamp, RAMP_STEPS, 0.12 + grain * 0.4, dither);
          continue;
        }

        let shade = 0.42 + cellNoise * 0.26 + grain;
        if (bevel) {
          if (ly === 1 || lx === 1) shade += 0.22;
          else if (ly === cellH - 1 || lx === cellW - 1) shade -= 0.18;
        }
        if (pat === 'planks') {
          shade += Math.sin(x * 0.42 + rowIdx * 2.1) * 0.08;
        }
        if (pat === 'metal_panel') {
          const isRivet = (lx === 2 || lx === cellW - 2) && (ly === 2 || ly === cellH - 2);
          if (isRivet) {
            setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.82, false);
            continue;
          }
          if (x === w - 1 || y === h - 1) shade -= 0.22;
        }
        setRampPixel(rgba, w, h, x, y, baseRamp, RAMP_STEPS, shade, dither);

        if (pat === 'rune_floor') {
          const cx = w * 0.5;
          const cy = h * 0.5;
          const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const rOuter = Math.min(w, h) * 0.36;
          const rInner = Math.min(w, h) * 0.19;
          const onRing = Math.abs(dist - rOuter) < 1.15 || Math.abs(dist - rInner) < 1.05;
          const onCross = (Math.abs(x + 0.5 - cx) < 1.05 || Math.abs(y + 0.5 - cy) < 1.05) && dist <= rOuter;
          if (onRing || onCross) {
            setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, recipe.emissiveCore ? 0.92 : 0.72, false);
          }
        }
      }
    }
  } else if (pat === 'foliage') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tuftX = Math.floor(x / 4);
        const tuftY = Math.floor(y / 4);
        const n1 = hash2d(tuftX, tuftY, seed);
        const n2 = hash2d(x, y, seed + 31);
        const wave = Math.sin((x + y * 0.6) * 0.45 + n1 * 3.1) * 0.14;
        const shade = 0.36 + n1 * 0.32 + (n2 - 0.5) * 0.22 + wave;
        if (n2 > 0.94 && (x & 1) === 0) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.8, false);
        } else {
          setRampPixel(rgba, w, h, x, y, baseRamp, RAMP_STEPS, shade, dither);
        }
      }
    }
  } else if (pat === 'water') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ripple = Math.sin(x * 0.42 + Math.sin(y * 0.35) * 1.8 + seed) * 0.5 + 0.5;
        const wave2 = Math.cos((y * 0.55 - x * 0.18) + seed * 0.3) * 0.5 + 0.5;
        const v = ripple * 0.55 + wave2 * 0.45;
        if (v > 0.84) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.85, dither);
        } else {
          setRampPixel(rgba, w, h, x, y, baseRamp, RAMP_STEPS, 0.25 + v * 0.55, dither);
        }
      }
    }
  } else if (pat === 'circuit') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bgShade = 0.24 + (hash2d(x, y, seed) - 0.5) * 0.1;
        setRampPixel(rgba, w, h, x, y, baseRamp, RAMP_STEPS, bgShade, dither);
        const gx = x % 8;
        const gy = y % 8;
        const trace = gx === 4 || gy === 4 || (Math.abs(x - y) <= 1 && (x > 4 && x < w - 5));
        if (trace && (hash2d(Math.floor(x / 8), Math.floor(y / 8), seed + 9) > 0.28 || gx === 4 && gy === 4)) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, recipe.emissiveCore ? 0.9 : 0.72, false);
        }
        if ((gx === 4 && gy === 4)) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.96, false);
        }
      }
    }
  } else if (pat === 'crystal') {
    const cx = w * 0.5;
    for (let y = 2; y < h - 1; y++) {
      const ny = (y - 2) / Math.max(1, h - 4);
      const halfW = ny < 0.35
        ? Math.max(1.2, (ny / 0.35) * (w * 0.34))
        : Math.max(1.5, (1 - (ny - 0.35) * 0.65) * (w * 0.34));
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        if (Math.abs(dx) > halfW) continue;
        const facet = dx < -halfW * 0.18 ? 0.85 : dx > halfW * 0.22 ? 0.34 : 0.62;
        const vert = (1 - ny * 0.35);
        const coreGlow = recipe.emissiveCore && Math.abs(dx) < halfW * 0.3 && ny > 0.25 && ny < 0.7 ? 0.24 : 0;
        setRampPixel(rgba, w, h, x, y, baseRamp, RAMP_STEPS, facet * vert + coreGlow, dither);
        if (Math.abs(dx + halfW * 0.25) < 1.0 && ny > 0.12 && ny < 0.78) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.94, false);
        }
      }
    }
    applyOutlinePass(rgba, w, h, recipe.outlineHex ?? '#0f172a');
  } else if (pat === 'pillar') {
    const margin = Math.max(2, Math.floor(w * 0.16));
    const capH = Math.max(4, Math.floor(h * 0.18));
    const baseH = Math.max(4, Math.floor(h * 0.16));
    for (let y = 1; y < h - 1; y++) {
      const isCap = y < capH;
      const isFoot = y >= h - baseH;
      const pad = isCap || isFoot ? Math.max(1, margin - 2) : margin;
      for (let x = pad; x < w - pad; x++) {
        const nx = (x - pad) / Math.max(1, w - pad * 2 - 1);
        const cyl = Math.sin(nx * Math.PI);
        const flute = !isCap && !isFoot && ((x - pad) % 3 === 0) ? -0.14 : 0;
        const capBoost = isCap ? 0.14 : isFoot ? -0.1 : 0;
        const shade = 0.22 + cyl * 0.56 + flute + capBoost + (hash2d(x, y, seed) - 0.5) * 0.08;
        setRampPixel(rgba, w, h, x, y, baseRamp, RAMP_STEPS, shade, dither);
        if ((isCap && y === capH - 1) || (isFoot && y === h - baseH)) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.78, false);
        }
      }
    }
    applyOutlinePass(rgba, w, h, recipe.outlineHex ?? '#111827');
  } else if (pat === 'gate') {
    const barSpacing = Math.max(4, Math.floor(w / 5));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const isFrame = x < 3 || x >= w - 3 || y < 4 || y >= h - 3;
        const isBar = !isFrame && (x % barSpacing === 0 || x % barSpacing === 1);
        const isCross = !isFrame && (Math.abs(y - Math.floor(h * 0.36)) <= 1 || Math.abs(y - Math.floor(h * 0.68)) <= 1);
        if (isFrame) {
          const bShade = 0.35 + (x < 3 || y < 4 ? 0.28 : -0.05) + (hash2d(x, y, seed) - 0.5) * 0.1;
          setRampPixel(rgba, w, h, x, y, baseRamp, RAMP_STEPS, bShade, dither);
        } else if (isBar || isCross) {
          const metal = 0.45 + (x % barSpacing === 0 ? 0.28 : -0.1);
          setRampPixel(rgba, w, h, x, y, secRamp, RAMP_STEPS, metal, dither);
        } else {
          // Dark gate backing with subtle emissive rune lock at center
          const cx = w * 0.5;
          const cy = h * 0.5;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d < Math.min(w, h) * 0.16) {
            setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.92, false);
          } else {
            setRampPixel(rgba, w, h, x, y, secRamp, RAMP_STEPS, 0.08, false, 210);
          }
        }
      }
    }
  } else if (pat === 'banner') {
    const margin = Math.max(3, Math.floor(w * 0.2));
    for (let y = 2; y < h - 2; y++) {
      const ny = (y - 2) / Math.max(1, h - 4);
      for (let x = margin; x < w - margin; x++) {
        const nx = (x - margin) / Math.max(1, w - margin * 2 - 1);
        // Swallowtail notch at bottom
        if (ny > 0.78 && Math.abs(nx - 0.5) < (ny - 0.78) * 1.8) continue;
        if (y <= 4) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.82, false);
          continue;
        }
        const fold = Math.sin(nx * Math.PI * 3) * 0.14;
        const border = x === margin || x === w - margin - 1;
        if (border) {
          setRampPixel(rgba, w, h, x, y, accRamp, RAMP_STEPS, 0.76, false);
        } else {
          const emblem = Math.hypot((nx - 0.5) * 2, (ny - 0.44) * 2.4) < 0.42;
          setRampPixel(rgba, w, h, x, y, emblem ? accRamp : baseRamp, RAMP_STEPS, 0.52 + fold, dither);
        }
      }
    }
    applyOutlinePass(rgba, w, h, recipe.outlineHex ?? '#111827');
  } else if (pat === 'orb') {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const rad = Math.min(w, h) * 0.38;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - cx) / rad;
        const dy = (y + 0.5 - cy) / rad;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1.0) continue;
        const dz = Math.sqrt(Math.max(0, 1 - d2));
        const ndl = Math.max(0, -dx * 0.45 - dy * 0.55 + dz * 0.7);
        const spec = ndl > 0.86 ? 0.35 : 0;
        const rampUse = recipe.emissiveCore && d2 < 0.22 ? accRamp : baseRamp;
        setRampPixel(rgba, w, h, x, y, rampUse, RAMP_STEPS, 0.18 + ndl * 0.72 + spec, dither);
      }
    }
    applyOutlinePass(rgba, w, h, recipe.outlineHex ?? '#0f172a');
  }

  if (recipe.frameBorder) {
    mixOklabRgb01(baseRgb[0], baseRgb[1], baseRgb[2], accRgb[0], accRgb[1], accRgb[2], 0.5, mixTmp, 0);
    const br = mixTmp[0] * 255;
    const bg = mixTmp[1] * 255;
    const bb = mixTmp[2] * 255;
    for (let x = 0; x < w; x++) {
      setPixel(rgba, w, h, x, 0, br, bg, bb, 255);
      setPixel(rgba, w, h, x, h - 1, br * 0.55, bg * 0.55, bb * 0.55, 255);
    }
    for (let y = 0; y < h; y++) {
      setPixel(rgba, w, h, 0, y, br, bg, bb, 255);
      setPixel(rgba, w, h, w - 1, y, br * 0.55, bg * 0.55, bb * 0.55, 255);
    }
  }

  return rgba;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LUT = new Int16Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LUT[B64_CHARS.charCodeAt(i)] = i;
}

/** Pure, DOM-free & Node-safe Base64 encoder for Uint8Array. */
export function uint8ToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64_CHARS[(triple >>> 18) & 63];
    out += B64_CHARS[(triple >>> 12) & 63];
    out += i + 1 < len ? B64_CHARS[(triple >>> 6) & 63] : '=';
    out += i + 2 < len ? B64_CHARS[triple & 63] : '=';
  }
  return out;
}

/** Pure, DOM-free & Node-safe Base64 decoder to Uint8Array. */
export function base64ToUint8(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const len = clean.length;
  let pad = 0;
  if (len >= 2 && clean[len - 1] === '=') pad++;
  if (len >= 2 && clean[len - 2] === '=') pad++;
  const outLen = Math.max(0, ((len * 3) >> 2) - pad);
  const out = new Uint8Array(outLen);
  let oi = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = B64_LUT[clean.charCodeAt(i) & 127] ?? 0;
    const c1 = B64_LUT[clean.charCodeAt(i + 1) & 127] ?? 0;
    const c2 = i + 2 < len && clean[i + 2] !== '=' ? (B64_LUT[clean.charCodeAt(i + 2) & 127] ?? 0) : 0;
    const c3 = i + 3 < len && clean[i + 3] !== '=' ? (B64_LUT[clean.charCodeAt(i + 3) & 127] ?? 0) : 0;
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (oi < outLen) out[oi++] = (triple >>> 16) & 255;
    if (oi < outLen) out[oi++] = (triple >>> 8) & 255;
    if (oi < outLen) out[oi++] = triple & 255;
  }
  return out;
}

/** Compresses raw RGBA8 pixel bytes with fflate zlib and encodes to compact Base64. */
export function encodeRgbaToZlibB64(rgba: Uint8Array): string {
  const compressed = zlibSync(rgba, { level: 6 });
  return uint8ToBase64(compressed);
}

const MAX_CUSTOM_SPRITE_RGBA_BYTES = 128 * 128 * 4;
const MAX_CUSTOM_SPRITE_B64_CHARS = 256 * 1024;

/** Decodes zlib-compressed Base64 RGBA8 sprite bytes safely with strict decompressed size bounds. */
export function decodeZlibB64ToRgba(b64: string, expectedBytes: number): Uint8Array {
  const safeExpected = Math.max(0, Math.min(MAX_CUSTOM_SPRITE_RGBA_BYTES, Math.round(expectedBytes)));
  if (!b64 || b64.length > MAX_CUSTOM_SPRITE_B64_CHARS) {
    return new Uint8Array(safeExpected);
  }
  try {
    const raw = base64ToUint8(b64);
    const out = new Uint8Array(safeExpected);
    let written = 0;
    const stream = new Unzlib((chunk) => {
      if (written + chunk.byteLength > MAX_CUSTOM_SPRITE_RGBA_BYTES) {
        throw new Error('Custom sprite zlib payload exceeds 128x128 RGBA limit');
      }
      const copyLen = Math.min(chunk.byteLength, safeExpected - written);
      if (copyLen > 0) {
        out.set(chunk.subarray(0, copyLen), written);
      }
      written += chunk.byteLength;
    });
    stream.push(raw, true);
    return out;
  } catch {
    return new Uint8Array(safeExpected);
  }
}

/**
 * Compiles a serializable `EcsCustomSpriteDef` (palette pixel grid, lossless zlib-base64 RGBA,
 * OR Oklab + Bayer 4x4 procedural recipe) into raw RGBA bytes ready for Pixer's TextureAtlas.
 */
export function compileCustomSpriteToRgba(def: EcsCustomSpriteDef): CompiledCustomSpriteRgba {
  const width = Math.max(8, Math.min(128, Math.round(def.width)));
  const height = Math.max(8, Math.min(128, Math.round(def.height)));
  let rgba: Uint8Array;
  if (def.kind === 'grid') {
    rgba = compileGridSprite(def);
  } else if (def.kind === 'rgba_b64') {
    rgba = def.rgbaB64 ? decodeZlibB64ToRgba(def.rgbaB64, width * height * 4) : new Uint8Array(width * height * 4);
  } else {
    rgba = compileProceduralSprite(def);
  }
  return { id: def.id, width, height, rgba };
}

/**
 * Synchronizes all `project.customSprites` into `TextureAtlas` dynamic pages without recreating
 * GPU contexts. Releases any previously synced custom sprite IDs no longer in the project.
 */
export function syncProjectCustomSpritesToAtlas(
  atlas: TextureAtlas,
  project: EcsProjectV2,
  previousSyncedIds?: ReadonlySet<string>,
): Set<string> {
  const nextIds = new Set<string>();
  const customMap = project.customSprites;

  if (customMap) {
    for (const [key, def] of Object.entries(customMap)) {
      if (!def || typeof def !== 'object') continue;
      const spriteId = def.id || key;
      const compiled = compileCustomSpriteToRgba({ ...def, id: spriteId });
      atlas.registerDynamicRgbaSprite(compiled.id, compiled.width, compiled.height, compiled.rgba);
      nextIds.add(compiled.id);
    }
  }

  if (previousSyncedIds) {
    for (const prevId of previousSyncedIds) {
      if (!nextIds.has(prevId)) {
        atlas.releaseDynamicSprite(prevId);
      }
    }
  }

  return nextIds;
}
