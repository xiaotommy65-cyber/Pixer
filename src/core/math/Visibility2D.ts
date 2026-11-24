/**
 * Zero-GC 2D Visibility, Symmetric Shadowcasting FOV & Sub-Pixel 2D DDA Raycasting.
 *
 * Structural choice (vs Bresenham bounding-box O(R^3) scans & Set<number> allocations):
 * - Symmetric Shadowcasting scans each visible cone strictly linearly in O(R^2) using
 *   exact integer rational slopes `(num, den)` stored in a pre-allocated TypedArray DFS stack.
 * - Guarantees mathematical symmetry (`A sees B <=> B sees A`) with zero floating-point
 *   repeating-decimal drift on diagonal boundaries.
 * - Amanatides & Woo 2D DDA provides exact sub-pixel hit coordinates, hit normals, and
 *   exact rational cell-to-cell LOS checks with zero heap allocations.
 */

export type VecOut = Float64Array | Float32Array | number[];

export interface SymmetricFovScratch {
  stackDepth: Int32Array;
  stackStartNum: Int32Array;
  stackStartDen: Int32Array;
  stackEndNum: Int32Array;
  stackEndDen: Int32Array;
}

export function createSymmetricFovScratch(capacity = 1024): SymmetricFovScratch {
  const cap = Math.max(64, capacity | 0);
  return {
    stackDepth: new Int32Array(cap),
    stackStartNum: new Int32Array(cap),
    stackStartDen: new Int32Array(cap),
    stackEndNum: new Int32Array(cap),
    stackEndDen: new Int32Array(cap),
  };
}

let sharedFovScratch = createSymmetricFovScratch(1024);

function ensureFovScratch(needed: number, custom?: SymmetricFovScratch): SymmetricFovScratch {
  const s = custom ?? sharedFovScratch;
  if (s.stackDepth.length >= needed) return s;
  const nextCap = Math.max(needed, s.stackDepth.length * 2);
  const grown = createSymmetricFovScratch(nextCap);
  grown.stackDepth.set(s.stackDepth);
  grown.stackStartNum.set(s.stackStartNum);
  grown.stackStartDen.set(s.stackStartDen);
  grown.stackEndNum.set(s.stackEndNum);
  grown.stackEndDen.set(s.stackEndDen);
  if (!custom) {
    sharedFovScratch = grown;
  } else {
    custom.stackDepth = grown.stackDepth;
    custom.stackStartNum = grown.stackStartNum;
    custom.stackStartDen = grown.stackStartDen;
    custom.stackEndNum = grown.stackEndNum;
    custom.stackEndDen = grown.stackEndDen;
  }
  return grown;
}

/**
 * Computes circular Euclidean Symmetric Shadowcasting FOV into a pre-allocated `Uint8Array` mask (`1 = visible`, `0 = hidden`).
 * Exact integer rational slopes `(num, den)` guarantee `fov(A)[B] === fov(B)[A]` for all open cell pairs `(A, B)`.
 * Returns the count of unique visible grid cells.
 */
