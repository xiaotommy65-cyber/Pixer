import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { syncProjectCustomSpritesToAtlas } from '../../src/core/ecs/EcsCustomSpriteCompiler.ts';
import { cloneEcsProject } from '../../src/core/ecs/EcsProjectSchema.ts';
import { EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import { buildBuiltinStarterPack, buildAssetPackInstallCommands } from '../../src/core/interop/index.ts';
import { GpuDynamicGlyphCache } from '../../src/core/gpu/GpuDynamicGlyphCache.ts';
import { GpuEngine, hexToRgb01 } from '../../src/core/gpu/GpuEngine.ts';
import type {
  GpuOcclusionState,
  IGpuBackend,
  Quad3DPassData,
  SkyGradient,
} from '../../src/core/gpu/GpuTypes.ts';
import { COMPOSITE_FS, QUAD3D_FS, SPRITE_FS } from '../../src/core/gpu/WebGl2Shaders.ts';
import { WGSL_CODE, WGSL_POST_CODE } from '../../src/core/gpu/WebGpuShaders.ts';
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

test('GPU & SceneGpuBridge edge cases: strict hex parsing, NaN light/camera rejection & maxLife=0 particle safety', () => {
  // 1. Strict hex color cache: #000000 stays black, #f00 expands, invalid hex falls back to white
  assert.deepEqual(hexToRgb01('#000000'), [0, 0, 0]);
  assert.deepEqual(hexToRgb01('#f00'), [1, 0, 0]);
  assert.deepEqual(hexToRgb01('#12zzzz'), [1, 1, 1]);

  const atlas = new TextureAtlas();
  const glMock = attachMockGpu('webgl2', atlas);
  glMock.gpu.beginFrame('#000000', '#112233');
  glMock.gpu.pushDynamicLight(Number.NaN, 10, 64, '#ffaa00', 0.8);
  glMock.gpu.pushDynamicLight(10, 20, Number.NaN, '#ffaa00', 0.8);
  glMock.gpu.setCamera3D(Number.NaN, 50, Number.NaN, Number.NaN, Number.NaN);
  glMock.gpu.drawBox3DWall('wall_stone', null, 0, 0, 32, 32, 0, -4, 0);
  glMock.gpu.drawLight3D(10, 20, 0, 0, '#ffaa00', 0.5);
  const qStats = glMock.gpu.getQuad3DStats();
  assert.equal(qStats.opaqueCount, 0, 'Negative wallH box must be skipped');
  assert.equal(glMock.gpu.flush(0).lightCount, 0, 'NaN/zero-radius lights must be ignored');

  // 2. SceneGpuBridge handles NaN viewport/camera/zoom and maxLife=0 particle without emitting NaN
  const bridge = new SceneGpuBridge();
  const rt = new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT);
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  snap.viewport = { width: Number.NaN, height: Number.NaN };
  snap.cameraX = Number.NaN;
  snap.cameraY = Number.NaN;
  snap.cameraZoom = -2;
  snap.particles = [{ x: 10, y: 10, vx: 0, vy: 0, size: 6, rot: 0, vRot: 0, color: '#ffffff', life: 0, maxLife: 0 }];
  snap.bossMaxHp = 100;
  snap.bossHp = 150;
  const stats = bridge.render(glMock.gpu, snap, null);
  assert.ok(Number.isFinite(stats.spriteCount) && stats.spriteCount > 0);
});

