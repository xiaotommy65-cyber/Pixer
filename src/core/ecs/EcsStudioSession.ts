import { VIEWPORT_PRESETS, type ViewportPreset } from '../gpu/GpuTypes.ts';
import type { Camera3DProjectionMode } from '../math/Perspective3DMath.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../types/WorldTypes.ts';
import { EcsCartridgeRuntime } from './EcsCartridgeRuntime.ts';
import type { EcsEventGraphLayoutMap } from './EcsEventGraph.ts';
import { validateModel3DDef, type EcsModel3DDef } from './EcsModel3D.ts';
import {
  cloneEcsProject,
  getEntityPrefabId,
  resolveEntityComponents,
  validateCustomSpriteDef,
  validateCutsceneDef,
  validateEcsProjectV2,
  type EcsComponentBundle,
  type EcsComponentOverrides,
  type EcsCustomSpriteDef,
  type EcsCutsceneDef,
  type EcsEntityInitDef,
  type EcsHudGaugeDef,
  type EcsPrefabDef,
  type EcsProjectionConfig,
  type EcsProjectV2,
  type EcsScriptDef,
} from './EcsProjectSchema.ts';
import {
  createEmptyRoom,
  fillRoomBox3D,
  fillRoomRect,
  floodFillRoom,
  setRoomTile,
  setRoomVoxel,
  type EcsMapInteractionRule,
  type EcsMapLayerName,
  type EcsMapPortalDef,
  type EcsMapRoomDef,
  type EcsTileDef,
  type EcsTopDownAiProfile,
  type EcsTopDownHeroConfig,
  type EcsVoxelCellDef,
  type EcsVoxelShape,
} from './EcsTilemapTypes.ts';

export const ECS_ATTACHABLE_COMPONENTS = [
  'body2d',
  'sprite',
  'health',
  'light',
  'collider',
  'pathFollower',
  'lifetime',
  'rhythmLane',
  'characterMotor2d',
  'grappleAnchor',
  'triggerZone',
  'verletChain',
  'spatial3d',
  'mesh3d',
] as const;

export type EcsAttachableComponent = (typeof ECS_ATTACHABLE_COMPONENTS)[number];

export interface EcsPrefabSummary {
  id: string;
  name: string;
  category: string;
  instanceCount: number;
  componentKeys: string[];
  spriteId?: string;
}

export interface EcsAsciiLegendEntry {
  ground?: number;
  wall?: number;
  decor?: number;
  prefabId?: string;
  entityName?: string;
  entityIdPrefix?: string;
}

export interface EcsCustomSpriteSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  kind: 'grid' | 'procedural' | 'rgba_b64';
  pattern?: string;
}

export interface EcsCommandGrammarEntry {
  readonly type: EcsStudioCommand['type'];
  readonly category: 'scene' | 'entity' | 'prefab' | 'script' | 'world_map' | 'rules' | 'assets';
  readonly fields: string;
  readonly note: string;
}

export type EcsStudioCommand =
  | { type: 'load_project'; project: EcsProjectV2 }
  | { type: 'set_viewport'; preset?: ViewportPreset; width?: number; height?: number }
  | { type: 'spawn_entity'; entity: EcsEntityInitDef }
  | { type: 'remove_entity'; entityId: string }
  | { type: 'patch_entity'; entityId: string; patch: EcsComponentOverrides }
  | { type: 'attach_component'; entityId: string; component: EcsAttachableComponent; value: unknown }
  | { type: 'detach_component'; entityId: string; component: EcsAttachableComponent }
  | { type: 'create_prefab'; prefab: EcsPrefabDef }
  | {
      type: 'update_prefab';
      prefabId: string;
      name?: string;
      category?: string;
      patch?: EcsComponentOverrides;
      attachComponent?: { component: EcsAttachableComponent; value: unknown };
      detachComponent?: EcsAttachableComponent;
    }
  | { type: 'delete_prefab'; prefabId: string; mode?: 'unlink' | 'remove_instances' }
  | {
      type: 'save_entity_as_prefab';
      entityId: string;
      prefabId: string;
      name?: string;
      category?: string;
      linkSourceEntity?: boolean;
    }
  | {
      type: 'instantiate_prefab';
      prefabId: string;
      entityId?: string;
      name?: string;
      x?: number;
      y?: number;
      roomId?: string;
      overrides?: EcsComponentOverrides;
    }
  | { type: 'revert_prefab_overrides'; entityId: string; keepPosition?: boolean }
  | { type: 'unlink_prefab'; entityId: string }
  | { type: 'upsert_script'; script: EcsScriptDef; graphLayout?: EcsEventGraphLayoutMap }
  | { type: 'remove_script'; scriptId: string }
  | { type: 'set_global'; key: string; value: number }
  | { type: 'set_atmosphere'; patch: Partial<EcsProjectV2['atmosphere']> }
  | { type: 'set_projection'; patch: Partial<EcsProjectionConfig> }
  | { type: 'ensure_world_map'; cols?: number; rows?: number; roomName?: string }
  | {
      type: 'paint_tiles';
      roomId: string;
      layer: EcsMapLayerName;
      changes: { col: number; row: number; tileId: number }[];
    }
  | {
      type: 'fill_rect';
      roomId: string;
      layer: EcsMapLayerName;
      c0: number;
      r0: number;
      c1: number;
      r1: number;
      tileId: number;
    }
  | {
      type: 'flood_fill';
      roomId: string;
      layer: EcsMapLayerName;
      col: number;
      row: number;
      tileId: number;
    }
  | {
      type: 'stamp_room_ascii';
      roomId: string;
      roomName?: string;
      createIfMissing?: boolean;
      originCol?: number;
      originRow?: number;
      lines: string[];
      legend: Record<string, EcsAsciiLegendEntry>;
      clearExistingRoomEntities?: boolean;
      editorFocusY?: number;
    }
  | { type: 'upsert_room'; room: EcsMapRoomDef }
  | { type: 'delete_room'; roomId: string }
  | { type: 'upsert_portal'; portal: EcsMapPortalDef }
  | { type: 'remove_portal'; portalId: string }
  | {
      type: 'set_world_map_config';
      startRoomId?: string;
      tileSize?: number;
      heroConfig?: EcsTopDownHeroConfig;
      hostileProjectileTag?: string;
    }
  | { type: 'upsert_tile_def'; tileDef: EcsTileDef }
  | { type: 'upsert_interaction_rule'; rule: EcsMapInteractionRule }
  | { type: 'remove_interaction_rule'; tag: string }
  | { type: 'upsert_ai_profile'; tag: string; profile: EcsTopDownAiProfile }
  | { type: 'remove_ai_profile'; tag: string }
  | { type: 'upsert_hud_gauge'; gauge: EcsHudGaugeDef }
  | { type: 'remove_hud_gauge'; label: string }
  | { type: 'upsert_custom_sprite'; sprite: EcsCustomSpriteDef }
  | { type: 'remove_custom_sprite'; spriteId: string }
  | { type: 'upsert_animation'; animation: AnimationStateMachineDef }
  | { type: 'remove_animation'; animationId: string }
  | { type: 'upsert_cutscene'; cutscene: EcsCutsceneDef }
  | { type: 'remove_cutscene'; cutsceneId: string }
  | { type: 'set_room_voxel'; roomId: string; cell: EcsVoxelCellDef }
  | {
      type: 'fill_room_box_3d';
      roomId: string;
      c0: number;
      r0: number;
      z0: number;
      c1: number;
      r1: number;
      z1: number;
      tileId: number;
      shape?: EcsVoxelShape;
    }
  | { type: 'clear_room_voxels'; roomId: string; zLevel?: number }
  | { type: 'upsert_model_3d'; model: EcsModel3DDef }
  | { type: 'remove_model_3d'; modelId: string }
  | {
      type: 'set_camera_3d_pose';
      yawDeg?: number;
      pitchDeg?: number;
      rollDeg?: number;
      fovDeg?: number;
      camCenterZ?: number;
      cameraProjection3d?: Camera3DProjectionMode;
      quadView?: boolean;
      shadowMapEnabled?: boolean;
      shadowMapStrength?: number;
      showAxisGizmo3d?: boolean;
      showOrthoGrid3d?: boolean;
    };

