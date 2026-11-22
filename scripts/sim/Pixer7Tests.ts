import fs from 'node:fs';
import path from 'node:path';
import { TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { createAgentBridge } from '../../src/core/ai/AgentBridge.ts';
import { runScriptedPlaytest } from '../../src/core/ai/EcsPlaytestVerifier.ts';
import { analyzeActionReachability } from '../../src/core/ai/EcsSpatialOracle.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { EcsCoreWorld } from '../../src/core/ecs/EcsCoreWorld.ts';
import { compileEventGraphToScript, compileScriptToEventGraph } from '../../src/core/ecs/EcsEventGraph.ts';
import { EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import { MAX_VM_OPS_PER_FRAME } from '../../src/core/ecs/SandboxScriptVm.ts';
import { FLOATS_PER_INSTANCE, resolveLogicalViewport } from '../../src/core/gpu/GpuTypes.ts';
import { CartridgeRunner } from '../../src/core/runtime/CartridgeRunner.ts';
import { DisplayThermalGovernor } from '../../src/core/runtime/DisplayThermalGovernor.ts';
import { AnimationStateMachineRuntime, type AnimationStepResult } from '../../src/core/sim/AnimationStateMachine.ts';
import { DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { ASTRAL_RIFT_PROJECT } from '../../src/game/astralRift/AstralRiftProject.ts';
import { CORE_DATA_PLUGINS } from '../../src/game/BuiltinCartridges.ts';
import { RHYTHM_BASTION_PROJECT } from '../../src/game/rhythmBastion/RhythmBastionProject.ts';
import { check, emptyInput } from './SimTestHarness.ts';

export function testPixer7EcsMultiPageAtlasAndSlimCore(): void {
  // 1. Uncapped Logical Viewport up to 1280x720 + DisplayThermalGovernor HD safety guard
  const hdPlus = resolveLogicalViewport('hd_plus');
  const qhd = resolveLogicalViewport('qhd');
  const hd720 = resolveLogicalViewport('hd720');
  check(hdPlus.width === 640 && hdPlus.height === 360, `hd_plus viewport should be 640x360 (got ${hdPlus.width}x${hdPlus.height})`);
  check(qhd.width === 960 && qhd.height === 540, `qhd viewport should be 960x540 (got ${qhd.width}x${qhd.height})`);
  check(hd720.width === 1280 && hd720.height === 720, `hd720 viewport should be 1280x720 (got ${hd720.width}x${hd720.height})`);

  const gov = new DisplayThermalGovernor('quality', false);
  gov.setLogicalViewport(1280, 720);
  const px720 = gov.getTargetPixelSize();
  check(
    px720.width <= 1920 && px720.height <= 1080,
    `DisplayThermalGovernor must clamp 720p pixel output <= 1920x1080 (got ${px720.width}x${px720.height})`,
  );

  // 2. Multi-Page Texture Atlas Pool + Sprite Sheet Slicer
  const atlas = new TextureAtlas();
  const sheetRgba = new Uint8Array(256 * 128 * 4);
  sheetRgba.fill(200);
  const meta = atlas.importSpriteSheet('test_hero_sheet', sheetRgba, 256, 128, 4, 2);
  check(
    meta.frameIds.length === 8 && meta.frameW === 64 && meta.frameH === 64,
    `importSpriteSheet should slice 256x128 (4x2) into 8x 64x64 frames (got ${meta.frameIds.length})`,
  );
  check(atlas.hasSprite('test_hero_sheet:7'), 'Sliced frame test_hero_sheet:7 must exist in TextureAtlas');
  check(atlas.listSpriteSheets().length === 1, 'TextureAtlas.listSpriteSheets() should record imported sheet');

  // Stress-spill page 0 with large 256x256 sprites to confirm multi-page pool expansion (>= 2 pages)
  const bigRgba = new Uint8Array(256 * 256 * 4);
  bigRgba.fill(180);
  for (let i = 0; i < 16; i++) {
    atlas.registerDynamicRgbaSprite(`spill_big_${i}`, 256, 256, bigRgba);
  }
  const stats = atlas.getAtlasStats();
  check(stats.pageCount >= 2, `Multi-page atlas pool should spill to >= 2 pages under heavy load (got ${stats.pageCount})`);
  check(
    atlas.getExtraPages().length >= 1 && FLOATS_PER_INSTANCE === 24,
    `TextureAtlas must export extra pages (${atlas.getExtraPages().length}) for 24-float GPU PBR multi-page array`,
  );
  const released = atlas.releaseDynamicByPrefix('spill_big_');
  check(released === 16, `releaseDynamicByPrefix should reclaim all 16 spilled sprites (got ${released})`);

  // 2b. Verify HD 64x64 procedural material pack + Foundational EcsCoreWorld
  const hdSolar = atlas.getRect('hd_turret_solar');
  check(hdSolar.w === 64 && hdSolar.h === 64, `hd_turret_solar must be 64x64 HD sprite (got ${hdSolar.w}x${hdSolar.h})`);
  const hdFloor = atlas.getRect('hd_arena_tile');
  check(hdFloor.w === 64 && hdFloor.h === 64, `hd_arena_tile must be 64x64 HD sprite (got ${hdFloor.w}x${hdFloor.h})`);

  const coreWorld = new EcsCoreWorld(64);
  const { Transform2D, Material } = coreWorld.components;
  const e1 = coreWorld.createEntity('hd_tower');
  coreWorld.addComponent(e1, Transform2D, { x: 10, y: 20, w: 64, h: 64 });
  coreWorld.addComponent(e1, Material, { spriteId: 'hd_turret_solar', roughness: 0.2, metallic: 0.85, emissive: 0.4 });
  const maskBoth = coreWorld.buildMask(Transform2D, Material);
  let coreHits = 0;
  coreWorld.queryMask(maskBoth, () => {
    coreHits++;
  });
  check(coreHits === 1, `EcsCoreWorld archetype query should match 1 entity (got ${coreHits})`);
  coreWorld.destroyEntity(e1);
  check(!coreWorld.entities.isAlive(e1), 'Destroyed generational entity handle must be rejected');

  // 3. Data-Driven Animation State Machine (Zero-GC)
  const anim = new AnimationStateMachineRuntime({
    id: 'hero_anim',
    initialState: 'idle',
    clips: [
      { name: 'idle', frames: ['hero_a', 'hero_b'], fps: 4, loop: true },
      {
        name: 'run',
        frames: ['hero_a', 'hero_b', 'star_a'],
        fps: 10,
        loop: true,
        events: [{ frameIndex: 1, event: 'footstep' }],
      },
    ],
    transitions: [
      { from: 'idle', to: 'run', param: 'speed', op: 'gt', value: 10 },
      { from: 'run', to: 'idle', param: 'speed', op: 'lte', value: 10 },
    ],
  });
  const stepOut: AnimationStepResult = {
    spriteId: 'solid',
    stateName: '',
    frameIndex: 0,
    emittedEvent: null,
    finished: false,
  };
  anim.setParam('speed', 50);
  anim.step(0.11, stepOut);
  check(stepOut.stateName === 'run', `Animator should transition to 'run' when speed > 10 (got ${stepOut.stateName})`);
  check(stepOut.emittedEvent === 'footstep', `Animator should emit 'footstep' frame event on frame 1 (got ${stepOut.emittedEvent})`);

  // 4. PA-11 Rhythm Bastion: True EcsCoreWorld 5-Phase Pipeline + Sandboxed Script VM + PBR GPU Snapshots
  const rt = new EcsCartridgeRuntime(RHYTHM_BASTION_PROJECT);
  const pipeline = rt.world.getSystemPipeline();
  check(
    pipeline.length >= 9 &&
      pipeline.some((s) => s.startsWith('input:')) &&
      pipeline.some((s) => s.startsWith('script:')) &&
      pipeline.some((s) => s.startsWith('physics:')) &&
      pipeline.some((s) => s.startsWith('fixed:')) &&
      pipeline.some((s) => s.startsWith('render:')),
    `EcsCartridgeRuntime must schedule all 5 phases across >=9 systems (got ${pipeline.join(', ')})`,
  );
  const initSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  check(
    initSnap.viewport?.width === 640 && initSnap.viewport?.height === 360,
    `PA-11 Rhythm Bastion must run at 640x360 HD-2D viewport`,
  );
  check((initSnap.lights?.length ?? 0) >= 3, 'PA-11 must emit dynamic GPU lights from ECS Light components');
  check(
    initSnap.entities.some((e) => (e.metallic ?? 0) >= 0.6 && (e.roughness ?? 1) <= 0.3),
    'PA-11 snapshot must propagate per-entity PBR metallic/roughness channels to GPU',
  );

  let maxOps = 0;
  let totalScore = 0;
  const rhythmStore = rt.world.core.getStore(rt.world.core.components.RhythmLane);
  const trComp = rt.world.core.components.Transform2D;
  for (let f = 0; f < 360; f++) {
    const inp = emptyInput();
    // Periodically strike rhythm lanes when notes approach judgeX (True ECS sparse-set query)
    const count = rhythmStore.size();
    for (let i = 0; i < count; i++) {
      const h = rhythmStore.getDenseEntityAt(i);
      const lane = rhythmStore.getDenseDataAt(i);
      const tr = rt.world.core.getComponent(h, trComp);
      if (!tr) continue;
      const dist = Math.abs(tr.x - lane.judgeX);
      if (dist <= 10) {
        if (lane.laneIndex === 0) inp.action = true;
        else if (lane.laneIndex === 1) inp.jump = true;
      }
    }
    rt.step(1 / 60, inp, DEFAULT_RUNTIME_PARAMS);
    maxOps = Math.max(maxOps, rt.vm.getLastFrameOpCount());
  }
  const endSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  totalScore = endSnap.score;
  const kills = rt.world.getGlobal('kills');
  check(maxOps > 0 && maxOps <= MAX_VM_OPS_PER_FRAME, `Sandboxed VM ops (${maxOps}) must execute within frame budget`);
  check(totalScore > 0, `PA-11 Rhythm Bastion should accrue score from beat hits & turret interceptions (got ${totalScore})`);
  check(kills >= 1, `PA-11 ECS autonomous turrets should intercept path-following void enemies (kills=${kills})`);

  // 5. Transactional EcsStudioSession + AgentBridge.ecs
  const ecsSession = new EcsStudioSession(RHYTHM_BASTION_PROJECT);
  const rev0 = ecsSession.getRevision();
  const vpRes = ecsSession.dispatch({ type: 'set_viewport', preset: 'qhd' });
  check(vpRes.ok && ecsSession.getProject().viewport.width === 960, 'EcsStudioSession should switch viewport to 960x540');
  const spRes = ecsSession.dispatch({
    type: 'spawn_entity',
    entity: {
      id: 'turret_extra',
      name: '測試砲塔',
      components: {
        transform: { x: 300, y: 120, w: 20, h: 20 },
        sprite: { sprite: 'crystal_reset' },
        scripts: ['turret_ai'],
        tag: 'turret',
      },
    },
  });
  check(spRes.ok && ecsSession.getRevision() === rev0 + 2, 'EcsStudioSession spawn_entity must increment revision');
  const undoRes = ecsSession.undo();
  check(
    undoRes.ok && !ecsSession.getProject().entities.some((e) => e.id === 'turret_extra'),
    'EcsStudioSession undo() must cleanly revert spawned entity',
  );
  const attachRes = ecsSession.dispatch({
    type: 'attach_component',
    entityId: 'turret_west',
    component: 'health',
    value: { hp: 30, maxHp: 30, faction: 'ally' },
  });
  check(
    attachRes.ok && Boolean(ecsSession.getProject().entities.find((e) => e.id === 'turret_west')?.components.health),
    'EcsStudioSession attach_component must dynamically mount health onto turret_west',
  );
  const pbrPatch = ecsSession.dispatch({
    type: 'patch_entity',
    entityId: 'turret_west',
    patch: { sprite: { sprite: 'hd_turret_solar', metallic: 0.95, roughness: 0.1, emissive: 1.2 } },
  });
  const westAfterPbr = ecsSession.getProject().entities.find((e) => e.id === 'turret_west');
  check(
    pbrPatch.ok && westAfterPbr?.components.sprite?.metallic === 0.95 && westAfterPbr?.components.sprite?.emissive === 1.2,
    'EcsStudioSession patch_entity must update GPU PBR material channels',
  );
  const detachRes = ecsSession.dispatch({
    type: 'detach_component',
    entityId: 'turret_west',
    component: 'health',
  });
  check(
    detachRes.ok && !ecsSession.getProject().entities.find((e) => e.id === 'turret_west')?.components.health,
    'EcsStudioSession detach_component must cleanly remove optional component',
  );
  ecsSession.undo();
  check(
    Boolean(ecsSession.getProject().entities.find((e) => e.id === 'turret_west')?.components.health),
    'EcsStudioSession undo() must restore detached component',
  );
  const playReport = ecsSession.runHeadlessPlaytest(180);
  check(
    playReport.framesSimulated === 180 && playReport.viewport.width === 960 && playReport.systems.length >= 9,
    'EcsStudioSession headless playtest must report 180 frames at 960w with >=9 ECS systems',
  );

  const runner = new CartridgeRunner('rhythm-bastion');
  const bridge = createAgentBridge(runner, undefined, { ecsSession });
  check(bridge.ecs.getRevision() === ecsSession.getRevision(), 'AgentBridge.ecs must mirror EcsStudioSession revision');
  const attachables = bridge.ecs.listAttachableComponents();
  check(
    attachables.includes('characterMotor2d') &&
      attachables.includes('grappleAnchor') &&
      attachables.includes('triggerZone') &&
      attachables.includes('verletChain'),
    'AgentBridge.ecs.listAttachableComponents() must expose all 4 Pixer 9.0 Batch 9.1 action components',
  );
  const mounted = bridge.ecs.mountToConsole();
  check(mounted.ok && mounted.id === 'rhythm-bastion', 'AgentBridge.ecs.mountToConsole() must hot-mount ECS project');

  // 6. Pixer 9.0 Batch 9.1 Action Physics Oracles (13 systems, coyote/buffer/grapple/trigger/verlet + transactional attach)
  check(
    pipeline.length >= 13 &&
      pipeline.includes('physics:character_motor_2d') &&
      pipeline.includes('physics:grapple_pendulum') &&
      pipeline.includes('physics:trigger_zone_sensor') &&
      pipeline.includes('fixed:verlet_chain_solver'),
    `Pixer 9.0 Batch 9.1 must schedule >= 13 ECS systems incl. 4 action physics systems (got ${pipeline.join(', ')})`,
  );

  const attachMotor = bridge.ecs.dispatch({
    type: 'attach_component',
    entityId: 'turret_west',
    component: 'characterMotor2d',
    value: { gravity: 720, jumpVelocity: 290, coyoteTimeSec: 0.12, jumpBufferSec: 0.12, floorY: 224 },
  });
  const attachVerlet = bridge.ecs.dispatch({
    type: 'attach_component',
    entityId: 'turret_west',
    component: 'verletChain',
    value: { nodeCount: 6, segmentLength: 10, gravity: 420, pinStart: true, color: '#f59e0b' },
  });
  const attachZone = bridge.ecs.dispatch({
    type: 'attach_component',
    entityId: 'turret_west',
    component: 'triggerZone',
    value: { shape: 'circle', radius: 40, onEnterEvent: 'west_enter', onExitEvent: 'west_exit' },
  });
  const westAction = bridge.ecs.getProject()?.entities.find((e) => e.id === 'turret_west');
  check(
    attachMotor.ok &&
      attachVerlet.ok &&
      attachZone.ok &&
      Boolean(westAction?.components.characterMotor2d) &&
      Boolean(westAction?.components.verletChain) &&
      Boolean(westAction?.components.triggerZone),
    'AgentBridge.ecs must transactionally attach CharacterMotor2D, VerletChain, and TriggerZone',
  );

  // Headless physics oracle verification inside npm run sim
  const actionRt = new EcsCartridgeRuntime({
    ...RHYTHM_BASTION_PROJECT,
    rhythmTrack: undefined,
    scripts: {
      zone_oracle: {
        id: 'zone_oracle',
        name: 'Zone Oracle',
        rules: [
          { trigger: { on: 'event', name: 'oracle_enter' }, ops: [{ op: 'add_global', key: 'zEnter', delta: 1 }] },
          { trigger: { on: 'event', name: 'oracle_exit' }, ops: [{ op: 'add_global', key: 'zExit', delta: 1 }] },
        ],
      },
    },
    globals: { zEnter: 0, zExit: 0 },
    entities: [
      {
        id: 'ledge',
        name: 'Ledge',
        components: { transform: { x: 40, y: 180, w: 64, h: 16 }, collider: { radius: 8, isSolid: true }, tag: 'solid' },
      },
      {
        id: 'anchor',
        name: 'Anchor',
        components: {
          transform: { x: 220, y: 70, w: 12, h: 12 },
          grappleAnchor: { anchorRadius: 150, swingTension: 0.99, reelSpeed: 96, minLength: 24, enabled: true },
          tag: 'anchor',
        },
      },
      {
        id: 'sensor',
        name: 'Sensor',
        components: {
          transform: { x: 128, y: 164, w: 24, h: 24 },
          triggerZone: { shape: 'rect', width: 32, height: 64, filterTag: 'hero', onEnterEvent: 'oracle_enter', onExitEvent: 'oracle_exit' },
          scripts: ['zone_oracle'],
          tag: 'sensor',
        },
      },
      {
        id: 'hero',
        name: 'Hero',
        components: {
          transform: { x: 84, y: 160, w: 16, h: 16 },
          characterMotor2d: { moveSpeed: 180, accel: 1800, gravity: 720, jumpVelocity: 290, coyoteTimeSec: 0.12, jumpBufferSec: 0.12, floorY: 280 },
          verletChain: { nodeCount: 6, segmentLength: 10, gravity: 420, iterations: 5, pinStart: true },
          tag: 'hero',
        },
      },
    ],
  });
  const aCore = actionRt.world.core;
  const ac = aCore.components;
  const hHero = aCore.getStore(ac.CharacterMotor2D).getDenseEntityAt(0);
  const hMotor = aCore.getComponent(hHero, ac.CharacterMotor2D)!;
  const hTr = aCore.getComponent(hHero, ac.Transform2D)!;
  const hVel = aCore.getComponent(hHero, ac.Velocity2D)!;
  const hChain = aCore.getComponent(hHero, ac.VerletChain)!;
  const chainBufRef = hChain.posX;

  for (let f = 0; f < 10; f++) actionRt.step(1 / 60, emptyInput(), DEFAULT_RUNTIME_PARAMS);
  check(hMotor.grounded, 'Batch 9.1 oracle hero must settle onto solid ledge');

  // Walk off ledge & verify coyote jump + trigger zone entry
  let coyoteJumped = false;
  for (let f = 0; f < 30; f++) {
    const evs = actionRt.step(1 / 60, { ...emptyInput(), right: true, jump: !hMotor.grounded && f > 5 }, DEFAULT_RUNTIME_PARAMS);
    if (evs.includes('jump')) {
      coyoteJumped = true;
      break;
    }
  }
  check(coyoteJumped && hVel.vy < -180, 'Batch 9.1 oracle must execute coyote jump after stepping off ledge');

  // Continue rightward through trigger zone and grapple onto overhead anchor
  let grappled = false;
  for (let f = 0; f < 45; f++) {
    const nearAnchor = Math.hypot(hTr.x - 220, hTr.y - 70) < 140;
    actionRt.step(1 / 60, { ...emptyInput(), right: !nearAnchor, action: nearAnchor }, DEFAULT_RUNTIME_PARAMS);
    if (hMotor.grappleHandle !== 0) grappled = true;
  }
  check(grappled, 'Batch 9.1 oracle hero must latch onto GrappleAnchor within capture radius');
  check(
    actionRt.world.getGlobal('zEnter') >= 1 && actionRt.world.getGlobal('zExit') >= 1,
    `Batch 9.1 TriggerZone must emit both enter (${actionRt.world.getGlobal('zEnter')}) and exit (${actionRt.world.getGlobal('zExit')}) events`,
  );
  check(hChain.posX === chainBufRef && hChain.initialized, 'Batch 9.1 VerletChain must preserve Zero-GC TypedArray identity');

  // 6b. Pixer 9.0 Batch 9.2 Prefab Asset Library & Sparse Override Propagation
  const starterPrefabs = bridge.ecs.listPrefabs();
  check(
    starterPrefabs.some((p) => p.id === 'solar_turret') && starterPrefabs.some((p) => p.id === 'beat_orb_b'),
    `PA-11 starter Prefab library must include solar_turret and beat_orb_b (got ${starterPrefabs.map((p) => p.id).join(', ')})`,
  );
  const instA = bridge.ecs.dispatch({
    type: 'instantiate_prefab',
    prefabId: 'solar_turret',
    x: 260,
    y: 120,
    name: 'Sim Clone A',
  });
  const instB = bridge.ecs.dispatch({
    type: 'instantiate_prefab',
    prefabId: 'solar_turret',
    x: 360,
    y: 120,
    name: 'Sim Clone B',
  });
  check(
    instA.ok && Boolean(instA.createdEntityId) && instB.ok && Boolean(instB.createdEntityId),
    'AgentBridge.ecs instantiate_prefab must spawn linked Prefab instances with generated IDs',
  );
  const patchOverride = bridge.ecs.dispatch({
    type: 'patch_entity',
    entityId: instA.createdEntityId!,
    patch: { sprite: { emissive: 1.45 } },
  });
  const propagatePrefab = bridge.ecs.dispatch({
    type: 'update_prefab',
    prefabId: 'solar_turret',
    patch: { sprite: { metallic: 0.98, emissive: 0.55 } },
  });
  check(patchOverride.ok && propagatePrefab.ok, 'Sparse instance override and update_prefab propagation must succeed');

  const prefabRt = new EcsCartridgeRuntime(bridge.ecs.getProject()!);
  const prefabSnap = prefabRt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const clonedSprites = prefabSnap.entities.filter((e) => e.metallic === 0.98);
  check(
    clonedSprites.length >= 2 &&
      clonedSprites.some((e) => e.emissive === 1.45) &&
      clonedSprites.some((e) => e.emissive === 0.55),
    'Prefab update_prefab must propagate metallic=0.98 to all linked clones while preserving sparse emissive override',
  );
  const undoPrefabProp = bridge.ecs.undo();
  check(undoPrefabProp.ok, 'AgentBridge.ecs undo() must cleanly roll back Prefab propagation');

  // 6c. Pixer 9.0 Batch 9.3 Agent-Native Specialization (Batch, Spatial Oracle, Scripted Playtest, MCP)
  const semReport = bridge.ecs.observeSemantics();
  check(
    Boolean(semReport) && semReport!.entityCount >= 6 && semReport!.prefabCount >= 5,
    'AgentBridge.ecs.observeSemantics() must return compact topology with entities and prefabs',
  );
  const revPreBatch = bridge.ecs.getRevision();
  const batchRes = bridge.ecs.batch(
    [
      {
        type: 'instantiate_prefab',
        prefabId: 'solar_turret',
        x: 200,
        y: 96,
        name: 'Batch Turret 1',
      },
      {
        type: 'instantiate_prefab',
        prefabId: 'solar_turret',
        x: 290,
        y: 96,
        name: 'Batch Turret 2',
      },
    ],
    'Spawn twin solar turrets',
  );
  check(
    batchRes.ok && (batchRes.createdEntityIds?.length ?? 0) === 2 && bridge.ecs.getRevision() === revPreBatch + 1,
    'AgentBridge.ecs.batch() must commit multi-command edit as a single atomic revision',
  );
  const scriptedPa11 = bridge.ecs.runScriptedPlaytest({
    maxFrames: 180,
    keypoints: [
      { fromFrame: 20, toFrame: 24, input: { action: true }, label: 'strike_a' },
      { fromFrame: 60, toFrame: 64, input: { jump: true }, label: 'strike_b' },
    ],
    assertions: [{ kind: 'no_nan_positions' }, { kind: 'status_is', status: 'playing' }],
  });
  check(
    Boolean(scriptedPa11?.ok) && (scriptedPa11?.framesSimulated ?? 0) === 180,
    `AgentBridge.ecs.runScriptedPlaytest() must pass 180f scripted verification on PA-11`,
  );
  bridge.ecs.undo();

  const mcpSim = new PixerMcpSession(RHYTHM_BASTION_PROJECT);
  const mcpSem = mcpSim.handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'get_scene_semantics', arguments: {} },
  });
  check(
    Boolean(mcpSem && !mcpSem.error && !(mcpSem.result as { isError: boolean }).isError),
    'PixerMcpSession get_scene_semantics JSON-RPC tool must succeed headlessly',
  );

  // 6d. Pixer 9.0 Batch 9.4 Multi-Dimensional Space (Spatial3D + DimensionMask + 1P 2.5D Projection)
  check(
    pipeline.length >= 14 && pipeline.includes('physics:spatial_3d_elevation'),
    `Batch 9.4 must schedule physics:spatial_3d_elevation in >=14 ECS systems (got ${pipeline.length}: ${pipeline.join(', ')})`,
  );
  const attachable = bridge.ecs.listAttachableComponents();
  check(
    attachable.includes('spatial3d'),
    `EcsStudioSession attachable component list must include 'spatial3d' (got ${attachable.join(', ')})`,
  );
  const attachSpRes = bridge.ecs.dispatch({
    type: 'attach_component',
    entityId: 'turret_west',
    component: 'spatial3d',
    value: { z: 32, height: 24, dimensionMask: 1 },
  });
  const setFpRes = bridge.ecs.dispatch({
    type: 'set_projection',
    patch: { mode: 'first_person_25d', activeDimensionMask: 1, allowDimensionShift: true },
  });
  check(
    attachSpRes.ok && setFpRes.ok,
    'Transactional attach_component(spatial3d) and set_projection(first_person_25d) must succeed',
  );
  const fpCheckRt = new EcsCartridgeRuntime(bridge.ecs.getProject()!);
  const fpCheckSnap = fpCheckRt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  check(
    fpCheckSnap.perspective?.mode === 'first_person' && fpCheckSnap.perspective.wallGrid.length === 64 * 64,
    'Batch 9.4 first_person_25d projection must emit valid PerspectiveProjectionDesc on PA-11',
  );
  bridge.ecs.undo();
  bridge.ecs.undo();

  // 6e. Pixer 9.0 Batch 9.5 Visual Script Event Graph + Flagship PA-12 (Astral Rift)
  check(
    CORE_DATA_PLUGINS.some((c) => c.meta.id === 'astral-rift' && c.meta.code === 'PA-12'),
    'PA-12 Astral Rift flagship pure-ECS cartridge must be registered in CORE_DATA_PLUGINS',
  );
  // Lossless EventGraph compile roundtrip across all PA-12 scripts
  for (const [sid, scriptDef] of Object.entries(ASTRAL_RIFT_PROJECT.scripts)) {
    const ir = compileScriptToEventGraph(scriptDef, ASTRAL_RIFT_PROJECT.graphLayouts?.[sid]);
    const back = compileEventGraphToScript(ir);
    check(
      JSON.stringify(back.script) === JSON.stringify(scriptDef),
      `PA-12 script '${sid}' must roundtrip losslessly through EcsEventGraph`,
    );
  }
  const pa12Reach = analyzeActionReachability(ASTRAL_RIFT_PROJECT);
  check(
    pa12Reach.hasActionMotor && pa12Reach.pass,
    `PA-12 Astral Rift must pass EcsSpatialOracle reachability (diag: ${pa12Reach.diagnostics.join('; ')})`,
  );
  const pa12GoalStatus = pa12Reach.goalStatuses.find((g) => g.entityId === 'rift_portal');
  check(
    Boolean(pa12GoalStatus?.reachable) &&
      (pa12GoalStatus?.viaMethods.includes('dimension_shift') ?? false),
    `PA-12 rift_portal must be proven reachable via dimension_shift (got ${pa12GoalStatus?.viaMethods.join(',') ?? 'none'})`,
  );
  const pa12Playtest = runScriptedPlaytest(ASTRAL_RIFT_PROJECT, {
    maxFrames: 120,
    keypoints: [
      { fromFrame: 0, toFrame: 78, input: { right: true }, label: 'run_to_light_step' },
      { fromFrame: 22, toFrame: 28, input: { jump: true }, label: 'jump_to_light_step' },
      { fromFrame: 60, toFrame: 62, input: { shoulderR: true }, label: 'shift_to_shadow_realm' },
    ],
    assertions: [
      { kind: 'no_nan_positions' },
      { kind: 'global_gte', key: 'riftPulse', value: 1 },
      { kind: 'global_gte', key: 'shifts', value: 1 },
    ],
  });
  check(
    pa12Playtest.ok,
    `PA-12 scripted playtest must verify live pulse beacon & R-key dimension shift (${pa12Playtest.failureHints.join('; ')})`,
  );
  // AgentBridge.ecs EventGraph API roundtrip
  const egApi = bridge.ecs.getEventGraph('turret_ai');
  check(Boolean(egApi && egApi.nodes.length >= 2), 'AgentBridge.ecs.getEventGraph() must return live IR');

  // 7. Core Slimming Boundary Guard: BuiltinCartridges.ts must not statically import legacy hand-written games
  const builtinsSrc = fs.readFileSync(path.join(process.cwd(), 'src/game/BuiltinCartridges.ts'), 'utf8');
  check(
    !builtinsSrc.includes('CelestialParkourGame') &&
      !builtinsSrc.includes('AstralChroniclesGame') &&
      !builtinsSrc.includes('EmberkeepDndGame') &&
      !builtinsSrc.includes('SandboxToyboxGame') &&
      !builtinsSrc.includes('LabyrinthDualviewGame') &&
      builtinsSrc.includes("import('./LegacyCartridgePack.ts')"),
    'Core slimming violation: BuiltinCartridges.ts must lazy-load LegacyCartridgePack via dynamic import with zero static legacy imports',
  );

  console.log(
    `[SIM OK] Pixer 9.0 Batch 9.5 (1280x720 Viewport, ${stats.pageCount}-Page Atlas+Slicer, 17-Comp True ECS / ${pipeline.length} Systems, Spatial3D+EventGraph+PA-12 + Agent-Native MCP/Oracles, PA-11 kills=${kills} score=${totalScore} maxVmOps=${maxOps}) verified`,
  );
}

