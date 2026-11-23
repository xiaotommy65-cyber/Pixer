import { Gunzip, Unzlib } from 'fflate';
import { base64ToUint8, encodeRgbaToZlibB64 } from '../ecs/EcsCustomSpriteCompiler.ts';
import type {
  EcsCustomSpriteDef,
  EcsEntityInitDef,
  EcsPrefabDef,
  EcsProceduralSpritePattern,
} from '../ecs/EcsProjectSchema.ts';
import type {
  EcsMapInteractionRule,
  EcsMapLayerName,
  EcsMapPortalDef,
  EcsMapRoomDef,
  EcsTileDef,
  EcsTopDownAiProfile,
} from '../ecs/EcsTilemapTypes.ts';
import {
  fitRgbaToSpriteBounds,
  lookupCompanionImage,
  sanitizeInteropId,
  sliceRgbaRect,
  type DecodedPngImage,
  type InteropImportOptions,
  type InteropImportResult,
} from './InteropTypes.ts';

const TILED_GID_MASK = 0x1fffffff;

interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

interface TiledTileMeta {
  id: number;
  type?: string;
  class?: string;
  properties?: TiledProperty[];
}

interface TiledTileset {
  firstgid: number;
  name?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
  margin?: number;
  spacing?: number;
  tiles?: TiledTileMeta[];
}

interface TiledObject {
  id?: number;
  name?: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  properties?: TiledProperty[];
}

interface TiledLayer {
  id?: number;
  name: string;
  type: 'tilelayer' | 'objectgroup' | 'group' | string;
  visible?: boolean;
  width?: number;
  height?: number;
  encoding?: 'csv' | 'base64' | string;
  compression?: '' | 'zlib' | 'gzip' | string;
  data?: number[] | string;
  objects?: TiledObject[];
  layers?: TiledLayer[];
  properties?: TiledProperty[];
}

interface TiledMapRoot {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  backgroundcolor?: string;
  layers?: TiledLayer[];
  tilesets?: TiledTileset[];
  properties?: TiledProperty[];
}

function getTiledProp(props: readonly TiledProperty[] | undefined, names: readonly string[]): unknown {
  if (!props) return undefined;
  for (const p of props) {
    if (names.includes(p.name.toLowerCase())) return p.value;
  }
  return undefined;
}

const MAX_TILED_LAYER_BYTES = 16 * 1024 * 1024;

function decompressBounded(rawBytes: Uint8Array, kind: 'zlib' | 'gzip', maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onData = (chunk: Uint8Array): void => {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`Tiled 圖層解壓資料超過安全上限 (${maxBytes / (1024 * 1024)} MB)`);
    }
    chunks.push(chunk);
  };
  const stream = kind === 'zlib' ? new Unzlib(onData) : new Gunzip(onData);
  stream.push(rawBytes, true);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * Decodes Tiled `tilelayer.data` supporting CSV arrays AND Base64 raw / zlib / gzip streams via `fflate`
 * with strict decompressed size bounds.
 */
export function decodeTiledLayerData(layer: TiledLayer): Uint32Array {
  if (Array.isArray(layer.data)) {
    const out = new Uint32Array(layer.data.length);
    for (let i = 0; i < layer.data.length; i++) {
      out[i] = (Number(layer.data[i]) >>> 0) & TILED_GID_MASK;
    }
    return out;
  }
  if (typeof layer.data === 'string' && layer.encoding === 'base64') {
    const rawBytes = base64ToUint8(layer.data.trim());
    let decodedBytes: Uint8Array;
    if (layer.compression === 'zlib') {
      decodedBytes = decompressBounded(rawBytes, 'zlib', MAX_TILED_LAYER_BYTES);
    } else if (layer.compression === 'gzip') {
      decodedBytes = decompressBounded(rawBytes, 'gzip', MAX_TILED_LAYER_BYTES);
    } else if (!layer.compression || layer.compression === '') {
      if (rawBytes.byteLength > MAX_TILED_LAYER_BYTES) {
        throw new Error(`Tiled 圖層資料超過安全上限 (${MAX_TILED_LAYER_BYTES / (1024 * 1024)} MB)`);
      }
      decodedBytes = rawBytes;
    } else {
      throw new Error(`不支援的 Tiled 圖層壓縮格式: ${layer.compression}（支援 uncompressed / zlib / gzip）`);
    }
    const count = Math.floor(decodedBytes.byteLength / 4);
    const dv = new DataView(decodedBytes.buffer, decodedBytes.byteOffset, decodedBytes.byteLength);
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = dv.getUint32(i * 4, true) & TILED_GID_MASK;
    }
    return out;
  }
  return new Uint32Array(0);
}

