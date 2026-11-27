import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import {
  analyzeWorldMap3DReachability,
  renderRoomSliceAscii,
  type EcsRoomSliceAsciiReport,
  type EcsWorldMap3DReachabilityReport,
} from '../../src/core/ai/EcsSpatialOracle.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsActionPhysicsSystems } from '../../src/core/ecs/EcsActionPhysicsSystems.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { EcsCoreWorld } from '../../src/core/ecs/EcsCoreWorld.ts';
import type { EcsModel3DDef } from '../../src/core/ecs/EcsModel3D.ts';
import { validateEcsProjectV2, type EcsProjectV2 } from '../../src/core/ecs/EcsProjectSchema.ts';
import { ECS_COMMAND_CATALOG, EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import {
  CASTLE_TILE_IDS,
  createEmptyRoom,
  fillRoomBox3D,
  setRoomVoxel,
} from '../../src/core/ecs/EcsTilemapTypes.ts';
import { RoomVoxelVolume } from '../../src/core/ecs/EcsVoxelVolume.ts';
import { GpuEngine } from '../../src/core/gpu/GpuEngine.ts';
import {
  FACE_CULL_BOT,
  FACE_CULL_EAST,
  FACE_CULL_NORTH,
  FACE_CULL_SOUTH,
  FACE_CULL_TOP,
  FACE_CULL_WEST,
} from '../../src/core/gpu/GpuMesh3DBatch.ts';
import {
  FLOATS_PER_MESH3D_VERTEX,
  type GpuOcclusionState,
  type IGpuBackend,
  type Mesh3DPassData,
  type Quad3DPassData,
  type SkyGradient,
} from '../../src/core/gpu/GpuTypes.ts';
import { SceneTrue3DPass } from '../../src/core/runtime/SceneTrue3DPass.ts';
import { createComposedLayerPool, type OrthogonalArtBlueprint } from '../../src/core/sim/OrthogonalArt.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS, type SimEvent } from '../../src/core/types/WorldTypes.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

function makeVoxelRoomProject(): EcsProjectV2 {
  const room = createEmptyRoom('voxel_hall', '立體多層大廳', 12, 10, CASTLE_TILE_IDS.STONE_FLOOR);
  room.storyHeight = 24;
  // Clear inner walls so we have open space, keep perimeter
  // Build a stair_e at (3, 5, 0) leading up to elevated bridge (4..7, 5, 0) cubes (top Z = 24),
  // plus an elevated overpass bridge at zLevel=1 (4..6, 3, 1) that hero can walk UNDER at z=0,
  // and an arch at (8, 5, 0) that hero can walk UNDER at z=0!
  setRoomVoxel(room, { col: 3, row: 5, zLevel: 0, tileId: CASTLE_TILE_IDS.STONE_STAIRS, shape: 'stair_e' });
  fillRoomBox3D(room, 4, 5, 0, 7, 5, 0, CASTLE_TILE_IDS.WALL_BRICK, 'cube');
  fillRoomBox3D(room, 4, 3, 1, 6, 3, 1, CASTLE_TILE_IDS.WALL_GOTHIC, 'cube');
  setRoomVoxel(room, { col: 8, row: 5, zLevel: 0, tileId: CASTLE_TILE_IDS.WALL_GOTHIC, shape: 'arch' });

  return {
    schemaVersion: 2,
    meta: {
      id: 'obsidian-citadel',
      code: 'PA-3D',
      title: 'Voxel 3D Test World',
      subtitle: 'Phase B',
      genre: '3D Action',
      accentHex: '#38bdf8',
      controlsHint: 'Test',
      goalHint: 'Climb & Cross',
    },
    viewport: { width: 640, height: 360, preset: 'hd_plus' },
    atmosphere: { skyTop: '#0f172a', skyBottom: '#1e293b', ambientDarkness: 0.25 },
    projection: {
      mode: 'hd2d_3d',
      pitchDeg: 42,
      fovDeg: 38,
      wallHeightScale: 1.0,
      yawDeg: 0,
      cameraProjection3d: 'perspective',
    },
    worldMap: {
      tileSize: 32,
      startRoomId: 'voxel_hall',
      rooms: [room],
      portals: [],
      aiProfiles: {
        boss_3d: {
          chaseRange: 180,
          stopRange: 20,
          moveSpeed: 40,
          contactDamage: 1,
          contactRange: 20,
          scoreOnDefeat: 500,
          isBoss: true,
          winOnDefeat: true,
        },
      },
    },
    models3d: {
      relic_pillar: {
        id: 'relic_pillar',
        name: 'Relic Pillar 3D',
        parts: [
          {
            id: 'base',
            origin: [-8, -8, 0],
            size: [16, 16, 20],
            faces: { top: 'castle_wall_top', side: 'castle_wall_brick' },
            roughness: 0.5,
          },
        ],
        boundsSize: [16, 16, 20],
      },
    },
    paths: {},
    animations: [],
    prefabs: {},
    scripts: {},
    globals: {},
    hud: [],
    entities: [
      {
        id: 'hero',
        name: 'Hero',
        roomId: 'voxel_hall',
        components: {
          transform: { x: 2 * 32, y: 5 * 32, w: 32, h: 32 },
          sprite: { sprite: 'castle_hero_a', castShadow: true },
          health: { hp: 10, maxHp: 10, team: 1 },
          spatial3d: { z: 0, height: 16, stepHeight: 10, gravityZ: 0, dimensionMask: 3 },
          characterMotor2d: { moveSpeed: 128, topDown: true },
          tag: 'hero',
        },
      },
      {
        id: 'sky_boss',
        name: 'Sky Boss',
        roomId: 'voxel_hall',
        components: {
          transform: { x: 6 * 32, y: 5 * 32, w: 32, h: 32 },
          sprite: { sprite: 'castle_demon_lord' },
          health: { hp: 5, maxHp: 5, team: 2 },
          spatial3d: { z: 24, height: 18, dimensionMask: 3 },
          tag: 'boss_3d',
        },
      },
      {
        id: 'pillar_3d',
        name: '3D Pillar',
        roomId: 'voxel_hall',
        components: {
          transform: { x: 2 * 32, y: 2 * 32, w: 32, h: 32 },
          spatial3d: { z: 0, height: 20, yaw: 45 },
          mesh3d: { modelId: 'relic_pillar', scaleX: 1, scaleY: 1, scaleZ: 1, castShadow: true },
          tag: 'prop',
        },
      },
    ],
  };
}

function createCaptureGpu(): {
  gpu: GpuEngine;
  frames: Array<{ quad3d?: Quad3DPassData; mesh3d?: Mesh3DPassData }>;
} {
  const atlas = new TextureAtlas();
  const frames: Array<{ quad3d?: Quad3DPassData; mesh3d?: Mesh3DPassData }> = [];
  const fakeCanvas = { width: 640, height: 360 } as unknown as HTMLCanvasElement;
  const gpu = new GpuEngine(fakeCanvas, undefined, atlas);
  const backend: IGpuBackend = {
    kind: 'webgl2',
    resize: () => {},
    uploadAtlas: () => {},
    renderFrame: (
      _sky: SkyGradient,
      _alphaData: Float32Array,
      _alphaCount: number,
      _addData: Float32Array,
      _addCount: number,
      _timeSec: number,
      _lightsData?: Float32Array,
      _lightCount = 0,
      _occ?: GpuOcclusionState,
      quad3d?: Quad3DPassData,
      mesh3d?: Mesh3DPassData,
    ) => {
      frames.push({
        quad3d: quad3d
          ? {
              ...quad3d,
              camera: { ...quad3d.camera },
              quadViews: quad3d.quadViews
                ? ([
                    { ...quad3d.quadViews[0] },
                    { ...quad3d.quadViews[1] },
                    { ...quad3d.quadViews[2] },
                    { ...quad3d.quadViews[3] },
                  ] as const)
                : undefined,
              opaqueData: new Float32Array(quad3d.opaqueData.subarray(0, quad3d.opaqueCount * 28)),
              alphaData: new Float32Array(quad3d.alphaData.subarray(0, quad3d.alphaCount * 28)),
              additiveData: new Float32Array(quad3d.additiveData.subarray(0, quad3d.additiveCount * 28)),
            }
          : undefined,
        mesh3d: mesh3d
          ? {
              ...mesh3d,
              opaqueVertices: new Float32Array(mesh3d.opaqueVertices.subarray(0, mesh3d.opaqueVertexCount * FLOATS_PER_MESH3D_VERTEX)),
              opaqueIndices: new Uint32Array(mesh3d.opaqueIndices.subarray(0, mesh3d.opaqueIndexCount)),
            }
          : undefined,
      });
      return 1;
    },
    dispose: () => {},
  };
  (gpu as unknown as { backend: IGpuBackend }).backend = backend;
  return { gpu, frames };
}

test('RoomVoxelVolume 6-face neighbor culling and ramp/stair/half_slab/arch surface heights', () => {
  const vol = new RoomVoxelVolume();
  vol.compileFromRoom(6, 6, 32, 24, [
    // Center cube at (2, 2, 1) completely surrounded on all 6 faces
    { col: 2, row: 2, zLevel: 1, tileId: 10, shape: 'cube' },
    { col: 2, row: 1, zLevel: 1, tileId: 10, shape: 'cube' }, // N
    { col: 3, row: 2, zLevel: 1, tileId: 10, shape: 'cube' }, // E
    { col: 2, row: 3, zLevel: 1, tileId: 10, shape: 'cube' }, // S
    { col: 1, row: 2, zLevel: 1, tileId: 10, shape: 'cube' }, // W
    { col: 2, row: 2, zLevel: 2, tileId: 10, shape: 'cube' }, // TOP
    { col: 2, row: 2, zLevel: 0, tileId: 10, shape: 'cube' }, // BOT
    // Half slab, slope_e, arch
    { col: 0, row: 0, zLevel: 0, tileId: 10, shape: 'half_slab' },
    { col: 1, row: 0, zLevel: 0, tileId: 10, shape: 'slope_e' },
    { col: 4, row: 4, zLevel: 0, tileId: 10, shape: 'arch' },
  ]);

  const fullCull =
    FACE_CULL_NORTH | FACE_CULL_EAST | FACE_CULL_SOUTH | FACE_CULL_WEST | FACE_CULL_TOP | FACE_CULL_BOT;
  assert.equal(vol.computeFaceCullMask(2, 2, 1), fullCull, 'Surrounded voxel cube must cull all 6 faces (63)');
  assert.equal(vol.computeFaceCullMask(2, 2, 2) & FACE_CULL_BOT, FACE_CULL_BOT, 'Top voxel culls bottom face');

  // Half slab topZ = 12
  assert.equal(vol.sampleSupportZ(16, 16, 4, 10), 12);
  // Slope_e linear rise across col 1 ([32..64])
  const slopeMid = vol.sampleSupportZ(48, 16, 4, 10);
  assert.ok(Math.abs(slopeMid - 12) < 0.01);
  // Arch underpass: bottom ceiling at 0.7 * 24 = 16.8, so actor height 16 at z=0 fits under!
  assert.equal(vol.collidesAabb3D(4 * 32 + 8, 4 * 32 + 8, 0, 16, 16, 16, 10), false);
  assert.equal(vol.sampleCeilingZ(4 * 32 + 16, 4 * 32 + 16, 0), 24 * 0.7);
});

test('EcsActionPhysicsSystems.stepSpatial3DWithVolume applies stairs support, gravity drop & arch ceiling bonk', () => {
  const core = new EcsCoreWorld(32);
  const { Transform2D, Spatial3D } = core.components;
  const vol = new RoomVoxelVolume();
  vol.compileFromRoom(6, 4, 32, 24, [
    { col: 1, row: 1, zLevel: 0, tileId: 10, shape: 'stair_e' },
    { col: 2, row: 1, zLevel: 1, tileId: 10, shape: 'arch' }, // bottomZ at 24 + 16.8 = 40.8
  ]);

  const h = core.createEntity('climber');
  core.addComponent(h, Transform2D, { x: 1 * 32 + 20, y: 1 * 32 + 4, w: 16, h: 16 });
  const sp = core.addComponent(h, Spatial3D, { z: 12, gravityZ: 200, height: 16, stepHeight: 10 });

  const physics = new EcsActionPhysicsSystems(32);
  const events: SimEvent[] = [];
  physics.stepSpatial3DWithVolume(core, 1 / 60, vol, events, 3);
  // On stair_e at lx ~ 28/32 = 0.875 -> step 3 -> topZ = 24! Within stepHeight (10)? No, 24 > 12 + 10 = 22, so check at lx=0.6:
  const tr = core.getComponent(h, Transform2D)!;
  tr.x = 1 * 32 + 12; // cx = 1*32 + 20 -> lx = 0.625 -> step 2 -> topZ = 18 <= 12 + 10
  physics.stepSpatial3DWithVolume(core, 1 / 60, vol, events, 3);
  assert.equal(sp.z, 18);

  // Move under z=1 arch and jump upwards -> head bonks on arch ceiling (40.8)
  tr.x = 2 * 32 + 8;
  sp.z = 24;
  sp.vz = 1500; // huge jump velocity to hit ceiling in 1 frame
  physics.stepSpatial3DWithVolume(core, 1 / 60, vol, events, 3);
  assert.ok(sp.z + sp.height <= 40.81, `Expected head bonk <= 40.8, got ${sp.z + sp.height}`);
  assert.equal(sp.vz, 0);
});

test('EcsWorldMapController 3D collision & elevation lets hero climb stairs, cross z=1 bridge, and walk under elevated decks', () => {
  const proj = makeVoxelRoomProject();
  const rt = new EcsCartridgeRuntime(proj);
  const ctrl = rt.getWorldMapController();

  // Verify outVoxels3d populated & snapshot forwards voxels3d + models3d
  assert.ok(ctrl.outVoxels3dCount >= 6);
  const initSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(initSnap.voxels3d && initSnap.voxels3d.length === ctrl.outVoxels3dCount);
  assert.ok(initSnap.models3d?.relic_pillar);

  // 1. Walk East up stair_e at (3,5,0) onto upper bridge (4..7,5,0) top at z=24!
  const inp = createEmptyInputState();
  inp.right = true;
  for (let i = 0; i < 65; i++) {
    rt.step(1 / 60, inp, DEFAULT_RUNTIME_PARAMS);
  }
  const hero = rt.world.inspectEntities().find((e) => e.entityId === 'hero')!;
  assert.ok(hero.x > 4 * 32, `Hero should climb stairs onto upper bridge x>128, got x=${hero.x}`);
  assert.equal(hero.z, 24, `Hero should stand on top of upper bridge at z=24, got z=${hero.z}`);

  // 2. Hero at z=0 can walk UNDER elevated deck at (4..6, 3, 1) and UNDER arch at (8, 5, 0)
  const underProj = makeVoxelRoomProject();
  underProj.entities[0].components.transform = { x: 4 * 32, y: 4 * 32, w: 32, h: 32 };
  const rtUnder = new EcsCartridgeRuntime(underProj);
  const upInp = createEmptyInputState();
  upInp.up = true;
  for (let i = 0; i < 25; i++) {
    rtUnder.step(1 / 60, upInp, DEFAULT_RUNTIME_PARAMS);
  }
  const underHero = rtUnder.world.inspectEntities().find((e) => e.entityId === 'hero')!;
  assert.ok(underHero.y < 3.5 * 32, `Hero at z=0 must pass under z=1 elevated deck, got y=${underHero.y}`);
  assert.equal(underHero.z, 0);
});

test('EcsSpatialOracle 3D BFS (analyzeWorldMap3DReachability) & renderRoomSliceAscii verify multi-story reachability', () => {
  const proj = makeVoxelRoomProject();
  const slice0 = renderRoomSliceAscii(proj, 'voxel_hall', 0);
  const slice1 = renderRoomSliceAscii(proj, 'voxel_hall', 1);
  assert.equal(slice0.ok, true);
  assert.equal(slice1.ok, true);
  assert.ok(slice0.ascii.includes('>'), 'Story 0 ASCII slice shows stair_e glyph >');
  assert.ok(slice0.ascii.includes('A'), 'Story 0 ASCII slice shows arch glyph A');
  assert.ok(slice0.ascii.includes('@'), 'Story 0 ASCII slice shows hero @');
  assert.ok(slice1.ascii.includes('M'), 'Story 1 ASCII slice shows elevated boss M');

  const reachPass = analyzeWorldMap3DReachability(proj);
  assert.equal(reachPass.pass, true, `3D BFS should reach elevated boss via stairs: ${reachPass.softLockRisks.join('; ')}`);
  assert.ok(reachPass.maxStoryReached >= 1);
  assert.ok(reachPass.reachableBossIds.includes('sky_boss'));

  // Remove the stairs -> elevated boss MUST become unreachable!
  const blockedProj = structuredClone(proj);
  setRoomVoxel(blockedProj.worldMap!.rooms[0], { col: 3, row: 5, zLevel: 0, tileId: 0 });
  const reachFail = analyzeWorldMap3DReachability(blockedProj);
  assert.equal(reachFail.pass, false);
  assert.ok(reachFail.unreachableBossIds.includes('sky_boss'));
});

test('SceneTrue3DPass renders MeshRenderer3D models, Voxels3D, quadView proxies, and camera_4way billboards', () => {
  const { gpu, frames } = createCaptureGpu();
  const pass3d = new SceneTrue3DPass();
  const composedPool = createComposedLayerPool();
  const blueprints: Record<string, OrthogonalArtBlueprint> = {
    knight_bp: {
      id: 'knight_bp',
      label: 'Knight',
      layers: [
        {
          slot: 'body',
          sprites: { front: 'castle_chest_closed', back: 'castle_slime_a', side: 'castle_key' },
        },
      ],
    },
  };

  const proj = makeVoxelRoomProject();
  proj.projection = {
    ...(proj.projection ?? { mode: 'hd2d_3d' }),
    quadView: true,
    yawDeg: 0,
    pitchDeg: 35,
  };
  const rt = new EcsCartridgeRuntime(proj);
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);

  // Add a camera_4way orthogonal blueprint entity to verify dynamic facing across camera yaw
  const baseEntity = {
    id: 'guard_4way',
    sprite: 'castle_chest_closed' as const,
    x: 160,
    y: 160,
    w: 32,
    h: 32,
    yawRad: 0,
    artBlueprintId: 'knight_bp',
    artFacing: 'front' as const,
    billboardYawMode: 'camera_4way' as const,
    castShadow: true,
  };
  const testSnap = {
    ...snap,
    entities: [...snap.entities, baseEntity],
  };

  const renderAtYaw = (yawDeg: number) => {
    gpu.beginFrame('#0f172a', '#1e293b');
    pass3d.render(
      gpu,
      testSnap,
      { ...testSnap.hd2dDepth!, yawDeg },
      200,
      160,
      1,
      640,
      360,
      0,
      0.5,
      blueprints,
      composedPool,
    );
    gpu.flush(0.5);
    return frames[frames.length - 1];
  };

  const f0 = renderAtYaw(0); // rel = 0 -> front -> castle_chest_closed
  assert.ok(f0.quad3d?.quadViews?.length === 4, 'quadView=true must populate 4 quadViews');
  assert.ok((f0.mesh3d?.opaqueIndexCount ?? 0) > 0, 'Voxels + MeshRenderer3D + quadView proxy must emit Mesh3D triangles');

  const f180 = renderAtYaw(180); // rel = -180 -> back -> castle_slime_a
  const f90 = renderAtYaw(90); // rel = -90 -> side -> castle_key

  const rectFront = gpu.atlas.getRect('castle_chest_closed');
  const rectBack = gpu.atlas.getRect('castle_slime_a');
  const rectSide = gpu.atlas.getRect('castle_key');

  const hasRectInFrame = (frame: typeof f0, rect: { u0: number; v0: number }): boolean => {
    const data = frame.quad3d!.opaqueData;
    const cnt = frame.quad3d!.opaqueCount;
    for (let i = 0; i < cnt; i++) {
      const u0 = data[i * 28 + 12];
      const v0 = data[i * 28 + 13];
      const u1 = data[i * 28 + 14];
      if ((Math.abs(u0 - rect.u0) < 1e-4 || Math.abs(u1 - rect.u0) < 1e-4) && Math.abs(v0 - rect.v0) < 1e-4) {
        return true;
      }
    }
    return false;
  };

  assert.equal(hasRectInFrame(f0, rectFront), true, 'yaw=0 should render front sprite');
  assert.equal(hasRectInFrame(f180, rectBack), true, 'yaw=180 should switch camera_4way billboard to back sprite');
  assert.equal(hasRectInFrame(f90, rectSide), true, 'yaw=90 should switch camera_4way billboard to side sprite');
});

