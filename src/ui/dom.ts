import type { TactilePhase, TactileSwitchProfile } from '../core/audio/ToySynth.ts';
import type { HapticProfile, HapticSide } from '../core/hal/HapticEngine.ts';
import { setElementIconLabel, type PixelIconName } from './PixelIcons.ts';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function btn(
  cls: string,
  text: string,
  title?: string,
  onClick?: (e: MouseEvent) => void,
  signal?: AbortSignal,
): HTMLButtonElement {
  const node = el('button', cls, text);
  node.type = 'button';
  if (title) node.title = title;
  if (onClick) node.addEventListener('click', onClick, signal ? { signal } : undefined);
  return node;
}

export function iconBtn(
  cls: string,
  icon: PixelIconName,
  text: string,
  title?: string,
  onClick?: (e: MouseEvent) => void,
  signal?: AbortSignal,
): HTMLButtonElement {
  const node = btn(cls, '', title, onClick, signal);
  setElementIconLabel(node, icon, text);
  return node;
}

type HapticSink = (profile: HapticProfile, side: HapticSide, skipAcoustic: boolean) => void;
let registeredHapticSink: HapticSink | null = null;

export function registerDomHapticSink(sink: HapticSink | null): () => void {
  registeredHapticSink = sink;
  return () => {
    if (sink && registeredHapticSink === sink) {
      registeredHapticSink = null;
    }
  };
}

export function pulseHaptic(
  ms = 9,
  profile?: HapticProfile,
  side: HapticSide = 'both',
  skipAcoustic = true,
): void {
  if (registeredHapticSink) {
    const resolved: HapticProfile = profile ?? (ms >= 14 ? 'thump' : ms >= 10 ? 'click' : 'tap');
    registeredHapticSink(resolved, side, skipAcoustic);
    return;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(ms);
    } catch {
      // Ignore haptic blocks on restricted browsers
    }
  }
}

const impactTimers = new WeakMap<HTMLElement, number>();

/** Fires a brief physical contact shockwave class (`is-impact`) without blocking rapid taps. */
export function triggerImpactRing(target: HTMLElement): void {
  const prev = impactTimers.get(target);
  if (prev !== undefined) window.clearTimeout(prev);
  target.classList.remove('is-impact');
  void target.offsetWidth;
  target.classList.add('is-impact');
  const id = window.setTimeout(() => {
    target.classList.remove('is-impact');
    impactTimers.delete(target);
  }, 240);
  impactTimers.set(target, id);
}

/** Retriggers a transient CSS animation class and removes it automatically after `durationMs`. */
export function pulseTransientClass(
  target: HTMLElement,
  classNames: string | readonly string[],
  durationMs: number,
  timerMap: WeakMap<HTMLElement, number>,
  trackedTimers?: Set<number>,
): void {
  const list = typeof classNames === 'string' ? [classNames] : classNames;
  const prev = timerMap.get(target);
  if (prev !== undefined) {
    window.clearTimeout(prev);
    trackedTimers?.delete(prev);
  }
  target.classList.remove(...list);
  void target.offsetWidth;
  target.classList.add(...list);
  const id = window.setTimeout(() => {
    target.classList.remove(...list);
    timerMap.delete(target);
    trackedTimers?.delete(id);
  }, durationMs);
  timerMap.set(target, id);
  trackedTimers?.add(id);
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/** Builds an accessible segmented toggle group and returns a state sync callback. */
export function createSegmentedControl<T extends string>(opts: {
  ariaLabel: string;
  options: readonly SegmentedOption<T>[];
  initialValue: T;
  onSelect: (value: T) => void;
  signal?: AbortSignal;
}): { element: HTMLElement; sync: (activeValue: T) => void } {
  const group = el('div', 'grip-segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', opts.ariaLabel);

  const buttons = new Map<T, HTMLButtonElement>();
  const sync = (activeValue: T) => {
    for (const [value, b] of buttons.entries()) {
      const active = value === activeValue;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    }
  };

  for (const item of opts.options) {
    const b = btn('grip-seg-btn', item.label, item.title);
    b.addEventListener('click', () => opts.onSelect(item.value), opts.signal ? { signal: opts.signal } : undefined);
    buttons.set(item.value, b);
    group.appendChild(b);
  }

  sync(opts.initialValue);
  return { element: group, sync };
}

export interface PointerDragHandlers {
  onStart: (e: PointerEvent) => boolean | void;
  onMove?: (e: PointerEvent) => void;
  onEnd?: (e: PointerEvent) => void;
  signal?: AbortSignal;
}

/**
 * Attaches pointer drag tracking with guarded setPointerCapture across card drag, D-Pad slide, and sticks.
 */
export function bindPointerDrag(target: HTMLElement, handlers: PointerDragHandlers): void {
  let activePid: number | null = null;
  const listenerOpts = handlers.signal ? { signal: handlers.signal } : undefined;

  target.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (handlers.onStart(e) === false) return;
      e.preventDefault();
      activePid = e.pointerId;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture errors on synthetic or unsupported pointer events
      }
    },
    listenerOpts,
  );

  target.addEventListener(
    'pointermove',
    (e) => {
      if (activePid === e.pointerId) handlers.onMove?.(e);
    },
    listenerOpts,
  );

  const finish = (e: PointerEvent) => {
    if (activePid === null) return;
    if (e.type !== 'lostpointercapture' && e.pointerId !== activePid && e.pointerId !== 0) return;
    activePid = null;
    handlers.onEnd?.(e);
  };

  target.addEventListener('pointerup', finish, listenerOpts);
  target.addEventListener('pointercancel', finish, listenerOpts);
  target.addEventListener('lostpointercapture', finish, listenerOpts);
}

