import { OCCLUSION_GRID_MAX } from '../gpu/GpuTypes.ts';
import type { LightDesc, TileDesc, VoxelRenderDesc } from '../types/WorldTypes.ts';
import { ecsEntitiesInteractInSpace } from './EcsActionPhysicsSystems.ts';
import type { EcsProjectV2 } from './EcsProjectSchema.ts';
import {
  getCastleTileDef,
  isRoomCellSolid,
  type EcsMapPortalDef,
  type EcsMapRoomDef,
  type EcsTileDef,
} from './EcsTilemapTypes.ts';
import type { RoomVoxelVolume } from './EcsVoxelVolume.ts';
import type { EcsWorld } from './EcsWorld.ts';

export interface WorldMapStepCallbacks {
  onScoreDelta: (delta: number) => void;
  onStatusChange: (status: 'playing' | 'won' | 'lost') => void;
  onPopup: (text: string, x: number, y: number, color: string) => void;
  onRoomBanner: (banner: string) => void;
  onMeleeSwing?: (x: number, y: number, dirX: number, dirY: number, color: string, heroHandle: number) => void;
  onHitImpact?: (x: number, y: number, dirX: number, dirY: number, killed: boolean, isBoss: boolean, targetHandle: number) => void;
  onHeroHurt?: (x: number, y: number, heroHandle: number) => void;
  onDash?: (x: number, y: number, dirX: number, dirY: number, heroHandle: number) => void;
  onFootstep?: (x: number, y: number) => void;
  onInteract?: (x: number, y: number, color: string) => void;
  onBossPhase?: (x: number, y: number) => void;
}

export interface WorldTileRebuildOutput {
  outVoxels3dCount: number;
  cachedAmbientLightCount: number;
  unlockMask: number;
}

function acquireTileFromPool(tilePool: TileDesc[], idx: number): TileDesc {
  let slot = tilePool[idx];
  if (!slot) {
    slot = { sprite: 'solid', x: 0, y: 0, w: 32, h: 32 };
    tilePool[idx] = slot;
  }
  return slot;
}

function acquireVoxelRenderFromPool(voxelRenderPool: VoxelRenderDesc[], idx: number): VoxelRenderDesc {
  let slot = voxelRenderPool[idx];
  if (!slot) {
    slot = {
      col: 0,
      row: 0,
      zLevel: 0,
      x: 0,
      y: 0,
      z: 0,
      w: 32,
      d: 32,
      h: 24,
      shape: 'cube',
      sprite: 'solid',
      cullMask: 0,
    };
    voxelRenderPool[idx] = slot;
  }
  return slot;
}

function isExtrudedWallCell(
  room: EcsMapRoomDef,
  cols: number,
  rows: number,
  cc: number,
  rr: number,
  customDefs: readonly EcsTileDef[] | undefined,
  globals: ReadonlyMap<string, number>,
  defaultExtrude: number,
): boolean {
  if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) return false;
  const nTid = room.wall[rr * cols + cc] ?? 0;
  if (nTid <= 0) return false;
  const nDef = getCastleTileDef(nTid, customDefs);
  if (!nDef) return false;
  if (nDef.unlockGlobal && (globals.get(nDef.unlockGlobal) ?? 0) >= 1) return false;
  return (nDef.extrudeH ?? defaultExtrude) > 4;
}

export function computeWorldUnlockMask(
  wm: EcsProjectV2['worldMap'] | undefined,
  globals: ReadonlyMap<string, number>,
): number {
  if (!wm) return 0;
  let mask = 0;
  let bit = 0;
  if (wm.tileDefs) {
    for (let i = 0; i < wm.tileDefs.length && bit < 31; i++) {
      const key = wm.tileDefs[i].unlockGlobal;
      if (!key) continue;
      if ((globals.get(key) ?? 0) >= 1) mask |= 1 << bit;
      bit++;
    }
  }
  for (let i = 0; i < wm.portals.length && bit < 31; i++) {
    const key = wm.portals[i].requiresGlobal;
    if (!key) continue;
    if ((globals.get(key) ?? 0) >= 1) mask |= 1 << bit;
    bit++;
  }
  return mask;
}

