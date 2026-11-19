import {
  buildHueShiftedRamp,
  hexToRgb01Into,
  linearRgbToOklab,
  linearToSrgb,
  oklabToLinearRgbGamut,
  oklabToOklch,
  oklchToOklab,
  rgb01ToHex,
  srgbToLinear,
} from '../../core/math/ColorMath.ts';

// Curated Cozy Toybox 16-Color Master Palette (0 = transparent, 1..13 = standard, 14..15 = emissive candidates)
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
  '#c7d4e6', // 14: Cloud mist (emissive in themed rows)
  '#8c9ab5', // 15: Cool slate (emissive in themed rows)
];

export interface PaletteThemeSpec {
  id: string;
  label: string;
  colors: readonly string[];
  /** Emissive intensity (0..1) on indices 14 and 15 in LUT alpha channel */
  emissive14: number;
  emissive15: number;
}

export const PALETTE_THEMES: readonly PaletteThemeSpec[] = [
  { id: 'classic', label: '草莓玩具箱', colors: TOYBOX_PALETTE, emissive14: 0, emissive15: 0 },
  {
    id: 'strawberry_dusk',
    label: '草莓暮光',
    colors: [
      'transparent', '#2e1d2b', '#fff5eb', '#ffd0b8', '#ff6b97', '#c92a5b',
      '#72ddb0', '#2b9370', '#ffe066', '#f28444', '#70c8ff', '#3168c4',
      '#ecb8ff', '#9c5fc7', '#fff3b0', '#ff85b3',
    ],
    emissive14: 0.9,
    emissive15: 0.75,
  },
  {
    id: 'starlight_neon',
    label: '星光霓虹',
    colors: [
      'transparent', '#1a1630', '#f7faff', '#ffd1c7', '#ff4d8d', '#b8255f',
      '#4df2b2', '#179b73', '#ffe66d', '#ff9233', '#5ce1e6', '#2667ff',
      '#d499ff', '#7d4cdb', '#fff799', '#5ce1e6',
    ],
    emissive14: 1.0,
    emissive15: 0.9,
  },
  {
    id: 'emberkeep_torch',
    label: '餘燼火炬',
    colors: [
      'transparent', '#241718', '#fff4e0', '#f2c19c', '#e85d5d', '#9e2b36',
      '#68b684', '#2d6e53', '#ffd166', '#ef7b35', '#76a5d9', '#39558c',
      '#d4a1e6', '#7e4e94', '#ffd166', '#ff7b54',
    ],
    emissive14: 0.95,
    emissive15: 0.85,
  },
  {
    id: 'astral_twilight',
    label: '星穹暮色',
    colors: [
      'transparent', '#18182e', '#f4f7ff', '#e8c4c4', '#ff7597', '#b53a6b',
      '#5eead4', '#1d8a85', '#ffd447', '#f08c42', '#70b7ff', '#2c59b8',
      '#d8b4fe', '#7c4dcc', '#ffd447', '#72efdd',
    ],
    emissive14: 1.0,
    emissive15: 0.9,
  },
  {
    id: 'mint_handheld',
    label: '薄荷掌機',
    colors: [
      'transparent', '#1b2e26', '#f2fff5', '#c8f0d8', '#7ae582', '#3ca370',
      '#56d39c', '#267355', '#e9ffdb', '#a7d97e', '#6cd4c6', '#2e8a80',
      '#b5e8d5', '#529c83', '#e9ffdb', '#7ae582',
    ],
    emissive14: 0.85,
    emissive15: 0.7,
  },
  {
    id: 'frost_crystal',
    label: '霜晶極光',
    colors: [
      'transparent', '#1d243b', '#f5fbff', '#dbeafe', '#ff85b3', '#b84b82',
      '#64dfdf', '#2b8a99', '#ffe8a3', '#f4a261', '#72efdd', '#3a86ff',
      '#e0aaff', '#8338ec', '#e0fbfc', '#c77dff',
    ],
    emissive14: 0.95,
    emissive15: 0.85,
  },
  {
    id: 'sunset_amber',
    label: '琥珀晚霞',
    colors: [
      'transparent', '#36201f', '#fff8eb', '#ffd5b3', '#ff6b78', '#c4314b',
      '#78d6a3', '#2e8c67', '#ffe066', '#ff8833', '#75b8ff', '#3566b8',
      '#f2b5d4', '#a15a8a', '#fff1a8', '#ff8fab',
    ],
    emissive14: 0.95,
    emissive15: 0.8,
  },
];

