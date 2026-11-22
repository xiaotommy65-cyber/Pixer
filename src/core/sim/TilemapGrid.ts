export const TILE_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_SIZE = 16;
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE; // 256 cells per 16x16 chunk
export const MAX_TILEMAP_COLS = 1024;
export const MAX_TILEMAP_ROWS = 256;

export const COLLISION_EMPTY = 0;
export const COLLISION_SOLID = 1;
export const COLLISION_CLOUD = 2;
export const COLLISION_HAZARD = 3;
export const COLLISION_DESTRUCTIBLE = 4;
export const COLLISION_SLOPE_UP = 5;   // 45-degree ramp rising left-to-right (/)
export const COLLISION_SLOPE_DOWN = 6; // 45-degree ramp descending left-to-right (\)

export const AUTO_MASK_N = 1;
export const AUTO_MASK_E = 2;
export const AUTO_MASK_S = 4;
export const AUTO_MASK_W = 8;

export interface TileAabbStepResult {
  onGround: boolean;
  hitWall: boolean;
  hitCeiling: boolean;
  hitHazard: boolean;
  landVy: number;
}

/**
 * 16x16 Chunk-Streamed TilemapGrid supporting expansive worlds (>= 1024x256 tiles / 16,384x4,096 px)
 * via a flat Int16Array chunk lookup table and contiguous TypedArray chunk slabs.
 * Empty air chunks allocate zero storage; physics sweeps and camera chunk culling are strictly zero-GC.
 */
export class TilemapGrid {
  public readonly cols: number;
  public readonly rows: number;
  public readonly chunksX: number;
  public readonly chunksY: number;
  public readonly totalChunks: number;

  private readonly chunkTable: Int16Array;

  public tilesSlab: Uint16Array;
  public collisionSlab: Uint8Array;
  public autoMaskSlab: Uint8Array;
  public chunkCoordX: Uint16Array;
  public chunkCoordY: Uint16Array;
  public chunkNonEmpty: Uint16Array;

  private chunkCapacity: number;
  private allocatedChunks = 0;

