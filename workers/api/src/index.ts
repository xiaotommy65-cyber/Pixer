import { PixerMcpSession } from '../../../src/core/ai/PixerMcpProtocol.ts';
import { validateEcsProjectV2, type EcsProjectV2 } from '../../../src/core/ecs/EcsProjectSchema.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';
import { createSupabaseMetadataStore } from './supabaseStore.ts';
import type { WorkerEnv } from './types.ts';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,47}$/;
const SAFE_R2_KEY_RE = /^(assets\/(audio|sprites|manifests)|cartridges\/[a-z0-9][a-z0-9-]{2,47})\/[a-zA-Z0-9._-]+$/;

const MAX_PROJECT_BYTES = 2 * 1024 * 1024; // 2 MiB
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MiB
const MAX_PNG_BYTES = 4 * 1024 * 1024; // 4 MiB
const MAX_SRAM_BYTES = 256 * 1024; // 256 KiB

const ASSET_ALLOWLIST: Record<string, { folder: 'audio' | 'sprites' | 'manifests'; contentType: string; maxBytes: number }> = {
  opus: { folder: 'audio', contentType: 'audio/ogg; codecs=opus', maxBytes: MAX_AUDIO_BYTES },
  ogg: { folder: 'audio', contentType: 'audio/ogg', maxBytes: MAX_AUDIO_BYTES },
  mp3: { folder: 'audio', contentType: 'audio/mpeg', maxBytes: MAX_AUDIO_BYTES },
  m4a: { folder: 'audio', contentType: 'audio/mp4', maxBytes: MAX_AUDIO_BYTES },
  png: { folder: 'sprites', contentType: 'image/png', maxBytes: MAX_PNG_BYTES },
  json: { folder: 'manifests', contentType: 'application/json; charset=utf-8', maxBytes: MAX_PROJECT_BYTES },
};

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(clientKey: string, nowMs = Date.now()): boolean {
  const existing = rateBuckets.get(clientKey);
  if (!existing || nowMs >= existing.resetAt) {
    if (rateBuckets.size > 4096) rateBuckets.clear();
    rateBuckets.set(clientKey, { count: 1, resetAt: nowMs + RATE_WINDOW_MS });
    return true;
  }
  existing.count++;
  return existing.count <= RATE_MAX_REQUESTS;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function resolveCorsHeaders(request: Request, env: WorkerEnv): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.length === 0 || allowed.includes('*')
      ? '*'
      : allowed.includes(origin)
        ? origin
        : allowed[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match, X-Asset-Filename',
    'Access-Control-Expose-Headers': 'ETag, Cache-Control',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors,
      ...extraHeaders,
    },
  });
}

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1].trim() : null;
}

function isSafeR2Key(key: string): boolean {
  if (!key || key.length > 256 || key.includes('..') || key.includes('\0')) return false;
  return SAFE_R2_KEY_RE.test(key);
}

/** Normalizes single or comma-separated ETag headers (stripping optional weak W/ prefix and quotes). */
function etagMatches(headerValue: string | null, currentEtag: string): boolean {
  if (!headerValue) return false;
  const target = currentEtag.replace(/^W\//i, '').replace(/"/g, '').trim();
  if (!target) return false;
  const parts = headerValue.split(',');
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i].trim();
    if (token === '*') return true;
    const norm = token.replace(/^W\//i, '').replace(/"/g, '').trim();
    if (norm === target) return true;
  }
  return false;
}

function exceedsContentLength(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get('Content-Length');
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > maxBytes;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Constant-time string comparison for bearer secrets to avoid timing side channels. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Pure Web Standards Cloudflare Worker Edge API Handler (Option A: R2 CDN + Supabase PostgreSQL/Auth).
 * Testable directly in Node.js 22 without wrangler runtime dependencies.
 */
export async function handleEdgeRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const cors = resolveCorsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    return await routeEdgeRequest(request, env, cors);
  } catch {
    return jsonResponse({ error: 'Internal edge API error' }, 500, cors);
  }
}

