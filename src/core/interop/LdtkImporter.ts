import { encodeRgbaToZlibB64 } from '../ecs/EcsCustomSpriteCompiler.ts';
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

interface LdtkTilesetDef {
  uid: number;
  identifier: string;
  relPath?: string | null;
  tileGridSize?: number;
  pxWid?: number;
  pxHei?: number;
}

interface LdtkIntGridValDef {
  value: number;
  identifier?: string | null;
  color?: string;
}

interface LdtkLayerDef {
  uid: number;
  identifier: string;
  type?: string;
  intGridValues?: LdtkIntGridValDef[];
}

interface LdtkTileInstance {
  px: [number, number];
  src: [number, number];
  t: number;
}

interface LdtkFieldInstance {
  __identifier: string;
  __value: unknown;
}

interface LdtkEntityInstance {
  __identifier: string;
  iid?: string;
  px: [number, number];
  width?: number;
  height?: number;
  fieldInstances?: LdtkFieldInstance[];
}

interface LdtkLayerInstance {
  __identifier: string;
  __type: 'IntGrid' | 'Tiles' | 'AutoLayer' | 'Entities' | string;
  __cWid: number;
  __cHei: number;
  __gridSize: number;
  __tilesetDefUid?: number | null;
  __tilesetRelPath?: string | null;
  layerDefUid?: number;
  intGridCsv?: number[];
  gridTiles?: LdtkTileInstance[];
  autoLayerTiles?: LdtkTileInstance[];
  entityInstances?: LdtkEntityInstance[];
}

interface LdtkNeighbour {
  levelIid?: string;
  levelUid?: number;
  dir: string;
}

interface LdtkLevel {
  identifier: string;
  iid?: string;
  uid?: number;
  pxWid: number;
  pxHei: number;
  worldX?: number;
  worldY?: number;
  bgColor?: string;
  __neighbours?: LdtkNeighbour[];
  layerInstances?: LdtkLayerInstance[];
}

interface LdtkRoot {
  jsonVersion?: string;
  defaultGridSize?: number;
  defs?: {
    tilesets?: LdtkTilesetDef[];
    layers?: LdtkLayerDef[];
  };
  levels?: LdtkLevel[];
}

function getFieldValue(ent: LdtkEntityInstance, names: readonly string[]): unknown {
  if (!Array.isArray(ent.fieldInstances)) return undefined;
  for (const fi of ent.fieldInstances) {
    const lower = fi.__identifier.toLowerCase();
    if (names.includes(lower)) return fi.__value;
  }
  return undefined;
}

function classifyLdtkLayer(layerId: string, layerType: string): EcsMapLayerName {
  const lower = layerId.toLowerCase();
  if (/wall|solid|collision|cliff|block|gate|intgrid/.test(lower)) return 'wall';
  if (/decor|prop|detail|ornament|hazard|spike|foliage/.test(lower)) return 'decor';
  if (layerType === 'IntGrid') return 'wall';
  return 'ground';
}

function pickProceduralPatternForName(name: string, layer: EcsMapLayerName): EcsProceduralSpritePattern {
  const lower = name.toLowerCase();
  if (/lava|magma|hazard|spike/.test(lower)) return 'circuit';
  if (/water|pond|river|pool/.test(lower)) return 'water';
  if (/grass|moss|forest|garden|leaf/.test(lower)) return 'foliage';
  if (/wood|plank|timber|bridge/.test(lower)) return 'planks';
  if (/metal|iron|steel|gate|grate/.test(lower)) return /gate/.test(lower) ? 'gate' : 'metal_panel';
  if (/crystal|gem|astral|portal|energy/.test(lower)) return 'crystal';
  if (/brick|wall|cliff|stone/.test(lower)) return layer === 'wall' ? 'bricks' : 'cobble';
  return layer === 'wall' ? 'bricks' : layer === 'decor' ? 'pillar' : 'rune_floor';
}

/**
 * Pure, DOM-free LDtk (`.ldtk`) multi-room importer.
 * Maps LDtk Levels, IntGrid/Tiles/AutoLayer layers, `__neighbours`, and Entities
 * into Pixer ECS WorldMap rooms, custom PBR sprites/tileDefs, portals, prefabs, and AI profiles.
 */
