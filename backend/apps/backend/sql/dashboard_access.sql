-- Per-customer dashboard access, issued once at Stripe checkout fulfillment.
-- See apps/backend/lib/dashboard-link.js and apps/backend/lib/fulfillment.js.

create table if not exists public.ghost_agency_dashboard_access (
  job_id text primary key,
  owner_email text not null,
  business_name text,
  site_slug text,
  visibility_business text,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Additive for any environment where the table already exists.
alter table public.ghost_agency_dashboard_access add column if not exists site_slug text;
alter table public.ghost_agency_dashboard_access add column if not exists visibility_business text;

create index if not exists ghost_agency_dashboard_access_site_idx
  on public.ghost_agency_dashboard_access (site_slug);

create index if not exists ghost_agency_dashboard_access_email_idx
  on public.ghost_agency_dashboard_access (lower(owner_email));

alter table public.ghost_agency_dashboard_access enable row level security;

drop policy if exists ghost_agency_dashboard_access_browser_deny on public.ghost_agency_dashboard_access;
create policy ghost_agency_dashboard_access_browser_deny
  on public.ghost_agency_dashboard_access
  for all
  using (false)
  with check (false);
-- Service-role key (used server-side only, in lib/store.js) bypasses RLS as usual.
