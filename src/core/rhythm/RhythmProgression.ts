import type {
  RhythmClearBadge,
  RhythmDifficulty,
  RhythmGrade,
  RhythmPlayRecord,
  RhythmSongProject,
} from './RhythmTypes.ts';

/**
 * Pure DOM-free Progression, Rating, Course Mode (段位巡演) & Achievements Engine
 * for PA-13 «星脈共鳴 Pulse Resonance».
 */

export interface RhythmCourseStageSpec {
  songId: string;
  difficulty: RhythmDifficulty;
}

export interface RhythmCourseDefinition {
  id: string;
  tierCode: string;
  title: string;
  subtitle: string;
  accentHex: string;
  minPassAccuracy: number;
  stages: readonly [RhythmCourseStageSpec, RhythmCourseStageSpec, RhythmCourseStageSpec];
}

export interface RhythmCourseClearRecord {
  courseId: string;
  totalScore: number;
  avgAccuracy: number;
  remainingHp: number;
  maxCombo: number;
  cleared: boolean;
  medal: 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE';
  playedAt: number;
}

export interface RhythmAchievementState {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  progressText: string;
  tier: 'core' | 'silver' | 'gold' | 'prism';
}

export interface RhythmPlayerProfileSummary {
  rating: number;
  rankTitle: string;
  rankCode: string;
  totalPlays: number;
  clearedCharts: number;
  fcCount: number;
  apCount: number;
  coursesCleared: number;
  bestScore: number;
  achievements: RhythmAchievementState[];
}

export const BUILTIN_RHYTHM_COURSES: readonly RhythmCourseDefinition[] = [
  {
    id: 'course-nova-novice',
    tierCode: '段位 I',
    title: '新星啟航巡演',
    subtitle: '三連曲初階巡演 · 體力延續制，熟悉 4K 節奏與長壓軌跡',
    accentHex: '#38bdf8',
    minPassAccuracy: 82,
    stages: [
      { songId: 'starlight-overture', difficulty: 'EASY' },
      { songId: 'neon-corridor', difficulty: 'EASY' },
      { songId: 'frostblade-sprint', difficulty: 'NORMAL' },
    ],
  },
  {
    id: 'course-astral-voyager',
    tierCode: '段位 II',
    title: '星軌漫遊巡演',
    subtitle: '中階三連曲耐力賽 · 高速雙押與多段動態運鏡銜接',
    accentHex: '#f59e0b',
    minPassAccuracy: 88,
    stages: [
      { songId: 'starlight-overture', difficulty: 'NORMAL' },
      { songId: 'neon-corridor', difficulty: 'HARD' },
      { songId: 'singularity-pulse', difficulty: 'NORMAL' },
    ],
  },
  {
    id: 'course-singularity-master',
    tierCode: '段位 III',
    title: '奇點超載殿堂',
    subtitle: '大師級極限三連戰 · 全程高速雙押交互，衝擊星脈共鳴者徽章',
    accentHex: '#c084fc',
    minPassAccuracy: 92,
    stages: [
      { songId: 'neon-corridor', difficulty: 'HARD' },
      { songId: 'frostblade-sprint', difficulty: 'MASTER' },
      { songId: 'singularity-pulse', difficulty: 'MASTER' },
    ],
  },
];

export function computeSingleChartRating(level: number, score: number, badge: RhythmClearBadge): number {
  if (badge === 'FAIL' || score <= 0) return 0;
  const clampedScore = Math.max(0, Math.min(1000000, score));
  let bonus = 0;
  if (clampedScore >= 995000) bonus = 2.0;
  else if (clampedScore >= 970000) bonus = 1.4 + ((clampedScore - 970000) / 25000) * 0.6;
  else if (clampedScore >= 920000) bonus = 0.8 + ((clampedScore - 920000) / 50000) * 0.6;
  else if (clampedScore >= 850000) bonus = ((clampedScore - 850000) / 70000) * 0.8;
  else bonus = -1.2 * (1 - clampedScore / 850000);

  const badgeBoost = badge === 'AP' ? 0.5 : badge === 'FC' ? 0.25 : 0;
  return Math.max(0, Math.round((level + bonus + badgeBoost) * 100) / 100);
}

export function resolveRankTier(rating: number): { rankCode: string; rankTitle: string } {
  if (rating >= 14.5) return { rankCode: 'PRISM', rankTitle: '星脈共鳴者' };
  if (rating >= 11.5) return { rankCode: 'APEX', rankTitle: '天穹指揮家' };
  if (rating >= 8.5) return { rankCode: 'GOLD', rankTitle: '星軌大師' };
  if (rating >= 5.0) return { rankCode: 'SILVER', rankTitle: '銀翼奏者' };
  if (rating > 0) return { rankCode: 'BRONZE', rankTitle: '星光見習生' };
  return { rankCode: 'INIT', rankTitle: '初階星詠' };
}

export function evaluateCourseOutcome(
  course: RhythmCourseDefinition,
  stageRecords: readonly RhythmPlayRecord[],
  remainingHp: number,
  failed: boolean,
): RhythmCourseClearRecord {
  const totalScore = stageRecords.reduce((sum, r) => sum + r.score, 0);
  const avgAccuracy =
    stageRecords.length > 0
      ? Math.round((stageRecords.reduce((sum, r) => sum + r.accuracy, 0) / stageRecords.length) * 100) / 100
      : 0;
  const maxCombo = stageRecords.reduce((best, r) => Math.max(best, r.maxCombo), 0);
  const cleared = !failed && stageRecords.length === course.stages.length && avgAccuracy >= course.minPassAccuracy;

  let medal: RhythmCourseClearRecord['medal'] = 'NONE';
  if (cleared) {
    if (avgAccuracy >= 98.5 && remainingHp >= 75) medal = 'GOLD';
    else if (avgAccuracy >= 94) medal = 'SILVER';
    else medal = 'BRONZE';
  }

  return {
    courseId: course.id,
    totalScore,
    avgAccuracy,
    remainingHp: Math.round(remainingHp * 10) / 10,
    maxCombo,
    cleared,
    medal,
    playedAt: Date.now(),
  };
}

