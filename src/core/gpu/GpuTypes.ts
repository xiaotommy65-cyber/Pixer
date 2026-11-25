import type { Camera3DProjectionMode } from '../math/Perspective3DMath.ts';

export const GAME_W = 320;
export const GAME_H = 180;
export const OVERSCAN_PAD = 1;
export const OVERSCAN_W = GAME_W + OVERSCAN_PAD * 2;
export const OVERSCAN_H = GAME_H + OVERSCAN_PAD * 2;
export const FLOATS_PER_INSTANCE = 24;
export const MAX_INSTANCES_PER_PASS = 16384;
export const FLOATS_PER_QUAD3D = 28;
export const MAX_QUAD3D_INSTANCES = 12288;
export const FLOATS_PER_MESH3D_VERTEX = 20;
export const MAX_MESH3D_VERTICES = 65536;
export const MAX_MESH3D_INDICES = 196608;
export const MAX_MESH3D_ALPHA_VERTICES = 16384;
export const MAX_MESH3D_ALPHA_INDICES = 49152;
export const MAX_LINE3D_VERTICES = 16384;
export const SHADOW_MAP_SIZE = 1024;
export const MAX_DYNAMIC_LIGHTS = 24;

export const MAX_ATLAS_PAGES = 8;

export interface LogicalViewport {
  width: number;
  height: number;
}

export type ViewportPreset = 'classic' | 'wide' | 'hd' | 'hd_plus' | 'qhd' | 'hd720';

export const VIEWPORT_PRESETS: Record<ViewportPreset, LogicalViewport> = {
  classic: { width: 320, height: 180 },
  wide: { width: 426, height: 240 },
  hd: { width: 480, height: 270 },
  hd_plus: { width: 640, height: 360 },
  qhd: { width: 960, height: 540 },
  hd720: { width: 1280, height: 720 },
};

export function resolveLogicalViewport(
  raw?: ViewportPreset | Partial<LogicalViewport> | null,
): LogicalViewport {
  if (!raw) return VIEWPORT_PRESETS.classic;
  if (typeof raw === 'string') return VIEWPORT_PRESETS[raw] ?? VIEWPORT_PRESETS.classic;
  const w =
    typeof raw.width === 'number' && Number.isFinite(raw.width)
      ? Math.max(160, Math.min(1280, Math.round(raw.width)))
      : GAME_W;
  const h =
    typeof raw.height === 'number' && Number.isFinite(raw.height)
      ? Math.max(120, Math.min(720, Math.round(raw.height)))
      : GAME_H;
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
  page?: number;
}

export interface AtlasPoolStats {
  pageCount: number;
  maxPages: number;
  pageSize: number;
  builtinSprites: number;
  dynamicSprites: number;
  spriteSheets: number;
  totalBytes: number;
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

export const OCCLUSION_GRID_MAX = 64;

export interface GpuOcclusionState {
  enabled: boolean;
  cols: number;
  rows: number;
  originScreenX: number;
  originScreenY: number;
  tileSizePx: number;
  shadowStrength: number;
  shadowSoftness: number;
  data: Uint8Array | null;
  version: number;
}

export interface GpuCamera3DState {
  enabled: boolean;
  camCenterX: number;
  camCenterY: number;
  camCenterZ: number;
  zoom: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  fovDeg: number;
  projection: Camera3DProjectionMode;
  viewW: number;
  viewH: number;
  occOriginWorldX: number;
  occOriginWorldY: number;
  occTileSizeWorld: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  shadowMapEnabled: boolean;
  shadowStrength: number;
}

export interface Quad3DPassData {
  camera: GpuCamera3DState;
  quadViews?: readonly [GpuCamera3DState, GpuCamera3DState, GpuCamera3DState, GpuCamera3DState];
  opaqueData: Float32Array;
  opaqueCount: number;
  alphaData: Float32Array;
  alphaCount: number;
  additiveData: Float32Array;
  additiveCount: number;
}

export interface Mesh3DPassData {
  opaqueVertices: Float32Array;
  opaqueVertexCount: number;
  opaqueIndices: Uint32Array;
  opaqueIndexCount: number;
  alphaVertices: Float32Array;
  alphaVertexCount: number;
  alphaIndices: Uint32Array;
  alphaIndexCount: number;
  lineVertices: Float32Array;
  lineVertexCount: number;
  lightPosZ?: Float32Array;
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
  waterLevelNorm?: number;
  waterTint?: [number, number, number];
  tiltShiftBlur?: number;
  tiltShiftFocusY?: number;
}

export interface GpuFrameStats {
  backend: GpuBackendKind;
  drawCalls: number;
  spriteCount: number;
  lightCount: number;
  frameTimeMs: number;
}

export interface AtlasPageData {
  pixels: Uint8Array;
  indexPixels: Uint8Array;
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
    extraPages?: readonly AtlasPageData[],
  ): void;
  renderFrame(
    sky: SkyGradient,
    alphaItems: Float32Array,
    alphaCount: number,
    additiveItems: Float32Array,
    additiveCount: number,
    timeSec: number,
    lightsData?: Float32Array,
    lightCount?: number,
    occlusion?: GpuOcclusionState,
    quad3d?: Quad3DPassData,
    mesh3d?: Mesh3DPassData,
  ): number; // returns draw calls executed
  resize(pixelWidth: number, pixelHeight: number): void;
  dispose(): void;
}
