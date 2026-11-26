import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { AnimationStateMachineRuntime } from '../sim/AnimationStateMachine.ts';
import { INVALID_ENTITY, type EntityHandle, unpackEntityIndex } from './EntityManager.ts';

export const ECS_VAR_SLOTS = 8;

/**
 * Strongly typed Component definition registered inside ComponentRegistry.
 * Each component type is assigned a unique bit (0..30) for O(1) archetype bitmask matching.
 */
export interface ComponentTypeDef<T> {
  readonly id: string;
  readonly bit: number;
  readonly mask: number;
  readonly createDefault: () => T;
}

/**
 * Cache-friendly Sparse-Set Component Storage:
 * - O(1) has / get / set / remove by entity slot index
 * - Contiguous dense arrays (`denseEntities`, `denseData`) for zero-branch linear iteration
 * - Zero per-frame GC allocations once warm
 */
export class SparseSetComponentStore<T> {
  public readonly def: ComponentTypeDef<T>;
  private readonly sparse: Int32Array;
  private readonly denseEntities: Uint32Array;
  private readonly denseData: T[];
  private count = 0;

  constructor(def: ComponentTypeDef<T>, maxEntities: number) {
    this.def = def;
    this.sparse = new Int32Array(maxEntities);
    this.sparse.fill(-1);
    this.denseEntities = new Uint32Array(maxEntities);
    this.denseData = new Array<T>(maxEntities);
  }

  public size(): number {
    return this.count;
  }

  public getDenseEntityAt(denseIdx: number): EntityHandle {
    return this.denseEntities[denseIdx];
  }

  public getDenseDataAt(denseIdx: number): T {
    return this.denseData[denseIdx];
  }

  public hasIndex(entityIndex: number): boolean {
    const denseIdx = this.sparse[entityIndex];
    return denseIdx !== undefined && denseIdx >= 0 && denseIdx < this.count;
  }

  public getByIndex(entityIndex: number): T | undefined {
    const denseIdx = this.sparse[entityIndex];
    if (denseIdx === undefined || denseIdx < 0 || denseIdx >= this.count) return undefined;
    return this.denseData[denseIdx];
  }

  public set(handle: EntityHandle, value: T): T {
    const entityIndex = unpackEntityIndex(handle);
    const existing = this.sparse[entityIndex];
    if (existing !== undefined && existing >= 0) {
      this.denseEntities[existing] = handle;
      this.denseData[existing] = value;
      return value;
    }
    const denseIdx = this.count++;
    this.sparse[entityIndex] = denseIdx;
    this.denseEntities[denseIdx] = handle;
    this.denseData[denseIdx] = value;
    return value;
  }

  public removeByIndex(entityIndex: number): boolean {
    const denseIdx = this.sparse[entityIndex];
    if (denseIdx === undefined || denseIdx < 0) return false;

    const lastIdx = --this.count;
    if (denseIdx !== lastIdx) {
      const movedHandle = this.denseEntities[lastIdx];
      this.denseEntities[denseIdx] = movedHandle;
      this.denseData[denseIdx] = this.denseData[lastIdx];
      this.sparse[unpackEntityIndex(movedHandle)] = denseIdx;
    }
    this.sparse[entityIndex] = -1;
    return true;
  }

  public clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.sparse[unpackEntityIndex(this.denseEntities[i])] = -1;
    }
    this.count = 0;
  }

  public forEach(visitor: (handle: EntityHandle, data: T) => void): void {
    for (let i = 0; i < this.count; i++) {
      visitor(this.denseEntities[i], this.denseData[i]);
    }
  }
}

/**
 * Central Component Schema Registry assigning deterministic bitmask IDs (up to 31 components per world).
 */
export class ComponentRegistry {
  private nextBit = 0;
  private readonly defs = new Map<string, ComponentTypeDef<unknown>>();

  public define<T>(id: string, createDefault: () => T): ComponentTypeDef<T> {
    const existing = this.defs.get(id);
    if (existing) return existing as ComponentTypeDef<T>;
    if (this.nextBit >= 31) {
      throw new Error(`ComponentRegistry limit (31) exceeded when registering "${id}"`);
    }
    const bit = this.nextBit++;
    const def: ComponentTypeDef<T> = {
      id,
      bit,
      mask: 1 << bit,
      createDefault,
    };
    this.defs.set(id, def as ComponentTypeDef<unknown>);
    return def;
  }

  public get(id: string): ComponentTypeDef<unknown> | undefined {
    return this.defs.get(id);
  }

