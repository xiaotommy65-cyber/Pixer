/**
 * Engine 10.0 — 6DoF 3D Virtual Camera Rig & Shot Sequencer (100% DOM-free, Zero-GC).
 *
 * Drives continuous spatial camera transitions across Title, Lobby, Song Select,
 * Course Hall, Stage Fly-In, Live 4K Gameplay Choreography, and Result Showcase.
 * Computes a column-major 4x4 View-Projection matrix in-place (`viewProj`) plus
 * a fast Zero-GC 3D-to-2D world projector (`projectPoint3D`) shared identically
 * between WebGL2/WebGPU 3D stage passes and Canvas 2D perspective fallback.
 */

export type CameraShotId =
  | 'TITLE_ORBIT'
  | 'LOBBY_HERO'
  | 'SELECT_CAROUSEL'
  | 'COURSE_HALL'
  | 'PROFILE_SANCTUM'
  | 'STAGE_FLYIN'
  | 'PLAY_ESTABLISHING'
  | 'PLAY_STANDARD'
  | 'PLAY_HERO_LOW'
  | 'PLAY_SWEEP_LEFT'
  | 'PLAY_SWEEP_RIGHT'
  | 'PLAY_OVERDRIVE'
  | 'RESULT_WIDE';

export interface CameraPose {
  posX: number;
  posY: number;
  posZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  fovDeg: number;
  rollDeg: number;
}

export interface ProjectedPoint2D {
  x: number;
  y: number;
  ndcZ: number;
  scale: number;
  visible: boolean;
}

const DEG2RAD = Math.PI / 180;

export const CAMERA_SHOT_PRESETS: Record<CameraShotId, CameraPose> = {
  // Cinematic low-angle sweep looking toward the glowing celestial dome & floating rings
  TITLE_ORBIT: {
    posX: -2.2,
    posY: 4.8,
    posZ: 12.6,
    targetX: 0.4,
    targetY: 2.3,
    targetZ: -8.0,
    fovDeg: 52,
    rollDeg: -1.4,
  },
  // Asymmetric standalone game lobby: shifts stage focal centerpiece to the right third
  LOBBY_HERO: {
    posX: -1.85,
    posY: 3.4,
    posZ: 9.2,
    targetX: 1.4,
    targetY: 1.9,
    targetZ: -6.5,
    fovDeg: 50,
    rollDeg: -0.6,
  },
  // Song select carousel: warm spotlight toward center-right jacket pedestal & spectrum towers
  SELECT_CAROUSEL: {
    posX: 1.35,
    posY: 3.05,
    posZ: 8.6,
    targetX: -0.35,
    targetY: 1.65,
    targetZ: -7.5,
    fovDeg: 48,
    rollDeg: 0.5,
  },
  // Course hall: elevated cathedral vantage over the 3-stage gauntlet corridor
  COURSE_HALL: {
    posX: 0,
    posY: 5.4,
    posZ: 10.8,
    targetX: 0,
    targetY: 1.4,
    targetZ: -11.0,
    fovDeg: 54,
    rollDeg: 0,
  },
  // Profile sanctum: calm wide observatory framing
  PROFILE_SANCTUM: {
    posX: 2.4,
    posY: 4.1,
    posZ: 10.2,
    targetX: -0.8,
    targetY: 2.2,
    targetZ: -8.0,
    fovDeg: 48,
    rollDeg: 0.8,
  },
  // High dome swoop-in start pose before settling onto the 4K highway
  STAGE_FLYIN: {
    posX: 0,
    posY: 8.6,
    posZ: 13.4,
    targetX: 0,
    targetY: 1.0,
    targetZ: -12.0,
    fovDeg: 62,
    rollDeg: 0,
  },
  // Calm opening gameplay camera (high readability, slight panoramic depth)
  PLAY_ESTABLISHING: {
    posX: 0,
    posY: 5.15,
    posZ: 6.35,
    targetX: 0,
    targetY: 0.35,
    targetZ: -5.4,
    fovDeg: 53,
    rollDeg: 0,
  },
  // Canonical tournament 4K competitive camera (crystal-clear lane geometry)
  PLAY_STANDARD: {
    posX: 0,
    posY: 4.95,
    posZ: 5.95,
    targetX: 0,
    targetY: 0.28,
    targetZ: -5.2,
    fovDeg: 52,
    rollDeg: 0,
  },
  // Dramatic low-angle build/chorus push toward the approaching notes
  PLAY_HERO_LOW: {
    posX: 0,
    posY: 4.42,
    posZ: 5.65,
    targetX: 0,
    targetY: 0.52,
    targetZ: -6.2,
    fovDeg: 55,
    rollDeg: 0,
  },
  // Dynamic left sweep during guitar/synth lead breaks
  PLAY_SWEEP_LEFT: {
    posX: -0.58,
    posY: 4.82,
    posZ: 5.9,
    targetX: 0.14,
    targetY: 0.32,
    targetZ: -5.4,
    fovDeg: 53.5,
    rollDeg: -2.2,
  },
  // Dynamic right sweep during lead breaks
  PLAY_SWEEP_RIGHT: {
    posX: 0.58,
    posY: 4.82,
    posZ: 5.9,
    targetX: -0.14,
    targetY: 0.32,
    targetZ: -5.4,
    fovDeg: 53.5,
    rollDeg: 2.2,
  },
  // Peak drop / Fever overdrive: punchy FOV + tighter horizon immersion
  PLAY_OVERDRIVE: {
    posX: 0,
    posY: 4.55,
    posZ: 5.52,
    targetX: 0,
    targetY: 0.44,
    targetZ: -6.4,
    fovDeg: 56.5,
    rollDeg: 0,
  },
  // Post-song wide spotlight pull-back as highway dissolves
  RESULT_WIDE: {
    posX: 1.9,
    posY: 4.3,
    posZ: 10.6,
    targetX: -0.6,
    targetY: 2.0,
    targetZ: -7.0,
    fovDeg: 49,
    rollDeg: 0.9,
  },
};

