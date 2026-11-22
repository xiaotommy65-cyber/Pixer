import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync, zipSync } from 'fflate';
import { ATLAS_SIZE, TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { analyzeWorldMapReachability } from '../../src/core/ai/EcsSpatialOracle.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import {
  compileCustomSpriteToRgba,
  syncProjectCustomSpritesToAtlas,
  uint8ToBase64,
} from '../../src/core/ecs/EcsCustomSpriteCompiler.ts';
import { EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import {
  buildInteropStudioCommands,
  buildSampleAsepriteFile,
  buildSampleLdtkSample,
  buildSampleTiledZlibSample,
  encodeMinimalAsepriteBinary,
  loadExternalInteropFiles,
  parseAsepriteBinary,
  parseAsepriteJsonSheet,
  parseTiledMap,
  type DecodedPngImage,
} from '../../src/core/interop/index.ts';
import { createEmptyInputState, DEFAULT_RUNTIME_PARAMS } from '../../src/core/types/WorldTypes.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';

test('MaxRectsBin in TextureAtlas packs mixed sprite sizes with zero overlap, multi-page spill & clean recycling', () => {
  const atlas = new TextureAtlas();
  const initialDynamicCount = atlas.getDynamicSlotCount();
  const sizes: [number, number][] = [
    [16, 16],
    [32, 32],
    [32, 48],
    [48, 64],
    [64, 64],
    [128, 96],
  ];
  const placed: Array<{ id: string; page: number; x: number; y: number; w: number; h: number }> = [];

  for (let i = 0; i < 160; i++) {
    const [w, h] = sizes[i % sizes.length];
    const rgba = new Uint8Array(w * h * 4);
    rgba.fill(255);
    const id = `mr_test_${i}`;
    const rect = atlas.registerDynamicRgbaSprite(id, w, h, rgba);
    const x = Math.round(rect.u0 * ATLAS_SIZE);
    const y = Math.round(rect.v0 * ATLAS_SIZE);
    const page = rect.page ?? 0;
    assert.equal(rect.w, w);
    assert.equal(rect.h, h);
    if (page === 0) {
      assert.ok(y >= 128, `Page 0 dynamic sprite must not intrude on built-in top 128px (got y=${y})`);
    }
    assert.ok(x + w <= ATLAS_SIZE && y + h <= ATLAS_SIZE, 'Sprite rect must remain within 1024×1024 page bounds');
    placed.push({ id, page, x, y, w, h });
  }

  // Verify zero pairwise overlap on every atlas page
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.page !== b.page) continue;
      const overlaps = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      assert.equal(overlaps, false, `Sprites ${a.id} and ${b.id} overlapped on page ${a.page}`);
    }
  }

  // Force multi-page spill with large sprites
  for (let k = 0; k < 24; k++) {
    const rgba = new Uint8Array(256 * 256 * 4);
    rgba.fill(200);
    atlas.registerDynamicRgbaSprite(`mr_big_${k}`, 256, 256, rgba);
  }
  const pagesAfterSpill = atlas.getPageCount();
  assert.ok(pagesAfterSpill >= 2, `Expected multi-page spill (got ${pagesAfterSpill} pages)`);

  // Release all test dynamic sprites and verify count restores + free-slot reuse works without extra pages
  const released = atlas.releaseDynamicByPrefix('mr_');
  assert.equal(released, 184);
  assert.equal(atlas.getDynamicSlotCount(), initialDynamicCount);
  const reusedRgba = new Uint8Array(256 * 256 * 4);
  reusedRgba.fill(180);
  atlas.registerDynamicRgbaSprite('mr_reused_big', 256, 256, reusedRgba);
  assert.equal(atlas.getPageCount(), pagesAfterSpill, 'Recycled 256x256 slot should be reused without allocating a new page');
  atlas.releaseDynamicSprite('mr_reused_big');
  assert.equal(atlas.getDynamicSlotCount(), initialDynamicCount);
});

