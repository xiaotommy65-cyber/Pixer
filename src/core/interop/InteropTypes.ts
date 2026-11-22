import type {
  EcsCustomSpriteDef,
  EcsEntityInitDef,
  EcsPrefabDef,
  EcsProjectV2,
} from '../ecs/EcsProjectSchema.ts';
import type { EcsStudioCommand } from '../ecs/EcsStudioSession.ts';
import type {
  EcsMapInteractionRule,
  EcsMapLayerName,
  EcsMapPortalDef,
  EcsMapRoomDef,
  EcsTileDef,
  EcsTopDownAiProfile,
  EcsTopDownHeroConfig,
} from '../ecs/EcsTilemapTypes.ts';
import type {
  AnimationClipDef,
  AnimationStateMachineDef,
  AnimationTransitionDef,
} from '../sim/AnimationStateMachine.ts';

export type InteropSourceFormat = 'aseprite_bin' | 'aseprite_json' | 'ldtk' | 'tiled';

export interface DecodedPngImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export type PngDecodeFn = (bytes: Uint8Array, name: string) => Promise<DecodedPngImage | null>;

export interface InteropAnimationTag {
  name: string;
  fromFrame: number;
  toFrame: number;
  direction: 'forward' | 'reverse' | 'pingpong' | 'pingpong_reverse';
}

export interface InteropImportOptions {
  /** Wall extrusion height in pixels for HD-2D imported solid walls (default 24). */
  wallExtrudeH?: number;
  /** Prefix applied to generated custom sprite & tile IDs to avoid collisions. */
  idPrefix?: string;
}

export interface InteropCommitOptions {
  /** Replace existing WorldMap rooms, portals & room entities (true) or append (false). */
  replaceWorldMap: boolean;
  /** Override wall extrudeH on imported wall tileDefs if specified. */
  wallExtrudeH?: number;
  /** When importing standalone sprites (Aseprite), also register a Prefab using the first frame. */
  createPrefabFromSprite?: boolean;
  /** When importing standalone sprites (Aseprite), also register a paintable tileDef. */
  createTileFromSprite?: {
    layer: EcsMapLayerName;
    solid: boolean;
  };
}

export interface InteropImportResult {
  format: InteropSourceFormat;
  sourceName: string;
  summary: string;
  tileSize: number;
  customSprites: EcsCustomSpriteDef[];
  tileDefs: EcsTileDef[];
  rooms: EcsMapRoomDef[];
  portals: EcsMapPortalDef[];
  prefabs: EcsPrefabDef[];
  entities: EcsEntityInitDef[];
  heroConfig?: EcsTopDownHeroConfig;
  interactions?: EcsMapInteractionRule[];
  aiProfiles?: Record<string, EcsTopDownAiProfile>;
  globals?: Record<string, number>;
  animationTags?: InteropAnimationTag[];
  warnings: string[];
  missingAssetPaths: string[];
}

export interface InteropBundleFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * Sanitizes any external filename/identifier into a strict Pixer ECS ID matching `/^[a-zA-Z0-9_-]{2,64}$/`.
 */
export function sanitizeInteropId(raw: string, fallback = 'ext_item', maxLen = 56): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  let out = cleaned.length >= 2 ? cleaned : fallback;
  if (out.length > maxLen) {
    out = out.slice(0, maxLen).replace(/_+$/g, '');
  }
  return out.length >= 2 ? out : fallback;
}

/**
 * Normalizes a relative asset path for case-insensitive basename or suffix matching.
 */
