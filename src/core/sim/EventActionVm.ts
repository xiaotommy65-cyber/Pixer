import { appLogger } from '../runtime/AppLogger.ts';
import type { FeedbackPreset, SimEvent } from '../types/WorldTypes.ts';
import type { TweenEase } from './TweenSystem.ts';

export const MAX_VM_OPS_PER_TICK = 512;
export const MAX_VM_SIGNALS_PER_TICK = 32;

export const MULTIGENRE_VAR_DEFAULTS: Readonly<Record<'combo' | 'mana' | 'p1Hp' | 'p2Hp' | 'turn' | 'switches', number>> = {
  combo: 0,
  mana: 3,
  p1Hp: 100,
  p2Hp: 100,
  turn: 1,
  switches: 0,
};

export type VmCompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type VmButtonId = 'jump' | 'action' | 'skillX' | 'skillY' | 'shoulderL' | 'shoulderR';
export type VmButtonEdge = 'pressed' | 'held' | 'released';
export type VmVarOp = '=' | '+=' | '-=' | 'clamp';

export interface VmCondition {
  varName: string;
  op: VmCompareOp;
  value: number;
}

export type VmTrigger =
  | { type: 'OnStart' }
  | { type: 'OnEvery'; intervalTicks: number }
  | { type: 'OnCollide'; sourceTag: string; targetTag: string }
  | { type: 'OnButton'; button: VmButtonId; edge?: VmButtonEdge }
  | { type: 'OnVar'; varName: string; op: VmCompareOp; value: number; edge?: boolean }
  | { type: 'OnSignal'; signal: string };

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
  | { type: 'EndGame'; outcome: 'won' | 'lost' | 'nextStage'; targetStage?: number }
  | { type: 'EmitSignal'; signal: string }
  | {
      type: 'FloatText';
      text: string;
      color?: string;
      anchor?: 'player' | 'self' | 'other' | 'world';
      x?: number;
      y?: number;
    }
  | { type: 'TweenVar'; name: string; to: number; duration: number; ease?: TweenEase };

export interface VmRule {
  id?: string;
  when: VmTrigger;
  if?: readonly VmCondition[];
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
  emitSignal?(signal: string): void;
  floatText?(
    text: string,
    color: string | undefined,
    anchor: 'player' | 'self' | 'other' | 'world',
    x: number,
    y: number,
    selfSlot: number,
    otherSlot: number,
  ): void;
  tweenVar?(name: string, to: number, duration: number, ease: TweenEase): void;
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
 * Deterministic, bounded Event-Action VM (`When -> If -> Do`) with zero string evaluation.
 * Enforces `MAX_VM_OPS_PER_TICK = 512` and `MAX_VM_SIGNALS_PER_TICK = 32` to guard against recursive loops.
 */
export class EventActionVm {
  private readonly vars = new Map<string, number>();
  private prevVarConds = new Uint8Array(64);
  private rules: readonly VmRule[] = [];
  private tickCount = 0;
  private startFired = false;
  private budgetExceededWarned = false;
  private opsThisTick = 0;
  private abortedThisTick = false;
  private readonly stepResult = { opsExecuted: 0, abortedByBudget: false };
  private readonly signalQueue: string[] = new Array<string>(MAX_VM_SIGNALS_PER_TICK).fill('');
  private signalHead = 0;
  private signalTail = 0;
  private signalCount = 0;

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
    this.clearSignals();
    if (initialVars) {
      for (const [k, v] of Object.entries(initialVars)) {
        if (Number.isFinite(v)) this.vars.set(k, v);
      }
    }
  }

  public resetKeepVars(): void {
    this.prevVarConds.fill(0);
    this.tickCount = 0;
    this.startFired = false;
    this.budgetExceededWarned = false;
    this.clearSignals();
  }

  public clearSignals(): void {
    this.signalHead = 0;
    this.signalTail = 0;
    this.signalCount = 0;
    this.signalQueue.fill('');
  }

  public emitSignal(signal: string): boolean {
    if (!signal || this.signalCount >= MAX_VM_SIGNALS_PER_TICK) {
      return false;
    }
    this.signalQueue[this.signalTail] = signal;
    this.signalTail = (this.signalTail + 1) % MAX_VM_SIGNALS_PER_TICK;
    this.signalCount++;
    return true;
  }

  public getSignalQueue(): readonly string[] {
    return this.signalQueue;
  }

  public getPendingSignalCount(): number {
    return this.signalCount;
  }

  public hasVar(name: string): boolean {
    return this.vars.has(name);
  }

  public getVar(name: string, fallback = 0): number {
    return this.vars.get(name) ?? fallback;
  }

  public setVar(name: string, value: number): void {
    if (Number.isFinite(value)) this.vars.set(name, value);
  }

