import type { BgmTheme } from '../types/WorldTypes.ts';

export type SoundPreset =
  | 'jump'
  | 'star'
  | 'stomp'
  | 'hurt'
  | 'laser'
  | 'key'
  | 'win'
  | 'bounce'
  | 'explode'
  | 'ignite'
  | 'snap'
  | 'charge'
  | 'rail';

export type TactileSwitchProfile = 'face' | 'dpad' | 'bumper' | 'system' | 'ui' | 'stick';
export type TactilePhase = 'down' | 'up';
export type AudioSide = 'left' | 'right' | 'both';

export interface ExternalAudioManifest {
  /** Base CDN URL prepended to relative entries (e.g. "https://cdn.pixer.app/audio/pack-v1/"). */
  baseUrl?: string;
  /** External BGM streaming track URLs (recommended: OGG Opus / MP3). */
  bgm?: Partial<Record<BgmTheme, string>>;
  /** External SFX sample URLs decoded into Web Audio AudioBuffer LRU cache. */
  sfx?: Partial<Record<SoundPreset, string>>;
  /** Optional external UI tactile switch samples. */
  tactile?: Partial<Record<TactileSwitchProfile, string>>;
}

const PRESET_COOLDOWN_MS: Record<SoundPreset, number> = {
  jump: 45,
  star: 32,
  stomp: 45,
  hurt: 90,
  laser: 38,
  key: 90,
  win: 180,
  bounce: 48,
  explode: 65,
  ignite: 65,
  snap: 36,
  charge: 120,
  rail: 60,
};

const MAX_CACHED_BUFFERS = 64;

