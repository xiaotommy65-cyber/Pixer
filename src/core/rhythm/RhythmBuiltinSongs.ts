import {
  buildRhythmChart,
  type RhythmCameraCue,
  type RhythmCameraStyle,
  type RhythmChart,
  type RhythmDifficulty,
  type RhythmLane,
  type RhythmNote,
  type RhythmSongProject,
} from './RhythmTypes.ts';

export interface BuiltinSynthSongRecipe {
  id: string;
  title: string;
  subtitle: string;
  artist: string;
  genre: string;
  bpm: number;
  bars: number;
  accentPrimary: string;
  accentSecondary: string;
  /** MIDI root notes per 4-bar progression */
  chordRoots: readonly number[];
  /** Scale intervals in semitones relative to tonic */
  scale: readonly number[];
  /** Lead melodic motif (scale degrees, -1 = rest) across 16 sixteenth-steps per bar */
  leadPatternA: readonly number[];
  leadPatternB: readonly number[];
  /** Kick pattern across 16 sixteenth-steps */
  kickSteps: readonly number[];
  /** Snare/Clap pattern across 16 sixteenth-steps */
  snareSteps: readonly number[];
  /** Energy curve per bar (0.3 .. 1.0) controlling arrangement & camera cues */
  barEnergy: readonly number[];
  /** Target difficulty levels [EASY, NORMAL, HARD, MASTER] */
  levels: readonly [number, number, number, number];
  /** Synth timbre flavor */
  timbre: 'synthwave' | 'funk' | 'dnb' | 'artcore';
}

