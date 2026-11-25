import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, zlibSync } from 'fflate';
import { createMcpFrameReader } from '../pixer-mcp.ts';
import { critiqueCutsceneAesthetics } from '../../src/core/ai/EcsCinematicOracle.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { ExternalAudioBank, isSafeAudioUrl } from '../../src/core/audio/ExternalAudioBank.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import { validateCutsceneDef } from '../../src/core/ecs/EcsCutsceneSchema.ts';
import { decodeZlibB64ToRgba, uint8ToBase64 } from '../../src/core/ecs/EcsCustomSpriteCompiler.ts';
import { CASTLE_TILE_IDS, setRoomTile } from '../../src/core/ecs/EcsTilemapTypes.ts';
import { StudioSession } from '../../src/core/editor/StudioSession.ts';
import { loadExternalInteropFiles } from '../../src/core/interop/InteropBundleLoader.ts';
import { decodeTiledLayerData } from '../../src/core/interop/TiledImporter.ts';
import {
  CameraRigDirector,
  type ProjectedPoint2D,
} from '../../src/core/runtime/CameraRigDirector.ts';
import {
  GameFlowController,
  resolveSceneCameraShot,
} from '../../src/core/runtime/GameFlowController.ts';
import { DataCartridgeRuntime } from '../../src/core/sim/DataCartridgeRuntime.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { EMERALD_RUINS_PROJECT } from '../../src/game/emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

test('CameraRigDirector converges 6DoF poses, projects 3D points accurately, and enforces static gameplay lock', () => {
  const cam = new CameraRigDirector('TITLE_ORBIT');
  assert.equal(cam.getActiveShot(), 'TITLE_ORBIT');

  cam.setShot('PLAY_SWEEP_LEFT', 8.0);
  for (let i = 0; i < 90; i++) cam.step(1 / 60, 16 / 9);
  assert.ok(cam.current.posX < -0.45, `Expected posX < -0.45, got ${cam.current.posX}`);
  assert.ok(cam.current.rollDeg < -1.8, `Expected negative rollDeg, got ${cam.current.rollDeg}`);

  for (let i = 0; i < 16; i++) {
    assert.ok(Number.isFinite(cam.viewProjMatrix[i]), `Matrix entry ${i} must be finite`);
  }

  cam.snapToShot('PLAY_STANDARD');
  const nearPt: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  const farPt: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  cam.projectPoint3D(0, 0, 0, 1280, 720, nearPt);
  cam.projectPoint3D(0, 0, -24, 1280, 720, farPt);
  assert.equal(nearPt.visible, true);
  assert.equal(farPt.visible, true);
  assert.ok(farPt.y < nearPt.y, `Expected horizon y (${farPt.y}) < judge line y (${nearPt.y})`);
  assert.ok(Math.abs(nearPt.x - 640) < 2, `Expected center x ~640, got ${nearPt.x}`);

  cam.setStaticGameplayLock(true);
  cam.setShot('PLAY_OVERDRIVE', 10);
  assert.equal(cam.getActiveShot(), 'PLAY_STANDARD');
  cam.setShot('RESULT_WIDE', 10);
  assert.equal(cam.getActiveShot(), 'RESULT_WIDE');
});

test('GameFlowController manages 6-act transitions, Fly-In auto-promotion, skip, and pause/resume', () => {
  const flow = new GameFlowController('title');
  assert.equal(flow.getScene(), 'title');
  assert.equal(flow.getSnapshot().bodyStateAttr, 'title');
  assert.equal(resolveSceneCameraShot('lobby'), 'LOBBY_HERO');

  assert.equal(flow.goTo('lobby', 0.4), true);
  assert.equal(flow.getScene(), 'lobby');
  assert.equal(flow.isTransitioning(), true);
  for (let i = 0; i < 30; i++) flow.step(1 / 60);
  assert.equal(flow.isTransitioning(), false);

  flow.startStageIntro(1.0);
  assert.equal(flow.getScene(), 'intro');
  let event: 'none' | 'intro_complete' = 'none';
  for (let i = 0; i < 65; i++) {
    const ev = flow.step(1 / 60);
    if (ev === 'intro_complete') event = ev;
  }
  assert.equal(event, 'intro_complete');
  assert.equal(flow.getScene(), 'playing');

  assert.equal(flow.pause(), true);
  assert.equal(flow.getSnapshot().bodyStateAttr, 'paused');
  assert.equal(flow.resume(), true);
  assert.equal(flow.getSnapshot().bodyStateAttr, 'playing');

  flow.startStageIntro(1.2);
  assert.equal(flow.skipIntro(), true);
  assert.equal(flow.getScene(), 'playing');
});

