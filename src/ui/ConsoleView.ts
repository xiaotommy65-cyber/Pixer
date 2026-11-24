import { CARTRIDGES } from '../core/runtime/CartridgeRegistry.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeId, InputState, RenderSceneSnapshot, ScreenFilterMode } from '../core/types/WorldTypes.ts';
import type { DpadDeadzoneMode, StickCurveMode } from '../core/input/InputPipeline.ts';
import type { GpuFrameStats } from '../core/gpu/GpuTypes.ts';
import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { HapticSide } from '../core/hal/HapticEngine.ts';
import type { ErgonomicGripMode } from '../core/hal/SystemHal.ts';
import type { BootPickupStage } from './BootBlinkOverlay.ts';
import { invalidateCardArtCache } from './CardArt.ts';
import { CartridgeSlotController, type ConsolePhase } from './CartridgeSlotController.ts';
import { buildConsoleBodyDom } from './ConsoleBodyBuilder.ts';
import { ConsoleHudPresenter } from './ConsoleHudPresenter.ts';
import { buildJoyconsAndAuxRail } from './ConsoleJoyconBuilder.ts';
import { ConsoleShellRouter, type ShellPhase } from './ConsoleShellRouter.ts';
import { ConsoleSpatialController } from './ConsoleSpatialController.ts';
import { DeskWorldView } from './DeskWorldView.ts';
import { ShmupOverlayView } from './ShmupOverlayView.ts';
import { VirtualGamepadInput } from './VirtualGamepadInput.ts';
import {
  WindowDioramaView,
  type DioramaPerspective,
  type DioramaTimeMode,
} from './WindowDioramaView.ts';
import { el, pulseTransientClass } from './dom.ts';

export type { ConsolePhase, DioramaPerspective, DioramaTimeMode, ShellPhase };

export interface ConsoleViewOptions {
  onGamepadChange?: (connected: boolean, label: string | null) => void;
  onOpenEditor: (originEl: HTMLElement) => void;
  onOpenAdvancedSettings: () => void;
  onToggleMute: () => boolean;
  isMuted: () => boolean;
  isExternalModalOpen: () => boolean;
  onEscapeExternal?: () => boolean;
  onThemeGlowChange?: (hex: string) => void;
  onFilterChange?: (mode: ScreenFilterMode) => void;
  onPerspectiveChange?: (perspective: DioramaPerspective) => void;
}

/**
 * Switch-style handheld OS shell: Joy-Con (L) | screen body | Joy-Con (R),
 * composing DeskWorldView, ConsoleSpatialController, VirtualGamepadInput,
 * CartridgeSlotController, ConsoleHudPresenter, and ConsoleShellRouter.
 */
export class ConsoleView {
  public readonly element: HTMLElement;
  public canvas: HTMLCanvasElement;
  public onCanvasPointer?: (nx: number, ny: number, active: boolean, primary: boolean, secondary: boolean) => void;

  private readonly host: EngineHost;
  private captureRequested = false;

  private readonly consoleEl: HTMLElement;
  private readonly spatialTrackEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly leftJoyconEl: HTMLElement;
  private readonly rightJoyconEl: HTMLElement;
  private readonly auxRailEl: HTMLElement;
  private readonly screenFrame: HTMLElement;
  private readonly glassSheenEl: HTMLElement;
  private readonly deskWorld: DeskWorldView;
  private readonly diorama: WindowDioramaView;
  private readonly spatial: ConsoleSpatialController;
  private readonly onPerspectiveChange?: (perspective: DioramaPerspective) => void;
  private readonly ac = new AbortController();
  private canvasAc: AbortController | null = null;
  private readonly activeTimers = new Set<number>();
  private readonly recoilTimers = new WeakMap<HTMLElement, number>();
  private readonly busUnsubs: (() => void)[] = [];

  private readonly gamepad: VirtualGamepadInput;
  private readonly slots: CartridgeSlotController;
  private readonly hud: ConsoleHudPresenter;
  private readonly router: ConsoleShellRouter;

