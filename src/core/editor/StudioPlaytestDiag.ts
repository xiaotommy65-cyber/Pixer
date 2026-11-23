import { validateCartridgeJson, type CartridgeJsonV1 } from '../sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../sim/DataCartridgeRuntime.ts';
import {
  createEmptyInputState,
  DEFAULT_RUNTIME_PARAMS,
  type InputState,
} from '../types/InputTypes.ts';

export interface PlaytestOptions {
  frames?: number;
  stageIndex?: number;
  script?: readonly Partial<InputState>[];
}

export interface PlaytestReport {
  valid: boolean;
  errors: string[];
  framesSimulated: number;
  status: 'playing' | 'won' | 'lost';
  score: number;
  starsCollected: number;
  starsTotal: number;
  displacementPx: number;
  maxSpeed: number;
  peakEntities: number;
  peakTiles: number;
  peakLights: number;
  eventsTriggered: number;
  perspectiveToggled: boolean;
  warnings: string[];
}

export interface SceneVisualReport {
  valid: boolean;
  errors: string[];
  viewport: { width: number; height: number };
  skyTop: string;
  skyBottom: string;
  parallaxLayerCount: number;
  fgTileCount: number;
  lightCount: number;
  particleCount: number;
  entityCount: number;
  tileCount: number;
  blueprintIds: string[];
  hasVerletRig: boolean;
  hasIkRig: boolean;
  hasAfterimage: boolean;
  hasWaterReflection: boolean;
  perspectiveMode: 'none' | 'first_person' | 'third_person';
  hudPrimitiveCount: number;
  heroScreenPos: { x: number; y: number } | null;
  readabilityWarnings: string[];
}

const STEP_DT = 1 / 60;

function buildAutoPilotInput(
  cartridge: CartridgeJsonV1,
  frame: number,
  out: InputState,
): void {
  out.left = false;
  out.right = false;
  out.up = false;
  out.down = false;
  out.jump = false;
  out.action = false;
  out.skillX = false;
  out.skillY = false;
  out.shoulderL = false;
  out.shoulderR = false;

  if (cartridge.perspective && cartridge.perspective.enabled !== false) {
    out.up = frame % 90 < 55;
    out.right = frame >= 55 && frame < 75;
    if (frame === 60 || frame === 120) out.skillX = true;
    if (frame % 45 === 15) out.action = true;
    return;
  }

  // Platformer / Parkour auto-pilot: run right, jump, wave-dash, and fire grapple
  out.right = true;
  out.jump = frame % 42 >= 8 && frame % 42 <= 18;
  if (frame % 50 === 24) out.action = true;
  if (cartridge.player.grappleConfig?.enabled && frame % 70 === 36) {
    out.skillY = true;
  }
}

/**
 * Deterministic 60Hz headless playtest diagnostics for Studio 6.0.
 * Verifies playability, movement responsiveness, entity/tile budgets, and flags design warnings.
 */
export function runHeadlessPlaytest(
  cartridge: CartridgeJsonV1,
  opts?: PlaytestOptions,
): PlaytestReport {
  const valid = validateCartridgeJson(cartridge);
  if (!valid.ok) {
    return {
      valid: false,
      errors: valid.errors,
      framesSimulated: 0,
      status: 'lost',
      score: 0,
      starsCollected: 0,
      starsTotal: 0,
      displacementPx: 0,
      maxSpeed: 0,
      peakEntities: 0,
      peakTiles: 0,
      peakLights: 0,
      eventsTriggered: 0,
      perspectiveToggled: false,
      warnings: ['卡匣結構驗證失敗，無法啟動無頭試玩'],
    };
  }

  const frames = Math.max(10, Math.min(1800, Math.round(opts?.frames ?? 180)));
  const rt = new DataCartridgeRuntime(valid.data, {
    initialStage: opts?.stageIndex ?? 0,
    skipHangar: true,
  });

  const startX = rt.playerSlot >= 0 ? rt.pool.x[rt.playerSlot] : 0;
  const startY = rt.playerSlot >= 0 ? rt.pool.y[rt.playerSlot] : 0;
  const initialPerspectiveMode = rt.dualPerspective.mode;
  let perspectiveToggled = false;
  let maxSpeed = 0;
  let maxDisp = 0;
  let peakEntities = 0;
  let peakTiles = 0;
  let peakLights = 0;
  let eventsTriggered = 0;

  const input = createEmptyInputState();

  for (let f = 0; f < frames; f++) {
    if (opts?.script && opts.script.length > 0) {
      const stepIn = opts.script[Math.min(f, opts.script.length - 1)];
      Object.assign(input, createEmptyInputState(), stepIn);
    } else {
      buildAutoPilotInput(valid.data, f, input);
    }

    rt.prepareFixedStep();
    const events = rt.step(STEP_DT, input, DEFAULT_RUNTIME_PARAMS);
    eventsTriggered += events.length;

    if (rt.dualPerspective.isEnabled() && rt.dualPerspective.mode !== initialPerspectiveMode) {
      perspectiveToggled = true;
    }

    if (rt.playerSlot >= 0) {
      const spd = Math.hypot(rt.pool.vx[rt.playerSlot], rt.pool.vy[rt.playerSlot]);
      if (spd > maxSpeed) maxSpeed = spd;
      const disp = Math.hypot(rt.pool.x[rt.playerSlot] - startX, rt.pool.y[rt.playerSlot] - startY);
      if (disp > maxDisp) maxDisp = disp;
    }

    if (f % 15 === 0 || f === frames - 1) {
      const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
      if (snap.entities.length > peakEntities) peakEntities = snap.entities.length;
      if (snap.tiles.length > peakTiles) peakTiles = snap.tiles.length;
      if (snap.lights.length > peakLights) peakLights = snap.lights.length;
    }
  }

  const finalSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const warnings: string[] = [];

  if (maxDisp < 8) {
    warnings.push('主角在試玩過程中幾乎未移動，請檢查出生點是否卡在實心牆壁中');
  }
  if (finalSnap.status === 'lost' && frames <= 180) {
    warnings.push('主角在開局 3 秒內即陣亡，請檢查出生點下方是否有足夠立足平台');
  }
  if (peakTiles === 0 && valid.data.player.controller !== 'shmup') {
    warnings.push('關卡中未偵測到任何地形瓦片，畫面可能顯得空洞');
  }
  if (valid.data.perspective?.enabled !== false && valid.data.perspective && !perspectiveToggled) {
    warnings.push('雙視角模式在自動試玩中尚未完成 1P/3P 切換驗證');
  }

  return {
    valid: true,
    errors: [],
    framesSimulated: frames,
    status: finalSnap.status,
    score: finalSnap.score,
    starsCollected: finalSnap.starsCollected,
    starsTotal: finalSnap.starsTotal,
    displacementPx: Math.round(maxDisp * 10) / 10,
    maxSpeed: Math.round(maxSpeed * 10) / 10,
    peakEntities,
    peakTiles,
    peakLights,
    eventsTriggered,
    perspectiveToggled,
    warnings,
  };
}

