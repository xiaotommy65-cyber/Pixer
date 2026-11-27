import { resolveEntityComponents, type EcsProjectV2 } from '../ecs/EcsProjectSchema.ts';
import { getCastleTileDef, isRoomCellHazard } from '../ecs/EcsTilemapTypes.ts';
import {
  MAX_VOXEL_STORIES,
  renderRoomSliceAsciiPure,
  RoomVoxelVolume,
  type EcsVoxelShape,
} from '../ecs/EcsVoxelVolume.ts';
import type { EcsWorldMapReachabilityReport } from './EcsSpatialOracleWorld.ts';

export interface EcsRoomSliceAsciiReport {
  ok: boolean;
  roomId: string;
  roomName: string;
  zLevel: number;
  cols: number;
  rows: number;
  tileSize: number;
  storyHeight: number;
  lines: string[];
  ascii: string;
  legend: Record<string, string>;
}

/**
 * Renders a single story `zLevel` (0..7) 3D voxel slice as a compact ASCII grid
 * showing `#` cube, `=` half_slab, `^/v/</>` ramps & stairs, `A` arch, `@` hero, and `M` entities.
 */
export function renderRoomSliceAscii(
  project: EcsProjectV2,
  roomId?: string,
  zLevel = 0,
): EcsRoomSliceAsciiReport {
  const wm = project.worldMap;
  if (!wm || wm.rooms.length === 0) {
    return {
      ok: false,
      roomId: '',
      roomName: '',
      zLevel: 0,
      cols: 0,
      rows: 0,
      tileSize: 32,
      storyHeight: 24,
      lines: [],
      ascii: '',
      legend: {},
    };
  }
  const room =
    (roomId ? wm.rooms.find((r) => r.id === roomId) : undefined) ??
    wm.rooms.find((r) => r.id === wm.startRoomId) ??
    wm.rooms[0];
  const ts = wm.tileSize;
  const storyHeight = room.storyHeight ?? room.wallExtrudeH ?? 24;
  const clampedZ = Math.max(0, Math.min(MAX_VOXEL_STORIES - 1, Math.floor(zLevel)));

  const entMarkers: Array<{ x: number; y: number; z?: number; tag?: string; tileSize: number }> = [];
  for (const ent of project.entities) {
    const c = resolveEntityComponents(ent, project.prefabs);
    const tag = c.tag ?? 'prop';
    const isHero = tag === 'hero' || tag === 'player';
    const entRoom = ent.roomId ?? wm.startRoomId;
    if (entRoom !== room.id && !(isHero && room.id === wm.startRoomId)) continue;
    entMarkers.push({
      x: c.transform.x + (c.transform.w ?? ts) * 0.5,
      y: c.transform.y + (c.transform.h ?? ts) * 0.5,
      z: c.spatial3d?.z ?? 0,
      tag,
      tileSize: ts,
    });
  }

  const ascii = renderRoomSliceAsciiPure(
    room.cols,
    room.rows,
    clampedZ,
    room.voxels,
    room.wall,
    entMarkers,
    storyHeight,
  );

  return {
    ok: true,
    roomId: room.id,
    roomName: room.name,
    zLevel: clampedZ,
    cols: room.cols,
    rows: room.rows,
    tileSize: ts,
    storyHeight,
    lines: ascii ? ascii.split('\n') : [],
    ascii,
    legend: {
      '.': 'empty',
      '#': 'cube',
      '=': 'half_slab',
      '^': 'slope_n / stair_n',
      'v': 'slope_s / stair_s',
      '<': 'slope_w / stair_w',
      '>': 'slope_e / stair_e',
      'A': 'arch',
      '@': 'hero',
      'M': 'entity',
    },
  };
}

export interface EcsWorldMap3DReachabilityReport extends EcsWorldMapReachabilityReport {
  maxStoryReached: number;
  reachableCellCount3D: number;
}

function getSlopeClimbDir(shape: EcsVoxelShape | null): [number, number] | null {
  switch (shape) {
    case 'slope_n':
    case 'stair_n':
      return [0, -1];
    case 'slope_e':
    case 'stair_e':
      return [1, 0];
    case 'slope_s':
    case 'stair_s':
      return [0, 1];
    case 'slope_w':
    case 'stair_w':
      return [-1, 0];
    default:
      return null;
  }
}

/**
 * Multi-Story 3D BFS + Key/Switch Dependency Fixed-Point Solver over `(col, row, zLevel)`
 * across stairs, ramps, arches, elevated decks, and room portals.
 */
