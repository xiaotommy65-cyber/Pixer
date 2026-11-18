import type { InputState } from '../types/WorldTypes.ts';
import {
  classifyDpadOctant,
  resolveAbxyClusterHit,
  type DpadDeadzoneMode,
} from './DpadClusterMath.ts';
import {
  AntiSnapbackFilter,
  shapeAnalogStickVector,
  stickVectorToDirections,
  updateFloatingStickOrigin,
  type AnalogStickShapeOptions,
  type PadDirection,
  type ShapedStickVector,
  type StickCurveMode,
} from './StickShaper.ts';
import {
  WebGamepadSampler,
  type GamepadJustPressedState,
  type GamepadPollResult,
} from './WebGamepadSampler.ts';

export {
  AntiSnapbackFilter,
  WebGamepadSampler,
  classifyDpadOctant,
  resolveAbxyClusterHit,
  shapeAnalogStickVector,
  stickVectorToDirections,
  updateFloatingStickOrigin,
};
export type {
  AnalogStickShapeOptions,
  DpadDeadzoneMode,
  GamepadJustPressedState,
  GamepadPollResult,
  PadDirection,
  ShapedStickVector,
  StickCurveMode,
};

export type LatchedButtonKey = 'jump' | 'action' | 'skillX' | 'skillY' | 'shoulderL' | 'shoulderR';

const LATCHED_KEYS: readonly LatchedButtonKey[] = [
  'jump',
  'action',
  'skillX',
  'skillY',
  'shoulderL',
  'shoulderR',
];

/**
 * Pure input aggregator incorporating:
 * 1) Last-Input-Priority SOCD cleaning for cardinal movement.
 * 2) Sub-frame edge latch + 100ms pre-input prediction window across jump/action/X/Y/L/R.
 * 3) Optional touch hold-autofire pulse (8Hz) for ergonomic single-thumb combo/spark holds.
 */
export class InputPipeline {
  private seq = 0;
  private dirPressedSeq: Record<PadDirection, number> = {
    left: 0,
    right: 0,
    up: 0,
    down: 0,
  };
  private prevRawDirs: Record<PadDirection, boolean> = {
    left: false,
    right: false,
    up: false,
    down: false,
  };

  private latched: Record<LatchedButtonKey, boolean> = {
    jump: false,
    action: false,
    skillX: false,
    skillY: false,
    shoulderL: false,
    shoulderR: false,
  };
  private prevButtons: Record<LatchedButtonKey, boolean> = {
    jump: false,
    action: false,
    skillX: false,
    skillY: false,
    shoulderL: false,
    shoulderR: false,
  };
  private predictUntil: Record<LatchedButtonKey, number> = {
    jump: 0,
    action: 0,
    skillX: 0,
    skillY: 0,
    shoulderL: 0,
    shoulderR: 0,
  };

  private autofireStartAction = 0;
  private readonly clock: () => number;

  constructor(clock?: () => number) {
    this.clock = clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /** Records edge timestamps whenever raw directional/action inputs change. */
  public observeRaw(raw: InputState): void {
    const dirs: PadDirection[] = ['left', 'right', 'up', 'down'];
    for (const dir of dirs) {
      if (raw[dir] && !this.prevRawDirs[dir]) {
        this.seq += 1;
        this.dirPressedSeq[dir] = this.seq;
      } else if (!raw[dir]) {
        this.dirPressedSeq[dir] = 0;
      }
      this.prevRawDirs[dir] = raw[dir];
    }

    const now = this.clock();
    for (const key of LATCHED_KEYS) {
      if (raw[key] && !this.prevButtons[key]) {
        this.latched[key] = true;
        this.predictUntil[key] = now + 100;
        if (key === 'action') this.autofireStartAction = now;
      } else if (!raw[key] && key === 'action') {
        this.autofireStartAction = 0;
      }
      this.prevButtons[key] = raw[key];
    }
  }

  /**
   * Produces a SOCD-cleaned, sub-frame latched InputState for the simulation step.
   */
  public resolve(
    raw: InputState,
    consumeLatches = false,
    opts?: { touchAutofire?: boolean; touchActionHeld?: boolean },
  ): InputState {
    this.observeRaw(raw);

    let left = raw.left;
    let right = raw.right;
    if (left && right) {
      if (this.dirPressedSeq.right >= this.dirPressedSeq.left) {
        left = false;
        right = true;
      } else {
        left = true;
        right = false;
      }
    }

    let up = raw.up;
    let down = raw.down;
    if (up && down) {
      if (this.dirPressedSeq.down >= this.dirPressedSeq.up) {
        up = false;
        down = true;
      } else {
        up = true;
        down = false;
      }
    }

    const now = this.clock();
    let actionVal = raw.action || this.latched.action || now <= this.predictUntil.action;

    // Optional ergonomic touch autofire assist (~7.7Hz pulse when touch Action held > 140ms)
    if (opts?.touchAutofire && opts.touchActionHeld && this.autofireStartAction > 0) {
      const heldMs = now - this.autofireStartAction;
      if (heldMs > 140) {
        const phase = (heldMs - 140) % 130;
        actionVal = phase < 75;
      }
    }

    const jumpVal = raw.jump || this.latched.jump || now <= this.predictUntil.jump;
    const skillXVal = raw.skillX || this.latched.skillX || now <= this.predictUntil.skillX;
    const skillYVal = raw.skillY || this.latched.skillY || now <= this.predictUntil.skillY;
    const shoulderLVal = raw.shoulderL || this.latched.shoulderL || now <= this.predictUntil.shoulderL;
    const shoulderRVal = raw.shoulderR || this.latched.shoulderR || now <= this.predictUntil.shoulderR;

    if (consumeLatches) {
      for (const key of LATCHED_KEYS) {
        this.latched[key] = false;
        if (!raw[key]) this.predictUntil[key] = 0;
      }
    }

    return {
      left,
      right,
      up,
      down,
      jump: jumpVal,
      action: actionVal,
      skillX: skillXVal,
      skillY: skillYVal,
      shoulderL: shoulderLVal,
      shoulderR: shoulderRVal,
      restart: raw.restart,
      rightStickX: raw.rightStickX,
      rightStickY: raw.rightStickY,
    };
  }

  public hasPredictionActive(): { jump: boolean; action: boolean } {
    const now = this.clock();
    return {
      jump: this.latched.jump || now <= this.predictUntil.jump,
      action: this.latched.action || now <= this.predictUntil.action,
    };
  }

  public reset(): void {
    this.dirPressedSeq = { left: 0, right: 0, up: 0, down: 0 };
    this.prevRawDirs = { left: false, right: false, up: false, down: false };
    for (const key of LATCHED_KEYS) {
      this.latched[key] = false;
      this.prevButtons[key] = false;
      this.predictUntil[key] = 0;
    }
    this.autofireStartAction = 0;
  }
}
