import type { GpuEngine } from '../gpu/GpuEngine.ts';
import { GAME_H, GAME_W, type GpuFrameStats } from '../gpu/GpuTypes.ts';
import type { EntityDesc, RenderSceneSnapshot, TileDesc } from '../types/WorldTypes.ts';
import type { BenchmarkSprite } from './CartridgeRunner.ts';

export type DepthDrawEntry =
  | { kind: 'tile'; sortY: number; order: number; tile: TileDesc }
  | { kind: 'entity'; sortY: number; order: number; entity: EntityDesc };

/**
 * Pure helper computing deterministic painter's-algorithm depth order for 2.5D HD-2D scenes.
 * Interleaves extruded walls/trees/columns with actors by their ground contact baseline (sortY).
 */
export function buildDepthDrawOrder(tiles: readonly TileDesc[], entities: readonly EntityDesc[]): DepthDrawEntry[] {
  const entries: DepthDrawEntry[] = [];
  let order = 0;

  for (const t of tiles) {
    if ((t.extrudeH ?? 0) > 0 || (t.elevationZ ?? 0) > 0) {
      entries.push({
        kind: 'tile',
        sortY: t.sortY ?? t.y + t.h,
        order: order++,
        tile: t,
      });
    }
  }

  for (const e of entities) {
    entries.push({
      kind: 'entity',
      sortY: e.sortY ?? (e.additive ? e.y + e.h + 18 : e.y + e.h),
      order: order++,
      entity: e,
    });
  }

  entries.sort((a, b) => (a.sortY !== b.sortY ? a.sortY - b.sortY : a.order - b.order));
  return entries;
}

function resolveWallMaterialCode(t: TileDesc): 0 | 1 | 2 | 3 {
  if (t.wallMaterial === 'earth') return 1;
  if (t.wallMaterial === 'timber') return 2;
  if (t.wallMaterial === 'astral') return 3;
  if (t.sprite === 'grass' || t.sprite === 'dirt' || t.sprite === 'tree_canopy') return 1;
  if (t.sprite === 'moving_plat') return 2;
  return 0;
}

function drawGroundShadow(
  gpu: GpuEngine,
  cx: number,
  gy: number,
  radius: number,
  elevHeight: number,
  scale: number,
): void {
  const zFactor = 1 / (1 + Math.max(0, elevHeight) * 0.055);
  const sw = Math.max(6, radius * 2.25 * scale * zFactor);
  const sh = Math.max(3, radius * 0.86 * scale * zFactor);
  const alpha = Math.max(0.14, 0.44 * zFactor);
  gpu.drawSoftShadow(cx, gy, sw, sh, '#0d0918', alpha, 0.68);
}

interface PooledDepthSlot {
  kind: 'tile' | 'entity';
  sortY: number;
  order: number;
  tile: TileDesc | null;
  entity: EntityDesc | null;
}

function compareDepthSlot(a: PooledDepthSlot, b: PooledDepthSlot): number {
  return a.sortY !== b.sortY ? a.sortY - b.sortY : a.order - b.order;
}

/**
 * In-place insertion/quick hybrid sort over [0, count) so pooled depth sorting
 * performs zero array/slice/closure allocations per frame while preserving order ties.
 */
