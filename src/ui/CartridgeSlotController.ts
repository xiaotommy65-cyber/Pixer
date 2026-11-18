import { getCartridgeMeta } from '../core/runtime/CartridgeRegistry.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeId, CartridgeMeta } from '../core/types/WorldTypes.ts';
import { el, pulseHaptic } from './dom.ts';

export type ConsolePhase = 'empty' | 'booting' | 'running';

const BOOT_SEC = 0.65;
const DEFAULT_SLOT_HINT = '◀ 點此切換卡匣';

type SlotState =
  | { phase: 'empty' }
  | { phase: 'booting'; id: CartridgeId; timer: number }
  | { phase: 'running'; id: CartridgeId };

export interface CartridgeSlotViewRefs {
  slotEl: HTMLElement;
  slotLed: HTMLElement;
  slotWindow: HTMLElement;
  slotHint: HTMLElement;
  ejectBtn: HTMLButtonElement;
  clearSaveBtn: HTMLButtonElement;
  screenFrame: HTMLElement;
  ledStrips: HTMLElement[];
}

export interface CartridgeSlotHooks {
  onBeforeBoot: (id: CartridgeId, resumedSram: boolean, meta: CartridgeMeta) => void;
  onShowEmpty: () => void;
  onPlayRailSnap: () => void;
  onSlotClick: () => void;
  scheduleTimer: (fn: () => void, ms: number) => number;
}

/**
 * Manages the physical top cartridge slot bezel, slot LED strips, bounce-rename badge,
 * active/booting phase timer, and mount/unmount lifecycle via EngineHost.
 */
export class CartridgeSlotController {
  private readonly host: EngineHost;
  private readonly refs: CartridgeSlotViewRefs;
  private readonly hooks: CartridgeSlotHooks;
  private readonly signal: AbortSignal;

  private slotState: SlotState = { phase: 'empty' };
  private slotCardEl: HTMLElement | null = null;
  private previewCode = '';

  constructor(
    host: EngineHost,
    refs: CartridgeSlotViewRefs,
    hooks: CartridgeSlotHooks,
    signal: AbortSignal,
  ) {
    this.host = host;
    this.refs = refs;
    this.hooks = hooks;
    this.signal = signal;

    this.refs.slotWindow.classList.add('is-clickable');
    this.refs.slotWindow.title = '點選開啟換片抽屜';
    this.refs.slotWindow.addEventListener('click', () => this.hooks.onSlotClick(), { signal: this.signal });
    this.refs.slotHint.addEventListener('click', () => this.hooks.onSlotClick(), { signal: this.signal });
  }

  public getPhase(): ConsolePhase {
    return this.slotState.phase;
  }

  public getInserted(): CartridgeId | null {
    return this.slotState.phase === 'empty' ? null : this.slotState.id;
  }

  public tick(dt: number): void {
    if (this.slotState.phase !== 'booting') return;
    this.slotState.timer -= dt;
    if (this.slotState.timer <= 0) {
      this.slotState = { phase: 'running', id: this.slotState.id };
      this.syncStatusLights();
    }
  }

  public syncStatusLights(): void {
    const isBoot = this.slotState.phase === 'booting';
    const isRun = this.slotState.phase === 'running';
    this.refs.slotLed.classList.toggle('is-boot', isBoot);
    this.refs.slotLed.classList.toggle('is-run', isRun);
    for (const strip of this.refs.ledStrips) {
      strip.classList.toggle('is-boot', isBoot);
      strip.classList.toggle('is-run', isRun);
    }
  }

  /** Syncs the top slot indicator badge with a bounce transition when browsing in HOME_LOBBY. */
  public showLobbyFocusBadge(meta: CartridgeMeta): void {
    if (this.slotState.phase === 'empty') {
      this.refs.slotHint.textContent = `🎴 ${meta.code} · ${meta.title}`;
      this.refs.slotHint.classList.remove('panel-hidden');
      if (this.previewCode !== meta.code) {
        this.previewCode = meta.code;
        this.mountSlotBadge(meta, true);
      }
    }
  }

  public insertCartridge(id: CartridgeId, instant = false, skipSplash = false, forceFresh = false): void {
    const meta = getCartridgeMeta(id);
    const sameActive = this.host.activeCartridge === id && !forceFresh;

    if (sameActive && this.slotState.phase !== 'empty') {
      this.host.setPaused(false);
      this.slotState = { phase: 'running', id };
      this.hooks.onBeforeBoot(id, true, meta);
      this.syncStatusLights();
      return;
    }

    const resumed = this.host.mount(id, forceFresh);
    if (!skipSplash && !instant) {
      pulseHaptic(14);
      this.host.playUiSound('snap');
      this.hooks.onPlayRailSnap();
    }
    this.mountSlotBadge(meta, !instant);
    this.slotState = skipSplash || instant ? { phase: 'running', id } : { phase: 'booting', id, timer: BOOT_SEC };
    this.refs.slotEl.classList.remove('is-empty');
    this.refs.slotHint.textContent = `${meta.code} · ${meta.title}`;
    this.refs.slotHint.classList.remove('panel-hidden');
    this.refs.ejectBtn.classList.remove('panel-hidden');
    this.refs.clearSaveBtn.classList.toggle('panel-hidden', !this.host.hasSram(id));
    this.hooks.onBeforeBoot(id, resumed, meta);
    this.syncStatusLights();
  }

  public eject(after?: () => void, instant = false): void {
    const id = this.getInserted();
    if (!id) {
      after?.();
      return;
    }
    this.host.unmount();
    this.host.playUiSound('bounce');
    this.slotState = { phase: 'empty' };
    this.previewCode = '';
    const slotCard = this.slotCardEl;

    const done = () => {
      slotCard?.remove();
      if (this.slotCardEl === slotCard) this.slotCardEl = null;
      this.refs.slotEl.classList.add('is-empty');
      this.refs.slotHint.textContent = DEFAULT_SLOT_HINT;
      this.refs.slotHint.classList.remove('panel-hidden');
      this.refs.ejectBtn.classList.add('panel-hidden');
      this.refs.clearSaveBtn.classList.add('panel-hidden');
      this.hooks.onShowEmpty();
      this.syncStatusLights();
      after?.();
    };

    if (instant || !slotCard) {
      done();
    } else {
      slotCard.classList.add('is-ejecting');
      this.hooks.scheduleTimer(done, 240);
    }
  }

  private mountSlotBadge(meta: CartridgeMeta, animate: boolean): void {
    this.slotCardEl?.remove();
    const mini = el('div', 'slot-card', meta.code);
    mini.style.setProperty('--card-accent', meta.accentHex);
    mini.title = `${meta.title}（點選開啟換片抽屜）`;
    if (animate) {
      mini.classList.add('is-slot-bouncing');
    }
    this.refs.slotWindow.appendChild(mini);
    this.slotCardEl = mini;
  }

  public destroy(): void {
    this.slotCardEl?.remove();
    this.slotCardEl = null;
  }
}
