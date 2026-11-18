import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import { clamp, type RuntimeParams, type SimEvent } from '../../core/types/WorldTypes.ts';
import {
  CORE_BULLET_HIT_RADIUS,
  GRAZE_OVERDRIVE_COST,
  GRAZE_RADIUS,
  MAX_BOMBS,
  SECTORS,
  type PickupKind,
} from './SugarStarlightData.ts';
import {
  findNearestTarget,
  triggerGrazeOverdrive,
  type ShmupArenaState,
} from './SugarStarlightWeapons.ts';

export function onShmupWeakPointDestroyed(
  state: ShmupArenaState,
  wp: { offsetX: number; offsetY: number },
  events: SimEvent[],
): void {
  if (!state.boss) return;
  const wx = state.boss.x + wp.offsetX + 8;
  const wy = state.boss.y + wp.offsetY + 8;
  state.score += 220;
  state.juice.addTrauma(0.45);
  events.push('explode');
  state.juice.spawnBurst(wx, wy, ['#ffd447', '#ff708d', '#fffaf0'], 16, 1.0, { gravity: 0, liftY: 0 });
  const crystalKind: PickupKind = state.ship.bombs < MAX_BOMBS ? 'bomb' : 'funnel';
  state.pickups.push({ kind: crystalKind, x: wx, y: wy, vx: -44, phase: 0 });
  state.noticeText = '💥 擊毀 Boss 翼砲弱點！露出核心並掉落補給！';
  state.noticeTimer = 2.2;
  state.damageBossCore(4, events, 1.0);
}

export function damageShmupBossCore(
  state: ShmupArenaState,
  amount: number,
  events: SimEvent[],
  density: number,
  onSectorCleared: () => void,
  onCampaignWon: () => void,
): boolean {
  const boss = state.boss;
  if (!boss) return false;
  boss.hp -= amount;
  boss.flash = 0.16;
  state.score += amount * 25;
  state.juice.addTrauma(0.14);
  state.juice.addKick(-1.2, 0);

  if (boss.phase === 1 && boss.hp > 0 && boss.hp <= boss.maxHp * 0.5) {
    boss.phase = 2;
    boss.fireTimer = 0.35;
    state.juice.applyPreset('boss_phase', { dirX: -1, dirY: 0 });
    events.push('ignite');
    state.noticeText = `🔥 ${SECTORS[state.sectorIdx].bossName} 進入第 2 階段狂暴形態！`;
    state.noticeTimer = 2.6;
  }

  if (boss.hp <= 0) {
    state.score += 650 + state.sectorIdx * 200;
    state.juice.applyPreset('explosion', { intensity: 1.35 });
    state.juice.spawnBurst(
      boss.x + 16,
      boss.y + 8,
      ['#ffd447', '#56d39c', '#ff708d', '#5ec2f7'],
      28,
      density,
      { gravity: 0, liftY: 0 },
    );
    state.boss = null;
    if (state.sectorIdx + 1 < SECTORS.length) {
      state.ship.hearts = Math.min(state.ship.maxHearts, state.ship.hearts + 1);
      events.push('key');
      onSectorCleared();
    } else {
      onCampaignWon();
      events.push('win');
    }
    return true;
  }
  return false;
}

