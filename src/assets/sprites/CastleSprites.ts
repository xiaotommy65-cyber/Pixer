import { hexToRgb01Into, mixOklabRgb01 } from '../../core/math/ColorMath.ts';

/**
 * High-Craft Demon Castle Procedural PBR Pixel Sprite Pack (32x32, 32x48, 48x64).
 *
 * 100% DOM-free, deterministic, zero external AI wallpapers.
 * Uses Pixer's Oklab perceptual color blending, Bayer 4x4 ordered dithering,
 * crisp dark ink silhouettes, bevel highlights, and multi-page RGBA atlas registration
 * so WebGPU/WebGL2 Sobel PBR-Lite shaders light every stone brick, iron grate,
 * stained-glass arch, and obsidian throne dynamically.
 */

export type CastleSpriteId =
  | 'castle_floor_stone'
  | 'castle_floor_moss'
  | 'castle_floor_carpet'
  | 'castle_floor_carpet_h'
  | 'castle_floor_grate'
  | 'castle_floor_seal'
  | 'castle_floor_lava'
  | 'castle_floor_stairs'
  | 'castle_wall_top'
  | 'castle_wall_brick'
  | 'castle_wall_window'
  | 'castle_gate_iron'
  | 'castle_gate_open'
  | 'castle_pillar_tall'
  | 'castle_torch_brazier'
  | 'castle_chest_closed'
  | 'castle_chest_open'
  | 'castle_switch_off'
  | 'castle_switch_on'
  | 'castle_banner_crimson'
  | 'castle_spikes'
  | 'castle_key_gold'
  | 'castle_chalice'
  | 'castle_portal_arch'
  | 'castle_hero_a'
  | 'castle_hero_b'
  | 'castle_slash_arc'
  | 'castle_sentinel'
  | 'castle_ember_orb'
  | 'castle_throne'
  | 'castle_demon_lord';

export interface CastleSpriteAsset {
  readonly id: CastleSpriteId;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
] as const;

const RGB_A = new Float32Array(3);
const RGB_B = new Float32Array(3);
const RGB_OUT = new Float32Array(3);

function hash2d(x: number, y: number, seed = 1337): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function bayer01(x: number, y: number): number {
  return (BAYER_4X4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

function putPx(buf: Uint8Array, w: number, h: number, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const ix = x | 0;
  const iy = y | 0;
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;
  const i = (iy * w + ix) * 4;
  buf[i] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
  buf[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  buf[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
  buf[i + 3] = a < 0 ? 0 : a > 255 ? 255 : a | 0;
}

function putHex(buf: Uint8Array, w: number, h: number, x: number, y: number, hex: string, alpha = 255): void {
  hexToRgb01Into(hex, RGB_A, 0);
  putPx(buf, w, h, x, y, Math.round(RGB_A[0] * 255), Math.round(RGB_A[1] * 255), Math.round(RGB_A[2] * 255), alpha);
}

function putOklabMix(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  hexA: string,
  hexB: string,
  t: number,
  alpha = 255,
): void {
  hexToRgb01Into(hexA, RGB_A, 0);
  hexToRgb01Into(hexB, RGB_B, 0);
  mixOklabRgb01(RGB_A[0], RGB_A[1], RGB_A[2], RGB_B[0], RGB_B[1], RGB_B[2], t, RGB_OUT, 0);
  putPx(
    buf,
    w,
    h,
    x,
    y,
    Math.round(RGB_OUT[0] * 255),
    Math.round(RGB_OUT[1] * 255),
    Math.round(RGB_OUT[2] * 255),
    alpha,
  );
}

function fillRectHex(
  buf: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  rw: number,
  rh: number,
  hex: string,
  alpha = 255,
): void {
  hexToRgb01Into(hex, RGB_A, 0);
  const r = Math.round(RGB_A[0] * 255);
  const g = Math.round(RGB_A[1] * 255);
  const b = Math.round(RGB_A[2] * 255);
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      putPx(buf, w, h, x, y, r, g, b, alpha);
    }
  }
}

function addCrispOutline(buf: Uint8Array, w: number, h: number, outlineHex = '#0a0814'): void {
  hexToRgb01Into(outlineHex, RGB_A, 0);
  const or = Math.round(RGB_A[0] * 255);
  const og = Math.round(RGB_A[1] * 255);
  const ob = Math.round(RGB_A[2] * 255);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4 + 3] > 32) continue;
      const n = y > 0 && buf[((y - 1) * w + x) * 4 + 3] > 32;
      const s = y < h - 1 && buf[((y + 1) * w + x) * 4 + 3] > 32;
      const l = x > 0 && buf[(y * w + (x - 1)) * 4 + 3] > 32;
      const r = x < w - 1 && buf[(y * w + (x + 1)) * 4 + 3] > 32;
      if (n || s || l || r) mask[y * w + x] = 1;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) putPx(buf, w, h, x, y, or, og, ob, 255);
    }
  }
}

// ============================================================================
// 1. 32x32 ARCHITECTURAL FLOOR TILES
// ============================================================================