export function clampWorldCamera(
  room: EcsMapRoomDef | null,
  wm: EcsProjectV2['worldMap'] | undefined,
  camX: number,
  camY: number,
  vpW: number,
  vpH: number,
  zoom: number,
  outPos: [number, number],
): void {
  if (!room || !wm) {
    outPos[0] = camX;
    outPos[1] = camY;
    return;
  }
  const worldW = room.cols * wm.tileSize;
  const worldH = room.rows * wm.tileSize;
  const safeZoom = Math.max(0.25, zoom);
  const effW = vpW / safeZoom;
  const effH = vpH / safeZoom;
  if (effW >= worldW) {
    outPos[0] = (worldW - vpW) * 0.5;
  } else {
    const minX = (effW - vpW) * 0.5;
    const maxX = worldW - (vpW + effW) * 0.5;
    outPos[0] = Math.max(minX, Math.min(maxX, camX));
  }
  if (effH >= worldH) {
    outPos[1] = (worldH - vpH) * 0.5;
  } else {
    const minY = (effH - vpH) * 0.5;
    const maxY = worldH - (vpH + effH) * 0.5;
    outPos[1] = Math.max(minY, Math.min(maxY, camY));
  }
}

export function findTriggeredPortalInRoom(
  wm: EcsProjectV2['worldMap'] | undefined,
  activeRoomId: string,
  heroCx: number,
  heroCy: number,
  ts: number,
): EcsMapPortalDef | null {
  if (!wm) return null;
  for (let i = 0; i < wm.portals.length; i++) {
    const p = wm.portals[i];
    if (p.fromRoomId !== activeRoomId) continue;
    const x0 = p.col * ts;
    const y0 = p.row * ts;
    const x1 = (p.col + p.cols) * ts;
    const y1 = (p.row + p.rows) * ts;
    if (heroCx >= x0 && heroCx <= x1 && heroCy >= y0 && heroCy <= y1) {
      return p;
    }
  }
  return null;
}

export function isWorldBoxCollidingAt(
  tx: number,
  ty: number,
  w: number,
  h: number,
  padX: number,
  footTop: number,
  footBot: number,
  ts: number,
  room: EcsMapRoomDef,
  tileDefs: NonNullable<EcsProjectV2['worldMap']>['tileDefs'],
  world: EcsWorld,
  voxelVolume: RoomVoxelVolume,
  activeDimMask: number,
  actorHandle = 0,
): boolean {
  const left = tx + padX;
  const right = tx + w - padX;
  const top = ty + footTop;
  const bottom = ty + footBot;
  const core = world.core;

  if (room.voxels && room.voxels.length > 0) {
    if (left < 0 || top < 0 || right > room.cols * ts || bottom > room.rows * ts) {
      return true;
    }
    const sp = actorHandle ? core.getComponent(actorHandle, core.components.Spatial3D) : undefined;
    const actorZ = sp ? sp.z : 0;
    const actorH = sp ? sp.height : 16;
    const actorStep = sp ? sp.stepHeight : 10;
    if (
      voxelVolume.collidesAabb3D(
        left,
        top,
        actorZ,
        Math.max(2, right - left),
        Math.max(2, bottom - top),
        actorH,
        actorStep,
      )
    ) {
      return true;
    }
  } else {
    const c0 = Math.floor(left / ts);
    const c1 = Math.floor(right / ts);
    const r0 = Math.floor(top / ts);
    const r1 = Math.floor(bottom / ts);
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (isRoomCellSolid(room, cc, rr, world.globals, tileDefs)) return true;
      }
    }
  }

  const colStore = core.getStore(core.components.Collider);
  const cx = tx + w * 0.5;
  const cy = ty + h * 0.72;
  for (let i = 0; i < colStore.size(); i++) {
    const col = colStore.getDenseDataAt(i);
    if (!col.isSolid) continue;
    const eh = colStore.getDenseEntityAt(i);
    if (actorHandle && (eh === actorHandle || !ecsEntitiesInteractInSpace(core, actorHandle, eh, activeDimMask))) {
      continue;
    }
    const etr = core.getComponent(eh, core.components.Transform2D);
    if (!etr) continue;
    const ex = etr.x + etr.w * 0.5;
    const ey = etr.y + etr.h * 0.78;
    if (Math.hypot(cx - ex, cy - ey) < col.radius + 8) return true;
  }
  return false;
}

/**
 * Resolves AABB tilemap + multi-story 3D voxel + solid prop collisions cleanly with per-axis wall sliding.
 */
