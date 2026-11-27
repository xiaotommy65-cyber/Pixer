import { resolveEntityComponents, type EcsProjectV2 } from '../ecs/EcsProjectSchema.ts';
import {
  CASTLE_TILE_IDS,
  getCastleTileDef,
  isRoomCellHazard,
  isRoomCellSolid,
} from '../ecs/EcsTilemapTypes.ts';

export interface EcsRoomAsciiReport {
  ok: boolean;
  roomId: string;
  roomName: string;
  cols: number;
  rows: number;
  tileSize: number;
  lines: string[];
  legend: Record<string, string>;
  portals: Array<{
    id: string;
    name: string;
    col: number;
    row: number;
    cols: number;
    rows: number;
    toRoomId: string;
    requiresGlobal?: string;
  }>;
  entities: Array<{
    id: string;
    name: string;
    tag: string;
    col: number;
    row: number;
    glyph: string;
  }>;
}

/**
 * Renders a compact, token-efficient 2D ASCII blueprint of a WorldMap room so AI agents
 * can inspect exact walls, floors, hazards, portals, and entity placements in ~150 tokens.
 */
export function renderRoomAscii(project: EcsProjectV2, roomId?: string): EcsRoomAsciiReport {
  const wm = project.worldMap;
  if (!wm || wm.rooms.length === 0) {
    return {
      ok: false,
      roomId: '',
      roomName: '',
      cols: 0,
      rows: 0,
      tileSize: 32,
      lines: [],
      legend: {},
      portals: [],
      entities: [],
    };
  }
  const room =
    (roomId ? wm.rooms.find((r) => r.id === roomId) : undefined) ??
    wm.rooms.find((r) => r.id === wm.startRoomId) ??
    wm.rooms[0];
  const ts = wm.tileSize;
  const grid: string[][] = [];
  for (let r = 0; r < room.rows; r++) {
    const rowChars: string[] = [];
    for (let c = 0; c < room.cols; c++) {
      const idx = r * room.cols + c;
      const wId = room.wall[idx] ?? 0;
      const dId = room.decor[idx] ?? 0;
      const gId = room.ground[idx] ?? 0;
      let ch = '.';
      if (wId > 0) {
        const wDef = getCastleTileDef(wId, wm.tileDefs);
        if (wDef?.unlockGlobal) ch = 'G';
        else if (wId === CASTLE_TILE_IDS.WALL_STAINED_GLASS) ch = 'W';
        else if (wId === CASTLE_TILE_IDS.WALL_BRICK) ch = 'B';
        else if (wId === CASTLE_TILE_IDS.WALL_LOW_PARAPET) ch = 'h';
        else ch = '#';
      } else if (dId > 0) {
        const dDef = getCastleTileDef(dId, wm.tileDefs);
        if (dDef?.hazard) ch = '^';
        else if (dId === CASTLE_TILE_IDS.DECOR_PORTAL_ARCH) ch = 'A';
        else ch = 'd';
      } else if (gId > 0) {
        const gDef = getCastleTileDef(gId, wm.tileDefs);
        if (gDef?.hazard) ch = '~';
        else if (gId === CASTLE_TILE_IDS.CARPET_V || gId === CASTLE_TILE_IDS.CARPET_H) ch = '=';
        else if (gId === CASTLE_TILE_IDS.STONE_STAIRS) ch = 'S';
        else if (gId === CASTLE_TILE_IDS.MAGIC_SEAL) ch = '*';
        else if (gId === CASTLE_TILE_IDS.IRON_GRATE) ch = '+';
        else ch = '.';
      }
      rowChars.push(ch);
    }
    grid.push(rowChars);
  }

  const roomPortals = wm.portals.filter((p) => p.fromRoomId === room.id);
  for (const p of roomPortals) {
    for (let rr = p.row; rr < p.row + p.rows; rr++) {
      for (let cc = p.col; cc < p.col + p.cols; cc++) {
        if (rr >= 0 && rr < room.rows && cc >= 0 && cc < room.cols) {
          if (grid[rr][cc] !== 'G') grid[rr][cc] = 'P';
        }
      }
    }
  }

  const interactionTags = new Set((wm.interactions ?? []).map((r) => r.tag));
  const aiProfiles = wm.aiProfiles ?? {};
  const entityList: EcsRoomAsciiReport['entities'] = [];

  for (const ent of project.entities) {
    const c = resolveEntityComponents(ent, project.prefabs);
    const tag = c.tag ?? 'prop';
    const isHero = tag === 'hero' || tag === 'player';
    const entRoom = ent.roomId ?? wm.startRoomId;
    if (entRoom !== room.id && !(isHero && room.id === wm.startRoomId)) continue;
    const cx = c.transform.x + (c.transform.w ?? ts) * 0.5;
    const cy = c.transform.y + (c.transform.h ?? ts) * 0.5;
    const col = Math.max(0, Math.min(room.cols - 1, Math.floor(cx / ts)));
    const row = Math.max(0, Math.min(room.rows - 1, Math.floor(cy / ts)));
    let glyph = 'o';
    if (isHero) glyph = '@';
    else if (aiProfiles[tag]?.isBoss) glyph = '!';
    else if (aiProfiles[tag]) glyph = 'E';
    else if (interactionTags.has(tag)) glyph = '?';
    else if (tag === 'torch' || tag === 'brazier') glyph = 't';
    grid[row][col] = glyph;
    entityList.push({ id: ent.id, name: ent.name, tag, col, row, glyph });
  }

  return {
    ok: true,
    roomId: room.id,
    roomName: room.name,
    cols: room.cols,
    rows: room.rows,
    tileSize: ts,
    lines: grid.map((r) => r.join('')),
    legend: {
      '.': 'walkable floor',
      '=': 'carpet',
      'S': 'stairs/bridge',
      '*': 'magic seal',
      '+': 'iron grate',
      '~': 'lava/hazard',
      '#': 'gothic wall',
      'B': 'brick wall',
      'W': 'stained glass',
      'h': 'low parapet',
      'G': 'locked gate (unlockGlobal)',
      '^': 'spike hazard',
      'P': 'portal zone',
      '@': 'hero',
      '!': 'boss',
      'E': 'enemy',
      '?': 'interactive prop',
      't': 'torch/light',
      'o': 'prop/pillar',
    },
    portals: roomPortals.map((p) => ({
      id: p.id,
      name: p.name,
      col: p.col,
      row: p.row,
      cols: p.cols,
      rows: p.rows,
      toRoomId: p.toRoomId,
      ...(p.requiresGlobal ? { requiresGlobal: p.requiresGlobal } : {}),
    })),
    entities: entityList,
  };
}

