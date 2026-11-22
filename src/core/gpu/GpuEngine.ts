import { TextureAtlas, type SpriteId } from '../../assets/TextureAtlas.ts';
import { mixOklabRgb01 } from '../math/ColorMath.ts';
import { appLogger } from '../runtime/AppLogger.ts';
import { Canvas2DBackend } from './Canvas2DBackend.ts';
import {
  FLOATS_PER_INSTANCE,
  FLOATS_PER_QUAD3D,
  MAX_DYNAMIC_LIGHTS,
  MAX_INSTANCES_PER_PASS,
  MAX_QUAD3D_INSTANCES,
  type GpuBackendKind,
  type GpuCamera3DState,
  type GpuFrameStats,
  type GpuOcclusionState,
  type IGpuBackend,
  type Quad3DPassData,
  type SkyGradient,
  type SpriteRect,
} from './GpuTypes.ts';
import { WebGl2Backend } from './WebGl2Backend.ts';
import { WebGpuBackend } from './WebGpuBackend.ts';

const MAX_QUAD3D_BLEND_INSTANCES = 4096;
const DEG_TO_RAD = Math.PI / 180;

const INV_255 = 1 / 255;
const MAX_COLOR_CACHE_ENTRIES = 512;
const PACKED_RGB_CACHE = new Map<string, number>();

function packHexRgb(hex: string): number {
  const cached = PACKED_RGB_CACHE.get(hex);
  if (cached !== undefined) return cached;

  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const parsed = clean.length === 6 ? parseInt(clean, 16) : 0xffffff;
  const packed = Number.isNaN(parsed) ? 0xffffff : parsed & 0xffffff;
  if (PACKED_RGB_CACHE.size >= MAX_COLOR_CACHE_ENTRIES) {
    PACKED_RGB_CACHE.clear();
  }
  PACKED_RGB_CACHE.set(hex, packed);
  return packed;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const n = packHexRgb(hex);
  return [((n >> 16) & 255) * INV_255, ((n >> 8) & 255) * INV_255, (n & 255) * INV_255];
}

