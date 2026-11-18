import './styles/atelier.css';
import './styles/switch.css';
import './styles/lobby.css';

import {
  applyPerformanceProfileAttr,
  applyShellThemeAttr,
  createHandheldOrientationController,
  createOsUtilityBar,
  exportCaptureScreenshot,
  importCartridgeFileWithPrompt,
  installGlobalErrorHandlers,
  installPolaroidDropHandler,
  recoverFromFrameError,
  renderStartupCrashFallback,
} from './AppShellHelpers.ts';
import { TextureAtlas } from './assets/TextureAtlas.ts';
import { createAgentBridge, type PixelAtelierAgentApi } from './core/ai/AgentBridge.ts';
import { ToySynth } from './core/audio/ToySynth.ts';
import { GpuEngine } from './core/gpu/GpuEngine.ts';
import type { GpuBackendKind, RenderPerformanceProfile } from './core/gpu/GpuTypes.ts';
import type { ErgonomicGripMode } from './core/hal/SystemHal.ts';
import type { DpadDeadzoneMode, StickCurveMode } from './core/input/InputPipeline.ts';
import { appLogger } from './core/runtime/AppLogger.ts';
import { CartridgeRunner } from './core/runtime/CartridgeRunner.ts';
import { DisplayThermalGovernor } from './core/runtime/DisplayThermalGovernor.ts';
import { EngineHost } from './core/runtime/EngineHost.ts';
import { SaveService } from './core/runtime/SaveService.ts';
import { SceneGpuBridge } from './core/runtime/SceneGpuBridge.ts';
import { createEmptyInputState, type CartridgeId } from './core/types/WorldTypes.ts';
import { registerBuiltinCartridges } from './game/BuiltinCartridges.ts';
import { initCapacitorNativeBridge } from './ui/CapacitorNativeBridge.ts';
import { ConsoleView } from './ui/ConsoleView.ts';
import { installGlobalTactileFeedback, registerDomHapticSink } from './ui/dom.ts';
import { IrisWipeTransition } from './ui/IrisWipeTransition.ts';
import { SpriteAtelierView } from './ui/SpriteAtelierView.ts';
import { StudioWorkbenchView } from './ui/StudioWorkbenchView.ts';
import {
  SHELL_THEMES,
  SystemSettingsDrawerView,
  type ShellTheme,
} from './ui/SystemSettingsDrawerView.ts';
import { WorkshopView } from './ui/WorkshopView.ts';

declare global {
  interface Window {
    __PIXEL_ATELIER_AGENT__?: PixelAtelierAgentApi;
  }
}

export interface AppHandle {
  destroy: () => void;
}

