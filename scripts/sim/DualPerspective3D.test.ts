import assert from 'node:assert/strict';
import test from 'node:test';
import { TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import { GpuEngine } from '../../src/core/gpu/GpuEngine.ts';
import type {
  GpuOcclusionState,
  IGpuBackend,
  Quad3DPassData,
  SkyGradient,
} from '../../src/core/gpu/GpuTypes.ts';
import {
  buildCamera3DViewProjMatrix,
  computeCamera3D,
  createComputedCamera3D,
  projectWorld3DToScreen,
  screenToWorldPlaneZ,
  type ScreenPoint3D,
} from '../../src/core/math/Perspective3DMath.ts';
import { SceneGpuBridge } from '../../src/core/runtime/SceneGpuBridge.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { EMERALD_RUINS_PROJECT } from '../../src/game/emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

interface CapturedFrame {
  alphaCount: number;
  additiveCount: number;
  lightCount: number;
  quad3d?: {
    enabled: boolean;
    opaqueCount: number;
    alphaCount: number;
    additiveCount: number;
    pitchDeg: number;
    fovDeg: number;
  };
}

type ActiveBackendKind = 'webgpu' | 'webgl2' | 'canvas2d';

function createMockBackend(kind: ActiveBackendKind): { backend: IGpuBackend; frames: CapturedFrame[] } {
  const frames: CapturedFrame[] = [];
  const backend: IGpuBackend = {
    kind,
    resize: () => {},
    uploadAtlas: () => {},
    renderFrame: (
      _sky: SkyGradient,
      _alphaData: Float32Array,
      alphaCount: number,
      _additiveData: Float32Array,
      additiveCount: number,
      _timeSec: number,
      _lightsData?: Float32Array,
      lightCount = 0,
      _occlusion?: GpuOcclusionState,
      quad3d?: Quad3DPassData,
    ) => {
      frames.push({
        alphaCount,
        additiveCount,
        lightCount,
        quad3d: quad3d
          ? {
              enabled: quad3d.camera.enabled,
              opaqueCount: quad3d.opaqueCount,
              alphaCount: quad3d.alphaCount,
              additiveCount: quad3d.additiveCount,
              pitchDeg: quad3d.camera.pitchDeg,
              fovDeg: quad3d.camera.fovDeg,
            }
          : undefined,
      });
      return 1;
    },
    dispose: () => {},
  };
  return { backend, frames };
}

function attachMockGpu(kind: ActiveBackendKind, atlas: TextureAtlas): { gpu: GpuEngine; frames: CapturedFrame[] } {
  const fakeCanvas = { width: 640, height: 360 } as unknown as HTMLCanvasElement;
  const gpu = new GpuEngine(fakeCanvas, undefined, atlas);
  const { backend, frames } = createMockBackend(kind);
  (gpu as unknown as { backend: IGpuBackend }).backend = backend;
  return { gpu, frames };
}

test('Perspective3DMath: exact projection <-> analytical ray-plane round-trip and WebGPU/WebGL2 clip depth', () => {
  const cam = createComputedCamera3D();
  const pt: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 1, visible: false };
  const worldOut: [number, number] = [0, 0];

  const configs = [
    { pitchDeg: 42, fovDeg: 38, viewW: 640, viewH: 360 },
    { pitchDeg: 28, fovDeg: 52, viewW: 480, viewH: 270 },
    { pitchDeg: 65, fovDeg: 26, viewW: 960, viewH: 540 },
  ];

  for (const cfg of configs) {
    computeCamera3D(
      {
        camCenterX: 416,
        camCenterY: 288,
        zoom: 1,
        viewW: cfg.viewW,
        viewH: cfg.viewH,
        pitchDeg: cfg.pitchDeg,
        fovDeg: cfg.fovDeg,
      },
      cam,
    );

    // Center of ground plane must map exactly to center of viewport
    projectWorld3DToScreen(416, 288, 0, cam, pt);
    assert.ok(pt.visible);
    assert.ok(Math.abs(pt.x - cfg.viewW * 0.5) < 1e-4, 'Camera target must project to viewport center X');
    assert.ok(Math.abs(pt.y - cfg.viewH * 0.5) < 1e-4, 'Camera target must project to viewport center Y');
    assert.ok(Math.abs(pt.scale - 1.0) < 1e-4, 'Scale at camera target must equal zoom (1.0)');

    // Round-trip across grid points on Z=0 and Z=24 planes
    const samples: Array<[number, number, number]> = [
      [416, 288, 0],
      [256, 200, 0],
      [590, 360, 0],
      [310, 240, 24],
      [512, 330, 24],
    ];
    for (const [wx, wy, wz] of samples) {
      projectWorld3DToScreen(wx, wy, wz, cam, pt);
      assert.ok(pt.visible);
      const hit = screenToWorldPlaneZ(pt.x, pt.y, cam, worldOut, wz);
      assert.ok(hit, 'Ray must intersect horizontal plane');
      assert.ok(Math.abs(worldOut[0] - wx) < 0.01, `Round-trip X error too large: ${worldOut[0]} vs ${wx}`);
      assert.ok(Math.abs(worldOut[1] - wy) < 0.01, `Round-trip Y error too large: ${worldOut[1]} vs ${wy}`);
    }

    // Verify WebGPU [0,1] and WebGL2 [-1,1] View-Projection matrices match projectWorld3DToScreen
    const vpGpu = buildCamera3DViewProjMatrix(cam, true, new Float32Array(16));
    const vpGl = buildCamera3DViewProjMatrix(cam, false, new Float32Array(16));
    const wx = 340;
    const wy = 240;
    const wz = 18;
    projectWorld3DToScreen(wx, wy, wz, cam, pt);

    const evalVp = (m: Float32Array) => {
      const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
      const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
      const cz = m[2] * wx + m[6] * wy + m[10] * wz + m[14];
      const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
      return { ndcX: cx / cw, ndcY: cy / cw, ndcZ: cz / cw };
    };
    const rGpu = evalVp(vpGpu);
    const rGl = evalVp(vpGl);
    assert.ok(Math.abs((rGpu.ndcX * 0.5 + 0.5) * cfg.viewW - pt.x) < 1e-3);
    assert.ok(Math.abs((0.5 - rGpu.ndcY * 0.5) * cfg.viewH - pt.y) < 1e-3);
    assert.ok(Math.abs(rGpu.ndcX - rGl.ndcX) < 1e-5);
    assert.ok(Math.abs(rGpu.ndcY - rGl.ndcY) < 1e-5);
    assert.ok(rGpu.ndcZ >= 0 && rGpu.ndcZ <= 1, `WebGPU ndcZ must be in [0,1], got ${rGpu.ndcZ}`);
    assert.ok(rGl.ndcZ >= -1 && rGl.ndcZ <= 1, `WebGL2 ndcZ must be in [-1,1], got ${rGl.ndcZ}`);
  }
});