/**
 * Inspects rendered RenderSceneSnapshot composition, rig activation, lighting, and readability
 * without requiring a browser DOM or GPU context.
 */
export function inspectSceneComposition(
  cartridge: CartridgeJsonV1,
  frames = 24,
): SceneVisualReport {
  const valid = validateCartridgeJson(cartridge);
  if (!valid.ok) {
    return {
      valid: false,
      errors: valid.errors,
      viewport: { width: 320, height: 180 },
      skyTop: '#000000',
      skyBottom: '#000000',
      parallaxLayerCount: 0,
      fgTileCount: 0,
      lightCount: 0,
      particleCount: 0,
      entityCount: 0,
      tileCount: 0,
      blueprintIds: [],
      hasVerletRig: false,
      hasIkRig: false,
      hasAfterimage: false,
      hasWaterReflection: false,
      perspectiveMode: 'none',
      hudPrimitiveCount: 0,
      heroScreenPos: null,
      readabilityWarnings: ['卡匣結構驗證失敗'],
    };
  }

  const rt = new DataCartridgeRuntime(valid.data, { skipHangar: true });
  const input = createEmptyInputState();
  const warmup = Math.max(1, Math.min(180, Math.round(frames)));
  for (let f = 0; f < warmup; f++) {
    buildAutoPilotInput(valid.data, f, input);
    rt.prepareFixedStep();
    rt.step(STEP_DT, input, DEFAULT_RUNTIME_PARAMS);
  }
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);

  const blueprintSet = new Set<string>();
  let heroScreenPos: { x: number; y: number } | null = null;
  for (let i = 0; i < snap.entities.length; i++) {
    const e = snap.entities[i];
    if (e.artBlueprintId) blueprintSet.add(e.artBlueprintId);
    if (e.id === 'hero' || e.id === 'ship') {
      heroScreenPos = {
        x: Math.round((e.x - snap.cameraX) * 10) / 10,
        y: Math.round((e.y - snap.cameraY) * 10) / 10,
      };
    }
  }
  if (snap.perspective?.viewmodelBlueprintId) {
    blueprintSet.add(snap.perspective.viewmodelBlueprintId);
  }

  const readabilityWarnings: string[] = [];
  if (snap.skyTop.toLowerCase() === snap.skyBottom.toLowerCase()) {
    readabilityWarnings.push('天空漸層上下同色，建議設定 Oklab artMood 或雙色漸層增強景深');
  }
  if ((snap.ambientDarkness ?? 0) > 0.35 && snap.lights.length === 0) {
    readabilityWarnings.push('場景暗度偏高但缺乏點光源，可能影響角色與地形可讀性');
  }
  if ((snap.bgParallaxLayers?.length ?? 0) === 0 && !snap.perspective) {
    readabilityWarnings.push('缺少遠景視差圖層 (bgParallaxLayers)，建議加入 2 層以上遠景增添層次');
  }
  if (
    heroScreenPos &&
    snap.viewport &&
    (heroScreenPos.x < -16 || heroScreenPos.x > snap.viewport.width + 16 || heroScreenPos.y < -16 || heroScreenPos.y > snap.viewport.height + 16)
  ) {
    readabilityWarnings.push('主角超出目前鏡頭視口範圍，請檢查出生點與鏡頭設定');
  }

  return {
    valid: true,
    errors: [],
    viewport: snap.viewport ? { ...snap.viewport } : { width: 320, height: 180 },
    skyTop: snap.skyTop,
    skyBottom: snap.skyBottom,
    parallaxLayerCount: snap.bgParallaxLayers?.length ?? 0,
    fgTileCount: snap.fgTiles?.length ?? 0,
    lightCount: snap.lights.length,
    particleCount: snap.particles.length,
    entityCount: snap.entities.length,
    tileCount: snap.tiles.length,
    blueprintIds: Array.from(blueprintSet),
    hasVerletRig: rt.visualRig.hasVerletRig(),
    hasIkRig: rt.visualRig.hasIkRig(),
    hasAfterimage: rt.visualRig.hasAfterimage(),
    hasWaterReflection: Boolean(snap.hd2dDepth?.enabled && snap.hd2dDepth.waterLevelY !== undefined),
    perspectiveMode: snap.perspective ? snap.perspective.mode : 'none',
    hudPrimitiveCount: snap.hudPrimitives?.length ?? 0,
    heroScreenPos,
    readabilityWarnings,
  };
}
