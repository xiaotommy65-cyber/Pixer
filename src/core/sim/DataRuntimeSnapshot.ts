import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { LogicalViewport } from '../gpu/GpuTypes.ts';
import {
  clamp,
  type BgCloudDesc,
  type BgParallaxLayerDesc,
  type BgStarDesc,
  type DebugRectDesc,
  type EntityDesc,
  type Hd2dDepthConfig,
  type HudPrimitiveDesc,
  type LightDesc,
  type ParticleDesc,
  type RenderSceneSnapshot,
  type RuntimeParams,
  type StageProgressInfo,
  type TileDesc,
} from '../types/WorldTypes.ts';
import type { CardDeckEngine } from './CardDeckEngine.ts';
import type { CartridgeArchetypeDef, CartridgeJsonV1 } from './CartridgeSchema.ts';
import {
  EF_CRUMBLE_TILE,
  EF_CRYSTAL_RESET,
  RT_GRAPPLE_LINKS,
} from './DataRuntimePlatformer.ts';
import {
  buildShmupHudFromPool,
  getActiveLoadout,
  type ShmupRuntimeContext,
} from './DataRuntimeShmup.ts';
import type { DualPerspectiveRuntime } from './DualPerspectiveRuntime.ts';
import type { FighterFrameEngine } from './FighterFrameEngine.ts';
import {
  acquireHudSlot,
  buildGenreHudPrimitives,
  EF_LOGIC_SWITCH,
  type GenreRuntimeContext,
} from './GenreControllers.ts';
import type { JuiceSystem } from './JuiceSystem.ts';
import type { ProceduralVisualRigRuntime } from './ProceduralVisualRig.ts';
import {
  BM_MOVING_PLATFORM,
  EF_ADDITIVE,
  EF_ALIVE,
  EF_BOSS,
  EF_EMISSIVE,
  EF_FLIP_X,
  EF_PIERCING,
  type SoaEntityPool,
} from './SoaEntityPool.ts';
import {
  CHUNK_SHIFT,
  CHUNK_SIZE,
  COLLISION_CLOUD,
  COLLISION_EMPTY,
  TILE_SIZE,
  type TileAabbStepResult,
  type TilemapGrid,
} from './TilemapGrid.ts';

export const MAX_FLOATING_TEXTS = 24;

export interface FloatingTextSlot {
  active: boolean;
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

const CLIFF_MASK_SPRITES: readonly SpriteId[] = Array.from({ length: 16 }, (_, m) => `cliff_m${m}` as SpriteId);
const GRASS_MASK_SPRITES: readonly SpriteId[] = Array.from({ length: 16 }, (_, m) => `grass_m${m}` as SpriteId);

export interface RuntimeSnapshotBank {
  snapshot: RenderSceneSnapshot;
  stageInfo: StageProgressInfo;
  viewport: { width: number; height: number };
  tileSlots: TileDesc[];
  fgTileSlots: TileDesc[];
  entitySlots: EntityDesc[];
  lightSlots: LightDesc[];
  debugRectSlots: DebugRectDesc[];
  hudSlots: HudPrimitiveDesc[];
  tiles: TileDesc[];
  fgTiles: TileDesc[];
  entities: EntityDesc[];
  particles: ParticleDesc[];
  lights: LightDesc[];
  debugRects: DebugRectDesc[];
  hudPrimitives: HudPrimitiveDesc[];
  entitySink: EntityDesc[];
  hudSink: HudPrimitiveDesc[];
  debugSink: DebugRectDesc[];
  particleSink: ParticleDesc[];
}

export function createRuntimeBank(cartridgeId: string, vp: LogicalViewport): RuntimeSnapshotBank {
  const viewport = { width: vp.width, height: vp.height };
  const stageInfo: StageProgressInfo = { index: 1, total: 1, name: '' };
  const tiles: TileDesc[] = [];
  const fgTiles: TileDesc[] = [];
  const entities: EntityDesc[] = [];
  const particles: ParticleDesc[] = [];
  const lights: LightDesc[] = [];
  const debugRects: DebugRectDesc[] = [];
  const hudPrimitives: HudPrimitiveDesc[] = [];
  return {
    viewport,
    stageInfo,
    tileSlots: [],
    fgTileSlots: [],
    entitySlots: [],
    lightSlots: [],
    debugRectSlots: [],
    hudSlots: [],
    tiles,
    fgTiles,
    entities,
    particles,
    lights,
    debugRects,
    hudPrimitives,
    entitySink: [],
    hudSink: [],
    debugSink: [],
    particleSink: [],
    snapshot: {
      cartridgeId,
      skyTop: '#76c7ff',
      skyBottom: '#fff3df',
      cozyFilter: true,
      glowIntensity: 1,
      paletteRow: 0,
      timeSec: 0,
      elapsedSec: 0,
      status: 'playing',
      score: 0,
      comboCount: 0,
      starsCollected: 0,
      starsTotal: 0,
      hasKey: false,
      hearts: 3,
      maxHearts: 3,
      bossHp: 0,
      bossMaxHp: 0,
      cameraX: 0,
      cameraY: 0,
      cameraZoom: 1,
      viewport,
      ambientDarkness: 0,
      ambientColor: '#120e24',
      screenFlashAlpha: 0,
      screenFlashColor: '#fffaf0',
      bgStars: [],
      bgParallaxLayers: undefined,
      bgClouds: [],
      tiles,
      fgTiles: undefined,
      entities,
      particles,
      lights,
      debugRects: undefined,
      hudPrimitives: undefined,
      statusBanner: '',
      stage: stageInfo,
      bgmTheme: undefined,
      shmupHud: undefined,
    },
  };
}

function acquireTileSlot(pool: TileDesc[], idx: number): TileDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { sprite: 'stone', x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };
    pool[idx] = slot;
  }
  return slot;
}

