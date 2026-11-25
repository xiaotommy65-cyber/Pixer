import type { SpriteId, TextureAtlas } from '../../assets/TextureAtlas.ts';
import { INV_255, packHexRgb } from './GpuColorCache.ts';
import {
  FLOATS_PER_QUAD3D,
  MAX_QUAD3D_INSTANCES,
  type GpuCamera3DState,
  type Quad3DPassData,
} from './GpuTypes.ts';

const MAX_QUAD3D_BLEND_INSTANCES = 4096;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Zero-GC 3D Quad batching & HD-2D geometry emitters (floors, neighbor-culled extruded walls,
 * upright tilted billboards, ground contact shadows, 3D point lights, and floating particles).
 */
export class GpuQuad3DBatch {
  private readonly opaqueItems = new Float32Array(MAX_QUAD3D_INSTANCES * FLOATS_PER_QUAD3D);
  private readonly alphaItems = new Float32Array(MAX_QUAD3D_BLEND_INSTANCES * FLOATS_PER_QUAD3D);
  private readonly addItems = new Float32Array(MAX_QUAD3D_BLEND_INSTANCES * FLOATS_PER_QUAD3D);
  private opaqueCount = 0;
  private alphaCount = 0;
  private addCount = 0;
  public spriteCount = 0;
  public lightCount = 0;

  public readonly cameraState: GpuCamera3DState = {
    enabled: false,
    camCenterX: 0,
    camCenterY: 0,
    zoom: 1,
    pitchDeg: 42,
    fovDeg: 38,
    viewW: 320,
    viewH: 180,
    occOriginWorldX: 0,
    occOriginWorldY: 0,
    occTileSizeWorld: 32,
  };

  private readonly passData: Quad3DPassData = {
    camera: this.cameraState,
    opaqueData: this.opaqueItems,
    opaqueCount: 0,
    alphaData: this.alphaItems,
    alphaCount: 0,
    additiveData: this.addItems,
    additiveCount: 0,
  };

  public resetFrame(): void {
    this.cameraState.enabled = false;
    this.opaqueCount = 0;
    this.alphaCount = 0;
    this.addCount = 0;
    this.spriteCount = 0;
    this.lightCount = 0;
  }

  public setCamera3D(
    camCenterX: number,
    camCenterY: number,
    zoom: number,
    pitchDeg: number,
    fovDeg: number,
    viewW: number,
    viewH: number,
    occOriginWorldX = 0,
    occOriginWorldY = 0,
    occTileSizeWorld = 32,
  ): void {
    this.cameraState.enabled = true;
    this.cameraState.camCenterX = Number.isFinite(camCenterX) ? camCenterX : 0;
    this.cameraState.camCenterY = Number.isFinite(camCenterY) ? camCenterY : 0;
    this.cameraState.zoom = Number.isFinite(zoom) ? Math.max(0.1, zoom) : 1;
    this.cameraState.pitchDeg = Number.isFinite(pitchDeg) ? Math.max(20, Math.min(78, pitchDeg)) : 42;
    this.cameraState.fovDeg = Number.isFinite(fovDeg) ? Math.max(20, Math.min(65, fovDeg)) : 38;
    this.cameraState.viewW = Number.isFinite(viewW) && viewW > 0 ? viewW : 320;
    this.cameraState.viewH = Number.isFinite(viewH) && viewH > 0 ? viewH : 180;
    this.cameraState.occOriginWorldX = Number.isFinite(occOriginWorldX) ? occOriginWorldX : 0;
    this.cameraState.occOriginWorldY = Number.isFinite(occOriginWorldY) ? occOriginWorldY : 0;
    this.cameraState.occTileSizeWorld = Number.isFinite(occTileSizeWorld) ? Math.max(1, occTileSizeWorld) : 32;
  }

  public getStats(): { opaqueCount: number; alphaCount: number; additiveCount: number; enabled: boolean } {
    return {
      opaqueCount: this.opaqueCount,
      alphaCount: this.alphaCount,
      additiveCount: this.addCount,
      enabled: this.cameraState.enabled,
    };
  }

  public getPassData(): Quad3DPassData | undefined {
    this.passData.opaqueCount = this.opaqueCount;
    this.passData.alphaCount = this.alphaCount;
    this.passData.additiveCount = this.addCount;
    return this.cameraState.enabled ? this.passData : undefined;
  }