/**
 * Binds momentary press/release tactile state (`is-pressed` + `is-impact`) using pointer capture
 * so thumb micro-drift on touchscreens never accidentally cancels a held Jump or Action button.
 */
export function bindMomentaryButton(
  target: HTMLElement,
  onPress: (e: PointerEvent) => void,
  onRelease?: (e: PointerEvent) => void,
  signal?: AbortSignal,
): void {
  let activePid: number | null = null;
  const listenerOpts = signal ? { signal } : undefined;

  target.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (activePid !== null) return;
      activePid = e.pointerId;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failures in headless or synthetic tests
      }
      target.classList.add('is-pressed');
      triggerImpactRing(target);
      onPress(e);
    },
    listenerOpts,
  );

  const release = (e: PointerEvent) => {
    if (activePid === null) return;
    if (e.type !== 'lostpointercapture' && e.pointerId !== activePid && e.pointerId !== 0) return;
    const pid = activePid;
    activePid = null;
    try {
      if (target.hasPointerCapture(pid)) target.releasePointerCapture(pid);
    } catch {
      // Ignore release errors
    }
    target.classList.remove('is-pressed');
    onRelease?.(e);
  };

  target.addEventListener('pointerup', release, listenerOpts);
  target.addEventListener('pointercancel', release, listenerOpts);
  target.addEventListener('lostpointercapture', release, listenerOpts);
}

interface TactileTargetSpec {
  profile: TactileSwitchProfile;
  sound: boolean;
  hapticMs: number;
}

const TACTILE_SELECTOR =
  '.jc-sys-btn, .aux-sys-btn, .grip-seg-btn, .eject-btn, .handheld-exit-btn, .handheld-settings-btn, .rpg-agent-btn, .rpg-act-btn, .shmup-fighter-card, .shmup-weapon-btn, .shmup-bomb-btn, .chr-btn, .chr-tab, .chr-card, .chr-choice, .toy-btn, .station-tab, .shell-swatch, .palette-chip, .momo-badge';

function classifyTactileTarget(node: HTMLElement): TactileTargetSpec | null {
  if ((node as HTMLButtonElement).disabled || node.matches(':disabled')) return null;
  if (node.closest('.diamond, .jc-bumper, .stick')) return null;
  if (node.matches('.jc-sys-btn, .aux-sys-btn, .eject-btn, .handheld-exit-btn, .handheld-settings-btn, .rpg-agent-btn')) {
    return { profile: 'system', sound: true, hapticMs: 10 };
  }
  return { profile: 'ui', sound: true, hapticMs: 9 };
}

/**
 * Single delegated tactile controller for all standard UI/RPG/nav buttons:
 * fires instant `.is-pressed` depression + acoustic down-click on pointerdown
 * without suppressing native `click`, followed by spring-return up-click on release.
 */
export function installGlobalTactileFeedback(
  root: HTMLElement,
  onTactile: (profile: TactileSwitchProfile, phase: TactilePhase) => void,
): () => void {
  const ac = new AbortController();
  const { signal } = ac;
  let pressedEl: HTMLElement | null = null;
  let pressedSpec: TactileTargetSpec | null = null;
  let pressedPid: number | null = null;

  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const raw = e.target instanceof Element ? e.target.closest<HTMLElement>(TACTILE_SELECTOR) : null;
      if (!raw) return;
      const spec = classifyTactileTarget(raw);
      if (!spec) return;

      if (pressedEl && pressedEl !== raw) {
        pressedEl.classList.remove('is-pressed');
      }
      pressedEl = raw;
      pressedSpec = spec;
      pressedPid = e.pointerId;

      raw.classList.add('is-pressed');
      triggerImpactRing(raw);
      pulseHaptic(spec.hapticMs, spec.profile === 'system' ? 'click' : 'tap', 'both', spec.sound);
      if (spec.sound) onTactile(spec.profile, 'down');
    },
    { signal },
  );

  const release = (e?: PointerEvent) => {
    if (!pressedEl) return;
    if (e && pressedPid !== null && e.pointerId !== pressedPid && e.pointerId !== 0) return;
    if (pressedEl.isConnected) {
      pressedEl.classList.remove('is-pressed');
    }
    if (pressedSpec?.sound) {
      onTactile(pressedSpec.profile, 'up');
    }
    pressedEl = null;
    pressedSpec = null;
    pressedPid = null;
  };

  window.addEventListener('pointerup', (e) => release(e), { signal });
  window.addEventListener('pointercancel', (e) => release(e), { signal });
  window.addEventListener('blur', () => release(), { signal });

  return () => {
    release();
    ac.abort();
  };
}
