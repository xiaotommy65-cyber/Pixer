import type { TextureAtlas } from '../../assets/TextureAtlas.ts';
import type { SpriteRect } from './GpuTypes.ts';

export interface DynamicGlyphEntry {
  rect: SpriteRect;
  advanceRatio: number;
  isWide: boolean;
}

export type GlyphRasterizerFn = (codePoint: number, outRgba: Uint8Array, size: number) => boolean;

const MAX_GLYPHS = 256;
const GLYPH_TEX_SIZE = 16;

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x2e80 &&
    !(codePoint >= 0xff61 && codePoint <= 0xff9f)
  );
}

/**
 * Bounded Zero-GC dynamic bitmap glyph cache for non-ASCII / CJK / Unicode punctuation
 * rendered via GpuEngine.drawPixelText() onto Pass 1B Texture2DArray atlas slots.
 */
export class GpuDynamicGlyphCache {
  private readonly entries = new Map<number, DynamicGlyphEntry | null>();
  private readonly rgbaScratch = new Uint8Array(GLYPH_TEX_SIZE * GLYPH_TEX_SIZE * 4);
  private readonly customRasterizer: GlyphRasterizerFn | null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private canvasAttempted = false;

  constructor(customRasterizer?: GlyphRasterizerFn) {
    this.customRasterizer = customRasterizer ?? null;
  }

  public getCachedCount(): number {
    return this.entries.size;
  }

  public resolve(codePoint: number, atlas: TextureAtlas): DynamicGlyphEntry | null {
    const cached = this.entries.get(codePoint);
    if (cached !== undefined) return cached;

    if (this.entries.size >= MAX_GLYPHS) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        const oldEntry = this.entries.get(oldestKey);
        this.entries.delete(oldestKey);
        if (oldEntry) {
          atlas.releaseDynamicSprite(`__ug_${oldestKey.toString(16)}`);
        }
      }
    }

    const ok = this.rasterizeIntoScratch(codePoint);
    if (!ok) {
      this.entries.set(codePoint, null);
      return null;
    }

    const rect = atlas.registerDynamicRgbaSprite(
      `__ug_${codePoint.toString(16)}`,
      GLYPH_TEX_SIZE,
      GLYPH_TEX_SIZE,
      this.rgbaScratch,
    );
    const wide = isWideCodePoint(codePoint);
    const entry: DynamicGlyphEntry = {
      rect,
      advanceRatio: wide ? 1.45 : 0.9,
      isWide: wide,
    };
    this.entries.set(codePoint, entry);
    return entry;
  }

  private ensureCanvasContext(): CanvasRenderingContext2D | null {
    if (this.ctx) return this.ctx;
    if (this.canvasAttempted) return null;
    this.canvasAttempted = true;
    if (typeof document === 'undefined') return null;

    const canvas = document.createElement('canvas');
    canvas.width = GLYPH_TEX_SIZE;
    canvas.height = GLYPH_TEX_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    this.canvas = canvas;
    this.ctx = ctx;
    return ctx;
  }

  private rasterizeIntoScratch(codePoint: number): boolean {
    this.rgbaScratch.fill(0);
    if (this.customRasterizer) {
      return this.customRasterizer(codePoint, this.rgbaScratch, GLYPH_TEX_SIZE);
    }

    const ctx = this.ensureCanvasContext();
    if (!ctx) return false;

    const ch = String.fromCodePoint(codePoint);
    ctx.clearRect(0, 0, GLYPH_TEX_SIZE, GLYPH_TEX_SIZE);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, GLYPH_TEX_SIZE * 0.5, GLYPH_TEX_SIZE * 0.54);

    const img = ctx.getImageData(0, 0, GLYPH_TEX_SIZE, GLYPH_TEX_SIZE).data;
    let hasInk = false;
    const pixelCount = GLYPH_TEX_SIZE * GLYPH_TEX_SIZE;
    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      const a = img[o + 3] ?? 0;
      if (a < 40) continue;
      hasInk = true;
      this.rgbaScratch[o] = 255;
      this.rgbaScratch[o + 1] = 255;
      this.rgbaScratch[o + 2] = 255;
      this.rgbaScratch[o + 3] = a >= 96 ? 255 : Math.min(255, Math.round(a * 1.8));
    }
    return hasInk;
  }

  public dispose(): void {
    this.entries.clear();
    this.ctx = null;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.canvas = null;
    }
  }
}
