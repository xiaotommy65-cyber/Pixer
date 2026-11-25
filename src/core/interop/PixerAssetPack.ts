import type { ExternalAudioManifest } from '../audio/ExternalAudioBank.ts';
import { validateCutsceneDef, type EcsCutsceneDef } from '../ecs/EcsCutsceneSchema.ts';
import { encodeRgbaToZlibB64 } from '../ecs/EcsCustomSpriteCompiler.ts';
import {
  validateCustomSpriteDef,
  type EcsCustomSpriteDef,
  type EcsPrefabDef,
  type EcsProjectV2,
} from '../ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand } from '../ecs/EcsStudioSession.ts';
import type { EcsTileDef } from '../ecs/EcsTilemapTypes.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import { pickNextCustomTileId, sanitizeInteropId } from './InteropTypes.ts';
import { quantizeRgbaOklab, type PixelForgePaletteId } from './PixelForgeProcessor.ts';

export type PixerAssetPackGenre = 'horror' | 'visual_novel' | 'dungeon' | 'scifi' | 'universal';
export type BuiltinStarterPackGenre = 'horror' | 'visual_novel' | 'dungeon';

export interface PixerAssetPackPortraitMeta {
  spriteId: string;
  displayName: string;
  mood?: string;
}

export interface PixerAssetPackManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  genre: PixerAssetPackGenre;
  description?: string;
  tileSize: number;
  paletteId?: PixelForgePaletteId;
  palette?: string[];
  atmospherePreset?: Partial<EcsProjectV2['atmosphere']>;
  sprites: EcsCustomSpriteDef[];
  tileDefs?: EcsTileDef[];
  prefabs?: Record<string, EcsPrefabDef>;
  animations?: AnimationStateMachineDef[];
  cutscenes?: EcsCutsceneDef[];
  portraits?: Record<string, PixerAssetPackPortraitMeta>;
  audioManifest?: ExternalAudioManifest;
}

export interface PixerAssetPackSummary {
  readonly genre: BuiltinStarterPackGenre;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly paletteId: PixelForgePaletteId;
}

export const BUILTIN_STARTER_PACK_SUMMARIES: readonly PixerAssetPackSummary[] = [
  {
    genre: 'horror',
    id: 'horror-asylum-pack',
    name: '陰森古宅恐怖包 (Horror Asylum)',
    description: '冷灰裂磚、血痕地面、幽暗燭火光源、暗影潛行者與 160×192 偵探像素立繪。',
    paletteId: 'asylum_horror',
  },
  {
    genre: 'visual_novel',
    id: 'cozy-parlor-vn-pack',
    name: '暖色手帳物語包 (Visual Novel Parlor)',
    description: '溫潤木紋地板、復古書桌道具、暖光書房氛圍與 160×192 主角像素立繪。',
    paletteId: 'cozy_vn',
  },
  {
    genre: 'dungeon',
    id: 'obsidian-crypt-pack',
    name: '古墓地牢擴充包 (Obsidian Crypt)',
    description: '符文石地磚、古墓雕花牆、魔力方尖碑光源與詛咒聖遺物寶箱。',
    paletteId: 'obsidian_dungeon',
  },
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,47}$/;
const VALID_GENRES: ReadonlySet<string> = new Set(['horror', 'visual_novel', 'dungeon', 'scifi', 'universal']);

/**
 * Validates an untrusted JSON object as a `PixerAssetPackManifest` (schemaVersion 1).
 */