function classifyTiledLayer(layer: TiledLayer): EcsMapLayerName {
  const explicit = getTiledProp(layer.properties, ['pixerlayer', 'layer']);
  if (explicit === 'ground' || explicit === 'wall' || explicit === 'decor') return explicit;
  const lower = layer.name.toLowerCase();
  if (/wall|solid|collision|cliff|block|barrier|gate/.test(lower)) return 'wall';
  if (/decor|prop|overlay|detail|hazard|spike|rune/.test(lower)) return 'decor';
  return 'ground';
}

function flattenTiledLayers(layers: readonly TiledLayer[] | undefined, out: TiledLayer[] = []): TiledLayer[] {
  if (!layers) return out;
  for (const l of layers) {
    if (l.visible === false) continue;
    if (l.type === 'group' && Array.isArray(l.layers)) {
      flattenTiledLayers(l.layers, out);
    } else {
      out.push(l);
    }
  }
  return out;
}

function pickTiledProcedural(name: string, layer: EcsMapLayerName, localId: number): {
  pattern: EcsProceduralSpritePattern;
  baseHex: string;
  secondaryHex: string;
  accentHex: string;
} {
  const lower = name.toLowerCase();
  if (/lava|magma|hazard|spike|fire/.test(lower)) {
    return { pattern: 'circuit', baseHex: '#991b1b', secondaryHex: '#450a0a', accentHex: '#fb923c' };
  }
  if (/water|river|canal/.test(lower)) {
    return { pattern: 'water', baseHex: '#0284c7', secondaryHex: '#0c4a6e', accentHex: '#7dd3fc' };
  }
  if (/brass|gear|clock|metal|copper|gate/.test(lower)) {
    return { pattern: 'metal_panel', baseHex: '#b45309', secondaryHex: '#451a03', accentHex: '#fde047' };
  }
  if (/wood|timber|deck|plank/.test(lower)) {
    return { pattern: 'planks', baseHex: '#78350f', secondaryHex: '#451a03', accentHex: '#d97706' };
  }
  if (/moss|grass|garden|forest/.test(lower)) {
    return { pattern: 'foliage', baseHex: '#15803d', secondaryHex: '#14532d', accentHex: '#86efac' };
  }
  if (layer === 'wall') {
    const palette = ['#475569', '#57534e', '#3b4a6b', '#6d4c41'];
    return {
      pattern: 'bricks',
      baseHex: palette[localId % palette.length],
      secondaryHex: '#1e293b',
      accentHex: '#cbd5e1',
    };
  }
  if (layer === 'decor') {
    return { pattern: 'crystal', baseHex: '#38bdf8', secondaryHex: '#1e3a5f', accentHex: '#e0f2fe' };
  }
  const floorPalette = ['#334155', '#3f3f46', '#293548', '#364152'];
  return {
    pattern: localId % 2 === 0 ? 'cobble' : 'rune_floor',
    baseHex: floorPalette[localId % floorPalette.length],
    secondaryHex: '#18181b',
    accentHex: '#94a3b8',
  };
}

/**
 * Pure, DOM-free Tiled (`.tmj` / `.json`) importer.
 * Supports CSV and Base64 (`uncompressed`, `zlib`, `gzip` via `fflate`), GID flip flag masking,
 * companion tileset PNG slicing (with deterministic Oklab+Bayer PBR fallback), and `objectgroup` entities.
 */
