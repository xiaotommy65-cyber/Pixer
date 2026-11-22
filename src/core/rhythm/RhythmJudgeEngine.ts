import {
  computeClearBadge,
  computeRhythmGrade,
  JUDGE_ACCURACY_WEIGHT,
  JUDGE_HP_DELTA,
  JUDGE_WINDOWS_MS,
  TIMING_HISTOGRAM_BINS,
  TIMING_HISTOGRAM_RANGE_MS,
  type RhythmCameraCue,
  type RhythmCameraState,
  type RhythmCameraStyle,
  type RhythmChart,
  type RhythmJudgeCounts,
  type RhythmJudgementEvent,
  type RhythmJudgeTier,
  type RhythmLane,
  type RhythmNote,
  type RhythmPlayRecord,
} from './RhythmTypes.ts';

/** Parallel typed-array note status codes (Zero-GC hot path) */
export const NOTE_PENDING = 0;
export const NOTE_HOLDING = 1;
export const NOTE_HIT = 2;
export const NOTE_MISSED = 3;

export interface RhythmLiveState {
  songTimeMs: number;
  score: number;
  accuracy: number;
  combo: number;
  maxCombo: number;
  hp: number;
  feverTier: 0 | 1 | 2 | 3;
  failed: boolean;
  finished: boolean;
  counts: RhythmJudgeCounts;
  lastJudge: RhythmJudgementEvent | null;
  laneHeld: [boolean, boolean, boolean, boolean];
  laneFlash: [number, number, number, number];
  laneHoldGlow: [number, number, number, number];
  camera: RhythmCameraState;
}

/**
 * Zero-GC 4K Rhythm Judgement, Scoring, Hold Tracking & Camera Choreography Engine.
 * 100% DOM-free and strictly anchored to externally supplied `songTimeMs` (from AudioContext.currentTime).
 */
export class RhythmJudgeEngine {
  private readonly songId: string;
  private readonly chart: RhythmChart;
  private readonly notes: readonly RhythmNote[];
  private readonly bpm: number;
  private readonly offsetMs: number;
  private readonly durationMs: number;
  private readonly cameraCues: readonly RhythmCameraCue[];

  /** Pre-allocated note state arrays */
  public readonly noteStatus: Uint8Array;
  private readonly holdNextTickMs: Float64Array;
  private readonly activeHoldIndex: Int32Array;

  /** Scoring & accuracy accumulators */
  private readonly totalJudgementsWeightBase: number;
  private achievedAccuracySum = 0;
  private judgedCount = 0;
  private combo = 0;
  private maxCombo = 0;
  private hp = 100;
  private failed = false;
  private finished = false;
  private dynamicCamera = true;

  private readonly counts: RhythmJudgeCounts = {
    MARVELOUS: 0,
    PERFECT: 0,
    GREAT: 0,
    GOOD: 0,
    MISS: 0,
  };

  /** Early/late millisecond distribution */
  private readonly timingHistogram: number[] = new Array<number>(TIMING_HISTOGRAM_BINS).fill(0);
  private signedErrorSum = 0;
  private signedErrorSamples = 0;

  /** Pre-allocated live state snapshot reused in-place (Zero-GC) */
  private readonly lastJudgeObj: RhythmJudgementEvent = {
    lane: 0,
    tier: 'MARVELOUS',
    deltaMs: 0,
    songTimeMs: -9999,
    isHoldTick: false,
  };
  private hasLastJudge = false;

  private readonly liveState: RhythmLiveState = {
    songTimeMs: 0,
    score: 0,
    accuracy: 100,
    combo: 0,
    maxCombo: 0,
    hp: 100,
    feverTier: 0,
    failed: false,
    finished: false,
    counts: this.counts,
    lastJudge: null,
    laneHeld: [false, false, false, false],
    laneFlash: [0, 0, 0, 0],
    laneHoldGlow: [0, 0, 0, 0],
    camera: {
      zoom: 1,
      tiltDeg: 0,
      offsetX: 0,
      offsetY: 0,
      kick: 0,
      style: 'CALM',
      energy: 0.4,
    },
  };

  /** Sliding scan cursor so we never scan already-resolved past notes */
  private scanCursor = 0;
  private lastBeatIndex = -1;
  private lastUpdateMs = 0;

