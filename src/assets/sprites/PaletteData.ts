// Curated Cozy Toybox 16-Color Master Palette (0 = transparent)
export const TOYBOX_PALETTE: readonly string[] = [
  'transparent', // 0: Empty
  '#382820', // 1: Espresso outline
  '#fffaf0', // 2: Warm cream highlight
  '#ffd6ba', // 3: Peach skin / cream
  '#ff708d', // 4: Strawberry coral
  '#d93b60', // 5: Berry shade
  '#56d39c', // 6: Matcha mint
  '#239b69', // 7: Deep emerald
  '#ffd447', // 8: Honey butter yellow
  '#f59b23', // 9: Warm tangerine
  '#5ec2f7', // 10: Sky blueberry
  '#2a7cd4', // 11: Ocean azure
  '#e0aaff', // 12: Pastel lilac
  '#9e73d4', // 13: Plum soft
  '#c7d4e6', // 14: Cloud mist
  '#8c9ab5', // 15: Cool slate
];

export type BuiltinSpriteId =
  | 'solid'
  | 'hero_a'
  | 'hero_b'
  | 'slime_a'
  | 'slime_b'
  | 'cloud_l'
  | 'cloud_m'
  | 'cloud_r'
  | 'grass'
  | 'dirt'
  | 'star_a'
  | 'star_b'
  | 'key'
  | 'gate_closed'
  | 'gate_open'
  | 'heart_full'
  | 'heart_empty'
  | 'ship_a'
  | 'ship_b'
  | 'jelly_ufo'
  | 'meteor'
  | 'boss_ufo'
  | 'bolt'
  | 'sparkle'
  | 'momo_idle'
  | 'momo_happy'
  | 'momo_run_a'
  | 'momo_run_b'
  | 'momo_jump'
  | 'momo_slide'
  | 'momo_wave_a'
  | 'momo_wave_b'
  | 'crate'
  | 'spring'
  | 'bomb'
  | 'torch'
  | 'switch_off'
  | 'switch_on'
  | 'stone'
  | 'dungeon_floor'
  | 'door_closed'
  | 'door_open'
  | 'stairs_down'
  | 'chest_closed'
  | 'chest_open'
  | 'goblin'
  | 'skeleton'
  | 'dragon'
  | 'potion'
  | 'npc_sage'
  | 'trap'
  | 'campfire'
  | 'merchant'
  | 'shaman'
  | 'gargoyle'
  | 'portal'
  | 'flag_off'
  | 'flag_on'
  | 'relic_feather'
  | 'relic_dash'
  | 'coin'
  | 'moving_plat'
  | 'laser_beam'
  | 'option_orb'
  | 'sword_icon'
  | 'shield_icon'
  | 'slime_king'
  | 'ship_titan'
  | 'ship_prism'
  | 'enemy_interceptor'
  | 'enemy_frigate'
  | 'enemy_carrier'
  | 'missile_pod'
  | 'pickup_bomb'
  | 'boss_wing'
  | 'pickup_crystal'
  | 'shrine'
  | 'npc_elder'
  | 'slime_knight'
  | 'ember_warden'
  | 'frost_mage'
  | 'sword_slash'
  | 'tree_canopy'
  | 'anvil_forge'
  | 'astral_core'
  | 'relic_flame';

export type SpriteId = BuiltinSpriteId | (string & {});

// Default Hero Sprout Knight (16x16 palette-indexed grids, editable live in Sprite Atelier!)
export const DEFAULT_HERO_FRAME_A: string[] = [
  '......1111......',
  '....11666611....',
  '...1666226661...',
  '..166666666661..',
  '..166333333661..',
  '..163313313361..',
  '..163334433361..',
  '...1133333311...',
  '....14488441....',
  '...1444884441...',
  '...1664444661...',
  '....16444461....',
  '....11777711....',
  '....177..771....',
  '...111....111...',
  '................',
];

export const DEFAULT_HERO_FRAME_B: string[] = [
  '................',
  '......1111......',
  '....11666611....',
  '...1666226661...',
  '..166666666661..',
  '..166333333661..',
  '..163313313361..',
  '..163334433361..',
  '...1133333311...',
  '...1444884441...',
  '..166448844661..',
  '....16444461....',
  '....11777711....',
  '...177....771...',
  '..111......111..',
  '................',
];