async function routeEdgeRequest(
  request: Request,
  env: WorkerEnv,
  cors: Record<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  // NOTE: In production Cloudflare deployments, pair this per-isolate soft guard with a
  // Cloudflare Rate Limiting rule / Workers Rate Limit binding for multi-POP enforcement.
  const clientIp = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'local';
  if (!checkRateLimit(`${clientIp}:${pathname.split('/').slice(0, 3).join('/')}`)) {
    return jsonResponse({ error: 'Rate limit exceeded' }, 429, cors, { 'Retry-After': '60' });
  }

  // 1. Health & capabilities probe
  if (request.method === 'GET' && pathname === '/api/health') {
    return jsonResponse(
      {
        ok: true,
        service: 'pixer-edge-api',
        architecture: 'cloudflare-r2-supabase-option-a',
        features: {
          r2Assets: Boolean(env.PIXER_ASSETS),
          supabase: Boolean(env.__TEST_STORE__ || (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)),
          aiProxy: Boolean(env.AI_PROVIDER_API_KEY && env.AI_PROVIDER_BASE_URL),
          remoteMcp: Boolean(env.MCP_ACCESS_TOKEN),
        },
      },
      200,
      cors,
    );
  }

  // 2. Immutable Content-Addressed R2 CDN Asset Serving: GET /api/assets/<key>
  if (request.method === 'GET' && pathname.startsWith('/api/assets/')) {
    let key: string;
    try {
      key = decodeURIComponent(pathname.slice('/api/assets/'.length));
    } catch {
      return jsonResponse({ error: 'Malformed percent-encoding in asset key' }, 400, cors);
    }
    if (!isSafeR2Key(key)) {
      return jsonResponse({ error: 'Invalid or unsafe asset key' }, 400, cors);
    }
    const obj = await env.PIXER_ASSETS.get(key);
    if (!obj) {
      return jsonResponse({ error: 'Asset not found' }, 404, cors);
    }
    const cleanEtag = obj.etag.replace(/"/g, '');
    if (etagMatches(request.headers.get('If-None-Match'), cleanEtag)) {
      return new Response(null, { status: 304, headers: { ...cors, ETag: `"${cleanEtag}"` } });
    }
    const data = await obj.arrayBuffer();
    return new Response(data, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': obj.httpMetadata?.cacheControl ?? 'public, max-age=31536000, immutable',
        ETag: `"${cleanEtag}"`,
      },
    });
  }

  const store = createSupabaseMetadataStore(env);

  // 3. Authenticated Content-Addressed Asset Upload: PUT /api/assets/upload
  if (request.method === 'PUT' && pathname === '/api/assets/upload') {
    const token = extractBearerToken(request);
    const user = token ? await store.verifyUserToken(token) : null;
    if (!user) {
      return jsonResponse({ error: 'Unauthorized: valid Supabase Bearer token required' }, 401, cors);
    }

    const rawFilename = request.headers.get('X-Asset-Filename') ?? '';
    const ext = rawFilename.split('.').pop()?.toLowerCase() ?? '';
    const rule = ASSET_ALLOWLIST[ext];
    if (!rule) {
      return jsonResponse(
        { error: `Unsupported asset extension ".${ext}". Allowed: ${Object.keys(ASSET_ALLOWLIST).join(', ')}` },
        400,
        cors,
      );
    }

    if (exceedsContentLength(request, rule.maxBytes)) {
      return jsonResponse({ error: `Asset byte size exceeds ${rule.maxBytes} byte limit` }, 413, cors);
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > rule.maxBytes) {
      return jsonResponse(
        { error: `Asset byte size (${bytes.byteLength}) must be between 1 and ${rule.maxBytes} bytes` },
        413,
        cors,
      );
    }

    const hash = await sha256Hex(bytes);
    const r2Key = `assets/${rule.folder}/${hash}.${ext}`;
    await env.PIXER_ASSETS.put(r2Key, bytes, {
      httpMetadata: {
        contentType: rule.contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        ownerId: user.userId,
        sha256: hash,
      },
    });

    const cdnBase = (env.PUBLIC_CDN_BASE_URL ?? '').replace(/\/+$/, '');
    const publicUrl = cdnBase ? `${cdnBase}/${r2Key}` : `/api/assets/${r2Key}`;
    return jsonResponse(
      {
        ok: true,
        r2Key,
        sha256: hash,
        byteSize: bytes.byteLength,
        contentType: rule.contentType,
        url: publicUrl,
      },
      201,
      cors,
    );
  }

  // 4. Shared Project Fetch & Publish: GET / PUT /api/projects/:slug
  if (pathname.startsWith('/api/projects/')) {
    const slug = pathname.slice('/api/projects/'.length);
    if (!SLUG_RE.test(slug)) {
      return jsonResponse({ error: 'Invalid project slug (3-48 lowercase alphanumeric/hyphen)' }, 400, cors);
    }

    if (request.method === 'GET') {
      const rec = await store.getProjectBySlug(slug);
      if (!rec) {
        return jsonResponse({ error: 'Project not found' }, 404, cors);
      }
      if (rec.visibility === 'private') {
        const token = extractBearerToken(request);
        const user = token ? await store.verifyUserToken(token) : null;
        if (!user || user.userId !== rec.owner_id) {
          return jsonResponse({ error: 'Forbidden: private project' }, 403, cors);
        }
      }

      const cleanEtag = rec.etag.replace(/"/g, '');
      if (etagMatches(request.headers.get('If-None-Match'), cleanEtag)) {
        return new Response(null, { status: 304, headers: { ...cors, ETag: `"${cleanEtag}"` } });
      }

      const blob = await env.PIXER_ASSETS.get(rec.latest_r2_key);
      if (!blob) {
        return jsonResponse({ error: 'Project payload missing from R2 storage' }, 502, cors);
      }
      let projectJson: EcsProjectV2;
      try {
        projectJson = JSON.parse(await blob.text()) as EcsProjectV2;
      } catch {
        return jsonResponse({ error: 'Corrupted project JSON in R2 storage' }, 502, cors);
      }
      let audioManifest: unknown = undefined;
      if (rec.audio_manifest_r2_key && isSafeR2Key(rec.audio_manifest_r2_key)) {
        const audioBlob = await env.PIXER_ASSETS.get(rec.audio_manifest_r2_key);
        if (audioBlob) {
          try {
            audioManifest = JSON.parse(await audioBlob.text()) as unknown;
          } catch {
            // Degrade silently to no external audio manifest if corrupt
            audioManifest = undefined;
          }
        }
      }
      return jsonResponse(
        {
          slug: rec.slug,
          title: rec.title,
          visibility: rec.visibility,
          etag: rec.etag,
          updatedAt: rec.updated_at,
          project: projectJson,
          ...(audioManifest !== undefined ? { audioManifest } : {}),
        },
        200,
        cors,
        {
          ETag: `"${cleanEtag}"`,
          'Cache-Control': rec.visibility === 'public' ? 'public, max-age=60, stale-while-revalidate=300' : 'private, no-cache',
        },
      );
    }

    if (request.method === 'PUT') {
      const token = extractBearerToken(request);
      const user = token ? await store.verifyUserToken(token) : null;
      if (!user) {
        return jsonResponse({ error: 'Unauthorized: valid Supabase Bearer token required' }, 401, cors);
      }
      if (exceedsContentLength(request, MAX_PROJECT_BYTES)) {
        return jsonResponse({ error: `Project payload exceeds ${MAX_PROJECT_BYTES} byte limit` }, 413, cors);
      }

      const rawText = await request.text();
      const rawByteLen = utf8ByteLength(rawText);
      if (rawByteLen === 0 || rawByteLen > MAX_PROJECT_BYTES) {
        return jsonResponse({ error: `Project payload exceeds ${MAX_PROJECT_BYTES} byte limit` }, 413, cors);
      }

      let body: {
        project?: unknown;
        visibility?: 'private' | 'unlisted' | 'public';
        note?: string;
        audioManifestR2Key?: string | null;
      };
      try {
        body = JSON.parse(rawText) as {
          project?: unknown;
          visibility?: 'private' | 'unlisted' | 'public';
          note?: string;
          audioManifestR2Key?: string | null;
        };
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }

      if (
        typeof body.audioManifestR2Key === 'string' &&
        body.audioManifestR2Key.length > 0 &&
        !isSafeR2Key(body.audioManifestR2Key)
      ) {
        return jsonResponse({ error: 'Invalid audioManifestR2Key' }, 400, cors);
      }

      const validation = validateEcsProjectV2(body.project);
      if (!validation.ok) {
        return jsonResponse({ error: 'Invalid EcsProjectV2 schema', details: validation.errors }, 400, cors);
      }
      const proj = body.project as EcsProjectV2;

      const existing = await store.getProjectBySlug(slug);
      if (existing) {
        if (existing.owner_id !== user.userId) {
          return jsonResponse({ error: 'Forbidden: you do not own this project slug' }, 403, cors);
        }
        const ifMatchHeader = request.headers.get('If-Match');
        if (ifMatchHeader && !etagMatches(ifMatchHeader, existing.etag)) {
          return jsonResponse(
            { error: 'Conflict: project was modified remotely', currentEtag: existing.etag },
            412,
            cors,
          );
        }
      }

      const projectBytes = new TextEncoder().encode(JSON.stringify(proj));
      const hash = await sha256Hex(projectBytes);
      const r2Key = `cartridges/${slug}/${hash.slice(0, 16)}.ecs.json`;
      await env.PIXER_ASSETS.put(r2Key, projectBytes, {
        httpMetadata: {
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          slug,
          ownerId: user.userId,
          sha256: hash,
        },
      });

      const visibility =
        body.visibility === 'private' || body.visibility === 'public' || body.visibility === 'unlisted'
          ? body.visibility
          : existing?.visibility ?? 'unlisted';

      const audioManifestR2Key =
        body.audioManifestR2Key === null
          ? null
          : typeof body.audioManifestR2Key === 'string' && body.audioManifestR2Key.length > 0
            ? body.audioManifestR2Key
            : existing?.audio_manifest_r2_key ?? null;

      const saved = await store.upsertProjectWithRevision({
        slug,
        ownerId: user.userId,
        title: proj.meta.title.slice(0, 120),
        schemaVersion: proj.schemaVersion,
        visibility,
        r2Key,
        audioManifestR2Key,
        etag: hash.slice(0, 24),
        sha256: hash,
        byteSize: projectBytes.byteLength,
        note: typeof body.note === 'string' ? body.note.slice(0, 200) : '',
      });

      return jsonResponse(
        {
          ok: true,
          slug: saved.slug,
          etag: saved.etag,
          r2Key: saved.latest_r2_key,
          audioManifestR2Key: saved.audio_manifest_r2_key ?? null,
          shareQuery: `?play=${saved.slug}`,
          updatedAt: saved.updated_at,
        },
        existing ? 200 : 201,
        cors,
        { ETag: `"${saved.etag}"` },
      );
    }
  }

  // 5. Cross-Device User SRAM Cloud Sync: GET / PUT /api/saves/:slug
  if (pathname.startsWith('/api/saves/')) {
    const slug = pathname.slice('/api/saves/'.length);
    if (!SLUG_RE.test(slug)) {
      return jsonResponse({ error: 'Invalid cartridge slug' }, 400, cors);
    }
    const token = extractBearerToken(request);
    const user = token ? await store.verifyUserToken(token) : null;
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401, cors);
    }

    if (request.method === 'GET') {
      const save = await store.getUserSave(user.userId, slug);
      if (!save) return jsonResponse({ exists: false, sram: null, updatedAt: null }, 200, cors);
      return jsonResponse({ exists: true, sram: save.sram_jsonb, updatedAt: save.updated_at }, 200, cors);
    }

    if (request.method === 'PUT') {
      if (exceedsContentLength(request, MAX_SRAM_BYTES)) {
        return jsonResponse({ error: `SRAM payload exceeds ${MAX_SRAM_BYTES} byte limit` }, 413, cors);
      }
      const rawText = await request.text();
      const rawByteLen = utf8ByteLength(rawText);
      if (rawByteLen === 0 || rawByteLen > MAX_SRAM_BYTES) {
        return jsonResponse({ error: `SRAM payload exceeds ${MAX_SRAM_BYTES} byte limit` }, 413, cors);
      }
      let payload: { sram?: unknown; updatedAt?: string };
      try {
        payload = JSON.parse(rawText) as { sram?: unknown; updatedAt?: string };
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
      }
      if (payload.sram === undefined || payload.sram === null) {
        return jsonResponse({ error: 'Missing sram field' }, 400, cors);
      }
      const nowMs = Date.now();
      const parsedMs = typeof payload.updatedAt === 'string' ? Date.parse(payload.updatedAt) : Number.NaN;
      // Clamp future-skewed timestamps (> +5 min) so one misconfigured clock cannot freeze multi-device sync
      const clampedMs = Number.isFinite(parsedMs) ? Math.min(parsedMs, nowMs + 300_000) : nowMs;
      const incomingTs = new Date(clampedMs).toISOString();

      const existing = await store.getUserSave(user.userId, slug);
      const existingMs = existing ? Date.parse(existing.updated_at) : Number.NaN;
      if (existing && Number.isFinite(existingMs) && existingMs > clampedMs) {
        // Cloud save is strictly newer: return authoritative cloud record instead of clobbering
        return jsonResponse(
          {
            ok: true,
            merged: 'cloud_newer',
            sram: existing.sram_jsonb,
            updatedAt: existing.updated_at,
          },
          200,
          cors,
        );
      }

      const stored = await store.upsertUserSave(user.userId, slug, payload.sram, incomingTs);
      return jsonResponse(
        {
          ok: true,
          merged: 'local_applied',
          sram: stored.sram_jsonb,
          updatedAt: stored.updated_at,
        },
        200,
        cors,
      );
    }
  }

  // 6. Edge AI Proxy Boundary (matches RemoteHttpAiProvider `/api/ai/{stage,dialog,advise}`)
  if (request.method === 'POST' && /^\/api\/ai\/(stage|dialog|advise)$/.test(pathname)) {
    const token = extractBearerToken(request);
    const user = token ? await store.verifyUserToken(token) : null;
    if (!user) {
      return jsonResponse({ error: 'Unauthorized: valid Supabase Bearer token required for Edge AI proxy' }, 401, cors);
    }
    if (!env.AI_PROVIDER_API_KEY || !env.AI_PROVIDER_BASE_URL) {
      return jsonResponse(
        { error: 'Remote AI proxy not configured on this Edge deployment (client will fall back locally)' },
        503,
        cors,
      );
    }
    const MAX_AI_BYTES = 64 * 1024;
    if (exceedsContentLength(request, MAX_AI_BYTES)) {
      return jsonResponse({ error: 'AI request payload exceeds 64 KB limit' }, 413, cors);
    }
    const bodyText = await request.text();
    if (utf8ByteLength(bodyText) > MAX_AI_BYTES) {
      return jsonResponse({ error: 'AI request payload exceeds 64 KB limit' }, 413, cors);
    }
    const upstream = `${env.AI_PROVIDER_BASE_URL.replace(/\/+$/, '')}${pathname.slice('/api/ai'.length)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const proxied = await fetch(upstream, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.AI_PROVIDER_API_KEY}`,
        },
        body: bodyText,
        signal: ctrl.signal,
      });
      const outText = await proxied.text();
      return new Response(outText, {
        status: proxied.status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      return jsonResponse(
        { error: isTimeout ? 'Upstream AI provider timed out' : 'Upstream AI provider unreachable' },
        isTimeout ? 504 : 502,
        cors,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // 7. Remote Streamable HTTP MCP Endpoint: POST /api/mcp
  if (request.method === 'POST' && pathname === '/api/mcp') {
    const token = extractBearerToken(request);
    if (!env.MCP_ACCESS_TOKEN || !token || !timingSafeEqualStr(token, env.MCP_ACCESS_TOKEN)) {
      return jsonResponse({ error: 'Unauthorized MCP access' }, 401, cors);
    }
    if (exceedsContentLength(request, MAX_PROJECT_BYTES)) {
      return jsonResponse({ error: 'MCP payload exceeds limit' }, 413, cors);
    }
    const rawText = await request.text();
    if (utf8ByteLength(rawText) > MAX_PROJECT_BYTES) {
      return jsonResponse({ error: 'MCP payload exceeds limit' }, 413, cors);
    }
    let rpcPayload: unknown;
    try {
      rpcPayload = JSON.parse(rawText);
    } catch {
      return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400, cors);
    }
    const slug = url.searchParams.get('slug');
    let initialProj: EcsProjectV2 = OBSIDIAN_CITADEL_PROJECT;
    if (slug && SLUG_RE.test(slug)) {
      const rec = await store.getProjectBySlug(slug);
      if (rec && rec.visibility !== 'private' && isSafeR2Key(rec.latest_r2_key)) {
        const obj = await env.PIXER_ASSETS.get(rec.latest_r2_key);
        if (obj) {
          try {
            const parsed = JSON.parse(await obj.text()) as unknown;
            if (validateEcsProjectV2(parsed).ok) {
              initialProj = parsed as EcsProjectV2;
            }
          } catch {
            return jsonResponse({ error: 'Corrupted project JSON in R2 storage' }, 502, cors);
          }
        }
      }
    }
    const mcp = new PixerMcpSession(initialProj);
    const rpcResp = mcp.handleRequest(rpcPayload);
    return jsonResponse(rpcResp ?? { ok: true }, 200, cors);
  }

  return jsonResponse({ error: 'Not found' }, 404, cors);
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleEdgeRequest(request, env);
  },
};
