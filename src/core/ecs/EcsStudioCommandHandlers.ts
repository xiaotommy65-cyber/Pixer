import { VIEWPORT_PRESETS, type ViewportPreset } from '../gpu/GpuTypes.ts';
import type { Camera3DProjectionMode } from '../math/Perspective3DMath.ts';
import type { AnimationStateMachineDef } from '../sim/AnimationStateMachine.ts';
import type { EcsEventGraphLayoutMap } from './EcsEventGraph.ts';
import { validateModel3DDef, type EcsModel3DDef } from './EcsModel3D.ts';
import {
  getEntityPrefabId,
  resolveEntityComponents,
  validateCustomSpriteDef,
  validateCutsceneDef,
  type EcsComponentBundle,
  type EcsComponentOverrides,
  type EcsCustomSpriteDef,
  type EcsCutsceneDef,
  type EcsEntityInitDef,
  type EcsHudGaugeDef,
  type EcsPrefabDef,
  type EcsProjectionConfig,
  type EcsProjectV2,
  type EcsScriptDef,
} from './EcsProjectSchema.ts';
import {
  createEmptyRoom,
  fillRoomBox3D,
  fillRoomRect,
  floodFillRoom,
  setRoomTile,
  setRoomVoxel,
  type EcsMapInteractionRule,
  type EcsMapLayerName,
  type EcsMapPortalDef,
  type EcsMapRoomDef,
  type EcsTileDef,
  type EcsTopDownAiProfile,
  type EcsTopDownHeroConfig,
  type EcsVoxelCellDef,
  type EcsVoxelShape,
} from './EcsTilemapTypes.ts';

export const ECS_ATTACHABLE_COMPONENTS = [
  'body2d',
  'sprite',
  'health',
  'light',
  'collider',
  'pathFollower',
  'lifetime',
  'rhythmLane',
  'characterMotor2d',
  'grappleAnchor',
  'triggerZone',
  'verletChain',
  'spatial3d',
  'mesh3d',
] as const;

export type EcsAttachableComponent = (typeof ECS_ATTACHABLE_COMPONENTS)[number];

export interface EcsAsciiLegendEntry {
  ground?: number;
  wall?: number;
  decor?: number;
  prefabId?: string;
  entityName?: string;
  entityIdPrefix?: string;
}

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
  createdPrefabId?: string;
  createdSpriteId?: string;
}

function okOutcome(
  summary: string,
  extra?: Partial<Pick<EcsCommandHandlerOutcome, 'skipValidationAndCommit' | 'createdEntityId' | 'createdPrefabId' | 'createdSpriteId'>>,
): EcsCommandHandlerOutcome {
  return { ok: true, summary, errors: [], ...extra };
}

function failOutcome(summary: string, error: string): EcsCommandHandlerOutcome {
  return { ok: false, summary, errors: [error] };
}

function findEntityOrFail(
  next: EcsProjectV2,
  entityId: string,
  notFoundSummary = '找不到實體',
): { ent: EcsEntityInitDef } | { fail: EcsCommandHandlerOutcome } {
  const ent = next.entities.find((e) => e.id === entityId);
  return ent ? { ent } : { fail: failOutcome(notFoundSummary, `Entity not found: ${entityId}`) };
}

function findRoomOrFail(
  next: EcsProjectV2,
  roomId: string,
): { room: EcsMapRoomDef } | { fail: EcsCommandHandlerOutcome } {
  const room = next.worldMap?.rooms.find((r) => r.id === roomId);
  return room ? { room } : { fail: failOutcome('找不到房間', `Room not found: ${roomId}`) };
}

function requireWorldMap(next: EcsProjectV2): { wm: NonNullable<EcsProjectV2['worldMap']> } | { fail: EcsCommandHandlerOutcome } {
  return next.worldMap ? { wm: next.worldMap } : { fail: failOutcome('尚未建立地圖', 'No worldMap') };
}

const DEFAULT_HD2D_PROJECTION: EcsProjectionConfig = {
  mode: 'hd2d_3d',
  elevationScale: 1.0,
  pitchDeg: 42,
  fovDeg: 38,
  wallHeightScale: 1.25,
  billboardTiltDeg: 12,
  obliqueShadowAlpha: 0.42,
  activeDimensionMask: 3,
  inactiveDimAlpha: 0.16,
  allowDimensionShift: false,
};

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

export function handleSetViewport(
  next: EcsProjectV2,
  preset?: ViewportPreset,
  width?: number,
  height?: number,
): EcsCommandHandlerOutcome {
  if (preset && VIEWPORT_PRESETS[preset]) {
    const vp = VIEWPORT_PRESETS[preset];
    next.viewport = { preset, width: vp.width, height: vp.height };
    return okOutcome(`解析度切換至 ${vp.width}×${vp.height} (${preset})`);
  }
  if (width && height) {
    next.viewport = { width, height };
    return okOutcome(`解析度切換至 ${width}×${height}`);
  }
  return failOutcome('缺少解析度參數', 'Invalid viewport command');
}

