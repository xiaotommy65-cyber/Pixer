import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { PixelAtelierWorkbenchAgentApi } from '../core/ai/AgentBridge.ts';
import { analyzeWorldMapReachability } from '../core/ai/EcsSpatialOracle.ts';
import { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import { syncProjectCustomSpritesToAtlas } from '../core/ecs/EcsCustomSpriteCompiler.ts';
import type { EcsPrefabDef, EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand, EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import { GpuEngine } from '../core/gpu/GpuEngine.ts';
import {
  buildInteropStudioCommands,
  type InteropCommitOptions,
  type InteropImportResult,
} from '../core/interop/index.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import {
  createDefaultMapDesignerState,
  renderMapDesignerPane,
  type MapDesignerState,
} from './EcsMapDesignerPanel.ts';
import { createWorkbenchAgentApi } from './EcsWorkbenchAgentAdapter.ts';
import { renderAtlasPanel } from './EcsWorkbenchAtlasPanel.ts';
import {
  BUILTIN_ECS_PROJECTS,
  COMPONENT_CATALOG,
  HD_SPRITE_OPTIONS,
  collectProjectSpriteOptions,
  createWorkbenchSliderRow,
  runWorkbenchSpatialDiagnostics,
  type WorkbenchDiagReport,
} from './EcsWorkbenchCatalog.ts';
import {
  buildEntityInspectorSections,
  buildMultiSelectInspectorSection,
} from './EcsWorkbenchEntityInspector.ts';
import { renderHierarchyPane, renderPrefabsPane } from './EcsWorkbenchHierarchyPanels.ts';
import { EcsWorkbenchLiveMutator } from './EcsWorkbenchLiveMutator.ts';
import { EcsWorkbenchMapCanvasController } from './EcsWorkbenchMapCanvasController.ts';
import { renderPrefabInspectorPanel } from './EcsWorkbenchPrefabInspector.ts';
import { EcsWorkbenchPreviewRuntime } from './EcsWorkbenchPreviewRuntime.ts';
import { buildDiagReportBox, buildSceneAndHistorySections } from './EcsWorkbenchSceneInspector.ts';
import {
  buildEcsWorkbenchShell,
  type EcsWorkbenchShellRefs,
  type WorkbenchCenterMode,
  type WorkbenchLeftTab,
} from './EcsWorkbenchShellBuilder.ts';
import { EcsWorldRulesInspectorPanel } from './EcsWorldRulesInspectorPanel.ts';
import type { CloudPublishModalView } from './CloudPublishModalView.ts';
import type { EventGraphEditorView } from './EventGraphEditorView.ts';
import type { ExternalImportModalView } from './ExternalImportModalView.ts';
import type { ModelAtelierModalView } from './ModelAtelierModalView.ts';

export interface EcsWorkbenchCallbacks {
  onLaunchInArcade: (proj: EcsProjectV2) => void;
  onOpenClassicWorkshop: () => void;
  onOpenSpriteAtelierForTile?: (layer: EcsMapLayerName) => void;
  onAtlasMutated: () => void;
}

/**
 * Pixer True ECS Workstation Coordinator Shell:
 * orchestrates session state, lazy preview GPU lifecycle, panel rendering, and lazy modal imports
 * while delegating preview/playtest/cutscene runtime to `EcsWorkbenchPreviewRuntime`.
 */
export class EcsWorkbenchView {
  public readonly element: HTMLElement;
  private readonly ac = new AbortController();
  private readonly host: EngineHost;
  private readonly atlas: TextureAtlas;
  private readonly session: EcsStudioSession;
  private readonly callbacks: EcsWorkbenchCallbacks;
  private readonly unsubSession: () => void;

  private readonly dom: EcsWorkbenchShellRefs;
  private readonly previewGpu: GpuEngine;
  private readonly runtime: EcsCartridgeRuntime;
  private readonly previewRuntime: EcsWorkbenchPreviewRuntime;
  private readonly liveMutator: EcsWorkbenchLiveMutator;
  private readonly mapCanvasCtrl: EcsWorkbenchMapCanvasController;
  private readonly eventGraphSlotEl: HTMLDivElement;
  private eventGraphView: EventGraphEditorView | null = null;
  private eventGraphLoadPromise: Promise<EventGraphEditorView | null> | null = null;
  private readonly externalImportSlotEl: HTMLDivElement;
  private externalImportModal: ExternalImportModalView | null = null;
  private externalImportLoadPromise: Promise<ExternalImportModalView> | null = null;
  private cloudPublishModal: CloudPublishModalView | null = null;
  private cloudPublishLoadPromise: Promise<CloudPublishModalView | null> | null = null;
  private modelAtelierModal: ModelAtelierModalView | null = null;
  private modelAtelierLoadPromise: Promise<ModelAtelierModalView | null> | null = null;
  private readonly worldRulesPanel: EcsWorldRulesInspectorPanel;
  private readonly agentWorkbenchApi: PixelAtelierWorkbenchAgentApi;

  private leftTab: WorkbenchLeftTab = 'map';
  private centerMode: WorkbenchCenterMode = 'viewport';
  private selectedEntityIds: string[] = [];
  private selectedEntityId: string | null = null;
  private selectedPrefabId: string | null = null;
  private filterQuery = '';
  private prefabFilterQuery = '';
  private visible = false;
  private previewGpuInitialized = false;
  private destroyed = false;
  private syncedCustomSpriteIds = new Set<string>();
  private lastLoadedProjectId: string;
  private readonly mapState: MapDesignerState = createDefaultMapDesignerState();
  private lastDiagReport: WorkbenchDiagReport | null = null;

  constructor(
    host: EngineHost,
    atlas: TextureAtlas,
    session: EcsStudioSession,
    callbacks: EcsWorkbenchCallbacks,
  ) {
    this.host = host;
    this.atlas = atlas;
    this.session = session;
    this.callbacks = callbacks;

    const initialProj = session.getProject();
    this.syncedCustomSpriteIds = syncProjectCustomSpritesToAtlas(
      this.atlas,
      initialProj,
      this.syncedCustomSpriteIds,
    );
    this.lastLoadedProjectId = initialProj.meta.id;
    this.selectedEntityId = initialProj.entities[0]?.id ?? null;
    this.selectedEntityIds = this.selectedEntityId ? [this.selectedEntityId] : [];
    this.leftTab = initialProj.worldMap ? 'map' : 'hierarchy';
    const initialSimRunning = !initialProj.worldMap;
    this.runtime = new EcsCartridgeRuntime(initialProj);

    this.eventGraphSlotEl = document.createElement('div');
    this.eventGraphSlotEl.className = 'p7-eg-root panel-hidden';
    this.externalImportSlotEl = document.createElement('div');
    this.externalImportSlotEl.hidden = true;
    this.worldRulesPanel = new EcsWorldRulesInspectorPanel({
      onFocusRoom: (roomId) => this.previewRuntime.switchActiveRoom(roomId),
      getSpriteOptions: (proj) => collectProjectSpriteOptions(proj),
    });

    const { signal } = this.ac;
    this.dom = buildEcsWorkbenchShell({
      initialProject: initialProj,
      initialLeftTab: this.leftTab,
      initialPlayPauseLabel: initialProj.worldMap ? '開始試玩' : '暫停模擬',
      eventGraphEl: this.eventGraphSlotEl,
      externalImportModalEl: this.externalImportSlotEl,
      signal,
      onOpenExternalImport: () => {
        void this.openExternalImportModal();
      },
      onOpenModelAtelier: () => {
        void this.openModelAtelierModal();
      },
      onOpenClassicWorkshop: () => this.callbacks.onOpenClassicWorkshop(),
      onSelectBuiltinProject: (project) => {
        this.lastDiagReport = null;
        this.selectedPrefabId = null;
        this.session.dispatch({ type: 'load_project', project });
      },
      onSelectLeftTab: (tab) => this.setLeftTab(tab),
      onSelectViewportPreset: (preset) => {
        this.session.dispatch({ type: 'set_viewport', preset });
      },
      onTogglePlayPause: () => this.previewRuntime.setSimRunning(!this.previewRuntime.isSimRunning()),
      onStepFrame: () => this.previewRuntime.stepSingleFrame(),
      onResetRuntime: () => this.previewRuntime.resetRuntime(),
      onToggleDebugOverlay: () => this.previewRuntime.toggleDebugOverlay(),
      onUndo: () => this.session.undo(),
      onRedo: () => this.session.redo(),
      onRunDiagnostics: () => {
        this.lastDiagReport = runWorkbenchSpatialDiagnostics(this.session);
        this.renderRightPanel();
      },
      onOpenCloudPublish: () => {
        void this.openCloudPublishModal();
      },
      onSelectCenterMode: (mode) => this.setCenterMode(mode),
      onSwitchRoom: (roomId) => this.previewRuntime.switchActiveRoom(roomId),
      onHitActionA: () => {
        this.host.unlockAudio();
        if (this.session.getProject().worldMap && !this.previewRuntime.isSimRunning()) {
          this.previewRuntime.setSimRunning(true);
        }
        this.previewRuntime.pulseAction(4);
      },
      onHitActionB: () => {
        this.host.unlockAudio();
        if (this.session.getProject().worldMap && !this.previewRuntime.isSimRunning()) {
          this.previewRuntime.setSimRunning(true);
        }
        this.previewRuntime.pulseJump(4);
      },
      onShiftRealm: () => {
        this.host.unlockAudio();
        this.previewRuntime.pulseShift(2);
      },
      onLaunchArcade: () => this.callbacks.onLaunchInArcade(this.session.getProject()),
      onSelectProjection: (mode) => {
        this.session.dispatch({ type: 'set_projection', patch: { mode } });
      },
      onSelectDimensionMask: (mask) => {
        this.runtime.setActiveDimensionMask(mask);
        this.session.dispatch({ type: 'set_projection', patch: { activeDimensionMask: mask } });
        this.previewRuntime.markDirty();
      },
      onSelectCamera3DView: (view) => this.previewRuntime.selectCamera3DView(view),
      onToggleAxisGizmo3d: () => {
        const cur = Boolean(this.session.getProject().projection?.showAxisGizmo3d);
        this.session.dispatch({ type: 'set_camera_3d_pose', showAxisGizmo3d: !cur });
      },
      onToggleOrthoGrid3d: () => {
        const cur = Boolean(this.session.getProject().projection?.showOrthoGrid3d);
        this.session.dispatch({ type: 'set_camera_3d_pose', showOrthoGrid3d: !cur });
      },
      onToggleShadowMap3d: () => {
        const cur = this.session.getProject().projection?.shadowMapEnabled !== false;
        this.session.dispatch({ type: 'set_camera_3d_pose', shadowMapEnabled: !cur });
      },
    });
    this.element = this.dom.rootEl;

    // Dedicated preview GPU engine bound to shared TextureAtlas (lazy-initialized on first show)
    this.previewGpu = new GpuEngine(
      this.dom.previewCanvas,
      (_kind, nextCanvas) => {
        if (nextCanvas) {
          this.dom.previewCanvas = nextCanvas;
        }
        this.previewRuntime?.markDirty();
      },
      this.atlas,
    );

    this.previewRuntime = new EcsWorkbenchPreviewRuntime(
      {
        host: this.host,
        atlas: this.atlas,
        session: this.session,
        runtime: this.runtime,
        previewGpu: this.previewGpu,
        dom: this.dom,
        mapState: this.mapState,
        getMapCanvasCtrl: () => this.mapCanvasCtrl,
        getEventGraphView: () => this.eventGraphView,
        getSelectedEntityIds: () => this.selectedEntityIds,
        onSelectionChange: (ids) => this.setSelectedEntityIds(ids),
        isVisible: () => this.visible,
        isModalOpen: () =>
          Boolean(
            this.externalImportModal?.isOpen() ||
              this.cloudPublishModal?.isOpen() ||
              this.modelAtelierModal?.isOpen(),
          ),
        getCenterMode: () => this.centerMode,
        setCenterMode: (mode) => this.setCenterMode(mode),
        onToolShortcutMutated: () => this.renderLeftPanel(),
        onRequestFullPanelRender: () => this.renderAllPanels(),
        onDiagReportReady: (report) => {
          this.lastDiagReport = report;
          this.renderRightPanel();
        },
      },
      initialSimRunning,
    );

    this.liveMutator = new EcsWorkbenchLiveMutator(this.runtime, () => {
      this.previewRuntime.markDirty();
      this.previewRuntime.renderPreviewNow();
    });

    this.mapCanvasCtrl = new EcsWorkbenchMapCanvasController({
      canvas: this.dom.mapOverlayCanvas,
      session: this.session,
      runtime: this.runtime,
      previewGpu: this.previewGpu,
      mapState: this.mapState,
      liveMutator: this.liveMutator,
      getSelectedEntityId: () => this.selectedEntityId,
      getSelectedEntityIds: () => this.selectedEntityIds,
      onSelectionChange: (ids) => this.setSelectedEntityIds(ids),
      onToggleQuadSingleView: (view) => {
        const proj = this.session.getProject();
        if (proj.projection?.quadView) {
          this.session.dispatch(
            view === 'quad'
              ? { type: 'set_camera_3d_pose', quadView: false }
              : { type: 'set_camera_3d_pose', cameraProjection3d: view, quadView: false },
          );
        } else {
          this.session.dispatch({ type: 'set_camera_3d_pose', quadView: true });
        }
      },
      onSliceCutawaySync: () => {
        this.previewRuntime.syncEditorSliceCutaway();
        this.previewRuntime.renderPreviewNow();
      },
      isEditingActive: () => this.previewRuntime.isMapEditingActive(),
      onToolStateMutated: () => this.renderLeftPanel(),
      onEntityStamped: (entityId) => this.setSelectedEntityIds([entityId]),
      onPreviewDirty: () => {
        this.previewRuntime.markDirty();
      },
    });

    this.agentWorkbenchApi = createWorkbenchAgentApi({
      session: this.session,
      runtime: this.runtime,
      mapState: this.mapState,
      previewRuntime: this.previewRuntime,
      mapCanvasCtrl: this.mapCanvasCtrl,
      getPreviewCanvas: () => this.dom.previewCanvas,
      isDestroyed: () => this.destroyed,
      getSelectedEntityIds: () => this.selectedEntityIds,
      setSelectedEntityIds: (ids) => this.setSelectedEntityIds(ids),
      onRefreshUi: () => this.renderAllPanels(),
    });

    this.previewRuntime.bindKeyboardShortcuts(signal);

    this.unsubSession = this.session.onChange((proj) => {
      const sameProject = proj.meta.id === this.lastLoadedProjectId;
      this.lastLoadedProjectId = proj.meta.id;
      this.syncProjectCustomSprites(proj);
      this.runtime.reloadProject(proj, sameProject);
      if (!sameProject) {
        this.setLeftTab(proj.worldMap ? 'map' : 'hierarchy');
        const customGround = proj.worldMap?.tileDefs?.find((t) => t.layer === 'ground');
        if (customGround) {
          this.mapState.layer = 'ground';
          this.mapState.editLayer = 'ground';
          this.mapState.selectedTileId = customGround.id;
          this.mapState.tool = 'brush';
          this.mapState.selectedStampPrefabId = null;
        }
        const firstId = proj.entities[0]?.id ?? null;
        this.selectedEntityIds = firstId ? [firstId] : [];
      } else if (this.selectedEntityIds.length > 0) {
        const validSet = new Set(proj.entities.map((e) => e.id));
        this.selectedEntityIds = this.selectedEntityIds.filter((id) => validSet.has(id));
      }
      this.selectedEntityId = this.selectedEntityIds[this.selectedEntityIds.length - 1] ?? null;
      this.previewRuntime.syncSimStateForProjectLoad(proj, sameProject);
      if (this.selectedPrefabId && !proj.prefabs[this.selectedPrefabId]) {
        this.selectedPrefabId = null;
      }
      this.previewRuntime.markDirty();
      this.previewRuntime.renderPreviewNow();
      this.renderAllPanels();
    });

    this.renderAllPanels();
  }

  public getAgentWorkbenchApi(): PixelAtelierWorkbenchAgentApi {
    return this.agentWorkbenchApi;
  }

  private setSelectedEntityIds(ids: readonly string[]): void {
    const validSet = new Set(this.session.getProject().entities.map((e) => e.id));
    const next: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (validSet.has(id) && !seen.has(id)) {
        seen.add(id);
        next.push(id);
      }
    }
    this.selectedEntityIds = next;
    this.selectedEntityId = next.length > 0 ? next[next.length - 1] : null;
    if (next.length > 0) this.selectedPrefabId = null;
    this.previewRuntime.markDirty();
    this.mapCanvasCtrl.renderOverlay();
    this.renderAllPanels();
  }

  private syncProjectCustomSprites(proj: EcsProjectV2): void {
    this.syncedCustomSpriteIds = syncProjectCustomSpritesToAtlas(
      this.atlas,
      proj,
      this.syncedCustomSpriteIds,
    );
    this.previewGpu.syncAtlasIfDirty();
    this.callbacks.onAtlasMutated();
  }

  public focusPublishedTile(layer: EcsMapLayerName, tileId: number): void {
    this.mapState.layer = layer;
    this.mapState.editLayer = layer;
    this.mapState.selectedTileId = tileId;
    this.mapState.tool = 'brush';
    this.mapState.selectedStampPrefabId = null;
    if (this.previewRuntime.isSimRunning()) this.previewRuntime.setSimRunning(false);
    this.setLeftTab('map');
    this.previewRuntime.markDirty();
    this.previewRuntime.renderPreviewNow();
    this.renderAllPanels();
  }

  public focusPublishedPrefab(prefabId: string): void {
    this.mapState.tool = 'stamp';
    this.mapState.selectedStampPrefabId = prefabId;
    this.selectedPrefabId = prefabId;
    if (this.previewRuntime.isSimRunning()) this.previewRuntime.setSimRunning(false);
    this.setLeftTab(this.session.getProject().worldMap ? 'map' : 'prefabs');
    this.previewRuntime.markDirty();
    this.previewRuntime.renderPreviewNow();
    this.renderAllPanels();
  }

  private ensurePreviewGpuInit(): void {
    if (this.previewGpuInitialized) return;
    this.previewGpuInitialized = true;
    void this.previewGpu.init().then(() => {
      if (this.destroyed) return;
      this.previewRuntime.syncViewportSize(this.session.getProject());
      this.previewGpu.syncAtlasToGpu();
      this.previewRuntime.markDirty();
      if (this.visible) {
        this.previewRuntime.renderPreviewNow();
        requestAnimationFrame(() => {
          if (this.destroyed || !this.visible) return;
          this.previewRuntime.markDirty();
          this.previewRuntime.renderPreviewNow();
        });
      }
    });
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.classList.toggle('panel-hidden', !visible);
    if (visible) {
      this.previewRuntime.markDirty();
      this.ensurePreviewGpuInit();
      this.previewGpu.syncAtlasToGpu();
      this.renderAllPanels();
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public setLeftTab(tab: WorkbenchLeftTab): void {
    this.leftTab = tab;
    this.dom.leftTabMapBtn.classList.toggle('is-active', tab === 'map');
    this.dom.leftTabRulesBtn.classList.toggle('is-active', tab === 'rules');
    this.dom.leftTabHierarchyBtn.classList.toggle('is-active', tab === 'hierarchy');
    this.dom.leftTabPrefabsBtn.classList.toggle('is-active', tab === 'prefabs');
    this.dom.leftTabAtlasBtn.classList.toggle('is-active', tab === 'atlas');
    this.renderLeftPanel();
  }

  private async ensureEventGraphView(): Promise<EventGraphEditorView | null> {
    if (this.destroyed) return null;
    if (this.eventGraphView) return this.eventGraphView;
    if (!this.eventGraphLoadPromise) {
      this.eventGraphLoadPromise = import('./EventGraphEditorView.ts')
        .then(({ EventGraphEditorView }) => {
          const view = new EventGraphEditorView(this.session);
          if (this.destroyed) {
            view.destroy();
            return null;
          }
          this.eventGraphView = view;
          this.eventGraphSlotEl.appendChild(view.element);
          return view;
        })
        .finally(() => {
          this.eventGraphLoadPromise = null;
        });
    }
    return this.eventGraphLoadPromise;
  }

  public setCenterMode(mode: WorkbenchCenterMode, focusScriptId?: string): void {
    this.centerMode = mode;
    this.dom.centerTabViewportBtn.classList.toggle('is-active', mode === 'viewport');
    this.dom.centerTabGraphBtn.classList.toggle('is-active', mode === 'event_graph');
    this.dom.viewportStageEl.classList.toggle('panel-hidden', mode !== 'viewport');
    this.eventGraphSlotEl.classList.toggle('panel-hidden', mode !== 'event_graph');
    if (mode === 'viewport') {
      this.previewRuntime.markDirty();
    } else if (mode === 'event_graph') {
      if (this.eventGraphView) {
        this.eventGraphView.syncProject(this.session.getProject(), focusScriptId);
        this.eventGraphView.updateLiveTrace(this.runtime.vm);
      } else {
        void this.ensureEventGraphView().then((view) => {
          if (!view || this.destroyed || this.centerMode !== 'event_graph') return;
          view.syncProject(this.session.getProject(), focusScriptId);
          view.updateLiveTrace(this.runtime.vm);
        });
      }
    }
  }

  public getPreviewCanvas(): HTMLCanvasElement {
    return this.dom.previewCanvas;
  }

  public syncAtlasToPreview(): void {
    this.previewGpu.syncAtlasToGpu();
    this.previewRuntime.markDirty();
    if (this.leftTab === 'atlas') {
      this.renderLeftPanel();
    }
  }

  public tick(dt: number): void {
    this.previewRuntime.tick(dt);
  }

  private renderAllPanels(): void {
    const proj = this.session.getProject();
    if (BUILTIN_ECS_PROJECTS.some((p) => p.id === proj.meta.id)) {
      this.dom.projectSelectEl.value = proj.meta.id;
    }
    const isWorldMap = Boolean(proj.worldMap);
    const isRhythm = Boolean(proj.rhythmTrack?.enabled);
    this.dom.playPauseBtn.textContent = this.previewRuntime.getPlayPauseLabel();
    this.dom.hitABtn.textContent = isWorldMap
      ? '揮劍斬擊 [J]'
      : isRhythm
        ? '打擊上軌星拍 [A]'
        : '鉤索 / 動作 [A]';
    this.dom.hitBBtn.textContent = isWorldMap
      ? '翻滾衝刺 [Space]'
      : isRhythm
        ? '打擊下軌蒼拍 [B]'
        : '跳躍 [B]';
    this.dom.shiftRealmBtn.classList.toggle('panel-hidden', isWorldMap || !proj.projection?.allowDimensionShift);
    this.dom.dimensionSelectEl.classList.toggle('panel-hidden', isWorldMap);
    this.dom.roomQuickSelectEl.classList.toggle('panel-hidden', !isWorldMap);

    if (proj.worldMap) {
      const activeRoomId = this.runtime.getActiveRoomId() ?? proj.worldMap.startRoomId;
      this.dom.roomQuickSelectEl.textContent = '';
      for (const r of proj.worldMap.rooms) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        this.dom.roomQuickSelectEl.appendChild(opt);
      }
      this.dom.roomQuickSelectEl.value = activeRoomId;
    }

    this.dom.projectionSelectEl.value = proj.projection?.mode ?? 'hd2d_iso';
    this.dom.dimensionSelectEl.value = String(proj.projection?.activeDimensionMask ?? 3);
    this.previewRuntime.syncSpatial3dBar(proj);
    this.dom.undoBtn.disabled = !this.session.canUndo();
    this.dom.redoBtn.disabled = !this.session.canRedo();
    this.mapCanvasCtrl.syncInteractivity();
    this.eventGraphView?.syncProject(proj);
    this.renderLeftPanel();
    this.renderRightPanel();
    this.previewRuntime.updateStatusStrip();
  }

  private renderLeftPanel(): void {
    this.dom.leftContentEl.textContent = '';
    const proj = this.session.getProject();
    if (this.leftTab === 'map') {
      renderMapDesignerPane(
        this.dom.leftContentEl,
        proj,
        this.session,
        this.atlas,
        this.runtime.getActiveRoomId(),
        this.mapState,
        {
          onStateChange: () => {
            this.previewRuntime.syncEditorSliceCutaway();
            this.mapCanvasCtrl.syncInteractivity();
            this.renderLeftPanel();
            this.previewRuntime.markDirty();
            this.previewRuntime.renderPreviewNow();
          },
          onSwitchRoom: (roomId) => this.previewRuntime.switchActiveRoom(roomId),
          onSelectEntity: (entityId) => this.setSelectedEntityIds([entityId]),
          onEnterEditMode: () => {
            if (this.previewRuntime.isSimRunning()) this.previewRuntime.setSimRunning(false);
          },
          onLiveTileDef: (tileDef) => {
            this.runtime.getWorldMapController().patchLiveTileDef(tileDef, this.runtime.world.globals);
            this.previewRuntime.markDirty();
            this.previewRuntime.renderPreviewNow();
          },
          onOpenSpriteAtelierForTile: () => {
            if (this.callbacks.onOpenSpriteAtelierForTile) {
              this.callbacks.onOpenSpriteAtelierForTile(this.mapState.layer);
            } else {
              this.callbacks.onOpenClassicWorkshop();
            }
          },
          onOpenExternalImport: () => {
            void this.openExternalImportModal();
          },
        },
      );
    } else if (this.leftTab === 'rules') {
      this.worldRulesPanel.renderInto(this.dom.leftContentEl, proj, this.session, this.runtime.getActiveRoomId());
    } else if (this.leftTab === 'hierarchy') {
      renderHierarchyPane(
        this.dom.leftContentEl,
        proj,
        this.session,
        {
          selectedEntityId: this.selectedEntityId,
          selectedPrefabId: this.selectedPrefabId,
          filterQuery: this.filterQuery,
        },
        {
          onFilterChange: (q) => {
            this.filterQuery = q;
          },
          onInstantiatePrefab: (prefabId) => this.instantiatePrefabOntoViewport(prefabId),
          onSelectEntity: (entityId) => this.setSelectedEntityIds([entityId]),
        },
      );
    } else if (this.leftTab === 'prefabs') {
      renderPrefabsPane(
        this.dom.leftContentEl,
        proj,
        this.session,
        {
          selectedEntityId: this.selectedEntityId,
          selectedPrefabId: this.selectedPrefabId,
          filterQuery: this.prefabFilterQuery,
        },
        {
          onFilterChange: (q) => {
            this.prefabFilterQuery = q;
          },
          onSaveEntityAsPrefab: (entityId, customName) => this.saveEntityAsPrefabQuick(entityId, customName),
          onInstantiatePrefab: (prefabId) => this.instantiatePrefabOntoViewport(prefabId),
          onSelectPrefab: (prefabId) => {
            this.selectedPrefabId = prefabId;
            this.renderAllPanels();
          },
        },
      );
    } else {
      renderAtlasPanel(this.dom.leftContentEl, this.atlas, this.session, {
        onOpenExternalImport: () => {
          void this.openExternalImportModal();
        },
        onOpenSpriteAtelier: () => {
          if (this.callbacks.onOpenSpriteAtelierForTile) {
            this.callbacks.onOpenSpriteAtelierForTile(this.mapState.layer);
          } else {
            this.callbacks.onOpenClassicWorkshop();
          }
        },
        onSyncAtlasAndRefresh: () => {
          this.previewGpu.syncAtlasToGpu();
          this.callbacks.onAtlasMutated();
          this.renderAllPanels();
        },
      });
    }
  }

  private saveEntityAsPrefabQuick(entityId: string, customName?: string): void {
    const proj = this.session.getProject();
    const ent = proj.entities.find((e) => e.id === entityId);
    if (!ent) return;
    const baseId = `${ent.id.replace(/[^a-zA-Z0-9_-]/g, '_')}_tpl`;
    let pid = baseId;
    let seq = 2;
    while (proj.prefabs[pid]) {
      pid = `${baseId}_${seq++}`;
    }
    const cleanName = customName?.trim() || `${ent.name} 模板`;
    const res = this.session.dispatch({
      type: 'save_entity_as_prefab',
      entityId: ent.id,
      prefabId: pid,
      name: cleanName,
      linkSourceEntity: true,
    });
    if (res.ok && res.createdPrefabId) {
      this.setSelectedEntityIds([ent.id]);
    }
  }

  private instantiatePrefabOntoViewport(prefabId: string): void {
    const proj = this.session.getProject();
    const pref = proj.prefabs[prefabId];
    if (!pref) return;
    const count = this.session.getPrefabInstanceCount(prefabId);
    const vw = proj.viewport.width;
    const vh = proj.viewport.height;
    const maxY = proj.rhythmTrack?.enabled ? Math.max(96, proj.rhythmTrack.yTop - 56) : Math.max(120, vh - 64);
    const x = Math.round(140 + ((count * 76) % Math.max(120, vw - 240)));
    const y = Math.round(84 + ((count * 34) % Math.max(48, maxY - 84)));
    const res = this.session.dispatch({ type: 'instantiate_prefab', prefabId, x, y });
    if (res.ok && res.createdEntityId) {
      this.setSelectedEntityIds([res.createdEntityId]);
    }
  }

  private renderPrefabInspector(proj: EcsProjectV2, prefab: EcsPrefabDef): void {
    renderPrefabInspectorPanel(this.dom.rightTitleEl, this.dom.rightContentEl, proj, prefab, this.session, {
      componentCatalog: COMPONENT_CATALOG,
      spriteOptions: HD_SPRITE_OPTIONS,
      createSliderRow: createWorkbenchSliderRow,
      onBackToEntity: () => {
        this.selectedPrefabId = null;
        this.renderAllPanels();
      },
      onInstantiatePrefab: (prefabId) => this.instantiatePrefabOntoViewport(prefabId),
      onSelectInstance: (entityId) => this.setSelectedEntityIds([entityId]),
      onMutateLiveMaterial: (prefabId, patch) =>
        this.liveMutator.mutatePrefabMaterial(this.session.getProject(), prefabId, patch),
      onMutateLiveLight: (prefabId, patch) =>
        this.liveMutator.mutatePrefabLight(this.session.getProject(), prefabId, patch),
    });
  }

  private buildSceneSections(proj: EcsProjectV2): HTMLElement[] {
    return buildSceneAndHistorySections(
      proj,
      this.session,
      this.runtime,
      () => {
        this.previewRuntime.markDirty();
        this.previewRuntime.renderPreviewNow();
      },
      {
        onPlayCutscene: (cutsceneId) => this.previewRuntime.playCutscene(cutsceneId),
        onCritiqueCutscene: (cutsceneId) => this.previewRuntime.critiqueCutscene(cutsceneId),
        fovPreviewEnabled: this.mapState.showFovPreview,
        onToggleFovPreview: () => {
          this.mapState.showFovPreview = !this.mapState.showFovPreview;
          this.previewRuntime.markDirty();
          this.mapCanvasCtrl.renderOverlay();
          this.renderRightPanel();
        },
      },
    );
  }

  private renderRightPanel(): void {
    this.dom.rightContentEl.textContent = '';
    const proj = this.session.getProject();

    if (this.lastDiagReport) {
      this.dom.rightContentEl.appendChild(buildDiagReportBox(this.lastDiagReport));
    }

    if (this.selectedPrefabId && proj.prefabs[this.selectedPrefabId]) {
      this.renderPrefabInspector(proj, proj.prefabs[this.selectedPrefabId]);
      return;
    }

    this.dom.rightTitleEl.textContent =
      this.selectedEntityIds.length > 1 ? '多選批次操作與元件檢查器' : 'ECS 元件檢查器與沙盒腳本';
    if (this.selectedEntityIds.length > 1) {
      this.dom.rightContentEl.appendChild(
        buildMultiSelectInspectorSection(proj, this.session, this.selectedEntityIds, (ids) =>
          this.setSelectedEntityIds(ids),
        ),
      );
    }
    const ent = proj.entities.find((e) => e.id === this.selectedEntityId);
    const sceneSections = this.buildSceneSections(proj);
    if (!ent) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '請從左側階層樹選取任一實體以檢視或編輯其 ECS 元件與 PBR 材質。';
      this.dom.rightContentEl.append(empty, ...sceneSections);
      return;
    }

    const entitySections = buildEntityInspectorSections(proj, ent, this.session, this.atlas, {
      systemCount: this.runtime.world.getSystemPipeline().length,
      liveMutator: this.liveMutator,
      onSaveEntityAsPrefab: (entityId) => this.saveEntityAsPrefabQuick(entityId),
      onEditPrefabTemplate: (prefabId) => {
        this.selectedPrefabId = prefabId;
        this.renderAllPanels();
      },
      onOpenEventGraph: (scriptId) => this.setCenterMode('event_graph', scriptId),
    });
    this.dom.rightContentEl.append(...entitySections, ...sceneSections);
  }

  public async openExternalImportModal(): Promise<void> {
    if (this.destroyed) return;
    if (!this.externalImportModal) {
      if (!this.externalImportLoadPromise) {
        this.externalImportLoadPromise = import('./ExternalImportModalView.ts')
          .then(({ ExternalImportModalView }) => {
            const modal = new ExternalImportModalView({
              onCommit: (result, options) => this.handleExternalImportCommit(result, options),
              getProject: () => this.session.getProject(),
              onCommitCommands: (cmds, summary, focusHint) =>
                this.handleAtomicAssetCommands(cmds, summary, focusHint),
            });
            if (this.destroyed) {
              modal.destroy();
            } else {
              this.externalImportModal = modal;
              this.element.appendChild(modal.element);
            }
            return modal;
          })
          .finally(() => {
            this.externalImportLoadPromise = null;
          });
      }
      await this.externalImportLoadPromise;
    }
    if (this.destroyed || !this.externalImportModal) return;
    this.externalImportModal.open();
  }

  public async openCloudPublishModal(): Promise<void> {
    if (this.destroyed) return;
    if (!this.cloudPublishModal) {
      if (!this.cloudPublishLoadPromise) {
        this.cloudPublishLoadPromise = import('./CloudPublishModalView.ts')
          .then(({ CloudPublishModalView }) => {
            const modal = new CloudPublishModalView();
            if (this.destroyed) {
              modal.destroy();
              return null;
            }
            this.cloudPublishModal = modal;
            this.element.appendChild(modal.element);
            return modal;
          })
          .finally(() => {
            this.cloudPublishLoadPromise = null;
          });
      }
      await this.cloudPublishLoadPromise;
    }
    if (this.destroyed || !this.cloudPublishModal) return;
    this.cloudPublishModal.open(this.session.getProject());
  }

  public async openModelAtelierModal(initialModelId?: string): Promise<void> {
    if (this.destroyed) return;
    if (!this.modelAtelierModal) {
      if (!this.modelAtelierLoadPromise) {
        this.modelAtelierLoadPromise = import('./ModelAtelierModalView.ts')
          .then(({ ModelAtelierModalView }) => {
            const modal = new ModelAtelierModalView({
              atlas: this.atlas,
              getProject: () => this.session.getProject(),
              getSpriteOptions: (proj) => collectProjectSpriteOptions(proj),
              onSaveModel3D: (model) => {
                const res = this.session.dispatch({ type: 'upsert_model_3d', model });
                if (res.ok) {
                  this.previewRuntime.markDirty();
                  this.previewRuntime.renderPreviewNow();
                  this.dom.statusLeftEl.textContent = `已儲存 3D 模型「${model.name}」（修訂 #${res.revision}）`;
                }
              },
              onDeleteModel3D: (modelId) => {
                this.session.dispatch({ type: 'remove_model_3d', modelId });
              },
              onSpawnModelEntity: (modelId) => {
                const proj = this.session.getProject();
                const roomId = this.runtime.getActiveRoomId() ?? proj.worldMap?.startRoomId;
                const room = roomId ? proj.worldMap?.rooms.find((r) => r.id === roomId) : undefined;
                const ts = proj.worldMap?.tileSize ?? 32;
                const x = room ? Math.round(room.cols * ts * 0.5) : Math.round(proj.viewport.width * 0.5);
                const y = room ? Math.round(room.rows * ts * 0.5) : Math.round(proj.viewport.height * 0.5);
                const modelName = proj.models3d?.[modelId]?.name ?? modelId;
                const entityId = `model_${modelId}_${(Date.now() % 10000).toString(36)}`;
                const res = this.session.dispatch({
                  type: 'spawn_entity',
                  entity: {
                    id: entityId,
                    name: modelName,
                    ...(roomId ? { roomId } : {}),
                    components: {
                      transform: { x, y, w: 32, h: 32 },
                      sprite: { sprite: 'hero', alpha: 1 },
                      spatial3d: { z: 0, height: 32, dimensionMask: 3 },
                      mesh3d: { modelId, castShadow: true },
                    },
                  },
                });
                if (res.ok) {
                  this.modelAtelierModal?.close();
                  this.setSelectedEntityIds([res.createdEntityId ?? entityId]);
                  this.previewRuntime.renderPreviewNow();
                  this.dom.statusLeftEl.textContent = `已於場景生成 3D 模型實體「${modelName}」`;
                }
              },
            });
            if (this.destroyed) {
              modal.destroy();
              return null;
            }
            this.modelAtelierModal = modal;
            this.element.appendChild(modal.element);
            return modal;
          })
          .finally(() => {
            this.modelAtelierLoadPromise = null;
          });
      }
      await this.modelAtelierLoadPromise;
    }
    if (this.destroyed || !this.modelAtelierModal) return;
    this.modelAtelierModal.open(initialModelId);
  }

  private handleAtomicAssetCommands(
    cmds: EcsStudioCommand[],
    summary: string,
    focusHint?: { leftTab?: 'map' | 'prefabs' | 'atlas' },
  ): void {
    if (cmds.length === 0) return;
    const batchRes = this.session.dispatchBatch(cmds, summary);
    if (!batchRes.ok) {
      this.dom.statusLeftEl.textContent = `${summary} 失敗：${batchRes.errors.join('; ') || batchRes.summary}`;
      return;
    }

    const updatedProj = this.session.getProject();
    this.syncedCustomSpriteIds = syncProjectCustomSpritesToAtlas(
      this.atlas,
      updatedProj,
      this.syncedCustomSpriteIds,
    );
    if (this.previewGpuInitialized) {
      this.previewGpu.syncAtlasIfDirty();
    }
    this.callbacks.onAtlasMutated();
    if (focusHint?.leftTab) {
      this.setLeftTab(focusHint.leftTab);
    }
    this.previewRuntime.markDirty();
    this.previewRuntime.renderPreviewNow();
    this.renderAllPanels();
    this.dom.statusLeftEl.textContent = `${summary}（修訂 #${batchRes.revision} · 可按復原還原）`;
  }

  private handleExternalImportCommit(result: InteropImportResult, options: InteropCommitOptions): void {
    const cmds = buildInteropStudioCommands(result, this.session.getProject(), options);
    if (cmds.length === 0) return;
    const batchRes = this.session.dispatchBatch(cmds, `外部匯入 ${result.sourceName}`);
    if (!batchRes.ok) {
      this.dom.statusLeftEl.textContent = `外部匯入失敗：${batchRes.errors.join('; ') || batchRes.summary}`;
      return;
    }

    const updatedProj = this.session.getProject();
    this.syncedCustomSpriteIds = syncProjectCustomSpritesToAtlas(
      this.atlas,
      updatedProj,
      this.syncedCustomSpriteIds,
    );
    if (this.previewGpuInitialized) {
      this.previewGpu.syncAtlasIfDirty();
    }
    this.callbacks.onAtlasMutated();

    if (result.rooms.length > 0) {
      this.setLeftTab('map');
      this.previewRuntime.switchActiveRoom(result.rooms[0].id);
      const reach = analyzeWorldMapReachability(updatedProj);
      this.lastDiagReport = {
        ok: reach.pass,
        headline: `外部匯入完成 · ${result.sourceName} (${reach.softLockRisks.length} 軟鎖)`,
        lines: [
          result.summary,
          `可達房間：${reach.reachableRoomIds.length} / ${updatedProj.worldMap?.rooms.length ?? 0}`,
          ...(reach.softLockRisks.length > 0
            ? reach.softLockRisks.slice(0, 3)
            : ['BFS 連通性與鑰匙依賴驗證全數通過']),
        ],
      };
      this.dom.statusLeftEl.textContent =
        `已匯入 ${result.sourceName}：${result.rooms.length} 房間 · ${result.tileDefs.length} 瓦片 · ` +
        `${reach.softLockRisks.length} 軟鎖（可按復原還原）`;
      this.renderRightPanel();
    } else {
      this.setLeftTab(options.createTileFromSprite ? 'map' : 'atlas');
      this.dom.statusLeftEl.textContent =
        `已匯入 ${result.sourceName}：${result.customSprites.length} 張無損精靈至 MaxRects 圖集池（可按復原還原）`;
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.unsubSession();
    this.ac.abort();
    this.mapCanvasCtrl.destroy();
    this.worldRulesPanel.destroy();
    if (this.externalImportModal) {
      this.externalImportModal.destroy();
      this.externalImportModal = null;
    }
    if (this.cloudPublishModal) {
      this.cloudPublishModal.destroy();
      this.cloudPublishModal = null;
    }
    if (this.modelAtelierModal) {
      this.modelAtelierModal.destroy();
      this.modelAtelierModal = null;
    }
    if (this.eventGraphView) {
      this.eventGraphView.destroy();
      this.eventGraphView = null;
    }
    this.previewGpu.dispose();
    this.element.remove();
  }
}
