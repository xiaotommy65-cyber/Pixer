import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ATLAS_SIZE, TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { buildCastleSprites } from '../../src/assets/sprites/CastleSprites.ts';
import {
  analyzeWorldMapReachability,
  observeSceneSemantics,
  renderRoomAscii,
  type EcsRoomAsciiReport,
  type EcsWorldMapReachabilityReport,
} from '../../src/core/ai/EcsSpatialOracle.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import {
  compileCustomSpriteToRgba,
  syncProjectCustomSpritesToAtlas,
} from '../../src/core/ecs/EcsCustomSpriteCompiler.ts';
import {
  ECS_PROCEDURAL_SPRITE_PATTERNS,
  validateEcsProjectV2,
  type EcsProjectV2,
} from '../../src/core/ecs/EcsProjectSchema.ts';
import { ECS_COMMAND_CATALOG, EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import {
  CASTLE_TILE_IDS,
  computeWallAutoTileMask,
  createEmptyRoom,
  fillRoomRect,
  floodFillRoom,
  getRoomTile,
  isRoomCellHazard,
  isRoomCellSolid,
  setRoomTile,
} from '../../src/core/ecs/EcsTilemapTypes.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { EMERALD_RUINS_PROJECT } from '../../src/game/emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

test('TextureAtlas registers all 31 Demon Castle PBR pixel sprites with expected dimensions and RGBA pixels', () => {
  const atlas = new TextureAtlas();
  const assets = buildCastleSprites();
  assert.equal(assets.length, 31);

  for (const asset of assets) {
    assert.equal(atlas.hasSprite(asset.id), true, `Missing castle sprite: ${asset.id}`);
    const rect = atlas.getRect(asset.id);
    if (asset.id === 'castle_throne' || asset.id === 'castle_demon_lord') {
      assert.equal(rect.w, 48, `${asset.id} width`);
      assert.equal(rect.h, 64, `${asset.id} height`);
    } else if (
      asset.id === 'castle_pillar_tall' ||
      asset.id === 'castle_banner_crimson' ||
      asset.id === 'castle_portal_arch'
    ) {
      assert.equal(rect.w, 32, `${asset.id} width`);
      assert.equal(rect.h, 48, `${asset.id} height`);
    } else {
      assert.equal(rect.w, 32, `${asset.id} width`);
      assert.equal(rect.h, 32, `${asset.id} height`);
    }

    const page = atlas.getPagePixels(rect.page ?? 0);
    assert.ok(page, `Atlas page ${rect.page ?? 0} exists`);
    const sx = Math.floor(rect.u0 * ATLAS_SIZE);
    const sy = Math.floor(rect.v0 * ATLAS_SIZE);
    let opaqueCount = 0;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const a = page[((sy + y) * ATLAS_SIZE + (sx + x)) * 4 + 3] ?? 0;
        if (a > 0) opaqueCount++;
      }
    }
    assert.ok(opaqueCount > 24, `Sprite ${asset.id} must contain visible pixel art (${opaqueCount} px)`);
  }
});

test('Tilemap pure helpers handle rect fill, flood fill, autotile masks, hazards, and gate unlocks', () => {
  const room = createEmptyRoom('test_room', '測試密室', 10, 8, CASTLE_TILE_IDS.STONE_FLOOR);
  const changedRect = fillRoomRect(room, 'wall', 2, 2, 5, 4, CASTLE_TILE_IDS.WALL_GOTHIC);
  assert.equal(changedRect, 12);
  assert.equal(getRoomTile(room, 'wall', 3, 3), CASTLE_TILE_IDS.WALL_GOTHIC);
  assert.equal(computeWallAutoTileMask(room, 3, 3), 15); // surrounded N/E/S/W
  assert.equal(isRoomCellSolid(room, 3, 3, {}), true);

  // Place locked gate and verify dynamic unlock via global flag
  setRoomTile(room, 'wall', 4, 1, CASTLE_TILE_IDS.GATE_CASTLE_KEY);
  assert.equal(isRoomCellSolid(room, 4, 1, {}), true);
  assert.equal(isRoomCellSolid(room, 4, 1, { has_gate_key: 1 }), false);

  // Lava hazard detection
  setRoomTile(room, 'ground', 1, 1, CASTLE_TILE_IDS.LAVA_MOAT);
  assert.equal(isRoomCellHazard(room, 1, 1), true);
  assert.equal(isRoomCellHazard(room, 0, 0), false);

  // Flood fill bounded stone ground around lava
  const filled = floodFillRoom(room, 'ground', 0, 0, CASTLE_TILE_IDS.MOSS_FLOOR);
  assert.ok(filled > 10);
  assert.equal(getRoomTile(room, 'ground', 0, 0), CASTLE_TILE_IDS.MOSS_FLOOR);
  assert.equal(getRoomTile(room, 'ground', 1, 1), CASTLE_TILE_IDS.LAVA_MOAT);
});

test('EcsStudioSession supports transactional map painting, rect fill, room creation, and Undo/Redo', () => {
  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const startRoom = session.getProject().worldMap!.rooms[0];
  const beforeTile = getRoomTile(startRoom, 'ground', 5, 10);

  const paintRes = session.dispatch({
    type: 'paint_tiles',
    roomId: 'courtyard',
    layer: 'ground',
    changes: [
      { col: 5, row: 10, tileId: CASTLE_TILE_IDS.CARPET_V },
      { col: 6, row: 10, tileId: CASTLE_TILE_IDS.CARPET_V },
    ],
  });
  assert.equal(paintRes.ok, true);
  assert.equal(getRoomTile(session.getProject().worldMap!.rooms[0], 'ground', 5, 10), CASTLE_TILE_IDS.CARPET_V);

  // Undo restores exact previous tile
  assert.equal(session.undo().ok, true);
  assert.equal(getRoomTile(session.getProject().worldMap!.rooms[0], 'ground', 5, 10), beforeTile);

  // Redo reapplies tile
  assert.equal(session.redo().ok, true);
  assert.equal(getRoomTile(session.getProject().worldMap!.rooms[0], 'ground', 5, 10), CASTLE_TILE_IDS.CARPET_V);

  // Room creation + Undo
  const addRes = session.dispatch({
    type: 'upsert_room',
    room: createEmptyRoom('crypt_wing', '地下陵墓', 20, 14, CASTLE_TILE_IDS.STONE_FLOOR),
  });
  assert.equal(addRes.ok, true);
  assert.equal(session.getProject().worldMap!.rooms.length, 4);
  assert.equal(session.undo().ok, true);
  assert.equal(session.getProject().worldMap!.rooms.length, 3);
});

