create extension if not exists pgcrypto;

create table if not exists public.ghost_agency_suppressions (
  id uuid primary key default gen_random_uuid(),
  suppression_key text not null unique,
  email text,
  prospect_id text,
  reason text not null default 'unsubscribe',
  source text not null default 'unknown',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null unique,
  order_id text not null,
  customer_email text,
  kind text not null default 'other',
  request_text text not null,
  state text not null default 'open',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_consents (
  id uuid primary key default gen_random_uuid(),
  prospect_id text,
  email text,
  phone text,
  channel text not null,
  state text not null default 'unknown',
  source text not null default 'unknown',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ghost_agency_suppressions_email_idx
  on public.ghost_agency_suppressions (email);

create index if not exists ghost_agency_suppressions_prospect_idx
  on public.ghost_agency_suppressions (prospect_id);

create index if not exists ghost_agency_support_tickets_order_idx
  on public.ghost_agency_support_tickets (order_id, updated_at desc);

create index if not exists ghost_agency_support_tickets_state_idx
  on public.ghost_agency_support_tickets (state, updated_at desc);

create index if not exists ghost_agency_consents_prospect_idx
  on public.ghost_agency_consents (prospect_id, channel, updated_at desc);

alter table public.ghost_agency_suppressions enable row level security;
alter table public.ghost_agency_support_tickets enable row level security;
alter table public.ghost_agency_consents enable row level security;

revoke all on table public.ghost_agency_suppressions from anon, authenticated;
revoke all on table public.ghost_agency_support_tickets from anon, authenticated;
revoke all on table public.ghost_agency_consents from anon, authenticated;

grant select, insert, update, delete on table public.ghost_agency_suppressions to service_role;
grant select, insert, update, delete on table public.ghost_agency_support_tickets to service_role;
grant select, insert, update, delete on table public.ghost_agency_consents to service_role;
