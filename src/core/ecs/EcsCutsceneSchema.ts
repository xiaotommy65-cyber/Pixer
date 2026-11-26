import type { BgmTheme } from '../types/SceneTypes.ts';

/**
 * Auteur Actor-Relative Shot Size Presets:
 * - EWS: Extreme Wide Shot (panoramic arena / room overview)
 * - WS:  Wide Shot (establishing framing)
 * - MS:  Medium Shot (standard narrative framing)
 * - CU:  Close-Up (character expression / combat stance detail + medium Tilt-Shift DoF)
 * - ECU: Extreme Close-Up (dramatic cut-in / relic / blade detail + strong Tilt-Shift DoF)
 */
export type EcsShotSize = 'EWS' | 'WS' | 'MS' | 'CU' | 'ECU';

/**
 * Rule-of-Thirds & Toric Space Screen Composition Anchors:
 * - center:      (0.50, 0.50) dead-center symmetry
 * - left_third:  (0.333, 0.50) subject on left vertical third line (looking right)
 * - right_third: (0.667, 0.50) subject on right vertical third line (looking left)
 * - upper_third: (0.50, 0.36) subject on upper horizontal third line
 * - lower_third: (0.50, 0.64) subject on lower horizontal third line
 * - lead_room:   dynamic offset in front of subject's facing vector
 * - two_shot:    Toric 2-target algebraic framing keeping both subjects on golden thirds & 180-deg axis
 */
export type EcsScreenAnchor =
  | 'center'
  | 'left_third'
  | 'right_third'
  | 'upper_third'
  | 'lower_third'
  | 'lead_room'
  | 'two_shot';

export type EcsCameraMotionKind =
  | 'cut'
  | 'spring'
  | 'push_in'
  | 'pull_out'
  | 'pan_smooth'
  | 'impact_zoom';

export type EcsCutsceneTrigger =
  | 'manual'
  | 'on_room_enter'
  | 'on_global_set'
  | 'on_boss_phase';

/**
 * Murch Dramaturgy 14-Field Shot Card in Actor-Relative DSL.
 */
export interface EcsCutsceneShotDef {
  id: string;
  durationSec: number;
  /** Primary subject entity ID or tag (e.g., 'hero', 'boss') or 'point' for world coordinates. */
  subject?: string;
  /** Secondary subject entity ID or tag for 'two_shot' Toric framing. */
  secondarySubject?: string;
  /** Optional world-space focus X (or offset X when subject is an entity). */
  focusX?: number;
  /** Optional world-space focus Y (or offset Y when subject is an entity). */
  focusY?: number;
  shotSize?: EcsShotSize;
  anchor?: EcsScreenAnchor;
  motion?: EcsCameraMotionKind;
  zoomOverride?: number;
  pitchDegOverride?: number;
  tiltShiftBlurOverride?: number;
  /** Time dilation factor during this shot (0.08..2.0, default 1.0; < 1.0 = Bullet-Time slow-mo). */
  timeScale?: number;
  /** Murch Half-Beat Hold duration at end of shot (seconds). */
  holdBeatSec?: number;
  /** Explicit dramaturgical motivation for the camera move (e.g., 'gate_unsealed', 'boss_awakening'). */
  motivation?: string;
  /** Dialogue speaker badge label. */
  speaker?: string;
  /** Optional 160x192 / 256x256 character portrait sprite ID rendered above the dialogue bar in Pass 1B. */
  portraitSpriteId?: string;
  /** Portrait screen side ('left' | 'right', default 'left'). */
  portraitSide?: 'left' | 'right';
  /** Typewriter subtitle line. */
  subtitle?: string;
  /** Large act/boss introduction splash banner title. */
  splashTitle?: string;
  /** Splash banner subtitle. */
  splashSubtitle?: string;
  /** 21:9 Cinema Letterbox bar normalized height (0..1, default 1.0 during cutscenes). */
  letterbox?: number;
  /** Extra ambient darkness (0..0.75) to spotlight the framed subject. */
  spotlightDarkness?: number;
  /** Camera trauma shake impulse triggered at the start of this shot (0..1). */
  shakeTrauma?: number;
  /** Optional BGM cue on shot entry. */
  bgmTheme?: BgmTheme;
}

