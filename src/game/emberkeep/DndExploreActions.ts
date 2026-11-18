import { computeVisibility, findNextStep, hasLineOfSight } from '../../core/sim/GridPathfinder.ts';
import type { SimEvent } from '../../core/types/WorldTypes.ts';
import {
  TILE_PX,
  findEntityAt,
  getActiveFloor,
  isOpaqueAt,
  isWalkableAt,
  type DndWorldState,
} from './DndTypes.ts';
import { EQUIPMENT_CATALOG, rollDice, skillCheck, type EquipmentItem } from './RpgRules.ts';

export function pushCombatLog(state: DndWorldState, msg: string): void {
  state.combatLog.unshift(msg);
  if (state.combatLog.length > 4) state.combatLog.length = 4;
}

export function recalcEquipmentBonuses(state: DndWorldState): void {
  const baseAc = 14 + Math.floor((state.hero.dex - 14) / 2);
  state.hero.ac = baseAc + (state.hero.armor?.acBonus ?? 0) + (state.hero.relic?.acBonus ?? 0);
}

export function updateFov(state: DndWorldState): void {
  const f = getActiveFloor(state);
  const radius = 5 + (state.blackboard.sage_blessing ? 2 : 0) + (state.hero.relic?.visionBonus ?? 0);
  f.visible = computeVisibility(f.width, f.height, { x: state.hero.x, y: state.hero.y }, radius, (x, y) =>
    isOpaqueAt(f, x, y),
  );
  for (const k of f.visible) f.explored.add(k);
}

export function equipItem(state: DndWorldState, item: EquipmentItem): string {
  const prev = state.hero[item.slot];
  const prevScore = (prev?.atkBonus ?? 0) * 2 + (prev?.dmgBonus ?? 0) * 2 + (prev?.acBonus ?? 0) * 3 + (prev?.visionBonus ?? 0);
  const nextScore = (item.atkBonus ?? 0) * 2 + (item.dmgBonus ?? 0) * 2 + (item.acBonus ?? 0) * 3 + (item.visionBonus ?? 0);
  if (prev && prevScore >= nextScore) {
    state.hero.gold += Math.round(item.price * 0.4);
    return `已裝備更強的「${prev.name}」，折抵獲得 ${Math.round(item.price * 0.4)} 金幣！`;
  }
  state.hero[item.slot] = item;
  if (item.maxHpBonus) {
    const gain = item.maxHpBonus - (prev?.maxHpBonus ?? 0);
    if (gain > 0) {
      state.hero.maxHp += gain;
      state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + gain);
    }
  }
  recalcEquipmentBonuses(state);
  updateFov(state);
  return `裝備「${item.name}」！（AC ${state.hero.ac}）`;
}

export function enterFloor(state: DndWorldState, idx: number, onCameraSnap: () => void): void {
  state.floorIdx = Math.max(0, Math.min(state.floors.length - 1, idx));
  const f = getActiveFloor(state);
  state.hero.x = f.def.spawn.x;
  state.hero.y = f.def.spawn.y;
  state.hero.visualX = state.hero.x * TILE_PX;
  state.hero.visualY = state.hero.y * TILE_PX;
  updateFov(state);
  onCameraSnap();
}

export function grantXp(state: DndWorldState, amount: number, events: SimEvent[]): void {
  state.hero.xp += amount;
  while (state.hero.xp >= state.hero.nextXp) {
    state.hero.xp -= state.hero.nextXp;
    state.hero.level++;
    state.hero.nextXp = Math.round(state.hero.nextXp * 1.5);
    state.hero.maxHp += 6;
    state.hero.hp = state.hero.maxHp;
    state.hero.maxMp += 3;
    state.hero.mp = state.hero.maxMp;
    state.hero.str += 1;
    if (state.hero.level % 2 === 0) state.hero.dex += 1;
    recalcEquipmentBonuses(state);
    events.push('key');
    state.juice.triggerFlash('#ffd447', 0.22);
    pushCombatLog(state, `🌟 升級到 Lv.${state.hero.level}！MaxHP+6 / STR+1 / 狀態全滿！`);
  }
}

