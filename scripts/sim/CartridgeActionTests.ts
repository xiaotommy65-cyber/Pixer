import { AUTO_TILE_SPRITE_GRIDS } from '../../src/assets/sprites/AutoTileSprites.ts';
import { TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { WORKSHOP_RECIPES } from '../../src/assets/WorkshopRecipes.ts';
import { ToySynth } from '../../src/core/audio/ToySynth.ts';
import { GpuEngine } from '../../src/core/gpu/GpuEngine.ts';
import type { IGpuBackend } from '../../src/core/gpu/GpuTypes.ts';
import { getCartridgeControlProfile } from '../../src/core/runtime/CartridgeRegistry.ts';
import { CartridgeRunner, STEP_DT } from '../../src/core/runtime/CartridgeRunner.ts';
import { EngineHost } from '../../src/core/runtime/EngineHost.ts';
import { SaveService } from '../../src/core/runtime/SaveService.ts';
import { validateCartridgeJson, type CartridgeJsonV1 } from '../../src/core/sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../../src/core/sim/DataCartridgeRuntime.ts';
import { MAX_TWEENS, TweenSystem } from '../../src/core/sim/TweenSystem.ts';
import { CelestialParkourGame } from '../../src/game/celestialParkour/CelestialParkourGame.ts';
import cloudberryJson from '../../src/game/cloudberry/cloudberry.cartridge.json' with { type: 'json' };
import { SandboxToyboxGame } from '../../src/game/sandbox/SandboxToyboxGame.ts';
import sugarStarlightJson from '../../src/game/sugarStarlight/sugarStarlight.cartridge.json' with { type: 'json' };
import { buildWorkshopTemplate } from '../../src/ui/WorkshopTemplates.ts';
import { check, emptyInput } from './SimTestHarness.ts';

export function testCloudberryHop(): void {
  check(validateCartridgeJson(cloudberryJson).ok, 'cloudberry.cartridge.json must pass schema validation');
  check(validateCartridgeJson(sugarStarlightJson).ok, 'sugarStarlight.cartridge.json must pass schema validation');
  check(!validateCartridgeJson({ version: 2 }).ok, 'Validator must reject unsupported schema version');
  check(
    validateCartridgeJson({
      ...cloudberryJson,
      stages: [{ ...cloudberryJson.stages[0], worldWidth: 1024 * 16, worldHeight: 256 * 16 }],
    }).ok,
    'Validator must accept M4.2 chunked world bounds up to 1024x256 tiles (16384x4096 px)',
  );
  check(
    !validateCartridgeJson({
      ...cloudberryJson,
      stages: [{ ...cloudberryJson.stages[0], worldWidth: 1025 * 16 }],
    }).ok,
    'Validator must reject oversized tilemap width > 1024 cols',
  );
  check(
    !validateCartridgeJson({
      ...cloudberryJson,
      stages: [{ ...cloudberryJson.stages[0], worldHeight: 257 * 16 }],
    }).ok,
    'Validator must reject oversized tilemap height > 256 rows',
  );
  check(
    !validateCartridgeJson({
      ...cloudberryJson,
      stages: [
        {
          ...cloudberryJson.stages[0],
          worldWidth: 512 * 16,
          worldHeight: 129 * 16,
          tileGrid: { cols: 512, rows: 129, tiles: [], collision: [], spriteMap: {} },
        },
      ],
    }).ok,
    'Validator must reject dense tileGrid exceeding 65536 cells in favor of tileChunks',
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

export function testCelestialParkourAndGrappleEngine3(): void {
  // 1. PA-06 registration, control profile & 16 atlas sprites
  const host = new EngineHost(new CartridgeRunner('celestial-parkour'), new ToySynth(), new SaveService());
  const listed = host.listCartridges();
  const pa06Meta = listed.find((c) => c.id === 'celestial-parkour');
  check(
    pa06Meta !== undefined && pa06Meta.code === 'PA-06' && pa06Meta.preserveActionHold === true,
    'PA-06 celestial-parkour must be registered in EngineHost.listCartridges()',
  );
  const profile = getCartridgeControlProfile('celestial-parkour');
  check(
    Boolean(profile.a && profile.b && profile.x && profile.y && profile.l && profile.r && profile.rightStick && profile.legend),
    'PA-06 must expose full CartridgeControlProfile',
  );
  const atlas = new TextureAtlas();
  for (const sid of [
    'parkour_hero_idle', 'parkour_hero_run_a', 'parkour_hero_run_b',
    'parkour_hero_jump', 'parkour_hero_wall', 'parkour_hero_dash',
    'grapple_claw', 'grapple_ring', 'grapple_link', 'grapple_reticle',
    'scarf_node', 'crystal_reset', 'crumble_tile', 'zip_block', 'ik_joint', 'ik_claw',
  ] as const) {
    check(atlas.hasSprite(sid), `TextureAtlas must register PA-06 sprite '${sid}'`);
  }
  host.destroy();

  const params = new CartridgeRunner('celestial-parkour').getParams();

  // 2. 360-deg aim rotation + 2D DDA wall attach + Circular Pendulum Swing + Slingshot Release
  const swingGame = new CelestialParkourGame(0);
  const aimTargets: [number, number, number][] = [
    [0, -1, -Math.PI * 0.5],
    [-1, 0, Math.PI],
    [0, 1, Math.PI * 0.5],
    [1, 0, 0],
  ];
  for (const [rx, ry, expectedAng] of aimTargets) {
    for (let f = 0; f < 16; f++) {
      swingGame.step(STEP_DT, { ...emptyInput(), rightStickX: rx, rightStickY: ry }, params);
    }
    const ang = swingGame.getGrappleState().aimAngle;
    const diff = Math.abs(Math.atan2(Math.sin(ang - expectedAng), Math.cos(ang - expectedAng)));
    check(diff < 0.08, `PA-06 360-deg aim must rotate smoothly to (${rx},${ry}) (got ${ang.toFixed(2)}, exp ${expectedAng.toFixed(2)})`);
  }

  const firedSwing = swingGame.fireGrappleAt(0, -1, 'swing');
  check(firedSwing, 'PA-06 fireGrappleAt(0,-1,"swing") must lock onto Stage 0 overhead arch via 2D DDA');
  for (let f = 0; f < 14; f++) {
    swingGame.step(STEP_DT, emptyInput(), params);
  }
  const attached = swingGame.getGrappleState();
  check(
    attached.state === 'swinging' && attached.targetKind === 'wall',
    `PA-06 grapple should attach via 2D DDA wall (state=${attached.state}, kind=${attached.targetKind})`,
  );
  const attachSnap = swingGame.snapshot(params);
  check(
    attachSnap.entities.filter((e) => e.sprite === 'grapple_link').length === 7 &&
      attachSnap.entities.some((e) => e.sprite === 'grapple_claw'),
    'PA-06 swinging snapshot must emit 7 grapple_link segments and grapple_claw',
  );

  // Circular Pendulum Swing physics: rope constraint error < 1.5px & angular arc motion
  const heroStartSwing = swingGame.getHeroState();
  const startTheta = Math.atan2(heroStartSwing.y + 8 - attached.anchorY, heroStartSwing.x + 8 - attached.anchorX);
  let maxRopeErr = 0;
  for (let f = 0; f < 24; f++) {
    swingGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
    const gs = swingGame.getGrappleState();
    const hs = swingGame.getHeroState();
    const dist = Math.hypot(hs.x + 8 - gs.anchorX, hs.y + 8 - gs.anchorY);
    maxRopeErr = Math.max(maxRopeErr, Math.abs(dist - gs.ropeLength));
  }
  const preRelHero = swingGame.getHeroState();
  const endTheta = Math.atan2(preRelHero.y + 8 - attached.anchorY, preRelHero.x + 8 - attached.anchorX);
  const arcDelta = Math.abs(endTheta - startTheta);
  check(maxRopeErr < 1.5, `Circular pendulum swing rope error must stay < 1.5px (got ${maxRopeErr.toFixed(3)})`);
  check(
    !preRelHero.onGround && arcDelta > 0.25 && preRelHero.x > heroStartSwing.x + 20 && preRelHero.y < heroStartSwing.y,
    `Circular pendulum swing must produce upward angular arc motion (arc=${arcDelta.toFixed(2)}, x=${preRelHero.x.toFixed(1)}, y=${preRelHero.y.toFixed(1)})`,
  );

  const preReleaseSpeed = Math.hypot(preRelHero.vx, preRelHero.vy);
  const relEvents = swingGame.step(STEP_DT, { ...emptyInput(), jump: true, right: true }, params);
  const postRelHero = swingGame.getHeroState();
  const postReleaseSpeed = Math.hypot(postRelHero.vx, postRelHero.vy);
  check(
    swingGame.getGrappleState().state === 'idle' &&
      relEvents.filter((e) => e === 'jump').length === 1 &&
      postRelHero.airJumpsLeft === 1 &&
      postRelHero.dashCooldown === 0 &&
      postReleaseSpeed > preReleaseSpeed * 1.1 &&
      postRelHero.vy < -100,
    `Slingshot release must boost velocity cleanly without double-jump consume (pre=${preReleaseSpeed.toFixed(1)}, post=${postReleaseSpeed.toFixed(1)}, airJumps=${postRelHero.airJumpsLeft})`,
  );

  // 2b. Mouse 360-deg Aim + Sight-Line (hudPrimitives) + LMB Swing / RMB Zip-Pull
  const mouseGame = new CelestialParkourGame(0);
  mouseGame.step(
    STEP_DT,
    { ...emptyInput(), pointerActive: true, pointerX: 0.78, pointerY: 0.22, left: true },
    params,
  );
  const mouseAim = mouseGame.getGrappleState().aimAngle;
  check(
    mouseAim > -1.4 && mouseAim < -0.05,
    `PA-06 mouse pointer (0.78, 0.22) must aim upper-right decoupled from left:true (got ${mouseAim.toFixed(3)})`,
  );
  const mouseAimSnap = mouseGame.snapshot(params);
  check(
    Boolean(mouseAimSnap.hudPrimitives?.some((p) => p.kind === 'aim_line' && p.worldSpace === true)),
    'PA-06 idle snapshot with active pointer must emit worldSpace aim_line in hudPrimitives',
  );

  const lmbGame = new CelestialParkourGame(0);
  for (let f = 0; f < 24; f++) {
    lmbGame.step(
      STEP_DT,
      { ...emptyInput(), pointerActive: true, pointerX: 0.62, pointerY: 0.16, pointerPrimary: true },
      params,
    );
    if (lmbGame.getGrappleState().state === 'swinging') break;
  }
  const lmbState = lmbGame.getGrappleState();
  check(
    lmbState.state === 'swinging' && lmbState.mode === 'swing',
    `PA-06 pointerPrimary hold must fire & attach in swing mode (state=${lmbState.state}, mode=${lmbState.mode})`,
  );
  for (let f = 0; f < 3; f++) {
    lmbGame.step(
      STEP_DT,
      { ...emptyInput(), pointerActive: true, pointerX: 0.62, pointerY: 0.16, pointerPrimary: true },
      params,
    );
  }
  const lmbPreVy = lmbGame.getHeroState().vy;
  const lmbRelEvents = lmbGame.step(
    STEP_DT,
    { ...emptyInput(), pointerActive: true, pointerX: 0.62, pointerY: 0.16, pointerPrimary: false },
    params,
  );
  check(
    lmbGame.getGrappleState().state === 'idle' &&
      lmbRelEvents.includes('jump') &&
      lmbGame.getHeroState().vy < Math.min(lmbPreVy, -100),
    'Releasing pointerPrimary from swinging must slingshot hero cleanly',
  );
  lmbGame.step(
    STEP_DT,
    { ...emptyInput(), pointerActive: true, pointerX: 0.62, pointerY: 0.16, pointerSecondary: true },
    params,
  );
  check(
    lmbGame.getGrappleState().state !== 'idle' && lmbGame.getGrappleState().mode === 'pull',
    `PA-06 pointerSecondary from idle must fire grapple in pull mode (state=${lmbGame.getGrappleState().state}, mode=${lmbGame.getGrappleState().mode})`,
  );

  // 3. Grapple Zip-Pull toward zip_block & wall
  const pullGame = new CelestialParkourGame(0);
  const pullStart = pullGame.getHeroState();
  check(pullGame.fireGrappleAt(1, 0, 'pull'), 'PA-06 fireGrappleAt(1,0,"pull") must snap onto Stage 0 zip_block');
  let sawPulling = false;
  let peakPullSpeed = 0;
  for (let f = 0; f < 30; f++) {
    pullGame.step(STEP_DT, emptyInput(), params);
    const gs = pullGame.getGrappleState();
    const hs = pullGame.getHeroState();
    if (gs.state === 'pulling') {
      sawPulling = true;
      peakPullSpeed = Math.max(peakPullSpeed, Math.hypot(hs.vx, hs.vy));
    }
  }
  const pullEnd = pullGame.getHeroState();
  check(
    sawPulling && peakPullSpeed >= 300 && pullEnd.x > pullStart.x + 90 && pullEnd.y < pullStart.y - 25,
    `Grapple Zip-Pull must rapidly pull hero toward zip_block (peakSpd=${peakPullSpeed.toFixed(1)}, x=${pullEnd.x.toFixed(1)}, y=${pullEnd.y.toFixed(1)})`,
  );

  const wallPullGame = new CelestialParkourGame(0);
  for (let f = 0; f < 6; f++) wallPullGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
  check(wallPullGame.fireGrappleAt(-1, -0.15, 'pull'), 'PA-06 fireGrappleAt(-1,-0.15,"pull") must target left wall via DDA');
  let touchedWallPull = false;
  for (let f = 0; f < 24; f++) {
    wallPullGame.step(STEP_DT, emptyInput(), params);
    if (wallPullGame.getHeroState().onWall === -1) touchedWallPull = true;
  }
  check(touchedWallPull, 'Grapple Zip-Pull toward wall should pull hero onto wall slide');

  // 4. 8-Way Dash, Wave-Dash, Wall Jump & Dash Refill Crystal Reset
  const dashGame = new CelestialParkourGame(0);
  dashGame.step(STEP_DT, { ...emptyInput(), action: true, right: true, up: true }, params);
  const dHero = dashGame.getHeroState();
  check(
    dHero.dashTimer > 0 && dHero.vx > 150 && dHero.vy < -150,
    `8-way up-right dash must propel hero diagonally (vx=${dHero.vx.toFixed(1)}, vy=${dHero.vy.toFixed(1)})`,
  );
  const dSnap = dashGame.snapshot(params);
  check(
    dSnap.entities.some((e) => e.id.startsWith('after-') && e.sprite === 'parkour_hero_dash'),
    '8-way dash must emit parkour_hero_dash afterimage entities',
  );

  const waveGame = new CelestialParkourGame(0);
  waveGame.step(STEP_DT, { ...emptyInput(), jump: true }, params);
  for (let f = 0; f < 6; f++) waveGame.step(STEP_DT, emptyInput(), params);
  waveGame.step(STEP_DT, { ...emptyInput(), action: true, right: true, down: true }, params);
  for (let f = 0; f < 12; f++) {
    waveGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
    if (waveGame.getHeroState().onGround) {
      waveGame.step(STEP_DT, { ...emptyInput(), right: true, jump: true }, params);
      break;
    }
  }
  const wHero = waveGame.getHeroState();
  check(
    wHero.waveDashed === true && Math.abs(wHero.vx) > params.moveSpeed * 1.3 && wHero.vy < -140,
    `Wave-Dash must set waveDashed=true with >1.3x moveSpeed (vx=${wHero.vx.toFixed(1)}, moveSpeed=${params.moveSpeed})`,
  );

  const wallGame = new CelestialParkourGame(0);
  for (let f = 0; f < 25; f++) wallGame.step(STEP_DT, { ...emptyInput(), left: true }, params);
  wallGame.step(STEP_DT, { ...emptyInput(), left: true, jump: true }, params);
  for (let f = 0; f < 12; f++) wallGame.step(STEP_DT, { ...emptyInput(), left: true }, params);
  const slideHero = wallGame.getHeroState();
  check(
    slideHero.onWall === -1 && slideHero.vy <= 75.01,
    `Wall slide should cling to left wall with vy <= 75 (onWall=${slideHero.onWall}, vy=${slideHero.vy.toFixed(1)})`,
  );
  const wjEvs = wallGame.step(STEP_DT, { ...emptyInput(), left: true, jump: true }, params);
  const wjHero = wallGame.getHeroState();
  check(
    wjEvs.includes('jump') && wjHero.vx >= 160 && wjHero.vy < -150 && !wjHero.facingLeft,
    `Wall jump must kick away from left wall (vx=${wjHero.vx.toFixed(1)}, vy=${wjHero.vy.toFixed(1)})`,
  );

  const crystalGame = new CelestialParkourGame(0);
  for (let f = 0; f < 120; f++) {
    crystalGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
    if (crystalGame.getHeroState().x > 280) break;
  }
  crystalGame.step(STEP_DT, { ...emptyInput(), right: true, jump: true }, params);
  for (let f = 0; f < 6; f++) crystalGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
  crystalGame.step(STEP_DT, { ...emptyInput(), right: true, action: true }, params);
  check(crystalGame.getHeroState().dashCooldown > 0.15, 'Air dash should enter cooldown before touching crystal');
  let crystalRefilled = false;
  for (let f = 0; f < 20; f++) {
    const evs = crystalGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
    if (evs.includes('star') && crystalGame.getHeroState().dashCooldown === 0 && crystalGame.getHeroState().airJumpsLeft === 1) {
      crystalRefilled = true;
      break;
    }
  }
  check(crystalRefilled, 'Dash Refill Crystal must reset dashCooldown to 0 and restore air jump');

  // 5. Engine 3.0 integrations: VerletChain scarf, curlNoise2DInto stream, Two-Bone IK, 480x270 Oklab layers & fgTiles
  const scarfBeforeX = crystalGame.getScarfChain().posX[7];
  for (let f = 0; f < 12; f++) crystalGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
  const scarf = crystalGame.getScarfChain();
  check(scarf.count === 8 && scarf.posX[7] !== scarfBeforeX, 'VerletChain scarf must update trailing node positions');
  for (let i = 0; i < scarf.count - 1; i++) {
    const segLen = Math.hypot(scarf.posX[i + 1] - scarf.posX[i], scarf.posY[i + 1] - scarf.posY[i]);
    check(
      Math.abs(segLen - scarf.segmentLength) < 0.05,
      `VerletChain segment ${i} must converge to ${scarf.segmentLength} (got ${segLen.toFixed(4)})`,
    );
  }
  const st0Snap = crystalGame.snapshot(params);
  check(
    st0Snap.entities.filter((e) => e.sprite === 'scarf_node').length === 8,
    'PA-06 snapshot must emit 8 scarf_node entities',
  );
  check(
    st0Snap.particles.some((p) => (p.curlStrength ?? 0) > 0),
    'PA-06 curlNoise2DInto stream must emit active particles with curlStrength > 0',
  );
  check(
    st0Snap.viewport?.width === 480 && st0Snap.viewport?.height === 270,
    `PA-06 viewport must be 480x270 (got ${st0Snap.viewport?.width}x${st0Snap.viewport?.height})`,
  );
  check(
    st0Snap.bgParallaxLayers?.length === 4 &&
      !st0Snap.bgParallaxLayers.some((l) => l.sprite === 'shrine' || l.sprite === 'astral_core' || l.sprite === 'crystal_reset') &&
      (st0Snap.fgTiles?.length ?? 0) > 0 &&
      st0Snap.hd2dDepth?.waterLevelY !== undefined &&
      st0Snap.tiles.some((t) => t.sprite.startsWith('cliff_m') && t.autoMask !== undefined && t.tint !== undefined) &&
      st0Snap.tiles.some((t) => t.sprite.startsWith('grass_m') && t.autoMask !== undefined),
    `PA-06 snapshot must emit 4 cohesive Oklab bgParallaxLayers, waterLevelY, auto-tiled cliff_m*/grass_m* tiles, and fgTiles (layers=${st0Snap.bgParallaxLayers?.length ?? 0}, fg=${st0Snap.fgTiles?.length ?? 0})`,
  );
  const initSwaySnap = new CelestialParkourGame(0).snapshot(params);
  check(
    Boolean(initSwaySnap.fgTiles?.some((t) => (t.windSway ?? 0) > 0)),
    'PA-06 Stage 0 fgTiles must emit windSway foliage/vine decorations',
  );

  // Stage 5 Two-Bone IK Boss Claw
  const ikGame = new CelestialParkourGame(0);
  for (let expected = 1; expected <= 5; expected++) {
    const evs = ikGame.dispatchCommand('cycle_weapon');
    check(
      evs.includes('snap') && ikGame.getStageIndex() === expected % 5,
      `PA-06 cycle_weapon command must cycle stages cleanly (got ${ikGame.getStageIndex()}, expected ${expected % 5})`,
    );
  }
  ikGame.loadStage(4);
  check(ikGame.getStageIndex() === 4, 'loadStage(4) must activate Stage 5');
  const ikStart = ikGame.getIkClawJoints();
  for (let f = 0; f < 40; f++) {
    ikGame.step(STEP_DT, { ...emptyInput(), right: true }, params);
  }
  const ikEnd = ikGame.getIkClawJoints();
  check(
    ikEnd.active === true &&
      Number.isFinite(ikEnd.rootX) &&
      Number.isFinite(ikEnd.jointX) &&
      Number.isFinite(ikEnd.jointY) &&
      Number.isFinite(ikEnd.endX) &&
      Number.isFinite(ikEnd.endY) &&
      ikEnd.endX > ikStart.endX + 10,
    `Stage 5 Two-Bone IK claw must emit finite coordinates tracking hero (endX ${ikStart.endX.toFixed(1)} -> ${ikEnd.endX.toFixed(1)})`,
  );
  const ikSnap = ikGame.snapshot(params);
  check(
    ikSnap.entities.some((e) => e.sprite === 'ik_joint') && ikSnap.entities.some((e) => e.sprite === 'ik_claw'),
    'Stage 5 snapshot must emit ik_joint and ik_claw entities',
  );

  // Save/Hydrate & L RetryStage sanity
  const saved = ikGame.serializeSave();
  const hydrated = new CelestialParkourGame(0);
  check(hydrated.hydrateSave(saved) && hydrated.getStageIndex() === 4, 'PA-06 serializeSave/hydrateSave must preserve stage index');
  hydrated.step(STEP_DT, { ...emptyInput(), shoulderL: true }, params);
  check(hydrated.getStageIndex() === 4, 'PA-06 L bumper should retry current stage cleanly');

  // 6. 240-frame Ping-Pong Snapshot Zero-GC check
  const gcGame = new CelestialParkourGame(0);
  for (let f = 0; f < 240; f++) {
    gcGame.step(STEP_DT, { ...emptyInput(), right: f % 2 === 0 }, params);
    gcGame.snapshot(params);
  }
  const s0 = gcGame.snapshot(params);
  const s1 = gcGame.snapshot(params);
  const s2 = gcGame.snapshot(params);
  const s3 = gcGame.snapshot(params);
  check(
    s0 === s2 &&
      s1 === s3 &&
      s0 !== s1 &&
      s0.entities === s2.entities &&
      s0.tiles === s2.tiles &&
      s0.tiles.length > 0 &&
      s0.tiles[0] === s2.tiles[0] &&
      s0.entities.length > 0 &&
      s0.entities[0] === s2.entities[0],
    'PA-06 double-buffered ping-pong snapshot banks must strictly reuse snapshot/arrays/slots without GC churn',
  );
  for (let f = 0; f < 240; f++) {
    gcGame.snapshot(params);
  }

  testEngine4PillarIntegration(params);

  console.log(
    `[SIM OK] celestial-parkour PA-06 (360° DDA+Pendulum Swing+Zip-Pull+Wave-Dash+Verlet/Curl/2-Bone IK+240f Zero-GC) -> ropeErr=${maxRopeErr.toFixed(3)}, waveVx=${wHero.vx.toFixed(1)}, ikEnd=(${ikEnd.endX.toFixed(1)},${ikEnd.endY.toFixed(1)})`,
  );
}

export function testEngine4PillarIntegration(params = new CartridgeRunner('celestial-parkour').getParams()): void {
  // Track A: 16-mask AutoTileSprites, 5x7 GPU Bitmap Font, and parallax_twilight_bg
  for (let mask = 0; mask < 16; mask++) {
    for (const prefix of ['cliff_m', 'grass_m'] as const) {
      const grid = AUTO_TILE_SPRITE_GRIDS[`${prefix}${mask}`];
      check(
        Array.isArray(grid) && grid.length === 16 && grid.every((r) => r.length === 16),
        `AUTO_TILE_SPRITE_GRIDS must define 16x16 '${prefix}${mask}'`,
      );
    }
  }
  check(
    AUTO_TILE_SPRITE_GRIDS.vine_hang?.length === 16 && AUTO_TILE_SPRITE_GRIDS.pebble_decal?.length === 16,
    'AUTO_TILE_SPRITE_GRIDS must include vine_hang and pebble_decal',
  );

  const atlas = new TextureAtlas();
  const glyphA = atlas.getGlyphRect(65);
  check(glyphA !== undefined && glyphA.w === 6 && glyphA.h === 8, 'TextureAtlas.getGlyphRect(65) must expose 6x8 glyph A');
  check(atlas.hasSprite('parallax_twilight_bg'), 'TextureAtlas must register default parallax_twilight_bg');

  // Track B: GpuEngine pushDynamicLight / setWaterPlane / drawPixelText
  let capturedDynLights = 0;
  let capturedWaterNorm = 0;
  const mockBackend: IGpuBackend = {
    kind: 'webgpu',
    uploadAtlas: () => {},
    renderFrame: (sky, _alphaItems, _alphaCount, _addItems, _addCount, _timeSec, _lightsData, lightCount) => {
      capturedDynLights = lightCount ?? 0;
      capturedWaterNorm = sky.waterLevelNorm ?? 0;
      return 3;
    },
    resize: () => {},
    dispose: () => {},
  };
  const gpu = new GpuEngine({ width: 480, height: 270 } as unknown as HTMLCanvasElement, undefined, atlas);
  (gpu as unknown as { backend: IGpuBackend }).backend = mockBackend;
  gpu.beginFrame('#16112e', '#ff5d8f', true, 1.0);
  gpu.setWaterPlane(0.82, '#3a6e9c');
  gpu.pushDynamicLight(120, 90, 48, '#ffd447', 0.85, 2.0);
  gpu.drawPixelText('SCORE 100', 16, 12, '#fffaf0', 1, 'left');
  const gpuStats = gpu.flush(1.2);
  check(
    capturedDynLights === 1 && capturedWaterNorm > 0.8 && gpuStats.lightCount >= 1 && gpuStats.spriteCount >= 16,
    `GpuEngine dynamic lights, water plane & drawPixelText must flush cleanly (dynLights=${capturedDynLights}, sprites=${gpuStats.spriteCount})`,
  );

  // Track C1: TweenSystem convergence & fixed-slot reuse
  const tweenSys = new TweenSystem();
  check(MAX_TWEENS === 64 && tweenSys.start('alpha', 0, 100, 0.5, 'quadOut'), 'TweenSystem.start must accept valid tween');
  let lastAlpha = 0;
  for (let i = 0; i < 5; i++) {
    tweenSys.step(0.1, (_k, v) => {
      check(v >= lastAlpha - 1e-6, 'quadOut tween from 0->100 must advance monotonically');
      lastAlpha = v;
    });
  }
  check(Math.abs(lastAlpha - 100) < 1e-4, `TweenSystem must converge to 100 in 0.5s (got ${lastAlpha})`);
  for (let i = 0; i < 240; i++) {
    if (i % 10 === 0) tweenSys.start(`k${i % 8}`, 0, 10, 0.2, 'backOut');
    tweenSys.step(1 / 60, () => {});
  }

  // Track C2: EventActionVm When -> If -> Do (OnSignal, EmitSignal, FloatText, TweenVar)
  const vmTestCart: CartridgeJsonV1 = {
    version: 1,
    meta: { id: 'vm-e4-signal-test', code: 'E4VM', title: 'VM Signal Tween Test', genre: 'platformer' },
    initialVars: { combo: 0, charge: 0 },
    player: { controller: 'platformer', sprite: 'hero_a', w: 16, h: 16, maxHearts: 3 },
    archetypes: { star: { sprite: 'star_a', w: 12, h: 12, tags: ['collectible', 'star'] } },
    stages: [
      {
        id: 'vm-1',
        name: 'VM Test',
        worldWidth: 320,
        worldHeight: 192,
        bgmTheme: 'meadow',
        hint: 'VM',
        spawn: { x: 48, y: 128 },
        tileGrid: {
          cols: 20,
          rows: 12,
          tiles: Array.from({ length: 240 }, (_, idx) => (Math.floor(idx / 20) >= 10 ? 2 : 0)),
          collision: Array.from({ length: 240 }, (_, idx) => (Math.floor(idx / 20) >= 10 ? 1 : 0)),
          spriteMap: { '2': 'stone' },
        },
        spawns: [],
      },
    ],
    rules: [
      {
        id: 'vm-btn-emit',
        when: { type: 'OnButton', button: 'action', edge: 'pressed' },
        do: [
          { type: 'SetVar', name: 'combo', op: '+=', value: 1 },
          { type: 'EmitSignal', signal: 'ping' },
        ],
      },
      {
        id: 'vm-on-signal',
        when: { type: 'OnSignal', signal: 'ping' },
        if: [{ varName: 'combo', op: '>=', value: 1 }],
        do: [
          { type: 'FloatText', text: 'PING!', color: '#ffd447', anchor: 'player', x: 0, y: -12 },
          { type: 'TweenVar', name: 'charge', to: 100, duration: 0.25, ease: 'linear' },
        ],
      },
    ],
  };
  check(validateCartridgeJson(vmTestCart).ok, 'Engine 4.0 VM test cartridge must validate');
  const vmRt = new DataCartridgeRuntime(vmTestCart);
  vmRt.step(STEP_DT, { ...emptyInput(), action: true }, params);
  for (let i = 0; i < 18; i++) vmRt.step(STEP_DT, emptyInput(), params);
  const vmSnap = vmRt.snapshot(params);
  check(
    vmRt.vm.getVar('combo') === 1 &&
      Math.abs(vmRt.vm.getVar('charge') - 100) < 1e-3 &&
      Boolean(vmSnap.hudPrimitives?.some((p) => p.kind === 'text' && p.text === 'PING!')),
    `EventActionVm OnSignal/EmitSignal/FloatText/TweenVar must execute cleanly (combo=${vmRt.vm.getVar('combo')}, charge=${vmRt.vm.getVar('charge')})`,
  );

  // Track C3: Multi-Genre Workshop Templates (Fighter, Card, Grid/Topdown) live runtime tests
  const fRt = new DataCartridgeRuntime(buildWorkshopTemplate('fighter'));
  for (let i = 0; i < 70; i++) {
    fRt.step(STEP_DT, { ...emptyInput(), right: i < 45, action: i === 46 || i === 56 }, params);
  }
  const fSnap0 = fRt.snapshot(params);
  fRt.step(STEP_DT, { ...emptyInput(), skillX: true }, params);
  check(
    fRt.vm.getVar('p2Hp', 100) < 100 &&
      fRt.vm.getVar('combo', 0) >= 1 &&
      fRt.genre.p1.state === 'block' &&
      Boolean(fSnap0.hudPrimitives?.some((p) => p.kind === 'text')),
    `Fighter template must drive jab/block/combo & text HUD (p2Hp=${fRt.vm.getVar('p2Hp')}, combo=${fRt.vm.getVar('combo')})`,
  );
  const fs0 = fRt.snapshot(params);
  const fs1 = fRt.snapshot(params);
  const fs2 = fRt.snapshot(params);
  check(fs0 === fs2 && fs0 !== fs1, 'Fighter runtime must reuse ping-pong snapshot banks');

  const cRt = new DataCartridgeRuntime(buildWorkshopTemplate('card'));
  cRt.step(STEP_DT, { ...emptyInput(), pointerActive: true, pointerX: 58 / 426, pointerY: 222 / 240, pointerPrimary: true }, params);
  check(
    cRt.vm.getVar('mana') === 2 && cRt.vm.getVar('enemyHp') === 15,
    `Card template pointer click must cast STRIKE (mana=${cRt.vm.getVar('mana')}, enemyHp=${cRt.vm.getVar('enemyHp')})`,
  );
  cRt.step(STEP_DT, { ...emptyInput(), skillY: true }, params);
  const cSnap = cRt.snapshot(params);
  check(
    cRt.vm.getVar('turn') === 2 &&
      cRt.vm.getVar('mana') === 3 &&
      cRt.vm.getVar('hp') === 15 &&
      Boolean(cSnap.hudPrimitives?.some((p) => p.kind === 'text' && p.text?.includes('TURN 2'))),
    'Card template end-turn must execute enemy intent, refresh mana, and emit TURN 2 text HUD',
  );
  const cs0 = cRt.snapshot(params);
  const cs1 = cRt.snapshot(params);
  const cs2 = cRt.snapshot(params);
  check(cs0 === cs2 && cs0 !== cs1, 'Card runtime must reuse ping-pong snapshot banks');

  const gRt = new DataCartridgeRuntime(buildWorkshopTemplate('grid'));
  for (let i = 0; i < 120; i++) {
    gRt.step(STEP_DT, { ...emptyInput(), right: true }, params);
  }
  const gSnap = gRt.snapshot(params);
  check(
    gRt.vm.getVar('switches') >= 1 && Boolean(gSnap.hudPrimitives?.some((p) => p.kind === 'text' && p.text?.startsWith('SWITCHES'))),
    `Grid/topdown template crate push must activate switch & emit SWITCHES HUD (switches=${gRt.vm.getVar('switches')})`,
  );
  const gs0 = gRt.snapshot(params);
  const gs1 = gRt.snapshot(params);
  const gs2 = gRt.snapshot(params);
  check(gs0 === gs2 && gs0 !== gs1, 'Grid/topdown runtime must reuse ping-pong snapshot banks');

  const unlockCart: CartridgeJsonV1 = {
    version: 1,
    meta: { id: 'topdown-unlock-test', code: 'TD', title: 'Topdown Unlock Test', genre: 'platformer', genreHud: 'grid' },
    initialVars: { switches: 0, switchesTotal: 1 },
    player: { controller: 'topdown', sprite: 'hero_a', w: 16, h: 16, maxHearts: 3 },
    archetypes: {
      switch_off: { sprite: 'switch_off', spriteB: 'switch_on', w: 16, h: 16, tags: ['logic_switch'] },
      gate: { sprite: 'gate_closed', spriteB: 'gate_open', w: 16, h: 16, tags: ['gate'] },
    },
    stages: [
      {
        id: 'td-1',
        name: 'Unlock Room',
        worldWidth: 320,
        worldHeight: 192,
        bgmTheme: 'dungeon',
        hint: 'Unlock',
        spawn: { x: 32, y: 96 },
        tileGrid: {
          cols: 20,
          rows: 12,
          tiles: new Array<number>(240).fill(0),
          collision: new Array<number>(240).fill(0),
          spriteMap: { '2': 'stone' },
        },
        spawns: [
          { archetype: 'switch_off', x: 64, y: 96 },
          { archetype: 'gate', x: 112, y: 96 },
        ],
      },
    ],
  };
  const unlockRt = new DataCartridgeRuntime(unlockCart);
  for (let i = 0; i < 90; i++) {
    unlockRt.step(STEP_DT, { ...emptyInput(), right: true }, params);
    if (unlockRt.status === 'won') break;
  }
  check(
    unlockRt.gateUnlocked && unlockRt.status === 'won',
    `Topdown switch activation must unlock gate and clear stage on arrival (unlocked=${unlockRt.gateUnlocked}, status=${unlockRt.status})`,
  );

  console.log('[SIM OK] Engine 4.0 Track A/B/C (AutoTile+5x7 Font+DynamicLights/Water+Tween+VM+Fighter/Card/Grid) verified');
}
