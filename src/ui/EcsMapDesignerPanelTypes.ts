import type {
  WorkbenchEditLayer,
  WorkbenchGizmoMode,
  WorkbenchSliceCutawayMode,
  WorkbenchToolId,
} from '../core/ai/AgentBridge.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import type { EcsVoxelShape } from '../core/ecs/EcsVoxelVolume.ts';

export type MapToolMode = WorkbenchToolId;
export type MapEditLayer = WorkbenchEditLayer;
export type MapGizmoMode = WorkbenchGizmoMode;
export type MapSliceCutawayMode = WorkbenchSliceCutawayMode;

export interface MapDesignerState {
  tool: MapToolMode;
  layer: EcsMapLayerName;
  /** Explicit 4-way target layer: 2D ground/wall/decor OR dedicated 3D voxel layer ('voxel3d'). */
  editLayer: MapEditLayer;
  gizmoMode: MapGizmoMode;
  /** Snap step in world px (0 = free, 8 / 16 / 32); Z snaps to storyHeight when snapStep > 0. */
  snapStep: number;
  sliceCutawayMode: MapSliceCutawayMode;
  /** Multi-story box extrusion height (1..8) when using Rect tool on voxel3d layer. */
  extrudeStories: number;
  /** Transient Space-key pan hold state in Edit Mode. */
  spacePanHeld: boolean;
  selectedTileId: number;
  selectedStampPrefabId: string | null;
  activeZLevel: number;
  voxelShape: EcsVoxelShape;
  showGrid: boolean;
  showPortals: boolean;
  showFovPreview: boolean;
}
