export type ColorVec3Target = Float32Array | number[];

export interface HueShiftRampOptions {
  /** Target hue (radians) when shading into shadows. Default ~265 deg (violet-indigo). */
  darkHueTargetRad?: number;
  /** Target hue (radians) when shifting into highlights. Default ~88 deg (sunlight cream). */
  lightHueTargetRad?: number;
  /** Max hue rotation blend factor toward target hues [0..1]. Default 0.55. */
  hueShiftStrength?: number;
  /** Lightness span across the ramp [0.15..0.92]. Default 0.62. */
  lightnessSpan?: number;
}

const INV_255 = 1 / 255;
const TAU = Math.PI * 2;
const DEFAULT_DARK_HUE_RAD = (265 * Math.PI) / 180;
const DEFAULT_LIGHT_HUE_RAD = (88 * Math.PI) / 180;

function clamp01Finite(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function finiteOr(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

function shortestAngleDiffRad(fromRad: number, toRad: number): number {
  let diff = (toRad - fromRad) % TAU;
  if (diff > Math.PI) diff -= TAU;
  else if (diff < -Math.PI) diff += TAU;
  return diff;
}

/** Exact IEC 61966-2-1 sRGB [0..1] -> Linear RGB [0..1]. */
export function srgbToLinear(c: number): number {
  const s = clamp01Finite(c);
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearUnitToSrgb(lin: number): number {
  return lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
}

/** Exact IEC 61966-2-1 Linear RGB [0..1] -> sRGB [0..1]. */
export function linearToSrgb(c: number): number {
  return linearUnitToSrgb(clamp01Finite(c));
}

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

/** Monomorphic Float32Array store helper to prevent V8 polymorphic HeapNumber boxing. */
function writeVec3(
  out: ColorVec3Target,
  offset: number,
  c0: number,
  c1: number,
  c2: number,
): ColorVec3Target {
  if (out instanceof Float32Array) {
    out[offset] = c0;
    out[offset + 1] = c1;
    out[offset + 2] = c2;
  } else {
    out[offset] = c0;
    out[offset + 1] = c1;
    out[offset + 2] = c2;
  }
  return out;
}

/** Zero-GC hex parser (#rrggbb or #rgb) into normalized sRGB [0..1]. */
export function hexToRgb01Into(hex: string, out: ColorVec3Target, offset = 0): void {
  const rawLen = typeof hex === 'string' ? hex.length : 0;
  const start = rawLen > 0 && hex.charCodeAt(0) === 35 ? 1 : 0; // '#'
  const len = rawLen - start;
  if (len === 6) {
    const n0 = hexNibble(hex.charCodeAt(start));
    const n1 = hexNibble(hex.charCodeAt(start + 1));
    const n2 = hexNibble(hex.charCodeAt(start + 2));
    const n3 = hexNibble(hex.charCodeAt(start + 3));
    const n4 = hexNibble(hex.charCodeAt(start + 4));
    const n5 = hexNibble(hex.charCodeAt(start + 5));
    if ((n0 | n1 | n2 | n3 | n4 | n5) >= 0) {
      writeVec3(out, offset, ((n0 << 4) | n1) * INV_255, ((n2 << 4) | n3) * INV_255, ((n4 << 4) | n5) * INV_255);
      return;
    }
  } else if (len === 3) {
    const r = hexNibble(hex.charCodeAt(start));
    const g = hexNibble(hex.charCodeAt(start + 1));
    const b = hexNibble(hex.charCodeAt(start + 2));
    if ((r | g | b) >= 0) {
      writeVec3(out, offset, r * 17 * INV_255, g * 17 * INV_255, b * 17 * INV_255);
      return;
    }
  }
  writeVec3(out, offset, 1, 1, 1);
}

function byteToHex2(v: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(v)));
  return clamped < 16 ? `0${clamped.toString(16)}` : clamped.toString(16);
}

/** Converts sRGB [0..1] channels to lowercase #rrggbb hex string. */
export function rgb01ToHex(r: number, g: number, b: number): string {
  const rb = byteToHex2(clamp01Finite(r) * 255);
  const gb = byteToHex2(clamp01Finite(g) * 255);
  const bb = byteToHex2(clamp01Finite(b) * 255);
  return `#${rb}${gb}${bb}`;
}

/**
 * Björn Ottosson linear sRGB -> perceptual Oklab (L, a, b).
 * Writes into caller buffer cleanly with zero heap allocations.
 */
export function linearRgbToOklab(
  r: number,
  g: number,
  b: number,
  out: ColorVec3Target = [0, 0, 0],
  offset = 0,
): ColorVec3Target {
  const lr = Math.max(0, finiteOr(r, 0));
  const lg = Math.max(0, finiteOr(g, 0));
  const lb = Math.max(0, finiteOr(b, 0));

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(Math.max(0, l));
  const m_ = Math.cbrt(Math.max(0, m));
  const s_ = Math.cbrt(Math.max(0, s));

  return writeVec3(
    out,
    offset,
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  );
}

/**
 * Raw Björn Ottosson Oklab -> linear sRGB inverse transform (preserves exact differential parity).
 */
export function oklabToLinearRgb(
  L: number,
  a: number,
  b: number,
  out: ColorVec3Target = [0, 0, 0],
  offset = 0,
): ColorVec3Target {
  const fL = finiteOr(L, 0);
  const fa = finiteOr(a, 0);
  const fb = finiteOr(b, 0);

  const l_ = fL + 0.3963377774 * fa + 0.2158037573 * fb;
  const m_ = fL - 0.1055613458 * fa - 0.0638541728 * fb;
  const s_ = fL - 0.0894841775 * fa - 1.2914855480 * fb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return writeVec3(
    out,
    offset,
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  );
}

function writeRgbOutput(
  out: ColorVec3Target,
  offset: number,
  r: number,
  g: number,
  b: number,
  toSrgb: boolean,
): ColorVec3Target {
  return toSrgb
    ? writeVec3(out, offset, linearUnitToSrgb(r), linearUnitToSrgb(g), linearUnitToSrgb(b))
    : writeVec3(out, offset, r, g, b);
}

function bisectGamutMappedRgb(
  L: number,
  a: number,
  b: number,
  toSrgb: boolean,
  out: ColorVec3Target,
  offset: number,
): ColorVec3Target {
  const fL = clamp01Finite(L);
  if (fL <= 1e-6) return writeVec3(out, offset, 0, 0, 0);
  if (fL >= 1 - 1e-6) return writeVec3(out, offset, 1, 1, 1);

  const fa = finiteOr(a, 0);
  const fb = finiteOr(b, 0);
  const maxC = Math.max(Math.abs(fa), Math.abs(fb));
  // Normalize extreme chroma and tighten hi to the LMS [0, 1]^3 boundary so bisection never collapses to 0 gray
  const norm = maxC > 1 ? 1 / maxC : 1;
  const ua = fa * norm;
  const ub = fb * norm;
  const dl = 0.3963377774 * ua + 0.2158037573 * ub;
  const dm = -0.1055613458 * ua - 0.0638541728 * ub;
  const ds = -0.0894841775 * ua - 1.2914855480 * ub;

  let hi = maxC > 1 ? maxC : 1;
  const hiPad = 1e-5;
  if (dl > 1e-12) hi = Math.min(hi, (1 + hiPad - fL) / dl);
  else if (dl < -1e-12) hi = Math.min(hi, (fL + hiPad) / -dl);
  if (dm > 1e-12) hi = Math.min(hi, (1 + hiPad - fL) / dm);
  else if (dm < -1e-12) hi = Math.min(hi, (fL + hiPad) / -dm);
  if (ds > 1e-12) hi = Math.min(hi, (1 + hiPad - fL) / ds);
  else if (ds < -1e-12) hi = Math.min(hi, (fL + hiPad) / -ds);

  let lo = 0;
  const grayLin = fL * fL * fL;
  let bestR = grayLin;
  let bestG = grayLin;
  let bestB = grayLin;

  for (let iter = 0; iter < 18; iter++) {
    const scale = 0.5 * (lo + hi);
    const ca = ua * scale;
    const cb = ub * scale;
    const l_ = fL + 0.3963377774 * ca + 0.2158037573 * cb;
    const m_ = fL - 0.1055613458 * ca - 0.0638541728 * cb;
    const s_ = fL - 0.0894841775 * ca - 1.2914855480 * cb;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    if (r >= 0 && r <= 1 && g >= 0 && g <= 1 && bl >= 0 && bl <= 1) {
      lo = scale;
      bestR = r;
      bestG = g;
      bestB = bl;
    } else {
      hi = scale;
    }
  }

  return writeRgbOutput(
    out,
    offset,
    clamp01Finite(bestR),
    clamp01Finite(bestG),
    clamp01Finite(bestB),
    toSrgb,
  );
}

function writeGamutMappedSrgb(
  L: number,
  a: number,
  b: number,
  out: ColorVec3Target,
  offset: number,
): ColorVec3Target {
  if (L > 1e-6 && L < 1 - 1e-6) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    if (r >= 0 && r <= 1 && g >= 0 && g <= 1 && bl >= 0 && bl <= 1) {
      return writeVec3(out, offset, linearUnitToSrgb(r), linearUnitToSrgb(g), linearUnitToSrgb(bl));
    }
  }
  return bisectGamutMappedRgb(L, a, b, true, out, offset);
}

