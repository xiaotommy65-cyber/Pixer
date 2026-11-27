import type { LogicalViewport } from '../gpu/GpuTypes.ts';
import type { InputMap } from '../input/InputMap.ts';
import { hasGridLineOfSight } from '../math/Visibility2D.ts';
import type {
  HudPrimitiveDesc,
  RuntimeParams,
  SimEvent,
} from '../types/WorldTypes.ts';
import { clamp } from '../types/WorldTypes.ts';
import type {
  CartridgeArchetypeDef,
  CartridgeCardDef,
  CartridgeJsonV1,
} from './CartridgeSchema.ts';
import {
  EventActionVm,
  MULTIGENRE_VAR_DEFAULTS,
  type VmCollisionPair,
} from './EventActionVm.ts';
import { JuiceSystem } from './JuiceSystem.ts';
import {
  BM_CHASE,
  BM_PATROL,
  BM_SIN_FLOAT,
  EF_ALIVE,
  EF_BULLET,
  EF_COLLECTIBLE,
  EF_ENEMY,
  EF_FACING_LEFT,
  EF_FLIP_X,
  EF_GRAVITY,
  EF_HAZARD,
  EF_SOLID,
  SoaEntityPool,
} from './SoaEntityPool.ts';
import {
  COLLISION_DESTRUCTIBLE,
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
  type TileAabbStepResult,
} from './TilemapGrid.ts';

export const EF_FIGHTER_P2 = 1 << 25;
export const EF_LOGIC_SWITCH = 1 << 26;
export const EF_PUSHABLE_CRATE = 1 << 27;

export const DEFAULT_CARD_DECK: readonly CartridgeCardDef[] = [
  { id: 'strike', name: 'STRIKE', cost: 1, kind: 'attack', power: 5, color: '#ff5d8f' },
  { id: 'aegis', name: 'AEGIS', cost: 1, kind: 'shield', power: 6, color: '#5ec2f7' },
  { id: 'flare', name: 'FLARE', cost: 2, kind: 'attack', power: 11, color: '#ffd447' },
  { id: 'mend', name: 'MEND', cost: 1, kind: 'heal', power: 5, color: '#56d39c' },
];

export const CARD_BOX_H = 24;

export function getCardBoxW(visibleCount: number, vw: number): number {
  const n = Math.max(1, visibleCount);
  return Math.floor((vw - 20 - 6 * (n - 1)) / n);
}

export function getCardBoxX(idx: number, visibleCount: number, vw: number): number {
  return 10 + idx * (getCardBoxW(visibleCount, vw) + 6);
}

export function getCardBoxY(vh: number): number {
  return vh - 30;
}

export type FighterActionState = 'idle' | 'startup' | 'active' | 'recovery' | 'block' | 'hitstun' | 'ko';
export type FighterAttackKind = 'none' | 'jab' | 'uppercut';

export interface FighterUnitState {
  state: FighterActionState;
  timer: number;
  attackKind: FighterAttackKind;
  hitDealt: boolean;
  coyote: number;
  aiCooldown: number;
  aiTickPhase: number;
}

export interface RuntimeGenreState {
  p1: FighterUnitState;
  p2: FighterUnitState;
  p2Slot: number;
  comboResetTimer: number;
  koFinishTimer: number;
  cardCursor: number;
  cardFoeSlot: number;
  switchesTotal: number;
  gateSlot: number;
}

export function createRuntimeGenreState(): RuntimeGenreState {
  return {
    p1: { state: 'idle', timer: 0, attackKind: 'none', hitDealt: false, coyote: 0, aiCooldown: 0, aiTickPhase: 0 },
    p2: { state: 'idle', timer: 0, attackKind: 'none', hitDealt: false, coyote: 0, aiCooldown: 0.45, aiTickPhase: 0 },
    p2Slot: -1,
    comboResetTimer: 0,
    koFinishTimer: 0,
    cardCursor: 0,
    cardFoeSlot: -1,
    switchesTotal: 0,
    gateSlot: -1,
  };
}

export function resetRuntimeGenreState(state: RuntimeGenreState): void {
  state.p1.state = 'idle';
  state.p1.timer = 0;
  state.p1.attackKind = 'none';
  state.p1.hitDealt = false;
  state.p1.coyote = 0;
  state.p1.aiCooldown = 0;
  state.p1.aiTickPhase = 0;

  state.p2.state = 'idle';
  state.p2.timer = 0;
  state.p2.attackKind = 'none';
  state.p2.hitDealt = false;
  state.p2.coyote = 0;
  state.p2.aiCooldown = 0.45;
  state.p2.aiTickPhase = 0;

  state.p2Slot = -1;
  state.comboResetTimer = 0;
  state.koFinishTimer = 0;
  state.cardCursor = 0;
  state.cardFoeSlot = -1;
  state.switchesTotal = 0;
  state.gateSlot = -1;
}

