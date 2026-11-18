import type { ChronicleHudSnapshot, ChroniclePauseTab } from '../core/types/WorldTypes.ts';
import { CHRONICLE_PAUSE_TABS } from '../game/astralChronicles/ChronicleGearData.ts';
import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import {
  renderChronicleOutcomeModal,
  renderChroniclePauseContent,
  renderChronicleTitleMenu,
  renderChronicleWorldMap,
} from './ChronicleModalViews.ts';
import { atlasSpriteToCanvas } from './MomoMascot.ts';
import { btn, el } from './dom.ts';

export interface ChronicleOverlayCallbacks {
  onCommand: (commandId: string) => void;
}

/**
 * Full-Scale Flagship Action-RPG UI/UX Overlay for PA-05 Astral Chronicles:
 * coordinates title menu, world map, edge combat HUD, cutscenes, pause drawer, and end modals.
 */
export class ChronicleOverlayView {
  public readonly element: HTMLElement;
  private readonly atlas: TextureAtlas;
  private readonly onCommand: (commandId: string) => void;
  private readonly portraitCache = new Map<SpriteId, string>();

  private readonly titleLayer: HTMLElement;
  private readonly titleActions: HTMLElement;
  private lastTitleKey = '';

  private readonly mapLayer: HTMLElement;
  private readonly mapGrid: HTMLElement;
  private readonly mapSummary: HTMLElement;
  private lastMapKey = '';

  private readonly playLayer: HTMLElement;
  private readonly heroBadgeEl: HTMLElement;
  private readonly hpFillEl: HTMLElement;
  private readonly hpTextEl: HTMLElement;
  private readonly mpFillEl: HTMLElement;
  private readonly mpTextEl: HTMLElement;
  private readonly staFillEl: HTMLElement;
  private readonly questTextEl: HTMLElement;
  private readonly bossBarEl: HTMLElement;
  private readonly bossLabelEl: HTMLElement;
  private readonly bossFillEl: HTMLElement;
  private readonly relicBtn: HTMLButtonElement;
  private readonly potionBtn: HTMLButtonElement;
  private readonly promptEl: HTMLElement;
  private readonly tutorialEl: HTMLElement;

  private readonly cutsceneLayer: HTMLElement;
  private readonly titleCardEl: HTMLElement;
  private readonly titleCardHeading: HTMLElement;
  private readonly titleCardSub: HTMLElement;
  private readonly dialogBoxEl: HTMLElement;
  private readonly dialogPortrait: HTMLImageElement;
  private readonly dialogSpeaker: HTMLElement;
  private readonly dialogRole: HTMLElement;
  private readonly dialogText: HTMLElement;
  private readonly dialogChoices: HTMLElement;
  private readonly dialogNextBtn: HTMLButtonElement;
  private lastChoicesKey = '';

  private readonly pauseLayer: HTMLElement;
  private readonly pauseTabRow: HTMLElement;
  private readonly pauseContent: HTMLElement;
  private readonly pauseTabBtns = new Map<ChroniclePauseTab, HTMLButtonElement>();
  private lastPauseKey = '';

  private readonly modalLayer: HTMLElement;
  private readonly modalHeading: HTMLElement;
  private readonly modalBody: HTMLElement;
  private readonly modalActions: HTMLElement;
  private lastModalKey = '';

