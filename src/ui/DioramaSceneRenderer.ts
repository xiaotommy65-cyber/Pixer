import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import { hash2i, simplex2D } from '../core/math/NoiseMath.ts';
import {
  DIORAMA_BAYER_4X4,
  DIORAMA_CANVAS_H,
  DIORAMA_CANVAS_W,
  mixDioramaHex,
  type DioramaCameoVisitor,
  type DioramaTimeKeyframe,
} from './DioramaPalette.ts';
import { atlasSpriteToCanvas } from './MomoMascot.ts';

export interface DioramaRenderFrame {
  ctx: CanvasRenderingContext2D;
  atlas: TextureAtlas;
  hour: number;
  elapsedSec: number;
  momoHappyTimer: number;
  palette: DioramaTimeKeyframe;
  farHeights: Int16Array;
  midHeights: Int16Array;
  groundHeights: Int16Array;
  visitors: readonly DioramaCameoVisitor[];
}

/** Draws a soft multi-tone Japanese anime pixel cumulus cloud (no harsh black outlines). */
function drawPixelCumulus(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  topHex: string,
  midHex: string,
  shadeHex: string,
): void {
  const s = Math.max(1, Math.round(scale));
  ctx.fillStyle = shadeHex;
  ctx.fillRect(cx - 18 * s, cy + 3 * s, 36 * s, 4 * s);
  ctx.fillRect(cx - 22 * s, cy + 5 * s, 44 * s, 2 * s);
  ctx.fillStyle = midHex;
  ctx.fillRect(cx - 20 * s, cy + 1 * s, 40 * s, 4 * s);
  ctx.fillRect(cx - 14 * s, cy - 3 * s, 28 * s, 5 * s);
  ctx.fillRect(cx - 8 * s, cy - 6 * s, 18 * s, 4 * s);
  ctx.fillStyle = topHex;
  ctx.fillRect(cx - 6 * s, cy - 7 * s, 14 * s, 3 * s);
  ctx.fillRect(cx - 13 * s, cy - 4 * s, 24 * s, 3 * s);
  ctx.fillRect(cx - 19 * s, cy - 1 * s, 12 * s, 2 * s);
  ctx.fillRect(cx + 8 * s, cy - 1 * s, 10 * s, 2 * s);
}

/** Draws a lush Japanese pixel Sakura / Cedar tree with layered blossom clusters and trunk. */
function drawPixelSakuraTree(
  ctx: CanvasRenderingContext2D,
  tx: number,
  groundY: number,
  lightHex: string,
  midHex: string,
  shadeHex: string,
  isSakura: boolean,
): void {
  ctx.fillStyle = '#3b2318';
  ctx.fillRect(tx - 2, groundY - 14, 5, 14);
  ctx.fillRect(tx - 4, groundY - 2, 9, 2);
  ctx.fillStyle = '#5c3826';
  ctx.fillRect(tx - 1, groundY - 13, 2, 12);
  ctx.fillRect(tx - 5, groundY - 15, 4, 2);
  ctx.fillRect(tx + 2, groundY - 14, 4, 2);

  const cLight = isSakura ? lightHex : '#8ae0a0';
  const cMid = isSakura ? midHex : '#48ad72';
  const cShade = isSakura ? shadeHex : '#266347';

  ctx.fillStyle = cShade;
  ctx.fillRect(tx - 13, groundY - 19, 26, 7);
  ctx.fillRect(tx - 10, groundY - 25, 20, 7);
  ctx.fillStyle = cMid;
  ctx.fillRect(tx - 12, groundY - 22, 24, 7);
  ctx.fillRect(tx - 9, groundY - 28, 18, 7);
  ctx.fillRect(tx - 5, groundY - 31, 10, 4);
  ctx.fillStyle = cLight;
  ctx.fillRect(tx - 7, groundY - 30, 12, 3);
  ctx.fillRect(tx - 11, groundY - 24, 9, 3);
  ctx.fillRect(tx + 2, groundY - 25, 8, 3);
  ctx.fillRect(tx - 13, groundY - 21, 2, 1);
  ctx.fillRect(tx + 11, groundY - 22, 2, 1);
}

