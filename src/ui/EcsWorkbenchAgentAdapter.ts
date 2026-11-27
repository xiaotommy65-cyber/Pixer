import type {
  PixelAtelierWorkbenchAgentApi,
  PixelAtelierWorkbenchState,
  WorkbenchCameraViewChoice,
  WorkbenchEditLayer,
  WorkbenchGizmoMode,
  WorkbenchSliceCutawayMode,
  WorkbenchToolId,
} from '../core/ai/AgentBridge.ts';
import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { MAX_VOXEL_STORIES } from '../core/ecs/EcsVoxelVolume.ts';
import type { MapDesignerState } from './EcsMapDesignerPanelTypes.ts';
import type { EcsWorkbenchMapCanvasController } from './EcsWorkbenchMapCanvasController.ts';
import type { EcsWorkbenchPreviewRuntime } from './EcsWorkbenchPreviewRuntime.ts';

const VALID_TOOLS: ReadonlySet<WorkbenchToolId> = new Set([
  'select',
  'brush',
  'rect',
  'fill',
  'erase',
  'eyedropper',
  'stamp',
  'pan',
]);
const VALID_GIZMO_MODES: ReadonlySet<WorkbenchGizmoMode> = new Set(['move', 'rotate', 'scale']);
const VALID_EDIT_LAYERS: ReadonlySet<WorkbenchEditLayer> = new Set(['ground', 'wall', 'decor', 'voxel3d']);
const VALID_CUTAWAY_MODES: ReadonlySet<WorkbenchSliceCutawayMode> = new Set([
  'all',
  'ghost_above',
  'solo_floor',
]);
const VALID_VIEW_MODES: ReadonlySet<WorkbenchCameraViewChoice> = new Set([
  'perspective',
  'ortho_top',
  'ortho_front',
  'ortho_side',
  'ortho_iso',
  'quad',
]);

export interface WorkbenchAgentAdapterDeps {
  session: EcsStudioSession;
  runtime: EcsCartridgeRuntime;
  mapState: MapDesignerState;
  previewRuntime: EcsWorkbenchPreviewRuntime;
  mapCanvasCtrl: EcsWorkbenchMapCanvasController;
  getPreviewCanvas: () => HTMLCanvasElement;
  isDestroyed: () => boolean;
  getSelectedEntityIds: () => readonly string[];
  setSelectedEntityIds: (ids: readonly string[]) => void;
  onRefreshUi: () => void;
}

/**
 * Live AI-Human Co-Editing adapter binding `window.__PIXEL_ATELIER_AGENT__.workbench` directly
 * to the mounted `EcsWorkbenchView` selection, camera, layer, Z-slice cutaway, and viewport capture.
 */
