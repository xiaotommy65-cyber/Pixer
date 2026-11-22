import {
  type ComponentRegistry,
  type ComponentTypeDef,
  createStandardComponentRegistry,
  SparseSetComponentStore,
} from './ComponentStore.ts';
import { type EntityHandle, EntityManager, unpackEntityIndex } from './EntityManager.ts';

export type EcsSystemPhase = 'input' | 'script' | 'physics' | 'fixed' | 'render';

const PHASE_ORDER: Record<EcsSystemPhase, number> = {
  input: 0,
  script: 1,
  physics: 2,
  fixed: 3,
  render: 4,
};

export interface EcsSystem {
  readonly id: string;
  readonly phase: EcsSystemPhase;
  readonly priority?: number;
  execute: (world: EcsCoreWorld, dt: number) => void;
}

/**
 * Foundational True ECS World uniting:
 * - Generational `EntityManager` (ABA-safe EntityHandle)
 * - Extensible `ComponentRegistry` + O(1) `SparseSetComponentStore<T>`
 * - Per-entity archetype bitmask queries (`queryMask`)
 * - Deterministic phase-ordered `SystemScheduler`
 *
 * 100% DOM-free and zero-dependency.
 */
export class EcsCoreWorld {
  public readonly entities: EntityManager;
  public readonly registry: ComponentRegistry;
  public readonly components: ReturnType<typeof createStandardComponentRegistry>;

  private readonly entityMasks: Uint32Array;
  private readonly stores = new Map<number, SparseSetComponentStore<unknown>>();
  private readonly systems: EcsSystem[] = [];
  private systemsDirty = false;

  constructor(maxEntities = 4096) {
    this.entities = new EntityManager(maxEntities);
    this.components = createStandardComponentRegistry();
    this.registry = this.components.registry;
    this.entityMasks = new Uint32Array(this.entities.capacity);
  }

  public createEntity(name = ''): EntityHandle {
    const h = this.entities.create(name);
    this.entityMasks[unpackEntityIndex(h)] = 0;
    return h;
  }

  public destroyEntity(handle: EntityHandle): boolean {
    if (!this.entities.isAlive(handle)) return false;
    const idx = unpackEntityIndex(handle);
    const mask = this.entityMasks[idx];
    if (mask !== 0) {
      for (const [bit, store] of this.stores) {
        if ((mask & (1 << bit)) !== 0) {
          store.removeByIndex(idx);
        }
      }
      this.entityMasks[idx] = 0;
    }
    return this.entities.destroy(handle);
  }

  public getEntityMask(handle: EntityHandle): number {
    if (!this.entities.isAlive(handle)) return 0;
    return this.entityMasks[unpackEntityIndex(handle)];
  }

  public getStore<T>(def: ComponentTypeDef<T>): SparseSetComponentStore<T> {
    let store = this.stores.get(def.bit);
    if (!store) {
      store = new SparseSetComponentStore<unknown>(
        def as ComponentTypeDef<unknown>,
        this.entities.capacity,
      );
      this.stores.set(def.bit, store);
    }
    return store as SparseSetComponentStore<T>;
  }

  public addComponent<T>(handle: EntityHandle, def: ComponentTypeDef<T>, init?: Partial<T>): T {
    if (!this.entities.isAlive(handle)) {
      throw new Error(`Cannot add component "${def.id}" to dead/invalid entity ${handle}`);
    }
    const idx = unpackEntityIndex(handle);
    const store = this.getStore(def);
    const value = def.createDefault();
    if (init) {
      Object.assign(value as object, init);
    }
    store.set(handle, value);
    this.entityMasks[idx] |= def.mask;
    return value;
  }

  public getComponent<T>(handle: EntityHandle, def: ComponentTypeDef<T>): T | undefined {
    if (!this.entities.isAlive(handle)) return undefined;
    const idx = unpackEntityIndex(handle);
    if ((this.entityMasks[idx] & def.mask) === 0) return undefined;
    return this.getStore(def).getByIndex(idx);
  }

  public hasComponent<T>(handle: EntityHandle, def: ComponentTypeDef<T>): boolean {
    if (!this.entities.isAlive(handle)) return false;
    return (this.entityMasks[unpackEntityIndex(handle)] & def.mask) !== 0;
  }

  public removeComponent<T>(handle: EntityHandle, def: ComponentTypeDef<T>): boolean {
    if (!this.entities.isAlive(handle)) return false;
    const idx = unpackEntityIndex(handle);
    if ((this.entityMasks[idx] & def.mask) === 0) return false;
    this.entityMasks[idx] &= ~def.mask;
    return this.getStore(def).removeByIndex(idx);
  }

  /**
   * Computes a combined archetype bitmask from any list of component definitions.
   */
  public buildMask(...defs: ComponentTypeDef<unknown>[]): number {
    let mask = 0;
    for (let i = 0; i < defs.length; i++) {
      mask |= defs[i].mask;
    }
    return mask;
  }

  /**
   * Zero-allocation archetype query iterating all alive entities matching `requiredMask`
   * (and optionally excluding `excludedMask`).
   */
  public queryMask(
    requiredMask: number,
    visitor: (handle: EntityHandle) => void,
    excludedMask = 0,
  ): number {
    let matched = 0;
    const count = this.entities.getAliveCount();
    for (let i = 0; i < count; i++) {
      const h = this.entities.getAliveHandleAt(i);
      const em = this.entityMasks[unpackEntityIndex(h)];
      if ((em & requiredMask) === requiredMask && (excludedMask === 0 || (em & excludedMask) === 0)) {
        visitor(h);
        matched++;
      }
    }
    return matched;
  }

  public registerSystem(system: EcsSystem): void {
    const existingIdx = this.systems.findIndex((s) => s.id === system.id);
    if (existingIdx >= 0) {
      this.systems[existingIdx] = system;
    } else {
      this.systems.push(system);
    }
    this.systemsDirty = true;
  }

  public unregisterSystem(id: string): boolean {
    const idx = this.systems.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.systems.splice(idx, 1);
    return true;
  }

  public stepSystems(dt: number): void {
    if (this.systemsDirty) {
      this.systems.sort((a, b) => {
        const pa = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
        if (pa !== 0) return pa;
        return (a.priority ?? 0) - (b.priority ?? 0);
      });
      this.systemsDirty = false;
    }
    for (let i = 0; i < this.systems.length; i++) {
      this.systems[i].execute(this, dt);
    }
  }

  public listSystemIds(): string[] {
    if (this.systemsDirty) {
      this.systems.sort((a, b) => {
        const pa = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase];
        if (pa !== 0) return pa;
        return (a.priority ?? 0) - (b.priority ?? 0);
      });
      this.systemsDirty = false;
    }
    return this.systems.map((s) => `${s.phase}:${s.id}`);
  }

  public clear(): void {
    for (const store of this.stores.values()) {
      store.clear();
    }
    this.entityMasks.fill(0);
    this.entities.reset();
  }
}
