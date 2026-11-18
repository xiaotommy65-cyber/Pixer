import { appLogger } from '../runtime/AppLogger.ts';
import {
  FLOATS_PER_INSTANCE,
  GAME_H,
  GAME_W,
  MAX_INSTANCES_PER_PASS,
  type IGpuBackend,
  type SkyGradient,
} from './GpuTypes.ts';

function rgbCss(r: number, g: number, b: number, a = 1): string {
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)));
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)));
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)));
  return a >= 0.999 ? `rgb(${ri},${gi},${bi})` : `rgba(${ri},${gi},${bi},${a.toFixed(3)})`;
}

/**
 * Software 2D Canvas fallback backend implementing IGpuBackend.
 * Ensures 100% visual output even when WebGPU and WebGL2 contexts fail, get blocked, or are lost.
 */
export class Canvas2DBackend implements IGpuBackend {
  public readonly kind = 'canvas2d' as const;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly atlasCtx: CanvasRenderingContext2D;
  private readonly scratchCanvas: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;
  private atlasWidth = 512;
  private atlasHeight = 512;

  private constructor(
    ctx: CanvasRenderingContext2D,
    atlasCanvas: HTMLCanvasElement,
    atlasCtx: CanvasRenderingContext2D,
    scratchCanvas: HTMLCanvasElement,
    scratchCtx: CanvasRenderingContext2D,
    atlasWidth: number,
    atlasHeight: number,
    initialPixels: Uint8Array,
  ) {
    this.ctx = ctx;
    this.atlasCanvas = atlasCanvas;
    this.atlasCtx = atlasCtx;
    this.scratchCanvas = scratchCanvas;
    this.scratchCtx = scratchCtx;
    this.uploadAtlas(atlasWidth, atlasHeight, initialPixels);
  }

  public static tryCreate(
    canvas: HTMLCanvasElement,
    atlasWidth: number,
    atlasHeight: number,
    initialPixels: Uint8Array,
  ): Canvas2DBackend | null {
    try {
      const ctx = canvas.getContext('2d', { alpha: false });
      const doc = canvas.ownerDocument;
      if (!ctx || !doc) return null;

      const atlasCanvas = doc.createElement('canvas');
      atlasCanvas.width = atlasWidth;
      atlasCanvas.height = atlasHeight;
      const atlasCtx = atlasCanvas.getContext('2d');
      if (!atlasCtx) return null;

      const scratchCanvas = doc.createElement('canvas');
      scratchCanvas.width = 64;
      scratchCanvas.height = 64;
      const scratchCtx = scratchCanvas.getContext('2d');
      if (!scratchCtx) return null;

      return new Canvas2DBackend(
        ctx,
        atlasCanvas,
        atlasCtx,
        scratchCanvas,
        scratchCtx,
        atlasWidth,
        atlasHeight,
        initialPixels,
      );
    } catch (err) {
      appLogger.error('gpu', 'canvas2d.tryCreate', '無法建立 Canvas 2D 保底渲染環境', err);
      return null;
    }
  }

  public uploadAtlas(
    width: number,
    height: number,
    pixels: Uint8Array,
    _indexPixels?: Uint8Array,
    _paletteLut?: Uint8Array,
    _paletteRows?: number,
  ): void {
    this.atlasWidth = width;
    this.atlasHeight = height;
    if (this.atlasCanvas.width !== width || this.atlasCanvas.height !== height) {
      this.atlasCanvas.width = width;
      this.atlasCanvas.height = height;
    }
    const img = this.atlasCtx.createImageData(width, height);
    img.data.set(pixels);
    this.atlasCtx.putImageData(img, 0, 0);
  }

  public resize(_pixelWidth: number, _pixelHeight: number): void {
    // Scaled dynamically via ctx.canvas.width/height each frame
  }

  public renderFrame(
    sky: SkyGradient,
    alphaItems: Float32Array,
    alphaCount: number,
    additiveItems: Float32Array,
    additiveCount: number,
  ): number {
    const ctx = this.ctx;
    const cw = Math.max(1, ctx.canvas.width);
    const ch = Math.max(1, ctx.canvas.height);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;

    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, rgbCss(sky.top[0], sky.top[1], sky.top[2]));
    grad.addColorStop(1, rgbCss(sky.bottom[0], sky.bottom[1], sky.bottom[2]));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    const vw = Math.max(1, sky.viewW ?? GAME_W);
    const vh = Math.max(1, sky.viewH ?? GAME_H);
    ctx.scale(cw / vw, ch / vh);
    const fx = sky.camFracX ?? 0;
    const fy = sky.camFracY ?? 0;
    if (fx !== 0 || fy !== 0) {
      ctx.translate(-fx, -fy);
    }

    let drawCalls = 1;
    const safeAlpha = Math.min(alphaCount, MAX_INSTANCES_PER_PASS);
    if (safeAlpha > 0) {
      ctx.globalCompositeOperation = 'source-over';
      this.drawBatch(ctx, alphaItems, safeAlpha);
      drawCalls++;
    }

    const safeAdd = Math.min(additiveCount, MAX_INSTANCES_PER_PASS);
    if (safeAdd > 0) {
      ctx.globalCompositeOperation = 'lighter';
      this.drawBatch(ctx, additiveItems, safeAdd);
      drawCalls++;
    }

