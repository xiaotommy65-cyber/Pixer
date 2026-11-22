import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { raycastGrid2DInto } from '../math/Visibility2D.ts';
import type { EntityDesc, PerspectiveProjectionDesc } from '../types/SceneTypes.ts';
import { resolveRelativeFacingInto, type RelativeFacingOut } from './OrthogonalArt.ts';

export const MAX_RAYCAST_COLUMNS = 320;
export const MAX_PROJECTED_BILLBOARDS = 128;

export interface ProjectedWallColumn {
  screenX: number;
  width: number;
  topY: number;
  height: number;
  perpDist: number;
  sprite: SpriteId;
  u0: number;
  u1: number;
  /** 1.0 for N/S facing walls, 0.72 for E/W facing walls (classic 2.5D depth contrast). */
  faceShade: number;
  /** 0 = near (crisp), 1 = far (blended into atmospheric fog). */
  fogFactor: number;
  cellCol: number;
  cellRow: number;
}

export interface ProjectedBillboard {
  entity: EntityDesc;
  screenX: number;
  screenY: number;
  width: number;
  height: number;
  forwardDist: number;
  fogFactor: number;
  facing: 'front' | 'back' | 'side';
  flipX: boolean;
}

function compareBillboardFarToNear(a: ProjectedBillboard, b: ProjectedBillboard): number {
  return b.forwardDist - a.forwardDist;
}

function sortBillboardsInPlace(pool: ProjectedBillboard[], lo: number, hi: number): void {
  if (hi - lo <= 16) {
    for (let i = lo + 1; i <= hi; i++) {
      const key = pool[i];
      let j = i - 1;
      while (j >= lo && compareBillboardFarToNear(pool[j], key) > 0) {
        pool[j + 1] = pool[j];
        j--;
      }
      pool[j + 1] = key;
    }
    return;
  }
  const mid = (lo + hi) >> 1;
  const pivot = pool[mid];
  let i = lo;
  let j = hi;
  while (i <= j) {
    while (compareBillboardFarToNear(pool[i], pivot) < 0) i++;
    while (compareBillboardFarToNear(pool[j], pivot) > 0) j--;
    if (i <= j) {
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      i++;
      j--;
    }
  }
  if (lo < j) sortBillboardsInPlace(pool, lo, j);
  if (i < hi) sortBillboardsInPlace(pool, i, hi);
}

/**
 * Pure, DOM-free, Zero-GC 2.5D First-Person DDA Raycast & Directional Billboard Projector.
 * Shares the exact same TilemapGrid / SoA Entity world state with 3P top-down/HD-2D rendering,
 * enabling seamless instant 1P <-> 3P camera switching across WebGPU, WebGL2, and Canvas2D.
 */
export class PerspectiveProjector {
  public readonly columnDepth = new Float32Array(MAX_RAYCAST_COLUMNS);
  public readonly wallColumns: ProjectedWallColumn[] = [];
  public readonly billboards: ProjectedBillboard[] = [];
  public wallColumnCount = 0;
  public billboardCount = 0;
  public lastColumnStepPx = 2;

  private readonly rayHitScratch = new Float64Array(8);
  private readonly facingScratch: RelativeFacingOut = { facing: 'front', flipX: false };
  private activeDesc: PerspectiveProjectionDesc | null = null;
  private readonly opaqueBound: (col: number, row: number) => boolean;

  constructor() {
    for (let i = 0; i < MAX_RAYCAST_COLUMNS; i++) {
      this.wallColumns.push({
        screenX: 0,
        width: 2,
        topY: 0,
        height: 0,
        perpDist: 1,
        sprite: 'stone',
        u0: 0,
        u1: 1,
        faceShade: 1,
        fogFactor: 0,
        cellCol: -1,
        cellRow: -1,
      });
    }
    const dummyEntity: EntityDesc = { id: '', sprite: 'solid', x: 0, y: 0, w: 16, h: 16 };
    for (let i = 0; i < MAX_PROJECTED_BILLBOARDS; i++) {
      this.billboards.push({
        entity: dummyEntity,
        screenX: 0,
        screenY: 0,
        width: 0,
        height: 0,
        forwardDist: 0,
        fogFactor: 0,
        facing: 'front',
        flipX: false,
      });
    }
    this.opaqueBound = (col: number, row: number): boolean => {
      const d = this.activeDesc;
      if (!d) return true;
      if (col < 0 || col >= d.wallCols || row < 0 || row >= d.wallRows) return true;
      return d.wallGrid[row * d.wallCols + col] > 0;
    };
  }