  constructor(params: {
    songId: string;
    chart: RhythmChart;
    bpm: number;
    offsetMs: number;
    durationMs: number;
    cameraCues: readonly RhythmCameraCue[];
    startFromMs?: number;
    dynamicCamera?: boolean;
    initialHp?: number;
  }) {
    this.songId = params.songId;
    this.chart = params.chart;
    this.notes = params.chart.notes;
    this.bpm = Math.max(40, params.bpm);
    this.offsetMs = params.offsetMs;
    this.durationMs = params.durationMs;
    this.cameraCues = params.cameraCues;
    this.dynamicCamera = params.dynamicCamera ?? true;
    this.hp = Math.max(5, Math.min(100, params.initialHp ?? 100));
    this.liveState.hp = this.hp;

    this.noteStatus = new Uint8Array(this.notes.length);
    this.holdNextTickMs = new Float64Array(this.notes.length);
    this.activeHoldIndex = new Int32Array(4).fill(-1);

    // Pre-mark notes prior to startFromMs (for "Playtest from Cursor") as already resolved
    const startMs = Math.max(0, params.startFromMs ?? 0);
    let activeNotes = 0;
    for (let i = 0; i < this.notes.length; i++) {
      if (this.notes[i].timeMs < startMs - 50) {
        this.noteStatus[i] = NOTE_HIT;
        this.scanCursor = i + 1;
      } else {
        activeNotes++;
      }
    }
    this.totalJudgementsWeightBase = Math.max(1, activeNotes);
    this.lastUpdateMs = startMs;
    this.liveState.songTimeMs = startMs;
  }

  public setDynamicCamera(enabled: boolean): void {
    this.dynamicCamera = enabled;
    if (!enabled) {
      this.liveState.camera.zoom = 1;
      this.liveState.camera.tiltDeg = 0;
      this.liveState.camera.offsetX = 0;
      this.liveState.camera.offsetY = 0;
      this.liveState.camera.kick = 0;
    }
  }

  public getNotes(): readonly RhythmNote[] {
    return this.notes;
  }

  public getScanCursor(): number {
    return this.scanCursor;
  }

  public getLiveState(): RhythmLiveState {
    return this.liveState;
  }

  /**
   * Handles a lane keydown/touchdown event anchored to the hardware audio clock timestamp.
   * Returns the emitted judgement event (reused object) or null if no note was within hit range.
   */
  public pressLane(lane: RhythmLane, songTimeMs: number): RhythmJudgementEvent | null {
    this.liveState.laneHeld[lane] = true;
    this.liveState.laneFlash[lane] = 1.0;

    if (this.failed || this.finished) return null;

    // Locate the earliest pending note in `lane` within ±MISS window
    let bestIdx = -1;
    let bestAbsDelta = Infinity;
    let bestSignedDelta = 0;

    for (let i = this.scanCursor; i < this.notes.length; i++) {
      if (this.noteStatus[i] !== NOTE_PENDING) continue;
      const n = this.notes[i];
      const delta = songTimeMs - n.timeMs; // negative = early/FAST, positive = late/SLOW
      if (delta < -JUDGE_WINDOWS_MS.MISS) break; // sorted ascending, no closer note possible
      if (n.lane !== lane) continue;
      const absD = Math.abs(delta);
      if (absD <= JUDGE_WINDOWS_MS.MISS && absD < bestAbsDelta) {
        bestAbsDelta = absD;
        bestSignedDelta = delta;
        bestIdx = i;
        break; // Always hit the earliest pending note on this lane first
      }
    }

    if (bestIdx === -1) return null;

    const tier = classifyJudgeTier(bestAbsDelta);
    const note = this.notes[bestIdx];

    if (tier === 'MISS') {
      this.noteStatus[bestIdx] = NOTE_MISSED;
      this.recordJudgement(lane, 'MISS', bestSignedDelta, songTimeMs, false);
      return this.lastJudgeObj;
    }

    if (note.durationMs > 0) {
      this.noteStatus[bestIdx] = NOTE_HOLDING;
      this.activeHoldIndex[lane] = bestIdx;
      const halfBeatMs = 30000 / this.bpm;
      this.holdNextTickMs[bestIdx] = note.timeMs + halfBeatMs;
      this.liveState.laneHoldGlow[lane] = 1.0;
    } else {
      this.noteStatus[bestIdx] = NOTE_HIT;
    }

    this.recordJudgement(lane, tier, bestSignedDelta, songTimeMs, false);
    this.advanceScanCursor();
    return this.lastJudgeObj;
  }

