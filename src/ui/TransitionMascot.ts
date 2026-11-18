import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import { atlasSpriteToCanvas } from './MomoMascot.ts';
import { el } from './dom.ts';

export type TransitionMascotAction = 'dash_run' | 'power_slide' | 'acro_jump' | 'cheer_wave';

const ACTIONS: readonly TransitionMascotAction[] = [
  'dash_run',
  'power_slide',
  'acro_jump',
  'cheer_wave',
];

/**
 * Renders randomized crisp 16x16 pixel Momo mascot performances on the Iris Wipe curtain:
 * dash_run, power_slide, acro_jump, and cheer_wave (never repeating the same action twice in a row).
 */
export class TransitionMascot {
  public readonly element: HTMLCanvasElement;

  private readonly atlas: TextureAtlas;
  private readonly spriteCache = new Map<SpriteId, HTMLCanvasElement>();
  private rafId = 0;
  private startMs = 0;
  private durationMs = 620;
  private activeAction: TransitionMascotAction = 'dash_run';
  private lastAction: TransitionMascotAction | null = null;
  private playing = false;

  constructor(atlas: TextureAtlas) {
    this.atlas = atlas;
    this.element = el('canvas', 'transition-mascot-canvas');
    this.element.width = 240;
    this.element.height = 120;
    this.element.setAttribute('aria-hidden', 'true');
  }

  public startRandom(durationMs = 640): TransitionMascotAction {
    this.stop();
    const candidates = this.lastAction ? ACTIONS.filter((a) => a !== this.lastAction) : ACTIONS;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)] ?? 'dash_run';
    this.activeAction = chosen;
    this.lastAction = chosen;
    this.durationMs = Math.max(240, durationMs);
    this.startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.playing = true;
    this.element.classList.add('is-visible');
    this.renderAt(0);

    if (typeof requestAnimationFrame === 'function') {
      const tick = (now: number) => {
        if (!this.playing) return;
        const t = Math.min(1, Math.max(0, (now - this.startMs) / this.durationMs));
        this.renderAt(t);
        if (t < 1) {
          this.rafId = requestAnimationFrame(tick);
        }
      };
      this.rafId = requestAnimationFrame(tick);
    }
    return chosen;
  }

  public stop(): void {
    this.playing = false;
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = 0;
    this.element.classList.remove('is-visible');
    const ctx = this.element.getContext('2d');
    ctx?.clearRect(0, 0, this.element.width, this.element.height);
  }

  private getSprite(id: SpriteId): HTMLCanvasElement {
    let cached = this.spriteCache.get(id);
    if (!cached) {
      cached = atlasSpriteToCanvas(this.atlas, id);
      this.spriteCache.set(id, cached);
    }
    return cached;
  }

  private renderAt(t: number): void {
    const ctx = this.element.getContext('2d');
    if (!ctx) return;
    const cw = this.element.width;
    const ch = this.element.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;

    const size = 48;
    const groundY = ch - 18;
    const fade = t < 0.14 ? t / 0.14 : t > 0.84 ? Math.max(0, (1 - t) / 0.16) : 1;
    ctx.save();
    ctx.globalAlpha = fade;

    // Soft pixel ground shadow beneath Momo
    let cx = cw * 0.5;
    let cy = groundY - size * 0.5;
    let scaleX = 1;
    let scaleY = 1;
    let rot = 0;
    let spriteId: SpriteId = 'momo_idle';

    if (this.activeAction === 'dash_run') {
      cx = -24 + t * (cw + 48);
      const stride = Math.sin(t * Math.PI * 8);
      cy = groundY - size * 0.5 - Math.abs(stride) * 10;
      spriteId = stride >= 0 ? 'momo_run_a' : 'momo_run_b';
      scaleX = 1.06;
      scaleY = 0.94;
      this.drawDustTrail(ctx, cx - 22, groundY - 6, t);
    } else if (this.activeAction === 'power_slide') {
      const eased = 1 - Math.pow(1 - t, 3);
      cx = 20 + eased * (cw - 76);
      if (t < 0.72) {
        spriteId = 'momo_slide';
        cy = groundY - size * 0.42;
        scaleX = 1.14;
        scaleY = 0.88;
        this.drawDustTrail(ctx, cx - 26, groundY - 5, t);
      } else {
        const pop = (t - 0.72) / 0.28;
        spriteId = 'momo_happy';
        cy = groundY - size * 0.5 - Math.sin(pop * Math.PI) * 12;
        this.drawSparkleBurst(ctx, cx + 14, cy - 16, pop);
      }
    } else if (this.activeAction === 'acro_jump') {
      cx = cw * 0.28 + t * (cw * 0.44);
      const arc = Math.sin(t * Math.PI);
      cy = groundY - size * 0.5 - arc * 52;
      if (t < 0.78) {
        spriteId = 'momo_jump';
        rot = t > 0.15 && t < 0.65 ? ((t - 0.15) / 0.5) * Math.PI * 2 : 0;
        scaleX = 0.94;
        scaleY = 1.08;
      } else {
        const land = (t - 0.78) / 0.22;
        spriteId = 'momo_happy';
        scaleX = 1 + Math.sin(land * Math.PI) * 0.18;
        scaleY = 1 - Math.sin(land * Math.PI) * 0.16;
        this.drawSparkleBurst(ctx, cx, groundY - 8, land);
      }
    } else {
      // cheer_wave
      const pop = Math.min(1, t / 0.25);
      const bounce = Math.sin(pop * Math.PI * 0.5);
      cy = groundY - size * 0.5 - (1 - bounce) * 28 - Math.abs(Math.sin(t * Math.PI * 4)) * 5;
      spriteId = Math.floor(t * 7) % 2 === 0 ? 'momo_wave_a' : 'momo_wave_b';
      if (t > 0.28) {
        this.drawSparkleBurst(ctx, cx + 22, cy - 22, (t - 0.28) / 0.72);
      }
    }

    const shadowScale = Math.max(0.38, 1 - Math.max(0, groundY - size * 0.5 - cy) / 72);
    ctx.fillStyle = 'rgba(26, 18, 22, 0.34)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY - 2, 18 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    if (rot !== 0) ctx.rotate(rot);
    ctx.scale(scaleX, scaleY);
    const img = this.getSprite(spriteId);
    ctx.drawImage(img, -size * 0.5, -size * 0.5, size, size);
    ctx.restore();

    ctx.restore();
  }

  private drawDustTrail(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    const cloud = this.getSprite('sparkle');
    for (let i = 0; i < 3; i++) {
      const phase = (t * 4 + i * 0.33) % 1;
      const px = x - phase * 22;
      const py = y - Math.sin(phase * Math.PI) * 10;
      const s = Math.max(6, Math.round(14 * (1 - phase)));
      ctx.save();
      ctx.globalAlpha *= 1 - phase;
      ctx.drawImage(cloud, px - s * 0.5, py - s * 0.5, s, s);
      ctx.restore();
    }
  }

  private drawSparkleBurst(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number): void {
    const sp = this.getSprite('sparkle');
    const s = Math.round(14 + Math.sin(progress * Math.PI) * 8);
    ctx.drawImage(sp, x - s * 0.5, y - progress * 12 - s * 0.5, s, s);
  }

  public destroy(): void {
    this.stop();
    this.spriteCache.clear();
  }
}
