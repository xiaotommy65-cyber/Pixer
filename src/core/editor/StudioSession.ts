import { validateCartridgeJson, type CartridgeJsonV1 } from '../sim/CartridgeSchema.ts';
import {
  applyStudioCommandToDoc,
  cloneCartridgeDoc,
  createStudioTemplate,
  type StudioCommand,
  type StudioCommandResult,
  type StudioHistoryEntry,
  type StudioTemplateId,
} from './StudioCommands.ts';
import {
  inspectSceneComposition,
  runHeadlessPlaytest,
  type PlaytestOptions,
  type PlaytestReport,
  type SceneVisualReport,
} from './StudioPlaytestDiag.ts';

interface HistorySnapshot {
  doc: CartridgeJsonV1;
  entry: StudioHistoryEntry;
}

export type StudioSessionListener = (doc: CartridgeJsonV1, revision: number) => void;

const MAX_UNDO_HISTORY = 64;

/**
 * Pure, DOM-free transactional Studio Editor Session (Single Source of Truth).
 * Shared symmetrically by the Human Visual Workbench UI and the AI Structured Command API.
 * Every command is validated against CartridgeSchema before committing; invalid mutations
 * roll back atomically without corrupting the document or Undo stack.
 */
export class StudioSession {
  private doc: CartridgeJsonV1;
  private revision = 1;
  private readonly undoStack: HistorySnapshot[] = [];
  private readonly redoStack: HistorySnapshot[] = [];
  private readonly historyLog: StudioHistoryEntry[] = [];
  private readonly listeners = new Set<StudioSessionListener>();

  constructor(initial?: CartridgeJsonV1 | StudioTemplateId) {
    if (typeof initial === 'string' || initial === undefined) {
      this.doc = createStudioTemplate(initial ?? 'parkour_flagship');
    } else {
      const valid = validateCartridgeJson(initial);
      this.doc = valid.ok ? cloneCartridgeDoc(valid.data) : createStudioTemplate('parkour_flagship');
    }
    this.historyLog.push({
      revision: this.revision,
      commandType: 'new_project',
      summary: `初始化工作階段「${this.doc.meta.title}」`,
      timestamp: Date.now(),
    });
  }

  public getDocument(): CartridgeJsonV1 {
    return cloneCartridgeDoc(this.doc);
  }

  public getRevision(): number {
    return this.revision;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getHistory(): StudioHistoryEntry[] {
    return this.historyLog.map((h) => ({ ...h }));
  }

  public onChange(listener: StudioSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public loadDocument(raw: unknown): StudioCommandResult {
    const valid = validateCartridgeJson(raw);
    if (!valid.ok) {
      return {
        ok: false,
        revision: this.revision,
        summary: '載入卡匣失敗',
        errors: valid.errors,
      };
    }
    const prevDoc = cloneCartridgeDoc(this.doc);
    const nextDoc = cloneCartridgeDoc(valid.data);
    this.commitChange(prevDoc, nextDoc, 'new_project', `載入卡匣「${nextDoc.meta.title}」`);
    return {
      ok: true,
      revision: this.revision,
      summary: `已載入「${nextDoc.meta.title}」`,
      errors: [],
    };
  }

  public dispatch(cmd: StudioCommand): StudioCommandResult {
    const prevDoc = cloneCartridgeDoc(this.doc);
    const { nextDoc, summary } = applyStudioCommandToDoc(this.doc, cmd);
    const valid = validateCartridgeJson(nextDoc);
    if (!valid.ok) {
      return {
        ok: false,
        revision: this.revision,
        summary: `驗證失敗，已原子回滾：${summary}`,
        errors: valid.errors,
      };
    }
    this.commitChange(prevDoc, valid.data, cmd.type, summary);
    return {
      ok: true,
      revision: this.revision,
      summary,
      errors: [],
    };
  }

  public batch(commands: readonly StudioCommand[], label?: string): StudioCommandResult {
    return this.dispatch({ type: 'batch', label, commands });
  }

  public undo(): StudioCommandResult {
    const popped = this.undoStack.pop();
    if (!popped) {
      return {
        ok: false,
        revision: this.revision,
        summary: '沒有可復原的紀錄',
        errors: ['Undo stack is empty'],
      };
    }
    const currentSnapshot: HistorySnapshot = {
      doc: cloneCartridgeDoc(this.doc),
      entry: this.historyLog[this.historyLog.length - 1] ?? {
        revision: this.revision,
        commandType: 'batch',
        summary: '復原點',
        timestamp: Date.now(),
      },
    };
    this.redoStack.push(currentSnapshot);
    this.doc = popped.doc;
    this.revision++;
    const summary = `復原：${popped.entry.summary}`;
    this.historyLog.push({
      revision: this.revision,
      commandType: popped.entry.commandType,
      summary,
      timestamp: Date.now(),
    });
    this.notify();
    return { ok: true, revision: this.revision, summary, errors: [] };
  }

  public redo(): StudioCommandResult {
    const popped = this.redoStack.pop();
    if (!popped) {
      return {
        ok: false,
        revision: this.revision,
        summary: '沒有可重做的紀錄',
        errors: ['Redo stack is empty'],
      };
    }
    this.undoStack.push({
      doc: cloneCartridgeDoc(this.doc),
      entry: popped.entry,
    });
    this.doc = popped.doc;
    this.revision++;
    const summary = `重做：${popped.entry.summary}`;
    this.historyLog.push({
      revision: this.revision,
      commandType: popped.entry.commandType,
      summary,
      timestamp: Date.now(),
    });
    this.notify();
    return { ok: true, revision: this.revision, summary, errors: [] };
  }

  public playtest(opts?: PlaytestOptions): PlaytestReport {
    return runHeadlessPlaytest(this.doc, opts);
  }

  public inspectVisual(frames = 24): SceneVisualReport {
    return inspectSceneComposition(this.doc, frames);
  }

  private commitChange(
    prevDoc: CartridgeJsonV1,
    nextDoc: CartridgeJsonV1,
    commandType: StudioCommand['type'],
    summary: string,
  ): void {
    const entry: StudioHistoryEntry = {
      revision: this.revision + 1,
      commandType,
      summary,
      timestamp: Date.now(),
    };
    this.undoStack.push({ doc: prevDoc, entry });
    if (this.undoStack.length > MAX_UNDO_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.doc = nextDoc;
    this.revision = entry.revision;
    this.historyLog.push(entry);
    if (this.historyLog.length > MAX_UNDO_HISTORY * 2) {
      this.historyLog.shift();
    }
    this.notify();
  }

  private notify(): void {
    const snap = cloneCartridgeDoc(this.doc);
    for (const listener of this.listeners) {
      listener(snap, this.revision);
    }
  }
}