  private hwGamepadConnected = false;
  private hwGamepadLabel: string | null = null;
  private debugHitboxesOn = false;
  private perspective: DioramaPerspective = 'focus';
  private currentShellPhase: ShellPhase = 'BOOT_BLINK';
  private currentBootStage: BootPickupStage = 'standby';

  constructor(host: EngineHost, atlas: TextureAtlas, onExitLandscape: (() => void) | undefined, opts: ConsoleViewOptions) {
    this.host = host;
    this.onPerspectiveChange = opts.onPerspectiveChange;
    this.element = el('section', 'switch-stage');
    this.element.dataset.perspective = this.perspective;
    this.consoleEl = el('div', 'switch-console');

    this.gamepad = new VirtualGamepadInput({
      unlockAudio: () => this.host.unlockAudio(),
      playTactile: (profile, phase, side) => this.host.playTactile(profile, phase, side),
      triggerRecoil: (side) => this.triggerJoyconRecoil(side),
      triggerHaptic: (profile, side, skipAcoustic) => this.host.triggerHaptic(profile, side, skipAcoustic),
      onGamepadConnectionChange: (connected, label) => {
        this.hwGamepadConnected = connected;
        this.hwGamepadLabel = label;
        opts.onGamepadChange?.(connected, label);
        const shortName = label ? label.split('(')[0].trim().slice(0, 22) : 'USB/藍牙手把';
        this.showCaptureToast(connected ? `🎮 已連接實體手把：${shortName}` : '🎮 實體手把已中斷連線');
      },
      onEscapeKey: () => this.router.handleEscapeAction(),
      onConfirmKey: () => this.router.triggerConfirmKey(),
      onHomeKey: () => this.router.handleHomeButton(),
      onCycleCardHotkey: () => this.router.openCartridgeDrawer(),
      onDebugToggle: () => {
        const on = this.toggleDebugHitboxes();
        this.showCaptureToast(on ? '🧪 除錯碰撞框：開啟' : '🧪 除錯碰撞框：關閉');
      },
      onCartridgeSlotKey: (idx) => {
        const meta = CARTRIDGES[idx];
        if (meta) this.router.launchCartridge(meta.id, false);
      },
      onEjectKey: () => this.router.returnToHomeLobby(),
      onShmupHotkey: (cmd) => {
        if (this.router.getShellPhase() !== 'IN_GAME') return;
        this.host.unlockAudio();
        this.host.dispatchCommand(cmd);
      },
      onChronicleHotkey: (cmd) => {
        if (this.router.getShellPhase() !== 'IN_GAME') return;
        this.host.unlockAudio();
        this.host.dispatchCommand(cmd);
      },
      isInputBlocked: () => this.router.isInputBlocked(),
    });

    this.host.hal.haptic.setCallbacks({
      getGamepadActuator: () => this.gamepad.getActiveGamepadActuator(),
      onVisualRecoil: (side: HapticSide, profile) => {
        if (side === 'left' || side === 'right') this.triggerJoyconRecoil(side);
        else this.triggerChassisJolt(profile === 'impact' || profile === 'celebrate');
      },
    });

    const onOverlayCommand = (cmdId: string) => {
      this.host.unlockAudio();
      this.host.dispatchCommand(cmdId);
    };
    const shmupOverlay = new ShmupOverlayView({ onCommand: onOverlayCommand });

    const rig = buildJoyconsAndAuxRail(this.gamepad, {
      onOpenDrawer: () => this.router.openCartridgeDrawer(),
      onRequestCapture: () => this.requestCapture(),
      onPlusAction: () => this.handlePlusAction(),
      onHomeButton: () => this.router.handleHomeButton(),
    });
    this.leftJoyconEl = rig.leftJoyconEl;
    this.rightJoyconEl = rig.rightJoyconEl;
    this.auxRailEl = rig.auxRailEl;

    const body = buildConsoleBodyDom({
      initialFilter: host.getScreenFilter(),
      shmupOverlay,
      onReturnHome: () => this.router.returnToHomeLobby(),
      onClearSave: () => this.clearActiveSram(),
      onOpenSettings: () => opts.onOpenAdvancedSettings(),
      onExitLandscape: () => onExitLandscape?.(),
      onRetryStage: () => this.host.retryStage(),
      onRestartFresh: () => this.host.restartFresh(),
    });
    this.bodyEl = body.bodyEl;
    this.screenFrame = body.screenFrame;
    this.glassSheenEl = body.glassSheen;
    this.canvas = body.canvas;
    this.attachCanvas(this.canvas);

    this.consoleEl.append(rig.portraitRailBridge, this.auxRailEl, this.leftJoyconEl, this.bodyEl, this.rightJoyconEl);

    this.deskWorld = new DeskWorldView(host, atlas, {
      onOpenEditor: (originEl) => opts.onOpenEditor(originEl),
      onSelectCartridge: (id) => this.router.launchCartridge(id, false),
      onRequestCapture: () => this.requestCapture(),
      onScrollToPage: (pageIdx) => this.spatial.scrollToPage(pageIdx, true),
    });

    this.diorama = new WindowDioramaView(host, atlas, {
      onRequestWindowFocus: () => {
        if (this.currentShellPhase === 'HOME_LOBBY' && this.currentBootStage === 'awake') {
          this.setPerspective('window');
        }
      },
      onLightingChange: (env) => {
        const s = this.element.style;
        s.setProperty('--env-light-x', env.lightX);
        s.setProperty('--env-light-dir', env.lightDir);
        s.setProperty('--env-shadow-x', env.shadowX);
        s.setProperty('--env-light-color', env.lightColor);
        s.setProperty('--env-rim-color', env.rimColor);
        s.setProperty('--env-glass-angle', env.glassAngle);
        s.setProperty('--env-light-strength', env.lightStrength);
        s.setProperty('--env-fire', env.fire);
      },
    });
    const initEnv = this.diorama.getLightEnv();
    const rootStyle = this.element.style;
    rootStyle.setProperty('--env-light-x', initEnv.lightX);
    rootStyle.setProperty('--env-light-dir', initEnv.lightDir);
    rootStyle.setProperty('--env-shadow-x', initEnv.shadowX);
    rootStyle.setProperty('--env-light-color', initEnv.lightColor);
    rootStyle.setProperty('--env-rim-color', initEnv.rimColor);
    rootStyle.setProperty('--env-glass-angle', initEnv.glassAngle);
    rootStyle.setProperty('--env-light-strength', initEnv.lightStrength);
    rootStyle.setProperty('--env-fire', initEnv.fire);

    this.spatialTrackEl = el('div', 'desk-spatial-track');
    const consoleSlot = el('div', 'desk-console-slot');
    consoleSlot.append(this.consoleEl, this.deskWorld.handsOverlayEl);
    this.spatialTrackEl.append(this.deskWorld.notebookPropEl, consoleSlot, this.deskWorld.trayPropEl);
    this.element.append(
      this.diorama.backdropEl,
      this.deskWorld.deskBgEl,
      this.spatialTrackEl,
      this.deskWorld.portraitPagerEl,
      this.diorama.surfaceBtn,
    );

    this.spatial = new ConsoleSpatialController({
      stageEl: this.element,
      spatialTrackEl: this.spatialTrackEl,
      parallaxTargets: [this.diorama.backdropEl, this.deskWorld.deskBgEl, this.glassSheenEl, this.consoleEl],
      canApplyParallax: () => this.currentShellPhase === 'HOME_LOBBY' && this.currentBootStage === 'awake',
      onActivePageChange: (idx) => this.deskWorld.setActivePage(idx),
    });

    this.hud = new ConsoleHudPresenter(
      host,
      {
        stageTag: body.stageTag,
        scoreTag: body.scoreTag,
        starTag: body.starTag,
        spriteStatTag: body.spriteStatTag,
        fpsTag: body.fpsTag,
        statusHintEl: body.statusHintEl,
        resultOverlay: body.resultOverlay,
        resultTitle: body.resultTitle,
        resultDesc: body.resultDesc,
        clearSaveBtn: body.clearSaveBtn,
        bodyLegendEl: body.bodyLegendEl,
        aSubEl: rig.aSubEl,
        bSubEl: rig.bSubEl,
        xSubEl: rig.xSubEl,
        ySubEl: rig.ySubEl,
        lSubEl: rig.lSubEl,
        rSubEl: rig.rSubEl,
        auxLSubEl: rig.auxLSubEl,
        auxRSubEl: rig.auxRSubEl,
        shmupOverlay,
      },
      {
        setAutofireBlocked: (blocked) => this.gamepad.setCartridgeAutofireBlocked(blocked),
        onRecordSaved: () => this.router.refreshCards(),
      },
    );

    this.slots = new CartridgeSlotController(
      host,
      {
        slotEl: body.slotEl,
        slotLed: body.slotLed,
        slotWindow: body.slotWindow,
        slotHint: body.slotHint,
        ejectBtn: body.ejectBtn,
        clearSaveBtn: body.clearSaveBtn,
        screenFrame: body.screenFrame,
        bootVeilEl: body.bootVeilEl,
        ledStrips: rig.ledStrips,
      },
      {
        onBeforeBoot: (id, resumedSram, meta) => {
          this.hud.showBeforeBoot(id, resumedSram, meta);
          opts.onThemeGlowChange?.(meta.accentHex);
        },
        onShowEmpty: () => {
          this.hud.showEmpty();
        },
        onPlayRailSnap: () => this.playRailSnap(),
        onSlotClick: () => this.router.openCartridgeDrawer(),
        scheduleTimer: (fn, ms) => this.scheduleTimer(fn, ms),
      },
      this.ac.signal,
    );

    this.router = new ConsoleShellRouter(host, atlas, {
      screenFrame: body.screenFrame,
      screenFilterLayer: body.screenFilterLayer,
      shellRootEl: this.element,
      onFocusLobbyCartridge: (meta) => {
        opts.onThemeGlowChange?.(meta.accentHex);
        this.slots.showLobbyFocusBadge(meta);
      },
      onLaunchCartridge: (id, forceFresh) => this.slots.insertCartridge(id, false, false, forceFresh),
      onOpenEditor: (originEl) => opts.onOpenEditor(originEl),
      onOpenAdvancedSettings: () => opts.onOpenAdvancedSettings(),
      onToggleMute: () => opts.onToggleMute(),
      isMuted: () => opts.isMuted(),
      onToggleDebugHitboxes: () => this.toggleDebugHitboxes(),
      isDebugHitboxesOn: () => this.debugHitboxesOn,
      isExternalModalOpen: () => opts.isExternalModalOpen(),
      onEscapeExternal: opts.onEscapeExternal,
      onSyncHudIdle: () => this.hud.updateControlLabels(null),
      onToast: (msg) => this.showCaptureToast(msg),
      onFilterChange: opts.onFilterChange,
      onBootStageChange: (stage) => {
        this.currentBootStage = stage;
        this.element.dataset.bootStage = stage;
        this.diorama.setShellState(this.currentShellPhase, stage);
      },
      onShellPhaseChange: (phase) => {
        this.currentShellPhase = phase;
        this.element.dataset.shellPhase = phase;
        this.diorama.setShellState(phase, this.currentBootStage);
        this.bodyEl.classList.toggle('is-lobby-clean', phase !== 'IN_GAME');
        this.screenFrame.scrollLeft = 0;
        this.screenFrame.scrollTop = 0;
        if (phase === 'IN_GAME' || phase === 'BOOT_BLINK') {
          if (this.perspective !== 'focus') this.setPerspective('focus');
          this.spatial.scrollToPage(1, false);
          this.spatial.setParallax(0, 0);
        }
      },
      hasInsertedCartridge: () => Boolean(this.slots.getInserted()),
      isEjectingCartridge: () => this.slots.isEjecting(),
      onRequestEject: (after) => this.slots.eject(after),
    });

    this.consoleEl.addEventListener(
      'click',
      (e) => {
        if (this.element.dataset.bootStage === 'standby') {
          this.router.wakeFromStandby();
        } else if (this.perspective === 'window') {
          e.stopPropagation();
          this.setPerspective('focus');
        }
      },
      { signal: this.ac.signal },
    );

    this.applyGripMode(this.host.hal.getGripMode());
    this.hud.updateControlLabels(null);

    this.busUnsubs.push(
      this.host.events.on('plugin:registered', () => {
        invalidateCardArtCache();
        this.router.refreshCards();
        this.deskWorld.rebuildTray();
        this.diorama.rebuildVisitors();
      }),
      this.host.events.on('sprite:registered', () => {
        invalidateCardArtCache();
        this.router.refreshCardArt();
        this.deskWorld.rebuildTray();
        this.diorama.rebuildVisitors();
      }),
    );
  }

