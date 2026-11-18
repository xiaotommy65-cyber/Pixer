import type { TactilePhase, TactileSwitchProfile } from '../core/audio/ToySynth.ts';
import {
  AntiSnapbackFilter,
  classifyDpadOctant,
  resolveAbxyClusterHit,
  shapeAnalogStickVector,
  updateFloatingStickOrigin,
  type DpadDeadzoneMode,
  type StickCurveMode,
} from '../core/input/InputPipeline.ts';
import type { PadDir } from './GamepadHardwareBridge.ts';
import { bindPointerDrag, btn, el, pulseHaptic, triggerImpactRing } from './dom.ts';

const DIRS: readonly PadDir[] = ['left', 'right', 'up', 'down'];

export function localDeltaFromCenter(
  target: HTMLElement,
  clientX: number,
  clientY: number,
): { dx: number; dy: number; halfW: number; halfH: number } {
  const rect = target.getBoundingClientRect();
  const sx = clientX - (rect.left + rect.width / 2);
  const sy = clientY - (rect.top + rect.height / 2);
  if (target.closest('.is-rotated-90')) {
    return { dx: sy, dy: -sx, halfW: rect.height / 2, halfH: rect.width / 2 };
  }
  return { dx: sx, dy: sy, halfW: rect.width / 2, halfH: rect.height / 2 };
}

export function bindAbxyClusterSurface(params: {
  container: HTMLElement;
  signal: AbortSignal;
  unlockAudio: () => void;
  hasActivePointer: (pointerId: number) => boolean;
  onPointerHit: (pointerId: number, hit: { a: boolean; b: boolean; x: boolean; y: boolean }) => void;
  onPointerRelease: (pointerId: number) => void;
}): void {
  const { container, signal, unlockAudio, hasActivePointer, onPointerHit, onPointerRelease } = params;

  const updatePointer = (pointerId: number, clientX: number, clientY: number) => {
    const loc = localDeltaFromCenter(container, clientX, clientY);
    const nx = loc.dx / Math.max(1, loc.halfW);
    const ny = loc.dy / Math.max(1, loc.halfH);
    onPointerHit(pointerId, resolveAbxyClusterHit(nx, ny));
  };

  container.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      unlockAudio();
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic environments lacking pointer capture
      }
      updatePointer(e.pointerId, e.clientX, e.clientY);
    },
    { signal },
  );

  container.addEventListener(
    'pointermove',
    (e) => {
      if (!hasActivePointer(e.pointerId)) return;
      updatePointer(e.pointerId, e.clientX, e.clientY);
    },
    { signal },
  );

  const release = (e: PointerEvent) => {
    onPointerRelease(e.pointerId);
  };
  container.addEventListener('pointerup', release, { signal });
  container.addEventListener('pointercancel', release, { signal });
  container.addEventListener('lostpointercapture', release, { signal });
}

export function buildSlideDpadSurface(params: {
  signal: AbortSignal;
  getDeadzoneMode: () => DpadDeadzoneMode;
  getPadInput: () => Record<PadDir, boolean>;
  setPadInput: (next: Record<PadDir, boolean>) => void;
  unlockAudio: () => void;
  playTactile: (profile: TactileSwitchProfile, phase: TactilePhase, side?: 'left' | 'right') => void;
  triggerRecoil: (side: 'left' | 'right') => void;
  onSync: () => void;
}): { element: HTMLElement; buttons: Record<PadDir, HTMLButtonElement> } {
  const pad = el('div', 'diamond is-dpad');
  const upBtn = btn('dia-btn dia-n', '▲', '上');
  const leftBtn = btn('dia-btn dia-w', '◀', '左');
  const rightBtn = btn('dia-btn dia-e', '▶', '右');
  const downBtn = btn('dia-btn dia-s', '▼', '下');
  const pivot = el('span', 'dpad-pivot');
  pivot.setAttribute('aria-hidden', 'true');
  pad.append(upBtn, leftBtn, pivot, rightBtn, downBtn);

  const buttons: Record<PadDir, HTMLButtonElement> = {
    up: upBtn,
    left: leftBtn,
    right: rightBtn,
    down: downBtn,
  };

  const applyAt = (cx: number, cy: number) => {
    const loc = localDeltaFromCenter(pad, cx, cy);
    const dx = loc.dx / Math.max(1, loc.halfW);
    const dy = loc.dy / Math.max(1, loc.halfH);
    const prev = { ...params.getPadInput() };
    const nextDirs = classifyDpadOctant(dx, dy, params.getDeadzoneMode());
    const nextState: Record<PadDir, boolean> = {
      left: nextDirs.left,
      right: nextDirs.right,
      up: nextDirs.up,
      down: nextDirs.down,
    };
    params.setPadInput(nextState);

    let pressedNew = false;
    let releasedOld = false;
    for (const dir of DIRS) {
      if (nextState[dir] && !prev[dir]) {
        pressedNew = true;
        triggerImpactRing(buttons[dir]);
      } else if (!nextState[dir] && prev[dir]) {
        releasedOld = true;
      }
    }

    if (pressedNew) {
      pulseHaptic(8, 'click', 'left', true);
      params.playTactile('dpad', 'down', 'left');
      params.triggerRecoil('left');
    } else if (releasedOld) {
      params.playTactile('dpad', 'up', 'left');
    }
    params.onSync();
  };

  bindPointerDrag(pad, {
    signal: params.signal,
    onStart: (e) => {
      params.unlockAudio();
      applyAt(e.clientX, e.clientY);
    },
    onMove: (e) => applyAt(e.clientX, e.clientY),
    onEnd: () => {
      const cur = params.getPadInput();
      const hadAny = cur.left || cur.right || cur.up || cur.down;
      params.setPadInput({ left: false, right: false, up: false, down: false });
      if (hadAny) params.playTactile('dpad', 'up', 'left');
      params.onSync();
    },
  });

  return { element: pad, buttons };
}

