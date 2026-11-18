import type { DpadDeadzoneMode, StickCurveMode } from '../core/input/InputPipeline.ts';
import type { GpuBackendKind, RenderPerformanceProfile } from '../core/gpu/GpuTypes.ts';
import type { ErgonomicGripMode } from '../core/hal/SystemHal.ts';
import { initPwaBridge } from './PwaBridge.ts';
import {
  HAPTIC_LABELS,
  SHELL_THEMES,
  type ShellTheme,
  type SystemSettingsDrawerCallbacks,
  type SystemSettingsDrawerState,
} from './SettingsDrawerTypes.ts';
import { SystemLogPanelView } from './SystemLogPanelView.ts';
import { btn, createSegmentedControl, el } from './dom.ts';

export { SHELL_THEMES };
export type { ShellTheme, SystemSettingsDrawerCallbacks, SystemSettingsDrawerState };

/**
 * Collapsible System Settings Drawer managing grip layout, shell themes, haptics,
 * touch ergonomics, cartridge SRAM utilities, GPU benchmark/debug toggles, and PWA installation.
 */
export class SystemSettingsDrawerView {
  public readonly element: HTMLElement;

  private readonly ac = new AbortController();
  private readonly cb: SystemSettingsDrawerCallbacks;
  private readonly disposePwa: () => void;

  private openState = false;
  private activeTab: 'settings' | 'logs' = 'settings';
  private readonly closeBtn: HTMLButtonElement;
  private readonly settingsPane: HTMLElement;
  private readonly logPanel: SystemLogPanelView;
  private readonly syncDrawerTab: (tab: 'settings' | 'logs') => void;
  private readonly landscapeBtn: HTMLButtonElement;
  private readonly hapticBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly autofireBtn: HTMLButtonElement;
  private readonly retryBtn: HTMLButtonElement;
  private readonly clearSaveBtn: HTMLButtonElement;
  private readonly ejectBtn: HTMLButtonElement;
  private readonly benchBtn: HTMLButtonElement;
  private readonly hitboxBtn: HTMLButtonElement;
  private readonly gpuDot: HTMLElement;
  private readonly gpuLabel: HTMLElement;
  private readonly gamepadPill: HTMLElement;
  private readonly gamepadLabelEl: HTMLElement;
  private readonly swatchBtns = new Map<ShellTheme, HTMLButtonElement>();
  private readonly syncGrip: (mode: ErgonomicGripMode) => void;
  private readonly syncDeadzone: (mode: DpadDeadzoneMode) => void;
  private readonly syncStickCurve: (mode: StickCurveMode) => void;
  private readonly syncStickOrigin: (mode: 'floating' | 'fixed') => void;
  private readonly syncPerfProfile: (mode: RenderPerformanceProfile) => void;

