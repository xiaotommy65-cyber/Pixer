import type { EngineHost } from '../core/runtime/EngineHost.ts';
import {
  validateCartridgeJson,
  type CartridgeArchetypeDef,
  type CartridgeCardDef,
  type CartridgeJsonV1,
  type CartridgeStageSpawn,
} from '../core/sim/CartridgeSchema.ts';
import {
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_HAZARD,
  COLLISION_SOLID,
  TILE_SIZE,
} from '../core/sim/TilemapGrid.ts';

export type WorkshopGenreTemplateId = 'parkour' | 'fighter' | 'card' | 'grid';

export interface WorkshopTemplateEntry {
  id: WorkshopGenreTemplateId;
  buttonLabel: string;
  description: string;
  build: (host?: EngineHost) => CartridgeJsonV1;
}

const DEFAULT_SPRITE_MAP: Record<string, string> = {
  '1': 'grass',
  '2': 'stone',
  '3': 'cloud_m',
  '4': 'trap',
  '5': 'dungeon_floor',
};

export const OFFICIAL_CARD_DECK: readonly CartridgeCardDef[] = [
  { id: 'strike', name: 'STRIKE', cost: 1, kind: 'attack', power: 5, color: '#ff5d8f' },
  { id: 'aegis', name: 'AEGIS', cost: 1, kind: 'shield', power: 6, color: '#5ec2f7' },
  { id: 'flare', name: 'FLARE', cost: 2, kind: 'attack', power: 11, color: '#ffd447' },
  { id: 'mend', name: 'MEND', cost: 1, kind: 'heal', power: 5, color: '#56d39c' },
];

function makeEmptyGrid(cols: number, rows: number): { tiles: number[]; collision: number[] } {
  const len = cols * rows;
  return {
    tiles: new Array<number>(len).fill(0),
    collision: new Array<number>(len).fill(COLLISION_EMPTY),
  };
}

function setGridTile(
  grid: { tiles: number[]; collision: number[] },
  cols: number,
  rows: number,
  c: number,
  r: number,
  tileId: number,
  colKind: number,
): void {
  if (c < 0 || c >= cols || r < 0 || r >= rows) return;
  const idx = r * cols + c;
  grid.tiles[idx] = tileId;
  grid.collision[idx] = colKind;
}

function fillFloorBand(
  grid: { tiles: number[]; collision: number[] },
  cols: number,
  rows: number,
  cStart: number,
  cEnd: number,
  topRow: number,
  topId = 1,
  fillId = 2,
): void {
  for (let c = Math.max(0, cStart); c <= Math.min(cols - 1, cEnd); c++) {
    setGridTile(grid, cols, rows, c, topRow, topId, COLLISION_SOLID);
    for (let r = topRow + 1; r < rows; r++) {
      setGridTile(grid, cols, rows, c, r, fillId, COLLISION_SOLID);
    }
  }
}

const FALLBACK_PARKOUR_ARCHETYPES: Record<string, CartridgeArchetypeDef> = {
  grapple_ring: {
    sprite: 'grapple_ring',
    w: 16,
    h: 16,
    tags: ['grapple_ring'],
    emissive: 0.85,
    light: { radius: 28, color: '#ffd447', intensity: 0.45 },
  },
  crystal_reset: {
    sprite: 'crystal_reset',
    w: 16,
    h: 16,
    tags: ['crystal_reset'],
    emissive: 0.9,
    light: { radius: 26, color: '#5ec2f7', intensity: 0.55 },
  },
  zip_block: {
    sprite: 'zip_block',
    w: 16,
    h: 16,
    tags: ['zip_block'],
    emissive: 0.75,
    light: { radius: 28, color: '#5ec2f7', intensity: 0.5 },
  },
  crumble_tile: {
    sprite: 'crumble_tile',
    w: 16,
    h: 16,
    tags: ['crumble_tile'],
  },
  star: {
    sprite: 'star_a',
    spriteB: 'star_b',
    animFps: 5,
    w: 16,
    h: 16,
    tags: ['collectible', 'star'],
    scoreValue: 100,
    emissive: 0.72,
  },
  gate: {
    sprite: 'gate_closed',
    spriteB: 'gate_open',
    w: 16,
    h: 16,
    tags: ['gate'],
    emissive: 0.85,
    light: { radius: 32, color: '#ffd447', intensity: 0.55 },
  },
};

