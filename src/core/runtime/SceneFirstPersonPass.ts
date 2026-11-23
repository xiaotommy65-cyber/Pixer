import type { GpuEngine } from '../gpu/GpuEngine.ts';
import { packHexRgb } from '../gpu/GpuColorCache.ts';
import {
  getOrthogonalBlueprint,
  type OrthogonalArtBlueprint,
  type ResolvedLayerInstance,
} from '../sim/OrthogonalArt.ts';
import { PerspectiveProjector } from '../sim/PerspectiveProjector.ts';
import type { PerspectiveProjectionDesc, RenderSceneSnapshot } from '../types/WorldTypes.ts';
import { drawOrthogonalBlueprintScreen } from './SceneOrthogonalHelper.ts';

const MAX_SHADE_CACHE_ENTRIES = 4096;
const SHADE_HEX_CACHE = new Map<number, string>();

/** Quantized RGB hex cache (32 levels per channel) so 2.5D fog/normal shading produces zero per-frame strings. */
function shadeTintHex(shade01: number, fog01: number, fogR: number, fogG: number, fogB: number): string {
  const s = Math.max(0.18, Math.min(1, shade01));
  const f = Math.max(0, Math.min(0.88, fog01));
  const r = Math.round((255 * s * (1 - f) + fogR * f) / 8) * 8;
  const g = Math.round((255 * s * (1 - f) + fogG * f) / 8) * 8;
  const b = Math.round((255 * s * (1 - f) + fogB * f) / 8) * 8;
  const cr = Math.max(0, Math.min(255, r));
  const cg = Math.max(0, Math.min(255, g));
  const cb = Math.max(0, Math.min(255, b));
  const key = (cr << 16) | (cg << 8) | cb;
  let hex = SHADE_HEX_CACHE.get(key);
  if (hex === undefined) {
    if (SHADE_HEX_CACHE.size >= MAX_SHADE_CACHE_ENTRIES) {
      SHADE_HEX_CACHE.clear();
    }
    hex = `#${cr.toString(16).padStart(2, '0')}${cg.toString(16).padStart(2, '0')}${cb.toString(16).padStart(2, '0')}`;
    SHADE_HEX_CACHE.set(key, hex);
  }
  return hex;
}

function parseHexRgbInto(hex: string, out: Uint8Array): void {
  const packed = packHexRgb(hex);
  out[0] = (packed >> 16) & 255;
  out[1] = (packed >> 8) & 255;
  out[2] = packed & 255;
}

/**
 * Zero-GC 2.5D First-Person DDA raycast & billboard projection pass.
 */
export class SceneFirstPersonPass {
  private readonly perspectiveProjector = new PerspectiveProjector();
  private readonly fogRgbScratch = new Uint8Array(3);