export function computeSymmetricFovInto(
  width: number,
  height: number,
  originX: number,
  originY: number,
  radius: number,
  isOpaque: (x: number, y: number) => boolean,
  outVisible: Uint8Array,
  scratch?: SymmetricFovScratch,
): number {
  const w = width | 0;
  const h = height | 0;
  if (w <= 0 || h <= 0 || !Number.isFinite(radius)) return 0;

  const totalCells = w * h;
  if (outVisible.length < totalCells) return 0;
  outVisible.fill(0, 0, totalCells);

  const ox = originX | 0;
  const oy = originY | 0;
  if (ox < 0 || ox >= w || oy < 0 || oy >= h || radius < 0) return 0;

  const maxDepth = Math.floor(radius);
  const r2 = radius * radius;
  outVisible[oy * w + ox] = 1;
  let visibleCount = 1;
  if (maxDepth === 0) return visibleCount;

  let st = ensureFovScratch(Math.max(256, maxDepth * 4 + 32), scratch);

  for (let q = 0; q < 4; q++) {
    let top = 0;
    st.stackDepth[top] = 1;
    st.stackStartNum[top] = -1;
    st.stackStartDen[top] = 1;
    st.stackEndNum[top] = 1;
    st.stackEndDen[top] = 1;
    top++;

    while (top > 0) {
      top--;
      const depth = st.stackDepth[top];
      let sNum = st.stackStartNum[top];
      let sDen = st.stackStartDen[top];
      const eNum = st.stackEndNum[top];
      const eDen = st.stackEndDen[top];

      // Exact roundTiesUp(depth * sNum / sDen) and roundTiesDown(depth * eNum / eDen)
      const minCol = Math.floor((2 * depth * sNum + sDen) / (2 * sDen));
      const maxCol = Math.ceil((2 * depth * eNum - eDen) / (2 * eDen));
      if (minCol > maxCol) continue;

      let prevInit = false;
      let prevWall = false;
      const d2 = depth * depth;

      for (let col = minCol; col <= maxCol; col++) {
        let wx = ox;
        let wy = oy;
        if (q === 0) {
          wx = ox + col;
          wy = oy - depth;
        } else if (q === 1) {
          wx = ox + col;
          wy = oy + depth;
        } else if (q === 2) {
          wx = ox + depth;
          wy = oy + col;
        } else {
          wx = ox - depth;
          wy = oy + col;
        }

        const inBounds = wx >= 0 && wx < w && wy >= 0 && wy < h;
        const currWall = inBounds ? isOpaque(wx, wy) : true;

        const symmetric = col * sDen >= depth * sNum && col * eDen <= depth * eNum;
        if (inBounds && d2 + col * col <= r2 && (currWall || symmetric)) {
          const cellIdx = wy * w + wx;
          if (outVisible[cellIdx] === 0) {
            outVisible[cellIdx] = 1;
            visibleCount++;
          }
        }

        if (prevInit) {
          if (prevWall && !currWall) {
            sNum = 2 * col - 1;
            sDen = 2 * depth;
          } else if (!prevWall && currWall && depth < maxDepth) {
            if (top + 2 >= st.stackDepth.length) {
              st = ensureFovScratch(st.stackDepth.length * 2, scratch);
            }
            st.stackDepth[top] = depth + 1;
            st.stackStartNum[top] = sNum;
            st.stackStartDen[top] = sDen;
            st.stackEndNum[top] = 2 * col - 1;
            st.stackEndDen[top] = 2 * depth;
            top++;
          }
        }

        prevInit = true;
        prevWall = currWall;
      }

      if (prevInit && !prevWall && depth < maxDepth) {
        if (top + 2 >= st.stackDepth.length) {
          st = ensureFovScratch(st.stackDepth.length * 2, scratch);
        }
        st.stackDepth[top] = depth + 1;
        st.stackStartNum[top] = sNum;
        st.stackStartDen[top] = sDen;
        st.stackEndNum[top] = eNum;
        st.stackEndDen[top] = eDen;
        top++;
      }
    }
  }

  return visibleCount;
}

/**
 * Exact integer-rational center-to-center 2D grid line-of-sight check.
 * Direction-invariant (strictly symmetric: `A -> B` === `B -> A`) with zero floats or heap allocations.
 * Endpoints themselves do not occlude (caller sees target wall/door tile); corner ties only block
 * when BOTH adjacent orthogonal edge cells are opaque.
 */
