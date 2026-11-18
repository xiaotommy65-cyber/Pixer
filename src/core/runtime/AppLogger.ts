import {
  LOG_RING_BUFFER_LIMIT,
  LocalLogPersistence,
  normalizeError,
  sanitizeLogDetails,
  serializeEntriesToJsonl,
  type LogCategory,
  type LogLevel,
  type LogStatus,
  type StructuredLogEntry,
} from './LogPersistence.ts';

export type { LogCategory, LogLevel, LogStatus, StructuredLogEntry };

export interface LogRecordInput {
  level: LogLevel;
  category: LogCategory;
  operation: string;
  status: LogStatus;
  message: string;
  durationMs?: number;
  details?: Record<string, unknown>;
  error?: unknown;
}

export interface LogFilter {
  level?: LogLevel | 'all';
  category?: LogCategory | 'all';
}

export interface LogCounts {
  total: number;
  success: number;
  info: number;
  warn: number;
  error: number;
}

export type LogListener = (entries: readonly StructuredLogEntry[]) => void;

/**
 * Central structured logging service for Pixel Atelier.
 *
 * Design goals:
 * - Never drops errors: synchronous memory ring buffer + synchronous `localStorage` mirror
 *   on warnings/errors + debounced asynchronous `IndexedDB` flush.
 * - Zero impact on 60fps gameplay: used strictly at I/O, parsing, network, GPU/Audio init,
 *   and cartridge lifecycle boundaries rather than per-frame simulation ticks.
 * - Headless & Node safe: relies purely on feature-detected `globalThis` APIs.
 */
export class AppLogger {
  private readonly persistence = new LocalLogPersistence();
  private readonly listeners = new Set<LogListener>();
  private entries: StructuredLogEntry[] = [];
  private seq = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;

