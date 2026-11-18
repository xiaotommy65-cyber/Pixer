import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import { clamp, type RuntimeParams, type SimEvent } from '../../core/types/WorldTypes.ts';
import {
  CORE_ENEMY_HIT_RADIUS,
  MAX_BOMBS,
  SECTORS,
  WEAPON_CATALOG,
  type EnemyKind,
  type PickupKind,
  type WeaponKind,
  type WeaponLevel,
} from './SugarStarlightData.ts';
import type { ShmupArenaState } from './SugarStarlightWeapons.ts';

export function spawnShmupWave(state: ShmupArenaState): void {
  const sector = SECTORS[state.sectorIdx];
  state.waveIndex++;
  if (state.waveIndex > sector.waveCount) {
    state.boss = {
      x: 342,
      y: 78,
      hp: sector.bossHp,
      maxHp: sector.bossHp,
      phase: 1,
      fireTimer: 0.85,
      patternStep: 0,
      flash: 0,
      weakPoints: [
        { id: 'wp-top', offsetX: -4, offsetY: -18, hp: sector.weakPointHp, maxHp: sector.weakPointHp, fireTimer: 1.2, flash: 0 },
        { id: 'wp-bot', offsetX: -4, offsetY: 20, hp: sector.weakPointHp, maxHp: sector.weakPointHp, fireTimer: 1.5, flash: 0 },
      ],
    };
    state.noticeText = `⚠️ ${sector.bossName} 警報！先破壞上下弱點砲台！`;
    state.noticeTimer = 3.0;
    return;
  }

  const count = 4 + Math.min(3, state.sectorIdx + Math.floor(state.waveIndex / 2));
  const spd = sector.enemySpeedScale;
  for (let i = 0; i < count; i++) {
    const slot = (state.waveIndex * 3 + i + state.sectorIdx) % 7;
    let kind: EnemyKind = 'jelly';
    if (i === count - 1 && state.waveIndex % 2 === 1) kind = 'cargo';
    else if (slot === 1) kind = 'interceptor';
    else if (slot === 2 && state.sectorIdx >= 1) kind = 'frigate';
    else if (slot === 3) kind = 'meteor';
    else if (slot === 4 && (state.sectorIdx >= 1 || state.waveIndex >= 2)) kind = 'carrier';
    else if (slot === 5) kind = 'interceptor';

    const hp =
      kind === 'frigate'
        ? 4 + state.sectorIdx
        : kind === 'carrier'
          ? 3 + Math.floor(state.sectorIdx / 2)
          : kind === 'meteor'
            ? 2
            : kind === 'cargo'
              ? 2
              : kind === 'interceptor'
                ? 1 + Math.floor(state.sectorIdx / 2)
                : 1;

    const baseVx =
      kind === 'interceptor'
        ? -82
        : kind === 'meteor'
          ? -70
          : kind === 'frigate'
            ? -28
            : kind === 'carrier'
              ? -34
              : kind === 'cargo'
                ? -46
                : -54;

    state.enemies.push({
      id: `s${state.sectorIdx}-w${state.waveIndex}-${i}`,
      kind,
      x: GAME_W + 18 + i * 34,
      y: 20 + ((state.waveIndex * 33 + i * 31) % (GAME_H - 44)),
      vx: baseVx * spd,
      vy: 0,
      hp,
      maxHp: hp,
      phase: i * 1.15,
      rot: 0,
      fireTimer: kind === 'frigate' ? 1.1 + i * 0.25 : 1.3 + i * 0.3,
      flashTimer: 0,
    });
  }
}