/** Draws organic rounded overhanging Sakura boughs framing top eaves (natural repoussoir). */
function drawOverhangingSakuraBough(
  ctx: CanvasRenderingContext2D,
  side: 'left' | 'right',
  lightHex: string,
  midHex: string,
  shadeHex: string,
  t: number,
): void {
  const dir = side === 'left' ? 1 : -1;
  const ox = side === 'left' ? 10 : DIORAMA_CANVAS_W - 10;
  const xAt = (dx: number, w = 1): number => (side === 'left' ? ox + dx : ox - dx - w);

  ctx.fillStyle = '#3b2318';
  ctx.fillRect(xAt(0, 38), 11, 38, 3);
  ctx.fillRect(xAt(32, 28), 15, 28, 2);
  ctx.fillRect(xAt(56, 18), 19, 18, 2);
  ctx.fillStyle = '#5c3826';
  ctx.fillRect(xAt(2, 34), 12, 34, 1);
  ctx.fillRect(xAt(34, 24), 16, 24, 1);

  const clusters: readonly [number, number, number, number][] =
    side === 'left'
      ? [
          [2, 7, 26, 11],
          [24, 9, 22, 11],
          [44, 13, 20, 10],
          [62, 16, 16, 9],
          [12, 17, 16, 10],
          [36, 20, 13, 9],
        ]
      : [
          [2, 7, 24, 11],
          [22, 9, 20, 10],
          [40, 12, 18, 10],
          [56, 16, 14, 9],
          [14, 17, 15, 9],
          [34, 20, 12, 8],
        ];

  for (let i = 0; i < clusters.length; i++) {
    const [dx, y, w, h] = clusters[i];
    ctx.fillStyle = shadeHex;
    ctx.fillRect(xAt(dx + 2, w - 4), y + 2, w - 4, h);
    ctx.fillRect(xAt(dx, w), y + 4, w, Math.max(3, h - 4));

    ctx.fillStyle = midHex;
    ctx.fillRect(xAt(dx + 2, w - 4), y, w - 4, Math.max(4, h - 2));
    ctx.fillRect(xAt(dx + 1, w - 2), y + 2, w - 2, Math.max(3, h - 4));

    ctx.fillStyle = lightHex;
    const hiW = Math.max(4, w - 8);
    ctx.fillRect(xAt(dx + 4, hiW), y + 1, hiW, 2);
    ctx.fillRect(xAt(dx + 6, Math.max(2, hiW - 4)), y, Math.max(2, hiW - 4), 1);

    const sway = Math.round(Math.sin(t * 1.4 + i * 0.9 + dir) * 0.7);
    ctx.fillRect(xAt(dx + (w >> 1) + sway, 2), y + h + 1, 2, 2);
    ctx.fillRect(xAt(dx + (w >> 2) - sway, 1), y + h + 3, 1, 2);
  }
}

/**
 * Verbatim 480x270 Japanese Pixel-Art Veranda & Fantasy Console Atelier Backdrop Renderer.
 * Pure canvas rendering separated from DOM/event lifecycle so pixel art remains pixel-identical across refactors.
 */