export function handleSpawnEntity(next: EcsProjectV2, entity: EcsEntityInitDef): EcsCommandHandlerOutcome {
  if (next.entities.some((e) => e.id === entity.id)) {
    return failOutcome('實體 ID 重複', `Duplicate entity id: ${entity.id}`);
  }
  next.entities.push(entity);
  return okOutcome(`新增實體「${entity.name}」`, { createdEntityId: entity.id });
}

export function handleRemoveEntity(next: EcsProjectV2, entityId: string): EcsCommandHandlerOutcome {
  const idx = next.entities.findIndex((e) => e.id === entityId);
  if (idx < 0) return failOutcome('找不到實體', `Entity not found: ${entityId}`);
  const [removed] = next.entities.splice(idx, 1);
  return okOutcome(`移除實體「${removed.name}」`);
}

export function handlePatchEntity(next: EcsProjectV2, entityId: string, patch: EcsComponentOverrides): EcsCommandHandlerOutcome {
  const found = findEntityOrFail(next, entityId);
  if ('fail' in found) return found.fail;
  const { ent } = found;
  const pid = getEntityPrefabId(ent);
  if (pid && next.prefabs[pid]) {
    ent.overrides = ent.overrides ?? {};
    mergeOverridesIntoTarget(ent.overrides as Record<string, unknown>, patch, true);
    if (ent.detachedComponents && ent.detachedComponents.length > 0) {
      const patchedKeys = new Set(Object.keys(patch));
      ent.detachedComponents = ent.detachedComponents.filter((k) => !patchedKeys.has(k));
      if (ent.detachedComponents.length === 0) delete ent.detachedComponents;
    }
  } else {
    mergeOverridesIntoTarget(ent.components as Record<string, unknown>, patch, false);
  }
  return okOutcome(`更新實體「${ent.name}」元件屬性`);
}

export function handleAttachComponent(
  next: EcsProjectV2,
  entityId: string,
  component: EcsAttachableComponent,
  value: unknown,
): EcsCommandHandlerOutcome {
  const found = findEntityOrFail(next, entityId);
  if ('fail' in found) return found.fail;
  const { ent } = found;
  const pid = getEntityPrefabId(ent);
  if (pid && next.prefabs[pid]) {
    ent.overrides = ent.overrides ?? {};
    (ent.overrides as Record<string, unknown>)[component] = value;
    if (ent.detachedComponents) {
      ent.detachedComponents = ent.detachedComponents.filter((k) => k !== component);
      if (ent.detachedComponents.length === 0) delete ent.detachedComponents;
    }
  } else {
    (ent.components as Record<string, unknown>)[component] = value;
  }
  return okOutcome(`為「${ent.name}」掛載元件 ${component}`);
}

export function handleDetachComponent(next: EcsProjectV2, entityId: string, component: EcsAttachableComponent): EcsCommandHandlerOutcome {
  const found = findEntityOrFail(next, entityId);
  if ('fail' in found) return found.fail;
  const { ent } = found;
  const pid = getEntityPrefabId(ent);
  delete (ent.components as Record<string, unknown>)[component];
  if (ent.overrides) delete (ent.overrides as Record<string, unknown>)[component];
  if (pid && next.prefabs[pid]) {
    const baseHas = (next.prefabs[pid].components as unknown as Record<string, unknown>)[component] !== undefined;
    if (baseHas) {
      ent.detachedComponents = ent.detachedComponents ?? [];
      if (!ent.detachedComponents.includes(component)) ent.detachedComponents.push(component);
    }
  }
  return okOutcome(`已從「${ent.name}」移除元件 ${component}`);
}

export function handleCreatePrefab(next: EcsProjectV2, prefab: EcsPrefabDef): EcsCommandHandlerOutcome {
  const cleanId = prefab.id.trim();
  if (!cleanId) return failOutcome('Prefab ID 不可為空', 'Prefab id is required');
  if (next.prefabs[cleanId]) return failOutcome('Prefab ID 重複', `Duplicate prefab id: ${cleanId}`);
  next.prefabs[cleanId] = {
    ...JSON.parse(JSON.stringify(prefab)),
    id: cleanId,
    name: prefab.name.trim() || cleanId,
  } as EcsPrefabDef;
  return okOutcome(`建立 Prefab 模板「${next.prefabs[cleanId].name}」`, { createdPrefabId: cleanId });
}

export function handleUpdatePrefab(
  next: EcsProjectV2,
  cmd: {
    prefabId: string;
    name?: string;
    category?: string;
    patch?: EcsComponentOverrides;
    attachComponent?: { component: EcsAttachableComponent; value: unknown };
    detachComponent?: EcsAttachableComponent;
  },
): EcsCommandHandlerOutcome {
  const pref = next.prefabs[cmd.prefabId];
  if (!pref) return failOutcome('找不到 Prefab', `Prefab not found: ${cmd.prefabId}`);
  if (cmd.name !== undefined && cmd.name.trim()) pref.name = cmd.name.trim();
  if (cmd.category !== undefined) pref.category = cmd.category.trim();
  if (cmd.patch) mergeOverridesIntoTarget(pref.components as unknown as Record<string, unknown>, cmd.patch, false);
  if (cmd.attachComponent) {
    (pref.components as unknown as Record<string, unknown>)[cmd.attachComponent.component] = cmd.attachComponent.value;
  }
  if (cmd.detachComponent) delete (pref.components as unknown as Record<string, unknown>)[cmd.detachComponent];
  return okOutcome(`更新 Prefab 模板「${pref.name}」`);
}

