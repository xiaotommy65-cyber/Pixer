import type { SpriteId } from '../../assets/TextureAtlas.ts';
import { GAME_H, GAME_W, resolveLogicalViewport, type LogicalViewport } from '../gpu/GpuTypes.ts';
import { InputMap } from '../input/InputMap.ts';
import { SpatialHash } from '../math/SpatialHash.ts';
import { SeededRng } from '../runtime/SeededRng.ts';
import type {
  BgCloudDesc,
  BgParallaxLayerDesc,
  BgmTheme,
  BgStarDesc,
  CartridgeId,
  InputState,
  RectBox,
  RenderSceneSnapshot,
  RuntimeParams,
  SimEvent,
  StageProgressInfo,
  TileDesc,
} from '../types/WorldTypes.ts';
import { ARCHETYPE_CATALOG, type ArchetypeId, type TraitTag } from './Archetypes.ts';
import { JuiceSystem, stepSquashSpring } from './JuiceSystem.ts';
import { ENTITY_RULE_MATRIX, RuleRegistry, type RuleWorldActions } from './RuleMatrix.ts';
import { MAX_ENTITIES } from './SoaEntityPool.ts';
import { detonateInWorld, stepEntitiesInWorld, stepMovingPlatformsInWorld } from './WorldEntitiesStep.ts';
import {
  handleHeroEntityInteractions,
  resolveHeroMotion,
  rescueHeroFromAbyss,
  stepHeroControls,
  stepSparks,
} from './WorldHeroPhysics.ts';
import {
  HERO_HB,
  type HeroRelics,
  type HeroState,
  type MovingPlatform,
  type SparkProjectile,
  type WorldConfig,
  type WorldEntity,
} from './WorldInternalTypes.ts';
import { buildWorldSnapshot, createWorldSnapshotPool, type WorldSnapshotPool } from './WorldSnapshot.ts';

export type { HeroRelics, HeroState, MovingPlatform, WorldConfig, WorldEntity };

/**
 * Shared 2D Platformer & Systemic Simulation Kernel.
 * Combines fixed-step kinematics (Coyote Time, Jump Buffer, Double Jump, Air Dash, Apex Hang Time,
 * Corner Correction, Moving Platforms, Checkpoints, Portals), InputMap, JuiceSystem, and Tag x Tag RuleMatrix.
 */
export class WorldKernel {
  public readonly input = new InputMap();
  public readonly juice = new JuiceSystem();
  public readonly rng = new SeededRng(0x20260001);
  public readonly rules = new RuleRegistry(ENTITY_RULE_MATRIX);
  public readonly entityHash = new SpatialHash(MAX_ENTITIES, 32, 1024, MAX_ENTITIES * 4, 36);
  public readonly pairQuerySlots = new Int32Array(MAX_ENTITIES);
  public readonly solidHash = new SpatialHash(4096, 32, 1024, 4096 * 4, 36);
  public readonly solidQuerySlots = new Int32Array(256);

  public cartridgeId: CartridgeId;
  public worldW: number;
  public worldH: number;
  public readonly viewport: LogicalViewport;
  public readonly snapshotPool: WorldSnapshotPool;
  public skyTop: string;
  public skyBottom: string;
  public ambientDarkness: number;
  public ambientColor: string;
  public statusBanner: string;
  public stage?: StageProgressInfo;
  public bgmTheme?: BgmTheme;

  public relics: HeroRelics = { doubleJump: false, airDash: false };

  public hero: HeroState = {
    x: 34,
    y: 120,
    vx: 0,
    vy: 0,
    facingLeft: false,
    onGround: false,
    coyote: 0,
    airJumpsLeft: 0,
    dashTimer: 0,
    dashCooldown: 0,
    portalCooldown: 0,
    walkAnim: 0,
    invuln: 0,
    flash: 0,
    squash: { scaleX: 1, scaleY: 1 },
    checkpoint: null,
  };

