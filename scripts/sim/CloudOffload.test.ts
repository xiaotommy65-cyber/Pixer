import assert from 'node:assert/strict';
import test from 'node:test';
import { ExternalAudioBank } from '../../src/core/audio/ExternalAudioBank.ts';
import {
  CloudSyncClient,
  isValidShareSlug,
  resolveShareSlugFromSearch,
} from '../../src/core/cloud/CloudSyncClient.ts';
import { EMERALD_RUINS_PROJECT } from '../../src/game/emeraldRuins/EmeraldRuinsProject.ts';
import { OBSIDIAN_CITADEL_PROJECT } from '../../src/game/obsidianCitadel/ObsidianCitadelProject.ts';
import { handleEdgeRequest } from '../../workers/api/src/index.ts';
import type {
  CloudMetadataStore,
  ProjectRecord,
  R2BucketLike,
  R2ObjectLike,
  UserSaveRecord,
  WorkerEnv,
} from '../../workers/api/src/types.ts';

function createMockCloudEnv(): WorkerEnv {
  const r2Objects = new Map<
    string,
    { bytes: Uint8Array; etag: string; httpMetadata?: { contentType?: string; cacheControl?: string } }
  >();
  const bucket: R2BucketLike = {
    async get(key: string): Promise<R2ObjectLike | null> {
      const hit = r2Objects.get(key);
      if (!hit) return null;
      return {
        key,
        size: hit.bytes.byteLength,
        etag: hit.etag,
        httpMetadata: hit.httpMetadata,
        async arrayBuffer() {
          const copy = new Uint8Array(hit.bytes.byteLength);
          copy.set(hit.bytes);
          return copy.buffer;
        },
        async text() {
          return new TextDecoder().decode(hit.bytes);
        },
      };
    },
    async put(key, value, options) {
      const bytes =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? new Uint8Array(value)
            : new Uint8Array(value);
      const etag = `etag_${key.length}_${bytes.byteLength}`;
      r2Objects.set(key, { bytes, etag, httpMetadata: options?.httpMetadata });
      return bucket.get(key);
    },
  };

  const projects = new Map<string, ProjectRecord>();
  const saves = new Map<string, UserSaveRecord>();

  const store: CloudMetadataStore = {
    async verifyUserToken(token: string) {
      if (token === 'valid-alice-jwt') return { userId: 'user-alice' };
      if (token === 'valid-bob-jwt') return { userId: 'user-bob' };
      return null;
    },
    async getProjectBySlug(slug: string) {
      return projects.get(slug) ?? null;
    },
    async upsertProjectWithRevision(input) {
      const rec: ProjectRecord = {
        id: `proj_${input.slug}`,
        slug: input.slug,
        owner_id: input.ownerId,
        title: input.title,
        schema_version: input.schemaVersion,
        visibility: input.visibility,
        latest_r2_key: input.r2Key,
        cover_r2_key: input.coverR2Key ?? null,
        audio_manifest_r2_key: input.audioManifestR2Key ?? null,
        etag: input.etag,
        byte_size: input.byteSize,
        updated_at: new Date().toISOString(),
      };
      projects.set(input.slug, rec);
      return rec;
    },
    async getUserSave(userId: string, projectSlug: string) {
      return saves.get(`${userId}::${projectSlug}`) ?? null;
    },
    async upsertUserSave(userId, projectSlug, sram, updatedAtIso) {
      const rec: UserSaveRecord = {
        user_id: userId,
        project_slug: projectSlug,
        sram_jsonb: sram,
        updated_at: updatedAtIso,
      };
      saves.set(`${userId}::${projectSlug}`, rec);
      return rec;
    },
  };

  return {
    PIXER_ASSETS: bucket,
    PUBLIC_CDN_BASE_URL: 'https://cdn.pixer.app',
    ALLOWED_ORIGINS: 'https://xiaotommy65-cyber.github.io',
    MCP_ACCESS_TOKEN: 'secret-mcp-token',
    __TEST_STORE__: store,
  };
}

function makeEdgeClient(env: WorkerEnv): CloudSyncClient {
  return new CloudSyncClient({
    apiBaseUrl: 'https://api.pixer.test',
    fetchFn: (input, init) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      return handleEdgeRequest(req, env);
    },
  });
}