export class GpuEngine {
  public readonly atlas: TextureAtlas;
  private backend: IGpuBackend | null = null;
  private canvas: HTMLCanvasElement;
  private alphaItems = new Float32Array(MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE);
  private addItems = new Float32Array(MAX_INSTANCES_PER_PASS * FLOATS_PER_INSTANCE);
  private quad3dOpaqueItems = new Float32Array(MAX_QUAD3D_INSTANCES * FLOATS_PER_QUAD3D);
  private quad3dAlphaItems = new Float32Array(MAX_QUAD3D_BLEND_INSTANCES * FLOATS_PER_QUAD3D);
  private quad3dAddItems = new Float32Array(MAX_QUAD3D_BLEND_INSTANCES * FLOATS_PER_QUAD3D);
  private quad3dOpaqueCount = 0;
  private quad3dAlphaCount = 0;
  private quad3dAddCount = 0;
  private readonly camera3dState: GpuCamera3DState = {
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
  private readonly quad3dPassData: Quad3DPassData = {
    camera: this.camera3dState,
    opaqueData: this.quad3dOpaqueItems,
    opaqueCount: 0,
    alphaData: this.quad3dAlphaItems,
    alphaCount: 0,
    additiveData: this.quad3dAddItems,
    additiveCount: 0,
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

  public supports3D(): boolean {
    return this.backend?.kind === 'webgpu' || this.backend?.kind === 'webgl2';
  }

  public getQuad3DStats(): { opaqueCount: number; alphaCount: number; additiveCount: number; enabled: boolean } {
    return {
      opaqueCount: this.quad3dOpaqueCount,
      alphaCount: this.quad3dAlphaCount,
      additiveCount: this.quad3dAddCount,
      enabled: this.camera3dState.enabled,
    };
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
    const c2d = Canvas2DBackend.tryCreate(
      this.canvas,
      this.atlas.width,
      this.atlas.height,
      this.atlas.pixels,
    );
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
      appLogger.success('gpu', 'gpu.initBackend', '已啟動 WebGPU WGSL 次世代像素渲染管線', {
        backend: 'webgpu',
        atlasSize: this.atlas.width,
      }, dt);
      return 'webgpu';
    }

    // Replace canvas safely in case WebGPU initialization touched getContext('webgpu')
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
    this.camera3dState.enabled = false;
    this.quad3dOpaqueCount = 0;
    this.quad3dAlphaCount = 0;
    this.quad3dAddCount = 0;
    this.dynamicLightCount = 0;
    this.alphaCount = 0;
    this.addCount = 0;
    this.spriteTotal = 0;
    this.lightTotal = 0;
  }

  public setCamera3D(
    camCenterX: number,
    camCenterY: number,
    zoom: number,
    pitchDeg = 42,
    fovDeg = 38,
    occOriginWorldX = 0,
    occOriginWorldY = 0,
    occTileSizeWorld = 32,
  ): void {
    this.camera3dState.enabled = true;
    this.camera3dState.camCenterX = camCenterX;
    this.camera3dState.camCenterY = camCenterY;
    this.camera3dState.zoom = Math.max(0.1, zoom);
    this.camera3dState.pitchDeg = Math.max(20, Math.min(78, pitchDeg));
    this.camera3dState.fovDeg = Math.max(20, Math.min(65, fovDeg));
    this.camera3dState.viewW = this.viewW;
    this.camera3dState.viewH = this.viewH;
    this.camera3dState.occOriginWorldX = occOriginWorldX;
    this.camera3dState.occOriginWorldY = occOriginWorldY;
    this.camera3dState.occTileSizeWorld = Math.max(1, occTileSizeWorld);
  }

  public pushDynamicLight(
    x: number,
    y: number,
    radius: number,
    colorHex: string,
    intensity: number,
    falloff = 2.0,
  ): void {
    if (this.dynamicLightCount >= MAX_DYNAMIC_LIGHTS || radius <= 0 || intensity <= 0.001) return;
    const n = packHexRgb(colorHex);
    const base = this.dynamicLightCount * 8;
    this.dynamicLights[base] = x;
    this.dynamicLights[base + 1] = y;
    this.dynamicLights[base + 2] = radius;
    this.dynamicLights[base + 3] = intensity;
    this.dynamicLights[base + 4] = ((n >> 16) & 255) * INV_255;
    this.dynamicLights[base + 5] = ((n >> 8) & 255) * INV_255;
    this.dynamicLights[base + 6] = (n & 255) * INV_255;
    this.dynamicLights[base + 7] = falloff > 0.05 ? falloff : 2.0;
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
    cols: number,
    rows: number,
    originScreenX: number,
    originScreenY: number,
    tileSizePx: number,
    data: Uint8Array,
    version: number,
    shadowStrength = 0.85,
    shadowSoftness = 0.35,
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
    additive: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    b: number,
    a: number,
    rot: number,
    mode: number,
    flash = 0,
    param = 0,
    pivotX = 0.5,
    pivotY = 0.5,
    skewX = 0,
    paletteRow = 0,
    atlasPage = 0,
    roughness = 0.48,
    metallic = 0.12,
    matEmissive = 0,
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
    additive: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    colorHex: string | undefined,
    a: number,
    rot: number,
    mode: number,
    flash = 0,
    param = 0,
    pivotX = 0.5,
    pivotY = 0.5,
    skewX = 0,
    paletteRow = 0,
    atlasPage = 0,
    roughness = 0.48,
    metallic = 0.12,
    matEmissive = 0,
  ): void {
    if (colorHex) {
      const n = packHexRgb(colorHex);
      this.pushInstance(
        additive,
        x,
        y,
        w,
        h,
        u0,
        v0,
        u1,
        v1,
        ((n >> 16) & 255) * INV_255,
        ((n >> 8) & 255) * INV_255,
        (n & 255) * INV_255,
        a,
        rot,
        mode,
        flash,
        param,
        pivotX,
        pivotY,
        skewX,
        paletteRow,
        atlasPage,
        roughness,
        metallic,
        matEmissive,
      );
      return;
    }
    this.pushInstance(
      additive,
      x,
      y,
      w,
      h,
      u0,
      v0,
      u1,
      v1,
      1,
      1,
      1,
      a,
      rot,
      mode,
      flash,
      param,
      pivotX,
      pivotY,
      skewX,
      paletteRow,
      atlasPage,
      roughness,
      metallic,
      matEmissive,
    );
  }

  public drawSpriteRaw(
    id: SpriteId,
    x: number,
    y: number,
    w?: number,
    h?: number,
    flipX = false,
    rot = 0,
    tint?: string,
    alpha = 1,
    flash = 0,
    additive = false,
    pivotX = 0.5,
    pivotY = 0.5,
    skewX = 0,
    paletteRow = 0,
    emissive = 0,
    roughness = 0.48,
    metallic = 0.12,
  ): void {
    const rect = this.atlas.getRect(id);
    const dw = w ?? rect.w;
    const dh = h ?? rect.h;
    const u0 = flipX ? rect.u1 : rect.u0;
    const u1 = flipX ? rect.u0 : rect.u1;
    this.spriteTotal++;
    this.pushInstanceHex(
      additive,
      x,
      y,
      dw,
      dh,
      u0,
      rect.v0,
      u1,
      rect.v1,
      tint,
      alpha,
      rot,
      0,
      flash,
      emissive,
      pivotX,
      pivotY,
      skewX,
      paletteRow,
      rect.page ?? 0,
      roughness,
      metallic,
      emissive,
    );
  }

  /**
   * Zero-GC sub-UV sprite slice draw used by 2.5D DDA raycast wall columns and orthogonal portrait crops.
   * `su0..su1` and `sv0..sv1` are normalized [0..1] sub-coordinates inside the sprite's atlas rect.
   */
  public drawSpriteUvSlice(
    id: SpriteId,
    x: number,
    y: number,
    w: number,
    h: number,
    su0: number,
    sv0: number,
    su1: number,
    sv1: number,
    tint?: string,
    alpha = 1,
    flash = 0,
    additive = false,
    pivotX = 0.5,
    pivotY = 0.5,
    paletteRow = 0,
    emissive = 0,
    roughness = 0.55,
    metallic = 0.08,
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
      additive,
      x,
      y,
      w,
      h,
      u0,
      v0,
      u1,
      v1,
      tint,
      alpha,
      0,
      0,
      flash,
      emissive,
      pivotX,
      pivotY,
      0,
      paletteRow,
      rect.page ?? 0,
      roughness,
      metallic,
      emissive,
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
      id,
      x,
      y,
      opts?.w,
      opts?.h,
      opts?.flipX ?? false,
      opts?.rot ?? 0,
      opts?.tint,
      opts?.alpha ?? 1,
      opts?.flash ?? 0,
      opts?.additive ?? false,
      opts?.pivotX ?? 0.5,
      opts?.pivotY ?? 0.5,
      opts?.skewX ?? 0,
      opts?.paletteRow ?? 0,
      opts?.emissive ?? 0,
      opts?.roughness ?? 0.48,
      opts?.metallic ?? 0.12,
    );
  }