  public hearts = 3;
  public maxHearts = 3;
  public score = 0;
  public gateUnlocked = false;
  public status: 'playing' | 'won' | 'lost' = 'playing';
  public elapsedSec = 0;
  public cameraX = 0;
  public cameraY = 0;
  public prevCameraX = 0;
  public prevCameraY = 0;
  public debugHitboxes = false;
  public scoutMode = false;
  public noticeBanner = '';
  public noticeTimer = 0;
  public onSkillYOverride?: (actions: RuleWorldActions) => boolean;

  public solids: RectBox[] = [];
  public movingPlatforms: MovingPlatform[] = [];
  public tiles: TileDesc[] = [];
  public fgTiles: TileDesc[] = [];
  public entities: WorldEntity[] = [];
  public sparks: SparkProjectile[] = [];
  public bgParallaxLayers: BgParallaxLayerDesc[] = [];
  public bgClouds: BgCloudDesc[] = [];
  public bgStars: BgStarDesc[] = [];

  private solidsDirty = true;
  private hashedSolidsCount = -1;
  private nextId = 1;
  private starsTotal = 0;
  private starsCollected = 0;
  private hasGate = false;
  private pulseCooldown = 0;

  constructor(cfg: WorldConfig) {
    this.cartridgeId = cfg.cartridgeId;
    this.worldW = cfg.worldWidth ?? GAME_W;
    this.worldH = cfg.worldHeight ?? GAME_H;
    this.viewport = resolveLogicalViewport(cfg.viewport);
    this.snapshotPool = createWorldSnapshotPool(this.cartridgeId, this.viewport);
    this.skyTop = cfg.skyTop ?? '#8fd8ff';
    this.skyBottom = cfg.skyBottom ?? '#fff4df';
    this.ambientDarkness = cfg.ambientDarkness ?? 0;
    this.ambientColor = cfg.ambientColor ?? '#120e24';
    this.statusBanner = cfg.statusBanner ?? '';
    this.stage = cfg.stage;
    this.bgmTheme = cfg.bgmTheme;
  }

  public markSolidsDirty(): void {
    this.solidsDirty = true;
    this.hashedSolidsCount = -1;
  }

  public ensureSolidHash(): void {
    if (!this.solidsDirty && this.hashedSolidsCount === this.solids.length) return;
    this.solidsDirty = false;
    this.hashedSolidsCount = this.solids.length;
    this.solidHash.clear();
    const len = Math.min(this.solids.length, this.solidHash.capacity);
    for (let i = 0; i < len; i++) {
      const s = this.solids[i];
      this.solidHash.insertBox(i, s.x, s.y, s.w, s.h);
    }
  }

  public resetStage(cfg: Partial<WorldConfig> & { spawnX?: number; spawnY?: number }): void {
    if (cfg.worldWidth !== undefined) this.worldW = cfg.worldWidth;
    if (cfg.worldHeight !== undefined) this.worldH = cfg.worldHeight;
    if (cfg.skyTop !== undefined) this.skyTop = cfg.skyTop;
    if (cfg.skyBottom !== undefined) this.skyBottom = cfg.skyBottom;
    if (cfg.ambientDarkness !== undefined) this.ambientDarkness = cfg.ambientDarkness;
    if (cfg.ambientColor !== undefined) this.ambientColor = cfg.ambientColor;
    if (cfg.statusBanner !== undefined) this.statusBanner = cfg.statusBanner;
    if (cfg.stage !== undefined) this.stage = cfg.stage;
    if (cfg.bgmTheme !== undefined) this.bgmTheme = cfg.bgmTheme;

    this.solids = [];
    this.solidsDirty = true;
    this.hashedSolidsCount = -1;
    this.movingPlatforms = [];
    this.tiles = [];
    this.fgTiles = [];
    this.bgParallaxLayers = [];
    this.entities = [];
    this.sparks = [];
    this.juice.reset();
    this.starsTotal = 0;
    this.starsCollected = 0;
    this.hasGate = false;
    this.gateUnlocked = false;
    this.status = 'playing';
    this.scoutMode = false;
    this.pulseCooldown = 0;
    this.cameraX = 0;
    this.cameraY = 0;
    this.prevCameraX = 0;
    this.prevCameraY = 0;

    this.hero.x = cfg.spawnX ?? 24;
    this.hero.y = cfg.spawnY ?? 120;
    this.hero.vx = 0;
    this.hero.vy = 0;
    this.hero.onGround = false;
    this.hero.coyote = 0;
    this.hero.airJumpsLeft = this.relics.doubleJump ? 1 : 0;
    this.hero.dashTimer = 0;
    this.hero.dashCooldown = 0;
    this.hero.portalCooldown = 0;
    this.hero.invuln = 0;
    this.hero.checkpoint = { x: this.hero.x, y: this.hero.y };
  }

