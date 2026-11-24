import type { EcsCustomSpriteDef, EcsProjectV2 } from '../../core/ecs/EcsProjectSchema.ts';
import { createEmptyRoom, setRoomTile, type EcsMapRoomDef, type EcsTileDef } from '../../core/ecs/EcsTilemapTypes.ts';

/**
 * Custom tile IDs for Emerald Ruins (all above built-in 1..15 range to prove
 * pure project-level custom tile definitions with zero built-in tile dependencies).
 */
export const EMERALD_TILE_IDS = {
  MOSS_FLOOR: 101,
  FOLIAGE_FLOOR: 102,
  RUNE_FLOOR: 103,
  STREAM_WATER: 104,
  JADE_WALL: 111,
  SEAL_GATE: 112,
  RUIN_PILLAR: 121,
  SANCTUM_BANNER: 122,
} as const;

const ER_PALETTE: string[] = [
  'transparent',
  '#0c1a16', // 1 deep outline
  '#e8fff3', // 2 bright highlight
  '#7ee8b7', // 3 emerald light
  '#2fb57a', // 4 jade mid
  '#196e4b', // 5 jade shadow
  '#45d9e8', // 6 cyan crystal
  '#1e7a94', // 7 teal shadow
  '#f2d16b', // 8 gold trim
  '#b58330', // 9 bronze
  '#d7d2c3', // 10 pale stone
  '#8c9288', // 11 moss stone
  '#545c56', // 12 slate dark
  '#a6633c', // 13 bark/wood
  '#6ef7c8', // 14 emissive dew glow
  '#fff099', // 15 emissive sun glow
];

function scaleGrid16To32(grid16: readonly string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < 16; y++) {
    const src = grid16[y] ?? '................';
    let row = '';
    for (let x = 0; x < 16; x++) {
      const ch = src[x] ?? '.';
      row += ch + ch;
    }
    out.push(row, row);
  }
  return out;
}

function scaleGrid24To48x64(grid24x32: readonly string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < 32; y++) {
    const src = grid24x32[y] ?? '........................';
    let row = '';
    for (let x = 0; x < 24; x++) {
      const ch = src[x] ?? '.';
      row += ch + ch;
    }
    out.push(row, row);
  }
  return out;
}

const RANGER_A_16 = [
  '.....111111.....',
  '....14333341....',
  '...1444444441...',
  '...1588888851...',
  '....12211221....',
  '....12122121....',
  '....12222221....',
  '...1544884451...',
  '..154434434451..',
  '..154444444451..',
  '..115488884511..',
  '....15444451....',
  '....11d11d11....',
  '....1d1..1d1....',
  '...1111..1111...',
  '................',
];

const RANGER_B_16 = [
  '.....111111.....',
  '....14333341....',
  '...1444444441...',
  '...1588888851...',
  '....12211221....',
  '....12122121....',
  '....12222221....',
  '...1544884451...',
  '..154434434451..',
  '.15444444444451.',
  '..115488884511..',
  '....15444451....',
  '...11d1..1d11...',
  '...1d1....1d1...',
  '..1111....1111..',
  '................',
];

const RANGER_SLASH_16 = [
  '.....111111..ee.',
  '....14333341.e2e',
  '...1444444441ee.',
  '...1588888851e..',
  '....12211221e...',
  '....12122121....',
  '....12222221....',
  '...1544884451e..',
  '..15443443445ee.',
  '..15444444445e2e',
  '..11548888451ee.',
  '....15444451....',
  '....11d11d11....',
  '...1d1....1d1...',
  '..1111....1111..',
  '................',
];

const LEAF_SLASH_16 = [
  '........1ee1....',
  '......1ee22ee1..',
  '.....1e222222e1.',
  '....1e22ee2222e1',
  '...1e2ee..e222e1',
  '...1ee.....e22e1',
  '..1e........e2e1',
  '..1e........eee1',
  '..1e........e2e1',
  '...1ee.....e22e1',
  '...1e2ee..e222e1',
  '....1e22ee2222e1',
  '.....1e222222e1.',
  '......1ee22ee1..',
  '........1ee1....',
  '................',
];

const GOLEM_16 = [
  '....11111111....',
  '...1aa3333aa1...',
  '..1aabbbbbbaa1..',
  '..1ab66bb66ba1..',
  '..1ab2ebbbe2a1..',
  '..1abbbbbbbba1..',
  '.111cbbbbbbc111.',
  '1ab1c446644c1ba1',
  '1ab1c46ee64c1ba1',
  '1ac1c446644c1ca1',
  '.111cbbbbbbc111.',
  '...1cb1111bc1...',
  '...1cb1..1bc1...',
  '..11cc1..1cc11..',
  '..11111..11111..',
  '................',
];

