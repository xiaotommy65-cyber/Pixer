import type { PixerPlatformMode } from '../core/ai/AgentBridge.ts';

export type PixerTopNavTab = 'studio' | 'ecs' | 'atlas' | 'rhythm' | 'arcade';

export interface PixerPlatformShellCallbacks {
  onSelectTab: (tab: PixerTopNavTab) => void;
  onPrimaryAction: () => void;
}

/**
 * Dual-Mode Top Navigation Bar strictly adhering to the 3-Zone Single-Row Contract:
 * [Brand wordmark] — [4 single-line nav links] — [1 primary CTA button]
 */
export class PixerPlatformShell {
  public readonly element: HTMLElement;
  private readonly ac = new AbortController();
  private readonly navButtons = new Map<PixerTopNavTab, HTMLButtonElement>();
  private readonly ctaBtn: HTMLButtonElement;
  private mode: PixerPlatformMode = 'studio';
  private activeTab: PixerTopNavTab = 'studio';

  constructor(callbacks: PixerPlatformShellCallbacks) {
    const { signal } = this.ac;

    this.element = document.createElement('header');
    this.element.className = 'p7-topbar';
    this.element.setAttribute('aria-label', 'Pixer 平台主導覽');

    // Zone 1: Single text element Brand wordmark
    const brand = document.createElement('span');
    brand.className = 'p7-brand';
    brand.textContent = 'Pixer';

    // Zone 2: 4 clean single-line text navigation links
    const nav = document.createElement('nav');
    nav.className = 'p7-nav';
    nav.setAttribute('aria-label', '模式切換');

    const tabs: { id: PixerTopNavTab; label: string }[] = [
      { id: 'studio', label: '工作站' },
      { id: 'ecs', label: '場景與元件' },
      { id: 'atlas', label: '資產圖集' },
      { id: 'rhythm', label: '星脈共鳴' },
      { id: 'arcade', label: '掌機展示' },
    ];

    for (const t of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'p7-nav-link';
      btn.textContent = t.label;
      btn.addEventListener(
        'click',
        () => {
          callbacks.onSelectTab(t.id);
        },
        { signal },
      );
      this.navButtons.set(t.id, btn);
      nav.appendChild(btn);
    }

    // Zone 3: 1 Primary Action CTA
    this.ctaBtn = document.createElement('button');
    this.ctaBtn.type = 'button';
    this.ctaBtn.className = 'p7-primary-cta';
    this.ctaBtn.textContent = '啟動試玩';
    this.ctaBtn.addEventListener(
      'click',
      () => {
        callbacks.onPrimaryAction();
      },
      { signal },
    );

    this.element.append(brand, nav, this.ctaBtn);
    this.syncState('studio', 'studio');
  }

  public getMode(): PixerPlatformMode {
    return this.mode;
  }

  public getActiveTab(): PixerTopNavTab {
    return this.activeTab;
  }

  public syncState(mode: PixerPlatformMode, tab: PixerTopNavTab): void {
    this.mode = mode;
    this.activeTab = tab;
    for (const [id, btn] of this.navButtons.entries()) {
      const active = id === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    }
    this.ctaBtn.textContent =
      mode === 'studio' ? '掌機試玩' : mode === 'rhythm' ? '回工作站' : '回到工作站';
  }

  public destroy(): void {
    this.ac.abort();
    this.element.remove();
  }
}