test('EcsWorldMapController computes 4-bit solid-wall neighbor autoMask & updates on gate unlock', () => {
  const rt = new EcsCartridgeRuntime(EMERALD_RUINS_PROJECT);
  const input = createEmptyInputState();
  rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);

  const wallTiles = snap.tiles.filter((t) => (t.extrudeH ?? 0) > 0);
  assert.ok(wallTiles.length > 0, 'WorldMap must emit wall tiles');

  // Top-left corner (0,0) has solid neighbors East (2) and South (4), no North (1) or West (8)
  const cornerWall = wallTiles.find((t) => t.x === 0 && t.y === 0);
  assert.ok(cornerWall, 'Corner wall (0,0) must exist');
  assert.equal((cornerWall.autoMask ?? 0) & 1, 0, 'Corner (0,0) has no North neighbor');
  assert.equal((cornerWall.autoMask ?? 0) & 2, 2, 'Corner (0,0) must detect East neighbor (bit 2)');
  assert.equal((cornerWall.autoMask ?? 0) & 4, 4, 'Corner (0,0) must detect South neighbor (bit 4)');
  assert.equal((cornerWall.autoMask ?? 0) & 8, 0, 'Corner (0,0) has no West neighbor');

  // Ground tiles must keep autoMask = 0
  const floorTile = snap.tiles.find((t) => (t.extrudeH ?? 0) === 0);
  assert.ok(floorTile);
  assert.equal(floorTile.autoMask ?? 0, 0);

  // Unlock north seal gate at col=9, row=0 -> wall left of gate (col=8, row=0) must lose East bit (2)
  const wallLeftOfGateBefore = wallTiles.find((t) => t.x === 8 * 32 && t.y === 0);
  assert.ok(wallLeftOfGateBefore);
  assert.equal((wallLeftOfGateBefore.autoMask ?? 0) & 2, 2, 'Before unlock, locked gate counts as East solid neighbor');

  rt.world.setGlobal('grove_seal_open', 1);
  rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  const snapAfter = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const wallLeftOfGateAfter = snapAfter.tiles.find((t) => (t.extrudeH ?? 0) > 0 && t.x === 8 * 32 && t.y === 0);
  assert.ok(wallLeftOfGateAfter);
  assert.equal((wallLeftOfGateAfter.autoMask ?? 0) & 2, 0, 'After unlock, open gate must clear East neighbor bit');
});

