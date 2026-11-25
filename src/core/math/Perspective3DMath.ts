/**
 * Pure DOM-free, Zero-GC 3D Perspective & Tri-View Orthographic Camera + Analytical Ray-Plane Math
 * for Pixer's Pixel-Sculpted 3D & HD-2D GPU Renderer.
 *
 * Canonical Pixer World Coordinate Convention (Unified Z-Up):
 * - +X: East  (screen right when yaw = 0°)
 * - +Y: South (screen down on ground plane when yaw = 0°)
 * - +Z: Up    (wall extrusion, multi-story elevation, actor height)
 *
 * Orthonormal Camera Basis (Zero Gimbal Singularity even at exact ±90° pitch):
 * - R0 = ( cosY,        sinY,       0    )  (Unrolled Camera Right)
 * - U0 = ( sinY * sinP,-cosY * sinP,cosP )  (Unrolled Camera Up)
 * - F  = ( sinY * cosP,-cosY * cosP,-sinP)  (Camera Forward toward target)
 * - Rolled around F by rollDeg: R = R0*cosR + U0*sinR, U = -R0*sinR + U0*cosR
 *
 * At yawDeg = 0, rollDeg = 0, camCenterZ = 0, projection = 'perspective',
 * every matrix entry and projection is bit-for-bit identical to legacy HD-2D cameras.
 */

export type Camera3DProjectionMode =
  | 'perspective'
  | 'ortho_top'
  | 'ortho_front'
  | 'ortho_side'
  | 'ortho_iso'
  | 'ortho_free';

export interface Perspective3DCameraParams {
  camCenterX: number;
  camCenterY: number;
  camCenterZ?: number;
  zoom: number;
  viewW: number;
  viewH: number;
  pitchDeg: number;
  yawDeg?: number;
  rollDeg?: number;
  fovDeg: number;
  projection?: Camera3DProjectionMode;
  near?: number;
  far?: number;
  orthoDistance?: number;
}

export interface ComputedCamera3D {
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  camCenterX: number;
  camCenterY: number;
  camCenterZ: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  projection: Camera3DProjectionMode;
  isOrtho: boolean;
  orthoHalfW: number;
  orthoHalfH: number;
  sinPitch: number;
  cosPitch: number;
  // Exact orthonormal camera basis vectors in world Z-Up space
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  fx: number;
  fy: number;
  fz: number;
  focal: number;
  aspect: number;
  near: number;
  far: number;
  distance: number;
  viewW: number;
  viewH: number;
}

