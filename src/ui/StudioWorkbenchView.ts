import type { SpriteAtelierView } from './SpriteAtelierView.ts';
import type { WorkshopView } from './WorkshopView.ts';
import { btn, el } from './dom.ts';

export type WorkbenchTab = 'sprite' | 'workshop';

/**
 * Fullscreen dual-tab creator workbench integrating SpriteAtelierView & WorkshopView
 * behind the 3-beat Iris Wipe transition with 35ms staggered toolbar reveal.
 */
export class StudioWorkbenchView {
  public readonly element: HTMLElement;

  private readonly ac = new AbortController();
  private readonly spriteView: SpriteAtelierView;
  private readonly workshopView: WorkshopView;
  private readonly backBtn: HTMLButtonElement;
  private readonly spriteTabBtn: HTMLButtonElement;
  private readonly workshopTabBtn: HTMLButtonElement;
  private readonly onExit: (originEl: HTMLElement) => void;
  private activeTab: WorkbenchTab = 'sprite';

  constructor(
    spriteView: SpriteAtelierView,
    workshopView: WorkshopView,
    onExitToHandheld: (originEl: HTMLElement) => void,
    onTabTick?: (freqHz: number) => void,
  ) {
    this.spriteView = spriteView;
    this.workshopView = workshopView;
    this.onExit = onExitToHandheld;

    this.element = el('section', 'studio-workbench panel-hidden');

    const topBar = el('div', 'studio-workbench-bar');

    this.backBtn = btn(
      'toy-btn studio-reveal-item',
      '← 返回掌機',
      '縮回虹膜遮罩返回掌機遊玩',
      () => this.onExit(this.backBtn),
      this.ac.signal,
    );
    this.backBtn.style.setProperty('--stagger-idx', '0');

    const tabs = el('div', 'studio-workbench-tabs');
    this.spriteTabBtn = btn(
      'toy-btn is-active studio-reveal-item',
      '🎨 精靈畫室',
      '繪製 16×16 主角像素動畫影格',
      () => {
        onTabTick?.(760);
        this.setActiveTab('sprite');
      },
      this.ac.signal,
    );
    this.spriteTabBtn.style.setProperty('--stagger-idx', '1');

    this.workshopTabBtn = btn(
      'toy-btn studio-reveal-item',
      '🧱 積木工房',
      '微調物理參數、積木腳本與 D&D 迷宮 JSON',
      () => {
        onTabTick?.(840);
        this.setActiveTab('workshop');
      },
      this.ac.signal,
    );
    this.workshopTabBtn.style.setProperty('--stagger-idx', '2');
    tabs.append(this.spriteTabBtn, this.workshopTabBtn);

    const statusText = el('span', 'studio-sub studio-reveal-item', '全螢幕雙工坊 · 修改即時同步至掌機 GPU 圖集');
    statusText.style.setProperty('--stagger-idx', '3');

    topBar.append(this.backBtn, tabs, statusText);

    const body = el('div', 'studio-workbench-body studio-reveal-item');
    body.style.setProperty('--stagger-idx', '4');
    body.append(this.spriteView.element, this.workshopView.element);

    this.element.append(topBar, body);
    this.setActiveTab('sprite');

    window.addEventListener(
      'keydown',
      (e) => {
        if (this.element.classList.contains('panel-hidden')) return;
        if (e.code === 'Escape') {
          e.preventDefault();
          this.onExit(this.backBtn);
        }
      },
      { signal: this.ac.signal },
    );
  }

  public isOpen(): boolean {
    return !this.element.classList.contains('panel-hidden');
  }

  public setActiveTab(tab: WorkbenchTab): void {
    this.activeTab = tab;
    this.spriteTabBtn.classList.toggle('is-active', tab === 'sprite');
    this.workshopTabBtn.classList.toggle('is-active', tab === 'workshop');
    this.spriteView.element.classList.toggle('panel-hidden', tab !== 'sprite');
    this.workshopView.element.classList.toggle('panel-hidden', tab !== 'workshop');
  }

  public showCovered(): void {
    this.element.classList.remove('panel-hidden', 'is-revealed');
  }

  public revealToolbars(): void {
    void this.element.offsetWidth;
    this.element.classList.add('is-revealed');
  }

  public hide(): void {
    this.element.classList.remove('is-revealed');
    this.element.classList.add('panel-hidden');
  }

  public tick(dt: number): void {
    if (!this.element.classList.contains('panel-hidden') && this.activeTab === 'sprite') {
      this.spriteView.tickPreview(dt);
    }
  }

  public destroy(): void {
    this.ac.abort();
  }
}
