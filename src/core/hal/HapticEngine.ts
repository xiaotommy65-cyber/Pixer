export type HapticLevel = 'off' | 'gentle' | 'full';
export type HapticProfile = 'tap' | 'click' | 'thump' | 'impact' | 'celebrate' | 'rumble';
export type HapticSide = 'left' | 'right' | 'both';

export interface NativeHalAdapter {
  readonly id: string;
  isNativeApp?: () => boolean;
  getPlatform?: () => 'web' | 'ios' | 'android';
  hapticTrigger?: (profile: HapticProfile, intensity: number, durationMs: number) => boolean | void;
  vibratePattern?: (pattern: number | number[]) => boolean | void;
  requestFullscreenLock?: (landscape: boolean) => Promise<boolean> | boolean;
  setKeepAwake?: (enabled: boolean) => Promise<boolean> | boolean;
  shareImageDataUrl?: (dataUrl: string, filename: string, title?: string) => Promise<boolean>;
  getSafeAreaInsets?: () => { top: number; right: number; bottom: number; left: number };
}

export interface HapticTriggerOptions {
  side?: HapticSide;
  /** 0..1 intensity multiplier (used mainly for rumble or scaling) */
  intensity?: number;
  /** Duration in ms (used for custom rumble) */
  durationMs?: number;
  /** Skip acoustic fallback if caller already played button tactile audio */
  skipAcoustic?: boolean;
  /** Skip visual chassis recoil if triggered from an external controller or suppressed */
  skipVisual?: boolean;
}

export interface HapticCallbacks {
  onVisualRecoil?: (side: HapticSide, profile: HapticProfile, strength: number) => void;
  onAcousticFallback?: (profile: HapticProfile, level: HapticLevel, side: HapticSide) => void;
  getGamepadActuator?: () => GamepadHapticActuator | null;
}

/**
 * Splits DualRumble eccentric (low-frequency left/heavy) and high-frequency (right/crisp)
 * motor magnitudes by logical controller side for bilateral stereo gamepad feedback.
 */
export function computeStereoRumbleMagnitudes(
  baseStrong: number,
  baseWeak: number,
  intensity: number,
  side: HapticSide = 'both',
): { strongMagnitude: number; weakMagnitude: number } {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  if (side === 'left') {
    const energy = Math.max(baseStrong, (baseStrong + baseWeak) * 0.64);
    return {
      strongMagnitude: clamp01(energy * intensity),
      weakMagnitude: clamp01(baseWeak * 0.22 * intensity),
    };
  }
  if (side === 'right') {
    const energy = Math.max(baseWeak, (baseStrong + baseWeak) * 0.64);
    return {
      strongMagnitude: clamp01(baseStrong * 0.22 * intensity),
      weakMagnitude: clamp01(energy * intensity),
    };
  }
  return {
    strongMagnitude: clamp01(baseStrong * intensity),
    weakMagnitude: clamp01(baseWeak * intensity),
  };
}

interface HapticSpec {
  cooldownMs: number;
  pattern: number[];
  gamepadStrong: number;
  gamepadWeak: number;
  gamepadMs: number;
  recoilStrength: number;
  priority: 'low' | 'normal' | 'high';
}

const HAPTIC_SPECS: Record<HapticProfile, HapticSpec> = {
  tap: {
    cooldownMs: 28,
    pattern: [8],
    gamepadStrong: 0.08,
    gamepadWeak: 0.28,
    gamepadMs: 22,
    recoilStrength: 0.45,
    priority: 'low',
  },
  click: {
    cooldownMs: 24,
    pattern: [10, 12, 6],
    gamepadStrong: 0.16,
    gamepadWeak: 0.45,
    gamepadMs: 30,
    recoilStrength: 0.7,
    priority: 'normal',
  },
  thump: {
    cooldownMs: 45,
    pattern: [18],
    gamepadStrong: 0.36,
    gamepadWeak: 0.25,
    gamepadMs: 48,
    recoilStrength: 0.85,
    priority: 'normal',
  },
  impact: {
    cooldownMs: 75,
    pattern: [24, 16, 32],
    gamepadStrong: 0.86,
    gamepadWeak: 0.48,
    gamepadMs: 95,
    recoilStrength: 1.0,
    priority: 'high',
  },
  celebrate: {
    cooldownMs: 220,
    pattern: [14, 28, 18, 28, 34],
    gamepadStrong: 0.56,
    gamepadWeak: 0.78,
    gamepadMs: 165,
    recoilStrength: 1.0,
    priority: 'high',
  },
  rumble: {
    cooldownMs: 50,
    pattern: [24],
    gamepadStrong: 0.45,
    gamepadWeak: 0.45,
    gamepadMs: 55,
    recoilStrength: 0.65,
    priority: 'low',
  },
};

