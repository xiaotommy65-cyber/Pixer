import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeId } from '../core/types/WorldTypes.ts';
import { renderCardArt } from './CardArt.ts';
import { btn, el } from './dom.ts';

export interface CartridgeDrawerCallbacks {
  onSelectCartridge: (id: CartridgeId) => void;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Bottom 42% slide-up Cartridge Switcher Drawer triggered by clicking the top
 * cartridge slot or choosing "切換卡匣" inside the Playdate angled menu.
 */
export class CartridgeDrawerView {
  public readonly element: HTMLElement;

  private readonly host: EngineHost;
  private readonly atlas: TextureAtlas;
  private readonly cb: CartridgeDrawerCallbacks;
  private readonly ac = new AbortController();
  private readonly listEl: HTMLElement;
  private openState = false;

  constructor(host: EngineHost, atlas: TextureAtlas, callbacks: CartridgeDrawerCallbacks) {
    this.host = host;
    this.atlas = atlas;
    this.cb = callbacks;

    this.element = el('div', 'cartridge-drawer-backdrop panel-hidden');
    const sheet = el('section', 'cartridge-drawer-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '快速切換卡匣抽屜');

    const grabHandle = el('span', 'drawer-grab-handle');
    grabHandle.setAttribute('aria-hidden', 'true');

    const head = el('div', 'cartridge-drawer-head');
    head.append(
      el('strong', undefined, '🎴 快速切換遊戲卡匣'),
      btn('toy-btn', '✕ 關閉', undefined, () => this.close(), this.ac.signal),
    );

    this.listEl = el('div', 'cartridge-drawer-list');
    sheet.append(grabHandle, head, this.listEl);
    this.element.appendChild(sheet);

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
        if (this.openState && e.code === 'Escape') {
          e.preventDefault();
          this.close();
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
    this.rebuildList();
    this.element.classList.remove('panel-hidden');
    this.host.playStereoTick(780, 0, 0.22);
    this.cb.onOpenChange?.(true);
  }

  public close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.element.classList.add('panel-hidden');
    this.cb.onOpenChange?.(false);
  }

  private rebuildList(): void {
    this.listEl.innerHTML = '';
    const activeId = this.host.activeCartridge;
    const all = this.host.listCartridges();
    const fullGameIds = new Set(['obsidian-citadel', 'emerald-ruins', 'cloudberry-hop', 'sugar-starlight']);
    const groups: { title: string; items: typeof all }[] = [
      { title: '完整獨立遊戲', items: all.filter((m) => fullGameIds.has(m.id)) },
      { title: '引擎範例與單關卡匣', items: all.filter((m) => !fullGameIds.has(m.id)) },
    ];

    for (const group of groups) {
      if (group.items.length === 0) continue;
      const heading = el('div', 'drawer-group-heading', group.title);
      heading.style.gridColumn = '1 / -1';
      heading.style.fontSize = '11px';
      heading.style.fontWeight = '700';
      heading.style.letterSpacing = '0.08em';
      heading.style.opacity = '0.72';
      heading.style.padding = '6px 4px 2px';
      this.listEl.appendChild(heading);

      for (const meta of group.items) {
        const isActive = activeId === meta.id;
        const item = btn(isActive ? 'drawer-cart-btn is-active' : 'drawer-cart-btn', '');
        const img = el('img', 'drawer-cart-thumb');
        img.alt = meta.title;
        img.src = renderCardArt(this.atlas, meta.id);

        const info = el('div', 'drawer-cart-info');
        info.append(
          el('strong', undefined, `${meta.code} · ${meta.title}`),
          el('span', undefined, isActive ? '遊玩中（點選繼續）' : meta.genre),
        );
        item.append(img, info);

        item.addEventListener(
          'click',
          () => {
            this.close();
            this.cb.onSelectCartridge(meta.id);
          },
          { signal: this.ac.signal },
        );

        this.listEl.appendChild(item);
      }
    }
  }

  public destroy(): void {
    this.ac.abort();
    this.listEl.innerHTML = '';
  }
}
