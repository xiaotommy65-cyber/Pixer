import type { SpriteId } from '../../assets/TextureAtlas.ts';

/**
 * Axis 1: Perspective / Relative Viewing Direction.
 * The same visual blueprint renders coherently in 3P side/topdown, 1P directional billboards,
 * 1P held viewmodels, and tactical card portraits.
 */
export type OrthogonalFacing = 'front' | 'back' | 'side' | 'viewmodel' | 'portrait';

/**
 * Axis 2 modifier: Standardized Animation Pose across Fighting, Card, Platformer, and 1P/3P Explore.
 */
export type OrthogonalPose = 'idle' | 'walk' | 'windup' | 'strike' | 'guard' | 'hurt';

export type OrthogonalLayerSlot = 'aura' | 'body' | 'outfit' | 'headgear' | 'weapon' | 'fx';

export interface OrthogonalPoseTransform {
  dx?: number;
  dy?: number;
  rot?: number;
  scaleX?: number;
  scaleY?: number;
  spriteOverride?: SpriteId;
  tint?: string;
}

export interface OrthogonalArtLayerDef {
  slot: OrthogonalLayerSlot;
  /** Facing -> SpriteId mapping (falls back to `front` if a specific view is omitted). */
  sprites: {
    front: SpriteId;
    back?: SpriteId;
    side?: SpriteId;
    viewmodel?: SpriteId;
    portrait?: SpriteId;
  };
  /** Optional alternate animation frame for idle/walk bobbing. */
  altSprite?: SpriteId;
  /** Offset in normalized entity units (e.g. +0.35 = right of center, -0.2 = above center). */
  ox?: number;
  oy?: number;
  /** Relative size scale compared to base entity (1 = full entity box). */
  scaleX?: number;
  scaleY?: number;
  /** Axis 3: Palette LUT row override (undefined inherits entity paletteRow). */
  paletteRow?: number;
  /** Axis 4: Material / Shader modifiers. */
  tint?: string;
  alpha?: number;
  emissive?: number;
  additive?: boolean;
  rot?: number;
  /** Optional pose-specific transform overrides (e.g. weapon windup/strike/guard). */
  poses?: Partial<Record<OrthogonalPose, OrthogonalPoseTransform>>;
}

export interface OrthogonalArtBlueprint {
  id: string;
  label: string;
  defaultPaletteRow?: number;
  layers: readonly OrthogonalArtLayerDef[];
}

export interface ResolvedLayerInstance {
  sprite: SpriteId;
  ox: number;
  oy: number;
  scaleX: number;
  scaleY: number;
  rot: number;
  flipX: boolean;
  tint?: string;
  alpha: number;
  paletteRow: number;
  emissive: number;
  additive: boolean;
}

export interface RelativeFacingOut {
  facing: 'front' | 'back' | 'side';
  flipX: boolean;
}

/**
 * Zero-GC directional resolver for 1P 2.5D billboards and 3P multi-angle actors:
 * computes whether the viewer sees an entity's front, back, left side, or right side
 * from `(viewerX, viewerY)` relative to `(entityX, entityY, entityYawRad)`.
 */
export function resolveRelativeFacingInto(
  viewerX: number,
  viewerY: number,
  entityX: number,
  entityY: number,
  entityYawRad: number,
  out: RelativeFacingOut,
): void {
  const angleToViewer = Math.atan2(viewerY - entityY, viewerX - entityX);
  let diff = angleToViewer - entityYawRad;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  const absDiff = Math.abs(diff);
  if (absDiff <= Math.PI * 0.25) {
    out.facing = 'front';
    out.flipX = false;
  } else if (absDiff >= Math.PI * 0.75) {
    out.facing = 'back';
    out.flipX = false;
  } else {
    out.facing = 'side';
    out.flipX = diff < 0;
  }
}

export const MAX_COMPOSED_LAYERS = 8;

/**
 * Zero-GC pre-allocated output pool for expanding a 4-Axis Orthogonal Blueprint into flat layer draws.
 */
export function createComposedLayerPool(): ResolvedLayerInstance[] {
  const pool: ResolvedLayerInstance[] = [];
  for (let i = 0; i < MAX_COMPOSED_LAYERS; i++) {
    pool.push({
      sprite: 'solid',
      ox: 0,
      oy: 0,
      scaleX: 1,
      scaleY: 1,
      rot: 0,
      flipX: false,
      tint: undefined,
      alpha: 1,
      paletteRow: 0,
      emissive: 0,
      additive: false,
    });
  }
  return pool;
}

