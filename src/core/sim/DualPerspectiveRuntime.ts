import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { InputMap } from '../input/InputMap.ts';
import type { EntityDesc, HudPrimitiveDesc, PerspectiveProjectionDesc } from '../types/SceneTypes.ts';
import type { OrthogonalPose } from './OrthogonalArt.ts';
import {
  EF_ALIVE,
  EF_COLLECTIBLE,
  EF_ENEMY,
  EF_FLIP_X,
  EF_PLAYER,
  type SoaEntityPool,
} from './SoaEntityPool.ts';
import { COLLISION_SOLID, TILE_SIZE, type TilemapGrid } from './TilemapGrid.ts';

export interface CartridgeDualPerspectiveConfig {
  enabled?: boolean;
  defaultMode?: 'third_person' | 'first_person';
  fovDeg?: number;
  maxDist?: number;
  wallSpriteIds?: readonly SpriteId[];
  ceilTopColor?: string;
  ceilHorizonColor?: string;
  floorHorizonColor?: string;
  floorBottomColor?: string;
  fogColor?: string;
  viewmodelBlueprintId?: string;
  showMinimap?: boolean;
  moveSpeed?: number;
  turnSpeed?: number;
  slashRange?: number;
}

export interface DualPerspectiveStepResult {
  toggled: boolean;
  slashed: boolean;
  hits: number;
}

const DEFAULT_WALL_SPRITES: readonly SpriteId[] = ['stone', 'brick', 'dungeon_wall', 'castle_wall'];

/**
 * Pure, DOM-free, Zero-GC 1P <-> 3P Dual-Perspective Runtime plug-in for DataCartridgeRuntime.
 * Drives instant 1P DDA raycast & 3P top-down switching purely from CartridgeJsonV1 `perspective` config,
 * sharing the exact TilemapGrid and SoaEntityPool world coordinates with zero state duplication.
 */
export class DualPerspectiveRuntime {
  public mode: 'third_person' | 'first_person' = 'first_person';
  public blend01 = 1;
  public viewerYawRad = 0;
  public slashTimer = 0;
  public slashCooldown = 0;
  public viewmodelBob = 0;
  public toggleCount = 0;

  private config: CartridgeDualPerspectiveConfig | undefined;
  private wallGrid: Uint8Array = new Uint8Array(1);
  private wallSprites: readonly SpriteId[] = DEFAULT_WALL_SPRITES;

  private readonly desc: PerspectiveProjectionDesc = {
    mode: 'first_person',
    blend01: 1,
    viewerX: 24,
    viewerY: 24,
    viewerYawRad: 0,
    fovRad: (66 * Math.PI) / 180,
    maxDist: 176,
    tileSize: TILE_SIZE,
    wallCols: 1,
    wallRows: 1,
    wallGrid: new Uint8Array(1),
    wallSpriteIds: DEFAULT_WALL_SPRITES,
    ceilTopColor: '#120e24',
    ceilHorizonColor: '#251d42',
    floorHorizonColor: '#2a2238',
    floorBottomColor: '#1a1524',
    fogColor: '#1a1529',
    wallHeightScale: 1.08,
    pitchOffsetPx: 0,
    columnStepPx: 2,
    viewmodelBlueprintId: 'fp_lantern_blade',
    viewmodelPose: 'idle',
    viewmodelBob: 0,
    viewmodelSwing: 0,
    showMinimap: true,
  };

  public configure(config: CartridgeDualPerspectiveConfig | undefined, tilemap: TilemapGrid): void {
    this.config = config;
    this.toggleCount = 0;
    this.slashTimer = 0;
    this.slashCooldown = 0;
    this.viewmodelBob = 0;
    this.viewerYawRad = 0;

    if (!config || config.enabled === false) {
      this.mode = 'third_person';
      this.blend01 = 0;
      return;
    }

    this.mode = config.defaultMode ?? 'first_person';
    this.blend01 = this.mode === 'first_person' ? 1 : 0;
    this.wallSprites =
      config.wallSpriteIds && config.wallSpriteIds.length > 0 ? config.wallSpriteIds : DEFAULT_WALL_SPRITES;
    this.syncWallGrid(tilemap);

    const fovDeg = Math.max(45, Math.min(100, config.fovDeg ?? 66));
    this.desc.fovRad = (fovDeg * Math.PI) / 180;
    this.desc.maxDist = Math.max(TILE_SIZE * 4, Math.min(512, config.maxDist ?? 176));
    this.desc.wallSpriteIds = this.wallSprites;
    this.desc.ceilTopColor = config.ceilTopColor ?? '#120e24';
    this.desc.ceilHorizonColor = config.ceilHorizonColor ?? '#251d42';
    this.desc.floorHorizonColor = config.floorHorizonColor ?? '#2a2238';
    this.desc.floorBottomColor = config.floorBottomColor ?? '#1a1524';
    this.desc.fogColor = config.fogColor ?? '#1a1529';
    this.desc.viewmodelBlueprintId = config.viewmodelBlueprintId ?? 'fp_lantern_blade';
    this.desc.showMinimap = config.showMinimap !== false;
  }