  public addParallaxLayer(layer: BgParallaxLayerDesc): void {
    this.bgParallaxLayers.push(layer);
  }

  public addForegroundTileRect(
    x: number,
    y: number,
    w: number,
    h: number,
    sprite: SpriteId = 'tree_canopy',
    opts?: { tint?: string; alpha?: number; flipX?: boolean; elevationZ?: number; sortY?: number },
  ): void {
    for (let tx = x; tx < x + w; tx += 16) {
      for (let ty = y; ty < y + h; ty += 16) {
        this.fgTiles.push({
          sprite,
          x: tx,
          y: ty,
          w: Math.min(16, x + w - tx),
          h: Math.min(16, y + h - ty),
          tint: opts?.tint,
          alpha: opts?.alpha,
          flipX: opts?.flipX,
          elevationZ: opts?.elevationZ,
          sortY: opts?.sortY,
        });
      }
    }
  }

  public addSolidTileRect(
    x: number,
    y: number,
    w: number,
    h: number,
    sprite: SpriteId = 'stone',
    tint?: string,
    unlockable = false,
  ): void {
    this.solids.push({ x, y, w, h, kind: 'solid', unlockable });
    this.solidsDirty = true;
    this.hashedSolidsCount = -1;
    const suspended = y + h < this.worldH - 4;
    const lipColor = sprite === 'grass' || sprite === 'dirt' ? '#4a3529' : '#2e2b42';
    for (let tx = x; tx < x + w; tx += 16) {
      for (let ty = y; ty < y + h; ty += 16) {
        const th = Math.min(16, y + h - ty);
        const isBottomRow = suspended && ty + th >= y + h;
        this.tiles.push({
          sprite,
          x: tx,
          y: ty,
          w: Math.min(16, x + w - tx),
          h: th,
          tint,
          unlockable,
          extrudeH: isBottomRow ? 3 : 0,
          wallColor: isBottomRow ? lipColor : undefined,
          wallMaterial: sprite === 'grass' || sprite === 'dirt' ? 'earth' : 'stone',
          castShadow: false,
        });
      }
    }
  }

  public addCloudPlatform(x: number, y: number, tilesWide = 3): void {
    const count = Math.max(2, Math.min(10, Math.round(tilesWide)));
    this.solids.push({ x, y, w: count * 16, h: 10, kind: 'cloud' });
    this.solidsDirty = true;
    this.hashedSolidsCount = -1;
    this.tiles.push({ sprite: 'cloud_l', x, y, w: 16, h: 16 });
    for (let i = 1; i < count - 1; i++) {
      this.tiles.push({ sprite: 'cloud_m', x: x + i * 16, y, w: 16, h: 16 });
    }
    this.tiles.push({ sprite: 'cloud_r', x: x + (count - 1) * 16, y, w: 16, h: 16 });
  }

  public addMovingPlatform(
    x: number,
    y: number,
    tilesWide: number,
    opts: { minX?: number; maxX?: number; minY?: number; maxY?: number; vx?: number; vy?: number },
  ): void {
    const w = Math.max(2, Math.min(6, Math.round(tilesWide))) * 16;
    this.movingPlatforms.push({
      x,
      y,
      w,
      h: 10,
      minX: opts.minX ?? x,
      maxX: opts.maxX ?? x,
      minY: opts.minY ?? y,
      maxY: opts.maxY ?? y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      prevX: x,
      prevY: y,
    });
  }

