import type { SpriteId, TextureAtlas } from '../assets/TextureAtlas.ts';
import { hexToRgb01Into, mixOklabRgb01, rgb01ToHex } from '../core/math/ColorMath.ts';
import { fbm2D, hash2i, simplex2D } from '../core/math/NoiseMath.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import type { CartridgeId } from '../core/types/WorldTypes.ts';
import { atlasSpriteToCanvas } from './MomoMascot.ts';
import { setElementIconLabel } from './PixelIcons.ts';
import {
  type DeskSurfaceStyle,
  getDeskSurfaceMeta,
  nextDeskSurfaceStyle,
  renderForegroundSurfaceUrl,
  renderWallTextureUrl,
  renderWindowLightBeamUrl,
  renderWoodTextureUrl,
} from './ProceduralSurfaceTextures.ts';
import { btn, el } from './dom.ts';

export type DioramaTimeMode = 'auto' | 'dawn' | 'noon' | 'dusk' | 'night';
export type DioramaPerspective = 'focus' | 'window';
const DESK_SURFACE_STORAGE_KEY = 'pixer_desk_surface_v1';

function readSavedSurfaceStyle(): DeskSurfaceStyle {
  try {
    const raw = localStorage.getItem(DESK_SURFACE_STORAGE_KEY);
    if (raw === 'quilt' || raw === 'oak' || raw === 'mat') return raw;
  } catch {
    // ignore storage fallback restrictions
  }
  return 'quilt';
}

function writeSavedSurfaceStyle(style: DeskSurfaceStyle): void {
  try {
    localStorage.setItem(DESK_SURFACE_STORAGE_KEY, style);
  } catch {
    // ignore storage fallback restrictions
  }
}

interface TimeKeyframe {
  hour: number;
  skyTop: string;
  skyBottom: string;
  wallTop: string;
  wallBot: string;
  farHill: string;
  midHill: string;
  nearGrass: string;
  starAlpha: number;
  fireIntensity: number;
  warmTint: string;
}

const KEYFRAMES: readonly TimeKeyframe[] = [
  {
    hour: 0,
    skyTop: '#0d152b',
    skyBottom: '#1f3258',
    wallTop: '#242336',
    wallBot: '#181624',
    farHill: '#1d2d4e',
    midHill: '#17283b',
    nearGrass: '#13242b',
    starAlpha: 0.95,
    fireIntensity: 1.0,
    warmTint: '#ff964f',
  },
  {
    hour: 5.5,
    skyTop: '#324873',
    skyBottom: '#f2b89b',
    wallTop: '#d7c3b8',
    wallBot: '#bfa69a',
    farHill: '#63688c',
    midHill: '#465d68',
    nearGrass: '#2f4f48',
    starAlpha: 0.25,
    fireIntensity: 0.55,
    warmTint: '#ffd2a6',
  },
  {
    hour: 12.0,
    skyTop: '#5cb8ff',
    skyBottom: '#e3f4ff',
    wallTop: '#f8efe0',
    wallBot: '#e8d7be',
    farHill: '#7fb5d9',
    midHill: '#5ca37e',
    nearGrass: '#3e8a5c',
    starAlpha: 0,
    fireIntensity: 0,
    warmTint: '#fff5dc',
  },
  {
    hour: 17.5,
    skyTop: '#3e2d68',
    skyBottom: '#ff8e61',
    wallTop: '#deb49f',
    wallBot: '#bd8a76',
    farHill: '#6f4c7d',
    midHill: '#4c3e5e',
    nearGrass: '#2c383d',
    starAlpha: 0.35,
    fireIntensity: 0.85,
    warmTint: '#ffb173',
  },
  {
    hour: 21.0,
    skyTop: '#121b38',
    skyBottom: '#29406b',
    wallTop: '#2d283d',
    wallBot: '#1d1929',
    farHill: '#23355c',
    midHill: '#1a2d42',
    nearGrass: '#152930',
    starAlpha: 0.9,
    fireIntensity: 1.0,
    warmTint: '#ff964f',
  },
  {
    hour: 24.0,
    skyTop: '#0d152b',
    skyBottom: '#1f3258',
    wallTop: '#242336',
    wallBot: '#181624',
    farHill: '#1d2d4e',
    midHill: '#17283b',
    nearGrass: '#13242b',
    starAlpha: 0.95,
    fireIntensity: 1.0,
    warmTint: '#ff964f',
  },
];

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