export interface GenreRuntimeContext {
  readonly def: CartridgeJsonV1;
  readonly pool: SoaEntityPool;
  readonly input: InputMap;
  readonly juice: JuiceSystem;
  readonly vm: EventActionVm;
  readonly tilemap: TilemapGrid;
  readonly archetypes: readonly { id: string; def: CartridgeArchetypeDef; flags: number; behaviorMask: number; scoreValue: number }[];
  readonly archetypeMetaByIdx: readonly { id: string; scoreValue: number; dropKind?: string }[];
  readonly stageViewport: LogicalViewport;
  readonly stageWorldW: number;
  readonly stageWorldH: number;
  readonly aabbBox: { x: number; y: number; vx: number; vy: number };
  readonly aabbRes: TileAabbStepResult;
  readonly heroSquash: { scaleX: number; scaleY: number };
  readonly vmCollisions: VmCollisionPair[];
  readonly querySlots: Int32Array;
  readonly genre: RuntimeGenreState;
  readonly isTileOpaque: (tx: number, ty: number) => boolean;
  playerSlot: number;
  bossSlot: number;
  stageIdx: number;
  hearts: number;
  maxHearts: number;
  score: number;
  stageStarsCollected: number;
  hasKey: boolean;
  stageHasKey: boolean;
  gateUnlocked: boolean;
  status: 'playing' | 'won' | 'lost';
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  walkAnim: number;
  invulnTimer: number;
  checkpointX: number;
  checkpointY: number;
  vmCollisionCount: number;
  spawnArchetype(archetypeId: string, x: number, y: number, vx?: number, vy?: number, parentSlot?: number): number;
  spawnFloatingText(text: string, wx: number, wy: number, color?: string): void;
  enterStage(idx: number): void;
  trackCameraTarget(targetX: number, targetY: number, dt: number): void;
}

const TOPDOWN_HB = { x: 2, y: 4, w: 12, h: 10 };

function isTopdownRectBlocked(
  tilemap: TilemapGrid,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const c0 = Math.floor(x / TILE_SIZE);
  const c1 = Math.floor((x + w - 0.001) / TILE_SIZE);
  const r0 = Math.floor(y / TILE_SIZE);
  const r1 = Math.floor((y + h - 0.001) / TILE_SIZE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = tilemap.getCollision(c, r);
      if (k === COLLISION_SOLID || k === COLLISION_DESTRUCTIBLE) return true;
    }
  }
  return false;
}

function isCrateBlockedByEntity(
  pool: SoaEntityPool,
  crateSlot: number,
  playerSlot: number,
  nx: number,
  ny: number,
  querySlots: Int32Array,
): boolean {
  const cw = pool.w[crateSlot];
  const ch = pool.h[crateSlot];
  const count = pool.queryRect(nx - 2, ny - 2, nx + cw + 2, ny + ch + 2, querySlots);
  for (let i = 0; i < count; i++) {
    const s = querySlots[i];
    if (s === crateSlot || s === playerSlot || (pool.flags[s] & EF_ALIVE) === 0) continue;
    if ((pool.flags[s] & EF_SOLID) === 0) continue;
    if (
      nx < pool.x[s] + pool.w[s] &&
      nx + cw > pool.x[s] &&
      ny < pool.y[s] + pool.h[s] &&
      ny + ch > pool.y[s]
    ) {
      return true;
    }
  }
  return false;
}

function activateLogicSwitch(
  ctx: GenreRuntimeContext,
  swSlot: number,
  params: RuntimeParams,
  eventsOut: SimEvent[],
): void {
  const pool = ctx.pool;
  if (pool.aiState[swSlot] !== 0) return;
  pool.aiState[swSlot] = 1;
  pool.flash[swSlot] = 0.35;
  const nextSwitches = ctx.vm.getVar('switches', 0) + 1;
  ctx.vm.setVar('switches', nextSwitches);
  ctx.vm.setVar('combo', ctx.vm.getVar('combo', 0) + 1);
  ctx.score += 120;

  const ecx = pool.x[swSlot] + pool.w[swSlot] * 0.5;
  const ecy = pool.y[swSlot] + pool.h[swSlot] * 0.5;
  ctx.spawnFloatingText('SWITCH ON!', ecx, ecy - 10, '#56d39c');
  ctx.juice.spawnBurst(ecx, ecy, ['#56d39c', '#ffd447', '#fffaf0'], 8, params.sparkleDensity);
  eventsOut.push('snap');
  ctx.vm.emitSignal('switch_on');

  const totalReq = Math.max(1, ctx.genre.switchesTotal);
  if (nextSwitches >= totalReq && (!ctx.stageHasKey || ctx.hasKey) && !ctx.gateUnlocked) {
    ctx.gateUnlocked = true;
    const gs = ctx.genre.gateSlot;
    const gx = gs >= 0 ? pool.x[gs] + pool.w[gs] * 0.5 : ecx;
    const gy = gs >= 0 ? pool.y[gs] - 8 : ecy - 16;
    ctx.spawnFloatingText('UNLOCKED!', gx, gy, '#ffd447');
    eventsOut.push('key');
    ctx.vm.emitSignal('gate_unlocked');
  }
}

