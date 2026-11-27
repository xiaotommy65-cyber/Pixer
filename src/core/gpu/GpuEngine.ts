import { TextureAtlas, type SpriteId } from '../../assets/TextureAtlas.ts';
import { mixOklabRgb01 } from '../math/ColorMath.ts';
import type { Camera3DProjectionMode } from '../math/Perspective3DMath.ts';
import { appLogger } from '../runtime/AppLogger.ts';
import { Canvas2DBackend } from './Canvas2DBackend.ts';
import { hexToRgb01, INV_255, packHexRgb } from './GpuColorCache.ts';
import { GpuDynamicGlyphCache } from './GpuDynamicGlyphCache.ts';
import { GpuEngine3DHelpers, type Mesh3DIndexedOptions } from './GpuEngine3DHelpers.ts';
import type { CardinalFacing3D } from './GpuMesh3DBatch.ts';
import {
  FLOATS_PER_INSTANCE,
  MAX_DYNAMIC_LIGHTS,
  MAX_INSTANCES_PER_PASS,
  type GpuBackendKind,
  type GpuFrameStats,
  type GpuOcclusionState,
  type IGpuBackend,
  type SkyGradient,
  type SpriteRect,
} from './GpuTypes.ts';
import { WebGl2Backend } from './WebGl2Backend.ts';
import { WebGpuBackend } from './WebGpuBackend.ts';

export { hexToRgb01 };

export class GpuEngine {
  public readonly atlas: TextureAtlas;
  private backend: IGpuBackend | null = null;
  private canvas: HTMLCanvasElement;
  private alphaItems = new Float32Array(MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE);
  private addItems = new Float32Array(MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE);
  private readonly scene3d = new GpuEngine3DHelpers();
  private readonly dynamicGlyphCache = new GpuDynamicGlyphCache();
  private readonly glyphMeasureScratch = {
    rect: null as SpriteRect | null,
    drawW: 0,
    drawH: 0,
    advanceX: 0,
    yOffset: 0,
  };
  private readonly dynamicLights = new Float32Array(MAX_DYNAMIC_LIGHTS * 8);
  private dynamicLightCount = 0;
  private alphaCount = 0;
  private addCount = 0;
  private spriteTotal = 0;
  private lightTotal = 0;
  private viewW = 320;
  private viewH = 180;
  private lastSkyTopPacked = -1;
  private lastSkyBotPacked = -1;
  private currentSky: SkyGradient = {
    top: hexToRgb01('#8ed4ff'),
    bottom: hexToRgb01('#fff2df'),
    mid: [0.81, 0.91, 0.94],
    cozyFilter: true,
    glowIntensity: 1.0,
    filterMode: 0,
    camFracX: 0,
    camFracY: 0,
    viewW: 320,
    viewH: 180,
    waterLevelNorm: 0,
    waterTint: hexToRgb01('#3a6e9c'),
    tiltShiftBlur: 0,
    tiltShiftFocusY: 0.52,
  };
  private readonly occlusionState: GpuOcclusionState = {
    enabled: false,
    cols: 0,
    rows: 0,
    originScreenX: 0,
    originScreenY: 0,
    tileSizePx: 32,
    data: null,
    version: -1,
    shadowStrength: 0,
    shadowSoftness: 0.35,
  };
  private screenFilterCode = 0;
  private onBackendChange?: (kind: GpuBackendKind, canvas?: HTMLCanvasElement) => void;
  private lastStats: GpuFrameStats = {
    backend: 'initializing',
    drawCalls: 0,
    spriteCount: 0,
    lightCount: 0,
    frameTimeMs: 0,
  };

  constructor(
    canvas: HTMLCanvasElement,
    onBackendChange?: (kind: GpuBackendKind, canvas?: HTMLCanvasElement) => void,
    atlas: TextureAtlas = new TextureAtlas(),
  ) {
    this.canvas = canvas;
    this.onBackendChange = onBackendChange;
    this.atlas = atlas;
  }

  public setLogicalViewport(width: number, height: number): void {
    this.viewW = Math.max(160, Math.min(1280, Math.round(width)));
    this.viewH = Math.max(120, Math.min(720, Math.round(height)));
  }

  public getLogicalViewport(): { width: number; height: number } {
    return { width: this.viewW, height: this.viewH };
  }

  public getLogicalWidth(): number {
    return this.viewW;
  }

  public getLogicalHeight(): number {
    return this.viewH;
  }

  public setFilterModeCode(mode: number): void {
    this.screenFilterCode = Math.max(0, Math.min(2, Math.round(mode)));
  }

  public hasBackend(): boolean {
    return this.backend !== null;
  }

  public supports3D(): boolean {
    return this.backend?.kind === 'webgpu' || this.backend?.kind === 'webgl2';
  }