export const BUILTIN_SYNTH_RECIPES: readonly BuiltinSynthSongRecipe[] = [
  {
    id: 'starlight-overture',
    title: '星塵序曲 Starlight Overture',
    subtitle: 'Lo-Fi Synthwave · 入門星海律動',
    artist: 'Pixer Sound Lab',
    genre: 'Synthwave',
    bpm: 112,
    bars: 24,
    accentPrimary: '#38bdf8',
    accentSecondary: '#f59e0b',
    chordRoots: [57, 53, 48, 55], // Am - F - C - G
    scale: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15],
    leadPatternA: [7, -1, 5, -1, 4, -1, 2, 4, 5, -1, 4, -1, 2, -1, 0, -1],
    leadPatternB: [9, -1, 7, 5, 7, -1, 4, -1, 5, 4, 2, -1, 4, -1, 7, -1],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    barEnergy: [
      0.42, 0.45, 0.52, 0.58,
      0.66, 0.70, 0.72, 0.78,
      0.86, 0.94, 0.96, 0.92,
      0.95, 0.98, 0.94, 0.88,
      0.62, 0.68, 0.78, 0.86,
      0.96, 1.0, 0.92, 0.54,
    ],
    levels: [2, 4, 7, 10],
    timbre: 'synthwave',
  },
  {
    id: 'neon-corridor',
    title: '霓虹迴廊 Neon Corridor',
    subtitle: 'Future Funk · 切分長壓與雙押節拍',
    artist: 'Momo Groove Unit',
    genre: 'Future Funk',
    bpm: 132,
    bars: 28,
    accentPrimary: '#22d3ee',
    accentSecondary: '#fb923c',
    chordRoots: [50, 55, 52, 57], // Dm7 - G7 - Em7 - Am7
    scale: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15],
    leadPatternA: [0, -1, 3, 4, -1, 6, 4, -1, 7, -1, 6, 4, 3, -1, 4, -1],
    leadPatternB: [7, 9, 7, -1, 6, 4, 6, -1, 4, 3, 4, 6, 7, -1, 9, -1],
    kickSteps: [0, 4, 8, 10, 12],
    snareSteps: [4, 12, 15],
    barEnergy: [
      0.45, 0.52, 0.60, 0.68,
      0.74, 0.78, 0.80, 0.86,
      0.94, 0.98, 0.95, 0.92,
      0.96, 1.0, 0.96, 0.90,
      0.60, 0.64, 0.72, 0.84,
      0.95, 0.98, 1.0, 0.94,
      0.98, 1.0, 0.88, 0.52,
    ],
    levels: [3, 6, 9, 12],
    timbre: 'funk',
  },
  {
    id: 'frostblade-sprint',
    title: '霜刃疾走 Frostblade Sprint',
    subtitle: 'Melodic DnB · 高速階梯流與副歌衝刺',
    artist: 'Atelier Pulse',
    genre: 'Drum & Bass',
    bpm: 158,
    bars: 32,
    accentPrimary: '#60a5fa',
    accentSecondary: '#facc15',
    chordRoots: [54, 50, 57, 52], // F#m - D - A - E
    scale: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15],
    leadPatternA: [7, 5, 4, 5, 7, -1, 9, 7, 5, 4, 2, 4, 5, -1, 7, -1],
    leadPatternB: [9, 7, 9, 7, 5, 7, 5, 4, 2, 4, 5, 7, 9, 7, 5, 4],
    kickSteps: [0, 10],
    snareSteps: [4, 12],
    barEnergy: [
      0.44, 0.48, 0.56, 0.66,
      0.74, 0.78, 0.82, 0.88,
      0.94, 0.98, 0.96, 0.95,
      0.98, 1.0, 0.96, 0.92,
      0.58, 0.62, 0.72, 0.82,
      0.88, 0.92, 0.96, 1.0,
      0.98, 0.96, 1.0, 0.96,
      0.98, 1.0, 0.86, 0.50,
    ],
    levels: [4, 7, 11, 14],
    timbre: 'dnb',
  },
  {
    id: 'singularity-pulse',
    title: '終焉脈動 Singularity Pulse',
    subtitle: 'Artcore Hardcore · 魔王級全速對決',
    artist: 'Pixer Boss Ensemble',
    genre: 'Artcore',
    bpm: 182,
    bars: 32,
    accentPrimary: '#38bdf8',
    accentSecondary: '#f43f5e',
    chordRoots: [52, 48, 55, 50], // Em - C - G - D
    scale: [0, 2, 3, 5, 7, 8, 11, 12, 14, 15],
    leadPatternA: [7, 6, 7, 9, 7, 5, 4, 5, 7, 9, 7, 6, 4, 2, 4, 5],
    leadPatternB: [9, 7, 6, 7, 9, 7, 5, 4, 5, 7, 9, 7, 6, 7, 9, 10],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    barEnergy: [
      0.52, 0.62, 0.72, 0.82,
      0.88, 0.92, 0.94, 0.98,
      1.0, 0.98, 0.96, 1.0,
      0.98, 1.0, 0.96, 0.94,
      0.66, 0.74, 0.84, 0.92,
      0.96, 0.98, 1.0, 0.98,
      1.0, 0.98, 1.0, 1.0,
      1.0, 1.0, 0.92, 0.60,
    ],
    levels: [5, 9, 13, 16],
    timbre: 'artcore',
  },
];

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Deterministic pure-TS PCM Stereo/Mono Synthesizer for built-in songs.
 * Produces rich, punchy electronic music (kick, snare, hi-hat, warm bass, chord pad, crisp lead)
 * so built-in songs share the EXACT same AudioBuffer, waveform, seek, and DSP pipeline as uploaded MP3/WAV!
 */
