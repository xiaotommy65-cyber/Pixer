import {
  InputPipeline,
  stickVectorToDirections,
  WebGamepadSampler,
  type DpadDeadzoneMode,
  type StickCurveMode,
} from '../core/input/InputPipeline.ts';
import { createEmptyInputState, type InputState } from '../core/types/WorldTypes.ts';
import {
  emitGamepadEdgeCues,
  installGamepadConnectionListeners,
  installKeyboardListeners,
  type HardwareBridgeCallbacks,
  type HardwareBridgeRefs,
  type PadDir,
} from './GamepadHardwareBridge.ts';
import {
  bindAbxyClusterSurface,
  buildAnalogStickControl,
  buildSlideDpadSurface,
} from './TouchControlsBuilder.ts';
import {
  applyGamepadVisualState,
  createIdlePadDirs,
  hasAnyGamepadInput,
  hasGamepadInputChanged,
  mergeAbxyPointerCluster,
  mergeRawGamepadInputs,
  type AbxyClusterFlags,
  type TouchButtonKey,
} from './TouchStateMerger.ts';
import { bindMomentaryButton, btn, pulseHaptic } from './dom.ts';

export type { PadDir, TouchButtonKey };
export type VirtualGamepadCallbacks = HardwareBridgeCallbacks;

/**
 * Unified physical/touch/keyboard/gamepad controller input aggregator:
 * merges polar-octant D-Pad, dynamic-origin curved analog sticks, ABXY diamond
 * thumb-roll surface, L/R bumpers, keyboard bindings, physical Web Gamepad mapping,
 * SOCD cleaning, and sub-frame prediction.
 */
export class VirtualGamepadInput {
  private readonly cb: VirtualGamepadCallbacks;
  private readonly pipeline = new InputPipeline();
  private readonly gamepadSampler = new WebGamepadSampler();
  private readonly ac = new AbortController();
  private readonly stickResetters: (() => void)[] = [];

  private dpadEl: HTMLElement | null = null;
  private dpadBtns: Record<PadDir, HTMLButtonElement> | null = null;
  private btnA: HTMLButtonElement | null = null;
  private btnB: HTMLButtonElement | null = null;
  private btnX: HTMLButtonElement | null = null;
  private btnY: HTMLButtonElement | null = null;
  private btnL: HTMLButtonElement | null = null;
  private btnR: HTMLButtonElement | null = null;

  private dpadDeadzoneMode: DpadDeadzoneMode = 'standard';
  private stickCurveMode: StickCurveMode = 'standard';
  private stickDynamicOrigin = true;
  private touchAutofire = false;
  private autofireBlockedByCartridge = false;
  private wasBlocked = false;

  private readonly touchButtonKeys = new Map<HTMLElement, TouchButtonKey>();
  private readonly abxyPointers = new Map<number, AbxyClusterFlags>();
  private touchCluster: AbxyClusterFlags = { a: false, b: false, x: false, y: false };

  private touchInput = createEmptyInputState();
  private padInput: Record<PadDir, boolean> = createIdlePadDirs();
  private keyInput = createEmptyInputState();
  private stickInput: Record<PadDir, boolean> = createIdlePadDirs();
  private rightStickAxis = { x: 0, y: 0 };
  private hwGamepadInput = createEmptyInputState();
  private lastHwConnected = false;

  constructor(callbacks: VirtualGamepadCallbacks) {
    this.cb = callbacks;
    installKeyboardListeners({
      signal: this.ac.signal,
      cb: this.cb,
      getKeyInput: () => this.keyInput,
      getRefs: () => this.getRefs(),
      onObserved: () => {
        this.pipeline.observeRaw(this.mergeRawInput());
        this.syncVisual();
      },
      onBlurReset: () => this.clearAllInputs(),
    });
    installGamepadConnectionListeners(
      this.ac.signal,
      this.gamepadSampler,
      (id) => {
        this.lastHwConnected = true;
        this.cb.onGamepadConnectionChange?.(true, id);
        this.cb.triggerHaptic?.('click', 'both', true);
      },
      () => {
        this.lastHwConnected = false;
        this.hwGamepadInput = createEmptyInputState();
        this.pipeline.observeRaw(this.mergeRawInput());
        this.cb.onGamepadConnectionChange?.(false, null);
        this.syncVisual();
      },
    );
  }

  private getRefs(): HardwareBridgeRefs {
    return {
      dpadBtns: this.dpadBtns,
      btnA: this.btnA,
      btnB: this.btnB,
      btnX: this.btnX,
      btnY: this.btnY,
      btnL: this.btnL,
      btnR: this.btnR,
    };
  }

  public destroy(): void {
    this.clearAllInputs();
    this.ac.abort();
    this.stickResetters.length = 0;
    this.dpadEl = null;
    this.dpadBtns = null;
    this.btnA = null;
    this.btnB = null;
    this.btnX = null;
    this.btnY = null;
    this.btnL = null;
    this.btnR = null;
  }

