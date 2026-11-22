export type RhythmDifficulty = 'EASY' | 'NORMAL' | 'HARD' | 'MASTER';

export const RHYTHM_DIFFICULTIES: readonly RhythmDifficulty[] = [
  'EASY',
  'NORMAL',
  'HARD',
  'MASTER',
] as const;

export type RhythmLane = 0 | 1 | 2 | 3;

export type RhythmJudgeTier = 'MARVELOUS' | 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

export type RhythmGrade = 'PHI' | 'S_PLUS' | 'S' | 'A' | 'B' | 'C';

export type RhythmClearBadge = 'AP' | 'FC' | 'CLEAR' | 'FAIL';

export type RhythmCameraStyle =
  | 'CALM'
  | 'BUILD'
  | 'DROP'
  | 'TILT_LEFT'
  | 'TILT_RIGHT'
  | 'PULSE';

export type RhythmHitsoundPreset = 'clap' | 'tick' | 'crystal' | 'off';

export interface RhythmNote {
  id: string;
  lane: RhythmLane;
  /** Target hit timestamp in milliseconds from track start */
  timeMs: number;
  /** 0 for Tap note, > 0 for Hold note duration in milliseconds */
  durationMs: number;
  /** Marked automatically when 2+ notes share the same timestamp within 12ms */
  isChord?: boolean;
}

export interface RhythmCameraCue {
  id: string;
  timeMs: number;
  style: RhythmCameraStyle;
  /** 0.2 to 1.5 intensity scalar */
  intensity: number;
  label?: string;
}

export interface RhythmChart {
  difficulty: RhythmDifficulty;
  /** 1..16 difficulty rating */
  level: number;
  notes: RhythmNote[];
  /** 64 normalized density bins (0..1) for song-select sparkline */
  densityBins: number[];
  peakNps: number;
  avgNps: number;
}

export type RhythmAudioSource =
  | { kind: 'synth'; recipeId: string }
  | { kind: 'custom'; storageKey: string; fileName: string };

export interface RhythmSongProject {
  version: 1;
  id: string;
  title: string;
  subtitle: string;
  artist: string;
  genre: string;
  bpm: number;
  offsetMs: number;
  durationMs: number;
  previewStartMs: number;
  previewEndMs: number;
  accentPrimary: string;
  accentSecondary: string;
  audioSource: RhythmAudioSource;
  charts: Record<RhythmDifficulty, RhythmChart>;
  cameraCues: RhythmCameraCue[];
  isCustom?: boolean;
}

export interface RhythmJudgeCounts {
  MARVELOUS: number;
  PERFECT: number;
  GREAT: number;
  GOOD: number;
  MISS: number;
}

export interface RhythmPlayRecord {
  songId: string;
  difficulty: RhythmDifficulty;
  score: number;
  accuracy: number;
  maxCombo: number;
  totalNotes: number;
  grade: RhythmGrade;
  clearBadge: RhythmClearBadge;
  counts: RhythmJudgeCounts;
  /** Average signed hit error in ms (negative = early/FAST, positive = late/SLOW) */
  meanOffsetMs: number;
  /** 21 bins spanning -150ms .. +150ms (15ms per bin) */
  timingHistogram: number[];
  playedAt: number;
}

export interface RhythmPlayerConfig {
  /** Note scroll speed multiplier 1.0 .. 6.0 (default 3.0) */
  scrollSpeed: number;
  /** Audio sync offset in ms (-200 .. +200) */
  audioOffsetMs: number;
  /** Visual offset in ms (-100 .. +100) */
  visualOffsetMs: number;
  /** KeyboardEvent.code bindings for lanes 0..3 */
  keyBindings: [string, string, string, string];
  /** Highway background dim opacity 0.4 .. 0.95 */
  laneDim: number;
  /** Dynamic section-driven camera choreography (false = Static Competitive Mode) */
  cameraDynamic: boolean;
  /** Hitsound preset */
  hitsoundPreset: RhythmHitsoundPreset;
  /** Perspective lane tilt toggle */
  perspectiveHighway: boolean;
}