  constructor(callbacks: SystemSettingsDrawerCallbacks) {
    this.cb = callbacks;
    const { signal } = this.ac;
    const initial = callbacks.getState();

    this.element = el('div', 'sys-drawer-backdrop panel-hidden');

    const drawerEl = el('aside', 'sys-drawer');
    drawerEl.id = 'system-settings-drawer';
    drawerEl.setAttribute('role', 'dialog');
    drawerEl.setAttribute('aria-modal', 'true');
    drawerEl.setAttribute('aria-label', '系統與手感設定');

    const drawerHead = el('div', 'sys-drawer-head');
    const drawerTitle = el('h2', 'sys-drawer-title', '⚙ 系統與手感設定');
    this.closeBtn = btn('toy-btn sys-drawer-close', '✕', undefined, () => this.close(), signal);
    this.closeBtn.setAttribute('aria-label', '關閉系統設定');
    drawerHead.append(drawerTitle, this.closeBtn);

    this.settingsPane = el('div', 'sys-drawer-pane');
    this.logPanel = new SystemLogPanelView();
    const tabCtrl = createSegmentedControl<'settings' | 'logs'>({
      ariaLabel: '設定或系統診斷日誌分頁',
      initialValue: 'settings',
      signal,
      options: [
        { value: 'settings', label: '⚙ 手感設定', title: '調整握持佈局、觸控回饋與卡匣工具' },
        { value: 'logs', label: '📋 系統日誌', title: '檢視結構化執行成功、錯誤日誌與匯出 JSONL' },
      ],
      onSelect: (tab) => this.switchTab(tab),
    });
    tabCtrl.element.classList.add('sys-drawer-tabs');
    this.syncDrawerTab = tabCtrl.sync;

    // Section 1: Grip & Shell
    const secGrip = el('section', 'sys-drawer-section');
    secGrip.appendChild(el('div', 'sys-drawer-label', '🎮 握持佈局與主機外殼'));

    const gripCtrl = createSegmentedControl<ErgonomicGripMode>({
      ariaLabel: '掌機握持佈局模式',
      initialValue: initial.gripMode,
      signal,
      options: [
        { value: 'one-left', label: '👈 左單', title: '左手單手拇指模式' },
        { value: 'both', label: '🙌 雙手', title: '雙手標準掌機模式' },
        { value: 'one-right', label: '👉 右單', title: '右手單手拇指模式' },
      ],
      onSelect: (mode) => {
        this.cb.onSelectGrip(mode);
        this.syncState();
      },
    });
    this.syncGrip = gripCtrl.sync;

    const swatchBox = el('div', 'shell-swatches');
    for (const theme of SHELL_THEMES) {
      const swatch = btn('shell-swatch', '', `外殼換色：${theme.label}`);
      swatch.style.background = `linear-gradient(90deg, ${theme.left} 50%, ${theme.right} 50%)`;
      swatch.addEventListener(
        'click',
        () => {
          this.cb.onSelectShell(theme.id);
          this.syncState();
        },
        { signal },
      );
      this.swatchBtns.set(theme.id, swatch);
      swatchBox.appendChild(swatch);
    }

    const gripRow = el('div', 'sys-drawer-row');
    gripRow.append(gripCtrl.element, swatchBox);

    this.landscapeBtn = btn('toy-btn is-mint', '⛶ 切換橫屏掌機');
    this.landscapeBtn.addEventListener(
      'click',
      () => {
        this.close();
        this.cb.onToggleLandscape();
      },
      { signal },
    );
    secGrip.append(gripRow, this.landscapeBtn);

    // Section 2: Touch Ergonomics & Haptics
    const secTouch = el('section', 'sys-drawer-section');
    secTouch.appendChild(el('div', 'sys-drawer-label', '👆 觸控調校與材質回饋'));

    this.hapticBtn = btn('toy-btn', '', '切換材質觸覺引擎強度（強 / 輕 / 關）');
    this.hapticBtn.addEventListener(
      'click',
      () => {
        this.cb.onCycleHaptic();
        this.syncState();
      },
      { signal },
    );

    this.muteBtn = btn('toy-btn', '🔊 音效開');
    this.muteBtn.addEventListener(
      'click',
      () => {
        this.cb.onToggleMute();
        this.syncState();
      },
      { signal },
    );

    this.autofireBtn = btn(
      'toy-btn',
      '',
      '按住 A/B 觸控鍵超過 140ms 自動觸發連發，長按集氣照常保留',
    );
    this.autofireBtn.addEventListener(
      'click',
      () => {
        this.cb.onToggleAutofire();
        this.syncState();
      },
      { signal },
    );

    const deadzoneRow = el('div', 'sys-drawer-row');
    deadzoneRow.appendChild(el('span', 'sys-sub-label', '✚ 十字鍵斜向死區'));
    const dzCtrl = createSegmentedControl<DpadDeadzoneMode>({
      ariaLabel: '十字鍵斜向判定範圍',
      initialValue: initial.deadzoneMode,
      signal,
      options: [
        { value: 'standard', label: '標準 38°', title: '標準斜向感應範圍，八方向移動順暢' },
        { value: 'tight', label: '緊緻 30°', title: '收窄斜向扇區，防止誤觸斜方向' },
      ],
      onSelect: (mode) => {
        this.cb.onSelectDeadzone(mode);
        this.syncState();
      },
    });
    this.syncDeadzone = dzCtrl.sync;
    deadzoneRow.appendChild(dzCtrl.element);

    const stickCurveRow = el('div', 'sys-drawer-row');
    stickCurveRow.appendChild(el('span', 'sys-sub-label', '🕹 搖桿反應曲線'));
    const curveCtrl = createSegmentedControl<StickCurveMode>({
      ariaLabel: '類比搖桿反應曲線',
      initialValue: initial.stickCurveMode,
      signal,
      options: [
        { value: 'standard', label: '標準', title: '均衡非線性響應，兼具動作跑動與微調' },
        { value: 'precision', label: '精準', title: '中心區更細膩的緩曲線，精確瞄準與微步移動' },
      ],
      onSelect: (mode) => {
        this.cb.onSelectStickCurve(mode);
        this.syncState();
      },
    });
    this.syncStickCurve = curveCtrl.sync;
    stickCurveRow.appendChild(curveCtrl.element);

    const stickOriginRow = el('div', 'sys-drawer-row');
    stickOriginRow.appendChild(el('span', 'sys-sub-label', '🎯 動態搖桿圓心'));
    const originCtrl = createSegmentedControl<'floating' | 'fixed'>({
      ariaLabel: '觸控搖桿圓心跟隨模式',
      initialValue: initial.stickDynamicOrigin ? 'floating' : 'fixed',
      signal,
      options: [
        { value: 'floating', label: '跟隨', title: '以拇指落點自動建立動態圓心並防誤觸偏折' },
        { value: 'fixed', label: '固定', title: '固定以幾何中心為搖桿原點' },
      ],
      onSelect: (val) => {
        this.cb.onToggleStickOrigin(val === 'floating');
        this.syncState();
      },
    });
    this.syncStickOrigin = originCtrl.sync;
    stickOriginRow.appendChild(originCtrl.element);

    const touchGrid = el('div', 'sys-drawer-grid');
    touchGrid.append(this.hapticBtn, this.muteBtn, this.autofireBtn);
    secTouch.append(touchGrid, deadzoneRow, stickCurveRow, stickOriginRow);

    // Section 3: Cartridge & Save Tools
    const secCart = el('section', 'sys-drawer-section');
    secCart.appendChild(el('div', 'sys-drawer-label', '💾 卡匣與存檔工具'));

    const captureBtn = btn('toy-btn', '📸 紀念截圖 PNG', undefined, () => {
      this.close();
      this.cb.onCapture();
    }, signal);
    this.retryBtn = btn('toy-btn', '↺ 重試當前關卡', undefined, () => {
      if (!this.cb.getState().hasCartridge) return;
      this.close();
      this.cb.onRetryStage();
    }, signal);
    this.clearSaveBtn = btn('toy-btn is-danger-soft', '🗑 清除電池存檔', undefined, () => {
      if (!this.cb.getState().hasCartridge) return;
      this.cb.onClearSave();
      this.syncState();
    }, signal);
    this.ejectBtn = btn('toy-btn', '⏏ 退出卡匣', undefined, () => {
      if (!this.cb.getState().hasCartridge) return;
      this.close();
      this.cb.onEject();
    }, signal);

    const cartGrid = el('div', 'sys-drawer-grid');
    cartGrid.append(captureBtn, this.retryBtn, this.clearSaveBtn, this.ejectBtn);
    secCart.appendChild(cartGrid);

    // Section 4: Engine Performance & PWA Install
    const secEngine = el('section', 'sys-drawer-section');
    secEngine.appendChild(el('div', 'sys-drawer-label', '⚡ 引擎效能測試與安裝'));

    this.benchBtn = btn('toy-btn', '✨ 1,150+ GPU 精靈派對', undefined, () => {
      this.cb.onToggleBenchmark();
      this.syncState();
    }, signal);
    this.hitboxBtn = btn('toy-btn', '🧪 F3 除錯碰撞框', undefined, () => {
      this.cb.onToggleDebugHitboxes();
      this.syncState();
    }, signal);

    const engineGrid = el('div', 'sys-drawer-grid');
    engineGrid.append(this.benchBtn, this.hitboxBtn);

    const gpuPill = el('span', 'gpu-pill');
    this.gpuDot = el('span', 'gpu-dot');
    this.gpuLabel = el('span', undefined, 'GPU 啟動中…');
    gpuPill.append(this.gpuDot, this.gpuLabel);

    this.gamepadPill = el('span', 'gpu-pill gamepad-pill');
    const gpDot = el('span', 'gpu-dot is-gamepad');
    this.gamepadLabelEl = el('span', undefined, '🎮 實體手把：未連線');
    this.gamepadPill.append(gpDot, this.gamepadLabelEl);

    const statusStrip = el('div', 'sys-status-strip');
    statusStrip.append(gpuPill, this.gamepadPill);

    const hapticTestRow = el('div', 'sys-drawer-row');
    hapticTestRow.appendChild(el('span', 'sys-sub-label', '🎛 雙側立體震動測試'));
    const testBtns = el('div', 'sys-haptic-test-group');
    const testLeftBtn = btn('toy-btn sys-haptic-test-btn', '◀ 左測', '測試左側 Joy-Con / 馬達震動與聲道', () => {
      this.cb.onTestStereoHaptic('left');
    }, signal);
    const testBothBtn = btn('toy-btn sys-haptic-test-btn', '雙側', '測試雙側同步震動', () => {
      this.cb.onTestStereoHaptic('both');
    }, signal);
    const testRightBtn = btn('toy-btn sys-haptic-test-btn', '右測 ▶', '測試右側 Joy-Con / 馬達震動與聲道', () => {
      this.cb.onTestStereoHaptic('right');
    }, signal);
    testBtns.append(testLeftBtn, testBothBtn, testRightBtn);
    hapticTestRow.appendChild(testBtns);

    const perfRow = el('div', 'sys-drawer-row');
    perfRow.appendChild(el('span', 'sys-sub-label', '🔋 渲染與省電模式'));
    const perfCtrl = createSegmentedControl<RenderPerformanceProfile>({
      ariaLabel: '效能與溫控解析度模式',
      initialValue: initial.perfProfile,
      signal,
      options: [
        { value: 'eco', label: '省電', title: '320×180 原生像素省電模式，大幅降溫省電' },
        { value: 'balanced', label: '平衡', title: '中階手機穩跑 60fps，動態溫控縮放 2× 像素並降低合成負擔' },
        { value: 'quality', label: '畫質', title: '960×540 最高畫質與完整玻璃模糊質感' },
      ],
      onSelect: (profile) => {
        this.cb.onSelectPerfProfile(profile);
        this.syncState();
      },
    });
    this.syncPerfProfile = perfCtrl.sync;
    perfRow.appendChild(perfCtrl.element);

    const pwaRow = el('div', 'sys-drawer-row');
    this.disposePwa = initPwaBridge(pwaRow, () => this.cb.onPwaInstallClick());

    secEngine.append(perfRow, engineGrid, statusStrip, hapticTestRow, pwaRow);

    this.settingsPane.append(secGrip, secTouch, secCart, secEngine);
    drawerEl.append(drawerHead, tabCtrl.element, this.settingsPane, this.logPanel.element);
    this.element.appendChild(drawerEl);

    this.element.addEventListener(
      'click',
      (e) => {
        if (e.target === this.element) this.close();
      },
      { signal },
    );

    this.syncState(initial);
  }

