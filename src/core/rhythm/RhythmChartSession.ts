import {
  buildRhythmChart,
  inspectChartHealth,
  validateRhythmProject,
  type RhythmCameraCue,
  type RhythmCameraStyle,
  type RhythmChartHealthReport,
  type RhythmDifficulty,
  type RhythmLane,
  type RhythmNote,
  type RhythmSongProject,
} from './RhythmTypes.ts';

function cloneProject(proj: RhythmSongProject): RhythmSongProject {
  return JSON.parse(JSON.stringify(proj)) as RhythmSongProject;
}

const MAX_UNDO_HISTORY = 64;

/**
 * Pure DOM-free Transactional Chart Studio Session with full Undo/Redo,
 * beat-grid snapping, tap/hold authoring, mirror/shift transforms, camera cue editing,
 * health diagnostics, and JSON export/import.
 */
export class RhythmChartSession {
  private project: RhythmSongProject;
  private activeDifficulty: RhythmDifficulty = 'NORMAL';
  private snapDivisor = 4; // 1, 2, 4, 8, 12, 16 (subdivisions per whole measure / 4 beats -> per beat = snapDivisor / 4? Let's treat snapDivisor as divisions per beat: 1=1/4, 2=1/8, 4=1/16)
  private undoStack: RhythmSongProject[] = [];
  private redoStack: RhythmSongProject[] = [];
  private revision = 0;

  constructor(initialProject: RhythmSongProject) {
    this.project = cloneProject(initialProject);
  }

  public getProject(): RhythmSongProject {
    return this.project;
  }

  public getRevision(): number {
    return this.revision;
  }

  public getActiveDifficulty(): RhythmDifficulty {
    return this.activeDifficulty;
  }

  public setActiveDifficulty(diff: RhythmDifficulty): void {
    this.activeDifficulty = diff;
  }

  /** Subdivisions per beat (1=1/4, 2=1/8, 3=1/12, 4=1/16) */
  public getSnapPerBeat(): number {
    return this.snapDivisor;
  }

