import {
  getEntityPrefabId,
  resolveEntityComponents,
  type EcsComponentBundle,
  type EcsComponentOverrides,
  type EcsEntityInitDef,
  type EcsProjectV2,
  type EcsSpatial3DComponent,
  type EcsTransformComponent,
} from './EcsProjectSchema.ts';
import { getCastleTileDef, type EcsMapRoomDef } from './EcsTilemapTypes.ts';
import { RoomVoxelVolume } from './EcsVoxelVolume.ts';

export interface EcsCommandResult {
  ok: boolean;
  revision: number;
  summary: string;
  errors: string[];
  createdEntityId?: string;
  createdPrefabId?: string;
  createdSpriteId?: string;
  createdEntityIds?: string[];
  createdPrefabIds?: string[];
  createdSpriteIds?: string[];
}

export interface EcsCommandHandlerOutcome {
  ok: boolean;
  summary: string;
  errors: string[];
  skipValidationAndCommit?: boolean;
  createdEntityId?: string;
  createdEntityIds?: string[];
  createdPrefabId?: string;
  createdSpriteId?: string;
}

export function okOutcome(
  summary: string,
  extra?: Partial<
    Pick<
      EcsCommandHandlerOutcome,
      'skipValidationAndCommit' | 'createdEntityId' | 'createdEntityIds' | 'createdPrefabId' | 'createdSpriteId'
    >
  >,
): EcsCommandHandlerOutcome {
  return { ok: true, summary, errors: [], ...extra };
}

export function failOutcome(summary: string, error: string): EcsCommandHandlerOutcome {
  return { ok: false, summary, errors: [error] };
}

export function mergeOverridesIntoTarget(
  target: Record<string, unknown>,
  patch: EcsComponentOverrides,
  isSparse: boolean,
): void {
  const objectKeys = [
    'transform',
    'body2d',
    'sprite',
    'health',
    'light',
    'collider',
    'pathFollower',
    'rhythmLane',
    'characterMotor2d',
    'grappleAnchor',
    'triggerZone',
    'verletChain',
    'spatial3d',
    'mesh3d',
  ] as const;

  for (const key of objectKeys) {
    const patchVal = patch[key];
    if (!patchVal) continue;
    const prevVal = target[key] as Record<string, unknown> | undefined;
    if (isSparse) {
      target[key] = { ...(prevVal ?? {}), ...patchVal };
    } else {
      let defaults: Record<string, unknown> = {};
      if (key === 'transform') defaults = { x: 0, y: 0 };
      else if (key === 'sprite') defaults = { sprite: 'solid' };
      else if (key === 'health') defaults = { hp: 3, team: 1 };
      else if (key === 'light') defaults = { radius: 48, color: '#ffd447' };
      else if (key === 'collider') defaults = { radius: 12 };
      else if (key === 'pathFollower') defaults = { pathId: '', speed: 48 };
      else if (key === 'rhythmLane') defaults = { lane: 0, judgeX: 112 };
      else if (key === 'mesh3d') defaults = { modelId: '' };
      target[key] = { ...defaults, ...(prevVal ?? {}), ...patchVal };
    }
  }

  if (patch.animatorId !== undefined) target.animatorId = patch.animatorId;
  if (patch.lifetime !== undefined) target.lifetime = patch.lifetime;
  if (patch.vars !== undefined) target.vars = [...patch.vars];
  if (patch.scripts !== undefined) target.scripts = [...patch.scripts];
  if (patch.tag !== undefined) target.tag = patch.tag;
}

export interface DuplicateEntitiesInput {
  entityIds: string[];
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
  targetRoomId?: string;
}

export interface TransformEntitiesInput {
  entityIds: string[];
  deltaX?: number;
  deltaY?: number;
  deltaZ?: number;
  deltaYaw?: number;
  scaleMult?: number;
  snapGrid?: number;
  snapStoryZ?: boolean;
}

export type EcsAlignEntitiesMode =
  | 'align_x'
  | 'align_y'
  | 'align_z'
  | 'distribute_x'
  | 'distribute_y'
  | 'snap_floor';

export interface AlignEntitiesInput {
  entityIds: string[];
  mode: EcsAlignEntitiesMode;
}

function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function clampScale(value: number): number {
  const clamped = Math.max(0.1, Math.min(8, value));
  return Math.round(clamped * 10000) / 10000;
}