export function createWorkbenchAgentApi(deps: WorkbenchAgentAdapterDeps): PixelAtelierWorkbenchAgentApi {
  return {
    isMounted: () => !deps.isDestroyed(),

    getState: (): PixelAtelierWorkbenchState | null => {
      if (deps.isDestroyed()) return null;
      const proj = deps.session.getProject();
      const wmCtrl = deps.runtime.getWorldMapController();
      const cam = deps.runtime.getCamera();
      const quadView = Boolean(proj.projection?.quadView);
      const rawCamProj = proj.projection?.cameraProjection3d;
      const viewMode: WorkbenchCameraViewChoice = quadView
        ? 'quad'
        : rawCamProj && VALID_VIEW_MODES.has(rawCamProj as WorkbenchCameraViewChoice)
          ? (rawCamProj as WorkbenchCameraViewChoice)
          : 'perspective';
      return {
        activeRoomId: deps.runtime.getActiveRoomId() || proj.worldMap?.startRoomId || '',
        selectedEntityIds: [...deps.getSelectedEntityIds()],
        activeTool: deps.mapState.tool,
        gizmoMode: deps.mapState.gizmoMode,
        editLayer: deps.mapState.editLayer,
        activeZLevel: deps.mapState.activeZLevel,
        sliceCutawayMode: deps.mapState.sliceCutawayMode,
        snapStep: deps.mapState.snapStep,
        extrudeStories: deps.mapState.extrudeStories,
        cameraX: cam.x,
        cameraY: cam.y,
        editorZoom: wmCtrl.getEditorZoom(),
        simRunning: deps.previewRuntime.isSimRunning(),
        viewMode,
        quadView,
      };
    },

    setSelection: (entityIds: string[]): string[] => {
      if (deps.isDestroyed()) return [];
      const proj = deps.session.getProject();
      const validIds = new Set(proj.entities.map((e) => e.id));
      const next: string[] = [];
      const seen = new Set<string>();
      for (const id of entityIds) {
        if (validIds.has(id) && !seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
      deps.setSelectedEntityIds(next);
      return [...deps.getSelectedEntityIds()];
    },

    focusSelection: (): boolean => {
      if (deps.isDestroyed()) return false;
      return deps.previewRuntime.focusEntities(deps.getSelectedEntityIds());
    },

    focusEntity: (entityId: string): boolean => {
      if (deps.isDestroyed()) return false;
      const proj = deps.session.getProject();
      const ent = proj.entities.find((e) => e.id === entityId);
      if (!ent) return false;
      if (proj.worldMap && ent.roomId && deps.runtime.getActiveRoomId() !== ent.roomId) {
        deps.previewRuntime.switchActiveRoom(ent.roomId);
      }
      deps.setSelectedEntityIds([ent.id]);
      return deps.previewRuntime.focusEntities([ent.id]);
    },

    setActiveRoom: (roomId: string): boolean => {
      if (deps.isDestroyed()) return false;
      const proj = deps.session.getProject();
      if (!proj.worldMap?.rooms.some((r) => r.id === roomId)) return false;
      deps.previewRuntime.switchActiveRoom(roomId);
      return deps.runtime.getActiveRoomId() === roomId;
    },

    setActiveZLevel: (zLevel: number): number => {
      if (deps.isDestroyed()) return 0;
      const clamped = Math.max(
        0,
        Math.min(MAX_VOXEL_STORIES - 1, Math.round(Number.isFinite(zLevel) ? zLevel : 0)),
      );
      deps.mapState.activeZLevel = clamped;
      deps.previewRuntime.syncEditorSliceCutaway();
      deps.previewRuntime.renderPreviewNow();
      deps.onRefreshUi();
      return deps.mapState.activeZLevel;
    },

    setSliceCutaway: (mode: WorkbenchSliceCutawayMode): WorkbenchSliceCutawayMode => {
      if (deps.isDestroyed()) return 'all';
      if (VALID_CUTAWAY_MODES.has(mode)) {
        deps.mapState.sliceCutawayMode = mode;
        deps.previewRuntime.syncEditorSliceCutaway();
        deps.previewRuntime.renderPreviewNow();
        deps.onRefreshUi();
      }
      return deps.mapState.sliceCutawayMode;
    },

    setTool: (tool: WorkbenchToolId): WorkbenchToolId => {
      if (deps.isDestroyed()) return 'select';
      if (VALID_TOOLS.has(tool)) {
        deps.mapState.tool = tool;
        if (tool !== 'stamp') {
          deps.mapState.selectedStampPrefabId = null;
        }
        deps.mapCanvasCtrl.syncInteractivity();
        deps.previewRuntime.markDirty();
        deps.mapCanvasCtrl.renderOverlay();
        deps.onRefreshUi();
      }
      return deps.mapState.tool;
    },

    setGizmoMode: (mode: WorkbenchGizmoMode): WorkbenchGizmoMode => {
      if (deps.isDestroyed()) return 'move';
      if (VALID_GIZMO_MODES.has(mode)) {
        deps.mapState.gizmoMode = mode;
        deps.previewRuntime.markDirty();
        deps.mapCanvasCtrl.renderOverlay();
        deps.onRefreshUi();
      }
      return deps.mapState.gizmoMode;
    },

    setLayer: (layer: WorkbenchEditLayer): WorkbenchEditLayer => {
      if (deps.isDestroyed()) return 'ground';
      if (VALID_EDIT_LAYERS.has(layer)) {
        deps.mapState.editLayer = layer;
        if (layer !== 'voxel3d') {
          deps.mapState.layer = layer;
        }
        deps.previewRuntime.markDirty();
        deps.mapCanvasCtrl.renderOverlay();
        deps.onRefreshUi();
      }
      return deps.mapState.editLayer;
    },

    setSnapStep: (stepPx: number): number => {
      if (deps.isDestroyed()) return 0;
      const next = Number.isFinite(stepPx) ? Math.max(0, Math.round(stepPx)) : 0;
      deps.mapState.snapStep = next;
      deps.onRefreshUi();
      return deps.mapState.snapStep;
    },

    setEditorCamera: (x: number, y: number, zoom?: number): boolean => {
      if (deps.isDestroyed() || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      deps.runtime.setEditorCamera(x, y);
      if (zoom !== undefined && Number.isFinite(zoom)) {
        deps.runtime.getWorldMapController().setEditorZoom(zoom);
      }
      deps.previewRuntime.markDirty();
      deps.previewRuntime.renderPreviewNow();
      return true;
    },

    resetEditorCamera: (): boolean => {
      if (deps.isDestroyed()) return false;
      deps.previewRuntime.resetEditorCamera();
      return true;
    },

    setViewMode: (view: WorkbenchCameraViewChoice): boolean => {
      if (deps.isDestroyed() || !VALID_VIEW_MODES.has(view)) return false;
      const res =
        view === 'quad'
          ? deps.session.dispatch({ type: 'set_camera_3d_pose', quadView: true })
          : deps.session.dispatch({ type: 'set_camera_3d_pose', cameraProjection3d: view, quadView: false });
      return res.ok;
    },

    setSimRunning: (running: boolean): boolean => {
      if (deps.isDestroyed()) return false;
      deps.previewRuntime.setSimRunning(Boolean(running));
      return deps.previewRuntime.isSimRunning();
    },

    captureViewportPng: (): string | null => {
      if (deps.isDestroyed()) return null;
      deps.previewRuntime.renderPreviewNow();
      try {
        return deps.getPreviewCanvas().toDataURL('image/png');
      } catch {
        return null;
      }
    },
  };
}
