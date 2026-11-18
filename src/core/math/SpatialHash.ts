/**
 * Zero-GC Uniform Grid Spatial Hash Table using pre-allocated flat TypedArrays
 * and monotonic stamp clearing. Supports up to `maxEntities` AABBs with exact
 * multi-cell overlap indexing, overflow fallback for giant AABBs, and O(1) clear().
 *
 * Structural choice (vs Array<number[]> buckets):
 * - Avoids boxed JS arrays, `.length = 0` resets, and pointer chasing.
 * - O(1) frame clear increments `frameStamp` rather than clearing `bucketCount` buckets.
 * - IEEE-754 float64 bounds preserve exact overlap parity against O(N^2) brute-force oracles.
 */

const HASH_PRIME_X = 73856093;
const HASH_PRIME_Y = 19349663;

function nextPow2(n: number): number {
  let p = 1;
  const target = Math.max(16, n | 0);
  while (p < target) p <<= 1;
  return p;
}

export class SpatialHash {
  public readonly capacity: number;
  public readonly cellSize: number;
  public readonly invCellSize: number;
  public readonly bucketCount: number;
  public readonly bucketMask: number;
  public readonly maxNodes: number;
  public readonly maxEntityCells: number;

  private readonly cellHeads: Int32Array;
  private readonly cellStamps: Uint32Array;
  private readonly nodeEntity: Int32Array;
  private readonly nodeNext: Int32Array;

  private readonly minX: Float64Array;
  private readonly minY: Float64Array;
  private readonly maxX: Float64Array;
  private readonly maxY: Float64Array;
  private readonly cellX0: Int32Array;
  private readonly cellY0: Int32Array;
  private readonly cellX1: Int32Array;
  private readonly cellY1: Int32Array;
  private readonly isOverflow: Uint8Array;

  private readonly activeSlots: Int32Array;
  private readonly overflowSlots: Int32Array;
  private readonly slotStamp: Uint32Array;
  private readonly seenStamp: Uint32Array;

  private frameStamp = 1;
  private queryStamp = 1;
  private activeCount = 0;
  private nodeCount = 0;
  private overflowCount = 0;

