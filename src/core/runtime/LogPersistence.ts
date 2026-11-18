/**
 * Structured logging schema and local persistence helpers for Pixel Atelier.
 * Kept 100% DOM-free (`globalThis` feature detection only) so both browser PWA
 * and headless Node simulation runners can share the exact same log format.
 */

export type LogLevel = 'success' | 'info' | 'warn' | 'error';

export type LogCategory =
  | 'network'
  | 'parsing'
  | 'storage'
  | 'gpu'
  | 'audio'
  | 'lifecycle'
  | 'ui';

export type LogStatus = 'ok' | 'fallback' | 'error';

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
  cause?: string;
}

export interface StructuredLogEntry {
  id: string;
  ts: string;
  epochMs: number;
  level: LogLevel;
  category: LogCategory;
  operation: string;
  status: LogStatus;
  durationMs?: number;
  message: string;
  details?: Record<string, unknown>;
  error?: NormalizedError;
}

export const LOG_RING_BUFFER_LIMIT = 500;
const MIRROR_STORAGE_KEY = 'pixel-atelier-logs-mirror-v1';
const MIRROR_ENTRY_LIMIT = 80;
const IDB_NAME = 'pixel-atelier-logs-db';
const IDB_VERSION = 1;
const IDB_STORE = 'entries';

/**
 * Normalizes any thrown unknown value into a predictable, JSON-serializable error record.
 * Guards against non-Error primitives (strings, numbers, DOMEvents) and circular `cause` chains.
 */
export function normalizeError(err: unknown): NormalizedError {
  if (err instanceof Error) {
    const out: NormalizedError = {
      name: err.name || 'Error',
      message: err.message || 'Unknown error',
    };
    if (typeof err.stack === 'string' && err.stack.length > 0) {
      out.stack = err.stack.split('\n').slice(0, 8).join('\n');
    }
    const rawCause = (err as Error & { cause?: unknown }).cause;
    if (rawCause !== undefined) {
      out.cause = rawCause instanceof Error ? `${rawCause.name}: ${rawCause.message}` : String(rawCause);
    }
    return out;
  }
  if (typeof err === 'object' && err !== null) {
    try {
      const rec = err as Record<string, unknown>;
      return {
        name: typeof rec.name === 'string' ? rec.name : 'ThrownObject',
        message: typeof rec.message === 'string' ? rec.message : JSON.stringify(rec).slice(0, 280),
      };
    } catch {
      return { name: 'ThrownObject', message: Object.prototype.toString.call(err) };
    }
  }
  return {
    name: typeof err === 'string' ? 'ErrorMessage' : 'ThrownValue',
    message: String(err),
  };
}

/**
 * Produces a circular-safe, bounded copy of structured `details` metadata
 * so logging never throws `TypeError: Converting circular structure to JSON`.
 */
export function sanitizeLogDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const seen = new WeakSet<object>();

  const clampValue = (val: unknown, depth: number): unknown => {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') {
      return val.length > 400 ? `${val.slice(0, 400)}…(${val.length} chars)` : val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') return val;
    if (typeof val === 'bigint') return val.toString();
    if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
    if (val instanceof Error) return normalizeError(val);
    if (depth >= 3) return '[MaxDepth]';
    if (typeof val !== 'object') return String(val);

    if (seen.has(val)) return '[Circular]';
    seen.add(val);

    if (ArrayBuffer.isView(val)) {
      return `[TypedArray ${val.constructor.name}(${val.byteLength}B)]`;
    }
    if (Array.isArray(val)) {
      return val.slice(0, 12).map((item) => clampValue(item, depth + 1));
    }

    const clean: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>).slice(0, 20);
    for (const k of keys) {
      clean[k] = clampValue((val as Record<string, unknown>)[k], depth + 1);
    }
    return clean;
  };

  try {
    return clampValue(details, 0) as Record<string, unknown>;
  } catch {
    return { note: 'Details serialization skipped due to uncloneable object' };
  }
}