  constructor(atlas: TextureAtlas, callbacks: ChronicleOverlayCallbacks) {
    this.atlas = atlas;
    this.onCommand = callbacks.onCommand;
    this.element = el('div', 'chr-hud panel-hidden');

    // 1. TITLE_MENU
    this.titleLayer = el('div', 'chr-title panel-hidden');
    const titleBox = el('div', 'chr-title-panel');
    const emblem = el('span', 'chr-title-emblem', 'ENGINE 2.0 · PA-05');
    const h1 = el('h2', 'chr-title-name', '星穹餘燼編年史');
    const sub = el('p', 'chr-title-sub', '五大章節動作冒險 RPG · 動態鏡頭運鏡 × 神兵鍛造 × 遺物奧義');
    this.titleActions = el('div', 'chr-title-actions');
    const titleTips = el('div', 'chr-title-tips', '↑ ↓ 選擇 · A 鍵或點擊確認 · 支援 SRAM 電池存檔');
    titleBox.append(emblem, h1, sub, this.titleActions, titleTips);
    this.titleLayer.appendChild(titleBox);

    // 2. WORLD_MAP
    this.mapLayer = el('div', 'chr-map panel-hidden');
    const mapHead = el('div', 'chr-map-head');
    const mapHeadLeft = el('div', 'chr-map-head-left');
    mapHeadLeft.append(el('strong', 'chr-map-title', '🗺️ 星穹世界大地圖'), el('span', 'chr-map-sub', '選擇已解鎖章節出擊探索'));
    const mapHeadBtns = el('div', 'chr-map-head-btns');
    mapHeadBtns.append(
      btn('chr-btn is-ghost', '↩ 返回標題', undefined, () => this.onCommand('return_title')),
    );
    mapHead.append(mapHeadLeft, mapHeadBtns);
    this.mapGrid = el('div', 'chr-map-grid');
    this.mapSummary = el('div', 'chr-map-foot');
    this.mapLayer.append(mapHead, this.mapGrid, this.mapSummary);

    // 3. PLAYING EDGE HUD
    this.playLayer = el('div', 'chr-play panel-hidden');
    const playTop = el('div', 'chr-top');

    const vitals = el('div', 'chr-vitals');
    this.heroBadgeEl = el('div', 'chr-hero-badge', 'Lv.1 · 60G');

    const hpRow = el('div', 'chr-bar-row');
    const hpTrack = el('div', 'chr-bar-track');
    this.hpFillEl = el('div', 'chr-bar-fill is-hp');
    hpTrack.appendChild(this.hpFillEl);
    this.hpTextEl = el('span', 'chr-bar-val', '100/100');
    hpRow.append(el('span', 'chr-bar-lbl', 'HP'), hpTrack, this.hpTextEl);

    const mpRow = el('div', 'chr-bar-row');
    const mpTrack = el('div', 'chr-bar-track');
    this.mpFillEl = el('div', 'chr-bar-fill is-mp');
    mpTrack.appendChild(this.mpFillEl);
    this.mpTextEl = el('span', 'chr-bar-val', '45/45');
    mpRow.append(el('span', 'chr-bar-lbl', 'MP'), mpTrack, this.mpTextEl);

    const staRow = el('div', 'chr-bar-row is-compact');
    const staTrack = el('div', 'chr-bar-track');
    this.staFillEl = el('div', 'chr-bar-fill is-sta');
    staTrack.appendChild(this.staFillEl);
    staRow.append(el('span', 'chr-bar-lbl', '耐力'), staTrack);

    vitals.append(this.heroBadgeEl, hpRow, mpRow, staRow);

    this.bossBarEl = el('div', 'chr-boss-bar panel-hidden');
    this.bossLabelEl = el('span', 'chr-boss-name');
    const bossTrack = el('div', 'chr-boss-track');
    this.bossFillEl = el('div', 'chr-boss-fill');
    bossTrack.appendChild(this.bossFillEl);
    this.bossBarEl.append(this.bossLabelEl, bossTrack);

    const topRight = el('div', 'chr-top-right');
    this.questTextEl = el('div', 'chr-quest-box');
    const sysBar = el('div', 'chr-sys-bar');
    sysBar.append(
      btn('chr-btn', '🗺 地圖', '開啟世界章節大地圖', () => this.onCommand('open_world_map')),
      btn('chr-btn is-accent', '☰ 選單', '暫停／裝備／教學選單 (Tab / Esc)', () => this.onCommand('toggle_pause')),
    );
    topRight.append(sysBar, this.questTextEl);
    playTop.append(vitals, this.bossBarEl, topRight);

    const playBottom = el('div', 'chr-bottom');
    const skillBar = el('div', 'chr-skill-bar');
    this.relicBtn = btn('chr-btn is-skill', '✨ Q 遺物技', '消耗 MP 釋放遺物奧義 (快捷鍵 Q)', () => {
      this.onCommand('cast_relic');
    });
    this.potionBtn = btn('chr-btn is-heal', '🧪 H 藥水 ×2', '回復 55% HP (快捷鍵 H)', () => {
      this.onCommand('use_potion');
    });
    skillBar.append(this.relicBtn, this.potionBtn);

    const promptStack = el('div', 'chr-prompt-stack');
    this.promptEl = el('div', 'chr-interact-prompt panel-hidden');
    this.tutorialEl = el('div', 'chr-tutorial-hint panel-hidden');
    promptStack.append(this.promptEl, this.tutorialEl);

    playBottom.append(skillBar, promptStack);
    this.playLayer.append(playTop, playBottom);

    // 4. CUTSCENE LAYER
    this.cutsceneLayer = el('div', 'chr-cutscene panel-hidden');
    this.titleCardEl = el('div', 'chr-titlecard panel-hidden');
    this.titleCardHeading = el('h3', 'chr-titlecard-h');
    this.titleCardSub = el('p', 'chr-titlecard-p');
    this.titleCardEl.append(this.titleCardHeading, this.titleCardSub);

    this.dialogBoxEl = el('div', 'chr-dialog panel-hidden');
    const portraitFrame = el('div', 'chr-portrait-frame');
    this.dialogPortrait = el('img', 'chr-portrait-img');
    this.dialogPortrait.alt = '角色頭像';
    portraitFrame.appendChild(this.dialogPortrait);

    const dialogMain = el('div', 'chr-dialog-main');
    const dialogHead = el('div', 'chr-dialog-head');
    this.dialogSpeaker = el('strong', 'chr-dialog-speaker');
    this.dialogRole = el('span', 'chr-dialog-role');
    dialogHead.append(this.dialogSpeaker, this.dialogRole);
    this.dialogText = el('p', 'chr-dialog-text');
    this.dialogChoices = el('div', 'chr-dialog-choices panel-hidden');
    const dialogFoot = el('div', 'chr-dialog-foot');
    this.dialogNextBtn = btn('chr-btn is-accent', '繼續 A ▸', undefined, () => {
      this.onCommand('dialog_next');
    });
    dialogFoot.appendChild(this.dialogNextBtn);
    dialogMain.append(dialogHead, this.dialogText, this.dialogChoices, dialogFoot);
    this.dialogBoxEl.append(portraitFrame, dialogMain);

    this.cutsceneLayer.append(this.titleCardEl, this.dialogBoxEl);

    // 5. PAUSED DRAWER
    this.pauseLayer = el('div', 'chr-pause panel-hidden');
    const pauseCard = el('div', 'chr-pause-card');
    const pauseHead = el('div', 'chr-pause-head');
    pauseHead.append(el('strong', 'chr-pause-title', '⚔️ 守望者日誌與整備'));
    const pauseCloseGroup = el('div', 'chr-pause-head-btns');
    pauseCloseGroup.append(
      btn('chr-btn', '🗺 世界地圖', undefined, () => this.onCommand('open_world_map')),
      btn('chr-btn is-ghost', '標題畫面', undefined, () => this.onCommand('return_title')),
      btn('chr-btn is-accent', '▶ 返回冒險', undefined, () => this.onCommand('toggle_pause')),
    );
    pauseHead.appendChild(pauseCloseGroup);

    this.pauseTabRow = el('div', 'chr-tab-row');
    for (const tab of CHRONICLE_PAUSE_TABS) {
      const tBtn = btn('chr-tab', tab.label, undefined, () => {
        this.onCommand(`pause_tab:${tab.id}`);
      });
      this.pauseTabBtns.set(tab.id, tBtn);
      this.pauseTabRow.appendChild(tBtn);
    }

    this.pauseContent = el('div', 'chr-pause-body');
    pauseCard.append(pauseHead, this.pauseTabRow, this.pauseContent);
    this.pauseLayer.appendChild(pauseCard);

    // 6. CHAPTER_CLEAR / GAME_OVER / ENDING MODAL
    this.modalLayer = el('div', 'chr-modal panel-hidden');
    const modalCard = el('div', 'chr-modal-card');
    this.modalHeading = el('h3', 'chr-modal-h');
    this.modalBody = el('p', 'chr-modal-p');
    this.modalActions = el('div', 'chr-modal-actions');
    modalCard.append(this.modalHeading, this.modalBody, this.modalActions);
    this.modalLayer.appendChild(modalCard);

    this.element.append(
      this.titleLayer,
      this.mapLayer,
      this.playLayer,
      this.cutsceneLayer,
      this.pauseLayer,
      this.modalLayer,
    );
  }

