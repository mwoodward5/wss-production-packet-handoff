-- The durable rebuild queue behind /api/admin/rebuild-mirror (see
-- lib/rebuild-jobs.js). Same shape and claim discipline as
-- ghost_agency_edit_jobs, plus an attempts counter for the stale sweeper.
create table if not exists public.ghost_agency_rebuild_jobs (
  id bigint generated always as identity primary key,
  job_id text not null unique,
  prospect_id text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ghost_agency_rebuild_jobs enable row level security;
