import type { SimEvent } from '../../core/types/WorldTypes.ts';
import { equipItem, grantXp, pushCombatLog, updateFov } from './DndExploreActions.ts';
import { TILE_PX, getActiveFloor, type DndWorldState } from './DndTypes.ts';
import { EQUIPMENT_CATALOG, resolveWeaponAttack, rollDice, statMod } from './RpgRules.ts';

function applyIncomingDamage(state: DndWorldState, rawDmg: number): number {
  if ((state.hero.statuses.shield ?? 0) > 0) {
    state.hero.statuses.shield = (state.hero.statuses.shield ?? 1) - 1;
    if (state.hero.statuses.shield <= 0) delete state.hero.statuses.shield;
    return Math.max(1, Math.floor(rawDmg * 0.5));
  }
  return rawDmg;
}

export function resolvePlayerCombatAction(state: DndWorldState, actionId: string, events: SimEvent[]): void {
  if (state.phase.kind !== 'combat') return;
  const f = getActiveFloor(state);
  const combatEnemyId = state.phase.entityId;
  const enemy = f.entities.find((e) => e.id === combatEnemyId && e.alive);
  if (!enemy) {
    state.phase = { kind: 'explore', menuIdx: 0 };
    return;
  }

  state.turnCount++;
  const stunPenalty = (state.hero.statuses.stun ?? 0) > 0 ? 2 : 0;
  if (stunPenalty > 0) {
    state.hero.statuses.stun = Math.max(0, (state.hero.statuses.stun ?? 1) - 1);
    if (state.hero.statuses.stun === 0) delete state.hero.statuses.stun;
  }

  if (actionId === 'attack') {
    const wAtk = (state.hero.weapon?.atkBonus ?? 0) + (state.hero.relic?.atkBonus ?? 0) - stunPenalty;
    const wDmg = (state.hero.weapon?.dmgBonus ?? 0) + (state.hero.relic?.dmgBonus ?? 0);
    const atkMod = statMod(state.hero.str) + Math.floor(state.hero.level / 2) + 1 + wAtk;
    const res = resolveWeaponAttack(state.rng, atkMod, enemy.ac, 1, 8, statMod(state.hero.str) + wDmg);
    let burnNote = '';
    if (res.hit) {
      enemy.hp -= res.damage;
      enemy.flash = 0.35;
      enemy.squash = { scaleX: 1.25, scaleY: 0.75 };
      if (state.hero.weapon?.burnOnHit) {
        enemy.statuses.burn = 3;
        burnNote = ' (🔥灼燒)';
      }
      events.push('stomp');
      state.juice.triggerHitstop(0.045);
      state.juice.addTrauma(res.crit ? 0.55 : 0.24);
      state.juice.addKick(enemy.x >= state.hero.x ? -2.2 : 2.2, 0);
      state.juice.spawnBurst(enemy.x * TILE_PX + 8, enemy.y * TILE_PX + 8, ['#ffd447', '#ff708d'], 10);
    } else {
      events.push('bounce');
    }
    pushCombatLog(state, `⚔️ 斬擊 ${enemy.name}：${res.summary}${burnNote}`);
  } else if (actionId === 'firebolt') {
    if (state.hero.mp < 3) {
      pushCombatLog(state, '✨ MP 不足 (需 3 MP)！');
      return;
    }
    state.hero.mp -= 3;
    const spellMod = statMod(state.hero.int) + 2 + Math.floor(state.hero.level / 2);
    const dmg = rollDice(state.rng, 2, 6, spellMod).total;
    enemy.hp -= dmg;
    enemy.statuses.burn = Math.max(enemy.statuses.burn ?? 0, 2);
    enemy.flash = 0.4;
    enemy.squash = { scaleX: 0.78, scaleY: 1.25 };
    events.push('ignite');
    state.juice.triggerHitstop(0.05);
    state.juice.addTrauma(0.32);
    state.juice.addKick(enemy.x >= state.hero.x ? -2.8 : 2.8, 0);
    state.juice.triggerFlash('#ff9048', 0.18);
    state.juice.spawnBurst(enemy.x * TILE_PX + 8, enemy.y * TILE_PX + 8, ['#ff9048', '#ffd447', '#fffaf0'], 14);
    pushCombatLog(state, `🔥 火焰箭 (必中) 造成 ${dmg} 傷害並附帶灼燒！`);
  } else if (actionId === 'guard') {
    state.hero.statuses.shield = 2;
    state.hero.mp = Math.min(state.hero.maxMp, state.hero.mp + 2);
    events.push('snap');
    state.juice.spawnBurst(state.hero.visualX + 8, state.hero.visualY + 8, ['#57c7ff', '#fffaf0'], 8);
    pushCombatLog(state, '🛡️ 舉盾防禦！下 2 次受擊減半並恢復 2 MP！');
  } else if (actionId === 'heal') {
    if (state.hero.mp < 4) {
      pushCombatLog(state, '✨ MP 不足 (需 4 MP)！');
      return;
    }
    state.hero.mp -= 4;
    const heal = rollDice(state.rng, 1, 8, statMod(state.hero.int) + 4).total;
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + heal);
    delete state.hero.statuses.poison;
    events.push('star');
    state.juice.spawnBurst(state.hero.visualX + 8, state.hero.visualY + 8, ['#56d39c', '#fffaf0'], 10);
    pushCombatLog(state, `💚 聖光治癒術！恢復 ${heal} HP 並解除中毒。`);
  } else if (actionId === 'potion') {
    if (state.hero.potions <= 0) return;
    state.hero.potions--;
    const heal = rollDice(state.rng, 2, 4, 4).total;
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + heal);
    events.push('star');
    pushCombatLog(state, `🧪 喝下治療藥水！恢復 ${heal} HP。`);
  }

  if (enemy.hp > 0 && (enemy.statuses.burn ?? 0) > 0) {
    enemy.hp -= 3;
    enemy.statuses.burn = (enemy.statuses.burn ?? 1) - 1;
    if (enemy.statuses.burn <= 0) delete enemy.statuses.burn;
    pushCombatLog(state, `🔥 ${enemy.name} 受到 3 點灼燒持續傷害！`);
  }

  if (enemy.hp <= 0) {
    enemy.alive = false;
    state.score += enemy.xpReward * 3;
    state.hero.gold += enemy.goldReward;
    let dropMsg = '';
    if (enemy.lootDrop === 'potion') {
      state.hero.potions++;
      dropMsg = ' ＋藥水×1';
    } else if (enemy.lootDrop === 'armor') {
      dropMsg = ` ＋${equipItem(state, EQUIPMENT_CATALOG.mithril_mail)}`;
    } else if (enemy.lootDrop === 'weapon') {
      dropMsg = ` ＋${equipItem(state, EQUIPMENT_CATALOG.ember_sword)}`;
    } else if (enemy.lootDrop === 'relic') {
      dropMsg = ` ＋${equipItem(state, EQUIPMENT_CATALOG.sage_charm)}`;
    }
    pushCombatLog(state, `🏆 擊敗 ${enemy.name}！+${enemy.xpReward} XP / +${enemy.goldReward}🪙${dropMsg}`);
    grantXp(state, enemy.xpReward, events);
    if (enemy.isBoss) {
      state.score += 800;
      state.phase = { kind: 'won' };
      events.push('win');
      state.juice.applyPreset('explosion', { intensity: 1.2 });
      state.juice.spawnBurst(enemy.x * TILE_PX + 8, enemy.y * TILE_PX + 8, ['#ffd447', '#56d39c', '#ff708d'], 28);
    } else {
      state.hero.x = enemy.x;
      state.hero.y = enemy.y;
      updateFov(state);
      state.phase = { kind: 'explore', menuIdx: 0 };
      events.push('explode');
    }
    return;
  }

  state.phase.turnOwner = 'enemy';
  state.phase.enemyTimer = 0.24;
}