function buildCastleFloorStone(withMoss: boolean): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  const darkMortar = '#121524';
  const slateDeep = '#1f263b';
  const slateMid = '#2f3954';
  const slateLight = '#475575';
  const mossDark = '#1c4237';
  const mossBright = '#3a7d5c';

  for (let y = 0; y < S; y++) {
    const row = y < 16 ? 0 : 1;
    const ly = y & 15;
    const shift = row === 1 ? 8 : 0;
    for (let x = 0; x < S; x++) {
      const sx = (x + shift) & 31;
      const lx = sx & 15;
      const isMortar = ly === 0 || lx === 0;
      if (isMortar) {
        putHex(buf, S, S, x, y, darkMortar);
        continue;
      }
      const slabHash = hash2d((sx >> 4) + row * 7, row * 13 + (withMoss ? 19 : 3));
      const grain = hash2d(x, y, withMoss ? 41 : 17);
      const isTopBevel = ly === 1 || lx === 1;
      const isBotShade = ly === 15 || lx === 15;

      if (isTopBevel) {
        putOklabMix(buf, S, S, x, y, slateMid, slateLight, 0.55 + slabHash * 0.35);
      } else if (isBotShade) {
        putOklabMix(buf, S, S, x, y, darkMortar, slateDeep, 0.55);
      } else {
        const d = bayer01(x, y);
        const shade = 0.25 + slabHash * 0.42 + (grain - 0.5) * 0.14;
        putOklabMix(buf, S, S, x, y, slateDeep, slateMid, shade > d ? 0.85 : 0.22);
      }

      // Subtle stone fracture line
      if ((row === 0 && lx === 10 && ly >= 6 && ly <= 11) || (row === 1 && lx === 5 && ly >= 9 && ly <= 13)) {
        putHex(buf, S, S, x, y, darkMortar);
      }

      // Moss growth creeping along mortar seams
      if (withMoss && (ly <= 3 || lx <= 2) && grain > 0.48) {
        putHex(buf, S, S, x, y, grain > 0.74 ? mossBright : mossDark);
      }
    }
  }
  return buf;
}

function buildCastleCarpet(horizontal: boolean): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  const crimsonDark = '#4a0d1c';
  const crimsonMid = '#8c1732';
  const crimsonBright = '#c42748';
  const goldDark = '#9e6b1b';
  const goldBright = '#f4c552';

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const across = horizontal ? y : x;
      const along = horizontal ? x : y;

      // Stone peek at outer 2px edge
      if (across < 2 || across >= S - 2) {
        putHex(buf, S, S, x, y, across === 1 || across === S - 2 ? '#121524' : '#262f47');
        continue;
      }
      // Woven gold trim strips
      if (across === 2 || across === S - 3 || across === 5 || across === S - 6) {
        const shimmer = ((along + across) & 3) === 0 ? 0.95 : 0.35;
        putOklabMix(buf, S, S, x, y, goldDark, goldBright, shimmer);
        continue;
      }
      if (across === 3 || across === 4 || across === S - 4 || across === S - 5) {
        // Filigree diamond chain along border
        const diag = Math.abs(((along % 6) - 2.5));
        if (diag < 1.1) {
          putHex(buf, S, S, x, y, goldBright);
        } else {
          putHex(buf, S, S, x, y, crimsonDark);
        }
        continue;
      }

      // Central royal velvet weave + ornate diamond motif
      const cx = Math.abs(across - 15.5);
      const cy = Math.abs(((along % 16) - 7.5));
      const diamond = cx + cy;
      if (diamond >= 5.5 && diamond <= 6.8) {
        putOklabMix(buf, S, S, x, y, goldDark, goldBright, 0.72);
      } else if (diamond < 2.2) {
        putHex(buf, S, S, x, y, crimsonBright);
      } else {
        const weave = bayer01(x, y);
        const t = 0.35 + (1 - cx / 14) * 0.45;
        putOklabMix(buf, S, S, x, y, crimsonDark, t > weave ? crimsonBright : crimsonMid, 0.72);
      }
    }
  }
  return buf;
}

function buildCastleGrate(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const border = x < 3 || x >= S - 3 || y < 3 || y >= S - 3;
      const barX = x % 6 === 0 || x % 6 === 1;
      const barY = y % 8 === 0 || y % 8 === 1;
      if (border) {
        const bevel = x === 0 || y === 0 ? '#5c6b8a' : x === S - 1 || y === S - 1 ? '#121624' : '#323c54';
        putHex(buf, S, S, x, y, bevel);
      } else if (barX || barY) {
        const hi = (x % 6 === 0) || (y % 8 === 0);
        putHex(buf, S, S, x, y, hi ? '#5b6885' : '#252d42');
      } else {
        // Deep dungeon void beneath grate
        const d = Math.hypot(x - 15.5, y - 15.5) / 22;
        putOklabMix(buf, S, S, x, y, '#06070d', '#14192b', d * 0.5);
      }
    }
  }
  return buf;
}

function buildCastleSeal(): Uint8Array {
  const buf = buildCastleFloorStone(false);
  const S = 32;
  const cx = 15.5;
  const cy = 15.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      if (Math.abs(r - 12.2) < 1.15 || Math.abs(r - 7.4) < 0.95) {
        putHex(buf, S, S, x, y, r > 10 ? '#f59e0b' : '#fb7185');
      } else if (r < 12 && Math.abs(Math.sin(ang * 4)) < 0.14) {
        putHex(buf, S, S, x, y, '#fde68a');
      } else if (r < 3.2) {
        putHex(buf, S, S, x, y, r < 1.5 ? '#fffbeb' : '#fbbf24');
      }
    }
  }
  return buf;
}

function buildCastleLava(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const w =
        Math.sin(x * 0.28 + Math.cos(y * 0.24) * 1.6) * 0.5 +
        Math.cos(y * 0.34 - x * 0.18) * 0.5;
      const v = (w + 1) * 0.5;
      const d = bayer01(x, y);
      if (v > 0.78) {
        putHex(buf, S, S, x, y, v > 0.88 ? '#fef08a' : '#f59e0b');
      } else if (v > 0.42 + d * 0.15) {
        putOklabMix(buf, S, S, x, y, '#991b1b', '#ef4444', (v - 0.35) * 1.4);
      } else {
        putOklabMix(buf, S, S, x, y, '#241219', '#5c1420', v * 2);
      }
    }
  }
  return buf;
}

