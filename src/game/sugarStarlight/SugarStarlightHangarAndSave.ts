import { clamp, type RuntimeParams, type SimEvent } from '../../core/types/WorldTypes.ts';
import {
  CHARGE_VFX_START_SEC,
  FIGHTER_CATALOG,
  MAX_BOMBS,
  SECTORS,
  WEAPON_CATALOG,
  getFighterProfile,
  type FighterId,
  type WeaponKind,
  type WeaponLevel,
} from './SugarStarlightData.ts';
import {
  fireBolts,
  fireFighterTier2Ult,
  firePiercingCannon,
  type ShmupArenaState,
} from './SugarStarlightWeapons.ts';

export interface SugarStarlightSavePayload {
  v?: number;
  sectorIdx?: number;
  score?: number;
  starsCollected?: number;
  fighterId?: FighterId;
  hearts?: number;
  spreadLevel?: number;
  weaponKind?: WeaponKind;
  weaponLevel?: number;
  bombs?: number;
  funnelCount?: number;
  hasOptions?: boolean;
  grazeCount?: number;
  grazeMeter?: number;
}

export function stepShmupHangarSelection(
  state: ShmupArenaState,
  dt: number,
  selectedFighterIdx: number,
  hangarNavCooldown: number,
  events: SimEvent[],
  actions: {
    applyFighterLoadout: (id: FighterId) => void;
    launchSortie: (id: FighterId) => void;
  },
): { selectedFighterIdx: number; hangarNavCooldown: number; launched: boolean } {
  let nextIdx = selectedFighterIdx;
  let nextCd = hangarNavCooldown > 0 ? Math.max(0, hangarNavCooldown - dt) : 0;

  if (
    state.input.justPressed('left') ||
    state.input.justPressed('up') ||
    state.input.justPressed('shoulderL') ||
    ((state.input.held('left') || state.input.held('up') || state.input.rightAxisX() < -0.55) && nextCd <= 0)
  ) {
    nextIdx = (nextIdx - 1 + FIGHTER_CATALOG.length) % FIGHTER_CATALOG.length;
    actions.applyFighterLoadout(FIGHTER_CATALOG[nextIdx].id);
    nextCd = 0.25;
    events.push('snap');
  } else if (
    state.input.justPressed('right') ||
    state.input.justPressed('down') ||
    state.input.justPressed('shoulderR') ||
    state.input.justPressed('skillX') ||
    ((state.input.held('right') || state.input.held('down') || state.input.rightAxisX() > 0.55) && nextCd <= 0)
  ) {
    nextIdx = (nextIdx + 1) % FIGHTER_CATALOG.length;
    actions.applyFighterLoadout(FIGHTER_CATALOG[nextIdx].id);
    nextCd = 0.25;
    events.push('snap');
  }

  if (state.input.justPressed('skillY')) {
    const p = FIGHTER_CATALOG[nextIdx];
    state.noticeText = `✨ ${p.name}：${p.ultLabel} · ${p.tagline}`;
    state.noticeTimer = 2.6;
    events.push('snap');
  }

  if (
    state.input.justPressed('action') ||
    state.input.justPressed('jump') ||
    state.input.held('action') ||
    state.input.held('jump')
  ) {
    actions.launchSortie(FIGHTER_CATALOG[nextIdx].id);
    events.push('key');
    return { selectedFighterIdx: nextIdx, hangarNavCooldown: nextCd, launched: true };
  }

  return { selectedFighterIdx: nextIdx, hangarNavCooldown: nextCd, launched: false };
}

