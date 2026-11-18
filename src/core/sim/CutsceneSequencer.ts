import type { SpriteId } from '../../assets/TextureAtlas.ts';
import type { ChronicleCutsceneView } from '../types/WorldTypes.ts';
import type { CameraDirector } from './CameraDirector.ts';

export interface CutsceneChoiceDef {
  id: string;
  label: string;
  enabled?: boolean;
}

export type CutsceneStep =
  | { type: 'letterbox'; ratio: number; duration?: number }
  | { type: 'camera_pan'; x: number; y: number; zoom: number; duration: number }
  | { type: 'title_card'; title: string; subtitle: string; duration: number }
  | {
      type: 'dialog';
      speaker: string;
      speakerRole: string;
      portrait: SpriteId;
      text: string;
      choices?: CutsceneChoiceDef[];
    }
  | { type: 'restore_camera'; zoom?: number; duration?: number }
  | { type: 'event'; name: string };

export interface CutsceneCallbacks {
  onEvent?: (name: string) => void;
  onChoice?: (choiceId: string) => void;
}

/**
 * Engine 2.0 CutsceneSequencer:
 * declarative storyboard timeline orchestrating CameraDirector pans, cinema letterbox,
 * Boss intro title plates, and interactive branching NPC/story dialogues.
 */
export class CutsceneSequencer {
  private queue: CutsceneStep[] = [];
  private activeStep: CutsceneStep | null = null;
  private stepElapsed = 0;
  private selectedChoiceIdx = 0;
  private titleCard: { title: string; subtitle: string } | null = null;
  private callbacks: CutsceneCallbacks = {};

  public setCallbacks(cb: CutsceneCallbacks): void {
    this.callbacks = cb;
  }

  public isActive(): boolean {
    return this.activeStep !== null || this.queue.length > 0;
  }

  public play(steps: CutsceneStep[]): void {
    this.queue = [...steps];
    this.activeStep = null;
    this.stepElapsed = 0;
    this.selectedChoiceIdx = 0;
    this.titleCard = null;
  }

  public clear(camera?: CameraDirector): void {
    this.queue = [];
    this.activeStep = null;
    this.titleCard = null;
    this.selectedChoiceIdx = 0;
    if (camera) {
      camera.setLetterbox(0);
      camera.resumeFollow(1.15);
    }
  }

  public moveChoice(delta: number): void {
    if (!this.activeStep || this.activeStep.type !== 'dialog' || !this.activeStep.choices?.length) return;
    const len = this.activeStep.choices.length;
    this.selectedChoiceIdx = (this.selectedChoiceIdx + delta + len) % len;
  }

  public advanceDialog(camera: CameraDirector, explicitChoiceId?: string): boolean {
    if (!this.activeStep || this.activeStep.type !== 'dialog') return false;
    const choices = this.activeStep.choices;
    if (choices && choices.length > 0) {
      const picked = explicitChoiceId
        ? choices.find((c) => c.id === explicitChoiceId)
        : choices[this.selectedChoiceIdx];
      if (!picked || picked.enabled === false) return false;
      this.callbacks.onChoice?.(picked.id);
    }
    this.activeStep = null;
    this.stepElapsed = 0;
    this.pumpImmediateSteps(camera);
    return true;
  }

  private pumpImmediateSteps(camera: CameraDirector): void {
    while (!this.activeStep && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.type === 'event') {
        this.callbacks.onEvent?.(next.name);
        continue;
      }
      if (next.type === 'letterbox') {
        camera.setLetterbox(next.ratio);
        if ((next.duration ?? 0) <= 0.01) continue;
        this.activeStep = next;
        this.stepElapsed = 0;
        return;
      }
      if (next.type === 'camera_pan') {
        camera.panTo(next.x, next.y, next.zoom, next.duration);
        if (next.duration <= 0.01) continue;
        this.activeStep = next;
        this.stepElapsed = 0;
        return;
      }
      if (next.type === 'restore_camera') {
        camera.setLetterbox(0);
        camera.resumeFollow(next.zoom ?? 1.15);
        if ((next.duration ?? 0) <= 0.01) continue;
        this.activeStep = next;
        this.stepElapsed = 0;
        return;
      }
      if (next.type === 'title_card') {
        this.titleCard = { title: next.title, subtitle: next.subtitle };
        this.activeStep = next;
        this.stepElapsed = 0;
        return;
      }
      if (next.type === 'dialog') {
        this.selectedChoiceIdx = 0;
        this.activeStep = next;
        this.stepElapsed = 0;
        return;
      }
    }
  }

  public step(dt: number, camera: CameraDirector): void {
    this.pumpImmediateSteps(camera);
    if (!this.activeStep) return;

    this.stepElapsed += dt;
    const s = this.activeStep;
    if (s.type === 'letterbox' && this.stepElapsed >= (s.duration ?? 0)) {
      this.activeStep = null;
      this.pumpImmediateSteps(camera);
    } else if (s.type === 'camera_pan' && this.stepElapsed >= s.duration) {
      this.activeStep = null;
      this.pumpImmediateSteps(camera);
    } else if (s.type === 'restore_camera' && this.stepElapsed >= (s.duration ?? 0)) {
      this.activeStep = null;
      this.pumpImmediateSteps(camera);
    } else if (s.type === 'title_card' && this.stepElapsed >= s.duration) {
      this.titleCard = null;
      this.activeStep = null;
      this.pumpImmediateSteps(camera);
    }
  }

  public getViewSnapshot(): ChronicleCutsceneView | undefined {
    const s = this.activeStep;
    if (!s) return undefined;
    if (s.type === 'dialog') {
      return {
        speaker: s.speaker,
        speakerRole: s.speakerRole,
        portraitSprite: s.portrait,
        text: s.text,
        bossTitleCard: this.titleCard ?? undefined,
        choices: s.choices?.map((c) => ({ id: c.id, label: c.label, enabled: c.enabled !== false })),
        selectedChoiceIdx: this.selectedChoiceIdx,
        awaitingInput: true,
      };
    }
    if (this.titleCard) {
      return {
        speaker: '',
        speakerRole: '',
        portraitSprite: 'dragon',
        text: '',
        bossTitleCard: this.titleCard,
        selectedChoiceIdx: 0,
        awaitingInput: false,
      };
    }
    return undefined;
  }
}
