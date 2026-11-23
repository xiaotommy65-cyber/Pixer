import type { ExternalAudioManifest } from '../audio/ExternalAudioBank.ts';
import { validateEcsProjectV2, type EcsProjectV2 } from '../ecs/EcsProjectSchema.ts';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,47}$/;

export interface CloudSyncConfig {
  /** Base URL of the Pixer Cloudflare Worker Edge API (e.g. "https://api.pixer.app"). */
  apiBaseUrl: string;
  /** Optional custom fetch implementation (useful for tests or platform bridges). */
  fetchFn?: typeof fetch;
  /** Request timeout in ms (default 10000). */
  timeoutMs?: number;
}

export interface SharedProjectEnvelope {
  slug: string;
  title: string;
  visibility: 'private' | 'unlisted' | 'public';
  etag: string;
  updatedAt: string;
  project: EcsProjectV2;
  audioManifest?: ExternalAudioManifest;
}

export interface PublishProjectResult {
  ok: boolean;
  slug?: string;
  etag?: string;
  r2Key?: string;
  shareQuery?: string;
  updatedAt?: string;
  conflictEtag?: string;
  error?: string;
}

export interface UploadAssetResult {
  ok: boolean;
  r2Key?: string;
  sha256?: string;
  byteSize?: number;
  url?: string;
  error?: string;
}

export interface SramSyncResult {
  ok: boolean;
  merged?: 'local_applied' | 'cloud_newer' | 'unchanged';
  sram?: unknown;
  updatedAt?: string | null;
  error?: string;
}