test('ExternalAudioBank enforces safe URLs, tracks BGM manifest state, and degrades silently without AI synthesis', () => {
  assert.equal(isSafeAudioUrl('https://cdn.pixer.app/audio/courtyard.opus'), true);
  assert.equal(isSafeAudioUrl('./audio/slash.mp3'), true);
  assert.equal(isSafeAudioUrl('javascript:alert(1)'), false);
  assert.equal(isSafeAudioUrl('data:audio/wav;base64,AAA='), false);
  assert.equal(isSafeAudioUrl('../secret.mp3'), false);
  assert.equal(isSafeAudioUrl('//evil.example/a.mp3'), false);

  const bank = new ExternalAudioBank();
  bank.loadManifest({
    baseUrl: 'https://cdn.pixer.app/audio',
    bgm: { boss: 'boss.opus' },
    sfx: { jump: 'jump.opus' },
  });
  bank.setBgmTheme('boss');
  assert.equal(bank.getBgmDiagnostics().theme, 'boss');
  bank.setBgmMuffled(true);
  assert.equal(bank.getBgmDiagnostics().muffled, true);
  bank.queueEvent('jump', 2, 'left');
  bank.flushQueue();
  bank.playTactile('face', 'down', 'right');
  assert.equal(bank.toggleMute(), true);
  assert.equal(bank.isMuted(), true);
  bank.destroy();
  assert.equal(bank.getBgmDiagnostics().theme, null);
  assert.equal(bank.getBgmDiagnostics().schedulerActive, false);
});

test('MCP frame reader parses multi-byte UTF-8 Content-Length payloads across split chunks accurately', () => {
  const received: string[] = [];
  const feed = createMcpFrameReader((msg) => received.push(msg));

  const msg1 = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { title: '黑曜魔王城：赤月王座 🏰🔥' } });
  const msg2 = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { note: '翠律遺跡' } });
  const buf1 = Buffer.from(msg1, 'utf8');
  const buf2 = Buffer.from(msg2, 'utf8');
  assert.ok(buf1.byteLength > msg1.length, 'Payload must contain multi-byte UTF-8 characters');

  const framed = Buffer.concat([
    Buffer.from(`Content-Length: ${buf1.byteLength}\r\n\r\n`, 'ascii'),
    buf1,
    Buffer.from(`Content-Length: ${buf2.byteLength}\r\n\r\n`, 'ascii'),
    buf2,
  ]);

  // Feed in deliberately misaligned chunks that split inside UTF-8 sequences
  for (let i = 0; i < framed.length; i += 7) {
    feed(framed.subarray(i, Math.min(framed.length, i + 7)));
  }

  // Also test newline-delimited JSON-RPC
  const msg3 = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping', text: '測試' });
  feed(Buffer.from(`${msg3}\n`, 'utf8'));

  assert.equal(received.length, 3);
  assert.equal(received[0], msg1);
  assert.equal(received[1], msg2);
  assert.equal(received[2], msg3);
});

test('Security hardening: Interop ZIP path-traversal, Tiled zlib bomb & custom sprite zlib bomb are rejected cleanly', async () => {
  // 1. ZIP path traversal must be rejected
  const traversalZip = zipSync({
    '../evil.json': new TextEncoder().encode('{}'),
  });
  await assert.rejects(
    () => loadExternalInteropFiles([{ name: 'bad.zip', bytes: traversalZip }]),
    /不安全路徑/,
  );

  // 2. Tiled zlib bomb (> 16 MiB uncompressed) must abort and throw
  const hugeZeros = new Uint8Array(17 * 1024 * 1024);
  const tiledBomb = zlibSync(hugeZeros, { level: 9 });
  assert.throws(
    () =>
      decodeTiledLayerData({
        name: 'bomb',
        type: 'tilelayer',
        encoding: 'base64',
        compression: 'zlib',
        data: uint8ToBase64(tiledBomb),
      }),
    /超過安全上限/,
  );

  // 3. Custom sprite rgba_b64 bomb (> 256x256x4 = 262144 bytes) must abort safely and return blank RGBA
  const spriteBombPayload = zlibSync(new Uint8Array(300 * 1024), { level: 9 });
  const decoded = decodeZlibB64ToRgba(uint8ToBase64(spriteBombPayload), 32 * 32 * 4);
  assert.equal(decoded.length, 32 * 32 * 4);
  assert.equal(decoded.every((b) => b === 0), true);
});

