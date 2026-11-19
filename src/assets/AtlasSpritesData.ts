import { AUTO_TILE_SPRITE_GRIDS } from './sprites/AutoTileSprites.ts';
import { BOSS_SLIME_KING_32, BOSS_UFO_GRID_32 } from './sprites/BossSprites.ts';
import { CHRONICLE_SPRITE_GRIDS } from './sprites/ChronicleSprites.ts';
import { CORE_SPRITE_GRIDS } from './sprites/CoreSprites.ts';
import { DUNGEON_SPRITE_GRIDS } from './sprites/DungeonSprites.ts';
import { MOMO_SPRITE_GRIDS } from './sprites/MomoSprites.ts';
import {
  DEFAULT_HERO_FRAME_A,
  DEFAULT_HERO_FRAME_B,
  TOYBOX_PALETTE,
  type BuiltinSpriteId,
  type SpriteId,
} from './sprites/PaletteData.ts';
import { PARKOUR_SPRITE_GRIDS } from './sprites/ParkourSprites.ts';
import { SHMUP_SPRITE_GRIDS } from './sprites/ShmupSprites.ts';

export {
  BOSS_SLIME_KING_32,
  BOSS_UFO_GRID_32,
  DEFAULT_HERO_FRAME_A,
  DEFAULT_HERO_FRAME_B,
  TOYBOX_PALETTE,
};
export type { BuiltinSpriteId, SpriteId };

export const BUILTIN_SPRITE_GRIDS: Partial<Record<SpriteId, string[]>> = {
  ...CORE_SPRITE_GRIDS,
  ...MOMO_SPRITE_GRIDS,
  ...SHMUP_SPRITE_GRIDS,
  ...DUNGEON_SPRITE_GRIDS,
  ...CHRONICLE_SPRITE_GRIDS,
  ...PARKOUR_SPRITE_GRIDS,
  ...AUTO_TILE_SPRITE_GRIDS,
};