export function destroyShmupEnemy(
  state: ShmupArenaState,
  idx: number,
  events: SimEvent[],
  density: number,
  allowDrop = true,
): void {
  const e = state.enemies[idx];
  if (!e) return;
  state.enemies.splice(idx, 1);

  const pts = e.kind === 'frigate' ? 140 : e.kind === 'carrier' ? 120 : e.kind === 'cargo' ? 110 : 75;
  state.score += pts;
  state.juice.registerCombo();
  state.juice.addTrauma(e.kind === 'frigate' ? 0.3 : 0.18);
  events.push('stomp');
  state.juice.spawnBurst(e.x + 8, e.y + 8, ['#e0aaff', '#ffd447', '#fffaf0'], 10, density, { gravity: 0, liftY: 0 });

  if (e.kind === 'meteor') {
    for (const vy of [-58, 0, 58]) {
      state.bullets.push({
        x: e.x + 8,
        y: e.y + 8,
        vx: -108,
        vy,
        fromEnemy: true,
        damage: 1,
        color: '#f59b23',
      });
    }
  }

  if (!allowDrop) return;
  if (e.kind === 'cargo') {
    const cycle = Math.floor(state.juice.visualTime / 1.1) % 4;
    const dropKind: PickupKind =
      cycle === 0
        ? 'weapon_crimson'
        : cycle === 1
          ? 'weapon_azure'
          : cycle === 2
            ? 'weapon_violet'
            : 'bomb';
    state.pickups.push({ kind: dropKind, x: e.x, y: e.y, vx: -42, phase: state.juice.visualTime });
  } else if (e.kind === 'frigate') {
    state.pickups.push({ kind: 'funnel', x: e.x, y: e.y, vx: -40, phase: 0 });
  } else if (idx % 2 === 0 || state.starsCollected === 0) {
    const cycle = (state.starsCollected + idx) % 4;
    const kind: PickupKind =
      cycle === 0 ? 'weapon_crimson' : cycle === 1 ? 'weapon_azure' : cycle === 2 ? 'weapon_violet' : 'funnel';
    state.pickups.push({ kind, x: e.x, y: e.y, vx: -42, phase: idx });
  }
}

export function stepShmupEnemies(
  state: ShmupArenaState,
  simDt: number,
  events: SimEvent[],
  params: RuntimeParams,
): void {
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    e.x += e.vx * simDt;
    e.y += e.vy * simDt;

    if (e.kind === 'jelly') {
      e.y += Math.sin(state.juice.visualTime * 3.5 + e.phase) * 40 * simDt;
    } else if (e.kind === 'interceptor') {
      if (!e.chargeArmed && e.x < GAME_W - 60) {
        e.chargeArmed = true;
        e.vx = -155 - state.sectorIdx * 12;
        e.vy = clamp((state.ship.y - e.y) * 0.9, -65, 65);
        state.bullets.push({
          x: e.x,
          y: e.y + 8,
          vx: -145,
          vy: 0,
          fromEnemy: true,
          damage: 1,
          color: '#ff708d',
        });
      }
    } else if (e.kind === 'frigate') {
      e.fireTimer -= simDt;
      if (e.fireTimer <= 0 && e.x < GAME_W - 14 && e.x > 52) {
        e.fireTimer = 1.65 - state.sectorIdx * 0.08;
        for (const dy of [-32, 0, 32]) {
          state.bullets.push({
            x: e.x,
            y: e.y + 8,
            vx: -118,
            vy: dy,
            fromEnemy: true,
            damage: 1,
            color: '#ff9048',
          });
        }
      }
    } else if (e.kind === 'carrier') {
      e.fireTimer -= simDt;
      if (e.fireTimer <= 0 && e.x < GAME_W - 16 && e.x > 64) {
        e.fireTimer = 1.95 - state.sectorIdx * 0.1;
        state.enemies.push({
          id: `${e.id}-m-${Math.floor(state.elapsedSec * 10)}`,
          kind: 'missile',
          x: e.x - 4,
          y: e.y + 6,
          vx: -95 - state.sectorIdx * 8,
          vy: 0,
          hp: 1,
          maxHp: 1,
          phase: 0,
          rot: 0,
          fireTimer: 0,
          flashTimer: 0,
        });
      }
    } else if (e.kind === 'missile') {
      const steer = clamp((state.ship.y - e.y) * 2.4, -55, 55);
      e.vy += (steer - e.vy) * Math.min(1, simDt * 4.5);
      e.rot = Math.atan2(e.vy, e.vx) + Math.PI;
    } else if (e.kind === 'meteor') {
      e.rot += 3.6 * simDt;
    } else if (e.kind === 'cargo') {
      e.y += Math.sin(state.juice.visualTime * 2.4 + e.phase) * 24 * simDt;
    }

    e.y = clamp(e.y, 12, GAME_H - 22);
    if (e.x < -26) {
      state.enemies.splice(i, 1);
      continue;
    }

    if (
      state.ship.invulnTimer <= 0 &&
      state.ship.overdriveShieldTimer <= 0 &&
      Math.hypot(state.ship.x + 8 - (e.x + 8), state.ship.y + 8 - (e.y + 8)) < CORE_ENEMY_HIT_RADIUS
    ) {
      state.damageShip(events, 0.55, 0.28, ['#ff708d', '#fffaf0'], 10, params.sparkleDensity);
    }
  }
}