export function synthesizeRecipeToPcm(
  recipeId: string,
  sampleRate = 44100,
): { left: Float32Array; right: Float32Array; mono: Float32Array; durationMs: number } {
  const recipe = BUILTIN_SYNTH_RECIPES.find((r) => r.id === recipeId) ?? BUILTIN_SYNTH_RECIPES[0];
  const beatSec = 60 / recipe.bpm;
  const stepSec = beatSec / 4; // 16th note
  const leadInSec = 1.6; // Clean 1.6s intro lead-in before Bar 0 beat 0
  const tailSec = 1.4;
  const totalSec = leadInSec + recipe.bars * 4 * beatSec + tailSec;
  const totalSamples = Math.floor(totalSec * sampleRate);

  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  // Deterministic LCG noise for crisp hi-hat & snare
  let seed = 0x51a7c3 ^ recipe.bpm * 97;
  const nextNoise = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  const addKick = (startSample: number, gain: number) => {
    const durSamples = Math.min(totalSamples - startSample, Math.floor(0.24 * sampleRate));
    if (durSamples <= 0) return;
    let phase = 0;
    for (let i = 0; i < durSamples; i++) {
      const t = i / sampleRate;
      const freq = 46 + 130 * Math.exp(-t * 36);
      phase += (2 * Math.PI * freq) / sampleRate;
      const env = Math.exp(-t * 14) * Math.min(1, i / 40);
      const click = i < 90 ? (1 - i / 90) * 0.35 : 0;
      const s = (Math.sin(phase) + click) * env * gain;
      left[startSample + i] += s;
      right[startSample + i] += s;
    }
  };

  const addSnare = (startSample: number, gain: number) => {
    const durSamples = Math.min(totalSamples - startSample, Math.floor(0.18 * sampleRate));
    if (durSamples <= 0) return;
    let prev = 0;
    for (let i = 0; i < durSamples; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 22) * Math.min(1, i / 24);
      const tone = Math.sin(2 * Math.PI * (190 - 40 * t) * t) * 0.42;
      const raw = nextNoise();
      const hp = raw - prev * 0.65;
      prev = raw;
      const s = (tone + hp * 0.72) * env * gain;
      left[startSample + i] += s * 0.96;
      right[startSample + i] += s * 1.04;
    }
  };

  const addHiHat = (startSample: number, gain: number, open = false) => {
    const durSamples = Math.min(totalSamples - startSample, Math.floor((open ? 0.14 : 0.045) * sampleRate));
    if (durSamples <= 0) return;
    let prev = 0;
    for (let i = 0; i < durSamples; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * (open ? 24 : 78));
      const raw = nextNoise();
      const hp = raw - prev * 0.85;
      prev = raw;
      const s = hp * env * gain;
      left[startSample + i] += s * 1.08;
      right[startSample + i] += s * 0.92;
    }
  };

  const addNote = (
    startSample: number,
    durSec: number,
    freqHz: number,
    gain: number,
    wave: 'saw' | 'tri' | 'square' | 'pad',
    pan: number, // -1 .. +1
  ) => {
    const durSamples = Math.min(totalSamples - startSample, Math.floor(durSec * sampleRate));
    if (durSamples <= 0) return;
    const lGain = gain * Math.sqrt(0.5 * (1 - pan));
    const rGain = gain * Math.sqrt(0.5 * (1 + pan));
    const attack = wave === 'pad' ? 0.06 : 0.008;
    const release = wave === 'pad' ? 0.12 : 0.04;
    const dt = 1 / sampleRate;
    let ph1 = 0;
    let ph2 = 0.25;
    let lp = 0;

    for (let i = 0; i < durSamples; i++) {
      const t = i * dt;
      let env = 1;
      if (t < attack) env = t / attack;
      else if (t > durSec - release) env = Math.max(0, (durSec - t) / release);
      else if (wave !== 'pad') env = 0.55 + 0.45 * Math.exp(-(t - attack) * 8);

      ph1 = (ph1 + freqHz * dt) % 1;
      ph2 = (ph2 + freqHz * 1.004 * dt) % 1;

      let v = 0;
      if (wave === 'tri') {
        v = 1 - 4 * Math.abs(ph1 - 0.5);
      } else if (wave === 'square') {
        v = (ph1 < 0.35 ? 0.7 : -0.7) * 0.7 + Math.sin(ph1 * Math.PI * 2) * 0.3;
      } else if (wave === 'saw') {
        const raw = (ph1 * 2 - 1) * 0.55 + (ph2 * 2 - 1) * 0.45;
        lp += (raw - lp) * 0.32;
        v = lp;
      } else {
        const raw = Math.sin(ph1 * Math.PI * 2) * 0.65 + (1 - 4 * Math.abs(ph2 - 0.5)) * 0.35;
        lp += (raw - lp) * 0.16;
        v = lp;
      }

      const out = v * env;
      left[startSample + i] += out * lGain;
      right[startSample + i] += out * rGain;
    }
  };

  for (let bar = 0; bar < recipe.bars; bar++) {
    const energy = recipe.barEnergy[bar % recipe.barEnergy.length];
    const rootMidi = recipe.chordRoots[bar % recipe.chordRoots.length];
    const barStartSec = leadInSec + bar * 4 * beatSec;
    const barStartSample = Math.floor(barStartSec * sampleRate);

    // Warm chord pad on bar downbeat
    const triad = [rootMidi, rootMidi + 3, rootMidi + 7];
    for (let c = 0; c < triad.length; c++) {
      addNote(
        barStartSample,
        beatSec * 3.85,
        midiToHz(triad[c]),
        0.095 * (0.65 + energy * 0.35),
        'pad',
        (c - 1) * 0.38,
      );
    }

    const pattern = bar % 2 === 0 ? recipe.leadPatternA : recipe.leadPatternB;

    for (let step = 0; step < 16; step++) {
      const tSec = barStartSec + step * stepSec;
      const sIdx = Math.floor(tSec * sampleRate);

      // Kick drum
      if (recipe.kickSteps.includes(step) && (energy >= 0.48 || step === 0 || step === 8)) {
        addKick(sIdx, 0.44 * (0.72 + energy * 0.28));
      }

      // Snare / Clap
      if (recipe.snareSteps.includes(step) && energy >= 0.52) {
        addSnare(sIdx, 0.30 * (0.68 + energy * 0.32));
      }

      // Hi-Hat groove
      if (energy >= 0.60 && step % 2 === 0) {
        addHiHat(sIdx, 0.10 * energy, step % 4 === 2 && energy > 0.85);
      } else if (energy >= 0.88 && step % 2 === 1) {
        addHiHat(sIdx, 0.065 * energy, false);
      }

      // Driving Bassline on 8th notes
      if (step % 2 === 0) {
        const octJump = step % 4 === 2 && energy > 0.72 ? 12 : 0;
        addNote(
          sIdx,
          stepSec * 1.65,
          midiToHz(rootMidi - 12 + octJump),
          0.22 * (0.7 + energy * 0.3),
          recipe.timbre === 'funk' ? 'saw' : 'tri',
          0,
        );
      }

      // Lead Melody
      const deg = pattern[step];
      if (deg >= 0 && (energy >= 0.55 || step % 4 === 0)) {
        const semitone = recipe.scale[deg % recipe.scale.length] + Math.floor(deg / recipe.scale.length) * 12;
        const leadMidi = rootMidi + 12 + semitone;
        const leadWave =
          recipe.timbre === 'artcore'
            ? 'saw'
            : recipe.timbre === 'dnb'
              ? 'square'
              : recipe.timbre === 'funk'
                ? 'saw'
                : 'tri';
        addNote(
          sIdx,
          stepSec * (energy > 0.85 ? 1.45 : 2.1),
          midiToHz(leadMidi),
          0.175 * (0.75 + energy * 0.25),
          leadWave,
          step % 2 === 0 ? -0.22 : 0.22,
        );
      }
    }
  }

  // Soft limiter + mono downmix
  const mono = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const l = Math.tanh(left[i] * 1.15);
    const r = Math.tanh(right[i] * 1.15);
    left[i] = l;
    right[i] = r;
    mono[i] = (l + r) * 0.5;
  }

  return {
    left,
    right,
    mono,
    durationMs: Math.round(totalSec * 1000),
  };
}

