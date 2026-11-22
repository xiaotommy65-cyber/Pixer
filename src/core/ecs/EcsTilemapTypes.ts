import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { SimEvent } from '../types/SceneTypes.ts';

/**
 * Pure, DOM-free Multi-Room HD-2D Tilemap, Portal & Top-Down Adventure Schema for Pixer ECS V2.
 *
 * Single Source of Truth shared by:
 * - `EcsProjectSchema` (serialization & validation)
 * - `EcsStudioSession` (transactional Undo/Redo map painting & room/portal commands)
 * - `EcsCartridgeRuntime` (live HD-2D extruded wall projection, AABB wall sliding, portals & camera)
 * - `EcsWorkbenchView` (multi-layer map designer brush, rect fill, flood fill & tile palette)
 */

export type EcsMapLayerName = 'ground' | 'wall' | 'decor';

export interface EcsTileLightSpec {
  readonly radius: number;
  readonly color: string;
  readonly intensity: number;
}

export interface EcsTileDef {
  readonly id: number;
  readonly name: string;
  readonly layer: EcsMapLayerName;
  readonly sprite: SpriteId;
  readonly solid: boolean;
  readonly hazard?: boolean;
  readonly extrudeH?: number;
  /** Optional vertical sprite height in world px for tall decor tiles (e.g. 48px banners/arches). */
  readonly renderH?: number;
  readonly wallMaterial?: 'stone' | 'earth' | 'timber' | 'astral';
  /** If set, when this global key >= 1, the tile becomes passable and switches to `unlockedSprite`. */
  readonly unlockGlobal?: string;
  readonly unlockedSprite?: SpriteId;
  /** Optional subtle ambient light emitted by this tile type (e.g. stained glass, lava vents). */
  readonly ambientLight?: EcsTileLightSpec;
  readonly roughness?: number;
  readonly metallic?: number;
  readonly emissive?: number;
  readonly tint?: string;
  readonly autoTile?: boolean;
}

export interface EcsMapPortalDef {
  id: string;
  name: string;
  fromRoomId: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
  toRoomId: string;
  targetX: number;
  targetY: number;
  /** Optional global flag key that must be >= 1 to traverse this portal. */
  requiresGlobal?: string;
  lockedHint?: string;
}

export interface EcsMapRoomDef {
  id: string;
  name: string;
  cols: number;
  rows: number;
  ambientDarkness?: number;
  skyTop?: string;
  skyBottom?: string;
  wallExtrudeH?: number;
  /** Optional initial editor camera Y focus when viewing this room in Map Designer mode. */
  editorFocusY?: number;
  /** Row-major flat arrays of length cols * rows (0 = empty). */
  ground: number[];
  wall: number[];
  decor: number[];
}

export interface EcsTopDownHeroConfig {
  walkSpriteA?: SpriteId;
  walkSpriteB?: SpriteId;
  slashSprite?: SpriteId;
  slashColor?: string;
  slashReach?: number;
  dashSpeedMultiplier?: number;
}

export interface EcsMapInteractionRule {
  /** Entity tag matched by this rule (e.g. 'chest', 'switch', 'pickup', 'terminal'). */
  tag: string;
  trigger: 'touch' | 'slash_or_touch';
  radius: number;
  oneShot: boolean;
  destroyOnUse?: boolean;
  swapSprite?: SpriteId;
  setGlobal?: string;
  setGlobalValue?: number;
  addGlobal?: string;
  addGlobalDelta?: number;
  /** Optional threshold check after addGlobal: if global >= targetGlobal (or thresholdCount), unlocks thresholdUnlockGlobal. */
  thresholdCount?: number;
  thresholdTargetGlobal?: string;
  thresholdUnlockGlobal?: string;
  thresholdPopup?: string;
  thresholdPopupColor?: string;
  healAmount?: number;
  scoreDelta?: number;
  popupText?: string;
  popupColor?: string;
  soundEvent?: SimEvent;
}

