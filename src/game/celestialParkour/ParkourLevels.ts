import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { hexToRgb01Into, mixOklabRgb01, rgb01ToHex } from '../../core/math/ColorMath.ts';
import type { CartridgeArtMoodDef, CartridgeStageDef } from '../../core/sim/CartridgeSchema.ts';
import {
  applyOklabParallaxFog,
  resolveStageArtMood,
  type ResolvedStageArtMood,
} from '../../core/sim/ProceduralStageCompiler.ts';
import {
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  COLLISION_HAZARD,
  COLLISION_SOLID,
  TILE_SIZE,
  TilemapGrid,
} from '../../core/sim/TilemapGrid.ts';
import type { BgCloudDesc, BgParallaxLayerDesc, BgmTheme, TileDesc, WallMaterialKind } from '../../core/types/WorldTypes.ts';

export interface ParkourTileRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'solid' | 'cloud' | 'hazard';
  topSprite: SpriteId;
  fillSprite?: SpriteId;
  tint?: string;
  wallMaterial?: WallMaterialKind;
}

export interface ParkourGrappleRing {
  x: number;
  y: number;
}

export interface ParkourZipBlockDef {
  x: number;
  y: number;
  endX: number;
  endY: number;
  w: number;
  h: number;
  speed: number;
}

export interface ParkourCrumbleDef {
  x: number;
  y: number;
  w: number;
}

export interface ParkourCrystalDef {
  x: number;
  y: number;
}

export interface ParkourUpdraftDef {
  x: number;
  y: number;
  w: number;
  h: number;
  liftAccel: number;
  windX?: number;
}

export interface ParkourLaserDef {
  x: number;
  y: number;
  w: number;
  h: number;
  period: number;
  onDuration: number;
  phase: number;
}

export interface ParkourCheckpointDef {
  x: number;
  y: number;
}

export interface ParkourStageSpec {
  id: string;
  name: string;
  worldWidth: number;
  worldHeight: number;
  bgmTheme: BgmTheme;
  paletteRow: number;
  ambientDarkness: number;
  hint: string;
  artMood: CartridgeArtMoodDef;
  spawn: { x: number; y: number };
  exitGate: { x: number; y: number };
  hasIkBoss: boolean;
  tileRects: readonly ParkourTileRect[];
  grappleRings: readonly ParkourGrappleRing[];
  zipBlocks: readonly ParkourZipBlockDef[];
  crumbleBlocks: readonly ParkourCrumbleDef[];
  resetCrystals: readonly ParkourCrystalDef[];
  updrafts: readonly ParkourUpdraftDef[];
  lasers: readonly ParkourLaserDef[];
  checkpoints: readonly ParkourCheckpointDef[];
}

export interface CompiledParkourStage {
  spec: ParkourStageSpec;
  mood: ResolvedStageArtMood;
  tilemap: TilemapGrid;
  tiles: TileDesc[];
  fgTiles: TileDesc[];
  bgParallaxLayers: BgParallaxLayerDesc[];
  bgClouds: BgCloudDesc[];
}

export const PARKOUR_VIEWPORT_W = 480;
export const PARKOUR_VIEWPORT_H = 270;