export function isSafeAudioUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  if (trimmed.startsWith('./') || trimmed.startsWith('/')) {
    return !trimmed.startsWith('//') && !trimmed.includes('..');
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function resolveManifestUrl(entry: string | undefined, baseUrl?: string): string | null {
  if (!entry) return null;
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const full =
    baseUrl && !/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('/')
      ? `${baseUrl.replace(/\/+$/, '')}/${trimmed.replace(/^\.\//, '')}`
      : trimmed;
  return isSafeAudioUrl(full) ? full : null;
}

function computeSidePan(side: AudioSide): number {
  if (side === 'left') return -0.45;
  if (side === 'right') return 0.45;
  return 0;
}

/**
 * Lean External Audio Asset Adapter (Zero AI Procedural Synthesis).
 *
 * - Plays real external audio assets (OGG Opus / MP3 / M4A) hosted on CDN/R2 via declarative `ExternalAudioManifest`.
 * - Short SFX are fetched on demand into a bounded LRU `AudioBuffer` cache (`MAX_CACHED_BUFFERS = 64`).
 * - Long BGM tracks stream via `HTMLAudioElement` with master volume & pause-muffle ducking.
 * - Degrades silently (zero errors, zero synthetic beeps) when offline or when no manifest is bound.
 */
export class ExternalAudioBank {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmAudio: HTMLAudioElement | null = null;
  private activeBgmTheme: BgmTheme | null = null;
  private activeBgmUrl: string | null = null;
  private bgmMuffled = false;

  private manifest: ExternalAudioManifest = {};
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly inflightLoads = new Map<string, Promise<AudioBuffer | null>>();

  private muted = false;
  private volume = 0.72;

  private readonly pendingQueue = new Map<SoundPreset, { combo: number; side: AudioSide }>();
  private readonly lastPlayedAt = new Map<SoundPreset, number>();

  public loadManifest(next: ExternalAudioManifest): void {
    this.manifest = {
      baseUrl: next.baseUrl && isSafeAudioUrl(next.baseUrl) ? next.baseUrl : undefined,
      bgm: next.bgm ? { ...next.bgm } : undefined,
      sfx: next.sfx ? { ...next.sfx } : undefined,
      tactile: next.tactile ? { ...next.tactile } : undefined,
    };
    if (this.activeBgmTheme) {
      const current = this.activeBgmTheme;
      this.activeBgmTheme = null;
      this.setBgmTheme(current);
    }
  }

  public clearManifest(): void {
    this.manifest = {};
    this.stopBgmElement();
    this.bufferCache.clear();
  }

  public getManifest(): Readonly<ExternalAudioManifest> {
    return this.manifest;
  }

  public setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.72));
    this.syncGainLevels();
  }

  public getVolume(): number {
    return this.volume;
  }

  public unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    if (this.bgmAudio && !this.muted && this.activeBgmTheme && this.bgmAudio.paused) {
      void this.bgmAudio.play().catch(() => {});
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncGainLevels();
    if (this.bgmAudio) {
      if (this.muted) {
        this.bgmAudio.pause();
      } else if (this.activeBgmTheme) {
        void this.bgmAudio.play().catch(() => {});
      }
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public suspendForBackground(): void {
    if (this.bgmAudio && !this.bgmAudio.paused) {
      this.bgmAudio.pause();
    }
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  public resumeFromBackground(): void {
    if (this.muted) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    if (this.bgmAudio && this.activeBgmTheme && this.bgmAudio.paused) {
      void this.bgmAudio.play().catch(() => {});
    }
  }

  public queueEvent(preset: SoundPreset, comboIndex = 0, side: AudioSide = 'both'): void {
    const prev = this.pendingQueue.get(preset);
    if (!prev || comboIndex >= prev.combo) {
      this.pendingQueue.set(preset, { combo: comboIndex, side });
    }
  }

  public flushQueue(): void {
    if (this.pendingQueue.size === 0) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const [preset, entry] of this.pendingQueue.entries()) {
      const last = this.lastPlayedAt.get(preset) ?? -Infinity;
      if (now - last >= PRESET_COOLDOWN_MS[preset]) {
        this.lastPlayedAt.set(preset, now);
        this.playPreset(preset, entry.combo, entry.side);
      }
    }
    this.pendingQueue.clear();
  }

  public preloadSfx(preset: SoundPreset): Promise<boolean> {
    const url = resolveManifestUrl(this.manifest.sfx?.[preset], this.manifest.baseUrl);
    if (!url) return Promise.resolve(false);
    return this.fetchAndDecode(url).then((buf) => buf !== null);
  }

  public playPreset(preset: SoundPreset, comboIndex = 0, side: AudioSide = 'both'): void {
    if (this.muted) return;
    const url = resolveManifestUrl(this.manifest.sfx?.[preset], this.manifest.baseUrl);
    if (!url) return;
    const playbackRate = comboIndex > 0 ? Math.min(1.45, 1 + comboIndex * 0.04) : 1;
    this.playBufferUrl(url, side, playbackRate, 1);
  }

  public playTactile(
    profile: TactileSwitchProfile,
    phase: TactilePhase = 'down',
    side: AudioSide = 'both',
  ): void {
    if (this.muted || phase !== 'down') return;
    const url = resolveManifestUrl(this.manifest.tactile?.[profile], this.manifest.baseUrl);
    if (!url) return;
    this.playBufferUrl(url, side, 1, 0.7);
  }

  public playTick(_freqHz = 880, _pan = 0, _gainScale = 0.25): void {
    // Intentionally silent without external tactile sample — zero synthetic oscillator beeps.
  }

  public playIrisChord(_direction: 'in' | 'out'): void {
    // Intentionally silent without external transition sample — zero synthetic chords.
  }

  public updateCharge(_level: number): void {
    // No procedural oscillator ramp; external charge cues may use playPreset('charge').
  }

  public stopCharge(_fire = false): void {
    // No-op when procedural oscillator synthesis is disabled.
  }

  public setBgmTheme(theme: BgmTheme | null): void {
    if (this.activeBgmTheme === theme) return;
    this.activeBgmTheme = theme;
    if (!theme) {
      this.stopBgmElement();
      return;
    }
    const url = resolveManifestUrl(this.manifest.bgm?.[theme], this.manifest.baseUrl);
    if (!url || typeof Audio === 'undefined') {
      this.stopBgmElement();
      return;
    }
    if (this.activeBgmUrl === url && this.bgmAudio) {
      if (!this.muted && this.bgmAudio.paused) {
        void this.bgmAudio.play().catch(() => {});
      }
      return;
    }
    this.stopBgmElement();
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    audio.loop = true;
    audio.preload = 'auto';
    this.bgmAudio = audio;
    this.activeBgmUrl = url;
    this.syncGainLevels();
    if (!this.muted) {
      void audio.play().catch(() => {});
    }
  }

  public setBgmMuffled(muffled: boolean): void {
    if (this.bgmMuffled === muffled) return;
    this.bgmMuffled = muffled;
    this.syncGainLevels();
  }

  public tickBgm(_dt: number): void {
    // Streaming HTMLAudioElement manages its own clock; zero JS lookahead scheduler overhead.
  }

  public getBgmDiagnostics(): {
    theme: BgmTheme | null;
    schedulerActive: boolean;
    muffled: boolean;
    activeUrl: string | null;
    cachedSfxCount: number;
  } {
    return {
      theme: this.activeBgmTheme,
      schedulerActive: Boolean(this.bgmAudio && !this.bgmAudio.paused),
      muffled: this.bgmMuffled,
      activeUrl: this.activeBgmUrl,
      cachedSfxCount: this.bufferCache.size,
    };
  }

  public destroy(): void {
    this.pendingQueue.clear();
    this.lastPlayedAt.clear();
    this.activeBgmTheme = null;
    this.stopBgmElement();
    this.bufferCache.clear();
    this.inflightLoads.clear();
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // ignore disconnect races
      }
      this.masterGain = null;
    }
    if (this.ctx) {
      const closing = this.ctx;
      this.ctx = null;
      void closing.close().catch(() => {});
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const AudioCtxCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxCtor) return null;
    try {
      const ctx = new AudioCtxCtor();
      const gain = ctx.createGain();
      gain.gain.value = this.muted ? 0 : this.volume;
      gain.connect(ctx.destination);
      this.ctx = ctx;
      this.masterGain = gain;
      return ctx;
    } catch {
      return null;
    }
  }

  private syncGainLevels(): void {
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.muted ? 0 : this.volume * (this.bgmMuffled ? 0.35 : 0.65);
    }
  }

  private stopBgmElement(): void {
    if (this.bgmAudio) {
      try {
        this.bgmAudio.pause();
        this.bgmAudio.src = '';
        this.bgmAudio.load();
      } catch {
        // ignore teardown errors
      }
      this.bgmAudio = null;
    }
    this.activeBgmUrl = null;
  }

  private playBufferUrl(url: string, side: AudioSide, playbackRate: number, gainScale: number): void {
    const cached = this.bufferCache.get(url);
    if (cached) {
      // Touch LRU order
      this.bufferCache.delete(url);
      this.bufferCache.set(url, cached);
      this.triggerDecodedBuffer(cached, side, playbackRate, gainScale);
      return;
    }
    void this.fetchAndDecode(url).then((buf) => {
      if (buf && !this.muted) {
        this.triggerDecodedBuffer(buf, side, playbackRate, gainScale);
      }
    });
  }

  private triggerDecodedBuffer(
    buffer: AudioBuffer,
    side: AudioSide,
    playbackRate: number,
    gainScale: number,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = playbackRate;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = gainScale;

    if (typeof ctx.createStereoPanner === 'function' && side !== 'both') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = computeSidePan(side);
      src.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(this.masterGain);
    } else {
      src.connect(voiceGain);
      voiceGain.connect(this.masterGain);
    }
    src.start();
  }

  private fetchAndDecode(url: string): Promise<AudioBuffer | null> {
    const existing = this.inflightLoads.get(url);
    if (existing) return existing;
    if (typeof fetch !== 'function') return Promise.resolve(null);
    const ctx = this.ensureContext();
    if (!ctx) return Promise.resolve(null);

    const task = fetch(url)
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((ab) => (ab ? ctx.decodeAudioData(ab.slice(0)) : null))
      .then((decoded) => {
        if (decoded) {
          if (this.bufferCache.size >= MAX_CACHED_BUFFERS) {
            const oldestKey = this.bufferCache.keys().next().value;
            if (oldestKey !== undefined) this.bufferCache.delete(oldestKey);
          }
          this.bufferCache.set(url, decoded);
        }
        return decoded;
      })
      .catch(() => null)
      .finally(() => {
        this.inflightLoads.delete(url);
      });

    this.inflightLoads.set(url, task);
    return task;
  }
}
