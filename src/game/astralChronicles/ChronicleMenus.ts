import type { CutsceneChoiceDef } from '../../core/sim/CutsceneSequencer.ts';
import type { ChroniclePauseTab, SimEvent } from '../../core/types/WorldTypes.ts';
import { CHAPTER_SPECS, GEAR_CATALOG, getGearById } from './AstralChroniclesData.ts';
import {
  castRelicSkill,
  loadChapterWorld,
  startNewCampaign,
  type ChronicleState,
} from './ChronicleCombat.ts';

export function tryBuyGear(s: ChronicleState, gearId: string, events: SimEvent[]): boolean {
  const g = getGearById(gearId);
  if (s.ownedGearIds.has(g.id) || s.heroGold < g.costGold) return false;
  s.heroGold -= g.costGold;
  s.ownedGearIds.add(g.id);
  if (g.slot === 'weapon') s.equippedWeaponId = g.id;
  else if (g.slot === 'armor') s.equippedArmorId = g.id;
  else s.equippedRelicId = g.id;
  events.push('star');
  s.noticeText = `🔨 鍛造入手並自動裝備「${g.name}」！`;
  s.noticeTimer = 2.6;
  return true;
}

export function handleDialogChoice(s: ChronicleState, choiceId: string): void {
  if (choiceId === 'shop_potion') {
    if (s.heroGold >= 30) {
      s.heroGold -= 30;
      s.heroPotions++;
      s.noticeText = `🧪 購買治癒藥水！目前持有 ${s.heroPotions} 瓶`;
      s.noticeTimer = 2.2;
    }
  } else if (choiceId.startsWith('shop_gear:')) {
    const gearId = choiceId.slice('shop_gear:'.length);
    tryBuyGear(s, gearId, []);
  } else if (choiceId === 'shrine_map') {
    s.heroHp = s.heroMaxHp;
    s.heroMp = s.heroMaxMp;
    s.mapCursorIdx = s.chapterIdx;
    s.cutscene.clear(s.camera);
    s.uiMode = 'WORLD_MAP';
    s.noticeText = '✨ 星壇已回復體力並開啟世界地圖！';
    s.noticeTimer = 2.4;
  } else if (choiceId === 'shrine_rest') {
    s.heroHp = s.heroMaxHp;
    s.heroMp = s.heroMaxMp;
    s.noticeText = '💖 星壇祈禱：HP 與星能 MP 已完全回復！';
    s.noticeTimer = 2.4;
  }
}

export function tryUsePotion(s: ChronicleState, events: SimEvent[]): boolean {
  if (s.heroPotions <= 0 || s.heroHp >= s.heroMaxHp) return false;
  s.heroPotions--;
  const heal = Math.round(s.heroMaxHp * 0.55);
  s.heroHp = Math.min(s.heroMaxHp, s.heroHp + heal);
  events.push('star');
  s.juice.spawnBurst(s.hx + 8, s.hy + 8, ['#56d39c', '#fffaf0'], 10, 1.0, { gravity: 0, liftY: -20 });
  s.noticeText = `🧪 飲用藥水！回復 ${heal} HP`;
  s.noticeTimer = 2.0;
  return true;
}