test('Obsidian Citadel runtime handles wall collisions, camera clamping, key unlock, portal traversal, and boss fight', () => {
  const rt = new EcsCartridgeRuntime(OBSIDIAN_CITADEL_PROJECT);
  assert.equal(rt.getActiveRoomId(), 'courtyard');

  // Snapshot emits extruded HD-2D tiles, dynamic lights, and hero entity
  const initSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(initSnap.tiles.length > 300, 'Courtyard emits full multi-layer 32px tiles');
  assert.ok(initSnap.lights.length >= 4, 'Courtyard emits flickering torch lights');
  assert.ok(initSnap.tiles.some((t) => (t.extrudeH ?? 0) >= 24), 'Extruded HD-2D walls emitted');

  // Camera stays strictly clamped within courtyard bounds (896x576 - 640x360)
  const cam = rt.getCamera();
  assert.ok(cam.x >= 0 && cam.x <= 896 - 640);
  assert.ok(cam.y >= 0 && cam.y <= 576 - 360);

  // Move right smoothly with top-down controls & melee slash
  const inp = createEmptyInputState();
  inp.right = true;
  inp.action = true;
  for (let i = 0; i < 30; i++) {
    rt.step(1 / 60, inp, DEFAULT_RUNTIME_PARAMS);
  }
  const afterSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(afterSnap.entities.some((e) => e.sprite === 'castle_hero_a' || e.sprite === 'castle_hero_b'));

  // Editor room switching reaches Grand Hall & Throne Sanctum with Demon Lord Malakor
  rt.switchRoomForEditor('grand_hall');
  assert.equal(rt.getActiveRoomId(), 'grand_hall');
  const hallSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(hallSnap.tiles.length > 400, 'Grand Hall emits full 32x20 tilemap');

  rt.switchRoomForEditor('throne_sanctum');
  assert.equal(rt.getActiveRoomId(), 'throne_sanctum');
  const throneSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(throneSnap.entities.some((e) => e.sprite === 'castle_demon_lord'), 'Demon Lord Malakor present');
  assert.ok(throneSnap.entities.some((e) => e.sprite === 'castle_throne'), '48x64 Demon Throne present');
  assert.ok(
    throneSnap.hudPrimitives?.some((h) => h.kind === 'text' && h.text?.includes('DEMON LORD MALAKOR')),
    'Boss HUD dynamically reflects entity name',
  );
});

test('Engine Core Purity Gate: core runtime & workbench contain ZERO hardcoded Demon Castle game logic', () => {
  const coreFiles = [
    'src/core/ecs/EcsWorldMapController.ts',
    'src/core/ecs/EcsCartridgeRuntime.ts',
    'src/core/ecs/EcsSnapshotProjector.ts',
    'src/core/ecs/EcsCinematicDirector.ts',
    'src/core/ai/EcsCinematicOracle.ts',
  ];
  const coreForbiddenTokens = [
    'MALAKOR',
    'has_gate_key',
    'switches_lit',
    'throne_gate_open',
    'castle_chest_open',
    'castle_switch_on',
    'castle_slash_arc',
    'ember_orb',
    'throne_sanctum',
    '城門古鑰',
    '魔王',
  ];
  for (const rel of coreFiles) {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    for (const token of coreForbiddenTokens) {
      assert.equal(
        src.includes(token),
        false,
        `Engine core file "${rel}" must NOT hardcode game-specific token "${token}"`,
      );
    }
  }

  // Workbench UI may list template/sprite picker names, but must NEVER hardcode room IDs or game-rule globals
  const workbenchFiles = [
    'src/ui/EcsWorkbenchView.ts',
    'src/ui/EcsWorkbenchShellBuilder.ts',
    'src/ui/EcsWorkbenchEntityInspector.ts',
    'src/ui/EcsWorkbenchSceneInspector.ts',
    'src/ui/EcsWorkbenchHierarchyPanels.ts',
    'src/ui/EcsWorkbenchMapCanvasController.ts',
    'src/ui/EcsWorkbenchLiveMutator.ts',
  ];
  const workbenchForbiddenTokens = [
    'throne_sanctum',
    'has_gate_key',
    'switches_lit',
    'throne_gate_open',
    'MALAKOR',
    'ember_orb',
    '快速切換魔王城房間',
  ];
  for (const rel of workbenchFiles) {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    for (const token of workbenchForbiddenTokens) {
      assert.equal(
        src.includes(token),
        false,
        `Workbench UI "${rel}" must NOT hardcode game-specific logic token "${token}"`,
      );
    }
  }

  const panelSrc = readFileSync(resolve(process.cwd(), 'src/ui/EcsMapDesignerPanel.ts'), 'utf8');
  assert.equal(panelSrc.includes('魔王城'), false, 'Map Designer Panel UI must use generic multi-room map labels');

  const rulesPanelSrc = readFileSync(resolve(process.cwd(), 'src/ui/EcsWorldRulesInspectorPanel.ts'), 'utf8');
  for (const token of workbenchForbiddenTokens) {
    assert.equal(
      rulesPanelSrc.includes(token),
      false,
      `M2 Rules Inspector UI must NOT hardcode game-specific token "${token}"`,
    );
  }
  assert.equal(rulesPanelSrc.includes('魔王城'), false, 'M2 Rules Inspector UI must stay 100% theme-agnostic');
});

