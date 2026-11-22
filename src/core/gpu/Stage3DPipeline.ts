import type { AudioSpectrumFrame } from '../audio/RhythmAudioEngine.ts';
import {
  NOTE_HIT,
  NOTE_HOLDING,
  NOTE_MISSED,
  type RhythmJudgeEngine,
  type RhythmLiveState,
} from '../rhythm/RhythmJudgeEngine.ts';
import {
  formatKeyCodeLabel,
  type RhythmCameraStyle,
  type RhythmJudgeTier,
  type RhythmPlayerConfig,
  type RhythmSongProject,
} from '../rhythm/RhythmTypes.ts';
import {
  CameraRigDirector,
  type CameraShotId,
  type ProjectedPoint2D,
} from '../runtime/CameraRigDirector.ts';
import type { GameSceneId } from '../runtime/GameFlowController.ts';

/**
 * Engine 10.0 — Continuous 3D Perspective Celestial Stage & 4K Highway Renderer.
 *
 * Uses `CameraRigDirector`'s exact 4x4 View-Projection matrix to render a unified,
 * live 3D architectural concert venue across EVERY game scene (Title, Lobby,
 * Song Select, Course Hall, Profile, Fly-In Intro, 4K Live Play, and Result).
 * Switching screens moves the virtual 3D camera inside the same stage — zero hard cuts.
 * Strictly Zero-GC inside `render()`.
 */

interface Particle3D {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

interface Shockwave3D {
  active: boolean;
  x: number;
  z: number;
  life: number;
  maxLife: number;
  maxRadius: number;
  r: number;
  g: number;
  b: number;
}

interface AmbientMote3D {
  x: number;
  y: number;
  z: number;
  speedY: number;
  driftPhase: number;
  size: number;
  warm: boolean;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const MAX_PARTICLES = 112;
const MAX_SHOCKWAVES = 20;
const AMBIENT_MOTE_COUNT = 56;
const HIGHWAY_HALF_WIDTH = 2.24;
const HIGHWAY_LANE_W = (HIGHWAY_HALF_WIDTH * 2) / 4;
const HIGHWAY_HORIZON_Z = -30.0;
const HIGHWAY_NEAR_Z = 0.72;
const JUDGE_Z = 0.0;

const TIER_COLORS: Record<RhythmJudgeTier, { hex: string; rgb: RgbColor }> = {
  MARVELOUS: { hex: '#f8fafc', rgb: { r: 248, g: 250, b: 252 } },
  PERFECT: { hex: '#f59e0b', rgb: { r: 245, g: 158, b: 11 } },
  GREAT: { hex: '#38bdf8', rgb: { r: 56, g: 189, b: 248 } },
  GOOD: { hex: '#a78bfa', rgb: { r: 167, g: 139, b: 250 } },
  MISS: { hex: '#f43f5e', rgb: { r: 244, g: 63, b: 94 } },
};

export function mapRhythmStyleToCameraShot(style: RhythmCameraStyle): CameraShotId {
  switch (style) {
    case 'CALM':
      return 'PLAY_ESTABLISHING';
    case 'BUILD':
      return 'PLAY_HERO_LOW';
    case 'PULSE':
      return 'PLAY_STANDARD';
    case 'DROP':
      return 'PLAY_OVERDRIVE';
    case 'TILT_LEFT':
      return 'PLAY_SWEEP_LEFT';
    case 'TILT_RIGHT':
      return 'PLAY_SWEEP_RIGHT';
  }
}

export class Stage3DPipeline {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  public readonly camera: CameraRigDirector;

  private cssW = 1280;
  private cssH = 720;
  private dpr = 1;
  private elapsedSec = 0;
  private cachedBaseGrad: CanvasGradient | null = null;
  private cachedFrameGrad: CanvasGradient | null = null;

  // Backdrop dome art & active jacket art (injected by UI layer — zero hardcoded fetch)
  private domeImage: HTMLImageElement | null = null;
  private jacketImage: HTMLImageElement | null = null;

  // Smoothly interpolated stage lighting colors
  private readonly curPrimary: RgbColor = { r: 56, g: 189, b: 248 };
  private readonly curSecondary: RgbColor = { r: 245, g: 158, b: 11 };
  private readonly targetPrimary: RgbColor = { r: 56, g: 189, b: 248 };
  private readonly targetSecondary: RgbColor = { r: 245, g: 158, b: 11 };

  // Highway visibility & unfold animation (0 in menus, smooth 0->1 during Fly-In, 1->0 in Result)
  private highwayPresence = 0;
  private targetHighwayPresence = 0;
  private stageSpotlightIntensity = 0.65;

  // Judgement HUD animation state
  private lastSeenJudgeTimeMs = -99999;
  private judgePopTimer = 0;
  private judgeTier: RhythmJudgeTier = 'MARVELOUS';
  private judgeDeltaMs = 0;
  private judgeIsHoldTick = false;
  private comboScale = 1.0;
  private lastCombo = 0;
  private feverFlash = 0;
  private lastFeverTier = 0;

  // Pre-allocated Zero-GC projection scratch points
  private readonly p0: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  private readonly p1: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  private readonly p2: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  private readonly p3: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  private readonly pCenter: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  private readonly pChordA: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };
  private readonly pChordB: ProjectedPoint2D = { x: 0, y: 0, ndcZ: 0, scale: 0, visible: false };

  // Pre-allocated Zero-GC object pools
  private readonly particles: Particle3D[] = [];
  private particleCursor = 0;
  private readonly shockwaves: Shockwave3D[] = [];
  private shockwaveCursor = 0;
  private readonly motes: AmbientMote3D[] = [];