export function stepTopdownController(
  ctx: GenreRuntimeContext,
  dt: number,
  params: RuntimeParams,
  eventsOut: SimEvent[],
): void {
  const p = ctx.playerSlot;
  if (p < 0) return;
  const pool = ctx.pool;

  if (ctx.invulnTimer > 0) ctx.invulnTimer = Math.max(0, ctx.invulnTimer - dt);

  const ix = ctx.input.axisX();
  const iy = ctx.input.axisY();
  const mag = ix !== 0 && iy !== 0 ? Math.SQRT1_2 : 1;
  const vx = ix * mag * params.moveSpeed;
  const vy = iy * mag * params.moveSpeed;
  pool.vx[p] = vx;
  pool.vy[p] = vy;

  if (ix < 0) pool.flags[p] |= EF_FACING_LEFT | EF_FLIP_X;
  else if (ix > 0) pool.flags[p] &= ~(EF_FACING_LEFT | EF_FLIP_X);
  if (ix !== 0 || iy !== 0) ctx.walkAnim += dt * 10;
  pool.skewX[p] = Math.abs(vx) > 10 ? clamp(vx / 520, -0.16, 0.16) : 0;

  // Horizontal & Vertical solid tilemap sliding (zero gravity)
  const maxWorldX = Math.max(0, ctx.stageWorldW - (TOPDOWN_HB.x + TOPDOWN_HB.w));
  const maxWorldY = Math.max(0, ctx.stageWorldH - (TOPDOWN_HB.y + TOPDOWN_HB.h));

  let nextX = clamp(pool.x[p] + vx * dt, -TOPDOWN_HB.x, maxWorldX);
  if (isTopdownRectBlocked(ctx.tilemap, nextX + TOPDOWN_HB.x, pool.y[p] + TOPDOWN_HB.y, TOPDOWN_HB.w, TOPDOWN_HB.h)) {
    nextX = pool.x[p];
    pool.vx[p] = 0;
  }
  pool.x[p] = nextX;

  let nextY = clamp(pool.y[p] + vy * dt, -TOPDOWN_HB.y, maxWorldY);
  if (isTopdownRectBlocked(ctx.tilemap, pool.x[p] + TOPDOWN_HB.x, nextY + TOPDOWN_HB.y, TOPDOWN_HB.w, TOPDOWN_HB.h)) {
    nextY = pool.y[p];
    pool.vy[p] = 0;
  }
  pool.y[p] = nextY;

  // Build SpatialHash before crate pushing & switch queries to eliminate O(N^2) loops
  pool.rebuildSpatialHash();

  // Step NPCs / enemies & pushable crates
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.activeIndices[i];
    if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;

    if ((pool.flags[s] & EF_PUSHABLE_CRATE) !== 0) {
      const hx0 = pool.x[p] + TOPDOWN_HB.x;
      const hy0 = pool.y[p] + TOPDOWN_HB.y;
      if (
        hx0 < pool.x[s] + pool.w[s] &&
        hx0 + TOPDOWN_HB.w > pool.x[s] &&
        hy0 < pool.y[s] + pool.h[s] &&
        hy0 + TOPDOWN_HB.h > pool.y[s]
      ) {
        const pushDx = ix !== 0 ? ix * params.moveSpeed * 0.72 * dt : 0;
        const pushDy = ix === 0 && iy !== 0 ? iy * params.moveSpeed * 0.72 * dt : 0;
        const cx = clamp(pool.x[s] + pushDx, 0, Math.max(0, ctx.stageWorldW - pool.w[s]));
        const cy = clamp(pool.y[s] + pushDy, 0, Math.max(0, ctx.stageWorldH - pool.h[s]));
        const tileBlocked = isTopdownRectBlocked(ctx.tilemap, cx + 1, cy + 1, pool.w[s] - 2, pool.h[s] - 2);
        const entBlocked = isCrateBlockedByEntity(pool, s, p, cx, cy, ctx.querySlots);
        if (!tileBlocked && !entBlocked) {
          pool.x[s] = cx;
          pool.y[s] = cy;
        } else {
          // Stop player outside crate
          if (ix > 0) pool.x[p] = Math.min(pool.x[p], pool.x[s] - TOPDOWN_HB.x - TOPDOWN_HB.w);
          else if (ix < 0) pool.x[p] = Math.max(pool.x[p], pool.x[s] + pool.w[s] - TOPDOWN_HB.x);
          if (iy > 0) pool.y[p] = Math.min(pool.y[p], pool.y[s] - TOPDOWN_HB.y - TOPDOWN_HB.h);
          else if (iy < 0) pool.y[p] = Math.max(pool.y[p], pool.y[s] + pool.h[s] - TOPDOWN_HB.y);
        }
      }
      continue;
    }

    if ((pool.behaviorMask[s] & BM_PATROL) !== 0) {
      pool.x[s] += pool.vx[s] * dt;
      if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
      else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
      if (pool.vx[s] < 0) pool.flags[s] |= EF_FLIP_X;
      else pool.flags[s] &= ~EF_FLIP_X;
    } else if ((pool.behaviorMask[s] & BM_SIN_FLOAT) !== 0) {
      pool.timerA[s] += dt * 2.5;
      pool.y[s] = pool.paramB[s] + Math.sin(pool.timerA[s] + pool.paramA[s]) * 10;
    } else if ((pool.behaviorMask[s] & BM_CHASE) !== 0) {
      const ecx = pool.x[s] + pool.w[s] * 0.5;
      const ecy = pool.y[s] + pool.h[s] * 0.5;
      const pcx = pool.x[p] + pool.w[p] * 0.5;
      const pcy = pool.y[p] + pool.h[p] * 0.5;
      const dx = pcx - ecx;
      const dy = pcy - ecy;
      const distSq = dx * dx + dy * dy;
      if (
        distSq <= 160 * 160 &&
        hasGridLineOfSight(
          Math.floor(ecx / TILE_SIZE),
          Math.floor(ecy / TILE_SIZE),
          Math.floor(pcx / TILE_SIZE),
          Math.floor(pcy / TILE_SIZE),
          ctx.isTileOpaque,
        )
      ) {
        const d = Math.max(1, Math.sqrt(distSq));
        const sp = 42;
        const nx = pool.x[s] + (dx / d) * sp * dt;
        const ny = pool.y[s] + (dy / d) * sp * dt;
        if (!isTopdownRectBlocked(ctx.tilemap, nx + 2, pool.y[s] + 2, pool.w[s] - 4, pool.h[s] - 4)) pool.x[s] = nx;
        if (!isTopdownRectBlocked(ctx.tilemap, pool.x[s] + 2, ny + 2, pool.w[s] - 4, pool.h[s] - 4)) pool.y[s] = ny;
      }
    } else if ((pool.flags[s] & EF_BULLET) !== 0) {
      pool.x[s] += pool.vx[s] * dt;
      pool.y[s] += pool.vy[s] * dt;
      pool.timerA[s] -= dt;
      if (pool.timerA[s] <= 0) pool.free(s);
    }
  }

  // Rebuild SpatialHash once after entity movement for O(1) crate-on-switch & player trigger queries
  pool.rebuildSpatialHash();
  for (let i = 0; i < pool.activeCount; i++) {
    const cr = pool.activeIndices[i];
    if ((pool.flags[cr] & EF_PUSHABLE_CRATE) === 0 || (pool.flags[cr] & EF_ALIVE) === 0) continue;
    const ccx = pool.x[cr] + pool.w[cr] * 0.5;
    const ccy = pool.y[cr] + pool.h[cr] * 0.5;
    const nearCount = pool.queryRect(ccx - 16, ccy - 16, ccx + 16, ccy + 16, ctx.querySlots);
    for (let j = 0; j < nearCount; j++) {
      const sw = ctx.querySlots[j];
      if ((pool.flags[sw] & EF_LOGIC_SWITCH) === 0 || pool.aiState[sw] !== 0) continue;
      const scx = pool.x[sw] + pool.w[sw] * 0.5;
      const scy = pool.y[sw] + pool.h[sw] * 0.5;
      if (Math.abs(ccx - scx) < 12 && Math.abs(ccy - scy) < 12) {
        activateLogicSwitch(ctx, sw, params, eventsOut);
      }
    }
  }

  // Hazard tile check
  if (
    ctx.invulnTimer <= 0 &&
    ctx.tilemap.isHazardOverlapping(
      pool.x[p] + TOPDOWN_HB.x,
      pool.y[p] + TOPDOWN_HB.y,
      TOPDOWN_HB.w,
      TOPDOWN_HB.h,
    )
  ) {
    ctx.hearts--;
    ctx.invulnTimer = 1.1;
    pool.flash[p] = 0.4;
    eventsOut.push('hurt');
    ctx.juice.applyPreset('player_hurt');
    if (ctx.hearts <= 0) ctx.status = 'lost';
  }

  // SpatialHash broad-phase entity triggers (logic_switch, key, star, gate, enemy)
  pool.rebuildSpatialHash();
  const hcx = pool.x[p] + pool.w[p] * 0.5;
  const hcy = pool.y[p] + pool.h[p] * 0.5;
  const candCount = pool.queryRect(hcx - 48, hcy - 48, hcx + 48, hcy + 48, ctx.querySlots);
  const actionPressed = ctx.input.justPressed('action');

  for (let i = 0; i < candCount; i++) {
    const s = ctx.querySlots[i];
    if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
    const f = pool.flags[s];
    const archIdx = pool.archetypeIdx[s];
    const meta = archIdx >= 0 ? ctx.archetypeMetaByIdx[archIdx] : undefined;
    const aid = meta?.id ?? '';
    const ecx = pool.x[s] + pool.w[s] * 0.5;
    const ecy = pool.y[s] + pool.h[s] * 0.5;
    const dist = Math.hypot(hcx - ecx, hcy - ecy);

    if ((f & EF_LOGIC_SWITCH) !== 0 && pool.aiState[s] === 0 && (dist < 14 || (actionPressed && dist < 24))) {
      activateLogicSwitch(ctx, s, params, eventsOut);
    } else if ((f & EF_COLLECTIBLE) !== 0 && (f & EF_LOGIC_SWITCH) === 0 && dist < 14) {
      pool.free(s);
      ctx.juice.registerCombo();
      if (aid === 'key') {
        ctx.hasKey = true;
        ctx.score += 200;
        eventsOut.push('key');
        const swOk = ctx.genre.switchesTotal === 0 || ctx.vm.getVar('switches', 0) >= ctx.genre.switchesTotal;
        if (swOk) {
          ctx.gateUnlocked = true;
          ctx.spawnFloatingText('UNLOCKED!', ecx, ecy - 10, '#ffd447');
          ctx.vm.emitSignal('gate_unlocked');
        } else {
          ctx.spawnFloatingText('KEY!', ecx, ecy - 10, '#ffd447');
        }
      } else {
        ctx.stageStarsCollected++;
        ctx.score += meta?.scoreValue ?? 100;
        eventsOut.push('star');
      }
      ctx.juice.spawnBurst(ecx, ecy, ['#ffd447', '#fffaf0', '#56d39c'], 7, params.sparkleDensity);
    } else if (aid === 'gate' && ctx.gateUnlocked && dist < 16) {
      if (ctx.stageIdx + 1 < ctx.def.stages.length) {
        ctx.enterStage(ctx.stageIdx + 1);
        eventsOut.push('key');
        return;
      } else {
        ctx.status = 'won';
        eventsOut.push('win');
      }
    } else if ((f & (EF_ENEMY | EF_HAZARD)) !== 0 && (f & EF_GRAVITY) === 0 && ctx.invulnTimer <= 0 && dist < 13) {
      ctx.hearts--;
      ctx.invulnTimer = 1.1;
      pool.flash[p] = 0.4;
      eventsOut.push('hurt');
      ctx.juice.applyPreset('player_hurt');
      if (ctx.hearts <= 0) ctx.status = 'lost';
    }

    if (ctx.vmCollisionCount < ctx.vmCollisions.length && dist < 16) {
      const cp = ctx.vmCollisions[ctx.vmCollisionCount++];
      cp.selfSlot = p;
      cp.otherSlot = s;
      cp.selfTag = 'player';
      cp.otherTag = aid;
    }
  }

  pool.sx[p] = ctx.heroSquash.scaleX;
  pool.sy[p] = ctx.heroSquash.scaleY;
  ctx.trackCameraTarget(pool.x[p], pool.y[p], dt);
}