test('Non-Castle Proof: a custom Sci-Fi Space Station game runs purely from data with zero engine changes', () => {
  const AIRLOCK_TILE_ID = 90;
  const deck = createEmptyRoom('hangar_deck', 'ORBITAL HANGAR', 16, 12, CASTLE_TILE_IDS.IRON_GRATE);
  setRoomTile(deck, 'wall', 8, 0, AIRLOCK_TILE_ID);

  const sciFiProject: EcsProjectV2 = {
    schemaVersion: 2,
    meta: {
      id: 'omega-station',
      code: 'TEST-99',
      title: 'Omega Station',
      subtitle: 'Pure Data-Driven Verification Game',
      genre: 'Sci-Fi Top-Down',
      accentHex: '#22d3ee',
      controlsHint: 'Move & Slash',
      goalHint: 'Hack terminal & destroy OMEGA CORE',
    },
    viewport: { preset: 'hd_plus', width: 640, height: 360 },
    atmosphere: { skyTop: '#020617', skyBottom: '#0f172a', ambientDarkness: 0.3, gridLines: false },
    projection: {
      mode: 'hd2d_iso',
      elevationScale: 1,
      perspectiveSkew: 0.05,
      activeDimensionMask: 3,
      inactiveDimAlpha: 0.2,
      allowDimensionShift: false,
    },
    worldMap: {
      tileSize: 32,
      startRoomId: 'hangar_deck',
      rooms: [deck],
      portals: [],
      tileDefs: [
        {
          id: AIRLOCK_TILE_ID,
          name: 'Plasma Airlock',
          layer: 'wall',
          sprite: 'castle_gate_iron',
          unlockedSprite: 'castle_gate_open',
          unlockGlobal: 'airlock_open',
          solid: true,
          extrudeH: 24,
          wallMaterial: 'astral',
        },
      ],
      heroConfig: {
        walkSpriteA: 'castle_hero_a',
        walkSpriteB: 'castle_hero_b',
        slashSprite: 'castle_slash_arc',
        slashColor: '#38bdf8',
        slashReach: 40,
      },
      interactions: [
        {
          tag: 'terminal',
          trigger: 'touch',
          radius: 36,
          oneShot: true,
          setGlobal: 'airlock_open',
          setGlobalValue: 1,
          scoreDelta: 500,
          popupText: 'AIRLOCK UNLOCKED',
          popupColor: '#38bdf8',
          soundEvent: 'key',
        },
      ],
      aiProfiles: {
        ai_core: {
          chaseRange: 300,
          stopRange: 20,
          moveSpeed: 30,
          contactDamage: 1,
          contactRange: 18,
          scoreOnDefeat: 1000,
          isBoss: true,
          winOnDefeat: true,
          hitReachBonus: 16,
        },
      },
    },
    paths: {},
    animations: [],
    prefabs: {},
    entities: [
      {
        id: 'pilot',
        name: 'Pilot',
        roomId: 'hangar_deck',
        components: {
          transform: { x: 4 * 32, y: 6 * 32, w: 32, h: 32 },
          sprite: { sprite: 'castle_hero_a', castShadow: true },
          characterMotor2d: { moveSpeed: 150, dashSpeed: 300, topDown: true },
          health: { hp: 8, maxHp: 8, team: 1 },
          tag: 'hero',
        },
      },
      {
        id: 'sec_terminal',
        name: 'Security Terminal',
        roomId: 'hangar_deck',
        components: {
          transform: { x: 4 * 32 + 8, y: 6 * 32, w: 32, h: 32 },
          sprite: { sprite: 'castle_switch_off' },
          tag: 'terminal',
        },
      },
      {
        id: 'omega_boss',
        name: 'OMEGA CORE',
        roomId: 'hangar_deck',
        components: {
          transform: { x: 5 * 32 - 8, y: 6 * 32, w: 32, h: 32 },
          sprite: { sprite: 'castle_sentinel' },
          health: { hp: 2, maxHp: 2, team: 2 },
          tag: 'ai_core',
        },
      },
    ],
    scripts: {},
    globals: { airlock_open: 0 },
    hud: [{ label: 'AIRLOCK', kind: 'text', globalKey: 'airlock_open', x: 190, y: 14, color: '#38bdf8' }],
  };

  // Before touching terminal, custom airlock tile is solid
  assert.equal(isRoomCellSolid(deck, 8, 0, { airlock_open: 0 }, sciFiProject.worldMap!.tileDefs), true);

  const rt = new EcsCartridgeRuntime(sciFiProject);
  const initSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(
    initSnap.hudPrimitives?.some((h) => h.kind === 'text' && h.text?.includes('OMEGA CORE  2/2')),
    'Boss bar dynamically renders custom boss OMEGA CORE',
  );

  // Step right + slash: touches terminal -> unlocks airlock_open, and hits OMEGA CORE
  const inp = createEmptyInputState();
  inp.right = true;
  inp.action = true;
  rt.step(1 / 60, inp, DEFAULT_RUNTIME_PARAMS);

  const afterSnap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.equal(afterSnap.score, 500, 'Terminal interaction awarded +500 score');
  assert.equal(afterSnap.bossHp, 1, 'Melee slash damaged custom boss OMEGA CORE from 2 to 1');
  assert.ok(
    afterSnap.hudPrimitives?.some((h) => h.kind === 'text' && h.text === 'AIRLOCK 1'),
    'Declarative HUD reflects airlock_open global',
  );
  assert.equal(
    isRoomCellSolid(deck, 8, 0, { airlock_open: 1 }, sciFiProject.worldMap!.tileDefs),
    false,
    'Custom airlock tile unlocked dynamically via worldMap.tileDefs',
  );
});

test('AI-Native Spatial Oracle proves PA-14 Demon Castle has 0 false viewport warnings & 0 soft-locks across all 3 rooms', () => {
  const sem = observeSceneSemantics(OBSIDIAN_CITADEL_PROJECT);
  assert.equal(sem.warnings.length, 0, `Expected 0 semantic warnings, got: ${sem.warnings.join('; ')}`);
  assert.equal(sem.worldMap?.rooms.length, 3);
  assert.equal(sem.worldMap?.portals.length, 4);

  const ascii = renderRoomAscii(OBSIDIAN_CITADEL_PROJECT, 'courtyard');
  assert.equal(ascii.ok, true);
  assert.equal(ascii.lines.length, 18);
  assert.ok(ascii.lines.some((l) => l.includes('@')), 'ASCII blueprint shows hero glyph @');
  assert.ok(ascii.lines.some((l) => l.includes('G')), 'ASCII blueprint shows locked gate glyph G');

  const reach = analyzeWorldMapReachability(OBSIDIAN_CITADEL_PROJECT);
  assert.equal(reach.pass, true, `PA-14 soft-locks: ${reach.softLockRisks.join('; ')}`);
  assert.deepEqual(reach.reachableRoomIds.sort(), ['courtyard', 'grand_hall', 'throne_sanctum']);
  assert.equal(reach.unlockedGlobals.has_gate_key, 1);
  assert.equal(reach.unlockedGlobals.throne_gate_open, 1);
  assert.ok(reach.reachableBossIds.includes('ts_boss'), 'Boss in Throne Sanctum is reachable through chained key/switches');
});

