import {
  PRESET_COOLDOWN_MS,
  TACTILE_SPECS,
  computeSidePan,
  type AudioSide,
  type SoundPreset,
  type TactilePhase,
  type TactileSwitchProfile,
} from '../../assets/AudioPatterns.ts';
import type { BgmTheme } from '../types/WorldTypes.ts';
import { AudioBus } from './AudioBus.ts';
import { BgmSequencer } from './BgmSequencer.ts';
import {
  playSynthIrisChord,
  playSynthPreset,
  playSynthTickVoice,
  type NoiseVoiceOptions,
  type SynthVoiceScheduler,
  type ToneVoiceOptions,
} from './SynthPresets.ts';

export type { AudioSide, SoundPreset, TactilePhase, TactileSwitchProfile } from '../../assets/AudioPatterns.ts';

/**
 * Multi-stage procedural Web Audio synthesizer & lookahead multi-track BGM sequencer.
 * Routes layered oscillators, FM chimes, sub-bass drops, and filtered pink/white noise
 * through stereo panning and a warm spatial delay/compressor bus.
 */
export class ToySynth implements SynthVoiceScheduler {
  private readonly bus = new AudioBus();
  private readonly bgm: BgmSequencer;
  private muted = false;
  private volume = 0.28;
  private jitterStep = 0;

  private pendingQueue = new Map<SoundPreset, { combo: number; side: AudioSide }>();
  private lastPlayedAt = new Map<SoundPreset, number>();
  private lastTactileAt = new Map<string, number>();

  private chargeOscMain: OscillatorNode | null = null;
  private chargeOscSub: OscillatorNode | null = null;
  private chargeFilter: BiquadFilterNode | null = null;
  private chargeGain: GainNode | null = null;
  private chargeReadyChimed = false;

  constructor() {
    this.bgm = new BgmSequencer(
      this,
      () => this.bus.ctx,
      () => this.muted,
    );
  }