export function handleDeletePrefab(next: EcsProjectV2, prefabId: string, mode?: 'unlink' | 'remove_instances'): EcsCommandHandlerOutcome {
  const pref = next.prefabs[prefabId];
  if (!pref) return failOutcome('找不到 Prefab', `Prefab not found: ${prefabId}`);
  if ((mode ?? 'unlink') === 'remove_instances') {
    next.entities = next.entities.filter((e) => getEntityPrefabId(e) !== prefabId);
  } else {
    for (let i = 0; i < next.entities.length; i++) {
      const e = next.entities[i];
      if (getEntityPrefabId(e) !== prefabId) continue;
      e.components = resolveEntityComponents(e, next.prefabs);
      delete e.prefabId;
      delete e.prefab;
      delete e.overrides;
      delete e.detachedComponents;
    }
  }
  delete next.prefabs[prefabId];
  return okOutcome(`刪除 Prefab 模板「${pref.name}」`);
}

export function handleSaveEntityAsPrefab(
  next: EcsProjectV2,
  cmd: { entityId: string; prefabId: string; name?: string; category?: string; linkSourceEntity?: boolean },
): EcsCommandHandlerOutcome {
  const found = findEntityOrFail(next, cmd.entityId, '找不到來源實體');
  if ('fail' in found) return found.fail;
  const { ent } = found;
  const cleanId = cmd.prefabId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleanId) return failOutcome('Prefab ID 無效', 'Invalid prefab id');
  if (next.prefabs[cleanId]) return failOutcome('Prefab ID 已存在', `Duplicate prefab id: ${cleanId}`);
  const resolved = resolveEntityComponents(ent, next.prefabs);
  const prefName = cmd.name?.trim() || `${ent.name} 模板`;
  next.prefabs[cleanId] = {
    id: cleanId,
    name: prefName,
    category: cmd.category ?? (resolved.tag || 'custom'),
    components: JSON.parse(JSON.stringify(resolved)) as EcsComponentBundle,
  };
  if (cmd.linkSourceEntity !== false) {
    ent.prefabId = cleanId;
    delete ent.prefab;
    ent.components = {};
    ent.overrides = { transform: { x: resolved.transform.x, y: resolved.transform.y } };
    delete ent.detachedComponents;
  }
  return okOutcome(`將「${ent.name}」存為 Prefab「${prefName}」`, { createdPrefabId: cleanId });
}

export function handleInstantiatePrefab(
  next: EcsProjectV2,
  cmd: {
    prefabId: string;
    entityId?: string;
    name?: string;
    x?: number;
    y?: number;
    z?: number;
    roomId?: string;
    overrides?: EcsComponentOverrides;
  },
): EcsCommandHandlerOutcome {
  const pref = next.prefabs[cmd.prefabId];
  if (!pref) return failOutcome('找不到 Prefab', `Prefab not found: ${cmd.prefabId}`);
  let seq = next.entities.filter((e) => getEntityPrefabId(e) === cmd.prefabId).length + 1;
  let entId = cmd.entityId?.trim() || `${cmd.prefabId}_inst_${seq}`;
  while (next.entities.some((e) => e.id === entId)) {
    seq++;
    entId = `${cmd.prefabId}_inst_${seq}`;
  }
  const entName = cmd.name?.trim() || `${pref.name} #${seq}`;
  const overrides: EcsComponentOverrides = cmd.overrides ? JSON.parse(JSON.stringify(cmd.overrides)) : {};
  if (cmd.x !== undefined || cmd.y !== undefined) {
    overrides.transform = {
      ...(overrides.transform ?? {}),
      ...(cmd.x !== undefined ? { x: cmd.x } : {}),
      ...(cmd.y !== undefined ? { y: cmd.y } : {}),
    };
  }
  if (cmd.z !== undefined && Number.isFinite(cmd.z)) {
    overrides.spatial3d = { ...(overrides.spatial3d ?? {}), z: cmd.z };
  }
  next.entities.push({
    id: entId,
    name: entName,
    prefabId: cmd.prefabId,
    ...(cmd.roomId ? { roomId: cmd.roomId } : {}),
    components: {},
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  });
  return okOutcome(`從 Prefab「${pref.name}」實例化「${entName}」`, { createdEntityId: entId });
}

export function handleRevertPrefabOverrides(next: EcsProjectV2, entityId: string, keepPosition?: boolean): EcsCommandHandlerOutcome {
  const found = findEntityOrFail(next, entityId);
  if ('fail' in found) return found.fail;
  const { ent } = found;
  const pid = getEntityPrefabId(ent);
  if (!pid || !next.prefabs[pid]) {
    return failOutcome('此實體未連結 Prefab', 'Entity is not linked to a Prefab');
  }
  const resolved = resolveEntityComponents(ent, next.prefabs);
  ent.components = {};
  delete ent.detachedComponents;
  if (keepPosition !== false) {
    ent.overrides = { transform: { x: resolved.transform.x, y: resolved.transform.y } };
  } else {
    delete ent.overrides;
  }
  return okOutcome(`已重置「${ent.name}」的 Prefab 覆寫`);
}

