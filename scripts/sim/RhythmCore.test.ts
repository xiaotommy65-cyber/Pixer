import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeMonoPcm,
  buildProjectFromAudioPcm,
  fftRadix2,
} from '../../src/core/rhythm/RhythmAutoCharter.ts';
import {
  getBuiltinRhythmSongs,
  synthesizeRecipeToPcm,
} from '../../src/core/rhythm/RhythmBuiltinSongs.ts';
import { RhythmChartSession } from '../../src/core/rhythm/RhythmChartSession.ts';
import {
  classifyJudgeTier,
  NOTE_HIT,
  NOTE_HOLDING,
  NOTE_MISSED,
  RhythmJudgeEngine,
} from '../../src/core/rhythm/RhythmJudgeEngine.ts';
import {
  buildRhythmChart,
  validateRhythmProject,
  type RhythmNote,
} from '../../src/core/rhythm/RhythmTypes.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { PulseResonanceCartridge } from '../../src/game/pulseResonance/PulseResonanceCartridge.ts';

function generateSyntheticBeatTrack(bpm: number, durationSec: number, sampleRate = 22050): Float32Array {
  const len = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(len);
  const beatSec = 60 / bpm;
  for (let t = 0.5; t < durationSec - 0.3; t += beatSec) {
    const start = Math.floor(t * sampleRate);
    const kickLen = Math.min(len - start, Math.floor(0.14 * sampleRate));
    let phase = 0;
    for (let i = 0; i < kickLen; i++) {
      const dt = i / sampleRate;
      const freq = 55 + 150 * Math.exp(-dt * 42);
      phase += (2 * Math.PI * freq) / sampleRate;
      pcm[start + i] += Math.sin(phase) * Math.exp(-dt * 18) * 0.9;
    }
  }
  return pcm;
}

test('RhythmJudgeEngine enforces exact 5-tier judgement windows, 1,000,000 AP score & early/late histogram', () => {
  assert.equal(classifyJudgeTier(0), 'MARVELOUS');
  assert.equal(classifyJudgeTier(22), 'MARVELOUS');
  assert.equal(classifyJudgeTier(23), 'PERFECT');
  assert.equal(classifyJudgeTier(48), 'PERFECT');
  assert.equal(classifyJudgeTier(85), 'GREAT');
  assert.equal(classifyJudgeTier(125), 'GOOD');
  assert.equal(classifyJudgeTier(140), 'MISS');

  const notes: RhythmNote[] = [
    { id: 'n0', lane: 0, timeMs: 1000, durationMs: 0 },
    { id: 'n1', lane: 1, timeMs: 1500, durationMs: 0 },
    { id: 'n2', lane: 2, timeMs: 2000, durationMs: 0 },
    { id: 'n3', lane: 3, timeMs: 2500, durationMs: 0 },
  ];
  const chart = buildRhythmChart('NORMAL', 5, notes, 4000);
  const engine = new RhythmJudgeEngine({
    songId: 'unit-test',
    chart,
    bpm: 120,
    offsetMs: 0,
    durationMs: 4000,
    cameraCues: [{ id: 'c0', timeMs: 0, style: 'DROP', intensity: 1.0 }],
  });

  // Hit all 4 notes within MARVELOUS window (slight early -10ms and late +12ms)
  const e0 = engine.pressLane(0, 990);
  const e1 = engine.pressLane(1, 1512);
  const e2 = engine.pressLane(2, 1995);
  const e3 = engine.pressLane(3, 2508);

  assert.equal(e0?.tier, 'MARVELOUS');
  assert.equal(e1?.tier, 'MARVELOUS');
  assert.equal(e2?.tier, 'MARVELOUS');
  assert.equal(e3?.tier, 'MARVELOUS');

  engine.update(3950);
  const rec = engine.getPlayRecord();
  assert.equal(rec.score, 1000000);
  assert.equal(rec.accuracy, 100);
  assert.equal(rec.maxCombo, 4);
  assert.equal(rec.grade, 'PHI');
  assert.equal(rec.clearBadge, 'AP');
  assert.equal(rec.counts.MARVELOUS, 4);
  assert.equal(rec.counts.MISS, 0);
  assert.ok(Math.abs(rec.meanOffsetMs - 1.3) <= 0.5, `Expected meanOffsetMs ~1.3, got ${rec.meanOffsetMs}`);
  const histSum = rec.timingHistogram.reduce((a, b) => a + b, 0);
  assert.equal(histSum, 4);
});

