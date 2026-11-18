import fs from 'node:fs';
import path from 'node:path';
import { ATLAS_SIZE, TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { HybridAiDirector } from '../../src/core/ai/HybridAiDirector.ts';
import { RemoteHttpAiProvider } from '../../src/core/ai/RemoteAiProvider.ts';
import { ToySynth } from '../../src/core/audio/ToySynth.ts';
import { GpuEngine } from '../../src/core/gpu/GpuEngine.ts';
import { FLOATS_PER_INSTANCE, type IGpuBackend } from '../../src/core/gpu/GpuTypes.ts';
import { InputPipeline } from '../../src/core/input/InputPipeline.ts';
import { AppLogger, appLogger } from '../../src/core/runtime/AppLogger.ts';
import { CartridgeRunner } from '../../src/core/runtime/CartridgeRunner.ts';
import { EngineHost } from '../../src/core/runtime/EngineHost.ts';
import { parseJsonlEntries, serializeEntriesToJsonl } from '../../src/core/runtime/LogPersistence.ts';
import { SaveService } from '../../src/core/runtime/SaveService.ts';
import { buildDepthDrawOrder, SceneGpuBridge } from '../../src/core/runtime/SceneGpuBridge.ts';
import { AstralChroniclesGame } from '../../src/game/astralChronicles/AstralChroniclesGame.ts';
import { parseDungeonModuleJson } from '../../src/game/emberkeep/TurnGridSave.ts';
import { SandboxToyboxGame } from '../../src/game/sandbox/SandboxToyboxGame.ts';
import { check, collectTsFiles, emptyInput } from './SimTestHarness.ts';

export function testHd2dDepthPipeline(): void {
  const params = new CartridgeRunner('astral-chronicles').getParams();

  const ac = new AstralChroniclesGame(0);
  const acSnap = ac.snapshot(params);
  check(acSnap.hd2dDepth?.enabled === true, 'PA-05 should enable hd2dDepth rendering');
  check(acSnap.hd2dDepth?.sortByDepthY === true, 'PA-05 should enable Y-depth painter sorting');
  const extrudedWalls = acSnap.tiles.filter((t) => (t.extrudeH ?? 0) > 0);
  check(extrudedWalls.length >= 4, `PA-05 should emit extruded 2.5D south wall faces (got ${extrudedWalls.length})`);
  const shadowedActors = acSnap.entities.filter((e) => e.castShadow === true);
  check(shadowedActors.length >= 5, `PA-05 should emit ground contact shadows for actors/props (got ${shadowedActors.length})`);

  const synthetic = buildDepthDrawOrder(
    [{ sprite: 'stone', x: 100, y: 100, w: 20, h: 40, extrudeH: 10, elevationZ: 9, sortY: 140 }],
    [
      { id: 'north', sprite: 'hero_a', x: 100, y: 90, w: 16, h: 16, sortY: 106 },
      { id: 'south', sprite: 'slime_a', x: 100, y: 150, w: 16, h: 16, sortY: 166 },
    ],
  );
  check(
    synthetic.length === 3 &&
      synthetic[0].kind === 'entity' &&
      synthetic[0].entity.id === 'north' &&
      synthetic[1].kind === 'tile' &&
      synthetic[2].kind === 'entity' &&
      synthetic[2].entity.id === 'south',
    'buildDepthDrawOrder must sort north entity behind extruded wall and south entity in front of wall',
  );

  const dndRunner = new CartridgeRunner('emberkeep-dnd');
  const dndSnap = dndRunner.getSnapshot();
  check(dndSnap.hd2dDepth?.enabled === true, 'PA-04 should enable hd2dDepth');
  check(
    dndSnap.tiles.some((t) => (t.extrudeH ?? 0) === 6),
    'PA-04 should extrude south-facing stone dungeon walls',
  );

  const cbRunner = new CartridgeRunner('cloudberry-hop');
  const cbSnap = cbRunner.getSnapshot();
  const cbHero = cbSnap.entities.find((e) => e.id === 'hero');
  check(cbHero?.castShadow === true, 'PA-01 hero should project platform landing contact shadow');

  const sbDepth = new SandboxToyboxGame();
  sbDepth.loadPuzzle(4);
  const sbSnap = sbDepth.snapshot(params);
  const movingPlatTile = sbSnap.tiles.find((t) => t.sprite === 'moving_plat');
  check(
    movingPlatTile !== undefined && movingPlatTile.extrudeH === 3 && movingPlatTile.extrudeAtY === movingPlatTile.y + 6,
    'PA-03 moving_plat should emit 3px underside extrusion aligned with its 6px artwork bottom',
  );

  console.log(
    `[SIM OK] HD-2D 2.5D pipeline -> PA-05 extrudedWalls=${extrudedWalls.length}, shadows=${shadowedActors.length}, depthSort=verified`,
  );
}

export function testArchitectureBoundariesAndLifecycle(): void {
  const rootDir = process.cwd();

  // 1. Strict layer boundaries:
  // - core/ & assets/ must not import ui/ or game/ or Vite PWA modules
  // - Pure core subsystems (ai/hal/input/runtime/sim/types), assets/, and game/ must stay DOM-free
  const coreFiles = collectTsFiles(path.join(rootDir, 'src/core'));
  const assetFiles = collectTsFiles(path.join(rootDir, 'src/assets'));
  const gameFiles = collectTsFiles(path.join(rootDir, 'src/game'));
  const pureCoreDirs = ['ai', 'hal', 'input', 'runtime', 'sim', 'types'];
  const pureCoreFiles = pureCoreDirs.flatMap((sub) => collectTsFiles(path.join(rootDir, 'src/core', sub)));

  for (const file of [...coreFiles, ...assetFiles]) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(
      !/from\s+['"][^'"]*\/ui\//.test(src) &&
        !/from\s+['"][^'"]*\/game\//.test(src) &&
        !/virtual:pwa-register/.test(src),
      `Layer boundary violation: ${rel} must not import UI, Game instances, or Vite PWA modules`,
    );
  }

  for (const file of [...pureCoreFiles, ...assetFiles]) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(
      !/\bdocument\./.test(src) && !/\bwindow\.addEventListener\b/.test(src),
      `DOM leak in pure module: ${rel} must stay DOM-free for headless & native host compatibility`,
    );
  }

  for (const file of gameFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(
      !/from\s+['"][^'"]*\/ui\//.test(src) && !/virtual:pwa-register/.test(src),
      `Layer boundary violation: ${rel} must not import UI or Vite PWA modules`,
    );
    check(
      !/\bdocument\./.test(src) && !/\bwindow\.addEventListener\b/.test(src),
      `DOM leak in game cartridge: ${rel} must stay DOM-free for headless simulation`,
    );
  }

  // 2. UI views must communicate through EngineHost facade instead of bypassing via .runner
  const uiFiles = collectTsFiles(path.join(rootDir, 'src/ui'));
  for (const file of uiFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(!/\.runner\b/.test(src), `Facade violation: ${rel} must not access host.runner directly`);
  }

  // 3. Dead selector guard & lifecycle teardown markers
  const domSrc = fs.readFileSync(path.join(rootDir, 'src/ui/dom.ts'), 'utf8');
  check(!domSrc.includes('.bench-btn'), 'Dead selector .bench-btn must remain removed from TACTILE_SELECTOR');
  const gamepadSrc = fs.readFileSync(path.join(rootDir, 'src/ui/VirtualGamepadInput.ts'), 'utf8');
  check(
    gamepadSrc.includes('clearAllInputs()') &&
      gamepadSrc.includes('public destroy()') &&
      gamepadSrc.includes('touchAutofire: this.touchAutofire && !this.autofireBlockedByCartridge'),
    'VirtualGamepadInput must expose clearAllInputs(), destroy(), and syncVisual() autofire bypass parity',
  );
  const workshopSrc = fs.readFileSync(path.join(rootDir, 'src/ui/WorkshopView.ts'), 'utf8');
  check(
    workshopSrc.includes('public destroy()') && workshopSrc.includes('new AbortController()'),
    'WorkshopView must manage DOM listeners with AbortController and expose destroy()',
  );
  const newUiViews = [
    'BootBlinkOverlay.ts',
    'HomeLobbyView.ts',
    'AngledSystemMenuView.ts',
    'CartridgeDrawerView.ts',
    'StudioWorkbenchView.ts',
    'IrisWipeTransition.ts',
    'TransitionMascot.ts',
    'ConsoleShellRouter.ts',
    'SystemLogPanelView.ts',
  ];
  for (const viewFile of newUiViews) {
    const viewSrc = fs.readFileSync(path.join(rootDir, 'src/ui', viewFile), 'utf8');
    check(
      viewSrc.includes('public destroy()'),
      `Lobby/Workbench module ${viewFile} must expose public destroy() for clean teardown`,
    );
  }
  const mainSrc = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');
  check(
    mainSrc.includes('workshopView.destroy()') &&
      mainSrc.includes('gpuEngine.dispose()') &&
      mainSrc.includes('host.destroy()') &&
      mainSrc.includes('host.bindAtlas(atlas)') &&
      mainSrc.includes('registerBuiltinCartridges()') &&
      mainSrc.includes('forceCanvas2DFallback') &&
      mainSrc.includes('createAppSafe'),
    'main.ts must register built-in cartridges, bind TextureAtlas, guard startup/frame crashes, and tear down cleanly',
  );
  const c2dSrc = fs.readFileSync(path.join(rootDir, 'src/core/gpu/Canvas2DBackend.ts'), 'utf8');
  check(
    c2dSrc.includes('export class Canvas2DBackend') && c2dSrc.includes("kind = 'canvas2d'"),
    'Canvas2DBackend must implement canvas2d fallback backend cleanly',
  );
  check(
    !fs.existsSync(path.join(rootDir, 'public/assets/aistudio/Feedback_93b75d50.js')),
    'Standalone Feedback_93b75d50.js must remain removed after distilling into JuiceSystem/ToySynth/EngineHost',
  );

  // 4. EngineHost facade, Lobby OS APIs, pause simulation freeze, screen filters & destroy lifecycle
  const runner = new CartridgeRunner('astral-chronicles');
  const saveSvc = new SaveService();
  const host = new EngineHost(runner, new ToySynth(), saveSvc);
  check(host.getCartridgeId() === 'astral-chronicles', 'EngineHost.getCartridgeId should report active cartridge');
  check(host.listCartridges().length >= 5, 'EngineHost.listCartridges should enumerate built-in cartridges');
  const resumedFresh = host.mount('cloudberry-hop');
  check(!resumedFresh && host.activeCartridge === 'cloudberry-hop', 'EngineHost.mount should activate cartridge');
  check(!host.isPaused(), 'EngineHost.mount should start unpaused');
  const beforePauseSnap = host.getSnapshot();
  host.setPaused(true);
  check(host.isPaused(), 'EngineHost.setPaused(true) should pause simulation');
  host.stepFrame(1 / 60, { ...emptyInput(), right: true, jump: true });
  const afterPauseSnap = host.getSnapshot();
  check(
    afterPauseSnap.entities.length === beforePauseSnap.entities.length &&
      afterPauseSnap.entities[0]?.x === beforePauseSnap.entities[0]?.x &&
      afterPauseSnap.entities[0]?.y === beforePauseSnap.entities[0]?.y,
    'EngineHost.stepFrame must freeze game simulation while paused',
  );
  host.setPaused(false);
  host.unmount();
  check(host.activeCartridge === null, 'EngineHost.unmount should clear activeCartridge');
  host.saveScreenFilter('crt');
  check(host.getScreenFilter() === 'crt', 'EngineHost screen filter save/get roundtrip should persist crt');
  host.saveScreenFilter('clean');

  host.mount('astral-chronicles');
  let feedbackSeen = 0;
  const offFb = host.events.on('sim:feedback', (p) => {
    if (p.preset === 'charge_shot') feedbackSeen++;
  });
  host.emitFeedback('charge_shot', { combo: 2 });
  check(feedbackSeen === 1, 'EngineHost.emitFeedback should dispatch typed sim:feedback events');
  offFb();
  host.dispatchCommand('title_new_game');
  check(
    host.getSnapshot().chronicleHud?.uiMode === 'CUTSCENE',
    'EngineHost.dispatchCommand should route commands to active cartridge cleanly',
  );
  check(host.toggleBenchmark(true) && host.isBenchmarkOn(), 'EngineHost.toggleBenchmark(true) enables benchmark');
  check(!host.toggleBenchmark(false) && !host.isBenchmarkOn(), 'EngineHost.toggleBenchmark(false) disables benchmark');
  host.setParam('gravityScale', 1.25);
  check(host.getParams().gravityScale === 1.25, 'EngineHost.setParam updates runtime params');
  host.resetParams();
  check(host.getParams().gravityScale === 1.0, 'EngineHost.resetParams restores default runtime params');
  host.destroy();
  check(host.events.listenerCount() === 0, 'EngineHost.destroy() must detach all EventBus listeners');

  // 5. InputPipeline reset regression
  let clock = 3000;
  const pipe = new InputPipeline(() => clock);
  pipe.observeRaw({
    ...emptyInput(),
    left: true,
    right: true,
    jump: true,
    action: true,
    skillX: true,
    shoulderL: true,
  });
  clock += 200;
  pipe.reset();
  const cleared = pipe.resolve(emptyInput(), true, { touchAutofire: true, touchActionHeld: false });
  check(
    !cleared.left &&
      !cleared.right &&
      !cleared.up &&
      !cleared.down &&
      !cleared.jump &&
      !cleared.action &&
      !cleared.skillX &&
      !cleared.skillY &&
      !cleared.shoulderL &&
      !cleared.shoulderR,
    'InputPipeline.reset() must eliminate all latched, SOCD, prediction, and autofire states',
  );

  console.log(
    `[SIM OK] Architecture boundaries (${coreFiles.length} core + ${assetFiles.length} assets + ${gameFiles.length} game + ${uiFiles.length} UI), EngineHost facade & InputPipeline reset verified`,
  );
}

export function testUpgradedGpuPipelineAndAtlas(): void {
  const atlas = new TextureAtlas();
  check(atlas.width === 512 && atlas.height === 512, `TextureAtlas should be 512x512 (got ${atlas.width}x${atlas.height})`);
  const momoActionSprites = ['momo_run_a', 'momo_run_b', 'momo_jump', 'momo_slide', 'momo_wave_a', 'momo_wave_b'] as const;
  for (const sid of momoActionSprites) {
    check(atlas.hasSprite(sid), `TextureAtlas must register Momo transition sprite '${sid}'`);
  }
  atlas.clearDirty();
  const rgba = new Uint8Array(16 * 16 * 4);
  rgba.fill(255);
  const dynRect = atlas.registerDynamicRgbaSprite('custom_orb_rgba', 16, 16, rgba);
  check(atlas.hasSprite('custom_orb_rgba'), 'TextureAtlas should track dynamically registered RGBA sprites');
  check(atlas.isDirty() === true, 'registerDynamicRgbaSprite must mark atlas dirty for GPU re-upload');
  check(
    dynRect.v0 >= 128 / ATLAS_SIZE && dynRect.u1 <= 1 && dynRect.w === 16 && dynRect.h === 16,
    'Dynamic sprite UV must allocate cleanly inside the >=128px dynamic atlas region',
  );

  const capturedModesAlpha: number[] = [];
  const capturedModesAdd: number[] = [];
  const capturedParamsAdd: number[] = [];
  let uploadCalls = 0;

  const mockBackend: IGpuBackend = {
    kind: 'webgpu',
    uploadAtlas: () => {
      uploadCalls++;
    },
    renderFrame: (_sky, alphaItems, alphaCount, additiveItems, additiveCount) => {
      for (let i = 0; i < alphaCount; i++) {
        capturedModesAlpha.push(alphaItems[i * FLOATS_PER_INSTANCE + 13]);
      }
      for (let i = 0; i < additiveCount; i++) {
        capturedModesAdd.push(additiveItems[i * FLOATS_PER_INSTANCE + 13]);
        capturedParamsAdd.push(additiveItems[i * FLOATS_PER_INSTANCE + 15]);
      }
      return 3;
    },
    resize: () => {},
    dispose: () => {},
  };

  const dummyCanvas = { width: 320, height: 180 } as unknown as HTMLCanvasElement;
  const gpu = new GpuEngine(dummyCanvas, undefined, atlas);
  (gpu as unknown as { backend: IGpuBackend }).backend = mockBackend;

  const bridge = new SceneGpuBridge();
  const ac = new AstralChroniclesGame(0);
  const params = new CartridgeRunner('astral-chronicles').getParams();
  const snap = ac.snapshot(params);
  snap.bgStars = [{ x: 40, y: 24, size: 2, phase: 0.4, color: '#fffaf0' }];
  bridge.render(gpu, snap, null);

  check(uploadCalls === 1, 'GpuEngine.flush should auto-upload dirty dynamic atlas before rendering');
  check(capturedModesAlpha.includes(3), 'SceneGpuBridge must emit Mode 3 analytical soft elliptical shadows');
  check(capturedModesAlpha.includes(4), 'SceneGpuBridge must emit Mode 4 normal-lit beveled masonry/earth/astral walls');
  check(capturedModesAlpha.includes(5), 'SceneGpuBridge must emit Mode 5 smooth atmospheric haze/vignette gradients');
  check(
    capturedModesAdd.includes(1) && capturedParamsAdd.some((p) => p >= 10),
    'SceneGpuBridge must emit Mode 1 (>=10) 4-point star glints for bgStars',
  );

  console.log('[SIM OK] Upgraded GPU Art Pipeline (512x512 RGBA Atlas + Shader Modes 1/3/4/5) verified');
}

export async function testStructuredLoggingAndErrorRecovery(): Promise<void> {
  // 1. Standalone AppLogger: timestamps, circular-safe details, error normalization, and JSONL roundtrip
  const localLogger = new AppLogger(false);
  const cyclic: Record<string, unknown> = { ok: true };
  cyclic.self = cyclic;

  const okEntry = localLogger.success('storage', 'test.save', '測試成功紀錄', cyclic, 3.456);
  const errEntry = localLogger.error('network', 'test.fetch', '測試網路錯誤', new Error('Timeout 8000ms'), { code: 504 });
  check(Boolean(okEntry.ts) && okEntry.epochMs > 0 && okEntry.durationMs === 3.46, 'Log entries must record ISO ts, epochMs, and rounded durationMs');
  check(errEntry.error?.name === 'Error' && errEntry.error.message.includes('Timeout'), 'Error entries must normalize Error details cleanly');

  const jsonl = serializeEntriesToJsonl([okEntry, errEntry]);
  const parsed = parseJsonlEntries(`${jsonl}\n{corrupted-json-line`);
  check(parsed.length === 2 && parsed[0].operation === 'test.save' && parsed[1].level === 'error', 'JSONL parser must recover valid lines when encountering corrupted lines');

  // 2. Parsing & script execution try-catch logging
  const badJson = parseDungeonModuleJson('{ invalid json');
  check(Boolean(badJson.error) && appLogger.getEntries({ category: 'parsing', level: 'error' }).length >= 1, 'Invalid D&D JSON must log structured parsing error');

  const badSandbox = new SandboxToyboxGame('api.setSky(;');
  check(Boolean(badSandbox.scriptError) && badSandbox.snapshot(new CartridgeRunner().getParams()).entities.length > 0, 'Malformed Sandbox script must log error and recover with fallback star');

  // 3. Network failure -> HybridAiDirector fallback logging
  const remoteFail = new RemoteHttpAiProvider({ baseUrl: 'http://127.0.0.1:1/unreachable', timeoutMs: 25 });
  const director = new HybridAiDirector(undefined, remoteFail);
  const advice = await director.adviseTacticalAction({
    observation: new EngineHost(new CartridgeRunner('emberkeep-dnd'), new ToySynth(), new SaveService()).getUnifiedObservation(),
  });
  check(typeof advice.rationale === 'string' && advice.rationale.length > 0, 'HybridAiDirector must recover via local fallback when remote HTTP fails');
  check(appLogger.getEntries({ category: 'network', level: 'warn' }).some((e) => e.operation === 'ai.director.fallback'), 'HybridAiDirector must record structured fallback warning');

  console.log('[SIM OK] Comprehensive error handling, JSONL structured logging & fallback recovery verified');
}