function sortDepthPoolInPlace(pool: PooledDepthSlot[], lo: number, hi: number): void {
  if (hi - lo <= 16) {
    for (let i = lo + 1; i <= hi; i++) {
      const key = pool[i];
      let j = i - 1;
      while (j >= lo && compareDepthSlot(pool[j], key) > 0) {
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
    while (compareDepthSlot(pool[i], pivot) < 0) i++;
    while (compareDepthSlot(pool[j], pivot) > 0) j--;
    if (i <= j) {
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      i++;
      j--;
    }
  }
  if (lo < j) sortDepthPoolInPlace(pool, lo, j);
  if (i < hi) sortDepthPoolInPlace(pool, i, hi);
}

export class SceneGpuBridge {
  private readonly depthPool: PooledDepthSlot[] = [];
  private zoom = 1;
  private camCenterX = GAME_W * 0.5;
  private camCenterY = GAME_H * 0.5;
  private perspSkew = 0;
  private cullPad = 56;
  private defaultPaletteRow = 0;

  private perspScaleAtWorldY(wy: number): number {
    if (this.perspSkew <= 0) return 1;
    const rawY = GAME_H * 0.5 + (wy - this.camCenterY) * this.zoom;
    const norm = Math.max(-0.55, Math.min(0.55, (rawY - GAME_H * 0.5) / GAME_H));
    return 1 + norm * this.perspSkew;
  }

  private projectX(wx: number, wy: number): number {
    return GAME_W * 0.5 + (wx - this.camCenterX) * this.zoom * this.perspScaleAtWorldY(wy);
  }

  private projectY(wy: number): number {
    return GAME_H * 0.5 + (wy - this.camCenterY) * this.zoom * this.perspScaleAtWorldY(wy);
  }

  private drawTile(gpu: GpuEngine, t: TileDesc): void {
    const wyMid = t.y + t.h * 0.5;
    const ps = this.perspScaleAtWorldY(wyMid);
    const yTop = this.projectY(t.y);
    const yBot = this.projectY(t.y + t.h);
    const sx = this.projectX(t.x + t.w * 0.5, wyMid);
    const sy = (yTop + yBot) * 0.5;
    const dw = t.w * this.zoom * ps;
    const dh = Math.max(1, yBot - yTop);
    if (sx + dw * 0.5 < -this.cullPad || sx - dw * 0.5 > GAME_W + this.cullPad) return;
    if (sy + dh * 0.5 < -this.cullPad || sy - dh * 0.5 > GAME_H + this.cullPad) return;

    const extrudeH = t.extrudeH ?? 0;
    const elevZ = t.elevationZ ?? 0;

    if (extrudeH > 0) {
      const psBot = this.perspScaleAtWorldY(t.y + t.h);
      const faceH = extrudeH * this.zoom * psBot;
      if (elevZ > 0) {
        const capBottomY = yBot - elevZ * this.zoom * ps;
        const wallTop = Math.min(yBot - 1, capBottomY - 0.5 * this.zoom);
        const actualFaceH = Math.max(faceH, yBot - wallTop);
        const faceCenterY = yBot - actualFaceH * 0.5;
        if (t.castShadow !== false) {
          gpu.drawSoftShadow(
            sx + 1.0 * this.zoom,
            yBot + 2.2 * this.zoom * psBot,
            dw * 1.24,
            6.2 * this.zoom * psBot,
            '#0c0816',
            0.4,
            0.76,
          );
        }
        const matKind = resolveWallMaterialCode(t);
        gpu.drawBeveledWall(sx, faceCenterY, dw, actualFaceH, t.wallColor ?? '#3b3752', matKind, 0.98, t.x * 0.13 + t.y * 0.07);
      } else {
        const visualBotY = this.projectY(t.extrudeAtY ?? t.y + t.h);
        const matKind = resolveWallMaterialCode(t);
        gpu.drawBeveledWall(sx, visualBotY + faceH * 0.5, dw, faceH, t.wallColor ?? '#344c66', matKind, 0.96, t.x * 0.11);
      }
    }

    const capY = sy - elevZ * this.zoom * ps;
    gpu.drawSprite(t.sprite, sx, capY, {
      w: dw,
      h: dh,
      tint: t.tint,
      paletteRow: this.defaultPaletteRow,
    });
  }

  private drawEntity(gpu: GpuEngine, e: EntityDesc): void {
    const anchorY = e.anchorY ?? 0.5;
    const worldAnchorX = e.x + e.w * 0.5;
    const worldAnchorY = e.y + e.h * anchorY;
    const worldMidY = e.y + e.h * 0.5;
    const ps = this.perspScaleAtWorldY(worldMidY);
    const sx = GAME_W * 0.5 + (worldAnchorX - this.camCenterX) * this.zoom * ps;
    const syBase = GAME_H * 0.5 + (worldAnchorY - this.camCenterY) * this.zoom * ps;
    const sw = e.w * (e.scaleX ?? 1) * this.zoom * ps;
    const sh = e.h * (e.scaleY ?? 1) * this.zoom * ps;
    const sy = syBase - (e.elevationZ ?? 0) * this.zoom * ps;
    if (sx < -this.cullPad || sx > GAME_W + this.cullPad || sy < -this.cullPad || sy - sh > GAME_H + this.cullPad) return;
    gpu.drawSprite(e.sprite, sx, sy, {
      w: sw,
      h: sh,
      flipX: e.flipX,
      rot: e.rot,
      tint: e.tint,
      alpha: e.alpha,
      flash: e.flash,
      additive: e.additive,
      pivotX: 0.5,
      pivotY: anchorY,
      skewX: e.skewX ?? 0,
      emissive: e.emissive ?? (e.additive ? 0.85 : 0),
      paletteRow: e.paletteRow ?? this.defaultPaletteRow,
    });
  }

  private acquireDepthSlot(index: number): PooledDepthSlot {
    let slot = this.depthPool[index];
    if (!slot) {
      slot = { kind: 'tile', sortY: 0, order: 0, tile: null, entity: null };
      this.depthPool[index] = slot;
    }
    return slot;
  }

  private renderDepthSorted(gpu: GpuEngine, tiles: readonly TileDesc[], entities: readonly EntityDesc[]): void {
    let count = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if ((t.extrudeH ?? 0) > 0 || (t.elevationZ ?? 0) > 0) {
        const slot = this.acquireDepthSlot(count);
        slot.kind = 'tile';
        slot.sortY = t.sortY ?? t.y + t.h;
        slot.order = count;
        slot.tile = t;
        slot.entity = null;
        count++;
      }
    }

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const slot = this.acquireDepthSlot(count);
      slot.kind = 'entity';
      slot.sortY = e.sortY ?? (e.additive ? e.y + e.h + 18 : e.y + e.h);
      slot.order = count;
      slot.tile = null;
      slot.entity = e;
      count++;
    }

    if (count > 1) {
      sortDepthPoolInPlace(this.depthPool, 0, count - 1);
    }

    for (let i = 0; i < count; i++) {
      const item = this.depthPool[i];
      if (item.kind === 'tile' && item.tile) {
        this.drawTile(gpu, item.tile);
      } else if (item.entity) {
        this.drawEntity(gpu, item.entity);
      }
    }
  }

  /** Home screen shown while no game card is inserted. */
  public renderIdle(gpu: GpuEngine, timeSec: number, awake = false): GpuFrameStats {
    gpu.beginFrame(awake ? '#ffc2d6' : '#ffd3df', '#fff6e4', true);

    for (let i = 0; i < 4; i++) {
      const span = GAME_W + 80;
      const x = ((i * 97 + timeSec * (6 + i * 2)) % span) - 40;
      const y = 22 + ((i * 37) % 70);
      for (let k = 0; k < 3; k++) {
        const id = k === 0 ? 'cloud_l' : k === 1 ? 'cloud_m' : 'cloud_r';
        gpu.drawSprite(id, x + k * 16 + 8, y + 8, { alpha: 0.85 });
      }
    }

    const cx = GAME_W * 0.5;
    const cy = GAME_H * 0.42;
    const bob = awake ? -Math.abs(Math.sin(timeSec * 8)) * 7 : Math.sin(timeSec * 2.4) * 4;
    const elevFromFloor = Math.max(0, 6 - bob);
    drawGroundShadow(gpu, cx, cy + 28, 17, elevFromFloor, 1);

    gpu.drawLight(cx, cy + bob, awake ? 82 : 64, '#fff2cc', awake ? 0.78 : 0.55);
    for (let i = 0; i < 6; i++) {
      const speed = awake ? 2.2 : 0.9;
      const ang = timeSec * speed + (i * Math.PI) / 3;
      gpu.drawSprite(awake && i % 2 === 0 ? 'sparkle' : 'star_a', cx + Math.cos(ang) * 72, cy + Math.sin(ang) * 34 + bob, {
        w: awake ? 14 : 12,
        h: awake ? 14 : 12,
        rot: ang,
      });
    }
    const blinkCycle = timeSec % 4.0;
    const mood = awake || blinkCycle < 0.45 ? 'momo_happy' : 'momo_idle';
    gpu.drawSprite(mood, cx, cy + bob, { w: 48, h: 48 });
    return gpu.flush(timeSec);
  }

  public render(
    gpu: GpuEngine,
    snap: RenderSceneSnapshot,
    benchmarkSprites: readonly BenchmarkSprite[] | null,
  ): GpuFrameStats {
    gpu.beginFrame(snap.skyTop, snap.skyBottom, snap.cozyFilter, snap.glowIntensity ?? 1.0);

    this.defaultPaletteRow = snap.paletteRow ?? 0;
    this.zoom = snap.cameraZoom ?? 1;
    this.camCenterX = snap.cameraX + GAME_W * 0.5;
    this.camCenterY = snap.cameraY + GAME_H * 0.5;
    const hd2d = snap.hd2dDepth;
    const hd2dOn = Boolean(hd2d?.enabled);
    this.perspSkew = hd2dOn ? (hd2d?.perspectiveSkew ?? 0.055) : 0;
    this.cullPad = 56 / Math.max(0.5, this.zoom);

    for (let i = 0; i < snap.bgStars.length; i++) {
      const s = snap.bgStars[i];
      const pulse = 0.55 + 0.45 * Math.sin(snap.timeSec * 4 + s.phase);
      gpu.drawStarGlint(Math.round(s.x), Math.round(s.y), Math.max(1.2, s.size * 0.85), s.color, pulse, 2.2);
    }

    const camX = Math.round(snap.cameraX);
    for (let i = 0; i < snap.bgClouds.length; i++) {
      const c = snap.bgClouds[i];
      const cx = Math.round(c.x - camX * 0.45);
      const cy = Math.round(c.y);
      const segW = Math.round(16 * c.scale);
      const segH = Math.round(16 * c.scale);
      const halfH = segH * 0.5;
      if (cx > -segW * 3 && cx < GAME_W + segW * 2) {
        gpu.drawSprite('cloud_l', cx + segW * 0.5, cy + halfH, { w: segW, h: segH, tint: c.tint, alpha: c.alpha });
        gpu.drawSprite('cloud_m', cx + segW * 1.5, cy + halfH, { w: segW, h: segH, tint: c.tint, alpha: c.alpha });
        gpu.drawSprite('cloud_r', cx + segW * 2.5, cy + halfH, { w: segW, h: segH, tint: c.tint, alpha: c.alpha });
      }
    }

    for (let i = 0; i < snap.tiles.length; i++) {
      const t = snap.tiles[i];
      if ((t.extrudeH ?? 0) <= 0 && (t.elevationZ ?? 0) <= 0) {
        this.drawTile(gpu, t);
      }
    }

    for (let i = 0; i < snap.entities.length; i++) {
      const e = snap.entities[i];
      const shouldShadow = e.castShadow === true || (hd2dOn && e.castShadow !== false && !e.additive);
      if (!shouldShadow) continue;
      const footWorldX = e.x + e.w * 0.5;
      const footWorldY = e.y + e.h + (e.shadowOffsetY ?? 0) - 1;
      const ps = this.perspScaleAtWorldY(footWorldY);
      const gx = GAME_W * 0.5 + (footWorldX - this.camCenterX) * this.zoom * ps;
      const gy = GAME_H * 0.5 + (footWorldY - this.camCenterY) * this.zoom * ps;
      if (gx < -this.cullPad || gx > GAME_W + this.cullPad || gy < -this.cullPad || gy > GAME_H + this.cullPad) continue;
      const elev = Math.max(e.elevationZ ?? 0, e.shadowOffsetY ?? 0);
      drawGroundShadow(gpu, gx, gy, e.shadowRadius ?? e.w * 0.42, elev, this.zoom * ps);
    }

    if (hd2dOn && hd2d?.sortByDepthY !== false) {
      this.renderDepthSorted(gpu, snap.tiles, snap.entities);
    } else {
      for (let i = 0; i < snap.tiles.length; i++) {
        const t = snap.tiles[i];
        if ((t.extrudeH ?? 0) > 0 || (t.elevationZ ?? 0) > 0) {
          this.drawTile(gpu, t);
        }
      }
      for (let i = 0; i < snap.entities.length; i++) {
        this.drawEntity(gpu, snap.entities[i]);
      }
    }

    if (snap.ambientDarkness && snap.ambientDarkness > 0.01) {
      gpu.drawRect(
        GAME_W * 0.5,
        GAME_H * 0.5,
        GAME_W,
        GAME_H,
        snap.ambientColor ?? '#120e24',
        Math.min(0.88, snap.ambientDarkness),
      );
    }

    for (let i = 0; i < snap.lights.length; i++) {
      const l = snap.lights[i];
      const ps = this.perspScaleAtWorldY(l.y);
      const lx = GAME_W * 0.5 + (l.x - this.camCenterX) * this.zoom * ps;
      const ly = GAME_H * 0.5 + (l.y - this.camCenterY) * this.zoom * ps;
      const lr = l.radius * this.zoom * ps;
      if (lx + lr < -36 || lx - lr > GAME_W + 36 || ly + lr < -36 || ly - lr > GAME_H + 36) continue;
      gpu.drawLight(lx, ly, lr, l.color, l.intensity, l.falloffPower ?? 2.0);
    }

    for (let i = 0; i < snap.particles.length; i++) {
      const p = snap.particles[i];
      const ps = this.perspScaleAtWorldY(p.y);
      const px = GAME_W * 0.5 + (p.x - this.camCenterX) * this.zoom * ps;
      const py = GAME_H * 0.5 + (p.y - this.camCenterY) * this.zoom * ps;
      const pSize = p.size * this.zoom * ps;
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      if (p.sprite) {
        const add = p.additive ?? true;
        gpu.drawSprite(p.sprite, px, py, {
          w: pSize,
          h: pSize,
          rot: p.rot,
          tint: p.color,
          alpha,
          additive: add,
          emissive: add ? 0.9 : 0,
        });
      } else if (p.additive) {
        gpu.drawLight(px, py, Math.max(1.8, pSize * 0.85), p.color, alpha * 0.95, 1.8);
      } else {
        gpu.drawSoftShadow(px, py, Math.max(2, pSize * 1.25), Math.max(2, pSize * 1.25), p.color, alpha, 0.55);
      }
    }

    if (benchmarkSprites) {
      for (let i = 0; i < benchmarkSprites.length; i++) {
        const b = benchmarkSprites[i];
        gpu.drawSprite(b.sprite, b.x, b.y, {
          w: b.size,
          h: b.size,
          rot: b.rot,
          tint: b.tint,
          alpha: 0.9,
          additive: b.sprite === 'sparkle',
        });
      }
    }

    if (snap.debugRects) {
      for (let i = 0; i < snap.debugRects.length; i++) {
        const r = snap.debugRects[i];
        const wyMid = r.y + r.h * 0.5;
        const ps = this.perspScaleAtWorldY(wyMid);
        const rx = GAME_W * 0.5 + (r.x + r.w * 0.5 - this.camCenterX) * this.zoom * ps;
        const ry = GAME_H * 0.5 + (wyMid - this.camCenterY) * this.zoom * ps;
        gpu.drawRect(rx, ry, r.w * this.zoom * ps, r.h * this.zoom * ps, r.color, 0.28);
      }
    }

    if (hd2dOn) {
      const hazeAlpha = hd2d?.horizonHazeAlpha ?? 0.16;
      if (hazeAlpha > 0.005) {
        const hazeColor = hd2d?.horizonHazeColor ?? snap.skyTop;
        gpu.drawSmoothGradient(GAME_W * 0.5, 16, GAME_W, 32, hazeColor, hazeAlpha, 0, 1.45);
      }
      const tiltAlpha = hd2d?.tiltShiftAlpha ?? 0.16;
      if (tiltAlpha > 0.005) {
        gpu.drawSmoothGradient(GAME_W * 0.5, 9, GAME_W, 18, '#0a0814', tiltAlpha, 0, 1.6);
        gpu.drawSmoothGradient(GAME_W * 0.5, GAME_H - 9, GAME_W, 18, '#0a0814', tiltAlpha * 0.85, 1, 1.6);
      }
    }

    if (snap.screenFlashAlpha && snap.screenFlashAlpha > 0.01) {
      gpu.drawRect(
        GAME_W * 0.5,
        GAME_H * 0.5,
        GAME_W,
        GAME_H,
        snap.screenFlashColor ?? '#fffaf0',
        Math.min(0.42, snap.screenFlashAlpha),
      );
    }

    const lb = snap.cameraLetterbox ?? 0;
    if (lb > 0.004) {
      const barH = Math.round(GAME_H * Math.min(0.2, lb));
      gpu.drawRect(GAME_W * 0.5, barH * 0.5, GAME_W, barH, '#07060b', 0.96);
      gpu.drawRect(GAME_W * 0.5, GAME_H - barH * 0.5, GAME_W, barH, '#07060b', 0.96);
    }

    if (!snap.rpgHud && !snap.chronicleHud) {
      for (let i = 0; i < snap.maxHearts; i++) {
        gpu.drawSprite(i < snap.hearts ? 'heart_full' : 'heart_empty', 12 + i * 13, 11, {
          w: 11,
          h: 11,
        });
      }

      if (snap.hasKey) {
        gpu.drawSprite('key', GAME_W - 14, 11, { w: 12, h: 12 });
      }

      for (let i = 0; i < snap.starsTotal; i++) {
        const collected = i < snap.starsCollected;
        const baseOffset = snap.hasKey ? 28 : 14;
        gpu.drawSprite('star_a', GAME_W - baseOffset - i * 11, 11, {
          w: 9,
          h: 9,
          tint: collected ? '#ffd447' : '#8c9ab5',
          alpha: collected ? 1 : 0.45,
        });
      }

      if (snap.bossMaxHp > 0 && snap.bossHp > 0) {
        const barW = 90;
        const ratio = snap.bossHp / snap.bossMaxHp;
        gpu.drawRect(GAME_W * 0.5, 11, barW + 6, 9, '#2b1d1a', 0.92, 0, false, 0, 1);
        gpu.drawRect(GAME_W * 0.5 - barW * 0.5 * (1 - ratio), 11, Math.max(2, barW * ratio), 4.5, '#ff708d', 1, 0, false, 0, 1);
      }
    }

    return gpu.flush(snap.timeSec);
  }
}