export function renderDioramaCanvas(frame: DioramaRenderFrame): void {
  const { ctx, atlas, hour: h, elapsedSec: t, momoHappyTimer, palette: pal, farHeights, midHeights, groundHeights, visitors } = frame;
  ctx.imageSmoothingEnabled = false;

  const skyHorizonY = 98;
  // 1. 28-Band Bayer-Dithered Japanese Anime Sky (skyTop -> skyMid -> skyBottom)
  const bandCount = 28;
  const bandH = Math.ceil(skyHorizonY / bandCount);
  const sampleSkyBand = (frac: number): string => {
    if (frac < 0.55) return mixDioramaHex(pal.skyTop, pal.skyMid, frac / 0.55);
    return mixDioramaHex(pal.skyMid, pal.skyBottom, (frac - 0.55) / 0.45);
  };

  for (let b = 0; b < bandCount; b++) {
    const frac = b / (bandCount - 1);
    ctx.fillStyle = sampleSkyBand(frac);
    ctx.fillRect(0, b * bandH, DIORAMA_CANVAS_W, bandH + 1);
    if (b < bandCount - 1) {
      ctx.fillStyle = sampleSkyBand((b + 1) / (bandCount - 1));
      const seamY = (b + 1) * bandH - 1;
      for (let x = 0; x < DIORAMA_CANVAS_W; x += 1) {
        if (DIORAMA_BAYER_4X4[((seamY & 3) << 2) | (x & 3)] < 6) {
          ctx.fillRect(x, seamY, 1, 1);
        }
      }
    }
  }

  // 2. Stars, Milky Way Stardust & Shooting Star (Dusk/Night)
  if (pal.starAlpha > 0.05) {
    for (let i = 0; i < 64; i++) {
      const sx = Math.floor(hash2i(i, 3, 91) * DIORAMA_CANVAS_W);
      const sy = Math.floor(hash2i(i, 7, 91) * 62) + 12;
      const twinkle = 0.4 + 0.6 * Math.sin(t * (1.6 + (i % 5) * 0.5) + i * 1.3);
      ctx.globalAlpha = pal.starAlpha * twinkle;
      ctx.fillStyle = i % 6 === 0 ? '#ffd88a' : i % 4 === 0 ? '#bfe6ff' : '#fffaf0';
      ctx.fillRect(sx, sy, 1, 1);
      if (i % 11 === 0 && twinkle > 0.78) {
        ctx.fillRect(sx - 1, sy, 3, 1);
        ctx.fillRect(sx, sy - 1, 1, 3);
      }
    }
    const meteorCycle = (t * 0.45) % 4.0;
    if (pal.starAlpha > 0.45 && meteorCycle < 0.35) {
      const prog = meteorCycle / 0.35;
      const mx = Math.round(330 - prog * 95);
      const my = Math.round(18 + prog * 28);
      ctx.globalAlpha = pal.starAlpha * (1 - prog);
      ctx.fillStyle = '#fffaf0';
      for (let k = 0; k < 10; k++) {
        ctx.fillRect(mx + k * 2, my - k, 2, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // 3. Sun or Crescent Moon Disc
  let celestialX = 108;
  let celestialY = 30;
  if (h >= 6 && h <= 18.5) {
    const dayFrac = (h - 6) / 12.5;
    celestialX = Math.round(92 + dayFrac * 168);
    celestialY = Math.round(52 - Math.sin(dayFrac * Math.PI) * 24);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = pal.warmTint;
    ctx.fillRect(celestialX - 12, celestialY - 8, 24, 16);
    ctx.fillRect(celestialX - 8, celestialY - 12, 16, 24);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#fff7d6';
    ctx.fillRect(celestialX - 6, celestialY - 4, 12, 8);
    ctx.fillRect(celestialX - 4, celestialY - 6, 8, 12);
    ctx.fillStyle = '#ffe270';
    ctx.fillRect(celestialX - 4, celestialY - 4, 8, 8);
    ctx.globalAlpha = 1;
  } else {
    celestialX = 108;
    celestialY = 30;
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#dceeff';
    ctx.fillRect(celestialX - 10, celestialY - 7, 20, 14);
    ctx.fillRect(celestialX - 7, celestialY - 10, 14, 20);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff5cc';
    ctx.fillRect(celestialX - 5, celestialY - 6, 10, 12);
    ctx.fillRect(celestialX - 6, celestialY - 4, 12, 8);
    ctx.fillStyle = sampleSkyBand(celestialY / skyHorizonY);
    ctx.fillRect(celestialX - 1, celestialY - 5, 6, 8);
    ctx.fillRect(celestialX + 1, celestialY - 6, 5, 10);
  }

  // 4. Multi-Tone Japanese Pixel Cumulus Clouds
  const cloudTop = h >= 19 || h < 5.5 ? '#7c8db5' : '#fffaf2';
  const cloudMid = h >= 19 || h < 5.5 ? '#4c5b82' : mixDioramaHex('#fffaf2', pal.skyBottom, 0.45);
  const cloudShade = h >= 19 || h < 5.5 ? '#2d3859' : mixDioramaHex(pal.skyMid, pal.farHill, 0.38);
  const baseCloudAlpha = h >= 19 || h < 5.5 ? 0.55 : 0.92;
  for (let c = 0; c < 4; c++) {
    const cx = Math.round(((248 + c * 124 + t * (1.5 + c * 0.35)) % (DIORAMA_CANVAS_W + 96)) - 48);
    const cy = 22 + (c % 2) * 14;
    const distToFuji = Math.abs(cx - 160);
    if (distToFuji < 58 && cy > 20) continue;
    ctx.globalAlpha = distToFuji < 78 ? baseCloudAlpha * ((distToFuji - 58) / 20) : baseCloudAlpha;
    drawPixelCumulus(ctx, cx, cy, c % 2 === 0 ? 1 : 2, cloudTop, cloudMid, cloudShade);
  }
  ctx.globalAlpha = 1;

  // 5. Mt. Fuji + Distant Ridge Silhouette
  for (let x = 0; x < DIORAMA_CANVAS_W; x++) {
    const y = farHeights[x];
    const dxFuji = Math.abs(x - 160);
    const isFuji = dxFuji < 68 && y < 78;
    ctx.fillStyle = isFuji ? pal.fujiBody : pal.farHill;
    ctx.fillRect(x, y, 1, skyHorizonY - y);

    if (isFuji && dxFuji < 24) {
      const snowDepth = Math.round(11 - dxFuji * 0.38 + ((x * 7) % 3));
      if (snowDepth > 0) {
        ctx.fillStyle = pal.fujiSnow;
        ctx.fillRect(x, y, 1, snowDepth);
        if (DIORAMA_BAYER_4X4[((y + snowDepth) & 3) * 4 + (x & 3)] < 8) {
          ctx.fillRect(x, y + snowDepth, 1, 2);
        }
      }
    }
  }

  // Smooth Oklab Atmospheric Haze across Mt. Fuji foothills
  const seamHaze = mixDioramaHex(pal.fujiBody, pal.skyBottom, 0.14);
  for (let hy = 74; hy <= 82; hy++) {
    const hFrac = ((hy - 74) / 8) * 0.52;
    ctx.fillStyle = mixDioramaHex(pal.fujiBody, pal.skyBottom, hFrac);
    for (let mx = 76; mx <= 248; mx++) {
      if (farHeights[mx] <= hy) {
        ctx.fillRect(mx, hy, 1, 1);
      }
    }
  }
  ctx.fillStyle = seamHaze;
  for (let mx = 76; mx <= 248; mx++) {
    if (farHeights[mx] <= 73 && DIORAMA_BAYER_4X4[((73 & 3) << 2) | (mx & 3)] < 6) {
      ctx.fillRect(mx, 73, 1, 1);
    }
    if (farHeights[mx] <= 74 && DIORAMA_BAYER_4X4[((74 & 3) << 2) | (mx & 3)] < 10) {
      ctx.fillRect(mx, 74, 1, 1);
    }
  }

  // Ukiyo-e horizontal cloud wisp
  ctx.fillStyle = h >= 19 || h < 5.5 ? '#5b6f9c' : '#fff7eb';
  ctx.globalAlpha = h >= 19 || h < 5.5 ? 0.42 : 0.76;
  ctx.fillRect(196, 54, 34, 2);
  ctx.fillRect(190, 56, 46, 2);
  ctx.fillRect(202, 58, 34, 1);
  ctx.globalAlpha = 1;

  // Sky flyers from cartridges behind mid hills
  for (let i = 0; i < visitors.length; i++) {
    const v = visitors[i];
    if (v.kind !== 'flyer') continue;
    const spr = atlasSpriteToCanvas(atlas, v.spriteB && Math.floor(t * 4 + v.phase) % 2 === 1 ? v.spriteB : v.spriteA);
    const fy = Math.round(v.baseY - 8 + Math.sin(t * 2.1 + v.phase) * 4);
    ctx.save();
    ctx.translate(Math.round(v.x) + 8, fy + 8);
    if (v.vx < 0) ctx.scale(-1, 1);
    ctx.drawImage(spr, -8, -8, 16, 16);
    ctx.restore();
  }

  // 6. Shimmering Pixel Lake Bay
  const lakeTopY = 82;
  const lakeBotY = 110;
  for (let ly = lakeTopY; ly < lakeBotY; ly++) {
    const wf = (ly - lakeTopY) / (lakeBotY - lakeTopY);
    ctx.fillStyle = mixDioramaHex(pal.waterTop, pal.waterBot, wf);
    ctx.fillRect(74, ly, 184, 1);
  }
  ctx.fillStyle = pal.warmTint;
  ctx.globalAlpha = 0.58;
  for (let wy = lakeTopY + 2; wy < lakeBotY - 3; wy += 2) {
    const waveShift = Math.round(Math.sin(t * 3.2 + wy * 0.7) * 4);
    const wLen = Math.max(3, 14 - Math.floor((wy - lakeTopY) * 0.35));
    ctx.fillRect(celestialX - (wLen >> 1) + waveShift, wy, wLen, 1);
  }
  ctx.globalAlpha = 1;

  // 7. Mid-Ground Japanese Hillside, Five-Story Pagoda, Vermilion Torii & Town Lights
  const midRim = mixDioramaHex(pal.midHill, pal.warmTint, 0.2);
  for (let x = 0; x < DIORAMA_CANVAS_W; x++) {
    const y = midHeights[x];
    if (y < lakeBotY) {
      ctx.fillStyle = pal.midHill;
      ctx.fillRect(x, y, 1, lakeBotY - y);
      ctx.fillStyle = midRim;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  // Vermilion Torii Gate
  const toriiX = 276;
  const toriiY = midHeights[toriiX] - 11;
  ctx.fillStyle = '#d93b48';
  ctx.fillRect(toriiX - 7, toriiY, 15, 2);
  ctx.fillRect(toriiX - 8, toriiY - 1, 2, 1);
  ctx.fillRect(toriiX + 7, toriiY - 1, 2, 1);
  ctx.fillRect(toriiX - 5, toriiY + 3, 11, 1);
  ctx.fillRect(toriiX - 4, toriiY + 1, 2, 11);
  ctx.fillRect(toriiX + 3, toriiY + 1, 2, 11);

  // Five-Story Pagoda silhouette
  const pagX = 352;
  const pagBaseY = midHeights[pagX];
  ctx.fillStyle = mixDioramaHex(pal.midHill, '#141224', 0.55);
  ctx.fillRect(pagX, pagBaseY - 30, 1, 6);
  for (let tier = 0; tier < 4; tier++) {
    const ty = pagBaseY - 24 + tier * 6;
    const tw = 7 + tier * 2;
    ctx.fillRect(pagX - (tw >> 1), ty, tw, 2);
    ctx.fillRect(pagX - ((tw - 3) >> 1), ty + 2, tw - 3, 4);
  }

  // Distant Japanese Machiya Town Windows
  if (pal.fireIntensity > 0.2) {
    ctx.fillStyle = '#ffd466';
    for (let w = 0; w < 14; w++) {
      const wx = 298 + w * 9;
      const wy = midHeights[wx] + 2 + (w % 3) * 3;
      if (wy < 104 && (w + Math.floor(t * 0.5)) % 5 !== 0) {
        ctx.globalAlpha = 0.55 + 0.35 * pal.fireIntensity;
        ctx.fillRect(wx, wy, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Nostalgic Japanese Utility Pole & Catenary Power Lines
  const poleX = 84;
  const poleColor = mixDioramaHex(pal.midHill, '#161222', 0.65);
  ctx.fillStyle = poleColor;
  ctx.fillRect(poleX, 36, 2, 72);
  ctx.fillRect(poleX - 5, 40, 12, 1);
  ctx.fillRect(poleX - 4, 45, 10, 1);
  ctx.fillRect(poleX + 2, 51, 3, 4);
  ctx.globalAlpha = 0.45;
  for (let x = 10; x <= poleX; x++) {
    const sag = Math.round(Math.sin(((x - 10) / (poleX - 10)) * Math.PI) * 5);
    ctx.fillRect(x, 40 + sag, 1, 1);
    ctx.fillRect(x, 45 + sag, 1, 1);
  }
  ctx.globalAlpha = 1;

  // 8. Foreground Engawa Garden Meadow
  const grassRim = mixDioramaHex(pal.nearGrass, '#7ee09c', 0.26);
  for (let x = 0; x < DIORAMA_CANVAS_W; x++) {
    const y = groundHeights[x];
    ctx.fillStyle = pal.nearGrass;
    ctx.fillRect(x, y, 1, DIORAMA_CANVAS_H - y);
    ctx.fillStyle = grassRim;
    ctx.fillRect(x, y, 1, 1);
    if ((x & 3) === 0) ctx.fillRect(x, y - 1, 1, 1);
  }

  // Pixel Sakura & Cedar Trees
  drawPixelSakuraTree(ctx, 42, groundHeights[42] + 2, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, false);
  drawPixelSakuraTree(ctx, 78, groundHeights[78] + 2, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, true);
  drawPixelSakuraTree(ctx, 388, groundHeights[388] + 2, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, true);
  drawPixelSakuraTree(ctx, 442, groundHeights[442] + 3, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, false);

  // Japanese Stone Lantern
  const lanX = 302;
  const lanY = groundHeights[lanX] - 13;
  ctx.fillStyle = '#6c768c';
  ctx.fillRect(lanX - 3, lanY + 11, 7, 2);
  ctx.fillRect(lanX - 1, lanY + 6, 3, 5);
  ctx.fillRect(lanX - 3, lanY + 2, 7, 4);
  ctx.fillRect(lanX - 5, lanY, 11, 2);
  ctx.fillRect(lanX - 1, lanY - 2, 3, 2);
  ctx.fillStyle = pal.fireIntensity > 0.1 ? '#ffe070' : '#384052';
  ctx.fillRect(lanX - 1, lanY + 3, 3, 2);

  // 9. Momo & Flickering Campfire
  const campX = 338;
  const campY = groundHeights[campX] - 11;
  if (pal.fireIntensity > 0.1) {
    const flicker = 0.86 + 0.14 * simplex2D(t * 6.4, 2.3, 19);
    const cx = campX + 5;
    const cy = campY + 5;
    const r = Math.round((11 + 2 * flicker) * pal.fireIntensity);
    ctx.globalAlpha = 0.14 * pal.fireIntensity * flicker;
    ctx.fillStyle = '#ff9642';
    for (let dy = -r; dy <= r; dy++) {
      const halfSpan = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)) * 1.35);
      ctx.fillRect(cx - halfSpan, cy + dy, halfSpan * 2, 1);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#5c3824';
    ctx.fillRect(campX + 1, campY + 8, 10, 2);
    ctx.fillStyle = '#ff5a36';
    ctx.fillRect(campX + 3, campY + 3, 6, 5);
    ctx.fillStyle = '#ffd447';
    const tipH = Math.floor((t * 8) % 2) === 0 ? 4 : 3;
    ctx.fillRect(campX + 4, campY + 4 - tipH, 4, tipH + 1);
  }

  const momoSprite: SpriteId =
    momoHappyTimer > 0
      ? Math.floor(t * 8) % 2 === 0
        ? 'momo_wave_a'
        : 'momo_wave_b'
      : Math.floor(t * 0.5) % 9 === 0
        ? 'momo_happy'
        : 'momo_idle';
  const momoCanvas = atlasSpriteToCanvas(atlas, momoSprite);
  const momoHop = momoHappyTimer > 0 ? Math.abs(Math.sin(t * 14)) * 4 : 0;
  const momoX = 318;
  const momoY = Math.round(groundHeights[momoX] - 15 - momoHop);
  ctx.drawImage(momoCanvas, momoX, momoY, 16, 16);

  // 10. Roaming Cartridge Walker Cameos on the garden path
  for (let i = 0; i < visitors.length; i++) {
    const v = visitors[i];
    if (v.kind !== 'walker') continue;
    const frame2 = v.spriteB && Math.floor(t * 5 + v.phase) % 2 === 1;
    const spr = atlasSpriteToCanvas(atlas, frame2 ? v.spriteB! : v.spriteA);
    const gx = Math.max(0, Math.min(DIORAMA_CANVAS_W - 1, Math.round(v.x)));
    const hop = Math.max(0, Math.sin(t * 4.5 + v.phase) * 2);
    const gy = groundHeights[gx] - 15 - Math.round(hop);
    ctx.save();
    ctx.translate(gx + 8, gy + 8);
    if (v.vx < 0) ctx.scale(-1, 1);
    ctx.drawImage(spr, -8, -8, 16, 16);
    ctx.restore();
  }

  // 11. Drifting Sakura Petals & Night Fireflies
  for (let i = 0; i < 16; i++) {
    const px = Math.round(((i * 37 + t * (9 + (i % 4) * 2) + Math.sin(t * 1.6 + i) * 8) % (DIORAMA_CANVAS_W - 24)) + 12);
    const py = Math.round(((i * 19 + t * (5 + (i % 3) * 1.5)) % 98) + 12);
    if (pal.fireIntensity > 0.45 && i % 2 === 0) {
      const blink = 0.25 + 0.75 * Math.max(0, Math.sin(t * 2.8 + i * 1.7));
      ctx.globalAlpha = pal.fireIntensity * blink;
      ctx.fillStyle = i % 4 === 0 ? '#ffae52' : '#d8ff66';
      ctx.fillRect(px, py, 2, 2);
    } else {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = i % 2 === 0 ? pal.sakuraLight : pal.sakuraMid;
      ctx.fillRect(px, py, 2, 1);
      ctx.fillRect(px + (Math.floor(t * 4 + i) % 2), py + 1, 1, 1);
    }
  }
  ctx.globalAlpha = 1;

  // 12. Japanese Engawa Architectural Framing
  drawOverhangingSakuraBough(ctx, 'left', pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, t);
  drawOverhangingSakuraBough(ctx, 'right', pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, t);

  ctx.fillStyle = '#2d1c14';
  ctx.fillRect(0, 0, DIORAMA_CANVAS_W, 8);
  ctx.fillStyle = '#5c3a28';
  ctx.fillRect(0, 0, DIORAMA_CANVAS_W, 6);
  ctx.fillStyle = '#7a4f38';
  ctx.fillRect(0, 1, DIORAMA_CANVAS_W, 2);

  ctx.fillStyle = '#3b2419';
  ctx.fillRect(0, 0, 10, DIORAMA_CANVAS_H);
  ctx.fillRect(DIORAMA_CANVAS_W - 10, 0, 10, DIORAMA_CANVAS_H);
  ctx.fillStyle = '#5c3a28';
  ctx.fillRect(2, 0, 5, DIORAMA_CANVAS_H);
  ctx.fillRect(DIORAMA_CANVAS_W - 7, 0, 5, DIORAMA_CANVAS_H);

  // Warm Paper Lantern
  const choX = 18;
  const choY = 30;
  if (pal.fireIntensity > 0.1) {
    ctx.globalAlpha = 0.18 * pal.fireIntensity;
    ctx.fillStyle = '#ff9e4a';
    ctx.fillRect(choX - 7, choY - 2, 18, 16);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#3b2419';
  ctx.fillRect(10, choY - 4, 10, 2);
  ctx.fillRect(choX + 1, choY - 2, 2, 2);
  ctx.fillStyle = '#2d1c14';
  ctx.fillRect(choX, choY, 5, 1);
  ctx.fillRect(choX, choY + 9, 5, 1);
  ctx.fillStyle = pal.fireIntensity > 0.15 ? '#ffd478' : '#ffe9cc';
  ctx.fillRect(choX - 1, choY + 1, 7, 8);
  ctx.fillStyle = '#d95b48';
  ctx.fillRect(choX - 1, choY + 3, 7, 1);
  ctx.fillRect(choX - 1, choY + 6, 7, 1);

  // Hanging Japanese Glass Wind Chime
  const chimeX = 314;
  const sway = Math.round(Math.sin(t * 2.2) * 1.5);
  ctx.fillStyle = '#2d1c14';
  ctx.fillRect(chimeX, 7, 1, 10);
  ctx.fillStyle = '#8ce8ff';
  ctx.fillRect(chimeX - 3, 17, 7, 5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(chimeX - 2, 18, 2, 2);
  ctx.fillStyle = '#ff708d';
  ctx.fillRect(chimeX - 2, 20, 5, 1);
  ctx.fillStyle = '#3b2419';
  ctx.fillRect(chimeX + sway, 22, 1, 4);
  ctx.fillStyle = '#fff5e4';
  ctx.fillRect(chimeX - 1 + sway, 26, 3, 9);
  ctx.fillStyle = '#ff708d';
  ctx.fillRect(chimeX - 1 + sway, 26, 3, 2);

  // Warm Wooden Engawa Veranda Deck
  const deckY = 114;
  ctx.fillStyle = '#261710';
  ctx.fillRect(0, deckY, DIORAMA_CANVAS_W, 2);
  ctx.fillStyle = '#8a5638';
  ctx.fillRect(0, deckY + 2, DIORAMA_CANVAS_W, 8);
  ctx.fillStyle = '#a86e4c';
  ctx.fillRect(0, deckY + 2, DIORAMA_CANVAS_W, 2);
  ctx.fillStyle = '#6e4228';
  ctx.fillRect(0, deckY + 7, DIORAMA_CANVAS_W, 2);
  ctx.fillStyle = '#4a2c1d';
  for (let px = 24; px < DIORAMA_CANVAS_W; px += 48) {
    ctx.fillRect(px, deckY + 2, 1, 8);
  }

  // Steaming Matcha Teacup & Tri-Color Hanami Dango
  const cupX = 96;
  const cupY = deckY - 5;
  ctx.fillStyle = '#4e6e58';
  ctx.fillRect(cupX, cupY, 6, 5);
  ctx.fillStyle = '#78a884';
  ctx.fillRect(cupX + 1, cupY + 1, 2, 3);
  ctx.fillStyle = '#261710';
  ctx.fillRect(cupX + 1, cupY + 5, 4, 1);
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = '#fffaf0';
  const steamShift = Math.floor(t * 3) % 2;
  ctx.fillRect(cupX + 2 + steamShift, cupY - 3, 1, 2);
  ctx.fillRect(cupX + 3 - steamShift, cupY - 6, 1, 2);
  ctx.globalAlpha = 1;

  const danX = 107;
  const danY = deckY - 4;
  ctx.fillStyle = '#5c3a28';
  ctx.fillRect(danX, danY + 3, 12, 1);
  ctx.fillStyle = '#c89e68';
  ctx.fillRect(danX + 1, danY + 1, 10, 1);
  ctx.fillStyle = '#ff9eb5';
  ctx.fillRect(danX + 2, danY, 3, 3);
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(danX + 5, danY, 3, 3);
  ctx.fillStyle = '#78b888';
  ctx.fillRect(danX + 8, danY, 3, 3);

  // Lower Interior Tatami & Hinoki Wood Atelier Floor
  const tatamiTop = mixDioramaHex('#4a543c', pal.wallTop, 0.42);
  const tatamiAlt = mixDioramaHex('#3f4833', pal.wallBot, 0.42);
  const beriColor = '#28362c';
  for (let y = deckY + 10; y < DIORAMA_CANVAS_H; y++) {
    ctx.fillStyle = (y & 1) === 0 ? tatamiTop : tatamiAlt;
    ctx.fillRect(10, y, DIORAMA_CANVAS_W - 20, 1);
  }
  ctx.fillStyle = beriColor;
  ctx.fillRect(10, deckY + 34, DIORAMA_CANVAS_W - 20, 2);
  ctx.fillRect(160, deckY + 10, 2, DIORAMA_CANVAS_H - (deckY + 10));
  ctx.fillRect(320, deckY + 10, 2, DIORAMA_CANVAS_H - (deckY + 10));
}
