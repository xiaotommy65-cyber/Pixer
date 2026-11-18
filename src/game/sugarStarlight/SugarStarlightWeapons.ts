import type { InputMap } from '../../core/input/InputMap.ts';
import type { JuiceSystem } from '../../core/sim/JuiceSystem.ts';
import { clamp, type RuntimeParams, type SimEvent } from '../../core/types/WorldTypes.ts';
import {
  CHARGE_TIER1_SEC,
  CHARGE_TIER2_SEC,
  FUNNEL_OVERDRIVE_SEC,
  GRAZE_OVERDRIVE_COST,
  OVERDRIVE_SHIELD_SEC,
  WEAPON_CATALOG,
  getFighterProfile,
  type BossState,
  type Bullet,
  type ChargeTier,
  type EnemyShip,
  type FunnelUnit,
  type PowerPickup,
  type ShipState,
  type ShmupPhase,
} from './SugarStarlightData.ts';

export interface ShmupArenaState {
  phase: ShmupPhase;
  sectorIdx: number;
  waveIndex: number;
  elapsedSec: number;
  score: number;
  starsCollected: number;
  ship: ShipState;
  funnels: FunnelUnit[];
  boss: BossState | null;
  enemies: EnemyShip[];
  bullets: Bullet[];
  pickups: PowerPickup[];
  juice: JuiceSystem;
  input: InputMap;
  noticeText: string;
  noticeTimer: number;
  getChargeTier(): ChargeTier;
  destroyEnemy(idx: number, events: SimEvent[], density: number, allowDrop?: boolean): void;
  onWeakPointDestroyed(wp: { offsetX: number; offsetY: number }, events: SimEvent[]): void;
  damageBossCore(amount: number, events: SimEvent[], density: number): boolean;
  damageShip(
    events: SimEvent[],
    trauma: number,
    flashAlpha: number,
    burstColors: readonly string[],
    burstCount: number,
    density?: number,
  ): void;
}

export function spawnPlayerBullet(
  state: ShmupArenaState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  damage = 1,
  color = '#ffd447',
  opts?: { piercing?: boolean; homing?: boolean; clearsBullets?: boolean; width?: number; height?: number },
): void {
  state.bullets.push({
    x,
    y,
    vx,
    vy,
    fromEnemy: false,
    damage,
    color,
    piercing: opts?.piercing,
    homing: opts?.homing,
    clearsBullets: opts?.clearsBullets,
    width: opts?.width,
    height: opts?.height,
    speed: Math.hypot(vx, vy),
    turnRate: opts?.homing ? 5.6 : undefined,
    hitIds: opts?.piercing ? new Set<string>() : undefined,
  });
}

export function findNearestTarget(state: ShmupArenaState, fromX: number, fromY: number): { x: number; y: number } | null {
  let bestDist = Infinity;
  let best: { x: number; y: number } | null = null;
  for (const e of state.enemies) {
    const tx = e.x + 8;
    const ty = e.y + 8;
    const d = Math.hypot(tx - fromX, ty - fromY);
    if (d < bestDist) {
      bestDist = d;
      best = { x: tx, y: ty };
    }
  }
  if (state.boss) {
    for (const wp of state.boss.weakPoints) {
      if (wp.hp <= 0) continue;
      const wx = state.boss.x + wp.offsetX + 8;
      const wy = state.boss.y + wp.offsetY + 8;
      const d = Math.hypot(wx - fromX, wy - fromY);
      if (d < bestDist) {
        bestDist = d;
        best = { x: wx, y: wy };
      }
    }
    const bx = state.boss.x + 16;
    const by = state.boss.y + 8;
    const d = Math.hypot(bx - fromX, by - fromY);
    if (d < bestDist) best = { x: bx, y: by };
  }
  return best;
}

