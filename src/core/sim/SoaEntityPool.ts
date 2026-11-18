import { SpatialHash } from '../math/SpatialHash.ts';

export const MAX_ENTITIES = 2048;

// Entity Flag Bitmasks (uint32)
export const EF_ALIVE = 1 << 0;
export const EF_SOLID = 1 << 1;
export const EF_HAZARD = 1 << 2;
export const EF_COLLECTIBLE = 1 << 3;
export const EF_STOMPABLE = 1 << 4;
export const EF_BOUNCY = 1 << 5;
export const EF_TELEPORTED = 1 << 6;
export const EF_GRAVITY = 1 << 7;
export const EF_PLAYER = 1 << 8;
export const EF_BULLET = 1 << 9;
export const EF_ENEMY = 1 << 10;
export const EF_BOSS = 1 << 11;
export const EF_WEAK_POINT = 1 << 12;
export const EF_ON_GROUND = 1 << 13;
export const EF_FACING_LEFT = 1 << 14;
export const EF_PIERCING = 1 << 15;
export const EF_CLEARS_BULLETS = 1 << 16;
export const EF_HOMING = 1 << 17;
export const EF_ADDITIVE = 1 << 18;
export const EF_EMISSIVE = 1 << 19;
export const EF_FLIP_X = 1 << 20;
export const EF_ONE_WAY = 1 << 21;
export const EF_PICKUP = 1 << 22;

// Composable Behavior Bitmasks (uint32)
export const BM_PLATFORMER_CTRL = 1 << 0;
export const BM_TOPDOWN_MOVE = 1 << 1;
export const BM_PATROL = 1 << 2;
export const BM_CHASE = 1 << 3;
export const BM_ORBIT = 1 << 4;
export const BM_BULLET_EMITTER = 1 << 5;
export const BM_WAIT_TIMER = 1 << 6;
export const BM_SIN_FLOAT = 1 << 7;
export const BM_HOMING = 1 << 8;
export const BM_ROTATE = 1 << 9;
export const BM_MOVING_PLATFORM = 1 << 10;

/**
 * Zero-GC Struct-of-Arrays (SoA) Entity Pool supporting up to 2,048 active entities
 * with O(1) slot allocation, swap-pop active iteration, fixed-step prev->curr interpolation,
 * and an integrated Uniform Spatial Hash Grid for O(1) broad-phase spatial queries.
 */
export class SoaEntityPool {
  public readonly capacity = MAX_ENTITIES;

  public readonly flags = new Uint32Array(MAX_ENTITIES);
  public readonly behaviorMask = new Uint32Array(MAX_ENTITIES);

  public readonly x = new Float32Array(MAX_ENTITIES);
  public readonly y = new Float32Array(MAX_ENTITIES);
  public readonly prevX = new Float32Array(MAX_ENTITIES);
  public readonly prevY = new Float32Array(MAX_ENTITIES);
  public readonly vx = new Float32Array(MAX_ENTITIES);
  public readonly vy = new Float32Array(MAX_ENTITIES);
  public readonly w = new Float32Array(MAX_ENTITIES);
  public readonly h = new Float32Array(MAX_ENTITIES);
  public readonly rot = new Float32Array(MAX_ENTITIES);
  public readonly prevRot = new Float32Array(MAX_ENTITIES);
  public readonly sx = new Float32Array(MAX_ENTITIES);
  public readonly sy = new Float32Array(MAX_ENTITIES);
  public readonly skewX = new Float32Array(MAX_ENTITIES);
  public readonly flash = new Float32Array(MAX_ENTITIES);
  public readonly pivotX = new Float32Array(MAX_ENTITIES);
  public readonly pivotY = new Float32Array(MAX_ENTITIES);

