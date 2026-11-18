import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeId, CartridgeMeta } from '../core/types/WorldTypes.ts';
import { renderCardArt } from './CardArt.ts';
import { drawAtlasSpriteToCanvas } from './MomoMascot.ts';
import { setElementIconLabel } from './PixelIcons.ts';
import { el, iconBtn } from './dom.ts';

export interface HomeLobbyCallbacks {
  onFocusCartridge: (meta: CartridgeMeta) => void;
  onLaunchCartridge: (id: CartridgeId, forceFresh: boolean) => void;
  onOpenEditor: (originEl: HTMLElement) => void;
  onOpenSettings: () => void;
}

type LobbyFocusRow = 'cards' | 'dock';

/**
 * Interactive HOME Lobby inside the handheld viewport:
 * - Dynamic horizontal cartridge carousel via host.listCartridges()
 * - Active suspended badge ("遊玩中"): A resumes, X resets fresh
 * - Audio tier separation: 560-740Hz stereo-panned card ticks vs 920Hz Dock ticks
 * - Single primary "進入編輯器" CTA + "系統設定" button in lower Dock
 */
export class HomeLobbyView {
  public readonly element: HTMLElement;

  private readonly host: EngineHost;
  private readonly atlas: TextureAtlas;
  private readonly cb: HomeLobbyCallbacks;
  private readonly ac = new AbortController();
  private listAc: AbortController | null = null;

  private readonly momoCanvas: HTMLCanvasElement;
  private readonly focusedTitleEl: HTMLElement;
  private readonly focusedMetaEl: HTMLElement;
  private readonly carouselEl: HTMLElement;
  private readonly hintLineEl: HTMLElement;
  private readonly editorBtn: HTMLButtonElement;
  private readonly settingsBtn: HTMLButtonElement;

  private cartridges: readonly CartridgeMeta[] = [];
  private cardEls: HTMLElement[] = [];
  private cardSubEls: HTMLElement[] = [];
  private cardArtImgs = new Map<CartridgeId, HTMLImageElement>();
  private focusRow: LobbyFocusRow = 'cards';
  private focusedCardIdx = 0;
  private focusedDockIdx = 0;
  private visible = false;

  constructor(host: EngineHost, atlas: TextureAtlas, callbacks: HomeLobbyCallbacks) {
    this.host = host;
    this.atlas = atlas;
    this.cb = callbacks;

    this.element = el('div', 'home-lobby-overlay panel-hidden');

    const topbar = el('div', 'lobby-topbar');
    const greeting = el('div', 'lobby-greeting');
    this.momoCanvas = el('canvas', 'lobby-momo-thumb');
    this.momoCanvas.width = 16;
    this.momoCanvas.height = 16;
    drawAtlasSpriteToCanvas(this.atlas, 'momo_idle', this.momoCanvas);

    const titleCol = el('div', 'lobby-title-col');
    titleCol.appendChild(el('span', 'lobby-kicker', 'HOME LOBBY'));
    this.focusedTitleEl = el('strong', 'lobby-focused-name', 'Pixel Atelier');
    titleCol.appendChild(this.focusedTitleEl);
    greeting.append(this.momoCanvas, titleCol);

    this.focusedMetaEl = el('span', 'lobby-quick-meta', '');
    topbar.append(greeting, this.focusedMetaEl);

    const centerWindow = el('div', 'lobby-center-window');
    centerWindow.setAttribute('aria-hidden', 'true');

    const lowerDock = el('div', 'lobby-lower-dock');
    this.carouselEl = el('div', 'lobby-carousel');

    const bottomBar = el('div', 'lobby-bottom-bar');
    this.hintLineEl = el('span', 'lobby-hint-line', '◀ ▶ 選卡匣 · A 啟動／續玩 · ▼ 創作與設定');
    const dock = el('div', 'lobby-dock');

    this.editorBtn = iconBtn(
      'lobby-dock-btn is-primary',
      'palette',
      '進入編輯器',
      '展開全螢幕雙工坊編輯器（精靈畫室＋積木工房）',
      () => {
        this.focusRow = 'dock';
        this.focusedDockIdx = 0;
        this.syncFocusVisuals(false);
        this.editorBtn.classList.add('is-jelly');
        window.setTimeout(() => this.editorBtn.classList.remove('is-jelly'), 260);
        this.host.playStereoTick(920, 0, 0.24);
        this.cb.onOpenEditor(this.editorBtn);
      },
      this.ac.signal,
    );

    this.settingsBtn = iconBtn(
      'lobby-dock-btn',
      'gear',
      '設定',
      '開啟進階手感與系統設定',
      () => {
        this.focusRow = 'dock';
        this.focusedDockIdx = 1;
        this.syncFocusVisuals(false);
        this.host.playStereoTick(920, 0.3, 0.24);
        this.cb.onOpenSettings();
      },
      this.ac.signal,
    );

    dock.append(this.editorBtn, this.settingsBtn);
    bottomBar.append(this.hintLineEl, dock);
    lowerDock.append(this.carouselEl, bottomBar);
    this.element.append(topbar, centerWindow, lowerDock);

    this.rebuildCards();
  }