  public listIds(): string[] {
    return Array.from(this.defs.keys());
  }
}

// ============================================================================
// Standard Core ECS Component Data Structures (Pure Data, Zero Methods)
// ============================================================================

export interface Transform2DData {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  w: number;
  h: number;
  rot: number;
  scaleX: number;
  scaleY: number;
  zOrder: number;
}

export interface Velocity2DData {
  vx: number;
  vy: number;
  gravityScale: number;
  drag: number;
}

/**
 * High-Definition PBR-Lite Surface Material Component.
 * Bridges ECS entities directly to Pixer's Multi-Page TextureAtlas & WGSL/GLSL specular/rim shaders.
 */
export interface MaterialData {
  spriteId: SpriteId;
  tint: string;
  alpha: number;
  emissive: number;
  metallic: number; // 0..1 specular sheen intensity
  roughness: number; // 0.05..1.0 specular tightness
  normalStrength: number; // 0..2 Sobel relief normal depth
  paletteRow: number; // -1 = full 32-bit HD RGBA, >=0 = LUT row
  flipX: boolean;
  castShadow: boolean;
}

export interface HealthData {
  hp: number;
  maxHp: number;
  team: number;
  hitFlash: number;
}

export interface LightSourceData {
  radius: number;
  color: string;
  intensity: number;
  falloffPower: number;
}

export interface TagData {
  entityId: string;
  tag: string;
  label: string;
}

export const MAX_TRIGGER_OVERLAPS = 16;
export const MAX_VERLET_NODES = 16;

export interface ColliderData {
  radius: number;
  isProjectile: boolean;
  isSolid: boolean;
  damage: number;
  hitTag: string;
}

export interface PathFollowerData {
  pathKey: string;
  waypointIdx: number;
  speed: number;
  loop: boolean;
}

export interface AnimatorData {
  animatorId: string;
  runtime: AnimationStateMachineRuntime | null;
}

export interface RhythmLaneData {
  laneIndex: number;
  judgeX: number;
  judgeWindow: number;
}

export interface LifetimeData {
  remainingSec: number;
}

export interface ScriptAgentData {
  scriptRefs: string[];
  vars: Float32Array;
  targetHandle: EntityHandle;
  cooldown: number;
  timerAccum: number;
  started: boolean;
}

/**
 * Pure-data 2D Action/Platformer Character Motor component (Zero-GC runtime fields).
 * Supports coyote time, jump buffering, air control, directional dash, and grapple tether state.
 */
export interface CharacterMotor2DData {
  moveSpeed: number;
  accel: number;
  airControl: number;
  gravity: number;
  maxFallSpeed: number;
  jumpVelocity: number;
  coyoteTimeSec: number;
  jumpBufferSec: number;
  dashSpeed: number;
  dashDurationSec: number;
  dashCooldownSec: number;
  floorY: number;
  // Runtime physics state (mutated in-place, zero allocations)
  grounded: boolean;
  wallDir: number;
  facing: number;
  coyoteTimer: number;
  jumpBufferTimer: number;
  dashTimer: number;
  dashCooldownTimer: number;
  dashDirX: number;
  dashDirY: number;
  grappleHandle: EntityHandle;
  grappleLength: number;
  grappleTension: number;
}

/**
 * Pure-data Grapple Anchor component defining tether capture radius, pendulum tension & reel speed.
 */
export interface GrappleAnchorData {
  anchorRadius: number;
  swingTension: number;
  reelSpeed: number;
  minLength: number;
  enabled: boolean;
  // Runtime active tether link
  activeTargetHandle: EntityHandle;
  currentLength: number;
}

/**
 * Pure-data Trigger Zone sensor component using pre-allocated handle buffers for Zero-GC enter/stay/exit tracking.
 */
export interface TriggerZoneData {
  shape: 'rect' | 'circle';
  radius: number;
  width: number;
  height: number;
  filterTag: string;
  onEnterEvent: string;
  onStayEvent: string;
  onExitEvent: string;
  oneShot: boolean;
  cooldownSec: number;
  // Runtime pre-allocated overlap tracking
  triggered: boolean;
  cooldownTimer: number;
  overlapCount: number;
  prevOverlapCount: number;
  overlapHandles: Uint32Array;
  prevOverlapHandles: Uint32Array;
  enterCount: number;
  exitCount: number;
}

/**
 * Pure-data Verlet Rope/Cape/Lantern Chain component backed by pre-allocated Float32Array node pools.
 */
