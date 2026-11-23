---
trigger: glob
globs: "workers/**, supabase/**, src/core/cloud/**"
description: Edge Worker, Cloudflare R2 CDN, and Supabase PostgreSQL/RLS security and runtime boundaries.
---
# Cloud Edge & Supabase Rules
- **Web Standards Only in Workers**: `workers/api/src/` runs on Cloudflare Workers — use Web Standard APIs (`fetch`, `crypto.subtle`, `Request`, `Response`) and pure `src/core/*` imports ONLY. NEVER import Node-only built-ins (`node:fs`, `node:path`) or browser DOM globals.
- **Secret & Auth Isolation**: NEVER expose `SUPABASE_SERVICE_ROLE_KEY` or `MCP_ACCESS_TOKEN` to `src/ui/` or browser bundles. Use constant-time token checks and verify user JWTs before privileged writes.
- **Storage & Concurrency Safety**: Preserve path-traversal guards on `/api/assets/:key+`, ETag `If-Match` 412 optimistic locking on project writes, and strict Supabase RLS policies.
- **Pure Cloud Client**: Keep `src/core/cloud/CloudSyncClient.ts` 100% DOM-free and verifiable via `scripts/sim/CloudOffload.test.ts`.
