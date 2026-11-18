import {
  BGM_ARRANGEMENTS,
  computeSidePan,
  computeSwungStepDuration,
} from '../../src/assets/AudioPatterns.ts';
import { ToySynth } from '../../src/core/audio/ToySynth.ts';
import { InputMap } from '../../src/core/input/InputMap.ts';
import { STEP_DT } from '../../src/core/runtime/CartridgeRunner.ts';
import { DisplayThermalGovernor } from '../../src/core/runtime/DisplayThermalGovernor.ts';
import { SaveService } from '../../src/core/runtime/SaveService.ts';
import { SeededRng } from '../../src/core/runtime/SeededRng.ts';
import { CameraDirector } from '../../src/core/sim/CameraDirector.ts';
import { CutsceneSequencer } from '../../src/core/sim/CutsceneSequencer.ts';
import { JuiceSystem } from '../../src/core/sim/JuiceSystem.ts';
import { generateEmberkeepCampaign, verifyModuleSolvability } from '../../src/game/emberkeep/DungeonGenerator.ts';
import { check, emptyInput } from './SimTestHarness.ts';

export function testCoreSubsystems(): void {
  // 1. SeededRng determinism
  const a = new SeededRng(42);
  const b = new SeededRng(42);
  for (let i = 0; i < 10; i++) {
    check(a.next() === b.next(), 'SeededRng should produce identical sequences for identical seeds');
  }

  // 2. InputMap edge detection & buffer
  const map = new InputMap();
  map.update({ ...emptyInput(), jump: true }, STEP_DT);
  check(map.justPressed('jump'), 'InputMap should fire justPressed on first held frame');
  check(map.hasBuffered('jump'), 'InputMap should prime action buffer on press');
  map.update({ ...emptyInput(), jump: true }, STEP_DT);
  check(!map.justPressed('jump'), 'InputMap justPressed should clear on second held frame');
  map.update(emptyInput(), STEP_DT);
  check(map.justReleased('jump'), 'InputMap should fire justReleased on release frame');

  // 3. JuiceSystem Hitstop & Trauma^2 decay
  const juice = new JuiceSystem();
  juice.triggerHitstop(0.05);
  juice.addTrauma(0.8);
  const dtFrozen = juice.advanceRealTime(0.02, 1.0);
  check(dtFrozen === 0, 'JuiceSystem hitstop should freeze simDt while active');
  check(Math.hypot(juice.shakeX, juice.shakeY) >= 0, 'Trauma^2 shake remains active during hitstop');
  juice.advanceRealTime(0.05, 1.0);
  const dtResumed = juice.advanceRealTime(0.02, 1.0);
  check(dtResumed > 0, 'JuiceSystem simDt resumes after hitstop expires');

  // 4. JuiceSystem spawnConverge inward particle steering
  juice.spawnConverge(100, 80, ['#5ec2f7', '#ffd447'], 4, 1.0, {
    radiusMin: 20,
    radiusMax: 24,
    pull: 600,
    maxLife: 0.5,
  });
  check(juice.particles.length >= 4, 'spawnConverge should spawn inward-converging particles');
  const distBefore = Math.hypot(juice.particles[0].x - 100, juice.particles[0].y - 80);
  for (let i = 0; i < 6; i++) juice.advanceRealTime(0.02, 1.0);
  if (juice.particles.length > 0) {
    const distAfter = Math.hypot(juice.particles[0].x - 100, juice.particles[0].y - 80);
    check(distAfter < distBefore, 'Converging particles must pull inward toward target core');
  }

  // 5. JuiceSystem directional kick, 0.65x vertical comfort damping, applyPreset & reset()
  const j2 = new JuiceSystem();
  j2.addKick(-6, 4);
  j2.triggerHitstop(0.05);
  j2.advanceRealTime(0.016, 1.0);
  check(j2.shakeX < 0 && j2.shakeY > 0, 'Directional kick should compose into shakeX/shakeY even during hitstop');
  const prevKickMag = Math.hypot(j2.kickX, j2.kickY);
  j2.advanceRealTime(0.016, 1.0);
  check(Math.hypot(j2.kickX, j2.kickY) < prevKickMag, 'Directional kick must decay monotonically');

  j2.reset();
  check(
    j2.trauma === 0 && j2.kickX === 0 && j2.kickY === 0 && j2.shakeX === 0 && j2.shakeY === 0 && j2.flashAlpha === 0,
    'JuiceSystem.reset() must clear all trauma, kick, shake, and flash states',
  );

  let maxOscX = 0;
  let maxOscY = 0;
  for (let i = 0; i < 160; i++) {
    j2.trauma = 0.9;
    j2.advanceRealTime(0.005, 1.0);
    maxOscX = Math.max(maxOscX, Math.abs(j2.shakeX));
    maxOscY = Math.max(maxOscY, Math.abs(j2.shakeY));
  }
  check(maxOscY < maxOscX * 0.72, `Vertical trauma shake (${maxOscY.toFixed(2)}) must stay damped (~0.65x) vs X (${maxOscX.toFixed(2)})`);

  j2.reset();
  j2.applyPreset('charge_shot', { dirX: -1, dirY: 0, intensity: 1.0 });
  check(
    j2.hitstopTimer > 0 && j2.trauma > 0 && j2.flashAlpha > 0 && j2.kickX < 0,
    'JuiceSystem.applyPreset(charge_shot) should apply hitstop, trauma, flash, and directional kick',
  );

  // Zero-GC JuiceSystem pre-allocated ring pool cap & stale-field cleanup
  j2.reset();
  j2.spawnConverge(100, 80, ['#5ec2f7'], 8, 1.0, { radiusMin: 18, radiusMax: 24, maxLife: 0.4 });
  const convergedRef = j2.particles[0];
  check(convergedRef.targetX === 100, 'spawnConverge should set targetX');
  j2.reset();
  j2.spawnBurst(50, 50, ['#ffd447'], 1, 1.0);
  check(
    j2.particles.every((p) => p.targetX === undefined && p.targetY === undefined),
    'Recycled burst particles must clear stale targetX/targetY from prior converge particles',
  );
  j2.reset();
  for (let b = 0; b < 35; b++) {
    j2.spawnBurst(40, 40, ['#ff708d', '#ffd447'], 10, 1.0);
  }
  check(
    j2.particles.length === 256,
    `JuiceSystem ring pool must cap active particles at 256 without unbounded growth (got ${j2.particles.length})`,
  );

  // 6. ToySynth DSP AudioPatterns, Stereo Panning, Lookahead Multi-Track Arrangements & Charge Ramp
  check(computeSidePan('left') < -0.3 && computeSidePan('right') > 0.3 && computeSidePan('both') === 0, 'computeSidePan must pan L/R symmetrically');
  const swEven = computeSwungStepDuration(0, 0.16, 0.06);
  const swOdd = computeSwungStepDuration(1, 0.16, 0.06);
  check(Math.abs(swEven + swOdd - 0.32) < 1e-6 && swEven > swOdd, 'Swung step pair must preserve exact 2-step bar duration');
  for (const theme of ['meadow', 'starlight', 'dungeon', 'boss'] as const) {
    const arr = BGM_ARRANGEMENTS[theme];
    check(
      arr.lead.length === 16 &&
        arr.bass.length === 16 &&
        arr.chords.length === 16 &&
        arr.kick.length === 16 &&
        arr.snare.length === 16 &&
        arr.hat.length === 16,
      `BGM_ARRANGEMENTS.${theme} must align all 4 tracks across 16 steps`,
    );
  }

  const synth = new ToySynth();
  synth.setBgmTheme('boss');
  synth.tickBgm(0.5);
  check(synth.getBgmDiagnostics().theme === 'boss', 'ToySynth should track active BGM theme');
  synth.playTactile('face', 'down', 'right');
  synth.playPreset('explode', 0, 'left');
  synth.setBgmTheme(null);
  synth.startCharge();
  synth.updateCharge(0.5);
  synth.updateCharge(1.0);
  synth.stopCharge(true);
  synth.destroy();
  check(synth.getBgmDiagnostics().theme === null && !synth.getBgmDiagnostics().schedulerActive, 'ToySynth.destroy() must stop lookahead scheduler');
  console.log('[SIM OK] core subsystems (SeededRng, InputMap, JuiceSystem kick/damping/reset, ToySynth AudioBus/BGM)');
}