interface CameoVisitor {
  cartridgeId: CartridgeId;
  label: string;
  spriteA: SpriteId;
  spriteB?: SpriteId;
  kind: 'walker' | 'flyer';
  x: number;
  baseY: number;
  vx: number;
  phase: number;
}

const CANVAS_W = 320;
const CANVAS_H = 148;
const RGB_A = new Float32Array(3);
const RGB_B = new Float32Array(3);
const RGB_OUT = new Float32Array(3);

function mixHex(a: string, b: string, t: number): string {
  hexToRgb01Into(a, RGB_A, 0);
  hexToRgb01Into(b, RGB_B, 0);
  mixOklabRgb01(RGB_A[0], RGB_A[1], RGB_A[2], RGB_B[0], RGB_B[1], RGB_B[2], t, RGB_OUT, 0);
  return rgb01ToHex(RGB_OUT[0], RGB_OUT[1], RGB_OUT[2]);
}

function getCartridgeCameoSpec(id: string): { spriteA: SpriteId; spriteB?: SpriteId; kind: 'walker' | 'flyer'; label: string } {
  if (id === 'cloudberry-hop') return { spriteA: 'hero_a', spriteB: 'hero_b', kind: 'walker', label: '草莓冒險者' };
  if (id === 'sugar-starlight') return { spriteA: 'ship_a', spriteB: 'ship_b', kind: 'flyer', label: '糖霜戰機' };
  if (id === 'sandbox-toybox') return { spriteA: 'slime_a', spriteB: 'slime_b', kind: 'walker', label: '積木史萊姆' };
  if (id === 'emberkeep-dnd') return { spriteA: 'slime_knight', spriteB: 'ember_warden', kind: 'walker', label: '地城騎士' };
  if (id === 'astral-chronicles') return { spriteA: 'star_a', spriteB: 'star_b', kind: 'flyer', label: '星穹精靈' };
  return { spriteA: 'star_a', spriteB: 'hero_a', kind: 'walker', label: '自製卡匣訪客' };
}

/**
 * Living Window & Bedside Diorama backdrop:
 * - Smooth Oklab time-of-day sky, clouds, aurora, stars & room lighting tint
 * - Procedural FBM mountain ridges + Momo campfire & fireflies
 * - Strolling cameo sprites sampled directly from registered cartridges in TextureAtlas
 * - Throttled inside ConsoleView.tick() so IN_GAME gameplay stays smooth at 60fps
 */
export class WindowDioramaView {
  public readonly backdropEl: HTMLElement;
  public readonly windowFrameEl: HTMLElement;
  public readonly bedLedgeEl: HTMLElement;
  public readonly surfaceBtn: HTMLButtonElement;

  private readonly host: EngineHost;
  private readonly atlas: TextureAtlas;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly statusChipEl: HTMLElement;
  private readonly ac = new AbortController();

  private readonly farHeights = new Int16Array(CANVAS_W);
  private readonly midHeights = new Int16Array(CANVAS_W);
  private readonly groundHeights = new Int16Array(CANVAS_W);

  private timeMode: DioramaTimeMode = 'auto';
  private perspective: DioramaPerspective = 'focus';
  private surfaceStyle: DeskSurfaceStyle = readSavedSurfaceStyle();
  private shellPhase = 'BOOT_BLINK';
  private bootStage = 'standby';

