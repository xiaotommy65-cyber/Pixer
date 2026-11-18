import type { CartridgeRunner } from '../runtime/CartridgeRunner.ts';
import {
  isTurnCapableCartridge,
  type CartridgeId,
  type RenderSceneSnapshot,
  type RpgMenuOption,
} from '../types/WorldTypes.ts';

export interface UnifiedGameObservation {
  cartridgeId: CartridgeId;
  status: 'playing' | 'won' | 'lost';
  mode: string;
  score: number;
  stage?: { index: number; total: number; name: string };
  hero: {
    hearts: number;
    maxHearts: number;
    hp?: number;
    maxHp?: number;
    mp?: number;
    maxMp?: number;
    level?: number;
    gold?: number;
    hasKey: boolean;
  };
  objectiveHint: string;
  stats: {
    starsCollected: number;
    starsTotal: number;
    entityCount: number;
    lightCount: number;
    bossHp: number;
    bossMaxHp: number;
    comboCount: number;
  };
  legalActions: RpgMenuOption[];
  turnDetails?: unknown;
  shmupDetails?: RenderSceneSnapshot['shmupHud'];
  chronicleDetails?: RenderSceneSnapshot['chronicleHud'];
}

/**
 * Serializes live game state from any built-in or plugin cartridge into a canonical,
 * LLM- and Behavior-Tree-friendly observation envelope without mutating simulation state.
 */
export function serializeCartridgeObservation(runner: CartridgeRunner): UnifiedGameObservation {
  const inst = runner.getInstance();
  const snap = runner.getSnapshot();

  if (isTurnCapableCartridge(inst)) {
    const kernel = inst.getKernel();
    const rpg = snap.rpgHud;
    const rawTurn = kernel.getObservation();
    return {
      cartridgeId: snap.cartridgeId,
      status: snap.status,
      mode: rpg?.mode ?? 'explore',
      score: snap.score,
      stage: snap.stage,
      hero: {
        hearts: snap.hearts,
        maxHearts: snap.maxHearts,
        hp: rpg?.hp,
        maxHp: rpg?.maxHp,
        mp: rpg?.mp,
        maxMp: rpg?.maxMp,
        level: rpg?.level,
        gold: rpg?.gold,
        hasKey: snap.hasKey || (rpg?.keys ?? 0) > 0,
      },
      objectiveHint: snap.statusBanner || rpg?.floorName || 'Explore dungeon',
      stats: {
        starsCollected: snap.starsCollected,
        starsTotal: snap.starsTotal,
        entityCount: snap.entities.length,
        lightCount: snap.lights.length,
        bossHp: snap.bossHp,
        bossMaxHp: snap.bossMaxHp,
        comboCount: snap.comboCount ?? 0,
      },
      legalActions: kernel.getLegalActions(),
      turnDetails: rawTurn,
    };
  }

  const ch = snap.chronicleHud;
  const sh = snap.shmupHud;
  const mode = ch?.uiMode ?? sh?.phase ?? snap.status;
  const objectiveHint = ch?.questObjective || snap.statusBanner || sh?.sectorName || snap.stage?.name || 'Active play';

  return {
    cartridgeId: snap.cartridgeId,
    status: snap.status,
    mode,
    score: snap.score,
    stage: snap.stage,
    hero: {
      hearts: ch ? ch.hero.hp : snap.hearts,
      maxHearts: ch ? ch.hero.maxHp : snap.maxHearts,
      hp: ch?.hero.hp,
      maxHp: ch?.hero.maxHp,
      mp: ch?.hero.mp,
      maxMp: ch?.hero.maxMp,
      level: ch?.hero.level,
      gold: ch?.hero.gold,
      hasKey: snap.hasKey,
    },
    objectiveHint,
    stats: {
      starsCollected: snap.starsCollected,
      starsTotal: snap.starsTotal,
      entityCount: snap.entities.length,
      lightCount: snap.lights.length,
      bossHp: ch?.boss?.hp ?? sh?.boss?.hp ?? snap.bossHp,
      bossMaxHp: ch?.boss?.maxHp ?? sh?.boss?.maxHp ?? snap.bossMaxHp,
      comboCount: snap.comboCount ?? 0,
    },
    legalActions: buildGenericLegalActions(snap),
    shmupDetails: sh,
    chronicleDetails: ch,
  };
}

function buildGenericLegalActions(snap: RenderSceneSnapshot): RpgMenuOption[] {
  if (snap.shmupHud) {
    if (snap.shmupHud.phase === 'hangar') {
      return [
        { id: 'select_fighter:starfalcon', label: 'Starfalcon', enabled: true },
        { id: 'select_fighter:coral_titan', label: 'Coral Titan', enabled: true },
        { id: 'select_fighter:violet_prism', label: 'Violet Prism', enabled: true },
        { id: 'launch_sortie', label: 'Launch Sortie', enabled: true },
      ];
    }
    return [
      { id: 'cycle_weapon', label: 'Cycle Weapon', enabled: true },
      { id: 'bomb', label: 'Starlight Bomb', enabled: snap.shmupHud.bombs > 0 },
    ];
  }
  if (snap.chronicleHud) {
    if (snap.chronicleHud.uiMode === 'CUTSCENE') {
      return [{ id: 'dialog_next', label: 'Advance Dialog', enabled: true }];
    }
    if (snap.chronicleHud.uiMode === 'PLAYING') {
      return [
        { id: 'cast_relic', label: 'Cast Relic Skill', enabled: snap.chronicleHud.hero.mp >= snap.chronicleHud.hero.relicMpCost },
        { id: 'toggle_pause', label: 'Pause Menu', enabled: true },
        { id: 'open_world_map', label: 'World Map', enabled: true },
      ];
    }
  }
  return [];
}
