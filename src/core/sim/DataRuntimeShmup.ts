import { GAME_H, GAME_W } from '../gpu/GpuTypes.ts';
import { SpatialHash } from '../math/SpatialHash.ts';
import type { InputMap } from '../input/InputMap.ts';
import type { ShmupFighterSummary, ShmupHudSnapshot } from '../types/HudTypes.ts';
import { clamp, type RuntimeParams, type SimEvent } from '../types/WorldTypes.ts';
import type { CartridgeJsonV1, CartridgeLoadoutDef } from './CartridgeSchema.ts';
import { JuiceSystem, stepSquashSpring, type SquashSpring } from './JuiceSystem.ts';
import {
  BM_HOMING,
  BM_ORBIT,
  BM_ROTATE,
  EF_ADDITIVE,
  EF_ALIVE,
  EF_BOSS,
  EF_BULLET,
  EF_CLEARS_BULLETS,
  EF_EMISSIVE,
  EF_ENEMY,
  EF_HOMING,
  EF_PICKUP,
  EF_PIERCING,
  EF_WEAK_POINT,
  SoaEntityPool,
} from './SoaEntityPool.ts';

export type ShmupPhaseState = 'hangar' | 'sortie' | 'won' | 'lost';

export interface RuntimeShmupState {
  phase: ShmupPhaseState;
  selectedLoadoutIdx: number;
  fighterId: 'starfalcon' | 'coral_titan' | 'violet_prism';
  weaponKind: 'crimson' | 'azure' | 'violet';
  weaponLevel: 1 | 2 | 3;
  bombs: number;
  maxBombs: number;
  funnelCount: number;
  chargeSec: number;
  funnelOverdriveTimer: number;
  overdriveShieldTimer: number;
  grazeCount: number;
  grazeMeter: number;
  shootCooldown: number;
  invulnTimer: number;
  waveIndex: number;
  waveTimer: number;
  thrusterTimer: number;
  chargeParticleTimer: number;
  hangarNavCooldown: number;
  nextPierceGroup: number;
  squash: SquashSpring;
  funnelSlots: Int16Array;
  cachedFighters: readonly ShmupFighterSummary[];
  targetHash: SpatialHash;
  targetEnemySlots: Uint16Array;
  playerBulletSlots: Uint16Array;
  querySlots: Int32Array;
}

export interface ShmupRuntimeContext {
  readonly def: CartridgeJsonV1;
  readonly pool: SoaEntityPool;
  readonly input: InputMap;
  readonly juice: JuiceSystem;
  readonly lastHitGroupByTarget: Int32Array;
  readonly shmup: RuntimeShmupState;
  readonly archetypeMetaByIdx: readonly { id: string; scoreValue: number; dropKind?: string }[];
  stageIdx: number;
  playerSlot: number;
  bossSlot: number;
  hearts: number;
  maxHearts: number;
  score: number;
  starsCollected: number;
  elapsedSec: number;
  status: 'playing' | 'won' | 'lost';
  statusBanner: string;
  noticeTimer: number;
  spawnArchetype(archetypeId: string, x: number, y: number, vx?: number, vy?: number, parentSlot?: number): number;
  enterStage(idx: number): void;
  retryCurrentStage(): void;
}

const WEAPON_ORDER: readonly ('crimson' | 'azure' | 'violet')[] = ['crimson', 'azure', 'violet'];

export function getActiveLoadout(def: CartridgeJsonV1, id: string): CartridgeLoadoutDef | undefined {
  const list = def.player.loadouts;
  if (!list || list.length === 0) return undefined;
  return list.find((f) => f.id === id) ?? list[0];
}

export function getChargeTier(def: CartridgeJsonV1, chargeSec: number): 0 | 1 | 2 {
  const t2 = def.player.charge?.tier2Sec ?? 1.08;
  const t1 = def.player.charge?.tier1Sec ?? 0.48;
  if (chargeSec >= t2) return 2;
  if (chargeSec >= t1) return 1;
  return 0;
}

export function applyShmupLoadout(ctx: ShmupRuntimeContext, fighterId: string): void {
  const list = ctx.def.player.loadouts;
  if (!list || list.length === 0) return;
  const idx = list.findIndex((f) => f.id === fighterId);
  const chosen = list[idx >= 0 ? idx : 0];
  ctx.shmup.selectedLoadoutIdx = idx >= 0 ? idx : 0;
  ctx.shmup.fighterId = chosen.id;
  ctx.maxHearts = chosen.maxHearts;
  ctx.hearts = chosen.maxHearts;
  ctx.shmup.weaponKind = chosen.defaultWeapon;
  ctx.shmup.weaponLevel = 1;
  ctx.shmup.bombs = chosen.initialBombs;
  ctx.shmup.funnelCount = chosen.initialFunnels;
  ctx.shmup.chargeSec = 0;
  ctx.shmup.funnelOverdriveTimer = 0;
  ctx.shmup.overdriveShieldTimer = 0;
  ctx.shmup.grazeCount = 0;
  ctx.shmup.grazeMeter = 0;
  ctx.shmup.shootCooldown = 0;
  ctx.shmup.invulnTimer = 0;
  syncFunnelSlots(ctx, 0);
}

export function syncFunnelSlots(ctx: ShmupRuntimeContext, simDt: number): void {
  if (ctx.playerSlot < 0) return;
  const isTier2 = getChargeTier(ctx.def, ctx.shmup.chargeSec) === 2;
  const desired =
    ctx.shmup.funnelOverdriveTimer > 0 || isTier2
      ? Math.max(2, ctx.shmup.funnelCount)
      : ctx.shmup.funnelCount;

  // Collect existing funnel slots without allocating
  const pool = ctx.pool;
  const fSlots = ctx.shmup.funnelSlots;
  fSlots.fill(-1);
  let existingCount = 0;
  for (let i = 0; i < pool.activeCount; i++) {
    const s = pool.activeIndices[i];
    if ((pool.behaviorMask[s] & BM_ORBIT) !== 0 && pool.parentSlot[s] === ctx.playerSlot) {
      if (existingCount < 4) fSlots[existingCount] = s;
      existingCount++;
    }
  }

  while (existingCount < desired && existingCount < 4) {
    const s = ctx.spawnArchetype('funnel', pool.x[ctx.playerSlot], pool.y[ctx.playerSlot], 0, 0, ctx.playerSlot);
    if (s < 0) break;
    pool.behaviorMask[s] |= BM_ORBIT;
    pool.parentSlot[s] = ctx.playerSlot;
    fSlots[existingCount++] = s;
  }
  if (existingCount > desired) {
    for (let k = existingCount - 1; k >= desired; k--) {
      if (fSlots[k] >= 0) pool.free(fSlots[k]);
      fSlots[k] = -1;
    }
    existingCount = desired;
  }

  const px = pool.x[ctx.playerSlot];
  const py = pool.y[ctx.playerSlot];
  const overdrive = ctx.shmup.funnelOverdriveTimer > 0 || getChargeTier(ctx.def, ctx.shmup.chargeSec) === 2;
  for (let i = 0; i < existingCount; i++) {
    const s = fSlots[i];
    if (s < 0) continue;
    const ang = ctx.juice.visualTime * (overdrive ? 4.4 : 2.3) + (Math.PI * 2 * i) / Math.max(1, existingCount);
    const rx = overdrive ? 20 : 22;
    const ry = overdrive ? 17 : 20;
    const tx = clamp(px + 2.5 + Math.cos(ang) * rx, 2, GAME_W - 14);
    const ty = clamp(py + 2.5 + Math.sin(ang) * ry, 8, GAME_H - 16);
    if (simDt > 0) {
      const k = Math.min(1, simDt * 12);
      pool.x[s] += (tx - pool.x[s]) * k;
      pool.y[s] += (ty - pool.y[s]) * k;
    } else {
      pool.x[s] = tx;
      pool.y[s] = ty;
      pool.prevX[s] = tx;
      pool.prevY[s] = ty;
    }
    pool.rot[s] = ctx.juice.visualTime * (overdrive ? 5.2 : 2.5) + i;
    pool.paramA[s] = overdrive ? 1 : 0;
  }
}

