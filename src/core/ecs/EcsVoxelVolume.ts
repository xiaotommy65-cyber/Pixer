export const ECS_VOXEL_SHAPES = [
  'cube',
  'half_slab',
  'slope_n',
  'slope_e',
  'slope_s',
  'slope_w',
  'stair_n',
  'stair_e',
  'stair_s',
  'stair_w',
  'arch',
] as const;

export type EcsVoxelShape = (typeof ECS_VOXEL_SHAPES)[number];

export const MAX_VOXEL_STORIES = 8;

export const VOXEL_SHAPE_CODE = {
  empty: 0,
  cube: 1,
  half_slab: 2,
  slope_n: 3,
  slope_e: 4,
  slope_s: 5,
  slope_w: 6,
  stair_n: 7,
  stair_e: 8,
  stair_s: 9,
  stair_w: 10,
  arch: 11,
} as const;

const CODE_TO_SHAPE: readonly (EcsVoxelShape | null)[] = [
  null,
  'cube',
  'half_slab',
  'slope_n',
  'slope_e',
  'slope_s',
  'slope_w',
  'stair_n',
  'stair_e',
  'stair_s',
  'stair_w',
  'arch',
];

const SHAPE_SET: ReadonlySet<string> = new Set(ECS_VOXEL_SHAPES);

export function getVoxelShapeCode(shape: EcsVoxelShape | undefined): number {
  if (!shape) return VOXEL_SHAPE_CODE.cube;
  return VOXEL_SHAPE_CODE[shape] ?? VOXEL_SHAPE_CODE.empty;
}

export function getVoxelShapeFromCode(code: number): EcsVoxelShape | null {
  return CODE_TO_SHAPE[code | 0] ?? null;
}

export interface EcsVoxelCellDef {
  col: number;
  row: number;
  zLevel: number;
  tileId: number;
  shape?: EcsVoxelShape;
  rotZ?: number;
}

export function validateVoxelCellDef(cell: unknown, keyHint = 'voxel'): string[] {
  const errors: string[] = [];
  if (!cell || typeof cell !== 'object') {
    return [`${keyHint} must be an object`];
  }
  const c = cell as Partial<EcsVoxelCellDef>;
  if (!Number.isInteger(c.col) || (c.col as number) < 0) {
    errors.push(`${keyHint}.col must be a non-negative integer`);
  }
  if (!Number.isInteger(c.row) || (c.row as number) < 0) {
    errors.push(`${keyHint}.row must be a non-negative integer`);
  }
  if (!Number.isInteger(c.zLevel) || (c.zLevel as number) < 0 || (c.zLevel as number) >= MAX_VOXEL_STORIES) {
    errors.push(`${keyHint}.zLevel must be an integer in 0..${MAX_VOXEL_STORIES - 1}`);
  }
  if (!Number.isInteger(c.tileId) || (c.tileId as number) < 0) {
    errors.push(`${keyHint}.tileId must be a non-negative integer`);
  }
  if (c.shape !== undefined && (typeof c.shape !== 'string' || !SHAPE_SET.has(c.shape))) {
    errors.push(`${keyHint}.shape '${String(c.shape)}' is invalid`);
  }
  if (c.rotZ !== undefined && (typeof c.rotZ !== 'number' || !Number.isFinite(c.rotZ))) {
    errors.push(`${keyHint}.rotZ must be a finite number`);
  }
  return errors;
}

/**
 * Pure DOM-free, Zero-GC Multi-Story Voxel Volume for HD-2D / 3D rooms.
 * Stores up to `MAX_VOXEL_STORIES` (8) stories in flat reusable TypedArrays indexed by
 * `(z * rows + row) * cols + col`.
 */
export class RoomVoxelVolume {
  public cols = 0;
  public rows = 0;
  public readonly stories = MAX_VOXEL_STORIES;
  public tileSize = 32;
  public storyHeight = 24;

  public tileIds: Uint16Array = new Uint16Array(0);
  public shapeCodes: Uint8Array = new Uint8Array(0);
  public solidFlags: Uint8Array = new Uint8Array(0);

  private readonly rangeScratch: [number, number] = [0, 0];