  /**
   * Handles a lane keyup/touchup event. Checks active Hold note tail completion or early release.
   */
  public releaseLane(lane: RhythmLane, songTimeMs: number): void {
    this.liveState.laneHeld[lane] = false;
    const holdIdx = this.activeHoldIndex[lane];
    if (holdIdx === -1) return;

    this.activeHoldIndex[lane] = -1;
    this.liveState.laneHoldGlow[lane] = 0;
    const note = this.notes[holdIdx];
    const endMs = note.timeMs + note.durationMs;

    if (songTimeMs >= endMs - JUDGE_WINDOWS_MS.HOLD_RELEASE_GRACE) {
      // Completed hold cleanly within grace window
      this.noteStatus[holdIdx] = NOTE_HIT;
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.recomputeScoreAndAccuracy();
    } else {
      // Early release drops the hold ribbon and breaks combo
      this.noteStatus[holdIdx] = NOTE_MISSED;
      this.combo = 0;
      this.hp = Math.max(0, this.hp - 4.0);
      this.liveState.combo = 0;
      this.liveState.feverTier = 0;
      this.liveState.hp = this.hp;
      if (this.hp <= 0) {
        this.failed = true;
        this.liveState.failed = true;
      }
      this.setLastJudge(lane, 'MISS', songTimeMs - endMs, songTimeMs, true);
    }
    this.advanceScanCursor();
  }

  /**
   * Advances automatic misses, active hold ticks, lane light decay, and dynamic camera choreography.
   * Call once per animation frame with the latest `AudioContext`-anchored `songTimeMs`.
   */
  public update(songTimeMs: number): RhythmLiveState {
    const dtSec = Math.max(0.001, Math.min(0.08, (songTimeMs - this.lastUpdateMs) / 1000));
    this.lastUpdateMs = songTimeMs;
    this.liveState.songTimeMs = songTimeMs;

    // Decay lane hit flashes smoothly
    for (let l = 0; l < 4; l++) {
      if (this.liveState.laneFlash[l] > 0) {
        this.liveState.laneFlash[l] = Math.max(0, this.liveState.laneFlash[l] - dtSec * 7.5);
      }
      if (this.activeHoldIndex[l] !== -1) {
        this.liveState.laneHoldGlow[l] = 1.0;
      } else if (this.liveState.laneHoldGlow[l] > 0) {
        this.liveState.laneHoldGlow[l] = Math.max(0, this.liveState.laneHoldGlow[l] - dtSec * 9.0);
      }
    }

    if (!this.failed && !this.finished) {
      // 1. Auto-miss passed pending notes
      for (let i = this.scanCursor; i < this.notes.length; i++) {
        if (this.noteStatus[i] !== NOTE_PENDING) continue;
        const n = this.notes[i];
        if (songTimeMs - n.timeMs > JUDGE_WINDOWS_MS.MISS) {
          this.noteStatus[i] = NOTE_MISSED;
          this.recordJudgement(n.lane, 'MISS', JUDGE_WINDOWS_MS.MISS, songTimeMs, false);
        } else {
          break;
        }
      }

      // 2. Process active Hold ticks and automatic tail completion
      const halfBeatMs = 30000 / this.bpm;
      for (let l = 0; l < 4; l++) {
        const idx = this.activeHoldIndex[l];
        if (idx === -1) continue;
        const n = this.notes[idx];
        const endMs = n.timeMs + n.durationMs;

        while (songTimeMs >= this.holdNextTickMs[idx] && this.holdNextTickMs[idx] < endMs - 20) {
          this.holdNextTickMs[idx] += halfBeatMs;
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.hp = Math.min(100, this.hp + 0.5);
          this.liveState.combo = this.combo;
          this.liveState.maxCombo = this.maxCombo;
          this.liveState.hp = this.hp;
          this.setLastJudge(l as RhythmLane, 'MARVELOUS', 0, songTimeMs, true);
        }

        if (songTimeMs >= endMs) {
          this.noteStatus[idx] = NOTE_HIT;
          this.activeHoldIndex[l] = -1;
          this.combo++;
          if (this.combo > this.maxCombo) this.maxCombo = this.combo;
          this.recomputeScoreAndAccuracy();
          this.setLastJudge(l as RhythmLane, 'MARVELOUS', 0, songTimeMs, true);
        }
      }

      this.advanceScanCursor();

      // 3. Check track finish (all notes resolved or track duration reached)
      if (songTimeMs >= this.durationMs - 150) {
        this.finished = true;
        this.liveState.finished = true;
      }
    }

    // 4. Update section-driven camera choreography
    this.updateCameraChoreography(songTimeMs, dtSec);

    return this.liveState;
  }

