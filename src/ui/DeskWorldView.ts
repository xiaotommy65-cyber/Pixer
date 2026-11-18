import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeId } from '../core/types/WorldTypes.ts';
import { renderCardArt } from './CardArt.ts';
import { drawAtlasSpriteToCanvas } from './MomoMascot.ts';
import { setElementIconLabel } from './PixelIcons.ts';
import { renderPaperTextureUrl, renderTrayFeltTextureUrl } from './ProceduralSurfaceTextures.ts';
import { btn, el, iconBtn } from './dom.ts';

export interface DeskWorldCallbacks {
  onOpenEditor: (originEl: HTMLElement) => void;
  onSelectCartridge: (id: CartridgeId) => void;
  onRequestCapture: () => void;
  onScrollToPage: (pageIdx: 0 | 1 | 2) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  return node;
}

/**
 * Spatial desk environment & POV 2D SVG hands for Pixel Atelier:
 * - Desk grid backdrop + warm lamp aura (parallax layer -14px)
 * - Pure 2D SVG rounded pickup hands cradling the handheld during boot pickup
 * - Left Desk Prop (Workshop Notebook -> Iris Wipe Editor)
 * - Right Desk Prop (Cartridge Rack & Polaroid Snapshot quick actions)
 * - Mobile Portrait 3-page scroll-snap indicator pills (Notebook | NDS | Tray)
 */
export class DeskWorldView {
  public readonly deskBgEl: HTMLElement;
  public readonly handsOverlayEl: HTMLElement;
  public readonly notebookPropEl: HTMLElement;
  public readonly trayPropEl: HTMLElement;
  public readonly portraitPagerEl: HTMLElement;

  private readonly host: EngineHost;
  private readonly atlas: TextureAtlas;
  private readonly cb: DeskWorldCallbacks;
  private readonly ac = new AbortController();
  private trayAc: AbortController | null = null;
  private readonly trayGridEl: HTMLElement;
  private readonly pagerBtns: HTMLButtonElement[] = [];

  constructor(host: EngineHost, atlas: TextureAtlas, callbacks: DeskWorldCallbacks) {
    this.host = host;
    this.atlas = atlas;
    this.cb = callbacks;

    // 1. Desk Grid + Warm Lamp Backdrop
    this.deskBgEl = el('div', 'desk-world-bg');
    this.deskBgEl.setAttribute('aria-hidden', 'true');
    const lamp = el('div', 'desk-lamp-glow');
    this.deskBgEl.appendChild(lamp);

    // 2. Pure 2D SVG Pickup Hands
    this.handsOverlayEl = el('div', 'boot-pickup-hands');
    this.handsOverlayEl.setAttribute('aria-hidden', 'true');
    this.handsOverlayEl.appendChild(this.buildHandsSvg());

    // 3. Left Prop: Workshop Notebook (Editor Entry)
    this.notebookPropEl = el('aside', 'desk-prop desk-prop-notebook');
    const spiral = el('div', 'notebook-spiral');
    for (let i = 0; i < 6; i++) spiral.appendChild(el('span'));

    const nbHeader = el('div', 'notebook-head');
    const momoThumb = el('canvas', 'notebook-momo');
    momoThumb.width = 16;
    momoThumb.height = 16;
    drawAtlasSpriteToCanvas(this.atlas, 'momo_idle', momoThumb);
    const nbTitle = el('div', 'notebook-title-col');
    nbTitle.append(el('span', 'desk-prop-kicker', 'STUDIO'), el('strong', undefined, '創作筆記'));
    nbHeader.append(momoThumb, nbTitle);

    const nbNotes = el(
      'p',
      'desk-prop-desc',
      '手繪精靈與排布自製關卡。',
    );
    const openEditorBtn = iconBtn(
      'toy-btn is-primary desk-prop-cta',
      'palette',
      '進入工坊',
      '以虹膜轉場開啟精靈畫室與積木工坊',
      undefined,
      this.ac.signal,
    );
    openEditorBtn.addEventListener('click', () => this.cb.onOpenEditor(openEditorBtn), { signal: this.ac.signal });

    this.notebookPropEl.append(spiral, nbHeader, nbNotes, openEditorBtn);
    const paperUrl = renderPaperTextureUrl();
    if (paperUrl) {
      this.notebookPropEl.style.setProperty('--tex-paper', `url("${paperUrl}")`);
    }

    // 4. Right Prop: Cartridge Rack & Polaroid Album
    this.trayPropEl = el('aside', 'desk-prop desk-prop-tray');
    const trayFeltUrl = renderTrayFeltTextureUrl();
    if (trayFeltUrl) {
      this.trayPropEl.style.setProperty('--tex-tray-felt', `url("${trayFeltUrl}")`);
    }
    const trayHead = el('div', 'desk-tray-head');
    const trayTitleCol = el('div', 'notebook-title-col');
    trayTitleCol.append(el('span', 'desk-prop-kicker', 'CARTRIDGES'), el('strong', undefined, '卡匣托盤'));
    const snapBtn = iconBtn(
      'toy-btn is-honey desk-snap-btn',
      'camera',
      '存卡',
      '將目前畫面與卡匣封裝為 Polaroid PNG',
      () => this.cb.onRequestCapture(),
      this.ac.signal,
    );
    trayHead.append(trayTitleCol, snapBtn);

    this.trayGridEl = el('div', 'desk-tray-grid');
    const dropHint = el('div', 'desk-drop-hint');
    setElementIconLabel(dropHint, 'cartridge', '拖放 PNG 讀卡');
    this.trayPropEl.append(trayHead, this.trayGridEl, dropHint);
    this.rebuildTray();

    // 5. Mobile Portrait 3-Page Pager
    this.portraitPagerEl = el('nav', 'portrait-desk-pager');
    this.portraitPagerEl.setAttribute('aria-label', '書桌空間切換');
    const labels: readonly [0 | 1 | 2, string] [] = [
      [0, '📓 筆記'],
      [1, '🎮 掌機'],
      [2, '🎴 卡匣'],
    ];
    for (const [idx, text] of labels) {
      const b = btn(
        idx === 1 ? 'portrait-pager-btn is-active' : 'portrait-pager-btn',
        text,
        undefined,
        () => this.cb.onScrollToPage(idx),
        this.ac.signal,
      );
      this.pagerBtns.push(b);
      this.portraitPagerEl.appendChild(b);
    }
  }