test('SceneGpuBridge dual-mode: hd2d_3d emits 3D quads on WebGL2/WebGPU, hd2d_iso emits lifted 2.5D, Canvas2D falls back safely', () => {
  const atlas = new TextureAtlas();
  const bridge = new SceneGpuBridge();
  const input = createEmptyInputState();

  // 1. Mode B: True 3D Perspective (hd2d_3d) on WebGL2 backend
  const rt3d = new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT);
  rt3d.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  const snap3d = rt3d.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(snap3d.hd2dDepth?.mode3d, true, 'PA-14 default snapshot must enable mode3d');

  const glMock = attachMockGpu('webgl2', atlas);
  bridge.render(glMock.gpu, snap3d, null);
  assert.equal(glMock.frames.length, 1);
  const f3d = glMock.frames[0];
  assert.ok(f3d.quad3d?.enabled, 'hd2d_3d on WebGL2 must activate quad3d pass');
  assert.ok((f3d.quad3d?.opaqueCount ?? 0) > 100, 'hd2d_3d must emit 3D floor + neighbor-culled wall box quads');
  assert.ok((f3d.quad3d?.alphaCount ?? 0) > 0, 'hd2d_3d must emit 3D contact shadows / blended quads');
  assert.equal(f3d.quad3d?.pitchDeg, 42);
  assert.equal(f3d.quad3d?.fovDeg, 38);

  // 2. Mode A: Soul Knight 3/4 Strong-Volume 2.5D (hd2d_iso) on WebGL2 backend
  const isoProj = structuredClone(OBSIDIAN_CITADEL_PROJECT);
  isoProj.projection = { ...isoProj.projection!, mode: 'hd2d_iso' };
  const rtIso = new EcsCartridgeRuntime(isoProj);
  rtIso.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  const snapIso = rtIso.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(snapIso.hd2dDepth?.mode3d, false);

  bridge.render(glMock.gpu, snapIso, null);
  assert.equal(glMock.frames.length, 2);
  const fIso = glMock.frames[1];
  assert.equal(Boolean(fIso.quad3d?.enabled), false, 'hd2d_iso must disable 3D pass and render via 2D PBR instancing');
  assert.ok(fIso.alphaCount > 200, 'hd2d_iso must emit lifted 2.5D wall caps, facades, and oblique cast shadows');

  // 3. Graceful fallback: hd2d_3d on Canvas2D backend falls back cleanly to 2.5D without throwing
  const c2dMock = attachMockGpu('canvas2d', atlas);
  assert.equal(c2dMock.gpu.supports3D(), false);
  bridge.render(c2dMock.gpu, snap3d, null);
  assert.equal(c2dMock.frames.length, 1);
  assert.equal(Boolean(c2dMock.frames[0].quad3d?.enabled), false, 'Canvas2D must fall back to 2.5D instancing');
  assert.ok(c2dMock.frames[0].alphaCount > 200, 'Canvas2D fallback must still render full scene');
});