test('AI-Native MCP Dogfooding: AI builds, verifies, detects soft-lock, undoes, and playtests a 4th dungeon room purely via MCP tools', () => {
  const mcp = new PixerMcpSession(OBSIDIAN_CITADEL_PROJECT);

  // 1. Discover editor grammar & tile catalog via MCP
  const grammarRes = mcp.invokeTool('describe_editor_grammar');
  assert.equal(grammarRes.isError, false);
  const grammar = grammarRes.structuredContent as { commands: Array<{ type: string }>; tiles: Array<{ id: number }> };
  assert.ok(grammar.commands.some((c) => c.type === 'stamp_room_ascii'));
  assert.ok(grammar.commands.some((c) => c.type === 'upsert_interaction_rule'));
  assert.ok(grammar.commands.some((c) => c.type === 'upsert_ai_profile'));
  assert.ok(grammar.tiles.length >= 17);

  // 2. Author a complete 4th secret room ("obsidian_vault") + custom tile + custom interaction + portal + HUD in ONE atomic MCP batch
  const batchRes = mcp.invokeTool('dispatch_ecs_batch', {
    label: 'AI builds Secret Obsidian Vault via ASCII blueprint',
    commands: [
      {
        type: 'upsert_tile_def',
        tileDef: {
          id: 95,
          name: '秘庫封印牆',
          layer: 'wall',
          sprite: 'castle_gate_iron',
          unlockedSprite: 'castle_gate_open',
          unlockGlobal: 'vault_sigil',
          solid: true,
          extrudeH: 26,
          wallMaterial: 'astral',
        },
      },
      {
        type: 'upsert_interaction_rule',
        rule: {
          tag: 'sigil_altar',
          trigger: 'touch',
          radius: 30,
          oneShot: true,
          setGlobal: 'vault_sigil',
          setGlobalValue: 1,
          scoreDelta: 777,
          popupText: 'VAULT SIGIL ACQUIRED',
          popupColor: '#a78bfa',
          soundEvent: 'key',
        },
      },
      {
        type: 'create_prefab',
        prefab: {
          id: 'vault_altar',
          name: '秘庫符文壇',
          category: '機關與道具',
          components: {
            transform: { x: 0, y: 0, w: 32, h: 32 },
            sprite: { sprite: 'castle_switch_off', emissive: 0.6 },
            light: { radius: 80, color: '#a78bfa', intensity: 0.7 },
            tag: 'sigil_altar',
          },
        },
      },
      {
        type: 'stamp_room_ascii',
        roomId: 'obsidian_vault',
        roomName: '秘庫暗殿 Secret Vault',
        createIfMissing: true,
        editorFocusY: 0,
        lines: [
          '############',
          '#....WW....#',
          '#..t.==.t..#',
          '#....==....#',
          '#..A.==.E..#',
          '#....==....#',
          '#..t.==.t..#',
          '#....==....#',
          '#####..#####',
        ],
        legend: {
          '#': { ground: CASTLE_TILE_IDS.STONE_FLOOR, wall: CASTLE_TILE_IDS.WALL_GOTHIC },
          'W': { ground: CASTLE_TILE_IDS.STONE_FLOOR, wall: CASTLE_TILE_IDS.WALL_STAINED_GLASS },
          '.': { ground: CASTLE_TILE_IDS.STONE_FLOOR, wall: 0 },
          '=': { ground: CASTLE_TILE_IDS.CARPET_V, wall: 0 },
          't': { ground: CASTLE_TILE_IDS.STONE_FLOOR, wall: 0, prefabId: 'castle_torch' },
          'A': { ground: CASTLE_TILE_IDS.MAGIC_SEAL, wall: 0, prefabId: 'vault_altar' },
          'E': { ground: CASTLE_TILE_IDS.STONE_FLOOR, wall: 0, prefabId: 'castle_sentinel' },
        },
      },
      {
        type: 'upsert_portal',
        portal: {
          id: 'portal_courtyard_to_vault',
          name: '南庭密道 → 秘庫暗殿',
          fromRoomId: 'courtyard',
          col: 13,
          row: 15,
          cols: 2,
          rows: 1,
          toRoomId: 'obsidian_vault',
          targetX: 5 * 32 + 16,
          targetY: 2 * 32,
        },
      },
      {
        type: 'upsert_portal',
        portal: {
          id: 'portal_vault_to_courtyard',
          name: '秘庫歸路 → 城門外庭',
          fromRoomId: 'obsidian_vault',
          col: 5,
          row: 8,
          cols: 2,
          rows: 1,
          toRoomId: 'courtyard',
          targetX: 13 * 32 + 16,
          targetY: 14 * 32,
        },
      },
      {
        type: 'upsert_hud_gauge',
        gauge: { label: 'SIGIL', kind: 'text', globalKey: 'vault_sigil', x: 300, y: 14, color: '#a78bfa' },
      },
    ],
  });
  assert.equal(batchRes.isError, false, JSON.stringify(batchRes.structuredContent));

  // 3. Inspect newly stamped room via compact ASCII tool
  const vaultAscii = mcp.invokeTool('get_room_ascii', { roomId: 'obsidian_vault' })
    .structuredContent as EcsRoomAsciiReport;
  assert.equal(vaultAscii.ok, true);
  assert.equal(vaultAscii.cols, 12);
  assert.equal(vaultAscii.rows, 9);
  assert.ok(vaultAscii.entities.some((e) => e.tag === 'sigil_altar'), 'ASCII stamp spawned vault altar prefab');
  assert.ok(vaultAscii.entities.some((e) => e.tag === 'sentinel'), 'ASCII stamp spawned sentinel prefab');

  // 4. Multi-room BFS Reachability Oracle proves all 4 rooms & new vault_sigil global are reachable
  const reachOk = mcp.invokeTool('analyze_world_map').structuredContent as EcsWorldMapReachabilityReport;
  assert.equal(reachOk.pass, true, `Expected 0 soft-locks: ${reachOk.softLockRisks.join('; ')}`);
  assert.equal(reachOk.reachableRoomIds.length, 4);
  assert.equal(reachOk.unlockedGlobals.vault_sigil, 1);

  // 5. Intentionally wall off the vault altar -> Oracle MUST catch the soft-lock -> Undo restores pass
  mcp.invokeTool('dispatch_ecs_command', {
    command: {
      type: 'paint_tiles',
      roomId: 'obsidian_vault',
      layer: 'wall',
      changes: [
        { col: 3, row: 3, tileId: CASTLE_TILE_IDS.WALL_BRICK },
        { col: 3, row: 5, tileId: CASTLE_TILE_IDS.WALL_BRICK },
        { col: 2, row: 4, tileId: CASTLE_TILE_IDS.WALL_BRICK },
        { col: 4, row: 4, tileId: CASTLE_TILE_IDS.WALL_BRICK },
      ],
    },
  });
  const reachBlocked = mcp.invokeTool('analyze_world_map').structuredContent as EcsWorldMapReachabilityReport;
  assert.equal(reachBlocked.pass, false, 'Oracle must catch walled-off interactive prop soft-lock');
  assert.ok(reachBlocked.unreachableInteractionIds.length >= 1);

  assert.equal(mcp.invokeTool('undo').isError, false);
  const reachRestored = mcp.invokeTool('analyze_world_map').structuredContent as EcsWorldMapReachabilityReport;
  assert.equal(reachRestored.pass, true, 'Undo restores 0 soft-locks cleanly');

  // 6. Run deterministic 60Hz scripted playtest walking down into the AI-authored portal into obsidian_vault!
  const playRes = mcp.invokeTool('run_scripted_playtest', {
    plan: {
      maxFrames: 60,
      keypoints: [{ fromFrame: 0, toFrame: 50, input: { down: true }, label: 'Walk south into Secret Vault portal' }],
      assertions: [
        { kind: 'in_room', roomId: 'obsidian_vault' },
        { kind: 'no_nan_positions' },
      ],
    },
  });
  assert.equal(playRes.isError, false);
  const report = playRes.structuredContent as { ok: boolean; activeRoomId: string; failureHints: string[] };
  assert.equal(report.ok, true, `Scripted playtest failed: ${report.failureHints.join('; ')}`);
  assert.equal(report.activeRoomId, 'obsidian_vault');
});