function buildFallbackParkourCartridge(): CartridgeJsonV1 {
  const cols = 48;
  const rows = 12;
  const grid = makeEmptyGrid(cols, rows);
  fillFloorBand(grid, cols, rows, 0, 11, 10, 1, 2);
  fillFloorBand(grid, cols, rows, 18, 25, 9, 2, 2);
  fillFloorBand(grid, cols, rows, 34, 47, 10, 1, 2);

  for (let c = 12; c <= 17; c++) setGridTile(grid, cols, rows, c, 11, 4, COLLISION_HAZARD);
  for (let c = 26; c <= 33; c++) setGridTile(grid, cols, rows, c, 11, 4, COLLISION_HAZARD);
  for (let c = 28; c <= 31; c++) setGridTile(grid, cols, rows, c, 6, 3, COLLISION_CLOUD);

  const spawns: CartridgeStageSpawn[] = [
    { archetype: 'grapple_ring', x: 14 * TILE_SIZE, y: 4 * TILE_SIZE },
    { archetype: 'crystal_reset', x: 15 * TILE_SIZE, y: 7 * TILE_SIZE },
    { archetype: 'zip_block', x: 21 * TILE_SIZE, y: 4 * TILE_SIZE },
    { archetype: 'grapple_ring', x: 29 * TILE_SIZE, y: 3 * TILE_SIZE },
    { archetype: 'crumble_tile', x: 30 * TILE_SIZE, y: 9 * TILE_SIZE },
    { archetype: 'crumble_tile', x: 31 * TILE_SIZE, y: 9 * TILE_SIZE },
    { archetype: 'star', x: 21 * TILE_SIZE, y: 7 * TILE_SIZE },
    { archetype: 'star', x: 36 * TILE_SIZE, y: 8 * TILE_SIZE },
    { archetype: 'gate', x: 44 * TILE_SIZE, y: 9 * TILE_SIZE },
  ];

  return {
    version: 1,
    meta: {
      id: 'custom-parkour-remix',
      code: 'PKR',
      title: '緋空飛鉤跑酷 Remix',
      subtitle: '360° 飛鉤擺盪 × 雙模式跑酷',
      genre: 'platformer',
      genreHud: 'parkour',
      viewport: 'hd',
      paletteRow: 0,
      glowIntensity: 1,
    },
    initialVars: { combo: 0 },
    player: {
      controller: 'platformer',
      sprite: 'parkour_hero_idle',
      spriteB: 'parkour_hero_run_a',
      w: 16,
      h: 16,
      maxHearts: 3,
      scoutZoom: 0.78,
      grappleConfig: {
        enabled: true,
        maxRange: 165,
        attachWalls: true,
        pullSpeed: 350,
      },
    },
    archetypes: FALLBACK_PARKOUR_ARCHETYPES,
    stages: [
      {
        id: 'parkour-stage-1',
        name: '緋雲斷崖・工坊試煉',
        worldWidth: cols * TILE_SIZE,
        worldHeight: rows * TILE_SIZE,
        viewport: 'hd',
        bgmTheme: 'starlight',
        paletteRow: 0,
        hint: '滑鼠／右搖桿瞄準 · 左鍵/Y 擺盪 · 右鍵/R 牽引 · B 甩射跳躍',
        spawn: { x: 2 * TILE_SIZE, y: 9 * TILE_SIZE },
        artMood: {
          baseHex: '#1d1438',
          accentHex: '#ff5d8f',
          warmth: 0.35,
          contrast: 0.74,
          parallaxFog: 0.28,
        },
        springCamera: { freqHz: 8.5, dampingRatio: 0.92 },
        tileGrid: {
          cols,
          rows,
          tiles: grid.tiles,
          collision: grid.collision,
          spriteMap: { ...DEFAULT_SPRITE_MAP },
        },
        bgParallaxLayers: [
          {
            sprite: 'cloud_m',
            x: 0,
            y: 36,
            w: 32,
            h: 24,
            scrollX: 0.16,
            scrollY: 0.08,
            repeatW: cols * TILE_SIZE,
            repeatStepX: 40,
            tint: '#e0aaff',
            alpha: 0.45,
          },
          {
            sprite: 'star_a',
            x: 20,
            y: 20,
            w: 10,
            h: 10,
            scrollX: 0.28,
            scrollY: 0.14,
            repeatW: cols * TILE_SIZE,
            repeatStepX: 96,
            tint: '#ffd447',
            alpha: 0.6,
            additive: true,
            emissive: 0.75,
          },
        ],
        fgTiles: [
          { sprite: 'tree_canopy', x: 5 * TILE_SIZE, y: 10 * TILE_SIZE - 24, w: 24, h: 24, tint: '#ff8ec6', alpha: 0.88 },
          { sprite: 'torch', x: 20 * TILE_SIZE, y: 9 * TILE_SIZE - 16, w: 16, h: 16, alpha: 0.94 },
        ],
        spawns,
      },
    ],
    rules: [
      {
        id: 'parkour-crystal-sfx',
        when: { type: 'OnCollide', sourceTag: 'player', targetTag: 'crystal_reset' },
        do: [
          { type: 'SetVar', name: 'combo', op: '+=', value: 1 },
          { type: 'PlaySfx', preset: 'star' },
          { type: 'Juice', preset: 'relic_burst' },
        ],
      },
      {
        id: 'parkour-grapple-juice',
        when: { type: 'OnButton', button: 'skillY', edge: 'pressed' },
        do: [{ type: 'PlaySfx', preset: 'rail' }],
      },
    ],
  };
}