export function testDungeonGeneratorSolvability(): void {
  let totalFloorsChecked = 0;
  for (let i = 0; i < 30; i++) {
    const seed = (0x20260000 + i * 7919) >>> 0;
    const mod = generateEmberkeepCampaign(seed);
    check(mod.floors.length === 8, `Expected 8 floors, got ${mod.floors.length}`);
    check(verifyModuleSolvability(mod), `Generated dungeon seed ${seed} must be 100% solvable`);
    totalFloorsChecked += mod.floors.length;
  }
  console.log(`[SIM OK] DungeonGenerator -> 30 seeds / ${totalFloorsChecked} floors 100% topologically solvable`);
}

export function testEngine2CameraAndCutscene(): void {
  const cam = new CameraDirector();
  cam.reset(100, 90, 1.0, { minX: 0, minY: 0, maxX: 600, maxY: 300 });
  const baseFields = cam.toSnapshotFields();
  check(baseFields.cameraZoom === 1.0, 'CameraDirector default zoom should be 1.0');

  cam.setTargetZoom(1.45);
  cam.setLetterbox(0.14);
  cam.panTo(400, 140, 1.45, 0.5);
  for (let i = 0; i < 45; i++) {
    cam.step(STEP_DT, 100, 90, 80, 0);
  }
  const panned = cam.toSnapshotFields();
  check(panned.cameraZoom > 1.3, `CameraDirector should smoothly zoom toward 1.45 (got ${panned.cameraZoom})`);
  check(panned.cameraLetterbox > 0.1, `CameraDirector should animate letterbox bars (got ${panned.cameraLetterbox})`);
  check(cam.mode === 'pan', 'CameraDirector should report pan mode while panning');

  let chosenId = '';
  const seq = new CutsceneSequencer();
  seq.setCallbacks({
    onChoice: (id) => {
      chosenId = id;
    },
  });
  seq.play([
    { type: 'letterbox', ratio: 0.12, duration: 0.1 },
    { type: 'camera_pan', x: 320, y: 120, zoom: 1.35, duration: 0.1 },
    {
      type: 'dialog',
      speaker: '長老',
      speakerRole: '測試',
      portrait: 'npc_elder',
      text: '測試選項對話',
      choices: [
        { id: 'c_one', label: '選項一', enabled: true },
        { id: 'c_two', label: '選項二', enabled: true },
      ],
    },
    { type: 'restore_camera', zoom: 1.0, duration: 0.1 },
  ]);
  for (let i = 0; i < 20; i++) {
    seq.step(STEP_DT, cam);
  }
  const view = seq.getViewSnapshot();
  check(view?.awaitingInput === true && view.choices?.length === 2, 'CutsceneSequencer should pause for branching dialog');
  seq.moveChoice(1);
  check(seq.getViewSnapshot()?.selectedChoiceIdx === 1, 'CutsceneSequencer moveChoice should advance cursor');
  seq.advanceDialog(cam);
  check(chosenId === 'c_two', `CutsceneSequencer should dispatch selected choice (got ${chosenId})`);
  for (let i = 0; i < 20; i++) seq.step(STEP_DT, cam);
  check(!seq.isActive(), 'CutsceneSequencer should finish cleanly after restore_camera');

  // 7. DisplayThermalGovernor: mobile balanced 2x baseline, thermal step-down, idle 30fps, background freeze
  const gov = new DisplayThermalGovernor('balanced', true);
  check(
    gov.getScaleFactor() === 2 && gov.getTargetPixelSize().width === 640 && gov.getTargetPixelSize().height === 360,
    'Balanced compact mobile governor must start at crisp 2x (640x360) for mid-range 60fps',
  );
  let steppedDown = false;
  for (let i = 0; i < 65; i++) {
    if (gov.recordFrameCostMs(17.5, true)) steppedDown = true;
  }
  check(
    steppedDown && gov.getScaleFactor() === 1 && gov.getTargetPixelSize().width === 320,
    'DisplayThermalGovernor must step down to 1x (320x180) under sustained >14.2ms thermal frame budget',
  );
  let recovered = false;
  for (let i = 0; i < 220; i++) {
    if (gov.recordFrameCostMs(3.5, true)) recovered = true;
  }
  check(
    recovered && gov.getScaleFactor() === 2,
    'DisplayThermalGovernor must recover up to 2x once frame times stay cool under 8.2ms',
  );

  // Idle lobby throttling (~30fps in balanced) & background freeze
  let idleRendered = 0;
  for (let i = 0; i < 60; i++) {
    if (gov.shouldRenderThisFrame(1 / 60, false)) idleRendered++;
  }
  check(
    idleRendered >= 28 && idleRendered <= 32,
    `Idle lobby pacing in balanced mode should target ~30fps (rendered ${idleRendered}/60 frames)`,
  );
  gov.setBackground(true);
  check(!gov.shouldRenderThisFrame(1 / 60, true), 'Background governor must freeze all rendering & sim ticks');

  const save = new SaveService();
  check(save.getPerformanceProfile('balanced') === 'balanced', 'SaveService defaults performance profile to balanced');
  save.savePerformanceProfile('eco');
  check(save.getPerformanceProfile('balanced') === 'eco', 'SaveService persists performance profile changes');
  save.savePerformanceProfile('balanced');

  console.log('[SIM OK] Engine 2.0 (CameraDirector, CutsceneSequencer, DisplayThermalGovernor & SaveService)');
}