const DUTY_WINDOW_MS = 1000;
const MAX_DUTY_MOTOR_MS = 220;

interface MotorBurstRecord {
  at: number;
  driveMs: number;
}

export interface HapticDispatchResult {
  dispatched: boolean;
  reason: 'ok' | 'off' | 'cooldown' | 'thermal_budget';
  channel: 'native' | 'gamepad' | 'web_vibrate' | 'compensation_only' | 'none';
}

/**
 * Multi-tier contextual haptic engine with per-profile cooldowns, sliding-window duty-cycle
 * thermal protection, bilateral Web Gamepad DualRumble output, Android multi-segment vibrate(),
 * native adapter hook, and synchronized visual/acoustic compensation for iOS & desktop.
 */
export class HapticEngine {
  private level: HapticLevel = 'full';
  private callbacks: HapticCallbacks = {};
  private nativeAdapter: NativeHalAdapter | null = null;
  private readonly clock: () => number;

  private lastProfileAt = new Map<HapticProfile, number>();
  private burstHistory: MotorBurstRecord[] = [];

  constructor(clock?: () => number) {
    this.clock = clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  public setLevel(level: HapticLevel): void {
    this.level = level;
  }

  public getLevel(): HapticLevel {
    return this.level;
  }

  public cycleLevel(): HapticLevel {
    const next: HapticLevel = this.level === 'full' ? 'gentle' : this.level === 'gentle' ? 'off' : 'full';
    this.level = next;
    return next;
  }

  public setCallbacks(cb: HapticCallbacks): void {
    this.callbacks = { ...this.callbacks, ...cb };
  }

  public setNativeAdapter(adapter: NativeHalAdapter | null): void {
    this.nativeAdapter = adapter;
  }

  public getNativeAdapter(): NativeHalAdapter | null {
    return this.nativeAdapter;
  }

  public trigger(profile: HapticProfile, opts: HapticTriggerOptions = {}): HapticDispatchResult {
    if (this.level === 'off') {
      return { dispatched: false, reason: 'off', channel: 'none' };
    }

    const now = this.clock();
    const spec = HAPTIC_SPECS[profile];
    const prevAt = this.lastProfileAt.get(profile) ?? -Infinity;
    if (now - prevAt < spec.cooldownMs) {
      return { dispatched: false, reason: 'cooldown', channel: 'none' };
    }

    // Prune sliding duty-cycle window
    const cutoff = now - DUTY_WINDOW_MS;
    while (this.burstHistory.length > 0 && this.burstHistory[0].at < cutoff) {
      this.burstHistory.shift();
    }
    const usedBudgetMs = this.burstHistory.reduce((acc, rec) => acc + rec.driveMs, 0);

    const levelScale = this.level === 'gentle' ? 0.62 : 1.0;
    const reqIntensity = Math.max(0.05, Math.min(1, (opts.intensity ?? 1) * levelScale));
    const side: HapticSide = opts.side ?? 'both';
    const customDuration =
      profile === 'rumble' && opts.durationMs !== undefined
        ? Math.max(10, Math.min(240, Math.round(opts.durationMs)))
        : undefined;

    const basePattern = customDuration !== undefined ? [customDuration] : spec.pattern;
    const scaledPattern = basePattern.map((ms, idx) =>
      idx % 2 === 0 ? Math.max(4, Math.round(ms * levelScale)) : ms,
    );
    const driveMs = scaledPattern.reduce((sum, ms, idx) => (idx % 2 === 0 ? sum + ms : sum), 0);

    const overBudget = usedBudgetMs + driveMs > MAX_DUTY_MOTOR_MS;
    if (overBudget && spec.priority !== 'high') {
      return { dispatched: false, reason: 'thermal_budget', channel: 'none' };
    }

    this.lastProfileAt.set(profile, now);

    // Visual recoil compensation (CSS prefers-reduced-motion handled in stylesheet)
    if (!opts.skipVisual) {
      this.callbacks.onVisualRecoil?.(side, profile, spec.recoilStrength * levelScale);
    }

    let channel: HapticDispatchResult['channel'] = 'compensation_only';

    // 1. Priority: Native HAL adapter (Android TWA JSBridge / Capacitor plugin)
    if (this.nativeAdapter?.hapticTrigger) {
      const handled = this.nativeAdapter.hapticTrigger(
        profile,
        reqIntensity,
        customDuration ?? spec.gamepadMs,
      );
      if (handled !== false) {
        channel = 'native';
      }
    } else if (this.nativeAdapter?.vibratePattern) {
      const handled = this.nativeAdapter.vibratePattern(scaledPattern);
      if (handled !== false) {
        channel = 'native';
      }
    }

    // 2. Active Web Gamepad DualRumble Actuator with bilateral L/R stereo motor weighting
    const actuator = this.callbacks.getGamepadActuator?.() ?? null;
    if (actuator && typeof actuator.playEffect === 'function') {
      const gpDur = customDuration ?? Math.max(18, Math.round(spec.gamepadMs * levelScale));
      const { strongMagnitude, weakMagnitude } = computeStereoRumbleMagnitudes(
        spec.gamepadStrong,
        spec.gamepadWeak,
        reqIntensity,
        side,
      );
      try {
        void actuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: gpDur,
          strongMagnitude,
          weakMagnitude,
        });
        if (channel === 'compensation_only') channel = 'gamepad';
      } catch {
        // Ignore unsupported dual-rumble rejections
      }
    }

