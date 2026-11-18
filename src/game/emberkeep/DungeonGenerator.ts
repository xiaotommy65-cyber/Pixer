import { SeededRng } from '../../core/runtime/SeededRng.ts';
import type { DungeonEntityDef, DungeonFloorDef, DungeonModuleDef, GridTileKind } from './DndTypes.ts';
import { EMBERKEEP_DIALOGS, FLOOR_RECIPES, type FloorRecipe } from './EmberkeepCampaignData.ts';

interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

const WIDTH = 32;
const HEIGHT = 20;

function carveRect(grid: string[][], x: number, y: number, w: number, h: number, ch = '.'): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (py > 0 && py < HEIGHT - 1 && px > 0 && px < WIDTH - 1) {
        grid[py][px] = ch;
      }
    }
  }
}

function carveCorridor(grid: string[][], x0: number, y0: number, x1: number, y1: number, horizFirst: boolean): void {
  if (horizFirst) {
    const sx = x0 < x1 ? 1 : -1;
    for (let x = x0; x !== x1; x += sx) grid[y0][x] = '.';
    const sy = y0 < y1 ? 1 : -1;
    for (let y = y0; y !== y1; y += sy) grid[y][x1] = '.';
  } else {
    const sy = y0 < y1 ? 1 : -1;
    for (let y = y0; y !== y1; y += sy) grid[y][x0] = '.';
    const sx = x0 < x1 ? 1 : -1;
    for (let x = x0; x !== x1; x += sx) grid[y1][x] = '.';
  }
  grid[y1][x1] = '.';
}

