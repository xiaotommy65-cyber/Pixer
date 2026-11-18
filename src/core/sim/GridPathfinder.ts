import { computeSymmetricFovInto, createSymmetricFovScratch, hasGridLineOfSight } from '../math/Visibility2D.ts';

export interface GridPos {
  x: number;
  y: number;
}

const DX4 = [0, 1, 0, -1] as const;
const DY4 = [-1, 0, 1, 0] as const;

export interface PathfinderWorkspace {
  capacity: number;
  searchId: number;
  lastStartKey: number;
  lastGoalKey: number;
  lastReached: boolean;
  openStamp: Uint32Array;
  closedStamp: Uint32Array;
  gScore: Float64Array;
  hScore: Float64Array;
  fScore: Float64Array;
  parentCell: Int32Array;
  heapNodes: Int32Array;
  heapPos: Int32Array;
  tempPath: Int32Array;
}

/**
 * Pre-allocated Zero-GC TypedArray workspace for Binary Min-Heap A* & Dijkstra Flow Fields.
 * Default capacity 16,384 matches MAX_TILEMAP_COLS(256) * MAX_TILEMAP_ROWS(64).
 */
export function createPathfinderWorkspace(capacity = 16384): PathfinderWorkspace {
  const cap = Math.max(64, capacity | 0);
  return {
    capacity: cap,
    searchId: 1,
    lastStartKey: -1,
    lastGoalKey: -1,
    lastReached: false,
    openStamp: new Uint32Array(cap),
    closedStamp: new Uint32Array(cap),
    gScore: new Float64Array(cap),
    hScore: new Float64Array(cap),
    fScore: new Float64Array(cap),
    parentCell: new Int32Array(cap),
    heapNodes: new Int32Array(cap),
    heapPos: new Int32Array(cap).fill(-1),
    tempPath: new Int32Array(cap),
  };
}

let sharedPathWs = createPathfinderWorkspace(16384);
let sharedFovMask = new Uint8Array(16384);
const sharedFovScratch = createSymmetricFovScratch(1024);

function ensureWorkspace(neededCells: number, custom?: PathfinderWorkspace): PathfinderWorkspace {
  const ws = custom ?? sharedPathWs;
  if (ws.capacity < neededCells) {
    let nextCap = ws.capacity * 2;
    while (nextCap < neededCells) nextCap *= 2;
    const grown = createPathfinderWorkspace(nextCap);
    if (!custom) {
      sharedPathWs = grown;
      return grown;
    }
    ws.capacity = grown.capacity;
    ws.openStamp = grown.openStamp;
    ws.closedStamp = grown.closedStamp;
    ws.gScore = grown.gScore;
    ws.hScore = grown.hScore;
    ws.fScore = grown.fScore;
    ws.parentCell = grown.parentCell;
    ws.heapNodes = grown.heapNodes;
    ws.heapPos = grown.heapPos;
    ws.tempPath = grown.tempPath;
    ws.searchId = 1;
    return ws;
  }

  if (ws.searchId >= 0xfffffffe) {
    ws.openStamp.fill(0);
    ws.closedStamp.fill(0);
    ws.searchId = 1;
  } else {
    ws.searchId++;
  }
  return ws;
}

function swapHeap(ws: PathfinderWorkspace, aPos: number, bPos: number): void {
  const na = ws.heapNodes[aPos];
  const nb = ws.heapNodes[bPos];
  ws.heapNodes[aPos] = nb;
  ws.heapNodes[bPos] = na;
  ws.heapPos[nb] = aPos;
  ws.heapPos[na] = bPos;
}

function heapLess(ws: PathfinderWorkspace, nodeA: number, nodeB: number): boolean {
  const fa = ws.fScore[nodeA];
  const fb = ws.fScore[nodeB];
  return fa < fb || (fa === fb && ws.hScore[nodeA] < ws.hScore[nodeB]);
}

function siftUp(ws: PathfinderWorkspace, startPos: number): void {
  let pos = startPos;
  while (pos > 0) {
    const parent = (pos - 1) >> 1;
    if (heapLess(ws, ws.heapNodes[pos], ws.heapNodes[parent])) {
      swapHeap(ws, pos, parent);
      pos = parent;
    } else {
      break;
    }
  }
}