  public setSnapPerBeat(div: number): void {
    this.snapDivisor = Math.max(1, Math.min(8, Math.round(div)));
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public loadProject(next: RhythmSongProject, resetHistory = true): void {
    this.project = cloneProject(next);
    if (resetHistory) {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.revision++;
  }

  public snapTimeMs(rawTimeMs: number): number {
    const beatMs = 60000 / Math.max(40, this.project.bpm);
    const stepMs = beatMs / this.snapDivisor;
    const idx = Math.round((rawTimeMs - this.project.offsetMs) / stepMs);
    return Math.max(0, Math.min(this.project.durationMs - 100, Math.round(this.project.offsetMs + idx * stepMs)));
  }

  public getActiveNotes(): readonly RhythmNote[] {
    return this.project.charts[this.activeDifficulty].notes;
  }

  public getHealthReport(diff: RhythmDifficulty = this.activeDifficulty): RhythmChartHealthReport {
    return inspectChartHealth(this.project.charts[diff].notes, this.project.durationMs);
  }

  public toggleTapNote(lane: RhythmLane, rawTimeMs: number): { action: 'added' | 'removed'; noteId?: string } {
    const timeMs = this.snapTimeMs(rawTimeMs);
    const curNotes = this.project.charts[this.activeDifficulty].notes;
    const hitTolerance = Math.max(28, (60000 / this.project.bpm / this.snapDivisor) * 0.42);
    const existingIdx = curNotes.findIndex(
      (n) => n.lane === lane && Math.abs(n.timeMs - timeMs) <= hitTolerance,
    );

    this.pushUndo();
    if (existingIdx !== -1) {
      const removed = curNotes[existingIdx];
      const nextNotes = curNotes.filter((_, i) => i !== existingIdx);
      this.commitActiveNotes(nextNotes);
      return { action: 'removed', noteId: removed.id };
    }

    const id = `ed_${Date.now().toString(36)}_${Math.floor(Math.random() * 9999)}`;
    const nextNotes = [...curNotes, { id, lane, timeMs, durationMs: 0 }];
    this.commitActiveNotes(nextNotes);
    return { action: 'added', noteId: id };
  }

  public addOrUpdateHoldNote(lane: RhythmLane, rawStartMs: number, rawEndMs: number): string {
    const startMs = this.snapTimeMs(Math.min(rawStartMs, rawEndMs));
    const endMs = this.snapTimeMs(Math.max(rawStartMs, rawEndMs));
    const minHoldMs = Math.round(60000 / this.project.bpm / Math.max(2, this.snapDivisor));
    const durationMs = endMs - startMs >= minHoldMs ? endMs - startMs : 0;

    this.pushUndo();
    const curNotes = this.project.charts[this.activeDifficulty].notes.filter(
      (n) => !(n.lane === lane && n.timeMs >= startMs - 25 && n.timeMs <= startMs + Math.max(25, durationMs)),
    );
    const id = `ed_${Date.now().toString(36)}_${Math.floor(Math.random() * 9999)}`;
    curNotes.push({ id, lane, timeMs: startMs, durationMs });
    this.commitActiveNotes(curNotes);
    return id;
  }

  public removeNoteById(noteId: string): boolean {
    const curNotes = this.project.charts[this.activeDifficulty].notes;
    if (!curNotes.some((n) => n.id === noteId)) return false;
    this.pushUndo();
    this.commitActiveNotes(curNotes.filter((n) => n.id !== noteId));
    return true;
  }

  public mirrorActiveChart(): void {
    const curNotes = this.project.charts[this.activeDifficulty].notes;
    this.pushUndo();
    const mirrored = curNotes.map((n) => ({
      ...n,
      lane: (3 - n.lane) as RhythmLane,
    }));
    this.commitActiveNotes(mirrored);
  }

  public shiftActiveChart(deltaMs: number): void {
    const curNotes = this.project.charts[this.activeDifficulty].notes;
    this.pushUndo();
    const shifted = curNotes
      .map((n) => ({
        ...n,
        timeMs: Math.max(0, Math.min(this.project.durationMs - 100, Math.round(n.timeMs + deltaMs))),
      }))
      .filter((n) => n.timeMs >= 0);
    this.commitActiveNotes(shifted);
  }

  public clearActiveChart(): void {
    this.pushUndo();
    this.commitActiveNotes([]);
  }

  public updateMetadata(patch: {
    title?: string;
    artist?: string;
    bpm?: number;
    offsetMs?: number;
    level?: number;
  }): void {
    this.pushUndo();
    if (typeof patch.title === 'string' && patch.title.trim()) {
      this.project.title = patch.title.trim();
    }
    if (typeof patch.artist === 'string' && patch.artist.trim()) {
      this.project.artist = patch.artist.trim();
    }
    if (typeof patch.bpm === 'number' && Number.isFinite(patch.bpm)) {
      this.project.bpm = Math.max(40, Math.min(300, Math.round(patch.bpm * 10) / 10));
    }
    if (typeof patch.offsetMs === 'number' && Number.isFinite(patch.offsetMs)) {
      this.project.offsetMs = Math.max(-5000, Math.min(10000, Math.round(patch.offsetMs)));
    }
    if (typeof patch.level === 'number' && Number.isFinite(patch.level)) {
      this.project.charts[this.activeDifficulty].level = Math.max(1, Math.min(16, Math.round(patch.level)));
    }
    this.revision++;
  }

  public addCameraCue(rawTimeMs: number, style: RhythmCameraStyle, intensity = 0.9, label?: string): RhythmCameraCue {
    const timeMs = this.snapTimeMs(rawTimeMs);
    this.pushUndo();
    // Replace existing cue within 250ms
    this.project.cameraCues = this.project.cameraCues.filter((c) => Math.abs(c.timeMs - timeMs) > 250);
    const cue: RhythmCameraCue = {
      id: `cam_${Date.now().toString(36)}_${Math.floor(Math.random() * 999)}`,
      timeMs,
      style,
      intensity: Math.max(0.2, Math.min(1.5, Number(intensity.toFixed(2)))),
      label: label || style,
    };
    this.project.cameraCues.push(cue);
    this.project.cameraCues.sort((a, b) => a.timeMs - b.timeMs);
    this.revision++;
    return cue;
  }

  public removeCameraCue(cueId: string): boolean {
    if (this.project.cameraCues.length <= 1) return false;
    const prevLen = this.project.cameraCues.length;
    this.pushUndo();
    this.project.cameraCues = this.project.cameraCues.filter((c) => c.id !== cueId);
    if (this.project.cameraCues.length === prevLen) {
      this.undoStack.pop();
      return false;
    }
    this.revision++;
    return true;
  }

  public replaceChartsAndCues(
    charts: RhythmSongProject['charts'],
    cameraCues: RhythmCameraCue[],
    bpm: number,
    offsetMs: number,
  ): void {
    this.pushUndo();
    this.project.charts = JSON.parse(JSON.stringify(charts)) as RhythmSongProject['charts'];
    this.project.cameraCues = JSON.parse(JSON.stringify(cameraCues)) as RhythmCameraCue[];
    this.project.bpm = bpm;
    this.project.offsetMs = offsetMs;
    this.revision++;
  }

  public undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneProject(this.project));
    this.project = prev;
    this.revision++;
    return true;
  }

  public redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneProject(this.project));
    this.project = next;
    this.revision++;
    return true;
  }

  public exportJson(): string {
    return JSON.stringify(this.project, null, 2);
  }

  public importJson(rawJson: string): { ok: true; project: RhythmSongProject } | { ok: false; error: string } {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      const checked = validateRhythmProject(parsed);
      if (!checked.ok) return checked;
      this.pushUndo();
      this.project = cloneProject(checked.project);
      this.revision++;
      return { ok: true, project: this.project };
    } catch {
      return { ok: false, error: '無法解析 JSON 格式，請確認檔案完整' };
    }
  }

  private pushUndo(): void {
    this.undoStack.push(cloneProject(this.project));
    if (this.undoStack.length > MAX_UNDO_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private commitActiveNotes(nextNotes: RhythmNote[]): void {
    const cur = this.project.charts[this.activeDifficulty];
    const health = inspectChartHealth(nextNotes, this.project.durationMs);
    this.project.charts[this.activeDifficulty] = buildRhythmChart(
      this.activeDifficulty,
      cur.level || health.suggestedLevel,
      nextNotes,
      this.project.durationMs,
    );
    this.revision++;
  }
}