function normalizeYawDeg(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  const rounded = Math.round(wrapped * 1000) / 1000;
  return rounded === 360 || rounded === 0 ? 0 : rounded;
}

function round2(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

function collectOrderedEntities(next: EcsProjectV2, entityIds: readonly string[]): EcsEntityInitDef[] {
  if (!Array.isArray(entityIds) || entityIds.length === 0) return [];
  const byId = new Map<string, EcsEntityInitDef>();
  for (let i = 0; i < next.entities.length; i++) {
    byId.set(next.entities[i].id, next.entities[i]);
  }
  const seen = new Set<string>();
  const out: EcsEntityInitDef[] = [];
  for (let i = 0; i < entityIds.length; i++) {
    const id = entityIds[i];
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const ent = byId.get(id);
    if (ent) out.push(ent);
  }
  return out;
}

function applyEntityPatch(next: EcsProjectV2, ent: EcsEntityInitDef, patch: EcsComponentOverrides): void {
  const pid = getEntityPrefabId(ent);
  if (pid && next.prefabs[pid]) {
    ent.overrides = ent.overrides ?? {};
    mergeOverridesIntoTarget(ent.overrides as Record<string, unknown>, patch, true);
    if (ent.detachedComponents && ent.detachedComponents.length > 0) {
      const patchedKeys = new Set(Object.keys(patch));
      ent.detachedComponents = ent.detachedComponents.filter((k) => !patchedKeys.has(k));
      if (ent.detachedComponents.length === 0) delete ent.detachedComponents;
    }
    return;
  }

  if (ent.overrides) {
    const overRec = ent.overrides as Record<string, unknown>;
    const compRec = ent.components as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      const prevOver = overRec[key];
      if (prevOver !== undefined) {
        if (typeof prevOver === 'object' && prevOver !== null && !Array.isArray(prevOver)) {
          const curComp = compRec[key] as Record<string, unknown> | undefined;
          compRec[key] = { ...(prevOver as Record<string, unknown>), ...(curComp ?? {}) };
        }
        delete overRec[key];
      }
    }
    if (Object.keys(overRec).length === 0) delete ent.overrides;
  }

  mergeOverridesIntoTarget(ent.components as Record<string, unknown>, patch, false);
}

function resolveEntityRoom(project: EcsProjectV2, roomId?: string): EcsMapRoomDef | null {
  const wm = project.worldMap;
  if (!wm || wm.rooms.length === 0) return null;
  if (roomId) {
    const exact = wm.rooms.find((r) => r.id === roomId);
    if (exact) return exact;
  }
  return wm.rooms.find((r) => r.id === wm.startRoomId) ?? wm.rooms[0] ?? null;
}