  public compileFromRoom(
    cols: number,
    rows: number,
    tileSize: number,
    storyHeight: number,
    voxels: readonly EcsVoxelCellDef[] | undefined,
    z0WallGrid?: readonly number[],
    isTileSolid?: (tileId: number) => boolean,
  ): void {
    const safeCols = Math.max(0, cols | 0);
    const safeRows = Math.max(0, rows | 0);
    this.cols = safeCols;
    this.rows = safeRows;
    this.tileSize = Math.max(1, Number.isFinite(tileSize) ? tileSize : 32);
    this.storyHeight = Math.max(1, Number.isFinite(storyHeight) ? storyHeight : 24);

    const total = safeCols * safeRows * this.stories;
    if (total === 0) return;

    if (this.tileIds.length < total) {
      this.tileIds = new Uint16Array(total);
      this.shapeCodes = new Uint8Array(total);
      this.solidFlags = new Uint8Array(total);
    } else {
      this.tileIds.fill(0, 0, total);
      this.shapeCodes.fill(0, 0, total);
      this.solidFlags.fill(0, 0, total);
    }

    if (z0WallGrid) {
      const layerSize = safeCols * safeRows;
      const limit = Math.min(layerSize, z0WallGrid.length);
      for (let i = 0; i < limit; i++) {
        const tid = z0WallGrid[i] | 0;
        if (tid <= 0) continue;
        const solid = isTileSolid ? isTileSolid(tid) : true;
        if (!solid) continue;
        this.tileIds[i] = tid;
        this.shapeCodes[i] = VOXEL_SHAPE_CODE.cube;
        this.solidFlags[i] = 1;
      }
    }

    if (voxels) {
      for (let i = 0; i < voxels.length; i++) {
        const cell = voxels[i];
        const c = cell.col | 0;
        const r = cell.row | 0;
        const z = cell.zLevel | 0;
        if (c < 0 || c >= safeCols || r < 0 || r >= safeRows || z < 0 || z >= this.stories) continue;
        const idx = (z * safeRows + r) * safeCols + c;
        const tid = cell.tileId | 0;
        if (tid <= 0) {
          this.tileIds[idx] = 0;
          this.shapeCodes[idx] = VOXEL_SHAPE_CODE.empty;
          this.solidFlags[idx] = 0;
        } else {
          const code = getVoxelShapeCode(cell.shape);
          this.tileIds[idx] = tid;
          this.shapeCodes[idx] = code;
          this.solidFlags[idx] = code !== VOXEL_SHAPE_CODE.empty ? 1 : 0;
        }
      }
    }
  }

