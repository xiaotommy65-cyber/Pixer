import assert from 'node:assert/strict';
import test from 'node:test';
import type { EcsModel3DDef } from '../../src/core/ecs/EcsModel3D.ts';
import { validateEcsProjectV2, type EcsProjectV2 } from '../../src/core/ecs/EcsProjectSchema.ts';
import { EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import { EcsWorld } from '../../src/core/ecs/EcsWorld.ts';
import {
  buildSampleBbmodelJson,
  MAX_BBMODEL_BYTES,
  MAX_BBMODEL_ELEMENTS,
  parseBbmodelToModel3D,
} from '../../src/core/interop/BbmodelImporter.ts';
import {
  buildSampleGlbCube,
  MAX_GLB_BYTES,
  parseGlbToModel3D,
} from '../../src/core/interop/GlbImporter.ts';

function makeMinimalProject(): EcsProjectV2 {
  return {
    schemaVersion: 2,
    meta: {
      id: 'obsidian-citadel',
      code: 'PA-MOD',
      title: 'Model3D Interop Test',
      subtitle: 'Phase B',
      genre: '3D',
      accentHex: '#38bdf8',
      controlsHint: 'Test',
      goalHint: 'Test',
    },
    viewport: { width: 640, height: 360, preset: 'hd_plus' },
    atmosphere: { skyTop: '#0f172a', skyBottom: '#1e293b' },
    paths: {},
    animations: [],
    prefabs: {},
    scripts: {},
    globals: {},
    hud: [],
    entities: [],
  };
}

test('GlbImporter converts Y-Up -> Pixer Z-Up, flips triangle winding, grounds minZ=0, and enforces bounds', () => {
  const glbBytes = buildSampleGlbCube();
  const res = parseGlbToModel3D(glbBytes, {
    modelId: 'sample_glb_cube',
    name: 'Sample GLB Cube',
    targetHeightPx: 32,
  });

  assert.equal(res.model.id, 'sample_glb_cube');
  assert.equal(res.stats.vertexCount, 24);
  assert.equal(res.stats.triangleCount, 12);
  assert.equal(res.stats.hasNormals, true);
  assert.equal(res.stats.hasUvs, true);
  assert.ok(res.model.rawMesh);

  const raw = res.model.rawMesh!;
  assert.ok(res.model.boundsSize);
  assert.ok(Math.abs(res.model.boundsSize![2] - 32) < 1e-4, 'Bounds Z height must match targetHeightPx=32');

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < res.stats.vertexCount; i++) {
    const z = raw.positions[i * 3 + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  assert.ok(Math.abs(minZ) < 1e-4, `Model must be grounded at minZ=0 (got ${minZ})`);
  assert.ok(Math.abs(maxZ - 32) < 1e-4, `Model top must be at maxZ=32 (got ${maxZ})`);

  // Verify outward triangle winding (e1 x e2) · n > 0 after Y-Up -> Z-Up swap
  const pos = raw.positions;
  const norm = raw.normals;
  const idx = raw.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t];
    const i1 = idx[t + 1];
    const i2 = idx[t + 2];
    const e1x = pos[i1 * 3] - pos[i0 * 3];
    const e1y = pos[i1 * 3 + 1] - pos[i0 * 3 + 1];
    const e1z = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
    const e2x = pos[i2 * 3] - pos[i0 * 3];
    const e2y = pos[i2 * 3 + 1] - pos[i0 * 3 + 1];
    const e2z = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const dot = cx * norm[i0 * 3] + cy * norm[i0 * 3 + 1] + cz * norm[i0 * 3 + 2];
    assert.ok(dot > 0, `Triangle ${t / 3} winding must agree with outward Z-Up normal (dot=${dot})`);
  }

  // Malformed & oversized buffer guards
  assert.throws(() => parseGlbToModel3D(new Uint8Array(4)), /header/i);
  const badMagic = new Uint8Array(glbBytes);
  badMagic[0] = 0;
  assert.throws(() => parseGlbToModel3D(badMagic), /magic/i);
  const badVersion = new Uint8Array(glbBytes);
  badVersion[4] = 99;
  assert.throws(() => parseGlbToModel3D(badVersion), /version/i);
  const truncated = glbBytes.subarray(0, 24);
  assert.throws(() => parseGlbToModel3D(truncated), /length|bounds/i);
  const oversizedFake = {
    byteLength: MAX_GLB_BYTES + 1,
  };
  assert.ok(oversizedFake.byteLength > MAX_GLB_BYTES);
  assert.throws(() => parseGlbToModel3D(new Uint8Array(MAX_GLB_BYTES + 1)), /MAX_GLB_BYTES/);
});

