import {
  BGM_ARRANGEMENTS,
  computeSwungStepDuration,
  midiToFreq,
} from '../../assets/AudioPatterns.ts';
import type { BgmTheme } from '../types/WorldTypes.ts';
import type { SynthVoiceScheduler } from './SynthPresets.ts';

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.12;

export class BgmSequencer {
  private readonly scheduler: SynthVoiceScheduler;
  private readonly getAudioContext: () => AudioContext | null;
  private readonly isMuted: () => boolean;

  private theme: BgmTheme | null = null;
  private step = 0;
  private nextTimeSec = 0;
  private intervalId: number | null = null;

  constructor(
    scheduler: SynthVoiceScheduler,
    getAudioContext: () => AudioContext | null,
    isMuted: () => boolean,
  ) {
    this.scheduler = scheduler;
    this.getAudioContext = getAudioContext;
    this.isMuted = isMuted;
  }

  public setTheme(theme: BgmTheme | null): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.step = 0;
    this.nextTimeSec = 0;
    const ctx = this.getAudioContext();
    if (theme && !this.isMuted() && ctx?.state === 'running') {
      this.ensureScheduler();
    } else {
      this.clearScheduler();
    }
  }

  public getTheme(): BgmTheme | null {
    return this.theme;
  }

  public ensureScheduler(): void {
    if (typeof window === 'undefined' || this.intervalId !== null) return;
    const ctx = this.getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    this.nextTimeSec = Math.max(this.nextTimeSec, ctx.currentTime + 0.02);
    this.scheduleWindow();
    this.intervalId = window.setInterval(() => {
      this.scheduleWindow();
    }, LOOKAHEAD_MS);
  }

  public clearScheduler(): void {
    if (this.intervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private scheduleStep(theme: BgmTheme, stepIdx: number, when: number): void {
    const arr = BGM_ARRANGEMENTS[theme];
    const len = arr.lead.length;
    const idx = stepIdx % len;
    const stepDur = computeSwungStepDuration(idx, arr.stepSec, arr.swingRatio);

    const leadMidi = arr.lead[idx];
    if (leadMidi > 0) {
      const freq = midiToFreq(leadMidi);
      this.scheduler.scheduleTone({
        freqStart: freq,
        freqEnd: freq,
        durationSec: stepDur * 0.86,
        atTime: when,
        wave: arr.leadWave,
        gainScale: arr.leadGain,
        attackSec: 0.012,
        filterType: 'lowpass',
        filterStartHz: arr.leadCutoffHz,
        filterEndHz: arr.leadCutoffHz * 0.62,
        filterQ: arr.leadQ,
        pan: idx % 4 < 2 ? -0.1 : 0.1,
        fxSend: 0.22,
        isBgm: true,
      });
    }

    const bassMidi = arr.bass[idx];
    if (bassMidi > 0) {
      const bFreq = midiToFreq(bassMidi);
      this.scheduler.scheduleTone({
        freqStart: bFreq,
        freqEnd: bFreq,
        durationSec: stepDur * 0.92,
        atTime: when,
        wave: 'triangle',
        gainScale: arr.bassGain,
        attackSec: 0.008,
        filterType: 'lowpass',
        filterStartHz: 720,
        filterEndHz: 420,
        filterQ: 1.0,
        pan: 0,
        isBgm: true,
      });
    }

    const chord = arr.chords[idx];
    if (chord && chord.length > 0) {
      for (let i = 0; i < chord.length; i++) {
        const cf = midiToFreq(chord[i]);
        this.scheduler.scheduleTone({
          freqStart: cf,
          freqEnd: cf,
          durationSec: stepDur * 2.2,
          atTime: when + i * 0.012,
          wave: 'sine',
          gainScale: arr.padGain,
          attackSec: 0.025,
          pan: (i - 1) * 0.22,
          fxSend: 0.28,
          isBgm: true,
        });
      }
    }

    const kickVel = arr.kick[idx] ?? 0;
    if (kickVel > 0) {
      this.scheduler.scheduleTone({
        freqStart: 126,
        freqEnd: 44,
        durationSec: 0.13,
        atTime: when,
        wave: 'sine',
        gainScale: 0.34 * kickVel,
        attackSec: 0.003,
        pan: 0,
        isBgm: true,
      });
    }

    const snareVel = arr.snare[idx] ?? 0;
    if (snareVel > 0) {
      this.scheduler.scheduleTone({
        freqStart: 192,
        freqEnd: 112,
        durationSec: 0.075,
        atTime: when,
        wave: 'triangle',
        gainScale: 0.14 * snareVel,
        attackSec: 0.002,
        isBgm: true,
      });
      this.scheduler.scheduleNoise({
        durationSec: 0.105,
        atTime: when,
        pink: true,
        gainScale: 0.2 * snareVel,
        attackSec: 0.002,
        filterType: 'bandpass',
        filterStartHz: 1850,
        filterEndHz: 980,
        filterQ: 1.2,
        fxSend: 0.14,
        isBgm: true,
      });
    }

    const hatVel = arr.hat[idx] ?? 0;
    if (hatVel > 0) {
      this.scheduler.scheduleNoise({
        durationSec: 0.036,
        atTime: when,
        pink: false,
        gainScale: 0.11 * hatVel,
        attackSec: 0.001,
        filterType: 'highpass',
        filterStartHz: 6400,
        filterQ: 1.1,
        pan: idx % 2 === 0 ? -0.18 : 0.18,
        isBgm: true,
      });
    }
  }

  public scheduleWindow(): void {
    if (this.isMuted() || !this.theme || typeof window === 'undefined') return;
    const ctx = this.getAudioContext();
    if (!ctx || ctx.state !== 'running') return;

    const arr = BGM_ARRANGEMENTS[this.theme];
    if (this.nextTimeSec < ctx.currentTime - 0.15) {
      this.nextTimeSec = ctx.currentTime + 0.015;
    }

    let guard = 0;
    while (this.nextTimeSec < ctx.currentTime + SCHEDULE_AHEAD_SEC && guard < 16) {
      const idx = this.step % arr.lead.length;
      this.scheduleStep(this.theme, idx, this.nextTimeSec);
      this.nextTimeSec += computeSwungStepDuration(idx, arr.stepSec, arr.swingRatio);
      this.step = (this.step + 1) % arr.lead.length;
      guard++;
    }
  }

  public tick(): void {
    if (this.isMuted() || !this.theme || typeof window === 'undefined') return;
    const ctx = this.getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    this.ensureScheduler();
    this.scheduleWindow();
  }

  public getDiagnostics(): {
    theme: BgmTheme | null;
    step: number;
    schedulerActive: boolean;
  } {
    return {
      theme: this.theme,
      step: this.step,
      schedulerActive: this.intervalId !== null,
    };
  }

  public reset(): void {
    this.clearScheduler();
    this.theme = null;
    this.step = 0;
    this.nextTimeSec = 0;
  }
}
