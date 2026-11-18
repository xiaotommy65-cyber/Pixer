import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import { TransitionMascot } from './TransitionMascot.ts';
import { el } from './dom.ts';

/**
 * Coordinates the 3-beat circular CSS clip-path Iris Wipe transition with randomized pixel Momo actions:
 * - Beat 1 (0-260ms): circle(0% at x% y%) -> circle(150% at x% y%)
 * - Beat 2 (270ms): swap handheld shell <-> fullscreen workbench behind mask
 * - Beat 3 (380-660ms): contract mask to circle(0% at 50% 50%) + reveal toolbar
 * Preempt-safe & watchdog-guarded so rapid toggles never leave the curtain stuck or screen blank.
 */
export class IrisWipeTransition {
  public readonly curtain: HTMLElement;

  private readonly host: EngineHost;
  private readonly mascot: TransitionMascot;
  private readonly timers: number[] = [];
  private busy = false;
  private swappedCurrent = false;
  private pendingSwap?: () => void;
  private pendingReveal?: () => void;
  private pendingDone?: () => void;

  constructor(host: EngineHost, atlas: TextureAtlas) {
    this.host = host;
    this.curtain = el('div', 'iris-wipe-curtain');
    this.curtain.setAttribute('aria-hidden', 'true');
    this.mascot = new TransitionMascot(atlas);
    const stage = el('div', 'transition-mascot-stage');
    stage.appendChild(this.mascot.element);
    this.curtain.appendChild(stage);
  }

  public isRunning(): boolean {
    return this.busy;
  }

  public run(opts: {
    originEl?: HTMLElement | null;
    direction: 'in' | 'out';
    onSwapCovered: () => void;
    onRevealStart?: () => void;
    onDone?: () => void;
  }): void {
    // Preempt any mid-flight wipe cleanly instead of ignoring or deadlocking
    if (this.busy) {
      this.clearTimers();
      this.mascot.stop();
      if (!this.swappedCurrent) {
        this.swappedCurrent = true;
        this.pendingSwap?.();
      }
      this.pendingReveal?.();
      this.pendingDone?.();
    }

    this.busy = true;
    this.swappedCurrent = false;
    this.pendingSwap = opts.onSwapCovered;
    this.pendingReveal = opts.onRevealStart;
    this.pendingDone = opts.onDone;

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.host.playIrisChord(opts.direction);

    if (reducedMotion) {
      this.swappedCurrent = true;
      opts.onSwapCovered();
      opts.onRevealStart?.();
      this.finishCleanly();
      return;
    }

    let xPct = 50;
    let yPct = 50;
    if (opts.originEl && typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
      const rect = opts.originEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        xPct = Math.max(4, Math.min(96, ((rect.left + rect.width / 2) / window.innerWidth) * 100));
        yPct = Math.max(4, Math.min(96, ((rect.top + rect.height / 2) / window.innerHeight) * 100));
      }
    }

    this.curtain.style.transition = 'none';
    this.curtain.style.clipPath = `circle(0% at ${xPct.toFixed(1)}% ${yPct.toFixed(1)}%)`;
    this.curtain.classList.add('is-active');
    void this.curtain.offsetWidth;

    this.curtain.style.transition = 'clip-path 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 80ms linear';
    this.curtain.style.clipPath = `circle(150% at ${xPct.toFixed(1)}% ${yPct.toFixed(1)}%)`;

    this.mascot.startRandom(600);

    this.schedule(() => {
      if (!this.swappedCurrent) {
        this.swappedCurrent = true;
        this.pendingSwap?.();
      }
    }, 270);

    this.schedule(() => {
      this.curtain.style.clipPath = 'circle(0% at 50% 50%)';
      this.pendingReveal?.();
    }, 390);

    this.schedule(() => {
      this.finishCleanly();
    }, 670);

    // Failsafe watchdog so the curtain can never stall covered on background-throttled tabs
    this.schedule(() => {
      if (this.busy) {
        if (!this.swappedCurrent) {
          this.swappedCurrent = true;
          this.pendingSwap?.();
        }
        this.pendingReveal?.();
        this.finishCleanly();
      }
    }, 950);
  }

  private finishCleanly(): void {
    this.clearTimers();
    this.mascot.stop();
    this.curtain.classList.remove('is-active');
    this.curtain.style.clipPath = 'circle(0% at 50% 50%)';
    this.busy = false;
    const done = this.pendingDone;
    this.pendingSwap = undefined;
    this.pendingReveal = undefined;
    this.pendingDone = undefined;
    done?.();
  }

  private schedule(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => fn(), ms);
    this.timers.push(id);
  }

  private clearTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.length = 0;
  }

  public destroy(): void {
    this.clearTimers();
    this.mascot.destroy();
    this.curtain.classList.remove('is-active');
    this.busy = false;
    this.pendingSwap = undefined;
    this.pendingReveal = undefined;
    this.pendingDone = undefined;
  }
}