test('Cloud Offload Edge API: health probe, share slug validation & security rejections', async () => {
  assert.equal(isValidShareSlug('emerald-ruins-v1'), true);
  assert.equal(isValidShareSlug('../bad'), false);
  assert.equal(isValidShareSlug('UPPERCASE'), false);
  assert.equal(resolveShareSlugFromSearch('?mode=arcade&play=emerald-ruins-v1'), 'emerald-ruins-v1');
  assert.equal(resolveShareSlugFromSearch('?play=../etc/passwd'), null);

  const env = createMockCloudEnv();
  const healthResp = await handleEdgeRequest(new Request('https://api.pixer.test/api/health'), env);
  assert.equal(healthResp.status, 200);
  const health = (await healthResp.json()) as { ok: boolean; architecture: string };
  assert.equal(health.ok, true);
  assert.equal(health.architecture, 'cloudflare-r2-supabase-option-a');

  // Path traversal & malformed percent-encoding on R2 asset proxy must reject with 400
  const badAssetResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/assets/..%2F..%2Fsecrets.json'),
    env,
  );
  assert.equal(badAssetResp.status, 400);

  const malformedPctResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/assets/%E0%A4%A'),
    env,
  );
  assert.equal(malformedPctResp.status, 400);

  // Unauthenticated AI proxy call must reject with 401 (prevents LLM quota abuse)
  const unauthAiResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/ai/advise', { method: 'POST', body: '{}' }),
    env,
  );
  assert.equal(unauthAiResp.status, 401);

  // Authenticated but unconfigured AI proxy returns 503 so client cleanly falls back to local provider
  const aiResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/ai/advise', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-alice-jwt', 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env,
  );
  assert.equal(aiResp.status, 503);

  // Unexpected backend failure returns 500 JSON while preserving CORS headers
  const brokenEnv: WorkerEnv = {
    ...env,
    __TEST_STORE__: {
      ...env.__TEST_STORE__!,
      async getProjectBySlug() {
        throw new Error('simulated db outage');
      },
    },
  };
  const errResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/projects/emerald-ruins-demo', {
      headers: { Origin: 'https://xiaotommy65-cyber.github.io' },
    }),
    brokenEnv,
  );
  assert.equal(errResp.status, 500);
  assert.equal(errResp.headers.get('Access-Control-Allow-Origin'), 'https://xiaotommy65-cyber.github.io');
});

test('CloudSyncClient + Edge API: content-addressed R2 audio upload, immutable cache & ExternalAudioBank wiring', async () => {
  const env = createMockCloudEnv();
  const client = makeEdgeClient(env);

  // Unauthenticated upload must fail with 401
  const fakeOpus = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4]);
  const unauth = await client.uploadExternalAsset(fakeOpus, 'slash.opus');
  assert.equal(unauth.ok, false);

  // Authenticated upload stores content-addressed immutable asset in R2
  client.setAuthToken('valid-alice-jwt');
  const uploaded = await client.uploadExternalAsset(fakeOpus, 'slash.opus');
  assert.equal(uploaded.ok, true);
  assert.ok(uploaded.r2Key?.startsWith('assets/audio/'));
  assert.ok(uploaded.url?.startsWith('https://cdn.pixer.app/assets/audio/'));
  assert.equal(uploaded.sha256?.length, 64);

  // Reject disallowed file extensions (.exe / .html)
  const rejectedExt = await client.uploadExternalAsset(new Uint8Array([1, 2]), 'evil.html');
  assert.equal(rejectedExt.ok, false);

  // Serve back from Edge CDN proxy with immutable cache header
  const getResp = await handleEdgeRequest(
    new Request(`https://api.pixer.test/api/assets/${uploaded.r2Key}`),
    env,
  );
  assert.equal(getResp.status, 200);
  assert.equal(getResp.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(getResp.headers.get('Content-Type'), 'audio/ogg; codecs=opus');

  // Wire returned CDN URL cleanly into ExternalAudioBank
  const bank = new ExternalAudioBank();
  bank.loadManifest({ sfx: { jump: uploaded.url! } });
  assert.equal(bank.getManifest().sfx?.jump, uploaded.url);
  bank.destroy();
});

