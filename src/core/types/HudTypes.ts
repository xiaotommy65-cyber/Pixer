import type { SpriteId } from '../../assets/TextureAtlas.ts';

export interface StageProgressInfo {
  index: number; // 1-based stage/floor index
  total: number;
  name: string;
}

export interface RpgMenuOption {
  id: string;
  label: string;
  enabled: boolean;
}

export interface RpgHudSnapshot {
  mode: 'explore' | 'combat' | 'dialog' | 'won' | 'lost';
  floorName: string;
  turnCount: number;
  heroName: string;
  level: number;
  xp: number;
  nextXp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  ac: number;
  potions: number;
  keys: number;
  gold: number;
  weaponName?: string;
  armorName?: string;
  relicName?: string;
  statuses?: string[];
  agentAuto: boolean;
  combat?: {
    enemyName: string;
    enemyHp: number;
    enemyMaxHp: number;
    enemyAc: number;
    round: number;
    turnOwner: 'player' | 'enemy';
  };
  dialog?: {
    speaker: string;
    text: string;
    choices: RpgMenuOption[];
    selectedIdx: number;
  };
  actions: RpgMenuOption[];
  selectedActionIdx: number;
  combatLog: string[];
}

export interface ShmupFighterSummary {
  id: 'starfalcon' | 'coral_titan' | 'violet_prism';
  name: string;
  code: string;
  tagline: string;
  speedStat: number; // 1..5
  armorStat: number; // 1..5
  fireStat: number; // 1..5
  ultLabel: string;
  accentHex: string;
}

export interface ShmupHudSnapshot {
  phase: 'hangar' | 'sortie' | 'won' | 'lost';
  selectedFighterId: 'starfalcon' | 'coral_titan' | 'violet_prism';
  fighters: readonly ShmupFighterSummary[];
  weaponKind: 'crimson' | 'azure' | 'violet';
  weaponLevel: 1 | 2 | 3;
  bombs: number;
  maxBombs: number;
  grazeMeter: number; // 0..100
  grazeCount: number;
  overdriveTimer: number;
  funnelCount: number;
  hearts: number;
  maxHearts: number;
  chargeTier: 0 | 1 | 2;
  chargeRatio: number;
  sectorName: string;
  waveIndex: number;
  waveTotal: number;
  boss?: {
    name: string;
    hp: number;
    maxHp: number;
    phase: 1 | 2;
    activeWeakPoints: number;
  };
}

export type ChronicleUiMode =
  | 'TITLE_MENU'
  | 'WORLD_MAP'
  | 'PLAYING'
  | 'CUTSCENE'
  | 'PAUSED'
  | 'CHAPTER_CLEAR'
  | 'GAME_OVER'
  | 'ENDING';

export type ChroniclePauseTab = 'status' | 'bag' | 'quests' | 'guide';

export interface ChronicleGearSummary {
  id: string;
  slot: 'weapon' | 'armor' | 'relic';
  name: string;
  desc: string;
  statText: string;
  owned: boolean;
  equipped: boolean;
  costGold: number;
}

export interface ChronicleChapterSummary {
  index: number;
  id: string;
  title: string;
  subtitle: string;
  levelReq: number;
  unlocked: boolean;
  cleared: boolean;
  chestsFound: number;
  chestsTotal: number;
  bossDefeated: boolean;
  accentHex: string;
}

export interface ChronicleCutsceneView {
  speaker: string;
  speakerRole: string;
  portraitSprite: SpriteId;
  text: string;
  bossTitleCard?: { title: string; subtitle: string };
  choices?: { id: string; label: string; enabled: boolean }[];
  selectedChoiceIdx: number;
  awaitingInput: boolean;
}

export interface ChronicleHudSnapshot {
  uiMode: ChronicleUiMode;
  hasSavedRun: boolean;
  chapterIndex: number;
  chapterTotal: number;
  chapterTitle: string;
  areaTitle: string;
  hero: {
    name: string;
    level: number;
    xp: number;
    nextXp: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    stamina: number;
    maxStamina: number;
    gold: number;
    atk: number;
    def: number;
    potions: number;
    kills: number;
    chestsFound: number;
    chestsTotal: number;
    equippedWeaponName: string;
    equippedArmorName: string;
    equippedRelicName: string;
    relicMpCost: number;
  };
  questObjective: string;
  interactPrompt: string | null;
  tutorialHint: string | null;
  pauseTab: ChroniclePauseTab;
  titleCursorIdx: number;
  mapCursorIdx: number;
  bagCursorIdx?: number;
  gear: ChronicleGearSummary[];
  chapters: ChronicleChapterSummary[];
  cutscene?: ChronicleCutsceneView;
  boss?: {
    name: string;
    subtitle: string;
    hp: number;
    maxHp: number;
    phase: 1 | 2;
  };
  camera: {
    zoom: number;
    letterbox: number;
    mode: 'follow' | 'pan' | 'lock';
  };
}