  public reset(): void {
    this.element.classList.add('panel-hidden');
    this.lastTitleKey = '';
    this.lastMapKey = '';
    this.lastChoicesKey = '';
    this.lastPauseKey = '';
    this.lastModalKey = '';
  }

  private getPortraitUrl(sprite: SpriteId): string {
    const cached = this.portraitCache.get(sprite);
    if (cached) return cached;
    const url = atlasSpriteToCanvas(this.atlas, sprite).toDataURL('image/png');
    this.portraitCache.set(sprite, url);
    return url;
  }

  public render(hud: ChronicleHudSnapshot | undefined, isRunning: boolean): void {
    if (!hud || !isRunning) {
      if (!this.element.classList.contains('panel-hidden')) this.reset();
      return;
    }

    this.element.classList.remove('panel-hidden');
    const mode = hud.uiMode;

    this.titleLayer.classList.toggle('panel-hidden', mode !== 'TITLE_MENU');
    this.mapLayer.classList.toggle('panel-hidden', mode !== 'WORLD_MAP');
    this.playLayer.classList.toggle('panel-hidden', mode !== 'PLAYING');
    this.cutsceneLayer.classList.toggle('panel-hidden', mode !== 'CUTSCENE');
    this.pauseLayer.classList.toggle('panel-hidden', mode !== 'PAUSED');
    this.modalLayer.classList.toggle(
      'panel-hidden',
      mode !== 'CHAPTER_CLEAR' && mode !== 'GAME_OVER' && mode !== 'ENDING',
    );

    if (mode === 'TITLE_MENU') {
      const key = `${hud.hasSavedRun}|${hud.titleCursorIdx}|${hud.chapterIndex}|${hud.hero.level}`;
      if (key !== this.lastTitleKey) {
        this.lastTitleKey = key;
        renderChronicleTitleMenu(hud, this.titleActions, this.onCommand);
      }
      return;
    }
    if (mode === 'WORLD_MAP') {
      const key =
        `${hud.mapCursorIdx}|${hud.chapterIndex}|` +
        hud.chapters.map((c) => `${c.unlocked ? 1 : 0}${c.cleared ? 1 : 0}${c.chestsFound}`).join(',');
      if (key !== this.lastMapKey) {
        this.lastMapKey = key;
        renderChronicleWorldMap(hud, this.mapGrid, this.mapSummary, this.onCommand);
      }
      return;
    }
    if (mode === 'PLAYING') {
      this.renderPlayingHud(hud);
      return;
    }
    if (mode === 'CUTSCENE') {
      this.renderCutscene(hud);
      return;
    }
    if (mode === 'PAUSED') {
      for (const [id, tabBtn] of this.pauseTabBtns) {
        tabBtn.classList.toggle('is-active', id === hud.pauseTab);
      }
      const activeGearIdx = hud.bagCursorIdx ?? 0;
      const pKey = `${hud.pauseTab}|${activeGearIdx}|${hud.hero.level}|${hud.hero.hp}|${hud.hero.gold}|${hud.hero.potions}|${hud.hero.equippedWeaponName}|${hud.hero.equippedArmorName}|${hud.hero.equippedRelicName}|${hud.gear.map((g) => (g.owned ? 1 : 0)).join('')}`;
      if (pKey !== this.lastPauseKey) {
        this.lastPauseKey = pKey;
        renderChroniclePauseContent(hud, this.pauseContent, this.onCommand);
      }
      return;
    }

    const key = `${hud.uiMode}|${hud.chapterIndex}|${hud.hero.level}|${hud.hero.kills}|${hud.hero.chestsFound}`;
    if (key !== this.lastModalKey) {
      this.lastModalKey = key;
      renderChronicleOutcomeModal(hud, this.modalHeading, this.modalBody, this.modalActions, this.onCommand);
    }
  }