    ctx.restore();
    return drawCalls;
  }

  private drawBatch(ctx: CanvasRenderingContext2D, items: Float32Array, count: number): void {
    for (let i = 0; i < count; i++) {
      const b = i * FLOATS_PER_INSTANCE;
      const cx = items[b];
      const cy = items[b + 1];
      const w = items[b + 2];
      const h = items[b + 3];
      const u0 = items[b + 4];
      const v0 = items[b + 5];
      const u1 = items[b + 6];
      const v1 = items[b + 7];
      const r = items[b + 8];
      const g = items[b + 9];
      const bl = items[b + 10];
      const a = items[b + 11];
      const rot = items[b + 12];
      const mode = items[b + 13];
      const flash = items[b + 14];
      const param = items[b + 15];
      const pivotX = items[b + 16];
      const pivotY = items[b + 17];
      const skewX = items[b + 18];

      if (a <= 0.005 || w <= 0 || h <= 0) continue;

      ctx.save();
      ctx.translate(cx, cy);
      if (rot !== 0) ctx.rotate(rot);
      if (skewX !== 0) ctx.transform(1, 0, -skewX, 1, 0, 0);
      if (pivotX !== 0.5 || pivotY !== 0.5) {
        ctx.translate((0.5 - pivotX) * w, (0.5 - pivotY) * h);
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, a));

      if (mode > 4.5) {
        this.drawGradientQuad(ctx, w, h, u0, r, g, bl);
      } else if (mode > 3.5) {
        this.drawBeveledWallQuad(ctx, w, h, r, g, bl);
      } else if (mode > 2.5) {
        this.drawSoftShadowQuad(ctx, w, h, r, g, bl);
      } else if (mode > 1.5) {
        ctx.fillStyle = flash > 0.5 ? '#ffffff' : rgbCss(r, g, bl);
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      } else if (mode > 0.5) {
        this.drawLightOrGlint(ctx, w, h, r, g, bl, param >= 9.5);
      } else {
        this.drawAtlasSprite(ctx, w, h, u0, v0, u1, v1, r, g, bl, flash);
      }

      ctx.restore();
    }
  }

  private drawGradientQuad(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dir: number,
    r: number,
    g: number,
    bl: number,
  ): void {
    const col = rgbCss(r, g, bl, 0.85);
    const trans = rgbCss(r, g, bl, 0);
    if (dir < 0.5) {
      const grad = ctx.createLinearGradient(0, -h * 0.5, 0, h * 0.5);
      grad.addColorStop(0, col);
      grad.addColorStop(1, trans);
      ctx.fillStyle = grad;
    } else if (dir < 1.5) {
      const grad = ctx.createLinearGradient(0, h * 0.5, 0, -h * 0.5);
      grad.addColorStop(0, col);
      grad.addColorStop(1, trans);
      ctx.fillStyle = grad;
    } else {
      const rad = Math.max(w, h) * 0.65;
      const grad = ctx.createRadialGradient(0, 0, rad * 0.25, 0, 0, rad);
      grad.addColorStop(0, trans);
      grad.addColorStop(1, col);
      ctx.fillStyle = grad;
    }
    ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
  }

  private drawBeveledWallQuad(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    r: number,
    g: number,
    bl: number,
  ): void {
    ctx.fillStyle = rgbCss(r * 0.82, g * 0.82, bl * 0.82);
    ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-w * 0.5, -h * 0.5, w, Math.min(2, h * 0.2));
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.fillRect(-w * 0.5, h * 0.5 - Math.min(2, h * 0.2), w, Math.min(2, h * 0.2));
  }

  private drawSoftShadowQuad(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    r: number,
    g: number,
    bl: number,
  ): void {
    ctx.fillStyle = rgbCss(r, g, bl, 0.72);
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.48, h * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawLightOrGlint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    r: number,
    g: number,
    bl: number,
    isStar: boolean,
  ): void {
    const rad = Math.max(1, Math.min(w, h) * 0.5);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    grad.addColorStop(0, rgbCss(r, g, bl, 0.95));
    grad.addColorStop(1, rgbCss(r, g, bl, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    if (isStar) {
      ctx.fillStyle = rgbCss(r, g, bl, 0.85);
      ctx.fillRect(-w * 0.4, -0.6, w * 0.8, 1.2);
      ctx.fillRect(-0.6, -h * 0.4, 1.2, h * 0.8);
    }
  }

  private drawAtlasSprite(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    r: number,
    g: number,
    bl: number,
    flash: number,
  ): void {
    const flipX = u0 > u1;
    const minU = Math.min(u0, u1);
    const maxU = Math.max(u0, u1);
    const sx = Math.max(0, Math.floor(minU * this.atlasWidth));
    const sy = Math.max(0, Math.floor(v0 * this.atlasHeight));
    const sw = Math.max(1, Math.round((maxU - minU) * this.atlasWidth));
    const sh = Math.max(1, Math.round((v1 - v0) * this.atlasHeight));

    if (flipX) ctx.scale(-1, 1);

    const needsTint = r < 0.98 || g < 0.98 || bl < 0.98 || flash > 0.05;
    if (needsTint && sw <= 64 && sh <= 64) {
      const sctx = this.scratchCtx;
      sctx.clearRect(0, 0, sw, sh);
      sctx.globalCompositeOperation = 'source-over';
      sctx.imageSmoothingEnabled = false;
      sctx.drawImage(this.atlasCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      sctx.globalCompositeOperation = 'source-atop';
      if (flash > 0.05) {
        sctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash).toFixed(2)})`;
      } else {
        sctx.fillStyle = rgbCss(r, g, bl, 0.55);
      }
      sctx.fillRect(0, 0, sw, sh);
      sctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.scratchCanvas, 0, 0, sw, sh, -w * 0.5, -h * 0.5, w, h);
    } else {
      ctx.drawImage(this.atlasCanvas, sx, sy, sw, sh, -w * 0.5, -h * 0.5, w, h);
    }
  }

  public dispose(): void {
    this.atlasCanvas.width = 0;
    this.scratchCanvas.width = 0;
  }
}
