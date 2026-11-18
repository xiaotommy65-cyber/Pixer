import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { BgmTheme } from '../../core/types/WorldTypes.ts';
import { CLOUDBERRY_STAGES_EARLY } from './CloudberryStagesEarly.ts';
import { CLOUDBERRY_STAGES_LATE } from './CloudberryStagesLate.ts';

export interface IslandDef {
  startTile: number;
  countTiles: number;
  topY: number;
}

export interface CloudDef {
  x: number;
  y: number;
  tilesWide: number;
}

export interface MovingPlatDef {
  x: number;
  y: number;
  tilesWide: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  vx?: number;
  vy?: number;
}

export interface SlimeDef {
  x: number;
  y: number;
  minX: number;
  maxX: number;
  vx: number;
}

export interface CloudberryStageSpec {
  id: string;
  name: string;
  worldWidth: number;
  skyTop: string;
  skyBottom: string;
  ambientDarkness: number;
  groundTop: SpriteId;
  groundFill: SpriteId;
  bgmTheme: BgmTheme;
  spawn: { x: number; y: number };
  islands: IslandDef[];
  clouds: CloudDef[];
  movingPlats?: MovingPlatDef[];
  slimes: SlimeDef[];
  springs?: { x: number; y: number }[];
  torches?: { x: number; y: number }[];
  checkpoints?: { x: number; y: number }[];
  stars: { x: number; y: number }[];
  coins?: { x: number; y: number }[];
  relic?: { id: 'feather' | 'dash_badge'; x: number; y: number };
  keyPos?: { x: number; y: number };
  bossPos?: { x: number; y: number; minX: number; maxX: number };
  gatePos: { x: number; y: number };
  hint: string;
}

export const CLOUDBERRY_STAGES: readonly CloudberryStageSpec[] = [
  ...CLOUDBERRY_STAGES_EARLY,
  ...CLOUDBERRY_STAGES_LATE,
];