export function moveWithTileCollisionPure(
  x: number,
  y: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
  room: EcsMapRoomDef | null,
  wm: EcsProjectV2['worldMap'] | undefined,
  world: EcsWorld,
  voxelVolume: RoomVoxelVolume,
  activeDimMask: number,
  outPos: [number, number],
  actorHandle = 0,
): void {
  if (!room || !wm) {
    outPos[0] = x + dx;
    outPos[1] = y + dy;
    return;
  }
  const ts = wm.tileSize;
  const padX = Math.max(4, w * 0.24);
  const footTop = h * 0.48;
  const footBot = h - 3;

  let nx = x;
  let ny = y;
  if (
    dx !== 0 &&
    !isWorldBoxCollidingAt(nx + dx, ny, w, h, padX, footTop, footBot, ts, room, wm.tileDefs, world, voxelVolume, activeDimMask, actorHandle)
  ) {
    nx += dx;
  }
  if (
    dy !== 0 &&
    !isWorldBoxCollidingAt(nx, ny + dy, w, h, padX, footTop, footBot, ts, room, wm.tileDefs, world, voxelVolume, activeDimMask, actorHandle)
  ) {
    ny += dy;
  }
  outPos[0] = nx;
  outPos[1] = ny;
}

export function updateActorVoxelElevationPure(
  world: EcsWorld,
  voxelVolume: RoomVoxelVolume,
  handle: number,
  dt: number,
): void {
  const c = world.core.components;
  const sp = world.core.getComponent(handle, c.Spatial3D);
  const tr = world.core.getComponent(handle, c.Transform2D);
  if (!sp || !tr) return;
  const padX = Math.max(4, tr.w * 0.24);
  const left = tr.x + padX;
  const right = tr.x + tr.w - padX;
  const top = tr.y + tr.h * 0.48;
  const bot = tr.y + tr.h - 3;
  const footCx = tr.x + tr.w * 0.5;
  const footCy = tr.y + tr.h * 0.72;
  const sC = voxelVolume.sampleSupportZ(footCx, footCy, sp.z, sp.stepHeight);
  const sLT = voxelVolume.sampleSupportZ(left, top, sp.z, sp.stepHeight);
  const sRT = voxelVolume.sampleSupportZ(right, top, sp.z, sp.stepHeight);
  const sRB = voxelVolume.sampleSupportZ(right, bot, sp.z, sp.stepHeight);
  const sLB = voxelVolume.sampleSupportZ(left, bot, sp.z, sp.stepHeight);
  const nextSupport = Math.max(sC, sLT, sRT, sRB, sLB);
  const ceilingZ = voxelVolume.sampleCeilingZ(footCx, footCy, sp.z, 9999);
  sp.groundZ = nextSupport;
  sp.ceilingZ = ceilingZ;
  sp.prevZ = sp.z;
  if (sp.gravityZ > 0) {
    if (sp.z < nextSupport) {
      sp.z = nextSupport;
      if (sp.vz < 0) sp.vz = 0;
    } else if (sp.z > nextSupport) {
      sp.vz -= sp.gravityZ * dt;
      sp.z += sp.vz * dt;
      if (sp.vz > 0 && sp.z + sp.height > ceilingZ) {
        sp.z = Math.max(nextSupport, ceilingZ - sp.height);
        sp.vz = 0;
      }
      if (sp.z <= nextSupport) {
        sp.z = nextSupport;
        if (sp.vz < 0) sp.vz = 0;
      }
    }
  } else {
    sp.z = Math.max(sp.groundZ, nextSupport);
  }
}

