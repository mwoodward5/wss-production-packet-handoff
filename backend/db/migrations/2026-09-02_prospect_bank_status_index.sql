-- Prospect Bank draw-read performance (owner doctrine 2026-09-02).
--
-- Campaign start draws banked-first: lib/prospect-bank.js reads
--   WHERE record->>bank_status = 'banked' [AND record->prospect_bank->>vertical = '...']
--   ORDER BY updated_at ASC LIMIT <small>
-- and the TTL sweep reads reserved rows the same way. Without an expression
-- index those become sequential scans over every prospect row (the table the
-- identity-index migration of 2026-08-24 already had to rescue once).
--
-- Paste into: Supabase Studio → SQL Editor → Run
-- (or apply via psql with SUPABASE_DB_URL as documented in RUNBOOK.md §4)

begin;

create index if not exists ghost_agency_prospects_bank_status_idx
  on public.ghost_agency_prospects ((record->>'bank_status'))
  where record->>'bank_status' is not null;

create index if not exists ghost_agency_prospects_bank_vertical_idx
  on public.ghost_agency_prospects ((record->prospect_bank->>'vertical'), updated_at asc)
  where record->>'bank_status' = 'banked';

commit;