export function normalizeAssetPathKey(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

/**
 * Finds a companion decoded PNG image by full relative path or basename.
 */
export function lookupCompanionImage(
  relPath: string | null | undefined,
  assetsByPath: ReadonlyMap<string, DecodedPngImage>,
): DecodedPngImage | null {
  if (!relPath) return null;
  const norm = normalizeAssetPathKey(relPath);
  const direct = assetsByPath.get(norm);
  if (direct) return direct;
  const base = norm.split('/').pop() ?? norm;
  const byBase = assetsByPath.get(base);
  if (byBase) return byBase;
  for (const [k, img] of assetsByPath.entries()) {
    if (k.endsWith(`/${base}`) || k === base) {
      return img;
    }
  }
  return null;
}

/**
 * Nearest-neighbor resizer / clamp to keep external sprite dimensions strictly within Pixer's 8..128 bounds
 * while preserving hard pixel edges.
 */
export function fitRgbaToSpriteBounds(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
): { width: number; height: number; rgba: Uint8Array; resized: boolean } {
  const w = Math.max(1, Math.floor(srcW));
  const h = Math.max(1, Math.floor(srcH));
  if (w >= 8 && w <= 128 && h >= 8 && h <= 128) {
    const expected = w * h * 4;
    if (rgba.length === expected) {
      return { width: w, height: h, rgba, resized: false };
    }
    const copy = new Uint8Array(expected);
    copy.set(rgba.subarray(0, Math.min(expected, rgba.length)));
    return { width: w, height: h, rgba: copy, resized: false };
  }

  let dstW = w;
  let dstH = h;
  if (dstW > 128 || dstH > 128) {
    const scale = Math.min(128 / dstW, 128 / dstH);
    dstW = Math.max(8, Math.min(128, Math.round(dstW * scale)));
    dstH = Math.max(8, Math.min(128, Math.round(dstH * scale)));
  }
  if (dstW < 8) dstW = 8;
  if (dstH < 8) dstH = 8;

  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(w - 1, Math.floor((x * w) / dstW));
      const srcOff = (sy * w + sx) * 4;
      const dstOff = (y * dstW + x) * 4;
      out[dstOff] = rgba[srcOff] ?? 0;
      out[dstOff + 1] = rgba[srcOff + 1] ?? 0;
      out[dstOff + 2] = rgba[srcOff + 2] ?? 0;
      out[dstOff + 3] = rgba[srcOff + 3] ?? 0;
    }
  }
  return { width: dstW, height: dstH, rgba: out, resized: true };
}

/**
 * Slices a rectangular sub-region from a decoded RGBA image.
 */
export function sliceRgbaRect(
  img: DecodedPngImage,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): Uint8Array {
  const safeW = Math.max(1, Math.floor(sw));
  const safeH = Math.max(1, Math.floor(sh));
  const out = new Uint8Array(safeW * safeH * 4);
  const startX = Math.floor(sx);
  const startY = Math.floor(sy);
  for (let y = 0; y < safeH; y++) {
    const py = startY + y;
    if (py < 0 || py >= img.height) continue;
    for (let x = 0; x < safeW; x++) {
      const px = startX + x;
      if (px < 0 || px >= img.width) continue;
      const srcOff = (py * img.width + px) * 4;
      const dstOff = (y * safeW + x) * 4;
      out[dstOff] = img.rgba[srcOff] ?? 0;
      out[dstOff + 1] = img.rgba[srcOff + 1] ?? 0;
      out[dstOff + 2] = img.rgba[srcOff + 2] ?? 0;
      out[dstOff + 3] = img.rgba[srcOff + 3] ?? 0;
    }
  }
  return out;
}

/**
 * Computes the next available custom tile ID >= 300 avoiding collisions with existing tileDefs.
 */
export function pickNextCustomTileId(project: EcsProjectV2, extraUsed?: ReadonlySet<number>): number {
  let maxId = 299;
  if (project.worldMap?.tileDefs) {
    for (const td of project.worldMap.tileDefs) {
      if (td.id > maxId) maxId = td.id;
    }
  }
  if (extraUsed) {
    for (const id of extraUsed) {
      if (id > maxId) maxId = id;
    }
  }
  return maxId + 1;
}

/**
 * Builds an `AnimationStateMachineDef` automatically from multi-frame Aseprite imports
 * (honoring `animationTags` directions and auto-wiring `idle` <-> `walk`/`run` transitions).
 */
