import type { GpuEngine } from './core/gpu/GpuEngine.ts';
import type { GpuBackendKind, RenderPerformanceProfile } from './core/gpu/GpuTypes.ts';
import { appLogger } from './core/runtime/AppLogger.ts';
import { extractCartridgeFromPng, MAX_DECOMPRESSED_JSON_BYTES, MAX_PNG_FILE_BYTES } from './core/runtime/CartridgePngCodec.ts';
import { getCartridgeMeta } from './core/runtime/CartridgeRegistry.ts';
import type { EngineHost } from './core/runtime/EngineHost.ts';
import { validateCartridgeJson, type CartridgeJsonV1 } from './core/sim/CartridgeSchema.ts';
import type { CartridgeId } from './core/types/WorldTypes.ts';
import { exportCartridgeCardPngDataUrl } from './ui/CardArt.ts';
import type { ConsoleView } from './ui/ConsoleView.ts';
import { setElementIconLabel } from './ui/PixelIcons.ts';
import type { StudioWorkbenchView } from './ui/StudioWorkbenchView.ts';
import type { ShellTheme, SystemSettingsDrawerView } from './ui/SystemSettingsDrawerView.ts';

export type StationId = 'play' | 'editor';

export function applyShellThemeAttr(theme: ShellTheme): void {
  if (theme === 'mint') {
    document.documentElement.removeAttribute('data-shell');
  } else {
    document.documentElement.setAttribute('data-shell', theme);
  }
}

export function applyPerformanceProfileAttr(profile: RenderPerformanceProfile): void {
  document.body.dataset.perf = profile;
}

export function createOsUtilityBar(): {
  utilityBar: HTMLElement;
  viewBtn: HTMLButtonElement;
  timeBtn: HTMLButtonElement;
  landscapeBtn: HTMLButtonElement;
  settingsBtn: HTMLButtonElement;
} {
  const utilityBar = document.createElement('div');
  utilityBar.className = 'console-os-utility-bar';

  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.className = 'console-os-pill-btn diorama-view-btn';
  viewBtn.title = '切換視角：低頭看掌機 ↔ 抬頭看窗外生態';
  setElementIconLabel(viewBtn, 'screen', '看窗外');

  const timeBtn = document.createElement('button');
  timeBtn.type = 'button';
  timeBtn.className = 'console-os-pill-btn diorama-time-btn';
  timeBtn.title = '切換窗外時辰（自動真實時間 / 清晨 / 午後 / 黃昏 / 深夜）';
  setElementIconLabel(timeBtn, 'sparkle', '自動 · 日夜');

  const landscapeBtn = document.createElement('button');
  landscapeBtn.type = 'button';
  landscapeBtn.className = 'console-os-pill-btn';
  landscapeBtn.title = '切換全螢幕橫屏掌機模式';
  setElementIconLabel(landscapeBtn, 'expand', '橫屏');

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'console-os-pill-btn settings-btn';
  settingsBtn.title = '開啟進階手感與系統設定';
  settingsBtn.setAttribute('aria-expanded', 'false');
  settingsBtn.setAttribute('aria-controls', 'system-settings-drawer');

  const settingsGpDot = document.createElement('span');
  settingsGpDot.className = 'settings-gp-dot';
  settingsGpDot.setAttribute('aria-hidden', 'true');
  const settingsText = document.createElement('span');
  settingsText.className = 'os-pill-label';
  setElementIconLabel(settingsText, 'gear', '進階設定');
  settingsBtn.append(settingsGpDot, settingsText);

  utilityBar.append(viewBtn, timeBtn, landscapeBtn, settingsBtn);
  return { utilityBar, viewBtn, timeBtn, landscapeBtn, settingsBtn };
}

