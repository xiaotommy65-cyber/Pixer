import { CHAPTER_SPECS_EARLY } from './ChronicleChaptersEarly.ts';
import { CHAPTER_SPECS_LATE } from './ChronicleChaptersLate.ts';
import { CHRONICLE_PAUSE_TABS, GEAR_CATALOG, INITIAL_UI_MODE, buildGearSummaries, getGearById } from './ChronicleGearData.ts';
import type {
  ActionEnemyKind,
  BossSpec,
  ChapterSpec,
  EnemySpawnSpec,
  GearCatalogEntry,
  GearSlot,
  WorldChest,
  WorldNpc,
  WorldSwitch,
  WorldWall,
} from './ChronicleTypes.ts';

export const CHAPTER_SPECS: readonly ChapterSpec[] = [...CHAPTER_SPECS_EARLY, ...CHAPTER_SPECS_LATE];

export {
  CHRONICLE_PAUSE_TABS,
  GEAR_CATALOG,
  INITIAL_UI_MODE,
  buildGearSummaries,
  getGearById,
};

export type {
  ActionEnemyKind,
  BossSpec,
  ChapterSpec,
  EnemySpawnSpec,
  GearCatalogEntry,
  GearSlot,
  WorldChest,
  WorldNpc,
  WorldSwitch,
  WorldWall,
};