function popMin(ws: PathfinderWorkspace, heapSize: number): number {
  const minNode = ws.heapNodes[0];
  ws.heapPos[minNode] = -1;
  const nextSize = heapSize - 1;
  if (nextSize > 0) {
    const tail = ws.heapNodes[nextSize];
    ws.heapNodes[0] = tail;
    ws.heapPos[tail] = 0;
    let pos = 0;
    while (true) {
      const left = (pos << 1) + 1;
      if (left >= nextSize) break;
      let best = left;
      const right = left + 1;
      if (right < nextSize && heapLess(ws, ws.heapNodes[right], ws.heapNodes[left])) {
        best = right;
      }
      if (heapLess(ws, ws.heapNodes[best], ws.heapNodes[pos])) {
        swapHeap(ws, pos, best);
        pos = best;
      } else {
        break;
      }
    }
  }
  return minNode;
}

function runAStarCore(
  width: number,
  height: number,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  isWalkable: (x: number, y: number) => boolean,
  stepCost?: (x: number, y: number) => number,
  minStepCost = 1,
  customWs?: PathfinderWorkspace,
): PathfinderWorkspace | null {
  const w = width | 0;
  const h = height | 0;
  if (w <= 0 || h <= 0) return null;
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) return null;
  if (gx < 0 || gx >= w || gy < 0 || gy >= h) return null;

  const totalCells = w * h;
  const ws = ensureWorkspace(totalCells, customWs);
  const sid = ws.searchId;
  const minW = Number.isFinite(minStepCost) && minStepCost > 0 ? minStepCost : 0;

  const startKey = sy * w + sx;
  const goalKey = gy * w + gx;
  ws.lastStartKey = startKey;
  ws.lastGoalKey = goalKey;
  if (startKey === goalKey) {
    ws.gScore[startKey] = 0;
    ws.parentCell[startKey] = -1;
    ws.lastReached = true;
    return ws;
  }

  ws.openStamp[startKey] = sid;
  ws.gScore[startKey] = 0;
  ws.hScore[startKey] = (Math.abs(gx - sx) + Math.abs(gy - sy)) * minW;
  ws.fScore[startKey] = ws.hScore[startKey];
  ws.parentCell[startKey] = -1;
  ws.heapNodes[0] = startKey;
  ws.heapPos[startKey] = 0;
  let heapSize = 1;

  let reached = false;
  while (heapSize > 0) {
    const cur = popMin(ws, heapSize--);
    ws.closedStamp[cur] = sid;
    if (cur === goalKey) {
      reached = true;
      break;
    }

    const cx = cur % w;
    const cy = (cur - cx) / w;
    const curG = ws.gScore[cur];

    for (let d = 0; d < 4; d++) {
      const nx = cx + DX4[d];
      const ny = cy + DY4[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nk = ny * w + nx;
      if (nk !== goalKey && !isWalkable(nx, ny)) continue;

      const rawCost = stepCost ? stepCost(nx, ny) : 1;
      const edgeCost = Number.isFinite(rawCost) && rawCost > minW ? rawCost : Math.max(0, minW);
      const nextG = curG + edgeCost;

      const isSeen = ws.openStamp[nk] === sid;
      if (!isSeen || nextG < ws.gScore[nk]) {
        ws.closedStamp[nk] = 0;
        const hEst = (Math.abs(gx - nx) + Math.abs(gy - ny)) * minW;
        if (!isSeen) {
          ws.openStamp[nk] = sid;
          ws.heapPos[nk] = -1;
        }
        ws.gScore[nk] = nextG;
        ws.hScore[nk] = hEst;
        ws.fScore[nk] = nextG + hEst;
        ws.parentCell[nk] = cur;

        const pos = ws.heapPos[nk];
        if (pos >= 0) {
          siftUp(ws, pos);
        } else {
          ws.heapNodes[heapSize] = nk;
          ws.heapPos[nk] = heapSize;
          siftUp(ws, heapSize);
          heapSize++;
        }
      }
    }
  }

  // Clean remaining heapPos markers only for entries left open in heap so next search starts clean
  for (let i = 0; i < heapSize; i++) {
    ws.heapPos[ws.heapNodes[i]] = -1;
  }

  ws.lastReached = reached;
  return ws;
}

/**
 * Zero-GC A* single next cell step (returns cell index `y * width + x` or `-1` if unreachable/at goal).
 * Note: goal cell itself is reachable even if `isWalkable(goal)` returns false (e.g. chest/entity target).
 */