export function buildAnimationFromInteropResult(result: InteropImportResult): AnimationStateMachineDef | null {
  if (result.customSprites.length <= 1) return null;
  const baseName = sanitizeInteropId(result.sourceName, 'sprite_anim', 40);
  const animId = `anim_${baseName}`;
  const clips: AnimationClipDef[] = [];

  if (result.animationTags && result.animationTags.length > 0) {
    for (const tag of result.animationTags) {
      const from = Math.max(0, Math.min(result.customSprites.length - 1, Math.floor(tag.fromFrame)));
      const to = Math.max(from, Math.min(result.customSprites.length - 1, Math.floor(tag.toFrame)));
      const seq: string[] = [];
      for (let i = from; i <= to; i++) {
        seq.push(result.customSprites[i].id);
      }
      let frames = seq;
      if (tag.direction === 'reverse') {
        frames = [...seq].reverse();
      } else if (tag.direction === 'pingpong' && seq.length > 2) {
        frames = [...seq, ...seq.slice(1, -1).reverse()];
      } else if (tag.direction === 'pingpong_reverse' && seq.length > 2) {
        const rev = [...seq].reverse();
        frames = [...rev, ...rev.slice(1, -1).reverse()];
      }
      if (frames.length > 0) {
        const clipName = sanitizeInteropId(tag.name, 'idle', 24);
        clips.push({
          name: clipName,
          frames,
          fps: 8,
          loop: true,
        });
      }
    }
  }

  if (clips.length === 0) {
    clips.push({
      name: 'idle',
      frames: result.customSprites.map((s) => s.id),
      fps: 8,
      loop: true,
    });
  }

  const transitions: AnimationTransitionDef[] = [];
  const idleClip = clips.find((c) => c.name === 'idle' || c.name.includes('idle')) ?? clips[0];
  const moveClip = clips.find((c) => c.name === 'walk' || c.name === 'run' || c.name.includes('walk') || c.name.includes('run'));
  const atkClip = clips.find((c) => c.name === 'attack' || c.name.includes('attack') || c.name.includes('slash'));
  if (idleClip && moveClip && idleClip.name !== moveClip.name) {
    transitions.push(
      { from: idleClip.name, to: moveClip.name, param: 'speed', op: 'gt', value: 10, priority: 1 },
      { from: moveClip.name, to: idleClip.name, param: 'speed', op: 'lte', value: 10, priority: 1 },
    );
  }
  if (atkClip && idleClip && atkClip.name !== idleClip.name) {
    transitions.push(
      { from: '*', to: atkClip.name, param: 'attacking', op: 'gt', value: 0.5, priority: 5 },
      { from: atkClip.name, to: idleClip.name, param: 'attacking', op: 'lte', value: 0.5, priority: 4 },
    );
  }

  return {
    id: animId,
    initialState: idleClip.name,
    clips,
    transitions,
  };
}

/**
 * Converts a parsed `InteropImportResult` into an atomic array of transactional `EcsStudioCommand`s.
 * Designed to be executed via `EcsStudioSession.dispatchBatch(...)` for single-step Undo/Redo.
 */
