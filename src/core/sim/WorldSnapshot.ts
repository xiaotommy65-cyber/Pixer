import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type {
  DebugRectDesc,
  EntityDesc,
  LightDesc,
  RenderSceneSnapshot,
  RuntimeParams,
} from '../types/WorldTypes.ts';
import type { WorldKernel } from './WorldKernel.ts';

function findFloorDropY(world: WorldKernel, cx: number, bottomY: number): number | null {
  let bestDelta = 46;
  let found: number | null = null;
  const solids = world.solids;
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
  const outTiles = world.tiles.slice();
  const movingPlatforms = world.movingPlatforms;
  for (let i = 0; i < movingPlatforms.length; i++) {
    const mp = movingPlatforms[i];
    for (let tx = 0; tx < mp.w; tx += 16) {
      outTiles.push({
        sprite: 'moving_plat',
        x: mp.x + tx,
        y: mp.y,
        w: Math.min(16, mp.w - tx),
        h: 16,
        extrudeH: 3,
        extrudeAtY: mp.y + 6,
        wallColor: '#344c66',
        wallMaterial: 'timber',
        castShadow: false,
      });
    }
  }

  const outEntities: EntityDesc[] = [];
  const lights: LightDesc[] = [];
  const glow = params.glowIntensity;
  const t = world.juice.visualTime;
  const { collected: starsCollected, total: starsTotal } = world.getStageStars();
  let bossHp = 0;
  let bossMaxHp = 0;

  const entities = world.entities;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e.alive) continue;
    if (e.tags.has('boss')) {
      bossHp = e.hp;
      bossMaxHp = e.maxHp;
    }

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

    outEntities.push({
      id: e.id,
      sprite,
      x: e.x,
      y: e.y + yOffset,
      w: e.w,
      h: e.h,
      scaleX: e.scaleX,
      scaleY: e.scaleY,
      anchorY: 1,
      flash: Math.min(1, e.flashTimer),
      emissive: isGlowing ? (e.archetype === 'torch' || isPortal ? 0.95 : 0.72) : undefined,
      flipX: e.flipX,
      rot: isPortal ? t * 2.2 : undefined,
      tint: isBurning ? '#ffd447' : undefined,
      castShadow: shouldShadow,
      shadowOffsetY: dropOffset !== null ? Math.max(0, dropOffset - yOffset) : undefined,
      shadowRadius: e.w * 0.36,
    });

    if (e.lightRadius && glow > 0.05) {
      const flicker = e.archetype === 'torch' ? 1 + Math.sin(t * 11 + e.phase) * 0.1 : 1;
      lights.push({
        x: e.x + e.w * 0.5,
        y: e.y + e.h * 0.5 + yOffset,
        radius: e.lightRadius * flicker,
        color: e.lightColor ?? '#ffd447',
        intensity: (e.lightIntensity ?? 0.4) * glow,
        falloffPower: e.archetype === 'torch' ? 1.65 : 2.0,
      });
    }
  }

  for (let i = 0; i < world.sparks.length; i++) {
    const sp = world.sparks[i];
    outEntities.push({
      id: `spark-${i}`,
      sprite: 'sparkle',
      x: sp.x - 4,
      y: sp.y - 4,
      w: 9,
      h: 9,
      rot: t * 12,
      tint: '#ffd447',
      additive: true,
      emissive: 1.0,
    });
    if (glow > 0.05) {
      lights.push({ x: sp.x, y: sp.y, radius: 22, color: '#ffd447', intensity: 0.5 * glow });
    }
  }

  const h = world.hero;
  const heroDrop = findFloorDropY(world, h.x + 8, h.y + 16);
  const blink = h.invuln > 0 && Math.floor(h.invuln * 16) % 2 === 1;
  if (!blink || h.flash > 0) {
    const moving = Math.abs(h.vx) > 8 || !h.onGround;
    const heroSprite: SpriteId = moving && Math.floor(h.walkAnim) % 2 === 1 ? 'hero_b' : 'hero_a';
    const heroSkew = Math.abs(h.vx) > 10 ? Math.max(-0.24, Math.min(0.24, h.vx / 460)) : 0;
    outEntities.push({
      id: 'hero',
      sprite: heroSprite,
      x: h.x,
      y: h.y,
      w: 16,
      h: 16,
      scaleX: h.squash.scaleX,
      scaleY: h.squash.scaleY,
      anchorY: 1,
      skewX: heroSkew,
      flash: Math.min(1, h.flash),
      flipX: h.facingLeft,
      castShadow: heroDrop !== null,
      shadowOffsetY: heroDrop ?? 0,
      shadowRadius: 6,
    });
  }
  if (glow > 0.05) {
    lights.push({
      x: h.x + 8,
      y: h.y + 8,
      radius: world.ambientDarkness > 0.2 ? 48 : 30,
      color: world.ambientDarkness > 0.2 ? '#ffe6a3' : '#fff3d0',
      intensity: (world.ambientDarkness > 0.2 ? 0.58 : 0.3) * glow,
      falloffPower: world.ambientDarkness > 0.2 ? 1.65 : 2.0,
    });
  }

  let debugRects: DebugRectDesc[] | undefined;
  if (world.debugHitboxes) {
    debugRects = [];
    const solidBoxes = world.getSolidBoxes(false);
    for (let i = 0; i < solidBoxes.length; i++) {
      const s = solidBoxes[i];
      debugRects.push({
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        color: s.kind === 'cloud' ? '#5ec2f7' : '#56d39c',
      });
    }
    debugRects.push({ x: h.x + 2, y: h.y + 2, w: 12, h: 14, color: '#ffd447' });
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e.alive) continue;
      debugRects.push({
        x: e.x,
        y: e.y,
        w: e.w,
        h: e.h,
        color: e.tags.has('hazard') ? '#ff708d' : '#e0aaff',
      });
    }
  }

  return {
    cartridgeId: world.cartridgeId,
    skyTop: world.skyTop,
    skyBottom: world.skyBottom,
    cozyFilter: params.cozyFilter > 0.5,
    glowIntensity: params.glowIntensity,
    timeSec: t,
    elapsedSec: world.elapsedSec,
    status: world.status,
    score: world.score,
    comboCount: world.juice.comboCount,
    starsCollected,
    starsTotal,
    hasKey: world.gateUnlocked,
    hearts: Math.max(0, world.hearts),
    maxHearts: world.maxHearts,
    bossHp,
    bossMaxHp,
    cameraX: world.cameraX + world.juice.shakeX,
    cameraY: world.cameraY + world.juice.shakeY,
    cameraZoom: world.scoutMode ? 0.88 : 1.0,
    ambientDarkness: world.ambientDarkness,
    ambientColor: world.ambientColor,
    screenFlashAlpha: world.juice.flashAlpha,
    screenFlashColor: world.juice.flashColor,
    bgStars: world.bgStars,
    bgClouds: world.bgClouds,
    tiles: outTiles,
    entities: outEntities,
    particles: world.juice.particles,
    lights,
    debugRects,
    statusBanner: world.noticeTimer > 0 ? world.noticeBanner : world.statusBanner,
    stage: world.stage,
    bgmTheme: world.bgmTheme,
  };
}