function buildCastleStairs(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const stepIdx = Math.floor(y / 8);
    const ly = y % 8;
    for (let x = 0; x < S; x++) {
      const edge = x < 3 || x >= S - 3;
      if (edge) {
        putHex(buf, S, S, x, y, x === 2 || x === S - 3 ? '#d99a36' : '#2c3550');
        continue;
      }
      if (ly === 0) {
        putHex(buf, S, S, x, y, '#7283a8');
      } else if (ly === 1) {
        putHex(buf, S, S, x, y, '#4a5878');
      } else if (ly === 7) {
        putHex(buf, S, S, x, y, '#0e111f');
      } else {
        const t = 0.2 + stepIdx * 0.12 + (hash2d(x, y, 71) - 0.5) * 0.08;
        putOklabMix(buf, S, S, x, y, '#222a40', '#3d4a6b', t);
      }
    }
  }
  return buf;
}

// ============================================================================
// 2. 32x32 ARCHITECTURAL WALLS, STAINED GLASS & IRON GATES
// ============================================================================

function buildCastleWallTop(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const isOuterBorder = x === 0 || y === 0 || x === S - 1 || y === S - 1;
      const isRimHi = y === 1 || x === 1;
      const isRimLo = y === S - 2 || x === S - 2;
      const isBattlementNotch = (y < 5 && ((x >= 6 && x <= 11) || (x >= 20 && x <= 25)));
      if (isOuterBorder) {
        putHex(buf, S, S, x, y, '#0c0f1c');
      } else if (isBattlementNotch) {
        putHex(buf, S, S, x, y, y === 4 ? '#5c6c91' : '#181e30');
      } else if (isRimHi) {
        putHex(buf, S, S, x, y, '#6b7ea6');
      } else if (isRimLo) {
        putHex(buf, S, S, x, y, '#171c2e');
      } else {
        const blockSeam = y === 16 || (y < 16 ? x === 16 : x === 8 || x === 24);
        if (blockSeam) {
          putHex(buf, S, S, x, y, '#151a2b');
        } else {
          const g = hash2d(x, y, 99);
          const d = bayer01(x, y);
          putOklabMix(buf, S, S, x, y, '#28314a', '#435175', g * 0.7 > d ? 0.75 : 0.25);
        }
      }
    }
  }
  return buf;
}

function buildCastleWallBrick(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / 8);
    const ly = y % 8;
    const offset = (row & 1) * 8;
    for (let x = 0; x < S; x++) {
      const sx = (x + offset) & 31;
      const lx = sx & 15;
      if (ly === 0 || lx === 0) {
        putHex(buf, S, S, x, y, '#0d101c');
      } else if (ly === 1) {
        putHex(buf, S, S, x, y, '#59698c');
      } else if (ly === 7) {
        putHex(buf, S, S, x, y, '#181e30');
      } else {
        const shade = 0.25 + (1 - y / S) * 0.45 + (hash2d(sx >> 4, row, 55) - 0.5) * 0.25;
        putOklabMix(buf, S, S, x, y, '#1f273d', '#3e4c6e', shade);
      }
    }
  }
  return buf;
}

function buildCastleWallWindow(): Uint8Array {
  const buf = buildCastleWallBrick();
  const S = 32;
  // Gothic pointed lancet stained-glass window with glowing crimson/sapphire/gold panes
  for (let y = 3; y <= 28; y++) {
    const archHalfW = y < 12 ? Math.max(0, Math.round(Math.sqrt(Math.max(0, 1 - Math.pow((12 - y) / 9.5, 2))) * 9)) : 9;
    for (let x = 16 - archHalfW - 2; x <= 15 + archHalfW + 2; x++) {
      const distX = Math.abs(x - 15.5);
      if (distX > archHalfW) {
        // Carved stone frame around window
        putHex(buf, S, S, x, y, distX < archHalfW + 1.2 ? '#0e1120' : '#657599');
        continue;
      }
      // Lead mullions
      if (Math.abs(x - 15.5) < 0.8 || y === 12 || y === 20 || y === 28) {
        putHex(buf, S, S, x, y, '#141726');
        continue;
      }
      // Luminous stained-glass quadrants
      if (y < 12) {
        // Golden rose crest at arch apex
        const r = Math.hypot(x - 15.5, y - 8.5);
        putHex(buf, S, S, x, y, r < 2.6 ? '#fef08a' : '#f59e0b');
      } else if (y < 20) {
        const pane = ((x + y) & 3) === 0;
        putHex(buf, S, S, x, y, pane ? '#fca5a5' : '#dc2626');
      } else {
        const pane = ((x - y) & 3) === 0;
        putHex(buf, S, S, x, y, pane ? '#93c5fd' : '#2563eb');
      }
    }
  }
  return buf;
}