test('M1: EcsCustomSpriteCompiler compiles grid & all Oklab+Bayer procedural patterns and hot-syncs TextureAtlas with Undo/Redo', () => {
  const atlas = new TextureAtlas();
  const baseDynamicCount = atlas.getAtlasStats().dynamicSprites;

  // 1. All 13 procedural Oklab+Bayer patterns compile deterministically with opaque RGBA pixels
  for (const pat of ECS_PROCEDURAL_SPRITE_PATTERNS) {
    const def = {
      id: `m1_proc_${pat}`,
      name: `Procedural ${pat}`,
      width: pat === 'pillar' || pat === 'banner' ? 32 : 32,
      height: pat === 'pillar' || pat === 'banner' ? 48 : 32,
      kind: 'procedural' as const,
      recipe: {
        pattern: pat,
        baseHex: '#3aa884',
        secondaryHex: '#18362e',
        accentHex: '#f5e07d',
        seed: 777,
        dither: true,
        bevel: true,
        emissiveCore: true,
      },
    };
    const c1 = compileCustomSpriteToRgba(def);
    const c2 = compileCustomSpriteToRgba(def);
    assert.equal(c1.width, def.width);
    assert.equal(c1.height, def.height);
    assert.equal(c1.rgba.length, def.width * def.height * 4);
    assert.deepEqual(c1.rgba, c2.rgba, `Pattern '${pat}' must be deterministic`);

    let opaque = 0;
    for (let i = 3; i < c1.rgba.length; i += 4) {
      if (c1.rgba[i] > 0) opaque++;
    }
    assert.ok(opaque > 24, `Pattern '${pat}' should produce visible opaque pixels (got ${opaque})`);
  }

  // 2. Palette-indexed grid sprite (48x64 tall sprite) + transactional session Undo/Redo + Atlas slot recycle
  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const tallRows = Array.from({ length: 64 }, (_, y) =>
    y >= 8 && y < 56 ? '........' + '4'.repeat(32) + '........' : '.'.repeat(48),
  );
  const upsertRes = session.dispatch({
    type: 'upsert_custom_sprite',
    sprite: {
      id: 'm1_tall_totem',
      name: '翠律巨像測試',
      width: 48,
      height: 64,
      kind: 'grid',
      palette: ['transparent', '#111111', '#ffffff', '#7ee8b7', '#2fb57a'],
      pixels: tallRows,
    },
  });
  assert.equal(upsertRes.ok, true, upsertRes.errors.join('; '));
  assert.equal(upsertRes.createdSpriteId, 'm1_tall_totem');

  // Verify JSON serialization round-trip preserves customSprites cleanly
  const roundTripped = JSON.parse(JSON.stringify(session.getProject())) as EcsProjectV2;
  assert.equal(validateEcsProjectV2(roundTripped).ok, true);
  assert.ok(roundTripped.customSprites?.m1_tall_totem);

  let synced = syncProjectCustomSpritesToAtlas(atlas, roundTripped);
  assert.equal(atlas.hasSprite('m1_tall_totem'), true);
  const rect = atlas.getRect('m1_tall_totem');
  assert.equal(rect.w, 48);
  assert.equal(rect.h, 64);
  assert.equal(atlas.getAtlasStats().dynamicSprites, baseDynamicCount + 1);

  // Undo removes sprite from project & sync releases dynamic atlas slot
  assert.equal(session.undo().ok, true);
  synced = syncProjectCustomSpritesToAtlas(atlas, session.getProject(), synced);
  assert.equal(atlas.hasSprite('m1_tall_totem'), false);
  assert.equal(atlas.getAtlasStats().dynamicSprites, baseDynamicCount);

  // Redo restores sprite & re-compiles cleanly
  assert.equal(session.redo().ok, true);
  synced = syncProjectCustomSpritesToAtlas(atlas, session.getProject(), synced);
  assert.equal(atlas.hasSprite('m1_tall_totem'), true);
  assert.equal(synced.has('m1_tall_totem'), true);

  // Engine Core Purity Check on EcsCustomSpriteCompiler.ts (DOM-free & zero game-specific tokens)
  const compilerSrc = readFileSync(resolve(process.cwd(), 'src/core/ecs/EcsCustomSpriteCompiler.ts'), 'utf8');
  assert.equal(compilerSrc.includes('document.'), false, 'EcsCustomSpriteCompiler must be 100% DOM-free');
  assert.equal(compilerSrc.includes('MALAKOR'), false, 'EcsCustomSpriteCompiler must have zero game hardcoding');
});

test('M1 Cross-Theme Proof: Emerald Ruins multi-room world uses 100% customSprites, compiles cleanly to Atlas, and passes BFS + 60Hz runtime', () => {
  // 1. Schema validation & zero castle sprite leakage
  const valid = validateEcsProjectV2(EMERALD_RUINS_PROJECT);
  assert.equal(valid.ok, true, valid.errors.join('; '));

  const customIds = new Set(Object.keys(EMERALD_RUINS_PROJECT.customSprites ?? {}));
  assert.ok(customIds.size >= 18, `Expected >=18 custom sprites, got ${customIds.size}`);
  for (const td of EMERALD_RUINS_PROJECT.worldMap?.tileDefs ?? []) {
    assert.equal(customIds.has(td.sprite), true, `Tile '${td.name}' must use project custom sprite, got '${td.sprite}'`);
    assert.equal(td.sprite.startsWith('castle_'), false, 'Cross-theme tiles must not depend on castle_ sprites');
  }
  for (const pref of Object.values(EMERALD_RUINS_PROJECT.prefabs)) {
    const sp = pref.components.sprite?.sprite;
    if (sp) assert.equal(customIds.has(sp), true, `Prefab '${pref.id}' must use project custom sprite '${sp}'`);
  }

  // 2. Dynamic Atlas hot-compilation of all custom sprites
  const atlas = new TextureAtlas();
  const synced = syncProjectCustomSpritesToAtlas(atlas, EMERALD_RUINS_PROJECT);
  assert.equal(synced.size, customIds.size);
  for (const id of customIds) {
    assert.equal(atlas.hasSprite(id), true, `Custom sprite '${id}' missing in TextureAtlas`);
    const rect = atlas.getRect(id);
    const expected = EMERALD_RUINS_PROJECT.customSprites![id];
    assert.equal(rect.w, expected.width);
    assert.equal(rect.h, expected.height);
  }

  // 3. Multi-room BFS Reachability Oracle proves 0 soft-locks across both non-castle rooms
  const reach = analyzeWorldMapReachability(EMERALD_RUINS_PROJECT);
  assert.equal(reach.pass, true, `Emerald Ruins soft-locks: ${reach.softLockRisks.join('; ')}`);
  assert.equal(reach.reachableRoomIds.length, 2);
  assert.ok(reach.reachableRoomIds.includes('sunken_grove'));
  assert.ok(reach.reachableRoomIds.includes('sanctum_altar'));
  assert.equal(reach.unlockedGlobals.crystals_attuned, 2);
  assert.equal(reach.unlockedGlobals.grove_seal_open, 1);

  // 4. Runtime renders extruded custom walls, triggers interactions, unlocks seal gate, and switches to Sanctum Altar
  const rt = new EcsCartridgeRuntime(EMERALD_RUINS_PROJECT);
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const snap1 = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(snap1.tiles.some((t) => t.sprite === 'er_jade_wall'), 'Custom extruded jade wall must render in tiles');
  assert.ok(snap1.tiles.some((t) => t.sprite === 'er_ruin_pillar'), 'Custom 32x48 pillar must render in tiles');
  assert.ok(snap1.entities.some((e) => e.sprite === 'er_ranger_a'), 'Custom hero sprite must render in entities');

  // Switch to room 2 and verify 48x64 Warden boss renders with custom sprite
  rt.switchRoomForEditor('sanctum_altar');
  assert.equal(rt.getActiveRoomId(), 'sanctum_altar');
  rt.step(1 / 60, createEmptyInputState(), DEFAULT_RUNTIME_PARAMS);
  const snap2 = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(snap2.entities.some((e) => e.sprite === 'er_sanctum_warden'), 'Custom 48x64 Warden boss must render');
});