export function stepShmupPickups(
  state: ShmupArenaState,
  simDt: number,
  events: SimEvent[],
  params: RuntimeParams,
): void {
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    p.x += p.vx * simDt;
    p.y = clamp(p.y + Math.sin(state.juice.visualTime * 3.5 + p.phase) * 14 * simDt, 14, GAME_H - 18);
    if (p.x < -16) {
      state.pickups.splice(i, 1);
      continue;
    }
    if (Math.hypot(state.ship.x + 8 - (p.x + 7), state.ship.y + 8 - (p.y + 7)) < 17) {
      state.pickups.splice(i, 1);
      state.starsCollected++;
      state.juice.registerCombo();
      events.push('star');
      state.score += 80;

      if (p.kind === 'bomb') {
        if (state.ship.bombs < MAX_BOMBS) {
          state.ship.bombs++;
          state.noticeText = `💣 拾取星核 Bomb！目前庫存 ×${state.ship.bombs}`;
        } else {
          state.score += 150;
          state.noticeText = '💣 Bomb 滿額折換 +150 分！';
        }
      } else if (p.kind === 'funnel') {
        if (state.ship.funnelCount < 2) {
          state.ship.funnelCount = 2;
          state.noticeText = '💠 解鎖【雙子浮游機常駐護衛】！';
        } else if (state.ship.funnelCount < 4) {
          state.ship.funnelCount = 4;
          state.noticeText = '🌟 陣列進化：【四連星光浮游矩陣】！';
        } else {
          state.ship.funnelOverdriveTimer = Math.max(state.ship.funnelOverdriveTimer, 3.5);
          state.noticeText = '✨ 浮游過載追擊延長！';
        }
      } else if (p.kind === 'heal') {
        if (state.ship.hearts < state.ship.maxHearts) {
          state.ship.hearts++;
          state.noticeText = '❤️ 修復護盾 +1 心！';
        } else {
          state.score += 120;
          state.noticeText = '❤️ 滿血獎勵 +120 分！';
        }
      } else {
        const wTarget: WeaponKind =
          p.kind === 'weapon_crimson' ? 'crimson' : p.kind === 'weapon_azure' ? 'azure' : 'violet';
        if (state.ship.weaponKind === wTarget) {
          if (state.ship.weaponLevel < 3) {
            state.ship.weaponLevel = (state.ship.weaponLevel + 1) as WeaponLevel;
            state.noticeText = `⬆️ ${WEAPON_CATALOG[wTarget].name} 強化至 Lv.${state.ship.weaponLevel}！`;
          } else {
            state.score += 140;
            state.ship.funnelOverdriveTimer = Math.max(state.ship.funnelOverdriveTimer, 2.8);
            state.noticeText = `🔥 ${WEAPON_CATALOG[wTarget].name} 滿級超載 +140 分！`;
          }
        } else {
          state.ship.weaponKind = wTarget;
          state.noticeText = `🔫 切換 ${WEAPON_CATALOG[wTarget].name} Lv.${state.ship.weaponLevel}！`;
        }
      }
      state.noticeTimer = 2.2;
      state.juice.spawnBurst(p.x + 7, p.y + 7, ['#ffd447', '#fffaf0', '#56d39c'], 9, params.sparkleDensity, {
        gravity: 0,
        liftY: 0,
      });
    }
  }
}
