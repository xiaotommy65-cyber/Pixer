import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { ViewportPreset } from '../gpu/GpuTypes.ts';
import type { Camera3DProjectionMode } from '../math/Perspective3DMath.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import type { CartridgeId, SimEvent } from '../types/WorldTypes.ts';
import {
  validateCutsceneDef,
  type EcsCameraMotionKind,
  type EcsCutsceneDef,
  type EcsCutsceneShotDef,
  type EcsCutsceneTrigger,
  type EcsScreenAnchor,
  type EcsShotSize,
} from './EcsCutsceneSchema.ts';
import { validateModel3DDef, type EcsModel3DDef } from './EcsModel3D.ts';
import type { EcsWorldMapDef } from './EcsTilemapTypes.ts';
import { validateVoxelCellDef } from './EcsVoxelVolume.ts';

export {
  validateCutsceneDef,
  type EcsCameraMotionKind,
  type EcsCutsceneDef,
  type EcsCutsceneShotDef,
  type EcsCutsceneTrigger,
  type EcsScreenAnchor,
  type EcsShotSize,
};

export type EcsCompareOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export const ECS_PROCEDURAL_SPRITE_PATTERNS = [
  'cobble',
  'bricks',
  'foliage',
  'metal_panel',
  'water',
  'circuit',
  'crystal',
  'pillar',
  'gate',
  'banner',
  'rune_floor',
  'planks',
  'orb',
] as const;

export type EcsProceduralSpritePattern = (typeof ECS_PROCEDURAL_SPRITE_PATTERNS)[number];

export interface EcsProceduralSpriteRecipe {
  pattern: EcsProceduralSpritePattern;
  baseHex: string;
  secondaryHex?: string;
  accentHex?: string;
  outlineHex?: string;
  seed?: number;
  dither?: boolean;
  bevel?: boolean;
  emissiveCore?: boolean;
  frameBorder?: boolean;
}

export interface EcsCustomSpriteDef {
  id: string;
  name?: string;
  width: number;
  height: number;
  kind: 'grid' | 'procedural' | 'rgba_b64';
  /** Optional 16-color hex palette (index 0 = 'transparent'). Defaults to PALETTE_THEMES[paletteRow ?? 0]. */
  palette?: string[];
  paletteRow?: number;
  /** Compact palette-indexed pixel rows ('.'/'0' = transparent, '1'..'9','a'..'f' = palette index). */
  pixels?: string[];
  /** Declarative Oklab + Bayer 4x4 PBR pixel material recipe. */
  recipe?: EcsProceduralSpriteRecipe;
  /** Zlib-compressed + base64-encoded lossless RGBA8 pixel buffer (for Aseprite/LDtk/Tiled imports). */
  rgbaB64?: string;
}

export interface EcsWaypoint {
  x: number;
  y: number;
}

export interface EcsTransformComponent {
  x: number;
  y: number;
  w?: number;
  h?: number;
  rot?: number;
  scaleX?: number;
  scaleY?: number;
  zOrder?: number;
}

export interface EcsBody2DComponent {
  vx?: number;
  vy?: number;
  gravityScale?: number;
  drag?: number;
}

export interface EcsSpriteComponent {
  sprite: SpriteId;
  tint?: string;
  alpha?: number;
  paletteRow?: number;
  flipX?: boolean;
  castShadow?: boolean;
  roughness?: number;
  metallic?: number;
  emissive?: number;
}

export interface EcsHealthComponent {
  hp: number;
  maxHp?: number;
  team: number; // 0 = neutral, 1 = player/ally, 2 = enemy
}

export interface EcsPathFollowerComponent {
  pathId: string;
  speed: number;
  loop?: boolean;
}

export interface EcsLightComponent {
  radius: number;
  color: string;
  intensity?: number;
  falloffPower?: number;
}

export interface EcsColliderComponent {
  radius: number;
  isProjectile?: boolean;
  isSolid?: boolean;
  damage?: number;
  hitTag?: string;
}

export interface EcsRhythmLaneComponent {
  lane: number; // 0..3
  judgeX: number;
  windowPx?: number;
}

