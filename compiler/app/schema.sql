-- SiteForge SaaS — production schema (Postgres / Supabase / Lovable Cloud).
-- Mirrors app/lib/store.mjs exactly; the JSON store is the dev/runner twin.
-- Per repo stack rules (§9): every public table gets GRANTs + RLS + policies.
-- Roles live in user_roles with a security-definer has_role(), never on profiles.

create extension if not exists pgcrypto;

-- ---------- identity ----------
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  avatar_url    text,
  auth_provider text not null default 'email',
  plan          text not null default 'free',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role    text not null check (role in ('admin','operator','customer')),
  unique (user_id, role)
);

create or replace function public.has_role(_user uuid, _role text)
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.user_roles where user_id = _user and role = _role) $$;

-- ---------- projects ----------
create table public.site_projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  name          text not null,
  slug          text unique not null,
  status        text not null default 'draft'
                check (status in ('draft','discovery_ready','generating','preview_ready','published','deleted')),
  goal          text not null default 'calls'
                check (goal in ('calls','quotes','bookings','ecommerce','portfolio')),
  city          text, state text, industry text,
  hero_family   text,
  last_grade    text,
  deploy_url    text,
  custom_domain text,
  report_token  text unique,
  lead_token    text unique,
  discovery     jsonb,
  next_version  int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.site_projects (user_id, created_at desc);