export function stepShmupChargeAndFire(
  state: ShmupArenaState,
  simDt: number,
  chargeParticleTimer: number,
  events: SimEvent[],
  params: RuntimeParams,
): number {
  let nextTimer = chargeParticleTimer;
  const actionHeld = state.input.held('action');
  const jumpHeld = state.input.held('jump');

  if (state.input.justPressed('action') && state.ship.shootCooldown <= 0) {
    fireBolts(state, events);
  }

  if (actionHeld) {
    const prevTier = state.getChargeTier();
    const overdriveBoost = state.ship.funnelOverdriveTimer > 0 || state.ship.overdriveShieldTimer > 0 ? 1.2 : 1.0;
    state.ship.chargeSec += simDt * overdriveBoost;
    const nextTier = state.getChargeTier();

    if (nextTier === 1 && prevTier === 0) {
      events.push('charge');
      state.juice.spawnBurst(state.ship.x + 15, state.ship.y + 8, ['#5ec2f7', '#fffaf0'], 8, params.sparkleDensity, {
        gravity: 0,
        liftY: 0,
        speedMin: 20,
        speedMax: 55,
      });
    } else if (nextTier === 2 && prevTier < 2) {
      events.push('star');
      state.juice.addTrauma(0.14);
      state.juice.spawnBurst(state.ship.x + 8, state.ship.y + 8, ['#ffd447', '#ff8ec6', '#5ec2f7'], 12, params.sparkleDensity, {
        gravity: 0,
        liftY: 0,
        speedMin: 28,
        speedMax: 74,
      });
    }

    if (state.ship.chargeSec >= CHARGE_VFX_START_SEC) {
      nextTimer -= simDt;
      if (nextTimer <= 0) {
        nextTimer = nextTier === 2 ? 0.036 : 0.048;
        const noseX = state.ship.x + 15;
        const noseY = state.ship.y + 8;
        const colors =
          nextTier === 2
            ? ['#ffd447', '#ff8ec6', '#8ce8ff', '#fffaf0']
            : nextTier === 1
              ? ['#5ec2f7', '#ffd447', '#fffaf0']
              : ['#5ec2f7', '#8ce8ff', '#fffaf0'];
        state.juice.spawnConverge(
          noseX,
          noseY,
          colors,
          nextTier === 2 ? 4 : nextTier === 1 ? 3 : 2,
          params.sparkleDensity,
          {
            radiusMin: 18,
            radiusMax: nextTier === 2 ? 36 : 29,
            pull: nextTier === 2 ? 620 : nextTier === 1 ? 520 : 420,
            swirlSpeed: nextTier === 2 ? 48 : 30,
            maxLife: 0.28,
            sprite: nextTier >= 1 ? 'sparkle' : undefined,
            sizeMin: 4,
            sizeMax: 6.5,
          },
        );
        if (nextTier === 2) {
          for (const f of state.funnels) {
            state.juice.spawnConverge(f.x + 6, f.y + 6, ['#ffd447', '#5ec2f7', '#fffaf0'], 2, params.sparkleDensity, {
              radiusMin: 10,
              radiusMax: 20,
              pull: 460,
              swirlSpeed: 40,
              maxLife: 0.24,
            });
          }
        }
      }
    }
  } else if (state.ship.chargeSec > 0) {
    const releaseTier = state.getChargeTier();
    if (releaseTier === 2) fireFighterTier2Ult(state, events, params);
    else if (releaseTier === 1) firePiercingCannon(state, events, params);
    state.ship.chargeSec = 0;
    nextTimer = 0;
  }

  if ((jumpHeld || state.input.held('shoulderR')) && state.ship.shootCooldown <= 0) {
    fireBolts(state, events);
  }
  return nextTimer;
}

export function serializeShmupSave(state: ShmupArenaState): unknown {
  return {
    v: 3,
    sectorIdx: state.sectorIdx,
    score: state.score,
    starsCollected: state.starsCollected,
    fighterId: state.ship.fighterId,
    hearts: state.ship.hearts,
    weaponKind: state.ship.weaponKind,
    weaponLevel: state.ship.weaponLevel,
    bombs: state.ship.bombs,
    funnelCount: state.ship.funnelCount,
    grazeCount: state.ship.grazeCount,
    grazeMeter: state.ship.grazeMeter,
  };
}

export function hydrateShmupSave(
  state: ShmupArenaState,
  raw: unknown,
  applyFighterLoadout: (fid: FighterId) => void,
  enterSector: (idx: number) => void,
): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as SugarStarlightSavePayload;
  if ((s.v !== 1 && s.v !== 2 && s.v !== 3) || typeof s.sectorIdx !== 'number') return false;

  const fid: FighterId = s.fighterId && FIGHTER_CATALOG.some((f) => f.id === s.fighterId) ? s.fighterId : 'starfalcon';
  applyFighterLoadout(fid);
  state.score = Number(s.score ?? 0);
  state.starsCollected = Number(s.starsCollected ?? 0);
  state.ship.hearts = clamp(Number(s.hearts ?? state.ship.maxHearts), 1, state.ship.maxHearts);
  state.ship.weaponKind = s.weaponKind && WEAPON_CATALOG[s.weaponKind] ? s.weaponKind : 'crimson';
  state.ship.weaponLevel = clamp(Number(s.weaponLevel ?? s.spreadLevel ?? 1), 1, 3) as WeaponLevel;
  state.ship.bombs = clamp(Number(s.bombs ?? getFighterProfile(fid).initialBombs), 0, MAX_BOMBS);
  state.ship.funnelCount = typeof s.funnelCount === 'number' ? clamp(s.funnelCount, 0, 4) : s.hasOptions ? 2 : 0;
  state.ship.grazeCount = Number(s.grazeCount ?? 0);
  state.ship.grazeMeter = clamp(Number(s.grazeMeter ?? 0), 0, 99);
  enterSector(s.sectorIdx);
  state.noticeText = `💾 已從 ${SECTORS[state.sectorIdx].name} 續航！`;
  state.noticeTimer = 3.0;
  return true;
}
