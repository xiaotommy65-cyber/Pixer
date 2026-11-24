import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type {
  OrthogonalArtBlueprint,
  OrthogonalFacing,
  OrthogonalPose,
} from '../sim/OrthogonalArt.ts';
import type { CartridgeId } from './CartridgeId.ts';
import type {
  ChronicleHudSnapshot,
  RpgHudSnapshot,
  ShmupHudSnapshot,
  StageProgressInfo,
} from './HudTypes.ts';

export type { CartridgeId };

export type WallMaterialKind = 'stone' | 'earth' | 'timber' | 'astral';

export type FeedbackPreset =
  | 'ui_press'
  | 'light_hit'
  | 'heavy_kill'
  | 'charge_shot'
  | 'dash_kick'
  | 'boss_phase'
  | 'player_hurt'
  | 'explosion'
  | 'relic_burst';

export type SimEvent =
  | 'jump'
  | 'star'
  | 'stomp'
  | 'hurt'
  | 'laser'
  | 'key'
  | 'win'
  | 'bounce'
  | 'explode'
  | 'ignite'
  | 'snap'
  | 'charge'
  | 'rail';

export type BgmTheme = 'meadow' | 'starlight' | 'dungeon' | 'boss';

export interface SimEventDetail {
  kind: SimEvent;
  combo?: number;
}

export interface TileDesc {
  sprite: SpriteId;
  x: number;
  y: number;
  w: number;
  h: number;
  tint?: string;
  unlockable?: boolean;
  /** 2.5D HD-2D vertical wall extrusion height (world px). */
  extrudeH?: number;
  /** Optional world Y baseline for extrusion when sprite artwork ends above y + h. */
  extrudeAtY?: number;
  /** Vertical south-facing facade color when extrudeH > 0. */
  wallColor?: string;
  /** Procedural GPU facade material shader style when extrudeH > 0. */
  wallMaterial?: WallMaterialKind;
  /** Vertical Z lift applied to tile cap (world px). */
  elevationZ?: number;
  /** Explicit depth sort baseline Y (world px). */
  sortY?: number;
  /** Soft ground shadow cast south of extruded walls/cliffs. */
  castShadow?: boolean;
  /** Optional opacity (0..1, defaults to 1; used for foreground canopies/mist). */
  alpha?: number;
  /** Optional horizontal sprite flip. */
  flipX?: boolean;
  /** 4-bit N/E/S/W auto-tile bitmask (N=1, E=2, S=4, W=8). */
  autoMask?: number;
  /** Optional deterministic variant seed for tile decor. */
  variant?: number;
  /** Wind sway intensity multiplier (0 = rigid, >0 = gentle wind lean). */
  windSway?: number;
}

export interface EntityDesc {
  id: string;
  sprite: SpriteId;
  x: number;
  y: number;
  w: number;
  h: number;
  scaleX?: number;
  scaleY?: number;
  anchorY?: number; // 0 = top, 0.5 = center (default), 1 = feet bottom
  flash?: number; // 0..1 white hit-flash in GPU shader
  skewX?: number; // Horizontal shear factor for sprint lean / impact tilt
  emissive?: number; // 0..2.0 extra self-illumination for Pass 2 bloom
  roughness?: number; // 0.05..1.0 PBR-Lite specular spread (lower = sharper highlight)
  metallic?: number; // 0..1.0 PBR-Lite metallic reflectance tint & diffuse conservation
  paletteRow?: number; // Override 16xN Palette LUT row (0..7)
  flipX?: boolean;
  rot?: number;
  tint?: string;
  alpha?: number;
  additive?: boolean;
  /** 2.5D vertical lift off the ground plane (world px, shrinks & detaches contact shadow). */
  elevationZ?: number;
  /** Distance from entity bottom to ground plane in side-view levels (projects landing shadow). */
  shadowOffsetY?: number;
  /** Opt in/out of elliptical pixel ground contact shadow. */
  castShadow?: boolean;
  /** Horizontal radius of ground shadow in world px (defaults from entity width). */
  shadowRadius?: number;
  /** Explicit depth sort baseline Y (world px, defaults to foot bottom in 2.5D scenes). */
  sortY?: number;
  /** 4-Axis Orthogonal Art Blueprint ID (expands across Facing × Layers × Palette LUT × Pose). */
  artBlueprintId?: string;
  /** Explicit facing override for Orthogonal Art ('front' | 'back' | 'side' | 'viewmodel' | 'portrait'). */
  artFacing?: OrthogonalFacing;
  /** Standardized animation pose ('idle' | 'walk' | 'windup' | 'strike' | 'guard' | 'hurt'). */
  artPose?: OrthogonalPose;
  /** World-space facing angle in radians (used for 1P 2.5D directional billboard angle resolution). */
  yawRad?: number;
  /** Optional vertical height scale multiplier when rendered as a 1P billboard (default 1.0). */
  billboardScale?: number;
  /** If true, entity is omitted in 1P raycast view (e.g. the player's own 3P body). */
  hideInFirstPerson?: boolean;
}