export function rebuildWorldTilesAndVoxels(
  room: EcsMapRoomDef | null,
  wm: EcsProjectV2['worldMap'] | undefined,
  globals: ReadonlyMap<string, number>,
  tilePool: TileDesc[],
  outTiles: TileDesc[],
  voxelVolume: RoomVoxelVolume,
  voxelRenderPool: VoxelRenderDesc[],
  outVoxels3d: VoxelRenderDesc[],
  occlusionGrid: Uint8Array,
  cachedAmbientLights: LightDesc[],
  isWallTileSolidForVoxel: (tileId: number) => boolean,
  outResult: WorldTileRebuildOutput,
): void {
  if (!room || !wm) {
    outTiles.length = 0;
    outVoxels3d.length = 0;
    outResult.outVoxels3dCount = 0;
    outResult.cachedAmbientLightCount = 0;
    outResult.unlockMask = 0;
    return;
  }

  let count = 0;
  let ambientCount = 0;
  const ts = wm.tileSize;
  const cols = room.cols;
  const rows = room.rows;
  const defaultExtrude = room.wallExtrudeH ?? 26;
  const customDefs = wm.tileDefs;

  // 1. Ground Layer
  for (let r = 0; r < rows; r++) {
    const wy = r * ts;
    for (let c = 0; c < cols; c++) {
      const tid = room.ground[r * cols + c] ?? 0;
      if (tid <= 0) continue;
      const def = getCastleTileDef(tid, customDefs);
      if (!def) continue;
      const slot = acquireTileFromPool(tilePool, count);
      slot.sprite = def.sprite;
      slot.sideSprite = undefined;
      slot.x = c * ts;
      slot.y = wy;
      slot.w = ts;
      slot.h = ts;
      slot.alpha = 1;
      slot.tint = def.tint ?? '#ffffff';
      slot.roughness = def.roughness;
      slot.metallic = def.metallic;
      slot.emissive = def.emissive;
      slot.extrudeH = 0;
      slot.elevationZ = 0;
      slot.wallMaterial = undefined;
      slot.autoMask = 0;
      slot.sortY = -1000;
      slot.castShadow = false;
      outTiles[count++] = slot;
    }
  }

  // 2. Decor Layer (reads data-driven `def.renderH` for tall 48px props)
  for (let r = 0; r < rows; r++) {
    const wy = r * ts;
    for (let c = 0; c < cols; c++) {
      const tid = room.decor[r * cols + c] ?? 0;
      if (tid <= 0) continue;
      const def = getCastleTileDef(tid, customDefs);
      if (!def) continue;
      const rh = def.renderH ?? ts;
      const isTall = rh > ts;
      const slot = acquireTileFromPool(tilePool, count);
      slot.sprite = def.sprite;
      slot.sideSprite = undefined;
      slot.x = c * ts;
      slot.y = isTall ? wy - (rh - ts) : wy;
      slot.w = ts;
      slot.h = rh;
      slot.alpha = 1;
      slot.tint = def.tint ?? '#ffffff';
      slot.roughness = def.roughness;
      slot.metallic = def.metallic;
      slot.emissive = def.emissive;
      slot.extrudeH = 0;
      slot.elevationZ = isTall ? 0.5 : 0;
      slot.wallMaterial = undefined;
      slot.autoMask = 0;
      slot.sortY = isTall ? wy + ts + 2 : -900;
      slot.castShadow = isTall;
      outTiles[count++] = slot;
    }
  }

  // 3. Wall Layer (HD-2D extruded walls & dynamic global-gated doors + cached ambient tile lights)
  for (let r = 0; r < rows; r++) {
    const wy = r * ts;
    for (let c = 0; c < cols; c++) {
      const tid = room.wall[r * cols + c] ?? 0;
      if (tid <= 0) continue;
      const def = getCastleTileDef(tid, customDefs);
      if (!def) continue;
      const isUnlocked = def.unlockGlobal ? (globals.get(def.unlockGlobal) ?? 0) >= 1 : false;
      const sprite = isUnlocked && def.unlockedSprite ? def.unlockedSprite : def.sprite;
      const sideSprite = isUnlocked && def.unlockedSprite ? def.unlockedSprite : def.sideSprite;
      let mask = 0;
      if (!isUnlocked) {
        if (isExtrudedWallCell(room, cols, rows, c, r - 1, customDefs, globals, defaultExtrude)) mask |= 1;
        if (isExtrudedWallCell(room, cols, rows, c + 1, r, customDefs, globals, defaultExtrude)) mask |= 2;
        if (isExtrudedWallCell(room, cols, rows, c, r + 1, customDefs, globals, defaultExtrude)) mask |= 4;
        if (isExtrudedWallCell(room, cols, rows, c - 1, r, customDefs, globals, defaultExtrude)) mask |= 8;
      }
      const slot = acquireTileFromPool(tilePool, count);
      slot.sprite = sprite;
      slot.sideSprite = sideSprite;
      slot.x = c * ts;
      slot.y = wy;
      slot.w = ts;
      slot.h = ts;
      slot.alpha = 1;
      slot.tint = def.tint ?? '#ffffff';
      slot.roughness = def.roughness;
      slot.metallic = def.metallic;
      slot.emissive = def.emissive;
      slot.extrudeH = isUnlocked ? 4 : (def.extrudeH ?? defaultExtrude);
      slot.elevationZ = 0;
      slot.wallMaterial = def.wallMaterial ?? 'stone';
      slot.autoMask = mask;
      slot.sortY = wy + ts;
      slot.castShadow = !isUnlocked;
      outTiles[count++] = slot;

      if (def.ambientLight && ambientCount < 22) {
        let light = cachedAmbientLights[ambientCount];
        if (!light) {
          light = { x: 0, y: 0, radius: 24, color: '#ffffff', intensity: 0.5 };
          cachedAmbientLights[ambientCount] = light;
        }
        light.x = c * ts + ts * 0.5;
        light.y = wy + ts * 1.1;
        light.z = 16;
        light.radius = def.ambientLight.radius;
        light.color = def.ambientLight.color;
        light.intensity = def.ambientLight.intensity;
        ambientCount++;
      }
    }
  }
  if (outTiles.length > count) {
    outTiles.length = count;
  }

  // 4. Rebuild GPU 2D Wall Shadow Occlusion Grid (64x64 R8, only uploaded on version bump)
  occlusionGrid.fill(0);
  const maxR = Math.min(OCCLUSION_GRID_MAX, rows);
  const maxC = Math.min(OCCLUSION_GRID_MAX, cols);
  for (let r = 0; r < maxR; r++) {
    const rowOff = r * OCCLUSION_GRID_MAX;
    for (let c = 0; c < maxC; c++) {
      if (isRoomCellSolid(room, c, r, globals, customDefs)) {
        occlusionGrid[rowOff + c] = 255;
      }
    }
  }
  outResult.unlockMask = computeWorldUnlockMask(wm, globals);

  // 5. Compile Multi-Story RoomVoxelVolume & Zero-GC VoxelRenderDesc pool
  const storyH = room.storyHeight ?? room.wallExtrudeH ?? 24;
  voxelVolume.compileFromRoom(cols, rows, ts, storyH, room.voxels, room.wall, isWallTileSolidForVoxel);
  if (room.voxels && room.voxels.length > 0) {
    let vCount = 0;
    const stories = voxelVolume.stories;
    for (let z = 0; z < stories; z++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tid = voxelVolume.getCellTileId(c, r, z);
          if (tid <= 0) continue;
          const shape = voxelVolume.getCellShape(c, r, z) ?? 'cube';
          const def = getCastleTileDef(tid, customDefs);
          const isUnlocked = def?.unlockGlobal ? (globals.get(def.unlockGlobal) ?? 0) >= 1 : false;
          const sprite = isUnlocked && def?.unlockedSprite ? def.unlockedSprite : (def?.sprite ?? 'castle_wall_top');
          const sideSprite = isUnlocked && def?.unlockedSprite ? def.unlockedSprite : def?.sideSprite;
          const slot = acquireVoxelRenderFromPool(voxelRenderPool, vCount);
          slot.col = c;
          slot.row = r;
          slot.zLevel = z;
          slot.x = c * ts;
          slot.y = r * ts;
          slot.z = z * storyH;
          slot.w = ts;
          slot.d = ts;
          slot.h = storyH;
          slot.shape = shape;
          slot.sprite = sprite;
          slot.sideSprite = sideSprite;
          slot.cullMask = shape === 'cube' ? voxelVolume.computeFaceCullMask(c, r, z) : 0;
          slot.tint = def?.tint;
          slot.roughness = def?.roughness;
          slot.metallic = def?.metallic;
          slot.emissive = def?.emissive;
          slot.alpha = 1;
          outVoxels3d[vCount++] = slot;

          if (z > 0 && def?.ambientLight && ambientCount < 22) {
            let light = cachedAmbientLights[ambientCount];
            if (!light) {
              light = { x: 0, y: 0, z: 16, radius: 24, color: '#ffffff', intensity: 0.5 };
              cachedAmbientLights[ambientCount] = light;
            }
            light.x = c * ts + ts * 0.5;
            light.y = r * ts + ts * 0.5;
            light.z = z * storyH + 16;
            light.radius = def.ambientLight.radius;
            light.color = def.ambientLight.color;
            light.intensity = def.ambientLight.intensity;
            ambientCount++;
          }
        }
      }
    }
    if (outVoxels3d.length > vCount) {
      outVoxels3d.length = vCount;
    }
    outResult.outVoxels3dCount = vCount;
  } else {
    if (outVoxels3d.length > 0) {
      outVoxels3d.length = 0;
    }
    outResult.outVoxels3dCount = 0;
  }
  outResult.cachedAmbientLightCount = ambientCount;
}