/**
 * Maps Oklab -> in-gamut linear sRGB [0..1]^3 by scaling chroma proportionally along constant (L, h)
 * whenever needed, preventing hue drift and preserving monotonic lightness L.
 */
export function oklabToLinearRgbGamut(
  L: number,
  a: number,
  b: number,
  out: ColorVec3Target = [0, 0, 0],
  offset = 0,
): ColorVec3Target {
  if (L > 1e-6 && L < 1 - 1e-6 && a >= -1 && a <= 1 && b >= -1 && b <= 1) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    if (r >= 0 && r <= 1 && g >= 0 && g <= 1 && bl >= 0 && bl <= 1) {
      return writeVec3(out, offset, r, g, bl);
    }
  }
  return bisectGamutMappedRgb(L, a, b, false, out, offset);
}

/** Converts Oklab (L, a, b) -> cylindrical Oklch (L, C >= 0, hRad in [-pi, pi]). */
export function oklabToOklch(
  L: number,
  a: number,
  b: number,
  out: ColorVec3Target = [0, 0, 0],
  offset = 0,
): ColorVec3Target {
  const fL = finiteOr(L, 0);
  const fa = finiteOr(a, 0);
  const fb = finiteOr(b, 0);
  const C = Math.hypot(fa, fb);
  return writeVec3(out, offset, fL, C, C < 1e-6 ? 0 : Math.atan2(fb, fa));
}