test('Transactional set_projection Undo/Redo, live patchLiveProjection, and MCP grammar/semantics parity', () => {
  const session = new EcsStudioSession(EMERALD_RUINS_PROJECT);
  assert.equal(session.getProject().projection?.mode, 'hd2d_3d');

  // Switch live to hd2d_iso and customize pitch/wallHeightScale
  const res1 = session.dispatch({
    type: 'set_projection',
    patch: { mode: 'hd2d_iso', obliqueShadowAlpha: 0.5 },
  });
  assert.ok(res1.ok);
  assert.equal(session.getProject().projection?.mode, 'hd2d_iso');
  assert.equal(session.getProject().projection?.obliqueShadowAlpha, 0.5);

  const res2 = session.dispatch({
    type: 'set_projection',
    patch: { mode: 'hd2d_3d', pitchDeg: 54, fovDeg: 44, wallHeightScale: 1.65, billboardTiltDeg: 18 },
  });
  assert.ok(res2.ok);
  assert.equal(session.getProject().projection?.mode, 'hd2d_3d');
  assert.equal(session.getProject().projection?.pitchDeg, 54);
  assert.equal(session.getProject().projection?.wallHeightScale, 1.65);

  // Undo reverts to hd2d_iso, Redo restores hd2d_3d @ 54 deg
  assert.ok(session.undo().ok);
  assert.equal(session.getProject().projection?.mode, 'hd2d_iso');
  assert.ok(session.redo().ok);
  assert.equal(session.getProject().projection?.mode, 'hd2d_3d');
  assert.equal(session.getProject().projection?.pitchDeg, 54);

  // Runtime live slider scrub updates snapshot without resetting hero position
  const rt = new EcsCartridgeRuntime(session.getProject());
  const input = createEmptyInputState();
  input.right = true;
  for (let i = 0; i < 15; i++) rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  const heroBefore = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1).entities.find((e) => e.id === 'hero')!;
  rt.patchLiveProjection({ pitchDeg: 33, fovDeg: 48, wallHeightScale: 1.9, billboardTiltDeg: 6 });
  const snapAfter = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const heroAfter = snapAfter.entities.find((e) => e.id === 'hero')!;
  assert.equal(heroAfter.x, heroBefore.x, 'patchLiveProjection must not reset hero position');
  assert.equal(snapAfter.hd2dDepth?.pitchDeg, 33);
  assert.equal(snapAfter.hd2dDepth?.fovDeg, 48);
  assert.equal(snapAfter.hd2dDepth?.wallHeightScale, 1.9);
  assert.equal(snapAfter.hd2dDepth?.billboardTiltDeg, 6);

  // MCP protocol grammar & command parity
  const mcp = new PixerMcpSession(OBSIDIAN_CITADEL_PROJECT);
  const grammar = mcp.invokeTool('describe_editor_grammar');
  assert.equal(grammar.isError, false);
  const grammarPayload = grammar.structuredContent as { commands: Array<{ type: string; fields: string }> };
  const setProjCmd = grammarPayload.commands.find((c) => c.type === 'set_projection');
  assert.ok(setProjCmd && setProjCmd.fields.includes('hd2d_3d') && setProjCmd.fields.includes('pitchDeg'));

  const mcpDispatch = mcp.invokeTool('dispatch_ecs_command', {
    command: { type: 'set_projection', patch: { mode: 'hd2d_3d', pitchDeg: 48, wallHeightScale: 1.4 } },
  });
  assert.equal(mcpDispatch.isError, false);

  const semantics = mcp.invokeTool('get_scene_semantics');
  assert.equal(semantics.isError, false);
  const semPayload = semantics.structuredContent as {
    projection: { mode: string; pitchDeg?: number; wallHeightScale?: number };
  };
  assert.equal(semPayload.projection.mode, 'hd2d_3d');
  assert.equal(semPayload.projection.pitchDeg, 48);
  assert.equal(semPayload.projection.wallHeightScale, 1.4);
});
