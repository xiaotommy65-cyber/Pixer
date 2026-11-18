import type { RenderPerformanceProfile } from '../core/gpu/GpuTypes.ts';
import type { DpadDeadzoneMode, StickCurveMode } from '../core/input/InputPipeline.ts';
import type { HapticLevel, HapticSide } from '../core/hal/HapticEngine.ts';
import type { ErgonomicGripMode } from '../core/hal/SystemHal.ts';

export type ShellTheme = 'mint' | 'berry' | 'honey' | 'sky';

export const SHELL_THEMES: readonly { id: ShellTheme; label: string; left: string; right: string }[] = [
  { id: 'mint', label: '薄荷 × 草莓', left: '#7fdcb4', right: '#ff8fa8' },
  { id: 'berry', label: '草莓牛奶', left: '#ffb3c6', right: '#ffb3c6' },
  { id: 'honey', label: '蜂蜜 × 汽水', left: '#ffdd6e', right: '#7fcdf5' },
  { id: 'sky', label: '藍莓 × 葡萄', left: '#8fc8ff', right: '#c9a8ff' },
];

export const HAPTIC_LABELS: Record<HapticLevel, string> = {
  full: '📳 震動：強',
  gentle: '〰 震動：輕',
  off: '⏸ 震動：關',
};

export interface SystemSettingsDrawerState {
  gripMode: ErgonomicGripMode;
  shellTheme: ShellTheme;
  hapticLevel: HapticLevel;
  muted: boolean;
  autofire: boolean;
  deadzoneMode: DpadDeadzoneMode;
  stickCurveMode: StickCurveMode;
  stickDynamicOrigin: boolean;
  handheldLandscape: boolean;
  perfProfile: RenderPerformanceProfile;
  hasCartridge: boolean;
  hasSram: boolean;
  benchmarkOn: boolean;
  debugHitboxesOn: boolean;
  gamepadConnected: boolean;
  gamepadLabel: string | null;
}

export interface SystemSettingsDrawerCallbacks {
  getState: () => SystemSettingsDrawerState;
  onSelectGrip: (mode: ErgonomicGripMode) => void;
  onSelectShell: (theme: ShellTheme) => void;
  onToggleLandscape: () => void;
  onCycleHaptic: () => void;
  onToggleMute: () => void;
  onToggleAutofire: () => void;
  onSelectDeadzone: (mode: DpadDeadzoneMode) => void;
  onSelectStickCurve: (mode: StickCurveMode) => void;
  onToggleStickOrigin: (enabled: boolean) => void;
  onSelectPerfProfile: (profile: RenderPerformanceProfile) => void;
  onTestStereoHaptic: (side: HapticSide) => void;
  onCapture: () => void;
  onRetryStage: () => void;
  onClearSave: () => void;
  onEject: () => void;
  onToggleBenchmark: () => void;
  onToggleDebugHitboxes: () => void;
  onPwaInstallClick: () => void;
  onOpenHaptic: () => void;
  onOpenChange?: (open: boolean) => void;
}