create table public.business_profiles (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.site_projects(id) on delete cascade,
  business_name text not null,
  industry      text, city text, state text,
  phone         text, website text, gbp_url text,
  services      text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.business_profiles (project_id);

create table public.business_assets (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.site_projects(id) on delete cascade,
  kind       text not null check (kind in ('logo','color','photo','video','service','review','contact','social','citation','map','screenshot')),
  url        text,
  label      text,
  meta       jsonb not null default '{}',
  source     text,                      -- firecrawl | gbp | user | fixture | manual
  origin     text not null default 'discovery' check (origin in ('discovery','manual')),
  approved   boolean not null default true,
  stale      boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.business_assets (project_id, stale);

-- ---------- generation ----------
create table public.site_generations (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.site_projects(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  version           int not null,
  build_type        text not null default 'single_page_cinematic'
                    check (build_type in ('single_page_cinematic','premier_multi_page','service_landing_page','offer_page')),
  hero_family       text,
  prompt            text,
  sections_disabled text[] not null default '{}',
  regen_target      text,               -- null | hero | copy | gallery | map
  status            text not null default 'running' check (status in ('running','done','failed')),
  qc_grade          text,
  site_dir          text,               -- storage path / bucket key of the built bundle
  demo              boolean not null default true,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (project_id, version)
);
create index on public.site_generations (user_id, created_at desc);

create table public.site_qc_reports (
  id            uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.site_generations(id) on delete cascade,
  project_id    uuid not null references public.site_projects(id) on delete cascade,
  grade         text not null,
  score         int,
  degraded      boolean not null default false, -- browser checks deferred (no chromium on runner)
  results       jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

create table public.deployments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.site_projects(id) on delete cascade,
  generation_id uuid references public.site_generations(id) on delete set null,
  target        text not null check (target in ('siteforge-local','vercel','custom-domain')),
  url           text,
  status        text not null default 'live' check (status in ('live','dns_pending','verification_pending','failed','superseded')),
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index on public.deployments (project_id, created_at desc);

-- ---------- billing ----------
create table public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  plan_key               text not null,
  status                 text not null check (status in ('active','trialing','canceled','replaced','past_due')),
  stripe_subscription_id text,
  stripe_customer_id     text,
  current_period_end     timestamptz,
  mode                   text not null default 'stripe-test',   -- stripe-test | stripe-live | mock
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index on public.subscriptions (user_id, status);

create table public.entitlements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null check (kind in ('addon','one_time')),
  key        text not null,             -- voice_ai | seo_boost | ai_concierge | build | build_pro
  active     boolean not null default true,
  source_ref text,
  mode       text not null default 'stripe-test',
  created_at timestamptz not null default now()
);
create index on public.entitlements (user_id, active);

create table public.webhook_events (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,       -- checkout_intent | stripe_event
  stripe_event_id  text unique,
  stripe_session_id text,
  type             text,
  user_id          uuid references public.users(id) on delete set null,
  item_kind        text, item_key text, project_id uuid,
  status           text default 'created',
  granted_at       timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------- ops ----------
create table public.edit_requests (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.site_projects(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  message    text not null,
  status     text not null default 'open' check (status in ('open','in_progress','done','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  action        text not null,
  subject       text,
  meta          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index on public.audit_logs (actor_user_id, created_at desc);

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,          -- generate | try
  user_id       uuid references public.users(id) on delete cascade,
  project_id    uuid references public.site_projects(id) on delete cascade,
  generation_id uuid,
  status        text not null default 'queued' check (status in ('queued','running','done','failed')),
  result        jsonb, error text,
  started_at    timestamptz, finished_at timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.jobs (status, created_at);

-- ---------- flagship growth + studio ----------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.site_projects(id) on delete cascade,
  source text not null default 'website', status text not null default 'new',
  name text, phone text, email text, message text, summary text, meta jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.leads (user_id, created_at desc);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.site_projects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  channel text not null default 'sms', source text not null default 'connector', status text not null default 'queued',
  name text, rating numeric, text text, attributed_text text, external_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.review_requests (user_id, created_at desc);

create table public.rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.site_projects(id) on delete cascade,
  query text, keyword text not null, provider text, source text not null default 'connector',
  position integer, change numeric, cited_count integer,
  observed_at timestamptz not null default now(), meta jsonb not null default '{}'
);
create index on public.rank_snapshots (user_id, observed_at desc);

create table public.client_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null, slug text not null, status text not null default 'active',
  brand jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid references public.client_workspaces(id) on delete cascade,
  name text not null, prefix text not null, secret_hash text not null unique,
  scopes text[] not null default array['forge:write','jobs:read'],
  last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid references public.client_workspaces(id) on delete cascade,
  event_type text not null, target_url text not null, status text not null default 'queued',
  attempt_count integer not null default 0, response_status integer, next_attempt_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.failed_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid not null references public.site_projects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  channel text not null, status text not null default 'queued',
  attempt_count integer not null default 0, response_status integer,
  error_code text not null default 'notification_failed',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.failed_leads (user_id, created_at desc);

-- ---------- grants + RLS (no exceptions) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.site_projects, public.deployments to anon;  -- published-site lookups only via views in practice

alter table public.users             enable row level security;
alter table public.user_roles        enable row level security;
alter table public.site_projects     enable row level security;
alter table public.business_profiles enable row level security;
alter table public.business_assets   enable row level security;
alter table public.site_generations  enable row level security;
alter table public.site_qc_reports   enable row level security;
alter table public.deployments       enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.entitlements      enable row level security;
alter table public.webhook_events    enable row level security;
alter table public.edit_requests     enable row level security;
alter table public.audit_logs        enable row level security;
alter table public.jobs              enable row level security;
alter table public.leads             enable row level security;
alter table public.review_requests   enable row level security;
alter table public.rank_snapshots    enable row level security;
alter table public.client_workspaces enable row level security;
alter table public.api_keys          enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.failed_leads       enable row level security;

create policy "own user"        on public.users             for all    using (id = auth.uid());
create policy "read own roles"  on public.user_roles        for select using (user_id = auth.uid() or has_role(auth.uid(),'admin'));
create policy "own projects"    on public.site_projects     for all    using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own profiles"    on public.business_profiles for all    using (exists (select 1 from public.site_projects p where p.id = project_id and (p.user_id = auth.uid() or has_role(auth.uid(),'operator'))));
create policy "own assets"      on public.business_assets   for all    using (exists (select 1 from public.site_projects p where p.id = project_id and (p.user_id = auth.uid() or has_role(auth.uid(),'operator'))));
create policy "own generations" on public.site_generations  for all    using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own qc"          on public.site_qc_reports   for select using (exists (select 1 from public.site_projects p where p.id = project_id and (p.user_id = auth.uid() or has_role(auth.uid(),'operator'))));
create policy "own deployments" on public.deployments       for select using (exists (select 1 from public.site_projects p where p.id = project_id and (p.user_id = auth.uid() or has_role(auth.uid(),'operator'))));
create policy "own subs"        on public.subscriptions     for select using (user_id = auth.uid());
create policy "own entitlements" on public.entitlements     for select using (user_id = auth.uid());
create policy "own webhooks"    on public.webhook_events    for select using (user_id = auth.uid() or has_role(auth.uid(),'admin'));
create policy "own edits"       on public.edit_requests     for all    using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own audit"       on public.audit_logs        for select using (actor_user_id = auth.uid() or has_role(auth.uid(),'admin'));
create policy "own jobs"        on public.jobs              for select using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own leads"       on public.leads             for all using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own review requests" on public.review_requests for all using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own rank snapshots" on public.rank_snapshots for all using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own client workspaces" on public.client_workspaces for all using (user_id = auth.uid() or has_role(auth.uid(),'operator'));
create policy "own api keys"    on public.api_keys          for all using (user_id = auth.uid() or has_role(auth.uid(),'admin'));
create policy "own webhook deliveries" on public.webhook_deliveries for select using (user_id = auth.uid() or has_role(auth.uid(),'admin'));
create policy "own failed leads" on public.failed_leads for select using (user_id = auth.uid() or has_role(auth.uid(),'admin'));

-- Server-side writes (webhooks, forge runner) use the service role via
-- verified endpoints only. Magic tokens + sessions are handled by Supabase
-- Auth in production (this app's cookie sessions are the self-hosted twin).
