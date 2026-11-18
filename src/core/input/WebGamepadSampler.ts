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

const ZL_HOLD_RESTART_MS = 420;

/**
 * Standard-gamepad sampler with shaped radial left/right analog curves, anti-snapback protection,
 * full ABXY + D-Pad + L/R/ZL/ZR + L3/R3 mapping, safe held-ZL restart guard, and per-button edges.
 */
export class WebGamepadSampler {
  private prevState: GamepadJustPressedState = emptyJustPressed();
  private prevLeftStickDirs: Record<PadDirection, boolean> = {
    left: false,
    right: false,
    up: false,
    down: false,
  };
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
  }

  public setStickCurveMode(mode: StickCurveMode): void {
    this.stickCurveMode = mode;
  }

  public getStickCurveMode(): StickCurveMode {
    return this.stickCurveMode;
  }

  public sample(): GamepadPollResult {
    const res: GamepadPollResult = {
      connected: false,
      label: null,
      gamepad: null,
      input: createEmptyInputState(),
      justPressed: emptyJustPressed(),
    };

    let pads: (Gamepad | null)[] = [];
    if (this.gamepadReader) {
      pads = this.gamepadReader();
    } else {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
        return res;
      }
      try {
        pads = Array.from(navigator.getGamepads() ?? []);
      } catch {
        return res;
      }
    }

    let pad: Gamepad | null = null;
    if (this.activePadIndex !== null) {
      const candidate = pads[this.activePadIndex] ?? null;
      if (candidate && candidate.connected) pad = candidate;
    }
    if (!pad) {
      pad = pads.find((p) => Boolean(p && p.connected)) ?? null;
      this.activePadIndex = pad ? pad.index : null;
    }

    if (!pad) {
      this.prevState = emptyJustPressed();
      this.prevLeftStickDirs = { left: false, right: false, up: false, down: false };
      this.leftSnapFilter.reset();
      this.rightSnapFilter.reset();
      this.zlHeldSinceMs = -1;
      this.zlFiredThisHold = false;
      this.lastRumblePad = null;
      return res;
    }

    res.connected = true;
    res.label = pad.id;
    res.gamepad = pad;
    this.lastRumblePad = pad;

    const nowMs = this.clock();
    const btnActive = (idx: number): boolean => {
      const b = pad?.buttons[idx];
      if (!b) return false;
      return Boolean(b.pressed || (b.value ?? 0) > 0.35);
    };

    // Shaped Left Analog Stick with Anti-Snapback + Hysteresis
    const shapedL = shapeAnalogStickVector(pad.axes[0] ?? 0, pad.axes[1] ?? 0, {
      deadzone: 0.17,
      curveMode: this.stickCurveMode,
    });
    const cleanL = this.leftSnapFilter.filter(shapedL.x, shapedL.y, nowMs);
    const lStickDirs = stickVectorToDirections(cleanL.x, cleanL.y, this.prevLeftStickDirs);
    this.prevLeftStickDirs = lStickDirs;

    const dpadUp = btnActive(12);
    const dpadDown = btnActive(13);
    const dpadLeft = btnActive(14);
    const dpadRight = btnActive(15);

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
    const bBtn = btnActive(0); // Bottom (Switch B = jump)
    const aBtn = btnActive(1); // Right (Switch A = action)
    const yBtn = btnActive(2); // Left (Switch Y = skillY)
    const xBtn = btnActive(3); // Top (Switch X = skillX)
    const lBtn = btnActive(4);
    const rBtn = btnActive(5);
    const zlBtn = btnActive(6);
    const zrBtn = btnActive(7);
    const minusBtn = btnActive(8);
    const plusBtn = btnActive(9);
    const l3Btn = btnActive(10);
    const r3Btn = btnActive(11);

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

    const curr: GamepadJustPressedState = {
      a: aBtn,
      b: bBtn,
      x: xBtn,
      y: yBtn,
      l: lBtn,
      r: rBtn,
      zl: zlBtn,
      zr: zrBtn,
      l3: l3Btn,
      r3: r3Btn,
      dpadLeft,
      dpadRight,
      dpadUp,
      dpadDown,
      minus: minusBtn,
      plus: plusBtn,
    };

    res.justPressed = {
      a: curr.a && !this.prevState.a,
      b: curr.b && !this.prevState.b,
      x: curr.x && !this.prevState.x,
      y: curr.y && !this.prevState.y,
      l: curr.l && !this.prevState.l,
      r: curr.r && !this.prevState.r,
      zl: curr.zl && !this.prevState.zl,
      zr: curr.zr && !this.prevState.zr,
      l3: curr.l3 && !this.prevState.l3,
      r3: curr.r3 && !this.prevState.r3,
      dpadLeft: curr.dpadLeft && !this.prevState.dpadLeft,
      dpadRight: curr.dpadRight && !this.prevState.dpadRight,
      dpadUp: curr.dpadUp && !this.prevState.dpadUp,
      dpadDown: curr.dpadDown && !this.prevState.dpadDown,
      minus: curr.minus && !this.prevState.minus,
      plus: curr.plus && !this.prevState.plus,
    };
    this.prevState = curr;

    return res;
  }

  public getActiveActuator(): GamepadHapticActuator | null {
    const pad = this.lastRumblePad as (Gamepad & { vibrationActuator?: GamepadHapticActuator }) | null;
    if (!pad || !pad.connected) return null;
    return pad.vibrationActuator ?? null;
  }
}