export function stepOverworldMonsters(state: DndWorldState, events: SimEvent[]): void {
  const f = getActiveFloor(state);
  for (const m of f.entities) {
    if (!m.alive || m.kind !== 'monster' || m.isBoss || m.isMiniBoss) continue;
    if (!f.visible.has(m.y * f.width + m.x)) continue;
    const dist = Math.abs(m.x - state.hero.x) + Math.abs(m.y - state.hero.y);
    if (dist <= 1) {
      state.phase = { kind: 'combat', entityId: m.id, turnOwner: 'player', round: 1, enemyTimer: 0, selectedIdx: 0 };
      events.push('bounce');
      pushCombatLog(state, `⚔️ ${m.name} 搶先攔截！進入回合戰！`);
      return;
    }
    if (dist <= 5 && hasLineOfSight({ x: m.x, y: m.y }, { x: state.hero.x, y: state.hero.y }, (x, y) => isOpaqueAt(f, x, y))) {
      const next = findNextStep(f.width, f.height, { x: m.x, y: m.y }, { x: state.hero.x, y: state.hero.y }, (x, y) => {
        if (!isWalkableAt(f, x, y, false)) return false;
        const occ = findEntityAt(f, x, y);
        return !occ;
      });
      if (next) {
        if (next.x === state.hero.x && next.y === state.hero.y) {
          state.phase = { kind: 'combat', entityId: m.id, turnOwner: 'player', round: 1, enemyTimer: 0, selectedIdx: 0 };
          events.push('bounce');
          pushCombatLog(state, `⚔️ ${m.name} 衝上來開戰！`);
          return;
        }
        m.x = next.x;
        m.y = next.y;
      }
    }
  }
}

