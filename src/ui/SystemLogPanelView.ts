import {
  appLogger,
  type LogCategory,
  type LogLevel,
  type StructuredLogEntry,
} from '../core/runtime/AppLogger.ts';
import { btn, el } from './dom.ts';

const CATEGORY_OPTIONS: readonly { value: LogCategory | 'all'; label: string }[] = [
  { value: 'all', label: '全部分類' },
  { value: 'network', label: '網路請求' },
  { value: 'parsing', label: '資料解析' },
  { value: 'storage', label: '本機儲存' },
  { value: 'gpu', label: 'GPU 渲染' },
  { value: 'audio', label: '音訊引擎' },
  { value: 'lifecycle', label: '系統生命週期' },
  { value: 'ui', label: '介面操作' },
];

const LEVEL_BADGE_TEXT: Record<LogLevel, string> = {
  success: 'OK',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR',
};

function formatTimeMs(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Developer Diagnostic Log Viewer embedded inside the System Settings modal.
 * Displays structured success, warning, and error records with timestamps, durations,
 * expandable JSON payloads, interactive filters, and .jsonl file export.
 */
export class SystemLogPanelView {
  public readonly element: HTMLElement;

  private readonly ac = new AbortController();
  private unsubLogger: (() => void) | null = null;
  private levelFilter: LogLevel | 'all' = 'all';
  private categoryFilter: LogCategory | 'all' = 'all';
  private readonly expandedIds = new Set<string>();

  private readonly summaryEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly statusNoteEl: HTMLElement;
  private readonly categorySelect: HTMLSelectElement;
  private readonly levelBtns = new Map<LogLevel | 'all', HTMLButtonElement>();

  constructor() {
    const { signal } = this.ac;

    this.element = el('div', 'sys-log-panel panel-hidden');

    // Summary metadata strip (clean unboxed text with middot separators)
    this.summaryEl = el('div', 'sys-log-summary');

    // Toolbar: level segmented filters + category select + export/copy/clear actions
    const filterRow = el('div', 'sys-log-filter-row');
    const levelGroup = el('div', 'grip-segmented');
    levelGroup.setAttribute('role', 'group');
    levelGroup.setAttribute('aria-label', '日誌層級篩選');

    const levels: { value: LogLevel | 'all'; label: string }[] = [
      { value: 'all', label: '全部' },
      { value: 'success', label: '成功' },
      { value: 'warn', label: '警告' },
      { value: 'error', label: '錯誤' },
    ];
    for (const item of levels) {
      const b = btn('grip-seg-btn', item.label);
      b.classList.toggle('is-active', item.value === 'all');
      b.addEventListener(
        'click',
        () => {
          this.levelFilter = item.value;
          for (const [k, node] of this.levelBtns.entries()) {
            node.classList.toggle('is-active', k === item.value);
          }
          this.renderList();
        },
        { signal },
      );
      this.levelBtns.set(item.value, b);
      levelGroup.appendChild(b);
    }

    this.categorySelect = el('select', 'sys-log-select');
    this.categorySelect.setAttribute('aria-label', '依模組分類篩選日誌');
    for (const opt of CATEGORY_OPTIONS) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      this.categorySelect.appendChild(o);
    }
    this.categorySelect.addEventListener(
      'change',
      () => {
        this.categoryFilter = this.categorySelect.value as LogCategory | 'all';
        this.renderList();
      },
      { signal },
    );

    filterRow.append(levelGroup, this.categorySelect);

    const actionRow = el('div', 'sys-log-actions');
    const exportBtn = btn('toy-btn is-mint', '⬇ 匯出 .jsonl', '下載結構化 JSONL 日誌檔案', () => this.exportJsonlFile(), signal);
    const copyBtn = btn('toy-btn', '📋 複製 JSONL', '複製篩選後的 JSONL 日誌至剪貼簿', () => void this.copyJsonl(), signal);
    const clearBtn = btn('toy-btn is-danger-soft', '🗑 清除日誌', '清除本機儲存的系統診斷日誌', () => void this.clearLogs(), signal);
    actionRow.append(exportBtn, copyBtn, clearBtn);

    this.statusNoteEl = el('div', 'sys-log-note panel-hidden');
    this.listEl = el('div', 'sys-log-list');
    this.listEl.setAttribute('role', 'log');
    this.listEl.setAttribute('aria-live', 'polite');

    this.element.append(this.summaryEl, filterRow, actionRow, this.statusNoteEl, this.listEl);
  }

  public setVisible(visible: boolean): void {
    this.element.classList.toggle('panel-hidden', !visible);
    if (visible) {
      if (!this.unsubLogger) {
        this.unsubLogger = appLogger.subscribe(() => this.renderList());
      }
      this.renderList();
    } else if (this.unsubLogger) {
      this.unsubLogger();
      this.unsubLogger = null;
    }
  }

  private showNote(text: string): void {
    this.statusNoteEl.textContent = text;
    this.statusNoteEl.classList.remove('panel-hidden');
  }

  private exportJsonlFile(): void {
    // Wrap Blob serialization & synthetic anchor download in try-catch to handle
    // strict CSP or restricted preview iframes gracefully.
    try {
      const jsonl = appLogger.toJsonl({
        level: this.levelFilter,
        category: this.categoryFilter,
      });
      const blob = new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `pixel-atelier-logs-${stamp}.jsonl`;
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      appLogger.success('ui', 'logs.exportJsonl', `已匯出結構化日誌檔 (${filename})`, {
        bytes: blob.size,
      });
      this.showNote(`已匯出 ${filename}`);
    } catch (err) {
      appLogger.error('ui', 'logs.exportJsonl', '匯出 JSONL 日誌檔案失敗', err);
      this.showNote('匯出失敗，請改用複製功能');
    }
  }

  private async copyJsonl(): Promise<void> {
    try {
      const jsonl = appLogger.toJsonl({
        level: this.levelFilter,
        category: this.categoryFilter,
      });
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(jsonl);
      this.showNote(`已複製 ${jsonl ? jsonl.split('\n').length : 0} 筆 JSONL 日誌`);
    } catch (err) {
      appLogger.warn('ui', 'logs.copyJsonl', '無法自動寫入剪貼簿，請改用檔案匯出', err);
      this.showNote('瀏覽器未授權自動複製，請點擊「匯出 .jsonl」');
    }
  }

  private async clearLogs(): Promise<void> {
    this.expandedIds.clear();
    await appLogger.clear();
    this.showNote('已清除先前的日誌紀錄');
    this.renderList();
  }

  private resetFilters(): void {
    this.levelFilter = 'all';
    this.categoryFilter = 'all';
    this.categorySelect.value = 'all';
    for (const [k, node] of this.levelBtns.entries()) {
      node.classList.toggle('is-active', k === 'all');
    }
    this.renderList();
  }

  public renderList(): void {
    const counts = appLogger.getCounts();
    this.summaryEl.textContent = `共 ${counts.total} 筆 · ${counts.success} 成功 · ${counts.warn} 警告 · ${counts.error} 錯誤`;

    const filtered = appLogger.getEntries({
      level: this.levelFilter,
      category: this.categoryFilter,
    });

    this.listEl.innerHTML = '';
    if (filtered.length === 0) {
      const emptyBox = el('div', 'sys-log-empty');
      emptyBox.appendChild(el('p', undefined, '目前沒有符合篩選條件的日誌紀錄。'));
      if (this.levelFilter !== 'all' || this.categoryFilter !== 'all') {
        const resetBtn = btn('toy-btn', '重設篩選條件', undefined, () => this.resetFilters());
        emptyBox.appendChild(resetBtn);
      }
      this.listEl.appendChild(emptyBox);
      return;
    }

    // Render newest entries first (max 150 rows in DOM to keep scroll snappy)
    const slice = filtered.slice(-150).reverse();
    for (const entry of slice) {
      this.listEl.appendChild(this.createLogRow(entry));
    }
  }

  private createLogRow(entry: StructuredLogEntry): HTMLElement {
    const row = el('div', `sys-log-row is-${entry.level}`);
    const hasExtra = Boolean(entry.details || entry.error);
    const expanded = this.expandedIds.has(entry.id);

    const headBtn = document.createElement('button');
    headBtn.type = 'button';
    headBtn.className = 'sys-log-row-btn';
    headBtn.setAttribute('aria-expanded', String(expanded));

    const metaLine = el('div', 'sys-log-meta');
    const levelTag = el('span', `sys-log-level is-${entry.level}`, LEVEL_BADGE_TEXT[entry.level]);
    const timeEl = el('span', 'sys-log-time', formatTimeMs(entry.epochMs));
    const opEl = el('span', 'sys-log-op', entry.operation);
    metaLine.append(levelTag, el('span', 'sys-log-sep', '·'), timeEl, el('span', 'sys-log-sep', '·'), opEl);
    if (typeof entry.durationMs === 'number') {
      metaLine.append(el('span', 'sys-log-sep', '·'), el('span', 'sys-log-dur', `${entry.durationMs.toFixed(1)}ms`));
    }

    const msgEl = el('div', 'sys-log-msg', entry.message);
    headBtn.append(metaLine, msgEl);

    if (hasExtra) {
      const detailPre = el('pre', `sys-log-detail${expanded ? '' : ' panel-hidden'}`);
      detailPre.textContent = JSON.stringify(
        {
          ts: entry.ts,
          category: entry.category,
          status: entry.status,
          ...(entry.details ? { details: entry.details } : {}),
          ...(entry.error ? { error: entry.error } : {}),
        },
        null,
        2,
      );
      headBtn.addEventListener('click', () => {
        if (this.expandedIds.has(entry.id)) {
          this.expandedIds.delete(entry.id);
          detailPre.classList.add('panel-hidden');
          headBtn.setAttribute('aria-expanded', 'false');
        } else {
          this.expandedIds.add(entry.id);
          detailPre.classList.remove('panel-hidden');
          headBtn.setAttribute('aria-expanded', 'true');
        }
      });
      row.append(headBtn, detailPre);
    } else {
      row.appendChild(headBtn);
    }

    return row;
  }

  public destroy(): void {
    if (this.unsubLogger) {
      this.unsubLogger();
      this.unsubLogger = null;
    }
    this.ac.abort();
    this.expandedIds.clear();
    this.levelBtns.clear();
  }
}