const RELIQUARY_CLOSED_16 = [
  '................',
  '................',
  '....11111111....',
  '...1888888881...',
  '..18d444444d81..',
  '..184488884481..',
  '..18888ee88881..',
  '..191182281191..',
  '..19d488884d91..',
  '..19d444444d91..',
  '..199999999991..',
  '...1111111111...',
  '................',
  '................',
  '................',
  '................',
];

const RELIQUARY_OPEN_16 = [
  '......eeee......',
  '.....e2ff2e.....',
  '....11111111....',
  '...1888228881...',
  '..18f22ff22f81..',
  '..188888888881..',
  '..1111eeee1111..',
  '..191182281191..',
  '..19d488884d91..',
  '..19d444444d91..',
  '..199999999991..',
  '...1111111111...',
  '................',
  '................',
  '................',
  '................',
];

const DEW_LOTUS_16 = [
  '.......ee.......',
  '......e22e......',
  '....11e22e11....',
  '...166e22e661...',
  '..16266ee66261..',
  '.16666222266661.',
  '.17662e22e26671.',
  '..1766eeee6671..',
  '...1176666711...',
  '..144117711441..',
  '.14334444443341.',
  '..154444444451..',
  '...1155555511...',
  '.....111111.....',
  '................',
  '................',
];

const WARDEN_24x32 = [
  '........11....11........',
  '.......1881..1881.......',
  '......18ff8118ff81......',
  '.....11888888888811.....',
  '....1aa3333333333aa1....',
  '...1aabbb888888bbbaa1...',
  '...1abbb66666666bbba1...',
  '..1abbb62eeeee26bbbba1..',
  '..1abbb62f222f26bbbba1..',
  '..1abbb666666666bbbba1..',
  '...1abbbbb8888bbbbba1...',
  '...11cbbbbbbbbbbbbc11...',
  '..1881c4466ee6644c1881..',
  '.18ff8c46ee22ee64c8ff81.',
  '.18888c46e2ff2e64c88881.',
  '.1ab88c46ee22ee64c88ba1.',
  '.1abbbc4466ee6644cbbba1.',
  '.1abbbcbbbb88bbbbcbbba1.',
  '.1accbcbb888888bbcbbca1.',
  '..1111cbb88ee88bbc1111..',
  '....1ccbb882288bbcc1....',
  '....1ccbbb8888bbbcc1....',
  '....1ccbbbbbbbbbbcc1....',
  '....1ccbb111111bbcc1....',
  '...1ccbb1......1bbcc1...',
  '...1ccbb1......1bbcc1...',
  '...1ccbb1......1bbcc1...',
  '..11ccc11......11ccc11..',
  '..188881........188881..',
  '..111111........111111..',
  '........................',
  '........................',
];