  public startBootSequence(): void {
    this.router.startBootSequence();
    this.spatial.scheduleCenterAlignment();
  }
  public getBootStage(): BootPickupStage {
    return this.router.getBootStage();
  }
  public getShellPhase(): ShellPhase {
    return this.router.getShellPhase();
  }
  public getEditorTriggerElement(): HTMLElement {
    return this.router.getEditorTriggerElement();
  }
  public setInEditor(inEditor: boolean): void {
    this.router.setInEditor(inEditor);
  }
  public launchCartridge(id: CartridgeId, forceFresh = false): void {
    this.router.launchCartridge(id, forceFresh);
  }
  public returnToHomeLobby(): void {
    this.router.returnToHomeLobby();
  }
  public syncPauseState(): void {
    this.router.syncPauseState();
  }
  public isSimulationActive(): boolean {
    return this.router.isSimulationActive();
  }
  public cycleScreenFilter(): ScreenFilterMode {
    return this.router.cycleScreenFilter();
  }
  public getPhase(): ConsolePhase {
    return this.slots.getPhase();
  }
  public getInserted(): CartridgeId | null {
    return this.slots.getInserted();
  }

  public playRailSnap(): void {
    this.consoleEl.classList.remove('is-snapping');
    void this.consoleEl.offsetWidth;
    this.consoleEl.classList.add('is-snapping');
  }

