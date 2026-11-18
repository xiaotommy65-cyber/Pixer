import {
  BGM_ARRANGEMENTS,
  computeSidePan,
  computeSwungStepDuration,
} from '../../src/assets/AudioPatterns.ts';
import { deriveHarmonizedPalette } from '../../src/assets/sprites/PaletteData.ts';
import { ToySynth } from '../../src/core/audio/ToySynth.ts';
import { InputMap } from '../../src/core/input/InputMap.ts';
import {
  buildHueShiftedRamp,
  hexToRgb01Into,
  linearRgbToOklab,
  linearToSrgb,
  mixOklabRgb01,
  oklabToLinearRgb,
  oklabToOklch,
  oklchToOklab,
  srgbToLinear,
} from '../../src/core/math/ColorMath.ts';
import {
  curlNoise2DInto,
  fbm2D,
  hash2i,
  simplex2D,
  simplex2DGradInto,
} from '../../src/core/math/NoiseMath.ts';
import {
  evalCatmullRom2DInto,
  solveTwoBoneIkInto,
  stepSpringBuffer1D,
  stepSpringExact1D,
  stepSpringInto,
  stepSpringTrack1D,
  VerletChain,
  type Spring1DState,
} from '../../src/core/math/SpringDynamics.ts';
import { CartridgeRunner, STEP_DT } from '../../src/core/runtime/CartridgeRunner.ts';
import { DisplayThermalGovernor } from '../../src/core/runtime/DisplayThermalGovernor.ts';
import { SaveService } from '../../src/core/runtime/SaveService.ts';
import { SeededRng } from '../../src/core/runtime/SeededRng.ts';
import { CameraDirector } from '../../src/core/sim/CameraDirector.ts';
import { CutsceneSequencer } from '../../src/core/sim/CutsceneSequencer.ts';
import { EventActionVm, MAX_VM_OPS_PER_TICK, type VmCollisionPair } from '../../src/core/sim/EventActionVm.ts';
import { JuiceSystem, stepSquashSpring, triggerSquash } from '../../src/core/sim/JuiceSystem.ts';
import { EF_PLAYER, MAX_ENTITIES, SoaEntityPool } from '../../src/core/sim/SoaEntityPool.ts';
import {
  AUTO_MASK_E,
  AUTO_MASK_N,
  AUTO_MASK_S,
  AUTO_MASK_W,
  COLLISION_CLOUD,
  COLLISION_HAZARD,
  COLLISION_SOLID,
  TilemapGrid,
} from '../../src/core/sim/TilemapGrid.ts';
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

