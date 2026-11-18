import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { LogicalViewport } from '../gpu/GpuTypes.ts';
import type {
  DebugRectDesc,
  EntityDesc,
  LightDesc,
  RenderSceneSnapshot,
  RuntimeParams,
  TileDesc,
} from '../types/WorldTypes.ts';
import type { WorldKernel } from './WorldKernel.ts';

interface WorldSnapshotBank {
  snapshot: RenderSceneSnapshot;
  viewport: { width: number; height: number };
  tileSlots: TileDesc[];
  fgTileSlots: TileDesc[];
  entitySlots: EntityDesc[];
  lightSlots: LightDesc[];
  debugRectSlots: DebugRectDesc[];
  tiles: TileDesc[];
  fgTiles: TileDesc[];
  entities: EntityDesc[];
  lights: LightDesc[];
  debugRects: DebugRectDesc[];
}

export interface WorldSnapshotPool {
  bankIndex: 0 | 1;
  banks: [WorldSnapshotBank, WorldSnapshotBank];
  sparkIdCache: string[];
}

function createBank(cartridgeId: WorldKernel['cartridgeId'], vp: LogicalViewport): WorldSnapshotBank {
  const viewport = { width: vp.width, height: vp.height };
  const tiles: TileDesc[] = [];
  const fgTiles: TileDesc[] = [];
  const entities: EntityDesc[] = [];
  const lights: LightDesc[] = [];
  const debugRects: DebugRectDesc[] = [];
  return {
    viewport,
    tileSlots: [],
    fgTileSlots: [],
    entitySlots: [],
    lightSlots: [],
    debugRectSlots: [],
    tiles,
    fgTiles,
    entities,
    lights,
    debugRects,
    snapshot: {
      cartridgeId,
      skyTop: '#8fd8ff',
      skyBottom: '#fff4df',
      cozyFilter: true,
      glowIntensity: 1,
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
      particles: [],
      lights,
      debugRects: undefined,
      statusBanner: '',
      stage: undefined,
      bgmTheme: undefined,
    },
  };
}

export function createWorldSnapshotPool(
  cartridgeId: WorldKernel['cartridgeId'],
  viewport: LogicalViewport,
): WorldSnapshotPool {
  return {
    bankIndex: 0,
    banks: [createBank(cartridgeId, viewport), createBank(cartridgeId, viewport)],
    sparkIdCache: [],
  };
}

function acquireTileSlot(pool: TileDesc[], idx: number): TileDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { sprite: 'stone', x: 0, y: 0, w: 16, h: 16 };
    pool[idx] = slot;
  }
  return slot;
}

function acquireEntitySlot(pool: EntityDesc[], idx: number): EntityDesc {
  let slot = pool[idx];
  if (!slot) {
    slot = { id: '', sprite: 'star_a', x: 0, y: 0, w: 16, h: 16 };
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
    slot = { x: 0, y: 0, w: 16, h: 16, color: '#56d39c' };
    pool[idx] = slot;
  }
  return slot;
}

function getSparkId(cache: string[], idx: number): string {
  let id = cache[idx];
  if (id === undefined) {
    id = `spark-${idx}`;
    cache[idx] = id;
  }
  return id;
}