  public applyGripMode(mode: ErgonomicGripMode): void {
    this.consoleEl.classList.toggle('is-grip-one-right', mode === 'one-right');
    this.consoleEl.classList.toggle('is-grip-one-left', mode === 'one-left');
    this.auxRailEl.setAttribute('aria-hidden', mode === 'both' ? 'true' : 'false');
  }

  public getPerspective(): DioramaPerspective {
    return this.perspective;
  }

  public setPerspective(next: DioramaPerspective): void {
    if (this.perspective === next) return;
    if (next === 'window' && this.router.getShellPhase() === 'IN_GAME') return;
    this.perspective = next;
    this.element.dataset.perspective = next;
    this.diorama.setPerspective(next);
    this.host.playStereoTick(next === 'window' ? 760 : 580, 0, 0.14);
    this.onPerspectiveChange?.(next);
  }

  public togglePerspective(): DioramaPerspective {
    if (this.router.getShellPhase() === 'IN_GAME') {
      this.showCaptureToast('🪟 遊玩中專注畫面 · 按 Home 回大廳即可看窗外');
      return this.perspective;
    }
    if (this.router.getShellPhase() === 'BOOT_BLINK' && this.router.getBootStage() === 'standby') {
      this.router.wakeFromStandby();
    }
    const next: DioramaPerspective = this.perspective === 'focus' ? 'window' : 'focus';
    this.setPerspective(next);
    return this.perspective;
  }