export interface EcsCutsceneDef {
  id: string;
  name: string;
  trigger?: EcsCutsceneTrigger;
  roomId?: string;
  triggerGlobal?: string;
  /** 3-Phase Seamless Handback spring duration in seconds (default 0.45). */
  handbackDurationSec?: number;
  skippable?: boolean;
  shots: EcsCutsceneShotDef[];
}

export const SHOT_SIZE_PRESETS: Readonly<
  Record<EcsShotSize, { zoom: number; tiltShiftBlur: number; pitchDeltaDeg: number }>
> = {
  EWS: { zoom: 0.80, tiltShiftBlur: 0.14, pitchDeltaDeg: 5 },
  WS: { zoom: 0.92, tiltShiftBlur: 0.22, pitchDeltaDeg: 2 },
  MS: { zoom: 1.08, tiltShiftBlur: 0.34, pitchDeltaDeg: 0 },
  CU: { zoom: 1.35, tiltShiftBlur: 0.52, pitchDeltaDeg: -4 },
  ECU: { zoom: 1.62, tiltShiftBlur: 0.68, pitchDeltaDeg: -7 },
};

const VALID_SHOT_SIZES: ReadonlySet<string> = new Set(['EWS', 'WS', 'MS', 'CU', 'ECU']);
const VALID_ANCHORS: ReadonlySet<string> = new Set([
  'center',
  'left_third',
  'right_third',
  'upper_third',
  'lower_third',
  'lead_room',
  'two_shot',
]);
const VALID_MOTIONS: ReadonlySet<string> = new Set([
  'cut',
  'spring',
  'push_in',
  'pull_out',
  'pan_smooth',
  'impact_zoom',
]);

/** Validates an Actor-Relative cutscene definition against schema bounds. */
export function validateCutsceneDef(def: unknown, keyHint = 'cutscene'): string[] {
  const errors: string[] = [];
  if (!def || typeof def !== 'object') {
    return [`${keyHint} must be an object`];
  }
  const c = def as Partial<EcsCutsceneDef>;
  if (!c.id || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{2,64}$/.test(c.id)) {
    errors.push(`${keyHint}.id must match /^[a-zA-Z0-9_-]{2,64}$/`);
  }
  if (!c.name || typeof c.name !== 'string') {
    errors.push(`${keyHint}.name must be a non-empty string`);
  }
  if (!Array.isArray(c.shots) || c.shots.length === 0) {
    errors.push(`${keyHint}.shots must be a non-empty array`);
    return errors;
  }
  for (let i = 0; i < c.shots.length; i++) {
    const s = c.shots[i];
    const sLabel = `${keyHint}.shots[${i}]`;
    if (!s || typeof s !== 'object') {
      errors.push(`${sLabel} must be an object`);
      continue;
    }
    if (!s.id || typeof s.id !== 'string') {
      errors.push(`${sLabel}.id is required`);
    }
    if (!Number.isFinite(s.durationSec) || s.durationSec < 0.1 || s.durationSec > 60) {
      errors.push(`${sLabel}.durationSec must be in 0.1..60`);
    }
    if (s.shotSize !== undefined && !VALID_SHOT_SIZES.has(s.shotSize)) {
      errors.push(`${sLabel}.shotSize '${String(s.shotSize)}' is invalid`);
    }
    if (s.anchor !== undefined && !VALID_ANCHORS.has(s.anchor)) {
      errors.push(`${sLabel}.anchor '${String(s.anchor)}' is invalid`);
    }
    if (s.motion !== undefined && !VALID_MOTIONS.has(s.motion)) {
      errors.push(`${sLabel}.motion '${String(s.motion)}' is invalid`);
    }
    if (
      s.portraitSpriteId !== undefined &&
      (typeof s.portraitSpriteId !== 'string' || !/^[a-zA-Z0-9_-]{2,64}$/.test(s.portraitSpriteId))
    ) {
      errors.push(`${sLabel}.portraitSpriteId must match /^[a-zA-Z0-9_-]{2,64}$/`);
    }
    if (s.portraitSide !== undefined && s.portraitSide !== 'left' && s.portraitSide !== 'right') {
      errors.push(`${sLabel}.portraitSide '${String(s.portraitSide)}' must be 'left' or 'right'`);
    }
  }
  return errors;
}
