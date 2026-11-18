export const GAME_W = 320;
export const GAME_H = 180;
export const OVERSCAN_PAD = 1;
export const OVERSCAN_W = GAME_W + OVERSCAN_PAD * 2;
export const OVERSCAN_H = GAME_H + OVERSCAN_PAD * 2;
export const FLOATS_PER_INSTANCE = 20;
export const MAX_INSTANCES_PER_PASS = 16384;

export interface LogicalViewport {
  width: number;
  height: number;
}

export type ViewportPreset = 'classic' | 'wide' | 'hd';

export const VIEWPORT_PRESETS: Record<ViewportPreset, LogicalViewport> = {
  classic: { width: 320, height: 180 },
  wide: { width: 426, height: 240 },
  hd: { width: 480, height: 270 },
};

export function resolveLogicalViewport(
  raw?: ViewportPreset | Partial<LogicalViewport> | null,
): LogicalViewport {
  if (!raw) return VIEWPORT_PRESETS.classic;
  if (typeof raw === 'string') return VIEWPORT_PRESETS[raw] ?? VIEWPORT_PRESETS.classic;
  const w = typeof raw.width === 'number' && Number.isFinite(raw.width) ? Math.max(160, Math.min(640, Math.round(raw.width))) : GAME_W;
  const h = typeof raw.height === 'number' && Number.isFinite(raw.height) ? Math.max(120, Math.min(360, Math.round(raw.height))) : GAME_H;
  return { width: w, height: h };
}

export type GpuBackendKind = 'webgpu' | 'webgl2' | 'canvas2d' | 'initializing';
export type RenderPerformanceProfile = 'eco' | 'balanced' | 'quality';
export type ResolutionScaleFactor = 1 | 2 | 3;

export function normalizePerformanceProfile(raw: string | null | undefined): RenderPerformanceProfile {
  if (raw === 'eco' || raw === 'balanced' || raw === 'quality') return raw;
  return 'balanced';
}

export interface SpriteRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
}

export interface BatchDrawItem {
  x: number;
  y: number;
  w: number;
  h: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  r: number;
  g: number;
  b: number;
  a: number;
  rot: number;
  mode: number; // 0 = sprite, 1 = radial light/star glint, 2 = solid/rounded quad, 3 = elliptical shadow, 4 = beveled wall material, 5 = smooth gradient/vignette
  flash?: number; // 0..1 white hit-flash
  param?: number; // extra per-mode shader parameter (Mode 0: emissive boost)
  pivotX?: number;
  pivotY?: number;
  skewX?: number;
  paletteRow?: number;
  additive: boolean;
}

export interface SkyGradient {
  top: [number, number, number];
  bottom: [number, number, number];
  /** Pre-computed perceptual Oklab midpoint sRGB [0..1] for non-muddy sky gradients */
  mid?: [number, number, number];
  cozyFilter: boolean;
  glowIntensity: number;
  filterMode: number; // 0 = clean, 1 = lcd, 2 = crt
  camFracX?: number;
  camFracY?: number;
  viewW?: number;
  viewH?: number;
}

export interface GpuFrameStats {
  backend: GpuBackendKind;
  drawCalls: number;
  spriteCount: number;
  lightCount: number;
  frameTimeMs: number;
}

export interface IGpuBackend {
  readonly kind: Exclude<GpuBackendKind, 'initializing'>;
  uploadAtlas(
    width: number,
    height: number,
    pixels: Uint8Array,
    indexPixels?: Uint8Array,
    paletteLut?: Uint8Array,
    paletteRows?: number,
  ): void;
  renderFrame(
    sky: SkyGradient,
    alphaItems: Float32Array,
    alphaCount: number,
    additiveItems: Float32Array,
    additiveCount: number,
    timeSec: number,
  ): number; // returns draw calls executed
  resize(pixelWidth: number, pixelHeight: number): void;
  dispose(): void;
}
