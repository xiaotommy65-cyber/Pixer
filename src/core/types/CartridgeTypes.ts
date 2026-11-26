import type { BuiltinCartridgeId, CartridgeId } from './CartridgeId.ts';
import type { RpgHudSnapshot, RpgMenuOption } from './HudTypes.ts';
import type { InputState, RuntimeParams } from './InputTypes.ts';
import type { RenderSceneSnapshot, SimEvent } from './SceneTypes.ts';

export type { BuiltinCartridgeId, CartridgeId };

export type AiCapabilityFlag = 'stage-gen' | 'dialog' | 'sprite-gen' | 'tactical-advisor';

export type ScreenFilterMode = 'clean' | 'lcd' | 'crt';

export interface CartridgeMeta {
  id: CartridgeId;
  code: string;
  title: string;
  subtitle: string;
  genre: string;
  accentHex: string;
  badgeText: string;
  controlsHint: string;
  goalHint: string;
  defaultScript: string;
  /** When true, holding touch Action (A) stays continuous instead of rapid-pulsing under touch autofire. */
  preserveActionHold?: boolean;
  /** Marks a heavy legacy hand-written cartridge isolated into the lazy-loaded Classic Arcade Pack. */
  isLegacyPack?: boolean;
}

export interface CartridgeInstance {
  readonly scriptError?: string | null;
  prepareFixedStep?(): void;
  step(dt: number, input: InputState, params: RuntimeParams): SimEvent[];
  snapshot(params: RuntimeParams, alpha?: number): RenderSceneSnapshot;
  getStatus(): 'playing' | 'won' | 'lost';
  dispatchCommand?(commandId: string): SimEvent[];
  serializeSave?(): unknown;
  hydrateSave?(raw: unknown): boolean;
  retryStage?(): void;
  dispose?(): void;
}

export interface DebuggableCartridge extends CartridgeInstance {
  setDebugHitboxes(enabled: boolean): void;
}

export interface ComboTrackingCartridge extends CartridgeInstance {
  getComboCount(): number;
}

export interface TurnKernelContract {
  getStatus(): 'playing' | 'won' | 'lost';
  getObservation(): {
    combat?: RpgHudSnapshot['combat'];
  };
  getLegalActions(): RpgMenuOption[];
  suggestAgentAction(): string | null;
}

export interface TurnCapableCartridge extends CartridgeInstance {
  getKernel(): TurnKernelContract;
}

export function isDebuggableCartridge(inst: CartridgeInstance): inst is DebuggableCartridge {
  return typeof (inst as Partial<DebuggableCartridge>).setDebugHitboxes === 'function';
}

export function isComboTrackingCartridge(inst: CartridgeInstance): inst is ComboTrackingCartridge {
  return typeof (inst as Partial<ComboTrackingCartridge>).getComboCount === 'function';
}

export function isTurnCapableCartridge(inst: CartridgeInstance): inst is TurnCapableCartridge {
  return typeof (inst as Partial<TurnCapableCartridge>).getKernel === 'function';
}
