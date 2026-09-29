begin;
alter table public.ghost_agency_line_batch_rows drop constraint if exists ghost_agency_line_batch_rows_status_check;
alter table public.ghost_agency_line_batch_rows add constraint ghost_agency_line_batch_rows_status_check check (status in ('picked','qualified','mirrored','gate_passed','ready','queued','sent','rejected','gate_failed','error'));
drop index if exists public.ghost_agency_line_batch_rows_batch_logo_unique;
create unique index ghost_agency_line_batch_rows_batch_logo_unique on public.ghost_agency_line_batch_rows (batch_id, logo_sha256) where logo_sha256 is not null and status in ('gate_passed','ready','queued','sent');
commit;