export function isGameplayShot(shot: CameraShotId): boolean {
  return (
    shot === 'PLAY_ESTABLISHING' ||
    shot === 'PLAY_STANDARD' ||
    shot === 'PLAY_HERO_LOW' ||
    shot === 'PLAY_SWEEP_LEFT' ||
    shot === 'PLAY_SWEEP_RIGHT' ||
    shot === 'PLAY_OVERDRIVE'
  );
}

export class CameraRigDirector {
  public readonly current: CameraPose = { ...CAMERA_SHOT_PRESETS.TITLE_ORBIT };
  public readonly target: CameraPose = { ...CAMERA_SHOT_PRESETS.TITLE_ORBIT };

  /** Pre-allocated column-major 4x4 matrices (Zero-GC) */
  public readonly viewMatrix = new Float32Array(16);
  public readonly projMatrix = new Float32Array(16);
  public readonly viewProjMatrix = new Float32Array(16);

  private activeShot: CameraShotId = 'TITLE_ORBIT';
  private staticGameplayLock = false;
  private reducedMotion = false;
  private dampingRate = 6.2;

  private elapsedSec = 0;
  private beatKick = 0;
  private shakeTrauma = 0;
  private pointerParallaxX = 0;
  private pointerParallaxY = 0;
  private smoothParallaxX = 0;
  private smoothParallaxY = 0;

  private aspect = 16 / 9;
  private near = 0.2;
  private far = 140;

  constructor(initialShot: CameraShotId = 'TITLE_ORBIT') {
    this.snapToShot(initialShot);
  }

  public getActiveShot(): CameraShotId {
    return this.activeShot;
  }

  public setStaticGameplayLock(locked: boolean): void {
    this.staticGameplayLock = locked;
    if (locked && isGameplayShot(this.activeShot)) {
      this.setShot('PLAY_STANDARD', 9.5);
    }
  }

  public isStaticGameplayLock(): boolean {
    return this.staticGameplayLock;
  }

  public setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  public setPointerParallax(nx: number, ny: number): void {
    // Normalized pointer [-1..1]
    this.pointerParallaxX = Math.max(-1, Math.min(1, nx));
    this.pointerParallaxY = Math.max(-1, Math.min(1, ny));
  }

  public triggerBeatKick(amount: number): void {
    if (this.reducedMotion) return;
    if (this.staticGameplayLock && isGameplayShot(this.activeShot)) return;
    this.beatKick = Math.min(1.35, Math.max(this.beatKick, amount));
  }

  public addShakeTrauma(amount: number): void {
    if (this.reducedMotion) return;
    this.shakeTrauma = Math.min(1, this.shakeTrauma + Math.max(0, amount));
  }

  public setShot(shot: CameraShotId, dampingRate = 6.2): void {
    const resolvedShot: CameraShotId =
      this.staticGameplayLock && isGameplayShot(shot) ? 'PLAY_STANDARD' : shot;
    this.activeShot = resolvedShot;
    this.dampingRate = Math.max(1.5, Math.min(20, dampingRate));
    const preset = CAMERA_SHOT_PRESETS[resolvedShot];
    this.target.posX = preset.posX;
    this.target.posY = preset.posY;
    this.target.posZ = preset.posZ;
    this.target.targetX = preset.targetX;
    this.target.targetY = preset.targetY;
    this.target.targetZ = preset.targetZ;
    this.target.fovDeg = preset.fovDeg;
    this.target.rollDeg = preset.rollDeg;
  }