export function evaluatePlayerProfile(params: {
  songs: readonly RhythmSongProject[];
  records: Record<string, RhythmPlayRecord>;
  courseRecords: Record<string, RhythmCourseClearRecord>;
  totalPlays: number;
  customChartCount: number;
}): RhythmPlayerProfileSummary {
  const levelLookup = new Map<string, number>();
  for (const s of params.songs) {
    for (const diff of ['EASY', 'NORMAL', 'HARD', 'MASTER'] as const) {
      levelLookup.set(`${s.id}::${diff}`, s.charts[diff].level);
    }
  }

  const recordValues = Object.values(params.records);
  const chartRatings: number[] = [];
  let clearedCharts = 0;
  let fcCount = 0;
  let apCount = 0;
  let bestScore = 0;
  let bestCombo = 0;
  let sPlusOrBetter = 0;
  let masterCleared = 0;

  for (const rec of recordValues) {
    if (rec.score > bestScore) bestScore = rec.score;
    if (rec.maxCombo > bestCombo) bestCombo = rec.maxCombo;
    if (rec.clearBadge !== 'FAIL') {
      clearedCharts++;
      if (rec.difficulty === 'MASTER') masterCleared++;
    }
    if (rec.clearBadge === 'FC' || rec.clearBadge === 'AP') fcCount++;
    if (rec.clearBadge === 'AP') apCount++;
    if (isHighGrade(rec.grade)) sPlusOrBetter++;

    const lvl = levelLookup.get(`${rec.songId}::${rec.difficulty}`) ?? 6;
    const r = computeSingleChartRating(lvl, rec.score, rec.clearBadge);
    if (r > 0) chartRatings.push(r);
  }

  chartRatings.sort((a, b) => b - a);
  const topSlice = chartRatings.slice(0, 8);
  const rating =
    topSlice.length > 0
      ? Math.round((topSlice.reduce((sum, v) => sum + v, 0) / topSlice.length) * 100) / 100
      : 0;

  const coursesCleared = Object.values(params.courseRecords).filter((c) => c.cleared).length;
  const goldCourses = Object.values(params.courseRecords).filter((c) => c.medal === 'GOLD').length;
  const { rankCode, rankTitle } = resolveRankTier(rating);

  const achievements: RhythmAchievementState[] = [
    {
      id: 'first-resonance',
      title: '初鳴星脈',
      description: '完成任意一首曲目的 4K 舞台演奏',
      unlocked: clearedCharts >= 1,
      progressText: `${Math.min(1, clearedCharts)} / 1`,
      tier: 'core',
    },
    {
      id: 'combo-century',
      title: '百連星瀑',
      description: '單曲達成 100 以上連擊啟動二階超載光束',
      unlocked: bestCombo >= 100,
      progressText: `${Math.min(100, bestCombo)} / 100`,
      tier: 'core',
    },
    {
      id: 'full-combo-virtuoso',
      title: '零失誤演奏家',
      description: '在任意難度取得 FULL COMBO (FC) 徽章',
      unlocked: fcCount >= 1,
      progressText: `${Math.min(1, fcCount)} / 1`,
      tier: 'silver',
    },
    {
      id: 'grade-s-plus',
      title: '星穹金印',
      description: '在任意譜面達成 S+ 或 φ 評級（970,000+ 分）',
      unlocked: sPlusOrBetter >= 1,
      progressText: `${Math.min(1, sPlusOrBetter)} / 1`,
      tier: 'silver',
    },
    {
      id: 'course-graduate',
      title: '段位巡演合格',
      description: '通過任一「段位巡演」三連曲耐力試煉',
      unlocked: coursesCleared >= 1,
      progressText: `${Math.min(1, coursesCleared)} / 1`,
      tier: 'gold',
    },
    {
      id: 'master-breaker',
      title: '奇點突破者',
      description: '在 MASTER 難度下完整通關任一曲目',
      unlocked: masterCleared >= 1,
      progressText: `${Math.min(1, masterCleared)} / 1`,
      tier: 'gold',
    },
    {
      id: 'chart-architect',
      title: '星譜建築師',
      description: '於譜面工坊建立或匯入至少 1 首自訂譜面',
      unlocked: params.customChartCount >= 1,
      progressText: `${Math.min(1, params.customChartCount)} / 1`,
      tier: 'silver',
    },
    {
      id: 'all-perfect-prism',
      title: '絕對共鳴 φ',
      description: '達成 ALL PERFECT (AP) 或段位巡演金章',
      unlocked: apCount >= 1 || goldCourses >= 1,
      progressText: apCount >= 1 ? 'AP 達成' : `${goldCourses} 金章`,
      tier: 'prism',
    },
  ];

  return {
    rating,
    rankTitle,
    rankCode,
    totalPlays: Math.max(params.totalPlays, recordValues.length),
    clearedCharts,
    fcCount,
    apCount,
    coursesCleared,
    bestScore,
    achievements,
  };
}

function isHighGrade(g: RhythmGrade): boolean {
  return g === 'PHI' || g === 'S_PLUS';
}