test('BbmodelImporter converts Blockbench Y-Up cuboids & pivots to Z-Up and enforces bounds', () => {
  const bbJson = buildSampleBbmodelJson();
  const res = parseBbmodelToModel3D(bbJson, {
    modelId: 'knight_chest',
    defaultSpriteId: 'castle_wall_brick',
  });

  assert.equal(res.model.id, 'knight_chest');
  assert.equal(res.partCount, 6);
  assert.equal(res.model.parts.length, 6);

  // Grounded minZ === 0 across all parts
  let minZ = Infinity;
  for (const part of res.model.parts) {
    if (part.origin[2] < minZ) minZ = part.origin[2];
  }
  assert.ok(Math.abs(minZ) < 1e-4, `Expected grounded minZ=0, got ${minZ}`);

  // Check hinged lid preserves Z-Up pivot & rotation
  const lid = res.model.parts.find((p) => p.id === 'hinged_chest_lid');
  assert.ok(lid);
  assert.ok(lid.pivot);
  assert.deepEqual(lid.rotDeg, [-18, 0, 0]);

  // Malformed & oversized guards
  assert.throws(() => parseBbmodelToModel3D(''), /empty/i);
  assert.throws(() => parseBbmodelToModel3D('[]'), /object/i);
  assert.throws(() => parseBbmodelToModel3D('{}'), /elements/i);
  const tooMany = JSON.stringify({
    elements: Array.from({ length: MAX_BBMODEL_ELEMENTS + 1 }, () => ({ from: [0, 0, 0], to: [1, 1, 1] })),
  });
  assert.throws(() => parseBbmodelToModel3D(tooMany), /MAX_BBMODEL_ELEMENTS/);
  assert.throws(() => parseBbmodelToModel3D(' '.repeat(MAX_BBMODEL_BYTES + 1)), /MAX_BBMODEL_BYTES/);
});

test('EcsStudioSession upsert_model_3d round-trip preserves both BBModel cuboids and GLB rawMesh TypedArrays across Undo/Redo & EcsWorld hydration', () => {
  const session = new EcsStudioSession(makeMinimalProject());

  const bbRes = parseBbmodelToModel3D(buildSampleBbmodelJson(), { modelId: 'chest_bb' });
  const glbRes = parseGlbToModel3D(buildSampleGlbCube(), { modelId: 'cube_glb', targetHeightPx: 28 });

  const bbCmdRes = session.dispatch({
    type: 'upsert_model_3d',
    model: bbRes.model as unknown as EcsModel3DDef,
  });
  assert.equal(bbCmdRes.ok, true, bbCmdRes.errors.join('; '));

  const glbCmdRes = session.dispatch({
    type: 'upsert_model_3d',
    model: glbRes.model as unknown as EcsModel3DDef,
  });
  assert.equal(glbCmdRes.ok, true, glbCmdRes.errors.join('; '));

  // Spawn entity referencing the GLB rawMesh model & verify subsequent commands preserve Float32Array/Uint32Array
  const spawnRes = session.dispatch({
    type: 'spawn_entity',
    entity: {
      id: 'glb_actor',
      name: 'GLB Cube Actor',
      components: {
        transform: { x: 100, y: 120, w: 28, h: 28 },
        spatial3d: { z: 4, height: 28, yaw: 30 },
        mesh3d: { modelId: 'cube_glb', scaleX: 1, scaleY: 1, scaleZ: 1, castShadow: true },
        tag: 'prop',
      },
    },
  });
  assert.equal(spawnRes.ok, true, spawnRes.errors.join('; '));

  const proj = session.getProject();
  assert.equal(validateEcsProjectV2(proj).ok, true);
  assert.ok(proj.models3d?.chest_bb);
  assert.ok(proj.models3d?.cube_glb?.rawMesh);
  assert.equal(proj.models3d!.cube_glb.rawMesh!.positions.length, 24 * 3);

  // Hydrate into EcsWorld and verify MeshRenderer3D & models3d
  const world = new EcsWorld();
  world.loadProject(proj);
  assert.equal(world.models3d.size, 2);
  const inspected = world.inspectEntities();
  const actorInfo = inspected.find((e) => e.entityId === 'glb_actor');
  assert.ok(actorInfo);
  assert.ok(actorInfo.components.includes('MeshRenderer3D'));
  assert.ok(actorInfo.components.includes('Spatial3D'));

  // Undo & Redo round-trip
  assert.equal(session.undo().ok, true); // undo spawn_entity
  assert.equal(session.undo().ok, true); // undo glb upsert
  assert.equal(session.getProject().models3d?.cube_glb, undefined);
  assert.equal(session.redo().ok, true);
  assert.ok(session.getProject().models3d?.cube_glb?.rawMesh);
});