  public getQuad3DStats(): { opaqueCount: number; alphaCount: number; additiveCount: number; enabled: boolean } {
    return this.scene3d.getQuad3DStats();
  }

  public getMesh3DStats(): {
    opaqueVertices: number;
    opaqueTriangles: number;
    alphaVertices: number;
    alphaTriangles: number;
    lineSegments: number;
  } {
    return this.scene3d.getMesh3DStats();
  }

  private replaceCanvasNode(): void {
    try {
      const doc = this.canvas.ownerDocument;
      if (!this.canvas.parentElement || !doc) return;
      const fresh = doc.createElement('canvas');
      fresh.className = this.canvas.className;
      fresh.width = Math.max(1, this.canvas.width);
      fresh.height = Math.max(1, this.canvas.height);
      this.canvas.replaceWith(fresh);
      this.canvas = fresh;
    } catch (err) {
      appLogger.error('gpu', 'gpu.replaceCanvas', '替換 Canvas 節點失敗', err);
    }
  }

  private uploadFullAtlasToBackend(): void {
    this.backend?.uploadAtlas(
      this.atlas.width,
      this.atlas.height,
      this.atlas.pixels,
      this.atlas.indexPixels,
      this.atlas.paletteLut,
      this.atlas.paletteRows,
      this.atlas.getExtraPages(),
    );
  }

  private activateCanvas2D(replaceCanvas: boolean, reason = 'fallback'): GpuBackendKind {
    this.backend?.dispose();
    this.backend = null;
    if (replaceCanvas) this.replaceCanvasNode();
    const c2d = Canvas2DBackend.tryCreate(this.canvas, this.atlas.width, this.atlas.height, this.atlas.pixels);
    if (!c2d) {
      appLogger.error('gpu', 'gpu.activateCanvas2D', 'Canvas 2D 保底渲染器初始化失敗', new Error('2D context null'), {
        reason,
      });
      return 'initializing';
    }
    this.backend = c2d;
    this.uploadFullAtlasToBackend();
    this.lastStats.backend = 'canvas2d';
    this.onBackendChange?.('canvas2d', this.canvas);
    appLogger.warn('gpu', 'gpu.activateCanvas2D', '已啟用 Canvas 2D 軟體保底渲染管線', undefined, {
      reason,
      width: this.canvas.width,
      height: this.canvas.height,
    });
    return 'canvas2d';
  }

  private activateWebGl2(replaceCanvas: boolean, reason = 'primary_or_fallback'): GpuBackendKind {
    this.backend?.dispose();
    this.backend = null;
    if (replaceCanvas) this.replaceCanvasNode();
    const gl2 = WebGl2Backend.tryCreate(
      this.canvas,
      this.atlas.width,
      this.atlas.height,
      this.atlas.pixels,
      () => {
        appLogger.warn('gpu', 'gpu.webglContextLost', '偵測到 WebGL2 Context 遺失，切換至 Canvas 2D 保底');
        this.activateCanvas2D(true, 'webglcontextlost');
      },
      this.atlas.indexPixels,
      this.atlas.paletteLut,
      this.atlas.paletteRows,
      this.atlas.getExtraPages(),
    );
    if (!gl2) {
      return this.activateCanvas2D(true, 'webgl2_unavailable');
    }
    this.backend = gl2;
    this.lastStats.backend = 'webgl2';
    this.onBackendChange?.('webgl2', this.canvas);
    appLogger.success('gpu', 'gpu.activateWebGl2', '已成功啟動 WebGL2 硬體加速管線', {
      reason,
      atlasSize: this.atlas.width,
    });
    return 'webgl2';
  }

  public forceCanvas2DFallback(): GpuBackendKind {
    if (this.backend?.kind === 'canvas2d') return 'canvas2d';
    return this.activateCanvas2D(true, 'frame_recovery');
  }

  public async init(): Promise<GpuBackendKind> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const gpu = await WebGpuBackend.tryCreate(
      this.canvas,
      this.atlas.width,
      this.atlas.height,
      this.atlas.pixels,
      () => {
        appLogger.warn('gpu', 'gpu.webgpuLost', 'WebGPU Device 遺失，自動切換至 WebGL2 / Canvas 2D');
        this.activateWebGl2(true, 'webgpu_lost');
      },
      this.atlas.indexPixels,
      this.atlas.paletteLut,
      this.atlas.paletteRows,
      this.atlas.getExtraPages(),
    );

    if (gpu) {
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      this.backend = gpu;
      this.lastStats.backend = 'webgpu';
      this.onBackendChange?.('webgpu', this.canvas);
      appLogger.success(
        'gpu',
        'gpu.initBackend',
        '已啟動 WebGPU WGSL 次世代像素渲染管線',
        { backend: 'webgpu', atlasSize: this.atlas.width },
        dt,
      );
      return 'webgpu';
    }

