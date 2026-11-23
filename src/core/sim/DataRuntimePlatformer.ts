import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { LogicalViewport } from '../gpu/GpuTypes.ts';
import type { InputMap } from '../input/InputMap.ts';
import { hasGridLineOfSight, raycastGrid2DInto } from '../math/Visibility2D.ts';
import { clamp, type RuntimeParams, type SimEvent } from '../types/WorldTypes.ts';
import type { CartridgeArchetypeDef, CartridgeJsonV1 } from './CartridgeSchema.ts';
import type { DualPerspectiveRuntime, DualPerspectiveStepResult } from './DualPerspectiveRuntime.ts';
import type { VmCollisionPair } from './EventActionVm.ts';
import type { JuiceSystem } from './JuiceSystem.ts';
import type { ProceduralVisualRigRuntime } from './ProceduralVisualRig.ts';
import {
  BM_CHASE,
  BM_MOVING_PLATFORM,
  BM_PATROL,
  BM_SIN_FLOAT,
  EF_ALIVE,
  EF_BOSS,
  EF_BOUNCY,
  EF_BULLET,
  EF_COLLECTIBLE,
  EF_FACING_LEFT,
  EF_FLIP_X,
  EF_GRAVITY,
  EF_STOMPABLE,
  type SoaEntityPool,
} from './SoaEntityPool.ts';
import { COLLISION_SOLID, TILE_SIZE, type TileAabbStepResult, type TilemapGrid } from './TilemapGrid.ts';

export const HERO_HB = { x: 2, y: 2, w: 12, h: 14 };
export const EF_GRAPPLE_TARGET = 1 << 23;
export const EF_CRYSTAL_RESET = 1 << 24;
export const EF_CRUMBLE_TILE = 1 << 25;
export const EF_ZIP_BLOCK = 1 << 26;
export const RT_GRAPPLE_SHOOT_SPEED = 720;
export const RT_AIM_ROT_SPEED = 28;
export const RT_MAGNET_COS = Math.cos((26 * Math.PI) / 180);
export const RT_GRAPPLE_LINKS = 5;
export const MAX_VM_COLLISION_PAIRS = 256;

export interface DataPlatformerContext {
  readonly def: CartridgeJsonV1;
  readonly pool: SoaEntityPool;
  readonly input: InputMap;
  readonly juice: JuiceSystem;
  readonly visualRig: ProceduralVisualRigRuntime;
  readonly dualPerspective: DualPerspectiveRuntime;
  readonly dualPerspectiveStepOut: DualPerspectiveStepResult;
  readonly archetypes: readonly {
    id: string;
    def: CartridgeArchetypeDef;
    flags: number;
    behaviorMask: number;
    scoreValue: number;
    dropKind?: string;
  }[];
  readonly archetypeMetaByIdx: readonly { id: string; scoreValue: number; dropKind?: string }[];
  readonly tilemap: TilemapGrid;
  readonly isTileOpaque: (tx: number, ty: number) => boolean;
  readonly grappleEnabled: boolean;
  readonly grappleMaxRange: number;
  readonly grappleAttachWalls: boolean;
  readonly grapplePullSpeed: number;
  readonly grappleRayScratch: Float64Array;
  readonly heroSquash: { scaleX: number; scaleY: number };
  readonly aabbBox: { x: number; y: number; vx: number; vy: number };
  readonly aabbRes: TileAabbStepResult;
  readonly querySlots: Int32Array;
  readonly vmCollisions: VmCollisionPair[];
  readonly eventsOut: SimEvent[];
  stageViewport: LogicalViewport;
  stageWorldW: number;
  stageWorldH: number;
  stageIdx: number;
  playerSlot: number;
  bossSlot: number;
  hearts: number;
  maxHearts: number;
  score: number;
  status: 'playing' | 'won' | 'lost';
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  hasKey: boolean;
  gateUnlocked: boolean;
  bestStarsByStage: number[];
  stageStarsCollected: number;
  checkpointX: number;
  checkpointY: number;
  coyote: number;
  airJumpsLeft: number;
  dashTimer: number;
  dashCooldown: number;
  pulseCooldown: number;
  invulnTimer: number;
  walkAnim: number;
  relics: { doubleJump: boolean; airDash: boolean };
  lastHeroSprite: SpriteId;
  vmCollisionCount: number;
  grappleState: 'idle' | 'shooting' | 'swinging' | 'pulling';
  grappleMode: 'swing' | 'pull';
  grappleAnchorX: number;
  grappleAnchorY: number;
  grappleTipX: number;
  grappleTipY: number;
  grappleRopeLength: number;
  grappleAimAngle: number;
  grappleHoldViaInput: boolean;
  grappleSwingElapsed: number;
  grapplePullElapsed: number;
  grapplePreviewKind: 'none' | 'wall' | 'ring';
  grapplePreviewX: number;
  grapplePreviewY: number;
  grappleTargetSlot: number;
  spawnArchetype(archetypeId: string, x: number, y: number, vx?: number, vy?: number, parentSlot?: number): number;
  enterStage(idx: number): void;
  trackCameraTarget(targetX: number, targetY: number, dt: number): void;
}

function wrapAimAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function updateRuntimeAim(ctx: DataPlatformerContext, dt: number, hcx: number, hcy: number): void {
  if (ctx.input.pointerActive()) {
    const safeZoom = Math.max(0.5, ctx.cameraZoom);
    const mouseWorldX = ctx.cameraX + ctx.input.pointerX() * (ctx.stageViewport.width / safeZoom);
    const mouseWorldY = ctx.cameraY + ctx.input.pointerY() * (ctx.stageViewport.height / safeZoom);
    ctx.grappleAimAngle = Math.atan2(mouseWorldY - hcy, mouseWorldX - hcx);
    return;
  }

  const rx = ctx.input.rightAxisX();
  const ry = ctx.input.rightAxisY();
  let hasDesired = false;
  let desired = ctx.grappleAimAngle;
  if (rx * rx + ry * ry > 0.04) {
    desired = Math.atan2(ry, rx);
    hasDesired = true;
  } else {
    const mx = ctx.input.axisX();
    const my = ctx.input.axisY();
    if (mx !== 0 || my !== 0) {
      desired = Math.atan2(my, mx);
      hasDesired = true;
    }
  }
  if (hasDesired) {
    const diff = wrapAimAngle(desired - ctx.grappleAimAngle);
    const maxStep = RT_AIM_ROT_SPEED * dt;
    ctx.grappleAimAngle =
      Math.abs(diff) <= maxStep
        ? desired
        : wrapAimAngle(ctx.grappleAimAngle + Math.sign(diff) * maxStep);
  }
}