export interface EcsCharacterMotor2DComponent {
  moveSpeed?: number;
  accel?: number;
  airControl?: number;
  gravity?: number;
  maxFallSpeed?: number;
  jumpVelocity?: number;
  coyoteTimeSec?: number;
  jumpBufferSec?: number;
  dashSpeed?: number;
  dashDurationSec?: number;
  dashCooldownSec?: number;
  floorY?: number;
  /** When true, runs 8-directional top-down HD-2D exploration with AABB tilemap wall sliding. */
  topDown?: boolean;
}

export interface EcsGrappleAnchorComponent {
  anchorRadius?: number;
  swingTension?: number;
  reelSpeed?: number;
  minLength?: number;
  enabled?: boolean;
}

export interface EcsTriggerZoneComponent {
  shape?: 'rect' | 'circle';
  radius?: number;
  width?: number;
  height?: number;
  filterTag?: string;
  onEnterEvent?: string;
  onStayEvent?: string;
  onExitEvent?: string;
  oneShot?: boolean;
  cooldownSec?: number;
}

export interface EcsVerletChainComponent {
  nodeCount?: number;
  segmentLength?: number;
  gravity?: number;
  damping?: number;
  iterations?: number;
  pinStart?: boolean;
  attachOffsetX?: number;
  attachOffsetY?: number;
  color?: string;
  thickness?: number;
}

export interface EcsSpatial3DComponent {
  z?: number;
  vz?: number;
  height?: number;
  groundZ?: number;
  gravityZ?: number;
  jumpZVelocity?: number;
  /** Bitmask of realms/dimensions (1 = 表世界, 2 = 裡世界, 3 = 全維度). */
  dimensionMask?: number;
  shadowScale?: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  depth?: number;
  stepHeight?: number;
  ceilingZ?: number;
}

export interface EcsMeshRenderer3DComponent {
  modelId: string;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  animClip?: string;
  castShadow?: boolean;
  billboardYawMode?: 'fixed' | 'camera_4way' | 'camera_8way';
}

export type EcsProjectionMode = 'ortho_2d' | 'hd2d_iso' | 'hd2d_3d' | 'first_person_25d';

export interface EcsProjectionConfig {
  mode: EcsProjectionMode;
  elevationScale?: number;
  perspectiveSkew?: number;
  /** Active world realm bitmask (1 = 表世界, 2 = 裡世界, 3 = 全維度). */
  activeDimensionMask?: number;
  /** Opacity multiplier (0..1) for entities outside activeDimensionMask. */
  inactiveDimAlpha?: number;
  /** Enables live Realm 1 <-> Realm 2 shifting via shoulderR input. */
  allowDimensionShift?: boolean;
  /** Camera pitch angle above ground plane in degrees for hd2d_3d (default 42). */
  pitchDeg?: number;
  /** Camera yaw angle around +Z axis in degrees (default 0). */
  yawDeg?: number;
  /** Camera roll angle around forward axis in degrees (default 0). */
  rollDeg?: number;
  /** Camera target elevation Z in world px (default 0). */
  camCenterZ?: number;
  /** Smoothly follow the hero's Spatial3D elevation Z while climbing multi-story buildings (default true in hd2d_3d). */
  autoFollowHeroZ?: boolean;
  /** Interior roof & upper-story cutaway mode when exploring under ceilings ('auto' | 'always' | 'off', default 'auto'). */
  roofCutawayMode?: 'auto' | 'always' | 'off';
  /** Opacity multiplier (0..1) for cut-away upper-story voxels & props (0 = full hide, default 0.18). */
  roofCutawayAlpha?: number;
  /** 3D camera projection mode ('perspective' | 'ortho_top' | 'ortho_front' | 'ortho_side' | 'ortho_iso' | 'ortho_free'). */
  cameraProjection3d?: Camera3DProjectionMode;
  /** Enables 4-quadrant CAD quad-view split (Persp / Top XY / Front XZ / Side YZ). */
  quadView?: boolean;
  /** Enables 1024x1024 directional shadow map in 3D passes (default true). */
  shadowMapEnabled?: boolean;
  /** Directional shadow map darkening strength (0..0.95). */
  shadowMapStrength?: number;
  /** Draws canonical Z-Up RGB XYZ axis gizmo at camera focus target. */
  showAxisGizmo3d?: boolean;
  /** Draws orthographic reference grid on Z=camCenterZ plane. */
  showOrthoGrid3d?: boolean;
  /** Vertical field of view in degrees for hd2d_3d / first_person_25d (default 38). */
  fovDeg?: number;
  /** Wall and column extrusion height multiplier (default 1.15, range 0.5..2.2). */
  wallHeightScale?: number;
  /** Backward tilt angle (degrees) for upright 3D pixel billboards in hd2d_3d (default 12). */
  billboardTiltDeg?: number;
  /** 45-degree directional wall drop shadow opacity for 3/4 hd2d_iso mode (default 0.42). */
  obliqueShadowAlpha?: number;
}