export function analyzeWorldMap3DReachability(project: EcsProjectV2): EcsWorldMap3DReachabilityReport {
  const wm = project.worldMap;
  if (!wm || wm.rooms.length === 0) {
    return {
      pass: false,
      hasWorldMap: false,
      startRoomId: '',
      reachableRoomIds: [],
      unreachableRoomIds: [],
      unlockedGlobals: {},
      reachableInteractionIds: [],
      unreachableInteractionIds: [],
      reachableBossIds: [],
      unreachableBossIds: [],
      lockedPortals: [],
      softLockRisks: ['Project does not define a multi-room worldMap'],
      diagnostics: ['Call ensure_world_map or stamp_room_ascii first'],
      maxStoryReached: 0,
      reachableCellCount3D: 0,
    };
  }

  const ts = wm.tileSize;
  const roomMap = new Map(wm.rooms.map((r) => [r.id, r]));
  const startRoom = roomMap.get(wm.startRoomId) ?? wm.rooms[0];

  const heroEnt = project.entities.find((e) => {
    const c = resolveEntityComponents(e, project.prefabs);
    return c.tag === 'hero' || c.tag === 'player' || Boolean(c.characterMotor2d);
  });
  const heroComp = heroEnt ? resolveEntityComponents(heroEnt, project.prefabs) : null;
  const heroHeight = heroComp?.spatial3d?.height ?? 16;
  const startStoryH = startRoom.storyHeight ?? startRoom.wallExtrudeH ?? 24;
  const startCol = heroComp
    ? Math.max(0, Math.min(startRoom.cols - 1, Math.floor((heroComp.transform.x + (heroComp.transform.w ?? ts) * 0.5) / ts)))
    : Math.floor(startRoom.cols * 0.5);
  const startRow = heroComp
    ? Math.max(0, Math.min(startRoom.rows - 1, Math.floor((heroComp.transform.y + (heroComp.transform.h ?? ts) * 0.5) / ts)))
    : Math.floor(startRoom.rows * 0.5);
  const startZ = heroComp?.spatial3d?.z
    ? Math.max(0, Math.min(MAX_VOXEL_STORIES - 1, Math.floor((heroComp.spatial3d.z + 2) / startStoryH)))
    : 0;

  const globals: Record<string, number> = { ...project.globals };
  const roomSeeds = new Map<string, Array<[number, number, number]>>();
  roomSeeds.set(startRoom.id, [[startCol, startRow, startZ]]);

  const volumeByRoom = new Map<string, RoomVoxelVolume>();
  for (const r of wm.rooms) {
    volumeByRoom.set(r.id, new RoomVoxelVolume());
  }

  const visitedByRoom = new Map<string, Uint8Array>();
  const triggeredInteractions = new Set<string>();
  const rulesByTag = new Map((wm.interactions ?? []).map((r) => [r.tag, r]));
  const aiProfiles = wm.aiProfiles ?? {};

  const isCellPassableAtStory = (
    vol: RoomVoxelVolume,
    room: (typeof wm.rooms)[number],
    c: number,
    r: number,
    z: number,
  ): boolean => {
    if (c < 0 || r < 0 || c >= room.cols || r >= room.rows || z < 0 || z >= MAX_VOXEL_STORIES) return false;
    if (z === 0 && isRoomCellHazard(room, c, r, wm.tileDefs)) return false;
    const shape = vol.getCellShape(c, r, z);
    if (shape === null) return true;
    if (shape === 'arch') return vol.storyHeight * 0.7 >= heroHeight;
    if (getSlopeClimbDir(shape) !== null) return true;
    if (shape === 'half_slab') return vol.storyHeight * 0.5 <= (heroComp?.spatial3d?.stepHeight ?? 10);
    return false;
  };

  const isCellSupportedAtStory = (vol: RoomVoxelVolume, c: number, r: number, z: number): boolean => {
    if (z === 0) return true;
    const below = vol.getCellShape(c, r, z - 1);
    if (below === 'cube' || below === 'arch' || getSlopeClimbDir(below) !== null) return true;
    const cur = vol.getCellShape(c, r, z);
    return getSlopeClimbDir(cur) !== null;
  };

  const compileRoomVol = (room: (typeof wm.rooms)[number]): RoomVoxelVolume => {
    const vol = volumeByRoom.get(room.id)!;
    const storyH = room.storyHeight ?? room.wallExtrudeH ?? 24;
    vol.compileFromRoom(room.cols, room.rows, ts, storyH, room.voxels, room.wall, (tid) => {
      const def = getCastleTileDef(tid, wm.tileDefs);
      if (!def || !def.solid) return false;
      if (def.unlockGlobal && (globals[def.unlockGlobal] ?? 0) >= 1) return false;
      return true;
    });
    return vol;
  };

  const floodRoom3D = (roomId: string): Uint8Array => {
    const room = roomMap.get(roomId)!;
    const vol = compileRoomVol(room);
    const layerSize = room.cols * room.rows;
    const vis = new Uint8Array(layerSize * MAX_VOXEL_STORIES);
    const seeds = roomSeeds.get(roomId) ?? [];
    const queue: number[] = [];

    for (const [sc, sr, sz] of seeds) {
      if (!isCellPassableAtStory(vol, room, sc, sr, sz) || !isCellSupportedAtStory(vol, sc, sr, sz)) continue;
      const idx = (sz * room.rows + sr) * room.cols + sc;
      if (!vis[idx]) {
        vis[idx] = 1;
        queue.push(idx);
      }
    }

    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const z = (idx / layerSize) | 0;
      const rem = idx - z * layerSize;
      const r = (rem / room.cols) | 0;
      const c = rem - r * room.cols;

      const curShape = vol.getCellShape(c, r, z);
      const climbDir = getSlopeClimbDir(curShape);

      for (const [dc, dr] of dirs) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= room.cols || nr >= room.rows) continue;

        // 1. Same story walk (including entering a stair/ramp from its low side or sides)
        if (isCellPassableAtStory(vol, room, nc, nr, z) && isCellSupportedAtStory(vol, nc, nr, z)) {
          const nIdx = (z * room.rows + nr) * room.cols + nc;
          if (!vis[nIdx]) {
            vis[nIdx] = 1;
            queue.push(nIdx);
          }
        }

        // 2. Climb up 1 story along a stair or slope's high end
        if (
          z + 1 < MAX_VOXEL_STORIES &&
          climbDir &&
          climbDir[0] === dc &&
          climbDir[1] === dr &&
          isCellPassableAtStory(vol, room, nc, nr, z + 1) &&
          isCellSupportedAtStory(vol, nc, nr, z + 1)
        ) {
          const upIdx = ((z + 1) * room.rows + nr) * room.cols + nc;
          if (!vis[upIdx]) {
            vis[upIdx] = 1;
            queue.push(upIdx);
          }
        }

        // 3. Descend 1 story back down onto a stair/slope or drop onto a lower supported cell
        if (z > 0) {
          const belowNeighborShape = vol.getCellShape(nc, nr, z - 1);
          const belowClimb = getSlopeClimbDir(belowNeighborShape);
          if (
            belowClimb &&
            belowClimb[0] === -dc &&
            belowClimb[1] === -dr &&
            isCellPassableAtStory(vol, room, nc, nr, z - 1)
          ) {
            const dnIdx = ((z - 1) * room.rows + nr) * room.cols + nc;
            if (!vis[dnIdx]) {
              vis[dnIdx] = 1;
              queue.push(dnIdx);
            }
          }
        }
      }
    }

    return vis;
  };

  const isCellVisited3D = (roomId: string, col: number, row: number, z: number): boolean => {
    const room = roomMap.get(roomId);
    const vis = visitedByRoom.get(roomId);
    if (!room || !vis || col < 0 || row < 0 || col >= room.cols || row >= room.rows || z < 0 || z >= MAX_VOXEL_STORIES) {
      return false;
    }
    return vis[(z * room.rows + row) * room.cols + col] === 1;
  };

  const hasVisitedCells = (roomId: string): boolean => {
    const vis = visitedByRoom.get(roomId);
    if (!vis) return false;
    for (let i = 0; i < vis.length; i++) {
      if (vis[i] === 1) return true;
    }
    return false;
  };

  const canInteractAtCell3D = (room: (typeof wm.rooms)[number], col: number, row: number, z: number): boolean => {
    if (isCellVisited3D(room.id, col, row, z)) return true;
    const offsets: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dc, dr] of offsets) {
      if (isCellVisited3D(room.id, col + dc, row + dr, z)) return true;
    }
    return false;
  };

  const canEnterPortal = (p: (typeof wm.portals)[number]): boolean => {
    for (let rr = p.row; rr < p.row + p.rows; rr++) {
      for (let cc = p.col; cc < p.col + p.cols; cc++) {
        if (canInteractAtCell3D(roomMap.get(p.fromRoomId)!, cc, rr, 0)) return true;
      }
    }
    return false;
  };

  const maxPasses = Math.max(32, wm.rooms.length * 4 + wm.portals.length * 2 + 16);
  for (let passIdx = 0; passIdx < maxPasses; passIdx++) {
    let progressed = false;

    for (const roomId of roomSeeds.keys()) {
      visitedByRoom.set(roomId, floodRoom3D(roomId));
    }

    for (const ent of project.entities) {
      if (triggeredInteractions.has(ent.id)) continue;
      const c = resolveEntityComponents(ent, project.prefabs);
      const rule = c.tag ? rulesByTag.get(c.tag) : undefined;
      if (!rule) continue;
      const rId = ent.roomId ?? wm.startRoomId;
      const room = roomMap.get(rId);
      if (!room) continue;
      const storyH = room.storyHeight ?? room.wallExtrudeH ?? 24;
      const col = Math.max(0, Math.min(room.cols - 1, Math.floor((c.transform.x + (c.transform.w ?? ts) * 0.5) / ts)));
      const row = Math.max(0, Math.min(room.rows - 1, Math.floor((c.transform.y + (c.transform.h ?? ts) * 0.5) / ts)));
      const ez = Math.max(0, Math.min(MAX_VOXEL_STORIES - 1, Math.floor(((c.spatial3d?.z ?? 0) + 2) / storyH)));
      if (!canInteractAtCell3D(room, col, row, ez)) continue;

      triggeredInteractions.add(ent.id);
      progressed = true;
      if (rule.setGlobal) {
        globals[rule.setGlobal] = rule.setGlobalValue ?? 1;
      }
      if (rule.addGlobal) {
        const nextVal = (globals[rule.addGlobal] ?? 0) + (rule.addGlobalDelta ?? 1);
        globals[rule.addGlobal] = nextVal;
        const target = rule.thresholdTargetGlobal
          ? (globals[rule.thresholdTargetGlobal] || rule.thresholdCount || 1)
          : (rule.thresholdCount ?? 0);
        if (rule.thresholdUnlockGlobal && target > 0 && nextVal >= target) {
          globals[rule.thresholdUnlockGlobal] = 1;
        }
      }
    }

    for (const p of wm.portals) {
      const fromRoom = roomMap.get(p.fromRoomId);
      const toRoom = roomMap.get(p.toRoomId);
      if (!fromRoom || !toRoom) continue;
      const unlocked = !p.requiresGlobal || (globals[p.requiresGlobal] ?? 0) >= 1;
      if (!unlocked) continue;
      if (!canEnterPortal(p)) continue;
      const tc = Math.max(0, Math.min(toRoom.cols - 1, Math.floor(p.targetX / ts)));
      const tr = Math.max(0, Math.min(toRoom.rows - 1, Math.floor(p.targetY / ts)));
      const existing = roomSeeds.get(p.toRoomId) ?? [];
      if (!existing.some(([ec, er, ez]) => ec === tc && er === tr && ez === 0)) {
        existing.push([tc, tr, 0]);
        roomSeeds.set(p.toRoomId, existing);
        progressed = true;
      }
    }

    if (!progressed) break;
  }

  for (const roomId of roomSeeds.keys()) {
    visitedByRoom.set(roomId, floodRoom3D(roomId));
  }

  let maxStoryReached = 0;
  let reachableCellCount3D = 0;
  for (const r of wm.rooms) {
    const vis = visitedByRoom.get(r.id);
    if (!vis) continue;
    const layerSize = r.cols * r.rows;
    for (let i = 0; i < vis.length; i++) {
      if (vis[i] === 1) {
        reachableCellCount3D++;
        const z = (i / layerSize) | 0;
        if (z > maxStoryReached) maxStoryReached = z;
      }
    }
  }

  const reachableRoomIds = wm.rooms.filter((r) => hasVisitedCells(r.id)).map((r) => r.id);
  const unreachableRoomIds = wm.rooms.filter((r) => !hasVisitedCells(r.id)).map((r) => r.id);
  const reachableInteractionIds: string[] = [];
  const unreachableInteractionIds: string[] = [];
  const reachableBossIds: string[] = [];
  const unreachableBossIds: string[] = [];
  const softLockRisks: string[] = [];
  const diagnostics: string[] = [];

  const startVol = compileRoomVol(startRoom);
  if (!isCellPassableAtStory(startVol, startRoom, startCol, startRow, startZ)) {
    softLockRisks.push(
      `Hero spawn cell (${startCol},${startRow},z${startZ}) in start room "${startRoom.id}" is solid or hazardous`,
    );
  }

  const bossOrVictoryRoomIds = new Set<string>();
  for (const ent of project.entities) {
    const c = resolveEntityComponents(ent, project.prefabs);
    const tag = c.tag ?? '';
    const rId = ent.roomId ?? wm.startRoomId;
    const room = roomMap.get(rId);
    if (!room) continue;
    const storyH = room.storyHeight ?? room.wallExtrudeH ?? 24;
    const col = Math.max(0, Math.min(room.cols - 1, Math.floor((c.transform.x + (c.transform.w ?? ts) * 0.5) / ts)));
    const row = Math.max(0, Math.min(room.rows - 1, Math.floor((c.transform.y + (c.transform.h ?? ts) * 0.5) / ts)));
    const ez = Math.max(0, Math.min(MAX_VOXEL_STORIES - 1, Math.floor(((c.spatial3d?.z ?? 0) + 2) / storyH)));
    const reached = canInteractAtCell3D(room, col, row, ez);

    if (rulesByTag.has(tag)) {
      if (reached) reachableInteractionIds.push(ent.id);
      else {
        unreachableInteractionIds.push(ent.id);
        softLockRisks.push(`Interactive entity "${ent.id}" (tag="${tag}") in room "${rId}" (${col},${row},z${ez}) is unreachable`);
      }
    }
    if (aiProfiles[tag]?.isBoss) {
      if (reached) {
        reachableBossIds.push(ent.id);
        bossOrVictoryRoomIds.add(rId);
      } else {
        unreachableBossIds.push(ent.id);
        softLockRisks.push(`Boss "${ent.id}" in room "${rId}" (${col},${row},z${ez}) is unreachable`);
      }
    } else if (reached && (aiProfiles[tag]?.winOnDefeat || tag === 'goal' || tag === 'victory')) {
      bossOrVictoryRoomIds.add(rId);
    }
  }

  const lockedPortals: EcsWorldMapReachabilityReport['lockedPortals'] = [];
  const roomsWithOutgoingUnlockedPortal = new Set<string>();
  for (const p of wm.portals) {
    if (p.requiresGlobal && (globals[p.requiresGlobal] ?? 0) < 1) {
      lockedPortals.push({
        portalId: p.id,
        fromRoomId: p.fromRoomId,
        toRoomId: p.toRoomId,
        requiresGlobal: p.requiresGlobal,
      });
      softLockRisks.push(`Portal "${p.id}" requires global "${p.requiresGlobal}" which can never be unlocked`);
      continue;
    }
    const fromRoom = roomMap.get(p.fromRoomId);
    if (fromRoom && hasVisitedCells(p.fromRoomId)) {
      if (!canEnterPortal(p)) {
        softLockRisks.push(
          `Portal "${p.id}" in room "${p.fromRoomId}" (${p.col},${p.row}) is solid-walled or unreachable`,
        );
      } else if (p.toRoomId !== p.fromRoomId && roomMap.has(p.toRoomId)) {
        roomsWithOutgoingUnlockedPortal.add(p.fromRoomId);
      }
    }
  }

  for (const ur of unreachableRoomIds) {
    softLockRisks.push(`Room "${ur}" is unreachable from startRoom "${startRoom.id}"`);
  }

  for (const rId of reachableRoomIds) {
    if (rId === startRoom.id) continue;
    if (!roomsWithOutgoingUnlockedPortal.has(rId) && !bossOrVictoryRoomIds.has(rId)) {
      softLockRisks.push(
        `One-way dead-end room "${rId}": reachable room has no outgoing unlocked portal to another room and no boss/victory trigger`,
      );
    }
  }

  for (const risk of softLockRisks) diagnostics.push(risk);

  return {
    pass: unreachableRoomIds.length === 0 && unreachableBossIds.length === 0 && lockedPortals.length === 0 && softLockRisks.length === 0,
    hasWorldMap: true,
    startRoomId: startRoom.id,
    reachableRoomIds,
    unreachableRoomIds,
    unlockedGlobals: globals,
    reachableInteractionIds,
    unreachableInteractionIds,
    reachableBossIds,
    unreachableBossIds,
    lockedPortals,
    softLockRisks,
    diagnostics,
    maxStoryReached,
    reachableCellCount3D,
  };
}