function spawnBulletSlot(
  ctx: ShmupRuntimeContext,
  x: number,
  y: number,
  vx: number,
  vy: number,
  fromEnemy: boolean,
  damage: number,
  w: number,
  h: number,
  opts?: { piercing?: boolean; homing?: boolean; clearsBullets?: boolean; groupId?: number; colorPaletteRow?: number },
): number {
  const archId = opts?.piercing ? 'player_beam' : fromEnemy ? 'enemy_bullet' : 'player_bolt';
  const slot = ctx.spawnArchetype(archId, x - w * 0.5, y - h * 0.5, vx, vy);
  if (slot < 0) return -1;
  const pool = ctx.pool;
  pool.w[slot] = w;
  pool.h[slot] = h;
  pool.hp[slot] = damage;
  pool.maxHp[slot] = Math.hypot(vx, vy); // store speed for homing bullets
  pool.flags[slot] |= EF_BULLET | EF_EMISSIVE;
  if (fromEnemy) {
    pool.flags[slot] |= EF_ENEMY | EF_ADDITIVE;
    pool.aiState[slot] = 0; // grazed = 0
  } else {
    pool.flags[slot] &= ~EF_ENEMY;
  }
  if (opts?.piercing) {
    pool.flags[slot] |= EF_PIERCING;
    pool.paramD[slot] = opts.groupId ?? ctx.shmup.nextPierceGroup++;
  }
  if (opts?.clearsBullets) pool.flags[slot] |= EF_CLEARS_BULLETS;
  if (opts?.homing) {
    pool.flags[slot] |= EF_HOMING;
    pool.behaviorMask[slot] |= BM_HOMING;
    pool.paramA[slot] = 5.6; // turnRate
  }
  if (opts?.piercing || opts?.homing) {
    if (vy !== 0 || vx < 0) {
      pool.rot[slot] = Math.atan2(vy, vx);
      pool.prevRot[slot] = pool.rot[slot];
    }
  }
  if (opts?.colorPaletteRow !== undefined) {
    pool.paletteRow[slot] = opts.colorPaletteRow;
  }
  return slot;
}

function spawnPiercingBeamChain(
  ctx: ShmupRuntimeContext,
  x: number,
  y: number,
  vx: number,
  vy: number,
  damage: number,
  segments: number,
  beamWidth: number,
  beamHeight: number,
  paletteRow: number,
): void {
  const groupId = ctx.shmup.nextPierceGroup++;
  for (let s = 0; s < segments; s++) {
    spawnBulletSlot(ctx, x - s * 18, y - vy * s * 0.045, vx, vy, false, damage, beamWidth, beamHeight, {
      piercing: true,
      clearsBullets: true,
      groupId,
      colorPaletteRow: paletteRow,
    });
  }
}

export function fireShmupBolts(ctx: ShmupRuntimeContext, events: SimEvent[]): void {
  const loadout = getActiveLoadout(ctx.def, ctx.shmup.fighterId);
  const overdrive = ctx.shmup.overdriveShieldTimer > 0;
  ctx.shmup.shootCooldown = (overdrive ? 0.11 : 0.145) * (loadout?.fireCooldownScale ?? 1.0);
  ctx.shmup.squash.scaleX = 0.88;
  ctx.shmup.squash.scaleY = 1.12;
  events.push('laser');

  const mx = ctx.pool.x[ctx.playerSlot] + 15;
  const my = ctx.pool.y[ctx.playerSlot] + 8;
  const lv = ctx.shmup.weaponLevel;
  const wk = ctx.shmup.weaponKind;

  if (wk === 'crimson') {
    const angles = lv === 1 ? [-0.14, 0, 0.14] : lv === 2 ? [-0.26, -0.11, 0, 0.11, 0.26] : [-0.36, -0.22, -0.1, 0, 0.1, 0.22, 0.36];
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i];
      spawnBulletSlot(ctx, mx, my, Math.cos(a) * 255, Math.sin(a) * 255, false, 1, 12, 12, { colorPaletteRow: 1 });
    }
  } else if (wk === 'azure') {
    if (lv === 1) {
      spawnBulletSlot(ctx, mx + 2, my, 320, 0, false, 1, 16, 6, { piercing: true, colorPaletteRow: 2 });
    } else if (lv === 2) {
      spawnBulletSlot(ctx, mx + 2, my - 4, 340, 0, false, 1, 18, 6, { piercing: true, colorPaletteRow: 2 });
      spawnBulletSlot(ctx, mx + 2, my + 4, 340, 0, false, 1, 18, 6, { piercing: true, colorPaletteRow: 2 });
    } else {
      spawnBulletSlot(ctx, mx + 4, my, 360, 0, false, 2, 20, 8, { piercing: true, colorPaletteRow: 2 });
      spawnBulletSlot(ctx, mx, my - 6, 335, -18, false, 1, 16, 6, { piercing: true, colorPaletteRow: 2 });
      spawnBulletSlot(ctx, mx, my + 6, 335, 18, false, 1, 16, 6, { piercing: true, colorPaletteRow: 2 });
    }
  } else {
    spawnBulletSlot(ctx, mx, my, 255, 0, false, 1, 12, 12, { colorPaletteRow: 2 });
    const vOffsets = lv === 1 ? [-48, 48] : lv === 2 ? [-75, 0, 75] : [-95, -35, 35, 95];
    for (let i = 0; i < vOffsets.length; i++) {
      spawnBulletSlot(ctx, mx - 2, my, 215, vOffsets[i], false, lv >= 3 ? 2 : 1, 11, 11, {
        homing: true,
        colorPaletteRow: 2,
      });
    }
  }

  for (let i = 0; i < ctx.pool.activeCount; i++) {
    const s = ctx.pool.activeIndices[i];
    if ((ctx.pool.behaviorMask[s] & BM_ORBIT) !== 0 && ctx.pool.parentSlot[s] === ctx.playerSlot) {
      spawnBulletSlot(ctx, ctx.pool.x[s] + 10, ctx.pool.y[s] + 6, 260, 0, false, 1, 12, 12, { colorPaletteRow: 2 });
    }
  }
}