export interface EcsComponentBundle {
  transform: EcsTransformComponent;
  body2d?: EcsBody2DComponent;
  sprite?: EcsSpriteComponent;
  animatorId?: string;
  health?: EcsHealthComponent;
  pathFollower?: EcsPathFollowerComponent;
  light?: EcsLightComponent;
  collider?: EcsColliderComponent;
  rhythmLane?: EcsRhythmLaneComponent;
  characterMotor2d?: EcsCharacterMotor2DComponent;
  grappleAnchor?: EcsGrappleAnchorComponent;
  triggerZone?: EcsTriggerZoneComponent;
  verletChain?: EcsVerletChainComponent;
  spatial3d?: EcsSpatial3DComponent;
  mesh3d?: EcsMeshRenderer3DComponent;
  lifetime?: number;
  vars?: number[]; // up to 8 numeric slots per entity
  scripts?: string[];
  tag?: string;
}

export interface EcsComponentOverrides {
  transform?: Partial<EcsTransformComponent>;
  body2d?: Partial<EcsBody2DComponent>;
  sprite?: Partial<EcsSpriteComponent>;
  animatorId?: string;
  health?: Partial<EcsHealthComponent>;
  pathFollower?: Partial<EcsPathFollowerComponent>;
  light?: Partial<EcsLightComponent>;
  collider?: Partial<EcsColliderComponent>;
  rhythmLane?: Partial<EcsRhythmLaneComponent>;
  characterMotor2d?: Partial<EcsCharacterMotor2DComponent>;
  grappleAnchor?: Partial<EcsGrappleAnchorComponent>;
  triggerZone?: Partial<EcsTriggerZoneComponent>;
  verletChain?: Partial<EcsVerletChainComponent>;
  spatial3d?: Partial<EcsSpatial3DComponent>;
  mesh3d?: Partial<EcsMeshRenderer3DComponent>;
  lifetime?: number;
  vars?: number[];
  scripts?: string[];
  tag?: string;
}

export interface EcsPrefabDef {
  id: string;
  name: string;
  category?: string;
  components: EcsComponentBundle;
}

export interface EcsEntityInitDef {
  id: string;
  name: string;
  /** Canonical Prefab link ID (Pixer 9.0 Batch 9.2). */
  prefabId?: string;
  /** Legacy alias for prefabId preserved for backward compatibility. */
  prefab?: string;
  components: Partial<EcsComponentBundle>;
  /** Sparse per-field overrides applied on top of linked Prefab components. */
  overrides?: EcsComponentOverrides;
  /** Optional room ID scoping this entity to a specific room in `project.worldMap`. */
  roomId?: string;
  /** Component keys explicitly detached on this instance even if present on its Prefab. */
  detachedComponents?: string[];
}

export function getEntityPrefabId(ent: Pick<EcsEntityInitDef, 'prefabId' | 'prefab'>): string | undefined {
  const id = ent.prefabId ?? ent.prefab;
  return id && id.length > 0 ? id : undefined;
}

function mergeOptObj<T extends object>(
  base: T | undefined,
  comp: Partial<T> | undefined,
  over: Partial<T> | undefined,
  detached: boolean,
): T | undefined {
  const hasBase = !detached && base !== undefined;
  if (!hasBase && comp === undefined && over === undefined) return undefined;
  return {
    ...(hasBase ? base : ({} as T)),
    ...(comp ?? {}),
    ...(over ?? {}),
  } as T;
}