  public readonly hp = new Float32Array(MAX_ENTITIES);
  public readonly maxHp = new Float32Array(MAX_ENTITIES);
  public readonly archetypeIdx = new Int16Array(MAX_ENTITIES);
  public readonly spriteIdx = new Int16Array(MAX_ENTITIES);
  public readonly paletteRow = new Uint8Array(MAX_ENTITIES);
  public readonly aiState = new Int16Array(MAX_ENTITIES);
  public readonly parentSlot = new Int16Array(MAX_ENTITIES);
  public readonly timerA = new Float32Array(MAX_ENTITIES);
  public readonly timerB = new Float32Array(MAX_ENTITIES);
  public readonly paramA = new Float32Array(MAX_ENTITIES);
  public readonly paramB = new Float32Array(MAX_ENTITIES);
  public readonly paramC = new Float32Array(MAX_ENTITIES);
  public readonly paramD = new Float32Array(MAX_ENTITIES);
  public readonly varOffset = new Uint16Array(MAX_ENTITIES);

  public readonly activeIndices = new Uint16Array(MAX_ENTITIES);
  private readonly activePosOfSlot = new Int16Array(MAX_ENTITIES);
  private readonly freeList = new Uint16Array(MAX_ENTITIES);

  public readonly spatialHash = new SpatialHash(MAX_ENTITIES, 32, 4096, MAX_ENTITIES * 4, 36);
  public readonly spatialQueryScratch = new Int32Array(MAX_ENTITIES);