function evalShaderDdaShadowRef(
  fragX: number,
  fragY: number,
  lightX: number,
  lightY: number,
  strength: number,
  softness: number,
  isSolid: (cx: number, cy: number) => boolean,
): { vis: number; stepsTaken: number } {
  if (strength <= 0.01) return { vis: 1.0, stepsTaken: 0 };
  const dx = lightX - fragX;
  const dy = lightY - fragY;
  if (dx * dx + dy * dy < 0.0625) return { vis: 1.0, stepsTaken: 0 };
  const fragTileX = Math.floor(fragX);
  const fragTileY = Math.floor(fragY);
  const lightTileX = Math.floor(lightX);
  const lightTileY = Math.floor(lightY);
  if (Math.abs(fragTileX - lightTileX) < 0.5 && Math.abs(fragTileY - lightTileY) < 0.5) {
    return { vis: 1.0, stepsTaken: 0 };
  }
  const hasX = Math.abs(dx) > 1e-6;
  const hasY = Math.abs(dy) > 1e-6;
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const tDeltaX = hasX ? 1 / Math.max(Math.abs(dx), 1e-6) : 1e9;
  const tDeltaY = hasY ? 1 / Math.max(Math.abs(dy), 1e-6) : 1e9;
  let tMaxX = hasX
    ? (dx >= 0 ? fragTileX + 1 - fragX : fragX - fragTileX) * tDeltaX
    : 1e9;
  let tMaxY = hasY
    ? (dy >= 0 ? fragTileY + 1 - fragY : fragY - fragTileY) * tDeltaY
    : 1e9;
  const softSteps = Math.max(0.35, softness * 2.4);
  let curX = fragTileX;
  let curY = fragTileY;
  let hits = 0;
  let stepsTaken = 0;
  for (let s = 0; s < 32; s++) {
    stepsTaken++;
    let tHit = 0;
    if (tMaxX < tMaxY) {
      tHit = tMaxX;
      curX += stepX;
      tMaxX += tDeltaX;
    } else {
      tHit = tMaxY;
      curY += stepY;
      tMaxY += tDeltaY;
    }
    if (tHit >= 1.0) break;
    if (Math.abs(curX - lightTileX) < 0.5 && Math.abs(curY - lightTileY) < 0.5) break;
    if (isSolid(curX, curY)) {
      hits += 1.0;
      if (hits >= softSteps) break;
    }
  }
  const shadowAmt = Math.min(1, Math.max(0, hits / softSteps)) * strength;
  return { vis: 1.0 - shadowAmt, stepsTaken };
}

