import type { ViewportPreset } from '../gpu/GpuTypes.ts';
import type { Camera3DProjectionMode } from '../math/Perspective3DMath.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../types/WorldTypes.ts';
import { EcsCartridgeRuntime } from './EcsCartridgeRuntime.ts';
import type { EcsEventGraphLayoutMap } from './EcsEventGraph.ts';
import type { EcsModel3DDef } from './EcsModel3D.ts';
import {
  cloneEcsProject,
  getEntityPrefabId,
  validateEcsProjectV2,
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
  ECS_ATTACHABLE_COMPONENTS,
  handleAlignEntities,
  handleAttachComponent,
  handleClearRoomVoxels,
  handleCreatePrefab,
  handleDeletePrefab,
  handleDeleteRoom,
  handleDetachComponent,
  handleDuplicateEntities,
  handleEnsureWorldMap,
  handleFillRect,
  handleFillRoomBox3D,
  handleFloodFill,
  handleInstantiatePrefab,
  handlePaintTiles,
  handlePatchEntity,
  handleRemoveAiProfile,
  handleRemoveAnimation,
  handleRemoveCustomSprite,
  handleRemoveCutscene,
  handleRemoveEntity,
  handleRemoveHudGauge,
  handleRemoveInteractionRule,
  handleRemoveModel3D,
  handleRemovePortal,
  handleRemoveScript,
  handleRevertPrefabOverrides,
  handleSaveEntityAsPrefab,
  handleSetAtmosphere,
  handleSetCamera3DPose,
  handleSetGlobal,
  handleSetProjection,
  handleSetRoomVoxel,
  handleSetViewport,
  handleSetWorldMapConfig,
  handleSpawnEntity,
  handleStampRoomAscii,
  handleTransformEntities,
  handleUnlinkPrefab,
  handleUpdatePrefab,
  handleUpsertAiProfile,
  handleUpsertAnimation,
  handleUpsertCustomSprite,
  handleUpsertCutscene,
  handleUpsertHudGauge,
  handleUpsertInteractionRule,
  handleUpsertModel3D,
  handleUpsertPortal,
  handleUpsertRoom,
  handleUpsertScript,
  handleUpsertTileDef,
  type EcsAlignEntitiesMode,
  type EcsAsciiLegendEntry,
  type EcsAttachableComponent,
  type EcsCommandHandlerOutcome,
  type EcsCommandResult,
} from './EcsStudioCommandHandlers.ts';
import type {
  EcsMapInteractionRule,
  EcsMapLayerName,
  EcsMapPortalDef,
  EcsMapRoomDef,
  EcsTileDef,
  EcsTopDownAiProfile,
  EcsTopDownHeroConfig,
  EcsVoxelCellDef,
  EcsVoxelShape,
} from './EcsTilemapTypes.ts';

export {
  ECS_ATTACHABLE_COMPONENTS,
  type EcsAlignEntitiesMode,
  type EcsAsciiLegendEntry,
  type EcsAttachableComponent,
  type EcsCommandResult,
};

export interface EcsModel3DSummary {
  id: string;
  name: string;
  partCount: number;
  hasRawMesh: boolean;
  clipCount: number;
  boundsSize?: readonly [number, number, number];
}

