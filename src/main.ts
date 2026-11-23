import './styles/atelier.css';
import './styles/switch.css';
import './styles/lobby.css';
import './styles/studio7.css';

import {
  applyPerformanceProfileAttr,
  applyShellThemeAttr,
  createHandheldOrientationController,
  createOsUtilityBar,
  exportCaptureScreenshot,
  installGlobalErrorHandlers,
  installPolaroidDropHandler,
  recoverFromFrameError,
  renderStartupCrashFallback,
} from './AppShellHelpers.ts';
import { TextureAtlas } from './assets/TextureAtlas.ts';
import {
  createAgentBridge,
  type PixelAtelierAgentApi,
  type PixerPlatformMode,
} from './core/ai/AgentBridge.ts';
import { ExternalAudioBank } from './core/audio/ExternalAudioBank.ts';
import { EcsCartridgeRuntime } from './core/ecs/EcsCartridgeRuntime.ts';
import { syncProjectCustomSpritesToAtlas } from './core/ecs/EcsCustomSpriteCompiler.ts';
import type { EcsProjectV2 } from './core/ecs/EcsProjectSchema.ts';
import { EcsStudioSession, type EcsStudioCommand } from './core/ecs/EcsStudioSession.ts';
import { CASTLE_TILE_REGISTRY, type EcsMapLayerName } from './core/ecs/EcsTilemapTypes.ts';
import { StudioSession } from './core/editor/StudioSession.ts';
import { GpuEngine } from './core/gpu/GpuEngine.ts';
import type { GpuBackendKind, RenderPerformanceProfile } from './core/gpu/GpuTypes.ts';
import type { ErgonomicGripMode } from './core/hal/SystemHal.ts';
import type { DpadDeadzoneMode, StickCurveMode } from './core/input/InputPipeline.ts';
import { appLogger } from './core/runtime/AppLogger.ts';
import { registerCartridgePlugin } from './core/runtime/CartridgeRegistry.ts';
import { CartridgeRunner } from './core/runtime/CartridgeRunner.ts';
import { DisplayThermalGovernor } from './core/runtime/DisplayThermalGovernor.ts';
import { EngineHost } from './core/runtime/EngineHost.ts';
import { SaveService } from './core/runtime/SaveService.ts';
import { SceneGpuBridge } from './core/runtime/SceneGpuBridge.ts';
import { createEmptyInputState } from './core/types/WorldTypes.ts';
import { registerBuiltinCartridges } from './game/BuiltinCartridges.ts';
import { OBSIDIAN_CITADEL_PROJECT } from './game/obsidianCitadel/ObsidianCitadelProject.ts';
import { initCapacitorNativeBridge } from './ui/CapacitorNativeBridge.ts';
import { loadEngine4ArtPack } from './ui/BrowserAssetLoader.ts';
import { ConsoleView } from './ui/ConsoleView.ts';
import { installGlobalTactileFeedback, registerDomHapticSink } from './ui/dom.ts';
import { EcsWorkbenchView } from './ui/EcsWorkbenchView.ts';
import { IrisWipeTransition } from './ui/IrisWipeTransition.ts';
import { setElementIconLabel } from './ui/PixelIcons.ts';
import { PixerPlatformShell, type PixerTopNavTab } from './ui/PixerPlatformShell.ts';
import { SpriteAtelierView } from './ui/SpriteAtelierView.ts';
import {
  SHELL_THEMES,
  SystemSettingsDrawerView,
  type ShellTheme,
} from './ui/SystemSettingsDrawerView.ts';

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

  const synth = new ExternalAudioBank();
  const runner = new CartridgeRunner('obsidian-citadel');
  const save = new SaveService();
  const bridge = new SceneGpuBridge();

  const shell = document.createElement('div');
  shell.className = 'atelier-shell is-os-locked has-p7-topbar';

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

  const { utilityBar, viewBtn, timeBtn, landscapeBtn, settingsBtn } = createOsUtilityBar();

  const host = new EngineHost(runner, synth, save);
  const disposeHapticSink = registerDomHapticSink((profile, side, skipAcoustic) =>
    host.triggerHaptic(profile, side, skipAcoustic),
  );
  const disposeTactileFeedback = installGlobalTactileFeedback(shell, (profile, phase) =>
    host.playTactile(profile, phase),
  );

  const studioSession = new StudioSession('parkour_flagship');
  const ecsSession = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const atlas = new TextureAtlas();
  host.bindAtlas(atlas);
  host.hydrateSavedCustomCartridges();

  let platformMode: PixerPlatformMode = 'studio';
  let activeTopTab: PixerTopNavTab = 'studio';
  let captureCanvasRef: HTMLCanvasElement | null = null;
  let ecsWorkbench: EcsWorkbenchView | null = null;
  let platformShell: PixerPlatformShell | null = null;

  const irisWipe = new IrisWipeTransition(host, atlas);
  let drawerView: SystemSettingsDrawerView | null = null;
  let spriteModalOpen = false;
  let spriteModalEl: HTMLElement | null = null;
  let consoleView: ConsoleView;
  let ensureArcadeGpuInit = () => {};

  const closeSpriteModal = () => {
    if (!spriteModalOpen) return;
    spriteModalOpen = false;
    spriteModalEl?.classList.add('panel-hidden');
    ecsWorkbench?.syncAtlasToPreview();
  };

  let syncedArcadeSpriteIds = new Set<string>();
  const syncProjectSpritesToSharedAtlas = (proj: EcsProjectV2) => {
    syncedArcadeSpriteIds = syncProjectCustomSpritesToAtlas(atlas, proj, syncedArcadeSpriteIds);
    gpuEngine?.syncAtlasIfDirty();
    ecsWorkbench?.syncAtlasToPreview();
  };

  const openSpriteModal = () => {
    ensureArcadeGpuInit();
    spriteModalOpen = true;
    spriteModalEl?.classList.remove('panel-hidden');
  };

  const setPlatformMode = (nextMode: PixerPlatformMode, tabOverride?: PixerTopNavTab) => {
    platformMode = nextMode;
    activeTopTab = tabOverride ?? (nextMode === 'arcade' ? 'arcade' : 'studio');
    platformShell?.syncState(platformMode, activeTopTab);
    closeSpriteModal();
    if (nextMode === 'studio') {
      drawerView?.close();
      consoleView.setInEditor(true);
      utilityBar.classList.add('panel-hidden');
      ecsWorkbench?.setVisible(true);
      if (activeTopTab === 'atlas') ecsWorkbench?.setLeftTab('atlas');
      else ecsWorkbench?.setLeftTab(ecsSession.getProject().worldMap ? 'map' : 'hierarchy');
    } else {
      ensureArcadeGpuInit();
      ecsWorkbench?.setVisible(false);
      consoleView.setInEditor(false);
      utilityBar.classList.remove('panel-hidden');
      handleViewportMetrics();
      consoleView.refreshCardArt();
      consoleView.wakeFromStandby();
      consoleView.syncPauseState();
    }
  };

  window.__PIXEL_ATELIER_AGENT__ = createAgentBridge(runner, host.ai, {
    onLoadCartridge: (rawJson, opts) => host.loadCartridge(rawJson, opts),
    studioSession,
    ecsSession,
    onCapturePreviewPng: () => {
      try {
        const c = platformMode === 'studio' && ecsWorkbench ? ecsWorkbench.getPreviewCanvas() : captureCanvasRef;
        return c ? c.toDataURL('image/png') : null;
      } catch {
        return null;
      }
    },
    onGetPlatformMode: () => platformMode,
    onSetPlatformMode: (m) => setPlatformMode(m),
    onGetAtlasStats: () => atlas.getAtlasStats(),
    onSyncProjectSprites: (proj) => syncProjectSpritesToSharedAtlas(proj),
  });

  const orientationCtrl = createHandheldOrientationController({
    shell,
    landscapeBtn,
    signal,
    isInEditor: () => consoleView.getShellPhase() === 'IN_EDITOR',
    exitEditorToPlay: () => exitEditorToHandheld(),
    getDrawerView: () => drawerView,
    onNativeLockRequest: (next) => host.hal.requestFullscreenLock(next),
  });

  const syncGamepadHeaderBadge = (connected: boolean, label: string | null) => {
    settingsBtn.classList.toggle('has-gamepad', connected);
    drawerView?.syncGamepad(connected, label);
  };

  const ensureForegroundVisible = () => {
    if (platformMode === 'studio' && ecsWorkbench?.isVisible()) return;
    const consoleHidden = consoleView.element.classList.contains('panel-hidden');
    if (consoleHidden) {
      consoleView.setInEditor(false);
      utilityBar.classList.remove('panel-hidden');
    }
  };

  const enterWorkstationWithIris = (originEl: HTMLElement) => {
    drawerView?.close();
    irisWipe.run({
      originEl,
      direction: 'in',
      onSwapCovered: () => {
        setPlatformMode('studio', 'studio');
      },
      onDone: () => {
        ensureForegroundVisible();
        consoleView.syncPauseState();
      },
    });
  };

  const exitEditorToHandheld = () => {
    closeSpriteModal();
    setPlatformMode('arcade', 'arcade');
  };

  let destroyed = false;
  let gpuEngine: GpuEngine | null = null;

  const syncViewPill = (p: 'focus' | 'window') => {
    viewBtn.classList.toggle('is-active', p === 'window');
    setElementIconLabel(viewBtn, p === 'window' ? 'home' : 'screen', p === 'window' ? '回掌機' : '看窗外');
  };

  consoleView = new ConsoleView(host, atlas, () => orientationCtrl.setLandscape(false), {
    onGamepadChange: (connected, label) => syncGamepadHeaderBadge(connected, label),
    onOpenEditor: (originEl) => enterWorkstationWithIris(originEl),
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
      if (consoleView.getPerspective() === 'window') {
        consoleView.setPerspective('focus');
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
    onPerspectiveChange: (p) => syncViewPill(p),
  });

  setElementIconLabel(timeBtn, 'sparkle', consoleView.getTimeMoodLabel());
  viewBtn.addEventListener(
    'click',
    () => {
      host.unlockAudio();
      consoleView.togglePerspective();
    },
    { signal },
  );
  timeBtn.addEventListener(
    'click',
    () => {
      host.unlockAudio();
      const { label } = consoleView.cycleTimeMode();
      setElementIconLabel(timeBtn, 'sparkle', label);
    },
    { signal },
  );

  consoleView.setTouchAutofire(autofireOn);
  consoleView.setDpadDeadzoneMode(deadzoneMode);
  consoleView.setStickCurveMode(stickCurveMode);
  consoleView.setStickDynamicOrigin(stickDynamicOrigin);

  const updateGpuBadge = (kind: GpuBackendKind, activeCanvas?: HTMLCanvasElement) => {
    if (activeCanvas) {
      consoleView.attachCanvas(activeCanvas);
      captureCanvasRef = activeCanvas;
    } else {
      captureCanvasRef = consoleView.canvas;
    }
    drawerView?.updateGpuBadge(kind);
  };
  captureCanvasRef = consoleView.canvas;

  consoleView.onCanvasPointer = (nx, ny, active, primary, secondary) => {
    consoleView.setCanvasPointer(nx, ny, active, primary, secondary);
  };

  gpuEngine = new GpuEngine(consoleView.canvas, updateGpuBadge, atlas);
  const initFilter = host.getScreenFilter();
  gpuEngine.setFilterModeCode(initFilter === 'crt' ? 2 : initFilter === 'lcd' ? 1 : 0);
  const syncGovernorResolution = () => {
    const { width, height } = governor.getTargetPixelSize();
    gpuEngine.resize(width, height);
  };
  syncGovernorResolution();
  void loadEngine4ArtPack(atlas, () => {
    if (destroyed) return;
    gpuEngine?.syncAtlasToGpu();
    consoleView.refreshCardArt();
  });

  const spriteAtelierView = new SpriteAtelierView(
    gpuEngine,
    synth,
    save,
    () => {
      host.reactMomo();
      ecsWorkbench?.syncAtlasToPreview();
    },
    {
      onPublishMapTile: (req) => {
        const proj = ecsSession.getProject();
        const usedIds = new Set<number>(CASTLE_TILE_REGISTRY.map((t) => t.id));
        if (proj.worldMap?.tileDefs) {
          for (const td of proj.worldMap.tileDefs) usedIds.add(td.id);
        }
        let nextTileId = 100;
        while (usedIds.has(nextTileId)) nextTileId++;

        const cmds: EcsStudioCommand[] = [];
        if (!proj.worldMap || proj.worldMap.rooms.length === 0) {
          cmds.push({ type: 'ensure_world_map', cols: 24, rows: 16, roomName: '自訂像素大廳' });
        }
        cmds.push(
          { type: 'upsert_custom_sprite', sprite: req.sprite },
          {
            type: 'upsert_tile_def',
            tileDef: {
              id: nextTileId,
              name: req.name,
              layer: req.layer,
              sprite: req.sprite.id,
              solid: req.solid,
              ...(req.hazard ? { hazard: true } : {}),
              ...(req.extrudeH ? { extrudeH: req.extrudeH } : {}),
              ...(req.renderH ? { renderH: req.renderH } : {}),
              ...(req.ambientLight ? { ambientLight: req.ambientLight } : {}),
            },
          },
        );
        const res = ecsSession.dispatchBatch(cmds, `像素畫室發佈瓦片「${req.name}」`);
        if (!res.ok) {
          return { ok: false, message: `發佈失敗：${res.errors.join('; ') || res.summary}` };
        }
        closeSpriteModal();
        ecsWorkbench?.focusPublishedTile(req.layer, nextTileId);
        return { ok: true, message: `已發佈瓦片「${req.name}」(#${nextTileId}) 至地圖盤！` };
      },
      onPublishPrefabStamp: (req) => {
        const proj = ecsSession.getProject();
        let pid = req.sprite.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        let seq = 2;
        while (proj.prefabs[pid]) {
          pid = `${req.sprite.id}_${seq++}`;
        }
        const res = ecsSession.dispatchBatch(
          [
            { type: 'upsert_custom_sprite', sprite: req.sprite },
            {
              type: 'create_prefab',
              prefab: {
                id: pid,
                name: req.name,
                category: 'custom',
                components: {
                  transform: {
                    x: 0,
                    y: 0,
                    w: Math.max(16, Math.min(64, req.sprite.width)),
                    h: Math.max(16, Math.min(64, req.sprite.height)),
                    zOrder: 20,
                  },
                  sprite: {
                    sprite: req.sprite.id,
                    metallic: 0.3,
                    roughness: 0.45,
                    emissive: req.ambientLight ? 0.55 : 0.1,
                    castShadow: true,
                  },
                  ...(req.ambientLight ? { light: req.ambientLight } : {}),
                  ...(req.solid ? { collider: { radius: Math.round(Math.min(req.sprite.width, req.sprite.height) * 0.42), isSolid: true } } : {}),
                  tag: 'custom_prop',
                },
              },
            },
          ],
          `像素畫室發佈物件印章「${req.name}」`,
        );
        if (!res.ok) {
          return { ok: false, message: `發佈失敗：${res.errors.join('; ') || res.summary}` };
        }
        closeSpriteModal();
        ecsWorkbench?.focusPublishedPrefab(pid);
        return { ok: true, message: `已發佈物件印章「${req.name}」至地圖印章盤！` };
      },
    },
  );

  spriteModalEl = document.createElement('section');
  spriteModalEl.className = 'p7-sprite-modal panel-hidden';
  spriteModalEl.setAttribute('aria-label', '像素精靈畫室');
  const spriteBar = document.createElement('div');
  spriteBar.className = 'p7-sprite-modal-bar';
  const spriteTitle = document.createElement('span');
  spriteTitle.className = 'p7-sprite-modal-title';
  spriteTitle.textContent = 'Pixer 像素精靈畫室（即時同步至多頁 GPU 圖集）';
  const spriteCloseBtn = document.createElement('button');
  spriteCloseBtn.type = 'button';
  spriteCloseBtn.className = 'p7-primary-cta';
  spriteCloseBtn.textContent = '完成並返回工作站';
  spriteCloseBtn.addEventListener('click', () => closeSpriteModal(), { signal });
  spriteBar.append(spriteTitle, spriteCloseBtn);
  const spriteBody = document.createElement('div');
  spriteBody.className = 'p7-sprite-modal-body';
  spriteBody.appendChild(spriteAtelierView.element);
  spriteModalEl.append(spriteBar, spriteBody);

  const launchEcsProjectInArcade = (proj: EcsProjectV2) => {
    syncProjectSpritesToSharedAtlas(proj);
    registerCartridgePlugin({
      meta: {
        id: proj.meta.id,
        code: proj.meta.code,
        title: proj.meta.title,
        subtitle: proj.meta.subtitle,
        genre: proj.meta.genre,
        accentHex: proj.meta.accentHex,
        badgeText: `${proj.viewport.width}×${proj.viewport.height} · 真 ECS 運行時`,
        controlsHint: proj.meta.controlsHint,
        goalHint: proj.meta.goalHint,
        defaultScript: '',
      },
      factory: () => new EcsCartridgeRuntime(proj),
    });
    setPlatformMode('arcade', 'arcade');
    consoleView.launchCartridge(proj.meta.id, true);
  };

  ecsWorkbench = new EcsWorkbenchView(host, atlas, ecsSession, {
    onLaunchInArcade: (proj) => launchEcsProjectInArcade(proj),
    onOpenClassicWorkshop: () => openSpriteModal(),
    onOpenSpriteAtelierForTile: (layer: EcsMapLayerName) => {
      spriteAtelierView.prepareForMapTile(32, 32, layer);
      openSpriteModal();
    },
    onAtlasMutated: () => {
      gpuEngine?.syncAtlasIfDirty();
      consoleView.refreshCardArt();
    },
  });

  platformShell = new PixerPlatformShell({
    onSelectTab: (tab) => {
      host.unlockAudio();
      if (tab === 'arcade') {
        setPlatformMode('arcade', 'arcade');
      } else {
        setPlatformMode('studio', tab);
      }
    },
    onPrimaryAction: () => {
      host.unlockAudio();
      if (platformMode === 'studio') {
        launchEcsProjectInArcade(ecsSession.getProject());
      } else {
        setPlatformMode('studio', 'studio');
      }
    },
  });

  installPolaroidDropHandler({
    shell,
    host,
    consoleView,
    signal,
    onImported: (id) => {
      setPlatformMode('arcade', 'arcade');
      consoleView.launchCartridge(id, true);
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
  screen.orientation?.addEventListener?.('change', handleViewportMetrics, { signal });

  let arcadeGpuInitialized = false;
  ensureArcadeGpuInit = () => {
    if (arcadeGpuInitialized || destroyed || !gpuEngine) return;
    arcadeGpuInitialized = true;
    const engine = gpuEngine;
    void engine
      .init()
      .then((kind) => {
        if (destroyed) return;
        updateGpuBadge(kind);
        syncGovernorResolution();
        engine.syncAtlasToGpu();
      })
      .catch((err) => {
        appLogger.error('gpu', 'gpu.initPromise', 'GPU 初始化非同步異常，強制啟用 Canvas 2D 保底', err);
        if (!destroyed) {
          updateGpuBadge(engine.forceCanvas2DFallback());
          syncGovernorResolution();
        }
      });
  };

  shell.append(
    ambientGlow,
    platformShell.element,
    utilityBar,
    consoleView.element,
    ecsWorkbench.element,
    spriteModalEl,
    drawerView.element,
    irisWipe.curtain,
  );
  root.appendChild(shell);
  consoleView.startBootSequence();
  const urlParams = new URLSearchParams(window.location.search);
  const bootMode = urlParams.get('mode');
  if (bootMode === 'arcade') {
    setPlatformMode('arcade', 'arcade');
  } else {
    setPlatformMode('studio', 'studio');
  }
  nativeBridge.hideSplash();
  appLogger.success('lifecycle', 'app.boot', 'Pixer 原教旨引擎工作站啟動完成', {
    shellTheme: activeShell,
    perfProfile,
    platformMode,
    nativePlatform: nativeBridge.platform,
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
              if (governor.setLogicalViewport(gpuEngine.getLogicalWidth(), gpuEngine.getLogicalHeight())) {
                syncGovernorResolution();
              }
              consoleView.updateHud(snap, stats, fpsSmooth);
            } else {
              host.stepFrame(dt, idleEmptyInput);
              if (shellPhase === 'IN_GAME' && host.activeCartridge) {
                const snap = host.getSnapshot();
                const stats = bridge.render(gpuEngine, snap, runner.sparkleBenchmark ? runner.benchmarkSprites : null);
                if (governor.setLogicalViewport(gpuEngine.getLogicalWidth(), gpuEngine.getLogicalHeight())) {
                  syncGovernorResolution();
                }
                consoleView.updateHud(snap, stats, fpsSmooth);
              } else if (!skipIdleRender) {
                const stats = bridge.renderIdle(gpuEngine, now / 1000, false);
                if (governor.setLogicalViewport(gpuEngine.getLogicalWidth(), gpuEngine.getLogicalHeight())) {
                  syncGovernorResolution();
                }
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
          if (spriteModalOpen) {
            spriteAtelierView.tickPreview(dt);
          } else if (platformMode === 'studio' && ecsWorkbench?.isVisible()) {
            ecsWorkbench.tick(dt);
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
      platformShell?.destroy();
      ecsWorkbench?.destroy();
      drawerView?.destroy();
      consoleView.destroy();
      spriteAtelierView.destroy();
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
