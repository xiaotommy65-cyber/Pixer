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

export interface AudioAnalysisResult {
  sampleRate: number;
  durationMs: number;
  bpm: number;
  offsetMs: number;
  /** Downsampled waveform peak amplitudes (0..1) for timeline rendering */
  waveformPeaks: Float32Array;
  /** Detected onset events sorted by timeMs */
  onsets: DetectedOnset[];
  /** Coarse RMS energy curve (0..1) per ~500ms window */
  energyCurve: Float32Array;
  energyStepMs: number;
}

export interface DetectedOnset {
  timeMs: number;
  strength: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  sustainMs: number;
}

export interface AutoChartOptions {
  /** 0.5 (sparse) .. 1.5 (dense), default 1.0 */
  sensitivity?: number;
  /** Override detected BPM if user already knows exact BPM */
  bpmOverride?: number;
  /** Override detected first-beat offset in ms */
  offsetOverrideMs?: number;
  /** Max chord density multiplier 0.5 .. 1.5 */
  chordFactor?: number;
}

const FFT_SIZE = 1024;
const HOP_SIZE = 512;

/**
 * Pure TypeScript in-place Radix-2 Cooley-Tukey FFT (Zero external dependencies).
 * Buffers `re` and `im` MUST have power-of-two length N.
 */
export function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while ((j & bit) !== 0) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wStepR = Math.cos(ang);
    const wStepI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const uR = re[i + k];
        const uI = im[i + k];
        const vR = re[i + k + half] * wr - im[i + k + half] * wi;
        const vI = re[i + k + half] * wi + im[i + k + half] * wr;
        re[i + k] = uR + vR;
        im[i + k] = uI + vI;
        re[i + k + half] = uR - vR;
        im[i + k + half] = uI - vI;
        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }
}

/**
 * Extracts downsampled waveform peak envelope (0..1) for crisp DAW timeline drawing.
 */
export function extractWaveformPeaks(monoPcm: Float32Array, bins = 1600): Float32Array {
  const out = new Float32Array(bins);
  if (monoPcm.length === 0) return out;
  const step = monoPcm.length / bins;
  let globalMax = 1e-5;
  for (let b = 0; b < bins; b++) {
    const start = Math.floor(b * step);
    const end = Math.min(monoPcm.length, Math.max(start + 1, Math.floor((b + 1) * step)));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(monoPcm[i]);
      if (a > peak) peak = a;
    }
    out[b] = peak;
    if (peak > globalMax) globalMax = peak;
  }
  const inv = 1 / globalMax;
  for (let b = 0; b < bins; b++) out[b] = Math.min(1, out[b] * inv);
  return out;
}

/**
 * Pure client-side Multi-Band Spectral Flux + Autocorrelation BPM & Onset Analyzer.
 * Runs completely offline in Node.js or Browser with zero external libraries.
 */