export const ECS_COMMAND_CATALOG: readonly EcsCommandGrammarEntry[] = [
  { type: 'ensure_world_map', category: 'world_map', fields: 'cols?, rows?, roomName?', note: 'Initialize a 32px multi-room HD-2D worldMap if missing.' },
  { type: 'stamp_room_ascii', category: 'world_map', fields: 'roomId, lines[], legend{}, createIfMissing?, roomName?, originCol?, originRow?, clearExistingRoomEntities?, editorFocusY?', note: 'Recommended AI command: paint all 3 tile layers AND spawn prefabs in one compact 2D ASCII blueprint.' },
  { type: 'upsert_room', category: 'world_map', fields: 'room: EcsMapRoomDef', note: 'Create or replace a room grid.' },
  { type: 'delete_room', category: 'world_map', fields: 'roomId', note: 'Delete a room and prune connected portals.' },
  { type: 'paint_tiles', category: 'world_map', fields: 'roomId, layer, changes[{col,row,tileId}]', note: 'Paint discrete tiles on ground/wall/decor layer.' },
  { type: 'fill_rect', category: 'world_map', fields: 'roomId, layer, c0, r0, c1, r1, tileId', note: 'Fill a rectangular tile region.' },
  { type: 'flood_fill', category: 'world_map', fields: 'roomId, layer, col, row, tileId', note: 'BFS flood fill contiguous region.' },
  { type: 'upsert_portal', category: 'world_map', fields: 'portal: {id,name,fromRoomId,col,row,cols,rows,toRoomId,targetX,targetY,requiresGlobal?,lockedHint?}', note: 'Connect rooms with optional global unlock key.' },
  { type: 'remove_portal', category: 'world_map', fields: 'portalId', note: 'Remove a room portal.' },
  { type: 'set_world_map_config', category: 'rules', fields: 'startRoomId?, tileSize?, heroConfig?, hostileProjectileTag?', note: 'Configure hero walk/slash sprites, slashReach, dashSpeedMultiplier, and projectile tag.' },
  { type: 'upsert_tile_def', category: 'rules', fields: 'tileDef: EcsTileDef', note: 'Define or override a custom tile (solid, hazard, extrudeH, renderH, unlockGlobal, ambientLight).' },
  { type: 'upsert_interaction_rule', category: 'rules', fields: 'rule: EcsMapInteractionRule', note: 'Define data-driven prop interaction by tag (setGlobal, addGlobal, thresholdUnlockGlobal, healAmount, swapSprite).' },
  { type: 'remove_interaction_rule', category: 'rules', fields: 'tag', note: 'Remove an interaction rule by tag.' },
  { type: 'upsert_ai_profile', category: 'rules', fields: 'tag, profile: EcsTopDownAiProfile', note: 'Define enemy or multi-phase boss AI behavior (chase, projectiles, isBoss, winOnDefeat).' },
  { type: 'remove_ai_profile', category: 'rules', fields: 'tag', note: 'Remove an AI profile by tag.' },
  { type: 'upsert_hud_gauge', category: 'rules', fields: 'gauge: {kind,x,y,label,globalKey?,color,w?,h?,maxVal?}', note: 'Add or update a global-bound HUD indicator.' },
  { type: 'remove_hud_gauge', category: 'rules', fields: 'label', note: 'Remove a HUD gauge by label.' },
  { type: 'create_prefab', category: 'prefab', fields: 'prefab: EcsPrefabDef', note: 'Register a reusable entity blueprint.' },
  { type: 'update_prefab', category: 'prefab', fields: 'prefabId, name?, category?, patch?, attachComponent?, detachComponent?', note: 'Update a Prefab blueprint name, category, or components in-place.' },
  { type: 'delete_prefab', category: 'prefab', fields: 'prefabId, mode?: "unlink"|"remove_instances"', note: 'Delete a Prefab blueprint and either bake/unlink instances or remove them.' },
  { type: 'save_entity_as_prefab', category: 'prefab', fields: 'entityId, prefabId, name?, category?, linkSourceEntity?', note: 'Promote an entity into a reusable Prefab blueprint and optionally link it.' },
  { type: 'instantiate_prefab', category: 'prefab', fields: 'prefabId, entityId?, name?, x?, y?, roomId?, overrides?', note: 'Spawn a linked prefab instance in a room.' },
  { type: 'revert_prefab_overrides', category: 'prefab', fields: 'entityId, keepPosition?', note: 'Reset sparse component overrides on a Prefab instance back to blueprint defaults.' },
  { type: 'unlink_prefab', category: 'prefab', fields: 'entityId', note: 'Bake resolved Prefab components onto an entity and break its Prefab link.' },
  { type: 'spawn_entity', category: 'entity', fields: 'entity: EcsEntityInitDef', note: 'Spawn a standalone ECS entity.' },
  { type: 'patch_entity', category: 'entity', fields: 'entityId, patch: EcsComponentOverrides', note: 'Patch entity transform/sprite/health/light/etc.' },
  { type: 'remove_entity', category: 'entity', fields: 'entityId', note: 'Remove an entity.' },
  { type: 'attach_component', category: 'entity', fields: 'entityId, component, value', note: 'Attach any dynamic ECS component.' },
  { type: 'detach_component', category: 'entity', fields: 'entityId, component', note: 'Detach an ECS component from an entity (tracking detached prefab overrides).' },
  { type: 'upsert_custom_sprite', category: 'assets', fields: 'sprite: {id, name?, width, height, kind: "grid"|"procedural"|"rgba_b64", palette?, paletteRow?, pixels?, rgbaB64?, recipe?: {pattern, baseHex, secondaryHex?, accentHex?, outlineHex?, seed?, dither?, bevel?, emissiveCore?, frameBorder?}}', note: 'Create or update a project-embedded custom pixel sprite (grid, Oklab procedural, or lossless zlib RGBA from Aseprite/LDtk/Tiled) hot-compiled into TextureAtlas.' },
  { type: 'remove_custom_sprite', category: 'assets', fields: 'spriteId', note: 'Delete a project-embedded custom sprite and recycle its dynamic atlas slot.' },
  { type: 'upsert_animation', category: 'assets', fields: 'animation: {id, initialState, clips: [{name, frames[], fps, loop?, events?}], transitions: [{from, to, param, op, value, priority?}]}', note: 'Create or update a multi-frame AnimationStateMachineDef (bind via components.animatorId on entities or prefabs).' },
  { type: 'remove_animation', category: 'assets', fields: 'animationId', note: 'Remove an AnimationStateMachineDef by ID.' },
  { type: 'load_project', category: 'scene', fields: 'project: EcsProjectV2', note: 'Validate and load a full EcsProjectV2 document, replacing the active project.' },
  { type: 'set_viewport', category: 'scene', fields: 'preset?, width?, height?', note: 'Switch canvas viewport resolution via preset or explicit width/height.' },
  { type: 'upsert_cutscene', category: 'scene', fields: 'cutscene: {id, name, trigger?, roomId?, triggerGlobal?, handbackDurationSec?, skippable?, shots: [{id, durationSec, subject?, secondarySubject?, shotSize?: "EWS"|"WS"|"MS"|"CU"|"ECU", anchor?: "center"|"left_third"|"right_third"|"upper_third"|"lower_third"|"lead_room"|"two_shot", motion?: "cut"|"spring"|"push_in"|"pull_out"|"pan_smooth"|"impact_zoom", timeScale?, holdBeatSec?, motivation?, speaker?, subtitle?, splashTitle?, splashSubtitle?}]}', note: 'Create or update an Actor-Relative & Toric Space multi-shot cutscene / PV sequence with 3-Phase Seamless Spring Handback.' },
  { type: 'remove_cutscene', category: 'scene', fields: 'cutsceneId', note: 'Remove a cutscene / PV sequence by ID.' },
  { type: 'set_atmosphere', category: 'scene', fields: 'patch: {skyTop?, skyBottom?, ambientDarkness?, waterLevelNorm?, waterTint?, shadowOcclusion?, shadowStrength?, shadowSoftness?, tiltShiftBlur?, tiltShiftFocusY?, ambientParticles?: "none"|"embers"|"fireflies"|"dust"|"snow", ambientParticleDensity?, juiceScale?}', note: 'Configure HD-2D sky, 2D raymarched wall shadow occlusion, Tilt-Shift DoF, ambient GPU particles, and combat hitstop/shake juice scale.' },
  { type: 'set_global', category: 'scene', fields: 'key, value', note: 'Set initial project global variable.' },
  { type: 'set_projection', category: 'scene', fields: 'patch: {mode?: "ortho_2d"|"hd2d_iso"|"hd2d_3d"|"first_person_25d", pitchDeg?, fovDeg?, wallHeightScale?, billboardTiltDeg?, obliqueShadowAlpha?, elevationScale?, perspectiveSkew?, activeDimensionMask?, allowDimensionShift?}', note: 'Switch between True 3D HD-2D Perspective (hd2d_3d), 3/4 Strong-Volume 2.5D (hd2d_iso), ortho_2d, or first_person_25d.' },
  { type: 'upsert_script', category: 'script', fields: 'script: EcsScriptDef, graphLayout?', note: 'Upsert sandbox VM script / EventGraph.' },
  { type: 'remove_script', category: 'script', fields: 'scriptId', note: 'Delete a script and graph layout, and detach it from all entities.' },
  { type: 'set_room_voxel', category: 'world_map', fields: 'roomId, cell: {col,row,zLevel,tileId,shape?,rotZ?}', note: 'Place or remove (tileId<=0) a multi-story 3D voxel cell in a room.' },
  { type: 'fill_room_box_3d', category: 'world_map', fields: 'roomId, c0, r0, z0, c1, r1, z1, tileId, shape?', note: 'Fill a 3D rectangular voxel box across columns, rows, and z-stories.' },
  { type: 'clear_room_voxels', category: 'world_map', fields: 'roomId, zLevel?', note: 'Clear all 3D voxels in a room (or on a specific zLevel story).' },
  { type: 'upsert_model_3d', category: 'assets', fields: 'model: {id, name, parts[], rawMesh?, clips?, boundsSize?}', note: 'Create or update a 3D cuboid or glTF rawMesh model asset in project.models3d.' },
  { type: 'remove_model_3d', category: 'assets', fields: 'modelId', note: 'Remove a 3D model asset from project.models3d.' },
  { type: 'set_camera_3d_pose', category: 'scene', fields: 'yawDeg?, pitchDeg?, rollDeg?, fovDeg?, camCenterZ?, cameraProjection3d?, quadView?, shadowMapEnabled?, shadowMapStrength?, showAxisGizmo3d?, showOrthoGrid3d?', note: 'Configure 6DoF 3D camera pose, orthographic projection, quad-view split, shadow map, and 3D gizmos.' },
] as const;