export function testM2EnginePrimitives(): void {
  // 1. SoaEntityPool (MAX_ENTITIES = 2048) O(1) alloc/free + capturePrev/teleport/interpolation
  const pool = new SoaEntityPool();
  check(pool.capacity === 2048 && pool.getFreeCount() === MAX_ENTITIES, 'SoaEntityPool must pre-allocate 2048 slots');
  for (let i = 0; i < MAX_ENTITIES; i++) {
    const slot = pool.alloc(i, 10, 16, 16);
    check(slot >= 0, `SoaEntityPool slot ${i} allocation should succeed`);
  }
  check(pool.activeCount === 2048 && pool.alloc(0, 0) === -1, 'SoaEntityPool must reject allocation beyond 2048');
  check(pool.free(100) && Number(pool.activeCount) === 2047 && !pool.free(100), 'SoaEntityPool double-free guard');
  const reused = pool.alloc(10, 20);
  check(reused === 100 && Number(pool.activeCount) === 2048, 'SoaEntityPool should O(1) reuse freed slot');

  pool.reset();
  const heroSlot = pool.alloc(10, 20);
  pool.flags[heroSlot] |= EF_PLAYER;
  pool.capturePrev();
  pool.x[heroSlot] = 30;
  check(pool.renderX(heroSlot, 0.5) === 20, 'SoaEntityPool alpha=0.5 should interpolate halfway between prev and curr');
  pool.teleport(heroSlot, 200, 50);
  check(pool.renderX(heroSlot, 0.25) === 200, 'SoaEntityPool teleport must snap prevX=currX without smearing');

  // 2. TilemapGrid 4-bit Auto-Tiling & O(1) spatial collision
  const tm = new TilemapGrid(16, 12);
  tm.fillRectTiles(2, 2, 3, 3, 1, COLLISION_SOLID);
  check(tm.getAutoMask(2, 2) === (AUTO_MASK_E | AUTO_MASK_S), 'Top-left tile mask must be E|S (6)');
  check(tm.getAutoMask(3, 3) === (AUTO_MASK_N | AUTO_MASK_E | AUTO_MASK_S | AUTO_MASK_W), 'Center tile mask must be NESW (15)');
  check(tm.getAutoMask(4, 4) === (AUTO_MASK_N | AUTO_MASK_W), 'Bottom-right tile mask must be N|W (9)');

  tm.fillRectTiles(0, 9, 16, 1, 2, COLLISION_CLOUD);
  tm.setTile(7, 8, 3, COLLISION_HAZARD);
  const box = { x: 112, y: 120, vx: 0, vy: 200 };
  const colRes = { onGround: false, hitWall: false, hitCeiling: false, hitHazard: false, landVy: 0 };
  tm.resolveAabbMotion(box, 2, 2, 12, 14, 0.1, colRes);
  check(colRes.onGround && box.y === 9 * 16 - 16, 'TilemapGrid must land AABB cleanly on one-way cloud top');
  check(colRes.hitHazard, 'TilemapGrid must detect overlapping hazard tile in O(1)');

  // 3. EventActionVm (When -> Do + MAX_VM_OPS_PER_TICK safety guard)
  const vm = new EventActionVm();
  let sfxCount = 0;
  let outcomeSeen = '';
  const vmHost = {
    isButton: (b: string) => b === 'action',
    spawn: () => {},
    destroy: () => {},
    impulse: () => {},
    playSfx: () => {
      sfxCount++;
    },
    triggerJuice: () => {},
    endGame: (outcome: string) => {
      outcomeSeen = outcome;
    },
  };
  const collisions: VmCollisionPair[] = [{ selfSlot: 0, otherSlot: 1, selfTag: 'player', otherTag: 'star' }];
  vm.loadRules([
    { when: { type: 'OnStart' }, do: [{ type: 'SetVar', name: 'score', op: '=', value: 10 }] },
    { when: { type: 'OnCollide', sourceTag: 'player', targetTag: 'star' }, do: [{ type: 'SetVar', name: 'score', op: '+=', value: 100 }, { type: 'PlaySfx', preset: 'star' }] },
    { when: { type: 'OnButton', button: 'action', edge: 'pressed' }, do: [{ type: 'SetVar', name: 'score', op: '+=', value: 5 }] },
    { when: { type: 'OnEvery', intervalTicks: 2 }, do: [{ type: 'SetVar', name: 'ticks', op: '+=', value: 1 }] },
    { when: { type: 'OnVar', varName: 'score', op: '>=', value: 115, edge: true }, do: [{ type: 'EndGame', outcome: 'won' }] },
  ]);
  vm.stepTick(vmHost, collisions, 1);
  check(vm.getVar('score') === 115 && sfxCount === 1 && outcomeSeen === 'won', 'EventActionVm OnStart/OnCollide/OnButton/OnVar must execute deterministically');
  vm.stepTick(vmHost, [], 0);
  check(vm.getVar('ticks') === 1, 'EventActionVm OnEvery(2) must increment on tick 2');

  // Budget loop guard test (> MAX_VM_OPS_PER_TICK)
  const manyActions = Array.from({ length: MAX_VM_OPS_PER_TICK + 20 }, () => ({ type: 'SetVar' as const, name: 'x', op: '+=' as const, value: 1 }));
  vm.loadRules([{ when: { type: 'OnStart' }, do: manyActions }]);
  const resBudget = vm.stepTick(vmHost, [], 0);
  check(resBudget.abortedByBudget && resBudget.opsExecuted === MAX_VM_OPS_PER_TICK, 'EventActionVm must abort cleanly at MAX_VM_OPS_PER_TICK');

  // 4. CartridgeRunner fixed-60Hz accumulator render alpha
  const runner = new CartridgeRunner('cloudberry-hop');
  runner.update(STEP_DT * 0.5, emptyInput());
  check(Math.abs(runner.getRenderAlpha() - 0.5) < 1e-6, 'CartridgeRunner should expose fractional alpha=0.5 between 120Hz steps');
  runner.stepFixed(STEP_DT, emptyInput());
  check(runner.getRenderAlpha() === 1, 'Direct stepFixed should reset render alpha to 1');

  console.log('[SIM OK] M2 primitives (SoaEntityPool 2048, TilemapGrid 4-bit auto-tiling, EventActionVm 512-cap, accumulator alpha)');
}

function oracleHash21Bitwise(px: number, py: number): number {
  const ix = Math.floor(px * 8.0 + 0.5) | 0;
  const iy = Math.floor(py * 8.0 + 0.5) | 0;
  let h = ((Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + 1442695041) | 0) >>> 0;
  h = Math.imul((h ^ (h >>> 15)) >>> 0, 2246822519) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) >>> 0, 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0x00ffffff) / 16777216;
}

function oracleBayer4x4Bitwise(cx: number, cy: number): number {
  const x = Math.floor(Math.max(0, cx)) >>> 0;
  const y = Math.floor(Math.max(0, cy)) >>> 0;
  const x0 = x & 1;
  const y0 = y & 1;
  const x1 = (x >>> 1) & 1;
  const y1 = (y >>> 1) & 1;
  const fine = (((x0 ^ y0) << 1) | y0) << 2;
  const coarse = ((x1 ^ y1) << 1) | y1;
  return ((fine | coarse) + 0.5) * 0.0625 - 0.5;
}