  public getEditorTriggerElement(): HTMLElement {
    return this.editorBtn;
  }

  public show(preferredCartridgeId?: CartridgeId | null): void {
    this.visible = true;
    this.focusRow = 'cards';
    const nextList = this.host.listCartridges();
    if (nextList.length !== this.cartridges.length) {
      this.rebuildCards();
    } else {
      this.syncCardStates();
    }
    if (preferredCartridgeId) {
      const idx = this.cartridges.findIndex((c) => c.id === preferredCartridgeId);
      if (idx >= 0) this.focusedCardIdx = idx;
    }
    this.element.classList.remove('panel-hidden');
    this.syncFocusVisuals(false);
    drawAtlasSpriteToCanvas(this.atlas, 'momo_idle', this.momoCanvas);
  }

  public hide(): void {
    this.visible = false;
    this.element.classList.add('panel-hidden');
  }

  public refreshCardArt(): void {
    for (const meta of this.cartridges) {
      const img = this.cardArtImgs.get(meta.id);
      if (img) img.src = renderCardArt(this.atlas, meta.id);
    }
  }

  public syncCardStates(): void {
    const activeId = this.host.activeCartridge;
    for (let i = 0; i < this.cartridges.length; i++) {
      const meta = this.cartridges[i];
      const card = this.cardEls[i];
      const sub = this.cardSubEls[i];
      if (!card || !sub) continue;

      const rec = this.host.getRecord(meta.id);
      const subText = rec ? `${meta.code} · ★${rec.bestStars}/${rec.starsTotal}` : `${meta.code} · ${meta.genre}`;
      if (sub.textContent !== subText) sub.textContent = subText;

      const pill = card.querySelector('.lobby-playing-pill');
      const shouldShowPill = activeId === meta.id;
      if (shouldShowPill && !pill) {
        card.appendChild(el('span', 'lobby-playing-pill', '遊玩中'));
      } else if (!shouldShowPill && pill) {
        pill.remove();
      }
    }
  }

  public rebuildCards(): void {
    this.listAc?.abort();
    this.listAc = new AbortController();
    this.carouselEl.innerHTML = '';
    this.cardEls = [];
    this.cardSubEls = [];
    this.cardArtImgs.clear();

    this.cartridges = this.host.listCartridges();
    if (this.focusedCardIdx >= this.cartridges.length) {
      this.focusedCardIdx = Math.max(0, this.cartridges.length - 1);
    }

    const activeId = this.host.activeCartridge;
    for (let i = 0; i < this.cartridges.length; i++) {
      const meta = this.cartridges[i];
      const card = el('div', 'lobby-card');
      card.style.setProperty('--card-accent', meta.accentHex);
      card.setAttribute('role', 'button');
      card.tabIndex = 0;

      const art = el('img', 'lobby-card-art');
      art.alt = meta.title;
      art.draggable = false;
      art.src = renderCardArt(this.atlas, meta.id);
      this.cardArtImgs.set(meta.id, art);

      const title = el('span', 'lobby-card-title', meta.title);
      const rec = this.host.getRecord(meta.id);
      const subText = rec ? `${meta.code} · ★${rec.bestStars}/${rec.starsTotal}` : `${meta.code} · ${meta.genre}`;
      const sub = el('span', 'lobby-card-sub', subText);

      card.append(art, title, sub);
      if (activeId === meta.id) {
        card.appendChild(el('span', 'lobby-playing-pill', '遊玩中'));
      }

      card.addEventListener(
        'click',
        () => {
          this.host.unlockAudio();
          if (this.focusRow !== 'cards' || this.focusedCardIdx !== i) {
            this.focusRow = 'cards';
            this.focusedCardIdx = i;
            this.syncFocusVisuals(true);
            return;
          }
          this.cb.onLaunchCartridge(meta.id, false);
        },
        { signal: this.listAc.signal },
      );

      this.cardEls.push(card);
      this.cardSubEls.push(sub);
      this.carouselEl.appendChild(card);
    }

    this.syncFocusVisuals(false);
  }

