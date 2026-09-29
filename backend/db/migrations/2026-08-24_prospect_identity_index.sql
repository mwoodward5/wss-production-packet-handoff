-- Prospect identity-index read performance (issue #372).
--
-- `persistMinedRows` downloads up to 5 000 prospect rows ordered by
-- updated_at DESC before every mine.  On a large table that scan blows the
-- 8-second store read ceiling and returns live_select_failed, which the
-- miner correctly treats as a fail-closed blocker
-- (prospect_identity_index_unavailable / created: 0).
--
-- This migration adds the index Postgres needs to satisfy
--   ORDER BY updated_at DESC LIMIT 5000
-- with an index scan instead of a sequential scan, cutting the read from
-- O(table) to O(1) index pages + 5 000 row fetches.
--
-- Paste into: Supabase Studio → SQL Editor → Run
-- (or apply via psql with SUPABASE_DB_URL as documented in RUNBOOK.md §4)

begin;

create index if not exists ghost_agency_prospects_updated_at_desc_idx
  on public.ghost_agency_prospects (updated_at desc nulls last);

commit;