export function handleUnlinkPrefab(next: EcsProjectV2, entityId: string): EcsCommandHandlerOutcome {
  const found = findEntityOrFail(next, entityId);
  if ('fail' in found) return found.fail;
  const { ent } = found;
  if (!getEntityPrefabId(ent)) return failOutcome('此實體未連結 Prefab', 'Entity has no Prefab link');
  ent.components = resolveEntityComponents(ent, next.prefabs);
  delete ent.prefabId;
  delete ent.prefab;
  delete ent.overrides;
  delete ent.detachedComponents;
  return okOutcome(`已將「${ent.name}」與 Prefab 斷開連結`);
}

export function handleUpsertScript(next: EcsProjectV2, script: EcsScriptDef, graphLayout?: EcsEventGraphLayoutMap): EcsCommandHandlerOutcome {
  next.scripts[script.id] = script;
  if (graphLayout) {
    if (!next.graphLayouts) next.graphLayouts = {};
    next.graphLayouts[script.id] = graphLayout;
  }
  return okOutcome(`更新事件圖腳本「${script.name}」`);
}

export function handleRemoveScript(next: EcsProjectV2, scriptId: string): EcsCommandHandlerOutcome {
  if (!next.scripts[scriptId]) return failOutcome('找不到腳本', `Script not found: ${scriptId}`);
  const removedName = next.scripts[scriptId].name;
  delete next.scripts[scriptId];
  if (next.graphLayouts) delete next.graphLayouts[scriptId];
  for (const ent of next.entities) {
    if (ent.components.scripts) ent.components.scripts = ent.components.scripts.filter((id) => id !== scriptId);
    if (ent.overrides?.scripts) ent.overrides.scripts = ent.overrides.scripts.filter((id) => id !== scriptId);
  }
  return okOutcome(`刪除腳本「${removedName}」`);
}

export function handleSetGlobal(next: EcsProjectV2, key: string, value: number): EcsCommandHandlerOutcome {
  next.globals[key] = value;
  return okOutcome(`設定全域變數 ${key} = ${value}`);
}

export function handleSetAtmosphere(next: EcsProjectV2, patch: Partial<EcsProjectV2['atmosphere']>): EcsCommandHandlerOutcome {
  next.atmosphere = { ...next.atmosphere, ...patch };
  return okOutcome('更新大氣與水面反射設定');
}

export function handleSetProjection(next: EcsProjectV2, patch: Partial<EcsProjectionConfig>): EcsCommandHandlerOutcome {
  next.projection = { ...(next.projection ?? DEFAULT_HD2D_PROJECTION), ...patch };
  const pMode = next.projection.mode;
  const extra =
    pMode === 'hd2d_3d'
      ? ` (俯角 ${Math.round(next.projection.pitchDeg ?? 42)}° · FOV ${Math.round(next.projection.fovDeg ?? 38)}° · 牆高 ${(next.projection.wallHeightScale ?? 1.25).toFixed(2)}×)`
      : ` (位面遮罩 ${next.projection.activeDimensionMask ?? 3})`;
  return okOutcome(`切換多維投影：${pMode}${extra}`);
}

export function handleEnsureWorldMap(next: EcsProjectV2, cols?: number, rows?: number, roomName?: string): EcsCommandHandlerOutcome {
  if (!next.worldMap) {
    const w = cols ?? 24;
    const h = rows ?? 16;
    const room = createEmptyRoom('room_main', roomName ?? '主廳地圖', w, h);
    next.worldMap = { tileSize: 32, startRoomId: room.id, rooms: [room], portals: [] };
    return okOutcome(`建立 32px 多層地圖（${w}×${h}）`);
  }
  return okOutcome('專案已包含多層地圖');
}

export function handlePaintTiles(
  next: EcsProjectV2,
  roomId: string,
  layer: EcsMapLayerName,
  changes: { col: number; row: number; tileId: number }[],
): EcsCommandHandlerOutcome {
  const found = findRoomOrFail(next, roomId);
  if ('fail' in found) return found.fail;
  let changed = 0;
  for (let i = 0; i < changes.length; i++) {
    const ch = changes[i];
    if (setRoomTile(found.room, layer, ch.col, ch.row, ch.tileId)) changed++;
  }
  if (changed === 0) return okOutcome('地圖無格點變更', { skipValidationAndCommit: true });
  return okOutcome(`繪製 ${found.room.name} (${layer}) 共 ${changed} 格`);
}

export function handleFillRect(
  next: EcsProjectV2,
  roomId: string,
  layer: EcsMapLayerName,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  tileId: number,
): EcsCommandHandlerOutcome {
  const found = findRoomOrFail(next, roomId);
  if ('fail' in found) return found.fail;
  const changed = fillRoomRect(found.room, layer, c0, r0, c1, r1, tileId);
  if (changed === 0) return okOutcome('矩形區域無變更', { skipValidationAndCommit: true });
  return okOutcome(`矩形填滿 ${found.room.name} (${layer}) 共 ${changed} 格`);
}

