-- Canonical state for the Ghost Agency operator Line. Event rows remain audit
-- telemetry only; recovery and leases read these normalized tables.

create table if not exists public.ghost_agency_line_batches (
  batch_id text primary key,
  lane text not null check (lane in ('sandbox', 'live')),
  target text not null default '',
  requested integer not null check (requested between 0 and 500),
  status text not null default 'building'
    check (status in ('building', 'running', 'awaiting_approval', 'approved', 'sending', 'done', 'halted')),
  pick_state text not null default 'pending'
    check (pick_state in ('pending', 'picking', 'complete', 'failed')),
  mine_funnel jsonb not null default '{}'::jsonb,
  approval jsonb,
  halt_reason text,
  version bigint not null default 0 check (version >= 0),
  mutation_token uuid,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  sent_at timestamptz
);

create table if not exists public.ghost_agency_line_batch_rows (
  row_id text primary key,
  batch_id text not null references public.ghost_agency_line_batches(batch_id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  prospect_id text not null,
  status text not null default 'picked'
    check (status in ('picked', 'qualified', 'mirrored', 'gate_passed', 'ready', 'queued', 'sent', 'rejected', 'gate_failed', 'error')),
  -- Application code recursively removes raw email and phone data. Sending
  -- resolves contact data from the canonical prospect by prospect_id instead.
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 0 check (version >= 0),
  mutation_token uuid,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_retryable_error text,
  logo_sha256 text check (logo_sha256 is null or logo_sha256 ~ '^[0-9a-f]{64}$'),
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ghost_agency_line_batch_rows_batch_index_unique unique (batch_id, row_index),
  constraint ghost_agency_line_batch_rows_batch_prospect_unique unique (batch_id, prospect_id),
  constraint ghost_agency_line_batch_rows_lease_complete check (
    (lease_token is null and lease_owner is null and lease_expires_at is null)
    or (lease_token is not null and lease_owner is not null and lease_expires_at is not null)
  )
);

create index if not exists ghost_agency_line_batches_status_updated_idx
  on public.ghost_agency_line_batches (status, updated_at);

create index if not exists ghost_agency_line_batch_rows_claim_idx
  on public.ghost_agency_line_batch_rows (batch_id, status, row_index)
  where status in ('picked', 'qualified', 'mirrored', 'gate_passed');

create index if not exists ghost_agency_line_batch_rows_send_idx
  on public.ghost_agency_line_batch_rows (batch_id, row_index)
  where status = 'queued';

create index if not exists ghost_agency_line_batch_rows_lease_expiry_idx
  on public.ghost_agency_line_batch_rows (lease_expires_at)
  where lease_token is not null;

-- The database, not one Node process, decides the logo race across lambdas.
create unique index if not exists ghost_agency_line_batch_rows_batch_logo_unique
  on public.ghost_agency_line_batch_rows (batch_id, logo_sha256)
  where logo_sha256 is not null and status in ('gate_passed', 'ready', 'queued', 'sent');

alter table public.ghost_agency_line_batches enable row level security;
alter table public.ghost_agency_line_batch_rows enable row level security;

revoke all on table public.ghost_agency_line_batches from public, anon, authenticated;
revoke all on table public.ghost_agency_line_batch_rows from public, anon, authenticated;
-- Supabase projects may carry an ALTER DEFAULT PRIVILEGES grant for
-- service_role. Clear it on these tables before granting the four operations
-- the API actually needs, so TRUNCATE/REFERENCES/TRIGGER cannot leak through.
revoke all on table public.ghost_agency_line_batches from service_role;
revoke all on table public.ghost_agency_line_batch_rows from service_role;

grant select, insert, update, delete on table public.ghost_agency_line_batches to service_role;
grant select, insert, update, delete on table public.ghost_agency_line_batch_rows to service_role;

comment on table public.ghost_agency_line_batches is
  'Canonical durable state for operator Line batches; service-role only.';
comment on table public.ghost_agency_line_batch_rows is
  'Canonical row checkpoints and leases; payload excludes raw contact PII.';