export function runEnemyCombatTurn(state: DndWorldState, events: SimEvent[]): void {
  if (state.phase.kind !== 'combat') return;
  const f = getActiveFloor(state);
  const combatEnemyId = state.phase.entityId;
  const enemy = f.entities.find((e) => e.id === combatEnemyId && e.alive);
  if (!enemy) {
    state.phase = { kind: 'explore', menuIdx: 0 };
    return;
  }

  if ((enemy.isBoss || enemy.isMiniBoss) && state.phase.round % 3 === 0) {
    const base = enemy.isBoss ? rollDice(state.rng, 2, 5, 2).total : rollDice(state.rng, 2, 4, 1).total;
    const breath = applyIncomingDamage(state, base);
    state.hero.hp -= breath;
    state.hero.flash = 0.38;
    events.push('hurt');
    state.juice.applyPreset('player_hurt', { dirX: enemy.x >= state.hero.x ? -1 : 1, intensity: 1.05 });
    pushCombatLog(state, `🐉 ${enemy.name} 施展「${enemy.specialName ?? '重擊'}」！受到 ${breath} 傷害！`);
  } else {
    const res = resolveWeaponAttack(
      state.rng,
      enemy.atkMod,
      state.hero.ac,
      enemy.damageCount,
      enemy.damageSides,
      enemy.damageBonus,
    );
    if (res.hit) {
      const finalDmg = applyIncomingDamage(state, res.damage);
      state.hero.hp -= finalDmg;
      state.hero.flash = 0.32;
      state.hero.squash = { scaleX: 1.24, scaleY: 0.78 };
      let statusMsg = '';
      if (enemy.inflictStatus && state.rng.next() < 0.4) {
        state.hero.statuses[enemy.inflictStatus] = 2;
        statusMsg = ` [${enemy.inflictStatus === 'poison' ? '中毒' : enemy.inflictStatus === 'burn' ? '灼燒' : '震盪'}]`;
      }
      events.push('hurt');
      state.juice.applyPreset('player_hurt', { dirX: enemy.x >= state.hero.x ? -1 : 1, intensity: 0.8 });
      pushCombatLog(state, `🐾 ${enemy.name} 命中造成 ${finalDmg} 傷害${statusMsg}！`);
    } else {
      events.push('snap');
      pushCombatLog(state, `🐾 ${enemy.name} 反擊：${res.summary}`);
    }
  }

  for (const dotKind of ['poison', 'burn'] as const) {
    const rem = state.hero.statuses[dotKind] ?? 0;
    if (rem > 0 && state.hero.hp > 0) {
      state.hero.hp -= 2;
      state.hero.statuses[dotKind] = rem - 1;
      if (state.hero.statuses[dotKind] === 0) delete state.hero.statuses[dotKind];
      pushCombatLog(state, `${dotKind === 'poison' ? '☠️ 中毒' : '🔥 灼燒'}發作，損失 2 HP！`);
    }
  }

  if (state.hero.hp <= 0) {
    state.hero.hp = 0;
    state.phase = { kind: 'lost' };
    return;
  }

  state.phase.round++;
  state.phase.turnOwner = 'player';
}