export function fireBolts(state: ShmupArenaState, events: SimEvent[]): void {
  const profile = getFighterProfile(state.ship.fighterId);
  const overdrive = state.ship.overdriveShieldTimer > 0;
  state.ship.shootCooldown = (overdrive ? 0.11 : 0.145) * profile.fireCooldownScale;
  state.ship.squash = { scaleX: 0.88, scaleY: 1.12 };
  events.push('laser');

  const mx = state.ship.x + 15;
  const my = state.ship.y + 8;
  const lv = state.ship.weaponLevel;
  const wKind = state.ship.weaponKind;

  if (wKind === 'crimson') {
    const angles = lv === 1 ? [-0.14, 0, 0.14] : lv === 2 ? [-0.26, -0.11, 0, 0.11, 0.26] : [-0.36, -0.22, -0.1, 0, 0.1, 0.22, 0.36];
    for (const a of angles) {
      spawnPlayerBullet(state, mx, my, Math.cos(a) * 255, Math.sin(a) * 255, 1, a === 0 ? '#ffd447' : '#ff708d');
    }
  } else if (wKind === 'azure') {
    if (lv === 1) {
      spawnPlayerBullet(state, mx + 2, my, 320, 0, 1, '#5ec2f7', { piercing: true, width: 16, height: 6 });
    } else if (lv === 2) {
      spawnPlayerBullet(state, mx + 2, my - 4, 340, 0, 1, '#5ec2f7', { piercing: true, width: 18, height: 6 });
      spawnPlayerBullet(state, mx + 2, my + 4, 340, 0, 1, '#8ce8ff', { piercing: true, width: 18, height: 6 });
    } else {
      spawnPlayerBullet(state, mx + 4, my, 360, 0, 2, '#fffaf0', { piercing: true, width: 20, height: 8 });
      spawnPlayerBullet(state, mx, my - 6, 335, -18, 1, '#5ec2f7', { piercing: true, width: 16, height: 6 });
      spawnPlayerBullet(state, mx, my + 6, 335, 18, 1, '#5ec2f7', { piercing: true, width: 16, height: 6 });
    }
  } else {
    spawnPlayerBullet(state, mx, my, 255, 0, 1, '#ffd447');
    const vOffsets = lv === 1 ? [-48, 48] : lv === 2 ? [-75, 0, 75] : [-95, -35, 35, 95];
    for (const vy of vOffsets) {
      spawnPlayerBullet(state, mx - 2, my, 215, vy, lv >= 3 ? 2 : 1, '#e0aaff', { homing: true, width: 11, height: 11 });
    }
  }

  for (const f of state.funnels) {
    spawnPlayerBullet(state, f.x + 10, f.y + 6, 260, 0, 1, WEAPON_CATALOG[wKind].glowColor);
  }
}

function spawnPiercingBeamChain(
  state: ShmupArenaState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  damage: number,
  color: string,
  segments: number,
  beamWidth: number,
  beamHeight: number,
): void {
  const hitIds = new Set<string>();
  for (let s = 0; s < segments; s++) {
    state.bullets.push({
      x: x - s * 18,
      y: y - vy * s * 0.045,
      vx,
      vy,
      fromEnemy: false,
      piercing: true,
      clearsBullets: true,
      damage,
      color,
      width: beamWidth,
      height: beamHeight,
      hitIds,
    });
  }
}

export function firePiercingCannon(state: ShmupArenaState, events: SimEvent[], params: RuntimeParams): void {
  const muzzleX = state.ship.x + 22;
  const muzzleY = state.ship.y + 8;
  const c = WEAPON_CATALOG[state.ship.weaponKind].color;
  spawnPiercingBeamChain(state, muzzleX, muzzleY, 385, 0, 5, c, 3, 22, 10);
  state.ship.squash = { scaleX: 1.3, scaleY: 0.76 };
  state.ship.shootCooldown = 0.16;
  events.push('rail');
  state.juice.applyPreset('charge_shot', { dirX: -1, dirY: 0, intensity: 0.9 });
  state.juice.spawnBurst(muzzleX, muzzleY, [c, '#fffaf0', '#ffd447'], 10, params.sparkleDensity, {
    gravity: 0,
    liftY: 0,
    speedMin: 35,
    speedMax: 105,
  });
}

