import type { EcsCustomSpriteDef, EcsProjectV2 } from '../ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand } from '../ecs/EcsStudioSession.ts';
import type { EcsMapLayerName } from '../ecs/EcsTilemapTypes.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import { pickNextCustomTileId, sanitizeInteropId } from './InteropTypes.ts';
import type {
  PixelForgeColorMode,
  PixelForgeDownscaleMode,
  PixelForgePaletteId,
} from './PixelForgeQuantizer.ts';

export type PixelForgeBakingProfileId =
  | 'custom'
  | 'wall_top_side'
  | 'billboard_actor'
  | 'emissive_light_prop'
  | 'portrait_160x192';

export interface PixelForgeBakingProfileDef {
  readonly id: PixelForgeBakingProfileId;
  readonly label: string;
  readonly description: string;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly downscaleMode: PixelForgeDownscaleMode;
  readonly colorMode: PixelForgeColorMode;
  readonly maxColors: number;
  readonly stripBackground: boolean;
  readonly cropOpaque: boolean;
  readonly outlineHex: string | null;
  readonly dither: boolean;
  readonly registerPrefab: boolean;
  readonly registerTileLayer?: EcsMapLayerName;
  readonly tileSolid?: boolean;
  readonly tileExtrudeH?: number;
  readonly attachLight?: boolean;
  readonly prefabCategory?: string;
}

export const PIXEL_FORGE_BAKING_PROFILES: readonly PixelForgeBakingProfileDef[] = [
  {
    id: 'wall_top_side',
    label: '3D 牆體頂側組 (Wall Top + Side · 32×32)',
    description: '自動生成 HD-2D 牆頂與牆側雙貼圖，並註冊為可繪製的阻擋牆瓦片。',
    targetWidth: 32,
    targetHeight: 32,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: false,
    cropOpaque: false,
    outlineHex: null,
    dither: true,
    registerPrefab: false,
    registerTileLayer: 'wall',
    tileSolid: true,
    tileExtrudeH: 28,
  },
  {
    id: 'billboard_actor',
    label: '3D Billboard 角色 / 怪物 (48×64)',
    description: '去背、緊密裁切、1px 輪廓描邊，註冊為直立 3D Billboard 角色印章。',
    targetWidth: 48,
    targetHeight: 64,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: '#090b12',
    dither: true,
    registerPrefab: true,
    prefabCategory: 'actor',
  },
  {
    id: 'emissive_light_prop',
    label: '高亮自發光掛點光源道具 (32×32 + Light)',
    description: '自動偵測高光像素主色並為 Prefab 掛載動態 LightSource 與自發光 Bloom。',
    targetWidth: 32,
    targetHeight: 32,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: '#090b12',
    dither: true,
    registerPrefab: true,
    attachLight: true,
    prefabCategory: 'light_prop',
  },
  {
    id: 'portrait_160x192',
    label: '160×192 半身立繪 (Visual Novel Portrait)',
    description: '高精細 Oklab 64 色立繪烘焙，直接註冊為 Pass 1B 過場與對話立繪資產。',
    targetWidth: 160,
    targetHeight: 192,
    downscaleMode: 'grid_majority',
    colorMode: 'adaptive_kmeans',
    maxColors: 64,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: null,
    dither: true,
    registerPrefab: false,
  },
  {
    id: 'custom',
    label: '自訂洗圖參數 (Custom)',
    description: '自由搭配尺寸、調色盤、切幀與註冊目標。',
    targetWidth: 32,
    targetHeight: 32,
    downscaleMode: 'grid_majority',
    colorMode: 'palette_lock',
    maxColors: 32,
    stripBackground: true,
    cropOpaque: true,
    outlineHex: null,
    dither: true,
    registerPrefab: true,
  },
];

export interface PixelForgeDetectedLight {
  color: string;
  radius: number;
  intensity: number;
  emissive: number;
  brightRatio: number;
}

export interface PixelForgeOptions {
  id: string;
  name?: string;
  bakingProfile?: PixelForgeBakingProfileId;
  targetWidth: number;
  targetHeight: number;
  downscaleMode?: PixelForgeDownscaleMode;
  colorMode?: PixelForgeColorMode;
  maxColors?: number;
  paletteId?: PixelForgePaletteId;
  customPalette?: readonly string[];
  stripBackground?: boolean;
  bgTolerance?: number;
  cropOpaque?: boolean;
  outlineHex?: string | null;
  dither?: boolean;
  preserveAspect?: boolean;
  sheetCols?: number;
  sheetRows?: number;
}