export interface EcsPrefabSummary {
  id: string;
  name: string;
  category: string;
  instanceCount: number;
  componentKeys: string[];
  spriteId?: string;
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
      z?: number;
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
      autoFollowHeroZ?: boolean;
      roofCutawayMode?: 'auto' | 'always' | 'off';
      roofCutawayAlpha?: number;
      cameraProjection3d?: Camera3DProjectionMode;
      quadView?: boolean;
      shadowMapEnabled?: boolean;
      shadowMapStrength?: number;
      showAxisGizmo3d?: boolean;
      showOrthoGrid3d?: boolean;
    }
  | {
      type: 'duplicate_entities';
      entityIds: string[];
      offsetX?: number;
      offsetY?: number;
      offsetZ?: number;
      targetRoomId?: string;
    }
  | {
      type: 'transform_entities';
      entityIds: string[];
      deltaX?: number;
      deltaY?: number;
      deltaZ?: number;
      deltaYaw?: number;
      scaleMult?: number;
      snapGrid?: number;
      snapStoryZ?: boolean;
    }
  | {
      type: 'align_entities';
      entityIds: string[];
      mode: EcsAlignEntitiesMode;
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
  { type: 'instantiate_prefab', category: 'prefab', fields: 'prefabId, entityId?, name?, x?, y?, z?, roomId?, overrides?', note: 'Spawn a linked prefab instance in a room (optional z snaps spatial3d.z to a 3D story).' },
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
  { type: 'set_projection', category: 'scene', fields: 'patch: {mode?: "ortho_2d"|"hd2d_iso"|"hd2d_3d"|"first_person_25d", pitchDeg?, yawDeg?, rollDeg?, camCenterZ?, autoFollowHeroZ?, roofCutawayMode?: "auto"|"always"|"off", roofCutawayAlpha?, fovDeg?, wallHeightScale?, billboardTiltDeg?, obliqueShadowAlpha?, elevationScale?, perspectiveSkew?, activeDimensionMask?, allowDimensionShift?}', note: 'Switch between True 3D HD-2D Perspective (hd2d_3d), 3/4 Strong-Volume 2.5D (hd2d_iso), ortho_2d, or first_person_25d.' },
  { type: 'upsert_script', category: 'script', fields: 'script: EcsScriptDef, graphLayout?', note: 'Upsert sandbox VM script / EventGraph.' },
  { type: 'remove_script', category: 'script', fields: 'scriptId', note: 'Delete a script and graph layout, and detach it from all entities.' },
  { type: 'set_room_voxel', category: 'world_map', fields: 'roomId, cell: {col,row,zLevel,tileId,shape?,rotZ?}', note: 'Place or remove (tileId<=0) a multi-story 3D voxel cell in a room.' },
  { type: 'fill_room_box_3d', category: 'world_map', fields: 'roomId, c0, r0, z0, c1, r1, z1, tileId, shape?', note: 'Fill a 3D rectangular voxel box across columns, rows, and z-stories.' },
  { type: 'clear_room_voxels', category: 'world_map', fields: 'roomId, zLevel?', note: 'Clear all 3D voxels in a room (or on a specific zLevel story).' },
  { type: 'upsert_model_3d', category: 'assets', fields: 'model: {id, name, parts[], rawMesh?, clips?, boundsSize?}', note: 'Create or update a 3D cuboid or glTF rawMesh model asset in project.models3d.' },
  { type: 'remove_model_3d', category: 'assets', fields: 'modelId', note: 'Remove a 3D model asset from project.models3d.' },
  { type: 'set_camera_3d_pose', category: 'scene', fields: 'yawDeg?, pitchDeg?, rollDeg?, fovDeg?, camCenterZ?, autoFollowHeroZ?, roofCutawayMode?, roofCutawayAlpha?, cameraProjection3d?, quadView?, shadowMapEnabled?, shadowMapStrength?, showAxisGizmo3d?, showOrthoGrid3d?', note: 'Configure 6DoF 3D camera pose, auto Z-follow, interior roof cutaway, orthographic projection, quad-view split, shadow map, and 3D gizmos.' },
  { type: 'duplicate_entities', category: 'entity', fields: 'entityIds[], offsetX?, offsetY?, offsetZ?, targetRoomId?', note: 'Clone one or more entities in a single Undo step with optional 2D/3D offset and target room.' },
  { type: 'transform_entities', category: 'entity', fields: 'entityIds[], deltaX?, deltaY?, deltaZ?, deltaYaw?, scaleMult?, snapGrid?, snapStoryZ?', note: 'Batch move, elevate, rotate yaw, scale, and grid/story snap entities in one Undo step.' },
  { type: 'align_entities', category: 'entity', fields: 'entityIds[], mode: "align_x"|"align_y"|"align_z"|"distribute_x"|"distribute_y"|"snap_floor"', note: 'Align/distribute selected entities along X/Y/Z or snap entities to exact 3D voxel floor support height.' },
] as const;

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

  public listModels3D(): EcsModel3DSummary[] {
    const map = this.doc.models3d;
    if (!map) return [];
    const out: EcsModel3DSummary[] = [];
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
    if (cmd.type === 'load_project') {
      const loaded = cloneEcsProject(cmd.project);
      const check = validateEcsProjectV2(loaded);
      if (!check.ok) return { ok: false, revision: this.revision, summary: '載入失敗', errors: check.errors };
      this.commit(prev, loaded, 'load_project', `載入 ECS 專案「${loaded.meta.title}」`);
      return { ok: true, revision: this.revision, summary: `已載入「${loaded.meta.title}」`, errors: [] };
    }

    const next = cloneEcsProject(this.doc);
    const res = this.applyCommand(next, cmd);
    if (!res.ok || res.skipValidationAndCommit) {
      return { ok: res.ok, revision: this.revision, summary: res.summary, errors: res.errors };
    }

    const valid = validateEcsProjectV2(next);
    if (!valid.ok) {
      return { ok: false, revision: this.revision, summary: '驗證失敗並已自動復原', errors: valid.errors };
    }
    this.commit(prev, next, cmd.type, res.summary);
    return {
      ok: true,
      revision: this.revision,
      summary: res.summary,
      errors: [],
      createdEntityId: res.createdEntityId,
      ...(res.createdEntityIds && res.createdEntityIds.length > 0 ? { createdEntityIds: res.createdEntityIds } : {}),
      createdPrefabId: res.createdPrefabId,
      createdSpriteId: res.createdSpriteId,
    };
  }

  private applyCommand(next: EcsProjectV2, cmd: Exclude<EcsStudioCommand, { type: 'load_project' }>): EcsCommandHandlerOutcome {
    switch (cmd.type) {
      case 'set_viewport':
        return handleSetViewport(next, cmd.preset, cmd.width, cmd.height);
      case 'spawn_entity':
        return handleSpawnEntity(next, cmd.entity);
      case 'remove_entity':
        return handleRemoveEntity(next, cmd.entityId);
      case 'patch_entity':
        return handlePatchEntity(next, cmd.entityId, cmd.patch);
      case 'attach_component':
        return handleAttachComponent(next, cmd.entityId, cmd.component, cmd.value);
      case 'detach_component':
        return handleDetachComponent(next, cmd.entityId, cmd.component);
      case 'create_prefab':
        return handleCreatePrefab(next, cmd.prefab);
      case 'update_prefab':
        return handleUpdatePrefab(next, cmd);
      case 'delete_prefab':
        return handleDeletePrefab(next, cmd.prefabId, cmd.mode);
      case 'save_entity_as_prefab':
        return handleSaveEntityAsPrefab(next, cmd);
      case 'instantiate_prefab':
        return handleInstantiatePrefab(next, cmd);
      case 'revert_prefab_overrides':
        return handleRevertPrefabOverrides(next, cmd.entityId, cmd.keepPosition);
      case 'unlink_prefab':
        return handleUnlinkPrefab(next, cmd.entityId);
      case 'upsert_script':
        return handleUpsertScript(next, cmd.script, cmd.graphLayout);
      case 'remove_script':
        return handleRemoveScript(next, cmd.scriptId);
      case 'set_global':
        return handleSetGlobal(next, cmd.key, cmd.value);
      case 'set_atmosphere':
        return handleSetAtmosphere(next, cmd.patch);
      case 'set_projection':
        return handleSetProjection(next, cmd.patch);
      case 'ensure_world_map':
        return handleEnsureWorldMap(next, cmd.cols, cmd.rows, cmd.roomName);
      case 'paint_tiles':
        return handlePaintTiles(next, cmd.roomId, cmd.layer, cmd.changes);
      case 'fill_rect':
        return handleFillRect(next, cmd.roomId, cmd.layer, cmd.c0, cmd.r0, cmd.c1, cmd.r1, cmd.tileId);
      case 'flood_fill':
        return handleFloodFill(next, cmd.roomId, cmd.layer, cmd.col, cmd.row, cmd.tileId);
      case 'stamp_room_ascii':
        return handleStampRoomAscii(next, cmd);
      case 'upsert_room':
        return handleUpsertRoom(next, cmd.room);
      case 'delete_room':
        return handleDeleteRoom(next, cmd.roomId);
      case 'upsert_portal':
        return handleUpsertPortal(next, cmd.portal);
      case 'remove_portal':
        return handleRemovePortal(next, cmd.portalId);
      case 'set_world_map_config':
        return handleSetWorldMapConfig(next, cmd);
      case 'upsert_tile_def':
        return handleUpsertTileDef(next, cmd.tileDef);
      case 'upsert_interaction_rule':
        return handleUpsertInteractionRule(next, cmd.rule);
      case 'remove_interaction_rule':
        return handleRemoveInteractionRule(next, cmd.tag);
      case 'upsert_ai_profile':
        return handleUpsertAiProfile(next, cmd.tag, cmd.profile);
      case 'remove_ai_profile':
        return handleRemoveAiProfile(next, cmd.tag);
      case 'upsert_hud_gauge':
        return handleUpsertHudGauge(next, cmd.gauge);
      case 'remove_hud_gauge':
        return handleRemoveHudGauge(next, cmd.label);
      case 'upsert_custom_sprite':
        return handleUpsertCustomSprite(next, cmd.sprite);
      case 'remove_custom_sprite':
        return handleRemoveCustomSprite(next, cmd.spriteId);
      case 'upsert_animation':
        return handleUpsertAnimation(next, cmd.animation);
      case 'remove_animation':
        return handleRemoveAnimation(next, cmd.animationId);
      case 'upsert_cutscene':
        return handleUpsertCutscene(next, cmd.cutscene);
      case 'remove_cutscene':
        return handleRemoveCutscene(next, cmd.cutsceneId);
      case 'set_room_voxel':
        return handleSetRoomVoxel(next, cmd.roomId, cmd.cell);
      case 'fill_room_box_3d':
        return handleFillRoomBox3D(next, cmd);
      case 'clear_room_voxels':
        return handleClearRoomVoxels(next, cmd.roomId, cmd.zLevel);
      case 'upsert_model_3d':
        return handleUpsertModel3D(next, cmd.model);
      case 'remove_model_3d':
        return handleRemoveModel3D(next, cmd.modelId);
      case 'set_camera_3d_pose':
        return handleSetCamera3DPose(next, cmd);
      case 'duplicate_entities':
        return handleDuplicateEntities(next, cmd);
      case 'transform_entities':
        return handleTransformEntities(next, cmd);
      case 'align_entities':
        return handleAlignEntities(next, cmd);
      default:
        return { ok: false, summary: '未知指令', errors: ['Unknown ECS command'] };
    }
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
      if (res.createdEntityIds && res.createdEntityIds.length > 0) {
        createdEntityIds.push(...res.createdEntityIds);
      } else if (res.createdEntityId) {
        createdEntityIds.push(res.createdEntityId);
      }
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