function acquireEntitySlot(pool: EntityDesc[], idx: number): EntityDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { id: '', sprite: 'star_a', x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };
    pool[idx] = slot;
  }
  return slot;
}

function acquireLightSlot(pool: LightDesc[], idx: number): LightDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, radius: 24, color: '#ffd447', intensity: 0.4 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireDebugRectSlot(pool: DebugRectDesc[], idx: number): DebugRectDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE, color: '#56d39c' };
    pool[idx] = slot;
  }
  return slot;
}

export interface DataSnapshotProjectorContext extends ShmupRuntimeContext, GenreRuntimeContext {
  readonly def: CartridgeJsonV1;
  readonly pool: SoaEntityPool;
  readonly juice: JuiceSystem;
  readonly cardEngine: CardDeckEngine | null;
  readonly fighterEngine: FighterFrameEngine | null;
  readonly visualRig: ProceduralVisualRigRuntime;
  readonly dualPerspective: DualPerspectiveRuntime;
  readonly hd2dConfig: Hd2dDepthConfig;
  readonly archetypes: readonly {
    id: string;
    def: CartridgeArchetypeDef;
    flags: number;
    behaviorMask: number;
    scoreValue: number;
    dropKind?: string;
  }[];
  readonly tilemap: TilemapGrid;
  readonly fgTilemap: TilemapGrid;
  readonly hasFgTilemapTiles: boolean;
  readonly tileSpriteLut: readonly (SpriteId | undefined)[];
  readonly fgSpriteLut: readonly (SpriteId | undefined)[];
  readonly fgAlphaLut: Float32Array;
  readonly fgExtraTiles: readonly TileDesc[];
  readonly bgParallaxLayers: readonly BgParallaxLayerDesc[];
  readonly bgClouds: readonly BgCloudDesc[];
  readonly bgStars: readonly BgStarDesc[];
  readonly floatingTexts: readonly FloatingTextSlot[];
  readonly grappleEnabled: boolean;
  readonly grappleMaxRange: number;
  readonly grappleState: 'idle' | 'shooting' | 'swinging' | 'pulling';
  readonly grappleMode: 'swing' | 'pull';
  readonly grappleAnchorX: number;
  readonly grappleAnchorY: number;
  readonly grappleTipX: number;
  readonly grappleTipY: number;
  readonly grappleAimAngle: number;
  readonly grapplePreviewKind: 'none' | 'wall' | 'ring';
  readonly grapplePreviewX: number;
  readonly grapplePreviewY: number;
  readonly grappleLinkIds: readonly string[];
  readonly aabbRes: TileAabbStepResult;
  readonly bestStarsByStage: readonly number[];
  readonly totalCampaignStars: number;
  readonly stageSkyTop: string;
  readonly stageSkyBottom: string;
  readonly stageAmbientColor: string;
  readonly prevCameraX: number;
  readonly prevCameraY: number;
  readonly dashTimer: number;
  readonly dashCooldown: number;
  readonly debugHitboxes: boolean;
  readonly elapsedSec: number;
  readonly starsCollected: number;
  readonly statusBanner: string;
  lastHeroSprite: SpriteId;
  getEntityId(slot: number, archIdx: number): string;
}

