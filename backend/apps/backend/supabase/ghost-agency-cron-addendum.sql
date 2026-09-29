create extension if not exists pgcrypto;

alter table if exists public.ghost_agency_prospects
  add column if not exists preview_expires_at timestamptz;

create table if not exists public.ghost_agency_prospects (
  id uuid primary key default gen_random_uuid(),
  prospect_id text not null unique,
  status text not null default 'new',
  business_name text,
  owner_name text,
  email text,
  owner_email text,
  phone text,
  current_website text,
  industry text,
  city text,
  state text,
  country text not null default 'US',
  primary_services text[] not null default '{}'::text[],
  leadminer_score numeric,
  report_url text,
  preview_url text,
  preview_expires_at timestamptz,
  consent_to_call boolean not null default false,
  consent_to_text boolean not null default false,
  source text,
  record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_email_log (
  id uuid primary key default gen_random_uuid(),
  prospect_id text not null,
  sequence integer not null,
  step integer not null,
  sent_at timestamptz not null default now(),
  suppressed boolean not null default false,
  mode text,
  payload jsonb not null default '{}'::jsonb,
  unique (prospect_id, sequence, step)
);

create table if not exists public.ghost_agency_reports (
  id uuid primary key default gen_random_uuid(),
  prospect_id text not null,
  report_url text,
  status text not null default 'created',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_site_packets (
  id uuid primary key default gen_random_uuid(),
  prospect_id text not null,
  packet_id text,
  preview_url text,
  status text not null default 'created',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_outreach (
  id uuid primary key default gen_random_uuid(),
  prospect_id text not null,
  channel text not null,
  status text not null default 'queued',
  consent_state text not null default 'unknown',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ghost_agency_prospects_status_updated_idx
  on public.ghost_agency_prospects (status, updated_at);

create index if not exists ghost_agency_prospects_score_idx
  on public.ghost_agency_prospects (leadminer_score desc nulls last);

create index if not exists ghost_agency_email_log_prospect_idx
  on public.ghost_agency_email_log (prospect_id, sent_at desc);

create index if not exists ghost_agency_reports_prospect_idx
  on public.ghost_agency_reports (prospect_id, updated_at desc);

create index if not exists ghost_agency_site_packets_prospect_idx
  on public.ghost_agency_site_packets (prospect_id, updated_at desc);

create index if not exists ghost_agency_outreach_prospect_idx
  on public.ghost_agency_outreach (prospect_id, updated_at desc);

alter table public.ghost_agency_prospects enable row level security;
alter table public.ghost_agency_email_log enable row level security;
alter table public.ghost_agency_reports enable row level security;
alter table public.ghost_agency_site_packets enable row level security;
alter table public.ghost_agency_outreach enable row level security;

revoke all on table public.ghost_agency_prospects from anon, authenticated;
revoke all on table public.ghost_agency_email_log from anon, authenticated;
revoke all on table public.ghost_agency_reports from anon, authenticated;
revoke all on table public.ghost_agency_site_packets from anon, authenticated;
revoke all on table public.ghost_agency_outreach from anon, authenticated;

grant select, insert, update, delete on table public.ghost_agency_prospects to service_role;
grant select, insert, update, delete on table public.ghost_agency_email_log to service_role;
grant select, insert, update, delete on table public.ghost_agency_reports to service_role;
grant select, insert, update, delete on table public.ghost_agency_site_packets to service_role;
grant select, insert, update, delete on table public.ghost_agency_outreach to service_role;
