-- Ghost Agency prospect identity v1.
-- Additive only: this migration does not delete or overwrite prospect history.
-- Review public.ghost_agency_prospect_duplicate_groups before any manual merge.

create extension if not exists pgcrypto;
create extension if not exists unaccent;

create or replace function public.normalize_ghost_domain(value text)
returns text language plpgsql immutable as $$
declare host text;
begin
  host := nullif(split_part(regexp_replace(regexp_replace(lower(trim(coalesce(value, ''))), '^https?://(www\.)?', ''), '[/:?#].*$', ''), ':', 1), '');
  if host is null or host = any(array['facebook.com','instagram.com','yelp.com','google.com','googleusercontent.com','linkedin.com','tiktok.com','youtube.com','x.com','twitter.com','linktr.ee'])
     or host ~ '(facebook|instagram|yelp|google|googleusercontent|linkedin|tiktok|youtube|twitter|linktr)\.com$' then
    return null;
  end if;
  return host;
end;
$$;

create or replace function public.normalize_ghost_phone(value text)
returns text language sql immutable as $$
  select case
    when length(regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g')) = 10 then '+1' || regexp_replace(value, '[^0-9]', '', 'g')
    when length(regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g')) between 11 and 15 then '+' || regexp_replace(value, '[^0-9]', '', 'g')
    else null end
$$;

create or replace function public.normalize_ghost_name(value text)
returns text language sql stable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(public.unaccent(coalesce(value, ''))), '&', ' and ', 'g'),
      '(^|\s)(llc|ltd|incorporated|inc|corp|corporation|company|co)(\.?\s*|$)', ' ', 'gi'
    ), '[^a-z0-9]+', ' ', 'g'
  )), '')
$$;

create or replace function public.normalize_ghost_address(value text)
returns text language sql stable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(lower(public.unaccent(coalesce(value, ''))),
                  '\m(suite|ste|unit|apt|apartment)\M\s*[#-]?\s*[a-z0-9-]+', ' ', 'gi'),
                '\mstreet\M', 'st', 'g'),
              '\mavenue\M', 'ave', 'g'),
            '\mboulevard\M', 'blvd', 'g'),
          '\mroad\M', 'rd', 'g'),
        '\mdrive\M', 'dr', 'g'),
      '\mlane\M', 'ln', 'g'),
    '\mhighway\M', 'hwy', 'g'),
  '[^a-z0-9]+', ' ', 'g')), '')
$$;

alter table public.ghost_agency_prospects
  add column if not exists canonical_domain text,
  add column if not exists canonical_phone text,
  add column if not exists canonical_name_address text,
  add column if not exists canonical_place_id text,
  add column if not exists canonical_prospect_id text,
  add column if not exists identity_version text,
  add column if not exists merged_into_prospect_id text;

-- Conservative backfill. Application code owns richer normalization for new rows.
update public.ghost_agency_prospects
set
  canonical_place_id = nullif(regexp_replace(coalesce(record->>'place_id', ''), '[^a-zA-Z0-9_-]', '', 'g'), ''),
  canonical_domain = public.normalize_ghost_domain(current_website),
  canonical_phone = public.normalize_ghost_phone(phone),
  canonical_name_address = case
    when public.normalize_ghost_name(business_name) is not null
      and public.normalize_ghost_address(concat_ws(' ', record->>'address', city, state, record->>'postal_code')) is not null
    then public.normalize_ghost_name(business_name) || '|' || public.normalize_ghost_address(concat_ws(' ', record->>'address', city, state, record->>'postal_code'))
    else null end,
  identity_version = 'prospect-identity-v1'
where identity_version is distinct from 'prospect-identity-v1';

-- Name-only values are not identities. Require both sides of name|address.
update public.ghost_agency_prospects
set canonical_name_address = null
where canonical_name_address is not null
  and (split_part(canonical_name_address, '|', 1) = '' or split_part(canonical_name_address, '|', 2) = '');

