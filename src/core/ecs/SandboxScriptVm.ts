import type { InputState, SimEvent } from '../types/WorldTypes.ts';
import { ECS_VAR_SLOTS } from './ComponentStore.ts';
import { INVALID_ENTITY, type EntityHandle } from './EntityManager.ts';
import type {
  EcsCompareOp,
  EcsScriptCond,
  EcsScriptDef,
  EcsScriptOp,
  EcsScriptRuleDef,
} from './EcsProjectSchema.ts';
import type { EcsWorld } from './EcsWorld.ts';

export const MAX_VM_OPS_PER_FRAME = 1024;
const MAX_QUEUED_EVENTS = 64;

export interface VmExecutionContext {
  world: EcsWorld;
  input: InputState;
  prevButtons: {
    action: boolean;
    jump: boolean;
    menu: boolean;
    skill: boolean;
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
  };
  dt: number;
  eventsOut: SimEvent[];
  onScoreDelta: (delta: number) => void;
  onStatusChange: (status: 'won' | 'lost') => void;
  onJudgePopup: (text: string, x: number, y: number, color: string) => void;
}

function evalCompare(lhs: number, op: EcsCompareOp, rhs: number): boolean {
  switch (op) {
    case 'eq':
      return Math.abs(lhs - rhs) < 1e-4;
    case 'neq':
      return Math.abs(lhs - rhs) >= 1e-4;
    case 'gt':
      return lhs > rhs;
    case 'gte':
      return lhs >= rhs;
    case 'lt':
      return lhs < rhs;
    case 'lte':
      return lhs <= rhs;
    default:
      return false;
  }
}

/**
 * Deterministic, Zero-GC Sandboxed Script Virtual Machine for True ECS entities.
 * Operates exclusively on generational ABA-safe EntityHandles via EcsCoreWorld component stores
 * with a hard per-frame instruction budget (zero eval / zero new Function).
 */
export class SandboxScriptVm {
  private readonly scripts = new Map<string, EcsScriptDef>();
  private readonly customEventQueue: string[] = [];
  private readonly scratchHandles = new Uint32Array(2048);
  private readonly scriptRuleOffset = new Map<string, number>();
  private readonly scriptRuleCount = new Map<string, number>();
  private ruleHotTimers = new Float32Array(0);
  private ruleFireCounts = new Uint32Array(0);
  private opsExecutedThisFrame = 0;

  public loadScripts(scriptMap: Record<string, EcsScriptDef>): void {
    this.scripts.clear();
    this.customEventQueue.length = 0;
    this.scriptRuleOffset.clear();
    this.scriptRuleCount.clear();
    let totalRules = 0;
    for (const [id, def] of Object.entries(scriptMap)) {
      this.scripts.set(id, def);
      this.scriptRuleOffset.set(id, totalRules);
      this.scriptRuleCount.set(id, def.rules.length);
      totalRules += def.rules.length;
    }
    this.ruleHotTimers = new Float32Array(totalRules);
    this.ruleFireCounts = new Uint32Array(totalRules);
  }

  public getLastFrameOpCount(): number {
    return this.opsExecutedThisFrame;
  }

  /** Returns normalized [0..1] recent execution glow for Event Graph live trace highlighting (Zero-GC). */
  public getRuleHotGlow(scriptId: string, ruleIndex: number): number {
    const off = this.scriptRuleOffset.get(scriptId);
    const cnt = this.scriptRuleCount.get(scriptId) ?? 0;
    if (off === undefined || ruleIndex < 0 || ruleIndex >= cnt) return 0;
    return Math.min(1, this.ruleHotTimers[off + ruleIndex] / 0.45);
  }

  /** Returns cumulative times a specific rule fired since project reset (Zero-GC). */
  public getRuleFireCount(scriptId: string, ruleIndex: number): number {
    const off = this.scriptRuleOffset.get(scriptId);
    const cnt = this.scriptRuleCount.get(scriptId) ?? 0;
    if (off === undefined || ruleIndex < 0 || ruleIndex >= cnt) return 0;
    return this.ruleFireCounts[off + ruleIndex];
  }

  public emitCustomEvent(name: string): void {
    if (this.customEventQueue.length < MAX_QUEUED_EVENTS) {
      this.customEventQueue.push(name);
    }
  }

  public beginFrame(dt = 1 / 60): void {
    this.opsExecutedThisFrame = 0;
    for (let i = 0; i < this.ruleHotTimers.length; i++) {
      if (this.ruleHotTimers[i] > 0) {
        const next = this.ruleHotTimers[i] - dt;
        this.ruleHotTimers[i] = next > 0 ? next : 0;
      }
    }
  }

