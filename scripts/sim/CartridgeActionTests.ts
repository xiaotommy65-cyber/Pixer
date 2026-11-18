import { WORKSHOP_RECIPES } from '../../src/assets/WorkshopRecipes.ts';
import { CartridgeRunner, STEP_DT } from '../../src/core/runtime/CartridgeRunner.ts';
import { validateCartridgeJson } from '../../src/core/sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../../src/core/sim/DataCartridgeRuntime.ts';
import cloudberryJson from '../../src/game/cloudberry/cloudberry.cartridge.json' with { type: 'json' };
import { SandboxToyboxGame } from '../../src/game/sandbox/SandboxToyboxGame.ts';
import sugarStarlightJson from '../../src/game/sugarStarlight/sugarStarlight.cartridge.json' with { type: 'json' };
import { check, emptyInput } from './SimTestHarness.ts';

export function testCloudberryHop(): void {
  check(validateCartridgeJson(cloudberryJson).ok, 'cloudberry.cartridge.json must pass schema validation');
  check(validateCartridgeJson(sugarStarlightJson).ok, 'sugarStarlight.cartridge.json must pass schema validation');
  check(!validateCartridgeJson({ version: 2 }).ok, 'Validator must reject unsupported schema version');
  check(
    !validateCartridgeJson({
      ...cloudberryJson,
      stages: [{ ...cloudberryJson.stages[0], worldWidth: 257 * 16 }],
    }).ok,
    'Validator must reject oversized tilemap width > 256 cols',
  );
  check(
    !validateCartridgeJson({
      ...cloudberryJson,
      stages: [{ ...cloudberryJson.stages[0], spawns: [{ archetype: 'nonexistent', x: 0, y: 0 }] }],
    }).ok,
    'Validator must reject unknown spawn archetype reference',
  );
  check(
    !validateCartridgeJson({
      ...cloudberryJson,
      meta: { ...cloudberryJson.meta, subtitle: 'eval(window.x)' },
    }).ok,
    'Validator must reject eval/Function strings in cartridge JSON',
  );

  // Determinism across 30 / 60 / 120 fps via fixed-step accumulator
  const runAtFps = (fps: number): { camX: number; score: number; stageIdx: number } => {
    const r = new CartridgeRunner('cloudberry-hop');
    const dt = 1 / fps;
    const totalTicks = fps * 3;
    for (let f = 0; f < totalTicks; f++) {
      const inp = emptyInput();
      inp.right = true;
      inp.jump = (f * 60) / fps % 28 < 10;
      r.update(dt, inp);
    }
    const s = r.getSnapshot();
    return { camX: s.cameraX, score: s.score, stageIdx: s.stage?.index ?? 0 };
  };
  const d30 = runAtFps(30);
  const d60 = runAtFps(60);
  const d120 = runAtFps(120);
  check(
    Math.abs(d30.camX - d60.camX) < 1e-4 && Math.abs(d60.camX - d120.camX) < 1e-4 && d30.score === d60.score && d60.score === d120.score,
    `Fixed-timestep accumulator determinism across 30/60/120fps failed (30:${d30.camX.toFixed(2)}/${d30.score}, 60:${d60.camX.toFixed(2)}/${d60.score}, 120:${d120.camX.toFixed(2)}/${d120.score})`,
  );

  const runner = new CartridgeRunner('cloudberry-hop');
  let reachedRight = false;
  let scoreGained = 0;

  for (let frame = 0; frame < 60 * 14; frame++) {
    const inp = emptyInput();
    inp.right = true;
    inp.jump = frame % 28 < 10;
    runner.stepFixed(STEP_DT, inp);
    const snap = runner.getSnapshot();
    if (snap.score > scoreGained) scoreGained = snap.score;
    if (snap.cameraX > 80) reachedRight = true;
  }

  const finalSnap = runner.getSnapshot();
  check(reachedRight, 'Cloudberry hero should traverse sky islands smoothly');
  check(scoreGained > 0, 'Cloudberry hero should collect stars or stomp slimes');
  check(finalSnap.stage?.total === 8 && finalSnap.stage?.index === 1, 'PA-01 should report 1/8 stage progress');
  check(finalSnap.starsTotal === 24, `PA-01 campaign should have 24 total stars (got ${finalSnap.starsTotal})`);

  const cb = new DataCartridgeRuntime(cloudberryJson, { initialStage: 2 });
  const params = runner.getParams();
  let gotFeatherOrMoved = false;
  for (let f = 0; f < 180; f++) {
    cb.step(STEP_DT, { ...emptyInput(), right: true, jump: f % 22 < 8 }, params);
    if (cb.snapshot(params).stage?.index === 3) gotFeatherOrMoved = true;
  }
  check(gotFeatherOrMoved, 'PA-01 W2-1 builds and runs cleanly');
  cb.loadStage(7);
  const bossSnap = cb.snapshot(params);
  check(bossSnap.bossMaxHp === 5, `PA-01 W4-2 Slime King should expose 5 HP bar (got ${bossSnap.bossMaxHp})`);
  check(bossSnap.bgmTheme === 'boss', 'PA-01 W4-2 should emit boss BGM theme');

  const preScoutZoom = cb.snapshot(params).cameraZoom ?? 1.0;
  cb.step(STEP_DT, { ...emptyInput(), skillX: true }, params);
  for (let f = 0; f < 16; f++) cb.step(STEP_DT, emptyInput(), params);
  check((cb.snapshot(params).cameraZoom ?? 1.0) < preScoutZoom, 'PA-01 X button should toggle scout zoom-out');
  cb.step(STEP_DT, { ...emptyInput(), shoulderL: true }, params);
  check(cb.getStageIndex() === 7, 'PA-01 L bumper should retry current stage cleanly');

  console.log(
    `[SIM OK] cloudberry-hop JSON (8 stages / 24 stars + 30/60/120fps determinism + schema guard) -> score=${finalSnap.score}, stars=${finalSnap.starsCollected}/${finalSnap.starsTotal}, bossHp=${bossSnap.bossMaxHp}`,
  );
}

