/**
 * Foundational Generational Entity Manager for Pixer's True ECS Architecture.
 *
 * Packs a 20-bit slot index (0..1,048,575) and a 12-bit generation counter (1..4095)
 * into a single JS integer handle (`EntityHandle`). Reusing a freed slot increments its
 * generation so stale handles can never silently alias a newly spawned entity (zero ABA bugs).
 *
 * 100% DOM-free, Zero-GC on create/destroy/iterate hot paths.
 */

export type EntityHandle = number;

export const INVALID_ENTITY: EntityHandle = 0;

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GEN_MASK = 0xfff; // 12 bits (1..4095)

export function packEntityHandle(index: number, generation: number): EntityHandle {
  return (((generation & GEN_MASK) << INDEX_BITS) | (index & INDEX_MASK)) >>> 0;
}

export function unpackEntityIndex(handle: EntityHandle): number {
  return handle & INDEX_MASK;
}

export function unpackEntityGeneration(handle: EntityHandle): number {
  return (handle >>> INDEX_BITS) & GEN_MASK;
}

export interface EntityManagerStats {
  capacity: number;
  aliveCount: number;
  totalCreated: number;
  totalDestroyed: number;
}

export class EntityManager {
  public readonly capacity: number;
  private readonly generations: Uint16Array;
  private readonly aliveFlags: Uint8Array;
  private readonly freeStack: Uint32Array;
  private readonly denseAlive: Uint32Array;
  private readonly sparseToDense: Int32Array;
  private readonly names: string[];

  private freeTop = 0;
  private aliveCount = 0;
  private totalCreated = 0;
  private totalDestroyed = 0;

  constructor(capacity = 4096) {
    this.capacity = Math.max(16, Math.min(65535, Math.floor(capacity)));
    this.generations = new Uint16Array(this.capacity);
    this.aliveFlags = new Uint8Array(this.capacity);
    this.freeStack = new Uint32Array(this.capacity);
    this.denseAlive = new Uint32Array(this.capacity);
    this.sparseToDense = new Int32Array(this.capacity);
    this.names = new Array<string>(this.capacity).fill('');
    this.reset();
  }

  public reset(): void {
    this.aliveFlags.fill(0);
    this.sparseToDense.fill(-1);
    this.aliveCount = 0;
    this.freeTop = this.capacity;
    for (let i = 0; i < this.capacity; i++) {
      // Generation starts at 1 so INVALID_ENTITY (0) is never valid
      this.generations[i] = 1;
      this.freeStack[i] = this.capacity - 1 - i;
      this.names[i] = '';
    }
  }

  public create(name = ''): EntityHandle {
    if (this.freeTop <= 0) {
      throw new Error(`EntityManager capacity (${this.capacity}) exceeded`);
    }
    const index = this.freeStack[--this.freeTop];
    const gen = this.generations[index] || 1;
    const handle = packEntityHandle(index, gen);

    this.aliveFlags[index] = 1;
    this.names[index] = name;
    const denseIdx = this.aliveCount++;
    this.denseAlive[denseIdx] = handle;
    this.sparseToDense[index] = denseIdx;
    this.totalCreated++;

    return handle;
  }

  public isAlive(handle: EntityHandle): boolean {
    if (handle === INVALID_ENTITY) return false;
    const index = unpackEntityIndex(handle);
    if (index >= this.capacity) return false;
    if (this.aliveFlags[index] === 0) return false;
    return this.generations[index] === unpackEntityGeneration(handle);
  }

  public destroy(handle: EntityHandle): boolean {
    if (!this.isAlive(handle)) return false;
    const index = unpackEntityIndex(handle);

    this.aliveFlags[index] = 0;
    this.names[index] = '';

    // Increment generation (wrap 4095 -> 1, never 0)
    const nextGen = (this.generations[index] + 1) & GEN_MASK;
    this.generations[index] = nextGen === 0 ? 1 : nextGen;

    // O(1) swap-remove from dense alive list
    const denseIdx = this.sparseToDense[index];
    const lastDenseIdx = --this.aliveCount;
    if (denseIdx !== lastDenseIdx) {
      const movedHandle = this.denseAlive[lastDenseIdx];
      this.denseAlive[denseIdx] = movedHandle;
      this.sparseToDense[unpackEntityIndex(movedHandle)] = denseIdx;
    }
    this.sparseToDense[index] = -1;

    this.freeStack[this.freeTop++] = index;
    this.totalDestroyed++;
    return true;
  }

  public getName(handle: EntityHandle): string {
    if (!this.isAlive(handle)) return '';
    return this.names[unpackEntityIndex(handle)] ?? '';
  }

  public setName(handle: EntityHandle, name: string): boolean {
    if (!this.isAlive(handle)) return false;
    this.names[unpackEntityIndex(handle)] = name;
    return true;
  }

  public getAliveCount(): number {
    return this.aliveCount;
  }

  public getAliveHandleAt(denseIdx: number): EntityHandle {
    return this.denseAlive[denseIdx] ?? INVALID_ENTITY;
  }

  public forEachAlive(visitor: (handle: EntityHandle, index: number) => void): void {
    // Iterate backwards so destruction inside callbacks stays safe
    for (let i = this.aliveCount - 1; i >= 0; i--) {
      const h = this.denseAlive[i];
      visitor(h, unpackEntityIndex(h));
    }
  }

  public getStats(): EntityManagerStats {
    return {
      capacity: this.capacity,
      aliveCount: this.aliveCount,
      totalCreated: this.totalCreated,
      totalDestroyed: this.totalDestroyed,
    };
  }
}
