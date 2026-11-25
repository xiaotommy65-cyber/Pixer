import { stepSpringInto } from '../math/SpringDynamics.ts';
import type { HudPrimitiveDesc } from '../types/WorldTypes.ts';
import {
  SHOT_SIZE_PRESETS,
  validateCutsceneDef,
  type EcsCameraMotionKind,
  type EcsCutsceneDef,
  type EcsCutsceneShotDef,
  type EcsCutsceneTrigger,
  type EcsScreenAnchor,
  type EcsShotSize,
} from './EcsCutsceneSchema.ts';
import type { EcsWorld } from './EcsWorld.ts';

export {
  SHOT_SIZE_PRESETS,
  validateCutsceneDef,
  type EcsCameraMotionKind,
  type EcsCutsceneDef,
  type EcsCutsceneShotDef,
  type EcsCutsceneTrigger,
  type EcsScreenAnchor,
  type EcsShotSize,
};

export interface ToricTwoShotSolution {
  centerX: number;
  centerY: number;
  zoom: number;
  axisSign: -1 | 1;
  axisPreserved: boolean;
}

/**
 * Zero-GC Toric Space Two-Shot Algebraic Solver (SIGGRAPH Lino & Christie 2015 adapted for HD-2D).
 * Solves camera center `(centerX, centerY)` and `zoom` so Subject A and Subject B occupy the
 * golden rule-of-thirds interval `[0.24, 0.76]` while enforcing the 180-Degree Axis Rule.
 */
export function solveToricTwoShotInto(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  vpW: number,
  vpH: number,
  prevAxisSign: -1 | 0 | 1,
  primaryWeight = 0.55,
  out: ToricTwoShotSolution,
): ToricTwoShotSolution {
  const dx = bx - ax;
  const dy = by - ay;
  const currentSign: -1 | 1 = dx >= 0 ? 1 : -1;
  const axisPreserved = prevAxisSign === 0 || prevAxisSign === currentSign;

  // Weighted focal point (slightly favoring primary actor A for narrative grounding)
  const wA = Math.max(0.25, Math.min(0.75, primaryWeight));
  out.centerX = ax * wA + bx * (1 - wA);
  out.centerY = ay * wA + by * (1 - wA);

  // Algebraic zoom so |dx| fits within 52% of viewport width and |dy| within 48% of viewport height
  const spanX = Math.abs(dx) + 88;
  const spanY = Math.abs(dy) + 76;
  const desiredZoomX = (vpW * 0.54) / Math.max(96, spanX);
  const desiredZoomY = (vpH * 0.50) / Math.max(84, spanY);
  const rawZoom = Math.min(desiredZoomX, desiredZoomY);
  out.zoom = Math.max(0.78, Math.min(1.32, rawZoom));
  out.axisSign = currentSign;
  out.axisPreserved = axisPreserved;
  return out;
}

/**
 * Resolves Normalized Screen Anchor `(u, v) in [0, 1]^2` for a single subject.
 */
export function resolveScreenAnchorNorm(
  anchor: EcsScreenAnchor,
  facingX: number,
  facingY: number,
  outUv: [number, number],
): [number, number] {
  switch (anchor) {
    case 'left_third':
      outUv[0] = 0.34;
      outUv[1] = 0.52;
      break;
    case 'right_third':
      outUv[0] = 0.66;
      outUv[1] = 0.52;
      break;
    case 'upper_third':
      outUv[0] = 0.5;
      outUv[1] = 0.36;
      break;
    case 'lower_third':
      outUv[0] = 0.5;
      outUv[1] = 0.64;
      break;
    case 'lead_room':
      // Place actor opposite to their gaze so 62% of the frame opens in front of their line of sight
      outUv[0] = 0.5 - facingX * 0.14;
      outUv[1] = 0.52 - facingY * 0.1;
      break;
    case 'center':
    case 'two_shot':
    default:
      outUv[0] = 0.5;
      outUv[1] = 0.52;
      break;
  }
  return outUv;
}

export type DirectorPhase = 'idle' | 'playing_shots' | 'handback' | 'peek';

/**
 * Pure DOM-free, Zero-GC Cinematic Director & Autonomous Framing Engine for Pixer True ECS.
 *
 * Implements:
 * 1. Auteur Actor-Relative Storyboard Sequencer (`EcsCutsceneDef`)
 * 2. Toric Space Two-Shot Algebraic Framing (Hero vs Boss / Dual-Subject Composition)
 * 3. 3-Phase Seamless Handback Protocol (Takeover -> Shot Execution -> Critically Damped Spring Handback)
 * 4. Walter Murch Dramaturgy Primitives (Motivated Push-In, Half-Beat Hold, Bullet-Time, 21:9 Letterbox, Splash Titles)
 */
export class EcsCinematicDirector {
  private phase: DirectorPhase = 'idle';
  private activeCutscene: EcsCutsceneDef | null = null;
  private shotIndex = 0;
  private shotElapsedSec = 0;
  private handbackElapsedSec = 0;
  private handbackDurationSec = 0.45;
  private handbackStartPitchDeg = 0;
  private handbackStartBlur = 0.34;
  private handbackStartFocusY = 0.52;
  private handbackStartDarkness = 0;
  private prevGameplayCamX = 0;
  private prevGameplayCamY = 0;
  private hasPrevGameplayCam = false;
  private readonly completedCutsceneIds = new Set<string>();