  public unlock(): void {
    const ctx = this.bus.ensureUnlocked();
    if (ctx && ctx.state === 'running' && this.bgm.getTheme() && !this.muted) {
      this.bgm.ensureScheduler();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.muted) {
      this.stopCharge(false);
      this.bgm.clearScheduler();
    } else if (this.bgm.getTheme() && this.bus.ctx?.state === 'running') {
      this.bgm.ensureScheduler();
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public suspendForBackground(): void {
    this.stopCharge(false);
    this.bgm.clearScheduler();
    this.bus.suspendContext();
  }

  public resumeFromBackground(): void {
    if (!this.muted) {
      this.bus.resumeContext();
      if (this.bgm.getTheme() && this.bus.ctx) {
        this.bgm.ensureScheduler();
      }
    }
  }

  private nextPitchJitter(spread = 0.05): number {
    this.jitterStep = (this.jitterStep + 1) % 16;
    const hash = Math.sin(this.jitterStep * 12.9898) * 43758.5453;
    const frac = hash - Math.floor(hash);
    return 1 + (frac * 2 - 1) * spread;
  }

  /** Queue an event to deduplicate same-frame bursts cleanly before flushing. */
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

  public scheduleTone(opts: ToneVoiceOptions): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.bus.ctx ?? this.bus.ensureUnlocked();
    if (!ctx || ctx.state !== 'running') return;

    const start = (opts.atTime ?? ctx.currentTime) + (opts.delaySec ?? 0);
    const dur = Math.max(0.015, opts.durationSec);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    let filter: BiquadFilterNode | null = null;
    let modOsc: OscillatorNode | null = null;
    let modGain: GainNode | null = null;

    osc.type = opts.wave ?? 'triangle';
    const f0 = Math.max(28, opts.freqStart);
    const f1 = Math.max(28, opts.freqEnd);
    osc.frequency.setValueAtTime(f0, start);
    if (Math.abs(f1 - f0) > 0.1) {
      osc.frequency.exponentialRampToValueAtTime(f1, start + dur);
    }

    if (opts.fmRatio && opts.fmDepthHz) {
      modOsc = ctx.createOscillator();
      modGain = ctx.createGain();
      modOsc.type = 'sine';
      modOsc.frequency.setValueAtTime(f0 * opts.fmRatio, start);
      modGain.gain.setValueAtTime(opts.fmDepthHz, start);
      modGain.gain.exponentialRampToValueAtTime(1, start + dur);
      modOsc.connect(modGain);
      modGain.connect(osc.frequency);
      modOsc.start(start);
      modOsc.stop(start + dur + 0.02);
    }

    const attack = Math.min(dur * 0.4, opts.attackSec ?? 0.008);
    const peak = Math.max(0.001, this.volume * (opts.gainScale ?? 0.5));
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    if (opts.filterType && opts.filterStartHz) {
      filter = ctx.createBiquadFilter();
      filter.type = opts.filterType;
      const c0 = Math.max(40, opts.filterStartHz);
      const c1 = Math.max(40, opts.filterEndHz ?? c0);
      filter.frequency.setValueAtTime(c0, start);
      if (Math.abs(c1 - c0) > 1) {
        filter.frequency.exponentialRampToValueAtTime(c1, start + dur);
      }
      filter.Q.setValueAtTime(opts.filterQ ?? 1.2, start);
      osc.connect(filter);
      filter.connect(env);
    } else {
      osc.connect(env);
    }

    const routed = this.bus.routeVoice(env, opts.pan ?? 0, opts.fxSend ?? 0, opts.isBgm ?? false);
    osc.onended = () => {
      try {
        osc.disconnect();
        modOsc?.disconnect();
        modGain?.disconnect();
        filter?.disconnect();
        env.disconnect();
        routed?.disconnect();
      } catch {
        // Ignore teardown disconnects
      }
    };
    osc.start(start);
    osc.stop(start + dur + 0.025);
  }

  public scheduleNoise(opts: NoiseVoiceOptions): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.bus.ctx ?? this.bus.ensureUnlocked();
    const buf = opts.pink ? this.bus.pinkNoiseBuffer : this.bus.whiteNoiseBuffer;
    if (!ctx || !buf || ctx.state !== 'running') return;

    const start = (opts.atTime ?? ctx.currentTime) + (opts.delaySec ?? 0);
    const dur = Math.max(0.01, opts.durationSec);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType ?? 'bandpass';
    const c0 = Math.max(40, opts.filterStartHz ?? 1600);
    const c1 = Math.max(40, opts.filterEndHz ?? c0);
    filter.frequency.setValueAtTime(c0, start);
    if (Math.abs(c1 - c0) > 1) {
      filter.frequency.exponentialRampToValueAtTime(c1, start + dur);
    }
    filter.Q.setValueAtTime(opts.filterQ ?? 1.4, start);

    const env = ctx.createGain();
    const attack = Math.min(dur * 0.3, opts.attackSec ?? 0.003);
    const peak = Math.max(0.001, this.volume * (opts.gainScale ?? 0.4));
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    src.connect(filter);
    filter.connect(env);
    const routed = this.bus.routeVoice(env, opts.pan ?? 0, opts.fxSend ?? 0, opts.isBgm ?? false);

    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        env.disconnect();
        routed?.disconnect();
      } catch {
        // Ignore teardown disconnects
      }
    };
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  public playPreset(preset: SoundPreset, comboIndex = 0, side: AudioSide = 'both'): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.bus.ensureUnlocked();
    if (!ctx || ctx.state !== 'running') return;
    playSynthPreset(this, preset, comboIndex, side, this.nextPitchJitter(0.045));
  }

  public playTick(freqHz: number, pan = 0, gainScale = 0.24): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.bus.ensureUnlocked();
    if (!ctx || ctx.state !== 'running') return;
    playSynthTickVoice(this, freqHz, pan, gainScale);
  }

  public playIrisChord(direction: 'in' | 'out'): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.bus.ensureUnlocked();
    if (!ctx || ctx.state !== 'running') return;
    playSynthIrisChord(this, direction);
  }

  public setBgmMuffled(muffled: boolean): void {
    this.bus.setBgmMuffled(muffled);
  }

  /** Stereo two-stage mechanical/rubber-dome switch acoustics with L/R spatial panning. */
  public playTactile(
    profile: TactileSwitchProfile,
    phase: TactilePhase = 'down',
    side: AudioSide = 'both',
  ): void {
    if (this.muted || typeof window === 'undefined') return;
    const ctx = this.bus.ensureUnlocked();
    if (!ctx || ctx.state !== 'running') return;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const key = `${profile}:${phase}:${side}`;
    const last = this.lastTactileAt.get(key) ?? -Infinity;
    if (nowMs - last < 12) return;
    this.lastTactileAt.set(key, nowMs);

    const spec = TACTILE_SPECS[profile][phase];
    const jit = this.nextPitchJitter(0.04);
    const pan = computeSidePan(side);

    this.scheduleNoise({
      durationSec: spec.clickMs / 1000,
      pink: false,
      gainScale: spec.noiseGain * 1.15,
      attackSec: 0.0012,
      filterType: 'bandpass',
      filterStartHz: spec.filterHz * jit,
      filterQ: spec.q,
      pan,
    });

    this.scheduleTone({
      freqStart: spec.thumpStartHz * jit,
      freqEnd: Math.max(35, spec.thumpEndHz),
      durationSec: spec.thumpMs / 1000,
      wave: spec.thumpWave,
      gainScale: spec.thumpGain * 1.15,
      attackSec: 0.0015,
      pan,
    });
  }

  public startCharge(): void {
    if (this.muted || typeof window === 'undefined' || this.chargeOscMain) return;
    const ctx = this.bus.ensureUnlocked();
    if (!ctx || ctx.state !== 'running') return;

    const oscMain = ctx.createOscillator();
    const oscSub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const now = ctx.currentTime;

    oscMain.type = 'sawtooth';
    oscMain.frequency.setValueAtTime(115, now);

    oscSub.type = 'triangle';
    oscSub.frequency.setValueAtTime(57.5, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, now);
    filter.Q.setValueAtTime(3.8, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(0.002, this.volume * 0.28), now + 0.05);

    oscMain.connect(filter);
    oscSub.connect(filter);
    filter.connect(gain);
    this.bus.routeVoice(gain, 0, 0.18);

    oscMain.start(now);
    oscSub.start(now);

    this.chargeOscMain = oscMain;
    this.chargeOscSub = oscSub;
    this.chargeFilter = filter;
    this.chargeGain = gain;
    this.chargeReadyChimed = false;
  }

  public updateCharge(progress01: number): void {
    const p = Math.max(0, Math.min(1, progress01));
    if (this.muted || p <= 0) {
      this.stopCharge(false);
      return;
    }
    if (!this.chargeOscMain) {
      this.startCharge();
    }
    const ctx = this.bus.ctx;
    if (!this.chargeOscMain || !this.chargeOscSub || !this.chargeFilter || !ctx || ctx.state !== 'running') {
      return;
    }
    const now = ctx.currentTime;
    const mainHz = 115 + p * 460;
    this.chargeOscMain.frequency.setTargetAtTime(mainHz, now, 0.025);
    this.chargeOscSub.frequency.setTargetAtTime(mainHz * 0.5, now, 0.025);
    this.chargeFilter.frequency.setTargetAtTime(320 + p * 2500, now, 0.025);
    if (p >= 0.98 && !this.chargeReadyChimed) {
      this.chargeReadyChimed = true;
      this.scheduleTone({
        freqStart: 880,
        freqEnd: 1320,
        durationSec: 0.09,
        wave: 'sine',
        gainScale: 0.34,
        fxSend: 0.25,
      });
    }
  }

  public stopCharge(chimeOnRelease = false): void {
    const oscMain = this.chargeOscMain;
    const oscSub = this.chargeOscSub;
    const filter = this.chargeFilter;
    const gain = this.chargeGain;
    this.chargeOscMain = null;
    this.chargeOscSub = null;
    this.chargeFilter = null;
    this.chargeGain = null;
    this.chargeReadyChimed = false;

    const ctx = this.bus.ctx;
    if (oscMain && gain && ctx) {
      const now = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.015);
        oscMain.onended = () => {
          try {
            oscMain.disconnect();
            oscSub?.disconnect();
            filter?.disconnect();
            gain.disconnect();
          } catch {
            // Ignore audio node disconnect errors during teardown
          }
        };
        oscMain.stop(now + 0.06);
        oscSub?.stop(now + 0.06);
      } catch {
        // Ignore already-stopped oscillator errors
      }
    }

    if (chimeOnRelease && !this.muted) {
      this.scheduleTone({
        freqStart: 880,
        freqEnd: 1175,
        durationSec: 0.08,
        wave: 'sine',
        gainScale: 0.36,
        fxSend: 0.25,
      });
    }
  }

  public setBgmTheme(theme: BgmTheme | null): void {
    if (theme === null) {
      this.stopCharge(false);
    }
    this.bgm.setTheme(theme);
  }

  /** Keeps compatibility with EngineHost's frame loop: advances/monitors lookahead window. */
  public tickBgm(_dt: number): void {
    this.bgm.tick();
  }

  public getBgmDiagnostics(): {
    theme: BgmTheme | null;
    step: number;
    schedulerActive: boolean;
  } {
    return this.bgm.getDiagnostics();
  }

  public destroy(): void {
    this.stopCharge(false);
    this.bgm.reset();
    this.pendingQueue.clear();
    this.lastPlayedAt.clear();
    this.lastTactileAt.clear();
    this.bus.destroy();
  }
}
