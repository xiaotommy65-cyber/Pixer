import { unzipSync, zlibSync } from 'fflate';
import { uint8ToBase64 } from '../ecs/EcsCustomSpriteCompiler.ts';
import {
  encodeMinimalAsepriteBinary,
  parseAsepriteBinary,
  parseAsepriteJsonSheet,
} from './AsepriteParser.ts';
import {
  lookupCompanionImage,
  normalizeAssetPathKey,
  type DecodedPngImage,
  type InteropBundleFile,
  type InteropImportOptions,
  type InteropImportResult,
  type PngDecodeFn,
} from './InteropTypes.ts';
import { parseLdtkProject } from './LdtkImporter.ts';
import { parseTiledMap } from './TiledImporter.ts';

function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Auto-detects JSON format (LDtk vs Tiled vs Aseprite JSON Sprite Sheet) by inspecting root keys.
 */
export function detectJsonInteropFormat(jsonText: string): 'ldtk' | 'tiled' | 'aseprite_json' | null {
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (Array.isArray(obj.levels) && obj.defs && typeof obj.defs === 'object') {
      return 'ldtk';
    }
    if (Array.isArray(obj.layers) && typeof obj.tilewidth === 'number' && typeof obj.width === 'number') {
      return 'tiled';
    }
    if (obj.frames && (Array.isArray(obj.frames) || typeof obj.frames === 'object')) {
      return 'aseprite_json';
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pure, DOM-free multi-file & `.zip` bundle loader.
 * Expands `.zip` archives with `fflate.unzipSync`, decodes companion `.png` assets via the injected
 * `decodePng` callback (provided by browser UI or test harness), auto-detects `.ase`/`.aseprite`/`.ldtk`/`.tmj`/`.json`,
 * and returns a normalized `InteropImportResult`.
 */
export async function loadExternalInteropFiles(
  files: readonly InteropBundleFile[],
  decodePng?: PngDecodeFn,
  opts: InteropImportOptions = {},
): Promise<InteropImportResult> {
  if (files.length === 0) {
    throw new Error('請至少選擇一個外部專案檔 (.aseprite / .ldtk / .tmj / .json / .zip)');
  }

  const expanded: InteropBundleFile[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      const entries = unzipSync(f.bytes);
      for (const [entryPath, entryBytes] of Object.entries(entries)) {
        if (entryPath.endsWith('/') || entryPath.startsWith('__MACOSX/')) continue;
        expanded.push({ name: entryPath, bytes: entryBytes });
      }
    } else {
      expanded.push(f);
    }
  }

  const assetsByPath = new Map<string, DecodedPngImage>();
  if (decodePng) {
    for (const f of expanded) {
      if (f.name.toLowerCase().endsWith('.png')) {
        const decoded = await decodePng(f.bytes, f.name);
        if (decoded) {
          const norm = normalizeAssetPathKey(f.name);
          assetsByPath.set(norm, decoded);
          const base = norm.split('/').pop();
          if (base && !assetsByPath.has(base)) {
            assetsByPath.set(base, decoded);
          }
        }
      }
    }
  }

  // Priority 1: Binary Aseprite (.ase / .aseprite)
  const aseFile = expanded.find((f) => /\.(ase|aseprite)$/i.test(f.name));
  if (aseFile) {
    return parseAsepriteBinary(aseFile.bytes, aseFile.name.split('/').pop() ?? aseFile.name);
  }

  // Priority 2: LDtk (.ldtk)
  const ldtkFile = expanded.find((f) => /\.ldtk$/i.test(f.name));
  if (ldtkFile) {
    return parseLdtkProject(decodeUtf8(ldtkFile.bytes), assetsByPath, ldtkFile.name.split('/').pop() ?? ldtkFile.name, opts);
  }

  // Priority 3: Tiled (.tmj)
  const tmjFile = expanded.find((f) => /\.tmj$/i.test(f.name));
  if (tmjFile) {
    return parseTiledMap(decodeUtf8(tmjFile.bytes), assetsByPath, tmjFile.name.split('/').pop() ?? tmjFile.name, opts);
  }

  // Priority 4: Generic .json (auto-detect LDtk / Tiled / Aseprite JSON Sheet)
  const jsonFile = expanded.find((f) => /\.json$/i.test(f.name));
  if (jsonFile) {
    const text = decodeUtf8(jsonFile.bytes);
    const fmt = detectJsonInteropFormat(text);
    const shortName = jsonFile.name.split('/').pop() ?? jsonFile.name;
    if (fmt === 'ldtk') {
      return parseLdtkProject(text, assetsByPath, shortName, opts);
    }
    if (fmt === 'tiled') {
      return parseTiledMap(text, assetsByPath, shortName, opts);
    }
    if (fmt === 'aseprite_json') {
      let imgRef: string | undefined;
      try {
        const parsed = JSON.parse(text) as { meta?: { image?: string } };
        imgRef = parsed.meta?.image;
      } catch {
        imgRef = undefined;
      }
      const companion =
        lookupCompanionImage(imgRef, assetsByPath) ??
        Array.from(assetsByPath.values())[0] ??
        null;
      return parseAsepriteJsonSheet(text, companion, shortName);
    }
    throw new Error(`無法辨識 JSON 格式「${shortName}」，請確認為 LDtk、Tiled (.tmj/.json) 或 Aseprite JSON Sprite Sheet`);
  }

  throw new Error('未在選取檔案或 ZIP 壓縮包中找到 .aseprite、.ldtk、.tmj 或 .json 檔案');
}

/**
 * Helper: paints a crisp 32x32 Crystal Knight pixel sprite into an RGBA buffer for the built-in Aseprite sample.
 */
function paintCrystalKnightFrame(bobY: number, bladeGlow: boolean): Uint8Array {
  const w = 32;
  const h = 32;
  const rgba = new Uint8Array(w * h * 4);
  const put = (x: number, y: number, r: number, g: number, b: number, a = 255): void => {
    const yy = y + bobY;
    if (x < 0 || x >= w || yy < 0 || yy >= h) return;
    const off = (yy * w + x) * 4;
    rgba[off] = r;
    rgba[off + 1] = g;
    rgba[off + 2] = b;
    rgba[off + 3] = a;
  };
  const rect = (x0: number, y0: number, rw: number, rh: number, r: number, g: number, b: number): void => {
    for (let y = y0; y < y0 + rh; y++) {
      for (let x = x0; x < x0 + rw; x++) put(x, y, r, g, b);
    }
  };

  // Dark outline silhouette
  rect(10, 4, 12, 10, 15, 23, 42);
  rect(8, 13, 16, 11, 15, 23, 42);
  rect(10, 23, 4, 6, 15, 23, 42);
  rect(18, 23, 4, 6, 15, 23, 42);

  // Helm crest (sapphire & gold)
  rect(13, 2, 6, 3, 250, 204, 21);
  rect(11, 5, 10, 8, 56, 189, 248);
  rect(12, 6, 8, 3, 186, 230, 253);
  // Visor & glowing cyan eyes
  rect(12, 9, 8, 3, 15, 23, 42);
  put(14, 10, 56, 255, 240);
  put(17, 10, 56, 255, 240);

  // Armor torso + crystal core
  rect(9, 14, 14, 9, 30, 64, 175);
  rect(11, 15, 10, 7, 59, 130, 246);
  rect(14, 16, 4, 4, 254, 240, 138);
  put(15, 17, 255, 255, 255);

  // Boots
  rect(11, 24, 3, 4, 51, 65, 85);
  rect(18, 24, 3, 4, 51, 65, 85);

  // Crystal blade on right side
  const br = bladeGlow ? 165 : 56;
  const bg = bladeGlow ? 243 : 189;
  const bb = 252;
  rect(24, 7, 3, 13, 15, 23, 42);
  rect(25, 8, 1, 11, br, bg, bb);
  rect(23, 19, 5, 2, 250, 204, 21);
  rect(25, 21, 1, 3, 120, 53, 15);
  if (bladeGlow) {
    put(25, 6, 254, 249, 195);
    put(24, 10, 224, 242, 254);
    put(26, 13, 224, 242, 254);
  }
  return rgba;
}

/**
 * Built-in 1-click spec-compliant Aseprite (`.aseprite`) binary sample:
 * 4-frame animated 32×32 Crystal Knight with Zlib-compressed Cel chunks (`0x2005`) and `"idle"` tag.
 */
export function buildSampleAsepriteFile(): InteropBundleFile {
  const bytes = encodeMinimalAsepriteBinary({
    width: 32,
    height: 32,
    frames: [
      paintCrystalKnightFrame(0, false),
      paintCrystalKnightFrame(1, false),
      paintCrystalKnightFrame(1, true),
      paintCrystalKnightFrame(0, true),
    ],
    layerName: 'CrystalKnight',
    tagName: 'idle',
  });
  return { name: 'crystal_knight_sample.aseprite', bytes };
}

/**
 * Built-in 1-click spec-compliant LDtk (`.ldtk`) 2-room sample:
 * Sunlit Courtyard -> Key Chest -> Astral Chamber -> Boss, guaranteed 0 soft-locks.
 */
export function buildSampleLdtkSample(): InteropBundleFile {
  const cols = 16;
  const rows = 12;
  const makeWallCsv = (openEast: boolean, openWest: boolean, interiorPillars: boolean): number[] => {
    const csv = new Array<number>(cols * rows).fill(0);
    for (let c = 0; c < cols; c++) {
      csv[c] = 1;
      csv[(rows - 1) * cols + c] = 1;
    }
    for (let r = 0; r < rows; r++) {
      csv[r * cols] = 1;
      csv[r * cols + (cols - 1)] = 1;
    }
    if (openEast) {
      csv[5 * cols + (cols - 1)] = 0;
      csv[6 * cols + (cols - 1)] = 0;
    }
    if (openWest) {
      csv[5 * cols] = 0;
      csv[6 * cols] = 0;
    }
    if (interiorPillars) {
      csv[3 * cols + 5] = 1;
      csv[3 * cols + 10] = 1;
      csv[8 * cols + 5] = 1;
      csv[8 * cols + 10] = 1;
      // Add mossy floor patches (value 2)
      csv[5 * cols + 4] = 2;
      csv[5 * cols + 5] = 2;
      csv[6 * cols + 4] = 2;
      csv[6 * cols + 5] = 2;
    }
    return csv;
  };

  const ldtkObj = {
    jsonVersion: '1.5.3',
    defaultGridSize: 32,
    defs: {
      tilesets: [],
      layers: [
        {
          uid: 1,
          identifier: 'Walls',
          type: 'IntGrid',
          intGridValues: [
            { value: 1, identifier: 'StoneWall', color: '#475569' },
            { value: 2, identifier: 'MossFloor', color: '#15803d' },
          ],
        },
      ],
    },
    levels: [
      {
        identifier: 'Sunlit_Courtyard',
        iid: 'lvl_courtyard',
        uid: 101,
        pxWid: cols * 32,
        pxHei: rows * 32,
        worldX: 0,
        worldY: 0,
        bgColor: '#0c1628',
        __neighbours: [{ levelIid: 'lvl_chamber', dir: 'e' }],
        layerInstances: [
          {
            __identifier: 'Entities',
            __type: 'Entities',
            __cWid: cols,
            __cHei: rows,
            __gridSize: 32,
            entityInstances: [
              { __identifier: 'Hero', px: [96, 176], width: 32, height: 32, fieldInstances: [] },
              {
                __identifier: 'Chest',
                px: [224, 96],
                width: 32,
                height: 32,
                fieldInstances: [{ __identifier: 'grantGlobal', __value: 'has_sun_key' }],
              },
              { __identifier: 'Torch', px: [128, 96], width: 32, height: 32, fieldInstances: [] },
              { __identifier: 'Torch', px: [384, 256], width: 32, height: 32, fieldInstances: [] },
              { __identifier: 'Sentinel', px: [320, 192], width: 32, height: 32, fieldInstances: [] },
              {
                __identifier: 'Portal',
                px: [14 * 32, 5 * 32],
                width: 32,
                height: 32,
                fieldInstances: [
                  { __identifier: 'targetRoom', __value: 'Astral_Chamber' },
                  { __identifier: 'targetX', __value: 64 },
                  { __identifier: 'targetY', __value: 176 },
                  { __identifier: 'requiresGlobal', __value: 'has_sun_key' },
                ],
              },
            ],
          },
          {
            __identifier: 'Walls',
            __type: 'IntGrid',
            __cWid: cols,
            __cHei: rows,
            __gridSize: 32,
            layerDefUid: 1,
            intGridCsv: makeWallCsv(true, false, true),
          },
        ],
      },
      {
        identifier: 'Astral_Chamber',
        iid: 'lvl_chamber',
        uid: 102,
        pxWid: cols * 32,
        pxHei: rows * 32,
        worldX: cols * 32,
        worldY: 0,
        bgColor: '#131026',
        __neighbours: [{ levelIid: 'lvl_courtyard', dir: 'w' }],
        layerInstances: [
          {
            __identifier: 'Entities',
            __type: 'Entities',
            __cWid: cols,
            __cHei: rows,
            __gridSize: 32,
            entityInstances: [
              { __identifier: 'Boss', px: [320, 160], width: 48, height: 48, fieldInstances: [{ __identifier: 'hp', __value: 10 }] },
              { __identifier: 'Torch', px: [160, 128], width: 32, height: 32, fieldInstances: [{ __identifier: 'color', __value: '#38bdf8' }] },
              { __identifier: 'Torch', px: [384, 128], width: 32, height: 32, fieldInstances: [{ __identifier: 'color', __value: '#a855f7' }] },
            ],
          },
          {
            __identifier: 'Walls',
            __type: 'IntGrid',
            __cWid: cols,
            __cHei: rows,
            __gridSize: 32,
            layerDefUid: 1,
            intGridCsv: makeWallCsv(false, true, false),
          },
        ],
      },
    ],
  };

  return {
    name: 'sunlit_ruins_sample.ldtk',
    bytes: encodeUtf8(JSON.stringify(ldtkObj, null, 2)),
  };
}

/**
 * Built-in 1-click spec-compliant Tiled (`.tmj`) sample with genuine Base64 + Zlib compressed layers.
 */
export function buildSampleTiledZlibSample(): InteropBundleFile {
  const cols = 16;
  const rows = 12;

  const encodeZlibLayer = (gids: number[]): string => {
    const buf = new Uint8Array(gids.length * 4);
    const dv = new DataView(buf.buffer);
    for (let i = 0; i < gids.length; i++) {
      dv.setUint32(i * 4, gids[i] >>> 0, true);
    }
    return uint8ToBase64(zlibSync(buf, { level: 6 }));
  };

  const groundGids = new Array<number>(cols * rows).fill(1);
  const wallGids = new Array<number>(cols * rows).fill(0);
  const decorGids = new Array<number>(cols * rows).fill(0);

  for (let c = 0; c < cols; c++) {
    wallGids[c] = 3;
    wallGids[(rows - 1) * cols + c] = 3;
  }
  for (let r = 0; r < rows; r++) {
    wallGids[r * cols] = 3;
    wallGids[r * cols + (cols - 1)] = 3;
  }
  // Brass floor runway in center
  for (let c = 3; c <= 12; c++) {
    groundGids[5 * cols + c] = 2;
    groundGids[6 * cols + c] = 2;
  }
  // Inner clockwork pillars
  wallGids[3 * cols + 4] = 4;
  wallGids[3 * cols + 11] = 4;
  wallGids[8 * cols + 4] = 4;
  wallGids[8 * cols + 11] = 4;
  // Crystal conduits
  decorGids[2 * cols + 7] = 5;
  decorGids[2 * cols + 8] = 5;

  const tmjObj = {
    compressionlevel: -1,
    height: rows,
    width: cols,
    tileheight: 32,
    tilewidth: 32,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.0',
    type: 'map',
    version: '1.10',
    backgroundcolor: '#101524',
    tilesets: [
      {
        firstgid: 1,
        name: 'clockwork_atelier',
        tilewidth: 32,
        tileheight: 32,
        tilecount: 5,
        columns: 5,
        tiles: [
          { id: 0, class: 'stone_floor', properties: [{ name: 'color', value: '#2d3748' }] },
          { id: 1, class: 'brass_deck', properties: [{ name: 'color', value: '#b45309' }] },
          { id: 2, class: 'stone_wall', properties: [{ name: 'solid', value: true }, { name: 'extrudeH', value: 26 }, { name: 'color', value: '#475569' }] },
          { id: 3, class: 'brass_pillar', properties: [{ name: 'solid', value: true }, { name: 'extrudeH', value: 28 }, { name: 'color', value: '#92400e' }] },
          { id: 4, class: 'astral_crystal', properties: [{ name: 'color', value: '#38bdf8' }] },
        ],
      },
    ],
    layers: [
      {
        id: 1,
        name: 'Ground',
        type: 'tilelayer',
        width: cols,
        height: rows,
        encoding: 'base64',
        compression: 'zlib',
        data: encodeZlibLayer(groundGids),
      },
      {
        id: 2,
        name: 'Walls',
        type: 'tilelayer',
        width: cols,
        height: rows,
        encoding: 'base64',
        compression: 'zlib',
        data: encodeZlibLayer(wallGids),
      },
      {
        id: 3,
        name: 'Decor',
        type: 'tilelayer',
        width: cols,
        height: rows,
        encoding: 'base64',
        compression: 'zlib',
        data: encodeZlibLayer(decorGids),
      },
      {
        id: 4,
        name: 'Objects',
        type: 'objectgroup',
        objects: [
          { id: 1, name: 'HeroSpawn', type: 'Hero', x: 96, y: 176, width: 32, height: 32 },
          { id: 2, name: 'ClockworkLampA', type: 'Light', x: 192, y: 96, width: 32, height: 32, properties: [{ name: 'color', value: '#fbbf24' }] },
          { id: 3, name: 'ClockworkLampB', type: 'Light', x: 288, y: 96, width: 32, height: 32, properties: [{ name: 'color', value: '#38bdf8' }] },
          { id: 4, name: 'ObservatorySwitch', type: 'Switch', x: 256, y: 224, width: 32, height: 32, properties: [{ name: 'global', value: 'observatory_online' }] },
          { id: 5, name: 'BrassAutomaton', type: 'Enemy', x: 384, y: 176, width: 32, height: 32, properties: [{ name: 'hp', value: 5 }] },
        ],
      },
    ],
  };

  return {
    name: 'clockwork_observatory_zlib.tmj',
    bytes: encodeUtf8(JSON.stringify(tmjObj, null, 2)),
  };
}