export const EMERALD_RUINS_CUSTOM_SPRITES: Record<string, EcsCustomSpriteDef> = {
  er_moss_floor: {
    id: 'er_moss_floor',
    name: '苔蘚遺跡石磚',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'cobble',
      baseHex: '#4f7a65',
      secondaryHex: '#253b34',
      accentHex: '#8ce0b2',
      seed: 101,
      dither: true,
      bevel: true,
    },
  },
  er_foliage_floor: {
    id: 'er_foliage_floor',
    name: '星露森林草叢',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'foliage',
      baseHex: '#2c8c5c',
      secondaryHex: '#154734',
      accentHex: '#c8f78e',
      seed: 202,
      dither: true,
    },
  },
  er_rune_pad: {
    id: 'er_rune_pad',
    name: '星露符文地坪',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'rune_floor',
      baseHex: '#355c58',
      secondaryHex: '#1b3033',
      accentHex: '#6ef7c8',
      seed: 303,
      dither: true,
      emissiveCore: true,
    },
  },
  er_stream_water: {
    id: 'er_stream_water',
    name: '聖域碧泉水域',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'water',
      baseHex: '#228fa6',
      secondaryHex: '#12465c',
      accentHex: '#b3f7ff',
      seed: 404,
      dither: true,
    },
  },
  er_jade_wall: {
    id: 'er_jade_wall',
    name: '翠律古殿石牆',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'bricks',
      baseHex: '#3f6b5e',
      secondaryHex: '#1a2e2b',
      accentHex: '#94e3be',
      seed: 505,
      dither: true,
      bevel: true,
      frameBorder: true,
    },
  },
  er_seal_gate: {
    id: 'er_seal_gate',
    name: '翠律封印古門',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'gate',
      baseHex: '#4f7f6d',
      secondaryHex: '#1f3632',
      accentHex: '#6ef7c8',
      seed: 606,
      dither: true,
    },
  },
  er_ruin_pillar: {
    id: 'er_ruin_pillar',
    name: '古殿藤柱 (32×48)',
    width: 32,
    height: 48,
    kind: 'procedural',
    recipe: {
      pattern: 'pillar',
      baseHex: '#7d9e8c',
      secondaryHex: '#2f453e',
      accentHex: '#d8f5c4',
      outlineHex: '#0f1f1a',
      seed: 707,
      dither: true,
    },
  },
  er_sanctum_banner: {
    id: 'er_sanctum_banner',
    name: '星露聖旗 (32×48)',
    width: 32,
    height: 48,
    kind: 'procedural',
    recipe: {
      pattern: 'banner',
      baseHex: '#1e8a74',
      secondaryHex: '#0f473e',
      accentHex: '#f2d16b',
      outlineHex: '#0c1a16',
      seed: 808,
      dither: true,
    },
  },
  er_crystal_off: {
    id: 'er_crystal_off',
    name: '沉睡共鳴晶柱',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'crystal',
      baseHex: '#48687a',
      secondaryHex: '#1c2b38',
      accentHex: '#9ec4d9',
      outlineHex: '#0c1a16',
      seed: 901,
      dither: true,
    },
  },
  er_crystal_on: {
    id: 'er_crystal_on',
    name: '覺醒共鳴晶柱',
    width: 32,
    height: 32,
    kind: 'procedural',
    recipe: {
      pattern: 'crystal',
      baseHex: '#2fd9b8',
      secondaryHex: '#166e64',
      accentHex: '#e6fff7',
      outlineHex: '#0c1a16',
      seed: 902,
      dither: true,
      emissiveCore: true,
    },
  },
  er_spore_orb: {
    id: 'er_spore_orb',
    name: '聖域光球彈',
    width: 16,
    height: 16,
    kind: 'procedural',
    recipe: {
      pattern: 'orb',
      baseHex: '#3be8b0',
      accentHex: '#fff5b8',
      outlineHex: '#0c241e',
      seed: 903,
      dither: true,
      emissiveCore: true,
    },
  },
  er_ranger_a: {
    id: 'er_ranger_a',
    name: '翠林遊俠 A',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(RANGER_A_16),
  },
  er_ranger_b: {
    id: 'er_ranger_b',
    name: '翠林遊俠 B',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(RANGER_B_16),
  },
  er_ranger_slash: {
    id: 'er_ranger_slash',
    name: '翠林遊俠 揮刃',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(RANGER_SLASH_16),
  },
  er_leaf_slash: {
    id: 'er_leaf_slash',
    name: '星露劍氣弧光',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(LEAF_SLASH_16),
  },
  er_forest_golem: {
    id: 'er_forest_golem',
    name: '遺跡苔石傀儡',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(GOLEM_16),
  },
  er_reliquary_closed: {
    id: 'er_reliquary_closed',
    name: '星露聖匣 (閉)',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(RELIQUARY_CLOSED_16),
  },
  er_reliquary_open: {
    id: 'er_reliquary_open',
    name: '星露聖匣 (開)',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(RELIQUARY_OPEN_16),
  },
  er_dew_lotus: {
    id: 'er_dew_lotus',
    name: '星露治癒蓮',
    width: 32,
    height: 32,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid16To32(DEW_LOTUS_16),
  },
  er_sanctum_warden: {
    id: 'er_sanctum_warden',
    name: '星露守護巨像 (48×64)',
    width: 48,
    height: 64,
    kind: 'grid',
    palette: ER_PALETTE,
    pixels: scaleGrid24To48x64(WARDEN_24x32),
  },
};