export interface EcsWorldMapReachabilityReport {
  pass: boolean;
  hasWorldMap: boolean;
  startRoomId: string;
  reachableRoomIds: string[];
  unreachableRoomIds: string[];
  unlockedGlobals: Record<string, number>;
  reachableInteractionIds: string[];
  unreachableInteractionIds: string[];
  reachableBossIds: string[];
  unreachableBossIds: string[];
  lockedPortals: Array<{ portalId: string; fromRoomId: string; toRoomId: string; requiresGlobal: string }>;
  softLockRisks: string[];
  diagnostics: string[];
}

/**
 * Deterministic Multi-Room BFS + Key/Switch Dependency Fixed-Point Solver.
 * Proves whether the Hero can physically walk across rooms, collect keys/triggers,
 * unlock gates & portals, and reach every room and Boss without soft-locks.
 */
export function analyzeWorldMapReachability(project: EcsProjectV2): EcsWorldMapReachabilityReport {
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
    };
  }

  const ts = wm.tileSize;
  const roomMap = new Map(wm.rooms.map((r) => [r.id, r]));
  const startRoom = roomMap.get(wm.startRoomId) ?? wm.rooms[0];

  // Locate hero spawn
  const heroEnt = project.entities.find((e) => {
    const c = resolveEntityComponents(e, project.prefabs);
    return c.tag === 'hero' || c.tag === 'player' || Boolean(c.characterMotor2d);
  });
  const heroComp = heroEnt ? resolveEntityComponents(heroEnt, project.prefabs) : null;
  const startCol = heroComp
    ? Math.max(0, Math.min(startRoom.cols - 1, Math.floor((heroComp.transform.x + (heroComp.transform.w ?? ts) * 0.5) / ts)))
    : Math.floor(startRoom.cols * 0.5);
  const startRow = heroComp
    ? Math.max(0, Math.min(startRoom.rows - 1, Math.floor((heroComp.transform.y + (heroComp.transform.h ?? ts) * 0.5) / ts)))
    : Math.floor(startRoom.rows * 0.5);

  // Simulated globals starting from project.globals
  const globals: Record<string, number> = { ...project.globals };
  const roomSeeds = new Map<string, Array<[number, number]>>();
  roomSeeds.set(startRoom.id, [[startCol, startRow]]);

  const visitedByRoom = new Map<string, Uint8Array>();
  const triggeredInteractions = new Set<string>();
  const rulesByTag = new Map((wm.interactions ?? []).map((r) => [r.tag, r]));
  const aiProfiles = wm.aiProfiles ?? {};

  const floodRoom = (roomId: string): Uint8Array => {
    const room = roomMap.get(roomId)!;
    const vis = new Uint8Array(room.cols * room.rows);
    const seeds = roomSeeds.get(roomId) ?? [];
    const queue: number[] = [];
    for (const [sc, sr] of seeds) {
      if (sc < 0 || sr < 0 || sc >= room.cols || sr >= room.rows) continue;
      if (isRoomCellSolid(room, sc, sr, globals, wm.tileDefs)) continue;
      if (isRoomCellHazard(room, sc, sr, wm.tileDefs)) continue;
      const idx = sr * room.cols + sc;
      if (!vis[idx]) {
        vis[idx] = 1;
        queue.push(idx);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      const c = idx % room.cols;
      const r = (idx / room.cols) | 0;
      const neighbors: Array<[number, number]> = [
        [c + 1, r],
        [c - 1, r],
        [c, r + 1],
        [c, r - 1],
      ];
      for (const [nc, nr] of neighbors) {
        if (nc < 0 || nr < 0 || nc >= room.cols || nr >= room.rows) continue;
        const nIdx = nr * room.cols + nc;
        if (vis[nIdx]) continue;
        if (isRoomCellSolid(room, nc, nr, globals, wm.tileDefs)) continue;
        if (isRoomCellHazard(room, nc, nr, wm.tileDefs)) continue;
        vis[nIdx] = 1;
        queue.push(nIdx);
      }
    }
    return vis;
  };

  const isCellVisited = (roomId: string, col: number, row: number): boolean => {
    const room = roomMap.get(roomId);
    const vis = visitedByRoom.get(roomId);
    if (!room || !vis || col < 0 || row < 0 || col >= room.cols || row >= room.rows) return false;
    return vis[row * room.cols + col] === 1;
  };

  const hasVisitedCells = (roomId: string): boolean => {
    const vis = visitedByRoom.get(roomId);
    if (!vis) return false;
    for (let i = 0; i < vis.length; i++) {
      if (vis[i] === 1) return true;
    }
    return false;
  };

  const isCellOrNeighborVisited = (roomId: string, col: number, row: number): boolean => {
    const room = roomMap.get(roomId);
    const vis = visitedByRoom.get(roomId);
    if (!room || !vis) return false;
    const offsets: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dc, dr] of offsets) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc >= 0 && nr >= 0 && nc < room.cols && nr < room.rows && vis[nr * room.cols + nc]) {
        return true;
      }
    }
    return false;
  };

  const canInteractAtCell = (room: (typeof wm.rooms)[number], col: number, row: number): boolean => {
    if (isCellVisited(room.id, col, row)) return true;
    if (isRoomCellSolid(room, col, row, globals, wm.tileDefs)) return false;
    return isCellOrNeighborVisited(room.id, col, row);
  };

  const canEnterPortal = (p: (typeof wm.portals)[number], fromRoom: (typeof wm.rooms)[number]): boolean => {
    for (let rr = p.row; rr < p.row + p.rows; rr++) {
      for (let cc = p.col; cc < p.col + p.cols; cc++) {
        if (isCellVisited(p.fromRoomId, cc, rr)) return true;
        if (
          !isRoomCellSolid(fromRoom, cc, rr, globals, wm.tileDefs) &&
          !isRoomCellHazard(fromRoom, cc, rr, wm.tileDefs) &&
          isCellOrNeighborVisited(p.fromRoomId, cc, rr)
        ) {
          return true;
        }
      }
    }
    return false;
  };

  // Fixed-point progression loop (handles chained keys -> portals -> switches -> sealed gates)
  const maxPasses = Math.max(32, wm.rooms.length * 4 + wm.portals.length * 2 + 16);
  for (let passIdx = 0; passIdx < maxPasses; passIdx++) {
    let progressed = false;

    for (const roomId of roomSeeds.keys()) {
      visitedByRoom.set(roomId, floodRoom(roomId));
    }

    // 1. Trigger any newly reachable interactive props
    for (const ent of project.entities) {
      if (triggeredInteractions.has(ent.id)) continue;
      const c = resolveEntityComponents(ent, project.prefabs);
      const rule = c.tag ? rulesByTag.get(c.tag) : undefined;
      if (!rule) continue;
      const rId = ent.roomId ?? wm.startRoomId;
      const room = roomMap.get(rId);
      if (!room) continue;
      const col = Math.max(0, Math.min(room.cols - 1, Math.floor((c.transform.x + (c.transform.w ?? ts) * 0.5) / ts)));
      const row = Math.max(0, Math.min(room.rows - 1, Math.floor((c.transform.y + (c.transform.h ?? ts) * 0.5) / ts)));
      if (!canInteractAtCell(room, col, row)) continue;

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

    // 2. Traverse any newly reachable unlocked portals
    for (const p of wm.portals) {
      const fromRoom = roomMap.get(p.fromRoomId);
      const toRoom = roomMap.get(p.toRoomId);
      if (!fromRoom || !toRoom) continue;
      const unlocked = !p.requiresGlobal || (globals[p.requiresGlobal] ?? 0) >= 1;
      if (!unlocked) continue;
      if (!canEnterPortal(p, fromRoom)) continue;
      const tc = Math.max(0, Math.min(toRoom.cols - 1, Math.floor(p.targetX / ts)));
      const tr = Math.max(0, Math.min(toRoom.rows - 1, Math.floor(p.targetY / ts)));
      const existing = roomSeeds.get(p.toRoomId) ?? [];
      if (!existing.some(([ec, er]) => ec === tc && er === tr)) {
        existing.push([tc, tr]);
        roomSeeds.set(p.toRoomId, existing);
        progressed = true;
      }
    }

    if (!progressed) break;
  }

  // Final flood with all unlocked globals
  for (const roomId of roomSeeds.keys()) {
    visitedByRoom.set(roomId, floodRoom(roomId));
  }

  const reachableRoomIds = wm.rooms.filter((r) => hasVisitedCells(r.id)).map((r) => r.id);
  const unreachableRoomIds = wm.rooms.filter((r) => !hasVisitedCells(r.id)).map((r) => r.id);
  const reachableInteractionIds: string[] = [];
  const unreachableInteractionIds: string[] = [];
  const reachableBossIds: string[] = [];
  const unreachableBossIds: string[] = [];
  const softLockRisks: string[] = [];
  const diagnostics: string[] = [];

  if (
    isRoomCellSolid(startRoom, startCol, startRow, globals, wm.tileDefs) ||
    isRoomCellHazard(startRoom, startCol, startRow, wm.tileDefs)
  ) {
    softLockRisks.push(
      `Hero spawn cell (${startCol},${startRow}) in start room "${startRoom.id}" is solid or hazardous`,
    );
  }

  const hasWinScript = (scriptRefs: readonly string[] | undefined): boolean => {
    if (!scriptRefs || scriptRefs.length === 0) return false;
    for (const sid of scriptRefs) {
      const s = project.scripts[sid];
      if (!s) continue;
      for (const rule of s.rules) {
        for (const op of rule.ops) {
          if (op.op === 'set_status' && op.status === 'won') return true;
        }
      }
    }
    return false;
  };

  const bossOrVictoryRoomIds = new Set<string>();

  for (const ent of project.entities) {
    const c = resolveEntityComponents(ent, project.prefabs);
    const tag = c.tag ?? '';
    const rId = ent.roomId ?? wm.startRoomId;
    const room = roomMap.get(rId);
    if (!room) continue;
    const col = Math.max(0, Math.min(room.cols - 1, Math.floor((c.transform.x + (c.transform.w ?? ts) * 0.5) / ts)));
    const row = Math.max(0, Math.min(room.rows - 1, Math.floor((c.transform.y + (c.transform.h ?? ts) * 0.5) / ts)));
    const reached = canInteractAtCell(room, col, row);

    if (rulesByTag.has(tag)) {
      if (reached) reachableInteractionIds.push(ent.id);
      else {
        unreachableInteractionIds.push(ent.id);
        softLockRisks.push(`Interactive entity "${ent.id}" (tag="${tag}") in room "${rId}" (${col},${row}) is unreachable`);
      }
    }
    if (aiProfiles[tag]?.isBoss) {
      if (reached) {
        reachableBossIds.push(ent.id);
        bossOrVictoryRoomIds.add(rId);
      } else {
        unreachableBossIds.push(ent.id);
        softLockRisks.push(`Boss "${ent.id}" in room "${rId}" (${col},${row}) is unreachable`);
      }
    } else if (
      reached &&
      (aiProfiles[tag]?.winOnDefeat ||
        tag === 'goal' ||
        tag === 'victory' ||
        hasWinScript(c.scripts))
    ) {
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
      if (!canEnterPortal(p, fromRoom)) {
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

  // One-way dead-end room detection: reachable non-start room with no outgoing unlocked portal back to another room and no boss/victory trigger
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
  };
}
