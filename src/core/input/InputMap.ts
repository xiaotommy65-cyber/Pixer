import { createEmptyInputState, type InputState } from '../types/WorldTypes.ts';

export type InputAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'action'
  | 'skillX'
  | 'skillY'
  | 'shoulderL'
  | 'shoulderR'
  | 'restart';

const ALL_ACTIONS: readonly InputAction[] = [
  'left',
  'right',
  'up',
  'down',
  'jump',
  'action',
  'skillX',
  'skillY',
  'shoulderL',
  'shoulderR',
  'restart',
];

/**
 * Engine-owned input abstraction providing held, edge triggers (justPressed / justReleased),
 * timed action buffering, and right-stick dual-analog axes without per-cartridge boilerplate.
 */
export class InputMap {
  private curr: InputState = createEmptyInputState();
  private prev: InputState = { ...this.curr };
  private buffers = new Map<InputAction, number>();

  public update(raw: InputState, dt: number): void {
    this.prev = { ...this.curr };
    this.curr = { ...raw };

    for (const action of ALL_ACTIONS) {
      const rem = (this.buffers.get(action) ?? 0) - dt;
      if (rem > 0) this.buffers.set(action, rem);
      else this.buffers.delete(action);

      if (this.justPressed(action)) {
        this.buffers.set(action, 0.13);
      }
    }
  }

  public held(action: InputAction): boolean {
    return this.curr[action];
  }

  public justPressed(action: InputAction): boolean {
    return this.curr[action] && !this.prev[action];
  }

  public justReleased(action: InputAction): boolean {
    return !this.curr[action] && this.prev[action];
  }

  public hasBuffered(action: InputAction): boolean {
    return (this.buffers.get(action) ?? 0) > 0;
  }

  public consumeBuffer(action: InputAction): boolean {
    if ((this.buffers.get(action) ?? 0) > 0) {
      this.buffers.delete(action);
      return true;
    }
    return false;
  }

  public primeBuffer(action: InputAction, sec = 0.13): void {
    this.buffers.set(action, sec);
  }

  public axisX(): number {
    return (this.curr.right ? 1 : 0) - (this.curr.left ? 1 : 0);
  }

  public axisY(): number {
    return (this.curr.down ? 1 : 0) - (this.curr.up ? 1 : 0);
  }

  public rightAxisX(): number {
    return this.curr.rightStickX;
  }

  public rightAxisY(): number {
    return this.curr.rightStickY;
  }
}