  private switchTab(tab: 'settings' | 'logs'): void {
    this.activeTab = tab;
    this.syncDrawerTab(tab);
    this.settingsPane.classList.toggle('panel-hidden', tab !== 'settings');
    this.logPanel.setVisible(this.openState && tab === 'logs');
  }

  public isOpen(): boolean {
    return this.openState;
  }

  public toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  public open(): void {
    this.openState = true;
    this.syncState();
    this.logPanel.setVisible(this.activeTab === 'logs');
    this.element.classList.remove('panel-hidden');
    this.cb.onOpenHaptic();
    this.cb.onOpenChange?.(true);
    this.closeBtn.focus();
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.logPanel.setVisible(false);
    this.element.classList.add('panel-hidden');
    this.cb.onOpenChange?.(false);
  }

  public updateGpuBadge(kind: GpuBackendKind): void {
    this.gpuDot.classList.toggle('is-webgpu', kind === 'webgpu');
    this.gpuLabel.textContent =
      kind === 'webgpu'
        ? 'WebGPU WGSL'
        : kind === 'webgl2'
          ? 'WebGL2 GLSL'
          : kind === 'canvas2d'
            ? 'Canvas 2D 保底'
            : '初始化中';
  }

  public syncGamepad(connected: boolean, label: string | null): void {
    this.gamepadPill.classList.toggle('is-connected', connected);
    if (connected) {
      const shortName = label ? label.split('(')[0].trim().slice(0, 18) : 'USB/藍牙手把';
      this.gamepadLabelEl.textContent = `🎮 已連線：${shortName}`;
    } else {
      this.gamepadLabelEl.textContent = '🎮 實體手把：未連線';
    }
  }

