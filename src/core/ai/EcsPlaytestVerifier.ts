import { EcsCartridgeRuntime } from '../ecs/EcsCartridgeRuntime.ts';
import { cloneEcsProject, type EcsProjectV2 } from '../ecs/EcsProjectSchema.ts';
import {
  createEmptyInputState,
  DEFAULT_RUNTIME_PARAMS,
  type InputState,
} from '../types/WorldTypes.ts';

export interface EcsInputKeypoint {
  fromFrame: number;
  toFrame: number;
  input: Partial<InputState>;
  label?: string;
}

export type EcsPlaytestAssertion =
  | { kind: 'reach_entity'; actorId: string; targetId: string; maxDistance?: number; byFrame?: number }
  | { kind: 'reach_rect'; actorId: string; x: number; y: number; w: number; h: number; byFrame?: number }
  | { kind: 'global_gte'; key: string; value: number }
  | { kind: 'global_lte'; key: string; value: number }
  | { kind: 'score_gte'; value: number }
  | { kind: 'status_is'; status: 'playing' | 'won' | 'lost' }
  | { kind: 'event_fired'; event: string; minCount?: number }
  | { kind: 'in_room'; roomId: string; byFrame?: number }
  | { kind: 'boss_hp_lte'; value: number }
  | { kind: 'no_nan_positions' };

export interface EcsKeypointPlaytestPlan {
  maxFrames: number;
  keypoints: EcsInputKeypoint[];
  assertions: EcsPlaytestAssertion[];
  watchActorIds?: string[];
  sampleEveryFrames?: number;
}

export interface EcsAssertionResult {
  assertion: EcsPlaytestAssertion;
  passed: boolean;
  firstPassedFrame?: number;
  detail: string;
}