  constructor(canvas: HTMLCanvasElement, camera?: CameraRigDirector) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Stage3DPipeline 無法初始化 2D 合成上下文');
    this.ctx = ctx;
    this.camera = camera ?? new CameraRigDirector('TITLE_ORBIT');

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.4,
        size: 3,
        r: 56,
        g: 189,
        b: 248,
      });
    }
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      this.shockwaves.push({
        active: false,
        x: 0,
        z: 0,
        life: 0,
        maxLife: 0.36,
        maxRadius: 0.9,
        r: 245,
        g: 158,
        b: 11,
      });
    }
    for (let i = 0; i < AMBIENT_MOTE_COUNT; i++) {
      // Deterministic golden-ratio spread across concert hall volume
      const f1 = (i * 0.6180339887) % 1;
      const f2 = ((i * 1.3247179572) + 0.17) % 1;
      const f3 = ((i * 0.7548776662) + 0.41) % 1;
      this.motes.push({
        x: (f1 - 0.5) * 26,
        y: 0.6 + f2 * 10.5,
        z: -2 - f3 * 36,
        speedY: 0.25 + f1 * 0.42,
        driftPhase: i * 1.13,
        size: 1.4 + (i % 4) * 0.65,
        warm: i % 3 === 0,
      });
    }
  }

  public setDomeImage(img: HTMLImageElement | null): void {
    this.domeImage = img;
  }

  public setActiveJacketImage(img: HTMLImageElement | null): void {
    this.jacketImage = img;
  }

  public setThemeColors(primaryHex: string, secondaryHex: string): void {
    parseHexIntoRgb(primaryHex, this.targetPrimary);
    parseHexIntoRgb(secondaryHex, this.targetSecondary);
  }

  public resetEffects(): void {
    this.lastSeenJudgeTimeMs = -99999;
    this.judgePopTimer = 0;
    this.comboScale = 1.0;
    this.lastCombo = 0;
    this.feverFlash = 0;
    this.lastFeverTier = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles[i].active = false;
    for (let i = 0; i < MAX_SHOCKWAVES; i++) this.shockwaves[i].active = false;
  }

  public resize(cssWidth: number, cssHeight: number, devicePixelRatio = 1): void {
    const w = Math.max(320, Math.floor(cssWidth));
    const h = Math.max(200, Math.floor(cssHeight));
    const cappedDpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
    const targetPw = Math.floor(w * cappedDpr);
    const targetPh = Math.floor(h * cappedDpr);
    if (
      w === this.cssW &&
      h === this.cssH &&
      cappedDpr === this.dpr &&
      this.canvas.width === targetPw &&
      this.canvas.height === targetPh
    ) {
      return;
    }
    this.cssW = w;
    this.cssH = h;
    this.dpr = cappedDpr;
    this.canvas.width = targetPw;
    this.canvas.height = targetPh;

    const bg = this.ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#040814');
    bg.addColorStop(0.55, '#091122');
    bg.addColorStop(1, '#050811');
    this.cachedBaseGrad = bg;

    const fg = this.ctx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.38, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(1, 'rgba(3, 6, 14, 0.58)');
    this.cachedFrameGrad = fg;
  }

  /**
   * Renders one complete 3D architectural stage frame for any scene (`title` .. `result`).
   */
  public render(params: {
    dtSec: number;
    scene: GameSceneId;
    spectrum: Readonly<AudioSpectrumFrame>;
    project: RhythmSongProject | null;
    config: RhythmPlayerConfig;
    judgeEngine: RhythmJudgeEngine | null;
    liveState: RhythmLiveState | null;
    introProgress?: number;
  }): void {
    const dt = Math.max(0.001, Math.min(0.05, params.dtSec));
    this.elapsedSec += dt;

    const { scene, spectrum, project, config, judgeEngine, liveState } = params;

    // 1. Update theme colors & highway unfold state
    const cAlpha = 1 - Math.exp(-dt * 4.5);
    this.curPrimary.r += (this.targetPrimary.r - this.curPrimary.r) * cAlpha;
    this.curPrimary.g += (this.targetPrimary.g - this.curPrimary.g) * cAlpha;
    this.curPrimary.b += (this.targetPrimary.b - this.curPrimary.b) * cAlpha;
    this.curSecondary.r += (this.targetSecondary.r - this.curSecondary.r) * cAlpha;
    this.curSecondary.g += (this.targetSecondary.g - this.curSecondary.g) * cAlpha;
    this.curSecondary.b += (this.targetSecondary.b - this.curSecondary.b) * cAlpha;

    if (scene === 'playing' || scene === 'paused') {
      this.targetHighwayPresence = 1;
      this.stageSpotlightIntensity = 0.85;
    } else if (scene === 'intro') {
      this.targetHighwayPresence = Math.max(0.15, params.introProgress ?? 0.5);
      this.stageSpotlightIntensity = 0.95;
    } else {
      this.targetHighwayPresence = 0;
      this.stageSpotlightIntensity = scene === 'title' ? 0.72 : 0.6;
    }
    const hAlpha = 1 - Math.exp(-dt * (scene === 'intro' ? 6.5 : 8.0));
    this.highwayPresence += (this.targetHighwayPresence - this.highwayPresence) * hAlpha;

    // 2. Drive 3D Camera Rig from active gameplay cues when playing
    if (scene === 'playing' && liveState) {
      this.camera.setStaticGameplayLock(!config.cameraDynamic);
      const targetShot = config.cameraDynamic
        ? mapRhythmStyleToCameraShot(liveState.camera.style)
        : 'PLAY_STANDARD';
      if (this.camera.getActiveShot() !== targetShot) {
        this.camera.setShot(targetShot, 5.8);
      }
      if (liveState.camera.kick > 0.32 && config.cameraDynamic) {
        this.camera.triggerBeatKick(liveState.camera.kick * 0.65);
      }
      // Track Fever milestones
      if (liveState.feverTier > this.lastFeverTier) {
        this.feverFlash = 1.0;
        this.camera.addShakeTrauma(0.32);
      }
      this.lastFeverTier = liveState.feverTier;
      this.ingestLiveJudgement(liveState);
    }

    this.camera.step(dt, this.cssW / this.cssH);

    // Update decaying timers & pools
    this.judgePopTimer = Math.max(0, this.judgePopTimer - dt);
    this.comboScale += (1.0 - this.comboScale) * Math.min(1, dt * 15);
    this.feverFlash = Math.max(0, this.feverFlash - dt * 1.8);
    this.stepPools(dt);

    // 3. Begin frame drawing
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const feverTier = liveState && (scene === 'playing' || scene === 'paused') ? liveState.feverTier : 0;
    const beatEnergy = Math.min(
      1.2,
      spectrum.subBass * 0.95 + (liveState ? liveState.camera.kick * 0.55 : 0),
    );

    // Layer 1: Celestial Concert Hall Dome Backdrop (parallax-driven by 3D camera yaw/pitch)
    this.drawConcertDomeBackdrop(ctx, w, h, beatEnergy, feverTier, scene);

    // Layer 2: Volumetric Architectural Stage Beams
    this.drawVolumetricStageBeams(ctx, w, h, spectrum, beatEnergy, feverTier);

    // Layer 3: 3D Obsidian Reflective Floor & Perspective Grid
    this.drawObsidianStageFloor(ctx, w, h, beatEnergy, feverTier);

    // Layer 4: 3D Centerpiece Astral Ring Monument (visible behind highway & iconic on Title/Lobby)
    this.drawAstralRingMonument(ctx, w, h, spectrum, beatEnergy, feverTier, scene);

    // Layer 5: 32-Band Audio-Reactive 3D Spectrum Monoliths flanking the stage
    this.drawSpectrumMonoliths3D(ctx, w, h, spectrum, feverTier);

    // Layer 6: Floating 3D Ambient Stage Embers
    this.drawAmbientMotes3D(ctx, w, h);

    // Layer 7: 3D Perspective 4K Highway, Notes, Receptors & Hit VFX
    if (this.highwayPresence > 0.02 && project) {
      this.drawHighway3D(ctx, w, h, project, config, judgeEngine, liveState, beatEnergy, feverTier);
      this.drawShockwavesAndParticles3D(ctx, w, h);
    }

    // Layer 8: Gameplay Diegetic Combo, Judgement & FAST/SLOW Timing Bar (only in active play/pause)
    if ((scene === 'playing' || scene === 'paused') && liveState) {
      this.drawJudgementHud(ctx, w, h, liveState, feverTier);
    }

    // Layer 9: Subtle Fever & Peripheral Vignette
    this.drawAtmosphereVignette(ctx, w, h, feverTier, liveState?.hp ?? 100, scene);
  }

  private drawConcertDomeBackdrop(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    beatEnergy: number,
    feverTier: number,
    scene: GameSceneId,
  ): void {
    // Deep nocturnal slate sky foundation (cached gradient — Zero-GC)
    ctx.fillStyle = this.cachedBaseGrad ?? '#050811';
    ctx.fillRect(0, 0, w, h);

    // Render high-res concert dome artwork with camera-driven 3D parallax
    const pose = this.camera.getEffectivePose();
    const img = this.domeImage;
    if (img && img.complete && img.naturalWidth > 0) {
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.14;
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const panX = -pose.posX * 14 + pose.targetX * 8;
      const panY = -(pose.posY - 4.5) * 10;
      const dx = (w - drawW) * 0.5 + panX;
      const dy = (h - drawH) * 0.45 + panY;

      ctx.save();
      ctx.globalAlpha = scene === 'playing' ? 0.52 + beatEnergy * 0.1 : 0.74 + beatEnergy * 0.08;
      ctx.drawImage(img, dx, dy, drawW, drawH);
      ctx.restore();
    }

    // Subtle song jacket atmospheric projection high inside the dome during Select / Result
    if (
      (scene === 'select' || scene === 'result') &&
      this.jacketImage &&
      this.jacketImage.complete &&
      this.jacketImage.naturalWidth > 0
    ) {
      ctx.save();
      ctx.globalAlpha = 0.14 + beatEnergy * 0.05;
      const jSize = Math.min(w, h) * 0.68;
      ctx.drawImage(this.jacketImage, w * 0.5 - jSize * 0.5, h * 0.14, jSize, jSize);
      ctx.restore();
    }

    // Color-temperature harmonic wash matching active song palette (bounded radial circle)
    const p = this.curPrimary;
    const s = this.curSecondary;
    const horizon = this.camera.projectPoint3D(0, 1.4, -28, w, h, this.pCenter);
    const hx = horizon.visible ? horizon.x : w * 0.5;
    const hy = horizon.visible ? horizon.y : h * 0.42;
    const glowR = Math.min(w, h) * 0.62;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const coreGlow = ctx.createRadialGradient(hx, hy, 8, hx, hy, glowR);
    const boost = 0.16 + beatEnergy * 0.16 + feverTier * 0.05 + this.feverFlash * 0.18;
    coreGlow.addColorStop(0, `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${Math.min(0.46, boost).toFixed(3)})`);
    coreGlow.addColorStop(
      0.48,
      `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${(boost * 0.42).toFixed(3)})`,
    );
    coreGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(hx, hy, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawVolumetricStageBeams(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    spectrum: Readonly<AudioSpectrumFrame>,
    beatEnergy: number,
    feverTier: number,
  ): void {
    const p = this.curPrimary;
    const s = this.curSecondary;
    const t = this.elapsedSec;
    const beamCount = feverTier >= 2 ? 6 : 4;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < beamCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tierIdx = Math.floor(i / 2);
      const bandVal = spectrum.bands32[Math.min(31, 4 + i * 4)];

      const topX = side * (7.5 + tierIdx * 3.8);
      const topY = 12.8;
      const topZ = -18 - tierIdx * 6;

      const sweep = Math.sin(t * (0.55 + tierIdx * 0.2) + i * 1.7) * 4.2;
      const botX = side * (1.5 + tierIdx * 1.2) + sweep;
      const botY = 0;
      const botZ = -10 - tierIdx * 5;

      const pTop = this.camera.projectPoint3D(topX, topY, topZ, w, h, this.p0);
      const pBot = this.camera.projectPoint3D(botX, botY, botZ, w, h, this.p1);
      if (!pTop.visible && !pBot.visible) continue;

      const col = i % 2 === 0 ? p : s;
      const alpha = (0.045 + bandVal * 0.08 + beatEnergy * 0.035) * this.stageSpotlightIntensity;
      const spreadTop = 18;
      const spreadBot = 95 + bandVal * 65;

      const grad = ctx.createLinearGradient(pTop.x, pTop.y, pBot.x, pBot.y);
      grad.addColorStop(0, `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${(alpha * 1.4).toFixed(3)})`);
      grad.addColorStop(0.65, `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${(alpha * 0.55).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pTop.x - spreadTop, pTop.y);
      ctx.lineTo(pTop.x + spreadTop, pTop.y);
      ctx.lineTo(pBot.x + spreadBot, pBot.y);
      ctx.lineTo(pBot.x - spreadBot, pBot.y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawObsidianStageFloor(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    beatEnergy: number,
    feverTier: number,
  ): void {
    const fl = this.camera.projectPoint3D(-120, 0, -72, w, h, this.p0);
    const fr = this.camera.projectPoint3D(120, 0, -72, w, h, this.p1);
    const dxH = fr.x - fl.x;
    const slope = Math.abs(dxH) > 1 ? (fr.y - fl.y) / dxH : 0;
    const yLeft = fl.visible && fr.visible ? fl.y + (0 - fl.x) * slope : h * 0.56;
    const yRight = fl.visible && fr.visible ? fl.y + (w - fl.x) * slope : h * 0.56;
    const horizonY = Math.max(0, Math.min(h, Math.min(yLeft, yRight)));

    const floorGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    floorGrad.addColorStop(0, 'rgba(8, 13, 28, 0.0)');
    floorGrad.addColorStop(0.18, 'rgba(7, 11, 22, 0.72)');
    floorGrad.addColorStop(0.55, 'rgba(6, 10, 20, 0.92)');
    floorGrad.addColorStop(1, 'rgba(4, 7, 16, 0.98)');

    ctx.save();
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(0, yLeft);
    ctx.lineTo(w, yRight);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // Crisp perspective grid lines embedded into the obsidian floor
    const pose = this.camera.getEffectivePose();
    const safeNearZ = Math.min(4.5, pose.posZ - 1.4);
    const p = this.curPrimary;
    const s = this.curSecondary;
    const lineAlpha = 0.14 + beatEnergy * 0.08 + feverTier * 0.03;

    ctx.lineWidth = 1;
    // Longitudinal lines along Z
    for (let xi = -6; xi <= 6; xi++) {
      const wx = xi * 2.24;
      const a = this.camera.projectPoint3D(wx, 0, -38, w, h, this.p0);
      const b = this.camera.projectPoint3D(wx, 0, safeNearZ, w, h, this.p1);
      if (!a.visible && !b.visible) continue;
      const isEdge = Math.abs(xi) === 1;
      ctx.strokeStyle = isEdge
        ? `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${(lineAlpha * 1.45).toFixed(3)})`
        : `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${(lineAlpha * 0.65).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Transverse receding depth ribs along Z (drifting gently for spatial motion)
    const drift = (this.elapsedSec * 2.2) % 3.0;
    for (let zi = 0; zi < 14; zi++) {
      const wz = 3.0 - zi * 3.0 + drift;
      if (wz > 4.6 || wz < -38) continue;
      const depthFade = Math.max(0, 1 - Math.abs(wz) / 38);
      const a = this.camera.projectPoint3D(-18, 0, wz, w, h, this.p0);
      const b = this.camera.projectPoint3D(18, 0, wz, w, h, this.p1);
      if (!a.visible && !b.visible) continue;
      ctx.strokeStyle = `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${(depthFade * lineAlpha * 0.9).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Iconic 3D Celestial Ring Monument suspended above the horizon center stage.
   * Gives Title, Lobby, Song Select, and Result a signature architectural landmark.
   */
  private drawAstralRingMonument(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    spectrum: Readonly<AudioSpectrumFrame>,
    beatEnergy: number,
    feverTier: number,
    scene: GameSceneId,
  ): void {
    const centerZ = -18.5;
    const centerY = 4.6 + Math.sin(this.elapsedSec * 0.9) * 0.18;
    const center = this.camera.projectPoint3D(0, centerY, centerZ, w, h, this.pCenter);
    if (!center.visible) return;

    const p = this.curPrimary;
    const s = this.curSecondary;
    const baseRadius = 3.25 + beatEnergy * 0.28 + feverTier * 0.14;
    const visibilityScale = scene === 'playing' ? 0.55 : 0.95;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Outer rotating architectural halo (32 segmented arcs projected in true 3D)
    const rotA = this.elapsedSec * 0.35;
    const tiltX = 0.24 + Math.sin(this.elapsedSec * 0.4) * 0.08;
    ctx.lineWidth = scene === 'playing' ? 1.8 : 2.6;
    ctx.strokeStyle = `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${(0.45 * visibilityScale + beatEnergy * 0.25).toFixed(3)})`;

    ctx.beginPath();
    let started = false;
    const segs = 40;
    for (let i = 0; i <= segs; i++) {
      const ang = (i / segs) * Math.PI * 2 + rotA;
      const band = spectrum.bands32[i % 32];
      const rad = baseRadius + band * 0.35;
      const wx = Math.cos(ang) * rad;
      const wy = centerY + Math.sin(ang) * rad * Math.cos(tiltX);
      const wz = centerZ + Math.sin(ang) * rad * Math.sin(tiltX);
      const pt = this.camera.projectPoint3D(wx, wy, wz, w, h, this.p0);
      if (!pt.visible) continue;
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();

    // Counter-rotating amber inner orbital ring
    const rotB = -this.elapsedSec * 0.52;
    const innerR = baseRadius * 0.72;
    ctx.lineWidth = scene === 'playing' ? 1.4 : 2.1;
    ctx.strokeStyle = `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${(0.55 * visibilityScale + beatEnergy * 0.22).toFixed(3)})`;
    ctx.beginPath();
    started = false;
    for (let i = 0; i <= 32; i++) {
      const ang = (i / 32) * Math.PI * 2 + rotB;
      const wx = Math.cos(ang) * innerR;
      const wy = centerY + Math.sin(ang) * innerR * 0.85;
      const wz = centerZ - Math.cos(ang) * innerR * 0.38;
      const pt = this.camera.projectPoint3D(wx, wy, wz, w, h, this.p0);
      if (!pt.visible) continue;
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();

    // Luminous celestial core star
    const corePx = Math.max(12, center.scale * (0.45 + beatEnergy * 0.16));
    const coreGrad = ctx.createRadialGradient(center.x, center.y, 1, center.x, center.y, corePx * 2.6);
    coreGrad.addColorStop(0, `rgba(255,255,255,${(0.75 * visibilityScale).toFixed(3)})`);
    coreGrad.addColorStop(0.28, `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${(0.45 * visibilityScale).toFixed(3)})`);
    coreGrad.addColorStop(0.62, `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${(0.18 * visibilityScale).toFixed(3)})`);
    coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(center.x, center.y, corePx * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 32-Band Audio-Reactive 3D Spectrum Monoliths flanking both sides of the concert hall,
   * complete with mirrored reflections on the obsidian floor.
   */
  private drawSpectrumMonoliths3D(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    spectrum: Readonly<AudioSpectrumFrame>,
    feverTier: number,
  ): void {
    const p = this.curPrimary;
    const s = this.curSecondary;
    const bands = spectrum.bands32;

    ctx.save();
    for (let side = -1; side <= 1; side += 2) {
      // 16 monoliths per side receding into depth
      for (let i = 15; i >= 0; i--) {
        const bandVal = bands[i * 2] * 0.65 + bands[i * 2 + 1] * 0.35;
        const wz = -2.8 - i * 1.95;
        const wx = side * (4.15 + i * 0.28);
        const towerH = 0.45 + bandVal * (4.4 + feverTier * 0.55);
        const halfW = 0.24;

        const baseL = this.camera.projectPoint3D(wx - halfW, 0, wz, w, h, this.p0);
        const baseR = this.camera.projectPoint3D(wx + halfW, 0, wz, w, h, this.p1);
        const topR = this.camera.projectPoint3D(wx + halfW, towerH, wz, w, h, this.p2);
        const topL = this.camera.projectPoint3D(wx - halfW, towerH, wz, w, h, this.p3);
        if (!baseL.visible || !topL.visible) continue;

        const depthAlpha = Math.max(0.15, 1 - i / 18);
        const mix = i / 15;
        const cr = (p.r * (1 - mix) + s.r * mix) | 0;
        const cg = (p.g * (1 - mix) + s.g * mix) | 0;
        const cb = (p.b * (1 - mix) + s.b * mix) | 0;

        // Main luminous monolith column (Zero-GC solid layered fill instead of 32 per-frame gradients)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.36 * depthAlpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(baseL.x, baseL.y);
        ctx.lineTo(baseR.x, baseR.y);
        ctx.lineTo(topR.x, topR.y);
        ctx.lineTo(topL.x, topL.y);
        ctx.closePath();
        ctx.fill();

        // Upper energy band accent
        const midY = topL.y + (baseL.y - topL.y) * 0.38;
        const midYR = topR.y + (baseR.y - topR.y) * 0.38;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.48 * depthAlpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(topL.x, topL.y);
        ctx.lineTo(topR.x, topR.y);
        ctx.lineTo(topR.x, midYR);
        ctx.lineTo(topL.x, midY);
        ctx.closePath();
        ctx.fill();

        // Bright emissive top cap
        ctx.strokeStyle = `rgba(255,255,255,${(0.84 * depthAlpha).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.2, (baseR.x - baseL.x) * 0.08);
        ctx.beginPath();
        ctx.moveTo(topL.x, topL.y);
        ctx.lineTo(topR.x, topR.y);
        ctx.stroke();

        // Glossy inverted reflection on obsidian floor
        const refH = Math.min(1.6, towerH * 0.35);
        const refR = this.camera.projectPoint3D(wx + halfW, -refH, wz, w, h, this.p2);
        const refL = this.camera.projectPoint3D(wx - halfW, -refH, wz, w, h, this.p3);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.12 * depthAlpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(baseL.x, baseL.y);
        ctx.lineTo(baseR.x, baseR.y);
        ctx.lineTo(refR.x, refR.y);
        ctx.lineTo(refL.x, refL.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawAmbientMotes3D(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const p = this.curPrimary;
    const s = this.curSecondary;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      const pt = this.camera.projectPoint3D(
        m.x + Math.sin(this.elapsedSec * 0.6 + m.driftPhase) * 0.55,
        m.y,
        m.z,
        w,
        h,
        this.p0,
      );
      if (!pt.visible || pt.x < -10 || pt.x > w + 10 || pt.y < -10 || pt.y > h + 10) continue;
      const col = m.warm ? s : p;
      const r = Math.max(1.1, m.size * Math.min(2.2, pt.scale * 0.015));
      const twinkle = 0.35 + 0.45 * Math.sin(this.elapsedSec * 2.2 + m.driftPhase);
      ctx.fillStyle = `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${twinkle.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * True 3D Perspective 4K Performance Highway projected directly with `CameraRigDirector`.
   */
  private drawHighway3D(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    project: RhythmSongProject,
    config: RhythmPlayerConfig,
    judgeEngine: RhythmJudgeEngine | null,
    liveState: RhythmLiveState | null,
    beatEnergy: number,
    feverTier: number,
  ): void {
    const presence = this.highwayPresence;
    const p = this.curPrimary;
    const s = this.curSecondary;

    // Unfold highway smoothly from horizon toward the player during Fly-In
    const activeNearZ = HIGHWAY_HORIZON_Z + (HIGHWAY_NEAR_Z - HIGHWAY_HORIZON_Z) * presence;
    const yBed = 0.04;

    const tl = this.camera.projectPoint3D(-HIGHWAY_HALF_WIDTH, yBed, HIGHWAY_HORIZON_Z, w, h, this.p0);
    const tr = this.camera.projectPoint3D(HIGHWAY_HALF_WIDTH, yBed, HIGHWAY_HORIZON_Z, w, h, this.p1);
    const br = this.camera.projectPoint3D(HIGHWAY_HALF_WIDTH, yBed, activeNearZ, w, h, this.p2);
    const bl = this.camera.projectPoint3D(-HIGHWAY_HALF_WIDTH, yBed, activeNearZ, w, h, this.p3);

    ctx.save();
    ctx.globalAlpha = Math.min(1, presence * 1.15);

    // 1. Obsidian glass highway bed
    const bedGrad = ctx.createLinearGradient(0, tl.y, 0, bl.y);
    bedGrad.addColorStop(0, `rgba(6, 10, 22, ${(config.laneDim * 0.62).toFixed(3)})`);
    bedGrad.addColorStop(0.28, `rgba(8, 13, 28, ${(config.laneDim * 0.92).toFixed(3)})`);
    bedGrad.addColorStop(1, `rgba(10, 16, 32, ${Math.min(0.97, config.laneDim + 0.08).toFixed(3)})`);
    ctx.fillStyle = bedGrad;
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fill();

    // 2. Active lane press & hold energy beams shooting up the 3D track
    if (liveState && presence > 0.7) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let lane = 0; lane < 4; lane++) {
        const intensity = Math.max(
          liveState.laneHeld[lane] ? 0.58 : 0,
          liveState.laneFlash[lane] * 0.92,
          liveState.laneHoldGlow[lane] * 0.85,
        );
        if (intensity <= 0.02) continue;

        const lx0 = -HIGHWAY_HALF_WIDTH + lane * HIGHWAY_LANE_W;
        const lx1 = lx0 + HIGHWAY_LANE_W;
        const beamFarZ = -18.5;
        const a0 = this.camera.projectPoint3D(lx0, yBed + 0.01, beamFarZ, w, h, this.p0);
        const a1 = this.camera.projectPoint3D(lx1, yBed + 0.01, beamFarZ, w, h, this.p1);
        const b1 = this.camera.projectPoint3D(lx1, yBed + 0.01, JUDGE_Z, w, h, this.p2);
        const b0 = this.camera.projectPoint3D(lx0, yBed + 0.01, JUDGE_Z, w, h, this.p3);

        const col = lane === 1 || lane === 2 ? s : p;
        const g = ctx.createLinearGradient(0, b0.y, 0, a0.y);
        g.addColorStop(0, `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${(intensity * 0.52).toFixed(3)})`);
        g.addColorStop(0.55, `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${(intensity * 0.16).toFixed(3)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(a1.x, a1.y);
        ctx.lineTo(b1.x, b1.y);
        ctx.lineTo(b0.x, b0.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // 3. Lane divider seams & glowing metallic outer energy rails
    for (let div = 0; div <= 4; div++) {
      const wx = -HIGHWAY_HALF_WIDTH + div * HIGHWAY_LANE_W;
      const farPt = this.camera.projectPoint3D(wx, yBed + 0.02, HIGHWAY_HORIZON_Z, w, h, this.p0);
      const nearPt = this.camera.projectPoint3D(wx, yBed + 0.02, activeNearZ, w, h, this.p1);
      const isOuter = div === 0 || div === 4;

      if (isOuter) {
        const railCol = feverTier >= 2 ? s : p;
        ctx.strokeStyle = `rgba(${railCol.r | 0},${railCol.g | 0},${railCol.b | 0},${(0.85 + beatEnergy * 0.15).toFixed(3)})`;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(farPt.x, farPt.y);
        ctx.lineTo(nearPt.x, nearPt.y);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(farPt.x, farPt.y);
        ctx.lineTo(nearPt.x, nearPt.y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(farPt.x, farPt.y);
        ctx.lineTo(nearPt.x, nearPt.y);
        ctx.stroke();
      }
    }

    // 4. Measure & Beat horizon lines synced to song clock
    const lookaheadMs = Math.max(380, Math.min(1800, 1720 / Math.max(1.0, config.scrollSpeed)));
    const songTimeMs = (liveState?.songTimeMs ?? 0) + config.visualOffsetMs;
    const beatMs = 60000 / Math.max(40, project.bpm);

    if (presence > 0.65) {
      const firstBeat = Math.max(0, Math.floor((songTimeMs - project.offsetMs) / beatMs));
      for (let b = firstBeat; b < firstBeat + 14; b++) {
        const bTime = project.offsetMs + b * beatMs;
        const dtMs = bTime - songTimeMs;
        if (dtMs < -60) continue;
        if (dtMs > lookaheadMs) break;
        const tNorm = dtMs / lookaheadMs; // 0 at judge line -> 1 at horizon
        const wz = JUDGE_Z + (HIGHWAY_HORIZON_Z - JUDGE_Z) * tNorm;
        const leftPt = this.camera.projectPoint3D(-HIGHWAY_HALF_WIDTH, yBed + 0.015, wz, w, h, this.p0);
        const rightPt = this.camera.projectPoint3D(HIGHWAY_HALF_WIDTH, yBed + 0.015, wz, w, h, this.p1);
        const isMeasure = b % 4 === 0;
        const fade = Math.max(0, 1 - tNorm * 0.92);
        ctx.strokeStyle = isMeasure
          ? `rgba(226, 232, 240, ${(0.34 * fade).toFixed(3)})`
          : `rgba(148, 163, 184, ${(0.12 * fade).toFixed(3)})`;
        ctx.lineWidth = isMeasure ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(leftPt.x, leftPt.y);
        ctx.lineTo(rightPt.x, rightPt.y);
        ctx.stroke();
      }
    }

    // 5. Luminous Judgement Bar & 4 Tactile 3D Receptor Pads at z = 0
    if (presence > 0.72) {
      const jL = this.camera.projectPoint3D(-HIGHWAY_HALF_WIDTH - 0.14, yBed + 0.03, JUDGE_Z, w, h, this.p0);
      const jR = this.camera.projectPoint3D(HIGHWAY_HALF_WIDTH + 0.14, yBed + 0.03, JUDGE_Z, w, h, this.p1);

      // Wide ambient judgement glow
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${(0.55 + beatEnergy * 0.35).toFixed(3)})`;
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(jL.x, jL.y);
      ctx.lineTo(jR.x, jR.y);
      ctx.stroke();
      ctx.restore();

      // Razor-sharp white judgement core line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(jL.x, jL.y);
      ctx.lineTo(jR.x, jR.y);
      ctx.stroke();

      // 4 Receptor Pads + Keycap Labels
      for (let lane = 0; lane < 4; lane++) {
        const lx0 = -HIGHWAY_HALF_WIDTH + lane * HIGHWAY_LANE_W + 0.08;
        const lx1 = -HIGHWAY_HALF_WIDTH + (lane + 1) * HIGHWAY_LANE_W - 0.08;
        const held = liveState ? liveState.laneHeld[lane] : false;
        const flash = liveState ? liveState.laneFlash[lane] : 0;

        const r0 = this.camera.projectPoint3D(lx0, yBed + 0.03, JUDGE_Z - 0.24, w, h, this.p0);
        const r1 = this.camera.projectPoint3D(lx1, yBed + 0.03, JUDGE_Z - 0.24, w, h, this.p1);
        const r2 = this.camera.projectPoint3D(lx1, yBed + 0.03, JUDGE_Z + 0.32, w, h, this.p2);
        const r3 = this.camera.projectPoint3D(lx0, yBed + 0.03, JUDGE_Z + 0.32, w, h, this.p3);

        const col = lane === 1 || lane === 2 ? s : p;
        ctx.fillStyle =
          held || flash > 0.1
            ? `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${(0.32 + flash * 0.45).toFixed(3)})`
            : 'rgba(15, 23, 42, 0.78)';
        ctx.strokeStyle =
          held || flash > 0.1
            ? '#ffffff'
            : `rgba(${col.r | 0},${col.g | 0},${col.b | 0},0.65)`;
        ctx.lineWidth = held ? 2.4 : 1.5;

        ctx.beginPath();
        ctx.moveTo(r0.x, r0.y);
        ctx.lineTo(r1.x, r1.y);
        ctx.lineTo(r2.x, r2.y);
        ctx.lineTo(r3.x, r3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Crisp key label beneath receptor
        const keyCenter = this.camera.projectPoint3D(
          (lx0 + lx1) * 0.5,
          yBed + 0.03,
          JUDGE_Z + 0.48,
          w,
          h,
          this.pCenter,
        );
        const fontPx = Math.max(11, Math.min(18, Math.round((r2.x - r3.x) * 0.22)));
        ctx.font = `700 ${fontPx}px 'Oxanium', 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = held ? '#ffffff' : 'rgba(226, 232, 240, 0.85)';
        ctx.fillText(formatKeyCodeLabel(config.keyBindings[lane]), keyCenter.x, keyCenter.y);
      }
    }

    // 6. 3D Notes, Hold Ribbons & Platinum Chord Bridges
    if (judgeEngine && liveState && presence > 0.82) {
      this.drawNotes3D(ctx, w, h, judgeEngine, songTimeMs, lookaheadMs, yBed + 0.05);
    }

    ctx.restore();
  }

  private drawNotes3D(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    judgeEngine: RhythmJudgeEngine,
    songTimeMs: number,
    lookaheadMs: number,
    yNote: number,
  ): void {
    const notes = judgeEngine.getNotes();
    const status = judgeEngine.noteStatus;
    const cursor = judgeEngine.getScanCursor();
    const p = this.curPrimary;
    const s = this.curSecondary;

    // Pass A: Hold Ribbons (underneath note heads)
    for (let i = cursor; i < notes.length; i++) {
      const n = notes[i];
      if (n.timeMs - songTimeMs > lookaheadMs + 120) break;
      if (n.durationMs <= 0) continue;
      const st = status[i];
      if (st === NOTE_HIT || st === NOTE_MISSED) continue;

      const headMs = st === NOTE_HOLDING ? songTimeMs : n.timeMs;
      const tailMs = n.timeMs + n.durationMs;
      if (tailMs < songTimeMs - 140) continue;

      const tHead = Math.max(-0.04, Math.min(1.0, (headMs - songTimeMs) / lookaheadMs));
      const tTail = Math.max(tHead, Math.min(1.0, (tailMs - songTimeMs) / lookaheadMs));
      const zHead = JUDGE_Z + (HIGHWAY_HORIZON_Z - JUDGE_Z) * tHead;
      const zTail = JUDGE_Z + (HIGHWAY_HORIZON_Z - JUDGE_Z) * tTail;

      const lx0 = -HIGHWAY_HALF_WIDTH + n.lane * HIGHWAY_LANE_W + 0.24;
      const lx1 = -HIGHWAY_HALF_WIDTH + (n.lane + 1) * HIGHWAY_LANE_W - 0.24;

      const q0 = this.camera.projectPoint3D(lx0, yNote, zTail, w, h, this.p0);
      const q1 = this.camera.projectPoint3D(lx1, yNote, zTail, w, h, this.p1);
      const q2 = this.camera.projectPoint3D(lx1, yNote, zHead, w, h, this.p2);
      const q3 = this.camera.projectPoint3D(lx0, yNote, zHead, w, h, this.p3);

      const col = n.lane === 1 || n.lane === 2 ? s : p;
      const grad = ctx.createLinearGradient(0, q0.y, 0, q3.y);
      grad.addColorStop(0, `rgba(${col.r | 0},${col.g | 0},${col.b | 0},0.22)`);
      grad.addColorStop(1, `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${st === NOTE_HOLDING ? 0.88 : 0.65})`);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.lineTo(q3.x, q3.y);
      ctx.closePath();
      ctx.fill();

      // Glowing white inner energy core ribbon
      const cx = (lx0 + lx1) * 0.5;
      const cTail = this.camera.projectPoint3D(cx, yNote + 0.02, zTail, w, h, this.p0);
      const cHead = this.camera.projectPoint3D(cx, yNote + 0.02, zHead, w, h, this.p1);
      ctx.strokeStyle = st === NOTE_HOLDING ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.48)';
      ctx.lineWidth = Math.max(1.5, (q2.x - q3.x) * 0.12);
      ctx.beginPath();
      ctx.moveTo(cTail.x, cTail.y);
      ctx.lineTo(cHead.x, cHead.y);
      ctx.stroke();
    }

    // Pass B: Platinum Chord Bridges connecting simultaneous notes
    for (let i = cursor; i < notes.length - 1; i++) {
      const a = notes[i];
      const dtA = a.timeMs - songTimeMs;
      if (dtA > lookaheadMs) break;
      if (dtA < -120 || status[i] === NOTE_HIT || status[i] === NOTE_MISSED) continue;
      if (!a.isChord) continue;
      const b = notes[i + 1];
      if (Math.abs(b.timeMs - a.timeMs) > 14) continue;
      if (status[i + 1] === NOTE_HIT || status[i + 1] === NOTE_MISSED) continue;

      const tNorm = Math.max(-0.04, Math.min(1.0, dtA / lookaheadMs));
      const wz = JUDGE_Z + (HIGHWAY_HORIZON_Z - JUDGE_Z) * tNorm;
      const ax = -HIGHWAY_HALF_WIDTH + (a.lane + 0.5) * HIGHWAY_LANE_W;
      const bx = -HIGHWAY_HALF_WIDTH + (b.lane + 0.5) * HIGHWAY_LANE_W;
      const pa = this.camera.projectPoint3D(ax, yNote + 0.04, wz, w, h, this.pChordA);
      const pb = this.camera.projectPoint3D(bx, yNote + 0.04, wz, w, h, this.pChordB);

      ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
      ctx.lineWidth = Math.max(1.5, (1 - tNorm) * 4.5);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Pass C: Beveled 3D Note Bricks (back-to-front so nearer notes overlap cleanly)
    let endIdx = cursor;
    while (endIdx < notes.length && notes[endIdx].timeMs - songTimeMs <= lookaheadMs) {
      endIdx++;
    }

    for (let i = endIdx - 1; i >= cursor; i--) {
      const n = notes[i];
      const st = status[i];
      if (st === NOTE_HIT || st === NOTE_MISSED) continue;

      const effectiveMs = st === NOTE_HOLDING ? songTimeMs : n.timeMs;
      const dtMs = effectiveMs - songTimeMs;
      if (dtMs < -150 || dtMs > lookaheadMs) continue;

      const tNorm = Math.max(-0.06, Math.min(1.0, dtMs / lookaheadMs));
      const wz = JUDGE_Z + (HIGHWAY_HORIZON_Z - JUDGE_Z) * tNorm;
      const depthThick = 0.24 + (1 - tNorm) * 0.2;

      const lx0 = -HIGHWAY_HALF_WIDTH + n.lane * HIGHWAY_LANE_W + 0.1;
      const lx1 = -HIGHWAY_HALF_WIDTH + (n.lane + 1) * HIGHWAY_LANE_W - 0.1;

      const n0 = this.camera.projectPoint3D(lx0, yNote + 0.06, wz - depthThick, w, h, this.p0);
      const n1 = this.camera.projectPoint3D(lx1, yNote + 0.06, wz - depthThick, w, h, this.p1);
      const n2 = this.camera.projectPoint3D(lx1, yNote + 0.06, wz + depthThick, w, h, this.p2);
      const n3 = this.camera.projectPoint3D(lx0, yNote + 0.06, wz + depthThick, w, h, this.p3);

      const isChord = Boolean(n.isChord);
      const col = isChord
        ? { r: 248, g: 250, b: 252 }
        : n.lane === 1 || n.lane === 2
          ? s
          : p;

      // Emissive outer bloom halo
      ctx.fillStyle = `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${(0.32 * (1 - tNorm * 0.4)).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(n0.x - 4, n0.y - 3);
      ctx.lineTo(n1.x + 4, n1.y - 3);
      ctx.lineTo(n2.x + 5, n2.y + 4);
      ctx.lineTo(n3.x - 5, n3.y + 4);
      ctx.closePath();
      ctx.fill();

      // Main metallic beveled note body
      ctx.fillStyle = `rgb(${col.r | 0},${col.g | 0},${col.b | 0})`;
      ctx.beginPath();
      ctx.moveTo(n0.x, n0.y);
      ctx.lineTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
      ctx.lineTo(n3.x, n3.y);
      ctx.closePath();
      ctx.fill();

      // High-contrast specular white inner crest (guarantees instant readability at high scroll speed)
      const midY = (n0.y + n3.y) * 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(n0.x + (n1.x - n0.x) * 0.12, midY - Math.max(1.5, (n3.y - n0.y) * 0.18));
      ctx.lineTo(n1.x - (n1.x - n0.x) * 0.12, midY - Math.max(1.5, (n3.y - n0.y) * 0.18));
      ctx.lineTo(n2.x - (n2.x - n3.x) * 0.12, midY + Math.max(1.5, (n3.y - n0.y) * 0.18));
      ctx.lineTo(n3.x + (n2.x - n3.x) * 0.12, midY + Math.max(1.5, (n3.y - n0.y) * 0.18));
      ctx.closePath();
      ctx.fill();

      // Crisp dark outline so notes pop off bright beams
      ctx.strokeStyle = isChord ? '#f59e0b' : 'rgba(7, 11, 22, 0.72)';
      ctx.lineWidth = isChord ? 1.8 : 1.1;
      ctx.beginPath();
      ctx.moveTo(n0.x, n0.y);
      ctx.lineTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
      ctx.lineTo(n3.x, n3.y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  private drawShockwavesAndParticles3D(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Expanding 3D elliptical shockwaves on the judgement plane
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      const t = 1 - sw.life / sw.maxLife;
      const rad = 0.25 + sw.maxRadius * (1 - Math.pow(1 - t, 3));
      const alpha = Math.max(0, 1 - t) * 0.85;
      const c = this.camera.projectPoint3D(sw.x, 0.12, sw.z, w, h, this.p0);
      const edge = this.camera.projectPoint3D(sw.x + rad, 0.12, sw.z, w, h, this.p1);
      if (!c.visible) continue;
      const rx = Math.max(8, Math.abs(edge.x - c.x));
      const ry = rx * 0.36;

      ctx.strokeStyle = `rgba(${sw.r | 0},${sw.g | 0},${sw.b | 0},${alpha.toFixed(3)})`;
      ctx.lineWidth = Math.max(1.2, (1 - t) * 4.2);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 3D radial sparks bursting upward from receptors
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      const proj = this.camera.projectPoint3D(pt.x, pt.y, pt.z, w, h, this.p0);
      if (!proj.visible) continue;
      const alpha = Math.max(0, pt.life / pt.maxLife);
      const radius = Math.max(1.4, pt.size * alpha * Math.min(1.8, proj.scale * 0.014));
      ctx.fillStyle = `rgba(${pt.r | 0},${pt.g | 0},${pt.b | 0},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawJudgementHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    liveState: RhythmLiveState,
    feverTier: number,
  ): void {
    const cx = w * 0.5;
    const comboY = h * 0.31;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Giant Tabular Combo Counter
    if (liveState.combo >= 2) {
      ctx.save();
      ctx.translate(cx, comboY);
      ctx.scale(this.comboScale, this.comboScale);

      const numSize = Math.round(Math.max(46, Math.min(76, h * 0.095)));
      ctx.font = `800 ${numSize}px 'Oxanium', 'Plus Jakarta Sans', sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(4, 8, 20, 0.85)';
      ctx.strokeText(String(liveState.combo), 0, 0);
      ctx.fillStyle =
        feverTier >= 3 ? '#fde68a' : feverTier >= 2 ? '#f59e0b' : feverTier >= 1 ? '#7dd3fc' : '#f8fafc';
      ctx.fillText(String(liveState.combo), 0, 0);

      ctx.font = `700 12px 'Oxanium', 'JetBrains Mono', monospace`;
      ctx.fillStyle =
        feverTier >= 2 ? '#fbbf24' : 'rgba(203, 213, 225, 0.86)';
      const subLabel =
        feverTier >= 3
          ? 'OVERDRIVE · COMBO'
          : feverTier >= 2
            ? 'FEVER ×2 · COMBO'
            : feverTier >= 1
              ? 'RESONANCE · COMBO'
              : 'COMBO';
      ctx.fillText(subLabel, 0, numSize * 0.56);
      ctx.restore();
    }

    // Crisp Judgement Word + FAST / SLOW Timing Bar
    if (this.judgePopTimer > 0) {
      const pop = 1 + Math.min(0.18, this.judgePopTimer * 0.45);
      const alpha = Math.min(1, this.judgePopTimer * 4.5);
      const tierMeta = TIER_COLORS[this.judgeTier];
      const judgeY = h * 0.48;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, judgeY);
      ctx.scale(pop, pop);

      const jFont = Math.round(Math.max(22, Math.min(34, h * 0.042)));
      ctx.font = `800 ${jFont}px 'Oxanium', 'Plus Jakarta Sans', sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(4, 8, 20, 0.9)';
      ctx.strokeText(this.judgeTier, 0, 0);
      ctx.fillStyle = tierMeta.hex;
      ctx.fillText(this.judgeTier, 0, 0);

      // Sub-millisecond FAST / SLOW deviation meter
      if (!this.judgeIsHoldTick && this.judgeTier !== 'MISS' && Math.abs(this.judgeDeltaMs) >= 12) {
        const fast = this.judgeDeltaMs < 0;
        const label = `${fast ? 'FAST' : 'SLOW'} ${this.judgeDeltaMs > 0 ? '+' : ''}${Math.round(this.judgeDeltaMs)}ms`;
        ctx.font = `600 12px 'JetBrains Mono', monospace`;
        ctx.fillStyle = fast ? '#38bdf8' : '#fb7185';
        ctx.fillText(label, 0, jFont * 0.72);

        // Micro ruler bar
        const barW = 112;
        const barY = jFont * 1.1;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
        ctx.fillRect(-barW * 0.5, barY - 2, barW, 4);
        ctx.fillStyle = 'rgba(248, 250, 252, 0.85)';
        ctx.fillRect(-1, barY - 4, 2, 8);
        const norm = Math.max(-1, Math.min(1, this.judgeDeltaMs / 130));
        ctx.fillStyle = fast ? '#38bdf8' : '#fb7185';
        ctx.fillRect(norm * (barW * 0.48) - 2, barY - 4, 4, 8);
      }

      ctx.restore();
    }

    ctx.restore();
  }

  private drawAtmosphereVignette(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    feverTier: number,
    hp: number,
    scene: GameSceneId,
  ): void {
    // Low-HP peripheral warning pulse during live gameplay
    if (scene === 'playing' && hp < 28) {
      const warn = (0.16 + 0.12 * Math.sin(this.elapsedSec * 7.5)) * (1 - hp / 28);
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.28, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(225, 29, 72, ${warn.toFixed(3)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    } else if (feverTier >= 2 && scene === 'playing') {
      const s = this.curSecondary;
      const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.34, w * 0.5, h * 0.5, Math.max(w, h) * 0.74);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(${s.r | 0},${s.g | 0},${s.b | 0},${(0.08 + this.feverFlash * 0.14).toFixed(3)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    // Gentle cinematic edge framing (cached on resize — Zero-GC)
    if (this.cachedFrameGrad) {
      ctx.fillStyle = this.cachedFrameGrad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private ingestLiveJudgement(liveState: RhythmLiveState): void {
    const j = liveState.lastJudge;
    if (!j || j.songTimeMs === this.lastSeenJudgeTimeMs) return;
    this.lastSeenJudgeTimeMs = j.songTimeMs;

    this.judgeTier = j.tier;
    this.judgeDeltaMs = j.deltaMs;
    this.judgeIsHoldTick = Boolean(j.isHoldTick);
    this.judgePopTimer = 0.55;

    if (liveState.combo > this.lastCombo) {
      this.comboScale = 1.24;
    }
    this.lastCombo = liveState.combo;

    if (j.tier === 'MISS') {
      this.camera.addShakeTrauma(0.22);
      return;
    }

    const laneX = -HIGHWAY_HALF_WIDTH + (j.lane + 0.5) * HIGHWAY_LANE_W;
    const col = TIER_COLORS[j.tier].rgb;
    this.spawnShockwave(laneX, JUDGE_Z, col, j.tier === 'MARVELOUS' ? 1.15 : 0.85);
    const sparkCount = j.isHoldTick ? 4 : j.tier === 'MARVELOUS' ? 14 : 9;
    this.spawnHitParticles(laneX, JUDGE_Z, col, sparkCount);
  }

  private spawnShockwave(x: number, z: number, col: RgbColor, maxRadius: number): void {
    const sw = this.shockwaves[this.shockwaveCursor];
    this.shockwaveCursor = (this.shockwaveCursor + 1) % MAX_SHOCKWAVES;
    sw.active = true;
    sw.x = x;
    sw.z = z;
    sw.life = 0.34;
    sw.maxLife = 0.34;
    sw.maxRadius = maxRadius;
    sw.r = col.r;
    sw.g = col.g;
    sw.b = col.b;
  }

  private spawnHitParticles(x: number, z: number, col: RgbColor, count: number): void {
    for (let i = 0; i < count; i++) {
      const pt = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
      const ang = (i / count) * Math.PI * 2 + (this.elapsedSec * 7.3) % 1;
      const spd = 1.2 + ((i * 37) % 10) * 0.24;
      pt.active = true;
      pt.x = x;
      pt.y = 0.14;
      pt.z = z;
      pt.vx = Math.cos(ang) * spd;
      pt.vy = 2.0 + ((i * 53) % 10) * 0.32;
      pt.vz = Math.sin(ang) * spd * 0.85;
      pt.life = 0.32 + ((i * 19) % 5) * 0.05;
      pt.maxLife = pt.life;
      pt.size = 2.8 + (i % 3) * 1.1;
      pt.r = col.r;
      pt.g = col.g;
      pt.b = col.b;
    }
  }

  private stepPools(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pt.vy -= 5.8 * dt;
    }

    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      sw.life -= dt;
      if (sw.life <= 0) sw.active = false;
    }

    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.y += m.speedY * dt;
      if (m.y > 11.2) m.y = 0.5;
    }
  }
}

function parseHexIntoRgb(hex: string, out: RgbColor): void {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 6) {
    const num = Number.parseInt(clean, 16);
    if (Number.isFinite(num)) {
      out.r = (num >> 16) & 255;
      out.g = (num >> 8) & 255;
      out.b = num & 255;
      return;
    }
  }
  out.r = 56;
  out.g = 189;
  out.b = 248;
}