  constructor(
    maxEntities = 2048,
    cellSize = 32,
    bucketCount = 4096,
    maxNodes = maxEntities * 8,
    maxEntityCells = 36,
  ) {
    this.capacity = Math.max(1, maxEntities | 0);
    this.cellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 32;
    this.invCellSize = 1 / this.cellSize;
    this.bucketCount = nextPow2(bucketCount);
    this.bucketMask = this.bucketCount - 1;
    this.maxNodes = Math.max(this.capacity, maxNodes | 0);
    this.maxEntityCells = Math.max(1, maxEntityCells | 0);

    this.cellHeads = new Int32Array(this.bucketCount);
    this.cellStamps = new Uint32Array(this.bucketCount);
    this.nodeEntity = new Int32Array(this.maxNodes);
    this.nodeNext = new Int32Array(this.maxNodes);

    this.minX = new Float64Array(this.capacity);
    this.minY = new Float64Array(this.capacity);
    this.maxX = new Float64Array(this.capacity);
    this.maxY = new Float64Array(this.capacity);
    this.cellX0 = new Int32Array(this.capacity);
    this.cellY0 = new Int32Array(this.capacity);
    this.cellX1 = new Int32Array(this.capacity);
    this.cellY1 = new Int32Array(this.capacity);
    this.isOverflow = new Uint8Array(this.capacity);

    this.activeSlots = new Int32Array(this.capacity);
    this.overflowSlots = new Int32Array(this.capacity);
    this.slotStamp = new Uint32Array(this.capacity);
    this.seenStamp = new Uint32Array(this.capacity);
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getOverflowCount(): number {
    return this.overflowCount;
  }

  /** Resets spatial table in O(1) via stamp increment (no bucket array memset). */
  public clear(): void {
    this.activeCount = 0;
    this.nodeCount = 0;
    this.overflowCount = 0;
    if (this.frameStamp === 0xffffffff) {
      this.cellStamps.fill(0);
      this.slotStamp.fill(0);
      this.frameStamp = 1;
    } else {
      this.frameStamp++;
    }
  }

  private nextQueryStamp(): number {
    if (this.queryStamp === 0xffffffff) {
      this.seenStamp.fill(0);
      this.queryStamp = 1;
    } else {
      this.queryStamp++;
    }
    return this.queryStamp;
  }

  /** Inserts an AABB defined by [x, x + w) x [y, y + h). */
  public insertBox(slot: number, x: number, y: number, w: number, h: number): boolean {
    return this.insert(slot, x, y, x + w, y + h);
  }

  /** Inserts an entity slot by AABB [x0, x1) x [y0, y1). Rejects NaN/Infinity or out-of-range slots. */
  public insert(slot: number, x0: number, y0: number, x1: number, y1: number): boolean {
    if (slot < 0 || slot >= this.capacity || (slot | 0) !== slot) return false;
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return false;
    if (this.slotStamp[slot] === this.frameStamp) return false;

    const loX = x0 <= x1 ? x0 : x1;
    const hiX = x0 <= x1 ? x1 : x0;
    const loY = y0 <= y1 ? y0 : y1;
    const hiY = y0 <= y1 ? y1 : y0;

    this.slotStamp[slot] = this.frameStamp;
    this.activeSlots[this.activeCount++] = slot;
    this.minX[slot] = loX;
    this.minY[slot] = loY;
    this.maxX[slot] = hiX;
    this.maxY[slot] = hiY;

    const inv = this.invCellSize;
    const cx0 = Math.floor(loX * inv);
    const cy0 = Math.floor(loY * inv);
    const cx1 = Math.floor(hiX * inv);
    const cy1 = Math.floor(hiY * inv);

    this.cellX0[slot] = cx0;
    this.cellY0[slot] = cy0;
    this.cellX1[slot] = cx1;
    this.cellY1[slot] = cy1;

    const spanX = cx1 - cx0 + 1;
    const spanY = cy1 - cy0 + 1;
    const totalCells = spanX * spanY;

    if (
      !Number.isFinite(totalCells) ||
      spanX > this.maxEntityCells ||
      spanY > this.maxEntityCells ||
      totalCells > this.maxEntityCells ||
      this.nodeCount + totalCells > this.maxNodes
    ) {
      this.isOverflow[slot] = 1;
      this.overflowSlots[this.overflowCount++] = slot;
      return true;
    }

    this.isOverflow[slot] = 0;
    const stamp = this.frameStamp;
    const mask = this.bucketMask;
    for (let cy = cy0; cy <= cy1; cy++) {
      const hy = Math.imul(cy | 0, HASH_PRIME_Y);
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = (Math.imul(cx | 0, HASH_PRIME_X) ^ hy) & mask;
        const head = this.cellStamps[b] === stamp ? this.cellHeads[b] : -1;
        const nodeIdx = this.nodeCount++;
        this.nodeEntity[nodeIdx] = slot;
        this.nodeNext[nodeIdx] = head;
        this.cellHeads[b] = nodeIdx;
        this.cellStamps[b] = stamp;
      }
    }
    return true;
  }