  // Peek camera override (for gate unlock / distant event reveal)
  private peekTargetX = 0;
  private peekTargetY = 0;
  private peekRemainingSec = 0;
  private peekZoom = 1.18;

  // Combat Impact Micro-Cut-In & Bullet-Time state (active even during normal gameplay)
  private impactTimerSec = 0;
  private impactDurationSec = 0;
  private impactZoomBoost = 0;
  private impactBlurBoost = 0;
  private impactTimeScale = 1.0;
  private impactFocusY = 0;

  // Live evaluated camera & cinema properties (Zero-GC scalar state)
  public cameraX = 0;
  public cameraY = 0;
  public cameraZoom = 1.0;
  public pitchDeltaDeg = 0;
  public tiltShiftBlur = 0.34;
  public tiltShiftFocusY = 0.52;
  public letterboxRatio = 0; // 0 = no bars, 1 = full 21:9 cinema bars
  public spotlightDarkness = 0;
  public timeScale = 1.0;
  public establishedAxisSign: -1 | 0 | 1 = 0;

  // Active overlay text & portrait state
  private activeSpeaker = '';
  private activePortraitSpriteId = '';
  private activePortraitSide: 'left' | 'right' = 'left';
  private activeSubtitle = '';
  private subtitleProgressChars = 0;
  private activeSplashTitle = '';
  private activeSplashSubtitle = '';
  private splashTimerSec = 0;

  // Pre-allocated analytical spring states [pos, vel] (Zero-GC)
  private readonly springCamX = new Float64Array(2);
  private readonly springCamY = new Float64Array(2);
  private readonly springZoom = new Float64Array([1, 0]);
  private readonly springLetterbox = new Float64Array(2);
  private readonly springLeadX = new Float64Array(2);
  private readonly springLeadY = new Float64Array(2);

  // Pre-allocated scratch buffers (Zero-GC)
  private readonly scratchActorA: [number, number, number, number] = [0, 0, 0, 1]; // [cx, cy, fx, fy]
  private readonly scratchActorB: [number, number, number, number] = [0, 0, 0, 1];
  private readonly scratchUv: [number, number] = [0.5, 0.5];
  private readonly scratchToric: ToricTwoShotSolution = {
    centerX: 0,
    centerY: 0,
    zoom: 1,
    axisSign: 1,
    axisPreserved: true,
  };

  public reset(clearCompleted = true): void {
    this.phase = 'idle';
    this.activeCutscene = null;
    this.shotIndex = 0;
    this.shotElapsedSec = 0;
    this.handbackElapsedSec = 0;
    this.peekRemainingSec = 0;
    this.impactTimerSec = 0;
    this.impactZoomBoost = 0;
    this.impactBlurBoost = 0;
    this.impactTimeScale = 1.0;
    this.cameraZoom = 1.0;
    this.pitchDeltaDeg = 0;
    this.letterboxRatio = 0;
    this.spotlightDarkness = 0;
    this.timeScale = 1.0;
    this.establishedAxisSign = 0;
    this.activeSpeaker = '';
    this.activePortraitSpriteId = '';
    this.activePortraitSide = 'left';
    this.activeSubtitle = '';
    this.subtitleProgressChars = 0;
    this.activeSplashTitle = '';
    this.activeSplashSubtitle = '';
    this.splashTimerSec = 0;
    this.springZoom[0] = 1;
    this.springZoom[1] = 0;
    this.springLetterbox[0] = 0;
    this.springLetterbox[1] = 0;
    this.springLeadX[0] = 0;
    this.springLeadX[1] = 0;
    this.springLeadY[0] = 0;
    this.springLeadY[1] = 0;
    this.handbackStartPitchDeg = 0;
    this.handbackStartDarkness = 0;
    this.prevGameplayCamX = 0;
    this.prevGameplayCamY = 0;
    this.hasPrevGameplayCam = false;
    if (clearCompleted) {
      this.completedCutsceneIds.clear();
    }
  }

  /** Synchronizes camera & atmosphere baselines after room spawn or live atmosphere edits without spring lag. */
  public syncLivePose(
    camX: number,
    camY: number,
    zoom = 1.0,
    tiltShiftBlur = this.tiltShiftBlur,
    tiltShiftFocusY = this.tiltShiftFocusY,
  ): void {
    this.cameraX = camX;
    this.cameraY = camY;
    this.cameraZoom = zoom;
    this.springCamX[0] = camX;
    this.springCamX[1] = 0;
    this.springCamY[0] = camY;
    this.springCamY[1] = 0;
    this.springZoom[0] = zoom;
    this.springZoom[1] = 0;
    this.springLeadX[0] = 0;
    this.springLeadX[1] = 0;
    this.springLeadY[0] = 0;
    this.springLeadY[1] = 0;
    this.prevGameplayCamX = camX;
    this.prevGameplayCamY = camY;
    this.hasPrevGameplayCam = false;
    if (this.phase === 'idle') {
      this.tiltShiftBlur = tiltShiftBlur;
      this.tiltShiftFocusY = tiltShiftFocusY;
    }
  }

  public getPhase(): DirectorPhase {
    return this.phase;
  }

  public isCutscenePlaying(): boolean {
    return this.phase === 'playing_shots' || this.phase === 'handback' || this.phase === 'peek';
  }