export function testSugarStarlight(): void {
  const runner = new CartridgeRunner('sugar-starlight');
  let maxScore = 0;
  for (let frame = 0; frame < 60 * 18; frame++) {
    const inp = emptyInput();
    inp.jump = true;
    inp.action = frame % 90 < 72;
    inp.up = Math.sin(frame * 0.08) > 0.2;
    inp.down = Math.sin(frame * 0.08) < -0.2;
    runner.stepFixed(STEP_DT, inp);
    const snap = runner.getSnapshot();
    if (snap.score > maxScore) maxScore = snap.score;
  }
  const snap = runner.getSnapshot();
  check(maxScore >= 120, 'Sugar Starlight bolts + charge beam should destroy jelly UFO waves');
  check(snap.bgStars.length === 48, `Sugar Starlight parallax starfield populated (${snap.bgStars.length})`);
  check(snap.stage?.total === 4, 'PA-02 should expose 4-sector campaign progress');
  check(snap.shmupHud !== undefined, 'PA-02 should expose structured shmupHud snapshot');

  const ssHangar = new DataCartridgeRuntime(sugarStarlightJson);
  const params = runner.getParams();
  check(ssHangar.snapshot(params).shmupHud?.phase === 'hangar', 'PA-02 should boot cleanly into Hangar phase');
  ssHangar.dispatchCommand('select_fighter:coral_titan');
  check(ssHangar.getFighterId() === 'coral_titan', 'Hangar select_fighter:coral_titan should switch fighter');
  ssHangar.dispatchCommand('launch_sortie');
  check(ssHangar.snapshot(params).shmupHud?.phase === 'sortie', 'launch_sortie should transition from hangar to sortie');
  check(ssHangar.getBombCount() === 3, `Coral Titan should start with 3 bombs (got ${ssHangar.getBombCount()})`);

  ssHangar.dispatchCommand('weapon:azure');
  check(ssHangar.getWeaponKind() === 'azure', 'weapon:azure should switch to Azure Piercing Rail');
  ssHangar.dispatchCommand('cycle_weapon');
  check(ssHangar.getWeaponKind() === 'violet', 'cycle_weapon from azure should cycle to Violet Homing Plasma');
  ssHangar.dispatchCommand('cycle_weapon');
  check(ssHangar.getWeaponKind() === 'crimson', 'cycle_weapon from violet should wrap back to Crimson Vulcan');

  ssHangar.enterSector(0);
  ssHangar.dispatchCommand('weapon:violet');
  for (let f = 0; f < 60 * 20; f++) {
    const inp = emptyInput();
    inp.jump = true;
    inp.action = f % 85 < 68;
    inp.up = Math.sin(f * 0.09) > 0.25;
    inp.down = Math.sin(f * 0.09) < -0.25;
    ssHangar.step(STEP_DT, inp, params);
    if (ssHangar.snapshot(params).shmupHud?.boss) break;
  }
  const bossHud = ssHangar.snapshot(params).shmupHud?.boss;
  check(bossHud !== undefined && bossHud.activeWeakPoints === 2, 'Sector Boss should spawn with 2 active weak-point wing turrets');
  const bombsBefore = ssHangar.getBombCount();
  check(bombsBefore > 0, 'Fighter should retain at least 1 bomb before Boss Bomb test');
  const bombEvs = ssHangar.dispatchCommand('bomb');
  check(bombEvs.includes('explode'), 'Starlight Bomb should emit explode cue');
  check(ssHangar.getBombCount() === bombsBefore - 1, 'Starlight Bomb should decrement bomb inventory');

  const ssSaveSrc = new DataCartridgeRuntime(sugarStarlightJson, { initialFighter: 'violet_prism', skipHangar: true });
  ssSaveSrc.enterSector(3);
  ssSaveSrc.dispatchCommand('weapon:azure');
  const savedV3 = ssSaveSrc.serializeSave();
  const ssHydrated = new DataCartridgeRuntime(sugarStarlightJson);
  check(ssHydrated.hydrateSave(savedV3), 'PA-02 v3 hydrateSave should succeed');
  check(ssHydrated.getFighterId() === 'violet_prism', 'PA-02 v3 SRAM should preserve fighterId');
  check(ssHydrated.getWeaponKind() === 'azure', 'PA-02 v3 SRAM should preserve weaponKind');
  check(ssHydrated.getSectorIndex() === 3, 'PA-02 v3 SRAM should preserve sector index');

  const ss = new DataCartridgeRuntime(sugarStarlightJson);
  let sawConvergingParticles = false;
  let sawTier1ChargeEvent = false;
  let sawTier1Rail = false;
  let sawTier2Funnels = false;
  let sawTier2MultiBeam = false;

  for (let f = 0; f < 38; f++) {
    const evs = ss.step(STEP_DT, { ...emptyInput(), action: f < 36 }, params);
    const sSnap = ss.snapshot(params);
    if (sSnap.particles.some((p) => p.targetX !== undefined)) sawConvergingParticles = true;
    if (evs.includes('charge')) sawTier1ChargeEvent = true;
    if (evs.includes('rail')) sawTier1Rail = true;
  }
  check(sawConvergingParticles, 'PA-02 Hold-A should spawn inward-converging charge particles');
  check(sawTier1ChargeEvent, 'PA-02 crossing Tier-1 (0.48s) should emit charge cue');
  check(sawTier1Rail, 'PA-02 releasing Tier-1 should fire Piercing Cannon (rail)');

  for (let f = 0; f < 71; f++) {
    ss.step(STEP_DT, { ...emptyInput(), action: f < 69 }, params);
    const sSnap = ss.snapshot(params);
    if (ss.getChargeTier() === 2 && ss.getActiveFunnelCount() >= 2) sawTier2Funnels = true;
    const beamCount = sSnap.entities.filter((e) => e.sprite === 'laser_beam').length;
    if (beamCount >= 5) sawTier2MultiBeam = true;
  }
  check(sawTier2Funnels, 'PA-02 Tier-2 charge should deploy orbiting Floating Funnels');
  check(sawTier2MultiBeam, 'PA-02 Tier-2 release should unleash multi-beam Floating Funnel Salvo');

  const ssCtrl = new DataCartridgeRuntime(sugarStarlightJson, { initialFighter: 'starfalcon', skipHangar: true });
  const preWeapon = ssCtrl.getWeaponKind();
  ssCtrl.step(STEP_DT, { ...emptyInput(), skillX: true }, params);
  check(ssCtrl.getWeaponKind() !== preWeapon, 'PA-02 X button should cycle fighter weapon during sortie');
  const fireEvs = ssCtrl.step(STEP_DT, { ...emptyInput(), shoulderR: true, rightStickY: -0.9 }, params);
  check(fireEvs.includes('laser'), 'PA-02 R bumper should trigger rapid fire laser bolts');
  const preBomb = ssCtrl.getBombCount();
  ssCtrl.step(STEP_DT, { ...emptyInput(), skillY: true }, params);
  check(ssCtrl.getBombCount() === preBomb - 1, 'PA-02 Y button should detonate Starlight Bomb');

  // 2,048-entity pool capacity stress test inside DataCartridgeRuntime
  const stressRt = new DataCartridgeRuntime(sugarStarlightJson, { skipHangar: true });
  for (let i = 0; i < 2048; i++) {
    stressRt.spawnArchetype('player_bolt', 20 + (i % 200), 20 + (i % 120), 0, 0);
  }
  stressRt.step(STEP_DT, emptyInput(), params);
  const stressSnap = stressRt.snapshot(params);
  check(stressSnap.entities.length >= 1800 && stressRt.pool.activeCount <= 2048, `2048-entity runtime stress check (got ${stressSnap.entities.length})`);

  console.log(
    `[SIM OK] sugar-starlight JSON (3 fighters + 3 weapons + X/Y/R + 2048 stress) -> score=${snap.score}, stage=${snap.stage?.index}/${snap.stage?.total}, bgm=${snap.bgmTheme}`,
  );
}

