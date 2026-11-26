import { SpatialHash } from '../math/SpatialHash.ts';
import { COLLISION_SOLID, TILE_SIZE, type TilemapGrid } from '../sim/TilemapGrid.ts';
import type { InputState, SimEvent } from '../types/WorldTypes.ts';
import { MAX_TRIGGER_OVERLAPS, MAX_VERLET_NODES } from './ComponentStore.ts';
import type { EcsCoreWorld } from './EcsCoreWorld.ts';
import type { RoomVoxelVolume } from './EcsVoxelVolume.ts';
import { INVALID_ENTITY, unpackEntityIndex, type EntityHandle } from './EntityManager.ts';
import type { SandboxScriptVm } from './SandboxScriptVm.ts';

export interface ActionPhysicsPrevButtons {
  action: boolean;
  jump: boolean;
  menu: boolean;
  skill: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

const MAX_QUERY_HITS = 256;

function containsHandle(buf: Uint32Array, count: number, handle: EntityHandle): boolean {
  for (let i = 0; i < count; i++) {
    if (buf[i] === handle) return true;
  }
  return false;
}

/**
 * Zero-GC bitmask check verifying both entities belong to the active realm AND share at least one dimension bit.
 * Entities without Spatial3D default to dimensionMask = 3 (present across realms).
 */
export function ecsDimensionsOverlap(
  core: EcsCoreWorld,
  a: EntityHandle,
  b: EntityHandle,
  activeDimensionMask = 3,
): boolean {
  const c = core.components;
  const spA = core.getComponent(a, c.Spatial3D);
  const spB = core.getComponent(b, c.Spatial3D);
  const maskA = spA ? spA.dimensionMask : 3;
  const maskB = spB ? spB.dimensionMask : 3;
  return (
    (maskA & activeDimensionMask) !== 0 &&
    (maskB & activeDimensionMask) !== 0 &&
    (maskA & maskB) !== 0
  );
}

/**
 * Zero-GC 3D vertical interval overlap test ([z, z + height]).
 * Returns true automatically when neither entity has a Spatial3D component (classic 2D parity).
 */
export function ecsVerticalIntervalsOverlap(core: EcsCoreWorld, a: EntityHandle, b: EntityHandle): boolean {
  const c = core.components;
  const spA = core.getComponent(a, c.Spatial3D);
  const spB = core.getComponent(b, c.Spatial3D);
  if (!spA && !spB) return true;
  const aZ = spA ? spA.z : 0;
  const aTop = aZ + (spA ? spA.height : 16);
  const bZ = spB ? spB.z : 0;
  const bTop = bZ + (spB ? spB.height : 16);
  return aZ < bTop - 0.5 && bZ < aTop - 0.5;
}

/**
 * Combined Zero-GC multi-dimensional interaction check (dimension bitmask + Z-axis interval).
 */
export function ecsEntitiesInteractInSpace(
  core: EcsCoreWorld,
  a: EntityHandle,
  b: EntityHandle,
  activeDimensionMask = 3,
): boolean {
  return ecsDimensionsOverlap(core, a, b, activeDimensionMask) && ecsVerticalIntervalsOverlap(core, a, b);
}

/**
 * Modular, Zero-GC Action & Multi-Dimensional Physics Systems for `EcsCoreWorld`:
 * 1. `character_motor_2d` (physics phase) — coyote time, jump buffer, air control, dash, TilemapGrid/SpatialHash solid collisions
 * 2. `spatial_3d_elevation` (physics phase) — Z-axis gravity, jump, overpass landing, underpass clearance & dimension masking
 * 3. `grapple_pendulum` (physics phase) — anchor latch, reel in/out, radial pendulum constraint & momentum conservation
 * 4. `trigger_zone_sensor` (physics phase) — SpatialHash broad-phase rect/circle sensor emitting enter/stay/exit VM events
 * 5. `verlet_chain_solver` (fixed phase) — Zero-GC Float32Array Verlet rope/cape/lantern constraint relaxation
 *
 * 100% DOM-free and zero per-frame heap allocations.
 */
export class EcsActionPhysicsSystems {
  private readonly entityHash: SpatialHash;
  private readonly solidHash: SpatialHash;
  private readonly slotToHandle: Uint32Array;
  private readonly solidSlotToHandle: Uint32Array;
  private readonly queryOutSlots = new Int32Array(MAX_QUERY_HITS);

