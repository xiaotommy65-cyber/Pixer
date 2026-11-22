import assert from 'node:assert/strict';
import test from 'node:test';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import {
  buildInteropStudioCommands,
  buildSampleAsepriteFile,
  loadExternalInteropFiles,
} from '../../src/core/interop/index.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { EMERALD_RUINS_PROJECT } from '../../src/game/emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

test('HD-2D 2D shadow occlusion grid tracks solid walls & clears unlocked gates with version bump', () => {
  const rt = new EcsCartridgeRuntime(EMERALD_RUINS_PROJECT);
  const input = createEmptyInputState();
  rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);

  const snap1 = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(snap1.occlusion, 'WorldMap runtime with shadowOcclusion=true must emit snap.occlusion');
  const occ1 = snap1.occlusion!;
  assert.equal(occ1.cols, 20);
  assert.equal(occ1.rows, 14);
  assert.ok((occ1.shadowStrength ?? 0) > 0.7);
  // Corner wall (0,0) is JADE_WALL -> 255 (row stride = 64 OCCLUSION_GRID_MAX)
  assert.equal(occ1.data[0], 255, 'Outer wall corner must be opaque occluder (255)');
  // Center walkable floor (9, 7) is RUNE_FLOOR -> 0
  assert.equal(occ1.data[7 * 64 + 9], 0, 'Walkable floor must be open (0)');
  // Locked north seal gate at (9, 0) -> 255 before unlock
  assert.equal(occ1.data[0 * 64 + 9], 255, 'Locked seal gate must occlude light (255)');
  const versionBefore = occ1.version;

  // Unlock grove_seal_open -> rebuildTiles() must open the gate and bump occlusion version
  rt.world.setGlobal('grove_seal_open', 1);
  rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  const snap2 = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const occ2 = snap2.occlusion!;
  assert.ok(occ2.version > versionBefore, 'Unlocking a global-gated door must bump occlusion version');
  assert.equal(occ2.data[0 * 64 + 9], 0, 'Unlocked gate cell must become light-transparent (0)');

  // Tilt-Shift DoF fields forwarded from project atmosphere
  assert.ok(snap2.hd2dDepth, 'HD-2D depth config must exist');
  assert.equal(snap2.hd2dDepth!.tiltShiftBlur, EMERALD_RUINS_PROJECT.atmosphere.tiltShiftBlur);
  assert.equal(snap2.hd2dDepth!.tiltShiftFocusY, EMERALD_RUINS_PROJECT.atmosphere.tiltShiftFocusY);
});

test('JuiceSystem combat feel: melee hit triggers hitstop, trauma shake, GPU particles & respects juiceScale=0', () => {
  const proj = structuredClone(EMERALD_RUINS_PROJECT);
  // Place golem directly above hero so an upward slash hits immediately
  const hero = proj.entities.find((e) => e.id === 'hero')!;
  const golem = proj.entities.find((e) => e.id === 'golem_1')!;
  golem.overrides = { transform: { x: hero.components.transform!.x, y: hero.components.transform!.y - 24 } };

  const rt = new EcsCartridgeRuntime(proj);
  const idleInput = createEmptyInputState();
  // Step 30 frames to let ambient fireflies spawn too
  for (let i = 0; i < 30; i++) {
    rt.step(1 / 60, idleInput, DEFAULT_RUNTIME_PARAMS);
  }
  const snapAmbient = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(snapAmbient.particles.length > 0, 'Ambient fireflies theme should emit GPU particles');
  for (const p of snapAmbient.particles) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.size), 'Particle coordinates must be finite');
  }

  // Move up slightly to face up, then press Action A to slash golem
  const slashInput = createEmptyInputState();
  slashInput.up = true;
  slashInput.action = true;
  rt.step(1 / 60, slashInput, DEFAULT_RUNTIME_PARAMS);

  assert.ok(rt.juice.hitstopTimer > 0, 'Melee enemy hit must trigger hitstop freeze-frame');
  assert.ok(rt.juice.trauma > 0.1, 'Melee enemy hit must add screen shake trauma');
  const snapHit = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(snapHit.particles.length >= 6, 'Melee hit must burst directional impact sparks');
  // Ranger animator should have entered 'attack' clip (er_ranger_slash)
  const heroSnap = snapHit.entities.find((e) => e.id === 'hero');
  assert.equal(heroSnap?.sprite, 'er_ranger_slash', 'Hero Animator should switch to attack clip sprite during melee swing');

  // Verify juiceScale: 0 disables hitstop and trauma cleanly
  const mutedProj = structuredClone(proj);
  mutedProj.atmosphere.juiceScale = 0;
  const mutedRt = new EcsCartridgeRuntime(mutedProj);
  mutedRt.step(1 / 60, slashInput, DEFAULT_RUNTIME_PARAMS);
  assert.equal(mutedRt.juice.hitstopTimer, 0, 'juiceScale=0 must suppress hitstop');
  assert.equal(mutedRt.juice.trauma, 0, 'juiceScale=0 must suppress screen shake trauma');
});

test('Obsidian Citadel embers theme & hero walk animator run deterministically at 60Hz', () => {
  const rt = new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT);
  const walkInput = createEmptyInputState();
  walkInput.up = true;
  const seenSprites = new Set<string>();

  for (let i = 0; i < 45; i++) {
    rt.step(1 / 60, walkInput, DEFAULT_RUNTIME_PARAMS);
    const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    const hero = snap.entities.find((e) => e.id === 'hero');
    if (hero) seenSprites.add(hero.sprite);
  }

  assert.ok(seenSprites.has('castle_hero_a') && seenSprites.has('castle_hero_b'), 'Hero walk animator should alternate frames while moving');
  const finalSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(finalSnap.particles.length > 0, 'Obsidian Citadel embers + torch sparks should emit GPU particles');
  assert.ok(finalSnap.occlusion && finalSnap.occlusion.cols === 28 && finalSnap.occlusion.rows === 18);
});