export function createHandheldOrientationController(params: {
  shell: HTMLElement;
  landscapeBtn: HTMLButtonElement;
  signal: AbortSignal;
  isInEditor: () => boolean;
  exitEditorToPlay: () => void;
  getDrawerView: () => SystemSettingsDrawerView | null;
  onNativeLockRequest?: (landscape: boolean) => Promise<boolean>;
}): {
  isLandscape: () => boolean;
  setLandscape: (next: boolean) => void;
  sync: () => void;
} {
  let handheldLandscape = false;

  const sync = () => {
    params.shell.classList.toggle('is-handheld-landscape', handheldLandscape);
    document.body.classList.toggle('is-handheld-lock', handheldLandscape);
    const isPortraitViewport = window.innerHeight > window.innerWidth;
    params.shell.classList.toggle('is-rotated-90', handheldLandscape && isPortraitViewport);
    params.landscapeBtn.classList.toggle('is-active', handheldLandscape);
    setElementIconLabel(params.landscapeBtn, handheldLandscape ? 'exit' : 'expand', handheldLandscape ? '離開橫屏' : '橫屏');
    params.getDrawerView()?.syncLandscapeState(handheldLandscape);
  };

  const setLandscape = (next: boolean) => {
    handheldLandscape = next;
    if (next && params.isInEditor()) {
      params.exitEditorToPlay();
    }
    sync();

    if (params.onNativeLockRequest) {
      void params.onNativeLockRequest(next).then((handled) => {
        if (handled) return;
        applyWebOrientationLock(next);
      });
      return;
    }
    applyWebOrientationLock(next);
  };

  function applyWebOrientationLock(next: boolean): void {
    const ori = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    if (next) {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen().catch((err) => {
          appLogger.info('ui', 'shell.fullscreen', '全螢幕請求未允許，使用排版適配', {
            reason: err instanceof Error ? err.message : String(err),
          });
        });
      }
      if (ori?.lock) {
        void ori.lock('landscape').catch(() => {});
      }
    } else {
      if (ori?.unlock) {
        try {
          ori.unlock();
        } catch {
          // Ignore browsers rejecting unlock
        }
      }
      if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      }
    }
  }

  params.landscapeBtn.addEventListener('click', () => setLandscape(!handheldLandscape), { signal: params.signal });
  window.addEventListener('resize', sync, { signal: params.signal });
  screen.orientation?.addEventListener?.('change', sync, { signal: params.signal });

  return {
    isLandscape: () => handheldLandscape,
    setLandscape,
    sync,
  };
}

export async function exportCaptureScreenshot(consoleView: ConsoleView, host: EngineHost): Promise<void> {
  const insertedId = consoleView.getInserted();
  const meta = insertedId ? getCartridgeMeta(insertedId) : null;
  const cartridgeJson = insertedId ? host.getCartridgeJson(insertedId) : undefined;
  const t0 = performance.now();

  // Guard canvas readback and Blob/DataURL download: tainted canvases or blocked
  // popups/downloads must be caught and logged without interrupting the 60fps loop.
  try {
    const snap = host.getSnapshot();
    const dataUrl = await exportCartridgeCardPngDataUrl(
      consoleView.canvas,
      meta,
      snap.score,
      snap.starsCollected,
      snap.starsTotal,
      cartridgeJson,
    );
    const filename = `pixel-atelier-${meta?.code.toLowerCase() ?? 'home'}-${Date.now()}.png`;
    if (host.hal.isNativeHost()) {
      const shared = await host.hal.shareImageDataUrl(
        dataUrl,
        filename,
        meta ? `Pixel Atelier - ${meta.title}` : 'Pixel Atelier 紀念圖卡',
      );
      if (shared) {
        consoleView.showCaptureToast(
          meta ? `📤 已開啟「${meta.code}」拍立得卡匣分享！` : '📤 已開啟主畫面圖卡系統分享！',
        );
        appLogger.success(
          'ui',
          'capture.nativeSharePng',
          `已透過原生系統分享紀念圖卡 (${filename})`,
          { cartridgeId: insertedId ?? 'home', filename, embeddedCartridge: Boolean(cartridgeJson) },
          performance.now() - t0,
        );
        return;
      }
    }

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    consoleView.showCaptureToast(
      meta
        ? cartridgeJson
          ? `📸 已匯出「${meta.code}」可玩拍立得 PNG 卡匣！`
          : `📸 已匯出「${meta.code}」紀念卡匣截圖！`
        : '📸 已匯出主畫面紀念圖卡！',
    );
    appLogger.success(
      'ui',
      'capture.exportPng',
      `已匯出紀念卡匣截圖 (${filename})`,
      { cartridgeId: insertedId ?? 'home', filename, embeddedCartridge: Boolean(cartridgeJson) },
      performance.now() - t0,
    );
  } catch (err) {
    appLogger.error('ui', 'capture.exportPng', '紀念卡匣截圖匯出失敗', err, {
      cartridgeId: insertedId ?? 'home',
    });
    consoleView.showCaptureToast('⚠ 截圖匯出失敗，請檢視系統診斷日誌');
  }
}