export function buildAnalogStickControl(opts: {
  className: string;
  side: 'left' | 'right';
  signal: AbortSignal;
  isDynamicOrigin: () => boolean;
  getStickCurveMode: () => StickCurveMode;
  unlockAudio: () => void;
  playTactile: (profile: TactileSwitchProfile, phase: TactilePhase, side?: 'left' | 'right') => void;
  onVector: (shapedX: number, shapedY: number, shapedMag: number) => void;
  onReset: () => void;
  onSync: () => void;
  registerResetter: (fn: () => void) => void;
}): HTMLElement {
  const base = el('div', opts.className);
  const knob = el('div', 'stick-knob');
  base.appendChild(knob);

  const maxTravelPx = 15;
  const maxOriginShiftPx = 7;
  const snapFilter = new AntiSnapbackFilter();
  let originX = 0;
  let originY = 0;
  let wasGated = false;

  const resetVisual = () => {
    wasGated = false;
    originX = 0;
    originY = 0;
    snapFilter.reset();
    base.classList.remove('is-active', 'is-gated', 'is-floating');
    base.style.removeProperty('--stick-ox');
    base.style.removeProperty('--stick-oy');
    knob.style.transform = '';
  };
  opts.registerResetter(resetVisual);

  const apply = (cx: number, cy: number, isInitialTouch = false) => {
    const loc = localDeltaFromCenter(base, cx, cy);
    let dx = loc.dx;
    let dy = loc.dy;

    if (opts.isDynamicOrigin()) {
      const floating = updateFloatingStickOrigin(
        originX,
        originY,
        loc.dx,
        loc.dy,
        maxTravelPx,
        maxOriginShiftPx,
        isInitialTouch,
      );
      originX = floating.originX;
      originY = floating.originY;
      dx = floating.deltaX;
      dy = floating.deltaY;
      const shifted = Math.hypot(originX, originY) > 1.2;
      base.classList.toggle('is-floating', shifted);
      base.style.setProperty('--stick-ox', `${originX.toFixed(1)}px`);
      base.style.setProperty('--stick-oy', `${originY.toFixed(1)}px`);
    } else {
      originX = 0;
      originY = 0;
      base.classList.remove('is-floating');
      const lenRaw = Math.hypot(dx, dy);
      if (lenRaw > maxTravelPx) {
        dx = (dx / lenRaw) * maxTravelPx;
        dy = (dy / lenRaw) * maxTravelPx;
      }
    }

    const len = Math.hypot(dx, dy);
    const isGated = len >= maxTravelPx * 0.86;
    const visX = Math.max(-maxTravelPx, Math.min(maxTravelPx, originX * 0.35 + dx));
    const visY = Math.max(-maxTravelPx, Math.min(maxTravelPx, originY * 0.35 + dy));
    knob.style.transform = `translate(${visX.toFixed(1)}px, ${visY.toFixed(1)}px)`;

    const shaped = shapeAnalogStickVector(dx / maxTravelPx, dy / maxTravelPx, {
      deadzone: 0.16,
      curveMode: opts.getStickCurveMode(),
      cardinalSnapDeg: opts.side === 'left' ? 5 : 0,
    });
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const clean = snapFilter.filter(shaped.x, shaped.y, nowMs);
    opts.onVector(clean.x, clean.y, Math.hypot(clean.x, clean.y));

    base.classList.toggle('is-gated', isGated);
    if (isGated && !wasGated) {
      pulseHaptic(5, 'tap', opts.side, true);
      opts.playTactile('stick', 'down', opts.side);
    }
    wasGated = isGated;
    opts.onSync();
  };

  bindPointerDrag(base, {
    signal: opts.signal,
    onStart: (e) => {
      opts.unlockAudio();
      pulseHaptic(7, 'tap', opts.side, true);
      opts.playTactile('stick', 'down', opts.side);
      base.classList.add('is-active');
      apply(e.clientX, e.clientY, true);
    },
    onMove: (e) => apply(e.clientX, e.clientY, false),
    onEnd: () => {
      resetVisual();
      opts.onReset();
      opts.playTactile('stick', 'up', opts.side);
      opts.onSync();
    },
  });

  return base;
}