/** Converts cylindrical Oklch (L, C, hRad) -> Cartesian Oklab (L, a, b). */
export function oklchToOklab(
  L: number,
  C: number,
  hRad: number,
  out: ColorVec3Target = [0, 0, 0],
  offset = 0,
): ColorVec3Target {
  const fL = finiteOr(L, 0);
  const fC = Math.max(0, finiteOr(C, 0));
  const fh = finiteOr(hRad, 0);
  return writeVec3(out, offset, fL, fC * Math.cos(fh), fC * Math.sin(fh));
}

let mixCacheR0 = Number.NaN;
let mixCacheG0 = 0;
let mixCacheB0 = 0;
let mixCacheR1 = Number.NaN;
let mixCacheG1 = 0;
let mixCacheB1 = 0;
let mixL0 = 0;
let mixDL = 0;
let mixA0 = 0;
let mixDA = 0;
let mixB0 = 0;
let mixDB = 0;

function updateMixEndpointsOklab(
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number,
): void {
  mixCacheR0 = r0;
  mixCacheG0 = g0;
  mixCacheB0 = b0;
  mixCacheR1 = r1;
  mixCacheG1 = g1;
  mixCacheB1 = b1;

  const lr0 = srgbToLinear(r0);
  const lg0 = srgbToLinear(g0);
  const lb0 = srgbToLinear(b0);
  const l0 = Math.cbrt(Math.max(0, 0.4122214708 * lr0 + 0.5363325363 * lg0 + 0.0514459929 * lb0));
  const m0 = Math.cbrt(Math.max(0, 0.2119034982 * lr0 + 0.6806995451 * lg0 + 0.1073969566 * lb0));
  const s0 = Math.cbrt(Math.max(0, 0.0883024619 * lr0 + 0.2817188376 * lg0 + 0.6299787005 * lb0));
  mixL0 = 0.2104542553 * l0 + 0.7936177850 * m0 - 0.0040720468 * s0;
  mixA0 = 1.9779984951 * l0 - 2.4285922050 * m0 + 0.4505937099 * s0;
  mixB0 = 0.0259040371 * l0 + 0.7827717662 * m0 - 0.8086757660 * s0;

  const lr1 = srgbToLinear(r1);
  const lg1 = srgbToLinear(g1);
  const lb1 = srgbToLinear(b1);
  const l1 = Math.cbrt(Math.max(0, 0.4122214708 * lr1 + 0.5363325363 * lg1 + 0.0514459929 * lb1));
  const m1 = Math.cbrt(Math.max(0, 0.2119034982 * lr1 + 0.6806995451 * lg1 + 0.1073969566 * lb1));
  const s1 = Math.cbrt(Math.max(0, 0.0883024619 * lr1 + 0.2817188376 * lg1 + 0.6299787005 * lb1));
  mixDL = 0.2104542553 * l1 + 0.7936177850 * m1 - 0.0040720468 * s1 - mixL0;
  mixDA = 1.9779984951 * l1 - 2.4285922050 * m1 + 0.4505937099 * s1 - mixA0;
  mixDB = 0.0259040371 * l1 + 0.7827717662 * m1 - 0.8086757660 * s1 - mixB0;
}

/**
 * Perceptually blends two sRGB [0..1] colors through Linear -> Oklab -> Linear -> sRGB.
 * Zero heap allocations when `out` is pre-allocated; prevents muddy sRGB gray bands.
 */
