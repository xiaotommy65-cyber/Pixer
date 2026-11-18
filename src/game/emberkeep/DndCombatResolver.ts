import type { GridPos } from '../../core/sim/GridPathfinder.ts';
import type { SimEvent } from '../../core/types/WorldTypes.ts';
import { resolvePlayerCombatAction, runEnemyCombatTurn } from './DndCombatActions.ts';
import { resolveDialogChoice } from './DndDialogActions.ts';
import {
  enterFloor,
  equipItem,
  pushCombatLog,
  recalcEquipmentBonuses,
  stepOverworldMonsters,
  tryStepGrid,
  updateFov,
} from './DndExploreActions.ts';
import type { DndWorldState } from './DndTypes.ts';
import { rollDice } from './RpgRules.ts';

export function executeTurnAction(
  state: DndWorldState,
  actionId: string,
  events: SimEvent[],
  onCameraSnap: () => void,
): void {
  if (state.phase.kind === 'won' || state.phase.kind === 'lost') return;

  if (state.phase.kind === 'dialog') {
    const idx = Number(actionId.replace('dialog_', ''));
    resolveDialogChoice(state, Number.isFinite(idx) ? idx : 0, events);
    return;
  }

  if (state.phase.kind === 'combat') {
    if (state.phase.turnOwner !== 'player') return;
    resolvePlayerCombatAction(state, actionId, events);
    return;
  }

  if (actionId === 'wait') {
    state.turnCount++;
    state.hero.mp = Math.min(state.hero.maxMp, state.hero.mp + 1);
    pushCombatLog(state, '⌛ 稍作調息，恢復 1 MP。');
    stepOverworldMonsters(state, events);
    return;
  }
  if (actionId === 'potion') {
    if (state.hero.potions <= 0) return;
    state.hero.potions--;
    const heal = rollDice(state.rng, 2, 4, 2).total;
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + heal);
    state.turnCount++;
    events.push('star');
    state.juice.spawnBurst(state.hero.visualX + 8, state.hero.visualY + 8, ['#56d39c', '#fffaf0'], 10);
    pushCombatLog(state, `🧪 飲用治療藥水！恢復 ${heal} HP。`);
    stepOverworldMonsters(state, events);
    return;
  }

  const deltaMap: Record<string, GridPos> = {
    move_n: { x: 0, y: -1 },
    move_s: { x: 0, y: 1 },
    move_w: { x: -1, y: 0 },
    move_e: { x: 1, y: 0 },
  };
  const delta = deltaMap[actionId];
  if (!delta) return;

  if (delta.x < 0) state.hero.facingLeft = true;
  if (delta.x > 0) state.hero.facingLeft = false;
  tryStepGrid(state, state.hero.x + delta.x, state.hero.y + delta.y, events, onCameraSnap);
}

export {
  enterFloor,
  equipItem,
  pushCombatLog,
  recalcEquipmentBonuses,
  runEnemyCombatTurn,
  updateFov,
};
