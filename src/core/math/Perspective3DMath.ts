/**
 * Pure DOM-free, Zero-GC 3D Perspective Camera & Analytical Ray-Plane Math
 * for Pixer's True 3D HD-2D Pixel Renderer (`hd2d_3d`).
 *
 * World coordinate convention (matches 2D tilemaps naturally):
 * - +X: East (screen right)
 * - +Y: South (screen down on floor plane)
 * - +Z: Up (wall extrusion height & actor elevation above Z = 0 ground plane)
 *
 * Camera sits south (+Y) and above (+Z) target `(camCenterX, camCenterY, 0)` looking north-down
 * at pitch angle `pitchDeg` above the ground plane, calibrated so 1 world pixel at screen center
 * maps to `zoom` logical screen pixels horizontally.
 */

export interface Perspective3DCameraParams {
  camCenterX: number;
  camCenterY: number;
  zoom: number;
  viewW: number;
  viewH: number;
  pitchDeg: number;
  fovDeg: number;
  near?: number;
  far?: number;
}

export interface ComputedCamera3D {
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  camCenterX: number;
  camCenterY: number;
  sinPitch: number;
  cosPitch: number;
  focal: number;
  aspect: number;
  near: number;
  far: number;
  distance: number;
  viewW: number;
  viewH: number;
}

export const DEFAULT_HD2D_3D_PITCH_DEG = 42;
export const DEFAULT_HD2D_3D_FOV_DEG = 38;
export const DEFAULT_HD2D_3D_NEAR = 24;
export const DEFAULT_HD2D_3D_FAR = 2600;

export function createComputedCamera3D(): ComputedCamera3D {
  return {
    eyeX: 0,
    eyeY: 0,
    eyeZ: 0,
    camCenterX: 0,
    camCenterY: 0,
    sinPitch: 0.669,
    cosPitch: 0.743,
    focal: 2.9,
    aspect: 16 / 9,
    near: DEFAULT_HD2D_3D_NEAR,
    far: DEFAULT_HD2D_3D_FAR,
    distance: 520,
    viewW: 640,
    viewH: 360,
  };
}

/**
 * Computes camera eye position and projection constants into pre-allocated `out` (Zero-GC).
 */
export function computeCamera3D(params: Perspective3DCameraParams, out: ComputedCamera3D): ComputedCamera3D {
  const safeViewW = Math.max(1, params.viewW);
  const safeViewH = Math.max(1, params.viewH);
  const safeZoom = Math.max(0.25, Math.min(4, params.zoom || 1));
  const pitchClamped = Math.max(20, Math.min(72, params.pitchDeg || DEFAULT_HD2D_3D_PITCH_DEG));
  const fovClamped = Math.max(18, Math.min(68, params.fovDeg || DEFAULT_HD2D_3D_FOV_DEG));

  const pitchRad = (pitchClamped * Math.PI) / 180;
  const fovRad = (fovClamped * Math.PI) / 180;
  const sinPitch = Math.sin(pitchRad);
  const cosPitch = Math.cos(pitchRad);
  const focal = 1 / Math.tan(fovRad * 0.5);
  const aspect = safeViewW / safeViewH;

  // Distance calibrated so horizontal scale at target (Z=0) equals `safeZoom` screen px per world px
  const distance = (safeViewH / (2 * safeZoom)) * focal;
  const near = Math.max(8, params.near ?? DEFAULT_HD2D_3D_NEAR);
  const far = Math.max(distance + 800, params.far ?? DEFAULT_HD2D_3D_FAR);

  out.camCenterX = params.camCenterX;
  out.camCenterY = params.camCenterY;
  out.eyeX = params.camCenterX;
  out.eyeY = params.camCenterY + distance * cosPitch;
  out.eyeZ = distance * sinPitch;
  out.sinPitch = sinPitch;
  out.cosPitch = cosPitch;
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
 * - `depthZeroToOne = true`  -> WebGPU clip space Z in [0, 1]
 * - `depthZeroToOne = false` -> WebGL2 clip space Z in [-1, 1]
 *
 * Clip-space derivation:
 *   camX     =  (wx - eyeX)
 *   camY     = -(wy - eyeY) * sinP + (wz - eyeZ) * cosP
 *   camDepth = -(wy - eyeY) * cosP - (wz - eyeZ) * sinP
 *   clipX    = camX * (focal / aspect)
 *   clipY    = camY * focal
 *   clipW    = camDepth
 *   clipZ    = camDepth * zA + zB
 */
export function buildCamera3DViewProjMatrix(
  cam: ComputedCamera3D,
  depthZeroToOne: boolean,
  outMat: Float32Array,
): Float32Array {
  const sx = cam.focal / cam.aspect;
  const sy = cam.focal;
  const sinP = cam.sinPitch;
  const cosP = cam.cosPitch;
  const near = cam.near;
  const far = cam.far;
  const invRange = 1 / Math.max(1e-3, far - near);

  const zA = depthZeroToOne ? far * invRange : (far + near) * invRange;
  const zB = depthZeroToOne ? -(near * far) * invRange : -(2 * near * far) * invRange;

  // Translation terms from subtracting eye:
  // camX0     = -eyeX
  // camY0     =  eyeY * sinP - eyeZ * cosP
  // camDepth0 =  eyeY * cosP + eyeZ * sinP
  const camX0 = -cam.eyeX;
  const camY0 = cam.eyeY * sinP - cam.eyeZ * cosP;
  const camDepth0 = cam.eyeY * cosP + cam.eyeZ * sinP;

  // Column 0 (multiplies wx)
  outMat[0] = sx;
  outMat[1] = 0;
  outMat[2] = 0;
  outMat[3] = 0;

  // Column 1 (multiplies wy)
  outMat[4] = 0;
  outMat[5] = -sy * sinP;
  outMat[6] = -zA * cosP;
  outMat[7] = -cosP;

  // Column 2 (multiplies wz)
  outMat[8] = 0;
  outMat[9] = sy * cosP;
  outMat[10] = -zA * sinP;
  outMat[11] = -sinP;

  // Column 3 (multiplies 1)
  outMat[12] = sx * camX0;
  outMat[13] = sy * camY0;
  outMat[14] = zA * camDepth0 + zB;
  outMat[15] = camDepth0;

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

  const camX = dx;
  const camY = -dy * cam.sinPitch + dz * cam.cosPitch;
  const camDepth = -dy * cam.cosPitch - dz * cam.sinPitch;

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
  const ndcX = (screenX / cam.viewW) * 2 - 1;
  const ndcY = 1 - (screenY / cam.viewH) * 2;

  const rxC = (ndcX * cam.aspect) / cam.focal;
  const ryC = ndcY / cam.focal;
  const rdC = 1;

  // Orthogonal inverse of camera basis -> world ray direction
  const dirX = rxC;
  const dirY = -ryC * cam.sinPitch - rdC * cam.cosPitch;
  const dirZ = ryC * cam.cosPitch - rdC * cam.sinPitch;

  if (Math.abs(dirZ) < 1e-5) {
    return false;
  }
  const t = (planeZ - cam.eyeZ) / dirZ;
  if (t <= 0 || !Number.isFinite(t)) {
    return false;
  }

  out[0] = cam.eyeX + t * dirX;
  out[1] = cam.eyeY + t * dirY;
  return true;
}