export const EMERALD_RUINS_TILE_DEFS: EcsTileDef[] = [
  { id: EMERALD_TILE_IDS.MOSS_FLOOR, name: '苔蘚遺跡石磚', layer: 'ground', sprite: 'er_moss_floor', solid: false },
  { id: EMERALD_TILE_IDS.FOLIAGE_FLOOR, name: '星露森林草叢', layer: 'ground', sprite: 'er_foliage_floor', solid: false },
  {
    id: EMERALD_TILE_IDS.RUNE_FLOOR,
    name: '星露符文地坪',
    layer: 'ground',
    sprite: 'er_rune_pad',
    solid: false,
    ambientLight: { radius: 88, color: '#6ef7c8', intensity: 0.55 },
  },
  { id: EMERALD_TILE_IDS.STREAM_WATER, name: '聖域碧泉水域', layer: 'ground', sprite: 'er_stream_water', solid: true },
  {
    id: EMERALD_TILE_IDS.JADE_WALL,
    name: '翠律古殿石牆',
    layer: 'wall',
    sprite: 'er_jade_wall',
    solid: true,
    extrudeH: 24,
    wallMaterial: 'stone',
    metallic: 0.22,
    roughness: 0.62,
    emissive: 0.04,
  },
  {
    id: EMERALD_TILE_IDS.SEAL_GATE,
    name: '翠律封印古門',
    layer: 'wall',
    sprite: 'er_seal_gate',
    solid: true,
    extrudeH: 20,
    unlockGlobal: 'grove_seal_open',
    ambientLight: { radius: 96, color: '#6ef7c8', intensity: 0.68 },
  },
  {
    id: EMERALD_TILE_IDS.RUIN_PILLAR,
    name: '古殿藤柱',
    layer: 'decor',
    sprite: 'er_ruin_pillar',
    solid: true,
    renderH: 48,
  },
  {
    id: EMERALD_TILE_IDS.SANCTUM_BANNER,
    name: '星露聖旗',
    layer: 'decor',
    sprite: 'er_sanctum_banner',
    solid: false,
    renderH: 48,
  },
];

function buildSunkenGroveRoom(): EcsMapRoomDef {
  const cols = 20;
  const rows = 14;
  const room = createEmptyRoom('sunken_grove', '翠律苔蘚中庭', cols, rows, EMERALD_TILE_IDS.MOSS_FLOOR);
  room.ambientDarkness = 0.28;
  room.skyTop = '#0d2224';
  room.skyBottom = '#163834';
  room.wallExtrudeH = 24;
  room.editorFocusY = 44;

  for (let c = 0; c < cols; c++) {
    setRoomTile(room, 'wall', c, 0, EMERALD_TILE_IDS.JADE_WALL);
    setRoomTile(room, 'wall', c, rows - 1, EMERALD_TILE_IDS.JADE_WALL);
    setRoomTile(room, 'ground', c, 1, EMERALD_TILE_IDS.FOLIAGE_FLOOR);
    setRoomTile(room, 'ground', c, rows - 2, EMERALD_TILE_IDS.FOLIAGE_FLOOR);
  }
  for (let r = 0; r < rows; r++) {
    setRoomTile(room, 'wall', 0, r, EMERALD_TILE_IDS.JADE_WALL);
    setRoomTile(room, 'wall', cols - 1, r, EMERALD_TILE_IDS.JADE_WALL);
    setRoomTile(room, 'ground', 1, r, EMERALD_TILE_IDS.FOLIAGE_FLOOR);
    setRoomTile(room, 'ground', cols - 2, r, EMERALD_TILE_IDS.FOLIAGE_FLOOR);
  }

  // North exit archway (cols 9..10) sealed by grove_seal_open
  setRoomTile(room, 'wall', 9, 0, EMERALD_TILE_IDS.SEAL_GATE);
  setRoomTile(room, 'wall', 10, 0, EMERALD_TILE_IDS.SEAL_GATE);
  for (let r = 1; r <= rows - 3; r++) {
    setRoomTile(room, 'ground', 9, r, EMERALD_TILE_IDS.RUNE_FLOOR);
    setRoomTile(room, 'ground', 10, r, EMERALD_TILE_IDS.RUNE_FLOOR);
  }

  // Reflective side streams
  for (let r = 5; r <= 9; r++) {
    setRoomTile(room, 'ground', 3, r, EMERALD_TILE_IDS.STREAM_WATER);
    setRoomTile(room, 'ground', cols - 4, r, EMERALD_TILE_IDS.STREAM_WATER);
  }

  // Mossy temple pillars & banners
  setRoomTile(room, 'decor', 6, 3, EMERALD_TILE_IDS.RUIN_PILLAR);
  setRoomTile(room, 'decor', 13, 3, EMERALD_TILE_IDS.RUIN_PILLAR);
  setRoomTile(room, 'decor', 6, 9, EMERALD_TILE_IDS.RUIN_PILLAR);
  setRoomTile(room, 'decor', 13, 9, EMERALD_TILE_IDS.RUIN_PILLAR);
  setRoomTile(room, 'decor', 8, 1, EMERALD_TILE_IDS.SANCTUM_BANNER);
  setRoomTile(room, 'decor', 11, 1, EMERALD_TILE_IDS.SANCTUM_BANNER);

  return room;
}