export interface PixelForgePreviewFrame {
  id: string;
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface PixelForgeOutput {
  sprites: EcsCustomSpriteDef[];
  animations: AnimationStateMachineDef[];
  detectedBlockSize: number;
  previewFrames: PixelForgePreviewFrame[];
  bakingProfile?: PixelForgeBakingProfileId;
  wallSideSpriteId?: string;
  detectedLight?: PixelForgeDetectedLight;
}

export interface PixelForgeCommitOptions {
  registerTileLayer?: EcsMapLayerName;
  tileSolid?: boolean;
  tileExtrudeH?: number;
  sideSprite?: string;
  roughness?: number;
  metallic?: number;
  emissive?: number;
  registerPrefab?: boolean;
  prefabSolid?: boolean;
  prefabCategory?: string;
  prefabTag?: string;
  attachLight?: boolean;
}

function rgbToHex2(r: number, g: number, b: number): string {
  const cr = Math.max(0, Math.min(255, Math.round(r)));
  const cg = Math.max(0, Math.min(255, Math.round(g)));
  const cb = Math.max(0, Math.min(255, Math.round(b)));
  return `#${((1 << 24) | (cr << 16) | (cg << 8) | cb).toString(16).slice(1)}`;
}

/**
 * Analyzes an RGBA sprite for glowing/bright pixels (lantern flames, crystals, runes)
 * and synthesizes a matching dynamic point light & emissive bloom profile.
 */
export function detectEmissiveLightFromRgba(
  rgba: Uint8Array,
  w: number,
  h: number,
): PixelForgeDetectedLight {
  const total = Math.max(1, Math.floor(w) * Math.floor(h));
  let opaqueCount = 0;
  let brightCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumW = 0;

  for (let i = 0; i < total; i++) {
    const off = i * 4;
    if ((rgba[off + 3] ?? 0) < 128) continue;
    opaqueCount++;
    const r = rgba[off];
    const g = rgba[off + 1];
    const b = rgba[off + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

    if (luma >= 0.64 || (luma >= 0.48 && sat >= 0.52)) {
      brightCount++;
      // Weight colorful bright pixels slightly stronger than pure white highlights
      const weight = 0.6 + sat * 1.4;
      sumR += r * weight;
      sumG += g * weight;
      sumB += b * weight;
      sumW += weight;
    }
  }

  const brightRatio = opaqueCount > 0 ? brightCount / opaqueCount : 0;
  const color = sumW > 0 ? rgbToHex2(sumR / sumW, sumG / sumW, sumB / sumW) : '#f59e0b';
  const clampedRatio = Math.max(0, Math.min(1, brightRatio));
  const radius = Math.round(88 + clampedRatio * 68);
  const intensity = Number((0.68 + Math.min(0.45, clampedRatio * 1.1)).toFixed(2));
  const emissive = Number((0.55 + Math.min(0.75, clampedRatio * 1.6)).toFixed(2));

  return { color, radius, intensity, emissive, brightRatio: Number(brightRatio.toFixed(3)) };
}

/**
 * Derives a subtle beveled top-cap tile from a vertical wall facade texture when
 * baking a single image under `'wall_top_side'` mode.
 */
export function synthesizeWallTopCapRgba(sideRgba: Uint8Array, w: number, h: number): Uint8Array {
  const safeW = Math.max(1, Math.floor(w));
  const safeH = Math.max(1, Math.floor(h));
  const out = new Uint8Array(safeW * safeH * 4);
  for (let y = 0; y < safeH; y++) {
    for (let x = 0; x < safeW; x++) {
      const off = (y * safeW + x) * 4;
      const a = sideRgba[off + 3] ?? 0;
      if (a < 128) {
        out[off] = 24;
        out[off + 1] = 26;
        out[off + 2] = 38;
        out[off + 3] = 255;
        continue;
      }
      const isEdge = x === 0 || y === 0 || x === safeW - 1 || y === safeH - 1;
      const isInnerRim = !isEdge && (x === 1 || y === 1 || x === safeW - 2 || y === safeH - 2);
      const scale = isEdge ? 0.54 : isInnerRim ? 0.92 : 0.72;
      out[off] = Math.min(255, Math.round(sideRgba[off] * scale));
      out[off + 1] = Math.min(255, Math.round(sideRgba[off + 1] * scale));
      out[off + 2] = Math.min(255, Math.round(sideRgba[off + 2] * scale));
      out[off + 3] = 255;
    }
  }
  return out;
}

/**
 * Converts a `PixelForgeOutput` into an atomic array of transactional `EcsStudioCommand`s
 * (registering sprites, optional AnimationStateMachine, optional Prefab stamp w/ LightSource, and optional TileDef w/ sideSprite).
 */
export function buildPixelForgeCommitCommands(
  output: PixelForgeOutput,
  project: EcsProjectV2,
  opts: PixelForgeCommitOptions = {},
): EcsStudioCommand[] {
  const cmds: EcsStudioCommand[] = [];
  for (const sprite of output.sprites) {
    cmds.push({ type: 'upsert_custom_sprite', sprite });
  }
  for (const animation of output.animations) {
    cmds.push({ type: 'upsert_animation', animation });
  }

  const primary = output.sprites[0];
  if (!primary) return cmds;

  const useLight = Boolean(opts.attachLight || output.bakingProfile === 'emissive_light_prop');
  const lightSpec = output.detectedLight;

  if (opts.registerPrefab) {
    const prefabId = sanitizeInteropId(`prefab_${primary.id}`, 'prefab_forged', 48);
    if (project.prefabs[prefabId]) {
      cmds.push({ type: 'delete_prefab', prefabId, mode: 'unlink' });
    }
    const anim = output.animations[0];
    const emissiveVal = opts.emissive ?? (useLight && lightSpec ? lightSpec.emissive : 0);
    cmds.push({
      type: 'create_prefab',
      prefab: {
        id: prefabId,
        name: primary.name ?? primary.id,
        category: opts.prefabCategory ?? (output.bakingProfile === 'billboard_actor' ? 'actor' : 'forged'),
        components: {
          tag: opts.prefabTag ?? (output.bakingProfile === 'billboard_actor' ? 'npc' : 'prop'),
          transform: {
            x: 0,
            y: 0,
            w: Math.max(16, Math.min(96, primary.width)),
            h: Math.max(16, Math.min(128, primary.height)),
          },
          sprite: {
            sprite: primary.id,
            tint: '#ffffff',
            castShadow: true,
            roughness: opts.roughness ?? 0.52,
            metallic: opts.metallic ?? 0.14,
            ...(emissiveVal > 0 ? { emissive: emissiveVal } : {}),
          },
          ...(useLight
            ? {
                light: {
                  radius: lightSpec?.radius ?? 108,
                  color: lightSpec?.color ?? '#f59e0b',
                  intensity: lightSpec?.intensity ?? 0.85,
                  falloffPower: 1.85,
                },
              }
            : {}),
          ...(opts.prefabSolid ? { collider: { radius: 12, isSolid: true } } : {}),
          ...(anim ? { animatorId: anim.id } : {}),
        },
      },
    });
  }

  if (opts.registerTileLayer) {
    if (!project.worldMap) {
      cmds.push({ type: 'ensure_world_map', cols: 22, rows: 14, roomName: '主場景' });
    }
    const tileId = pickNextCustomTileId(project);
    const layer = opts.registerTileLayer;
    const sideSprite = opts.sideSprite ?? output.wallSideSpriteId;
    cmds.push({
      type: 'upsert_tile_def',
      tileDef: {
        id: tileId,
        name: primary.name ?? primary.id,
        layer,
        sprite: primary.id,
        ...(layer === 'wall' && sideSprite ? { sideSprite } : {}),
        solid: opts.tileSolid ?? layer === 'wall',
        ...(layer === 'wall' ? { extrudeH: opts.tileExtrudeH ?? 28, wallMaterial: 'stone' as const } : {}),
        ...(layer === 'decor' && primary.height > primary.width ? { renderH: primary.height } : {}),
        roughness: opts.roughness ?? 0.62,
        metallic: opts.metallic ?? 0.12,
        ...(opts.emissive && opts.emissive > 0 ? { emissive: opts.emissive } : {}),
      },
    });
  }

  return cmds;
}
