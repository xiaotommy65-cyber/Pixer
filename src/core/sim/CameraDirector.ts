import { GAME_H, GAME_W } from '../gpu/GpuTypes.ts';
import { stepSpringInto } from '../math/SpringDynamics.ts';
import { clamp } from '../types/WorldTypes.ts';

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type CameraDirectorMode = 'follow' | 'pan' | 'lock';

function smoothstep01(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

const CAM_SPRING_OUT = new Float64Array(2);

/**
 * Engine 2.0 CameraDirector:
 * manages smooth 2nd-order spring target tracking, directional velocity look-ahead,
 * dynamic zoom, room/chapter boundary clamping, scripted cutscene panning, and letterbox bars.
 */
export class CameraDirector {
  public x = GAME_W * 0.5;
  public y = GAME_H * 0.5;
  public zoom = 1.0;
  public letterbox = 0;
  public mode: CameraDirectorMode = 'follow';

  private viewW = GAME_W;
  private viewH = GAME_H;
  private vx = 0;
  private vy = 0;
  private zoomVel = 0;
  private prevDesiredX = GAME_W * 0.5;
  private prevDesiredY = GAME_H * 0.5;
  private hasPrevDesired = false;
  private targetZoom = 1.0;
  private targetLetterbox = 0;
  private lookAheadX = 0;
  private lookAheadY = 0;
  private bounds: CameraBounds | null = null;
  private followFreqHz = 2.6;

  private panStartX = 0;
  private panStartY = 0;
  private panStartZoom = 1;
  private panDestX = 0;
  private panDestY = 0;
  private panDestZoom = 1;
  private panElapsed = 0;
  private panDuration = 0;

  public reset(focusX: number, focusY: number, zoom = 1.0, bounds: CameraBounds | null = null): void {
    this.bounds = bounds;
    this.zoom = clamp(zoom, 0.65, 1.85);
    this.targetZoom = this.zoom;
    this.zoomVel = 0;
    this.letterbox = 0;
    this.targetLetterbox = 0;
    this.lookAheadX = 0;
    this.lookAheadY = 0;
    this.vx = 0;
    this.vy = 0;
    this.hasPrevDesired = false;
    this.mode = 'follow';
    this.panDuration = 0;
    this.panElapsed = 0;
    const clamped = this.clampCenter(focusX, focusY, this.zoom);
    this.x = clamped.x;
    this.y = clamped.y;
    this.prevDesiredX = clamped.x;
    this.prevDesiredY = clamped.y;
  }

  public setViewport(width: number, height: number): void {
    this.viewW = Math.max(160, Math.round(width));
    this.viewH = Math.max(90, Math.round(height));
  }

  public setBounds(bounds: CameraBounds | null, snap = false): void {
    this.bounds = bounds;
    if (snap) {
      const clamped = this.clampCenter(this.x, this.y, this.zoom);
      this.x = clamped.x;
      this.y = clamped.y;
      this.vx = 0;
      this.vy = 0;
    }
  }

  public setTargetZoom(zoom: number): void {
    this.targetZoom = clamp(zoom, 0.65, 1.85);
  }

  public setLetterbox(ratio: number): void {
    this.targetLetterbox = clamp(ratio, 0, 0.16);
  }

  public panTo(destX: number, destY: number, destZoom: number, durationSec: number): void {
    this.vx = 0;
    this.vy = 0;
    this.zoomVel = 0;
    this.hasPrevDesired = false;
    if (durationSec <= 0.01) {
      this.mode = 'pan';
      this.zoom = clamp(destZoom, 0.65, 1.85);
      this.targetZoom = this.zoom;
      const clamped = this.clampCenter(destX, destY, this.zoom);
      this.x = clamped.x;
      this.y = clamped.y;
      this.panDuration = 0;
      this.panElapsed = 0;
      return;
    }
    this.mode = 'pan';
    this.panStartX = this.x;
    this.panStartY = this.y;
    this.panStartZoom = this.zoom;
    this.panDestX = destX;
    this.panDestY = destY;
    this.panDestZoom = clamp(destZoom, 0.65, 1.85);
    this.targetZoom = this.panDestZoom;
    this.panElapsed = 0;
    this.panDuration = durationSec;
  }

  public resumeFollow(zoom = 1.12): void {
    this.mode = 'follow';
    this.setTargetZoom(zoom);
    this.panDuration = 0;
    this.vx = 0;
    this.vy = 0;
    this.hasPrevDesired = false;
  }

  public lockAt(centerX: number, centerY: number, zoom = 1.0): void {
    this.mode = 'lock';
    this.panTo(centerX, centerY, zoom, 0.45);
    this.mode = 'lock';
  }

  public isPanComplete(): boolean {
    return this.mode !== 'pan' || this.panDuration <= 0 || this.panElapsed >= this.panDuration;
  }

  private clampCenter(cx: number, cy: number, zoom: number): { x: number; y: number } {
    if (!this.bounds) return { x: cx, y: cy };
    const halfW = (this.viewW * 0.5) / Math.max(0.65, zoom);
    const halfH = (this.viewH * 0.5) / Math.max(0.65, zoom);
    const spanX = this.bounds.maxX - this.bounds.minX;
    const spanY = this.bounds.maxY - this.bounds.minY;

    const x =
      spanX <= halfW * 2
        ? (this.bounds.minX + this.bounds.maxX) * 0.5
        : clamp(cx, this.bounds.minX + halfW, this.bounds.maxX - halfW);
    const y =
      spanY <= halfH * 2
        ? (this.bounds.minY + this.bounds.maxY) * 0.5
        : clamp(cy, this.bounds.minY + halfH, this.bounds.maxY - halfH);
    return { x, y };
  }

  public step(dt: number, targetX: number, targetY: number, velX = 0, velY = 0): void {
    const clampedDt = Math.min(0.08, Math.max(0, dt));
    const lbBlend = 1 - Math.exp(-9.0 * clampedDt);
    this.letterbox += (this.targetLetterbox - this.letterbox) * lbBlend;

    if (this.mode === 'pan' && this.panDuration > 0) {
      this.panElapsed = Math.min(this.panDuration, this.panElapsed + clampedDt);
      const t = smoothstep01(this.panElapsed / this.panDuration);
      const rawX = this.panStartX + (this.panDestX - this.panStartX) * t;
      const rawY = this.panStartY + (this.panDestY - this.panStartY) * t;
      this.zoom = this.panStartZoom + (this.panDestZoom - this.panStartZoom) * t;
      const c = this.clampCenter(rawX, rawY, this.zoom);
      this.x = c.x;
      this.y = c.y;
      return;
    }

    stepSpringInto(this.zoom, this.zoomVel, this.targetZoom, this.targetZoom, 2.0, 1.0, 0, clampedDt, CAM_SPRING_OUT, 0);
    this.zoom = clamp(CAM_SPRING_OUT[0], 0.65, 1.85);
    this.zoomVel = CAM_SPRING_OUT[1];

    if (this.mode === 'lock') {
      const c = this.clampCenter(this.panDestX, this.panDestY, this.zoom);
      stepSpringInto(this.x, this.vx, c.x, c.x, 1.8, 1.0, 0, clampedDt, CAM_SPRING_OUT, 0);
      this.x = CAM_SPRING_OUT[0];
      this.vx = CAM_SPRING_OUT[1];
      stepSpringInto(this.y, this.vy, c.y, c.y, 1.8, 1.0, 0, clampedDt, CAM_SPRING_OUT, 0);
      this.y = CAM_SPRING_OUT[0];
      this.vy = CAM_SPRING_OUT[1];
      return;
    }

    // Look-ahead anticipates movement direction smoothly without jarring snaps
    const desiredLookX = clamp(velX * 0.22, -26, 26);
    const desiredLookY = clamp(velY * 0.16, -18, 18);
    const lookBlend = 1 - Math.exp(-4.5 * clampedDt);
    this.lookAheadX += (desiredLookX - this.lookAheadX) * lookBlend;
    this.lookAheadY += (desiredLookY - this.lookAheadY) * lookBlend;

    const desiredX = targetX + this.lookAheadX;
    const desiredY = targetY + this.lookAheadY;
    const prevDx = this.hasPrevDesired ? this.prevDesiredX : desiredX;
    const prevDy = this.hasPrevDesired ? this.prevDesiredY : desiredY;
    this.prevDesiredX = desiredX;
    this.prevDesiredY = desiredY;
    this.hasPrevDesired = true;

    // Deadzone (2.5px) at low settle speed eliminates subpixel micro-jitter when standing still
    if (Math.hypot(desiredX - this.x, desiredY - this.y) > 2.5 || Math.hypot(this.vx, this.vy) > 4.0) {
      stepSpringInto(this.x, this.vx, desiredX, prevDx, this.followFreqHz, 1.0, 0.25, clampedDt, CAM_SPRING_OUT, 0);
      this.x = CAM_SPRING_OUT[0];
      this.vx = CAM_SPRING_OUT[1];
      stepSpringInto(this.y, this.vy, desiredY, prevDy, this.followFreqHz, 1.0, 0.25, clampedDt, CAM_SPRING_OUT, 0);
      this.y = CAM_SPRING_OUT[0];
      this.vy = CAM_SPRING_OUT[1];
    } else {
      this.vx = 0;
      this.vy = 0;
    }

    const clamped = this.clampCenter(this.x, this.y, this.zoom);
    if (clamped.x !== this.x) {
      this.x = clamped.x;
      this.vx = 0;
    }
    if (clamped.y !== this.y) {
      this.y = clamped.y;
      this.vy = 0;
    }
  }

  /**
   * Produces RenderSceneSnapshot-compatible camera fields aligned to current logical viewW/viewH.
   * SceneGpuBridge derives camCenter = camera + viewSize * 0.5, keeping multi-aspect centering exact.
   */
  public toSnapshotFields(shakeX = 0, shakeY = 0): {
    cameraX: number;
    cameraY: number;
    cameraZoom: number;
    cameraLetterbox: number;
  } {
    return {
      cameraX: this.x - this.viewW * 0.5 + shakeX,
      cameraY: this.y - this.viewH * 0.5 + shakeY,
      cameraZoom: this.zoom,
      cameraLetterbox: this.letterbox,
    };
  }
}
