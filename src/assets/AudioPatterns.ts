import type { BgmTheme } from '../core/types/WorldTypes.ts';

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

export interface TactileAcousticSpec {
  filterHz: number;
  q: number;
  clickMs: number;
  noiseGain: number;
  thumpStartHz: number;
  thumpEndHz: number;
  thumpMs: number;
  thumpGain: number;
  thumpWave: OscillatorType;
}

export const TACTILE_SPECS: Record<TactileSwitchProfile, Record<TactilePhase, TactileAcousticSpec>> = {
  face: {
    down: {
      filterHz: 3500,
      q: 2.3,
      clickMs: 8,
      noiseGain: 0.44,
      thumpStartHz: 185,
      thumpEndHz: 62,
      thumpMs: 20,
      thumpGain: 0.36,
      thumpWave: 'triangle',
    },
    up: {
      filterHz: 4650,
      q: 2.7,
      clickMs: 5,
      noiseGain: 0.2,
      thumpStartHz: 245,
      thumpEndHz: 132,
      thumpMs: 11,
      thumpGain: 0.12,
      thumpWave: 'sine',
    },
  },
  dpad: {
    down: {
      filterHz: 1850,
      q: 1.5,
      clickMs: 10,
      noiseGain: 0.38,
      thumpStartHz: 138,
      thumpEndHz: 52,
      thumpMs: 24,
      thumpGain: 0.44,
      thumpWave: 'sine',
    },
    up: {
      filterHz: 2650,
      q: 1.7,
      clickMs: 5.5,
      noiseGain: 0.15,
      thumpStartHz: 180,
      thumpEndHz: 108,
      thumpMs: 11,
      thumpGain: 0.09,
      thumpWave: 'sine',
    },
  },
  bumper: {
    down: {
      filterHz: 4200,
      q: 2.5,
      clickMs: 7,
      noiseGain: 0.48,
      thumpStartHz: 215,
      thumpEndHz: 78,
      thumpMs: 16,
      thumpGain: 0.32,
      thumpWave: 'triangle',
    },
    up: {
      filterHz: 5100,
      q: 2.5,
      clickMs: 4.5,
      noiseGain: 0.21,
      thumpStartHz: 262,
      thumpEndHz: 142,
      thumpMs: 10,
      thumpGain: 0.12,
      thumpWave: 'sine',
    },
  },
  system: {
    down: {
      filterHz: 3050,
      q: 2.1,
      clickMs: 7,
      noiseGain: 0.36,
      thumpStartHz: 168,
      thumpEndHz: 70,
      thumpMs: 17,
      thumpGain: 0.28,
      thumpWave: 'sine',
    },
    up: {
      filterHz: 3850,
      q: 2.1,
      clickMs: 4.5,
      noiseGain: 0.16,
      thumpStartHz: 218,
      thumpEndHz: 118,
      thumpMs: 10,
      thumpGain: 0.09,
      thumpWave: 'sine',
    },
  },
  ui: {
    down: {
      filterHz: 2650,
      q: 1.9,
      clickMs: 7,
      noiseGain: 0.33,
      thumpStartHz: 154,
      thumpEndHz: 66,
      thumpMs: 17,
      thumpGain: 0.26,
      thumpWave: 'triangle',
    },
    up: {
      filterHz: 3400,
      q: 2.0,
      clickMs: 4.5,
      noiseGain: 0.14,
      thumpStartHz: 205,
      thumpEndHz: 112,
      thumpMs: 10,
      thumpGain: 0.09,
      thumpWave: 'sine',
    },
  },
  stick: {
    down: {
      filterHz: 1550,
      q: 1.4,
      clickMs: 7,
      noiseGain: 0.3,
      thumpStartHz: 122,
      thumpEndHz: 55,
      thumpMs: 16,
      thumpGain: 0.28,
      thumpWave: 'sine',
    },
    up: {
      filterHz: 2050,
      q: 1.5,
      clickMs: 4,
      noiseGain: 0.11,
      thumpStartHz: 146,
      thumpEndHz: 94,
      thumpMs: 9,
      thumpGain: 0.07,
      thumpWave: 'sine',
    },
  },
};

export const PENTATONIC_RATIOS = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2] as const;

export const PRESET_COOLDOWN_MS: Record<SoundPreset, number> = {
  jump: 35,
  bounce: 45,
  star: 30,
  stomp: 28,
  hurt: 90,
  laser: 38,
  key: 120,
  win: 250,
  explode: 55,
  ignite: 60,
  snap: 20,
  charge: 75,
  rail: 70,
};

export interface BgmArrangement {
  stepSec: number;
  swingRatio: number;
  leadWave: OscillatorType;
  leadCutoffHz: number;
  leadQ: number;
  leadGain: number;
  bassGain: number;
  padGain: number;
  lead: readonly number[];
  bass: readonly number[];
  chords: readonly (readonly number[])[];
  kick: readonly number[];
  snare: readonly number[];
  hat: readonly number[];
}

