import type { SpriteId } from '../../assets/AtlasSpritesData.ts';
import type { SeededRng } from '../../core/runtime/SeededRng.ts';
import type { GridPos } from '../../core/sim/GridPathfinder.ts';
import type { JuiceSystem, SquashSpring } from '../../core/sim/JuiceSystem.ts';
import type { RpgHudSnapshot, RpgMenuOption } from '../../core/types/WorldTypes.ts';
import type { CharacterStats, StatKey, StatusEffectKind } from './RpgRules.ts';

export type GridTileKind = 'wall' | 'floor' | 'door' | 'locked_door' | 'stairs_down' | 'trap' | 'torch' | 'campfire';

export interface DungeonEntityDef {
  id: string;
  kind: 'monster' | 'chest' | 'npc';
  archetype?: string;
  sprite?: SpriteId;
  name?: string;
  x: number;
  y: number;
  dialogId?: string;
  loot?: 'key' | 'potion' | 'elixir' | 'gold' | 'weapon' | 'armor' | 'relic';
  itemId?: string;
}

export interface DialogChoiceDef {
  id: string;
  label: string;
  checkStat?: StatKey;
  checkDc?: number;
  costGold?: number;
  successText: string;
  failText?: string;
  rewardFlag?: string;
  rewardPotion?: number;
  rewardGold?: number;
  rewardItem?: string;
  rewardHpFull?: boolean;
  rewardXp?: number;
  failDamage?: number;
}

export interface DialogDef {
  speaker: string;
  text: string;
  choices: DialogChoiceDef[];
}

export interface DungeonFloorDef {
  id: string;
  name: string;
  map: string[];
  spawn: GridPos;
  entities: DungeonEntityDef[];
}

export interface DungeonModuleDef {
  title: string;
  ambientDarkness?: number;
  floors: DungeonFloorDef[];
  dialogs: Record<string, DialogDef>;
}

export interface ActiveEntity {
  id: string;
  kind: 'monster' | 'chest' | 'npc';
  name: string;
  sprite: SpriteId;
  tint?: string;
  x: number;
  y: number;
  alive: boolean;
  opened?: boolean;
  talked?: boolean;
  hp: number;
  maxHp: number;
  ac: number;
  atkMod: number;
  damageCount: number;
  damageSides: number;
  damageBonus: number;
  xpReward: number;
  goldReward: number;
  isBoss?: boolean;
  isMiniBoss?: boolean;
  inflictStatus?: StatusEffectKind;
  specialName?: string;
  dialogId?: string;
  loot?: string;
  itemId?: string;
  lootDrop?: string;
  statuses: Partial<Record<StatusEffectKind, number>>;
  flash: number;
  squash: SquashSpring;
}

export interface FloorRuntime {
  def: DungeonFloorDef;
  width: number;
  height: number;
  grid: GridTileKind[][];
  explored: Set<number>;
  visible: Set<number>;
  entities: ActiveEntity[];
}

export type TurnPhase =
  | { kind: 'explore'; menuIdx: number }
  | { kind: 'dialog'; entityId: string; dialogId: string; selectedIdx: number }
  | { kind: 'combat'; entityId: string; turnOwner: 'player' | 'enemy'; round: number; enemyTimer: number; selectedIdx: number }
  | { kind: 'won' }
  | { kind: 'lost' };

export type HeroRuntimeState = CharacterStats &
  GridPos & {
    visualX: number;
    visualY: number;
    facingLeft: boolean;
    flash: number;
    squash: SquashSpring;
  };

export interface DndWorldState {
  readonly moduleDef: DungeonModuleDef;
  readonly rng: SeededRng;
  readonly juice: JuiceSystem;
  hero: HeroRuntimeState;
  blackboard: Record<string, boolean | number | string>;
  turnCount: number;
  score: number;
  chestsCollected: number;
  totalChests: number;
  agentAuto: boolean;
  debugHitboxes: boolean;
  floors: FloorRuntime[];
  floorIdx: number;
  phase: TurnPhase;
  combatLog: string[];
  autoCooldown: number;
}

export interface AgentObservation {
  moduleTitle: string;
  phase: TurnPhase['kind'];
  floorId: string;
  floorName: string;
  turnCount: number;
  hero: CharacterStats & GridPos;
  blackboard: Record<string, boolean | number | string>;
  visibleEntities: { id: string; kind: string; name: string; x: number; y: number; hp?: number }[];
  combat?: RpgHudSnapshot['combat'];
  dialog?: RpgHudSnapshot['dialog'];
  combatLog: string[];
}

export const TILE_PX = 16;

export const EXPLORE_ACTIONS: readonly RpgMenuOption[] = [
  { id: 'wait', label: '⌛ 待命回氣', enabled: true },
  { id: 'potion', label: '🧪 喝治療藥水', enabled: true },
  { id: 'agent_step', label: '🤖 AI 單步代駕', enabled: true },
];

export const CHAR_TO_TILE: Record<string, GridTileKind> = {
  '#': 'wall',
  '.': 'floor',
  'D': 'door',
  'L': 'locked_door',
  '>': 'stairs_down',
  '^': 'trap',
  'T': 'torch',
  'C': 'campfire',
};

export function getActiveFloor(state: DndWorldState): FloorRuntime {
  return state.floors[state.floorIdx];
}

export function isOpaqueAt(floor: FloorRuntime, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return true;
  const t = floor.grid[y][x];
  return t === 'wall' || t === 'door' || t === 'locked_door';
}

export function isWalkableAt(floor: FloorRuntime, x: number, y: number, allowDoors = true): boolean {
  if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return false;
  const t = floor.grid[y][x];
  if (t === 'wall') return false;
  if (!allowDoors && (t === 'door' || t === 'locked_door')) return false;
  return true;
}

export function findEntityAt(floor: FloorRuntime, x: number, y: number): ActiveEntity | undefined {
  return floor.entities.find((e) => e.alive && e.x === x && e.y === y);
}