  private indexOf(col: number, row: number, zLevel: number): number {
    const c = col | 0;
    const r = row | 0;
    const z = zLevel | 0;
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows || z < 0 || z >= this.stories) return -1;
    return (z * this.rows + r) * this.cols + c;
  }

  public getCellShape(col: number, row: number, zLevel: number): EcsVoxelShape | null {
    const idx = this.indexOf(col, row, zLevel);
    if (idx < 0) return null;
    return getVoxelShapeFromCode(this.shapeCodes[idx]);
  }

  public getCellTileId(col: number, row: number, zLevel: number): number {
    const idx = this.indexOf(col, row, zLevel);
    if (idx < 0) return 0;
    return this.tileIds[idx];
  }

  private isFullCube(col: number, row: number, zLevel: number): boolean {
    const idx = this.indexOf(col, row, zLevel);
    return idx >= 0 && this.shapeCodes[idx] === VOXEL_SHAPE_CODE.cube;
  }

  /**
   * Returns 6-bit neighbor face-culling mask matching `FACE_CULL_*` in `GpuMesh3DBatch.ts`:
   * N=1 (-Y), E=2 (+X), S=4 (+Y), W=8 (-X), TOP=16 (+Z), BOT=32 (-Z).
   */
  public computeFaceCullMask(col: number, row: number, zLevel: number): number {
    const c = col | 0;
    const r = row | 0;
    const z = zLevel | 0;
    let mask = 0;
    if (this.isFullCube(c, r - 1, z)) mask |= 1;
    if (this.isFullCube(c + 1, r, z)) mask |= 2;
    if (this.isFullCube(c, r + 1, z)) mask |= 4;
    if (this.isFullCube(c - 1, r, z)) mask |= 8;
    if (this.isFullCube(c, r, z + 1)) mask |= 16;
    if (this.isFullCube(c, r, z - 1)) mask |= 32;
    return mask;
  }

  /**
   * Writes `[bottomZ, topZ]` in world px for `(col, row, zLevel)` at normalized local coords
   * `(localXNorm, localYNorm)` in `[0..1)`. Returns `false` if cell is empty or out of bounds.
   */
  public getCellSurfaceRange(
    col: number,
    row: number,
    zLevel: number,
    localXNorm: number,
    localYNorm: number,
    outMinMax: [number, number],
  ): boolean {
    const idx = this.indexOf(col, row, zLevel);
    if (idx < 0) return false;
    const code = this.shapeCodes[idx];
    if (code === VOXEL_SHAPE_CODE.empty) return false;

    const lx = localXNorm < 0 ? 0 : localXNorm >= 1 ? 0.999999 : localXNorm;
    const ly = localYNorm < 0 ? 0 : localYNorm >= 1 ? 0.999999 : localYNorm;
    const H = this.storyHeight;
    const z0 = (zLevel | 0) * H;
    let bottomZ = z0;
    let topZ = z0 + H;

    switch (code) {
      case VOXEL_SHAPE_CODE.cube:
        break;
      case VOXEL_SHAPE_CODE.half_slab:
        topZ = z0 + H * 0.5;
        break;
      case VOXEL_SHAPE_CODE.slope_n:
        topZ = z0 + H * (1 - ly);
        break;
      case VOXEL_SHAPE_CODE.slope_e:
        topZ = z0 + H * lx;
        break;
      case VOXEL_SHAPE_CODE.slope_s:
        topZ = z0 + H * ly;
        break;
      case VOXEL_SHAPE_CODE.slope_w:
        topZ = z0 + H * (1 - lx);
        break;
      case VOXEL_SHAPE_CODE.stair_n: {
        const step = Math.min(3, Math.floor((1 - ly) * 4));
        topZ = z0 + H * ((step + 1) * 0.25);
        break;
      }
      case VOXEL_SHAPE_CODE.stair_e: {
        const step = Math.min(3, Math.floor(lx * 4));
        topZ = z0 + H * ((step + 1) * 0.25);
        break;
      }
      case VOXEL_SHAPE_CODE.stair_s: {
        const step = Math.min(3, Math.floor(ly * 4));
        topZ = z0 + H * ((step + 1) * 0.25);
        break;
      }
      case VOXEL_SHAPE_CODE.stair_w: {
        const step = Math.min(3, Math.floor((1 - lx) * 4));
        topZ = z0 + H * ((step + 1) * 0.25);
        break;
      }
      case VOXEL_SHAPE_CODE.arch:
        if (lx >= 0.22 && lx <= 0.78) {
          bottomZ = z0 + H * 0.7;
        }
        break;
      default:
        return false;
    }

    outMinMax[0] = bottomZ;
    outMinMax[1] = topZ;
    return true;
  }

  public sampleSupportZ(worldX: number, worldY: number, footZ: number, stepHeight = 10): number {
    if (this.cols <= 0 || this.rows <= 0) return 0;
    const ts = this.tileSize;
    const col = Math.floor(worldX / ts);
    const row = Math.floor(worldY / ts);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return 0;

    const lx = (worldX - col * ts) / ts;
    const ly = (worldY - row * ts) / ts;
    const maxStepZ = footZ + stepHeight;
    let bestZ = 0;

    for (let z = 0; z < this.stories; z++) {
      if (!this.getCellSurfaceRange(col, row, z, lx, ly, this.rangeScratch)) continue;
      const topZ = this.rangeScratch[1];
      if (topZ <= maxStepZ && topZ > bestZ) {
        bestZ = topZ;
      }
    }
    return bestZ;
  }

  public sampleCeilingZ(worldX: number, worldY: number, footZ: number, fallbackCeilingZ = 9999): number {
    if (this.cols <= 0 || this.rows <= 0) return fallbackCeilingZ;
    const ts = this.tileSize;
    const col = Math.floor(worldX / ts);
    const row = Math.floor(worldY / ts);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return fallbackCeilingZ;

    const lx = (worldX - col * ts) / ts;
    const ly = (worldY - row * ts) / ts;
    const minCeilZ = footZ + 4;
    let bestCeiling = fallbackCeilingZ;

    for (let z = 0; z < this.stories; z++) {
      if (!this.getCellSurfaceRange(col, row, z, lx, ly, this.rangeScratch)) continue;
      const bottomZ = this.rangeScratch[0];
      if (bottomZ >= minCeilZ && bottomZ < bestCeiling) {
        bestCeiling = bottomZ;
      }
    }
    return bestCeiling;
  }

  private samplePointBlocks(
    col: number,
    row: number,
    zLevel: number,
    lx: number,
    ly: number,
    minTopBlock: number,
    maxBotBlock: number,
  ): boolean {
    if (!this.getCellSurfaceRange(col, row, zLevel, lx, ly, this.rangeScratch)) return false;
    return this.rangeScratch[1] > minTopBlock && this.rangeScratch[0] < maxBotBlock;
  }

  public collidesAabb3D(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    stepHeight = 10,
  ): boolean {
    if (this.cols <= 0 || this.rows <= 0 || w <= 0 || d <= 0 || h <= 0) return false;

    const ts = this.tileSize;
    const H = this.storyHeight;
    const x1 = x + w;
    const y1 = y + d;
    const minCol = Math.max(0, Math.floor(x / ts));
    const maxCol = Math.min(this.cols - 1, Math.floor((x1 - 1e-4) / ts));
    const minRow = Math.max(0, Math.floor(y / ts));
    const maxRow = Math.min(this.rows - 1, Math.floor((y1 - 1e-4) / ts));
    if (minCol > maxCol || minRow > maxRow) return false;

    const minStory = Math.max(0, Math.floor(z / H));
    const maxStory = Math.min(this.stories - 1, Math.floor((z + h - 1e-4) / H));
    if (minStory > maxStory) return false;

    const minTopBlock = z + stepHeight;
    const maxBotBlock = z + h;

    for (let zLevel = minStory; zLevel <= maxStory; zLevel++) {
      const zBase = zLevel * this.rows;
      for (let r = minRow; r <= maxRow; r++) {
        const tileY0 = r * ts;
        const iy0 = y > tileY0 ? y : tileY0;
        const iy1 = y1 < tileY0 + ts - 1e-4 ? y1 : tileY0 + ts - 1e-4;
        if (iy1 < iy0) continue;
        const ly0 = (iy0 - tileY0) / ts;
        const ly1 = (iy1 - tileY0) / ts;
        const lyC = (ly0 + ly1) * 0.5;
        const rowOff = (zBase + r) * this.cols;

        for (let c = minCol; c <= maxCol; c++) {
          if (this.shapeCodes[rowOff + c] === VOXEL_SHAPE_CODE.empty) continue;
          const tileX0 = c * ts;
          const ix0 = x > tileX0 ? x : tileX0;
          const ix1 = x1 < tileX0 + ts - 1e-4 ? x1 : tileX0 + ts - 1e-4;
          if (ix1 < ix0) continue;
          const lx0 = (ix0 - tileX0) / ts;
          const lx1 = (ix1 - tileX0) / ts;
          const lxC = (lx0 + lx1) * 0.5;

          if (
            this.samplePointBlocks(c, r, zLevel, lxC, lyC, minTopBlock, maxBotBlock) ||
            this.samplePointBlocks(c, r, zLevel, lx0, ly0, minTopBlock, maxBotBlock) ||
            this.samplePointBlocks(c, r, zLevel, lx1, ly0, minTopBlock, maxBotBlock) ||
            this.samplePointBlocks(c, r, zLevel, lx1, ly1, minTopBlock, maxBotBlock) ||
            this.samplePointBlocks(c, r, zLevel, lx0, ly1, minTopBlock, maxBotBlock)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

function shapeToAsciiChar(shape: EcsVoxelShape | undefined): string {
  switch (shape) {
    case 'half_slab':
      return '=';
    case 'slope_n':
    case 'stair_n':
      return '^';
    case 'slope_s':
    case 'stair_s':
      return 'v';
    case 'slope_w':
    case 'stair_w':
      return '<';
    case 'slope_e':
    case 'stair_e':
      return '>';
    case 'arch':
      return 'A';
    case 'cube':
    default:
      return '#';
  }
}

/**
 * Renders a single story `zLevel` slice as a compact ASCII map:
 * `#` cube, `=` half_slab, `^/v/</>` ramps & stairs, `A` arch, `.` empty, `@` hero, `M` enemy.
 */
export function renderRoomSliceAsciiPure(
  cols: number,
  rows: number,
  zLevel: number,
  voxels: readonly EcsVoxelCellDef[] | undefined,
  wallGrid?: readonly number[],
  entities?: readonly { x: number; y: number; z?: number; tag?: string; tileSize: number }[],
  storyHeight = 24,
): string {
  const safeCols = Math.max(0, cols | 0);
  const safeRows = Math.max(0, rows | 0);
  if (safeCols === 0 || safeRows === 0) return '';

  const grid: string[] = new Array<string>(safeCols * safeRows).fill('.');
  if ((zLevel | 0) === 0 && wallGrid) {
    const limit = Math.min(grid.length, wallGrid.length);
    for (let i = 0; i < limit; i++) {
      if ((wallGrid[i] | 0) > 0) grid[i] = '#';
    }
  }

  if (voxels) {
    const targetZ = zLevel | 0;
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      if ((v.zLevel | 0) !== targetZ) continue;
      const c = v.col | 0;
      const r = v.row | 0;
      if (c < 0 || c >= safeCols || r < 0 || r >= safeRows) continue;
      grid[r * safeCols + c] = (v.tileId | 0) <= 0 ? '.' : shapeToAsciiChar(v.shape);
    }
  }

  if (entities) {
    const targetZ = zLevel | 0;
    const safeH = Math.max(1, storyHeight);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.z !== undefined && Math.floor(e.z / safeH) !== targetZ) continue;
      const ts = Math.max(1, e.tileSize);
      const c = Math.floor(e.x / ts);
      const r = Math.floor(e.y / ts);
      if (c < 0 || c >= safeCols || r < 0 || r >= safeRows) continue;
      const tag = e.tag ?? '';
      const marker = tag === 'hero' || tag === 'player' ? '@' : 'M';
      grid[r * safeCols + c] = marker;
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < safeRows; r++) {
    lines.push(grid.slice(r * safeCols, (r + 1) * safeCols).join(''));
  }
  return lines.join('\n');
}