export function acquireHudSlot(pool: HudPrimitiveDesc[], idx: number): HudPrimitiveDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { kind: 'bar', x: 0, y: 0, w: 32, h: 6, color: '#56d39c', worldSpace: false };
    pool[idx] = slot;
  }
  slot.x2 = undefined;
  slot.y2 = undefined;
  slot.ratio = undefined;
  slot.text = undefined;
  slot.scale = undefined;
  slot.align = undefined;
  slot.shadowColor = undefined;
  slot.bgColor = undefined;
  slot.alpha = undefined;
  slot.worldSpace = false;
  return slot;
}

export function buildGenreHudPrimitives(
  ctx: GenreRuntimeContext,
  genreHud: 'fighter' | 'card' | 'grid',
  out: HudPrimitiveDesc[],
  hudSlots: HudPrimitiveDesc[],
  startCount: number,
  vw: number,
  vh: number,
  bossHp: number,
  bossMaxHp: number,
): number {
  let count = startCount;

  if (genreHud === 'fighter') {
    const box = acquireHudSlot(hudSlots, count++);
    box.kind = 'box';
    box.x = 6;
    box.y = 6;
    box.w = vw - 12;
    box.h = 24;
    box.color = '#ffd447';
    box.bgColor = '#120e24';
    box.alpha = 0.52;
    out.push(box);

    const barW = Math.max(40, Math.floor((vw - 72) * 0.5));
    const p1Max = ctx.vm.hasVar('p1MaxHp')
      ? Math.max(1, ctx.vm.getVar('p1MaxHp', 100))
      : ctx.vm.hasVar('p1Hp')
        ? 100
        : Math.max(1, ctx.maxHearts);
    const p1Val = ctx.vm.hasVar('p1Hp') ? ctx.vm.getVar('p1Hp', 100) : ctx.hearts;

    const p1Txt = acquireHudSlot(hudSlots, count++);
    p1Txt.kind = 'text';
    p1Txt.x = 10;
    p1Txt.y = 8;
    p1Txt.w = 0;
    p1Txt.h = 0;
    p1Txt.text = `P1 HP ${Math.ceil(p1Val)}`;
    p1Txt.scale = 1;
    p1Txt.align = 'left';
    p1Txt.color = '#56d39c';
    p1Txt.shadowColor = '#120d1e';
    p1Txt.alpha = 1;
    out.push(p1Txt);

    const p1Bar = acquireHudSlot(hudSlots, count++);
    p1Bar.kind = 'bar';
    p1Bar.x = 10;
    p1Bar.y = 17;
    p1Bar.w = barW;
    p1Bar.h = 6;
    p1Bar.ratio = clamp(p1Val / p1Max, 0, 1);
    p1Bar.color = '#56d39c';
    p1Bar.bgColor = '#251738';
    p1Bar.alpha = 0.95;
    out.push(p1Bar);

    const comboVal = ctx.vm.hasVar('combo') ? ctx.vm.getVar('combo', 0) : ctx.juice.comboCount;
    const comboTxt = acquireHudSlot(hudSlots, count++);
    comboTxt.kind = 'text';
    comboTxt.x = Math.floor(vw * 0.5);
    comboTxt.y = 8;
    comboTxt.w = 0;
    comboTxt.h = 0;
    comboTxt.text = `COMBO ${Math.floor(comboVal)}`;
    comboTxt.scale = 1;
    comboTxt.align = 'center';
    comboTxt.color = comboVal > 0 ? '#ffd447' : '#fffaf0';
    comboTxt.shadowColor = '#120d1e';
    comboTxt.alpha = 1;
    out.push(comboTxt);

    const stamW = Math.max(28, Math.floor(barW * 0.7));
    const p1Stam = acquireHudSlot(hudSlots, count++);
    p1Stam.kind = 'bar';
    p1Stam.x = 10;
    p1Stam.y = 25;
    p1Stam.w = stamW;
    p1Stam.h = 3;
    p1Stam.ratio = clamp(comboVal / 10, 0.1, 1);
    p1Stam.color = '#ffd447';
    p1Stam.bgColor = '#1a112a';
    p1Stam.alpha = 0.9;
    out.push(p1Stam);

    const p2Max = ctx.vm.hasVar('p2MaxHp')
      ? Math.max(1, ctx.vm.getVar('p2MaxHp', 100))
      : bossMaxHp > 0
        ? bossMaxHp
        : 100;
    const p2Val = ctx.vm.hasVar('p2Hp')
      ? ctx.vm.getVar('p2Hp', MULTIGENRE_VAR_DEFAULTS.p2Hp)
      : bossMaxHp > 0
        ? bossHp
        : MULTIGENRE_VAR_DEFAULTS.p2Hp;

    const p2Txt = acquireHudSlot(hudSlots, count++);
    p2Txt.kind = 'text';
    p2Txt.x = vw - 10;
    p2Txt.y = 8;
    p2Txt.w = 0;
    p2Txt.h = 0;
    p2Txt.text = `P2 HP ${Math.ceil(p2Val)}`;
    p2Txt.scale = 1;
    p2Txt.align = 'right';
    p2Txt.color = '#ff5d8f';
    p2Txt.shadowColor = '#120d1e';
    p2Txt.alpha = 1;
    out.push(p2Txt);

    const p2Bar = acquireHudSlot(hudSlots, count++);
    p2Bar.kind = 'bar';
    p2Bar.x = vw - 10 - barW;
    p2Bar.y = 17;
    p2Bar.w = barW;
    p2Bar.h = 6;
    p2Bar.ratio = clamp(p2Val / p2Max, 0, 1);
    p2Bar.color = '#ff5d8f';
    p2Bar.bgColor = '#251738';
    p2Bar.alpha = 0.95;
    out.push(p2Bar);

    const guardBar = acquireHudSlot(hudSlots, count++);
    guardBar.kind = 'bar';
    guardBar.x = vw - 10 - stamW;
    guardBar.y = 25;
    guardBar.w = stamW;
    guardBar.h = 3;
    guardBar.ratio = clamp(ctx.vm.getVar('p2Guard', 100) / 100, 0, 1);
    guardBar.color = '#5ec2f7';
    guardBar.bgColor = '#1a112a';
    guardBar.alpha = 0.9;
    out.push(guardBar);
    return count;
  }

  if (genreHud === 'card') {
    const hpVal = ctx.vm.hasVar('hp')
      ? ctx.vm.getVar('hp', 20)
      : ctx.vm.hasVar('p1Hp')
        ? ctx.vm.getVar('p1Hp', 20)
        : ctx.hearts;
    const hpMax = ctx.vm.hasVar('maxHp')
      ? Math.max(1, ctx.vm.getVar('maxHp', 20))
      : ctx.vm.hasVar('hp') || ctx.vm.hasVar('p1Hp')
        ? Math.max(20, hpVal)
        : Math.max(1, ctx.maxHearts);

    const hpTxt = acquireHudSlot(hudSlots, count++);
    hpTxt.kind = 'text';
    hpTxt.x = 8;
    hpTxt.y = 6;
    hpTxt.w = 0;
    hpTxt.h = 0;
    hpTxt.text = `HP ${Math.ceil(hpVal)}`;
    hpTxt.scale = 1;
    hpTxt.align = 'left';
    hpTxt.color = '#56d39c';
    hpTxt.shadowColor = '#120d1e';
    hpTxt.alpha = 1;
    out.push(hpTxt);

    const hpBar = acquireHudSlot(hudSlots, count++);
    hpBar.kind = 'bar';
    hpBar.x = 8;
    hpBar.y = 15;
    hpBar.w = 78;
    hpBar.h = 5;
    hpBar.ratio = clamp(hpVal / hpMax, 0, 1);
    hpBar.color = '#56d39c';
    hpBar.bgColor = '#1b1433';
    hpBar.alpha = 0.94;
    out.push(hpBar);

    const manaVal = ctx.vm.getVar('mana', MULTIGENRE_VAR_DEFAULTS.mana);
    const manaMax = Math.max(1, ctx.vm.getVar('maxMana', 3));
    const shieldVal = ctx.vm.getVar('shield', 0);

    const manaTxt = acquireHudSlot(hudSlots, count++);
    manaTxt.kind = 'text';
    manaTxt.x = 8;
    manaTxt.y = 22;
    manaTxt.w = 0;
    manaTxt.h = 0;
    manaTxt.text = shieldVal > 0 ? `MANA ${Math.ceil(manaVal)} SHD ${Math.ceil(shieldVal)}` : `MANA ${Math.ceil(manaVal)}`;
    manaTxt.scale = 1;
    manaTxt.align = 'left';
    manaTxt.color = '#5ec2f7';
    manaTxt.shadowColor = '#120d1e';
    manaTxt.alpha = 1;
    out.push(manaTxt);

    const manaBar = acquireHudSlot(hudSlots, count++);
    manaBar.kind = 'bar';
    manaBar.x = 8;
    manaBar.y = 31;
    manaBar.w = 68;
    manaBar.h = 4;
    manaBar.ratio = clamp(manaVal / manaMax, 0, 1);
    manaBar.color = '#5ec2f7';
    manaBar.bgColor = '#141933';
    manaBar.alpha = 0.94;
    out.push(manaBar);

    const enemyHpVal = ctx.vm.hasVar('enemyHp')
      ? ctx.vm.getVar('enemyHp', 20)
      : ctx.vm.getVar('p2Hp', MULTIGENRE_VAR_DEFAULTS.p2Hp);
    const enemyHpMax = Math.max(1, ctx.vm.getVar('maxEnemyHp', Math.max(20, enemyHpVal)));

    const foeTxt = acquireHudSlot(hudSlots, count++);
    foeTxt.kind = 'text';
    foeTxt.x = vw - 8;
    foeTxt.y = 6;
    foeTxt.w = 0;
    foeTxt.h = 0;
    foeTxt.text = `FOE ${Math.ceil(enemyHpVal)}`;
    foeTxt.scale = 1;
    foeTxt.align = 'right';
    foeTxt.color = '#ff5d8f';
    foeTxt.shadowColor = '#120d1e';
    foeTxt.alpha = 1;
    out.push(foeTxt);

    const enemyBar = acquireHudSlot(hudSlots, count++);
    enemyBar.kind = 'bar';
    enemyBar.x = vw - 86;
    enemyBar.y = 15;
    enemyBar.w = 78;
    enemyBar.h = 5;
    enemyBar.ratio = clamp(enemyHpVal / enemyHpMax, 0, 1);
    enemyBar.color = '#ff5d8f';
    enemyBar.bgColor = '#281326';
    enemyBar.alpha = 0.94;
    out.push(enemyBar);

    const turnVal = ctx.vm.getVar('turn', MULTIGENRE_VAR_DEFAULTS.turn);
    const turnTxt = acquireHudSlot(hudSlots, count++);
    turnTxt.kind = 'text';
    turnTxt.x = Math.floor(vw * 0.5);
    turnTxt.y = 6;
    turnTxt.w = 0;
    turnTxt.h = 0;
    turnTxt.text = `TURN ${Math.floor(turnVal)}`;
    turnTxt.scale = 1;
    turnTxt.align = 'center';
    turnTxt.color = '#ffd447';
    turnTxt.shadowColor = '#120d1e';
    turnTxt.alpha = 1;
    out.push(turnTxt);

    const turnBar = acquireHudSlot(hudSlots, count++);
    turnBar.kind = 'bar';
    turnBar.x = Math.floor(vw * 0.5) - 24;
    turnBar.y = 15;
    turnBar.w = 48;
    turnBar.h = 4;
    turnBar.ratio = clamp(((turnVal % 10) || 10) / 10, 0.1, 1);
    turnBar.color = '#ffd447';
    turnBar.bgColor = '#1e1930';
    turnBar.alpha = 0.92;
    out.push(turnBar);

    const deck = ctx.def.cardDeck && ctx.def.cardDeck.length > 0 ? ctx.def.cardDeck : DEFAULT_CARD_DECK;
    const deckLen = Math.min(4, deck.length);
    const cardW = getCardBoxW(deckLen, vw);
    const baseCardY = getCardBoxY(vh);
    for (let i = 0; i < deckLen; i++) {
      const card = deck[i];
      const selected = i === ctx.genre.cardCursor;
      const affordable = manaVal >= card.cost;
      const bx = getCardBoxX(i, deckLen, vw);
      const by = baseCardY - (selected ? 3 : 0);

      const cBox = acquireHudSlot(hudSlots, count++);
      cBox.kind = 'box';
      cBox.x = bx;
      cBox.y = by;
      cBox.w = cardW;
      cBox.h = CARD_BOX_H;
      cBox.color = selected ? '#ffd447' : affordable ? (card.color ?? '#e0aaff') : '#6f6688';
      cBox.bgColor = selected ? '#281d48' : '#16112e';
      cBox.alpha = affordable ? 0.92 : 0.65;
      out.push(cBox);

      const cTxt = acquireHudSlot(hudSlots, count++);
      cTxt.kind = 'text';
      cTxt.x = bx + Math.floor(cardW * 0.5);
      cTxt.y = by + 8;
      cTxt.w = 0;
      cTxt.h = 0;
      cTxt.text = `${card.cost}:${card.name}`;
      cTxt.scale = 1;
      cTxt.align = 'center';
      cTxt.color = selected ? '#ffd447' : affordable ? '#fffaf0' : '#9b91b5';
      cTxt.shadowColor = '#120d1e';
      cTxt.alpha = affordable ? 1 : 0.72;
      out.push(cTxt);
    }
    return count;
  }

  // 'grid'
  const box = acquireHudSlot(hudSlots, count++);
  box.kind = 'box';
  box.x = 8;
  box.y = 8;
  box.w = 124;
  box.h = 20;
  box.color = '#5ec2f7';
  box.bgColor = '#120e24';
  box.alpha = 0.82;
  out.push(box);

  const swVal = Math.floor(ctx.vm.getVar('switches', MULTIGENRE_VAR_DEFAULTS.switches));
  const swMax = Math.max(1, Math.floor(ctx.vm.getVar('switchesTotal', Math.max(1, ctx.genre.switchesTotal || 3))));

  const swTxt = acquireHudSlot(hudSlots, count++);
  swTxt.kind = 'text';
  swTxt.x = 12;
  swTxt.y = 10;
  swTxt.w = 0;
  swTxt.h = 0;
  swTxt.text = `SWITCHES ${swVal}/${swMax}`;
  swTxt.scale = 1;
  swTxt.align = 'left';
  swTxt.color = swVal >= swMax ? '#ffd447' : '#fffaf0';
  swTxt.shadowColor = '#120d1e';
  swTxt.alpha = 1;
  out.push(swTxt);

  const swBar = acquireHudSlot(hudSlots, count++);
  swBar.kind = 'bar';
  swBar.x = 12;
  swBar.y = 20;
  swBar.w = 116;
  swBar.h = 5;
  swBar.ratio = clamp(swVal / swMax, 0, 1);
  swBar.color = swVal >= swMax ? '#ffd447' : '#56d39c';
  swBar.bgColor = '#1f1b33';
  swBar.alpha = 0.95;
  out.push(swBar);

  return count;
}