export function interactNearby(s: ChronicleState, events: SimEvent[]): boolean {
  const ch = CHAPTER_SPECS[s.chapterIdx];
  for (const chest of ch.chests) {
    if (s.openedChestIds.has(chest.id)) continue;
    if (Math.hypot(s.hx - chest.x, s.hy - chest.y) < 28) {
      s.openedChestIds.add(chest.id);
      s.heroGold += chest.gold;
      s.score += 150;
      let msg = `💎 開啟寶箱！獲得 ${chest.gold} G`;
      if (chest.potions) {
        s.heroPotions += chest.potions;
        msg += ` 與 藥水×${chest.potions}`;
      }
      if (chest.grantGearId) {
        const g = getGearById(chest.grantGearId);
        s.ownedGearIds.add(g.id);
        if (g.slot === 'weapon') s.equippedWeaponId = g.id;
        else if (g.slot === 'armor') s.equippedArmorId = g.id;
        else s.equippedRelicId = g.id;
        msg += ` ＋ 神兵「${g.name}」`;
      }
      events.push('star');
      s.noticeText = msg;
      s.noticeTimer = 2.8;
      s.juice.spawnBurst(chest.x + 8, chest.y + 8, ['#ffd447', '#fffaf0', '#56d39c'], 14, 1.0, {
        gravity: 0,
        liftY: -22,
      });
      return true;
    }
  }

  for (const npc of ch.npcs) {
    if (Math.hypot(s.hx - npc.x, s.hy - npc.y) < 30) {
      s.uiMode = 'CUTSCENE';
      if (npc.kind === 'shrine') {
        s.cutscene.play([
          { type: 'letterbox', ratio: 0.1, duration: 0.2 },
          { type: 'camera_pan', x: npc.x + 8, y: npc.y + 8, zoom: 1.4, duration: 0.45 },
          {
            type: 'dialog',
            speaker: npc.name,
            speakerRole: npc.role,
            portrait: npc.sprite,
            text: '星辰之光正迴響著你的意志。要在此祈禱完全回復與存檔，或是經由星門展開世界章節大地圖？',
            choices: [
              { id: 'shrine_rest', label: '祈禱回復全員狀態 (HP/MP 100%)', enabled: true },
              { id: 'shrine_map', label: '開啟世界章節大地圖傳送', enabled: true },
              { id: 'leave', label: '繼續探索本區', enabled: true },
            ],
          },
          { type: 'restore_camera', zoom: 1.15, duration: 0.35 },
        ]);
      } else if (npc.kind === 'smith') {
        const nextUpgrade = GEAR_CATALOG.find((g) => !s.ownedGearIds.has(g.id) && g.costGold > 0);
        const choices: CutsceneChoiceDef[] = [
          {
            id: 'shop_potion',
            label: `購買治癒藥水 (30G｜現有 ${s.heroGold}G)`,
            enabled: s.heroGold >= 30,
          },
        ];
        if (nextUpgrade) {
          choices.push({
            id: `shop_gear:${nextUpgrade.id}`,
            label: `鍛造「${nextUpgrade.name}」(${nextUpgrade.costGold}G · ${nextUpgrade.statText})`,
            enabled: s.heroGold >= nextUpgrade.costGold,
          });
        }
        choices.push({ id: 'leave', label: '先逛逛別處', enabled: true });

        s.cutscene.play([
          { type: 'letterbox', ratio: 0.1, duration: 0.2 },
          { type: 'camera_pan', x: npc.x + 8, y: npc.y + 8, zoom: 1.38, duration: 0.45 },
          {
            type: 'dialog',
            speaker: npc.name,
            speakerRole: npc.role,
            portrait: npc.sprite,
            text: nextUpgrade
              ? `好久不見，守望者！手持 ${s.heroGold}G 可以鍛造更強的「${nextUpgrade.name}」或補足藥水！`
              : `所有傳說神兵皆已由你繼承！需要補足生命藥水嗎？`,
            choices,
          },
          { type: 'restore_camera', zoom: 1.15, duration: 0.35 },
        ]);
      } else {
        s.cutscene.play([
          { type: 'letterbox', ratio: 0.1, duration: 0.2 },
          { type: 'camera_pan', x: npc.x + 8, y: npc.y + 8, zoom: 1.38, duration: 0.45 },
          {
            type: 'dialog',
            speaker: npc.name,
            speakerRole: npc.role,
            portrait: npc.sprite,
            text: `${ch.questObjective}。（按 Tab/Esc 隨時可打開選單查看裝備、任務與詳細操作）`,
          },
          { type: 'restore_camera', zoom: 1.15, duration: 0.35 },
        ]);
      }
      events.push('snap');
      return true;
    }
  }
  return false;
}