export function fireFighterTier2Ult(state: ShmupArenaState, events: SimEvent[], params: RuntimeParams): void {
  const profile = getFighterProfile(state.ship.fighterId);
  const activeCount = Math.max(2, state.ship.funnelCount);
  state.ship.funnelOverdriveTimer = FUNNEL_OVERDRIVE_SEC;
  syncFunnelPool(state, 0);

  const muzzleX = state.ship.x + 22;
  const muzzleY = state.ship.y + 8;

  if (profile.ultKind === 'giga_wave') {
    spawnPiercingBeamChain(state, muzzleX + 4, muzzleY, 410, 0, 8, '#ffd447', 4, 26, 14);
    spawnPiercingBeamChain(state, muzzleX, muzzleY - 10, 390, -14, 4, '#ff708d', 2, 22, 10);
    spawnPiercingBeamChain(state, muzzleX, muzzleY + 10, 390, 14, 4, '#ff708d', 2, 22, 10);
    state.noticeText = '💥 珊瑚重砲：【超極巨波動砲】轟炸線！';
  } else if (profile.ultKind === 'crossfire') {
    spawnPiercingBeamChain(state, muzzleX, muzzleY, 405, 0, 6, '#ffd447', 3, 22, 11);
    spawnPiercingBeamChain(state, muzzleX, muzzleY, 370, -78, 4, '#5ec2f7', 2, 20, 9);
    spawnPiercingBeamChain(state, muzzleX, muzzleY, 370, 78, 4, '#5ec2f7', 2, 20, 9);
    state.noticeText = '⚡ 藍星隼：【V 字交叉殲滅砲】解放！';
  } else {
    spawnPiercingBeamChain(state, muzzleX, muzzleY, 400, 0, 5, '#ffd447', 3, 22, 11);
    state.noticeText = `💠 浮游併發齊射！(${activeCount} 機自主追擊啟動)`;
  }

  const target = findNearestTarget(state, muzzleX + 40, muzzleY);
  for (let i = 0; i < state.funnels.length; i++) {
    const f = state.funnels[i];
    const fx = f.x + 14;
    const fy = f.y + 5.5;
    const fanVy =
      state.funnels.length <= 2
        ? i === 0
          ? -22
          : 22
        : [-36, -14, 14, 36][i % 4];
    const aimVy = target ? clamp(((target.y - fy) / Math.max(48, target.x - fx)) * 280, -56, 56) * 0.55 + fanVy * 0.45 : fanVy;
    spawnPlayerBullet(state, fx, fy, 370, aimVy, 3, i % 2 === 0 ? '#5ec2f7' : '#ff8ec6', {
      piercing: true,
      clearsBullets: true,
      width: 18,
      height: 8,
    });
    spawnPlayerBullet(state, fx - 12, fy, 370, aimVy, 3, i % 2 === 0 ? '#5ec2f7' : '#ff8ec6', {
      piercing: true,
      clearsBullets: true,
      width: 18,
      height: 8,
    });
    state.juice.spawnBurst(fx, fy, ['#ffd447', '#5ec2f7', '#fffaf0'], 5, params.sparkleDensity, {
      gravity: 0,
      liftY: 0,
      speedMin: 24,
      speedMax: 70,
    });
  }

  state.ship.squash = { scaleX: 1.38, scaleY: 0.7 };
  state.ship.shootCooldown = 0.19;
  state.noticeTimer = 2.1;
  events.push('rail');
  events.push('ignite');
  state.juice.applyPreset('charge_shot', { dirX: -1, dirY: 0, intensity: 1.28 });
  state.juice.spawnBurst(muzzleX, muzzleY, ['#ffd447', '#ff8ec6', '#5ec2f7', '#fffaf0'], 14, params.sparkleDensity, {
    gravity: 0,
    liftY: 0,
    speedMin: 42,
    speedMax: 120,
  });
}