export interface VerletChainData {
  nodeCount: number;
  segmentLength: number;
  gravity: number;
  damping: number;
  iterations: number;
  pinStart: boolean;
  attachOffsetX: number;
  attachOffsetY: number;
  color: string;
  thickness: number;
  // Pre-allocated node pool (length = MAX_VERLET_NODES)
  initialized: boolean;
  posX: Float32Array;
  posY: Float32Array;
  prevX: Float32Array;
  prevY: Float32Array;
}

/**
 * Pure-data Multi-Dimensional Spatial3D component (Zero-GC runtime fields).
 * Adds true Z-axis elevation, vertical thickness, Z-gravity/jump, 3D orientation, and parallel-world dimension bitmasks.
 */
export interface Spatial3DData {
  z: number;
  prevZ: number;
  vz: number;
  height: number;
  groundZ: number;
  gravityZ: number;
  jumpZVelocity: number;
  dimensionMask: number;
  shadowScale: number;
  yaw: number;
  pitch: number;
  roll: number;
  depth: number;
  stepHeight: number;
  ceilingZ: number;
  slopeNormalX: number;
  slopeNormalY: number;
  slopeNormalZ: number;
}

/**
 * Pure-data 3D Mesh / Cuboid Model & Camera-Relative Billboard component.
 */
export interface MeshRenderer3DData {
  modelId: string;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  animClip: string;
  animTime: number;
  castShadow: boolean;
  billboardYawMode: 'fixed' | 'camera_4way' | 'camera_8way';
}