  public spawn(
    archetypeId: ArchetypeId,
    x: number,
    y: number,
    overrides?: { minX?: number; maxX?: number; vx?: number; hp?: number; portalGroup?: string },
  ): WorldEntity {
    const def = ARCHETYPE_CATALOG[archetypeId];
    const maxHp = overrides?.hp ?? def.maxHp ?? 1;
    const ent: WorldEntity = {
      id: `${archetypeId}-${this.nextId++}`,
      archetype: archetypeId,
      sprite: def.sprite,
      tags: new Set<TraitTag>(def.tags),
      x,
      y,
      vx: overrides?.vx ?? (def.patrolSpeed ? (this.nextId % 2 === 0 ? def.patrolSpeed : -def.patrolSpeed) : 0),
      vy: 0,
      w: def.w,
      h: def.h,
      hp: maxHp,
      maxHp,
      minX: overrides?.minX,
      maxX: overrides?.maxX,
      patrolVx: def.patrolSpeed,
      hasGravity: def.hasGravity,
      friction: def.friction,
      alive: true,
      active: false,
      flashTimer: 0,
      scaleX: 1,
      scaleY: 1,
      phase: this.nextId * 0.85,
      lightRadius: def.lightRadius,
      lightColor: def.lightColor,
      lightIntensity: def.lightIntensity,
      portalGroup: overrides?.portalGroup ?? 'main',
    };
    this.entities.push(ent);
    if (archetypeId === 'star') this.starsTotal++;
    if (archetypeId === 'gate') this.hasGate = true;
    return ent;
  }

  public recordStarCollected(): void {
    this.starsCollected++;
  }

  public getStageStars(): { collected: number; total: number } {
    return { collected: this.starsCollected, total: this.starsTotal };
  }

  public getStarsCollected(): number {
    return this.starsCollected;
  }

  public getStarsTotal(): number {
    return this.starsTotal;
  }

  public consumeSkillYCooldown(actions: RuleWorldActions): boolean {
    if (this.pulseCooldown > 0) return false;
    if (this.onSkillYOverride && this.onSkillYOverride(actions)) return false;
    this.pulseCooldown = 0.36;
    return true;
  }

  public getSolidBoxes(includeEntitySolids = true): RectBox[] {
    const boxes = this.solids.slice();
    for (const mp of this.movingPlatforms) {
      boxes.push({ x: mp.x, y: mp.y, w: mp.w, h: mp.h, kind: 'cloud' });
    }
    if (includeEntitySolids) {
      for (const e of this.entities) {
        if (e.alive && e.tags.has('solid')) {
          boxes.push({ x: e.x, y: e.y, w: e.w, h: e.h, kind: 'solid' });
        }
      }
    }
    return boxes;
  }