export function fireShmupChargeRelease(ctx: ShmupRuntimeContext, tier: 1 | 2, events: SimEvent[], params: RuntimeParams): void {
  const mx = ctx.pool.x[ctx.playerSlot] + 22;
  const my = ctx.pool.y[ctx.playerSlot] + 8;
  const loadout = getActiveLoadout(ctx.def, ctx.shmup.fighterId);

  if (tier === 1) {
    spawnPiercingBeamChain(ctx, mx, my, 385, 0, 5, 3, 22, 10, 2);
    ctx.shmup.squash.scaleX = 1.3;
    ctx.shmup.squash.scaleY = 0.76;
    ctx.shmup.shootCooldown = 0.16;
    events.push('rail');
    ctx.juice.applyPreset('charge_shot', { dirX: -1, dirY: 0, intensity: 0.9 });
    ctx.juice.spawnBurst(mx, my, ['#5ec2f7', '#fffaf0', '#ffd447'], 10, params.sparkleDensity, {
      gravity: 0, liftY: 0, speedMin: 35, speedMax: 105,
    });
    return;
  }

  // Tier 2 Fighter Ult + Funnel Salvo
  ctx.shmup.funnelOverdriveTimer = 4.6;
  syncFunnelSlots(ctx, 0);
  const ultKind = loadout?.ultKind ?? 'crossfire';
  if (ultKind === 'giga_wave') {
    spawnPiercingBeamChain(ctx, mx + 4, my, 410, 0, 8, 4, 26, 14, 1);
    spawnPiercingBeamChain(ctx, mx, my - 10, 390, -14, 4, 2, 22, 10, 1);
    spawnPiercingBeamChain(ctx, mx, my + 10, 390, 14, 4, 2, 22, 10, 1);
    ctx.statusBanner = '💥 珊瑚重砲：【超極巨波動砲】轟炸線！';
  } else if (ultKind === 'crossfire') {
    spawnPiercingBeamChain(ctx, mx, my, 405, 0, 6, 3, 22, 11, 2);
    spawnPiercingBeamChain(ctx, mx, my, 370, -78, 4, 2, 20, 9, 2);
    spawnPiercingBeamChain(ctx, mx, my, 370, 78, 4, 2, 20, 9, 2);
    ctx.statusBanner = '⚡ 藍星隼：【V 字交叉殲滅砲】解放！';
  } else {
    spawnPiercingBeamChain(ctx, mx, my, 400, 0, 5, 3, 22, 11, 2);
    ctx.statusBanner = `💠 浮游併發齊射！(${Math.max(2, ctx.shmup.funnelCount)} 機自主追擊啟動)`;
  }

  let fi = 0;
  for (let i = 0; i < ctx.pool.activeCount; i++) {
    const s = ctx.pool.activeIndices[i];
    if ((ctx.pool.behaviorMask[s] & BM_ORBIT) !== 0 && ctx.pool.parentSlot[s] === ctx.playerSlot) {
      const fx = ctx.pool.x[s] + 14;
      const fy = ctx.pool.y[s] + 5.5;
      const fanVy = [-22, 22, -36, 36][fi % 4];
      spawnBulletSlot(ctx, fx, fy, 370, fanVy, false, 3, 18, 8, { piercing: true, clearsBullets: true, colorPaletteRow: 2 });
      spawnBulletSlot(ctx, fx - 12, fy, 370, fanVy, false, 3, 18, 8, { piercing: true, clearsBullets: true, colorPaletteRow: 2 });
      fi++;
    }
  }

  ctx.shmup.squash.scaleX = 1.38;
  ctx.shmup.squash.scaleY = 0.7;
  ctx.shmup.shootCooldown = 0.19;
  ctx.noticeTimer = 2.1;
  events.push('rail');
  events.push('ignite');
  ctx.juice.applyPreset('charge_shot', { dirX: -1, dirY: 0, intensity: 1.28 });
}

export function triggerShmupBomb(ctx: ShmupRuntimeContext, events: SimEvent[], params: RuntimeParams): boolean {
  if (ctx.shmup.phase !== 'sortie' || ctx.shmup.bombs <= 0) return false;
  ctx.shmup.bombs--;
  ctx.shmup.invulnTimer = Math.max(ctx.shmup.invulnTimer, ctx.def.player.bomb?.invulnSec ?? 1.8);
  ctx.shmup.squash.scaleX = 1.45;
  ctx.shmup.squash.scaleY = 0.68;
  events.push('explode');
  events.push('ignite');
  ctx.juice.applyPreset('explosion', { dirX: -1, dirY: 0, intensity: 1.15 });
  ctx.juice.triggerFlash('#fffaf0', 0.4);

  const pool = ctx.pool;
  let cleared = 0;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.activeIndices[i];
    const f = pool.flags[s];
    if ((f & EF_ALIVE) === 0) continue;
    if ((f & EF_BULLET) !== 0 && (f & EF_ENEMY) !== 0) {
      const bx = pool.x[s];
      const by = pool.y[s];
      pool.free(s);
      cleared++;
      ctx.score += 15;
      ctx.juice.spawnBurst(bx, by, ['#ffd447', '#8ce8ff', '#fffaf0'], 3, params.sparkleDensity, { gravity: 0, liftY: 0 });
    } else if ((f & EF_ENEMY) !== 0 && (f & (EF_BOSS | EF_WEAK_POINT)) === 0) {
      pool.hp[s] -= 6;
      pool.flash[s] = 0.18;
      if (pool.hp[s] <= 0) {
        destroyShmupEnemySlot(ctx, s, events, params.sparkleDensity, false);
      }
    }
  }
  if (ctx.bossSlot >= 0) {
    damageShmupBossSlot(ctx, 5, events, params.sparkleDensity);
  }
  ctx.statusBanner = `💣 星核 Bomb 引爆！清除 ${cleared} 發彈幕！`;
  ctx.noticeTimer = 2.0;
  return true;
}

export function destroyShmupEnemySlot(
  ctx: ShmupRuntimeContext,
  slot: number,
  events: SimEvent[],
  density: number,
  allowDrop = true,
): void {
  const pool = ctx.pool;
  const ex = pool.x[slot];
  const ey = pool.y[slot];
  const archIdx = pool.archetypeIdx[slot];
  const meta = archIdx >= 0 ? ctx.archetypeMetaByIdx[archIdx] : undefined;
  const id = meta?.id ?? 'jelly';

  pool.free(slot);
  ctx.score += meta?.scoreValue ?? 75;
  ctx.juice.registerCombo();
  ctx.juice.addTrauma(id === 'frigate' ? 0.3 : 0.18);
  events.push('stomp');
  ctx.juice.spawnBurst(ex + 8, ey + 8, ['#e0aaff', '#ffd447', '#fffaf0'], 10, density, { gravity: 0, liftY: 0 });

  if (id === 'meteor') {
    for (const vy of [-58, 0, 58]) {
      spawnBulletSlot(ctx, ex + 8, ey + 8, -108, vy, true, 1, 10, 10, { colorPaletteRow: 7 });
    }
  }

  if (!allowDrop) return;
  if (id === 'cargo') {
    const cycle = Math.floor(ctx.juice.visualTime / 1.1) % 4;
    const pkId = cycle === 0 ? 'pickup_crimson' : cycle === 1 ? 'pickup_azure' : cycle === 2 ? 'pickup_violet' : 'pickup_bomb';
    ctx.spawnArchetype(pkId, ex, ey, -42, 0);
  } else if (id === 'frigate') {
    ctx.spawnArchetype('pickup_funnel', ex, ey, -40, 0);
  } else if (slot % 2 === 0 || ctx.starsCollected === 0) {
    const cycle = (ctx.starsCollected + slot) % 4;
    const pkId = cycle === 0 ? 'pickup_crimson' : cycle === 1 ? 'pickup_azure' : cycle === 2 ? 'pickup_violet' : 'pickup_funnel';
    ctx.spawnArchetype(pkId, ex, ey, -42, 0);
  }
}

