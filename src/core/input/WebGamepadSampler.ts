import { createEmptyInputState, type InputState } from '../types/WorldTypes.ts';
import {
  AntiSnapbackFilter,
  shapeAnalogStickVector,
  stickVectorToDirections,
  type PadDirection,
  type StickCurveMode,
} from './StickShaper.ts';

export interface GamepadJustPressedState {
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  l: boolean;
  r: boolean;
  zl: boolean;
  zr: boolean;
  l3: boolean;
  r3: boolean;
  dpadLeft: boolean;
  dpadRight: boolean;
  dpadUp: boolean;
  dpadDown: boolean;
  minus: boolean;
  plus: boolean;
}

export interface GamepadPollResult {
  connected: boolean;
  label: string | null;
  gamepad: Gamepad | null;
  input: InputState;
  justPressed: GamepadJustPressedState;
}

function emptyJustPressed(): GamepadJustPressedState {
  return {
    a: false,
    b: false,
    x: false,
    y: false,
    l: false,
    r: false,
    zl: false,
    zr: false,
    l3: false,
    r3: false,
    dpadLeft: false,
    dpadRight: false,
    dpadUp: false,
    dpadDown: false,
    minus: false,
    plus: false,
  };
}

function resetInputState(dst: InputState): void {
  dst.left = false;
  dst.right = false;
  dst.up = false;
  dst.down = false;
  dst.jump = false;
  dst.action = false;
  dst.skillX = false;
  dst.skillY = false;
  dst.shoulderL = false;
  dst.shoulderR = false;
  dst.restart = false;
  dst.rightStickX = 0;
  dst.rightStickY = 0;
  dst.pointerX = 0;
  dst.pointerY = 0;
  dst.pointerActive = false;
  dst.pointerPrimary = false;
  dst.pointerSecondary = false;
}

function resetJustPressed(dst: GamepadJustPressedState): void {
  dst.a = false;
  dst.b = false;
  dst.x = false;
  dst.y = false;
  dst.l = false;
  dst.r = false;
  dst.zl = false;
  dst.zr = false;
  dst.l3 = false;
  dst.r3 = false;
  dst.dpadLeft = false;
  dst.dpadRight = false;
  dst.dpadUp = false;
  dst.dpadDown = false;
  dst.minus = false;
  dst.plus = false;
}

const ZL_HOLD_RESTART_MS = 420;
const SAMPLER_RING_SIZE = 8;
const SAMPLER_RING_MASK = SAMPLER_RING_SIZE - 1;

/**
 * Standard-gamepad sampler with shaped radial left/right analog curves, anti-snapback protection,
 * full ABXY + D-Pad + L/R/ZL/ZR + L3/R3 mapping, safe held-ZL restart guard, and per-button edges.
 */
export class WebGamepadSampler {
  private readonly prevState: GamepadJustPressedState = emptyJustPressed();
  private readonly prevLeftStickDirs: Record<PadDirection, boolean> = {
    left: false,
    right: false,
    up: false,
    down: false,
  };
  private readonly resultRing: GamepadPollResult[];
  private resultCursor = 0;
  private readonly leftSnapFilter = new AntiSnapbackFilter();
  private readonly rightSnapFilter = new AntiSnapbackFilter();
  private stickCurveMode: StickCurveMode = 'standard';
  private activePadIndex: number | null = null;
  private lastRumblePad: Gamepad | null = null;
  private zlHeldSinceMs = -1;
  private zlFiredThisHold = false;
  private readonly clock: () => number;
  private readonly gamepadReader?: () => (Gamepad | null)[];

  constructor(opts?: { clock?: () => number; gamepadReader?: () => (Gamepad | null)[] }) {
    this.clock = opts?.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.gamepadReader = opts?.gamepadReader;
    this.resultRing = Array.from({ length: SAMPLER_RING_SIZE }, () => ({
      connected: false,
      label: null,
      gamepad: null,
      input: createEmptyInputState(),
      justPressed: emptyJustPressed(),
    }));
  }

  public setStickCurveMode(mode: StickCurveMode): void {
    this.stickCurveMode = mode;
  }

  public getStickCurveMode(): StickCurveMode {
    return this.stickCurveMode;
  }

  private isPadButtonActive(pad: Gamepad, idx: number): boolean {
    const b = pad.buttons[idx];
    if (!b) return false;
    return Boolean(b.pressed || (b.value ?? 0) > 0.35);
  }

  private clearDisconnectedState(): void {
    resetJustPressed(this.prevState);
    this.prevLeftStickDirs.left = false;
    this.prevLeftStickDirs.right = false;
    this.prevLeftStickDirs.up = false;
    this.prevLeftStickDirs.down = false;
    this.leftSnapFilter.reset();
    this.rightSnapFilter.reset();
    this.zlHeldSinceMs = -1;
    this.zlFiredThisHold = false;
    this.lastRumblePad = null;
  }

  public sample(): GamepadPollResult {
    const res = this.resultRing[this.resultCursor];
    this.resultCursor = (this.resultCursor + 1) & SAMPLER_RING_MASK;
    res.connected = false;
    res.label = null;
    res.gamepad = null;
    resetInputState(res.input);
    resetJustPressed(res.justPressed);

    let pads: ArrayLike<Gamepad | null> | null = null;
    if (this.gamepadReader) {
      pads = this.gamepadReader();
    } else {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
        return res;
      }
      try {
        pads = navigator.getGamepads();
      } catch {
        return res;
      }
    }
    if (!pads) {
      this.clearDisconnectedState();
      return res;
    }