  private renderPlayingHud(hud: ChronicleHudSnapshot): void {
    const h = hud.hero;
    this.heroBadgeEl.textContent = `第${hud.chapterIndex + 1}章 · Lv.${h.level} · 💰 ${h.gold}G`;

    const hpPct = Math.max(0, Math.min(100, (h.hp / Math.max(1, h.maxHp)) * 100));
    this.hpFillEl.style.width = `${hpPct}%`;
    this.hpTextEl.textContent = `${h.hp}/${h.maxHp}`;

    const mpPct = Math.max(0, Math.min(100, (h.mp / Math.max(1, h.maxMp)) * 100));
    this.mpFillEl.style.width = `${mpPct}%`;
    this.mpTextEl.textContent = `${h.mp}/${h.maxMp}`;

    const staPct = Math.max(0, Math.min(100, (h.stamina / Math.max(1, h.maxStamina)) * 100));
    this.staFillEl.style.width = `${staPct}%`;

    this.questTextEl.textContent = `🎯 ${hud.questObjective}`;

    if (hud.boss) {
      this.bossBarEl.classList.remove('panel-hidden');
      this.bossBarEl.classList.toggle('is-phase2', hud.boss.phase === 2);
      this.bossLabelEl.textContent = `P${hud.boss.phase} ${hud.boss.name}`;
      const bPct = Math.max(0, Math.min(100, (hud.boss.hp / Math.max(1, hud.boss.maxHp)) * 100));
      this.bossFillEl.style.width = `${bPct}%`;
    } else {
      this.bossBarEl.classList.add('panel-hidden');
    }

    this.relicBtn.textContent = `✨ Q ${h.equippedRelicName} (${h.relicMpCost}MP)`;
    this.relicBtn.disabled = h.mp < h.relicMpCost;
    this.potionBtn.textContent = `🧪 H 藥水 ×${h.potions}`;
    this.potionBtn.disabled = h.potions <= 0 || h.hp >= h.maxHp;

    if (hud.interactPrompt) {
      this.promptEl.classList.remove('panel-hidden');
      this.promptEl.textContent = hud.interactPrompt;
    } else {
      this.promptEl.classList.add('panel-hidden');
    }

    if (hud.tutorialHint) {
      this.tutorialEl.classList.remove('panel-hidden');
      this.tutorialEl.textContent = hud.tutorialHint;
    } else {
      this.tutorialEl.classList.add('panel-hidden');
    }
  }

