import { computeStereoRumbleMagnitudes } from '../../src/core/hal/HapticEngine.ts';
import { SystemHal, normalizeGripMode, normalizeHapticLevel } from '../../src/core/hal/SystemHal.ts';
import {
  AntiSnapbackFilter,
  InputPipeline,
  WebGamepadSampler,
  classifyDpadOctant,
  resolveAbxyClusterHit,
  shapeAnalogStickVector,
  updateFloatingStickOrigin,
} from '../../src/core/input/InputPipeline.ts';
import {
  getCartridgeControlProfile,
  shouldBypassTouchActionAutofire,
} from '../../src/core/runtime/CartridgeRegistry.ts';
import { check, emptyInput } from './SimTestHarness.ts';

export function testHalAndInputPipeline(): void {
  // 1. InputPipeline SOCD Last-Input-Priority + Sub-frame Tap Prediction
  let fakeNow = 1000;
  const pipe = new InputPipeline(() => fakeNow);

  pipe.observeRaw({ ...emptyInput(), left: true });
  pipe.observeRaw({ ...emptyInput(), left: true, right: true });
  const r1 = pipe.resolve({ ...emptyInput(), left: true, right: true }, false);
  check(!r1.left && r1.right, 'SOCD Last-Input-Priority should favor newer Right key when Left+Right held');

  const r2 = pipe.resolve({ ...emptyInput(), left: true, right: false }, false);
  check(r2.left && !r2.right, 'Releasing Right while Left still held should fall back cleanly to Left');

  pipe.observeRaw({ ...emptyInput(), jump: true });
  pipe.observeRaw(emptyInput());
  fakeNow += 25;
  const rTap = pipe.resolve(emptyInput(), true);
  check(rTap.jump, 'InputPipeline should preserve sub-frame jump tap within 100ms prediction buffer');
  const rAfterConsume = pipe.resolve(emptyInput(), true);
  check(!rAfterConsume.jump, 'InputPipeline should consume latched tap once read by stepFrame');

  // 2. SystemHal HapticEngine Cooldown, Thermal Budget, Native Plugin & Off Mode
  let hapticClock = 5000;
  const hal = new SystemHal(() => hapticClock);
  let recoilCount = 0;
  let acousticCount = 0;
  let nativeCalls = 0;
  hal.haptic.setCallbacks({
    onVisualRecoil: () => {
      recoilCount += 1;
    },
    onAcousticFallback: () => {
      acousticCount += 1;
    },
  });

  let keepAwakeCalls = 0;
  let lockCalls = 0;
  let shareCalls = 0;
  hal.registerNativeAdapter({
    id: 'mock-capacitor-ios',
    isNativeApp: () => true,
    getPlatform: () => 'ios',
    hapticTrigger: () => {
      nativeCalls += 1;
      return true;
    },
    setKeepAwake: async () => {
      keepAwakeCalls += 1;
      return true;
    },
    requestFullscreenLock: async () => {
      lockCalls += 1;
      return true;
    },
    shareImageDataUrl: async () => {
      shareCalls += 1;
      return true;
    },
  });
  check(hal.isNativeHost() === true && hal.getPlatform() === 'ios', 'SystemHal should report native host and platform when adapter is active');
  void hal.setKeepAwake(true);
  void hal.requestFullscreenLock(true);
  void hal.shareImageDataUrl('data:image/png;base64,AA==', 'card.png');
  check(
    keepAwakeCalls === 1 && lockCalls === 1 && shareCalls === 1,
    'SystemHal must delegate setKeepAwake, requestFullscreenLock, and shareImageDataUrl to NativeHalAdapter',
  );

  const firstClick = hal.haptic.click('right');
  check(
    firstClick.dispatched && firstClick.channel === 'native' && nativeCalls === 1 && recoilCount === 1 && acousticCount === 1,
    'First click should dispatch to NativeHalAdapter + visual recoil + acoustic fallback',
  );

  hapticClock += 10;
  const blockedCooldown = hal.haptic.click('right');
  check(!blockedCooldown.dispatched && blockedCooldown.reason === 'cooldown', 'Rapid duplicate click within 24ms must be throttled by cooldown');

  for (let i = 0; i < 6; i++) {
    hapticClock += 60;
    hal.haptic.rumble(0.8, 50);
  }
  hapticClock += 60;
  const blockedBudget = hal.haptic.rumble(0.8, 50);
  check(
    !blockedBudget.dispatched && blockedBudget.reason === 'thermal_budget',
    'Sustained rumble bursts exceeding 220ms/1s duty budget must be throttled to prevent motor overheating',
  );

  hal.setHapticLevel('off');
  hapticClock += 200;
  const offRes = hal.haptic.impact();
  check(!offRes.dispatched && offRes.reason === 'off', 'HapticLevel=off must suppress all haptic triggers');

  hal.unregisterNativeAdapter('mock-capacitor-ios');
  check(hal.isNativeHost() === false && hal.getPlatform() === 'web', 'unregisterNativeAdapter should cleanly restore web host mode');

  // 3. Ergonomic grip normalization & state listeners
  check(normalizeGripMode('one-left') === 'one-left', 'normalizeGripMode preserves valid one-left');
  check(normalizeGripMode('unknown') === 'both', 'normalizeGripMode falls back to both');
  check(normalizeHapticLevel('gentle') === 'gentle', 'normalizeHapticLevel preserves gentle');
  let gripObserved = '';
  hal.onGripChange((m) => {
    gripObserved = m;
  });
  hal.setGripMode('one-right');
  check(gripObserved === 'one-right' && hal.getGripMode() === 'one-right', 'SystemHal notifies grip mode subscribers');

  // 4. Touch Ergonomics: Polar D-Pad Octants, Unified ABXY Chording, Touch Autofire & Control Profiles
  const stdDiag = classifyDpadOctant(0.65, 0.65, 'standard');
  check(stdDiag.right && stdDiag.down, 'Standard D-pad should detect 45deg SE diagonal');
  const tightShallowDiag = classifyDpadOctant(0.85, 0.4, 'tight');
  check(tightShallowDiag.right && !tightShallowDiag.down, 'Tight 30deg D-pad deadzone should filter shallow diagonal wobble to pure cardinal');

  const hitA = resolveAbxyClusterHit(0.85, 0.0);
  check(hitA.a && !hitA.b && !hitA.x && !hitA.y, 'ABXY East zone should map to A button');
  const hitBA = resolveAbxyClusterHit(0.65, 0.65);
  check(hitBA.a && hitBA.b && !hitBA.x, 'ABXY SE chord bridge should allow simultaneous B+A roll press');

  let autoClock = 2000;
  const autoPipe = new InputPipeline(() => autoClock);
  const firstTouch = { ...emptyInput(), action: true };
  const pulse0 = autoPipe.resolve(firstTouch, true, { touchAutofire: true, touchActionHeld: true });
  check(pulse0.action === true, 'Initial touch press must fire immediately before autofire delay');
  autoClock += 155;
  const pulse1 = autoPipe.resolve(firstTouch, true, { touchAutofire: true, touchActionHeld: true });
  autoClock += 70;
  const pulse2 = autoPipe.resolve(firstTouch, true, { touchAutofire: true, touchActionHeld: true });
  check(pulse1.action && !pulse2.action, 'Touch Autofire Assist should oscillate held Action button cleanly after 140ms hold');

  check(
    shouldBypassTouchActionAutofire('sugar-starlight') === true &&
      shouldBypassTouchActionAutofire('cloudberry-hop') === false,
    'shouldBypassTouchActionAutofire must gate PA-02 while preserving autofire on PA-01',
  );
  for (let i = 0; i < 6; i++) {
    autoClock += 200;
    const held = autoPipe.resolve(firstTouch, true, {
      touchAutofire: !shouldBypassTouchActionAutofire('sugar-starlight'),
      touchActionHeld: true,
    });
    check(held.action === true, 'PA-02 bypassed autofire must keep held Action continuous for Tier-2 charge');
  }

  for (const id of [null, 'cloudberry-hop', 'sugar-starlight', 'sandbox-toybox', 'emberkeep-dnd', 'astral-chronicles'] as const) {
    const prof = getCartridgeControlProfile(id);
    check(
      Boolean(prof.a && prof.b && prof.x && prof.y && prof.l && prof.r && prof.legend),
      `getCartridgeControlProfile(${String(id)}) must return complete micro-labels and legend`,
    );
  }

  // 5. Analog Stick Curves, Dynamic Floating Origin & Anti-Snapback Filtering
  const dzZero = shapeAnalogStickVector(0.1, -0.08, { deadzone: 0.16, curveMode: 'standard' });
  check(dzZero.mag === 0 && dzZero.x === 0 && dzZero.y === 0, 'Stick vector inside radial deadzone must resolve to 0');
  const stdTilt = shapeAnalogStickVector(0.5, 0, { deadzone: 0.16, curveMode: 'standard' });
  const precTilt = shapeAnalogStickVector(0.5, 0, { deadzone: 0.16, curveMode: 'precision' });
  check(
    stdTilt.mag > 0 && precTilt.mag > 0 && precTilt.mag < stdTilt.mag,
    'Precision stick curve must deliver finer low-end response than Standard curve',
  );
  const fullTilt = shapeAnalogStickVector(0.98, 0.02, { deadzone: 0.16, curveMode: 'standard', cardinalSnapDeg: 4 });
  check(Math.abs(fullTilt.x - 1) < 1e-5 && Math.abs(fullTilt.y) < 1e-5, 'Near-East full tilt should snap cleanly to unit East');

  const initialOrigin = updateFloatingStickOrigin(0, 0, 5, -3, 15, 7, true);
  check(
    initialOrigin.originX === 5 && initialOrigin.originY === -3 && initialOrigin.deltaX === 0 && initialOrigin.deltaY === 0,
    'Dynamic floating origin should anchor at thumb landing inside shift allowance with zero jump',
  );
  const pulledOrigin = updateFloatingStickOrigin(5, -3, 25, -3, 15, 7, false);
  check(
    Math.hypot(pulledOrigin.originX, pulledOrigin.originY) <= 7.01 && Math.hypot(pulledOrigin.deltaX, pulledOrigin.deltaY) <= 15.01,
    'Floating origin and stick delta must stay bounded inside housing radius',
  );

  const snapFilter = new AntiSnapbackFilter();
  snapFilter.filter(0.92, 0, 1000);
  const rebound = snapFilter.filter(-0.32, 0.02, 1020);
  check(rebound.suppressed && rebound.x === 0 && rebound.y === 0, 'AntiSnapbackFilter must suppress 180-deg rebound bounce within 65ms');
  const strongIntentional = snapFilter.filter(-0.85, 0, 1030);
  check(!strongIntentional.suppressed && strongIntentional.x < -0.8, 'Strong intentional opposite tilt must override snapback suppression');

  // 6. Bilateral Stereo DualRumble Weighting & Full Physical WebGamepadSampler Parity
  const leftRumble = computeStereoRumbleMagnitudes(0.4, 0.4, 1.0, 'left');
  const rightRumble = computeStereoRumbleMagnitudes(0.4, 0.4, 1.0, 'right');
  check(
    leftRumble.strongMagnitude > leftRumble.weakMagnitude * 2 &&
      rightRumble.weakMagnitude > rightRumble.strongMagnitude * 2,
    'Stereo DualRumble weighting must bias strong motor for Left cues and weak motor for Right cues',
  );

  let padClock = 10000;
  const mockButtons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
  const mockAxes = [0, 0, 0, 0];
  const sampler = new WebGamepadSampler({
    clock: () => padClock,
    gamepadReader: () => [
      {
        index: 0,
        id: 'Mock Pro Pad',
        connected: true,
        axes: mockAxes,
        buttons: mockButtons,
        mapping: 'standard',
        timestamp: padClock,
        hapticActuators: [],
      } as unknown as Gamepad,
    ],
  });

  mockButtons[1] = { pressed: true, touched: true, value: 1 };
  mockButtons[10] = { pressed: true, touched: true, value: 1 };
  mockButtons[7] = { pressed: false, touched: true, value: 0.6 };
  mockButtons[6] = { pressed: true, touched: true, value: 1 };
  mockAxes[2] = 0.7;
  const gp1 = sampler.sample();
  check(
    gp1.connected &&
      gp1.justPressed.a &&
      gp1.justPressed.l3 &&
      gp1.justPressed.zr &&
      gp1.justPressed.zl &&
      gp1.input.action &&
      gp1.input.rightStickX > 0.4 &&
      !gp1.input.restart,
    'WebGamepadSampler should emit full edges, read analog ZR, and guard ZL against instant 1-frame restart',
  );
  padClock += 450;
  const gp2 = sampler.sample();
  check(!gp2.justPressed.a && !gp2.justPressed.l3 && gp2.input.restart, 'Holding ZL >= 420ms should trigger safe restart pulse');

  console.log('[SIM OK] SystemHal, HapticEngine Stereo DualRumble, Analog Stick DSP & Full Gamepad Mapping verified');
}