export function projectDataCartridgeSnapshot(
  ctx: DataSnapshotProjectorContext,
  bank: RuntimeSnapshotBank,
  params: RuntimeParams,
  alpha: number,
): RenderSceneSnapshot {
  const outTiles = bank.tiles;
  const outFgTiles = bank.fgTiles;
  const outEntities = bank.entities;
  const outLights = bank.lights;

  const st = ctx.def.stages[ctx.stageIdx];
  const t = ctx.juice.visualTime;
  const glow = params.glowIntensity;
  const isShmup = ctx.def.player.controller === 'shmup';
  const loadout = isShmup ? getActiveLoadout(ctx.def, ctx.shmup.fighterId) : undefined;
  const camZoom = isShmup ? 1.0 : ctx.cameraZoom;
  const interpCamX = alpha < 1 ? ctx.prevCameraX + (ctx.cameraX - ctx.prevCameraX) * alpha : ctx.cameraX;
  const interpCamY = alpha < 1 ? ctx.prevCameraY + (ctx.cameraY - ctx.prevCameraY) * alpha : ctx.cameraY;
  const camX = interpCamX + ctx.juice.shakeX + ctx.juice.kickX;
  const camY = interpCamY + ctx.juice.shakeY + ctx.juice.kickY;
  const safeZoom = Math.max(0.5, camZoom);
  const viewW = ctx.stageViewport.width / safeZoom;
  const viewH = ctx.stageViewport.height / safeZoom;
  const margin = 96 / safeZoom;
  const visMinX = camX - margin;
  const visMinY = camY - margin;
  const visMaxX = camX + viewW + margin;
  const visMaxY = camY + viewH + margin;

  let tileSlotCount = 0;
  const gh = ctx.def.meta.genreHud;
  const autoTileEnabled = gh === 'parkour' || gh === 'fighter' || gh === 'card' || gh === 'grid';
  const midChunks = ctx.tilemap.updateActiveChunks(visMinX, visMinY, visMaxX, visMaxY, 0);
  for (let ci = 0; ci < midChunks; ci++) {
    const slot = ctx.tilemap.activeChunkIds[ci];
    const baseCol = ctx.tilemap.activeChunkCols[ci] << CHUNK_SHIFT;
    const baseRow = ctx.tilemap.activeChunkRows[ci] << CHUNK_SHIFT;
    const baseSlab = slot << 8;
    for (let lr = 0; lr < CHUNK_SIZE; lr++) {
      const row = baseRow + lr;
      const y = row * TILE_SIZE;
      if (y + TILE_SIZE < visMinY || y > visMaxY) continue;
      const h = Math.min(TILE_SIZE, Math.max(1, ctx.stageWorldH - y));
      const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
      for (let lc = 0; lc < CHUNK_SIZE; lc++) {
        const tid = ctx.tilemap.tilesSlab[rowSlab | lc];
        if (tid === 0) continue;
        const col = baseCol + lc;
        const x = col * TILE_SIZE;
        if (x + TILE_SIZE < visMinX || x > visMaxX) continue;
        const dst = acquireTileSlot(bank.tileSlots, tileSlotCount);
        let sprite = ctx.tileSpriteLut[tid] ?? 'stone';
        let autoMask: number | undefined;
        if (autoTileEnabled) {
          if (sprite === 'stone') {
            const mask = ctx.tilemap.getAutoMask(col, row) & 15;
            sprite = CLIFF_MASK_SPRITES[mask];
            autoMask = mask;
          } else if (sprite === 'grass') {
            const mask = ctx.tilemap.getAutoMask(col, row) & 15;
            sprite = GRASS_MASK_SPRITES[mask];
            autoMask = mask;
          }
        }
        dst.sprite = sprite;
        dst.x = x;
        dst.y = y;
        dst.w = TILE_SIZE;
        dst.h = h;
        dst.tint = undefined;
        dst.unlockable = undefined;
        dst.extrudeH = undefined;
        dst.extrudeAtY = undefined;
        dst.wallColor = undefined;
        dst.wallMaterial = undefined;
        dst.elevationZ = undefined;
        dst.sortY = undefined;
        dst.castShadow = undefined;
        dst.alpha = undefined;
        dst.flipX = undefined;
        dst.autoMask = autoMask;
        dst.variant = undefined;
        dst.windSway = undefined;
        outTiles[tileSlotCount++] = dst;
      }
    }
  }

  let fgSlotCount = 0;
  if (ctx.hasFgTilemapTiles) {
    const fgChunks = ctx.fgTilemap.updateActiveChunks(visMinX, visMinY, visMaxX, visMaxY, 0);
    for (let ci = 0; ci < fgChunks; ci++) {
      const slot = ctx.fgTilemap.activeChunkIds[ci];
      const baseCol = ctx.fgTilemap.activeChunkCols[ci] << CHUNK_SHIFT;
      const baseRow = ctx.fgTilemap.activeChunkRows[ci] << CHUNK_SHIFT;
      const baseSlab = slot << 8;
      for (let lr = 0; lr < CHUNK_SIZE; lr++) {
        const y = (baseRow + lr) * TILE_SIZE;
        if (y + TILE_SIZE < visMinY || y > visMaxY) continue;
        const h = Math.min(TILE_SIZE, Math.max(1, ctx.stageWorldH - y));
        const rowSlab = baseSlab | (lr << CHUNK_SHIFT);
        for (let lc = 0; lc < CHUNK_SIZE; lc++) {
          const ftid = ctx.fgTilemap.tilesSlab[rowSlab | lc];
          if (ftid === 0) continue;
          const x = (baseCol + lc) * TILE_SIZE;
          if (x + TILE_SIZE < visMinX || x > visMaxX) continue;
          const dst = acquireTileSlot(bank.fgTileSlots, fgSlotCount);
          dst.sprite = ctx.fgSpriteLut[ftid] ?? 'tree_canopy';
          dst.x = x;
          dst.y = y;
          dst.w = TILE_SIZE;
          dst.h = h;
          dst.tint = undefined;
          dst.unlockable = undefined;
          dst.extrudeH = undefined;
          dst.extrudeAtY = undefined;
          dst.wallColor = undefined;
          dst.wallMaterial = undefined;
          dst.elevationZ = undefined;
          dst.sortY = undefined;
          dst.castShadow = false;
          dst.alpha = ctx.fgAlphaLut[ftid];
          dst.flipX = undefined;
          outFgTiles[fgSlotCount++] = dst;
        }
      }
    }
  }
  for (let i = 0; i < ctx.fgExtraTiles.length; i++) {
    const ft = ctx.fgExtraTiles[i];
    if (ft.x + ft.w < visMinX || ft.x > visMaxX || ft.y + ft.h < visMinY || ft.y > visMaxY) continue;
    const dst = acquireTileSlot(bank.fgTileSlots, fgSlotCount);
    dst.sprite = ft.sprite;
    dst.x = ft.x;
    dst.y = ft.y;
    dst.w = ft.w;
    dst.h = ft.h;
    dst.tint = ft.tint;
    dst.unlockable = undefined;
    dst.extrudeH = undefined;
    dst.extrudeAtY = undefined;
    dst.wallColor = undefined;
    dst.wallMaterial = undefined;
    dst.elevationZ = ft.elevationZ;
    dst.sortY = ft.sortY;
    dst.castShadow = false;
    dst.alpha = ft.alpha;
    dst.flipX = ft.flipX;
    outFgTiles[fgSlotCount++] = dst;
  }
  if (outFgTiles.length > fgSlotCount) outFgTiles.length = fgSlotCount;

  let bossHp = 0;
  let bossMaxHp = 0;
  let entSlotCount = 0;
  let lightSlotCount = 0;

  for (let i = 0; i < ctx.pool.activeCount; i++) {
    const s = ctx.pool.activeIndices[i];
    const f = ctx.pool.flags[s];
    if ((f & EF_ALIVE) === 0) continue;

    if ((f & EF_BOSS) !== 0) {
      bossHp = Math.max(0, ctx.pool.hp[s]);
      bossMaxHp = ctx.pool.maxHp[s];
    }

    const rx = ctx.pool.renderX(s, alpha);
    const ry = ctx.pool.renderY(s, alpha);
    const ew = ctx.pool.w[s];
    const eh = ctx.pool.h[s];

    if ((ctx.pool.behaviorMask[s] & BM_MOVING_PLATFORM) !== 0) {
      if (rx + ew < visMinX || rx > visMaxX || ry + 20 < visMinY || ry > visMaxY) continue;
      for (let tx = 0; tx < ew; tx += TILE_SIZE) {
        const dst = acquireTileSlot(bank.tileSlots, tileSlotCount);
        dst.sprite = 'moving_plat';
        dst.x = rx + tx;
        dst.y = ry;
        dst.w = Math.min(TILE_SIZE, ew - tx);
        dst.h = 16;
        dst.tint = undefined;
        dst.unlockable = undefined;
        dst.extrudeH = 3;
        dst.extrudeAtY = ry + 6;
        dst.wallColor = '#344c66';
        dst.wallMaterial = 'timber';
        dst.elevationZ = undefined;
        dst.sortY = undefined;
        dst.castShadow = undefined;
        dst.alpha = undefined;
        dst.flipX = undefined;
        outTiles[tileSlotCount++] = dst;
      }
      continue;
    }

    const rrot = ctx.pool.renderRot(s, alpha);

    if (s === ctx.playerSlot) {
      const inv = isShmup ? ctx.shmup.invulnTimer : ctx.invulnTimer;
      const blink = inv > 0 && Math.floor(inv * 16) % 2 === 1;
      if (blink && ctx.pool.flash[s] <= 0) continue;

      let sprite: SpriteId = ctx.def.player.sprite;
      const ctrl = ctx.def.player.controller;
      if (isShmup && loadout) {
        sprite = Math.floor(t * 12) % 2 === 0 ? loadout.spriteA : loadout.spriteB;
      } else if (!isShmup) {
        if (ctx.def.player.visualRig?.stateSprites) {
          sprite = ctx.visualRig.resolveStateSprite(
            ctx.def.player.sprite,
            ctx.def.player.spriteB,
            ctx.walkAnim,
            ctx.pool.vx[s],
            ctx.pool.vy[s],
            ctx.aabbRes.onGround,
            ctx.aabbRes.hitWall,
            ctx.dashTimer > 0,
            ctx.grappleState === 'swinging' || ctx.grappleState === 'pulling',
          );
        } else if (ctx.def.player.spriteB) {
          const moving =
            ctrl === 'topdown'
              ? Math.hypot(ctx.pool.vx[s], ctx.pool.vy[s]) > 8
              : ctrl === 'card'
                ? false
                : Math.abs(ctx.pool.vx[s]) > 8 || !ctx.aabbRes.onGround;
          sprite = moving && Math.floor(ctx.walkAnim) % 2 === 1 ? ctx.def.player.spriteB : ctx.def.player.sprite;
        }
      }
      ctx.lastHeroSprite = sprite;

      if (ctx.visualRig.hasVerletRig() || ctx.visualRig.hasAfterimage()) {
        const prevEntIdx = entSlotCount;
        const eSink = bank.entitySink;
        while (eSink.length > 0) eSink.pop();
        entSlotCount = ctx.visualRig.emitPreHeroEntities(eSink, bank.entitySlots, entSlotCount);
        for (let k = 0; k < eSink.length; k++) {
          outEntities[prevEntIdx + k] = eSink[k];
        }
      }

      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount);
      dst.id = isShmup ? 'ship' : 'hero';
      dst.sprite = sprite;
      dst.x = rx;
      dst.y = ry;
      dst.w = ew;
      dst.h = eh;
      dst.scaleX = ctx.pool.sx[s];
      dst.scaleY = ctx.pool.sy[s];
      dst.anchorY = isShmup ? 0.5 : 1;
      dst.skewX = ctx.pool.skewX[s];
      dst.rot = rrot;
      dst.flash = Math.min(1, ctx.pool.flash[s]);
      dst.flipX = (f & EF_FLIP_X) !== 0;
      dst.additive = undefined;
      dst.emissive = undefined;
      dst.tint = ctrl === 'fighter' && ctx.genre.p1.state === 'block' ? '#5ec2f7' : undefined;
      dst.alpha = undefined;
      dst.paletteRow = ctx.pool.paletteRow[s] || undefined;
      dst.elevationZ = undefined;
      dst.shadowOffsetY = undefined;
      dst.castShadow = !isShmup;
      dst.shadowRadius = 6;
      dst.sortY = undefined;
      dst.artBlueprintId = ctx.def.player.artBlueprintId;
      dst.artFacing = undefined;
      dst.artPose = undefined;
      dst.yawRad = undefined;
      dst.billboardScale = undefined;
      dst.hideInFirstPerson = ctx.dualPerspective.isEnabled() ? true : undefined;
      outEntities[entSlotCount++] = dst;

      if (ctx.visualRig.hasIkRig()) {
        const prevPostIdx = entSlotCount;
        const eSink = bank.entitySink;
        while (eSink.length > 0) eSink.pop();
        entSlotCount = ctx.visualRig.emitPostHeroEntities(eSink, bank.entitySlots, entSlotCount);
        for (let k = 0; k < eSink.length; k++) {
          outEntities[prevPostIdx + k] = eSink[k];
        }
      }

      if (glow > 0.05) {
        const isDark = (st.ambientDarkness ?? 0) > 0.16;
        const l = acquireLightSlot(bank.lightSlots, lightSlotCount);
        l.x = rx + 8;
        l.y = ry + 8;
        l.radius = isShmup ? 24 : isDark ? 42 : 22;
        l.color = loadout?.accentHex ?? '#ffe8a8';
        l.intensity = (isShmup ? 0.18 : isDark ? 0.42 : 0.09) * glow;
        l.falloffPower = undefined;
        outLights[lightSlotCount++] = l;
      }
      continue;
    }

    const archIdx = ctx.pool.archetypeIdx[s];
    const arch = archIdx >= 0 ? ctx.archetypes[archIdx] : undefined;
    const lr = arch?.def.light ? arch.def.light.radius : 0;
    const inLightFrustum =
      lr > 0 && glow > 0.05 && rx + ew + lr >= visMinX && rx - lr <= visMaxX && ry + eh + lr >= visMinY && ry - lr <= visMaxY;
    const inEntFrustum = rx + ew >= visMinX && rx <= visMaxX && ry + eh >= visMinY && ry <= visMaxY;
    if (!inEntFrustum && !inLightFrustum) continue;

    if (inEntFrustum) {
      if ((f & EF_CRUMBLE_TILE) !== 0 && ctx.pool.aiState[s] === 2) continue;
      let sprite: SpriteId = arch?.def.sprite ?? 'star_a';
      if (arch?.def.spriteB && Math.floor((t * (arch.def.animFps ?? 4) + ctx.pool.paramA[s]) % 2) === 1) {
        sprite = arch.def.spriteB;
      }
      if (arch?.id === 'checkpoint_flag' && ctx.pool.aiState[s] === 1) {
        sprite = 'flag_on';
      }
      if ((f & EF_LOGIC_SWITCH) !== 0 && ctx.pool.aiState[s] === 1) {
        sprite = 'switch_on';
      }
      if (arch?.id === 'gate' && ctx.gateUnlocked) {
        sprite = 'gate_open';
      }

      let tint = arch?.def.tint;
      if (arch?.id === 'cargo') {
        const cyc = Math.floor(t / 1.1) % 4;
        tint = cyc === 0 ? '#ff708d' : cyc === 1 ? '#5ec2f7' : cyc === 2 ? '#e0aaff' : '#ffd447';
      } else if (isShmup && (f & EF_BOSS) !== 0 && ctx.pool.aiState[s] === 2) {
        tint = Math.floor(t * 8) % 2 === 0 ? '#ff708d' : '#e0aaff';
      } else if (ctx.def.player.controller === 'fighter' && s === ctx.genre.p2Slot && ctx.genre.p2.state === 'block') {
        tint = '#5ec2f7';
      }

      const crumbleShakeX = (f & EF_CRUMBLE_TILE) !== 0 && ctx.pool.aiState[s] === 1 ? Math.sin(t * 58) * 1.4 : 0;
      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount);
      dst.id = ctx.getEntityId(s, archIdx);
      dst.sprite = sprite;
      dst.x = rx + crumbleShakeX;
      dst.y = ry;
      dst.w = ew;
      dst.h = eh;
      dst.rot = rrot;
      dst.scaleX = ctx.pool.sx[s];
      dst.scaleY = ctx.pool.sy[s];
      dst.anchorY = isShmup ? 0.5 : 1;
      dst.skewX = undefined;
      dst.flash = Math.min(1, ctx.pool.flash[s] * 4);
      dst.flipX = (f & EF_FLIP_X) !== 0;
      dst.additive = (f & EF_ADDITIVE) !== 0;
      dst.emissive = (f & EF_EMISSIVE) !== 0 ? (arch?.def.emissive ?? ((f & EF_PIERCING) !== 0 ? 1.1 : 0.8)) : undefined;
      dst.tint = tint;
      dst.alpha = (f & EF_CRYSTAL_RESET) !== 0 && ctx.pool.timerA[s] > 0 ? 0.28 : undefined;
      dst.paletteRow = ctx.pool.paletteRow[s] || undefined;
      dst.elevationZ = undefined;
      dst.shadowOffsetY = undefined;
      dst.castShadow = arch?.def.castShadow;
      dst.shadowRadius = ew * 0.36;
      dst.sortY = undefined;
      dst.artBlueprintId = arch?.def.artBlueprintId;
      dst.artFacing = undefined;
      dst.artPose = undefined;
      dst.yawRad = undefined;
      dst.billboardScale = undefined;
      dst.hideInFirstPerson = undefined;
      outEntities[entSlotCount++] = dst;
    }

    if (inLightFrustum && arch?.def.light) {
      const l = acquireLightSlot(bank.lightSlots, lightSlotCount);
      l.x = rx + ew * 0.5;
      l.y = ry + eh * 0.5;
      l.radius = lr;
      l.color = arch.def.light.color;
      l.intensity = arch.def.light.intensity * glow;
      l.falloffPower = undefined;
      outLights[lightSlotCount++] = l;
    }
  }
  if (outTiles.length > tileSlotCount) outTiles.length = tileSlotCount;
  if (outLights.length > lightSlotCount) outLights.length = lightSlotCount;

  // Emit runtime grapple rope & aiming reticle when grappleConfig is active
  if (ctx.grappleEnabled && ctx.playerSlot >= 0 && (ctx.pool.flags[ctx.playerSlot] & EF_ALIVE) !== 0) {
    const hx = ctx.pool.renderX(ctx.playerSlot, alpha) + ctx.pool.w[ctx.playerSlot] * 0.5;
    const hy = ctx.pool.renderY(ctx.playerSlot, alpha) + ctx.pool.h[ctx.playerSlot] * 0.5;
    if (ctx.grappleState !== 'idle') {
      const endX = ctx.grappleState === 'shooting' ? ctx.grappleTipX : ctx.grappleAnchorX;
      const endY = ctx.grappleState === 'shooting' ? ctx.grappleTipY : ctx.grappleAnchorY;
      const dx = endX - hx;
      const dy = endY - hy;
      const ang = Math.atan2(dy, dx);
      for (let k = 0; k < RT_GRAPPLE_LINKS; k++) {
        const u = (k + 1) / (RT_GRAPPLE_LINKS + 1);
        const lDst = acquireEntitySlot(bank.entitySlots, entSlotCount);
        lDst.id = ctx.grappleLinkIds[k];
        lDst.sprite = 'grapple_link';
        lDst.x = hx + dx * u - 5;
        lDst.y = hy + dy * u - 4;
        lDst.w = 10;
        lDst.h = 8;
        lDst.rot = ang;
        lDst.scaleX = 1;
        lDst.scaleY = 1;
        lDst.anchorY = 0.5;
        lDst.skewX = undefined;
        lDst.flash = 0;
        lDst.flipX = false;
        lDst.additive = false;
        lDst.emissive = 0.7;
        lDst.tint = ctx.grappleMode === 'swing' ? '#ff5d8f' : '#5ec2f7';
        lDst.alpha = 1;
        lDst.paletteRow = undefined;
        lDst.elevationZ = undefined;
        lDst.shadowOffsetY = undefined;
        lDst.castShadow = false;
        lDst.shadowRadius = undefined;
        lDst.sortY = undefined;
        outEntities[entSlotCount++] = lDst;
      }
      const cDst = acquireEntitySlot(bank.entitySlots, entSlotCount);
      cDst.id = 'rt-grapple-claw';
      cDst.sprite = 'grapple_claw';
      cDst.x = endX - 7;
      cDst.y = endY - 7;
      cDst.w = 14;
      cDst.h = 14;
      cDst.rot = ang;
      cDst.scaleX = 1;
      cDst.scaleY = 1;
      cDst.anchorY = 0.5;
      cDst.skewX = undefined;
      cDst.flash = 0;
      cDst.flipX = false;
      cDst.additive = false;
      cDst.emissive = 0.9;
      cDst.tint = undefined;
      cDst.alpha = 1;
      cDst.paletteRow = undefined;
      cDst.elevationZ = undefined;
      cDst.shadowOffsetY = undefined;
      cDst.castShadow = false;
      cDst.shadowRadius = undefined;
      cDst.sortY = undefined;
      outEntities[entSlotCount++] = cDst;
    } else if (ctx.grapplePreviewKind !== 'none') {
      const rDst = acquireEntitySlot(bank.entitySlots, entSlotCount);
      rDst.id = 'rt-grapple-reticle';
      rDst.sprite = 'grapple_reticle';
      rDst.x = ctx.grapplePreviewX - 7;
      rDst.y = ctx.grapplePreviewY - 7;
      rDst.w = 14;
      rDst.h = 14;
      rDst.rot = t * 5;
      rDst.scaleX = 1;
      rDst.scaleY = 1;
      rDst.anchorY = 0.5;
      rDst.skewX = undefined;
      rDst.flash = 0;
      rDst.flipX = false;
      rDst.additive = false;
      rDst.emissive = 0.92;
      rDst.tint = ctx.grapplePreviewKind === 'ring' ? '#ffd447' : '#5ec2f7';
      rDst.alpha = 0.95;
      rDst.paletteRow = undefined;
      rDst.elevationZ = undefined;
      rDst.shadowOffsetY = undefined;
      rDst.castShadow = false;
      rDst.shadowRadius = undefined;
      rDst.sortY = undefined;
      outEntities[entSlotCount++] = rDst;
    }
  }
  if (outEntities.length > entSlotCount) outEntities.length = entSlotCount;

  let debugRects: DebugRectDesc[] | undefined;
  if (ctx.debugHitboxes) {
    debugRects = bank.debugRects;
    let dCount = 0;
    const c0 = Math.max(0, Math.floor(visMinX / TILE_SIZE));
    const c1 = Math.min(ctx.tilemap.cols - 1, Math.floor(visMaxX / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(visMinY / TILE_SIZE));
    const r1 = Math.min(ctx.tilemap.rows - 1, Math.floor(visMaxY / TILE_SIZE));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const colKind = ctx.tilemap.getCollision(c, r);
        if (colKind === COLLISION_EMPTY) continue;
        const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount);
        dr.x = c * TILE_SIZE;
        dr.y = r * TILE_SIZE;
        dr.w = TILE_SIZE;
        dr.h = colKind === COLLISION_CLOUD ? 10 : TILE_SIZE;
        dr.color = colKind === COLLISION_CLOUD ? '#5ec2f7' : '#56d39c';
        debugRects[dCount++] = dr;
      }
    }
    for (let i = 0; i < entSlotCount; i++) {
      const e = outEntities[i];
      const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount);
      dr.x = e.x;
      dr.y = e.y;
      dr.w = e.w;
      dr.h = e.h;
      dr.color = e.id === 'hero' || e.id === 'ship' ? '#ffd447' : '#e0aaff';
      debugRects[dCount++] = dr;
    }
    if (debugRects.length > dCount) debugRects.length = dCount;
  }

  let pCount = 0;
  const jp = ctx.juice.particles;
  for (let i = 0; i < jp.length; i++) {
    bank.particles[pCount++] = jp[i];
  }
  if (ctx.visualRig.getActiveAmbientParticleCount() > 0) {
    const pSink = bank.particleSink;
    while (pSink.length > 0) pSink.pop();
    ctx.visualRig.emitAmbientParticles(pSink);
    for (let i = 0; i < pSink.length; i++) {
      bank.particles[pCount++] = pSink[i];
    }
  }
  if (bank.particles.length > pCount) bank.particles.length = pCount;

  let totalCollected = 0;
  if (!isShmup) {
    for (let i = 0; i < ctx.def.stages.length; i++) {
      totalCollected += i === ctx.stageIdx ? Math.max(ctx.bestStarsByStage[i], ctx.stageStarsCollected) : ctx.bestStarsByStage[i];
    }
  } else {
    totalCollected = ctx.starsCollected;
  }

  bank.viewport.width = ctx.stageViewport.width;
  bank.viewport.height = ctx.stageViewport.height;
  bank.stageInfo.index = ctx.stageIdx + 1;
  bank.stageInfo.total = ctx.def.stages.length;
  bank.stageInfo.name = st.name;

  const snap = bank.snapshot;
  snap.cartridgeId = ctx.def.meta.id;
  snap.skyTop = ctx.stageSkyTop;
  snap.skyBottom = ctx.stageSkyBottom;
  snap.cozyFilter = params.cozyFilter > 0;
  snap.glowIntensity = glow;
  snap.paletteRow = st.paletteRow ?? ctx.def.meta.paletteRow ?? 0;
  snap.timeSec = t;
  snap.elapsedSec = ctx.elapsedSec;
  snap.status = ctx.status;
  snap.score = ctx.score;
  snap.comboCount = ctx.juice.comboCount;
  snap.starsCollected = totalCollected;
  snap.starsTotal = isShmup ? Math.max(12, totalCollected + 3) : ctx.totalCampaignStars;
  snap.hasKey = ctx.hasKey;
  snap.hearts = Math.max(0, ctx.hearts);
  snap.maxHearts = ctx.maxHearts;
  snap.bossHp = bossHp;
  snap.bossMaxHp = bossMaxHp;
  snap.cameraX = camX;
  snap.cameraY = camY;
  snap.cameraZoom = camZoom;
  snap.viewport = bank.viewport;
  snap.ambientDarkness = st.ambientDarkness ?? 0;
  snap.ambientColor = ctx.stageAmbientColor;
  snap.screenFlashAlpha = ctx.juice.flashAlpha;
  snap.screenFlashColor = ctx.juice.flashColor;
  snap.bgStars = ctx.bgStars as BgStarDesc[];
  snap.bgParallaxLayers = ctx.bgParallaxLayers.length > 0 ? (ctx.bgParallaxLayers as BgParallaxLayerDesc[]) : undefined;
  snap.bgClouds = ctx.bgClouds as BgCloudDesc[];
  snap.tiles = outTiles;
  snap.fgTiles = outFgTiles.length > 0 ? outFgTiles : undefined;
  snap.entities = outEntities;
  snap.particles = bank.particles;
  snap.lights = outLights;
  snap.debugRects = debugRects;
  snap.hd2dDepth = ctx.hd2dConfig.enabled ? ctx.hd2dConfig : undefined;
  if (ctx.dualPerspective.isEnabled() && ctx.playerSlot >= 0) {
    ctx.dualPerspective.annotateEntitiesForPerspective(outEntities, ctx.pool);
    const vx = ctx.pool.renderX(ctx.playerSlot, alpha) + ctx.pool.w[ctx.playerSlot] * 0.5;
    const vy = ctx.pool.renderY(ctx.playerSlot, alpha) + ctx.pool.h[ctx.playerSlot] * 0.5;
    snap.perspective = ctx.dualPerspective.buildProjectionDesc(vx, vy);
  } else {
    snap.perspective = undefined;
  }
  snap.customArtBlueprints = ctx.def.artBlueprints;
  const hideCtrl = ctx.def.player.controller;
  snap.hideClassicHud =
    Boolean(ctx.cardEngine || ctx.fighterEngine) ||
    hideCtrl === 'fighter' ||
    hideCtrl === 'card' ||
    hideCtrl === 'topdown' ||
    gh === 'fighter' ||
    gh === 'card' ||
    gh === 'grid';

  if (ctx.cardEngine) {
    const hudOut = bank.hudPrimitives;
    const eSink = bank.entitySink;
    const hSink = bank.hudSink;
    while (eSink.length > 0) eSink.pop();
    while (hSink.length > 0) hSink.pop();
    ctx.cardEngine.emitSceneAndHud(eSink, hSink, bank.viewport.width, bank.viewport.height);
    for (let i = 0; i < eSink.length; i++) outEntities[i] = eSink[i];
    if (outEntities.length > eSink.length) outEntities.length = eSink.length;
    let hCount = hSink.length;
    for (let i = 0; i < hCount; i++) hudOut[i] = hSink[i];
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = ctx.floatingTexts[i];
      if (!ft.active) continue;
      const tSlot = acquireHudSlot(bank.hudSlots, hCount);
      tSlot.kind = 'text';
      tSlot.x = ft.x;
      tSlot.y = ft.y;
      tSlot.text = ft.text;
      tSlot.scale = 1;
      tSlot.align = 'center';
      tSlot.color = ft.color;
      tSlot.shadowColor = '#120d1e';
      tSlot.alpha = clamp(1 - (ft.life / ft.maxLife) * 0.4, 0.25, 1);
      tSlot.worldSpace = false;
      hudOut[hCount++] = tSlot;
    }
    if (hudOut.length > hCount) hudOut.length = hCount;
    snap.hudPrimitives = hudOut;
  } else if (ctx.fighterEngine) {
    const hudOut = bank.hudPrimitives;
    const fighterDbg = bank.debugRects;
    const eSink = bank.entitySink;
    const hSink = bank.hudSink;
    const dSink = bank.debugSink;
    while (eSink.length > 0) eSink.pop();
    while (hSink.length > 0) hSink.pop();
    while (dSink.length > 0) dSink.pop();
    ctx.fighterEngine.emitSceneAndHud(eSink, hSink, dSink, bank.viewport.width);
    for (let i = 0; i < eSink.length; i++) outEntities[i] = eSink[i];
    if (outEntities.length > eSink.length) outEntities.length = eSink.length;
    let hCount = hSink.length;
    for (let i = 0; i < hCount; i++) hudOut[i] = hSink[i];
    for (let i = 0; i < dSink.length; i++) fighterDbg[i] = dSink[i];
    if (fighterDbg.length > dSink.length) fighterDbg.length = dSink.length;
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = ctx.floatingTexts[i];
      if (!ft.active) continue;
      const tSlot = acquireHudSlot(bank.hudSlots, hCount);
      tSlot.kind = 'text';
      tSlot.x = ft.x;
      tSlot.y = ft.y;
      tSlot.text = ft.text;
      tSlot.scale = 1;
      tSlot.align = 'center';
      tSlot.color = ft.color;
      tSlot.shadowColor = '#120d1e';
      tSlot.alpha = clamp(1 - (ft.life / ft.maxLife) * 0.4, 0.25, 1);
      tSlot.worldSpace = true;
      hudOut[hCount++] = tSlot;
    }
    if (hudOut.length > hCount) hudOut.length = hCount;
    snap.debugRects = fighterDbg.length > 0 ? fighterDbg : undefined;
    snap.hudPrimitives = hudOut;
  } else {
    snap.hudPrimitives = buildDataCartridgeHudPrimitives(ctx, bank, bossHp, bossMaxHp, alpha);
  }

  snap.statusBanner = ctx.statusBanner;
  snap.stage = bank.stageInfo;
  snap.bgmTheme = st.bgmTheme;
  snap.shmupHud = isShmup ? buildShmupHudFromPool(ctx) : undefined;
  return snap;
}

