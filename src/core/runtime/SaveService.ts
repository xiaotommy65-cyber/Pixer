import { normalizePerformanceProfile, type RenderPerformanceProfile } from '../gpu/GpuTypes.ts';
import type { HapticLevel } from '../hal/HapticEngine.ts';
import { type ErgonomicGripMode, normalizeGripMode, normalizeHapticLevel } from '../hal/SystemHal.ts';
import type { StickCurveMode } from '../input/InputPipeline.ts';
import type { CartridgeJsonV1 } from '../sim/CartridgeSchema.ts';
import type { CartridgeId, RenderSceneSnapshot, ScreenFilterMode } from '../types/WorldTypes.ts';
import { appLogger } from './AppLogger.ts';

export interface CardRecord {
  bestScore: number;
  bestStars: number;
  starsTotal: number;
}

export const MAX_CUSTOM_CARTRIDGES = 16;

const RECORDS_KEY = 'pixel-atelier-records-v1';
const SRAM_KEY = 'pixel-atelier-sram-v1';
const CUSTOM_CARTRIDGES_KEY = 'pixel-atelier-custom-cartridges-v1';
const SHELL_KEY = 'pixel-atelier-shell-v1';
const HERO_KEY = 'pixel-atelier-hero-v1';
const GRIP_KEY = 'pixel-atelier-grip-v1';
const HAPTIC_KEY = 'pixel-atelier-haptic-v1';
const AUTOFIRE_KEY = 'pixel-atelier-autofire-v1';
const DPAD_MODE_KEY = 'pixel-atelier-dpad-mode-v1';
const STICK_CURVE_KEY = 'pixel-atelier-stick-curve-v1';
const STICK_ORIGIN_KEY = 'pixel-atelier-stick-origin-v1';
const SCREEN_FILTER_KEY = 'pixel-atelier-screen-filter-v1';
const PERF_PROFILE_KEY = 'pixel-atelier-perf-profile-v1';

export interface CartridgeSramEnvelope {
  version: 1;
  updatedAt: number;
  stageName?: string;
  data: unknown;
}

export interface CustomCartridgeEntry {
  id: string;
  updatedAt: number;
  cartridge: CartridgeJsonV1;
}

export interface HeroSpriteSave {
  a?: number[];
  b?: number[];
}

/**
 * Persistence boundary for player records, per-cartridge SRAM checkpoints, custom hero frames, and console preferences.
 * Guards every storage read/write and JSON parse/stringify with defensive fallback to an in-memory map.
 */
export class SaveService {
  private readonly memFallback = new Map<string, string>();
  private readonly lastLoggedSramStage = new Map<CartridgeId, string>();
  private records: Partial<Record<CartridgeId, CardRecord>>;
  private sram: Partial<Record<CartridgeId, CartridgeSramEnvelope>>;
  private customCartridges: Record<string, CustomCartridgeEntry>;

  constructor() {
    this.records = this.readJson<Partial<Record<CartridgeId, CardRecord>>>(RECORDS_KEY) ?? {};
    this.sram = this.readJson<Partial<Record<CartridgeId, CartridgeSramEnvelope>>>(SRAM_KEY) ?? {};
    this.customCartridges = this.readJson<Record<string, CustomCartridgeEntry>>(CUSTOM_CARTRIDGES_KEY) ?? {};
  }

  private readRaw(key: string): string | null {
    if (typeof localStorage === 'undefined') return this.memFallback.get(key) ?? null;
    try {
      return localStorage.getItem(key) ?? this.memFallback.get(key) ?? null;
    } catch (err) {
      // Browsers in strict privacy mode or sandboxed iframes can throw SecurityError on storage access.
      appLogger.warn('storage', 'save.readRaw', `讀取本機儲存失敗 (${key})，改用記憶體快取`, err, { key });
      return this.memFallback.get(key) ?? null;
    }
  }

