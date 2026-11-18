export type Vec2Target = Float32Array | Float64Array | number[];

// Standard 2D Simplex constants: F2 = (sqrt(3) - 1) / 2, G2 = (3 - sqrt(3)) / 6
const F2 = 0.3660254037844386;
const G2 = 0.21132486540518713;
const SQRT1_2 = Math.SQRT1_2;

// 8 canonical unit-length radial gradients (zero directional bias, L2 norm = 1)
const GRAD2_X = new Float64Array([1, SQRT1_2, 0, -SQRT1_2, -1, -SQRT1_2, 0, SQRT1_2]);
const GRAD2_Y = new Float64Array([0, SQRT1_2, 1, SQRT1_2, 0, -SQRT1_2, -1, -SQRT1_2]);

// Deterministic Fisher-Yates shuffled permutation table (doubled to 512 for branchless wrap)
const PERM = new Uint8Array(512);
(() => {
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  let s = 0x9e3779b9;
  for (let i = 255; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
    s = (s + 0x6d2b79f5) >>> 0;
    const j = s % (i + 1);
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = base[i & 255];
})();

// Exact normalization so edge-midpoint double contribution (~0.010073) stays cleanly within [-1, 1]
const NORM_2D = 98.5;

function finiteOr(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Branchless deterministic 2D integer hash returning [0, 1).
 * Matches xxHash32-style avalanche used in GPU shaders.
 */
export function hash2i(ix: number, iy: number, seed = 0): number {
  let h =
    (Math.imul(ix | 0, 374761393) +
      Math.imul(iy | 0, 668265263) +
      Math.imul((seed | 0) ^ 0x517cc1b7, 1597334677)) >>>
    0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0x00ffffff) / 16777216;
}

/**
 * Evaluates 2D Simplex Noise at (x, y) and writes analytical spatial derivatives [dx, dy]
 * into caller-provided `out` at [offset, offset + 1]. Strictly zero-GC and bounded [-1, 1].
 */
export function simplex2DGradInto(
  x: number,
  y: number,
  out: Vec2Target,
  offset = 0,
  scale = 1,
  seed = 0,
): number {
  const sc = finiteOr(scale, 1);
  const sx = finiteOr(x, 0) * sc;
  const sy = finiteOr(y, 0) * sc;

  const skew = (sx + sy) * F2;
  const i = Math.floor(sx + skew);
  const j = Math.floor(sy + skew);

  const unskew = (i + j) * G2;
  const x0 = sx - (i - unskew);
  const y0 = sy - (j - unskew);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = 1 - i1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const s1 = seed & 255;
  const s2 = ((seed >>> 8) ^ (seed * 31)) & 255;
  const ii = i & 255;
  const jj = j & 255;

  const g0 = PERM[(ii ^ s1) + PERM[jj ^ s2]] & 7;
  const g1 = PERM[((ii + i1) & 255 ^ s1) + PERM[((jj + j1) & 255) ^ s2]] & 7;
  const g2 = PERM[((ii + 1) & 255 ^ s1) + PERM[((jj + 1) & 255) ^ s2]] & 7;

  let val = 0;
  let dux = 0;
  let duy = 0;

  const t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const gx0 = GRAD2_X[g0];
    const gy0 = GRAD2_Y[g0];
    const t02 = t0 * t0;
    const t03 = t02 * t0;
    const t04 = t02 * t02;
    const dot0 = gx0 * x0 + gy0 * y0;
    val += t04 * dot0;
    dux += t04 * gx0 - 8 * x0 * t03 * dot0;
    duy += t04 * gy0 - 8 * y0 * t03 * dot0;
  }

  const t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const gx1 = GRAD2_X[g1];
    const gy1 = GRAD2_Y[g1];
    const t12 = t1 * t1;
    const t13 = t12 * t1;
    const t14 = t12 * t12;
    const dot1 = gx1 * x1 + gy1 * y1;
    val += t14 * dot1;
    dux += t14 * gx1 - 8 * x1 * t13 * dot1;
    duy += t14 * gy1 - 8 * y1 * t13 * dot1;
  }

  const t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const gx2 = GRAD2_X[g2];
    const gy2 = GRAD2_Y[g2];
    const t22 = t2 * t2;
    const t23 = t22 * t2;
    const t24 = t22 * t22;
    const dot2 = gx2 * x2 + gy2 * y2;
    val += t24 * dot2;
    dux += t24 * gx2 - 8 * x2 * t23 * dot2;
    duy += t24 * gy2 - 8 * y2 * t23 * dot2;
  }

  const scaled = val * NORM_2D;
  const clamped = scaled < -1 ? -1 : scaled > 1 ? 1 : scaled;
  const dScale = NORM_2D * sc;
  out[offset] = dux * dScale;
  out[offset + 1] = duy * dScale;
  return clamped;
}

