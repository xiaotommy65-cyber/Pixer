import assert from 'node:assert/strict';
import test from 'node:test';
import { TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { GpuEngine } from '../../src/core/gpu/GpuEngine.ts';
import {
  FACE_CULL_BOT,
  FACE_CULL_NORTH,
  FACE_CULL_TOP,
} from '../../src/core/gpu/GpuMesh3DBatch.ts';
import {
  FLOATS_PER_MESH3D_VERTEX,
  type GpuOcclusionState,
  type IGpuBackend,
  type Mesh3DPassData,
  type Quad3DPassData,
  type SkyGradient,
} from '../../src/core/gpu/GpuTypes.ts';
import {
  MESH3D_FS,
  MESH3D_VS,
  QUAD3D_FS,
  SHADOW_MESH3D_VS,
  SHADOW_QUAD3D_FS,
  SHADOW_QUAD3D_VS,
} from '../../src/core/gpu/WebGl2Shaders.ts';
import { WGSL_CODE } from '../../src/core/gpu/WebGpuShaders.ts';
import {
  buildCamera3DViewProjMatrix,
  buildDirectionalLightViewProjMatrix,
  computeCamera3D,
  convertGlbYUpToPixerZUp,
  createComputedCamera3D,
  createWorldRay3D,
  projectWorld3DToScreen,
  screenToWorldPlaneAxis,
  screenToWorldRay3D,
  TRUE_ISOMETRIC_PITCH_DEG,
  type Camera3DProjectionMode,
  type ScreenPoint3D,
} from '../../src/core/math/Perspective3DMath.ts';
import {
  CAMERA_SHOT_PRESETS,
  computeZUpLookAtMatrix,
  convertCameraPoseYUpToZUp,
  type CameraPose,
} from '../../src/core/runtime/CameraRigDirector.ts';
import { SceneGpuBridge } from '../../src/core/runtime/SceneGpuBridge.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

interface Captured3DFrame {
  quad3d?: Quad3DPassData;
  mesh3d?: Mesh3DPassData;
  lightCount: number;
}

function attachCaptureGpu(kind: 'webgpu' | 'webgl2' | 'canvas2d', atlas: TextureAtlas): {
  gpu: GpuEngine;
  frames: Captured3DFrame[];
} {
  const frames: Captured3DFrame[] = [];
  const fakeCanvas = { width: 640, height: 360 } as unknown as HTMLCanvasElement;
  const gpu = new GpuEngine(fakeCanvas, undefined, atlas);
  const backend: IGpuBackend = {
    kind,
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
      lightCount = 0,
      _occ?: GpuOcclusionState,
      quad3d?: Quad3DPassData,
      mesh3d?: Mesh3DPassData,
    ) => {
      frames.push({
        lightCount,
        quad3d: quad3d
          ? {
              ...quad3d,
              camera: { ...quad3d.camera },
            }
          : undefined,
        mesh3d: mesh3d
          ? {
              ...mesh3d,
              opaqueVertices: new Float32Array(mesh3d.opaqueVertices.subarray(0, mesh3d.opaqueVertexCount * FLOATS_PER_MESH3D_VERTEX)),
              opaqueIndices: new Uint32Array(mesh3d.opaqueIndices.subarray(0, mesh3d.opaqueIndexCount)),
              lightPosZ: mesh3d.lightPosZ ? new Float32Array(mesh3d.lightPosZ) : undefined,
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

test('Phase A1: Unified Z-Up 6DoF camera basis stays strictly orthonormal across full 360° Yaw/Pitch/Roll', () => {
  const cam = createComputedCamera3D();
  const pt: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  const planeOut: [number, number, number] = [0, 0, 0];

  const poses = [
    { yawDeg: 0, pitchDeg: 42, rollDeg: 0, camCenterZ: 0 },
    { yawDeg: 90, pitchDeg: 35, rollDeg: 15, camCenterZ: 32 },
    { yawDeg: 180, pitchDeg: 55, rollDeg: -22, camCenterZ: 64 },
    { yawDeg: 270, pitchDeg: 25, rollDeg: 45, camCenterZ: 16 },
    { yawDeg: 135, pitchDeg: -20, rollDeg: 0, camCenterZ: 48 },
    { yawDeg: 37, pitchDeg: 85, rollDeg: -10, camCenterZ: 12 },
  ];

  for (const p of poses) {
    computeCamera3D(
      {
        camCenterX: 320,
        camCenterY: 224,
        camCenterZ: p.camCenterZ,
        zoom: 1.25,
        viewW: 640,
        viewH: 360,
        yawDeg: p.yawDeg,
        pitchDeg: p.pitchDeg,
        rollDeg: p.rollDeg,
        fovDeg: 40,
        projection: 'perspective',
      },
      cam,
    );

    const lenR = Math.hypot(cam.rx, cam.ry, cam.rz);
    const lenU = Math.hypot(cam.ux, cam.uy, cam.uz);
    const lenF = Math.hypot(cam.fx, cam.fy, cam.fz);
    const dotRU = cam.rx * cam.ux + cam.ry * cam.uy + cam.rz * cam.uz;
    const dotRF = cam.rx * cam.fx + cam.ry * cam.fy + cam.rz * cam.fz;
    const dotUF = cam.ux * cam.fx + cam.uy * cam.fy + cam.uz * cam.fz;

    assert.ok(Math.abs(lenR - 1) < 1e-6, `Right basis not unit: ${lenR}`);
    assert.ok(Math.abs(lenU - 1) < 1e-6, `Up basis not unit: ${lenU}`);
    assert.ok(Math.abs(lenF - 1) < 1e-6, `Forward basis not unit: ${lenF}`);
    assert.ok(Math.abs(dotRU) < 1e-6, `R·U not zero: ${dotRU}`);
    assert.ok(Math.abs(dotRF) < 1e-6, `R·F not zero: ${dotRF}`);
    assert.ok(Math.abs(dotUF) < 1e-6, `U·F not zero: ${dotUF}`);

    // Camera target (camCenterX, camCenterY, camCenterZ) must map to exact viewport center
    projectWorld3DToScreen(320, 224, p.camCenterZ, cam, pt);
    assert.ok(pt.visible);
    assert.ok(Math.abs(pt.x - 320) < 1e-3);
    assert.ok(Math.abs(pt.y - 180) < 1e-3);

    // Project a point offset from target and recover exact coordinates via ray-plane intersection
    const testX = 320 + 48;
    const testY = 224 - 36;
    const testZ = p.camCenterZ + 24;
    projectWorld3DToScreen(testX, testY, testZ, cam, pt);
    assert.ok(pt.visible);
    assert.ok(screenToWorldPlaneAxis(pt.x, pt.y, cam, 'z', testZ, planeOut));
    assert.ok(Math.abs(planeOut[0] - testX) < 0.02);
    assert.ok(Math.abs(planeOut[1] - testY) < 0.02);
    assert.ok(Math.abs(planeOut[2] - testZ) < 1e-4);

    // WebGPU [0,1] and WebGL2 [-1,1] ViewProj matrices must match projectWorld3DToScreen
    const vpGpu = buildCamera3DViewProjMatrix(cam, true, new Float32Array(16));
    const vpGl = buildCamera3DViewProjMatrix(cam, false, new Float32Array(16));
    const evalVp = (m: Float32Array) => {
      const cx = m[0] * testX + m[4] * testY + m[8] * testZ + m[12];
      const cy = m[1] * testX + m[5] * testY + m[9] * testZ + m[13];
      const cz = m[2] * testX + m[6] * testY + m[10] * testZ + m[14];
      const cw = m[3] * testX + m[7] * testY + m[11] * testZ + m[15];
      return { ndcX: cx / cw, ndcY: cy / cw, ndcZ: cz / cw };
    };
    const rGpu = evalVp(vpGpu);
    const rGl = evalVp(vpGl);
    assert.ok(Math.abs((rGpu.ndcX * 0.5 + 0.5) * 640 - pt.x) < 1e-2);
    assert.ok(Math.abs((0.5 - rGpu.ndcY * 0.5) * 360 - pt.y) < 1e-2);
    assert.ok(rGpu.ndcZ >= 0 && rGpu.ndcZ <= 1);
    assert.ok(rGl.ndcZ >= -1 && rGl.ndcZ <= 1);
  }
});

test('Phase A1: Exact Tri-View Orthographic projections (Top XY, Front XZ, Side YZ, True Isometric) & Ray Picking', () => {
  const cam = createComputedCamera3D();
  const ptA: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  const ptB: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  const ptC: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  const hit: [number, number, number] = [0, 0, 0];
  const ray = createWorldRay3D();

  // 1. Top XY Plan View: +X goes Right, +Y goes Down, +Z is closer (smaller depth)
  computeCamera3D(
    { camCenterX: 100, camCenterY: 200, camCenterZ: 0, zoom: 2, viewW: 640, viewH: 360, pitchDeg: 0, fovDeg: 38, projection: 'ortho_top' },
    cam,
  );
  assert.equal(cam.isOrtho, true);
  projectWorld3DToScreen(100, 200, 0, cam, ptA);
  projectWorld3DToScreen(110, 220, 0, cam, ptB);
  projectWorld3DToScreen(100, 200, 32, cam, ptC);
  assert.ok(Math.abs(ptA.x - 320) < 1e-4 && Math.abs(ptA.y - 180) < 1e-4);
  assert.ok(Math.abs(ptB.x - 340) < 1e-4 && Math.abs(ptB.y - 220) < 1e-4, 'Zoom=2 Top XY: +10X -> +20px, +20Y -> +40px');
  assert.ok(Math.abs(ptC.x - 320) < 1e-4 && Math.abs(ptC.y - 180) < 1e-4, 'Ortho Top has zero perspective shift along Z');
  assert.ok(ptC.depth < ptA.depth, 'Higher +Z point must be closer in Top XY view');
  assert.ok(screenToWorldPlaneAxis(ptB.x, ptB.y, cam, 'z', 32, hit));
  assert.ok(Math.abs(hit[0] - 110) < 1e-3 && Math.abs(hit[1] - 220) < 1e-3 && Math.abs(hit[2] - 32) < 1e-3);

  // 2. Front XZ Elevation View: +X goes Right, +Z goes Up on screen (smaller screenY)
  computeCamera3D(
    { camCenterX: 100, camCenterY: 200, camCenterZ: 32, zoom: 1, viewW: 640, viewH: 360, pitchDeg: 0, fovDeg: 38, projection: 'ortho_front' },
    cam,
  );
  projectWorld3DToScreen(100, 200, 32, cam, ptA);
  projectWorld3DToScreen(125, 200, 62, cam, ptB);
  assert.ok(Math.abs(ptB.x - (ptA.x + 25)) < 1e-3, 'Front XZ: +25X -> +25px right');
  assert.ok(Math.abs(ptB.y - (ptA.y - 30)) < 1e-3, 'Front XZ: +30Z -> -30px up');
  assert.ok(screenToWorldPlaneAxis(ptB.x, ptB.y, cam, 'y', 200, hit));
  assert.ok(Math.abs(hit[0] - 125) < 1e-3 && Math.abs(hit[2] - 62) < 1e-3);

  // 3. Side YZ Elevation View: +Y goes Right, +Z goes Up on screen
  computeCamera3D(
    { camCenterX: 100, camCenterY: 200, camCenterZ: 32, zoom: 1, viewW: 640, viewH: 360, pitchDeg: 0, fovDeg: 38, projection: 'ortho_side' },
    cam,
  );
  projectWorld3DToScreen(100, 200, 32, cam, ptA);
  projectWorld3DToScreen(100, 240, 52, cam, ptB);
  assert.ok(Math.abs(ptB.x - (ptA.x + 40)) < 1e-3, 'Side YZ: +40Y -> +40px right');
  assert.ok(Math.abs(ptB.y - (ptA.y - 20)) < 1e-3, 'Side YZ: +20Z -> -20px up');
  assert.ok(screenToWorldPlaneAxis(ptB.x, ptB.y, cam, 'x', 100, hit));
  assert.ok(Math.abs(hit[1] - 240) < 1e-3 && Math.abs(hit[2] - 52) < 1e-3);

  // 4. True Axonometric Isometric View: unit X, Y, Z axes project to identical screen length!
  computeCamera3D(
    { camCenterX: 0, camCenterY: 0, camCenterZ: 0, zoom: 1, viewW: 640, viewH: 360, pitchDeg: TRUE_ISOMETRIC_PITCH_DEG, fovDeg: 38, projection: 'ortho_iso' },
    cam,
  );
  const pO: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  const pX: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  const pY: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  const pZ: ScreenPoint3D = { x: 0, y: 0, scale: 1, depth: 0, visible: false };
  projectWorld3DToScreen(0, 0, 0, cam, pO);
  projectWorld3DToScreen(100, 0, 0, cam, pX);
  projectWorld3DToScreen(0, 100, 0, cam, pY);
  projectWorld3DToScreen(0, 0, 100, cam, pZ);
  const lenX = Math.hypot(pX.x - pO.x, pX.y - pO.y);
  const lenY = Math.hypot(pY.x - pO.x, pY.y - pO.y);
  const lenZ = Math.hypot(pZ.x - pO.x, pZ.y - pO.y);
  assert.ok(Math.abs(lenX - lenY) < 1e-3 && Math.abs(lenY - lenZ) < 1e-3, `True isometric axes must have equal screen length: X=${lenX}, Y=${lenY}, Z=${lenZ}`);

  // Ortho ray directions must be parallel to camera forward across all modes
  const modes: Camera3DProjectionMode[] = ['ortho_top', 'ortho_front', 'ortho_side', 'ortho_iso', 'ortho_free'];
  for (const mode of modes) {
    computeCamera3D(
      { camCenterX: 50, camCenterY: 50, zoom: 1, viewW: 640, viewH: 360, pitchDeg: 30, yawDeg: 60, fovDeg: 38, projection: mode },
      cam,
    );
    screenToWorldRay3D(120, 90, cam, ray);
    assert.ok(Math.abs(ray.dirX - cam.fx) < 1e-6 && Math.abs(ray.dirY - cam.fy) < 1e-6 && Math.abs(ray.dirZ - cam.fz) < 1e-6);
  }
});

test('Phase A1: Directional Shadow LightViewProj, glTF Y-Up->Z-Up conversion, and Z-Up LookAt matrix', () => {
  const lvpGpu = buildDirectionalLightViewProjMatrix(320, 240, 0, -0.38, 0.48, 0.79, 400, 1600, 1024, true, new Float32Array(16));
  const lvpGl = buildDirectionalLightViewProjMatrix(320, 240, 0, -0.38, 0.48, 0.79, 400, 1600, 1024, false, new Float32Array(16));

  // Target center must lie strictly inside both WebGPU [0,1] and WebGL2 [-1,1] light clip bounds
  const evalPt = (m: Float32Array, x: number, y: number, z: number) => ({
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
    w: m[3] * x + m[7] * y + m[11] * z + m[15],
  });
  const cGpu = evalPt(lvpGpu, 320, 240, 16);
  const cGl = evalPt(lvpGl, 320, 240, 16);
  assert.equal(cGpu.w, 1);
  assert.equal(cGl.w, 1);
  assert.ok(Math.abs(cGpu.x) < 0.05 && Math.abs(cGpu.y) < 0.05);
  assert.ok(cGpu.z > 0.1 && cGpu.z < 0.9, `WebGPU light Z must be inside (0,1), got ${cGpu.z}`);
  assert.ok(cGl.z > -0.9 && cGl.z < 0.9, `WebGL2 light Z must be inside (-1,1), got ${cGl.z}`);

  // Higher +Z point must have SMALLER light depth (closer to overhead sun!)
  const topGpu = evalPt(lvpGpu, 320, 240, 64);
  assert.ok(topGpu.z < cGpu.z, 'Higher elevation point must be closer to directional sun');

  // glTF Y-Up -> Pixer Z-Up
  const zup: [number, number, number] = [0, 0, 0];
  convertGlbYUpToPixerZUp(10, 24, -8, zup);
  assert.deepEqual(zup, [10, -8, 24]);

  // CameraRigDirector Y-Up -> Z-Up helper + Z-Up LookAt orthonormality
  const poseOut: CameraPose = { ...CAMERA_SHOT_PRESETS.TITLE_ORBIT };
  convertCameraPoseYUpToZUp(CAMERA_SHOT_PRESETS.TITLE_ORBIT, poseOut);
  assert.equal(poseOut.posZ, CAMERA_SHOT_PRESETS.TITLE_ORBIT.posY);
  assert.equal(poseOut.posY, CAMERA_SHOT_PRESETS.TITLE_ORBIT.posZ);

  const lookMat = computeZUpLookAtMatrix(new Float32Array(16), 0, 100, 80, 0, 0, 0, 0);
  // Check orthonormal 3x3 rotation block
  const rLen = Math.hypot(lookMat[0], lookMat[4], lookMat[8]);
  const uLen = Math.hypot(lookMat[1], lookMat[5], lookMat[9]);
  const fLen = Math.hypot(lookMat[2], lookMat[6], lookMat[10]);
  assert.ok(Math.abs(rLen - 1) < 1e-5 && Math.abs(uLen - 1) < 1e-5 && Math.abs(fLen - 1) < 1e-5);
});

test('Phase A2: GpuMesh3DBatch & GpuEngine emit indexed Cuboids, Ramps, Stairs, Gizmos, and 3D Point Light Z', () => {
  const atlas = new TextureAtlas();
  const { gpu, frames } = attachCaptureGpu('webgpu', atlas);

  gpu.beginFrame('#141226', '#282040');
  gpu.setCamera3D(160, 120, 1, 35, 38, 0, 0, 32, 45, 0, 16, 'ortho_iso');
  gpu.setSunLight3D(-0.5, 0.4, 0.8, true, 0.52);
  gpu.pushDynamicLight3D(160, 120, 48, 128, '#ff9944', 1.4, 2.0);

  // Full 6-face cuboid -> 6 faces * 4 verts = 24 verts, 12 triangles (36 indices)
  gpu.drawCuboid3D('stone', 'brick', 'stone', 0, 0, 0, 32, 32, 32, 0);
  const s1 = gpu.getMesh3DStats();
  assert.equal(s1.opaqueVertices, 24);
  assert.equal(s1.opaqueTriangles, 12);

  // Neighbor-culled cuboid (3 faces culled: Top, Bot, North) -> +12 verts, +6 triangles
  gpu.drawCuboid3D('stone', 'brick', 'stone', 32, 0, 0, 32, 32, 32, FACE_CULL_TOP | FACE_CULL_BOT | FACE_CULL_NORTH);
  const s2 = gpu.getMesh3DStats();
  assert.equal(s2.opaqueVertices, 36);
  assert.equal(s2.opaqueTriangles, 18);

  // True 3D sloped ramp (facing north: +1 sloped quad + 1 back quad + 2 cheek tris = 6 triangles)
  gpu.drawRamp3D('stone', 'brick', 64, 0, 0, 32, 32, 32, 'n');
  const s3 = gpu.getMesh3DStats();
  assert.equal(s3.opaqueTriangles, 24);

  // 4-step 3D stairs (4 cuboids with FACE_CULL_BOT -> 4 * 10 = 40 triangles)
  gpu.drawStairs3D('stone', 'brick', 96, 0, 0, 32, 32, 32, 'e', 4);
  const s4 = gpu.getMesh3DStats();
  assert.equal(s4.opaqueTriangles, 64);

  // Arbitrary indexed triangle mesh
  gpu.pushMesh3DIndexed(
    [0, 0, 0, 16, 0, 0, 8, 16, 24],
    [0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 0, 1, 0, 0.5, 1],
    [0, 1, 2],
    { tint: '#38bdf8', offsetX: 128, offsetY: 0, offsetZ: 32, yawDeg: 90 },
  );
  assert.equal(gpu.getMesh3DStats().opaqueTriangles, 65);

  // Axis Gizmo (9 segments) + 2x2 Ortho Grid (6 segments)
  gpu.drawAxisGizmo3D(160, 120, 16, 48);
  gpu.drawOrthoGrid3D(0, 0, 64, 64, 0, 32, 2);
  assert.equal(gpu.getMesh3DStats().lineSegments, 15);

  gpu.flush(0.5);
  assert.equal(frames.length, 1);
  const f = frames[0];
  assert.equal(f.quad3d?.camera.projection, 'ortho_iso');
  assert.equal(f.quad3d?.camera.yawDeg, 45);
  assert.equal(f.quad3d?.camera.camCenterZ, 16);
  assert.equal(f.quad3d?.camera.shadowMapEnabled, true);
  assert.ok(Math.abs((f.quad3d?.camera.shadowStrength ?? 0) - 0.52) < 1e-5);
  assert.equal(f.mesh3d?.opaqueIndexCount, 65 * 3);
  assert.equal(f.mesh3d?.lineVertexCount, 30);
  assert.equal(f.mesh3d?.lightPosZ?.[0], 48, '3D point light Z coordinate must propagate to Mesh3DPassData');

  // Verify ramp sloped top face vertex normal is analytically tilted (ny = +sin45, nz = +cos45)
  const rampVertBase = 36 * FLOATS_PER_MESH3D_VERTEX;
  const rnx = f.mesh3d!.opaqueVertices[rampVertBase + 4];
  const rny = f.mesh3d!.opaqueVertices[rampVertBase + 5];
  const rnz = f.mesh3d!.opaqueVertices[rampVertBase + 6];
  assert.ok(Math.abs(rnx) < 1e-4);
  assert.ok(Math.abs(rny - Math.SQRT1_2) < 1e-4, `North ramp slope normal Y should be +sqrt(0.5), got ${rny}`);
  assert.ok(Math.abs(rnz - Math.SQRT1_2) < 1e-4, `North ramp slope normal Z should be +sqrt(0.5), got ${rnz}`);
});

test('Phase A2: WebGPU WGSL & WebGL2 GLSL ES 3.00 3D Mesh + Directional Shadow Map shader parity', () => {
  // WebGPU WGSL contracts
  assert.ok(WGSL_CODE.includes('fn vsShadowMesh3D'), 'WGSL must define vsShadowMesh3D');
  assert.ok(WGSL_CODE.includes('fn vsShadowQuad3D'), 'WGSL must define vsShadowQuad3D');
  assert.ok(WGSL_CODE.includes('fn fsShadowQuad3D'), 'WGSL must define fsShadowQuad3D');
  assert.ok(WGSL_CODE.includes('fn vsMesh3D'), 'WGSL must define vsMesh3D');
  assert.ok(WGSL_CODE.includes('fn fsMesh3D'), 'WGSL must define fsMesh3D');
  assert.ok(WGSL_CODE.includes('fn sampleDirectionalShadow3D'), 'WGSL must define sampleDirectionalShadow3D');
  assert.ok(WGSL_CODE.includes('textureSampleCompareLevel'), 'WGSL must use textureSampleCompareLevel for control-flow-safe PCF');
  assert.ok(WGSL_CODE.includes('fn getLightZ3D'), 'WGSL must support 3D point light Z lookup');

  // WebGL2 GLSL ES 3.00 contracts
  assert.ok(SHADOW_MESH3D_VS.includes('uLightViewProj'), 'GLSL SHADOW_MESH3D_VS must use uLightViewProj');
  assert.ok(SHADOW_QUAD3D_VS.includes('uLightViewProj'), 'GLSL SHADOW_QUAD3D_VS must use uLightViewProj');
  assert.ok(SHADOW_QUAD3D_FS.includes('discard'), 'GLSL SHADOW_QUAD3D_FS must alpha-cutout billboards');
  assert.ok(MESH3D_VS.includes('aPosAo') && MESH3D_VS.includes('aMatFlash'), 'GLSL MESH3D_VS must declare 5 vec4 vertex attributes');
  assert.ok(MESH3D_FS.includes('precision highp sampler2DShadow;') && MESH3D_FS.includes('sampleDirectionalShadow3D'), 'GLSL MESH3D_FS must support hardware PCF shadow map');
  assert.ok(QUAD3D_FS.includes('precision highp sampler2DShadow;') && QUAD3D_FS.includes('sampleDirectionalShadow3D'), 'GLSL QUAD3D_FS must support hardware PCF shadow map');
  assert.ok(MESH3D_FS.includes('getLightZ3D') && QUAD3D_FS.includes('getLightZ3D'), 'GLSL 3D shaders must support true 3D point light Z');
});

test('Phase A2: SceneGpuBridge + SceneTrue3DPass forwards 6DoF/Ortho camera, shadow config, gizmo & grid cleanly', () => {
  const atlas = new TextureAtlas();
  const bridge = new SceneGpuBridge();
  const rt = new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT);
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);

  snap.hd2dDepth = {
    ...snap.hd2dDepth!,
    mode3d: true,
    yawDeg: 30,
    rollDeg: 4,
    camCenterZ: 12,
    cameraProjection3d: 'ortho_front',
    shadowMapEnabled: true,
    shadowMapStrength: 0.6,
    showAxisGizmo3d: true,
    showOrthoGrid3d: true,
  };
  if (snap.lights.length > 0) {
    snap.lights[0].z = 42;
  }

  const { gpu, frames } = attachCaptureGpu('webgl2', atlas);
  bridge.render(gpu, snap, null);
  assert.equal(frames.length, 1);
  const f = frames[0];
  assert.equal(f.quad3d?.camera.projection, 'ortho_front');
  assert.equal(f.quad3d?.camera.yawDeg, 30);
  assert.equal(f.quad3d?.camera.rollDeg, 4);
  assert.equal(f.quad3d?.camera.camCenterZ, 12);
  assert.ok(Math.abs((f.quad3d?.camera.shadowStrength ?? 0) - 0.6) < 1e-5);
  assert.ok((f.mesh3d?.lineVertexCount ?? 0) > 18, 'Axis gizmo + ortho grid must emit 3D line segments');
  if (snap.lights.length > 0) {
    assert.equal(f.mesh3d?.lightPosZ?.[0], 42);
  }
});