export const BGM_ARRANGEMENTS: Record<BgmTheme, BgmArrangement> = {
  meadow: {
    stepSec: 0.155,
    swingRatio: 0.06,
    leadWave: 'triangle',
    leadCutoffHz: 2800,
    leadQ: 1.4,
    leadGain: 0.15,
    bassGain: 0.18,
    padGain: 0.065,
    lead: [72, 0, 76, 79, 84, 0, 79, 76, 74, 0, 79, 76, 72, 74, 76, 0],
    bass: [48, 0, 55, 0, 52, 0, 55, 0, 50, 0, 55, 0, 48, 0, 55, 0],
    chords: [
      [60, 64, 67],
      [],
      [],
      [],
      [60, 64, 69],
      [],
      [],
      [],
      [62, 67, 71],
      [],
      [],
      [],
      [60, 64, 67],
      [],
      [],
      [],
    ],
    kick: [1, 0, 0, 0, 0.85, 0, 0, 0, 1, 0, 0, 0.45, 0.85, 0, 0, 0],
    snare: [0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0, 0.85, 0, 0.35, 0],
    hat: [0.35, 0.2, 0.5, 0.2, 0.35, 0.2, 0.55, 0.25, 0.35, 0.2, 0.5, 0.2, 0.35, 0.2, 0.6, 0.3],
  },
  starlight: {
    stepSec: 0.132,
    swingRatio: 0.03,
    leadWave: 'sawtooth',
    leadCutoffHz: 2450,
    leadQ: 2.2,
    leadGain: 0.125,
    bassGain: 0.19,
    padGain: 0.07,
    lead: [76, 79, 83, 0, 81, 79, 76, 74, 72, 76, 79, 0, 84, 83, 79, 0],
    bass: [45, 45, 52, 45, 48, 48, 55, 48, 43, 43, 50, 43, 45, 52, 57, 0],
    chords: [
      [64, 69, 72],
      [],
      [69, 72],
      [],
      [64, 67, 72],
      [],
      [67, 72],
      [],
      [62, 67, 71],
      [],
      [67, 71],
      [],
      [64, 69, 72],
      [],
      [69, 76],
      [],
    ],
    kick: [1, 0, 0, 0.4, 0.9, 0, 0, 0, 1, 0, 0.5, 0, 0.9, 0, 0, 0.4],
    snare: [0, 0, 0, 0, 0.9, 0, 0, 0.25, 0, 0, 0, 0, 0.95, 0, 0.4, 0],
    hat: [0.4, 0.35, 0.65, 0.35, 0.4, 0.35, 0.65, 0.35, 0.4, 0.35, 0.65, 0.35, 0.4, 0.35, 0.7, 0.45],
  },
  dungeon: {
    stepSec: 0.21,
    swingRatio: 0,
    leadWave: 'sine',
    leadCutoffHz: 1750,
    leadQ: 1.6,
    leadGain: 0.15,
    bassGain: 0.19,
    padGain: 0.08,
    lead: [64, 0, 67, 0, 69, 0, 67, 64, 62, 0, 64, 0, 60, 0, 59, 0],
    bass: [40, 0, 0, 47, 45, 0, 0, 40, 38, 0, 43, 0, 40, 0, 0, 0],
    chords: [
      [52, 55, 59],
      [],
      [],
      [],
      [52, 57, 60],
      [],
      [],
      [],
      [50, 55, 59],
      [],
      [],
      [],
      [52, 55, 59],
      [],
      [],
      [],
    ],
    kick: [0.85, 0, 0, 0, 0, 0, 0.55, 0, 0.8, 0, 0, 0, 0, 0, 0.45, 0],
    snare: [0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0],
    hat: [0.22, 0, 0.32, 0, 0.22, 0, 0.36, 0, 0.22, 0, 0.32, 0, 0.22, 0, 0.38, 0.15],
  },
  boss: {
    stepSec: 0.114,
    swingRatio: 0,
    leadWave: 'sawtooth',
    leadCutoffHz: 2950,
    leadQ: 2.8,
    leadGain: 0.13,
    bassGain: 0.21,
    padGain: 0.07,
    lead: [69, 72, 76, 75, 76, 0, 79, 76, 74, 72, 71, 72, 76, 74, 72, 71],
    bass: [45, 45, 57, 45, 43, 43, 55, 43, 41, 41, 53, 41, 40, 40, 52, 40],
    chords: [
      [57, 64, 69],
      [],
      [],
      [],
      [55, 62, 67],
      [],
      [],
      [],
      [53, 60, 65],
      [],
      [],
      [],
      [52, 59, 64],
      [],
      [52, 60, 64],
      [],
    ],
    kick: [1, 0, 0.55, 0, 1, 0, 0, 0.55, 1, 0, 0.55, 0, 1, 0.45, 0.7, 0.5],
    snare: [0, 0, 0, 0, 0.95, 0, 0.35, 0, 0, 0, 0, 0, 0.95, 0, 0.5, 0.35],
    hat: [0.5, 0.4, 0.75, 0.4, 0.5, 0.4, 0.75, 0.4, 0.5, 0.4, 0.75, 0.4, 0.5, 0.45, 0.8, 0.55],
  },
};

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Maps logical controller side to stereo panning (-1..1). */
export function computeSidePan(side: AudioSide = 'both'): number {
  if (side === 'left') return -0.44;
  if (side === 'right') return 0.44;
  return 0;
}

/** Computes swung step duration while keeping every 2-step pair locked to 2 * baseStepSec. */
export function computeSwungStepDuration(
  stepIdx: number,
  baseStepSec: number,
  swingRatio: number,
): number {
  const clamped = Math.max(0, Math.min(0.25, swingRatio));
  const isEven = stepIdx % 2 === 0;
  return isEven ? baseStepSec * (1 + clamped) : baseStepSec * (1 - clamped);
}
