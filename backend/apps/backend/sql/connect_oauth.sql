-- WSS Connect real OAuth: CSRF state + connected-account storage.
-- Apply via Supabase SQL editor (same manual pattern as sql/connect_inbox.sql,
-- sql/edit_jobs.sql, etc. — this project has no automatic migration runner).

create table if not exists public.connect_oauth_states (
  state text primary key,
  platform text not null,
  site_slug text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists connect_oauth_states_expires_idx on public.connect_oauth_states(expires_at);

-- Added for the X (Twitter) and TikTok connectors, which use OAuth 2.0 PKCE:
-- the server-generated code_verifier is stashed here alongside the CSRF
-- state and reused at the callback. Nullable/unused by the Meta and
-- LinkedIn connectors, which don't need PKCE.
alter table public.connect_oauth_states add column if not exists code_verifier text;

create table if not exists public.connect_connectors (
  id bigint generated always as identity primary key,
  site_slug text not null,
  platform text not null,
  is_active boolean not null default true,
  account_name text,
  platform_user_id text,
  access_token text,
  token_expires_at timestamptz,
  metadata jsonb,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_slug, platform)
);

alter table public.connect_oauth_states enable row level security;
alter table public.connect_connectors enable row level security;