function buildCastleGate(open: boolean): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  // Stone gateway jambs left & right
  fillRectHex(buf, S, S, 0, 0, 5, S, '#2b344d');
  fillRectHex(buf, S, S, S - 5, 0, 5, S, '#2b344d');
  fillRectHex(buf, S, S, 0, 0, S, 5, '#3b4869');
  fillRectHex(buf, S, S, 4, 4, 1, S - 4, '#5f7096');
  fillRectHex(buf, S, S, S - 5, 4, 1, S - 4, '#111524');

  if (!open) {
    // Dark archway recess + heavy forged iron portcullis bars
    fillRectHex(buf, S, S, 5, 5, S - 10, S - 5, '#0b0e18');
    for (let x = 7; x <= S - 8; x += 4) {
      fillRectHex(buf, S, S, x, 5, 2, S - 5, '#596782');
      fillRectHex(buf, S, S, x + 1, 5, 1, S - 5, '#2a3245');
    }
    for (const ry of [10, 18, 26]) {
      fillRectHex(buf, S, S, 5, ry, S - 10, 2, '#6f7e9c');
      fillRectHex(buf, S, S, 5, ry + 1, S - 10, 1, '#1d2436');
    }
    // Glowing crimson lock seal in center
    fillRectHex(buf, S, S, 13, 14, 6, 7, '#d97706');
    fillRectHex(buf, S, S, 14, 15, 4, 5, '#fbbf24');
    fillRectHex(buf, S, S, 15, 16, 2, 3, '#991b1b');
  } else {
    // Raised portcullis teeth at top only — clear warm golden passage
    fillRectHex(buf, S, S, 5, 5, S - 10, 4, '#475569');
    for (let x = 7; x <= S - 8; x += 4) {
      putHex(buf, S, S, x, 9, '#94a3b8');
      putHex(buf, S, S, x, 10, '#cbd5e1');
    }
    // Subtle translucent golden shimmer threshold
    for (let y = 11; y < S; y++) {
      for (let x = 6; x < S - 6; x++) {
        const a = Math.round(28 + (1 - y / S) * 32);
        putHex(buf, S, S, x, y, '#fbbf24', a);
      }
    }
  }
  return buf;
}

// ============================================================================
// 3. 32x32 & 32x48 INTERACTIVE PROPS (PILLAR, BRAZIER, CHEST, SWITCH, ETC.)
// ============================================================================

function buildCastlePillarTall(): Uint8Array {
  const W = 32;
  const H = 48;
  const buf = new Uint8Array(W * H * 4);

  // Carved gothic capital (top)
  fillRectHex(buf, W, H, 5, 3, 22, 6, '#506085');
  fillRectHex(buf, W, H, 4, 2, 24, 3, '#7b8eb8');
  fillRectHex(buf, W, H, 6, 9, 20, 3, '#d99a36'); // Gold capital collar
  fillRectHex(buf, W, H, 7, 10, 18, 1, '#fde68a');

  // Fluted cylindrical obsidian shaft
  for (let y = 12; y < 38; y++) {
    for (let x = 8; x < 24; x++) {
      const nx = (x - 15.5) / 8;
      const flute = Math.sin(x * 1.45) * 0.16;
      const lit = Math.max(0, Math.min(1, 0.56 - nx * 0.42 + flute));
      putOklabMix(buf, W, H, x, y, '#1a2136', '#7284ab', lit);
    }
  }

  // Carved stepped plinth base
  fillRectHex(buf, W, H, 6, 38, 20, 3, '#b8832c');
  fillRectHex(buf, W, H, 5, 41, 22, 3, '#4c5b7d');
  fillRectHex(buf, W, H, 4, 44, 24, 3, '#28324a');

  addCrispOutline(buf, W, H);
  return buf;
}

function buildCastleBrazier(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  // Tripod iron legs & pedestal
  fillRectHex(buf, S, S, 13, 18, 6, 11, '#2d3548');
  fillRectHex(buf, S, S, 9, 27, 14, 3, '#3f4a63');
  fillRectHex(buf, S, S, 10, 22, 3, 6, '#1f2533');
  fillRectHex(buf, S, S, 19, 22, 3, 6, '#1f2533');
  // Ornate iron bowl with gold trim
  fillRectHex(buf, S, S, 7, 14, 18, 5, '#3b465e');
  fillRectHex(buf, S, S, 9, 18, 14, 3, '#1e2536');
  fillRectHex(buf, S, S, 7, 14, 18, 2, '#d99a36');
  // Roaring layered pixel flame
  for (let y = 3; y <= 14; y++) {
    for (let x = 9; x <= 22; x++) {
      const dx = (x - 15.5) / 5.8;
      const dy = (14 - y) / 10.5;
      const sway = Math.sin(y * 0.65) * 0.14;
      const widthAtY = (1 - dy * 0.82) * (1 + Math.sin(dy * Math.PI) * 0.25);
      const dist = Math.abs(dx - sway);
      if (dist < widthAtY) {
        if (dist < widthAtY * 0.36 && dy < 0.65) {
          putHex(buf, S, S, x, y, '#fffbeb');
        } else if (dist < widthAtY * 0.68 && dy < 0.85) {
          putHex(buf, S, S, x, y, '#fbbf24');
        } else {
          putHex(buf, S, S, x, y, '#ea580c');
        }
      }
    }
  }
  // Floating ember sparks
  putHex(buf, S, S, 11, 4, '#fde047');
  putHex(buf, S, S, 21, 5, '#fb923c');
  addCrispOutline(buf, S, S);
  return buf;
}