export function mixOklabRgb01(
  r0: number,
  g0: number,
  b0: number,
  r1: number,
  g1: number,
  b1: number,
  t: number,
  out: ColorVec3Target = [0, 0, 0],
  offset = 0,
): ColorVec3Target {
  if (
    r0 !== mixCacheR0 ||
    g0 !== mixCacheG0 ||
    b0 !== mixCacheB0 ||
    r1 !== mixCacheR1 ||
    g1 !== mixCacheG1 ||
    b1 !== mixCacheB1
  ) {
    updateMixEndpointsOklab(r0, g0, b0, r1, g1, b1);
  }
  const wt = t <= 0 ? 0 : t >= 1 ? 1 : t === t ? t : 0;
  return writeGamutMappedSrgb(
    mixL0 + mixDL * wt,
    mixA0 + mixDA * wt,
    mixB0 + mixDB * wt,
    out,
    offset,
  );
}

const RAMP_SCRATCH = new Float32Array(3);

/**
 * Generates a pixel-art Hue-Shifted RGBA8 color ramp from deepest shadow (step 0)
 * to crisp highlight (step steps - 1), keeping Oklab Lightness L strictly monotonic.
 */
export function buildHueShiftedRamp(
  baseHex: string,
  steps: number,
  outRgba: Uint8Array,
  opts?: HueShiftRampOptions,
): Uint8Array {
  const safeSteps = Math.max(2, Math.floor(finiteOr(steps, 4)));
  const maxWritable = Math.min(safeSteps, Math.floor(outRgba.length / 4));
  if (maxWritable <= 0) return outRgba;

  hexToRgb01Into(baseHex, RAMP_SCRATCH, 0);
  linearRgbToOklab(
    srgbToLinear(RAMP_SCRATCH[0]),
    srgbToLinear(RAMP_SCRATCH[1]),
    srgbToLinear(RAMP_SCRATCH[2]),
    RAMP_SCRATCH,
    0,
  );
  const baseL = clamp01Finite(RAMP_SCRATCH[0]);
  const baseA = RAMP_SCRATCH[1];
  const baseB = RAMP_SCRATCH[2];
  const baseC = Math.hypot(baseA, baseB);
  const baseH = baseC < 1e-4 ? DEFAULT_LIGHT_HUE_RAD : Math.atan2(baseB, baseA);

  const darkHue = opts?.darkHueTargetRad ?? DEFAULT_DARK_HUE_RAD;
  const lightHue = opts?.lightHueTargetRad ?? DEFAULT_LIGHT_HUE_RAD;
  const shiftStrength = Math.max(0, Math.min(1, opts?.hueShiftStrength ?? 0.55));
  const span = Math.max(0.2, Math.min(0.86, opts?.lightnessSpan ?? 0.62));

  let minL = Math.max(0.12, baseL - span * 0.56);
  let maxL = Math.min(0.95, baseL + span * 0.44);
  if (maxL - minL < 0.24) {
    const mid = Math.max(0.24, Math.min(0.82, baseL));
    minL = Math.max(0.08, mid - 0.16);
    maxL = Math.min(0.96, mid + 0.16);
  }

  const midIdx = (maxWritable - 1) * 0.5;
  for (let i = 0; i < maxWritable; i++) {
    const t = maxWritable === 1 ? 0.5 : i / (maxWritable - 1);
    const L = minL + (maxL - minL) * t;
    const rel = midIdx > 0 ? (i - midIdx) / midIdx : 0; // [-1 shadow .. +1 highlight]

    let h = baseH;
    let cScale = 1;
    if (rel < 0) {
      const darkAmt = -rel;
      h = baseH + shortestAngleDiffRad(baseH, darkHue) * darkAmt * shiftStrength;
      cScale = 1 - 0.35 * darkAmt + 0.12 * darkAmt * shiftStrength;
    } else if (rel > 0) {
      h = baseH + shortestAngleDiffRad(baseH, lightHue) * rel * shiftStrength;
      cScale = 1 - 0.25 * rel;
    }

    // Subtle cool shadow boost for near-achromatic base tones so darks stay painterly
    const effC = baseC < 0.015 ? (rel < 0 ? 0.025 * -rel : 0.015 * rel) : baseC * Math.max(0.35, cScale);
    const ca = effC * Math.cos(h);
    const cb = effC * Math.sin(h);

    oklabToLinearRgbGamut(L, ca, cb, RAMP_SCRATCH, 0);
    const dst = i * 4;
    outRgba[dst] = Math.round(linearToSrgb(RAMP_SCRATCH[0]) * 255);
    outRgba[dst + 1] = Math.round(linearToSrgb(RAMP_SCRATCH[1]) * 255);
    outRgba[dst + 2] = Math.round(linearToSrgb(RAMP_SCRATCH[2]) * 255);
    outRgba[dst + 3] = 255;
  }

  return outRgba;
}