/**
 * Generates musically expressive, hand-crafted 4-difficulty charts tightly synced to each built-in recipe's
 * exact lead-in, bar structure, melody contour, kick/snare groove, and chorus energy!
 */
function buildMusicalChartsForRecipe(
  recipe: BuiltinSynthSongRecipe,
  durationMs: number,
  offsetMs: number,
): Record<RhythmDifficulty, RhythmChart> {
  const beatMs = 60000 / recipe.bpm;
  const stepMs = beatMs / 4; // 16th note

  const buildDifficulty = (diff: RhythmDifficulty, level: number): RhythmChart => {
    const notes: RhythmNote[] = [];
    let seq = 0;
    let lastLane: RhythmLane = 0;
    const laneBusyUntil = [-9999, -9999, -9999, -9999];

    const pushNote = (lane: RhythmLane, timeMs: number, durMs = 0): boolean => {
      if (timeMs < laneBusyUntil[lane]) return false;
      notes.push({
        id: `${recipe.id}_${diff}_${seq++}`,
        lane,
        timeMs: Math.round(timeMs),
        durationMs: Math.round(durMs),
      });
      laneBusyUntil[lane] = timeMs + durMs + (diff === 'MASTER' ? 70 : diff === 'HARD' ? 105 : 165);
      lastLane = lane;
      return true;
    };

    const pickMelodyLane = (deg: number, bar: number, step: number): RhythmLane => {
      const raw = ((deg + bar + (step >> 2)) % 4 + 4) % 4;
      if (raw === lastLane) return (((raw + 1) % 4) as RhythmLane);
      return raw as RhythmLane;
    };

    for (let bar = 0; bar < recipe.bars; bar++) {
      const energy = recipe.barEnergy[bar % recipe.barEnergy.length];
      const pattern = bar % 2 === 0 ? recipe.leadPatternA : recipe.leadPatternB;
      const barStartMs = offsetMs + bar * 4 * beatMs;

      if (diff === 'EASY') {
        // Clean quarter-note / half-note groove, occasional gentle hold on calm transitions
        const stepStride = energy >= 0.85 ? 4 : 8;
        for (let step = 0; step < 16; step += stepStride) {
          const t = barStartMs + step * stepMs;
          const lane = ([0, 1, 2, 3][(bar + step / 4) % 4]) as RhythmLane;
          const dur = step === 0 && energy < 0.65 && bar % 2 === 1 ? beatMs * 1.5 : 0;
          pushNote(lane, t, dur);
        }
      } else if (diff === 'NORMAL') {
        for (let step = 0; step < 16; step += 2) {
          const t = barStartMs + step * stepMs;
          const deg = pattern[step];
          const isDownbeat = step % 4 === 0;
          if (!isDownbeat && deg < 0 && energy < 0.8) continue;
          if (!isDownbeat && step % 4 === 2 && energy < 0.7) continue;

          const lane = deg >= 0 ? pickMelodyLane(deg, bar, step) : (([0, 3, 1, 2][(bar + step / 2) % 4]) as RhythmLane);
          const isHold = isDownbeat && step === 0 && energy < 0.72 && bar % 2 === 0;
          pushNote(lane, t, isHold ? beatMs * 1.0 : 0);

          // Chorus downbeat double chords
          if (step === 0 && energy >= 0.92) {
            const partner = (3 - lane) as RhythmLane;
            pushNote(partner, t, 0);
          }
        }
      } else if (diff === 'HARD') {
        for (let step = 0; step < 16; step++) {
          const t = barStartMs + step * stepMs;
          const deg = pattern[step];
          const isBeat = step % 4 === 0;
          const isEighth = step % 2 === 0;
          const isSnare = recipe.snareSteps.includes(step);

          if (!isEighth && !(energy >= 0.88 && deg >= 0)) continue;
          if (!isBeat && !isSnare && deg < 0 && energy < 0.78) continue;

          const lane = deg >= 0 ? pickMelodyLane(deg, bar, step) : (([0, 2, 1, 3][(step + bar) % 4]) as RhythmLane);
          const isHold = isBeat && step === 8 && energy >= 0.7 && energy < 0.94 && bar % 2 === 1;
          pushNote(lane, t, isHold ? beatMs * 1.0 : 0);

          if ((isBeat || isSnare) && energy >= 0.90 && step % 8 === 0) {
            const partner = ((lane + 2) % 4) as RhythmLane;
            pushNote(partner, t, 0);
          }
        }
      } else {
        // MASTER: expressive 16th-note streams, syncopated holds, double & triple chorus drops
        for (let step = 0; step < 16; step++) {
          const t = barStartMs + step * stepMs;
          const deg = pattern[step];
          const isBeat = step % 4 === 0;
          const isEighth = step % 2 === 0;
          const isSnare = recipe.snareSteps.includes(step);

          if (!isEighth && deg < 0 && energy < 0.92) continue;

          // Smooth staircase stream during peak chorus
          const lane: RhythmLane =
            energy >= 0.95 && !isBeat
              ? (((lastLane + (bar % 2 === 0 ? 1 : 3)) % 4) as RhythmLane)
              : deg >= 0
                ? pickMelodyLane(deg, bar, step)
                : (([0, 3, 1, 2][(step + bar) % 4]) as RhythmLane);

          const isHold = step === 0 && energy >= 0.62 && energy < 0.86 && bar % 2 === 0;
          pushNote(lane, t, isHold ? beatMs * 1.5 : 0);

          // High-energy chords
          if (energy >= 0.86 && (step === 0 || (isSnare && energy >= 0.94))) {
            const partner = (3 - lane) as RhythmLane;
            pushNote(partner, t, 0);
            if (recipe.bpm >= 158 && step === 0 && energy >= 0.99 && bar % 4 === 0) {
              const third = ((lane + 1) % 4) as RhythmLane;
              pushNote(third, t, 0);
            }
          }
        }
      }
    }

    return buildRhythmChart(diff, level, notes, durationMs);
  };

  return {
    EASY: buildDifficulty('EASY', recipe.levels[0]),
    NORMAL: buildDifficulty('NORMAL', recipe.levels[1]),
    HARD: buildDifficulty('HARD', recipe.levels[2]),
    MASTER: buildDifficulty('MASTER', recipe.levels[3]),
  };
}