export const PARKOUR_STAGES: readonly ParkourStageSpec[] = [
  // Stage 1: 【緋雲斷崖・飛鉤初鳴】 — Wave-Dash + grapple swing across chasms
  {
    id: 'cp-01-crimson-cliffs',
    name: '【緋雲斷崖・飛鉤初鳴】',
    worldWidth: 1920,
    worldHeight: 544,
    bgmTheme: 'meadow',
    paletteRow: 1,
    ambientDarkness: 0.04,
    hint: 'A+↘+B 波動衝刺！長按 Y 飛鉤擺盪越過裂谷，R 高速牽引上牆',
    artMood: { baseHex: '#4f2448', accentHex: '#ff5d8f', warmth: 0.45, contrast: 0.72, parallaxFog: 0.48 },
    spawn: { x: 64, y: 400 },
    exitGate: { x: 1848, y: 296 },
    hasIkBoss: false,
    tileRects: [
      // Left boundary & overhead starter grapple arch (104px above spawn center)
      { x: 0, y: 192, w: 16, h: 224, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 16, y: 272, w: 320, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      // Cliff 1 flat Wave-Dash runway
      { x: 0, y: 416, w: 400, h: 128, kind: 'solid', topSprite: 'grass', fillSprite: 'dirt', wallMaterial: 'earth' },
      // Overhead ceiling over Chasm 1 & recovery cloud
      { x: 416, y: 176, w: 176, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 464, y: 432, w: 64, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      // Cliff 2 + checkpoint
      { x: 608, y: 384, w: 208, h: 160, kind: 'solid', topSprite: 'grass', fillSprite: 'dirt', wallMaterial: 'earth' },
      // Spike pit floor & spikes
      { x: 816, y: 464, w: 128, h: 80, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 816, y: 448, w: 128, h: 16, kind: 'hazard', topSprite: 'trap' },
      // Wall-jump chimney & upper ledge
      { x: 944, y: 384, w: 128, h: 160, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 944, y: 208, w: 32, h: 128, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 1040, y: 192, w: 32, h: 224, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 1072, y: 192, w: 128, h: 32, kind: 'solid', topSprite: 'grass', fillSprite: 'stone', wallMaterial: 'stone' },
      // Mid-gauntlet overhead grapple beam & Cliff 3
      { x: 1248, y: 96, w: 176, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 1472, y: 336, w: 160, h: 208, kind: 'solid', topSprite: 'grass', fillSprite: 'dirt', wallMaterial: 'earth' },
      // Final chasm cloud & Summit Cliff
      { x: 1664, y: 384, w: 64, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      { x: 1776, y: 320, w: 144, h: 224, kind: 'solid', topSprite: 'grass', fillSprite: 'dirt', wallMaterial: 'earth' },
      { x: 1904, y: 144, w: 16, h: 176, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
    ],
    grappleRings: [
      { x: 464, y: 264 },
      { x: 544, y: 256 },
      { x: 864, y: 288 },
      { x: 1008, y: 160 },
      { x: 1328, y: 160 },
      { x: 1664, y: 240 },
      { x: 1744, y: 216 },
    ],
    zipBlocks: [
      { x: 196, y: 344, endX: 336, endY: 304, w: 20, h: 20, speed: 260 },
      { x: 1296, y: 256, endX: 1456, endY: 224, w: 20, h: 20, speed: 290 },
    ],
    crumbleBlocks: [
      { x: 816, y: 384, w: 32 },
      { x: 880, y: 384, w: 32 },
      { x: 1232, y: 240, w: 48 },
    ],
    resetCrystals: [
      { x: 352, y: 388 },
      { x: 448, y: 336 },
      { x: 1376, y: 208 },
      { x: 1704, y: 288 },
    ],
    updrafts: [
      { x: 400, y: 224, w: 192, h: 272, liftAccel: 410, windX: 24 },
      { x: 1632, y: 208, w: 144, h: 288, liftAccel: 430, windX: 20 },
    ],
    lasers: [],
    checkpoints: [
      { x: 640, y: 368 },
      { x: 1504, y: 320 },
    ],
  },

  // Stage 2: 【結晶垂直井・飛鉤牽引與蹬牆】 — wall zip-pull + wall jump chains
  {
    id: 'cp-02-crystal-well',
    name: '【結晶垂直井・飛鉤牽引與蹬牆】',
    worldWidth: 1920,
    worldHeight: 640,
    bgmTheme: 'starlight',
    paletteRow: 6,
    ambientDarkness: 0.14,
    hint: '按 R 飛鉤牽引直衝晶壁並自動貼牆滑行，接續蹬牆跳攀登垂直井！',
    artMood: { baseHex: '#183862', accentHex: '#5ec2f7', warmth: -0.35, contrast: 0.78, parallaxFog: 0.52 },
    spawn: { x: 64, y: 544 },
    exitGate: { x: 1840, y: 136 },
    hasIkBoss: false,
    tileRects: [
      // Outer left wall & floor
      { x: 0, y: 64, w: 16, h: 496, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 0, y: 560, w: 320, h: 80, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      // Vertical Well 1 walls (x=256..416)
      { x: 240, y: 240, w: 32, h: 224, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 352, y: 192, w: 32, h: 448, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      // Spike basin inside shaft 1
      { x: 320, y: 592, w: 32, h: 48, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 320, y: 576, w: 32, h: 16, kind: 'hazard', topSprite: 'trap' },
      // Upper transition bridge 1
      { x: 384, y: 192, w: 208, h: 32, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      // Descent / climb chamber 2
      { x: 640, y: 320, w: 128, h: 32, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 768, y: 128, w: 32, h: 224, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 880, y: 96, w: 32, h: 288, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 800, y: 400, w: 112, h: 240, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 800, y: 384, w: 80, h: 16, kind: 'hazard', topSprite: 'trap' },
      // Mid checkpoint terrace
      { x: 912, y: 208, w: 192, h: 32, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      // Crystal grapple gorge
      { x: 1136, y: 272, w: 64, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      { x: 1264, y: 112, w: 32, h: 176, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1392, y: 80, w: 32, h: 208, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1424, y: 240, w: 176, h: 32, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      // Final crystal tower & exit
      { x: 1632, y: 192, w: 48, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      { x: 1744, y: 160, w: 176, h: 480, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1904, y: 32, w: 16, h: 128, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
    ],
    grappleRings: [
      { x: 304, y: 368 },
      { x: 304, y: 208 },
      { x: 608, y: 192 },
      { x: 840, y: 208 },
      { x: 1184, y: 160 },
      { x: 1344, y: 144 },
      { x: 1664, y: 112 },
    ],
    zipBlocks: [
      { x: 160, y: 464, endX: 160, endY: 272, w: 20, h: 20, speed: 280 },
      { x: 976, y: 144, endX: 1120, endY: 144, w: 20, h: 20, speed: 300 },
      { x: 1552, y: 176, endX: 1696, endY: 112, w: 20, h: 20, speed: 300 },
    ],
    crumbleBlocks: [
      { x: 640, y: 240, w: 48 },
      { x: 1200, y: 240, w: 48 },
      { x: 1680, y: 192, w: 48 },
    ],
    resetCrystals: [
      { x: 304, y: 288 },
      { x: 704, y: 256 },
      { x: 840, y: 128 },
      { x: 1344, y: 208 },
      { x: 1648, y: 144 },
    ],
    updrafts: [
      { x: 272, y: 224, w: 80, h: 320, liftAccel: 380, windX: 0 },
    ],
    lasers: [
      { x: 464, y: 112, w: 16, h: 80, period: 2.2, onDuration: 1.0, phase: 0.2 },
    ],
    checkpoints: [
      { x: 448, y: 176 },
      { x: 960, y: 192 },
    ],
  },

  // Stage 3: 【齒輪崩落迴廊・動態錨點】 — zip blocks, crumble tiles, lasers/spikes
  {
    id: 'cp-03-gear-corridor',
    name: '【齒輪崩落迴廊・動態錨點】',
    worldWidth: 2240,
    worldHeight: 576,
    bgmTheme: 'dungeon',
    paletteRow: 3,
    ambientDarkness: 0.16,
    hint: '抓準脈衝雷射間隙！利用碎裂石階與齒輪滑索塊動量連續彈射！',
    artMood: { baseHex: '#3d221c', accentHex: '#f59b23', warmth: 0.55, contrast: 0.76, parallaxFog: 0.44 },
    spawn: { x: 64, y: 400 },
    exitGate: { x: 2144, y: 248 },
    hasIkBoss: false,
    tileRects: [
      { x: 0, y: 160, w: 16, h: 256, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 0, y: 416, w: 288, h: 160, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'stone' },
      // Overhead clockwork beams
      { x: 240, y: 192, w: 256, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 352, y: 496, w: 192, h: 80, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 352, y: 480, w: 192, h: 16, kind: 'hazard', topSprite: 'trap' },
      // Mid-corridor gear deck 1
      { x: 624, y: 368, w: 176, h: 208, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 688, y: 176, w: 32, h: 128, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      // Laser bridge & crumble run
      { x: 896, y: 416, w: 208, h: 160, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 960, y: 400, w: 64, h: 16, kind: 'hazard', topSprite: 'trap' },
      { x: 944, y: 192, w: 144, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      // Checkpoint 2 island
      { x: 1280, y: 352, w: 176, h: 224, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'stone' },
      // Final gear vault
      { x: 1504, y: 400, w: 80, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      { x: 1680, y: 160, w: 240, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 1760, y: 496, w: 160, h: 80, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 1760, y: 480, w: 160, h: 16, kind: 'hazard', topSprite: 'trap' },
      { x: 2064, y: 272, w: 176, h: 304, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'stone' },
      { x: 2224, y: 112, w: 16, h: 160, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'stone' },
    ],
    grappleRings: [
      { x: 352, y: 272 },
      { x: 528, y: 256 },
      { x: 1008, y: 272 },
      { x: 1184, y: 256 },
      { x: 1616, y: 240 },
      { x: 1808, y: 240 },
      { x: 1968, y: 208 },
    ],
    zipBlocks: [
      { x: 240, y: 352, endX: 400, endY: 320, w: 20, h: 20, speed: 300 },
      { x: 800, y: 304, endX: 944, endY: 272, w: 20, h: 20, speed: 310 },
      { x: 1456, y: 288, endX: 1632, endY: 256, w: 20, h: 20, speed: 310 },
      { x: 1888, y: 304, endX: 2032, endY: 224, w: 20, h: 20, speed: 320 },
    ],
    crumbleBlocks: [
      { x: 320, y: 400, w: 48 },
      { x: 480, y: 384, w: 48 },
      { x: 560, y: 368, w: 48 },
      { x: 1120, y: 384, w: 48 },
      { x: 1200, y: 368, w: 48 },
      { x: 1664, y: 336, w: 48 },
      { x: 1936, y: 304, w: 48 },
    ],
    resetCrystals: [
      { x: 432, y: 336 },
      { x: 848, y: 256 },
      { x: 1152, y: 320 },
      { x: 1648, y: 272 },
      { x: 1968, y: 256 },
    ],
    updrafts: [
      { x: 544, y: 224, w: 80, h: 288, liftAccel: 420, windX: 18 },
    ],
    lasers: [
      { x: 752, y: 224, w: 16, h: 144, period: 2.0, onDuration: 0.85, phase: 0.0 },
      { x: 1040, y: 224, w: 16, h: 192, period: 2.2, onDuration: 0.9, phase: 0.7 },
      { x: 1744, y: 192, w: 16, h: 192, period: 2.0, onDuration: 0.85, phase: 1.1 },
    ],
    checkpoints: [
      { x: 656, y: 352 },
      { x: 1312, y: 336 },
    ],
  },

  // Stage 4: 【亂流嵐域・Curl 風暴高塔】 — curlNoise updraft storms, 3-crystal grapple swing chains
  {
    id: 'cp-04-curl-storm',
    name: '【亂流嵐域・Curl 風暴高塔】',
    worldWidth: 2240,
    worldHeight: 640,
    bgmTheme: 'starlight',
    paletteRow: 2,
    ambientDarkness: 0.12,
    hint: '乘著 Curl 亂流上升風柱騰空，串聯 3 顆重置結晶完成空中長距離擺盪！',
    artMood: { baseHex: '#1a1945', accentHex: '#72efdd', warmth: -0.2, contrast: 0.82, parallaxFog: 0.58 },
    spawn: { x: 64, y: 496 },
    exitGate: { x: 2144, y: 152 },
    hasIkBoss: false,
    tileRects: [
      { x: 0, y: 160, w: 16, h: 352, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 0, y: 512, w: 288, h: 128, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      // Storm island 1
      { x: 352, y: 416, w: 96, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      { x: 528, y: 352, w: 176, h: 288, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      // Storm Tower mid-cliff
      { x: 896, y: 208, w: 144, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1120, y: 288, w: 176, h: 352, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      // High sky storm beams for 3-crystal swing chain
      { x: 1360, y: 112, w: 240, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1696, y: 96, w: 192, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1520, y: 368, w: 80, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      // Final citadel spire
      { x: 2064, y: 176, w: 176, h: 464, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 2224, y: 32, w: 16, h: 144, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
    ],
    grappleRings: [
      { x: 368, y: 272 },
      { x: 752, y: 208 },
      { x: 864, y: 144 },
      { x: 1392, y: 208 },
      { x: 1568, y: 192 },
      { x: 1744, y: 176 },
      { x: 1936, y: 144 },
    ],
    zipBlocks: [
      { x: 240, y: 432, endX: 352, endY: 320, w: 20, h: 20, speed: 300 },
      { x: 1024, y: 192, endX: 1136, endY: 224, w: 20, h: 20, speed: 310 },
    ],
    crumbleBlocks: [
      { x: 448, y: 368, w: 48 },
      { x: 1328, y: 304, w: 48 },
      { x: 1856, y: 240, w: 48 },
    ],
    resetCrystals: [
      // 3-crystal swing chain #1
      { x: 720, y: 272 },
      { x: 800, y: 240 },
      { x: 864, y: 192 },
      // 3-crystal swing chain #2
      { x: 1440, y: 264 },
      { x: 1600, y: 256 },
      { x: 1792, y: 232 },
      // Final crystal before summit
      { x: 1984, y: 176 },
    ],
    updrafts: [
      { x: 272, y: 240, w: 144, h: 320, liftAccel: 560, windX: 32 },
      { x: 704, y: 176, w: 176, h: 384, liftAccel: 590, windX: 28 },
      { x: 1344, y: 192, w: 160, h: 352, liftAccel: 560, windX: 35 },
      { x: 1600, y: 176, w: 176, h: 352, liftAccel: 590, windX: 30 },
      { x: 1856, y: 128, w: 176, h: 384, liftAccel: 610, windX: 36 },
    ],
    lasers: [
      { x: 960, y: 240, w: 16, h: 144, period: 2.4, onDuration: 0.9, phase: 0.4 },
    ],
    checkpoints: [
      { x: 560, y: 336 },
      { x: 1152, y: 272 },
    ],
  },

  // Stage 5: 【星骸逃脫・雙骨 IK 巨爪追擊】 — real-time Two-Bone IK mechanical claw boss pursuit
  {
    id: 'cp-05-star-wreck-escape',
    name: '【星骸逃脫・雙骨 IK 巨爪追擊】',
    worldWidth: 2560,
    worldHeight: 640,
    bgmTheme: 'boss',
    paletteRow: 4,
    ambientDarkness: 0.14,
    hint: '雙骨 IK 機械巨爪全力追擊中！高速擺盪與滑索牽引突破星骸封鎖線！',
    artMood: { baseHex: '#231338', accentHex: '#ff5d8f', warmth: 0.15, contrast: 0.85, parallaxFog: 0.50 },
    spawn: { x: 64, y: 400 },
    exitGate: { x: 2464, y: 216 },
    hasIkBoss: true,
    tileRects: [
      { x: 0, y: 160, w: 16, h: 256, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 0, y: 416, w: 352, h: 224, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      // Debris hull 1
      { x: 352, y: 496, w: 176, h: 144, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 368, y: 480, w: 144, h: 16, kind: 'hazard', topSprite: 'trap' },
      { x: 432, y: 208, w: 192, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 592, y: 368, w: 192, h: 272, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      // Checkpoint 1 hull & thruster shaft
      { x: 848, y: 352, w: 176, h: 288, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1088, y: 288, w: 80, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      { x: 1184, y: 128, w: 224, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1424, y: 336, w: 192, h: 304, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      // Checkpoint 2 hull & final gauntlet
      { x: 1648, y: 320, w: 176, h: 320, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1856, y: 144, w: 288, h: 32, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 1952, y: 448, w: 144, h: 16, kind: 'cloud', topSprite: 'cloud_m' },
      { x: 2368, y: 240, w: 192, h: 400, kind: 'solid', topSprite: 'dungeon_floor', fillSprite: 'stone', wallMaterial: 'astral' },
      { x: 2544, y: 80, w: 16, h: 160, kind: 'solid', topSprite: 'stone', fillSprite: 'stone', wallMaterial: 'astral' },
    ],
    grappleRings: [
      { x: 432, y: 288 },
      { x: 544, y: 272 },
      { x: 1120, y: 208 },
      { x: 1280, y: 208 },
      { x: 1872, y: 224 },
      { x: 2048, y: 208 },
      { x: 2224, y: 192 },
    ],
    zipBlocks: [
      { x: 288, y: 352, endX: 464, endY: 320, w: 20, h: 20, speed: 320 },
      { x: 976, y: 288, endX: 1152, endY: 224, w: 20, h: 20, speed: 330 },
      { x: 1776, y: 272, endX: 1952, endY: 240, w: 20, h: 20, speed: 340 },
      { x: 2144, y: 256, endX: 2336, endY: 208, w: 20, h: 20, speed: 340 },
    ],
    crumbleBlocks: [
      { x: 384, y: 384, w: 48 },
      { x: 784, y: 368, w: 48 },
      { x: 1328, y: 320, w: 48 },
      { x: 2080, y: 304, w: 48 },
      { x: 2256, y: 272, w: 48 },
    ],
    resetCrystals: [
      { x: 480, y: 320 },
      { x: 1168, y: 240 },
      { x: 1360, y: 256 },
      { x: 1968, y: 256 },
      { x: 2224, y: 240 },
    ],
    updrafts: [
      { x: 1232, y: 208, w: 160, h: 320, liftAccel: 520, windX: 30 },
      { x: 2144, y: 192, w: 192, h: 320, liftAccel: 540, windX: 34 },
    ],
    lasers: [
      { x: 688, y: 224, w: 16, h: 144, period: 2.0, onDuration: 0.8, phase: 0.2 },
      { x: 1520, y: 192, w: 16, h: 144, period: 2.1, onDuration: 0.85, phase: 0.9 },
      { x: 2000, y: 176, w: 16, h: 160, period: 2.0, onDuration: 0.8, phase: 0.5 },
    ],
    checkpoints: [
      { x: 880, y: 336 },
      { x: 1680, y: 304 },
    ],
  },
];

function buildStageParallaxLayers(
  spec: ParkourStageSpec,
  mood: ResolvedStageArtMood,
  stageIdx: number,
): BgParallaxLayerDesc[] {
  const ramp = mood.rampHex;

  const layers: BgParallaxLayerDesc[] = [
    // Layer 0: Wide 16-bit twilight mountain ridge & ruin spire silhouette (480x180)
    {
      sprite: 'parallax_twilight_bg',
      x: 0,
      y: Math.round(spec.worldHeight * 0.28),
      w: 480,
      h: 180,
      scrollX: 0.16,
      scrollY: 0.20,
      repeatW: spec.worldWidth,
      repeatStepX: 480,
      tint: '#ffffff',
      alpha: 0.86,
      paletteRow: 0,
    },
    // Layer 1: Distant twilight constellations (cohesive sky stars, zero mid-air shrines)
    {
      sprite: 'star_a',
      x: 24 + stageIdx * 13,
      y: Math.round(spec.worldHeight * 0.34),
      w: 10,
      h: 10,
      scrollX: 0.24,
      scrollY: 0.14,
      repeatW: spec.worldWidth,
      repeatStepX: 112,
      tint: ramp ? ramp[4] : '#fffaf0',
      alpha: 0.56,
      paletteRow: 0,
      additive: true,
      emissive: 0.65,
    },
    // Layer 2: Mid-depth low cloud mist sea horizon ribbon
    {
      sprite: 'cloud_m',
      x: 16,
      y: Math.round(spec.worldHeight * 0.72),
      w: 32,
      h: 24,
      scrollX: 0.40,
      scrollY: 0.22,
      repeatW: spec.worldWidth,
      repeatStepX: 32,
      tint: ramp ? ramp[1] : '#5c527a',
      alpha: 0.58,
      paletteRow: 0,
    },
    // Layer 3: Near atmospheric starlight glints
    {
      sprite: 'sparkle',
      x: 24,
      y: Math.round(spec.worldHeight * 0.15),
      w: 12,
      h: 12,
      scrollX: 0.56,
      scrollY: 0.28,
      repeatW: spec.worldWidth,
      repeatStepX: 96,
      tint: spec.artMood.accentHex ?? '#fffaf0',
      alpha: 0.52,
      additive: true,
      emissive: 0.75,
    },
  ];

  applyOklabParallaxFog(layers, mood.skyBottom, mood.parallaxFog);
  return layers;
}

function isSurfacePropClear(
  spec: ParkourStageSpec,
  px: number,
  py: number,
  pw: number,
  ph: number,
): boolean {
  // Require generous open headroom above cliff surface (avoid low tunnels/chimneys)
  for (const r of spec.tileRects) {
    if (px + pw > r.x - 4 && px < r.x + r.w + 4 && py + ph - 2 > r.y && py - 40 < r.y + r.h) {
      return false;
    }
  }
  if (Math.abs(px + pw * 0.5 - (spec.spawn.x + 8)) < 32 && Math.abs(py + ph - (spec.spawn.y + 16)) < 36) {
    return false;
  }
  if (Math.abs(px + pw * 0.5 - (spec.exitGate.x + 12)) < 36 && Math.abs(py + ph - (spec.exitGate.y + 24)) < 40) {
    return false;
  }
  for (const cp of spec.checkpoints) {
    if (Math.abs(px + pw * 0.5 - (cp.x + 8)) < 28 && Math.abs(py + ph - (cp.y + 16)) < 32) {
      return false;
    }
  }
  for (const lz of spec.lasers) {
    if (px + pw > lz.x - 10 && px < lz.x + lz.w + 10 && py < lz.y + lz.h + 8 && py + ph > lz.y - 8) {
      return false;
    }
  }
  for (const zb of spec.zipBlocks) {
    if (Math.abs(px + pw * 0.5 - (zb.x + zb.w * 0.5)) < 28 && Math.abs(py - zb.y) < 36) {
      return false;
    }
  }
  for (const cr of spec.resetCrystals) {
    if (Math.hypot(px + pw * 0.5 - cr.x, py + ph * 0.5 - cr.y) < 24) {
      return false;
    }
  }
  return true;
}

function buildStageForegroundTiles(
  spec: ParkourStageSpec,
  mood: ResolvedStageArtMood,
  stageIdx: number,
  tilemap: TilemapGrid,
): TileDesc[] {
  const fgTiles: TileDesc[] = [];
  const mistTint = mood.rampHex ? mood.rampHex[3] : mood.skyBottom;
  const highTint = mood.rampHex ? mood.rampHex[4] : '#fffaf0';
  const canopyTint = mood.rampHex ? mood.rampHex[3] : mistTint;

  // Continuous lower abyss cloud mist bank made of complete cloud_l + cloud_m + cloud_r trios
  const mistY = spec.worldHeight - 20;
  for (let x = 0; x < spec.worldWidth; x += 64) {
    fgTiles.push(
      { sprite: 'cloud_l', x, y: mistY, w: 16, h: 16, tint: mistTint, alpha: 0.58 },
      { sprite: 'cloud_m', x: x + 16, y: mistY, w: 16, h: 16, tint: mistTint, alpha: 0.58 },
      { sprite: 'cloud_r', x: x + 32, y: mistY, w: 16, h: 16, tint: mistTint, alpha: 0.58 },
    );
  }

  // Soft drifting foreground veil clouds across mid/upper sky bands so vertical climbs have foreground depth too
  const bandStep = 144;
  for (let x = 32; x < spec.worldWidth; x += bandStep) {
    const bandY = Math.round(spec.worldHeight * (0.28 + ((x / bandStep) % 3) * 0.16));
    fgTiles.push(
      { sprite: 'cloud_l', x, y: bandY, w: 16, h: 16, tint: highTint, alpha: 0.22 },
      { sprite: 'cloud_m', x: x + 16, y: bandY, w: 16, h: 16, tint: highTint, alpha: 0.22 },
      { sprite: 'cloud_r', x: x + 32, y: bandY, w: 16, h: 16, tint: highTint, alpha: 0.22 },
    );
  }

  // Grounded cliff surface props (tree_canopy / shrine / torch / pebble_decal) seated flush on solid platforms
  let propIdx = 0;
  for (const rect of spec.tileRects) {
    if (rect.kind !== 'solid' || rect.w < 128 || rect.y < 160) continue;
    for (let x = rect.x + 18; x <= rect.x + rect.w - 34; x += 96) {
      const useTree = stageIdx === 0 && propIdx % 3 === 0;
      const sprite: SpriteId = useTree ? 'tree_canopy' : propIdx % 2 === 0 ? 'torch' : 'shrine';
      const w = useTree ? 24 : 16;
      const h = useTree ? 24 : 16;
      const y = rect.y - h;
      if (isSurfacePropClear(spec, x, y, w, h)) {
        fgTiles.push({
          sprite,
          x,
          y,
          w,
          h,
          tint: useTree ? canopyTint : undefined,
          alpha: useTree ? 0.88 : 0.94,
          windSway: useTree ? 1 : undefined,
        });
      }
      const pebbleX = x + 40;
      const pebbleY = rect.y - TILE_SIZE;
      if (pebbleX + TILE_SIZE <= rect.x + rect.w - 16 && isSurfacePropClear(spec, pebbleX, pebbleY, TILE_SIZE, TILE_SIZE)) {
        fgTiles.push({
          sprite: 'pebble_decal',
          x: pebbleX,
          y: pebbleY,
          w: TILE_SIZE,
          h: TILE_SIZE,
          tint: rect.topSprite === 'grass' ? undefined : canopyTint,
          alpha: 0.9,
          flipX: (propIdx & 1) !== 0,
        });
      }
      propIdx++;
    }
  }

  // Hanging mossy vines beneath exposed bottoms ((mask & 4) === 0) on stone/cliff overhangs
  for (const rect of spec.tileRects) {
    if (rect.kind !== 'solid' || rect.y + rect.h >= spec.worldHeight - 4) continue;
    const c0 = Math.max(0, Math.floor(rect.x / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(rect.y / TILE_SIZE));
    const wCols = Math.max(1, Math.round(rect.w / TILE_SIZE));
    const hRows = Math.max(1, Math.round(rect.h / TILE_SIZE));
    const bottomRow = r0 + hRows - 1;
    const vineRow = bottomRow + 1;
    if (vineRow >= tilemap.rows - 1) continue;

    for (let lc = 0; lc < wCols; lc++) {
      const c = c0 + lc;
      const mask = tilemap.getAutoMask(c, bottomRow);
      if ((mask & 4) !== 0) continue;
      if (tilemap.getCollision(c, vineRow) !== COLLISION_EMPTY) continue;

      const hash = (((c + 11) * 73856093) ^ ((bottomRow + 7) * 19349663) ^ ((stageIdx + 3) * 83492791)) >>> 0;
      if (hash % 4 !== 0) continue;

      const vx = c * TILE_SIZE;
      const vy = vineRow * TILE_SIZE;
      let clear = true;
      for (const lz of spec.lasers) {
        if (vx + TILE_SIZE > lz.x - 4 && vx < lz.x + lz.w + 4 && vy < lz.y + lz.h && vy + TILE_SIZE > lz.y) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      fgTiles.push({
        sprite: 'vine_hang',
        x: vx,
        y: vy,
        w: TILE_SIZE,
        h: TILE_SIZE,
        tint: canopyTint,
        alpha: 0.88,
        flipX: (hash & 8) !== 0,
        windSway: 0.7,
      });
    }
  }

  return fgTiles;
}

export function compileParkourStage(stageIdx: number): CompiledParkourStage {
  const safeIdx = Math.max(0, Math.min(PARKOUR_STAGES.length - 1, stageIdx | 0));
  const spec = PARKOUR_STAGES[safeIdx];

  const stubStageDef: CartridgeStageDef = {
    id: spec.id,
    name: spec.name,
    worldWidth: spec.worldWidth,
    worldHeight: spec.worldHeight,
    bgmTheme: spec.bgmTheme,
    hint: spec.hint,
    spawn: spec.spawn,
    artMood: spec.artMood,
  };
  const mood = resolveStageArtMood(stubStageDef);

  const cols = Math.ceil(spec.worldWidth / TILE_SIZE);
  const rows = Math.ceil(spec.worldHeight / TILE_SIZE);
  const tilemap = new TilemapGrid(cols, rows);
  const tiles: TileDesc[] = [];
  const wallColor = mood.rampHex ? mood.rampHex[0] : '#2b2238';

  // Harmonize classic stone/floor sprites gently toward the stage's Oklab palette without losing mortar contrast
  let stageStoneTint: string | undefined;
  if (mood.rampHex) {
    const src = new Float32Array(3);
    const dst = new Float32Array(3);
    const out = new Float32Array(3);
    hexToRgb01Into('#ffffff', src, 0);
    hexToRgb01Into(mood.rampHex[3], dst, 0);
    mixOklabRgb01(src[0], src[1], src[2], dst[0], dst[1], dst[2], 0.36, out, 0);
    stageStoneTint = rgb01ToHex(out[0], out[1], out[2]);
  }

  // Pass 1: Populate TilemapGrid collision & tile IDs first so cross-rect auto-tiling neighbors are exact
  for (const rect of spec.tileRects) {
    const c0 = Math.max(0, Math.floor(rect.x / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(rect.y / TILE_SIZE));
    const wCols = Math.max(1, Math.round(rect.w / TILE_SIZE));
    const hRows = Math.max(1, Math.round(rect.h / TILE_SIZE));

    if (rect.kind === 'cloud') {
      tilemap.fillRectTiles(c0, r0, wCols, 1, 3, COLLISION_CLOUD);
    } else if (rect.kind === 'hazard') {
      tilemap.fillRectTiles(c0, r0, wCols, hRows, 9, COLLISION_HAZARD);
    } else {
      tilemap.fillRectTiles(c0, r0, wCols, hRows, 1, COLLISION_SOLID);
    }
  }

  // Intact crumble blocks occupy solid cells initially in tilemap (tileId 2 keeps cliff autoMask clean)
  for (const cb of spec.crumbleBlocks) {
    const c0 = Math.max(0, Math.floor(cb.x / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(cb.y / TILE_SIZE));
    const wCols = Math.max(1, Math.round(cb.w / TILE_SIZE));
    tilemap.fillRectTiles(c0, r0, wCols, 1, 2, COLLISION_SOLID);
  }

  tilemap.recomputeAutoMask();

  // Pass 2: Emit auto-tiled visual TileDesc records using recomputed 4-bit N/E/S/W masks
  for (const rect of spec.tileRects) {
    const c0 = Math.max(0, Math.floor(rect.x / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(rect.y / TILE_SIZE));
    const wCols = Math.max(1, Math.round(rect.w / TILE_SIZE));
    const hRows = Math.max(1, Math.round(rect.h / TILE_SIZE));

    if (rect.kind === 'cloud') {
      for (let lc = 0; lc < wCols; lc++) {
        const sprite: SpriteId = lc === 0 ? 'cloud_l' : lc === wCols - 1 ? 'cloud_r' : 'cloud_m';
        tiles.push({
          sprite,
          x: (c0 + lc) * TILE_SIZE,
          y: r0 * TILE_SIZE,
          w: TILE_SIZE,
          h: TILE_SIZE,
          tint: rect.tint ?? stageStoneTint,
        });
      }
      continue;
    }

    if (rect.kind === 'hazard') {
      for (let lc = 0; lc < wCols; lc++) {
        // Align trap sprite base flush with the floor below (trap has 4px empty bottom rows)
        tiles.push({
          sprite: rect.topSprite,
          x: (c0 + lc) * TILE_SIZE,
          y: r0 * TILE_SIZE + 4,
          w: TILE_SIZE,
          h: TILE_SIZE,
          tint: rect.tint,
        });
      }
      continue;
    }

    const suspended = rect.y + rect.h < spec.worldHeight - 4;
    const rawTop: SpriteId = rect.topSprite === 'dungeon_floor' ? 'stone' : rect.topSprite;
    for (let lr = 0; lr < hRows; lr++) {
      const r = r0 + lr;
      const ty = r * TILE_SIZE;
      const isBottomRow = suspended && lr === hRows - 1;
      const isGrassTop = lr === 0 && rawTop === 'grass';
      let defaultTint: string | undefined;
      if (isGrassTop) {
        defaultTint = undefined;
      } else if (lr === 0) {
        defaultTint = stageStoneTint;
      } else if (lr === 1 && rawTop === 'grass') {
        defaultTint = mood.rampHex ? mood.rampHex[2] : undefined;
      } else if (lr === 1) {
        defaultTint = mood.rampHex ? mood.rampHex[2] : stageStoneTint;
      } else {
        defaultTint = mood.rampHex ? (lr >= 4 ? mood.rampHex[0] : mood.rampHex[1]) : stageStoneTint;
      }
      for (let lc = 0; lc < wCols; lc++) {
        const c = c0 + lc;
        const mask = tilemap.getAutoMask(c, r);
        const sprite = (isGrassTop ? `grass_m${mask}` : `cliff_m${mask}`) as SpriteId;
        tiles.push({
          sprite,
          x: c * TILE_SIZE,
          y: ty,
          w: TILE_SIZE,
          h: TILE_SIZE,
          tint: rect.tint ?? defaultTint,
          autoMask: mask,
          variant: (c * 31 + r * 17) & 3,
          extrudeH: isBottomRow ? 4 : undefined,
          wallColor: isBottomRow ? wallColor : undefined,
          wallMaterial: isBottomRow ? (rect.wallMaterial ?? 'stone') : undefined,
        });
      }
    }
  }

  const bgParallaxLayers = buildStageParallaxLayers(spec, mood, safeIdx);
  const fgTiles = buildStageForegroundTiles(spec, mood, safeIdx, tilemap);

  const bgClouds: BgCloudDesc[] = [];
  for (let i = 0; i < 6; i++) {
    bgClouds.push({
      x: 40 + i * 310,
      y: 28 + ((i * 47) % 90),
      scale: i % 2 === 0 ? 1.2 : 0.9,
      speed: 4 + (i % 3) * 2,
      tint: mood.rampHex ? mood.rampHex[4] : '#fffaf0',
      alpha: 0.42,
    });
  }

  return {
    spec,
    mood,
    tilemap,
    tiles,
    fgTiles,
    bgParallaxLayers,
    bgClouds,
  };
}
