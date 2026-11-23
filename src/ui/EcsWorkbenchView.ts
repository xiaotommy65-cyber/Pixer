import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import { analyzeWorldMapReachability } from '../core/ai/EcsSpatialOracle.ts';
import { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import { syncProjectCustomSpritesToAtlas } from '../core/ecs/EcsCustomSpriteCompiler.ts';
import type { EcsPrefabDef, EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import type { EcsMapLayerName } from '../core/ecs/EcsTilemapTypes.ts';
import { GpuEngine } from '../core/gpu/GpuEngine.ts';
import {
  buildInteropStudioCommands,
  type InteropCommitOptions,
  type InteropImportResult,
} from '../core/interop/index.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import { SceneGpuBridge } from '../core/runtime/SceneGpuBridge.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../core/types/WorldTypes.ts';
import {
  createDefaultMapDesignerState,
  renderMapDesignerPane,
  type MapDesignerState,
} from './EcsMapDesignerPanel.ts';
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
import { buildEntityInspectorSections } from './EcsWorkbenchEntityInspector.ts';
import { renderHierarchyPane, renderPrefabsPane } from './EcsWorkbenchHierarchyPanels.ts';
import { EcsWorkbenchLiveMutator } from './EcsWorkbenchLiveMutator.ts';
import { EcsWorkbenchMapCanvasController } from './EcsWorkbenchMapCanvasController.ts';
import { renderPrefabInspectorPanel } from './EcsWorkbenchPrefabInspector.ts';
import { buildDiagReportBox, buildSceneAndHistorySections } from './EcsWorkbenchSceneInspector.ts';
import {
  buildEcsWorkbenchShell,
  type EcsWorkbenchShellRefs,
  type WorkbenchCenterMode,
  type WorkbenchLeftTab,
} from './EcsWorkbenchShellBuilder.ts';
import { EcsWorldRulesInspectorPanel } from './EcsWorldRulesInspectorPanel.ts';
import { EventGraphEditorView } from './EventGraphEditorView.ts';
import { ExternalImportModalView } from './ExternalImportModalView.ts';

export interface EcsWorkbenchCallbacks {
  onLaunchInArcade: (proj: EcsProjectV2) => void;
  onOpenClassicWorkshop: () => void;
  onOpenSpriteAtelierForTile?: (layer: EcsMapLayerName) => void;
  onAtlasMutated: () => void;
}

/**
 * Pixer True ECS Workstation Coordinator Shell:
 * orchestrates session state, lazy preview GPU lifecycle, keyboard shortcuts, and 60Hz tick
 * while delegating DOM layout, live mutation, map canvas editing, and all panels to dedicated modules.
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
  private readonly previewBridge = new SceneGpuBridge();
  private readonly runtime: EcsCartridgeRuntime;
  private readonly liveMutator: EcsWorkbenchLiveMutator;
  private readonly mapCanvasCtrl: EcsWorkbenchMapCanvasController;
  private readonly eventGraphView: EventGraphEditorView;
  private readonly externalImportModal: ExternalImportModalView;
  private readonly worldRulesPanel: EcsWorldRulesInspectorPanel;
  private readonly liveInput = createEmptyInputState();

  private leftTab: WorkbenchLeftTab = 'map';
  private centerMode: WorkbenchCenterMode = 'viewport';
  private selectedEntityId: string | null = null;
  private selectedPrefabId: string | null = null;
  private filterQuery = '';
  private prefabFilterQuery = '';
  private simRunning = true;
  private debugOverlay = false;
  private visible = false;
  private previewGpuInitialized = false;
  private syncedCustomSpriteIds = new Set<string>();
  private lastLoadedProjectId: string;
  private readonly mapState: MapDesignerState = createDefaultMapDesignerState();

  private pulseActionFrames = 0;
  private pulseJumpFrames = 0;
  private pulseShiftFrames = 0;
  private readonly heldKeys = { left: false, right: false, up: false, down: false, dash: false };

  private lastDiagReport: WorkbenchDiagReport | null = null;
  private lastStatusSyncAccum = 0;
  private renderPixelW = 1280;
  private renderPixelH = 720;

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
    this.leftTab = initialProj.worldMap ? 'map' : 'hierarchy';
    this.simRunning = !initialProj.worldMap;
    this.runtime = new EcsCartridgeRuntime(initialProj);
    this.liveMutator = new EcsWorkbenchLiveMutator(this.runtime, () => this.renderPreviewNow());

    this.eventGraphView = new EventGraphEditorView(this.session);
    this.eventGraphView.element.classList.add('panel-hidden');
    this.externalImportModal = new ExternalImportModalView({
      onCommit: (result, options) => this.handleExternalImportCommit(result, options),
    });
    this.worldRulesPanel = new EcsWorldRulesInspectorPanel({
      onFocusRoom: (roomId) => this.switchActiveRoom(roomId),
      getSpriteOptions: (proj) => collectProjectSpriteOptions(proj),
    });

    const { signal } = this.ac;
    this.dom = buildEcsWorkbenchShell({
      initialProject: initialProj,
      initialLeftTab: this.leftTab,
      initialPlayPauseLabel: this.getPlayPauseLabel(),
      eventGraphEl: this.eventGraphView.element,
      externalImportModalEl: this.externalImportModal.element,
      signal,
      onOpenExternalImport: () => this.openExternalImportModal(),
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
      onTogglePlayPause: () => this.setSimRunning(!this.simRunning),
      onStepFrame: () => {
        this.setSimRunning(false);
        this.runtime.step(1 / 60, this.liveInput, DEFAULT_RUNTIME_PARAMS);
        this.renderPreviewNow();
      },
      onResetRuntime: () => {
        this.runtime.reset();
        this.renderPreviewNow();
      },
      onToggleDebugOverlay: () => {
        this.debugOverlay = !this.debugOverlay;
        this.runtime.setDebugHitboxes(this.debugOverlay);
        this.dom.overlayBtn.classList.toggle('p7-btn-accent', this.debugOverlay);
      },
      onUndo: () => {
        this.session.undo();
      },
      onRedo: () => {
        this.session.redo();
      },
      onRunDiagnostics: () => {
        this.lastDiagReport = runWorkbenchSpatialDiagnostics(this.session);
        this.renderRightPanel();
      },
      onSelectCenterMode: (mode) => this.setCenterMode(mode),
      onSwitchRoom: (roomId) => this.switchActiveRoom(roomId),
      onHitActionA: () => {
        this.host.unlockAudio();
        if (this.session.getProject().worldMap && !this.simRunning) this.setSimRunning(true);
        this.pulseActionFrames = 4;
      },
      onHitActionB: () => {
        this.host.unlockAudio();
        if (this.session.getProject().worldMap && !this.simRunning) this.setSimRunning(true);
        this.pulseJumpFrames = 4;
      },
      onShiftRealm: () => {
        this.host.unlockAudio();
        this.pulseShiftFrames = 2;
      },
      onLaunchArcade: () => this.callbacks.onLaunchInArcade(this.session.getProject()),
      onSelectProjection: (mode) => {
        this.session.dispatch({ type: 'set_projection', patch: { mode } });
      },
      onSelectDimensionMask: (mask) => {
        this.runtime.setActiveDimensionMask(mask);
        this.session.dispatch({ type: 'set_projection', patch: { activeDimensionMask: mask } });
      },
    });
    this.element = this.dom.rootEl;

    // Dedicated preview GPU engine bound to shared TextureAtlas (lazy-initialized on first show)
    this.previewGpu = new GpuEngine(this.dom.previewCanvas, undefined, this.atlas);
    this.mapCanvasCtrl = new EcsWorkbenchMapCanvasController({
      canvas: this.dom.mapOverlayCanvas,
      session: this.session,
      runtime: this.runtime,
      previewGpu: this.previewGpu,
      mapState: this.mapState,
      isEditingActive: () => this.isMapEditingActive(),
      onToolStateMutated: () => this.renderLeftPanel(),
      onEntityStamped: (entityId) => {
        this.selectedEntityId = entityId;
        this.renderRightPanel();
      },
    });

    this.bindKeyboardShortcuts(signal);

    this.unsubSession = this.session.onChange((proj) => {
      const sameProject = proj.meta.id === this.lastLoadedProjectId;
      this.lastLoadedProjectId = proj.meta.id;
      this.syncProjectCustomSprites(proj);
      this.runtime.reloadProject(proj, sameProject);
      if (!sameProject) {
        this.runtime.clearEditorCamera();
        this.simRunning = !proj.worldMap;
        this.setLeftTab(proj.worldMap ? 'map' : 'hierarchy');
        const customGround = proj.worldMap?.tileDefs?.find((t) => t.layer === 'ground');
        if (customGround) {
          this.mapState.layer = 'ground';
          this.mapState.selectedTileId = customGround.id;
          this.mapState.tool = 'brush';
          this.mapState.selectedStampPrefabId = null;
        }
      }
      this.syncViewportSize(proj);
      if (this.selectedEntityId && !proj.entities.some((e) => e.id === this.selectedEntityId)) {
        this.selectedEntityId = proj.entities[0]?.id ?? null;
      }
      if (this.selectedPrefabId && !proj.prefabs[this.selectedPrefabId]) {
        this.selectedPrefabId = null;
      }
      this.renderAllPanels();
      this.renderPreviewNow();
    });

    this.renderAllPanels();
  }

  private bindKeyboardShortcuts(signal: AbortSignal): void {
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.visible || this.externalImportModal.isOpen()) return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const proj = this.session.getProject();
        const isWorldMap = Boolean(proj.worldMap);
        const hasMotor =
          this.runtime.world.core.getStore(this.runtime.world.core.components.CharacterMotor2D).size() > 0;

        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey) this.session.redo();
          else this.session.undo();
          return;
        }

        if (isWorldMap) {
          if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.heldKeys.left = true;
          else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.heldKeys.right = true;
          else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.heldKeys.up = true;
          else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.heldKeys.down = true;
          else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.heldKeys.dash = true;
          else if (e.code === 'Space' || e.code === 'KeyK') {
            e.preventDefault();
            this.host.unlockAudio();
            this.pulseJumpFrames = 4;
          } else if (e.code === 'KeyJ' || e.code === 'KeyZ' || e.code === 'Enter') {
            this.host.unlockAudio();
            this.pulseActionFrames = 4;
          } else if (!this.simRunning) {
            if (e.code === 'KeyB') { this.mapState.tool = 'brush'; this.renderLeftPanel(); }
            else if (e.code === 'KeyR') { this.mapState.tool = 'rect'; this.renderLeftPanel(); }
            else if (e.code === 'KeyG') { this.mapState.tool = 'fill'; this.renderLeftPanel(); }
            else if (e.code === 'KeyE') { this.mapState.tool = 'erase'; this.renderLeftPanel(); }
            else if (e.code === 'KeyI') { this.mapState.tool = 'eyedropper'; this.renderLeftPanel(); }
          }
          return;
        }

        if (e.code === 'ArrowLeft') this.heldKeys.left = true;
        else if (e.code === 'ArrowRight') this.heldKeys.right = true;
        else if (e.code === 'ArrowUp') this.heldKeys.up = true;
        else if (e.code === 'ArrowDown') this.heldKeys.down = true;
        else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.heldKeys.dash = true;
        else if (e.code === 'Space') {
          this.host.unlockAudio();
          if (hasMotor) this.pulseJumpFrames = 3;
          else this.pulseActionFrames = 3;
        } else if (e.code === 'KeyA' || e.code === 'KeyJ') {
          this.host.unlockAudio();
          this.pulseActionFrames = 3;
        } else if (e.code === 'KeyB' || e.code === 'KeyK') {
          this.host.unlockAudio();
          this.pulseJumpFrames = 3;
        } else if (e.code === 'KeyR') {
          this.host.unlockAudio();
          this.pulseShiftFrames = 2;
        }
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.heldKeys.left = false;
        else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.heldKeys.right = false;
        else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.heldKeys.up = false;
        else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.heldKeys.down = false;
        else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.heldKeys.dash = false;
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        this.heldKeys.left = false;
        this.heldKeys.right = false;
        this.heldKeys.up = false;
        this.heldKeys.down = false;
        this.heldKeys.dash = false;
      },
      { signal },
    );
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
    this.mapState.selectedTileId = tileId;
    this.mapState.tool = 'brush';
    this.mapState.selectedStampPrefabId = null;
    if (this.simRunning) this.setSimRunning(false);
    this.setLeftTab('map');
    this.renderAllPanels();
    this.renderPreviewNow();
  }

  public focusPublishedPrefab(prefabId: string): void {
    this.mapState.tool = 'stamp';
    this.mapState.selectedStampPrefabId = prefabId;
    this.selectedPrefabId = prefabId;
    if (this.simRunning) this.setSimRunning(false);
    this.setLeftTab(this.session.getProject().worldMap ? 'map' : 'prefabs');
    this.renderAllPanels();
    this.renderPreviewNow();
  }

  private getPlayPauseLabel(): string {
    const hasMap = Boolean(this.session.getProject().worldMap);
    if (hasMap) return this.simRunning ? '返回編輯地圖' : '開始試玩';
    return this.simRunning ? '暫停模擬' : '繼續模擬';
  }

  private setSimRunning(running: boolean): void {
    this.simRunning = running;
    if (running) {
      this.runtime.clearEditorCamera();
      this.mapCanvasCtrl.clearPendingStroke();
    }
    this.dom.playPauseBtn.textContent = this.getPlayPauseLabel();
    this.mapCanvasCtrl.syncInteractivity();
    this.renderPreviewNow();
  }

  private isMapEditingActive(): boolean {
    return Boolean(this.session.getProject().worldMap) && !this.simRunning && this.centerMode === 'viewport';
  }

  private switchActiveRoom(roomId: string): void {
    this.runtime.switchRoomForEditor(roomId);
    const proj = this.session.getProject();
    const room = proj.worldMap?.rooms.find((r) => r.id === roomId);
    if (!this.simRunning && room && proj.worldMap) {
      const ts = proj.worldMap.tileSize;
      const worldW = room.cols * ts;
      const centerX = Math.max(0, (worldW - proj.viewport.width) * 0.5);
      if (typeof room.editorFocusY === 'number') {
        this.runtime.setEditorCamera(centerX, room.editorFocusY);
      } else {
        this.runtime.clearEditorCamera();
      }
    } else {
      this.runtime.clearEditorCamera();
    }
    this.renderAllPanels();
    this.renderPreviewNow();
  }

  private ensurePreviewGpuInit(): void {
    if (this.previewGpuInitialized) return;
    this.previewGpuInitialized = true;
    void this.previewGpu.init().then(() => {
      this.syncViewportSize(this.session.getProject());
      this.previewGpu.syncAtlasToGpu();
      if (this.visible) this.renderPreviewNow();
    });
  }

  public setVisible(visible: boolean): void {
    this.visible = visible;
    this.element.classList.toggle('panel-hidden', !visible);
    if (visible) {
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

  public setCenterMode(mode: WorkbenchCenterMode, focusScriptId?: string): void {
    this.centerMode = mode;
    this.dom.centerTabViewportBtn.classList.toggle('is-active', mode === 'viewport');
    this.dom.centerTabGraphBtn.classList.toggle('is-active', mode === 'event_graph');
    this.dom.viewportStageEl.classList.toggle('panel-hidden', mode !== 'viewport');
    this.eventGraphView.element.classList.toggle('panel-hidden', mode !== 'event_graph');
    if (mode === 'event_graph') {
      this.eventGraphView.syncProject(this.session.getProject(), focusScriptId);
      this.eventGraphView.updateLiveTrace(this.runtime.vm);
    }
  }

  public getPreviewCanvas(): HTMLCanvasElement {
    return this.dom.previewCanvas;
  }

  public syncAtlasToPreview(): void {
    this.previewGpu.syncAtlasToGpu();
    if (this.leftTab === 'atlas') {
      this.renderLeftPanel();
    }
  }

  private syncViewportSize(proj: EcsProjectV2): void {
    const w = proj.viewport.width;
    const h = proj.viewport.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const maxW = dpr >= 1.75 ? 1920 : 1280;
    const maxH = dpr >= 1.75 ? 1080 : 720;
    let scale = 3;
    while (scale > 1 && (w * scale > maxW || h * scale > maxH)) {
      scale--;
    }
    this.renderPixelW = w * scale;
    this.renderPixelH = h * scale;
    this.previewGpu.setLogicalViewport(w, h);
    this.previewGpu.resize(this.renderPixelW, this.renderPixelH);
    this.dom.mapOverlayCanvas.width = w;
    this.dom.mapOverlayCanvas.height = h;
    this.dom.previewCanvas.classList.toggle('is-smooth', w >= 640);
    if (proj.viewport.preset) {
      this.dom.viewportSelectEl.value = proj.viewport.preset;
    }
  }

  public tick(dt: number): void {
    if (!this.visible) return;
    const proj = this.session.getProject();
    if (this.simRunning) {
      this.liveInput.left = this.heldKeys.left;
      this.liveInput.right = this.heldKeys.right;
      this.liveInput.up = this.heldKeys.up;
      this.liveInput.down = this.heldKeys.down;
      this.liveInput.skillX = this.heldKeys.dash;
      this.liveInput.action = this.pulseActionFrames > 0;
      this.liveInput.jump = this.pulseJumpFrames > 0;
      this.liveInput.shoulderR = this.pulseShiftFrames > 0;
      if (this.pulseActionFrames > 0) this.pulseActionFrames--;
      if (this.pulseJumpFrames > 0) this.pulseJumpFrames--;
      if (this.pulseShiftFrames > 0) this.pulseShiftFrames--;

      const events = this.runtime.step(Math.min(1 / 30, dt), this.liveInput, DEFAULT_RUNTIME_PARAMS);
      for (let i = 0; i < events.length; i++) {
        if (events[i] === 'star') this.host.playStereoTick(880, 0, 0.14);
        else if (events[i] === 'snap' || events[i] === 'jump') this.host.playStereoTick(660, 0, 0.1);
      }
    } else if (proj.worldMap) {
      const panSpeed = 240 * Math.min(1 / 20, dt);
      const dx = (this.heldKeys.right ? 1 : 0) - (this.heldKeys.left ? 1 : 0);
      const dy = (this.heldKeys.down ? 1 : 0) - (this.heldKeys.up ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const cam = this.runtime.getCamera();
        this.runtime.setEditorCamera(cam.x + dx * panSpeed, cam.y + dy * panSpeed);
      }
    }
    if (this.centerMode === 'viewport') {
      this.renderPreviewNow();
    } else {
      this.eventGraphView.updateLiveTrace(this.runtime.vm);
    }

    this.lastStatusSyncAccum += dt;
    if (this.lastStatusSyncAccum >= 0.25) {
      this.lastStatusSyncAccum = 0;
      this.updateStatusStrip();
    }
  }

  private renderPreviewNow(): void {
    const snap = this.runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    this.previewBridge.render(this.previewGpu, snap, null);
    this.mapCanvasCtrl.renderOverlay();
  }

  private updateStatusStrip(): void {
    const proj = this.session.getProject();
    const stats = this.atlas.getAtlasStats();
    const snap = this.runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    const sysCount = this.runtime.world.getSystemPipeline().length;
    const activeRoomId = this.runtime.getActiveRoomId();
    const activeRoom = proj.worldMap?.rooms.find((r) => r.id === activeRoomId);
    const roomPart = activeRoom ? ` · 房間 ${activeRoom.name} (${activeRoom.cols}×${activeRoom.rows})` : '';
    this.dom.statusLeftEl.textContent =
      `${proj.meta.code} ${proj.meta.title}${roomPart} · 視口 ${proj.viewport.width}×${proj.viewport.height}` +
      ` · ECS ${this.runtime.world.activeCount} 實體 / ${sysCount} 系統`;
    this.dom.statusRightEl.textContent =
      `圖集 ${stats.pageCount}/${stats.maxPages} 頁 · ${this.simRunning ? '試玩中' : '編輯模式'} · 分數 ${snap.score} · 修訂 #${this.session.getRevision()}`;
  }

  private renderAllPanels(): void {
    const proj = this.session.getProject();
    if (BUILTIN_ECS_PROJECTS.some((p) => p.id === proj.meta.id)) {
      this.dom.projectSelectEl.value = proj.meta.id;
    }
    const isWorldMap = Boolean(proj.worldMap);
    const isRhythm = Boolean(proj.rhythmTrack?.enabled);
    this.dom.playPauseBtn.textContent = this.getPlayPauseLabel();
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
    this.dom.undoBtn.disabled = !this.session.canUndo();
    this.dom.redoBtn.disabled = !this.session.canRedo();
    this.mapCanvasCtrl.syncInteractivity();
    this.eventGraphView.syncProject(proj);
    this.renderLeftPanel();
    this.renderRightPanel();
    this.updateStatusStrip();
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
            this.mapCanvasCtrl.syncInteractivity();
            this.renderLeftPanel();
            this.mapCanvasCtrl.renderOverlay();
          },
          onSwitchRoom: (roomId) => this.switchActiveRoom(roomId),
          onSelectEntity: (entityId) => {
            this.selectedEntityId = entityId;
            this.renderRightPanel();
          },
          onEnterEditMode: () => {
            if (this.simRunning) this.setSimRunning(false);
          },
          onOpenSpriteAtelierForTile: () => {
            if (this.callbacks.onOpenSpriteAtelierForTile) {
              this.callbacks.onOpenSpriteAtelierForTile(this.mapState.layer);
            } else {
              this.callbacks.onOpenClassicWorkshop();
            }
          },
          onOpenExternalImport: () => this.openExternalImportModal(),
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
          onSelectEntity: (entityId) => {
            this.selectedEntityId = entityId;
            this.selectedPrefabId = null;
            this.renderAllPanels();
          },
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
        onOpenExternalImport: () => this.openExternalImportModal(),
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
      this.selectedEntityId = ent.id;
      this.selectedPrefabId = null;
      this.renderAllPanels();
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
      this.selectedEntityId = res.createdEntityId;
      this.selectedPrefabId = null;
      this.renderAllPanels();
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
      onSelectInstance: (entityId) => {
        this.selectedEntityId = entityId;
        this.selectedPrefabId = null;
        this.renderAllPanels();
      },
      onMutateLiveMaterial: (prefabId, patch) =>
        this.liveMutator.mutatePrefabMaterial(this.session.getProject(), prefabId, patch),
      onMutateLiveLight: (prefabId, patch) =>
        this.liveMutator.mutatePrefabLight(this.session.getProject(), prefabId, patch),
    });
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

    this.dom.rightTitleEl.textContent = 'ECS 元件檢查器與沙盒腳本';
    const ent = proj.entities.find((e) => e.id === this.selectedEntityId);
    if (!ent) {
      const empty = document.createElement('p');
      empty.className = 'p7-empty-note';
      empty.textContent = '請從左側階層樹選取任一實體以檢視或編輯其 ECS 元件與 PBR 材質。';
      this.dom.rightContentEl.appendChild(empty);
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
    const sceneSections = buildSceneAndHistorySections(proj, this.session, this.runtime, () => this.renderPreviewNow());
    this.dom.rightContentEl.append(...entitySections, ...sceneSections);
  }

  public openExternalImportModal(): void {
    this.externalImportModal.open();
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
      this.switchActiveRoom(result.rooms[0].id);
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
    this.unsubSession();
    this.ac.abort();
    this.mapCanvasCtrl.destroy();
    this.worldRulesPanel.destroy();
    this.externalImportModal.destroy();
    this.eventGraphView.destroy();
    this.previewGpu.dispose();
    this.element.remove();
  }
}