function buildFloorCandidate(rng: SeededRng, recipe: FloorRecipe, floorIndex: number): DungeonFloorDef {
  const grid: string[][] = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => '#'));

  const sanctumOnWest = recipe.westSanctum;
  const dividerX = sanctumOnWest ? 9 : 22;
  const mainMinX = sanctumOnWest ? 10 : 1;
  const mainMaxX = sanctumOnWest ? WIDTH - 2 : 21;

  const colW = Math.floor((mainMaxX - mainMinX + 1) / 3);
  const rooms: RoomRect[] = [];
  const colOrder = sanctumOnWest ? [2, 1, 0] : [0, 1, 2];

  for (const col of colOrder) {
    for (let row = 0; row < 2; row++) {
      const cellX = mainMinX + col * colW;
      const cellY = row === 0 ? 1 : 10;
      const cellW = col === 2 ? mainMaxX - cellX + 1 : colW;
      const cellH = 9;

      const rw = rng.int(4, Math.max(4, cellW - 2));
      const rh = rng.int(4, Math.max(4, cellH - 2));
      const rx = cellX + rng.int(0, Math.max(0, cellW - rw));
      const ry = cellY + rng.int(0, Math.max(0, cellH - rh));
      carveRect(grid, rx, ry, rw, rh, '.');
      rooms.push({
        x: rx,
        y: ry,
        w: rw,
        h: rh,
        cx: rx + Math.floor(rw / 2),
        cy: ry + Math.floor(rh / 2),
      });
    }
  }

  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(grid, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy, rng.next() < 0.5);
  }
  if (rooms.length >= 4) {
    carveCorridor(grid, rooms[0].cx, rooms[0].cy, rooms[3].cx, rooms[3].cy, true);
  }

  const sX = sanctumOnWest ? 2 : 24;
  const sW = 6;
  const sY = rng.int(4, 9);
  const sH = 6;
  carveRect(grid, sX, sY, sW, sH, '.');
  const sanctum: RoomRect = {
    x: sX,
    y: sY,
    w: sW,
    h: sH,
    cx: sX + Math.floor(sW / 2),
    cy: sY + Math.floor(sH / 2),
  };

  const bridgeRoom = rooms[rooms.length - 1];
  const doorY = sanctum.cy;
  const bridgeApproachX = sanctumOnWest ? dividerX + 1 : dividerX - 1;
  const sanctumEntryX = sanctumOnWest ? dividerX - 1 : dividerX + 1;
  carveCorridor(grid, bridgeRoom.cx, bridgeRoom.cy, bridgeApproachX, doorY, false);
  carveCorridor(grid, sanctumEntryX, doorY, sanctum.cx, sanctum.cy, true);
  grid[doorY][dividerX] = 'L';

  for (let y = 1; y < HEIGHT - 1; y++) {
    if (y !== doorY) grid[y][dividerX] = '#';
  }

  const spawn = { x: rooms[0].cx, y: rooms[0].cy };
  const occupied = new Set<string>([`${spawn.x},${spawn.y}`]);

  const placeProp = (room: RoomRect, dx = 0, dy = 0): { x: number; y: number } => {
    const minX = room.w >= 4 ? room.x + 1 : room.x;
    const maxX = room.w >= 4 ? room.x + room.w - 2 : room.x + room.w - 1;
    const minY = room.h >= 4 ? room.y + 1 : room.y;
    const maxY = room.h >= 4 ? room.y + room.h - 2 : room.y + room.h - 1;
    for (let r = 0; r < 18; r++) {
      const px = r === 0 ? Math.max(minX, Math.min(maxX, room.cx + dx)) : rng.int(minX, maxX);
      const py = r === 0 ? Math.max(minY, Math.min(maxY, room.cy + dy)) : rng.int(minY, maxY);
      const k = `${px},${py}`;
      if (grid[py][px] === '.' && !occupied.has(k)) {
        occupied.add(k);
        return { x: px, y: py };
      }
    }
    for (let py = room.y; py < room.y + room.h; py++) {
      for (let px = room.x; px < room.x + room.w; px++) {
        const k = `${px},${py}`;
        if (grid[py][px] === '.' && !occupied.has(k)) {
          occupied.add(k);
          return { x: px, y: py };
        }
      }
    }
    return { x: room.cx, y: room.cy };
  };

  for (const r of rooms) {
    if (grid[r.y][r.x] === '.' && !occupied.has(`${r.x},${r.y}`)) {
      grid[r.y][r.x] = 'T';
      occupied.add(`${r.x},${r.y}`);
    }
  }
  grid[sanctum.y][sanctum.x] = 'T';
  occupied.add(`${sanctum.x},${sanctum.y}`);

  const trapRoom = rooms[Math.min(rooms.length - 1, 2)];
  const trapPos = placeProp(trapRoom, 1, 1);
  grid[trapPos.y][trapPos.x] = '^';

  if (recipe.hasCampfire) {
    const campPos = placeProp(bridgeRoom, -1, 0);
    grid[campPos.y][campPos.x] = 'C';
  }

  const entities: DungeonEntityDef[] = [];

  if (recipe.npc) {
    const npcPos = placeProp(rooms[0], sanctumOnWest ? -1 : 1, -1);
    entities.push({
      id: recipe.npc.id,
      kind: 'npc',
      name: recipe.npc.name,
      x: npcPos.x,
      y: npcPos.y,
      dialogId: recipe.npc.dialogId,
    });
  }

  const keyRoom = rooms[Math.min(rooms.length - 2, 3)];
  const keyPos = placeProp(keyRoom, 0, 0);
  entities.push({
    id: `key-${floorIndex}`,
    kind: 'chest',
    name: '銀鎖鑰匙箱',
    x: keyPos.x,
    y: keyPos.y,
    loot: 'key',
  });

  const lootRoom = rooms[Math.min(rooms.length - 1, 4)];
  const lootPos = placeProp(lootRoom, 0, 0);
  entities.push({
    id: `loot-${floorIndex}`,
    kind: 'chest',
    name: recipe.extraLoot.name,
    x: lootPos.x,
    y: lootPos.y,
    loot: recipe.extraLoot.loot,
    itemId: recipe.extraLoot.itemId,
  });

  const supPos = placeProp(rooms[1], 0, 0);
  entities.push({
    id: `potion-${floorIndex}`,
    kind: 'chest',
    name: '旅人補給箱',
    x: supPos.x,
    y: supPos.y,
    loot: 'potion',
  });

  recipe.monsters.forEach((arch, mIdx) => {
    const r = rooms[1 + (mIdx % (rooms.length - 1))];
    const mPos = placeProp(r, 0, 0);
    entities.push({
      id: `m-${floorIndex}-${mIdx}`,
      kind: 'monster',
      archetype: arch,
      x: mPos.x,
      y: mPos.y,
    });
  });

  if (recipe.hasMiniBoss) {
    const mbPos = placeProp(sanctum, sanctumOnWest ? 1 : -1, 0);
    entities.push({
      id: `miniboss-${floorIndex}`,
      kind: 'monster',
      archetype: 'miniboss_warden',
      x: mbPos.x,
      y: mbPos.y,
    });
  }

  if (recipe.hasBoss) {
    const bossPos = placeProp(sanctum, 0, 0);
    entities.push({
      id: 'dragon-boss',
      kind: 'monster',
      archetype: 'dragon',
      x: bossPos.x,
      y: bossPos.y,
    });
  } else {
    const stairsPos = placeProp(sanctum, sanctumOnWest ? -1 : 1, 0);
    grid[stairsPos.y][stairsPos.x] = '>';
  }

  return {
    id: recipe.id,
    name: recipe.name,
    map: grid.map((row) => row.join('')),
    spawn,
    entities,
  };
}