test('All 6 new 3D EcsStudioCommands, Undo/Redo, 48/48 catalog parity & MCP 3D tools work end-to-end', () => {
  const sessionSrc = readFileSync(resolve(process.cwd(), 'src/core/ecs/EcsStudioSession.ts'), 'utf8');
  const cmdBlock = sessionSrc.match(/export\s+type\s+EcsStudioCommand\s*=([\s\S]*?);\s*\r?\n\s*export\s+const\s+ECS_COMMAND_CATALOG/);
  assert.ok(cmdBlock);
  const declaredTypes = [...cmdBlock[1].matchAll(/type:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.equal(declaredTypes.length, 48, `Expected 48 EcsStudioCommand types, got ${declaredTypes.length}`);
  assert.equal(ECS_COMMAND_CATALOG.length, 48, `Expected 48 ECS_COMMAND_CATALOG entries, got ${ECS_COMMAND_CATALOG.length}`);

  const mcp = new PixerMcpSession(makeVoxelRoomProject());

  // 1. set_room_voxel + fill_room_box_3d + clear_room_voxels + Undo/Redo
  assert.equal(
    mcp.invokeTool('dispatch_ecs_command', {
      command: {
        type: 'set_room_voxel',
        roomId: 'voxel_hall',
        cell: { col: 1, row: 1, zLevel: 2, tileId: CASTLE_TILE_IDS.WALL_BRICK, shape: 'half_slab' },
      },
    }).isError,
    false,
  );
  assert.ok(mcp.session.getProject().worldMap!.rooms[0].voxels!.some((v) => v.col === 1 && v.row === 1 && v.zLevel === 2));

  assert.equal(
    mcp.invokeTool('dispatch_ecs_command', {
      command: {
        type: 'fill_room_box_3d',
        roomId: 'voxel_hall',
        c0: 1,
        r0: 2,
        z0: 1,
        c1: 2,
        r1: 2,
        z1: 1,
        tileId: CASTLE_TILE_IDS.WALL_GOTHIC,
        shape: 'cube',
      },
    }).isError,
    false,
  );

  assert.equal(
    mcp.invokeTool('dispatch_ecs_command', {
      command: { type: 'clear_room_voxels', roomId: 'voxel_hall', zLevel: 2 },
    }).isError,
    false,
  );
  assert.equal(mcp.session.getProject().worldMap!.rooms[0].voxels!.some((v) => v.zLevel === 2), false);
  assert.equal(mcp.invokeTool('undo').isError, false);
  assert.equal(mcp.session.getProject().worldMap!.rooms[0].voxels!.some((v) => v.zLevel === 2), true);

  // 2. upsert_model_3d & remove_model_3d & list_models_3d
  const newModel: EcsModel3DDef = {
    id: 'altar_cube',
    name: 'Altar Cube',
    parts: [{ id: 'core', origin: [-6, -6, 0], size: [12, 12, 12], faces: { top: 'castle_wall_top' } }],
  };
  assert.equal(
    mcp.invokeTool('dispatch_ecs_command', { command: { type: 'upsert_model_3d', model: newModel } }).isError,
    false,
  );
  const modelsList = mcp.invokeTool('list_models_3d').structuredContent as { models3d: Array<{ id: string }> };
  assert.ok(modelsList.models3d.some((m) => m.id === 'altar_cube'));

  assert.equal(
    mcp.invokeTool('dispatch_ecs_command', { command: { type: 'remove_model_3d', modelId: 'altar_cube' } }).isError,
    false,
  );
  const modelsAfterRemove = mcp.invokeTool('list_models_3d').structuredContent as { models3d: Array<{ id: string }> };
  assert.equal(modelsAfterRemove.models3d.some((m) => m.id === 'altar_cube'), false);

  // 3. set_camera_3d_pose
  assert.equal(
    mcp.invokeTool('dispatch_ecs_command', {
      command: {
        type: 'set_camera_3d_pose',
        yawDeg: 135,
        pitchDeg: -15,
        quadView: true,
        cameraProjection3d: 'ortho_iso',
        showAxisGizmo3d: true,
        showOrthoGrid3d: true,
      },
    }).isError,
    false,
  );
  const projAfterPose = mcp.session.getProject();
  assert.equal(validateEcsProjectV2(projAfterPose).ok, true);
  assert.equal(projAfterPose.projection?.yawDeg, 135);
  assert.equal(projAfterPose.projection?.quadView, true);

  // 4. MCP 3D tools: get_room_slice_ascii, analyze_world_map_3d, describe_editor_grammar
  const sliceRes = mcp.invokeTool('get_room_slice_ascii', { roomId: 'voxel_hall', zLevel: 0 })
    .structuredContent as EcsRoomSliceAsciiReport;
  assert.equal(sliceRes.ok, true);
  assert.equal(sliceRes.zLevel, 0);

  const reach3dRes = mcp.invokeTool('analyze_world_map_3d').structuredContent as EcsWorldMap3DReachabilityReport;
  assert.equal(reach3dRes.pass, true);
  assert.ok(reach3dRes.maxStoryReached >= 1);

  const grammar = mcp.invokeTool('describe_editor_grammar').structuredContent as {
    commands: Array<{ type: string }>;
    voxelShapes: string[];
    models3d: Array<{ id: string }>;
  };
  assert.equal(grammar.commands.length, 48);
  assert.ok(grammar.voxelShapes.includes('stair_e'));
  assert.ok(grammar.models3d.some((m) => m.id === 'relic_pillar'));
});

test('Auto Camera Z Follow smoothly tracks hero Spatial3D.z on stairs & respects opt-out / editor override', () => {
  const proj = makeVoxelRoomProject();
  const rt = new EcsCartridgeRuntime(proj);
  const initSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(initSnap.hd2dDepth?.camCenterZ, 0, 'Camera Z starts grounded at hero Z=0');

  // Climb east up (3,5,0) stair_e onto elevated z=24 bridge deck
  const rightInput = { ...createEmptyInputState(), right: true };
  let prevCamZ = 0;
  let midClimbCamZ = 0;
  for (let f = 0; f < 50; f++) {
    rt.step(1 / 60, rightInput, DEFAULT_RUNTIME_PARAMS);
    if (f === 26) {
      midClimbCamZ = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1).hd2dDepth?.camCenterZ ?? 0;
    }
  }
  const idleInput = createEmptyInputState();
  for (let f = 0; f < 40; f++) {
    rt.step(1 / 60, idleInput, DEFAULT_RUNTIME_PARAMS);
  }
  const topSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const heroEnt = topSnap.entities.find((e) => e.id === 'hero');
  assert.ok(heroEnt && (heroEnt.elevationZ ?? 0) >= 23, `Hero should stand on z=24 deck (got ${heroEnt?.elevationZ})`);
  assert.ok((heroEnt?.groundZ ?? 0) >= 23, `Hero groundZ should track deck surface (got ${heroEnt?.groundZ})`);
  assert.ok(midClimbCamZ > prevCamZ, 'Camera Z should rise smoothly during stair ascent');
  assert.ok(
    Math.abs((topSnap.hd2dDepth?.camCenterZ ?? 0) - 24) < 1.0,
    `Camera Z should converge smoothly to hero Z=24 (got ${topSnap.hd2dDepth?.camCenterZ})`,
  );

  // Editor camera override must freeze auto-follow to static proj.projection.camCenterZ
  rt.setEditorCamera(0, 0);
  const editorSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(editorSnap.hd2dDepth?.camCenterZ, 0, 'Editor override must honor static camCenterZ');
  rt.clearEditorCamera();

  // Explicit autoFollowHeroZ: false must pin camCenterZ even while hero is elevated
  rt.patchLiveProjection({ autoFollowHeroZ: false, camCenterZ: 12 });
  const pinnedSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(pinnedSnap.hd2dDepth?.camCenterZ, 12, 'autoFollowHeroZ=false must keep manual camCenterZ');
});

test('Interior Roof / Upper-Floor Cutaway hides/fades overhead voxels, caps boundary top faces & respects quadView/off', () => {
  const proj = makeVoxelRoomProject();
  // Add a stacked 2-story column at (4, 3) (z=0 cube below z=1 overpass cube) to verify FACE_CULL_TOP un-culling on cut boundary
  setRoomVoxel(proj.worldMap!.rooms[0], {
    col: 4,
    row: 3,
    zLevel: 0,
    tileId: CASTLE_TILE_IDS.WALL_BRICK,
    shape: 'cube',
  });
  const rt = new EcsCartridgeRuntime(proj);
  const pass = new SceneTrue3DPass();
  const composed = createComposedLayerPool();

  // 1. Outdoors at (2, 5, z=0): cutaway stays inactive
  const outdoorSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(outdoorSnap.hd2dDepth?.cutawayActive, false);

  // 2. Move hero directly underneath the zLevel=1 overpass roof at (5, 3, z=0)
  const core = rt.world.core;
  const c = core.components;
  const tagStore = core.getStore(c.Tag);
  let heroHandle = 0;
  for (let i = 0; i < tagStore.size(); i++) {
    if (tagStore.getDenseDataAt(i).tag === 'hero') {
      heroHandle = tagStore.getDenseEntityAt(i);
      break;
    }
  }
  const hTr = core.getComponent(heroHandle, c.Transform2D)!;
  hTr.x = 5 * 32 + 4;
  hTr.y = 3 * 32 + 4;
  hTr.prevX = hTr.x;
  hTr.prevY = hTr.y;
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);

  // Ghost-fade mode (default alpha 0.18) -> upper voxels emit into meshAlpha pass & boundary L0 cube clears FACE_CULL_TOP
  const underSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(underSnap.hd2dDepth?.cutawayActive, true);
  assert.equal(underSnap.hd2dDepth?.cutawayPlaneZ, 24);

  const { gpu: gpuGhost, frames: ghostFrames } = createCaptureGpu();
  const boundaryCullMasks: number[] = [];
  const origCuboidGhost = gpuGhost.drawCuboid3D.bind(gpuGhost);
  gpuGhost.drawCuboid3D = (topId, sideId, botId, x, y, z, sx, sy, sz, cullMask, ...rest) => {
    if (Math.abs(x - 4 * 32) < 1 && Math.abs(y - 3 * 32) < 1 && Math.abs(z) < 1) {
      boundaryCullMasks.push(cullMask ?? 0);
    }
    return origCuboidGhost(topId, sideId, botId, x, y, z, sx, sy, sz, cullMask, ...rest);
  };
  gpuGhost.beginFrame('#060914', '#14192e');
  pass.render(gpuGhost, underSnap, underSnap.hd2dDepth!, 160, 112, 1, 640, 360, 0, 0, undefined, composed);
  gpuGhost.flush(0);
  assert.ok((ghostFrames[0].mesh3d?.alphaIndexCount ?? 0) > 0, 'Cutaway ghost mode must route upper voxels into meshAlpha pass');
  assert.ok(
    boundaryCullMasks.length > 0 && (boundaryCullMasks[0] & FACE_CULL_TOP) === 0,
    'Boundary lower-story cube directly beneath cutawayPlaneZ must clear FACE_CULL_TOP to cap cut cross-section',
  );

  // Full-hide mode (roofCutawayAlpha: 0) -> zero upper-story cuboids drawn & alphaIndexCount === 0
  rt.patchLiveProjection({ roofCutawayAlpha: 0 });
  const hideSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const { gpu: gpuHide, frames: hideFrames } = createCaptureGpu();
  let upperCuboidDraws = 0;
  const origCuboidHide = gpuHide.drawCuboid3D.bind(gpuHide);
  gpuHide.drawCuboid3D = (topId, sideId, botId, x, y, z, ...rest) => {
    if (z >= 23.5) upperCuboidDraws++;
    return origCuboidHide(topId, sideId, botId, x, y, z, ...rest);
  };
  gpuHide.beginFrame('#060914', '#14192e');
  pass.render(gpuHide, hideSnap, hideSnap.hd2dDepth!, 160, 112, 1, 640, 360, 0, 0, undefined, composed);
  gpuHide.flush(0);
  assert.equal(upperCuboidDraws, 0, 'roofCutawayAlpha=0 must completely omit upper-story voxels');
  assert.equal(hideFrames[0].mesh3d?.alphaIndexCount ?? 0, 0);

  // roofCutawayMode='off' and quadView=true must both disable cutaway
  rt.patchLiveProjection({ roofCutawayMode: 'off', roofCutawayAlpha: 0.2 });
  assert.equal(rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1).hd2dDepth?.cutawayActive, false);
  rt.patchLiveProjection({ roofCutawayMode: 'always', quadView: true });
  assert.equal(rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1).hd2dDepth?.cutawayActive, false);
  rt.patchLiveProjection({ roofCutawayMode: 'always', quadView: false });
  assert.equal(rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1).hd2dDepth?.cutawayActive, true);

  // Also verify elevated hero's contact shadow projects onto support deck Z (~24.25) instead of underground 0.25
  const shadowZs: number[] = [];
  const { gpu: gpuShadow } = createCaptureGpu();
  const origShadow = gpuShadow.drawGroundShadow3D.bind(gpuShadow);
  gpuShadow.drawGroundShadow3D = (cx, cy, z, sw, sh, color, alpha, soft) => {
    shadowZs.push(z ?? 0);
    return origShadow(cx, cy, z, sw, sh, color, alpha, soft);
  };
  const hSp = core.getComponent(heroHandle, c.Spatial3D)!;
  hTr.x = 5 * 32 + 4;
  hTr.y = 5 * 32 + 4;
  hTr.prevX = hTr.x;
  hTr.prevY = hTr.y;
  hSp.z = 24;
  hSp.prevZ = 24;
  hSp.groundZ = 24;
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const deckSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  gpuShadow.beginFrame('#060914', '#14192e');
  pass.render(gpuShadow, deckSnap, deckSnap.hd2dDepth!, 160, 160, 1, 640, 360, 0, 0, undefined, composed);
  gpuShadow.flush(0);
  assert.ok(
    shadowZs.some((z) => z > 24 && z < 25),
    `Elevated hero contact shadow should project onto elevated deck (~24.25), got [${shadowZs.join(', ')}]`,
  );
});