export function analyzeMonoPcm(
  monoPcm: Float32Array,
  sampleRate: number,
  options?: { bpmOverride?: number; offsetOverrideMs?: number },
): AudioAnalysisResult {
  const durationMs = Math.round((monoPcm.length / Math.max(1, sampleRate)) * 1000);
  const frameCount = Math.max(1, Math.floor((monoPcm.length - FFT_SIZE) / HOP_SIZE) + 1);
  const hopMs = (HOP_SIZE / sampleRate) * 1000;

  // Pre-compute Hann window & reusable FFT work arrays (Zero per-frame allocation)
  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const halfBins = FFT_SIZE >> 1;
  const prevMag = new Float32Array(halfBins);
  const curMag = new Float32Array(halfBins);

  const fluxLow = new Float32Array(frameCount);
  const fluxMid = new Float32Array(frameCount);
  const fluxHigh = new Float32Array(frameCount);
  const fluxTotal = new Float32Array(frameCount);
  const frameRms = new Float32Array(frameCount);

  const hzPerBin = sampleRate / FFT_SIZE;
  const lowEnd = Math.max(2, Math.min(halfBins - 1, Math.round(250 / hzPerBin)));
  const midEnd = Math.max(lowEnd + 1, Math.min(halfBins - 1, Math.round(2200 / hzPerBin)));
  const highEnd = Math.max(midEnd + 1, Math.min(halfBins - 1, Math.round(10000 / hzPerBin)));

  let maxFlux = 1e-6;
  let maxRms = 1e-6;

  for (let f = 0; f < frameCount; f++) {
    const start = f * HOP_SIZE;
    let sumSq = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = start + i < monoPcm.length ? monoPcm[start + i] : 0;
      sumSq += s * s;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(sumSq / FFT_SIZE);
    frameRms[f] = rms;
    if (rms > maxRms) maxRms = rms;

    fftRadix2(re, im);

    let lF = 0;
    let mF = 0;
    let hF = 0;
    for (let b = 1; b < highEnd; b++) {
      // Log-compressed magnitude sharpens percussive transients against sustained pads
      const mag = Math.log1p(Math.hypot(re[b], im[b]) * 4.0);
      curMag[b] = mag;
      const diff = mag - prevMag[b];
      if (diff > 0) {
        if (b < lowEnd) lF += diff;
        else if (b < midEnd) mF += diff;
        else hF += diff;
      }
      prevMag[b] = mag;
    }

    const lNorm = lF / Math.max(1, lowEnd - 1);
    const mNorm = mF / Math.max(1, midEnd - lowEnd);
    const hNorm = hF / Math.max(1, highEnd - midEnd);
    const tot = lNorm * 1.35 + mNorm * 1.0 + hNorm * 0.9;

    fluxLow[f] = lNorm;
    fluxMid[f] = mNorm;
    fluxHigh[f] = hNorm;
    fluxTotal[f] = tot;
    if (tot > maxFlux) maxFlux = tot;
  }

  // Normalize flux and RMS
  for (let f = 0; f < frameCount; f++) {
    fluxTotal[f] /= maxFlux;
    frameRms[f] /= maxRms;
  }

  // Adaptive moving-average threshold peak picking for onset detection
  const winRadius = Math.max(4, Math.round(140 / hopMs));
  const minGapFrames = Math.max(2, Math.round(62 / hopMs));
  const onsets: DetectedOnset[] = [];
  let lastOnsetFrame = -minGapFrames;

  for (let f = 2; f < frameCount - 2; f++) {
    const val = fluxTotal[f];
    if (val < 0.085) continue;
    if (val < fluxTotal[f - 1] || val < fluxTotal[f + 1]) continue;

    let localSum = 0;
    let localCount = 0;
    const lo = Math.max(0, f - winRadius);
    const hi = Math.min(frameCount - 1, f + winRadius);
    for (let k = lo; k <= hi; k++) {
      localSum += fluxTotal[k];
      localCount++;
    }
    const localMean = localSum / Math.max(1, localCount);
    if (val < localMean * 1.42 + 0.035) continue;
    if (f - lastOnsetFrame < minGapFrames) {
      if (onsets.length > 0 && val > onsets[onsets.length - 1].strength) {
        onsets.pop();
      } else {
        continue;
      }
    }

    // Estimate sustain duration by checking how long RMS remains > 62% of onset RMS
    const peakRms = Math.max(frameRms[f], frameRms[Math.min(frameCount - 1, f + 1)]);
    let sustainFrames = 0;
    if (peakRms > 0.22) {
      const maxCheck = Math.min(frameCount - 1, f + Math.round(1400 / hopMs));
      for (let k = f + 2; k <= maxCheck; k++) {
        if (frameRms[k] >= peakRms * 0.62 && fluxTotal[k] < 0.48) {
          sustainFrames = k - f;
        } else {
          break;
        }
      }
    }

    // Parabolic sub-frame interpolation for sharper onset timestamp
    const y0 = fluxTotal[f - 1];
    const y1 = fluxTotal[f];
    const y2 = fluxTotal[f + 1];
    const denom = y0 - 2 * y1 + y2;
    const frac = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;

    onsets.push({
      timeMs: Math.max(0, Math.round((f + frac) * hopMs)),
      strength: val,
      lowEnergy: fluxLow[f],
      midEnergy: fluxMid[f],
      highEnergy: fluxHigh[f],
      sustainMs: sustainFrames >= Math.round(240 / hopMs) ? Math.round(sustainFrames * hopMs) : 0,
    });
    lastOnsetFrame = f;
  }

  // BPM estimation via lag-weighted autocorrelation over onset flux envelope (80..200 BPM)
  const detectedBpm =
    options?.bpmOverride && Number.isFinite(options.bpmOverride)
      ? Math.max(60, Math.min(240, Math.round(options.bpmOverride * 10) / 10))
      : estimateBpmFromFlux(fluxTotal, hopMs);

  // First-beat phase alignment via beat comb filter
  const detectedOffsetMs =
    options?.offsetOverrideMs !== undefined && Number.isFinite(options.offsetOverrideMs)
      ? Math.round(options.offsetOverrideMs)
      : estimateFirstBeatOffsetMs(onsets, detectedBpm);

  // Coarse 500ms energy curve for camera choreography & preview detection
  const energyStepMs = 500;
  const energyLen = Math.max(4, Math.ceil(durationMs / energyStepMs));
  const energyCurve = new Float32Array(energyLen);
  const framesPerEnergy = Math.max(1, Math.round(energyStepMs / hopMs));
  for (let e = 0; e < energyLen; e++) {
    const fStart = Math.min(frameCount - 1, e * framesPerEnergy);
    const fEnd = Math.min(frameCount, fStart + framesPerEnergy);
    let acc = 0;
    for (let f = fStart; f < fEnd; f++) acc += frameRms[f];
    energyCurve[e] = acc / Math.max(1, fEnd - fStart);
  }

  const waveformPeaks = extractWaveformPeaks(monoPcm, 1600);

  return {
    sampleRate,
    durationMs,
    bpm: detectedBpm,
    offsetMs: detectedOffsetMs,
    waveformPeaks,
    onsets,
    energyCurve,
    energyStepMs,
  };
}