export interface EcsTopDownAiProfile {
  chaseRange: number;
  stopRange: number;
  moveSpeed: number;
  contactDamage: number;
  contactRange: number;
  scoreOnDefeat: number;
  knockback?: number;
  hitReachBonus?: number;
  isBoss?: boolean;
  winOnDefeat?: boolean;
  hitPopup?: string;
  defeatPopup?: string;
  phase2HpRatio?: number;
  phase2Speed?: number;
  phase2Popup?: string;
  projectilePrefab?: string;
  projectileTag?: string;
  projectileInterval?: number;
  projectilePhase2Interval?: number;
  projectileCount?: number;
  projectilePhase2Count?: number;
  projectileSpeed?: number;
  projectilePhase2Speed?: number;
  projectileSpreadRad?: number;
  projectilePhase2SpreadRad?: number;
}

export interface EcsWorldMapDef {
  tileSize: number;
  startRoomId: string;
  rooms: EcsMapRoomDef[];
  portals: EcsMapPortalDef[];
  /** Optional custom tile definitions extending/overriding the engine default tile registry. */
  tileDefs?: EcsTileDef[];
  /** Data-driven top-down hero animation & melee combat configuration. */
  heroConfig?: EcsTopDownHeroConfig;
  /** Data-driven interactive prop/trigger rules (chests, switches, pickups, terminals, etc.). */
  interactions?: EcsMapInteractionRule[];
  /** Data-driven enemy & boss AI behavior profiles keyed by entity tag. */
  aiProfiles?: Record<string, EcsTopDownAiProfile>;
  /** Tag used for hostile projectiles that hurt the hero and stop on solid walls (default 'enemy_orb'). */
  hostileProjectileTag?: string;
}

export const CASTLE_TILE_IDS = {
  EMPTY: 0,
  // Ground Layer (1..9)
  STONE_FLOOR: 1,
  MOSS_FLOOR: 2,
  CARPET_V: 3,
  CARPET_H: 4,
  IRON_GRATE: 5,
  MAGIC_SEAL: 6,
  LAVA_MOAT: 7,
  STONE_STAIRS: 8,
  // Wall Layer (10..19)
  WALL_GOTHIC: 10,
  WALL_BRICK: 11,
  WALL_STAINED_GLASS: 12,
  GATE_CASTLE_KEY: 13,
  GATE_THRONE_SEAL: 14,
  WALL_LOW_PARAPET: 15,
  // Decor Layer (20..29)
  DECOR_SPIKES: 20,
  DECOR_BANNER: 21,
  DECOR_PORTAL_ARCH: 22,
} as const;

