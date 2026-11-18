import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import { clamp } from '../../core/types/WorldTypes.ts';
import {
  findNearestTarget,
  spawnPlayerBullet,
  type ShmupArenaState,
} from './SugarStarlightWeapons.ts';

export function syncFunnelPool(state: ShmupArenaState, simDt: number): void {
  const chargeTier = state.getChargeTier();
  const desiredCount =
    state.ship.funnelOverdriveTimer > 0 || chargeTier === 2
      ? Math.max(2, state.ship.funnelCount)
      : state.ship.funnelCount;

  while (state.funnels.length < desiredCount) {
    state.funnels.push({
      x: state.ship.x + 4,
      y: state.ship.y + 4,
      vx: 0,
      vy: 0,
      rot: 0,
      fireTimer: 0.14 + state.funnels.length * 0.08,
    });
  }
  if (state.funnels.length > desiredCount) {
    state.funnels.length = desiredCount;
  }
  if (simDt <= 0 || state.funnels.length === 0) return;

  const total = state.funnels.length;
  const t = state.juice.visualTime;
  const isOrbitCharge = chargeTier === 2;
  const isOverdrive = state.ship.funnelOverdriveTimer > 0 || state.ship.overdriveShieldTimer > 0;
  const aimX = state.input.rightAxisX();
  const aimY = state.input.rightAxisY();
  const hasManualAim = Math.hypot(aimX, aimY) > 0.2;

  for (let i = 0; i < total; i++) {
    const f = state.funnels[i];
    let targetX = state.ship.x - 2;
    let targetY = state.ship.y + 2;

    if (isOrbitCharge) {
      const ang = t * 5.2 + (Math.PI * 2 * i) / total;
      targetX = state.ship.x + 2 + Math.cos(ang) * 24;
      targetY = state.ship.y + 2 + Math.sin(ang) * 24;
      f.rot = ang;
    } else if (isOverdrive) {
      const offsets = total <= 2 ? [-22, 26] : [-28, -14, 18, 32];
      const forward = total <= 2 ? 22 : i % 2 === 0 ? 26 : 16;
      targetX = state.ship.x + forward;
      targetY = state.ship.y + offsets[i % offsets.length] + Math.sin(t * 7 + i * 1.4) * 3 + (hasManualAim ? aimY * 14 : 0);
      f.rot += simDt * 6.5;
    } else {
      const offsets = total <= 2 ? [-18, 22] : [-24, -12, 16, 28];
      const xShift = total <= 2 ? 0 : i === 1 || i === 2 ? 6 : -4;
      targetX = state.ship.x + xShift;
      targetY = state.ship.y + offsets[i % offsets.length] + Math.sin(t * 5.5 + i * 1.6) * 2.2 + (hasManualAim ? aimY * 14 : 0);
      f.rot += simDt * 2.5;
    }

    targetX = clamp(targetX, 4, GAME_W - 16);
    targetY = clamp(targetY, 10, GAME_H - 16);

    const spring = isOrbitCharge ? 18 : 13;
    const blend = Math.min(1, simDt * spring);
    f.x += (targetX - f.x) * blend;
    f.y += (targetY - f.y) * blend;

    const autoFireActive =
      isOverdrive ||
      hasManualAim ||
      ((state.input.held('action') || state.input.held('jump') || state.input.held('shoulderR')) &&
        !isOrbitCharge &&
        state.ship.funnelCount > 0);
    if (autoFireActive) {
      f.fireTimer -= simDt;
      if (f.fireTimer <= 0) {
        f.fireTimer = isOverdrive ? 0.24 : 0.34;
        const aimTarget = isOverdrive ? findNearestTarget(state, f.x + 6, f.y + 6) : null;
        let bvx = 250;
        let bvy = 0;
        if (hasManualAim) {
          const dirX = Math.max(0.25, aimX * 0.4 + 0.85);
          const dirY = aimY * 0.95;
          const len = Math.max(1, Math.hypot(dirX, dirY));
          bvx = (dirX / len) * 270;
          bvy = (dirY / len) * 270;
        } else if (aimTarget && aimTarget.x > f.x + 8) {
          const dx = aimTarget.x - (f.x + 6);
          const dy = aimTarget.y - (f.y + 6);
          const len = Math.max(1, Math.hypot(dx, dy));
          bvx = (dx / len) * 265;
          bvy = (dy / len) * 265;
        }
        spawnPlayerBullet(state, f.x + 8, f.y + 6, bvx, bvy, 1, isOverdrive ? '#ff8ec6' : '#5ec2f7');
      }
    }
  }
}
