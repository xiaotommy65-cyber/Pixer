import { BUILTIN_SPRITE_GRIDS, type SpriteId } from '../../assets/AtlasSpritesData.ts';
import type { BgCloudDesc, BgmTheme, SimEvent } from '../types/WorldTypes.ts';
import type { CardDeckEngineConfig } from './CardDeckEngine.ts';
import type { CartridgeDualPerspectiveConfig } from './DualPerspectiveRuntime.ts';
import type { VmAction, VmRule, VmTrigger } from './EventActionVm.ts';
import type { FighterEngineConfig } from './FighterFrameEngine.ts';
import type { OrthogonalArtBlueprint } from './OrthogonalArt.ts';
import type { CartridgeAtmosphereDef, CartridgeVisualRigDef } from './ProceduralVisualRig.ts';
import { CHUNK_AREA, CHUNK_SIZE, MAX_TILEMAP_COLS, MAX_TILEMAP_ROWS, TILE_SIZE } from './TilemapGrid.ts';

export const CARTRIDGE_SCHEMA_VERSION = 1;
export const MAX_ARCHETYPES_PER_CARTRIDGE = 128;
export const MAX_STAGES_PER_CARTRIDGE = 64;
export const MAX_SPAWNS_PER_STAGE = 512;
export const MAX_VM_RULES_TOTAL = 128;

const KNOWN_BUILTIN_SPRITES = new Set<string>([
  ...Object.keys(BUILTIN_SPRITE_GRIDS),
  'solid',
  'hero_a',
  'hero_b',
  'boss_ufo',
  'slime_king',
  'parallax_twilight_bg',
]);

const VALID_SOUND_PRESETS = new Set<SimEvent>([
  'jump', 'star', 'stomp', 'hurt', 'laser', 'key', 'win',
  'bounce', 'explode', 'ignite', 'snap', 'charge', 'rail',
]);

const VALID_BGM_THEMES = new Set<BgmTheme>(['meadow', 'starlight', 'dungeon', 'boss']);
const VALID_GENRE_HUDS = new Set<string>(['platformer', 'parkour', 'fighter', 'card', 'grid']);
const VALID_CONTROLLERS = new Set<string>(['platformer', 'shmup', 'topdown', 'fighter', 'card']);
const VALID_CARD_KINDS = new Set<string>(['attack', 'shield', 'heal', 'surge']);
const VALID_TWEEN_EASES = new Set<string>(['linear', 'quadOut', 'backOut', 'cubicInOut']);
const VALID_BEHAVIORS = new Set<string>([
  'none', 'patrol', 'sine', 'chase_los', 'interceptor', 'frigate', 'carrier',
  'missile', 'meteor', 'cargo', 'boss_shmup', 'boss_stomp', 'orbit',
]);
const VALID_BIOMES = new Set<string>(['meadow', 'alpine', 'cavern', 'sky_islands', 'cyber_ruins']);
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VALID_BUTTONS = new Set<string>(['jump', 'action', 'skillX', 'skillY', 'shoulderL', 'shoulderR']);
const VALID_COMPARE_OPS = new Set<string>(['==', '!=', '<', '<=', '>', '>=']);
const VALID_VAR_OPS = new Set<string>(['=', '+=', '-=', '*=', '/=', 'clamp']);
const FORBIDDEN_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype']);

export type CartridgeControllerKind = 'platformer' | 'shmup' | 'topdown' | 'fighter' | 'card';
export type CartridgeCardKind = 'attack' | 'shield' | 'heal' | 'surge';

export interface CartridgeCardDef {
  id: string;
  name: string;
  cost: number;
  kind: CartridgeCardKind;
  power: number;
  color?: string;
}

export type CartridgeTag =
  | 'player' | 'solid' | 'oneway' | 'hazard' | 'collectible' | 'stompable'
  | 'bouncy' | 'gravity' | 'enemy' | 'boss' | 'weak_point' | 'bullet'
  | 'enemy_bullet' | 'pickup' | 'relic' | 'checkpoint' | 'key' | 'gate'
  | 'torch' | 'moving_plat' | 'funnel' | 'star' | 'coin'
  | 'grapple_ring' | 'zip_block' | 'crumble_tile' | 'crystal_reset' | 'updraft'
  | 'fighter_p2' | 'card_slot' | 'logic_switch';

export type CartridgeGenreHud = 'platformer' | 'parkour' | 'fighter' | 'card' | 'grid';

export interface CartridgeGrappleConfig {
  enabled?: boolean;
  maxRange?: number;
  attachWalls?: boolean;
  pullSpeed?: number;
}

export interface CartridgeArchetypeBehavior {
  kind:
    | 'none' | 'patrol' | 'sine' | 'chase_los' | 'interceptor' | 'frigate' | 'carrier'
    | 'missile' | 'meteor' | 'cargo' | 'boss_shmup' | 'boss_stomp' | 'orbit';
  speedX?: number;
  speedY?: number;
  amplitude?: number;
  freq?: number;
  sightRange?: number;
  chaseSpeed?: number;
  fireCooldown?: number;
  spread?: readonly number[];
  orbitRadius?: number;
  orbitSpeed?: number;
}

export interface CartridgeParkourMechanicsDef {
  waveDash?: boolean;
  wallSlide?: boolean;
  crumbleRespawnSec?: number;
  crystalRespawnSec?: number;
}

