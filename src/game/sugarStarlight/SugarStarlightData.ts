import type { SpriteId } from '../../assets/AtlasSpritesData.ts';
import { GAME_H, GAME_W } from '../../core/gpu/GpuTypes.ts';
import type { SquashSpring } from '../../core/sim/JuiceSystem.ts';

export type FighterId = 'starfalcon' | 'coral_titan' | 'violet_prism';
export type WeaponKind = 'crimson' | 'azure' | 'violet';
export type WeaponLevel = 1 | 2 | 3;
export type ChargeTier = 0 | 1 | 2;
export type ShmupPhase = 'hangar' | 'sortie' | 'won' | 'lost';

export interface FighterProfile {
  id: FighterId;
  code: string;
  name: string;
  tagline: string;
  speedScale: number;
  maxHearts: number;
  fireCooldownScale: number;
  defaultWeapon: WeaponKind;
  initialBombs: number;
  initialFunnels: number;
  speedStat: number;
  armorStat: number;
  fireStat: number;
  ultKind: 'crossfire' | 'giga_wave' | 'funnel_salvo';
  ultLabel: string;
  accentHex: string;
  spriteA: SpriteId;
  spriteB: SpriteId;
}

export const FIGHTER_CATALOG: readonly FighterProfile[] = [
  {
    id: 'starfalcon',
    code: 'SF-01',
    name: '藍星隼號',
    tagline: '高機動均衡機體・交叉廣域磁軌炮',
    speedScale: 1.24,
    maxHearts: 3,
    fireCooldownScale: 0.86,
    defaultWeapon: 'crimson',
    initialBombs: 2,
    initialFunnels: 0,
    speedStat: 5,
    armorStat: 3,
    fireStat: 4,
    ultKind: 'crossfire',
    ultLabel: 'V 字交叉殲滅砲',
    accentHex: '#5ec2f7',
    spriteA: 'ship_a',
    spriteB: 'ship_b',
  },
  {
    id: 'coral_titan',
    code: 'CT-02',
    name: '珊瑚重砲號',
    tagline: '厚實四心裝甲・R-Type 巨型波動砲',
    speedScale: 0.94,
    maxHearts: 4,
    fireCooldownScale: 1.05,
    defaultWeapon: 'azure',
    initialBombs: 3,
    initialFunnels: 0,
    speedStat: 2,
    armorStat: 5,
    fireStat: 5,
    ultKind: 'giga_wave',
    ultLabel: '超極巨貫穿波動砲',
    accentHex: '#ff708d',
    spriteA: 'ship_titan',
    spriteB: 'ship_titan',
  },
  {
    id: 'violet_prism',
    code: 'VP-03',
    name: '紫晶浮游號',
    tagline: '出擊自帶浮游子機・四機連攜齊射',
    speedScale: 1.08,
    maxHearts: 3,
    fireCooldownScale: 0.94,
    defaultWeapon: 'violet',
    initialBombs: 2,
    initialFunnels: 2,
    speedStat: 4,
    armorStat: 3,
    fireStat: 4,
    ultKind: 'funnel_salvo',
    ultLabel: '浮游矩陣自律齊射',
    accentHex: '#e0aaff',
    spriteA: 'ship_prism',
    spriteB: 'ship_prism',
  },
];

export function getFighterProfile(id: FighterId): FighterProfile {
  return FIGHTER_CATALOG.find((f) => f.id === id) ?? FIGHTER_CATALOG[0];
}

export interface WeaponProfile {
  kind: WeaponKind;
  name: string;
  shortLabel: string;
  color: string;
  glowColor: string;
}

export const WEAPON_CATALOG: Record<WeaponKind, WeaponProfile> = {
  crimson: {
    kind: 'crimson',
    name: '赤紅星霰砲',
    shortLabel: '紅 · 散射',
    color: '#ff708d',
    glowColor: '#ffd447',
  },
  azure: {
    kind: 'azure',
    name: '天青貫穿雷射',
    shortLabel: '藍 · 貫穿',
    color: '#5ec2f7',
    glowColor: '#8ce8ff',
  },
  violet: {
    kind: 'violet',
    name: '紫電追蹤電漿',
    shortLabel: '紫 · 追蹤',
    color: '#e0aaff',
    glowColor: '#ff8ec6',
  },
};

