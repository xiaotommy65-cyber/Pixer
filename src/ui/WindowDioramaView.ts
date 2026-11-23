import type { TextureAtlas } from '../assets/TextureAtlas.ts';
import type { EngineHost } from '../core/runtime/EngineHost.ts';
import {
  DIORAMA_CANVAS_H,
  DIORAMA_CANVAS_W,
  getCartridgeCameoSpec,
  precomputeDioramaTerrain,
  sampleDioramaPaletteAtHour,
  type DioramaCameoVisitor,
  type DioramaPerspective,
  type DioramaTimeMode,
} from './DioramaPalette.ts';
import { renderDioramaCanvas } from './DioramaSceneRenderer.ts';
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

export type { DioramaPerspective, DioramaTimeMode };

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

/**
 * Full-Viewport 480x270 Japanese Pixel-Art Veranda & Fantasy Console Atelier Backdrop Shell:
 * coordinates DOM frame, desk surface switcher, visitor simulation, and delegates
 * palette/terrain math to `DioramaPalette.ts` and pixel-art drawing to `DioramaSceneRenderer.ts`.
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

  private readonly farHeights = new Int16Array(DIORAMA_CANVAS_W);
  private readonly midHeights = new Int16Array(DIORAMA_CANVAS_W);
  private readonly groundHeights = new Int16Array(DIORAMA_CANVAS_W);

  private timeMode: DioramaTimeMode = 'auto';
  private perspective: DioramaPerspective = 'focus';
  private surfaceStyle: DeskSurfaceStyle = readSavedSurfaceStyle();
  private shellPhase = 'BOOT_BLINK';
  private bootStage = 'standby';

  private elapsedSec = 0;
  private redrawAccum = 0;
  private momoHappyTimer = 0;
  private lastWallCssKey = '';
  private cachedShellEl: Element | null = null;
  private visitors: DioramaCameoVisitor[] = [];
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
    this.canvas.width = DIORAMA_CANVAS_W;
    this.canvas.height = DIORAMA_CANVAS_H;
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

    precomputeDioramaTerrain(this.farHeights, this.midHeights, this.groundHeights);
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
    const chosen: DioramaCameoVisitor[] = [];
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

  private isLandscapeHidden(): boolean {
    if (typeof document === 'undefined') return false;
    if (!this.cachedShellEl || !this.cachedShellEl.isConnected) {
      this.cachedShellEl = this.backdropEl.closest('.atelier-shell');
    }
    return Boolean(this.cachedShellEl?.classList.contains('is-handheld-landscape'));
  }

  public tick(dt: number): void {
    if (typeof document !== 'undefined') {
      if (document.body.dataset.perf === 'eco' && this.shellPhase === 'IN_GAME') return;
      if (this.isLandscapeHidden()) return;
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
      } else if (v.x > DIORAMA_CANVAS_W - 48) {
        v.x = DIORAMA_CANVAS_W - 48;
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

  private renderScene(updateChip: boolean): void {
    const h = this.getEffectiveHour();
    const pal = sampleDioramaPaletteAtHour(h);

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

    if (!this.ctx) return;
    renderDioramaCanvas({
      ctx: this.ctx,
      atlas: this.atlas,
      hour: h,
      elapsedSec: this.elapsedSec,
      momoHappyTimer: this.momoHappyTimer,
      palette: pal,
      farHeights: this.farHeights,
      midHeights: this.midHeights,
      groundHeights: this.groundHeights,
      visitors: this.visitors,
    });
  }

  public destroy(): void {
    this.ac.abort();
    this.cachedShellEl = null;
  }
}