export function tryStepGrid(
  state: DndWorldState,
  nx: number,
  ny: number,
  events: SimEvent[],
  onCameraSnap: () => void,
): void {
  const f = getActiveFloor(state);
  if (nx < 0 || ny < 0 || nx >= f.width || ny >= f.height || f.grid[ny][nx] === 'wall') {
    state.hero.squash = { scaleX: 1.18, scaleY: 0.86 };
    return;
  }

  const ent = findEntityAt(f, nx, ny);
  if (ent) {
    if (ent.kind === 'monster') {
      state.phase = { kind: 'combat', entityId: ent.id, turnOwner: 'player', round: 1, enemyTimer: 0, selectedIdx: 0 };
      events.push('bounce');
      state.juice.addTrauma(0.25);
      pushCombatLog(state, `⚔️ 遭遇 ${ent.name} (AC${ent.ac} · HP${ent.hp})！`);
      return;
    }
    if (ent.kind === 'chest') {
      if (!ent.opened) {
        ent.opened = true;
        ent.sprite = 'chest_open';
        ent.flash = 0.25;
        state.chestsCollected++;
        state.score += 120;
        if (ent.loot === 'key') {
          state.hero.keys++;
          events.push('key');
          pushCombatLog(state, '🗝️ 打開寶箱獲得「古代鐵鑰匙」！');
        } else if (ent.loot === 'gold') {
          state.hero.gold += 35;
          events.push('star');
          pushCombatLog(state, '🪙 打開寶箱獲得 35 金幣！');
        } else if (ent.loot === 'elixir') {
          state.hero.potions += 2;
          state.hero.mp = Math.min(state.hero.maxMp, state.hero.mp + 6);
          events.push('star');
          pushCombatLog(state, '✨ 打開神秘箱獲得 治療藥水×2 與 6 MP！');
        } else if (ent.loot === 'weapon' || ent.loot === 'armor' || ent.loot === 'relic') {
          const fallbackId = ent.loot === 'weapon' ? 'iron_blade' : ent.loot === 'armor' ? 'leather_vest' : 'sun_lantern';
          const item = EQUIPMENT_CATALOG[ent.itemId ?? fallbackId];
          if (item) {
            const msg = equipItem(state, item);
            events.push('key');
            pushCombatLog(state, `✨ 寶箱發現裝備：${msg}`);
          } else {
            state.hero.potions++;
            events.push('star');
            pushCombatLog(state, '🧪 打開寶箱獲得「治療藥水 ×1」！');
          }
        } else {
          state.hero.potions++;
          events.push('star');
          pushCombatLog(state, '🧪 打開寶箱獲得「治療藥水 ×1」！');
        }
        state.juice.spawnBurst(nx * TILE_PX + 8, ny * TILE_PX + 8, ['#ffd447', '#fffaf0'], 12);
      }
      state.turnCount++;
      return;
    }
    if (ent.kind === 'npc' && ent.dialogId && state.moduleDef.dialogs[ent.dialogId]) {
      if (ent.talked) {
        events.push('snap');
        pushCombatLog(state, `🧙 ${ent.name}：「願餘燼與勇氣常伴你左右！」`);
        return;
      }
      ent.talked = true;
      state.phase = { kind: 'dialog', entityId: ent.id, dialogId: ent.dialogId, selectedIdx: 0 };
      events.push('star');
      return;
    }
  }

  const tile = f.grid[ny][nx];
  if (tile === 'door') {
    f.grid[ny][nx] = 'floor';
    state.blackboard[`door_${state.floorIdx}_${nx}_${ny}`] = true;
    state.turnCount++;
    events.push('bounce');
    updateFov(state);
    pushCombatLog(state, '🚪 推開了沉重的地牢木門。');
    return;
  }
  if (tile === 'locked_door') {
    if (state.hero.keys > 0) {
      state.hero.keys--;
      f.grid[ny][nx] = 'floor';
      state.turnCount++;
      events.push('key');
      state.juice.triggerFlash('#ffd447', 0.2);
      updateFov(state);
      pushCombatLog(state, '🔓 使用鐵鑰匙解開了古代鐵門！');
    } else {
      events.push('hurt');
      pushCombatLog(state, '🔒 門已上鎖！需要鐵鑰匙（去寶箱找找）。');
    }
    return;
  }

  state.hero.x = nx;
  state.hero.y = ny;
  state.hero.squash = { scaleX: 0.88, scaleY: 1.14 };
  state.turnCount++;
  updateFov(state);

  if (tile === 'campfire') {
    f.grid[ny][nx] = 'floor';
    state.hero.hp = Math.min(state.hero.maxHp, state.hero.hp + 12);
    state.hero.mp = Math.min(state.hero.maxMp, state.hero.mp + 6);
    state.hero.statuses = {};
    state.score += 40;
    events.push('star');
    state.juice.triggerFlash('#ffae42', 0.16);
    state.juice.spawnBurst(nx * TILE_PX + 8, ny * TILE_PX + 8, ['#ffae42', '#ffd447', '#fffaf0'], 14);
    pushCombatLog(state, '🔥 營火旁歇息！恢復 12 HP / 6 MP 並淨化異常狀態！');
  } else if (tile === 'trap') {
    f.grid[ny][nx] = 'floor';
    const chk = skillCheck(state.rng, state.hero, 'dex', 12);
    if (chk.passed) {
      state.score += 50;
      events.push('bounce');
      pushCombatLog(state, `⚡ DEX 檢定 ${chk.roll.text} ≥ 12！敏捷閃過了地刺陷阱！`);
    } else {
      const dmg = rollDice(state.rng, 1, 6, 0).total;
      state.hero.hp -= dmg;
      state.hero.flash = 0.35;
      events.push('hurt');
      state.juice.addTrauma(0.45);
      state.juice.triggerFlash('#ff708d', 0.25);
      pushCombatLog(state, `💥 觸發陷阱 (${chk.roll.text} < 12)！受到 ${dmg} 穿刺傷害！`);
      if (state.hero.hp <= 0) {
        state.hero.hp = 0;
        state.phase = { kind: 'lost' };
        return;
      }
    }
  } else if (tile === 'stairs_down') {
    if (state.floorIdx + 1 < state.floors.length) {
      enterFloor(state, state.floorIdx + 1, onCameraSnap);
      events.push('key');
      state.score += 200;
      state.juice.triggerFlash('#e0aaff', 0.24);
      pushCombatLog(state, `🪜 踏下石階，進入「${getActiveFloor(state).def.name}」！`);
      return;
    }
  }

  stepOverworldMonsters(state, events);
}