export interface RhythmJudgementEvent {
  lane: RhythmLane;
  tier: RhythmJudgeTier;
  /** Signed timing error in ms: negative = FAST (early), positive = SLOW (late) */
  deltaMs: number;
  songTimeMs: number;
  isHoldTick?: boolean;
}

export interface RhythmCameraState {
  zoom: number;
  tiltDeg: number;
  offsetX: number;
  offsetY: number;
  kick: number;
  style: RhythmCameraStyle;
  energy: number;
}

export interface RhythmChartHealthReport {
  totalNotes: number;
  tapCount: number;
  holdCount: number;
  chordGroups: number;
  avgNps: number;
  peakNps: number;
  maxSimultaneous: number;
  overlapWarnings: number;
  rapidJackWarnings: number;
  suggestedLevel: number;
}

/** Sub-millisecond arcade judgement windows (absolute ms) */
export const JUDGE_WINDOWS_MS = {
  MARVELOUS: 22,
  PERFECT: 48,
  GREAT: 85,
  GOOD: 125,
  MISS: 155,
  HOLD_RELEASE_GRACE: 115,
} as const;

export const JUDGE_ACCURACY_WEIGHT: Record<RhythmJudgeTier, number> = {
  MARVELOUS: 1.0,
  PERFECT: 0.985,
  GREAT: 0.72,
  GOOD: 0.4,
  MISS: 0,
};

export const JUDGE_HP_DELTA: Record<RhythmJudgeTier, number> = {
  MARVELOUS: 2.6,
  PERFECT: 2.1,
  GREAT: 0.8,
  GOOD: -1.0,
  MISS: -4.5,
};

export const DEFAULT_RHYTHM_PLAYER_CONFIG: RhythmPlayerConfig = {
  scrollSpeed: 3.0,
  audioOffsetMs: 0,
  visualOffsetMs: 0,
  keyBindings: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  laneDim: 0.82,
  cameraDynamic: true,
  hitsoundPreset: 'clap',
  perspectiveHighway: true,
};

export const TIMING_HISTOGRAM_BINS = 21;
export const TIMING_HISTOGRAM_RANGE_MS = 150;

export function formatKeyCodeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'SPC';
  return code.slice(0, 4).toUpperCase();
}

export function computeRhythmGrade(score: number, counts: RhythmJudgeCounts, totalNotes: number): RhythmGrade {
  if (totalNotes > 0 && counts.MISS === 0 && counts.GOOD === 0 && counts.GREAT === 0 && score >= 995000) {
    return 'PHI';
  }
  if (score >= 970000) return 'S_PLUS';
  if (score >= 920000) return 'S';
  if (score >= 850000) return 'A';
  if (score >= 750000) return 'B';
  return 'C';
}

export function computeClearBadge(
  counts: RhythmJudgeCounts,
  totalNotes: number,
  failed: boolean,
): RhythmClearBadge {
  if (failed) return 'FAIL';
  if (totalNotes > 0 && counts.MISS === 0 && counts.GOOD === 0 && counts.GREAT === 0) return 'AP';
  if (totalNotes > 0 && counts.MISS === 0) return 'FC';
  return 'CLEAR';
}

export function formatGradeLabel(grade: RhythmGrade): string {
  switch (grade) {
    case 'PHI':
      return 'φ';
    case 'S_PLUS':
      return 'S+';
    default:
      return grade;
  }
}

export function normalizeChartNotes(notes: readonly RhythmNote[]): RhythmNote[] {
  const sorted = notes
    .map((n) => ({
      id: n.id,
      lane: (Math.max(0, Math.min(3, Math.round(n.lane))) as RhythmLane),
      timeMs: Math.max(0, Math.round(n.timeMs)),
      durationMs: Math.max(0, Math.round(n.durationMs)),
      isChord: false,
    }))
    .sort((a, b) => (a.timeMs !== b.timeMs ? a.timeMs - b.timeMs : a.lane - b.lane));

  // Deduplicate exact same-lane overlaps within 35ms
  const deduped: RhythmNote[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    let duplicate = false;
    for (let j = deduped.length - 1; j >= 0; j--) {
      const prev = deduped[j];
      if (cur.timeMs - prev.timeMs > 35) break;
      if (prev.lane === cur.lane) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) deduped.push(cur);
  }

  // Flag simultaneous notes (within 14ms) as chords for platinum chord-bridge rendering
  for (let i = 0; i < deduped.length; i++) {
    const a = deduped[i];
    if (i > 0 && Math.abs(a.timeMs - deduped[i - 1].timeMs) <= 14) {
      a.isChord = true;
      deduped[i - 1].isChord = true;
    }
  }
  return deduped;
}