  private elapsedSec = 0;
  private redrawAccum = 0;
  private momoHappyTimer = 0;
  private lastWallCssKey = '';
  private visitors: CameoVisitor[] = [];
  private onRequestWindowFocus?: () => void;

  constructor(
    host: EngineHost,
    atlas: TextureAtlas,
    callbacks?: { onRequestWindowFocus?: () => void },
  ) {
    this.host = host;
    this.atlas = atlas;
    this.onRequestWindowFocus = callbacks?.onRequestWindowFocus;

    this.backdropEl = el('div', 'diorama-room-backdrop');
    this.backdropEl.setAttribute('aria-hidden', 'false');

    const wallWash = el('div', 'diorama-wall-wash');
    const lampGlow = el('div', 'diorama-lamp-glow');
    const lightShaft = el('div', 'diorama-light-shaft');
    lightShaft.setAttribute('aria-hidden', 'true');

    // Framed pixel window centered in the upper room backdrop
    this.windowFrameEl = el('div', 'diorama-window-frame');
    this.windowFrameEl.title = '點擊切換窗外視角或跟 Momo 打招呼';

    const innerSash = el('div', 'diorama-window-glass');
    this.canvas = el('canvas', 'window-diorama-canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d');

    const mullionV = el('span', 'window-mullion-v');
    const mullionH = el('span', 'window-mullion-h');
    const sill = el('div', 'window-wood-sill');
    const sillPlant = el('span', 'window-sill-plant');
    sillPlant.setAttribute('aria-hidden', 'true');
    const sillMug = el('span', 'window-sill-mug');
    sillMug.setAttribute('aria-hidden', 'true');
    sill.append(sillPlant, sillMug);

    this.statusChipEl = el('div', 'window-status-chip', '窗外悠閒巡遊中');

    innerSash.append(this.canvas, mullionV, mullionH);
    this.windowFrameEl.append(innerSash, sill, this.statusChipEl);

    // Foreground bedside quilt & desk edge beneath console
    this.bedLedgeEl = el('div', 'diorama-bed-ledge');
    this.bedLedgeEl.dataset.surface = this.surfaceStyle;
    this.bedLedgeEl.setAttribute('aria-hidden', 'true');

    const woodUrl = renderWoodTextureUrl('#a66f45');
    if (woodUrl) {
      this.backdropEl.style.setProperty('--tex-wood', `url("${woodUrl}")`);
    }

    this.surfaceBtn = btn(
      'console-os-pill-btn desk-surface-btn',
      '',
      '切換前景桌面材質（床沿拼布被 ↔ 原木工作桌 ↔ 像素繪圖墊）',
      () => {
        this.host.unlockAudio();
        this.cycleDeskSurfaceStyle();
      },
      this.ac.signal,
    );
    this.syncSurfaceBtnLabel();

    this.backdropEl.append(wallWash, lampGlow, lightShaft, this.windowFrameEl, this.bedLedgeEl);

    this.windowFrameEl.addEventListener(
      'click',
      () => {
        if (this.perspective !== 'window') {
          this.onRequestWindowFocus?.();
        }
        this.greetMomo();
      },
      { signal: this.ac.signal },
    );

    this.precomputeTerrainRidges();
    this.rebuildVisitors();
    this.renderScene(true);
  }

  public getTimeMode(): DioramaTimeMode {
    return this.timeMode;
  }

  public getDeskSurfaceStyle(): DeskSurfaceStyle {
    return this.surfaceStyle;
  }

  public setDeskSurfaceStyle(next: DeskSurfaceStyle): void {
    if (this.surfaceStyle === next) return;
    this.surfaceStyle = next;
    this.bedLedgeEl.dataset.surface = next;
    writeSavedSurfaceStyle(next);
    this.syncSurfaceBtnLabel();
    this.lastWallCssKey = '';
    this.renderScene(false);
  }

  public cycleDeskSurfaceStyle(): DeskSurfaceStyle {
    const next = nextDeskSurfaceStyle(this.surfaceStyle);
    this.setDeskSurfaceStyle(next);
    this.host.playStereoTick(720, 0.12, 0.14);
    return next;
  }