test('Aseprite binary parser decodes 32-bit RGBA Zlib cels, 8-bit Indexed palette, Tags & lossless rgba_b64', () => {
  // 1. Built-in 4-frame 32x32 Crystal Knight binary sample
  const sample = buildSampleAsepriteFile();
  const parsed = parseAsepriteBinary(sample.bytes, sample.name);
  assert.equal(parsed.format, 'aseprite_bin');
  assert.equal(parsed.customSprites.length, 4);
  assert.equal(parsed.customSprites[0].kind, 'rgba_b64');
  assert.equal(parsed.customSprites[0].width, 32);
  assert.equal(parsed.customSprites[0].height, 32);
  assert.equal(parsed.animationTags?.[0]?.name, 'idle');
  assert.equal(parsed.animationTags?.[0]?.toFrame, 3);

  const rgba0 = compileCustomSpriteToRgba(parsed.customSprites[0]).rgba;
  const rgba1 = compileCustomSpriteToRgba(parsed.customSprites[1]).rgba;
  assert.equal(rgba0.length, 32 * 32 * 4);
  let nonZeroAlpha = 0;
  let diffPixels = 0;
  for (let i = 0; i < rgba0.length; i += 4) {
    if (rgba0[i + 3] > 0) nonZeroAlpha++;
    if (rgba0[i] !== rgba1[i] || rgba0[i + 1] !== rgba1[i + 1] || rgba0[i + 3] !== rgba1[i + 3]) {
      diffPixels++;
    }
  }
  assert.ok(nonZeroAlpha > 150, `Expected visible pixel silhouette (got ${nonZeroAlpha} pixels)`);
  assert.ok(diffPixels > 10, 'Frame 0 and Frame 1 should differ for animated idle cycle');

  // 2. 8-bit Indexed color mode with transparent index 0
  const idxPixels = new Uint8Array(16 * 16);
  idxPixels.fill(0);
  idxPixels[5 * 16 + 5] = 1;
  idxPixels[5 * 16 + 6] = 2;
  const idxAse = encodeMinimalAsepriteBinary({
    width: 16,
    height: 16,
    frames: [idxPixels],
    colorDepth: 8,
    palette: [
      [0, 0, 0, 0],
      [255, 64, 32, 255],
      [32, 220, 180, 255],
    ],
  });
  const parsedIdx = parseAsepriteBinary(idxAse, 'indexed_gem.aseprite');
  const decodedIdx = compileCustomSpriteToRgba(parsedIdx.customSprites[0]).rgba;
  assert.equal(decodedIdx[(5 * 16 + 5) * 4 + 0], 255);
  assert.equal(decodedIdx[(5 * 16 + 5) * 4 + 1], 64);
  assert.equal(decodedIdx[(5 * 16 + 6) * 4 + 2], 180);
  assert.equal(decodedIdx[0 + 3], 0, 'Transparent index 0 must decode to alpha=0');

  // 3. Aseprite JSON Sprite Sheet (Hash format) + companion RGBA sheet
  const sheetRgba = new Uint8Array(32 * 16 * 4);
  sheetRgba.fill(0);
  // Frame A at (0,0) = red, Frame B at (16,0) = green
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const a = (y * 32 + x) * 4;
      sheetRgba[a] = 240;
      sheetRgba[a + 3] = 255;
      const b = (y * 32 + (x + 16)) * 4;
      sheetRgba[b + 1] = 230;
      sheetRgba[b + 3] = 255;
    }
  }
  const sheetJson = JSON.stringify({
    frames: {
      'slime 0.ase': { frame: { x: 0, y: 0, w: 16, h: 16 } },
      'slime 1.ase': { frame: { x: 16, y: 0, w: 16, h: 16 } },
    },
    meta: {
      image: 'slime.png',
      frameTags: [{ name: 'bounce', from: 0, to: 1, direction: 'pingpong' }],
    },
  });
  const parsedSheet = parseAsepriteJsonSheet(sheetJson, { width: 32, height: 16, rgba: sheetRgba }, 'slime.json');
  assert.equal(parsedSheet.customSprites.length, 2);
  assert.equal(parsedSheet.animationTags?.[0]?.direction, 'pingpong');
  const f0 = compileCustomSpriteToRgba(parsedSheet.customSprites[0]).rgba;
  const f1 = compileCustomSpriteToRgba(parsedSheet.customSprites[1]).rgba;
  assert.equal(f0[0], 240);
  assert.equal(f1[1], 230);
});

