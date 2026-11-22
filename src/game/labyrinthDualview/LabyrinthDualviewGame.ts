import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { InputMap } from '../../core/input/InputMap.ts';
import { JuiceSystem } from '../../core/sim/JuiceSystem.ts';
import type { OrthogonalPose } from '../../core/sim/OrthogonalArt.ts';
import { TILE_SIZE } from '../../core/sim/TilemapGrid.ts';
import type {
  BgCloudDesc,
  BgStarDesc,
  CartridgeInstance,
  EntityDesc,
  HudPrimitiveDesc,
  InputState,
  LightDesc,
  ParticleDesc,
  PerspectiveProjectionDesc,
  RenderSceneSnapshot,
  RuntimeParams,
  SimEvent,
  StageProgressInfo,
  TileDesc,
} from '../../core/types/WorldTypes.ts';
import { clamp } from '../../core/types/WorldTypes.ts';

const MAP_COLS = 16;
const MAP_ROWS = 12;

// 0 = floor, 1 = stone wall, 2 = astral rune wall, 3 = gate (opens when 2 switches activated)
const LABYRINTH_LAYOUT: readonly string[] = [
  '1111111111111111',
  '1000001000000021',
  '1022001022200001',
  '1020000000201101',
  '1000111000001001',
  '1000100000200001',
  '1100102000200111',
  '1000002000000001',
  '1022000011100201',
  '1000000010000201',
  '1000100000000031',
  '1111111111111111',
];

const WALL_SPRITES: readonly SpriteId[] = ['stone', 'brick', 'gate_locked'];

interface GuardActor {
  id: string;
  blueprintId: string;
  paletteRow: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  patrolAxis: 'x' | 'y';
  patrolSpan: number;
  speed: number;
  yawRad: number;
  stunTimer: number;
  flash: number;
  hp: number;
}

interface RelicItem {
  id: string;
  kind: 'star' | 'switch' | 'gate';
  x: number;
  y: number;
  active: boolean;
}

/**
 * PA-09: Labyrinth DualView (迴廊雙界)
 * Orthogonal 1P / 3P Dual-Perspective Dungeon Cartridge.
 * Shares ONE single tilemap, ONE entity/torch/switch world state, and 4-axis OrthogonalArt blueprints:
 * Press X anytime to switch seamlessly between 3P HD-2D Top-Down and 1P 2.5D DDA Raycast + Directional Billboards!
 */
export class LabyrinthDualviewGame implements CartridgeInstance {
  private readonly input = new InputMap();
  private readonly juice = new JuiceSystem();
  private readonly wallGrid = new Uint8Array(MAP_COLS * MAP_ROWS);
  private readonly eventsOut: SimEvent[] = [];

  public perspectiveMode: 'third_person' | 'first_person' = 'first_person';
  public perspectiveBlend01 = 1;
  public playerX = 2.5 * TILE_SIZE;
  public playerY = 2.5 * TILE_SIZE;
  public playerYawRad = 0; // 0 = East (+X)
  private playerBob = 0;
  private attackTimer = 0;
  private invulnTimer = 0;
  private hearts = 5;
  private readonly maxHearts = 5;
  private score = 0;
  private starsCollected = 0;
  private readonly starsTotal = 4;
  private switchesOn = 0;
  private gateOpen = false;
  private elapsedSec = 0;
  private timeSec = 0;
  private status: 'playing' | 'won' | 'lost' = 'playing';
  private statusBanner = '第一人稱 2.5D · X 隨時切換 1P↔3P · A 斬擊/觸發機關';
  private cameraX = 0;
  private cameraY = 0;

  private readonly guards: GuardActor[] = [];
  private readonly items: RelicItem[] = [];
  private readonly torches: { x: number; y: number; phase: number }[] = [
    { x: 2.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, phase: 0.1 },
    { x: 8.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, phase: 1.2 },
    { x: 13.5 * TILE_SIZE, y: 2.5 * TILE_SIZE, phase: 2.3 },
    { x: 5.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, phase: 3.1 },
    { x: 9.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, phase: 4.0 },
    { x: 2.5 * TILE_SIZE, y: 9.5 * TILE_SIZE, phase: 5.2 },
    { x: 11.5 * TILE_SIZE, y: 7.5 * TILE_SIZE, phase: 0.9 },
    { x: 13.5 * TILE_SIZE, y: 9.5 * TILE_SIZE, phase: 2.7 },
  ];