/**
 * Expands an `OrthogonalArtBlueprint` along all four orthogonal axes:
 *   Facing × Modular Layer Stack × Palette LUT × Material/Pose modifiers.
 * Writes into `outPool` with zero heap allocations and returns layer count.
 */
export function composeOrthogonalBlueprintInto(
  blueprint: OrthogonalArtBlueprint,
  facing: OrthogonalFacing,
  pose: OrthogonalPose,
  paletteRowOverride: number | undefined,
  baseFlipX: boolean,
  animToggle: boolean,
  outPool: ResolvedLayerInstance[],
): number {
  const layers = blueprint.layers;
  const count = Math.min(layers.length, outPool.length);
  const flipSign = baseFlipX ? -1 : 1;
  const resolvedBasePalette = paletteRowOverride ?? blueprint.defaultPaletteRow ?? 0;

  for (let i = 0; i < count; i++) {
    const def = layers[i];
    const dst = outPool[i];
    const poseMod = def.poses?.[pose];

    let sprite =
      poseMod?.spriteOverride ??
      (facing === 'back'
        ? def.sprites.back ?? def.sprites.front
        : facing === 'side'
          ? def.sprites.side ?? def.sprites.front
          : facing === 'viewmodel'
            ? def.sprites.viewmodel ?? def.sprites.side ?? def.sprites.front
            : facing === 'portrait'
              ? def.sprites.portrait ?? def.sprites.front
              : def.sprites.front);

    if (animToggle && def.altSprite && (pose === 'idle' || pose === 'walk') && !poseMod?.spriteOverride) {
      sprite = def.altSprite;
    }

    dst.sprite = sprite;
    dst.ox = ((def.ox ?? 0) + (poseMod?.dx ?? 0)) * flipSign;
    dst.oy = (def.oy ?? 0) + (poseMod?.dy ?? 0);
    dst.scaleX = (def.scaleX ?? 1) * (poseMod?.scaleX ?? 1);
    dst.scaleY = (def.scaleY ?? 1) * (poseMod?.scaleY ?? 1);
    dst.rot = ((def.rot ?? 0) + (poseMod?.rot ?? 0)) * flipSign;
    dst.flipX = baseFlipX;
    dst.tint = poseMod?.tint ?? def.tint;
    dst.alpha = def.alpha ?? 1;
    dst.paletteRow = def.paletteRow ?? resolvedBasePalette;
    dst.emissive = def.emissive ?? 0;
    dst.additive = def.additive ?? false;
  }

  return count;
}

/**
 * Built-in Orthogonal Art Blueprint library composed strictly from existing TextureAtlas sprites.
 * Every actor/item works seamlessly across 3P top-down/side-view, 1P billboards/viewmodels,
 * fighting poses, and card portraits via 4-axis parameterization.
 */