export interface CartridgeArchetypeDef {
  sprite: SpriteId;
  spriteB?: SpriteId;
  animFps?: number;
  w: number;
  h: number;
  tags: readonly CartridgeTag[];
  behavior?: CartridgeArchetypeBehavior;
  hp?: number;
  scoreValue?: number;
  bounceVy?: number;
  relicGrant?: 'doubleJump' | 'airDash';
  pickupEffect?: { kind: 'weapon' | 'bomb' | 'funnel' | 'heal'; weaponId?: string; amount?: number };
  dropTable?: { onDestroyKind?: 'cargo_cycle' | 'funnel' | 'random_cycle' };
  light?: { radius: number; color: string; intensity: number; flicker?: boolean };
  emissive?: number;
  castShadow?: boolean;
  tint?: string;
  paletteRow?: number;
  artBlueprintId?: string;
}

export interface CartridgeLoadoutDef {
  id: 'starfalcon' | 'coral_titan' | 'violet_prism';
  code: string;
  name: string;
  tagline: string;
  speedScale: number;
  maxHearts: number;
  fireCooldownScale: number;
  defaultWeapon: 'crimson' | 'azure' | 'violet';
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

export interface CartridgeWeaponDef {
  kind: 'crimson' | 'azure' | 'violet';
  name: string;
  shortLabel: string;
  color: string;
  glowColor: string;
  pattern: 'spread' | 'pierce' | 'homing';
}

export interface CartridgeStageSpawn {
  archetype: string;
  x: number;
  y: number;
  minX?: number;
  maxX?: number;
  vx?: number;
  vy?: number;
  hp?: number;
}

export interface CartridgeTileChunkDef {
  cx: number;
  cy: number;
  tiles: readonly number[];
  collision: readonly number[];
  fgTiles?: readonly number[];
  spriteMap?: Record<string, SpriteId>;
}

export interface CartridgeParallaxLayerDef {
  sprite: SpriteId;
  x: number;
  y: number;
  w: number;
  h: number;
  scrollX?: number;
  scrollY?: number;
  repeatW?: number;
  repeatStepX?: number;
  tint?: string;
  alpha?: number;
  flipX?: boolean;
  paletteRow?: number;
  additive?: boolean;
  emissive?: number;
}

export interface CartridgeForegroundTileDef {
  sprite: SpriteId;
  x: number;
  y: number;
  w?: number;
  h?: number;
  tint?: string;
  alpha?: number;
  flipX?: boolean;
  elevationZ?: number;
  sortY?: number;
}

export interface CartridgeArtMoodDef {
  baseHex: string;
  accentHex?: string;
  warmth?: number;
  contrast?: number;
  autoSky?: boolean;
  parallaxFog?: number;
}

export interface CartridgeProceduralStageDef {
  seed: number;
  biome?: 'meadow' | 'alpine' | 'cavern' | 'sky_islands' | 'cyber_ruins';
  surfaceRow?: number;
  hillAmplitude?: number;
  frequency?: number;
  octaves?: number;
  gapChance?: number;
  platformDensity?: number;
  caveCarve?: number;
  parallaxBands?: number;
  foregroundCanopy?: boolean;
  safeMarginCols?: number;
  autoSpawns?: { stars?: number; enemies?: number; torches?: number };
}

export interface CartridgeSpringCameraDef {
  freqHz?: number;
  dampingRatio?: number;
}

export interface CartridgeStageDef {
  id: string;
  name: string;
  worldWidth: number;
  worldHeight?: number;
  skyTop?: string;
  skyBottom?: string;
  ambientDarkness?: number;
  ambientColor?: string;
  artMood?: CartridgeArtMoodDef;
  atmosphere?: CartridgeAtmosphereDef;
  procedural?: CartridgeProceduralStageDef;
  springCamera?: CartridgeSpringCameraDef;
  bgmTheme: BgmTheme;
  paletteRow?: number;
  hint: string;
  viewport?: 'classic' | 'wide' | 'hd' | { width: number; height: number };
  spawn: { x: number; y: number };
  groundTop?: SpriteId;
  groundFill?: SpriteId;
  islands?: readonly { startTile: number; countTiles: number; topY: number }[];
  clouds?: readonly { x: number; y: number; tilesWide: number }[];
  fgIslands?: readonly { startTile: number; countTiles: number; topY: number; rows?: number; sprite?: SpriteId; alpha?: number }[];
  fgTiles?: readonly CartridgeForegroundTileDef[];
  movingPlatforms?: readonly {
    x: number;
    y: number;
    tilesWide: number;
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    vx?: number;
    vy?: number;
  }[];
  tileGrid?: {
    cols: number;
    rows: number;
    tiles: readonly number[];
    collision: readonly number[];
    fgTiles?: readonly number[];
    spriteMap: Record<string, SpriteId>;
  };
  tileChunks?: readonly CartridgeTileChunkDef[];
  spawns?: readonly CartridgeStageSpawn[];
  waves?: {
    count: number;
    intervalSec: number;
    enemySpeedScale: number;
    pool: readonly string[];
    cargoEveryOdd?: boolean;
  };
  boss?: {
    archetype: string;
    name: string;
    x: number;
    y: number;
    hp: number;
    minX?: number;
    maxX?: number;
    weakPointArchetype?: string;
    weakPointHp?: number;
    weakPoints?: readonly { id: string; offsetX: number; offsetY: number }[];
  };
  bgStarsCount?: number;
  bgClouds?: readonly BgCloudDesc[];
  bgParallaxLayers?: readonly CartridgeParallaxLayerDef[];
  rules?: readonly VmRule[];
}

export type CartridgePerspectiveConfig = CartridgeDualPerspectiveConfig;

export interface CartridgeJsonV1 {
  version: 1;
  meta: {
    id: string;
    code: string;
    title: string;
    subtitle?: string;
    genre: 'platformer' | 'shmup';
    genreHud?: CartridgeGenreHud;
    viewport?: 'classic' | 'wide' | 'hd' | { width: number; height: number };
    paletteRow?: number;
    glowIntensity?: number;
  };
  initialVars?: Record<string, number>;
  sprites?: Record<string, readonly string[]>;
  artBlueprints?: Record<string, OrthogonalArtBlueprint>;
  cardDeck?: readonly CartridgeCardDef[];
  cardEngine?: CardDeckEngineConfig;
  fighterEngine?: FighterEngineConfig;
  perspective?: CartridgePerspectiveConfig;
  player: {
    controller: CartridgeControllerKind;
    sprite: SpriteId;
    spriteB?: SpriteId;
    artBlueprintId?: string;
    w: number;
    h: number;
    maxHearts: number;
    scoutZoom?: number;
    grappleConfig?: CartridgeGrappleConfig;
    visualRig?: CartridgeVisualRigDef;
    parkourMechanics?: CartridgeParkourMechanicsDef;
    bootInHangar?: boolean;
    loadouts?: readonly CartridgeLoadoutDef[];
    weapons?: Record<string, CartridgeWeaponDef>;
    charge?: { tier1Sec: number; tier2Sec: number; vfxStartSec: number };
    bomb?: { maxBombs: number; invulnSec: number };
    graze?: { hitRadius: number; enemyHitRadius: number; grazeRadius: number; overdriveCost: number; overdriveSec: number };
  };
  archetypes: Record<string, CartridgeArchetypeDef>;
  stages: readonly CartridgeStageDef[];
  rules?: readonly VmRule[];
}

export type CartridgeValidationResult =
  | { ok: true; data: CartridgeJsonV1 }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function hasUnsafeCodeStrings(val: unknown, depth = 0): boolean {
  if (depth > 14) return true;
  if (typeof val === 'string') {
    return /\beval\s*\(|\bnew\s+Function\s*\(/.test(val);
  }
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      if (hasUnsafeCodeStrings(val[i], depth + 1)) return true;
    }
    return false;
  }
  if (isRecord(val)) {
    for (const key of Object.keys(val)) {
      if (FORBIDDEN_KEYS.has(key)) return true;
      if (hasUnsafeCodeStrings(val[key], depth + 1)) return true;
    }
  }
  return false;
}

function validateRulesList(
  rules: unknown,
  path: string,
  archKeys: Set<string>,
  errors: string[],
  runningTotal: { count: number },
): void {
  if (!Array.isArray(rules)) {
    errors.push(`${path} must be an array`);
    return;
  }
  for (let i = 0; i < rules.length; i++) {
    runningTotal.count++;
    if (runningTotal.count > MAX_VM_RULES_TOTAL) {
      errors.push(`Total VM rules exceed limit (${MAX_VM_RULES_TOTAL})`);
      return;
    }
    const r = rules[i];
    if (!isRecord(r) || !isRecord(r.when) || !Array.isArray(r.do)) {
      errors.push(`${path}[${i}] must have 'when' object and 'do' array`);
      continue;
    }
    const w = r.when as Partial<VmTrigger>;
    switch (w.type) {
      case 'OnStart':
        break;
      case 'OnEvery':
        if (!isFiniteNum(w.intervalTicks) || w.intervalTicks < 1) errors.push(`${path}[${i}].when.intervalTicks must be >= 1`);
        break;
      case 'OnCollide':
        if (typeof w.sourceTag !== 'string' || typeof w.targetTag !== 'string') errors.push(`${path}[${i}].when tags must be strings`);
        break;
      case 'OnButton':
        if (!VALID_BUTTONS.has(String(w.button))) errors.push(`${path}[${i}].when.button '${String(w.button)}' invalid`);
        break;
      case 'OnVar':
        if (typeof w.varName !== 'string' || !VALID_COMPARE_OPS.has(String(w.op)) || !isFiniteNum(w.value)) {
          errors.push(`${path}[${i}].when OnVar requires varName, valid op, and finite value`);
        }
        break;
      case 'OnSignal':
        if (typeof w.signal !== 'string' || !w.signal) {
          errors.push(`${path}[${i}].when OnSignal requires non-empty signal`);
        }
        break;
      default:
        errors.push(`${path}[${i}].when.type '${String(w.type)}' unsupported`);
    }

    if (r.if !== undefined) {
      if (!Array.isArray(r.if)) {
        errors.push(`${path}[${i}].if must be an array`);
      } else {
        for (let k = 0; k < r.if.length; k++) {
          const cond = r.if[k];
          if (
            !isRecord(cond) ||
            typeof cond.varName !== 'string' ||
            !cond.varName ||
            !VALID_COMPARE_OPS.has(String(cond.op)) ||
            !isFiniteNum(cond.value)
          ) {
            errors.push(`${path}[${i}].if[${k}] requires varName, valid op, and finite value`);
          }
        }
      }
    }

    for (let j = 0; j < r.do.length; j++) {
      const a = r.do[j];
      if (!isRecord(a)) {
        errors.push(`${path}[${i}].do[${j}] must be an object`);
        continue;
      }
      const act = a as Partial<VmAction>;
      switch (act.type) {
        case 'Spawn':
          if (typeof act.archetypeId !== 'string' || !archKeys.has(act.archetypeId)) {
            errors.push(`${path}[${i}].do[${j}] references unknown archetype '${String(act.archetypeId)}'`);
          }
          if (!isFiniteNum(act.x) || !isFiniteNum(act.y)) errors.push(`${path}[${i}].do[${j}] Spawn requires finite x, y`);
          break;
        case 'Destroy':
          if (act.target !== 'self' && act.target !== 'other' && act.target !== 'byTag') errors.push(`${path}[${i}].do[${j}] Destroy target invalid`);
          break;
        case 'Impulse':
          if (!isFiniteNum(act.vx) || !isFiniteNum(act.vy)) errors.push(`${path}[${i}].do[${j}] Impulse requires finite vx, vy`);
          break;
        case 'SetVar':
          if (
            typeof act.name !== 'string' ||
            !VALID_VAR_OPS.has(String(act.op)) ||
            (!isFiniteNum(act.value) && typeof act.valueVar !== 'string')
          ) {
            errors.push(`${path}[${i}].do[${j}] SetVar invalid`);
          }
          break;
        case 'PlaySfx':
          if (!VALID_SOUND_PRESETS.has(act.preset as SimEvent)) errors.push(`${path}[${i}].do[${j}] unknown sound preset '${String(act.preset)}'`);
          break;
        case 'Juice':
          break;
        case 'EndGame':
          if (act.outcome !== 'won' && act.outcome !== 'lost' && act.outcome !== 'nextStage') {
            errors.push(`${path}[${i}].do[${j}] EndGame outcome invalid`);
          }
          break;
        case 'EmitSignal':
          if (typeof act.signal !== 'string' || !act.signal) {
            errors.push(`${path}[${i}].do[${j}] EmitSignal requires non-empty signal`);
          }
          break;
        case 'FloatText':
          if (typeof act.text !== 'string' || !act.text) {
            errors.push(`${path}[${i}].do[${j}] FloatText requires non-empty text`);
          }
          if (act.color !== undefined && (typeof act.color !== 'string' || !HEX_COLOR_RE.test(act.color))) {
            errors.push(`${path}[${i}].do[${j}] FloatText color must be a valid hex color`);
          }
          if (
            act.anchor !== undefined &&
            act.anchor !== 'player' &&
            act.anchor !== 'self' &&
            act.anchor !== 'other' &&
            act.anchor !== 'world'
          ) {
            errors.push(`${path}[${i}].do[${j}] FloatText anchor invalid`);
          }
          if (act.x !== undefined && !isFiniteNum(act.x)) errors.push(`${path}[${i}].do[${j}] FloatText x must be finite`);
          if (act.y !== undefined && !isFiniteNum(act.y)) errors.push(`${path}[${i}].do[${j}] FloatText y must be finite`);
          break;
        case 'TweenVar':
          if (
            typeof act.name !== 'string' ||
            !act.name ||
            !isFiniteNum(act.to) ||
            !isFiniteNum(act.duration) ||
            act.duration < 0 ||
            act.duration > 60
          ) {
            errors.push(`${path}[${i}].do[${j}] TweenVar requires name, finite to, and duration in [0, 60]`);
          }
          if (act.ease !== undefined && !VALID_TWEEN_EASES.has(String(act.ease))) {
            errors.push(`${path}[${i}].do[${j}] TweenVar ease invalid`);
          }
          break;
        default:
          errors.push(`${path}[${i}].do[${j}].type '${String(act.type)}' unsupported`);
      }
    }
  }
}

/**
 * Pure structural, semantic, and safety validator for CartridgeJsonV1.
 * Ensures bounds (<=1024x256 tilemap, <=128 rules, <=512 spawns/stage), reference integrity, and zero eval/script code.
 */
export function validateCartridgeJson(raw: unknown): CartridgeValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ['Cartridge root must be a JSON object'] };
  }
  if (hasUnsafeCodeStrings(raw)) {
    return { ok: false, errors: ['Cartridge contains forbidden prototype keys or unsafe script syntax'] };
  }
  if (raw.version !== CARTRIDGE_SCHEMA_VERSION) {
    errors.push(`Unsupported cartridge schema version '${String(raw.version)}' (expected ${CARTRIDGE_SCHEMA_VERSION})`);
  }

  const validSprites = new Set<string>(KNOWN_BUILTIN_SPRITES);
  if (raw.sprites !== undefined) {
    if (!isRecord(raw.sprites)) errors.push('sprites must be an object map');
    else {
      for (const [sid, grid] of Object.entries(raw.sprites)) {
        if (!Array.isArray(grid) || grid.length === 0 || grid.length > 32) {
          errors.push(`sprites.${sid} must be a 1..32 row pixel grid`);
        } else {
          validSprites.add(sid);
        }
      }
    }
  }

  if (!isRecord(raw.meta)) {
    errors.push('meta object is required');
  } else {
    if (typeof raw.meta.id !== 'string' || !raw.meta.id) errors.push('meta.id must be a non-empty string');
    if (typeof raw.meta.code !== 'string' || !raw.meta.code) errors.push('meta.code must be a non-empty string');
    if (typeof raw.meta.title !== 'string' || !raw.meta.title) errors.push('meta.title must be a non-empty string');
    if (raw.meta.genre !== 'platformer' && raw.meta.genre !== 'shmup') errors.push("meta.genre must be 'platformer' or 'shmup'");
    if (
      raw.meta.genreHud !== undefined &&
      (typeof raw.meta.genreHud !== 'string' || !VALID_GENRE_HUDS.has(raw.meta.genreHud))
    ) {
      errors.push("meta.genreHud must be 'platformer' | 'parkour' | 'fighter' | 'card' | 'grid'");
    }
  }

  if (raw.cardDeck !== undefined) {
    if (!Array.isArray(raw.cardDeck) || raw.cardDeck.length > 32) {
      errors.push('cardDeck must be an array of at most 32 cards');
    } else {
      for (let i = 0; i < raw.cardDeck.length; i++) {
        const card = raw.cardDeck[i];
        if (!isRecord(card)) {
          errors.push(`cardDeck[${i}] must be an object`);
          continue;
        }
        if (typeof card.id !== 'string' || !card.id) errors.push(`cardDeck[${i}].id must be a non-empty string`);
        if (typeof card.name !== 'string' || !card.name) errors.push(`cardDeck[${i}].name must be a non-empty string`);
        if (!isFiniteNum(card.cost) || card.cost < 0 || card.cost > 20) errors.push(`cardDeck[${i}].cost must be in [0, 20]`);
        if (!VALID_CARD_KINDS.has(String(card.kind))) {
          errors.push(`cardDeck[${i}].kind must be 'attack' | 'shield' | 'heal' | 'surge'`);
        }
        if (!isFiniteNum(card.power) || card.power < 0 || card.power > 999) errors.push(`cardDeck[${i}].power must be in [0, 999]`);
        if (card.color !== undefined && (typeof card.color !== 'string' || !HEX_COLOR_RE.test(card.color))) {
          errors.push(`cardDeck[${i}].color must be a valid hex color`);
        }
      }
    }
  }

  if (!isRecord(raw.player)) {
    errors.push('player object is required');
  } else {
    if (typeof raw.player.controller !== 'string' || !VALID_CONTROLLERS.has(raw.player.controller)) {
      errors.push("player.controller must be 'platformer' | 'shmup' | 'topdown' | 'fighter' | 'card'");
    }
    if (typeof raw.player.sprite !== 'string' || !validSprites.has(raw.player.sprite)) {
      errors.push(`player.sprite '${String(raw.player.sprite)}' is unknown`);
    }
    if (raw.player.spriteB !== undefined && (typeof raw.player.spriteB !== 'string' || !validSprites.has(raw.player.spriteB))) {
      errors.push(`player.spriteB '${String(raw.player.spriteB)}' is unknown`);
    }
    if (!isFiniteNum(raw.player.w) || raw.player.w <= 0 || raw.player.w > 64) errors.push('player.w must be in (0, 64]');
    if (!isFiniteNum(raw.player.h) || raw.player.h <= 0 || raw.player.h > 64) errors.push('player.h must be in (0, 64]');
    if (!isFiniteNum(raw.player.maxHearts) || raw.player.maxHearts < 1 || raw.player.maxHearts > 16) {
      errors.push('player.maxHearts must be in [1, 16]');
    }
    if (raw.player.grappleConfig !== undefined) {
      if (!isRecord(raw.player.grappleConfig)) {
        errors.push('player.grappleConfig must be an object');
      } else {
        const gc = raw.player.grappleConfig;
        if (gc.enabled !== undefined && typeof gc.enabled !== 'boolean') {
          errors.push('player.grappleConfig.enabled must be a boolean');
        }
        if (gc.attachWalls !== undefined && typeof gc.attachWalls !== 'boolean') {
          errors.push('player.grappleConfig.attachWalls must be a boolean');
        }
        if (gc.maxRange !== undefined && (!isFiniteNum(gc.maxRange) || gc.maxRange <= 0 || gc.maxRange > 512)) {
          errors.push('player.grappleConfig.maxRange must be in (0, 512]');
        }
        if (gc.pullSpeed !== undefined && (!isFiniteNum(gc.pullSpeed) || gc.pullSpeed <= 0 || gc.pullSpeed > 1600)) {
          errors.push('player.grappleConfig.pullSpeed must be in (0, 1600]');
        }
      }
    }
    if (raw.player.visualRig !== undefined) {
      if (!isRecord(raw.player.visualRig)) {
        errors.push('player.visualRig must be an object');
      } else {
        const vr = raw.player.visualRig;
        if (vr.verletChain !== undefined) {
          if (!isRecord(vr.verletChain) || typeof vr.verletChain.enabled !== 'boolean') {
            errors.push('player.visualRig.verletChain requires boolean enabled');
          } else {
            if (vr.verletChain.nodes !== undefined && (!isFiniteNum(vr.verletChain.nodes) || vr.verletChain.nodes < 2 || vr.verletChain.nodes > 16)) {
              errors.push('player.visualRig.verletChain.nodes must be in [2, 16]');
            }
            if (vr.verletChain.colorReady !== undefined && (typeof vr.verletChain.colorReady !== 'string' || !HEX_COLOR_RE.test(vr.verletChain.colorReady))) {
              errors.push('player.visualRig.verletChain.colorReady must be a valid hex color');
            }
            if (vr.verletChain.colorSpent !== undefined && (typeof vr.verletChain.colorSpent !== 'string' || !HEX_COLOR_RE.test(vr.verletChain.colorSpent))) {
              errors.push('player.visualRig.verletChain.colorSpent must be a valid hex color');
            }
          }
        }
        if (vr.twoBoneIk !== undefined) {
          if (!isRecord(vr.twoBoneIk) || typeof vr.twoBoneIk.enabled !== 'boolean') {
            errors.push('player.visualRig.twoBoneIk requires boolean enabled');
          }
        }
        if (vr.afterimage !== undefined) {
          if (!isRecord(vr.afterimage) || typeof vr.afterimage.enabled !== 'boolean') {
            errors.push('player.visualRig.afterimage requires boolean enabled');
          }
        }
      }
    }
  }

  if (raw.perspective !== undefined) {
    if (!isRecord(raw.perspective)) {
      errors.push('perspective must be an object');
    } else {
      const p = raw.perspective;
      if (p.defaultMode !== undefined && p.defaultMode !== 'first_person' && p.defaultMode !== 'third_person') {
        errors.push("perspective.defaultMode must be 'first_person' | 'third_person'");
      }
      if (p.fovDeg !== undefined && (!isFiniteNum(p.fovDeg) || p.fovDeg < 35 || p.fovDeg > 120)) {
        errors.push('perspective.fovDeg must be in [35, 120]');
      }
      if (p.maxDist !== undefined && (!isFiniteNum(p.maxDist) || p.maxDist < 32 || p.maxDist > 640)) {
        errors.push('perspective.maxDist must be in [32, 640]');
      }
    }
  }

  const archKeys = new Set<string>();
  if (!isRecord(raw.archetypes)) {
    errors.push('archetypes map is required');
  } else {
    const entries = Object.entries(raw.archetypes);
    if (entries.length > MAX_ARCHETYPES_PER_CARTRIDGE) {
      errors.push(`archetypes count (${entries.length}) exceeds max ${MAX_ARCHETYPES_PER_CARTRIDGE}`);
    }
    for (const [id, def] of entries) {
      archKeys.add(id);
      if (!isRecord(def)) {
        errors.push(`archetypes.${id} must be an object`);
        continue;
      }
      if (typeof def.sprite !== 'string' || !validSprites.has(def.sprite)) {
        errors.push(`archetypes.${id}.sprite '${String(def.sprite)}' is unknown`);
      }
      if (def.spriteB !== undefined && (typeof def.spriteB !== 'string' || !validSprites.has(def.spriteB))) {
        errors.push(`archetypes.${id}.spriteB '${String(def.spriteB)}' is unknown`);
      }
      if (!isFiniteNum(def.w) || def.w <= 0 || def.w > 128) errors.push(`archetypes.${id}.w must be in (0, 128]`);
      if (!isFiniteNum(def.h) || def.h <= 0 || def.h > 128) errors.push(`archetypes.${id}.h must be in (0, 128]`);
      if (!Array.isArray(def.tags)) errors.push(`archetypes.${id}.tags must be an array`);
      if (def.behavior !== undefined) {
        if (!isRecord(def.behavior) || !VALID_BEHAVIORS.has(String(def.behavior.kind))) {
          errors.push(`archetypes.${id}.behavior.kind invalid`);
        } else {
          if (def.behavior.sightRange !== undefined && (!isFiniteNum(def.behavior.sightRange) || def.behavior.sightRange <= 0 || def.behavior.sightRange > 1024)) {
            errors.push(`archetypes.${id}.behavior.sightRange must be in (0, 1024]`);
          }
          if (def.behavior.chaseSpeed !== undefined && (!isFiniteNum(def.behavior.chaseSpeed) || def.behavior.chaseSpeed <= 0 || def.behavior.chaseSpeed > 400)) {
            errors.push(`archetypes.${id}.behavior.chaseSpeed must be in (0, 400]`);
          }
        }
      }
    }
  }

  const maxChunksX = Math.ceil(MAX_TILEMAP_COLS / CHUNK_SIZE);
  const maxChunksY = Math.ceil(MAX_TILEMAP_ROWS / CHUNK_SIZE);

  const ruleBudget = { count: 0 };
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
    errors.push('stages must be a non-empty array');
  } else if (raw.stages.length > MAX_STAGES_PER_CARTRIDGE) {
    errors.push(`stages length exceeds max ${MAX_STAGES_PER_CARTRIDGE}`);
  } else {
    for (let i = 0; i < raw.stages.length; i++) {
      const st = raw.stages[i];
      if (!isRecord(st)) {
        errors.push(`stages[${i}] must be an object`);
        continue;
      }
      if (typeof st.id !== 'string' || typeof st.name !== 'string') errors.push(`stages[${i}] requires id and name strings`);
      if (!isFiniteNum(st.worldWidth) || st.worldWidth < 160 || st.worldWidth > MAX_TILEMAP_COLS * TILE_SIZE) {
        errors.push(`stages[${i}].worldWidth must be in [160, ${MAX_TILEMAP_COLS * TILE_SIZE}]`);
      }
      if (st.worldHeight !== undefined && (!isFiniteNum(st.worldHeight) || st.worldHeight < 120 || st.worldHeight > MAX_TILEMAP_ROWS * TILE_SIZE)) {
        errors.push(`stages[${i}].worldHeight exceeds bounds`);
      }
      if (!VALID_BGM_THEMES.has(st.bgmTheme as BgmTheme)) {
        errors.push(`stages[${i}].bgmTheme '${String(st.bgmTheme)}' invalid`);
      }
      if (st.skyTop !== undefined && (typeof st.skyTop !== 'string' || !HEX_COLOR_RE.test(st.skyTop))) {
        errors.push(`stages[${i}].skyTop must be a valid hex color`);
      }
      if (st.skyBottom !== undefined && (typeof st.skyBottom !== 'string' || !HEX_COLOR_RE.test(st.skyBottom))) {
        errors.push(`stages[${i}].skyBottom must be a valid hex color`);
      }
      if (st.artMood !== undefined) {
        if (!isRecord(st.artMood) || typeof st.artMood.baseHex !== 'string' || !HEX_COLOR_RE.test(st.artMood.baseHex)) {
          errors.push(`stages[${i}].artMood.baseHex must be a valid hex color`);
        } else {
          if (st.artMood.accentHex !== undefined && (typeof st.artMood.accentHex !== 'string' || !HEX_COLOR_RE.test(st.artMood.accentHex))) {
            errors.push(`stages[${i}].artMood.accentHex must be a valid hex color`);
          }
          if (st.artMood.parallaxFog !== undefined && (!isFiniteNum(st.artMood.parallaxFog) || st.artMood.parallaxFog < 0 || st.artMood.parallaxFog > 1)) {
            errors.push(`stages[${i}].artMood.parallaxFog must be in [0, 1]`);
          }
        }
      }
      if (st.atmosphere !== undefined) {
        if (!isRecord(st.atmosphere)) {
          errors.push(`stages[${i}].atmosphere must be an object`);
        } else {
          const atm = st.atmosphere;
          if (atm.waterTint !== undefined && (typeof atm.waterTint !== 'string' || !HEX_COLOR_RE.test(atm.waterTint))) {
            errors.push(`stages[${i}].atmosphere.waterTint must be a valid hex color`);
          }
          if (atm.horizonHazeColor !== undefined && (typeof atm.horizonHazeColor !== 'string' || !HEX_COLOR_RE.test(atm.horizonHazeColor))) {
            errors.push(`stages[${i}].atmosphere.horizonHazeColor must be a valid hex color`);
          }
          if (atm.curlParticles !== undefined && (!isRecord(atm.curlParticles) || typeof atm.curlParticles.enabled !== 'boolean')) {
            errors.push(`stages[${i}].atmosphere.curlParticles requires boolean enabled`);
          }
        }
      }
      if (st.procedural !== undefined) {
        if (!isRecord(st.procedural) || !isFiniteNum(st.procedural.seed)) {
          errors.push(`stages[${i}].procedural requires a finite seed`);
        } else {
          if (st.procedural.biome !== undefined && !VALID_BIOMES.has(String(st.procedural.biome))) {
            errors.push(`stages[${i}].procedural.biome '${String(st.procedural.biome)}' invalid`);
          }
          if (st.procedural.frequency !== undefined && (!isFiniteNum(st.procedural.frequency) || st.procedural.frequency <= 0 || st.procedural.frequency > 1)) {
            errors.push(`stages[${i}].procedural.frequency must be in (0, 1]`);
          }
          if (st.procedural.octaves !== undefined && (!isFiniteNum(st.procedural.octaves) || st.procedural.octaves < 1 || st.procedural.octaves > 8)) {
            errors.push(`stages[${i}].procedural.octaves must be in [1, 8]`);
          }
          if (st.procedural.gapChance !== undefined && (!isFiniteNum(st.procedural.gapChance) || st.procedural.gapChance < 0 || st.procedural.gapChance > 0.6)) {
            errors.push(`stages[${i}].procedural.gapChance must be in [0, 0.6]`);
          }
          if (st.procedural.parallaxBands !== undefined && (!isFiniteNum(st.procedural.parallaxBands) || st.procedural.parallaxBands < 0 || st.procedural.parallaxBands > 4)) {
            errors.push(`stages[${i}].procedural.parallaxBands must be in [0, 4]`);
          }
        }
      }
      if (st.springCamera !== undefined) {
        if (
          !isRecord(st.springCamera) ||
          (st.springCamera.freqHz !== undefined && (!isFiniteNum(st.springCamera.freqHz) || st.springCamera.freqHz <= 0 || st.springCamera.freqHz > 30)) ||
          (st.springCamera.dampingRatio !== undefined && (!isFiniteNum(st.springCamera.dampingRatio) || st.springCamera.dampingRatio <= 0 || st.springCamera.dampingRatio > 8))
        ) {
          errors.push(`stages[${i}].springCamera has out-of-range parameters`);
        }
      }
      if (st.groundTop !== undefined && !validSprites.has(String(st.groundTop))) {
        errors.push(`stages[${i}].groundTop '${String(st.groundTop)}' unknown`);
      }
      if (st.groundFill !== undefined && !validSprites.has(String(st.groundFill))) {
        errors.push(`stages[${i}].groundFill '${String(st.groundFill)}' unknown`);
      }
      if (st.tileGrid !== undefined) {
        if (!isRecord(st.tileGrid)) errors.push(`stages[${i}].tileGrid must be an object`);
        else {
          const cols = st.tileGrid.cols;
          const rows = st.tileGrid.rows;
          if (!isFiniteNum(cols) || cols < 1 || cols > MAX_TILEMAP_COLS || !isFiniteNum(rows) || rows < 1 || rows > MAX_TILEMAP_ROWS) {
            errors.push(`stages[${i}].tileGrid dims must be <= ${MAX_TILEMAP_COLS}x${MAX_TILEMAP_ROWS}`);
          } else if (cols * rows > 65536) {
            errors.push(`stages[${i}].tileGrid dense cell count exceeds 65536; use tileChunks for massive worlds`);
          } else if (
            !Array.isArray(st.tileGrid.tiles) ||
            !Array.isArray(st.tileGrid.collision) ||
            st.tileGrid.tiles.length !== cols * rows ||
            st.tileGrid.collision.length !== cols * rows ||
            (st.tileGrid.fgTiles !== undefined && (!Array.isArray(st.tileGrid.fgTiles) || st.tileGrid.fgTiles.length !== cols * rows))
          ) {
            errors.push(`stages[${i}].tileGrid tiles/collision lengths must equal cols * rows`);
          }
        }
      }
      if (st.tileChunks !== undefined) {
        if (!Array.isArray(st.tileChunks) || st.tileChunks.length > maxChunksX * maxChunksY) {
          errors.push(`stages[${i}].tileChunks must be an array of at most ${maxChunksX * maxChunksY} chunks`);
        } else {
          for (let j = 0; j < st.tileChunks.length; j++) {
            const ch = st.tileChunks[j];
            if (
              !isRecord(ch) ||
              !isFiniteNum(ch.cx) || ch.cx < 0 || ch.cx >= maxChunksX || (ch.cx | 0) !== ch.cx ||
              !isFiniteNum(ch.cy) || ch.cy < 0 || ch.cy >= maxChunksY || (ch.cy | 0) !== ch.cy
            ) {
              errors.push(`stages[${i}].tileChunks[${j}] has out-of-range chunk coordinates`);
            } else if (
              !Array.isArray(ch.tiles) ||
              !Array.isArray(ch.collision) ||
              ch.tiles.length !== CHUNK_AREA ||
              ch.collision.length !== CHUNK_AREA ||
              (ch.fgTiles !== undefined && (!Array.isArray(ch.fgTiles) || ch.fgTiles.length !== CHUNK_AREA))
            ) {
              errors.push(`stages[${i}].tileChunks[${j}] tiles/collision lengths must equal ${CHUNK_AREA}`);
            }
          }
        }
      }
      if (st.bgParallaxLayers !== undefined) {
        if (!Array.isArray(st.bgParallaxLayers) || st.bgParallaxLayers.length > 32) {
          errors.push(`stages[${i}].bgParallaxLayers must be an array of <= 32 layers`);
        } else {
          for (let j = 0; j < st.bgParallaxLayers.length; j++) {
            const ly = st.bgParallaxLayers[j];
            if (
              !isRecord(ly) ||
              typeof ly.sprite !== 'string' ||
              !validSprites.has(ly.sprite) ||
              !isFiniteNum(ly.x) || !isFiniteNum(ly.y) ||
              !isFiniteNum(ly.w) || ly.w <= 0 ||
              !isFiniteNum(ly.h) || ly.h <= 0
            ) {
              errors.push(`stages[${i}].bgParallaxLayers[${j}] requires valid sprite and finite rect`);
            }
          }
        }
      }
      if (st.fgIslands !== undefined) {
        if (!Array.isArray(st.fgIslands) || st.fgIslands.length > 256) {
          errors.push(`stages[${i}].fgIslands must be an array of <= 256 spans`);
        } else {
          for (let j = 0; j < st.fgIslands.length; j++) {
            const fg = st.fgIslands[j];
            if (
              !isRecord(fg) ||
              !isFiniteNum(fg.startTile) || !isFiniteNum(fg.countTiles) || !isFiniteNum(fg.topY) ||
              (fg.sprite !== undefined && (typeof fg.sprite !== 'string' || !validSprites.has(fg.sprite)))
            ) {
              errors.push(`stages[${i}].fgIslands[${j}] invalid`);
            }
          }
        }
      }
      if (st.fgTiles !== undefined) {
        if (!Array.isArray(st.fgTiles) || st.fgTiles.length > 2048) {
          errors.push(`stages[${i}].fgTiles must be an array of <= 2048 items`);
        } else {
          for (let j = 0; j < st.fgTiles.length; j++) {
            const ft = st.fgTiles[j];
            if (!isRecord(ft) || typeof ft.sprite !== 'string' || !validSprites.has(ft.sprite) || !isFiniteNum(ft.x) || !isFiniteNum(ft.y)) {
              errors.push(`stages[${i}].fgTiles[${j}] requires valid sprite and finite x, y`);
            }
          }
        }
      }
      if (st.spawns !== undefined) {
        if (!Array.isArray(st.spawns)) errors.push(`stages[${i}].spawns must be an array`);
        else if (st.spawns.length > MAX_SPAWNS_PER_STAGE) errors.push(`stages[${i}].spawns exceeds max ${MAX_SPAWNS_PER_STAGE}`);
        else {
          for (let j = 0; j < st.spawns.length; j++) {
            const sp = st.spawns[j];
            if (!isRecord(sp) || typeof sp.archetype !== 'string' || !archKeys.has(sp.archetype)) {
              errors.push(`stages[${i}].spawns[${j}] references unknown archetype '${String(isRecord(sp) ? sp.archetype : sp)}'`);
            }
          }
        }
      }
      if (st.waves !== undefined) {
        if (!isRecord(st.waves) || !Array.isArray(st.waves.pool) || st.waves.pool.length === 0) {
          errors.push(`stages[${i}].waves requires non-empty pool`);
        } else {
          for (const aid of st.waves.pool) {
            if (typeof aid !== 'string' || !archKeys.has(aid)) {
              errors.push(`stages[${i}].waves.pool references unknown archetype '${String(aid)}'`);
            }
          }
        }
      }
      if (st.boss !== undefined) {
        if (!isRecord(st.boss) || typeof st.boss.archetype !== 'string' || !archKeys.has(st.boss.archetype)) {
          errors.push(`stages[${i}].boss references unknown archetype`);
        } else if (st.boss.weakPointArchetype !== undefined && !archKeys.has(String(st.boss.weakPointArchetype))) {
          errors.push(`stages[${i}].boss.weakPointArchetype unknown`);
        }
      }
      if (st.rules !== undefined) {
        validateRulesList(st.rules, `stages[${i}].rules`, archKeys, errors, ruleBudget);
      }
    }
  }

  if (raw.rules !== undefined) {
    validateRulesList(raw.rules, 'rules', archKeys, errors, ruleBudget);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: raw as unknown as CartridgeJsonV1 };
}