-- Compute transitive identity groups across every matching key. The stable,
-- lexical survivor is only a reporting pointer; no prospect row is removed.
with recursive edges(left_id, right_id) as (
  select prospect_id, prospect_id from public.ghost_agency_prospects
  union
  select a.prospect_id, b.prospect_id
  from public.ghost_agency_prospects a
  join public.ghost_agency_prospects b on a.prospect_id <> b.prospect_id
    and (
      (a.canonical_place_id is not null and a.canonical_place_id = b.canonical_place_id)
      or (a.canonical_domain is not null and a.canonical_domain = b.canonical_domain)
      or (a.canonical_phone is not null and a.canonical_phone = b.canonical_phone)
      or (a.canonical_name_address is not null and a.canonical_name_address = b.canonical_name_address)
    )
), reach(root_id, node_id) as (
  select left_id, right_id from edges
  union
  select reach.root_id, edges.right_id
  from reach
  join edges on edges.left_id = reach.node_id
), components as (
  select node_id as prospect_id, min(root_id) as component_id
  from reach
  group by node_id
), choices as (
  select
    components.component_id,
    prospects.prospect_id,
    row_number() over (
      partition by components.component_id
      order by
        case prospects.status
          when 'won' then 0 when 'engaged' then 1 when 'reported' then 2
          when 'previewed' then 3 when 'packeted' then 4 when 'new' then 5
          else 6
        end,
        case when prospects.report_url is not null then 0 else 1 end,
        case when prospects.preview_url is not null then 0 else 1 end,
        prospects.created_at asc,
        prospects.prospect_id asc
    ) as survivor_rank
  from components
  join public.ghost_agency_prospects prospects on prospects.prospect_id = components.prospect_id
), ranked as (
  select components.prospect_id, choices.prospect_id as survivor_id
  from components
  join choices on choices.component_id = components.component_id and choices.survivor_rank = 1
)
update public.ghost_agency_prospects prospect
set canonical_prospect_id = ranked.survivor_id
from ranked
where prospect.prospect_id = ranked.prospect_id
  and prospect.canonical_prospect_id is distinct from ranked.survivor_id;

create index if not exists ghost_agency_prospects_canonical_domain_idx
  on public.ghost_agency_prospects (canonical_domain)
  where canonical_domain is not null and merged_into_prospect_id is null;

create index if not exists ghost_agency_prospects_canonical_place_id_idx
  on public.ghost_agency_prospects (canonical_place_id)
  where canonical_place_id is not null and merged_into_prospect_id is null;

create index if not exists ghost_agency_prospects_canonical_phone_idx
  on public.ghost_agency_prospects (canonical_phone)
  where canonical_phone is not null and merged_into_prospect_id is null;

create index if not exists ghost_agency_prospects_canonical_name_address_idx
  on public.ghost_agency_prospects (canonical_name_address)
  where canonical_name_address is not null and merged_into_prospect_id is null;

create index if not exists ghost_agency_prospects_canonical_survivor_idx
  on public.ghost_agency_prospects (canonical_prospect_id, updated_at desc);

alter table public.ghost_agency_prospects
  drop constraint if exists ghost_agency_prospects_no_self_merge;
alter table public.ghost_agency_prospects
  add constraint ghost_agency_prospects_no_self_merge
  check (merged_into_prospect_id is null or merged_into_prospect_id <> prospect_id) not valid;

create table if not exists public.ghost_agency_prospect_identity_history (
  id uuid primary key default gen_random_uuid(),
  prospect_id text not null,
  canonical_prospect_id text,
  identity_key text not null,
  identity_version text not null default 'prospect-identity-v1',
  source text not null default 'migration_backfill',
  evidence jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (prospect_id, identity_key)
);

insert into public.ghost_agency_prospect_identity_history
  (prospect_id, canonical_prospect_id, identity_key, source, evidence)
select prospect_id, canonical_prospect_id, identity_key, 'migration_backfill', jsonb_build_object('source', source)
from public.ghost_agency_prospects
cross join lateral unnest(array_remove(array[
  case when canonical_domain is not null then 'domain:' || canonical_domain end,
  case when canonical_place_id is not null then 'place:' || canonical_place_id end,
  case when canonical_phone is not null then 'phone:' || canonical_phone end,
  case when canonical_name_address is not null then 'name_address:' || canonical_name_address end
], null)) as keys(identity_key)
on conflict (prospect_id, identity_key) do update
set canonical_prospect_id = excluded.canonical_prospect_id,
    last_seen_at = now();

