import { createEmptyInputState, type InputState } from '../core/types/WorldTypes.ts';
import type { PadDir } from './GamepadHardwareBridge.ts';
import { triggerImpactRing } from './dom.ts';

export type TouchButtonKey =
  | 'jump'
  | 'action'
  | 'skillX'
  | 'skillY'
  | 'shoulderL'
  | 'shoulderR'
  | 'restart';

export interface AbxyClusterFlags {
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
}

export interface VisualGamepadRefs {
  dpadEl: HTMLElement | null;
  dpadBtns: Record<PadDir, HTMLButtonElement> | null;
  btnA: HTMLButtonElement | null;
  btnB: HTMLButtonElement | null;
  btnX: HTMLButtonElement | null;
  btnY: HTMLButtonElement | null;
  btnL: HTMLButtonElement | null;
  btnR: HTMLButtonElement | null;
}

export function mergeRawGamepadInputs(
  touchInput: InputState,
  padInput: Record<PadDir, boolean>,
  keyInput: InputState,
  stickInput: Record<PadDir, boolean>,
  hwGamepadInput: InputState,
  rightStickAxis: { x: number; y: number },
): InputState {
  const touchRMag = Math.hypot(rightStickAxis.x, rightStickAxis.y);
  return {
    left: touchInput.left || padInput.left || keyInput.left || stickInput.left || hwGamepadInput.left,
    right: touchInput.right || padInput.right || keyInput.right || stickInput.right || hwGamepadInput.right,
    up: touchInput.up || padInput.up || keyInput.up || stickInput.up || hwGamepadInput.up,
    down: touchInput.down || padInput.down || keyInput.down || stickInput.down || hwGamepadInput.down,
    jump: touchInput.jump || keyInput.jump || hwGamepadInput.jump,
    action: touchInput.action || keyInput.action || hwGamepadInput.action,
    skillX: touchInput.skillX || keyInput.skillX || hwGamepadInput.skillX,
    skillY: touchInput.skillY || keyInput.skillY || hwGamepadInput.skillY,
    shoulderL: touchInput.shoulderL || keyInput.shoulderL || hwGamepadInput.shoulderL,
    shoulderR: touchInput.shoulderR || keyInput.shoulderR || hwGamepadInput.shoulderR,
    restart: touchInput.restart || keyInput.restart || hwGamepadInput.restart,
    rightStickX: touchRMag > 0.05 ? rightStickAxis.x : hwGamepadInput.rightStickX,
    rightStickY: touchRMag > 0.05 ? rightStickAxis.y : hwGamepadInput.rightStickY,
  };
}

export function hasAnyGamepadInput(h: InputState): boolean {
  return (
    h.left || h.right || h.up || h.down || h.jump || h.action || h.skillX || h.skillY ||
    h.shoulderL || h.shoulderR || h.restart ||
    Math.abs(h.rightStickX) > 0.01 || Math.abs(h.rightStickY) > 0.01
  );
}

export function hasGamepadInputChanged(prev: InputState, next: InputState): boolean {
  return (
    next.left !== prev.left || next.right !== prev.right || next.up !== prev.up || next.down !== prev.down ||
    next.jump !== prev.jump || next.action !== prev.action || next.skillX !== prev.skillX || next.skillY !== prev.skillY ||
    next.shoulderL !== prev.shoulderL || next.shoulderR !== prev.shoulderR || next.restart !== prev.restart ||
    Math.abs(next.rightStickX - prev.rightStickX) > 0.03 || Math.abs(next.rightStickY - prev.rightStickY) > 0.03
  );
}

export function mergeAbxyPointerCluster(
  abxyPointers: ReadonlyMap<number, AbxyClusterFlags>,
  prev: AbxyClusterFlags,
  refs: Pick<VisualGamepadRefs, 'btnA' | 'btnB' | 'btnX' | 'btnY'>,
): { next: AbxyClusterFlags; newlyPressed: boolean; releasedOld: boolean } {
  const next: AbxyClusterFlags = { a: false, b: false, x: false, y: false };
  for (const hit of abxyPointers.values()) {
    if (hit.a) next.a = true;
    if (hit.b) next.b = true;
    if (hit.x) next.x = true;
    if (hit.y) next.y = true;
  }

  let newlyPressed = false;
  let releasedOld = false;
  const pairs: [keyof AbxyClusterFlags, HTMLButtonElement | null][] = [
    ['a', refs.btnA],
    ['b', refs.btnB],
    ['x', refs.btnX],
    ['y', refs.btnY],
  ];
  for (const [k, btnEl] of pairs) {
    if (next[k] && !prev[k]) {
      newlyPressed = true;
      if (btnEl) triggerImpactRing(btnEl);
    } else if (!next[k] && prev[k]) {
      releasedOld = true;
    }
  }
  return { next, newlyPressed, releasedOld };
}

export function applyGamepadVisualState(refs: VisualGamepadRefs, resolved: InputState): void {
  if (!refs.dpadEl || !refs.dpadBtns) return;
  const l = resolved.left;
  const r = resolved.right;
  const u = resolved.up;
  const d = resolved.down;

  refs.dpadBtns.left.classList.toggle('is-pressed', l);
  refs.dpadBtns.right.classList.toggle('is-pressed', r);
  refs.dpadBtns.up.classList.toggle('is-pressed', u);
  refs.dpadBtns.down.classList.toggle('is-pressed', d);

  const ry = (r ? 10 : 0) - (l ? 10 : 0);
  const rx = (u ? 10 : 0) - (d ? 10 : 0);
  const tx = (r ? 1.5 : 0) - (l ? 1.5 : 0);
  const ty = (d ? 1.5 : 0) - (u ? 1.5 : 0);
  refs.dpadEl.style.setProperty('--dpad-rx', `${rx}deg`);
  refs.dpadEl.style.setProperty('--dpad-ry', `${ry}deg`);
  refs.dpadEl.style.setProperty('--dpad-tx', `${tx}px`);
  refs.dpadEl.style.setProperty('--dpad-ty', `${ty}px`);

  if (refs.btnB) refs.btnB.classList.toggle('is-pressed', resolved.jump);
  if (refs.btnA) refs.btnA.classList.toggle('is-pressed', resolved.action);
  if (refs.btnX) refs.btnX.classList.toggle('is-pressed', resolved.skillX);
  if (refs.btnY) refs.btnY.classList.toggle('is-pressed', resolved.skillY);
  if (refs.btnL) refs.btnL.classList.toggle('is-pressed', resolved.shoulderL);
  if (refs.btnR) refs.btnR.classList.toggle('is-pressed', resolved.shoulderR);
}

export function createIdlePadDirs(): Record<PadDir, boolean> {
  return { left: false, right: false, up: false, down: false };
}

export { createEmptyInputState };