export interface ParticleDesc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rot: number;
  vRot: number;
  sprite?: SpriteId;
  additive?: boolean;
  gravity?: number;
  targetX?: number;
  targetY?: number;
  pull?: number;
  damping?: number;
  convergeSnapRadius?: number;
  curlStrength?: number;
  curlScale?: number;
}

export interface LightDesc {
  x: number;
  y: number;
  radius: number;
  color: string;
  intensity: number;
  falloffPower?: number;
}

export interface DebugRectDesc {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface HudPrimitiveDesc {
  kind: 'bar' | 'box' | 'aim_line' | 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  x2?: number;
  y2?: number;
  ratio?: number;
  text?: string;
  scale?: number;
  align?: 'left' | 'center' | 'right';
  shadowColor?: string;
  color: string;
  bgColor?: string;
  alpha?: number;
  worldSpace?: boolean;
}

export interface BgCloudDesc {
  x: number;
  y: number;
  scale: number;
  speed: number;
  tint: string;
  alpha: number;
}

export interface BgParallaxLayerDesc {
  sprite: SpriteId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Horizontal scroll multiplier vs camera (e.g. 0.15..0.65). Defaults to 0.35. */
  scrollX?: number;
  /** Vertical scroll multiplier vs camera (e.g. 0.10..0.55). Defaults to 0.2. */
  scrollY?: number;
  /** Optional total horizontal span in px to repeat sprites across large worlds. */
  repeatW?: number;
  /** Step distance in px between repeated sprites (defaults to w). */
  repeatStepX?: number;
  tint?: string;
  alpha?: number;
  flipX?: boolean;
  paletteRow?: number;
  additive?: boolean;
  emissive?: number;
}

export interface BgStarDesc {
  x: number;
  y: number;
  size: number;
  phase: number;
  color: string;
}

export interface RectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: 'solid' | 'cloud';
  unlockable?: boolean;
}

export interface OcclusionGridDesc {
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  tileSize: number;
  /** Row-major Uint8Array of length >= cols*rows (0 = open, >=128 = opaque shadow-casting wall). */
  data: Uint8Array;
  /** Monotonic counter incremented when wall geometry changes to avoid per-frame GPU texture uploads. */
  version: number;
  /** Shadow attenuation strength 0..1 (default 0.86). */
  shadowStrength?: number;
  /** Shadow penumbra softness 0..1 (default 0.36). */
  shadowSoftness?: number;
}