test('Transactional upsert_animation/remove_animation Undo/Redo + Aseprite 4-frame auto-wired animator', async () => {
  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const initialAnimCount = session.getProject().animations.length;

  // 1. Direct upsert_animation + Undo + Redo + remove_animation
  const upRes = session.dispatch({
    type: 'upsert_animation',
    animation: {
      id: 'anim_test_slime',
      initialState: 'idle',
      clips: [{ name: 'idle', frames: ['castle_hero_a', 'castle_hero_b'], fps: 6, loop: true }],
      transitions: [],
    },
  });
  assert.equal(upRes.ok, true);
  assert.equal(session.getProject().animations.length, initialAnimCount + 1);

  assert.equal(session.undo().ok, true);
  assert.equal(session.getProject().animations.length, initialAnimCount);
  assert.equal(session.redo().ok, true);
  assert.equal(session.getProject().animations.length, initialAnimCount + 1);

  const rmRes = session.dispatch({ type: 'remove_animation', animationId: 'anim_test_slime' });
  assert.equal(rmRes.ok, true);
  assert.equal(session.getProject().animations.length, initialAnimCount);

  // 2. Aseprite 4-frame binary import auto-generates AnimationStateMachineDef and binds animatorId on prefab
  const aseResult = await loadExternalInteropFiles([buildSampleAsepriteFile()]);
  assert.equal(aseResult.customSprites.length, 4);
  const cmds = buildInteropStudioCommands(aseResult, session.getProject(), {
    replaceWorldMap: false,
    createPrefabFromSprite: true,
  });
  const animCmd = cmds.find((c) => c.type === 'upsert_animation');
  assert.ok(animCmd && animCmd.type === 'upsert_animation', 'Multi-frame Aseprite import must emit upsert_animation command');
  assert.equal(animCmd.animation.clips[0].frames.length, 4);

  const batchRes = session.dispatchBatch(cmds, 'Import 4-frame Aseprite');
  assert.equal(batchRes.ok, true, `Batch failed: ${batchRes.errors.join('; ')}`);

  const prefabId = Object.keys(session.getProject().prefabs).find((id) => id.includes('crystal_knight'));
  assert.ok(prefabId, 'Imported Aseprite should register a prefab');
  const prefab = session.getProject().prefabs[prefabId!];
  assert.equal(prefab.components.animatorId, animCmd.animation.id, 'Imported prefab must auto-bind generated animatorId');

  // Spawn an instance in courtyard and step 60Hz to confirm frames cycle through all 4 Aseprite frames
  const spawnRes = session.dispatch({
    type: 'spawn_entity',
    entity: {
      id: 'test_ase_knight',
      name: 'Crystal Knight',
      roomId: 'courtyard',
      prefabId: prefabId!,
      components: { transform: { x: 420, y: 420, w: 32, h: 32 } },
    },
  });
  assert.equal(spawnRes.ok, true);

  const rt = new EcsCartridgeRuntime(session.getProject());
  const emptyIn = createEmptyInputState();
  const seenFrames = new Set<string>();
  for (let i = 0; i < 60; i++) {
    rt.step(1 / 60, emptyIn, DEFAULT_RUNTIME_PARAMS);
    const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
    const ent = snap.entities.find((e) => e.id === 'test_ase_knight');
    if (ent) seenFrames.add(ent.sprite);
  }
  assert.equal(seenFrames.size, 4, `Expected all 4 Aseprite frames to animate (saw ${seenFrames.size}: ${[...seenFrames].join(', ')})`);
});

test('MCP describe_editor_grammar & dispatch_ecs_command expose upsert_animation and extended set_atmosphere', () => {
  const mcp = new PixerMcpSession(OBSIDIAN_CITADEL_PROJECT);

  const grammarResp = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'describe_editor_grammar', arguments: {} },
  });
  assert.ok(grammarResp && !grammarResp.error);
  const grammarContent = (grammarResp.result as { structuredContent: { commands: Array<{ type: string }> } }).structuredContent;
  const cmdTypes = new Set(grammarContent.commands.map((c) => c.type));
  assert.ok(cmdTypes.has('upsert_animation'), 'Grammar must document upsert_animation');
  assert.ok(cmdTypes.has('remove_animation'), 'Grammar must document remove_animation');
  assert.ok(cmdTypes.has('set_atmosphere'), 'Grammar must document set_atmosphere');

  const atmResp = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'dispatch_ecs_command',
      arguments: {
        command: {
          type: 'set_atmosphere',
          patch: {
            shadowOcclusion: true,
            shadowStrength: 0.75,
            tiltShiftBlur: 0.45,
            ambientParticles: 'snow',
            juiceScale: 1.4,
          },
        },
      },
    },
  });
  assert.ok(atmResp && !atmResp.error);
  const atmRes = atmResp.result as { isError: boolean };
  assert.equal(atmRes.isError, false);
  assert.equal(mcp.session.getProject().atmosphere.ambientParticles, 'snow');
  assert.equal(mcp.session.getProject().atmosphere.tiltShiftBlur, 0.45);
  assert.equal(mcp.session.getProject().atmosphere.juiceScale, 1.4);
});