  public triggerPathEnd(handle: EntityHandle, ctx: VmExecutionContext): void {
    const core = ctx.world.core;
    const agent = core.getComponent(handle, core.components.ScriptAgent);
    if (!agent) return;
    const refs = agent.scriptRefs;
    for (let i = 0; i < refs.length; i++) {
      const script = this.scripts.get(refs[i]);
      if (!script) continue;
      for (let r = 0; r < script.rules.length; r++) {
        const rule = script.rules[r];
        if (rule.trigger.on === 'path_end') {
          this.tryExecuteRule(refs[i], r, handle, rule, ctx);
        }
      }
    }
  }

  public triggerCollision(handle: EntityHandle, otherTag: string, ctx: VmExecutionContext): void {
    const core = ctx.world.core;
    const agent = core.getComponent(handle, core.components.ScriptAgent);
    if (!agent) return;
    const refs = agent.scriptRefs;
    for (let i = 0; i < refs.length; i++) {
      const script = this.scripts.get(refs[i]);
      if (!script) continue;
      for (let r = 0; r < script.rules.length; r++) {
        const rule = script.rules[r];
        if (rule.trigger.on === 'collide') {
          if (!rule.trigger.withTag || rule.trigger.withTag === otherTag) {
            this.tryExecuteRule(refs[i], r, handle, rule, ctx);
          }
        }
      }
    }
  }

  public stepEntities(ctx: VmExecutionContext): void {
    const core = ctx.world.core;
    const scriptStore = core.getStore(core.components.ScriptAgent);
    const inp = ctx.input;
    const prev = ctx.prevButtons;

    const justAction = inp.action && !prev.action;
    const justJump = inp.jump && !prev.jump;
    const justMenu = inp.skillY && !prev.menu;
    const justSkill = inp.skillX && !prev.skill;
    const justLeft = inp.left && !prev.left;
    const justRight = inp.right && !prev.right;
    const justUp = inp.up && !prev.up;
    const justDown = inp.down && !prev.down;

    // Snapshot generational handles into pre-allocated scratch buffer so spawns/destroys during tick are 100% safe
    const snapshotCount = Math.min(scriptStore.size(), this.scratchHandles.length);
    for (let i = 0; i < snapshotCount; i++) {
      this.scratchHandles[i] = scriptStore.getDenseEntityAt(i);
    }

    for (let idx = 0; idx < snapshotCount; idx++) {
      if (this.opsExecutedThisFrame >= MAX_VM_OPS_PER_FRAME) break;
      const handle = this.scratchHandles[idx];
      if (!core.entities.isAlive(handle)) continue;
      const agent = core.getComponent(handle, core.components.ScriptAgent);
      if (!agent) continue;

      if (agent.cooldown > 0) {
        agent.cooldown = Math.max(0, agent.cooldown - ctx.dt);
      }

      const isFirstTick = !agent.started;
      if (isFirstTick) agent.started = true;
      agent.timerAccum += ctx.dt;

      const refs = agent.scriptRefs;
      for (let s = 0; s < refs.length; s++) {
        const script = this.scripts.get(refs[s]);
        if (!script) continue;

        for (let r = 0; r < script.rules.length; r++) {
          if (this.opsExecutedThisFrame >= MAX_VM_OPS_PER_FRAME) break;
          if (!core.entities.isAlive(handle)) break;
          const rule = script.rules[r];
          const trig = rule.trigger;

          if (trig.on === 'start' && isFirstTick) {
            this.tryExecuteRule(refs[s], r, handle, rule, ctx);
          } else if (trig.on === 'tick') {
            this.tryExecuteRule(refs[s], r, handle, rule, ctx);
          } else if (trig.on === 'timer') {
            const iv = Math.max(0.05, trig.intervalSec);
            if (agent.timerAccum >= iv) {
              agent.timerAccum -= iv;
              this.tryExecuteRule(refs[s], r, handle, rule, ctx);
            }
          } else if (trig.on === 'input') {
            const fired =
              (trig.button === 'action' && justAction) ||
              (trig.button === 'jump' && justJump) ||
              (trig.button === 'menu' && justMenu) ||
              (trig.button === 'skill' && justSkill) ||
              (trig.button === 'left' && justLeft) ||
              (trig.button === 'right' && justRight) ||
              (trig.button === 'up' && justUp) ||
              (trig.button === 'down' && justDown);
            if (fired) {
              this.tryExecuteRule(refs[s], r, handle, rule, ctx);
            }
          }
        }
      }
    }

    // Drain custom event queue
    let eventPasses = 0;
    while (this.customEventQueue.length > 0 && eventPasses < 4 && this.opsExecutedThisFrame < MAX_VM_OPS_PER_FRAME) {
      const evName = this.customEventQueue.shift()!;
      eventPasses++;
      const evSnapCount = Math.min(scriptStore.size(), this.scratchHandles.length);
      for (let i = 0; i < evSnapCount; i++) {
        this.scratchHandles[i] = scriptStore.getDenseEntityAt(i);
      }
      for (let idx = 0; idx < evSnapCount; idx++) {
        const handle = this.scratchHandles[idx];
        if (!core.entities.isAlive(handle)) continue;
        const agent = core.getComponent(handle, core.components.ScriptAgent);
        if (!agent) continue;
        const refs = agent.scriptRefs;
        for (let s = 0; s < refs.length; s++) {
          const script = this.scripts.get(refs[s]);
          if (!script) continue;
          for (let r = 0; r < script.rules.length; r++) {
            const rule = script.rules[r];
            if (rule.trigger.on === 'event' && rule.trigger.name === evName) {
              this.tryExecuteRule(refs[s], r, handle, rule, ctx);
            }
          }
        }
      }
    }
  }