export function computeChartMetrics(
  notes: readonly RhythmNote[],
  durationMs: number,
  binsCount = 64,
): { densityBins: number[]; peakNps: number; avgNps: number } {
  const safeDuration = Math.max(4000, durationMs);
  const rawBins = new Array<number>(binsCount).fill(0);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const idx = Math.min(binsCount - 1, Math.max(0, Math.floor((n.timeMs / safeDuration) * binsCount)));
    rawBins[idx] += n.durationMs > 0 ? 1.35 : 1;
  }
  let maxBin = 0;
  for (let i = 0; i < binsCount; i++) {
    if (rawBins[i] > maxBin) maxBin = rawBins[i];
  }
  const densityBins = rawBins.map((v) => (maxBin > 0 ? Number((v / maxBin).toFixed(3)) : 0));

  // Sliding 1-second window peak NPS
  let peakNps = 0;
  let left = 0;
  for (let right = 0; right < notes.length; right++) {
    while (notes[right].timeMs - notes[left].timeMs > 1000) left++;
    const count = right - left + 1;
    if (count > peakNps) peakNps = count;
  }

  const avgNps = Number((notes.length / (safeDuration / 1000)).toFixed(2));
  return { densityBins, peakNps, avgNps };
}

export function buildRhythmChart(
  difficulty: RhythmDifficulty,
  level: number,
  rawNotes: readonly RhythmNote[],
  durationMs: number,
): RhythmChart {
  const notes = normalizeChartNotes(rawNotes);
  const { densityBins, peakNps, avgNps } = computeChartMetrics(notes, durationMs);
  return {
    difficulty,
    level: Math.max(1, Math.min(16, Math.round(level))),
    notes,
    densityBins,
    peakNps,
    avgNps,
  };
}

export function inspectChartHealth(
  notes: readonly RhythmNote[],
  durationMs: number,
): RhythmChartHealthReport {
  const sorted = normalizeChartNotes(notes);
  let tapCount = 0;
  let holdCount = 0;
  let chordGroups = 0;
  let maxSimultaneous = sorted.length > 0 ? 1 : 0;
  let overlapWarnings = 0;
  let rapidJackWarnings = 0;

  const laneEndTimes = [-9999, -9999, -9999, -9999];
  const laneLastStart = [-9999, -9999, -9999, -9999];

  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].timeMs - sorted[i].timeMs <= 14) j++;
    const groupSize = j - i;
    if (groupSize >= 2) chordGroups++;
    if (groupSize > maxSimultaneous) maxSimultaneous = groupSize;

    for (let k = i; k < j; k++) {
      const n = sorted[k];
      if (n.durationMs > 0) holdCount++;
      else tapCount++;

      if (n.timeMs < laneEndTimes[n.lane] + 25) {
        overlapWarnings++;
      }
      if (n.timeMs - laneLastStart[n.lane] < 85 && laneLastStart[n.lane] >= 0) {
        rapidJackWarnings++;
      }
      laneLastStart[n.lane] = n.timeMs;
      laneEndTimes[n.lane] = n.timeMs + n.durationMs;
    }
    i = j;
  }

  const { peakNps, avgNps } = computeChartMetrics(sorted, durationMs);
  const suggestedLevel = Math.max(
    1,
    Math.min(16, Math.round(avgNps * 1.45 + peakNps * 0.42 + (chordGroups > 20 ? 1.5 : 0))),
  );

  return {
    totalNotes: sorted.length,
    tapCount,
    holdCount,
    chordGroups,
    avgNps,
    peakNps,
    maxSimultaneous,
    overlapWarnings,
    rapidJackWarnings,
    suggestedLevel,
  };
}

