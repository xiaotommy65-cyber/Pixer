import type { VirtualGamepadInput, TouchButtonKey } from './VirtualGamepadInput.ts';
import { btn, el } from './dom.ts';

export interface JoyconRigRefs {
  leftJoyconEl: HTMLElement;
  rightJoyconEl: HTMLElement;
  auxRailEl: HTMLElement;
  portraitRailBridge: HTMLElement;
  ledStrips: HTMLElement[];
  aSubEl: HTMLElement;
  bSubEl: HTMLElement;
  xSubEl: HTMLElement;
  ySubEl: HTMLElement;
  lSubEl: HTMLElement;
  rSubEl: HTMLElement;
  auxLSubEl: HTMLElement;
  auxRSubEl: HTMLElement;
}

export function buildJoyconsAndAuxRail(
  gamepad: VirtualGamepadInput,
  callbacks: {
    onOpenDrawer: () => void;
    onRequestCapture: () => void;
    onPlusAction: () => void;
    onHomeButton: () => void;
  },
): JoyconRigRefs {
  const ledStrips: HTMLElement[] = [];

  const makeLeds = (): HTMLElement => {
    const box = el('div', 'jc-leds');
    for (let i = 0; i < 4; i++) box.appendChild(el('span'));
    ledStrips.push(box);
    return box;
  };

  const makeShoulderHold = (
    cls: string,
    keyLabel: string,
    defaultSub: string,
    actionKey: TouchButtonKey,
    title: string,
    side: 'left' | 'right',
  ): { button: HTMLButtonElement; subEl: HTMLElement } => {
    const b = gamepad.createHoldButton(cls, '', actionKey, title, 'bumper', side);
    const kSpan = el('span', cls.includes('aux-sys-btn') ? 'aux-key' : 'bumper-key', keyLabel);
    const subSpan = el('span', cls.includes('aux-sys-btn') ? 'aux-sub' : 'bumper-sub', defaultSub);
    b.append(kSpan, subSpan);
    return { button: b, subEl: subSpan };
  };

  const makeFaceCap = (
    cls: string,
    keyLabel: string,
    defaultSub: string,
    title: string,
  ): { button: HTMLButtonElement; subEl: HTMLElement } => {
    const b = btn(cls, '', title);
    b.tabIndex = -1;
    const kSpan = el('span', 'dia-key', keyLabel);
    const subSpan = el('span', 'dia-sub', defaultSub);
    b.append(kSpan, subSpan);
    return { button: b, subEl: subSpan };
  };

  // ---------- Joy-Con L ----------
  const left = el('div', 'joycon is-left');
  left.appendChild(el('div', 'jc-rail-glow'));

  const lBumper = makeShoulderHold('jc-bumper is-l', 'L', '重試', 'shoulderL', 'L 肩鍵', 'left');
  const lTop = el('div', 'jc-row');
  lTop.appendChild(btn('jc-sys-btn', '−', '− 開啟換片抽屜', callbacks.onOpenDrawer));

  const lStick = gamepad.buildLeftStick();
  const dirs = gamepad.buildSlideDpad();
  const lBottom = el('div', 'jc-row');
  lBottom.append(
    makeLeds(),
    btn('jc-sys-btn is-square', '◉', '截圖：儲存 PICO-8 風紀念卡匣 PNG', callbacks.onRequestCapture),
  );
  left.append(lBumper.button, lTop, lStick, dirs, lBottom);

  // ---------- Joy-Con R ----------
  const right = el('div', 'joycon is-right');
  right.appendChild(el('div', 'jc-rail-glow'));

  const rBumper = makeShoulderHold('jc-bumper is-r', 'R', '特技', 'shoulderR', 'R 肩鍵', 'right');
  gamepad.bindShoulderRefs({ l: lBumper.button, r: rBumper.button });

  const rTop = el('div', 'jc-row');
  rTop.appendChild(btn('jc-sys-btn', '+', '+ 暫停 / 出擊', callbacks.onPlusAction));

  const abxy = el('div', 'diamond is-abxy');
  const capX = makeFaceCap('dia-btn is-x dia-n', 'X', '選單', 'X 鍵');
  const capY = makeFaceCap('dia-btn is-y dia-w', 'Y', '奧義', 'Y 鍵');
  const capA = makeFaceCap('dia-btn is-a dia-e', 'A', '確認', 'A 鍵');
  const capB = makeFaceCap('dia-btn is-b dia-s', 'B', '跳/閃', 'B 鍵');
  abxy.append(capX.button, capY.button, capA.button, capB.button);
  gamepad.bindAbxyCluster(abxy, {
    a: capA.button,
    b: capB.button,
    x: capX.button,
    y: capY.button,
  });

  const rStick = gamepad.buildRightStick();
  const rBottom = el('div', 'jc-row');
  rBottom.append(
    btn('jc-sys-btn is-home', '⌂', 'HOME：開啟斜角系統選單', callbacks.onHomeButton),
    makeLeds(),
  );
  right.append(rBumper.button, rTop, abxy, rStick, rBottom);

  const portraitRailBridge = el('div', 'portrait-rail-bridge');
  portraitRailBridge.setAttribute('aria-hidden', 'true');
  portraitRailBridge.append(el('span', 'rail-clasp is-left'), el('span', 'rail-clasp is-right'));

  // One-Handed Ergonomic Auxiliary Utility Rail
  const auxRail = el('div', 'onehand-aux-rail');
  const auxL = makeShoulderHold('aux-sys-btn is-shoulder', 'L', '重試', 'shoulderL', 'L 肩鍵', 'left');
  const auxR = makeShoulderHold('aux-sys-btn is-shoulder', 'R', '特技', 'shoulderR', 'R 肩鍵', 'right');
  const auxMinus = btn('aux-sys-btn', '−', '− 開啟換片抽屜', callbacks.onOpenDrawer);
  const auxPlus = btn('aux-sys-btn', '+', '+ 暫停 / 出擊', callbacks.onPlusAction);
  const auxCam = btn('aux-sys-btn', '◉', '截圖：紀念卡匣 PNG', callbacks.onRequestCapture);
  const auxHome = btn('aux-sys-btn is-home', '⌂', 'HOME：系統選單', callbacks.onHomeButton);
  auxRail.append(auxL.button, auxR.button, auxMinus, auxPlus, auxCam, auxHome);

  return {
    leftJoyconEl: left,
    rightJoyconEl: right,
    auxRailEl: auxRail,
    portraitRailBridge,
    ledStrips,
    aSubEl: capA.subEl,
    bSubEl: capB.subEl,
    xSubEl: capX.subEl,
    ySubEl: capY.subEl,
    lSubEl: lBumper.subEl,
    rSubEl: rBumper.subEl,
    auxLSubEl: auxL.subEl,
    auxRSubEl: auxR.subEl,
  };
}