  private checkConds(handle: EntityHandle, conds: EcsScriptCond[] | undefined, world: EcsWorld): boolean {
    if (!conds || conds.length === 0) return true;
    const core = world.core;
    for (let i = 0; i < conds.length; i++) {
      const c = conds[i];
      let lhs = 0;
      if (c.kind === 'global') {
        lhs = world.getGlobal(c.key ?? '');
      } else if (c.kind === 'var') {
        const idx = Math.max(0, Math.min(ECS_VAR_SLOTS - 1, c.slot ?? 0));
        const agent = core.getComponent(handle, core.components.ScriptAgent);
        lhs = agent ? agent.vars[idx] : 0;
      } else if (c.kind === 'hp') {
        const hpComp = core.getComponent(handle, core.components.Health);
        lhs = hpComp ? hpComp.hp : 0;
      }
      if (!evalCompare(lhs, c.op, c.value)) return false;
    }
    return true;
  }

  private tryExecuteRule(
    scriptId: string,
    ruleIndex: number,
    handle: EntityHandle,
    rule: EcsScriptRuleDef,
    ctx: VmExecutionContext,
  ): void {
    const core = ctx.world.core;
    if (!core.entities.isAlive(handle)) return;
    if (!this.checkConds(handle, rule.when, ctx.world)) return;

    const off = this.scriptRuleOffset.get(scriptId);
    if (off !== undefined) {
      const slot = off + ruleIndex;
      if (slot >= 0 && slot < this.ruleHotTimers.length) {
        this.ruleHotTimers[slot] = 0.45;
        this.ruleFireCounts[slot] = (this.ruleFireCounts[slot] + 1) >>> 0;
      }
    }

    for (let i = 0; i < rule.ops.length; i++) {
      if (this.opsExecutedThisFrame >= MAX_VM_OPS_PER_FRAME) return;
      if (!core.entities.isAlive(handle)) return;
      this.opsExecutedThisFrame++;
      this.execOp(handle, rule.ops[i], ctx);
    }
  }

