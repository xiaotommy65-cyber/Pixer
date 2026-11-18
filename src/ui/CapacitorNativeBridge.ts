import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar } from '@capacitor/status-bar';
import type { HapticProfile, NativeHalAdapter } from '../core/hal/HapticEngine.ts';
import type { SystemHal } from '../core/hal/SystemHal.ts';
import { appLogger } from '../core/runtime/AppLogger.ts';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

interface OptionalKeepAwakePlugin {
  keepAwake?: () => Promise<void>;
  allowSleep?: () => Promise<void>;
}

export interface NativeHostBridgeOptions {
  hal: SystemHal;
  onEnterBackground: () => void;
  onEnterForeground: () => void;
  onHardwareBack: () => boolean;
}

export interface NativeHostBridgeHandle {
  readonly isNative: boolean;
  readonly platform: 'web' | 'ios' | 'android';
  hideSplash: () => void;
  setKeepAwake: (enabled: boolean) => void;
  destroy: () => void;
}

function getPlatformKind(): 'web' | 'ios' | 'android' {
  const p = Capacitor.getPlatform();
  if (p === 'ios' || p === 'android') return p;
  return 'web';
}

function mapHapticImpact(profile: HapticProfile): ImpactStyle {
  if (profile === 'impact') return ImpactStyle.Heavy;
  if (profile === 'click' || profile === 'thump') return ImpactStyle.Medium;
  return ImpactStyle.Light;
}

/**
 * Integrates Capacitor native capabilities (iOS CoreHaptics/Taptic Engine, Android VibrationEffect,
 * landscape orientation lock, status bar immersion, KeepAwake screen lock, native share sheet,
 * SplashScreen dismissal, and App background/backButton lifecycle) into SystemHal while keeping
 * web/PWA browsers working seamlessly via WakeLock and capability fallbacks.
 */
export function initCapacitorNativeBridge(opts: NativeHostBridgeOptions): NativeHostBridgeHandle {
  const isNative = Capacitor.isNativePlatform();
  const platform = getPlatformKind();
  const listeners: PluginListenerHandle[] = [];

  let destroyed = false;
  let desiredWakeLock = false;
  let wakeSentinel: WakeLockSentinelLike | null = null;
  let splashHidden = false;

  const applyKeepAwake = async (enabled: boolean): Promise<boolean> => {
    desiredWakeLock = enabled;
    const plugins = (Capacitor as unknown as { Plugins?: { KeepAwake?: OptionalKeepAwakePlugin } }).Plugins;
    const nativeKeepAwake = plugins?.KeepAwake;

    if (isNative && nativeKeepAwake) {
      try {
        if (enabled) await nativeKeepAwake.keepAwake?.();
        else await nativeKeepAwake.allowSleep?.();
        return true;
      } catch {
        // Fall through to standard Web WakeLock API supported by modern WKWebView & Android WebView
      }
    }

    const nav = typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithWakeLock) : undefined;
    if (!nav?.wakeLock) return false;

    try {
      if (enabled) {
        if (!wakeSentinel || wakeSentinel.released) {
          wakeSentinel = await nav.wakeLock.request('screen');
        }
        return true;
      }
      if (wakeSentinel && !wakeSentinel.released) {
        await wakeSentinel.release();
      }
      wakeSentinel = null;
      return true;
    } catch {
      return false;
    }
  };

  const shareDataUrlNative = async (dataUrl: string, filename: string, title?: string): Promise<boolean> => {
    if (!isNative) return false;
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return false;
    const base64Data = dataUrl.slice(commaIdx + 1);
    try {
      const writeRes = await Filesystem.writeFile({
        path: filename,
        data: base64Data,
        directory: Directory.Cache,
      });
      await Share.share({
        title: title ?? 'Pixel Atelier 紀念卡匣',
        text: '我的 Pixel Atelier 像素掌機紀念截圖',
        files: [writeRes.uri],
        dialogTitle: '儲存或分享紀念卡匣圖卡',
      });
      return true;
    } catch (err) {
      appLogger.warn('ui', 'native.shareImage', '原生系統分享已取消或失敗，改用瀏覽器下載', err);
      return false;
    }
  };

  const adapter: NativeHalAdapter = {
    id: `capacitor-${platform}`,
    isNativeApp: () => isNative,
    getPlatform: () => platform,
    hapticTrigger: (profile, _intensity, durationMs) => {
      if (!isNative) return false;
      if (profile === 'celebrate') {
        void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
        return true;
      }
      if (profile === 'rumble') {
        void Haptics.vibrate({ duration: Math.max(12, Math.min(200, Math.round(durationMs))) }).catch(() => {});
        return true;
      }
      void Haptics.impact({ style: mapHapticImpact(profile) }).catch(() => {});
      return true;
    },
    vibratePattern: (pattern) => {
      if (!isNative) return false;
      const ms = Array.isArray(pattern) ? pattern[0] ?? 18 : pattern;
      void Haptics.vibrate({ duration: Math.max(10, Math.min(250, Math.round(ms))) }).catch(() => {});
      return true;
    },
    requestFullscreenLock: async (landscape) => {
      if (!isNative) return false;
      try {
        if (landscape) {
          await StatusBar.hide().catch(() => {});
          await ScreenOrientation.lock({ orientation: 'landscape' });
        } else {
          await ScreenOrientation.unlock().catch(() => {});
          await StatusBar.show().catch(() => {});
        }
        return true;
      } catch (err) {
        appLogger.info('ui', 'native.orientationLock', '原生螢幕方向鎖定受裝置限制', {
          landscape,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    setKeepAwake: applyKeepAwake,
    shareImageDataUrl: shareDataUrlNative,
  };

  opts.hal.registerNativeAdapter(adapter);

  if (isNative) {
    document.body.dataset.nativePlatform = platform;
    appLogger.success('lifecycle', 'native.bridgeInit', `已啟用 Capacitor 原生宿主橋接 (${platform})`, {
      platform,
    });

    void App.addListener('appStateChange', ({ isActive }) => {
      if (destroyed) return;
      if (isActive) {
        opts.onEnterForeground();
        if (desiredWakeLock) {
          void applyKeepAwake(true);
        }
      } else {
        void applyKeepAwake(false);
        opts.onEnterBackground();
      }
    })
      .then((handle) => {
        if (destroyed) void handle.remove();
        else listeners.push(handle);
      })
      .catch(() => {});

    void App.addListener('backButton', ({ canGoBack }) => {
      if (destroyed) return;
      const handled = opts.onHardwareBack();
      if (!handled && !canGoBack) {
        void App.minimizeApp().catch(() => {});
      }
    })
      .then((handle) => {
        if (destroyed) void handle.remove();
        else listeners.push(handle);
      })
      .catch(() => {});
  }

  const hideSplash = () => {
    if (!isNative || splashHidden) return;
    splashHidden = true;
    void SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => {});
  };

  return {
    isNative,
    platform,
    hideSplash,
    setKeepAwake: (enabled: boolean) => {
      if (desiredWakeLock === enabled && (enabled ? wakeSentinel && !wakeSentinel.released : !wakeSentinel)) {
        return;
      }
      void applyKeepAwake(enabled);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      void applyKeepAwake(false);
      opts.hal.unregisterNativeAdapter(adapter.id);
      for (const h of listeners) {
        void h.remove().catch(() => {});
      }
      listeners.length = 0;
      delete document.body.dataset.nativePlatform;
    },
  };
}