function getRoomStoryHeight(project: EcsProjectV2, roomId?: string): number {
  const room = resolveEntityRoom(project, roomId);
  const raw = room?.storyHeight ?? room?.wallExtrudeH ?? 24;
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

function compileRoomVoxelVolume(project: EcsProjectV2, room: EcsMapRoomDef): RoomVoxelVolume {
  const wm = project.worldMap!;
  const storyH = room.storyHeight ?? room.wallExtrudeH ?? 24;
  const tileDefs = wm.tileDefs;
  const globals = project.globals;
  const vol = new RoomVoxelVolume();
  vol.compileFromRoom(room.cols, room.rows, wm.tileSize, storyH, room.voxels, room.wall, (tileId) => {
    const def = getCastleTileDef(tileId, tileDefs);
    if (!def || !def.solid) return false;
    if (def.unlockGlobal && (globals[def.unlockGlobal] ?? 0) >= 1) return false;
    return true;
  });
  return vol;
}

function sampleSupportZAtPoint(
  vol: RoomVoxelVolume,
  worldX: number,
  worldY: number,
  curZ: number,
  stepHeight: number,
  rangeScratch: [number, number],
): number {
  if (vol.cols <= 0 || vol.rows <= 0) return 0;
  const ts = vol.tileSize;
  const col = Math.floor(worldX / ts);
  const row = Math.floor(worldY / ts);
  if (col < 0 || col >= vol.cols || row < 0 || row >= vol.rows) return 0;

  const lx = (worldX - col * ts) / ts;
  const ly = (worldY - row * ts) / ts;
  let probeZ = Math.max(0, curZ);
  let lifted = false;

  for (let z = 0; z < vol.stories; z++) {
    if (!vol.getCellSurfaceRange(col, row, z, lx, ly, rangeScratch)) continue;
    const botZ = rangeScratch[0];
    const topZ = rangeScratch[1];
    if (botZ <= probeZ + 0.01 && topZ > probeZ) {
      probeZ = topZ;
      lifted = true;
    }
  }
  if (lifted) return probeZ;

  return vol.sampleSupportZ(worldX, worldY, probeZ, stepHeight);
}

/**
 * Samples the exact voxel support surface height around an entity's horizontal footprint.
 */
export function sampleSupportZAt(
  vol: RoomVoxelVolume,
  x: number,
  y: number,
  w: number,
  h: number,
  curZ: number,
  stepHeight = 10,
): number {
  const safeW = Math.max(2, w);
  const safeH = Math.max(2, h);
  const footCx = x + safeW * 0.5;
  const footCy = y + safeH * 0.72;
  const padX = Math.min(safeW * 0.24, Math.max(1, safeW * 0.24));
  const left = Math.min(footCx, x + padX);
  const right = Math.max(footCx, x + safeW - padX);
  const top = Math.min(footCy, y + safeH * 0.48);
  const bot = Math.max(footCy, y + safeH - Math.min(3, safeH * 0.2));
  const scratch: [number, number] = [0, 0];

  const sC = sampleSupportZAtPoint(vol, footCx, footCy, curZ, stepHeight, scratch);
  const sLT = sampleSupportZAtPoint(vol, left, top, curZ, stepHeight, scratch);
  const sRT = sampleSupportZAtPoint(vol, right, top, curZ, stepHeight, scratch);
  const sRB = sampleSupportZAtPoint(vol, right, bot, curZ, stepHeight, scratch);
  const sLB = sampleSupportZAtPoint(vol, left, bot, curZ, stepHeight, scratch);
  return round2(Math.max(0, sC, sLT, sRT, sRB, sLB));
}

export function executeDuplicateEntities(
  next: EcsProjectV2,
  cmd: DuplicateEntitiesInput,
): EcsCommandHandlerOutcome {
  const sources = collectOrderedEntities(next, cmd.entityIds);
  if (sources.length === 0) {
    return failOutcome('找不到要複製的實體', 'No matching entities found to duplicate');
  }

  const hasAnyOffset =
    cmd.offsetX !== undefined || cmd.offsetY !== undefined || cmd.offsetZ !== undefined;
  const dx =
    typeof cmd.offsetX === 'number' && Number.isFinite(cmd.offsetX)
      ? cmd.offsetX
      : hasAnyOffset
        ? 0
        : 16;
  const dy = typeof cmd.offsetY === 'number' && Number.isFinite(cmd.offsetY) ? cmd.offsetY : 0;
  const dz = typeof cmd.offsetZ === 'number' && Number.isFinite(cmd.offsetZ) ? cmd.offsetZ : 0;
  const targetRoom =
    typeof cmd.targetRoomId === 'string' && cmd.targetRoomId.trim().length > 0
      ? cmd.targetRoomId.trim()
      : undefined;

  const usedIds = new Set<string>(next.entities.map((e) => e.id));
  const createdEntityIds: string[] = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const clone = deepClone(src);

    let seq = 1;
    let nextId = `${src.id}_copy_${seq}`;
    while (usedIds.has(nextId)) {
      seq++;
      nextId = `${src.id}_copy_${seq}`;
    }
    usedIds.add(nextId);
    clone.id = nextId;
    clone.name = seq === 1 ? `${src.name} (Copy)` : `${src.name} (Copy ${seq})`;
    if (targetRoom !== undefined) {
      clone.roomId = targetRoom;
    }

    const resolved = resolveEntityComponents(clone, next.prefabs);
    const patch: EcsComponentOverrides = {};
    if (dx !== 0 || dy !== 0) {
      patch.transform = {
        x: resolved.transform.x + dx,
        y: resolved.transform.y + dy,
      };
    }
    if (dz !== 0) {
      patch.spatial3d = {
        z: Math.max(0, (resolved.spatial3d?.z ?? 0) + dz),
      };
    }
    if (Object.keys(patch).length > 0) {
      applyEntityPatch(next, clone, patch);
    }

    next.entities.push(clone);
    createdEntityIds.push(nextId);
  }

  return okOutcome(`複製 ${createdEntityIds.length} 個實體`, {
    createdEntityId: createdEntityIds[0],
    createdEntityIds,
  });
}