  public isBlockingGameplayInput(): boolean {
    return this.phase === 'playing_shots' || this.phase === 'peek';
  }

  public getActiveCutsceneId(): string {
    return this.activeCutscene?.id ?? '';
  }

  public getActiveShotIndex(): number {
    return this.shotIndex;
  }

  public getCurrentShot(): EcsCutsceneShotDef | null {
    if (!this.activeCutscene || this.phase !== 'playing_shots') return null;
    return this.activeCutscene.shots[this.shotIndex] ?? null;
  }

  public hasCompletedCutscene(id: string): boolean {
    return this.completedCutsceneIds.has(id);
  }

  /**
   * Phase 1 (Motivated Takeover): Starts a multi-shot cutscene from the exact live camera pose (zero pop).
   */
  public startCutscene(
    cutscene: EcsCutsceneDef,
    currentCamX: number,
    currentCamY: number,
    currentZoom = 1.0,
    onShotStart?: (shot: EcsCutsceneShotDef) => void,
  ): boolean {
    if (!cutscene || cutscene.shots.length === 0) return false;
    this.activeCutscene = cutscene;
    this.phase = 'playing_shots';
    this.shotIndex = 0;
    this.shotElapsedSec = 0;
    this.handbackDurationSec = Math.max(0.15, cutscene.handbackDurationSec ?? 0.45);
    this.establishedAxisSign = 0;

    this.cameraX = currentCamX;
    this.cameraY = currentCamY;
    this.cameraZoom = currentZoom;
    this.springCamX[0] = currentCamX;
    this.springCamX[1] = 0;
    this.springCamY[0] = currentCamY;
    this.springCamY[1] = 0;
    this.springZoom[0] = currentZoom;
    this.springZoom[1] = 0;

    this.enterShot(0, onShotStart);
    return true;
  }

  /**
   * Skips remaining shots and enters Phase 3 (Critically Damped Spring Handback) so the camera
   * glides back to the player without a jarring hard cut.
   */
  public skipCutscene(): boolean {
    if (this.phase !== 'playing_shots') return false;
    if (this.activeCutscene && this.activeCutscene.skippable === false) return false;
    if (this.activeCutscene) {
      this.completedCutsceneIds.add(this.activeCutscene.id);
    }
    this.enterHandback(0.28);
    return true;
  }

  /**
   * Triggers an event-driven camera peek to a world coordinate (e.g., an unlocked gate) and springs back.
   */
  public triggerPeekAt(
    worldX: number,
    worldY: number,
    currentCamX: number,
    currentCamY: number,
    durationSec = 1.15,
    splashTitle?: string,
    splashSubtitle?: string,
  ): void {
    if (this.phase === 'playing_shots') return;
    this.phase = 'peek';
    this.peekTargetX = worldX;
    this.peekTargetY = worldY;
    this.peekRemainingSec = Math.max(0.4, durationSec);
    this.peekZoom = 1.16;
    this.springCamX[0] = currentCamX;
    this.springCamX[1] = 0;
    this.springCamY[0] = currentCamY;
    this.springCamY[1] = 0;
    if (splashTitle) {
      this.activeSplashTitle = splashTitle;
      this.activeSplashSubtitle = splashSubtitle ?? '';
      this.splashTimerSec = Math.max(1.2, durationSec);
    }
  }

  /**
   * Triggers a Motivated Combat Impact Zoom + Tilt-Shift Focus Pull + Bullet-Time Curve during live combat.
   */
  public triggerCombatImpact(
    kind: 'light' | 'heavy' | 'boss_phase' | 'finisher',
    _focusX: number,
    focusY: number,
  ): void {
    this.impactFocusY = focusY;
    switch (kind) {
      case 'light':
        this.impactDurationSec = Math.max(this.impactTimerSec, 0.16);
        this.impactTimerSec = this.impactDurationSec;
        this.impactZoomBoost = Math.max(this.impactZoomBoost, 0.06);
        this.impactBlurBoost = Math.max(this.impactBlurBoost, 0.12);
        break;
      case 'heavy':
        this.impactDurationSec = Math.max(this.impactTimerSec, 0.32);
        this.impactTimerSec = this.impactDurationSec;
        this.impactZoomBoost = Math.max(this.impactZoomBoost, 0.16);
        this.impactBlurBoost = Math.max(this.impactBlurBoost, 0.24);
        this.impactTimeScale = Math.min(this.impactTimeScale, 0.42);
        break;
      case 'boss_phase':
        this.impactDurationSec = 0.65;
        this.impactTimerSec = 0.65;
        this.impactZoomBoost = 0.28;
        this.impactBlurBoost = 0.36;
        this.impactTimeScale = 0.25;
        break;
      case 'finisher':
        this.impactDurationSec = 0.78;
        this.impactTimerSec = 0.78;
        this.impactZoomBoost = 0.35;
        this.impactBlurBoost = 0.42;
        this.impactTimeScale = 0.18;
        break;
    }
  }

  public showSplashBanner(title: string, subtitle = '', durationSec = 2.2): void {
    this.activeSplashTitle = title;
    this.activeSplashSubtitle = subtitle;
    this.splashTimerSec = durationSec;
  }