  private syncSurfaceBtnLabel(): void {
    const meta = getDeskSurfaceMeta(this.surfaceStyle);
    setElementIconLabel(this.surfaceBtn, 'palette', meta.shortLabel);
  }

  public cycleTimeMode(): DioramaTimeMode {
    const order: readonly DioramaTimeMode[] = ['auto', 'dawn', 'noon', 'dusk', 'night'];
    const next = order[(order.indexOf(this.timeMode) + 1) % order.length];
    this.timeMode = next;
    this.renderScene(true);
    return next;
  }

  public setPerspective(p: DioramaPerspective): void {
    this.perspective = p;
    this.renderScene(true);
  }

  public setShellState(shellPhase: string, bootStage: string): void {
    this.shellPhase = shellPhase;
    this.bootStage = bootStage;
  }

  public greetMomo(): void {
    this.momoHappyTimer = 1.8;
    this.host.playStereoTick(680, 0.12, 0.18);
    this.renderScene(true);
  }

  public rebuildVisitors(): void {
    const carts = this.host.listCartridges();
    const chosen: CameoVisitor[] = [];
    const stepCount = Math.min(3, carts.length);
    for (let i = 0; i < stepCount; i++) {
      const meta = carts[i];
      const spec = getCartridgeCameoSpec(meta.id);
      chosen.push({
        cartridgeId: meta.id,
        label: spec.label,
        spriteA: spec.spriteA,
        spriteB: spec.spriteB,
        kind: spec.kind,
        x: 34 + i * 82,
        baseY: spec.kind === 'flyer' ? 30 + i * 11 : 108,
        vx: (i % 2 === 0 ? 1 : -1) * (spec.kind === 'flyer' ? 14 : 9 + i * 2),
        phase: i * 1.9,
      });
    }
    this.visitors = chosen;
    this.syncStatusChip();
  }

  private getEffectiveHour(): number {
    if (this.timeMode === 'dawn') return 6.2;
    if (this.timeMode === 'noon') return 12.5;
    if (this.timeMode === 'dusk') return 17.6;
    if (this.timeMode === 'night') return 22.4;
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }

  public getTimeMoodLabel(): string {
    const h = this.getEffectiveHour();
    const prefix = this.timeMode === 'auto' ? '自動 · ' : '';
    if (h >= 5 && h < 8.5) return `${prefix}清晨微光`;
    if (h >= 8.5 && h < 16.5) return `${prefix}午後晴空`;
    if (h >= 16.5 && h < 19.5) return `${prefix}黃昏晚霞`;
    return `${prefix}深夜營火`;
  }

  private syncStatusChip(): void {
    const h = this.getEffectiveHour();
    const isCozyFire = h < 6.5 || h >= 16.8;
    const firstVisitor = this.visitors[0]?.label;
    const mood = this.getTimeMoodLabel();
    this.statusChipEl.textContent = isCozyFire
      ? `${mood} · Momo 烤火中${firstVisitor ? ` · ${firstVisitor}` : ''}`
      : `${mood} · Momo 野餐散步${firstVisitor ? ` · ${firstVisitor}` : ''}`;
  }

  private precomputeTerrainRidges(): void {
    for (let x = 0; x < CANVAS_W; x++) {
      const farN = fbm2D(x * 0.015, 1.3, 3, 2.0, 0.5, 404);
      const midN = fbm2D(x * 0.025, 4.7, 3, 2.0, 0.5, 808);
      const gN = simplex2D(x * 0.03, 8.2, 102);
      this.farHeights[x] = Math.round(68 + farN * 20);
      this.midHeights[x] = Math.round(94 + midN * 14);
      // Keep a gentle flat camp shelf around x = 185..255 for Momo's campfire
      const campFlat = x >= 175 && x <= 265 ? 0.2 : 1.0;
      this.groundHeights[x] = Math.round(118 + gN * 5 * campFlat);
    }
  }

