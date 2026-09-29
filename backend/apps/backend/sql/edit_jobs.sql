create table if not exists public.ghost_agency_edit_jobs (
  id bigint generated always as identity primary key,
  job_id text not null unique,
  site_slug text not null,
  instruction text not null,
  status text not null default 'queued',
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ghost_agency_edit_jobs enable row level security;
