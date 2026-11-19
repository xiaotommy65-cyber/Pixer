import type { TextureAtlas } from '../assets/TextureAtlas.ts';

const PARALLAX_BG_URL = './assets/engine4/parallax_twilight_mountains.png';
const HERO_SHEET_URL = './assets/engine4/hero_32x32_sheet.png';

const HERO32_FRAME_IDS = [
  'hero32_idle_a',
  'hero32_idle_b',
  'hero32_run_0',
  'hero32_run_1',
  'hero32_run_2',
  'hero32_run_3',
  'hero32_jump',
  'hero32_dash',
] as const;

type Scratch2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createScratch2dContext(width: number, height: number): Scratch2DContext | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const oc = new OffscreenCanvas(width, height);
      const ctx = oc.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        return ctx;
      }
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        return ctx;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchImageBitmap(url: string): Promise<ImageBitmap | null> {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') {
    return null;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * Loads optional Engine 4.0 RGBA art pack PNGs in browser contexts and upgrades
 * matching TextureAtlas sprites dynamically. Missing or unreachable assets fail silently.
 */
export async function loadEngine4ArtPack(
  atlas: TextureAtlas,
  onUpdated?: () => void,
): Promise<void> {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') {
    return;
  }

  let updated = false;
  const [bgBitmap, heroBitmap] = await Promise.all([
    fetchImageBitmap(PARALLAX_BG_URL),
    fetchImageBitmap(HERO_SHEET_URL),
  ]);

  if (bgBitmap) {
    try {
      const ctx = createScratch2dContext(480, 180);
      if (ctx) {
        ctx.clearRect(0, 0, 480, 180);
        ctx.drawImage(bgBitmap, 0, 0, 480, 180);
        const img = ctx.getImageData(0, 0, 480, 180);
        atlas.registerDynamicRgbaSprite('parallax_twilight_bg', 480, 180, new Uint8Array(img.data));
        updated = true;
      }
    } catch {
      // Optional asset decode failed silently
    } finally {
      bgBitmap.close?.();
    }
  }

  if (heroBitmap) {
    try {
      const ctx = createScratch2dContext(32, 32);
      if (ctx) {
        const frameCount = HERO32_FRAME_IDS.length;
        const srcFrameW = Math.max(1, heroBitmap.width / frameCount);
        const srcFrameH = Math.max(1, heroBitmap.height);
        for (let i = 0; i < frameCount; i++) {
          ctx.clearRect(0, 0, 32, 32);
          ctx.drawImage(heroBitmap, i * srcFrameW, 0, srcFrameW, srcFrameH, 0, 0, 32, 32);
          const img = ctx.getImageData(0, 0, 32, 32);
          atlas.registerDynamicRgbaSprite(HERO32_FRAME_IDS[i], 32, 32, new Uint8Array(img.data));
        }
        updated = true;
      }
    } catch {
      // Optional asset decode failed silently
    } finally {
      heroBitmap.close?.();
    }
  }

  if (updated) {
    onUpdated?.();
  }
}