  public syncLandscapeState(isLandscape: boolean): void {
    this.landscapeBtn.classList.toggle('is-active', isLandscape);
    this.landscapeBtn.textContent = isLandscape ? '↩ 離開橫屏掌機' : '⛶ 切換橫屏掌機';
  }

  public syncState(s: SystemSettingsDrawerState = this.cb.getState()): void {
    this.syncGrip(s.gripMode);
    for (const [id, b] of this.swatchBtns.entries()) {
      b.classList.toggle('is-active', id === s.shellTheme);
    }
    this.syncLandscapeState(s.handheldLandscape);

    this.hapticBtn.textContent = HAPTIC_LABELS[s.hapticLevel];
    this.hapticBtn.classList.toggle('is-active', s.hapticLevel === 'full');

    this.muteBtn.textContent = s.muted ? '🔇 靜音中' : '🔊 音效開';
    this.muteBtn.classList.toggle('is-active', !s.muted);

    this.autofireBtn.textContent = s.autofire ? '🔥 連發輔助：開' : '🔥 連發輔助：關';
    this.autofireBtn.classList.toggle('is-active', s.autofire);
    this.autofireBtn.setAttribute('aria-pressed', String(s.autofire));

    this.syncDeadzone(s.deadzoneMode);
    this.syncStickCurve(s.stickCurveMode);
    this.syncStickOrigin(s.stickDynamicOrigin ? 'floating' : 'fixed');
    this.syncPerfProfile(s.perfProfile);

    this.retryBtn.disabled = !s.hasCartridge;
    this.ejectBtn.disabled = !s.hasCartridge;
    this.clearSaveBtn.disabled = !s.hasCartridge || !s.hasSram;

    this.benchBtn.classList.toggle('is-active', s.benchmarkOn);
    this.benchBtn.textContent = s.benchmarkOn ? '🎉 派對中 1,150+ 精靈' : '✨ 1,150+ GPU 精靈派對';

    this.hitboxBtn.classList.toggle('is-active', s.debugHitboxesOn);
    this.hitboxBtn.textContent = s.debugHitboxesOn ? '🧪 碰撞框：開啟中' : '🧪 F3 除錯碰撞框';

    this.syncGamepad(s.gamepadConnected, s.gamepadLabel);
  }

  public destroy(): void {
    this.close();
    this.logPanel.destroy();
    this.disposePwa();
    this.ac.abort();
    this.element.remove();
  }
}