  /**
   * Projects 2.5D DDA vertical wall strips and 4-way directional billboard entities
   * into pre-allocated pools with zero per-frame heap allocations.
   */
  public projectFirstPerson(
    desc: PerspectiveProjectionDesc,
    entities: readonly EntityDesc[],
    viewW: number,
    viewH: number,
    columnStepPx = 2,
  ): void {
    this.activeDesc = desc;
    const step = Math.max(1, Math.min(4, Math.round(columnStepPx)));
    const colCount = Math.min(MAX_RAYCAST_COLUMNS, Math.ceil(viewW / step));
    this.lastColumnStepPx = step;
    this.wallColumnCount = 0;
    this.billboardCount = 0;

    const tileSize = Math.max(4, desc.tileSize);
    const invTile = 1 / tileSize;
    const fov = Math.max(0.55, Math.min(2.1, desc.fovRad));
    const halfFov = fov * 0.5;
    const maxDist = Math.max(tileSize * 2, desc.maxDist);
    const invMaxDist = 1 / maxDist;
    const yaw = desc.viewerYawRad;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const projPlaneDist = (viewW * 0.5) / Math.tan(halfFov);
    const horizonY = viewH * 0.5 + (desc.pitchOffsetPx ?? 0);
    const wallScaleH = desc.wallHeightScale ?? 1.08;
    const wallSpriteIds = desc.wallSpriteIds;

    // 1. Cast DDA rays across viewport columns and populate 1D Z-buffer
    for (let c = 0; c < colCount; c++) {
      const screenX = c * step + step * 0.5;
      const camX = (screenX / viewW) * 2 - 1; // -1 .. +1
      const rayRelAngle = Math.atan(camX * Math.tan(halfFov));
      const rayAngle = yaw + rayRelAngle;
      const dirX = Math.cos(rayAngle);
      const dirY = Math.sin(rayAngle);

      const hit = raycastGrid2DInto(
        desc.wallCols,
        desc.wallRows,
        desc.viewerX,
        desc.viewerY,
        dirX,
        dirY,
        maxDist,
        this.opaqueBound,
        this.rayHitScratch,
        0,
        tileSize,
      );

      if (!hit) {
        this.columnDepth[c] = maxDist;
        continue;
      }

      const rawDist = this.rayHitScratch[1];
      const hitX = this.rayHitScratch[2];
      const hitY = this.rayHitScratch[3];
      const nx = this.rayHitScratch[4];
      const hitCol = this.rayHitScratch[6] | 0;
      const hitRow = this.rayHitScratch[7] | 0;

      // Fish-eye correction via cosine of relative ray angle
      const perpDist = Math.max(tileSize * 0.14, rawDist * Math.cos(rayRelAngle));
      this.columnDepth[c] = perpDist;

      const sliceH = Math.min(viewH * 3.4, (tileSize * wallScaleH * projPlaneDist) / perpDist);
      const isEastWest = Math.abs(nx) > 0.5;
      let hitFrac = isEastWest ? hitY * invTile - Math.floor(hitY * invTile) : hitX * invTile - Math.floor(hitX * invTile);
      if (hitFrac < 0) hitFrac += 1;
      if (hitFrac > 1) hitFrac -= 1;

      const cellCode =
        hitCol >= 0 && hitCol < desc.wallCols && hitRow >= 0 && hitRow < desc.wallRows
          ? desc.wallGrid[hitRow * desc.wallCols + hitCol]
          : 1;
      const spriteIdx = Math.max(0, Math.min(wallSpriteIds.length - 1, cellCode - 1));
      const sprite: SpriteId = wallSpriteIds[spriteIdx] ?? 'stone';
      const sliceUvW = Math.max(1 / 16, Math.min(0.25, (step / Math.max(1, sliceH)) * 1.15));
      const u0 = Math.max(0, Math.min(1 - sliceUvW, hitFrac));
      const u1 = Math.min(1, u0 + sliceUvW);

      const out = this.wallColumns[this.wallColumnCount++];
      out.screenX = screenX;
      out.width = step + 0.35; // Slight sub-pixel overlap prevents vertical hairlines
      out.topY = horizonY - sliceH * 0.5;
      out.height = sliceH;
      out.perpDist = perpDist;
      out.sprite = sprite;
      out.u0 = u0;
      out.u1 = u1;
      out.faceShade = isEastWest ? 0.72 : 1.0;
      out.fogFactor = Math.max(0, Math.min(1, (perpDist - tileSize * 1.2) * invMaxDist));
      out.cellCol = hitCol;
      out.cellRow = hitRow;
    }

    // 2. Project world entities as 4-way directional billboards clipped against 1D Z-buffer
    const tanHalfFov = Math.tan(halfFov);
    for (let i = 0; i < entities.length; i++) {
      if (this.billboardCount >= MAX_PROJECTED_BILLBOARDS) break;
      const e = entities[i];
      if (e.hideInFirstPerson) continue;

      const ex = e.x + e.w * 0.5;
      const ey = e.y + e.h * 0.5;
      const dx = ex - desc.viewerX;
      const dy = ey - desc.viewerY;

      // Transform into viewer camera space: forward along yaw, right perpendicular (+90 deg)
      const forward = dx * cosYaw + dy * sinYaw;
      if (forward <= tileSize * 0.25 || forward >= maxDist) continue;
      const lateral = -dx * sinYaw + dy * cosYaw;

      // Horizontal frustum cull with generous margin for wide sprites
      const normX = lateral / (forward * tanHalfFov);
      if (normX < -1.45 || normX > 1.45) continue;

      const screenX = (normX * 0.5 + 0.5) * viewW;
      const bbScale = e.billboardScale ?? 1.0;
      const baseH = ((Math.max(e.h, tileSize * 0.8) * bbScale * projPlaneDist) / forward) * (e.scaleY ?? 1);
      const aspect = Math.max(0.35, Math.min(2.5, e.w / Math.max(1, e.h)));
      const baseW = baseH * aspect * (e.scaleX ?? 1);

      // Z-buffer occlusion test across sprite horizontal footprint (sample left, center, right columns)
      const leftCol = Math.max(0, Math.min(colCount - 1, Math.floor((screenX - baseW * 0.35) / step)));
      const midCol = Math.max(0, Math.min(colCount - 1, Math.floor(screenX / step)));
      const rightCol = Math.max(0, Math.min(colCount - 1, Math.floor((screenX + baseW * 0.35) / step)));
      const occBias = tileSize * 0.28;
      const visible =
        forward <= this.columnDepth[midCol] + occBias ||
        forward <= this.columnDepth[leftCol] + occBias ||
        forward <= this.columnDepth[rightCol] + occBias;
      if (!visible) continue;

      const floorY = horizonY + ((tileSize * wallScaleH * 0.5 * projPlaneDist) / forward);
      const liftPx = ((e.elevationZ ?? 0) * projPlaneDist) / forward;
      const screenY = floorY - baseH * 0.5 - liftPx;

      let facing: 'front' | 'back' | 'side' = 'front';
      let flipX = e.flipX ?? false;
      if (e.yawRad !== undefined) {
        resolveRelativeFacingInto(desc.viewerX, desc.viewerY, ex, ey, e.yawRad, this.facingScratch);
        facing = this.facingScratch.facing;
        flipX = this.facingScratch.flipX;
      } else if (e.artFacing === 'back' || e.artFacing === 'side' || e.artFacing === 'front') {
        facing = e.artFacing;
      }

      const b = this.billboards[this.billboardCount++];
      b.entity = e;
      b.screenX = screenX;
      b.screenY = screenY;
      b.width = baseW;
      b.height = baseH;
      b.forwardDist = forward;
      b.fogFactor = Math.max(0, Math.min(1, (forward - tileSize * 1.1) * invMaxDist));
      b.facing = facing;
      b.flipX = flipX;
    }

    if (this.billboardCount > 1) {
      sortBillboardsInPlace(this.billboards, 0, this.billboardCount - 1);
    }

    this.activeDesc = null;
  }
}