export function parseTiledMap(
  jsonText: string,
  assetsByPath: ReadonlyMap<string, DecodedPngImage>,
  sourceName: string,
  opts: InteropImportOptions = {},
): InteropImportResult {
  const raw = JSON.parse(jsonText) as TiledMapRoot;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers) || !raw.width || !raw.height) {
    throw new Error('非有效的 Tiled JSON (.tmj) 地圖（缺少 width/height/layers 欄位）');
  }

  const wallExtrudeH = Math.max(8, Math.min(48, Math.round(opts.wallExtrudeH ?? 24)));
  const prefix = sanitizeInteropId(opts.idPrefix ?? sourceName, 'tiled', 16);
  const warnings: string[] = [];
  const missingSet = new Set<string>();

  const cols = Math.max(8, Math.min(64, Math.floor(raw.width)));
  const rows = Math.max(8, Math.min(64, Math.floor(raw.height)));
  if (raw.width > 64 || raw.height > 64) {
    warnings.push(`Tiled 地圖原尺寸 ${raw.width}×${raw.height} 超過上限 64×64，已裁切至 ${cols}×${rows}`);
  }

  const tilesets = [...(raw.tilesets ?? [])].sort((a, b) => b.firstgid - a.firstgid);
  const tilesetImgs = new Map<TiledTileset, DecodedPngImage | null>();
  for (const ts of tilesets) {
    if (ts.image) {
      const img = lookupCompanionImage(ts.image, assetsByPath);
      tilesetImgs.set(ts, img);
      if (!img) missingSet.add(ts.image);
    } else {
      tilesetImgs.set(ts, null);
    }
  }

  const customSprites: EcsCustomSpriteDef[] = [];
  const spriteSeen = new Set<string>();
  const tileDefs: EcsTileDef[] = [];
  const tileDefByKey = new Map<string, number>();
  let nextTileId = 360;

  const ensureSprite = (def: EcsCustomSpriteDef): string => {
    if (!spriteSeen.has(def.id)) {
      spriteSeen.add(def.id);
      customSprites.push(def);
    }
    return def.id;
  };

  const defaultFloorSpr = ensureSprite({
    id: `${prefix}_base_floor`,
    name: `${prefix} 基礎地板`,
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: { pattern: 'cobble', baseHex: '#2c364c', secondaryHex: '#161d2b', accentHex: '#64748b', seed: 17 },
  });
  const defaultFloorTileId = nextTileId++;
  tileDefs.push({
    id: defaultFloorTileId,
    name: '基礎地磚',
    layer: 'ground',
    sprite: defaultFloorSpr,
    solid: false,
    roughness: 0.72,
    metallic: 0.1,
  });

  const ground = new Array<number>(cols * rows).fill(defaultFloorTileId);
  const wall = new Array<number>(cols * rows).fill(0);
  const decor = new Array<number>(cols * rows).fill(0);

  const roomId = sanitizeInteropId(`${prefix}_room`, 'tiled_room', 42);
  const roomName = sourceName.replace(/\.(tmj|json)$/i, '') || 'Tiled 地圖';
  const entities: EcsEntityInitDef[] = [];
  const prefabsMap = new Map<string, EcsPrefabDef>();
  const portals: EcsMapPortalDef[] = [];
  const interactions: EcsMapInteractionRule[] = [];
  const interactionTagSeen = new Set<string>();
  const aiProfiles: Record<string, EcsTopDownAiProfile> = {};
  const globals: Record<string, number> = {};

  const ensurePrefab = (prefab: EcsPrefabDef): void => {
    if (!prefabsMap.has(prefab.id)) prefabsMap.set(prefab.id, prefab);
  };

  const flatLayers = flattenTiledLayers(raw.layers);
  let heroSpawned = false;
  let objSeq = 1;
  const srcTileW = Math.max(1, raw.tilewidth || 32);
  const srcTileH = Math.max(1, raw.tileheight || 32);

  for (const layer of flatLayers) {
    if (layer.type === 'tilelayer') {
      const targetLayer = classifyTiledLayer(layer);
      const gids = decodeTiledLayerData(layer);
      const lw = layer.width || raw.width;
      const lh = layer.height || raw.height;

      for (let r = 0; r < Math.min(rows, lh); r++) {
        for (let c = 0; c < Math.min(cols, lw); c++) {
          const gid = gids[r * lw + c] ?? 0;
          if (gid === 0) continue;

          const ts = tilesets.find((t) => gid >= t.firstgid);
          const localId = ts ? gid - ts.firstgid : gid - 1;
          const tileMeta = ts?.tiles?.find((tm) => tm.id === localId);
          const propSolid = getTiledProp(tileMeta?.properties, ['solid', 'collides', 'wall']);
          const propHazard = getTiledProp(tileMeta?.properties, ['hazard', 'damage', 'lava', 'spike']);
          const propExtrude = getTiledProp(tileMeta?.properties, ['extrudeh', 'height']);
          const propUnlock = getTiledProp(tileMeta?.properties, ['unlockglobal', 'key']);
          const propColor = getTiledProp(tileMeta?.properties, ['color', 'basehex']);
          const tileTypeName = tileMeta?.class || tileMeta?.type || `${ts?.name ?? layer.name}_${localId}`;

          const effectiveLayer: EcsMapLayerName =
            propSolid === true ? 'wall' : propHazard === true ? 'decor' : targetLayer;
          const isSolid = propSolid !== undefined ? Boolean(propSolid) : effectiveLayer === 'wall';
          const isHazard = Boolean(propHazard);
          const cacheKey = `${gid}:${effectiveLayer}`;

          let pixerTileId = tileDefByKey.get(cacheKey);
          if (pixerTileId === undefined) {
            const sprId = sanitizeInteropId(`${prefix}_gid_${gid}`, `tiled_g_${gid}`, 54);
            const img = ts ? tilesetImgs.get(ts) : null;
            if (img && ts) {
              const tw = ts.tilewidth || srcTileW;
              const th = ts.tileheight || srcTileH;
              const margin = ts.margin ?? 0;
              const spacing = ts.spacing ?? 0;
              const tsCols = ts.columns || Math.max(1, Math.floor((img.width - margin * 2 + spacing) / (tw + spacing)));
              const sx = margin + (localId % tsCols) * (tw + spacing);
              const sy = margin + Math.floor(localId / tsCols) * (th + spacing);
              const sliced = sliceRgbaRect(img, sx, sy, tw, th);
              const fitted = fitRgbaToSpriteBounds(sliced, tw, th);
              ensureSprite({
                id: sprId,
                name: tileTypeName,
                width: fitted.width,
                height: fitted.height,
                kind: 'rgba_b64',
                rgbaB64: encodeRgbaToZlibB64(fitted.rgba),
              });
            } else {
              const proc = pickTiledProcedural(tileTypeName, effectiveLayer, localId);
              ensureSprite({
                id: sprId,
                name: tileTypeName,
                width: 32,
                height: 32,
                kind: 'procedural',
                recipe: {
                  pattern: proc.pattern,
                  baseHex: typeof propColor === 'string' && /^#[0-9a-f]{6}$/i.test(propColor) ? propColor : proc.baseHex,
                  secondaryHex: proc.secondaryHex,
                  accentHex: proc.accentHex,
                  seed: gid * 43 + 11,
                  bevel: isSolid,
                },
              });
            }

            pixerTileId = nextTileId++;
            tileDefByKey.set(cacheKey, pixerTileId);
            tileDefs.push({
              id: pixerTileId,
              name: tileTypeName,
              layer: effectiveLayer,
              sprite: sprId,
              solid: isSolid,
              ...(isHazard ? { hazard: true, emissive: 0.65 } : {}),
              ...(effectiveLayer === 'wall'
                ? {
                    extrudeH: typeof propExtrude === 'number' ? Math.max(8, Math.min(48, Math.round(propExtrude))) : wallExtrudeH,
                    wallMaterial: 'stone' as const,
                    autoTile: true,
                  }
                : {}),
              ...(typeof propUnlock === 'string' && propUnlock.trim() ? { unlockGlobal: propUnlock.trim() } : {}),
              roughness: effectiveLayer === 'wall' ? 0.62 : 0.72,
              metallic: effectiveLayer === 'wall' ? 0.18 : 0.1,
            });
          }

          if (effectiveLayer === 'wall') wall[r * cols + c] = pixerTileId;
          else if (effectiveLayer === 'decor') decor[r * cols + c] = pixerTileId;
          else ground[r * cols + c] = pixerTileId;
        }
      }
    } else if (layer.type === 'objectgroup' && Array.isArray(layer.objects)) {
      const sx = 32 / srcTileW;
      const sy = 32 / srcTileH;
      for (const obj of layer.objects) {
        const kindStr = `${obj.class ?? ''} ${obj.type ?? ''} ${obj.name ?? ''}`.toLowerCase();
        const wx = Math.round(obj.x * sx);
        const wy = Math.round(obj.y * sy);
        const eid = sanitizeInteropId(`${prefix}_obj_${obj.id ?? objSeq++}`, `tiled_e_${objSeq}`, 54);

        if (/hero|player|spawn|start/.test(kindStr)) {
          heroSpawned = true;
          const heroSpr = ensureSprite({
            id: `${prefix}_hero`,
            name: '主角',
            width: 32,
            height: 32,
            kind: 'procedural',
            recipe: { pattern: 'crystal', baseHex: '#38bdf8', secondaryHex: '#0f172a', accentHex: '#fef08a', seed: 12 },
          });
          entities.push({
            id: 'hero',
            name: obj.name || '主角',
            roomId,
            components: {
              tag: 'hero',
              transform: { x: wx, y: wy, w: 28, h: 28 },
              body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
              sprite: { sprite: heroSpr, tint: '#ffffff', castShadow: true, roughness: 0.42, metallic: 0.35 },
              health: { hp: 8, maxHp: 8, team: 0 },
              light: { radius: 112, color: '#fde68a', intensity: 0.72, falloffPower: 1.7 },
            },
          });
        } else if (/light|torch|lamp|lantern/.test(kindStr)) {
          const color = String(getTiledProp(obj.properties, ['color']) ?? '#f59e0b');
          const radius = Number(getTiledProp(obj.properties, ['radius']) ?? 116);
          const spr = ensureSprite({
            id: `${prefix}_lamp`,
            name: '光源燈柱',
            width: 32,
            height: 32,
            kind: 'procedural',
            recipe: { pattern: 'pillar', baseHex: '#d97706', secondaryHex: '#451a03', accentHex: '#fef08a', seed: 61, emissiveCore: true },
          });
          entities.push({
            id: eid,
            name: obj.name || '光源',
            roomId,
            components: {
              tag: 'prop',
              transform: { x: wx, y: wy, w: 28, h: 28 },
              sprite: { sprite: spr, tint: '#ffffff', castShadow: true, emissive: 0.7 },
              light: { radius, color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#f59e0b', intensity: 0.88, falloffPower: 1.6 },
            },
          });
        } else if (/switch|chest|key|lever|trigger/.test(kindStr)) {
          const keyName = String(getTiledProp(obj.properties, ['global', 'key', 'unlockglobal']) ?? 'tiled_switch_on');
          globals[keyName] = 0;
          const spr = ensureSprite({
            id: `${prefix}_switch`,
            name: '互動機關',
            width: 32,
            height: 32,
            kind: 'procedural',
            recipe: { pattern: 'metal_panel', baseHex: '#10b981', secondaryHex: '#064e3b', accentHex: '#a7f3d0', seed: 47 },
          });
          entities.push({
            id: eid,
            name: obj.name || '機關',
            roomId,
            components: {
              tag: 'switch',
              transform: { x: wx, y: wy, w: 28, h: 28 },
              sprite: { sprite: spr, tint: '#ffffff', castShadow: true, roughness: 0.32, metallic: 0.65, emissive: 0.3 },
            },
          });
          if (!interactionTagSeen.has('switch')) {
            interactionTagSeen.add('switch');
            interactions.push({
              tag: 'switch',
              trigger: 'slash_or_touch',
              radius: 34,
              oneShot: true,
              setGlobal: keyName,
              setGlobalValue: 1,
              scoreDelta: 120,
              popupText: '機關已啟動!',
              popupColor: '#34d399',
              soundEvent: 'star',
            });
          }
        } else if (/enemy|boss|guard|automaton|slime|monster/.test(kindStr)) {
          const isBoss = /boss/.test(kindStr);
          const tag = isBoss ? 'boss' : 'enemy';
          const hp = Number(getTiledProp(obj.properties, ['hp', 'health']) ?? (isBoss ? 10 : 4));
          const spr = ensureSprite({
            id: isBoss ? `${prefix}_boss` : `${prefix}_enemy`,
            name: isBoss ? '首領' : '巡邏敵人',
            width: isBoss ? 48 : 32,
            height: isBoss ? 48 : 32,
            kind: 'procedural',
            recipe: {
              pattern: 'metal_panel',
              baseHex: isBoss ? '#e11d48' : '#f97316',
              secondaryHex: '#450a0a',
              accentHex: '#fde047',
              seed: isBoss ? 89 : 67,
            },
          });
          ensurePrefab({
            id: `${prefix}_prefab_${tag}`,
            name: isBoss ? '首領' : '敵人',
            category: tag,
            components: {
              tag,
              transform: { x: 0, y: 0, w: isBoss ? 44 : 28, h: isBoss ? 44 : 28 },
              body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
              sprite: { sprite: spr, tint: '#ffffff', castShadow: true, roughness: 0.35, metallic: 0.6 },
              health: { hp, maxHp: hp, team: 1 },
            },
          });
          entities.push({
            id: eid,
            name: obj.name || '敵人',
            roomId,
            prefabId: `${prefix}_prefab_${tag}`,
            components: {},
            overrides: { transform: { x: wx, y: wy } },
          });
          if (!aiProfiles[tag]) {
            aiProfiles[tag] = {
              chaseRange: isBoss ? 220 : 160,
              stopRange: 22,
              moveSpeed: isBoss ? 66 : 52,
              contactDamage: isBoss ? 2 : 1,
              contactRange: 28,
              scoreOnDefeat: isBoss ? 800 : 160,
              isBoss,
              winOnDefeat: isBoss,
            };
          }
        }
      }
    }
  }

  if (!heroSpawned) {
    let sc = Math.floor(cols / 2);
    let sr = Math.floor(rows / 2);
    outer: for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (wall[r * cols + c] === 0) {
          sc = c;
          sr = r;
          break outer;
        }
      }
    }
    const heroSpr = ensureSprite({
      id: `${prefix}_hero`,
      name: '主角',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: { pattern: 'crystal', baseHex: '#38bdf8', secondaryHex: '#0f172a', accentHex: '#fef08a', seed: 12 },
    });
    entities.unshift({
      id: 'hero',
      name: '主角',
      roomId,
      components: {
        tag: 'hero',
        transform: { x: sc * 32 + 2, y: sr * 32 + 2, w: 28, h: 28 },
        body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
        sprite: { sprite: heroSpr, tint: '#ffffff', castShadow: true, roughness: 0.45, metallic: 0.3 },
        health: { hp: 8, maxHp: 8, team: 0 },
        light: { radius: 112, color: '#fde68a', intensity: 0.72, falloffPower: 1.7 },
      },
    });
    warnings.push('Tiled 地圖未定義 Hero/Player 物件，已自動於安全地板位置建立主角出生點。');
  }

  const missingAssetPaths = Array.from(missingSet);
  if (missingAssetPaths.length > 0) {
    warnings.push(
      `缺少 ${missingAssetPaths.length} 張伴隨圖集 PNG，已自動以 Oklab+Bayer 程序化 PBR 像素磚填補，可隨時補傳 PNG 替換。`,
    );
  }

  const room: EcsMapRoomDef = {
    id: roomId,
    name: roomName,
    cols,
    rows,
    ambientDarkness: 0.34,
    skyTop: raw.backgroundcolor && /^#[0-9a-f]{6}$/i.test(raw.backgroundcolor) ? raw.backgroundcolor : '#0b1020',
    skyBottom: '#1a233a',
    wallExtrudeH,
    ground,
    wall,
    decor,
  };

  return {
    format: 'tiled',
    sourceName,
    summary: `Tiled (.tmj) 地圖：${cols}×${rows} · ${tileDefs.length} 瓦片 · ${entities.length} 實體`,
    tileSize: 32,
    customSprites,
    tileDefs,
    rooms: [room],
    portals,
    prefabs: Array.from(prefabsMap.values()),
    entities,
    interactions: interactions.length > 0 ? interactions : undefined,
    aiProfiles: Object.keys(aiProfiles).length > 0 ? aiProfiles : undefined,
    globals: Object.keys(globals).length > 0 ? globals : undefined,
    warnings,
    missingAssetPaths,
  };
}