export function damageShmupBossSlot(ctx: ShmupRuntimeContext, amount: number, events: SimEvent[], density: number): boolean {
  const bs = ctx.bossSlot;
  if (bs < 0 || (ctx.pool.flags[bs] & EF_ALIVE) === 0) return false;
  const pool = ctx.pool;
  pool.hp[bs] -= amount;
  pool.flash[bs] = 0.18;
  ctx.score += amount * 25;
  ctx.juice.addTrauma(0.14);
  ctx.juice.addKick(-1.2, 0);

  const stage = ctx.def.stages[ctx.stageIdx];
  if (pool.aiState[bs] === 1 && pool.hp[bs] > 0 && pool.hp[bs] <= pool.maxHp[bs] * 0.5) {
    pool.aiState[bs] = 2;
    pool.timerA[bs] = 0.35;
    ctx.juice.applyPreset('boss_phase', { dirX: -1, dirY: 0 });
    events.push('ignite');
    ctx.statusBanner = `🔥 ${stage.boss?.name ?? 'BOSS'} 進入第 2 階段狂暴形態！`;
    ctx.noticeTimer = 2.6;
  }

  if (pool.hp[bs] <= 0) {
    const bx = pool.x[bs];
    const by = pool.y[bs];
    for (let i = pool.activeCount - 1; i >= 0; i--) {
      const s = pool.activeIndices[i];
      if ((pool.flags[s] & EF_WEAK_POINT) !== 0 && pool.parentSlot[s] === bs) {
        pool.free(s);
      }
    }
    pool.free(bs);
    ctx.bossSlot = -1;
    ctx.score += 650 + ctx.stageIdx * 200;
    ctx.juice.applyPreset('explosion', { intensity: 1.35 });
    ctx.juice.spawnBurst(bx + 16, by + 8, ['#ffd447', '#56d39c', '#ff708d', '#5ec2f7'], 28, density, { gravity: 0, liftY: 0 });
    if (ctx.stageIdx + 1 < ctx.def.stages.length) {
      ctx.hearts = Math.min(ctx.maxHearts, ctx.hearts + 1);
      events.push('key');
      ctx.enterStage(ctx.stageIdx + 1);
    } else {
      ctx.shmup.phase = 'won';
      ctx.status = 'won';
      events.push('win');
    }
    return true;
  }
  return false;
}

export function spawnShmupWaveFromJson(ctx: ShmupRuntimeContext): void {
  const stage = ctx.def.stages[ctx.stageIdx];
  const waves = stage.waves;
  if (!waves) return;
  ctx.shmup.waveIndex++;
  if (ctx.shmup.waveIndex > waves.count) {
    if (stage.boss) {
      const bSlot = ctx.spawnArchetype(stage.boss.archetype, stage.boss.x, stage.boss.y, 0, 0);
      if (bSlot >= 0) {
        ctx.pool.hp[bSlot] = stage.boss.hp;
        ctx.pool.maxHp[bSlot] = stage.boss.hp;
        ctx.pool.aiState[bSlot] = 1;
        ctx.pool.timerA[bSlot] = 0.85;
        ctx.bossSlot = bSlot;
        for (const wp of stage.boss.weakPoints ?? []) {
          const wSlot = ctx.spawnArchetype(
            stage.boss.weakPointArchetype ?? 'boss_wing',
            stage.boss.x + wp.offsetX,
            stage.boss.y + wp.offsetY,
            0,
            0,
            bSlot,
          );
          if (wSlot >= 0) {
            ctx.pool.hp[wSlot] = stage.boss.weakPointHp ?? 7;
            ctx.pool.maxHp[wSlot] = stage.boss.weakPointHp ?? 7;
            ctx.pool.paramA[wSlot] = wp.offsetX;
            ctx.pool.paramB[wSlot] = wp.offsetY;
            ctx.pool.timerA[wSlot] = 1.25;
          }
        }
      }
      ctx.statusBanner = `⚠️ ${stage.boss.name} 警報！先破壞上下弱點砲台！`;
      ctx.noticeTimer = 3.0;
    }
    return;
  }

  const count = 4 + Math.min(3, ctx.stageIdx + Math.floor(ctx.shmup.waveIndex / 2));
  const spd = waves.enemySpeedScale;
  for (let i = 0; i < count; i++) {
    const slot = (ctx.shmup.waveIndex * 3 + i + ctx.stageIdx) % 7;
    let aid = waves.pool[0];
    if (waves.cargoEveryOdd && i === count - 1 && ctx.shmup.waveIndex % 2 === 1 && waves.pool.includes('cargo')) aid = 'cargo';
    else if (slot === 1 && waves.pool.includes('interceptor')) aid = 'interceptor';
    else if (slot === 2 && ctx.stageIdx >= 1 && waves.pool.includes('frigate')) aid = 'frigate';
    else if (slot === 3 && waves.pool.includes('meteor')) aid = 'meteor';
    else if (slot === 4 && (ctx.stageIdx >= 1 || ctx.shmup.waveIndex >= 2) && waves.pool.includes('carrier')) aid = 'carrier';
    else if (slot === 5 && waves.pool.includes('interceptor')) aid = 'interceptor';

    const ey = 20 + ((ctx.shmup.waveIndex * 33 + i * 31) % (GAME_H - 44));
    const eSlot = ctx.spawnArchetype(aid, GAME_W + 18 + i * 34, ey);
    if (eSlot >= 0) {
      ctx.pool.vx[eSlot] *= spd;
      ctx.pool.paramA[eSlot] = i * 1.15;
      ctx.pool.timerA[eSlot] = 1.1 + i * 0.25;
      if (aid === 'meteor') ctx.pool.behaviorMask[eSlot] |= BM_ROTATE;
    }
  }
}

