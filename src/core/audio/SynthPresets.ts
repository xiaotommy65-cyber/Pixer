import {
  PENTATONIC_RATIOS,
  computeSidePan,
  type AudioSide,
  type SoundPreset,
} from '../../assets/AudioPatterns.ts';

export interface ToneVoiceOptions {
  freqStart: number;
  freqEnd: number;
  durationSec: number;
  atTime?: number;
  delaySec?: number;
  wave?: OscillatorType;
  gainScale?: number;
  attackSec?: number;
  filterType?: BiquadFilterType;
  filterStartHz?: number;
  filterEndHz?: number;
  filterQ?: number;
  pan?: number;
  fxSend?: number;
  fmRatio?: number;
  fmDepthHz?: number;
  isBgm?: boolean;
}

export interface NoiseVoiceOptions {
  durationSec: number;
  atTime?: number;
  delaySec?: number;
  pink?: boolean;
  gainScale?: number;
  attackSec?: number;
  filterType?: BiquadFilterType;
  filterStartHz?: number;
  filterEndHz?: number;
  filterQ?: number;
  pan?: number;
  fxSend?: number;
  isBgm?: boolean;
}

export interface SynthVoiceScheduler {
  scheduleTone(opts: ToneVoiceOptions): void;
  scheduleNoise(opts: NoiseVoiceOptions): void;
}