export function executeTransformEntities(
  next: EcsProjectV2,
  cmd: TransformEntitiesInput,
): EcsCommandHandlerOutcome {
  const targets = collectOrderedEntities(next, cmd.entityIds);
  if (targets.length === 0) {
    return failOutcome('找不到要變換的實體', 'No matching entities found to transform');
  }

  const hasDx = typeof cmd.deltaX === 'number' && Number.isFinite(cmd.deltaX);
  const hasDy = typeof cmd.deltaY === 'number' && Number.isFinite(cmd.deltaY);
  const hasSnapGrid = typeof cmd.snapGrid === 'number' && Number.isFinite(cmd.snapGrid) && cmd.snapGrid > 0;
  const hasDz = typeof cmd.deltaZ === 'number' && Number.isFinite(cmd.deltaZ);
  const hasSnapStoryZ = cmd.snapStoryZ === true;
  const hasYaw = typeof cmd.deltaYaw === 'number' && Number.isFinite(cmd.deltaYaw);
  const hasScale = typeof cmd.scaleMult === 'number' && Number.isFinite(cmd.scaleMult) && cmd.scaleMult > 0;

  if (!hasDx && !hasDy && !hasSnapGrid && !hasDz && !hasSnapStoryZ && !hasYaw && !hasScale) {
    return okOutcome('無變換變更', { skipValidationAndCommit: true });
  }

  for (let i = 0; i < targets.length; i++) {
    const ent = targets[i];
    const resolved = resolveEntityComponents(ent, next.prefabs);
    const patch: EcsComponentOverrides = {};
    const trPatch: Partial<EcsTransformComponent> = {};

    if (hasDx || hasDy || hasSnapGrid) {
      let nx = resolved.transform.x + (hasDx ? (cmd.deltaX as number) : 0);
      let ny = resolved.transform.y + (hasDy ? (cmd.deltaY as number) : 0);
      if (hasSnapGrid) {
        const g = cmd.snapGrid as number;
        nx = Math.round(nx / g) * g;
        ny = Math.round(ny / g) * g;
      }
      trPatch.x = nx;
      trPatch.y = ny;
    }

    if (hasScale) {
      const mult = cmd.scaleMult as number;
      trPatch.scaleX = clampScale((resolved.transform.scaleX ?? 1) * mult);
      trPatch.scaleY = clampScale((resolved.transform.scaleY ?? 1) * mult);
      if (resolved.mesh3d) {
        patch.mesh3d = {
          scaleX: clampScale((resolved.mesh3d.scaleX ?? 1) * mult),
          scaleY: clampScale((resolved.mesh3d.scaleY ?? 1) * mult),
          scaleZ: clampScale((resolved.mesh3d.scaleZ ?? 1) * mult),
        };
      }
    }

    if (Object.keys(trPatch).length > 0) {
      patch.transform = trPatch;
    }

    const spPatch: Partial<EcsSpatial3DComponent> = {};
    if (hasDz || hasSnapStoryZ) {
      let nz = Math.max(0, (resolved.spatial3d?.z ?? 0) + (hasDz ? (cmd.deltaZ as number) : 0));
      if (hasSnapStoryZ) {
        const storyH = getRoomStoryHeight(next, ent.roomId);
        nz = Math.max(0, Math.round(nz / storyH) * storyH);
      }
      spPatch.z = round2(nz);
    }

    if (hasYaw) {
      spPatch.yaw = normalizeYawDeg((resolved.spatial3d?.yaw ?? 0) + (cmd.deltaYaw as number));
    }

    if (Object.keys(spPatch).length > 0) {
      patch.spatial3d = spPatch;
    }

    if (Object.keys(patch).length > 0) {
      applyEntityPatch(next, ent, patch);
    }
  }

  return okOutcome(`批次變換 ${targets.length} 個實體`);
}