  private renderCutscene(hud: ChronicleHudSnapshot): void {
    const cs = hud.cutscene;
    if (!cs) {
      this.titleCardEl.classList.add('panel-hidden');
      this.dialogBoxEl.classList.add('panel-hidden');
      return;
    }

    if (cs.bossTitleCard) {
      this.titleCardEl.classList.remove('panel-hidden');
      this.titleCardHeading.textContent = cs.bossTitleCard.title;
      this.titleCardSub.textContent = cs.bossTitleCard.subtitle;
    } else {
      this.titleCardEl.classList.add('panel-hidden');
    }

    if (cs.text) {
      this.dialogBoxEl.classList.remove('panel-hidden');
      this.dialogPortrait.src = this.getPortraitUrl(cs.portraitSprite);
      this.dialogSpeaker.textContent = cs.speaker;
      this.dialogRole.textContent = cs.speakerRole;
      this.dialogText.textContent = cs.text;

      if (cs.choices && cs.choices.length > 0) {
        this.dialogChoices.classList.remove('panel-hidden');
        this.dialogNextBtn.classList.add('panel-hidden');
        const cKey = `${cs.selectedChoiceIdx}|${cs.choices.map((c) => `${c.id}:${c.enabled}`).join(',')}`;
        if (cKey !== this.lastChoicesKey) {
          this.lastChoicesKey = cKey;
          this.dialogChoices.textContent = '';
          cs.choices.forEach((choice, idx) => {
            const b = btn(
              `chr-choice${idx === cs.selectedChoiceIdx ? ' is-selected' : ''}`,
              choice.label,
              undefined,
              () => this.onCommand(`dialog_choice:${choice.id}`),
            );
            b.disabled = !choice.enabled;
            this.dialogChoices.appendChild(b);
          });
        }
      } else {
        this.dialogChoices.classList.add('panel-hidden');
        this.dialogNextBtn.classList.remove('panel-hidden');
        this.lastChoicesKey = '';
      }
    } else {
      this.dialogBoxEl.classList.add('panel-hidden');
    }
  }
}
