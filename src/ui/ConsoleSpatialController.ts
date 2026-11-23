export interface ConsoleSpatialControllerOptions {
  stageEl: HTMLElement;
  spatialTrackEl: HTMLElement;
  parallaxTargets: readonly HTMLElement[];
  canApplyParallax: () => boolean;
  onActivePageChange: (pageIdx: 0 | 1 | 2) => void;
}

/**
 * Self-contained controller for the handheld desk's 3-page spatial track,
 * ResizeObserver alignment, and mouse / gyroscope `--px`/`--py` parallax.
 * Preserves exact CSS custom properties (`--px`, `--py`) while keeping timers & RAF cleanly cancellable.
 */
export class ConsoleSpatialController {
  private readonly opts: ConsoleSpatialControllerOptions;
  private readonly ac = new AbortController();
  private readonly trackResizeObserver: ResizeObserver | null = null;

  private spatialTrackWidth = 0;
  private activeDeskPage: 0 | 1 | 2 = 1;
  private isDeskScrolling = false;
  private deskScrollTimer: number | null = null;
  private bootAlignRaf: number | null = null;
  private lastParallaxMs = 0;

  constructor(opts: ConsoleSpatialControllerOptions) {
    this.opts = opts;
    const { signal } = this.ac;

    const syncTrackWidth = () => {
      const w = this.opts.spatialTrackEl.clientWidth;
      if (w > 0 && w !== this.spatialTrackWidth) {
        this.spatialTrackWidth = w;
        this.scrollToPage(this.activeDeskPage, false);
      }
    };
    if (typeof ResizeObserver !== 'undefined') {
      this.trackResizeObserver = new ResizeObserver(syncTrackWidth);
      this.trackResizeObserver.observe(this.opts.spatialTrackEl);
    }
    window.addEventListener('resize', syncTrackWidth, { passive: true, signal });

    this.opts.spatialTrackEl.addEventListener(
      'scroll',
      () => {
        this.isDeskScrolling = true;
        if (this.deskScrollTimer !== null) {
          window.clearTimeout(this.deskScrollTimer);
        }
        this.deskScrollTimer = window.setTimeout(() => {
          this.deskScrollTimer = null;
          this.isDeskScrolling = false;
        }, 180);

        const w = this.spatialTrackWidth || this.opts.spatialTrackEl.clientWidth;
        if (w <= 0) return;
        const idx = Math.max(0, Math.min(2, Math.round(this.opts.spatialTrackEl.scrollLeft / w))) as 0 | 1 | 2;
        if (idx !== this.activeDeskPage) {
          this.activeDeskPage = idx;
          this.opts.onActivePageChange(idx);
          if (idx !== 1) this.setParallax(0, 0);
        }
      },
      { passive: true, signal },
    );

    this.opts.stageEl.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        if (!this.isParallaxInteractive()) return;
        const now = performance.now();
        if (now - this.lastParallaxMs < 24) return;
        this.lastParallaxMs = now;
        const rect = this.opts.stageEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const nx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width - 0.5) * 2));
        const ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height - 0.5) * 2));
        this.setParallax(nx, ny);
      },
      { passive: true, signal },
    );
    this.opts.stageEl.addEventListener('pointerleave', () => this.setParallax(0, 0), { signal });

    window.addEventListener(
      'deviceorientation',
      (ev) => {
        if (!this.isParallaxInteractive()) return;
        if (ev.gamma === null || ev.beta === null) return;
        const now = performance.now();
        if (now - this.lastParallaxMs < 48) return;
        this.lastParallaxMs = now;
        const nx = Math.max(-1, Math.min(1, ev.gamma / 30));
        const ny = Math.max(-1, Math.min(1, (ev.beta - 35) / 30));
        this.setParallax(nx, ny);
      },
      { passive: true, signal },
    );
  }

  private isParallaxInteractive(): boolean {
    return !this.isDeskScrolling && this.activeDeskPage === 1 && this.opts.canApplyParallax();
  }

  public setParallax(nx: number, ny: number): void {
    const px = nx.toFixed(3);
    const py = ny.toFixed(3);
    for (let i = 0; i < this.opts.parallaxTargets.length; i++) {
      const target = this.opts.parallaxTargets[i];
      target.style.setProperty('--px', px);
      target.style.setProperty('--py', py);
    }
  }

  public scrollToPage(pageIdx: 0 | 1 | 2, smooth: boolean): void {
    const w = this.spatialTrackWidth || this.opts.spatialTrackEl.clientWidth;
    if (w > 0) {
      this.opts.spatialTrackEl.scrollTo({
        left: w * pageIdx,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
    this.activeDeskPage = pageIdx;
    this.opts.onActivePageChange(pageIdx);
  }

  public scheduleCenterAlignment(): void {
    if (this.bootAlignRaf !== null) {
      cancelAnimationFrame(this.bootAlignRaf);
    }
    this.bootAlignRaf = requestAnimationFrame(() => {
      this.bootAlignRaf = null;
      this.spatialTrackWidth = this.opts.spatialTrackEl.clientWidth;
      this.scrollToPage(1, false);
    });
  }

  public destroy(): void {
    this.trackResizeObserver?.disconnect();
    this.ac.abort();
    if (this.deskScrollTimer !== null) {
      window.clearTimeout(this.deskScrollTimer);
      this.deskScrollTimer = null;
    }
    if (this.bootAlignRaf !== null) {
      cancelAnimationFrame(this.bootAlignRaf);
      this.bootAlignRaf = null;
    }
  }
}
