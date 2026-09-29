create extension if not exists pgcrypto;

create table if not exists public.consent_registrar (
  id uuid primary key default gen_random_uuid(),
  consent_key text unique,
  report_id text,
  prospect_id text,
  business text,
  email text,
  phone text,
  consent_to_call boolean not null default false,
  consent_to_text boolean not null default false,
  source text not null default 'unknown',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hot_leads (
  id uuid primary key default gen_random_uuid(),
  report_id text not null unique,
  prospect_id text,
  business text,
  business_name text,
  owner_name text,
  owner_email text,
  email text,
  phone text,
  report_url text,
  source text not null default 'callprep_report_open',
  status text not null default 'hot_lead_consent_blocked',
  opened_count integer not null default 1,
  last_opened_at timestamptz not null default now(),
  consent_to_call boolean not null default false,
  consent_to_text boolean not null default false,
  consent_source text,
  call_now_enabled boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consent_registrar_report_idx
  on public.consent_registrar (report_id, updated_at desc);

create index if not exists consent_registrar_prospect_idx
  on public.consent_registrar (prospect_id, updated_at desc);

create index if not exists consent_registrar_phone_idx
  on public.consent_registrar (phone, updated_at desc);

create index if not exists consent_registrar_email_idx
  on public.consent_registrar (email, updated_at desc);

create index if not exists hot_leads_last_opened_idx
  on public.hot_leads (last_opened_at desc);

create index if not exists hot_leads_status_idx
  on public.hot_leads (status, last_opened_at desc);

alter table public.consent_registrar enable row level security;
alter table public.hot_leads enable row level security;

grant select, insert, update, delete on table public.consent_registrar to service_role;
grant select, insert, update, delete on table public.hot_leads to service_role;