  public snapToShot(shot: CameraShotId): void {
    this.setShot(shot, 10);
    this.current.posX = this.target.posX;
    this.current.posY = this.target.posY;
    this.current.posZ = this.target.posZ;
    this.current.targetX = this.target.targetX;
    this.current.targetY = this.target.targetY;
    this.current.targetZ = this.target.targetZ;
    this.current.fovDeg = this.target.fovDeg;
    this.current.rollDeg = this.target.rollDeg;
    this.beatKick = 0;
    this.shakeTrauma = 0;
    this.rebuildMatrices(this.aspect);
  }

  /**
   * Advances spring damping, ambient orbital/parallax motion, beat kicks, and rebuilds
   * the 4x4 View-Projection matrix in-place with zero allocations.
   */
  public step(dtSec: number, aspect: number): void {
    const dt = Math.max(0.0005, Math.min(0.05, dtSec));
    this.elapsedSec += dt;
    this.aspect = Math.max(0.4, Math.min(3.6, Number.isFinite(aspect) ? aspect : 16 / 9));

    const alpha = 1 - Math.exp(-this.dampingRate * dt);
    const pAlpha = 1 - Math.exp(-5.0 * dt);

    this.smoothParallaxX += (this.pointerParallaxX - this.smoothParallaxX) * pAlpha;
    this.smoothParallaxY += (this.pointerParallaxY - this.smoothParallaxY) * pAlpha;

    this.beatKick = Math.max(0, this.beatKick - dt * 4.5);
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 3.2);

    this.current.posX += (this.target.posX - this.current.posX) * alpha;
    this.current.posY += (this.target.posY - this.current.posY) * alpha;
    this.current.posZ += (this.target.posZ - this.current.posZ) * alpha;
    this.current.targetX += (this.target.targetX - this.current.targetX) * alpha;
    this.current.targetY += (this.target.targetY - this.current.targetY) * alpha;
    this.current.targetZ += (this.target.targetZ - this.current.targetZ) * alpha;
    this.current.fovDeg += (this.target.fovDeg - this.current.fovDeg) * alpha;
    this.current.rollDeg += (this.target.rollDeg - this.current.rollDeg) * alpha;