test('LDtk 2-room sample commits atomically, passes BFS 0 soft-locks, runs 60Hz, and reverts cleanly on 1 Undo', async () => {
  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const origRoomIds = session.getProject().worldMap!.rooms.map((r) => r.id);

  const ldtkResult = await loadExternalInteropFiles([buildSampleLdtkSample()]);
  assert.equal(ldtkResult.format, 'ldtk');
  assert.equal(ldtkResult.rooms.length, 2);
  assert.ok(ldtkResult.portals.length >= 2);

  const cmds = buildInteropStudioCommands(ldtkResult, session.getProject(), {
    replaceWorldMap: true,
    wallExtrudeH: 26,
  });
  const batchRes = session.dispatchBatch(cmds, '匯入 LDtk 測試');
  assert.equal(batchRes.ok, true, `Batch failed: ${batchRes.errors.join('; ')}`);

  const proj = session.getProject();
  assert.equal(proj.worldMap?.rooms.length, 2);
  const reach = analyzeWorldMapReachability(proj);
  assert.equal(reach.pass, true, `Expected 0 soft-locks, got: ${reach.softLockRisks.join('; ')}`);
  assert.equal(reach.reachableRoomIds.length, 2);

  // Sync to atlas & run 60Hz runtime for 60 frames
  const atlas = new TextureAtlas();
  syncProjectCustomSpritesToAtlas(atlas, proj);
  const rt = new EcsCartridgeRuntime(proj);
  const input = createEmptyInputState();
  for (let i = 0; i < 60; i++) {
    rt.step(1 / 60, input, DEFAULT_RUNTIME_PARAMS);
  }
  const snap = rt.snapshot(DEFAULT_RUNTIME_PARAMS, 1);
  assert.ok(snap.tiles.length > 50, 'LDtk runtime must emit HD-2D tiles');
  assert.ok(snap.entities.length >= 4, 'LDtk runtime must emit imported entities');

  // Single Undo must restore original Obsidian Citadel rooms completely
  const undoRes = session.undo();
  assert.equal(undoRes.ok, true);
  assert.deepEqual(
    session.getProject().worldMap!.rooms.map((r) => r.id),
    origRoomIds,
  );
});

test('Tiled Base64 + Zlib & Gzip decompression strips GID flip flags and extracts objects', async () => {
  // 1. Built-in Zlib sample
  const tiledRes = await loadExternalInteropFiles([buildSampleTiledZlibSample()]);
  assert.equal(tiledRes.format, 'tiled');
  assert.equal(tiledRes.rooms.length, 1);
  assert.equal(tiledRes.rooms[0].cols, 16);
  assert.equal(tiledRes.rooms[0].rows, 12);
  assert.ok(tiledRes.tileDefs.length >= 5);
  assert.ok(tiledRes.entities.some((e) => e.id === 'hero'));
  assert.ok(tiledRes.entities.some((e) => e.components.tag === 'switch'));

  // 2. Gzip + horizontal/vertical flip flag masking (bit 31 & bit 30 set on GID 1)
  const rawGids = new Uint8Array(8 * 8 * 4);
  const dv = new DataView(rawGids.buffer);
  for (let i = 0; i < 64; i++) {
    const flippedGid = (1 | 0x80000000 | 0x40000000) >>> 0;
    dv.setUint32(i * 4, flippedGid, true);
  }
  const gzipB64 = uint8ToBase64(gzipSync(rawGids));
  const gzipTmj = JSON.stringify({
    width: 8,
    height: 8,
    tilewidth: 32,
    tileheight: 32,
    tilesets: [{ firstgid: 1, name: 'test_set', tilewidth: 32, tileheight: 32, columns: 2, tilecount: 2 }],
    layers: [
      { name: 'Ground', type: 'tilelayer', width: 8, height: 8, encoding: 'base64', compression: 'gzip', data: gzipB64 },
    ],
  });
  const parsedGzip = parseTiledMap(gzipTmj, new Map(), 'gzip_test.tmj');
  assert.equal(parsedGzip.rooms[0].ground.every((id) => id > 0), true);
});