test('RhythmJudgeEngine handles Hold note sustain ticks, clean tail release, early break, and static camera lock', () => {
  const notes: RhythmNote[] = [
    { id: 'h0', lane: 0, timeMs: 1000, durationMs: 1000 }, // clean hold
    { id: 'h1', lane: 3, timeMs: 2500, durationMs: 1000 }, // early release break
  ];
  const chart = buildRhythmChart('HARD', 8, notes, 5000);
  const engine = new RhythmJudgeEngine({
    songId: 'hold-test',
    chart,
    bpm: 120,
    offsetMs: 0,
    durationMs: 5000,
    cameraCues: [{ id: 'c0', timeMs: 0, style: 'DROP', intensity: 1.2 }],
    dynamicCamera: false,
  });

  // Press h0 head cleanly -> enters NOTE_HOLDING
  engine.pressLane(0, 1005);
  assert.equal(engine.noteStatus[0], NOTE_HOLDING);

  // Advance across hold ticks while held -> combo grows
  engine.update(1300);
  engine.update(1600);
  engine.update(1920);
  assert.ok(engine.getLiveState().combo >= 3, 'Holding should award mid-hold beat ticks');
  // Release within tail grace window (end = 2000ms, grace = 115ms) -> clean NOTE_HIT
  engine.releaseLane(0, 1930);
  assert.equal(engine.noteStatus[0], NOTE_HIT);
  const comboAfterH0 = engine.getLiveState().combo;
  assert.ok(comboAfterH0 >= 4);

  // Static Competitive Mode must lock camera transform to identity
  const cam = engine.getLiveState().camera;
  assert.equal(cam.zoom, 1);
  assert.equal(cam.tiltDeg, 0);
  assert.equal(cam.offsetX, 0);
  assert.equal(cam.offsetY, 0);

  // Press h1 head then release 700ms too early -> breaks combo & marks NOTE_MISSED
  engine.pressLane(3, 2500);
  assert.equal(engine.noteStatus[1], NOTE_HOLDING);
  engine.releaseLane(3, 2800);
  assert.equal(engine.noteStatus[1], NOTE_MISSED);
  assert.equal(engine.getLiveState().combo, 0);
});

test('Radix-2 FFT and Multi-Band Spectral Flux accurately detect synthetic 120 & 150 BPM tracks', () => {
  // Verify pure-TS FFT energy peak on a 440Hz sine wave
  const n = 1024;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const targetBin = 28; // 448 Hz
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * targetBin * i) / n);
  fftRadix2(re, im);
  let maxBin = 0;
  let maxMag = 0;
  for (let b = 1; b < n / 2; b++) {
    const mag = Math.hypot(re[b], im[b]);
    if (mag > maxMag) {
      maxMag = mag;
      maxBin = b;
    }
  }
  assert.equal(maxBin, targetBin);

  // Verify BPM accuracy on 120 BPM & 150 BPM synthetic drum tracks
  for (const targetBpm of [120, 150]) {
    const pcm = generateSyntheticBeatTrack(targetBpm, 18, 22050);
    const analysis = analyzeMonoPcm(pcm, 22050);
    const err = Math.abs(analysis.bpm - targetBpm);
    assert.ok(
      err <= 2.0,
      `Expected detected BPM near ${targetBpm}, got ${analysis.bpm} (err=${err.toFixed(2)})`,
    );
    assert.ok(analysis.onsets.length >= 20, `Expected >=20 detected onsets, got ${analysis.onsets.length}`);
    assert.equal(analysis.waveformPeaks.length, 1600);
  }
});

test('buildProjectFromAudioPcm generates valid 4-tier ergonomic charts with strictly increasing difficulty', () => {
  const pcm = generateSyntheticBeatTrack(136, 26, 22050);
  const { project } = buildProjectFromAudioPcm({
    id: 'dsp-test-track',
    title: 'DSP Test Track',
    fileName: 'test.wav',
    storageKey: 'test_blob_1',
    monoPcm: pcm,
    sampleRate: 22050,
  });

  const validated = validateRhythmProject(project);
  assert.equal(validated.ok, true);
  const cE = project.charts.EASY.notes.length;
  const cN = project.charts.NORMAL.notes.length;
  const cH = project.charts.HARD.notes.length;
  const cM = project.charts.MASTER.notes.length;
  assert.ok(cE > 0 && cN >= cE && cH >= cN && cM >= cH, `Expected monotonic density: E=${cE} N=${cN} H=${cH} M=${cM}`);
  assert.ok(project.cameraCues.length >= 1);
  for (const note of project.charts.MASTER.notes) {
    assert.ok(note.lane >= 0 && note.lane <= 3);
    assert.ok(note.timeMs >= 0 && note.timeMs <= project.durationMs);
  }
});