/** Evaluates zero-GC 2D Simplex Noise strictly in [-1, 1]. */
export function simplex2D(x: number, y: number, seed = 0): number {
  const sx = finiteOr(x, 0);
  const sy = finiteOr(y, 0);

  const skew = (sx + sy) * F2;
  const i = Math.floor(sx + skew);
  const j = Math.floor(sy + skew);

  const unskew = (i + j) * G2;
  const x0 = sx - (i - unskew);
  const y0 = sy - (j - unskew);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = 1 - i1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const s1 = seed & 255;
  const s2 = ((seed >>> 8) ^ (seed * 31)) & 255;
  const ii = i & 255;
  const jj = j & 255;

  let n = 0;

  const t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g0 = PERM[(ii ^ s1) + PERM[jj ^ s2]] & 7;
    const t02 = t0 * t0;
    n += t02 * t02 * (GRAD2_X[g0] * x0 + GRAD2_Y[g0] * y0);
  }

  const t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g1 = PERM[((ii + i1) & 255 ^ s1) + PERM[((jj + j1) & 255) ^ s2]] & 7;
    const t12 = t1 * t1;
    n += t12 * t12 * (GRAD2_X[g1] * x1 + GRAD2_Y[g1] * y1);
  }

  const t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g2 = PERM[((ii + 1) & 255 ^ s1) + PERM[((jj + 1) & 255) ^ s2]] & 7;
    const t22 = t2 * t2;
    n += t22 * t22 * (GRAD2_X[g2] * x2 + GRAD2_Y[g2] * y2);
  }

  const out = n * NORM_2D;
  return out < -1 ? -1 : out > 1 ? 1 : out;
}

/**
 * Multi-octave Fractal Brownian Motion (FBM) using normalized 2D Simplex octaves.
 * Output stays strictly normalized in [-1, 1] with zero allocations.
 */
export function fbm2D(
  x: number,
  y: number,
  octaves = 3,
  lacunarity = 2.02,
  gain = 0.5,
  seed = 0,
): number {
  const count = Math.max(1, Math.min(8, Math.floor(finiteOr(octaves, 3))));
  const lac = Math.max(1.0, finiteOr(lacunarity, 2.02));
  const g = Math.max(0.05, Math.min(0.95, finiteOr(gain, 0.5)));

  let freq = 1;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let px = finiteOr(x, 0);
  let py = finiteOr(y, 0);

  for (let o = 0; o < count; o++) {
    sum += amp * simplex2D(px * freq, py * freq, seed + o * 101);
    norm += amp;
    freq *= lac;
    amp *= g;
    // Domain twist per octave suppresses lattice aliasing cleanly
    px += 13.7;
    py -= 9.3;
  }

  const out = norm > 0 ? sum / norm : 0;
  return out < -1 ? -1 : out > 1 ? 1 : out;
}

const CURL_GRAD_SCRATCH = new Float64Array(2);

/**
 * Divergence-free 2D Curl Noise field computed via analytical Simplex derivatives:
 * curl(psi) = (dpsi/dy, -dpsi/dx). Ideal for wind vortices, stardust turbulence, & wisps.
 */
export function curlNoise2DInto(
  x: number,
  y: number,
  out: Vec2Target,
  offset = 0,
  scale = 1,
  seed = 0,
): Vec2Target {
  simplex2DGradInto(x, y, CURL_GRAD_SCRATCH, 0, scale, seed);
  out[offset] = CURL_GRAD_SCRATCH[1];
  out[offset + 1] = -CURL_GRAD_SCRATCH[0];
  return out;
}
