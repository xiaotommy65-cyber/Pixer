export type BtStatus = 'success' | 'failure' | 'running';

export interface BtNode<TBlackboard> {
  readonly name?: string;
  tick(bb: TBlackboard): BtStatus;
}

/** Runs children left-to-right until one fails or is running. */
export function btSequence<T>(children: readonly BtNode<T>[], name = 'sequence'): BtNode<T> {
  return {
    name,
    tick(bb) {
      for (const child of children) {
        const res = child.tick(bb);
        if (res !== 'success') return res;
      }
      return 'success';
    },
  };
}

/** Runs children left-to-right until one succeeds or is running. */
export function btSelector<T>(children: readonly BtNode<T>[], name = 'selector'): BtNode<T> {
  return {
    name,
    tick(bb) {
      for (const child of children) {
        const res = child.tick(bb);
        if (res !== 'failure') return res;
      }
      return 'failure';
    },
  };
}

/** Leaf predicate returning success when condition holds, otherwise failure. */
export function btCondition<T>(pred: (bb: T) => boolean, name = 'condition'): BtNode<T> {
  return {
    name,
    tick(bb) {
      return pred(bb) ? 'success' : 'failure';
    },
  };
}

/** Leaf action executing imperative step against blackboard. */
export function btAction<T>(fn: (bb: T) => BtStatus | void, name = 'action'): BtNode<T> {
  return {
    name,
    tick(bb) {
      return fn(bb) ?? 'success';
    },
  };
}

/** Flips child success/failure while passing running through untouched. */
export function btInverter<T>(child: BtNode<T>, name = 'inverter'): BtNode<T> {
  return {
    name,
    tick(bb) {
      const res = child.tick(bb);
      if (res === 'success') return 'failure';
      if (res === 'failure') return 'success';
      return 'running';
    },
  };
}

/** Throttles child execution using caller-supplied clock (ms or sec). */
export function btCooldown<T>(
  cooldownDuration: number,
  nowFn: (bb: T) => number,
  child: BtNode<T>,
  name = 'cooldown',
): BtNode<T> {
  let nextAllowedAt = -Infinity;
  return {
    name,
    tick(bb) {
      const now = nowFn(bb);
      if (now < nextAllowedAt) return 'failure';
      const res = child.tick(bb);
      if (res === 'success') {
        nextAllowedAt = now + cooldownDuration;
      }
      return res;
    },
  };
}

export interface UtilityBranch<T> {
  id: string;
  score(bb: T): number;
  node: BtNode<T>;
}

/**
 * Evaluates branch utility scores each tick and runs branches in descending score order
 * (skipping scores <= 0) until one succeeds or returns running.
 */
export function btUtilitySelector<T>(
  branches: readonly UtilityBranch<T>[],
  name = 'utility-selector',
): BtNode<T> {
  return {
    name,
    tick(bb) {
      const ranked = branches
        .map((b) => ({ branch: b, utility: b.score(bb) }))
        .filter((item) => Number.isFinite(item.utility) && item.utility > 0)
        .sort((a, b) => b.utility - a.utility);

      for (const item of ranked) {
        const res = item.branch.node.tick(bb);
        if (res !== 'failure') return res;
      }
      return 'failure';
    },
  };
}