export function executeAlignEntities(
  next: EcsProjectV2,
  cmd: AlignEntitiesInput,
): EcsCommandHandlerOutcome {
  const ordered = collectOrderedEntities(next, cmd.entityIds);
  const targets: Array<{ ent: EcsEntityInitDef; resolved: EcsComponentBundle; order: number }> = ordered.map(
    (ent, order) => ({
      ent,
      resolved: resolveEntityComponents(ent, next.prefabs),
      order,
    }),
  );

  switch (cmd.mode) {
    case 'align_x':
    case 'align_y':
    case 'align_z': {
      if (targets.length < 2) {
        return failOutcome('對齊至少需要 2 個實體', `${cmd.mode} requires at least 2 valid entities`);
      }
      if (cmd.mode === 'align_x') {
        const refX = targets[0].resolved.transform.x;
        for (let i = 1; i < targets.length; i++) {
          applyEntityPatch(next, targets[i].ent, { transform: { x: refX } });
        }
      } else if (cmd.mode === 'align_y') {
        const refY = targets[0].resolved.transform.y;
        for (let i = 1; i < targets.length; i++) {
          applyEntityPatch(next, targets[i].ent, { transform: { y: refY } });
        }
      } else {
        const refZ = Math.max(0, targets[0].resolved.spatial3d?.z ?? 0);
        for (let i = 1; i < targets.length; i++) {
          applyEntityPatch(next, targets[i].ent, { spatial3d: { z: refZ } });
        }
      }
      return okOutcome(`對齊 ${targets.length} 個實體 (${cmd.mode})`);
    }

    case 'distribute_x':
    case 'distribute_y': {
      if (targets.length < 3) {
        return failOutcome('均分分布至少需要 3 個實體', `${cmd.mode} requires at least 3 valid entities`);
      }
      if (cmd.mode === 'distribute_x') {
        const sorted = [...targets].sort(
          (a, b) => a.resolved.transform.x - b.resolved.transform.x || a.order - b.order,
        );
        const minX = sorted[0].resolved.transform.x;
        const maxX = sorted[sorted.length - 1].resolved.transform.x;
        const step = (maxX - minX) / (sorted.length - 1);
        for (let i = 1; i < sorted.length - 1; i++) {
          applyEntityPatch(next, sorted[i].ent, { transform: { x: round2(minX + step * i) } });
        }
      } else {
        const sorted = [...targets].sort(
          (a, b) => a.resolved.transform.y - b.resolved.transform.y || a.order - b.order,
        );
        const minY = sorted[0].resolved.transform.y;
        const maxY = sorted[sorted.length - 1].resolved.transform.y;
        const step = (maxY - minY) / (sorted.length - 1);
        for (let i = 1; i < sorted.length - 1; i++) {
          applyEntityPatch(next, sorted[i].ent, { transform: { y: round2(minY + step * i) } });
        }
      }
      return okOutcome(`均分分布 ${targets.length} 個實體 (${cmd.mode})`);
    }

    case 'snap_floor': {
      if (targets.length < 1) {
        return failOutcome('貼地對齊至少需要 1 個實體', 'snap_floor requires at least 1 valid entity');
      }
      const volumeCache = new Map<string, RoomVoxelVolume>();
      const wm = next.worldMap;
      const defaultTs = wm?.tileSize ?? 32;

      for (let i = 0; i < targets.length; i++) {
        const { ent, resolved } = targets[i];
        let supportZ = 0;
        if (wm && wm.rooms.length > 0) {
          const room = resolveEntityRoom(next, ent.roomId);
          if (room) {
            let vol = volumeCache.get(room.id);
            if (!vol) {
              vol = compileRoomVoxelVolume(next, room);
              volumeCache.set(room.id, vol);
            }
            const curZ = Math.max(0, resolved.spatial3d?.z ?? 0);
            const stepHeight = resolved.spatial3d?.stepHeight ?? 10;
            supportZ = sampleSupportZAt(
              vol,
              resolved.transform.x,
              resolved.transform.y,
              resolved.transform.w ?? defaultTs,
              resolved.transform.h ?? defaultTs,
              curZ,
              stepHeight,
            );
          }
        }
        applyEntityPatch(next, ent, { spatial3d: { z: supportZ } });
      }
      return okOutcome(`貼地對齊 ${targets.length} 個實體`);
    }

    default:
      return failOutcome('未知對齊模式', `Unknown align mode: ${String(cmd.mode)}`);
  }
}