function buildCastleChest(open: boolean): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  if (!open) {
    // Vaulted crimson-wood chest with forged gold bands
    fillRectHex(buf, S, S, 5, 9, 22, 18, '#6e1c2b');
    fillRectHex(buf, S, S, 6, 10, 20, 6, '#9c283d');
    fillRectHex(buf, S, S, 5, 16, 22, 2, '#1e1318');
    // Gold straps & rim
    fillRectHex(buf, S, S, 5, 9, 22, 2, '#e8b038');
    fillRectHex(buf, S, S, 5, 25, 22, 2, '#b88022');
    fillRectHex(buf, S, S, 8, 9, 3, 18, '#eab308');
    fillRectHex(buf, S, S, 21, 9, 3, 18, '#eab308');
    // Center keyhole clasp
    fillRectHex(buf, S, S, 14, 14, 4, 6, '#fef08a');
    fillRectHex(buf, S, S, 15, 16, 2, 2, '#1c1917');
  } else {
    // Opened lid + empty velvet interior with gold rim
    fillRectHex(buf, S, S, 5, 5, 22, 8, '#541421');
    fillRectHex(buf, S, S, 5, 5, 22, 2, '#d99a36');
    fillRectHex(buf, S, S, 6, 13, 20, 5, '#190b12');
    fillRectHex(buf, S, S, 5, 17, 22, 10, '#782030');
    fillRectHex(buf, S, S, 8, 17, 3, 10, '#d99a36');
    fillRectHex(buf, S, S, 21, 17, 3, 10, '#d99a36');
    fillRectHex(buf, S, S, 14, 18, 4, 3, '#fde047');
  }
  addCrispOutline(buf, S, S);
  return buf;
}

function buildCastleSwitch(pressed: boolean): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  // Stone socket frame
  fillRectHex(buf, S, S, 4, 4, 24, 24, '#2a334a');
  fillRectHex(buf, S, S, 6, 6, 20, 20, '#131826');
  // Pressure plate center
  const offset = pressed ? 1 : 0;
  fillRectHex(buf, S, S, 8, 8 + offset, 16, 16 - offset, pressed ? '#0e7490' : '#475569');
  fillRectHex(buf, S, S, 10, 10 + offset, 12, 12 - offset, pressed ? '#22d3ee' : '#64748b');
  // Rune glyph in center
  fillRectHex(buf, S, S, 14, 12 + offset, 4, 8 - offset, pressed ? '#fef08a' : '#1e293b');
  fillRectHex(buf, S, S, 12, 14 + offset, 8, 4 - offset, pressed ? '#fef08a' : '#1e293b');
  addCrispOutline(buf, S, S);
  return buf;
}

function buildCastleBanner(): Uint8Array {
  const W = 32;
  const H = 48;
  const buf = new Uint8Array(W * H * 4);
  // Gold hanging crossbar
  fillRectHex(buf, W, H, 4, 4, 24, 3, '#eab308');
  fillRectHex(buf, W, H, 3, 3, 3, 5, '#fef08a');
  fillRectHex(buf, W, H, 26, 3, 3, 5, '#fef08a');
  // Crimson tapered banner cloth with swallowtail notch
  for (let y = 7; y < 44; y++) {
    for (let x = 7; x < 25; x++) {
      if (y > 36 && Math.abs(x - 15.5) < (y - 36) * 1.1) continue;
      const isTrim = x === 7 || x === 24 || x === 8 || x === 23;
      if (isTrim) {
        putHex(buf, W, H, x, y, x === 8 || x === 23 ? '#d99a36' : '#7a1228');
      } else {
        const fold = Math.sin((x - 15.5) * 0.45) * 0.25 + 0.5;
        putOklabMix(buf, W, H, x, y, '#590d22', '#c9184a', fold);
      }
    }
  }
  // Golden crescent emblem
  for (let y = 14; y <= 28; y++) {
    for (let x = 10; x <= 21; x++) {
      const d1 = Math.hypot(x - 15.5, y - 21);
      const d2 = Math.hypot(x - 17.5, y - 20);
      if (d1 < 5.2 && d2 > 4.2) {
        putHex(buf, W, H, x, y, '#fde047');
      }
    }
  }
  addCrispOutline(buf, W, H);
  return buf;
}

function buildCastleSpikes(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  fillRectHex(buf, S, S, 3, 3, 26, 26, '#1a2033');
  const centers = [
    [9, 10], [22, 10], [15, 16], [9, 23], [22, 23],
  ] as const;
  for (const [cx, cy] of centers) {
    fillRectHex(buf, S, S, cx - 3, cy + 1, 7, 3, '#0b0e18');
    for (let dy = -6; dy <= 2; dy++) {
      const half = Math.max(0, Math.floor((dy + 7) * 0.35));
      for (let dx = -half; dx <= half; dx++) {
        const hi = dx <= 0;
        putHex(buf, S, S, cx + dx, cy + dy, dy < -3 ? '#f8fafc' : hi ? '#cbd5e1' : '#64748b');
      }
    }
  }
  return buf;
}

function buildCastleKey(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  // Ornate gothic key bow
  for (let y = 6; y <= 17; y++) {
    for (let x = 10; x <= 21; x++) {
      const r = Math.hypot(x - 15.5, y - 11.5);
      if (r >= 3.2 && r <= 5.6) {
        putHex(buf, S, S, x, y, y < 11 ? '#fef08a' : '#eab308');
      } else if (r < 2.2) {
        putHex(buf, S, S, x, y, '#ef4444');
      }
    }
  }
  // Key shaft & teeth
  fillRectHex(buf, S, S, 14, 16, 4, 12, '#eab308');
  fillRectHex(buf, S, S, 15, 16, 1, 12, '#fef08a');
  fillRectHex(buf, S, S, 18, 21, 5, 2, '#facc15');
  fillRectHex(buf, S, S, 18, 25, 4, 2, '#facc15');
  addCrispOutline(buf, S, S);
  return buf;
}

function buildCastleChalice(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  // Cup bowl filled with glowing crimson elixir
  fillRectHex(buf, S, S, 9, 8, 14, 3, '#ef4444');
  fillRectHex(buf, S, S, 11, 8, 6, 2, '#fca5a5');
  fillRectHex(buf, S, S, 9, 10, 14, 7, '#eab308');
  fillRectHex(buf, S, S, 11, 11, 4, 5, '#fef08a');
  fillRectHex(buf, S, S, 14, 17, 4, 7, '#ca8a04');
  fillRectHex(buf, S, S, 10, 24, 12, 3, '#eab308');
  addCrispOutline(buf, S, S);
  return buf;
}