  public setActivePage(pageIdx: 0 | 1 | 2): void {
    this.pagerBtns.forEach((b, i) => b.classList.toggle('is-active', i === pageIdx));
  }

  public rebuildTray(): void {
    this.trayAc?.abort();
    this.trayAc = new AbortController();
    this.trayGridEl.innerHTML = '';

    for (const meta of this.host.listCartridges().slice(0, 6)) {
      const card = btn('desk-tray-card', '', `插入遊玩：${meta.title}`, () => this.cb.onSelectCartridge(meta.id), this.trayAc.signal);
      card.style.setProperty('--tray-accent', meta.accentHex);

      const img = el('img', 'desk-tray-art');
      img.alt = meta.title;
      img.src = renderCardArt(this.atlas, meta.id);

      const label = el('span', 'desk-tray-code', meta.code);
      const name = el('span', 'desk-tray-name', meta.title);
      card.append(img, label, name);
      this.trayGridEl.appendChild(card);
    }
  }

  private buildHandsSvg(): SVGSVGElement {
    const svg = svgEl('svg', {
      viewBox: '0 0 600 220',
      class: 'boot-hands-svg',
      preserveAspectRatio: 'xMidYMax meet',
    });

    // Left sleeve + rounded palm + thumb gripping left Joy-Con
    const leftG = svgEl('g', { class: 'boot-hand-left' });
    leftG.append(
      svgEl('path', {
        d: 'M-10,230 L28,118 C42,88 78,84 114,98 L142,118 L128,230 Z',
        fill: '#8be0b8',
        stroke: '#2d201c',
        'stroke-width': '5',
      }),
      svgEl('path', {
        d: 'M74,104 C90,78 134,82 152,108 C166,128 158,162 130,174 L84,166 Z',
        fill: '#ffd9be',
        stroke: '#2d201c',
        'stroke-width': '5',
      }),
      svgEl('ellipse', {
        cx: '132',
        cy: '112',
        rx: '24',
        ry: '16',
        transform: 'rotate(-18 132 112)',
        fill: '#ffe6d2',
        stroke: '#2d201c',
        'stroke-width': '4.5',
      }),
    );

    // Right sleeve + rounded palm + thumb gripping right Joy-Con
    const rightG = svgEl('g', { class: 'boot-hand-right' });
    rightG.append(
      svgEl('path', {
        d: 'M610,230 L572,118 C558,88 522,84 486,98 L458,118 L472,230 Z',
        fill: '#ff9ebb',
        stroke: '#2d201c',
        'stroke-width': '5',
      }),
      svgEl('path', {
        d: 'M526,104 C510,78 466,82 448,108 C434,128 442,162 470,174 L516,166 Z',
        fill: '#ffd9be',
        stroke: '#2d201c',
        'stroke-width': '5',
      }),
      svgEl('ellipse', {
        cx: '468',
        cy: '112',
        rx: '24',
        ry: '16',
        transform: 'rotate(18 468 112)',
        fill: '#ffe6d2',
        stroke: '#2d201c',
        'stroke-width': '4.5',
      }),
    );

    svg.append(leftG, rightG);
    return svg;
  }

  public destroy(): void {
    this.trayAc?.abort();
    this.ac.abort();
  }
}