function buildCameraCuesForRecipe(recipe: BuiltinSynthSongRecipe, offsetMs: number): RhythmCameraCue[] {
  const barMs = (60000 / recipe.bpm) * 4;
  const cues: RhythmCameraCue[] = [];
  let prevStyle: RhythmCameraStyle | null = null;
  let flip = false;

  for (let bar = 0; bar < recipe.bars; bar += 2) {
    const e = recipe.barEnergy[bar % recipe.barEnergy.length];
    const nextE = recipe.barEnergy[Math.min(recipe.barEnergy.length - 1, bar + 2)];
    let style: RhythmCameraStyle = 'CALM';
    let intensity = 0.6;
    let label = 'Intro';

    if (bar < 4) {
      style = 'CALM';
      intensity = 0.55;
      label = 'Intro';
    } else if (e >= 0.94) {
      style = bar % 6 === 2 ? (flip ? 'TILT_LEFT' : 'TILT_RIGHT') : 'DROP';
      if (style === 'TILT_LEFT' || style === 'TILT_RIGHT') flip = !flip;
      intensity = 1.05 + (e - 0.94) * 3;
      label = style === 'DROP' ? 'Chorus Drop' : 'Dynamic Tilt';
    } else if (nextE - e >= 0.12) {
      style = 'BUILD';
      intensity = 0.9;
      label = 'Build-Up';
    } else if (e >= 0.72) {
      style = 'PULSE';
      intensity = 0.78;
      label = 'Verse Pulse';
    } else {
      style = 'CALM';
      intensity = 0.55;
      label = 'Bridge';
    }

    if (style !== prevStyle || cues.length === 0) {
      cues.push({
        id: `${recipe.id}_cam_${cues.length}`,
        timeMs: Math.round(offsetMs + bar * barMs),
        style,
        intensity: Number(Math.min(1.35, intensity).toFixed(2)),
        label,
      });
      prevStyle = style;
    }
  }
  return cues;
}