export function testSystemicChainReactionAndPuzzles(): void {
  const puzzleRunner = new CartridgeRunner('sandbox-toybox');
  const pSnap1 = puzzleRunner.getSnapshot();
  check(pSnap1.stage?.total === 10 && pSnap1.stage?.index === 1, 'PA-03 default launch should start 1/10 puzzle campaign');
  check(pSnap1.starsTotal === 21, `PA-03 puzzle campaign should expose 21 stars total (got ${pSnap1.starsTotal})`);

  const sb = new SandboxToyboxGame();
  sb.loadPuzzle(2);
  const params = puzzleRunner.getParams();
  for (let f = 0; f < 160; f++) {
    sb.step(STEP_DT, { ...emptyInput(), right: true }, params);
  }
  const p3Snap = sb.snapshot(params);
  check(p3Snap.stage?.index === 3 || p3Snap.stage?.index === 4, 'PA-03 P3 portal should teleport hero past stone wall');

  const runner = new CartridgeRunner('sandbox-toybox');
  runner.setParam('enemyCount', 0);
  const err = runner.applySandboxScript(`
    api.setSky('#141026', '#2a1d42');
    api.setDarkness(0.75, '#0d091c');
    api.setHeroSpawn(40, 120);
    api.addTorch(24, 134);
    api.addBomb(86, 134);
    api.addBomb(110, 134);
    api.addCrate(128, 134);
    api.addSwitch(132, 134);
    api.addGate(180, 134);
  `);
  check(err === null, 'Systemic dungeon script should evaluate cleanly');

  const eventsSeen = new Set<string>();
  for (let frame = 0; frame < 150; frame++) {
    const inp = emptyInput();
    if (frame === 15) inp.action = true;
    const evs = runner.stepFixed(STEP_DT, inp);
    for (const ev of evs) eventsSeen.add(ev);
  }

  const snap = runner.getSnapshot();
  check(eventsSeen.has('ignite'), 'Action spark should ignite bomb fuse');
  check(eventsSeen.has('explode'), 'Ignited bomb should detonate and chain-react');
  check(snap.hasKey, 'Blast / crate should activate floor switch and unlock gate');
  check((snap.ambientDarkness ?? 0) > 0.7, 'Dark dungeon ambient veil should be preserved in snapshot');

  for (const recipe of WORKSHOP_RECIPES) {
    const rErr = runner.applySandboxScript(recipe.code);
    check(rErr === null, `Workshop recipe "${recipe.label}" should have zero script errors`);
  }

  const remoteGame = new SandboxToyboxGame();
  remoteGame.loadPuzzle(0);
  const remoteEvs = remoteGame.step(STEP_DT, { ...emptyInput(), skillY: true }, params);
  check(remoteEvs.includes('ignite') || remoteEvs.includes('snap'), 'PA-03 Y button should remotely spark/detonate');
  remoteGame.step(STEP_DT, { ...emptyInput(), shoulderL: true }, params);
  check(remoteGame.getPuzzleIndex() === 0, 'PA-03 L bumper should reset current puzzle cleanly');

  console.log(
    `[SIM OK] sandbox-toybox (10 puzzles + Y remote spark + L reset) -> chain=[${Array.from(eventsSeen).join(',')}], gateUnlocked=${snap.hasKey}`,
  );
}

export function testSandboxBenchmark(): void {
  const runner = new CartridgeRunner('sandbox-toybox');
  const err = runner.applySandboxScript(`
    api.setSky('#90d8ff', '#fff0d8');
    api.addCloud(100, 118, 3);
    api.addStar(52, 134);
    api.addStar(116, 98);
    api.addSlime(210, 134);
  `);
  check(err === null, 'Custom sandbox script should evaluate without syntax error');

  runner.toggleBenchmark(true);
  for (let frame = 0; frame < 90; frame++) {
    const inp = emptyInput();
    inp.right = true;
    inp.action = frame % 12 === 0;
    runner.stepFixed(STEP_DT, inp);
  }

  const snap = runner.getSnapshot();
  check(snap.score >= 100, 'Sandbox hero should collect custom-placed star');
  check(runner.benchmarkSprites.length >= 1100, 'Sparkle party mode should maintain 1,100+ sprites');
  console.log(`[SIM OK] benchmark -> score=${snap.score}, benchmarkSprites=${runner.benchmarkSprites.length}`);
}
