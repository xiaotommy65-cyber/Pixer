import { GAME_H, GAME_W } from '../gpu/GpuTypes.ts';
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

/**
 * Engine 2.0 CameraDirector:
 * manages smooth target tracking, directional velocity look-ahead, dynamic zoom,
 * room/chapter boundary clamping, scripted cutscene panning, and widescreen letterbox bars.
 */
export class CameraDirector {
  public x = GAME_W * 0.5;
  public y = GAME_H * 0.5;
  public zoom = 1.0;
  public letterbox = 0;
  public mode: CameraDirectorMode = 'follow';

  private targetZoom = 1.0;
  private targetLetterbox = 0;
  private lookAheadX = 0;
  private lookAheadY = 0;
  private bounds: CameraBounds | null = null;
  private followDamp = 8.5;

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
    this.letterbox = 0;
    this.targetLetterbox = 0;
    this.lookAheadX = 0;
    this.lookAheadY = 0;
    this.mode = 'follow';
    this.panDuration = 0;
    this.panElapsed = 0;
    const clamped = this.clampCenter(focusX, focusY, this.zoom);
    this.x = clamped.x;
    this.y = clamped.y;
  }

  public setBounds(bounds: CameraBounds | null): void {
    this.bounds = bounds;
  }

  public setTargetZoom(zoom: number): void {
    this.targetZoom = clamp(zoom, 0.65, 1.85);
  }

  public setLetterbox(ratio: number): void {
    this.targetLetterbox = clamp(ratio, 0, 0.16);
  }

  public panTo(destX: number, destY: number, destZoom: number, durationSec: number): void {
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
    const halfW = (GAME_W * 0.5) / Math.max(0.65, zoom);
    const halfH = (GAME_H * 0.5) / Math.max(0.65, zoom);
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
    const zoomBlend = 1 - Math.exp(-6.5 * clampedDt);
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

    this.zoom += (this.targetZoom - this.zoom) * zoomBlend;

    if (this.mode === 'lock') {
      const c = this.clampCenter(this.panDestX, this.panDestY, this.zoom);
      const posBlend = 1 - Math.exp(-5.0 * clampedDt);
      this.x += (c.x - this.x) * posBlend;
      this.y += (c.y - this.y) * posBlend;
      return;
    }

    // Look-ahead anticipates movement direction subtly without jarring snaps
    const desiredLookX = clamp(velX * 0.22, -26, 26);
    const desiredLookY = clamp(velY * 0.16, -18, 18);
    const lookBlend = 1 - Math.exp(-4.5 * clampedDt);
    this.lookAheadX += (desiredLookX - this.lookAheadX) * lookBlend;
    this.lookAheadY += (desiredLookY - this.lookAheadY) * lookBlend;

    const desiredX = targetX + this.lookAheadX;
    const desiredY = targetY + this.lookAheadY;
    const posBlend = 1 - Math.exp(-this.followDamp * clampedDt);

    // Deadzone (3px) eliminates subpixel micro-jitter when standing still
    if (Math.hypot(desiredX - this.x, desiredY - this.y) > 2.5) {
      this.x += (desiredX - this.x) * posBlend;
      this.y += (desiredY - this.y) * posBlend;
    }

    const clamped = this.clampCenter(this.x, this.y, this.zoom);
    this.x = clamped.x;
    this.y = clamped.y;
  }

  /**
   * Produces RenderSceneSnapshot-compatible camera fields centered cleanly around (this.x, this.y).
   * SceneGpuBridge derives camCenterX = cameraX + GAME_W * 0.5, preserving full compatibility.
   */
  public toSnapshotFields(shakeX = 0, shakeY = 0): {
    cameraX: number;
    cameraY: number;
    cameraZoom: number;
    cameraLetterbox: number;
  } {
    return {
      cameraX: this.x - GAME_W * 0.5 + shakeX,
      cameraY: this.y - GAME_H * 0.5 + shakeY,
      cameraZoom: this.zoom,
      cameraLetterbox: this.letterbox,
    };
  }
}