export interface ActorTraceSample {
  frame: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface EcsScriptedPlaytestReport {
  ok: boolean;
  framesSimulated: number;
  status: 'playing' | 'won' | 'lost';
  score: number;
  activeEntities: number;
  activeRoomId: string;
  bossHp: number;
  maxVmOps: number;
  globals: Record<string, number>;
  eventCounts: Record<string, number>;
  assertionResults: EcsAssertionResult[];
  actorTraces: Record<string, ActorTraceSample[]>;
  failureHints: string[];
}

function resetInputInPlace(inp: InputState): void {
  inp.left = false;
  inp.right = false;
  inp.up = false;
  inp.down = false;
  inp.jump = false;
  inp.action = false;
  inp.skillX = false;
  inp.skillY = false;
  inp.shoulderL = false;
  inp.shoulderR = false;
  inp.restart = false;
  inp.rightStickX = 0;
  inp.rightStickY = 0;
  inp.pointerX = 0;
  inp.pointerY = 0;
  inp.pointerActive = false;
  inp.pointerPrimary = false;
  inp.pointerSecondary = false;
}

function mergeKeypointInput(dst: InputState, src: Partial<InputState>): void {
  if (src.left) dst.left = true;
  if (src.right) dst.right = true;
  if (src.up) dst.up = true;
  if (src.down) dst.down = true;
  if (src.jump) dst.jump = true;
  if (src.action) dst.action = true;
  if (src.skillX) dst.skillX = true;
  if (src.skillY) dst.skillY = true;
  if (src.shoulderL) dst.shoulderL = true;
  if (src.shoulderR) dst.shoulderR = true;
  if (src.restart) dst.restart = true;
  if (typeof src.rightStickX === 'number' && src.rightStickX !== 0) dst.rightStickX = src.rightStickX;
  if (typeof src.rightStickY === 'number' && src.rightStickY !== 0) dst.rightStickY = src.rightStickY;
  if (typeof src.pointerX === 'number') dst.pointerX = src.pointerX;
  if (typeof src.pointerY === 'number') dst.pointerY = src.pointerY;
  if (src.pointerActive) dst.pointerActive = true;
  if (src.pointerPrimary) dst.pointerPrimary = true;
  if (src.pointerSecondary) dst.pointerSecondary = true;
}

function findEntityCenter(
  rt: EcsCartridgeRuntime,
  entityId: string,
): { x: number; y: number; cx: number; cy: number; vx: number; vy: number } | null {
  const core = rt.world.core;
  const tagStore = core.getStore(core.components.Tag);
  const trComp = core.components.Transform2D;
  const velComp = core.components.Velocity2D;
  const count = tagStore.size();
  for (let i = 0; i < count; i++) {
    if (tagStore.getDenseDataAt(i).entityId === entityId) {
      const h = tagStore.getDenseEntityAt(i);
      const tr = core.getComponent(h, trComp);
      if (!tr) return null;
      const vel = core.getComponent(h, velComp);
      return {
        x: tr.x,
        y: tr.y,
        cx: tr.x + tr.w * 0.5,
        cy: tr.y + tr.h * 0.5,
        vx: vel?.vx ?? 0,
        vy: vel?.vy ?? 0,
      };
    }
  }
  return null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * Deterministic 60Hz headless playtest verifier driven by timed input keypoints and structured assertions.
 * Enables AI agents to prove level solvability, verify physics timing, and receive frame-accurate failure hints.
 */
export function runScriptedPlaytest(
  project: EcsProjectV2,
  plan: EcsKeypointPlaytestPlan,
): EcsScriptedPlaytestReport {
  const rt = new EcsCartridgeRuntime(cloneEcsProject(project));
  const safeFrames = Math.max(1, Math.min(3600, Math.round(plan.maxFrames || 180)));
  const sampleStep = Math.max(1, Math.round(plan.sampleEveryFrames ?? 15));
  const input = createEmptyInputState();

  // Track watch actors (union of explicit watchActorIds and any actorId referenced by assertions)
  const watchSet = new Set<string>(plan.watchActorIds ?? []);
  for (const a of plan.assertions) {
    if ('actorId' in a) watchSet.add(a.actorId);
  }
  const actorTraces: Record<string, ActorTraceSample[]> = {};
  for (const id of watchSet) actorTraces[id] = [];

  // Per-assertion tracking for frame-by-frame spatial checks
  const reachPassFrame = new Array<number | undefined>(plan.assertions.length).fill(undefined);
  const reachMinDist = new Array<number>(plan.assertions.length).fill(Infinity);
  const reachClosestFrame = new Array<number>(plan.assertions.length).fill(-1);
  let sawNan = false;
  let nanFrame = -1;
  let maxVmOps = 0;
  const eventCounts: Record<string, number> = {};

  for (let f = 0; f < safeFrames; f++) {
    resetInputInPlace(input);
    for (let k = 0; k < plan.keypoints.length; k++) {
      const kp = plan.keypoints[k];
      if (f >= kp.fromFrame && f <= kp.toFrame) {
        mergeKeypointInput(input, kp.input);
      }
    }

    const evs = rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
    maxVmOps = Math.max(maxVmOps, rt.vm.getLastFrameOpCount());
    for (let e = 0; e < evs.length; e++) {
      const ev = evs[e];
      eventCounts[ev] = (eventCounts[ev] ?? 0) + 1;
    }

    // Check NaN guard across all active transforms
    if (!sawNan) {
      const trStore = rt.world.core.getStore(rt.world.core.components.Transform2D);
      const tCount = trStore.size();
      for (let i = 0; i < tCount; i++) {
        const tr = trStore.getDenseDataAt(i);
        if (!Number.isFinite(tr.x) || !Number.isFinite(tr.y)) {
          sawNan = true;
          nanFrame = f;
          break;
        }
      }
    }

    // Sample watched actor trajectories
    if (f % sampleStep === 0 || f === safeFrames - 1) {
      for (const actorId of watchSet) {
        const pos = findEntityCenter(rt, actorId);
        if (pos) {
          actorTraces[actorId].push({
            frame: f,
            x: round1(pos.x),
            y: round1(pos.y),
            vx: round1(pos.vx),
            vy: round1(pos.vy),
          });
        }
      }
    }

    // Evaluate continuous spatial assertions each frame
    for (let ai = 0; ai < plan.assertions.length; ai++) {
      const a = plan.assertions[ai];
      if (reachPassFrame[ai] !== undefined) continue;
      if (a.kind === 'reach_entity') {
        if (a.byFrame !== undefined && f > a.byFrame) continue;
        const actor = findEntityCenter(rt, a.actorId);
        const target = findEntityCenter(rt, a.targetId);
        if (actor && target) {
          const dist = Math.hypot(actor.cx - target.cx, actor.cy - target.cy);
          if (dist < reachMinDist[ai]) {
            reachMinDist[ai] = dist;
            reachClosestFrame[ai] = f;
          }
          const threshold = a.maxDistance ?? 28;
          if (dist <= threshold) {
            reachPassFrame[ai] = f;
          }
        }
      } else if (a.kind === 'reach_rect') {
        if (a.byFrame !== undefined && f > a.byFrame) continue;
        const actor = findEntityCenter(rt, a.actorId);
        if (actor) {
          const clampedX = Math.max(a.x, Math.min(a.x + a.w, actor.cx));
          const clampedY = Math.max(a.y, Math.min(a.y + a.h, actor.cy));
          const dist = Math.hypot(actor.cx - clampedX, actor.cy - clampedY);
          if (dist < reachMinDist[ai]) {
            reachMinDist[ai] = dist;
            reachClosestFrame[ai] = f;
          }
          if (dist <= 0.5) {
            reachPassFrame[ai] = f;
          }
        }
      } else if (a.kind === 'in_room') {
        if (a.byFrame !== undefined && f > a.byFrame) continue;
        if (rt.getActiveRoomId() === a.roomId) {
          reachPassFrame[ai] = f;
        }
      }
    }
  }

  const finalSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const globals: Record<string, number> = {};
  for (const [k, v] of rt.world.globals.entries()) {
    globals[k] = Math.round(v * 100) / 100;
  }

  const assertionResults: EcsAssertionResult[] = [];
  const failureHints: string[] = [];

  for (let ai = 0; ai < plan.assertions.length; ai++) {
    const a = plan.assertions[ai];
    switch (a.kind) {
      case 'reach_entity': {
        const pf = reachPassFrame[ai];
        const passed = pf !== undefined;
        const detail = passed
          ? `"${a.actorId}" reached "${a.targetId}" at frame ${pf}`
          : `"${a.actorId}" never reached "${a.targetId}" (closest=${Number.isFinite(reachMinDist[ai]) ? `${round1(reachMinDist[ai])}px at frame ${reachClosestFrame[ai]}` : 'entity missing'})`;
        assertionResults.push({ assertion: a, passed, firstPassedFrame: pf, detail });
        if (!passed) failureHints.push(detail);
        break;
      }
      case 'reach_rect': {
        const pf = reachPassFrame[ai];
        const passed = pf !== undefined;
        const detail = passed
          ? `"${a.actorId}" entered rect (${a.x},${a.y},${a.w}x${a.h}) at frame ${pf}`
          : `"${a.actorId}" missed rect (closest=${Number.isFinite(reachMinDist[ai]) ? `${round1(reachMinDist[ai])}px at frame ${reachClosestFrame[ai]}` : 'actor missing'})`;
        assertionResults.push({ assertion: a, passed, firstPassedFrame: pf, detail });
        if (!passed) failureHints.push(detail);
        break;
      }
      case 'global_gte': {
        const actual = globals[a.key] ?? 0;
        const passed = actual >= a.value;
        const detail = `global.${a.key} = ${actual} (expected >= ${a.value})`;
        assertionResults.push({ assertion: a, passed, detail });
        if (!passed) failureHints.push(`Global assertion failed: ${detail}`);
        break;
      }
      case 'global_lte': {
        const actual = globals[a.key] ?? 0;
        const passed = actual <= a.value;
        const detail = `global.${a.key} = ${actual} (expected <= ${a.value})`;
        assertionResults.push({ assertion: a, passed, detail });
        if (!passed) failureHints.push(`Global assertion failed: ${detail}`);
        break;
      }
      case 'score_gte': {
        const passed = finalSnap.score >= a.value;
        const detail = `score = ${finalSnap.score} (expected >= ${a.value})`;
        assertionResults.push({ assertion: a, passed, detail });
        if (!passed) failureHints.push(`Score assertion failed: ${detail}`);
        break;
      }
      case 'status_is': {
        const st = rt.getStatus();
        const passed = st === a.status;
        const detail = `status = "${st}" (expected "${a.status}")`;
        assertionResults.push({ assertion: a, passed, detail });
        if (!passed) failureHints.push(`Status mismatch: ${detail}`);
        break;
      }
      case 'event_fired': {
        const count = eventCounts[a.event] ?? 0;
        const minCount = a.minCount ?? 1;
        const passed = count >= minCount;
        const detail = `event "${a.event}" fired ${count} time(s) (expected >= ${minCount})`;
        assertionResults.push({ assertion: a, passed, detail });
        if (!passed) failureHints.push(`Event assertion failed: ${detail}`);
        break;
      }
      case 'in_room': {
        const pf = reachPassFrame[ai];
        const passed = pf !== undefined;
        const detail = passed
          ? `Entered room "${a.roomId}" at frame ${pf}`
          : `Never entered room "${a.roomId}" (ended in "${rt.getActiveRoomId()}")`;
        assertionResults.push({ assertion: a, passed, firstPassedFrame: pf, detail });
        if (!passed) failureHints.push(detail);
        break;
      }
      case 'boss_hp_lte': {
        const bhp = finalSnap.bossHp ?? 0;
        const passed = bhp <= a.value;
        const detail = `bossHp = ${bhp} (expected <= ${a.value})`;
        assertionResults.push({ assertion: a, passed, detail });
        if (!passed) failureHints.push(`Boss HP assertion failed: ${detail}`);
        break;
      }
      case 'no_nan_positions': {
        const passed = !sawNan;
        const detail = passed ? 'All entity positions remained finite' : `NaN/Infinity transform detected at frame ${nanFrame}`;
        assertionResults.push({ assertion: a, passed, detail });
        if (!passed) failureHints.push(detail);
        break;
      }
    }
  }

  return {
    ok: assertionResults.every((r) => r.passed),
    framesSimulated: safeFrames,
    status: rt.getStatus(),
    score: finalSnap.score,
    activeEntities: rt.world.activeCount,
    activeRoomId: rt.getActiveRoomId(),
    bossHp: finalSnap.bossHp ?? 0,
    maxVmOps,
    globals,
    eventCounts,
    assertionResults,
    actorTraces,
    failureHints,
  };
}