  // Zero-GC pooled snapshot arrays
  private readonly bgStars: BgStarDesc[] = [];
  private readonly bgClouds: BgCloudDesc[] = [];
  private readonly tiles: TileDesc[] = [];
  private readonly entities: EntityDesc[] = [];
  private readonly entityPool: EntityDesc[] = [];
  private readonly lights: LightDesc[] = [];
  private readonly lightPool: LightDesc[] = [];
  private readonly hudPrimitives: HudPrimitiveDesc[] = [];
  private readonly hudPool: HudPrimitiveDesc[] = [];
  private readonly particles: ParticleDesc[] = [];
  private readonly stageInfo: StageProgressInfo = { index: 1, total: 1, name: '星紋雙界迴廊' };
  private readonly perspectiveDesc: PerspectiveProjectionDesc;
  private readonly snapshotObj: RenderSceneSnapshot;

  constructor() {
    for (let i = 0; i < 32; i++) {
      this.entityPool.push({ id: `ld_e_${i}`, sprite: 'solid', x: 0, y: 0, w: 16, h: 16 });
    }
    for (let i = 0; i < 16; i++) {
      this.lightPool.push({ x: 0, y: 0, radius: 52, color: '#ffae42', intensity: 0.65 });
    }
    for (let i = 0; i < 12; i++) {
      this.hudPool.push({ kind: 'text', x: 0, y: 0, w: 0, h: 0, color: '#fffaf0' });
    }

    this.perspectiveDesc = {
      mode: 'first_person',
      blend01: 1,
      viewerX: this.playerX,
      viewerY: this.playerY,
      viewerYawRad: this.playerYawRad,
      fovRad: (66 * Math.PI) / 180,
      maxDist: 9.5 * TILE_SIZE,
      tileSize: TILE_SIZE,
      wallCols: MAP_COLS,
      wallRows: MAP_ROWS,
      wallGrid: this.wallGrid,
      wallSpriteIds: WALL_SPRITES,
      ceilTopColor: '#0e0b1f',
      ceilHorizonColor: '#1d1638',
      floorHorizonColor: '#1a1530',
      floorBottomColor: '#2d2546',
      fogColor: '#151029',
      wallHeightScale: 1.1,
      columnStepPx: 2,
      viewmodelBlueprintId: 'fp_lantern_blade',
      viewmodelPose: 'idle',
      viewmodelBob: 0,
      viewmodelSwing: 0,
      showMinimap: true,
    };

    this.snapshotObj = {
      cartridgeId: 'labyrinth-dualview',
      skyTop: '#120d24',
      skyBottom: '#231a3d',
      cozyFilter: true,
      glowIntensity: 1.1,
      paletteRow: 0,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 0,
      starsCollected: 0,
      starsTotal: this.starsTotal,
      hasKey: false,
      hearts: this.hearts,
      maxHearts: this.maxHearts,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      cameraZoom: 1.25,
      ambientDarkness: 0.34,
      ambientColor: '#100c20',
      hd2dDepth: { enabled: true, sortByDepthY: true, perspectiveSkew: 0.04, horizonHazeAlpha: 0.1 },
      perspective: this.perspectiveDesc,
      bgStars: this.bgStars,
      bgClouds: this.bgClouds,
      tiles: this.tiles,
      entities: this.entities,
      particles: this.particles,
      lights: this.lights,
      hudPrimitives: this.hudPrimitives,
      hideClassicHud: false,
      statusBanner: this.statusBanner,
      stage: this.stageInfo,
      bgmTheme: 'dungeon',
    };

    this.resetWorld();
  }

