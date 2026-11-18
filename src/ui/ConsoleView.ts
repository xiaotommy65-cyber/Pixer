import { CARTRIDGES } from '../core/runtime/CartridgeRegistry.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeId, InputState, RenderSceneSnapshot, ScreenFilterMode } from '../core/types/WorldTypes.ts';
import type { DpadDeadzoneMode, StickCurveMode } from '../core/input/InputPipeline.ts';
import type { GpuFrameStats } from '../core/gpu/GpuTypes.ts';
import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { HapticSide } from '../core/hal/HapticEngine.ts';
import type { ErgonomicGripMode } from '../core/hal/SystemHal.ts';
import { CartridgeSlotController, type ConsolePhase } from './CartridgeSlotController.ts';
import { ChronicleOverlayView } from './ChronicleOverlayView.ts';
import { buildConsoleBodyDom } from './ConsoleBodyBuilder.ts';
import { ConsoleHudPresenter } from './ConsoleHudPresenter.ts';
import { buildJoyconsAndAuxRail } from './ConsoleJoyconBuilder.ts';
import { ConsoleShellRouter, type ShellPhase } from './ConsoleShellRouter.ts';
import { DeskWorldView } from './DeskWorldView.ts';
import { RpgOverlayView } from './RpgOverlayView.ts';
import { ShmupOverlayView } from './ShmupOverlayView.ts';
import { VirtualGamepadInput } from './VirtualGamepadInput.ts';
import { el, pulseTransientClass } from './dom.ts';

export type { ConsolePhase, ShellPhase };

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
}

/**
 * Switch-style handheld OS shell: Joy-Con (L) | screen body | Joy-Con (R),
 * composing DeskWorldView, VirtualGamepadInput, CartridgeSlotController, ConsoleHudPresenter, and ConsoleShellRouter.
 */
export class ConsoleView {
  public readonly element: HTMLElement;
  public canvas: HTMLCanvasElement;

  private readonly host: EngineHost;
  private captureRequested = false;

  private readonly consoleEl: HTMLElement;
  private readonly spatialTrackEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly leftJoyconEl: HTMLElement;
  private readonly rightJoyconEl: HTMLElement;
  private readonly auxRailEl: HTMLElement;
  private readonly screenFrame: HTMLElement;
  private readonly deskWorld: DeskWorldView;
  private readonly ac = new AbortController();
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
  private lastParallaxMs = 0;

