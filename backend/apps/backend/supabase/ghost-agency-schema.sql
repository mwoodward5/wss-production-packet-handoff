create extension if not exists pgcrypto;

create table if not exists public.ghost_agency_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  svix_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ghost_agency_events
  add column if not exists svix_id text;

create table if not exists public.ghost_agency_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  business_name text,
  owner_email text,
  status text not null default 'created',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  stripe_session_id text not null unique,
  checkout_url text,
  status text not null default 'created',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_orders (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text,
  stripe_session_id text not null unique,
  stripe_subscription_id text,
  job_id text not null,
  customer_email text,
  amount_total integer,
  currency text not null default 'usd',
  status text not null default 'paid_checkout_completed',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ghost_agency_entitlements (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  stripe_session_id text,
  stripe_subscription_id text,
  customer_email text,
  product text not null,
  entitlement text not null,
  status text not null default 'active_pending_delivery',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, product)
);

create table if not exists public.ghost_agency_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  stripe_session_id text,
  delivery_type text not null,
  status text not null default 'handoff_packet_ready',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, delivery_type)
);

create index if not exists ghost_agency_events_created_at_idx
  on public.ghost_agency_events (created_at desc);

create unique index if not exists ghost_agency_events_svix_id_unique_idx
  on public.ghost_agency_events (svix_id)
  where svix_id is not null;

create index if not exists ghost_agency_jobs_updated_at_idx
  on public.ghost_agency_jobs (updated_at desc);

create index if not exists ghost_agency_orders_updated_at_idx
  on public.ghost_agency_orders (updated_at desc);

create index if not exists ghost_agency_entitlements_updated_at_idx
  on public.ghost_agency_entitlements (updated_at desc);

create index if not exists ghost_agency_delivery_queue_updated_at_idx
  on public.ghost_agency_delivery_queue (updated_at desc);

alter table public.ghost_agency_events enable row level security;
alter table public.ghost_agency_jobs enable row level security;
alter table public.ghost_agency_checkout_sessions enable row level security;
alter table public.ghost_agency_orders enable row level security;
alter table public.ghost_agency_entitlements enable row level security;
alter table public.ghost_agency_delivery_queue enable row level security;

revoke all on table public.ghost_agency_events from anon, authenticated;
revoke all on table public.ghost_agency_jobs from anon, authenticated;
revoke all on table public.ghost_agency_checkout_sessions from anon, authenticated;
revoke all on table public.ghost_agency_orders from anon, authenticated;
revoke all on table public.ghost_agency_entitlements from anon, authenticated;
revoke all on table public.ghost_agency_delivery_queue from anon, authenticated;

grant select, insert, update, delete on table public.ghost_agency_events to service_role;
grant select, insert, update, delete on table public.ghost_agency_jobs to service_role;
grant select, insert, update, delete on table public.ghost_agency_checkout_sessions to service_role;
grant select, insert, update, delete on table public.ghost_agency_orders to service_role;
grant select, insert, update, delete on table public.ghost_agency_entitlements to service_role;
grant select, insert, update, delete on table public.ghost_agency_delivery_queue to service_role;