function promptDuplicateCartridgeAction(
  shell: HTMLElement,
  title: string,
  id: string,
): Promise<'overwrite' | 'remix' | 'cancel'> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'polaroid-prompt-backdrop';
    const card = document.createElement('div');
    card.className = 'polaroid-prompt-card';

    const h = document.createElement('h3');
    h.textContent = '🎴 偵測到重複卡匣 ID';
    const p = document.createElement('p');
    p.textContent = `卡匣「${title}」（${id}）已存在於本機庫中，請選擇匯入方式：`;

    const row = document.createElement('div');
    row.className = 'tool-row';
    const finish = (choice: 'overwrite' | 'remix' | 'cancel') => {
      backdrop.remove();
      resolve(choice);
    };

    const mkBtn = (cls: string, label: string, choice: 'overwrite' | 'remix' | 'cancel') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', () => finish(choice));
      return b;
    };

    row.append(
      mkBtn('toy-btn is-primary', '♻️ 覆蓋更新', 'overwrite'),
      mkBtn('toy-btn is-mint', '🧬 另存 Remix 副本', 'remix'),
      mkBtn('toy-btn', '✕ 取消', 'cancel'),
    );
    card.append(h, p, row);
    backdrop.appendChild(card);
    shell.appendChild(backdrop);
  });
}

export async function importCartridgeFileWithPrompt(params: {
  file: File;
  shell: HTMLElement;
  host: EngineHost;
  consoleView: ConsoleView;
  mountAfterImport: boolean;
  onImported?: (id: CartridgeId, cartridge: CartridgeJsonV1) => void;
}): Promise<void> {
  const { file, shell, host, consoleView, mountAfterImport, onImported } = params;
  const lower = file.name.toLowerCase();
  const isPng = lower.endsWith('.png') || file.type === 'image/png';

  let parsedCartridge: CartridgeJsonV1;
  if (isPng) {
    if (file.size > MAX_PNG_FILE_BYTES) {
      consoleView.showCaptureToast('⚠ PNG 檔案超過 4MB 上限');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = await extractCartridgeFromPng(bytes);
    if (!decoded.ok) {
      consoleView.showCaptureToast(`⚠ ${decoded.error}`);
      return;
    }
    parsedCartridge = decoded.data;
  } else {
    if (file.size > MAX_DECOMPRESSED_JSON_BYTES) {
      consoleView.showCaptureToast('⚠ JSON 檔案超過 512KB 上限');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      consoleView.showCaptureToast('⚠ 卡匣 JSON 語法解析失敗');
      return;
    }
    const valid = validateCartridgeJson(parsed);
    if (!valid.ok) {
      consoleView.showCaptureToast(`⚠ ${valid.errors[0] ?? '卡匣格式無效'}`);
      return;
    }
    parsedCartridge = valid.data;
  }

  const rawId = parsedCartridge.meta.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  let targetId = rawId.startsWith('custom-') ? rawId : `custom-${rawId}`;
  let cartToLoad = parsedCartridge;

  if (host.hasCustomCartridge(targetId)) {
    const choice = await promptDuplicateCartridgeAction(shell, parsedCartridge.meta.title, targetId);
    if (choice === 'cancel') return;
    if (choice === 'remix') {
      targetId = `${targetId}-remix-${Date.now().toString(36)}`;
      cartToLoad = JSON.parse(JSON.stringify(parsedCartridge)) as CartridgeJsonV1;
      cartToLoad.meta.title = `${cartToLoad.meta.title} Remix`;
    }
  }

  const res = host.loadCartridge(cartToLoad, {
    save: true,
    mount: mountAfterImport,
    customId: targetId,
    overwrite: true,
  });
  if (!res.ok) {
    consoleView.showCaptureToast(`⚠ ${res.errors[0] ?? '載入卡匣失敗'}`);
    return;
  }

  host.playUiSound('key');
  onImported?.(res.id, res.cartridge);
  if (mountAfterImport) {
    consoleView.launchCartridge(res.id, true);
  }
  consoleView.showCaptureToast(`🎴 已讀取拍立得卡匣「${res.title}」！`);
}

export function installPolaroidDropHandler(params: {
  shell: HTMLElement;
  host: EngineHost;
  consoleView: ConsoleView;
  signal: AbortSignal;
  onImported?: (id: CartridgeId, cartridge: CartridgeJsonV1) => void;
}): void {
  const { shell, host, consoleView, signal, onImported } = params;
  let dragDepth = 0;

  shell.addEventListener(
    'dragenter',
    (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      shell.classList.add('polaroid-drop-active');
    },
    { signal },
  );
  shell.addEventListener(
    'dragover',
    (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    { signal },
  );
  shell.addEventListener(
    'dragleave',
    () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) shell.classList.remove('polaroid-drop-active');
    },
    { signal },
  );
  shell.addEventListener(
    'drop',
    (e) => {
      dragDepth = 0;
      shell.classList.remove('polaroid-drop-active');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      void importCartridgeFileWithPrompt({
        file,
        shell,
        host,
        consoleView,
        mountAfterImport: true,
        onImported,
      });
    },
    { signal },
  );
}