function findFloorDropY(world: WorldKernel, cx: number, bottomY: number): number | null {
  let bestDelta = 46;
  let found: number | null = null;
  const solids = world.solids;
  if (solids.length > 32 && solids.length <= world.solidHash.capacity) {
    world.ensureSolidHash();
    const hitCount = world.solidHash.queryRect(
      cx - 1.5,
      bottomY - 3.5,
      cx + 1.5,
      bottomY + 46.5,
      world.solidQuerySlots,
    );
    for (let k = 0; k < hitCount; k++) {
      const s = solids[world.solidQuerySlots[k]];
      if (cx >= s.x + 1 && cx <= s.x + s.w - 1 && s.y >= bottomY - 3) {
        const delta = s.y - bottomY;
        if (delta < bestDelta) {
          bestDelta = delta;
          found = Math.max(0, delta);
        }
      }
    }
  } else {
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (cx >= s.x + 1 && cx <= s.x + s.w - 1 && s.y >= bottomY - 3) {
        const delta = s.y - bottomY;
        if (delta < bestDelta) {
          bestDelta = delta;
          found = Math.max(0, delta);
        }
      }
    }
  }
  const platforms = world.movingPlatforms;
  for (let i = 0; i < platforms.length; i++) {
    const mp = platforms[i];
    if (cx >= mp.x + 1 && cx <= mp.x + mp.w - 1 && mp.y >= bottomY - 3) {
      const delta = mp.y - bottomY;
      if (delta < bestDelta) {
        bestDelta = delta;
        found = Math.max(0, delta);
      }
    }
  }
  return found;
}

