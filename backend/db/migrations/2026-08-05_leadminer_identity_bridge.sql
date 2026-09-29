-- Minimal additive bridge for the LeadMiner Mirror-Ready receiver.
-- Existing prospect rows and workflow statuses are intentionally untouched.

alter table public.ghost_agency_prospects
  add column if not exists canonical_place_id text,
  add column if not exists canonical_prospect_id text,
  add column if not exists identity_version text;

create index if not exists ghost_agency_prospects_canonical_place_id_idx
  on public.ghost_agency_prospects (canonical_place_id)
  where canonical_place_id is not null;

create table if not exists public.ghost_agency_prospect_identity_keys (
  identity_key text primary key,
  canonical_prospect_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.ghost_agency_prospect_identity_keys enable row level security;

revoke all on table public.ghost_agency_prospect_identity_keys from anon, authenticated;
grant select, insert, update on table public.ghost_agency_prospect_identity_keys to service_role;
