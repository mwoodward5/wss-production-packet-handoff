-- Domain purchase fulfillment log (lib/domains.js).
-- Every attempted domain purchase (dry-run or live) writes one row here.
create table if not exists public.ghost_agency_domain_orders (
  id bigint generated always as identity primary key,
  job_id text not null,
  domain text not null,
  dry_run boolean not null default true,
  status text not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  unique (job_id, domain)
);
alter table public.ghost_agency_domain_orders enable row level security;
-- service-role only; no anon policies on purpose.