export function buildParkourTemplate(host?: EngineHost): CartridgeJsonV1 {
  const official = host?.getCartridgeJson('celestial-parkour');
  if (official) {
    const cloned = JSON.parse(JSON.stringify(official)) as CartridgeJsonV1;
    cloned.meta = {
      ...cloned.meta,
      id: 'custom-parkour-remix',
      code: 'PKR',
      title: '緋空飛鉤跑酷 Remix',
      subtitle: '360° 飛鉤擺盪 × 雙模式跑酷',
      genre: 'platformer',
      genreHud: 'parkour',
    };
    cloned.player = {
      ...cloned.player,
      controller: 'platformer',
      grappleConfig: {
        enabled: true,
        maxRange: 165,
        attachWalls: true,
        pullSpeed: 350,
      },
    };
    const res = validateCartridgeJson(cloned);
    if (res.ok) return res.data;
  }
  return buildFallbackParkourCartridge();
}

export function buildFighterTemplate(): CartridgeJsonV1 {
  const cols = 40;
  const rows = 12;
  const grid = makeEmptyGrid(cols, rows);
  fillFloorBand(grid, cols, rows, 0, cols - 1, 10, 2, 2);

  for (let r = 2; r <= 9; r++) {
    setGridTile(grid, cols, rows, 0, r, 2, COLLISION_SOLID);
    setGridTile(grid, cols, rows, cols - 1, r, 2, COLLISION_SOLID);
  }
  for (let c = 8; c <= 12; c++) setGridTile(grid, cols, rows, c, 7, 3, COLLISION_CLOUD);
  for (let c = 17; c <= 22; c++) setGridTile(grid, cols, rows, c, 5, 3, COLLISION_CLOUD);
  for (let c = 27; c <= 31; c++) setGridTile(grid, cols, rows, c, 7, 3, COLLISION_CLOUD);

  return {
    version: 1,
    meta: {
      id: 'custom-fighter-arena',
      code: 'FGT',
      title: '星街格鬥擂台',
      subtitle: '1v1 拳腳防禦連段 × When→If→Do 格鬥核心',
      genre: 'platformer',
      genreHud: 'fighter',
      viewport: 'wide',
      paletteRow: 1,
      glowIntensity: 1,
    },
    initialVars: {
      p1Hp: 100,
      p1MaxHp: 100,
      p2Hp: 100,
      p2MaxHp: 100,
      p2Guard: 100,
      combo: 0,
    },
    player: {
      controller: 'fighter',
      sprite: 'hero_a',
      spriteB: 'hero_b',
      w: 16,
      h: 16,
      maxHearts: 4,
    },
    archetypes: {
      ember_warden: {
        sprite: 'ember_warden',
        spriteB: 'slime_b',
        animFps: 4,
        w: 16,
        h: 16,
        tags: ['fighter_p2', 'enemy'],
        hp: 100,
        scoreValue: 300,
        castShadow: true,
        emissive: 0.72,
      },
      spring: { sprite: 'spring', w: 16, h: 16, tags: ['bouncy'], bounceVy: -290 },
      star: {
        sprite: 'star_a',
        spriteB: 'star_b',
        animFps: 5,
        w: 16,
        h: 16,
        tags: ['collectible', 'star'],
        scoreValue: 100,
        emissive: 0.75,
      },
      gate: { sprite: 'gate_closed', spriteB: 'gate_open', w: 16, h: 16, tags: ['gate'] },
      spark: { sprite: 'sparkle', w: 8, h: 8, tags: ['bullet'], emissive: 0.9 },
    },
    stages: [
      {
        id: 'fighter-arena-1',
        name: '霓虹星街武鬥場',
        worldWidth: cols * TILE_SIZE,
        worldHeight: rows * TILE_SIZE,
        bgmTheme: 'boss',
        paletteRow: 1,
        hint: '移動走位 · B 跳躍 · A 輕拳(-10) · Y 昇龍重擊(-18) · X/後退防禦',
        spawn: { x: 11 * TILE_SIZE, y: 9 * TILE_SIZE },
        artMood: {
          baseHex: '#1f1233',
          accentHex: '#ffd447',
          warmth: 0.48,
          contrast: 0.76,
          parallaxFog: 0.22,
        },
        tileGrid: {
          cols,
          rows,
          tiles: grid.tiles,
          collision: grid.collision,
          spriteMap: { ...DEFAULT_SPRITE_MAP },
        },
        bgParallaxLayers: [
          {
            sprite: 'star_a',
            x: 16,
            y: 18,
            w: 10,
            h: 10,
            scrollX: 0.25,
            scrollY: 0.1,
            repeatW: cols * TILE_SIZE,
            repeatStepX: 72,
            tint: '#ff5d8f',
            alpha: 0.5,
            additive: true,
            emissive: 0.7,
          },
        ],
        spawns: [
          { archetype: 'spring', x: 4 * TILE_SIZE, y: 9 * TILE_SIZE },
          { archetype: 'spring', x: 35 * TILE_SIZE, y: 9 * TILE_SIZE },
          { archetype: 'ember_warden', x: 22 * TILE_SIZE, y: 9 * TILE_SIZE, hp: 100 },
          { archetype: 'gate', x: 36 * TILE_SIZE, y: 9 * TILE_SIZE },
        ],
      },
    ],
    rules: [
      {
        id: 'fighter-combo-3',
        when: { type: 'OnSignal', signal: 'fighter_hit' },
        if: [{ varName: 'combo', op: '>=', value: 3 }],
        do: [
          { type: 'FloatText', text: '3 HIT COMBO!', color: '#ffd447', anchor: 'player', x: 0, y: -14 },
          { type: 'PlaySfx', preset: 'star' },
          { type: 'Juice', preset: 'charge_shot' },
        ],
      },
      {
        id: 'fighter-critical',
        when: { type: 'OnSignal', signal: 'fighter_hit' },
        if: [{ varName: 'p2Hp', op: '<=', value: 30 }],
        do: [{ type: 'FloatText', text: 'FINISHER!', color: '#ff5d8f', anchor: 'other', x: 0, y: -16 }],
      },
      {
        id: 'fighter-ko-win',
        when: { type: 'OnVar', varName: 'p2Hp', op: '<=', value: 0, edge: true },
        do: [{ type: 'EndGame', outcome: 'won' }],
      },
    ],
  };
}

