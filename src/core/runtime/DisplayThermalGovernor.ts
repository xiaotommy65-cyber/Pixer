import {
  GAME_H,
  GAME_W,
  normalizePerformanceProfile,
  type RenderPerformanceProfile,
  type ResolutionScaleFactor,
} from '../gpu/GpuTypes.ts';

export interface DisplayThermalSnapshot {
  profile: RenderPerformanceProfile;
  scaleFactor: ResolutionScaleFactor;
  pixelWidth: number;
  pixelHeight: number;
  emaFrameMs: number;
  isBackground: boolean;
}

/**
 * Pure DOM-free display & thermal governor controlling integer pixel scaling
 * (320x180 * 1..3), rolling frame-time thermal step-down/recovery, idle lobby
 * frame pacing (30fps / 20fps), and background execution freezing.
 */
export class DisplayThermalGovernor {
  private profile: RenderPerformanceProfile;
  private scaleFactor: ResolutionScaleFactor;
  private viewportCssW = 640;
  private dpr = 1;
  private isCompactMobile = false;
  private viewW = GAME_W;
  private viewH = GAME_H;

  private emaFrameMs = 4.0;
  private overBudgetFrames = 0;
  private underBudgetFrames = 0;
  private background = false;
  private idleAccumSec = 0;

  constructor(initialProfile: RenderPerformanceProfile = 'balanced', isCompactMobile = false) {
    this.profile = normalizePerformanceProfile(initialProfile);
    this.isCompactMobile = isCompactMobile;
    this.scaleFactor = this.computeBaselineScale();
  }

  private computeBaselineScale(): ResolutionScaleFactor {
    if (this.profile === 'eco') return 1;
    if (this.profile === 'quality') return 3;
    // Balanced baseline: mobile phones start at crisp 2x (640x360, 55% less fill-rate than 3x);
    // large desktop displays with high viewport width can start at 2x or 3x.
    if (this.isCompactMobile) return 2;
    return this.viewportCssW * Math.min(2, this.dpr) >= 840 ? 3 : 2;
  }

  public getProfile(): RenderPerformanceProfile {
    return this.profile;
  }

  public setProfile(profile: RenderPerformanceProfile): void {
    const next = normalizePerformanceProfile(profile);
    if (this.profile === next) return;
    this.profile = next;
    this.overBudgetFrames = 0;
    this.underBudgetFrames = 0;
    this.emaFrameMs = 4.0;
    this.scaleFactor = this.computeBaselineScale();
  }

  public setViewportMetrics(cssWidth: number, dpr: number, isCompactMobile: boolean): void {
    const prevCompact = this.isCompactMobile;
    this.viewportCssW = Math.max(160, cssWidth);
    this.dpr = Math.max(1, Math.min(3, dpr || 1));
    this.isCompactMobile = isCompactMobile;
    if (prevCompact !== isCompactMobile && this.overBudgetFrames === 0 && this.underBudgetFrames === 0) {
      this.scaleFactor = this.computeBaselineScale();
    }
  }

  public setLogicalViewport(width: number, height: number): boolean {
    const w = Math.max(160, Math.round(width));
    const h = Math.max(90, Math.round(height));
    if (this.viewW === w && this.viewH === h) return false;
    this.viewW = w;
    this.viewH = h;
    return true;
  }

  public getLogicalViewport(): { width: number; height: number } {
    return { width: this.viewW, height: this.viewH };
  }

  public setBackground(hidden: boolean): void {
    this.background = hidden;
    if (!hidden) {
      this.idleAccumSec = 0;
      this.overBudgetFrames = 0;
    }
  }

  public isBackground(): boolean {
    return this.background;
  }

  public getScaleFactor(): ResolutionScaleFactor {
    return this.scaleFactor;
  }

  public getTargetPixelSize(): { width: number; height: number } {
    return {
      width: this.viewW * this.scaleFactor,
      height: this.viewH * this.scaleFactor,
    };
  }

  /**
   * Decides whether an idle surface (Home Lobby, paused overlay, or editor) should tick/render
   * on this RAF invocation. Active gameplay runs uncapped at display refresh; idle surfaces pace
   * at 30fps (balanced/quality) or 20fps (eco) to avoid unnecessary phone heat.
   */
  public shouldRenderThisFrame(dtSec: number, isActiveGameplay: boolean, idleTargetFps?: number): boolean {
    if (this.background) return false;
    if (isActiveGameplay) {
      this.idleAccumSec = 0;
      return true;
    }
    const fps = idleTargetFps ?? (this.profile === 'eco' ? 20 : this.profile === 'quality' ? 0 : 30);
    const targetInterval = fps > 0 ? 1 / fps : 0;
    if (targetInterval <= 0) return true;
    this.idleAccumSec += dtSec;
    if (this.idleAccumSec >= targetInterval) {
      this.idleAccumSec %= targetInterval;
      return true;
    }
    return false;
  }

  /**
   * Feeds real frame render+step cost (ms) into the rolling thermal governor.
   * Returns true if the target canvas resolution scale factor changed.
   */
  public recordFrameCostMs(frameCostMs: number, isActiveGameplay: boolean): boolean {
    if (!isActiveGameplay || !Number.isFinite(frameCostMs) || frameCostMs < 0) return false;

    this.emaFrameMs = this.emaFrameMs * 0.9 + frameCostMs * 0.1;

    const downThreshold = this.profile === 'eco' ? 10.5 : this.profile === 'balanced' ? 14.2 : 18.0;
    const upThreshold = this.profile === 'eco' ? 4.5 : this.profile === 'balanced' ? 8.2 : 10.5;
    const minScale: ResolutionScaleFactor = 1;
    const maxScale: ResolutionScaleFactor =
      this.profile === 'eco'
        ? 2
        : this.profile === 'balanced' && this.isCompactMobile
          ? 2
          : 3;

    if (this.emaFrameMs > downThreshold) {
      this.overBudgetFrames++;
      this.underBudgetFrames = 0;
      const needFrames = this.profile === 'quality' ? 75 : 45;
      if (this.overBudgetFrames >= needFrames && this.scaleFactor > minScale) {
        this.scaleFactor = (this.scaleFactor - 1) as ResolutionScaleFactor;
        this.overBudgetFrames = 0;
        return true;
      }
    } else if (this.emaFrameMs < upThreshold) {
      this.underBudgetFrames++;
      this.overBudgetFrames = 0;
      if (this.underBudgetFrames >= 180 && this.scaleFactor < maxScale) {
        this.scaleFactor = (this.scaleFactor + 1) as ResolutionScaleFactor;
        this.underBudgetFrames = 0;
        return true;
      }
    } else {
      this.overBudgetFrames = Math.max(0, this.overBudgetFrames - 1);
      this.underBudgetFrames = Math.max(0, this.underBudgetFrames - 1);
    }

    return false;
  }

  public getSnapshot(): DisplayThermalSnapshot {
    const { width, height } = this.getTargetPixelSize();
    return {
      profile: this.profile,
      scaleFactor: this.scaleFactor,
      pixelWidth: width,
      pixelHeight: height,
      emaFrameMs: Number(this.emaFrameMs.toFixed(2)),
      isBackground: this.background,
    };
  }
}