  constructor(maxEntities = 2048) {
    this.entityHash = new SpatialHash(maxEntities, 32);
    this.solidHash = new SpatialHash(maxEntities, 32);
    this.slotToHandle = new Uint32Array(maxEntities);
    this.solidSlotToHandle = new Uint32Array(maxEntities);
  }

  public stepCharacterMotor2D(
    core: EcsCoreWorld,
    dt: number,
    input: InputState,
    prevButtons: ActionPhysicsPrevButtons,
    viewportW: number,
    viewportH: number,
    tilemap: TilemapGrid | null,
    eventsOut: SimEvent[],
    activeDimensionMask = 3,
  ): void {
    const c = core.components;
    const motorStore = core.getStore(c.CharacterMotor2D);
    const motorCount = motorStore.size();
    if (motorCount === 0) return;

    // Build broad-phase spatial hash for solid colliders (if any exist)
    const colStore = core.getStore(c.Collider);
    const colCount = colStore.size();
    let solidCount = 0;
    this.solidHash.clear();
    for (let i = 0; i < colCount; i++) {
      const col = colStore.getDenseDataAt(i);
      if (!col.isSolid) continue;
      const sh = colStore.getDenseEntityAt(i);
      const str = core.getComponent(sh, c.Transform2D);
      if (!str) continue;
      const slot = unpackEntityIndex(sh);
      if (slot < this.solidSlotToHandle.length) {
        this.solidSlotToHandle[slot] = sh;
        this.solidHash.insertBox(slot, str.x, str.y, str.w, str.h);
        solidCount++;
      }
    }

    const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const moveY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const justJump = input.jump && !prevButtons.jump;
    const justDash = input.skillX && !prevButtons.skill;

    for (let i = 0; i < motorCount; i++) {
      const h = motorStore.getDenseEntityAt(i);
      const motor = motorStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      const vel = core.getComponent(h, c.Velocity2D);
      if (!tr || !vel) continue;

      if (moveX !== 0) {
        motor.facing = moveX > 0 ? 1 : -1;
        const mat = core.getComponent(h, c.Material);
        if (mat) mat.flipX = motor.facing < 0;
      }

      if (motor.dashCooldownTimer > 0) {
        motor.dashCooldownTimer = Math.max(0, motor.dashCooldownTimer - dt);
      }

      // Coyote time tracks grace window after leaving ground
      if (motor.grounded) {
        motor.coyoteTimer = motor.coyoteTimeSec;
      } else if (motor.coyoteTimer > 0) {
        motor.coyoteTimer = Math.max(0, motor.coyoteTimer - dt);
      }

      // Jump buffer captures slightly early jump presses before touchdown
      if (justJump) {
        motor.jumpBufferTimer = motor.jumpBufferSec;
      } else if (motor.jumpBufferTimer > 0) {
        motor.jumpBufferTimer = Math.max(0, motor.jumpBufferTimer - dt);
      }

      // Directional dash with cooldown
      if (justDash && motor.dashCooldownTimer <= 0) {
        let dx = moveX !== 0 ? moveX : motor.facing;
        let dy = moveY;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        motor.dashDirX = dx;
        motor.dashDirY = dy;
        motor.dashTimer = motor.dashDurationSec;
        motor.dashCooldownTimer = motor.dashCooldownSec;
        vel.vx = dx * motor.dashSpeed;
        vel.vy = dy * motor.dashSpeed;
        this.releaseGrapple(core, h, motor);
        eventsOut.push('ignite');
      }

      // Standard or coyote jump
      if (motor.jumpBufferTimer > 0 && motor.coyoteTimer > 0 && motor.dashTimer <= 0) {
        vel.vy = -motor.jumpVelocity;
        motor.grounded = false;
        motor.coyoteTimer = 0;
        motor.jumpBufferTimer = 0;
        this.releaseGrapple(core, h, motor);
        eventsOut.push('jump');
      }

      const isGrappling = motor.grappleHandle !== INVALID_ENTITY && core.entities.isAlive(motor.grappleHandle);

      // Integrate velocity
      if (motor.dashTimer > 0) {
        motor.dashTimer = Math.max(0, motor.dashTimer - dt);
        vel.vx = motor.dashDirX * motor.dashSpeed;
        vel.vy = motor.dashDirY * motor.dashSpeed;
      } else {
        if (isGrappling) {
          // While swinging on grapple, only apply gentle directional pumping so passive swing preserves momentum
          if (moveX !== 0) {
            vel.vx += moveX * motor.accel * motor.airControl * 0.5 * dt;
          }
        } else {
          const targetVx = moveX * motor.moveSpeed;
          const maxDelta = (motor.grounded ? motor.accel : motor.accel * motor.airControl) * dt;
          const diff = targetVx - vel.vx;
          if (Math.abs(diff) <= maxDelta) {
            vel.vx = targetVx;
          } else {
            vel.vx += diff > 0 ? maxDelta : -maxDelta;
          }
        }
        vel.vy = Math.min(motor.maxFallSpeed, vel.vy + motor.gravity * dt);
      }

      // Axis-separated X pass
      tr.x += vel.vx * dt;
      motor.wallDir = 0;

      if (tr.x < 0) {
        tr.x = 0;
        vel.vx = 0;
        motor.wallDir = -1;
      } else if (tr.x + tr.w > viewportW) {
        tr.x = Math.max(0, viewportW - tr.w);
        vel.vx = 0;
        motor.wallDir = 1;
      }

      if (solidCount > 0) {
        const hits = this.solidHash.queryRect(tr.x, tr.y, tr.x + tr.w, tr.y + tr.h, this.queryOutSlots);
        for (let k = 0; k < hits; k++) {
          const sh = this.solidSlotToHandle[this.queryOutSlots[k]];
          if (sh === h) continue;
          if (!ecsEntitiesInteractInSpace(core, h, sh, activeDimensionMask)) continue;
          const str = core.getComponent(sh, c.Transform2D);
          if (!str) continue;
          if (tr.x < str.x + str.w && tr.x + tr.w > str.x && tr.y < str.y + str.h && tr.y + tr.h > str.y) {
            if (vel.vx > 0) {
              tr.x = str.x - tr.w;
              vel.vx = 0;
              motor.wallDir = 1;
            } else if (vel.vx < 0) {
              tr.x = str.x + str.w;
              vel.vx = 0;
              motor.wallDir = -1;
            }
          }
        }
      }

      if (tilemap) {
        this.resolveTilemapX(tr, vel, motor, tilemap);
      }

      // Axis-separated Y pass
      tr.y += vel.vy * dt;
      let landed = false;

      if (solidCount > 0) {
        const hits = this.solidHash.queryRect(tr.x, tr.y, tr.x + tr.w, tr.y + tr.h, this.queryOutSlots);
        for (let k = 0; k < hits; k++) {
          const sh = this.solidSlotToHandle[this.queryOutSlots[k]];
          if (sh === h) continue;
          if (!ecsEntitiesInteractInSpace(core, h, sh, activeDimensionMask)) continue;
          const str = core.getComponent(sh, c.Transform2D);
          if (!str) continue;
          if (tr.x < str.x + str.w && tr.x + tr.w > str.x && tr.y < str.y + str.h && tr.y + tr.h > str.y) {
            if (vel.vy >= 0) {
              tr.y = str.y - tr.h;
              vel.vy = 0;
              landed = true;
            } else {
              tr.y = str.y + str.h;
              vel.vy = 0;
            }
          }
        }
      }

      if (tilemap) {
        if (this.resolveTilemapY(tr, vel, tilemap)) {
          landed = true;
        }
      }

      const effFloorY = motor.floorY > 0 ? motor.floorY : viewportH;
      if (tr.y + tr.h >= effFloorY) {
        tr.y = effFloorY - tr.h;
        if (vel.vy > 0) vel.vy = 0;
        landed = true;
      } else if (tr.y < 0) {
        tr.y = 0;
        if (vel.vy < 0) vel.vy = 0;
      }

      motor.grounded = landed;

      // Immediate buffered jump on touchdown frame for crisp platformer feel
      if (landed && motor.jumpBufferTimer > 0 && motor.dashTimer <= 0) {
        vel.vy = -motor.jumpVelocity;
        motor.grounded = false;
        motor.coyoteTimer = 0;
        motor.jumpBufferTimer = 0;
        this.releaseGrapple(core, h, motor);
        eventsOut.push('jump');
      }
    }
  }