export function buildCardTemplate(): CartridgeJsonV1 {
  const cols = 40;
  const rows = 12;
  const grid = makeEmptyGrid(cols, rows);
  fillFloorBand(grid, cols, rows, 0, cols - 1, 10, 2, 2);

  for (let c = 5; c <= 9; c++) setGridTile(grid, cols, rows, c, 7, 2, COLLISION_SOLID);
  for (let c = 16; c <= 23; c++) setGridTile(grid, cols, rows, c, 5, 3, COLLISION_CLOUD);
  for (let c = 30; c <= 34; c++) setGridTile(grid, cols, rows, c, 7, 2, COLLISION_SOLID);

  return {
    version: 1,
    meta: {
      id: 'custom-card-duel',
      code: 'CRD',
      title: '餘燼魔導牌局',
      subtitle: '畫布即時點擊牌組 × 回合制法力對決',
      genre: 'platformer',
      genreHud: 'card',
      viewport: 'wide',
      paletteRow: 2,
      glowIntensity: 1,
    },
    initialVars: {
      mana: 3,
      maxMana: 3,
      turn: 1,
      hp: 20,
      maxHp: 20,
      enemyHp: 20,
      maxEnemyHp: 20,
      shield: 0,
      combo: 0,
    },
    cardDeck: [...OFFICIAL_CARD_DECK],
    player: {
      controller: 'card',
      sprite: 'hero_a',
      spriteB: 'hero_b',
      w: 16,
      h: 16,
      maxHearts: 4,
    },
    archetypes: {
      astral_core: {
        sprite: 'astral_core',
        spriteB: 'star_b',
        animFps: 4,
        w: 16,
        h: 16,
        tags: ['enemy', 'boss'],
        behavior: { kind: 'sine', amplitude: 8, freq: 2.2 },
        hp: 20,
        scoreValue: 320,
        emissive: 0.92,
        light: { radius: 42, color: '#e0aaff', intensity: 0.6 },
      },
      crystal_reset: {
        sprite: 'crystal_reset',
        w: 16,
        h: 16,
        tags: ['crystal_reset'],
        emissive: 0.9,
        light: { radius: 28, color: '#5ec2f7', intensity: 0.52 },
      },
      star: {
        sprite: 'star_a',
        spriteB: 'star_b',
        animFps: 5,
        w: 16,
        h: 16,
        tags: ['collectible', 'star'],
        scoreValue: 100,
        emissive: 0.72,
      },
      gate: { sprite: 'gate_closed', spriteB: 'gate_open', w: 16, h: 16, tags: ['gate'] },
      spark: { sprite: 'sparkle', w: 8, h: 8, tags: ['bullet'], emissive: 0.95 },
    },
    stages: [
      {
        id: 'card-sanctum-1',
        name: '秘法星核牌桌殿堂',
        worldWidth: cols * TILE_SIZE,
        worldHeight: rows * TILE_SIZE,
        bgmTheme: 'starlight',
        paletteRow: 2,
        ambientDarkness: 0.14,
        hint: '左右/滑鼠選牌 · A/左鍵出牌 · Y/右鍵結束回合(敵-5傷並補3魔)',
        spawn: { x: 7 * TILE_SIZE, y: 9 * TILE_SIZE },
        artMood: {
          baseHex: '#181036',
          accentHex: '#e0aaff',
          warmth: 0.25,
          contrast: 0.72,
          parallaxFog: 0.3,
        },
        tileGrid: {
          cols,
          rows,
          tiles: grid.tiles,
          collision: grid.collision,
          spriteMap: { ...DEFAULT_SPRITE_MAP },
        },
        bgParallaxLayers: [
          {
            sprite: 'star_a',
            x: 12,
            y: 22,
            w: 10,
            h: 10,
            scrollX: 0.2,
            scrollY: 0.1,
            repeatW: cols * TILE_SIZE,
            repeatStepX: 88,
            tint: '#e0aaff',
            alpha: 0.58,
            additive: true,
            emissive: 0.75,
          },
        ],
        spawns: [
          { archetype: 'crystal_reset', x: 7 * TILE_SIZE, y: 6 * TILE_SIZE },
          { archetype: 'crystal_reset', x: 32 * TILE_SIZE, y: 6 * TILE_SIZE },
          { archetype: 'astral_core', x: 20 * TILE_SIZE, y: 8 * TILE_SIZE, hp: 20 },
          { archetype: 'gate', x: 36 * TILE_SIZE, y: 9 * TILE_SIZE },
        ],
      },
    ],
    rules: [
      {
        id: 'card-mana-surge',
        when: { type: 'OnSignal', signal: 'card_played' },
        if: [{ varName: 'mana', op: '>=', value: 2 }],
        do: [
          { type: 'FloatText', text: 'ARCANE FLOW!', color: '#5ec2f7', anchor: 'player', x: 0, y: -14 },
          { type: 'PlaySfx', preset: 'star' },
        ],
      },
      {
        id: 'card-turn-cue',
        when: { type: 'OnSignal', signal: 'turn_end' },
        do: [{ type: 'PlaySfx', preset: 'key' }],
      },
      {
        id: 'card-win',
        when: { type: 'OnVar', varName: 'enemyHp', op: '<=', value: 0, edge: true },
        do: [{ type: 'EndGame', outcome: 'won' }],
      },
    ],
  };
}