let cachedBuiltinSongs: RhythmSongProject[] | null = null;

export function getBuiltinRhythmSongs(): RhythmSongProject[] {
  if (cachedBuiltinSongs) return cachedBuiltinSongs;

  cachedBuiltinSongs = BUILTIN_SYNTH_RECIPES.map((recipe) => {
    const beatMs = 60000 / recipe.bpm;
    const offsetMs = 1600;
    const durationMs = Math.round(offsetMs + recipe.bars * 4 * beatMs + 1400);
    const previewStartMs = Math.round(offsetMs + 8 * 4 * beatMs);
    const previewEndMs = Math.min(durationMs - 1000, previewStartMs + 16000);

    return {
      version: 1,
      id: recipe.id,
      title: recipe.title,
      subtitle: recipe.subtitle,
      artist: recipe.artist,
      genre: recipe.genre,
      bpm: recipe.bpm,
      offsetMs,
      durationMs,
      previewStartMs,
      previewEndMs,
      accentPrimary: recipe.accentPrimary,
      accentSecondary: recipe.accentSecondary,
      audioSource: { kind: 'synth', recipeId: recipe.id },
      charts: buildMusicalChartsForRecipe(recipe, durationMs, offsetMs),
      cameraCues: buildCameraCuesForRecipe(recipe, offsetMs),
      isCustom: false,
    };
  });

  return cachedBuiltinSongs;
}