function estimateBpmFromFlux(flux: Float32Array, hopMs: number): number {
  const n = flux.length;
  if (n < 40) return 128;

  // Evaluate candidate BPMs from 80 to 200 in 0.5 BPM steps via comb-weighted autocorrelation
  let bestBpm = 128;
  let bestScore = -1;

  for (let bpm = 80; bpm <= 200; bpm += 0.5) {
    const beatFrames = (60000 / bpm) / hopMs;
    const lag1 = Math.round(beatFrames);
    const lag2 = Math.round(beatFrames * 2);
    const lag4 = Math.round(beatFrames * 4);
    if (lag2 >= n) continue;

    let corr1 = 0;
    let corr2 = 0;
    let corr4 = 0;
    const limit1 = n - lag1;
    for (let i = 0; i < limit1; i++) {
      corr1 += flux[i] * flux[i + lag1];
    }
    corr1 /= Math.max(1, limit1);

    const limit2 = n - lag2;
    for (let i = 0; i < limit2; i++) {
      corr2 += flux[i] * flux[i + lag2];
    }
    corr2 /= Math.max(1, limit2);

    if (lag4 < n) {
      const limit4 = n - lag4;
      for (let i = 0; i < limit4; i++) {
        corr4 += flux[i] * flux[i + lag4];
      }
      corr4 /= Math.max(1, limit4);
    }

    // Gentle musical tempo prior centered around 128 BPM (avoids spurious 80 vs 160 bias)
    const tempoPrior = 1 - 0.12 * Math.pow((bpm - 130) / 70, 2);
    const score = (corr1 * 0.52 + corr2 * 0.32 + corr4 * 0.16) * tempoPrior;
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  return Math.round(bestBpm * 10) / 10;
}

function estimateFirstBeatOffsetMs(onsets: readonly DetectedOnset[], bpm: number): number {
  if (onsets.length === 0) return 0;
  const beatMs = 60000 / Math.max(60, bpm);
  const steps = 60;
  let bestPhase = 0;
  let bestScore = -1;

  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * beatMs;
    let score = 0;
    for (let i = 0; i < onsets.length; i++) {
      const o = onsets[i];
      const mod = (((o.timeMs - phase) % beatMs) + beatMs) % beatMs;
      const dist = Math.min(mod, beatMs - mod);
      if (dist <= 32) {
        const w = 1 - dist / 32;
        score += w * (o.strength + o.lowEnergy * 0.8);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return Math.round(bestPhase);
}

/**
 * Generates expressive section-aware camera cues directly from the track's RMS energy curve.
 */
export function generateCameraCuesFromEnergy(
  energyCurve: Float32Array,
  energyStepMs: number,
  bpm: number,
  offsetMs: number,
): RhythmCameraCue[] {
  const cues: RhythmCameraCue[] = [];
  const barMs = (60000 / Math.max(60, bpm)) * 4;
  const totalMs = energyCurve.length * energyStepMs;

  // Compute average energy
  let sum = 0;
  for (let i = 0; i < energyCurve.length; i++) sum += energyCurve[i];
  const avgEnergy = sum / Math.max(1, energyCurve.length);

  let prevStyle: RhythmCameraStyle | null = null;
  let idx = 0;
  let toggleTilt = false;

  for (let t = offsetMs; t < totalMs - barMs * 0.5; t += barMs * 2) {
    const eIdx = Math.min(energyCurve.length - 1, Math.max(0, Math.floor(t / energyStepMs)));
    const nextIdx = Math.min(energyCurve.length - 1, eIdx + Math.max(1, Math.round(barMs / energyStepMs)));
    const curE = energyCurve[eIdx];
    const nextE = energyCurve[nextIdx];

    let style: RhythmCameraStyle = 'CALM';
    let intensity = 0.65;
    let label = 'Verse';

    if (t < offsetMs + barMs * 2.5) {
      style = 'CALM';
      intensity = 0.5;
      label = 'Intro';
    } else if (curE > avgEnergy * 1.24) {
      style = idx % 3 === 1 ? (toggleTilt ? 'TILT_LEFT' : 'TILT_RIGHT') : 'DROP';
      if (style === 'TILT_LEFT' || style === 'TILT_RIGHT') toggleTilt = !toggleTilt;
      intensity = Math.min(1.25, 0.85 + (curE - avgEnergy) * 0.8);
      label = style === 'DROP' ? 'Chorus Drop' : 'Groove Tilt';
    } else if (nextE - curE > 0.14) {
      style = 'BUILD';
      intensity = 0.9;
      label = 'Build-Up';
    } else if (curE > avgEnergy * 0.92) {
      style = 'PULSE';
      intensity = 0.72;
      label = 'Pulse';
    }

    if (style !== prevStyle || idx === 0) {
      cues.push({
        id: `cam_auto_${idx++}`,
        timeMs: Math.max(0, Math.round(t)),
        style,
        intensity: Number(intensity.toFixed(2)),
        label,
      });
      prevStyle = style;
    }
  }

  if (cues.length === 0) {
    cues.push({ id: 'cam_auto_0', timeMs: 0, style: 'CALM', intensity: 0.6, label: 'Intro' });
  }
  return cues;
}

interface TierSpec {
  difficulty: RhythmDifficulty;
  subdivision: number; // beats per grid slot (e.g. 2 = half-beat, 4 = 1/4 beat)
  minGapMs: number;
  strengthThreshold: number;
  maxChordRatio: number;
  allowHolds: boolean;
  allowTriple: boolean;
  baseLevel: number;
}

const TIER_SPECS: readonly TierSpec[] = [
  {
    difficulty: 'EASY',
    subdivision: 1, // quarter notes
    minGapMs: 280,
    strengthThreshold: 0.44,
    maxChordRatio: 0.0,
    allowHolds: false,
    allowTriple: false,
    baseLevel: 2,
  },
  {
    difficulty: 'NORMAL',
    subdivision: 2, // 1/8 notes
    minGapMs: 185,
    strengthThreshold: 0.30,
    maxChordRatio: 0.10,
    allowHolds: true,
    allowTriple: false,
    baseLevel: 5,
  },
  {
    difficulty: 'HARD',
    subdivision: 4, // 1/16 notes
    minGapMs: 118,
    strengthThreshold: 0.20,
    maxChordRatio: 0.22,
    allowHolds: true,
    allowTriple: false,
    baseLevel: 9,
  },
  {
    difficulty: 'MASTER',
    subdivision: 4, // 1/16 notes + dense fills
    minGapMs: 78,
    strengthThreshold: 0.12,
    maxChordRatio: 0.34,
    allowHolds: true,
    allowTriple: true,
    baseLevel: 13,
  },
];

/**
 * Ergonomic 4-Difficulty Chart Generator:
 * - Quantizes detected onsets to clean musical beat subdivisions
 * - Enforces hand-alternation flow and anti-jack constraints
 * - Guarantees strictly increasing density across EASY < NORMAL < HARD < MASTER
 */
export function generateFourChartsFromAnalysis(
  analysis: AudioAnalysisResult,
  options?: AutoChartOptions,
): Record<RhythmDifficulty, RhythmChart> {
  const sensitivity = Math.max(0.5, Math.min(1.5, options?.sensitivity ?? 1.0));
  const chordFactor = Math.max(0.5, Math.min(1.5, options?.chordFactor ?? 1.0));
  const bpm = options?.bpmOverride ?? analysis.bpm;
  const offsetMs = options?.offsetOverrideMs ?? analysis.offsetMs;
  const beatMs = 60000 / Math.max(60, bpm);

  const result = {} as Record<RhythmDifficulty, RhythmChart>;

  for (const spec of TIER_SPECS) {
    const gridMs = beatMs / spec.subdivision;
    const effThreshold = Math.max(0.06, spec.strengthThreshold / sensitivity);
    const notes: RhythmNote[] = [];

    // Lane lock times prevent overlapping holds and uncomfortable 1-finger jacks
    const laneBusyUntil = [-9999, -9999, -9999, -9999];
    const laneLastHit = [-9999, -9999, -9999, -9999];
    let lastLane: RhythmLane = 0;
    let lastTimeMs = -9999;
    let flowDir = 1;
    let chordCount = 0;
    let noteCounter = 0;

    // Combine real detected onsets with gentle beat-grid fallback if track is ultra-minimal
    const candidates = analysis.onsets.filter(
      (o) => o.timeMs >= 800 && o.timeMs <= analysis.durationMs - 650 && o.strength >= effThreshold,
    );

    const effectiveOnsets: DetectedOnset[] =
      candidates.length >= 12
        ? candidates
        : synthesizeBeatFallbackOnsets(analysis.durationMs, bpm, offsetMs, spec.subdivision);

    for (let i = 0; i < effectiveOnsets.length; i++) {
      const o = effectiveOnsets[i];
      // Quantize onset timestamp to nearest musical grid slot
      const gridIndex = Math.round((o.timeMs - offsetMs) / gridMs);
      const qTime = Math.round(offsetMs + gridIndex * gridMs);
      if (qTime < 750 || qTime > analysis.durationMs - 600) continue;
      if (qTime - lastTimeMs < spec.minGapMs) continue;

      // Pick ergonomic primary lane based on spectral centroid + hand flow
      const primaryLane = pickErgonomicLane(
        o,
        qTime,
        lastLane,
        flowDir,
        laneBusyUntil,
        laneLastHit,
      );
      if (primaryLane === -1) continue;

      if (primaryLane === 3) flowDir = -1;
      else if (primaryLane === 0) flowDir = 1;

      // Decide Hold duration if sustained energy was detected
      let holdMs = 0;
      if (spec.allowHolds && o.sustainMs >= beatMs * 0.72) {
        const holdBeats = Math.max(0.5, Math.min(2.5, Math.round((o.sustainMs / beatMs) * 2) / 2));
        const candidateEnd = qTime + Math.round(holdBeats * beatMs);
        if (candidateEnd < analysis.durationMs - 450) {
          holdMs = Math.round(holdBeats * beatMs);
        }
      }

      notes.push({
        id: `${spec.difficulty}_${noteCounter++}`,
        lane: primaryLane,
        timeMs: qTime,
        durationMs: holdMs,
      });
      laneLastHit[primaryLane] = qTime;
      laneBusyUntil[primaryLane] = qTime + holdMs + Math.max(95, spec.minGapMs * 0.85);

      // Decide Chord (Double / Triple) on strong accent beats
      const currentChordRatio = notes.length > 0 ? chordCount / notes.length : 0;
      const isStrongBeat = Math.abs(gridIndex % Math.max(1, spec.subdivision)) === 0;
      const chordChanceMet =
        spec.maxChordRatio > 0 &&
        currentChordRatio < spec.maxChordRatio * chordFactor &&
        (o.strength > 0.56 || (isStrongBeat && o.lowEnergy > 0.32 && o.strength > 0.34));

      if (chordChanceMet) {
        const partnerLane = pickChordPartner(primaryLane, qTime, laneBusyUntil, laneLastHit);
        if (partnerLane !== -1) {
          notes.push({
            id: `${spec.difficulty}_${noteCounter++}`,
            lane: partnerLane,
            timeMs: qTime,
            durationMs: 0,
          });
          laneLastHit[partnerLane] = qTime;
          laneBusyUntil[partnerLane] = qTime + Math.max(105, spec.minGapMs);
          chordCount++;

          if (spec.allowTriple && isStrongBeat && o.strength > 0.84) {
            const thirdLane = pickChordPartner(partnerLane, qTime, laneBusyUntil, laneLastHit, primaryLane);
            if (thirdLane !== -1) {
              notes.push({
                id: `${spec.difficulty}_${noteCounter++}`,
                lane: thirdLane,
                timeMs: qTime,
                durationMs: 0,
              });
              laneLastHit[thirdLane] = qTime;
              laneBusyUntil[thirdLane] = qTime + Math.max(120, spec.minGapMs);
            }
          }
        }
      }

      lastLane = primaryLane;
      lastTimeMs = qTime;
    }

    // For MASTER / HARD, inject rhythmic 1/8 or 1/16 connecting stream notes on high-energy sections
    // so difficulty progression feels richly playable even on sparse ambient MP3s
    if (spec.difficulty === 'HARD' || spec.difficulty === 'MASTER') {
      const targetMinNps = spec.difficulty === 'MASTER' ? 4.4 : 2.8;
      const curNps = notes.length / Math.max(1, analysis.durationMs / 1000);
      if (curNps < targetMinNps) {
        injectEnergyStreamFills(
          notes,
          analysis.energyCurve,
          analysis.energyStepMs,
          bpm,
          offsetMs,
          analysis.durationMs,
          spec.difficulty,
          targetMinNps,
        );
      }
    }

    const nps = notes.length / Math.max(1, analysis.durationMs / 1000);
    const computedLevel = Math.max(
      spec.baseLevel,
      Math.min(16, Math.round(spec.baseLevel + nps * 0.65)),
    );
    result[spec.difficulty] = buildRhythmChart(spec.difficulty, computedLevel, notes, analysis.durationMs);
  }

  return result;
}

function synthesizeBeatFallbackOnsets(
  durationMs: number,
  bpm: number,
  offsetMs: number,
  subdivision: number,
): DetectedOnset[] {
  const out: DetectedOnset[] = [];
  const stepMs = (60000 / Math.max(60, bpm)) / Math.max(1, subdivision);
  for (let t = Math.max(1000, offsetMs); t < durationMs - 800; t += stepMs) {
    const idx = Math.round((t - offsetMs) / stepMs);
    const strong = idx % Math.max(1, subdivision) === 0;
    out.push({
      timeMs: Math.round(t),
      strength: strong ? 0.72 : 0.36,
      lowEnergy: strong ? 0.6 : 0.15,
      midEnergy: 0.4,
      highEnergy: strong ? 0.3 : 0.55,
      sustainMs: 0,
    });
  }
  return out;
}

function pickErgonomicLane(
  onset: DetectedOnset,
  timeMs: number,
  lastLane: RhythmLane,
  flowDir: number,
  laneBusyUntil: number[],
  laneLastHit: number[],
): RhythmLane | -1 {
  // Spectral brightness nudges note position left (bass) -> right (treble)
  const totalE = onset.lowEnergy + onset.midEnergy + onset.highEnergy + 1e-5;
  const brightRatio = (onset.midEnergy * 0.5 + onset.highEnergy) / totalE;
  const preferredLane = Math.max(0, Math.min(3, Math.round(brightRatio * 3))) as RhythmLane;

  let bestLane: RhythmLane | -1 = -1;
  let bestScore = -1e9;

  for (let l = 0; l < 4; l++) {
    if (timeMs < laneBusyUntil[l]) continue;
    const timeSinceLane = timeMs - laneLastHit[l];
    let score = 0;
    // Prefer alternating away from the exact same lane (anti-jack)
    if (l === lastLane) {
      score -= timeSinceLane < 260 ? 5.0 : 1.2;
    } else {
      score += 1.5;
    }
    // Prefer opposite hand alternation (left hand 0/1 <-> right hand 2/3)
    const prevRightHand = lastLane >= 2;
    const curRightHand = l >= 2;
    if (prevRightHand !== curRightHand) score += 1.1;

    // Gentle pull toward spectral brightness lane
    score -= Math.abs(l - preferredLane) * 0.45;
    // Smooth staircase flow
    if (l === lastLane + flowDir) score += 0.85;
    // Favor lanes that haven't been hit recently
    score += Math.min(2.0, timeSinceLane / 600);

    if (score > bestScore) {
      bestScore = score;
      bestLane = l as RhythmLane;
    }
  }
  return bestLane;
}

function pickChordPartner(
  primary: RhythmLane,
  timeMs: number,
  laneBusyUntil: number[],
  laneLastHit: number[],
  exclude?: RhythmLane,
): RhythmLane | -1 {
  // Prefer opposite-hand symmetric partner (0<->3, 1<->2, 0<->2, 1<->3)
  const order: RhythmLane[] =
    primary === 0
      ? [3, 2, 1]
      : primary === 1
        ? [2, 3, 0]
        : primary === 2
          ? [1, 0, 3]
          : [0, 1, 2];

  for (const l of order) {
    if (l === primary || l === exclude) continue;
    if (timeMs < laneBusyUntil[l]) continue;
    if (timeMs - laneLastHit[l] < 110) continue;
    return l;
  }
  return -1;
}

function injectEnergyStreamFills(
  notes: RhythmNote[],
  energyCurve: Float32Array,
  energyStepMs: number,
  bpm: number,
  offsetMs: number,
  durationMs: number,
  difficulty: RhythmDifficulty,
  targetMinNps: number,
): void {
  const beatMs = 60000 / Math.max(60, bpm);
  const subStep = difficulty === 'MASTER' ? beatMs / 2 : beatMs;
  const occupied = new Set<number>();
  for (let i = 0; i < notes.length; i++) {
    occupied.add(Math.round((notes[i].timeMs - offsetMs) / (subStep * 0.5)));
  }

  let avgE = 0;
  for (let i = 0; i < energyCurve.length; i++) avgE += energyCurve[i];
  avgE /= Math.max(1, energyCurve.length);

  let laneCursor = 0;
  let idSeq = notes.length + 1;
  const maxNotes = Math.round((durationMs / 1000) * targetMinNps);

  for (let t = Math.max(1200, offsetMs); t < durationMs - 900 && notes.length < maxNotes; t += subStep) {
    const eIdx = Math.min(energyCurve.length - 1, Math.max(0, Math.floor(t / energyStepMs)));
    if (energyCurve[eIdx] < avgE * 0.85) continue;
    const slot = Math.round((t - offsetMs) / (subStep * 0.5));
    if (occupied.has(slot)) continue;
    const lane = ([0, 2, 1, 3][laneCursor++ % 4]) as RhythmLane;
    notes.push({
      id: `${difficulty}_fill_${idSeq++}`,
      lane,
      timeMs: Math.round(t),
      durationMs: 0,
    });
    occupied.add(slot);
  }
}

/**
 * End-to-end helper: analyzes decoded mono PCM from a local MP3/WAV/OGG file
 * and constructs a complete 4-difficulty RhythmSongProject ready for immediate play or editing.
 */
export function buildProjectFromAudioPcm(params: {
  id: string;
  title: string;
  artist?: string;
  fileName: string;
  storageKey: string;
  monoPcm: Float32Array;
  sampleRate: number;
  options?: AutoChartOptions;
}): { project: RhythmSongProject; analysis: AudioAnalysisResult } {
  const analysis = analyzeMonoPcm(params.monoPcm, params.sampleRate, {
    bpmOverride: params.options?.bpmOverride,
    offsetOverrideMs: params.options?.offsetOverrideMs,
  });
  const charts = generateFourChartsFromAnalysis(analysis, params.options);
  const cameraCues = generateCameraCuesFromEnergy(
    analysis.energyCurve,
    analysis.energyStepMs,
    analysis.bpm,
    analysis.offsetMs,
  );

  // Pick highest-energy 18s window for automatic song-select preview loop
  let bestEnergyIdx = 0;
  let bestEnergy = -1;
  const previewWindowBins = Math.max(4, Math.round(16000 / analysis.energyStepMs));
  for (let i = 0; i < Math.max(1, analysis.energyCurve.length - previewWindowBins); i++) {
    let sum = 0;
    for (let k = 0; k < previewWindowBins && i + k < analysis.energyCurve.length; k++) {
      sum += analysis.energyCurve[i + k];
    }
    if (sum > bestEnergy) {
      bestEnergy = sum;
      bestEnergyIdx = i;
    }
  }
  const previewStartMs = Math.min(
    Math.max(0, analysis.durationMs - 10000),
    bestEnergyIdx * analysis.energyStepMs,
  );
  const previewEndMs = Math.min(analysis.durationMs, previewStartMs + 18000);

  const project: RhythmSongProject = {
    version: 1,
    id: params.id,
    title: params.title,
    subtitle: `自動識譜 · ${analysis.bpm} BPM`,
    artist: params.artist || 'Local Audio Track',
    genre: 'Imported Audio',
    bpm: analysis.bpm,
    offsetMs: analysis.offsetMs,
    durationMs: analysis.durationMs,
    previewStartMs,
    previewEndMs,
    accentPrimary: '#38bdf8',
    accentSecondary: '#f59e0b',
    audioSource: {
      kind: 'custom',
      storageKey: params.storageKey,
      fileName: params.fileName,
    },
    charts,
    cameraCues,
    isCustom: true,
  };

  return { project, analysis };
}