/**
 * Pure, deterministic Prefab inheritance + sparse-override resolver shared by
 * `EcsWorld` (runtime), `EcsStudioSession` (transactions), and `EcsWorkbenchView` (UI).
 */
export function resolveEntityComponents(
  init: EcsEntityInitDef,
  prefabs: Record<string, EcsPrefabDef> | ReadonlyMap<string, EcsPrefabDef>,
): EcsComponentBundle {
  const pid = getEntityPrefabId(init);
  const prefab = pid
    ? prefabs instanceof Map
      ? prefabs.get(pid)
      : (prefabs as Record<string, EcsPrefabDef>)[pid]
    : undefined;
  const base = prefab?.components;
  const comp = init.components ?? {};
  const over = init.overrides ?? {};
  const detached = init.detachedComponents ?? [];
  const isDetached = (k: string): boolean => detached.includes(k);

  const transform: EcsTransformComponent = {
    x: over.transform?.x ?? comp.transform?.x ?? base?.transform.x ?? 0,
    y: over.transform?.y ?? comp.transform?.y ?? base?.transform.y ?? 0,
    w: over.transform?.w ?? comp.transform?.w ?? base?.transform.w ?? 16,
    h: over.transform?.h ?? comp.transform?.h ?? base?.transform.h ?? 16,
    rot: over.transform?.rot ?? comp.transform?.rot ?? base?.transform.rot ?? 0,
    scaleX: over.transform?.scaleX ?? comp.transform?.scaleX ?? base?.transform.scaleX ?? 1,
    scaleY: over.transform?.scaleY ?? comp.transform?.scaleY ?? base?.transform.scaleY ?? 1,
    zOrder: over.transform?.zOrder ?? comp.transform?.zOrder ?? base?.transform.zOrder ?? 0,
  };

  const out: EcsComponentBundle = { transform };

  const body2d = mergeOptObj(base?.body2d, comp.body2d, over.body2d, isDetached('body2d'));
  if (body2d) out.body2d = body2d;

  const sprite = mergeOptObj(base?.sprite, comp.sprite, over.sprite, isDetached('sprite'));
  if (sprite && sprite.sprite) out.sprite = sprite;

  const animatorId = over.animatorId ?? comp.animatorId ?? (!isDetached('animatorId') ? base?.animatorId : undefined);
  if (animatorId) out.animatorId = animatorId;

  const health = mergeOptObj(base?.health, comp.health, over.health, isDetached('health'));
  if (health) out.health = health;

  const pathFollower = mergeOptObj(base?.pathFollower, comp.pathFollower, over.pathFollower, isDetached('pathFollower'));
  if (pathFollower) out.pathFollower = pathFollower;

  const light = mergeOptObj(base?.light, comp.light, over.light, isDetached('light'));
  if (light) out.light = light;

  const collider = mergeOptObj(base?.collider, comp.collider, over.collider, isDetached('collider'));
  if (collider) out.collider = collider;

  const rhythmLane = mergeOptObj(base?.rhythmLane, comp.rhythmLane, over.rhythmLane, isDetached('rhythmLane'));
  if (rhythmLane) out.rhythmLane = rhythmLane;

  const characterMotor2d = mergeOptObj(
    base?.characterMotor2d,
    comp.characterMotor2d,
    over.characterMotor2d,
    isDetached('characterMotor2d'),
  );
  if (characterMotor2d) out.characterMotor2d = characterMotor2d;

  const grappleAnchor = mergeOptObj(
    base?.grappleAnchor,
    comp.grappleAnchor,
    over.grappleAnchor,
    isDetached('grappleAnchor'),
  );
  if (grappleAnchor) out.grappleAnchor = grappleAnchor;

  const triggerZone = mergeOptObj(base?.triggerZone, comp.triggerZone, over.triggerZone, isDetached('triggerZone'));
  if (triggerZone) out.triggerZone = triggerZone;

  const verletChain = mergeOptObj(base?.verletChain, comp.verletChain, over.verletChain, isDetached('verletChain'));
  if (verletChain) out.verletChain = verletChain;

  const spatial3d = mergeOptObj(base?.spatial3d, comp.spatial3d, over.spatial3d, isDetached('spatial3d'));
  if (spatial3d) out.spatial3d = spatial3d;

  const mesh3d = mergeOptObj(base?.mesh3d, comp.mesh3d, over.mesh3d, isDetached('mesh3d'));
  if (mesh3d) out.mesh3d = mesh3d;

  const lifetime = over.lifetime ?? comp.lifetime ?? (!isDetached('lifetime') ? base?.lifetime : undefined);
  if (lifetime !== undefined) out.lifetime = lifetime;

  const vars = over.vars ?? comp.vars ?? base?.vars;
  if (vars) out.vars = [...vars];

  const scripts = over.scripts ?? comp.scripts ?? base?.scripts;
  if (scripts) out.scripts = [...scripts];

  const tag = over.tag ?? comp.tag ?? base?.tag;
  if (tag !== undefined) out.tag = tag;

  return out;
}