export const CASTLE_TILE_REGISTRY: readonly EcsTileDef[] = [
  // Ground tiles
  {
    id: CASTLE_TILE_IDS.STONE_FLOOR,
    name: '黑曜石板地',
    layer: 'ground',
    sprite: 'castle_floor_stone',
    solid: false,
    roughness: 0.72,
    metallic: 0.08,
  },
  {
    id: CASTLE_TILE_IDS.MOSS_FLOOR,
    name: '青苔古石地',
    layer: 'ground',
    sprite: 'castle_floor_moss',
    solid: false,
    roughness: 0.82,
    metallic: 0.04,
  },
  {
    id: CASTLE_TILE_IDS.CARPET_V,
    name: '王室紅毯 (縱)',
    layer: 'ground',
    sprite: 'castle_floor_carpet',
    solid: false,
    roughness: 0.88,
    metallic: 0.06,
  },
  {
    id: CASTLE_TILE_IDS.CARPET_H,
    name: '王室紅毯 (橫)',
    layer: 'ground',
    sprite: 'castle_floor_carpet_h',
    solid: false,
    roughness: 0.88,
    metallic: 0.06,
  },
  {
    id: CASTLE_TILE_IDS.IRON_GRATE,
    name: '地牢鐵柵格',
    layer: 'ground',
    sprite: 'castle_floor_grate',
    solid: false,
    roughness: 0.35,
    metallic: 0.82,
  },
  {
    id: CASTLE_TILE_IDS.MAGIC_SEAL,
    name: '赤月法陣磚',
    layer: 'ground',
    sprite: 'castle_floor_seal',
    solid: false,
    roughness: 0.4,
    metallic: 0.3,
    emissive: 0.35,
  },
  {
    id: CASTLE_TILE_IDS.LAVA_MOAT,
    name: '深淵熔岩溝',
    layer: 'ground',
    sprite: 'castle_floor_lava',
    solid: true,
    hazard: true,
    roughness: 0.25,
    metallic: 0.05,
    emissive: 0.85,
  },
  {
    id: CASTLE_TILE_IDS.STONE_STAIRS,
    name: '王座石階',
    layer: 'ground',
    sprite: 'castle_floor_stairs',
    solid: false,
    roughness: 0.65,
    metallic: 0.14,
  },

  // Wall tiles (HD-2D extruded)
  {
    id: CASTLE_TILE_IDS.WALL_GOTHIC,
    name: '哥德城垛高牆',
    layer: 'wall',
    sprite: 'castle_wall_top',
    solid: true,
    extrudeH: 28,
    wallMaterial: 'stone',
    roughness: 0.64,
    metallic: 0.14,
    autoTile: true,
  },
  {
    id: CASTLE_TILE_IDS.WALL_BRICK,
    name: '黑曜砌磚牆',
    layer: 'wall',
    sprite: 'castle_wall_brick',
    solid: true,
    extrudeH: 24,
    wallMaterial: 'stone',
    roughness: 0.68,
    metallic: 0.12,
    autoTile: true,
  },
  {
    id: CASTLE_TILE_IDS.WALL_STAINED_GLASS,
    name: '彩繪玻璃高窗',
    layer: 'wall',
    sprite: 'castle_wall_window',
    solid: true,
    extrudeH: 28,
    wallMaterial: 'astral',
    ambientLight: { radius: 96, color: '#60a5fa', intensity: 0.48 },
    roughness: 0.22,
    metallic: 0.2,
    emissive: 0.58,
  },
  {
    id: CASTLE_TILE_IDS.GATE_CASTLE_KEY,
    name: '城門鐵柵 (鑰匙鎖)',
    layer: 'wall',
    sprite: 'castle_gate_iron',
    unlockedSprite: 'castle_gate_open',
    unlockGlobal: 'has_gate_key',
    solid: true,
    extrudeH: 26,
    wallMaterial: 'stone',
    roughness: 0.34,
    metallic: 0.85,
  },
  {
    id: CASTLE_TILE_IDS.GATE_THRONE_SEAL,
    name: '王座封印門 (雙機關)',
    layer: 'wall',
    sprite: 'castle_gate_iron',
    unlockedSprite: 'castle_gate_open',
    unlockGlobal: 'throne_gate_open',
    solid: true,
    extrudeH: 26,
    wallMaterial: 'astral',
    roughness: 0.3,
    metallic: 0.88,
    emissive: 0.24,
  },
  {
    id: CASTLE_TILE_IDS.WALL_LOW_PARAPET,
    name: '半高石護欄',
    layer: 'wall',
    sprite: 'castle_wall_top',
    solid: true,
    extrudeH: 12,
    wallMaterial: 'stone',
    roughness: 0.7,
    metallic: 0.1,
  },

  // Decor tiles
  {
    id: CASTLE_TILE_IDS.DECOR_SPIKES,
    name: '鋼鐵尖刺陷阱',
    layer: 'decor',
    sprite: 'castle_spikes',
    solid: false,
    hazard: true,
    roughness: 0.28,
    metallic: 0.9,
  },
  {
    id: CASTLE_TILE_IDS.DECOR_BANNER,
    name: '赤月紋章掛旗',
    layer: 'decor',
    sprite: 'castle_banner_crimson',
    solid: false,
    renderH: 48,
    roughness: 0.78,
    metallic: 0.15,
  },
  {
    id: CASTLE_TILE_IDS.DECOR_PORTAL_ARCH,
    name: '傳送拱門標記',
    layer: 'decor',
    sprite: 'castle_portal_arch',
    solid: false,
    renderH: 48,
    roughness: 0.32,
    metallic: 0.4,
    emissive: 0.55,
  },
];