export interface EcsCommandResult {
  ok: boolean;
  revision: number;
  summary: string;
  errors: string[];
  createdEntityId?: string;
  createdPrefabId?: string;
  createdSpriteId?: string;
  createdEntityIds?: string[];
  createdPrefabIds?: string[];
  createdSpriteIds?: string[];
}

export interface EcsHistoryItem {
  revision: number;
  type: EcsStudioCommand['type'] | 'batch' | 'undo' | 'redo';
  summary: string;
}

export interface EcsPlaytestReport {
  framesSimulated: number;
  status: 'playing' | 'won' | 'lost';
  score: number;
  activeEntities: number;
  vmOpsLastFrame: number;
  systems: string[];
  viewport: { width: number; height: number };
  globals: Record<string, number>;
}

const MAX_UNDO = 40;

function mergeOverridesIntoTarget(
  target: Record<string, unknown>,
  patch: EcsComponentOverrides,
  isSparse: boolean,
): void {
  const objectKeys = [
    'transform',
    'body2d',
    'sprite',
    'health',
    'light',
    'collider',
    'pathFollower',
    'rhythmLane',
    'characterMotor2d',
    'grappleAnchor',
    'triggerZone',
    'verletChain',
    'spatial3d',
    'mesh3d',
  ] as const;

  for (const key of objectKeys) {
    const patchVal = patch[key];
    if (!patchVal) continue;
    const prevVal = target[key] as Record<string, unknown> | undefined;
    if (isSparse) {
      target[key] = { ...(prevVal ?? {}), ...patchVal };
    } else {
      let defaults: Record<string, unknown> = {};
      if (key === 'transform') defaults = { x: 0, y: 0 };
      else if (key === 'sprite') defaults = { sprite: 'solid' };
      else if (key === 'health') defaults = { hp: 3, team: 1 };
      else if (key === 'light') defaults = { radius: 48, color: '#ffd447' };
      else if (key === 'collider') defaults = { radius: 12 };
      else if (key === 'pathFollower') defaults = { pathId: '', speed: 48 };
      else if (key === 'rhythmLane') defaults = { lane: 0, judgeX: 112 };
      else if (key === 'mesh3d') defaults = { modelId: '' };
      target[key] = { ...defaults, ...(prevVal ?? {}), ...patchVal };
    }
  }

  if (patch.animatorId !== undefined) target.animatorId = patch.animatorId;
  if (patch.lifetime !== undefined) target.lifetime = patch.lifetime;
  if (patch.vars !== undefined) target.vars = [...patch.vars];
  if (patch.scripts !== undefined) target.scripts = [...patch.scripts];
  if (patch.tag !== undefined) target.tag = patch.tag;
}

/**
 * Pure DOM-free transactional ECS Studio Session shared by both the Pixer 7.0+ Workstation UI
 * and AI Agents (window.__PIXEL_ATELIER_AGENT__.ecs).
 */
export class EcsStudioSession {
  private doc: EcsProjectV2;
  private revision = 1;
  private readonly undoStack: EcsProjectV2[] = [];
  private readonly redoStack: EcsProjectV2[] = [];
  private readonly history: EcsHistoryItem[] = [];
  private readonly listeners = new Set<(doc: EcsProjectV2, revision: number) => void>();

  constructor(initialProject: EcsProjectV2) {
    this.doc = cloneEcsProject(initialProject);
    this.history.push({
      revision: 1,
      type: 'load_project',
      summary: `初始化 ECS 專案「${this.doc.meta.title}」`,
    });
  }

  public getProject(): EcsProjectV2 {
    return cloneEcsProject(this.doc);
  }

