import type { ScreenFilterMode } from '../core/types/WorldTypes.ts';
import type { ShmupOverlayView } from './ShmupOverlayView.ts';
import { el, iconBtn } from './dom.ts';

export interface ConsoleBodyRefs {
  bodyEl: HTMLElement;
  slotEl: HTMLElement;
  slotWindow: HTMLElement;
  slotLed: HTMLElement;
  slotHint: HTMLElement;
  ejectBtn: HTMLButtonElement;
  clearSaveBtn: HTMLButtonElement;
  stageTag: HTMLElement;
  scoreTag: HTMLElement;
  starTag: HTMLElement;
  spriteStatTag: HTMLElement;
  fpsTag: HTMLElement;
  screenFrame: HTMLElement;
  canvas: HTMLCanvasElement;
  bootVeilEl: HTMLElement;
  screenFilterLayer: HTMLElement;
  glassSheen: HTMLElement;
  resultOverlay: HTMLElement;
  resultTitle: HTMLElement;
  resultDesc: HTMLElement;
  statusHintEl: HTMLElement;
  bodyLegendEl: HTMLElement;
}

export function buildConsoleBodyDom(opts: {
  initialFilter: ScreenFilterMode;
  shmupOverlay: ShmupOverlayView;
  onReturnHome: () => void;
  onClearSave: () => void;
  onOpenSettings: () => void;
  onExitLandscape: () => void;
  onRetryStage: () => void;
  onRestartFresh: () => void;
}): ConsoleBodyRefs {
  const bodyEl = el('div', 'console-body');
  const vol = el('div', 'top-vol');
  vol.append(el('span'), el('span'));

  const slotEl = el('div', 'cart-slot is-empty');
  const slotWindow = el('div', 'slot-window');
  slotEl.append(slotWindow, el('div', 'slot-mouth'));

  const slotSide = el('div', 'slot-side');
  const slotLed = el('span', 'slot-led');
  slotLed.title = '卡槽狀態指示燈';
  const slotHint = el('span', 'slot-hint', '點此切換卡匣');
  const ejectBtn = iconBtn('eject-btn panel-hidden', 'home', '回大廳', undefined, opts.onReturnHome);
  const clearSaveBtn = iconBtn('eject-btn is-clear-save panel-hidden', 'trash', '重頭', '清除存檔從第一關重開', opts.onClearSave);
  slotSide.append(slotLed, slotHint, clearSaveBtn, ejectBtn);

  const topbar = el('div', 'screen-topbar');
  const mLeft = el('div', 'screen-metrics');
  const stageTag = el('span', 'metric-tag is-stage panel-hidden', '');
  const scoreTag = el('span', 'metric-tag', '分數 0');
  const starTag = el('span', 'metric-tag', '★ 0/0');
  mLeft.append(stageTag, scoreTag, starTag);

  const mRight = el('div', 'screen-metrics');
  const spriteStatTag = el('span', 'metric-tag is-debug-metric panel-hidden', '精靈 0 · 0 draws');
  const fpsTag = el('span', 'metric-tag is-debug-metric panel-hidden', '60 FPS');
  const handheldSettingsBtn = iconBtn('handheld-settings-btn', 'gear', '設定', '開啟進階手感與系統設定', opts.onOpenSettings);
  const exitLandscapeBtn = iconBtn('handheld-exit-btn', 'exit', '離開橫屏', '離開全螢幕橫屏掌機模式', opts.onExitLandscape);
  mRight.append(spriteStatTag, fpsTag, handheldSettingsBtn, exitLandscapeBtn);
  topbar.append(mLeft, mRight);

  const screenFrame = el('div', 'screen-frame');
  const canvas = el('canvas', 'game-canvas');
  canvas.width = 960;
  canvas.height = 540;

  const bootVeilEl = el('div', 'cartridge-boot-veil');
  bootVeilEl.setAttribute('aria-hidden', 'true');

  const screenFilterLayer = el('div', 'screen-filter-layer');
  screenFilterLayer.dataset.filter = opts.initialFilter;

  const resultOverlay = el('div', 'screen-overlay is-dim panel-hidden');
  const card = el('div', 'overlay-card');
  const resultTitle = el('h3');
  const resultDesc = el('p');
  const resultActions = el('div', 'overlay-actions');
  resultActions.append(
    iconBtn('toy-btn is-primary', 'sparkle', '重試本關', undefined, opts.onRetryStage),
    iconBtn('toy-btn', 'refresh', '從頭開始', undefined, opts.onRestartFresh),
  );
  card.append(resultTitle, resultDesc, resultActions);
  resultOverlay.appendChild(card);

  const glassSheen = el('div', 'glass-sheen');
  glassSheen.setAttribute('aria-hidden', 'true');

  screenFrame.append(
    canvas,
    opts.shmupOverlay.element,
    resultOverlay,
    bootVeilEl,
    screenFilterLayer,
    glassSheen,
  );

  const statusHintEl = el('div', 'screen-status-hint', '');
  const footer = el('div', 'body-footer');
  const speakerL = el('div', 'speaker');
  const speakerR = el('div', 'speaker');
  for (let i = 0; i < 8; i++) {
    speakerL.appendChild(el('span'));
    speakerR.appendChild(el('span'));
  }
  const bodyLegendEl = el('div', 'body-legend', '');
  footer.append(speakerL, bodyLegendEl, speakerR);

  bodyEl.append(vol, slotEl, slotSide, topbar, screenFrame, statusHintEl, footer);

  return {
    bodyEl,
    slotEl,
    slotWindow,
    slotLed,
    slotHint,
    ejectBtn,
    clearSaveBtn,
    stageTag,
    scoreTag,
    starTag,
    spriteStatTag,
    fpsTag,
    screenFrame,
    canvas,
    bootVeilEl,
    screenFilterLayer,
    glassSheen,
    resultOverlay,
    resultTitle,
    resultDesc,
    statusHintEl,
    bodyLegendEl,
  };
}