/**
 * Counts non-trivial sparse overrides on a Prefab-linked entity (excludes default x/y placement).
 */
export function countEntityOverrides(ent: EcsEntityInitDef): number {
  let count = ent.detachedComponents?.length ?? 0;
  const over = ent.overrides;
  if (over) {
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) continue;
      if (k === 'transform' && typeof v === 'object' && v !== null) {
        const extra = Object.keys(v).filter((tk) => tk !== 'x' && tk !== 'y');
        count += extra.length;
      } else {
        count++;
      }
    }
  }
  const comp = ent.components;
  if (comp) {
    for (const [k, v] of Object.entries(comp)) {
      if (v === undefined) continue;
      if (k === 'transform' && typeof v === 'object' && v !== null) {
        const extra = Object.keys(v).filter((tk) => tk !== 'x' && tk !== 'y');
        count += extra.length;
      } else {
        count++;
      }
    }
  }
  return count;
}

export type EcsScriptTrigger =
  | { on: 'start' }
  | { on: 'tick' }
  | { on: 'timer'; intervalSec: number }
  | { on: 'input'; button: 'action' | 'jump' | 'menu' | 'skill' | 'left' | 'right' | 'up' | 'down' }
  | { on: 'collide'; withTag?: string }
  | { on: 'event'; name: string }
  | { on: 'path_end' };

export interface EcsScriptCond {
  kind: 'global' | 'var' | 'hp';
  key?: string;
  slot?: number;
  op: EcsCompareOp;
  value: number;
}

export type EcsScriptOp =
  | { op: 'set_global'; key: string; value: number }
  | { op: 'add_global'; key: string; delta: number; min?: number; max?: number }
  | { op: 'set_var'; slot: number; value: number }
  | { op: 'add_var'; slot: number; delta: number }
  | { op: 'set_vel'; vx: number; vy: number }
  | { op: 'spawn_prefab'; prefab: string; offsetX?: number; offsetY?: number; atX?: number; atY?: number; lane?: number }
  | { op: 'destroy_self' }
  | { op: 'find_nearest'; tag: string; range: number }
  | { op: 'fire_at_target'; prefab: string; speed: number; cooldownSec: number; energyGlobal?: string; energyCost?: number }
  | { op: 'damage_global'; key: string; delta: number }
  | { op: 'add_score'; delta: number }
  | { op: 'play_sfx'; sfx: SimEvent }
  | { op: 'emit_event'; name: string }
  | { op: 'judge_lane_hit'; lane: number; perfectPx?: number; goodPx?: number; energyGlobal: string; comboGlobal: string; perfectEnergy?: number }
  | { op: 'set_status'; status: 'won' | 'lost' };

export interface EcsScriptRuleDef {
  trigger: EcsScriptTrigger;
  when?: EcsScriptCond[];
  ops: EcsScriptOp[];
}

export interface EcsScriptDef {
  id: string;
  name: string;
  description?: string;
  rules: EcsScriptRuleDef[];
}

export interface EcsHudGaugeDef {
  kind: 'bar' | 'text';
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  globalKey?: string;
  maxVal?: number;
  color: string;
  bgColor?: string;
}

export type EcsAmbientParticleTheme = 'none' | 'embers' | 'fireflies' | 'dust' | 'snow';

