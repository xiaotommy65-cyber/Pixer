import type { CloudMetadataStore, ProjectRecord, UserSaveRecord, WorkerEnv } from './types.ts';

/**
 * Zero-dependency Supabase PostgREST + GoTrue Auth client for Cloudflare Workers.
 * Uses standard Web `fetch` with strict server-side service role isolation.
 */
export function createSupabaseMetadataStore(env: WorkerEnv): CloudMetadataStore {
  if (env.__TEST_STORE__) return env.__TEST_STORE__;

  const baseUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY ?? '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  const ensureConfigured = () => {
    if (!baseUrl || !serviceKey) {
      throw new Error('Supabase backend is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
    }
  };

  const restHeaders = (prefer?: string): Record<string, string> => ({
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  });

  return {
    async verifyUserToken(bearerToken: string): Promise<{ userId: string } | null> {
      if (!baseUrl || !anonKey || !bearerToken) return null;
      try {
        const resp = await fetch(`${baseUrl}/auth/v1/user`, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${bearerToken}`,
          },
        });
        if (!resp.ok) return null;
        const user = (await resp.json()) as { id?: string };
        return typeof user.id === 'string' && user.id.length > 0 ? { userId: user.id } : null;
      } catch {
        return null;
      }
    },

    async getProjectBySlug(slug: string): Promise<ProjectRecord | null> {
      ensureConfigured();
      const url = `${baseUrl}/rest/v1/projects?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`;
      const resp = await fetch(url, { headers: restHeaders() });
      if (!resp.ok) throw new Error(`Supabase getProjectBySlug failed: HTTP ${resp.status}`);
      const rows = (await resp.json()) as ProjectRecord[];
      return rows[0] ?? null;
    },

    async upsertProjectWithRevision(input): Promise<ProjectRecord> {
      ensureConfigured();
      const upsertResp = await fetch(`${baseUrl}/rest/v1/projects?on_conflict=slug`, {
        method: 'POST',
        headers: restHeaders('resolution=merge-duplicates,return=representation'),
        body: JSON.stringify({
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
        }),
      });
      if (!upsertResp.ok) {
        throw new Error(`Supabase upsertProject failed: HTTP ${upsertResp.status}`);
      }
      const rows = (await upsertResp.json()) as ProjectRecord[];
      const saved = rows[0];
      if (!saved) throw new Error('Supabase upsertProject returned empty representation');

      // Append immutable revision audit entry
      const revResp = await fetch(`${baseUrl}/rest/v1/project_revisions`, {
        method: 'POST',
        headers: restHeaders('return=minimal'),
        body: JSON.stringify({
          project_id: saved.id,
          r2_key: input.r2Key,
          sha256: input.sha256,
          byte_size: input.byteSize,
          note: input.note ?? '',
        }),
      });
      if (!revResp.ok) {
        throw new Error(`Supabase insert project_revisions failed: HTTP ${revResp.status}`);
      }

      return saved;
    },

    async getUserSave(userId: string, projectSlug: string): Promise<UserSaveRecord | null> {
      ensureConfigured();
      const url =
        `${baseUrl}/rest/v1/user_saves?user_id=eq.${encodeURIComponent(userId)}` +
        `&project_slug=eq.${encodeURIComponent(projectSlug)}&select=*&limit=1`;
      const resp = await fetch(url, { headers: restHeaders() });
      if (!resp.ok) throw new Error(`Supabase getUserSave failed: HTTP ${resp.status}`);
      const rows = (await resp.json()) as UserSaveRecord[];
      return rows[0] ?? null;
    },

    async upsertUserSave(userId, projectSlug, sram, updatedAtIso): Promise<UserSaveRecord> {
      ensureConfigured();
      const resp = await fetch(`${baseUrl}/rest/v1/user_saves?on_conflict=user_id,project_slug`, {
        method: 'POST',
        headers: restHeaders('resolution=merge-duplicates,return=representation'),
        body: JSON.stringify({
          user_id: userId,
          project_slug: projectSlug,
          sram_jsonb: sram,
          updated_at: updatedAtIso,
        }),
      });
      if (!resp.ok) throw new Error(`Supabase upsertUserSave failed: HTTP ${resp.status}`);
      const rows = (await resp.json()) as UserSaveRecord[];
      if (!rows[0]) throw new Error('Supabase upsertUserSave returned empty representation');
      return rows[0];
    },
  };
}