  /** Resets all active touch, stick, keyboard, and gamepad states (e.g. on blur or station switch). */
  public clearAllInputs(): void {
    this.touchButtonKeys.clear();
    this.abxyPointers.clear();
    this.touchCluster = { a: false, b: false, x: false, y: false };
    this.touchInput = createEmptyInputState();
    this.padInput = createIdlePadDirs();
    this.keyInput = createEmptyInputState();
    this.stickInput = createIdlePadDirs();
    this.rightStickAxis = { x: 0, y: 0 };
    this.hwGamepadInput = createEmptyInputState();
    for (const resetStick of this.stickResetters) resetStick();
    this.pipeline.reset();
    this.syncVisual();
  }

  private syncBlockedTransition(): boolean {
    const blocked = this.cb.isInputBlocked();
    if (blocked && !this.wasBlocked) this.clearAllInputs();
    this.wasBlocked = blocked;
    return blocked;
  }

  public setDpadDeadzoneMode(mode: DpadDeadzoneMode): void {
    this.dpadDeadzoneMode = mode;
  }
  public getDpadDeadzoneMode(): DpadDeadzoneMode {
    return this.dpadDeadzoneMode;
  }

  public setStickCurveMode(mode: StickCurveMode): void {
    this.stickCurveMode = mode;
    this.gamepadSampler.setStickCurveMode(mode);
  }
  public getStickCurveMode(): StickCurveMode {
    return this.stickCurveMode;
  }

  public setStickDynamicOrigin(enabled: boolean): void {
    this.stickDynamicOrigin = enabled;
  }
  public getStickDynamicOrigin(): boolean {
    return this.stickDynamicOrigin;
  }

  public setTouchAutofire(enabled: boolean): void {
    this.touchAutofire = enabled;
  }
  public getTouchAutofire(): boolean {
    return this.touchAutofire;
  }

  public setCartridgeAutofireBlocked(blocked: boolean): void {
    this.autofireBlockedByCartridge = blocked;
  }

  private mergeRawInput(): InputState {
    return mergeRawGamepadInputs(
      this.touchInput,
      this.padInput,
      this.keyInput,
      this.stickInput,
      this.hwGamepadInput,
      this.rightStickAxis,
    );
  }

  public getInput(consumeLatches = true): InputState {
    if (this.syncBlockedTransition()) return createEmptyInputState();
    return this.pipeline.resolve(this.mergeRawInput(), consumeLatches, {
      touchAutofire: this.touchAutofire && !this.autofireBlockedByCartridge,
      touchActionHeld: this.touchInput.action,
    });
  }

  public getActiveGamepadActuator(): GamepadHapticActuator | null {
    return this.gamepadSampler.getActiveActuator();
  }

  public pollGamepad(): void {
    const polled = this.gamepadSampler.sample();
    if (polled.connected !== this.lastHwConnected) {
      this.lastHwConnected = polled.connected;
      this.cb.onGamepadConnectionChange?.(polled.connected, polled.label);
    }

    if (this.syncBlockedTransition()) return;

    if (!polled.connected) {
      if (hasAnyGamepadInput(this.hwGamepadInput)) {
        this.hwGamepadInput = createEmptyInputState();
        this.pipeline.observeRaw(this.mergeRawInput());
        this.syncVisual();
      }
      return;
    }

    if (hasGamepadInputChanged(this.hwGamepadInput, polled.input)) {
      this.hwGamepadInput = polled.input;
      this.pipeline.observeRaw(this.mergeRawInput());
      this.syncVisual();
    }

    emitGamepadEdgeCues(polled.justPressed, this.cb, this.getRefs());
  }

  public bindShoulderRefs(refs: { l: HTMLButtonElement; r: HTMLButtonElement }): void {
    this.btnL = refs.l;
    this.btnR = refs.r;
  }

  public bindFaceRefs(refs: {
    a: HTMLButtonElement;
    b: HTMLButtonElement;
    x?: HTMLButtonElement;
    y: HTMLButtonElement;
  }): void {
    this.btnA = refs.a;
    this.btnB = refs.b;
    if (refs.x) this.btnX = refs.x;
    this.btnY = refs.y;
  }

  private hasExternalTouchKey(targetKey: TouchButtonKey): boolean {
    for (const activeKey of this.touchButtonKeys.values()) {
      if (activeKey === targetKey) return true;
    }
    return false;
  }

  private recomputeAbxyTouchState(): void {
    const { next, newlyPressed, releasedOld } = mergeAbxyPointerCluster(
      this.abxyPointers,
      this.touchCluster,
      { btnA: this.btnA, btnB: this.btnB, btnX: this.btnX, btnY: this.btnY },
    );

    this.touchCluster = next;
    this.touchInput.action = next.a || this.hasExternalTouchKey('action');
    this.touchInput.jump = next.b || this.hasExternalTouchKey('jump');
    this.touchInput.skillX = next.x || this.hasExternalTouchKey('skillX');
    this.touchInput.skillY = next.y || this.hasExternalTouchKey('skillY');

    this.pipeline.observeRaw(this.mergeRawInput());
    if (newlyPressed) {
      pulseHaptic(9, 'click', 'right', true);
      this.cb.playTactile('face', 'down', 'right');
      this.cb.triggerRecoil('right');
    } else if (releasedOld) {
      this.cb.playTactile('face', 'up', 'right');
    }
    this.syncVisual();
  }

