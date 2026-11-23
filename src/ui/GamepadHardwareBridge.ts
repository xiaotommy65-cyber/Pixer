import type { TactilePhase, TactileSwitchProfile } from '../core/audio/ExternalAudioBank.ts';
import type { GamepadJustPressedState, WebGamepadSampler } from '../core/input/InputPipeline.ts';
import type { HapticProfile, HapticSide } from '../core/hal/HapticEngine.ts';
import type { InputState } from '../core/types/WorldTypes.ts';
import { triggerImpactRing } from './dom.ts';

export type PadDir = 'left' | 'right' | 'up' | 'down';
const DIRS: readonly PadDir[] = ['left', 'right', 'up', 'down'];

export interface HardwareBridgeCallbacks {
  unlockAudio: () => void;
  playTactile: (profile: TactileSwitchProfile, phase: TactilePhase, side?: HapticSide) => void;
  triggerRecoil: (side: 'left' | 'right') => void;
  triggerHaptic?: (profile: HapticProfile, side: HapticSide, skipAcoustic?: boolean) => void;
  onGamepadConnectionChange?: (connected: boolean, label: string | null) => void;
  onEscapeKey?: () => boolean;
  onConfirmKey?: () => boolean;
  onHomeKey?: () => void;
  onCycleCardHotkey?: () => void;
  onDebugToggle: () => void;
  onCartridgeSlotKey: (index: number) => void;
  onEjectKey: () => void;
  onShmupHotkey?: (cmd: 'bomb' | 'cycle_weapon' | 'launch_sortie') => void;
  onChronicleHotkey?: (cmd: 'toggle_pause' | 'cast_relic' | 'use_potion') => void;
  isInputBlocked: () => boolean;
}

export interface HardwareBridgeRefs {
  dpadBtns: Record<PadDir, HTMLButtonElement> | null;
  btnA: HTMLButtonElement | null;
  btnB: HTMLButtonElement | null;
  btnX: HTMLButtonElement | null;
  btnY: HTMLButtonElement | null;
  btnL: HTMLButtonElement | null;
  btnR: HTMLButtonElement | null;
}

export function fireSideTactileCue(
  cb: HardwareBridgeCallbacks,
  tactile: TactileSwitchProfile,
  haptic: HapticProfile,
  side: 'left' | 'right',
  ringEl?: HTMLElement | null,
): void {
  cb.unlockAudio();
  cb.playTactile(tactile, 'down', side);
  cb.triggerHaptic?.(haptic, side, true);
  cb.triggerRecoil(side);
  if (ringEl) triggerImpactRing(ringEl);
}

export function emitGamepadEdgeCues(
  jp: GamepadJustPressedState,
  cb: HardwareBridgeCallbacks,
  refs: HardwareBridgeRefs,
): void {
  if (jp.dpadLeft) fireSideTactileCue(cb, 'dpad', 'tap', 'left', refs.dpadBtns?.left);
  if (jp.dpadRight) fireSideTactileCue(cb, 'dpad', 'tap', 'left', refs.dpadBtns?.right);
  if (jp.dpadUp) fireSideTactileCue(cb, 'dpad', 'tap', 'left', refs.dpadBtns?.up);
  if (jp.dpadDown) fireSideTactileCue(cb, 'dpad', 'tap', 'left', refs.dpadBtns?.down);

  if (jp.b) fireSideTactileCue(cb, 'face', 'click', 'right', refs.btnB);
  if (jp.a) fireSideTactileCue(cb, 'face', 'click', 'right', refs.btnA);
  if (jp.x) fireSideTactileCue(cb, 'face', 'click', 'right', refs.btnX);
  if (jp.y) fireSideTactileCue(cb, 'face', 'click', 'right', refs.btnY);

  if (jp.l) fireSideTactileCue(cb, 'bumper', 'click', 'left', refs.btnL);
  if (jp.r) fireSideTactileCue(cb, 'bumper', 'click', 'right', refs.btnR);
  if (jp.zl) fireSideTactileCue(cb, 'bumper', 'thump', 'left', refs.btnL);
  if (jp.zr) fireSideTactileCue(cb, 'bumper', 'click', 'right', refs.btnR);

  if (jp.l3) fireSideTactileCue(cb, 'stick', 'thump', 'left');
  if (jp.r3) fireSideTactileCue(cb, 'stick', 'thump', 'right');

  if (jp.minus) {
    fireSideTactileCue(cb, 'system', 'tap', 'left');
    cb.onCycleCardHotkey?.();
  }
  if (jp.plus) {
    fireSideTactileCue(cb, 'system', 'tap', 'right');
    cb.onChronicleHotkey?.('toggle_pause');
    cb.onShmupHotkey?.('launch_sortie');
  }
}

export function installGamepadConnectionListeners(
  signal: AbortSignal,
  sampler: WebGamepadSampler,
  onConnected: (id: string) => void,
  onAllDisconnected: () => void,
): void {
  if (typeof window === 'undefined') return;
  window.addEventListener(
    'gamepadconnected',
    (e) => {
      const gp = (e as GamepadEvent).gamepad;
      onConnected(gp?.id ?? 'Gamepad');
    },
    { signal },
  );
  window.addEventListener(
    'gamepaddisconnected',
    () => {
      if (!sampler.sample().connected) {
        onAllDisconnected();
      }
    },
    { signal },
  );
}