export function triggerStarlightBomb(state: ShmupArenaState, events: SimEvent[]): boolean {
  if (state.phase !== 'sortie' || state.ship.bombs <= 0) return false;
  state.ship.bombs--;
  state.ship.invulnTimer = Math.max(state.ship.invulnTimer, 1.8);
  state.ship.squash = { scaleX: 1.45, scaleY: 0.68 };
  events.push('explode');
  events.push('ignite');
  state.juice.applyPreset('explosion', { dirX: -1, dirY: 0, intensity: 1.15 });
  state.juice.triggerFlash('#fffaf0', 0.4);

  let cleared = 0;
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    if (!b.fromEnemy) continue;
    state.bullets.splice(i, 1);
    cleared++;
    state.score += 15;
    state.juice.spawnBurst(b.x, b.y, ['#ffd447', '#8ce8ff', '#fffaf0'], 3, 1.0, {
      gravity: 0,
      liftY: 0,
      speedMin: 18,
      speedMax: 52,
    });
  }

  for (let k = 0; k < 18; k++) {
    const ang = (Math.PI * 2 * k) / 18;
    state.juice.particles.push({
      x: state.ship.x + 8,
      y: state.ship.y + 8,
      vx: Math.cos(ang) * 190,
      vy: Math.sin(ang) * 140,
      life: 0,
      maxLife: 0.55,
      size: 6,
      sprite: 'sparkle',
      color: k % 2 === 0 ? '#ffd447' : '#5ec2f7',
      rot: ang,
      vRot: 6,
      additive: true,
      gravity: 0,
    });
  }

  for (let j = state.enemies.length - 1; j >= 0; j--) {
    const e = state.enemies[j];
    e.hp -= 10;
    e.flashTimer = 0.25;
    if (e.hp <= 0) {
      state.destroyEnemy(j, events, 1.0, false);
    }
  }

  if (state.boss) {
    for (const wp of state.boss.weakPoints) {
      if (wp.hp > 0) {
        wp.hp = Math.max(0, wp.hp - 5);
        wp.flash = 0.22;
        if (wp.hp === 0) state.onWeakPointDestroyed(wp, events);
      }
    }
    state.damageBossCore(6, events, 1.0);
  }

  state.noticeText = `💣 星光超新星 BOMB！清除了 ${cleared} 枚敵彈！`;
  state.noticeTimer = 2.4;
  return true;
}

export function triggerGrazeOverdrive(state: ShmupArenaState, events: SimEvent[], density: number): void {
  state.ship.grazeMeter = 0;
  state.ship.overdriveShieldTimer = OVERDRIVE_SHIELD_SEC;
  state.ship.funnelOverdriveTimer = Math.max(state.ship.funnelOverdriveTimer, FUNNEL_OVERDRIVE_SEC);
  events.push('star');
  events.push('key');
  state.juice.addTrauma(0.32);
  state.juice.triggerFlash('#5ec2f7', 0.22);

  for (let k = -2; k <= 2; k++) {
    spawnPlayerBullet(state, state.ship.x + 14, state.ship.y + 8, 280, k * 42, 2, '#ffd447', { clearsBullets: true });
  }
  state.juice.spawnBurst(state.ship.x + 8, state.ship.y + 8, ['#5ec2f7', '#ffd447', '#fffaf0'], 16, density, {
    gravity: 0,
    liftY: 0,
    speedMin: 40,
    speedMax: 120,
  });

  if (state.ship.hearts < state.ship.maxHearts) {
    state.ship.hearts++;
    state.noticeText = '⚡ 擦彈反擊 OVERDRIVE！無敵護盾＋護盾回復 +1 ❤️！';
  } else {
    state.score += 180;
    state.noticeText = '⚡ 擦彈反擊 OVERDRIVE！無敵消彈護盾＋全子機反擊 +180！';
  }
  state.noticeTimer = 2.4;
}

import { syncFunnelPool } from './SugarStarlightFunnels.ts';

export { CHARGE_TIER1_SEC, CHARGE_TIER2_SEC, GRAZE_OVERDRIVE_COST, syncFunnelPool };
