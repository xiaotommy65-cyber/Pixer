import fs from 'node:fs';
import path from 'node:path';
import { ATLAS_SIZE, TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { HybridAiDirector } from '../../src/core/ai/HybridAiDirector.ts';
import { RemoteHttpAiProvider } from '../../src/core/ai/RemoteAiProvider.ts';
import { ToySynth } from '../../src/core/audio/ToySynth.ts';
import { GpuEngine } from '../../src/core/gpu/GpuEngine.ts';
import {
  FLOATS_PER_INSTANCE,
  MAX_INSTANCES_PER_PASS,
  resolveLogicalViewport,
  type IGpuBackend,
} from '../../src/core/gpu/GpuTypes.ts';
import { InputPipeline } from '../../src/core/input/InputPipeline.ts';
import { AppLogger, appLogger } from '../../src/core/runtime/AppLogger.ts';
import {
  embedCartridgeIntoPng,
  extractCartridgeFromPng,
  MAX_DECOMPRESSED_JSON_BYTES,
  MAX_PNG_FILE_BYTES,
} from '../../src/core/runtime/CartridgePngCodec.ts';
import { CartridgeRunner } from '../../src/core/runtime/CartridgeRunner.ts';
import { DisplayThermalGovernor } from '../../src/core/runtime/DisplayThermalGovernor.ts';
import { EngineHost } from '../../src/core/runtime/EngineHost.ts';
import { parseJsonlEntries, serializeEntriesToJsonl } from '../../src/core/runtime/LogPersistence.ts';
import { SaveService } from '../../src/core/runtime/SaveService.ts';
import { buildDepthDrawOrder, computeParallaxScreenCoord, SceneGpuBridge } from '../../src/core/runtime/SceneGpuBridge.ts';
import { SeededRng } from '../../src/core/runtime/SeededRng.ts';
import { CameraDirector } from '../../src/core/sim/CameraDirector.ts';
import {
  validateCartridgeJson,
  type CartridgeJsonV1,
  type CartridgeTileChunkDef,
} from '../../src/core/sim/CartridgeSchema.ts';
import { DataCartridgeRuntime } from '../../src/core/sim/DataCartridgeRuntime.ts';
import { MAX_ENTITIES, SoaEntityPool } from '../../src/core/sim/SoaEntityPool.ts';
import {
  CHUNK_AREA,
  CHUNK_SIZE,
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_HAZARD,
  COLLISION_SOLID,
  TilemapGrid,
} from '../../src/core/sim/TilemapGrid.ts';
import { WorldKernel } from '../../src/core/sim/WorldKernel.ts';
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
  const pureCoreDirs = ['ai', 'hal', 'input', 'math', 'runtime', 'sim', 'types'];
  const pureCoreFiles = pureCoreDirs.flatMap((sub) => {
    const dir = path.join(rootDir, 'src/core', sub);
    return fs.existsSync(dir) ? collectTsFiles(dir) : [];
  });

  for (const file of [...coreFiles, ...assetFiles]) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(
      !/from\s+['"][^'"]*\/ui\//.test(src) &&
        !/from\s+['"][^'"]*\/game\//.test(src) &&
        !/from\s+['"]@capacitor\//.test(src) &&
        !/virtual:pwa-register/.test(src),
      `Layer boundary violation: ${rel} must not import UI, Game instances, Capacitor, or Vite PWA modules`,
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

  const mathFiles = collectTsFiles(path.join(rootDir, 'src/core/math'));
  for (const file of mathFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(
      !/\bnew\s+(?:Set|Map|WeakSet|WeakMap)\b/.test(src),
      `Zero-GC invariant violation: ${rel} in src/core/math/ must stay allocation-free (no new Set/Map containers)`,
    );
  }

  for (const file of gameFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(
      !/from\s+['"][^'"]*\/ui\//.test(src) &&
        !/from\s+['"]@capacitor\//.test(src) &&
        !/virtual:pwa-register/.test(src),
      `Layer boundary violation: ${rel} must not import UI, Capacitor, or Vite PWA modules`,
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
  const gpuSrc = fs.readFileSync(path.join(rootDir, 'src/core/gpu/GpuEngine.ts'), 'utf8');
  const bridgeSrc = fs.readFileSync(path.join(rootDir, 'src/core/runtime/SceneGpuBridge.ts'), 'utf8');
  check(
    gpuSrc.includes('public drawSpriteRaw(') &&
      gpuSrc.includes('this.lastStats.backend = this.backend.kind') &&
      bridgeSrc.includes('gpu.drawSpriteRaw(') &&
      !bridgeSrc.includes('gpu.drawSprite('),
    'Hot-path zero-GC invariant: SceneGpuBridge must use GpuEngine.drawSpriteRaw() and GpuEngine.flush() must reuse lastStats in place',
  );
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
    'WindowDioramaView.ts',
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

  // 3b. Security, CI/lockfile, PWA subpath, and public/ hygiene guards
  const allSrcFiles = collectTsFiles(path.join(rootDir, 'src'));
  for (const file of allSrcFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file);
    check(
      !/\bnew\s+Function\s*\(/.test(src) && !/\beval\s*\(/.test(src),
      `Security invariant violation: ${rel} must not use eval() or new Function()`,
    );
  }

  const viteCfg = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
  if (viteCfg.includes("base: './'")) {
    check(
      !/\b(?:id|start_url|scope)\s*:\s*['"]\/['"]/.test(viteCfg) &&
        !/\bsrc\s*:\s*['"]\/pwa-/.test(viteCfg),
      "PWA manifest id/start_url/scope/icons in vite.config.ts must use './' relative paths to match base: './'",
    );
    const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    check(
      !/href=['"]\/(?:apple-touch-icon|favicon|pwa-)/.test(indexHtml),
      "index.html icon links must use './' relative paths to match Vite base: './'",
    );
  }

  const deployPath = path.join(rootDir, '.github/workflows/deploy.yml');
  if (fs.existsSync(deployPath)) {
    const deployYml = fs.readFileSync(deployPath, 'utf8');
    const hasPkgLock = fs.existsSync(path.join(rootDir, 'package-lock.json'));
    const hasBunLock = fs.existsSync(path.join(rootDir, 'bun.lock'));
    if (hasBunLock && !hasPkgLock) {
      check(
        !deployYml.includes('npm ci') && !deployYml.includes("cache: 'npm'"),
        'deploy.yml must not use npm ci / npm cache when only bun.lock exists',
      );
    }
    check(
      /\brun\s+sim\b/.test(deployYml) && /\brun\s+build\b/.test(deployYml),
      'deploy.yml must gate deployment on both sim and build scripts',
    );
  }

  const collectPublicFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...collectPublicFiles(full));
      else out.push(full);
    }
    return out;
  };
  for (const pubFile of collectPublicFiles(path.join(rootDir, 'public'))) {
    check(!pubFile.endsWith('.md'), `Public hygiene: ${path.relative(rootDir, pubFile)} markdown must not be published in public/`);
  }

  const agentsPath = path.join(rootDir, 'AGENTS.md');
  const agentsLineCount = fs.readFileSync(agentsPath, 'utf8').trimEnd().split('\n').length;
  check(
    agentsLineCount <= 120,
    `AGENTS.md line budget exceeded: ${agentsLineCount} lines (max 120); merge or trim before adding`,
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
  check(ATLAS_SIZE === 1024 && atlas.width === 1024 && atlas.height === 1024, `TextureAtlas should be 1024x1024 (got ${atlas.width}x${atlas.height})`);
  check(MAX_INSTANCES_PER_PASS === 16384, `MAX_INSTANCES_PER_PASS should be 16384 for M4.3 (got ${MAX_INSTANCES_PER_PASS})`);
  check(FLOATS_PER_INSTANCE === 20, `FLOATS_PER_INSTANCE should be 20 for M1 deform/LUT packing (got ${FLOATS_PER_INSTANCE})`);
  check(
    atlas.indexPixels.length === ATLAS_SIZE * ATLAS_SIZE &&
      atlas.paletteLut.length === 16 * atlas.paletteRows * 4 &&
      atlas.paletteRows === 8,
    'TextureAtlas must expose 1024x1024 indexPixels and 16x8 RGBA8 paletteLut',
  );
  // Row 0 (classic) keeps indices 14/15 non-emissive for clouds; themed row 1 enables emissive weights
  check(
    atlas.paletteLut[14 * 4 + 3] === 0 && atlas.paletteLut[(1 * 16 + 14) * 4 + 3] > 0,
    'Palette LUT must keep classic row non-emissive on 14/15 and enable emissive on themed rows',
  );

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
  const dynX = Math.floor(dynRect.u0 * ATLAS_SIZE);
  const dynY = Math.floor(dynRect.v0 * ATLAS_SIZE);
  check(
    atlas.indexPixels[dynY * ATLAS_SIZE + dynX] === 255,
    'Dynamic RGBA sprite texels must write index 255 for 32-bit passthrough in LUT shader',
  );

  const capturedModesAlpha: number[] = [];
  const capturedModesAdd: number[] = [];
  const capturedParamsAdd: number[] = [];
  const capturedPivotsY: number[] = [];
  const capturedSkewsX: number[] = [];
  const capturedPaletteRows: number[] = [];
  let capturedGlow = -1;
  let capturedFilterMode = -1;
  let capturedCamFracX = 0;
  let capturedCamFracY = 0;
  let capturedSkyMid: [number, number, number] | undefined;
  let uploadCalls = 0;
  let uploadedLut = false;

  const mockBackend: IGpuBackend = {
    kind: 'webgpu',
    uploadAtlas: (_w, _h, _px, idxPx, lut, rows) => {
      uploadCalls++;
      if (idxPx && lut && rows === 8) uploadedLut = true;
    },
    renderFrame: (sky, alphaItems, alphaCount, additiveItems, additiveCount) => {
      capturedGlow = sky.glowIntensity;
      capturedFilterMode = sky.filterMode;
      capturedCamFracX = sky.camFracX ?? 0;
      capturedCamFracY = sky.camFracY ?? 0;
      capturedSkyMid = sky.mid;
      for (let i = 0; i < alphaCount; i++) {
        const base = i * FLOATS_PER_INSTANCE;
        capturedModesAlpha.push(alphaItems[base + 13]);
        capturedPivotsY.push(alphaItems[base + 17]);
        capturedSkewsX.push(alphaItems[base + 18]);
        capturedPaletteRows.push(alphaItems[base + 19]);
      }
      for (let i = 0; i < additiveCount; i++) {
        const base = i * FLOATS_PER_INSTANCE;
        capturedModesAdd.push(additiveItems[base + 13]);
        capturedParamsAdd.push(additiveItems[base + 15]);
      }
      return 7;
    },
    resize: () => {},
    dispose: () => {},
  };

  const dummyCanvas = { width: 320, height: 180 } as unknown as HTMLCanvasElement;
  const gpu = new GpuEngine(dummyCanvas, undefined, atlas);
  (gpu as unknown as { backend: IGpuBackend }).backend = mockBackend;
  gpu.setFilterModeCode(2);

  const bridge = new SceneGpuBridge();
  const ac = new AstralChroniclesGame(0);
  const params = new CartridgeRunner('astral-chronicles').getParams();
  const snap = ac.snapshot(params);
  snap.bgStars = [{ x: 40, y: 24, size: 2, phase: 0.4, color: '#fffaf0' }];
  bridge.render(gpu, snap, null);

  check(uploadCalls === 1 && uploadedLut, 'GpuEngine.flush should upload dirty dynamic atlas + indexPixels + paletteLut');
  check(capturedGlow === params.glowIntensity && capturedFilterMode === 2, 'SceneGpuBridge/GpuEngine must forward glowIntensity and filterMode');
  check(
    capturedSkyMid !== undefined && capturedSkyMid.every((c) => Number.isFinite(c) && c >= 0 && c <= 1),
    'GpuEngine must compute and forward perceptual Oklab sky.mid color',
  );
  check(capturedModesAlpha.includes(3), 'SceneGpuBridge must emit Mode 3 analytical soft elliptical shadows');
  check(capturedModesAlpha.includes(4), 'SceneGpuBridge must emit Mode 4 normal-lit beveled masonry/earth/astral walls');
  check(capturedModesAlpha.includes(5), 'SceneGpuBridge must emit Mode 5 smooth atmospheric haze/vignette gradients');
  check(
    capturedModesAdd.includes(1) && capturedParamsAdd.some((p) => p >= 10),
    'SceneGpuBridge must emit Mode 1 (>=10) 4-point star glints for bgStars',
  );

  // Verify PA-01 sprint skewX & anchorY=1 pivot projection
  const cbRunner = new CartridgeRunner('cloudberry-hop');
  for (let i = 0; i < 8; i++) cbRunner.stepFixed(1 / 60, { ...emptyInput(), right: true });
  capturedPivotsY.length = 0;
  capturedSkewsX.length = 0;
  bridge.render(gpu, cbRunner.getSnapshot(), null);
  check(
    capturedPivotsY.includes(1) && capturedSkewsX.some((s) => s > 0.01),
    'PA-01 moving hero must emit anchorY=1 pivot and positive sprint skewX',
  );

  // Verify PA-02 emissive bullets & sector paletteRow
  const shmupRunner = new CartridgeRunner('sugar-starlight');
  shmupRunner.dispatchCommand('launch_sortie');
  for (let i = 0; i < 4; i++) shmupRunner.stepFixed(1 / 60, { ...emptyInput(), action: true });
  const shmupSnap = shmupRunner.getSnapshot();
  check(
    shmupSnap.entities.some((e) => (e.emissive ?? 0) > 0.5),
    'PA-02 must emit emissive bloom weights on projectiles/pickups',
  );
  capturedPaletteRows.length = 0;
  shmupSnap.paletteRow = 2;
  shmupSnap.cameraX = 12.25;
  shmupSnap.cameraY = -4.35;
  shmupSnap.cameraZoom = 1;
  bridge.render(gpu, shmupSnap, null);
  check(capturedPaletteRows.includes(2), 'SceneGpuBridge must propagate snapshot.paletteRow to GPU instances');
  check(
    Math.abs(capturedCamFracX - 0.25) < 1e-4 && Math.abs(capturedCamFracY - -0.35) < 1e-4,
    'SceneGpuBridge must forward fractional camera offset for overscan sub-pixel panning',
  );

  // Verify WGSL / GLSL ES 3.00 shader parity markers
  const rootDir = process.cwd();
  const wgslSrc = fs.readFileSync(path.join(rootDir, 'src/core/gpu/WebGpuShaders.ts'), 'utf8');
  const glslSrc = fs.readFileSync(path.join(rootDir, 'src/core/gpu/WebGl2Shaders.ts'), 'utf8');
  check(
    wgslSrc.includes('uIndexAtlas') &&
      wgslSrc.includes('uPaletteLut') &&
      wgslSrc.includes('fsComposite') &&
      wgslSrc.includes('OVERSCAN_PAD') &&
      wgslSrc.includes('uPost.params2') &&
      wgslSrc.includes('uSky.extra.yzw') &&
      wgslSrc.includes('bayer4x4') &&
      wgslSrc.includes('karisWeight') &&
      wgslSrc.includes('acesFilmic') &&
      wgslSrc.includes('bitcast<u32>') &&
      wgslSrc.includes('srgbToLin') &&
      glslSrc.includes('uIndexAtlas') &&
      glslSrc.includes('uPaletteLut') &&
      glslSrc.includes('COMPOSITE_FS') &&
      glslSrc.includes('uCamFrac') &&
      glslSrc.includes('OVERSCAN_PAD') &&
      glslSrc.includes('uViewSize') &&
      glslSrc.includes('uMidColor') &&
      glslSrc.includes('precision highp int;') &&
      glslSrc.includes('bayer4x4') &&
      glslSrc.includes('karisWeight') &&
      glslSrc.includes('acesFilmic') &&
      glslSrc.includes('uint(ip.x)') &&
      glslSrc.includes('srgbToLin'),
    'WebGpuShaders and WebGl2Shaders must maintain LUT + Karis Bloom + ACES + Bayer Dither + Integer Hash + Sky Midpoint parity',
  );

  console.log('[SIM OK] Upgraded GPU Art Pipeline (20-float LUT/Skew + 3-Pass Bloom/Post + Overscan) verified');
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
  const injectedSandbox = new SandboxToyboxGame('window.alert(1);');
  check(Boolean(injectedSandbox.scriptError), 'Sandbox DSL must reject arbitrary JS statements');
  const protoSandbox = new SandboxToyboxGame('api.addMovingPlatform(10, 20, 3, { __proto__: 1 });');
  check(Boolean(protoSandbox.scriptError), 'Sandbox DSL must reject forbidden prototype keys');
  const validOptSandbox = new SandboxToyboxGame("api.addMovingPlatform(120, 100, 3, { minX: 80, maxX: 180, vx: 30 }); api.addStar(130, 80);");
  check(validOptSandbox.scriptError === null, 'Sandbox DSL must support flat option objects for moving platforms');

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

export async function testM3LoadCartridgeAndPngCodec(): Promise<void> {
  const atlas = new TextureAtlas();
  const runner = new CartridgeRunner('cloudberry-hop');
  const save = new SaveService();
  const host = new EngineHost(runner, new ToySynth(), save);
  host.bindAtlas(atlas);
  host.mount('cloudberry-hop');
  host.stepFrame(1 / 60, { ...emptyInput(), right: true });
  host.saveActiveSram();
  check(host.hasSram('cloudberry-hop'), 'Active cloudberry-hop SRAM should exist before invalid loadCartridge test');

  // Bad JSON / bad schema must reject without disturbing active cartridge or SRAM
  const badSyntax = host.loadCartridge('{ bad json');
  check(!badSyntax.ok && host.activeCartridge === 'cloudberry-hop' && host.hasSram('cloudberry-hop'), 'Invalid JSON string must reject without side effects');
  const badSchema = host.loadCartridge({ version: 1, meta: { id: 'x' } });
  check(!badSchema.ok && host.activeCartridge === 'cloudberry-hop', 'Invalid schema must reject without altering active cartridge');

  // Valid custom cartridge with dynamic sprite grid (uses index 14 for bloom LUT)
  const customCartridge: CartridgeJsonV1 = {
    version: 1,
    meta: { id: 'custom-m3-test', code: 'M3', title: 'M3 測試卡匣', genre: 'platformer', paletteRow: 1 },
    sprites: {
      custom_gem: [
        '................',
        '......eeee......',
        '.....e2222e.....',
        '....e2ffff2e....',
        '....eeeeeeee....',
        '.....eeeeee.....',
        '......eeee......',
        '.......ee.......',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
        '................',
      ],
    },
    player: { controller: 'platformer', sprite: 'hero_a', spriteB: 'hero_b', w: 16, h: 16, maxHearts: 3 },
    archetypes: {
      star: { sprite: 'custom_gem', w: 16, h: 16, tags: ['collectible', 'star'], scoreValue: 100 },
      gate: { sprite: 'gate_closed', w: 16, h: 16, tags: ['gate'] },
    },
    stages: [
      {
        id: 'st-1',
        name: '1-1 測試',
        worldWidth: 320,
        skyTop: '#76c7ff',
        skyBottom: '#fff3df',
        bgmTheme: 'meadow',
        hint: '收集寶石',
        spawn: { x: 24, y: 120 },
        groundTop: 'grass',
        groundFill: 'dirt',
        spawns: [
          { archetype: 'star', x: 96, y: 120 },
          { archetype: 'gate', x: 240, y: 128 },
        ],
      },
    ],
  };

  const loaded = host.loadCartridge(customCartridge, { save: true, mount: true });
  check(loaded.ok && loaded.id === 'custom-m3-test' && host.activeCartridge === 'custom-m3-test', 'Valid loadCartridge must register, save, and mount custom-* cartridge');
  check(host.hasCustomCartridge('custom-m3-test') && host.getCartridgeJson('custom-m3-test')?.meta.title === 'M3 測試卡匣', 'Saved custom cartridge must be queryable via EngineHost');

  const gemRect = atlas.getRect('custom_gem');
  const gemX = Math.floor(gemRect.u0 * ATLAS_SIZE) + 6;
  const gemY = Math.floor(gemRect.v0 * ATLAS_SIZE) + 1;
  check(gemRect.v0 >= 128 / ATLAS_SIZE && atlas.indexPixels[gemY * ATLAS_SIZE + gemX] === 14, 'Custom grid sprite must write palette index 14 into dynamic >=128px atlas region');

  // Minimal valid 1x1 PNG + iTXt roundtrip
  const minimalPng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const encodedPng = await embedCartridgeIntoPng(minimalPng, customCartridge);
  const decoded = await extractCartridgeFromPng(encodedPng);
  check(decoded.ok && decoded.data.meta.title === 'M3 測試卡匣' && decoded.data.stages.length === 1, 'PNG iTXt embed/extract must roundtrip CartridgeJsonV1');

  // Corrupt CRC must fail
  const tampered = new Uint8Array(encodedPng);
  tampered[tampered.length - 20] ^= 0xff;
  const badCrc = await extractCartridgeFromPng(tampered);
  check(!badCrc.ok, 'Corrupted PNG iTXt chunk must fail CRC check');

  // Oversized PNG file (>4MB) must reject
  const oversized = new Uint8Array(MAX_PNG_FILE_BYTES + 1);
  oversized.set(minimalPng.subarray(0, 8), 0);
  const tooBig = await extractCartridgeFromPng(oversized);
  check(!tooBig.ok, 'PNG exceeding 4MB limit must be rejected');

  // Decompression bomb (>512KB uncompressed JSON) must be stopped by streaming cap
  const bigStr = JSON.stringify({ pad: 'A'.repeat(MAX_DECOMPRESSED_JSON_BYTES + 4096) });
  const bombBytes = new TextEncoder().encode(bigStr);
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const wp = writer.write(bombBytes).then(() => writer.close());
  const compBomb = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  await wp;
  const keyBytes = new TextEncoder().encode('pixer-cartridge-v1');
  const itxtData = new Uint8Array(keyBytes.length + 5 + compBomb.length);
  itxtData.set(keyBytes, 0);
  itxtData[keyBytes.length + 1] = 1;
  itxtData.set(compBomb, keyBytes.length + 5);
  const bombChunk = new Uint8Array(12 + itxtData.length);
  const dv = new DataView(bombChunk.buffer);
  dv.setUint32(0, itxtData.length, false);
  bombChunk.set([0x69, 0x54, 0x58, 0x74], 4);
  bombChunk.set(itxtData, 8);
  // Compute CRC for bomb chunk
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + itxtData.length; i++) {
    crc ^= bombChunk[i];
    for (let b = 0; b < 8; b++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  dv.setUint32(8 + itxtData.length, (crc ^ 0xffffffff) >>> 0, false);
  const bombPng = new Uint8Array(minimalPng.length + bombChunk.length);
  bombPng.set(minimalPng.subarray(0, minimalPng.length - 12), 0);
  bombPng.set(bombChunk, minimalPng.length - 12);
  bombPng.set(minimalPng.subarray(minimalPng.length - 12), minimalPng.length - 12 + bombChunk.length);
  const bombRes = await extractCartridgeFromPng(bombPng);
  check(!bombRes.ok, 'Decompression bomb exceeding 512KB JSON limit must be aborted and rejected');

  const pa01Json = host.getCartridgeJson('cloudberry-hop');
  check(Boolean(pa01Json), 'Built-in PA-01 cloudberry-hop must expose CartridgeJsonV1 for Polaroid PNG export');
  if (pa01Json) {
    const pa01Png = await embedCartridgeIntoPng(minimalPng, pa01Json);
    const pa01Decoded = await extractCartridgeFromPng(pa01Png);
    check(pa01Decoded.ok, 'Built-in PA-01 Polaroid PNG must decode cleanly');
    if (pa01Decoded.ok) {
      const remixed = host.loadCartridge(pa01Decoded.data, { save: true, mount: false });
      check(
        remixed.ok && remixed.id === 'custom-cloudberry-hop' && host.getCartridgeJson('cloudberry-hop')?.meta.id === 'cloudberry-hop',
        'Imported PA-01 Polaroid PNG must register as custom-cloudberry-hop without mutating built-in PA-01',
      );
      host.deleteCustomCartridge('custom-cloudberry-hop');
    }
  }

  check(host.deleteCustomCartridge('custom-m3-test') && !host.hasCustomCartridge('custom-m3-test'), 'deleteCustomCartridge must cleanly remove saved cartridge and registry entry');
  host.destroy();
  console.log('[SIM OK] M3 EngineHost.loadCartridge & Polaroid PNG iTXt Codec (with Bomb/CRC guards) verified');
}

export function testM41DynamicViewportAndCamera(): void {
  const classic = resolveLogicalViewport('classic');
  const wide = resolveLogicalViewport('wide');
  const hd = resolveLogicalViewport('hd');
  const custom = resolveLogicalViewport({ width: 512, height: 288 });
  check(
    classic.width === 320 && classic.height === 180 && wide.width === 426 && wide.height === 240 && hd.width === 480 && hd.height === 270 && custom.width === 512 && custom.height === 288,
    'resolveLogicalViewport must resolve classic/wide/hd presets and custom dimensions',
  );

  const gov = new DisplayThermalGovernor('balanced', true); // 2x baseline scale
  gov.setLogicalViewport(480, 270);
  const px = gov.getTargetPixelSize();
  check(px.width === 960 && px.height === 540, 'DisplayThermalGovernor must scale pixel buffer from dynamic logical viewport');

  const cam = new CameraDirector();
  cam.setViewport(426, 240);
  cam.reset(0, 0, 1.0, { minX: 0, minY: 0, maxX: 852, maxY: 480 });
  const initX = cam.x;
  const initY = cam.y;
  check(initX === 213 && initY === 120, 'CameraDirector must clamp center to half of dynamic viewport');
  const alignedFields = cam.toSnapshotFields(1.5, -2.5);
  check(
    alignedFields.cameraX === 1.5 && alignedFields.cameraY === -2.5,
    `CameraDirector.toSnapshotFields must align against dynamic viewW/viewH (got ${alignedFields.cameraX}, ${alignedFields.cameraY})`,
  );
  cam.panTo(900, 900, 1.0, 0);
  check(cam.x === 639 && cam.y === 360, 'CameraDirector must clamp max bounds using dynamic viewport');
  const maxAligned = cam.toSnapshotFields();
  check(
    maxAligned.cameraX === 639 - 213 && maxAligned.cameraY === 360 - 120,
    'CameraDirector.toSnapshotFields max bounds must offset cleanly by dynamic viewport half-extents',
  );

  const tallCart: CartridgeJsonV1 = {
    version: 1,
    meta: {
      id: 'm41-tall-test',
      code: 'M41',
      title: 'M4.1 Tall Stage',
      genre: 'platformer',
      viewport: 'wide',
    },
    player: { controller: 'platformer', sprite: 'hero_a', spriteB: 'hero_b', w: 16, h: 16, maxHearts: 3 },
    archetypes: {
      star: { sprite: 'star_a', w: 12, h: 12, tags: ['collectible', 'star'], scoreValue: 100 },
    },
    stages: [
      {
        id: 'st-tall',
        name: 'Vertical Tower',
        worldWidth: 640,
        worldHeight: 480,
        skyTop: '#1d1a3b',
        skyBottom: '#3e356e',
        bgmTheme: 'meadow',
        hint: 'Vertical tower test',
        spawn: { x: 48, y: 300 },
        groundTop: 'grass',
        groundFill: 'dirt',
        islands: [{ startTile: 0, countTiles: 40, topY: 416 }],
        spawns: [{ archetype: 'star', x: 120, y: 380 }],
      },
    ],
  };

  const params = new CartridgeRunner().getParams();
  const rt = new DataCartridgeRuntime(tallCart);
  check(rt.scriptError === null, 'M4.1 tall stage cartridge must validate cleanly');
  for (let i = 0; i < 45; i++) {
    rt.step(1 / 60, emptyInput(), params);
  }
  const snap = rt.snapshot(params);
  check(snap.viewport?.width === 426 && snap.viewport?.height === 240, 'DataCartridgeRuntime.snapshot must emit resolved stage viewport');
  check(snap.cameraY > 120 && snap.cameraY <= 240, `DataCartridgeRuntime must track vertical cameraY in tall worlds (got ${snap.cameraY.toFixed(1)})`);

  console.log('[SIM OK] M4.1 Dynamic Logical Viewport & True 2D Camera verified');
}

export function testM42M43ChunkedWorldsAndMultiLayerDepth(): void {
  // 1. Differential Oracle 1: TilemapGrid 16x16 Chunk Streaming (1024x256) vs Naive Dense Flat Grid
  const cols = 1024;
  const rows = 256;
  const grid = new TilemapGrid(cols, rows);
  const flatTiles = new Uint16Array(cols * rows);
  const flatCols = new Uint8Array(cols * rows);

  const setBothCell = (c: number, r: number, tid: number, colKind: number): void => {
    grid.setTile(c, r, tid, colKind, false);
    if (c >= 0 && c < cols && r >= 0 && r < rows) {
      flatTiles[r * cols + c] = tid;
      flatCols[r * cols + c] = tid === 0 ? COLLISION_EMPTY : colKind;
    }
  };
  const setBothRect = (c0: number, r0: number, w: number, h: number, tid: number, colKind: number): void => {
    grid.fillRectTiles(c0, r0, w, h, tid, colKind);
    for (let r = Math.max(0, r0); r < Math.min(rows, r0 + h); r++) {
      for (let c = Math.max(0, c0); c < Math.min(cols, c0 + w); c++) {
        flatTiles[r * cols + c] = tid;
        flatCols[r * cols + c] = tid === 0 ? COLLISION_EMPTY : colKind;
      }
    }
  };

  setBothRect(14, 14, 5, 4, 1, COLLISION_SOLID); // crosses cx 0|1 (c=15|16) and cy 0|1 (r=15|16)
  setBothCell(16, 15, 0, COLLISION_EMPTY); // carve seam notch to stress cross-chunk auto-masking
  setBothRect(15, 22, 4, 1, 3, COLLISION_CLOUD); // cloud across cx 0|1
  setBothCell(17, 21, 9, COLLISION_HAZARD);
  setBothRect(62, 126, 4, 4, 2, COLLISION_SOLID); // crosses cx 3|4 and cy 7|8
  setBothRect(1006, 248, 8, 6, 1, COLLISION_SOLID); // far map corner (cx=62..63, cy=15)
  grid.recomputeAutoMask();

  check(grid.chunksX === 64 && grid.chunksY === 16 && grid.totalChunks === 1024, 'TilemapGrid 1024x256 must partition into 64x16=1024 chunks');
  check(grid.getAllocatedChunkCount() <= 10, `Sparse TilemapGrid should only allocate touched chunks (allocated ${grid.getAllocatedChunkCount()}/1024)`);

  const flatMask = (c: number, r: number): number => {
    const tid = flatTiles[r * cols + c];
    if (tid === 0) return 0;
    let m = 0;
    if (r > 0 && flatTiles[(r - 1) * cols + c] === tid) m |= 1;
    if (c + 1 < cols && flatTiles[r * cols + c + 1] === tid) m |= 2;
    if (r + 1 < rows && flatTiles[(r + 1) * cols + c] === tid) m |= 4;
    if (c > 0 && flatTiles[r * cols + c - 1] === tid) m |= 8;
    return m;
  };

  const verifyWindow = (c0: number, r0: number, c1: number, r1: number): void => {
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = r * cols + c;
        check(
          grid.getTile(c, r) === flatTiles[idx] &&
            grid.getCollision(c, r) === flatCols[idx] &&
            grid.getAutoMask(c, r) === flatMask(c, r),
          `TilemapGrid chunk vs flat oracle mismatch at (${c},${r})`,
        );
      }
    }
  };
  verifyWindow(12, 12, 22, 25);
  verifyWindow(60, 124, 67, 131);
  verifyWindow(1004, 246, 1016, 255);

  const streamedChunks = grid.updateActiveChunks(0, 0, 480, 270, 32);
  check(
    streamedChunks > 0 && streamedChunks <= 6 && streamedChunks < grid.getAllocatedChunkCount(),
    `updateActiveChunks must stream only viewport+margin chunks (streamed ${streamedChunks} of ${grid.getAllocatedChunkCount()} allocated)`,
  );

  // Cross-chunk physics kinematics parity (one-way cloud + ceiling 4px corner nudge at c=15|16)
  const cloudBox = { x: 15 * 16 + 8, y: 22 * 16 - 14 - 3, vx: 0, vy: 240 };
  const aabbOut = { onGround: false, hitWall: false, hitCeiling: false, hitHazard: false, landVy: 0 };
  grid.resolveAabbMotion(cloudBox, 2, 2, 12, 14, 1 / 60, aabbOut);
  check(
    aabbOut.onGround && cloudBox.y === 22 * 16 - 16,
    'TilemapGrid.resolveAabbMotion must land AABB cleanly on cross-chunk one-way cloud',
  );
  setBothCell(15, 30, 1, COLLISION_SOLID);
  const cornerBox = { x: 16 * 16 - 5, y: 31 * 16 - 1, vx: 0, vy: -180 };
  grid.resolveAabbMotion(cornerBox, 2, 2, 12, 14, 1 / 60, aabbOut);
  check(
    !aabbOut.hitCeiling && cornerBox.x === 16 * 16 - 2,
    'TilemapGrid.resolveAabbMotion must preserve 4px ceiling corner nudge across chunk boundaries',
  );

  // 2. Differential Oracle 2: SoaEntityPool.spatialHash (2,048 active entities) vs O(N^2) Brute-Force Oracle
  const runSpatialCheck = (seed: number) => {
    const pool = new SoaEntityPool();
    const rng = new SeededRng(seed);
    for (let i = 0; i < MAX_ENTITIES; i++) {
      const isBridge = i % 97 === 0;
      const w = isBridge ? 420 : rng.range(8, 28);
      const h = isBridge ? 18 : rng.range(8, 28);
      const x = rng.range(-128, 16200);
      const y = rng.range(-64, 4000);
      const s = pool.alloc(x, y, w, h);
      check(s >= 0, `SoaEntityPool alloc ${i} must succeed up to 2048`);
    }
    const tRebuild0 = performance.now();
    pool.rebuildSpatialHash();
    const tRebuildMs = performance.now() - tRebuild0;

    const queryScratch = new Int32Array(MAX_ENTITIES);
    const oracleSlots: number[] = [];
    const hashSlots: number[] = [];
    const probeRng = new SeededRng(seed ^ 0x55aa);
    const digestHashes: number[] = [];

    const tQuery0 = performance.now();
    for (let q = 0; q < 16; q++) {
      const qx0 = q === 0 ? -100 : q === 1 ? 8000 : probeRng.range(-160, 15800);
      const qy0 = q === 0 ? -40 : q === 1 ? 1800 : probeRng.range(-80, 3850);
      const qw = q === 1 ? 1400 : probeRng.range(24, 320);
      const qh = q === 1 ? 900 : probeRng.range(24, 240);
      const qx1 = qx0 + qw;
      const qy1 = qy0 + qh;

      const gotCount = pool.queryRect(qx0, qy0, qx1, qy1, queryScratch);
      hashSlots.length = 0;
      for (let i = 0; i < gotCount; i++) hashSlots.push(queryScratch[i]);
      hashSlots.sort((a, b) => a - b);

      oracleSlots.length = 0;
      for (let i = 0; i < pool.activeCount; i++) {
        const s = pool.activeIndices[i];
        const ex0 = pool.x[s];
        const ey0 = pool.y[s];
        const ex1 = ex0 + pool.w[s];
        const ey1 = ey0 + pool.h[s];
        if (qx0 < ex1 && qx1 > ex0 && qy0 < ey1 && qy1 > ey0) {
          oracleSlots.push(s);
        }
      }
      oracleSlots.sort((a, b) => a - b);

      check(
        hashSlots.length === oracleSlots.length && hashSlots.every((v, idx) => v === oracleSlots[idx]),
        `SoaEntityPool.queryRect brute-force oracle mismatch on probe ${q} (got ${hashSlots.length}, expected ${oracleSlots.length})`,
      );
      digestHashes.push(hashSlots.length);

      // Radius probe comparison against exact bounding-rect + Euclidean clamp oracle
      const cx = qx0 + qw * 0.5;
      const cy = qy0 + qh * 0.5;
      const radius = Math.min(260, Math.max(24, qw * 0.5));
      const r2 = radius * radius;
      const rGot = pool.queryRadius(cx, cy, radius, queryScratch);
      hashSlots.length = 0;
      for (let i = 0; i < rGot; i++) hashSlots.push(queryScratch[i]);
      hashSlots.sort((a, b) => a - b);

      oracleSlots.length = 0;
      for (let i = 0; i < pool.activeCount; i++) {
        const s = pool.activeIndices[i];
        const ex0 = pool.x[s];
        const ey0 = pool.y[s];
        const ex1 = ex0 + pool.w[s];
        const ey1 = ey0 + pool.h[s];
        if (cx - radius < ex1 && cx + radius > ex0 && cy - radius < ey1 && cy + radius > ey0) {
          const nx = Math.max(ex0, Math.min(cx, ex1));
          const ny = Math.max(ey0, Math.min(cy, ey1));
          const dx = cx - nx;
          const dy = cy - ny;
          if (dx * dx + dy * dy <= r2) oracleSlots.push(s);
        }
      }
      oracleSlots.sort((a, b) => a - b);

      check(
        hashSlots.length === oracleSlots.length && hashSlots.every((v, idx) => v === oracleSlots[idx]),
        `SoaEntityPool.queryRadius brute-force oracle mismatch on probe ${q}`,
      );
    }
    const tQueryMs = performance.now() - tQuery0;
    return { tRebuildMs, tQueryMs, digestHashes };
  };

  const spRunA = runSpatialCheck(0x42422048);
  const spRunB = runSpatialCheck(0x42422048);
  check(
    spRunA.digestHashes.every((v, idx) => v === spRunB.digestHashes[idx]),
    'SoaEntityPool.spatialHash queries must be bit-identical across runs',
  );

  // 3. Multi-Layer Large World (4096x1024 px) + Parallax Overscan Identity + Layer Draw Order + 1024x1024 Atlas + 16384 Pass
  const chunks: CartridgeTileChunkDef[] = [];
  for (let cx = 0; cx < 16; cx++) {
    const tiles = new Array<number>(CHUNK_AREA).fill(0);
    const collision = new Array<number>(CHUNK_AREA).fill(COLLISION_EMPTY);
    const fgTiles = new Array<number>(CHUNK_AREA).fill(0);
    for (let lc = 0; lc < CHUNK_SIZE; lc++) {
      tiles[8 * CHUNK_SIZE + lc] = 1;
      collision[8 * CHUNK_SIZE + lc] = COLLISION_SOLID;
      for (let lr = 9; lr < CHUNK_SIZE; lr++) {
        tiles[lr * CHUNK_SIZE + lc] = 2;
        collision[lr * CHUNK_SIZE + lc] = COLLISION_SOLID;
      }
      if (cx <= 2 && lc % 2 === 0) {
        fgTiles[5 * CHUNK_SIZE + lc] = 1; // canopy occluder above corridor
      }
    }
    if (cx === 0 || cx === 1) {
      // Cross-chunk high bridge at localRow=4 (row=52)
      for (let lc = cx === 0 ? 12 : 0; lc < (cx === 0 ? 16 : 6); lc++) {
        tiles[4 * CHUNK_SIZE + lc] = 4;
        collision[4 * CHUNK_SIZE + lc] = COLLISION_CLOUD;
      }
    }
    chunks.push({ cx, cy: 3, tiles, collision, fgTiles });
  }

  const largeWorldCart: CartridgeJsonV1 = {
    version: 1,
    meta: {
      id: 'm43-large-multilayer',
      code: 'M43',
      title: 'M4.3 廣闊多層世界',
      genre: 'platformer',
      viewport: 'wide',
    },
    player: { controller: 'platformer', sprite: 'hero_a', spriteB: 'hero_b', w: 16, h: 16, maxHearts: 3 },
    archetypes: {
      star: { sprite: 'star_a', w: 12, h: 12, tags: ['collectible', 'star'], scoreValue: 100 },
      slime: { sprite: 'slime_a', spriteB: 'slime_b', w: 16, h: 16, tags: ['enemy', 'stompable'], behavior: { kind: 'patrol', speedX: 28 }, hp: 1 },
      torch: { sprite: 'torch', w: 16, h: 16, tags: ['torch'], light: { radius: 48, color: '#ffd447', intensity: 0.7 } },
      gate: { sprite: 'gate_closed', w: 16, h: 16, tags: ['gate'] },
    },
    stages: [
      {
        id: 'st-mega',
        name: '4096x1024 多層森域',
        worldWidth: 4096,
        worldHeight: 1024,
        skyTop: '#24305e',
        skyBottom: '#a8d0e6',
        ambientDarkness: 0.35,
        ambientColor: '#120e24',
        bgmTheme: 'meadow',
        hint: 'Multi-layer depth test',
        spawn: { x: 48, y: 880 },
        tileChunks: chunks,
        bgParallaxLayers: [
          { sprite: 'cloud_m', x: 0, y: 200, w: 64, h: 32, scrollX: 0.25, scrollY: 0.2, repeatW: 4096, repeatStepX: 128, alpha: 0.75 },
        ],
        fgIslands: [{ startTile: 2, countTiles: 6, topY: 848, rows: 1, sprite: 'tree_canopy', alpha: 0.9 }],
        fgTiles: [{ sprite: 'tree_canopy', x: 112, y: 864, w: 32, h: 32, alpha: 0.85 }],
        spawns: [
          { archetype: 'star', x: 96, y: 880 },
          { archetype: 'torch', x: 128, y: 880 },
          { archetype: 'slime', x: 240, y: 880, minX: 192, maxX: 320 },
          { archetype: 'gate', x: 3968, y: 880 },
        ],
      },
    ],
  };

  const valLarge = validateCartridgeJson(largeWorldCart);
  check(valLarge.ok, `4096x1024 multi-layer chunked cartridge failed validation: ${valLarge.ok ? '' : valLarge.errors.join('; ')}`);

  const params = new CartridgeRunner().getParams();
  const rtA = new DataCartridgeRuntime(largeWorldCart);
  const rtB = new DataCartridgeRuntime(largeWorldCart);
  check(rtA.scriptError === null, `Large multi-layer cartridge runtime init failed: ${rtA.scriptError ?? ''}`);

  for (let f = 0; f < 60; f++) {
    const inp = { ...emptyInput(), right: true, jump: f % 25 < 6 };
    rtA.step(1 / 60, inp, params);
    rtB.step(1 / 60, inp, params);
  }
  const snapA = rtA.snapshot(params);
  const snapB = rtB.snapshot(params);
  check(
    snapA.cameraX === snapB.cameraX &&
      snapA.cameraY === snapB.cameraY &&
      snapA.tiles.length === snapB.tiles.length &&
      snapA.entities.length === snapB.entities.length,
    'Large chunked DataCartridgeRuntime simulation must be 100% deterministic',
  );
  check(
    snapA.cameraY > 650 && snapA.cameraY <= 1024 - 240,
    `4096x1024 cameraY must track deep vertical terrain (got ${snapA.cameraY.toFixed(1)})`,
  );
  check(
    Boolean(snapA.bgParallaxLayers?.length) && Boolean(snapA.fgTiles?.length),
    'Large world snapshot must emit bgParallaxLayers and frustum-culled fgTiles',
  );

  // Verify draw order in SceneGpuBridge: bgParallaxLayers -> tiles/hero -> fgTiles -> ambientDarkness (Mode 2)
  const atlas = new TextureAtlas();
  const cloudRect = atlas.getRect('cloud_m');
  const canopyRect = atlas.getRect('tree_canopy');
  const heroRect = atlas.getRect('hero_a');
  const heroRectB = atlas.getRect('hero_b');

  const drawOrderTags: string[] = [];
  let capturedAlphaCount = 0;
  let capturedAddCount = 0;
  const inspectorBackend: IGpuBackend = {
    kind: 'webgpu',
    uploadAtlas: () => {},
    renderFrame: (_sky, alphaItems, alphaCount, _addItems, addCount) => {
      capturedAlphaCount = alphaCount;
      capturedAddCount = addCount;
      for (let i = 0; i < alphaCount; i++) {
        const base = i * FLOATS_PER_INSTANCE;
        const w = alphaItems[base + 2];
        const u0 = alphaItems[base + 4];
        const v0 = alphaItems[base + 5];
        const mode = alphaItems[base + 13];
        if (mode === 0 && Math.abs(u0 - cloudRect.u0) < 1e-5 && Math.abs(v0 - cloudRect.v0) < 1e-5 && w > 40) {
          drawOrderTags.push('parallax');
        } else if (
          mode === 0 &&
          ((Math.abs(u0 - heroRect.u0) < 1e-5 && Math.abs(v0 - heroRect.v0) < 1e-5) ||
            (Math.abs(u0 - heroRectB.u0) < 1e-5 && Math.abs(v0 - heroRectB.v0) < 1e-5))
        ) {
          drawOrderTags.push('hero');
        } else if (mode === 0 && Math.abs(u0 - canopyRect.u0) < 1e-5 && Math.abs(v0 - canopyRect.v0) < 1e-5) {
          drawOrderTags.push('fg_canopy');
        } else if (mode === 2 && w > 420) {
          drawOrderTags.push('ambient');
        }
      }
      return 4;
    },
    resize: () => {},
    dispose: () => {},
  };

  const gpu = new GpuEngine({ width: 426, height: 240 } as unknown as HTMLCanvasElement, undefined, atlas);
  (gpu as unknown as { backend: IGpuBackend }).backend = inspectorBackend;
  const bridge = new SceneGpuBridge();
  bridge.render(gpu, snapA, null);

  const firstParallax = drawOrderTags.indexOf('parallax');
  const heroIdx = drawOrderTags.indexOf('hero');
  const firstCanopy = drawOrderTags.indexOf('fg_canopy');
  const ambientIdx = drawOrderTags.indexOf('ambient');
  check(
    firstParallax >= 0 && heroIdx > firstParallax && firstCanopy > heroIdx && ambientIdx > firstCanopy,
    `SceneGpuBridge layer order mismatch (parallax=${firstParallax}, hero=${heroIdx}, fgCanopy=${firstCanopy}, ambient=${ambientIdx})`,
  );

  // Overscan sub-pixel parallax identity check: (Pass1Coord - camFrac) === exact zoomed world scroll equation
  for (const zoom of [0.85, 1.0, 1.4]) {
    for (const scroll of [0, 0.25, 0.65, 1.0]) {
      for (const rawCam of [12.37, 255.81, 1024.19]) {
        const snapped = Math.round(rawCam);
        const camFrac = (rawCam - snapped) * zoom;
        const pass1 = computeParallaxScreenCoord(360, snapped, camFrac, scroll, 426, zoom);
        const afterOverscanCrop = pass1 - camFrac;
        const exact = 426 * 0.5 + (360 - rawCam * scroll - 426 * 0.5) * zoom;
        check(
          Math.abs(afterOverscanCrop - exact) < 1e-6,
          `Overscan parallax identity failed (diff=${Math.abs(afterOverscanCrop - exact)})`,
        );
      }
    }
  }

  // Verify MAX_INSTANCES_PER_PASS=16384 handles > 8192 instances in a single batch and 1024x1024 atlas packs 300x32x32 sprites
  gpu.beginFrame('#24305e', '#a8d0e6', true, 1);
  for (let i = 0; i < 10000; i++) {
    gpu.drawSpriteRaw('star_a', (i % 400) + 8, (Math.floor(i / 400) * 6) + 8);
  }
  gpu.flush(0.1);
  check(
    capturedAlphaCount === 10000 && capturedAddCount === 0,
    `GpuEngine must batch >=10000 alpha instances in one pass up to MAX_INSTANCES_PER_PASS=16384 (got ${capturedAlphaCount})`,
  );

  const bigAtlas = new TextureAtlas();
  const blockRgba = new Uint8Array(32 * 32 * 4).fill(200);
  for (let i = 0; i < 300; i++) {
    const r = bigAtlas.registerDynamicRgbaSprite(`m43_tile_${i}`, 32, 32, blockRgba);
    check(r.v0 >= 128 / ATLAS_SIZE && r.v1 <= 1, `Dynamic sprite #${i} overflowed 1024x1024 atlas bounds`);
  }

  // 4. Pre-warmed 240-Frame Zero-GC Benchmarks (WorldKernel + large-world DataCartridgeRuntime)
  const world = new WorldKernel({
    cartridgeId: 'sandbox-toybox',
    worldWidth: 2048,
    worldHeight: 512,
    viewport: 'wide',
  });
  world.hero.x = 64;
  world.hero.y = 300;
  world.markSolidsDirty();
  for (let i = 0; i < 64; i++) {
    world.addSolidTileRect(i * 16, 320, 16, 16, 'grass');
  }
  world.addParallaxLayer({ sprite: 'cloud_m', x: 0, y: 200, w: 64, h: 32, scrollX: 0.3, repeatW: 2048 });
  world.addForegroundTileRect(160, 288, 16, 16, 'tree_canopy', { alpha: 0.85 });
  world.spawn('star', 120, 290);
  world.spawn('torch', 144, 296);

  // Warmup (300 frames to stabilize TurboFan JIT & pool capacities)
  for (let i = 0; i < 300; i++) {
    world.step(1 / 60, { ...emptyInput(), right: i % 2 === 0 }, params);
    world.snapshot(params);
    rtA.step(1 / 60, { ...emptyInput(), right: i % 2 === 0 }, params);
    rtA.snapshot(params);
  }

  // Verify 2-bank strict object reuse on both WorldSnapshot and DataCartridgeRuntime
  const ws0 = world.snapshot(params);
  const ws1 = world.snapshot(params);
  const ws2 = world.snapshot(params);
  const ws3 = world.snapshot(params);
  check(
    ws0 === ws2 && ws1 === ws3 && ws0 !== ws1 && ws0.tiles === ws2.tiles && ws0.entities === ws2.entities,
    'WorldSnapshotPool must strictly reuse its 2 ping-pong RenderSceneSnapshot banks with zero wrapper allocations',
  );
  check(
    ws0.tiles.length > 0 && ws0.tiles[0] === ws2.tiles[0] && ws0.entities.length > 0 && ws0.entities[0] === ws2.entities[0],
    'WorldSnapshotPool must reuse pooled TileDesc & EntityDesc slots in place',
  );

  const rs0 = rtA.snapshot(params);
  const rs1 = rtA.snapshot(params);
  const rs2 = rtA.snapshot(params);
  const rs3 = rtA.snapshot(params);
  check(
    rs0 === rs2 && rs1 === rs3 && rs0 !== rs1 && rs0.tiles === rs2.tiles && rs0.entities === rs2.entities,
    'DataCartridgeRuntime must strictly reuse its 2 ping-pong RenderSceneSnapshot banks',
  );
  check(
    rs0.tiles.length > 0 && rs0.tiles[0] === rs2.tiles[0] && rs0.entities.length > 0 && rs0.entities[0] === rs2.entities[0],
    'DataCartridgeRuntime snapshot must reuse pooled TileDesc & EntityDesc slots in place',
  );

  const maybeGc = (globalThis as unknown as { gc?: () => void }).gc;
  maybeGc?.();
  const heapBeforeWk = process.memoryUsage().heapUsed;
  const wkT0 = performance.now();
  for (let i = 0; i < 240; i++) {
    world.snapshot(params);
  }
  const wkMs = performance.now() - wkT0;
  maybeGc?.();
  const wkHeapDeltaKb = (process.memoryUsage().heapUsed - heapBeforeWk) / 1024;

  const heapBeforeRt = process.memoryUsage().heapUsed;
  const rtT0 = performance.now();
  for (let i = 0; i < 240; i++) {
    rtA.snapshot(params);
  }
  const rtMs = performance.now() - rtT0;
  maybeGc?.();
  const rtHeapDeltaKb = (process.memoryUsage().heapUsed - heapBeforeRt) / 1024;

  console.log(
    `[SIM OK] M4.2/M4.3 Chunked Worlds & Multi-Layer HD-2D -> Tilemap(1024x256, allocated=${grid.getAllocatedChunkCount()}/1024), SpatialHash(2048 ent: rebuild=${spRunA.tRebuildMs.toFixed(2)}ms, 32 queries=${spRunA.tQueryMs.toFixed(2)}ms), 1024x1024 Atlas (300x32px dyn, 10k pass batch)`,
  );
  console.log(
    `[SIM BENCH] 240f Snapshot Zero-GC -> WorldKernel=${wkMs.toFixed(2)}ms (heapDelta=${wkHeapDeltaKb.toFixed(1)}KB), ChunkedRuntime(4096x1024)=${rtMs.toFixed(2)}ms (heapDelta=${rtHeapDeltaKb.toFixed(1)}KB)`,
  );
}

export function testProceduralDeclarativeCompiler(): void {
  const params = new CartridgeRunner('cloudberry-hop').getParams();

  // 1. Compact declarative JSON (~30 lines style): no manual tileGrid/skyTop/skyBottom
  const declarativeJson: CartridgeJsonV1 = {
    version: 1,
    meta: { id: 'proc-alpine-test', code: 'PA-T1', title: 'Alpine Procedural Test', genre: 'platformer', viewport: 'wide' },
    player: { controller: 'platformer', sprite: 'hero_a', spriteB: 'hero_b', w: 16, h: 16, maxHearts: 3 },
    archetypes: {
      star: { sprite: 'star_a', spriteB: 'star_b', w: 12, h: 12, tags: ['collectible', 'star'] },
      wisp: { sprite: 'star_b', w: 14, h: 14, tags: ['collectible'], behavior: { kind: 'sine', amplitude: 10, freq: 3.5 } },
      stalker: {
        sprite: 'slime_a',
        spriteB: 'slime_b',
        w: 16,
        h: 14,
        tags: ['enemy', 'stompable', 'gravity'],
        behavior: { kind: 'chase_los', sightRange: 180, chaseSpeed: 64 },
      },
    },
    stages: [
      {
        id: 'alpine-1',
        name: 'Alpine Ridge',
        worldWidth: 1024,
        worldHeight: 288,
        bgmTheme: 'meadow',
        hint: 'Declarative math stage',
        spawn: { x: 32, y: 160 },
        artMood: { baseHex: '#2f5d8a', accentHex: '#ffb074', warmth: -0.25, contrast: 0.7, parallaxFog: 0.55 },
        procedural: {
          seed: 1337,
          biome: 'alpine',
          parallaxBands: 3,
          foregroundCanopy: true,
          autoSpawns: { stars: 6, enemies: 2 },
        },
        springCamera: { freqHz: 4.5, dampingRatio: 1.05 },
        spawns: [{ archetype: 'wisp', x: 96, y: 132 }],
      },
    ],
  };

  const valOk = validateCartridgeJson(declarativeJson);
  check(valOk.ok, `Declarative procedural cartridge failed schema validation: ${valOk.ok ? '' : valOk.errors.join('; ')}`);

  const rtA = new DataCartridgeRuntime(declarativeJson);
  const rtB = new DataCartridgeRuntime(declarativeJson);
  const snapInit = rtA.snapshot(params);
  check(
    snapInit.skyTop !== '#76c7ff' && snapInit.skyBottom !== '#fff3df',
    `artMood should synthesize Oklab skyTop/skyBottom (got ${snapInit.skyTop} -> ${snapInit.skyBottom})`,
  );
  check(
    snapInit.bgParallaxLayers !== undefined && snapInit.bgParallaxLayers.length === 3,
    `procedural.parallaxBands=3 should produce 3 Oklab-tinted parallax layers (got ${snapInit.bgParallaxLayers?.length ?? 0})`,
  );
  check(snapInit.tiles.length > 0, 'procedural alpine stage must generate ground tiles');
  check(snapInit.starsTotal >= 5, `procedural.autoSpawns.stars should populate stage starsTotal (got ${snapInit.starsTotal})`);

  // Step right for 60 ticks and verify bit-identical determinism, sine bobbing, and canopy visibility
  let wispMinY = Infinity;
  let wispMaxY = -Infinity;
  let sawFgCanopy = (snapInit.fgTiles?.length ?? 0) > 0;
  for (let i = 0; i < 60; i++) {
    const inp = { ...emptyInput(), right: true };
    rtA.step(1 / 60, inp, params);
    rtB.step(1 / 60, inp, params);
    const sA = rtA.snapshot(params);
    if ((sA.fgTiles?.length ?? 0) > 0) sawFgCanopy = true;
    check(Number.isFinite(sA.cameraX) && Number.isFinite(sA.cameraY), `springCamera coordinates must remain finite`);

    for (let k = 0; k < rtA.pool.activeCount; k++) {
      const slot = rtA.pool.activeIndices[k];
      const aid = rtA.archetypeMetaByIdx[rtA.pool.archetypeIdx[slot]]?.id;
      if (aid === 'wisp') {
        wispMinY = Math.min(wispMinY, rtA.pool.y[slot]);
        wispMaxY = Math.max(wispMaxY, rtA.pool.y[slot]);
      }
    }
  }

  // Dedicated springCamera smooth monotonic tracking check on flat procedural terrain (no enemy shake)
  const springCartridge: CartridgeJsonV1 = {
    version: 1,
    meta: { id: 'spring-cam-test', code: 'PA-SP', title: 'Spring Camera Test', genre: 'platformer', viewport: 'wide' },
    player: { controller: 'platformer', sprite: 'hero_a', w: 16, h: 16, maxHearts: 3 },
    archetypes: { star: { sprite: 'star_a', w: 12, h: 12, tags: ['collectible', 'star'] } },
    stages: [
      {
        id: 'sp-1',
        name: 'Spring Flat',
        worldWidth: 1024,
        worldHeight: 240,
        bgmTheme: 'meadow',
        hint: 'Spring cam',
        spawn: { x: 240, y: 160 },
        artMood: { baseHex: '#3b6ea5' },
        procedural: { seed: 42, biome: 'meadow', hillAmplitude: 0, gapChance: 0, platformDensity: 0 },
        springCamera: { freqHz: 4.5, dampingRatio: 1.05 },
      },
    ],
  };
  const rtSpring = new DataCartridgeRuntime(springCartridge);
  const springInitCamX = rtSpring.snapshot(params).cameraX;
  let prevSpringCamX = springInitCamX;
  for (let i = 0; i < 60; i++) {
    rtSpring.step(1 / 60, { ...emptyInput(), right: true }, params);
    const scx = rtSpring.snapshot(params).cameraX;
    check(
      Number.isFinite(scx) && scx >= prevSpringCamX - 1e-4,
      `springCamera must track smoothly without NaN or backward jitter (prev=${prevSpringCamX}, cur=${scx})`,
    );
    prevSpringCamX = scx;
  }
  check(
    prevSpringCamX > springInitCamX + 30,
    `springCamera should scroll cleanly as hero moves right (start=${springInitCamX}, end=${prevSpringCamX})`,
  );
  const finalA = rtA.snapshot(params);
  const finalB = rtB.snapshot(params);
  check(
    finalA.cameraX === finalB.cameraX &&
      finalA.cameraY === finalB.cameraY &&
      finalA.tiles.length === finalB.tiles.length &&
      finalA.entities.length === finalB.entities.length,
    'Declarative procedural stage must be bit-identical across two independent runtimes with identical seed',
  );
  check(sawFgCanopy, 'procedural.foregroundCanopy=true should emit foreground tree_canopy tiles');
  check(wispMaxY - wispMinY > 4, `sine behavior should oscillate vertically (delta=${(wispMaxY - wispMinY).toFixed(2)})`);

  // 2. Verify chase_los line-of-sight wall occlusion vs open corridor
  const makeLosCartridge = (withWall: boolean): CartridgeJsonV1 => {
    const cols = 20;
    const rows = 12;
    const tiles = new Array<number>(cols * rows).fill(0);
    const collision = new Array<number>(cols * rows).fill(0);
    for (let c = 0; c < cols; c++) {
      tiles[10 * cols + c] = 1;
      collision[10 * cols + c] = COLLISION_SOLID;
      tiles[11 * cols + c] = 2;
      collision[11 * cols + c] = COLLISION_SOLID;
    }
    if (withWall) {
      for (let r = 6; r <= 9; r++) {
        tiles[r * cols + 8] = 6;
        collision[r * cols + 8] = COLLISION_SOLID;
      }
    }
    return {
      version: 1,
      meta: { id: withWall ? 'los-wall' : 'los-open', code: 'LOS', title: 'LOS Test', genre: 'platformer' },
      player: { controller: 'platformer', sprite: 'hero_a', w: 16, h: 16, maxHearts: 3 },
      archetypes: {
        hunter: {
          sprite: 'slime_a',
          w: 16,
          h: 16,
          tags: ['enemy', 'stompable'],
          behavior: { kind: 'chase_los', sightRange: 220, chaseSpeed: 64 },
        },
      },
      stages: [
        {
          id: 'los-1',
          name: 'LOS Arena',
          worldWidth: cols * 16,
          worldHeight: rows * 16,
          skyTop: '#24305e',
          skyBottom: '#6c8ebf',
          bgmTheme: 'dungeon',
          hint: 'LOS check',
          spawn: { x: 48, y: 144 },
          tileGrid: { cols, rows, tiles, collision, spriteMap: { '1': 'grass', '2': 'dirt', '6': 'stone' } },
          spawns: [{ archetype: 'hunter', x: 176, y: 144 }],
        },
      ],
    };
  };

  const rtBlocked = new DataCartridgeRuntime(makeLosCartridge(true));
  const rtClear = new DataCartridgeRuntime(makeLosCartridge(false));
  for (let i = 0; i < 20; i++) {
    rtBlocked.step(1 / 60, emptyInput(), params);
    rtClear.step(1 / 60, emptyInput(), params);
  }
  const findHunterSlot = (rt: DataCartridgeRuntime): number => {
    for (let i = 0; i < rt.pool.activeCount; i++) {
      const s = rt.pool.activeIndices[i];
      if (rt.archetypeMetaByIdx[rt.pool.archetypeIdx[s]]?.id === 'hunter') return s;
    }
    return -1;
  };
  const bSlot = findHunterSlot(rtBlocked);
  const cSlot = findHunterSlot(rtClear);
  check(bSlot >= 0 && cSlot >= 0, 'Both LOS test runtimes must spawn hunter entity');
  check(
    rtBlocked.pool.aiState[bSlot] === 0 && Math.abs(rtBlocked.pool.x[bSlot] - 176) < 0.01,
    `chase_los must stay idle behind solid wall (aiState=${rtBlocked.pool.aiState[bSlot]}, x=${rtBlocked.pool.x[bSlot]})`,
  );
  check(
    rtClear.pool.aiState[cSlot] === 1 && rtClear.pool.x[cSlot] < 170,
    `chase_los must detect player and chase in open corridor (aiState=${rtClear.pool.aiState[cSlot]}, x=${rtClear.pool.x[cSlot]})`,
  );

  // 3. Zero-GC snapshot bank reuse check on procedural runtime
  for (let i = 0; i < 120; i++) rtA.snapshot(params);
  const p0 = rtA.snapshot(params);
  const p1 = rtA.snapshot(params);
  const p2 = rtA.snapshot(params);
  check(p0 === p2 && p0 !== p1 && p0.tiles === p2.tiles, 'Procedural DataCartridgeRuntime must reuse ping-pong snapshot banks');

  // 4. Schema negative tests for new declarative fields
  const badBiome = structuredClone(declarativeJson) as unknown as { stages: { procedural: { biome: string } }[] };
  badBiome.stages[0].procedural.biome = 'lava_moon';
  check(!validateCartridgeJson(badBiome).ok, 'validateCartridgeJson must reject unknown procedural.biome');

  const badHex = structuredClone(declarativeJson) as unknown as { stages: { artMood: { baseHex: string } }[] };
  badHex.stages[0].artMood.baseHex = 'not-a-color';
  check(!validateCartridgeJson(badHex).ok, 'validateCartridgeJson must reject malformed artMood.baseHex');

  const badSight = structuredClone(declarativeJson) as unknown as { archetypes: { stalker: { behavior: { sightRange: number } } } };
  badSight.archetypes.stalker.behavior.sightRange = -10;
  check(!validateCartridgeJson(badSight).ok, 'validateCartridgeJson must reject non-positive behavior.sightRange');

  const badSpring = structuredClone(declarativeJson) as unknown as { stages: { springCamera: { freqHz: number } }[] };
  badSpring.stages[0].springCamera.freqHz = 99;
  check(!validateCartridgeJson(badSpring).ok, 'validateCartridgeJson must reject out-of-range springCamera.freqHz');

  console.log(
    `[SIM OK] Declarative Procedural Compiler -> Oklab sky=${snapInit.skyTop}->${snapInit.skyBottom}, parallax=${snapInit.bgParallaxLayers.length}, chase_los(blocked=idle, clear=chase x=${rtClear.pool.x[cSlot].toFixed(1)}), springCamera+sine=verified`,
  );
}