export function createApp(): AppHandle | null {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return null;

  registerBuiltinCartridges();

  const ac = new AbortController();
  const { signal } = ac;
  installGlobalErrorHandlers(signal);
  void appLogger.hydrateFromPersistence();

  const synth = new ToySynth();
  const runner = new CartridgeRunner('cloudberry-hop');
  const save = new SaveService();
  const bridge = new SceneGpuBridge();

  const shell = document.createElement('div');
  shell.className = 'atelier-shell is-os-locked';

  const ambientGlow = document.createElement('div');
  ambientGlow.className = 'lobby-ambient-glow';
  ambientGlow.setAttribute('aria-hidden', 'true');

  const savedShell = save.getShellTheme('mint') as ShellTheme;
  let activeShell: ShellTheme = SHELL_THEMES.some((t) => t.id === savedShell) ? savedShell : 'mint';
  applyShellThemeAttr(activeShell);

  let perfProfile: RenderPerformanceProfile = save.getPerformanceProfile('balanced');
  applyPerformanceProfileAttr(perfProfile);
  const isCompactViewport = () => window.matchMedia('(max-width: 900px)').matches;
  const governor = new DisplayThermalGovernor(perfProfile, isCompactViewport());
  governor.setViewportMetrics(window.innerWidth, window.devicePixelRatio || 1, isCompactViewport());

  let autofireOn = save.getTouchAutofire(false);
  let deadzoneMode: DpadDeadzoneMode = save.getDpadDeadzone('standard');
  let stickCurveMode: StickCurveMode = save.getStickCurveMode('standard');
  let stickDynamicOrigin = save.getStickDynamicOrigin(true);
  let rafId = 0;

  const { utilityBar, landscapeBtn, settingsBtn } = createOsUtilityBar();

  const host = new EngineHost(runner, synth, save);
  const disposeHapticSink = registerDomHapticSink((profile, side, skipAcoustic) =>
    host.triggerHaptic(profile, side, skipAcoustic),
  );
  const disposeTactileFeedback = installGlobalTactileFeedback(shell, (profile, phase) =>
    host.playTactile(profile, phase),
  );

  window.__PIXEL_ATELIER_AGENT__ = createAgentBridge(runner, host.ai, (rawJson, opts) =>
    host.loadCartridge(rawJson, opts),
  );

  const atlas = new TextureAtlas();
  host.bindAtlas(atlas);
  host.hydrateSavedCustomCartridges();

  const irisWipe = new IrisWipeTransition(host, atlas);
  let drawerView: SystemSettingsDrawerView | null = null;
  let studioWorkbench: StudioWorkbenchView | null = null;
  let consoleView: ConsoleView;

  const orientationCtrl = createHandheldOrientationController({
    shell,
    landscapeBtn,
    signal,
    isInEditor: () => consoleView.getShellPhase() === 'IN_EDITOR',
    exitEditorToPlay: () => exitEditorToHandheld(undefined),
    getDrawerView: () => drawerView,
    onNativeLockRequest: (next) => host.hal.requestFullscreenLock(next),
  });

  const syncGamepadHeaderBadge = (connected: boolean, label: string | null) => {
    settingsBtn.classList.toggle('has-gamepad', connected);
    drawerView?.syncGamepad(connected, label);
  };

  const ensureForegroundVisible = () => {
    if (!studioWorkbench) return;
    const editorHidden = studioWorkbench.element.classList.contains('panel-hidden');
    const consoleHidden = consoleView.element.classList.contains('panel-hidden');
    if (editorHidden && consoleHidden) {
      consoleView.setInEditor(false);
      utilityBar.classList.remove('panel-hidden');
    }
  };

  const enterEditorWithIris = (originEl: HTMLElement) => {
    if (!studioWorkbench) return;
    drawerView?.close();
    irisWipe.run({
      originEl,
      direction: 'in',
      onSwapCovered: () => {
        consoleView.setInEditor(true);
        studioWorkbench?.showCovered();
        utilityBar.classList.add('panel-hidden');
      },
      onRevealStart: () => {
        studioWorkbench?.revealToolbars();
      },
      onDone: ensureForegroundVisible,
    });
  };

  const exitEditorToHandheld = (originEl?: HTMLElement, targetCartridgeId?: CartridgeId) => {
    if (!studioWorkbench || !studioWorkbench.isOpen()) return;
    const triggerEl = originEl ?? consoleView.getEditorTriggerElement();
    irisWipe.run({
      originEl: triggerEl,
      direction: 'out',
      onSwapCovered: () => {
        studioWorkbench?.hide();
        utilityBar.classList.remove('panel-hidden');
        consoleView.setInEditor(false);
        handleViewportMetrics();
        if (targetCartridgeId) {
          consoleView.launchCartridge(targetCartridgeId, true);
        }
      },
      onRevealStart: () => {
        consoleView.refreshCardArt();
      },
      onDone: ensureForegroundVisible,
    });
  };

  let gpuEngine: GpuEngine | null = null;

  consoleView = new ConsoleView(host, atlas, () => orientationCtrl.setLandscape(false), {
    onGamepadChange: (connected, label) => syncGamepadHeaderBadge(connected, label),
    onOpenEditor: (originEl) => enterEditorWithIris(originEl),
    onOpenAdvancedSettings: () => drawerView?.open(),
    onToggleMute: () => {
      host.unlockAudio();
      const muted = synth.toggleMute();
      if (!muted) synth.playTactile('ui', 'down');
      return muted;
    },
    isMuted: () => synth.isMuted(),
    isExternalModalOpen: () => Boolean(drawerView?.isOpen()) || irisWipe.isRunning(),
    onEscapeExternal: () => {
      if (drawerView?.isOpen()) {
        drawerView.close();
        return true;
      }
      return false;
    },
    onThemeGlowChange: (hex) => {
      ambientGlow.style.setProperty('--lobby-theme-glow', hex);
    },
    onFilterChange: (mode) => {
      gpuEngine?.setFilterModeCode(mode === 'crt' ? 2 : mode === 'lcd' ? 1 : 0);
    },
  });

  consoleView.setTouchAutofire(autofireOn);
  consoleView.setDpadDeadzoneMode(deadzoneMode);
  consoleView.setStickCurveMode(stickCurveMode);
  consoleView.setStickDynamicOrigin(stickDynamicOrigin);

  const updateGpuBadge = (kind: GpuBackendKind, activeCanvas?: HTMLCanvasElement) => {
    if (activeCanvas) consoleView.canvas = activeCanvas;
    drawerView?.updateGpuBadge(kind);
  };

  gpuEngine = new GpuEngine(consoleView.canvas, updateGpuBadge, atlas);
  const initFilter = host.getScreenFilter();
  gpuEngine.setFilterModeCode(initFilter === 'crt' ? 2 : initFilter === 'lcd' ? 1 : 0);
  const syncGovernorResolution = () => {
    const { width, height } = governor.getTargetPixelSize();
    gpuEngine.resize(width, height);
  };
  syncGovernorResolution();

  const spriteAtelierView = new SpriteAtelierView(gpuEngine, synth, save, () => host.reactMomo());
  let workshopView: WorkshopView;
  workshopView = new WorkshopView(
    host,
    atlas,
    (targetId: CartridgeId = 'sandbox-toybox') => {
      exitEditorToHandheld(undefined, targetId);
    },
    {
      getStudioSprites: () => ({
        sprites: spriteAtelierView.exportCartridgeSprites(),
        paletteRow: spriteAtelierView.getSelectedPaletteRow(),
      }),
      onImportCartridgeFile: (file) =>
        importCartridgeFileWithPrompt({
          file,
          shell,
          host,
          consoleView,
          mountAfterImport: false,
          onImported: (id, cart) => {
            workshopView.loadIntoEditor(cart, id);
          },
        }),
    },
  );
  studioWorkbench = new StudioWorkbenchView(
    spriteAtelierView,
    workshopView,
    (originEl) => exitEditorToHandheld(originEl),
    (freqHz) => host.playStereoTick(freqHz, 0, 0.2),
  );

  installPolaroidDropHandler({
    shell,
    host,
    consoleView,
    signal,
    onImported: (id, cart) => {
      workshopView.loadIntoEditor(cart, id);
      workshopView.refreshSavedCartridges();
      if (studioWorkbench?.isOpen()) {
        exitEditorToHandheld(undefined, id);
      }
    },
  });

  drawerView = new SystemSettingsDrawerView({
    getState: () => {
      const insertedId = consoleView.getInserted();
      return {
        gripMode: host.hal.getGripMode(),
        shellTheme: activeShell,
        hapticLevel: host.hal.getHapticLevel(),
        muted: synth.isMuted(),
        autofire: autofireOn,
        deadzoneMode,
        stickCurveMode,
        stickDynamicOrigin,
        handheldLandscape: orientationCtrl.isLandscape(),
        perfProfile,
        hasCartridge: Boolean(insertedId),
        hasSram: Boolean(insertedId && host.hasSram(insertedId)),
        benchmarkOn: consoleView.isBenchmarkOn(),
        debugHitboxesOn: consoleView.isDebugHitboxesOn(),
        gamepadConnected: consoleView.isGamepadConnected(),
        gamepadLabel: consoleView.getGamepadLabel(),
      };
    },
    onSelectGrip: (mode: ErgonomicGripMode) => {
      host.unlockAudio();
      host.hal.setGripMode(mode);
      save.saveErgonomicGrip(mode);
      if (consoleView.getShellPhase() === 'IN_EDITOR') exitEditorToHandheld();
      consoleView.applyGripMode(mode);
      host.triggerHaptic('click', 'both', true);
    },
    onSelectShell: (theme: ShellTheme) => {
      activeShell = theme;
      applyShellThemeAttr(theme);
      save.saveShellTheme(theme);
      consoleView.playRailSnap();
    },
    onToggleLandscape: () => orientationCtrl.setLandscape(!orientationCtrl.isLandscape()),
    onCycleHaptic: () => {
      host.unlockAudio();
      const next = host.hal.haptic.cycleLevel();
      host.hal.setHapticLevel(next);
      save.saveHapticLevel(next);
      if (next !== 'off') host.triggerHaptic('click', 'both', true);
    },
    onToggleMute: () => {
      host.unlockAudio();
      const muted = synth.toggleMute();
      if (!muted) synth.playTactile('ui', 'down');
    },
    onToggleAutofire: () => {
      host.unlockAudio();
      autofireOn = !autofireOn;
      save.saveTouchAutofire(autofireOn);
      consoleView.setTouchAutofire(autofireOn);
      host.triggerHaptic('click', 'right', true);
    },
    onSelectDeadzone: (mode: DpadDeadzoneMode) => {
      host.unlockAudio();
      deadzoneMode = mode;
      save.saveDpadDeadzone(mode);
      consoleView.setDpadDeadzoneMode(mode);
      host.triggerHaptic('click', 'left', true);
    },
    onSelectStickCurve: (mode: StickCurveMode) => {
      host.unlockAudio();
      stickCurveMode = mode;
      save.saveStickCurveMode(mode);
      consoleView.setStickCurveMode(mode);
      host.triggerHaptic('click', 'right', true);
    },
    onToggleStickOrigin: (enabled: boolean) => {
      host.unlockAudio();
      stickDynamicOrigin = enabled;
      save.saveStickDynamicOrigin(enabled);
      consoleView.setStickDynamicOrigin(enabled);
      host.triggerHaptic('tap', 'left', true);
    },
    onSelectPerfProfile: (profile: RenderPerformanceProfile) => {
      host.unlockAudio();
      perfProfile = profile;
      save.savePerformanceProfile(profile);
      applyPerformanceProfileAttr(profile);
      governor.setProfile(profile);
      syncGovernorResolution();
      host.triggerHaptic('click', 'both', true);
    },
    onTestStereoHaptic: (side) => {
      host.unlockAudio();
      host.playTactile('bumper', 'down', side);
      host.triggerHaptic('impact', side, true);
    },
    onCapture: () => {
      if (consoleView.getShellPhase() === 'IN_EDITOR') exitEditorToHandheld();
      consoleView.requestCapture();
    },
    onRetryStage: () => host.retryStage(),
    onClearSave: () => {
      consoleView.clearActiveSram();
    },
    onEject: () => consoleView.returnToHomeLobby(),
    onToggleBenchmark: () => {
      consoleView.toggleBenchmark();
    },
    onToggleDebugHitboxes: () => {
      const on = consoleView.toggleDebugHitboxes();
      consoleView.showCaptureToast(on ? '🧪 除錯碰撞框：開啟' : '🧪 除錯碰撞框：關閉');
    },
    onPwaInstallClick: () => host.triggerHaptic('tap', 'both', true),
    onOpenHaptic: () => host.triggerHaptic('tap', 'both', true),
    onOpenChange: (open) => {
      settingsBtn.setAttribute('aria-expanded', String(open));
      settingsBtn.classList.toggle('is-active', open);
      consoleView.syncPauseState();
    },
  });

  syncGamepadHeaderBadge(consoleView.isGamepadConnected(), consoleView.getGamepadLabel());
  settingsBtn.addEventListener('click', () => drawerView?.toggle(), { signal });

  let lastTs = performance.now();
  const enterBackground = () => {
    governor.setBackground(true);
    nativeBridge.setKeepAwake(false);
    host.suspendForBackground();
    consoleView.syncPauseState();
  };
  const enterForeground = () => {
    governor.setBackground(false);
    lastTs = performance.now();
    host.resumeFromBackground();
    consoleView.syncPauseState();
  };

  const nativeBridge = initCapacitorNativeBridge({
    hal: host.hal,
    onEnterBackground: enterBackground,
    onEnterForeground: enterForeground,
    onHardwareBack: () => {
      if (drawerView?.isOpen()) {
        drawerView.close();
        return true;
      }
      if (consoleView.getShellPhase() === 'IN_EDITOR') {
        exitEditorToHandheld();
        return true;
      }
      if (consoleView.getInserted()) {
        consoleView.returnToHomeLobby();
        return true;
      }
      if (orientationCtrl.isLandscape()) {
        orientationCtrl.setLandscape(false);
        return true;
      }
      return false;
    },
  });

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') {
        enterBackground();
      } else {
        enterForeground();
      }
    },
    { signal },
  );

  const isImeOrEditorActive = (): boolean => {
    if (consoleView.getShellPhase() === 'IN_EDITOR') return true;
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  const handleViewportMetrics = () => {
    if (isImeOrEditorActive()) return;
    governor.setViewportMetrics(window.innerWidth, window.devicePixelRatio || 1, isCompactViewport());
    syncGovernorResolution();
  };
  window.addEventListener('resize', handleViewportMetrics, { signal });
  window.addEventListener('orientationchange', handleViewportMetrics, { signal });

  shell.append(
    ambientGlow,
    utilityBar,
    consoleView.element,
    studioWorkbench.element,
    drawerView.element,
    irisWipe.curtain,
  );
  root.appendChild(shell);
  consoleView.startBootSequence();
  nativeBridge.hideSplash();
  appLogger.success('lifecycle', 'app.boot', 'Pixel Atelier OS 掌機外殼啟動完成', {
    shellTheme: activeShell,
    perfProfile,
    nativePlatform: nativeBridge.platform,
  });

  let destroyed = false;
  void gpuEngine
    .init()
    .then((kind) => {
      if (destroyed) return;
      updateGpuBadge(kind);
      syncGovernorResolution();
      gpuEngine.syncAtlasToGpu();
    })
    .catch((err) => {
      appLogger.error('gpu', 'gpu.initPromise', 'GPU 初始化非同步異常，強制啟用 Canvas 2D 保底', err);
      if (!destroyed) {
        updateGpuBadge(gpuEngine.forceCanvas2DFallback());
        syncGovernorResolution();
      }
    });

  let fpsSmooth = 60;
  let consecutiveFrameErrors = 0;
  const idleEmptyInput = createEmptyInputState();

  const frame = (now: number) => {
    if (destroyed) return;
    const dt = Math.min(0.1, Math.max(0.001, (now - lastTs) / 1000));
    lastTs = now;

    if (!governor.isBackground()) {
      fpsSmooth = fpsSmooth * 0.9 + (1 / dt) * 0.1;

      try {
        ensureForegroundVisible();
        const shellPhase = consoleView.getShellPhase();
        if (shellPhase !== 'IN_EDITOR') {
          const activeSim = consoleView.isSimulationActive() && consoleView.getPhase() === 'running';
          nativeBridge.setKeepAwake(activeSim);

          const bootStage = shellPhase === 'BOOT_BLINK' ? consoleView.getBootStage() : 'awake';
          const skipIdleRender = shellPhase === 'BOOT_BLINK' && (bootStage === 'standby' || bootStage === 'picking');
          const idleTargetFps =
            shellPhase === 'HOME_LOBBY'
              ? perfProfile === 'quality'
                ? 30
                : 20
              : skipIdleRender
                ? 15
                : undefined;

          if (governor.shouldRenderThisFrame(dt, activeSim, idleTargetFps)) {
            const frameT0 = performance.now();
            consoleView.tick(dt);
            if (activeSim) {
              const input = consoleView.getInput();
              host.stepFrame(dt, input);
              const snap = host.getSnapshot();
              const stats = bridge.render(gpuEngine, snap, runner.sparkleBenchmark ? runner.benchmarkSprites : null);
              consoleView.updateHud(snap, stats, fpsSmooth);
            } else {
              host.stepFrame(dt, idleEmptyInput);
              if (shellPhase === 'IN_GAME' && host.activeCartridge) {
                const snap = host.getSnapshot();
                const stats = bridge.render(gpuEngine, snap, runner.sparkleBenchmark ? runner.benchmarkSprites : null);
                consoleView.updateHud(snap, stats, fpsSmooth);
              } else if (!skipIdleRender) {
                const stats = bridge.renderIdle(gpuEngine, now / 1000, false);
                consoleView.updateStats(stats, fpsSmooth);
              }
            }

            if (consoleView.consumeCaptureRequest()) {
              void exportCaptureScreenshot(consoleView, host);
            }

            if (governor.recordFrameCostMs(performance.now() - frameT0, activeSim)) {
              syncGovernorResolution();
            }
          }
        } else {
          nativeBridge.setKeepAwake(false);
          if (governor.shouldRenderThisFrame(dt, false)) {
            studioWorkbench?.tick(dt);
          }
        }
        consecutiveFrameErrors = 0;
      } catch (frameErr) {
        consecutiveFrameErrors = recoverFromFrameError({
          step: consecutiveFrameErrors + 1,
          frameErr,
          gpuEngine,
          host,
          consoleView,
          studioWorkbench,
          utilityBar,
          onGpuKindChange: (kind) => updateGpuBadge(kind),
        });
      }
    }

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(rafId);
      ac.abort();
      nativeBridge.destroy();
      disposeTactileFeedback();
      disposeHapticSink();
      irisWipe.destroy();
      studioWorkbench?.destroy();
      drawerView?.destroy();
      consoleView.destroy();
      spriteAtelierView.destroy();
      workshopView.destroy();
      gpuEngine.dispose();
      host.destroy();
      delete window.__PIXEL_ATELIER_AGENT__;
      document.body.classList.remove('is-handheld-lock');
      delete document.body.dataset.perf;
      shell.remove();
    },
  };
}

function createAppSafe(): AppHandle | null {
  try {
    return createApp();
  } catch (err) {
    renderStartupCrashFallback(err, () => createAppSafe());
    return null;
  }
}

createAppSafe();