export function playSynthPreset(
  scheduler: SynthVoiceScheduler,
  preset: SoundPreset,
  comboIndex: number,
  side: AudioSide,
  jit: number,
): void {
  const ratio = PENTATONIC_RATIOS[Math.max(0, Math.min(PENTATONIC_RATIOS.length - 1, comboIndex))];
  const pan = computeSidePan(side) * 0.55;

  switch (preset) {
    case 'jump':
      scheduler.scheduleTone({
        freqStart: 235 * jit,
        freqEnd: 575 * jit,
        durationSec: 0.145,
        wave: 'triangle',
        gainScale: 0.54,
        filterType: 'lowpass',
        filterStartHz: 1400,
        filterEndHz: 3600,
        filterQ: 1.8,
        pan,
        fxSend: 0.12,
      });
      scheduler.scheduleNoise({
        durationSec: 0.045,
        pink: true,
        gainScale: 0.22,
        filterType: 'highpass',
        filterStartHz: 2200,
        pan,
      });
      break;

    case 'bounce':
      scheduler.scheduleTone({
        freqStart: 270 * jit,
        freqEnd: 740 * jit,
        durationSec: 0.18,
        wave: 'triangle',
        gainScale: 0.65,
        filterType: 'lowpass',
        filterStartHz: 1100,
        filterEndHz: 3800,
        filterQ: 2.6,
        pan,
        fxSend: 0.22,
      });
      scheduler.scheduleTone({
        freqStart: 405 * jit,
        freqEnd: 1110 * jit,
        durationSec: 0.13,
        delaySec: 0.015,
        wave: 'sine',
        gainScale: 0.28,
        pan,
      });
      break;

    case 'star':
      scheduler.scheduleTone({
        freqStart: 587.33 * ratio,
        freqEnd: 587.33 * ratio,
        durationSec: 0.11,
        wave: 'sine',
        gainScale: 0.52,
        fmRatio: 2.0,
        fmDepthHz: 180,
        pan: pan - 0.12,
        fxSend: 0.26,
      });
      scheduler.scheduleTone({
        freqStart: 880 * ratio,
        freqEnd: 932 * ratio,
        durationSec: 0.22,
        delaySec: 0.05,
        wave: 'sine',
        gainScale: 0.62,
        fmRatio: 2.5,
        fmDepthHz: 220,
        pan: pan + 0.12,
        fxSend: 0.34,
      });
      break;

    case 'stomp':
      scheduler.scheduleTone({
        freqStart: 155 * jit,
        freqEnd: 46,
        durationSec: 0.12,
        wave: 'sine',
        gainScale: 0.72,
        pan,
      });
      scheduler.scheduleNoise({
        durationSec: 0.07,
        pink: false,
        gainScale: 0.42,
        filterType: 'bandpass',
        filterStartHz: 1850,
        filterEndHz: 700,
        filterQ: 1.6,
        pan,
      });
      scheduler.scheduleTone({
        freqStart: 520 * ratio,
        freqEnd: 760 * ratio,
        durationSec: 0.11,
        delaySec: 0.04,
        wave: 'triangle',
        gainScale: 0.46,
        pan,
        fxSend: 0.2,
      });
      break;

    case 'hurt':
      scheduler.scheduleTone({
        freqStart: 220,
        freqEnd: 68,
        durationSec: 0.25,
        wave: 'sawtooth',
        gainScale: 0.55,
        filterType: 'lowpass',
        filterStartHz: 1900,
        filterEndHz: 320,
        filterQ: 2.4,
        pan,
        fxSend: 0.15,
      });
      scheduler.scheduleNoise({
        durationSec: 0.14,
        pink: true,
        gainScale: 0.58,
        filterType: 'bandpass',
        filterStartHz: 1100,
        filterEndHz: 280,
        filterQ: 1.1,
        pan,
      });
      break;

    case 'laser':
      scheduler.scheduleTone({
        freqStart: 980 * jit,
        freqEnd: 240 * jit,
        durationSec: 0.11,
        wave: 'sawtooth',
        gainScale: 0.34,
        filterType: 'lowpass',
        filterStartHz: 4200,
        filterEndHz: 560,
        filterQ: 3.8,
        pan,
        fxSend: 0.16,
      });
      scheduler.scheduleNoise({
        durationSec: 0.032,
        pink: false,
        gainScale: 0.26,
        filterType: 'highpass',
        filterStartHz: 3200,
        pan,
      });
      break;

    case 'explode':
      scheduler.scheduleTone({
        freqStart: 138 * jit,
        freqEnd: 34,
        durationSec: 0.29,
        wave: 'sine',
        gainScale: 0.85,
        pan,
      });
      scheduler.scheduleTone({
        freqStart: 165 * jit,
        freqEnd: 42,
        durationSec: 0.24,
        wave: 'sawtooth',
        gainScale: 0.45,
        filterType: 'lowpass',
        filterStartHz: 950,
        filterEndHz: 140,
        filterQ: 2.0,
        pan,
      });
      scheduler.scheduleNoise({
        durationSec: 0.32,
        pink: true,
        gainScale: 0.92,
        filterType: 'lowpass',
        filterStartHz: 2400,
        filterEndHz: 160,
        filterQ: 1.2,
        pan,
        fxSend: 0.24,
      });
      break;

    case 'ignite':
      scheduler.scheduleNoise({
        durationSec: 0.12,
        pink: true,
        gainScale: 0.46,
        filterType: 'bandpass',
        filterStartHz: 900,
        filterEndHz: 3400,
        filterQ: 1.9,
        pan,
        fxSend: 0.18,
      });
      scheduler.scheduleTone({
        freqStart: 440 * jit,
        freqEnd: 920 * jit,
        durationSec: 0.11,
        wave: 'triangle',
        gainScale: 0.42,
        pan,
        fxSend: 0.18,
      });
      break;

    case 'key': {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        scheduler.scheduleTone({
          freqStart: f,
          freqEnd: f,
          durationSec: idx === 3 ? 0.3 : 0.11,
          delaySec: idx * 0.068,
          wave: idx === 3 ? 'sine' : 'triangle',
          gainScale: 0.56 + idx * 0.06,
          fmRatio: idx === 3 ? 2 : undefined,
          fmDepthHz: idx === 3 ? 140 : undefined,
          pan: (idx - 1.5) * 0.12,
          fxSend: 0.32,
        });
      });
      break;
    }

    case 'win': {
      const fanfare = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      fanfare.forEach((f, idx) => {
        const isTop = idx >= 3;
        scheduler.scheduleTone({
          freqStart: f,
          freqEnd: f,
          durationSec: isTop ? 0.38 : 0.13,
          delaySec: idx * 0.095,
          wave: isTop ? 'sine' : 'triangle',
          gainScale: isTop ? 0.72 : 0.58,
          fmRatio: isTop ? 2.0 : undefined,
          fmDepthHz: isTop ? 120 : undefined,
          pan: (idx - 2) * 0.12,
          fxSend: 0.35,
        });
      });
      break;
    }

    case 'snap':
      scheduler.scheduleNoise({
        durationSec: 0.025,
        pink: false,
        gainScale: 0.38,
        filterType: 'bandpass',
        filterStartHz: 3200,
        filterQ: 2.2,
        pan,
      });
      scheduler.scheduleTone({
        freqStart: 780 * jit,
        freqEnd: 510 * jit,
        durationSec: 0.04,
        wave: 'sine',
        gainScale: 0.3,
        pan,
      });
      break;

    case 'charge':
      scheduler.scheduleTone({
        freqStart: 440 * ratio,
        freqEnd: 780 * ratio,
        durationSec: 0.12,
        wave: 'triangle',
        gainScale: 0.4,
        pan: pan - 0.14,
        fxSend: 0.28,
      });
      scheduler.scheduleTone({
        freqStart: 660 * ratio,
        freqEnd: 1220 * ratio,
        durationSec: 0.14,
        delaySec: 0.02,
        wave: 'sine',
        gainScale: 0.38,
        pan: pan + 0.14,
        fxSend: 0.32,
      });
      break;

    case 'rail':
      scheduler.scheduleTone({
        freqStart: 195 * jit,
        freqEnd: 48,
        durationSec: 0.24,
        wave: 'sine',
        gainScale: 0.8,
        pan,
      });
      scheduler.scheduleTone({
        freqStart: 780 * jit,
        freqEnd: 135,
        durationSec: 0.22,
        wave: 'sawtooth',
        gainScale: 0.54,
        filterType: 'lowpass',
        filterStartHz: 3600,
        filterEndHz: 420,
        filterQ: 3.4,
        pan,
        fxSend: 0.28,
      });
      scheduler.scheduleNoise({
        durationSec: 0.16,
        pink: true,
        gainScale: 0.62,
        filterType: 'bandpass',
        filterStartHz: 2200,
        filterEndHz: 520,
        filterQ: 1.5,
        pan,
        fxSend: 0.24,
      });
      break;
  }
}

