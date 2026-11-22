import type { ShmupHudSnapshot } from '../core/types/WorldTypes.ts';
import { btn, el } from './dom.ts';

export interface ShmupOverlayCallbacks {
  onCommand: (commandId: string) => void;
}

const WEAPON_TABS: readonly { kind: 'crimson' | 'azure' | 'violet'; label: string }[] = [
  { kind: 'crimson', label: '紅 散射' },
  { kind: 'azure', label: '藍 貫穿' },
  { kind: 'violet', label: '紫 追蹤' },
];

/**
 * Interactive Hangar & Unobtrusive Edge Sortie HUD for PA-02 Sugar Starlight.
 * Follows edge-only telemetry discipline so central弹幕 playfield remains clear.
 */
export class ShmupOverlayView {
  public readonly element: HTMLElement;
  private readonly hangarModal: HTMLElement;
  private readonly hangarGrid: HTMLElement;

  private readonly sortieTop: HTMLElement;
  private readonly fighterInfoEl: HTMLElement;
  private readonly bossBarEl: HTMLElement;
  private readonly bossFillEl: HTMLElement;
  private readonly bossLabelEl: HTMLElement;
  private readonly bombBtn: HTMLButtonElement;

  private readonly sortieBottom: HTMLElement;
  private readonly weaponBtns = new Map<'crimson' | 'azure' | 'violet', HTMLButtonElement>();
  private readonly grazeTextEl: HTMLElement;
  private readonly grazeFillEl: HTMLElement;

  private readonly onCommand: (commandId: string) => void;
  private readonly ac = new AbortController();
  private hangarAc: AbortController | null = null;
  private lastHangarKey = '';

  constructor(callbacks: ShmupOverlayCallbacks) {
    this.onCommand = callbacks.onCommand;
    this.element = el('div', 'shmup-hud panel-hidden');

    // ---------- Pre-Sortie Hangar Overlay ----------
    this.hangarModal = el('div', 'shmup-hangar');
    const header = el('div', 'shmup-hangar-head');
    header.append(
      el('strong', 'shmup-hangar-title', '出擊機庫整備'),
      el('span', 'shmup-hangar-sub', '方向鍵或點擊選機 · A 鍵 / 按鈕立即昇空'),
    );
    this.hangarGrid = el('div', 'shmup-fighter-grid');
    const footer = el('div', 'shmup-hangar-foot');
    const launchBtn = btn(
      'toy-btn is-primary shmup-launch-btn',
      '🚀 確認出擊',
      undefined,
      () => {
        this.onCommand('launch_sortie');
      },
      this.ac.signal,
    );
    footer.appendChild(launchBtn);
    this.hangarModal.append(header, this.hangarGrid, footer);

    // ---------- Active Sortie Edge HUD ----------
    this.sortieTop = el('div', 'shmup-top');
    this.fighterInfoEl = el('div', 'shmup-meta');

    this.bossBarEl = el('div', 'shmup-boss-bar panel-hidden');
    this.bossLabelEl = el('span', 'shmup-boss-label');
    const bossTrack = el('div', 'shmup-boss-track');
    this.bossFillEl = el('div', 'shmup-boss-fill');
    bossTrack.appendChild(this.bossFillEl);
    this.bossBarEl.append(this.bossLabelEl, bossTrack);

    this.bombBtn = btn(
      'shmup-bomb-btn',
      '💣 2',
      '觸發全屏消彈核爆 (快捷鍵 V)',
      () => {
        this.onCommand('bomb');
      },
      this.ac.signal,
    );
    this.sortieTop.append(this.fighterInfoEl, this.bossBarEl, this.bombBtn);

    this.sortieBottom = el('div', 'shmup-bottom');
    const weaponBar = el('div', 'shmup-weapons');
    for (const tab of WEAPON_TABS) {
      const b = btn(
        `shmup-weapon-btn is-${tab.kind}`,
        tab.label,
        '切換主武器色系 (快捷鍵 C)',
        () => {
          this.onCommand(`weapon:${tab.kind}`);
        },
        this.ac.signal,
      );
      this.weaponBtns.set(tab.kind, b);
      weaponBar.appendChild(b);
    }

    const grazeBox = el('div', 'shmup-graze-box');
    this.grazeTextEl = el('span', 'shmup-graze-text', '擦彈反擊 0%');
    const grazeTrack = el('div', 'shmup-graze-track');
    this.grazeFillEl = el('div', 'shmup-graze-fill');
    grazeTrack.appendChild(this.grazeFillEl);
    grazeBox.append(this.grazeTextEl, grazeTrack);

    this.sortieBottom.append(weaponBar, grazeBox);

    this.element.append(this.hangarModal, this.sortieTop, this.sortieBottom);
  }