export function dispatchChronicleCommand(
  s: ChronicleState,
  commandId: string,
  onRetryStage: () => void,
): SimEvent[] {
  const events: SimEvent[] = [];

  if (commandId === 'title_new_game') {
    startNewCampaign(s, 0, false);
    events.push('key');
    return events;
  }
  if (commandId === 'title_continue') {
    if (s.hasSavedState) {
      loadChapterWorld(s, s.chapterIdx, false);
    } else {
      startNewCampaign(s, 0, false);
    }
    events.push('snap');
    return events;
  }
  if (commandId === 'title_world_map' || commandId === 'open_world_map') {
    s.mapCursorIdx = s.chapterIdx;
    s.uiMode = 'WORLD_MAP';
    events.push('snap');
    return events;
  }
  if (commandId === 'return_title') {
    s.uiMode = 'TITLE_MENU';
    s.titleCursorIdx = 0;
    events.push('snap');
    return events;
  }
  if (commandId.startsWith('enter_chapter:')) {
    const idx = Number(commandId.slice('enter_chapter:'.length));
    if (!Number.isNaN(idx) && idx >= 0 && idx < s.unlockedChapters) {
      s.hasSavedState = true;
      s.heroHp = Math.max(Math.ceil(s.heroMaxHp * 0.6), s.heroHp);
      s.heroMp = s.heroMaxMp;
      loadChapterWorld(s, idx, true);
      events.push('key');
    }
    return events;
  }
  if (commandId === 'toggle_pause') {
    if (s.uiMode === 'PLAYING') {
      s.uiMode = 'PAUSED';
      events.push('snap');
    } else if (s.uiMode === 'PAUSED') {
      s.uiMode = 'PLAYING';
      events.push('snap');
    }
    return events;
  }
  if (commandId.startsWith('pause_tab:')) {
    s.pauseTab = commandId.slice('pause_tab:'.length) as ChroniclePauseTab;
    events.push('snap');
    return events;
  }
  if (commandId.startsWith('equip:')) {
    const gearId = commandId.slice('equip:'.length);
    if (s.ownedGearIds.has(gearId)) {
      const g = getGearById(gearId);
      if (g.slot === 'weapon') s.equippedWeaponId = g.id;
      else if (g.slot === 'armor') s.equippedArmorId = g.id;
      else s.equippedRelicId = g.id;
      s.noticeText = `⚔️ 已裝備「${g.name}」(${g.statText})`;
      s.noticeTimer = 2.2;
      events.push('snap');
    }
    return events;
  }
  if (commandId.startsWith('buy_gear:')) {
    tryBuyGear(s, commandId.slice('buy_gear:'.length), events);
    return events;
  }
  if (commandId === 'use_potion') {
    tryUsePotion(s, events);
    return events;
  }
  if (commandId === 'cast_relic') {
    if (s.uiMode === 'PLAYING') {
      castRelicSkill(s, events);
    }
    return events;
  }
  if (commandId === 'dialog_next') {
    if (s.uiMode === 'CUTSCENE') {
      s.cutscene.advanceDialog(s.camera);
      if (!s.cutscene.isActive()) s.uiMode = 'PLAYING';
      events.push('snap');
    }
    return events;
  }
  if (commandId.startsWith('dialog_choice:')) {
    const choiceId = commandId.slice('dialog_choice:'.length);
    if (s.uiMode === 'CUTSCENE') {
      s.cutscene.advanceDialog(s.camera, choiceId);
      if (!s.cutscene.isActive()) s.uiMode = 'PLAYING';
      events.push('snap');
    }
    return events;
  }
  if (commandId === 'next_chapter') {
    if (s.chapterIdx + 1 < CHAPTER_SPECS.length) {
      loadChapterWorld(s, s.chapterIdx + 1, true);
      events.push('key');
    } else {
      s.uiMode = 'ENDING';
    }
    return events;
  }
  if (commandId === 'retry_chapter') {
    onRetryStage();
    events.push('snap');
    return events;
  }

  return events;
}