export function renderStartupCrashFallback(err: unknown, onRetry: () => void): void {
  appLogger.error('lifecycle', 'app.startupCrash', '主機啟動流程發生嚴重例外，顯示緊急復原畫面', err);
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'app-crash-fallback';
  const card = document.createElement('div');
  card.className = 'app-crash-card';
  const title = document.createElement('h2');
  title.textContent = '🛟 主機偵測到啟動異常';
  const desc = document.createElement('p');
  desc.textContent =
    err instanceof Error ? err.message : '顯示環境或本機暫存狀態異常，可一鍵清除損毀暫存並重新啟動。';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'toy-btn is-primary';
  resetBtn.textContent = '↻ 重設暫存並重啟主機';
  resetBtn.addEventListener('click', () => {
    try {
      localStorage.removeItem('pixel-atelier-sram-v1');
      localStorage.removeItem('pixel-atelier-screen-filter-v1');
      appLogger.info('storage', 'app.resetCorruptCache', '已清除啟動緊急復原之損毀暫存並嘗試重啟');
    } catch (storageErr) {
      appLogger.warn('storage', 'app.resetCorruptCache', '無法清除瀏覽器暫存，直接嘗試重啟', storageErr);
    }
    onRetry();
  });
  card.append(title, desc, resetBtn);
  wrap.appendChild(card);
  root.appendChild(wrap);
}

/**
 * Installs lifecycle-scoped global window error and unhandledrejection listeners
 * so unexpected async failures or uncaught UI exceptions appear in structured logs.
 */
export function installGlobalErrorHandlers(signal: AbortSignal): void {
  window.addEventListener(
    'error',
    (ev) => {
      appLogger.error('lifecycle', 'window.uncaughtError', ev.message || '未攔截的執行期錯誤', ev.error ?? ev.message, {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      });
    },
    { signal },
  );
  window.addEventListener(
    'unhandledrejection',
    (ev) => {
      appLogger.error('lifecycle', 'window.unhandledRejection', '未攔截的非同步 Promise 例外', ev.reason);
    },
    { signal },
  );
}

/**
 * Escalating 3-step self-healing ladder for RAF loop stability:
 * 1) Resync GPU texture atlas & reset foreground panel visibility;
 * 2) Downgrade GPU pipeline to software Canvas 2D fallback;
 * 3) Unmount active cartridge and safely return to Home Lobby.
 * Returns the updated consecutive error count.
 */
export function recoverFromFrameError(params: {
  step: number;
  frameErr: unknown;
  gpuEngine: GpuEngine;
  host: EngineHost;
  consoleView: ConsoleView;
  studioWorkbench: StudioWorkbenchView | null;
  utilityBar: HTMLElement;
  onGpuKindChange: (kind: GpuBackendKind) => void;
}): number {
  const { step, frameErr, gpuEngine, host, consoleView, studioWorkbench, utilityBar, onGpuKindChange } = params;
  appLogger.error('lifecycle', 'app.frameRecovery', `主迴圈第 ${step} 階異常自動復原`, frameErr, {
    step,
    shellPhase: consoleView.getShellPhase(),
    cartridgeId: host.activeCartridge ?? 'none',
  });
  if (step === 1) {
    gpuEngine.syncAtlasToGpu();
    studioWorkbench?.hide();
    utilityBar.classList.remove('panel-hidden');
    consoleView.setInEditor(false);
    return step;
  }
  if (step === 2) {
    onGpuKindChange(gpuEngine.forceCanvas2DFallback());
    return step;
  }
  host.unmount();
  consoleView.returnToHomeLobby();
  consoleView.showCaptureToast('🛟 偵測到顯示異常，已自動切換穩定模式');
  return 0;
}