export const PALETTE_THEME_COUNT = PALETTE_THEMES.length;

/** Builds a 16 x N RGBA8 Palette LUT texture (alpha byte encodes emissive weight 0..255). */
export function buildPaletteLutRgba(): Uint8Array {
  const lut = new Uint8Array(16 * PALETTE_THEME_COUNT * 4);
  for (let row = 0; row < PALETTE_THEME_COUNT; row++) {
    const theme = PALETTE_THEMES[row];
    for (let col = 0; col < 16; col++) {
      const dst = (row * 16 + col) * 4;
      if (col === 0) {
        lut[dst] = 0;
        lut[dst + 1] = 0;
        lut[dst + 2] = 0;
        lut[dst + 3] = 0;
        continue;
      }
      const hex = theme.colors[col] ?? TOYBOX_PALETTE[col] ?? '#ffffff';
      const n = parseInt(hex.slice(1), 16);
      lut[dst] = (n >> 16) & 255;
      lut[dst + 1] = (n >> 8) & 255;
      lut[dst + 2] = n & 255;
      const em = col === 14 ? theme.emissive14 : col === 15 ? theme.emissive15 : 0;
      lut[dst + 3] = Math.round(Math.max(0, Math.min(1, em)) * 255);
    }
  }
  return lut;
}

const PAL_TMP_VEC = new Float32Array(3);
const PAL_RAMP_RGBA = new Uint8Array(16);

function oklabToneHex(L: number, C: number, hRad: number): string {
  oklchToOklab(L, C, hRad, PAL_TMP_VEC, 0);
  oklabToLinearRgbGamut(PAL_TMP_VEC[0], PAL_TMP_VEC[1], PAL_TMP_VEC[2], PAL_TMP_VEC, 0);
  return rgb01ToHex(
    linearToSrgb(PAL_TMP_VEC[0]),
    linearToSrgb(PAL_TMP_VEC[1]),
    linearToSrgb(PAL_TMP_VEC[2]),
  );
}

/**
 * Generates a harmonious 16-color Toybox palette from a single accent seed hex color
 * using Oklab + Hue-Shifted ramps (slots 1..15 keep outline, highlights, and complements balanced).
 */
