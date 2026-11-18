import type { RpgHudSnapshot } from '../core/types/WorldTypes.ts';
import { btn, el } from './dom.ts';

export interface RpgOverlayCallbacks {
  onCommand: (commandId: string) => void;
}

/**
 * Structured CRPG / D&D HUD Overlay (active when cartridge snapshot exposes `rpgHud`).
 * Renders floor telemetry, hero vitals, enemy banner, NPC branching dialog choices, and action commands.
 */
export class RpgOverlayView {
  public readonly element: HTMLElement;
  private readonly floorEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly enemyEl: HTMLElement;
  private readonly agentBtn: HTMLButtonElement;
  private readonly logEl: HTMLElement;
  private readonly dialogEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly onCommand: (commandId: string) => void;
  private lastActionsKey = '';

  constructor(callbacks: RpgOverlayCallbacks) {
    this.onCommand = callbacks.onCommand;
    this.element = el('div', 'rpg-hud panel-hidden');

    const rpgTop = el('div', 'rpg-top');
    const rpgTopLeft = el('div', 'rpg-cluster');
    this.floorEl = el('span', 'rpg-pill is-floor');
    this.statsEl = el('span', 'rpg-pill is-stats');
    rpgTopLeft.append(this.floorEl, this.statsEl);

    const rpgTopRight = el('div', 'rpg-cluster');
    this.enemyEl = el('span', 'rpg-pill is-enemy panel-hidden');
    this.agentBtn = btn('rpg-agent-btn', '🤖 AI 託管', '開啟／關閉內建探索戰鬥 AI 代理', () => {
      this.onCommand('toggle_agent');
    });
    rpgTopRight.append(this.enemyEl, this.agentBtn);
    rpgTop.append(rpgTopLeft, rpgTopRight);

    const rpgBottom = el('div', 'rpg-bottom');
    this.logEl = el('div', 'rpg-log');
    this.dialogEl = el('div', 'rpg-dialog panel-hidden');
    this.actionsEl = el('div', 'rpg-actions');
    rpgBottom.append(this.logEl, this.dialogEl, this.actionsEl);
    this.element.append(rpgTop, rpgBottom);
  }

  public reset(): void {
    this.element.classList.add('panel-hidden');
    this.lastActionsKey = '';
  }

  public render(hud: RpgHudSnapshot | undefined, isRunning: boolean): void {
    if (!hud || !isRunning) {
      if (!this.element.classList.contains('panel-hidden')) {
        this.reset();
      }
      return;
    }

    this.element.classList.remove('panel-hidden');
    this.floorEl.textContent = `${hud.floorName} · T${hud.turnCount}`;
    const equipTxt = hud.weaponName ? ` ⚔️${hud.weaponName}` : '';
    const statusTxt = hud.statuses && hud.statuses.length > 0 ? ` [${hud.statuses.join(',')}]` : '';
    this.statsEl.textContent = `Lv.${hud.level} ❤️${hud.hp}/${hud.maxHp} ✨${hud.mp}/${hud.maxMp} 🛡️${hud.ac} 🪙${hud.gold} 🔑${hud.keys} 🧪${hud.potions}${equipTxt}${statusTxt}`;

    if (hud.combat) {
      this.enemyEl.classList.remove('panel-hidden');
      this.enemyEl.textContent = `🐉 ${hud.combat.enemyName} HP ${hud.combat.enemyHp}/${hud.combat.enemyMaxHp} AC${hud.combat.enemyAc}`;
    } else {
      this.enemyEl.classList.add('panel-hidden');
    }

    this.agentBtn.classList.toggle('is-on', hud.agentAuto);
    this.agentBtn.textContent = hud.agentAuto ? '🤖 AI 託管中' : '🤖 AI 託管';

    const logText = hud.combatLog.slice(0, 2).join('\n');
    if (this.logEl.textContent !== logText) {
      this.logEl.textContent = logText;
    }

    const opts = hud.dialog ? hud.dialog.choices : hud.actions;
    const selIdx = hud.dialog ? hud.dialog.selectedIdx : hud.selectedActionIdx;
    const dialogKey = hud.dialog ? `${hud.dialog.speaker}:${hud.dialog.text}` : '';
    const renderKey = `${hud.mode}|${selIdx}|${dialogKey}|${opts.map((o) => `${o.id}:${o.label}:${o.enabled}`).join(',')}`;

    if (renderKey !== this.lastActionsKey) {
      this.lastActionsKey = renderKey;
      if (hud.dialog) {
        this.dialogEl.classList.remove('panel-hidden');
        this.dialogEl.textContent = `【${hud.dialog.speaker}】${hud.dialog.text}`;
      } else {
        this.dialogEl.classList.add('panel-hidden');
      }

      this.actionsEl.textContent = '';
      opts.forEach((opt, i) => {
        const b = btn(`rpg-act-btn${i === selIdx ? ' is-selected' : ''}`, opt.label, undefined, () => {
          this.onCommand(opt.id);
        });
        b.disabled = !opt.enabled;
        this.actionsEl.appendChild(b);
      });
    }
  }
}
