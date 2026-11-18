import type { PadDirection } from './StickShaper.ts';

export type DpadDeadzoneMode = 'standard' | 'tight';

/**
 * Polar octant D-Pad classifier with inner deadzone and configurable diagonal cone tightness.
 * Standard gives balanced 52 deg cardinals / 38 deg diagonals; Tight widens cardinals to 60 deg
 * to minimize accidental diagonal bleed during fast cardinal thumb slides.
 */
export function classifyDpadOctant(
  normX: number,
  normY: number,
  mode: DpadDeadzoneMode = 'standard',
): Record<PadDirection, boolean> {
  const res: Record<PadDirection, boolean> = { left: false, right: false, up: false, down: false };
  const r = Math.hypot(normX, normY);
  const deadzone = mode === 'tight' ? 0.24 : 0.2;
  if (r < deadzone) return res;

  // Angle in degrees (-180..180], 0 = East (right), 90 = South (down)
  const deg = (Math.atan2(normY, normX) * 180) / Math.PI;
  const diagHalfAngle = mode === 'tight' ? 15 : 19;
  const cardinalCut = 45 - diagHalfAngle; // 26 deg (standard) or 30 deg (tight)

  if (Math.abs(deg) <= cardinalCut) {
    res.right = true;
  } else if (deg > cardinalCut && deg < 90 - cardinalCut) {
    res.right = true;
    res.down = true;
  } else if (deg >= 90 - cardinalCut && deg <= 90 + cardinalCut) {
    res.down = true;
  } else if (deg > 90 + cardinalCut && deg < 180 - cardinalCut) {
    res.left = true;
    res.down = true;
  } else if (Math.abs(deg) >= 180 - cardinalCut) {
    res.left = true;
  } else if (deg < -cardinalCut && deg > -(90 - cardinalCut)) {
    res.right = true;
    res.up = true;
  } else if (deg <= -(90 - cardinalCut) && deg >= -(90 + cardinalCut)) {
    res.up = true;
  } else {
    res.left = true;
    res.up = true;
  }

  return res;
}

/**
 * Unified ABXY diamond surface hit-tester supporting smooth thumb-rolls & B+A / Y+B chord bridges.
 * Positions around diamond: X = Top (-90 deg), A = Right (0 deg), B = Bottom (+90 deg), Y = Left (180 deg).
 */
export function resolveAbxyClusterHit(
  normX: number,
  normY: number,
): { a: boolean; b: boolean; x: boolean; y: boolean } {
  const res = { a: false, b: false, x: false, y: false };
  const r = Math.hypot(normX, normY);
  if (r < 0.16) return res;

  const deg = (Math.atan2(normY, normX) * 180) / Math.PI;

  // Dedicated B+A thumb-roll chord bridge (around +45 deg, r >= 0.42)
  if (r >= 0.42 && Math.abs(deg - 45) <= 14) {
    res.a = true;
    res.b = true;
    return res;
  }

  // Dedicated Y+B thumb-roll chord bridge (around +135 deg, r >= 0.45)
  if (r >= 0.45 && Math.abs(deg - 135) <= 12) {
    res.y = true;
    res.b = true;
    return res;
  }

  // Standard 4-quadrant diamond resolution
  if (deg >= -45 && deg < 45) res.a = true;
  else if (deg >= 45 && deg < 135) res.b = true;
  else if (deg >= -135 && deg < -45) res.x = true;
  else res.y = true;

  return res;
}