    // 3. Browser navigator.vibrate (Android Chrome / WebView)
    const canWebVibrate =
      typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    if (channel === 'compensation_only' && canWebVibrate && !overBudget) {
      try {
        const vibPattern = scaledPattern.length === 1 ? scaledPattern[0] : scaledPattern;
        const ok = navigator.vibrate(vibPattern);
        if (ok) {
          channel = 'web_vibrate';
        }
      } catch {
        // Ignore blocked vibrate calls (e.g. before user gesture)
      }
    }

    if (channel === 'native' || channel === 'gamepad' || channel === 'web_vibrate') {
      this.burstHistory.push({ at: now, driveMs });
    }

    // 4. Stereo acoustic compensation (essential on iOS Safari & desktop keyboard/mouse without physical motors)
    if (!opts.skipAcoustic) {
      this.callbacks.onAcousticFallback?.(profile, this.level, side);
    }

    return { dispatched: true, reason: 'ok', channel };
  }

  public tap(side: HapticSide = 'both', opts?: HapticTriggerOptions): HapticDispatchResult {
    return this.trigger('tap', { ...opts, side });
  }

  public click(side: HapticSide = 'both', opts?: HapticTriggerOptions): HapticDispatchResult {
    return this.trigger('click', { ...opts, side });
  }

  public thump(side: HapticSide = 'both', opts?: HapticTriggerOptions): HapticDispatchResult {
    return this.trigger('thump', { ...opts, side });
  }

  public impact(side: HapticSide = 'both', opts?: HapticTriggerOptions): HapticDispatchResult {
    return this.trigger('impact', { ...opts, side });
  }

  public celebrate(opts?: HapticTriggerOptions): HapticDispatchResult {
    return this.trigger('celebrate', { ...opts, side: 'both' });
  }

  public rumble(intensity = 0.6, durationMs = 55, side: HapticSide = 'both'): HapticDispatchResult {
    return this.trigger('rumble', { side, intensity, durationMs });
  }

  /** Test & diagnostics helper: returns current duty usage within the 1s sliding window. */
  public getDutyUsageMs(): number {
    const cutoff = this.clock() - DUTY_WINDOW_MS;
    while (this.burstHistory.length > 0 && this.burstHistory[0].at < cutoff) {
      this.burstHistory.shift();
    }
    return this.burstHistory.reduce((acc, rec) => acc + rec.driveMs, 0);
  }
}