export function stepShmupSystem(
  ctx: ShmupRuntimeContext,
  dt: number,
  simDt: number,
  events: SimEvent[],
  params: RuntimeParams,
): void {
  const pool = ctx.pool;
  const sh = ctx.shmup;

  // Hangar phase
  if (sh.phase === 'hangar') {
    const list = ctx.def.player.loadouts ?? [];
    if (sh.hangarNavCooldown > 0) sh.hangarNavCooldown = Math.max(0, sh.hangarNavCooldown - dt);
    if (list.length > 0) {
      if (
        ctx.input.justPressed('left') || ctx.input.justPressed('up') || ctx.input.justPressed('shoulderL') ||
        ((ctx.input.held('left') || ctx.input.held('up') || ctx.input.rightAxisX() < -0.55) && sh.hangarNavCooldown <= 0)
      ) {
        sh.selectedLoadoutIdx = (sh.selectedLoadoutIdx - 1 + list.length) % list.length;
        applyShmupLoadout(ctx, list[sh.selectedLoadoutIdx].id);
        sh.hangarNavCooldown = 0.25;
        events.push('snap');
      } else if (
        ctx.input.justPressed('right') || ctx.input.justPressed('down') || ctx.input.justPressed('shoulderR') || ctx.input.justPressed('skillX') ||
        ((ctx.input.held('right') || ctx.input.held('down') || ctx.input.rightAxisX() > 0.55) && sh.hangarNavCooldown <= 0)
      ) {
        sh.selectedLoadoutIdx = (sh.selectedLoadoutIdx + 1) % list.length;
        applyShmupLoadout(ctx, list[sh.selectedLoadoutIdx].id);
        sh.hangarNavCooldown = 0.25;
        events.push('snap');
      }
      if (ctx.input.justPressed('skillY')) {
        const p = list[sh.selectedLoadoutIdx];
        ctx.statusBanner = `✨ ${p.name}：${p.ultLabel} · ${p.tagline}`;
        ctx.noticeTimer = 2.6;
        events.push('snap');
      }
      if (ctx.input.justPressed('action') || ctx.input.justPressed('jump') || ctx.input.held('action') || ctx.input.held('jump')) {
        ctx.score = 0;
        ctx.starsCollected = 0;
        ctx.elapsedSec = 0;
        sh.phase = 'sortie';
        ctx.enterStage(0);
        events.push('key');
      }
    }
    return;
  }

  stepSquashSpring(sh.squash, dt, 14);
  if (simDt <= 0 || sh.phase !== 'sortie') return;

  if (ctx.input.justPressed('shoulderL')) {
    ctx.retryCurrentStage();
    events.push('snap');
    return;
  }
  if (ctx.input.justPressed('skillX')) {
    const nextIdx = (WEAPON_ORDER.indexOf(sh.weaponKind) + 1) % WEAPON_ORDER.length;
    sh.weaponKind = WEAPON_ORDER[nextIdx];
    sh.squash.scaleX = 1.2;
    sh.squash.scaleY = 0.85;
    events.push('snap');
  }
  if (ctx.input.justPressed('skillY')) {
    triggerShmupBomb(ctx, events, params);
  }

  if (sh.invulnTimer > 0) sh.invulnTimer = Math.max(0, sh.invulnTimer - simDt);
  if (sh.shootCooldown > 0) sh.shootCooldown = Math.max(0, sh.shootCooldown - simDt);
  if (sh.funnelOverdriveTimer > 0) sh.funnelOverdriveTimer = Math.max(0, sh.funnelOverdriveTimer - simDt);
  if (sh.overdriveShieldTimer > 0) sh.overdriveShieldTimer = Math.max(0, sh.overdriveShieldTimer - simDt);

  // TopDownMove player ship
  const pSlot = ctx.playerSlot;
  const loadout = getActiveLoadout(ctx.def, sh.fighterId);
  let mx = ctx.input.axisX();
  let my = ctx.input.axisY();
  if (mx !== 0 && my !== 0) {
    mx *= Math.SQRT1_2;
    my *= Math.SQRT1_2;
  }
  const speed = params.moveSpeed * 1.16 * (loadout?.speedScale ?? 1.0);
  const blend = Math.min(1, simDt * 18);
  pool.vx[pSlot] += (mx * speed - pool.vx[pSlot]) * blend;
  pool.vy[pSlot] += (my * speed - pool.vy[pSlot]) * blend;
  pool.x[pSlot] = clamp(pool.x[pSlot] + pool.vx[pSlot] * simDt, 8, GAME_W - 22);
  pool.y[pSlot] = clamp(pool.y[pSlot] + pool.vy[pSlot] * simDt, 16, GAME_H - 28);
  pool.rot[pSlot] = clamp(pool.vy[pSlot] * 0.0022, -0.22, 0.22);
  pool.skewX[pSlot] = clamp(pool.rot[pSlot] * 0.65, -0.22, 0.22);
  pool.sx[pSlot] = sh.squash.scaleX;
  pool.sy[pSlot] = sh.squash.scaleY;

  sh.thrusterTimer -= simDt;
  if (sh.thrusterTimer <= 0) {
    sh.thrusterTimer = getChargeTier(ctx.def, sh.chargeSec) >= 1 ? 0.032 : 0.05;
    ctx.juice.spawnBurst(pool.x[pSlot] - 1, pool.y[pSlot] + 8, [loadout?.accentHex ?? '#5ec2f7', '#ffd447'], 1, params.sparkleDensity, {
      gravity: 0, liftY: 0, speedMin: 35, speedMax: 80,
    });
  }

  // Charge & Fire
  const actionHeld = ctx.input.held('action');
  if (ctx.input.justPressed('action') && sh.shootCooldown <= 0) {
    fireShmupBolts(ctx, events);
  }
  if (actionHeld) {
    const prevTier = getChargeTier(ctx.def, sh.chargeSec);
    const boost = sh.funnelOverdriveTimer > 0 || sh.overdriveShieldTimer > 0 ? 1.2 : 1.0;
    sh.chargeSec += simDt * boost;
    const nextTier = getChargeTier(ctx.def, sh.chargeSec);
    if (nextTier === 1 && prevTier === 0) {
      events.push('charge');
      ctx.juice.spawnBurst(pool.x[pSlot] + 15, pool.y[pSlot] + 8, ['#5ec2f7', '#fffaf0'], 8, params.sparkleDensity, { gravity: 0, liftY: 0 });
    } else if (nextTier === 2 && prevTier < 2) {
      events.push('star');
      ctx.juice.addTrauma(0.14);
      ctx.juice.spawnBurst(pool.x[pSlot] + 8, pool.y[pSlot] + 8, ['#ffd447', '#ff8ec6', '#5ec2f7'], 12, params.sparkleDensity, { gravity: 0, liftY: 0 });
    }
    if (sh.chargeSec >= (ctx.def.player.charge?.vfxStartSec ?? 0.14)) {
      sh.chargeParticleTimer -= simDt;
      if (sh.chargeParticleTimer <= 0) {
        sh.chargeParticleTimer = nextTier === 2 ? 0.036 : 0.048;
        ctx.juice.spawnConverge(pool.x[pSlot] + 15, pool.y[pSlot] + 8, ['#5ec2f7', '#ffd447', '#fffaf0'], nextTier >= 1 ? 3 : 2, params.sparkleDensity, {
          radiusMin: 18, radiusMax: 32, pull: 520, swirlSpeed: 36, maxLife: 0.28, sprite: nextTier >= 1 ? 'sparkle' : undefined,
        });
      }
    }
  } else if (sh.chargeSec > 0) {
    const relTier = getChargeTier(ctx.def, sh.chargeSec);
    if (relTier === 2) fireShmupChargeRelease(ctx, 2, events, params);
    else if (relTier === 1) fireShmupChargeRelease(ctx, 1, events, params);
    sh.chargeSec = 0;
    sh.chargeParticleTimer = 0;
  }

  if ((ctx.input.held('jump') || ctx.input.held('shoulderR')) && sh.shootCooldown <= 0) {
    fireShmupBolts(ctx, events);
  }

  syncFunnelSlots(ctx, simDt);

  // Wave & Boss scheduling
  let liveEnemyCount = 0;
  for (let i = 0; i < pool.activeCount; i++) {
    const s = pool.activeIndices[i];
    if ((pool.flags[s] & (EF_ENEMY | EF_BULLET | EF_BOSS | EF_WEAK_POINT)) === EF_ENEMY) {
      liveEnemyCount++;
    }
  }

  if (ctx.bossSlot < 0) {
    sh.waveTimer += simDt;
    if (sh.waveTimer > 4.2 || liveEnemyCount === 0) {
      sh.waveTimer = 0;
      spawnShmupWaveFromJson(ctx);
    }
  } else {
    stepShmupBossSlot(ctx, simDt);
  }

  stepShmupPoolEntities(ctx, simDt, events, params);
}

