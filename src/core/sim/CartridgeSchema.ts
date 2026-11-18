import { BUILTIN_SPRITE_GRIDS, type SpriteId } from '../../assets/AtlasSpritesData.ts';
import type { BgCloudDesc, BgmTheme, SimEvent } from '../types/WorldTypes.ts';
import type { VmAction, VmRule, VmTrigger } from './EventActionVm.ts';
import { MAX_TILEMAP_COLS, MAX_TILEMAP_ROWS, TILE_SIZE } from './TilemapGrid.ts';

export const CARTRIDGE_SCHEMA_VERSION = 1;
export const MAX_ARCHETYPES_PER_CARTRIDGE = 128;
export const MAX_STAGES_PER_CARTRIDGE = 64;
export const MAX_SPAWNS_PER_STAGE = 512;
export const MAX_VM_RULES_TOTAL = 128;

const KNOWN_BUILTIN_SPRITES = new Set<string>([
  ...Object.keys(BUILTIN_SPRITE_GRIDS),
  'hero_a',
  'hero_b',
  'boss_ufo',
  'slime_king',
]);

const VALID_SOUND_PRESETS = new Set<SimEvent>([
  'jump', 'star', 'stomp', 'hurt', 'laser', 'key', 'win',
  'bounce', 'explode', 'ignite', 'snap', 'charge', 'rail',
]);

const VALID_BGM_THEMES = new Set<BgmTheme>(['meadow', 'starlight', 'dungeon', 'boss']);
const VALID_BEHAVIORS = new Set<string>([
  'none', 'patrol', 'sine', 'interceptor', 'frigate', 'carrier',
  'missile', 'meteor', 'cargo', 'boss_shmup', 'boss_stomp', 'orbit',
]);
const VALID_BUTTONS = new Set<string>(['jump', 'action', 'skillX', 'skillY', 'shoulderL', 'shoulderR']);
const VALID_COMPARE_OPS = new Set<string>(['==', '!=', '<', '<=', '>', '>=']);
const VALID_VAR_OPS = new Set<string>(['=', '+=', '-=', 'clamp']);
const FORBIDDEN_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype']);

export type CartridgeTag =
  | 'player' | 'solid' | 'oneway' | 'hazard' | 'collectible' | 'stompable'
  | 'bouncy' | 'gravity' | 'enemy' | 'boss' | 'weak_point' | 'bullet'
  | 'enemy_bullet' | 'pickup' | 'relic' | 'checkpoint' | 'key' | 'gate'
  | 'torch' | 'moving_plat' | 'funnel' | 'star' | 'coin';

export interface CartridgeArchetypeBehavior {
  kind:
    | 'none' | 'patrol' | 'sine' | 'interceptor' | 'frigate' | 'carrier'
    | 'missile' | 'meteor' | 'cargo' | 'boss_shmup' | 'boss_stomp' | 'orbit';
  speedX?: number;
  speedY?: number;
  amplitude?: number;
  freq?: number;
  fireCooldown?: number;
  spread?: readonly number[];
  orbitRadius?: number;
  orbitSpeed?: number;
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

export interface CartridgeStageDef {
  id: string;
  name: string;
  worldWidth: number;
  worldHeight?: number;
  skyTop: string;
  skyBottom: string;
  ambientDarkness?: number;
  ambientColor?: string;
  bgmTheme: BgmTheme;
  paletteRow?: number;
  hint: string;
  viewport?: 'classic' | 'wide' | 'hd' | { width: number; height: number };
  spawn: { x: number; y: number };
  groundTop?: SpriteId;
  groundFill?: SpriteId;
  islands?: readonly { startTile: number; countTiles: number; topY: number }[];
  clouds?: readonly { x: number; y: number; tilesWide: number }[];
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
    spriteMap: Record<string, SpriteId>;
  };
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
  rules?: readonly VmRule[];
}

export interface CartridgeJsonV1 {
  version: 1;
  meta: {
    id: string;
    code: string;
    title: string;
    subtitle?: string;
    genre: 'platformer' | 'shmup';
    viewport?: 'classic' | 'wide' | 'hd' | { width: number; height: number };
    paletteRow?: number;
    glowIntensity?: number;
  };
  initialVars?: Record<string, number>;
  sprites?: Record<string, readonly string[]>;
  player: {
    controller: 'platformer' | 'shmup';
    sprite: SpriteId;
    spriteB?: SpriteId;
    w: number;
    h: number;
    maxHearts: number;
    scoutZoom?: number;
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
      default:
        errors.push(`${path}[${i}].when.type '${String(w.type)}' unsupported`);
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
          if (typeof act.name !== 'string' || !VALID_VAR_OPS.has(String(act.op)) || !isFiniteNum(act.value)) {
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
        default:
          errors.push(`${path}[${i}].do[${j}].type '${String(act.type)}' unsupported`);
      }
    }
  }
}

/**
 * Pure structural, semantic, and safety validator for CartridgeJsonV1.
 * Ensures bounds (<=256x64 tilemap, <=128 rules, <=512 spawns/stage), reference integrity, and zero eval/script code.
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
  }

  if (!isRecord(raw.player)) {
    errors.push('player object is required');
  } else {
    if (raw.player.controller !== 'platformer' && raw.player.controller !== 'shmup') {
      errors.push("player.controller must be 'platformer' or 'shmup'");
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
        }
      }
    }
  }

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
          } else if (
            !Array.isArray(st.tileGrid.tiles) ||
            !Array.isArray(st.tileGrid.collision) ||
            st.tileGrid.tiles.length !== cols * rows ||
            st.tileGrid.collision.length !== cols * rows
          ) {
            errors.push(`stages[${i}].tileGrid tiles/collision lengths must equal cols * rows`);
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