const TILE_DEF_BY_ID = new Map<number, EcsTileDef>();
for (const def of CASTLE_TILE_REGISTRY) {
  TILE_DEF_BY_ID.set(def.id, def);
}

export function getCastleTileDef(tileId: number, customDefs?: readonly EcsTileDef[]): EcsTileDef | undefined {
  if (customDefs) {
    for (let i = 0; i < customDefs.length; i++) {
      if (customDefs[i].id === tileId) return customDefs[i];
    }
  }
  return TILE_DEF_BY_ID.get(tileId);
}

export function createEmptyRoom(
  id: string,
  name: string,
  cols: number,
  rows: number,
  defaultFloorId: number = CASTLE_TILE_IDS.STONE_FLOOR,
): EcsMapRoomDef {
  const safeCols = Math.max(8, Math.min(64, Math.floor(cols)));
  const safeRows = Math.max(8, Math.min(64, Math.floor(rows)));
  const len = safeCols * safeRows;
  const ground = new Array<number>(len).fill(defaultFloorId);
  const wall = new Array<number>(len).fill(0);
  const decor = new Array<number>(len).fill(0);
  // Perimeter walls by default
  for (let c = 0; c < safeCols; c++) {
    wall[c] = CASTLE_TILE_IDS.WALL_GOTHIC;
    wall[(safeRows - 1) * safeCols + c] = CASTLE_TILE_IDS.WALL_GOTHIC;
  }
  for (let r = 0; r < safeRows; r++) {
    wall[r * safeCols] = CASTLE_TILE_IDS.WALL_GOTHIC;
    wall[r * safeCols + (safeCols - 1)] = CASTLE_TILE_IDS.WALL_GOTHIC;
  }
  return {
    id,
    name,
    cols: safeCols,
    rows: safeRows,
    ambientDarkness: 0.42,
    skyTop: '#070a14',
    skyBottom: '#13192c',
    wallExtrudeH: 26,
    ground,
    wall,
    decor,
  };
}

export function getRoomTile(room: EcsMapRoomDef, layer: EcsMapLayerName, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= room.cols || row >= room.rows) return 0;
  return room[layer][row * room.cols + col] ?? 0;
}

export function setRoomTile(
  room: EcsMapRoomDef,
  layer: EcsMapLayerName,
  col: number,
  row: number,
  tileId: number,
): boolean {
  if (col < 0 || row < 0 || col >= room.cols || row >= room.rows) return false;
  const idx = row * room.cols + col;
  const prev = room[layer][idx] ?? 0;
  if (prev === tileId) return false;
  room[layer][idx] = tileId;
  return true;
}

export function fillRoomRect(
  room: EcsMapRoomDef,
  layer: EcsMapLayerName,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  tileId: number,
): number {
  const minC = Math.max(0, Math.min(c0, c1));
  const maxC = Math.min(room.cols - 1, Math.max(c0, c1));
  const minR = Math.max(0, Math.min(r0, r1));
  const maxR = Math.min(room.rows - 1, Math.max(r0, r1));
  let changed = 0;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (setRoomTile(room, layer, c, r, tileId)) changed++;
    }
  }
  return changed;
}

/**
 * Non-recursive BFS flood fill on a room layer (strictly bounded by cols * rows).
 */
