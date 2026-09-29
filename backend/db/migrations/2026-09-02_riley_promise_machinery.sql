begin;

-- Riley's promise machinery (branch zcode/riley-promise-machinery).
-- One migration, four pieces, every one of them a durable record for a
-- promise Riley makes OUT LOUD on a live call.

-- 1. "You'll get 1 email when it's live." One row per (job, promise kind).
--    Written by the site-edit lane (lib/riley-followups.js
--    recordFollowUpPromise) or by the job row's inline follow_up flag; the
--    edit-job runner's terminal `done` write is the only place a live_email
--    promise is ever KEPT (lib/riley-followups.js deliverFollowUp), and every
--    refusal writes its reason here.
create table if not exists public.riley_followup_promises (
  id bigint generated always as identity primary key,
  promise_key text not null unique,
  job_id text not null,
  call_id text,
  site_slug text,
  client_ref text,
  promise_kind text not null default 'live_email'
    check (promise_kind in ('live_email', 'resend_report')),
  consent_email boolean not null default false,
  consent_source text,
  status text not null default 'pending'
    check (status in (
      'pending', 'sent', 'failed_send',
      'refused_no_consent', 'refused_suppressed', 'refused_no_email',
      'refused_no_client_record', 'refused_no_report_url', 'refused_job_not_done'
    )),
  recipient text,
  detail jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.riley_followup_promises enable row level security;
create index if not exists riley_followup_promises_job_id_idx
  on public.riley_followup_promises (job_id);

-- 2. "I flagged it for the team." Durable flags raised mid-call; the owner
--    email fires at insert time (api/vapi-tools/flag-for-team.js). The row is
--    the flag; the email is only the bell.
create table if not exists public.ghost_agency_team_flags (
  id bigint generated always as identity primary key,
  flag_id text not null unique,
  client_ref text,
  site_slug text,
  job_id text,
  reason text not null,
  details text,
  call_id text,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ghost_agency_team_flags enable row level security;
create index if not exists ghost_agency_team_flags_status_idx
  on public.ghost_agency_team_flags (status, created_at);

-- 3. "Should I call you back when it's live?" Requested callbacks, keyed by
--    caller phone, requested window stored VERBATIM (free text — parsing it
--    into an appointment we cannot honour would be a fabricated promise).
--    No auto-dialer: the row waits for a human
--    (api/vapi-tools/schedule-callback.js).
create table if not exists public.ghost_agency_callbacks (
  id bigint generated always as identity primary key,
  callback_id text not null unique,
  client_ref text,
  phone text,
  phone_digits text,
  topic text,
  requested_window text not null,
  call_id text,
  site_slug text,
  status text not null default 'open'
    check (status in ('open', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ghost_agency_callbacks enable row level security;
create index if not exists ghost_agency_callbacks_open_idx
  on public.ghost_agency_callbacks (status, created_at);

-- 4. The inline promise flag on the job row itself, for lanes that would
--    rather set one column at enqueue time than make a second write:
--    true, or {"promise_kind":"live_email","consent_email":true,
--    "consent_source":"verbal_call"}. Survives the claim/terminal rewrites
--    because every job write keys on job_id and never touches this column.
alter table public.ghost_agency_edit_jobs
  add column if not exists follow_up jsonb;

-- DNC has NO new table by design: the ledger already exists
-- (ghost_agency_suppressions + consent_registrar, written by
-- lib/contact-suppression.js and read by lib/email.js, lib/line-delivery.js,
-- lib/customer-sms.js, lib/twilio.js, lib/connect.js,
-- lib/mission-control-customer.js, lib/full-run.js and
-- lib/supervised-held-drafts.js). api/vapi-tools/record-opt-out.js reuses it
-- so a voice opt-out lands in the exact gates the outbound lanes already read.

commit;