create table if not exists public.ghost_agency_prospect_merge_log (
  id uuid primary key default gen_random_uuid(),
  survivor_prospect_id text not null,
  duplicate_prospect_id text not null,
  reason text not null,
  matching_keys text[] not null default '{}'::text[],
  conflicts jsonb not null default '[]'::jsonb,
  patch jsonb not null default '{}'::jsonb,
  mode text not null default 'review_pending',
  actor text not null default 'operator',
  created_at timestamptz not null default now(),
  check (survivor_prospect_id <> duplicate_prospect_id),
  unique (survivor_prospect_id, duplicate_prospect_id)
);

-- Preserve every source row and all foreign history, but make one active
-- survivor authoritative. Copy only missing top-level facts; conflicts remain
-- in the source row and merge log for review.
with source as (
  select
    p.canonical_prospect_id,
    (array_agg(p.owner_name order by p.updated_at desc) filter (where p.owner_name is not null))[1] as owner_name,
    (array_agg(p.email order by p.updated_at desc) filter (where p.email is not null))[1] as email,
    (array_agg(p.owner_email order by p.updated_at desc) filter (where p.owner_email is not null))[1] as owner_email,
    (array_agg(p.phone order by p.updated_at desc) filter (where p.phone is not null))[1] as phone,
    (array_agg(p.current_website order by p.updated_at desc) filter (where p.current_website is not null))[1] as current_website,
    (array_agg(p.industry order by p.updated_at desc) filter (where p.industry is not null))[1] as industry,
    (array_agg(p.city order by p.updated_at desc) filter (where p.city is not null))[1] as city,
    (array_agg(p.state order by p.updated_at desc) filter (where p.state is not null))[1] as state,
    (array_agg(p.report_url order by p.updated_at desc) filter (where p.report_url is not null))[1] as report_url,
    (array_agg(p.preview_url order by p.updated_at desc) filter (where p.preview_url is not null))[1] as preview_url,
    max(p.updated_at) as updated_at
  from public.ghost_agency_prospects p
  where p.canonical_prospect_id is not null
  group by p.canonical_prospect_id
)
update public.ghost_agency_prospects survivor
set
  owner_name = coalesce(survivor.owner_name, source.owner_name),
  email = coalesce(survivor.email, source.email),
  owner_email = coalesce(survivor.owner_email, source.owner_email),
  phone = coalesce(survivor.phone, source.phone),
  current_website = coalesce(survivor.current_website, source.current_website),
  industry = coalesce(survivor.industry, source.industry),
  city = coalesce(survivor.city, source.city),
  state = coalesce(survivor.state, source.state),
  report_url = coalesce(survivor.report_url, source.report_url),
  preview_url = coalesce(survivor.preview_url, source.preview_url),
  updated_at = greatest(survivor.updated_at, source.updated_at)
from source
where survivor.prospect_id = survivor.canonical_prospect_id
  and source.canonical_prospect_id = survivor.prospect_id;

insert into public.ghost_agency_prospect_merge_log
  (survivor_prospect_id, duplicate_prospect_id, reason, matching_keys, mode, actor)
select
  canonical_prospect_id,
  prospect_id,
  'canonical identity match',
  array_remove(array[
    case when canonical_domain is not null then 'domain:' || canonical_domain end,
    case when canonical_place_id is not null then 'place:' || canonical_place_id end,
    case when canonical_phone is not null then 'phone:' || canonical_phone end,
    case when canonical_name_address is not null then 'name_address:' || canonical_name_address end
  ], null),
  'merged_pointer_history_preserved',
  'data_integrity_migration'
from public.ghost_agency_prospects
where canonical_prospect_id is not null and prospect_id <> canonical_prospect_id
on conflict (survivor_prospect_id, duplicate_prospect_id) do nothing;

update public.ghost_agency_prospects
set merged_into_prospect_id = canonical_prospect_id,
    status = case when status in ('won', 'engaged') then status else 'merged' end
where canonical_prospect_id is not null
  and prospect_id <> canonical_prospect_id
  and merged_into_prospect_id is null;