function refreshRuntimeGrapplePreview(ctx: DataPlatformerContext, hcx: number, hcy: number): void {
  const ndx = Math.cos(ctx.grappleAimAngle);
  const ndy = Math.sin(ctx.grappleAimAngle);
  const maxR = ctx.grappleMaxRange;
  let bestDist = maxR + 1;
  let bestSlot = -1;
  let bestX = 0;
  let bestY = 0;

  const pool = ctx.pool;
  for (let i = 0; i < pool.activeCount; i++) {
    const s = pool.activeIndices[i];
    if ((pool.flags[s] & EF_GRAPPLE_TARGET) === 0) continue;
    const ax = pool.x[s] + pool.w[s] * 0.5;
    const ay = pool.y[s] + pool.h[s] * 0.5;
    const vx = ax - hcx;
    const vy = ay - hcy;
    const dist = Math.hypot(vx, vy);
    if (dist < 10 || dist > maxR || dist >= bestDist) continue;
    const dot = (vx / dist) * ndx + (vy / dist) * ndy;
    if (dot < RT_MAGNET_COS) continue;
    bestDist = dist;
    bestSlot = s;
    bestX = ax;
    bestY = ay;
  }

  if (bestSlot >= 0) {
    ctx.grapplePreviewKind = 'ring';
    ctx.grapplePreviewX = bestX;
    ctx.grapplePreviewY = bestY;
    ctx.grappleTargetSlot = bestSlot;
    return;
  }

  if (ctx.grappleAttachWalls) {
    const hit = raycastGrid2DInto(
      ctx.tilemap.cols,
      ctx.tilemap.rows,
      hcx,
      hcy,
      ndx,
      ndy,
      maxR,
      ctx.isTileOpaque,
      ctx.grappleRayScratch,
      0,
      TILE_SIZE,
    );
    if (hit && ctx.grappleRayScratch[1] >= 6) {
      ctx.grapplePreviewKind = 'wall';
      ctx.grapplePreviewX = ctx.grappleRayScratch[2];
      ctx.grapplePreviewY = ctx.grappleRayScratch[3];
      ctx.grappleTargetSlot = -1;
      return;
    }
  }

  ctx.grapplePreviewKind = 'none';
  const previewDist = Math.min(64, maxR);
  ctx.grapplePreviewX = hcx + ndx * previewDist;
  ctx.grapplePreviewY = hcy + ndy * previewDist;
  ctx.grappleTargetSlot = -1;
}

function fireRuntimeGrapple(ctx: DataPlatformerContext, mode: 'swing' | 'pull', hcx: number, hcy: number): boolean {
  if (ctx.grapplePreviewKind === 'none') return false;
  ctx.grappleState = 'shooting';
  ctx.grappleMode = mode;
  ctx.grappleAnchorX = ctx.grapplePreviewX;
  ctx.grappleAnchorY = ctx.grapplePreviewY;
  ctx.grappleTipX = hcx;
  ctx.grappleTipY = hcy;
  ctx.grappleSwingElapsed = 0;
  ctx.grapplePullElapsed = 0;
  return true;
}