export function buildWorldSnapshot(world: WorldKernel, params: RuntimeParams): RenderSceneSnapshot {
  const pool = world.snapshotPool;
  const bankIdx = pool.bankIndex;
  pool.bankIndex = bankIdx === 0 ? 1 : 0;
  const bank = pool.banks[bankIdx];

  const outTiles = bank.tiles;
  const outFgTiles = bank.fgTiles;
  const outEntities = bank.entities;
  const lights = bank.lights;
  outTiles.length = 0;
  outFgTiles.length = 0;
  outEntities.length = 0;
  lights.length = 0;

  const zoom = world.scoutMode ? 0.88 : 1.0;
  const camX = world.cameraX + world.juice.shakeX;
  const camY = world.cameraY + world.juice.shakeY;
  const viewW = world.viewport.width / zoom;
  const viewH = world.viewport.height / zoom;
  const margin = 96 / zoom;
  const visMinX = camX - margin;
  const visMinY = camY - margin;
  const visMaxX = camX + viewW + margin;
  const visMaxY = camY + viewH + margin;

  let tileSlotCount = 0;
  const srcTiles = world.tiles;
  for (let i = 0; i < srcTiles.length; i++) {
    const t = srcTiles[i];
    if (t.x + t.w < visMinX || t.x > visMaxX || t.y + t.h < visMinY || t.y > visMaxY) continue;
    const dst = acquireTileSlot(bank.tileSlots, tileSlotCount++);
    dst.sprite = t.sprite;
    dst.x = t.x;
    dst.y = t.y;
    dst.w = t.w;
    dst.h = t.h;
    dst.tint = t.tint;
    dst.unlockable = t.unlockable;
    dst.extrudeH = t.extrudeH;
    dst.extrudeAtY = t.extrudeAtY;
    dst.wallColor = t.wallColor;
    dst.wallMaterial = t.wallMaterial;
    dst.elevationZ = t.elevationZ;
    dst.sortY = t.sortY;
    dst.castShadow = t.castShadow;
    dst.alpha = t.alpha;
    dst.flipX = t.flipX;
    outTiles.push(dst);
  }

  const movingPlatforms = world.movingPlatforms;
  for (let i = 0; i < movingPlatforms.length; i++) {
    const mp = movingPlatforms[i];
    if (mp.x + mp.w < visMinX || mp.x > visMaxX || mp.y + mp.h + 16 < visMinY || mp.y > visMaxY) continue;
    for (let tx = 0; tx < mp.w; tx += 16) {
      const dst = acquireTileSlot(bank.tileSlots, tileSlotCount++);
      dst.sprite = 'moving_plat';
      dst.x = mp.x + tx;
      dst.y = mp.y;
      dst.w = Math.min(16, mp.w - tx);
      dst.h = 16;
      dst.tint = undefined;
      dst.unlockable = undefined;
      dst.extrudeH = 3;
      dst.extrudeAtY = mp.y + 6;
      dst.wallColor = '#344c66';
      dst.wallMaterial = 'timber';
      dst.elevationZ = undefined;
      dst.sortY = undefined;
      dst.castShadow = false;
      dst.alpha = undefined;
      dst.flipX = undefined;
      outTiles.push(dst);
    }
  }

  let fgSlotCount = 0;
  const srcFg = world.fgTiles;
  for (let i = 0; i < srcFg.length; i++) {
    const t = srcFg[i];
    if (t.x + t.w < visMinX || t.x > visMaxX || t.y + t.h < visMinY || t.y > visMaxY) continue;
    const dst = acquireTileSlot(bank.fgTileSlots, fgSlotCount++);
    dst.sprite = t.sprite;
    dst.x = t.x;
    dst.y = t.y;
    dst.w = t.w;
    dst.h = t.h;
    dst.tint = t.tint;
    dst.unlockable = t.unlockable;
    dst.extrudeH = t.extrudeH;
    dst.extrudeAtY = t.extrudeAtY;
    dst.wallColor = t.wallColor;
    dst.wallMaterial = t.wallMaterial;
    dst.elevationZ = t.elevationZ;
    dst.sortY = t.sortY;
    dst.castShadow = t.castShadow;
    dst.alpha = t.alpha;
    dst.flipX = t.flipX;
    outFgTiles.push(dst);
  }

  const glow = params.glowIntensity;
  const t = world.juice.visualTime;
  const starsCollected = world.getStarsCollected();
  const starsTotal = world.getStarsTotal();
  let bossHp = 0;
  let bossMaxHp = 0;
  let entSlotCount = 0;
  let lightSlotCount = 0;

  const entities = world.entities;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e.alive) continue;
    if (e.tags.has('boss')) {
      bossHp = e.hp;
      bossMaxHp = e.maxHp;
    }

    const lr = e.lightRadius ?? 0;
    const inLightFrustum =
      lr > 0 && glow > 0.05 && e.x + e.w + lr >= visMinX && e.x - lr <= visMaxX && e.y + e.h + lr >= visMinY && e.y - lr <= visMaxY;
    const inEntFrustum = e.x + e.w >= visMinX && e.x <= visMaxX && e.y + e.h >= visMinY && e.y <= visMaxY;
    if (!inEntFrustum && !inLightFrustum) continue;

    const isPortal = e.tags.has('portal');
    const isBurning = e.tags.has('burning');
    const isRelic = e.tags.has('relic');

    let sprite = e.sprite;
    let yOffset = 0;
    if (e.archetype === 'star') {
      sprite = Math.floor((t * 5 + e.phase) % 2) === 0 ? 'star_a' : 'star_b';
      yOffset = Math.sin(t * 4 + e.phase) * 2;
    } else if (e.archetype === 'slime') {
      sprite = Math.floor((t * 4 + e.phase) % 2) === 0 ? 'slime_a' : 'slime_b';
    } else if (e.archetype === 'key' || isRelic || e.archetype === 'coin') {
      yOffset = Math.sin(t * 3.5 + e.phase) * 2.5;
    }

    if (inEntFrustum) {
      const dropOffset = isPortal ? null : findFloorDropY(world, e.x + e.w * 0.5, e.y + e.h);
      const shouldShadow = dropOffset !== null;
      const isGlowing =
        e.archetype === 'star' ||
        e.archetype === 'torch' ||
        e.archetype === 'key' ||
        e.archetype === 'coin' ||
        isRelic ||
        isPortal ||
        isBurning;

      const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
      dst.id = e.id;
      dst.sprite = sprite;
      dst.x = e.x;
      dst.y = e.y + yOffset;
      dst.w = e.w;
      dst.h = e.h;
      dst.scaleX = e.scaleX;
      dst.scaleY = e.scaleY;
      dst.anchorY = 1;
      dst.flash = Math.min(1, e.flashTimer);
      dst.skewX = undefined;
      dst.emissive = isGlowing ? (e.archetype === 'torch' || isPortal ? 0.95 : 0.72) : undefined;
      dst.paletteRow = undefined;
      dst.flipX = e.flipX;
      dst.rot = isPortal ? t * 2.2 : undefined;
      dst.tint = isBurning ? '#ffd447' : undefined;
      dst.alpha = undefined;
      dst.additive = undefined;
      dst.elevationZ = undefined;
      dst.castShadow = shouldShadow;
      dst.shadowOffsetY = dropOffset !== null ? Math.max(0, dropOffset - yOffset) : undefined;
      dst.shadowRadius = e.w * 0.36;
      dst.sortY = undefined;
      outEntities.push(dst);
    }

    if (inLightFrustum) {
      const flicker = e.archetype === 'torch' ? 1 + Math.sin(t * 11 + e.phase) * 0.1 : 1;
      const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
      l.x = e.x + e.w * 0.5;
      l.y = e.y + e.h * 0.5 + yOffset;
      l.radius = lr * flicker;
      l.color = e.lightColor ?? '#ffd447';
      l.intensity = (e.lightIntensity ?? 0.4) * glow;
      l.falloffPower = e.archetype === 'torch' ? 1.65 : 2.0;
      lights.push(l);
    }
  }

  for (let i = 0; i < world.sparks.length; i++) {
    const sp = world.sparks[i];
    if (sp.x + 22 < visMinX || sp.x - 22 > visMaxX || sp.y + 22 < visMinY || sp.y - 22 > visMaxY) continue;
    const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
    dst.id = getSparkId(pool.sparkIdCache, i);
    dst.sprite = 'sparkle';
    dst.x = sp.x - 4;
    dst.y = sp.y - 4;
    dst.w = 9;
    dst.h = 9;
    dst.scaleX = undefined;
    dst.scaleY = undefined;
    dst.anchorY = undefined;
    dst.flash = undefined;
    dst.skewX = undefined;
    dst.rot = t * 12;
    dst.tint = '#ffd447';
    dst.alpha = undefined;
    dst.additive = true;
    dst.emissive = 1.0;
    dst.paletteRow = undefined;
    dst.flipX = undefined;
    dst.elevationZ = undefined;
    dst.shadowOffsetY = undefined;
    dst.castShadow = undefined;
    dst.shadowRadius = undefined;
    dst.sortY = undefined;
    outEntities.push(dst);

    if (glow > 0.05) {
      const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
      l.x = sp.x;
      l.y = sp.y;
      l.radius = 22;
      l.color = '#ffd447';
      l.intensity = 0.5 * glow;
      l.falloffPower = undefined;
      lights.push(l);
    }
  }

  const h = world.hero;
  const heroDrop = findFloorDropY(world, h.x + 8, h.y + 16);
  const blink = h.invuln > 0 && Math.floor(h.invuln * 16) % 2 === 1;
  if (!blink || h.flash > 0) {
    const moving = Math.abs(h.vx) > 8 || !h.onGround;
    const heroSprite: SpriteId = moving && Math.floor(h.walkAnim) % 2 === 1 ? 'hero_b' : 'hero_a';
    const heroSkew = Math.abs(h.vx) > 10 ? Math.max(-0.24, Math.min(0.24, h.vx / 460)) : 0;
    const dst = acquireEntitySlot(bank.entitySlots, entSlotCount++);
    dst.id = 'hero';
    dst.sprite = heroSprite;
    dst.x = h.x;
    dst.y = h.y;
    dst.w = 16;
    dst.h = 16;
    dst.scaleX = h.squash.scaleX;
    dst.scaleY = h.squash.scaleY;
    dst.anchorY = 1;
    dst.skewX = heroSkew;
    dst.flash = Math.min(1, h.flash);
    dst.flipX = h.facingLeft;
    dst.castShadow = heroDrop !== null;
    dst.shadowOffsetY = heroDrop ?? 0;
    dst.shadowRadius = 6;
    dst.rot = undefined;
    dst.tint = undefined;
    dst.alpha = undefined;
    dst.additive = undefined;
    dst.emissive = undefined;
    dst.paletteRow = undefined;
    dst.elevationZ = undefined;
    dst.sortY = undefined;
    outEntities.push(dst);
  }
  if (glow > 0.05) {
    const l = acquireLightSlot(bank.lightSlots, lightSlotCount++);
    l.x = h.x + 8;
    l.y = h.y + 8;
    l.radius = world.ambientDarkness > 0.2 ? 48 : 30;
    l.color = world.ambientDarkness > 0.2 ? '#ffe6a3' : '#fff3d0';
    l.intensity = (world.ambientDarkness > 0.2 ? 0.58 : 0.3) * glow;
    l.falloffPower = world.ambientDarkness > 0.2 ? 1.65 : 2.0;
    lights.push(l);
  }

  let debugRects: DebugRectDesc[] | undefined;
  if (world.debugHitboxes) {
    debugRects = bank.debugRects;
    debugRects.length = 0;
    let dCount = 0;
    const solidBoxes = world.getSolidBoxes(false);
    for (let i = 0; i < solidBoxes.length; i++) {
      const s = solidBoxes[i];
      if (s.x + s.w < visMinX || s.x > visMaxX || s.y + s.h < visMinY || s.y > visMaxY) continue;
      const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
      dr.x = s.x;
      dr.y = s.y;
      dr.w = s.w;
      dr.h = s.h;
      dr.color = s.kind === 'cloud' ? '#5ec2f7' : '#56d39c';
      debugRects.push(dr);
    }
    const hdr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
    hdr.x = h.x + 2;
    hdr.y = h.y + 2;
    hdr.w = 12;
    hdr.h = 14;
    hdr.color = '#ffd447';
    debugRects.push(hdr);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.alive) continue;
      if (e.x + e.w < visMinX || e.x > visMaxX || e.y + e.h < visMinY || e.y > visMaxY) continue;
      const dr = acquireDebugRectSlot(bank.debugRectSlots, dCount++);
      dr.x = e.x;
      dr.y = e.y;
      dr.w = e.w;
      dr.h = e.h;
      dr.color = e.tags.has('hazard') ? '#ff708d' : '#e0aaff';
      debugRects.push(dr);
    }
  }

  bank.viewport.width = world.viewport.width;
  bank.viewport.height = world.viewport.height;

  const snap = bank.snapshot;
  snap.cartridgeId = world.cartridgeId;
  snap.skyTop = world.skyTop;
  snap.skyBottom = world.skyBottom;
  snap.cozyFilter = params.cozyFilter > 0.5;
  snap.glowIntensity = params.glowIntensity;
  snap.paletteRow = undefined;
  snap.timeSec = t;
  snap.elapsedSec = world.elapsedSec;
  snap.status = world.status;
  snap.score = world.score;
  snap.comboCount = world.juice.comboCount;
  snap.starsCollected = starsCollected;
  snap.starsTotal = starsTotal;
  snap.hasKey = world.gateUnlocked;
  snap.hearts = Math.max(0, world.hearts);
  snap.maxHearts = world.maxHearts;
  snap.bossHp = bossHp;
  snap.bossMaxHp = bossMaxHp;
  snap.cameraX = camX;
  snap.cameraY = camY;
  snap.cameraZoom = zoom;
  snap.viewport = bank.viewport;
  snap.ambientDarkness = world.ambientDarkness;
  snap.ambientColor = world.ambientColor;
  snap.screenFlashAlpha = world.juice.flashAlpha;
  snap.screenFlashColor = world.juice.flashColor;
  snap.bgStars = world.bgStars;
  snap.bgParallaxLayers = world.bgParallaxLayers.length > 0 ? world.bgParallaxLayers : undefined;
  snap.bgClouds = world.bgClouds;
  snap.tiles = outTiles;
  snap.fgTiles = outFgTiles.length > 0 ? outFgTiles : undefined;
  snap.entities = outEntities;
  snap.particles = world.juice.particles;
  snap.lights = lights;
  snap.debugRects = debugRects;
  snap.statusBanner = world.noticeTimer > 0 ? world.noticeBanner : world.statusBanner;
  snap.stage = world.stage;
  snap.bgmTheme = world.bgmTheme;
  return snap;
}