function stepShmupBossSlot(ctx: ShmupRuntimeContext, simDt: number): void {
  const bs = ctx.bossSlot;
  if (bs < 0 || (ctx.pool.flags[bs] & EF_ALIVE) === 0) return;
  const pool = ctx.pool;
  if (pool.x[bs] > 256) pool.x[bs] -= 48 * simDt;
  const phase = pool.aiState[bs] === 2 ? 2 : 1;
  const waveSpeed = (phase === 2 ? 2.45 : 1.65) + ctx.stageIdx * 0.22;
  pool.y[bs] = 78 + Math.sin(ctx.juice.visualTime * waveSpeed) * 44;

  pool.timerA[bs] -= simDt;
  if (pool.timerA[bs] <= 0) {
    pool.timerB[bs]++;
    const baseCd = phase === 2 ? 0.54 : 0.96;
    pool.timerA[bs] = Math.max(0.42, baseCd - ctx.stageIdx * 0.08);
    const spread = phase === 1 ? (ctx.stageIdx >= 2 ? [-42, -14, 14, 42] : [-30, 0, 30]) : [-52, -26, 0, 26, 52];
    for (let i = 0; i < spread.length; i++) {
      spawnBulletSlot(ctx, pool.x[bs], pool.y[bs] + 8, -(118 + ctx.stageIdx * 12), spread[i], true, 1, 10, 10, { colorPaletteRow: 1 });
    }
  }

  for (let i = 0; i < pool.activeCount; i++) {
    const s = pool.activeIndices[i];
    if ((pool.flags[s] & EF_WEAK_POINT) === 0 || pool.parentSlot[s] !== bs) continue;
    pool.x[s] = pool.x[bs] + pool.paramA[s];
    pool.y[s] = pool.y[bs] + pool.paramB[s];
    pool.timerA[s] -= simDt;
    if (pool.timerA[s] <= 0) {
      pool.timerA[s] = phase === 2 ? 1.25 : 1.7;
      const dx = pool.x[ctx.playerSlot] - pool.x[s];
      const dy = pool.y[ctx.playerSlot] - (pool.y[s] + 6);
      const len = Math.max(1, Math.hypot(dx, dy));
      const spd = 105 + ctx.stageIdx * 8;
      spawnBulletSlot(ctx, pool.x[s], pool.y[s] + 6, (dx / len) * spd, (dy / len) * spd, true, 1, 10, 10, { colorPaletteRow: 7 });
    }
  }
}