  /** Pre-allocated active streaming chunk list populated by updateActiveChunks(). */
  public readonly activeChunkIds: Int16Array;
  public readonly activeChunkCols: Uint16Array;
  public readonly activeChunkRows: Uint16Array;
  public activeChunkCount = 0;

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.min(MAX_TILEMAP_COLS, Math.floor(cols)));
    this.rows = Math.max(1, Math.min(MAX_TILEMAP_ROWS, Math.floor(rows)));
    this.chunksX = Math.ceil(this.cols / CHUNK_SIZE);
    this.chunksY = Math.ceil(this.rows / CHUNK_SIZE);
    this.totalChunks = this.chunksX * this.chunksY;

    this.chunkTable = new Int16Array(this.totalChunks).fill(-1);
    this.chunkCapacity = Math.max(1, Math.min(this.totalChunks, 32));
    this.tilesSlab = new Uint16Array(this.chunkCapacity * CHUNK_AREA);
    this.collisionSlab = new Uint8Array(this.chunkCapacity * CHUNK_AREA);
    this.autoMaskSlab = new Uint8Array(this.chunkCapacity * CHUNK_AREA);
    this.chunkCoordX = new Uint16Array(this.chunkCapacity);
    this.chunkCoordY = new Uint16Array(this.chunkCapacity);
    this.chunkNonEmpty = new Uint16Array(this.chunkCapacity);

    this.activeChunkIds = new Int16Array(this.totalChunks);
    this.activeChunkCols = new Uint16Array(this.totalChunks);
    this.activeChunkRows = new Uint16Array(this.totalChunks);
  }

  public clear(): void {
    this.chunkTable.fill(-1);
    if (this.allocatedChunks > 0) {
      const usedCells = this.allocatedChunks * CHUNK_AREA;
      this.tilesSlab.fill(0, 0, usedCells);
      this.collisionSlab.fill(0, 0, usedCells);
      this.autoMaskSlab.fill(0, 0, usedCells);
      this.chunkNonEmpty.fill(0, 0, this.allocatedChunks);
    }
    this.allocatedChunks = 0;
    this.activeChunkCount = 0;
  }

  public inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  public index(col: number, row: number): number {
    return row * this.cols + col;
  }

  public getChunkSlot(chunkCol: number, chunkRow: number): number {
    if (chunkCol < 0 || chunkCol >= this.chunksX || chunkRow < 0 || chunkRow >= this.chunksY) return -1;
    return this.chunkTable[chunkRow * this.chunksX + chunkCol];
  }

  public getAllocatedChunkCount(): number {
    return this.allocatedChunks;
  }

  public getActiveChunkCount(): number {
    return this.activeChunkCount;
  }

  public getChunkNonEmptyCount(slot: number): number {
    if (slot < 0 || slot >= this.allocatedChunks) return 0;
    return this.chunkNonEmpty[slot];
  }

  public countNonEmptyTiles(): number {
    let total = 0;
    for (let s = 0; s < this.allocatedChunks; s++) {
      total += this.chunkNonEmpty[s];
    }
    return total;
  }

  private ensureChunkSlot(cc: number, cr: number): number {
    const tblIdx = cr * this.chunksX + cc;
    const existing = this.chunkTable[tblIdx];
    if (existing >= 0) return existing;

    if (this.allocatedChunks >= this.chunkCapacity) {
      const nextCap = Math.min(this.totalChunks, Math.max(this.chunkCapacity + 16, this.chunkCapacity * 2));
      const nextTiles = new Uint16Array(nextCap * CHUNK_AREA);
      nextTiles.set(this.tilesSlab);
      const nextCol = new Uint8Array(nextCap * CHUNK_AREA);
      nextCol.set(this.collisionSlab);
      const nextMask = new Uint8Array(nextCap * CHUNK_AREA);
      nextMask.set(this.autoMaskSlab);
      const nextCx = new Uint16Array(nextCap);
      nextCx.set(this.chunkCoordX);
      const nextCy = new Uint16Array(nextCap);
      nextCy.set(this.chunkCoordY);
      const nextCount = new Uint16Array(nextCap);
      nextCount.set(this.chunkNonEmpty);

      this.tilesSlab = nextTiles;
      this.collisionSlab = nextCol;
      this.autoMaskSlab = nextMask;
      this.chunkCoordX = nextCx;
      this.chunkCoordY = nextCy;
      this.chunkNonEmpty = nextCount;
      this.chunkCapacity = nextCap;
    }

    const slot = this.allocatedChunks++;
    this.chunkTable[tblIdx] = slot;
    this.chunkCoordX[slot] = cc;
    this.chunkCoordY[slot] = cr;
    this.chunkNonEmpty[slot] = 0;
    return slot;
  }

  public getTile(col: number, row: number): number {
    if (!this.inBounds(col, row)) return 0;
    const slot = this.chunkTable[(row >> CHUNK_SHIFT) * this.chunksX + (col >> CHUNK_SHIFT)];
    if (slot < 0) return 0;
    return this.tilesSlab[(slot << 8) | ((row & CHUNK_MASK) << CHUNK_SHIFT) | (col & CHUNK_MASK)];
  }

  public getCollision(col: number, row: number): number {
    if (!this.inBounds(col, row)) return COLLISION_EMPTY;
    const slot = this.chunkTable[(row >> CHUNK_SHIFT) * this.chunksX + (col >> CHUNK_SHIFT)];
    if (slot < 0) return COLLISION_EMPTY;
    return this.collisionSlab[(slot << 8) | ((row & CHUNK_MASK) << CHUNK_SHIFT) | (col & CHUNK_MASK)];
  }

  public getAutoMask(col: number, row: number): number {
    if (!this.inBounds(col, row)) return 0;
    const slot = this.chunkTable[(row >> CHUNK_SHIFT) * this.chunksX + (col >> CHUNK_SHIFT)];
    if (slot < 0) return 0;
    return this.autoMaskSlab[(slot << 8) | ((row & CHUNK_MASK) << CHUNK_SHIFT) | (col & CHUNK_MASK)];
  }

  public setTile(col: number, row: number, tileId: number, colKind = COLLISION_SOLID, updateMask = true): void {
    const c = col | 0;
    const r = row | 0;
    if (!this.inBounds(c, r)) return;
    const cc = c >> CHUNK_SHIFT;
    const cr = r >> CHUNK_SHIFT;
    const tblIdx = cr * this.chunksX + cc;
    let slot = this.chunkTable[tblIdx];

    if (tileId === 0) {
      if (slot >= 0) {
        const idx = (slot << 8) | ((r & CHUNK_MASK) << CHUNK_SHIFT) | (c & CHUNK_MASK);
        if (this.tilesSlab[idx] !== 0) {
          this.tilesSlab[idx] = 0;
          if (this.chunkNonEmpty[slot] > 0) this.chunkNonEmpty[slot]--;
        }
        this.collisionSlab[idx] = COLLISION_EMPTY;
        this.autoMaskSlab[idx] = 0;
      }
      if (updateMask) {
        this.updateMaskAround(c, r);
      }
      return;
    }

    if (slot < 0) slot = this.ensureChunkSlot(cc, cr);
    const idx = (slot << 8) | ((r & CHUNK_MASK) << CHUNK_SHIFT) | (c & CHUNK_MASK);
    if (this.tilesSlab[idx] === 0) {
      this.chunkNonEmpty[slot]++;
    }
    this.tilesSlab[idx] = tileId;
    this.collisionSlab[idx] = colKind;
    if (updateMask) {
      this.updateMaskAround(c, r);
    }
  }

  public fillRectTiles(
    startCol: number,
    startRow: number,
    widthCols: number,
    heightRows: number,
    tileId: number,
    colKind = COLLISION_SOLID,
  ): void {
    const c0 = Math.max(0, startCol | 0);
    const r0 = Math.max(0, startRow | 0);
    const c1 = Math.min(this.cols - 1, (startCol | 0) + (widthCols | 0) - 1);
    const r1 = Math.min(this.rows - 1, (startRow | 0) + (heightRows | 0) - 1);
    if (c1 < c0 || r1 < r0) return;

    const cc0 = c0 >> CHUNK_SHIFT;
    const cc1 = c1 >> CHUNK_SHIFT;
    const cr0 = r0 >> CHUNK_SHIFT;
    const cr1 = r1 >> CHUNK_SHIFT;

    for (let cr = cr0; cr <= cr1; cr++) {
      const baseRow = cr << CHUNK_SHIFT;
      const lr0 = Math.max(0, r0 - baseRow);
      const lr1 = Math.min(CHUNK_MASK, r1 - baseRow);
      for (let cc = cc0; cc <= cc1; cc++) {
        const baseCol = cc << CHUNK_SHIFT;
        const lc0 = Math.max(0, c0 - baseCol);
        const lc1 = Math.min(CHUNK_MASK, c1 - baseCol);
        const tblIdx = cr * this.chunksX + cc;
        let slot = this.chunkTable[tblIdx];

        if (tileId === 0) {
          if (slot < 0) continue;
          const baseSlab = slot << 8;
          for (let lr = lr0; lr <= lr1; lr++) {
            const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
            for (let lc = lc0; lc <= lc1; lc++) {
              const idx = rowSlab | lc;
              if (this.tilesSlab[idx] !== 0) {
                this.tilesSlab[idx] = 0;
                if (this.chunkNonEmpty[slot] > 0) this.chunkNonEmpty[slot]--;
              }
              this.collisionSlab[idx] = COLLISION_EMPTY;
              this.autoMaskSlab[idx] = 0;
            }
          }
          continue;
        }

        if (slot < 0) slot = this.ensureChunkSlot(cc, cr);
        const baseSlab = slot << 8;
        for (let lr = lr0; lr <= lr1; lr++) {
          const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
          for (let lc = lc0; lc <= lc1; lc++) {
            const idx = rowSlab | lc;
            if (this.tilesSlab[idx] === 0) {
              this.chunkNonEmpty[slot]++;
            }
            this.tilesSlab[idx] = tileId;
            this.collisionSlab[idx] = colKind;
          }
        }
      }
    }
    this.recomputeAutoMaskRange(c0 - 1, r0 - 1, c1 + 1, r1 + 1);
  }

  public recomputeAutoMask(): void {
    for (let slot = 0; slot < this.allocatedChunks; slot++) {
      if (this.chunkNonEmpty[slot] === 0) continue;
      const cc = this.chunkCoordX[slot];
      const cr = this.chunkCoordY[slot];
      const baseCol = cc << CHUNK_SHIFT;
      const baseRow = cr << CHUNK_SHIFT;
      const baseSlab = slot << 8;
      const maxLr = Math.min(CHUNK_SIZE, this.rows - baseRow);
      const maxLc = Math.min(CHUNK_SIZE, this.cols - baseCol);

      for (let lr = 0; lr < maxLr; lr++) {
        const r = baseRow + lr;
        const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
        for (let lc = 0; lc < maxLc; lc++) {
          const idx = rowSlab | lc;
          const tid = this.tilesSlab[idx];
          if (tid === 0) {
            this.autoMaskSlab[idx] = 0;
            continue;
          }
          const c = baseCol + lc;
          let mask = 0;
          if (r > 0 && (lr > 0 ? this.tilesSlab[idx - CHUNK_SIZE] : this.getTile(c, r - 1)) === tid) {
            mask |= AUTO_MASK_N;
          }
          if (c + 1 < this.cols && (lc < CHUNK_MASK ? this.tilesSlab[idx + 1] : this.getTile(c + 1, r)) === tid) {
            mask |= AUTO_MASK_E;
          }
          if (r + 1 < this.rows && (lr < CHUNK_MASK ? this.tilesSlab[idx + CHUNK_SIZE] : this.getTile(c, r + 1)) === tid) {
            mask |= AUTO_MASK_S;
          }
          if (c > 0 && (lc > 0 ? this.tilesSlab[idx - 1] : this.getTile(c - 1, r)) === tid) {
            mask |= AUTO_MASK_W;
          }
          this.autoMaskSlab[idx] = mask;
        }
      }
    }
  }

  private updateMaskAround(col: number, row: number): void {
    this.recomputeAutoMaskRange(col - 1, row - 1, col + 1, row + 1);
  }

  private recomputeAutoMaskRange(c0: number, r0: number, c1: number, r1: number): void {
    const minC = Math.max(0, c0);
    const minR = Math.max(0, r0);
    const maxC = Math.min(this.cols - 1, c1);
    const maxR = Math.min(this.rows - 1, r1);
    for (let r = minR; r <= maxR; r++) {
      const cr = r >> CHUNK_SHIFT;
      const lrOffset = (r & CHUNK_MASK) << CHUNK_SHIFT;
      for (let c = minC; c <= maxC; ) {
        const cc = c >> CHUNK_SHIFT;
        const slot = this.chunkTable[cr * this.chunksX + cc];
        const chunkEndC = Math.min(maxC, ((cc + 1) << CHUNK_SHIFT) - 1);
        if (slot < 0 || this.chunkNonEmpty[slot] === 0) {
          c = chunkEndC + 1;
          continue;
        }
        const baseSlab = (slot << 8) | lrOffset;
        for (; c <= chunkEndC; c++) {
          const idx = baseSlab | (c & CHUNK_MASK);
          const tid = this.tilesSlab[idx];
          if (tid === 0) {
            this.autoMaskSlab[idx] = 0;
            continue;
          }
          let mask = 0;
          if (r > 0 && this.getTile(c, r - 1) === tid) mask |= AUTO_MASK_N;
          if (c + 1 < this.cols && this.getTile(c + 1, r) === tid) mask |= AUTO_MASK_E;
          if (r + 1 < this.rows && this.getTile(c, r + 1) === tid) mask |= AUTO_MASK_S;
          if (c > 0 && this.getTile(c - 1, r) === tid) mask |= AUTO_MASK_W;
          this.autoMaskSlab[idx] = mask;
        }
      }
    }
  }

  /**
   * Streams non-empty chunks overlapping the visible viewport + pixel margin into pre-allocated buffers.
   * Returns active chunk count with zero allocations.
   */
  public updateActiveChunks(
    minPxX: number,
    minPxY: number,
    maxPxX: number,
    maxPxY: number,
    marginPx = 64,
  ): number {
    const chunkPx = CHUNK_SIZE * TILE_SIZE;
    const cc0 = Math.max(0, Math.floor((minPxX - marginPx) / chunkPx));
    const cc1 = Math.min(this.chunksX - 1, Math.floor((maxPxX + marginPx) / chunkPx));
    const cr0 = Math.max(0, Math.floor((minPxY - marginPx) / chunkPx));
    const cr1 = Math.min(this.chunksY - 1, Math.floor((maxPxY + marginPx) / chunkPx));
    if (cc1 < cc0 || cr1 < cr0) {
      this.activeChunkCount = 0;
      return 0;
    }

    let count = 0;
    for (let cr = cr0; cr <= cr1; cr++) {
      const rowBase = cr * this.chunksX;
      for (let cc = cc0; cc <= cc1; cc++) {
        const slot = this.chunkTable[rowBase + cc];
        if (slot < 0 || this.chunkNonEmpty[slot] === 0) continue;
        this.activeChunkIds[count] = slot;
        this.activeChunkCols[count] = cc;
        this.activeChunkRows[count] = cr;
        count++;
      }
    }
    this.activeChunkCount = count;
    return count;
  }

  public isSolidAt(col: number, row: number): boolean {
    const k = this.getCollision(col, row);
    return k === COLLISION_SOLID || k === COLLISION_DESTRUCTIBLE;
  }

  public isOneWayAt(col: number, row: number): boolean {
    return this.getCollision(col, row) === COLLISION_CLOUD;
  }

  public isHazardOverlapping(x: number, y: number, w: number, h: number): boolean {
    const c0 = Math.max(0, Math.floor(x / TILE_SIZE));
    const c1 = Math.min(this.cols - 1, Math.floor((x + w - 0.001) / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(y / TILE_SIZE));
    const r1 = Math.min(this.rows - 1, Math.floor((y + h - 0.001) / TILE_SIZE));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.getCollision(c, r) === COLLISION_HAZARD) return true;
      }
    }
    return false;
  }

  public hasFloorAhead(x: number, y: number, w: number, h: number, dirX: number): boolean {
    const probeX = dirX >= 0 ? x + w + 1 : x - 1;
    const probeCol = Math.floor(probeX / TILE_SIZE);
    const footRow = Math.floor((y + h + 2) / TILE_SIZE);
    const k = this.getCollision(probeCol, footRow);
    return (
      k === COLLISION_SOLID ||
      k === COLLISION_CLOUD ||
      k === COLLISION_DESTRUCTIBLE ||
      k === COLLISION_SLOPE_UP ||
      k === COLLISION_SLOPE_DOWN
    );
  }

  /**
   * Resolves horizontal then vertical AABB sweep against chunked tile collision in O(area / 256).
   * Uses automatic Zero-GC substepping (<= 8px per substep) to eliminate high-speed tunneling,
   * and supports solid tiles, one-way clouds, 45-degree slopes, and 4px ceiling corner correction.
   */
  public resolveAabbMotion(
    box: { x: number; y: number; vx: number; vy: number },
    hbX: number,
    hbY: number,
    hbW: number,
    hbH: number,
    dt: number,
    out: TileAabbStepResult,
  ): void {
    out.onGround = false;
    out.hitWall = false;
    out.hitCeiling = false;
    out.hitHazard = false;
    out.landVy = 0;

    if (dt <= 0) return;

    const maxStepPx = TILE_SIZE * 0.5; // 8px max displacement per substep prevents tunneling
    const maxDelta = Math.max(Math.abs(box.vx * dt), Math.abs(box.vy * dt));
    const substeps = maxDelta > maxStepPx ? Math.min(16, Math.ceil(maxDelta / maxStepPx)) : 1;
    const subDt = dt / substeps;
    const maxWorldX = this.cols * TILE_SIZE - (hbX + hbW);

    for (let step = 0; step < substeps; step++) {
      // 1. Horizontal sweep
      const prevY0 = box.y + hbY;
      const prevY1 = prevY0 + hbH - 0.001;
      const r0x = Math.max(0, Math.floor(prevY0 / TILE_SIZE));
      const r1x = Math.min(this.rows - 1, Math.floor(prevY1 / TILE_SIZE));

      box.x += box.vx * subDt;
      if (box.x < -hbX) {
        box.x = -hbX;
        box.vx = 0;
        out.hitWall = true;
      } else if (box.x > maxWorldX) {
        box.x = maxWorldX;
        box.vx = 0;
        out.hitWall = true;
      }

      const hx0 = box.x + hbX;
      const hx1 = hx0 + hbW;
      const c0x = Math.max(0, Math.floor(hx0 / TILE_SIZE));
      const c1x = Math.min(this.cols - 1, Math.floor((hx1 - 0.001) / TILE_SIZE));

      for (let r = r0x; r <= r1x; r++) {
        for (let c = c0x; c <= c1x; c++) {
          const k = this.getCollision(c, r);
          if (k === COLLISION_HAZARD) out.hitHazard = true;
          if (k !== COLLISION_SOLID && k !== COLLISION_DESTRUCTIBLE) continue;
          const tx = c * TILE_SIZE;
          if (box.vx > 0) {
            box.x = tx - hbX - hbW;
            box.vx = 0;
            out.hitWall = true;
          } else if (box.vx < 0) {
            box.x = tx + TILE_SIZE - hbX;
            box.vx = 0;
            out.hitWall = true;
          }
        }
      }

      // 2. Vertical sweep
      const preBottom = box.y + hbY + hbH;
      const preVy = box.vy;
      box.y += box.vy * subDt;

      const vx0 = box.x + hbX;
      const vx1 = vx0 + hbW;
      const c0y = Math.max(0, Math.floor(vx0 / TILE_SIZE));
      const c1y = Math.min(this.cols - 1, Math.floor((vx1 - 0.001) / TILE_SIZE));
      const hy0 = box.y + hbY;
      const hy1 = hy0 + hbH;
      const r0y = Math.max(0, Math.floor(hy0 / TILE_SIZE));
      const r1y = Math.min(this.rows - 1, Math.floor((hy1 - 0.001) / TILE_SIZE));

      for (let r = r0y; r <= r1y; r++) {
        const ty = r * TILE_SIZE;
        for (let c = c0y; c <= c1y; c++) {
          const k = this.getCollision(c, r);
          if (k === COLLISION_HAZARD) {
            out.hitHazard = true;
            continue;
          }
          if (k === COLLISION_SLOPE_UP || k === COLLISION_SLOPE_DOWN) {
            const tx = c * TILE_SIZE;
            const footCx = vx0 + hbW * 0.5;
            const localX = Math.max(0, Math.min(TILE_SIZE, footCx - tx));
            const surfY = k === COLLISION_SLOPE_UP ? ty + TILE_SIZE - localX : ty + localX;
            if (box.vy >= 0 && box.y + hbY + hbH >= surfY - 2 && preBottom <= ty + TILE_SIZE + 4) {
              box.y = surfY - hbY - hbH;
              box.vy = 0;
              out.onGround = true;
              if (preVy > out.landVy) out.landVy = preVy;
            }
            continue;
          }
          if (k === COLLISION_CLOUD) {
            if (box.vy >= 0 && preBottom <= ty + 6 && box.y + hbY + hbH >= ty) {
              box.y = ty - hbY - hbH;
              box.vy = 0;
              out.onGround = true;
              if (preVy > out.landVy) out.landVy = preVy;
            }
            continue;
          }
          if (k !== COLLISION_SOLID && k !== COLLISION_DESTRUCTIBLE) continue;

          if (box.vy >= 0 && preBottom <= ty + 8 && box.y + hbY + hbH > ty) {
            box.y = ty - hbY - hbH;
            box.vy = 0;
            out.onGround = true;
            if (preVy > out.landVy) out.landVy = preVy;
          } else if (box.vy < 0 && box.y + hbY < ty + TILE_SIZE) {
            // 4px ceiling corner correction matching WorldHeroPhysics
            const tx = c * TILE_SIZE;
            const leftClip = box.x + hbX + hbW - tx;
            const rightClip = tx + TILE_SIZE - (box.x + hbX);
            if (leftClip > 0 && leftClip <= 4 && !this.isSolidAt(c - 1, r)) {
              box.x -= leftClip;
            } else if (rightClip > 0 && rightClip <= 4 && !this.isSolidAt(c + 1, r)) {
              box.x += rightClip;
            } else {
              box.y = ty + TILE_SIZE - hbY;
              box.vy = 0;
              out.hitCeiling = true;
            }
          }
        }
      }
    }
  }
}
