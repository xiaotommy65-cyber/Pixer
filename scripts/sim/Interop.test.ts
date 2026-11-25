import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync, zipSync } from 'fflate';
import { ATLAS_SIZE, TextureAtlas } from '../../src/assets/TextureAtlas.ts';
import { analyzeWorldMapReachability } from '../../src/core/ai/EcsSpatialOracle.ts';
import { PixerMcpSession } from '../../src/core/ai/PixerMcpProtocol.ts';
import { EcsCartridgeRuntime } from '../../src/core/ecs/EcsCartridgeRuntime.ts';
import {
  compileCustomSpriteToRgba,
  decodeZlibB64ToRgba,
  encodeRgbaToZlibB64,
  syncProjectCustomSpritesToAtlas,
  uint8ToBase64,
} from '../../src/core/ecs/EcsCustomSpriteCompiler.ts';
import { cloneEcsProject, validateCustomSpriteDef } from '../../src/core/ecs/EcsProjectSchema.ts';
import { EcsStudioSession } from '../../src/core/ecs/EcsStudioSession.ts';
import {
  PIXEL_FORGE_PALETTES,
  applyRgbaOutline,
  buildAssetPackInstallCommands,
  buildBuiltinStarterPack,
  buildInteropStudioCommands,
  buildPixelForgeCommitCommands,
  buildSampleAsepriteFile,
  buildSampleLdtkSample,
  buildSampleTiledZlibSample,
  cropOpaqueBoundsRgba,
  detectPixelBlockSize,
  downscaleToPixelGridRgba,
  encodeMinimalAsepriteBinary,
  exportProjectAsAssetPack,
  forgeImageToCustomSprites,
  loadExternalInteropFiles,
  parseAsepriteBinary,
  parseAsepriteJsonSheet,
  parseTiledMap,
  quantizeRgbaOklab,
  stripEdgeBackgroundRgba,
  validateAssetPackManifest,
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

test('256x256 & 160x192 high-res portrait sprites validate, encode/decode zlib-b64, and pack into TextureAtlas', () => {
  const w = 160;
  const h = 192;
  const portraitRgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const off = (y * w + x) * 4;
      portraitRgba[off] = (x * 2) & 255;
      portraitRgba[off + 1] = (y * 2) & 255;
      portraitRgba[off + 2] = 180;
      portraitRgba[off + 3] = 255;
    }
  }
  const b64 = encodeRgbaToZlibB64(portraitRgba);
  const portraitDef = {
    id: 'vn_heroine_portrait',
    name: 'Heroine 160x192',
    width: w,
    height: h,
    kind: 'rgba_b64' as const,
    rgbaB64: b64,
  };
  assert.deepEqual(validateCustomSpriteDef(portraitDef, 'portrait'), []);

  // Max ceiling 256x256 is valid, while 257x256 is rejected
  const maxDef = {
    id: 'boss_256',
    name: 'Boss 256',
    width: 256,
    height: 256,
    kind: 'rgba_b64' as const,
    rgbaB64: encodeRgbaToZlibB64(new Uint8Array(256 * 256 * 4)),
  };
  assert.deepEqual(validateCustomSpriteDef(maxDef, 'boss'), []);
  const oversizedErrors = validateCustomSpriteDef({ ...maxDef, width: 257 }, 'oversized');
  assert.ok(oversizedErrors.length > 0 && oversizedErrors[0].includes('8..256'));

  const decoded = decodeZlibB64ToRgba(b64, w * h * 4);
  assert.deepEqual(decoded.slice(0, 12), portraitRgba.slice(0, 12));

  const atlas = new TextureAtlas();
  const project = cloneEcsProject(OBSIDIAN_CITADEL_PROJECT);
  project.customSprites = { ...(project.customSprites ?? {}), [portraitDef.id]: portraitDef };
  const synced = syncProjectCustomSpritesToAtlas(atlas, project);
  assert.ok(synced.has('vn_heroine_portrait'));
  assert.equal(atlas.hasSprite('vn_heroine_portrait'), true, '160x192 custom sprite must register into TextureAtlas');
  const rect = atlas.getRect('vn_heroine_portrait');
  assert.equal(rect.w, 160);
  assert.equal(rect.h, 192);
});

