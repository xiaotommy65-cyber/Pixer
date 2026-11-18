import type { ChronicleHudSnapshot } from '../core/types/WorldTypes.ts';
import { btn, el } from './dom.ts';

export function renderChronicleTitleMenu(
  hud: ChronicleHudSnapshot,
  container: HTMLElement,
  onCommand: (commandId: string) => void,
): void {
  container.textContent = '';
  const options: { cmd: string; label: string }[] = [];
  if (hud.hasSavedRun) {
    options.push({
      cmd: 'title_continue',
      label: `▶ 繼續冒險（第 ${hud.chapterIndex + 1} 章 · Lv.${hud.hero.level}）`,
    });
  }
  options.push({ cmd: 'title_new_game', label: '✨ 從頭展開旅程' });
  options.push({ cmd: 'title_world_map', label: '🗺️ 世界章節大地圖' });

  options.forEach((opt, idx) => {
    const b = btn(
      `chr-btn chr-title-btn${idx === hud.titleCursorIdx ? ' is-selected' : ''}`,
      opt.label,
      undefined,
      () => onCommand(opt.cmd),
    );
    container.appendChild(b);
  });
}

export function renderChronicleWorldMap(
  hud: ChronicleHudSnapshot,
  gridEl: HTMLElement,
  summaryEl: HTMLElement,
  onCommand: (commandId: string) => void,
): void {
  gridEl.textContent = '';
  for (const ch of hud.chapters) {
    const isSelected = ch.index === hud.mapCursorIdx;
    const card = document.createElement('button');
    card.type = 'button';
    card.disabled = !ch.unlocked;
    card.className = `chr-card${isSelected ? ' is-selected' : ''}${ch.cleared ? ' is-cleared' : ''}`;
    card.style.setProperty('--chr-accent', ch.accentHex);
    if (ch.unlocked) {
      card.addEventListener('click', () => onCommand(`enter_chapter:${ch.index}`));
    }

    const head = el('div', 'chr-card-head');
    const statusTxt = ch.cleared ? '✓ 已討伐' : ch.unlocked ? '可探索' : '🔒 未解鎖';
    head.append(el('span', 'chr-card-num', `CH.${ch.index + 1}`), el('span', 'chr-card-state', statusTxt));

    const title = el('strong', 'chr-card-title', ch.title);
    const sub = el('span', 'chr-card-sub', ch.subtitle);
    const meta = el(
      'div',
      'chr-card-meta',
      `建議 Lv.${ch.levelReq} · 💎 ${ch.chestsFound}/${ch.chestsTotal}`,
    );
    card.append(head, title, sub, meta);
    gridEl.appendChild(card);
  }

  summaryEl.textContent = `Lv.${hud.hero.level} ${hud.hero.name} · ⚔️ ATK ${hud.hero.atk} · 🛡️ DEF ${hud.hero.def} · 💰 ${hud.hero.gold}G · 寶箱 ${hud.hero.chestsFound}/${hud.hero.chestsTotal}`;
}