  public getPlayRecord(): RhythmPlayRecord {
    const totalNotes = this.totalJudgementsWeightBase;
    const meanOffsetMs =
      this.signedErrorSamples > 0
        ? Math.round((this.signedErrorSum / this.signedErrorSamples) * 10) / 10
        : 0;
    const grade = computeRhythmGrade(this.liveState.score, this.counts, totalNotes);
    const clearBadge = computeClearBadge(this.counts, totalNotes, this.failed);

    return {
      songId: this.songId,
      difficulty: this.chart.difficulty,
      score: this.liveState.score,
      accuracy: this.liveState.accuracy,
      maxCombo: this.maxCombo,
      totalNotes,
      grade,
      clearBadge,
      counts: { ...this.counts },
      meanOffsetMs,
      timingHistogram: [...this.timingHistogram],
      playedAt: Date.now(),
    };
  }

  private recordJudgement(
    lane: RhythmLane,
    tier: RhythmJudgeTier,
    signedDeltaMs: number,
    songTimeMs: number,
    isHoldTick: boolean,
  ): void {
    this.counts[tier]++;
    this.judgedCount++;
    this.achievedAccuracySum += JUDGE_ACCURACY_WEIGHT[tier];

    if (tier !== 'MISS') {
      this.signedErrorSum += signedDeltaMs;
      this.signedErrorSamples++;
      const clamped = Math.max(-TIMING_HISTOGRAM_RANGE_MS, Math.min(TIMING_HISTOGRAM_RANGE_MS - 1, signedDeltaMs));
      const bin = Math.floor(
        ((clamped + TIMING_HISTOGRAM_RANGE_MS) / (TIMING_HISTOGRAM_RANGE_MS * 2)) * TIMING_HISTOGRAM_BINS,
      );
      this.timingHistogram[Math.max(0, Math.min(TIMING_HISTOGRAM_BINS - 1, bin))]++;
    }

    if (tier === 'MISS' || tier === 'GOOD') {
      this.combo = 0;
    } else {
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    }

    this.hp = Math.max(0, Math.min(100, this.hp + JUDGE_HP_DELTA[tier]));
    if (this.hp <= 0) {
      this.failed = true;
      this.liveState.failed = true;
    }

    this.recomputeScoreAndAccuracy();
    this.setLastJudge(lane, tier, signedDeltaMs, songTimeMs, isHoldTick);
  }

  private recomputeScoreAndAccuracy(): void {
    // Phigros-inspired 1,000,000 scale: 900,000 accuracy + 100,000 max-combo stability
    const accRatio = this.achievedAccuracySum / this.totalJudgementsWeightBase;
    const comboRatio = Math.min(1, this.maxCombo / this.totalJudgementsWeightBase);
    const rawScore = Math.round(accRatio * 900000 + comboRatio * 100000);
    this.liveState.score = Math.min(1000000, Math.max(0, rawScore));

    const liveAcc =
      this.judgedCount > 0 ? (this.achievedAccuracySum / this.judgedCount) * 100 : 100;
    this.liveState.accuracy = Math.round(liveAcc * 100) / 100;
    this.liveState.combo = this.combo;
    this.liveState.maxCombo = this.maxCombo;
    this.liveState.feverTier =
      this.combo >= 200 ? 3 : this.combo >= 100 ? 2 : this.combo >= 50 ? 1 : 0;
    this.liveState.hp = Math.round(this.hp * 10) / 10;
  }

  private setLastJudge(
    lane: RhythmLane,
    tier: RhythmJudgeTier,
    deltaMs: number,
    songTimeMs: number,
    isHoldTick: boolean,
  ): void {
    this.lastJudgeObj.lane = lane;
    this.lastJudgeObj.tier = tier;
    this.lastJudgeObj.deltaMs = Math.round(deltaMs * 10) / 10;
    this.lastJudgeObj.songTimeMs = songTimeMs;
    this.lastJudgeObj.isHoldTick = isHoldTick;
    this.hasLastJudge = true;
    this.liveState.lastJudge = this.hasLastJudge ? this.lastJudgeObj : null;
  }

