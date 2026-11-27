import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import { critiqueCutsceneAesthetics } from '../core/ai/EcsCinematicOracle.ts';
import type { EcsCartridgeRuntime } from '../core/ecs/EcsCartridgeRuntime.ts';
import { resolveEntityComponents, type EcsProjectV2 } from '../core/ecs/EcsProjectSchema.ts';
import type { EcsStudioSession } from '../core/ecs/EcsStudioSession.ts';
import { MAX_VOXEL_STORIES } from '../core/ecs/EcsVoxelVolume.ts';
import type { GpuEngine } from '../core/gpu/GpuEngine.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import { SceneGpuBridge } from '../core/runtime/SceneGpuBridge.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../core/types/WorldTypes.ts';
import type { MapDesignerState } from './EcsMapDesignerPanel.ts';
import { rotateVoxelShape } from './EcsMapDesignerPanelTools.ts';
import type { WorkbenchDiagReport } from './EcsWorkbenchCatalog.ts';
import type { EcsWorkbenchMapCanvasController } from './EcsWorkbenchMapCanvasController.ts';
import type {
  EcsWorkbenchShellRefs,
  WorkbenchCamera3DViewChoice,
  WorkbenchCenterMode,
} from './EcsWorkbenchShellBuilder.ts';
import type { EventGraphEditorView } from './EventGraphEditorView.ts';

export interface PreviewRuntimeDeps {
  host: EngineHost;
  atlas: TextureAtlas;
  session: EcsStudioSession;
  runtime: EcsCartridgeRuntime;
  previewGpu: GpuEngine;
  dom: EcsWorkbenchShellRefs;
  mapState: MapDesignerState;
  getMapCanvasCtrl: () => EcsWorkbenchMapCanvasController;
  getEventGraphView: () => EventGraphEditorView | null;
  getSelectedEntityIds?: () => readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  isVisible: () => boolean;
  isModalOpen: () => boolean;
  getCenterMode: () => WorkbenchCenterMode;
  setCenterMode: (mode: WorkbenchCenterMode) => void;
  onToolShortcutMutated: () => void;
  onRequestFullPanelRender: () => void;
  onDiagReportReady: (report: WorkbenchDiagReport) => void;
}

/**
 * Preview, Playtest, Cutscene, Keyboard-Input & Viewport Runtime Controller for `EcsWorkbenchView`.
 * Keeps `EcsWorkbenchView` focused on workbench panel orchestration, session wiring, and lazy modal imports.
 */
export class EcsWorkbenchPreviewRuntime {
  private readonly deps: PreviewRuntimeDeps;
  private readonly previewBridge = new SceneGpuBridge();
  private readonly liveInput = createEmptyInputState();
  private readonly heldKeys = { left: false, right: false, up: false, down: false, dash: false };

  private simRunning: boolean;
  private debugOverlay = false;
  private previewDirty = true;
  private lastRenderedScore = 0;
  private lastStatusSyncAccum = 0;
  private pulseActionFrames = 0;
  private pulseJumpFrames = 0;
  private pulseShiftFrames = 0;
  private renderPixelW = 1280;
  private renderPixelH = 720;

  constructor(deps: PreviewRuntimeDeps, initialSimRunning: boolean) {
    this.deps = deps;
    this.simRunning = initialSimRunning;
    if (!this.simRunning) {
      this.deps.runtime.getWorldMapController().director.reset(true);
    }
    this.syncEditorSliceCutaway();
  }

  public syncEditorSliceCutaway(): void {
    const wmCtrl = this.deps.runtime.getWorldMapController();
    if (this.simRunning) {
      wmCtrl.setEditorSliceCutaway('all', 0);
    } else {
      wmCtrl.setEditorSliceCutaway(this.deps.mapState.sliceCutawayMode, this.deps.mapState.activeZLevel);
    }
    this.previewDirty = true;
  }