  /**
   * Finds all inserted entity slots whose AABB strictly intersects [x0, x1) x [y0, y1).
   * Writes unique slot IDs into `outSlots` and returns the count written (up to `maxOut`).
   */
  public queryRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    outSlots: Int32Array | Uint16Array,
    maxOut = outSlots.length,
  ): number {
    if (this.activeCount === 0 || maxOut <= 0) return 0;
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return 0;

    const loX = x0 <= x1 ? x0 : x1;
    const hiX = x0 <= x1 ? x1 : x0;
    const loY = y0 <= y1 ? y0 : y1;
    const hiY = y0 <= y1 ? y1 : y0;

    const inv = this.invCellSize;
    const cx0 = Math.floor(loX * inv);
    const cy0 = Math.floor(loY * inv);
    const cx1 = Math.floor(hiX * inv);
    const cy1 = Math.floor(hiY * inv);
    const cellSpan = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);

    let outCount = 0;

    // For very large queries spanning more buckets than inserted entities, linear scan over activeSlots is faster
    if (!Number.isFinite(cellSpan) || cellSpan > this.activeCount * 2) {
      for (let i = 0; i < this.activeCount; i++) {
        const id = this.activeSlots[i];
        if (loX < this.maxX[id] && hiX > this.minX[id] && loY < this.maxY[id] && hiY > this.minY[id]) {
          outSlots[outCount++] = id;
          if (outCount >= maxOut) return outCount;
        }
      }
      return outCount;
    }

    const q = this.nextQueryStamp();
    const stamp = this.frameStamp;
    const mask = this.bucketMask;

    for (let cy = cy0; cy <= cy1; cy++) {
      const hy = Math.imul(cy | 0, HASH_PRIME_Y);
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = (Math.imul(cx | 0, HASH_PRIME_X) ^ hy) & mask;
        if (this.cellStamps[b] !== stamp) continue;
        let node = this.cellHeads[b];
        while (node >= 0) {
          const id = this.nodeEntity[node];
          node = this.nodeNext[node];
          if (this.seenStamp[id] === q) continue;
          this.seenStamp[id] = q;
          if (loX < this.maxX[id] && hiX > this.minX[id] && loY < this.maxY[id] && hiY > this.minY[id]) {
            outSlots[outCount++] = id;
            if (outCount >= maxOut) return outCount;
          }
        }
      }
    }

    for (let i = 0; i < this.overflowCount; i++) {
      const id = this.overflowSlots[i];
      if (this.seenStamp[id] === q) continue;
      this.seenStamp[id] = q;
      if (loX < this.maxX[id] && hiX > this.minX[id] && loY < this.maxY[id] && hiY > this.minY[id]) {
        outSlots[outCount++] = id;
        if (outCount >= maxOut) return outCount;
      }
    }

    return outCount;
  }

  /**
   * Enumerates all unique strictly-overlapping AABB pairs `(a, b)` with `a < b` in O(N + K) amortized time.
   * Zero duplicates, zero missed pairs, zero heap allocations.
   */
  public collectPairsInto(
    outA: Int32Array | Uint16Array,
    outB: Int32Array | Uint16Array,
    maxPairs = outA.length < outB.length ? outA.length : outB.length,
  ): number {
    if (this.activeCount < 2 || maxPairs <= 0) return 0;

    let pairCount = 0;
    const stamp = this.frameStamp;
    const mask = this.bucketMask;

    for (let i = 0; i < this.activeCount; i++) {
      const a = this.activeSlots[i];
      const aMinX = this.minX[a];
      const aMinY = this.minY[a];
      const aMaxX = this.maxX[a];
      const aMaxY = this.maxY[a];

      if (this.isOverflow[a] === 1) {
        for (let j = 0; j < this.activeCount; j++) {
          const b = this.activeSlots[j];
          if (b <= a) continue;
          if (aMinX < this.maxX[b] && aMaxX > this.minX[b] && aMinY < this.maxY[b] && aMaxY > this.minY[b]) {
            outA[pairCount] = a;
            outB[pairCount] = b;
            pairCount++;
            if (pairCount >= maxPairs) return pairCount;
          }
        }
        continue;
      }

      const q = this.nextQueryStamp();
      const cx0 = this.cellX0[a];
      const cy0 = this.cellY0[a];
      const cx1 = this.cellX1[a];
      const cy1 = this.cellY1[a];

      for (let cy = cy0; cy <= cy1; cy++) {
        const hy = Math.imul(cy | 0, HASH_PRIME_Y);
        for (let cx = cx0; cx <= cx1; cx++) {
          const bkt = (Math.imul(cx | 0, HASH_PRIME_X) ^ hy) & mask;
          if (this.cellStamps[bkt] !== stamp) continue;
          let node = this.cellHeads[bkt];
          while (node >= 0) {
            const b = this.nodeEntity[node];
            node = this.nodeNext[node];
            if (b <= a || this.seenStamp[b] === q) continue;
            this.seenStamp[b] = q;
            if (aMinX < this.maxX[b] && aMaxX > this.minX[b] && aMinY < this.maxY[b] && aMaxY > this.minY[b]) {
              outA[pairCount] = a;
              outB[pairCount] = b;
              pairCount++;
              if (pairCount >= maxPairs) return pairCount;
            }
          }
        }
      }

      for (let k = 0; k < this.overflowCount; k++) {
        const b = this.overflowSlots[k];
        if (b <= a || this.seenStamp[b] === q) continue;
        this.seenStamp[b] = q;
        if (aMinX < this.maxX[b] && aMaxX > this.minX[b] && aMinY < this.maxY[b] && aMaxY > this.minY[b]) {
          outA[pairCount] = a;
          outB[pairCount] = b;
          pairCount++;
          if (pairCount >= maxPairs) return pairCount;
        }
      }
    }

    return pairCount;
  }
}