  public reset(): void {
    this.element.classList.add('panel-hidden');
    this.lastHangarKey = '';
  }

  public destroy(): void {
    this.hangarAc?.abort();
    this.hangarAc = null;
    this.ac.abort();
    this.reset();
    this.hangarGrid.textContent = '';
  }

  private statBar(val: number): string {
    return '■'.repeat(val) + '□'.repeat(Math.max(0, 5 - val));
  }

  public render(hud: ShmupHudSnapshot | undefined, isRunning: boolean): void {
    if (!hud || !isRunning || hud.phase === 'won' || hud.phase === 'lost') {
      if (!this.element.classList.contains('panel-hidden')) {
        this.reset();
      }
      return;
    }

    this.element.classList.remove('panel-hidden');

    if (hud.phase === 'hangar') {
      this.hangarModal.classList.remove('panel-hidden');
      this.sortieTop.classList.add('panel-hidden');
      this.sortieBottom.classList.add('panel-hidden');

      const hKey = `${hud.selectedFighterId}|${hud.fighters.length}`;
      if (hKey !== this.lastHangarKey) {
        this.lastHangarKey = hKey;
        this.hangarAc?.abort();
        this.hangarAc = new AbortController();
        const cardSig = this.hangarAc.signal;
        this.hangarGrid.textContent = '';
        for (const f of hud.fighters) {
          const isSel = f.id === hud.selectedFighterId;
          const card = document.createElement('button');
          card.type = 'button';
          card.className = `shmup-fighter-card${isSel ? ' is-selected' : ''}`;
          card.style.setProperty('--fighter-accent', f.accentHex);
          card.addEventListener(
            'click',
            () => {
              this.onCommand(`select_fighter:${f.id}`);
            },
            { signal: cardSig },
          );

          const top = el('div', 'shmup-card-top');
          top.append(el('span', 'shmup-card-name', f.name), el('span', 'shmup-card-code', f.code));

          const stats = el(
            'div',
            'shmup-card-stats',
            `速度 ${this.statBar(f.speedStat)}\n裝甲 ${this.statBar(f.armorStat)}\n火力 ${this.statBar(f.fireStat)}`,
          );
          const ult = el('div', 'shmup-card-ult', `超必殺：${f.ultLabel}`);
          card.append(top, stats, ult);
          this.hangarGrid.appendChild(card);
        }
      }
      return;
    }

    // Active Sortie HUD
    this.hangarModal.classList.add('panel-hidden');
    this.sortieTop.classList.remove('panel-hidden');
    this.sortieBottom.classList.remove('panel-hidden');

    const activeFighter = hud.fighters.find((f) => f.id === hud.selectedFighterId);
    const heartsTxt = '♥'.repeat(hud.hearts) + '♡'.repeat(Math.max(0, hud.maxHearts - hud.hearts));
    this.fighterInfoEl.textContent = `${activeFighter?.name ?? '星戰機'} · ${heartsTxt} · 子機×${hud.funnelCount}`;

    if (hud.boss) {
      this.bossBarEl.classList.remove('panel-hidden');
      const pct = Math.max(0, Math.min(100, (hud.boss.hp / Math.max(1, hud.boss.maxHp)) * 100));
      this.bossFillEl.style.width = `${pct}%`;
      this.bossBarEl.classList.toggle('is-phase2', hud.boss.phase === 2);
      this.bossLabelEl.textContent = `P${hud.boss.phase} ${hud.boss.name} · 弱點×${hud.boss.activeWeakPoints}`;
    } else {
      this.bossBarEl.classList.add('panel-hidden');
    }

    this.bombBtn.textContent = `💣 ${hud.bombs}`;
    this.bombBtn.disabled = hud.bombs <= 0;

    for (const tab of WEAPON_TABS) {
      const btnEl = this.weaponBtns.get(tab.kind);
      if (!btnEl) continue;
      const active = hud.weaponKind === tab.kind;
      btnEl.classList.toggle('is-active', active);
      btnEl.textContent = active ? `${tab.label} Lv.${hud.weaponLevel}` : tab.label;
    }

    if (hud.overdriveTimer > 0) {
      this.grazeTextEl.textContent = `⚡ 無敵反擊 ${hud.overdriveTimer.toFixed(1)}s`;
      this.grazeFillEl.style.width = '100%';
      this.grazeFillEl.classList.add('is-overdrive');
    } else {
      this.grazeTextEl.textContent = `擦彈反擊 ${hud.grazeMeter}%`;
      this.grazeFillEl.style.width = `${hud.grazeMeter}%`;
      this.grazeFillEl.classList.remove('is-overdrive');
    }
  }
}
