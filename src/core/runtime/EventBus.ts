import type { CartridgeId, FeedbackPreset, SimEvent } from '../types/WorldTypes.ts';

export interface EngineEventMap {
  'sim:event': { cartridgeId: CartridgeId; event: SimEvent; combo: number };
  'sim:feedback': {
    cartridgeId: CartridgeId;
    preset: FeedbackPreset;
    intensity: number;
    combo: number;
    sound?: SimEvent;
    haptic?: 'tap' | 'click' | 'thump' | 'impact' | 'celebrate';
    side?: 'left' | 'right' | 'both';
  };
  'cartridge:mounted': { id: CartridgeId; resumedSram: boolean };
  'cartridge:restarted': { id: CartridgeId };
  'stage:changed': { cartridgeId: CartridgeId; index: number; total: number; name: string };
  'plugin:registered': { cartridgeId: CartridgeId; title: string };
  'sprite:registered': { spriteId: string; w: number; h: number };
  'ai:task_queued': { taskId: string; kind: string; cartridgeId: CartridgeId };
  'ai:task_completed': { taskId: string; kind: string; providerId: string; durationMs: number };
  'ai:task_failed': { taskId: string; kind: string; error: string };
}

export type EngineEventKey = keyof EngineEventMap;
export type EngineEventListener<K extends EngineEventKey> = (payload: EngineEventMap[K]) => void;

/**
 * Typed, zero-dependency publish/subscribe bus for decoupling simulation events,
 * cartridge lifecycle, audio/haptic cues, dynamic sprite registration, and async AI tasks.
 */
export class EngineEventBus {
  private readonly listeners = new Map<EngineEventKey, Set<(payload: never) => void>>();

  public on<K extends EngineEventKey>(event: K, handler: EngineEventListener<K>): () => void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    const fn = handler as (payload: never) => void;
    bucket.add(fn);
    return () => {
      bucket?.delete(fn);
      if (bucket && bucket.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  public once<K extends EngineEventKey>(event: K, handler: EngineEventListener<K>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  public emit<K extends EngineEventKey>(event: K, payload: EngineEventMap[K]): void {
    const bucket = this.listeners.get(event);
    if (!bucket || bucket.size === 0) return;
    // Snapshot to stay immune to self-unsubscribing handlers
    const snapshot = Array.from(bucket);
    for (const fn of snapshot) {
      try {
        (fn as EngineEventListener<K>)(payload);
      } catch {
        // Isolate subscriber faults so 60fps simulation remains resilient
      }
    }
  }

  public listenerCount(event?: EngineEventKey): number {
    if (event) return this.listeners.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  public clear(event?: EngineEventKey): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
