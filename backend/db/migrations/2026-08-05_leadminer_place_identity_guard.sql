-- Place-ID-only identity hardening for LeadMiner handoffs.
-- This intentionally avoids the broader domain/phone/name merge migration.

begin;

alter table public.ghost_agency_prospects
  add column if not exists canonical_place_id text,
  add column if not exists canonical_prospect_id text,
  add column if not exists identity_version text;

update public.ghost_agency_prospects
set canonical_place_id = nullif(regexp_replace(coalesce(record->>'place_id', ''), '[^a-zA-Z0-9_-]', '', 'g'), ''),
    canonical_prospect_id = coalesce(nullif(canonical_prospect_id, ''), prospect_id),
    identity_version = coalesce(nullif(identity_version, ''), 'prospect-identity-v1');

with winners as (
  select distinct on (canonical_place_id)
    canonical_place_id,
    prospect_id as winner_id
  from public.ghost_agency_prospects
  where canonical_place_id is not null
  order by canonical_place_id,
    case status
      when 'won' then 0
      when 'engaged' then 1
      when 'reported' then 2
      when 'previewed' then 3
      when 'packeted' then 4
      when 'new' then 5
      else 6
    end,
    case when report_url is not null then 0 else 1 end,
    case when preview_url is not null then 0 else 1 end,
    created_at asc,
    prospect_id asc
)
update public.ghost_agency_prospects prospect
set canonical_prospect_id = winners.winner_id
from winners
where prospect.canonical_place_id = winners.canonical_place_id;

create index if not exists ghost_agency_prospects_canonical_place_id_idx
  on public.ghost_agency_prospects (canonical_place_id)
  where canonical_place_id is not null;

create table if not exists public.ghost_agency_prospect_identity_keys (
  identity_key text primary key,
  canonical_prospect_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

insert into public.ghost_agency_prospect_identity_keys (identity_key, canonical_prospect_id)
select distinct 'place:' || canonical_place_id, canonical_prospect_id
from public.ghost_agency_prospects
where canonical_place_id is not null
on conflict (identity_key) do update
set canonical_prospect_id = excluded.canonical_prospect_id,
    last_seen_at = now();

create or replace function public.guard_ghost_agency_prospect_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  key text;
  owner_id text;
  record_place text;
  column_place text;
begin
  record_place := nullif(regexp_replace(coalesce(new.record->>'place_id', ''), '[^a-zA-Z0-9_-]', '', 'g'), '');
  column_place := nullif(regexp_replace(coalesce(new.canonical_place_id, ''), '[^a-zA-Z0-9_-]', '', 'g'), '');
  if record_place is not null and column_place is not null and record_place <> column_place then
    raise exception using errcode = '23514', message = 'prospect place identity mismatch';
  end if;
  new.canonical_place_id := coalesce(column_place, record_place);
  new.canonical_prospect_id := coalesce(nullif(new.canonical_prospect_id, ''), new.prospect_id);
  new.identity_version := coalesce(nullif(new.identity_version, ''), 'prospect-identity-v1');
  if new.canonical_place_id is null then return new; end if;

  key := 'place:' || new.canonical_place_id;
  perform pg_advisory_xact_lock(hashtextextended(key, 0));
  select canonical_prospect_id into owner_id
  from public.ghost_agency_prospect_identity_keys
  where identity_key = key;
  if owner_id is not null and owner_id <> new.canonical_prospect_id then
    raise exception using
      errcode = '23505',
      message = 'duplicate prospect identity',
      detail = format('identity_key=%s canonical_prospect_id=%s', key, owner_id);
  end if;
  insert into public.ghost_agency_prospect_identity_keys (identity_key, canonical_prospect_id)
  values (key, new.canonical_prospect_id)
  on conflict (identity_key) do update set last_seen_at = now();
  return new;
end;
$$;

drop trigger if exists ghost_agency_prospect_identity_guard on public.ghost_agency_prospects;
create trigger ghost_agency_prospect_identity_guard
before insert or update of record, canonical_place_id, canonical_prospect_id
on public.ghost_agency_prospects
for each row execute function public.guard_ghost_agency_prospect_identity();

revoke all on function public.guard_ghost_agency_prospect_identity() from public, anon, authenticated;
grant execute on function public.guard_ghost_agency_prospect_identity() to service_role;

alter table public.ghost_agency_prospect_identity_keys enable row level security;
revoke all on table public.ghost_agency_prospect_identity_keys from public, anon, authenticated;
grant select, insert, update on table public.ghost_agency_prospect_identity_keys to service_role;

notify pgrst, 'reload schema';

commit;