export interface EcsProjectV2 {
  schemaVersion: 2;
  meta: {
    id: CartridgeId;
    code: string;
    title: string;
    subtitle: string;
    genre: string;
    accentHex: string;
    controlsHint: string;
    goalHint: string;
  };
  viewport: {
    preset?: ViewportPreset;
    width: number;
    height: number;
  };
  atmosphere: {
    skyTop: string;
    skyBottom: string;
    ambientDarkness?: number;
    waterLevelNorm?: number;
    waterTint?: string;
    gridLines?: boolean;
    /** Enables real-time GPU 2D wall shadow occlusion for dynamic lights (default true on worldMap scenes). */
    shadowOcclusion?: boolean;
    /** 2D wall shadow occlusion darkness 0..1 (default 0.88). */
    shadowStrength?: number;
    /** 2D wall shadow penumbra softness 0..1 (default 0.36). */
    shadowSoftness?: number;
    /** HD-2D Tilt-Shift Depth-of-Field blur intensity 0..1 (default 0.34). */
    tiltShiftBlur?: number;
    /** Normalized vertical focus band 0.1..0.9 for Tilt-Shift DoF (default 0.52). */
    tiltShiftFocusY?: number;
    /** Ambient GPU floating particle theme (default 'none' or 'dust'). */
    ambientParticles?: EcsAmbientParticleTheme;
    /** Ambient particle spawn density 0..1 (default 0.55). */
    ambientParticleDensity?: number;
    /** Combat game-feel hitstop & screen-shake intensity multiplier 0..2 (default 1.0). */
    juiceScale?: number;
  };
  /** Optional multi-dimensional projection & realm configuration (Pixer 9.0 Batch 9.4). */
  projection?: EcsProjectionConfig;
  /** Optional multi-room HD-2D Tilemap & Portal world definition (Pixer 10.0). */
  worldMap?: EcsWorldMapDef;
  /** Optional project-embedded custom pixel sprites (palette grids or Oklab+Bayer procedural recipes, M1). */
  customSprites?: Record<string, EcsCustomSpriteDef>;
  /** Optional project-embedded 3D cuboid / glTF models (Phase B). */
  models3d?: Record<string, EcsModel3DDef>;
  paths: Record<string, EcsWaypoint[]>;
  animations: AnimationStateMachineDef[];
  prefabs: Record<string, EcsPrefabDef>;
  entities: EcsEntityInitDef[];
  scripts: Record<string, EcsScriptDef>;
  /** Optional saved Visual Script Event Graph node positions per scriptId (Pixer 9.0 Batch 9.5). */
  graphLayouts?: Record<string, Record<string, { x: number; y: number }>>;
  /** Optional Actor-Relative & Toric Space multi-shot cutscenes / PV sequences (Phase 5). */
  cutscenes?: EcsCutsceneDef[];
  globals: Record<string, number>;
  hud: EcsHudGaugeDef[];
  rhythmTrack?: {
    enabled: boolean;
    yTop: number;
    laneSpacing: number;
    judgeX: number;
    laneCount: number;
    laneColors: string[];
    laneLabels: string[];
  };
}

export interface EcsValidationResult {
  ok: boolean;
  errors: string[];
}

const PROCEDURAL_PATTERN_SET: ReadonlySet<string> = new Set(ECS_PROCEDURAL_SPRITE_PATTERNS);