export function hasGridLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  isOpaque: (x: number, y: number) => boolean,
): boolean {
  let x = ax | 0;
  let y = ay | 0;
  const gx = bx | 0;
  const gy = by | 0;
  if (x === gx && y === gy) return true;

  const dx = gx - x;
  const dy = gy - y;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;

  if (ady === 0) {
    for (let i = 1; i < adx; i++) {
      x += sx;
      if (isOpaque(x, y)) return false;
    }
    return true;
  }
  if (adx === 0) {
    for (let i = 1; i < ady; i++) {
      y += sy;
      if (isOpaque(x, y)) return false;
    }
    return true;
  }

  // Integer scaled t in [0, 2 * adx * ady]:
  // Vertical borders cross at (2*k - 1)*ady; Horizontal borders cross at (2*k - 1)*adx.
  const stepX = 2 * ady;
  const stepY = 2 * adx;
  let tNextX = ady;
  let tNextY = adx;

  while (x !== gx || y !== gy) {
    if (tNextX < tNextY) {
      x += sx;
      tNextX += stepX;
    } else if (tNextY < tNextX) {
      y += sy;
      tNextY += stepY;
    } else {
      // Exact vertex/corner crossing: symmetric bevel check (only block if both adjacent edge cells are opaque)
      if (isOpaque(x + sx, y) && isOpaque(x, y + sy)) {
        return false;
      }
      x += sx;
      y += sy;
      tNextX += stepX;
      tNextY += stepY;
    }

    if (x === gx && y === gy) return true;
    if (isOpaque(x, y)) return false;
  }

  return true;
}

/**
 * Exact Amanatides & Woo 2D DDA Sub-Pixel Grid Raycast (Zero-GC).
 * Writes `[hit (0|1), dist, hitX, hitY, normalX, normalY, hitCol, hitRow]` into `outHit[offset .. offset+7]`.
 * Out-of-bounds boundaries treat edges symmetrically or stop gracefully when leaving grid if `boundsBlock = true` (default false: skips/terminates cleanly).
 */
