import type { RuntimeParams, SimEvent } from '../types/WorldTypes.ts';
import { clamp } from '../types/WorldTypes.ts';
import { MULTIGENRE_VAR_DEFAULTS } from './EventActionVm.ts';
import {
  DEFAULT_CARD_DECK,
  EF_FIGHTER_P2,
  EF_LOGIC_SWITCH,
  CARD_BOX_H,
  getCardBoxW,
  getCardBoxX,
  getCardBoxY,
  resetRuntimeGenreState,
  type FighterUnitState,
  type GenreRuntimeContext,
} from './GenreControllersExtra.ts';
import {
  BM_SIN_FLOAT,
  EF_ALIVE,
  EF_BOSS,
  EF_BULLET,
  EF_ENEMY,
  EF_FACING_LEFT,
  EF_FLIP_X,
} from './SoaEntityPool.ts';
import { TILE_SIZE } from './TilemapGrid.ts';

export {
  acquireHudSlot,
  buildGenreHudPrimitives,
  CARD_BOX_H,
  createRuntimeGenreState,
  DEFAULT_CARD_DECK,
  EF_FIGHTER_P2,
  EF_LOGIC_SWITCH,
  EF_PUSHABLE_CRATE,
  getCardBoxW,
  getCardBoxX,
  getCardBoxY,
  resetRuntimeGenreState,
  stepTopdownController,
  type FighterActionState,
  type FighterAttackKind,
  type FighterUnitState,
  type GenreRuntimeContext,
  type RuntimeGenreState,
} from './GenreControllersExtra.ts';

const FIGHTER_HB = { x: 2, y: 2, w: 12, h: 14 };

export function initGenreStageState(ctx: GenreRuntimeContext): void {
  const g = ctx.genre;
  resetRuntimeGenreState(g);
  const pool = ctx.pool;
  let fallbackEnemy = -1;
  for (let i = 0; i < pool.activeCount; i++) {
    const s = pool.activeIndices[i];
    if (s === ctx.playerSlot || (pool.flags[s] & EF_ALIVE) === 0) continue;
    const f = pool.flags[s];
    const archIdx = pool.archetypeIdx[s];
    const aid = archIdx >= 0 ? ctx.archetypeMetaByIdx[archIdx]?.id : '';
    if ((f & EF_FIGHTER_P2) !== 0 && g.p2Slot < 0) {
      g.p2Slot = s;
    }
    if ((f & (EF_ENEMY | EF_BOSS)) !== 0 && fallbackEnemy < 0) {
      fallbackEnemy = s;
    }
    if ((f & EF_LOGIC_SWITCH) !== 0) {
      g.switchesTotal++;
    }
    if (aid === 'gate' && g.gateSlot < 0) {
      g.gateSlot = s;
    }
  }
  if (g.p2Slot < 0) g.p2Slot = fallbackEnemy;
  g.cardFoeSlot = fallbackEnemy >= 0 ? fallbackEnemy : g.p2Slot;

  const ctrl = ctx.def.player.controller;
  if (ctrl === 'fighter') {
    if (!ctx.vm.hasVar('p1Hp')) ctx.vm.setVar('p1Hp', MULTIGENRE_VAR_DEFAULTS.p1Hp);
    if (!ctx.vm.hasVar('p1MaxHp')) ctx.vm.setVar('p1MaxHp', ctx.vm.getVar('p1Hp', 100));
    if (!ctx.vm.hasVar('p2Hp')) ctx.vm.setVar('p2Hp', MULTIGENRE_VAR_DEFAULTS.p2Hp);
    if (!ctx.vm.hasVar('p2MaxHp')) ctx.vm.setVar('p2MaxHp', ctx.vm.getVar('p2Hp', 100));
    if (!ctx.vm.hasVar('combo')) ctx.vm.setVar('combo', 0);
  } else if (ctrl === 'card') {
    if (!ctx.vm.hasVar('mana')) ctx.vm.setVar('mana', MULTIGENRE_VAR_DEFAULTS.mana);
    if (!ctx.vm.hasVar('maxMana')) ctx.vm.setVar('maxMana', 3);
    if (!ctx.vm.hasVar('turn')) ctx.vm.setVar('turn', MULTIGENRE_VAR_DEFAULTS.turn);
    if (!ctx.vm.hasVar('hp')) ctx.vm.setVar('hp', 20);
    if (!ctx.vm.hasVar('maxHp')) ctx.vm.setVar('maxHp', ctx.vm.getVar('hp', 20));
    if (!ctx.vm.hasVar('enemyHp')) ctx.vm.setVar('enemyHp', 20);
    if (!ctx.vm.hasVar('maxEnemyHp')) ctx.vm.setVar('maxEnemyHp', ctx.vm.getVar('enemyHp', 20));
    if (!ctx.vm.hasVar('shield')) ctx.vm.setVar('shield', 0);
  } else if (ctrl === 'topdown') {
    if (!ctx.vm.hasVar('switches')) ctx.vm.setVar('switches', 0);
    if (g.switchesTotal > 0) {
      ctx.vm.setVar('switchesTotal', g.switchesTotal);
      ctx.gateUnlocked = false;
    }
  }
}