test('CloudSyncClient + Edge API: ETag optimistic lock publishing, audioManifest round-trip, 304 Not Modified, owner isolation & SRAM timestamp merge', async () => {
  const env = createMockCloudEnv();
  const alice = makeEdgeClient(env);
  alice.setAuthToken('valid-alice-jwt');

  // 0. Upload external audio manifest JSON to R2
  const manifestJson = JSON.stringify({
    baseUrl: 'https://cdn.pixer.app/assets/audio',
    sfx: { jump: 'slash.opus' },
  });
  const manifestUpload = await alice.uploadExternalAsset(new TextEncoder().encode(manifestJson), 'pack-v1.json');
  assert.equal(manifestUpload.ok, true);
  assert.ok(manifestUpload.r2Key?.startsWith('assets/manifests/'));

  // Reject unsafe audioManifestR2Key path traversal
  const badManifestPub = await alice.publishProject('emerald-ruins-demo', EMERALD_RUINS_PROJECT, {
    visibility: 'public',
    audioManifestR2Key: '../secrets/keys.json',
  });
  assert.equal(badManifestPub.ok, false);

  // 1. Alice publishes Emerald Ruins as public project linked to R2 audioManifest
  const pub1 = await alice.publishProject('emerald-ruins-demo', EMERALD_RUINS_PROJECT, {
    visibility: 'public',
    note: 'Initial M1 release',
    audioManifestR2Key: manifestUpload.r2Key,
  });
  assert.equal(pub1.ok, true);
  assert.equal(pub1.shareQuery, '?play=emerald-ruins-demo');
  assert.ok(pub1.etag && pub1.etag.length >= 16);

  // 2. Anonymous player fetches via ?play=emerald-ruins-demo + receives linked audioManifest + verifies 304 Not Modified
  const anon = makeEdgeClient(env);
  const fetched = await anon.fetchSharedProject('emerald-ruins-demo');
  assert.equal(fetched.ok, true);
  assert.equal(fetched.ok && !fetched.notModified && fetched.data.project.meta.code, 'PA-15');
  assert.equal(fetched.ok && !fetched.notModified && fetched.data.audioManifest?.sfx?.jump, 'slash.opus');

  const cached304 = await anon.fetchSharedProject('emerald-ruins-demo', pub1.etag);
  assert.equal(cached304.ok && cached304.notModified, true);

  // 3. Stale ETag update triggers 412 conflict; Bob cannot hijack Alice's slug (403)
  const conflict = await alice.publishProject('emerald-ruins-demo', OBSIDIAN_CITADEL_PROJECT, {
    expectedEtag: 'stale-etag-000',
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflictEtag, pub1.etag);

  const bob = makeEdgeClient(env);
  bob.setAuthToken('valid-bob-jwt');
  const hijack = await bob.publishProject('emerald-ruins-demo', OBSIDIAN_CITADEL_PROJECT);
  assert.equal(hijack.ok, false);

  // 4. Cross-device SRAM sync: newer cloud save wins over stale local save
  const s1 = await alice.syncCartridgeSram('cloudberry-hop', { stage: 3, stars: 9 }, '2026-11-22T12:00:00.000Z');
  assert.equal(s1.ok, true);
  assert.equal(s1.merged, 'local_applied');

  const stalePush = await alice.syncCartridgeSram('cloudberry-hop', { stage: 1, stars: 2 }, '2026-11-22T11:00:00.000Z');
  assert.equal(stalePush.ok, true);
  assert.equal(stalePush.merged, 'cloud_newer');
  assert.deepEqual(stalePush.sram, { stage: 3, stars: 9 });
});

test('Edge Remote Streamable HTTP MCP (/api/mcp) enforces Bearer auth, private slug isolation, and executes tools/call', async () => {
  const env = createMockCloudEnv();

  const unauthResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
    env,
  );
  assert.equal(unauthResp.status, 401);

  const okResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-mcp-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'describe_editor_grammar', arguments: {} },
      }),
    }),
    env,
  );
  assert.equal(okResp.status, 200);
  const rpc = (await okResp.json()) as {
    jsonrpc: string;
    id: number;
    result?: { isError?: boolean; structuredContent?: { commands?: unknown[] } };
  };
  assert.equal(rpc.jsonrpc, '2.0');
  assert.equal(rpc.id, 7);
  assert.equal(rpc.result?.isError, false);
  assert.ok((rpc.result?.structuredContent?.commands?.length ?? 0) >= 25);

  // Private project slug must not be loaded by unowned MCP ?slug= query
  const alice = makeEdgeClient(env);
  alice.setAuthToken('valid-alice-jwt');
  const privPub = await alice.publishProject('private-secret-demo', EMERALD_RUINS_PROJECT, {
    visibility: 'private',
  });
  assert.equal(privPub.ok, true);

  const privMcpResp = await handleEdgeRequest(
    new Request('https://api.pixer.test/api/mcp?slug=private-secret-demo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-mcp-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'export_project_json', arguments: {} },
      }),
    }),
    env,
  );
  assert.equal(privMcpResp.status, 200);
  const privRpc = (await privMcpResp.json()) as {
    result?: { structuredContent?: { project?: { meta?: { code?: string } } } };
  };
  assert.equal(privRpc.result?.structuredContent?.project?.meta?.code, 'PA-14');
});
