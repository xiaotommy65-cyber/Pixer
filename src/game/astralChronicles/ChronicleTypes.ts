import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { CutsceneStep } from '../../core/sim/CutsceneSequencer.ts';
import type { BgmTheme } from '../../core/types/WorldTypes.ts';

export type GearSlot = 'weapon' | 'armor' | 'relic';

export interface GearCatalogEntry {
  id: string;
  slot: GearSlot;
  name: string;
  desc: string;
  statText: string;
  costGold: number;
  atkBonus: number;
  defBonus: number;
  rangeBonus: number;
  mpCost: number;
  speedScale: number;
}

export interface WorldWall {
  x: number;
  y: number;
  w: number;
  h: number;
  sprite: SpriteId;
  tint?: string;
}

export interface WorldChest {
  id: string;
  x: number;
  y: number;
  gold: number;
  potions?: number;
  grantGearId?: string;
}

export interface WorldSwitch {
  id: string;
  x: number;
  y: number;
}

export interface WorldNpc {
  id: string;
  name: string;
  role: string;
  sprite: SpriteId;
  x: number;
  y: number;
  kind: 'elder' | 'smith' | 'shrine';
}

export type ActionEnemyKind = 'slime' | 'goblin' | 'shaman' | 'gargoyle' | 'frost_mage' | 'dragon_guard';

export interface EnemySpawnSpec {
  id: string;
  kind: ActionEnemyKind;
  x: number;
  y: number;
  hp: number;
  atk: number;
  xp: number;
  gold: number;
}

export interface BossSpec {
  name: string;
  subtitle: string;
  sprite: SpriteId;
  x: number;
  y: number;
  arenaCenterX: number;
  arenaCenterY: number;
  triggerX: number;
  hp: number;
  atk: number;
  xp: number;
  gold: number;
  tint?: string;
}

export interface ChapterSpec {
  index: number;
  id: string;
  title: string;
  subtitle: string;
  areaTitle: string;
  levelReq: number;
  worldW: number;
  worldH: number;
  skyTop: string;
  skyBottom: string;
  floorSprite: SpriteId;
  floorTint: string;
  ambientDarkness: number;
  ambientColor: string;
  bgmTheme: BgmTheme;
  accentHex: string;
  heroSpawn: { x: number; y: number };
  questObjective: string;
  switchesRequired: number;
  gateWall: { x: number; y: number; w: number; h: number };
  walls: WorldWall[];
  lights: { x: number; y: number; radius: number; color: string; intensity: number }[];
  npcs: WorldNpc[];
  chests: WorldChest[];
  switches: WorldSwitch[];
  enemies: EnemySpawnSpec[];
  boss: BossSpec;
  introCutscene: CutsceneStep[];
  bossCutscene: CutsceneStep[];
}

export interface ActiveEnemy {
  id: string;
  kind: ActionEnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  atk: number;
  xp: number;
  gold: number;
  aiTimer: number;
  flash: number;
  facingX: number;
}

export interface ActiveBoss {
  name: string;
  subtitle: string;
  sprite: SpriteId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  atk: number;
  xp: number;
  gold: number;
  phase: 1 | 2;
  aiTimer: number;
  flash: number;
  tint?: string;
}

export interface WorldProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fromEnemy: boolean;
  damage: number;
  life: number;
  color: string;
  sprite: SpriteId;
  size: number;
}

export interface SlashVfx {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}