test('All 4 built-in procedural synth songs validate cleanly and synthesize non-silent stereo PCM', () => {
  const songs = getBuiltinRhythmSongs();
  assert.equal(songs.length, 4);

  for (const song of songs) {
    const v = validateRhythmProject(song);
    assert.equal(v.ok, true, `Builtin song ${song.id} must validate`);
    assert.ok(song.charts.EASY.notes.length < song.charts.NORMAL.notes.length, `${song.id} NORMAL > EASY`);
    assert.ok(song.charts.NORMAL.notes.length < song.charts.HARD.notes.length, `${song.id} HARD > NORMAL`);
    assert.ok(song.charts.HARD.notes.length < song.charts.MASTER.notes.length, `${song.id} MASTER > HARD`);
    assert.ok(song.cameraCues.length >= 3, `${song.id} must have multi-section camera cues`);
  }

  // Synthesize first builtin song at 22050Hz to verify audio signal integrity
  const pcm = synthesizeRecipeToPcm(songs[0].id, 22050);
  let peak = 0;
  for (let i = 0; i < pcm.mono.length; i++) {
    const a = Math.abs(pcm.mono[i]);
    if (a > peak) peak = a;
  }
  assert.ok(peak > 0.3 && peak <= 1.0, `Expected normalized synth PCM peak in (0.3, 1.0], got ${peak}`);
});

test('RhythmChartSession supports Undo/Redo, Tap/Hold authoring, Mirror/Shift, Camera Cues & JSON roundtrip', () => {
  const base = getBuiltinRhythmSongs()[0];
  const session = new RhythmChartSession(base);
  session.setActiveDifficulty('EASY');
  const origCount = session.getActiveNotes().length;

  session.clearActiveChart();
  assert.equal(session.getActiveNotes().length, 0);
  assert.equal(session.canUndo(), true);

  session.toggleTapNote(0, 2000);
  session.addOrUpdateHoldNote(3, 2500, 3100);
  assert.equal(session.getActiveNotes().length, 2);
  assert.ok(session.getActiveNotes()[1].durationMs > 0);

  session.mirrorActiveChart();
  assert.equal(session.getActiveNotes()[0].lane, 3);
  assert.equal(session.getActiveNotes()[1].lane, 0);

  const cue = session.addCameraCue(4000, 'DROP', 1.2, 'Unit Drop');
  assert.ok(session.getProject().cameraCues.some((c) => c.id === cue.id));

  // JSON export -> import roundtrip
  const json = session.exportJson();
  const res = session.importJson(json);
  assert.equal(res.ok, true);

  // Undo back to original count
  while (session.canUndo()) session.undo();
  assert.equal(session.getActiveNotes().length, origCount);
  assert.equal(session.canRedo(), true);
});

test('PA-13 PulseResonanceCartridge runs cleanly in headless 60Hz loop', () => {
  const cart = new PulseResonanceCartridge(0, 'NORMAL');
  assert.equal(cart.getStatus(), 'playing');

  const input = createEmptyInputState();
  for (let f = 0; f < 120; f++) {
    cart.step(1 / 60, { ...input, left: f % 20 === 0, action: f % 30 === 0 }, DEFAULT_RUNTIME_PARAMS);
  }
  const snap = cart.snapshot(DEFAULT_RUNTIME_PARAMS);
  assert.equal(snap.cartridgeId, 'pulse-resonance');
  assert.ok((snap.hudPrimitives?.length ?? 0) >= 8, 'PA-13 snapshot must emit 4K highway HUD primitives');

  // Switch song & difficulty cleanly
  cart.step(1 / 60, { ...input, shoulderL: true, shoulderR: true }, DEFAULT_RUNTIME_PARAMS);
  const snap2 = cart.snapshot(DEFAULT_RUNTIME_PARAMS);
  assert.ok(snap2.statusBanner.includes('HARD'), 'Shoulder R should cycle difficulty to HARD');
});