export function deriveHarmonizedPalette(
  seedHex: string,
  id = 'harmonized',
  label = '感知調和色盤',
): PaletteThemeSpec {
  hexToRgb01Into(seedHex, PAL_TMP_VEC, 0);
  linearRgbToOklab(
    srgbToLinear(PAL_TMP_VEC[0]),
    srgbToLinear(PAL_TMP_VEC[1]),
    srgbToLinear(PAL_TMP_VEC[2]),
    PAL_TMP_VEC,
    0,
  );
  oklabToOklch(PAL_TMP_VEC[0], PAL_TMP_VEC[1], PAL_TMP_VEC[2], PAL_TMP_VEC, 0);
  const seedC = Math.max(0.08, Math.min(0.24, PAL_TMP_VEC[1]));
  const seedH = PAL_TMP_VEC[2];

  buildHueShiftedRamp(seedHex, 4, PAL_RAMP_RGBA);
  const rampHex = (idx: number) =>
    rgb01ToHex(PAL_RAMP_RGBA[idx * 4] / 255, PAL_RAMP_RGBA[idx * 4 + 1] / 255, PAL_RAMP_RGBA[idx * 4 + 2] / 255);

  const mintHex = oklabToneHex(0.74, seedC * 0.85, seedH + 2.25);
  const mintShadeHex = oklabToneHex(0.56, seedC * 0.9, seedH + 2.45);
  const goldHex = oklabToneHex(0.86, Math.max(0.11, seedC * 0.9), seedH + 1.05);
  const amberHex = oklabToneHex(0.72, Math.max(0.12, seedC), seedH + 0.85);
  const skyHex = oklabToneHex(0.76, seedC * 0.88, seedH - 2.25);
  const oceanHex = oklabToneHex(0.56, seedC * 0.92, seedH - 2.05);
  const lilacHex = oklabToneHex(0.8, seedC * 0.72, seedH - 0.95);
  const plumHex = oklabToneHex(0.58, seedC * 0.82, seedH - 0.75);

  return {
    id,
    label,
    colors: [
      'transparent',
      oklabToneHex(0.24, 0.045, seedH - 0.8), // 1: Deep cool-ink outline
      oklabToneHex(0.97, 0.02, 1.55), // 2: Warm paper cream highlight
      rampHex(3), // 3: Hue-shifted highlight
      rampHex(2), // 4: Primary seed tone
      rampHex(0), // 5: Hue-shifted deep shade
      mintHex, // 6: Cool triad highlight
      mintShadeHex, // 7: Cool triad shade
      goldHex, // 8: Warm analogous highlight
      amberHex, // 9: Warm analogous shade
      skyHex, // 10: Opposite cool sky highlight
      oceanHex, // 11: Opposite deep shade
      lilacHex, // 12: Pastel accent highlight
      plumHex, // 13: Pastel accent shade
      oklabToneHex(0.92, Math.max(0.1, seedC * 0.85), seedH + 0.65), // 14: Emissive core
      oklabToneHex(0.78, Math.max(0.12, seedC), seedH), // 15: Emissive halo
    ],
    emissive14: 0.95,
    emissive15: 0.85,
  };
}

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
  | 'relic_flame'
  | 'meadow_floor'
  | 'parkour_hero_idle'
  | 'parkour_hero_run_a'
  | 'parkour_hero_run_b'
  | 'parkour_hero_jump'
  | 'parkour_hero_wall'
  | 'parkour_hero_dash'
  | 'grapple_claw'
  | 'grapple_ring'
  | 'grapple_link'
  | 'grapple_reticle'
  | 'scarf_node'
  | 'crystal_reset'
  | 'crumble_tile'
  | 'zip_block'
  | 'ik_joint'
  | 'ik_claw'
  | 'cliff_m0'
  | 'cliff_m1'
  | 'cliff_m2'
  | 'cliff_m3'
  | 'cliff_m4'
  | 'cliff_m5'
  | 'cliff_m6'
  | 'cliff_m7'
  | 'cliff_m8'
  | 'cliff_m9'
  | 'cliff_m10'
  | 'cliff_m11'
  | 'cliff_m12'
  | 'cliff_m13'
  | 'cliff_m14'
  | 'cliff_m15'
  | 'grass_m0'
  | 'grass_m1'
  | 'grass_m2'
  | 'grass_m3'
  | 'grass_m4'
  | 'grass_m5'
  | 'grass_m6'
  | 'grass_m7'
  | 'grass_m8'
  | 'grass_m9'
  | 'grass_m10'
  | 'grass_m11'
  | 'grass_m12'
  | 'grass_m13'
  | 'grass_m14'
  | 'grass_m15'
  | 'vine_hang'
  | 'pebble_decal'
  | 'parallax_twilight_bg';

export type SpriteId = BuiltinSpriteId | (string & {});

// Default Hero Sprout Knight (16x16 palette-indexed grids, editable live in Sprite Atelier!)
export const DEFAULT_HERO_FRAME_A: string[] = [
  '......1661......',
  '.....162671.....',
  '....11177111....',
  '...1662226671...',
  '..166666666771..',
  '..163333333371..',
  '..173133331371..',
  '..173132231371..',
  '..114333333411..',
  '...1144884411...',
  '..161448944161..',
  '..111544445111..',
  '....11777711....',
  '....19911991....',
  '...1111..1111...',
  '................',
];

export const DEFAULT_HERO_FRAME_B: string[] = [
  '.......1661.....',
  '......162671....',
  '....11177111....',
  '...1662226671...',
  '..166666666771..',
  '..163333333371..',
  '..173133331371..',
  '..173132231371..',
  '..114333333411..',
  '..161448844161..',
  '.161.148941.161.',
  '.....154451.....',
  '...1177117711...',
  '..1991....1991..',
  '..111......111..',
  '................',
];