export function handleFloodFill(
  next: EcsProjectV2,
  roomId: string,
  layer: EcsMapLayerName,
  col: number,
  row: number,
  tileId: number,
): EcsCommandHandlerOutcome {
  const found = findRoomOrFail(next, roomId);
  if ('fail' in found) return found.fail;
  const changed = floodFillRoom(found.room, layer, col, row, tileId);
  if (changed === 0) return okOutcome('油漆桶無變更', { skipValidationAndCommit: true });
  return okOutcome(`油漆桶填滿 ${found.room.name} (${layer}) 共 ${changed} 格`);
}

export function handleUpsertRoom(next: EcsProjectV2, room: EcsMapRoomDef): EcsCommandHandlerOutcome {
  if (!next.worldMap) {
    next.worldMap = { tileSize: 32, startRoomId: room.id, rooms: [room], portals: [] };
  } else {
    const idx = next.worldMap.rooms.findIndex((r) => r.id === room.id);
    if (idx >= 0) next.worldMap.rooms[idx] = room;
    else next.worldMap.rooms.push(room);
  }
  return okOutcome(`更新房間「${room.name}」(${room.cols}×${room.rows})`);
}

export function handleDeleteRoom(next: EcsProjectV2, roomId: string): EcsCommandHandlerOutcome {
  if (!next.worldMap || next.worldMap.rooms.length <= 1) {
    return failOutcome('至少需保留一間房間', 'Cannot delete last room');
  }
  const idx = next.worldMap.rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) return failOutcome('找不到房間', `Room not found: ${roomId}`);
  const removed = next.worldMap.rooms.splice(idx, 1)[0];
  next.worldMap.portals = next.worldMap.portals.filter((p) => p.fromRoomId !== roomId && p.toRoomId !== roomId);
  if (next.worldMap.startRoomId === roomId) next.worldMap.startRoomId = next.worldMap.rooms[0].id;
  return okOutcome(`刪除房間「${removed.name}」`);
}

export function handleUpsertPortal(next: EcsProjectV2, portal: EcsMapPortalDef): EcsCommandHandlerOutcome {
  const res = requireWorldMap(next);
  if ('fail' in res) return res.fail;
  const idx = res.wm.portals.findIndex((p) => p.id === portal.id);
  if (idx >= 0) res.wm.portals[idx] = portal;
  else res.wm.portals.push(portal);
  return okOutcome(`更新傳送門「${portal.name}」`);
}

export function handleRemovePortal(next: EcsProjectV2, portalId: string): EcsCommandHandlerOutcome {
  const res = requireWorldMap(next);
  if ('fail' in res) return res.fail;
  res.wm.portals = res.wm.portals.filter((p) => p.id !== portalId);
  return okOutcome(`移除傳送門 ${portalId}`);
}

export function handleStampRoomAscii(
  next: EcsProjectV2,
  cmd: {
    roomId: string;
    roomName?: string;
    createIfMissing?: boolean;
    originCol?: number;
    originRow?: number;
    lines: string[];
    legend: Record<string, EcsAsciiLegendEntry>;
    clearExistingRoomEntities?: boolean;
    editorFocusY?: number;
  },
): EcsCommandHandlerOutcome {
  if (!Array.isArray(cmd.lines) || cmd.lines.length === 0) {
    return failOutcome('ASCII 地圖藍圖為空', 'lines must be a non-empty string array');
  }
  const gridH = cmd.lines.length;
  const gridW = Math.max(8, ...cmd.lines.map((l) => l.length));
  if (!next.worldMap) {
    const fresh = createEmptyRoom(cmd.roomId, cmd.roomName ?? cmd.roomId, gridW, Math.max(8, gridH));
    next.worldMap = { tileSize: 32, startRoomId: fresh.id, rooms: [fresh], portals: [] };
  }
  let room = next.worldMap.rooms.find((r) => r.id === cmd.roomId);
  if (!room) {
    if (!cmd.createIfMissing) return failOutcome('找不到房間', `Room not found: ${cmd.roomId}`);
    room = createEmptyRoom(cmd.roomId, cmd.roomName ?? cmd.roomId, gridW, Math.max(8, gridH));
    next.worldMap.rooms.push(room);
  }
  if (typeof cmd.editorFocusY === 'number') room.editorFocusY = cmd.editorFocusY;
  if (cmd.clearExistingRoomEntities) {
    next.entities = next.entities.filter((e) => {
      if (e.roomId !== room!.id) return true;
      const c = resolveEntityComponents(e, next.prefabs);
      return c.tag === 'hero' || c.tag === 'player';
    });
  }
  const ox = Math.max(0, Math.floor(cmd.originCol ?? 0));
  const oy = Math.max(0, Math.floor(cmd.originRow ?? 0));
  const ts = next.worldMap.tileSize;
  let painted = 0;
  let spawned = 0;
  let createdEntityId: string | undefined;
  for (let r = 0; r < cmd.lines.length; r++) {
    const line = cmd.lines[r];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const entry = cmd.legend[ch];
      if (!entry) continue;
      const col = ox + c;
      const row = oy + r;
      if (col < 0 || row < 0 || col >= room.cols || row >= room.rows) continue;
      if (typeof entry.ground === 'number' && setRoomTile(room, 'ground', col, row, entry.ground)) painted++;
      if (typeof entry.wall === 'number' && setRoomTile(room, 'wall', col, row, entry.wall)) painted++;
      if (typeof entry.decor === 'number' && setRoomTile(room, 'decor', col, row, entry.decor)) painted++;
      if (entry.prefabId) {
        const prefab = next.prefabs[entry.prefabId];
        if (!prefab) {
          return failOutcome(
            `ASCII 圖例 '${ch}' 找不到 Prefab`,
            `Unknown prefabId "${entry.prefabId}" for legend glyph "${ch}"`,
          );
        }
        const prefix = entry.entityIdPrefix ?? `${room.id}_${entry.prefabId}`;
        let seq = 1;
        let eid = `${prefix}_${col}_${row}`;
        while (next.entities.some((e) => e.id === eid)) {
          seq++;
          eid = `${prefix}_${col}_${row}_${seq}`;
        }
        const pw = prefab.components.transform?.w ?? ts;
        const ph = prefab.components.transform?.h ?? ts;
        next.entities.push({
          id: eid,
          name: entry.entityName ?? prefab.name,
          roomId: room.id,
          prefabId: entry.prefabId,
          components: {},
          overrides: { transform: { x: col * ts + Math.round((ts - pw) * 0.5), y: row * ts + (ts - ph) } },
        });
        createdEntityId = eid;
        spawned++;
      }
    }
  }
  return okOutcome(`ASCII 藍圖套用至「${room.name}」（繪製 ${painted} 格、生成 ${spawned} 個實體）`, { createdEntityId });
}

