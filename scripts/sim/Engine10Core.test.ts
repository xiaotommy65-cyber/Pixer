import assert from 'node:assert/strict';
import test from 'node:test';
import { getBuiltinRhythmSongs } from '../../src/core/rhythm/RhythmBuiltinSongs.ts';
import { RhythmJudgeEngine } from '../../src/core/rhythm/RhythmJudgeEngine.ts';
import {
  BUILTIN_RHYTHM_COURSES,
  computeSingleChartRating,
  evaluateCourseOutcome,
  evaluatePlayerProfile,
  resolveRankTier,
} from '../../src/core/rhythm/RhythmProgression.ts';
import { buildRhythmChart, type RhythmNote } from '../../src/core/rhythm/RhythmTypes.ts';
import {
  CameraRigDirector,
  type ProjectedPoint2D,
} from '../../src/core/runtime/CameraRigDirector.ts';
import {
  GameFlowController,
  resolveSceneCameraShot,
} from '../../src/core/runtime/GameFlowController.ts';

test('CameraRigDirector converges 6DoF poses, projects 3D points accurately, and enforces static gameplay lock', () => {
  const cam = new CameraRigDirector('TITLE_ORBIT');
  assert.equal(cam.getActiveShot(), 'TITLE_ORBIT');

  // Switch to PLAY_SWEEP_LEFT and step 1.5s -> should converge toward left sweep pose
  cam.setShot('PLAY_SWEEP_LEFT', 8.0);
  for (let i = 0; i < 90; i++) cam.step(1 / 60, 16 / 9);
  assert.ok(cam.current.posX < -0.45, `Expected posX < -0.45, got ${cam.current.posX}`);
  assert.ok(cam.current.rollDeg < -1.8, `Expected negative rollDeg, got ${cam.current.rollDeg}`);

  // All 16 floats of viewProjMatrix must remain finite
  for (let i = 0; i < 16; i++) {
    assert.ok(Number.isFinite(cam.viewProjMatrix[i]), `Matrix entry ${i} must be finite`);
  }

  // Projecting highway judge center (0, 0, 0) & horizon (0, 0, -24) must yield horizon above judge line
  cam.snapToShot('PLAY_STANDARD');
  const nearPt: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  const farPt: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  cam.projectPoint3D(0, 0, 0, 1280, 720, nearPt);
  cam.projectPoint3D(0, 0, -24, 1280, 720, farPt);
  assert.equal(nearPt.visible, true);
  assert.equal(farPt.visible, true);
  assert.ok(farPt.y < nearPt.y, `Expected horizon y (${farPt.y}) < judge line y (${nearPt.y})`);
  assert.ok(Math.abs(nearPt.x - 640) < 2, `Expected center x ~640, got ${nearPt.x}`);

  // Static Competitive Lock forces gameplay shots to PLAY_STANDARD while allowing menu shots
  cam.setStaticGameplayLock(true);
  cam.setShot('PLAY_OVERDRIVE', 10);
  assert.equal(cam.getActiveShot(), 'PLAY_STANDARD');
  cam.setShot('RESULT_WIDE', 10);
  assert.equal(cam.getActiveShot(), 'RESULT_WIDE');
});

test('GameFlowController manages 6-act transitions, Fly-In auto-promotion, skip, and pause/resume', () => {
  const flow = new GameFlowController('title');
  assert.equal(flow.getScene(), 'title');
  assert.equal(flow.getSnapshot().bodyStateAttr, 'title');
  assert.equal(resolveSceneCameraShot('lobby'), 'LOBBY_HERO');

  assert.equal(flow.goTo('lobby', 0.4), true);
  assert.equal(flow.getScene(), 'lobby');
  assert.equal(flow.isTransitioning(), true);
  for (let i = 0; i < 30; i++) flow.step(1 / 60);
  assert.equal(flow.isTransitioning(), false);

  // Stage fly-in intro auto-promotes to playing
  flow.startStageIntro(1.0);
  assert.equal(flow.getScene(), 'intro');
  let event: 'none' | 'intro_complete' = 'none';
  for (let i = 0; i < 65; i++) {
    const ev = flow.step(1 / 60);
    if (ev === 'intro_complete') event = ev;
  }
  assert.equal(event, 'intro_complete');
  assert.equal(flow.getScene(), 'playing');

  // Pause & Resume
  assert.equal(flow.pause(), true);
  assert.equal(flow.getSnapshot().bodyStateAttr, 'paused');
  assert.equal(flow.resume(), true);
  assert.equal(flow.getSnapshot().bodyStateAttr, 'playing');

  // Skip intro immediately
  flow.startStageIntro(1.2);
  assert.equal(flow.skipIntro(), true);
  assert.equal(flow.getScene(), 'playing');
});