export function parseLdtkProject(
  jsonText: string,
  assetsByPath: ReadonlyMap<string, DecodedPngImage>,
  sourceName: string,
  opts: InteropImportOptions = {},
): InteropImportResult {
  const raw = JSON.parse(jsonText) as LdtkRoot;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.levels) || raw.levels.length === 0) {
    throw new Error('非有效的 LDtk 專案檔（缺少 levels 陣列或無任何關卡）');
  }

  const wallExtrudeH = Math.max(8, Math.min(48, Math.round(opts.wallExtrudeH ?? 24)));
  const prefix = sanitizeInteropId(opts.idPrefix ?? sourceName, 'ldtk', 16);
  const warnings: string[] = [];
  const missingSet = new Set<string>();

  const tilesetByUid = new Map<number, LdtkTilesetDef>();
  for (const ts of raw.defs?.tilesets ?? []) {
    tilesetByUid.set(ts.uid, ts);
  }
  const layerDefByUid = new Map<number, LdtkLayerDef>();
  for (const ld of raw.defs?.layers ?? []) {
    layerDefByUid.set(ld.uid, ld);
  }

  const customSprites: EcsCustomSpriteDef[] = [];
  const spriteSeen = new Set<string>();
  const tileDefs: EcsTileDef[] = [];
  const tileDefByKey = new Map<string, number>();
  let nextTileId = 320;

  const ensureSprite = (def: EcsCustomSpriteDef): string => {
    if (!spriteSeen.has(def.id)) {
      spriteSeen.add(def.id);
      customSprites.push(def);
    }
    return def.id;
  };

  const levels: readonly LdtkLevel[] = raw.levels;

  // Default fallback ground sprite so every imported room has crisp floor coverage
  const defaultFloorSpriteId = ensureSprite({
    id: `${prefix}_floor_base`,
    name: `${prefix} 基礎地磚`,
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'cobble',
      baseHex: '#334155',
      secondaryHex: '#1e293b',
      accentHex: '#64748b',
      seed: 41,
      dither: true,
    },
  });
  const defaultFloorTileId = nextTileId++;
  tileDefs.push({
    id: defaultFloorTileId,
    name: '基礎石板地',
    layer: 'ground',
    sprite: defaultFloorSpriteId,
    solid: false,
    roughness: 0.72,
    metallic: 0.08,
  });

  const registerTile = (
    cacheKey: string,
    name: string,
    layer: EcsMapLayerName,
    spriteId: string,
    solid: boolean,
    hazard: boolean,
    unlockGlobal?: string,
  ): number => {
    const existing = tileDefByKey.get(cacheKey);
    if (existing !== undefined) return existing;
    const id = nextTileId++;
    tileDefByKey.set(cacheKey, id);
    tileDefs.push({
      id,
      name,
      layer,
      sprite: spriteId,
      solid,
      ...(hazard ? { hazard: true, emissive: 0.65 } : {}),
      ...(layer === 'wall' ? { extrudeH: wallExtrudeH, wallMaterial: 'stone' as const, autoTile: true } : {}),
      ...(unlockGlobal ? { unlockGlobal } : {}),
      roughness: layer === 'wall' ? 0.62 : 0.74,
      metallic: layer === 'wall' ? 0.16 : 0.08,
    });
    return id;
  };

  const rooms: EcsMapRoomDef[] = [];
  const levelKeyToRoomId = new Map<string, string>();
  const levelByRoomId = new Map<string, LdtkLevel>();
  const entities: EcsEntityInitDef[] = [];
  const prefabsMap = new Map<string, EcsPrefabDef>();
  const portals: EcsMapPortalDef[] = [];
  const interactions: EcsMapInteractionRule[] = [];
  const interactionTagSeen = new Set<string>();
  const aiProfiles: Record<string, EcsTopDownAiProfile> = {};
  const globals: Record<string, number> = {};

  const ensurePrefab = (prefab: EcsPrefabDef): void => {
    if (!prefabsMap.has(prefab.id)) {
      prefabsMap.set(prefab.id, prefab);
    }
  };

  let heroSpawned = false;
  let entitySeq = 1;

  // First pass: register room IDs so portals & neighbours can resolve targets cleanly
  for (let i = 0; i < levels.length; i++) {
    const lvl: LdtkLevel = levels[i];
    const roomId = sanitizeInteropId(`${prefix}_${lvl.identifier || `room_${i + 1}`}`, `ldtk_r${i + 1}`, 42);
    if (lvl.iid) levelKeyToRoomId.set(lvl.iid, roomId);
    if (lvl.uid !== undefined) levelKeyToRoomId.set(String(lvl.uid), roomId);
    levelKeyToRoomId.set(lvl.identifier, roomId);
    levelByRoomId.set(roomId, lvl);
  }

  // Second pass: convert each level into an EcsMapRoomDef + entities
  for (let li = 0; li < levels.length; li++) {
    const lvl: LdtkLevel = levels[li];
    const roomId = levelKeyToRoomId.get(lvl.iid ?? lvl.identifier) ?? `ldtk_r${li + 1}`;
    const layers: readonly LdtkLayerInstance[] = lvl.layerInstances ?? [];
    const primaryGridLayer = layers.find((l) => l.__cWid > 0 && l.__cHei > 0);
    const gridSize = primaryGridLayer?.__gridSize || raw.defaultGridSize || 32;
    const rawCols = primaryGridLayer?.__cWid ?? Math.max(8, Math.round(lvl.pxWid / gridSize));
    const rawRows = primaryGridLayer?.__cHei ?? Math.max(8, Math.round(lvl.pxHei / gridSize));
    const cols = Math.max(8, Math.min(64, rawCols));
    const rows = Math.max(8, Math.min(64, rawRows));
    if (rawCols > 64 || rawRows > 64) {
      warnings.push(`房間「${lvl.identifier}」原尺寸 ${rawCols}×${rawRows} 超過上限 64×64，已裁切至 ${cols}×${rows}`);
    }

    const ground = new Array<number>(cols * rows).fill(defaultFloorTileId);
    const wall = new Array<number>(cols * rows).fill(0);
    const decor = new Array<number>(cols * rows).fill(0);

    // LDtk stores layerInstances top-to-bottom; iterate bottom-to-top
    for (let k = layers.length - 1; k >= 0; k--) {
      const layer: LdtkLayerInstance = layers[k];
      const targetLayer = classifyLdtkLayer(layer.__identifier, layer.__type);
      const lDef = layer.layerDefUid !== undefined ? layerDefByUid.get(layer.layerDefUid) : undefined;
      const tsDef = layer.__tilesetDefUid != null ? tilesetByUid.get(layer.__tilesetDefUid) : undefined;
      const relPath = layer.__tilesetRelPath ?? tsDef?.relPath ?? null;
      const tilesetImg = lookupCompanionImage(relPath, assetsByPath);
      if (relPath && !tilesetImg) {
        missingSet.add(relPath);
      }

      // 1. IntGrid values
      if (Array.isArray(layer.intGridCsv) && layer.intGridCsv.length > 0) {
        const valDefs = new Map<number, LdtkIntGridValDef>();
        for (const vd of lDef?.intGridValues ?? []) {
          valDefs.set(vd.value, vd);
        }
        const lw = Math.max(1, layer.__cWid);
        for (let idx = 0; idx < layer.intGridCsv.length; idx++) {
          const val = layer.intGridCsv[idx];
          if (!val) continue;
          const col = idx % lw;
          const row = (idx / lw) | 0;
          if (col >= cols || row >= rows) continue;
          const vd = valDefs.get(val);
          const vName = vd?.identifier || `${layer.__identifier}_${val}`;
          const lower = vName.toLowerCase();
          const isHazard = /hazard|lava|spike|acid/.test(lower);
          const isFloor = /floor|ground|grass|path|carpet|sand/.test(lower);
          const isGate = /gate|door|lock/.test(lower);
          const effectiveLayer: EcsMapLayerName = isHazard ? 'decor' : isFloor ? 'ground' : 'wall';
          const isSolid = effectiveLayer === 'wall';
          const colorHex = vd?.color && /^#[0-9a-f]{6}$/i.test(vd.color) ? vd.color : isSolid ? '#475569' : '#334155';
          const spriteId = ensureSprite({
            id: sanitizeInteropId(`${prefix}_ig_${layer.__identifier}_${val}`, `ldtk_ig_${val}`, 54),
            name: vName,
            width: 32,
            height: 32,
            kind: 'procedural',
            recipe: {
              pattern: pickProceduralPatternForName(vName, effectiveLayer),
              baseHex: colorHex,
              secondaryHex: isSolid ? '#1e293b' : '#0f172a',
              accentHex: isHazard ? '#fb923c' : isGate ? '#facc15' : '#94a3b8',
              seed: val * 37 + k * 13,
              bevel: isSolid,
            },
          });
          const tid = registerTile(
            `ig:${layer.__identifier}:${val}`,
            vName,
            effectiveLayer,
            spriteId,
            isSolid,
            isHazard,
            isGate ? 'has_gate_key' : undefined,
          );
          if (effectiveLayer === 'wall') wall[row * cols + col] = tid;
          else if (effectiveLayer === 'decor') decor[row * cols + col] = tid;
          else ground[row * cols + col] = tid;
        }
      }

      // 2. Tile / AutoLayer instances
      const tileList = [...(layer.gridTiles ?? []), ...(layer.autoLayerTiles ?? [])];
      if (tileList.length > 0) {
        const tsGrid = tsDef?.tileGridSize || layer.__gridSize || 16;
        for (const t of tileList) {
          const col = Math.floor(t.px[0] / layer.__gridSize);
          const row = Math.floor(t.px[1] / layer.__gridSize);
          if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
          const tileKey = `ts:${layer.__tilesetDefUid ?? 0}:${t.t}:${targetLayer}`;
          let tid = tileDefByKey.get(tileKey);
          if (tid === undefined) {
            const sprId = sanitizeInteropId(`${prefix}_t${layer.__tilesetDefUid ?? 0}_${t.t}`, `ldtk_t_${t.t}`, 54);
            if (tilesetImg) {
              const sliced = sliceRgbaRect(tilesetImg, t.src[0], t.src[1], tsGrid, tsGrid);
              const fitted = fitRgbaToSpriteBounds(sliced, tsGrid, tsGrid);
              ensureSprite({
                id: sprId,
                name: `${tsDef?.identifier ?? 'Tileset'} #${t.t}`,
                width: fitted.width,
                height: fitted.height,
                kind: 'rgba_b64',
                rgbaB64: encodeRgbaToZlibB64(fitted.rgba),
              });
            } else {
              ensureSprite({
                id: sprId,
                name: `${layer.__identifier} #${t.t}`,
                width: 32,
                height: 32,
                kind: 'procedural',
                recipe: {
                  pattern: pickProceduralPatternForName(layer.__identifier, targetLayer),
                  baseHex: targetLayer === 'wall' ? '#52525b' : targetLayer === 'decor' ? '#38bdf8' : '#3b4a5e',
                  secondaryHex: '#18181b',
                  accentHex: '#cbd5e1',
                  seed: (t.t + 1) * 29,
                },
              });
            }
            tid = registerTile(
              tileKey,
              `${layer.__identifier} #${t.t}`,
              targetLayer,
              sprId,
              targetLayer === 'wall',
              false,
            );
          }
          if (targetLayer === 'wall') wall[row * cols + col] = tid;
          else if (targetLayer === 'decor') decor[row * cols + col] = tid;
          else ground[row * cols + col] = tid;
        }
      }

      // 3. Entity instances
      if (Array.isArray(layer.entityInstances)) {
        const scaleTo32 = 32 / Math.max(1, layer.__gridSize);
        for (const ent of layer.entityInstances) {
          const ident = ent.__identifier.toLowerCase();
          const wx = Math.round(ent.px[0] * scaleTo32);
          const wy = Math.round(ent.px[1] * scaleTo32);
          const ew = Math.max(24, Math.min(48, Math.round((ent.width ?? layer.__gridSize) * scaleTo32)));
          const eh = Math.max(24, Math.min(64, Math.round((ent.height ?? layer.__gridSize) * scaleTo32)));
          const eid = sanitizeInteropId(`${prefix}_${roomId}_${ident}_${entitySeq++}`, `ldtk_e_${entitySeq}`, 56);

          if (/hero|player|spawn|start/.test(ident)) {
            heroSpawned = true;
            const heroSpr = ensureSprite({
              id: `${prefix}_hero`,
              name: '探索者',
              width: 32,
              height: 32,
              kind: 'procedural',
              recipe: { pattern: 'crystal', baseHex: '#38bdf8', secondaryHex: '#0f172a', accentHex: '#fef08a', seed: 7 },
            });
            entities.push({
              id: 'hero',
              name: ent.__identifier,
              roomId,
              components: {
                tag: 'hero',
                transform: { x: wx, y: wy, w: 28, h: 28 },
                body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
                sprite: { sprite: heroSpr, tint: '#ffffff', castShadow: true, roughness: 0.45, metallic: 0.3 },
                health: { hp: 8, maxHp: 8, team: 0 },
                light: { radius: 112, color: '#fde68a', intensity: 0.72, falloffPower: 1.7 },
              },
            });
          } else if (/portal|door|warp|exit/.test(ident)) {
            const targetRoomRaw = String(getFieldValue(ent, ['targetroom', 'target_room', 'to', 'destination']) ?? '');
            const targetRoomId = levelKeyToRoomId.get(targetRoomRaw);
            const reqGlobal = getFieldValue(ent, ['requiresglobal', 'requires_global', 'key', 'lock']);
            if (targetRoomId) {
              const col = Math.max(0, Math.min(cols - 1, Math.floor(wx / 32)));
              const row = Math.max(0, Math.min(rows - 1, Math.floor(wy / 32)));
              const targetX = Number(getFieldValue(ent, ['targetx', 'target_x']) ?? 96);
              const targetY = Number(getFieldValue(ent, ['targety', 'target_y']) ?? 96);
              const targetRoomName = levelByRoomId.get(targetRoomId)?.identifier ?? targetRoomRaw;
              portals.push({
                id: sanitizeInteropId(`${prefix}_p_${roomId}_${targetRoomId}_${portals.length}`, `portal_${portals.length}`),
                name: `前往 ${targetRoomName}`,
                fromRoomId: roomId,
                col,
                row,
                cols: 1,
                rows: 1,
                toRoomId: targetRoomId,
                targetX,
                targetY,
                ...(typeof reqGlobal === 'string' && reqGlobal.trim()
                  ? { requiresGlobal: reqGlobal.trim(), lockedHint: `需要道具：${reqGlobal.trim()}` }
                  : {}),
              });
            }
          } else if (/chest|key|relic/.test(ident)) {
            const keyName = String(getFieldValue(ent, ['global', 'key', 'grantglobal', 'item']) ?? 'has_gate_key');
            globals[keyName] = 0;
            const chestSpr = ensureSprite({
              id: `${prefix}_chest`,
              name: '寶箱',
              width: 32,
              height: 32,
              kind: 'procedural',
              recipe: { pattern: 'metal_panel', baseHex: '#d97706', secondaryHex: '#78350f', accentHex: '#fef08a', seed: 19 },
            });
            ensurePrefab({
              id: `${prefix}_prefab_chest`,
              name: '寶箱',
              category: 'interactable',
              components: {
                tag: 'chest',
                transform: { x: 0, y: 0, w: 28, h: 28 },
                sprite: { sprite: chestSpr, tint: '#ffffff', castShadow: true, roughness: 0.4, metallic: 0.65 },
                light: { radius: 64, color: '#fbbf24', intensity: 0.55, falloffPower: 1.8 },
              },
            });
            entities.push({
              id: eid,
              name: ent.__identifier,
              roomId,
              prefabId: `${prefix}_prefab_chest`,
              components: {},
              overrides: { transform: { x: wx, y: wy } },
            });
            if (!interactionTagSeen.has('chest')) {
              interactionTagSeen.add('chest');
              interactions.push({
                tag: 'chest',
                trigger: 'slash_or_touch',
                radius: 34,
                oneShot: true,
                setGlobal: keyName,
                setGlobalValue: 1,
                scoreDelta: 150,
                popupText: `獲得關鍵道具 (${keyName})!`,
                popupColor: '#fde047',
                soundEvent: 'key',
              });
            }
          } else if (/switch|lever|button|plate/.test(ident)) {
            const targetKey = String(getFieldValue(ent, ['global', 'unlockglobal']) ?? 'has_gate_key');
            globals[targetKey] = 0;
            const swSpr = ensureSprite({
              id: `${prefix}_switch`,
              name: '符文機關',
              width: 32,
              height: 32,
              kind: 'procedural',
              recipe: { pattern: 'crystal', baseHex: '#10b981', secondaryHex: '#064e3b', accentHex: '#a7f3d0', seed: 31 },
            });
            entities.push({
              id: eid,
              name: ent.__identifier,
              roomId,
              components: {
                tag: 'switch',
                transform: { x: wx, y: wy, w: 28, h: 28 },
                sprite: { sprite: swSpr, tint: '#ffffff', castShadow: true, roughness: 0.35, metallic: 0.45, emissive: 0.35 },
              },
            });
            if (!interactionTagSeen.has('switch')) {
              interactionTagSeen.add('switch');
              interactions.push({
                tag: 'switch',
                trigger: 'slash_or_touch',
                radius: 32,
                oneShot: true,
                setGlobal: targetKey,
                setGlobalValue: 1,
                scoreDelta: 100,
                popupText: '機關已啟動!',
                popupColor: '#34d399',
                soundEvent: 'star',
              });
            }
          } else if (/torch|lamp|light|brazier/.test(ident)) {
            const lightColor = String(getFieldValue(ent, ['color']) ?? '#f59e0b');
            const torchSpr = ensureSprite({
              id: `${prefix}_torch`,
              name: '光柱火盆',
              width: 32,
              height: 32,
              kind: 'procedural',
              recipe: { pattern: 'pillar', baseHex: '#b45309', secondaryHex: '#451a03', accentHex: '#fde047', seed: 53, emissiveCore: true },
            });
            entities.push({
              id: eid,
              name: ent.__identifier,
              roomId,
              components: {
                tag: 'prop',
                transform: { x: wx, y: wy, w: 28, h: 28 },
                sprite: { sprite: torchSpr, tint: '#ffffff', castShadow: true, emissive: 0.65 },
                light: { radius: 120, color: /^#[0-9a-f]{6}$/i.test(lightColor) ? lightColor : '#f59e0b', intensity: 0.9, falloffPower: 1.6 },
              },
            });
          } else if (/boss|enemy|slime|guard|sentinel|monster|mob/.test(ident)) {
            const isBoss = /boss/.test(ident);
            const tag = isBoss ? 'boss' : 'enemy';
            const hp = Number(getFieldValue(ent, ['hp', 'health']) ?? (isBoss ? 12 : 4));
            const sprId = ensureSprite({
              id: isBoss ? `${prefix}_boss` : `${prefix}_enemy`,
              name: isBoss ? '區域首領' : '巡邏敵人',
              width: isBoss ? 48 : 32,
              height: isBoss ? 48 : 32,
              kind: 'procedural',
              recipe: {
                pattern: 'crystal',
                baseHex: isBoss ? '#e11d48' : '#f97316',
                secondaryHex: '#450a0a',
                accentHex: '#fda4af',
                seed: isBoss ? 99 : 73,
                emissiveCore: isBoss,
              },
            });
            ensurePrefab({
              id: `${prefix}_prefab_${tag}`,
              name: isBoss ? '區域首領' : '巡邏敵人',
              category: tag,
              components: {
                tag,
                transform: { x: 0, y: 0, w: isBoss ? 44 : ew, h: isBoss ? 44 : eh },
                body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
                sprite: { sprite: sprId, tint: '#ffffff', castShadow: true, roughness: 0.45, metallic: 0.35 },
                health: { hp, maxHp: hp, team: 1 },
              },
            });
            entities.push({
              id: eid,
              name: ent.__identifier,
              roomId,
              prefabId: `${prefix}_prefab_${tag}`,
              components: {},
              overrides: { transform: { x: wx, y: wy } },
            });
            if (!aiProfiles[tag]) {
              aiProfiles[tag] = {
                chaseRange: isBoss ? 220 : 160,
                stopRange: 22,
                moveSpeed: isBoss ? 68 : 54,
                contactDamage: isBoss ? 2 : 1,
                contactRange: isBoss ? 34 : 26,
                scoreOnDefeat: isBoss ? 1000 : 180,
                isBoss,
                winOnDefeat: isBoss,
              };
            }
          }
        }
      }
    }

    rooms.push({
      id: roomId,
      name: lvl.identifier || `房間 ${li + 1}`,
      cols,
      rows,
      ambientDarkness: 0.32,
      skyTop: lvl.bgColor && /^#[0-9a-f]{6}$/i.test(lvl.bgColor) ? lvl.bgColor : '#0b1324',
      skyBottom: '#17253d',
      wallExtrudeH,
      ground,
      wall,
      decor,
    });
  }

  // Third pass: auto-connect LDtk `__neighbours` if no explicit portal already links them
  const linkedPair = new Set<string>(portals.map((p) => `${p.fromRoomId}->${p.toRoomId}`));
  for (const room of rooms) {
    const lvl = levelByRoomId.get(room.id);
    for (const nb of lvl?.__neighbours ?? []) {
      const targetKey = nb.levelIid ?? (nb.levelUid !== undefined ? String(nb.levelUid) : '');
      const toRoomId = levelKeyToRoomId.get(targetKey);
      if (!toRoomId || linkedPair.has(`${room.id}->${toRoomId}`)) continue;
      const toRoom = rooms.find((r) => r.id === toRoomId);
      if (!toRoom) continue;

      const dir = (nb.dir || 'e').toLowerCase();
      let col = Math.floor(room.cols / 2);
      let row = Math.floor(room.rows / 2);
      let targetX = Math.floor(toRoom.cols / 2) * 32;
      let targetY = Math.floor(toRoom.rows / 2) * 32;

      if (dir === 'e') {
        col = room.cols - 2;
        row = Math.floor(room.rows / 2);
        targetX = 2 * 32;
        targetY = Math.floor(toRoom.rows / 2) * 32;
      } else if (dir === 'w') {
        col = 1;
        row = Math.floor(room.rows / 2);
        targetX = (toRoom.cols - 3) * 32;
        targetY = Math.floor(toRoom.rows / 2) * 32;
      } else if (dir === 'n') {
        col = Math.floor(room.cols / 2);
        row = 1;
        targetX = Math.floor(toRoom.cols / 2) * 32;
        targetY = (toRoom.rows - 3) * 32;
      } else if (dir === 's') {
        col = Math.floor(room.cols / 2);
        row = room.rows - 2;
        targetX = Math.floor(toRoom.cols / 2) * 32;
        targetY = 2 * 32;
      }

      // Carve passage on wall layer so neighbour portal is guaranteed reachable
      room.wall[row * room.cols + col] = 0;
      const dstCol = Math.max(1, Math.min(toRoom.cols - 2, Math.floor(targetX / 32)));
      const dstRow = Math.max(1, Math.min(toRoom.rows - 2, Math.floor(targetY / 32)));
      toRoom.wall[dstRow * toRoom.cols + dstCol] = 0;

      portals.push({
        id: sanitizeInteropId(`${prefix}_nb_${room.id}_${toRoomId}`, `nb_${portals.length}`),
        name: `前往 ${toRoom.name}`,
        fromRoomId: room.id,
        col,
        row,
        cols: 1,
        rows: 1,
        toRoomId,
        targetX: dstCol * 32,
        targetY: dstRow * 32,
      });
      linkedPair.add(`${room.id}->${toRoomId}`);
    }
  }

  // Ensure a hero exists in start room so the imported LDtk map is immediately playable
  if (!heroSpawned && rooms.length > 0) {
    const startRoom = rooms[0];
    let spawnCol = Math.floor(startRoom.cols / 2);
    let spawnRow = Math.floor(startRoom.rows / 2);
    outer: for (let r = 1; r < startRoom.rows - 1; r++) {
      for (let c = 1; c < startRoom.cols - 1; c++) {
        if (startRoom.wall[r * startRoom.cols + c] === 0) {
          spawnCol = c;
          spawnRow = r;
          break outer;
        }
      }
    }
    const heroSpr = ensureSprite({
      id: `${prefix}_hero`,
      name: '探索者',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: { pattern: 'crystal', baseHex: '#38bdf8', secondaryHex: '#0f172a', accentHex: '#fef08a', seed: 7 },
    });
    entities.unshift({
      id: 'hero',
      name: '探索者',
      roomId: startRoom.id,
      components: {
        tag: 'hero',
        transform: { x: spawnCol * 32 + 2, y: spawnRow * 32 + 2, w: 28, h: 28 },
        body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
        sprite: { sprite: heroSpr, tint: '#ffffff', castShadow: true, roughness: 0.45, metallic: 0.3 },
        health: { hp: 8, maxHp: 8, team: 0 },
        light: { radius: 112, color: '#fde68a', intensity: 0.72, falloffPower: 1.7 },
      },
    });
    warnings.push('LDtk 關卡中未找到 Hero/Player 實體，已於起始房間自動補齊主角出生點。');
  }

  const missingAssetPaths = Array.from(missingSet);
  if (missingAssetPaths.length > 0) {
    warnings.push(
      `缺少 ${missingAssetPaths.length} 張伴隨圖集 PNG，已自動以 Oklab+Bayer 程序化 PBR 像素磚填補，可隨時補傳 PNG 替換。`,
    );
  }

  return {
    format: 'ldtk',
    sourceName,
    summary: `LDtk 多房地圖：${rooms.length} 房間 · ${tileDefs.length} 瓦片 · ${portals.length} 傳送門 · ${entities.length} 實體`,
    tileSize: 32,
    customSprites,
    tileDefs,
    rooms,
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
