import type { MapSliceCutawayMode } from './EcsMapDesignerPanelTypes.ts';

const STORAGE_KEY = 'pixer_ecs_workbench_prefs_v1';

export const LEFT_PANE_MIN_W = 196;
export const LEFT_PANE_MAX_W = 380;
export const LEFT_PANE_DEFAULT_W = 244;

export const RIGHT_PANE_MIN_W = 220;
export const RIGHT_PANE_MAX_W = 420;
export const RIGHT_PANE_DEFAULT_W = 288;

export const WORKBENCH_SNAP_STEPS = [0, 8, 16, 32] as const;
export type WorkbenchSnapStep = (typeof WORKBENCH_SNAP_STEPS)[number];

export interface WorkbenchPreferences {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  snapStep: WorkbenchSnapStep;
  sliceCutawayMode: MapSliceCutawayMode;
}

export const DEFAULT_WORKBENCH_PREFERENCES: Readonly<WorkbenchPreferences> = {
  leftWidth: LEFT_PANE_DEFAULT_W,
  rightWidth: RIGHT_PANE_DEFAULT_W,
  leftCollapsed: false,
  rightCollapsed: false,
  snapStep: 16,
  sliceCutawayMode: 'all',
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeSnapStep(value: unknown, fallback: WorkbenchSnapStep): WorkbenchSnapStep {
  if (value === 0 || value === 8 || value === 16 || value === 32) return value;
  return fallback;
}

function normalizeCutawayMode(value: unknown, fallback: MapSliceCutawayMode): MapSliceCutawayMode {
  if (value === 'all' || value === 'ghost_above' || value === 'solo_floor') return value;
  return fallback;
}

export function normalizeWorkbenchPreferences(
  raw: Partial<Record<keyof WorkbenchPreferences, unknown>> | null | undefined,
  base: Readonly<WorkbenchPreferences> = DEFAULT_WORKBENCH_PREFERENCES,
): WorkbenchPreferences {
  const src = raw ?? {};
  return {
    leftWidth: clampInt(src.leftWidth, LEFT_PANE_MIN_W, LEFT_PANE_MAX_W, base.leftWidth),
    rightWidth: clampInt(src.rightWidth, RIGHT_PANE_MIN_W, RIGHT_PANE_MAX_W, base.rightWidth),
    leftCollapsed: typeof src.leftCollapsed === 'boolean' ? src.leftCollapsed : base.leftCollapsed,
    rightCollapsed: typeof src.rightCollapsed === 'boolean' ? src.rightCollapsed : base.rightCollapsed,
    snapStep: normalizeSnapStep(src.snapStep, base.snapStep),
    sliceCutawayMode: normalizeCutawayMode(src.sliceCutawayMode, base.sliceCutawayMode),
  };
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return null;
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadWorkbenchPreferences(): WorkbenchPreferences {
  const storage = getSafeLocalStorage();
  if (!storage) return { ...DEFAULT_WORKBENCH_PREFERENCES };
  try {
    const rawText = storage.getItem(STORAGE_KEY);
    if (!rawText) return { ...DEFAULT_WORKBENCH_PREFERENCES };
    const parsed = JSON.parse(rawText) as Partial<Record<keyof WorkbenchPreferences, unknown>>;
    return normalizeWorkbenchPreferences(parsed);
  } catch {
    return { ...DEFAULT_WORKBENCH_PREFERENCES };
  }
}

export function saveWorkbenchPreferences(patch: Partial<WorkbenchPreferences>): WorkbenchPreferences {
  const current = loadWorkbenchPreferences();
  const merged = normalizeWorkbenchPreferences(patch, current);
  const storage = getSafeLocalStorage();
  if (!storage) return merged;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Ignore quota / private-mode / headless storage restrictions
  }
  return merged;
}

export function clampWorkbenchPaneWidth(side: 'left' | 'right', rawWidth: number): number {
  const min = side === 'left' ? LEFT_PANE_MIN_W : RIGHT_PANE_MIN_W;
  const max = side === 'left' ? LEFT_PANE_MAX_W : RIGHT_PANE_MAX_W;
  return Math.max(min, Math.min(max, Math.round(rawWidth)));
}

export function applyWorkbenchPaneLayout(
  rootEl: HTMLElement,
  toggleLeftBtn: HTMLButtonElement,
  toggleRightBtn: HTMLButtonElement,
  prefs: Readonly<WorkbenchPreferences>,
): void {
  rootEl.style.setProperty('--p7-left-w', `${prefs.leftWidth}px`);
  rootEl.style.setProperty('--p7-right-w', `${prefs.rightWidth}px`);
  rootEl.classList.toggle('is-left-collapsed', prefs.leftCollapsed);
  rootEl.classList.toggle('is-right-collapsed', prefs.rightCollapsed);
  toggleLeftBtn.textContent = prefs.leftCollapsed ? '▶' : '◀';
  toggleRightBtn.textContent = prefs.rightCollapsed ? '◀' : '▶';
  toggleLeftBtn.classList.toggle('p7-btn-accent', prefs.leftCollapsed);
  toggleRightBtn.classList.toggle('p7-btn-accent', prefs.rightCollapsed);
}