test('RhythmProgression computes Player Rating, Rank Tiers, 3-Song Course Outcomes & 8 Achievements', () => {
  const songs = getBuiltinRhythmSongs();
  assert.equal(BUILTIN_RHYTHM_COURSES.length, 3);

  const highRating = computeSingleChartRating(13, 998000, 'AP');
  assert.ok(highRating >= 15.0, `Expected Lv.13 AP rating >= 15.0, got ${highRating}`);
  assert.equal(resolveRankTier(highRating).rankCode, 'PRISM');

  // Verify Course outcome evaluation with 3 cleared stages
  const course = BUILTIN_RHYTHM_COURSES[0];
  const mockRecs = course.stages.map((st) => ({
    songId: st.songId,
    difficulty: st.difficulty,
    score: 982000,
    accuracy: 98.8,
    maxCombo: 140,
    totalNotes: 140,
    grade: 'S_PLUS' as const,
    clearBadge: 'FC' as const,
    counts: { MARVELOUS: 120, PERFECT: 20, GREAT: 0, GOOD: 0, MISS: 0 },
    meanOffsetMs: -2,
    timingHistogram: new Array(21).fill(0),
    playedAt: Date.now(),
  }));
  const courseRes = evaluateCourseOutcome(course, mockRecs, 86, false);
  assert.equal(courseRes.cleared, true);
  assert.equal(courseRes.medal, 'GOLD');
  assert.equal(courseRes.totalScore, 982000 * 3);

  const profile = evaluatePlayerProfile({
    songs,
    records: {
      'starlight-overture::NORMAL': mockRecs[0],
    },
    courseRecords: {
      [course.id]: courseRes,
    },
    totalPlays: 4,
    customChartCount: 1,
  });
  assert.ok(profile.rating > 0);
  assert.equal(profile.coursesCleared, 1);
  assert.equal(profile.achievements.length, 8);
  assert.equal(profile.achievements.find((a) => a.id === 'course-graduate')?.unlocked, true);
  assert.equal(profile.achievements.find((a) => a.id === 'chart-architect')?.unlocked, true);
});

test('RhythmJudgeEngine tracks initialHp carry-over and Fever tiers at 50+ combo', () => {
  const notes: RhythmNote[] = Array.from({ length: 55 }, (_, i) => ({
    id: `f_${i}`,
    lane: (i % 4) as 0 | 1 | 2 | 3,
    timeMs: 1000 + i * 200,
    durationMs: 0,
  }));
  const chart = buildRhythmChart('HARD', 9, notes, 15000);
  const engine = new RhythmJudgeEngine({
    songId: 'fever-test',
    chart,
    bpm: 150,
    offsetMs: 0,
    durationMs: 15000,
    cameraCues: [{ id: 'c0', timeMs: 0, style: 'DROP', intensity: 1.0 }],
    initialHp: 62,
  });
  assert.equal(engine.getLiveState().hp, 62);
  assert.equal(engine.getLiveState().feverTier, 0);

  for (let i = 0; i < 52; i++) {
    engine.pressLane((i % 4) as 0 | 1 | 2 | 3, 1000 + i * 200);
  }
  assert.equal(engine.getLiveState().combo, 52);
  assert.equal(engine.getLiveState().feverTier, 1);
});