export function renderChroniclePauseContent(
  hud: ChronicleHudSnapshot,
  pauseContent: HTMLElement,
  onCommand: (commandId: string) => void,
): void {
  pauseContent.textContent = '';
  const h = hud.hero;

  if (hud.pauseTab === 'status') {
    const grid = el('div', 'chr-status-grid');
    const left = el('div', 'chr-status-col');
    left.append(
      el('div', 'chr-stat-line', `稱號：Lv.${h.level} ${h.name}`),
      el('div', 'chr-stat-line', `經驗値：${h.xp} / ${h.nextXp} XP`),
      el('div', 'chr-stat-line', `生命值：${h.hp} / ${h.maxHp} HP`),
      el('div', 'chr-stat-line', `星界魔力：${h.mp} / ${h.maxMp} MP`),
      el('div', 'chr-stat-line', `攻擊力 ATK：${h.atk} ｜ 防禦力 DEF：${h.def}`),
      el('div', 'chr-stat-line', `持有金幣：${h.gold}G ｜ 累計討伐：${h.kills} 體`),
    );
    const right = el('div', 'chr-status-col');
    right.append(
      el('div', 'chr-stat-line', `⚔️ 目前武器：${h.equippedWeaponName}`),
      el('div', 'chr-stat-line', `🛡️ 目前防具：${h.equippedArmorName}`),
      el('div', 'chr-stat-line', `✨ 裝備遺物：${h.equippedRelicName}`),
      el('div', 'chr-stat-line', `🧪 治癒藥水：${h.potions} 瓶`),
    );
    const healBtn = btn('chr-btn is-heal', '🧪 立即飲用治癒藥水', undefined, () => onCommand('use_potion'));
    healBtn.disabled = h.potions <= 0 || h.hp >= h.maxHp;
    right.appendChild(healBtn);
    grid.append(left, right);
    pauseContent.appendChild(grid);
    return;
  }

  if (hud.pauseTab === 'bag') {
    const activeGearIdx = hud.bagCursorIdx ?? 0;
    const list = el('div', 'chr-gear-list');
    hud.gear.forEach((g, idx) => {
      const isSelected = idx === activeGearIdx;
      const row = el('div', `chr-gear-row${g.equipped ? ' is-equipped' : ''}${isSelected ? ' is-selected' : ''}`);
      const info = el('div', 'chr-gear-info');
      const slotIcon = g.slot === 'weapon' ? '⚔️' : g.slot === 'armor' ? '🛡️' : '✨';
      info.append(
        el('strong', 'chr-gear-name', `${slotIcon} ${g.name} (${g.statText})`),
        el('span', 'chr-gear-desc', g.desc),
      );
      let actionBtn: HTMLButtonElement;
      if (g.equipped) {
        actionBtn = btn('chr-btn is-accent', '已裝備');
        actionBtn.disabled = true;
      } else if (g.owned) {
        actionBtn = btn('chr-btn', '換上裝備', undefined, () => onCommand(`equip:${g.id}`));
      } else {
        actionBtn = btn('chr-btn is-heal', `🔨 鍛造 ${g.costGold}G`, undefined, () => {
          onCommand(`buy_gear:${g.id}`);
        });
        actionBtn.disabled = h.gold < g.costGold;
      }
      row.append(info, actionBtn);
      list.appendChild(row);
    });
    pauseContent.appendChild(list);
    return;
  }

  if (hud.pauseTab === 'quests') {
    const wrap = el('div', 'chr-quest-list');
    wrap.appendChild(el('div', 'chr-quest-current', `當前任務目標：${hud.questObjective}`));
    for (const ch of hud.chapters) {
      const state = ch.cleared ? '✓ 已討伐' : ch.unlocked ? '進行中／可前往' : '尚未解鎖';
      wrap.appendChild(
        el(
          'div',
          'chr-quest-row',
          `CH.${ch.index + 1} ${ch.title} — ${state} ｜ 寶箱 ${ch.chestsFound}/${ch.chestsTotal}`,
        ),
      );
    }
    pauseContent.appendChild(wrap);
    return;
  }

  // Guide tab
  const guide = el('div', 'chr-guide-list');
  guide.append(
    el('div', 'chr-guide-item', '【移動與視野】方向鍵 / WASD / 虛擬搖桿自由探索，鏡頭具備速度前瞻與場景運鏡。'),
    el('div', 'chr-guide-item', '【三段連擊與互動】按 A / X 鍵揮舞劍氣連擊；靠近寶箱、星壇或鐵匠按 A 互動或鍛造神兵。'),
    el('div', 'chr-guide-item', '【無敵閃避翻滾】按 B / Space 消耗耐力瞬間翻滾衝刺，過程具備無敵幀可穿越敵方彈幕。'),
    el('div', 'chr-guide-item', '【遺物技與道具】按 Q 鍵釋放裝備中的元素遺物技；按 H 鍵快速飲用生命藥水。'),
    el('div', 'chr-guide-item', '【星壇與進度保存】與關卡中星壇互動可全滿回復或透過世界地圖傳送至任意已解鎖章節。'),
  );
  pauseContent.appendChild(guide);
}

export function renderChronicleOutcomeModal(
  hud: ChronicleHudSnapshot,
  headingEl: HTMLElement,
  bodyEl: HTMLElement,
  actionsEl: HTMLElement,
  onCommand: (commandId: string) => void,
): void {
  actionsEl.textContent = '';
  if (hud.uiMode === 'CHAPTER_CLEAR') {
    headingEl.textContent = `🏆 第 ${hud.chapterIndex + 1} 章「${hud.chapterTitle}」討伐完成！`;
    bodyEl.textContent = `守衛 Boss 已被擊潰，下一座星穹領域已開啟！目前 Lv.${hud.hero.level} · 收集寶箱 ${hud.hero.chestsFound}/${hud.hero.chestsTotal}`;
    actionsEl.append(
      btn('chr-btn is-accent', '▶ 前往下一章', undefined, () => onCommand('next_chapter')),
      btn('chr-btn', '🗺 世界大地圖', undefined, () => onCommand('open_world_map')),
    );
    return;
  }

  if (hud.uiMode === 'GAME_OVER') {
    headingEl.textContent = '💀 守望者力竭倒下…';
    bodyEl.textContent = `你在「${hud.chapterTitle}」遭敵軍擊退。可保留等級與鍛造神兵直接重試本章！`;
    actionsEl.append(
      btn('chr-btn is-accent', '↺ 重試本章節', undefined, () => onCommand('retry_chapter')),
      btn('chr-btn', '🗺 世界大地圖', undefined, () => onCommand('open_world_map')),
    );
    return;
  }

  headingEl.textContent = '🌠 星穹黎明重臨！全五章編年史完破！';
  bodyEl.textContent = `你成功淨化星界核心王座，擊敗星穹蝕龍皇！\n最終等級 Lv.${hud.hero.level} · 擊破敵軍 ${hud.hero.kills} 體 · 尋獲寶箱 ${hud.hero.chestsFound}/${hud.hero.chestsTotal}`;
  actionsEl.append(
    btn('chr-btn is-accent', '🗺 自由探索五章地圖', undefined, () => onCommand('open_world_map')),
    btn('chr-btn', '✨ 二周目新冒險', undefined, () => onCommand('title_new_game')),
    btn('chr-btn is-ghost', '返回標題畫面', undefined, () => onCommand('return_title')),
  );
}