export interface SectorSpec {
  id: string;
  name: string;
  skyTop: string;
  skyBottom: string;
  bossName: string;
  bossHp: number;
  weakPointHp: number;
  waveCount: number;
  enemySpeedScale: number;
}

export const SECTORS: readonly SectorSpec[] = [
  {
    id: 's1',
    name: 'S1 · 糖霜星雲',
    skyTop: '#243c70',
    skyBottom: '#f7adc4',
    bossName: '棉花糖先鋒艦',
    bossHp: 22,
    weakPointHp: 7,
    waveCount: 4,
    enemySpeedScale: 1.0,
  },
  {
    id: 's2',
    name: 'S2 · 碎星隕石帶',
    skyTop: '#1f2859',
    skyBottom: '#ffab8c',
    bossName: '焦糖隕石要塞',
    bossHp: 32,
    weakPointHp: 10,
    waveCount: 4,
    enemySpeedScale: 1.14,
  },
  {
    id: 's3',
    name: 'S3 · 極光雷射陣',
    skyTop: '#122147',
    skyBottom: '#6fd9cf',
    bossName: '極光指揮母艦',
    bossHp: 42,
    weakPointHp: 13,
    waveCount: 4,
    enemySpeedScale: 1.26,
  },
  {
    id: 's4',
    name: 'S4 · 星核終極殿堂',
    skyTop: '#1a0d38',
    skyBottom: '#f06ea0',
    bossName: '糖霜星皇母艦 BOSS',
    bossHp: 56,
    weakPointHp: 16,
    waveCount: 4,
    enemySpeedScale: 1.38,
  },
];

export type EnemyKind =
  | 'jelly'
  | 'interceptor'
  | 'frigate'
  | 'carrier'
  | 'meteor'
  | 'cargo'
  | 'missile';

export interface EnemyShip {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  phase: number;
  rot: number;
  fireTimer: number;
  flashTimer: number;
  chargeArmed?: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fromEnemy: boolean;
  piercing?: boolean;
  clearsBullets?: boolean;
  homing?: boolean;
  turnRate?: number;
  speed?: number;
  damage: number;
  grazed?: boolean;
  color: string;
  width?: number;
  height?: number;
  hitIds?: Set<string>;
}

export interface FunnelUnit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  fireTimer: number;
}

export type PickupKind = 'weapon_crimson' | 'weapon_azure' | 'weapon_violet' | 'bomb' | 'funnel' | 'heal';

export interface PowerPickup {
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  phase: number;
}

export interface ShipState {
  fighterId: FighterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  flash: number;
  squash: SquashSpring;
  hearts: number;
  maxHearts: number;
  weaponKind: WeaponKind;
  weaponLevel: WeaponLevel;
  bombs: number;
  funnelCount: number;
  chargeSec: number;
  funnelOverdriveTimer: number;
  overdriveShieldTimer: number;
  grazeCount: number;
  grazeMeter: number;
  shootCooldown: number;
  invulnTimer: number;
}

export interface BossWeakPoint {
  id: string;
  offsetX: number;
  offsetY: number;
  hp: number;
  maxHp: number;
  fireTimer: number;
  flash: number;
}

export interface BossState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  phase: 1 | 2;
  fireTimer: number;
  patternStep: number;
  flash: number;
  weakPoints: BossWeakPoint[];
}

export const MAX_HEARTS_CAP = 4;
export const MAX_BOMBS = 4;
export const GRAZE_OVERDRIVE_COST = 100;
export const OVERDRIVE_SHIELD_SEC = 2.6;
export const CHARGE_VFX_START_SEC = 0.08;
export const CHARGE_TIER1_SEC = 0.48;
export const CHARGE_TIER2_SEC = 1.05;
export const FUNNEL_OVERDRIVE_SEC = 4.8;

export const SHIP_MIN_X = 8;
export const SHIP_MAX_X = GAME_W - 26;
export const SHIP_MIN_Y = 14;
export const SHIP_MAX_Y = GAME_H - 18;
export const CORE_BULLET_HIT_RADIUS = 5.5;
export const CORE_ENEMY_HIT_RADIUS = 10;
export const GRAZE_RADIUS = 22;

export const STARFIELD_PALETTE: readonly string[] = ['#fffaf0', '#ffd447', '#ff9ec2', '#8ce8ff'];