export function createStandardComponentRegistry(): {
  registry: ComponentRegistry;
  Transform2D: ComponentTypeDef<Transform2DData>;
  Velocity2D: ComponentTypeDef<Velocity2DData>;
  Material: ComponentTypeDef<MaterialData>;
  Health: ComponentTypeDef<HealthData>;
  LightSource: ComponentTypeDef<LightSourceData>;
  Tag: ComponentTypeDef<TagData>;
  Collider: ComponentTypeDef<ColliderData>;
  PathFollower: ComponentTypeDef<PathFollowerData>;
  Animator: ComponentTypeDef<AnimatorData>;
  RhythmLane: ComponentTypeDef<RhythmLaneData>;
  Lifetime: ComponentTypeDef<LifetimeData>;
  ScriptAgent: ComponentTypeDef<ScriptAgentData>;
  CharacterMotor2D: ComponentTypeDef<CharacterMotor2DData>;
  GrappleAnchor: ComponentTypeDef<GrappleAnchorData>;
  TriggerZone: ComponentTypeDef<TriggerZoneData>;
  VerletChain: ComponentTypeDef<VerletChainData>;
  Spatial3D: ComponentTypeDef<Spatial3DData>;
  MeshRenderer3D: ComponentTypeDef<MeshRenderer3DData>;
} {
  const registry = new ComponentRegistry();
  const Transform2D = registry.define<Transform2DData>('Transform2D', () => ({
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    w: 32,
    h: 32,
    rot: 0,
    scaleX: 1,
    scaleY: 1,
    zOrder: 0,
  }));
  const Velocity2D = registry.define<Velocity2DData>('Velocity2D', () => ({
    vx: 0,
    vy: 0,
    gravityScale: 0,
    drag: 0,
  }));
  const Material = registry.define<MaterialData>('Material', () => ({
    spriteId: 'solid',
    tint: '#ffffff',
    alpha: 1,
    emissive: 0,
    metallic: 0.25,
    roughness: 0.42,
    normalStrength: 1.0,
    paletteRow: -1,
    flipX: false,
    castShadow: true,
  }));
  const Health = registry.define<HealthData>('Health', () => ({
    hp: 10,
    maxHp: 10,
    team: 1,
    hitFlash: 0,
  }));
  const LightSource = registry.define<LightSourceData>('LightSource', () => ({
    radius: 64,
    color: '#fbbf24',
    intensity: 0.85,
    falloffPower: 1.8,
  }));
  const Tag = registry.define<TagData>('Tag', () => ({
    entityId: '',
    tag: 'entity',
    label: '',
  }));
  const Collider = registry.define<ColliderData>('Collider', () => ({
    radius: 12,
    isProjectile: false,
    isSolid: false,
    damage: 1,
    hitTag: '',
  }));
  const PathFollower = registry.define<PathFollowerData>('PathFollower', () => ({
    pathKey: '',
    waypointIdx: 0,
    speed: 48,
    loop: false,
  }));
  const Animator = registry.define<AnimatorData>('Animator', () => ({
    animatorId: '',
    runtime: null,
  }));
  const RhythmLane = registry.define<RhythmLaneData>('RhythmLane', () => ({
    laneIndex: 0,
    judgeX: 112,
    judgeWindow: 32,
  }));
  const Lifetime = registry.define<LifetimeData>('Lifetime', () => ({
    remainingSec: 2,
  }));
  const ScriptAgent = registry.define<ScriptAgentData>('ScriptAgent', () => ({
    scriptRefs: [],
    vars: new Float32Array(ECS_VAR_SLOTS),
    targetHandle: INVALID_ENTITY,
    cooldown: 0,
    timerAccum: 0,
    started: false,
  }));
  const CharacterMotor2D = registry.define<CharacterMotor2DData>('CharacterMotor2D', () => ({
    moveSpeed: 150,
    accel: 1200,
    airControl: 0.65,
    gravity: 720,
    maxFallSpeed: 420,
    jumpVelocity: 290,
    coyoteTimeSec: 0.12,
    jumpBufferSec: 0.12,
    dashSpeed: 340,
    dashDurationSec: 0.14,
    dashCooldownSec: 0.55,
    floorY: 0,
    grounded: false,
    wallDir: 0,
    facing: 1,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    dashTimer: 0,
    dashCooldownTimer: 0,
    dashDirX: 1,
    dashDirY: 0,
    grappleHandle: INVALID_ENTITY,
    grappleLength: 0,
    grappleTension: 0.98,
  }));
  const GrappleAnchor = registry.define<GrappleAnchorData>('GrappleAnchor', () => ({
    anchorRadius: 150,
    swingTension: 0.98,
    reelSpeed: 96,
    minLength: 24,
    enabled: true,
    activeTargetHandle: INVALID_ENTITY,
    currentLength: 0,
  }));
  const TriggerZone = registry.define<TriggerZoneData>('TriggerZone', () => ({
    shape: 'circle',
    radius: 36,
    width: 48,
    height: 48,
    filterTag: '',
    onEnterEvent: 'zone_enter',
    onStayEvent: '',
    onExitEvent: 'zone_exit',
    oneShot: false,
    cooldownSec: 0,
    triggered: false,
    cooldownTimer: 0,
    overlapCount: 0,
    prevOverlapCount: 0,
    overlapHandles: new Uint32Array(MAX_TRIGGER_OVERLAPS),
    prevOverlapHandles: new Uint32Array(MAX_TRIGGER_OVERLAPS),
    enterCount: 0,
    exitCount: 0,
  }));
  const VerletChain = registry.define<VerletChainData>('VerletChain', () => ({
    nodeCount: 6,
    segmentLength: 10,
    gravity: 420,
    damping: 0.96,
    iterations: 4,
    pinStart: true,
    attachOffsetX: 0,
    attachOffsetY: 6,
    color: '#f59e0b',
    thickness: 2,
    initialized: false,
    posX: new Float32Array(MAX_VERLET_NODES),
    posY: new Float32Array(MAX_VERLET_NODES),
    prevX: new Float32Array(MAX_VERLET_NODES),
    prevY: new Float32Array(MAX_VERLET_NODES),
  }));
  const Spatial3D = registry.define<Spatial3DData>('Spatial3D', () => ({
    z: 0,
    prevZ: 0,
    vz: 0,
    height: 16,
    groundZ: 0,
    gravityZ: 0,
    jumpZVelocity: 190,
    dimensionMask: 1,
    shadowScale: 1,
    yaw: 0,
    pitch: 0,
    roll: 0,
    depth: 16,
    stepHeight: 10,
    ceilingZ: 9999,
    slopeNormalX: 0,
    slopeNormalY: 0,
    slopeNormalZ: 1,
  }));
  const MeshRenderer3D = registry.define<MeshRenderer3DData>('MeshRenderer3D', () => ({
    modelId: '',
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    animClip: '',
    animTime: 0,
    castShadow: true,
    billboardYawMode: 'fixed',
  }));

  return {
    registry,
    Transform2D,
    Velocity2D,
    Material,
    Health,
    LightSource,
    Tag,
    Collider,
    PathFollower,
    Animator,
    RhythmLane,
    Lifetime,
    ScriptAgent,
    CharacterMotor2D,
    GrappleAnchor,
    TriggerZone,
    VerletChain,
    Spatial3D,
    MeshRenderer3D,
  };
}