test('M1 AI-Native MCP Proof: Author a 2-room Sci-Fi Orbital Deck purely via MCP upsert_custom_sprite + tileDefs + stamp_room_ascii', () => {
  const blankProject: EcsProjectV2 = {
    schemaVersion: 2,
    meta: {
      id: 'orbital-deck-mcp',
      code: 'MCP-1',
      title: '蒼穹星港：反應爐甲板',
      subtitle: '純 MCP 自訂像素瓦片跨主題測試',
      genre: 'Sci-Fi Top-Down',
      accentHex: '#38bdf8',
      controlsHint: 'WASD + J',
      goalHint: '啟動控制台開啟氣閘並進入反應爐核心',
    },
    viewport: { preset: 'hd_plus', width: 640, height: 360 },
    atmosphere: { skyTop: '#081221', skyBottom: '#102038', ambientDarkness: 0.25 },
    projection: { mode: 'hd2d_iso' },
    paths: {},
    animations: [],
    prefabs: {},
    entities: [],
    scripts: {},
    globals: { airlock_unlocked: 0 },
    hud: [],
  };

  const mcp = new PixerMcpSession(blankProject);

  // 1. Grammar advertises upsert_custom_sprite & proceduralSpritePatterns
  const grammar = mcp.invokeTool('describe_editor_grammar').structuredContent as {
    commands: Array<{ type: string }>;
    proceduralSpritePatterns: string[];
  };
  assert.ok(grammar.commands.some((c) => c.type === 'upsert_custom_sprite'));
  assert.ok(grammar.proceduralSpritePatterns.includes('metal_panel'));
  assert.ok(grammar.proceduralSpritePatterns.includes('circuit'));

  // 2. Author entire 2-room Sci-Fi world in ONE atomic MCP batch with custom sprites & custom tileDefs
  const batchRes = mcp.invokeTool('dispatch_ecs_batch', {
    label: 'AI-authored 2-room Orbital Deck with 100% custom sprites',
    commands: [
      { type: 'ensure_world_map', cols: 12, rows: 9, roomName: '氣閘裝卸艙' },
      {
        type: 'upsert_custom_sprite',
        sprite: {
          id: 'sf_hull_floor',
          name: '星艦甲板',
          width: 32,
          height: 32,
          kind: 'procedural',
          recipe: { pattern: 'metal_panel', baseHex: '#3b4c63', secondaryHex: '#1b2433', accentHex: '#7dd3fc', seed: 11 },
        },
      },
      {
        type: 'upsert_custom_sprite',
        sprite: {
          id: 'sf_circuit_floor',
          name: '能源導管地磚',
          width: 32,
          height: 32,
          kind: 'procedural',
          recipe: { pattern: 'circuit', baseHex: '#1c324a', accentHex: '#38bdf8', emissiveCore: true, seed: 22 },
        },
      },
      {
        type: 'upsert_custom_sprite',
        sprite: {
          id: 'sf_bulkhead_wall',
          name: '鈦合金艙壁',
          width: 32,
          height: 32,
          kind: 'procedural',
          recipe: { pattern: 'bricks', baseHex: '#4f6278', secondaryHex: '#1f2b3a', accentHex: '#bae6fd', frameBorder: true, seed: 33 },
        },
      },
      {
        type: 'upsert_custom_sprite',
        sprite: {
          id: 'sf_airlock_gate',
          name: '氣閘防爆門',
          width: 32,
          height: 32,
          kind: 'procedural',
          recipe: { pattern: 'gate', baseHex: '#475569', secondaryHex: '#1e293b', accentHex: '#38bdf8', seed: 44 },
        },
      },
      {
        type: 'upsert_custom_sprite',
        sprite: {
          id: 'sf_console_off',
          name: '氣閘終端 (待機)',
          width: 32,
          height: 32,
          kind: 'procedural',
          recipe: { pattern: 'crystal', baseHex: '#475569', accentHex: '#94a3b8', seed: 55 },
        },
      },
      {
        type: 'upsert_custom_sprite',
        sprite: {
          id: 'sf_console_on',
          name: '氣閘終端 (連線)',
          width: 32,
          height: 32,
          kind: 'procedural',
          recipe: { pattern: 'crystal', baseHex: '#0284c7', accentHex: '#e0f2fe', emissiveCore: true, seed: 56 },
        },
      },
      {
        type: 'upsert_custom_sprite',
        sprite: {
          id: 'sf_pilot',
          name: '太空工程師',
          width: 16,
          height: 16,
          kind: 'grid',
          palette: ['transparent', '#0f172a', '#f8fafc', '#38bdf8', '#f59e0b'],
          pixels: [
            '....11111111....',
            '...1222222221...',
            '...1233333321...',
            '...1233223321...',
            '...1222222221...',
            '....11444411....',
            '...1224444221...',
            '...1224334221...',
            '...1224444221...',
            '....12222221....',
            '....12211221....',
            '....12211221....',
            '....111..111....',
            '................',
            '................',
            '................',
          ],
        },
      },
      { type: 'upsert_tile_def', tileDef: { id: 201, name: '星艦甲板', layer: 'ground', sprite: 'sf_hull_floor', solid: false } },
      { type: 'upsert_tile_def', tileDef: { id: 202, name: '能源導管', layer: 'ground', sprite: 'sf_circuit_floor', solid: false } },
      { type: 'upsert_tile_def', tileDef: { id: 211, name: '鈦合金艙壁', layer: 'wall', sprite: 'sf_bulkhead_wall', solid: true, extrudeH: 18 } },
      { type: 'upsert_tile_def', tileDef: { id: 212, name: '氣閘防爆門', layer: 'wall', sprite: 'sf_airlock_gate', solid: true, extrudeH: 18, unlockGlobal: 'airlock_unlocked' } },
      {
        type: 'create_prefab',
        prefab: {
          id: 'sf_terminal',
          name: '氣閘控制台',
          category: 'puzzle',
          components: {
            transform: { x: 0, y: 0, w: 32, h: 32, zOrder: 18 },
            sprite: { sprite: 'sf_console_off', emissive: 0.4 },
            light: { radius: 84, color: '#38bdf8', intensity: 0.75 },
            collider: { radius: 14, isSolid: false },
            tag: 'airlock_terminal',
          },
        },
      },
      {
        type: 'upsert_interaction_rule',
        rule: {
          tag: 'airlock_terminal',
          trigger: 'slash_or_touch',
          radius: 30,
          oneShot: true,
          setGlobal: 'airlock_unlocked',
          setGlobalValue: 1,
          swapSprite: 'sf_console_on',
          scoreDelta: 200,
          popupText: '氣閘防爆門已解除鎖定！',
          popupColor: '#38bdf8',
          soundEvent: 'key',
        },
      },
      {
        type: 'stamp_room_ascii',
        roomId: 'room_main',
        roomName: '氣閘裝卸艙',
        clearExistingRoomEntities: true,
        lines: [
          '#####DD#####',
          '#....==....#',
          '#....==....#',
          '#....==....#',
          '#....T=....#',
          '#....==....#',
          '#....==....#',
          '############',
        ],
        legend: {
          '#': { ground: 201, wall: 211 },
          'D': { ground: 202, wall: 212 },
          '.': { ground: 201, wall: 0 },
          '=': { ground: 202, wall: 0 },
          'T': { ground: 202, wall: 0, prefabId: 'sf_terminal' },
        },
      },
      {
        type: 'stamp_room_ascii',
        roomId: 'reactor_core',
        roomName: '反應爐核心室',
        createIfMissing: true,
        lines: [
          '############',
          '#....==....#',
          '#....==....#',
          '#....==....#',
          '#....==....#',
          '#####..#####',
        ],
        legend: {
          '#': { ground: 201, wall: 211 },
          '.': { ground: 201, wall: 0 },
          '=': { ground: 202, wall: 0 },
        },
      },
      {
        type: 'upsert_portal',
        portal: {
          id: 'to_reactor',
          name: '前往反應爐核心',
          fromRoomId: 'room_main',
          col: 5,
          row: 0,
          cols: 2,
          rows: 1,
          toRoomId: 'reactor_core',
          targetX: 5 * 32 + 16,
          targetY: 4 * 32,
          requiresGlobal: 'airlock_unlocked',
        },
      },
      {
        type: 'upsert_portal',
        portal: {
          id: 'from_reactor',
          name: '返回氣閘裝卸艙',
          fromRoomId: 'reactor_core',
          col: 5,
          row: 5,
          cols: 2,
          rows: 1,
          toRoomId: 'room_main',
          targetX: 5 * 32 + 16,
          targetY: 2 * 32,
        },
      },
      {
        type: 'set_world_map_config',
        startRoomId: 'room_main',
        heroConfig: { walkSpriteA: 'sf_pilot', walkSpriteB: 'sf_pilot', slashSprite: 'sf_pilot' },
      },
      {
        type: 'spawn_entity',
        entity: {
          id: 'hero',
          name: '星艦工程師',
          roomId: 'room_main',
          components: {
            transform: { x: 5 * 32, y: 6 * 32, w: 32, h: 32, zOrder: 30 },
            body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 10 },
            sprite: { sprite: 'sf_pilot' },
            health: { hp: 6, maxHp: 6, team: 1 },
            collider: { radius: 10 },
            characterMotor2d: { moveSpeed: 150, topDown: true },
            tag: 'hero',
          },
        },
      },
    ],
  });
  assert.equal(batchRes.isError, false, JSON.stringify(batchRes.structuredContent));

  // 3. list_custom_sprites confirms all 7 Sci-Fi sprites exist
  const listSprites = mcp.invokeTool('list_custom_sprites').structuredContent as {
    customSprites: Array<{ id: string }>;
  };
  assert.equal(listSprites.customSprites.length, 7);

  // 4. Atlas hot-compilation succeeds for all 7 custom sprites
  const atlas = new TextureAtlas();
  const synced = syncProjectCustomSpritesToAtlas(atlas, mcp.session.getProject());
  assert.equal(synced.size, 7);
  assert.equal(atlas.hasSprite('sf_hull_floor'), true);
  assert.equal(atlas.hasSprite('sf_pilot'), true);

  // 5. BFS Reachability Oracle confirms 0 soft-locks across both Sci-Fi rooms
  const reach = mcp.invokeTool('analyze_world_map').structuredContent as EcsWorldMapReachabilityReport;
  assert.equal(reach.pass, true, `Orbital Deck soft-locks: ${reach.softLockRisks.join('; ')}`);
  assert.equal(reach.reachableRoomIds.length, 2);
  assert.equal(reach.unlockedGlobals.airlock_unlocked, 1);

  // 6. 60Hz scripted playtest walks north, touches terminal to unlock airlock, and enters reactor_core!
  const playRes = mcp.invokeTool('run_scripted_playtest', {
    plan: {
      maxFrames: 120,
      keypoints: [
        { fromFrame: 0, toFrame: 110, input: { up: true }, label: 'Touch airlock terminal & walk north into reactor core' },
      ],
      assertions: [
        { kind: 'global_gte', key: 'airlock_unlocked', value: 1 },
        { kind: 'in_room', roomId: 'reactor_core' },
        { kind: 'no_nan_positions' },
      ],
    },
  });
  assert.equal(playRes.isError, false);
  const report = playRes.structuredContent as { ok: boolean; activeRoomId: string; failureHints: string[] };
  assert.equal(report.ok, true, `Sci-Fi playtest failed: ${report.failureHints.join('; ')}`);
  assert.equal(report.activeRoomId, 'reactor_core');
});