export function validateRhythmProject(raw: unknown): { ok: true; project: RhythmSongProject } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '譜面檔案不是有效的 JSON 物件' };
  const p = raw as Partial<RhythmSongProject>;
  if (p.version !== 1) return { ok: false, error: '不支援的譜面版本（預期 version: 1）' };
  if (typeof p.id !== 'string' || !p.id.trim()) return { ok: false, error: '缺少曲目 ID' };
  if (typeof p.title !== 'string' || !p.title.trim()) return { ok: false, error: '缺少曲目標題' };
  if (typeof p.bpm !== 'number' || !Number.isFinite(p.bpm) || p.bpm < 40 || p.bpm > 300) {
    return { ok: false, error: 'BPM 必須介於 40 到 300 之間' };
  }
  if (typeof p.durationMs !== 'number' || !Number.isFinite(p.durationMs) || p.durationMs < 3000) {
    return { ok: false, error: '曲目長度異常' };
  }
  if (!p.charts || typeof p.charts !== 'object') return { ok: false, error: '缺少難度譜面集合' };

  const charts = {} as Record<RhythmDifficulty, RhythmChart>;
  for (const diff of RHYTHM_DIFFICULTIES) {
    const ch = (p.charts as Record<string, RhythmChart | undefined>)[diff];
    const notes: RhythmNote[] = Array.isArray(ch?.notes)
      ? ch.notes.map((n, idx) => ({
          id: typeof n.id === 'string' ? n.id : `${diff}_${idx}`,
          lane: (Math.max(0, Math.min(3, Math.round(Number(n.lane) || 0))) as RhythmLane),
          timeMs: Math.max(0, Math.round(Number(n.timeMs) || 0)),
          durationMs: Math.max(0, Math.round(Number(n.durationMs) || 0)),
        }))
      : [];
    const level = typeof ch?.level === 'number' && Number.isFinite(ch.level) ? ch.level : 5;
    charts[diff] = buildRhythmChart(diff, level, notes, p.durationMs);
  }

  const cameraCues: RhythmCameraCue[] = Array.isArray(p.cameraCues)
    ? p.cameraCues
        .map((c, idx) => ({
          id: typeof c.id === 'string' ? c.id : `cam_${idx}`,
          timeMs: Math.max(0, Math.round(Number(c.timeMs) || 0)),
          style: c.style ?? 'CALM',
          intensity: Math.max(0.2, Math.min(1.5, Number(c.intensity) || 0.8)),
          label: typeof c.label === 'string' ? c.label : undefined,
        }))
        .sort((a, b) => a.timeMs - b.timeMs)
    : [{ id: 'cam_0', timeMs: 0, style: 'CALM', intensity: 0.7, label: 'Intro' }];

  const project: RhythmSongProject = {
    version: 1,
    id: p.id.trim(),
    title: p.title.trim(),
    subtitle: typeof p.subtitle === 'string' ? p.subtitle : '自訂譜面',
    artist: typeof p.artist === 'string' ? p.artist : 'Pixer Creator',
    genre: typeof p.genre === 'string' ? p.genre : 'Custom Rhythm',
    bpm: Math.round(p.bpm * 10) / 10,
    offsetMs: Math.round(Number(p.offsetMs) || 0),
    durationMs: Math.round(p.durationMs),
    previewStartMs: Math.max(0, Math.round(Number(p.previewStartMs) || Math.min(p.durationMs * 0.25, 15000))),
    previewEndMs: Math.min(
      Math.round(p.durationMs),
      Math.round(Number(p.previewEndMs) || Math.min(p.durationMs, 35000)),
    ),
    accentPrimary: typeof p.accentPrimary === 'string' ? p.accentPrimary : '#38bdf8',
    accentSecondary: typeof p.accentSecondary === 'string' ? p.accentSecondary : '#f59e0b',
    audioSource:
      p.audioSource && p.audioSource.kind === 'custom'
        ? {
            kind: 'custom',
            storageKey: p.audioSource.storageKey,
            fileName: p.audioSource.fileName || `${p.title}.audio`,
          }
        : {
            kind: 'synth',
            recipeId:
              p.audioSource && p.audioSource.kind === 'synth' ? p.audioSource.recipeId : 'starlight-overture',
          },
    charts,
    cameraCues,
    isCustom: p.isCustom ?? true,
  };

  return { ok: true, project };
}