  public step(dt: number, rawInput: InputState, params: RuntimeParams): SimEvent[] {
    const events: SimEvent[] = [];
    this.prevCameraX = this.cameraX;
    this.prevCameraY = this.cameraY;
    this.input.update(rawInput, dt);

    const simDt = this.juice.advanceRealTime(dt, params.shakeScale);
    if (this.noticeTimer > 0) this.noticeTimer = Math.max(0, this.noticeTimer - dt);

    for (const c of this.bgClouds) {
      c.x -= c.speed * dt;
      if (c.x < -64) c.x = this.worldW + 48;
    }

    if (this.hero.flash > 0) this.hero.flash = Math.max(0, this.hero.flash - dt * 6);
    stepSquashSpring(this.hero.squash, dt, 14);
    for (const e of this.entities) {
      if (e.flashTimer > 0) e.flashTimer = Math.max(0, e.flashTimer - dt * 5.5);
      stepSquashSpring(e, dt, 13);
    }

    if (simDt <= 0 || this.status !== 'playing') {
      return events;
    }

    this.elapsedSec += simDt;
    if (this.hero.invuln > 0) this.hero.invuln = Math.max(0, this.hero.invuln - simDt);
    if (this.hero.dashCooldown > 0) this.hero.dashCooldown = Math.max(0, this.hero.dashCooldown - simDt);
    if (this.hero.portalCooldown > 0) this.hero.portalCooldown = Math.max(0, this.hero.portalCooldown - simDt);

    const actions: RuleWorldActions = {
      emit: (ev) => events.push(ev),
      addScore: (pts) => {
        this.score += pts;
      },
      unlockGates: () => {
        this.gateUnlocked = true;
        this.solids = this.solids.filter((s) => !s.unlockable);
        this.solidsDirty = true;
        this.hashedSolidsCount = -1;
        this.tiles = this.tiles.filter((t) => !t.unlockable);
        for (const e of this.entities) {
          if (e.tags.has('gate')) {
            e.sprite = 'gate_open';
            e.lightRadius = 38;
            e.lightColor = '#56d39c';
            e.lightIntensity = 0.55;
          }
        }
      },
      spawnBurst: (x, y, colors, count) => {
        this.juice.spawnBurst(x, y, colors, count, params.sparkleDensity);
      },
      triggerJuice: (hitstop, trauma, flashHex, flashAlpha) => {
        if (hitstop > 0) this.juice.triggerHitstop(hitstop);
        if (trauma > 0) this.juice.addTrauma(trauma);
        if (flashHex && flashAlpha) this.juice.triggerFlash(flashHex, flashAlpha);
      },
      detonateAt: (x, y, radius, sourceId) => {
        detonateInWorld(this, x, y, radius, sourceId, actions);
      },
    };

    if (this.pulseCooldown > 0) this.pulseCooldown = Math.max(0, this.pulseCooldown - simDt);

    if (this.input.justPressed('skillX')) {
      this.scoutMode = !this.scoutMode;
      this.noticeBanner = this.scoutMode ? '🔭 遠眺視野開啟：預覽前方地形與目標！' : '🔭 返回標準視野';
      this.noticeTimer = 1.6;
      actions.emit('snap');
    }

    stepMovingPlatformsInWorld(this, simDt);
    this.stepHero(simDt, params, actions);
    stepSparks(this, simDt, actions);
    stepEntitiesInWorld(this, simDt, params, actions);

    if (!this.hasGate && this.starsTotal > 0 && this.starsCollected >= this.starsTotal) {
      this.status = 'won';
      actions.emit('win');
      actions.triggerJuice(0.06, 0.35, '#fffaf0', 0.25);
    }

    const lookAhead = this.hero.facingLeft ? -16 : 16;
    const scoutOffset = this.scoutMode ? (this.hero.facingLeft ? -52 : 52) : 0;
    const rightPeekX = this.input.rightAxisX() * 68;
    const viewW = this.viewport.width;
    const viewH = this.viewport.height;
    const maxCamX = Math.max(0, this.worldW - viewW);
    const targetCamX = Math.max(
      0,
      Math.min(maxCamX, this.hero.x + lookAhead + scoutOffset + rightPeekX - viewW * 0.44),
    );
    this.cameraX += (targetCamX - this.cameraX) * Math.min(1, simDt * 8.5);

    const maxCamY = Math.max(0, this.worldH - viewH);
    const desiredCamY = maxCamY > 0
      ? this.hero.y - viewH * 0.52 + this.input.rightAxisY() * 28
      : this.input.rightAxisY() * 28;
    const targetCamY = Math.max(0, Math.min(maxCamY, desiredCamY));
    this.cameraY += (targetCamY - this.cameraY) * Math.min(1, simDt * 8.5);

    return events;
  }

  private stepHero(dt: number, params: RuntimeParams, actions: RuleWorldActions): void {
    const h = this.hero;
    if (h.onGround) {
      for (const mp of this.movingPlatforms) {
        const feetY = h.y + HERO_HB.y + HERO_HB.h;
        if (
          Math.abs(feetY - mp.prevY) <= 3 &&
          h.x + HERO_HB.x + HERO_HB.w > mp.prevX &&
          h.x + HERO_HB.x < mp.prevX + mp.w
        ) {
          h.x += mp.x - mp.prevX;
          h.y += mp.y - mp.prevY;
          break;
        }
      }
    }

    stepHeroControls(this, dt, params, actions);
    resolveHeroMotion(this, dt, actions);
    rescueHeroFromAbyss(this, actions);
    handleHeroEntityInteractions(this, params, actions);
  }

  public snapshot(params: RuntimeParams, alpha = 1): RenderSceneSnapshot {
    return buildWorldSnapshot(this, params, alpha);
  }
}