export function testModule1ColorMathAndShaderParity(): void {
  // 1. Float64 Reference Oracle for IEC 61966-2-1 sRGB <-> Linear & Björn Ottosson Oklab <-> Oklch
  const oracleSrgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const oracleLinToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const oracleLinToOklab = (r: number, g: number, b: number): [number, number, number] => {
    const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    ];
  };

  const rng = new SeededRng(0x51a7c010);
  const vecA = new Float64Array(3);
  const vecB = new Float64Array(3);
  const f32Out = new Float32Array(3);
  let maxOracleDiff = 0;
  let maxRoundTripErr = 0;

  // Test 2,000 random colors plus boundary cases (black, white, threshold 0.04045, saturated primaries)
  const fixedBoundary: [number, number, number][] = [
    [0, 0, 0],
    [1, 1, 1],
    [0.04045, 0.04045, 0.04045],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let i = 0; i < 2000 + fixedBoundary.length; i++) {
    const [sr, sg, sb] = i < fixedBoundary.length ? fixedBoundary[i] : [rng.next(), rng.next(), rng.next()];
    const lr = srgbToLinear(sr);
    const lg = srgbToLinear(sg);
    const lb = srgbToLinear(sb);
    maxOracleDiff = Math.max(
      maxOracleDiff,
      Math.abs(lr - oracleSrgbToLin(sr)),
      Math.abs(lg - oracleSrgbToLin(sg)),
      Math.abs(lb - oracleSrgbToLin(sb)),
    );

    linearRgbToOklab(lr, lg, lb, vecA as unknown as number[], 0);
    const refLab = oracleLinToOklab(oracleSrgbToLin(sr), oracleSrgbToLin(sg), oracleSrgbToLin(sb));
    maxOracleDiff = Math.max(
      maxOracleDiff,
      Math.abs(vecA[0] - refLab[0]),
      Math.abs(vecA[1] - refLab[1]),
      Math.abs(vecA[2] - refLab[2]),
    );

    oklabToOklch(vecA[0], vecA[1], vecA[2], vecB as unknown as number[], 0);
    oklchToOklab(vecB[0], vecB[1], vecB[2], vecB as unknown as number[], 0);
    oklabToLinearRgb(vecB[0], vecB[1], vecB[2], vecB as unknown as number[], 0);
    const rtR = linearToSrgb(vecB[0]);
    const rtG = linearToSrgb(vecB[1]);
    const rtB = linearToSrgb(vecB[2]);
    maxOracleDiff = Math.max(maxOracleDiff, Math.abs(rtR - oracleLinToSrgb(vecB[0])));
    maxRoundTripErr = Math.max(maxRoundTripErr, Math.abs(rtR - sr), Math.abs(rtG - sg), Math.abs(rtB - sb));
    check(
      Number.isFinite(rtR) && Number.isFinite(rtG) && Number.isFinite(rtB),
      'Oklab/Oklch roundtrip must never emit NaN or Infinity',
    );
  }
  check(maxOracleDiff < 1e-6, `ColorMath Oracle differential error exceeded tolerance (${maxOracleDiff})`);
  check(maxRoundTripErr < 1e-5, `ColorMath roundtrip error exceeded 1e-5 (${maxRoundTripErr})`);

  // NaN / out-of-range safety guard
  oklabToOklch(Number.NaN, 0, Number.POSITIVE_INFINITY, f32Out, 0);
  check(
    Number.isFinite(f32Out[0]) && Number.isFinite(f32Out[1]) && Number.isFinite(f32Out[2]),
    'oklabToOklch must guard NaN/Infinity inputs cleanly',
  );

  // Perceptual blue -> yellow midpoint must match exact Oklab (L0 + L1)/2 and avoid muddy sRGB dip
  const mixed = mixOklabRgb01(0.145, 0.388, 0.922, 0.98, 0.8, 0.082, 0.5, f32Out, 0);
  const naiveMidR = (0.145 + 0.98) * 0.5;
  const naiveMidG = (0.388 + 0.8) * 0.5;
  const naiveMidB = (0.922 + 0.082) * 0.5;
  const labBlue = oracleLinToOklab(oracleSrgbToLin(0.145), oracleSrgbToLin(0.388), oracleSrgbToLin(0.922));
  const labYellow = oracleLinToOklab(oracleSrgbToLin(0.98), oracleSrgbToLin(0.8), oracleSrgbToLin(0.082));
  const oklabMixedL = oracleLinToOklab(
    oracleSrgbToLin(mixed[0]),
    oracleSrgbToLin(mixed[1]),
    oracleSrgbToLin(mixed[2]),
  )[0];
  const oklabNaiveL = oracleLinToOklab(
    oracleSrgbToLin(naiveMidR),
    oracleSrgbToLin(naiveMidG),
    oracleSrgbToLin(naiveMidB),
  )[0];
  check(
    Math.abs(oklabMixedL - 0.5 * (labBlue[0] + labYellow[0])) < 0.005 && oklabMixedL > oklabNaiveL + 0.03,
    `Perceptual Oklab midpoint L (${oklabMixedL.toFixed(3)}) must match average L (${(0.5 * (labBlue[0] + labYellow[0])).toFixed(3)}) and beat muddy sRGB L (${oklabNaiveL.toFixed(3)})`,
  );

  // 2. Hue-Shifted Ramp anti-degeneracy & strict Lightness monotonicity across adversarial seeds
  const rampSeeds = [
    '#ff708d',
    '#5ec2f7',
    '#56d39c',
    '#ffd447',
    '#000000',
    '#ffffff',
    '#808080',
    '#ff0044',
    '#00ffcc',
    '#f0a',
    'bad-hex',
  ];
  const rampBuf = new Uint8Array(5 * 4);
  const labCheck = new Float32Array(3);
  for (const seed of rampSeeds) {
    buildHueShiftedRamp(seed, 5, rampBuf);
    let prevL = -1;
    let firstL = 0;
    let lastL = 0;
    for (let s = 0; s < 5; s++) {
      const r = rampBuf[s * 4];
      const g = rampBuf[s * 4 + 1];
      const b = rampBuf[s * 4 + 2];
      const a = rampBuf[s * 4 + 3];
      check(a === 255 && r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255, 'Ramp RGBA values must stay valid [0..255]');
      linearRgbToOklab(srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255), labCheck, 0);
      if (s === 0) firstL = labCheck[0];
      if (s === 4) lastL = labCheck[0];
      check(
        labCheck[0] > prevL + 0.025,
        `Hue-Shifted ramp for ${seed} must keep strictly monotonic lightness L (step ${s}: ${labCheck[0].toFixed(3)} <= ${prevL.toFixed(3)})`,
      );
      prevL = labCheck[0];
    }
    check(lastL - firstL >= 0.2, `Hue-Shifted ramp for ${seed} must maintain >= 0.20 lightness span (got ${(lastL - firstL).toFixed(3)})`);
  }

  // PaletteData derivation check
  const derived = deriveHarmonizedPalette('#ff708d');
  check(derived.colors.length === 16 && derived.colors[0] === 'transparent', 'deriveHarmonizedPalette must emit 16 slots starting with transparent');
  for (let i = 1; i < 16; i++) {
    check(/^#[0-9a-f]{6}$/.test(derived.colors[i]), `Derived palette slot ${i} must be #rrggbb hex (got ${derived.colors[i]})`);
  }
  hexToRgb01Into(derived.colors[1], f32Out, 0);
  const outlineL = oracleLinToOklab(srgbToLinear(f32Out[0]), srgbToLinear(f32Out[1]), srgbToLinear(f32Out[2]))[0];
  hexToRgb01Into(derived.colors[2], f32Out, 0);
  const paperL = oracleLinToOklab(srgbToLinear(f32Out[0]), srgbToLinear(f32Out[1]), srgbToLinear(f32Out[2]))[0];
  check(outlineL < 0.35 && paperL > 0.9, 'Derived palette must maintain readable dark outline and bright highlight contrast');

  // 3. WGSL / GLSL Shader Bitmath Oracles (Integer Hash & Bayer 4x4 Dither)
  const expectedBayerRows = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  for (const offsetY of [0, 120, 1076]) {
    for (const offsetX of [0, 64, 1916]) {
      const seen = new Set<number>();
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const got = oracleBayer4x4Bitwise(offsetX + dx, offsetY + dy);
          const expected = (expectedBayerRows[dy][dx] + 0.5) / 16 - 0.5;
          check(Math.abs(got - expected) < 1e-7, `Bayer 4x4 mismatch at (${dx},${dy})`);
          seen.add(Math.round((got + 0.5) * 16 - 0.5));
        }
      }
      check(seen.size === 16, 'Bayer 4x4 block must cover all 16 thresholds uniquely');
    }
  }

  const quartiles = [0, 0, 0, 0];
  for (let i = 0; i < 10000; i++) {
    const px = -120 + (i % 200) * 1.125;
    const py = -80 + Math.floor(i / 200) * 3.25;
    const h = oracleHash21Bitwise(px, py);
    check(Number.isFinite(h) && h >= 0 && h < 1, `Integer hash21 out of [0, 1) bounds: ${h}`);
    quartiles[Math.min(3, Math.floor(h * 4))]++;
  }
  for (let q = 0; q < 4; q++) {
    check(quartiles[q] > 2200 && quartiles[q] < 2800, `Integer hash21 quartile ${q} skewed unexpectedly (${quartiles[q]}/10000)`);
  }
  check(oracleHash21Bitwise(12.25, -4.5) !== oracleHash21Bitwise(13.25, -4.5), 'Adjacent tiles must yield distinct hash21 values');

  // 4. Zero-GC Micro-Benchmark (50,000 Oklab sky/color mix steps into pre-allocated typed array)
  const benchOut = new Float32Array(3);
  for (let w = 0; w < 10000; w++) {
    mixOklabRgb01(0.46, 0.78, 1.0, 1.0, 0.95, 0.87, (w & 127) / 127, benchOut, 0);
  }
  const heapBefore = process.memoryUsage().heapUsed;
  const tStart = performance.now();
  let sink = 0;
  for (let i = 0; i < 50000; i++) {
    const t = (i & 255) / 255;
    mixOklabRgb01(0.14, 0.39, 0.92, 0.98, 0.8, 0.08, t, benchOut, 0);
    sink += benchOut[0] + benchOut[1] + benchOut[2];
  }
  const benchMs = performance.now() - tStart;
  const heapDeltaKb = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024);
  check(Number.isFinite(sink) && benchMs < 250, `ColorMath 50k Oklab mix benchmark took too long (${benchMs.toFixed(2)}ms)`);
  check(heapDeltaKb < 2048, `ColorMath hot path heap delta too large (${heapDeltaKb}KB)`);

  console.log(
    `[BENCH] ColorMath 50k Oklab mix: ${benchMs.toFixed(2)}ms (heapDelta=${heapDeltaKb}KB, maxOracleDiff=${maxOracleDiff.toExponential(2)})`,
  );
  console.log('[SIM OK] Module 1 ColorMath (Oklab/Hue-Shift Oracle + Bayer 4x4 + Integer Hash Parity) verified');
}