export function raycastGrid2DInto(
  width: number,
  height: number,
  startX: number,
  startY: number,
  dirX: number,
  dirY: number,
  maxDist: number,
  isOpaque: (x: number, y: number) => boolean,
  outHit: VecOut,
  offset = 0,
  tileSize = 1,
): boolean {
  const w = width | 0;
  const h = height | 0;
  const ts = Number.isFinite(tileSize) && tileSize > 0 ? tileSize : 1;
  const invTs = ts === 1 ? 1 : 1 / ts;

  if (
    w <= 0 ||
    h <= 0 ||
    !Number.isFinite(startX) ||
    !Number.isFinite(startY) ||
    !Number.isFinite(dirX) ||
    !Number.isFinite(dirY) ||
    !Number.isFinite(maxDist) ||
    maxDist <= 0
  ) {
    outHit[offset] = 0;
    outHit[offset + 1] = 0;
    outHit[offset + 2] = Number.isFinite(startX) ? startX : 0;
    outHit[offset + 3] = Number.isFinite(startY) ? startY : 0;
    outHit[offset + 4] = 0;
    outHit[offset + 5] = 0;
    outHit[offset + 6] = -1;
    outHit[offset + 7] = -1;
    return false;
  }

  const lenSq = dirX * dirX + dirY * dirY;
  if (lenSq <= 1e-24) {
    outHit[offset] = 0;
    outHit[offset + 1] = 0;
    outHit[offset + 2] = startX;
    outHit[offset + 3] = startY;
    outHit[offset + 4] = 0;
    outHit[offset + 5] = 0;
    outHit[offset + 6] = -1;
    outHit[offset + 7] = -1;
    return false;
  }

  const invLen = 1 / Math.sqrt(lenSq);
  const ndx = dirX * invLen;
  const ndy = dirY * invLen;

  let cellX = Math.floor(startX * invTs);
  let cellY = Math.floor(startY * invTs);

  if (cellX >= 0 && cellX < w && cellY >= 0 && cellY < h && isOpaque(cellX, cellY)) {
    outHit[offset] = 1;
    outHit[offset + 1] = 0;
    outHit[offset + 2] = startX;
    outHit[offset + 3] = startY;
    outHit[offset + 4] = Math.abs(ndx) >= Math.abs(ndy) ? (ndx >= 0 ? -1 : 1) : 0;
    outHit[offset + 5] = Math.abs(ndy) > Math.abs(ndx) ? (ndy >= 0 ? -1 : 1) : 0;
    outHit[offset + 6] = cellX;
    outHit[offset + 7] = cellY;
    return true;
  }

  const stepX = ndx > 0 ? 1 : ndx < 0 ? -1 : 0;
  const stepY = ndy > 0 ? 1 : ndy < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? ts / Math.abs(ndx) : Infinity;
  const tDeltaY = stepY !== 0 ? ts / Math.abs(ndy) : Infinity;

  let tMaxX = Infinity;
  if (stepX > 0) {
    tMaxX = ((cellX + 1) * ts - startX) / ndx;
  } else if (stepX < 0) {
    tMaxX = (startX - cellX * ts) / -ndx;
  }

  let tMaxY = Infinity;
  if (stepY > 0) {
    tMaxY = ((cellY + 1) * ts - startY) / ndy;
  } else if (stepY < 0) {
    tMaxY = (startY - cellY * ts) / -ndy;
  }

  const maxSteps = w + h + Math.ceil(maxDist * invTs * 2) + 8;
  let t = 0;

  for (let s = 0; s < maxSteps; s++) {
    let nx = 0;
    let ny = 0;

    // Guard tie detection on finite diagonal axes so axis-aligned Infinity never equals Infinity
    const isTie =
      stepX !== 0 &&
      stepY !== 0 &&
      Math.abs(tMaxX - tMaxY) <= 1e-9 * Math.max(1, tMaxX, tMaxY);

    if (isTie) {
      t = 0.5 * (tMaxX + tMaxY);
      if (t > maxDist) break;
      const adjX = cellX + stepX;
      const adjY = cellY + stepY;
      const wallX = adjX >= 0 && adjX < w && cellY >= 0 && cellY < h && isOpaque(adjX, cellY);
      const wallY = cellX >= 0 && cellX < w && adjY >= 0 && adjY < h && isOpaque(cellX, adjY);
      if (wallX && wallY) {
        outHit[offset] = 1;
        outHit[offset + 1] = t;
        outHit[offset + 2] = startX + ndx * t;
        outHit[offset + 3] = startY + ndy * t;
        outHit[offset + 4] = -stepX * Math.SQRT1_2;
        outHit[offset + 5] = -stepY * Math.SQRT1_2;
        outHit[offset + 6] = adjX;
        outHit[offset + 7] = cellY;
        return true;
      }
      cellX = adjX;
      cellY = adjY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      nx = -stepX * Math.SQRT1_2;
      ny = -stepY * Math.SQRT1_2;
    } else if (tMaxX < tMaxY) {
      t = tMaxX;
      if (t > maxDist) break;
      cellX += stepX;
      tMaxX += tDeltaX;
      nx = -stepX;
    } else {
      t = tMaxY;
      if (t > maxDist) break;
      cellY += stepY;
      tMaxY += tDeltaY;
      ny = -stepY;
    }

    if (cellX < 0 || cellX >= w || cellY < 0 || cellY >= h) {
      outHit[offset] = 0;
      outHit[offset + 1] = t;
      outHit[offset + 2] = startX + ndx * t;
      outHit[offset + 3] = startY + ndy * t;
      outHit[offset + 4] = nx;
      outHit[offset + 5] = ny;
      outHit[offset + 6] = -1;
      outHit[offset + 7] = -1;
      return false;
    }

    if (isOpaque(cellX, cellY)) {
      outHit[offset] = 1;
      outHit[offset + 1] = t;
      outHit[offset + 2] = startX + ndx * t;
      outHit[offset + 3] = startY + ndy * t;
      outHit[offset + 4] = nx;
      outHit[offset + 5] = ny;
      outHit[offset + 6] = cellX;
      outHit[offset + 7] = cellY;
      return true;
    }
  }

  outHit[offset] = 0;
  outHit[offset + 1] = maxDist;
  outHit[offset + 2] = startX + ndx * maxDist;
  outHit[offset + 3] = startY + ndy * maxDist;
  outHit[offset + 4] = 0;
  outHit[offset + 5] = 0;
  outHit[offset + 6] = -1;
  outHit[offset + 7] = -1;
  return false;
}