test('GPU backends enforce Pass 1B overlay light isolation, WebGL2 atlas reuse guard, and DoF sampler parity', () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(testDir, '../..');
  const webGpuBackendSrc = fs.readFileSync(path.join(rootDir, 'src/core/gpu/WebGpuBackend.ts'), 'utf8');
  const webGl2BackendSrc = fs.readFileSync(path.join(rootDir, 'src/core/gpu/WebGl2Backend.ts'), 'utf8');

  // WebGPU Pass 1B zero-light overlay bind group & cleanup
  assert.ok(webGpuBackendSrc.includes('overlayLightUniformBuffer'));
  assert.ok(webGpuBackendSrc.includes('pass1OverlayBindGroup'));
  assert.match(webGpuBackendSrc, /pass1b\.setBindGroup\s*\(\s*0\s*,\s*this\.pass1OverlayBindGroup\s*\)/);
  assert.doesNotMatch(webGpuBackendSrc, /pass1b\.setBindGroup\s*\(\s*0\s*,\s*this\.pass1BindGroup\s*\)/);
  assert.match(webGpuBackendSrc, /this\.overlayLightUniformBuffer\.destroy\(\)/);

  // WebGL2 Pass 1B zero-light parity
  assert.match(webGl2BackendSrc, /gl\.uniform1i\(this\.uLightCountLoc,\s*use3D\s*\?\s*0\s*:\s*safeLights\)/);

  // WebGL2 atlas reuse guard (texStorage3D + texSubImage3D, no unconditional texImage3D reallocation)
  assert.ok(webGl2BackendSrc.includes('atlasAllocW'));
  assert.ok(webGl2BackendSrc.includes('atlasAllocH'));
  assert.ok(webGl2BackendSrc.includes('atlasAllocLayers'));
  assert.match(webGl2BackendSrc, /gl\.texStorage3D\(/);
  assert.match(webGl2BackendSrc, /gl\.texSubImage3D\(/);
  assert.doesNotMatch(webGl2BackendSrc, /gl\.texImage3D\s*\(/);

  // WebGL2 DoF linear/nearest samplers & cleanup
  assert.ok(webGl2BackendSrc.includes('nearestSampler'));
  assert.ok(webGl2BackendSrc.includes('linearSampler'));
  assert.match(webGl2BackendSrc, /gl\.bindSampler\(0,\s*this\.nearestSampler\)/);
  assert.match(webGl2BackendSrc, /gl\.bindSampler\(2,\s*this\.linearSampler\)/);
  assert.match(webGl2BackendSrc, /gl\.deleteSampler\(this\.nearestSampler\)/);
  assert.match(webGl2BackendSrc, /gl\.deleteSampler\(this\.linearSampler\)/);
});

test('WGSL and GLSL shaders share F0/Schlick PBR, relief reuse, NaN-safe Quad3D lighting, DDA shadows, and CRT/Bayer Y-alignment', () => {
  // 1. Physically grounded F0 + Schlick Fresnel parity (no fake 0.95 / 1.15)
  for (const shaderSrc of [WGSL_CODE, SPRITE_FS, QUAD3D_FS]) {
    assert.doesNotMatch(shaderSrc, /mix\s*\(\s*vec3f?\s*\(\s*0\.95\s*\)/);
    assert.doesNotMatch(shaderSrc, /texRgb\s*\*\s*1\.15/);
    assert.match(shaderSrc, /mix\s*\(\s*vec3f?\s*\(\s*0\.04\s*\),\s*clamp\s*\(\s*texRgb/);
    assert.match(shaderSrc, /pow\s*\(\s*clamp\s*\(\s*1\.0\s*-\s*ndv,\s*0\.0,\s*1\.0\s*\),\s*5\.0\s*\)/);
  }

  // 2. No redundant center texel sC re-fetch in 2D relief pass
  assert.doesNotMatch(WGSL_CODE, /\bsC\b/);
  assert.doesNotMatch(SPRITE_FS, /\bsC\b/);

  // 3. Quad3D zero-distance light normalize guard
  assert.match(WGSL_CODE, /toL2\s*<\s*1e-6/);
  assert.match(QUAD3D_FS, /toL2\s*<\s*1e-6/);

  // 4. Bounded 32-step Amanatides-Woo DDA shadow traversal (no fixed 14-step march)
  for (const shaderSrc of [WGSL_CODE, SPRITE_FS, QUAD3D_FS]) {
    assert.doesNotMatch(shaderSrc, /s\s*<=\s*14/);
    assert.match(shaderSrc, /s\s*<\s*32/);
    assert.match(shaderSrc, /tDeltaX/);
    assert.match(shaderSrc, /tDeltaY/);
    assert.match(shaderSrc, /hits\s*>=\s*softSteps/);
  }

  // 5. DoF sampler, CRT scanline phase, and Bayer 4x4 Y-orientation parity
  assert.match(WGSL_POST_CODE, /textureSampleLevel\(uTexA,\s*uNearestSamp,\s*sampleUv/);
  assert.match(WGSL_POST_CODE, /textureSampleLevel\(uTexA,\s*uLinearSamp,\s*clamp\(sampleUv/);
  assert.match(COMPOSITE_FS, /texture\(uSceneTex,\s*sampleUv\)/);
  assert.match(COMPOSITE_FS, /texture\(uSceneLinearTex,\s*clamp\(sampleUv/);
  assert.match(COMPOSITE_FS, /sin\(screenY\s*\*\s*viewSize\.y\s*\*\s*6\.28318\)/);
  assert.match(COMPOSITE_FS, /uOutputSize\.y\s*-\s*gl_FragCoord\.y/);

  // 6. Algorithmic DDA checks (>15 tile anti-tunneling, corner-pinch blocking, early exit, light-cell exemption)
  const wallAt12 = (cx: number, cy: number) => cx === 12 && cy === 1;
  const longRange = evalShaderDdaShadowRef(1.5, 1.5, 23.5, 1.5, 0.9, 0.36, wallAt12);
  assert.ok(longRange.vis < 0.15, `Long 22-tile ray must not tunnel through 1-tile wall (vis=${longRange.vis})`);
  assert.ok(longRange.stepsTaken < 32, `DDA must early-exit once hits >= softSteps (steps=${longRange.stepsTaken})`);

  const diagPinch = (cx: number, cy: number) => (cx === 1 && cy === 2) || (cx === 2 && cy === 1);
  const cornerHit = evalShaderDdaShadowRef(0.5, 0.5, 4.5, 4.5, 0.9, 0.36, diagPinch);
  assert.ok(cornerHit.vis < 0.15, `45-deg ray must be blocked by diagonal corner-pinch walls (vis=${cornerHit.vis})`);

  const wallTorch = (cx: number, cy: number) => cx === 5 && cy === 1;
  const torchClear = evalShaderDdaShadowRef(2.5, 1.5, 5.5, 1.5, 0.9, 0.36, wallTorch);
  assert.equal(torchClear.vis, 1.0, 'Light placed inside an occluder tile must not block itself');

  const clearLong = evalShaderDdaShadowRef(1.5, 1.5, 21.5, 1.5, 0.9, 0.36, () => false);
  assert.equal(clearLong.vis, 1.0, 'Clear 20-tile ray must return full visibility');
});

test('Cutscene subtitle/splash HUD emits Pass 1B overlays after 3D Pass 1A and GpuDynamicGlyphCache supports CJK safely', () => {
  const atlas = new TextureAtlas();
  const bridge = new SceneGpuBridge();
  const input = createEmptyInputState();

  // 1. Headless GpuDynamicGlyphCache must never throw without DOM and returns null gracefully
  const headlessCache = new GpuDynamicGlyphCache();
  assert.equal(headlessCache.resolve(0x9ed1, atlas), null);

  // 2. Mock rasterizer verifies CJK glyph caching, dirty flagging, and 256-entry LRU eviction
  const mockCache = new GpuDynamicGlyphCache((_cp, outRgba, size) => {
    for (let i = 0; i < size * size; i++) {
      outRgba[i * 4] = 255;
      outRgba[i * 4 + 1] = 255;
      outRgba[i * 4 + 2] = 255;
      outRgba[i * 4 + 3] = 255;
    }
    return true;
  });
  const entryA = mockCache.resolve('黑'.codePointAt(0)!, atlas);
  assert.ok(entryA && entryA.isWide && atlas.isDirty(), 'CJK codepoint must allocate dynamic glyph rect and dirty atlas');
  assert.equal(mockCache.resolve('黑'.codePointAt(0)!, atlas), entryA, 'Repeated codepoint lookup must hit cache');
  for (let i = 0; i < 260; i++) {
    mockCache.resolve(0x4e00 + i, atlas);
  }
  assert.equal(mockCache.getCachedCount(), 256, 'GpuDynamicGlyphCache must stay bounded at 256 glyphs');
  mockCache.dispose();

  // 3. PA-14 cutscene Shot 0 (subtitle) and Shot 1 (splashTitle/splashSubtitle) emit Pass 1B overlays AFTER 3D Pass 1A
  const rt = new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT);
  assert.ok(rt.playCutscene('citadel_gate_intro'));
  for (let f = 0; f < 20; f++) {
    rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  }
  const snapShot0 = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const subBoxes0 = (snapShot0.hudPrimitives ?? []).filter((p) => p.kind === 'box' && p.worldSpace === false);
  const subTexts0 = (snapShot0.hudPrimitives ?? []).filter((p) => p.kind === 'text' && p.worldSpace === false);
  assert.ok(subBoxes0.length >= 3, 'Shot 0 must emit 21:9 letterbox bars and subtitle backdrop plate');
  assert.ok(
    subTexts0.some((t) => (t.text ?? '').includes('CHRONICLE:')),
    'Shot 0 must emit typewriter subtitle text primitive',
  );

  // Advance into Shot 1 (durationSec of Shot 0 is 1.4s -> ~95 frames total)
  for (let f = 0; f < 85; f++) {
    rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  }
  const snapShot1 = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const hudTexts1 = (snapShot1.hudPrimitives ?? []).filter((p) => p.kind === 'text' && p.worldSpace === false);
  assert.ok(
    hudTexts1.some((t) => t.text === '黑曜魔王城') && hudTexts1.some((t) => t.text === 'OBSIDIAN CITADEL'),
    'Shot 1 must emit both splashTitle and splashSubtitle HUD primitives',
  );

  // Verify Pass 1A (3D quads) precedes Pass 1B (HUD rects & pixel text) and CJK text draws via injected cache
  const { gpu, frames } = attachMockGpu('webgpu', atlas);
  const drawEvents: string[] = [];
  const origDrawBox3D = gpu.drawBox3DWall.bind(gpu);
  const origDrawCuboid3D = gpu.drawCuboid3D.bind(gpu);
  const origDrawRect = gpu.drawRect.bind(gpu);
  const origDrawText = gpu.drawPixelText.bind(gpu);
  gpu.drawBox3DWall = (...args) => {
    drawEvents.push('3d_wall');
    return origDrawBox3D(...args);
  };
  gpu.drawCuboid3D = (...args) => {
    drawEvents.push('3d_wall');
    return origDrawCuboid3D(...args);
  };
  gpu.drawRect = (...args) => {
    drawEvents.push('2d_rect');
    return origDrawRect(...args);
  };
  gpu.drawPixelText = (text, ...rest) => {
    drawEvents.push(`text:${text}`);
    return origDrawText(text, ...rest);
  };
  (gpu as unknown as { dynamicGlyphCache: GpuDynamicGlyphCache }).dynamicGlyphCache = new GpuDynamicGlyphCache(
    (_cp, outRgba, size) => {
      outRgba.fill(255, 0, size * size * 4);
      return true;
    },
  );

  bridge.render(gpu, snapShot1, null);
  assert.equal(frames.length, 1);
  assert.ok(frames[0].quad3d?.enabled && frames[0].quad3d.opaqueCount > 0, 'Pass 1A 3D scene must be populated');
  assert.ok(frames[0].alphaCount > 0, 'Pass 1B overlay alpha batch must be non-empty');

  const last3dIdx = drawEvents.lastIndexOf('3d_wall');
  const titleIdx = drawEvents.indexOf('text:黑曜魔王城');
  const subIdx = drawEvents.indexOf('text:OBSIDIAN CITADEL');
  assert.ok(last3dIdx >= 0 && titleIdx > last3dIdx && subIdx > last3dIdx, 'Pass 1B splash text must be queued after Pass 1A 3D walls');
});

test('SceneTrue3DPass forwards tile PBR (roughness/metallic/emissive) and separates wall top/side sprites via EcsTileDef.sideSprite', () => {
  const atlas = new TextureAtlas();
  const bridge = new SceneGpuBridge();
  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const res = session.dispatch({
    type: 'upsert_tile_def',
    tileDef: {
      id: 10,
      name: '雙面神殿高牆',
      layer: 'wall',
      sprite: 'castle_wall_top',
      sideSprite: 'castle_wall_brick',
      solid: true,
      extrudeH: 30,
      wallMaterial: 'stone',
      roughness: 0.21,
      metallic: 0.77,
      emissive: 0.44,
    },
  });
  assert.equal(res.ok, true);

  const floorRes = session.dispatch({
    type: 'upsert_tile_def',
    tileDef: {
      id: 1,
      name: '鏡面石板地',
      layer: 'ground',
      sprite: 'castle_floor_stone',
      solid: false,
      roughness: 0.19,
      metallic: 0.65,
      emissive: 0.12,
    },
  });
  assert.equal(floorRes.ok, true);

  const rt = new EcsCartridgeRuntime(session.getProject());
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);

  const { gpu } = attachMockGpu('webgpu', atlas);
  const wallCalls: Array<{ topId: string; sideId: string | null; roughness: number; metallic: number; emissive: number }> = [];
  const cuboidCalls: Array<{ topId: string | null; sideId: string | null; roughness: number; metallic: number; emissive: number }> = [];
  const floorCalls: Array<{ id: string; roughness: number; metallic: number; emissive: number }> = [];
  const origWall = gpu.drawBox3DWall.bind(gpu);
  const origCuboid = gpu.drawCuboid3D.bind(gpu);
  const origFloor = gpu.drawFloorTile3D.bind(gpu);
  gpu.drawBox3DWall = (topId, sideId, x, y, w, h, zBase, wallH, mask, tint, wallTint, alpha, palRow, roughness, metallic, obl, emissive) => {
    wallCalls.push({
      topId,
      sideId,
      roughness: roughness ?? -1,
      metallic: metallic ?? -1,
      emissive: emissive ?? 0,
    });
    return origWall(topId, sideId, x, y, w, h, zBase, wallH, mask, tint, wallTint, alpha, palRow, roughness, metallic, obl, emissive);
  };
  gpu.drawCuboid3D = (topId, sideId, botId, x, y, z, sx, sy, sz, cullMask, tint, alpha, palRow, roughness, metallic, emissive, yawDeg) => {
    cuboidCalls.push({
      topId,
      sideId,
      roughness: roughness ?? -1,
      metallic: metallic ?? -1,
      emissive: emissive ?? 0,
    });
    return origCuboid(topId, sideId, botId, x, y, z, sx, sy, sz, cullMask, tint, alpha, palRow, roughness, metallic, emissive, yawDeg);
  };
  gpu.drawFloorTile3D = (id, x, y, w, h, z, tint, alpha, palRow, shade, roughness, metallic, emissive) => {
    floorCalls.push({
      id,
      roughness: roughness ?? -1,
      metallic: metallic ?? -1,
      emissive: emissive ?? 0,
    });
    return origFloor(id, x, y, w, h, z, tint, alpha, palRow, shade, roughness, metallic, emissive);
  };

  // 1. Multi-story voxel room (courtyard) forwards distinct topId/sideSprite + PBR via Mesh3D drawCuboid3D
  bridge.render(gpu, snap, null);
  const splitVoxelWall = cuboidCalls.find((c) => c.topId === 'castle_wall_top' && c.sideId === 'castle_wall_brick');
  assert.ok(splitVoxelWall, 'hd2d_3d voxel wall must pass distinct topId and sideSprite to drawCuboid3D');
  assert.ok(Math.abs(splitVoxelWall.roughness - 0.21) < 1e-6);
  assert.ok(Math.abs(splitVoxelWall.metallic - 0.77) < 1e-6);
  assert.ok(Math.abs(splitVoxelWall.emissive - 0.44) < 1e-6);

  // 2. Classic 2D-wall room (grand_hall) forwards distinct topId/sideSprite + PBR via Quad3D drawBox3DWall
  assert.equal(rt.switchRoomForEditor('grand_hall'), true);
  const hallSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  bridge.render(gpu, hallSnap, null);
  const splitWall = wallCalls.find((c) => c.topId === 'castle_wall_top' && c.sideId === 'castle_wall_brick');
  assert.ok(splitWall, 'hd2d_3d wall must pass distinct topId and sideSprite to drawBox3DWall');
  assert.ok(Math.abs(splitWall.roughness - 0.21) < 1e-6);
  assert.ok(Math.abs(splitWall.metallic - 0.77) < 1e-6);
  assert.ok(Math.abs(splitWall.emissive - 0.44) < 1e-6);

  const pbrFloor = floorCalls.find((c) => c.id === 'castle_floor_stone');
  assert.ok(pbrFloor, 'hd2d_3d floor must render');
  assert.ok(Math.abs(pbrFloor.roughness - 0.19) < 1e-6);
  assert.ok(Math.abs(pbrFloor.metallic - 0.65) < 1e-6);
  assert.ok(Math.abs(pbrFloor.emissive - 0.12) < 1e-6);
});

test('Pass 1B renders 160x192 dialogue portraits above subtitle box via portraitSpriteId', () => {
  const atlas = new TextureAtlas();
  const bridge = new SceneGpuBridge();
  const input = createEmptyInputState();
  const session = new EcsStudioSession(cloneEcsProject(OBSIDIAN_CITADEL_PROJECT));
  const vnPack = buildBuiltinStarterPack('visual_novel');
  const cmds = buildAssetPackInstallCommands(vnPack, session.getProject(), { applyAtmosphere: true });
  const installRes = session.dispatchBatch(cmds, 'Install VN pack');
  assert.equal(installRes.ok, true);

  const proj = session.getProject();
  assert.ok(proj.customSprites?.vn_portrait_protagonist);
  assert.ok(proj.cutscenes?.some((c) => c.id === 'vn_parlor_prologue'));

  const rt = new EcsCartridgeRuntime(proj);
  assert.ok(rt.playCutscene('vn_parlor_prologue'));
  for (let f = 0; f < 10; f++) {
    rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  }
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const portraitPrim = (snap.hudPrimitives ?? []).find(
    (p) => p.kind === 'sprite' && p.sprite === 'vn_portrait_protagonist',
  );
  assert.ok(portraitPrim, 'Cutscene snapshot must emit Pass 1B sprite primitive for portraitSpriteId');
  assert.ok(portraitPrim.h >= 48 && portraitPrim.w >= 40);

  // Sync custom portrait into atlas and verify GpuEngine receives drawSpriteRaw with paletteRow=-2
  const { gpu } = attachMockGpu('webgpu', atlas);
  syncProjectCustomSpritesToAtlas(atlas, proj);
  const spriteDrawCalls: Array<{ id: string; paletteRow: number; y: number }> = [];
  const origDrawRaw = gpu.drawSpriteRaw.bind(gpu);
  gpu.drawSpriteRaw = (id, x, y, w, h, flipX, rot, tint, alpha, flash, add, px, py, skewX, palRow, em, r, m) => {
    spriteDrawCalls.push({ id, paletteRow: palRow ?? 0, y });
    return origDrawRaw(id, x, y, w, h, flipX, rot, tint, alpha, flash, add, px, py, skewX, palRow, em, r, m);
  };
  (gpu as unknown as { dynamicGlyphCache: GpuDynamicGlyphCache }).dynamicGlyphCache = new GpuDynamicGlyphCache(
    (_cp, outRgba, size) => {
      outRgba.fill(255, 0, size * size * 4);
      return true;
    },
  );

  bridge.render(gpu, snap, null);
  const drawnPortrait = spriteDrawCalls.find((c) => c.id === 'vn_portrait_protagonist');
  assert.ok(drawnPortrait, 'SceneHudOverlayPass must draw the portrait sprite onto Pass 1B');
  assert.equal(drawnPortrait.paletteRow, -2, 'Portrait HUD sprite must use paletteRow=-2 to bypass world lighting');
});