export function buildGridTemplate(): CartridgeJsonV1 {
  const cols = 40;
  const rows = 16;
  const grid = makeEmptyGrid(cols, rows);

  // Outer perimeter stone walls (cols 0..39, rows 0..15)
  for (let c = 0; c < cols; c++) {
    setGridTile(grid, cols, rows, c, 0, 2, COLLISION_SOLID);
    setGridTile(grid, cols, rows, c, rows - 1, 2, COLLISION_SOLID);
  }
  for (let r = 0; r < rows; r++) {
    setGridTile(grid, cols, rows, 0, r, 2, COLLISION_SOLID);
    setGridTile(grid, cols, rows, cols - 1, r, 2, COLLISION_SOLID);
  }

  // Interior stone puzzle partitions with walkable doorways
  for (let r = 1; r <= 11; r++) {
    if (r !== 6 && r !== 7) setGridTile(grid, cols, rows, 11, r, 2, COLLISION_SOLID);
  }
  for (let r = 4; r <= 14; r++) {
    if (r !== 9 && r !== 10) setGridTile(grid, cols, rows, 23, r, 2, COLLISION_SOLID);
  }
  setGridTile(grid, cols, rows, 6, 4, 2, COLLISION_SOLID);
  setGridTile(grid, cols, rows, 6, 5, 2, COLLISION_SOLID);
  setGridTile(grid, cols, rows, 17, 4, 2, COLLISION_SOLID);
  setGridTile(grid, cols, rows, 17, 5, 2, COLLISION_SOLID);
  setGridTile(grid, cols, rows, 30, 8, 2, COLLISION_SOLID);
  setGridTile(grid, cols, rows, 30, 9, 2, COLLISION_SOLID);
  // Small hazard corners
  setGridTile(grid, cols, rows, 15, 13, 4, COLLISION_HAZARD);
  setGridTile(grid, cols, rows, 27, 3, 4, COLLISION_HAZARD);

  return {
    version: 1,
    meta: {
      id: 'custom-logic-grid',
      code: 'GRD',
      title: '量子邏輯迴廊',
      subtitle: '8向俯視解謎 × 推箱壓感開關 × 門禁解鎖',
      genre: 'platformer',
      genreHud: 'grid',
      viewport: 'wide',
      paletteRow: 3,
      glowIntensity: 1,
    },
    initialVars: {
      switches: 0,
      switchesTotal: 3,
      combo: 0,
    },
    player: {
      controller: 'topdown',
      sprite: 'hero_a',
      spriteB: 'hero_b',
      w: 16,
      h: 16,
      maxHearts: 3,
    },
    archetypes: {
      switch_off: {
        sprite: 'switch_off',
        spriteB: 'switch_on',
        w: 16,
        h: 16,
        tags: ['logic_switch'],
        scoreValue: 120,
        emissive: 0.72,
      },
      crate: {
        sprite: 'crate',
        w: 16,
        h: 16,
        tags: ['solid'],
      },
      key: { sprite: 'key', w: 16, h: 16, tags: ['collectible', 'key'], scoreValue: 200, emissive: 0.78 },
      gate: { sprite: 'gate_closed', spriteB: 'gate_open', w: 16, h: 16, tags: ['gate'], emissive: 0.7 },
      star: { sprite: 'star_a', spriteB: 'star_b', w: 16, h: 16, tags: ['collectible', 'star'], scoreValue: 100, emissive: 0.7 },
      spark: { sprite: 'sparkle', w: 8, h: 8, tags: ['bullet'], emissive: 0.85 },
    },
    stages: [
      {
        id: 'grid-corridor-1',
        name: '地牢量子邏輯矩陣',
        worldWidth: cols * TILE_SIZE,
        worldHeight: rows * TILE_SIZE,
        bgmTheme: 'dungeon',
        paletteRow: 3,
        ambientDarkness: 0.16,
        hint: '八方向移動與推箱 · 踩亮 3 枚邏輯開關並取鑰匙解鎖終點門！',
        spawn: { x: 3 * TILE_SIZE, y: 8 * TILE_SIZE },
        artMood: {
          baseHex: '#131d2d',
          accentHex: '#5ec2f7',
          warmth: 0.18,
          contrast: 0.7,
          parallaxFog: 0.25,
        },
        tileGrid: {
          cols,
          rows,
          tiles: grid.tiles,
          collision: grid.collision,
          spriteMap: { ...DEFAULT_SPRITE_MAP },
        },
        fgTiles: [
          { sprite: 'torch', x: 2 * TILE_SIZE, y: 2 * TILE_SIZE, w: 16, h: 16, alpha: 0.92 },
          { sprite: 'torch', x: 36 * TILE_SIZE, y: 2 * TILE_SIZE, w: 16, h: 16, alpha: 0.92 },
        ],
        spawns: [
          { archetype: 'crate', x: 5 * TILE_SIZE, y: 8 * TILE_SIZE },
          { archetype: 'switch_off', x: 8 * TILE_SIZE, y: 8 * TILE_SIZE },
          { archetype: 'switch_off', x: 16 * TILE_SIZE, y: 9 * TILE_SIZE },
          { archetype: 'switch_off', x: 28 * TILE_SIZE, y: 11 * TILE_SIZE },
          { archetype: 'key', x: 20 * TILE_SIZE, y: 3 * TILE_SIZE },
          { archetype: 'gate', x: 35 * TILE_SIZE, y: 8 * TILE_SIZE },
        ],
      },
    ],
    rules: [
      {
        id: 'grid-switch-trigger',
        when: { type: 'OnSignal', signal: 'switch_on' },
        if: [{ varName: 'switches', op: '>=', value: 1 }],
        do: [
          { type: 'PlaySfx', preset: 'snap' },
          { type: 'Juice', preset: 'relic_burst' },
        ],
      },
      {
        id: 'grid-gate-open',
        when: { type: 'OnSignal', signal: 'gate_unlocked' },
        do: [
          { type: 'FloatText', text: 'GATE OPEN!', color: '#ffd447', anchor: 'player', x: 0, y: -14 },
          { type: 'PlaySfx', preset: 'win' },
        ],
      },
    ],
  };
}