/** Safely validates a project or cartridge slug (`3..48` lowercase alphanumeric & hyphens). */
export function isValidShareSlug(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

/** Parses `?play=<slug>` from a URL search string cleanly without DOM globals. */
export function resolveShareSlugFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const raw = params.get('play')?.trim().toLowerCase();
    return isValidShareSlug(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Pure, DOM-free Cloud Offload Client for Pixer Option A (Cloudflare Workers + R2 CDN + Supabase).
 * - Fetches & publishes validated `EcsProjectV2` bundles with ETag optimistic locking (`If-Match`).
 * - Uploads content-addressed external audio (`.opus`/`.mp3`) & pixel assets to R2.
 * - Syncs cross-device SRAM saves with timestamp conflict resolution (`cloud_newer` vs `local_applied`).
 * - Degrades cleanly when offline or unconfigured (zero crashes, zero main-thread blocking).
 */
export class CloudSyncClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | null;
  private readonly timeoutMs: number;
  private authToken: string | null = null;

  constructor(config: CloudSyncConfig) {
    this.baseUrl = config.apiBaseUrl.trim().replace(/\/+$/, '');
    this.fetchImpl = config.fetchFn ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.timeoutMs = Math.max(1000, config.timeoutMs ?? 10_000);
  }

  public isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.fetchImpl !== null;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token && token.trim().length > 0 ? token.trim() : null;
  }

  public async fetchSharedProject(
    slug: string,
    knownEtag?: string,
  ): Promise<{ ok: true; notModified: true } | { ok: true; notModified: false; data: SharedProjectEnvelope } | { ok: false; error: string }> {
    if (!this.isConfigured()) return { ok: false, error: 'Cloud API not configured' };
    if (!isValidShareSlug(slug)) return { ok: false, error: 'Invalid share slug' };

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    if (knownEtag) headers['If-None-Match'] = `"${knownEtag.replace(/"/g, '')}"`;

    try {
      const resp = await this.timedFetch(`${this.baseUrl}/api/projects/${encodeURIComponent(slug)}`, {
        method: 'GET',
        headers,
      });
      if (resp.status === 304) {
        return { ok: true, notModified: true };
      }
      if (!resp.ok) {
        return { ok: false, error: `Cloud fetch failed (HTTP ${resp.status})` };
      }
      const raw = (await resp.json()) as Partial<SharedProjectEnvelope>;
      const valid = validateEcsProjectV2(raw.project);
      if (!valid.ok) {
        return { ok: false, error: `Invalid remote project schema: ${valid.errors[0] ?? 'unknown'}` };
      }
      return {
        ok: true,
        notModified: false,
        data: {
          slug: raw.slug ?? slug,
          title: raw.title ?? (raw.project as EcsProjectV2).meta.title,
          visibility: raw.visibility ?? 'unlisted',
          etag: raw.etag ?? resp.headers.get('ETag')?.replace(/"/g, '') ?? '',
          updatedAt: raw.updatedAt ?? new Date().toISOString(),
          project: raw.project as EcsProjectV2,
          audioManifest: raw.audioManifest,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async parseJsonRecordSafe(resp: Response): Promise<Record<string, unknown> | null> {
    try {
      const parsed = (await resp.json()) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  public async publishProject(
    slug: string,
    project: EcsProjectV2,
    opts: {
      visibility?: 'private' | 'unlisted' | 'public';
      expectedEtag?: string;
      note?: string;
      audioManifestR2Key?: string | null;
    } = {},
  ): Promise<PublishProjectResult> {
    if (!this.isConfigured()) return { ok: false, error: 'Cloud API not configured' };
    if (!isValidShareSlug(slug)) return { ok: false, error: 'Invalid project slug' };
    if (!this.authToken) return { ok: false, error: 'Authentication token required to publish' };

    const valid = validateEcsProjectV2(project);
    if (!valid.ok) {
      return { ok: false, error: `Project validation failed: ${valid.errors[0] ?? 'invalid'}` };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.authToken}`,
    };
    if (opts.expectedEtag) {
      headers['If-Match'] = `"${opts.expectedEtag.replace(/"/g, '')}"`;
    }

    try {
      const resp = await this.timedFetch(`${this.baseUrl}/api/projects/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          project,
          visibility: opts.visibility ?? 'unlisted',
          note: opts.note ?? '',
          ...(opts.audioManifestR2Key !== undefined ? { audioManifestR2Key: opts.audioManifestR2Key } : {}),
        }),
      });
      const json = (await this.parseJsonRecordSafe(resp)) ?? {};
      if (resp.status === 412) {
        return {
          ok: false,
          conflictEtag: typeof json.currentEtag === 'string' ? json.currentEtag : undefined,
          error: 'Remote project changed (ETag mismatch)',
        };
      }
      if (!resp.ok) {
        return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${resp.status}` };
      }
      return {
        ok: true,
        slug: String(json.slug ?? slug),
        etag: String(json.etag ?? ''),
        r2Key: String(json.r2Key ?? ''),
        shareQuery: String(json.shareQuery ?? `?play=${slug}`),
        updatedAt: String(json.updatedAt ?? ''),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async uploadExternalAsset(
    bytes: Uint8Array,
    filename: string,
  ): Promise<UploadAssetResult> {
    if (!this.isConfigured()) return { ok: false, error: 'Cloud API not configured' };
    if (!this.authToken) return { ok: false, error: 'Authentication token required to upload assets' };
    if (bytes.byteLength === 0) return { ok: false, error: 'Asset payload is empty' };
    const cleanName = filename.trim();
    if (!cleanName || cleanName.includes('/') || cleanName.includes('\\') || cleanName.includes('..')) {
      return { ok: false, error: 'Invalid asset filename' };
    }

    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const resp = await this.timedFetch(`${this.baseUrl}/api/assets/upload`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          'X-Asset-Filename': cleanName,
          'Content-Type': 'application/octet-stream',
        },
        body: copy,
      });
      const json = (await this.parseJsonRecordSafe(resp)) ?? {};
      if (!resp.ok) {
        return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${resp.status}` };
      }
      return {
        ok: true,
        r2Key: String(json.r2Key ?? ''),
        sha256: String(json.sha256 ?? ''),
        byteSize: Number(json.byteSize ?? bytes.byteLength),
        url: String(json.url ?? ''),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async syncCartridgeSram(
    slug: string,
    localSram: unknown,
    localUpdatedAtIso: string,
  ): Promise<SramSyncResult> {
    if (!this.isConfigured() || !this.authToken) {
      return { ok: true, merged: 'unchanged', sram: localSram, updatedAt: localUpdatedAtIso };
    }
    if (!isValidShareSlug(slug)) return { ok: false, error: 'Invalid cartridge slug' };

    try {
      const resp = await this.timedFetch(`${this.baseUrl}/api/saves/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ sram: localSram, updatedAt: localUpdatedAtIso }),
      });
      const json = (await this.parseJsonRecordSafe(resp)) ?? {};
      if (!resp.ok) {
        return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${resp.status}` };
      }
      return {
        ok: true,
        merged: json.merged === 'cloud_newer' ? 'cloud_newer' : 'local_applied',
        sram: json.sram,
        updatedAt: typeof json.updatedAt === 'string' ? json.updatedAt : null,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async timedFetch(url: string, init: RequestInit): Promise<Response> {
    if (!this.fetchImpl) throw new Error('fetch unavailable');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
