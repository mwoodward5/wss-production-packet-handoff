-- One-way supervision state for the 10-draft review batch. There is no clear,
-- send, or approval routine in this migration or the application module.
create table if not exists public.ghost_agency_supervision_holds (
  hold_key text primary key,
  status text not null check (status = 'active'),
  created_at timestamptz not null default now(),
  created_by text not null default 'operator'
);

create table if not exists public.ghost_agency_outbound_review_drafts (
  draft_id uuid primary key,
  hold_key text not null references public.ghost_agency_supervision_holds(hold_key),
  prospect_id text not null,
  recipient_email text not null,
  -- Deprecated compatibility column. Consent-first cold drafts are created
  -- before any preview exists, so this must remain nullable.
  preview_url text,
  getfound_grade text not null,
  subject text not null,
  body text not null,
  compose_mode text not null check (compose_mode = 'dry_run'),
  delivery_status text not null check (delivery_status = 'review_only'),
  approval_status text not null check (approval_status = 'awaiting_explicit_later_approval'),
  created_at timestamptz not null default now(),
  unique (hold_key, prospect_id),
  unique (hold_key, recipient_email)
);

-- Safe, idempotent upgrade for databases created by the preview-first schema.
alter table public.ghost_agency_outbound_review_drafts
  alter column preview_url drop not null;

create or replace function public.reject_supervision_hold_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'supervision holds are immutable';
end;
$$;

drop trigger if exists ghost_agency_supervision_holds_immutable on public.ghost_agency_supervision_holds;
create trigger ghost_agency_supervision_holds_immutable
before update or delete on public.ghost_agency_supervision_holds
for each row execute function public.reject_supervision_hold_mutation();

alter table public.ghost_agency_supervision_holds enable row level security;
alter table public.ghost_agency_outbound_review_drafts enable row level security;
revoke all on table public.ghost_agency_supervision_holds from anon, authenticated;
revoke all on table public.ghost_agency_outbound_review_drafts from anon, authenticated;
grant select, insert on table public.ghost_agency_supervision_holds to service_role;
grant select, insert on table public.ghost_agency_outbound_review_drafts to service_role;