export const BUILTIN_ORTHOGONAL_BLUEPRINTS: Readonly<Record<string, OrthogonalArtBlueprint>> = {
  atelier_striker: {
    id: 'atelier_striker',
    label: '工房劍士',
    defaultPaletteRow: 0,
    layers: [
      {
        slot: 'body',
        sprites: {
          front: 'hero_a',
          back: 'hero_b',
          side: 'parkour_hero_idle',
          portrait: 'hero_a',
        },
        altSprite: 'hero_b',
        poses: {
          walk: { dy: -0.04, spriteOverride: 'parkour_hero_run_a' },
          windup: { dx: -0.1, rot: -0.12 },
          strike: { dx: 0.14, rot: 0.1, spriteOverride: 'parkour_hero_dash' },
          guard: { dx: -0.06, scaleX: 0.92, scaleY: 0.96 },
          hurt: { dx: -0.12, rot: -0.22 },
        },
      },
      {
        slot: 'weapon',
        sprites: {
          front: 'sword_icon',
          back: 'shield_icon',
          side: 'sword_icon',
          viewmodel: 'sword_icon',
          portrait: 'sword_icon',
        },
        ox: 0.36,
        oy: 0.04,
        scaleX: 0.62,
        scaleY: 0.62,
        emissive: 0.25,
        poses: {
          windup: { dx: -0.26, dy: -0.18, rot: -0.85 },
          strike: { dx: 0.42, dy: -0.02, rot: 0.95, scaleX: 1.28, scaleY: 1.18, spriteOverride: 'sword_slash' },
          guard: { dx: 0.08, dy: 0.02, rot: -0.15, spriteOverride: 'shield_icon' },
          hurt: { dx: -0.18, dy: 0.14, rot: -0.6 },
        },
      },
    ],
  },
  crimson_rival: {
    id: 'crimson_rival',
    label: '赤炎拳師',
    defaultPaletteRow: 2,
    layers: [
      {
        slot: 'aura',
        sprites: { front: 'sparkle', side: 'sparkle', portrait: 'sparkle' },
        scaleX: 1.25,
        scaleY: 1.25,
        alpha: 0.32,
        emissive: 0.75,
        additive: true,
        tint: '#ff708d',
      },
      {
        slot: 'body',
        sprites: {
          front: 'slime_knight',
          back: 'ember_warden',
          side: 'slime_knight',
          portrait: 'slime_knight',
        },
        altSprite: 'ember_warden',
        poses: {
          windup: { dx: -0.12, rot: -0.14 },
          strike: { dx: 0.18, rot: 0.14 },
          guard: { dx: -0.05, scaleX: 0.92 },
          hurt: { dx: -0.15, rot: -0.24 },
        },
      },
      {
        slot: 'weapon',
        sprites: {
          front: 'relic_flame',
          back: 'shield_icon',
          side: 'relic_flame',
          portrait: 'relic_flame',
        },
        ox: 0.38,
        oy: 0.02,
        scaleX: 0.65,
        scaleY: 0.65,
        emissive: 0.65,
        tint: '#ff9642',
        poses: {
          windup: { dx: -0.25, dy: -0.15, rot: -0.8 },
          strike: { dx: 0.45, dy: -0.04, rot: 0.9, scaleX: 1.35, scaleY: 1.25, spriteOverride: 'sword_slash' },
          guard: { dx: 0.05, spriteOverride: 'shield_icon', tint: '#ffd447' },
          hurt: { dx: -0.2, dy: 0.12 },
        },
      },
    ],
  },
  sentinel_golem: {
    id: 'sentinel_golem',
    label: '秘銀守衛',
    defaultPaletteRow: 3,
    layers: [
      {
        slot: 'body',
        sprites: {
          front: 'ember_warden',
          back: 'gargoyle',
          side: 'slime_knight',
          portrait: 'ember_warden',
        },
        poses: {
          windup: { dy: -0.08, scaleY: 1.08 },
          strike: { dx: 0.14, scaleX: 1.12 },
          hurt: { rot: -0.18 },
        },
      },
      {
        slot: 'fx',
        sprites: { front: 'astral_core', back: 'shield_icon', side: 'astral_core', portrait: 'astral_core' },
        oy: -0.42,
        scaleX: 0.48,
        scaleY: 0.48,
        emissive: 0.85,
        additive: true,
        tint: '#5ec2f7',
      },
    ],
  },
  frost_arcanist: {
    id: 'frost_arcanist',
    label: '星霜術師',
    defaultPaletteRow: 1,
    layers: [
      {
        slot: 'aura',
        sprites: { front: 'sparkle', portrait: 'sparkle' },
        scaleX: 1.15,
        scaleY: 1.15,
        alpha: 0.38,
        emissive: 0.8,
        additive: true,
        tint: '#8be9fd',
      },
      {
        slot: 'body',
        sprites: {
          front: 'frost_mage',
          back: 'shaman',
          side: 'frost_mage',
          portrait: 'frost_mage',
        },
        altSprite: 'shaman',
      },
      {
        slot: 'weapon',
        sprites: { front: 'pickup_crystal', side: 'pickup_crystal', viewmodel: 'pickup_crystal', portrait: 'pickup_crystal' },
        ox: 0.34,
        oy: -0.08,
        scaleX: 0.55,
        scaleY: 0.55,
        emissive: 0.9,
        tint: '#e0aaff',
      },
    ],
  },
  dragon_sovereign: {
    id: 'dragon_sovereign',
    label: '餘燼龍王',
    defaultPaletteRow: 4,
    layers: [
      {
        slot: 'aura',
        sprites: { front: 'relic_flame', portrait: 'relic_flame' },
        scaleX: 1.35,
        scaleY: 1.35,
        alpha: 0.35,
        emissive: 0.95,
        additive: true,
        tint: '#ff5d8f',
      },
      {
        slot: 'body',
        sprites: { front: 'dragon', back: 'gargoyle', side: 'dragon', portrait: 'dragon' },
        poses: {
          windup: { dy: -0.1, scaleX: 1.08, scaleY: 1.08 },
          strike: { dx: -0.12, scaleX: 1.16 },
          hurt: { rot: 0.16 },
        },
      },
    ],
  },
  fp_lantern_blade: {
    id: 'fp_lantern_blade',
    label: '第一人稱聖燈劍',
    defaultPaletteRow: 0,
    layers: [
      {
        slot: 'weapon',
        sprites: { front: 'sword_icon', viewmodel: 'sword_icon' },
        ox: 0,
        oy: 0,
        scaleX: 1,
        scaleY: 1,
        emissive: 0.3,
        poses: {
          idle: { rot: -0.25 },
          walk: { dy: 0.06, rot: -0.2 },
          windup: { dx: 0.12, dy: -0.18, rot: -0.75 },
          strike: { dx: -0.35, dy: -0.12, rot: -1.35, scaleX: 1.25, scaleY: 1.25, spriteOverride: 'sword_slash' },
          guard: { dx: -0.28, dy: -0.08, rot: 0, spriteOverride: 'shield_icon' },
        },
      },
      {
        slot: 'fx',
        sprites: { front: 'torch', viewmodel: 'sparkle' },
        ox: -0.16,
        oy: -0.22,
        scaleX: 0.45,
        scaleY: 0.45,
        emissive: 0.9,
        additive: true,
        tint: '#ffd447',
      },
    ],
  },
  card_art_strike: {
    id: 'card_art_strike',
    label: '斬擊卡圖',
    defaultPaletteRow: 0,
    layers: [
      { slot: 'aura', sprites: { front: 'sparkle', portrait: 'sparkle' }, scaleX: 1.1, scaleY: 1.1, tint: '#ff708d', alpha: 0.45, additive: true, emissive: 0.7 },
      { slot: 'weapon', sprites: { front: 'sword_slash', portrait: 'sword_icon' }, scaleX: 0.9, scaleY: 0.9, tint: '#fff3cc', emissive: 0.35 },
    ],
  },
  card_art_shield: {
    id: 'card_art_shield',
    label: '聖盾卡圖',
    defaultPaletteRow: 1,
    layers: [
      { slot: 'aura', sprites: { front: 'sparkle', portrait: 'sparkle' }, scaleX: 1.1, scaleY: 1.1, tint: '#5ec2f7', alpha: 0.45, additive: true, emissive: 0.7 },
      { slot: 'weapon', sprites: { front: 'shield_icon', portrait: 'shield_icon' }, scaleX: 0.9, scaleY: 0.9, tint: '#bfe9ff', emissive: 0.35 },
    ],
  },
  card_art_flame: {
    id: 'card_art_flame',
    label: '烈焰卡圖',
    defaultPaletteRow: 2,
    layers: [
      { slot: 'aura', sprites: { front: 'sparkle', portrait: 'sparkle' }, scaleX: 1.15, scaleY: 1.15, tint: '#ff9642', alpha: 0.5, additive: true, emissive: 0.85 },
      { slot: 'weapon', sprites: { front: 'relic_flame', portrait: 'relic_flame' }, scaleX: 0.92, scaleY: 0.92, tint: '#ffd447', emissive: 0.6 },
    ],
  },
  card_art_surge: {
    id: 'card_art_surge',
    label: '星湧卡圖',
    defaultPaletteRow: 3,
    layers: [
      { slot: 'aura', sprites: { front: 'astral_core', portrait: 'astral_core' }, scaleX: 1.1, scaleY: 1.1, tint: '#e0aaff', alpha: 0.55, additive: true, emissive: 0.85 },
      { slot: 'weapon', sprites: { front: 'pickup_crystal', portrait: 'pickup_crystal' }, scaleX: 0.85, scaleY: 0.85, tint: '#ffffff', emissive: 0.55 },
    ],
  },
  card_art_heal: {
    id: 'card_art_heal',
    label: '甘露卡圖',
    defaultPaletteRow: 0,
    layers: [
      { slot: 'aura', sprites: { front: 'sparkle', portrait: 'sparkle' }, scaleX: 1.1, scaleY: 1.1, tint: '#56d39c', alpha: 0.45, additive: true, emissive: 0.7 },
      { slot: 'weapon', sprites: { front: 'potion', portrait: 'potion' }, scaleX: 0.9, scaleY: 0.9, tint: '#d4ffe8', emissive: 0.35 },
    ],
  },
};

export function getOrthogonalBlueprint(
  id: string | undefined,
  customMap?: Readonly<Record<string, OrthogonalArtBlueprint>>,
): OrthogonalArtBlueprint | undefined {
  if (!id) return undefined;
  return customMap?.[id] ?? BUILTIN_ORTHOGONAL_BLUEPRINTS[id];
}
