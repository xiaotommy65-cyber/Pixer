import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { SeededRng } from '../runtime/SeededRng.ts';
import type { FeedbackPreset, ParticleDesc, SimEvent } from '../types/WorldTypes.ts';

export interface SquashSpring {
  scaleX: number;
  scaleY: number;
}

export interface FeedbackRecipe {
  hitstop: number;
  trauma: number;
  kickMag: number;
  flashColor?: string;
  flashAlpha?: number;
  sound?: SimEvent;
  haptic?: 'tap' | 'click' | 'thump' | 'impact' | 'celebrate';
}

export const FEEDBACK_RECIPES: Record<FeedbackPreset, FeedbackRecipe> = {
  ui_press: { hitstop: 0, trauma: 0, kickMag: 0, sound: 'snap', haptic: 'tap' },
  light_hit: { hitstop: 0.025, trauma: 0.16, kickMag: 1.6, flashColor: '#fffaf0', flashAlpha: 0.08, sound: 'stomp', haptic: 'click' },
  heavy_kill: { hitstop: 0.055, trauma: 0.36, kickMag: 3.2, flashColor: '#ffd447', flashAlpha: 0.16, sound: 'explode', haptic: 'impact' },
  charge_shot: { hitstop: 0.035, trauma: 0.28, kickMag: 4.5, flashColor: '#8ce8ff', flashAlpha: 0.12, sound: 'rail', haptic: 'thump' },
  dash_kick: { hitstop: 0, trauma: 0.08, kickMag: 2.2, sound: 'snap', haptic: 'tap' },
  boss_phase: { hitstop: 0.06, trauma: 0.55, kickMag: 4.0, flashColor: '#ff708d', flashAlpha: 0.26, sound: 'ignite', haptic: 'impact' },
  player_hurt: { hitstop: 0.055, trauma: 0.48, kickMag: 4.2, flashColor: '#ff708d', flashAlpha: 0.28, sound: 'hurt', haptic: 'impact' },
  explosion: { hitstop: 0.065, trauma: 0.58, kickMag: 4.8, flashColor: '#fffaf0', flashAlpha: 0.28, sound: 'explode', haptic: 'impact' },
  relic_burst: { hitstop: 0.04, trauma: 0.34, kickMag: 3.0, flashColor: '#5ec2f7', flashAlpha: 0.2, sound: 'ignite', haptic: 'thump' },
};

/**
 * Shared game-feel / juice orchestrator implementing:
 * - Multi-clock Hitstop (freezes sim step while visual decay, directional kick, & shake continue)
 * - Directional exponential recoil kick (kickX, kickY)
 * - Trauma^2 multi-frequency harmonic camera shake with 0.65x vertical comfort damping
 * - Semantic feedback recipe execution + shared particle burst & converge pools
 */
export class JuiceSystem {
  public visualTime = 0;
  public hitstopTimer = 0;
  public trauma = 0;
  public kickX = 0;
  public kickY = 0;
  public shakeX = 0;
  public shakeY = 0;
  public flashAlpha = 0;
  public flashColor = '#fffaf0';
  public comboCount = 0;
  private comboTimer = 0;

  public readonly particles: ParticleDesc[] = [];
  private readonly rng = new SeededRng(0xcafe1234);