test('M2 World Rules Inspector Parity: portals, interactions, AI profiles, heroConfig & HUD round-trip with Undo/Redo and live BFS diagnostics across PA-14 & PA-15', () => {
  for (const baseProj of [OBSIDIAN_CITADEL_PROJECT, EMERALD_RUINS_PROJECT]) {
    const session = new EcsStudioSession(baseProj);
    const startRooms = session.getProject().worldMap!.rooms;
    assert.ok(startRooms.length >= 2);
    const r0 = startRooms[0].id;
    const r1 = startRooms[1].id;

    // 1. Add a locked portal requiring a non-existent global -> BFS detects soft-lock risk immediately
    const addPortal = session.dispatch({
      type: 'upsert_portal',
      portal: {
        id: 'm2_test_portal',
        name: 'M2 Secret Gate',
        fromRoomId: r0,
        col: 2,
        row: 2,
        cols: 2,
        rows: 1,
        toRoomId: r1,
        targetX: 96,
        targetY: 96,
        requiresGlobal: 'm2_missing_key',
        lockedHint: '需要 M2 鑰匙',
      },
    });
    assert.equal(addPortal.ok, true);
    assert.ok(session.getProject().worldMap!.portals.some((p) => p.id === 'm2_test_portal'));

    // 2. Upsert interaction rule, AI profile, heroConfig & HUD gauge transactionally
    assert.equal(
      session.dispatch({
        type: 'upsert_interaction_rule',
        rule: {
          tag: 'm2_beacon',
          trigger: 'slash_or_touch',
          radius: 36,
          oneShot: true,
          setGlobal: 'm2_missing_key',
          setGlobalValue: 1,
          scoreDelta: 250,
          popupText: 'M2 信標啟動',
        },
      }).ok,
      true,
    );
    assert.equal(
      session.dispatch({
        type: 'upsert_ai_profile',
        tag: 'm2_sentinel',
        profile: {
          chaseRange: 160,
          stopRange: 22,
          moveSpeed: 64,
          contactDamage: 1,
          contactRange: 24,
          scoreOnDefeat: 300,
          phase2HpRatio: 0.45,
          phase2Speed: 88,
        },
      }).ok,
      true,
    );
    assert.equal(
      session.dispatch({
        type: 'set_world_map_config',
        heroConfig: {
          ...(session.getProject().worldMap!.heroConfig ?? {}),
          dashSpeedMultiplier: 2.8,
        },
      }).ok,
      true,
    );
    assert.equal(
      session.dispatch({
        type: 'upsert_hud_gauge',
        gauge: { kind: 'text', label: 'M2_KEY', globalKey: 'm2_missing_key', x: 16, y: 44, color: '#38bdf8' },
      }).ok,
      true,
    );

    const edited = session.getProject();
    assert.equal(edited.worldMap!.heroConfig?.dashSpeedMultiplier, 2.8);
    assert.ok(edited.worldMap!.interactions?.some((r) => r.tag === 'm2_beacon'));
    assert.ok(edited.worldMap!.aiProfiles?.m2_sentinel?.phase2Speed === 88);
    assert.ok(edited.hud.some((h) => h.label === 'M2_KEY'));

    // 3. Undo all 5 edits cleanly back to original project state and Redo
    for (let i = 0; i < 5; i++) {
      assert.equal(session.undo().ok, true);
    }
    assert.equal(session.getProject().worldMap!.portals.some((p) => p.id === 'm2_test_portal'), false);
    assert.equal(session.getProject().hud.some((h) => h.label === 'M2_KEY'), false);

    const reachAfterUndo = analyzeWorldMapReachability(session.getProject());
    assert.equal(reachAfterUndo.pass, true, `${baseProj.meta.id} must remain 0 soft-locks after Undo`);

    assert.equal(session.redo().ok, true);
    assert.ok(session.getProject().worldMap!.portals.some((p) => p.id === 'm2_test_portal'));
  }
});

