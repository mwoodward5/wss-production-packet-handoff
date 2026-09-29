begin;

create table if not exists public.ghost_agency_outreach_identity (
  identity_key text primary key,
  identity_type text not null check (identity_type in ('place_id','domain','business_locality','email')),
  prospect_id text,
  last_contacted_at timestamptz,
  last_send_id text,
  creative_fingerprint text,
  suppressed boolean not null default false,
  suppression_reason text,
  claim_token text,
  claim_expires_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ghost_agency_outreach_identity_last_contacted_idx on public.ghost_agency_outreach_identity (last_contacted_at desc);
create index if not exists ghost_agency_outreach_identity_claim_expiry_idx on public.ghost_agency_outreach_identity (claim_expires_at) where claim_token is not null;
create index if not exists ghost_agency_outreach_identity_prospect_idx on public.ghost_agency_outreach_identity (prospect_id) where prospect_id is not null;

alter table public.ghost_agency_outreach_identity enable row level security;
revoke all on public.ghost_agency_outreach_identity from anon, authenticated;

create or replace function public.claim_ghost_outreach_identity(
  p_identity_key text,
  p_identity_type text,
  p_prospect_id text,
  p_claim_token text,
  p_lease_seconds integer default 300,
  p_cooldown_days integer default 30
)
returns table(ok boolean, reason text, claim_expires_at timestamptz, last_contacted_at timestamptz, suppressed boolean, suppression_reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.ghost_agency_outreach_identity%rowtype;
  v_cooldown integer := greatest(1, least(coalesce(p_cooldown_days, 30), 365));
begin
  if coalesce(trim(p_identity_key), '') = '' or coalesce(trim(p_claim_token), '') = '' then
    return query select false, 'invalid_claim'::text, null::timestamptz, null::timestamptz, false, null::text;
    return;
  end if;

  insert into public.ghost_agency_outreach_identity(identity_key, identity_type, prospect_id, last_seen_at, updated_at)
  values (p_identity_key, p_identity_type, p_prospect_id, v_now, v_now)
  on conflict(identity_key) do update set
    prospect_id = coalesce(excluded.prospect_id, ghost_agency_outreach_identity.prospect_id),
    last_seen_at = v_now,
    updated_at = v_now;

  select * into v_row from public.ghost_agency_outreach_identity where identity_key = p_identity_key for update;

  if v_row.suppressed then
    return query select false, 'suppressed'::text, v_row.claim_expires_at, v_row.last_contacted_at, true, v_row.suppression_reason;
    return;
  end if;

  if v_row.last_contacted_at is not null and v_row.last_contacted_at > v_now - make_interval(days => v_cooldown) then
    return query select false, 'cooldown_active'::text, v_row.claim_expires_at, v_row.last_contacted_at, false, v_row.suppression_reason;
    return;
  end if;

  if v_row.claim_token is not null and v_row.claim_expires_at is not null and v_row.claim_expires_at > v_now then
    return query select false, 'already_claimed'::text, v_row.claim_expires_at, v_row.last_contacted_at, false, v_row.suppression_reason;
    return;
  end if;

  update public.ghost_agency_outreach_identity
  set claim_token = p_claim_token,
      claim_expires_at = v_now + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 1800))),
      updated_at = v_now
  where identity_key = p_identity_key
  returning * into v_row;

  return query select true, 'claimed'::text, v_row.claim_expires_at, v_row.last_contacted_at, v_row.suppressed, v_row.suppression_reason;
end;
$$;

revoke all on function public.claim_ghost_outreach_identity(text,text,text,text,integer,integer) from public;
grant execute on function public.claim_ghost_outreach_identity(text,text,text,text,integer,integer) to service_role;

create or replace function public.finish_ghost_outreach_identity_send(
  p_identity_key text,
  p_claim_token text,
  p_send_id text,
  p_creative_fingerprint text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_updated integer;
begin
  update public.ghost_agency_outreach_identity
  set last_contacted_at = now(),
      last_send_id = nullif(trim(p_send_id), ''),
      creative_fingerprint = nullif(trim(p_creative_fingerprint), ''),
      claim_token = null,
      claim_expires_at = null,
      updated_at = now()
  where identity_key = p_identity_key
    and claim_token = p_claim_token
    and coalesce(claim_expires_at, '-infinity'::timestamptz) >= now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.finish_ghost_outreach_identity_send(text,text,text,text) from public;
grant execute on function public.finish_ghost_outreach_identity_send(text,text,text,text) to service_role;

create or replace function public.release_ghost_outreach_identity_claim(p_identity_key text, p_claim_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_updated integer;
begin
  update public.ghost_agency_outreach_identity
  set claim_token = null, claim_expires_at = null, updated_at = now()
  where identity_key = p_identity_key and claim_token = p_claim_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.release_ghost_outreach_identity_claim(text,text) from public;
grant execute on function public.release_ghost_outreach_identity_claim(text,text) to service_role;

commit;
