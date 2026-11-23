-- Pixer Cloud Offload Schema (Option A: Supabase PostgreSQL + Auth + RLS + Cloudflare R2)
-- Run via `supabase db push` or Supabase SQL Editor.

create extension if not exists pgcrypto;

-- 1. Creator Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique check (handle ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Published & Draft ECS Projects (JSON payload stored in Cloudflare R2)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  schema_version integer not null default 2 check (schema_version >= 1),
  visibility text not null default 'unlisted' check (visibility in ('private', 'unlisted', 'public')),
  latest_r2_key text not null,
  cover_r2_key text,
  audio_manifest_r2_key text,
  etag text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_owner_updated on public.projects (owner_id, updated_at desc);
create index if not exists idx_projects_public_updated on public.projects (visibility, updated_at desc);

-- 3. Immutable Project Revisions (1-click rollback & audit history)
create table if not exists public.project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  r2_key text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_project_revisions_project_created
  on public.project_revisions (project_id, created_at desc);

-- 4. Cross-Device User SRAM Cloud Saves
create table if not exists public.user_saves (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_slug text not null check (project_slug ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  sram_jsonb jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_slug)
);

-- Automatic updated_at maintenance trigger
create or replace function public.pixer_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.pixer_touch_updated_at();

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch
  before update on public.projects
  for each row execute function public.pixer_touch_updated_at();

-- Strict Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_revisions enable row level security;
alter table public.user_saves enable row level security;

-- Profiles policies
create policy "profiles_public_read" on public.profiles
  for select using (true);
create policy "profiles_owner_write" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Projects policies (public & unlisted readable for /play/:slug; private restricted to owner)
create policy "projects_select_visible" on public.projects
  for select using (visibility in ('public', 'unlisted') or auth.uid() = owner_id);
create policy "projects_owner_insert" on public.projects
  for insert with check (auth.uid() = owner_id);
create policy "projects_owner_update" on public.projects
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "projects_owner_delete" on public.projects
  for delete using (auth.uid() = owner_id);

-- Revisions policies
create policy "revisions_select_visible" on public.project_revisions
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_revisions.project_id
        and (p.visibility in ('public', 'unlisted') or p.owner_id = auth.uid())
    )
  );
create policy "revisions_owner_insert" on public.project_revisions
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_revisions.project_id
        and p.owner_id = auth.uid()
    )
  );

-- User SRAM saves policies (strictly private per user)
create policy "user_saves_owner_all" on public.user_saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