export function handleSetWorldMapConfig(
  next: EcsProjectV2,
  cmd: { startRoomId?: string; tileSize?: number; heroConfig?: EcsTopDownHeroConfig; hostileProjectileTag?: string },
): EcsCommandHandlerOutcome {
  const res = requireWorldMap(next);
  if ('fail' in res) return res.fail;
  if (cmd.startRoomId) {
    if (!res.wm.rooms.some((r) => r.id === cmd.startRoomId)) {
      return failOutcome('找不到起始房間', `Room not found: ${cmd.startRoomId}`);
    }
    res.wm.startRoomId = cmd.startRoomId;
  }
  if (typeof cmd.tileSize === 'number' && cmd.tileSize >= 8 && cmd.tileSize <= 128) {
    res.wm.tileSize = Math.round(cmd.tileSize);
  }
  if (cmd.heroConfig) res.wm.heroConfig = { ...(res.wm.heroConfig ?? {}), ...cmd.heroConfig };
  if (typeof cmd.hostileProjectileTag === 'string' && cmd.hostileProjectileTag.trim()) {
    res.wm.hostileProjectileTag = cmd.hostileProjectileTag.trim();
  }
  return okOutcome('更新多房間世界地圖核心設定');
}

export function handleUpsertTileDef(next: EcsProjectV2, tileDef: EcsTileDef): EcsCommandHandlerOutcome {
  const res = requireWorldMap(next);
  if ('fail' in res) return res.fail;
  const defs = [...(res.wm.tileDefs ?? [])];
  const idx = defs.findIndex((d) => d.id === tileDef.id);
  if (idx >= 0) defs[idx] = tileDef;
  else defs.push(tileDef);
  res.wm.tileDefs = defs;
  return okOutcome(`註冊自訂瓦片 #${tileDef.id}「${tileDef.name}」`);
}

export function handleUpsertInteractionRule(next: EcsProjectV2, rule: EcsMapInteractionRule): EcsCommandHandlerOutcome {
  const res = requireWorldMap(next);
  if ('fail' in res) return res.fail;
  const rules = [...(res.wm.interactions ?? [])];
  const idx = rules.findIndex((r) => r.tag === rule.tag);
  if (idx >= 0) rules[idx] = rule;
  else rules.push(rule);
  res.wm.interactions = rules;
  return okOutcome(`更新互動規則 tag="${rule.tag}"`);
}

export function handleRemoveInteractionRule(next: EcsProjectV2, tag: string): EcsCommandHandlerOutcome {
  const res = requireWorldMap(next);
  if ('fail' in res) return res.fail;
  res.wm.interactions = (res.wm.interactions ?? []).filter((r) => r.tag !== tag);
  return okOutcome(`移除互動規則 tag="${tag}"`);
}

export function handleUpsertAiProfile(next: EcsProjectV2, tag: string, profile: EcsTopDownAiProfile): EcsCommandHandlerOutcome {
  const res = requireWorldMap(next);
  if ('fail' in res) return res.fail;
  res.wm.aiProfiles = { ...(res.wm.aiProfiles ?? {}), [tag]: profile };
  return okOutcome(`更新敵人/魔王 AI 規則 tag="${tag}"`);
}

export function handleRemoveAiProfile(next: EcsProjectV2, tag: string): EcsCommandHandlerOutcome {
  if (!next.worldMap?.aiProfiles) return failOutcome('找不到 AI 規則', `AI profile not found: ${tag}`);
  const copy = { ...next.worldMap.aiProfiles };
  delete copy[tag];
  next.worldMap.aiProfiles = copy;
  return okOutcome(`移除 AI 規則 tag="${tag}"`);
}

