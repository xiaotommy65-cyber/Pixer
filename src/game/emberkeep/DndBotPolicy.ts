import { findNextStep, type GridPos } from '../../core/sim/GridPathfinder.ts';
import { getLegalActions } from './DndSnapshotProjector.ts';
import { findEntityAt, getActiveFloor, isWalkableAt, type DndWorldState } from './DndTypes.ts';

/**
 * Goal-Driven Explorer & Tactical Combat Bot Policy.
 * Uses BFS navigation over explored tiles, campfire healing, shop affordability, and combat utility heuristics.
 */
export function suggestAgentAction(state: DndWorldState): string | null {
  const legal = getLegalActions(state);
  if (legal.length === 0) return null;

  if (state.phase.kind === 'dialog') {
    const affordable = legal.find((a) => a.enabled);
    return affordable?.id ?? legal[legal.length - 1]?.id ?? null;
  }

  const f = getActiveFloor(state);

  if (state.phase.kind === 'combat') {
    const combatEnemyId = state.phase.entityId;
    const enemy = f.entities.find((e) => e.id === combatEnemyId);
    if (state.hero.hp <= Math.ceil(state.hero.maxHp * 0.42)) {
      if (legal.find((a) => a.id === 'potion' && a.enabled)) return 'potion';
      if (legal.find((a) => a.id === 'heal' && a.enabled)) return 'heal';
    }
    if (enemy && (enemy.isBoss || enemy.isMiniBoss || enemy.ac >= 13) && legal.find((a) => a.id === 'firebolt' && a.enabled)) {
      return 'firebolt';
    }
    return 'attack';
  }

  if (state.hero.hp <= Math.ceil(state.hero.maxHp * 0.48) && legal.find((a) => a.id === 'potion')) {
    return 'potion';
  }

  const targets: GridPos[] = [];
  if (state.hero.hp < Math.ceil(state.hero.maxHp * 0.78) || state.hero.mp < Math.ceil(state.hero.maxMp * 0.5)) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (f.explored.has(y * f.width + x) && f.grid[y][x] === 'campfire') {
          targets.push({ x, y });
        }
      }
    }
  }
  for (const e of f.entities) {
    if (!e.alive) continue;
    if (e.kind === 'chest' && e.opened) continue;
    if (e.kind === 'npc' && e.talked) continue;
    if (f.explored.has(e.y * f.width + e.x)) {
      targets.push({ x: e.x, y: e.y });
    }
  }
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      if (!f.explored.has(y * f.width + x)) continue;
      const t = f.grid[y][x];
      if (t === 'door' || (t === 'locked_door' && state.hero.keys > 0)) {
        targets.push({ x, y });
      }
    }
  }
  if (targets.length === 0) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (!f.explored.has(y * f.width + x) || !isWalkableAt(f, x, y, true)) continue;
        if (f.grid[y][x] === 'locked_door' && state.hero.keys <= 0) continue;
        const adjUnseen = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ].some(([ax, ay]) => ax >= 0 && ay >= 0 && ax < f.width && ay < f.height && !f.explored.has(ay * f.width + ax));
        if (adjUnseen) targets.push({ x, y });
      }
    }
  }
  if (targets.length === 0) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (f.grid[y][x] === 'stairs_down') targets.push({ x, y });
      }
    }
  }

  let bestStep: GridPos | null = null;
  for (const goal of targets) {
    const step = findNextStep(f.width, f.height, { x: state.hero.x, y: state.hero.y }, goal, (x, y) => {
      if (!isWalkableAt(f, x, y, true)) return false;
      if (f.grid[y][x] === 'locked_door' && state.hero.keys <= 0) return false;
      if (findEntityAt(f, x, y)) return false;
      return true;
    });
    if (step) {
      bestStep = step;
      break;
    }
  }

  if (bestStep) {
    if (bestStep.y < state.hero.y) return 'move_n';
    if (bestStep.y > state.hero.y) return 'move_s';
    if (bestStep.x < state.hero.x) return 'move_w';
    if (bestStep.x > state.hero.x) return 'move_e';
  }
  return legal[0]?.id ?? null;
}
