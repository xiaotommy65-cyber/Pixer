import type { SpriteId } from '../assets/TextureAtlas.ts';
import { hexToRgb01Into, mixOklabRgb01, rgb01ToHex } from '../core/math/ColorMath.ts';
import { fbm2D, simplex2D } from '../core/math/NoiseMath.ts';
import type { CartridgeId } from '../core/types/WorldTypes.ts';

export type DioramaTimeMode = 'auto' | 'dawn' | 'noon' | 'dusk' | 'night';
export type DioramaPerspective = 'focus' | 'window';

export const DIORAMA_CANVAS_W = 480;
export const DIORAMA_CANVAS_H = 270;

export interface DioramaTimeKeyframe {
  hour: number;
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  wallTop: string;
  wallBot: string;
  fujiBody: string;
  fujiSnow: string;
  farHill: string;
  midHill: string;
  nearGrass: string;
  waterTop: string;
  waterBot: string;
  sakuraLight: string;
  sakuraMid: string;
  sakuraShade: string;
  starAlpha: number;
  fireIntensity: number;
  warmTint: string;
}

export interface DioramaCameoVisitor {
  cartridgeId: CartridgeId;
  label: string;
  spriteA: SpriteId;
  spriteB?: SpriteId;
  kind: 'walker' | 'flyer';
  x: number;
  baseY: number;
  vx: number;
  phase: number;
}

export const DIORAMA_KEYFRAMES: readonly DioramaTimeKeyframe[] = [
  {
    hour: 0,
    skyTop: '#080e24',
    skyMid: '#132147',
    skyBottom: '#233666',
    wallTop: '#16192b',
    wallBot: '#101220',
    fujiBody: '#16254a',
    fujiSnow: '#8fa8d6',
    farHill: '#142242',
    midHill: '#101d34',
    nearGrass: '#0f2128',
    waterTop: '#162952',
    waterBot: '#0d1832',
    sakuraLight: '#9e7da8',
    sakuraMid: '#6e527d',
    sakuraShade: '#3d2c4d',
    starAlpha: 0.96,
    fireIntensity: 1.0,
    warmTint: '#ff9a52',
  },
  {
    hour: 5.5,
    skyTop: '#2c4170',
    skyMid: '#946b88',
    skyBottom: '#f7ba9e',
    wallTop: '#33293a',
    wallBot: '#241d2b',
    fujiBody: '#4d4f7a',
    fujiSnow: '#ffe3d8',
    farHill: '#57587e',
    midHill: '#3d4c60',
    nearGrass: '#284644',
    waterTop: '#a87c94',
    waterBot: '#3e4c70',
    sakuraLight: '#ffd8e4',
    sakuraMid: '#f29cb8',
    sakuraShade: '#a65878',
    starAlpha: 0.28,
    fireIntensity: 0.52,
    warmTint: '#ffd2a6',
  },
  {
    hour: 12.0,
    skyTop: '#2678dc',
    skyMid: '#66b6ff',
    skyBottom: '#dcf3ff',
    wallTop: '#3d2d24',
    wallBot: '#2b1f19',
    fujiBody: '#5582ba',
    fujiSnow: '#ffffff',
    farHill: '#6a9ec9',
    midHill: '#46876c',
    nearGrass: '#327552',
    waterTop: '#68b8f8',
    waterBot: '#2e74b8',
    sakuraLight: '#fff0f5',
    sakuraMid: '#ffb3c9',
    sakuraShade: '#d96b90',
    starAlpha: 0,
    fireIntensity: 0,
    warmTint: '#fff5dc',
  },
  {
    hour: 17.5,
    skyTop: '#241b4b',
    skyMid: '#963b68',
    skyBottom: '#ff9054',
    wallTop: '#2c1e2e',
    wallBot: '#1e1522',
    fujiBody: '#462a59',
    fujiSnow: '#ffc4a3',
    farHill: '#583464',
    midHill: '#39274a',
    nearGrass: '#242a36',
    waterTop: '#b85268',
    waterBot: '#3b244c',
    sakuraLight: '#ffc2d1',
    sakuraMid: '#d97294',
    sakuraShade: '#7a3858',
    starAlpha: 0.38,
    fireIntensity: 0.88,
    warmTint: '#ffb173',
  },
  {
    hour: 21.0,
    skyTop: '#0a112b',
    skyMid: '#172752',
    skyBottom: '#29406e',
    wallTop: '#181b2e',
    wallBot: '#111322',
    fujiBody: '#1b2c57',
    fujiSnow: '#9ab4e0',
    farHill: '#18284c',
    midHill: '#13223b',
    nearGrass: '#11242b',
    waterTop: '#1c315e',
    waterBot: '#0f1b38',
    sakuraLight: '#a685b0',
    sakuraMid: '#745684',
    sakuraShade: '#412f52',
    starAlpha: 0.92,
    fireIntensity: 1.0,
    warmTint: '#ff9a52',
  },
  {
    hour: 24.0,
    skyTop: '#080e24',
    skyMid: '#132147',
    skyBottom: '#233666',
    wallTop: '#16192b',
    wallBot: '#101220',
    fujiBody: '#16254a',
    fujiSnow: '#8fa8d6',
    farHill: '#142242',
    midHill: '#101d34',
    nearGrass: '#0f2128',
    waterTop: '#162952',
    waterBot: '#0d1832',
    sakuraLight: '#9e7da8',
    sakuraMid: '#6e527d',
    sakuraShade: '#3d2c4d',
    starAlpha: 0.96,
    fireIntensity: 1.0,
    warmTint: '#ff9a52',
  },
];

export const DIORAMA_BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
] as const;