export function findAStarNextCell(
  width: number,
  height: number,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  isWalkable: (x: number, y: number) => boolean,
  stepCost?: (x: number, y: number) => number,
  minStepCost = 1,
  workspace?: PathfinderWorkspace,
): number {
  const sx = startX | 0;
  const sy = startY | 0;
  const gx = goalX | 0;
  const gy = goalY | 0;
  if (sx === gx && sy === gy) return -1;

  const ws = runAStarCore(width, height, sx, sy, gx, gy, isWalkable, stepCost, minStepCost, workspace);
  if (!ws || !ws.lastReached) return -1;

  const startKey = ws.lastStartKey;
  let cur = ws.lastGoalKey;
  while (cur >= 0) {
    const p = ws.parentCell[cur];
    if (p === startKey) return cur;
    cur = p;
  }
  return -1;
}

/**
 * Zero-GC Binary Min-Heap A* full path search writing cell indices `[startKey, ..., goalKey]` into `outPathCells`.
 * Returns number of cells written (or `0` if unreachable), and updates optional `outMeta` with exact total cost & steps.
 */
export function findAStarPathInto(
  width: number,
  height: number,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  isWalkable: (x: number, y: number) => boolean,
  outPathCells: Int32Array | Uint16Array,
  outMeta?: { totalCost: number; steps: number },
  stepCost?: (x: number, y: number) => number,
  minStepCost = 1,
  workspace?: PathfinderWorkspace,
): number {
  const sx = startX | 0;
  const sy = startY | 0;
  const gx = goalX | 0;
  const gy = goalY | 0;

  const ws = runAStarCore(width, height, sx, sy, gx, gy, isWalkable, stepCost, minStepCost, workspace);
  if (!ws || !ws.lastReached) {
    if (outMeta) {
      outMeta.totalCost = Infinity;
      outMeta.steps = 0;
    }
    return 0;
  }

  const goalKey = ws.lastGoalKey;
  let count = 0;
  let cur = goalKey;
  while (cur >= 0 && count < ws.tempPath.length) {
    ws.tempPath[count++] = cur;
    cur = ws.parentCell[cur];
  }

  const writeCount = count < outPathCells.length ? count : outPathCells.length;
  for (let i = 0; i < writeCount; i++) {
    outPathCells[i] = ws.tempPath[count - 1 - i];
  }

  if (outMeta) {
    outMeta.totalCost = ws.gScore[goalKey];
    outMeta.steps = count;
  }
  return writeCount;
}

/**
 * Shortest step on a 4-connected integer grid using Zero-GC Binary Min-Heap A*.
 * Returns the immediate next tile to step onto toward `goal`, or `null` if unreachable / already there.
 */
export function findNextStep(
  width: number,
  height: number,
  start: GridPos,
  goal: GridPos,
  isWalkable: (x: number, y: number) => boolean,
  stepCost?: (x: number, y: number) => number,
  minStepCost = 1,
): GridPos | null {
  const w = width | 0;
  const nextCell = findAStarNextCell(w, height, start.x, start.y, goal.x, goal.y, isWalkable, stepCost, minStepCost);
  if (nextCell < 0) return null;
  const nx = nextCell % w;
  const ny = (nextCell - nx) / w;
  return { x: nx, y: ny };
}

/**
 * Computes a complete multi-agent Dijkstra Flow Field pointing toward `(goalX, goalY)` (Zero-GC).
 * `outDist[c]` stores exact shortest cost to walk from cell `c` to `goal` (`Infinity` if unreachable);
 * `outDirX[c], outDirY[c]` store the optimal cardinal unit step `(-1 | 0 | 1)` toward `goal`.
 * Returns the count of reachable cells.
 */
