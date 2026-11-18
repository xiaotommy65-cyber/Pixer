import type { EngineHost } from '../core/runtime/EngineHost.ts';
import { el } from './dom.ts';

export type BootPickupStage = 'standby' | 'picking' | 'holding' | 'awake';

/**
 * 3-Step Boot Pickup & Pixel Eye-Blink Sequence (~1.42s after user wake tap):
 * 1) Standby: console rests tilted on dark desk showing [ 點擊喚醒 ]
 * 2) Picking (0-360ms): unlocks Web Audio + SVG rounded hands slide up to cradle Joy-Cons
 * 3) Holding -> Awake (360-1420ms): console zooms upright, eyes open/blink with stereo ticks, enters HOME Lobby
 */
export class BootBlinkOverlay {
  public readonly element: HTMLElement;

  private readonly host: EngineHost;
  private readonly ac = new AbortController();
  private readonly timerIds: number[] = [];
  private readonly eyeLeft: HTMLElement;
  private readonly eyeRight: HTMLElement;
  private readonly wordmark: HTMLElement;
  private readonly wakePrompt: HTMLElement;
  private stage: BootPickupStage = 'standby';
  private finished = false;
  private onComplete?: () => void;
  private onStageChange?: (stage: BootPickupStage) => void;

  constructor(host: EngineHost, onStageChange?: (stage: BootPickupStage) => void) {
    this.host = host;
    this.onStageChange = onStageChange;
    this.element = el('div', 'boot-blink-overlay is-standby');
    this.element.setAttribute('aria-label', 'Pixel Atelier 開機畫面');

    const eyesRow = el('div', 'boot-eyes-row');
    this.eyeLeft = el('span', 'pixel-eye');
    this.eyeRight = el('span', 'pixel-eye');
    eyesRow.append(this.eyeLeft, this.eyeRight);

    this.wordmark = el('span', 'boot-wordmark', 'PIXEL ATELIER OS');
    this.wakePrompt = el('span', 'boot-wake-prompt', '[ 點擊喚醒 ]');
    this.element.append(eyesRow, this.wordmark, this.wakePrompt);

    this.element.addEventListener(
      'click',
      () => {
        this.host.unlockAudio();
        if (this.stage === 'standby') {
          this.triggerPickupSequence();
        } else {
          this.finishNow();
        }
      },
      { signal: this.ac.signal },
    );
  }

  public getStage(): BootPickupStage {
    return this.stage;
  }

  public wakeIfStandby(): void {
    if (this.stage === 'standby' && !this.finished) {
      this.host.unlockAudio();
      this.triggerPickupSequence();
    }
  }

  public play(onComplete: () => void): void {
    this.clearTimers();
    this.finished = false;
    this.onComplete = onComplete;
    this.stage = 'standby';
    this.onStageChange?.('standby');

    this.element.classList.remove('panel-hidden', 'is-fading');
    this.element.classList.add('is-standby');
    this.eyeLeft.classList.remove('is-open', 'is-blinking');
    this.eyeRight.classList.remove('is-open', 'is-blinking');
    this.wordmark.classList.remove('is-visible');
  }

  private triggerPickupSequence(): void {
    if (this.finished || this.stage !== 'standby') return;
    this.clearTimers();

    this.element.classList.remove('is-standby');
    this.stage = 'picking';
    this.onStageChange?.('picking');
    this.host.playStereoTick(260, 0, 0.22);

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      this.stage = 'holding';
      this.onStageChange?.('holding');
      this.eyeLeft.classList.add('is-open');
      this.eyeRight.classList.add('is-open');
      this.wordmark.classList.add('is-visible');
      this.schedule(() => this.finishNow(), 220);
      return;
    }

    this.schedule(() => {
      this.stage = 'holding';
      this.onStageChange?.('holding');
    }, 360);

    this.schedule(() => {
      this.eyeLeft.classList.add('is-open');
      this.host.playStereoTick(620, -0.48, 0.2);
    }, 520);

    this.schedule(() => {
      this.eyeRight.classList.add('is-open');
      this.wordmark.classList.add('is-visible');
      this.host.playStereoTick(700, 0.48, 0.2);
    }, 660);

    this.schedule(() => {
      this.eyeLeft.classList.add('is-blinking');
      this.eyeRight.classList.add('is-blinking');
    }, 940);

    this.schedule(() => {
      this.eyeLeft.classList.remove('is-blinking');
      this.eyeRight.classList.remove('is-blinking');
      this.host.playStereoTick(880, 0, 0.16);
    }, 1070);

    this.schedule(() => {
      this.element.classList.add('is-fading');
      this.host.playIrisChord('out');
    }, 1200);

    this.schedule(() => {
      this.finishNow();
    }, 1420);
  }

  public finishNow(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearTimers();
    this.stage = 'awake';
    this.onStageChange?.('awake');
    this.element.classList.add('panel-hidden');
    this.element.classList.remove('is-fading', 'is-standby');
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
    this.onStageChange = undefined;
  }
}