test('ZIP bundle auto-pairs .ldtk with companion tileset PNG into lossless rgba_b64 sprites', async () => {
  const ldtkWithTileset = JSON.stringify({
    jsonVersion: '1.5.3',
    defaultGridSize: 16,
    defs: {
      tilesets: [{ uid: 10, identifier: 'RuinsSheet', relPath: 'tiles/ruins.png', tileGridSize: 16, pxWid: 32, pxHei: 16 }],
      layers: [],
    },
    levels: [
      {
        identifier: 'ZipRoom',
        iid: 'zip_r1',
        pxWid: 128,
        pxHei: 128,
        layerInstances: [
          {
            __identifier: 'Ground',
            __type: 'Tiles',
            __cWid: 8,
            __cHei: 8,
            __gridSize: 16,
            __tilesetDefUid: 10,
            __tilesetRelPath: 'tiles/ruins.png',
            gridTiles: [{ px: [16, 16], src: [16, 0], t: 1 }],
          },
        ],
      },
    ],
  });

  const enc = new TextEncoder();
  const fakePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const zipped = zipSync({
    'world.ldtk': enc.encode(ldtkWithTileset),
    'tiles/ruins.png': fakePngBytes,
  });

  // Inject deterministic PNG decoder returning a 32x16 image with teal tile #1 at x=16..31
  const mockDecodePng = async (): Promise<DecodedPngImage> => {
    const rgba = new Uint8Array(32 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 16; x < 32; x++) {
        const off = (y * 32 + x) * 4;
        rgba[off] = 20;
        rgba[off + 1] = 210;
        rgba[off + 2] = 190;
        rgba[off + 3] = 255;
      }
    }
    return { width: 32, height: 16, rgba };
  };

  const result = await loadExternalInteropFiles([{ name: 'pack.zip', bytes: zipped }], mockDecodePng);
  assert.equal(result.missingAssetPaths.length, 0);
  const slicedSprite = result.customSprites.find((s) => s.kind === 'rgba_b64');
  assert.ok(slicedSprite, 'Companion PNG in ZIP should produce lossless rgba_b64 custom sprite');
  const px = compileCustomSpriteToRgba(slicedSprite).rgba;
  assert.equal(px[0], 20);
  assert.equal(px[1], 210);
  assert.equal(px[2], 190);
});

test('MCP import_external_map imports LDtk/Tiled atomically and returns BFS reachability', () => {
  const mcp = new PixerMcpSession(OBSIDIAN_CITADEL_PROJECT);
  const sample = buildSampleLdtkSample();
  const jsonText = new TextDecoder('utf-8').decode(sample.bytes);

  const resp = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 42,
    method: 'tools/call',
    params: {
      name: 'import_external_map',
      arguments: {
        format: 'auto',
        jsonText,
        sourceName: sample.name,
        replaceWorldMap: true,
        wallExtrudeH: 24,
      },
    },
  });

  assert.ok(resp && !resp.error, 'MCP import_external_map should succeed without JSON-RPC error');
  const toolRes = resp.result as { isError: boolean; structuredContent: Record<string, unknown> };
  assert.equal(toolRes.isError, false);
  assert.equal(toolRes.structuredContent.ok, true);
  assert.equal(toolRes.structuredContent.rooms, 2);
  const reach = toolRes.structuredContent.reachability as { pass: boolean; softLockRisks: string[] };
  assert.equal(reach.pass, true);
  assert.equal(reach.softLockRisks.length, 0);
});