  public exportVars(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.vars) out[k] = v;
    return out;
  }

  private evalConditions(conditions: readonly VmCondition[] | undefined): boolean {
    if (!conditions || conditions.length === 0) return true;
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      if (!evalCompare(this.getVar(c.varName), c.op, c.value)) {
        return false;
      }
    }
    return true;
  }

  private executeActions(
    host: VmHostBridge,
    actions: readonly VmAction[],
    selfSlot: number,
    otherSlot: number,
  ): boolean {
    for (let a = 0; a < actions.length; a++) {
      if (this.opsThisTick >= MAX_VM_OPS_PER_TICK) {
        this.abortedThisTick = true;
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
      this.opsThisTick++;
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
          else if (act.op === 'clamp') next = cur + act.value;
          if (act.min !== undefined && next < act.min) next = act.min;
          if (act.max !== undefined && next > act.max) next = act.max;
          if (Number.isFinite(next)) this.vars.set(act.name, next);
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
        case 'EmitSignal':
          this.emitSignal(act.signal);
          host.emitSignal?.(act.signal);
          break;
        case 'FloatText':
          host.floatText?.(
            act.text,
            act.color,
            act.anchor ?? 'player',
            act.x ?? 0,
            act.y ?? 0,
            selfSlot,
            otherSlot,
          );
          break;
        case 'TweenVar':
          host.tweenVar?.(act.name, act.to, act.duration, act.ease ?? 'quadOut');
          break;
      }
    }
    return true;
  }

  public stepTick(
    host: VmHostBridge,
    collisions: readonly VmCollisionPair[],
    collisionCount: number,
  ): { opsExecuted: number; abortedByBudget: boolean } {
    this.tickCount++;
    this.opsThisTick = 0;
    this.abortedThisTick = false;

    for (let r = 0; r < this.rules.length; r++) {
      if (this.abortedThisTick) break;
      const rule = this.rules[r];
      const w = rule.when;

      if (w.type === 'OnSignal') {
        continue;
      } else if (w.type === 'OnStart') {
        if (!this.startFired && this.evalConditions(rule.if)) {
          if (!this.executeActions(host, rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnEvery') {
        const iv = Math.max(1, Math.floor(w.intervalTicks));
        if (this.tickCount % iv === 0 && this.evalConditions(rule.if)) {
          if (!this.executeActions(host, rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnButton') {
        if (host.isButton(w.button, w.edge ?? 'pressed') && this.evalConditions(rule.if)) {
          if (!this.executeActions(host, rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnVar') {
        const cond = evalCompare(this.getVar(w.varName), w.op, w.value);
        const wasTrue = this.prevVarConds[r] === 1;
        this.prevVarConds[r] = cond ? 1 : 0;
        const shouldFire = w.edge ? cond && !wasTrue : cond;
        if (shouldFire && this.evalConditions(rule.if)) {
          if (!this.executeActions(host, rule.do, -1, -1)) break;
        }
      } else if (w.type === 'OnCollide') {
        for (let c = 0; c < collisionCount; c++) {
          const cp = collisions[c];
          if (cp.selfTag === w.sourceTag && cp.otherTag === w.targetTag) {
            if (this.evalConditions(rule.if) && !this.executeActions(host, rule.do, cp.selfSlot, cp.otherSlot)) break;
          } else if (cp.otherTag === w.sourceTag && cp.selfTag === w.targetTag) {
            if (this.evalConditions(rule.if) && !this.executeActions(host, rule.do, cp.otherSlot, cp.selfSlot)) break;
          }
        }
      }
    }

    // Drain circular signal queue up to MAX_VM_SIGNALS_PER_TICK signals per tick
    let signalsProcessed = 0;
    while (
      this.signalCount > 0 &&
      signalsProcessed < MAX_VM_SIGNALS_PER_TICK &&
      !this.abortedThisTick
    ) {
      const sig = this.signalQueue[this.signalHead];
      this.signalQueue[this.signalHead] = '';
      this.signalHead = (this.signalHead + 1) % MAX_VM_SIGNALS_PER_TICK;
      this.signalCount--;
      signalsProcessed++;

      for (let r = 0; r < this.rules.length; r++) {
        if (this.abortedThisTick) break;
        const rule = this.rules[r];
        if (rule.when.type === 'OnSignal' && rule.when.signal === sig && this.evalConditions(rule.if)) {
          if (!this.executeActions(host, rule.do, -1, -1)) break;
        }
      }
    }

    this.startFired = true;
    this.stepResult.opsExecuted = this.opsThisTick;
    this.stepResult.abortedByBudget = this.abortedThisTick;
    return this.stepResult;
  }
}