  public focusEntities(entityIds: readonly string[]): boolean {
    if (entityIds.length === 0) return false;
    const proj = this.deps.session.getProject();
    const activeRoomId = this.deps.runtime.getActiveRoomId();
    const idSet = new Set(entityIds);
    const core = this.deps.runtime.world.core;
    const tagStore = core.getStore(core.components.Tag);
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;
    for (const ent of proj.entities) {
      if (!idSet.has(ent.id)) continue;
      if (proj.worldMap && activeRoomId && ent.roomId && ent.roomId !== activeRoomId) continue;
      const resolved = resolveEntityComponents(ent, proj.prefabs);
      let { x, y } = resolved.transform;
      let w = resolved.transform.w ?? 16;
      let h = resolved.transform.h ?? 16;
      let z = resolved.spatial3d?.z ?? 0;
      for (let i = 0; i < tagStore.size(); i++) {
        if (tagStore.getDenseDataAt(i).entityId !== ent.id) continue;
        const eh = tagStore.getDenseEntityAt(i);
        const tr = core.getComponent(eh, core.components.Transform2D);
        if (tr) {
          x = tr.x;
          y = tr.y;
          w = tr.w;
          h = tr.h;
        }
        const sp = core.getComponent(eh, core.components.Spatial3D);
        if (sp) z = sp.z;
        break;
      }
      sumX += x + w * 0.5;
      sumY += y + h * 0.5;
      sumZ += z;
      count++;
    }
    if (count === 0) return false;
    this.deps.runtime.setEditorCamera(
      sumX / count - proj.viewport.width * 0.5,
      sumY / count - proj.viewport.height * 0.5,
    );
    if (proj.projection?.mode === 'hd2d_3d') {
      this.deps.runtime.getWorldMapController().cameraZ = sumZ / count;
    }
    this.previewDirty = true;
    this.renderPreviewNow();
    return true;
  }

  public resetEditorCamera(): void {
    this.deps.runtime.clearEditorCamera();
    this.syncEditorSliceCutaway();
    this.previewDirty = true;
    this.renderPreviewNow();
  }

  public isSimRunning(): boolean {
    return this.simRunning;
  }

  public getPlayPauseLabel(): string {
    const hasMap = Boolean(this.deps.session.getProject().worldMap);
    if (hasMap) return this.simRunning ? '返回編輯地圖' : '開始試玩';
    return this.simRunning ? '暫停模擬' : '繼續模擬';
  }

  public markDirty(): void {
    this.previewDirty = true;
  }

  public pulseAction(frames = 4): void {
    this.pulseActionFrames = frames;
    this.previewDirty = true;
  }

  public pulseJump(frames = 4): void {
    this.pulseJumpFrames = frames;
    this.previewDirty = true;
  }

  public pulseShift(frames = 2): void {
    this.pulseShiftFrames = frames;
    this.previewDirty = true;
  }

  public isMapEditingActive(): boolean {
    return (
      Boolean(this.deps.session.getProject().worldMap) &&
      !this.simRunning &&
      this.deps.getCenterMode() === 'viewport'
    );
  }

  public setSimRunning(running: boolean): void {
    this.simRunning = running;
    if (running) {
      this.deps.mapState.spacePanHeld = false;
      this.deps.runtime.clearEditorCamera();
      this.deps.getMapCanvasCtrl().clearPendingStroke();
    } else if (this.deps.session.getProject().worldMap) {
      this.deps.runtime.getWorldMapController().director.reset(false);
    }
    this.syncEditorSliceCutaway();
    this.deps.dom.playPauseBtn.textContent = this.getPlayPauseLabel();
    this.deps.getMapCanvasCtrl().syncInteractivity();
    this.previewDirty = true;
    this.renderPreviewNow();
    this.updateStatusStrip();
  }

  public stepSingleFrame(): void {
    this.setSimRunning(false);
    this.deps.runtime.step(1 / 60, this.liveInput, DEFAULT_RUNTIME_PARAMS);
    this.previewDirty = true;
    this.renderPreviewNow();
    this.updateStatusStrip();
  }

  public resetRuntime(): void {
    this.deps.runtime.reset();
    if (!this.simRunning) {
      this.deps.runtime.getWorldMapController().director.reset(true);
    }
    this.previewDirty = true;
    this.renderPreviewNow();
    this.updateStatusStrip();
  }