  public pushQuad3D(
    pass: 0 | 1 | 2,
    ox: number,
    oy: number,
    oz: number,
    ux: number,
    uy: number,
    uz: number,
    vx: number,
    vy: number,
    vz: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    nx: number,
    ny: number,
    nz: number,
    mode = 0,
    flash = 0,
    shadeMult = 1,
    paletteRow = 0,
    atlasPage = 0,
    roughness = 0.48,
    metallic = 0.12,
    emissive = 0,
  ): void {
    let arr: Float32Array;
    let count: number;
    let maxCap: number;
    if (pass === 0) {
      arr = this.opaqueItems;
      count = this.opaqueCount;
      maxCap = MAX_QUAD3D_INSTANCES;
    } else if (pass === 1) {
      arr = this.alphaItems;
      count = this.alphaCount;
      maxCap = MAX_QUAD3D_BLEND_INSTANCES;
    } else {
      arr = this.addItems;
      count = this.addCount;
      maxCap = MAX_QUAD3D_BLEND_INSTANCES;
    }
    if (count >= maxCap) return;
    const base = count * FLOATS_PER_QUAD3D;
    arr[base] = ox;
    arr[base + 1] = oy;
    arr[base + 2] = oz;
    arr[base + 3] = atlasPage;
    arr[base + 4] = ux;
    arr[base + 5] = uy;
    arr[base + 6] = uz;
    arr[base + 7] = roughness;
    arr[base + 8] = vx;
    arr[base + 9] = vy;
    arr[base + 10] = vz;
    arr[base + 11] = metallic;
    arr[base + 12] = u0;
    arr[base + 13] = v0;
    arr[base + 14] = u1;
    arr[base + 15] = v1;
    arr[base + 16] = r;
    arr[base + 17] = g;
    arr[base + 18] = b;
    arr[base + 19] = a;
    arr[base + 20] = nx;
    arr[base + 21] = ny;
    arr[base + 22] = nz;
    arr[base + 23] = emissive;
    arr[base + 24] = mode;
    arr[base + 25] = flash;
    arr[base + 26] = shadeMult;
    arr[base + 27] = paletteRow;
    if (pass === 0) this.opaqueCount++;
    else if (pass === 1) this.alphaCount++;
    else this.addCount++;
    this.spriteCount++;
  }