function buildCastlePortalArch(): Uint8Array {
  const W = 32;
  const H = 48;
  const buf = new Uint8Array(W * H * 4);
  for (let y = 3; y < 46; y++) {
    for (let x = 2; x < 30; x++) {
      const dx = (x - 15.5) / 12.5;
      const dy = y < 18 ? (18 - y) / 14.5 : 0;
      const arch = Math.hypot(dx, dy);
      if (arch > 1.02) continue;
      if (arch > 0.72) {
        // Carved obsidian rune arch frame
        const lit = x < 16 ? '#5e7096' : '#323e5c';
        putHex(buf, W, H, x, y, (y % 6 === 0) ? '#f59e0b' : lit);
      } else {
        // Swirling golden-cyan dimensional vortex
        const vx = x - 15.5;
        const vy = y - 26;
        const dist = Math.hypot(vx, vy * 0.7);
        const swirl = Math.sin(dist * 0.65 + Math.atan2(vy, vx) * 2);
        putOklabMix(buf, W, H, x, y, '#1d4ed8', swirl > 0 ? '#fbbf24' : '#38bdf8', 0.65, 225);
      }
    }
  }
  addCrispOutline(buf, W, H);
  return buf;
}

// ============================================================================
// 4. 32x32 HERO KNIGHT, SLASH ARC, SENTINEL & EMBER ORB
// ============================================================================

function buildCastleHero(stepFrame: boolean): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  const legOff = stepFrame ? 2 : 0;

  // Flowing crimson royal cape behind shoulders
  fillRectHex(buf, S, S, 8, 12, 16, 13, '#881337');
  fillRectHex(buf, S, S, 9, 13, 14, 11, '#be123c');

  // Armored greaves / boots
  fillRectHex(buf, S, S, 10, 23 + (stepFrame ? 0 : 1), 4, 6, '#334155');
  fillRectHex(buf, S, S, 18, 23 + legOff, 4, 5, '#334155');

  // Silver breastplate & gold baldric
  fillRectHex(buf, S, S, 10, 13, 12, 11, '#94a3b8');
  fillRectHex(buf, S, S, 11, 14, 5, 9, '#e2e8f0');
  fillRectHex(buf, S, S, 10, 19, 12, 2, '#f59e0b');

  // Visored knight helm with crimson plume
  fillRectHex(buf, S, S, 13, 2, 6, 4, '#e11d48');
  fillRectHex(buf, S, S, 10, 5, 12, 9, '#cbd5e1');
  fillRectHex(buf, S, S, 11, 6, 5, 7, '#f8fafc');
  fillRectHex(buf, S, S, 11, 9, 10, 3, '#0f172a'); // Dark visor slit
  putHex(buf, S, S, 13, 10, '#38bdf8');
  putHex(buf, S, S, 18, 10, '#38bdf8');

  // Kite shield (left) & Gleaming greatsword (right)
  fillRectHex(buf, S, S, 6, 14, 5, 9, '#1e3a8a');
  fillRectHex(buf, S, S, 7, 15, 3, 7, '#3b82f6');
  fillRectHex(buf, S, S, 8, 16, 1, 5, '#fde047');

  fillRectHex(buf, S, S, 23, 8, 3, 13, '#e2e8f0');
  fillRectHex(buf, S, S, 24, 7, 1, 13, '#ffffff');
  fillRectHex(buf, S, S, 21, 19, 7, 2, '#f59e0b');
  fillRectHex(buf, S, S, 24, 21, 2, 3, '#78350f');

  addCrispOutline(buf, S, S);
  return buf;
}

function buildCastleSlashArc(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - 12;
      const dy = y - 16;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      if (r >= 8 && r <= 15.5 && Math.abs(ang) < 1.38) {
        const edge = 1 - Math.abs(r - 12.2) / 3.8;
        const a = Math.round(Math.max(0, Math.min(1, edge * 1.3)) * 255);
        if (r > 13.2) {
          putHex(buf, S, S, x, y, '#ffffff', a);
        } else if (r > 10.6) {
          putHex(buf, S, S, x, y, '#fde047', a);
        } else {
          putHex(buf, S, S, x, y, '#38bdf8', Math.round(a * 0.78));
        }
      }
    }
  }
  return buf;
}

function buildCastleSentinel(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  // Horned obsidian sentinel armor + crimson mantle + halberd
  fillRectHex(buf, S, S, 9, 11, 14, 15, '#27273a');
  fillRectHex(buf, S, S, 11, 12, 10, 12, '#3f3f5c');
  // Crimson pauldrons
  fillRectHex(buf, S, S, 6, 11, 5, 6, '#991b1b');
  fillRectHex(buf, S, S, 21, 11, 5, 6, '#991b1b');
  // Horned iron helm
  fillRectHex(buf, S, S, 11, 5, 10, 8, '#374151');
  fillRectHex(buf, S, S, 8, 3, 3, 5, '#cbd5e1');
  fillRectHex(buf, S, S, 21, 3, 3, 5, '#cbd5e1');
  // Glowing amber eyes
  fillRectHex(buf, S, S, 13, 8, 2, 2, '#fbbf24');
  fillRectHex(buf, S, S, 17, 8, 2, 2, '#fbbf24');
  // Boots
  fillRectHex(buf, S, S, 10, 25, 4, 4, '#181825');
  fillRectHex(buf, S, S, 18, 25, 4, 4, '#181825');
  // Halberd spear
  fillRectHex(buf, S, S, 26, 4, 2, 24, '#78350f');
  fillRectHex(buf, S, S, 24, 4, 6, 6, '#e2e8f0');
  fillRectHex(buf, S, S, 25, 5, 3, 4, '#dc2626');
  addCrispOutline(buf, S, S);
  return buf;
}