/**
 * Formats log entries as Newline-Delimited JSON (JSONL): one valid JSON object per line.
 */
export function serializeEntriesToJsonl(entries: readonly StructuredLogEntry[]): string {
  const lines: string[] = [];
  for (const entry of entries) {
    try {
      lines.push(JSON.stringify(entry));
    } catch {
      lines.push(
        JSON.stringify({
          id: entry.id,
          ts: entry.ts,
          epochMs: entry.epochMs,
          level: entry.level,
          category: entry.category,
          operation: entry.operation,
          status: entry.status,
          message: entry.message,
        }),
      );
    }
  }
  return lines.join('\n');
}

/**
 * Parses a JSONL string safely line-by-line so one corrupted record never discards healthy entries.
 */
export function parseJsonlEntries(raw: string): StructuredLogEntry[] {
  if (!raw) return [];
  const out: StructuredLogEntry[] = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<StructuredLogEntry>;
      if (
        parsed &&
        typeof parsed.id === 'string' &&
        typeof parsed.ts === 'string' &&
        typeof parsed.epochMs === 'number' &&
        typeof parsed.level === 'string' &&
        typeof parsed.category === 'string' &&
        typeof parsed.operation === 'string' &&
        typeof parsed.message === 'string'
      ) {
        out.push(parsed as StructuredLogEntry);
      }
    } catch {
      // Skip malformed line while preserving all valid JSONL lines
    }
  }
  return out;
}

/**
 * Dual-tier local persistence adapter:
 * 1. Primary: IndexedDB (`pixel-atelier-logs-db`) for non-blocking structured storage up to 500 entries.
 * 2. Synchronous Mirror: `localStorage` (`pixel-atelier-logs-mirror-v1`) keeping latest 80 records
 *    so errors occurring immediately before a crash/reload are preserved synchronously.
 */
export class LocalLogPersistence {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = idb.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        // Private browsing or security-restricted sandbox may throw synchronously on open()
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  public writeMirrorSync(entries: readonly StructuredLogEntry[]): void {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return;
    try {
      const recent = entries.slice(-MIRROR_ENTRY_LIMIT);
      storage.setItem(MIRROR_STORAGE_KEY, serializeEntriesToJsonl(recent));
    } catch {
      // Ignore quota / security errors in mirror write so critical logging never crashes callers
    }
  }

  public readMirrorSync(): StructuredLogEntry[] {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return [];
    try {
      const raw = storage.getItem(MIRROR_STORAGE_KEY);
      return raw ? parseJsonlEntries(raw) : [];
    } catch {
      return [];
    }
  }

  public async flushEntries(entries: readonly StructuredLogEntry[]): Promise<void> {
    this.writeMirrorSync(entries);
    const db = await this.openDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.clear();
        const capped = entries.slice(-LOG_RING_BUFFER_LIMIT);
        for (const item of capped) {
          store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  public async loadEntries(): Promise<StructuredLogEntry[]> {
    const mirror = this.readMirrorSync();
    const db = await this.openDb();
    if (!db) return mirror;

    const idbEntries = await new Promise<StructuredLogEntry[]>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = Array.isArray(req.result) ? (req.result as StructuredLogEntry[]) : [];
          resolve(rows);
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });

    if (idbEntries.length === 0) return mirror;
    const byId = new Map<string, StructuredLogEntry>();
    for (const e of idbEntries) byId.set(e.id, e);
    for (const e of mirror) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    return Array.from(byId.values())
      .sort((a, b) => a.epochMs - b.epochMs)
      .slice(-LOG_RING_BUFFER_LIMIT);
  }

  public async clearAll(): Promise<void> {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage) {
      try {
        storage.removeItem(MIRROR_STORAGE_KEY);
      } catch {
        // Ignore storage restrictions
      }
    }
    const db = await this.openDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