  public triggerHitstop(durationSec: number): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, Math.min(0.14, durationSec));
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  public addKick(dx: number, dy: number): void {
    this.kickX = Math.max(-14, Math.min(14, this.kickX + dx));
    this.kickY = Math.max(-14, Math.min(14, this.kickY + dy));
  }

  public triggerFlash(colorHex: string, alpha: number): void {
    if (alpha >= this.flashAlpha) {
      this.flashColor = colorHex;
      this.flashAlpha = Math.min(0.4, alpha);
    }
  }

  public registerCombo(): number {
    this.comboCount = Math.min(12, this.comboCount + 1);
    this.comboTimer = 2.0;
    return this.comboCount;
  }

  public reset(): void {
    this.hitstopTimer = 0;
    this.trauma = 0;
    this.kickX = 0;
    this.kickY = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.flashAlpha = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.particles.length = 0;
  }

  public applyPreset(
    preset: FeedbackPreset,
    opts?: {
      dirX?: number;
      dirY?: number;
      intensity?: number;
      onRecipe?: (recipe: FeedbackRecipe, intensity: number) => void;
    },
  ): FeedbackRecipe {
    const recipe = FEEDBACK_RECIPES[preset];
    const intensity = Math.max(0.2, Math.min(2.0, opts?.intensity ?? 1.0));
    if (recipe.hitstop > 0) this.triggerHitstop(recipe.hitstop * Math.min(1.35, intensity));
    if (recipe.trauma > 0) this.addTrauma(recipe.trauma * intensity);
    if (recipe.flashColor && recipe.flashAlpha) {
      this.triggerFlash(recipe.flashColor, recipe.flashAlpha * Math.min(1.25, intensity));
    }
    if (recipe.kickMag > 0) {
      const dx = opts?.dirX ?? 0;
      const dy = opts?.dirY ?? 0;
      const len = Math.hypot(dx, dy);
      if (len > 0.001) {
        this.addKick((dx / len) * recipe.kickMag * intensity, (dy / len) * recipe.kickMag * intensity);
      } else {
        this.addKick(-recipe.kickMag * 0.45 * intensity, 0);
      }
    }
    opts?.onRecipe?.(recipe, intensity);
    return recipe;
  }

  /**
   * Advances real-time juice clocks (always runs even during Hitstop) and
   * returns the simulation delta time (`0` while Hitstop is active).
   */
  public advanceRealTime(dt: number, shakeScale = 1.0): number {
    this.visualTime += dt;

    // Exponential decay on directional recoil kick
    const kickDecay = Math.exp(-18 * dt);
    this.kickX *= kickDecay;
    this.kickY *= kickDecay;
    if (Math.abs(this.kickX) < 0.01) this.kickX = 0;
    if (Math.abs(this.kickY) < 0.01) this.kickY = 0;

    // Trauma^2 multi-frequency harmonic shake offset with 0.65x vertical comfort damping
    const scale = Math.max(0, shakeScale);
    let oscX = 0;
    let oscY = 0;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
      const mag = this.trauma * this.trauma * 7.5 * scale;
      oscX = (Math.sin(this.visualTime * 57.3) * 0.7 + Math.cos(this.visualTime * 119.7) * 0.3) * mag;
      oscY = (Math.cos(this.visualTime * 71.1) * 0.7 + Math.sin(this.visualTime * 137.3) * 0.3) * mag * 0.65;
    }
    this.shakeX = oscX + this.kickX * scale;
    this.shakeY = oscY + this.kickY * scale * 0.8;

    if (this.flashAlpha > 0) {
      this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.6);
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboCount = 0;
    }

    // Update visual particles smoothly even during hitstop freeze
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.targetX !== undefined && p.targetY !== undefined) {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= (p.convergeSnapRadius ?? 2.8)) {
          this.particles.splice(i, 1);
          continue;
        }
        const pull = p.pull ?? 380;
        p.vx += (dx / dist) * pull * dt;
        p.vy += (dy / dist) * pull * dt;
        if (p.damping && p.damping > 0) {
          const damp = Math.max(0, 1 - p.damping * dt);
          p.vx *= damp;
          p.vy *= damp;
        }
      } else {
        p.vy += (p.gravity ?? 0) * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vRot * dt;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      return 0;
    }
    return dt;
  }

  private trimPool(limit = 180): void {
    if (this.particles.length > limit) {
      this.particles.splice(0, this.particles.length - limit);
    }
  }

  public spawnBurst(
    x: number,
    y: number,
    colors: readonly string[],
    count: number,
    density = 1,
    opts?: {
      speedMin?: number;
      speedMax?: number;
      gravity?: number;
      liftY?: number;
      sprite?: SpriteId;
      additive?: boolean;
      sizeMin?: number;
      sizeMax?: number;
    },
  ): void {
    const actual = Math.max(2, Math.round(count * density));
    const spdMin = opts?.speedMin ?? 28;
    const spdMax = opts?.speedMax ?? 90;
    const grav = opts?.gravity ?? 150;
    const liftY = opts?.liftY ?? -22;

    for (let i = 0; i < actual; i++) {
      const ang = (Math.PI * 2 * i) / actual + this.rng.range(-0.35, 0.35);
      const spd = this.rng.range(spdMin, spdMax);
      const useSprite = opts?.sprite ?? (i % 3 === 0 ? 'sparkle' : undefined);
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd + liftY,
        life: 0,
        maxLife: this.rng.range(0.32, 0.68),
        size: useSprite ? this.rng.range(opts?.sizeMin ?? 5, opts?.sizeMax ?? 8) : this.rng.range(2, 4),
        color: colors[i % colors.length],
        rot: this.rng.range(0, Math.PI * 2),
        vRot: (i % 2 === 0 ? 1 : -1) * this.rng.range(3, 7),
        sprite: useSprite,
        additive: opts?.additive ?? Boolean(useSprite),
        gravity: grav,
      });
    }
    this.trimPool();
  }

  /**
   * Spawns inward-spiraling particles pulled toward (targetX, targetY) — ideal for charge skills.
   */
  public spawnConverge(
    targetX: number,
    targetY: number,
    colors: readonly string[],
    count: number,
    density = 1,
    opts?: {
      radiusMin?: number;
      radiusMax?: number;
      pull?: number;
      swirlSpeed?: number;
      maxLife?: number;
      sprite?: SpriteId;
      sizeMin?: number;
      sizeMax?: number;
      snapRadius?: number;
    },
  ): void {
    const actual = Math.max(1, Math.round(count * Math.max(0.35, density)));
    const rMin = opts?.radiusMin ?? 18;
    const rMax = opts?.radiusMax ?? 34;
    const pull = opts?.pull ?? 460;
    const swirl = opts?.swirlSpeed ?? 34;
    const maxLife = opts?.maxLife ?? 0.32;

    for (let i = 0; i < actual; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(rMin, rMax);
      const px = targetX + Math.cos(ang) * r;
      const py = targetY + Math.sin(ang) * r;
      const tangentDir = i % 2 === 0 ? 1 : -1;
      const useSprite = opts?.sprite;
      this.particles.push({
        x: px,
        y: py,
        vx: -Math.cos(ang) * 28 - Math.sin(ang) * swirl * tangentDir,
        vy: -Math.sin(ang) * 28 + Math.cos(ang) * swirl * tangentDir,
        life: 0,
        maxLife,
        size: useSprite ? this.rng.range(opts?.sizeMin ?? 4, opts?.sizeMax ?? 7) : this.rng.range(1.6, 3.0),
        color: colors[i % colors.length],
        rot: ang,
        vRot: tangentDir * 5,
        sprite: useSprite,
        additive: true,
        targetX,
        targetY,
        pull,
        damping: 3.2,
        convergeSnapRadius: opts?.snapRadius ?? 3,
      });
    }
    this.trimPool();
  }
}

export function stepSquashSpring(spring: SquashSpring, dt: number, speed = 13): void {
  const blend = Math.min(1, dt * speed);
  spring.scaleX += (1 - spring.scaleX) * blend;
  spring.scaleY += (1 - spring.scaleY) * blend;
}