test('PixelForgeProcessor strips backgrounds, crops, detects k*k grid, quantizes Oklab, outlines, and slices sprite sheets', () => {
  // Build a 64x64 synthetic 4x-upscaled (16x16 logical pixel grid) sprite over a bright magenta backdrop
  const sw = 64;
  const sh = 64;
  const src = new Uint8Array(sw * sh * 4);
  const blockSize = 4;
  for (let ly = 0; ly < 16; ly++) {
    for (let lx = 0; lx < 16; lx++) {
      const inBody = lx >= 3 && lx <= 12 && ly >= 2 && ly <= 13;
      const r = inBody ? (lx < 8 ? 220 : 72) + (((lx + ly) & 1) ? 18 : -18) : 255;
      const g = inBody ? (ly < 8 ? 160 : 95) + (((lx ^ ly) & 1) ? 14 : -14) : 0;
      const b = inBody ? 110 + ((ly & 1) ? 12 : -12) : 255;
      for (let sy = 0; sy < blockSize; sy++) {
        for (let sx = 0; sx < blockSize; sx++) {
          const x = lx * blockSize + sx;
          const y = ly * blockSize + sy;
          const off = (y * sw + x) * 4;
          src[off] = r;
          src[off + 1] = g;
          src[off + 2] = b;
          src[off + 3] = 255;
        }
      }
    }
  }

  const stripped = stripEdgeBackgroundRgba(src, sw, sh, 40);
  assert.equal(stripped[3], 0, 'Corner backdrop pixel should become transparent');
  assert.equal(stripped[(20 * sw + 20) * 4 + 3], 255, 'Interior subject pixel should stay opaque');

  const cropped = cropOpaqueBoundsRgba(stripped, sw, sh, 0);
  assert.equal(cropped.cropped, true);
  assert.equal(cropped.width, 40);
  assert.equal(cropped.height, 48);

  const detected = detectPixelBlockSize(stripped, sw, sh);
  assert.equal(detected, 4, 'Should detect 4x upscaled pixel grid');

  const downscaled = downscaleToPixelGridRgba(cropped.rgba, cropped.width, cropped.height, 16, 16, 'grid_majority', true);
  for (let i = 3; i < downscaled.length; i += 4) {
    assert.ok(downscaled[i] === 0 || downscaled[i] === 255, 'grid_majority must enforce hard alpha cutout (0 or 255)');
  }

  const horrorPalette = PIXEL_FORGE_PALETTES.find((p) => p.id === 'asylum_horror')!;
  const locked = quantizeRgbaOklab(downscaled, 16, 16, {
    colorMode: 'palette_lock',
    paletteId: 'asylum_horror',
    dither: false,
  });
  const allowedRgb = new Set(
    horrorPalette.colors.map((hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }),
  );
  let opaqueLockedCount = 0;
  for (let i = 0; i < 16 * 16; i++) {
    const off = i * 4;
    if (locked[off + 3] === 255) {
      opaqueLockedCount++;
      assert.ok(
        allowedRgb.has(`${locked[off]},${locked[off + 1]},${locked[off + 2]}`),
        'palette_lock output pixel must strictly belong to asylum_horror palette',
      );
    }
  }
  assert.ok(opaqueLockedCount > 0);

  const kmeans = quantizeRgbaOklab(downscaled, 16, 16, { colorMode: 'adaptive_kmeans', maxColors: 4 });
  assert.equal(kmeans.length, 16 * 16 * 4);

  const outlined = applyRgbaOutline(locked, 16, 16, '#090b12');
  assert.equal(outlined[(1 * 16 + 8) * 4 + 3] >= 0, true);

  // Test 2x2 sprite sheet slicing -> 4 sprites + AnimationStateMachineDef + atomic commit + 1-step undo
  const sheetW = 32;
  const sheetH = 32;
  const sheetRgba = new Uint8Array(sheetW * sheetH * 4);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      for (let y = 4; y < 12; y++) {
        for (let x = 4; x < 12; x++) {
          const px = c * 16 + x;
          const py = r * 16 + y;
          const off = (py * sheetW + px) * 4;
          sheetRgba[off] = 60 + c * 80;
          sheetRgba[off + 1] = 120 + r * 60;
          sheetRgba[off + 2] = 200;
          sheetRgba[off + 3] = 255;
        }
      }
    }
  }
  const forged = forgeImageToCustomSprites(
    { id: 'ghoul_sheet', name: 'Ghoul', rgba: sheetRgba, width: sheetW, height: sheetH },
    {
      id: 'ghoul_sheet',
      targetWidth: 16,
      targetHeight: 16,
      colorMode: 'palette_lock',
      paletteId: 'cozy_vn',
      outlineHex: '#090b12',
      stripBackground: false,
      sheetCols: 2,
      sheetRows: 2,
    },
  );
  assert.equal(forged.sprites.length, 4);
  assert.equal(forged.animations.length, 1);
  assert.equal(forged.animations[0].clips.length, 2);

  const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
  const initialSpriteCount = Object.keys(session.getProject().customSprites ?? {}).length;
  const cmds = buildPixelForgeCommitCommands(forged, session.getProject(), {
    registerPrefab: true,
    registerTileLayer: 'decor',
  });
  const batchRes = session.dispatchBatch(cmds, 'Forge 2x2 Ghoul Sheet');
  assert.equal(batchRes.ok, true);
  assert.ok(session.getProject().customSprites?.ghoul_sheet_f0);
  assert.ok(session.getProject().prefabs.prefab_ghoul_sheet_f0);
  assert.ok(session.getProject().animations.some((a) => a.id === 'anim_ghoul_sheet'));

  const undoRes = session.undo();
  assert.equal(undoRes.ok, true);
  assert.equal(Object.keys(session.getProject().customSprites ?? {}).length, initialSpriteCount);
});