  public getRevision(): number {
    return this.revision;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getHistory(): EcsHistoryItem[] {
    return this.history.map((h) => ({ ...h }));
  }

  public getPrefabInstanceCount(prefabId: string): number {
    let count = 0;
    for (let i = 0; i < this.doc.entities.length; i++) {
      if (getEntityPrefabId(this.doc.entities[i]) === prefabId) count++;
    }
    return count;
  }

  public listPrefabs(): EcsPrefabSummary[] {
    const out: EcsPrefabSummary[] = [];
    for (const pref of Object.values(this.doc.prefabs)) {
      const compKeys = Object.keys(pref.components).filter(
        (k) => (pref.components as unknown as Record<string, unknown>)[k] !== undefined,
      );
      out.push({
        id: pref.id,
        name: pref.name,
        category: pref.category ?? (pref.components.tag || 'template'),
        instanceCount: this.getPrefabInstanceCount(pref.id),
        componentKeys: compKeys,
        spriteId: pref.components.sprite?.sprite,
      });
    }
    return out;
  }

  public listCustomSprites(): EcsCustomSpriteSummary[] {
    const map = this.doc.customSprites;
    if (!map) return [];
    const out: EcsCustomSpriteSummary[] = [];
    for (const def of Object.values(map)) {
      out.push({
        id: def.id,
        name: def.name ?? def.id,
        width: def.width,
        height: def.height,
        kind: def.kind,
        ...(def.kind === 'procedural' && def.recipe ? { pattern: def.recipe.pattern } : {}),
      });
    }
    return out;
  }

  public listModels3D(): Array<{
    id: string;
    name: string;
    partCount: number;
    hasRawMesh: boolean;
    clipCount: number;
    boundsSize?: readonly [number, number, number];
  }> {
    const map = this.doc.models3d;
    if (!map) return [];
    const out: Array<{
      id: string;
      name: string;
      partCount: number;
      hasRawMesh: boolean;
      clipCount: number;
      boundsSize?: readonly [number, number, number];
    }> = [];
    for (const def of Object.values(map)) {
      out.push({
        id: def.id,
        name: def.name,
        partCount: def.parts.length,
        hasRawMesh: Boolean(def.rawMesh),
        clipCount: def.clips?.length ?? 0,
        ...(def.boundsSize ? { boundsSize: def.boundsSize } : {}),
      });
    }
    return out;
  }

  public onChange(fn: (doc: EcsProjectV2, revision: number) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private commit(prev: EcsProjectV2, next: EcsProjectV2, type: EcsHistoryItem['type'], summary: string): void {
    this.undoStack.push(prev);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
    this.doc = next;
    this.revision++;
    this.history.push({ revision: this.revision, type, summary });
    if (this.history.length > 60) this.history.shift();
    const snap = cloneEcsProject(this.doc);
    for (const l of this.listeners) l(snap, this.revision);
  }

  public dispatch(cmd: EcsStudioCommand): EcsCommandResult {
    const prev = cloneEcsProject(this.doc);
    const next = cloneEcsProject(this.doc);
    let summary = '';
    let createdEntityId: string | undefined;
    let createdPrefabId: string | undefined;
    let createdSpriteId: string | undefined;

    switch (cmd.type) {
      case 'load_project': {
        const loaded = cloneEcsProject(cmd.project);
        const check = validateEcsProjectV2(loaded);
        if (!check.ok) return { ok: false, revision: this.revision, summary: '載入失敗', errors: check.errors };
        this.commit(prev, loaded, 'load_project', `載入 ECS 專案「${loaded.meta.title}」`);
        return { ok: true, revision: this.revision, summary: `已載入「${loaded.meta.title}」`, errors: [] };
      }
      case 'set_viewport': {
        if (cmd.preset && VIEWPORT_PRESETS[cmd.preset]) {
          const vp = VIEWPORT_PRESETS[cmd.preset];
          next.viewport = { preset: cmd.preset, width: vp.width, height: vp.height };
          summary = `解析度切換至 ${vp.width}×${vp.height} (${cmd.preset})`;
        } else if (cmd.width && cmd.height) {
          next.viewport = { width: cmd.width, height: cmd.height };
          summary = `解析度切換至 ${cmd.width}×${cmd.height}`;
        } else {
          return { ok: false, revision: this.revision, summary: '缺少解析度參數', errors: ['Invalid viewport command'] };
        }
        break;
      }
      case 'spawn_entity': {
        if (next.entities.some((e) => e.id === cmd.entity.id)) {
          return { ok: false, revision: this.revision, summary: '實體 ID 重複', errors: [`Duplicate entity id: ${cmd.entity.id}`] };
        }
        next.entities.push(cmd.entity);
        createdEntityId = cmd.entity.id;
        summary = `新增實體「${cmd.entity.name}」`;
        break;
      }
      case 'remove_entity': {
        const idx = next.entities.findIndex((e) => e.id === cmd.entityId);
        if (idx < 0) {
          return { ok: false, revision: this.revision, summary: '找不到實體', errors: [`Entity not found: ${cmd.entityId}`] };
        }
        const [removed] = next.entities.splice(idx, 1);
        summary = `移除實體「${removed.name}」`;
        break;
      }
      case 'patch_entity': {
        const ent = next.entities.find((e) => e.id === cmd.entityId);
        if (!ent) {
          return { ok: false, revision: this.revision, summary: '找不到實體', errors: [`Entity not found: ${cmd.entityId}`] };
        }
        const pid = getEntityPrefabId(ent);
        if (pid && next.prefabs[pid]) {
          ent.overrides = ent.overrides ?? {};
          mergeOverridesIntoTarget(ent.overrides as Record<string, unknown>, cmd.patch, true);
          if (ent.detachedComponents && ent.detachedComponents.length > 0) {
            const patchedKeys = new Set(Object.keys(cmd.patch));
            ent.detachedComponents = ent.detachedComponents.filter((k) => !patchedKeys.has(k));
            if (ent.detachedComponents.length === 0) delete ent.detachedComponents;
          }
        } else {
          mergeOverridesIntoTarget(ent.components as Record<string, unknown>, cmd.patch, false);
        }
        summary = `更新實體「${ent.name}」元件屬性`;
        break;
      }
      case 'attach_component': {
        const ent = next.entities.find((e) => e.id === cmd.entityId);
        if (!ent) {
          return { ok: false, revision: this.revision, summary: '找不到實體', errors: [`Entity not found: ${cmd.entityId}`] };
        }
        const pid = getEntityPrefabId(ent);
        if (pid && next.prefabs[pid]) {
          ent.overrides = ent.overrides ?? {};
          (ent.overrides as Record<string, unknown>)[cmd.component] = cmd.value;
          if (ent.detachedComponents) {
            ent.detachedComponents = ent.detachedComponents.filter((k) => k !== cmd.component);
            if (ent.detachedComponents.length === 0) delete ent.detachedComponents;
          }
        } else {
          (ent.components as Record<string, unknown>)[cmd.component] = cmd.value;
        }
        summary = `為「${ent.name}」掛載元件 ${cmd.component}`;
        break;
      }
      case 'detach_component': {
        const ent = next.entities.find((e) => e.id === cmd.entityId);
        if (!ent) {
          return { ok: false, revision: this.revision, summary: '找不到實體', errors: [`Entity not found: ${cmd.entityId}`] };
        }
        const pid = getEntityPrefabId(ent);
        delete (ent.components as Record<string, unknown>)[cmd.component];
        if (ent.overrides) {
          delete (ent.overrides as Record<string, unknown>)[cmd.component];
        }
        if (pid && next.prefabs[pid]) {
          const baseHas =
            (next.prefabs[pid].components as unknown as Record<string, unknown>)[cmd.component] !== undefined;
          if (baseHas) {
            ent.detachedComponents = ent.detachedComponents ?? [];
            if (!ent.detachedComponents.includes(cmd.component)) {
              ent.detachedComponents.push(cmd.component);
            }
          }
        }
        summary = `已從「${ent.name}」移除元件 ${cmd.component}`;
        break;
      }
      case 'create_prefab': {
        const cleanId = cmd.prefab.id.trim();
        if (!cleanId) {
          return { ok: false, revision: this.revision, summary: 'Prefab ID 不可為空', errors: ['Prefab id is required'] };
        }
        if (next.prefabs[cleanId]) {
          return { ok: false, revision: this.revision, summary: 'Prefab ID 重複', errors: [`Duplicate prefab id: ${cleanId}`] };
        }
        next.prefabs[cleanId] = {
          ...JSON.parse(JSON.stringify(cmd.prefab)),
          id: cleanId,
          name: cmd.prefab.name.trim() || cleanId,
        } as EcsPrefabDef;
        createdPrefabId = cleanId;
        summary = `建立 Prefab 模板「${next.prefabs[cleanId].name}」`;
        break;
      }
      case 'update_prefab': {
        const pref = next.prefabs[cmd.prefabId];
        if (!pref) {
          return { ok: false, revision: this.revision, summary: '找不到 Prefab', errors: [`Prefab not found: ${cmd.prefabId}`] };
        }
        if (cmd.name !== undefined && cmd.name.trim()) pref.name = cmd.name.trim();
        if (cmd.category !== undefined) pref.category = cmd.category.trim();
        if (cmd.patch) {
          mergeOverridesIntoTarget(pref.components as unknown as Record<string, unknown>, cmd.patch, false);
        }
        if (cmd.attachComponent) {
          (pref.components as unknown as Record<string, unknown>)[cmd.attachComponent.component] =
            cmd.attachComponent.value;
        }
        if (cmd.detachComponent) {
          delete (pref.components as unknown as Record<string, unknown>)[cmd.detachComponent];
        }
        summary = `更新 Prefab 模板「${pref.name}」`;
        break;
      }
      case 'delete_prefab': {
        const pref = next.prefabs[cmd.prefabId];
        if (!pref) {
          return { ok: false, revision: this.revision, summary: '找不到 Prefab', errors: [`Prefab not found: ${cmd.prefabId}`] };
        }
        const mode = cmd.mode ?? 'unlink';
        if (mode === 'remove_instances') {
          next.entities = next.entities.filter((e) => getEntityPrefabId(e) !== cmd.prefabId);
        } else {
          for (let i = 0; i < next.entities.length; i++) {
            const e = next.entities[i];
            if (getEntityPrefabId(e) !== cmd.prefabId) continue;
            e.components = resolveEntityComponents(e, next.prefabs);
            delete e.prefabId;
            delete e.prefab;
            delete e.overrides;
            delete e.detachedComponents;
          }
        }
        delete next.prefabs[cmd.prefabId];
        summary = `刪除 Prefab 模板「${pref.name}」`;
        break;
      }
      case 'save_entity_as_prefab': {
        const ent = next.entities.find((e) => e.id === cmd.entityId);
        if (!ent) {
          return { ok: false, revision: this.revision, summary: '找不到來源實體', errors: [`Entity not found: ${cmd.entityId}`] };
        }
        const cleanId = cmd.prefabId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        if (!cleanId) {
          return { ok: false, revision: this.revision, summary: 'Prefab ID 無效', errors: ['Invalid prefab id'] };
        }
        if (next.prefabs[cleanId]) {
          return { ok: false, revision: this.revision, summary: 'Prefab ID 已存在', errors: [`Duplicate prefab id: ${cleanId}`] };
        }
        const resolved = resolveEntityComponents(ent, next.prefabs);
        const prefName = cmd.name?.trim() || `${ent.name} 模板`;
        next.prefabs[cleanId] = {
          id: cleanId,
          name: prefName,
          category: cmd.category ?? (resolved.tag || 'custom'),
          components: JSON.parse(JSON.stringify(resolved)) as EcsComponentBundle,
        };
        if (cmd.linkSourceEntity !== false) {
          ent.prefabId = cleanId;
          delete ent.prefab;
          ent.components = {};
          ent.overrides = {
            transform: {
              x: resolved.transform.x,
              y: resolved.transform.y,
            },
          };
          delete ent.detachedComponents;
        }
        createdPrefabId = cleanId;
        summary = `將「${ent.name}」存為 Prefab「${prefName}」`;
        break;
      }
      case 'instantiate_prefab': {
        const pref = next.prefabs[cmd.prefabId];
        if (!pref) {
          return { ok: false, revision: this.revision, summary: '找不到 Prefab', errors: [`Prefab not found: ${cmd.prefabId}`] };
        }
        let seq = next.entities.filter((e) => getEntityPrefabId(e) === cmd.prefabId).length + 1;
        let entId = cmd.entityId?.trim() || `${cmd.prefabId}_inst_${seq}`;
        while (next.entities.some((e) => e.id === entId)) {
          seq++;
          entId = `${cmd.prefabId}_inst_${seq}`;
        }
        const entName = cmd.name?.trim() || `${pref.name} #${seq}`;
        const overrides: EcsComponentOverrides = cmd.overrides ? JSON.parse(JSON.stringify(cmd.overrides)) : {};
        if (cmd.x !== undefined || cmd.y !== undefined) {
          overrides.transform = {
            ...(overrides.transform ?? {}),
            ...(cmd.x !== undefined ? { x: cmd.x } : {}),
            ...(cmd.y !== undefined ? { y: cmd.y } : {}),
          };
        }
        const inst: EcsEntityInitDef = {
          id: entId,
          name: entName,
          prefabId: cmd.prefabId,
          ...(cmd.roomId ? { roomId: cmd.roomId } : {}),
          components: {},
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        };
        next.entities.push(inst);
        createdEntityId = entId;
        summary = `從 Prefab「${pref.name}」實例化「${entName}」`;
        break;
      }
      case 'revert_prefab_overrides': {
        const ent = next.entities.find((e) => e.id === cmd.entityId);
        if (!ent) {
          return { ok: false, revision: this.revision, summary: '找不到實體', errors: [`Entity not found: ${cmd.entityId}`] };
        }
        const pid = getEntityPrefabId(ent);
        if (!pid || !next.prefabs[pid]) {
          return { ok: false, revision: this.revision, summary: '此實體未連結 Prefab', errors: ['Entity is not linked to a Prefab'] };
        }
        const resolved = resolveEntityComponents(ent, next.prefabs);
        ent.components = {};
        delete ent.detachedComponents;
        if (cmd.keepPosition !== false) {
          ent.overrides = { transform: { x: resolved.transform.x, y: resolved.transform.y } };
        } else {
          delete ent.overrides;
        }
        summary = `已重置「${ent.name}」的 Prefab 覆寫`;
        break;
      }
      case 'unlink_prefab': {
        const ent = next.entities.find((e) => e.id === cmd.entityId);
        if (!ent) {
          return { ok: false, revision: this.revision, summary: '找不到實體', errors: [`Entity not found: ${cmd.entityId}`] };
        }
        const pid = getEntityPrefabId(ent);
        if (!pid) {
          return { ok: false, revision: this.revision, summary: '此實體未連結 Prefab', errors: ['Entity has no Prefab link'] };
        }
        ent.components = resolveEntityComponents(ent, next.prefabs);
        delete ent.prefabId;
        delete ent.prefab;
        delete ent.overrides;
        delete ent.detachedComponents;
        summary = `已將「${ent.name}」與 Prefab 斷開連結`;
        break;
      }
      case 'upsert_script': {
        next.scripts[cmd.script.id] = cmd.script;
        if (cmd.graphLayout) {
          if (!next.graphLayouts) next.graphLayouts = {};
          next.graphLayouts[cmd.script.id] = cmd.graphLayout;
        }
        summary = `更新事件圖腳本「${cmd.script.name}」`;
        break;
      }
      case 'remove_script': {
        if (!next.scripts[cmd.scriptId]) {
          return { ok: false, revision: this.revision, summary: '找不到腳本', errors: [`Script not found: ${cmd.scriptId}`] };
        }
        const removedName = next.scripts[cmd.scriptId].name;
        delete next.scripts[cmd.scriptId];
        if (next.graphLayouts) {
          delete next.graphLayouts[cmd.scriptId];
        }
        for (const ent of next.entities) {
          if (ent.components.scripts) {
            ent.components.scripts = ent.components.scripts.filter((id) => id !== cmd.scriptId);
          }
          if (ent.overrides?.scripts) {
            ent.overrides.scripts = ent.overrides.scripts.filter((id) => id !== cmd.scriptId);
          }
        }
        summary = `刪除腳本「${removedName}」`;
        break;
      }
      case 'set_global': {
        next.globals[cmd.key] = cmd.value;
        summary = `設定全域變數 ${cmd.key} = ${cmd.value}`;
        break;
      }
      case 'set_atmosphere': {
        next.atmosphere = { ...next.atmosphere, ...cmd.patch };
        summary = '更新大氣與水面反射設定';
        break;
      }
      case 'set_projection': {
        const prevProj: EcsProjectionConfig = next.projection ?? {
          mode: 'hd2d_3d',
          elevationScale: 1.0,
          pitchDeg: 42,
          fovDeg: 38,
          wallHeightScale: 1.25,
          billboardTiltDeg: 12,
          obliqueShadowAlpha: 0.42,
          activeDimensionMask: 3,
          inactiveDimAlpha: 0.16,
          allowDimensionShift: false,
        };
        next.projection = { ...prevProj, ...cmd.patch };
        const pMode = next.projection.mode;
        const extra =
          pMode === 'hd2d_3d'
            ? ` (俯角 ${Math.round(next.projection.pitchDeg ?? 42)}° · FOV ${Math.round(next.projection.fovDeg ?? 38)}° · 牆高 ${(next.projection.wallHeightScale ?? 1.25).toFixed(2)}×)`
            : ` (位面遮罩 ${next.projection.activeDimensionMask ?? 3})`;
        summary = `切換多維投影：${pMode}${extra}`;
        break;
      }
      case 'ensure_world_map': {
        if (!next.worldMap) {
          const cols = cmd.cols ?? 24;
          const rows = cmd.rows ?? 16;
          const room = createEmptyRoom('room_main', cmd.roomName ?? '主廳地圖', cols, rows);
          next.worldMap = {
            tileSize: 32,
            startRoomId: room.id,
            rooms: [room],
            portals: [],
          };
          summary = `建立 32px 多層地圖（${cols}×${rows}）`;
        } else {
          summary = '專案已包含多層地圖';
        }
        break;
      }
      case 'paint_tiles': {
        const room = next.worldMap?.rooms.find((r) => r.id === cmd.roomId);
        if (!room) {
          return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
        }
        let changed = 0;
        for (let i = 0; i < cmd.changes.length; i++) {
          const ch = cmd.changes[i];
          if (setRoomTile(room, cmd.layer, ch.col, ch.row, ch.tileId)) changed++;
        }
        if (changed === 0) {
          return { ok: true, revision: this.revision, summary: '地圖無格點變更', errors: [] };
        }
        summary = `繪製 ${room.name} (${cmd.layer}) 共 ${changed} 格`;
        break;
      }
      case 'fill_rect': {
        const room = next.worldMap?.rooms.find((r) => r.id === cmd.roomId);
        if (!room) {
          return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
        }
        const changed = fillRoomRect(room, cmd.layer, cmd.c0, cmd.r0, cmd.c1, cmd.r1, cmd.tileId);
        if (changed === 0) {
          return { ok: true, revision: this.revision, summary: '矩形區域無變更', errors: [] };
        }
        summary = `矩形填滿 ${room.name} (${cmd.layer}) 共 ${changed} 格`;
        break;
      }
      case 'flood_fill': {
        const room = next.worldMap?.rooms.find((r) => r.id === cmd.roomId);
        if (!room) {
          return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
        }
        const changed = floodFillRoom(room, cmd.layer, cmd.col, cmd.row, cmd.tileId);
        if (changed === 0) {
          return { ok: true, revision: this.revision, summary: '油漆桶無變更', errors: [] };
        }
        summary = `油漆桶填滿 ${room.name} (${cmd.layer}) 共 ${changed} 格`;
        break;
      }
      case 'upsert_room': {
        if (!next.worldMap) {
          next.worldMap = { tileSize: 32, startRoomId: cmd.room.id, rooms: [cmd.room], portals: [] };
        } else {
          const idx = next.worldMap.rooms.findIndex((r) => r.id === cmd.room.id);
          if (idx >= 0) next.worldMap.rooms[idx] = cmd.room;
          else next.worldMap.rooms.push(cmd.room);
        }
        summary = `更新房間「${cmd.room.name}」(${cmd.room.cols}×${cmd.room.rows})`;
        break;
      }
      case 'delete_room': {
        if (!next.worldMap || next.worldMap.rooms.length <= 1) {
          return { ok: false, revision: this.revision, summary: '至少需保留一間房間', errors: ['Cannot delete last room'] };
        }
        const idx = next.worldMap.rooms.findIndex((r) => r.id === cmd.roomId);
        if (idx < 0) {
          return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
        }
        const removed = next.worldMap.rooms.splice(idx, 1)[0];
        next.worldMap.portals = next.worldMap.portals.filter(
          (p) => p.fromRoomId !== cmd.roomId && p.toRoomId !== cmd.roomId,
        );
        if (next.worldMap.startRoomId === cmd.roomId) {
          next.worldMap.startRoomId = next.worldMap.rooms[0].id;
        }
        summary = `刪除房間「${removed.name}」`;
        break;
      }
      case 'upsert_portal': {
        if (!next.worldMap) {
          return { ok: false, revision: this.revision, summary: '尚未建立地圖', errors: ['No worldMap'] };
        }
        const idx = next.worldMap.portals.findIndex((p) => p.id === cmd.portal.id);
        if (idx >= 0) next.worldMap.portals[idx] = cmd.portal;
        else next.worldMap.portals.push(cmd.portal);
        summary = `更新傳送門「${cmd.portal.name}」`;
        break;
      }
      case 'remove_portal': {
        if (!next.worldMap) {
          return { ok: false, revision: this.revision, summary: '尚未建立地圖', errors: ['No worldMap'] };
        }
        next.worldMap.portals = next.worldMap.portals.filter((p) => p.id !== cmd.portalId);
        summary = `移除傳送門 ${cmd.portalId}`;
        break;
      }
      case 'stamp_room_ascii': {
        if (!Array.isArray(cmd.lines) || cmd.lines.length === 0) {
          return { ok: false, revision: this.revision, summary: 'ASCII 地圖藍圖為空', errors: ['lines must be a non-empty string array'] };
        }
        const gridH = cmd.lines.length;
        const gridW = Math.max(8, ...cmd.lines.map((l) => l.length));
        if (!next.worldMap) {
          const fresh = createEmptyRoom(cmd.roomId, cmd.roomName ?? cmd.roomId, gridW, Math.max(8, gridH));
          next.worldMap = { tileSize: 32, startRoomId: fresh.id, rooms: [fresh], portals: [] };
        }
        let room = next.worldMap.rooms.find((r) => r.id === cmd.roomId);
        if (!room) {
          if (!cmd.createIfMissing) {
            return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
          }
          room = createEmptyRoom(cmd.roomId, cmd.roomName ?? cmd.roomId, gridW, Math.max(8, gridH));
          next.worldMap.rooms.push(room);
        }
        if (typeof cmd.editorFocusY === 'number') {
          room.editorFocusY = cmd.editorFocusY;
        }
        if (cmd.clearExistingRoomEntities) {
          next.entities = next.entities.filter((e) => {
            if (e.roomId !== room!.id) return true;
            const c = resolveEntityComponents(e, next.prefabs);
            return c.tag === 'hero' || c.tag === 'player';
          });
        }
        const ox = Math.max(0, Math.floor(cmd.originCol ?? 0));
        const oy = Math.max(0, Math.floor(cmd.originRow ?? 0));
        const ts = next.worldMap.tileSize;
        let painted = 0;
        let spawned = 0;
        for (let r = 0; r < cmd.lines.length; r++) {
          const line = cmd.lines[r];
          for (let c = 0; c < line.length; c++) {
            const ch = line[c];
            const entry = cmd.legend[ch];
            if (!entry) continue;
            const col = ox + c;
            const row = oy + r;
            if (col < 0 || row < 0 || col >= room.cols || row >= room.rows) continue;
            if (typeof entry.ground === 'number') {
              if (setRoomTile(room, 'ground', col, row, entry.ground)) painted++;
            }
            if (typeof entry.wall === 'number') {
              if (setRoomTile(room, 'wall', col, row, entry.wall)) painted++;
            }
            if (typeof entry.decor === 'number') {
              if (setRoomTile(room, 'decor', col, row, entry.decor)) painted++;
            }
            if (entry.prefabId) {
              const prefab = next.prefabs[entry.prefabId];
              if (!prefab) {
                return {
                  ok: false,
                  revision: this.revision,
                  summary: `ASCII 圖例 '${ch}' 找不到 Prefab`,
                  errors: [`Unknown prefabId "${entry.prefabId}" for legend glyph "${ch}"`],
                };
              }
              const prefix = entry.entityIdPrefix ?? `${room.id}_${entry.prefabId}`;
              let seq = 1;
              let eid = `${prefix}_${col}_${row}`;
              while (next.entities.some((e) => e.id === eid)) {
                seq++;
                eid = `${prefix}_${col}_${row}_${seq}`;
              }
              const pw = prefab.components.transform?.w ?? ts;
              const ph = prefab.components.transform?.h ?? ts;
              const px = col * ts + Math.round((ts - pw) * 0.5);
              const py = row * ts + (ts - ph);
              next.entities.push({
                id: eid,
                name: entry.entityName ?? prefab.name,
                roomId: room.id,
                prefabId: entry.prefabId,
                components: {},
                overrides: { transform: { x: px, y: py } },
              });
              createdEntityId = eid;
              spawned++;
            }
          }
        }
        summary = `ASCII 藍圖套用至「${room.name}」（繪製 ${painted} 格、生成 ${spawned} 個實體）`;
        break;
      }
      case 'set_world_map_config': {
        if (!next.worldMap) {
          return { ok: false, revision: this.revision, summary: '尚未建立地圖', errors: ['No worldMap'] };
        }
        if (cmd.startRoomId) {
          if (!next.worldMap.rooms.some((r) => r.id === cmd.startRoomId)) {
            return { ok: false, revision: this.revision, summary: '找不到起始房間', errors: [`Room not found: ${cmd.startRoomId}`] };
          }
          next.worldMap.startRoomId = cmd.startRoomId;
        }
        if (typeof cmd.tileSize === 'number' && cmd.tileSize >= 8 && cmd.tileSize <= 128) {
          next.worldMap.tileSize = Math.round(cmd.tileSize);
        }
        if (cmd.heroConfig) {
          next.worldMap.heroConfig = { ...(next.worldMap.heroConfig ?? {}), ...cmd.heroConfig };
        }
        if (typeof cmd.hostileProjectileTag === 'string' && cmd.hostileProjectileTag.trim()) {
          next.worldMap.hostileProjectileTag = cmd.hostileProjectileTag.trim();
        }
        summary = '更新多房間世界地圖核心設定';
        break;
      }
      case 'upsert_tile_def': {
        if (!next.worldMap) {
          return { ok: false, revision: this.revision, summary: '尚未建立地圖', errors: ['No worldMap'] };
        }
        const defs = [...(next.worldMap.tileDefs ?? [])];
        const idx = defs.findIndex((d) => d.id === cmd.tileDef.id);
        if (idx >= 0) defs[idx] = cmd.tileDef;
        else defs.push(cmd.tileDef);
        next.worldMap.tileDefs = defs;
        summary = `註冊自訂瓦片 #${cmd.tileDef.id}「${cmd.tileDef.name}」`;
        break;
      }
      case 'upsert_interaction_rule': {
        if (!next.worldMap) {
          return { ok: false, revision: this.revision, summary: '尚未建立地圖', errors: ['No worldMap'] };
        }
        const rules = [...(next.worldMap.interactions ?? [])];
        const idx = rules.findIndex((r) => r.tag === cmd.rule.tag);
        if (idx >= 0) rules[idx] = cmd.rule;
        else rules.push(cmd.rule);
        next.worldMap.interactions = rules;
        summary = `更新互動規則 tag="${cmd.rule.tag}"`;
        break;
      }
      case 'remove_interaction_rule': {
        if (!next.worldMap) {
          return { ok: false, revision: this.revision, summary: '尚未建立地圖', errors: ['No worldMap'] };
        }
        next.worldMap.interactions = (next.worldMap.interactions ?? []).filter((r) => r.tag !== cmd.tag);
        summary = `移除互動規則 tag="${cmd.tag}"`;
        break;
      }
      case 'upsert_ai_profile': {
        if (!next.worldMap) {
          return { ok: false, revision: this.revision, summary: '尚未建立地圖', errors: ['No worldMap'] };
        }
        next.worldMap.aiProfiles = { ...(next.worldMap.aiProfiles ?? {}), [cmd.tag]: cmd.profile };
        summary = `更新敵人/魔王 AI 規則 tag="${cmd.tag}"`;
        break;
      }
      case 'remove_ai_profile': {
        if (!next.worldMap?.aiProfiles) {
          return { ok: false, revision: this.revision, summary: '找不到 AI 規則', errors: [`AI profile not found: ${cmd.tag}`] };
        }
        const copy = { ...next.worldMap.aiProfiles };
        delete copy[cmd.tag];
        next.worldMap.aiProfiles = copy;
        summary = `移除 AI 規則 tag="${cmd.tag}"`;
        break;
      }
      case 'upsert_hud_gauge': {
        const list = [...next.hud];
        const idx = list.findIndex((g) => g.label === cmd.gauge.label);
        if (idx >= 0) list[idx] = cmd.gauge;
        else list.push(cmd.gauge);
        next.hud = list;
        summary = `更新 HUD 指標「${cmd.gauge.label}」`;
        break;
      }
      case 'remove_hud_gauge': {
        next.hud = next.hud.filter((g) => g.label !== cmd.label);
        summary = `移除 HUD 指標「${cmd.label}」`;
        break;
      }
      case 'upsert_custom_sprite': {
        const spriteErrs = validateCustomSpriteDef(cmd.sprite, 'sprite');
        if (spriteErrs.length > 0) {
          return { ok: false, revision: this.revision, summary: '自訂精靈定義驗證失敗', errors: spriteErrs };
        }
        const cleaned = JSON.parse(JSON.stringify(cmd.sprite)) as EcsCustomSpriteDef;
        if (!next.customSprites) next.customSprites = {};
        next.customSprites[cleaned.id] = cleaned;
        createdSpriteId = cleaned.id;
        summary = `更新自訂精靈「${cleaned.name ?? cleaned.id}」(${cleaned.width}×${cleaned.height})`;
        break;
      }
      case 'remove_custom_sprite': {
        if (!next.customSprites || !next.customSprites[cmd.spriteId]) {
          return {
            ok: false,
            revision: this.revision,
            summary: '找不到自訂精靈',
            errors: [`Custom sprite '${cmd.spriteId}' not found`],
          };
        }
        const copy = { ...next.customSprites };
        delete copy[cmd.spriteId];
        next.customSprites = copy;
        summary = `移除自訂精靈「${cmd.spriteId}」`;
        break;
      }
      case 'upsert_animation': {
        const animId = cmd.animation?.id?.trim() ?? '';
        if (!animId) {
          return { ok: false, revision: this.revision, summary: '動畫 ID 不可為空', errors: ['Animation id is required'] };
        }
        if (!Array.isArray(cmd.animation.clips) || cmd.animation.clips.length === 0) {
          return { ok: false, revision: this.revision, summary: '動畫至少需要一個 Clip', errors: ['Animation must have at least one clip'] };
        }
        const cleaned = JSON.parse(JSON.stringify(cmd.animation)) as AnimationStateMachineDef;
        cleaned.id = animId;
        if (!cleaned.initialState) cleaned.initialState = cleaned.clips[0].name;
        const list = [...next.animations];
        const idx = list.findIndex((a) => a.id === animId);
        if (idx >= 0) list[idx] = cleaned;
        else list.push(cleaned);
        next.animations = list;
        summary = `更新幀動畫狀態機「${animId}」(${cleaned.clips.length} 個片段)`;
        break;
      }
      case 'remove_animation': {
        const idx = next.animations.findIndex((a) => a.id === cmd.animationId);
        if (idx < 0) {
          return { ok: false, revision: this.revision, summary: '找不到動畫狀態機', errors: [`Animation '${cmd.animationId}' not found`] };
        }
        next.animations = next.animations.filter((a) => a.id !== cmd.animationId);
        summary = `移除幀動畫狀態機「${cmd.animationId}」`;
        break;
      }
      case 'upsert_cutscene': {
        const csErrs = validateCutsceneDef(cmd.cutscene, 'cutscene');
        if (csErrs.length > 0) {
          return { ok: false, revision: this.revision, summary: '導演分鏡腳本驗證失敗', errors: csErrs };
        }
        const cleaned = JSON.parse(JSON.stringify(cmd.cutscene)) as EcsCutsceneDef;
        const list = [...(next.cutscenes ?? [])];
        const idx = list.findIndex((c) => c.id === cleaned.id);
        if (idx >= 0) list[idx] = cleaned;
        else list.push(cleaned);
        next.cutscenes = list;
        summary = `更新導演分鏡腳本「${cleaned.name}」(${cleaned.shots.length} 顆鏡頭)`;
        break;
      }
      case 'remove_cutscene': {
        const list = next.cutscenes ?? [];
        if (!list.some((c) => c.id === cmd.cutsceneId)) {
          return {
            ok: false,
            revision: this.revision,
            summary: '找不到導演分鏡腳本',
            errors: [`Cutscene '${cmd.cutsceneId}' not found`],
          };
        }
        next.cutscenes = list.filter((c) => c.id !== cmd.cutsceneId);
        summary = `移除導演分鏡腳本「${cmd.cutsceneId}」`;
        break;
      }
      case 'set_room_voxel': {
        const room = next.worldMap?.rooms.find((r) => r.id === cmd.roomId);
        if (!room) {
          return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
        }
        setRoomVoxel(room, cmd.cell);
        summary =
          cmd.cell.tileId <= 0
            ? `清除 ${room.name} (${cmd.cell.col},${cmd.cell.row},z${cmd.cell.zLevel}) 體素`
            : `設定 ${room.name} (${cmd.cell.col},${cmd.cell.row},z${cmd.cell.zLevel}) 體素`;
        break;
      }
      case 'fill_room_box_3d': {
        const room = next.worldMap?.rooms.find((r) => r.id === cmd.roomId);
        if (!room) {
          return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
        }
        const filled = fillRoomBox3D(
          room,
          cmd.c0,
          cmd.r0,
          cmd.z0,
          cmd.c1,
          cmd.r1,
          cmd.z1,
          cmd.tileId,
          cmd.shape,
        );
        summary = `3D 體素填充 ${room.name} 共 ${filled} 格`;
        break;
      }
      case 'clear_room_voxels': {
        const room = next.worldMap?.rooms.find((r) => r.id === cmd.roomId);
        if (!room) {
          return { ok: false, revision: this.revision, summary: '找不到房間', errors: [`Room not found: ${cmd.roomId}`] };
        }
        if (cmd.zLevel !== undefined) {
          const targetZ = cmd.zLevel | 0;
          if (room.voxels) {
            room.voxels = room.voxels.filter((v) => (v.zLevel | 0) !== targetZ);
          }
          summary = `清除 ${room.name} z=${targetZ} 層體素`;
        } else {
          room.voxels = [];
          summary = `清除 ${room.name} 全部 3D 體素`;
        }
        break;
      }
      case 'upsert_model_3d': {
        const modelErrs = validateModel3DDef(cmd.model, 'model');
        if (modelErrs.length > 0) {
          return { ok: false, revision: this.revision, summary: '3D 模型定義驗證失敗', errors: modelErrs };
        }
        let cloned: EcsModel3DDef;
        try {
          cloned = structuredClone(cmd.model);
        } catch {
          cloned = JSON.parse(JSON.stringify(cmd.model)) as EcsModel3DDef;
        }
        if (!next.models3d) next.models3d = {};
        next.models3d[cloned.id] = cloned;
        summary = `註冊 3D 模型「${cloned.name}」(${cloned.id})`;
        break;
      }
      case 'remove_model_3d': {
        if (!next.models3d || !next.models3d[cmd.modelId]) {
          return {
            ok: false,
            revision: this.revision,
            summary: '找不到 3D 模型',
            errors: [`Model3D '${cmd.modelId}' not found`],
          };
        }
        const copy = { ...next.models3d };
        delete copy[cmd.modelId];
        next.models3d = copy;
        summary = `移除 3D 模型「${cmd.modelId}」`;
        break;
      }
      case 'set_camera_3d_pose': {
        const baseProj: EcsProjectionConfig = next.projection ?? {
          mode: 'hd2d_3d',
          elevationScale: 1.0,
          pitchDeg: 42,
          fovDeg: 38,
          wallHeightScale: 1.25,
          billboardTiltDeg: 12,
          obliqueShadowAlpha: 0.42,
          activeDimensionMask: 3,
          inactiveDimAlpha: 0.16,
          allowDimensionShift: false,
        };
        next.projection = {
          ...baseProj,
          ...(cmd.yawDeg !== undefined ? { yawDeg: cmd.yawDeg } : {}),
          ...(cmd.pitchDeg !== undefined ? { pitchDeg: cmd.pitchDeg } : {}),
          ...(cmd.rollDeg !== undefined ? { rollDeg: cmd.rollDeg } : {}),
          ...(cmd.fovDeg !== undefined ? { fovDeg: cmd.fovDeg } : {}),
          ...(cmd.camCenterZ !== undefined ? { camCenterZ: cmd.camCenterZ } : {}),
          ...(cmd.cameraProjection3d !== undefined ? { cameraProjection3d: cmd.cameraProjection3d } : {}),
          ...(cmd.quadView !== undefined ? { quadView: cmd.quadView } : {}),
          ...(cmd.shadowMapEnabled !== undefined ? { shadowMapEnabled: cmd.shadowMapEnabled } : {}),
          ...(cmd.shadowMapStrength !== undefined ? { shadowMapStrength: cmd.shadowMapStrength } : {}),
          ...(cmd.showAxisGizmo3d !== undefined ? { showAxisGizmo3d: cmd.showAxisGizmo3d } : {}),
          ...(cmd.showOrthoGrid3d !== undefined ? { showOrthoGrid3d: cmd.showOrthoGrid3d } : {}),
        };
        summary = `更新 3D 相機姿態 (${next.projection.cameraProjection3d ?? 'perspective'} · yaw ${Math.round(next.projection.yawDeg ?? 0)}° · pitch ${Math.round(next.projection.pitchDeg ?? 42)}°)`;
        break;
      }
      default:
        return { ok: false, revision: this.revision, summary: '未知指令', errors: ['Unknown ECS command'] };
    }

    const valid = validateEcsProjectV2(next);
    if (!valid.ok) {
      return { ok: false, revision: this.revision, summary: '驗證失敗並已自動復原', errors: valid.errors };
    }
    this.commit(prev, next, cmd.type, summary);
    return {
      ok: true,
      revision: this.revision,
      summary,
      errors: [],
      createdEntityId,
      createdPrefabId,
      createdSpriteId,
    };
  }

  /**
   * Executes multiple ECS Studio commands atomically as a single Undo/Redo transaction.
   * If any command fails validation, the entire batch rolls back cleanly with zero side effects.
   */
  public dispatchBatch(cmds: readonly EcsStudioCommand[], label?: string): EcsCommandResult {
    if (!Array.isArray(cmds) || cmds.length === 0) {
      return { ok: false, revision: this.revision, summary: '批次指令為空', errors: ['Batch command list is empty'] };
    }
    const prev = cloneEcsProject(this.doc);
    const sandbox = new EcsStudioSession(prev);
    const createdEntityIds: string[] = [];
    const createdPrefabIds: string[] = [];
    const createdSpriteIds: string[] = [];

    for (let i = 0; i < cmds.length; i++) {
      const res = sandbox.dispatch(cmds[i]);
      if (!res.ok) {
        return {
          ok: false,
          revision: this.revision,
          summary: `批次指令第 ${i + 1} 步失敗並已全部回滾`,
          errors: [`Step ${i} (${cmds[i].type}): ${res.errors.join('; ') || res.summary}`],
        };
      }
      if (res.createdEntityId) createdEntityIds.push(res.createdEntityId);
      if (res.createdPrefabId) createdPrefabIds.push(res.createdPrefabId);
      if (res.createdSpriteId) createdSpriteIds.push(res.createdSpriteId);
    }

    const next = sandbox.getProject();
    const valid = validateEcsProjectV2(next);
    if (!valid.ok) {
      return {
        ok: false,
        revision: this.revision,
        summary: '批次結果驗證失敗並已回滾',
        errors: valid.errors,
      };
    }

    const summary = label?.trim() ? label.trim() : `批次執行 ${cmds.length} 項 ECS 指令`;
    this.commit(prev, next, 'batch', summary);
    return {
      ok: true,
      revision: this.revision,
      summary,
      errors: [],
      ...(createdEntityIds.length > 0 ? { createdEntityId: createdEntityIds[createdEntityIds.length - 1], createdEntityIds } : {}),
      ...(createdPrefabIds.length > 0 ? { createdPrefabId: createdPrefabIds[createdPrefabIds.length - 1], createdPrefabIds } : {}),
      ...(createdSpriteIds.length > 0 ? { createdSpriteId: createdSpriteIds[createdSpriteIds.length - 1], createdSpriteIds } : {}),
    };
  }

  public undo(): EcsCommandResult {
    if (this.undoStack.length === 0) {
      return { ok: false, revision: this.revision, summary: '無可復原步驟', errors: ['Undo stack empty'] };
    }
    this.redoStack.push(cloneEcsProject(this.doc));
    this.doc = this.undoStack.pop()!;
    this.revision++;
    this.history.push({ revision: this.revision, type: 'undo', summary: '復原上一步變更' });
    const snap = cloneEcsProject(this.doc);
    for (const l of this.listeners) l(snap, this.revision);
    return { ok: true, revision: this.revision, summary: '已復原', errors: [] };
  }

  public redo(): EcsCommandResult {
    if (this.redoStack.length === 0) {
      return { ok: false, revision: this.revision, summary: '無可重做步驟', errors: ['Redo stack empty'] };
    }
    this.undoStack.push(cloneEcsProject(this.doc));
    this.doc = this.redoStack.pop()!;
    this.revision++;
    this.history.push({ revision: this.revision, type: 'redo', summary: '重做變更' });
    const snap = cloneEcsProject(this.doc);
    for (const l of this.listeners) l(snap, this.revision);
    return { ok: true, revision: this.revision, summary: '已重做', errors: [] };
  }

  public runHeadlessPlaytest(frames = 180): EcsPlaytestReport {
    const rt = new EcsCartridgeRuntime(cloneEcsProject(this.doc));
    const input = createEmptyInputState();
    const safeFrames = Math.max(1, Math.min(1800, Math.round(frames)));
    for (let f = 0; f < safeFrames; f++) {
      // Simulate periodic rhythmic action hits every 30 frames to exercise beat + turret loop
      input.action = f % 30 === 12;
      input.jump = f % 45 === 20;
      rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
    }
    const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    const globals: Record<string, number> = {};
    for (const [k, v] of rt.world.globals.entries()) {
      globals[k] = Math.round(v * 100) / 100;
    }
    return {
      framesSimulated: safeFrames,
      status: rt.getStatus(),
      score: snap.score,
      activeEntities: rt.world.activeCount,
      vmOpsLastFrame: rt.vm.getLastFrameOpCount(),
      systems: rt.world.getSystemPipeline(),
      viewport: {
        width: snap.viewport?.width ?? this.doc.viewport.width,
        height: snap.viewport?.height ?? this.doc.viewport.height,
      },
      globals,
    };
  }
}