export function stepDataPlatformer(ctx: DataPlatformerContext, dt: number, params: RuntimeParams): void {
  const p = ctx.playerSlot;
  const pool = ctx.pool;
  const worldH = ctx.stageWorldH;

  if (ctx.invulnTimer > 0) ctx.invulnTimer = Math.max(0, ctx.invulnTimer - dt);
  if (ctx.dashCooldown > 0) ctx.dashCooldown = Math.max(0, ctx.dashCooldown - dt);
  if (ctx.pulseCooldown > 0) ctx.pulseCooldown = Math.max(0, ctx.pulseCooldown - dt);

  // 1. Controls & Physics (plus optional Grapple system when grappleConfig.enabled)
  let grappleHandledMotion = false;
  let grappleBlockActions = false;
  let grappleBlockJump = false;

  if (ctx.grappleEnabled) {
    const ghcx = pool.x[p] + 8;
    const ghcy = pool.y[p] + 8;
    updateRuntimeAim(ctx, dt, ghcx, ghcy);
    refreshRuntimeGrapplePreview(ctx, ghcx, ghcy);

    if (ctx.grappleState === 'idle') {
      if (ctx.input.justPressed('skillY') || ctx.input.pointerPrimaryJustPressed()) {
        if (fireRuntimeGrapple(ctx, 'swing', ghcx, ghcy)) {
          ctx.grappleHoldViaInput = true;
          ctx.eventsOut.push('rail');
          grappleBlockActions = true;
        }
      } else if (ctx.input.justPressed('shoulderR') || ctx.input.pointerSecondaryJustPressed()) {
        if (fireRuntimeGrapple(ctx, 'pull', ghcx, ghcy)) {
          ctx.grappleHoldViaInput = false;
          ctx.eventsOut.push('rail');
          grappleBlockActions = true;
        }
      }
    }

    if (
      (ctx.input.held('skillY') || ctx.input.pointerPrimaryHeld()) &&
      (ctx.grappleState === 'shooting' || ctx.grappleState === 'swinging')
    ) {
      ctx.grappleHoldViaInput = true;
    }

    if (ctx.grappleState === 'shooting') {
      if (ctx.grappleTargetSlot >= 0 && (pool.flags[ctx.grappleTargetSlot] & EF_ALIVE) !== 0) {
        ctx.grappleAnchorX = pool.x[ctx.grappleTargetSlot] + pool.w[ctx.grappleTargetSlot] * 0.5;
        ctx.grappleAnchorY = pool.y[ctx.grappleTargetSlot] + pool.h[ctx.grappleTargetSlot] * 0.5;
      }
      const dx = ctx.grappleAnchorX - ctx.grappleTipX;
      const dy = ctx.grappleAnchorY - ctx.grappleTipY;
      const rem = Math.hypot(dx, dy);
      const stepDist = RT_GRAPPLE_SHOOT_SPEED * dt;
      if (rem <= stepDist + 6) {
        ctx.grappleTipX = ctx.grappleAnchorX;
        ctx.grappleTipY = ctx.grappleAnchorY;
        ctx.juice.triggerHitstop(0.018);
        ctx.juice.addTrauma(0.14);
        ctx.juice.registerCombo();
        ctx.eventsOut.push('snap');
        ctx.juice.spawnBurst(
          ctx.grappleAnchorX,
          ctx.grappleAnchorY,
          ['#ffd447', '#ff5d8f', '#fffaf0'],
          6,
          params.sparkleDensity,
        );
        ctx.dashCooldown = 0;
        ctx.airJumpsLeft = 1;
        ctx.dashTimer = 0;
        if (ctx.grappleMode === 'swing') {
          ctx.grappleState = 'swinging';
          ctx.grappleSwingElapsed = 0;
          ctx.grappleRopeLength = clamp(
            Math.hypot(ghcx - ctx.grappleAnchorX, ghcy - ctx.grappleAnchorY),
            24,
            ctx.grappleMaxRange,
          );
        } else {
          ctx.grappleState = 'pulling';
          ctx.grapplePullElapsed = 0;
        }
      } else {
        ctx.grappleTipX += (dx / rem) * stepDist;
        ctx.grappleTipY += (dy / rem) * stepDist;
      }
    }

    if (ctx.grappleState === 'swinging') {
      ctx.grappleSwingElapsed += dt;
      grappleBlockActions = true;
      if (ctx.input.justPressed('action') || ctx.input.pointerSecondaryJustPressed()) {
        ctx.grappleMode = 'pull';
        ctx.grappleState = 'pulling';
        ctx.grapplePullElapsed = 0;
        ctx.grappleHoldViaInput = false;
        ctx.eventsOut.push('snap');
      } else if (
        (ctx.grappleHoldViaInput &&
          !(ctx.input.held('skillY') || ctx.input.pointerPrimaryHeld()) &&
          ctx.grappleSwingElapsed > 0.02) ||
        ctx.input.justPressed('jump')
      ) {
        ctx.grappleState = 'idle';
        ctx.grappleHoldViaInput = false;
        pool.vx[p] *= 1.18;
        pool.vy[p] = Math.min(pool.vy[p] * 1.1, -125);
        ctx.dashCooldown = 0;
        ctx.airJumpsLeft = 1;
        ctx.heroSquash.scaleX = 0.8;
        ctx.heroSquash.scaleY = 1.24;
        ctx.eventsOut.push('jump');
        grappleBlockJump = true;
      } else {
        grappleHandledMotion = true;
        const reel = ctx.input.axisY();
        if (reel !== 0) {
          ctx.grappleRopeLength = clamp(ctx.grappleRopeLength + reel * 115 * dt, 24, ctx.grappleMaxRange);
        }
        const rx = ghcx - ctx.grappleAnchorX;
        const ry = ghcy - ctx.grappleAnchorY;
        const rDist = Math.max(1, Math.hypot(rx, ry));
        const tx = -ry / rDist;
        const ty = rx / rDist;
        const pump = ctx.input.axisX();
        if (pump !== 0) {
          const signT = ty >= 0 ? -pump : pump;
          const thrust = 260 * dt;
          pool.vx[p] += tx * signT * thrust;
          pool.vy[p] += ty * signT * thrust;
          if (pump < 0) pool.flags[p] |= EF_FACING_LEFT;
          else pool.flags[p] &= ~EF_FACING_LEFT;
        }
        pool.vy[p] = Math.min(340, pool.vy[p] + 520 * params.gravityScale * dt);
      }
    }

    if (ctx.grappleState === 'pulling') {
      ctx.grapplePullElapsed += dt;
      grappleBlockActions = true;
      const dx = ctx.grappleAnchorX - ghcx;
      const dy = ctx.grappleAnchorY - ghcy;
      const dist = Math.hypot(dx, dy);
      if (dist < 14 || ctx.grapplePullElapsed > 0.7 || ctx.input.justPressed('jump')) {
        ctx.grappleState = 'idle';
        ctx.grappleHoldViaInput = false;
        ctx.dashCooldown = 0;
        ctx.airJumpsLeft = 1;
        pool.vy[p] = Math.min(pool.vy[p], -125);
        ctx.eventsOut.push('jump');
        grappleBlockJump = true;
      } else {
        grappleHandledMotion = true;
        pool.vx[p] = (dx / dist) * ctx.grapplePullSpeed;
        pool.vy[p] = (dy / dist) * ctx.grapplePullSpeed;
        if (dx < -2) pool.flags[p] |= EF_FACING_LEFT;
        else if (dx > 2) pool.flags[p] &= ~EF_FACING_LEFT;
      }
    }
  }

  const dir = ctx.input.axisX();
  if (!grappleHandledMotion) {
    if (ctx.dashTimer > 0) {
      ctx.dashTimer = Math.max(0, ctx.dashTimer - dt);
      pool.vy[p] = 0;
    } else if (dir !== 0) {
      if (dir < 0) pool.flags[p] |= EF_FACING_LEFT;
      else pool.flags[p] &= ~EF_FACING_LEFT;
      const targetVx = dir * params.moveSpeed;
      const accel = (pool.flags[p] & EF_FLIP_X) !== 0 ? 640 : 960;
      const onG = ctx.aabbRes.onGround;
      const a = onG ? 960 : accel;
      pool.vx[p] = pool.vx[p] < targetVx ? Math.min(targetVx, pool.vx[p] + a * dt) : Math.max(targetVx, pool.vx[p] - a * dt);
      ctx.walkAnim += dt * 9;
    } else {
      const decel = ctx.aabbRes.onGround ? 880 : 300;
      pool.vx[p] = pool.vx[p] > 0 ? Math.max(0, pool.vx[p] - decel * dt) : Math.min(0, pool.vx[p] + decel * dt);
    }

    if (ctx.aabbRes.onGround) ctx.airJumpsLeft = ctx.relics.doubleJump ? 1 : 0;
    if (!grappleBlockJump && (ctx.input.justPressed('jump') || ctx.input.justPressed('up'))) ctx.input.primeBuffer('jump', 0.13);
    ctx.coyote = ctx.aabbRes.onGround ? 0.11 : Math.max(0, ctx.coyote - dt);

    const parkourCfg = ctx.def.player.parkourMechanics;
    const wallSlideEnabled = Boolean(parkourCfg?.wallSlide);
    const waveDashEnabled = Boolean(parkourCfg?.waveDash);
    const isWallSliding = wallSlideEnabled && !ctx.aabbRes.onGround && ctx.aabbRes.hitWall && pool.vy[p] > 20;

    if (!grappleBlockJump && ctx.input.hasBuffered('jump') && ctx.coyote > 0) {
      ctx.input.consumeBuffer('jump');
      if (waveDashEnabled && ctx.dashTimer > 0) {
        const wSign = (pool.flags[p] & EF_FACING_LEFT) !== 0 ? -1 : 1;
        pool.vx[p] = wSign * Math.max(255, Math.abs(pool.vx[p]) * 1.16);
        pool.vy[p] = -params.jumpPower * 0.88;
        ctx.dashTimer = 0;
        ctx.dashCooldown = 0;
        ctx.heroSquash.scaleX = 1.32;
        ctx.heroSquash.scaleY = 0.74;
        ctx.juice.addTrauma(0.14);
        ctx.juice.registerCombo();
        ctx.eventsOut.push('snap');
        ctx.juice.spawnBurst(pool.x[p] + 8, pool.y[p] + 15, ['#5ec2f7', '#ffd447', '#fffaf0'], 8, params.sparkleDensity);
      } else {
        pool.vy[p] = -params.jumpPower;
        ctx.heroSquash.scaleX = 0.78;
        ctx.heroSquash.scaleY = 1.24;
        ctx.eventsOut.push('jump');
        ctx.juice.spawnBurst(pool.x[p] + 8, pool.y[p] + 15, ['#fffaf0', '#56d39c'], 4, params.sparkleDensity);
      }
      ctx.coyote = 0;
    } else if (!grappleBlockJump && isWallSliding && ctx.input.hasBuffered('jump')) {
      ctx.input.consumeBuffer('jump');
      const kickSign = (pool.flags[p] & EF_FACING_LEFT) !== 0 ? 1 : -1;
      pool.vx[p] = kickSign * Math.max(150, params.moveSpeed * 1.15);
      pool.vy[p] = -params.jumpPower * 0.96;
      if (kickSign < 0) pool.flags[p] |= EF_FACING_LEFT;
      else pool.flags[p] &= ~EF_FACING_LEFT;
      ctx.heroSquash.scaleX = 0.76;
      ctx.heroSquash.scaleY = 1.26;
      ctx.eventsOut.push('jump');
      ctx.juice.spawnBurst(pool.x[p] + 8, pool.y[p] + 10, ['#fffaf0', '#ffd447'], 5, params.sparkleDensity);
    } else if (!grappleBlockJump && ctx.input.hasBuffered('jump') && ctx.relics.doubleJump && ctx.airJumpsLeft > 0 && !ctx.aabbRes.onGround) {
      ctx.input.consumeBuffer('jump');
      ctx.airJumpsLeft--;
      pool.vy[p] = -params.jumpPower * 0.94;
      ctx.dashTimer = 0;
      ctx.heroSquash.scaleX = 0.74;
      ctx.heroSquash.scaleY = 1.28;
      ctx.eventsOut.push('jump');
      ctx.juice.spawnBurst(pool.x[p] + 8, pool.y[p] + 15, ['#5ec2f7', '#fffaf0'], 7, params.sparkleDensity);
    }

    if (ctx.dashTimer <= 0 && !ctx.input.held('jump') && !ctx.input.held('up') && pool.vy[p] < -60) {
      pool.vy[p] *= 0.86;
    }
    if (ctx.dashTimer <= 0) {
      const apex = !ctx.aabbRes.onGround && Math.abs(pool.vy[p]) < 38 ? 0.56 : 1.0;
      const maxFall = isWallSliding ? 62 : 340;
      pool.vy[p] = Math.min(maxFall, pool.vy[p] + 590 * params.gravityScale * apex * dt);
    }
  }

  const facingLeft = (pool.flags[p] & EF_FACING_LEFT) !== 0;
  const sign = facingLeft ? -1 : 1;
  if (facingLeft) pool.flags[p] |= EF_FLIP_X;
  else pool.flags[p] &= ~EF_FLIP_X;

  if (!grappleBlockActions && (ctx.input.justPressed('action') || (!ctx.grappleEnabled && ctx.input.justPressed('shoulderR')))) {
    const waveDashEnabled = Boolean(ctx.def.player.parkourMechanics?.waveDash);
    if (ctx.relics.airDash && (!ctx.aabbRes.onGround || waveDashEnabled) && ctx.dashCooldown <= 0) {
      const aimY = ctx.input.axisY();
      ctx.dashTimer = 0.14;
      ctx.dashCooldown = 0.55;
      pool.vx[p] = sign * 235;
      pool.vy[p] = aimY < -0.35 ? -135 : aimY > 0.35 && !ctx.aabbRes.onGround ? 120 : 0;
      ctx.heroSquash.scaleX = 1.32;
      ctx.heroSquash.scaleY = 0.72;
      ctx.juice.addTrauma(0.1);
      ctx.eventsOut.push('snap');
    } else if (!ctx.grappleEnabled) {
      const sp = ctx.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 7, sign * 155, -22);
      if (sp >= 0) pool.timerA[sp] = 0.42;
      ctx.heroSquash.scaleX = 1.15;
      ctx.heroSquash.scaleY = 0.88;
      ctx.eventsOut.push('ignite');
    }
  }
  if (!grappleBlockActions && !ctx.grappleEnabled && ctx.input.justPressed('skillY') && ctx.pulseCooldown <= 0) {
    ctx.pulseCooldown = 0.36;
    const s1 = ctx.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 5, sign * 172, -46);
    const s2 = ctx.spawnArchetype('spark', pool.x[p] + 8 + sign * 7, pool.y[p] + 9, sign * 164, 8);
    if (s1 >= 0) pool.timerA[s1] = 0.48;
    if (s2 >= 0) pool.timerA[s2] = 0.48;
    ctx.eventsOut.push('ignite');
  }

  // 2. Tilemap O(1) resolution + moving platform ride
  const box = ctx.aabbBox;
  box.x = pool.x[p];
  box.y = pool.y[p];
  box.vx = pool.vx[p];
  box.vy = pool.vy[p];
  const wasOnGround = ctx.aabbRes.onGround;
  ctx.tilemap.resolveAabbMotion(box, HERO_HB.x, HERO_HB.y, HERO_HB.w, HERO_HB.h, dt, ctx.aabbRes);

  // Check moving platforms & step entities
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.activeIndices[i];
    if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
    if ((pool.behaviorMask[s] & BM_MOVING_PLATFORM) !== 0) {
      const prevMpX = pool.x[s];
      const prevMpY = pool.y[s];
      pool.x[s] += pool.vx[s] * dt;
      pool.y[s] += pool.vy[s] * dt;
      if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
      else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
      if (pool.y[s] < pool.paramC[s]) { pool.y[s] = pool.paramC[s]; pool.vy[s] = Math.abs(pool.vy[s]); }
      else if (pool.y[s] > pool.paramD[s]) { pool.y[s] = pool.paramD[s]; pool.vy[s] = -Math.abs(pool.vy[s]); }

      const hbR = box.x + HERO_HB.x + HERO_HB.w;
      const hbL = box.x + HERO_HB.x;
      const hbBot = box.y + HERO_HB.y + HERO_HB.h;
      if (
        hbR > pool.x[s] &&
        hbL < pool.x[s] + pool.w[s] &&
        box.vy >= 0 &&
        hbBot >= Math.min(prevMpY, pool.y[s]) - 2 &&
        hbBot <= prevMpY + 8
      ) {
        box.x += pool.x[s] - prevMpX;
        box.y = pool.y[s] - HERO_HB.y - HERO_HB.h;
        box.vy = 0;
        ctx.aabbRes.onGround = true;
      }
    } else if ((pool.behaviorMask[s] & BM_PATROL) !== 0) {
      pool.x[s] += pool.vx[s] * dt;
      if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
      else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
      if (pool.vx[s] < 0) pool.flags[s] |= EF_FLIP_X;
      else pool.flags[s] &= ~EF_FLIP_X;
    } else if ((pool.behaviorMask[s] & BM_SIN_FLOAT) !== 0) {
      const archIdx = pool.archetypeIdx[s];
      const beh = archIdx >= 0 ? ctx.archetypes[archIdx].def.behavior : undefined;
      const amp = beh?.amplitude ?? 12;
      const freq = beh?.freq ?? 2.6;
      const speedX = beh?.speedX ?? 0;
      if (speedX !== 0) {
        pool.x[s] += speedX * dt;
        if (pool.x[s] < 0) pool.x[s] = 0;
        else if (pool.x[s] > ctx.stageWorldW - pool.w[s]) pool.x[s] = ctx.stageWorldW - pool.w[s];
      }
      pool.timerA[s] += dt * freq;
      pool.y[s] = pool.paramB[s] + Math.sin(pool.timerA[s] + pool.paramA[s]) * amp;
    } else if ((pool.behaviorMask[s] & BM_CHASE) !== 0) {
      const archIdx = pool.archetypeIdx[s];
      const beh = archIdx >= 0 ? ctx.archetypes[archIdx].def.behavior : undefined;
      const sightRange = beh?.sightRange ?? 160;
      const chaseSpeed = beh?.chaseSpeed ?? Math.max(24, Math.abs(beh?.speedX ?? 44));
      const ecx = pool.x[s] + pool.w[s] * 0.5;
      const ecy = pool.y[s] + pool.h[s] * 0.5;
      const pcx = pool.x[p] + pool.w[p] * 0.5;
      const pcy = pool.y[p] + pool.h[p] * 0.5;
      const dx = pcx - ecx;
      const dy = pcy - ecy;
      const seesPlayer =
        dx * dx + dy * dy <= sightRange * sightRange &&
        hasGridLineOfSight(
          Math.floor(ecx / TILE_SIZE),
          Math.floor(ecy / TILE_SIZE),
          Math.floor(pcx / TILE_SIZE),
          Math.floor(pcy / TILE_SIZE),
          ctx.isTileOpaque,
        );
      pool.aiState[s] = seesPlayer ? 1 : 0;
      if (seesPlayer) {
        const dirX = dx > 2 ? 1 : dx < -2 ? -1 : 0;
        pool.vx[s] = dirX * chaseSpeed;
        if ((pool.flags[s] & EF_GRAVITY) === 0) {
          const dirY = dy > 2 ? 1 : dy < -2 ? -1 : 0;
          pool.vy[s] = dirY * (chaseSpeed * 0.65);
        }
      } else if (pool.paramB[s] > pool.paramA[s]) {
        if (Math.abs(pool.vx[s]) < 1) pool.vx[s] = beh?.speedX ?? 24;
        if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
        else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
      } else {
        pool.vx[s] = 0;
        if ((pool.flags[s] & EF_GRAVITY) === 0) pool.vy[s] = 0;
      }
      const nextEx = pool.x[s] + pool.vx[s] * dt;
      const probeCol = Math.floor((nextEx + (pool.vx[s] >= 0 ? pool.w[s] - 1 : 1)) / TILE_SIZE);
      const probeRow = Math.floor((pool.y[s] + pool.h[s] * 0.5) / TILE_SIZE);
      if (ctx.tilemap.getCollision(probeCol, probeRow) !== COLLISION_SOLID) {
        pool.x[s] = clamp(nextEx, 0, Math.max(0, ctx.stageWorldW - pool.w[s]));
      }
      if ((pool.flags[s] & EF_GRAVITY) === 0) {
        const nextEy = pool.y[s] + pool.vy[s] * dt;
        const vProbeRow = Math.floor((nextEy + (pool.vy[s] >= 0 ? pool.h[s] - 1 : 1)) / TILE_SIZE);
        const vProbeCol = Math.floor((pool.x[s] + pool.w[s] * 0.5) / TILE_SIZE);
        if (ctx.tilemap.getCollision(vProbeCol, vProbeRow) !== COLLISION_SOLID) {
          pool.y[s] = clamp(nextEy, 0, Math.max(0, ctx.stageWorldH - pool.h[s]));
        }
      }
      if (pool.vx[s] < -1) pool.flags[s] |= EF_FLIP_X;
      else if (pool.vx[s] > 1) pool.flags[s] &= ~EF_FLIP_X;
    } else if ((pool.flags[s] & EF_BULLET) !== 0) {
      pool.x[s] += pool.vx[s] * dt;
      pool.y[s] += pool.vy[s] * dt;
      pool.vy[s] += 260 * dt;
      pool.timerA[s] -= dt;
      if (pool.timerA[s] <= 0) pool.free(s);
    } else if ((pool.flags[s] & EF_CRYSTAL_RESET) !== 0 && pool.timerA[s] > 0) {
      pool.timerA[s] = Math.max(0, pool.timerA[s] - dt);
    } else if ((pool.flags[s] & EF_CRUMBLE_TILE) !== 0) {
      const hbR = box.x + HERO_HB.x + HERO_HB.w;
      const hbL = box.x + HERO_HB.x;
      const hbBot = box.y + HERO_HB.y + HERO_HB.h;
      if (pool.aiState[s] === 2) {
        pool.timerA[s] -= dt;
        if (pool.timerA[s] <= 0) {
          pool.aiState[s] = 0;
          pool.timerA[s] = 0;
        }
      } else {
        if (
          hbR > pool.x[s] &&
          hbL < pool.x[s] + pool.w[s] &&
          box.vy >= 0 &&
          hbBot >= pool.y[s] - 2 &&
          hbBot <= pool.y[s] + 8
        ) {
          box.y = pool.y[s] - HERO_HB.y - HERO_HB.h;
          box.vy = 0;
          ctx.aabbRes.onGround = true;
          if (pool.aiState[s] === 0) {
            pool.aiState[s] = 1;
            pool.timerA[s] = 0.46;
            ctx.eventsOut.push('snap');
          }
        }
        if (pool.aiState[s] === 1) {
          pool.timerA[s] -= dt;
          if (pool.timerA[s] <= 0) {
            pool.aiState[s] = 2;
            pool.timerA[s] = ctx.def.player.parkourMechanics?.crumbleRespawnSec ?? 2.4;
            ctx.juice.spawnBurst(pool.x[s] + pool.w[s] * 0.5, pool.y[s] + 6, ['#e8c594', '#fffaf0'], 5, params.sparkleDensity);
          }
        }
      }
    } else if ((pool.flags[s] & EF_ZIP_BLOCK) !== 0) {
      const prevZx = pool.x[s];
      const homeX = pool.paramA[s];
      const endX = pool.paramB[s] > homeX ? pool.paramB[s] : homeX + 64;
      const hbR = box.x + HERO_HB.x + HERO_HB.w;
      const hbL = box.x + HERO_HB.x;
      const hbBot = box.y + HERO_HB.y + HERO_HB.h;
      const playerStanding =
        hbR > pool.x[s] &&
        hbL < pool.x[s] + pool.w[s] &&
        box.vy >= 0 &&
        hbBot >= pool.y[s] - 2 &&
        hbBot <= pool.y[s] + 8;
      const grappleAttached = ctx.grappleState !== 'idle' && ctx.grappleTargetSlot === s;
      if (pool.aiState[s] === 0 && (playerStanding || grappleAttached)) {
        pool.aiState[s] = 1;
        ctx.eventsOut.push('rail');
      }
      if (pool.aiState[s] === 1) {
        pool.x[s] = Math.min(endX, pool.x[s] + 210 * dt);
        if (pool.x[s] >= endX - 0.5) {
          pool.aiState[s] = 2;
          pool.timerA[s] = 0.45;
        }
      } else if (pool.aiState[s] === 2) {
        pool.timerA[s] -= dt;
        if (pool.timerA[s] <= 0) pool.aiState[s] = 3;
      } else if (pool.aiState[s] === 3) {
        pool.x[s] = Math.max(homeX, pool.x[s] - 72 * dt);
        if (pool.x[s] <= homeX + 0.5) {
          pool.x[s] = homeX;
          pool.aiState[s] = 0;
        }
      }
      if (playerStanding) {
        box.x += pool.x[s] - prevZx;
        box.y = pool.y[s] - HERO_HB.y - HERO_HB.h;
        box.vy = 0;
        ctx.aabbRes.onGround = true;
      }
    }
  }

  pool.x[p] = box.x;
  pool.y[p] = box.y;
  pool.vx[p] = box.vx;
  pool.vy[p] = box.vy;
  if (ctx.grappleEnabled && ctx.grappleState === 'swinging') {
    const rdx = pool.x[p] + 8 - ctx.grappleAnchorX;
    const rdy = pool.y[p] + 8 - ctx.grappleAnchorY;
    const rDist = Math.hypot(rdx, rdy);
    if (rDist > ctx.grappleRopeLength && rDist > 1e-4) {
      const ux = rdx / rDist;
      const uy = rdy / rDist;
      pool.x[p] = ctx.grappleAnchorX + ux * ctx.grappleRopeLength - 8;
      pool.y[p] = ctx.grappleAnchorY + uy * ctx.grappleRopeLength - 8;
      const vDotU = pool.vx[p] * ux + pool.vy[p] * uy;
      if (vDotU > 0) {
        pool.vx[p] -= vDotU * ux;
        pool.vy[p] -= vDotU * uy;
      }
    }
  }
  pool.sx[p] = ctx.heroSquash.scaleX;
  pool.sy[p] = ctx.heroSquash.scaleY;
  pool.skewX[p] = Math.abs(pool.vx[p]) > 10 ? clamp(pool.vx[p] / 460, -0.24, 0.24) : 0;

  if (!wasOnGround && ctx.aabbRes.onGround && ctx.aabbRes.landVy > 95) {
    const amt = Math.min(0.28, (ctx.aabbRes.landVy / 320) * 0.28);
    ctx.heroSquash.scaleX = 1 + amt;
    ctx.heroSquash.scaleY = 1 - amt * 0.9;
  }

  // 3. Abyss rescue
  if (pool.y[p] > worldH + 18) {
    ctx.hearts--;
    ctx.eventsOut.push('hurt');
    ctx.juice.applyPreset('player_hurt');
    if (ctx.hearts <= 0) {
      ctx.status = 'lost';
      return;
    }
    ctx.grappleState = 'idle';
    ctx.grappleHoldViaInput = false;
    ctx.grappleTargetSlot = -1;
    pool.teleport(p, ctx.checkpointX, ctx.checkpointY);
    pool.vx[p] = 0;
    pool.vy[p] = 0;
    ctx.invulnTimer = 1.25;
  }

  // 4. SpatialHash broad-phase O(1) Entity Interactions & VM collision recording
  pool.rebuildSpatialHash();
  const hcx = pool.x[p] + 8;
  const hcy = pool.y[p] + 8;
  const candCount = pool.queryRect(hcx - 76, hcy - 76, hcx + 76, hcy + 76, ctx.querySlots);
  for (let i = 1; i < candCount; i++) {
    const key = ctx.querySlots[i];
    const keyPos = pool.getActivePos(key);
    let j = i - 1;
    while (j >= 0 && pool.getActivePos(ctx.querySlots[j]) < keyPos) {
      ctx.querySlots[j + 1] = ctx.querySlots[j];
      j--;
    }
    ctx.querySlots[j + 1] = key;
  }

  for (let i = 0; i < candCount; i++) {
    const s = ctx.querySlots[i];
    if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
    const archIdx = pool.archetypeIdx[s];
    const meta = archIdx >= 0 ? ctx.archetypeMetaByIdx[archIdx] : undefined;
    const aid = meta?.id ?? '';
    const f = pool.flags[s];
    const ecx = pool.x[s] + pool.w[s] * 0.5;
    const ecy = pool.y[s] + pool.h[s] * 0.5;
    const dist = Math.hypot(hcx - ecx, hcy - ecy);

    if ((f & EF_COLLECTIBLE) !== 0 && dist < 14) {
      pool.free(s);
      ctx.juice.registerCombo();
      if (aid === 'star') {
        ctx.stageStarsCollected++;
        if (ctx.stageStarsCollected > ctx.bestStarsByStage[ctx.stageIdx]) {
          ctx.bestStarsByStage[ctx.stageIdx] = ctx.stageStarsCollected;
        }
        ctx.score += 100;
        ctx.eventsOut.push('star');
      } else if (aid === 'key') {
        ctx.hasKey = true;
        ctx.gateUnlocked = true;
        ctx.score += 150;
        ctx.eventsOut.push('key');
      } else {
        const arch = archIdx >= 0 ? ctx.archetypes[archIdx].def : undefined;
        if (arch?.relicGrant === 'doubleJump') {
          ctx.relics.doubleJump = true;
          ctx.airJumpsLeft = 1;
        } else if (arch?.relicGrant === 'airDash') {
          ctx.relics.airDash = true;
        }
        ctx.score += meta?.scoreValue ?? 50;
        ctx.eventsOut.push('star');
      }
      ctx.juice.spawnBurst(ecx, ecy, ['#ffd447', '#fffaf0', '#ff708d'], 8, params.sparkleDensity);
    } else if (aid === 'checkpoint_flag' && dist < 18 && pool.aiState[s] === 0) {
      pool.aiState[s] = 1;
      ctx.checkpointX = pool.x[s];
      ctx.checkpointY = pool.y[s] - 4;
      ctx.eventsOut.push('key');
    } else if ((f & EF_BOUNCY) !== 0 && dist < 15 && pool.vy[p] >= -20) {
      pool.vy[p] = -(ctx.archetypes[archIdx]?.def.bounceVy ?? 315);
      ctx.heroSquash.scaleX = 0.72;
      ctx.heroSquash.scaleY = 1.32;
      ctx.eventsOut.push('bounce');
    } else if ((f & EF_STOMPABLE) !== 0 && dist < (pool.w[s] * 0.5 + 8)) {
      if (pool.vy[p] > 35 && pool.y[p] + 12 < pool.y[s] + pool.h[s] * 0.65) {
        pool.vy[p] = -215;
        pool.hp[s] -= 1;
        pool.flash[s] = 0.22;
        ctx.juice.triggerHitstop(0.035);
        ctx.juice.addTrauma(0.24);
        ctx.eventsOut.push('stomp');
        if (pool.hp[s] <= 0) {
          const wasBoss = (f & EF_BOSS) !== 0;
          pool.free(s);
          ctx.score += meta?.scoreValue ?? 120;
          if (wasBoss) {
            ctx.bossSlot = -1;
            ctx.gateUnlocked = true;
            ctx.eventsOut.push('explode');
          }
        }
      } else if (ctx.invulnTimer <= 0) {
        ctx.hearts--;
        ctx.invulnTimer = 1.25;
        pool.flash[p] = 0.35;
        ctx.eventsOut.push('hurt');
        ctx.juice.applyPreset('player_hurt');
        if (ctx.hearts <= 0) ctx.status = 'lost';
      }
    } else if ((f & EF_CRYSTAL_RESET) !== 0 && pool.timerA[s] <= 0 && dist < 16) {
      pool.timerA[s] = ctx.def.player.parkourMechanics?.crystalRespawnSec ?? 2.2;
      pool.flash[s] = 0.25;
      ctx.dashCooldown = 0;
      ctx.airJumpsLeft = 1;
      ctx.juice.registerCombo();
      ctx.eventsOut.push('star');
      ctx.juice.spawnBurst(ecx, ecy, ['#5ec2f7', '#fffaf0'], 6, params.sparkleDensity);
    } else if (aid === 'gate' && ctx.gateUnlocked && dist < 16) {
      if (ctx.stageIdx + 1 < ctx.def.stages.length) {
        ctx.hearts = Math.min(ctx.maxHearts, ctx.hearts + 1);
        ctx.enterStage(ctx.stageIdx + 1);
        ctx.juice.triggerFlash('#fffaf0', 0.25);
        ctx.eventsOut.push('key');
        return;
      } else {
        ctx.status = 'won';
        ctx.eventsOut.push('win');
      }
    }

    if (ctx.vmCollisionCount < MAX_VM_COLLISION_PAIRS && dist < 16) {
      const cp = ctx.vmCollisions[ctx.vmCollisionCount++];
      cp.selfSlot = p;
      cp.otherSlot = s;
      cp.selfTag = 'player';
      cp.otherTag = aid;
    }
  }

  // 5. Camera track & Procedural Visual Rig (Verlet scarf, 2-Bone IK, afterimages, Curl-Noise particles)
  ctx.trackCameraTarget(pool.x[p], pool.y[p], dt);
  const rigTargetX =
    ctx.grappleState !== 'idle'
      ? (ctx.grappleState === 'shooting' ? ctx.grappleTipX : ctx.grappleAnchorX)
      : ctx.grapplePreviewKind !== 'none'
        ? ctx.grapplePreviewX
        : pool.x[p] + pool.w[p] * 0.5 + sign * 24;
  const rigTargetY =
    ctx.grappleState !== 'idle'
      ? (ctx.grappleState === 'shooting' ? ctx.grappleTipY : ctx.grappleAnchorY)
      : ctx.grapplePreviewKind !== 'none'
        ? ctx.grapplePreviewY
        : pool.y[p] + pool.h[p] * 0.42;
  ctx.visualRig.step(
    dt,
    pool.x[p],
    pool.y[p],
    pool.w[p],
    pool.h[p],
    pool.vx[p],
    pool.vy[p],
    sign,
    ctx.lastHeroSprite,
    ctx.dashCooldown <= 0,
    ctx.dashTimer > 0,
    ctx.grappleState !== 'idle',
    rigTargetX,
    rigTargetY,
    ctx.cameraX,
    ctx.cameraY,
    ctx.stageViewport.width,
    ctx.stageViewport.height,
  );
}