export interface Hd2dDepthConfig {
  enabled: boolean;
  /** Interleaves 2.5D extruded walls/columns and entities sorted by foot Y coordinate. */
  sortByDepthY?: boolean;
  /** Subtle oblique perspective scaling factor across screen Y (e.g. 0.06). */
  perspectiveSkew?: number;
  /** Top horizon atmospheric depth haze tint. */
  horizonHazeColor?: string;
  horizonHazeAlpha?: number;
  /** Soft tilt-shift upper/lower bokeh lens shading alpha. */
  tiltShiftAlpha?: number;
  /** Real GPU Pass-3 Tilt-Shift Depth-of-Field micro-bokeh blur intensity 0..1 (preserves center sharpness). */
  tiltShiftBlur?: number;
  /** Vertical focal plane Y in normalized screen space 0.1..0.9 (default 0.52). */
  tiltShiftFocusY?: number;
  /** World-space Y water plane for real-time planar reflection + ripple shader. */
  waterLevelY?: number;
  /** Water tint hex color (default '#3a6e9c'). */
  waterTint?: string;
  /** Snap world coordinates to integer pixel grid for clean pixel-art crispness. */
  pixelPerfect?: boolean;
  /** Optional warm/cool split-tone atmospheric weight. */
  splitToneWarmth?: number;
  /** Enables true 3D perspective box-wall + upright pixel billboard GPU rendering (`hd2d_3d`). */
  mode3d?: boolean;
  /** 3D camera pitch angle in degrees above ground plane (default 42). */
  pitchDeg?: number;
  /** 3D camera vertical field of view in degrees (default 38). */
  fovDeg?: number;
  /** Wall & column height multiplier (default 1.15). */
  wallHeightScale?: number;
  /** Backward tilt angle (degrees) for 3D pixel billboards (default 12). */
  billboardTiltDeg?: number;
  /** 45-degree oblique directional wall drop shadow alpha in 3/4 hd2d_iso mode (default 0.42). */
  obliqueShadowAlpha?: number;
}

export interface PerspectiveProjectionDesc {
  mode: 'third_person' | 'first_person';
  /** Smooth transition blend factor (0 = pure 3P, 1 = pure 1P). */
  blend01: number;
  viewerX: number;
  viewerY: number;
  viewerYawRad: number;
  fovRad: number;
  maxDist: number;
  tileSize: number;
  wallCols: number;
  wallRows: number;
  /** Flat row-major Uint8Array (0 = open, 1..N = wall material index into wallSpriteIds). */
  wallGrid: Uint8Array;
  wallSpriteIds: readonly SpriteId[];
  ceilTopColor?: string;
  ceilHorizonColor?: string;
  floorHorizonColor?: string;
  floorBottomColor?: string;
  fogColor?: string;
  wallHeightScale?: number;
  pitchOffsetPx?: number;
  columnStepPx?: number;
  /** Held 1P viewmodel Orthogonal Art Blueprint ID (e.g. 'fp_lantern_blade'). */
  viewmodelBlueprintId?: string;
  viewmodelPose?: OrthogonalPose;
  viewmodelBob?: number;
  viewmodelSwing?: number;
  /** Draws a crisp corner radar minimap in 1P mode using pure GPU rects. */
  showMinimap?: boolean;
}

export interface RenderSceneSnapshot {
  cartridgeId: CartridgeId;
  skyTop: string;
  skyBottom: string;
  cozyFilter: boolean;
  glowIntensity?: number;
  paletteRow?: number;
  timeSec: number;
  elapsedSec: number;
  status: 'playing' | 'won' | 'lost';
  score: number;
  comboCount?: number;
  starsCollected: number;
  starsTotal: number;
  hasKey: boolean;
  hearts: number;
  maxHearts: number;
  bossHp: number;
  bossMaxHp: number;
  cameraX: number;
  cameraY: number;
  cameraZoom?: number;
  cameraLetterbox?: number;
  viewport?: { width: number; height: number };
  ambientDarkness?: number;
  ambientColor?: string;
  screenFlashAlpha?: number;
  screenFlashColor?: string;
  hd2dDepth?: Hd2dDepthConfig;
  occlusion?: OcclusionGridDesc;
  perspective?: PerspectiveProjectionDesc;
  customArtBlueprints?: Readonly<Record<string, OrthogonalArtBlueprint>>;
  bgStars: BgStarDesc[];
  bgParallaxLayers?: BgParallaxLayerDesc[];
  bgClouds: BgCloudDesc[];
  tiles: TileDesc[];
  fgTiles?: TileDesc[];
  entities: EntityDesc[];
  particles: ParticleDesc[];
  lights: LightDesc[];
  debugRects?: DebugRectDesc[];
  hudPrimitives?: readonly HudPrimitiveDesc[];
  hideClassicHud?: boolean;
  statusBanner: string;
  stage?: StageProgressInfo;
  bgmTheme?: BgmTheme;
  rpgHud?: RpgHudSnapshot;
  shmupHud?: ShmupHudSnapshot;
  chronicleHud?: ChronicleHudSnapshot;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
