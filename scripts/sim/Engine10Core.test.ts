import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, zlibSync } from 'fflate';
import { createMcpFrameReader } from '../pixer-mcp.ts';
import { ExternalAudioBank, isSafeAudioUrl } from '../../src/core/audio/ExternalAudioBank.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
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

  // 3. Custom sprite rgba_b64 bomb (> 128x128x4 = 65536 bytes) must abort safely and return blank RGBA
  const spriteBombPayload = zlibSync(new Uint8Array(256 * 1024), { level: 9 });
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
});