test('Z-Aware Prefab Stamping (instantiate_prefab.z), 3D Story Lighting & Workbench Stamp parity', () => {
  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const stampRes = session.dispatch({
    type: 'instantiate_prefab',
    prefabId: 'castle_torch',
    entityId: 'stamped_l2_torch',
    x: 20 * 32 + 16,
    y: 13 * 32 + 16,
    z: 56,
    roomId: 'courtyard',
  });
  assert.equal(stampRes.ok, true);
  const created = session.getProject().entities.find((e) => e.id === 'stamped_l2_torch');
  assert.equal(created?.overrides?.spatial3d?.z, 56, 'instantiate_prefab.z must persist into overrides.spatial3d.z');

  // Undo & Redo preserve Z-stamped prefab cleanly
  assert.equal(session.undo().ok, true);
  assert.equal(session.getProject().entities.some((e) => e.id === 'stamped_l2_torch'), false);
  assert.equal(session.redo().ok, true);
  assert.equal(
    session.getProject().entities.find((e) => e.id === 'stamped_l2_torch')?.overrides?.spatial3d?.z,
    56,
  );

  // Runtime snapshot places elevated 3D point light at true world (x, y, z+24) without 2.5D Y northward skew
  const rt = new EcsCartridgeRuntime(session.getProject());
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const expectedX = 20 * 32 + 16 + 16;
  const expectedY = 13 * 32 + 16 + 16;
  const elevatedLight = snap.lights.find(
    (l) => Math.abs(l.x - expectedX) < 1 && Math.abs(l.y - expectedY) < 1 && Math.abs((l.z ?? 0) - 80) < 1,
  );
  assert.ok(elevatedLight, 'Z-stamped torch must emit 3D point light at exact world (x, y, z+24) in hd2d_3d');

  // Source contract: Map Canvas stamp tool snaps to activeZLevel * storyH
  const canvasCtrlSrc = readFileSync(
    resolve(process.cwd(), 'src/ui/EcsWorkbenchMapCanvasController.ts'),
    'utf8',
  );
  assert.ok(
    canvasCtrlSrc.includes('mapState.activeZLevel * storyH') && canvasCtrlSrc.includes('z: stampZ'),
    'EcsWorkbenchMapCanvasController stamp tool must pass activeZLevel * storyH as z',
  );
});

