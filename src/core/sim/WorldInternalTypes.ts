import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { BgmTheme, CartridgeId, StageProgressInfo } from '../types/WorldTypes.ts';
import type { ArchetypeId } from './Archetypes.ts';
import type { SquashSpring } from './JuiceSystem.ts';
import type { RuleEntityLike } from './RuleMatrix.ts';

export interface WorldEntity extends RuleEntityLike {
  archetype: ArchetypeId;
  sprite: SpriteId;
  hp: number;
  maxHp: number;
  minX?: number;
  maxX?: number;
  patrolVx?: number;
  hasGravity: boolean;
  friction: number;
  phase: number;
  flipX?: boolean;
  portalGroup?: string;
}

export interface MovingPlatform {
  x: number;
  y: number;
  w: number;
  h: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
}

export interface SparkProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface HeroRelics {
  doubleJump: boolean;
  airDash: boolean;
}

export interface WorldConfig {
  cartridgeId: CartridgeId;
  worldWidth?: number;
  worldHeight?: number;
  skyTop?: string;
  skyBottom?: string;
  ambientDarkness?: number;
  ambientColor?: string;
  statusBanner?: string;
  stage?: StageProgressInfo;
  bgmTheme?: BgmTheme;
}

export interface HeroState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingLeft: boolean;
  onGround: boolean;
  coyote: number;
  airJumpsLeft: number;
  dashTimer: number;
  dashCooldown: number;
  portalCooldown: number;
  walkAnim: number;
  invuln: number;
  flash: number;
  squash: SquashSpring;
  checkpoint: { x: number; y: number } | null;
}

export const HERO_HB = { x: 2, y: 2, w: 12, h: 14 };
