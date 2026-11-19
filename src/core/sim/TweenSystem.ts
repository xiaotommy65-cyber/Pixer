export type TweenEase = 'linear' | 'quadOut' | 'backOut' | 'cubicInOut';

export const MAX_TWEENS = 64;

export interface TweenSlot {
  active: boolean;
  key: string;
  from: number;
  to: number;
  elapsed: number;
  duration: number;
  ease: TweenEase;
}

function evalTweenEase(ease: TweenEase, t: number): number {
  switch (ease) {
    case 'linear':
      return t;
    case 'quadOut': {
      const inv = 1 - t;
      return 1 - inv * inv;
    }
    case 'backOut': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const tm1 = t - 1;
      return 1 + c3 * tm1 * tm1 * tm1 + c1 * tm1 * tm1;
    }
    case 'cubicInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) * 0.5;
  }
}

/**
 * Zero-GC, DOM-free fixed-pool Tween engine (64 pre-allocated slots)
 * driving smooth variable/property animations inside DataCartridgeRuntime.
 */
export class TweenSystem {
  private readonly slots: TweenSlot[] = Array.from({ length: MAX_TWEENS }, () => ({
    active: false,
    key: '',
    from: 0,
    to: 0,
    elapsed: 0,
    duration: 0,
    ease: 'linear',
  }));
  private replaceCursor = 0;

  public start(
    key: string,
    from: number,
    to: number,
    duration: number,
    ease: TweenEase = 'quadOut',
  ): boolean {
    if (!key || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(duration)) {
      return false;
    }
    let chosenIdx = -1;
    let firstFreeIdx = -1;
    for (let i = 0; i < MAX_TWEENS; i++) {
      const slot = this.slots[i];
      if (slot.active && slot.key === key) {
        chosenIdx = i;
        break;
      }
      if (!slot.active && firstFreeIdx < 0) {
        firstFreeIdx = i;
      }
    }
    if (chosenIdx < 0) {
      if (firstFreeIdx >= 0) {
        chosenIdx = firstFreeIdx;
      } else {
        chosenIdx = this.replaceCursor;
        this.replaceCursor = (this.replaceCursor + 1) % MAX_TWEENS;
      }
    }

    const dst = this.slots[chosenIdx];
    dst.active = true;
    dst.key = key;
    dst.from = from;
    dst.to = to;
    dst.elapsed = 0;
    dst.duration = Math.max(0, duration);
    dst.ease = ease;
    return true;
  }

  public step(dt: number, onUpdate: (key: string, value: number) => void): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    for (let i = 0; i < MAX_TWEENS; i++) {
      const slot = this.slots[i];
      if (!slot.active) continue;
      slot.elapsed += dt;
      const t = slot.duration <= 0 ? 1 : Math.min(1, Math.max(0, slot.elapsed / slot.duration));
      const eased = evalTweenEase(slot.ease, t);
      const value = slot.from + (slot.to - slot.from) * eased;
      onUpdate(slot.key, value);
      if (t >= 1) {
        slot.active = false;
        slot.key = '';
      }
    }
  }

  public reset(): void {
    this.replaceCursor = 0;
    for (let i = 0; i < MAX_TWEENS; i++) {
      const slot = this.slots[i];
      slot.active = false;
      slot.key = '';
      slot.from = 0;
      slot.to = 0;
      slot.elapsed = 0;
      slot.duration = 0;
      slot.ease = 'linear';
    }
  }

  public getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < MAX_TWEENS; i++) {
      if (this.slots[i].active) count++;
    }
    return count;
  }
}
