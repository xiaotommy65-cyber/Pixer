import type { AudioSpectrumFrame } from '../core/audio/RhythmAudioEngine.ts';
import { Stage3DPipeline } from '../core/gpu/Stage3DPipeline.ts';
import type { RhythmJudgeEngine, RhythmLiveState } from '../core/rhythm/RhythmJudgeEngine.ts';
import type { RhythmPlayerConfig, RhythmSongProject } from '../core/rhythm/RhythmTypes.ts';
import type { CameraRigDirector } from '../core/runtime/CameraRigDirector.ts';
import type { GameSceneId } from '../core/runtime/GameFlowController.ts';
import { getSongJacketImage, getStageDomeImage } from './RhythmArtRegistry.ts';

/**
 * UI Adapter for the Engine 10.0 `Stage3DPipeline`.
 * Injects high-resolution concert dome & album jacket textures from `RhythmArtRegistry`
 * while keeping `src/core/gpu/Stage3DPipeline.ts` decoupled from Vite asset imports.
 */
export class RhythmStageRenderer {
  public readonly pipeline: Stage3DPipeline;
  private lastJacketSongId = '';

  constructor(canvas: HTMLCanvasElement, camera?: CameraRigDirector) {
    this.pipeline = new Stage3DPipeline(canvas, camera);
    this.pipeline.setDomeImage(getStageDomeImage());
  }

  public resize(cssWidth: number, cssHeight: number, dpr = window.devicePixelRatio || 1): void {
    this.pipeline.resize(cssWidth, cssHeight, dpr);
  }

  public resetEffects(): void {
    this.pipeline.resetEffects();
  }

  public syncSongVisuals(project: RhythmSongProject | null): void {
    if (!project) return;
    this.pipeline.setThemeColors(project.accentPrimary, project.accentSecondary);
    if (this.lastJacketSongId !== project.id) {
      this.lastJacketSongId = project.id;
      this.pipeline.setActiveJacketImage(getSongJacketImage(project.id));
    }
  }

  public renderFrame(params: {
    dtSec: number;
    scene: GameSceneId;
    spectrum: Readonly<AudioSpectrumFrame>;
    project: RhythmSongProject | null;
    config: RhythmPlayerConfig;
    judgeEngine: RhythmJudgeEngine | null;
    liveState: RhythmLiveState | null;
    introProgress?: number;
  }): void {
    this.syncSongVisuals(params.project);
    this.pipeline.render(params);
  }
}