  public activeCount = 0;
  private freeCount = MAX_ENTITIES;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.flags.fill(0);
    this.behaviorMask.fill(0);
    this.activePosOfSlot.fill(-1);
    this.parentSlot.fill(-1);
    this.activeCount = 0;
    this.freeCount = MAX_ENTITIES;
    this.spatialHash.clear();
    for (let i = 0; i < MAX_ENTITIES; i++) {
      this.freeList[i] = MAX_ENTITIES - 1 - i;
    }
  }

  public getFreeCount(): number {
    return this.freeCount;
  }

  public alloc(x = 0, y = 0, w = 16, h = 16): number {
    if (this.freeCount <= 0) return -1;
    const slot = this.freeList[--this.freeCount];
    const activePos = this.activeCount++;
    this.activeIndices[activePos] = slot;
    this.activePosOfSlot[slot] = activePos;

    this.flags[slot] = EF_ALIVE;
    this.behaviorMask[slot] = 0;
    this.x[slot] = x;
    this.y[slot] = y;
    this.prevX[slot] = x;
    this.prevY[slot] = y;
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.w[slot] = w;
    this.h[slot] = h;
    this.rot[slot] = 0;
    this.prevRot[slot] = 0;
    this.sx[slot] = 1;
    this.sy[slot] = 1;
    this.skewX[slot] = 0;
    this.flash[slot] = 0;
    this.pivotX[slot] = 0.5;
    this.pivotY[slot] = 0.5;
    this.hp[slot] = 1;
    this.maxHp[slot] = 1;
    this.archetypeIdx[slot] = -1;
    this.spriteIdx[slot] = 0;
    this.paletteRow[slot] = 0;
    this.aiState[slot] = 0;
    this.parentSlot[slot] = -1;
    this.timerA[slot] = 0;
    this.timerB[slot] = 0;
    this.paramA[slot] = 0;
    this.paramB[slot] = 0;
    this.paramC[slot] = 0;
    this.paramD[slot] = 0;
    this.varOffset[slot] = 0;
    return slot;
  }

  public free(slot: number): boolean {
    if (slot < 0 || slot >= MAX_ENTITIES) return false;
    if ((this.flags[slot] & EF_ALIVE) === 0) return false;

    this.flags[slot] = 0;
    this.behaviorMask[slot] = 0;

    const pos = this.activePosOfSlot[slot];
    const lastPos = --this.activeCount;
    if (pos >= 0 && pos !== lastPos) {
      const movedSlot = this.activeIndices[lastPos];
      this.activeIndices[pos] = movedSlot;
      this.activePosOfSlot[movedSlot] = pos;
    }
    this.activePosOfSlot[slot] = -1;
    this.freeList[this.freeCount++] = slot;
    return true;
  }

  public capturePrev(): void {
    const count = this.activeCount;
    for (let i = 0; i < count; i++) {
      const s = this.activeIndices[i];
      this.prevX[s] = this.x[s];
      this.prevY[s] = this.y[s];
      this.prevRot[s] = this.rot[s];
      this.flags[s] &= ~EF_TELEPORTED;
    }
  }

  public teleport(slot: number, x: number, y: number, rot?: number): void {
    if (slot < 0 || slot >= MAX_ENTITIES) return;
    this.x[slot] = x;
    this.y[slot] = y;
    this.prevX[slot] = x;
    this.prevY[slot] = y;
    if (rot !== undefined) {
      this.rot[slot] = rot;
      this.prevRot[slot] = rot;
    }
    this.flags[slot] |= EF_TELEPORTED;
  }

  public renderX(slot: number, alpha: number): number {
    if ((this.flags[slot] & EF_TELEPORTED) !== 0 || alpha >= 1) return this.x[slot];
    const px = this.prevX[slot];
    return px + (this.x[slot] - px) * alpha;
  }

  public renderY(slot: number, alpha: number): number {
    if ((this.flags[slot] & EF_TELEPORTED) !== 0 || alpha >= 1) return this.y[slot];
    const py = this.prevY[slot];
    return py + (this.y[slot] - py) * alpha;
  }

  public getActivePos(slot: number): number {
    return slot >= 0 && slot < MAX_ENTITIES ? this.activePosOfSlot[slot] : -1;
  }

  /** Rebuilds the integrated Uniform Spatial Hash Grid across all alive entities in O(activeCount), zero-GC. */
  public rebuildSpatialHash(): void {
    this.spatialHash.clear();
    const count = this.activeCount;
    for (let i = 0; i < count; i++) {
      const s = this.activeIndices[i];
      if ((this.flags[s] & EF_ALIVE) === 0) continue;
      this.spatialHash.insertBox(s, this.x[s], this.y[s], this.w[s], this.h[s]);
    }
  }

  /** Queries entity slots whose AABBs overlap [x0, x1) x [y0, y1) via the integrated SpatialHash. */
  public queryRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    outSlots: Int32Array | Uint16Array = this.spatialQueryScratch,
    maxOut = outSlots.length,
  ): number {
    return this.spatialHash.queryRect(x0, y0, x1, y1, outSlots, maxOut);
  }

  /** Queries entity slots whose AABBs lie within `radius` (closest-point distance <= radius) of (cx, cy). */
  public queryRadius(
    cx: number,
    cy: number,
    radius: number,
    outSlots: Int32Array | Uint16Array = this.spatialQueryScratch,
    maxOut = outSlots.length,
  ): number {
    if (!Number.isFinite(radius) || radius < 0) return 0;
    const count = this.spatialHash.queryRect(cx - radius, cy - radius, cx + radius, cy + radius, outSlots, maxOut);
    const r2 = radius * radius;
    let write = 0;
    for (let i = 0; i < count; i++) {
      const s = outSlots[i];
      const ex0 = this.x[s];
      const ey0 = this.y[s];
      const nx = Math.max(ex0, Math.min(cx, ex0 + this.w[s]));
      const ny = Math.max(ey0, Math.min(cy, ey0 + this.h[s]));
      const dx = cx - nx;
      const dy = cy - ny;
      if (dx * dx + dy * dy <= r2) {
        outSlots[write++] = s;
      }
    }
    return write;
  }

  public renderRot(slot: number, alpha: number): number {
    if ((this.flags[slot] & EF_TELEPORTED) !== 0 || alpha >= 1) return this.rot[slot];
    const pr = this.prevRot[slot];
    return pr + (this.rot[slot] - pr) * alpha;
  }
}