export interface WorldRay3D {
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export const DEFAULT_HD2D_3D_PITCH_DEG = 42;
export const DEFAULT_HD2D_3D_FOV_DEG = 38;
export const DEFAULT_HD2D_3D_NEAR = 24;
export const DEFAULT_HD2D_3D_FAR = 2600;
export const TRUE_ISOMETRIC_PITCH_DEG = (Math.atan(Math.SQRT1_2) * 180) / Math.PI; // ~35.2643897°

const DEG_TO_RAD = Math.PI / 180;

export function createComputedCamera3D(): ComputedCamera3D {
  return {
    eyeX: 0,
    eyeY: 0,
    eyeZ: 0,
    camCenterX: 0,
    camCenterY: 0,
    camCenterZ: 0,
    yawDeg: 0,
    pitchDeg: DEFAULT_HD2D_3D_PITCH_DEG,
    rollDeg: 0,
    projection: 'perspective',
    isOrtho: false,
    orthoHalfW: 320,
    orthoHalfH: 180,
    sinPitch: 0.6691306,
    cosPitch: 0.7431448,
    rx: 1,
    ry: 0,
    rz: 0,
    ux: 0,
    uy: -0.6691306,
    uz: 0.7431448,
    fx: 0,
    fy: -0.7431448,
    fz: -0.6691306,
    focal: 2.9,
    aspect: 16 / 9,
    near: DEFAULT_HD2D_3D_NEAR,
    far: DEFAULT_HD2D_3D_FAR,
    distance: 520,
    viewW: 640,
    viewH: 360,
  };
}

export function createWorldRay3D(): WorldRay3D {
  return { originX: 0, originY: 0, originZ: 0, dirX: 0, dirY: -1, dirZ: 0 };
}

/**
 * Computes unified Z-Up 6DoF Perspective OR exact Tri-View Orthographic camera eye,
 * orthonormal basis (R, U, F), and projection constants into pre-allocated `out` (Zero-GC).
 */
export function computeCamera3D(params: Perspective3DCameraParams, out: ComputedCamera3D): ComputedCamera3D {
  const safeViewW = Math.max(1, params.viewW);
  const safeViewH = Math.max(1, params.viewH);
  const safeZoom = Math.max(0.15, Math.min(8, Number.isFinite(params.zoom) && params.zoom > 0 ? params.zoom : 1));
  const projection: Camera3DProjectionMode = params.projection ?? 'perspective';
  const isOrtho = projection !== 'perspective';

  let yawDeg = Number.isFinite(params.yawDeg) ? params.yawDeg! : 0;
  let pitchDeg = Number.isFinite(params.pitchDeg) ? params.pitchDeg : DEFAULT_HD2D_3D_PITCH_DEG;
  let rollDeg = Number.isFinite(params.rollDeg) ? params.rollDeg! : 0;

  if (projection === 'ortho_top') {
    yawDeg = 0;
    pitchDeg = 90;
    rollDeg = 0;
  } else if (projection === 'ortho_front') {
    yawDeg = 0;
    pitchDeg = 0;
    rollDeg = 0;
  } else if (projection === 'ortho_side') {
    yawDeg = 90;
    pitchDeg = 0;
    rollDeg = 0;
  } else if (projection === 'ortho_iso') {
    yawDeg = 45;
    pitchDeg = TRUE_ISOMETRIC_PITCH_DEG;
    rollDeg = 0;
  } else if (projection === 'ortho_free') {
    pitchDeg = Math.max(-90, Math.min(90, pitchDeg));
  } else {
    // Perspective mode: allow wide 3D orbit pitch while keeping horizon/zenith numerically crisp
    pitchDeg = Math.max(-85, Math.min(85, pitchDeg));
  }

  const fovClamped = Math.max(16, Math.min(85, Number.isFinite(params.fovDeg) && params.fovDeg > 0 ? params.fovDeg : DEFAULT_HD2D_3D_FOV_DEG));
  const yawRad = yawDeg * DEG_TO_RAD;
  const pitchRad = pitchDeg * DEG_TO_RAD;
  const rollRad = rollDeg * DEG_TO_RAD;
  const fovRad = fovClamped * DEG_TO_RAD;

  const sinYaw = Math.sin(yawRad);
  const cosYaw = Math.cos(yawRad);
  const sinPitch = Math.sin(pitchRad);
  const cosPitch = Math.cos(pitchRad);
  const sinRoll = Math.sin(rollRad);
  const cosRoll = Math.cos(rollRad);

  const focal = 1 / Math.tan(fovRad * 0.5);
  const aspect = safeViewW / safeViewH;

  // Distance calibrated so horizontal scale at target equals `safeZoom` screen px per world px
  const perspDistance = (safeViewH / (2 * safeZoom)) * focal;
  const distance = isOrtho
    ? Math.max(600, params.orthoDistance ?? Math.max(1200, perspDistance))
    : perspDistance;

  const near = isOrtho
    ? Math.max(1, params.near ?? 4)
    : Math.max(8, params.near ?? DEFAULT_HD2D_3D_NEAR);
  const far = Math.max(distance + (isOrtho ? distance + 1200 : 800), params.far ?? DEFAULT_HD2D_3D_FAR);

  const cx = Number.isFinite(params.camCenterX) ? params.camCenterX : 0;
  const cy = Number.isFinite(params.camCenterY) ? params.camCenterY : 0;
  const cz = Number.isFinite(params.camCenterZ) ? params.camCenterZ! : 0;

  // Orthonormal camera basis (zero gimbal lock at pitch = ±90°)
  const r0x = cosYaw;
  const r0y = sinYaw;
  const r0z = 0;

  const u0x = sinYaw * sinPitch;
  const u0y = -cosYaw * sinPitch;
  const u0z = cosPitch;

  const fx = sinYaw * cosPitch;
  const fy = -cosYaw * cosPitch;
  const fz = -sinPitch;

  const rx = r0x * cosRoll + u0x * sinRoll;
  const ry = r0y * cosRoll + u0y * sinRoll;
  const rz = r0z * cosRoll + u0z * sinRoll;

  const ux = -r0x * sinRoll + u0x * cosRoll;
  const uy = -r0y * sinRoll + u0y * cosRoll;
  const uz = -r0z * sinRoll + u0z * cosRoll;

  out.camCenterX = cx;
  out.camCenterY = cy;
  out.camCenterZ = cz;
  out.eyeX = cx - fx * distance;
  out.eyeY = cy - fy * distance;
  out.eyeZ = cz - fz * distance;
  out.yawDeg = yawDeg;
  out.pitchDeg = pitchDeg;
  out.rollDeg = rollDeg;
  out.projection = projection;
  out.isOrtho = isOrtho;
  out.orthoHalfW = safeViewW / (2 * safeZoom);
  out.orthoHalfH = safeViewH / (2 * safeZoom);
  out.sinPitch = sinPitch;
  out.cosPitch = cosPitch;
  out.rx = rx;
  out.ry = ry;
  out.rz = rz;
  out.ux = ux;
  out.uy = uy;
  out.uz = uz;
  out.fx = fx;
  out.fy = fy;
  out.fz = fz;
  out.focal = focal;
  out.aspect = aspect;
  out.near = near;
  out.far = far;
  out.distance = distance;
  out.viewW = safeViewW;
  out.viewH = safeViewH;
  return out;
}

/**
 * Builds a column-major 4×4 View-Projection matrix into `outMat` (`Float32Array(16)`).
 * Supports both Perspective and Exact Orthographic cameras.
 * - `depthZeroToOne = true`  -> WebGPU clip space Z in [0, 1]
 * - `depthZeroToOne = false` -> WebGL2 clip space Z in [-1, 1]
 */
export function buildCamera3DViewProjMatrix(
  cam: ComputedCamera3D,
  depthZeroToOne: boolean,
  outMat: Float32Array,
): Float32Array {
  const { rx, ry, rz, ux, uy, uz, fx, fy, fz, eyeX, eyeY, eyeZ, near, far } = cam;
  const invRange = 1 / Math.max(1e-3, far - near);

  const camX0 = -(rx * eyeX + ry * eyeY + rz * eyeZ);
  const camY0 = -(ux * eyeX + uy * eyeY + uz * eyeZ);
  const camD0 = -(fx * eyeX + fy * eyeY + fz * eyeZ);

  if (cam.isOrtho) {
    const invHW = 1 / Math.max(1e-3, cam.orthoHalfW);
    const invHH = 1 / Math.max(1e-3, cam.orthoHalfH);
    const zScale = depthZeroToOne ? invRange : 2 * invRange;
    const zBias = depthZeroToOne ? -near * invRange : -(far + near) * invRange;

    outMat[0] = invHW * rx;
    outMat[1] = invHH * ux;
    outMat[2] = zScale * fx;
    outMat[3] = 0;

    outMat[4] = invHW * ry;
    outMat[5] = invHH * uy;
    outMat[6] = zScale * fy;
    outMat[7] = 0;

    outMat[8] = invHW * rz;
    outMat[9] = invHH * uz;
    outMat[10] = zScale * fz;
    outMat[11] = 0;

    outMat[12] = invHW * camX0;
    outMat[13] = invHH * camY0;
    outMat[14] = zScale * camD0 + zBias;
    outMat[15] = 1;
    return outMat;
  }

  const sx = cam.focal / cam.aspect;
  const sy = cam.focal;
  const zA = depthZeroToOne ? far * invRange : (far + near) * invRange;
  const zB = depthZeroToOne ? -(near * far) * invRange : -(2 * near * far) * invRange;

  outMat[0] = sx * rx;
  outMat[1] = sy * ux;
  outMat[2] = zA * fx;
  outMat[3] = fx;

  outMat[4] = sx * ry;
  outMat[5] = sy * uy;
  outMat[6] = zA * fy;
  outMat[7] = fy;

  outMat[8] = sx * rz;
  outMat[9] = sy * uz;
  outMat[10] = zA * fz;
  outMat[11] = fz;

  outMat[12] = sx * camX0;
  outMat[13] = sy * camY0;
  outMat[14] = zA * camD0 + zB;
  outMat[15] = camD0;
  return outMat;
}

/**
 * Builds a texel-snapped orthographic Directional Light View-Projection matrix (Z-Up)
 * for the 1024×1024 Directional Shadow Map on both WebGPU ([0,1]) and WebGL2 ([-1,1]).
 * `sunDirX/Y/Z` points FROM the scene TOWARD the directional sun light.
 */
export function buildDirectionalLightViewProjMatrix(
  centerX: number,
  centerY: number,
  centerZ: number,
  sunDirX: number,
  sunDirY: number,
  sunDirZ: number,
  halfExtent: number,
  depthSpan: number,
  shadowMapSize: number,
  depthZeroToOne: boolean,
  outMat: Float32Array,
): Float32Array {
  const sLen = Math.hypot(sunDirX, sunDirY, sunDirZ) || 1;
  // Light forward F points FROM sun TOWARD scene = -normalize(sunDir)
  const fx = -sunDirX / sLen;
  const fy = -sunDirY / sLen;
  const fz = -sunDirZ / sLen;

  // Pick stable reference up avoiding collinearity with F
  const refUpX = Math.abs(fz) > 0.96 ? 0 : 0;
  const refUpY = Math.abs(fz) > 0.96 ? -1 : 0;
  const refUpZ = Math.abs(fz) > 0.96 ? 0 : 1;

  // R = normalize(cross(F, refUp))
  let rx = fy * refUpZ - fz * refUpY;
  let ry = fz * refUpX - fx * refUpZ;
  let rz = fx * refUpY - fy * refUpX;
  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;

  // U = cross(R, F)
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  const safeExtent = Math.max(64, halfExtent);
  const safeSpan = Math.max(256, depthSpan);
  const halfDepth = safeSpan * 0.5;

  // Snap center in light-space XY to shadow texel grid to prevent edge swimming while panning
  const texelWorld = (2 * safeExtent) / Math.max(64, shadowMapSize);
  const rawLightX = rx * centerX + ry * centerY + rz * centerZ;
  const rawLightY = ux * centerX + uy * centerY + uz * centerZ;
  const snappedLightX = Math.round(rawLightX / texelWorld) * texelWorld;
  const snappedLightY = Math.round(rawLightY / texelWorld) * texelWorld;
  const lightZ = fx * centerX + fy * centerY + fz * centerZ;

  const eyeX = rx * snappedLightX + ux * snappedLightY + fx * (lightZ - halfDepth);
  const eyeY = ry * snappedLightX + uy * snappedLightY + fy * (lightZ - halfDepth);
  const eyeZ = rz * snappedLightX + uz * snappedLightY + fz * (lightZ - halfDepth);

  const invExt = 1 / safeExtent;
  const near = 1;
  const far = safeSpan;
  const invRange = 1 / Math.max(1e-3, far - near);
  const zScale = depthZeroToOne ? invRange : 2 * invRange;
  const zBias = depthZeroToOne ? -near * invRange : -(far + near) * invRange;

  const camX0 = -(rx * eyeX + ry * eyeY + rz * eyeZ);
  const camY0 = -(ux * eyeX + uy * eyeY + uz * eyeZ);
  const camD0 = -(fx * eyeX + fy * eyeY + fz * eyeZ);

  outMat[0] = invExt * rx;
  outMat[1] = invExt * ux;
  outMat[2] = zScale * fx;
  outMat[3] = 0;

  outMat[4] = invExt * ry;
  outMat[5] = invExt * uy;
  outMat[6] = zScale * fy;
  outMat[7] = 0;

  outMat[8] = invExt * rz;
  outMat[9] = invExt * uz;
  outMat[10] = zScale * fz;
  outMat[11] = 0;

  outMat[12] = invExt * camX0;
  outMat[13] = invExt * camY0;
  outMat[14] = zScale * camD0 + zBias;
  outMat[15] = 1;
  return outMat;
}

export interface ScreenPoint3D {
  x: number;
  y: number;
  scale: number;
  depth: number;
  visible: boolean;
}

/**
 * Projects a 3D world point `(wx, wy, wz)` into logical viewport screen coordinates `[0..viewW, 0..viewH]`.
 * Works identically for both Perspective and Tri-View Orthographic cameras.
 */
export function projectWorld3DToScreen(
  wx: number,
  wy: number,
  wz: number,
  cam: ComputedCamera3D,
  out: ScreenPoint3D,
): ScreenPoint3D {
  const dx = wx - cam.eyeX;
  const dy = wy - cam.eyeY;
  const dz = wz - cam.eyeZ;

  const camX = dx * cam.rx + dy * cam.ry + dz * cam.rz;
  const camY = dx * cam.ux + dy * cam.uy + dz * cam.uz;
  const camDepth = dx * cam.fx + dy * cam.fy + dz * cam.fz;

  if (cam.isOrtho) {
    const ndcX = camX / Math.max(1e-3, cam.orthoHalfW);
    const ndcY = camY / Math.max(1e-3, cam.orthoHalfH);
    out.x = (ndcX * 0.5 + 0.5) * cam.viewW;
    out.y = (0.5 - ndcY * 0.5) * cam.viewH;
    out.scale = cam.viewW / Math.max(1e-3, cam.orthoHalfW * 2);
    out.depth = camDepth;
    out.visible = camDepth >= cam.near && camDepth <= cam.far;
    return out;
  }

  if (camDepth <= 1) {
    out.x = -9999;
    out.y = -9999;
    out.scale = 0;
    out.depth = camDepth;
    out.visible = false;
    return out;
  }

  const invDepth = 1 / camDepth;
  const ndcX = camX * (cam.focal / cam.aspect) * invDepth;
  const ndcY = camY * cam.focal * invDepth;

  out.x = (ndcX * 0.5 + 0.5) * cam.viewW;
  out.y = (0.5 - ndcY * 0.5) * cam.viewH;
  out.scale = cam.distance * invDepth;
  out.depth = camDepth;
  out.visible = true;
  return out;
}

/**
 * Computes an exact world-space picking ray through logical viewport pixel `(screenX, screenY)`
 * for both Perspective and Orthographic cameras (Zero-GC).
 */
export function screenToWorldRay3D(
  screenX: number,
  screenY: number,
  cam: ComputedCamera3D,
  outRay: WorldRay3D,
): WorldRay3D {
  const ndcX = (screenX / cam.viewW) * 2 - 1;
  const ndcY = 1 - (screenY / cam.viewH) * 2;

  if (cam.isOrtho) {
    const ox = ndcX * cam.orthoHalfW;
    const oy = ndcY * cam.orthoHalfH;
    outRay.originX = cam.eyeX + cam.rx * ox + cam.ux * oy;
    outRay.originY = cam.eyeY + cam.ry * ox + cam.uy * oy;
    outRay.originZ = cam.eyeZ + cam.rz * ox + cam.uz * oy;
    outRay.dirX = cam.fx;
    outRay.dirY = cam.fy;
    outRay.dirZ = cam.fz;
    return outRay;
  }

  const rxC = (ndcX * cam.aspect) / cam.focal;
  const ryC = ndcY / cam.focal;
  const dx = cam.rx * rxC + cam.ux * ryC + cam.fx;
  const dy = cam.ry * rxC + cam.uy * ryC + cam.fy;
  const dz = cam.rz * rxC + cam.uz * ryC + cam.fz;
  const len = Math.hypot(dx, dy, dz) || 1;

  outRay.originX = cam.eyeX;
  outRay.originY = cam.eyeY;
  outRay.originZ = cam.eyeZ;
  outRay.dirX = dx / len;
  outRay.dirY = dy / len;
  outRay.dirZ = dz / len;
  return outRay;
}

const rayScratch = createWorldRay3D();

/**
 * Exact analytical inverse: intersects a ray through logical viewport pixel `(screenX, screenY)`
 * with an axis-aligned plane (`x = planeVal`, `y = planeVal`, or `z = planeVal`).
 * Works seamlessly across Perspective, Top XY, Front XZ, Side YZ, and Isometric Ortho cameras.
 */
export function screenToWorldPlaneAxis(
  screenX: number,
  screenY: number,
  cam: ComputedCamera3D,
  axis: 'x' | 'y' | 'z',
  planeVal: number,
  out: [number, number, number],
): boolean {
  screenToWorldRay3D(screenX, screenY, cam, rayScratch);
  const orig = axis === 'x' ? rayScratch.originX : axis === 'y' ? rayScratch.originY : rayScratch.originZ;
  const dir = axis === 'x' ? rayScratch.dirX : axis === 'y' ? rayScratch.dirY : rayScratch.dirZ;
  if (Math.abs(dir) < 1e-5) {
    return false;
  }
  const t = (planeVal - orig) / dir;
  if (t <= 0 || !Number.isFinite(t)) {
    return false;
  }
  out[0] = rayScratch.originX + t * rayScratch.dirX;
  out[1] = rayScratch.originY + t * rayScratch.dirY;
  out[2] = rayScratch.originZ + t * rayScratch.dirZ;
  return true;
}

const planeZScratch: [number, number, number] = [0, 0, 0];

/**
 * Exact analytical inverse: intersects a ray through logical viewport pixel `(screenX, screenY)`
 * with the horizontal `Z = planeZ` plane (default `0`). Writes `[worldX, worldY]` into `out`.
 */
export function screenToWorldPlaneZ(
  screenX: number,
  screenY: number,
  cam: ComputedCamera3D,
  out: [number, number],
  planeZ = 0,
): boolean {
  if (!screenToWorldPlaneAxis(screenX, screenY, cam, 'z', planeZ, planeZScratch)) {
    return false;
  }
  out[0] = planeZScratch[0];
  out[1] = planeZScratch[1];
  return true;
}

/**
 * Converts a right-handed glTF 2.0 Y-Up coordinate/normal `(gx, gy, gz)`
 * into Pixer's canonical Z-Up basis `(pixerX = gx, pixerY = gz, pixerZ = gy)`.
 * Note: Because swapping Y <-> Z flips handedness (det = -1), callers importing triangle
 * index lists MUST swap `(i0, i1, i2)` -> `(i0, i2, i1)` to preserve outward normals.
 */
export function convertGlbYUpToPixerZUp(
  gx: number,
  gy: number,
  gz: number,
  out: [number, number, number],
): [number, number, number] {
  out[0] = gx;
  out[1] = gz;
  out[2] = gy;
  return out;
}
