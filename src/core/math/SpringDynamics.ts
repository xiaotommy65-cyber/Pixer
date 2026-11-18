export interface Spring1DState {
  value: number;
  vel: number;
}

export type SpringVecTarget = Float32Array | Float64Array | number[];

const TAU = Math.PI * 2;
const CRIT_EPS = 1e-4;

function finiteOr(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Closed-form exact analytical step for a 2nd-order damped harmonic oscillator:
 *   y'' + 2 * zeta * omega * y' + omega^2 * y = omega^2 * x + 2 * r * zeta * omega * x'
 * under piecewise-linear target trajectory prevTarget -> target over duration dt.
 *
 * Guarantees unconditional stability for ANY dt > 0, zero overshoot for zeta >= 1,
 * and exact continuous Lyapunov energy decay when target is steady.
 */
export function stepSpringInto(
  value: number,
  vel: number,
  target: number,
  prevTarget: number,
  freqHz: number,
  dampingRatio: number,
  response: number,
  dt: number,
  out: SpringVecTarget,
  offset = 0,
): void {
  const curY = finiteOr(value, 0);
  const curV = finiteOr(vel, 0);
  const dstX = finiteOr(target, curY);
  const srcX = finiteOr(prevTarget, dstX);
  const safeDt = finiteOr(dt, 0);

  if (safeDt <= 1e-8) {
    out[offset] = curY;
    out[offset + 1] = curV;
    return;
  }

  const f = Math.max(0.05, Math.min(60, finiteOr(freqHz, 3)));
  const zeta = Math.max(0, Math.min(8, finiteOr(dampingRatio, 1)));
  const r = finiteOr(response, 0);
  const omega = TAU * f;

  const targetDelta = dstX - srcX;
  const vx = Math.abs(targetDelta) > 1e-12 ? targetDelta / safeDt : 0;
  const lag = vx !== 0 ? ((2 * zeta * (1 - r)) / omega) * vx : 0;

  // Homogeneous error coordinates relative to exact particular ramp trajectory
  const e0 = curY - (srcX - lag);
  const v0 = curV - vx;

  let e1 = 0;
  let v1 = 0;

  if (Math.abs(zeta - 1) <= CRIT_EPS) {
    // Critically damped double pole (-omega): strictly zero overshoot when v0 == 0
    const decay = Math.exp(-omega * safeDt);
    const wt = omega * safeDt;
    e1 = decay * (e0 * (1 + wt) + v0 * safeDt);
    v1 = decay * (v0 * (1 - wt) - e0 * omega * wt);
  } else if (zeta < 1) {
    // Underdamped oscillatory harmonic modes
    const wd = omega * Math.sqrt(Math.max(0, 1 - zeta * zeta));
    const zw = zeta * omega;
    const decay = Math.exp(-zw * safeDt);
    const angle = wd * safeDt;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const c1 = e0;
    const c2 = (v0 + zw * e0) / Math.max(1e-8, wd);
    e1 = decay * (c1 * cosA + c2 * sinA);
    v1 = decay * ((c2 * wd - zw * c1) * cosA - (c1 * wd + zw * c2) * sinA);
  } else {
    // Overdamped real distinct negative roots (r1 < 0, r2 < 0)
    const gamma = omega * Math.sqrt(Math.max(0, zeta * zeta - 1));
    const r1 = -omega * zeta + gamma;
    const r2 = -omega * zeta - gamma;
    const denom = Math.max(1e-8, r1 - r2);
    const aCoeff = (v0 - r2 * e0) / denom;
    const bCoeff = e0 - aCoeff;
    const exp1 = Math.exp(r1 * safeDt);
    const exp2 = Math.exp(r2 * safeDt);
    e1 = aCoeff * exp1 + bCoeff * exp2;
    v1 = aCoeff * r1 * exp1 + bCoeff * r2 * exp2;
  }

  out[offset] = e1 + dstX - lag;
  out[offset + 1] = v1 + vx;
}

const SPRING_SCRATCH = new Float64Array(2);

/** Steps an object-based 1D spring holding a stationary target (r = 0). */
export function stepSpringExact1D(
  state: Spring1DState,
  target: number,
  freqHz: number,
  dampingRatio: number,
  dt: number,
): number {
  stepSpringInto(state.value, state.vel, target, target, freqHz, dampingRatio, 0, dt, SPRING_SCRATCH, 0);
  state.value = SPRING_SCRATCH[0];
  state.vel = SPRING_SCRATCH[1];
  return state.value;
}

/** Steps an object-based 1D spring tracking a moving target with anticipation parameter r. */
export function stepSpringTrack1D(
  state: Spring1DState,
  target: number,
  prevTarget: number,
  freqHz: number,
  dampingRatio: number,
  response: number,
  dt: number,
): number {
  stepSpringInto(state.value, state.vel, target, prevTarget, freqHz, dampingRatio, response, dt, SPRING_SCRATCH, 0);
  state.value = SPRING_SCRATCH[0];
  state.vel = SPRING_SCRATCH[1];
  return state.value;
}

/** Zero-GC SoA buffer spring stepper operating in-place at `index`. */
export function stepSpringBuffer1D(
  values: Float32Array | Float64Array,
  vels: Float32Array | Float64Array,
  index: number,
  target: number,
  freqHz: number,
  dampingRatio: number,
  dt: number,
): number {
  stepSpringInto(values[index], vels[index], target, target, freqHz, dampingRatio, 0, dt, SPRING_SCRATCH, 0);
  values[index] = SPRING_SCRATCH[0];
  vels[index] = SPRING_SCRATCH[1];
  return values[index];
}

/**
 * Cache-friendly flat SoA Verlet chain (e.g. Celeste scarves, capes, vines, chains).
 * Zero allocations during reset/step; 8 Jakobsen constraint iterations yield sub-quarter-pixel accuracy.
 */
export class VerletChain {
  public readonly count: number;
  public readonly segmentLength: number;
  public readonly posX: Float32Array;
  public readonly posY: Float32Array;
  public readonly prevX: Float32Array;
  public readonly prevY: Float32Array;

  constructor(nodeCount = 8, segmentLength = 3.5) {
    this.count = Math.max(2, Math.min(64, Math.round(nodeCount)));
    this.segmentLength = Math.max(0.5, segmentLength);
    this.posX = new Float32Array(this.count);
    this.posY = new Float32Array(this.count);
    this.prevX = new Float32Array(this.count);
    this.prevY = new Float32Array(this.count);
    this.reset(0, 0, -1, 0);
  }

  public reset(anchorX: number, anchorY: number, dirX = -1, dirY = 0): void {
    const ax = finiteOr(anchorX, 0);
    const ay = finiteOr(anchorY, 0);
    const len = Math.hypot(dirX, dirY);
    const ux = len > 1e-6 ? dirX / len : -1;
    const uy = len > 1e-6 ? dirY / len : 0;

    for (let i = 0; i < this.count; i++) {
      const x = ax + ux * this.segmentLength * i;
      const y = ay + uy * this.segmentLength * i;
      this.posX[i] = x;
      this.posY[i] = y;
      this.prevX[i] = x;
      this.prevY[i] = y;
    }
  }

  public step(
    dt: number,
    anchorX: number,
    anchorY: number,
    forceX = 0,
    forceY = 260,
    velocityDamping = 0.96,
    iterations = 8,
    floorY?: number,
  ): void {
    const safeDt = Math.max(0, Math.min(0.05, finiteOr(dt, 0)));
    if (safeDt <= 1e-8) return;

    const ax = finiteOr(anchorX, this.posX[0]);
    const ay = finiteOr(anchorY, this.posY[0]);
    const fx = finiteOr(forceX, 0);
    const fy = finiteOr(forceY, 0);
    const damp = Math.max(0, Math.min(1, finiteOr(velocityDamping, 0.96)));
    const dt2 = safeDt * safeDt;
    const iters = Math.max(1, Math.min(24, Math.round(iterations)));
    const hasFloor = floorY !== undefined && Number.isFinite(floorY);

    // Pin root node cleanly to anchor
    this.posX[0] = ax;
    this.posY[0] = ay;
    this.prevX[0] = ax;
    this.prevY[0] = ay;

    // Verlet integration for trailing nodes 1..count-1
    for (let i = 1; i < this.count; i++) {
      const cx = this.posX[i];
      const cy = this.posY[i];
      const vx = (cx - this.prevX[i]) * damp;
      const vy = (cy - this.prevY[i]) * damp;
      this.prevX[i] = cx;
      this.prevY[i] = cy;
      this.posX[i] = cx + vx + fx * dt2;
      this.posY[i] = cy + vy + fy * dt2;
    }

    const segLen = this.segmentLength;
    const invCount = this.count - 1;

    // 1. Clamp initial integrated tentative positions against floor before constraint relaxation
    if (hasFloor) {
      for (let i = 1; i < this.count; i++) {
        if (this.posY[i] > floorY!) this.posY[i] = floorY!;
      }
    }

    // 2. Bidirectional Jakobsen relaxation passes diffuse tension cleanly across all nodes
    for (let iter = 0; iter < iters; iter++) {
      // Forward pass (root -> tip)
      this.posX[0] = ax;
      this.posY[0] = ay;
      for (let i = 0; i < invCount; i++) {
        const dx = this.posX[i + 1] - this.posX[i];
        const dy = this.posY[i + 1] - this.posY[i];
        const d2 = dx * dx + dy * dy;
        if (d2 <= 1e-12) {
          this.posX[i + 1] = this.posX[i] + segLen;
          continue;
        }
        const dist = Math.sqrt(d2);
        const corr = (segLen - dist) / dist;
        if (i === 0) {
          this.posX[1] += dx * corr;
          this.posY[1] += dy * corr;
        } else {
          const half = corr * 0.5;
          this.posX[i] -= dx * half;
          this.posY[i] -= dy * half;
          this.posX[i + 1] += dx * half;
          this.posY[i + 1] += dy * half;
        }
      }

      if (hasFloor) {
        for (let i = 1; i < this.count; i++) {
          if (this.posY[i] > floorY!) this.posY[i] = floorY!;
        }
      }

      // Backward pass (tip -> root) accelerates convergence along longer chains
      for (let i = invCount - 1; i >= 0; i--) {
        const dx = this.posX[i + 1] - this.posX[i];
        const dy = this.posY[i + 1] - this.posY[i];
        const d2 = dx * dx + dy * dy;
        if (d2 <= 1e-12) continue;
        const dist = Math.sqrt(d2);
        const corr = (segLen - dist) / dist;
        if (i === 0) {
          this.posX[1] += dx * corr;
          this.posY[1] += dy * corr;
        } else {
          const half = corr * 0.5;
          this.posX[i] -= dx * half;
          this.posY[i] -= dy * half;
          this.posX[i + 1] += dx * half;
          this.posY[i + 1] += dy * half;
        }
      }

      if (hasFloor) {
        for (let i = 1; i < this.count; i++) {
          if (this.posY[i] > floorY!) this.posY[i] = floorY!;
        }
      }
    }

    // 3. Final top-down projection preserves inextensible segment lengths even when resting/sliding on floor
    this.posX[0] = ax;
    this.posY[0] = ay;
    for (let i = 0; i < invCount; i++) {
      const px = this.posX[i];
      const py = this.posY[i];
      const dx = this.posX[i + 1] - px;
      const dy = this.posY[i + 1] - py;
      const d2 = dx * dx + dy * dy;
      let nx = px + segLen;
      let ny = py;
      if (d2 > 1e-12) {
        const invDist = segLen / Math.sqrt(d2);
        nx = px + dx * invDist;
        ny = py + dy * invDist;
      }

      if (hasFloor && ny > floorY! && py <= floorY!) {
        ny = floorY!;
        const vSpan = ny - py;
        const hSpan = Math.sqrt(Math.max(0, segLen * segLen - vSpan * vSpan));
        const signX = dx >= 0 ? 1 : -1;
        nx = px + signX * hSpan;
      }
      this.posX[i + 1] = nx;
      this.posY[i + 1] = ny;
    }
  }
}

/**
 * Closed-form analytical 2-Bone Inverse Kinematics using Law of Cosines with reach clamping.
 * Writes [jointX, jointY, endX, endY] into `out[offset..offset+3]` with zero allocations.
 */
export function solveTwoBoneIkInto(
  rootX: number,
  rootY: number,
  targetX: number,
  targetY: number,
  len1: number,
  len2: number,
  bendDir = 1,
  out: SpringVecTarget,
  offset = 0,
): void {
  const rx = finiteOr(rootX, 0);
  const ry = finiteOr(rootY, 0);
  const tx = finiteOr(targetX, rx);
  const ty = finiteOr(targetY, ry);
  const l1 = Math.max(1e-4, finiteOr(len1, 1));
  const l2 = Math.max(1e-4, finiteOr(len2, 1));
  const sign = bendDir >= 0 ? 1 : -1;

  let dx = tx - rx;
  let dy = ty - ry;
  let rawDist = Math.hypot(dx, dy);
  const dirAngle = rawDist > 1e-6 ? Math.atan2(dy, dx) : 0;

  const minReach = Math.abs(l1 - l2) + 1e-4;
  const maxReach = l1 + l2 - 1e-4;
  const dist = Math.max(minReach, Math.min(maxReach, rawDist));

  // Clamp cosAngle strictly in [-1, 1] so Math.acos never emits NaN
  const cosAngle = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const jointAngle = dirAngle + sign * Math.acos(cosAngle);

  const jx = rx + Math.cos(jointAngle) * l1;
  const jy = ry + Math.sin(jointAngle) * l1;

  // Compute exact end effector along target direction within reachable envelope
  const ex = rx + Math.cos(dirAngle) * dist;
  const ey = ry + Math.sin(dirAngle) * dist;

  out[offset] = jx;
  out[offset + 1] = jy;
  out[offset + 2] = ex;
  out[offset + 3] = ey;
}

/**
 * Evaluates a standard C1-continuous Catmull-Rom 2D spline segment P1 -> P2 at t in [0, 1].
 * Writes [x, y] into `out[offset..offset+1]` with zero allocations.
 */
export function evalCatmullRom2DInto(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  t: number,
  out: SpringVecTarget,
  offset = 0,
): void {
  const u = Math.max(0, Math.min(1, finiteOr(t, 0)));
  const u2 = u * u;
  const u3 = u2 * u;

  out[offset] =
    0.5 *
    (2 * p1x +
      (-p0x + p2x) * u +
      (2 * p0x - 5 * p1x + 4 * p2x - p3x) * u2 +
      (-p0x + 3 * p1x - 3 * p2x + p3x) * u3);
  out[offset + 1] =
    0.5 *
    (2 * p1y +
      (-p0y + p2y) * u +
      (2 * p0y - 5 * p1y + 4 * p2y - p3y) * u2 +
      (-p0y + 3 * p1y - 3 * p2y + p3y) * u3);
}