export function buildInteropStudioCommands(
  result: InteropImportResult,
  currentProject: EcsProjectV2,
  opts: InteropCommitOptions,
): EcsStudioCommand[] {
  const cmds: EcsStudioCommand[] = [];

  // 1. Register all imported custom pixel sprites first
  for (const sprite of result.customSprites) {
    cmds.push({ type: 'upsert_custom_sprite', sprite });
  }

  const hasRooms = result.rooms.length > 0;
  const wallExtrudeOverride =
    typeof opts.wallExtrudeH === 'number' && Number.isFinite(opts.wallExtrudeH)
      ? Math.max(8, Math.min(48, Math.round(opts.wallExtrudeH)))
      : undefined;

  // 2. If importing standalone sprites (e.g. Aseprite) without rooms, auto-wire AnimationStateMachine + Prefab & TileDef
  if (!hasRooms && result.customSprites.length > 0) {
    const primary = result.customSprites[0];
    const autoAnim = buildAnimationFromInteropResult(result);
    if (autoAnim) {
      cmds.push({ type: 'upsert_animation', animation: autoAnim });
    }
    if (opts.createPrefabFromSprite) {
      const prefabId = sanitizeInteropId(`prefab_${primary.id}`, 'prefab_ext');
      if (currentProject.prefabs[prefabId]) {
        cmds.push({ type: 'delete_prefab', prefabId, mode: 'unlink' });
      }
      cmds.push({
        type: 'create_prefab',
        prefab: {
          id: prefabId,
          name: primary.name ?? primary.id,
          category: 'imported',
          components: {
            tag: 'prop',
            transform: { x: 0, y: 0, w: Math.max(16, Math.min(64, primary.width)), h: Math.max(16, Math.min(64, primary.height)) },
            sprite: {
              sprite: primary.id,
              tint: '#ffffff',
              castShadow: true,
              roughness: 0.55,
              metallic: 0.15,
            },
            ...(autoAnim ? { animatorId: autoAnim.id } : {}),
          },
        },
      });
    }
    if (opts.createTileFromSprite) {
      if (!currentProject.worldMap) {
        cmds.push({ type: 'ensure_world_map', cols: 22, rows: 14, roomName: '主場景' });
      }
      const nextTileId = pickNextCustomTileId(currentProject);
      const layer = opts.createTileFromSprite.layer;
      cmds.push({
        type: 'upsert_tile_def',
        tileDef: {
          id: nextTileId,
          name: primary.name ?? primary.id,
          layer,
          sprite: primary.id,
          solid: opts.createTileFromSprite.solid,
          ...(layer === 'wall' ? { extrudeH: wallExtrudeOverride ?? 24, wallMaterial: 'stone' as const } : {}),
          roughness: 0.62,
          metallic: 0.14,
        },
      });
    }
    return cmds;
  }

  // 3. Ensure WorldMap exists when importing rooms or tiles
  if (hasRooms || result.tileDefs.length > 0) {
    if (!currentProject.worldMap) {
      const firstRoom = result.rooms[0];
      cmds.push({
        type: 'ensure_world_map',
        cols: firstRoom?.cols ?? 22,
        rows: firstRoom?.rows ?? 14,
        roomName: firstRoom?.name ?? '主場景',
      });
    }
  }

  // 4. Upsert all tile definitions (applying optional wallExtrudeH override)
  for (const td of result.tileDefs) {
    const adjusted: EcsTileDef =
      wallExtrudeOverride !== undefined && td.layer === 'wall'
        ? { ...td, extrudeH: wallExtrudeOverride }
        : td;
    cmds.push({ type: 'upsert_tile_def', tileDef: adjusted });
  }

  // 5. Upsert rooms (apply wallExtrudeH override if specified)
  const importedRoomIds = new Set<string>();
  for (const room of result.rooms) {
    importedRoomIds.add(room.id);
    const adjustedRoom: EcsMapRoomDef =
      wallExtrudeOverride !== undefined
        ? { ...room, wallExtrudeH: wallExtrudeOverride }
        : room;
    cmds.push({ type: 'upsert_room', room: adjustedRoom });
  }

  // 6. Configure WorldMap startRoomId / tileSize / heroConfig before pruning old rooms
  if (hasRooms) {
    cmds.push({
      type: 'set_world_map_config',
      startRoomId: result.rooms[0].id,
      tileSize: result.tileSize || 32,
      ...(result.heroConfig ? { heroConfig: result.heroConfig } : {}),
    });
  }

  // 7. If replaceWorldMap is enabled, clean up old rooms, portals, and entities cleanly
  const removedEntityIds = new Set<string>();
  if (opts.replaceWorldMap && hasRooms) {
    if (currentProject.worldMap) {
      for (const oldPortal of currentProject.worldMap.portals) {
        cmds.push({ type: 'remove_portal', portalId: oldPortal.id });
      }
      for (const oldRoom of currentProject.worldMap.rooms) {
        if (!importedRoomIds.has(oldRoom.id)) {
          cmds.push({ type: 'delete_room', roomId: oldRoom.id });
        }
      }
    }
    for (const oldEnt of currentProject.entities) {
      cmds.push({ type: 'remove_entity', entityId: oldEnt.id });
      removedEntityIds.add(oldEnt.id);
    }
  }

  // 8. Upsert portals
  for (const portal of result.portals) {
    cmds.push({ type: 'upsert_portal', portal });
  }

  // 9. Upsert prefabs (delete existing with same ID first to guarantee idempotent batch)
  const existingPrefabIds = new Set(Object.keys(currentProject.prefabs));
  for (const prefab of result.prefabs) {
    if (existingPrefabIds.has(prefab.id)) {
      cmds.push({ type: 'delete_prefab', prefabId: prefab.id, mode: 'unlink' });
    }
    cmds.push({ type: 'create_prefab', prefab });
    existingPrefabIds.add(prefab.id);
  }

  // 10. Spawn entities (avoid duplicate entity IDs in append mode)
  const activeEntityIds = new Set(
    currentProject.entities.filter((e) => !removedEntityIds.has(e.id)).map((e) => e.id),
  );
  for (const ent of result.entities) {
    let finalEnt = ent;
    if (activeEntityIds.has(ent.id)) {
      let suffix = 2;
      let candidate = `${ent.id}_${suffix}`;
      while (activeEntityIds.has(candidate)) {
        suffix++;
        candidate = `${ent.id}_${suffix}`;
      }
      finalEnt = { ...ent, id: candidate };
    }
    activeEntityIds.add(finalEnt.id);
    cmds.push({ type: 'spawn_entity', entity: finalEnt });
  }

  // 11. Upsert interactions, AI profiles, and initial globals
  if (result.interactions) {
    for (const rule of result.interactions) {
      cmds.push({ type: 'upsert_interaction_rule', rule });
    }
  }
  if (result.aiProfiles) {
    for (const [tag, profile] of Object.entries(result.aiProfiles)) {
      cmds.push({ type: 'upsert_ai_profile', tag, profile });
    }
  }
  if (result.globals) {
    for (const [key, value] of Object.entries(result.globals)) {
      cmds.push({ type: 'set_global', key, value });
    }
  }

  return cmds;
}