function applyFighterHit(
  ctx: GenreRuntimeContext,
  attackerSlot: number,
  attackerUnit: FighterUnitState,
  defenderSlot: number,
  defenderUnit: FighterUnitState,
  defenderIsP2: boolean,
  defenderHoldingAway: boolean,
  sign: number,
  params: RuntimeParams,
  eventsOut: SimEvent[],
): void {
  const pool = ctx.pool;
  const baseDmg = attackerUnit.attackKind === 'uppercut' ? 18 : 10;
  const isBlocked =
    defenderUnit.state === 'block' || (defenderUnit.state === 'idle' && defenderHoldingAway);

  const defCx = pool.x[defenderSlot] + pool.w[defenderSlot] * 0.5;
  const defTopY = pool.y[defenderSlot] - 6;

  if (isBlocked) {
    const dmg = Math.max(1, Math.round(baseDmg * 0.3));
    defenderUnit.state = 'block';
    defenderUnit.timer = 0.2;
    defenderUnit.attackKind = 'none';
    pool.vx[defenderSlot] = sign * 58;
    ctx.juice.triggerHitstop(0.025);
    ctx.juice.addTrauma(0.08);
    ctx.juice.spawnBurst(defCx, defTopY + 8, ['#5ec2f7', '#fffaf0'], 5, params.sparkleDensity);
    ctx.spawnFloatingText('BLOCK!', defCx, defTopY, '#5ec2f7');
    eventsOut.push('snap');

    const varName = defenderIsP2 ? 'p2Hp' : 'p1Hp';
    const nextHp = Math.max(0, ctx.vm.getVar(varName, 100) - dmg);
    ctx.vm.setVar(varName, nextHp);
    if (defenderIsP2 && nextHp <= 0) {
      defenderUnit.state = 'ko';
      ctx.spawnFloatingText('KO!', defCx, defTopY - 8, '#ffd447');
      ctx.vm.emitSignal('fighter_ko');
      eventsOut.push('win');
    } else if (!defenderIsP2 && nextHp <= 0) {
      defenderUnit.state = 'ko';
      ctx.spawnFloatingText('KO!', defCx, defTopY - 8, '#ff5d8f');
      ctx.status = 'lost';
      eventsOut.push('hurt');
    }
    return;
  }

  const isUpper = attackerUnit.attackKind === 'uppercut';
  defenderUnit.state = 'hitstun';
  defenderUnit.timer = isUpper ? 0.36 : 0.28;
  defenderUnit.attackKind = 'none';
  defenderUnit.aiCooldown = Math.max(defenderUnit.aiCooldown, 0.42);
  pool.vx[defenderSlot] = sign * (isUpper ? 136 : 86);
  pool.vy[defenderSlot] = isUpper ? -215 : -72;
  pool.flash[defenderSlot] = 0.42;
  pool.sx[attackerSlot] = 1.2;
  pool.sy[attackerSlot] = 0.85;
  pool.sx[defenderSlot] = 0.78;
  pool.sy[defenderSlot] = 1.24;

  ctx.juice.triggerHitstop(isUpper ? 0.065 : 0.04);
  ctx.juice.addTrauma(isUpper ? 0.28 : 0.16);
  ctx.juice.spawnBurst(
    defCx,
    pool.y[defenderSlot] + pool.h[defenderSlot] * 0.5,
    isUpper ? ['#ffd447', '#ff5d8f', '#fffaf0'] : ['#ff5d8f', '#fffaf0'],
    isUpper ? 10 : 6,
    params.sparkleDensity,
  );
  ctx.spawnFloatingText(isUpper ? '-18' : '-10', defCx, defTopY, isUpper ? '#ffd447' : '#ff5d8f');
  eventsOut.push(isUpper ? 'explode' : 'stomp');

  const varName = defenderIsP2 ? 'p2Hp' : 'p1Hp';
  const nextHp = Math.max(0, ctx.vm.getVar(varName, 100) - baseDmg);
  ctx.vm.setVar(varName, nextHp);

  if (defenderIsP2) {
    const nextCombo = ctx.vm.getVar('combo', 0) + 1;
    ctx.vm.setVar('combo', nextCombo);
    ctx.genre.comboResetTimer = 1.75;
    ctx.juice.registerCombo();
    ctx.score += isUpper ? 150 : 80;
    ctx.vm.emitSignal('fighter_hit');
    if (nextHp <= 0) {
      defenderUnit.state = 'ko';
      defenderUnit.timer = 0.85;
      pool.vy[defenderSlot] = -180;
      ctx.juice.applyPreset('heavy_kill');
      ctx.spawnFloatingText('KO!', defCx, defTopY - 10, '#ffd447');
      ctx.vm.emitSignal('fighter_ko');
      eventsOut.push('win');
    }
  } else {
    ctx.hearts = Math.max(0, Math.ceil((nextHp / Math.max(1, ctx.vm.getVar('p1MaxHp', 100))) * ctx.maxHearts));
    if (nextHp <= 0) {
      defenderUnit.state = 'ko';
      ctx.juice.applyPreset('player_hurt');
      ctx.spawnFloatingText('KO!', defCx, defTopY - 10, '#ff5d8f');
      ctx.status = 'lost';
      eventsOut.push('hurt');
    }
  }
}