test('PixerAssetPack validates manifests, installs horror/vn/dungeon starter packs atomically, round-trips export & MCP tools', () => {
  const bad = validateAssetPackManifest({ schemaVersion: 99, id: 'INVALID ID!' });
  assert.equal(bad.ok, false);

  for (const genre of ['horror', 'visual_novel', 'dungeon'] as const) {
    const pack = buildBuiltinStarterPack(genre);
    const valid = validateAssetPackManifest(pack);
    assert.equal(valid.ok, true, `Starter pack '${genre}' must pass schema validation`);
    if (genre === 'horror' || genre === 'visual_novel') {
      const portrait = pack.sprites.find((s) => s.width === 160 && s.height === 192);
      assert.ok(portrait, `Starter pack '${genre}' should include a 160x192 portrait sprite`);
    }

    const session = new EcsStudioSession(OBSIDIAN_CITADEL_PROJECT);
    const beforePrefabs = Object.keys(session.getProject().prefabs).length;
    const cmds = buildAssetPackInstallCommands(pack, session.getProject(), { applyAtmosphere: true });
    const installRes = session.dispatchBatch(cmds, `Install ${genre}`);
    assert.equal(installRes.ok, true, `Install '${genre}' pack must succeed atomically`);
    assert.ok(Object.keys(session.getProject().prefabs).length > beforePrefabs);
    const firstTile = pack.tileDefs?.[0];
    if (firstTile) {
      assert.ok(
        session.getProject().worldMap?.tileDefs?.some((t) => t.sprite === firstTile.sprite),
        `Starter pack '${genre}' tile sprite must exist in worldMap.tileDefs`,
      );
    }

    const exported = exportProjectAsAssetPack(session.getProject(), {
      id: `exported-${genre}`,
      genre,
    });
    const revalid = validateAssetPackManifest(exported);
    assert.equal(revalid.ok, true, `Exported pack for '${genre}' must round-trip validation`);

    // 1-step Undo must revert the entire pack install
    const undoRes = session.undo();
    assert.equal(undoRes.ok, true);
    assert.equal(Object.keys(session.getProject().prefabs).length, beforePrefabs);
  }

  // Verify MCP tools install_asset_pack & export_asset_pack
  const mcp = new PixerMcpSession(OBSIDIAN_CITADEL_PROJECT);
  const installResp = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 101,
    method: 'tools/call',
    params: {
      name: 'install_asset_pack',
      arguments: { builtinGenre: 'horror', applyAtmosphere: true },
    },
  });
  assert.ok(installResp && !installResp.error);
  const installOut = installResp.result as { isError: boolean; structuredContent: Record<string, unknown> };
  assert.equal(installOut.isError, false);
  assert.equal(installOut.structuredContent.ok, true);
  assert.equal(installOut.structuredContent.genre, 'horror');
  assert.equal(installOut.structuredContent.appliedAtmosphere, true);

  const exportResp = mcp.handleRequest({
    jsonrpc: '2.0',
    id: 102,
    method: 'tools/call',
    params: {
      name: 'export_asset_pack',
      arguments: { id: 'mcp-horror-export', genre: 'horror' },
    },
  });
  assert.ok(exportResp && !exportResp.error);
  const exportOut = exportResp.result as { isError: boolean; structuredContent: { ok: boolean; pack: unknown } };
  assert.equal(exportOut.isError, false);
  assert.equal(exportOut.structuredContent.ok, true);
  assert.equal(validateAssetPackManifest(exportOut.structuredContent.pack).ok, true);
});