export function updateMenuNavigation(
  s: ChronicleState,
  dt: number,
  events: SimEvent[],
  onRetryStage: () => void,
): boolean {
  if (s.menuCooldown > 0) s.menuCooldown = Math.max(0, s.menuCooldown - dt);

  const up = s.input.justPressed('up') || (s.input.held('up') && s.menuCooldown <= 0);
  const down = s.input.justPressed('down') || (s.input.held('down') && s.menuCooldown <= 0);
  const left = s.input.justPressed('left') || (s.input.held('left') && s.menuCooldown <= 0);
  const right = s.input.justPressed('right') || (s.input.held('right') && s.menuCooldown <= 0);
  const confirm = s.input.justPressed('action') || s.input.justPressed('jump');

  if (up || down || left || right) s.menuCooldown = 0.2;

  if (s.uiMode === 'TITLE_MENU') {
    const optCount = s.hasSavedState ? 3 : 2;
    if (up) s.titleCursorIdx = (s.titleCursorIdx - 1 + optCount) % optCount;
    if (down) s.titleCursorIdx = (s.titleCursorIdx + 1) % optCount;
    if (s.input.justPressed('skillX') || s.input.justPressed('skillY')) {
      dispatchChronicleCommand(s, 'open_world_map', onRetryStage);
      events.push('snap');
      return true;
    }
    if (confirm) {
      if (s.hasSavedState && s.titleCursorIdx === 0) dispatchChronicleCommand(s, 'title_continue', onRetryStage);
      else if ((s.hasSavedState && s.titleCursorIdx === 2) || (!s.hasSavedState && s.titleCursorIdx === 1)) {
        dispatchChronicleCommand(s, 'title_world_map', onRetryStage);
      } else {
        dispatchChronicleCommand(s, 'title_new_game', onRetryStage);
      }
      events.push('key');
    }
    return true;
  }

  if (s.uiMode === 'WORLD_MAP') {
    if (
      left ||
      up ||
      s.input.justPressed('shoulderL') ||
      (s.input.rightAxisX() < -0.55 && s.menuCooldown <= 0)
    ) {
      s.mapCursorIdx = (s.mapCursorIdx - 1 + CHAPTER_SPECS.length) % CHAPTER_SPECS.length;
      s.menuCooldown = 0.2;
    }
    if (
      right ||
      down ||
      s.input.justPressed('shoulderR') ||
      (s.input.rightAxisX() > 0.55 && s.menuCooldown <= 0)
    ) {
      s.mapCursorIdx = (s.mapCursorIdx + 1) % CHAPTER_SPECS.length;
      s.menuCooldown = 0.2;
    }
    if (s.input.justPressed('action') && s.mapCursorIdx < s.unlockedChapters) {
      dispatchChronicleCommand(s, `enter_chapter:${s.mapCursorIdx}`, onRetryStage);
    } else if (s.input.justPressed('jump') || s.input.justPressed('skillX')) {
      dispatchChronicleCommand(s, 'return_title', onRetryStage);
    }
    return true;
  }

  if (s.uiMode === 'CUTSCENE') {
    if (up || left) {
      s.cutscene.moveChoice(-1);
      events.push('snap');
    }
    if (down || right) {
      s.cutscene.moveChoice(1);
      events.push('snap');
    }
    if (confirm) {
      dispatchChronicleCommand(s, 'dialog_next', onRetryStage);
    }
    return true;
  }

  if (s.uiMode === 'PAUSED') {
    const tabs: ChroniclePauseTab[] = ['status', 'bag', 'quests', 'guide'];
    const cur = tabs.indexOf(s.pauseTab);
    if (left || s.input.justPressed('shoulderL')) {
      s.pauseTab = tabs[(cur - 1 + tabs.length) % tabs.length];
    }
    if (right || s.input.justPressed('shoulderR')) {
      s.pauseTab = tabs[(cur + 1) % tabs.length];
    }
    if (s.input.justPressed('skillX') || s.input.justPressed('jump')) {
      s.uiMode = 'PLAYING';
      return true;
    }
    if (s.input.justPressed('skillY')) {
      tryUsePotion(s, events);
      return true;
    }
    if (s.pauseTab === 'bag') {
      if (up || (s.input.rightAxisY() < -0.55 && s.menuCooldown <= 0)) {
        s.bagCursorIdx = (s.bagCursorIdx - 1 + GEAR_CATALOG.length) % GEAR_CATALOG.length;
        s.menuCooldown = 0.2;
      }
      if (down || (s.input.rightAxisY() > 0.55 && s.menuCooldown <= 0)) {
        s.bagCursorIdx = (s.bagCursorIdx + 1) % GEAR_CATALOG.length;
        s.menuCooldown = 0.2;
      }
      if (s.input.justPressed('action')) {
        const gear = GEAR_CATALOG[s.bagCursorIdx];
        if (gear) {
          if (s.ownedGearIds.has(gear.id)) {
            dispatchChronicleCommand(s, `equip:${gear.id}`, onRetryStage);
          } else {
            tryBuyGear(s, gear.id, events);
          }
        }
      }
    } else if (s.pauseTab === 'status' && s.input.justPressed('action')) {
      tryUsePotion(s, events);
    }
    return true;
  }

  if (s.uiMode === 'CHAPTER_CLEAR' && confirm) {
    dispatchChronicleCommand(s, 'next_chapter', onRetryStage);
    return true;
  }
  if (s.uiMode === 'GAME_OVER' && confirm) {
    onRetryStage();
    return true;
  }
  if (s.uiMode === 'ENDING' && confirm) {
    dispatchChronicleCommand(s, 'title_world_map', onRetryStage);
    return true;
  }

  return false;
}