export function stepDataDualPerspectiveStage(ctx: DataPlatformerContext, dt: number, params: RuntimeParams): void {
  const p = ctx.playerSlot;
  const pool = ctx.pool;
  if (p < 0) return;

  if (ctx.invulnTimer > 0) ctx.invulnTimer = Math.max(0, ctx.invulnTimer - dt);
  ctx.dualPerspective.step(
    dt,
    ctx.input,
    pool,
    p,
    ctx.tilemap,
    ctx.stageWorldW,
    ctx.stageWorldH,
    ctx.dualPerspectiveStepOut,
  );
  if (ctx.dualPerspectiveStepOut.toggled) ctx.eventsOut.push('snap');
  if (ctx.dualPerspectiveStepOut.slashed) ctx.eventsOut.push('ignite');
  if (ctx.dualPerspectiveStepOut.hits > 0) {
    ctx.score += ctx.dualPerspectiveStepOut.hits * 120;
    ctx.juice.addTrauma(0.18);
    ctx.juice.registerCombo();
    ctx.eventsOut.push('stomp');
  }

  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.activeIndices[i];
    if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
    if ((pool.behaviorMask[s] & BM_PATROL) !== 0) {
      pool.x[s] += pool.vx[s] * dt;
      if (pool.x[s] < pool.paramA[s]) { pool.x[s] = pool.paramA[s]; pool.vx[s] = Math.abs(pool.vx[s]); }
      else if (pool.x[s] > pool.paramB[s]) { pool.x[s] = pool.paramB[s]; pool.vx[s] = -Math.abs(pool.vx[s]); }
      if (pool.vx[s] < 0) pool.flags[s] |= EF_FLIP_X;
      else pool.flags[s] &= ~EF_FLIP_X;
    } else if ((pool.behaviorMask[s] & BM_SIN_FLOAT) !== 0) {
      pool.timerA[s] += dt * 2.5;
      pool.y[s] = pool.paramB[s] + Math.sin(pool.timerA[s] + pool.paramA[s]) * 6;
    }
  }

  const hcx = pool.x[p] + pool.w[p] * 0.5;
  const hcy = pool.y[p] + pool.h[p] * 0.5;
  for (let i = pool.activeCount - 1; i >= 0; i--) {
    const s = pool.activeIndices[i];
    if (s === p || (pool.flags[s] & EF_ALIVE) === 0) continue;
    const archIdx = pool.archetypeIdx[s];
    const aid = archIdx >= 0 ? (ctx.archetypeMetaByIdx[archIdx]?.id ?? '') : '';
    const f = pool.flags[s];
    const ecx = pool.x[s] + pool.w[s] * 0.5;
    const ecy = pool.y[s] + pool.h[s] * 0.5;
    const dist = Math.hypot(hcx - ecx, hcy - ecy);
    if ((f & EF_COLLECTIBLE) !== 0 && dist < 15) {
      pool.free(s);
      ctx.juice.registerCombo();
      if (aid === 'star') {
        ctx.stageStarsCollected++;
        if (ctx.stageStarsCollected > ctx.bestStarsByStage[ctx.stageIdx]) {
          ctx.bestStarsByStage[ctx.stageIdx] = ctx.stageStarsCollected;
        }
        ctx.score += 100;
        ctx.eventsOut.push('star');
      } else if (aid === 'key') {
        ctx.hasKey = true;
        ctx.gateUnlocked = true;
        ctx.score += 150;
        ctx.eventsOut.push('key');
      } else {
        ctx.score += 50;
        ctx.eventsOut.push('star');
      }
      ctx.juice.spawnBurst(ecx, ecy, ['#ffd447', '#fffaf0'], 6, params.sparkleDensity);
    } else if (aid === 'gate' && ctx.gateUnlocked && dist < 16) {
      if (ctx.stageIdx + 1 < ctx.def.stages.length) {
        ctx.enterStage(ctx.stageIdx + 1);
        ctx.eventsOut.push('key');
        return;
      } else {
        ctx.status = 'won';
        ctx.eventsOut.push('win');
      }
    }
    if (ctx.vmCollisionCount < MAX_VM_COLLISION_PAIRS && dist < 16) {
      const cp = ctx.vmCollisions[ctx.vmCollisionCount++];
      cp.selfSlot = p;
      cp.otherSlot = s;
      cp.selfTag = 'player';
      cp.otherTag = aid;
    }
  }

  ctx.trackCameraTarget(pool.x[p], pool.y[p], dt);
  const facingSign = (pool.flags[p] & EF_FLIP_X) !== 0 ? -1 : 1;
  ctx.visualRig.step(
    dt,
    pool.x[p],
    pool.y[p],
    pool.w[p],
    pool.h[p],
    pool.vx[p],
    pool.vy[p],
    facingSign,
    ctx.lastHeroSprite,
    true,
    false,
    false,
    pool.x[p] + pool.w[p] * 0.5 + Math.cos(ctx.dualPerspective.viewerYawRad) * 20,
    pool.y[p] + pool.h[p] * 0.5 + Math.sin(ctx.dualPerspective.viewerYawRad) * 20,
    ctx.cameraX,
    ctx.cameraY,
    ctx.stageViewport.width,
    ctx.stageViewport.height,
  );
}