function stepShmupPoolEntities(
  ctx: ShmupRuntimeContext,
  simDt: number,
  events: SimEvent[],
  params: RuntimeParams,
): void {
  const pool = ctx.pool;
  const sh = ctx.shmup;
  const px = pool.x[ctx.playerSlot];
  const py = pool.y[ctx.playerSlot];
  const grazeCfg = ctx.def.player.graze;
  const bulletHitR = grazeCfg?.hitRadius ?? 5.5;
  const enemyHitR = grazeCfg?.enemyHitRadius ?? 11.5;
  const grazeR = grazeCfg?.grazeRadius ?? 18;
  const overdriveCost = grazeCfg?.overdriveCost ?? 100;
  const overdriveSec = grazeCfg?.overdriveSec ?? 3.6;

  // Gather active non-bullet target slots once so EF_HOMING avoids O(H * N) full-pool scans
  let enemyTargetCount = 0;
  for (let i = 0; i < pool.activeCount; i++) {
    const t = pool.activeIndices[i];
    const tf = pool.flags[t];
    if ((tf & EF_ALIVE) === 0 || (tf & EF_BULLET) !== 0) continue;
    if ((tf & (EF_ENEMY | EF_BOSS | EF_WEAK_POINT)) !== 0) {
      sh.targetEnemySlots[enemyTargetCount++] = t;
    }
  }

  let playerBulletCount = 0;

  // Pass 1: Move entities, process pickups, enemy-bullet grazing/hits, and enemy AI
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.activeIndices[i];
    if (s === ctx.playerSlot || s === ctx.bossSlot || (pool.flags[s] & EF_ALIVE) === 0) continue;
    const f = pool.flags[s];

    if ((f & EF_WEAK_POINT) !== 0 || (pool.behaviorMask[s] & BM_ORBIT) !== 0) continue;

    // 1. Homing player bullets (scan compact targetEnemySlots instead of full active pool)
    if ((f & EF_BULLET) !== 0 && (f & EF_ENEMY) === 0 && (f & EF_HOMING) !== 0 && enemyTargetCount > 0) {
      let bestDistSq = Infinity;
      let tx = 0;
      let ty = 0;
      let found = false;
      const sxPos = pool.x[s];
      const syPos = pool.y[s];
      for (let j = 0; j < enemyTargetCount; j++) {
        const t = sh.targetEnemySlots[j];
        if ((pool.flags[t] & EF_ALIVE) === 0) continue;
        const tcx = pool.x[t] + pool.w[t] * 0.5;
        const tcy = pool.y[t] + pool.h[t] * 0.5;
        const dx = tcx - sxPos;
        const dy = tcy - syPos;
        const dSq = dx * dx + dy * dy;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          tx = tcx;
          ty = tcy;
          found = true;
        }
      }
      if (found) {
        const desired = Math.atan2(ty - syPos, tx - sxPos);
        const cur = Math.atan2(pool.vy[s], pool.vx[s]);
        let diff = desired - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = 5.5 * simDt;
        const nextAng = cur + clamp(diff, -maxTurn, maxTurn);
        const spd = pool.maxHp[s] > 10 ? pool.maxHp[s] : 230;
        pool.vx[s] = Math.cos(nextAng) * spd;
        pool.vy[s] = Math.sin(nextAng) * spd;
        pool.rot[s] = nextAng;
      }
    }

    // 2. Integrate position
    pool.x[s] += pool.vx[s] * simDt;
    pool.y[s] += pool.vy[s] * simDt;
    if ((pool.behaviorMask[s] & BM_ROTATE) !== 0) pool.rot[s] += 3.6 * simDt;

    // 3. Pickups
    if ((f & EF_PICKUP) !== 0) {
      pool.y[s] = clamp(pool.y[s] + Math.sin(ctx.juice.visualTime * 3.5 + pool.paramA[s]) * 14 * simDt, 14, GAME_H - 18);
      if (pool.x[s] < -16) {
        pool.free(s);
        continue;
      }
      const dxp = px + 8 - (pool.x[s] + 7);
      const dyp = py + 8 - (pool.y[s] + 7);
      if (dxp * dxp + dyp * dyp < 17 * 17) {
        const aid = ctx.archetypeMetaByIdx[pool.archetypeIdx[s]]?.id ?? '';
        pool.free(s);
        ctx.starsCollected++;
        ctx.juice.registerCombo();
        events.push('star');
        ctx.score += 80;
        if (aid === 'pickup_bomb') {
          if (ctx.shmup.bombs < ctx.shmup.maxBombs) ctx.shmup.bombs++;
          else ctx.score += 150;
        } else if (aid === 'pickup_funnel') {
          if (ctx.shmup.funnelCount < 2) ctx.shmup.funnelCount = 2;
          else if (ctx.shmup.funnelCount < 4) ctx.shmup.funnelCount = 4;
          else ctx.shmup.funnelOverdriveTimer = Math.max(ctx.shmup.funnelOverdriveTimer, 3.5);
        } else if (aid === 'pickup_heal') {
          if (ctx.hearts < ctx.maxHearts) ctx.hearts++;
          else ctx.score += 120;
        } else {
          const wt = aid === 'pickup_azure' ? 'azure' : aid === 'pickup_violet' ? 'violet' : 'crimson';
          if (ctx.shmup.weaponKind === wt) {
            if (ctx.shmup.weaponLevel < 3) ctx.shmup.weaponLevel = (ctx.shmup.weaponLevel + 1) as 1 | 2 | 3;
            else ctx.score += 140;
          } else {
            ctx.shmup.weaponKind = wt;
          }
        }
      }
      continue;
    }

    // 4. Bullets
    if ((f & EF_BULLET) !== 0) {
      const bx = pool.x[s] + pool.w[s] * 0.5;
      const by = pool.y[s] + pool.h[s] * 0.5;
      if (bx < -28 || bx > GAME_W + 32 || by < -18 || by > GAME_H + 18) {
        pool.free(s);
        continue;
      }

      if ((f & EF_ENEMY) !== 0) {
        const dxe = px + 8 - bx;
        const dye = py + 8 - by;
        const distSq = dxe * dxe + dye * dye;
        const shieldR = grazeR + 4;
        if (ctx.shmup.overdriveShieldTimer > 0 && distSq < shieldR * shieldR) {
          pool.free(s);
          ctx.score += 15;
          continue;
        }
        if (ctx.shmup.invulnTimer <= 0 && distSq < bulletHitR * bulletHitR) {
          pool.free(s);
          damagePlayerShip(ctx, events, params);
        } else if (pool.aiState[s] === 0 && distSq < grazeR * grazeR) {
          pool.aiState[s] = 1;
          ctx.shmup.grazeCount++;
          ctx.shmup.grazeMeter = Math.min(overdriveCost, ctx.shmup.grazeMeter + 10);
          ctx.score += 20;
          if (ctx.input.held('action')) ctx.shmup.chargeSec += 0.08;
          events.push('snap');
          if (ctx.shmup.grazeMeter >= overdriveCost) {
            ctx.shmup.grazeMeter = 0;
            ctx.shmup.overdriveShieldTimer = overdriveSec;
            events.push('key');
          }
        }
        continue;
      }

      sh.playerBulletSlots[playerBulletCount++] = s;
      continue;
    }

    // 5. Enemies AI
    if ((f & EF_ENEMY) !== 0) {
      const aid = pool.archetypeIdx[s] >= 0 ? ctx.archetypeMetaByIdx[pool.archetypeIdx[s]].id : '';
      if (aid === 'jelly') {
        pool.y[s] += Math.sin(ctx.juice.visualTime * 3.5 + pool.paramA[s]) * 40 * simDt;
      } else if (aid === 'cargo') {
        pool.y[s] += Math.sin(ctx.juice.visualTime * 2.4 + pool.paramA[s]) * 24 * simDt;
      } else if (aid === 'interceptor') {
        if (pool.aiState[s] === 0 && pool.x[s] < GAME_W - 60) {
          pool.aiState[s] = 1;
          pool.vx[s] = -155 - ctx.stageIdx * 12;
          pool.vy[s] = clamp((py - pool.y[s]) * 0.9, -65, 65);
          spawnBulletSlot(ctx, pool.x[s], pool.y[s] + 8, -145, 0, true, 1, 10, 10, { colorPaletteRow: 1 });
        }
      } else if (aid === 'frigate') {
        pool.timerA[s] -= simDt;
        if (pool.timerA[s] <= 0 && pool.x[s] < GAME_W - 14 && pool.x[s] > 52) {
          pool.timerA[s] = 1.65 - ctx.stageIdx * 0.08;
          for (const dy of [-32, 0, 32]) {
            spawnBulletSlot(ctx, pool.x[s], pool.y[s] + 8, -118, dy, true, 1, 10, 10, { colorPaletteRow: 7 });
          }
        }
      } else if (aid === 'carrier') {
        pool.timerA[s] -= simDt;
        if (pool.timerA[s] <= 0 && pool.x[s] < GAME_W - 16 && pool.x[s] > 64) {
          pool.timerA[s] = 1.95 - ctx.stageIdx * 0.1;
          const m = ctx.spawnArchetype('missile', pool.x[s] - 4, pool.y[s] + 6, -95 - ctx.stageIdx * 8, 0);
          if (m >= 0) pool.behaviorMask[m] |= BM_HOMING;
        }
      } else if (aid === 'missile') {
        const steer = clamp((py - pool.y[s]) * 2.4, -55, 55);
        pool.vy[s] += (steer - pool.vy[s]) * Math.min(1, simDt * 4.5);
        pool.rot[s] = Math.atan2(pool.vy[s], pool.vx[s]) + Math.PI;
      }

      pool.y[s] = clamp(pool.y[s], 12, GAME_H - 22);
      if (pool.x[s] < -26) {
        pool.free(s);
        continue;
      }
      if (ctx.shmup.invulnTimer <= 0 && ctx.shmup.overdriveShieldTimer <= 0) {
        const dxShip = px + 8 - (pool.x[s] + 8);
        const dyShip = py + 8 - (pool.y[s] + 8);
        if (dxShip * dxShip + dyShip * dyShip < enemyHitR * enemyHitR) {
          damagePlayerShip(ctx, events, params);
        }
      }
    }
  }

  if (playerBulletCount === 0) return;

  // Pass 2: SpatialHash O(1) broad-phase index over live enemies, weak points, bosses, and enemy bullets
  const th = sh.targetHash;
  th.clear();
  for (let i = 0; i < pool.activeCount; i++) {
    const t = pool.activeIndices[i];
    const tf = pool.flags[t];
    if ((tf & EF_ALIVE) === 0) continue;
    if ((tf & (EF_ENEMY | EF_BOSS | EF_WEAK_POINT)) !== 0) {
      th.insertBox(t, pool.x[t], pool.y[t], pool.w[t], pool.h[t]);
    }
  }

  for (let bIdx = 0; bIdx < playerBulletCount; bIdx++) {
    const s = sh.playerBulletSlots[bIdx];
    const f = pool.flags[s];
    if ((f & EF_ALIVE) === 0) continue;

    const bx = pool.x[s] + pool.w[s] * 0.5;
    const by = pool.y[s] + pool.h[s] * 0.5;
    const hitCount = th.queryRect(bx - 19, by - 19, bx + 19, by + 19, sh.querySlots);
    if (hitCount === 0) continue;

    const piercing = (f & EF_PIERCING) !== 0;
    const clears = (f & EF_CLEARS_BULLETS) !== 0;

    if (clears) {
      for (let k = 0; k < hitCount; k++) {
        const eb = sh.querySlots[k];
        if (eb === s || (pool.flags[eb] & (EF_ALIVE | EF_BULLET | EF_ENEMY)) !== (EF_ALIVE | EF_BULLET | EF_ENEMY)) continue;
        if (Math.abs(pool.x[eb] - bx) < 15 && Math.abs(pool.y[eb] - by) < 12) {
          pool.free(eb);
          ctx.score += 10;
        }
      }
    }

    const dmg = pool.hp[s];
    const gId = piercing ? Math.floor(pool.paramD[s]) : -1;
    let hit = false;
    for (let j = 0; j < hitCount; j++) {
      const t = sh.querySlots[j];
      const tf = pool.flags[t];
      if ((tf & EF_ALIVE) === 0 || (tf & EF_BULLET) !== 0) continue;
      if ((tf & (EF_ENEMY | EF_BOSS | EF_WEAK_POINT)) === 0) continue;
      if (piercing && ctx.lastHitGroupByTarget[t] === gId) continue;

      const rad = (tf & EF_BOSS) !== 0 ? 18 : piercing ? 16 : 12;
      const dx = bx - (pool.x[t] + pool.w[t] * 0.5);
      const dy = by - (pool.y[t] + pool.h[t] * 0.5);
      if (dx * dx + dy * dy < rad * rad) {
        hit = true;
        if (piercing) ctx.lastHitGroupByTarget[t] = gId;
        if ((tf & EF_BOSS) !== 0) {
          if (damageShmupBossSlot(ctx, dmg, events, params.sparkleDensity)) return;
        } else if ((tf & EF_WEAK_POINT) !== 0) {
          pool.hp[t] = Math.max(0, pool.hp[t] - dmg);
          pool.flash[t] = 0.18;
          ctx.score += 30;
          if (pool.hp[t] === 0) {
            const wx = pool.x[t] + 8;
            const wy = pool.y[t] + 8;
            pool.free(t);
            ctx.score += 220;
            ctx.juice.addTrauma(0.45);
            events.push('explode');
            ctx.spawnArchetype(ctx.shmup.bombs < ctx.shmup.maxBombs ? 'pickup_bomb' : 'pickup_funnel', wx, wy, -44, 0);
            if (damageShmupBossSlot(ctx, 4, events, params.sparkleDensity)) return;
          }
        } else {
          pool.hp[t] -= dmg;
          pool.flash[t] = 0.16;
          if (pool.hp[t] <= 0) {
            destroyShmupEnemySlot(ctx, t, events, params.sparkleDensity);
          }
        }
        if (!piercing) break;
      }
    }
    if (hit && !piercing && (pool.flags[s] & EF_ALIVE) !== 0) {
      pool.free(s);
    }
  }
}