export function floodFillRoom(
  room: EcsMapRoomDef,
  layer: EcsMapLayerName,
  startCol: number,
  startRow: number,
  tileId: number,
): number {
  if (startCol < 0 || startRow < 0 || startCol >= room.cols || startRow >= room.rows) return 0;
  const arr = room[layer];
  const targetId = arr[startRow * room.cols + startCol] ?? 0;
  if (targetId === tileId) return 0;

  const cols = room.cols;
  const rows = room.rows;
  const visited = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;

  const startIdx = startRow * cols + startCol;
  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  let changed = 0;
  while (head < tail) {
    const idx = queue[head++];
    if ((arr[idx] ?? 0) !== targetId) continue;
    arr[idx] = tileId;
    changed++;

    const c = idx % cols;
    const r = (idx / cols) | 0;
    if (c > 0 && !visited[idx - 1]) {
      visited[idx - 1] = 1;
      queue[tail++] = idx - 1;
    }
    if (c + 1 < cols && !visited[idx + 1]) {
      visited[idx + 1] = 1;
      queue[tail++] = idx + 1;
    }
    if (r > 0 && !visited[idx - cols]) {
      visited[idx - cols] = 1;
      queue[tail++] = idx - cols;
    }
    if (r + 1 < rows && !visited[idx + cols]) {
      visited[idx + cols] = 1;
      queue[tail++] = idx + cols;
    }
  }
  return changed;
}

/**
 * 4-bit N/E/S/W auto-tile bitmask for wall connectivity (N=1, E=2, S=4, W=8).
 */
export function computeWallAutoTileMask(room: EcsMapRoomDef, col: number, row: number): number {
  let mask = 0;
  if (row > 0 && getRoomTile(room, 'wall', col, row - 1) > 0) mask |= 1;
  if (col + 1 < room.cols && getRoomTile(room, 'wall', col + 1, row) > 0) mask |= 2;
  if (row + 1 < room.rows && getRoomTile(room, 'wall', col, row + 1) > 0) mask |= 4;
  if (col > 0 && getRoomTile(room, 'wall', col - 1, row) > 0) mask |= 8;
  return mask;
}

/**
 * Zero-GC solid tile query respecting dynamic gate unlock flags.
 */
export function isRoomCellSolid(
  room: EcsMapRoomDef,
  col: number,
  row: number,
  globals: ReadonlyMap<string, number> | Record<string, number>,
  customDefs?: readonly EcsTileDef[],
): boolean {
  if (col < 0 || row < 0 || col >= room.cols || row >= room.rows) return true;
  const idx = row * room.cols + col;
  const wallId = room.wall[idx] ?? 0;
  if (wallId > 0) {
    const def = getCastleTileDef(wallId, customDefs);
    if (def?.solid) {
      if (def.unlockGlobal) {
        const val =
          globals instanceof Map
            ? (globals.get(def.unlockGlobal) ?? 0)
            : ((globals as Record<string, number>)[def.unlockGlobal] ?? 0);
        if (val >= 1) return false;
      }
      return true;
    }
  }
  const groundId = room.ground[idx] ?? 0;
  if (groundId > 0) {
    const gDef = getCastleTileDef(groundId, customDefs);
    if (gDef?.solid) return true;
  }
  return false;
}

/**
 * Zero-GC hazard check (lava / floor spikes / custom hazard tiles).
 */
export function isRoomCellHazard(
  room: EcsMapRoomDef,
  col: number,
  row: number,
  customDefs?: readonly EcsTileDef[],
): boolean {
  if (col < 0 || row < 0 || col >= room.cols || row >= room.rows) return false;
  const idx = row * room.cols + col;
  const decDef = getCastleTileDef(room.decor[idx] ?? 0, customDefs);
  if (decDef?.hazard) return true;
  const gDef = getCastleTileDef(room.ground[idx] ?? 0, customDefs);
  return Boolean(gDef?.hazard);
}