function buildSanctumAltarRoom(): EcsMapRoomDef {
  const cols = 18;
  const rows = 14;
  const room = createEmptyRoom('sanctum_altar', '星露聖壇', cols, rows, EMERALD_TILE_IDS.MOSS_FLOOR);
  room.ambientDarkness = 0.3;
  room.skyTop = '#0a1f24';
  room.skyBottom = '#153a38';
  room.wallExtrudeH = 26;
  room.editorFocusY = 0;

  for (let c = 0; c < cols; c++) {
    setRoomTile(room, 'wall', c, 0, EMERALD_TILE_IDS.JADE_WALL);
    setRoomTile(room, 'wall', c, rows - 1, EMERALD_TILE_IDS.JADE_WALL);
  }
  for (let r = 0; r < rows; r++) {
    setRoomTile(room, 'wall', 0, r, EMERALD_TILE_IDS.JADE_WALL);
    setRoomTile(room, 'wall', cols - 1, r, EMERALD_TILE_IDS.JADE_WALL);
  }

  // South return passage
  setRoomTile(room, 'wall', 8, rows - 1, 0);
  setRoomTile(room, 'wall', 9, rows - 1, 0);

  // Central sanctum rune dais
  for (let r = 3; r <= 7; r++) {
    for (let c = 6; c <= 11; c++) {
      setRoomTile(room, 'ground', c, r, EMERALD_TILE_IDS.RUNE_FLOOR);
    }
  }
  for (let c = 2; c <= 4; c++) {
    setRoomTile(room, 'ground', c, 2, EMERALD_TILE_IDS.STREAM_WATER);
    setRoomTile(room, 'ground', cols - 1 - c, 2, EMERALD_TILE_IDS.STREAM_WATER);
  }
  setRoomTile(room, 'decor', 4, 4, EMERALD_TILE_IDS.RUIN_PILLAR);
  setRoomTile(room, 'decor', 13, 4, EMERALD_TILE_IDS.RUIN_PILLAR);
  setRoomTile(room, 'decor', 5, 1, EMERALD_TILE_IDS.SANCTUM_BANNER);
  setRoomTile(room, 'decor', 12, 1, EMERALD_TILE_IDS.SANCTUM_BANNER);

  return room;
}