const RGB_A = new Float32Array(3);
const RGB_B = new Float32Array(3);
const RGB_OUT = new Float32Array(3);

export function mixDioramaHex(a: string, b: string, t: number): string {
  hexToRgb01Into(a, RGB_A, 0);
  hexToRgb01Into(b, RGB_B, 0);
  mixOklabRgb01(RGB_A[0], RGB_A[1], RGB_A[2], RGB_B[0], RGB_B[1], RGB_B[2], t, RGB_OUT, 0);
  return rgb01ToHex(RGB_OUT[0], RGB_OUT[1], RGB_OUT[2]);
}

export function sampleDioramaPaletteAtHour(h: number): DioramaTimeKeyframe {
  const hour = ((h % 24) + 24) % 24;
  let a = DIORAMA_KEYFRAMES[0];
  let b = DIORAMA_KEYFRAMES[1];
  for (let i = 0; i < DIORAMA_KEYFRAMES.length - 1; i++) {
    if (hour >= DIORAMA_KEYFRAMES[i].hour && hour <= DIORAMA_KEYFRAMES[i + 1].hour) {
      a = DIORAMA_KEYFRAMES[i];
      b = DIORAMA_KEYFRAMES[i + 1];
      break;
    }
  }
  const span = Math.max(0.001, b.hour - a.hour);
  const t = Math.max(0, Math.min(1, (hour - a.hour) / span));
  return {
    hour,
    skyTop: mixDioramaHex(a.skyTop, b.skyTop, t),
    skyMid: mixDioramaHex(a.skyMid, b.skyMid, t),
    skyBottom: mixDioramaHex(a.skyBottom, b.skyBottom, t),
    wallTop: mixDioramaHex(a.wallTop, b.wallTop, t),
    wallBot: mixDioramaHex(a.wallBot, b.wallBot, t),
    fujiBody: mixDioramaHex(a.fujiBody, b.fujiBody, t),
    fujiSnow: mixDioramaHex(a.fujiSnow, b.fujiSnow, t),
    farHill: mixDioramaHex(a.farHill, b.farHill, t),
    midHill: mixDioramaHex(a.midHill, b.midHill, t),
    nearGrass: mixDioramaHex(a.nearGrass, b.nearGrass, t),
    waterTop: mixDioramaHex(a.waterTop, b.waterTop, t),
    waterBot: mixDioramaHex(a.waterBot, b.waterBot, t),
    sakuraLight: mixDioramaHex(a.sakuraLight, b.sakuraLight, t),
    sakuraMid: mixDioramaHex(a.sakuraMid, b.sakuraMid, t),
    sakuraShade: mixDioramaHex(a.sakuraShade, b.sakuraShade, t),
    starAlpha: a.starAlpha + (b.starAlpha - a.starAlpha) * t,
    fireIntensity: a.fireIntensity + (b.fireIntensity - a.fireIntensity) * t,
    warmTint: mixDioramaHex(a.warmTint, b.warmTint, t),
  };
}

export function precomputeDioramaTerrain(
  farHeights: Int16Array,
  midHeights: Int16Array,
  groundHeights: Int16Array,
): void {
  for (let x = 0; x < DIORAMA_CANVAS_W; x++) {
    // Mt. Fuji centered on upper-left Golden Third (x = 160, peak y = 32 -> base y = 84)
    const dxFuji = Math.abs(x - 160);
    const fujiSlope = dxFuji <= 11 ? 32 : Math.min(84, 32 + Math.pow((dxFuji - 11) / 66, 1.36) * 52);
    const farN = fbm2D(x * 0.014, 1.3, 3, 2.0, 0.5, 404);
    const ridgeY = Math.round(74 + farN * 9);
    farHeights[x] = Math.min(Math.round(fujiSlope), ridgeY);

    const midN = fbm2D(x * 0.022, 4.7, 3, 2.0, 0.5, 808);
    // Open scenic lake bay across x = 76..254 for Mt. Fuji & celestial reflections
    const lakeDip = x >= 76 && x <= 254 ? Math.sin(((x - 76) / 178) * Math.PI) * 13 : 0;
    midHeights[x] = Math.round(78 + midN * 7 + lakeDip);

    const gN = simplex2D(x * 0.025, 8.2, 102);
    const campFlat = x >= 270 && x <= 380 ? 0.15 : 0.85;
    groundHeights[x] = Math.round(105 + gN * 2 * campFlat);
  }
}

export function getCartridgeCameoSpec(id: string): {
  spriteA: SpriteId;
  spriteB?: SpriteId;
  kind: 'walker' | 'flyer';
  label: string;
} {
  if (id === 'cloudberry-hop') return { spriteA: 'hero_a', spriteB: 'hero_b', kind: 'walker', label: '草莓冒險者' };
  if (id === 'sugar-starlight') return { spriteA: 'ship_a', spriteB: 'ship_b', kind: 'flyer', label: '糖霜戰機' };
  if (id === 'obsidian-citadel') return { spriteA: 'slime_knight', spriteB: 'ember_warden', kind: 'walker', label: '黑曜勇者' };
  if (id === 'emerald-ruins') return { spriteA: 'slime_a', spriteB: 'slime_b', kind: 'walker', label: '翠律旅者' };
  if (id === 'rhythm-bastion') return { spriteA: 'star_a', spriteB: 'star_b', kind: 'flyer', label: '律動星靈' };
  if (id === 'astral-rift') return { spriteA: 'star_b', spriteB: 'star_a', kind: 'flyer', label: '星穹裂隙使' };
  return { spriteA: 'star_a', spriteB: 'hero_a', kind: 'walker', label: '自製卡匣訪客' };
}