  public toggleDebugOverlay(): void {
    this.debugOverlay = !this.debugOverlay;
    this.deps.runtime.setDebugHitboxes(this.debugOverlay);
    this.deps.dom.overlayBtn.classList.toggle('p7-btn-accent', this.debugOverlay);
    this.previewDirty = true;
  }

  public syncSimStateForProjectLoad(proj: EcsProjectV2, sameProject: boolean): void {
    if (!sameProject) {
      this.deps.runtime.clearEditorCamera();
      this.simRunning = !proj.worldMap;
    }
    if (!this.simRunning) {
      this.deps.runtime.getWorldMapController().director.reset(true);
    }
    this.syncEditorSliceCutaway();
    this.syncViewportSize(proj);
  }

  public switchActiveRoom(roomId: string): void {
    this.deps.runtime.switchRoomForEditor(roomId);
    const proj = this.deps.session.getProject();
    const room = proj.worldMap?.rooms.find((r) => r.id === roomId);
    if (!this.simRunning && room && proj.worldMap) {
      this.deps.runtime.getWorldMapController().director.reset(true);
      const ts = proj.worldMap.tileSize;
      const worldW = room.cols * ts;
      const centerX = Math.max(0, (worldW - proj.viewport.width) * 0.5);
      if (typeof room.editorFocusY === 'number') {
        this.deps.runtime.setEditorCamera(centerX, room.editorFocusY);
      } else {
        this.deps.runtime.clearEditorCamera();
      }
    } else {
      this.deps.runtime.clearEditorCamera();
    }
    this.previewDirty = true;
    this.renderPreviewNow();
    this.deps.onRequestFullPanelRender();
  }

  public syncViewportSize(proj: EcsProjectV2): void {
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
    this.deps.previewGpu.setLogicalViewport(w, h);
    this.deps.previewGpu.resize(this.renderPixelW, this.renderPixelH);
    this.deps.dom.mapOverlayCanvas.width = w;
    this.deps.dom.mapOverlayCanvas.height = h;
    this.deps.dom.previewCanvas.classList.toggle('is-smooth', w >= 640);
    if (proj.viewport.preset) {
      this.deps.dom.viewportSelectEl.value = proj.viewport.preset;
    }
    this.previewDirty = true;
  }

  public tick(dt: number): void {
    if (!this.deps.isVisible()) return;
    const proj = this.deps.session.getProject();
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

      const events = this.deps.runtime.step(Math.min(1 / 30, dt), this.liveInput, DEFAULT_RUNTIME_PARAMS);
      for (let i = 0; i < events.length; i++) {
        if (events[i] === 'star') this.deps.host.playStereoTick(880, 0, 0.14);
        else if (events[i] === 'snap' || events[i] === 'jump') this.deps.host.playStereoTick(660, 0, 0.1);
      }
    } else if (proj.worldMap) {
      const panSpeed = 240 * Math.min(1 / 20, dt);
      const dx = (this.heldKeys.right ? 1 : 0) - (this.heldKeys.left ? 1 : 0);
      const dy = (this.heldKeys.down ? 1 : 0) - (this.heldKeys.up ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const cam = this.deps.runtime.getCamera();
        this.deps.runtime.setEditorCamera(cam.x + dx * panSpeed, cam.y + dy * panSpeed);
        this.previewDirty = true;
      }
    }

    if (this.deps.getCenterMode() === 'viewport') {
      const directorActive = this.deps.runtime.getWorldMapController().director.isCutscenePlaying();
      if (this.simRunning || directorActive || this.previewDirty) {
        this.renderPreviewNow();
      }
    } else {
      this.deps.getEventGraphView()?.updateLiveTrace(this.deps.runtime.vm);
    }