export function stepFighterController(
  ctx: GenreRuntimeContext,
  dt: number,
  params: RuntimeParams,
  eventsOut: SimEvent[],
): void {
  const p = ctx.playerSlot;
  if (p < 0) return;
  const pool = ctx.pool;
  const g = ctx.genre;
  const p1 = g.p1;
  const p2 = g.p2;
  const p2Slot = g.p2Slot;
  const hasP2 = p2Slot >= 0 && (pool.flags[p2Slot] & EF_ALIVE) !== 0;

  if (g.comboResetTimer > 0) {
    g.comboResetTimer = Math.max(0, g.comboResetTimer - dt);
    if (g.comboResetTimer <= 0) {
      ctx.vm.setVar('combo', 0);
    }
  }

  const p1OnGround =
    ctx.tilemap.isSolidAt(Math.floor((pool.x[p] + 4) / TILE_SIZE), Math.floor((pool.y[p] + pool.h[p] + 1) / TILE_SIZE)) ||
    ctx.tilemap.isSolidAt(Math.floor((pool.x[p] + pool.w[p] - 4) / TILE_SIZE), Math.floor((pool.y[p] + pool.h[p] + 1) / TILE_SIZE)) ||
    ctx.aabbRes.onGround;

  const p1Cx = pool.x[p] + pool.w[p] * 0.5;
  const p2Cx = hasP2 ? pool.x[p2Slot] + pool.w[p2Slot] * 0.5 : p1Cx + 48;
  const dir = ctx.input.axisX();
  const holdingAwayP1 = hasP2 && ((p2Cx > p1Cx && dir < 0) || (p2Cx < p1Cx && dir > 0));

  // Auto-face opponent while idle/blocking
  if (p1.state === 'idle' || p1.state === 'block') {
    if (hasP2) {
      if (p2Cx < p1Cx) pool.flags[p] |= EF_FACING_LEFT;
      else pool.flags[p] &= ~EF_FACING_LEFT;
    } else if (dir !== 0) {
      if (dir < 0) pool.flags[p] |= EF_FACING_LEFT;
      else pool.flags[p] &= ~EF_FACING_LEFT;
    }
  }
  const p1FacingLeft = (pool.flags[p] & EF_FACING_LEFT) !== 0;
  const p1Sign = p1FacingLeft ? -1 : 1;
  if (p1FacingLeft) pool.flags[p] |= EF_FLIP_X;
  else pool.flags[p] &= ~EF_FLIP_X;

  // Step P1 Fighter State Machine
  if (p1.state === 'ko') {
    pool.vx[p] *= 0.9;
    pool.rot[p] = -p1Sign * 1.35;
  } else {
    pool.rot[p] = 0;
    if (p1.state === 'idle' || p1.state === 'block') {
      if (ctx.input.justPressed('action')) {
        p1.state = 'startup';
        p1.attackKind = 'jab';
        p1.timer = 0.05;
        p1.hitDealt = false;
        pool.vx[p] = p1Sign * 65;
        eventsOut.push('snap');
      } else if (ctx.input.justPressed('skillY')) {
        p1.state = 'startup';
        p1.attackKind = 'uppercut';
        p1.timer = 0.085;
        p1.hitDealt = false;
        pool.vx[p] = p1Sign * 75;
        if (p1OnGround) pool.vy[p] = -148;
        eventsOut.push('laser');
      } else if (ctx.input.held('skillX') && p1OnGround) {
        p1.state = 'block';
        p1.timer = 0.05;
        pool.vx[p] *= 0.6;
        pool.skewX[p] = -p1Sign * 0.1;
      } else {
        if (p1.state === 'block') {
          p1.timer -= dt;
          if (p1.timer <= 0) p1.state = 'idle';
        }
        if (p1.state === 'idle') {
          const speedMult = holdingAwayP1 ? 0.8 : 1.15;
          const targetVx = dir * params.moveSpeed * speedMult;
          const accel = p1OnGround ? 1100 : 720;
          if (dir !== 0) {
            pool.vx[p] = pool.vx[p] < targetVx ? Math.min(targetVx, pool.vx[p] + accel * dt) : Math.max(targetVx, pool.vx[p] - accel * dt);
            ctx.walkAnim += dt * 10;
          } else {
            const decel = p1OnGround ? 960 : 300;
            pool.vx[p] = pool.vx[p] > 0 ? Math.max(0, pool.vx[p] - decel * dt) : Math.min(0, pool.vx[p] + decel * dt);
          }
          p1.coyote = p1OnGround ? 0.1 : Math.max(0, p1.coyote - dt);
          if ((ctx.input.justPressed('jump') || ctx.input.justPressed('up')) && p1.coyote > 0) {
            pool.vy[p] = -params.jumpPower;
            p1.coyote = 0;
            ctx.heroSquash.scaleX = 0.78;
            ctx.heroSquash.scaleY = 1.24;
            eventsOut.push('jump');
          }
          pool.skewX[p] = Math.abs(pool.vx[p]) > 10 ? clamp(pool.vx[p] / 460, -0.2, 0.2) : 0;
        }
      }
    } else {
      p1.timer -= dt;
      if (p1.state === 'startup') {
        pool.skewX[p] = -p1Sign * 0.16;
        if (p1.timer <= 0) {
          p1.state = 'active';
          p1.timer = p1.attackKind === 'uppercut' ? 0.12 : 0.1;
          pool.vx[p] = p1Sign * (p1.attackKind === 'uppercut' ? 88 : 96);
          pool.skewX[p] = p1Sign * 0.24;
        }
      } else if (p1.state === 'active') {
        pool.skewX[p] = p1Sign * 0.24;
        if (!p1.hitDealt && hasP2 && p2.state !== 'ko') {
          const reachW = p1.attackKind === 'uppercut' ? 34 : 28;
          const reachH = p1.attackKind === 'uppercut' ? 30 : 22;
          const hx0 = p1Sign > 0 ? p1Cx - 2 : p1Cx - reachW + 2;
          const hy0 = pool.y[p] + (p1.attackKind === 'uppercut' ? -10 : -2);
          if (
            hx0 < pool.x[p2Slot] + pool.w[p2Slot] &&
            hx0 + reachW > pool.x[p2Slot] &&
            hy0 < pool.y[p2Slot] + pool.h[p2Slot] &&
            hy0 + reachH > pool.y[p2Slot]
          ) {
            p1.hitDealt = true;
            applyFighterHit(ctx, p, p1, p2Slot, p2, true, false, p1Sign, params, eventsOut);
          }
        }
        if (p1.attackKind === 'jab' && p1.hitDealt && ctx.input.justPressed('skillY')) {
          p1.state = 'startup';
          p1.attackKind = 'uppercut';
          p1.timer = 0.065;
          p1.hitDealt = false;
          pool.vx[p] = p1Sign * 92;
          if (p1OnGround) pool.vy[p] = -148;
          eventsOut.push('laser');
        } else if (p1.timer <= 0) {
          p1.state = 'recovery';
          p1.timer = p1.attackKind === 'uppercut' ? 0.16 : 0.11;
        }
      } else if (p1.state === 'recovery') {
        pool.vx[p] *= 0.85;
        pool.skewX[p] = p1Sign * 0.08;
        if (p1.attackKind === 'jab' && p1.hitDealt && ctx.input.justPressed('skillY')) {
          p1.state = 'startup';
          p1.attackKind = 'uppercut';
          p1.timer = 0.065;
          p1.hitDealt = false;
          pool.vx[p] = p1Sign * 92;
          if (p1OnGround) pool.vy[p] = -148;
          eventsOut.push('laser');
        } else if (p1.timer <= 0) {
          p1.state = 'idle';
          p1.attackKind = 'none';
          pool.skewX[p] = 0;
        }
      } else if (p1.state === 'hitstun') {
        pool.vx[p] *= 0.9;
        pool.skewX[p] = -p1Sign * 0.22;
        if (p1.timer <= 0) {
          p1.state = 'idle';
          pool.skewX[p] = 0;
        }
      }
    }
  }

  pool.vy[p] = Math.min(360, pool.vy[p] + 620 * params.gravityScale * dt);
  const box = ctx.aabbBox;
  box.x = pool.x[p];
  box.y = pool.y[p];
  box.vx = pool.vx[p];
  box.vy = pool.vy[p];
  ctx.tilemap.resolveAabbMotion(box, FIGHTER_HB.x, FIGHTER_HB.y, FIGHTER_HB.w, FIGHTER_HB.h, dt, ctx.aabbRes);
  pool.x[p] = box.x;
  pool.y[p] = box.y;
  pool.vx[p] = box.vx;
  pool.vy[p] = box.vy;
  pool.sx[p] = ctx.heroSquash.scaleX;
  pool.sy[p] = ctx.heroSquash.scaleY;

  // Step P2 Rival State Machine & AI
  if (hasP2) {
    const p2Sign = p1Cx < p2Cx ? -1 : 1;
    if (p2.state === 'idle' || p2.state === 'block') {
      if (p2Sign < 0) pool.flags[p2Slot] |= EF_FACING_LEFT | EF_FLIP_X;
      else pool.flags[p2Slot] &= ~(EF_FACING_LEFT | EF_FLIP_X);
    }

    if (p2.state === 'ko') {
      pool.vx[p2Slot] *= 0.9;
      pool.rot[p2Slot] = -p2Sign * 1.35;
      g.koFinishTimer += dt;
      if (g.koFinishTimer >= 0.7 && ctx.status === 'playing') {
        ctx.status = 'won';
      }
    } else {
      pool.rot[p2Slot] = 0;
      p2.aiCooldown = Math.max(0, p2.aiCooldown - dt);
      const p2OnGround = ctx.tilemap.isSolidAt(
        Math.floor((pool.x[p2Slot] + pool.w[p2Slot] * 0.5) / TILE_SIZE),
        Math.floor((pool.y[p2Slot] + pool.h[p2Slot] + 1) / TILE_SIZE),
      );
      const absDx = Math.abs(p1Cx - p2Cx);

      if (p2.state === 'idle') {
        if ((p1.state === 'startup' || p1.state === 'active') && absDx < 34 && p2.aiCooldown <= 0.15 && p2.aiTickPhase % 3 === 0) {
          p2.state = 'block';
          p2.timer = 0.24;
          p2.aiCooldown = 0.48;
          p2.aiTickPhase++;
          pool.vx[p2Slot] = 0;
        } else if (absDx <= 28 && p2.aiCooldown <= 0) {
          const useUpper = p2.aiTickPhase % 3 === 2;
          p2.state = 'startup';
          p2.attackKind = useUpper ? 'uppercut' : 'jab';
          p2.timer = useUpper ? 0.15 : 0.1;
          p2.hitDealt = false;
          p2.aiCooldown = 0.72;
          p2.aiTickPhase++;
          pool.vx[p2Slot] = p2Sign * 42;
        } else if (absDx > 26) {
          pool.vx[p2Slot] = p2Sign * 62;
          if (pool.y[p] < pool.y[p2Slot] - 20 && p2OnGround && p2.aiCooldown <= 0) {
            pool.vy[p2Slot] = -params.jumpPower * 0.9;
            p2.aiCooldown = 0.7;
          }
        } else if (absDx < 13) {
          pool.vx[p2Slot] = -p2Sign * 36;
        } else {
          pool.vx[p2Slot] *= 0.8;
        }
      } else {
        p2.timer -= dt;
        if (p2.state === 'block') {
          pool.vx[p2Slot] *= 0.75;
          if (p2.timer <= 0) p2.state = 'idle';
        } else if (p2.state === 'startup') {
          pool.skewX[p2Slot] = -p2Sign * 0.14;
          if (p2.timer <= 0) {
            p2.state = 'active';
            p2.timer = p2.attackKind === 'uppercut' ? 0.12 : 0.1;
            pool.vx[p2Slot] = p2Sign * 78;
            pool.skewX[p2Slot] = p2Sign * 0.22;
          }
        } else if (p2.state === 'active') {
          if (!p2.hitDealt && p1.state !== 'ko') {
            const reachW = p2.attackKind === 'uppercut' ? 28 : 26;
            const reachH = p2.attackKind === 'uppercut' ? 26 : 22;
            const hx0 = p2Sign > 0 ? p2Cx - 2 : p2Cx - reachW + 2;
            const hy0 = pool.y[p2Slot] + (p2.attackKind === 'uppercut' ? -10 : -2);
            if (
              hx0 < pool.x[p] + pool.w[p] &&
              hx0 + reachW > pool.x[p] &&
              hy0 < pool.y[p] + pool.h[p] &&
              hy0 + reachH > pool.y[p]
            ) {
              p2.hitDealt = true;
              applyFighterHit(ctx, p2Slot, p2, p, p1, false, holdingAwayP1, p2Sign, params, eventsOut);
            }
          }
          if (p2.timer <= 0) {
            p2.state = 'recovery';
            p2.timer = 0.15;
          }
        } else if (p2.state === 'recovery') {
          pool.vx[p2Slot] *= 0.85;
          pool.skewX[p2Slot] = 0;
          if (p2.timer <= 0) {
            p2.state = 'idle';
            p2.attackKind = 'none';
          }
        } else if (p2.state === 'hitstun') {
          pool.vx[p2Slot] *= 0.9;
          if (p2.timer <= 0) {
            p2.state = 'idle';
            pool.skewX[p2Slot] = 0;
          }
        }
      }

      pool.vy[p2Slot] = Math.min(360, pool.vy[p2Slot] + 620 * params.gravityScale * dt);
      box.x = pool.x[p2Slot];
      box.y = pool.y[p2Slot];
      box.vx = pool.vx[p2Slot];
      box.vy = pool.vy[p2Slot];
      ctx.tilemap.resolveAabbMotion(box, FIGHTER_HB.x, FIGHTER_HB.y, FIGHTER_HB.w, FIGHTER_HB.h, dt, ctx.aabbRes);
      pool.x[p2Slot] = box.x;
      pool.y[p2Slot] = box.y;
      pool.vx[p2Slot] = box.vx;
      pool.vy[p2Slot] = box.vy;
    }
  }

  // Spring-relaxed scale recovery on P2
  pool.sx[p2Slot >= 0 ? p2Slot : 0] += (1 - pool.sx[p2Slot >= 0 ? p2Slot : 0]) * Math.min(1, dt * 12);
  pool.sy[p2Slot >= 0 ? p2Slot : 0] += (1 - pool.sy[p2Slot >= 0 ? p2Slot : 0]) * Math.min(1, dt * 12);

  // Midpoint camera framing
  const focusX = hasP2 ? (pool.x[p] + pool.x[p2Slot]) * 0.5 : pool.x[p];
  const focusY = hasP2 ? (pool.y[p] + pool.y[p2Slot]) * 0.5 : pool.y[p];
  ctx.trackCameraTarget(focusX, focusY, dt);
}

