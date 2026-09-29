-- Durable Resend/Svix webhook deduplication.
-- Safe to apply more than once and preserves the live schema in source control.

alter table public.ghost_agency_events
  add column if not exists svix_id text;

create unique index if not exists ghost_agency_events_svix_id_unique_idx
  on public.ghost_agency_events (svix_id)
  where svix_id is not null;