export function updateShmupBoss(state: ShmupArenaState, simDt: number, events: SimEvent[]): void {
  const boss = state.boss;
  if (!boss) return;
  if (boss.flash > 0) boss.flash = Math.max(0, boss.flash - simDt * 7);
  for (const wp of boss.weakPoints) {
    if (wp.flash > 0) wp.flash = Math.max(0, wp.flash - simDt * 7);
  }

  if (boss.x > 256) {
    boss.x -= 48 * simDt;
  }
  const waveSpeed = (boss.phase === 2 ? 2.45 : 1.65) + state.sectorIdx * 0.22;
  boss.y = 78 + Math.sin(state.juice.visualTime * waveSpeed) * 44;

  boss.fireTimer -= simDt;
  if (boss.fireTimer <= 0) {
    boss.patternStep++;
    const baseCd = boss.phase === 2 ? 0.54 : 0.96;
    boss.fireTimer = Math.max(0.42, baseCd - state.sectorIdx * 0.08);

    if (boss.phase === 1) {
      const spread = state.sectorIdx >= 2 ? [-42, -14, 14, 42] : [-30, 0, 30];
      for (const dy of spread) {
        state.bullets.push({
          x: boss.x,
          y: boss.y + 8,
          vx: -(118 + state.sectorIdx * 12),
          vy: dy,
          fromEnemy: true,
          damage: 1,
          color: '#ff708d',
        });
      }
    } else if (boss.patternStep % 2 === 0) {
      for (let a = -2; a <= 2; a++) {
        const dy = a * 26 + Math.sin(boss.patternStep) * 18;
        state.bullets.push({
          x: boss.x,
          y: boss.y + 8,
          vx: -(128 + state.sectorIdx * 10),
          vy: dy,
          fromEnemy: true,
          damage: 1,
          color: '#e0aaff',
        });
      }
    } else {
      const dx = state.ship.x - boss.x;
      const dy = state.ship.y - boss.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      for (const offset of [-18, 0, 18]) {
        state.bullets.push({
          x: boss.x,
          y: boss.y + 8,
          vx: (dx / len) * 138,
          vy: (dy / len) * 138 + offset,
          fromEnemy: true,
          damage: 1,
          color: '#ffd447',
        });
      }
    }
  }

  for (const wp of boss.weakPoints) {
    if (wp.hp <= 0) continue;
    wp.fireTimer -= simDt;
    if (wp.fireTimer <= 0) {
      wp.fireTimer = boss.phase === 2 ? 1.25 : 1.7;
      const wx = boss.x + wp.offsetX;
      const wy = boss.y + wp.offsetY + 6;
      const dx = state.ship.x - wx;
      const dy = state.ship.y - wy;
      const len = Math.max(1, Math.hypot(dx, dy));
      state.bullets.push({
        x: wx,
        y: wy,
        vx: (dx / len) * (105 + state.sectorIdx * 8),
        vy: (dy / len) * (105 + state.sectorIdx * 8),
        fromEnemy: true,
        damage: 1,
        color: '#ffae42',
      });
    }
  }
  void events;
}