export function computeFlowFieldInto(
  width: number,
  height: number,
  goalX: number,
  goalY: number,
  isWalkable: (x: number, y: number) => boolean,
  outDist: Float32Array | Float64Array,
  outDirX: Int8Array,
  outDirY: Int8Array,
  stepCost?: (x: number, y: number) => number,
  minStepCost = 1,
  customWs?: PathfinderWorkspace,
): number {
  const w = width | 0;
  const h = height | 0;
  const gx = goalX | 0;
  const gy = goalY | 0;
  if (w <= 0 || h <= 0) return 0;

  const totalCells = w * h;
  if (outDist.length < totalCells || outDirX.length < totalCells || outDirY.length < totalCells) return 0;
  outDist.fill(Infinity, 0, totalCells);
  outDirX.fill(0, 0, totalCells);
  outDirY.fill(0, 0, totalCells);

  if (gx < 0 || gx >= w || gy < 0 || gy >= h) return 0;

  const ws = ensureWorkspace(totalCells, customWs);
  const sid = ws.searchId;
  const minW = Number.isFinite(minStepCost) && minStepCost > 0 ? minStepCost : 0;

  const goalKey = gy * w + gx;
  const rawGoalEnter = stepCost ? stepCost(gx, gy) : 1;
  const goalEnterCost = Number.isFinite(rawGoalEnter) && rawGoalEnter > minW ? rawGoalEnter : Math.max(0, minW);

  ws.openStamp[goalKey] = sid;
  ws.gScore[goalKey] = 0;
  ws.hScore[goalKey] = 0;
  ws.fScore[goalKey] = 0;
  ws.parentCell[goalKey] = -1;
  ws.heapNodes[0] = goalKey;
  ws.heapPos[goalKey] = 0;
  outDist[goalKey] = 0;

  let heapSize = 1;
  let reachable = 0;

  while (heapSize > 0) {
    const cur = popMin(ws, heapSize--);
    ws.closedStamp[cur] = sid;
    reachable++;

    const cx = cur % w;
    const cy = (cur - cx) / w;
    const curDist = ws.gScore[cur];
    outDist[cur] = curDist;

    const p = ws.parentCell[cur];
    if (p >= 0) {
      const px = p % w;
      const py = (p - px) / w;
      outDirX[cur] = px - cx;
      outDirY[cur] = py - cy;
    }

    // Walking backward from cur <- nb corresponds to forward step nb -> cur costing enterCost(cur)
    let enterCurCost: number;
    if (cur === goalKey) {
      enterCurCost = goalEnterCost;
    } else {
      const rc = stepCost ? stepCost(cx, cy) : 1;
      enterCurCost = Number.isFinite(rc) && rc > minW ? rc : Math.max(0, minW);
    }

    const nextDist = curDist + enterCurCost;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX4[d];
      const ny = cy + DY4[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (!isWalkable(nx, ny)) continue;
      const nk = ny * w + nx;
      if (ws.closedStamp[nk] === sid) continue;

      const isSeen = ws.openStamp[nk] === sid;
      if (!isSeen || nextDist < ws.gScore[nk]) {
        if (!isSeen) {
          ws.openStamp[nk] = sid;
          ws.heapPos[nk] = -1;
        }
        ws.gScore[nk] = nextDist;
        ws.hScore[nk] = 0;
        ws.fScore[nk] = nextDist;
        ws.parentCell[nk] = cur;

        const pos = ws.heapPos[nk];
        if (pos >= 0) {
          siftUp(ws, pos);
        } else {
          ws.heapNodes[heapSize] = nk;
          ws.heapPos[nk] = heapSize;
          siftUp(ws, heapSize);
          heapSize++;
        }
      }
    }
  }

  return reachable;
}

/**
 * Exact symmetric grid line-of-sight check via integer rational DDA (`Visibility2D.hasGridLineOfSight`).
 */
export function hasLineOfSight(
  a: GridPos,
  b: GridPos,
  isOpaque: (x: number, y: number) => boolean,
): boolean {
  return hasGridLineOfSight(a.x, a.y, b.x, b.y, isOpaque);
}

/**
 * Computes circular FOV via O(R^2) Symmetric Shadowcasting (`Visibility2D.computeSymmetricFovInto`)
 * using pre-allocated Zero-GC buffers internally before packaging the `Set<number>` view.
 */
export function computeVisibility(
  width: number,
  height: number,
  origin: GridPos,
  radius: number,
  isOpaque: (x: number, y: number) => boolean,
): Set<number> {
  const w = width | 0;
  const h = height | 0;
  const visible = new Set<number>();
  if (w <= 0 || h <= 0) return visible;

  const total = w * h;
  if (sharedFovMask.length < total) {
    sharedFovMask = new Uint8Array(total);
  }

  computeSymmetricFovInto(w, h, origin.x, origin.y, radius, isOpaque, sharedFovMask, sharedFovScratch);

  const maxR = Math.max(0, Math.ceil(radius));
  const minY = Math.max(0, (origin.y | 0) - maxR);
  const maxY = Math.min(h - 1, (origin.y | 0) + maxR);
  const minX = Math.max(0, (origin.x | 0) - maxR);
  const maxX = Math.min(w - 1, (origin.x | 0) + maxR);

  for (let y = minY; y <= maxY; y++) {
    const rowOff = y * w;
    for (let x = minX; x <= maxX; x++) {
      const idx = rowOff + x;
      if (sharedFovMask[idx] === 1) {
        visible.add(idx);
      }
    }
  }
  return visible;
}