  public isEnabled(): boolean {
    return Boolean(this.config && this.config.enabled !== false);
  }

  public syncWallGrid(tilemap: TilemapGrid): void {
    const cols = Math.max(1, tilemap.cols);
    const rows = Math.max(1, tilemap.rows);
    const area = cols * rows;
    if (this.wallGrid.length !== area) {
      this.wallGrid = new Uint8Array(area);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const colKind = tilemap.getCollision(c, r);
        const tid = tilemap.getTile(c, r);
        this.wallGrid[r * cols + c] = colKind === COLLISION_SOLID ? Math.max(1, Math.min(this.wallSprites.length, tid || 1)) : 0;
      }
    }
    this.desc.wallCols = cols;
    this.desc.wallRows = rows;
    this.desc.wallGrid = this.wallGrid;
  }

  public togglePerspective(): void {
    this.mode = this.mode === 'first_person' ? 'third_person' : 'first_person';
    this.toggleCount++;
  }

  public step(
    dt: number,
    input: InputMap,
    pool: SoaEntityPool,
    playerSlot: number,
    tilemap: TilemapGrid,
    worldW: number,
    worldH: number,
    outResult: DualPerspectiveStepResult,
  ): void {
    outResult.toggled = false;
    outResult.slashed = false;
    outResult.hits = 0;

    if (!this.isEnabled() || playerSlot < 0) return;

    if (this.slashTimer > 0) this.slashTimer = Math.max(0, this.slashTimer - dt);
    if (this.slashCooldown > 0) this.slashCooldown = Math.max(0, this.slashCooldown - dt);

    // X button toggles seamlessly between 1P and 3P with zero coordinate loss
    if (input.justPressed('skillX')) {
      this.togglePerspective();
      outResult.toggled = true;
    }

    const targetBlend = this.mode === 'first_person' ? 1 : 0;
    this.blend01 += (targetBlend - this.blend01) * Math.min(1, dt * 14);
    if (Math.abs(this.blend01 - targetBlend) < 0.01) this.blend01 = targetBlend;

    const moveSpd = Math.max(32, Math.min(180, this.config?.moveSpeed ?? 78));
    const turnSpd = Math.max(1.2, Math.min(4.8, this.config?.turnSpeed ?? 2.55));
    const ax = input.axisX();
    const ay = input.axisY();
    let vx = 0;
    let vy = 0;

    if (this.mode === 'first_person') {
      // Left/Right rotate yaw (or Right-stick X), Up/Down move forward/back, L/R strafe
      const rx = input.rightAxisX();
      const turnAxis = Math.abs(rx) > 0.15 ? rx : ax;
      this.viewerYawRad += turnAxis * turnSpd * dt;
      const forward = -ay;
      const strafe = (input.held('shoulderR') ? 1 : 0) - (input.held('skillY') ? 1 : 0);
      const cosY = Math.cos(this.viewerYawRad);
      const sinY = Math.sin(this.viewerYawRad);
      vx = (cosY * forward - sinY * strafe) * moveSpd;
      vy = (sinY * forward + cosY * strafe) * moveSpd;
    } else {
      // 3P Top-Down 8-way movement synchronized with viewerYawRad
      const mag = Math.hypot(ax, ay);
      if (mag > 0.01) {
        const nx = ax / Math.max(1, mag);
        const ny = ay / Math.max(1, mag);
        vx = nx * moveSpd;
        vy = ny * moveSpd;
        this.viewerYawRad = Math.atan2(ny, nx);
      }
    }

    pool.vx[playerSlot] = vx;
    pool.vy[playerSlot] = vy;

    // Axis-separated smooth wall-sliding collision against shared TilemapGrid
    const halfW = pool.w[playerSlot] * 0.36;
    const halfH = pool.h[playerSlot] * 0.36;
    const cx = pool.x[playerSlot] + pool.w[playerSlot] * 0.5;
    const cy = pool.y[playerSlot] + pool.h[playerSlot] * 0.5;

    const nextCx = Math.max(halfW, Math.min(worldW - halfW, cx + vx * dt));
    if (!this.isPointBlocked(nextCx, cy, halfW, halfH, tilemap)) {
      pool.x[playerSlot] = nextCx - pool.w[playerSlot] * 0.5;
    }
    const curCx = pool.x[playerSlot] + pool.w[playerSlot] * 0.5;
    const nextCy = Math.max(halfH, Math.min(worldH - halfH, cy + vy * dt));
    if (!this.isPointBlocked(curCx, nextCy, halfW, halfH, tilemap)) {
      pool.y[playerSlot] = nextCy - pool.h[playerSlot] * 0.5;
    }

    if (vx < -2) pool.flags[playerSlot] |= EF_FLIP_X;
    else if (vx > 2) pool.flags[playerSlot] &= ~EF_FLIP_X;

    const spd = Math.hypot(vx, vy);
    if (spd > 6) {
      this.viewmodelBob += dt * 9.5;
    }

    // Melee lantern-blade slash (Action A or Jump B in 1P/3P dual view)
    if ((input.justPressed('action') || input.justPressed('jump')) && this.slashCooldown <= 0) {
      this.slashTimer = 0.22;
      this.slashCooldown = 0.34;
      outResult.slashed = true;

      const px = pool.x[playerSlot] + pool.w[playerSlot] * 0.5;
      const py = pool.y[playerSlot] + pool.h[playerSlot] * 0.5;
      const cosY = Math.cos(this.viewerYawRad);
      const sinY = Math.sin(this.viewerYawRad);
      const range = Math.max(20, Math.min(80, this.config?.slashRange ?? 42));

      for (let i = pool.activeCount - 1; i >= 0; i--) {
        const s = pool.activeIndices[i];
        if (s === playerSlot || (pool.flags[s] & EF_ALIVE) === 0) continue;
        if ((pool.flags[s] & EF_ENEMY) === 0) continue;
        const ex = pool.x[s] + pool.w[s] * 0.5;
        const ey = pool.y[s] + pool.h[s] * 0.5;
        const dx = ex - px;
        const dy = ey - py;
        const dist = Math.hypot(dx, dy);
        if (dist > range || dist < 1e-4) continue;
        const dot = (dx / dist) * cosY + (dy / dist) * sinY;
        if (dot < 0.35) continue;
        pool.hp[s] -= 1;
        pool.flash[s] = 1;
        outResult.hits++;
        if (pool.hp[s] <= 0) {
          pool.free(s);
        }
      }
    }
  }

  public annotateEntitiesForPerspective(entities: EntityDesc[], pool: SoaEntityPool): void {
    if (!this.isEnabled()) return;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.id === 'hero') {
        e.hideInFirstPerson = true;
        e.yawRad = this.viewerYawRad;
        continue;
      }
      if (e.yawRad === undefined) {
        // Assign stable yaw for enemy/collectible billboards
        e.yawRad = e.flipX ? Math.PI : 0;
      }
      if (e.billboardScale === undefined) {
        e.billboardScale = 1.0;
      }
    }
    // Keep enemy facing synchronized with pool velocities where available
    for (let i = 0; i < pool.activeCount; i++) {
      const s = pool.activeIndices[i];
      if ((pool.flags[s] & (EF_PLAYER | EF_COLLECTIBLE)) !== 0) continue;
      if (Math.hypot(pool.vx[s], pool.vy[s]) > 4) {
        pool.rot[s] = 0;
      }
    }
  }

  public buildProjectionDesc(viewerX: number, viewerY: number): PerspectiveProjectionDesc | undefined {
    if (!this.isEnabled()) return undefined;
    const pose: OrthogonalPose =
      this.slashTimer > 0.08 ? 'strike' : this.slashTimer > 0 ? 'windup' : 'idle';
    this.desc.mode = this.mode;
    this.desc.blend01 = this.blend01;
    this.desc.viewerX = viewerX;
    this.desc.viewerY = viewerY;
    this.desc.viewerYawRad = this.viewerYawRad;
    this.desc.viewmodelPose = pose;
    this.desc.viewmodelBob = Math.sin(this.viewmodelBob) * 2.5;
    this.desc.viewmodelSwing = this.slashTimer > 0 ? Math.sin((this.slashTimer / 0.22) * Math.PI) : 0;
    return this.desc;
  }

  public appendHudIndicators(
    out: HudPrimitiveDesc[],
    hudSlots: HudPrimitiveDesc[],
    startIdx: number,
    _viewW: number,
    topY = 8,
  ): number {
    if (!this.isEnabled()) return startIdx;
    let idx = startIdx;
    let slot = hudSlots[idx];
    if (!slot) {
      slot = { kind: 'text', x: 0, y: 0, w: 0, h: 0, color: '#fffaf0' };
      hudSlots[idx] = slot;
    }
    idx++;
    slot.kind = 'text';
    slot.x = 10;
    slot.y = topY;
    slot.w = 0;
    slot.h = 0;
    slot.text = this.mode === 'first_person' ? '1P VIEW [X] 3P' : '3P VIEW [X] 1P';
    slot.scale = 1;
    slot.align = 'left';
    slot.color = this.mode === 'first_person' ? '#5ec2f7' : '#ffd447';
    slot.shadowColor = '#120d1e';
    slot.alpha = 0.94;
    slot.worldSpace = false;
    out.push(slot);
    return idx;
  }

  private isPointBlocked(cx: number, cy: number, halfW: number, halfH: number, tilemap: TilemapGrid): boolean {
    const c0 = Math.floor((cx - halfW) / TILE_SIZE);
    const c1 = Math.floor((cx + halfW) / TILE_SIZE);
    const r0 = Math.floor((cy - halfH) / TILE_SIZE);
    const r1 = Math.floor((cy + halfH) / TILE_SIZE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (tilemap.getCollision(c, r) === COLLISION_SOLID) return true;
      }
    }
    return false;
  }
}