function buildDataCartridgeHudPrimitives(
  ctx: DataSnapshotProjectorContext,
  bank: RuntimeSnapshotBank,
  bossHp: number,
  bossMaxHp: number,
  alpha: number,
): HudPrimitiveDesc[] | undefined {
  const ctrl = ctx.def.player.controller;
  const dualOn = ctx.dualPerspective.isEnabled();
  const genreHud =
    ctx.def.meta.genreHud ??
    (ctrl === 'fighter'
      ? 'fighter'
      : ctrl === 'card'
        ? 'card'
        : ctrl === 'topdown' && !dualOn
          ? 'grid'
          : undefined);
  const needsAimLine =
    ctx.grappleEnabled &&
    ctx.grappleState === 'idle' &&
    ctx.playerSlot >= 0 &&
    (ctx.pool.flags[ctx.playerSlot] & EF_ALIVE) !== 0;

  let hasActiveFloatText = false;
  for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
    if (ctx.floatingTexts[i].active) {
      hasActiveFloatText = true;
      break;
    }
  }

  if (!needsAimLine && !hasActiveFloatText && !dualOn && (!genreHud || genreHud === 'platformer')) {
    return undefined;
  }

  const out = bank.hudPrimitives;
  let count = 0;
  const vw = bank.viewport.width;
  const vh = bank.viewport.height;

  if (needsAimLine) {
    const hx = ctx.pool.renderX(ctx.playerSlot, alpha) + ctx.pool.w[ctx.playerSlot] * 0.5;
    const hy = ctx.pool.renderY(ctx.playerSlot, alpha) + ctx.pool.h[ctx.playerSlot] * 0.5;
    const locked = ctx.grapplePreviewKind !== 'none';
    const slot = acquireHudSlot(bank.hudSlots, count);
    slot.kind = 'aim_line';
    slot.x = hx;
    slot.y = hy;
    if (locked) {
      slot.x2 = ctx.grapplePreviewX;
      slot.y2 = ctx.grapplePreviewY;
    } else {
      const len = Math.min(148, ctx.grappleMaxRange * 0.9);
      slot.x2 = hx + Math.cos(ctx.grappleAimAngle) * len;
      slot.y2 = hy + Math.sin(ctx.grappleAimAngle) * len;
    }
    slot.w = 2;
    slot.h = 2;
    slot.color = locked ? '#ffd447' : '#5ec2f7';
    slot.alpha = locked ? 0.85 : 0.45;
    slot.worldSpace = true;
    out[count++] = slot;
  }

  if (genreHud === 'parkour') {
    const ready = ctx.dashCooldown <= 0 && ctx.grappleState === 'idle';
    const bar = acquireHudSlot(bank.hudSlots, count);
    bar.kind = 'bar';
    bar.x = 8;
    bar.y = 8;
    bar.w = 68;
    bar.h = 6;
    bar.ratio = ready ? 1 : clamp(1 - ctx.dashCooldown / 0.55, 0.15, 0.95);
    bar.color = ready ? '#ff5d8f' : '#5ec2f7';
    bar.bgColor = '#120e24';
    bar.alpha = 0.9;
    out[count++] = bar;
  } else if (genreHud === 'fighter' || genreHud === 'card' || genreHud === 'grid') {
    const prevCount = count;
    const hSink = bank.hudSink;
    while (hSink.length > 0) hSink.pop();
    count = buildGenreHudPrimitives(ctx, genreHud, hSink, bank.hudSlots, count, vw, vh, bossHp, bossMaxHp);
    for (let i = 0; i < hSink.length; i++) {
      out[prevCount + i] = hSink[i];
    }
  }

  if (dualOn) {
    const dualTopY = genreHud === 'grid' ? 28 : genreHud === 'parkour' ? 20 : 8;
    const prevCount = count;
    const hSink = bank.hudSink;
    while (hSink.length > 0) hSink.pop();
    count = ctx.dualPerspective.appendHudIndicators(hSink, bank.hudSlots, count, vw, dualTopY);
    for (let i = 0; i < hSink.length; i++) {
      out[prevCount + i] = hSink[i];
    }
  }

  // Floating pixel text popups (world-space)
  for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
    const ft = ctx.floatingTexts[i];
    if (!ft.active) continue;
    const tSlot = acquireHudSlot(bank.hudSlots, count);
    tSlot.kind = 'text';
    tSlot.x = ft.x;
    tSlot.y = ft.y;
    tSlot.w = 0;
    tSlot.h = 0;
    tSlot.text = ft.text;
    tSlot.scale = 1;
    tSlot.align = 'center';
    tSlot.color = ft.color;
    tSlot.shadowColor = '#120d1e';
    tSlot.alpha = clamp(1 - (ft.life / ft.maxLife) * 0.4, 0.25, 1);
    tSlot.worldSpace = true;
    out[count++] = tSlot;
  }

  if (out.length > count) out.length = count;
  return count > 0 ? out : undefined;
}