    return this.activateWebGl2(true, 'webgpu_unavailable');
  }

  public syncAtlasToGpu(): void {
    try {
      this.atlas.syncHeroSlots();
      this.uploadFullAtlasToBackend();
      this.atlas.clearDirty();
    } catch (err) {
      appLogger.error('gpu', 'gpu.syncAtlas', '上傳紋理圖集至 GPU 失敗', err, {
        backend: this.backend?.kind ?? 'none',
      });
    }
  }

  public syncAtlasIfDirty(): void {
    if (!this.atlas.isDirty()) return;
    try {
      this.uploadFullAtlasToBackend();
      this.atlas.clearDirty();
    } catch (err) {
      appLogger.error('gpu', 'gpu.syncAtlasDirty', '動態更新紋理圖集至 GPU 失敗', err, {
        backend: this.backend?.kind ?? 'none',
      });
    }
  }

  public resize(pixelWidth: number, pixelHeight: number): void {
    const w = Math.max(1, pixelWidth);
    const h = Math.max(1, pixelHeight);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.backend?.resize(w, h);
    }
  }

  public beginFrame(
    topHex: string,
    bottomHex: string,
    cozyFilter = true,
    glowIntensity = 1.0,
    filterMode = this.screenFilterCode,
    camFracX = 0,
    camFracY = 0,
  ): void {
    const topPacked = packHexRgb(topHex);
    this.currentSky.top[0] = ((topPacked >> 16) & 255) * INV_255;
    this.currentSky.top[1] = ((topPacked >> 8) & 255) * INV_255;
    this.currentSky.top[2] = (topPacked & 255) * INV_255;

    const botPacked = packHexRgb(bottomHex);
    this.currentSky.bottom[0] = ((botPacked >> 16) & 255) * INV_255;
    this.currentSky.bottom[1] = ((botPacked >> 8) & 255) * INV_255;
    this.currentSky.bottom[2] = (botPacked & 255) * INV_255;

    if (topPacked !== this.lastSkyTopPacked || botPacked !== this.lastSkyBotPacked) {
      this.lastSkyTopPacked = topPacked;
      this.lastSkyBotPacked = botPacked;
      if (!this.currentSky.mid) this.currentSky.mid = [0, 0, 0];
      mixOklabRgb01(
        this.currentSky.top[0],
        this.currentSky.top[1],
        this.currentSky.top[2],
        this.currentSky.bottom[0],
        this.currentSky.bottom[1],
        this.currentSky.bottom[2],
        0.5,
        this.currentSky.mid,
      );
    }

    this.currentSky.cozyFilter = cozyFilter;
    this.currentSky.glowIntensity = Math.max(0, Math.min(2.0, glowIntensity));
    this.currentSky.filterMode = filterMode;
    this.currentSky.camFracX = camFracX;
    this.currentSky.camFracY = camFracY;
    this.currentSky.viewW = this.viewW;
    this.currentSky.viewH = this.viewH;
    this.currentSky.waterLevelNorm = 0;
    this.currentSky.tiltShiftBlur = 0;
    this.currentSky.tiltShiftFocusY = 0.52;
    this.occlusionState.enabled = false;
    this.scene3d.resetFrame();
    this.dynamicLightCount = 0;
    this.alphaCount = 0;
    this.addCount = 0;
    this.spriteTotal = 0;
    this.lightTotal = 0;
  }

  public setCamera3D(
    camCenterX: number, camCenterY: number, zoom: number, pitchDeg = 42, fovDeg = 38,
    occOriginWorldX = 0, occOriginWorldY = 0, occTileSizeWorld = 32,
    yawDeg = 0, rollDeg = 0, camCenterZ = 0, projection: Camera3DProjectionMode = 'perspective',
  ): void {
    this.scene3d.setCamera3D(
      camCenterX, camCenterY, zoom, pitchDeg, fovDeg, this.viewW, this.viewH,
      occOriginWorldX, occOriginWorldY, occTileSizeWorld, yawDeg, rollDeg, camCenterZ, projection,
    );
  }

  public setSunLight3D(
    dirX: number, dirY: number, dirZ: number, shadowMapEnabled = true, shadowStrength = 0.45,
  ): void {
    this.scene3d.setSunLight3D(dirX, dirY, dirZ, shadowMapEnabled, shadowStrength);
  }

  public setQuadViewEnabled(enabled: boolean): void {
    this.scene3d.setQuadViewEnabled(enabled);
  }

  public pushDynamicLight3D(
    x: number, y: number, z: number, radius: number, colorHex: string, intensity: number, falloff = 2.0,
  ): void {
    const idx = this.dynamicLightCount;
    this.pushDynamicLight(x, y, radius, colorHex, intensity, falloff);
    if (this.dynamicLightCount > idx && idx < MAX_DYNAMIC_LIGHTS) {
      this.scene3d.setLightPosZ(idx, z);
    }
  }

  public pushDynamicLight(
    x: number, y: number, radius: number, colorHex: string, intensity: number, falloff = 2.0,
  ): void {
    if (
      this.dynamicLightCount >= MAX_DYNAMIC_LIGHTS ||
      !Number.isFinite(x) || !Number.isFinite(y) ||
      !(radius > 0) || !Number.isFinite(radius) ||
      !(intensity > 0.001) || !Number.isFinite(intensity)
    ) {
      return;
    }
    const n = packHexRgb(colorHex);
    const base = this.dynamicLightCount * 8;
    this.dynamicLights[base] = x;
    this.dynamicLights[base + 1] = y;
    this.dynamicLights[base + 2] = radius;
    this.dynamicLights[base + 3] = intensity;
    this.dynamicLights[base + 4] = ((n >> 16) & 255) * INV_255;
    this.dynamicLights[base + 5] = ((n >> 8) & 255) * INV_255;
    this.dynamicLights[base + 6] = (n & 255) * INV_255;
    this.dynamicLights[base + 7] = Number.isFinite(falloff) && falloff > 0.05 ? falloff : 2.0;
    this.dynamicLightCount++;
  }

  public setWaterPlane(levelNorm: number, tintHex = '#3a6e9c'): void {
    this.currentSky.waterLevelNorm = Math.max(0, Math.min(1, levelNorm));
    const n = packHexRgb(tintHex);
    if (!this.currentSky.waterTint) this.currentSky.waterTint = [0, 0, 0];
    this.currentSky.waterTint[0] = ((n >> 16) & 255) * INV_255;
    this.currentSky.waterTint[1] = ((n >> 8) & 255) * INV_255;
    this.currentSky.waterTint[2] = (n & 255) * INV_255;
  }

  public setTiltShift(blur: number, focusY = 0.52): void {
    this.currentSky.tiltShiftBlur = Math.max(0, Math.min(1, blur));
    this.currentSky.tiltShiftFocusY = Math.max(0.15, Math.min(0.85, focusY));
  }

  public setOcclusionGrid(
    cols: number, rows: number, originScreenX: number, originScreenY: number,
    tileSizePx: number, data: Uint8Array, version: number, shadowStrength = 0.85, shadowSoftness = 0.35,
  ): void {
    this.occlusionState.enabled = cols > 0 && rows > 0 && shadowStrength > 0.001;
    this.occlusionState.cols = cols;
    this.occlusionState.rows = rows;
    this.occlusionState.originScreenX = originScreenX;
    this.occlusionState.originScreenY = originScreenY;
    this.occlusionState.tileSizePx = Math.max(1, tileSizePx);
    this.occlusionState.data = data;
    this.occlusionState.version = version;
    this.occlusionState.shadowStrength = Math.max(0, Math.min(1, shadowStrength));
    this.occlusionState.shadowSoftness = Math.max(0, Math.min(1, shadowSoftness));
  }

  private pushInstance(
    additive: boolean, x: number, y: number, w: number, h: number,
    u0: number, v0: number, u1: number, v1: number,
    r: number, g: number, b: number, a: number,
    rot: number, mode: number, flash = 0, param = 0,
    pivotX = 0.5, pivotY = 0.5, skewX = 0, paletteRow = 0,
    atlasPage = 0, roughness = 0.48, metallic = 0.12, matEmissive = 0,
  ): void {
    const arr = additive ? this.addItems : this.alphaItems;
    const count = additive ? this.addCount : this.alphaCount;
    if (count >= MAX_INSTANCES_PER_PASS) return;

    const base = count * FLOATS_PER_INSTANCE;
    arr[base] = x;
    arr[base + 1] = y;
    arr[base + 2] = w;
    arr[base + 3] = h;
    arr[base + 4] = u0;
    arr[base + 5] = v0;
    arr[base + 6] = u1;
    arr[base + 7] = v1;
    arr[base + 8] = r;
    arr[base + 9] = g;
    arr[base + 10] = b;
    arr[base + 11] = a;
    arr[base + 12] = rot;
    arr[base + 13] = mode;
    arr[base + 14] = flash;
    arr[base + 15] = param;
    arr[base + 16] = pivotX;
    arr[base + 17] = pivotY;
    arr[base + 18] = skewX;
    arr[base + 19] = paletteRow;
    arr[base + 20] = atlasPage;
    arr[base + 21] = roughness;
    arr[base + 22] = metallic;
    arr[base + 23] = matEmissive;

    if (additive) this.addCount++;
    else this.alphaCount++;
  }

  private pushInstanceHex(
    additive: boolean, x: number, y: number, w: number, h: number,
    u0: number, v0: number, u1: number, v1: number,
    colorHex: string | undefined, a: number, rot: number, mode: number,
    flash = 0, param = 0, pivotX = 0.5, pivotY = 0.5, skewX = 0,
    paletteRow = 0, atlasPage = 0, roughness = 0.48, metallic = 0.12, matEmissive = 0,
  ): void {
    let r = 1;
    let g = 1;
    let b = 1;
    if (colorHex) {
      const n = packHexRgb(colorHex);
      r = ((n >> 16) & 255) * INV_255;
      g = ((n >> 8) & 255) * INV_255;
      b = (n & 255) * INV_255;
    }
    this.pushInstance(
      additive, x, y, w, h, u0, v0, u1, v1, r, g, b, a, rot, mode,
      flash, param, pivotX, pivotY, skewX, paletteRow, atlasPage, roughness, metallic, matEmissive,
    );
  }

  public drawSpriteRaw(
    id: SpriteId, x: number, y: number, w?: number, h?: number, flipX = false,
    rot = 0, tint?: string, alpha = 1, flash = 0, additive = false,
    pivotX = 0.5, pivotY = 0.5, skewX = 0, paletteRow = 0,
    emissive = 0, roughness = 0.48, metallic = 0.12,
  ): void {
    const rect = this.atlas.getRect(id);
    const dw = w ?? rect.w;
    const dh = h ?? rect.h;
    const u0 = flipX ? rect.u1 : rect.u0;
    const u1 = flipX ? rect.u0 : rect.u1;
    this.spriteTotal++;
    this.pushInstanceHex(
      additive, x, y, dw, dh, u0, rect.v0, u1, rect.v1, tint, alpha, rot, 0,
      flash, emissive, pivotX, pivotY, skewX, paletteRow, rect.page ?? 0, roughness, metallic, emissive,
    );
  }

  /**
   * Zero-GC sub-UV sprite slice draw used by 2.5D DDA raycast wall columns and orthogonal portrait crops.
   * `su0..su1` and `sv0..sv1` are normalized [0..1] sub-coordinates inside the sprite's atlas rect.
   */
  public drawSpriteUvSlice(
    id: SpriteId, x: number, y: number, w: number, h: number,
    su0: number, sv0: number, su1: number, sv1: number,
    tint?: string, alpha = 1, flash = 0, additive = false,
    pivotX = 0.5, pivotY = 0.5, paletteRow = 0, emissive = 0, roughness = 0.55, metallic = 0.08,
  ): void {
    const rect = this.atlas.getRect(id);
    const spanU = rect.u1 - rect.u0;
    const spanV = rect.v1 - rect.v0;
    const u0 = rect.u0 + spanU * su0;
    const u1 = rect.u0 + spanU * su1;
    const v0 = rect.v0 + spanV * sv0;
    const v1 = rect.v0 + spanV * sv1;
    this.spriteTotal++;
    this.pushInstanceHex(
      additive, x, y, w, h, u0, v0, u1, v1, tint, alpha, 0, 0,
      flash, emissive, pivotX, pivotY, 0, paletteRow, rect.page ?? 0, roughness, metallic, emissive,
    );
  }

  public drawSprite(
    id: SpriteId,
    x: number,
    y: number,
    opts?: {
      w?: number;
      h?: number;
      flipX?: boolean;
      rot?: number;
      tint?: string;
      alpha?: number;
      flash?: number;
      additive?: boolean;
      pivotX?: number;
      pivotY?: number;
      skewX?: number;
      paletteRow?: number;
      emissive?: number;
      roughness?: number;
      metallic?: number;
    },
  ): void {
    this.drawSpriteRaw(
      id, x, y, opts?.w, opts?.h, opts?.flipX ?? false, opts?.rot ?? 0, opts?.tint,
      opts?.alpha ?? 1, opts?.flash ?? 0, opts?.additive ?? false,
      opts?.pivotX ?? 0.5, opts?.pivotY ?? 0.5, opts?.skewX ?? 0,
      opts?.paletteRow ?? 0, opts?.emissive ?? 0, opts?.roughness ?? 0.48, opts?.metallic ?? 0.12,
    );
  }

  public drawRect(
    x: number, y: number, w: number, h: number, colorHex: string,
    alpha = 1, rot = 0, additive = false, flash = 0, bevelRadius = 0,
  ): void {
    this.spriteTotal++;
    this.pushInstanceHex(additive, x, y, w, h, 0, 0, 1, 1, colorHex, alpha, rot, 2, flash, bevelRadius);
  }

  public drawLight(
    x: number, y: number, radius: number, colorHex: string, intensity = 0.45, falloffPower = 2.0,
  ): void {
    this.lightTotal++;
    this.pushInstanceHex(true, x, y, radius * 2, radius * 2, 0, 0, 1, 1, colorHex, intensity, 0, 1, 0, falloffPower);
  }

  /** Mode 1 (>= 10): Crisp 4-point sparkling star glint with soft core halo. */
  public drawStarGlint(x: number, y: number, size: number, colorHex: string, alpha = 0.9, sharpness = 2.4): void {
    this.spriteTotal++;
    this.pushInstanceHex(true, x, y, size * 2.4, size * 2.4, 0, 0, 1, 1, colorHex, alpha, 0, 1, 0, 10 + sharpness);
  }

  /** Mode 3: Smooth analytical SDF elliptical soft drop shadow. */
  public drawSoftShadow(
    cx: number, cy: number, w: number, h: number, colorHex = '#0d0918', alpha = 0.42, softness = 0.62,
  ): void {
    this.spriteTotal++;
    this.pushInstanceHex(false, cx, cy, w, h, 0, 0, 1, 1, colorHex, alpha, 0, 3, 0, softness);
  }

  /**
   * Mode 4: Procedural normal-lit beveled masonry / cliff / timber / astral facade.
   * materialKind: 0=stone masonry, 1=earth cliff strata, 2=timber/riveted lip, 3=astral rune pillar.
   */
  public drawBeveledWall(
    cx: number, cy: number, w: number, h: number, colorHex: string,
    materialKind: 0 | 1 | 2 | 3 = 0, alpha = 0.98, seed = 0,
  ): void {
    this.spriteTotal++;
    const tilesX = Math.max(0.5, w / 16);
    const tilesY = Math.max(0.25, h / 16);
    this.pushInstanceHex(false, cx, cy, w, h, tilesX, tilesY, seed, 0, colorHex, alpha, 0, 4, 0, materialKind);
  }

  /**
   * Mode 5: Continuous smoothstep gradient or edge bokeh vignette.
   * dir: 0 = fade top->bottom, 1 = fade bottom->top, 2 = elliptical vignette.
   */
  public drawSmoothGradient(
    cx: number, cy: number, w: number, h: number, colorHex: string, alpha: number,
    dir: 0 | 1 | 2 = 0, power = 1.35,
  ): void {
    this.spriteTotal++;
    this.pushInstanceHex(false, cx, cy, w, h, dir, power, 1, 1, colorHex, alpha, 0, 5, 0, power);
  }

  private resolveGlyphInto(rawCodePoint: number, stepW: number, drawH: number, scale: number): boolean {
    const out = this.glyphMeasureScratch;
    if (rawCodePoint === 32 || rawCodePoint === 0x3000) {
      out.rect = null;
      out.drawW = 0;
      out.drawH = 0;
      out.advanceX = rawCodePoint === 0x3000 ? Math.round(stepW * 1.45) : stepW;
      out.yOffset = 0;
      return true;
    }
    const ch = rawCodePoint >= 97 && rawCodePoint <= 122 ? rawCodePoint - 32 : rawCodePoint;
    const builtinRect = this.atlas.getGlyphRect(ch);
    if (builtinRect) {
      out.rect = builtinRect;
      out.drawW = stepW;
      out.drawH = drawH;
      out.advanceX = stepW;
      out.yOffset = 0;
      return true;
    }
    const dyn = this.dynamicGlyphCache.resolve(rawCodePoint, this.atlas);
    if (!dyn) return false;
    out.rect = dyn.rect;
    out.drawW = Math.round(drawH * (dyn.isWide ? 1.125 : 0.95));
    out.drawH = Math.round(drawH * 1.125);
    out.advanceX = Math.round(stepW * dyn.advanceRatio);
    out.yOffset = -Math.round(scale * 0.5);
    return true;
  }

  private emitTextGlyphPass(
    text: string, startX: number, y: number, stepW: number, drawH: number, scale: number,
    colorHex: string, alpha: number, offsetX: number, offsetY: number,
  ): void {
    const len = text.length;
    const gm = this.glyphMeasureScratch;
    let cx = startX;
    for (let i = 0; i < len; ) {
      const cp = text.codePointAt(i) ?? text.charCodeAt(i);
      i += cp > 0xffff ? 2 : 1;
      if (!this.resolveGlyphInto(cp, stepW, drawH, scale)) continue;
      const rect = gm.rect;
      if (rect) {
        this.spriteTotal++;
        this.pushInstanceHex(
          false, cx + offsetX, y + offsetY + gm.yOffset, gm.drawW, gm.drawH,
          rect.u0, rect.v0, rect.u1, rect.v1, colorHex, alpha,
          0, 0, 0, 0, 0, 0, 0, -2, rect.page ?? 0, 1.0, 0.0, 0,
        );
      }
      cx += gm.advanceX;
    }
  }

  /**
   * Zero-GC bitmap pixel text renderer using 6x8 atlas glyphs + dynamic Unicode/CJK glyph cache.
   * Uses paletteRow = -2 so shaders skip Auto-Sobel/normal lighting on crisp UI text.
   */
  public drawPixelText(
    text: string, x: number, y: number, colorHex: string, scale = 1,
    align: 'left' | 'center' | 'right' = 'left', shadowColor = '#120d1e', alpha = 1,
  ): void {
    if (!text || alpha <= 0.005) return;
    if (typeof this.atlas.getGlyphRect !== 'function') return;

    const ctor = this.atlas.constructor as { FONT_GLYPH_W?: number; FONT_GLYPH_H?: number };
    const stepW = (ctor.FONT_GLYPH_W ?? 6) * scale;
    const drawH = (ctor.FONT_GLYPH_H ?? 8) * scale;
    const len = text.length;
    const gm = this.glyphMeasureScratch;

    let totalW = 0;
    for (let i = 0; i < len; ) {
      const cp = text.codePointAt(i) ?? text.charCodeAt(i);
      i += cp > 0xffff ? 2 : 1;
      if (this.resolveGlyphInto(cp, stepW, drawH, scale)) totalW += gm.advanceX;
    }
    if (totalW <= 0) return;

    let startX = x;
    if (align === 'center') startX = x - totalW * 0.5;
    else if (align === 'right') startX = x - totalW;

    if (shadowColor) {
      this.emitTextGlyphPass(text, startX, y, stepW, drawH, scale, shadowColor, alpha * 0.85, scale, scale);
    }
    this.emitTextGlyphPass(text, startX, y, stepW, drawH, scale, colorHex, alpha, 0, 0);
  }

  /** Zero-GC 3D Quad primitive emitter (0=opaque cutout, 1=alpha blend, 2=additive blend). */
  public pushQuad3D(
    pass: 0 | 1 | 2, ox: number, oy: number, oz: number,
    ux: number, uy: number, uz: number, vx: number, vy: number, vz: number,
    u0: number, v0: number, u1: number, v1: number,
    r: number, g: number, b: number, a: number, nx: number, ny: number, nz: number,
    mode = 0, flash = 0, shadeMult = 1, paletteRow = 0, atlasPage = 0,
    roughness = 0.48, metallic = 0.12, emissive = 0,
  ): void {
    this.scene3d.pushQuad3D(
      pass, ox, oy, oz, ux, uy, uz, vx, vy, vz, u0, v0, u1, v1,
      r, g, b, a, nx, ny, nz, mode, flash, shadeMult, paletteRow, atlasPage, roughness, metallic, emissive,
    );
  }

  public drawFloorTile3D(
    id: SpriteId, x: number, y: number, w: number, h: number, z = 0,
    tint?: string, alpha = 1, paletteRow = 0, shadeMult = 1.0,
    roughness = 0.62, metallic = 0.06, emissive = 0,
  ): void {
    this.scene3d.drawFloorTile3D(this.atlas, id, x, y, w, h, z, tint, alpha, paletteRow, shadeMult, roughness, metallic, emissive);
  }

  /** Extrudes a 2D map wall tile into a crisp 3D pixel box with automatic adjacent-wall face culling. */
  public drawBox3DWall(
    topId: SpriteId, sideId: SpriteId | null, x: number, y: number, w: number, h: number,
    zBase: number, wallH: number, neighborMask: number, tint?: string, wallTint?: string,
    alpha = 1, paletteRow = 0, roughness = 0.58, metallic = 0.1, obliqueShadowAlpha = 0.35, emissive = 0,
  ): void {
    this.scene3d.drawBox3DWall(
      this.atlas, topId, sideId, x, y, w, h, zBase, wallH, neighborMask,
      tint, wallTint, alpha, paletteRow, roughness, metallic, obliqueShadowAlpha, emissive,
    );
  }

  /** Emits an upright HD-2D pixel sprite billboard planted at (footX, footY, footZ) and tilted back by tiltDeg. */
  public drawBillboard3D(
    id: SpriteId, footX: number, footY: number, footZ: number, w?: number, h?: number,
    tiltDeg = 12, flipX = false, tint?: string, alpha = 1, flash = 0, additive = false,
    paletteRow = 0, emissive = 0, roughness = 0.48, metallic = 0.12, swayX = 0, opaqueCutout = true,
  ): void {
    this.scene3d.drawBillboard3D(
      this.atlas, id, footX, footY, footZ, w, h, tiltDeg, flipX, tint, alpha, flash,
      additive, paletteRow, emissive, roughness, metallic, swayX, opaqueCutout,
    );
  }

  public drawGroundShadow3D(
    cx: number, cy: number, z = 0, w = 20, h = 10, colorHex = '#0c0816', alpha = 0.44, softness = 0.62,
  ): void {
    this.scene3d.drawGroundShadow3D(cx, cy, z, w, h, colorHex, alpha, softness);
  }

  public drawLight3D(
    cx: number, cy: number, z = 0, radius = 64, colorHex = '#ffaa55', intensity = 0.45, falloffPower = 2.0,
  ): void {
    this.scene3d.drawLight3D(cx, cy, z, radius, colorHex, intensity, falloffPower);
  }

  public drawParticle3D(
    cx: number, cy: number, cz: number, size: number, colorHex: string, alpha = 1, additive = false, emissive = 0.45,
  ): void {
    this.scene3d.drawParticle3D(cx, cy, cz, size, colorHex, alpha, additive, emissive);
  }

  public pushMesh3DIndexed(
    positions: Float32Array | readonly number[], normals: Float32Array | readonly number[],
    uvs: Float32Array | readonly number[] | null, indices: Uint32Array | Uint16Array | readonly number[],
    options?: Mesh3DIndexedOptions,
  ): void {
    this.scene3d.pushMesh3DIndexed(positions, normals, uvs, indices, options);
  }

  public drawCuboid3D(
    topId: SpriteId | null, sideId: SpriteId | null, bottomId: SpriteId | null,
    x: number, y: number, z: number, sx: number, sy: number, sz: number,
    cullMask = 0, tint?: string, alpha = 1, paletteRow = -1,
    roughness = 0.58, metallic = 0.08, emissive = 0, yawDeg = 0,
  ): void {
    this.scene3d.drawCuboid3D(
      this.atlas, topId, sideId, bottomId, x, y, z, sx, sy, sz, cullMask,
      tint, alpha, paletteRow, roughness, metallic, emissive, yawDeg,
    );
  }

  public drawRamp3D(
    topId: SpriteId | null, sideId: SpriteId | null,
    x: number, y: number, z: number, sx: number, sy: number, sz: number,
    facing: CardinalFacing3D, tint?: string, alpha = 1, paletteRow = -1,
    roughness = 0.6, metallic = 0.06, emissive = 0,
  ): void {
    this.scene3d.drawRamp3D(
      this.atlas, topId, sideId, x, y, z, sx, sy, sz, facing, tint, alpha, paletteRow, roughness, metallic, emissive,
    );
  }

  public drawStairs3D(
    topId: SpriteId | null, sideId: SpriteId | null,
    x: number, y: number, z: number, sx: number, sy: number, sz: number,
    facing: CardinalFacing3D, steps = 4, tint?: string, alpha = 1, paletteRow = -1,
    roughness = 0.62, metallic = 0.06, emissive = 0,
  ): void {
    this.scene3d.drawStairs3D(
      this.atlas, topId, sideId, x, y, z, sx, sy, sz, facing, steps,
      tint, alpha, paletteRow, roughness, metallic, emissive,
    );
  }

  public drawLine3D(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colorHex: string, alpha = 1,
  ): void {
    this.scene3d.drawLine3D(x0, y0, z0, x1, y1, z1, colorHex, alpha);
  }

  public drawAxisGizmo3D(ox: number, oy: number, oz: number, axisLen = 48): void {
    this.scene3d.drawAxisGizmo3D(ox, oy, oz, axisLen);
  }

  public drawOrthoGrid3D(
    minX: number, minY: number, maxX: number, maxY: number,
    zPlane = 0, step = 32, majorEvery = 4, minorColor = '#334155', majorColor = '#64748b', alpha = 0.55,
  ): void {
    this.scene3d.drawOrthoGrid3D(minX, minY, maxX, maxY, zPlane, step, majorEvery, minorColor, majorColor, alpha);
  }

  public flush(timeSec: number): GpuFrameStats {
    this.syncAtlasIfDirty();
    if (!this.backend) {
      return this.lastStats;
    }
    const t0 = performance.now();
    const drawCalls = this.backend.renderFrame(
      this.currentSky,
      this.alphaItems,
      this.alphaCount,
      this.addItems,
      this.addCount,
      timeSec,
      this.dynamicLights,
      this.dynamicLightCount,
      this.occlusionState,
      this.scene3d.getQuadPassData(),
      this.scene3d.getMeshPassData(),
    );
    const frameTimeMs = performance.now() - t0;
    this.lastStats.backend = this.backend.kind;
    this.lastStats.drawCalls = drawCalls;
    this.lastStats.spriteCount = this.spriteTotal + this.scene3d.quad3d.spriteCount;
    this.lastStats.lightCount = Math.max(this.lightTotal + this.scene3d.quad3d.lightCount, this.dynamicLightCount);
    this.lastStats.frameTimeMs = frameTimeMs;
    return this.lastStats;
  }

  public getStats(): GpuFrameStats {
    return this.lastStats;
  }

  public dispose(): void {
    this.dynamicGlyphCache.dispose();
    this.backend?.dispose();
    this.backend = null;
  }
}