  constructor(loadSyncMirror = true) {
    if (loadSyncMirror) {
      // Pre-load synchronous mirror entries immediately so crash logs from the previous
      // session are visible right away even before IndexedDB resolves.
      const mirror = this.persistence.readMirrorSync();
      if (mirror.length > 0) {
        this.entries = mirror.slice(-LOG_RING_BUFFER_LIMIT);
        this.seq = this.entries.length;
      }
    }
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.entries);
      } catch {
        // Isolate subscriber faults so a failing debug panel never breaks core logging
      }
    }
  }

  private scheduleFlush(urgent: boolean): void {
    if (urgent) {
      // Persist critical errors/warnings synchronously to localStorage immediately
      // in case the page crashes or reloads before the async IndexedDB transaction finishes.
      this.persistence.writeMirrorSync(this.entries);
    }
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.persistence.flushEntries(this.entries);
    }, urgent ? 60 : 350);
  }

  /**
   * Hydrates historical entries stored in IndexedDB and merges them chronologically
   * with any early-boot logs captured before IndexedDB opened.
   */
  public async hydrateFromPersistence(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const persisted = await this.persistence.loadEntries();
      if (persisted.length === 0) return;

      const merged = new Map<string, StructuredLogEntry>();
      for (const item of persisted) merged.set(item.id, item);
      for (const item of this.entries) merged.set(item.id, item);

      this.entries = Array.from(merged.values())
        .sort((a, b) => a.epochMs - b.epochMs)
        .slice(-LOG_RING_BUFFER_LIMIT);
      this.notify();
    } catch {
      // Failure to read historical logs must never impede app startup
    }
  }

  public log(input: LogRecordInput): StructuredLogEntry {
    const epochMs = Date.now();
    this.seq += 1;
    const entry: StructuredLogEntry = {
      id: `log-${epochMs.toString(36)}-${this.seq}`,
      ts: new Date(epochMs).toISOString(),
      epochMs,
      level: input.level,
      category: input.category,
      operation: input.operation,
      status: input.status,
      message: input.message,
    };

    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
      entry.durationMs = Math.round(input.durationMs * 100) / 100;
    }
    if (input.details) {
      entry.details = sanitizeLogDetails(input.details);
    }
    if (input.error !== undefined) {
      entry.error = normalizeError(input.error);
    }

    this.entries.push(entry);
    if (this.entries.length > LOG_RING_BUFFER_LIMIT) {
      this.entries.splice(0, this.entries.length - LOG_RING_BUFFER_LIMIT);
    }

    this.scheduleFlush(input.level === 'error' || input.level === 'warn');
    this.notify();
    return entry;
  }

  public success(
    category: LogCategory,
    operation: string,
    message: string,
    details?: Record<string, unknown>,
    durationMs?: number,
  ): StructuredLogEntry {
    return this.log({
      level: 'success',
      category,
      operation,
      status: 'ok',
      message,
      details,
      durationMs,
    });
  }

  public info(
    category: LogCategory,
    operation: string,
    message: string,
    details?: Record<string, unknown>,
    durationMs?: number,
  ): StructuredLogEntry {
    return this.log({
      level: 'info',
      category,
      operation,
      status: 'ok',
      message,
      details,
      durationMs,
    });
  }

  public warn(
    category: LogCategory,
    operation: string,
    message: string,
    error?: unknown,
    details?: Record<string, unknown>,
    durationMs?: number,
  ): StructuredLogEntry {
    return this.log({
      level: 'warn',
      category,
      operation,
      status: 'fallback',
      message,
      error,
      details,
      durationMs,
    });
  }

  public error(
    category: LogCategory,
    operation: string,
    message: string,
    error?: unknown,
    details?: Record<string, unknown>,
    durationMs?: number,
  ): StructuredLogEntry {
    return this.log({
      level: 'error',
      category,
      operation,
      status: 'error',
      message,
      error,
      details,
      durationMs,
    });
  }

  /**
   * Executes a critical synchronous operation inside a guarded `try-catch` block,
   * automatically timing execution and recording either a structured success or error log.
   */
  public withTryCatch<T>(
    opts: {
      category: LogCategory;
      operation: string;
      successMessage: string | ((result: T) => string);
      errorMessage: string;
      details?: Record<string, unknown>;
      fallback?: (err: unknown) => T;
    },
    fn: () => T,
  ): T {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const result = fn();
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      const msg =
        typeof opts.successMessage === 'function' ? opts.successMessage(result) : opts.successMessage;
      this.success(opts.category, opts.operation, msg, opts.details, dt);
      return result;
    } catch (err) {
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      if (opts.fallback) {
        // Recover cleanly via caller-supplied fallback while warning with full error context
        this.warn(opts.category, opts.operation, `${opts.errorMessage}（已啟用保底復原）`, err, opts.details, dt);
        return opts.fallback(err);
      }
      this.error(opts.category, opts.operation, opts.errorMessage, err, opts.details, dt);
      throw err;
    }
  }

  /**
   * Async counterpart to `withTryCatch`, measuring network/IO latency and logging outcome.
   */
  public async withTryCatchAsync<T>(
    opts: {
      category: LogCategory;
      operation: string;
      successMessage: string | ((result: T) => string);
      errorMessage: string;
      details?: Record<string, unknown>;
      fallback?: (err: unknown) => Promise<T> | T;
    },
    fn: () => Promise<T>,
  ): Promise<T> {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const result = await fn();
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      const msg =
        typeof opts.successMessage === 'function' ? opts.successMessage(result) : opts.successMessage;
      this.success(opts.category, opts.operation, msg, opts.details, dt);
      return result;
    } catch (err) {
      const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      if (opts.fallback) {
        this.warn(opts.category, opts.operation, `${opts.errorMessage}（已啟用保底復原）`, err, opts.details, dt);
        return await opts.fallback(err);
      }
      this.error(opts.category, opts.operation, opts.errorMessage, err, opts.details, dt);
      throw err;
    }
  }

  public getEntries(filter?: LogFilter): readonly StructuredLogEntry[] {
    if (!filter) return this.entries;
    const lvl = filter.level && filter.level !== 'all' ? filter.level : null;
    const cat = filter.category && filter.category !== 'all' ? filter.category : null;
    if (!lvl && !cat) return this.entries;
    return this.entries.filter((e) => (!lvl || e.level === lvl) && (!cat || e.category === cat));
  }

  public getCounts(): LogCounts {
    const counts: LogCounts = { total: this.entries.length, success: 0, info: 0, warn: 0, error: 0 };
    for (const e of this.entries) {
      counts[e.level] += 1;
    }
    return counts;
  }

  public toJsonl(filter?: LogFilter): string {
    return serializeEntriesToJsonl(this.getEntries(filter));
  }

  public async clear(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.entries = [];
    try {
      await this.persistence.clearAll();
    } catch {
      // Ignore clear failure on restricted storage
    }
    // Leave an explicit audit entry confirming manual log purge
    this.info('lifecycle', 'logger.clear', '已清除本機診斷日誌緩衝區');
  }
}

export const appLogger = new AppLogger();