  private resolveTilemapX(
    tr: { x: number; y: number; w: number; h: number },
    vel: { vx: number; vy: number },
    motor: { wallDir: number },
    tilemap: TilemapGrid,
  ): void {
    const ts = TILE_SIZE;
    const tx0 = Math.floor(tr.x / ts);
    const tx1 = Math.floor((tr.x + tr.w - 0.01) / ts);
    const ty0 = Math.floor((tr.y + 1) / ts);
    const ty1 = Math.floor((tr.y + tr.h - 1) / ts);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tilemap.getCollision(tx, ty) !== COLLISION_SOLID) continue;
        if (vel.vx > 0) {
          tr.x = tx * ts - tr.w;
          vel.vx = 0;
          motor.wallDir = 1;
          return;
        } else if (vel.vx < 0) {
          tr.x = (tx + 1) * ts;
          vel.vx = 0;
          motor.wallDir = -1;
          return;
        }
      }
    }
  }

  private resolveTilemapY(
    tr: { x: number; y: number; w: number; h: number },
    vel: { vx: number; vy: number },
    tilemap: TilemapGrid,
  ): boolean {
    const ts = TILE_SIZE;
    const tx0 = Math.floor((tr.x + 1) / ts);
    const tx1 = Math.floor((tr.x + tr.w - 1) / ts);
    const ty0 = Math.floor(tr.y / ts);
    const ty1 = Math.floor((tr.y + tr.h - 0.01) / ts);
    let landed = false;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tilemap.getCollision(tx, ty) !== COLLISION_SOLID) continue;
        if (vel.vy >= 0) {
          tr.y = ty * ts - tr.h;
          vel.vy = 0;
          landed = true;
          return landed;
        } else {
          tr.y = (ty + 1) * ts;
          vel.vy = 0;
          return false;
        }
      }
    }
    return landed;
  }

  private releaseGrapple(
    core: EcsCoreWorld,
    motorHandle: EntityHandle,
    motor: { grappleHandle: EntityHandle; grappleLength: number },
  ): void {
    if (motor.grappleHandle === INVALID_ENTITY) return;
    if (core.entities.isAlive(motor.grappleHandle)) {
      const anchor = core.getComponent(motor.grappleHandle, core.components.GrappleAnchor);
      if (anchor && anchor.activeTargetHandle === motorHandle) {
        anchor.activeTargetHandle = INVALID_ENTITY;
        anchor.currentLength = 0;
      }
    }
    motor.grappleHandle = INVALID_ENTITY;
    motor.grappleLength = 0;
  }

  /**
   * Zero-GC Spatial3D Elevation System (physics phase):
   * Integrates Z-axis gravity, top-down/HD-2D Z-jumps, overpass landing onto elevated solids,
   * and underpass ceiling clearance while strictly respecting dimension bitmasks.
   */
  public stepSpatial3D(
    core: EcsCoreWorld,
    dt: number,
    input: InputState,
    prevButtons: ActionPhysicsPrevButtons,
    eventsOut: SimEvent[],
    activeDimensionMask = 3,
  ): void {
    const c = core.components;
    const spStore = core.getStore(c.Spatial3D);
    const spCount = spStore.size();
    if (spCount === 0) return;

    const colStore = core.getStore(c.Collider);
    const colCount = colStore.size();
    const justJump = input.jump && !prevButtons.jump;

    for (let i = 0; i < spCount; i++) {
      const h = spStore.getDenseEntityAt(i);
      const sp = spStore.getDenseDataAt(i);
      sp.prevZ = sp.z;

      if (sp.gravityZ <= 0 && Math.abs(sp.vz) < 1e-4) continue;
      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;

      let supportZ = sp.groundZ;
      let ceilingZ = Infinity;

      // Evaluate elevated solid platforms & overpass clearances in compatible dimensions
      for (let j = 0; j < colCount; j++) {
        const col = colStore.getDenseDataAt(j);
        if (!col.isSolid) continue;
        const sh = colStore.getDenseEntityAt(j);
        if (sh === h) continue;
        if (!ecsDimensionsOverlap(core, h, sh, activeDimensionMask)) continue;
        const str = core.getComponent(sh, c.Transform2D);
        if (!str) continue;
        if (tr.x >= str.x + str.w || tr.x + tr.w <= str.x || tr.y >= str.y + str.h || tr.y + tr.h <= str.y) {
          continue;
        }
        const sSp = core.getComponent(sh, c.Spatial3D);
        const sZ = sSp ? sSp.z : 0;
        const sTop = sZ + (sSp ? sSp.height : 16);

        if (sp.prevZ >= sTop - 4) {
          if (sTop > supportZ) supportZ = sTop;
        } else if (sp.prevZ + sp.height <= sZ + 2) {
          if (sZ < ceilingZ) ceilingZ = sZ;
        }
      }

      // Top-down / HD-2D Z-jump for hero actors without side-scroller CharacterMotor2D
      if (justJump && sp.jumpZVelocity > 0 && !core.hasComponent(h, c.CharacterMotor2D)) {
        const tag = core.getComponent(h, c.Tag)?.tag ?? '';
        if ((tag === 'hero' || tag === 'player') && sp.z <= supportZ + 0.5) {
          sp.vz = sp.jumpZVelocity;
          eventsOut.push('jump');
        }
      }

      sp.vz -= sp.gravityZ * dt;
      sp.z += sp.vz * dt;

      if (sp.vz > 0 && sp.z + sp.height > ceilingZ) {
        sp.z = Math.max(supportZ, ceilingZ - sp.height);
        sp.vz = 0;
      }

      if (sp.z <= supportZ) {
        sp.z = supportZ;
        if (sp.vz < 0) sp.vz = 0;
      }
    }
  }

  /**
   * Zero-GC Multi-Story Voxel Spatial3D Elevation System:
   * Samples support Z (stairs/ramps/decks) and ceiling Z (arches/overpasses) from `RoomVoxelVolume`,
   * applying Z-axis gravity, landing, and head-bonk clamping while respecting dimension bitmasks.
   */
  public stepSpatial3DWithVolume(
    core: EcsCoreWorld,
    dt: number,
    volume: RoomVoxelVolume,
    eventsOut: SimEvent[],
    activeDimensionMask = 3,
  ): void {
    const c = core.components;
    const spStore = core.getStore(c.Spatial3D);
    const spCount = spStore.size();
    if (spCount === 0) return;

    for (let i = 0; i < spCount; i++) {
      const h = spStore.getDenseEntityAt(i);
      const sp = spStore.getDenseDataAt(i);
      sp.prevZ = sp.z;
      if ((sp.dimensionMask & activeDimensionMask) === 0) continue;

      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;

      const cx = tr.x + tr.w * 0.5;
      const cy = tr.y + tr.h * 0.72;
      const volSupportZ = volume.sampleSupportZ(cx, cy, sp.z, sp.stepHeight);
      const supportZ = Math.max(sp.groundZ, volSupportZ);
      const ceilingZ = volume.sampleCeilingZ(cx, cy, sp.z, 9999);
      sp.ceilingZ = ceilingZ;

      if (sp.gravityZ <= 0 && Math.abs(sp.vz) < 1e-4) {
        sp.z = supportZ;
        continue;
      }

      if (sp.gravityZ > 0) {
        sp.vz -= sp.gravityZ * dt;
      }
      sp.z += sp.vz * dt;

      if (sp.vz > 0 && sp.z + sp.height > ceilingZ) {
        sp.z = Math.max(supportZ, ceilingZ - sp.height);
        sp.vz = 0;
      }

      if (sp.z <= supportZ) {
        if (sp.vz < -120) {
          eventsOut.push('snap');
        }
        sp.z = supportZ;
        if (sp.vz < 0) sp.vz = 0;
      }
    }
  }

  public stepGrapplePendulum(
    core: EcsCoreWorld,
    dt: number,
    input: InputState,
    prevButtons: ActionPhysicsPrevButtons,
    eventsOut: SimEvent[],
    activeDimensionMask = 3,
  ): void {
    const c = core.components;
    const motorStore = core.getStore(c.CharacterMotor2D);
    const anchorStore = core.getStore(c.GrappleAnchor);
    const motorCount = motorStore.size();
    const anchorCount = anchorStore.size();
    if (motorCount === 0 || anchorCount === 0) return;

    const grappleHeld = input.action || input.skillY;
    const grappleJustPressed = (input.action && !prevButtons.action) || (input.skillY && !prevButtons.menu);
    const grappleJustReleased = !grappleHeld && (prevButtons.action || prevButtons.menu);

    for (let i = 0; i < motorCount; i++) {
      const h = motorStore.getDenseEntityAt(i);
      const motor = motorStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      const vel = core.getComponent(h, c.Velocity2D);
      if (!tr || !vel) continue;

      // Clear stale or disabled grapple handle
      if (motor.grappleHandle !== INVALID_ENTITY) {
        const curAnchor = core.getComponent(motor.grappleHandle, c.GrappleAnchor);
        if (
          !curAnchor ||
          !curAnchor.enabled ||
          !ecsDimensionsOverlap(core, h, motor.grappleHandle, activeDimensionMask) ||
          grappleJustReleased
        ) {
          this.releaseGrapple(core, h, motor);
        }
      }

      const cx = tr.x + tr.w * 0.5;
      const cy = tr.y + tr.h * 0.5;

      // Latch onto nearest enabled GrappleAnchor within capture radius
      if (motor.grappleHandle === INVALID_ENTITY && grappleJustPressed) {
        let bestAnchor: EntityHandle = INVALID_ENTITY;
        let bestDist = Infinity;
        for (let a = 0; a < anchorCount; a++) {
          const ah = anchorStore.getDenseEntityAt(a);
          if (ah === h) continue;
          const anchor = anchorStore.getDenseDataAt(a);
          if (!anchor.enabled) continue;
          if (!ecsDimensionsOverlap(core, h, ah, activeDimensionMask)) continue;
          const atr = core.getComponent(ah, c.Transform2D);
          if (!atr) continue;
          const ax = atr.x + atr.w * 0.5;
          const ay = atr.y + atr.h * 0.5;
          const d = Math.hypot(cx - ax, cy - ay);
          if (d <= anchor.anchorRadius && d < bestDist) {
            bestDist = d;
            bestAnchor = ah;
          }
        }
        if (bestAnchor !== INVALID_ENTITY) {
          const anchor = core.getComponent(bestAnchor, c.GrappleAnchor)!;
          const ropeLen = Math.max(anchor.minLength, Math.min(anchor.anchorRadius, bestDist));
          motor.grappleHandle = bestAnchor;
          motor.grappleLength = ropeLen;
          motor.grappleTension = anchor.swingTension;
          anchor.activeTargetHandle = h;
          anchor.currentLength = ropeLen;
          eventsOut.push('snap');
        }
      }

      // Enforce radial pendulum constraint & reel speed
      if (motor.grappleHandle !== INVALID_ENTITY) {
        const anchor = core.getComponent(motor.grappleHandle, c.GrappleAnchor);
        const atr = core.getComponent(motor.grappleHandle, c.Transform2D);
        if (!anchor || !atr) {
          this.releaseGrapple(core, h, motor);
          continue;
        }

        if (input.up) {
          motor.grappleLength = Math.max(anchor.minLength, motor.grappleLength - anchor.reelSpeed * dt);
        } else if (input.down) {
          motor.grappleLength = Math.min(anchor.anchorRadius, motor.grappleLength + anchor.reelSpeed * dt);
        }
        anchor.activeTargetHandle = h;
        anchor.currentLength = motor.grappleLength;

        const ax = atr.x + atr.w * 0.5;
        const ay = atr.y + atr.h * 0.5;
        const dx = cx - ax;
        const dy = cy - ay;
        const dist = Math.hypot(dx, dy);

        if (dist > motor.grappleLength && dist > 1e-4) {
          const nx = dx / dist;
          const ny = dy / dist;
          const clampedX = ax + nx * motor.grappleLength;
          const clampedY = ay + ny * motor.grappleLength;
          tr.x = clampedX - tr.w * 0.5;
          tr.y = clampedY - tr.h * 0.5;

          const vRad = vel.vx * nx + vel.vy * ny;
          if (vRad > 0) {
            vel.vx -= vRad * nx;
            vel.vy -= vRad * ny;
          }

          if (anchor.swingTension < 1) {
            const damp = Math.max(0.5, 1 - (1 - anchor.swingTension) * dt * 2);
            vel.vx *= damp;
            vel.vy *= damp;
          }
          motor.grounded = false;
        }
      }
    }
  }

  public stepTriggerZones(
    core: EcsCoreWorld,
    dt: number,
    vm: SandboxScriptVm,
    activeDimensionMask = 3,
  ): void {
    const c = core.components;
    const zoneStore = core.getStore(c.TriggerZone);
    const zoneCount = zoneStore.size();
    if (zoneCount === 0) return;

    // Rebuild broad-phase SpatialHash with all alive entities possessing Transform2D
    this.entityHash.clear();
    const trStore = core.getStore(c.Transform2D);
    const trCount = trStore.size();
    for (let i = 0; i < trCount; i++) {
      const h = trStore.getDenseEntityAt(i);
      const tr = trStore.getDenseDataAt(i);
      const slot = unpackEntityIndex(h);
      if (slot < this.slotToHandle.length) {
        this.slotToHandle[slot] = h;
        this.entityHash.insertBox(slot, tr.x, tr.y, tr.w, tr.h);
      }
    }

    for (let z = 0; z < zoneCount; z++) {
      const zh = zoneStore.getDenseEntityAt(z);
      const zone = zoneStore.getDenseDataAt(z);
      const ztr = core.getComponent(zh, c.Transform2D);
      if (!ztr) continue;

      if (zone.cooldownTimer > 0) {
        zone.cooldownTimer = Math.max(0, zone.cooldownTimer - dt);
      }

      // Snapshot previous overlap set in-place (Zero-GC)
      const prevCount = zone.overlapCount;
      zone.prevOverlapCount = prevCount;
      for (let i = 0; i < prevCount; i++) {
        zone.prevOverlapHandles[i] = zone.overlapHandles[i];
      }
      zone.overlapCount = 0;

      const zcx = ztr.x + ztr.w * 0.5;
      const zcy = ztr.y + ztr.h * 0.5;
      let qx0: number;
      let qy0: number;
      let qx1: number;
      let qy1: number;

      if (zone.shape === 'circle') {
        const r = Math.max(1, zone.radius);
        qx0 = zcx - r;
        qy0 = zcy - r;
        qx1 = zcx + r;
        qy1 = zcy + r;
      } else {
        const rw = zone.width > 0 ? zone.width : ztr.w;
        const rh = zone.height > 0 ? zone.height : ztr.h;
        qx0 = zcx - rw * 0.5;
        qy0 = zcy - rh * 0.5;
        qx1 = zcx + rw * 0.5;
        qy1 = zcy + rh * 0.5;
      }

      const hits = this.entityHash.queryRect(qx0, qy0, qx1, qy1, this.queryOutSlots);
      const rSq = zone.radius * zone.radius;

      for (let k = 0; k < hits; k++) {
        if (zone.overlapCount >= MAX_TRIGGER_OVERLAPS) break;
        const other = this.slotToHandle[this.queryOutSlots[k]];
        if (other === zh || !core.entities.isAlive(other)) continue;
        if (!ecsEntitiesInteractInSpace(core, zh, other, activeDimensionMask)) continue;

        if (zone.filterTag) {
          const otherTag = core.getComponent(other, c.Tag)?.tag ?? '';
          if (otherTag !== zone.filterTag) continue;
        }

        if (zone.shape === 'circle') {
          const otr = core.getComponent(other, c.Transform2D);
          if (!otr) continue;
          const nearestX = Math.max(otr.x, Math.min(zcx, otr.x + otr.w));
          const nearestY = Math.max(otr.y, Math.min(zcy, otr.y + otr.h));
          const dx = nearestX - zcx;
          const dy = nearestY - zcy;
          if (dx * dx + dy * dy > rSq) continue;
        }

        zone.overlapHandles[zone.overlapCount++] = other;
      }

      // Emit enter / stay signals
      for (let i = 0; i < zone.overlapCount; i++) {
        const oh = zone.overlapHandles[i];
        const wasInside = containsHandle(zone.prevOverlapHandles, prevCount, oh);
        if (!wasInside) {
          if (!(zone.oneShot && zone.triggered) && zone.cooldownTimer <= 0) {
            zone.enterCount++;
            zone.triggered = true;
            zone.cooldownTimer = zone.cooldownSec;
            if (zone.onEnterEvent) {
              vm.emitCustomEvent(zone.onEnterEvent);
            }
          }
        } else if (zone.onStayEvent && zone.cooldownTimer <= 0) {
          vm.emitCustomEvent(zone.onStayEvent);
        }
      }

      // Emit exit signals
      for (let i = 0; i < prevCount; i++) {
        const ph = zone.prevOverlapHandles[i];
        if (!containsHandle(zone.overlapHandles, zone.overlapCount, ph)) {
          zone.exitCount++;
          if (zone.onExitEvent) {
            vm.emitCustomEvent(zone.onExitEvent);
          }
        }
      }
    }
  }

  public stepVerletChains(core: EcsCoreWorld, dt: number): void {
    const c = core.components;
    const chainStore = core.getStore(c.VerletChain);
    const chainCount = chainStore.size();
    if (chainCount === 0) return;

    const dtSq = dt * dt;

    for (let i = 0; i < chainCount; i++) {
      const h = chainStore.getDenseEntityAt(i);
      const chain = chainStore.getDenseDataAt(i);
      const tr = core.getComponent(h, c.Transform2D);
      if (!tr) continue;

      const count = Math.max(2, Math.min(MAX_VERLET_NODES, Math.round(chain.nodeCount)));
      const segLen = Math.max(1, chain.segmentLength);
      const damping = Math.max(0.5, Math.min(1, chain.damping));
      const iters = Math.max(1, Math.min(12, Math.round(chain.iterations)));

      const rx = tr.x + tr.w * 0.5 + chain.attachOffsetX;
      const ry = tr.y + tr.h * 0.5 + chain.attachOffsetY;

      if (!chain.initialized) {
        for (let k = 0; k < count; k++) {
          chain.posX[k] = rx;
          chain.posY[k] = ry + k * segLen;
          chain.prevX[k] = rx;
          chain.prevY[k] = ry + k * segLen;
        }
        chain.initialized = true;
      }

      const startIdx = chain.pinStart ? 1 : 0;
      for (let k = startIdx; k < count; k++) {
        const x = chain.posX[k];
        const y = chain.posY[k];
        const vx = (x - chain.prevX[k]) * damping;
        const vy = (y - chain.prevY[k]) * damping;
        chain.prevX[k] = x;
        chain.prevY[k] = y;
        chain.posX[k] = x + vx;
        chain.posY[k] = y + vy + chain.gravity * dtSq;
      }

      if (chain.pinStart) {
        chain.posX[0] = rx;
        chain.posY[0] = ry;
        chain.prevX[0] = rx;
        chain.prevY[0] = ry;
      }

      for (let iter = 0; iter < iters; iter++) {
        if (chain.pinStart) {
          chain.posX[0] = rx;
          chain.posY[0] = ry;
        }
        for (let k = 0; k < count - 1; k++) {
          const dx = chain.posX[k + 1] - chain.posX[k];
          const dy = chain.posY[k + 1] - chain.posY[k];
          const dist = Math.hypot(dx, dy) || 1e-4;
          const diff = (dist - segLen) / dist;

          if (k === 0 && chain.pinStart) {
            chain.posX[1] -= dx * diff;
            chain.posY[1] -= dy * diff;
          } else {
            const half = diff * 0.5;
            chain.posX[k] += dx * half;
            chain.posY[k] += dy * half;
            chain.posX[k + 1] -= dx * half;
            chain.posY[k + 1] -= dy * half;
          }
        }
      }
    }
  }
}