  public navigateDirection(dir: 'left' | 'right' | 'up' | 'down'): boolean {
    if (!this.visible) return false;
    if (dir === 'down' && this.focusRow === 'cards') {
      this.focusRow = 'dock';
      this.syncFocusVisuals(false);
      this.host.playStereoTick(920, this.focusedDockIdx === 0 ? -0.15 : 0.25, 0.24);
      return true;
    }
    if (dir === 'up' && this.focusRow === 'dock') {
      this.focusRow = 'cards';
      this.syncFocusVisuals(true);
      return true;
    }
    if (this.focusRow === 'dock') {
      const next = dir === 'left' ? 0 : dir === 'right' ? 1 : this.focusedDockIdx;
      if (next !== this.focusedDockIdx) {
        this.focusedDockIdx = next;
        this.syncFocusVisuals(false);
        this.host.playStereoTick(920, next === 0 ? -0.15 : 0.25, 0.24);
        return true;
      }
      return false;
    }

    if (this.cartridges.length === 0) return false;
    const delta = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    if (delta === 0) return false;
    const nextIdx = (this.focusedCardIdx + delta + this.cartridges.length) % this.cartridges.length;
    if (nextIdx !== this.focusedCardIdx) {
      this.focusedCardIdx = nextIdx;
      this.syncFocusVisuals(true);
      return true;
    }
    return false;
  }

  public triggerConfirm(): boolean {
    if (!this.visible) return false;
    if (this.focusRow === 'dock') {
      if (this.focusedDockIdx === 0) this.editorBtn.click();
      else this.settingsBtn.click();
      return true;
    }
    const meta = this.cartridges[this.focusedCardIdx];
    if (!meta) return false;
    this.cb.onLaunchCartridge(meta.id, false);
    return true;
  }

  public triggerSecondaryReset(): boolean {
    if (!this.visible || this.focusRow !== 'cards') return false;
    const meta = this.cartridges[this.focusedCardIdx];
    if (!meta) return false;
    const canReset = this.host.activeCartridge === meta.id || this.host.hasSram(meta.id);
    if (!canReset) return false;
    this.cb.onLaunchCartridge(meta.id, true);
    return true;
  }

  private syncFocusVisuals(playCardTick: boolean): void {
    const count = this.cartridges.length;
    for (let i = 0; i < this.cardEls.length; i++) {
      this.cardEls[i].classList.toggle('is-focused', this.focusRow === 'cards' && i === this.focusedCardIdx);
    }
    this.editorBtn.classList.toggle('is-focused', this.focusRow === 'dock' && this.focusedDockIdx === 0);
    this.settingsBtn.classList.toggle('is-focused', this.focusRow === 'dock' && this.focusedDockIdx === 1);

    const meta = this.cartridges[this.focusedCardIdx];
    if (!meta) return;

    this.focusedTitleEl.textContent = `${meta.code} · ${meta.title}`;
    const isPlaying = this.host.activeCartridge === meta.id;
    const hasSram = this.host.hasSram(meta.id);
    if (isPlaying) {
      setElementIconLabel(this.focusedMetaEl, 'play', '遊玩中（A 續玩 / X 重開）');
    } else if (hasSram) {
      setElementIconLabel(this.focusedMetaEl, 'save', '存檔待續（A 繼續 / X 重開）');
    } else {
      this.focusedMetaEl.textContent = meta.genre;
    }
    this.hintLineEl.textContent =
      this.focusRow === 'dock'
        ? '▲ 回卡匣 · A 確認'
        : isPlaying
          ? 'A 續玩 · X 重開 · ▼ 功能列'
          : '◀ ▶ 選卡 · A 啟動';

    const focusedCard = this.cardEls[this.focusedCardIdx];
    if (focusedCard && this.visible) {
      const targetLeft = Math.max(
        0,
        focusedCard.offsetLeft - (this.carouselEl.clientWidth - focusedCard.clientWidth) * 0.5,
      );
      this.carouselEl.scrollTo({
        left: targetLeft,
        behavior: playCardTick ? 'smooth' : 'auto',
      });
    }

    this.cb.onFocusCartridge(meta);

    if (playCardTick && count > 1) {
      const ratio = this.focusedCardIdx / Math.max(1, count - 1);
      const freq = 560 + ratio * 180;
      const pan = ratio * 1.3 - 0.65;
      this.host.playStereoTick(freq, pan, 0.24);
    }
  }

  public destroy(): void {
    this.listAc?.abort();
    this.listAc = null;
    this.ac.abort();
    this.cardEls = [];
    this.cardArtImgs.clear();
  }
}
