export const TILE_SIZE = 16;
export const MAX_TILEMAP_COLS = 256;
export const MAX_TILEMAP_ROWS = 64;

export const COLLISION_EMPTY = 0;
export const COLLISION_SOLID = 1;
export const COLLISION_CLOUD = 2;
export const COLLISION_HAZARD = 3;
export const COLLISION_DESTRUCTIBLE = 4;

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
 * Dense grid tilemap with 4-bit (N/E/S/W) auto-tiling bitmasks and O(1) AABB collision queries.
 * Pre-allocated flat TypedArrays guarantee zero per-frame allocations during physics sweeps.
 */
export class TilemapGrid {
  public readonly cols: number;
  public readonly rows: number;
  public readonly tiles: Uint16Array;
  public readonly collision: Uint8Array;
  public readonly autoMask: Uint8Array;

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.min(MAX_TILEMAP_COLS, Math.floor(cols)));
    this.rows = Math.max(1, Math.min(MAX_TILEMAP_ROWS, Math.floor(rows)));
    const len = this.cols * this.rows;
    this.tiles = new Uint16Array(len);
    this.collision = new Uint8Array(len);
    this.autoMask = new Uint8Array(len);
  }

  public clear(): void {
    this.tiles.fill(0);
    this.collision.fill(0);
    this.autoMask.fill(0);
  }

  public inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  public index(col: number, row: number): number {
    return row * this.cols + col;
  }

  public getTile(col: number, row: number): number {
    if (!this.inBounds(col, row)) return 0;
    return this.tiles[row * this.cols + col];
  }

  public getCollision(col: number, row: number): number {
    if (!this.inBounds(col, row)) return COLLISION_EMPTY;
    return this.collision[row * this.cols + col];
  }

  public getAutoMask(col: number, row: number): number {
    if (!this.inBounds(col, row)) return 0;
    return this.autoMask[row * this.cols + col];
  }

  public setTile(col: number, row: number, tileId: number, colKind = COLLISION_SOLID, updateMask = true): void {
    if (!this.inBounds(col, row)) return;
    const idx = row * this.cols + col;
    this.tiles[idx] = tileId;
    this.collision[idx] = tileId === 0 ? COLLISION_EMPTY : colKind;
    if (updateMask) {
      this.updateMaskAround(col, row);
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
    const c0 = Math.max(0, startCol);
    const r0 = Math.max(0, startRow);
    const c1 = Math.min(this.cols - 1, startCol + widthCols - 1);
    const r1 = Math.min(this.rows - 1, startRow + heightRows - 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = r * this.cols + c;
        this.tiles[idx] = tileId;
        this.collision[idx] = tileId === 0 ? COLLISION_EMPTY : colKind;
      }
    }
    this.recomputeAutoMaskRange(c0 - 1, r0 - 1, c1 + 1, r1 + 1);
  }

  public recomputeAutoMask(): void {
    this.recomputeAutoMaskRange(0, 0, this.cols - 1, this.rows - 1);
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
      for (let c = minC; c <= maxC; c++) {
        const idx = r * this.cols + c;
        const tid = this.tiles[idx];
        if (tid === 0) {
          this.autoMask[idx] = 0;
          continue;
        }
        let mask = 0;
        if (r > 0 && this.tiles[(r - 1) * this.cols + c] === tid) mask |= AUTO_MASK_N;
        if (c + 1 < this.cols && this.tiles[r * this.cols + (c + 1)] === tid) mask |= AUTO_MASK_E;
        if (r + 1 < this.rows && this.tiles[(r + 1) * this.cols + c] === tid) mask |= AUTO_MASK_S;
        if (c > 0 && this.tiles[r * this.cols + (c - 1)] === tid) mask |= AUTO_MASK_W;
        this.autoMask[idx] = mask;
      }
    }
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
        if (this.collision[r * this.cols + c] === COLLISION_HAZARD) return true;
      }
    }
    return false;
  }

  public hasFloorAhead(x: number, y: number, w: number, h: number, dirX: number): boolean {
    const probeX = dirX >= 0 ? x + w + 1 : x - 1;
    const probeCol = Math.floor(probeX / TILE_SIZE);
    const footRow = Math.floor((y + h + 2) / TILE_SIZE);
    const k = this.getCollision(probeCol, footRow);
    return k === COLLISION_SOLID || k === COLLISION_CLOUD || k === COLLISION_DESTRUCTIBLE;
  }

  /**
   * Resolves horizontal then vertical AABB sweep against dense tile collision in O(area / 256).
   * Supports solid tiles, one-way clouds (from above), and 4px ceiling corner correction.
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

    // 1. Horizontal sweep
    const prevY0 = box.y + hbY;
    const prevY1 = prevY0 + hbH - 0.001;
    const r0x = Math.max(0, Math.floor(prevY0 / TILE_SIZE));
    const r1x = Math.min(this.rows - 1, Math.floor(prevY1 / TILE_SIZE));

    box.x += box.vx * dt;
    const maxWorldX = this.cols * TILE_SIZE - (hbX + hbW);
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
        const k = this.collision[r * this.cols + c];
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
    box.y += box.vy * dt;

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
        const k = this.collision[r * this.cols + c];
        if (k === COLLISION_HAZARD) {
          out.hitHazard = true;
          continue;
        }
        if (k === COLLISION_CLOUD) {
          if (box.vy >= 0 && preBottom <= ty + 6 && box.y + hbY + hbH >= ty) {
            box.y = ty - hbY - hbH;
            box.vy = 0;
            out.onGround = true;
            out.landVy = preVy;
          }
          continue;
        }
        if (k !== COLLISION_SOLID && k !== COLLISION_DESTRUCTIBLE) continue;

        if (box.vy >= 0 && preBottom <= ty + 8) {
          box.y = ty - hbY - hbH;
          box.vy = 0;
          out.onGround = true;
          out.landVy = preVy;
        } else if (box.vy < 0) {
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