  public drawFloorTile3D(
    atlas: TextureAtlas,
    id: SpriteId,
    x: number,
    y: number,
    w: number,
    h: number,
    z = 0,
    tint?: string,
    alpha = 1,
    paletteRow = 0,
    shadeMult = 1.0,
    roughness = 0.62,
    metallic = 0.06,
    emissive = 0,
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !(w > 0) || !(h > 0) || !(alpha > 0.001)) {
      return;
    }
    const rect = atlas.getRect(id);
    let r = 1;
    let g = 1;
    let b = 1;
    if (tint) {
      const n = packHexRgb(tint);
      r = ((n >> 16) & 255) * INV_255;
      g = ((n >> 8) & 255) * INV_255;
      b = (n & 255) * INV_255;
    }
    const pass: 0 | 1 = alpha >= 0.99 ? 0 : 1;
    this.pushQuad3D(
      pass,
      x,
      y,
      z,
      w,
      0,
      0,
      0,
      h,
      0,
      rect.u0,
      rect.v0,
      rect.u1,
      rect.v1,
      r,
      g,
      b,
      alpha,
      0,
      0,
      1,
      0,
      0,
      shadeMult,
      paletteRow,
      rect.page ?? 0,
      roughness,
      metallic,
      emissive,
    );
  }

  public drawBox3DWall(
    atlas: TextureAtlas,
    topId: SpriteId,
    sideId: SpriteId | null,
    x: number,
    y: number,
    w: number,
    h: number,
    zBase: number,
    wallH: number,
    neighborMask: number,
    tint?: string,
    wallTint?: string,
    alpha = 1,
    paletteRow = 0,
    roughness = 0.58,
    metallic = 0.1,
    obliqueShadowAlpha = 0.35,
    emissive = 0,
  ): void {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(zBase) ||
      !(w > 0) ||
      !(h > 0) ||
      !(wallH > 0) ||
      !(alpha > 0.001)
    ) {
      return;
    }
    const topRect = atlas.getRect(topId);
    const sideRect = sideId ? atlas.getRect(sideId) : topRect;
    let tr = 1;
    let tg = 1;
    let tb = 1;
    if (tint) {
      const n = packHexRgb(tint);
      tr = ((n >> 16) & 255) * INV_255;
      tg = ((n >> 8) & 255) * INV_255;
      tb = (n & 255) * INV_255;
    }
    let wr = tr;
    let wg = tg;
    let wb = tb;
    if (wallTint && !sideId) {
      const n = packHexRgb(wallTint);
      wr = ((n >> 16) & 255) * INV_255;
      wg = ((n >> 8) & 255) * INV_255;
      wb = (n & 255) * INV_255;
    }
    const zTop = zBase + wallH;
    const pass: 0 | 1 = alpha >= 0.99 ? 0 : 1;

    // 1. Top Roof Cap (+Z normal, slightly brighter catch-light)
    this.pushQuad3D(
      pass,
      x,
      y,
      zTop,
      w,
      0,
      0,
      0,
      h,
      0,
      topRect.u0,
      topRect.v0,
      topRect.u1,
      topRect.v1,
      tr,
      tg,
      tb,
      alpha,
      0,
      0,
      1,
      0,
      0,
      1.1,
      paletteRow,
      topRect.page ?? 0,
      roughness,
      metallic,
      emissive,
    );

    const hasEast = (neighborMask & 2) !== 0;
    const hasSouth = (neighborMask & 4) !== 0;
    const hasWest = (neighborMask & 8) !== 0;
    const sideMode = sideId ? 0 : 4;
    const sidePage = sideRect.page ?? 0;

    // 2. South Front Vertical Face (+Y normal, faces camera directly)
    if (!hasSouth) {
      this.pushQuad3D(
        pass,
        x,
        y + h,
        zTop,
        w,
        0,
        0,
        0,
        0,
        -wallH,
        sideId ? sideRect.u0 : Math.max(0.5, w / 16),
        sideId ? sideRect.v0 : Math.max(0.25, wallH / 16),
        sideId ? sideRect.u1 : (x + y) * 0.017,
        sideId ? sideRect.v1 : 0,
        wr,
        wg,
        wb,
        alpha,
        0,
        1,
        0,
        sideMode,
        0,
        0.92,
        paletteRow,
        sidePage,
        roughness,
        metallic,
        emissive,
      );
    }

    // 3. West Left Vertical Face (-X normal, visible on right side of screen)
    if (!hasWest) {
      this.pushQuad3D(
        pass,
        x,
        y,
        zTop,
        0,
        h,
        0,
        0,
        0,
        -wallH,
        sideId ? sideRect.u0 : Math.max(0.5, h / 16),
        sideId ? sideRect.v0 : Math.max(0.25, wallH / 16),
        sideId ? sideRect.u1 : (x * 1.3 + y) * 0.017,
        sideId ? sideRect.v1 : 0,
        wr,
        wg,
        wb,
        alpha,
        -1,
        0,
        0,
        sideMode,
        0,
        0.74,
        paletteRow,
        sidePage,
        roughness,
        metallic,
        emissive,
      );
    }

    // 4. East Right Vertical Face (+X normal, visible on left side of screen)
    if (!hasEast) {
      this.pushQuad3D(
        pass,
        x + w,
        y + h,
        zTop,
        0,
        -h,
        0,
        0,
        0,
        -wallH,
        sideId ? sideRect.u0 : Math.max(0.5, h / 16),
        sideId ? sideRect.v0 : Math.max(0.25, wallH / 16),
        sideId ? sideRect.u1 : (x * 0.7 + y * 1.7) * 0.017,
        sideId ? sideRect.v1 : 0,
        wr,
        wg,
        wb,
        alpha,
        1,
        0,
        0,
        sideMode,
        0,
        0.66,
        paletteRow,
        sidePage,
        roughness,
        metallic,
        emissive,
      );
    }

    // 5. Subtle 45-degree directional oblique cast shadow on exposed east/south floor
    if (obliqueShadowAlpha > 0.01 && alpha >= 0.95) {
      const shLen = Math.min(w * 0.65, wallH * 0.42);
      const shA = Math.min(0.45, obliqueShadowAlpha * 0.48);
      if (!hasEast) {
        this.pushQuad3D(
          1,
          x + w,
          y + shLen * 0.35,
          zBase + 0.12,
          shLen,
          0,
          0,
          0,
          h,
          0,
          0,
          0,
          1,
          1,
          0.04,
          0.03,
          0.09,
          shA,
          0,
          0,
          1,
          2,
          0,
          1,
          -2,
          0,
          1,
          0,
          0,
        );
      }
      if (!hasSouth) {
        this.pushQuad3D(
          1,
          x + shLen * 0.35,
          y + h,
          zBase + 0.12,
          w,
          0,
          0,
          0,
          shLen * 0.62,
          0,
          0,
          0,
          1,
          1,
          0.04,
          0.03,
          0.09,
          shA * 0.85,
          0,
          0,
          1,
          2,
          0,
          1,
          -2,
          0,
          1,
          0,
          0,
        );
      }
    }
  }

  public drawBillboard3D(
    atlas: TextureAtlas,
    id: SpriteId,
    footX: number,
    footY: number,
    footZ: number,
    w?: number,
    h?: number,
    tiltDeg = 12,
    flipX = false,
    tint?: string,
    alpha = 1,
    flash = 0,
    additive = false,
    paletteRow = 0,
    emissive = 0,
    roughness = 0.48,
    metallic = 0.12,
    swayX = 0,
    opaqueCutout = true,
  ): void {
    const rect = atlas.getRect(id);
    const dw = w ?? rect.w;
    const dh = h ?? rect.h;
    const u0 = flipX ? rect.u1 : rect.u0;
    const u1 = flipX ? rect.u0 : rect.u1;
    let r = 1;
    let g = 1;
    let b = 1;
    if (tint) {
      const n = packHexRgb(tint);
      r = ((n >> 16) & 255) * INV_255;
      g = ((n >> 8) & 255) * INV_255;
      b = (n & 255) * INV_255;
    }
    const rad = tiltDeg * DEG_TO_RAD;
    const sinT = Math.sin(rad);
    const cosT = Math.cos(rad);
    const ox = footX - dw * 0.5 + swayX;
    const oy = footY - sinT * dh;
    const oz = footZ + cosT * dh;
    const pass: 0 | 1 | 2 = additive ? 2 : alpha >= 0.99 && opaqueCutout ? 0 : 1;
    this.pushQuad3D(
      pass,
      ox,
      oy,
      oz,
      dw,
      0,
      0,
      -swayX,
      sinT * dh,
      -cosT * dh,
      u0,
      rect.v0,
      u1,
      rect.v1,
      r,
      g,
      b,
      alpha,
      0,
      cosT,
      sinT,
      0,
      flash,
      1.04,
      paletteRow,
      rect.page ?? 0,
      roughness,
      metallic,
      emissive,
    );
  }

  public drawGroundShadow3D(
    cx: number,
    cy: number,
    z = 0,
    w = 20,
    h = 10,
    colorHex = '#0c0816',
    alpha = 0.44,
    softness = 0.62,
  ): void {
    const n = packHexRgb(colorHex);
    this.pushQuad3D(
      1,
      cx - w * 0.5,
      cy - h * 0.5,
      z + 0.25,
      w,
      0,
      0,
      0,
      h,
      0,
      0,
      0,
      1,
      1,
      ((n >> 16) & 255) * INV_255,
      ((n >> 8) & 255) * INV_255,
      (n & 255) * INV_255,
      alpha,
      0,
      0,
      1,
      3,
      0,
      softness,
      -2,
      0,
      1,
      0,
      0,
    );
  }

  public drawLight3D(
    cx: number,
    cy: number,
    z = 0,
    radius = 64,
    colorHex = '#ffaa55',
    intensity = 0.45,
    falloffPower = 2.0,
  ): void {
    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(z) ||
      !(radius > 0) ||
      !Number.isFinite(radius) ||
      !(intensity > 0.001) ||
      !Number.isFinite(intensity)
    ) {
      return;
    }
    this.lightCount++;
    const n = packHexRgb(colorHex);
    const d = radius * 2;
    this.pushQuad3D(
      2,
      cx - radius,
      cy - radius,
      z + 0.45,
      d,
      0,
      0,
      0,
      d,
      0,
      0,
      0,
      1,
      1,
      ((n >> 16) & 255) * INV_255,
      ((n >> 8) & 255) * INV_255,
      (n & 255) * INV_255,
      intensity,
      0,
      0,
      1,
      1,
      0,
      Number.isFinite(falloffPower) && falloffPower > 0.05 ? falloffPower : 2.0,
      -2,
      0,
      1,
      0,
      0.8,
    );
  }

  public drawParticle3D(
    cx: number,
    cy: number,
    cz: number,
    size: number,
    colorHex: string,
    alpha = 1,
    additive = false,
    emissive = 0.45,
  ): void {
    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(cz) ||
      !(size > 0) ||
      !Number.isFinite(size) ||
      !(alpha > 0.001) ||
      !Number.isFinite(alpha)
    ) {
      return;
    }
    const n = packHexRgb(colorHex);
    const half = size * 0.5;
    const tiltRad = 24 * DEG_TO_RAD;
    const sinT = Math.sin(tiltRad);
    const cosT = Math.cos(tiltRad);
    this.pushQuad3D(
      additive ? 2 : 1,
      cx - half,
      cy - sinT * half,
      cz + cosT * half,
      size,
      0,
      0,
      0,
      sinT * size,
      -cosT * size,
      0,
      0,
      1,
      1,
      ((n >> 16) & 255) * INV_255,
      ((n >> 8) & 255) * INV_255,
      (n & 255) * INV_255,
      alpha,
      0,
      cosT,
      sinT,
      2,
      0,
      1,
      -2,
      0,
      0.5,
      0,
      emissive,
    );
  }
}