  public cycleTimeMode(): { mode: DioramaTimeMode; label: string } {
    const mode = this.diorama.cycleTimeMode();
    this.host.playStereoTick(840, 0.15, 0.14);
    return { mode, label: this.diorama.getTimeMoodLabel() };
  }

  public getTimeMoodLabel(): string {
    return this.diorama.getTimeMoodLabel();
  }

  public tick(dt: number): void {
    this.gamepad.pollGamepad();
    this.slots.tick(dt);
    this.diorama.tick(dt);
    this.router.pollLobbyInput(() => this.gamepad.getInput(true));
  }

  public setTouchAutofire(enabled: boolean): void {
    this.gamepad.setTouchAutofire(enabled);
  }
  public setDpadDeadzoneMode(mode: DpadDeadzoneMode): void {
    this.gamepad.setDpadDeadzoneMode(mode);
  }
  public setStickCurveMode(mode: StickCurveMode): void {
    this.gamepad.setStickCurveMode(mode);
  }
  public setStickDynamicOrigin(enabled: boolean): void {
    this.gamepad.setStickDynamicOrigin(enabled);
  }
  public isGamepadConnected(): boolean {
    return this.hwGamepadConnected;
  }
  public getGamepadLabel(): string | null {
    return this.hwGamepadLabel;
  }

