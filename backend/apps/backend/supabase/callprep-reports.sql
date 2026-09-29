-- supabase/callprep-reports.sql — LOCAL CALLPREP REPORT STORE.
--
-- The local signal-report service (infra/callprep/server.cjs) persists report
-- rows here through PostgREST with the service-role JWT, exactly the way the
-- hosted CallPrep Supabase project stores them in production. Applied by
-- scripts/local-env.cjs applySchema(); idempotent.

create table if not exists public.callprep_business_reports (
  id uuid primary key,
  closer_id uuid,
  -- The immutable-packet key (wss-genie-cert-v1:<sha256>). Unique when set:
  -- the ghost-report-adapter is idempotent on it — a re-sent packet updates
  -- the same report instead of minting a second one.
  external_id text unique,
  report_row jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists callprep_business_reports_external_id_idx
  on public.callprep_business_reports (external_id)
  where external_id is not null;

grant select, insert, update, delete on public.callprep_business_reports to service_role;
