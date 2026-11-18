import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { ScreenFilterMode } from '../core/types/WorldTypes.ts';
import { btn, el } from './dom.ts';

export interface AngledMenuCallbacks {
  getFilterMode: () => ScreenFilterMode;
  getMuted: () => boolean;
  getDebugHitboxes: () => boolean;
  hasActiveCartridge: () => boolean;
  onResume: () => void;
  onRestartStage: () => void;
  onOpenCartridgeDrawer: () => void;
  onCycleScreenFilter: () => ScreenFilterMode;
  onToggleMute: () => boolean;
  onToggleDebugHitboxes: () => boolean;
  onOpenAdvancedSettings: () => void;
  onReturnLobby: () => void;
  onCloseChange?: (open: boolean) => void;
}

const FILTER_LABELS: Record<ScreenFilterMode, string> = {
  clean: '純淨 Clean',
  lcd: 'LCD 點陣',
  crt: 'CRT 掃描線',
};

/**
 * Playdate-inspired right-edge angled system menu (skewX(-5deg) with counter-skewed items).
 * Pauses background gameplay and supports keyboard ArrowUp/ArrowDown/Enter/Escape navigation.
 */
export class AngledSystemMenuView {
  public readonly element: HTMLElement;

  private readonly host: EngineHost;
  private readonly cb: AngledMenuCallbacks;
  private readonly ac = new AbortController();
  private readonly listAcContainer: HTMLElement;
  private items: HTMLButtonElement[] = [];
  private actions: (() => void)[] = [];
  private selectedIdx = 0;
  private openState = false;

  constructor(host: EngineHost, callbacks: AngledMenuCallbacks) {
    this.host = host;
    this.cb = callbacks;

    this.element = el('div', 'angled-menu-backdrop panel-hidden');
    const panel = el('aside', 'angled-menu-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Playdate 系統快捷選單');

    const inner = el('div', 'angled-menu-inner');
    const header = el('div', 'angled-menu-header');
    header.append(
      el('h3', 'angled-menu-title', '系統選單'),
      el('span', 'angled-menu-sub', 'HOME QUICK'),
    );

    this.listAcContainer = el('div', 'angled-menu-inner');
    this.listAcContainer.style.transform = 'none';
    inner.append(header, this.listAcContainer);
    panel.appendChild(inner);
    this.element.appendChild(panel);

    this.element.addEventListener(
      'click',
      (e) => {
        if (e.target === this.element) this.close();
      },
      { signal: this.ac.signal },
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.openState) return;
        if (e.code === 'Escape') {
          e.preventDefault();
          this.close();
        } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
          e.preventDefault();
          this.moveSelection(-1);
        } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
          e.preventDefault();
          this.moveSelection(1);
        } else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyK') {
          e.preventDefault();
          this.actions[this.selectedIdx]?.();
        }
      },
      { signal: this.ac.signal },
    );
  }

  public isOpen(): boolean {
    return this.openState;
  }

  public open(): void {
    if (this.openState) return;
    this.openState = true;
    this.selectedIdx = 0;
    this.rebuildItems();
    this.element.classList.remove('panel-hidden');
    this.host.playStereoTick(820, 0.35, 0.22);
    this.cb.onCloseChange?.(true);
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.element.classList.add('panel-hidden');
    this.host.playStereoTick(620, 0.35, 0.18);
    this.cb.onCloseChange?.(false);
  }

  public toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  private moveSelection(delta: number): void {
    if (this.items.length === 0) return;
    this.selectedIdx = (this.selectedIdx + delta + this.items.length) % this.items.length;
    this.syncSelectionVisual();
    this.host.playStereoTick(720 + this.selectedIdx * 18, 0.3, 0.2);
  }

  private syncSelectionVisual(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].classList.toggle('is-selected', i === this.selectedIdx);
    }
  }

  private rebuildItems(): void {
    this.listAcContainer.innerHTML = '';
    this.items = [];
    this.actions = [];

    const hasCart = this.cb.hasActiveCartridge();
    const filter = this.cb.getFilterMode();
    const muted = this.cb.getMuted();
    const debugOn = this.cb.getDebugHitboxes();

    const addItem = (label: string, valText: string, onSelect: () => void) => {
      const idx = this.items.length;
      const itemBtn = btn('angled-menu-item', '');
      itemBtn.append(
        el('span', undefined, label),
        el('span', 'angled-menu-item-val', valText),
      );
      itemBtn.addEventListener(
        'pointerenter',
        () => {
          this.selectedIdx = idx;
          this.syncSelectionVisual();
        },
        { signal: this.ac.signal },
      );
      itemBtn.addEventListener(
        'click',
        () => {
          this.selectedIdx = idx;
          onSelect();
        },
        { signal: this.ac.signal },
      );
      this.items.push(itemBtn);
      this.actions.push(onSelect);
      this.listAcContainer.appendChild(itemBtn);
    };

    if (hasCart) {
      addItem('▶ 繼續遊玩', 'A / ESC', () => {
        this.close();
        this.cb.onResume();
      });
      addItem('↺ 重新開始本關', '重載目前關卡', () => {
        this.close();
        this.cb.onRestartStage();
      });
    }

    addItem('🎴 切換卡匣', '42% 換片抽屜', () => {
      this.close();
      this.cb.onOpenCartridgeDrawer();
    });

    addItem('🖥 螢幕濾鏡', FILTER_LABELS[filter], () => {
      this.cb.onCycleScreenFilter();
      this.host.playStereoTick(860, 0.25, 0.2);
      this.rebuildItems();
    });

    addItem('🔊 音效靜音', muted ? '靜音中' : '開啟', () => {
      this.cb.onToggleMute();
      this.rebuildItems();
    });

    addItem('🧪 GPU 除錯顯示', debugOn ? '開啟' : '關閉', () => {
      this.cb.onToggleDebugHitboxes();
      this.rebuildItems();
    });

    addItem('⚙ 進階手感與系統設定', '握持 / 配色 / 震動', () => {
      this.close();
      this.cb.onOpenAdvancedSettings();
    });

    if (hasCart) {
      addItem('⌂ 返回 HOME 大廳', '背景掛起保留', () => {
        this.close();
        this.cb.onReturnLobby();
      });
    }

    if (this.selectedIdx >= this.items.length) this.selectedIdx = 0;
    this.syncSelectionVisual();
  }

  public destroy(): void {
    this.ac.abort();
    this.items = [];
    this.actions = [];
  }
}