-- A global identity-key registry supplies the DB uniqueness constraint without
-- deleting historical duplicate rows. The trigger serializes concurrent jobs
-- by identity key and rejects a second active canonical owner.
create table if not exists public.ghost_agency_prospect_identity_keys (
  identity_key text primary key,
  canonical_prospect_id text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

insert into public.ghost_agency_prospect_identity_keys (identity_key, canonical_prospect_id)
select distinct on (identity_key) identity_key, canonical_prospect_id
from public.ghost_agency_prospect_identity_history
where canonical_prospect_id is not null
order by identity_key, canonical_prospect_id
on conflict (identity_key) do update
set last_seen_at = now();

create or replace function public.guard_ghost_agency_prospect_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  owner_id text;
begin
  new.canonical_place_id := nullif(regexp_replace(coalesce(new.record->>'place_id', ''), '[^a-zA-Z0-9_-]', '', 'g'), '');
  new.canonical_domain := public.normalize_ghost_domain(new.current_website);
  new.canonical_phone := public.normalize_ghost_phone(new.phone);
  new.canonical_name_address := case
    when public.normalize_ghost_name(new.business_name) is not null
      and public.normalize_ghost_address(concat_ws(' ', new.record->>'address', new.city, new.state, new.record->>'postal_code')) is not null
    then public.normalize_ghost_name(new.business_name) || '|' || public.normalize_ghost_address(concat_ws(' ', new.record->>'address', new.city, new.state, new.record->>'postal_code'))
    else null end;
  new.canonical_prospect_id := coalesce(new.canonical_prospect_id, new.prospect_id);
  new.identity_version := 'prospect-identity-v1';

  foreach key in array array_remove(array[
    case when new.canonical_place_id is not null then 'place:' || new.canonical_place_id end,
    case when new.canonical_domain is not null then 'domain:' || new.canonical_domain end,
    case when new.canonical_phone is not null then 'phone:' || new.canonical_phone end,
    case when new.canonical_name_address is not null then 'name_address:' || new.canonical_name_address end
  ], null)
  loop
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
  end loop;
  return new;
end;
$$;

drop trigger if exists ghost_agency_prospect_identity_guard on public.ghost_agency_prospects;
create trigger ghost_agency_prospect_identity_guard
before insert or update of business_name, phone, current_website, city, state, record, canonical_prospect_id
on public.ghost_agency_prospects
for each row execute function public.guard_ghost_agency_prospect_identity();

revoke all on function public.guard_ghost_agency_prospect_identity() from public, anon, authenticated;
grant execute on function public.guard_ghost_agency_prospect_identity() to service_role;

create or replace view public.ghost_agency_prospect_duplicate_groups as
select
  canonical_prospect_id,
  count(*)::integer as row_count,
  array_agg(prospect_id order by created_at asc nulls last, prospect_id) as prospect_ids,
  array_remove(array_agg(distinct canonical_domain), null) as domains,
  array_remove(array_agg(distinct canonical_phone), null) as phones
from public.ghost_agency_prospects
group by canonical_prospect_id
having count(*) > 1;

create or replace view public.ghost_agency_prospect_integrity_counts as
select
  count(*)::integer as total_rows,
  count(*) filter (where merged_into_prospect_id is null)::integer as active_rows,
  count(distinct canonical_prospect_id)::integer as unique_prospects,
  (count(*) - count(distinct canonical_prospect_id))::integer as duplicate_rows,
  count(*) filter (
    where canonical_place_id is null
      and canonical_domain is null
      and canonical_phone is null
      and canonical_name_address is null
  )::integer as unidentifiable_rows
from public.ghost_agency_prospects;

alter table public.ghost_agency_prospect_identity_history enable row level security;
alter table public.ghost_agency_prospect_merge_log enable row level security;
alter table public.ghost_agency_prospect_identity_keys enable row level security;

revoke all on table public.ghost_agency_prospect_identity_history from anon, authenticated;
revoke all on table public.ghost_agency_prospect_merge_log from anon, authenticated;
revoke all on table public.ghost_agency_prospect_identity_keys from anon, authenticated;
revoke all on table public.ghost_agency_prospect_duplicate_groups from anon, authenticated;
revoke all on table public.ghost_agency_prospect_integrity_counts from anon, authenticated;

grant select, insert, update on table public.ghost_agency_prospect_identity_history to service_role;
grant select, insert, update on table public.ghost_agency_prospect_merge_log to service_role;
grant select, insert, update on table public.ghost_agency_prospect_identity_keys to service_role;
grant select on table public.ghost_agency_prospect_duplicate_groups to service_role;
grant select on table public.ghost_agency_prospect_integrity_counts to service_role;
