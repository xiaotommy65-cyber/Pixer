import { createAgentBridge } from '../../src/core/ai/AgentBridge.ts';
import { ToySynth } from '../../src/core/audio/ToySynth.ts';
import {
  createStudioTemplate,
  type StudioTemplateId,
} from '../../src/core/editor/StudioCommands.ts';
import {
  inspectSceneComposition,
  runHeadlessPlaytest,
} from '../../src/core/editor/StudioPlaytestDiag.ts';
import { StudioSession } from '../../src/core/editor/StudioSession.ts';
import {
  embedCartridgeIntoPng,
  extractCartridgeFromPng,
} from '../../src/core/runtime/CartridgePngCodec.ts';
import { CartridgeRunner } from '../../src/core/runtime/CartridgeRunner.ts';
import { EngineHost } from '../../src/core/runtime/EngineHost.ts';
import { SaveService } from '../../src/core/runtime/SaveService.ts';
import { validateCartridgeJson } from '../../src/core/sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../../src/core/sim/DataCartridgeRuntime.ts';
import {
  buildSkywardForgeCartridge,
  SKYWARD_FORGE_CARTRIDGE,
} from '../../src/game/skywardForge/SkywardForgeBuilder.ts';
import { check, emptyInput } from './SimTestHarness.ts';