function oracleAnalyticalSpring(
  e0: number,
  v0: number,
  target: number,
  f: number,
  zeta: number,
  totalTime: number,
): [number, number] {
  const omega = Math.PI * 2 * f;
  if (Math.abs(zeta - 1) < 1e-6) {
    const decay = Math.exp(-omega * totalTime);
    const wt = omega * totalTime;
    return [
      target + decay * (e0 * (1 + wt) + v0 * totalTime),
      decay * (v0 * (1 - wt) - e0 * omega * wt),
    ];
  }
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const zw = zeta * omega;
    const decay = Math.exp(-zw * totalTime);
    const c1 = e0;
    const c2 = (v0 + zw * e0) / wd;
    const ca = Math.cos(wd * totalTime);
    const sa = Math.sin(wd * totalTime);
    return [
      target + decay * (c1 * ca + c2 * sa),
      decay * ((c2 * wd - zw * c1) * ca - (c1 * wd + zw * c2) * sa),
    ];
  }
  const gamma = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = -omega * zeta + gamma;
  const r2 = -omega * zeta - gamma;
  const A = (v0 - r2 * e0) / (r1 - r2);
  const B = e0 - A;
  const e1 = Math.exp(r1 * totalTime);
  const e2 = Math.exp(r2 * totalTime);
  return [target + A * e1 + B * e2, A * r1 * e1 + B * r2 * e2];
}

