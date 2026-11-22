import { appLogger } from '../runtime/AppLogger.ts';
import type { FeedbackPreset, SimEvent } from '../types/WorldTypes.ts';
import { MAX_ENTITIES } from './SoaEntityPool.ts';
import type { TweenEase } from './TweenSystem.ts';

export const MAX_VM_OPS_PER_TICK = 512;
export const MAX_VM_SIGNALS_PER_TICK = 32;
export const ENTITY_LOCAL_VAR_SLOTS = 8;

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
export type VmVarOp = '=' | '+=' | '-=' | '*=' | '/=' | 'clamp';

export interface VmCondition {
  varName: string;
  op: VmCompareOp;
  value: number;
  /** Optional second variable name (`global`, `self.x`, `other.x`) overriding literal `value`. */
  valueVar?: string;
}

export type VmTrigger =
  | { type: 'OnStart' }
  | { type: 'OnEvery'; intervalTicks: number }
  | { type: 'OnCollide'; sourceTag: string; targetTag: string }
  | { type: 'OnButton'; button: VmButtonId; edge?: VmButtonEdge }
  | { type: 'OnVar'; varName: string; op: VmCompareOp; value: number; valueVar?: string; edge?: boolean }
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
  | {
      type: 'SetVar';
      name: string;
      op: VmVarOp;
      value: number;
      /** Optional RHS variable name (`global`, `self.k`, `other.k`) for var-to-var arithmetic. */
      valueVar?: string;
      min?: number;
      max?: number;
    }
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
  /** Logical combinator for `if` conditions: `'all'` (AND, default) or `'any'` (OR). */
  ifMode?: 'all' | 'any';
  do: readonly VmAction[];
  /** Optional branch executed when `when` triggers and `if` evaluates to false. */
  else?: readonly VmAction[];
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
  emitSignal?(signal: string, selfSlot?: number, otherSlot?: number): void;
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
 * Engine 5.0 Deterministic, bounded Event-Action VM (`When -> If (AND/OR) -> Do / Else`) with zero string evaluation.
 * Supports global vars, per-entity local vars (`self.<name>`, `other.<name>`), var-to-var arithmetic,
 * and signal slot context preservation while enforcing `MAX_VM_OPS_PER_TICK = 512`.
 */
export class EventActionVm {
  private readonly vars = new Map<string, number>();
  private readonly entityLocalKeyIds = new Map<string, number>();
  private readonly entityLocalBank = new Float32Array(MAX_ENTITIES * ENTITY_LOCAL_VAR_SLOTS);
  private nextEntityLocalKey = 0;

  private prevVarConds = new Uint8Array(64);
  private rules: readonly VmRule[] = [];
  private tickCount = 0;
  private startFired = false;
  private budgetExceededWarned = false;
  private opsThisTick = 0;
  private abortedThisTick = false;
  private readonly stepResult = { opsExecuted: 0, abortedByBudget: false };
  private readonly signalQueue: string[] = new Array<string>(MAX_VM_SIGNALS_PER_TICK).fill('');
  private readonly signalSelfSlots = new Int16Array(MAX_VM_SIGNALS_PER_TICK).fill(-1);
  private readonly signalOtherSlots = new Int16Array(MAX_VM_SIGNALS_PER_TICK).fill(-1);
  private signalHead = 0;
  private signalTail = 0;
  private signalCount = 0;