export const EMERALD_RUINS_PROJECT: EcsProjectV2 = {
  schemaVersion: 2,
  meta: {
    id: 'emerald-ruins',
    code: 'PA-15',
    title: '翠律遺跡：星露聖域',
    subtitle: '100% 專案自訂像素圖集 × 跨主題 HD-2D 多房間動作冒險',
    genre: 'HD-2D 自訂瓦片冒險',
    accentHex: '#2fd9b8',
    controlsHint: 'WASD 移動 · J / A 斬擊共鳴 · Space / B 翻滾衝刺',
    goalHint: '喚醒中庭 2 座共鳴晶柱解開翠律古門，前往星露聖壇擊敗守護巨像',
  },
  viewport: {
    preset: 'hd_plus',
    width: 640,
    height: 360,
  },
  atmosphere: {
    skyTop: '#0d2224',
    skyBottom: '#163834',
    ambientDarkness: 0.28,
    gridLines: false,
    shadowOcclusion: true,
    shadowStrength: 0.84,
    shadowSoftness: 0.42,
    tiltShiftBlur: 0.38,
    tiltShiftFocusY: 0.52,
    ambientParticles: 'fireflies',
    ambientParticleDensity: 0.7,
    juiceScale: 1.0,
  },
  projection: {
    mode: 'hd2d_3d',
    pitchDeg: 42,
    fovDeg: 38,
    wallHeightScale: 1.25,
    billboardTiltDeg: 12,
    obliqueShadowAlpha: 0.42,
    elevationScale: 1.0,
    perspectiveSkew: 0.055,
    activeDimensionMask: 3,
    inactiveDimAlpha: 0.35,
    allowDimensionShift: false,
  },
  customSprites: EMERALD_RUINS_CUSTOM_SPRITES,
  worldMap: {
    tileSize: 32,
    startRoomId: 'sunken_grove',
    rooms: [buildSunkenGroveRoom(), buildSanctumAltarRoom()],
    portals: [
      {
        id: 'grove_to_sanctum',
        name: '星露聖壇古門',
        fromRoomId: 'sunken_grove',
        col: 9,
        row: 0,
        cols: 2,
        rows: 1,
        toRoomId: 'sanctum_altar',
        targetX: 288,
        targetY: 368,
        requiresGlobal: 'grove_seal_open',
        lockedHint: '請先斬擊或觸碰中庭 2 座共鳴晶柱以解除封印！',
      },
      {
        id: 'sanctum_to_grove',
        name: '返回苔蘚中庭',
        fromRoomId: 'sanctum_altar',
        col: 8,
        row: 13,
        cols: 2,
        rows: 1,
        toRoomId: 'sunken_grove',
        targetX: 320,
        targetY: 84,
      },
    ],
    tileDefs: EMERALD_RUINS_TILE_DEFS,
    heroConfig: {
      walkSpriteA: 'er_ranger_a',
      walkSpriteB: 'er_ranger_b',
      slashSprite: 'er_leaf_slash',
      slashColor: '#6ef7c8',
      slashReach: 44,
      dashSpeedMultiplier: 2.35,
    },
    hostileProjectileTag: 'spore_orb',
    interactions: [
      {
        tag: 'resonance_crystal',
        trigger: 'slash_or_touch',
        radius: 30,
        oneShot: true,
        addGlobal: 'crystals_attuned',
        addGlobalDelta: 1,
        thresholdCount: 2,
        thresholdUnlockGlobal: 'grove_seal_open',
        scoreDelta: 150,
        swapSprite: 'er_crystal_on',
        popupText: '共鳴晶柱已喚醒 ({val}/2)',
        popupColor: '#6ef7c8',
        thresholdPopup: '雙晶共鳴完成！北方翠律古門已開啟！',
        thresholdPopupColor: '#fde047',
        soundEvent: 'key',
      },
      {
        tag: 'dew_reliquary',
        trigger: 'slash_or_touch',
        radius: 28,
        oneShot: true,
        setGlobal: 'has_dew_sigil',
        setGlobalValue: 1,
        healAmount: 3,
        scoreDelta: 120,
        swapSprite: 'er_reliquary_open',
        popupText: '星露聖匣 +3 HP！',
        popupColor: '#f2d16b',
        soundEvent: 'star',
      },
      {
        tag: 'dew_lotus',
        trigger: 'touch',
        radius: 26,
        oneShot: true,
        healAmount: 4,
        scoreDelta: 80,
        destroyOnUse: true,
        popupText: '星露治癒蓮 +4 HP！',
        popupColor: '#6ef7c8',
        soundEvent: 'star',
      },
    ],
    aiProfiles: {
      ruin_golem: {
        chaseRange: 210,
        stopRange: 16,
        moveSpeed: 54,
        contactDamage: 1,
        contactRange: 22,
        scoreOnDefeat: 180,
        knockback: 16,
      },
      sanctum_warden: {
        chaseRange: 420,
        stopRange: 44,
        moveSpeed: 60,
        phase2Speed: 84,
        phase2HpRatio: 0.5,
        phase2Popup: '守護巨像覺醒：星露暴走！',
        contactDamage: 1,
        contactRange: 30,
        scoreOnDefeat: 1000,
        knockback: 8,
        hitReachBonus: 12,
        isBoss: true,
        winOnDefeat: true,
        hitPopup: '-1 巨像受創！',
        defeatPopup: '星露守護巨像 討伐成功！',
        projectilePrefab: 'spore_orb',
        projectileTag: 'spore_orb',
        projectileInterval: 1.85,
        projectilePhase2Interval: 1.25,
        projectileCount: 3,
        projectilePhase2Count: 5,
        projectileSpeed: 138,
        projectilePhase2Speed: 168,
        projectileSpreadRad: 0.65,
        projectilePhase2SpreadRad: 1.15,
      },
    },
  },
  paths: {},
  animations: [
    {
      id: 'anim_er_ranger',
      initialState: 'idle',
      clips: [
        { name: 'idle', frames: ['er_ranger_a'], fps: 3, loop: true },
        { name: 'walk', frames: ['er_ranger_a', 'er_ranger_b'], fps: 7, loop: true },
        { name: 'attack', frames: ['er_ranger_slash'], fps: 12, loop: false },
      ],
      transitions: [
        { from: '*', to: 'attack', param: 'attacking', op: 'gt', value: 0.5, priority: 10 },
        { from: 'attack', to: 'walk', param: 'attacking', op: 'lte', value: 0.5, priority: 5 },
        { from: 'idle', to: 'walk', param: 'speed', op: 'gt', value: 10, priority: 2 },
        { from: 'walk', to: 'idle', param: 'speed', op: 'lte', value: 10, priority: 1 },
      ],
    },
  ],
  prefabs: {
    resonance_crystal: {
      id: 'resonance_crystal',
      name: '共鳴晶柱',
      category: 'puzzle',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32, zOrder: 18 },
        sprite: { sprite: 'er_crystal_off', metallic: 0.35, roughness: 0.25, emissive: 0.55, castShadow: true },
        light: { radius: 92, color: '#6ef7c8', intensity: 0.72 },
        collider: { radius: 14, isSolid: false },
        tag: 'resonance_crystal',
      },
    },
    dew_reliquary: {
      id: 'dew_reliquary',
      name: '星露聖匣',
      category: 'treasure',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32, zOrder: 18 },
        sprite: { sprite: 'er_reliquary_closed', metallic: 0.55, roughness: 0.3, emissive: 0.18, castShadow: true },
        light: { radius: 74, color: '#f2d16b', intensity: 0.55 },
        collider: { radius: 14, isSolid: false },
        tag: 'dew_reliquary',
      },
    },
    dew_lotus: {
      id: 'dew_lotus',
      name: '星露治癒蓮',
      category: 'item',
      components: {
        transform: { x: 0, y: 0, w: 28, h: 28, zOrder: 16 },
        sprite: { sprite: 'er_dew_lotus', metallic: 0.15, roughness: 0.25, emissive: 0.65, castShadow: false },
        light: { radius: 70, color: '#6ef7c8', intensity: 0.62 },
        collider: { radius: 12, isSolid: false },
        tag: 'dew_lotus',
      },
    },
    ruin_golem: {
      id: 'ruin_golem',
      name: '遺跡苔石傀儡',
      category: 'enemy',
      components: {
        transform: { x: 0, y: 0, w: 32, h: 32, zOrder: 24 },
        body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 6 },
        sprite: { sprite: 'er_forest_golem', metallic: 0.25, roughness: 0.65, emissive: 0.22, castShadow: true },
        health: { hp: 3, maxHp: 3, team: 2 },
        collider: { radius: 13, isSolid: false, damage: 1, hitTag: 'hero' },
        tag: 'ruin_golem',
      },
    },
    sanctum_warden: {
      id: 'sanctum_warden',
      name: '星露守護巨像',
      category: 'boss',
      components: {
        transform: { x: 0, y: 0, w: 48, h: 64, zOrder: 28 },
        body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 5 },
        sprite: { sprite: 'er_sanctum_warden', metallic: 0.45, roughness: 0.35, emissive: 0.45, castShadow: true },
        light: { radius: 148, color: '#3be8b0', intensity: 0.9 },
        health: { hp: 14, maxHp: 14, team: 2 },
        collider: { radius: 20, isSolid: false, damage: 1, hitTag: 'hero' },
        tag: 'sanctum_warden',
      },
    },
    spore_orb: {
      id: 'spore_orb',
      name: '翠律星露孢子彈',
      category: 'projectile',
      components: {
        transform: { x: 0, y: 0, w: 16, h: 16, zOrder: 32 },
        body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 0 },
        sprite: { sprite: 'er_spore_orb', metallic: 0.1, roughness: 0.2, emissive: 0.9, castShadow: false },
        light: { radius: 54, color: '#3be8b0', intensity: 0.65 },
        collider: { radius: 7, isSolid: false, damage: 1, hitTag: 'hero' },
        tag: 'spore_orb',
      },
    },
  },
  entities: [
    {
      id: 'hero',
      name: '翠林遊俠',
      roomId: 'sunken_grove',
      components: {
        transform: { x: 320, y: 344, w: 32, h: 32, zOrder: 30 },
        body2d: { vx: 0, vy: 0, gravityScale: 0, drag: 10 },
        sprite: { sprite: 'er_ranger_a', metallic: 0.3, roughness: 0.4, emissive: 0.12, castShadow: true },
        light: { radius: 120, color: '#b3ffe3', intensity: 0.68 },
        health: { hp: 8, maxHp: 8, team: 1 },
        collider: { radius: 11, isSolid: false },
        characterMotor2d: { moveSpeed: 138, topDown: true, dashSpeed: 310, dashDurationSec: 0.16, dashCooldownSec: 0.55 },
        animatorId: 'anim_er_ranger',
        tag: 'hero',
      },
    },
    {
      id: 'crystal_west',
      name: '西側共鳴晶柱',
      prefabId: 'resonance_crystal',
      roomId: 'sunken_grove',
      components: {},
      overrides: { transform: { x: 176, y: 176 } },
    },
    {
      id: 'crystal_east',
      name: '東側共鳴晶柱',
      prefabId: 'resonance_crystal',
      roomId: 'sunken_grove',
      components: {},
      overrides: { transform: { x: 464, y: 176 } },
    },
    {
      id: 'grove_reliquary',
      name: '中庭星露聖匣',
      prefabId: 'dew_reliquary',
      roomId: 'sunken_grove',
      components: {},
      overrides: { transform: { x: 464, y: 336 } },
    },
    {
      id: 'golem_1',
      name: '苔石傀儡甲',
      prefabId: 'ruin_golem',
      roomId: 'sunken_grove',
      components: {},
      overrides: { transform: { x: 320, y: 208 } },
    },
    {
      id: 'altar_lotus_l',
      name: '左聖露蓮',
      prefabId: 'dew_lotus',
      roomId: 'sanctum_altar',
      components: {},
      overrides: { transform: { x: 144, y: 288 } },
    },
    {
      id: 'altar_lotus_r',
      name: '右聖露蓮',
      prefabId: 'dew_lotus',
      roomId: 'sanctum_altar',
      components: {},
      overrides: { transform: { x: 432, y: 288 } },
    },
    {
      id: 'warden_boss',
      name: '星露守護巨像',
      prefabId: 'sanctum_warden',
      roomId: 'sanctum_altar',
      components: {},
      overrides: { transform: { x: 264, y: 136 } },
    },
  ],
  scripts: {},
  cutscenes: [
    {
      id: 'grove_arrival',
      name: '翠律苔蘚中庭巡禮',
      trigger: 'manual',
      roomId: 'sunken_grove',
      skippable: true,
      handbackDurationSec: 0.45,
      shots: [
        {
          id: 'grove_overview_ws',
          durationSec: 1.3,
          subject: 'point',
          focusX: 320,
          focusY: 224,
          shotSize: 'WS',
          anchor: 'center',
          motion: 'spring',
          motivation: 'establish_sunken_grove',
          letterbox: 0.9,
          spotlightDarkness: 0.08,
        },
        {
          id: 'grove_ranger_lead_ms',
          durationSec: 1.5,
          subject: 'hero',
          shotSize: 'MS',
          anchor: 'lead_room',
          motion: 'spring',
          zoomOverride: 1.18,
          motivation: 'ranger_enters_emerald_ruins',
          splashTitle: '翠律遺跡',
          splashSubtitle: 'EMERALD RUINS',
          letterbox: 0.9,
          spotlightDarkness: 0.1,
        },
      ],
    },
    {
      id: 'warden_awakening',
      name: '星露守護巨像覺醒',
      trigger: 'on_room_enter',
      roomId: 'sanctum_altar',
      skippable: true,
      handbackDurationSec: 0.5,
      shots: [
        {
          id: 'altar_overview_ws',
          durationSec: 1.2,
          subject: 'point',
          focusX: 288,
          focusY: 224,
          shotSize: 'WS',
          anchor: 'center',
          motion: 'spring',
          motivation: 'enter_sanctum_altar',
          letterbox: 0.95,
          spotlightDarkness: 0.12,
        },
        {
          id: 'warden_close_cu',
          durationSec: 1.5,
          subject: 'warden_boss',
          shotSize: 'CU',
          anchor: 'center',
          motion: 'push_in',
          motivation: 'sanctum_warden_awakening',
          splashTitle: 'SANCTUM WARDEN',
          splashSubtitle: '星露守護巨像',
          shakeTrauma: 0.35,
          letterbox: 1.0,
          spotlightDarkness: 0.22,
        },
        {
          id: 'warden_duel_two_shot',
          durationSec: 1.5,
          subject: 'hero',
          secondarySubject: 'warden_boss',
          shotSize: 'MS',
          anchor: 'two_shot',
          motion: 'spring',
          motivation: 'ranger_confronts_warden',
          letterbox: 0.85,
          spotlightDarkness: 0.1,
        },
      ],
    },
  ],
  globals: {
    crystals_attuned: 0,
    grove_seal_open: 0,
    has_dew_sigil: 0,
    warden_hp: 14,
  },
  hud: [
    { kind: 'bar', x: 16, y: 14, w: 120, h: 10, label: '星露共鳴', globalKey: 'crystals_attuned', maxVal: 2, color: '#3be8b0' },
    { kind: 'bar', x: 472, y: 14, w: 148, h: 10, label: '守護巨像', globalKey: 'warden_hp', maxVal: 14, color: '#f2d16b' },
  ],
};
