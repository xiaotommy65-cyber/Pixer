import { HapticEngine, type HapticLevel, type NativeHalAdapter } from './HapticEngine.ts';

export type ErgonomicGripMode = 'both' | 'one-right' | 'one-left';

/**
 * Reserved extension interface for future sensor/sharing hardware waves
 * (Gyroscope tilt, mic blow, native share sheet). Optional in v1.
 */
export interface HalSensorExtension {
  getTilt?: () => { tiltX: number; tiltY: number } | null;
  getMicBlowLevel?: () => number;
}

export interface SystemHalPublicApi {
  readonly version: string;
  readonly haptic: HapticEngine;
  getGripMode: () => ErgonomicGripMode;
  setGripMode: (mode: ErgonomicGripMode) => void;
  getHapticLevel: () => HapticLevel;
  setHapticLevel: (level: HapticLevel) => void;
  registerNativeAdapter: (adapter: NativeHalAdapter) => void;
  unregisterNativeAdapter: (id?: string) => void;
  registerSensorExtension: (ext: HalSensorExtension | null) => void;
  isNativeHost: () => boolean;
  getPlatform: () => 'web' | 'ios' | 'android';
  setKeepAwake: (enabled: boolean) => Promise<boolean>;
  requestFullscreenLock: (landscape: boolean) => Promise<boolean>;
  shareImageDataUrl: (dataUrl: string, filename: string, title?: string) => Promise<boolean>;
}

declare global {
  interface Window {
    __PIXEL_ATELIER_HAL__?: SystemHalPublicApi;
  }
}

export function normalizeGripMode(raw: string | null | undefined): ErgonomicGripMode {
  if (raw === 'one-right' || raw === 'one-left' || raw === 'both') return raw;
  return 'both';
}

export function normalizeHapticLevel(raw: string | null | undefined): HapticLevel {
  if (raw === 'off' || raw === 'gentle' || raw === 'full') return raw;
  return 'full';
}

/**
 * Unified Hardware Abstraction Layer (HAL) decoupling cartridges & console UI from
 * Web vs Android TWA vs future native Capacitor plugins.
 */
export class SystemHal implements SystemHalPublicApi {
  public readonly version = '1.0.0';
  public readonly haptic: HapticEngine;

  private gripMode: ErgonomicGripMode = 'both';
  private gripListeners = new Set<(mode: ErgonomicGripMode) => void>();
  private hapticListeners = new Set<(level: HapticLevel) => void>();
  private sensorExt: HalSensorExtension | null = null;

  constructor(clock?: () => number) {
    this.haptic = new HapticEngine(clock);
    if (typeof window !== 'undefined') {
      window.__PIXEL_ATELIER_HAL__ = this;
    }
  }

  public getGripMode(): ErgonomicGripMode {
    return this.gripMode;
  }

  public setGripMode(mode: ErgonomicGripMode): void {
    if (this.gripMode === mode) return;
    this.gripMode = mode;
    for (const cb of this.gripListeners) cb(mode);
  }

  public onGripChange(cb: (mode: ErgonomicGripMode) => void): () => void {
    this.gripListeners.add(cb);
    return () => this.gripListeners.delete(cb);
  }

  public getHapticLevel(): HapticLevel {
    return this.haptic.getLevel();
  }

  public setHapticLevel(level: HapticLevel): void {
    if (this.haptic.getLevel() === level) return;
    this.haptic.setLevel(level);
    for (const cb of this.hapticListeners) cb(level);
  }

  public onHapticLevelChange(cb: (level: HapticLevel) => void): () => void {
    this.hapticListeners.add(cb);
    return () => this.hapticListeners.delete(cb);
  }

  public registerNativeAdapter(adapter: NativeHalAdapter): void {
    this.haptic.setNativeAdapter(adapter);
  }

  public unregisterNativeAdapter(id?: string): void {
    const curr = this.haptic.getNativeAdapter();
    if (!curr) return;
    if (!id || curr.id === id) {
      this.haptic.setNativeAdapter(null);
    }
  }

  public registerSensorExtension(ext: HalSensorExtension | null): void {
    this.sensorExt = ext;
  }

  public getSensorExtension(): HalSensorExtension | null {
    return this.sensorExt;
  }

  public isNativeHost(): boolean {
    return Boolean(this.haptic.getNativeAdapter()?.isNativeApp?.());
  }

  public getPlatform(): 'web' | 'ios' | 'android' {
    return this.haptic.getNativeAdapter()?.getPlatform?.() ?? 'web';
  }

  public async setKeepAwake(enabled: boolean): Promise<boolean> {
    const adapter = this.haptic.getNativeAdapter();
    if (!adapter?.setKeepAwake) return false;
    try {
      return Boolean(await adapter.setKeepAwake(enabled));
    } catch {
      return false;
    }
  }

  public async requestFullscreenLock(landscape: boolean): Promise<boolean> {
    const adapter = this.haptic.getNativeAdapter();
    if (!adapter?.requestFullscreenLock) return false;
    try {
      return Boolean(await adapter.requestFullscreenLock(landscape));
    } catch {
      return false;
    }
  }

  public async shareImageDataUrl(dataUrl: string, filename: string, title?: string): Promise<boolean> {
    const adapter = this.haptic.getNativeAdapter();
    if (!adapter?.shareImageDataUrl) return false;
    try {
      return Boolean(await adapter.shareImageDataUrl(dataUrl, filename, title));
    } catch {
      return false;
    }
  }

  public destroy(): void {
    this.gripListeners.clear();
    this.hapticListeners.clear();
    this.sensorExt = null;
    this.haptic.setNativeAdapter(null);
    this.haptic.setCallbacks({});
    if (typeof window !== 'undefined' && window.__PIXEL_ATELIER_HAL__ === this) {
      delete window.__PIXEL_ATELIER_HAL__;
    }
  }
}