  public resetWorld(): void {
    this.tiles.length = 0;
    for (let r = 0; r < MAP_ROWS; r++) {
      const rowStr = LABYRINTH_LAYOUT[r];
      for (let c = 0; c < MAP_COLS; c++) {
        const ch = rowStr[c];
        const code = ch === '1' ? 1 : ch === '2' ? 2 : ch === '3' ? 3 : 0;
        this.wallGrid[r * MAP_COLS + c] = code;
        const wx = c * TILE_SIZE;
        const wy = r * TILE_SIZE;
        if (code === 0) {
          this.tiles.push({
            sprite: (r + c) % 2 === 0 ? 'dungeon_floor' : 'stone',
            x: wx,
            y: wy,
            w: TILE_SIZE,
            h: TILE_SIZE,
            tint: (r + c) % 2 === 0 ? '#5b5378' : '#4a4366',
          });
        } else {
          this.tiles.push({
            sprite: WALL_SPRITES[code - 1] ?? 'stone',
            x: wx,
            y: wy,
            w: TILE_SIZE,
            h: TILE_SIZE,
            extrudeH: 10,
            elevationZ: 6,
            wallColor: code === 2 ? '#4d3a78' : code === 3 ? '#ffd447' : '#3a3554',
            wallMaterial: code === 2 ? 'astral' : 'stone',
            castShadow: true,
          });
        }
      }
    }

    this.playerX = 1.5 * TILE_SIZE;
    this.playerY = 1.5 * TILE_SIZE;
    this.playerYawRad = 0;
    this.playerBob = 0;
    this.attackTimer = 0;
    this.invulnTimer = 0;
    this.hearts = this.maxHearts;
    this.score = 0;
    this.starsCollected = 0;
    this.switchesOn = 0;
    this.gateOpen = false;
    this.elapsedSec = 0;
    this.status = 'playing';

    this.guards.length = 0;
    this.guards.push(
      {
        id: 'guard_north',
        blueprintId: 'sentinel_golem',
        paletteRow: 3,
        x: 8.5 * TILE_SIZE,
        y: 3.5 * TILE_SIZE,
        homeX: 8.5 * TILE_SIZE,
        homeY: 3.5 * TILE_SIZE,
        patrolAxis: 'x',
        patrolSpan: 28,
        speed: 24,
        yawRad: 0,
        stunTimer: 0,
        flash: 0,
        hp: 2,
      },
      {
        id: 'guard_mid',
        blueprintId: 'frost_arcanist',
        paletteRow: 1,
        x: 7.5 * TILE_SIZE,
        y: 7.5 * TILE_SIZE,
        homeX: 7.5 * TILE_SIZE,
        homeY: 7.5 * TILE_SIZE,
        patrolAxis: 'y',
        patrolSpan: 24,
        speed: 22,
        yawRad: Math.PI * 0.5,
        stunTimer: 0,
        flash: 0,
        hp: 2,
      },
      {
        id: 'guard_east',
        blueprintId: 'crimson_rival',
        paletteRow: 2,
        x: 12.5 * TILE_SIZE,
        y: 7.5 * TILE_SIZE,
        homeX: 12.5 * TILE_SIZE,
        homeY: 7.5 * TILE_SIZE,
        patrolAxis: 'x',
        patrolSpan: 24,
        speed: 28,
        yawRad: Math.PI,
        stunTimer: 0,
        flash: 0,
        hp: 3,
      },
    );

    this.items.length = 0;
    this.items.push(
      { id: 'star_1', kind: 'star', x: 5.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, active: true },
      { id: 'star_2', kind: 'star', x: 13.5 * TILE_SIZE, y: 1.5 * TILE_SIZE, active: true },
      { id: 'star_3', kind: 'star', x: 2.5 * TILE_SIZE, y: 9.5 * TILE_SIZE, active: true },
      { id: 'star_4', kind: 'star', x: 11.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, active: true },
      { id: 'sw_1', kind: 'switch', x: 5.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, active: true },
      { id: 'sw_2', kind: 'switch', x: 13.5 * TILE_SIZE, y: 5.5 * TILE_SIZE, active: true },
      { id: 'exit_gate', kind: 'gate', x: 14.5 * TILE_SIZE, y: 10.5 * TILE_SIZE, active: true },
    );

    this.updatePerspectiveBanner();
  }

  public togglePerspective(): void {
    this.perspectiveMode = this.perspectiveMode === 'first_person' ? 'third_person' : 'first_person';
    this.perspectiveBlend01 = this.perspectiveMode === 'first_person' ? 1 : 0;
    this.updatePerspectiveBanner();
  }

  private updatePerspectiveBanner(): void {
    const modeLabel = this.perspectiveMode === 'first_person' ? '1P 2.5D 透視' : '3P HD-2D 俯視';
    this.statusBanner = `${modeLabel} · 機關 ${this.switchesOn}/2 · X 切換視角 · A 聖燈斬`;
  }