export function stepCardController(
  ctx: GenreRuntimeContext,
  dt: number,
  params: RuntimeParams,
  eventsOut: SimEvent[],
): void {
  const p = ctx.playerSlot;
  if (p < 0) return;
  const pool = ctx.pool;
  const g = ctx.genre;
  const deck = ctx.def.cardDeck && ctx.def.cardDeck.length > 0 ? ctx.def.cardDeck : DEFAULT_CARD_DECK;
  const deckLen = Math.min(4, deck.length);
  if (g.cardCursor >= deckLen) g.cardCursor = 0;

  // Step idle animations & visual sparks
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.activeIndices[i];
    if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
    pool.sx[s] += (1 - pool.sx[s]) * Math.min(1, dt * 10);
    pool.sy[s] += (1 - pool.sy[s]) * Math.min(1, dt * 10);
    if ((pool.behaviorMask[s] & BM_SIN_FLOAT) !== 0) {
      pool.timerA[s] += dt * 2.4;
      pool.y[s] = pool.paramB[s] + Math.sin(pool.timerA[s] + pool.paramA[s]) * 8;
    } else if ((pool.flags[s] & EF_BULLET) !== 0) {
      pool.x[s] += pool.vx[s] * dt;
      pool.y[s] += pool.vy[s] * dt;
      pool.timerA[s] -= dt;
      if (pool.timerA[s] <= 0) pool.free(s);
    }
  }
  pool.sx[p] = ctx.heroSquash.scaleX;
  pool.sy[p] = ctx.heroSquash.scaleY;

  // Center camera on player & foe arena
  const foeSlot = g.cardFoeSlot;
  const hasFoe = foeSlot >= 0 && (pool.flags[foeSlot] & EF_ALIVE) !== 0;
  const pCx = pool.x[p] + pool.w[p] * 0.5;
  const pTopY = pool.y[p] - 6;
  const foeCx = hasFoe ? pool.x[foeSlot] + pool.w[foeSlot] * 0.5 : pCx + 120;
  const foeCy = hasFoe ? pool.y[foeSlot] + pool.h[foeSlot] * 0.5 : pool.y[p] + 8;
  const foeTopY = hasFoe ? pool.y[foeSlot] - 8 : pTopY;

  ctx.trackCameraTarget((pCx + foeCx) * 0.5, (pool.y[p] + foeCy) * 0.5, dt);

  if (ctx.input.justPressed('left')) {
    g.cardCursor = (g.cardCursor - 1 + deckLen) % deckLen;
    eventsOut.push('snap');
  } else if (ctx.input.justPressed('right')) {
    g.cardCursor = (g.cardCursor + 1) % deckLen;
    eventsOut.push('snap');
  }

  let hoveredIdx = -1;
  if (ctx.input.pointerActive()) {
    const vw = ctx.stageViewport.width;
    const vh = ctx.stageViewport.height;
    const px = ctx.input.pointerX() * vw;
    const py = ctx.input.pointerY() * vh;
    const cardW = getCardBoxW(deckLen, vw);
    const cardY = getCardBoxY(vh);
    if (py >= cardY - 4 && py <= cardY + CARD_BOX_H) {
      for (let i = 0; i < deckLen; i++) {
        const cx = getCardBoxX(i, deckLen, vw);
        if (px >= cx && px <= cx + cardW) {
          g.cardCursor = i;
          hoveredIdx = i;
          break;
        }
      }
    }
  }

  const castClicked = ctx.input.pointerPrimaryJustPressed() && hoveredIdx >= 0;
  if (ctx.input.justPressed('action') || castClicked) {
    const card = deck[g.cardCursor];
    if (card) {
      const mana = ctx.vm.getVar('mana', MULTIGENRE_VAR_DEFAULTS.mana);
      const maxMana = Math.max(3, ctx.vm.getVar('maxMana', 10));
      if (mana >= card.cost) {
        ctx.vm.setVar('mana', mana - card.cost);
        ctx.heroSquash.scaleX = 1.2;
        ctx.heroSquash.scaleY = 0.84;

        if (card.kind === 'attack') {
          const enemyHp = ctx.vm.getVar('enemyHp', 20);
          const nextEnemyHp = Math.max(0, enemyHp - card.power);
          ctx.vm.setVar('enemyHp', nextEnemyHp);
          ctx.vm.setVar('combo', ctx.vm.getVar('combo', 0) + 1);
          ctx.score += card.power * 25;
          if (hasFoe) {
            pool.flash[foeSlot] = 0.45;
            pool.sx[foeSlot] = 1.26;
            pool.sy[foeSlot] = 0.76;
          }
          const sp = ctx.spawnArchetype('spark', pCx + 8, pool.y[p] + 6, 210, -12);
          if (sp >= 0) pool.timerA[sp] = 0.45;
          ctx.juice.applyPreset('charge_shot');
          ctx.juice.spawnBurst(foeCx, foeCy, [card.color ?? '#ff5d8f', '#ffd447', '#fffaf0'], 10, params.sparkleDensity);
          ctx.spawnFloatingText(`-${card.power}`, foeCx, foeTopY, card.color ?? '#ff5d8f');
          eventsOut.push('laser');
          if (nextEnemyHp <= 0) {
            ctx.spawnFloatingText('VICTORY!', foeCx, foeTopY - 10, '#ffd447');
            eventsOut.push('win');
            ctx.status = 'won';
          }
        } else if (card.kind === 'shield') {
          const shield = ctx.vm.getVar('shield', 0);
          ctx.vm.setVar('shield', shield + card.power);
          ctx.juice.spawnBurst(pCx, pool.y[p] + 8, [card.color ?? '#5ec2f7', '#fffaf0'], 8, params.sparkleDensity);
          ctx.spawnFloatingText(`+${card.power} SHD`, pCx, pTopY, card.color ?? '#5ec2f7');
          eventsOut.push('key');
        } else if (card.kind === 'heal') {
          const hp = ctx.vm.getVar('hp', 20);
          const maxHp = Math.max(1, ctx.vm.getVar('maxHp', 20));
          ctx.vm.setVar('hp', Math.min(maxHp, hp + card.power));
          ctx.juice.spawnBurst(pCx, pool.y[p] + 8, [card.color ?? '#56d39c', '#fffaf0'], 8, params.sparkleDensity);
          ctx.spawnFloatingText(`+${card.power} HP`, pCx, pTopY, card.color ?? '#56d39c');
          eventsOut.push('star');
        } else {
          ctx.vm.setVar('mana', Math.min(maxMana, mana - card.cost + card.power));
          ctx.juice.spawnBurst(pCx, pool.y[p] + 8, [card.color ?? '#e0aaff', '#ffd447'], 8, params.sparkleDensity);
          ctx.spawnFloatingText(`+${card.power} MANA`, pCx, pTopY, card.color ?? '#e0aaff');
          eventsOut.push('charge');
        }
        ctx.vm.emitSignal('card_played');
      } else {
        ctx.spawnFloatingText('NO MANA!', pCx, pTopY, '#ff708d');
        eventsOut.push('hurt');
      }
    }
  } else if (ctx.input.justPressed('skillY') || ctx.input.pointerSecondaryJustPressed()) {
    // End Turn -> Foe executes intent (-5 against shield + hp), refreshes mana = 3, increments turn
    const foeDmg = 5;
    const shield = ctx.vm.getVar('shield', 0);
    const absorbed = Math.min(shield, foeDmg);
    const hpDmg = foeDmg - absorbed;
    const nextShield = Math.max(0, shield - absorbed);
    const nextHp = Math.max(0, ctx.vm.getVar('hp', 20) - hpDmg);

    ctx.vm.setVar('shield', nextShield);
    ctx.vm.setVar('hp', nextHp);
    ctx.vm.setVar('mana', 3);
    ctx.vm.setVar('turn', ctx.vm.getVar('turn', 1) + 1);
    if (hasFoe) {
      pool.sx[foeSlot] = 1.24;
      pool.sy[foeSlot] = 0.82;
    }

    if (hpDmg > 0) {
      pool.flash[p] = 0.42;
      ctx.juice.applyPreset('player_hurt');
      ctx.spawnFloatingText(`-${hpDmg}`, pCx, pTopY, '#ff5d8f');
      eventsOut.push('hurt');
    } else {
      ctx.juice.spawnBurst(pCx, pool.y[p] + 8, ['#5ec2f7', '#fffaf0'], 6, params.sparkleDensity);
      ctx.spawnFloatingText('BLOCKED!', pCx, pTopY, '#5ec2f7');
      eventsOut.push('snap');
    }
    ctx.vm.emitSignal('turn_end');
    if (nextHp <= 0) {
      ctx.spawnFloatingText('DEFEAT', pCx, pTopY - 10, '#ff5d8f');
      ctx.status = 'lost';
    }
  }
}
