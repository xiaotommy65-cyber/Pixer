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
  return 'oak';
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
  skyMid: string;
  skyBottom: string;
  wallTop: string;
  wallBot: string;
  fujiBody: string;
  fujiSnow: string;
  farHill: string;
  midHill: string;
  nearGrass: string;
  waterTop: string;
  waterBot: string;
  sakuraLight: string;
  sakuraMid: string;
  sakuraShade: string;
  starAlpha: number;
  fireIntensity: number;
  warmTint: string;
}

const KEYFRAMES: readonly TimeKeyframe[] = [
  {
    hour: 0,
    skyTop: '#080e24',
    skyMid: '#132147',
    skyBottom: '#233666',
    wallTop: '#16192b',
    wallBot: '#101220',
    fujiBody: '#16254a',
    fujiSnow: '#8fa8d6',
    farHill: '#142242',
    midHill: '#101d34',
    nearGrass: '#0f2128',
    waterTop: '#162952',
    waterBot: '#0d1832',
    sakuraLight: '#9e7da8',
    sakuraMid: '#6e527d',
    sakuraShade: '#3d2c4d',
    starAlpha: 0.96,
    fireIntensity: 1.0,
    warmTint: '#ff9a52',
  },
  {
    hour: 5.5,
    skyTop: '#2c4170',
    skyMid: '#946b88',
    skyBottom: '#f7ba9e',
    wallTop: '#33293a',
    wallBot: '#241d2b',
    fujiBody: '#4d4f7a',
    fujiSnow: '#ffe3d8',
    farHill: '#57587e',
    midHill: '#3d4c60',
    nearGrass: '#284644',
    waterTop: '#a87c94',
    waterBot: '#3e4c70',
    sakuraLight: '#ffd8e4',
    sakuraMid: '#f29cb8',
    sakuraShade: '#a65878',
    starAlpha: 0.28,
    fireIntensity: 0.52,
    warmTint: '#ffd2a6',
  },
  {
    hour: 12.0,
    skyTop: '#2678dc',
    skyMid: '#66b6ff',
    skyBottom: '#dcf3ff',
    wallTop: '#3d2d24',
    wallBot: '#2b1f19',
    fujiBody: '#5582ba',
    fujiSnow: '#ffffff',
    farHill: '#6a9ec9',
    midHill: '#46876c',
    nearGrass: '#327552',
    waterTop: '#68b8f8',
    waterBot: '#2e74b8',
    sakuraLight: '#fff0f5',
    sakuraMid: '#ffb3c9',
    sakuraShade: '#d96b90',
    starAlpha: 0,
    fireIntensity: 0,
    warmTint: '#fff5dc',
  },
  {
    hour: 17.5,
    skyTop: '#241b4b',
    skyMid: '#963b68',
    skyBottom: '#ff9054',
    wallTop: '#2c1e2e',
    wallBot: '#1e1522',
    fujiBody: '#462a59',
    fujiSnow: '#ffc4a3',
    farHill: '#583464',
    midHill: '#39274a',
    nearGrass: '#242a36',
    waterTop: '#b85268',
    waterBot: '#3b244c',
    sakuraLight: '#ffc2d1',
    sakuraMid: '#d97294',
    sakuraShade: '#7a3858',
    starAlpha: 0.38,
    fireIntensity: 0.88,
    warmTint: '#ffb173',
  },
  {
    hour: 21.0,
    skyTop: '#0a112b',
    skyMid: '#172752',
    skyBottom: '#29406e',
    wallTop: '#181b2e',
    wallBot: '#111322',
    fujiBody: '#1b2c57',
    fujiSnow: '#9ab4e0',
    farHill: '#18284c',
    midHill: '#13223b',
    nearGrass: '#11242b',
    waterTop: '#1c315e',
    waterBot: '#0f1b38',
    sakuraLight: '#a685b0',
    sakuraMid: '#745684',
    sakuraShade: '#412f52',
    starAlpha: 0.92,
    fireIntensity: 1.0,
    warmTint: '#ff9a52',
  },
  {
    hour: 24.0,
    skyTop: '#080e24',
    skyMid: '#132147',
    skyBottom: '#233666',
    wallTop: '#16192b',
    wallBot: '#101220',
    fujiBody: '#16254a',
    fujiSnow: '#8fa8d6',
    farHill: '#142242',
    midHill: '#101d34',
    nearGrass: '#0f2128',
    waterTop: '#162952',
    waterBot: '#0d1832',
    sakuraLight: '#9e7da8',
    sakuraMid: '#6e527d',
    sakuraShade: '#3d2c4d',
    starAlpha: 0.96,
    fireIntensity: 1.0,
    warmTint: '#ff9a52',
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

const CANVAS_W = 480;
const CANVAS_H = 270;
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
 * Full-Viewport 480x270 Japanese Pixel-Art Veranda & Fantasy Console Atelier Backdrop:
 * - Multi-band Bayer-dithered Japanese anime sky (Dawn / Noon / Tasogare Dusk / Starry Night)
 * - Hand-crafted multi-tone pixel cumulus clouds, Mt. Fuji with dithered snow cap, & shimmering lake reflection
 * - Distant hillside Torii gate, five-story pagoda, Machiya town lights & utility pole silhouettes
 * - Foreground Engawa wooden veranda with Sakura trees, falling sakura petals, stone lantern, and Momo's campfire
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

    this.windowFrameEl = el('div', 'diorama-window-frame');
    this.windowFrameEl.title = '點擊切換日式窗廊全景或跟 Momo 打招呼';

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

    this.statusChipEl = el('div', 'window-status-chip', '縁側悠閒巡遊中');

    innerSash.append(this.canvas, mullionV, mullionH);
    this.windowFrameEl.append(innerSash, sill, this.statusChipEl);

    this.bedLedgeEl = el('div', 'diorama-bed-ledge');
    this.bedLedgeEl.dataset.surface = this.surfaceStyle;
    this.bedLedgeEl.setAttribute('aria-hidden', 'true');

    const woodUrl = renderWoodTextureUrl('#8c5836');
    if (woodUrl) {
      this.backdropEl.style.setProperty('--tex-wood', `url("${woodUrl}")`);
    }

    this.surfaceBtn = btn(
      'console-os-pill-btn desk-surface-btn',
      '',
      '切換工房桌面材質（原木工作桌 ↔ 像素繪圖墊 ↔ 拼布床沿）',
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
        x: 68 + i * 124,
        baseY: spec.kind === 'flyer' ? 32 + i * 12 : 114,
        vx: (i % 2 === 0 ? 1 : -1) * (spec.kind === 'flyer' ? 16 : 10 + i * 2),
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
    return `${prefix}深夜星町`;
  }

  private syncStatusChip(): void {
    const h = this.getEffectiveHour();
    const isCozyFire = h < 6.5 || h >= 16.8;
    const firstVisitor = this.visitors[0]?.label;
    const mood = this.getTimeMoodLabel();
    this.statusChipEl.textContent = isCozyFire
      ? `${mood} · Momo 縁側烤火${firstVisitor ? ` · ${firstVisitor}` : ''}`
      : `${mood} · Momo 櫻下散步${firstVisitor ? ` · ${firstVisitor}` : ''}`;
  }

  private precomputeTerrainRidges(): void {
    for (let x = 0; x < CANVAS_W; x++) {
      // Mt. Fuji centered on upper-left Golden Third (x = 160, peak y = 32 -> base y = 84)
      const dxFuji = Math.abs(x - 160);
      const fujiSlope = dxFuji <= 11 ? 32 : Math.min(84, 32 + Math.pow((dxFuji - 11) / 66, 1.36) * 52);
      const farN = fbm2D(x * 0.014, 1.3, 3, 2.0, 0.5, 404);
      const ridgeY = Math.round(74 + farN * 9);
      this.farHeights[x] = Math.min(Math.round(fujiSlope), ridgeY);

      const midN = fbm2D(x * 0.022, 4.7, 3, 2.0, 0.5, 808);
      // Open scenic lake bay across x = 76..254 for Mt. Fuji & celestial reflections
      const lakeDip = x >= 76 && x <= 254 ? Math.sin(((x - 76) / 178) * Math.PI) * 13 : 0;
      this.midHeights[x] = Math.round(78 + midN * 7 + lakeDip);

      const gN = simplex2D(x * 0.025, 8.2, 102);
      const campFlat = x >= 270 && x <= 380 ? 0.15 : 0.85;
      this.groundHeights[x] = Math.round(105 + gN * 2 * campFlat);
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
      if (v.x < 34) {
        v.x = 34;
        v.vx = Math.abs(v.vx);
      } else if (v.x > CANVAS_W - 48) {
        v.x = CANVAS_W - 48;
        v.vx = -Math.abs(v.vx);
      }
    }

    const targetFps =
      this.shellPhase === 'IN_GAME'
        ? 3
        : this.bootStage === 'standby'
          ? 8
          : this.perspective === 'window'
            ? 20
            : 14;
    this.redrawAccum += dt;
    if (this.redrawAccum >= 1 / targetFps) {
      this.redrawAccum = 0;
      this.renderScene(false);
    }
  }

  private samplePaletteAtHour(h: number): TimeKeyframe {
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
      hour,
      skyTop: mixHex(a.skyTop, b.skyTop, t),
      skyMid: mixHex(a.skyMid, b.skyMid, t),
      skyBottom: mixHex(a.skyBottom, b.skyBottom, t),
      wallTop: mixHex(a.wallTop, b.wallTop, t),
      wallBot: mixHex(a.wallBot, b.wallBot, t),
      fujiBody: mixHex(a.fujiBody, b.fujiBody, t),
      fujiSnow: mixHex(a.fujiSnow, b.fujiSnow, t),
      farHill: mixHex(a.farHill, b.farHill, t),
      midHill: mixHex(a.midHill, b.midHill, t),
      nearGrass: mixHex(a.nearGrass, b.nearGrass, t),
      waterTop: mixHex(a.waterTop, b.waterTop, t),
      waterBot: mixHex(a.waterBot, b.waterBot, t),
      sakuraLight: mixHex(a.sakuraLight, b.sakuraLight, t),
      sakuraMid: mixHex(a.sakuraMid, b.sakuraMid, t),
      sakuraShade: mixHex(a.sakuraShade, b.sakuraShade, t),
      starAlpha: a.starAlpha + (b.starAlpha - a.starAlpha) * t,
      fireIntensity: a.fireIntensity + (b.fireIntensity - a.fireIntensity) * t,
      warmTint: mixHex(a.warmTint, b.warmTint, t),
    };
  }

  /** Draws a soft multi-tone Japanese anime pixel cumulus cloud (no harsh black outlines). */
  private drawPixelCumulus(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    scale: number,
    topHex: string,
    midHex: string,
    shadeHex: string,
  ): void {
    const s = Math.max(1, Math.round(scale));
    // Underbelly shadow base
    ctx.fillStyle = shadeHex;
    ctx.fillRect(cx - 18 * s, cy + 3 * s, 36 * s, 4 * s);
    ctx.fillRect(cx - 22 * s, cy + 5 * s, 44 * s, 2 * s);
    // Mid-tone body puffs
    ctx.fillStyle = midHex;
    ctx.fillRect(cx - 20 * s, cy + 1 * s, 40 * s, 4 * s);
    ctx.fillRect(cx - 14 * s, cy - 3 * s, 28 * s, 5 * s);
    ctx.fillRect(cx - 8 * s, cy - 6 * s, 18 * s, 4 * s);
    // Sunlit top highlights
    ctx.fillStyle = topHex;
    ctx.fillRect(cx - 6 * s, cy - 7 * s, 14 * s, 3 * s);
    ctx.fillRect(cx - 13 * s, cy - 4 * s, 24 * s, 3 * s);
    ctx.fillRect(cx - 19 * s, cy - 1 * s, 12 * s, 2 * s);
    ctx.fillRect(cx + 8 * s, cy - 1 * s, 10 * s, 2 * s);
  }

  /** Draws a lush Japanese pixel Sakura / Cedar tree with layered blossom clusters and trunk. */
  private drawPixelSakuraTree(
    ctx: CanvasRenderingContext2D,
    tx: number,
    groundY: number,
    lightHex: string,
    midHex: string,
    shadeHex: string,
    isSakura: boolean,
  ): void {
    // Trunk & roots
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

    // Shadow canopy base
    ctx.fillStyle = cShade;
    ctx.fillRect(tx - 13, groundY - 19, 26, 7);
    ctx.fillRect(tx - 10, groundY - 25, 20, 7);
    // Mid blossom foliage
    ctx.fillStyle = cMid;
    ctx.fillRect(tx - 12, groundY - 22, 24, 7);
    ctx.fillRect(tx - 9, groundY - 28, 18, 7);
    ctx.fillRect(tx - 5, groundY - 31, 10, 4);
    // Sunlit top petal clusters
    ctx.fillStyle = cLight;
    ctx.fillRect(tx - 7, groundY - 30, 12, 3);
    ctx.fillRect(tx - 11, groundY - 24, 9, 3);
    ctx.fillRect(tx + 2, groundY - 25, 8, 3);
    // Pixel petal dithered specks
    ctx.fillRect(tx - 13, groundY - 21, 2, 1);
    ctx.fillRect(tx + 11, groundY - 22, 2, 1);
  }

  /** Draws organic rounded overhanging Sakura boughs (垂れ桜) framing top eaves (natural repoussoir). */
  private drawOverhangingSakuraBough(
    ctx: CanvasRenderingContext2D,
    side: 'left' | 'right',
    lightHex: string,
    midHex: string,
    shadeHex: string,
    t: number,
  ): void {
    const dir = side === 'left' ? 1 : -1;
    const ox = side === 'left' ? 10 : CANVAS_W - 10;
    const xAt = (dx: number, w = 1): number => (side === 'left' ? ox + dx : ox - dx - w);

    // Gnarled wooden branch arching out from eave
    ctx.fillStyle = '#3b2318';
    ctx.fillRect(xAt(0, 38), 11, 38, 3);
    ctx.fillRect(xAt(32, 28), 15, 28, 2);
    ctx.fillRect(xAt(56, 18), 19, 18, 2);
    ctx.fillStyle = '#5c3826';
    ctx.fillRect(xAt(2, 34), 12, 34, 1);
    ctx.fillRect(xAt(34, 24), 16, 24, 1);

    // Tapered rounded blossom clusters (shaded base -> mid oval -> sunlit top -> pendant petals)
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

    // Stepped oval silhouettes (no hard rectangular corners)
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

      // Delicate 1-2px drooping petal specks
      const sway = Math.round(Math.sin(t * 1.4 + i * 0.9 + dir) * 0.7);
      ctx.fillRect(xAt(dx + (w >> 1) + sway, 2), y + h + 1, 2, 2);
      ctx.fillRect(xAt(dx + (w >> 2) - sway, 1), y + h + 3, 1, 2);
    }
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

    const skyHorizonY = 98;
    // 1. 28-Band Bayer-Dithered Japanese Anime Sky (skyTop -> skyMid -> skyBottom)
    const bandCount = 28;
    const bandH = Math.ceil(skyHorizonY / bandCount);
    const sampleSkyBand = (frac: number): string => {
      if (frac < 0.55) return mixHex(pal.skyTop, pal.skyMid, frac / 0.55);
      return mixHex(pal.skyMid, pal.skyBottom, (frac - 0.55) / 0.45);
    };

    for (let b = 0; b < bandCount; b++) {
      const frac = b / (bandCount - 1);
      ctx.fillStyle = sampleSkyBand(frac);
      ctx.fillRect(0, b * bandH, CANVAS_W, bandH + 1);
      if (b < bandCount - 1) {
        ctx.fillStyle = sampleSkyBand((b + 1) / (bandCount - 1));
        const seamY = (b + 1) * bandH - 1;
        for (let x = 0; x < CANVAS_W; x += 1) {
          if (BAYER_4X4[((seamY & 3) << 2) | (x & 3)] < 6) {
            ctx.fillRect(x, seamY, 1, 1);
          }
        }
      }
    }

    // 2. Stars, Milky Way Stardust & Shooting Star (Dusk/Night)
    if (pal.starAlpha > 0.05) {
      for (let i = 0; i < 64; i++) {
        const sx = Math.floor(hash2i(i, 3, 91) * CANVAS_W);
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
      // Subtle shooting star every ~9 seconds
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

    // 3. Sun or Crescent Moon Disc (Golden Third Composition alignment above Fuji & Lake)
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

    // 4. Multi-Tone Japanese Pixel Cumulus Clouds (clear of Mt. Fuji's snow cap crown at x = 160)
    const cloudTop = h >= 19 || h < 5.5 ? '#7c8db5' : '#fffaf2';
    const cloudMid = h >= 19 || h < 5.5 ? '#4c5b82' : mixHex('#fffaf2', pal.skyBottom, 0.45);
    const cloudShade = h >= 19 || h < 5.5 ? '#2d3859' : mixHex(pal.skyMid, pal.farHill, 0.38);
    const baseCloudAlpha = h >= 19 || h < 5.5 ? 0.55 : 0.92;
    for (let c = 0; c < 4; c++) {
      const cx = Math.round(((248 + c * 124 + t * (1.5 + c * 0.35)) % (CANVAS_W + 96)) - 48);
      const cy = 22 + (c % 2) * 14;
      const distToFuji = Math.abs(cx - 160);
      if (distToFuji < 58 && cy > 20) continue;
      ctx.globalAlpha = distToFuji < 78 ? baseCloudAlpha * ((distToFuji - 58) / 20) : baseCloudAlpha;
      this.drawPixelCumulus(ctx, cx, cy, c % 2 === 0 ? 1 : 2, cloudTop, cloudMid, cloudShade);
    }
    ctx.globalAlpha = 1;

    // 5. Mt. Fuji (富士山 at left golden third x = 160) + Distant Ridge Silhouette
    for (let x = 0; x < CANVAS_W; x++) {
      const y = this.farHeights[x];
      const dxFuji = Math.abs(x - 160);
      const isFuji = dxFuji < 68 && y < 78;
      ctx.fillStyle = isFuji ? pal.fujiBody : pal.farHill;
      ctx.fillRect(x, y, 1, skyHorizonY - y);

      // Dithered Mt. Fuji Snow Cap (冠雪)
      if (isFuji && dxFuji < 24) {
        const snowDepth = Math.round(11 - dxFuji * 0.38 + ((x * 7) % 3));
        if (snowDepth > 0) {
          ctx.fillStyle = pal.fujiSnow;
          ctx.fillRect(x, y, 1, snowDepth);
          if (BAYER_4X4[((y + snowDepth) & 3) * 4 + (x & 3)] < 8) {
            ctx.fillRect(x, y + snowDepth, 1, 2);
          }
        }
      }
    }

    // Smooth Oklab Atmospheric Haze across Mt. Fuji foothills (y = 74..82) with 1px top feathering
    const seamHaze = mixHex(pal.fujiBody, pal.skyBottom, 0.14);
    for (let hy = 74; hy <= 82; hy++) {
      const hFrac = ((hy - 74) / 8) * 0.52;
      ctx.fillStyle = mixHex(pal.fujiBody, pal.skyBottom, hFrac);
      for (let mx = 76; mx <= 248; mx++) {
        if (this.farHeights[mx] <= hy) {
          ctx.fillRect(mx, hy, 1, 1);
        }
      }
    }
    ctx.fillStyle = seamHaze;
    for (let mx = 76; mx <= 248; mx++) {
      if (this.farHeights[mx] <= 73 && BAYER_4X4[((73 & 3) << 2) | (mx & 3)] < 6) {
        ctx.fillRect(mx, 73, 1, 1);
      }
      if (this.farHeights[mx] <= 74 && BAYER_4X4[((74 & 3) << 2) | (mx & 3)] < 10) {
        ctx.fillRect(mx, 74, 1, 1);
      }
    }

    // Ukiyo-e horizontal cloud wisp (霞雲) drifting past Mt. Fuji mid-slope (x = 190..236)
    ctx.fillStyle = h >= 19 || h < 5.5 ? '#5b6f9c' : '#fff7eb';
    ctx.globalAlpha = h >= 19 || h < 5.5 ? 0.42 : 0.76;
    ctx.fillRect(196, 54, 34, 2);
    ctx.fillRect(190, 56, 46, 2);
    ctx.fillRect(202, 58, 34, 1);
    ctx.globalAlpha = 1;

    // Sky flyers from cartridges behind mid hills
    for (let i = 0; i < this.visitors.length; i++) {
      const v = this.visitors[i];
      if (v.kind !== 'flyer') continue;
      const spr = atlasSpriteToCanvas(this.atlas, v.spriteB && Math.floor(t * 4 + v.phase) % 2 === 1 ? v.spriteB : v.spriteA);
      const fy = Math.round(v.baseY - 8 + Math.sin(t * 2.1 + v.phase) * 4);
      ctx.save();
      ctx.translate(Math.round(v.x) + 8, fy + 8);
      if (v.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(spr, -8, -8, 16, 16);
      ctx.restore();
    }

    // 6. Shimmering Pixel Lake Bay (x = 74..258, y = 82..110) with Mt. Fuji & Moon/Sun Water Glints
    const lakeTopY = 82;
    const lakeBotY = 110;
    for (let ly = lakeTopY; ly < lakeBotY; ly++) {
      const wf = (ly - lakeTopY) / (lakeBotY - lakeTopY);
      ctx.fillStyle = mixHex(pal.waterTop, pal.waterBot, wf);
      ctx.fillRect(74, ly, 184, 1);
    }
    // Shimmering 1px water reflection lines beneath celestial disc & Fuji
    ctx.fillStyle = pal.warmTint;
    ctx.globalAlpha = 0.58;
    for (let wy = lakeTopY + 2; wy < lakeBotY - 3; wy += 2) {
      const waveShift = Math.round(Math.sin(t * 3.2 + wy * 0.7) * 4);
      const wLen = Math.max(3, 14 - Math.floor((wy - lakeTopY) * 0.35));
      ctx.fillRect(celestialX - (wLen >> 1) + waveShift, wy, wLen, 1);
    }
    ctx.globalAlpha = 1;

    // 7. Mid-Ground Japanese Hillside, Five-Story Pagoda (五重塔), Vermilion Torii (鳥居) & Town Lights
    // Preserves calm negative space (x = 205..268) right above the handheld's central cartridge bay
    const midRim = mixHex(pal.midHill, pal.warmTint, 0.2);
    for (let x = 0; x < CANVAS_W; x++) {
      const y = this.midHeights[x];
      if (y < lakeBotY) {
        ctx.fillStyle = pal.midHill;
        ctx.fillRect(x, y, 1, lakeBotY - y);
        ctx.fillStyle = midRim;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Vermilion Torii Gate (赤い鳥居) on right-third lakeside bluff at x = 276
    const toriiX = 276;
    const toriiY = this.midHeights[toriiX] - 11;
    ctx.fillStyle = '#d93b48';
    ctx.fillRect(toriiX - 7, toriiY, 15, 2); // Kasagi top lintel
    ctx.fillRect(toriiX - 8, toriiY - 1, 2, 1);
    ctx.fillRect(toriiX + 7, toriiY - 1, 2, 1);
    ctx.fillRect(toriiX - 5, toriiY + 3, 11, 1); // Nuki tie beam
    ctx.fillRect(toriiX - 4, toriiY + 1, 2, 11); // Left pillar
    ctx.fillRect(toriiX + 3, toriiY + 1, 2, 11); // Right pillar

    // Five-Story Pagoda (五重塔) silhouette on right hillside at x = 352
    const pagX = 352;
    const pagBaseY = this.midHeights[pagX];
    ctx.fillStyle = mixHex(pal.midHill, '#141224', 0.55);
    ctx.fillRect(pagX, pagBaseY - 30, 1, 6); // Spire (Sorin)
    for (let tier = 0; tier < 4; tier++) {
      const ty = pagBaseY - 24 + tier * 6;
      const tw = 7 + tier * 2;
      ctx.fillRect(pagX - (tw >> 1), ty, tw, 2);
      ctx.fillRect(pagX - ((tw - 3) >> 1), ty + 2, tw - 3, 4);
    }

    // Distant Japanese Machiya Town Windows (glowing warm 2x2 amber dots at dusk/night)
    if (pal.fireIntensity > 0.2) {
      ctx.fillStyle = '#ffd466';
      for (let w = 0; w < 14; w++) {
        const wx = 298 + w * 9;
        const wy = this.midHeights[wx] + 2 + (w % 3) * 3;
        if (wy < 104 && ((w + Math.floor(t * 0.5)) % 5 !== 0)) {
          ctx.globalAlpha = 0.55 + 0.35 * pal.fireIntensity;
          ctx.fillRect(wx, wy, 2, 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Nostalgic Japanese Utility Pole (電線桿) & 1px Catenary Power Lines on left bluff (x = 84)
    const poleX = 84;
    const poleColor = mixHex(pal.midHill, '#161222', 0.65);
    ctx.fillStyle = poleColor;
    ctx.fillRect(poleX, 36, 2, 72);
    ctx.fillRect(poleX - 5, 40, 12, 1);
    ctx.fillRect(poleX - 4, 45, 10, 1);
    ctx.fillRect(poleX + 2, 51, 3, 4); // Transformer box
    ctx.globalAlpha = 0.45;
    for (let x = 10; x <= poleX; x++) {
      const sag = Math.round(Math.sin(((x - 10) / (poleX - 10)) * Math.PI) * 5);
      ctx.fillRect(x, 40 + sag, 1, 1);
      ctx.fillRect(x, 45 + sag, 1, 1);
    }
    ctx.globalAlpha = 1;

    // 8. Foreground Engawa Garden Meadow (y = 104..114)
    const grassRim = mixHex(pal.nearGrass, '#7ee09c', 0.26);
    for (let x = 0; x < CANVAS_W; x++) {
      const y = this.groundHeights[x];
      ctx.fillStyle = pal.nearGrass;
      ctx.fillRect(x, y, 1, CANVAS_H - y);
      ctx.fillStyle = grassRim;
      ctx.fillRect(x, y, 1, 1);
      if ((x & 3) === 0) ctx.fillRect(x, y - 1, 1, 1);
    }

    // Pixel Sakura & Cedar Trees framing outer wings without crowding Mt. Fuji or center slot
    this.drawPixelSakuraTree(ctx, 42, this.groundHeights[42] + 2, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, false);
    this.drawPixelSakuraTree(ctx, 78, this.groundHeights[78] + 2, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, true);
    this.drawPixelSakuraTree(ctx, 388, this.groundHeights[388] + 2, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, true);
    this.drawPixelSakuraTree(ctx, 442, this.groundHeights[442] + 3, pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, false);

    // Japanese Stone Lantern (石灯籠) at x = 302
    const lanX = 302;
    const lanY = this.groundHeights[lanX] - 13;
    ctx.fillStyle = '#6c768c';
    ctx.fillRect(lanX - 3, lanY + 11, 7, 2); // Base
    ctx.fillRect(lanX - 1, lanY + 6, 3, 5);  // Post
    ctx.fillRect(lanX - 3, lanY + 2, 7, 4);  // Light chamber
    ctx.fillRect(lanX - 5, lanY, 11, 2);     // Roof
    ctx.fillRect(lanX - 1, lanY - 2, 3, 2);  // Finial
    if (pal.fireIntensity > 0.1) {
      ctx.fillStyle = '#ffe070';
      ctx.fillRect(lanX - 1, lanY + 3, 3, 2);
    } else {
      ctx.fillStyle = '#384052';
      ctx.fillRect(lanX - 1, lanY + 3, 3, 2);
    }

    // 9. Momo & Flickering Campfire (right-third focal cluster x = 318..348)
    const campX = 338;
    const campY = this.groundHeights[campX] - 11;
    if (pal.fireIntensity > 0.1) {
      const flicker = 0.86 + 0.14 * simplex2D(t * 6.4, 2.3, 19);
      const cx = campX + 5;
      const cy = campY + 5;
      // Soft stepped pixel circle hearth glow (no boxy rectangle)
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

    // Beloved original Momo sitting beside the lantern/campfire!
    const momoSprite: SpriteId =
      this.momoHappyTimer > 0
        ? Math.floor(t * 8) % 2 === 0
          ? 'momo_wave_a'
          : 'momo_wave_b'
        : Math.floor(t * 0.5) % 9 === 0
          ? 'momo_happy'
          : 'momo_idle';
    const momoCanvas = atlasSpriteToCanvas(this.atlas, momoSprite);
    const momoHop = this.momoHappyTimer > 0 ? Math.abs(Math.sin(t * 14)) * 4 : 0;
    const momoX = 318;
    const momoY = Math.round(this.groundHeights[momoX] - 15 - momoHop);
    ctx.drawImage(momoCanvas, momoX, momoY, 16, 16);

    // 10. Roaming Cartridge Walker Cameos on the garden path
    for (let i = 0; i < this.visitors.length; i++) {
      const v = this.visitors[i];
      if (v.kind !== 'walker') continue;
      const frame2 = v.spriteB && Math.floor(t * 5 + v.phase) % 2 === 1;
      const spr = atlasSpriteToCanvas(this.atlas, frame2 ? v.spriteB! : v.spriteA);
      const gx = Math.max(0, Math.min(CANVAS_W - 1, Math.round(v.x)));
      const hop = Math.max(0, Math.sin(t * 4.5 + v.phase) * 2);
      const gy = this.groundHeights[gx] - 15 - Math.round(hop);
      ctx.save();
      ctx.translate(gx + 8, gy + 8);
      if (v.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(spr, -8, -8, 16, 16);
      ctx.restore();
    }

    // 11. Drifting Sakura Petals (桜吹雪) & Night Fireflies (蛍)
    for (let i = 0; i < 16; i++) {
      const px = Math.round(((i * 37 + t * (9 + (i % 4) * 2) + Math.sin(t * 1.6 + i) * 8) % (CANVAS_W - 24)) + 12);
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

    // 12. Japanese Engawa Architectural Framing (軒先・垂れ桜・提灯・江戸風鈴・抹茶＆三色団子)
    // Natural Repoussoir: lush overhanging Sakura boughs framing top-left & top-right corners
    this.drawOverhangingSakuraBough(ctx, 'left', pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, t);
    this.drawOverhangingSakuraBough(ctx, 'right', pal.sakuraLight, pal.sakuraMid, pal.sakuraShade, t);

    // Top wooden lintel & Kumiko lattice trim
    ctx.fillStyle = '#2d1c14';
    ctx.fillRect(0, 0, CANVAS_W, 8);
    ctx.fillStyle = '#5c3a28';
    ctx.fillRect(0, 0, CANVAS_W, 6);
    ctx.fillStyle = '#7a4f38';
    ctx.fillRect(0, 1, CANVAS_W, 2);
    // Side wooden pillars
    ctx.fillStyle = '#3b2419';
    ctx.fillRect(0, 0, 10, CANVAS_H);
    ctx.fillRect(CANVAS_W - 10, 0, 10, CANVAS_H);
    ctx.fillStyle = '#5c3a28';
    ctx.fillRect(2, 0, 5, CANVAS_H);
    ctx.fillRect(CANVAS_W - 7, 0, 5, CANVAS_H);

    // Warm Paper Lantern (提灯) hanging from left pillar (x = 18, y = 30..44)
    const choX = 18;
    const choY = 30;
    if (pal.fireIntensity > 0.1) {
      ctx.globalAlpha = 0.18 * pal.fireIntensity;
      ctx.fillStyle = '#ff9e4a';
      ctx.fillRect(choX - 7, choY - 2, 18, 16);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#3b2419';
    ctx.fillRect(10, choY - 4, 10, 2); // Wooden bracket
    ctx.fillRect(choX + 1, choY - 2, 2, 2); // Hook cord
    ctx.fillStyle = '#2d1c14';
    ctx.fillRect(choX, choY, 5, 1); // Top cap
    ctx.fillRect(choX, choY + 9, 5, 1); // Bottom cap
    ctx.fillStyle = pal.fireIntensity > 0.15 ? '#ffd478' : '#ffe9cc';
    ctx.fillRect(choX - 1, choY + 1, 7, 8); // Paper lantern body
    ctx.fillStyle = '#d95b48';
    ctx.fillRect(choX - 1, choY + 3, 7, 1); // Rib band 1
    ctx.fillRect(choX - 1, choY + 6, 7, 1); // Rib band 2

    // Hanging Japanese Glass Wind Chime (江戸風鈴) at x = 314 (completely clear of top-right utility bar)
    const chimeX = 314;
    const sway = Math.round(Math.sin(t * 2.2) * 1.5);
    ctx.fillStyle = '#2d1c14';
    ctx.fillRect(chimeX, 7, 1, 10); // String
    ctx.fillStyle = '#8ce8ff';
    ctx.fillRect(chimeX - 3, 17, 7, 5); // Glass bell dome
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(chimeX - 2, 18, 2, 2); // Glass highlight
    ctx.fillStyle = '#ff708d';
    ctx.fillRect(chimeX - 2, 20, 5, 1); // Floral pattern band
    ctx.fillStyle = '#3b2419';
    ctx.fillRect(chimeX + sway, 22, 1, 4); // Lower thread
    // Fluttering Tanzaku paper slip (短冊)
    ctx.fillStyle = '#fff5e4';
    ctx.fillRect(chimeX - 1 + sway, 26, 3, 9);
    ctx.fillStyle = '#ff708d';
    ctx.fillRect(chimeX - 1 + sway, 26, 3, 2);

    // Warm Wooden Engawa Veranda Deck at y = 114 (38.0% Golden Ratio line -> >45px above console!)
    const deckY = 114;
    ctx.fillStyle = '#261710';
    ctx.fillRect(0, deckY, CANVAS_W, 2);
    ctx.fillStyle = '#8a5638';
    ctx.fillRect(0, deckY + 2, CANVAS_W, 8);
    ctx.fillStyle = '#a86e4c';
    ctx.fillRect(0, deckY + 2, CANVAS_W, 2);
    ctx.fillStyle = '#6e4228';
    ctx.fillRect(0, deckY + 7, CANVAS_W, 2);
    // Plank joinery ticks along the veranda rail
    ctx.fillStyle = '#4a2c1d';
    for (let px = 24; px < CANVAS_W; px += 48) {
      ctx.fillRect(px, deckY + 2, 1, 8);
    }

    // Steaming Matcha Teacup & Tri-Color Hanami Dango (三色団子) on left veranda rail (x = 96..118)
    const cupX = 96;
    const cupY = deckY - 5;
    ctx.fillStyle = '#4e6e58';
    ctx.fillRect(cupX, cupY, 6, 5);
    ctx.fillStyle = '#78a884';
    ctx.fillRect(cupX + 1, cupY + 1, 2, 3);
    ctx.fillStyle = '#261710';
    ctx.fillRect(cupX + 1, cupY + 5, 4, 1);
    // Animated 1px rising tea steam
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = '#fffaf0';
    const steamShift = Math.floor(t * 3) % 2;
    ctx.fillRect(cupX + 2 + steamShift, cupY - 3, 1, 2);
    ctx.fillRect(cupX + 3 - steamShift, cupY - 6, 1, 2);
    ctx.globalAlpha = 1;

    // Tri-Color Hanami Dango Plate beside the teacup (x = 107)
    const danX = 107;
    const danY = deckY - 4;
    ctx.fillStyle = '#5c3a28';
    ctx.fillRect(danX, danY + 3, 12, 1); // Small wooden dish
    ctx.fillStyle = '#c89e68';
    ctx.fillRect(danX + 1, danY + 1, 10, 1); // Bamboo skewer
    ctx.fillStyle = '#ff9eb5'; // Sakura pink dango
    ctx.fillRect(danX + 2, danY, 3, 3);
    ctx.fillStyle = '#fffaf0'; // Milk white dango
    ctx.fillRect(danX + 5, danY, 3, 3);
    ctx.fillStyle = '#78b888'; // Matcha green dango
    ctx.fillRect(danX + 8, danY, 3, 3);

    // Lower Interior Tatami & Hinoki Wood Atelier Floor (y = 124..270)
    const tatamiTop = mixHex('#4a543c', pal.wallTop, 0.42);
    const tatamiAlt = mixHex('#3f4833', pal.wallBot, 0.42);
    const beriColor = '#28362c';
    for (let y = deckY + 10; y < CANVAS_H; y++) {
      ctx.fillStyle = (y & 1) === 0 ? tatamiTop : tatamiAlt;
      ctx.fillRect(10, y, CANVAS_W - 20, 1);
    }
    // Tatami mat decorative brocade borders (畳縁)
    ctx.fillStyle = beriColor;
    ctx.fillRect(10, deckY + 34, CANVAS_W - 20, 2);
    ctx.fillRect(160, deckY + 10, 2, CANVAS_H - (deckY + 10));
    ctx.fillRect(320, deckY + 10, 2, CANVAS_H - (deckY + 10));
  }

  public destroy(): void {
    this.ac.abort();
  }
}