  public tick(dt: number): void {
    if (typeof document !== 'undefined') {
      if (document.body.dataset.perf === 'eco' && this.shellPhase === 'IN_GAME') return;
      if (document.querySelector('.atelier-shell.is-handheld-landscape')) return;
    }

    this.elapsedSec += dt;
    if (this.momoHappyTimer > 0) {
      this.momoHappyTimer = Math.max(0, this.momoHappyTimer - dt);
    }

    for (let i = 0; i < this.visitors.length; i++) {
      const v = this.visitors[i];
      v.x += v.vx * dt;
      if (v.x < 18) {
        v.x = 18;
        v.vx = Math.abs(v.vx);
      } else if (v.x > CANVAS_W - 28) {
        v.x = CANVAS_W - 28;
        v.vx = -Math.abs(v.vx);
      }
    }

    const targetFps =
      this.shellPhase === 'IN_GAME'
        ? 3
        : this.bootStage === 'standby'
          ? 6
          : this.perspective === 'window'
            ? 20
            : 14;
    this.redrawAccum += dt;
    if (this.redrawAccum >= 1 / targetFps) {
      this.redrawAccum = 0;
      this.renderScene(false);
    }
  }

  private samplePaletteAtHour(h: number): {
    skyTop: string;
    skyBottom: string;
    wallTop: string;
    wallBot: string;
    farHill: string;
    midHill: string;
    nearGrass: string;
    starAlpha: number;
    fireIntensity: number;
    warmTint: string;
  } {
    const hour = ((h % 24) + 24) % 24;
    let a = KEYFRAMES[0];
    let b = KEYFRAMES[1];
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (hour >= KEYFRAMES[i].hour && hour <= KEYFRAMES[i + 1].hour) {
        a = KEYFRAMES[i];
        b = KEYFRAMES[i + 1];
        break;
      }
    }
    const span = Math.max(0.001, b.hour - a.hour);
    const t = Math.max(0, Math.min(1, (hour - a.hour) / span));
    return {
      skyTop: mixHex(a.skyTop, b.skyTop, t),
      skyBottom: mixHex(a.skyBottom, b.skyBottom, t),
      wallTop: mixHex(a.wallTop, b.wallTop, t),
      wallBot: mixHex(a.wallBot, b.wallBot, t),
      farHill: mixHex(a.farHill, b.farHill, t),
      midHill: mixHex(a.midHill, b.midHill, t),
      nearGrass: mixHex(a.nearGrass, b.nearGrass, t),
      starAlpha: a.starAlpha + (b.starAlpha - a.starAlpha) * t,
      fireIntensity: a.fireIntensity + (b.fireIntensity - a.fireIntensity) * t,
      warmTint: mixHex(a.warmTint, b.warmTint, t),
    };
  }

  private renderScene(updateChip: boolean): void {
    const h = this.getEffectiveHour();
    const pal = this.samplePaletteAtHour(h);

    const fireBucket = Math.round(pal.fireIntensity * 4);
    const wallKey = `${pal.wallTop}|${pal.wallBot}|${pal.warmTint}|${fireBucket}|${this.surfaceStyle}`;
    if (wallKey !== this.lastWallCssKey) {
      this.lastWallCssKey = wallKey;
      this.backdropEl.style.setProperty('--diorama-wall-top', pal.wallTop);
      this.backdropEl.style.setProperty('--diorama-wall-bot', pal.wallBot);
      this.backdropEl.style.setProperty('--diorama-warm-glow', pal.warmTint);
      this.backdropEl.style.setProperty('--diorama-fire', pal.fireIntensity.toFixed(2));
      const wallUrl = renderWallTextureUrl(pal.wallTop, pal.wallBot);
      if (wallUrl) this.backdropEl.style.setProperty('--tex-wall', `url("${wallUrl}")`);
      const fgUrl = renderForegroundSurfaceUrl(this.surfaceStyle, pal.wallBot);
      if (fgUrl) this.backdropEl.style.setProperty('--tex-fg', `url("${fgUrl}")`);
      const beamUrl = renderWindowLightBeamUrl(pal.warmTint, pal.fireIntensity);
      if (beamUrl) this.backdropEl.style.setProperty('--tex-beam', `url("${beamUrl}")`);
    }
    if (updateChip) {
      this.syncStatusChip();
    }

    const ctx = this.ctx;
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const t = this.elapsedSec;

    // 1. Bayer-stepped Oklab Sky Bands (chunky authentic pixel-sky)
    const bandCount = 12;
    const bandH = Math.ceil(CANVAS_H / bandCount);
    for (let b = 0; b < bandCount; b++) {
      const frac = b / (bandCount - 1);
      ctx.fillStyle = mixHex(pal.skyTop, pal.skyBottom, frac);
      ctx.fillRect(0, b * bandH, CANVAS_W, bandH + 1);
      if (b < bandCount - 1) {
        const nextBandColor = mixHex(pal.skyTop, pal.skyBottom, (b + 1) / (bandCount - 1));
        ctx.fillStyle = nextBandColor;
        const seamY = (b + 1) * bandH - 2;
        for (let x = 0; x < CANVAS_W; x += 2) {
          if (BAYER_4X4[((seamY & 3) << 2) | (x & 3)] < 7) {
            ctx.fillRect(x, seamY, 2, 2);
          }
        }
      }
    }

    // 2. Stars & Aurora (Dusk/Night)
    if (pal.starAlpha > 0.05) {
      for (let i = 0; i < 36; i++) {
        const sx = Math.floor(hash2i(i, 3, 91) * CANVAS_W);
        const sy = Math.floor(hash2i(i, 7, 91) * 74);
        const twinkle = 0.45 + 0.55 * Math.sin(t * (1.8 + (i % 4) * 0.6) + i * 1.3);
        ctx.globalAlpha = pal.starAlpha * twinkle;
        ctx.fillStyle = i % 5 === 0 ? '#ffd88a' : '#fffaf0';
        ctx.fillRect(sx, sy, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
      }
      // Subtle night aurora ribbon
      if (pal.starAlpha > 0.55) {
        ctx.globalAlpha = (pal.starAlpha - 0.45) * 0.26;
        for (let x = 20; x < CANVAS_W - 20; x += 4) {
          const ay = 26 + Math.round(simplex2D(x * 0.025 + t * 0.14, 2.1, 77) * 10);
          ctx.fillStyle = x % 8 === 0 ? '#56d39c' : '#5ec2f7';
          ctx.fillRect(x, ay, 4, 9);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 3. Sun or Moon disc (pixel-stepped rounded shapes)
    if (h >= 6 && h <= 18.5) {
      const dayFrac = (h - 6) / 12.5;
      const sunX = Math.round(48 + dayFrac * (CANVAS_W - 96));
      const sunY = Math.round(64 - Math.sin(dayFrac * Math.PI) * 44);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = pal.warmTint;
      ctx.fillRect(sunX - 9, sunY - 5, 18, 10);
      ctx.fillRect(sunX - 5, sunY - 9, 10, 18);
      ctx.globalAlpha = 0.96;
      ctx.fillStyle = '#fff5cc';
      ctx.fillRect(sunX - 5, sunY - 3, 10, 6);
      ctx.fillRect(sunX - 3, sunY - 5, 6, 10);
      ctx.fillStyle = '#ffe270';
      ctx.fillRect(sunX - 3, sunY - 3, 6, 6);
      ctx.globalAlpha = 1;
    } else {
      const moonX = 76;
      const moonY = 24;
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#dceeff';
      ctx.fillRect(moonX - 8, moonY - 5, 16, 10);
      ctx.fillRect(moonX - 5, moonY - 8, 10, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8dc';
      ctx.fillRect(moonX - 4, moonY - 5, 8, 10);
      ctx.fillRect(moonX - 5, moonY - 3, 10, 6);
      // Carve crescent shadow matching sky top band
      ctx.fillStyle = pal.skyTop;
      ctx.fillRect(moonX, moonY - 4, 5, 6);
      ctx.fillRect(moonX + 1, moonY - 5, 4, 8);
    }

    // 4. Drifting Pixel Clouds from TextureAtlas
    const cloudM = atlasSpriteToCanvas(this.atlas, 'cloud_m');
    const cloudL = atlasSpriteToCanvas(this.atlas, 'cloud_l');
    ctx.globalAlpha = h >= 19 || h < 5.5 ? 0.32 : 0.85;
    for (let c = 0; c < 4; c++) {
      const cx = Math.round(((c * 92 + t * (2.6 + c * 0.6)) % (CANVAS_W + 48)) - 32);
      const cy = 18 + (c % 2) * 14;
      ctx.drawImage(c % 2 === 0 ? cloudM : cloudL, cx, cy, 32, 24);
    }
    ctx.globalAlpha = 1;

    // 5. Rolling Mountain & Hill Ridges
    ctx.fillStyle = pal.farHill;
    for (let x = 0; x < CANVAS_W; x += 2) {
      const y = this.farHeights[x];
      ctx.fillRect(x, y, 2, CANVAS_H - y);
    }

    // Sky flyers from cartridges behind mid hills
    for (let i = 0; i < this.visitors.length; i++) {
      const v = this.visitors[i];
      if (v.kind !== 'flyer') continue;
      const spr = atlasSpriteToCanvas(this.atlas, v.spriteB && Math.floor(t * 4 + v.phase) % 2 === 1 ? v.spriteB : v.spriteA);
      const fy = Math.round(v.baseY + Math.sin(t * 2.1 + v.phase) * 4);
      ctx.save();
      ctx.translate(Math.round(v.x) + 8, fy + 8);
      if (v.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(spr, -8, -8, 16, 16);
      ctx.restore();
    }

    ctx.fillStyle = pal.midHill;
    for (let x = 0; x < CANVAS_W; x += 2) {
      const y = this.midHeights[x];
      ctx.fillRect(x, y, 2, CANVAS_H - y);
    }

    // Foreground meadow shelf
    ctx.fillStyle = pal.nearGrass;
    for (let x = 0; x < CANVAS_W; x += 2) {
      const y = this.groundHeights[x];
      ctx.fillRect(x, y, 2, CANVAS_H - y);
    }

    // Tree silhouettes framing far edges
    const canopy = atlasSpriteToCanvas(this.atlas, 'tree_canopy');
    ctx.drawImage(canopy, 8, this.groundHeights[14] - 26, 28, 28);
    ctx.drawImage(canopy, CANVAS_W - 40, this.groundHeights[CANVAS_W - 26] - 28, 30, 30);

    // 6. Momo & Flickering Campfire
    const campX = 218;
    const campY = this.groundHeights[campX] - 12;
    if (pal.fireIntensity > 0.1) {
      const flicker = 0.84 + 0.16 * simplex2D(t * 6.4, 2.3, 19);
      const cx = campX + 8;
      const cy = campY + 6;
      // Rounded 3-band stepped pixel hearth glow
      const r1 = Math.round((20 + 3 * flicker) * pal.fireIntensity);
      const r2 = Math.round((13 + 2 * flicker) * pal.fireIntensity);
      const r3 = Math.round((7 + 1.5 * flicker) * pal.fireIntensity);
      ctx.globalAlpha = 0.1 * pal.fireIntensity * flicker;
      ctx.fillStyle = '#ff8c3b';
      ctx.fillRect(cx - r1, cy - Math.round(r1 * 0.45), r1 * 2, Math.round(r1 * 0.9));
      ctx.fillRect(cx - Math.round(r1 * 0.72), cy - Math.round(r1 * 0.72), Math.round(r1 * 1.44), Math.round(r1 * 1.44));
      ctx.globalAlpha = 0.14 * pal.fireIntensity * flicker;
      ctx.fillStyle = '#ffb547';
      ctx.fillRect(cx - r2, cy - Math.round(r2 * 0.48), r2 * 2, Math.round(r2 * 0.96));
      ctx.fillRect(cx - Math.round(r2 * 0.65), cy - Math.round(r2 * 0.74), Math.round(r2 * 1.3), Math.round(r2 * 1.48));
      ctx.globalAlpha = 0.2 * pal.fireIntensity * flicker;
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(cx - r3, cy - Math.round(r3 * 0.55), r3 * 2, Math.round(r3 * 1.1));
      ctx.globalAlpha = 1;

      // Campfire logs & animated flame pixels
      ctx.fillStyle = '#5c3824';
      ctx.fillRect(campX + 2, campY + 9, 12, 3);
      ctx.fillStyle = '#3b2214';
      ctx.fillRect(campX + 4, campY + 11, 8, 2);
      ctx.fillStyle = '#ff5a36';
      ctx.fillRect(campX + 4, campY + 4, 8, 6);
      ctx.fillRect(campX + 5, campY + 2, 6, 8);
      ctx.fillStyle = '#ffd447';
      const tipH = Math.floor((t * 8) % 2) === 0 ? 5 : 4;
      ctx.fillRect(campX + 6, campY + 4 - (tipH - 4), 4, tipH);
    }

    // Momo sitting beside campfire / meadow (waves cheerfully when greeted!)
    const momoSprite: SpriteId =
      this.momoHappyTimer > 0
        ? Math.floor(t * 8) % 2 === 0
          ? 'momo_wave_a'
          : 'momo_wave_b'
        : Math.floor(t * 0.5) % 9 === 0
          ? 'momo_happy'
          : 'momo_idle';
    const momoCanvas = atlasSpriteToCanvas(this.atlas, momoSprite);
    const momoHop = this.momoHappyTimer > 0 ? Math.abs(Math.sin(t * 14)) * 5 : 0;
    const momoX = 194;
    const momoY = Math.round(this.groundHeights[momoX] - 15 - momoHop);
    ctx.drawImage(momoCanvas, momoX, momoY, 16, 16);

    // 7. Roaming Cartridge Walker Cameos on the meadow path
    for (let i = 0; i < this.visitors.length; i++) {
      const v = this.visitors[i];
      if (v.kind !== 'walker') continue;
      const frame2 = v.spriteB && Math.floor(t * 5 + v.phase) % 2 === 1;
      const spr = atlasSpriteToCanvas(this.atlas, frame2 ? v.spriteB! : v.spriteA);
      const gx = Math.max(0, Math.min(CANVAS_W - 1, Math.round(v.x)));
      const hop = Math.max(0, Math.sin(t * 4.5 + v.phase) * 2.5);
      const gy = this.groundHeights[gx] - 15 - Math.round(hop);
      ctx.save();
      ctx.translate(gx + 8, gy + 8);
      if (v.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(spr, -8, -8, 16, 16);
      ctx.restore();
    }

    // 8. Night/Dusk Fireflies & Embers
    if (pal.fireIntensity > 0.25) {
      const span = CANVAS_W - 84;
      for (let i = 0; i < 8; i++) {
        const rawX = (i * 37 + Math.sin(t * 0.9 + i) * 18 + t * 3) % span;
        const fx = Math.round(42 + ((rawX + span) % span));
        const fy = Math.round(78 + Math.cos(t * 1.4 + i * 2.1) * 22);
        const blink = 0.3 + 0.7 * Math.max(0, Math.sin(t * 2.6 + i * 1.7));
        ctx.globalAlpha = pal.fireIntensity * blink;
        ctx.fillStyle = i < 3 ? '#ff964f' : '#e6ff70';
        ctx.fillRect(fx, fy, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  public destroy(): void {
    this.ac.abort();
  }
}
