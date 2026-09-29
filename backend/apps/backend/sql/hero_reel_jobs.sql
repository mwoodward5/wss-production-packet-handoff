-- Durable serverless-to-worker hand-off for Seedance/WAN/Ads hero-reel generation.
-- Apply before deploying code that calls /api/admin/hero-reel?next=1.

create table if not exists public.ghost_agency_hero_reel_jobs (
  id bigint generated always as identity primary key,
  job_id text not null unique,
  -- One durable job per prospect. Repeated build hooks return this row rather
  -- than starting another paid generation or racing another worker.
  prospect_id text not null unique,
  producer text not null default 'openrouter_seedance',
  status text not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ghost_agency_hero_reel_jobs_producer_check check (
    producer in ('wan2_i2v_local', 'ads_image_to_video', 'openrouter_seedance')
  ),
  constraint ghost_agency_hero_reel_jobs_status_check check (
    status in ('queued', 'running', 'awaiting_review', 'done', 'refused', 'failed')
  ),
  constraint ghost_agency_hero_reel_jobs_lease_complete check (
    (
      status = 'running'
      and lease_token is not null
      and lease_owner is not null
      and lease_expires_at is not null
    )
    or (
      status <> 'running'
      and lease_token is null
      and lease_owner is null
      and lease_expires_at is null
    )
  )
);

-- CREATE TABLE IF NOT EXISTS does not update the producer contract on an
-- existing deployment. This exact, transaction-wrapped migration keeps all
-- existing Ads/WAN rows valid, admits Seedance rows, then makes Seedance the
-- defensive DB
-- default. NOT VALID shortens the initial constraint lock; validation still
-- proves every existing row before the apply transaction commits.
alter table public.ghost_agency_hero_reel_jobs
  drop constraint if exists ghost_agency_hero_reel_jobs_producer_check;
alter table public.ghost_agency_hero_reel_jobs
  add constraint ghost_agency_hero_reel_jobs_producer_check
  check (producer in ('wan2_i2v_local', 'ads_image_to_video', 'openrouter_seedance')) not valid;
alter table public.ghost_agency_hero_reel_jobs
  validate constraint ghost_agency_hero_reel_jobs_producer_check;
alter table public.ghost_agency_hero_reel_jobs
  alter column producer set default 'openrouter_seedance';

create index if not exists ghost_agency_hero_reel_jobs_claim_idx
  on public.ghost_agency_hero_reel_jobs (status, created_at)
  where status = 'queued';

create index if not exists ghost_agency_hero_reel_jobs_lease_expiry_idx
  on public.ghost_agency_hero_reel_jobs (lease_expires_at)
  where status = 'running';

alter table public.ghost_agency_hero_reel_jobs enable row level security;

revoke all on table public.ghost_agency_hero_reel_jobs from public, anon, authenticated;
revoke all on table public.ghost_agency_hero_reel_jobs from service_role;
grant select, insert, update on table public.ghost_agency_hero_reel_jobs to service_role;

-- Identity sequence privileges are explicit because this table is reached via
-- PostgREST with the server-only service role.
revoke all on sequence public.ghost_agency_hero_reel_jobs_id_seq from public, anon, authenticated;
revoke all on sequence public.ghost_agency_hero_reel_jobs_id_seq from service_role;
grant usage, select on sequence public.ghost_agency_hero_reel_jobs_id_seq to service_role;

comment on table public.ghost_agency_hero_reel_jobs is
  'Service-role-only durable leases for Seedance, WAN, or Ads hero-reel generation; contains no contact PII.';