function bfsReachable(
  map: string[],
  start: { x: number; y: number },
  passLocked: boolean,
): Set<string> {
  const h = map.length;
  const w = map[0]?.length ?? 0;
  const visited = new Set<string>();
  const q: { x: number; y: number }[] = [start];
  visited.add(`${start.x},${start.y}`);

  while (q.length > 0) {
    const cur = q.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ch = map[ny][nx];
      if (ch === '#') continue;
      if (!passLocked && ch === 'L') continue;
      const key = `${nx},${ny}`;
      if (!visited.has(key)) {
        visited.add(key);
        q.push({ x: nx, y: ny });
      }
    }
  }
  return visited;
}

export function verifyModuleSolvability(mod: DungeonModuleDef): boolean {
  if (!mod.floors.length) return false;
  for (const f of mod.floors) {
    const preLock = bfsReachable(f.map, f.spawn, false);
    const keys = f.entities.filter((e) => e.kind === 'chest' && e.loot === 'key');
    for (const k of keys) {
      if (!preLock.has(`${k.x},${k.y}`)) return false;
    }

    const postLock = bfsReachable(f.map, f.spawn, true);
    let foundStairs = false;
    for (let y = 0; y < f.map.length; y++) {
      for (let x = 0; x < f.map[y].length; x++) {
        if (f.map[y][x] === '>' && postLock.has(`${x},${y}`)) {
          foundStairs = true;
        }
      }
    }
    const hasBoss = f.entities.some((e) => e.archetype === 'dragon' && postLock.has(`${e.x},${e.y}`));
    if (!foundStairs && !hasBoss) return false;
  }
  return true;
}

export function generateEmberkeepCampaign(seed = 0x2026d808): DungeonModuleDef {
  const floors: DungeonFloorDef[] = [];

  for (let i = 0; i < FLOOR_RECIPES.length; i++) {
    const recipe = FLOOR_RECIPES[i];
    let floorDef: DungeonFloorDef | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const rng = new SeededRng((seed ^ ((i + 1) * 0x9e3779b1) ^ (attempt * 131)) >>> 0);
      const candidate = buildFloorCandidate(rng, recipe, i + 1);
      if (verifyModuleSolvability({ title: 'check', floors: [candidate], dialogs: {} })) {
        floorDef = candidate;
        break;
      }
    }
    if (!floorDef) {
      floorDef = buildFloorCandidate(new SeededRng((seed + i) >>> 0), recipe, i + 1);
    }
    floors.push(floorDef);
  }

  return {
    title: '龍與地城：餘燼深淵八層戰記',
    ambientDarkness: 0.72,
    dialogs: EMBERKEEP_DIALOGS,
    floors,
  };
}

export { EMBERKEEP_DIALOGS };
export type { GridTileKind };
