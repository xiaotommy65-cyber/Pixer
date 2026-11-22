import type { SpriteId } from '../../assets/TextureAtlas.ts';

export type AnimCompareOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface AnimationFrameEventDef {
  frameIndex: number;
  event: string;
}

export interface AnimationClipDef {
  name: string;
  frames: SpriteId[];
  fps: number;
  loop?: boolean;
  events?: AnimationFrameEventDef[];
}

export interface AnimationTransitionDef {
  from: string; // clip name or '*'
  to: string;
  param: string;
  op: AnimCompareOp;
  value: number;
  priority?: number;
}

export interface AnimationStateMachineDef {
  id: string;
  initialState: string;
  clips: AnimationClipDef[];
  transitions: AnimationTransitionDef[];
}

export interface AnimationStepResult {
  spriteId: SpriteId;
  stateName: string;
  frameIndex: number;
  emittedEvent: string | null;
  finished: boolean;
}

/**
 * Pure DOM-free, Zero-GC data-driven Animation State Machine runtime.
 * Supports multi-frame sprite sheet clips, parameter-driven transitions,
 * and deterministic frame events (e.g. footstep, attack_hit, muzzle_flash).
 */
export class AnimationStateMachineRuntime {
  private readonly clips = new Map<string, AnimationClipDef>();
  private readonly transitions: AnimationTransitionDef[] = [];
  private readonly params = new Map<string, number>();

  private currentState = '';
  private currentClip: AnimationClipDef | null = null;
  private frameIndex = 0;
  private frameTimer = 0;
  private finished = false;
  private lastSprite: SpriteId = 'solid';

  constructor(def?: AnimationStateMachineDef) {
    if (def) {
      this.load(def);
    }
  }

  public load(def: AnimationStateMachineDef): void {
    this.clips.clear();
    this.transitions.length = 0;
    this.params.clear();
    for (let i = 0; i < def.clips.length; i++) {
      const c = def.clips[i];
      this.clips.set(c.name, c);
    }
    for (let i = 0; i < def.transitions.length; i++) {
      this.transitions.push(def.transitions[i]);
    }
    this.transitions.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.setState(def.initialState || def.clips[0]?.name || '');
  }

  public setParam(name: string, value: number): void {
    this.params.set(name, value);
  }

  public getParam(name: string): number {
    return this.params.get(name) ?? 0;
  }

  public getCurrentState(): string {
    return this.currentState;
  }

  public getCurrentFrameIndex(): number {
    return this.frameIndex;
  }

  public setState(stateName: string): boolean {
    const clip = this.clips.get(stateName);
    if (!clip) return false;
    this.currentState = stateName;
    this.currentClip = clip;
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.finished = false;
    this.lastSprite = clip.frames[0] ?? 'solid';
    return true;
  }

  private matches(tr: AnimationTransitionDef): boolean {
    if (tr.from !== '*' && tr.from !== this.currentState) return false;
    if (tr.to === this.currentState) return false;
    const v = this.params.get(tr.param) ?? 0;
    switch (tr.op) {
      case 'eq':
        return Math.abs(v - tr.value) < 1e-5;
      case 'neq':
        return Math.abs(v - tr.value) >= 1e-5;
      case 'gt':
        return v > tr.value;
      case 'gte':
        return v >= tr.value;
      case 'lt':
        return v < tr.value;
      case 'lte':
        return v <= tr.value;
      default:
        return false;
    }
  }

  /**
   * Advances state machine by dtSec and writes results into pre-allocated `out` object (Zero-GC).
   */
  public step(dtSec: number, out: AnimationStepResult): AnimationStepResult {
    out.emittedEvent = null;

    // 1. Evaluate transitions in descending priority order
    for (let i = 0; i < this.transitions.length; i++) {
      const tr = this.transitions[i];
      if (this.matches(tr)) {
        this.setState(tr.to);
        break;
      }
    }

    const clip = this.currentClip;
    if (!clip || clip.frames.length === 0) {
      out.spriteId = this.lastSprite;
      out.stateName = this.currentState;
      out.frameIndex = 0;
      out.finished = true;
      return out;
    }

    const frameDur = 1 / Math.max(1, clip.fps);
    const loop = clip.loop !== false;

    if (!this.finished) {
      this.frameTimer += dtSec;
      while (this.frameTimer >= frameDur) {
        this.frameTimer -= frameDur;
        const nextIdx = this.frameIndex + 1;
        if (nextIdx >= clip.frames.length) {
          if (loop) {
            this.frameIndex = 0;
          } else {
            this.frameIndex = clip.frames.length - 1;
            this.finished = true;
            this.frameTimer = 0;
            break;
          }
        } else {
          this.frameIndex = nextIdx;
        }
        if (clip.events) {
          for (let e = 0; e < clip.events.length; e++) {
            if (clip.events[e].frameIndex === this.frameIndex) {
              out.emittedEvent = clip.events[e].event;
              break;
            }
          }
        }
      }
    }

    this.lastSprite = clip.frames[this.frameIndex] ?? this.lastSprite;
    out.spriteId = this.lastSprite;
    out.stateName = this.currentState;
    out.frameIndex = this.frameIndex;
    out.finished = this.finished;
    return out;
  }
}
