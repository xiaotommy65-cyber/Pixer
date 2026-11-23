export interface R2ObjectLike {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
      customMetadata?: Record<string, string>;
    },
  ): Promise<R2ObjectLike | null>;
}

export interface ProjectRecord {
  id: string;
  slug: string;
  owner_id: string;
  title: string;
  schema_version: number;
  visibility: 'private' | 'unlisted' | 'public';
  latest_r2_key: string;
  cover_r2_key?: string | null;
  audio_manifest_r2_key?: string | null;
  etag: string;
  byte_size: number;
  updated_at: string;
}

export interface UserSaveRecord {
  user_id: string;
  project_slug: string;
  sram_jsonb: unknown;
  updated_at: string;
}

export interface CloudMetadataStore {
  verifyUserToken(bearerToken: string): Promise<{ userId: string } | null>;
  getProjectBySlug(slug: string): Promise<ProjectRecord | null>;
  upsertProjectWithRevision(input: {
    slug: string;
    ownerId: string;
    title: string;
    schemaVersion: number;
    visibility: 'private' | 'unlisted' | 'public';
    r2Key: string;
    coverR2Key?: string | null;
    audioManifestR2Key?: string | null;
    etag: string;
    sha256: string;
    byteSize: number;
    note?: string;
  }): Promise<ProjectRecord>;
  getUserSave(userId: string, projectSlug: string): Promise<UserSaveRecord | null>;
  upsertUserSave(userId: string, projectSlug: string, sram: unknown, updatedAtIso: string): Promise<UserSaveRecord>;
}

export interface WorkerEnv {
  PIXER_ASSETS: R2BucketLike;
  PUBLIC_CDN_BASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  AI_PROVIDER_API_KEY?: string;
  AI_PROVIDER_BASE_URL?: string;
  MCP_ACCESS_TOKEN?: string;
  /** Optional injected metadata store for deterministic local unit testing. */
  __TEST_STORE__?: CloudMetadataStore;
}