  private advanceCritSpring(
    state: Float64Array,
    target: number,
    freqHz: number,
    dt: number,
    prevTarget = target,
    response = 0,
  ): void {
    stepSpringInto(state[0], state[1], target, prevTarget, freqHz, 1.0, response, dt, state);
  }

  public getActivePortrait(): { spriteId: string; side: 'left' | 'right' } | null {
    if (!this.activePortraitSpriteId || this.phase !== 'playing_shots') return null;
    return { spriteId: this.activePortraitSpriteId, side: this.activePortraitSide };
  }

  private enterShot(index: number, onShotStart?: (shot: EcsCutsceneShotDef) => void): void {
    if (!this.activeCutscene) return;
    const shot = this.activeCutscene.shots[index];
    if (!shot) return;
    this.shotIndex = index;
    this.shotElapsedSec = 0;
    this.activeSpeaker = shot.speaker ?? '';
    this.activePortraitSpriteId = shot.portraitSpriteId ?? '';
    this.activePortraitSide = shot.portraitSide ?? 'left';
    this.activeSubtitle = shot.subtitle ?? '';
    this.subtitleProgressChars = 0;
    if (shot.splashTitle) {
      this.activeSplashTitle = shot.splashTitle;
      this.activeSplashSubtitle = shot.splashSubtitle ?? '';
      this.splashTimerSec = shot.durationSec;
    }
    onShotStart?.(shot);
  }

  private enterHandback(durationSec: number): void {
    this.phase = 'handback';
    this.handbackElapsedSec = 0;
    this.handbackDurationSec = Math.max(0.15, durationSec);
    this.handbackStartPitchDeg = this.pitchDeltaDeg;
    this.handbackStartBlur = this.tiltShiftBlur;
    this.handbackStartFocusY = this.tiltShiftFocusY;
    this.handbackStartDarkness = this.spotlightDarkness;
    this.hasPrevGameplayCam = false;
    this.activeSpeaker = '';
    this.activePortraitSpriteId = '';
    this.activePortraitSide = 'left';
    this.activeSubtitle = '';
  }