  public setCanvasPointer(
    nx: number,
    ny: number,
    active: boolean,
    primary: boolean,
    secondary: boolean,
  ): void {
    this.gamepad.setCanvasPointer(nx, ny, active, primary, secondary);
  }

  public attachCanvas(nextCanvas: HTMLCanvasElement): void {
    this.canvasAc?.abort();
    this.canvasAc = new AbortController();
    const { signal } = this.canvasAc;
    this.canvas = nextCanvas;

    const emitPointer = (
      e: PointerEvent,
      active: boolean,
      forcePrimary?: boolean,
      forceSecondary?: boolean,
    ) => {
      const rect = nextCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const primary = active && (forcePrimary ?? (e.buttons & 1) !== 0);
      const secondary = active && (forceSecondary ?? (e.buttons & 2) !== 0);
      this.onCanvasPointer?.(nx, ny, active, primary, secondary);
    };

    nextCanvas.addEventListener(
      'pointermove',
      (e) => {
        emitPointer(e, true);
      },
      { passive: true, signal },
    );

    nextCanvas.addEventListener(
      'pointerdown',
      (e) => {
        if (this.router.getShellPhase() === 'IN_GAME') {
          this.host.unlockAudio();
        }
        const primary = (e.buttons & 1) !== 0 || e.button === 0;
        const secondary = (e.buttons & 2) !== 0 || e.button === 2;
        emitPointer(e, true, primary, secondary);
      },
      { signal },
    );

    nextCanvas.addEventListener(
      'pointerup',
      (e) => {
        emitPointer(e, true);
      },
      { signal },
    );

    const clearCanvasPointer = (e: PointerEvent) => {
      const rect = nextCanvas.getBoundingClientRect();
      const nx = rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0;
      const ny = rect.height > 0 ? Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) : 0;
      this.onCanvasPointer?.(nx, ny, false, false, false);
    };