test('PA-14 Obsidian Citadel Flagship Multi-Story Watchtower passes 3D BFS (L0->L1->L2), hosts 3D Beacon & triggers live cutaway', () => {
  assert.equal(validateEcsProjectV2(OBSIDIAN_CITADEL_PROJECT).ok, true);
  const beacon = OBSIDIAN_CITADEL_PROJECT.models3d?.citadel_beacon;
  assert.ok(beacon && beacon.parts.length >= 4 && beacon.rawMesh && beacon.rawMesh.indices.length === 24);

  const reach3d = analyzeWorldMap3DReachability(OBSIDIAN_CITADEL_PROJECT);
  assert.equal(reach3d.pass, true, `PA-14 3D BFS failed: ${reach3d.softLockRisks.join('; ')}`);
  assert.ok(reach3d.maxStoryReached >= 2, `PA-14 watchtower must be climbable to L2 (got ${reach3d.maxStoryReached})`);
  assert.equal(reach3d.reachableRoomIds.length, 3);
  assert.equal(reach3d.unlockedGlobals.has_gate_key, 1);
  assert.equal(reach3d.unlockedGlobals.throne_gate_open, 1);

  // Live runtime test: (1) stand under vaulted ground chamber -> cutaway triggers; (2) climb L0->L1->L2 -> cameraZ follows
  const rt = new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT);
  const core = rt.world.core;
  const c = core.components;
  const tagStore = core.getStore(c.Tag);
  let heroHandle = 0;
  for (let i = 0; i < tagStore.size(); i++) {
    if (tagStore.getDenseDataAt(i).tag === 'hero') {
      heroHandle = tagStore.getDenseEntityAt(i);
      break;
    }
  }
  assert.ok(heroHandle !== 0);
  const hTr = core.getComponent(heroHandle, c.Transform2D)!;
  const hSp = core.getComponent(heroHandle, c.Spatial3D)!;
  assert.ok(hSp, 'PA-14 hero must carry Spatial3D component for multi-story climbing');

  // Step 1: Enter vaulted chamber at (20, 14, L0) beneath L1 roof
  hTr.x = 20 * 32 + 2;
  hTr.y = 14 * 32 + 2;
  hTr.prevX = hTr.x;
  hTr.prevY = hTr.y;
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const chamberSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(chamberSnap.hd2dDepth?.cutawayActive, true, 'Walking under PA-14 watchtower vault must trigger cutaway');
  assert.equal(chamberSnap.hd2dDepth?.cutawayPlaneZ, 28);

  // Step 2: Approach L0->L1 stair_e at (18,15), turn north up L1->L2 stair_n at (19,14) onto L2 landing (19,13), then step east onto L2 deck
  hTr.x = 17 * 32 + 8;
  hTr.y = 15 * 32 + 2;
  hTr.prevX = hTr.x;
  hTr.prevY = hTr.y;
  hSp.z = 0;
  hSp.prevZ = 0;
  const moveRight = { ...createEmptyInputState(), right: true };
  const moveUp = { ...createEmptyInputState(), up: true };
  for (let f = 0; f < 40; f++) rt.step(1 / 60, moveRight, DEFAULT_RUNTIME_PARAMS);
  assert.ok(hSp.z >= 27, `Hero should climb L0->L1 stair onto z=28 balcony (got z=${hSp.z})`);
  for (let f = 0; f < 24; f++) rt.step(1 / 60, moveUp, DEFAULT_RUNTIME_PARAMS);
  assert.ok(hSp.z >= 55, `Hero should climb L1->L2 stair onto z=56 landing (got z=${hSp.z}, y=${hTr.y})`);
  for (let f = 0; f < 22; f++) rt.step(1 / 60, moveRight, DEFAULT_RUNTIME_PARAMS);
  for (let f = 0; f < 40; f++) rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);

  const summitSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(hSp.z >= 55, `Hero should climb L1->L2 stair onto z=56 tower summit (got z=${hSp.z})`);
  assert.ok(
    (summitSnap.hd2dDepth?.camCenterZ ?? 0) > 48,
    `Camera Z must smoothly follow hero to L2 tower summit (got ${summitSnap.hd2dDepth?.camCenterZ})`,
  );
  assert.equal(summitSnap.hd2dDepth?.cutawayActive, false, 'Open L2 watchtower rooftop must disable cutaway');
});
