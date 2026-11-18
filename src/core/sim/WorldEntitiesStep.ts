import type { RuntimeParams } from '../types/WorldTypes.ts';
import {
  activateSwitchPad,
  destroyFragile,
  primeExplosive,
  rectsOverlap,
  type RuleWorldActions,
} from './RuleMatrix.ts';
import type { WorldKernel } from './WorldKernel.ts';

export function detonateInWorld(
  world: WorldKernel,
  cx: number,
  cy: number,
  radius: number,
  sourceId: string,
  actions: RuleWorldActions,
): void {
  actions.emit('explode');
  world.juice.applyPreset('explosion', { dirX: 0, dirY: -1, intensity: 1.0 });
  actions.spawnBurst(cx, cy, ['#ffd447', '#ff708d', '#fffaf0', '#f59b23'], 18);

  for (const other of world.entities) {
    if (!other.alive || other.id === sourceId) continue;
    const dx = other.x + other.w * 0.5 - cx;
    const dy = other.y + other.h * 0.5 - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) continue;

    if (other.tags.has('explosive') && primeExplosive(other, actions, 0.14)) continue;
    if (other.tags.has('switch') && activateSwitchPad(other, actions, 8)) continue;
    if (other.tags.has('fragile')) {
      destroyFragile(other, actions, 10);
    } else if (other.tags.has('pushable')) {
      const inv = dist > 1 ? 1 / dist : 1;
      other.vx += dx * inv * 140;
      other.vy -= 140;
    }
  }

  // Gentle playful knockback on hero without cheap insta-death
  const hdx = world.hero.x + 8 - cx;
  const hdy = world.hero.y + 8 - cy;
  const hdist = Math.hypot(hdx, hdy);
  if (hdist < radius * 0.85) {
    const inv = hdist > 1 ? 1 / hdist : 1;
    world.hero.vx = hdx * inv * 140;
    world.hero.vy = Math.min(world.hero.vy, -155);
    world.hero.squash = { scaleX: 1.25, scaleY: 0.78 };
  }
}

export function stepMovingPlatformsInWorld(world: WorldKernel, dt: number): void {
  for (const mp of world.movingPlatforms) {
    mp.prevX = mp.x;
    mp.prevY = mp.y;
    if (mp.vx !== 0) {
      mp.x += mp.vx * dt;
      if (mp.x <= mp.minX) {
        mp.x = mp.minX;
        mp.vx = Math.abs(mp.vx);
      } else if (mp.x >= mp.maxX) {
        mp.x = mp.maxX;
        mp.vx = -Math.abs(mp.vx);
      }
    }
    if (mp.vy !== 0) {
      mp.y += mp.vy * dt;
      if (mp.y <= mp.minY) {
        mp.y = mp.minY;
        mp.vy = Math.abs(mp.vy);
      } else if (mp.y >= mp.maxY) {
        mp.y = mp.maxY;
        mp.vy = -Math.abs(mp.vy);
      }
    }
  }
}

export function stepEntitiesInWorld(
  world: WorldKernel,
  dt: number,
  params: RuntimeParams,
  actions: RuleWorldActions,
): void {
  for (const e of world.entities) {
    if (!e.alive) continue;

    if (e.fuseTimer !== undefined) {
      e.fuseTimer -= dt;
      if (e.fuseTimer < 0.45 && Math.floor(world.juice.visualTime * 18) % 2 === 0) {
        e.flashTimer = Math.max(e.flashTimer, 0.45);
      }
      if (e.fuseTimer <= 0) {
        if (e.tags.has('explosive')) {
          e.alive = false;
          actions.detonateAt(e.x + 8, e.y + 8, 42, e.id);
          continue;
        }
        if (e.tags.has('burning')) {
          e.alive = false;
          actions.addScore(40);
          actions.spawnBurst(e.x + 8, e.y + 8, ['#ff9048', '#ffd447', '#382820'], 10);
          continue;
        }
      }
    }

    if (e.patrolVx && e.minX !== undefined && e.maxX !== undefined) {
      e.x += e.vx * dt;
      if (e.x < e.minX) {
        e.x = e.minX;
        e.vx = Math.abs(e.vx);
      } else if (e.x > e.maxX) {
        e.x = e.maxX;
        e.vx = -Math.abs(e.vx);
      }
      e.flipX = e.vx < 0;
    } else if (e.tags.has('pushable')) {
      e.x = Math.max(0, Math.min(world.worldW - e.w, e.x + e.vx * dt));
      if (e.friction > 0) {
        e.vx = e.vx > 0 ? Math.max(0, e.vx - e.friction * dt) : Math.min(0, e.vx + e.friction * dt);
      }
    }

    if (e.hasGravity) {
      e.vy = Math.min(320, e.vy + 540 * params.gravityScale * dt);
      const prevBottom = e.y + e.h;
      e.y += e.vy * dt;

      for (const s of world.solids) {
        if (e.x + e.w - 2 <= s.x || e.x + 2 >= s.x + s.w) continue;
        const topHit = s.kind === 'cloud' ? prevBottom <= s.y + 5 : e.y < s.y + s.h;
        if (e.vy >= 0 && topHit && e.y + e.h >= s.y) {
          e.y = s.y - e.h;
          e.vy = 0;
        }
      }
      for (const other of world.entities) {
        if (!other.alive || other.id === e.id || !other.tags.has('solid')) continue;
        if (e.x + e.w - 2 <= other.x || e.x + 2 >= other.x + other.w) continue;
        if (e.vy >= 0 && prevBottom <= other.y + 6 && e.y + e.h >= other.y) {
          e.y = other.y - e.h;
          e.vy = 0;
        }
      }
    }
  }

  for (let i = 0; i < world.entities.length; i++) {
    const a = world.entities[i];
    if (!a.alive) continue;
    for (let j = 0; j < world.entities.length; j++) {
      if (i === j) continue;
      const b = world.entities[j];
      if (!b.alive || !rectsOverlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h, 1)) continue;
      world.rules.evaluatePair(a, b, actions, dt);
    }
  }
}