export function validateCustomSpriteDef(def: unknown, keyHint?: string): string[] {
  const errors: string[] = [];
  const label = keyHint ?? 'customSprite';
  if (!def || typeof def !== 'object') {
    return [`${label} must be an object`];
  }
  const s = def as Partial<EcsCustomSpriteDef>;
  if (!s.id || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{2,64}$/.test(s.id)) {
    errors.push(`${label}.id must match /^[a-zA-Z0-9_-]{2,64}$/`);
  }
  const w = Number(s.width);
  const h = Number(s.height);
  if (!Number.isInteger(w) || w < 8 || w > 256 || !Number.isInteger(h) || h < 8 || h > 256) {
    errors.push(`${label} dimensions ${String(s.width)}x${String(s.height)} must be integers in 8..256`);
  }
  if (s.kind !== 'grid' && s.kind !== 'procedural' && s.kind !== 'rgba_b64') {
    errors.push(`${label}.kind must be 'grid', 'procedural', or 'rgba_b64'`);
  } else if (s.kind === 'grid') {
    if (!Array.isArray(s.pixels) || s.pixels.length === 0) {
      errors.push(`${label}.pixels must be a non-empty string array for kind='grid'`);
    }
    if (s.palette !== undefined && (!Array.isArray(s.palette) || s.palette.length === 0 || s.palette.length > 32)) {
      errors.push(`${label}.palette must be an array of 1..32 hex/color strings`);
    }
  } else if (s.kind === 'rgba_b64') {
    if (typeof s.rgbaB64 !== 'string' || s.rgbaB64.length < 4) {
      errors.push(`${label}.rgbaB64 must be a non-empty base64 string for kind='rgba_b64'`);
    }
  } else {
    if (!s.recipe || typeof s.recipe !== 'object') {
      errors.push(`${label}.recipe is required for kind='procedural'`);
    } else {
      if (!PROCEDURAL_PATTERN_SET.has(s.recipe.pattern)) {
        errors.push(`${label}.recipe.pattern '${String(s.recipe.pattern)}' is invalid`);
      }
      if (typeof s.recipe.baseHex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(s.recipe.baseHex)) {
        errors.push(`${label}.recipe.baseHex must be a #rrggbb hex string`);
      }
    }
  }
  return errors;
}

export function validateEcsProjectV2(raw: unknown): EcsValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['ECS project must be an object'] };
  }
  const p = raw as Partial<EcsProjectV2>;
  if (p.schemaVersion !== 2) {
    errors.push(`schemaVersion must be 2 (got ${String(p.schemaVersion)})`);
  }
  if (!p.meta?.id || !p.meta?.title) {
    errors.push('meta.id and meta.title are required');
  }
  const vw = p.viewport?.width ?? 0;
  const vh = p.viewport?.height ?? 0;
  if (vw < 160 || vw > 1280 || vh < 120 || vh > 720) {
    errors.push(`viewport ${vw}x${vh} out of bounds (160x120..1280x720)`);
  }
  if (!Array.isArray(p.entities)) {
    errors.push('entities must be an array');
  }
  if (!p.scripts || typeof p.scripts !== 'object') {
    errors.push('scripts map is required');
  }
  if (p.customSprites !== undefined) {
    if (typeof p.customSprites !== 'object' || p.customSprites === null || Array.isArray(p.customSprites)) {
      errors.push('customSprites must be a record map');
    } else {
      for (const [key, def] of Object.entries(p.customSprites)) {
        errors.push(...validateCustomSpriteDef(def, `customSprites.${key}`));
      }
    }
  }
  if (p.cutscenes !== undefined) {
    if (!Array.isArray(p.cutscenes)) {
      errors.push('cutscenes must be an array');
    } else {
      for (let i = 0; i < p.cutscenes.length; i++) {
        errors.push(...validateCutsceneDef(p.cutscenes[i], `cutscenes[${i}]`));
      }
    }
  }
  if (p.models3d !== undefined) {
    if (typeof p.models3d !== 'object' || p.models3d === null || Array.isArray(p.models3d)) {
      errors.push('models3d must be a record map');
    } else {
      for (const [key, def] of Object.entries(p.models3d)) {
        errors.push(...validateModel3DDef(def, `models3d.${key}`));
      }
    }
  }
  if (p.worldMap?.rooms) {
    for (let rIdx = 0; rIdx < p.worldMap.rooms.length; rIdx++) {
      const room = p.worldMap.rooms[rIdx];
      if (room?.voxels !== undefined) {
        if (!Array.isArray(room.voxels)) {
          errors.push(`worldMap.rooms[${rIdx}].voxels must be an array`);
        } else {
          for (let vIdx = 0; vIdx < room.voxels.length; vIdx++) {
            errors.push(...validateVoxelCellDef(room.voxels[vIdx], `worldMap.rooms[${rIdx}].voxels[${vIdx}]`));
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function cloneEcsProject(proj: EcsProjectV2): EcsProjectV2 {
  try {
    return structuredClone(proj);
  } catch {
    return JSON.parse(JSON.stringify(proj)) as EcsProjectV2;
  }
}