export function installKeyboardListeners(params: {
  signal: AbortSignal;
  cb: HardwareBridgeCallbacks;
  getKeyInput: () => InputState;
  getRefs: () => HardwareBridgeRefs;
  onObserved: () => void;
  onBlurReset: () => void;
}): void {
  if (typeof window === 'undefined') return;
  const { signal, cb, getKeyInput, getRefs, onObserved, onBlurReset } = params;

  const emitKeyEdge = (
    active: boolean,
    prev: boolean,
    tactileProfile: 'dpad' | 'face' | 'bumper',
    hapticProfile: HapticProfile,
    side: HapticSide,
    btnEl: HTMLElement | null,
  ) => {
    const audioSide: 'left' | 'right' = side === 'left' ? 'left' : 'right';
    if (active && !prev) {
      cb.playTactile(tactileProfile, 'down', side);
      cb.triggerHaptic?.(hapticProfile, side, true);
      if (btnEl) triggerImpactRing(btnEl);
      cb.triggerRecoil(audioSide);
    } else if (!active && prev) {
      cb.playTactile(tactileProfile, 'up', side);
    }
  };

  const handle = (e: KeyboardEvent, down: boolean) => {
    const target = e.target as HTMLElement | null;
    const inEditable = Boolean(target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'));
    const isHidden = cb.isInputBlocked();
    if (down && (inEditable || isHidden)) return;
    const k = getKeyInput();
    const prev: InputState = { ...k };
    let matched = true;
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        k.left = down;
        break;
      case 'ArrowRight':
      case 'KeyD':
        k.right = down;
        break;
      case 'ArrowUp':
      case 'KeyW':
        k.up = down;
        break;
      case 'ArrowDown':
      case 'KeyS':
        k.down = down;
        break;
      case 'Space':
      case 'KeyZ':
      case 'KeyJ':
        k.jump = down;
        break;
      case 'KeyX':
      case 'KeyK':
        k.action = down;
        break;
      case 'KeyI':
        k.skillX = down;
        break;
      case 'KeyU':
        k.skillY = down;
        break;
      case 'BracketLeft':
        k.shoulderL = down;
        break;
      case 'BracketRight':
        k.shoulderR = down;
        break;
      case 'KeyR':
        k.restart = down;
        break;
      case 'F3':
        if (down && !e.repeat) {
          cb.playTactile('system', 'down', 'both');
          cb.onDebugToggle();
        }
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
        if (down && !e.repeat) {
          cb.onCartridgeSlotKey(Number(e.code.slice(-1)) - 1);
        }
        break;
      case 'KeyE':
        if (down && !e.repeat) cb.onEjectKey();
        break;
      case 'KeyV':
        if (down && !e.repeat) {
          cb.playTactile('system', 'down', 'right');
          cb.onShmupHotkey?.('bomb');
        }
        break;
      case 'KeyC':
        if (down && !e.repeat) {
          cb.playTactile('ui', 'down', 'right');
          cb.onShmupHotkey?.('cycle_weapon');
        }
        break;
      case 'Enter':
        if (down && !e.repeat) {
          cb.playTactile('system', 'down', 'right');
          if (!cb.onConfirmKey?.()) {
            cb.onShmupHotkey?.('launch_sortie');
          }
        }
        break;
      case 'Home':
        if (down && !e.repeat) {
          cb.playTactile('system', 'down', 'right');
          cb.onHomeKey?.();
        }
        break;
      case 'Escape':
        if (down && !e.repeat) {
          cb.playTactile('system', 'down', 'both');
          if (!cb.onEscapeKey?.()) {
            cb.onChronicleHotkey?.('toggle_pause');
          }
        }
        break;
      case 'Tab':
      case 'KeyP':
        if (down && !e.repeat) {
          cb.playTactile('system', 'down', 'right');
          cb.onChronicleHotkey?.('toggle_pause');
        }
        break;
      case 'KeyQ':
        if (down && !e.repeat) {
          cb.playTactile('ui', 'down', 'right');
          cb.onChronicleHotkey?.('cast_relic');
        }
        break;
      case 'KeyH':
        if (down && !e.repeat) {
          cb.playTactile('ui', 'down', 'right');
          cb.onChronicleHotkey?.('use_potion');
        }
        break;
      default:
        matched = false;
    }

    if (matched) {
      if (down) {
        cb.unlockAudio();
        e.preventDefault();
      } else if (!inEditable && !isHidden) {
        e.preventDefault();
      }

      if (!inEditable && !isHidden) {
        const refs = getRefs();
        for (const dir of DIRS) {
          emitKeyEdge(k[dir], prev[dir], 'dpad', 'tap', 'left', refs.dpadBtns?.[dir] ?? null);
        }
        const faceBindings: ['jump' | 'action' | 'skillX' | 'skillY', HTMLButtonElement | null][] = [
          ['jump', refs.btnB],
          ['action', refs.btnA],
          ['skillX', refs.btnX],
          ['skillY', refs.btnY],
        ];
        for (const [bKey, bEl] of faceBindings) {
          emitKeyEdge(k[bKey], prev[bKey], 'face', 'click', 'right', bEl);
        }
        emitKeyEdge(k.shoulderL, prev.shoulderL, 'bumper', 'click', 'left', refs.btnL);
        emitKeyEdge(k.shoulderR, prev.shoulderR, 'bumper', 'click', 'right', refs.btnR);
      }

      onObserved();
    }
  };

  window.addEventListener('keydown', (e) => handle(e, true), { signal });
  window.addEventListener('keyup', (e) => handle(e, false), { signal });
  window.addEventListener('blur', onBlurReset, { signal });
}
