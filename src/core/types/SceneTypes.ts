import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { CartridgeId } from './CartridgeTypes.ts';
import type {
  ChronicleHudSnapshot,
  RpgHudSnapshot,
  ShmupHudSnapshot,
  StageProgressInfo,
} from './HudTypes.ts';

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
  emissive?: number; // 0..1.5 extra self-illumination for Pass 2 bloom
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

export interface BgCloudDesc {
  x: number;
  y: number;
  scale: number;
  speed: number;
  tint: string;
  alpha: number;
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
  bgStars: BgStarDesc[];
  bgClouds: BgCloudDesc[];
  tiles: TileDesc[];
  entities: EntityDesc[];
  particles: ParticleDesc[];
  lights: LightDesc[];
  debugRects?: DebugRectDesc[];
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