  public render(
    gpu: GpuEngine,
    snap: RenderSceneSnapshot,
    persp: PerspectiveProjectionDesc,
    viewW: number,
    viewH: number,
    camFracX: number,
    camFracY: number,
    defaultPaletteRow: number,
    frameTimeSec: number,
    activeCustomBlueprints: Readonly<Record<string, OrthogonalArtBlueprint>> | undefined,
    composedPool: ResolvedLayerInstance[],
  ): void {
    const vw = viewW;
    const vh = viewH;
    const pitchOff = Number.isFinite(persp.pitchOffsetPx) ? (persp.pitchOffsetPx ?? 0) : 0;
    const horizonY = Math.max(2, Math.min(vh - 2, vh * 0.5 + pitchOff));
    const fogColor = persp.fogColor ?? '#120e24';
    parseHexRgbInto(fogColor, this.fogRgbScratch);
    const fogR = this.fogRgbScratch[0];
    const fogG = this.fogRgbScratch[1];
    const fogB = this.fogRgbScratch[2];

    // 1. Ceiling & Floor atmospheric planes
    const ceilH = Math.max(2, horizonY);
    const floorH = Math.max(2, vh - horizonY);
    gpu.drawRect(vw * 0.5 + camFracX, ceilH * 0.5 + camFracY, vw + 4, ceilH + 2, persp.ceilTopColor ?? '#121024', 1);
    gpu.drawSmoothGradient(vw * 0.5 + camFracX, ceilH * 0.5 + camFracY, vw + 4, ceilH, persp.ceilHorizonColor ?? fogColor, 0.82, 1, 1.35);
    gpu.drawRect(vw * 0.5 + camFracX, horizonY + floorH * 0.5 + camFracY, vw + 4, floorH + 2, persp.floorBottomColor ?? '#28223d', 1);
    gpu.drawSmoothGradient(vw * 0.5 + camFracX, horizonY + floorH * 0.5 + camFracY, vw + 4, floorH, persp.floorHorizonColor ?? fogColor, 0.86, 0, 1.45);

    // 2. Project 2.5D DDA walls & 4-way directional billboards
    const rawStep = persp.columnStepPx ?? 2;
    const columnStep = Number.isFinite(rawStep) && rawStep > 0 ? Math.max(1, Math.round(rawStep)) : 2;
    this.perspectiveProjector.projectFirstPerson(persp, snap.entities, vw, vh, columnStep);

    // 3. Draw vertical textured wall columns via Zero-GC UV slicing
    const wallCount = this.perspectiveProjector.wallColumnCount;
    const cols = this.perspectiveProjector.wallColumns;
    for (let i = 0; i < wallCount; i++) {
      const col = cols[i];
      const tint = shadeTintHex(col.faceShade, col.fogFactor, fogR, fogG, fogB);
      gpu.drawSpriteUvSlice(
        col.sprite,
        col.screenX + camFracX,
        col.topY + col.height * 0.5 + camFracY,
        col.width,
        col.height,
        col.u0,
        0,
        col.u1,
        1,
        tint,
        1,
        0,
        false,
        defaultPaletteRow,
        0,
      );
    }

    // 4. Draw Z-buffer-tested directional billboards back-to-front
    const bbCount = this.perspectiveProjector.billboardCount;
    const bbs = this.perspectiveProjector.billboards;
    for (let i = 0; i < bbCount; i++) {
      const b = bbs[i];
      const e = b.entity;
      const fogTint = e.tint ?? shadeTintHex(1.0, b.fogFactor * 0.85, fogR, fogG, fogB);
      const bx = b.screenX + camFracX;
      const by = b.screenY + camFracY;
      if (e.artBlueprintId) {
        const bp = getOrthogonalBlueprint(e.artBlueprintId, activeCustomBlueprints);
        if (bp) {
          drawOrthogonalBlueprintScreen(
            gpu,
            composedPool,
            frameTimeSec,
            bp,
            b.facing,
            e.artPose ?? 'idle',
            bx,
            by,
            b.width,
            b.height,
            b.flipX,
            e.rot ?? 0,
            e.alpha ?? 1,
            e.flash ?? 0,
            0,
            0.5,
            e.paletteRow,
            b.fogFactor > 0.25 ? fogTint : e.tint,
          );
          continue;
        }
      }
      gpu.drawSpriteRaw(
        e.sprite,
        bx,
        by,
        b.width,
        b.height,
        b.flipX,
        e.rot ?? 0,
        fogTint,
        e.alpha ?? 1,
        e.flash ?? 0,
        e.additive ?? false,
        0.5,
        0.5,
        0,
        e.paletteRow ?? defaultPaletteRow,
        e.emissive ?? (e.additive ? 0.85 : 0),
        e.roughness ?? 0.48,
        e.metallic ?? 0.12,
      );
    }

    // 5. Held 1P Viewmodel (4-Axis OrthogonalArt 'viewmodel' facing)
    if (persp.viewmodelBlueprintId) {
      const vmBp = getOrthogonalBlueprint(persp.viewmodelBlueprintId, activeCustomBlueprints);
      if (vmBp) {
        const bobPhase = persp.viewmodelBob ?? 0;
        const swing = persp.viewmodelSwing ?? 0;
        const bobX = Math.cos(bobPhase) * 4;
        const bobY = Math.abs(Math.sin(bobPhase)) * 5;
        const vmX = vw - 52 + bobX - swing * 22 + camFracX;
        const vmY = vh - 32 + bobY - swing * 10 + camFracY;
        drawOrthogonalBlueprintScreen(
          gpu,
          composedPool,
          frameTimeSec,
          vmBp,
          'viewmodel',
          persp.viewmodelPose ?? 'idle',
          vmX,
          vmY,
          56,
          56,
          false,
          -swing * 0.45,
          1,
          0,
          0,
          0.5,
          defaultPaletteRow,
          undefined,
        );
      }
    }

    // 6. Optional crisp GPU corner radar minimap
    if (persp.showMinimap && persp.wallCols > 0 && persp.wallRows > 0 && persp.wallGrid.length > 0) {
      const cellPx = 3;
      const rows = Math.min(persp.wallRows, Math.floor(persp.wallGrid.length / persp.wallCols));
      const mw = persp.wallCols * cellPx;
      const mh = rows * cellPx;
      const ox = vw - mw - 8 + camFracX;
      const oy = 8 + camFracY;
      gpu.drawRect(ox + mw * 0.5, oy + mh * 0.5, mw + 4, mh + 4, '#0c0918', 0.72);
      for (let r = 0; r < rows; r++) {
        const rowOff = r * persp.wallCols;
        for (let c = 0; c < persp.wallCols; c++) {
          if (persp.wallGrid[rowOff + c] > 0) {
            gpu.drawRect(ox + c * cellPx + cellPx * 0.5, oy + r * cellPx + cellPx * 0.5, cellPx, cellPx, '#6674a3', 0.85);
          }
        }
      }
      const invT = 1 / Math.max(1, persp.tileSize);
      for (let i = 0; i < snap.entities.length; i++) {
        const e = snap.entities[i];
        if (e.hideInFirstPerson) continue;
        const mx = ox + (e.x + e.w * 0.5) * invT * cellPx;
        const my = oy + (e.y + e.h * 0.5) * invT * cellPx;
        gpu.drawRect(mx, my, 2.5, 2.5, e.tint ?? '#ffd447', 0.92);
      }
      const px = ox + persp.viewerX * invT * cellPx;
      const py = oy + persp.viewerY * invT * cellPx;
      gpu.drawRect(px, py, 3.2, 3.2, '#56d39c', 1);
      gpu.drawRect(
        px + Math.cos(persp.viewerYawRad) * 4,
        py + Math.sin(persp.viewerYawRad) * 4,
        2,
        2,
        '#fffaf0',
        1,
      );
    }

    // Soft warm player lantern glow in 1P center
    gpu.pushDynamicLight(vw * 0.5, vh * 0.56, 110, '#ffd447', 0.42, 1.8);
  }
}
