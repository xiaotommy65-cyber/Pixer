import { appLogger } from '../runtime/AppLogger.ts';
import type { FeedbackPreset, SimEvent } from '../types/WorldTypes.ts';

export const MAX_VM_OPS_PER_TICK = 512;

export type VmCompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type VmButtonId = 'jump' | 'action' | 'skillX' | 'skillY' | 'shoulderL' | 'shoulderR';
export type VmButtonEdge = 'pressed' | 'held' | 'released';
export type VmVarOp = '=' | '+=' | '-=' | 'clamp';

export type VmTrigger =
  | { type: 'OnStart' }
  | { type: 'OnEvery'; intervalTicks: number }
  | { type: 'OnCollide'; sourceTag: string; targetTag: string }
  | { type: 'OnButton'; button: VmButtonId; edge?: VmButtonEdge }
  | { type: 'OnVar'; varName: string; op: VmCompareOp; value: number; edge?: boolean };

export type VmAction =
  | {
      type: 'Spawn';
      archetypeId: string;
      anchor?: 'world' | 'self' | 'other' | 'player';
      x: number;
      y: number;
      vx?: number;
      vy?: number;
    }
  | { type: 'Destroy'; target: 'self' | 'other' | 'byTag'; tag?: string }
  | { type: 'Impulse'; target: 'self' | 'other' | 'player'; vx: number; vy: number; setVelocity?: boolean }
  | { type: 'SetVar'; name: string; op: VmVarOp; value: number; min?: number; max?: number }
  | { type: 'PlaySfx'; preset: SimEvent; comboVar?: string }
  | {
      type: 'Juice';
      preset?: FeedbackPreset;
      hitstopFrames?: number;
      trauma?: number;
      flashColor?: string;
      flashAlpha?: number;
      squashX?: number;
      squashY?: number;
    }
  | { type: 'EndGame'; outcome: 'won' | 'lost' | 'nextStage'; targetStage?: number };

export interface VmRule {
  id?: string;
  when: VmTrigger;
  do: readonly VmAction[];
}

export interface VmCollisionPair {
  selfSlot: number;
  otherSlot: number;
  selfTag: string;
  otherTag: string;
}

export interface VmHostBridge {
  isButton(button: VmButtonId, edge: VmButtonEdge): boolean;
  spawn(archetypeId: string, anchor: 'world' | 'self' | 'other' | 'player', x: number, y: number, vx: number, vy: number, selfSlot: number, otherSlot: number): void;
  destroy(target: 'self' | 'other' | 'byTag', tag: string | undefined, selfSlot: number, otherSlot: number): void;
  impulse(target: 'self' | 'other' | 'player', vx: number, vy: number, setVelocity: boolean, selfSlot: number, otherSlot: number): void;
  playSfx(preset: SimEvent): void;
  triggerJuice(action: Extract<VmAction, { type: 'Juice' }>, selfSlot: number): void;
  endGame(outcome: 'won' | 'lost' | 'nextStage', targetStage?: number): void;
}

function evalCompare(lhs: number, op: VmCompareOp, rhs: number): boolean {
  switch (op) {
    case '==':
      return lhs === rhs;
    case '!=':
      return lhs !== rhs;
    case '<':
      return lhs < rhs;
    case '<=':
      return lhs <= rhs;
    case '>':
      return lhs > rhs;
    case '>=':
      return lhs >= rhs;
  }
}

/**
 * Deterministic, bounded Event-Action VM (`When -> Do`) with zero string evaluation.
 * Enforces `MAX_VM_OPS_PER_TICK = 512` to guard against mutually recursive OnVar/OnCollide loops.
 */
export class EventActionVm {
  private readonly vars = new Map<string, number>();
  private prevVarConds = new Uint8Array(64);
  private rules: readonly VmRule[] = [];
  private tickCount = 0;
  private startFired = false;
  private budgetExceededWarned = false;

  public loadRules(rules: readonly VmRule[], initialVars?: Record<string, number>): void {
    this.rules = rules;
    this.vars.clear();
    if (rules.length > this.prevVarConds.length) {
      this.prevVarConds = new Uint8Array(rules.length);
    } else {
      this.prevVarConds.fill(0);
    }
    this.tickCount = 0;
    this.startFired = false;
    this.budgetExceededWarned = false;
    if (initialVars) {
      for (const [k, v] of Object.entries(initialVars)) {
        this.vars.set(k, v);
      }
    }
  }