export function validateAssetPackManifest(
  raw: unknown,
): { ok: true; pack: PixerAssetPackManifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['Asset pack manifest must be a JSON object'] };
  }
  const p = raw as Partial<PixerAssetPackManifest>;
  if (p.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1 (got ${String(p.schemaVersion)})`);
  }
  if (!p.id || typeof p.id !== 'string' || !SLUG_RE.test(p.id)) {
    errors.push('id must match /^[a-z0-9][a-z0-9-]{2,47}$/');
  }
  if (!p.name || typeof p.name !== 'string' || p.name.trim().length === 0) {
    errors.push('name must be a non-empty string');
  }
  if (!p.genre || typeof p.genre !== 'string' || !VALID_GENRES.has(p.genre)) {
    errors.push(`genre '${String(p.genre)}' must be one of horror, visual_novel, dungeon, scifi, universal`);
  }
  if (!Number.isInteger(p.tileSize) || (p.tileSize ?? 0) < 8 || (p.tileSize ?? 0) > 128) {
    errors.push('tileSize must be an integer in 8..128');
  }
  if (!Array.isArray(p.sprites) || p.sprites.length > 128) {
    errors.push('sprites must be an array of at most 128 EcsCustomSpriteDef entries');
  } else {
    for (let i = 0; i < p.sprites.length; i++) {
      errors.push(...validateCustomSpriteDef(p.sprites[i], `sprites[${i}]`));
    }
  }
  if (p.tileDefs !== undefined && !Array.isArray(p.tileDefs)) {
    errors.push('tileDefs must be an array when provided');
  }
  if (p.prefabs !== undefined && (typeof p.prefabs !== 'object' || p.prefabs === null || Array.isArray(p.prefabs))) {
    errors.push('prefabs must be a record map when provided');
  }
  if (p.animations !== undefined && !Array.isArray(p.animations)) {
    errors.push('animations must be an array when provided');
  }
  if (p.cutscenes !== undefined) {
    if (!Array.isArray(p.cutscenes)) {
      errors.push('cutscenes must be an array when provided');
    } else {
      for (let i = 0; i < p.cutscenes.length; i++) {
        errors.push(...validateCutsceneDef(p.cutscenes[i], `cutscenes[${i}]`));
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, pack: p as PixerAssetPackManifest };
}

/**
 * Generates an atomic `EcsStudioCommand[]` batch to install a validated `PixerAssetPackManifest`
 * into the active project (single Undo step, safe tile ID collision avoidance).
 */
export function buildAssetPackInstallCommands(
  pack: PixerAssetPackManifest,
  project: EcsProjectV2,
  opts: { applyAtmosphere?: boolean } = {},
): EcsStudioCommand[] {
  const cmds: EcsStudioCommand[] = [];

  for (const sprite of pack.sprites) {
    cmds.push({ type: 'upsert_custom_sprite', sprite });
  }

  if (pack.animations) {
    for (const animation of pack.animations) {
      cmds.push({ type: 'upsert_animation', animation });
    }
  }

  if (pack.cutscenes) {
    for (const cutscene of pack.cutscenes) {
      cmds.push({ type: 'upsert_cutscene', cutscene });
    }
  }

  if (pack.tileDefs && pack.tileDefs.length > 0) {
    if (!project.worldMap) {
      cmds.push({ type: 'ensure_world_map', cols: 22, rows: 14, roomName: '主場景' });
    }
    const existingById = new Map<number, EcsTileDef>();
    const usedIds = new Set<number>();
    if (project.worldMap?.tileDefs) {
      for (const td of project.worldMap.tileDefs) {
        existingById.set(td.id, td);
        usedIds.add(td.id);
      }
    }

    for (const rawTd of pack.tileDefs) {
      const existing = existingById.get(rawTd.id);
      let finalId = rawTd.id;
      if (finalId <= 0 || (existing && existing.sprite !== rawTd.sprite)) {
        finalId = pickNextCustomTileId(project, usedIds);
      }
      usedIds.add(finalId);
      cmds.push({
        type: 'upsert_tile_def',
        tileDef: finalId === rawTd.id ? rawTd : { ...rawTd, id: finalId },
      });
    }
  }

  if (pack.prefabs) {
    for (const [key, rawPrefab] of Object.entries(pack.prefabs)) {
      const pid = rawPrefab.id || key;
      const prefab: EcsPrefabDef = { ...rawPrefab, id: pid };
      if (project.prefabs[pid]) {
        cmds.push({ type: 'delete_prefab', prefabId: pid, mode: 'unlink' });
      }
      cmds.push({ type: 'create_prefab', prefab });
    }
  }

  if (opts.applyAtmosphere && pack.atmospherePreset) {
    cmds.push({ type: 'set_atmosphere', patch: { ...pack.atmospherePreset } });
  }

  return cmds;
}

/**
 * Exports the active project's custom sprites, custom tiles, prefabs, animations, and atmosphere
 * into a portable v1 `PixerAssetPackManifest`.
 */
export function exportProjectAsAssetPack(
  project: EcsProjectV2,
  opts: { id?: string; name?: string; genre?: PixerAssetPackGenre; description?: string } = {},
): PixerAssetPackManifest {
  const rawSlug = sanitizeInteropId(opts.id || project.meta.id, 'pixer-pack', 44).replace(/_/g, '-');
  const slug = SLUG_RE.test(rawSlug) ? rawSlug : 'pixer-custom-pack';
  const sprites = project.customSprites ? Object.values(project.customSprites) : [];
  const tileDefs = project.worldMap?.tileDefs ? [...project.worldMap.tileDefs] : [];
  const prefabs = { ...project.prefabs };
  const animations = project.animations ? [...project.animations] : [];
  const cutscenes = project.cutscenes ? [...project.cutscenes] : [];

  return {
    schemaVersion: 1,
    id: slug,
    name: (opts.name || `${project.meta.title} 資產包`).trim(),
    genre: opts.genre ?? 'universal',
    description: opts.description ?? project.meta.subtitle,
    tileSize: project.worldMap?.tileSize ?? 32,
    atmospherePreset: { ...project.atmosphere },
    sprites,
    ...(tileDefs.length > 0 ? { tileDefs } : {}),
    ...(Object.keys(prefabs).length > 0 ? { prefabs } : {}),
    ...(animations.length > 0 ? { animations } : {}),
    ...(cutscenes.length > 0 ? { cutscenes } : {}),
  };
}

// ============================================================================
// Built-In Cross-Genre Starter Asset Packs (Horror / Visual Novel / Dungeon)
// ============================================================================

function parseHexRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function makePixelCanvas(w: number, h: number) {
  const rgba = new Uint8Array(w * h * 4);
  const put = (x: number, y: number, hex: string) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;
    const [r, g, b, a] = parseHexRgba(hex);
    const off = (iy * w + ix) * 4;
    rgba[off] = r;
    rgba[off + 1] = g;
    rgba[off + 2] = b;
    rgba[off + 3] = a;
  };
  const rect = (x0: number, y0: number, rw: number, rh: number, hex: string) => {
    for (let y = y0; y < y0 + rh; y++) {
      for (let x = x0; x < x0 + rw; x++) {
        put(x, y, hex);
      }
    }
  };
  const disc = (cx: number, cy: number, rad: number, hex: string) => {
    const r2 = rad * rad;
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) put(x, y, hex);
      }
    }
  };
  return { rgba, put, rect, disc };
}

function makeEncodedSprite(
  id: string,
  name: string,
  w: number,
  h: number,
  rgba: Uint8Array,
  paletteId: PixelForgePaletteId,
): EcsCustomSpriteDef {
  const quantized = quantizeRgbaOklab(rgba, w, h, {
    colorMode: 'palette_lock',
    paletteId,
    dither: true,
  });
  return {
    id,
    name,
    width: w,
    height: h,
    kind: 'rgba_b64',
    rgbaB64: encodeRgbaToZlibB64(quantized),
  };
}

function buildPortraitRgba(
  w: number,
  h: number,
  palette: {
    coat: string;
    coatShade: string;
    skin: string;
    skinShade: string;
    hair: string;
    hairLight: string;
    eye: string;
    accent: string;
    outline: string;
  },
): Uint8Array {
  const c = makePixelCanvas(w, h);
  const cx = Math.floor(w * 0.5);
  // Crisp torso / coat silhouette (lower half)
  c.rect(cx - 46, 112, 92, 76, palette.outline);
  c.rect(cx - 42, 116, 84, 72, palette.coat);
  c.rect(cx - 42, 116, 26, 72, palette.coatShade);
  // Collar & scarf / tie accent
  c.rect(cx - 18, 114, 36, 22, palette.skinShade);
  c.rect(cx - 12, 128, 24, 52, palette.accent);
  // Neck & head
  c.rect(cx - 12, 96, 24, 22, palette.skinShade);
  c.disc(cx, 66, 36, palette.outline);
  c.disc(cx, 66, 32, palette.skin);
  c.rect(cx - 28, 74, 14, 18, palette.skinShade);
  // Hair crown & side locks
  c.disc(cx, 44, 34, palette.outline);
  c.disc(cx, 46, 31, palette.hair);
  c.rect(cx - 34, 48, 12, 42, palette.hair);
  c.rect(cx + 22, 48, 12, 42, palette.hair);
  c.rect(cx - 20, 22, 36, 8, palette.hairLight);
  // Expressive pixel eyes & brow
  c.rect(cx - 18, 60, 10, 4, palette.outline);
  c.rect(cx + 8, 60, 10, 4, palette.outline);
  c.rect(cx - 16, 66, 8, 10, palette.eye);
  c.rect(cx + 8, 66, 8, 10, palette.eye);
  c.rect(cx - 14, 67, 3, 3, '#ffffff');
  c.rect(cx + 10, 67, 3, 3, '#ffffff');
  // Subtle mouth
  c.rect(cx - 6, 84, 12, 3, palette.skinShade);
  return c.rgba;
}

function buildHorrorPack(): PixerAssetPackManifest {
  // 1. Candle prop (32x32)
  const candle = makePixelCanvas(32, 32);
  candle.rect(10, 24, 12, 4, '#262b36');
  candle.rect(13, 12, 6, 12, '#eae6df');
  candle.rect(13, 12, 2, 12, '#c5cad4');
  candle.rect(15, 9, 2, 3, '#090a0f');
  candle.disc(16, 7, 3, '#e0b468');
  candle.put(16, 6, '#eae6df');

  // 2. Shadow Stalker (32x48)
  const stalker = makePixelCanvas(32, 48);
  stalker.disc(16, 14, 8, '#090a0f');
  stalker.rect(10, 18, 12, 24, '#090a0f');
  stalker.rect(8, 22, 16, 14, '#151821');
  stalker.rect(12, 13, 3, 2, '#d64949');
  stalker.rect(17, 13, 3, 2, '#d64949');

  // 3. Blood splatter floor decal (32x32)
  const blood = makePixelCanvas(32, 32);
  blood.disc(16, 16, 7, '#6e1620');
  blood.disc(14, 15, 4, '#3a0d12');
  blood.disc(22, 20, 3, '#6e1620');
  blood.put(10, 22, '#a8242e');

  // 4. 160x192 Investigator Pixel Portrait (proving >128px portrait support)
  const portraitRgba = buildPortraitRgba(160, 192, {
    coat: '#262b36',
    coatShade: '#151821',
    skin: '#c5cad4',
    skinShade: '#8d95a5',
    hair: '#151821',
    hairLight: '#3e4452',
    eye: '#d64949',
    accent: '#6e1620',
    outline: '#090a0f',
  });

  const sprites: EcsCustomSpriteDef[] = [
    {
      id: 'hr_floor_cracked',
      name: '裂紋冷灰石地',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: {
        pattern: 'cobble',
        baseHex: '#262b36',
        secondaryHex: '#151821',
        accentHex: '#3e4452',
        outlineHex: '#090a0f',
        seed: 707,
        dither: true,
      },
    },
    {
      id: 'hr_wall_asylum',
      name: '陰濕混凝土牆',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: {
        pattern: 'bricks',
        baseHex: '#3e4452',
        secondaryHex: '#151821',
        accentHex: '#4a5d46',
        outlineHex: '#090a0f',
        seed: 709,
        dither: true,
        bevel: true,
      },
    },
    makeEncodedSprite('hr_blood_decal', '乾涸血痕裝飾', 32, 32, blood.rgba, 'asylum_horror'),
    makeEncodedSprite('hr_ritual_candle', '儀式搖曳燭台', 32, 32, candle.rgba, 'asylum_horror'),
    makeEncodedSprite('hr_shadow_stalker', '暗影潛行者', 32, 48, stalker.rgba, 'asylum_horror'),
    makeEncodedSprite('hr_portrait_detective', '調查員立繪 (160×192)', 160, 192, portraitRgba, 'asylum_horror'),
  ];

  return {
    schemaVersion: 1,
    id: 'horror-asylum-pack',
    name: '陰森古宅恐怖包 (Horror Asylum)',
    genre: 'horror',
    description: '冷灰裂磚、血痕、燭火點光源、暗影潛行者與 160×192 像素立繪。',
    tileSize: 32,
    paletteId: 'asylum_horror',
    atmospherePreset: {
      skyTop: '#04050a',
      skyBottom: '#0f121a',
      ambientDarkness: 0.72,
      shadowOcclusion: true,
      shadowStrength: 0.94,
      ambientParticles: 'dust',
      ambientParticleDensity: 0.5,
    },
    sprites,
    tileDefs: [
      { id: 410, name: '恐怖裂磚地', layer: 'ground', sprite: 'hr_floor_cracked', solid: false, roughness: 0.8, metallic: 0.05 },
      { id: 411, name: '陰濕古宅牆', layer: 'wall', sprite: 'hr_wall_asylum', solid: true, extrudeH: 30, wallMaterial: 'stone', roughness: 0.78, metallic: 0.05 },
      { id: 412, name: '血痕地貼', layer: 'decor', sprite: 'hr_blood_decal', solid: false, roughness: 0.45, metallic: 0.1 },
    ],
    prefabs: {
      hr_candle_prop: {
        id: 'hr_candle_prop',
        name: '恐怖儀式燭台',
        category: '恐怖道具',
        components: {
          transform: { x: 0, y: 0, w: 32, h: 32 },
          sprite: { sprite: 'hr_ritual_candle', castShadow: true, roughness: 0.4, metallic: 0.3, emissive: 0.85 },
          light: { radius: 112, color: '#e0b468', intensity: 0.88, falloffPower: 1.9 },
          tag: 'candle',
        },
      },
      hr_stalker_enemy: {
        id: 'hr_stalker_enemy',
        name: '暗影潛行者 (32×48)',
        category: '恐怖怪物',
        components: {
          transform: { x: 0, y: 0, w: 32, h: 48 },
          sprite: { sprite: 'hr_shadow_stalker', castShadow: true, roughness: 0.7, metallic: 0.1, emissive: 0.25 },
          health: { hp: 5, maxHp: 5, team: 2 },
          collider: { radius: 14, damage: 1, hitTag: 'hero' },
          tag: 'sentinel',
        },
      },
    },
    portraits: {
      detective: { spriteId: 'hr_portrait_detective', displayName: '調查員', mood: 'tense' },
    },
    cutscenes: [
      {
        id: 'hr_investigation_intro',
        name: '古宅線索調查對話 (160×192 立繪)',
        trigger: 'manual',
        handbackDurationSec: 0.45,
        skippable: true,
        shots: [
          {
            id: 'hr_shot_clue',
            durationSec: 2.2,
            subject: 'hero',
            shotSize: 'CU',
            anchor: 'right_third',
            motion: 'push_in',
            speaker: '調查員',
            portraitSpriteId: 'hr_portrait_detective',
            portraitSide: 'left',
            subtitle: '蠟燭才剛熄滅……兇手一定還藏在這座古宅的長廊裡。',
            letterbox: 1.0,
          },
        ],
      },
    ],
  };
}

function buildVisualNovelPack(): PixerAssetPackManifest {
  const desk = makePixelCanvas(48, 32);
  desk.rect(4, 8, 40, 18, '#6e4c36');
  desk.rect(4, 8, 40, 4, '#a3754e');
  desk.rect(8, 26, 5, 6, '#3b2a1e');
  desk.rect(35, 26, 5, 6, '#3b2a1e');
  desk.rect(18, 11, 12, 8, '#fff2e8');
  desk.rect(32, 10, 6, 6, '#e07b94');

  const portraitRgba = buildPortraitRgba(160, 192, {
    coat: '#46618f',
    coatShade: '#283754',
    skin: '#f5d7c6',
    skinShade: '#deae9b',
    hair: '#5e3f45',
    hairLight: '#b88378',
    eye: '#283754',
    accent: '#e07b94',
    outline: '#1e141a',
  });

  const sprites: EcsCustomSpriteDef[] = [
    {
      id: 'vn_parlor_wood',
      name: '暖木書房地板',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: {
        pattern: 'planks',
        baseHex: '#a3754e',
        secondaryHex: '#6e4c36',
        accentHex: '#d9a96c',
        outlineHex: '#3b2a1e',
        seed: 314,
        dither: true,
      },
    },
    {
      id: 'vn_wallpaper_wall',
      name: '古典書房壁板',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: {
        pattern: 'banner',
        baseHex: '#3f6951',
        secondaryHex: '#243d32',
        accentHex: '#d9a96c',
        outlineHex: '#1e141a',
        seed: 315,
        dither: true,
        bevel: true,
      },
    },
    makeEncodedSprite('vn_antique_desk', '復古寫字桌', 48, 32, desk.rgba, 'cozy_vn'),
    makeEncodedSprite('vn_portrait_protagonist', '手帳主角立繪 (160×192)', 160, 192, portraitRgba, 'cozy_vn'),
  ];

  return {
    schemaVersion: 1,
    id: 'cozy-parlor-vn-pack',
    name: '暖色手帳物語包 (Visual Novel Parlor)',
    genre: 'visual_novel',
    description: '溫潤木地板、古典書房壁板、寫字桌道具與 160×192 主角像素立繪。',
    tileSize: 32,
    paletteId: 'cozy_vn',
    atmospherePreset: {
      skyTop: '#1e141a',
      skyBottom: '#38252d',
      ambientDarkness: 0.18,
      shadowOcclusion: true,
      shadowStrength: 0.65,
      ambientParticles: 'fireflies',
      ambientParticleDensity: 0.35,
    },
    sprites,
    tileDefs: [
      { id: 420, name: '暖木地板', layer: 'ground', sprite: 'vn_parlor_wood', solid: false, roughness: 0.62, metallic: 0.04 },
      { id: 421, name: '古典書房壁', layer: 'wall', sprite: 'vn_wallpaper_wall', solid: true, extrudeH: 26, wallMaterial: 'timber', roughness: 0.65, metallic: 0.05 },
    ],
    prefabs: {
      vn_desk_prop: {
        id: 'vn_desk_prop',
        name: '復古寫字桌 (48×32)',
        category: '敘事道具',
        components: {
          transform: { x: 0, y: 0, w: 48, h: 32 },
          sprite: { sprite: 'vn_antique_desk', castShadow: true, roughness: 0.55, metallic: 0.1 },
          light: { radius: 96, color: '#d9a96c', intensity: 0.58, falloffPower: 1.8 },
          collider: { radius: 16, isSolid: true },
          tag: 'clue_desk',
        },
      },
    },
    portraits: {
      protagonist: { spriteId: 'vn_portrait_protagonist', displayName: '主角', mood: 'calm' },
    },
    cutscenes: [
      {
        id: 'vn_parlor_prologue',
        name: '手帳書房序章對話 (160×192 立繪)',
        trigger: 'manual',
        handbackDurationSec: 0.45,
        skippable: true,
        shots: [
          {
            id: 'vn_shot_1',
            durationSec: 2.2,
            subject: 'hero',
            shotSize: 'MS',
            anchor: 'right_third',
            motion: 'spring',
            speaker: '手帳主角',
            portraitSpriteId: 'vn_portrait_protagonist',
            portraitSide: 'left',
            subtitle: '午後的陽光灑在書桌上，泛黃的日記正等著我們翻開下一頁。',
            letterbox: 1.0,
          },
        ],
      },
    ],
  };
}

function buildDungeonPack(): PixerAssetPackManifest {
  const obelisk = makePixelCanvas(32, 48);
  obelisk.rect(8, 38, 16, 8, '#17192b');
  obelisk.rect(10, 10, 12, 28, '#2b304d');
  obelisk.rect(12, 6, 8, 4, '#495275');
  obelisk.rect(14, 15, 4, 16, '#48c7e8');
  obelisk.put(15, 18, '#f4f6fc');

  const sprites: EcsCustomSpriteDef[] = [
    {
      id: 'dg_crypt_rune_floor',
      name: '古墓符文石磚',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: {
        pattern: 'rune_floor',
        baseHex: '#2b304d',
        secondaryHex: '#17192b',
        accentHex: '#48c7e8',
        outlineHex: '#080912',
        seed: 901,
        dither: true,
        emissiveCore: true,
      },
    },
    {
      id: 'dg_crypt_pillar_wall',
      name: '黑曜古墓石牆',
      width: 32,
      height: 32,
      kind: 'procedural',
      recipe: {
        pattern: 'bricks',
        baseHex: '#2b304d',
        secondaryHex: '#080912',
        accentHex: '#8f1d2c',
        outlineHex: '#080912',
        seed: 902,
        dither: true,
        bevel: true,
      },
    },
    makeEncodedSprite('dg_arcane_obelisk', '魔力方尖碑', 32, 48, obelisk.rgba, 'obsidian_dungeon'),
  ];

  return {
    schemaVersion: 1,
    id: 'obsidian-crypt-pack',
    name: '古墓地牢擴充包 (Obsidian Crypt)',
    genre: 'dungeon',
    description: '符文石地磚、黑曜古墓石牆與青藍發光魔力方尖碑。',
    tileSize: 32,
    paletteId: 'obsidian_dungeon',
    atmospherePreset: {
      skyTop: '#060914',
      skyBottom: '#14192e',
      ambientDarkness: 0.48,
      shadowOcclusion: true,
      shadowStrength: 0.9,
      ambientParticles: 'embers',
      ambientParticleDensity: 0.6,
    },
    sprites,
    tileDefs: [
      { id: 430, name: '古墓符文地', layer: 'ground', sprite: 'dg_crypt_rune_floor', solid: false, roughness: 0.55, metallic: 0.18 },
      { id: 431, name: '黑曜古墓牆', layer: 'wall', sprite: 'dg_crypt_pillar_wall', solid: true, extrudeH: 28, wallMaterial: 'astral', roughness: 0.52, metallic: 0.2 },
    ],
    prefabs: {
      dg_obelisk_prop: {
        id: 'dg_obelisk_prop',
        name: '魔力方尖碑 (32×48)',
        category: '地牢機關',
        components: {
          transform: { x: 0, y: 0, w: 32, h: 48 },
          sprite: { sprite: 'dg_arcane_obelisk', castShadow: true, roughness: 0.32, metallic: 0.45, emissive: 0.8 },
          light: { radius: 132, color: '#48c7e8', intensity: 0.85, falloffPower: 1.8 },
          collider: { radius: 12, isSolid: true },
          tag: 'switch',
        },
      },
    },
  };
}

/**
 * Returns a built-in starter `PixerAssetPackManifest` for one of the core target genres.
 */
export function buildBuiltinStarterPack(genre: BuiltinStarterPackGenre): PixerAssetPackManifest {
  if (genre === 'horror') return buildHorrorPack();
  if (genre === 'visual_novel') return buildVisualNovelPack();
  return buildDungeonPack();
}
