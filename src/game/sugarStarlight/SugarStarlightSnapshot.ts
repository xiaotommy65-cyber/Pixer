import {
  clamp,
  type BgStarDesc,
  type DebugRectDesc,
  type EntityDesc,
  type LightDesc,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type ShmupHudSnapshot,
} from '../../core/types/WorldTypes.ts';
import {
  CHARGE_TIER2_SEC,
  CHARGE_VFX_START_SEC,
  CORE_BULLET_HIT_RADIUS,
  FIGHTER_CATALOG,
  MAX_BOMBS,
  MAX_HEARTS_CAP,
  SECTORS,
  WEAPON_CATALOG,
  getFighterProfile,
} from './SugarStarlightData.ts';
import type { ShmupArenaState } from './SugarStarlightWeapons.ts';

export interface ShmupSnapshotSource extends ShmupArenaState {
  bgStars: BgStarDesc[];
  debugHitboxes: boolean;
  getStatus(): 'playing' | 'won' | 'lost';
}

export function buildShmupSnapshot(state: ShmupSnapshotSource, params: RuntimeParams): RenderSceneSnapshot {
  const chargeTier = state.getChargeTier();
  const sector = SECTORS[state.sectorIdx];
  const profile = getFighterProfile(state.ship.fighterId);
  const entities: EntityDesc[] = [];
  const lights: LightDesc[] = [];
  const glow = params.glowIntensity;
  const t = state.juice.visualTime;

  for (let i = 0; i < state.pickups.length; i++) {
    const p = state.pickups[i];
    const sprite =
      p.kind === 'bomb'
        ? 'pickup_bomb'
        : p.kind === 'funnel'
          ? 'option_orb'
          : p.kind === 'heal'
            ? 'heart_full'
            : 'pickup_crystal';
    const tint =
      p.kind === 'weapon_crimson'
        ? '#ff708d'
        : p.kind === 'weapon_azure'
          ? '#5ec2f7'
          : p.kind === 'weapon_violet'
            ? '#e0aaff'
            : undefined;
    entities.push({ id: `pk-${i}`, sprite, tint, x: p.x, y: p.y, w: 14, h: 14 });
    if (glow > 0.05) {
      lights.push({ x: p.x + 7, y: p.y + 7, radius: 22, color: tint ?? '#ffd447', intensity: 0.42 * glow });
    }
  }

  for (const e of state.enemies) {
    let sprite: EntityDesc['sprite'] = 'jelly_ufo';
    let tint: string | undefined;
    let w = 16;
    let h = 16;
    if (e.kind === 'meteor') sprite = 'meteor';
    else if (e.kind === 'interceptor') sprite = 'enemy_interceptor';
    else if (e.kind === 'frigate') {
      sprite = 'enemy_frigate';
      w = 20;
      h = 18;
    } else if (e.kind === 'carrier') {
      sprite = 'enemy_carrier';
      w = 18;
      h = 16;
    } else if (e.kind === 'missile') {
      sprite = 'missile_pod';
      w = 13;
      h = 10;
    } else if (e.kind === 'cargo') {
      sprite = 'pickup_crystal';
      const cycle = Math.floor(t / 1.1) % 4;
      tint = cycle === 0 ? '#ff708d' : cycle === 1 ? '#5ec2f7' : cycle === 2 ? '#e0aaff' : '#ffd447';
    }

    entities.push({
      id: e.id,
      sprite,
      tint,
      x: e.x,
      y: e.y,
      w,
      h,
      rot: e.rot,
      flash: Math.min(1, e.flashTimer * 5),
    });
    if (e.kind !== 'meteor' && glow > 0.05) {
      lights.push({
        x: e.x + w * 0.5,
        y: e.y + h * 0.5,
        radius: 22,
        color: tint ?? (e.kind === 'frigate' ? '#ff9048' : '#e0aaff'),
        intensity: 0.28 * glow,
      });
    }
  }

  if (state.boss) {
    const bossTint =
      state.boss.phase === 2
        ? Math.floor(t * 8) % 2 === 0
          ? '#ff708d'
          : '#e0aaff'
        : state.sectorIdx === 1
          ? '#ffb36b'
          : state.sectorIdx === 2
            ? '#6fffe9'
            : undefined;
    entities.push({
      id: 'boss-ufo',
      sprite: 'boss_ufo',
      tint: bossTint,
      x: state.boss.x,
      y: state.boss.y,
      w: 32,
      h: 16,
      flash: Math.min(1, state.boss.flash * 6),
    });
    for (const wp of state.boss.weakPoints) {
      if (wp.hp <= 0) continue;
      entities.push({
        id: wp.id,
        sprite: 'boss_wing',
        tint: state.boss.phase === 2 ? '#ff708d' : '#ffd447',
        x: state.boss.x + wp.offsetX,
        y: state.boss.y + wp.offsetY,
        w: 16,
        h: 12,
        flash: Math.min(1, wp.flash * 6),
      });
    }
    if (glow > 0.05) {
      lights.push({
        x: state.boss.x + 16,
        y: state.boss.y + 8,
        radius: state.boss.phase === 2 ? 56 : 44,
        color: state.boss.phase === 2 ? '#ff708d' : '#ffd447',
        intensity: 0.6 * glow,
      });
    }
  }

  for (let i = 0; i < state.bullets.length; i++) {
    const b = state.bullets[i];
    const bw = b.width ?? (b.piercing ? 22 : b.fromEnemy ? 10 : 12);
    const bh = b.height ?? (b.piercing ? 10 : b.fromEnemy ? 10 : 12);
    entities.push({
      id: `b-${i}`,
      sprite: b.piercing ? 'laser_beam' : b.fromEnemy ? 'sparkle' : 'bolt',
      x: b.x - bw * 0.5,
      y: b.y - bh * 0.5,
      w: bw,
      h: bh,
      rot: (b.piercing || b.homing) && (b.vy !== 0 || b.vx < 0) ? Math.atan2(b.vy, b.vx) : undefined,
      tint: b.color,
      additive: b.fromEnemy,
    });
    if (glow > 0.05) {
      lights.push({
        x: b.x,
        y: b.y,
        radius: b.piercing ? 18 : b.fromEnemy ? 14 : 16,
        color: b.color,
        intensity: (b.piercing ? 0.28 : 0.3) * glow,
      });
    }
  }

  for (let i = 0; i < state.funnels.length; i++) {
    const f = state.funnels[i];
    const over = state.ship.funnelOverdriveTimer > 0 || state.ship.overdriveShieldTimer > 0 || chargeTier === 2;
    entities.push({
      id: `funnel-${i}`,
      sprite: 'option_orb',
      x: f.x,
      y: f.y,
      w: 11,
      h: 11,
      rot: f.rot,
      tint: over ? (i % 2 === 0 ? '#ffd447' : '#ff8ec6') : undefined,
    });
    if (glow > 0.05) {
      lights.push({
        x: f.x + 5.5,
        y: f.y + 5.5,
        radius: over ? 18 : 14,
        color: over ? '#ffd447' : '#5ec2f7',
        intensity: (over ? 0.34 : 0.22) * glow,
      });
    }
  }

  const blink = state.ship.invulnTimer > 0 && Math.floor(state.ship.invulnTimer * 16) % 2 === 1;
  if (!blink || state.ship.flash > 0) {
    entities.push({
      id: 'ship',
      sprite: Math.floor(t * 12) % 2 === 0 ? profile.spriteA : profile.spriteB,
      x: state.ship.x,
      y: state.ship.y,
      w: 16,
      h: 16,
      rot: state.ship.rot,
      scaleX: state.ship.squash.scaleX,
      scaleY: state.ship.squash.scaleY,
      flash: Math.min(1, state.ship.flash * 4),
    });
  }

  if (state.ship.overdriveShieldTimer > 0) {
    entities.push({
      id: 'overdrive-shield',
      sprite: 'option_orb',
      x: state.ship.x - 4,
      y: state.ship.y - 4,
      w: 24,
      h: 24,
      rot: t * 9,
      tint: '#ffd447',
      alpha: 0.42,
      additive: true,
    });
  }

  if (state.ship.chargeSec >= CHARGE_VFX_START_SEC) {
    const ratio = clamp(state.ship.chargeSec / CHARGE_TIER2_SEC, 0.2, 1.0);
    const orbSize = 5 + ratio * 6 + Math.sin(t * 28) * 1.2;
    entities.push({
      id: 'charge-core',
      sprite: 'sparkle',
      x: state.ship.x + 15 - orbSize * 0.5,
      y: state.ship.y + 8 - orbSize * 0.5,
      w: orbSize,
      h: orbSize,
      rot: t * 8,
      tint: chargeTier === 2 ? '#ffd447' : chargeTier === 1 ? '#5ec2f7' : '#fffaf0',
      additive: true,
    });
  }

  if (glow > 0.05) {
    lights.push({
      x: state.ship.x + 10,
      y: state.ship.y + 8,
      radius: state.ship.overdriveShieldTimer > 0 ? 40 : chargeTier === 2 ? 32 : chargeTier === 1 ? 26 : 20,
      color: state.ship.overdriveShieldTimer > 0 ? '#ffd447' : profile.accentHex,
      intensity: (chargeTier >= 1 || state.ship.overdriveShieldTimer > 0 ? 0.48 : 0.32) * glow,
    });
  }

  let debugRects: DebugRectDesc[] | undefined;
  if (state.debugHitboxes) {
    debugRects = [
      {
        x: state.ship.x + 8 - CORE_BULLET_HIT_RADIUS,
        y: state.ship.y + 8 - CORE_BULLET_HIT_RADIUS,
        w: CORE_BULLET_HIT_RADIUS * 2,
        h: CORE_BULLET_HIT_RADIUS * 2,
        color: '#ffd447',
      },
    ];
    for (const e of state.enemies) {
      debugRects.push({ x: e.x, y: e.y, w: 16, h: 16, color: '#ff708d' });
    }
    if (state.boss) {
      debugRects.push({ x: state.boss.x, y: state.boss.y, w: 32, h: 16, color: '#e0aaff' });
      for (const wp of state.boss.weakPoints) {
        if (wp.hp > 0) {
          debugRects.push({ x: state.boss.x + wp.offsetX, y: state.boss.y + wp.offsetY, w: 16, h: 12, color: '#ffd447' });
        }
      }
    }
  }

  const chargeNote =
    chargeTier === 2
      ? `💠 LV.2 【${profile.ultLabel}】就緒！放開 A 釋放！`
      : chargeTier === 1
        ? '⚡ LV.1 貫穿砲就緒！放開 A 發射，或續按凝聚超必殺…'
        : state.ship.chargeSec >= CHARGE_VFX_START_SEC
          ? '✨ 粒子凝聚中… 持續按住 A 蓄力！'
          : '';

  const wMeta = WEAPON_CATALOG[state.ship.weaponKind];
  const defaultBanner =
    state.phase === 'hangar'
      ? `🛫 整備庫｜${profile.name} (${profile.code}) — 選擇機體後按 A 或點擊「出擊」`
      : `${profile.name} · ${wMeta.shortLabel} Lv.${state.ship.weaponLevel} · 💣×${state.ship.bombs} · 擦彈反擊 ${state.ship.grazeMeter}%`;

  const shmupHud: ShmupHudSnapshot = {
    phase: state.phase,
    selectedFighterId: state.ship.fighterId,
    fighters: FIGHTER_CATALOG.map((f) => ({
      id: f.id,
      name: f.name,
      code: f.code,
      tagline: f.tagline,
      speedStat: f.speedStat,
      armorStat: f.armorStat,
      fireStat: f.fireStat,
      ultLabel: f.ultLabel,
      accentHex: f.accentHex,
    })),
    weaponKind: state.ship.weaponKind,
    weaponLevel: state.ship.weaponLevel,
    bombs: state.ship.bombs,
    maxBombs: MAX_BOMBS,
    grazeMeter: state.ship.grazeMeter,
    grazeCount: state.ship.grazeCount,
    overdriveTimer: state.ship.overdriveShieldTimer,
    funnelCount: state.ship.funnelCount,
    hearts: Math.max(0, state.ship.hearts),
    maxHearts: state.ship.maxHearts,
    chargeTier,
    chargeRatio: clamp(state.ship.chargeSec / CHARGE_TIER2_SEC, 0, 1),
    sectorName: sector.name,
    waveIndex: state.waveIndex,
    waveTotal: sector.waveCount,
    boss: state.boss
      ? {
          name: sector.bossName,
          hp: Math.max(0, state.boss.hp),
          maxHp: state.boss.maxHp,
          phase: state.boss.phase,
          activeWeakPoints: state.boss.weakPoints.filter((w) => w.hp > 0).length,
        }
      : undefined,
  };

  return {
    cartridgeId: 'sugar-starlight',
    skyTop: sector.skyTop,
    skyBottom: sector.skyBottom,
    cozyFilter: params.cozyFilter > 0.5,
    timeSec: t,
    elapsedSec: state.elapsedSec,
    status: state.getStatus(),
    score: state.score,
    comboCount: state.juice.comboCount,
    starsCollected: state.starsCollected,
    starsTotal: 12,
    hasKey: state.ship.funnelCount >= 2,
    hearts: Math.max(0, state.ship.hearts),
    maxHearts: Math.min(MAX_HEARTS_CAP, state.ship.maxHearts),
    bossHp: state.boss?.hp ?? 0,
    bossMaxHp: state.boss?.maxHp ?? 0,
    cameraX: state.juice.shakeX,
    cameraY: state.juice.shakeY,
    screenFlashAlpha: state.juice.flashAlpha,
    screenFlashColor: state.juice.flashColor,
    bgStars: state.bgStars,
    bgClouds: [],
    tiles: [],
    entities,
    particles: state.juice.particles,
    lights,
    debugRects,
    statusBanner: chargeNote || (state.noticeTimer > 0 ? state.noticeText : defaultBanner),
    stage: {
      index: state.sectorIdx + 1,
      total: SECTORS.length,
      name: sector.name,
    },
    bgmTheme: state.boss ? 'boss' : 'starlight',
    shmupHud,
  };
}