export function handleUpsertHudGauge(next: EcsProjectV2, gauge: EcsHudGaugeDef): EcsCommandHandlerOutcome {
  const list = [...next.hud];
  const idx = list.findIndex((g) => g.label === gauge.label);
  if (idx >= 0) list[idx] = gauge;
  else list.push(gauge);
  next.hud = list;
  return okOutcome(`更新 HUD 指標「${gauge.label}」`);
}

export function handleRemoveHudGauge(next: EcsProjectV2, label: string): EcsCommandHandlerOutcome {
  next.hud = next.hud.filter((g) => g.label !== label);
  return okOutcome(`移除 HUD 指標「${label}」`);
}

export function handleUpsertCustomSprite(next: EcsProjectV2, sprite: EcsCustomSpriteDef): EcsCommandHandlerOutcome {
  const spriteErrs = validateCustomSpriteDef(sprite, 'sprite');
  if (spriteErrs.length > 0) return { ok: false, summary: '自訂精靈定義驗證失敗', errors: spriteErrs };
  const cleaned = JSON.parse(JSON.stringify(sprite)) as EcsCustomSpriteDef;
  if (!next.customSprites) next.customSprites = {};
  next.customSprites[cleaned.id] = cleaned;
  return okOutcome(`更新自訂精靈「${cleaned.name ?? cleaned.id}」(${cleaned.width}×${cleaned.height})`, {
    createdSpriteId: cleaned.id,
  });
}

export function handleRemoveCustomSprite(next: EcsProjectV2, spriteId: string): EcsCommandHandlerOutcome {
  if (!next.customSprites || !next.customSprites[spriteId]) {
    return failOutcome('找不到自訂精靈', `Custom sprite '${spriteId}' not found`);
  }
  const copy = { ...next.customSprites };
  delete copy[spriteId];
  next.customSprites = copy;
  return okOutcome(`移除自訂精靈「${spriteId}」`);
}

export function handleUpsertAnimation(next: EcsProjectV2, animation: AnimationStateMachineDef): EcsCommandHandlerOutcome {
  const animId = animation?.id?.trim() ?? '';
  if (!animId) return failOutcome('動畫 ID 不可為空', 'Animation id is required');
  if (!Array.isArray(animation.clips) || animation.clips.length === 0) {
    return failOutcome('動畫至少需要一個 Clip', 'Animation must have at least one clip');
  }
  const cleaned = JSON.parse(JSON.stringify(animation)) as AnimationStateMachineDef;
  cleaned.id = animId;
  if (!cleaned.initialState) cleaned.initialState = cleaned.clips[0].name;
  const list = [...next.animations];
  const idx = list.findIndex((a) => a.id === animId);
  if (idx >= 0) list[idx] = cleaned;
  else list.push(cleaned);
  next.animations = list;
  return okOutcome(`更新幀動畫狀態機「${animId}」(${cleaned.clips.length} 個片段)`);
}

export function handleRemoveAnimation(next: EcsProjectV2, animationId: string): EcsCommandHandlerOutcome {
  if (!next.animations.some((a) => a.id === animationId)) {
    return failOutcome('找不到動畫狀態機', `Animation '${animationId}' not found`);
  }
  next.animations = next.animations.filter((a) => a.id !== animationId);
  return okOutcome(`移除幀動畫狀態機「${animationId}」`);
}

export function handleUpsertCutscene(next: EcsProjectV2, cutscene: EcsCutsceneDef): EcsCommandHandlerOutcome {
  const csErrs = validateCutsceneDef(cutscene, 'cutscene');
  if (csErrs.length > 0) return { ok: false, summary: '導演分鏡腳本驗證失敗', errors: csErrs };
  const cleaned = JSON.parse(JSON.stringify(cutscene)) as EcsCutsceneDef;
  const list = [...(next.cutscenes ?? [])];
  const idx = list.findIndex((c) => c.id === cleaned.id);
  if (idx >= 0) list[idx] = cleaned;
  else list.push(cleaned);
  next.cutscenes = list;
  return okOutcome(`更新導演分鏡腳本「${cleaned.name}」(${cleaned.shots.length} 顆鏡頭)`);
}

export function handleRemoveCutscene(next: EcsProjectV2, cutsceneId: string): EcsCommandHandlerOutcome {
  const list = next.cutscenes ?? [];
  if (!list.some((c) => c.id === cutsceneId)) {
    return failOutcome('找不到導演分鏡腳本', `Cutscene '${cutsceneId}' not found`);
  }
  next.cutscenes = list.filter((c) => c.id !== cutsceneId);
  return okOutcome(`移除導演分鏡腳本「${cutsceneId}」`);
}

export function handleSetRoomVoxel(next: EcsProjectV2, roomId: string, cell: EcsVoxelCellDef): EcsCommandHandlerOutcome {
  const found = findRoomOrFail(next, roomId);
  if ('fail' in found) return found.fail;
  setRoomVoxel(found.room, cell);
  return okOutcome(
    cell.tileId <= 0
      ? `清除 ${found.room.name} (${cell.col},${cell.row},z${cell.zLevel}) 體素`
      : `設定 ${found.room.name} (${cell.col},${cell.row},z${cell.zLevel}) 體素`,
  );
}

