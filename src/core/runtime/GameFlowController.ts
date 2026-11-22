import type { CameraShotId } from './CameraRigDirector.ts';

/**
 * Engine 10.0 — Multi-Scene Game Flow State Machine (100% DOM-free).
 *
 * Replaces single-level `playing | won | lost` loops with a true standalone-app
 * scene progression graph (`title -> lobby -> select/course/profile -> intro -> playing -> paused -> result -> studio`)
 * paired with continuous camera-shot transitions (zero black-screen hard cuts).
 */

export type GameSceneId =
  | 'title'
  | 'lobby'
  | 'select'
  | 'course'
  | 'profile'
  | 'intro'
  | 'playing'
  | 'paused'
  | 'result'
  | 'studio';

export interface GameFlowTransition {
  from: GameSceneId;
  to: GameSceneId;
  durationSec: number;
  elapsedSec: number;
  progress: number;
}

export interface GameFlowSnapshot {
  scene: GameSceneId;
  previousScene: GameSceneId;
  transition: GameFlowTransition | null;
  introRemainingSec: number;
  bodyStateAttr: 'title' | 'playing' | 'paused' | 'gameover' | 'menu';
}

export function resolveSceneCameraShot(scene: GameSceneId): CameraShotId {
  switch (scene) {
    case 'title':
      return 'TITLE_ORBIT';
    case 'lobby':
      return 'LOBBY_HERO';
    case 'select':
      return 'SELECT_CAROUSEL';
    case 'course':
      return 'COURSE_HALL';
    case 'profile':
      return 'PROFILE_SANCTUM';
    case 'intro':
      return 'STAGE_FLYIN';
    case 'playing':
    case 'paused':
      return 'PLAY_STANDARD';
    case 'result':
      return 'RESULT_WIDE';
    case 'studio':
      return 'LOBBY_HERO';
  }
}

export function resolveBodyDatasetState(
  scene: GameSceneId,
): 'title' | 'playing' | 'paused' | 'gameover' | 'menu' {
  switch (scene) {
    case 'title':
      return 'title';
    case 'intro':
    case 'playing':
      return 'playing';
    case 'paused':
      return 'paused';
    case 'result':
      return 'gameover';
    default:
      return 'menu';
  }
}

export class GameFlowController {
  private scene: GameSceneId;
  private previousScene: GameSceneId;
  private transition: GameFlowTransition | null = null;
  private introDurationSec = 1.15;
  private introElapsedSec = 0;

  private readonly snapshotObj: GameFlowSnapshot = {
    scene: 'title',
    previousScene: 'title',
    transition: null,
    introRemainingSec: 0,
    bodyStateAttr: 'title',
  };

  constructor(initialScene: GameSceneId = 'title') {
    this.scene = initialScene;
    this.previousScene = initialScene;
    this.syncSnapshot();
  }

  public getScene(): GameSceneId {
    return this.scene;
  }

  public getPreviousScene(): GameSceneId {
    return this.previousScene;
  }

  public isTransitioning(): boolean {
    return this.transition !== null;
  }

  public getSnapshot(): Readonly<GameFlowSnapshot> {
    this.syncSnapshot();
    return this.snapshotObj;
  }

  /**
   * Navigates immediately to `next` with a smooth camera-blended transition window.
   */
  public goTo(next: GameSceneId, transitionSec = 0.42): boolean {
    if (next === this.scene) return false;
    this.previousScene = this.scene;
    this.scene = next;
    if (next === 'intro') {
      this.introElapsedSec = 0;
      this.introDurationSec = Math.max(0.6, transitionSec > 0.6 ? transitionSec : 1.15);
    }
    this.transition =
      transitionSec > 0
        ? {
            from: this.previousScene,
            to: next,
            durationSec: transitionSec,
            elapsedSec: 0,
            progress: 0,
          }
        : null;
    this.syncSnapshot();
    return true;
  }

  /**
   * Starts a stage fly-in intro that automatically promotes to `playing` once complete
   * (or can be skipped immediately via `skipIntro()`).
   */
  public startStageIntro(durationSec = 1.15): void {
    this.introDurationSec = Math.max(0.5, durationSec);
    this.introElapsedSec = 0;
    this.previousScene = this.scene;
    this.scene = 'intro';
    this.transition = {
      from: this.previousScene,
      to: 'intro',
      durationSec: this.introDurationSec,
      elapsedSec: 0,
      progress: 0,
    };
    this.syncSnapshot();
  }

  public skipIntro(): boolean {
    if (this.scene !== 'intro') return false;
    this.previousScene = 'intro';
    this.scene = 'playing';
    this.introElapsedSec = this.introDurationSec;
    this.transition = null;
    this.syncSnapshot();
    return true;
  }

  public pause(): boolean {
    if (this.scene !== 'playing') return false;
    return this.goTo('paused', 0.18);
  }

  public resume(): boolean {
    if (this.scene !== 'paused') return false;
    return this.goTo('playing', 0.18);
  }

  /**
   * Advances transition timers and auto-completes `intro -> playing`.
   * Returns `'intro_complete'` on the exact frame the fly-in finishes.
   */
  public step(dtSec: number): 'none' | 'intro_complete' {
    const dt = Math.max(0, Math.min(0.05, dtSec));

    if (this.transition) {
      this.transition.elapsedSec += dt;
      if (this.transition.elapsedSec >= this.transition.durationSec) {
        this.transition = null;
      } else {
        this.transition.progress = this.transition.elapsedSec / this.transition.durationSec;
      }
    }

    if (this.scene === 'intro') {
      this.introElapsedSec += dt;
      if (this.introElapsedSec >= this.introDurationSec) {
        this.previousScene = 'intro';
        this.scene = 'playing';
        this.transition = null;
        this.syncSnapshot();
        return 'intro_complete';
      }
    }

    this.syncSnapshot();
    return 'none';
  }

  private syncSnapshot(): void {
    this.snapshotObj.scene = this.scene;
    this.snapshotObj.previousScene = this.previousScene;
    this.snapshotObj.transition = this.transition;
    this.snapshotObj.introRemainingSec =
      this.scene === 'intro' ? Math.max(0, this.introDurationSec - this.introElapsedSec) : 0;
    this.snapshotObj.bodyStateAttr = resolveBodyDatasetState(this.scene);
  }
}