    nextCanvas.addEventListener('pointerleave', clearCanvasPointer, { signal });
    nextCanvas.addEventListener('pointercancel', clearCanvasPointer, { signal });
    nextCanvas.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
      },
      { signal },
    );
  }

  public destroy(): void {
    this.hud.destroy();
    this.spatial.destroy();
    for (const off of this.busUnsubs) off();
    this.busUnsubs.length = 0;
    this.diorama.destroy();
    this.deskWorld.destroy();
    this.router.destroy();
    this.slots.destroy();
    this.gamepad.destroy();
    this.canvasAc?.abort();
    this.canvasAc = null;
    this.ac.abort();
    for (const id of this.activeTimers) window.clearTimeout(id);
    this.activeTimers.clear();
  }

  private scheduleTimer(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      this.activeTimers.delete(id);
      fn();
    }, ms);
    this.activeTimers.add(id);
    return id;
  }

  public clearActiveSram(): boolean {
    const id = this.getInserted();
    if (!id) return false;
    this.host.restartFresh();
    this.router.refreshCards();
    this.showCaptureToast('🗑 已清除電池存檔，從第一關重新開始！');
    return true;
  }

  public toggleDebugHitboxes(): boolean {
    this.debugHitboxesOn = this.host.toggleDebugHitboxes();
    const showDebug = this.debugHitboxesOn || this.host.isBenchmarkOn();
    this.bodyEl.querySelectorAll('.is-debug-metric').forEach((elNode) => {
      elNode.classList.toggle('panel-hidden', !showDebug);
    });
    return this.debugHitboxesOn;
  }
  public isDebugHitboxesOn(): boolean {
    return this.debugHitboxesOn;
  }
  public isBenchmarkOn(): boolean {
    return this.host.isBenchmarkOn();
  }
  public getInput(): InputState {
    return this.gamepad.getInput(true);
  }

  public requestCapture(): void {
    this.host.playUiSound('snap');
    this.captureRequested = true;
    const flash = el('div', 'capture-flash');
    this.screenFrame.appendChild(flash);
    this.scheduleTimer(() => flash.remove(), 420);
  }

  public showCaptureToast(msg: string): void {
    const toast = el('div', 'capture-toast', msg);
    this.screenFrame.appendChild(toast);
    this.scheduleTimer(() => toast.remove(), 1850);
  }

  public consumeCaptureRequest(): boolean {
    const r = this.captureRequested;
    this.captureRequested = false;
    return r;
  }

  public refreshCardArt(): void {
    this.router.refreshCards();
    this.router.refreshCardArt();
    this.deskWorld.rebuildTray();
    this.diorama.rebuildVisitors();
  }

  public wakeFromStandby(): void {
    this.router.wakeFromStandby();
  }

  public insertCartridge(id: CartridgeId, instant = false, skipSplash = false): void {
    this.router.launchCartridge(id, false);
    if (instant || skipSplash) {
      this.slots.insertCartridge(id, true, true);
    }
  }

  public eject(after?: () => void, instant = false): void {
    this.slots.eject(after ?? (() => this.router.returnToHomeLobby()), instant);
  }

  public updateHud(snap: RenderSceneSnapshot, stats: GpuFrameStats, fps: number): void {
    this.hud.updateHud(snap, stats, fps, this.slots.getPhase() === 'running', this.getInserted());
  }

  public updateStats(stats: GpuFrameStats, fps: number): void {
    this.hud.updateStats(stats, fps);
  }

  private handlePlusAction(): void {
    if (this.router.getShellPhase() !== 'IN_GAME') return;
    this.host.unlockAudio();
    this.host.dispatchCommand('toggle_pause');
    this.host.dispatchCommand('launch_sortie');
  }

  public toggleBenchmark(): boolean {
    this.host.playUiSound('star');
    const on = this.host.toggleBenchmark();
    const showDebug = this.debugHitboxesOn || on;
    this.bodyEl.querySelectorAll('.is-debug-metric').forEach((elNode) => {
      elNode.classList.toggle('panel-hidden', !showDebug);
    });
    this.host.reactMomo();
    this.showCaptureToast(on ? '✨ 1,150+ GPU 精靈派對開啟！' : '✨ 已關閉 GPU 精靈派對');
    return on;
  }

  private triggerJoyconRecoil(side: 'left' | 'right'): void {
    const jc = side === 'left' ? this.leftJoyconEl : this.rightJoyconEl;
    if (!jc) return;
    pulseTransientClass(jc, 'is-recoiling', 115, this.recoilTimers, this.activeTimers);
  }

  private triggerChassisJolt(heavy = false): void {
    if (!this.bodyEl) return;
    pulseTransientClass(this.bodyEl, heavy ? ['is-jolting', 'is-jolting-heavy'] : 'is-jolting', 130, this.recoilTimers, this.activeTimers);
    if (!heavy) this.bodyEl.classList.remove('is-jolting-heavy');
  }
}