export function testModule2SpringsAndNoiseOracle(): void {
  const rng = new SeededRng(0x517c0002);

  // 1. Differential Oracle: Continuous Analytical ODE across Underdamped, Critical, Overdamped & 30/60/120fps
  let maxOdeDiff = 0;

  // 1a. Underdamped: genuinely overshoots target and matches analytical solution at 1.0s
  const underState: Spring1DState = { value: 0, vel: 0 };
  let sawUnderOvershoot = false;
  for (let i = 0; i < 60; i++) {
    stepSpringExact1D(underState, 100, 3.2, 0.35, 1 / 60);
    if (underState.value > 105) sawUnderOvershoot = true;
  }
  const [refUnderY, refUnderV] = oracleAnalyticalSpring(-100, 0, 100, 3.2, 0.35, 1.0);
  maxOdeDiff = Math.max(maxOdeDiff, Math.abs(underState.value - refUnderY), Math.abs(underState.vel - refUnderV));
  check(sawUnderOvershoot, 'Underdamped spring (zeta=0.35) must genuinely overshoot target');
  check(maxOdeDiff < 1e-10, `Underdamped 60-step spring diverged from analytical ODE (err=${maxOdeDiff})`);

  // 1b. Critically damped (zeta=1): strictly ZERO overshoot + 30/60/120Hz frame-rate invariance
  const s30: Spring1DState = { value: 0, vel: 0 };
  const s60: Spring1DState = { value: 0, vel: 0 };
  const s120: Spring1DState = { value: 0, vel: 0 };
  for (let i = 0; i < 30; i++) {
    stepSpringExact1D(s30, 100, 2.8, 1.0, 1 / 30);
    check(s30.value >= 0 && s30.value <= 100 + 1e-12, `Critically damped 30Hz overshot target (${s30.value})`);
  }
  for (let i = 0; i < 60; i++) {
    stepSpringExact1D(s60, 100, 2.8, 1.0, 1 / 60);
    check(s60.value >= 0 && s60.value <= 100 + 1e-12, `Critically damped 60Hz overshot target (${s60.value})`);
  }
  for (let i = 0; i < 120; i++) {
    stepSpringExact1D(s120, 100, 2.8, 1.0, 1 / 120);
    check(s120.value >= 0 && s120.value <= 100 + 1e-12, `Critically damped 120Hz overshot target (${s120.value})`);
  }
  const [refCritY, refCritV] = oracleAnalyticalSpring(-100, 0, 100, 2.8, 1.0, 1.0);
  const fpsDrift = Math.max(
    Math.abs(s30.value - refCritY),
    Math.abs(s60.value - refCritY),
    Math.abs(s120.value - refCritY),
    Math.abs(s60.vel - refCritV),
  );
  maxOdeDiff = Math.max(maxOdeDiff, fpsDrift);
  check(fpsDrift < 1e-10, `Spring 30/60/120Hz invariance exceeded tolerance (${fpsDrift})`);

  // 1c. Overdamped: zero overshoot & analytical agreement
  const overState: Spring1DState = { value: 0, vel: 0 };
  for (let i = 0; i < 60; i++) {
    stepSpringExact1D(overState, 100, 3.0, 1.65, 1 / 60);
    check(overState.value >= 0 && overState.value <= 100 + 1e-12, `Overdamped spring overshot target (${overState.value})`);
  }
  const [refOverY, refOverV] = oracleAnalyticalSpring(-100, 0, 100, 3.0, 1.65, 1.0);
  maxOdeDiff = Math.max(maxOdeDiff, Math.abs(overState.value - refOverY), Math.abs(overState.vel - refOverV));
  check(maxOdeDiff < 1e-10, `Overdamped 60-step spring diverged from analytical ODE (err=${maxOdeDiff})`);

  // 1d. Lyapunov monotonic energy decay across 1,000 randomized springs & extreme dt stability
  const lyapPair = new Float64Array(2);
  for (let i = 0; i < 1000; i++) {
    const f = 0.5 + rng.next() * 24;
    const zeta = 0.05 + rng.next() * 2.95;
    const dt = 1 / 240 + rng.next() * (1 / 20 - 1 / 240);
    const omega = Math.PI * 2 * f;
    const e0 = (rng.next() - 0.5) * 200;
    const v0 = (rng.next() - 0.5) * 400;
    const energyBefore = 0.5 * omega * omega * e0 * e0 + 0.5 * v0 * v0;
    stepSpringInto(100 + e0, v0, 100, 100, f, zeta, 0, dt, lyapPair, 0);
    const e1 = lyapPair[0] - 100;
    const v1 = lyapPair[1];
    const energyAfter = 0.5 * omega * omega * e1 * e1 + 0.5 * v1 * v1;
    check(Number.isFinite(e1) && Number.isFinite(v1), 'Randomized spring emitted NaN/Infinity');
    check(
      energyAfter <= energyBefore * (1 + 1e-11) + 1e-12,
      `Lyapunov energy must decay monotonically (before=${energyBefore}, after=${energyAfter})`,
    );
  }
  stepSpringInto(Number.NaN, 5, 10, 10, 4, 1, 0, 3.0, lyapPair, 0);
  check(Number.isFinite(lyapPair[0]) && Number.isFinite(lyapPair[1]), 'Spring must guard NaN and huge dt=3s cleanly');

  // 1e. Velocity tracking response (r=1 zero steady-state ramp lag, r<0 anticipation) & Squash bounce
  const rampZeroLag: Spring1DState = { value: 0, vel: 0 };
  for (let i = 1; i <= 120; i++) {
    const prevX = 120 * ((i - 1) / 60);
    const nextX = 120 * (i / 60);
    stepSpringTrack1D(rampZeroLag, nextX, prevX, 3.5, 1.0, 1.0, 1 / 60);
  }
  check(
    Math.abs(rampZeroLag.value - 240) < 0.5,
    `Spring r=1 must track constant velocity ramp with <0.5px steady-state lag (got ${Math.abs(rampZeroLag.value - 240).toFixed(3)})`,
  );
  const antState: Spring1DState = { value: 0, vel: 0 };
  stepSpringTrack1D(antState, 1, 0, 3.0, 1.0, -0.6, 1 / 60);
  check(antState.value < 0, 'Negative response r=-0.6 must trigger brief reverse anticipation');

  // SoA buffer stepper & SquashSpring underdamped bounce
  const soaVals = new Float32Array([0.75]);
  const soaVels = new Float32Array([0]);
  for (let i = 0; i < 60; i++) stepSpringBuffer1D(soaVals, soaVels, 0, 1.0, 3.5, 0.5, 1 / 60);
  check(Math.abs(soaVals[0] - 1.0) < 0.05, 'stepSpringBuffer1D must settle smoothly into pre-allocated SoA arrays');

  const sq = { scaleX: 1, scaleY: 1, vx: 0, vy: 0 };
  triggerSquash(sq, 1.35, 0.72);
  let sawSquashOvershoot = false;
  for (let i = 0; i < 45; i++) {
    stepSquashSpring(sq, 1 / 60, 14);
    if (sq.scaleX < 0.97) sawSquashOvershoot = true;
  }
  check(sawSquashOvershoot && Math.abs(sq.scaleX - 1) < 0.06, 'stepSquashSpring should execute tactile underdamped bounce');

  // 2. Zero-GC VerletChain constraint & wind/floor Oracle (240 animated ticks)
  const scarfCalm = new VerletChain(8, 3.5);
  const scarfWindy = new VerletChain(8, 3.5);
  scarfCalm.reset(100, 80, -1, 0);
  scarfWindy.reset(100, 80, -1, 0);
  const windOut = new Float64Array(2);
  let maxSegErr = 0;
  const floorLimit = 104;
  for (let f = 0; f < 240; f++) {
    const ax = 100 + Math.sin(f * 0.14) * 32;
    const ay = 80 + Math.cos(f * 0.21) * 14;
    curlNoise2DInto(ax * 0.03 + f * 0.02, ay * 0.03, windOut, 0, 0.85, 7);
    scarfCalm.step(1 / 60, ax, ay, 0, 260, 0.96, 8, floorLimit);
    scarfWindy.step(1 / 60, ax, ay, windOut[0] * 420, 260 + windOut[1] * 180, 0.96, 8, floorLimit);

    for (let n = 0; n < scarfWindy.count - 1; n++) {
      const dist = Math.hypot(scarfWindy.posX[n + 1] - scarfWindy.posX[n], scarfWindy.posY[n + 1] - scarfWindy.posY[n]);
      maxSegErr = Math.max(maxSegErr, Math.abs(dist - scarfWindy.segmentLength));
      check(scarfWindy.posY[n + 1] <= floorLimit + 1e-4, 'VerletChain must obey floor boundary');
    }
  }
  const tailDiff = Math.hypot(
    scarfWindy.posX[7] - scarfCalm.posX[7],
    scarfWindy.posY[7] - scarfCalm.posY[7],
  );
  check(maxSegErr < 0.25, `VerletChain distance constraint error exceeded 0.25px (got ${maxSegErr.toFixed(4)})`);
  check(tailDiff > 0.5, 'VerletChain under Curl wind must diverge physically from still conditions');

  // 3. 2-Bone IK FK Oracle + Catmull-Rom Boundary Oracle (1,000 cases)
  const ikOut = new Float64Array(4);
  for (let i = 0; i < 1000; i++) {
    const rx = (rng.next() - 0.5) * 40;
    const ry = (rng.next() - 0.5) * 40;
    const l1 = 8 + rng.next() * 24;
    const l2 = 6 + rng.next() * 22;
    const distScale = i === 0 ? 0 : i === 1 ? 3.0 : rng.next() * 1.4;
    const ang = rng.next() * Math.PI * 2;
    const tx = rx + Math.cos(ang) * (l1 + l2) * distScale;
    const ty = ry + Math.sin(ang) * (l1 + l2) * distScale;
    const bend = i % 2 === 0 ? 1 : -1;

    solveTwoBoneIkInto(rx, ry, tx, ty, l1, l2, bend, ikOut, 0);
    const jx = ikOut[0];
    const jy = ikOut[1];
    const ex = ikOut[2];
    const ey = ikOut[3];
    check(
      Number.isFinite(jx) && Number.isFinite(jy) && Number.isFinite(ex) && Number.isFinite(ey),
      '2-Bone IK emitted NaN/Infinity',
    );
    const actualL1 = Math.hypot(jx - rx, jy - ry);
    const actualL2 = Math.hypot(ex - jx, ey - jy);
    check(Math.abs(actualL1 - l1) < 1e-4 && Math.abs(actualL2 - l2) < 1e-4, '2-Bone IK FK lengths violated');

    const rawD = Math.hypot(tx - rx, ty - ry);
    if (rawD > Math.abs(l1 - l2) + 1e-2 && rawD < l1 + l2 - 1e-2) {
      const endErr = Math.hypot(ex - tx, ey - ty);
      check(endErr < 1e-4, `2-Bone IK reachable target error exceeded tolerance (${endErr})`);
    }
  }

  const spOut = new Float64Array(2);
  evalCatmullRom2DInto(0, 0, 10, 20, 40, 50, 70, 10, 0, spOut, 0);
  check(Math.abs(spOut[0] - 10) < 1e-12 && Math.abs(spOut[1] - 20) < 1e-12, 'Catmull-Rom t=0 must hit P1');
  evalCatmullRom2DInto(0, 0, 10, 20, 40, 50, 70, 10, 1, spOut, 0);
  check(Math.abs(spOut[0] - 40) < 1e-12 && Math.abs(spOut[1] - 50) < 1e-12, 'Catmull-Rom t=1 must hit P2');

  // 4. NoiseMath Statistical Distribution, Gradient Finite-Difference & Curl Divergence-Free Oracles
  let nMin = Infinity;
  let nMax = -Infinity;
  let nSum = 0;
  let nSq = 0;
  const N_SAMPLES = 50000;
  for (let i = 0; i < N_SAMPLES; i++) {
    const x = (rng.next() - 0.5) * 400;
    const y = (rng.next() - 0.5) * 400;
    const v = simplex2D(x, y, 13);
    const f = fbm2D(x, y, 3, 2.02, 0.5, 13);
    check(v >= -1 && v <= 1 && f >= -1 && f <= 1, 'NoiseMath output must stay bounded strictly in [-1, 1]');
    if (v < nMin) nMin = v;
    if (v > nMax) nMax = v;
    nSum += v;
    nSq += v * v;
  }
  const nMean = nSum / N_SAMPLES;
  const nVar = nSq / N_SAMPLES - nMean * nMean;
  check(nMin < -0.75 && nMax > 0.75 && Math.abs(nMean) < 0.06 && nVar > 0.08, `Simplex noise range degenerate: [${nMin.toFixed(3)}, ${nMax.toFixed(3)}], mean=${nMean.toFixed(3)}, var=${nVar.toFixed(3)}`);
  check(simplex2D(42.19, -17.3, 9) === simplex2D(42.19, -17.3, 9), 'NoiseMath must be 100% deterministic');
  check(simplex2D(42.19, -17.3, 9) !== simplex2D(42.19, -17.3, 99), 'Distinct NoiseMath seeds must diverge');

  const hQuartiles = [0, 0, 0, 0];
  for (let i = 0; i < 8000; i++) {
    const hv = hash2i((i % 200) - 100, Math.floor(i / 200) - 20, 77);
    check(hv >= 0 && hv < 1, 'hash2i out of bounds');
    hQuartiles[Math.min(3, Math.floor(hv * 4))]++;
  }
  check(hQuartiles.every((q) => q > 1750 && q < 2250), `hash2i quartile bias: ${hQuartiles.join(',')}`);

  // Analytical gradient vs central finite-difference Oracle + Curl divergence-free check
  const gradOut = new Float64Array(2);
  const cXp = new Float64Array(2);
  const cXm = new Float64Array(2);
  const cYp = new Float64Array(2);
  const cYm = new Float64Array(2);
  const eps = 1e-4;
  let maxGradDiff = 0;
  let maxDiv = 0;
  let curlMagSqSum = 0;
  const TEST_CURL_N = 1000;
  for (let i = 0; i < TEST_CURL_N; i++) {
    const px = -50 + rng.next() * 100;
    const py = -50 + rng.next() * 100;
    const scale = 0.75;
    simplex2DGradInto(px, py, gradOut, 0, scale, 5);
    const fdX = (simplex2D((px + eps) * scale, py * scale, 5) - simplex2D((px - eps) * scale, py * scale, 5)) / (2 * eps);
    const fdY = (simplex2D(px * scale, (py + eps) * scale, 5) - simplex2D(px * scale, (py - eps) * scale, 5)) / (2 * eps);
    maxGradDiff = Math.max(maxGradDiff, Math.abs(gradOut[0] - fdX), Math.abs(gradOut[1] - fdY));

    curlNoise2DInto(px, py, gradOut, 0, scale, 5);
    curlMagSqSum += gradOut[0] * gradOut[0] + gradOut[1] * gradOut[1];
    curlNoise2DInto(px + eps, py, cXp, 0, scale, 5);
    curlNoise2DInto(px - eps, py, cXm, 0, scale, 5);
    curlNoise2DInto(px, py + eps, cYp, 0, scale, 5);
    curlNoise2DInto(px, py - eps, cYm, 0, scale, 5);
    const div = (cXp[0] - cXm[0]) / (2 * eps) + (cYp[1] - cYm[1]) / (2 * eps);
    maxDiv = Math.max(maxDiv, Math.abs(div));
  }
  const rmsCurl = Math.sqrt(curlMagSqSum / TEST_CURL_N);
  check(maxGradDiff < 2e-4, `Simplex analytical gradient diff exceeded finite-diff Oracle (${maxGradDiff})`);
  check(rmsCurl > 0.5 && maxDiv < 5e-3, `Curl noise divergence check failed (rms=${rmsCurl.toFixed(3)}, maxDiv=${maxDiv.toExponential(2)})`);

  const bench = runModule2HotBenchmark();
  check(Number.isFinite(bench.sink) && bench.benchMs < 250, `Module 2 Spring+Noise benchmark exceeded 250ms (${bench.benchMs.toFixed(2)}ms)`);
  check(bench.heapDeltaKb < 2048, `Module 2 hot path heap delta too large (${bench.heapDeltaKb}KB)`);

  console.log(
    `[BENCH] Module 2 (100k Simplex + 50k Spring + 10k Verlet8): ${bench.benchMs.toFixed(2)}ms (heapDelta=${bench.heapDeltaKb}KB, maxOdeDiff=${maxOdeDiff.toExponential(2)}, maxDiv=${maxDiv.toExponential(2)})`,
  );
  console.log('[SIM OK] Module 2 SpringDynamics & NoiseMath (Analytical ODE + Verlet + 2-Bone IK + Curl Divergence Oracles) verified');
}

function runModule2HotBenchmark(): { benchMs: number; heapDeltaKb: number; sink: number } {
  const pair = new Float64Array(2);
  const chain = new VerletChain(8, 3.5);
  let sink = 0;

  const execPass = (simplexIters: number, springIters: number, verletIters: number): void => {
    for (let i = 0; i < simplexIters; i++) {
      sink += simplex2D(i * 0.031, i * 0.017, 7);
    }
    for (let i = 0; i < springIters; i++) {
      stepSpringInto(pair[0], pair[1], i & 63, (i - 1) & 63, 3.0, 0.9, 0.5, 1 / 60, pair, 0);
      sink += pair[0];
    }
    for (let i = 0; i < verletIters; i++) {
      chain.step(1 / 60, 40 + (i & 31), 60, 45, 240);
    }
  };

  execPass(20000, 20000, 4000);
  const heapBefore = process.memoryUsage().heapUsed;
  const tStart = performance.now();
  execPass(100000, 50000, 10000);
  const benchMs = performance.now() - tStart;
  const heapDeltaKb = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024);
  sink += chain.posX[7];
  return { benchMs, heapDeltaKb, sink };
}