export function handleFillRoomBox3D(
  next: EcsProjectV2,
  cmd: { roomId: string; c0: number; r0: number; z0: number; c1: number; r1: number; z1: number; tileId: number; shape?: EcsVoxelShape },
): EcsCommandHandlerOutcome {
  const found = findRoomOrFail(next, cmd.roomId);
  if ('fail' in found) return found.fail;
  const filled = fillRoomBox3D(found.room, cmd.c0, cmd.r0, cmd.z0, cmd.c1, cmd.r1, cmd.z1, cmd.tileId, cmd.shape);
  return okOutcome(`3D 體素填充 ${found.room.name} 共 ${filled} 格`);
}

export function handleClearRoomVoxels(next: EcsProjectV2, roomId: string, zLevel?: number): EcsCommandHandlerOutcome {
  const found = findRoomOrFail(next, roomId);
  if ('fail' in found) return found.fail;
  if (zLevel !== undefined) {
    const targetZ = zLevel | 0;
    if (found.room.voxels) found.room.voxels = found.room.voxels.filter((v) => (v.zLevel | 0) !== targetZ);
    return okOutcome(`清除 ${found.room.name} z=${targetZ} 層體素`);
  }
  found.room.voxels = [];
  return okOutcome(`清除 ${found.room.name} 全部 3D 體素`);
}

export function handleUpsertModel3D(next: EcsProjectV2, model: EcsModel3DDef): EcsCommandHandlerOutcome {
  const modelErrs = validateModel3DDef(model, 'model');
  if (modelErrs.length > 0) return { ok: false, summary: '3D 模型定義驗證失敗', errors: modelErrs };
  let cloned: EcsModel3DDef;
  try {
    cloned = structuredClone(model);
  } catch {
    cloned = JSON.parse(JSON.stringify(model)) as EcsModel3DDef;
  }
  if (!next.models3d) next.models3d = {};
  next.models3d[cloned.id] = cloned;
  return okOutcome(`註冊 3D 模型「${cloned.name}」(${cloned.id})`);
}

export function handleRemoveModel3D(next: EcsProjectV2, modelId: string): EcsCommandHandlerOutcome {
  if (!next.models3d || !next.models3d[modelId]) {
    return failOutcome('找不到 3D 模型', `Model3D '${modelId}' not found`);
  }
  const copy = { ...next.models3d };
  delete copy[modelId];
  next.models3d = copy;
  return okOutcome(`移除 3D 模型「${modelId}」`);
}

export function handleSetCamera3DPose(
  next: EcsProjectV2,
  cmd: {
    yawDeg?: number;
    pitchDeg?: number;
    rollDeg?: number;
    fovDeg?: number;
    camCenterZ?: number;
    autoFollowHeroZ?: boolean;
    roofCutawayMode?: 'auto' | 'always' | 'off';
    roofCutawayAlpha?: number;
    cameraProjection3d?: Camera3DProjectionMode;
    quadView?: boolean;
    shadowMapEnabled?: boolean;
    shadowMapStrength?: number;
    showAxisGizmo3d?: boolean;
    showOrthoGrid3d?: boolean;
  },
): EcsCommandHandlerOutcome {
  const baseProj: EcsProjectionConfig = next.projection ?? DEFAULT_HD2D_PROJECTION;
  next.projection = {
    ...baseProj,
    ...(cmd.yawDeg !== undefined ? { yawDeg: cmd.yawDeg } : {}),
    ...(cmd.pitchDeg !== undefined ? { pitchDeg: cmd.pitchDeg } : {}),
    ...(cmd.rollDeg !== undefined ? { rollDeg: cmd.rollDeg } : {}),
    ...(cmd.fovDeg !== undefined ? { fovDeg: cmd.fovDeg } : {}),
    ...(cmd.camCenterZ !== undefined ? { camCenterZ: cmd.camCenterZ } : {}),
    ...(cmd.autoFollowHeroZ !== undefined ? { autoFollowHeroZ: cmd.autoFollowHeroZ } : {}),
    ...(cmd.roofCutawayMode !== undefined ? { roofCutawayMode: cmd.roofCutawayMode } : {}),
    ...(cmd.roofCutawayAlpha !== undefined ? { roofCutawayAlpha: cmd.roofCutawayAlpha } : {}),
    ...(cmd.cameraProjection3d !== undefined ? { cameraProjection3d: cmd.cameraProjection3d } : {}),
    ...(cmd.quadView !== undefined ? { quadView: cmd.quadView } : {}),
    ...(cmd.shadowMapEnabled !== undefined ? { shadowMapEnabled: cmd.shadowMapEnabled } : {}),
    ...(cmd.shadowMapStrength !== undefined ? { shadowMapStrength: cmd.shadowMapStrength } : {}),
    ...(cmd.showAxisGizmo3d !== undefined ? { showAxisGizmo3d: cmd.showAxisGizmo3d } : {}),
    ...(cmd.showOrthoGrid3d !== undefined ? { showOrthoGrid3d: cmd.showOrthoGrid3d } : {}),
  };
  return okOutcome(
    `更新 3D 相機姿態 (${next.projection.cameraProjection3d ?? 'perspective'} · yaw ${Math.round(next.projection.yawDeg ?? 0)}° · pitch ${Math.round(next.projection.pitchDeg ?? 42)}°)`,
  );
}