export function playSynthTickVoice(
  scheduler: SynthVoiceScheduler,
  freqHz: number,
  pan = 0,
  gainScale = 0.24,
): void {
  const clampedFreq = Math.max(120, Math.min(2400, freqHz));
  const clampedPan = Math.max(-1, Math.min(1, pan));
  scheduler.scheduleTone({
    freqStart: clampedFreq,
    freqEnd: clampedFreq * 1.18,
    durationSec: 0.042,
    wave: 'triangle',
    gainScale,
    attackSec: 0.002,
    pan: clampedPan,
    fxSend: 0.08,
  });
  scheduler.scheduleNoise({
    durationSec: 0.016,
    pink: false,
    gainScale: gainScale * 0.45,
    attackSec: 0.001,
    filterType: 'bandpass',
    filterStartHz: clampedFreq * 2.2,
    filterQ: 2.0,
    pan: clampedPan,
  });
}

export function playSynthIrisChord(
  scheduler: SynthVoiceScheduler,
  direction: 'in' | 'out',
): void {
  const notes = direction === 'in' ? [523.25, 659.25, 783.99, 1046.5] : [987.77, 783.99, 659.25, 523.25];
  for (let i = 0; i < notes.length; i++) {
    const f = notes[i];
    scheduler.scheduleTone({
      freqStart: f,
      freqEnd: direction === 'in' ? f * 1.015 : f * 0.99,
      durationSec: 0.16,
      delaySec: i * 0.042,
      wave: direction === 'in' ? 'triangle' : 'sine',
      gainScale: 0.28,
      attackSec: 0.006,
      pan: (i - 1.5) * 0.25,
      fxSend: 0.26,
    });
  }
}
