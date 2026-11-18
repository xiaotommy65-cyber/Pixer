import type { EngineHost } from '../core/runtime/EngineHost.ts';
import { el } from './dom.ts';

/**
 * Cold-boot / wake 1.3s pixel eye-blink sequence:
 * 220ms left eye open (left-panned tick) -> 380ms right eye open (right-panned tick)
 * -> 740ms joyful blink -> 1100ms fade out -> 1300ms HOME_LOBBY handoff.
 */
export class BootBlinkOverlay {
  public readonly element: HTMLElement;

  private readonly host: EngineHost;
  private readonly ac = new AbortController();
  private readonly timerIds: number[] = [];
  private readonly eyeLeft: HTMLElement;
  private readonly eyeRight: HTMLElement;
  private readonly wordmark: HTMLElement;
  private finished = false;
  private onComplete?: () => void;

  constructor(host: EngineHost) {
    this.host = host;
    this.element = el('div', 'boot-blink-overlay');
    this.element.setAttribute('aria-label', 'Pixel Atelier 開機畫面');

    const eyesRow = el('div', 'boot-eyes-row');
    this.eyeLeft = el('span', 'pixel-eye');
    this.eyeRight = el('span', 'pixel-eye');
    eyesRow.append(this.eyeLeft, this.eyeRight);

    this.wordmark = el('span', 'boot-wordmark', 'PIXEL ATELIER OS');
    this.element.append(eyesRow, this.wordmark);

    this.element.addEventListener(
      'click',
      () => {
        this.host.unlockAudio();
        this.finishNow();
      },
      { signal: this.ac.signal },
    );
  }

  public play(onComplete: () => void): void {
    this.clearTimers();
    this.finished = false;
    this.onComplete = onComplete;
    this.element.classList.remove('panel-hidden', 'is-fading');
    this.eyeLeft.classList.remove('is-open', 'is-blinking');
    this.eyeRight.classList.remove('is-open', 'is-blinking');
    this.wordmark.classList.remove('is-visible');

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      this.eyeLeft.classList.add('is-open');
      this.eyeRight.classList.add('is-open');
      this.wordmark.classList.add('is-visible');
      this.schedule(() => this.finishNow(), 250);
      return;
    }

    this.schedule(() => {
      this.eyeLeft.classList.add('is-open');
      this.host.playStereoTick(620, -0.48, 0.2);
    }, 220);

    this.schedule(() => {
      this.eyeRight.classList.add('is-open');
      this.wordmark.classList.add('is-visible');
      this.host.playStereoTick(700, 0.48, 0.2);
    }, 380);

    this.schedule(() => {
      this.eyeLeft.classList.add('is-blinking');
      this.eyeRight.classList.add('is-blinking');
    }, 740);

    this.schedule(() => {
      this.eyeLeft.classList.remove('is-blinking');
      this.eyeRight.classList.remove('is-blinking');
      this.host.playStereoTick(880, 0, 0.16);
    }, 870);

    this.schedule(() => {
      this.element.classList.add('is-fading');
    }, 1080);

    this.schedule(() => {
      this.finishNow();
    }, 1300);
  }

  public finishNow(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.element.classList.add('panel-hidden');
    this.element.classList.remove('is-fading');
    const cb = this.onComplete;
    this.onComplete = undefined;
    cb?.();
  }

  private schedule(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => fn(), ms);
    this.timerIds.push(id);
  }

  private clearTimers(): void {
    for (const id of this.timerIds) window.clearTimeout(id);
    this.timerIds.length = 0;
  }

  public destroy(): void {
    this.clearTimers();
    this.ac.abort();
    this.onComplete = undefined;
  }
}