  public loadRules(rules: readonly VmRule[], initialVars?: Record<string, number>): void {
    this.rules = rules;
    this.vars.clear();
    this.entityLocalKeyIds.clear();
    this.entityLocalBank.fill(0);
    this.nextEntityLocalKey = 0;
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

  public clearEntityVars(slot: number): void {
    if (slot < 0 || slot >= MAX_ENTITIES) return;
    const base = slot * ENTITY_LOCAL_VAR_SLOTS;
    this.entityLocalBank.fill(0, base, base + ENTITY_LOCAL_VAR_SLOTS);
  }

  private resolveLocalKeySlot(key: string, createIfMissing: boolean): number {
    const existing = this.entityLocalKeyIds.get(key);
    if (existing !== undefined) return existing;
    if (!createIfMissing || this.nextEntityLocalKey >= ENTITY_LOCAL_VAR_SLOTS) return -1;
    const idx = this.nextEntityLocalKey++;
    this.entityLocalKeyIds.set(key, idx);
    return idx;
  }

  public getEntityVar(slot: number, key: string, fallback = 0): number {
    if (slot < 0 || slot >= MAX_ENTITIES) return fallback;
    const idx = this.resolveLocalKeySlot(key, false);
    if (idx < 0) return fallback;
    return this.entityLocalBank[slot * ENTITY_LOCAL_VAR_SLOTS + idx];
  }

  public setEntityVar(slot: number, key: string, value: number): void {
    if (slot < 0 || slot >= MAX_ENTITIES || !Number.isFinite(value)) return;
    const idx = this.resolveLocalKeySlot(key, true);
    if (idx < 0) return;
    this.entityLocalBank[slot * ENTITY_LOCAL_VAR_SLOTS + idx] = value;
  }

  private readScopedVar(name: string, selfSlot: number, otherSlot: number, fallback = 0): number {
    if (name.startsWith('self.')) {
      return this.getEntityVar(selfSlot, name.slice(5), fallback);
    }
    if (name.startsWith('other.')) {
      return this.getEntityVar(otherSlot, name.slice(6), fallback);
    }
    return this.vars.get(name) ?? fallback;
  }

  private writeScopedVar(name: string, value: number, selfSlot: number, otherSlot: number): void {
    if (!Number.isFinite(value)) return;
    if (name.startsWith('self.')) {
      this.setEntityVar(selfSlot, name.slice(5), value);
      return;
    }
    if (name.startsWith('other.')) {
      this.setEntityVar(otherSlot, name.slice(6), value);
      return;
    }
    this.vars.set(name, value);
  }

  public clearSignals(): void {
    this.signalHead = 0;
    this.signalTail = 0;
    this.signalCount = 0;
    this.signalQueue.fill('');
    this.signalSelfSlots.fill(-1);
    this.signalOtherSlots.fill(-1);
  }

  public emitSignal(signal: string, selfSlot = -1, otherSlot = -1): boolean {
    if (!signal || this.signalCount >= MAX_VM_SIGNALS_PER_TICK) {
      return false;
    }
    this.signalQueue[this.signalTail] = signal;
    this.signalSelfSlots[this.signalTail] = selfSlot;
    this.signalOtherSlots[this.signalTail] = otherSlot;
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

  private evalConditions(
    conditions: readonly VmCondition[] | undefined,
    ifMode: 'all' | 'any' | undefined,
    selfSlot: number,
    otherSlot: number,
  ): boolean {
    if (!conditions || conditions.length === 0) return true;
    const isAny = ifMode === 'any';
    for (let i = 0; i < conditions.length; i++) {
      const c = conditions[i];
      const lhs = this.readScopedVar(c.varName, selfSlot, otherSlot, 0);
      const rhs = c.valueVar ? this.readScopedVar(c.valueVar, selfSlot, otherSlot, c.value) : c.value;
      const passed = evalCompare(lhs, c.op, rhs);
      if (isAny && passed) return true;
      if (!isAny && !passed) return false;
    }
    return !isAny;
  }

  private executeRuleBranch(
    host: VmHostBridge,
    rule: VmRule,
    selfSlot: number,
    otherSlot: number,
  ): boolean {
    if (this.evalConditions(rule.if, rule.ifMode, selfSlot, otherSlot)) {
      return this.executeActions(host, rule.do, selfSlot, otherSlot);
    }
    if (rule.else && rule.else.length > 0) {
      return this.executeActions(host, rule.else, selfSlot, otherSlot);
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
          const cur = this.readScopedVar(act.name, selfSlot, otherSlot, 0);
          const rhs = act.valueVar ? this.readScopedVar(act.valueVar, selfSlot, otherSlot, act.value) : act.value;
          let next = cur;
          if (act.op === '=') next = rhs;
          else if (act.op === '+=') next = cur + rhs;
          else if (act.op === '-=') next = cur - rhs;
          else if (act.op === '*=') next = cur * rhs;
          else if (act.op === '/=') next = Math.abs(rhs) > 1e-6 ? cur / rhs : cur;
          else if (act.op === 'clamp') next = cur + rhs;
          if (act.min !== undefined && next < act.min) next = act.min;
          if (act.max !== undefined && next > act.max) next = act.max;
          this.writeScopedVar(act.name, next, selfSlot, otherSlot);
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
          this.emitSignal(act.signal, selfSlot, otherSlot);
          host.emitSignal?.(act.signal, selfSlot, otherSlot);
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
        if (!this.startFired) {
          if (!this.executeRuleBranch(host, rule, -1, -1)) break;
        }
      } else if (w.type === 'OnEvery') {
        const iv = Math.max(1, Math.floor(w.intervalTicks));
        if (this.tickCount % iv === 0) {
          if (!this.executeRuleBranch(host, rule, -1, -1)) break;
        }
      } else if (w.type === 'OnButton') {
        if (host.isButton(w.button, w.edge ?? 'pressed')) {
          if (!this.executeRuleBranch(host, rule, -1, -1)) break;
        }
      } else if (w.type === 'OnVar') {
        const rhs = w.valueVar ? this.getVar(w.valueVar, w.value) : w.value;
        const cond = evalCompare(this.getVar(w.varName), w.op, rhs);
        const wasTrue = this.prevVarConds[r] === 1;
        this.prevVarConds[r] = cond ? 1 : 0;
        const shouldFire = w.edge ? cond && !wasTrue : cond;
        if (shouldFire) {
          if (!this.executeRuleBranch(host, rule, -1, -1)) break;
        }
      } else if (w.type === 'OnCollide') {
        for (let c = 0; c < collisionCount; c++) {
          const cp = collisions[c];
          if (cp.selfTag === w.sourceTag && cp.otherTag === w.targetTag) {
            if (!this.executeRuleBranch(host, rule, cp.selfSlot, cp.otherSlot)) break;
          } else if (cp.otherTag === w.sourceTag && cp.selfTag === w.targetTag) {
            if (!this.executeRuleBranch(host, rule, cp.otherSlot, cp.selfSlot)) break;
          }
        }
      }
    }

    // Drain circular signal queue while preserving originating selfSlot / otherSlot context
    let signalsProcessed = 0;
    while (
      this.signalCount > 0 &&
      signalsProcessed < MAX_VM_SIGNALS_PER_TICK &&
      !this.abortedThisTick
    ) {
      const sig = this.signalQueue[this.signalHead];
      const sigSelf = this.signalSelfSlots[this.signalHead];
      const sigOther = this.signalOtherSlots[this.signalHead];
      this.signalQueue[this.signalHead] = '';
      this.signalSelfSlots[this.signalHead] = -1;
      this.signalOtherSlots[this.signalHead] = -1;
      this.signalHead = (this.signalHead + 1) % MAX_VM_SIGNALS_PER_TICK;
      this.signalCount--;
      signalsProcessed++;

      for (let r = 0; r < this.rules.length; r++) {
        if (this.abortedThisTick) break;
        const rule = this.rules[r];
        if (rule.when.type === 'OnSignal' && rule.when.signal === sig) {
          if (!this.executeRuleBranch(host, rule, sigSelf, sigOther)) break;
        }
      }
    }

    this.startFired = true;
    this.stepResult.opsExecuted = this.opsThisTick;
    this.stepResult.abortedByBudget = this.abortedThisTick;
    return this.stepResult;
  }
}