  /**
   * Resolves an entity's center `(cx, cy)` and facing `(fx, fy)` by entityId or tag (Zero-GC).
   */
  public resolveSubjectInWorld(
    subjectKey: string | undefined,
    world: EcsWorld,
    fallbackX: number,
    fallbackY: number,
    out: [number, number, number, number],
  ): boolean {
    out[0] = fallbackX;
    out[1] = fallbackY;
    out[2] = 0;
    out[3] = 1;
    if (!subjectKey || subjectKey === 'point') return false;

    const core = world.core;
    const c = core.components;
    const tagStore = core.getStore(c.Tag);
    for (let i = 0; i < tagStore.size(); i++) {
      const td = tagStore.getDenseDataAt(i);
      if (td.entityId === subjectKey || td.tag === subjectKey) {
        const eh = tagStore.getDenseEntityAt(i);
        const tr = core.getComponent(eh, c.Transform2D);
        const mat = core.getComponent(eh, c.Material);
        if (tr) {
          out[0] = tr.x + tr.w * 0.5;
          out[1] = tr.y + tr.h * 0.5;
          out[2] = mat?.flipX ? -1 : 1;
          out[3] = 0;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Steps the Cinematic Director at 60Hz (Zero-GC).
   * Handles Active Cutscene Shots, Peek Pans, Phase-3 Spring Handback, and Live Gameplay Framing.
   */
  public step(
    realDt: number,
    world: EcsWorld,
    heroCx: number,
    heroCy: number,
    heroFacingX: number,
    heroFacingY: number,
    heroMoving: boolean,
    bossCx: number | null,
    bossCy: number | null,
    vpW: number,
    vpH: number,
    roomWorldW: number,
    roomWorldH: number,
    baseTiltShiftBlur: number,
    onShotStart?: (shot: EcsCutsceneShotDef) => void,
    baseTiltShiftFocusY = 0.52,
  ): void {
    const dt = Math.max(0.0001, Math.min(0.1, realDt));

    if (this.splashTimerSec > 0) {
      this.splashTimerSec = Math.max(0, this.splashTimerSec - dt);
      if (this.splashTimerSec <= 0) {
        this.activeSplashTitle = '';
        this.activeSplashSubtitle = '';
      }
    }

    // Decay combat impact micro-cut-in & bullet-time curve
    if (this.impactTimerSec > 0) {
      this.impactTimerSec = Math.max(0, this.impactTimerSec - dt);
      const norm = this.impactDurationSec > 0 ? this.impactTimerSec / this.impactDurationSec : 0;
      const smooth = norm * norm;
      this.impactZoomBoost *= Math.pow(0.04, dt);
      this.impactBlurBoost *= Math.pow(0.05, dt);
      this.impactTimeScale = 1.0 - (1.0 - this.impactTimeScale) * smooth;
      if (this.impactTimerSec <= 0) {
        this.impactZoomBoost = 0;
        this.impactBlurBoost = 0;
        this.impactTimeScale = 1.0;
      }
    }

    // 1. Compute canonical gameplay target camera (with Lead-Room Look-Ahead & Toric Boss Framing)
    const leadTargetX = heroMoving ? heroFacingX * 34 : heroFacingX * 14;
    const leadTargetY = heroMoving ? heroFacingY * 22 : heroFacingY * 10;
    this.advanceCritSpring(this.springLeadX, leadTargetX, 2.2, dt);
    this.advanceCritSpring(this.springLeadY, leadTargetY, 2.2, dt);

    let gameplayCenterX = heroCx + this.springLeadX[0];
    let gameplayCenterY = heroCy + this.springLeadY[0];
    let gameplayZoom = 1.0 + this.impactZoomBoost;

    // Toric Two-Shot Boss Battle Framing when an active boss is within engagement distance
    if (bossCx !== null && bossCy !== null) {
      const bossDist = Math.hypot(bossCx - heroCx, bossCy - heroCy);
      if (bossDist < 360) {
        const blend = Math.max(0, Math.min(0.65, (1 - bossDist / 360) * 0.85));
        solveToricTwoShotInto(
          heroCx,
          heroCy,
          bossCx,
          bossCy,
          vpW,
          vpH,
          this.establishedAxisSign,
          0.62,
          this.scratchToric,
        );
        gameplayCenterX = gameplayCenterX * (1 - blend) + this.scratchToric.centerX * blend;
        gameplayCenterY = gameplayCenterY * (1 - blend) + this.scratchToric.centerY * blend;
        gameplayZoom =
          (1.0 * (1 - blend * 0.5) + this.scratchToric.zoom * (blend * 0.5)) + this.impactZoomBoost;
      }
    }

    const gameplayCamX = this.clampAxis(gameplayCenterX - vpW * 0.5, vpW, roomWorldW, gameplayZoom);
    const gameplayCamY = this.clampAxis(gameplayCenterY - vpH * 0.5, vpH, roomWorldH, gameplayZoom);

    // 2. Branch by Director Phase
    if (this.phase === 'playing_shots' && this.activeCutscene) {
      const shot = this.activeCutscene.shots[this.shotIndex];
      if (!shot) {
        this.completedCutsceneIds.add(this.activeCutscene.id);
        this.enterHandback(this.handbackDurationSec);
        return;
      }

      this.shotElapsedSec += dt;
      const totalDur = Math.max(0.1, shot.durationSec);
      const holdSec = Math.max(0, Math.min(totalDur * 0.6, shot.holdBeatSec ?? 0));
      const activeMoveDur = Math.max(0.08, totalDur - holdSec);
      const moveProgress01 = Math.max(0, Math.min(1, this.shotElapsedSec / activeMoveDur));

      // Typewriter subtitle reveal (42 chars/sec)
      if (this.activeSubtitle.length > 0) {
        this.subtitleProgressChars = Math.min(
          this.activeSubtitle.length,
          Math.floor(this.shotElapsedSec * 42) + 1,
        );
      }

      // Resolve primary & secondary actor world coordinates
      const hasPrimary = this.resolveSubjectInWorld(
        shot.subject,
        world,
        shot.focusX ?? heroCx,
        shot.focusY ?? heroCy,
        this.scratchActorA,
      );
      const subAx = hasPrimary ? this.scratchActorA[0] + (shot.focusX ?? 0) : (shot.focusX ?? heroCx);
      const subAy = hasPrimary ? this.scratchActorA[1] + (shot.focusY ?? 0) : (shot.focusY ?? heroCy);
      const subFx = hasPrimary ? this.scratchActorA[2] : heroFacingX;
      const subFy = hasPrimary ? this.scratchActorA[3] : heroFacingY;

      const sizePreset = SHOT_SIZE_PRESETS[shot.shotSize ?? 'MS'];
      let targetZoom = shot.zoomOverride ?? sizePreset.zoom;
      let targetCenterX = subAx;
      let targetCenterY = subAy;

      const anchor = shot.anchor ?? 'center';
      if (anchor === 'two_shot' && shot.secondarySubject) {
        this.resolveSubjectInWorld(shot.secondarySubject, world, bossCx ?? subAx + 96, bossCy ?? subAy, this.scratchActorB);
        solveToricTwoShotInto(
          subAx,
          subAy,
          this.scratchActorB[0],
          this.scratchActorB[1],
          vpW,
          vpH,
          this.establishedAxisSign,
          0.52,
          this.scratchToric,
        );
        this.establishedAxisSign = this.scratchToric.axisSign;
        targetCenterX = this.scratchToric.centerX;
        targetCenterY = this.scratchToric.centerY;
        if (shot.zoomOverride === undefined) {
          targetZoom = this.scratchToric.zoom;
        }
      } else {
        resolveScreenAnchorNorm(anchor, subFx, subFy, this.scratchUv);
        // Place subject at normalized screen coordinate (u, v) by shifting camera center
        const effW = vpW / Math.max(0.25, targetZoom);
        const effH = vpH / Math.max(0.25, targetZoom);
        targetCenterX = subAx - (this.scratchUv[0] - 0.5) * effW;
        targetCenterY = subAy - (this.scratchUv[1] - 0.5) * effH;
      }

      // Apply camera motion profile (push_in, pull_out, impact_zoom, cut, spring)
      const motion = shot.motion ?? 'spring';
      if (motion === 'push_in') {
        targetZoom *= 0.90 + 0.18 * this.easeCubicInOut(moveProgress01);
      } else if (motion === 'pull_out') {
        targetZoom *= 1.14 - 0.18 * this.easeCubicInOut(moveProgress01);
      } else if (motion === 'impact_zoom') {
        const pulse = Math.sin(moveProgress01 * Math.PI);
        targetZoom *= 1.0 + 0.22 * pulse;
      }

      const targetCamX = this.clampAxis(targetCenterX - vpW * 0.5, vpW, roomWorldW, targetZoom);
      const targetCamY = this.clampAxis(targetCenterY - vpH * 0.5, vpH, roomWorldH, targetZoom);

      if (motion === 'cut' && this.shotElapsedSec <= dt * 1.5) {
        this.cameraX = targetCamX;
        this.cameraY = targetCamY;
        this.cameraZoom = targetZoom;
        this.springCamX[0] = targetCamX;
        this.springCamX[1] = 0;
        this.springCamY[0] = targetCamY;
        this.springCamY[1] = 0;
        this.springZoom[0] = targetZoom;
        this.springZoom[1] = 0;
      } else {
        const freqHz = motion === 'pan_smooth' ? 1.4 : 2.6;
        this.advanceCritSpring(this.springCamX, targetCamX, freqHz, dt);
        this.advanceCritSpring(this.springCamY, targetCamY, freqHz, dt);
        this.advanceCritSpring(this.springZoom, targetZoom, freqHz, dt);
        this.cameraX = this.springCamX[0];
        this.cameraY = this.springCamY[0];
        this.cameraZoom = this.springZoom[0];
      }

      const targetLb = shot.letterbox ?? 1.0;
      this.advanceCritSpring(this.springLetterbox, targetLb, 3.2, dt);
      this.letterboxRatio = Math.max(0, Math.min(1, this.springLetterbox[0]));

      this.pitchDeltaDeg = shot.pitchDegOverride !== undefined ? shot.pitchDegOverride - 42 : sizePreset.pitchDeltaDeg;
      this.tiltShiftBlur = shot.tiltShiftBlurOverride ?? sizePreset.tiltShiftBlur;
      const shotEffH = Math.max(1, vpH / Math.max(0.25, this.cameraZoom));
      this.tiltShiftFocusY = Math.max(
        0.15,
        Math.min(0.85, 0.5 + (subAy - (this.cameraY + vpH * 0.5)) / shotEffH),
      );
      this.spotlightDarkness = Math.max(0, Math.min(0.75, shot.spotlightDarkness ?? 0.12));
      this.timeScale = Math.max(0.05, Math.min(2.0, shot.timeScale ?? 1.0));

      if (this.shotElapsedSec >= totalDur) {
        const nextIdx = this.shotIndex + 1;
        if (nextIdx < this.activeCutscene.shots.length) {
          this.enterShot(nextIdx, onShotStart);
        } else {
          this.completedCutsceneIds.add(this.activeCutscene.id);
          this.enterHandback(this.handbackDurationSec);
        }
      }
      return;
    }

    if (this.phase === 'peek') {
      this.peekRemainingSec -= dt;
      const targetCamX = this.clampAxis(this.peekTargetX - vpW * 0.5, vpW, roomWorldW, this.peekZoom);
      const targetCamY = this.clampAxis(this.peekTargetY - vpH * 0.5, vpH, roomWorldH, this.peekZoom);
      this.advanceCritSpring(this.springCamX, targetCamX, 2.4, dt);
      this.advanceCritSpring(this.springCamY, targetCamY, 2.4, dt);
      this.advanceCritSpring(this.springZoom, this.peekZoom, 2.4, dt);
      this.advanceCritSpring(this.springLetterbox, 0.65, 3.0, dt);
      this.cameraX = this.springCamX[0];
      this.cameraY = this.springCamY[0];
      this.cameraZoom = this.springZoom[0];
      this.letterboxRatio = Math.max(0, Math.min(1, this.springLetterbox[0]));
      this.tiltShiftBlur = Math.max(baseTiltShiftBlur, 0.42);
      const peekEffH = Math.max(1, vpH / Math.max(0.25, this.cameraZoom));
      this.tiltShiftFocusY = Math.max(
        0.15,
        Math.min(0.85, 0.5 + (this.peekTargetY - (this.cameraY + vpH * 0.5)) / peekEffH),
      );
      this.timeScale = 1.0;
      if (this.peekRemainingSec <= 0) {
        this.enterHandback(0.38);
      }
      return;
    }

    if (this.phase === 'handback') {
      this.handbackElapsedSec += dt;
      const freqHz = 1.65 / Math.max(0.15, this.handbackDurationSec);
      const prevCamX = this.hasPrevGameplayCam ? this.prevGameplayCamX : gameplayCamX;
      const prevCamY = this.hasPrevGameplayCam ? this.prevGameplayCamY : gameplayCamY;
      this.prevGameplayCamX = gameplayCamX;
      this.prevGameplayCamY = gameplayCamY;
      this.hasPrevGameplayCam = true;

      this.advanceCritSpring(this.springCamX, gameplayCamX, freqHz, dt, prevCamX, 1.0);
      this.advanceCritSpring(this.springCamY, gameplayCamY, freqHz, dt, prevCamY, 1.0);
      this.advanceCritSpring(this.springZoom, gameplayZoom, freqHz, dt);
      this.advanceCritSpring(this.springLetterbox, 0, freqHz * 1.25, dt);

      this.cameraX = this.springCamX[0];
      this.cameraY = this.springCamY[0];
      this.cameraZoom = this.springZoom[0];
      this.letterboxRatio = Math.max(0, Math.min(1, this.springLetterbox[0]));

      const rawT = Math.max(0, Math.min(1, this.handbackElapsedSec / this.handbackDurationSec));
      const s = rawT * rawT * (3 - 2 * rawT);
      this.pitchDeltaDeg = this.handbackStartPitchDeg * (1 - s);
      this.tiltShiftBlur = this.handbackStartBlur + (baseTiltShiftBlur - this.handbackStartBlur) * s;
      this.tiltShiftFocusY = this.handbackStartFocusY + (baseTiltShiftFocusY - this.handbackStartFocusY) * s;
      this.spotlightDarkness = this.handbackStartDarkness * (1 - s);
      this.timeScale = 1.0;

      const posErr = Math.hypot(this.cameraX - gameplayCamX, this.cameraY - gameplayCamY);
      const zoomErr = Math.abs(this.cameraZoom - gameplayZoom);
      const timedOut = this.handbackElapsedSec >= this.handbackDurationSec * 1.6;
      if (
        timedOut ||
        (this.handbackElapsedSec >= this.handbackDurationSec && posErr < 1.5 && zoomErr < 0.02)
      ) {
        this.phase = 'idle';
        this.activeCutscene = null;
        this.cameraX = gameplayCamX;
        this.cameraY = gameplayCamY;
        this.cameraZoom = gameplayZoom;
        this.springCamX[0] = gameplayCamX;
        this.springCamX[1] = 0;
        this.springCamY[0] = gameplayCamY;
        this.springCamY[1] = 0;
        this.springZoom[0] = gameplayZoom;
        this.springZoom[1] = 0;
        this.letterboxRatio = 0;
        this.pitchDeltaDeg = 0;
        this.tiltShiftBlur = baseTiltShiftBlur;
        this.tiltShiftFocusY = baseTiltShiftFocusY;
        this.spotlightDarkness = 0;
      }
      return;
    }

    // 3. Default Phase ('idle'): Live Gameplay Framing with Critically Damped Spring Follow
    this.advanceCritSpring(this.springZoom, gameplayZoom, 2.8, dt);
    this.cameraZoom = this.springZoom[0];

    const followRate = 1 - Math.exp(-10 * dt);
    this.cameraX += (gameplayCamX - this.cameraX) * followRate;
    this.cameraY += (gameplayCamY - this.cameraY) * followRate;
    this.cameraX = this.clampAxis(this.cameraX, vpW, roomWorldW, this.cameraZoom);
    this.cameraY = this.clampAxis(this.cameraY, vpH, roomWorldH, this.cameraZoom);

    this.letterboxRatio = 0;
    this.pitchDeltaDeg = 0;
    this.spotlightDarkness = this.impactTimerSec > 0 ? Math.min(0.28, this.impactBlurBoost * 0.7) : 0;
    this.tiltShiftBlur = Math.min(0.85, baseTiltShiftBlur + this.impactBlurBoost);
    const idleEffH = Math.max(1, vpH / Math.max(0.25, this.cameraZoom));
    this.tiltShiftFocusY =
      this.impactTimerSec > 0
        ? Math.max(
            0.18,
            Math.min(0.82, 0.5 + (this.impactFocusY - (this.cameraY + vpH * 0.5)) / idleEffH),
          )
        : baseTiltShiftFocusY;
    this.timeScale = this.impactTimeScale;
  }

  /**
   * Appends 21:9 Cinema Letterbox Bars, Typewriter Subtitle Box, and Boss/Act Splash Title Card
   * into the pre-allocated HUD pool (Zero-GC).
   */
  public appendCinemaOverlayHud(
    outHud: HudPrimitiveDesc[],
    acquireHud: (idx: number) => HudPrimitiveDesc,
    startCount: number,
    vpW: number,
    vpH: number,
    accentHex: string,
  ): number {
    let hCount = startCount;

    // 1. 21:9 Cinema Letterbox Bars
    if (this.letterboxRatio > 0.01) {
      const barH = Math.round(vpH * 0.115 * this.letterboxRatio);
      if (barH > 0) {
        const topBar = acquireHud(hCount);
        topBar.kind = 'box';
        topBar.x = 0;
        topBar.y = 0;
        topBar.w = vpW;
        topBar.h = barH;
        topBar.color = '#020617';
        topBar.alpha = 0.94;
        topBar.worldSpace = false;
        outHud[hCount++] = topBar;

        const botBar = acquireHud(hCount);
        botBar.kind = 'box';
        botBar.x = 0;
        botBar.y = vpH - barH;
        botBar.w = vpW;
        botBar.h = barH;
        botBar.color = '#020617';
        botBar.alpha = 0.94;
        botBar.worldSpace = false;
        outHud[hCount++] = botBar;
      }
    }

    // 2. Boss / Act Splash Title Card
    if (this.activeSplashTitle && this.splashTimerSec > 0) {
      const alpha = Math.min(1, this.splashTimerSec * 2.5);
      const cardY = Math.round(vpH * 0.24);
      const plate = acquireHud(hCount);
      plate.kind = 'box';
      plate.x = Math.round(vpW * 0.18);
      plate.y = cardY - 6;
      plate.w = Math.round(vpW * 0.64);
      plate.h = this.activeSplashSubtitle ? 46 : 30;
      plate.color = '#090d16';
      plate.alpha = 0.78 * alpha;
      plate.worldSpace = false;
      outHud[hCount++] = plate;

      const rule = acquireHud(hCount);
      rule.kind = 'box';
      rule.x = Math.round(vpW * 0.25);
      rule.y = cardY + (this.activeSplashSubtitle ? 20 : 21);
      rule.w = Math.round(vpW * 0.5);
      rule.h = 2;
      rule.color = accentHex;
      rule.alpha = 0.92 * alpha;
      rule.worldSpace = false;
      outHud[hCount++] = rule;

      const title = acquireHud(hCount);
      title.kind = 'text';
      title.x = Math.round(vpW * 0.5);
      title.y = cardY;
      title.w = 0;
      title.h = 0;
      title.text = this.activeSplashTitle;
      title.scale = 2;
      title.align = 'center';
      title.color = '#fef08a';
      title.shadowColor = '#020617';
      title.alpha = alpha;
      title.worldSpace = false;
      outHud[hCount++] = title;

      if (this.activeSplashSubtitle) {
        const sub = acquireHud(hCount);
        sub.kind = 'text';
        sub.x = Math.round(vpW * 0.5);
        sub.y = cardY + 26;
        sub.w = 0;
        sub.h = 0;
        sub.text = this.activeSplashSubtitle;
        sub.scale = 1;
        sub.align = 'center';
        sub.color = '#e2e8f0';
        sub.shadowColor = '#020617';
        sub.alpha = 0.92 * alpha;
        sub.worldSpace = false;
        outHud[hCount++] = sub;
      }
    }

    // 3. Pass 1B Portrait & Typewriter Dialogue Overlay
    if (this.phase === 'playing_shots' && (this.activePortraitSpriteId || this.activeSubtitle)) {
      const barH = Math.round(vpH * 0.115 * this.letterboxRatio);
      const subY = vpH - Math.max(24, barH + 22);
      const plateTop = subY - 5;

      if (this.activePortraitSpriteId) {
        const pH = Math.max(48, Math.min(192, Math.round(vpH * 0.44)));
        const pW = Math.round(pH * (160 / 192));
        const marginX = Math.max(12, Math.round(vpW * 0.1));
        const pX = this.activePortraitSide === 'right' ? vpW - marginX - pW : marginX;
        const pY = Math.max(barH + 4, plateTop - pH + 4);

        const pBack = acquireHud(hCount);
        pBack.kind = 'box';
        pBack.x = pX - 3;
        pBack.y = pY - 3;
        pBack.w = pW + 6;
        pBack.h = pH + 6;
        pBack.color = '#090d16';
        pBack.alpha = 0.72;
        pBack.worldSpace = false;
        outHud[hCount++] = pBack;

        const pBorder = acquireHud(hCount);
        pBorder.kind = 'box';
        pBorder.x = pX - 3;
        pBorder.y = pY - 3;
        pBorder.w = pW + 6;
        pBorder.h = 2;
        pBorder.color = accentHex;
        pBorder.alpha = 0.92;
        pBorder.worldSpace = false;
        outHud[hCount++] = pBorder;

        const portrait = acquireHud(hCount);
        portrait.kind = 'sprite';
        portrait.sprite = this.activePortraitSpriteId;
        portrait.flipX = this.activePortraitSide === 'right';
        portrait.x = pX;
        portrait.y = pY;
        portrait.w = pW;
        portrait.h = pH;
        portrait.color = '#ffffff';
        portrait.alpha = 1;
        portrait.worldSpace = false;
        outHud[hCount++] = portrait;
      }

      if (this.activeSubtitle) {
        const visibleText = this.activeSubtitle.slice(0, this.subtitleProgressChars);
        const fullLine = this.activeSpeaker ? `${this.activeSpeaker}: ${visibleText}` : visibleText;

        const subPlate = acquireHud(hCount);
        subPlate.kind = 'box';
        subPlate.x = Math.round(vpW * 0.12);
        subPlate.y = plateTop;
        subPlate.w = Math.round(vpW * 0.76);
        subPlate.h = 20;
        subPlate.color = '#090d16';
        subPlate.alpha = 0.84;
        subPlate.worldSpace = false;
        outHud[hCount++] = subPlate;

        const txt = acquireHud(hCount);
        txt.kind = 'text';
        txt.x = Math.round(vpW * 0.5);
        txt.y = subY;
        txt.w = 0;
        txt.h = 0;
        txt.text = fullLine;
        txt.scale = 1;
        txt.align = 'center';
        txt.color = '#f8fafc';
        txt.shadowColor = '#020617';
        txt.alpha = 0.98;
        txt.worldSpace = false;
        outHud[hCount++] = txt;
      }
    }

    return hCount;
  }

  private clampAxis(pos: number, viewSpan: number, worldSpan: number, zoom = 1.0): number {
    const effSpan = viewSpan / Math.max(0.25, zoom);
    if (effSpan >= worldSpan) {
      return (worldSpan - viewSpan) * 0.5;
    }
    const minPos = (effSpan - viewSpan) * 0.5;
    const maxPos = worldSpan - (viewSpan + effSpan) * 0.5;
    return Math.max(minPos, Math.min(maxPos, pos));
  }

  private easeCubicInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) * 0.5;
  }
}