  private advanceScanCursor(): void {
    while (
      this.scanCursor < this.notes.length &&
      (this.noteStatus[this.scanCursor] === NOTE_HIT || this.noteStatus[this.scanCursor] === NOTE_MISSED)
    ) {
      this.scanCursor++;
    }
  }

  private updateCameraChoreography(songTimeMs: number, dtSec: number): void {
    const cam = this.liveState.camera;

    // Resolve active camera cue
    let activeStyle: RhythmCameraStyle = 'CALM';
    let intensity = 0.6;
    for (let i = this.cameraCues.length - 1; i >= 0; i--) {
      if (songTimeMs >= this.cameraCues[i].timeMs) {
        activeStyle = this.cameraCues[i].style;
        intensity = this.cameraCues[i].intensity;
        break;
      }
    }
    cam.style = activeStyle;

    // Beat pulse tracking (works even in static mode for background ambient light)
    const beatMs = 60000 / this.bpm;
    const beatFloat = (songTimeMs - this.offsetMs) / beatMs;
    const beatIdx = Math.floor(beatFloat);
    if (beatIdx > this.lastBeatIndex && songTimeMs >= this.offsetMs - 40) {
      this.lastBeatIndex = beatIdx;
      const kickAmp =
        activeStyle === 'DROP'
          ? 1.0 * intensity
          : activeStyle === 'PULSE' || activeStyle === 'TILT_LEFT' || activeStyle === 'TILT_RIGHT'
            ? 0.62 * intensity
            : activeStyle === 'BUILD'
              ? 0.45 * intensity
              : 0.25;
      cam.kick = Math.min(1.4, Math.max(cam.kick, kickAmp));
    }
    cam.kick = Math.max(0, cam.kick - dtSec * 4.8);
    cam.energy =
      activeStyle === 'DROP'
        ? 1.0
        : activeStyle === 'BUILD'
          ? 0.8
          : activeStyle === 'PULSE' || activeStyle === 'TILT_LEFT' || activeStyle === 'TILT_RIGHT'
            ? 0.72
            : 0.38;

    if (!this.dynamicCamera) {
      cam.zoom = 1;
      cam.tiltDeg = 0;
      cam.offsetX = 0;
      cam.offsetY = 0;
      return;
    }

    let targetZoom = 1.0;
    let targetTilt = 0;
    let targetX = 0;
    let targetY = 0;

    switch (activeStyle) {
      case 'CALM':
        targetZoom = 1.0;
        targetTilt = 0;
        break;
      case 'BUILD':
        targetZoom = 1.035 * Math.min(1.1, 0.92 + intensity * 0.12);
        targetY = -6 * intensity;
        break;
      case 'PULSE':
        targetZoom = 1.02 + cam.kick * 0.025;
        targetTilt = Math.sin(beatFloat * Math.PI * 0.5) * 0.9 * intensity;
        break;
      case 'DROP':
        targetZoom = 1.045 + cam.kick * 0.045;
        targetTilt = Math.sin(beatFloat * Math.PI * 0.5) * 1.45 * intensity;
        targetY = -8 + cam.kick * 5.5;
        break;
      case 'TILT_LEFT':
        targetZoom = 1.035 + cam.kick * 0.03;
        targetTilt = -2.1 * Math.min(1.2, intensity);
        targetX = -10 * intensity;
        break;
      case 'TILT_RIGHT':
        targetZoom = 1.035 + cam.kick * 0.03;
        targetTilt = 2.1 * Math.min(1.2, intensity);
        targetX = 10 * intensity;
        break;
    }

    const alpha = 1 - Math.exp(-dtSec * 9.5);
    cam.zoom += (targetZoom - cam.zoom) * alpha;
    cam.tiltDeg += (targetTilt - cam.tiltDeg) * alpha;
    cam.offsetX += (targetX - cam.offsetX) * alpha;
    cam.offsetY += (targetY - cam.offsetY) * alpha;
  }
}

export function classifyJudgeTier(absDeltaMs: number): RhythmJudgeTier {
  if (absDeltaMs <= JUDGE_WINDOWS_MS.MARVELOUS) return 'MARVELOUS';
  if (absDeltaMs <= JUDGE_WINDOWS_MS.PERFECT) return 'PERFECT';
  if (absDeltaMs <= JUDGE_WINDOWS_MS.GREAT) return 'GREAT';
  if (absDeltaMs <= JUDGE_WINDOWS_MS.GOOD) return 'GOOD';
  return 'MISS';
}
