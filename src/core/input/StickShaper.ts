export type PadDirection = 'left' | 'right' | 'up' | 'down';
export type StickCurveMode = 'standard' | 'precision';

export interface AnalogStickShapeOptions {
  deadzone?: number;
  outerDeadzone?: number;
  curveMode?: StickCurveMode;
  cardinalSnapDeg?: number;
}

export interface ShapedStickVector {
  x: number;
  y: number;
  mag: number;
  rawMag: number;
}

/**
 * Radial analog stick shaper applying inner/outer deadzones, non-linear response curves,
 * and optional subtle cardinal-axis assist so low tilts stay precise and full tilts reach 1.0 cleanly.
 */
export function shapeAnalogStickVector(
  rawX: number,
  rawY: number,
  opts: AnalogStickShapeOptions = {},
): ShapedStickVector {
  const deadzone = opts.deadzone ?? 0.16;
  const outerDeadzone = opts.outerDeadzone ?? 0.96;
  const curveMode = opts.curveMode ?? 'standard';
  const cardinalSnapDeg = opts.cardinalSnapDeg ?? 4;

  const rawMag = Math.hypot(rawX, rawY);
  if (rawMag <= deadzone || rawMag < 1e-5) {
    return { x: 0, y: 0, mag: 0, rawMag };
  }

  const span = Math.max(0.05, outerDeadzone - deadzone);
  const norm = Math.max(0, Math.min(1, (rawMag - deadzone) / span));
  const exponent = curveMode === 'precision' ? 2.15 : 1.45;
  const curved = Math.pow(norm, exponent);

  let ux = rawX / rawMag;
  let uy = rawY / rawMag;

  if (cardinalSnapDeg > 0) {
    const snapRad = (cardinalSnapDeg * Math.PI) / 180;
    const ang = Math.atan2(uy, ux);
    const nearestCardinal = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - nearestCardinal) <= snapRad) {
      ux = Math.cos(nearestCardinal);
      uy = Math.sin(nearestCardinal);
    }
  }

  return {
    x: ux * curved,
    y: uy * curved,
    mag: curved,
    rawMag,
  };
}

/**
 * Computes a dynamic floating stick origin inside the housing track:
 * - On initial landing, anchors origin within `maxOriginShiftPx` of center.
 * - While dragging beyond `maxTravelPx`, smoothly pulls origin along (still clamped to `maxOriginShiftPx`).
 */
export function updateFloatingStickOrigin(
  originX: number,
  originY: number,
  pointerX: number,
  pointerY: number,
  maxTravelPx: number,
  maxOriginShiftPx: number,
  isInitialTouch = false,
): { originX: number; originY: number; deltaX: number; deltaY: number } {
  const clampCircle = (x: number, y: number, r: number) => {
    const d = Math.hypot(x, y);
    if (d <= r || d < 1e-5) return { x, y };
    return { x: (x / d) * r, y: (y / d) * r };
  };

  let ox = originX;
  let oy = originY;

  if (isInitialTouch) {
    const anchored = clampCircle(pointerX, pointerY, maxOriginShiftPx);
    ox = anchored.x;
    oy = anchored.y;
  } else {
    const relX = pointerX - ox;
    const relY = pointerY - oy;
    const relLen = Math.hypot(relX, relY);
    if (relLen > maxTravelPx && relLen > 1e-5) {
      const targetOx = pointerX - (relX / relLen) * maxTravelPx;
      const targetOy = pointerY - (relY / relLen) * maxTravelPx;
      const clampedOrigin = clampCircle(targetOx, targetOy, maxOriginShiftPx);
      ox = clampedOrigin.x;
      oy = clampedOrigin.y;
    }
  }

  const clampedDelta = clampCircle(pointerX - ox, pointerY - oy, maxTravelPx);
  return {
    originX: ox,
    originY: oy,
    deltaX: clampedDelta.x,
    deltaY: clampedDelta.y,
  };
}

/**
 * Suppresses physical/virtual stick spring overshoot ("snapback") when a stick flicked hard
 * (>= 0.52) bounces briefly across center into the opposite direction within 60ms.
 */
export class AntiSnapbackFilter {
  private lastHighX = 0;
  private lastHighY = 0;
  private lastHighAt = -Infinity;
  private suppressUntil = -Infinity;

  public reset(): void {
    this.lastHighX = 0;
    this.lastHighY = 0;
    this.lastHighAt = -Infinity;
    this.suppressUntil = -Infinity;
  }

  public filter(x: number, y: number, nowMs: number): { x: number; y: number; suppressed: boolean } {
    const mag = Math.hypot(x, y);

    if (nowMs < this.suppressUntil) {
      if (mag >= 0.72) {
        // Intentional strong opposite tilt overrides suppression immediately
        this.suppressUntil = -Infinity;
      } else {
        return { x: 0, y: 0, suppressed: true };
      }
    }

    if (mag >= 0.52) {
      this.lastHighX = x / mag;
      this.lastHighY = y / mag;
      this.lastHighAt = nowMs;
      return { x, y, suppressed: false };
    }

    if (mag > 0.05 && nowMs - this.lastHighAt <= 65) {
      const dot = (x / mag) * this.lastHighX + (y / mag) * this.lastHighY;
      if (dot < -0.52 && mag < 0.68) {
        this.suppressUntil = nowMs + 55;
        return { x: 0, y: 0, suppressed: true };
      }
    }

    return { x, y, suppressed: false };
  }
}

/**
 * Converts a shaped analog vector (-1..1) into digital cardinal directions with hysteresis
 * to prevent rapid edge chatter on boundary angles.
 */
export function stickVectorToDirections(
  x: number,
  y: number,
  prev?: Readonly<Record<PadDirection, boolean>>,
): Record<PadDirection, boolean> {
  const enterX = 0.27;
  const exitX = 0.19;
  const enterY = 0.32;
  const exitY = 0.22;

  return {
    left: prev?.left ? x < -exitX : x < -enterX,
    right: prev?.right ? x > exitX : x > enterX,
    up: prev?.up ? y < -exitY : y < -enterY,
    down: prev?.down ? y > exitY : y > enterY,
  };
}