  public bindAbxyCluster(
    container: HTMLElement,
    refs: { a: HTMLButtonElement; b: HTMLButtonElement; x: HTMLButtonElement; y: HTMLButtonElement },
  ): void {
    this.bindFaceRefs(refs);
    bindAbxyClusterSurface({
      container,
      signal: this.ac.signal,
      unlockAudio: () => this.cb.unlockAudio(),
      hasActivePointer: (pointerId) => this.abxyPointers.has(pointerId),
      onPointerHit: (pointerId, hit) => {
        this.abxyPointers.set(pointerId, hit);
        this.recomputeAbxyTouchState();
      },
      onPointerRelease: (pointerId) => {
        if (this.abxyPointers.delete(pointerId)) {
          this.recomputeAbxyTouchState();
        }
      },
    });
  }

  public buildSlideDpad(): HTMLElement {
    const built = buildSlideDpadSurface({
      signal: this.ac.signal,
      getDeadzoneMode: () => this.dpadDeadzoneMode,
      getPadInput: () => this.padInput,
      setPadInput: (next) => {
        this.padInput = next;
      },
      unlockAudio: () => this.cb.unlockAudio(),
      playTactile: (profile, phase, side) => this.cb.playTactile(profile, phase, side),
      triggerRecoil: (side) => this.cb.triggerRecoil(side),
      onSync: () => {
        this.pipeline.observeRaw(this.mergeRawInput());
        this.syncVisual();
      },
    });
    this.dpadEl = built.element;
    this.dpadBtns = built.buttons;
    return built.element;
  }

  public createHoldButton(
    cls: string,
    label: string,
    key: TouchButtonKey,
    title: string,
    profile: 'face' | 'bumper' = 'face',
    side: 'left' | 'right' = 'right',
  ): HTMLButtonElement {
    const b = btn(cls, label, title);
    bindMomentaryButton(
      b,
      () => {
        this.cb.unlockAudio();
        this.touchButtonKeys.set(b, key);
        pulseHaptic(profile === 'bumper' ? 11 : 9, 'click', side, true);
        this.cb.playTactile(profile, 'down', side);
        this.cb.triggerRecoil(side);
        this.touchInput[key] = true;
        this.pipeline.observeRaw(this.mergeRawInput());
        this.syncVisual();
      },
      () => {
        this.touchButtonKeys.delete(b);
        let stillHeld = this.hasExternalTouchKey(key);
        if (key === 'action') stillHeld = stillHeld || this.touchCluster.a;
        else if (key === 'jump') stillHeld = stillHeld || this.touchCluster.b;
        else if (key === 'skillX') stillHeld = stillHeld || this.touchCluster.x;
        else if (key === 'skillY') stillHeld = stillHeld || this.touchCluster.y;

        this.touchInput[key] = stillHeld;
        this.pipeline.observeRaw(this.mergeRawInput());
        this.cb.playTactile(profile, 'up', side);
        this.syncVisual();
      },
      this.ac.signal,
    );
    return b;
  }

  public buildLeftStick(): HTMLElement {
    return buildAnalogStickControl({
      className: 'stick',
      side: 'left',
      signal: this.ac.signal,
      isDynamicOrigin: () => this.stickDynamicOrigin,
      getStickCurveMode: () => this.stickCurveMode,
      unlockAudio: () => this.cb.unlockAudio(),
      playTactile: (profile, phase, side) => this.cb.playTactile(profile, phase, side),
      onVector: (sx, sy) => {
        this.stickInput = stickVectorToDirections(sx, sy, this.stickInput);
      },
      onReset: () => {
        this.stickInput = createIdlePadDirs();
      },
      onSync: () => {
        this.pipeline.observeRaw(this.mergeRawInput());
        this.syncVisual();
      },
      registerResetter: (fn) => this.stickResetters.push(fn),
    });
  }

  public buildRightStick(): HTMLElement {
    return buildAnalogStickControl({
      className: 'stick is-right-stick',
      side: 'right',
      signal: this.ac.signal,
      isDynamicOrigin: () => this.stickDynamicOrigin,
      getStickCurveMode: () => this.stickCurveMode,
      unlockAudio: () => this.cb.unlockAudio(),
      playTactile: (profile, phase, side) => this.cb.playTactile(profile, phase, side),
      onVector: (sx, sy) => {
        this.rightStickAxis = { x: sx, y: sy };
      },
      onReset: () => {
        this.rightStickAxis = { x: 0, y: 0 };
      },
      onSync: () => {
        this.pipeline.observeRaw(this.mergeRawInput());
        this.syncVisual();
      },
      registerResetter: (fn) => this.stickResetters.push(fn),
    });
  }

  public syncVisual(): void {
    const resolved = this.pipeline.resolve(this.mergeRawInput(), false, {
      touchAutofire: this.touchAutofire && !this.autofireBlockedByCartridge,
      touchActionHeld: this.touchInput.action,
    });
    applyGamepadVisualState(
      { dpadEl: this.dpadEl, ...this.getRefs() },
      resolved,
    );
  }
}