  constructor(host: EngineHost, atlas: TextureAtlas, onExitLandscape: (() => void) | undefined, opts: ConsoleViewOptions) {
    this.host = host;
    this.element = el('section', 'switch-stage');
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
    const rpgOverlay = new RpgOverlayView({ onCommand: onOverlayCommand });
    const shmupOverlay = new ShmupOverlayView({ onCommand: onOverlayCommand });
    const chronicleOverlay = new ChronicleOverlayView(atlas, { onCommand: onOverlayCommand });

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
      rpgOverlay,
      shmupOverlay,
      chronicleOverlay,
      onReturnHome: () => this.router.returnToHomeLobby(),
      onClearSave: () => this.clearActiveSram(),
      onExitLandscape: () => onExitLandscape?.(),
      onRetryStage: () => this.host.retryStage(),
      onRestartFresh: () => this.host.restartFresh(),
    });
    this.bodyEl = body.bodyEl;
    this.screenFrame = body.screenFrame;
    this.canvas = body.canvas;

    this.consoleEl.append(rig.portraitRailBridge, this.auxRailEl, this.leftJoyconEl, this.bodyEl, this.rightJoyconEl);

    this.deskWorld = new DeskWorldView(host, atlas, {
      onOpenEditor: (originEl) => opts.onOpenEditor(originEl),
      onSelectCartridge: (id) => this.router.launchCartridge(id, false),
      onRequestCapture: () => this.requestCapture(),
      onScrollToPage: (pageIdx) => this.scrollToDeskPage(pageIdx, true),
    });

    this.spatialTrackEl = el('div', 'desk-spatial-track');
    const consoleSlot = el('div', 'desk-console-slot');
    consoleSlot.append(this.consoleEl, this.deskWorld.handsOverlayEl);
    this.spatialTrackEl.append(this.deskWorld.notebookPropEl, consoleSlot, this.deskWorld.trayPropEl);
    this.element.append(this.deskWorld.deskBgEl, this.spatialTrackEl, this.deskWorld.portraitPagerEl);

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
        rpgOverlay,
        shmupOverlay,
        chronicleOverlay,
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
        ledStrips: rig.ledStrips,
      },
      {
        onBeforeBoot: (id, resumedSram, meta) => {
          this.hud.showBeforeBoot(id, resumedSram, meta);
          opts.onThemeGlowChange?.(meta.accentHex);
        },
        onShowEmpty: () => {
          this.hud.showEmpty();
          this.router.returnToHomeLobby();
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
        this.element.dataset.bootStage = stage;
      },
      onShellPhaseChange: (phase) => {
        this.element.dataset.shellPhase = phase;
        this.bodyEl.classList.toggle('is-lobby-clean', phase !== 'IN_GAME');
        if (phase === 'IN_GAME' || phase === 'BOOT_BLINK') {
          this.scrollToDeskPage(1, false);
          this.setParallax(0, 0);
        }
      },
    });

    this.consoleEl.addEventListener(
      'click',
      () => {
        if (this.element.dataset.bootStage === 'standby') {
          this.router.wakeFromStandby();
        }
      },
      { signal: this.ac.signal },
    );

    this.spatialTrackEl.addEventListener(
      'scroll',
      () => {
        const w = this.spatialTrackEl.clientWidth;
        if (w <= 0) return;
        const idx = Math.max(0, Math.min(2, Math.round(this.spatialTrackEl.scrollLeft / w))) as 0 | 1 | 2;
        this.deskWorld.setActivePage(idx);
      },
      { passive: true, signal: this.ac.signal },
    );

    this.element.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        const phase = this.router.getShellPhase();
        if (phase === 'IN_EDITOR' || phase === 'IN_GAME') return;
        const now = performance.now();
        if (now - this.lastParallaxMs < 24) return;
        this.lastParallaxMs = now;
        const rect = this.element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const nx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width - 0.5) * 2));
        const ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height - 0.5) * 2));
        this.setParallax(nx, ny);
      },
      { passive: true, signal: this.ac.signal },
    );
    this.element.addEventListener('pointerleave', () => this.setParallax(0, 0), { signal: this.ac.signal });

    window.addEventListener(
      'deviceorientation',
      (ev) => {
        const phase = this.router.getShellPhase();
        if (phase === 'IN_EDITOR' || phase === 'IN_GAME') return;
        if (ev.gamma === null || ev.beta === null) return;
        const nx = Math.max(-1, Math.min(1, ev.gamma / 30));
        const ny = Math.max(-1, Math.min(1, (ev.beta - 35) / 30));
        this.setParallax(nx, ny);
      },
      { passive: true, signal: this.ac.signal },
    );

    this.applyGripMode(this.host.hal.getGripMode());
    this.hud.updateControlLabels(null);

    this.busUnsubs.push(
      this.host.events.on('plugin:registered', () => {
        this.router.refreshCards();
        this.deskWorld.rebuildTray();
      }),
      this.host.events.on('sprite:registered', () => {
        this.router.refreshCardArt();
        this.deskWorld.rebuildTray();
      }),
    );
  }

  private setParallax(nx: number, ny: number): void {
    this.element.style.setProperty('--px', nx.toFixed(3));
    this.element.style.setProperty('--py', ny.toFixed(3));
  }

  private scrollToDeskPage(pageIdx: 0 | 1 | 2, smooth: boolean): void {
    const w = this.spatialTrackEl.clientWidth;
    if (w > 0) {
      this.spatialTrackEl.scrollTo({
        left: w * pageIdx,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
    this.deskWorld.setActivePage(pageIdx);
  }

  public startBootSequence(): void {
    this.router.startBootSequence();
    requestAnimationFrame(() => this.scrollToDeskPage(1, false));
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

  public tick(dt: number): void {
    this.gamepad.pollGamepad();
    this.slots.tick(dt);
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

  public destroy(): void {
    this.hud.resetOverlays();
    for (const off of this.busUnsubs) off();
    this.busUnsubs.length = 0;
    this.deskWorld.destroy();
    this.router.destroy();
    this.slots.destroy();
    this.gamepad.destroy();
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
    this.router.refreshCardArt();
    this.deskWorld.rebuildTray();
  }

  public insertCartridge(id: CartridgeId, instant = false, skipSplash = false): void {
    this.router.launchCartridge(id, false);
    if (instant || skipSplash) {
      this.slots.insertCartridge(id, true, true);
    }
  }

  public eject(after?: () => void, instant = false): void {
    this.slots.eject(after, instant);
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