  public resetKeepVars(): void {
    this.prevVarConds.fill(0);
    this.tickCount = 0;
    this.startFired = false;
    this.budgetExceededWarned = false;
  }

  public getVar(name: string, fallback = 0): number {
    return this.vars.get(name) ?? fallback;
  }

  public setVar(name: string, value: number): void {
    this.vars.set(name, value);
  }

  public exportVars(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.vars) out[k] = v;
    return out;
  }

  public stepTick(
    host: VmHostBridge,
    collisions: readonly VmCollisionPair[],
    collisionCount: number,
  ): { opsExecuted: number; abortedByBudget: boolean } {
    this.tickCount++;
    let ops = 0;
    let aborted = false;

    const runActions = (actions: readonly VmAction[], selfSlot: number, otherSlot: number): boolean => {
      for (let a = 0; a < actions.length; a++) {
        if (ops >= MAX_VM_OPS_PER_TICK) {
          aborted = true;
          if (!this.budgetExceededWarned) {
            this.budgetExceededWarned = true;
            appLogger.warn(
              'lifecycle',
              'vm.budgetExceeded',
              `Event-Action VM 單幀指令超過上限 (${MAX_VM_OPS_PER_TICK})，已強制中止剩餘規則`,
              { tickCount: this.tickCount },
            );
          }
          return false;
        }
        ops++;
        const act = actions[a];
        switch (act.type) {
          case 'Spawn':
            host.spawn(act.archetypeId, act.anchor ?? 'world', act.x, act.y, act.vx ?? 0, act.vy ?? 0, selfSlot, otherSlot);
            break;
          case 'Destroy':
            host.destroy(act.target, act.tag, selfSlot, otherSlot);
            break;
          case 'Impulse':
            host.impulse(act.target, act.vx, act.vy, act.setVelocity ?? false, selfSlot, otherSlot);
            break;
          case 'SetVar': {
            const cur = this.vars.get(act.name) ?? 0;
            let next = cur;
            if (act.op === '=') next = act.value;
            else if (act.op === '+=') next = cur + act.value;
            else if (act.op === '-=') next = cur - act.value;
            else if (act.op === 'clamp') {
              const lo = act.min ?? -Infinity;
              const hi = act.max ?? Infinity;
              next = Math.max(lo, Math.min(hi, cur + act.value));
            }
            this.vars.set(act.name, next);
            break;
          }
          case 'PlaySfx':
            host.playSfx(act.preset);
            break;
          case 'Juice':
            host.triggerJuice(act, selfSlot);
            break;
          case 'EndGame':
            host.endGame(act.outcome, act.targetStage);
            break;
        }
      }
      return true;
    };

    for (let r = 0; r < this.rules.length; r++) {
      if (aborted) break;
      const rule = this.rules[r];
      const w = rule.when;

      if (w.type === 'OnStart') {
        if (!this.startFired) {
          if (!runActions(rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnEvery') {
        const iv = Math.max(1, Math.floor(w.intervalTicks));
        if (this.tickCount % iv === 0) {
          if (!runActions(rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnButton') {
        if (host.isButton(w.button, w.edge ?? 'pressed')) {
          if (!runActions(rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnVar') {
        const cond = evalCompare(this.getVar(w.varName), w.op, w.value);
        const wasTrue = this.prevVarConds[r] === 1;
        this.prevVarConds[r] = cond ? 1 : 0;
        const shouldFire = w.edge ? cond && !wasTrue : cond;
        if (shouldFire) {
          if (!runActions(rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnCollide') {
        for (let c = 0; c < collisionCount; c++) {
          const cp = collisions[c];
          if (cp.selfTag === w.sourceTag && cp.otherTag === w.targetTag) {
            if (!runActions(rule.do, cp.selfSlot, cp.otherSlot)) break;
          } else if (cp.otherTag === w.sourceTag && cp.selfTag === w.targetTag) {
            if (!runActions(rule.do, cp.otherSlot, cp.selfSlot)) break;
          }
        }
      }
    }

    this.startFired = true;
    return { opsExecuted: ops, abortedByBudget: aborted };
  }
}
