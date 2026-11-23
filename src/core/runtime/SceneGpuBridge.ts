import type { GpuEngine } from '../gpu/GpuEngine.ts';
import { GAME_H, GAME_W, type GpuFrameStats } from '../gpu/GpuTypes.ts';
import {
  createComposedLayerPool,
  getOrthogonalBlueprint,
  type OrthogonalArtBlueprint,
} from '../sim/OrthogonalArt.ts';
import type {
  EntityDesc,
  RenderSceneSnapshot,
  TileDesc,
} from '../types/WorldTypes.ts';
import type { BenchmarkSprite } from './CartridgeRunner.ts';
import { SceneFirstPersonPass } from './SceneFirstPersonPass.ts';
import { renderSceneHudOverlay, type HudWorldProjector } from './SceneHudOverlayPass.ts';
import { drawOrthogonalBlueprintScreen } from './SceneOrthogonalHelper.ts';
import { SceneTrue3DPass } from './SceneTrue3DPass.ts';

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

/**
 * Computes Pass 1 screen center coordinate for a parallax layer element so that
 * Pass 3 overscan crop subtraction (-camFrac) produces jitter-free sub-pixel scrolling
 * aligned identically across WebGPU, WebGL2, and Canvas2D.
 */
export function computeParallaxScreenCoord(
  worldCenter: number,
  snappedCam: number,
  camFrac: number,
  scroll: number,
  viewExtent: number,
  zoom: number,
): number {
  return viewExtent * 0.5 + (worldCenter - snappedCam * scroll - viewExtent * 0.5) * zoom + camFrac * (1 - scroll);
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

export class SceneGpuBridge implements HudWorldProjector {
  private readonly depthPool: PooledDepthSlot[] = [];
  private readonly composedPool = createComposedLayerPool();
  private readonly firstPersonPass = new SceneFirstPersonPass();
  private readonly true3dPass = new SceneTrue3DPass();
  private activeCustomBlueprints?: Readonly<Record<string, OrthogonalArtBlueprint>>;
  private viewW = GAME_W;
  private viewH = GAME_H;
  private zoom = 1;
  private camCenterX = GAME_W * 0.5;
  private camCenterY = GAME_H * 0.5;
  private perspSkew = 0;
  private cullPad = 56;
  private defaultPaletteRow = 0;
  private frameTimeSec = 0;
  private hd2dWallHeightScale = 1.2;
  private hd2dObliqueShadowAlpha = 0.4;
  private active3DMode = false;

  private perspScaleAtWorldY(wy: number): number {
    if (this.perspSkew <= 0) return 1;
    const rawY = this.viewH * 0.5 + (wy - this.camCenterY) * this.zoom;
    const norm = Math.max(-0.55, Math.min(0.55, (rawY - this.viewH * 0.5) / this.viewH));
    return 1 + norm * this.perspSkew;
  }

  public projectWorldX(wx: number, wy: number): number {
    if (this.active3DMode) {
      return this.true3dPass.projectScreenX(wx, wy);
    }
    return this.viewW * 0.5 + (wx - this.camCenterX) * this.zoom * this.perspScaleAtWorldY(wy);
  }

  public projectWorldY(wy: number, wx = this.camCenterX, wz = 0): number {
    if (this.active3DMode) {
      return this.true3dPass.projectScreenY(wx, wy, wz);
    }
    return this.viewH * 0.5 + (wy - this.camCenterY) * this.zoom * this.perspScaleAtWorldY(wy);
  }

  private drawTile(gpu: GpuEngine, t: TileDesc): void {
    const wyMid = t.y + t.h * 0.5;
    const ps = this.perspScaleAtWorldY(wyMid);
    const yTop = this.projectWorldY(t.y);
    const yBot = this.projectWorldY(t.y + t.h);
    const sx = this.projectWorldX(t.x + t.w * 0.5, wyMid);
    const sy = (yTop + yBot) * 0.5;
    const dw = t.w * this.zoom * ps;
    const dh = Math.max(1, yBot - yTop);
    const extrudeH = t.extrudeH ?? 0;
    const elevZ = t.elevationZ ?? 0;
    const extraPad = extrudeH > 0 ? extrudeH * this.hd2dWallHeightScale * this.zoom * ps : 0;
    if (sx + dw * 0.5 < -this.cullPad || sx - dw * 0.5 > this.viewW + this.cullPad) return;
    if (sy + dh * 0.5 < -this.cullPad || sy - dh * 0.5 - extraPad > this.viewH + this.cullPad) return;

    let capLiftPx = elevZ * this.zoom * ps;

    if (extrudeH > 0) {
      const psBot = this.perspScaleAtWorldY(t.y + t.h);
      if (elevZ > 0) {
        const faceH = extrudeH * this.zoom * psBot;
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
      } else if (t.extrudeAtY !== undefined) {
        // Explicit platform lip extrusion (side-scroller ledges)
        const faceH = extrudeH * this.zoom * psBot;
        const visualBotY = this.projectWorldY(t.extrudeAtY);
        const matKind = resolveWallMaterialCode(t);
        gpu.drawBeveledWall(sx, visualBotY + faceH * 0.5, dw, faceH, t.wallColor ?? '#344c66', matKind, 0.96, t.x * 0.11);
      } else {
        // Soul Knight 3/4 Strong-Volume 2.5D Wall Extrusion:
        // Lift roof cap UPWARD by wallFaceH, draw crisp textured front facade + 45° oblique cast shadows
        const wallFaceH = extrudeH * this.hd2dWallHeightScale * this.zoom * psBot;
        const neighborMask = t.autoMask ?? 0;
        const hasEast = (neighborMask & 2) !== 0;
        const hasSouth = (neighborMask & 4) !== 0;
        capLiftPx = wallFaceH;

        // 45° Oblique directional cast shadow onto open East / South-East floor
        if (this.hd2dObliqueShadowAlpha > 0.01 && t.castShadow !== false) {
          const shW = Math.min(dw * 0.58, wallFaceH * 0.44);
          const shH = Math.min(dh * 0.42, wallFaceH * 0.34);
          if (!hasEast) {
            gpu.drawRect(
              sx + dw * 0.5 + shW * 0.5,
              sy + shH * 0.25,
              shW,
              dh + shH * 0.5,
              '#090714',
              this.hd2dObliqueShadowAlpha * 0.58,
            );
          }
          if (!hasSouth) {
            gpu.drawRect(
              sx + shW * 0.22,
              yBot + shH * 0.5,
              dw + (hasEast ? 0 : shW * 0.45),
              shH,
              '#090714',
              this.hd2dObliqueShadowAlpha * 0.48,
            );
          }
        }

        // Exposed South Vertical Facade ([yBot - wallFaceH .. yBot])
        if (!hasSouth || neighborMask === 0) {
          const matKind = resolveWallMaterialCode(t);
          const faceCy = yBot - wallFaceH * 0.5;
          gpu.drawBeveledWall(
            sx,
            faceCy,
            dw + 0.5,
            wallFaceH + 0.5,
            t.wallColor ?? '#3a3552',
            matKind,
            0.98,
            t.x * 0.13 + t.y * 0.07,
          );
          // Grounded wall-base dark crease & bright top cornice lip
          gpu.drawRect(sx, yBot - 1.5 * this.zoom, dw, 3 * this.zoom, '#090714', 0.42);
          gpu.drawRect(sx, yBot - wallFaceH + 1.2 * this.zoom, dw, 2 * this.zoom, '#e2e8f0', 0.16);
        }
      }
    }

    const capY = sy - capLiftPx;
    const hasWind = (t.windSway ?? 0) > 0 || t.sprite === 'tree_canopy';
    const swayStrength = hasWind ? (t.windSway ?? 0.8) : 0;
    const skewX = hasWind ? Math.sin(this.frameTimeSec * 2.3 + t.x * 0.08) * 0.09 * swayStrength : 0;
    const isHanging = t.sprite === 'vine_hang';
    const tilePivotY = hasWind ? (isHanging ? 0 : 1) : 0.5;
    const tileDrawY = hasWind ? (isHanging ? capY - dh * 0.5 : capY + dh * 0.5) : capY;
    gpu.drawSpriteRaw(
      t.sprite,
      sx,
      tileDrawY,
      dw,
      dh,
      t.flipX ?? false,
      0,
      t.tint,
      t.alpha ?? 1,
      0,
      false,
      0.5,
      tilePivotY,
      skewX,
      this.defaultPaletteRow,
      0,
    );
  }

  private drawEntity(gpu: GpuEngine, e: EntityDesc): void {
    let spriteId = e.sprite;
    let drawW = e.w;
    let drawH = e.h;
    if (
      !e.artBlueprintId &&
      e.id === 'hero' &&
      typeof e.sprite === 'string' &&
      e.sprite.startsWith('parkour_hero_') &&
      gpu.atlas.hasSprite('hero32_idle_a')
    ) {
      let resolved = spriteId;
      if (e.sprite === 'parkour_hero_dash') {
        resolved = 'hero32_dash';
      } else if (e.sprite === 'parkour_hero_jump' || e.sprite === 'parkour_hero_wall') {
        resolved = 'hero32_jump';
      } else if (e.sprite === 'parkour_hero_run_a' || e.sprite === 'parkour_hero_run_b') {
        const runIdx = Math.floor(this.frameTimeSec * 12) & 3;
        resolved =
          runIdx === 0
            ? 'hero32_run_0'
            : runIdx === 1
              ? 'hero32_run_1'
              : runIdx === 2
                ? 'hero32_run_2'
                : 'hero32_run_3';
      } else {
        resolved = Math.floor(this.frameTimeSec * 2.5) % 2 === 0 ? 'hero32_idle_a' : 'hero32_idle_b';
      }
      if (gpu.atlas.hasSprite(resolved)) {
        spriteId = resolved;
        drawW = 24;
        drawH = 24;
      }
    }

    const anchorY = e.anchorY ?? 0.5;
    const worldAnchorX = e.x + e.w * 0.5;
    const worldAnchorY = e.y + e.h * anchorY;
    const worldMidY = e.y + e.h * 0.5;
    const ps = this.perspScaleAtWorldY(worldMidY);
    const sx = this.viewW * 0.5 + (worldAnchorX - this.camCenterX) * this.zoom * ps;
    const syBase = this.viewH * 0.5 + (worldAnchorY - this.camCenterY) * this.zoom * ps;
    const sw = drawW * (e.scaleX ?? 1) * this.zoom * ps;
    const sh = drawH * (e.scaleY ?? 1) * this.zoom * ps;
    const sy = syBase - (e.elevationZ ?? 0) * this.zoom * ps;
    const halfW = sw * 0.5;
    const top = sy - sh * anchorY;
    const bot = sy + sh * (1 - anchorY);
    if (
      sx + halfW < -this.cullPad ||
      sx - halfW > this.viewW + this.cullPad ||
      bot < -this.cullPad ||
      top > this.viewH + this.cullPad
    ) {
      return;
    }

    if (e.artBlueprintId) {
      const bp = getOrthogonalBlueprint(e.artBlueprintId, this.activeCustomBlueprints);
      if (bp) {
        drawOrthogonalBlueprintScreen(
          gpu,
          this.composedPool,
          this.frameTimeSec,
          bp,
          e.artFacing ?? 'front',
          e.artPose ?? 'idle',
          sx,
          sy,
          sw,
          sh,
          e.flipX ?? false,
          e.rot ?? 0,
          e.alpha ?? 1,
          e.flash ?? 0,
          e.skewX ?? 0,
          anchorY,
          e.paletteRow,
          e.tint,
        );
        return;
      }
    }

    gpu.drawSpriteRaw(
      spriteId,
      sx,
      sy,
      sw,
      sh,
      e.flipX ?? false,
      e.rot ?? 0,
      e.tint,
      e.alpha ?? 1,
      e.flash ?? 0,
      e.additive ?? false,
      0.5,
      anchorY,
      e.skewX ?? 0,
      e.paletteRow ?? this.defaultPaletteRow,
      e.emissive ?? (e.additive ? 0.85 : 0),
      e.roughness ?? 0.48,
      e.metallic ?? 0.12,
    );
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
      if ((t.extrudeH ?? 0) <= 0 && (t.elevationZ ?? 0) <= 0) continue;
      // Pre-sort frustum cull so off-screen walls never enter depthPool or O(K log K) sort
      const wyMid = t.y + t.h * 0.5;
      const ps = this.perspScaleAtWorldY(wyMid);
      const sx = this.projectWorldX(t.x + t.w * 0.5, wyMid);
      const halfDw = t.w * 0.5 * this.zoom * ps;
      if (sx + halfDw < -this.cullPad || sx - halfDw > this.viewW + this.cullPad) continue;
      const yTop = this.projectWorldY(t.y);
      const yBot = this.projectWorldY(t.y + t.h);
      const sy = (yTop + yBot) * 0.5;
      const halfDh = Math.max(1, yBot - yTop) * 0.5;
      const extraLift = (t.extrudeH ?? 0) * this.hd2dWallHeightScale * this.zoom * ps;
      if (sy + halfDh < -this.cullPad || sy - halfDh - extraLift > this.viewH + this.cullPad) continue;

      const slot = this.acquireDepthSlot(count);
      slot.kind = 'tile';
      slot.sortY = t.sortY ?? t.y + t.h;
      slot.order = count;
      slot.tile = t;
      slot.entity = null;
      count++;
    }

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const anchorY = e.anchorY ?? 0.5;
      const ps = this.perspScaleAtWorldY(e.y + e.h * 0.5);
      const sx = this.viewW * 0.5 + (e.x + e.w * 0.5 - this.camCenterX) * this.zoom * ps;
      const halfW = e.w * (e.scaleX ?? 1) * this.zoom * ps * 0.5;
      if (sx + halfW < -this.cullPad || sx - halfW > this.viewW + this.cullPad) continue;
      const syBase = this.viewH * 0.5 + (e.y + e.h * anchorY - this.camCenterY) * this.zoom * ps;
      const sh = e.h * (e.scaleY ?? 1) * this.zoom * ps;
      const sy = syBase - (e.elevationZ ?? 0) * this.zoom * ps;
      const top = sy - sh * anchorY;
      const bot = sy + sh * (1 - anchorY);
      if (bot < -this.cullPad || top > this.viewH + this.cullPad) continue;

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

  private renderFlat2DScene(
    gpu: GpuEngine,
    snap: RenderSceneSnapshot,
    hd2dOn: boolean,
    snappedCamX: number,
    snappedCamY: number,
    camFracX: number,
    camFracY: number,
  ): void {
    const hd2d = snap.hd2dDepth;
    const occStrength = snap.occlusion?.shadowStrength ?? 0.86;
    if (snap.occlusion && snap.occlusion.cols > 0 && snap.occlusion.rows > 0 && occStrength > 0.001) {
      const occ = snap.occlusion;
      const originScreenX = this.viewW * 0.5 + (occ.originX - this.camCenterX) * this.zoom;
      const originScreenY = this.viewH * 0.5 + (occ.originY - this.camCenterY) * this.zoom;
      const tileSizePx = occ.tileSize * this.zoom;
      gpu.setOcclusionGrid(
        occ.cols,
        occ.rows,
        originScreenX,
        originScreenY,
        tileSizePx,
        occ.data,
        occ.version,
        occStrength,
        occ.shadowSoftness ?? 0.36,
      );
    }
    if (hd2d?.waterLevelY !== undefined) {
      const wyScreen = this.projectWorldY(hd2d.waterLevelY);
      if (wyScreen < this.viewH) {
        const wNorm = Math.max(0.05, Math.min(0.96, wyScreen / this.viewH));
        gpu.setWaterPlane(wNorm, hd2d.waterTint ?? '#355c8a');
      }
    }

    for (let i = 0; i < snap.bgStars.length; i++) {
      const s = snap.bgStars[i];
      const pulse = 0.55 + 0.45 * Math.sin(snap.timeSec * 4 + s.phase);
      gpu.drawStarGlint(Math.round(s.x) + camFracX, Math.round(s.y) + camFracY, Math.max(1.2, s.size * 0.85), s.color, pulse, 2.2);
    }

    if (snap.bgParallaxLayers && snap.bgParallaxLayers.length > 0) {
      for (let i = 0; i < snap.bgParallaxLayers.length; i++) {
        const ly = snap.bgParallaxLayers[i];
        const scrollX = ly.scrollX ?? 0.35;
        const scrollY = ly.scrollY ?? 0.2;
        const dw = ly.w * this.zoom;
        const dh = ly.h * this.zoom;
        const baseCy = computeParallaxScreenCoord(
          ly.y + ly.h * 0.5,
          snappedCamY,
          camFracY,
          scrollY,
          this.viewH,
          this.zoom,
        );
        if (baseCy + dh * 0.5 < -this.cullPad || baseCy - dh * 0.5 > this.viewH + this.cullPad) continue;

        const baseCx = computeParallaxScreenCoord(
          ly.x + ly.w * 0.5,
          snappedCamX,
          camFracX,
          scrollX,
          this.viewW,
          this.zoom,
        );
        const alpha = ly.alpha ?? 1;
        const flipX = ly.flipX ?? false;
        const additive = ly.additive ?? false;
        const paletteRow = ly.paletteRow ?? this.defaultPaletteRow;
        const emissive = ly.emissive ?? (additive ? 0.85 : 0);

        const repeatW = ly.repeatW ?? 0;
        if (repeatW > ly.w) {
          const stepWorld = Math.max(4, ly.repeatStepX ?? ly.w);
          const stepScreen = stepWorld * this.zoom;
          const totalReps = Math.ceil(repeatW / stepWorld);
          const padScreen = this.cullPad + dw * 0.5;
          const kMin = Math.max(0, Math.floor((-padScreen - baseCx) / stepScreen));
          const kMax = Math.min(totalReps - 1, Math.ceil((this.viewW + padScreen - baseCx) / stepScreen));
          for (let k = kMin; k <= kMax; k++) {
            const cx = baseCx + k * stepScreen;
            if (cx + dw * 0.5 < -this.cullPad || cx - dw * 0.5 > this.viewW + this.cullPad) continue;
            gpu.drawSpriteRaw(
              ly.sprite,
              cx,
              baseCy,
              dw,
              dh,
              flipX,
              0,
              ly.tint,
              alpha,
              0,
              additive,
              0.5,
              0.5,
              0,
              paletteRow,
              emissive,
            );
          }
        } else {
          if (baseCx + dw * 0.5 < -this.cullPad || baseCx - dw * 0.5 > this.viewW + this.cullPad) continue;
          gpu.drawSpriteRaw(
            ly.sprite,
            baseCx,
            baseCy,
            dw,
            dh,
            flipX,
            0,
            ly.tint,
            alpha,
            0,
            additive,
            0.5,
            0.5,
            0,
            paletteRow,
            emissive,
          );
        }
      }
    }

    const cloudOffsetX = camFracX * 0.55;
    for (let i = 0; i < snap.bgClouds.length; i++) {
      const c = snap.bgClouds[i];
      const cx = Math.round(c.x - snappedCamX * 0.45) + cloudOffsetX;
      const cy = Math.round(c.y) + camFracY;
      const segW = Math.round(16 * c.scale);
      const segH = Math.round(16 * c.scale);
      const halfH = segH * 0.5;
      if (cx > -segW * 3 && cx < this.viewW + segW * 2) {
        gpu.drawSpriteRaw('cloud_l', cx + segW * 0.5, cy + halfH, segW, segH, false, 0, c.tint, c.alpha);
        gpu.drawSpriteRaw('cloud_m', cx + segW * 1.5, cy + halfH, segW, segH, false, 0, c.tint, c.alpha);
        gpu.drawSpriteRaw('cloud_r', cx + segW * 2.5, cy + halfH, segW, segH, false, 0, c.tint, c.alpha);
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
      const gx = this.viewW * 0.5 + (footWorldX - this.camCenterX) * this.zoom * ps;
      const gy = this.viewH * 0.5 + (footWorldY - this.camCenterY) * this.zoom * ps;
      if (gx < -this.cullPad || gx > this.viewW + this.cullPad || gy < -this.cullPad || gy > this.viewH + this.cullPad) continue;
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

    if (snap.fgTiles && snap.fgTiles.length > 0) {
      for (let i = 0; i < snap.fgTiles.length; i++) {
        this.drawTile(gpu, snap.fgTiles[i]);
      }
    }

    if (snap.ambientDarkness && snap.ambientDarkness > 0.01) {
      gpu.drawRect(
        this.viewW * 0.5 + camFracX,
        this.viewH * 0.5 + camFracY,
        this.viewW + 4,
        this.viewH + 4,
        snap.ambientColor ?? '#120e24',
        Math.min(0.88, snap.ambientDarkness),
      );
    }

    for (let i = 0; i < snap.lights.length; i++) {
      const l = snap.lights[i];
      const ps = this.perspScaleAtWorldY(l.y);
      const lx = this.viewW * 0.5 + (l.x - this.camCenterX) * this.zoom * ps;
      const ly = this.viewH * 0.5 + (l.y - this.camCenterY) * this.zoom * ps;
      const lr = l.radius * this.zoom * ps;
      if (lx + lr < -36 || lx - lr > this.viewW + 36 || ly + lr < -36 || ly - lr > this.viewH + 36) continue;
      const falloff = l.falloffPower ?? 2.0;
      gpu.pushDynamicLight(lx, ly, lr, l.color, l.intensity, falloff);
      gpu.drawLight(lx, ly, lr, l.color, l.intensity * 0.45, falloff);
    }

    for (let i = 0; i < snap.particles.length; i++) {
      const p = snap.particles[i];
      const ps = this.perspScaleAtWorldY(p.y);
      const px = this.viewW * 0.5 + (p.x - this.camCenterX) * this.zoom * ps;
      const py = this.viewH * 0.5 + (p.y - this.camCenterY) * this.zoom * ps;
      const pSize = p.size * this.zoom * ps;
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      if (p.sprite) {
        const add = p.additive ?? true;
        gpu.drawSpriteRaw(p.sprite, px, py, pSize, pSize, false, p.rot ?? 0, p.color, alpha, 0, add, 0.5, 0.5, 0, 0, add ? 0.9 : 0);
      } else if (p.additive) {
        gpu.drawLight(px, py, Math.max(1.8, pSize * 0.85), p.color, alpha * 0.95, 1.8);
      } else {
        gpu.drawSoftShadow(px, py, Math.max(2, pSize * 1.25), Math.max(2, pSize * 1.25), p.color, alpha, 0.55);
      }
    }
  }

  /** Home screen shown while no game card is inserted. */
  public renderIdle(gpu: GpuEngine, timeSec: number, awake = false): GpuFrameStats {
    this.viewW = GAME_W;
    this.viewH = GAME_H;
    gpu.setLogicalViewport(GAME_W, GAME_H);
    gpu.beginFrame(awake ? '#ffc2d6' : '#ffd3df', '#fff6e4', true);

    for (let i = 0; i < 4; i++) {
      const span = GAME_W + 80;
      const x = ((i * 97 + timeSec * (6 + i * 2)) % span) - 40;
      const y = 22 + ((i * 37) % 70);
      for (let k = 0; k < 3; k++) {
        const id = k === 0 ? 'cloud_l' : k === 1 ? 'cloud_m' : 'cloud_r';
        gpu.drawSpriteRaw(id, x + k * 16 + 8, y + 8, undefined, undefined, false, 0, undefined, 0.85);
      }
    }

    const cx = GAME_W * 0.5;
    const cy = GAME_H * 0.36;
    const bob = awake ? -Math.abs(Math.sin(timeSec * 8)) * 7 : Math.sin(timeSec * 2.4) * 4;
    const elevFromFloor = Math.max(0, 6 - bob);
    drawGroundShadow(gpu, cx, cy + 28, 17, elevFromFloor, 1);

    gpu.drawLight(cx, cy + bob, awake ? 82 : 64, '#fff2cc', awake ? 0.78 : 0.55);
    const starSize = awake ? 14 : 12;
    for (let i = 0; i < 6; i++) {
      const speed = awake ? 2.2 : 0.9;
      const ang = timeSec * speed + (i * Math.PI) / 3;
      gpu.drawSpriteRaw(
        awake && i % 2 === 0 ? 'sparkle' : 'star_a',
        cx + Math.cos(ang) * 72,
        cy + Math.sin(ang) * 34 + bob,
        starSize,
        starSize,
        false,
        ang,
      );
    }
    const blinkCycle = timeSec % 4.0;
    const mood = awake || blinkCycle < 0.45 ? 'momo_happy' : 'momo_idle';
    gpu.drawSpriteRaw(mood, cx, cy + bob, 48, 48);
    return gpu.flush(timeSec);
  }

  public render(
    gpu: GpuEngine,
    snap: RenderSceneSnapshot,
    benchmarkSprites: readonly BenchmarkSprite[] | null,
  ): GpuFrameStats {
    const vw = Math.max(160, Math.round(snap.viewport?.width ?? GAME_W));
    const vh = Math.max(90, Math.round(snap.viewport?.height ?? GAME_H));
    this.viewW = vw;
    this.viewH = vh;
    gpu.setLogicalViewport(vw, vh);

    this.defaultPaletteRow = snap.paletteRow ?? 0;
    this.activeCustomBlueprints = snap.customArtBlueprints;
    this.frameTimeSec = snap.timeSec;
    this.zoom = snap.cameraZoom ?? 1;
    const snappedCamX = Math.round(snap.cameraX);
    const snappedCamY = Math.round(snap.cameraY);
    const camFracX = Math.max(-0.98, Math.min(0.98, (snap.cameraX - snappedCamX) * this.zoom));
    const camFracY = Math.max(-0.98, Math.min(0.98, (snap.cameraY - snappedCamY) * this.zoom));

    gpu.beginFrame(snap.skyTop, snap.skyBottom, snap.cozyFilter, snap.glowIntensity ?? 1.0, undefined, camFracX, camFracY);

    this.camCenterX = snappedCamX + this.viewW * 0.5;
    this.camCenterY = snappedCamY + this.viewH * 0.5;
    const hd2d = snap.hd2dDepth;
    const hd2dOn = Boolean(hd2d?.enabled);
    const useTrue3D = Boolean(hd2dOn && hd2d?.mode3d && gpu.supports3D());
    this.active3DMode = useTrue3D;
    this.hd2dWallHeightScale = hd2d?.wallHeightScale ?? 1.25;
    this.hd2dObliqueShadowAlpha = hd2d?.obliqueShadowAlpha ?? 0.42;
    this.perspSkew = hd2dOn && !useTrue3D ? (hd2d?.perspectiveSkew ?? 0.055) : 0;
    this.cullPad = 56 / Math.max(0.5, this.zoom);

    const persp = snap.perspective;
    const useFirstPerson = Boolean(persp && (persp.mode === 'first_person' || persp.blend01 >= 0.5));
    if (hd2dOn && hd2d?.tiltShiftBlur && hd2d.tiltShiftBlur > 0.005) {
      gpu.setTiltShift(hd2d.tiltShiftBlur, hd2d.tiltShiftFocusY ?? 0.52);
    }
    if (useFirstPerson && persp) {
      this.active3DMode = false;
      this.firstPersonPass.render(
        gpu,
        snap,
        persp,
        this.viewW,
        this.viewH,
        camFracX,
        camFracY,
        this.defaultPaletteRow,
        this.frameTimeSec,
        this.activeCustomBlueprints,
        this.composedPool,
      );
    } else if (useTrue3D && hd2d) {
      this.true3dPass.render(
        gpu,
        snap,
        hd2d,
        this.camCenterX,
        this.camCenterY,
        this.zoom,
        this.viewW,
        this.viewH,
        this.defaultPaletteRow,
        this.frameTimeSec,
        this.activeCustomBlueprints,
        this.composedPool,
      );
    } else {
      this.renderFlat2DScene(gpu, snap, hd2dOn, snappedCamX, snappedCamY, camFracX, camFracY);
    }

    if (benchmarkSprites) {
      for (let i = 0; i < benchmarkSprites.length; i++) {
        const b = benchmarkSprites[i];
        gpu.drawSpriteRaw(b.sprite, b.x + camFracX, b.y + camFracY, b.size, b.size, false, b.rot, b.tint, 0.9, 0, b.sprite === 'sparkle');
      }
    }

    if (snap.debugRects) {
      for (let i = 0; i < snap.debugRects.length; i++) {
        const r = snap.debugRects[i];
        const wyMid = r.y + r.h * 0.5;
        const ps = this.perspScaleAtWorldY(wyMid);
        const rx = this.viewW * 0.5 + (r.x + r.w * 0.5 - this.camCenterX) * this.zoom * ps;
        const ry = this.viewH * 0.5 + (wyMid - this.camCenterY) * this.zoom * ps;
        gpu.drawRect(rx, ry, r.w * this.zoom * ps, r.h * this.zoom * ps, r.color, 0.28);
      }
    }

    if (hd2dOn) {
      const hazeAlpha = hd2d?.horizonHazeAlpha ?? 0.16;
      if (hazeAlpha > 0.005) {
        const hazeColor = hd2d?.horizonHazeColor ?? snap.skyTop;
        gpu.drawSmoothGradient(this.viewW * 0.5 + camFracX, 16 + camFracY, this.viewW + 4, 34, hazeColor, hazeAlpha, 0, 1.45);
      }
      const tiltAlpha = hd2d?.tiltShiftAlpha ?? 0.16;
      if (tiltAlpha > 0.005) {
        gpu.drawSmoothGradient(this.viewW * 0.5 + camFracX, 9 + camFracY, this.viewW + 4, 20, '#0a0814', tiltAlpha, 0, 1.6);
        gpu.drawSmoothGradient(this.viewW * 0.5 + camFracX, this.viewH - 9 + camFracY, this.viewW + 4, 20, '#0a0814', tiltAlpha * 0.85, 1, 1.6);
      }
    }

    if (snap.screenFlashAlpha && snap.screenFlashAlpha > 0.01) {
      gpu.drawRect(
        this.viewW * 0.5 + camFracX,
        this.viewH * 0.5 + camFracY,
        this.viewW + 4,
        this.viewH + 4,
        snap.screenFlashColor ?? '#fffaf0',
        Math.min(0.42, snap.screenFlashAlpha),
      );
    }

    const lb = snap.cameraLetterbox ?? 0;
    if (lb > 0.004) {
      const barH = Math.round(this.viewH * Math.min(0.2, lb));
      gpu.drawRect(this.viewW * 0.5 + camFracX, barH * 0.5 + camFracY, this.viewW + 4, barH + 2, '#07060b', 0.96);
      gpu.drawRect(this.viewW * 0.5 + camFracX, this.viewH - barH * 0.5 + camFracY, this.viewW + 4, barH + 2, '#07060b', 0.96);
    }

    renderSceneHudOverlay(gpu, snap, this.viewW, this.zoom, camFracX, camFracY, this);

    return gpu.flush(snap.timeSec);
  }
}