  private isBlocked(wx: number, wy: number): boolean {
    const r = 4.2;
    const minC = Math.floor((wx - r) / TILE_SIZE);
    const maxC = Math.floor((wx + r) / TILE_SIZE);
    const minR = Math.floor((wy - r) / TILE_SIZE);
    const maxR = Math.floor((wy + r) / TILE_SIZE);
    for (let row = minR; row <= maxR; row++) {
      for (let col = minC; col <= maxC; col++) {
        if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return true;
        if (this.wallGrid[row * MAP_COLS + col] > 0) return true;
      }
    }
    return false;
  }

  private openGateCell(): void {
    if (this.gateOpen) return;
    this.gateOpen = true;
    const gx = 14;
    const gy = 10;
    this.wallGrid[gy * MAP_COLS + gx] = 0;
    const tileIdx = gy * MAP_COLS + gx;
    if (this.tiles[tileIdx]) {
      this.tiles[tileIdx].sprite = 'gate_open';
      this.tiles[tileIdx].extrudeH = 0;
      this.tiles[tileIdx].elevationZ = 0;
    }
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    this.eventsOut.length = 0;
    this.input.update(rawInput, dt);
    const simDt = this.juice.advanceRealTime(dt, params.shakeScale);
    this.timeSec += dt;

    if (this.input.justPressed('skillX')) {
      this.togglePerspective();
      this.eventsOut.push('snap');
    }

    if (this.status !== 'playing') {
      if (this.input.justPressed('shoulderL') || this.input.justPressed('action')) {
        this.resetWorld();
        this.eventsOut.push('snap');
      }
      return this.eventsOut;
    }

    if (simDt <= 0) return this.eventsOut;
    this.elapsedSec += simDt;
    if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - simDt);
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - simDt);

    // Dual-perspective movement controls sharing identical world coordinates!
    const ix = this.input.axisX();
    const iy = this.input.axisY();
    const speed = Math.max(48, params.moveSpeed * 0.62);
    let moveDx = 0;
    let moveDy = 0;

    if (this.perspectiveMode === 'first_person') {
      const turnInput = ix + this.input.rightAxisX();
      if (Math.abs(turnInput) > 0.05) {
        this.playerYawRad += turnInput * 2.55 * simDt;
      }
      const fwd = -iy; // Up = forward
      const strafe = (this.input.held('shoulderR') ? 1 : 0) - (this.input.held('shoulderL') ? 1 : 0);
      const cos = Math.cos(this.playerYawRad);
      const sin = Math.sin(this.playerYawRad);
      moveDx = (cos * fwd - sin * strafe) * speed * simDt;
      moveDy = (sin * fwd + cos * strafe) * speed * simDt;
    } else {
      const mag = ix !== 0 && iy !== 0 ? Math.SQRT1_2 : 1;
      moveDx = ix * mag * speed * simDt;
      moveDy = iy * mag * speed * simDt;
      if (ix !== 0 || iy !== 0) {
        this.playerYawRad = Math.atan2(iy, ix);
      }
    }

    const nx = this.playerX + moveDx;
    if (!this.isBlocked(nx, this.playerY)) this.playerX = nx;
    const ny = this.playerY + moveDy;
    if (!this.isBlocked(this.playerX, ny)) this.playerY = ny;

    if (Math.hypot(moveDx, moveDy) > 0.02) {
      this.playerBob += simDt * 10;
    }

    // Lantern Blade Strike (works identically in both 1P and 3P!)
    if (this.input.justPressed('action') && this.attackTimer <= 0) {
      this.attackTimer = 0.26;
      this.eventsOut.push('laser');
      const strikeX = this.playerX + Math.cos(this.playerYawRad) * 18;
      const strikeY = this.playerY + Math.sin(this.playerYawRad) * 18;
      for (let i = 0; i < this.guards.length; i++) {
        const g = this.guards[i];
        if (g.hp <= 0) continue;
        if (Math.hypot(g.x - strikeX, g.y - strikeY) < 22) {
          g.hp--;
          g.flash = 0.5;
          g.stunTimer = 0.9;
          this.score += 120;
          this.juice.applyPreset(g.hp <= 0 ? 'heavy_kill' : 'light_hit');
          this.eventsOut.push(g.hp <= 0 ? 'explode' : 'stomp');
        }
      }
    }

    // Step patrolling guardians
    for (let i = 0; i < this.guards.length; i++) {
      const g = this.guards[i];
      if (g.hp <= 0) continue;
      if (g.flash > 0) g.flash = Math.max(0, g.flash - simDt * 2.5);
      if (g.stunTimer > 0) {
        g.stunTimer = Math.max(0, g.stunTimer - simDt);
        continue;
      }
      const prevX = g.x;
      const prevY = g.y;
      const phase = Math.sin(this.elapsedSec * 1.4 + i * 1.7);
      if (g.patrolAxis === 'x') g.x = g.homeX + phase * g.patrolSpan;
      else g.y = g.homeY + phase * g.patrolSpan;
      const vx = g.x - prevX;
      const vy = g.y - prevY;
      if (vx * vx + vy * vy > 1e-5) {
        g.yawRad = Math.atan2(vy, vx);
      }

      if (this.invulnTimer <= 0 && Math.hypot(g.x - this.playerX, g.y - this.playerY) < 11) {
        this.hearts = Math.max(0, this.hearts - 1);
        this.invulnTimer = 1.2;
        this.juice.applyPreset('player_hurt');
        this.eventsOut.push('hurt');
        if (this.hearts <= 0) {
          this.status = 'lost';
          this.statusBanner = '迷宮殞落 · 按 A/L 重新挑戰';
        }
      }
    }

    // Collect stars, activate switches, enter unlocked gate
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      const d = Math.hypot(it.x - this.playerX, it.y - this.playerY);
      if (it.kind === 'star' && d < 12) {
        it.active = false;
        this.starsCollected++;
        this.score += 200;
        this.eventsOut.push('star');
      } else if (it.kind === 'switch' && d < 14) {
        it.active = false;
        this.switchesOn++;
        this.score += 250;
        this.eventsOut.push('key');
        if (this.switchesOn >= 2) {
          this.openGateCell();
          this.statusBanner = '星門已開啟！前往東南出口（X 隨時切換視角）';
        } else {
          this.updatePerspectiveBanner();
        }
      } else if (it.kind === 'gate' && this.gateOpen && d < 14) {
        this.status = 'won';
        this.score += 600;
        this.statusBanner = '雙界迴廊突破！按 A/L 再戰';
        this.eventsOut.push('win');
      }
    }

    // Smooth 3P camera centering
    this.cameraX = clamp(this.playerX - 160, 0, Math.max(0, MAP_COLS * TILE_SIZE - 320));
    this.cameraY = clamp(this.playerY - 90, 0, Math.max(0, MAP_ROWS * TILE_SIZE - 180));
    return this.eventsOut;
  }

  public getStatus(): 'playing' | 'won' | 'lost' {
    return this.status;
  }

  public snapshot(params: RuntimeParams): RenderSceneSnapshot {
    const t = this.timeSec;
    this.entities.length = 0;
    let eIdx = 0;

    // 1. Player 3P body (hidden in 1P raycast view so viewer doesn't collide with own sprite)
    const pEnt = this.entityPool[eIdx++];
    pEnt.id = 'dual_hero';
    pEnt.sprite = 'hero_a';
    pEnt.artBlueprintId = 'atelier_striker';
    pEnt.artFacing = Math.abs(Math.cos(this.playerYawRad)) > 0.6 ? 'side' : Math.sin(this.playerYawRad) < 0 ? 'back' : 'front';
    pEnt.artPose = this.attackTimer > 0.08 ? 'strike' : 'idle';
    pEnt.x = this.playerX - 8;
    pEnt.y = this.playerY - 8;
    pEnt.w = 16;
    pEnt.h = 16;
    pEnt.flipX = Math.cos(this.playerYawRad) < -0.1;
    pEnt.yawRad = this.playerYawRad;
    pEnt.hideInFirstPerson = true;
    pEnt.castShadow = true;
    pEnt.flash = this.invulnTimer > 0.8 ? 0.5 : 0;
    pEnt.tint = undefined;
    this.entities.push(pEnt);

    // 2. Patrolling directional guardians (rendered as 4-way billboards in 1P and HD-2D actors in 3P)
    for (let i = 0; i < this.guards.length; i++) {
      const g = this.guards[i];
      if (g.hp <= 0) continue;
      const dst = this.entityPool[eIdx++];
      dst.id = g.id;
      dst.sprite = 'ember_warden';
      dst.artBlueprintId = g.blueprintId;
      dst.artFacing = 'front';
      dst.artPose = g.stunTimer > 0 ? 'hurt' : 'idle';
      dst.paletteRow = g.paletteRow;
      dst.x = g.x - 8;
      dst.y = g.y - 8;
      dst.w = 16;
      dst.h = 16;
      dst.yawRad = g.yawRad;
      dst.billboardScale = 1.05;
      dst.hideInFirstPerson = false;
      dst.castShadow = true;
      dst.flash = g.flash;
      dst.tint = undefined;
      this.entities.push(dst);
    }

    // 3. Relics, switches, gate
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      if (it.kind === 'gate' && !this.gateOpen) continue;
      const dst = this.entityPool[eIdx++];
      dst.id = it.id;
      dst.sprite = it.kind === 'star' ? 'star_a' : it.kind === 'switch' ? 'astral_core' : 'gate_open';
      dst.artBlueprintId = undefined;
      dst.x = it.x - 7;
      dst.y = it.y - 7;
      dst.w = 14;
      dst.h = 14;
      dst.elevationZ = it.kind === 'star' ? 3 + Math.sin(t * 4 + i) * 2 : 0;
      dst.billboardScale = it.kind === 'gate' ? 1.15 : 0.72;
      dst.emissive = 0.85;
      dst.tint = it.kind === 'star' ? '#ffd447' : it.kind === 'switch' ? '#56d39c' : '#e0aaff';
      dst.hideInFirstPerson = false;
      dst.castShadow = false;
      dst.flash = 0;
      dst.yawRad = undefined;
      this.entities.push(dst);
    }

    // 4. Flickering dungeon torches + dynamic lights
    this.lights.length = 0;
    for (let i = 0; i < this.torches.length; i++) {
      const tr = this.torches[i];
      const l = this.lightPool[i];
      const flick = 0.88 + 0.12 * Math.sin(t * 8 + tr.phase);
      l.x = tr.x;
      l.y = tr.y;
      l.radius = 52 * flick;
      l.color = '#ffae42';
      l.intensity = 0.65 * flick;
      this.lights.push(l);
    }

    // Update PerspectiveProjectionDesc in-place (Zero-GC)
    const pDesc = this.perspectiveDesc;
    pDesc.mode = this.perspectiveMode;
    pDesc.blend01 = this.perspectiveBlend01;
    pDesc.viewerX = this.playerX;
    pDesc.viewerY = this.playerY;
    pDesc.viewerYawRad = this.playerYawRad;
    const vmPose: OrthogonalPose = this.attackTimer > 0.1 ? 'strike' : this.attackTimer > 0 ? 'windup' : 'idle';
    pDesc.viewmodelPose = vmPose;
    pDesc.viewmodelBob = this.playerBob;
    pDesc.viewmodelSwing = this.attackTimer > 0 ? Math.sin((this.attackTimer / 0.26) * Math.PI) : 0;

    // Lightweight HUD overlay showing active perspective & compass
    this.hudPrimitives.length = 0;
    const h0 = this.hudPool[0];
    h0.kind = 'text';
    h0.x = 8;
    h0.y = 166;
    h0.text = `${this.perspectiveMode === 'first_person' ? '[1P RAYCAST]' : '[3P HD-2D]'} SW ${this.switchesOn}/2  X:VIEW  A:SLASH`;
    h0.color = '#ffd447';
    h0.scale = 1;
    h0.align = 'left';
    h0.worldSpace = false;
    this.hudPrimitives.push(h0);

    const snap = this.snapshotObj;
    snap.timeSec = t;
    snap.elapsedSec = this.elapsedSec;
    snap.status = this.status;
    snap.score = this.score;
    snap.starsCollected = this.starsCollected;
    snap.hasKey = this.gateOpen;
    snap.hearts = this.hearts;
    snap.cameraX = this.cameraX + this.juice.shakeX;
    snap.cameraY = this.cameraY + this.juice.shakeY;
    snap.cameraZoom = this.perspectiveMode === 'third_person' ? 1.25 : 1.0;
    snap.cozyFilter = params.cozyFilter > 0;
    snap.glowIntensity = params.glowIntensity;
    snap.screenFlashAlpha = this.juice.flashAlpha;
    snap.screenFlashColor = this.juice.flashColor;
    snap.statusBanner = this.statusBanner;
    return snap;
  }

  public dispose(): void {
    this.juice.reset();
  }
}