    this.rebuildMatrices(this.aspect);
  }

  /**
   * Returns the effective camera eye position after orbital drift, parallax, and beat kick.
   * Reuses a pre-allocated output object to guarantee Zero-GC.
   */
  private readonly effectivePose: CameraPose = { ...CAMERA_SHOT_PRESETS.TITLE_ORBIT };

  public getEffectivePose(): Readonly<CameraPose> {
    return this.effectivePose;
  }

  private rebuildMatrices(aspect: number): void {
    const t = this.elapsedSec;
    const motionScale = this.reducedMotion ? 0 : 1;
    const inGameplay = isGameplayShot(this.activeShot);
    const gameplayLocked = this.staticGameplayLock && inGameplay;

    let offPosX = 0;
    let offPosY = 0;
    let offPosZ = 0;
    let offTargetX = 0;
    let offTargetY = 0;
    let offFov = 0;
    let offRoll = 0;

    if (motionScale > 0 && !gameplayLocked) {
      if (this.activeShot === 'TITLE_ORBIT') {
        offPosX = Math.sin(t * 0.24) * 1.45 + this.smoothParallaxX * 0.45;
        offPosY = Math.cos(t * 0.19) * 0.36 - this.smoothParallaxY * 0.24;
        offPosZ = Math.cos(t * 0.24) * 0.85;
        offRoll = Math.sin(t * 0.21) * 0.7;
      } else if (
        this.activeShot === 'LOBBY_HERO' ||
        this.activeShot === 'SELECT_CAROUSEL' ||
        this.activeShot === 'COURSE_HALL' ||
        this.activeShot === 'PROFILE_SANCTUM' ||
        this.activeShot === 'RESULT_WIDE'
      ) {
        offPosX = Math.sin(t * 0.35) * 0.32 + this.smoothParallaxX * 0.55;
        offPosY = Math.cos(t * 0.28) * 0.14 - this.smoothParallaxY * 0.28;
        offTargetX = this.smoothParallaxX * 0.22;
        offTargetY = -this.smoothParallaxY * 0.12;
      } else if (inGameplay) {
        if (this.activeShot === 'PLAY_OVERDRIVE') {
          offRoll = Math.sin(t * 2.2) * 0.95;
          offPosX = Math.sin(t * 1.4) * 0.18;
        } else if (this.activeShot === 'PLAY_HERO_LOW') {
          offRoll = Math.sin(t * 1.3) * 0.5;
        }
        // Punchy beat-synced Z & FOV pulse that never obscures lane alignment
        offPosZ -= this.beatKick * 0.24;
        offFov += this.beatKick * 1.6;
      }

      if (this.shakeTrauma > 0.001) {
        const mag = this.shakeTrauma * this.shakeTrauma;
        offPosX += Math.sin(t * 53.1) * 0.12 * mag;
        offPosY += Math.cos(t * 47.7) * 0.09 * mag;
        offRoll += Math.sin(t * 39.3) * 1.1 * mag;
      }
    }

    const ep = this.effectivePose;
    ep.posX = this.current.posX + offPosX;
    ep.posY = this.current.posY + offPosY;
    ep.posZ = this.current.posZ + offPosZ;
    ep.targetX = this.current.targetX + offTargetX;
    ep.targetY = this.current.targetY + offTargetY;
    ep.targetZ = this.current.targetZ;
    ep.fovDeg = Math.max(32, Math.min(82, this.current.fovDeg + offFov));
    ep.rollDeg = this.current.rollDeg + offRoll;

    computeLookAtMatrix(
      this.viewMatrix,
      ep.posX,
      ep.posY,
      ep.posZ,
      ep.targetX,
      ep.targetY,
      ep.targetZ,
      ep.rollDeg * DEG2RAD,
    );
    computePerspectiveMatrix(this.projMatrix, ep.fovDeg * DEG2RAD, aspect, this.near, this.far);
    multiplyMat4(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
  }

  /**
   * Projects a 3D world-space coordinate `(wx, wy, wz)` into viewport pixels `(x, y)`
   * using the exact active 4x4 `viewProjMatrix`. Writes in-place into `out` (Zero-GC).
   */
  public projectPoint3D(
    wx: number,
    wy: number,
    wz: number,
    viewportW: number,
    viewportH: number,
    out: ProjectedPoint2D,
  ): ProjectedPoint2D {
    const m = this.viewProjMatrix;
    const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
    const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
    const cz = m[2] * wx + m[6] * wy + m[10] * wz + m[14];
    const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];

    if (cw <= 0.05) {
      out.x = 0;
      out.y = 0;
      out.ndcZ = -2;
      out.scale = 0;
      out.visible = false;
      return out;
    }

    const invW = 1 / cw;
    const ndcX = cx * invW;
    const ndcY = cy * invW;
    const ndcZ = cz * invW;

    out.x = (ndcX * 0.5 + 0.5) * viewportW;
    out.y = (0.5 - ndcY * 0.5) * viewportH;
    out.ndcZ = ndcZ;
    out.scale = invW * viewportH * 0.5;
    out.visible = ndcZ >= -1.0 && ndcZ <= 1.05;
    return out;
  }
}

function computePerspectiveMatrix(
  out: Float32Array,
  fovRad: number,
  aspect: number,
  near: number,
  far: number,
): void {
  const f = 1.0 / Math.tan(fovRad * 0.5);
  const nf = 1 / (near - far);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;

  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;

  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;

  out[12] = 0;
  out[13] = 0;
  out[14] = 2 * far * near * nf;
  out[15] = 0;
}

function computeLookAtMatrix(
  out: Float32Array,
  ex: number,
  ey: number,
  ez: number,
  tx: number,
  ty: number,
  tz: number,
  rollRad: number,
): void {
  let zx = ex - tx;
  let zy = ey - ty;
  let zz = ez - tz;
  let zLen = Math.hypot(zx, zy, zz);
  if (zLen < 1e-6) {
    zz = 1;
    zLen = 1;
  }
  zx /= zLen;
  zy /= zLen;
  zz /= zLen;

  // World up tilted by roll around view forward axis
  const upX = Math.sin(rollRad);
  const upY = Math.cos(rollRad);
  const upZ = 0;

  // X = normalize(cross(up, Z))
  let xx = upY * zz - upZ * zy;
  let xy = upZ * zx - upX * zz;
  let xz = upX * zy - upY * zx;
  let xLen = Math.hypot(xx, xy, xz);
  if (xLen < 1e-6) {
    xx = 1;
    xy = 0;
    xz = 0;
    xLen = 1;
  }
  xx /= xLen;
  xy /= xLen;
  xz /= xLen;

  // Y = cross(Z, X)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;

  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;

  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;

  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
}

function multiplyMat4(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4];
    const b1 = b[col * 4 + 1];
    const b2 = b[col * 4 + 2];
    const b3 = b[col * 4 + 3];
    out[col * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
}