function damagePlayerShip(ctx: ShmupRuntimeContext, events: SimEvent[], params: RuntimeParams): void {
  ctx.hearts--;
  ctx.shmup.invulnTimer = 1.35;
  ctx.pool.flash[ctx.playerSlot] = 0.38;
  events.push('hurt');
  ctx.juice.applyPreset('player_hurt', { dirX: -1, dirY: 0, intensity: 1.0 });
  ctx.juice.triggerFlash('#ff708d', 0.28);
  ctx.juice.spawnBurst(ctx.pool.x[ctx.playerSlot] + 8, ctx.pool.y[ctx.playerSlot] + 8, ['#ff708d', '#ffd447'], 8, params.sparkleDensity, { gravity: 0, liftY: 0 });
  if (ctx.hearts <= 0) {
    ctx.shmup.phase = 'lost';
    ctx.status = 'lost';
  }
}

export function buildShmupHudFromPool(ctx: ShmupRuntimeContext): ShmupHudSnapshot {
  const stage = ctx.def.stages[ctx.stageIdx];
  const chargeTier = getChargeTier(ctx.def, ctx.shmup.chargeSec);
  const t2 = ctx.def.player.charge?.tier2Sec ?? 1.08;
  const vfxStart = ctx.def.player.charge?.vfxStartSec ?? 0.14;
  let activeWp = 0;
  let funnelCount = 0;
  for (let i = 0; i < ctx.pool.activeCount; i++) {
    const s = ctx.pool.activeIndices[i];
    if ((ctx.pool.flags[s] & EF_WEAK_POINT) !== 0 && ctx.pool.hp[s] > 0) activeWp++;
    if ((ctx.pool.behaviorMask[s] & BM_ORBIT) !== 0) funnelCount++;
  }

  return {
    phase: ctx.shmup.phase,
    selectedFighterId: ctx.shmup.fighterId,
    fighters: ctx.shmup.cachedFighters,
    weaponKind: ctx.shmup.weaponKind,
    weaponLevel: ctx.shmup.weaponLevel,
    bombs: ctx.shmup.bombs,
    maxBombs: ctx.shmup.maxBombs,
    grazeMeter: ctx.shmup.grazeMeter,
    grazeCount: ctx.shmup.grazeCount,
    overdriveTimer: ctx.shmup.overdriveShieldTimer,
    funnelCount,
    hearts: Math.max(0, ctx.hearts),
    maxHearts: ctx.maxHearts,
    chargeTier,
    chargeRatio: ctx.shmup.chargeSec >= vfxStart ? clamp(ctx.shmup.chargeSec / t2, 0.08, 1.0) : 0,
    sectorName: stage.name,
    waveIndex: Math.min(ctx.shmup.waveIndex, stage.waves?.count ?? 1),
    waveTotal: stage.waves?.count ?? 1,
    boss:
      ctx.bossSlot >= 0
        ? {
            name: stage.boss?.name ?? 'BOSS',
            hp: Math.max(0, ctx.pool.hp[ctx.bossSlot]),
            maxHp: ctx.pool.maxHp[ctx.bossSlot],
            phase: ctx.pool.aiState[ctx.bossSlot] === 2 ? 2 : 1,
            activeWeakPoints: activeWp,
          }
        : undefined,
  };
}
