import { TextureAtlas, type SpriteId } from '../../assets/TextureAtlas.ts';
import { mixOklabRgb01 } from '../math/ColorMath.ts';
import { appLogger } from '../runtime/AppLogger.ts';
import { Canvas2DBackend } from './Canvas2DBackend.ts';
import {
  FLOATS_PER_INSTANCE,
  MAX_INSTANCES_PER_PASS,
  type GpuBackendKind,
  type GpuFrameStats,
  type IGpuBackend,
  type SkyGradient,
} from './GpuTypes.ts';
import { WebGl2Backend } from './WebGl2Backend.ts';
import { WebGpuBackend } from './WebGpuBackend.ts';

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
    this.viewW = Math.max(160, Math.min(640, Math.round(width)));
    this.viewH = Math.max(120, Math.min(360, Math.round(height)));
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
    this.alphaCount = 0;
    this.addCount = 0;
    this.spriteTotal = 0;
    this.lightTotal = 0;
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
    );
    const frameTimeMs = performance.now() - t0;
    this.lastStats.backend = this.backend.kind;
    this.lastStats.drawCalls = drawCalls;
    this.lastStats.spriteCount = this.spriteTotal;
    this.lastStats.lightCount = this.lightTotal;
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
