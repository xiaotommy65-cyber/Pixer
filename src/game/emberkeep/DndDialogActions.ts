import type { SimEvent } from '../../core/types/WorldTypes.ts';
import { equipItem, grantXp, pushCombatLog, updateFov } from './DndExploreActions.ts';
import type { DndWorldState } from './DndTypes.ts';
import { EQUIPMENT_CATALOG, skillCheck } from './RpgRules.ts';

export function resolveDialogChoice(state: DndWorldState, idx: number, events: SimEvent[]): void {
  if (state.phase.kind !== 'dialog') return;
  const dlg = state.moduleDef.dialogs[state.phase.dialogId];
  const choice = dlg?.choices[idx] ?? dlg?.choices[0];
  if (!choice) {
    state.phase = { kind: 'explore', menuIdx: 0 };
    return;
  }

  if (choice.costGold && state.hero.gold < choice.costGold) {
    events.push('hurt');
    pushCombatLog(state, `🪙 金幣不足（需要 ${choice.costGold} 枚金幣）！`);
    state.phase = { kind: 'explore', menuIdx: 0 };
    return;
  }

  let ok = true;
  let rollPrefix = '';
  if (choice.checkStat && choice.checkDc) {
    const chk = skillCheck(state.rng, state.hero, choice.checkStat, choice.checkDc);
    ok = chk.passed;
    rollPrefix = `🎲 ${choice.checkStat.toUpperCase()} ${chk.roll.text} vs DC${choice.checkDc}：`;
  }

  if (ok) {
    if (choice.costGold) state.hero.gold -= choice.costGold;
    if (choice.rewardFlag) state.blackboard[choice.rewardFlag] = true;
    if (choice.rewardPotion) state.hero.potions += choice.rewardPotion;
    if (choice.rewardGold) state.hero.gold += choice.rewardGold;
    if (choice.rewardHpFull) {
      state.hero.hp = state.hero.maxHp;
      state.hero.mp = state.hero.maxMp;
      state.hero.statuses = {};
    }
    let equipMsg = '';
    if (choice.rewardItem && EQUIPMENT_CATALOG[choice.rewardItem]) {
      equipMsg = ` ${equipItem(state, EQUIPMENT_CATALOG[choice.rewardItem])}`;
    }
    if (choice.rewardXp) grantXp(state, choice.rewardXp, events);
    updateFov(state);
    events.push('star');
    pushCombatLog(state, `${rollPrefix}${choice.successText}${equipMsg}`);
  } else {
    if (choice.failDamage) {
      state.hero.hp -= choice.failDamage;
      state.hero.flash = 0.3;
      events.push('hurt');
    } else {
      events.push('bounce');
    }
    pushCombatLog(state, `${rollPrefix}${choice.failText ?? '未能順利說服對方。'}`);
  }

  if (state.hero.hp <= 0) {
    state.hero.hp = 0;
    state.phase = { kind: 'lost' };
  } else {
    state.phase = { kind: 'explore', menuIdx: 0 };
  }
}