    this.lastStatusSyncAccum += dt;
    if (this.lastStatusSyncAccum >= 0.25) {
      this.lastStatusSyncAccum = 0;
      this.updateStatusStrip();
    }
  }

  public renderPreviewNow(): void {
    const mapCtrl = this.deps.getMapCanvasCtrl();
    if (!this.deps.previewGpu.hasBackend()) {
      mapCtrl.renderOverlay();
      return;
    }
    this.previewDirty = false;
    const snap = this.deps.runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    this.lastRenderedScore = snap.score;
    this.previewBridge.render(this.deps.previewGpu, snap, null);
    mapCtrl.renderOverlay();
  }

  public updateStatusStrip(): void {
    const proj = this.deps.session.getProject();
    const stats = this.deps.atlas.getAtlasStats();
    const sysCount = this.deps.runtime.world.getSystemPipeline().length;
    const activeRoomId = this.deps.runtime.getActiveRoomId();
    const activeRoom = proj.worldMap?.rooms.find((r) => r.id === activeRoomId);
    const roomPart = activeRoom ? ` · 房間 ${activeRoom.name} (${activeRoom.cols}×${activeRoom.rows})` : '';
    this.deps.dom.statusLeftEl.textContent =
      `${proj.meta.code} ${proj.meta.title}${roomPart} · 視口 ${proj.viewport.width}×${proj.viewport.height}` +
      ` · ECS ${this.deps.runtime.world.activeCount} 實體 / ${sysCount} 系統`;
    this.deps.dom.statusRightEl.textContent =
      `圖集 ${stats.pageCount}/${stats.maxPages} 頁 · ${this.simRunning ? '試玩中' : '編輯模式'} · 分數 ${this.lastRenderedScore} · 修訂 #${this.deps.session.getRevision()}`;
  }

  public selectCamera3DView(view: WorkbenchCamera3DViewChoice): void {
    const proj = this.deps.session.getProject();
    if (view === 'quad') {
      const cur = Boolean(proj.projection?.quadView);
      this.deps.session.dispatch({ type: 'set_camera_3d_pose', quadView: !cur });
    } else {
      this.deps.session.dispatch({ type: 'set_camera_3d_pose', cameraProjection3d: view, quadView: false });
    }
  }

  public syncSpatial3dBar(proj: EcsProjectV2): void {
    const is3d = proj.projection?.mode === 'hd2d_3d';
    this.deps.dom.spatial3dBarEl.classList.toggle('panel-hidden', !is3d);
    if (!is3d) return;
    const isQuad = Boolean(proj.projection?.quadView);
    const activeCam = proj.projection?.cameraProjection3d ?? 'perspective';
    const entries = Object.entries(this.deps.dom.spatial3dViewBtns) as [
      WorkbenchCamera3DViewChoice,
      HTMLButtonElement | undefined,
    ][];
    for (const [key, b] of entries) {
      if (!b) continue;
      const active = key === 'quad' ? isQuad : !isQuad && activeCam === key;
      b.classList.toggle('p7-btn-accent', active);
    }
    this.deps.dom.toggleAxisGizmoBtn.classList.toggle('p7-btn-accent', Boolean(proj.projection?.showAxisGizmo3d));
    this.deps.dom.toggleOrthoGridBtn.classList.toggle('p7-btn-accent', Boolean(proj.projection?.showOrthoGrid3d));
    this.deps.dom.toggleShadowMapBtn.classList.toggle('p7-btn-accent', proj.projection?.shadowMapEnabled !== false);
  }

  public playCutscene(cutsceneId: string): void {
    const proj = this.deps.session.getProject();
    const cs = proj.cutscenes?.find((c) => c.id === cutsceneId);
    if (!cs) return;
    if (this.deps.getCenterMode() !== 'viewport') {
      this.deps.setCenterMode('viewport');
    }
    if (!this.simRunning) {
      this.setSimRunning(true);
    }
    if (cs.roomId && proj.worldMap && this.deps.runtime.getActiveRoomId() !== cs.roomId) {
      this.switchActiveRoom(cs.roomId);
    }
    this.deps.runtime.clearEditorCamera();
    this.deps.runtime.playCutscene(cs.id);
    this.previewDirty = true;
    this.renderPreviewNow();
  }

  public critiqueCutscene(cutsceneId: string): void {
    const proj = this.deps.session.getProject();
    const report = critiqueCutsceneAesthetics(proj, cutsceneId);
    if (!report.ok) {
      this.deps.onDiagReportReady({
        ok: false,
        headline: `審美預言機無法評分：${cutsceneId}`,
        lines: report.suggestions,
      });
      return;
    }

    const shotCount = Math.max(1, report.shots.length);
    let sumOcc = 0;
    let sumComp = 0;
    let sumAxis = 0;
    let sumDram = 0;
    const shotHeadlines: string[] = [];
    for (let i = 0; i < report.shots.length; i++) {
      const s = report.shots[i];
      sumOcc += s.occlusionScore;
      sumComp += s.compositionScore;
      sumAxis += s.axisContinuityScore;
      sumDram += s.dramaturgyScore;
      shotHeadlines.push(s.asciiViewfinder.split('\n')[0] ?? `Shot #${i + 1} [${s.shotId}]`);
    }

    this.deps.onDiagReportReady({
      ok: report.pass,
      headline: `電影審美神諭 [${report.grade}] ${report.overallScore}/100 · ${report.pass ? 'PASS' : '需調校'} · ${report.cutsceneName}`,
      lines: [
        `5 軸評分：遮蔽 ${Math.round(sumOcc / shotCount)} · 構圖 ${Math.round(sumComp / shotCount)} · 180°軸線 ${Math.round(sumAxis / shotCount)} · 戲劇 ${Math.round(sumDram / shotCount)} · 回歸 ${report.handbackContinuityScore} (殘差 ${report.handbackResidualPx}px)`,
        ...shotHeadlines.slice(0, 4),
        ...(report.suggestions.length > 0
          ? report.suggestions.slice(0, 3).map((s) => `建議：${s}`)
          : [`0 項遮蔽/構圖/軸線異常 · ${report.totalDurationSec}s (${report.framesSimulated} 幀)`]),
      ],
    });
  }

  public bindKeyboardShortcuts(signal: AbortSignal): void {
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.deps.isVisible() || this.deps.isModalOpen()) {
          return;
        }
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const proj = this.deps.session.getProject();
        const isWorldMap = Boolean(proj.worldMap);
        const hasMotor =
          this.deps.runtime.world.core.getStore(this.deps.runtime.world.core.components.CharacterMotor2D).size() > 0;

        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
          e.preventDefault();
          if (e.shiftKey) this.deps.session.redo();
          else this.deps.session.undo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
          e.preventDefault();
          this.deps.session.redo();
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyP') {
          e.preventDefault();
          this.setSimRunning(!this.simRunning);
          return;
        }

        if (isWorldMap) {
          this.handleWorldMapKeyDown(e);
          return;
        }

        if (e.code === 'ArrowLeft') this.heldKeys.left = true;
        else if (e.code === 'ArrowRight') this.heldKeys.right = true;
        else if (e.code === 'ArrowUp') this.heldKeys.up = true;
        else if (e.code === 'ArrowDown') this.heldKeys.down = true;
        else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.heldKeys.dash = true;
        else if (e.code === 'Space') {
          this.deps.host.unlockAudio();
          if (hasMotor) this.pulseJumpFrames = 3;
          else this.pulseActionFrames = 3;
        } else if (e.code === 'KeyA' || e.code === 'KeyJ') {
          this.deps.host.unlockAudio();
          this.pulseActionFrames = 3;
        } else if (e.code === 'KeyB' || e.code === 'KeyK') {
          this.deps.host.unlockAudio();
          this.pulseJumpFrames = 3;
        } else if (e.code === 'KeyR') {
          this.deps.host.unlockAudio();
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
        else if (e.code === 'Space' && this.deps.mapState.spacePanHeld) {
          this.deps.mapState.spacePanHeld = false;
          this.deps.getMapCanvasCtrl().syncInteractivity();
        }
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
        if (this.deps.mapState.spacePanHeld) {
          this.deps.mapState.spacePanHeld = false;
          this.deps.getMapCanvasCtrl().syncInteractivity();
        }
      },
      { signal },
    );
  }

  private handleWorldMapKeyDown(e: KeyboardEvent): void {
    if (this.simRunning) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.heldKeys.left = true;
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.heldKeys.right = true;
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.heldKeys.up = true;
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.heldKeys.down = true;
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.heldKeys.dash = true;
      else if (e.code === 'Space' || e.code === 'KeyK') {
        e.preventDefault();
        this.deps.host.unlockAudio();
        this.pulseJumpFrames = 4;
      } else if (e.code === 'KeyJ' || e.code === 'KeyZ' || e.code === 'Enter') {
        this.deps.host.unlockAudio();
        this.pulseActionFrames = 4;
      }
      return;
    }

    // Edit Mode: Godot / 2D+3D Hybrid Keymap
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
      e.preventDefault();
      const sel = this.deps.getSelectedEntityIds?.() ?? [];
      if (sel.length > 0) {
        const res = this.deps.session.dispatch({ type: 'duplicate_entities', entityIds: [...sel], offsetX: 16, offsetY: 16 });
        const created = res.ok ? (res.createdEntityIds?.length ? [...res.createdEntityIds] : res.createdEntityId ? [res.createdEntityId] : null) : null;
        if (created) this.deps.onSelectionChange?.(created);
      }
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.deps.mapState.spacePanHeld) {
        this.deps.mapState.spacePanHeld = true;
        this.deps.getMapCanvasCtrl().syncInteractivity();
      }
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      const sel = this.deps.getSelectedEntityIds?.() ?? [];
      if (sel.length > 0) {
        e.preventDefault();
        if (sel.length === 1) this.deps.session.dispatch({ type: 'remove_entity', entityId: sel[0] });
        else this.deps.session.dispatchBatch(sel.map((entityId) => ({ type: 'remove_entity', entityId })), `刪除 ${sel.length} 個實體`);
        this.deps.onSelectionChange?.([]);
      }
      return;
    }
    if (e.code === 'KeyQ') {
      e.preventDefault();
      this.deps.mapState.voxelShape = rotateVoxelShape(this.deps.mapState.voxelShape, e.shiftKey ? -1 : 1);
      this.previewDirty = true;
      this.deps.onToolShortcutMutated();
      this.deps.getMapCanvasCtrl().renderOverlay();
      return;
    }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      e.preventDefault();
      const nextZ = Math.max(0, Math.min(MAX_VOXEL_STORIES - 1, this.deps.mapState.activeZLevel + (e.code === 'BracketRight' ? 1 : -1)));
      if (nextZ !== this.deps.mapState.activeZLevel) {
        this.deps.mapState.activeZLevel = nextZ;
        this.syncEditorSliceCutaway();
        this.deps.onToolShortcutMutated();
        this.renderPreviewNow();
      }
      return;
    }
    if (e.code === 'KeyF') {
      e.preventDefault();
      this.focusEntities(this.deps.getSelectedEntityIds?.() ?? []);
      return;
    }
    if (e.code === 'Home' || e.code === 'Digit0') {
      e.preventDefault();
      this.resetEditorCamera();
      return;
    }
    const toolMap: Record<string, MapDesignerState['tool']> = {
      KeyV: 'select',
      KeyB: 'brush',
      KeyR: 'rect',
      KeyG: 'fill',
      KeyE: 'erase',
      KeyI: 'eyedropper',
    };
    const tool = toolMap[e.code];
    if (tool) {
      this.deps.mapState.tool = tool;
      if (tool !== 'stamp') this.deps.mapState.selectedStampPrefabId = null;
      this.previewDirty = true;
      this.deps.getMapCanvasCtrl().syncInteractivity();
      this.deps.onToolShortcutMutated();
      this.deps.getMapCanvasCtrl().renderOverlay();
      return;
    }
    if (!e.altKey) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.heldKeys.left = true;
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.heldKeys.right = true;
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.heldKeys.up = true;
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.heldKeys.down = true;
    }
  }
}