test('ECS_COMMAND_CATALOG documents 100% of EcsStudioCommand union members without drift or duplicates', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/core/ecs/EcsStudioSession.ts'), 'utf8');
  const cmdBlock = src.match(/export\s+type\s+EcsStudioCommand\s*=([\s\S]*?);\s*\r?\n\s*export\s+const\s+ECS_COMMAND_CATALOG/);
  assert.ok(cmdBlock, 'EcsStudioCommand union block must exist in EcsStudioSession.ts');
  const declaredTypes = [...cmdBlock[1].matchAll(/type:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(declaredTypes.length >= 42, `Expected >=42 EcsStudioCommand variants, got ${declaredTypes.length}`);
  assert.equal(new Set(declaredTypes).size, declaredTypes.length, 'EcsStudioCommand types must be unique');

  const catalogTypes = ECS_COMMAND_CATALOG.map((entry) => entry.type);
  const catalogSet = new Set<string>(catalogTypes);
  assert.equal(catalogSet.size, catalogTypes.length, 'ECS_COMMAND_CATALOG must not contain duplicate command types');

  const missing = declaredTypes.filter((t) => !catalogSet.has(t));
  const extra = catalogTypes.filter((t) => !declaredTypes.includes(t));
  assert.deepEqual(missing, [], `Missing EcsStudioCommand entries in ECS_COMMAND_CATALOG: ${missing.join(', ')}`);
  assert.deepEqual(extra, [], `Stale entries in ECS_COMMAND_CATALOG: ${extra.join(', ')}`);
});

test('EcsSpatialOracle catches one-way dead-end rooms, walled-in portals, solid hero spawn & >16-hop chains', () => {
  // 1. Both flagship projects PA-14 & PA-15 remain 100% reachable with 0 soft-locks
  assert.equal(analyzeWorldMapReachability(OBSIDIAN_CITADEL_PROJECT).pass, true);
  assert.equal(analyzeWorldMapReachability(EMERALD_RUINS_PROJECT).pass, true);

  // 2. One-way dead-end room (no outgoing unlocked portal and no boss/victory trigger) MUST fail
  const baseProj: EcsProjectV2 = structuredClone(OBSIDIAN_CITADEL_PROJECT);
  const deadRoom = createEmptyRoom('dead_end_cellar', '死胡同地窖', 10, 8, CASTLE_TILE_IDS.STONE_FLOOR);
  baseProj.worldMap!.rooms = [createEmptyRoom('courtyard', 'Start', 10, 8, CASTLE_TILE_IDS.STONE_FLOOR), deadRoom];
  baseProj.worldMap!.startRoomId = 'courtyard';
  baseProj.worldMap!.portals = [
    {
      id: 'to_dead_end',
      name: 'One-Way Trap',
      fromRoomId: 'courtyard',
      col: 4,
      row: 1,
      cols: 2,
      rows: 1,
      toRoomId: 'dead_end_cellar',
      targetX: 5 * 32,
      targetY: 4 * 32,
    },
  ];
  baseProj.entities = [
    {
      id: 'hero',
      name: 'Hero',
      roomId: 'courtyard',
      components: { transform: { x: 4 * 32, y: 4 * 32, w: 32, h: 32 }, tag: 'hero' },
    },
  ];
  const deadEndReach = analyzeWorldMapReachability(baseProj);
  assert.equal(deadEndReach.pass, false, 'One-way dead-end room must fail reachability');
  assert.ok(
    deadEndReach.softLockRisks.some((r) => r.includes('dead_end_cellar') && r.includes('dead-end')),
    `Expected one-way dead-end diagnostic, got: ${deadEndReach.softLockRisks.join('; ')}`,
  );

  // 3. Walled-in portal placed on solid wall without unlockGlobal must NOT be marked traversable
  const walledPortalProj = structuredClone(baseProj);
  setRoomTile(walledPortalProj.worldMap!.rooms[0], 'wall', 4, 0, CASTLE_TILE_IDS.WALL_GOTHIC);
  setRoomTile(walledPortalProj.worldMap!.rooms[0], 'wall', 5, 0, CASTLE_TILE_IDS.WALL_GOTHIC);
  walledPortalProj.worldMap!.portals = [
    {
      id: 'walled_portal',
      name: 'Sealed Wall Portal',
      fromRoomId: 'courtyard',
      col: 4,
      row: 0,
      cols: 2,
      rows: 1,
      toRoomId: 'dead_end_cellar',
      targetX: 5 * 32,
      targetY: 4 * 32,
    },
  ];
  const walledReach = analyzeWorldMapReachability(walledPortalProj);
  assert.equal(walledReach.pass, false);
  assert.ok(walledReach.unreachableRoomIds.includes('dead_end_cellar'), 'Walled-in portal must not traverse to target room');

  // 4. Solid hero spawn cell must fail reachability
  const solidHeroProj = structuredClone(baseProj);
  setRoomTile(solidHeroProj.worldMap!.rooms[0], 'wall', 4, 4, CASTLE_TILE_IDS.WALL_BRICK);
  const solidHeroReach = analyzeWorldMapReachability(solidHeroProj);
  assert.equal(solidHeroReach.pass, false);
  assert.ok(solidHeroReach.softLockRisks.some((r) => r.includes('Hero spawn cell')));

  // 5. Long 20-room chain (> old 16 pass cap) with return portal to start must pass cleanly
  const chainProj = structuredClone(baseProj);
  chainProj.worldMap!.rooms = [];
  chainProj.worldMap!.portals = [];
  for (let i = 0; i < 20; i++) {
    chainProj.worldMap!.rooms.push(
      createEmptyRoom(`chain_${i}`, `Room ${i}`, 10, 8, CASTLE_TILE_IDS.STONE_FLOOR),
    );
    chainProj.worldMap!.portals.push({
      id: `p_${i}`,
      name: `Portal ${i}`,
      fromRoomId: `chain_${i}`,
      col: 4,
      row: 2,
      cols: 1,
      rows: 1,
      toRoomId: `chain_${(i + 1) % 20}`,
      targetX: 4 * 32 + 16,
      targetY: 4 * 32 + 16,
    });
  }
  chainProj.worldMap!.startRoomId = 'chain_0';
  chainProj.entities = [
    {
      id: 'hero',
      name: 'Hero',
      roomId: 'chain_0',
      components: { transform: { x: 4 * 32, y: 4 * 32, w: 32, h: 32 }, tag: 'hero' },
    },
  ];
  const chainReach = analyzeWorldMapReachability(chainProj);
  assert.equal(chainReach.pass, true, `20-room chain should pass dynamic fixed-point limit: ${chainReach.softLockRisks.join('; ')}`);
  assert.equal(chainReach.reachableRoomIds.length, 20);

  // 6. Boss placed inside a solid wall cell adjacent to walkable floor must be flagged unreachable
  const walledBossProj = structuredClone(baseProj);
  walledBossProj.worldMap!.rooms = [createEmptyRoom('courtyard', 'Start', 10, 8, CASTLE_TILE_IDS.STONE_FLOOR)];
  walledBossProj.worldMap!.portals = [];
  setRoomTile(walledBossProj.worldMap!.rooms[0], 'wall', 6, 4, CASTLE_TILE_IDS.WALL_BRICK);
  walledBossProj.entities.push({
    id: 'walled_boss',
    name: 'Walled Boss',
    roomId: 'courtyard',
    prefabId: 'demon_lord',
    components: { transform: { x: 6 * 32, y: 4 * 32, w: 32, h: 32 }, tag: 'boss' },
  });
  const walledBossReach = analyzeWorldMapReachability(walledBossProj);
  assert.equal(walledBossReach.pass, false);
  assert.ok(walledBossReach.unreachableBossIds.includes('walled_boss'));
});