export function stepShmupBullets(
  state: ShmupArenaState,
  simDt: number,
  events: SimEvent[],
  params: RuntimeParams,
): boolean {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    if (!b) continue;

    if (!b.fromEnemy && b.homing) {
      const tgt = findNearestTarget(state, b.x, b.y);
      if (tgt) {
        const desired = Math.atan2(tgt.y - b.y, tgt.x - b.x);
        const cur = Math.atan2(b.vy, b.vx);
        let diff = desired - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = (b.turnRate ?? 5.5) * simDt;
        const nextAng = cur + clamp(diff, -maxTurn, maxTurn);
        const spd = b.speed ?? 230;
        b.vx = Math.cos(nextAng) * spd;
        b.vy = Math.sin(nextAng) * spd;
      }
    }

    b.x += b.vx * simDt;
    b.y += b.vy * simDt;
    if (b.x < -28 || b.x > GAME_W + 32 || b.y < -18 || b.y > GAME_H + 18) {
      state.bullets.splice(i, 1);
      continue;
    }

    if (b.fromEnemy) {
      const dist = Math.hypot(state.ship.x + 8 - b.x, state.ship.y + 8 - b.y);
      if (state.ship.overdriveShieldTimer > 0 && dist < GRAZE_RADIUS + 4) {
        state.bullets.splice(i, 1);
        state.score += 15;
        state.juice.spawnBurst(b.x, b.y, ['#5ec2f7', '#ffd447'], 3, params.sparkleDensity, { gravity: 0, liftY: 0 });
        continue;
      }
      if (state.ship.invulnTimer <= 0 && dist < CORE_BULLET_HIT_RADIUS) {
        state.bullets.splice(i, 1);
        state.damageShip(events, 0.5, 0.25, ['#ff708d', '#ffd447'], 8, params.sparkleDensity);
      } else if (!b.grazed && dist < GRAZE_RADIUS) {
        b.grazed = true;
        state.ship.grazeCount++;
        state.ship.grazeMeter = Math.min(GRAZE_OVERDRIVE_COST, state.ship.grazeMeter + 10);
        state.score += 20;
        if (state.input.held('action')) {
          state.ship.chargeSec += 0.08;
        }
        events.push('snap');
        state.juice.spawnBurst(state.ship.x + 8, state.ship.y + 8, ['#5ec2f7', '#fffaf0'], 4, params.sparkleDensity, {
          gravity: 0,
          liftY: 0,
        });
        if (state.ship.grazeMeter >= GRAZE_OVERDRIVE_COST) {
          triggerGrazeOverdrive(state, events, params.sparkleDensity);
        }
      }
      continue;
    }

    if (b.clearsBullets) {
      for (let k = state.bullets.length - 1; k >= 0; k--) {
        if (k === i) continue;
        const eb = state.bullets[k];
        if (!eb.fromEnemy) continue;
        if (Math.abs(eb.x - b.x) < 15 && Math.abs(eb.y - b.y) < 12) {
          state.bullets.splice(k, 1);
          if (k < i) i--;
          state.score += 10;
          state.juice.spawnBurst(eb.x, eb.y, ['#8ce8ff', '#fffaf0'], 3, params.sparkleDensity, {
            gravity: 0,
            liftY: 0,
            speedMin: 14,
            speedMax: 42,
          });
        }
      }
    }

    let hit = false;
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j];
      if (b.hitIds?.has(e.id)) continue;
      if (Math.hypot(b.x - (e.x + 8), b.y - (e.y + 8)) < (b.piercing ? 16 : 12)) {
        hit = true;
        b.hitIds?.add(e.id);
        e.hp -= b.damage;
        e.flashTimer = 0.16;
        if (e.hp <= 0) {
          state.destroyEnemy(j, events, params.sparkleDensity);
        }
        if (!b.piercing) break;
      }
    }

    const boss = state.boss;
    if (boss) {
      for (const wp of boss.weakPoints) {
        if (wp.hp <= 0 || (hit && !b.piercing) || b.hitIds?.has(wp.id)) continue;
        const wx = boss.x + wp.offsetX + 8;
        const wy = boss.y + wp.offsetY + 6;
        if (Math.hypot(b.x - wx, b.y - wy) < 12) {
          hit = true;
          b.hitIds?.add(wp.id);
          wp.hp = Math.max(0, wp.hp - b.damage);
          wp.flash = 0.18;
          state.score += 30;
          state.juice.spawnBurst(b.x, b.y, ['#ffd447', '#ffae42', '#fffaf0'], 5, params.sparkleDensity, {
            gravity: 0,
            liftY: 0,
          });
          if (wp.hp === 0) {
            state.onWeakPointDestroyed(wp, events);
          }
          if (!b.piercing) break;
        }
      }

      const bossKey = `boss-${state.sectorIdx}`;
      if (
        state.boss &&
        (!hit || b.piercing) &&
        !b.hitIds?.has(bossKey) &&
        b.x > state.boss.x - 4 &&
        b.x < state.boss.x + 34 &&
        Math.abs(b.y - (state.boss.y + 8)) < 15
      ) {
        hit = true;
        b.hitIds?.add(bossKey);
        state.juice.spawnBurst(b.x, b.y, ['#ff708d', '#ffd447', '#fffaf0'], 5, params.sparkleDensity, {
          gravity: 0,
          liftY: 0,
        });
        if (state.damageBossCore(b.damage, events, params.sparkleDensity)) {
          return true;
        }
      }
    }

    if (hit && !b.piercing) state.bullets.splice(i, 1);
  }
  return false;
}