    let pad: Gamepad | null = null;
    if (this.activePadIndex !== null && this.activePadIndex >= 0 && this.activePadIndex < pads.length) {
      const candidate = pads[this.activePadIndex] ?? null;
      if (candidate && candidate.connected) pad = candidate;
    }
    if (!pad) {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) {
          pad = p;
          break;
        }
      }
      this.activePadIndex = pad ? pad.index : null;
    }

    if (!pad) {
      this.clearDisconnectedState();
      return res;
    }

    res.connected = true;
    res.label = pad.id;
    res.gamepad = pad;
    this.lastRumblePad = pad;

    const nowMs = this.clock();

    // Shaped Left Analog Stick with Anti-Snapback + Hysteresis
    const shapedL = shapeAnalogStickVector(pad.axes[0] ?? 0, pad.axes[1] ?? 0, {
      deadzone: 0.17,
      curveMode: this.stickCurveMode,
    });
    const cleanL = this.leftSnapFilter.filter(shapedL.x, shapedL.y, nowMs);
    const lStickDirs = stickVectorToDirections(cleanL.x, cleanL.y, this.prevLeftStickDirs);
    this.prevLeftStickDirs.left = lStickDirs.left;
    this.prevLeftStickDirs.right = lStickDirs.right;
    this.prevLeftStickDirs.up = lStickDirs.up;
    this.prevLeftStickDirs.down = lStickDirs.down;

    const dpadUp = this.isPadButtonActive(pad, 12);
    const dpadDown = this.isPadButtonActive(pad, 13);
    const dpadLeft = this.isPadButtonActive(pad, 14);
    const dpadRight = this.isPadButtonActive(pad, 15);

    res.input.left = dpadLeft || lStickDirs.left;
    res.input.right = dpadRight || lStickDirs.right;
    res.input.up = dpadUp || lStickDirs.up;
    res.input.down = dpadDown || lStickDirs.down;

    // Shaped Right Analog Stick with Anti-Snapback
    const shapedR = shapeAnalogStickVector(pad.axes[2] ?? 0, pad.axes[3] ?? 0, {
      deadzone: 0.19,
      curveMode: this.stickCurveMode,
      cardinalSnapDeg: 0,
    });
    const cleanR = this.rightSnapFilter.filter(shapedR.x, shapedR.y, nowMs);
    res.input.rightStickX = cleanR.x;
    res.input.rightStickY = cleanR.y;

    // Standard Face, Bumper, Analog Trigger & Stick Click Mapping
    const bBtn = this.isPadButtonActive(pad, 0); // Bottom (Switch B = jump)
    const aBtn = this.isPadButtonActive(pad, 1); // Right (Switch A = action)
    const yBtn = this.isPadButtonActive(pad, 2); // Left (Switch Y = skillY)
    const xBtn = this.isPadButtonActive(pad, 3); // Top (Switch X = skillX)
    const lBtn = this.isPadButtonActive(pad, 4);
    const rBtn = this.isPadButtonActive(pad, 5);
    const zlBtn = this.isPadButtonActive(pad, 6);
    const zrBtn = this.isPadButtonActive(pad, 7);
    const minusBtn = this.isPadButtonActive(pad, 8);
    const plusBtn = this.isPadButtonActive(pad, 9);
    const l3Btn = this.isPadButtonActive(pad, 10);
    const r3Btn = this.isPadButtonActive(pad, 11);

    res.input.jump = bBtn;
    res.input.action = aBtn || zrBtn;
    res.input.skillY = yBtn;
    res.input.skillX = xBtn;
    res.input.shoulderL = lBtn;
    res.input.shoulderR = rBtn;

    // Safe ZL restart guard: require 420ms continuous hold to trigger restart once
    if (zlBtn) {
      if (this.zlHeldSinceMs < 0) {
        this.zlHeldSinceMs = nowMs;
        this.zlFiredThisHold = false;
      } else if (!this.zlFiredThisHold && nowMs - this.zlHeldSinceMs >= ZL_HOLD_RESTART_MS) {
        this.zlFiredThisHold = true;
        res.input.restart = true;
      }
    } else {
      this.zlHeldSinceMs = -1;
      this.zlFiredThisHold = false;
    }

    const jp = res.justPressed;
    const prev = this.prevState;
    jp.a = aBtn && !prev.a;
    jp.b = bBtn && !prev.b;
    jp.x = xBtn && !prev.x;
    jp.y = yBtn && !prev.y;
    jp.l = lBtn && !prev.l;
    jp.r = rBtn && !prev.r;
    jp.zl = zlBtn && !prev.zl;
    jp.zr = zrBtn && !prev.zr;
    jp.l3 = l3Btn && !prev.l3;
    jp.r3 = r3Btn && !prev.r3;
    jp.dpadLeft = dpadLeft && !prev.dpadLeft;
    jp.dpadRight = dpadRight && !prev.dpadRight;
    jp.dpadUp = dpadUp && !prev.dpadUp;
    jp.dpadDown = dpadDown && !prev.dpadDown;
    jp.minus = minusBtn && !prev.minus;
    jp.plus = plusBtn && !prev.plus;

    prev.a = aBtn;
    prev.b = bBtn;
    prev.x = xBtn;
    prev.y = yBtn;
    prev.l = lBtn;
    prev.r = rBtn;
    prev.zl = zlBtn;
    prev.zr = zrBtn;
    prev.l3 = l3Btn;
    prev.r3 = r3Btn;
    prev.dpadLeft = dpadLeft;
    prev.dpadRight = dpadRight;
    prev.dpadUp = dpadUp;
    prev.dpadDown = dpadDown;
    prev.minus = minusBtn;
    prev.plus = plusBtn;

    return res;
  }

  public getActiveActuator(): GamepadHapticActuator | null {
    const pad = this.lastRumblePad as (Gamepad & { vibrationActuator?: GamepadHapticActuator }) | null;
    if (!pad || !pad.connected) return null;
    return pad.vibrationActuator ?? null;
  }
}