  private execOp(handle: EntityHandle, op: EcsScriptOp, ctx: VmExecutionContext): void {
    const world = ctx.world;
    const core = world.core;
    const c = core.components;

    switch (op.op) {
      case 'set_global': {
        world.setGlobal(op.key, op.value);
        break;
      }
      case 'add_global': {
        let next = world.getGlobal(op.key) + op.delta;
        if (op.min !== undefined && next < op.min) next = op.min;
        if (op.max !== undefined && next > op.max) next = op.max;
        world.setGlobal(op.key, next);
        break;
      }
      case 'set_var': {
        const idx = Math.max(0, Math.min(ECS_VAR_SLOTS - 1, op.slot));
        const agent = core.getComponent(handle, c.ScriptAgent);
        if (agent) agent.vars[idx] = op.value;
        break;
      }
      case 'add_var': {
        const idx = Math.max(0, Math.min(ECS_VAR_SLOTS - 1, op.slot));
        const agent = core.getComponent(handle, c.ScriptAgent);
        if (agent) agent.vars[idx] += op.delta;
        break;
      }
      case 'set_vel': {
        const vel = core.getComponent(handle, c.Velocity2D);
        if (vel) {
          vel.vx = op.vx;
          vel.vy = op.vy;
        }
        break;
      }
      case 'spawn_prefab': {
        const tr = core.getComponent(handle, c.Transform2D);
        const sx = op.atX !== undefined ? op.atX : (tr?.x ?? 0) + (op.offsetX ?? 0);
        const sy = op.atY !== undefined ? op.atY : (tr?.y ?? 0) + (op.offsetY ?? 0);
        world.spawnFromPrefab(op.prefab, sx, sy, op.lane);
        break;
      }
      case 'destroy_self': {
        world.destroy(handle);
        break;
      }
      case 'find_nearest': {
        const agent = core.getComponent(handle, c.ScriptAgent);
        if (agent) {
          agent.targetHandle = world.findNearestByTag(handle, op.tag, op.range);
        }
        break;
      }
      case 'fire_at_target': {
        const agent = core.getComponent(handle, c.ScriptAgent);
        if (!agent || agent.cooldown > 0) break;
        const tgt = agent.targetHandle;
        if (tgt === INVALID_ENTITY || !core.entities.isAlive(tgt)) {
          agent.targetHandle = INVALID_ENTITY;
          break;
        }
        if (op.energyGlobal && op.energyCost && op.energyCost > 0) {
          const curE = world.getGlobal(op.energyGlobal);
          if (curE < op.energyCost) break;
          world.setGlobal(op.energyGlobal, curE - op.energyCost);
        }
        const selfTr = core.getComponent(handle, c.Transform2D);
        const tgtTr = core.getComponent(tgt, c.Transform2D);
        if (!selfTr || !tgtTr) break;
        const ox = selfTr.x + selfTr.w * 0.5;
        const oy = selfTr.y + selfTr.h * 0.5;
        const tx = tgtTr.x + tgtTr.w * 0.5;
        const ty = tgtTr.y + tgtTr.h * 0.5;
        const dx = tx - ox;
        const dy = ty - oy;
        const dist = Math.hypot(dx, dy) || 1;
        const proj = world.spawnFromPrefab(op.prefab, ox - 4, oy - 4);
        if (proj !== INVALID_ENTITY) {
          const pVel = core.getComponent(proj, c.Velocity2D);
          const pTr = core.getComponent(proj, c.Transform2D);
          if (pVel) {
            pVel.vx = (dx / dist) * op.speed;
            pVel.vy = (dy / dist) * op.speed;
          }
          if (pTr) {
            pTr.rot = Math.atan2(dy, dx);
          }
        }
        agent.cooldown = Math.max(0.08, op.cooldownSec);
        ctx.eventsOut.push('laser');
        break;
      }
      case 'damage_global': {
        const next = Math.max(0, world.getGlobal(op.key) - Math.abs(op.delta));
        world.setGlobal(op.key, next);
        ctx.eventsOut.push('hurt');
        if (next <= 0) {
          ctx.onStatusChange('lost');
        }
        break;
      }
      case 'add_score': {
        ctx.onScoreDelta(op.delta);
        break;
      }
      case 'play_sfx': {
        ctx.eventsOut.push(op.sfx);
        break;
      }
      case 'emit_event': {
        this.emitCustomEvent(op.name);
        break;
      }
      case 'judge_lane_hit': {
        const perfectPx = op.perfectPx ?? 18;
        const goodPx = op.goodPx ?? 36;
        let bestNote: EntityHandle = INVALID_ENTITY;
        let bestDist = goodPx + 1;
        const rhythmStore = core.getStore(c.RhythmLane);
        const count = rhythmStore.size();
        for (let i = 0; i < count; i++) {
          const h = rhythmStore.getDenseEntityAt(i);
          const rl = rhythmStore.getDenseDataAt(i);
          if (rl.laneIndex !== op.lane) continue;
          const tr = core.getComponent(h, c.Transform2D);
          if (!tr) continue;
          const dist = Math.abs(tr.x - rl.judgeX);
          if (dist < bestDist) {
            bestDist = dist;
            bestNote = h;
          }
        }
        if (bestNote !== INVALID_ENTITY) {
          const noteTr = core.getComponent(bestNote, c.Transform2D);
          const nx = noteTr?.x ?? 112;
          const ny = noteTr?.y ?? 220;
          world.destroy(bestNote);
          const isPerfect = bestDist <= perfectPx;
          const energyGain = isPerfect ? (op.perfectEnergy ?? 22) : Math.round((op.perfectEnergy ?? 22) * 0.6);
          const nextE = Math.min(100, world.getGlobal(op.energyGlobal) + energyGain);
          world.setGlobal(op.energyGlobal, nextE);
          const nextCombo = world.getGlobal(op.comboGlobal) + 1;
          world.setGlobal(op.comboGlobal, nextCombo);
          ctx.onScoreDelta(isPerfect ? 150 + nextCombo * 10 : 80);
          ctx.eventsOut.push(isPerfect ? 'star' : 'snap');
          ctx.onJudgePopup(
            isPerfect ? `PERFECT +${energyGain}` : `GOOD +${energyGain}`,
            nx,
            ny - 10,
            isPerfect ? '#ffd447' : '#5ec2f7',
          );
        } else {
          world.setGlobal(op.comboGlobal, 0);
          ctx.eventsOut.push('bounce');
        }
        break;
      }
      case 'set_status': {
        ctx.onStatusChange(op.status);
        break;
      }
      default:
        break;
    }
  }
}
