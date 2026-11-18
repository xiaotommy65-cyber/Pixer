import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import { appLogger } from '../core/runtime/AppLogger.ts';
import { btn, el } from './dom.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Registers the Vite PWA service worker, mounts the mandatory in-app Install button
 * (supporting both Chromium beforeinstallprompt & iOS Safari Add-to-Home-Screen guide modal),
 * renders a non-intrusive offline connectivity badge, and returns a lifecycle disposer.
 * Automatically bypassed inside Capacitor native iOS/Android binaries.
 */
export function initPwaBridge(headerTools: HTMLElement, onInstallClick?: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || Capacitor.isNativePlatform()) {
    return () => {};
  }

  // Register PWA service worker safely; unsupported preview sandboxes or headless tests
  // must not abort UI initialization if SW registration throws.
  try {
    registerSW({
      immediate: true,
      onRegisteredSW: (swUrl) => {
        appLogger.success('lifecycle', 'pwa.registerSw', '已註冊 PWA 離線快取 Service Worker', { swUrl });
      },
      onRegisterError: (err) => {
        appLogger.warn('lifecycle', 'pwa.registerSw', 'PWA Service Worker 註冊受限（略過離線快取）', err);
      },
    });
  } catch (err) {
    appLogger.warn('lifecycle', 'pwa.registerSw', '環境不支援 Service Worker，略過註冊', err);
  }

  const ac = new AbortController();
  const { signal } = ac;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  const isIOS = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let installed = isStandalone();

  const installBtn = btn('toy-btn is-honey pwa-install-btn panel-hidden', '📲 安裝主機', '安裝 Pixel Atelier 到桌面／主畫面離線遊玩');
  headerTools.appendChild(installBtn);

  // iOS Safari Add-to-Home-Screen modal guide
  const iosModal = el('div', 'pwa-ios-modal panel-hidden');
  iosModal.setAttribute('role', 'dialog');
  iosModal.setAttribute('aria-modal', 'true');
  iosModal.setAttribute('aria-label', '安裝到 iPhone / iPad 主畫面');
  const modalCard = el('div', 'pwa-ios-card');
  const modalTitle = el('h3', undefined, '📲 安裝 Pixel Atelier 到主畫面');
  const modalBody = el('p');
  modalBody.innerHTML =
    '1. 點選 Safari 下方工具列的 <strong>「分享」</strong> 圖示。<br/>2. 向下滑動並選擇 <strong>「加入主畫面」</strong>。<br/>3. 即可如原生掌機般全螢幕離線開啟！';
  const closeBtn = btn('toy-btn is-primary', '我知道了', undefined, () => {
    iosModal.classList.add('panel-hidden');
  });
  modalCard.append(modalTitle, modalBody, closeBtn);
  iosModal.appendChild(modalCard);
  iosModal.addEventListener(
    'click',
    (e) => {
      if (e.target === iosModal) iosModal.classList.add('panel-hidden');
    },
    { signal },
  );
  document.body.appendChild(iosModal);

  const syncInstallUi = () => {
    if (installed) {
      installBtn.classList.add('panel-hidden');
      return;
    }
    if (deferredPrompt) {
      installBtn.textContent = '📲 安裝應用';
      installBtn.classList.remove('panel-hidden');
    } else if (isIOS) {
      installBtn.textContent = '📲 iOS 安裝';
      installBtn.classList.remove('panel-hidden');
    } else {
      installBtn.classList.add('panel-hidden');
    }
  };

  installBtn.addEventListener(
    'click',
    async () => {
      onInstallClick?.();
      if (deferredPrompt) {
        try {
          await deferredPrompt.prompt();
          const { outcome, platform } = await deferredPrompt.userChoice;
          appLogger.info('ui', 'pwa.installPrompt', `PWA 安裝提示回應：${outcome}`, { outcome, platform });
          if (outcome === 'accepted') {
            installed = true;
            deferredPrompt = null;
          }
        } catch (err) {
          appLogger.warn('ui', 'pwa.installPrompt', 'PWA 安裝提示流程已取消或中斷', err);
        }
        syncInstallUi();
        return;
      }
      if (isIOS && !installed) {
        iosModal.classList.remove('panel-hidden');
      }
    },
    { signal },
  );

  window.addEventListener(
    'beforeinstallprompt',
    (e) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      syncInstallUi();
    },
    { signal },
  );

  window.addEventListener(
    'appinstalled',
    () => {
      installed = true;
      deferredPrompt = null;
      syncInstallUi();
    },
    { signal },
  );

  syncInstallUi();

  // Offline Connectivity Indicator
  const offlineBadge = el('div', 'pwa-offline-badge panel-hidden');
  const offlineDot = el('span', 'pwa-offline-dot');
  const offlineText = el('span', undefined, '離線模式 · 使用本機快取資源');
  offlineBadge.append(offlineDot, offlineText);
  document.body.appendChild(offlineBadge);

  const syncOnline = () => {
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    offlineBadge.classList.toggle('panel-hidden', online);
  };

  window.addEventListener('online', syncOnline, { signal });
  window.addEventListener('offline', syncOnline, { signal });
  syncOnline();

  return () => {
    ac.abort();
    installBtn.remove();
    iosModal.remove();
    offlineBadge.remove();
  };
}