  private writeRaw(key: string, value: string): boolean {
    // Always update the in-memory mirror first so current-session state survives quota failures.
    this.memFallback.set(key, value);
    if (typeof localStorage === 'undefined') return true;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      appLogger.warn('storage', 'save.writeRaw', `寫入本機儲存失敗 (${key})，暫存於記憶體`, err, {
        key,
        bytes: value.length,
      });
      return false;
    }
  }

  private readJson<T>(key: string): T | null {
    const raw = this.readRaw(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      // Corrupted JSON must never prevent boot; warn with byte length and treat as empty state.
      appLogger.error('parsing', 'save.parseJson', `存檔 JSON 解析損毀 (${key})，已安全重置該欄位`, err, {
        key,
        rawLength: raw.length,
      });
      return null;
    }
  }

  private writeJson(key: string, payload: unknown): boolean {
    try {
      const serialized = JSON.stringify(payload);
      return this.writeRaw(key, serialized);
    } catch (err) {
      appLogger.error('parsing', 'save.stringifyJson', `存檔 JSON 序列化失敗 (${key})`, err, { key });
      return false;
    }
  }

  public getRecord(id: CartridgeId): CardRecord | undefined {
    return this.records[id];
  }

  public getAllRecords(): Partial<Record<CartridgeId, CardRecord>> {
    return { ...this.records };
  }

  public hasCartridgeSram(id: CartridgeId): boolean {
    const entry = this.sram[id];
    return Boolean(entry && entry.version === 1 && entry.data !== undefined);
  }

  public getCartridgeSram(id: CartridgeId): CartridgeSramEnvelope | undefined {
    const entry = this.sram[id];
    if (!entry || entry.version !== 1) return undefined;
    return entry;
  }

  public saveCartridgeSram(id: CartridgeId, data: unknown, stageName?: string): void {
    if (data === undefined || data === null) return;
    this.sram[id] = {
      version: 1,
      updatedAt: Date.now(),
      stageName,
      data,
    };
    const ok = this.writeJson(SRAM_KEY, this.sram);
    // Log milestone SRAM saves (initial save or stage progression) without flooding 4s periodic autosaves.
    const stageMarker = stageName ?? 'checkpoint';
    if (ok && this.lastLoggedSramStage.get(id) !== stageMarker) {
      this.lastLoggedSramStage.set(id, stageMarker);
      appLogger.success('storage', 'save.writeSram', `已儲存卡匣 SRAM 存檔 (${id})`, {
        cartridgeId: id,
        stageName: stageMarker,
      });
    }
  }

  public clearCartridgeSram(id: CartridgeId): void {
    if (!this.sram[id]) return;
    delete this.sram[id];
    this.lastLoggedSramStage.delete(id);
    if (this.writeJson(SRAM_KEY, this.sram)) {
      appLogger.info('storage', 'save.clearSram', `已清除卡匣 SRAM 存檔 (${id})`, { cartridgeId: id });
    }
  }

  /**
   * Updates stored high score / star count when beaten; returns true if changed.
   */
  public recordProgress(id: CartridgeId, snap: RenderSceneSnapshot): boolean {
    const score = Number.isFinite(snap.score) ? snap.score : 0;
    const stars = Number.isFinite(snap.starsCollected) ? snap.starsCollected : 0;
    const starsTotal = Number.isFinite(snap.starsTotal) ? snap.starsTotal : 0;
    const prev = this.records[id];
    if (
      prev &&
      score <= prev.bestScore &&
      stars <= prev.bestStars &&
      starsTotal <= prev.starsTotal
    ) {
      return false;
    }
    const next: CardRecord = {
      bestScore: Math.max(prev?.bestScore ?? 0, score),
      bestStars: Math.max(prev?.bestStars ?? 0, stars),
      starsTotal: Math.max(prev?.starsTotal ?? 0, starsTotal),
    };
    this.records[id] = next;
    if (this.writeJson(RECORDS_KEY, this.records)) {
      appLogger.success('storage', 'save.recordProgress', `已刷新卡匣最佳紀錄 (${id})`, {
        cartridgeId: id,
        bestScore: next.bestScore,
        bestStars: next.bestStars,
      });
    }
    return true;
  }

  public getShellTheme(fallback = 'mint'): string {
    return this.readRaw(SHELL_KEY) ?? fallback;
  }

  public saveShellTheme(theme: string): void {
    this.writeRaw(SHELL_KEY, theme);
  }

  public getHeroSprites(): HeroSpriteSave | null {
    return this.readJson<HeroSpriteSave>(HERO_KEY);
  }

  public saveHeroSprites(a: Uint8Array, b: Uint8Array): void {
    if (this.writeJson(HERO_KEY, { a: Array.from(a), b: Array.from(b) })) {
      appLogger.success('storage', 'save.heroSprites', '已儲存自訂主角像素雙幀造型', {
        frameABytes: a.byteLength,
        frameBBytes: b.byteLength,
      });
    }
  }

  public getErgonomicGrip(fallback: ErgonomicGripMode = 'both'): ErgonomicGripMode {
    const raw = this.readRaw(GRIP_KEY);
    if (!raw) return fallback;
    return normalizeGripMode(raw);
  }

  public saveErgonomicGrip(mode: ErgonomicGripMode): void {
    this.writeRaw(GRIP_KEY, mode);
  }

  public getHapticLevel(fallback: HapticLevel = 'full'): HapticLevel {
    const raw = this.readRaw(HAPTIC_KEY);
    if (!raw) return fallback;
    return normalizeHapticLevel(raw);
  }

  public saveHapticLevel(level: HapticLevel): void {
    this.writeRaw(HAPTIC_KEY, level);
  }

  public getTouchAutofire(fallback = false): boolean {
    const raw = this.readRaw(AUTOFIRE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return fallback;
  }

  public saveTouchAutofire(enabled: boolean): void {
    this.writeRaw(AUTOFIRE_KEY, enabled ? '1' : '0');
  }

  public getDpadDeadzone(fallback: 'standard' | 'tight' = 'standard'): 'standard' | 'tight' {
    const raw = this.readRaw(DPAD_MODE_KEY);
    return raw === 'tight' || raw === 'standard' ? raw : fallback;
  }

  public saveDpadDeadzone(mode: 'standard' | 'tight'): void {
    this.writeRaw(DPAD_MODE_KEY, mode);
  }

  public getStickCurveMode(fallback: StickCurveMode = 'standard'): StickCurveMode {
    const raw = this.readRaw(STICK_CURVE_KEY);
    return raw === 'precision' || raw === 'standard' ? raw : fallback;
  }

  public saveStickCurveMode(mode: StickCurveMode): void {
    this.writeRaw(STICK_CURVE_KEY, mode);
  }

  public getStickDynamicOrigin(fallback = true): boolean {
    const raw = this.readRaw(STICK_ORIGIN_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return fallback;
  }

  public saveStickDynamicOrigin(enabled: boolean): void {
    this.writeRaw(STICK_ORIGIN_KEY, enabled ? '1' : '0');
  }

  public getScreenFilter(fallback: ScreenFilterMode = 'clean'): ScreenFilterMode {
    const raw = this.readRaw(SCREEN_FILTER_KEY);
    return raw === 'clean' || raw === 'lcd' || raw === 'crt' ? raw : fallback;
  }

  public saveScreenFilter(mode: ScreenFilterMode): void {
    this.writeRaw(SCREEN_FILTER_KEY, mode);
  }

  public getPerformanceProfile(fallback: RenderPerformanceProfile = 'balanced'): RenderPerformanceProfile {
    const raw = this.readRaw(PERF_PROFILE_KEY);
    if (!raw) return fallback;
    return normalizePerformanceProfile(raw);
  }

  public savePerformanceProfile(profile: RenderPerformanceProfile): void {
    this.writeRaw(PERF_PROFILE_KEY, profile);
  }

  public listCustomCartridges(): CustomCartridgeEntry[] {
    return Object.values(this.customCartridges)
      .filter((entry) => Boolean(entry && typeof entry.id === 'string' && entry.cartridge))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getCustomCartridge(id: string): CustomCartridgeEntry | undefined {
    return this.customCartridges[id];
  }

  public saveCustomCartridge(
    id: string,
    cartridge: CartridgeJsonV1,
    overwrite = true,
  ): { ok: true; entry: CustomCartridgeEntry } | { ok: false; error: string } {
    const exists = Boolean(this.customCartridges[id]);
    if (exists && !overwrite) {
      return { ok: false, error: `自訂卡匣「${id}」已存在` };
    }
    if (!exists && Object.keys(this.customCartridges).length >= MAX_CUSTOM_CARTRIDGES) {
      return {
        ok: false,
        error: `已達自訂卡匣上限（${MAX_CUSTOM_CARTRIDGES} 張），請先於工坊刪除舊卡匣`,
      };
    }
    const entry: CustomCartridgeEntry = {
      id,
      updatedAt: Date.now(),
      cartridge,
    };
    const prev = this.customCartridges[id];
    this.customCartridges[id] = entry;
    if (!this.writeJson(CUSTOM_CARTRIDGES_KEY, this.customCartridges)) {
      if (prev) this.customCartridges[id] = prev;
      else delete this.customCartridges[id];
      return { ok: false, error: '瀏覽器本機空間不足，無法寫入自訂卡匣' };
    }
    appLogger.success('storage', 'save.customCartridge', `已儲存自訂卡匣 (${id})`, { cartridgeId: id });
    return { ok: true, entry };
  }

  public deleteCustomCartridge(id: string): boolean {
    if (!this.customCartridges[id]) return false;
    delete this.customCartridges[id];
    this.clearCartridgeSram(id);
    if (this.records[id]) {
      delete this.records[id];
      this.writeJson(RECORDS_KEY, this.records);
    }
    this.writeJson(CUSTOM_CARTRIDGES_KEY, this.customCartridges);
    appLogger.info('storage', 'save.deleteCustomCartridge', `已刪除自訂卡匣 (${id})`, { cartridgeId: id });
    return true;
  }
}