const MINIMAL_1X1_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export async function testStudio6AndSkywardForgePA10(): Promise<void> {
  // 1. All 5 StudioCommands templates must validate cleanly and pass headless playtest + visual inspection
  const templates: readonly StudioTemplateId[] = [
    'parkour_flagship',
    'dual_perspective',
    'card_roguelike',
    'fighter_arena',
    'platformer',
  ];
  for (const tpl of templates) {
    const doc = createStudioTemplate(tpl);
    const val = validateCartridgeJson(doc);
    check(val.ok, `Studio template '${tpl}' must pass validateCartridgeJson: ${val.ok ? '' : val.errors.join('; ')}`);

    const pt = runHeadlessPlaytest(doc, { frames: 90 });
    check(pt.valid && pt.framesSimulated === 90, `Studio template '${tpl}' playtest must simulate 90 frames cleanly`);

    const vis = inspectSceneComposition(doc, 18);
    check(vis.valid && vis.entityCount > 0, `Studio template '${tpl}' visual inspection must emit entities`);
  }

  // 2. StudioSession transactional edits, atomic rollback on invalid schema, batch, undo/redo, onChange
  const session = new StudioSession(createStudioTemplate('parkour_flagship'));
  let changeEvents = 0;
  const off = session.onChange(() => {
    changeEvents++;
  });
  const rev0 = session.getRevision();
  const titleRes = session.dispatch({ type: 'set_meta', patch: { title: '蒼穹鍛爐測試版' } });
  check(titleRes.ok && session.getRevision() === rev0 + 1, 'StudioSession.dispatch valid command must bump revision');
  check(session.getDocument().meta.title === '蒼穹鍛爐測試版', 'StudioSession document title must update');
  check(session.canUndo() && !session.canRedo(), 'StudioSession undo/redo availability must reflect stack');

  // Invalid command (empty title rejected by schema) must roll back atomically without bumping revision
  const revBeforeBad = session.getRevision();
  const badRes = session.dispatch({ type: 'set_meta', patch: { title: '' } });
  check(!badRes.ok && session.getRevision() === revBeforeBad, 'Invalid StudioCommand must roll back atomically');
  check(session.getDocument().meta.title === '蒼穹鍛爐測試版', 'Atomic rollback must preserve previous document');

  // Batch counts as a single undoable transaction
  const batchRes = session.batch([
    { type: 'set_meta', patch: { subtitle: '批次副標題' } },
    { type: 'add_spawn', stageIndex: 0, spawn: { archetype: 'star', x: 180, y: 140 } },
  ], '批次更新副標與星星');
  check(batchRes.ok && session.getRevision() === revBeforeBad + 1, 'StudioSession.batch must commit atomically');

  const undo1 = session.undo();
  check(undo1.ok && session.getDocument().meta.subtitle !== '批次副標題', 'StudioSession.undo must revert batch');
  const redo1 = session.redo();
  check(redo1.ok && session.getDocument().meta.subtitle === '批次副標題', 'StudioSession.redo must reapply batch');
  check(changeEvents >= 4, `StudioSession.onChange must fire on commit/undo/redo (got ${changeEvents})`);
  off();

  // 3. ProceduralVisualRigRuntime: Verlet scarf + 2-Bone IK + afterimage + Curl-Noise embers + planar water
  const parkourDoc = createStudioTemplate('parkour_flagship');
  const parkourRt = new DataCartridgeRuntime(parkourDoc);
  const runnerParams = new CartridgeRunner('cloudberry-hop').getParams();
  for (let f = 0; f < 40; f++) {
    parkourRt.step(
      1 / 60,
      {
        ...emptyInput(),
        right: true,
        action: f === 12 || f === 13,
        pointerActive: true,
        pointerX: 0.78,
        pointerY: 0.22,
      },
      runnerParams,
    );
  }
  const rigSnap = parkourRt.snapshot(runnerParams);
  check(
    rigSnap.entities.some((e) => e.id.startsWith('rig-scarf-')),
    'DataCartridgeRuntime must emit Verlet scarf chain nodes when visualRig.verletChain is enabled',
  );
  check(
    rigSnap.entities.some((e) => e.id === 'rig-ik-joint') && rigSnap.entities.some((e) => e.id === 'rig-ik-tip'),
    'DataCartridgeRuntime must emit analytical 2-Bone IK joint & tip when visualRig.twoBoneIk is enabled',
  );
  check(
    rigSnap.particles.length >= 20,
    `DataCartridgeRuntime must emit Curl-Noise ambient particles (got ${rigSnap.particles.length})`,
  );
  check(
    rigSnap.hd2dDepth?.waterLevelY === 250,
    `DataCartridgeRuntime must forward atmosphere.waterLevelY to hd2dDepth (got ${rigSnap.hd2dDepth?.waterLevelY})`,
  );

  // 4. Pure JSON Dual-Perspective Runtime (1P <-> 3P instant toggle via X with zero coordinate loss)
  const dualDoc = createStudioTemplate('dual_perspective');
  const dualRt = new DataCartridgeRuntime(dualDoc);
  const snap1pStart = dualRt.snapshot(runnerParams);
  check(
    snap1pStart.perspective?.mode === 'first_person' && (snap1pStart.perspective.wallGrid?.length ?? 0) > 0,
    'Pure JSON dual_perspective must start in first_person mode with synced wallGrid',
  );
  for (let f = 0; f < 16; f++) {
    dualRt.step(1 / 60, { ...emptyInput(), up: true }, runnerParams);
  }
  const snapBeforeToggle = dualRt.snapshot(runnerParams);
  const camXBefore = snapBeforeToggle.perspective?.viewerX ?? 0;
  const camYBefore = snapBeforeToggle.perspective?.viewerY ?? 0;
  // Toggle to 3P via X
  dualRt.step(1 / 60, { ...emptyInput(), skillX: true }, runnerParams);
  dualRt.step(1 / 60, emptyInput(), runnerParams);
  const snap3p = dualRt.snapshot(runnerParams);
  check(
    snap3p.perspective?.mode === 'third_person',
    `Pressing X in pure JSON dual_perspective must switch cleanly to 3P top-down view (got ${String(snap3p.perspective?.mode)})`,
  );
  // Toggle back to 1P via X and verify coordinate continuity
  dualRt.step(1 / 60, { ...emptyInput(), skillX: true }, runnerParams);
  dualRt.step(1 / 60, emptyInput(), runnerParams);
  const snap1pBack = dualRt.snapshot(runnerParams);
  check(
    snap1pBack.perspective?.mode === 'first_person' &&
      Math.hypot((snap1pBack.perspective.viewerX ?? 0) - camXBefore, (snap1pBack.perspective.viewerY ?? 0) - camYBefore) < 2,
    'Pure JSON 1P <-> 3P toggle must preserve player coordinates with zero drift',
  );
  // Test melee slash in 1P
  dualRt.step(1 / 60, { ...emptyInput(), action: true }, runnerParams);
  const slashSnap = dualRt.snapshot(runnerParams);
  check(
    slashSnap.perspective?.viewmodelPose === 'strike' || slashSnap.perspective?.viewmodelPose === 'windup',
    'Pressing A in pure JSON 1P mode must animate held viewmodel strike pose',
  );

  // 5. Flagship PA-10 (skyward-forge) built 100% via StudioSession commands + Polaroid PNG roundtrip
  const rebuiltPa10 = buildSkywardForgeCartridge();
  check(
    rebuiltPa10.meta.id === 'skyward-forge' && rebuiltPa10.meta.code === 'PA-10' && rebuiltPa10.stages.length === 2,
    'PA-10 Skyward Forge must build deterministically via StudioSession with 2 stages',
  );
  const pa10Runner = new CartridgeRunner('skyward-forge');
  for (let f = 0; f < 45; f++) {
    pa10Runner.stepFixed(1 / 60, {
      ...emptyInput(),
      right: true,
      jump: f === 10 || f === 11,
      action: f === 16,
      pointerActive: true,
      pointerX: 0.72,
      pointerY: 0.25,
    });
  }
  const pa10Snap = pa10Runner.getSnapshot();
  check(
    pa10Snap.entities.some((e) => e.id.startsWith('rig-scarf-')) &&
      pa10Snap.entities.some((e) => e.id === 'rig-ik-tip') &&
      pa10Snap.particles.length >= 25 &&
      pa10Snap.hd2dDepth?.waterLevelY === 252,
    'PA-10 Skyward Forge live runner must emit Verlet scarf, 2-Bone IK claw, Curl embers, and HD-2D planar water',
  );
  const pa10Playtest = runHeadlessPlaytest(SKYWARD_FORGE_CARTRIDGE, { frames: 120 });
  const pa10Visual = inspectSceneComposition(SKYWARD_FORGE_CARTRIDGE, 24);
  check(
    pa10Playtest.valid && pa10Playtest.displacementPx > 24 && pa10Visual.hasVerletRig && pa10Visual.hasIkRig && pa10Visual.hasWaterReflection,
    `PA-10 diagnostics must confirm movement (${pa10Playtest.displacementPx}px) & full PA-06 rig/water parity`,
  );

  // Polaroid PNG iTXt roundtrip for PA-10
  const pa10Png = await embedCartridgeIntoPng(MINIMAL_1X1_PNG, SKYWARD_FORGE_CARTRIDGE);
  const pa10Decoded = await extractCartridgeFromPng(pa10Png);
  check(
    pa10Decoded.ok &&
      pa10Decoded.data.meta.id === 'skyward-forge' &&
      validateCartridgeJson(pa10Decoded.data).ok,
    'PA-10 Skyward Forge must roundtrip cleanly through Polaroid PNG iTXt codec',
  );

  // 6. AgentBridge.studio AI Structured Command API end-to-end
  const bridgeRunner = new CartridgeRunner('skyward-forge');
  const bridgeHost = new EngineHost(bridgeRunner, new ToySynth(), new SaveService());
  const sharedSession = new StudioSession(createStudioTemplate('parkour_flagship'));
  let previewCalls = 0;
  const agent = createAgentBridge(bridgeRunner, undefined, {
    onLoadCartridge: (raw, opts) => bridgeHost.loadCartridge(raw, opts),
    studioSession: sharedSession,
    onCapturePreviewPng: () => {
      previewCalls++;
      return 'data:image/png;base64,MOCK_OK';
    },
  });
  check(
    agent.studio.getRevision() === sharedSession.getRevision() && agent.studio.getRevision() >= 1,
    'AgentBridge.studio must expose shared initial revision',
  );
  const loadActive = agent.studio.loadFromActiveCartridge();
  check(loadActive.ok && agent.studio.getDocument().meta.code === 'PA-10', 'AgentBridge.studio.loadFromActiveCartridge must import PA-10 JSON');
  const agentEdit = agent.studio.dispatch({ type: 'set_meta', patch: { title: 'AI 修改後的蒼穹鍛爐' } });
  check(agentEdit.ok && agent.studio.getDocument().meta.title === 'AI 修改後的蒼穹鍛爐', 'AgentBridge.studio.dispatch must mutate document transactionally');
  const agentPlaytest = agent.studio.playtest({ frames: 60 });
  const agentVis = agent.studio.inspectVisual(12);
  const preview = agent.studio.capturePreviewPng();
  check(
    agentPlaytest.valid && agentVis.valid && preview === 'data:image/png;base64,MOCK_OK' && previewCalls === 1,
    'AgentBridge.studio self-verification APIs (playtest, inspectVisual, capturePreviewPng) must all succeed',
  );
  const mounted = agent.studio.mountToConsole({ save: false });
  check(mounted.ok && bridgeRunner.getCartridgeId().startsWith('custom-'), 'AgentBridge.studio.mountToConsole must hot-mount edited cartridge');
  const undone = agent.studio.undo();
  check(undone.ok && agent.studio.getDocument().meta.title === '蒼穹鍛爐：正交試煉', 'AgentBridge.studio.undo must restore prior title');
  bridgeHost.destroy();

  console.log(
    `[SIM OK] Pixer Studio 6.0 (5 templates, Verlet/IK/Curl/Water rig, pure JSON 1P<->3P, StudioSession, AgentBridge.studio & PA-10 Skyward Forge) verified`,
  );
}