export const WORKSHOP_TEMPLATES: readonly WorkshopTemplateEntry[] = [
  {
    id: 'parkour',
    buttonLabel: '🏃 PA-06',
    description: '載入 PA-06 緋空飛鉤跑酷 5 大試煉與 360° 飛鉤物理',
    build: buildParkourTemplate,
  },
  {
    id: 'fighter',
    buttonLabel: '🥊 格鬥',
    description: '1v1 格鬥狀態機擂台 + When→If→Do 連段規則',
    build: () => buildFighterTemplate(),
  },
  {
    id: 'card',
    buttonLabel: '🃏 卡牌',
    description: '畫布回合牌局 + 4 張卡牌與法力 When→If→Do 規則',
    build: () => buildCardTemplate(),
  },
  {
    id: 'grid',
    buttonLabel: '🧩 解謎',
    description: '8 向俯視推箱開關解謎 + 鑰匙終點門',
    build: () => buildGridTemplate(),
  },
];

export function buildWorkshopTemplate(id: WorkshopGenreTemplateId, host?: EngineHost): CartridgeJsonV1 {
  switch (id) {
    case 'parkour':
      return buildParkourTemplate(host);
    case 'fighter':
      return buildFighterTemplate();
    case 'card':
      return buildCardTemplate();
    case 'grid':
      return buildGridTemplate();
  }
}