function buildCastleEmberOrb(): Uint8Array {
  const S = 32;
  const buf = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - 15.5, y - 15.5);
      if (r < 3.5) {
        putHex(buf, S, S, x, y, '#fffbeb');
      } else if (r < 6.8) {
        putHex(buf, S, S, x, y, '#fbbf24');
      } else if (r < 10.5) {
        putHex(buf, S, S, x, y, '#ea580c', 235);
      } else if (r < 13.5 && ((x + y) & 1) === 0) {
        putHex(buf, S, S, x, y, '#b91c1c', 160);
      }
    }
  }
  return buf;
}

// ============================================================================
// 5. 48x64 GRAND CENTERPIECES (DEMON THRONE & DEMON LORD MALAKOR)
// ============================================================================

function buildCastleThrone(): Uint8Array {
  const W = 48;
  const H = 64;
  const buf = new Uint8Array(W * H * 4);

  // Stepped obsidian dais platform at bottom
  fillRectHex(buf, W, H, 2, 52, 44, 10, '#1e2438');
  fillRectHex(buf, W, H, 4, 48, 40, 6, '#2e3754');
  fillRectHex(buf, W, H, 6, 46, 36, 3, '#47557a');
  fillRectHex(buf, W, H, 14, 52, 20, 10, '#881337'); // Crimson dais runner
  fillRectHex(buf, W, H, 15, 52, 2, 10, '#eab308');
  fillRectHex(buf, W, H, 31, 52, 2, 10, '#eab308');

  // Towering Gothic horned backrest spires
  fillRectHex(buf, W, H, 11, 10, 26, 38, '#1a1f30');
  fillRectHex(buf, W, H, 14, 12, 20, 34, '#6b1026'); // Velvet tapestry back
  fillRectHex(buf, W, H, 17, 15, 14, 28, '#9f1239');
  // Ornate horned side pillars
  fillRectHex(buf, W, H, 8, 8, 5, 40, '#36415e');
  fillRectHex(buf, W, H, 35, 8, 5, 40, '#36415e');
  fillRectHex(buf, W, H, 9, 4, 3, 6, '#5c6e96');
  fillRectHex(buf, W, H, 36, 4, 3, 6, '#5c6e96');
  // Central horned demon crown crest at apex
  fillRectHex(buf, W, H, 18, 4, 12, 8, '#3b4766');
  fillRectHex(buf, W, H, 22, 2, 4, 9, '#f59e0b');
  fillRectHex(buf, W, H, 20, 6, 8, 4, '#fbbf24');
  fillRectHex(buf, W, H, 23, 7, 2, 2, '#dc2626');
  // Glowing golden rune sigil on backrest
  for (let y = 18; y <= 30; y++) {
    for (let x = 18; x <= 29; x++) {
      const r = Math.hypot(x - 23.5, y - 24);
      if (Math.abs(r - 4.8) < 0.9 || (Math.abs(x - 23.5) < 0.8 && r < 5)) {
        putHex(buf, W, H, x, y, '#fde047');
      }
    }
  }
  // Throne seat & gold armrests
  fillRectHex(buf, W, H, 11, 36, 26, 10, '#9f1239');
  fillRectHex(buf, W, H, 13, 37, 22, 5, '#e11d48');
  fillRectHex(buf, W, H, 7, 31, 6, 14, '#475578');
  fillRectHex(buf, W, H, 35, 31, 6, 14, '#475578');
  fillRectHex(buf, W, H, 7, 30, 6, 3, '#eab308');
  fillRectHex(buf, W, H, 35, 30, 6, 3, '#eab308');

  addCrispOutline(buf, W, H);
  return buf;
}