test('Restored Genre Sub-Engines: CardDeckEngine (card_roguelike) & FighterFrameEngine (fighter_arena) run deterministically', () => {
  // 1. Card Roguelike template -> CardDeckEngine
  const cardSession = new StudioSession('card_roguelike');
  const cardRuntime = new DataCartridgeRuntime(cardSession.getDocument());
  const pressA = { ...createEmptyInputState(), action: true };
  for (let i = 0; i < 12; i++) {
    cardRuntime.step(1 / 60, i % 3 === 0 ? pressA : createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  const cardSnap = cardRuntime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok((cardSnap.hudPrimitives?.length ?? 0) > 0, 'CardDeckEngine must project card HUD primitives');

  // 2. Fighter Arena template -> FighterFrameEngine
  const fighterSession = new StudioSession('fighter_arena');
  const fighterRuntime = new DataCartridgeRuntime(fighterSession.getDocument());
  const attackIn = { ...createEmptyInputState(), right: true, action: true };
  for (let i = 0; i < 30; i++) {
    fighterRuntime.step(1 / 60, i % 2 === 0 ? attackIn : createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  const fighterSnap = fighterRuntime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(fighterSnap.entities.length >= 2, 'FighterFrameEngine must project P1 and P2 fighters');
});

test('True ECS Arsenal Wiring: EcsWorldMapController wall-bypassing A* + FOV/LOS & EcsCartridgeRuntime live CameraRigDirector + GameFlowController', () => {
  const proj = structuredClone(OBSIDIAN_CITADEL_PROJECT);
  const room = proj.worldMap!.rooms[0];
  const ts = proj.worldMap!.tileSize;

  // Clear area cols 2..10, rows 4..12 to walkable stone floor, then place a horizontal wall barrier at row 8 across cols 4..8
  for (let r = 4; r <= 12; r++) {
    for (let c = 2; c <= 10; c++) {
      setRoomTile(room, 'ground', c, r, CASTLE_TILE_IDS.STONE_FLOOR);
      setRoomTile(room, 'wall', c, r, 0);
    }
  }
  for (let c = 4; c <= 8; c++) {
    setRoomTile(room, 'wall', c, 8, CASTLE_TILE_IDS.WALL_BRICK);
  }
  proj.entities = [
    {
      id: 'hero',
      name: 'Hero',
      roomId: room.id,
      prefabId: 'castle_hero',
      components: { transform: { x: 6 * ts + 4, y: 10 * ts + 4, w: 24, h: 24 }, tag: 'hero' },
    },
    {
      id: 'sentinel_test',
      name: 'Sentinel',
      roomId: room.id,
      prefabId: 'castle_sentinel',
      components: { transform: { x: 6 * ts + 4, y: 6 * ts + 4, w: 24, h: 24 }, tag: 'sentinel' },
    },
  ];

  const runtime = new EcsCartridgeRuntime(proj);
  const wm = runtime.getWorldMapController();

  // 1. Verify LOS is blocked across the wall barrier at (6, 6) -> (6, 10), while open cells have LOS
  assert.equal(wm.hasRoomLineOfSight(6, 6, 6, 10, runtime.world.globals), false, 'Wall at row 8 must block direct LOS');
  assert.equal(wm.hasRoomLineOfSight(6, 6, 3, 6, runtime.world.globals), true, 'Open horizontal corridor has LOS');

  // 2. Verify Zero-GC A* finds a detour path around the wall barrier (cols 4..8)
  const pathBuf = new Int32Array(128);
  const pathLen = wm.findRoomPathCells(6, 6, 6, 10, runtime.world.globals, pathBuf);
  assert.ok(pathLen > 5, `Expected detour A* path around wall, got length ${pathLen}`);

  // 3. Verify Zero-GC Symmetric Shadowcasting FOV mask on active room
  const fovMask = new Uint8Array(room.cols * room.rows);
  const visCount = wm.computeRoomFovMask(6, 6, 6, runtime.world.globals, fovMask);
  assert.ok(visCount > 10, `Expected visible cells > 10, got ${visCount}`);
  assert.equal(fovMask[10 * room.cols + 6], 0, 'Hero cell behind solid wall must be occluded in FOV');

  // 4. Step runtime for 45 frames with hero stationary: sentinel at (6, 6) must steer horizontally around the wall via A*!
  const sentinelStartCol = 6 * ts + 4;
  for (let i = 0; i < 45; i++) {
    runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  const core = runtime.world.core;
  const tagStore = core.getStore(core.components.Tag);
  let sentinelX = sentinelStartCol;
  for (let i = 0; i < tagStore.size(); i++) {
    if (tagStore.getDenseDataAt(i).entityId === 'sentinel_test') {
      const tr = core.getComponent(tagStore.getDenseEntityAt(i), core.components.Transform2D);
      if (tr) sentinelX = tr.x;
    }
  }
  assert.ok(
    Math.abs(sentinelX - sentinelStartCol) > 12,
    `Enemy behind horizontal wall must steer laterally via A* (start=${sentinelStartCol}, now=${sentinelX})`,
  );

  // 5. Verify live 6DoF CameraRigDirector & GameFlowController integration on EcsCartridgeRuntime
  assert.equal(runtime.gameFlow.getScene(), 'playing');
  assert.equal(runtime.cameraRig.getActiveShot(), 'PLAY_STANDARD');
  assert.ok(Number.isFinite(runtime.cameraRig.viewProjMatrix[0]));

  // Verify GameFlowController.step() returning 'none' does not reset cameraRig every frame
  runtime.cameraRig.setShot('PLAY_OVERDRIVE', 8.0);
  for (let i = 0; i < 15; i++) {
    runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  assert.equal(
    runtime.cameraRig.getActiveShot(),
    'PLAY_OVERDRIVE',
    'cameraRig shot must persist across runtime.step() frames instead of resetting on truthy "none"',
  );

  // Verify 'intro_complete' still promotes cameraRig cleanly back to PLAY_STANDARD
  runtime.gameFlow.startStageIntro(0.25);
  runtime.cameraRig.setShot('STAGE_FLYIN', 10.0);
  for (let i = 0; i < 40; i++) {
    runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  assert.equal(runtime.gameFlow.getScene(), 'playing');
  assert.equal(runtime.cameraRig.getActiveShot(), 'PLAY_STANDARD');
});

test('Phase 5 Cinematic Director & Aesthetic Oracle: Auteur DSL, Toric Two-Shot, 3-Phase Spring Handback & MCP Critique', () => {
  const proj = structuredClone(OBSIDIAN_CITADEL_PROJECT);
  const initialCutsceneCount = proj.cutscenes?.length ?? 0;
  const mcp = new PixerMcpSession(proj);

  // 1. Author a 3-shot throne room PV cutscene via transactional MCP upsert_cutscene
  const upsertRes = mcp.invokeTool('dispatch_ecs_command', {
    command: {
      type: 'upsert_cutscene',
      cutscene: {
        id: 'throne_showdown_pv',
        name: '赤月王座對峙 PV',
        trigger: 'manual',
        roomId: 'throne_sanctum',
        handbackDurationSec: 0.45,
        shots: [
          {
            id: 'shot_1_establishing',
            durationSec: 0.8,
            subject: 'hero',
            shotSize: 'WS',
            anchor: 'center',
            motion: 'spring',
            motivation: 'enter_throne_sanctum',
            splashTitle: 'CRIMSON THRONE',
            splashSubtitle: 'ACT III · FINAL SANCTUM',
          },
          {
            id: 'shot_2_hero_resolve',
            durationSec: 1.0,
            subject: 'hero',
            shotSize: 'CU',
            anchor: 'center',
            motion: 'push_in',
            motivation: 'blade_unsheathed',
            holdBeatSec: 0.25,
            speaker: 'HERO',
            subtitle: 'The crimson seal ends here!',
          },
          {
            id: 'shot_3_toric_standoff',
            durationSec: 1.2,
            subject: 'hero',
            secondarySubject: 'boss',
            shotSize: 'MS',
            anchor: 'two_shot',
            motion: 'spring',
            motivation: 'boss_awakening',
            speaker: 'MALAKOR',
            subtitle: 'Come, mortal!',
          },
        ],
      },
    },
  });
  assert.equal(upsertRes.isError, false, JSON.stringify(upsertRes.structuredContent));

  // 2. Verify MCP tools/list discovery and run the FilmFlow Headless Scout + 5-Axis Mathematical Cinematography Critic Oracle via MCP
  const listRes = mcp.handleRequest({ jsonrpc: '2.0', id: 99, method: 'tools/list' });
  const listedTools = (listRes?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
  assert.ok(
    listedTools.some((t) => t.name === 'critique_cutscene_aesthetics'),
    'tools/list must advertise critique_cutscene_aesthetics for Antigravity/MCP clients',
  );

  const critiqueRes = mcp.invokeTool('critique_cutscene_aesthetics', {
    cutsceneId: 'throne_showdown_pv',
  });
  assert.equal(critiqueRes.isError, false, JSON.stringify(critiqueRes.structuredContent));
  const report = critiqueRes.structuredContent as {
    ok: boolean;
    overallScore: number;
    grade: string;
    pass: boolean;
    handbackContinuityScore: number;
    handbackResidualPx: number;
    shots: Array<{ shotId: string; cameraZoom: number; shotScore: number }>;
    asciiStoryboard: string[];
  };
  assert.equal(report.ok, true);
  assert.equal(report.shots.length, 3);
  assert.equal(report.asciiStoryboard.length, 3);
  assert.ok(report.overallScore >= 80, `Expected overallScore >= 80, got ${report.overallScore}`);
  assert.equal(report.pass, true);
  assert.ok(report.handbackContinuityScore >= 85, `Expected handbackContinuityScore >= 85, got ${report.handbackContinuityScore}`);
  assert.ok(report.asciiStoryboard[0].includes('CRIMSON THRONE'), 'ASCII storyboard includes splash banner');
  assert.ok(report.asciiStoryboard[2].includes('B'), 'Two-shot ASCII viewfinder plots secondary subject B');

  // 3. Verify live runtime execution: 21:9 letterbox HUD bars, dynamic zoom, Tilt-Shift focus pull, and seamless spring return
  const runtime = new EcsCartridgeRuntime(mcp.session.getProject());
  const wm = runtime.getWorldMapController();
  wm.switchRoomForEditor(runtime.world, 'throne_sanctum', 640, 360);
  assert.equal(runtime.playCutscene('throne_showdown_pv'), true);
  assert.equal(runtime.getCinematicDirector().isCutscenePlaying(), true);

  for (let i = 0; i < 35; i++) {
    runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  const midSnap = runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok((midSnap.cameraZoom ?? 1) !== 1, 'Director dynamically drives cameraZoom during cutscene');
  assert.ok(
    midSnap.hudPrimitives?.some((h) => h.kind === 'box' && h.y === 0 && h.w === 640 && h.h > 10),
    '21:9 top letterbox bar rendered in HUD',
  );
  assert.ok(
    midSnap.hudPrimitives?.some((h) => h.kind === 'text' && h.text?.includes('CRIMSON THRONE')),
    'Splash title banner rendered in HUD',
  );

  // Skip cutscene -> enters Phase-3 Spring Handback -> converges smoothly back to idle gameplay camera (Toric Boss Two-Shot in throne_sanctum)
  assert.equal(runtime.getCinematicDirector().skipCutscene(), true);
  assert.equal(runtime.getCinematicDirector().getPhase(), 'handback');
  for (let i = 0; i < 40; i++) {
    runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  assert.equal(runtime.getCinematicDirector().getPhase(), 'idle');
  assert.equal(runtime.getCinematicDirector().letterboxRatio, 0);
  const idleZoom = runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1).cameraZoom ?? 1;
  assert.ok(idleZoom >= 0.82 && idleZoom <= 1.02, `Expected Toric boss-battle framing zoom in 0.82..1.02, got ${idleZoom}`);

  // 4. Undo/Redo transactional verification for upsert_cutscene
  assert.equal(mcp.invokeTool('undo').isError, false);
  assert.equal((mcp.session.getProject().cutscenes ?? []).length, initialCutsceneCount);
  assert.equal(mcp.invokeTool('redo').isError, false);
  assert.equal((mcp.session.getProject().cutscenes ?? []).length, initialCutsceneCount + 1);
});

test('EcsCinematicDirector end-to-end wiring: live lead-room framing, bullet-time timeScale, HD-2D pitch/tiltShift, zoom clampAxis & moving-hero handback', () => {
  const proj = structuredClone(OBSIDIAN_CITADEL_PROJECT);
  const room = proj.worldMap!.rooms[0];
  const ts = proj.worldMap!.tileSize;
  const roomW = room.cols * ts;
  const roomH = room.rows * ts;
  const vpW = proj.viewport.width;
  const vpH = proj.viewport.height;

  // Clear central courtyard floor and isolate hero away from walls/enemies for clean framing checks
  for (let r = 4; r <= 14; r++) {
    for (let c = 4; c <= 22; c++) {
      setRoomTile(room, 'ground', c, r, CASTLE_TILE_IDS.STONE_FLOOR);
      setRoomTile(room, 'wall', c, r, 0);
    }
  }
  proj.entities = [
    {
      id: 'hero',
      name: 'Hero',
      roomId: room.id,
      prefabId: 'castle_hero',
      components: { transform: { x: 12 * ts, y: 9 * ts, w: 24, h: 24 }, tag: 'hero' },
    },
  ];
  proj.cutscenes = [
    {
      id: 'director_wiring_test',
      name: 'Director Wiring Test',
      trigger: 'manual',
      roomId: room.id,
      handbackDurationSec: 0.3,
      shots: [
        {
          id: 'slow_ecu',
          durationSec: 0.6,
          subject: 'hero',
          shotSize: 'ECU',
          anchor: 'upper_third',
          motion: 'cut',
          timeScale: 0.25,
          pitchDegOverride: 28,
          tiltShiftBlurOverride: 0.74,
        },
      ],
    },
    {
      id: 'edge_ecu_test',
      name: 'Edge ECU Test',
      trigger: 'manual',
      roomId: room.id,
      shots: [
        {
          id: 'ecu_corner',
          durationSec: 0.5,
          subject: 'hero',
          shotSize: 'ECU',
          anchor: 'center',
          motion: 'cut',
        },
      ],
    },
    {
      id: 'edge_ews_test',
      name: 'Edge EWS Test',
      trigger: 'manual',
      roomId: room.id,
      shots: [
        {
          id: 'ews_corner',
          durationSec: 0.5,
          subject: 'hero',
          shotSize: 'EWS',
          anchor: 'center',
          motion: 'cut',
        },
      ],
    },
  ];

  const runtime = new EcsCartridgeRuntime(proj);
  const wm = runtime.getWorldMapController();
  const dir = runtime.getCinematicDirector();
  const core = runtime.world.core;

  // 1. Live framing: moving right engages director lead-room look-ahead without EcsWorldMapController clobbering it
  const moveRight = { ...createEmptyInputState(), right: true };
  for (let i = 0; i < 25; i++) {
    runtime.step(1 / 60, moveRight, DEFAULT_RUNTIME_PARAMS);
  }
  const tagStore = core.getStore(core.components.Tag);
  let heroTr: { x: number; y: number; w: number; h: number } | undefined;
  for (let i = 0; i < tagStore.size(); i++) {
    if (tagStore.getDenseDataAt(i).tag === 'hero') {
      heroTr = core.getComponent(tagStore.getDenseEntityAt(i), core.components.Transform2D);
    }
  }
  assert.ok(heroTr, 'Hero Transform2D must exist');
  const rawHeroCamX = heroTr!.x + heroTr!.w * 0.5 - vpW * 0.5;
  const liveSnap = runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(
    liveSnap.cameraX > rawHeroCamX + 8,
    `Director lead-room look-ahead must drive cameraX ahead of raw hero center (${liveSnap.cameraX.toFixed(1)} vs ${rawHeroCamX.toFixed(1)})`,
  );
  assert.ok(Math.abs(liveSnap.cameraX - wm.cameraX) < 0.01);
  assert.ok(Math.abs(liveSnap.cameraX - dir.cameraX) < 0.01);

  // 2. Cutscene timeScale, pitchDeltaDeg, tiltShiftBlur & zoom-aware tiltShiftFocusY propagation
  const elapsedBefore = liveSnap.elapsedSec;
  assert.equal(runtime.playCutscene('director_wiring_test'), true);
  for (let i = 0; i < 15; i++) {
    runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  const cutSnap = runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  const elapsedDelta = cutSnap.elapsedSec - elapsedBefore;
  assert.ok(
    elapsedDelta > 0.03 && elapsedDelta < 0.12,
    `Bullet-time timeScale=0.25 must scale simDt (0.25s real -> expected ~0.0625s sim, got ${elapsedDelta.toFixed(4)}s)`,
  );
  assert.ok(cutSnap.hd2dDepth, 'hd2dDepth must exist');
  assert.ok(
    Math.abs(cutSnap.hd2dDepth!.pitchDeg! - 28) < 0.5,
    `Cutscene pitchDeltaDeg must propagate to hd2dDepth.pitchDeg (got ${cutSnap.hd2dDepth!.pitchDeg})`,
  );
  assert.ok(
    Math.abs(cutSnap.hd2dDepth!.tiltShiftBlur! - 0.74) < 0.01,
    `Cutscene tiltShiftBlur must propagate to hd2dDepth (got ${cutSnap.hd2dDepth!.tiltShiftBlur})`,
  );
  assert.ok(
    (cutSnap.hd2dDepth!.tiltShiftFocusY ?? 0.52) < 0.45,
    `Zoom-aware upper_third tiltShiftFocusY must shift upward (<0.45, got ${cutSnap.hd2dDepth!.tiltShiftFocusY})`,
  );
  assert.ok((cutSnap.cameraZoom ?? 1) > 1.5, 'ECU shot zoom must propagate to snapshot');

  // 3. Handback smoothstep (no multiplicative collapse) & safe completion even while hero sprints
  for (let i = 0; i < 23; i++) {
    runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  }
  assert.equal(dir.getPhase(), 'handback', 'Shot should transition cleanly into handback');
  runtime.step(1 / 60, moveRight, DEFAULT_RUNTIME_PARAMS);
  assert.ok(
    Math.abs(dir.pitchDeltaDeg) > 10,
    `Handback must interpolate monotonically without multiplicative collapse on early frames (got ${dir.pitchDeltaDeg})`,
  );
  for (let i = 0; i < 45; i++) {
    runtime.step(1 / 60, moveRight, DEFAULT_RUNTIME_PARAMS);
  }
  assert.equal(dir.getPhase(), 'idle', 'Moving hero must not remain trapped in handback');
  assert.equal(dir.timeScale, 1.0);
  const afterHandbackSnap = runtime.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(afterHandbackSnap.hd2dDepth!.pitchDeg, proj.projection!.pitchDeg);
  assert.equal(afterHandbackSnap.hd2dDepth!.tiltShiftBlur, proj.atmosphere.tiltShiftBlur);

  // 4. Zoom-aware clampAxis: ECU near corner keeps subject in frame; EWS near corner keeps viewport inside [0, roomSpan]
  heroTr!.x = 40;
  heroTr!.y = 40;
  assert.equal(runtime.playCutscene('edge_ecu_test'), true);
  runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const ecuCenterX = dir.cameraX + vpW * 0.5;
  const ecuCenterY = dir.cameraY + vpH * 0.5;
  const ecuEffW = vpW / dir.cameraZoom;
  const ecuEffH = vpH / dir.cameraZoom;
  const heroU = 0.5 + (heroTr!.x + heroTr!.w * 0.5 - ecuCenterX) / ecuEffW;
  const heroV = 0.5 + (heroTr!.y + heroTr!.h * 0.5 - ecuCenterY) / ecuEffH;
  assert.ok(
    heroU >= 0.05 && heroU <= 0.95 && heroV >= 0.05 && heroV <= 0.95,
    `ECU near corner must not crop subject (u=${heroU.toFixed(3)}, v=${heroV.toFixed(3)})`,
  );

  dir.reset(true);
  assert.equal(runtime.playCutscene('edge_ews_test'), true);
  runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  runtime.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const ewsCenterX = dir.cameraX + vpW * 0.5;
  const ewsCenterY = dir.cameraY + vpH * 0.5;
  const ewsEffW = vpW / dir.cameraZoom;
  const ewsEffH = vpH / dir.cameraZoom;
  assert.ok(
    ewsCenterX - ewsEffW * 0.5 >= -0.5 &&
      ewsCenterX + ewsEffW * 0.5 <= roomW + 0.5 &&
      ewsCenterY - ewsEffH * 0.5 >= -0.5 &&
      ewsCenterY + ewsEffH * 0.5 <= roomH + 0.5,
    `EWS must clamp inside room bounds [0..${roomW}, 0..${roomH}] without exposing void`,
  );
});

test('PA-14 & PA-15 Flagship Cutscenes pass schema + Aesthetic Oracle (>=80, 0 occlusion) & Oracle catches multi-frame / 3D actorB occlusion', () => {
  // 1. Validate & audit all 4 flagship cutscenes across PA-14 & PA-15
  const checks: Array<{ proj: typeof OBSIDIAN_CITADEL_PROJECT; ids: readonly string[]; bossRoom: string; bossCutscene: string }> = [
    {
      proj: OBSIDIAN_CITADEL_PROJECT,
      ids: ['citadel_gate_intro', 'malakor_awakening'],
      bossRoom: 'throne_sanctum',
      bossCutscene: 'malakor_awakening',
    },
    {
      proj: EMERALD_RUINS_PROJECT,
      ids: ['grove_arrival', 'warden_awakening'],
      bossRoom: 'sanctum_altar',
      bossCutscene: 'warden_awakening',
    },
  ];

  for (const entry of checks) {
    for (const id of entry.ids) {
      const def = entry.proj.cutscenes?.find((c) => c.id === id);
      assert.ok(def, `Missing cutscene '${id}' in ${entry.proj.meta.id}`);
      const schemaErrs = validateCutsceneDef(def);
      assert.deepEqual(schemaErrs, [], `Schema errors for '${id}': ${schemaErrs.join('; ')}`);

      const report = critiqueCutsceneAesthetics(entry.proj, id);
      assert.equal(report.ok, true);
      assert.equal(report.pass, true, `Cutscene '${id}' failed aesthetic oracle: ${report.suggestions.join('; ')}`);
      assert.ok(report.overallScore >= 80, `Expected '${id}' overallScore >= 80, got ${report.overallScore}`);
      for (const shot of report.shots) {
        assert.equal(shot.occlusionScore, 100, `Shot '${shot.shotId}' in '${id}' must have 0 wall occlusion`);
      }
    }

    // Verify start room keeps input unblocked on boot while boss room triggers on_room_enter automatically
    const rt = new EcsCartridgeRuntime(entry.proj);
    assert.equal(rt.getCinematicDirector().isCutscenePlaying(), false);
    assert.equal(rt.switchRoomForEditor(entry.bossRoom), true);
    assert.equal(rt.getCinematicDirector().isCutscenePlaying(), true);
    assert.equal(rt.getCinematicDirector().getActiveCutsceneId(), entry.bossCutscene);
  }

  // 2. Negative test: 3-point multi-frame sampling catches wall occlusion occurring at 85% while clear at 55% mid-shot
  const multiFrameProj = structuredClone(OBSIDIAN_CITADEL_PROJECT);
  const mfRoom = multiFrameProj.worldMap!.rooms[0];
  const ts = multiFrameProj.worldMap!.tileSize;
  for (let r = 4; r <= 12; r++) {
    for (let c = 3; c <= 14; c++) {
      setRoomTile(mfRoom, 'ground', c, r, CASTLE_TILE_IDS.STONE_FLOOR);
      setRoomTile(mfRoom, 'wall', c, r, 0);
    }
  }
  // Single extruded south wall at col 8, row 9 (x=256..288, y=288)
  setRoomTile(mfRoom, 'wall', 8, 9, CASTLE_TILE_IDS.WALL_GOTHIC);
  multiFrameProj.entities = [
    {
      id: 'hero',
      name: 'Hero',
      roomId: mfRoom.id,
      prefabId: 'castle_hero',
      components: { transform: { x: 8 * ts, y: 5 * ts, w: 24, h: 24 }, tag: 'hero' },
    },
    {
      id: 'moving_scout',
      name: 'Moving Scout',
      roomId: mfRoom.id,
      components: {
        // Starts at cx=144, moves +160px/s -> at 55% (0.55s) cx=232 (clear of x>=250), at 85% (0.85s) cx=280 (occluded behind wall at col 8, row 9!)
        transform: { x: 132, y: 256, w: 24, h: 24 },
        body2d: { vx: 160, vy: 0, gravityScale: 0, drag: 0 },
        sprite: { sprite: 'castle_sentinel' },
        tag: 'scout',
      },
    },
  ];
  multiFrameProj.cutscenes = [
    {
      id: 'late_occlusion_test',
      name: 'Late Occlusion Shot',
      trigger: 'manual',
      roomId: mfRoom.id,
      shots: [
        {
          id: 'track_scout',
          durationSec: 1.0,
          subject: 'moving_scout',
          shotSize: 'MS',
          anchor: 'center',
          motion: 'spring',
          motivation: 'track_moving_scout',
        },
      ],
    },
  ];
  const mfReport = critiqueCutsceneAesthetics(multiFrameProj, 'late_occlusion_test');
  assert.equal(mfReport.pass, false, 'Multi-frame oracle must fail when 85% sample is occluded behind extruded wall');
  assert.ok(mfReport.shots[0].occlusionScore < 65, `Expected occlusionScore < 65, got ${mfReport.shots[0].occlusionScore}`);
  assert.ok(
    mfReport.shots[0].issues.some((iss) => iss.includes('occluded by extruded south wall')),
    `Expected south-wall occlusion issue, got: ${mfReport.shots[0].issues.join('; ')}`,
  );

  // 3. Negative test: hd2d_3d pitchDeg/wallHeightScale reach catches secondary subject actorB occlusion in two_shot
  const actorBProj = structuredClone(multiFrameProj);
  actorBProj.projection = { ...actorBProj.projection!, mode: 'hd2d_3d', pitchDeg: 30, wallHeightScale: 1.5 };
  // Place actorB 42px north of wall row 9 (y=288): reach = 28 * 1.5 / tan(30°) ≈ 72.7px (> 42px in 3D, > 28px in 2D)
  actorBProj.entities = [
    {
      id: 'hero',
      name: 'Hero',
      roomId: mfRoom.id,
      prefabId: 'castle_hero',
      components: { transform: { x: 4 * ts, y: 7 * ts, w: 24, h: 24 }, tag: 'hero' },
    },
    {
      id: 'ally_b',
      name: 'Ally B',
      roomId: mfRoom.id,
      components: {
        transform: { x: 8 * ts, y: 288 - 42 - 12, w: 24, h: 24 },
        sprite: { sprite: 'castle_sentinel' },
        tag: 'ally',
      },
    },
  ];
  actorBProj.cutscenes = [
    {
      id: 'actor_b_3d_occlusion',
      name: 'Actor B 3D Occlusion',
      trigger: 'manual',
      roomId: mfRoom.id,
      shots: [
        {
          id: 'two_shot_3d_check',
          durationSec: 0.8,
          subject: 'hero',
          secondarySubject: 'ally_b',
          shotSize: 'MS',
          anchor: 'two_shot',
          motion: 'spring',
          motivation: 'confrontation',
        },
      ],
    },
  ];
  const actorBReport = critiqueCutsceneAesthetics(actorBProj, 'actor_b_3d_occlusion');
  assert.equal(actorBReport.pass, false, 'Oracle must fail when secondary actorB is occluded under hd2d_3d projected wall reach');
  assert.ok(actorBReport.shots[0].occlusionScore < 65);
  assert.ok(
    actorBReport.shots[0].issues.some((iss) => iss.includes('Secondary subject is partially occluded')),
    `Expected Secondary subject occlusion issue, got: ${actorBReport.shots[0].issues.join('; ')}`,
  );
});