  public drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    colorHex: string,
    alpha = 1,
    rot = 0,
    additive = false,
    flash = 0,
    bevelRadius = 0,
  ): void {
    this.spriteTotal++;
    this.pushInstanceHex(additive, x, y, w, h, 0, 0, 1, 1, colorHex, alpha, rot, 2, flash, bevelRadius);
  }

  public drawLight(
    x: number,
    y: number,
    radius: number,
    colorHex: string,
    intensity = 0.45,
    falloffPower = 2.0,
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
    cx: number,
    cy: number,
    w: number,
    h: number,
    colorHex = '#0d0918',
    alpha = 0.42,
    softness = 0.62,
  ): void {
    this.spriteTotal++;
    this.pushInstanceHex(false, cx, cy, w, h, 0, 0, 1, 1, colorHex, alpha, 0, 3, 0, softness);
  }

  /**
   * Mode 4: Procedural normal-lit beveled masonry / cliff / timber / astral facade.
   * materialKind: 0=stone masonry, 1=earth cliff strata, 2=timber/riveted lip, 3=astral rune pillar.
   */
  public drawBeveledWall(
    cx: number,
    cy: number,
    w: number,
    h: number,
    colorHex: string,
    materialKind: 0 | 1 | 2 | 3 = 0,
    alpha = 0.98,
    seed = 0,
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
    cx: number,
    cy: number,
    w: number,
    h: number,
    colorHex: string,
    alpha: number,
    dir: 0 | 1 | 2 = 0,
    power = 1.35,
  ): void {
    this.spriteTotal++;
    this.pushInstanceHex(false, cx, cy, w, h, dir, power, 1, 1, colorHex, alpha, 0, 5, 0, power);
  }

  /**
   * Zero-GC bitmap pixel text renderer using 6x8 atlas glyphs.
   * Uses paletteRow = -2 so shaders skip Auto-Sobel/normal lighting on crisp UI text.
   */
  public drawPixelText(
    text: string,
    x: number,
    y: number,
    colorHex: string,
    scale = 1,
    align: 'left' | 'center' | 'right' = 'left',
    shadowColor = '#120d1e',
    alpha = 1,
  ): void {
    if (!text || alpha <= 0.005) return;
    const atlasWithGlyphs = this.atlas as TextureAtlas & {
      getGlyphRect?: (charCode: number) => SpriteRect | undefined;
    };
    if (typeof atlasWithGlyphs.getGlyphRect !== 'function') return;

    const ctor = this.atlas.constructor as { FONT_GLYPH_W?: number; FONT_GLYPH_H?: number };
    const glyphW = ctor.FONT_GLYPH_W ?? 6;
    const glyphH = ctor.FONT_GLYPH_H ?? 8;
    const stepW = glyphW * scale;
    const drawH = glyphH * scale;
    const len = text.length;

    let totalW = 0;
    for (let i = 0; i < len; i++) {
      let ch = text.charCodeAt(i);
      if (ch >= 97 && ch <= 122) ch -= 32;
      if (atlasWithGlyphs.getGlyphRect(ch)) totalW += stepW;
    }
    if (totalW <= 0) return;

    let startX = x;
    if (align === 'center') startX = x - totalW * 0.5;
    else if (align === 'right') startX = x - totalW;

    if (shadowColor) {
      let cx = startX;
      const shadowAlpha = alpha * 0.85;
      for (let i = 0; i < len; i++) {
        let ch = text.charCodeAt(i);
        if (ch >= 97 && ch <= 122) ch -= 32;
        const rect = atlasWithGlyphs.getGlyphRect(ch);
        if (!rect) continue;
        if (ch !== 32) {
          this.spriteTotal++;
          this.pushInstanceHex(
            false,
            cx + scale,
            y + scale,
            stepW,
            drawH,
            rect.u0,
            rect.v0,
            rect.u1,
            rect.v1,
            shadowColor,
            shadowAlpha,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            -2,
            rect.page ?? 0,
            1.0,
            0.0,
            0,
          );
        }
        cx += stepW;
      }
    }

    let cx = startX;
    for (let i = 0; i < len; i++) {
      let ch = text.charCodeAt(i);
      if (ch >= 97 && ch <= 122) ch -= 32;
      const rect = atlasWithGlyphs.getGlyphRect(ch);
      if (!rect) continue;
      if (ch !== 32) {
        this.spriteTotal++;
        this.pushInstanceHex(
          false,
          cx,
          y,
          stepW,
          drawH,
          rect.u0,
          rect.v0,
          rect.u1,
          rect.v1,
          colorHex,
          alpha,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          -2,
          rect.page ?? 0,
          1.0,
          0.0,
          0,
        );
      }
      cx += stepW;
    }
  }

  /**
   * Zero-GC 3D Quad primitive emitter.
   * pass: 0 = opaque (hardware depth write + alpha cutout), 1 = alpha blend, 2 = additive blend.
   */
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
      arr = this.quad3dOpaqueItems;
      count = this.quad3dOpaqueCount;
      maxCap = MAX_QUAD3D_INSTANCES;
    } else if (pass === 1) {
      arr = this.quad3dAlphaItems;
      count = this.quad3dAlphaCount;
      maxCap = MAX_QUAD3D_BLEND_INSTANCES;
    } else {
      arr = this.quad3dAddItems;
      count = this.quad3dAddCount;
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
    if (pass === 0) this.quad3dOpaqueCount++;
    else if (pass === 1) this.quad3dAlphaCount++;
    else this.quad3dAddCount++;
    this.spriteTotal++;
  }

  public drawFloorTile3D(
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
    const rect = this.atlas.getRect(id);
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

  /**
   * Extrudes a 2D map wall tile into a crisp 3D pixel box with automatic adjacent-wall face culling.
   * neighborMask: 4-bit N/E/S/W solid wall bitmask (N=1, E=2, S=4, W=8).
   */
  public drawBox3DWall(
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
  ): void {
    const topRect = this.atlas.getRect(topId);
    const sideRect = sideId ? this.atlas.getRect(sideId) : topRect;
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
      0,
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
        0,
      );
    }

    // 3. West Left Vertical Face (-X normal, visible on right side of screen!)
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
        0,
      );
    }

    // 4. East Right Vertical Face (+X normal, visible on left side of screen!)
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
        0,
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

  /**
   * Emits an upright HD-2D pixel sprite billboard planted at (footX, footY, footZ) and tilted back by tiltDeg.
   */
  public drawBillboard3D(
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
    const rect = this.atlas.getRect(id);
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
    this.lightTotal++;
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
      falloffPower,
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

  public flush(timeSec: number): GpuFrameStats {
    this.syncAtlasIfDirty();
    if (!this.backend) {
      return this.lastStats;
    }
    this.quad3dPassData.opaqueCount = this.quad3dOpaqueCount;
    this.quad3dPassData.alphaCount = this.quad3dAlphaCount;
    this.quad3dPassData.additiveCount = this.quad3dAddCount;
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
      this.camera3dState.enabled ? this.quad3dPassData : undefined,
    );
    const frameTimeMs = performance.now() - t0;
    this.lastStats.backend = this.backend.kind;
    this.lastStats.drawCalls = drawCalls;
    this.lastStats.spriteCount = this.spriteTotal;
    this.lastStats.lightCount = Math.max(this.lightTotal, this.dynamicLightCount);
    this.lastStats.frameTimeMs = frameTimeMs;
    return this.lastStats;
  }

  public getStats(): GpuFrameStats {
    return this.lastStats;
  }

  public dispose(): void {
    this.backend?.dispose();
    this.backend = null;
  }
}