function buildCastleDemonLord(): Uint8Array {
  const W = 48;
  const H = 64;
  const buf = new Uint8Array(W * H * 4);

  // Sweeping tattered crimson sovereign cape
  for (let y = 18; y < 58; y++) {
    const spread = Math.round(12 + (y - 18) * 0.28);
    for (let x = 24 - spread; x <= 23 + spread; x++) {
      if (y > 52 && ((x + y) & 3) === 0) continue; // Tattered hem
      const fold = Math.sin((x - 24) * 0.35) * 0.28 + 0.5;
      putOklabMix(buf, W, H, x, y, '#450a18', '#b91c1c', fold);
    }
  }

  // Towering curved obsidian horns
  for (let i = 0; i < 14; i++) {
    const lx = Math.round(17 - i * 0.72);
    const rx = Math.round(30 + i * 0.72);
    const hy = Math.round(14 - i * 0.8 + Math.sin(i * 0.2) * 1.5);
    const thick = Math.max(2, 4 - Math.floor(i / 4));
    fillRectHex(buf, W, H, lx, hy, thick, thick, i > 9 ? '#f59e0b' : '#475569');
    fillRectHex(buf, W, H, rx, hy, thick, thick, i > 9 ? '#f59e0b' : '#475569');
  }

  // Heavy obsidian-and-gold demon armor torso
  fillRectHex(buf, W, H, 14, 21, 20, 23, '#1e2236');
  fillRectHex(buf, W, H, 16, 22, 16, 18, '#313854');
  // Spiked gothic pauldrons
  fillRectHex(buf, W, H, 8, 19, 9, 10, '#2a304a');
  fillRectHex(buf, W, H, 31, 19, 9, 10, '#2a304a');
  fillRectHex(buf, W, H, 8, 19, 9, 2, '#f59e0b');
  fillRectHex(buf, W, H, 31, 19, 9, 2, '#f59e0b');
  // Glowing crimson core crystal in chestplate
  fillRectHex(buf, W, H, 21, 26, 6, 8, '#dc2626');
  fillRectHex(buf, W, H, 22, 27, 4, 6, '#fbbf24');
  fillRectHex(buf, W, H, 23, 28, 2, 3, '#fffbeb');

  // Crowned shadow helm with blazing ember eyes
  fillRectHex(buf, W, H, 17, 10, 14, 12, '#1e2438');
  fillRectHex(buf, W, H, 19, 9, 10, 3, '#f59e0b');
  fillRectHex(buf, W, H, 19, 14, 10, 4, '#090a12');
  fillRectHex(buf, W, H, 20, 15, 3, 2, '#fbbf24');
  fillRectHex(buf, W, H, 25, 15, 3, 2, '#fbbf24');
  putHex(buf, W, H, 21, 15, '#ffffff');
  putHex(buf, W, H, 26, 15, '#ffffff');

  // Armored legs & sabatons
  fillRectHex(buf, W, H, 16, 44, 6, 15, '#262d45');
  fillRectHex(buf, W, H, 26, 44, 6, 15, '#262d45');
  fillRectHex(buf, W, H, 15, 55, 8, 5, '#475569');
  fillRectHex(buf, W, H, 25, 55, 8, 5, '#475569');

  // Colossal runed crimson greatsword held on right
  fillRectHex(buf, W, H, 38, 12, 5, 36, '#334155');
  fillRectHex(buf, W, H, 40, 10, 2, 36, '#ef4444');
  fillRectHex(buf, W, H, 40, 15, 1, 28, '#fde047');
  fillRectHex(buf, W, H, 35, 45, 11, 3, '#f59e0b');
  fillRectHex(buf, W, H, 39, 48, 3, 8, '#78350f');

  addCrispOutline(buf, W, H);
  return buf;
}

let cachedCastleSprites: readonly CastleSpriteAsset[] | null = null;

export function buildCastleSprites(): readonly CastleSpriteAsset[] {
  if (cachedCastleSprites) return cachedCastleSprites;
  cachedCastleSprites = [
    { id: 'castle_floor_stone', width: 32, height: 32, rgba: buildCastleFloorStone(false) },
    { id: 'castle_floor_moss', width: 32, height: 32, rgba: buildCastleFloorStone(true) },
    { id: 'castle_floor_carpet', width: 32, height: 32, rgba: buildCastleCarpet(false) },
    { id: 'castle_floor_carpet_h', width: 32, height: 32, rgba: buildCastleCarpet(true) },
    { id: 'castle_floor_grate', width: 32, height: 32, rgba: buildCastleGrate() },
    { id: 'castle_floor_seal', width: 32, height: 32, rgba: buildCastleSeal() },
    { id: 'castle_floor_lava', width: 32, height: 32, rgba: buildCastleLava() },
    { id: 'castle_floor_stairs', width: 32, height: 32, rgba: buildCastleStairs() },
    { id: 'castle_wall_top', width: 32, height: 32, rgba: buildCastleWallTop() },
    { id: 'castle_wall_brick', width: 32, height: 32, rgba: buildCastleWallBrick() },
    { id: 'castle_wall_window', width: 32, height: 32, rgba: buildCastleWallWindow() },
    { id: 'castle_gate_iron', width: 32, height: 32, rgba: buildCastleGate(false) },
    { id: 'castle_gate_open', width: 32, height: 32, rgba: buildCastleGate(true) },
    { id: 'castle_pillar_tall', width: 32, height: 48, rgba: buildCastlePillarTall() },
    { id: 'castle_torch_brazier', width: 32, height: 32, rgba: buildCastleBrazier() },
    { id: 'castle_chest_closed', width: 32, height: 32, rgba: buildCastleChest(false) },
    { id: 'castle_chest_open', width: 32, height: 32, rgba: buildCastleChest(true) },
    { id: 'castle_switch_off', width: 32, height: 32, rgba: buildCastleSwitch(false) },
    { id: 'castle_switch_on', width: 32, height: 32, rgba: buildCastleSwitch(true) },
    { id: 'castle_banner_crimson', width: 32, height: 48, rgba: buildCastleBanner() },
    { id: 'castle_spikes', width: 32, height: 32, rgba: buildCastleSpikes() },
    { id: 'castle_key_gold', width: 32, height: 32, rgba: buildCastleKey() },
    { id: 'castle_chalice', width: 32, height: 32, rgba: buildCastleChalice() },
    { id: 'castle_portal_arch', width: 32, height: 48, rgba: buildCastlePortalArch() },
    { id: 'castle_hero_a', width: 32, height: 32, rgba: buildCastleHero(false) },
    { id: 'castle_hero_b', width: 32, height: 32, rgba: buildCastleHero(true) },
    { id: 'castle_slash_arc', width: 32, height: 32, rgba: buildCastleSlashArc() },
    { id: 'castle_sentinel', width: 32, height: 32, rgba: buildCastleSentinel() },
    { id: 'castle_ember_orb', width: 32, height: 32, rgba: buildCastleEmberOrb() },
    { id: 'castle_throne', width: 48, height: 64, rgba: buildCastleThrone() },
    { id: 'castle_demon_lord', width: 48, height: 64, rgba: buildCastleDemonLord() },
  ];
  return cachedCastleSprites;
}
