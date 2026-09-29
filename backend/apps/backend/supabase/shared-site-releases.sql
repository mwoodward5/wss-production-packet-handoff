-- Immutable shared-site release registry for *.wss-ai.com.
--
-- The router receives no database role, table access, or service key. A
-- backend HMAC proxy can resolve one active snapshot or consume one exact,
-- one-use preview grant through service_role-only wrappers. Object bytes live
-- only below:
--   sites/<site_id>/releases/<release_id>/files/<canonical-path>
--   sites/<site_id>/releases/<release_id>/manifest.json
-- The mutable wss-site-sources bucket is intentionally absent from this law.

begin;

-- Privileged implementations live outside Supabase's exposed public schema.
-- PostgREST sees only the SECURITY INVOKER wrappers declared near the end.
create schema if not exists ghost_agency_private;
revoke all on schema ghost_agency_private from public, anon, authenticated, service_role;

create table if not exists public.ghost_agency_sites (
  site_id uuid primary key,
  canonical_slug text not null unique
    check (
      length(canonical_slug) between 1 and 63
      and canonical_slug = lower(canonical_slug)
      and canonical_slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    ),
  serve_mode text not null default 'legacy'
    check (serve_mode in ('legacy', 'shared', 'disabled')),
  active_release_id uuid,
  previous_release_id uuid,
  generation bigint not null default 0 check (generation >= 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ghost_agency_sites_distinct_release_slots
    check (active_release_id is null or active_release_id is distinct from previous_release_id)
);

create table if not exists public.ghost_agency_site_releases (
  release_id uuid primary key,
  site_id uuid not null references public.ghost_agency_sites(site_id) on delete restrict,
  build_hash text not null check (build_hash ~ '^[0-9a-f]{64}$'),
  manifest_path text not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_host text not null,
  published_generation bigint not null check (published_generation >= 1),
  deployment_env text not null
    check (deployment_env ~ '^[a-z0-9]([a-z0-9_-]{0,30}[a-z0-9])?$'),
  state text not null default 'staged'
    check (state in ('staged', 'verified', 'active', 'retired', 'revoked')),
  staged_at timestamptz not null default now(),
  verified_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ghost_agency_site_releases_site_release_unique unique (site_id, release_id),
  constraint ghost_agency_site_releases_exact_grant_unique unique (site_id, release_id, build_hash),
  constraint ghost_agency_site_releases_manifest_path_exact check (
    manifest_path = 'sites/' || site_id::text || '/releases/' || release_id::text || '/manifest.json'
  ),
  constraint ghost_agency_site_releases_host_canonical check (
    length(canonical_host) between 3 and 253
    and canonical_host = lower(canonical_host)
    and canonical_host = btrim(canonical_host)
    and right(canonical_host, 1) <> '.'
    and canonical_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and canonical_host !~ '(^|\.)[^.]{64}'
  )
);

-- Add the circular release-slot FKs only after both registry tables exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ghost_agency_sites_active_release_fk'
  ) then
    alter table public.ghost_agency_sites
      add constraint ghost_agency_sites_active_release_fk
      foreign key (site_id, active_release_id)
      references public.ghost_agency_site_releases(site_id, release_id)
      on delete restrict deferrable initially immediate;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ghost_agency_sites_previous_release_fk'
  ) then
    alter table public.ghost_agency_sites
      add constraint ghost_agency_sites_previous_release_fk
      foreign key (site_id, previous_release_id)
      references public.ghost_agency_site_releases(site_id, release_id)
      on delete restrict deferrable initially immediate;
  end if;
end
$$;

create table if not exists public.ghost_agency_site_hosts (
  normalized_host text primary key,
  site_id uuid not null references public.ghost_agency_sites(site_id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'retired')),
  is_primary boolean not null default false,
  tombstoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ghost_agency_site_hosts_canonical check (
    length(normalized_host) between 3 and 253
    and normalized_host = lower(normalized_host)
    and normalized_host = btrim(normalized_host)
    and right(normalized_host, 1) <> '.'
    and normalized_host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and normalized_host !~ '(^|\.)[^.]{64}'
  ),
  constraint ghost_agency_site_hosts_retired_tombstone check (
    (status = 'retired' and tombstoned_at is not null)
    or (status <> 'retired' and tombstoned_at is null)
  )
);

create table if not exists public.ghost_agency_site_preview_grants (
  jti_hash text primary key check (jti_hash ~ '^[0-9a-f]{64}$'),
  site_id uuid not null,
  release_id uuid not null,
  build_hash text not null check (build_hash ~ '^[0-9a-f]{64}$'),
  deployment_env text not null
    check (deployment_env ~ '^[a-z0-9]([a-z0-9_-]{0,30}[a-z0-9])?$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ghost_agency_site_preview_grants_exact_release_fk
    foreign key (site_id, release_id, build_hash)
    references public.ghost_agency_site_releases(site_id, release_id, build_hash)
    on delete restrict,
  constraint ghost_agency_site_preview_grants_expiry_after_create
    check (expires_at > created_at),
  constraint ghost_agency_site_preview_grants_used_after_create
    check (used_at is null or used_at >= created_at),
  constraint ghost_agency_site_preview_grants_revoked_after_create
    check (revoked_at is null or revoked_at >= created_at)
);

create unique index if not exists ghost_agency_site_releases_one_active_per_site
  on public.ghost_agency_site_releases(site_id)
  where state = 'active';

create unique index if not exists ghost_agency_site_hosts_one_primary_per_site
  on public.ghost_agency_site_hosts(site_id)
  where status = 'active' and is_primary;

create index if not exists ghost_agency_site_hosts_site_status_idx
  on public.ghost_agency_site_hosts(site_id, status);

create index if not exists ghost_agency_site_preview_grants_expiry_idx
  on public.ghost_agency_site_preview_grants(expires_at)
  where used_at is null and revoked_at is null;

-- Host names are permanent identities.  Retirement creates a tombstone; no
-- code path can delete, rename, transfer, or reactivate it for another tenant.
create or replace function public.guard_ghost_agency_site_host_tombstone()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'site_host_delete_refused_permanent_tombstone';
  end if;

  if tg_op = 'UPDATE' then
    if new.normalized_host is distinct from old.normalized_host
      or new.site_id is distinct from old.site_id then
      raise exception 'site_host_identity_is_immutable';
    end if;
    if old.tombstoned_at is not null and (
      new.status is distinct from 'retired'
      or new.tombstoned_at is distinct from old.tombstoned_at
      or new.is_primary
    ) then
      raise exception 'site_host_tombstone_is_permanent';
    end if;
  end if;

  if new.status = 'retired' then
    if tg_op = 'UPDATE' then
      new.tombstoned_at := coalesce(old.tombstoned_at, clock_timestamp());
    else
      new.tombstoned_at := coalesce(new.tombstoned_at, clock_timestamp());
    end if;
    new.is_primary := false;
  else
    new.tombstoned_at := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists ghost_agency_site_hosts_tombstone_guard on public.ghost_agency_site_hosts;
create trigger ghost_agency_site_hosts_tombstone_guard
before insert or update or delete on public.ghost_agency_site_hosts
for each row execute function public.guard_ghost_agency_site_host_tombstone();

-- A release row may move through its finite state machine, but its tenant,
-- object prefix, build proof, and manifest proof can never be rewritten.
create or replace function public.guard_ghost_agency_site_release_immutability()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'site_release_delete_refused_immutable';
  end if;
  if new.release_id is distinct from old.release_id
    or new.site_id is distinct from old.site_id
    or new.build_hash is distinct from old.build_hash
    or new.manifest_path is distinct from old.manifest_path
    or new.manifest_sha256 is distinct from old.manifest_sha256
    or new.canonical_host is distinct from old.canonical_host
    or new.published_generation is distinct from old.published_generation
    or new.deployment_env is distinct from old.deployment_env
    or new.created_at is distinct from old.created_at
    or new.staged_at is distinct from old.staged_at then
    raise exception 'site_release_identity_is_immutable';
  end if;
  if new.state is distinct from old.state and not (
    (old.state = 'staged' and new.state in ('verified', 'revoked'))
    or (old.state = 'verified' and new.state in ('active', 'revoked'))
    or (old.state = 'active' and new.state in ('retired', 'revoked'))
    or (old.state = 'retired' and new.state in ('active', 'revoked'))
  ) then
    raise exception 'site_release_state_transition_refused';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists ghost_agency_site_releases_immutability_guard on public.ghost_agency_site_releases;
create trigger ghost_agency_site_releases_immutability_guard
before update or delete on public.ghost_agency_site_releases
for each row execute function public.guard_ghost_agency_site_release_immutability();

-- Site registration never overwrites a slug owned by another immutable id.
create or replace function ghost_agency_private.register_shared_site(
  p_site_id uuid,
  p_canonical_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ghost_agency_sites(site_id, canonical_slug)
  values (p_site_id, p_canonical_slug);
  return jsonb_build_object('ok', true, 'site_id', p_site_id, 'generation', 0);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'site_or_slug_already_registered');
  when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_site_identity');
end
$$;

-- Publisher entry point for a stable database-owned site UUID.  The slug and
-- its one canonical wildcard host are one identity: exact retries return the
-- same row, while a host owned by another row or a retired tombstone fails
-- closed.  The advisory transaction lock makes two first-publish requests for
-- the same slug serialize without widening any table grants.
create or replace function ghost_agency_private.ensure_shared_site_identity(
  p_canonical_slug text,
  p_normalized_host text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.ghost_agency_sites%rowtype;
  v_host public.ghost_agency_site_hosts%rowtype;
  v_site_id uuid;
  v_created boolean := false;
begin
  if p_canonical_slug is null
    or p_normalized_host is null
    or p_normalized_host is distinct from p_canonical_slug || '.wss-ai.com' then
    return jsonb_build_object('ok', false, 'reason', 'shared_site_identity_not_canonical');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ghost_agency_shared_site:' || p_canonical_slug, 0)
  );

  select * into v_site
    from public.ghost_agency_sites
   where canonical_slug = p_canonical_slug
   for update;

  if found then
    if not v_site.enabled or v_site.serve_mode = 'disabled' then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_disabled');
    end if;
    v_site_id := v_site.site_id;
  else
    select * into v_host
      from public.ghost_agency_site_hosts
     where normalized_host = p_normalized_host
     for update;
    if found then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_host_identity_conflict');
    end if;

    v_site_id := pg_catalog.gen_random_uuid();
    insert into public.ghost_agency_sites(site_id, canonical_slug)
    values (v_site_id, p_canonical_slug)
    returning * into v_site;
    v_created := true;
  end if;

  select * into v_host
    from public.ghost_agency_site_hosts
   where normalized_host = p_normalized_host
   for update;

  if found then
    if v_host.site_id is distinct from v_site_id then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_host_identity_conflict');
    end if;
    if v_host.tombstoned_at is not null or v_host.status = 'retired' then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_host_tombstoned');
    end if;
  else
    insert into public.ghost_agency_site_hosts(
      normalized_host, site_id, status, is_primary
    ) values (
      p_normalized_host, v_site_id, 'pending', false
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'site_id', v_site_id,
    'canonical_slug', p_canonical_slug,
    'canonical_host', p_normalized_host,
    'generation', v_site.generation,
    'created', v_created
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'shared_site_identity_conflict');
  when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'shared_site_identity_not_canonical');
end
$$;

-- Read the exact registry generation before staging generation + 1.  Active
-- proof fields are returned together so a publisher retry can prove that its
-- deterministic release already won without uploading or activating again.
-- `generation` is the monotonic site CAS generation; the active release's
-- immutable public generation is returned separately.
create or replace function ghost_agency_private.read_shared_site_generation(
  p_site_id uuid,
  p_canonical_slug text,
  p_normalized_host text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site public.ghost_agency_sites%rowtype;
  v_release public.ghost_agency_site_releases%rowtype;
  v_quarantined public.ghost_agency_site_releases%rowtype;
begin
  select s.* into v_site
    from public.ghost_agency_sites s
    join public.ghost_agency_site_hosts h
      on h.site_id = s.site_id
     and h.normalized_host = p_normalized_host
     and h.status in ('pending', 'active')
     and h.tombstoned_at is null
   where s.site_id = p_site_id
     and s.canonical_slug = p_canonical_slug
     and p_normalized_host = p_canonical_slug || '.wss-ai.com'
     and s.enabled
     and s.serve_mode <> 'disabled'
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'shared_site_identity_not_registered');
  end if;

  if v_site.active_release_id is not null then
    if v_site.serve_mode <> 'shared' then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_active_release_inconsistent');
    end if;
    select * into v_release
      from public.ghost_agency_site_releases
     where site_id = v_site.site_id
       and release_id = v_site.active_release_id
       and canonical_host = p_normalized_host
       and state = 'active'
       and exists (
         select 1 from public.ghost_agency_site_hosts active_host
          where active_host.site_id = v_site.site_id
            and active_host.normalized_host = p_normalized_host
            and active_host.status = 'active'
            and active_host.is_primary
            and active_host.tombstoned_at is null
       );
    if not found or v_release.published_generation > v_site.generation then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_active_release_inconsistent');
    end if;
  elsif v_site.generation = 0 then
    if v_site.previous_release_id is not null or v_site.serve_mode <> 'legacy' then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_inactive_identity_inconsistent');
    end if;
  else
    -- A failed activation with no prior active release is quarantined without
    -- resetting generation.
    -- The exact revoked release row is the durable retry receipt while both
    -- mutable release slots remain empty; new work stages at generation + 1.
    if v_site.serve_mode <> 'legacy' or v_site.previous_release_id is not null then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_generation_without_active_release');
    end if;
    select * into v_quarantined
      from public.ghost_agency_site_releases
     where site_id = v_site.site_id
       and canonical_host = p_normalized_host
       and published_generation = v_site.generation - 1
       and state = 'revoked';
    if not found or (
      select count(*) from public.ghost_agency_site_releases
       where site_id = v_site.site_id
         and canonical_host = p_normalized_host
         and published_generation = v_site.generation - 1
         and state = 'revoked'
    ) <> 1 or exists (
      select 1 from public.ghost_agency_site_releases active_release
       where active_release.site_id = v_site.site_id
         and active_release.state = 'active'
    ) or not exists (
      select 1 from public.ghost_agency_site_hosts inactive_host
       where inactive_host.site_id = v_site.site_id
         and inactive_host.normalized_host = p_normalized_host
         and inactive_host.status = 'pending'
         and not inactive_host.is_primary
         and inactive_host.tombstoned_at is null
    ) then
      return jsonb_build_object('ok', false, 'reason', 'shared_site_quarantine_inconsistent');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'site_id', v_site.site_id,
    'canonical_slug', v_site.canonical_slug,
    'canonical_host', p_normalized_host,
    'generation', v_site.generation,
    'active_release_id', v_release.release_id,
    'active_build_hash', v_release.build_hash,
    'active_manifest_path', v_release.manifest_path,
    'active_manifest_sha256', v_release.manifest_sha256,
    'active_published_generation', v_release.published_generation,
    'active_deployment_env', v_release.deployment_env
  );
end
$$;

-- Host claims are insert-first.  A conflict can only update the same active
-- tenant; a different tenant and every retired tombstone are hard refusals.
create or replace function ghost_agency_private.register_site_host(
  p_normalized_host text,
  p_site_id uuid,
  p_status text default 'pending',
  p_is_primary boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer := 0;
begin
  if p_status not in ('pending', 'active') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_host_status');
  end if;
  if not exists (
    select 1 from public.ghost_agency_sites
     where site_id = p_site_id
       and p_normalized_host = canonical_slug || '.wss-ai.com'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'host_not_canonical_slug_for_site');
  end if;
  insert into public.ghost_agency_site_hosts(normalized_host, site_id, status, is_primary)
  values (p_normalized_host, p_site_id, p_status, p_is_primary)
  on conflict (normalized_host) do update
    set status = excluded.status,
        is_primary = excluded.is_primary,
        updated_at = clock_timestamp()
    where ghost_agency_site_hosts.site_id = excluded.site_id
      and ghost_agency_site_hosts.tombstoned_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'host_owned_or_tombstoned');
  end if;
  return jsonb_build_object('ok', true, 'normalized_host', p_normalized_host, 'site_id', p_site_id);
exception
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'site_not_registered');
  when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_host');
end
$$;

create or replace function ghost_agency_private.retire_site_host(
  p_normalized_host text,
  p_site_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer := 0;
begin
  update public.ghost_agency_site_hosts
     set status = 'retired', is_primary = false
   where normalized_host = p_normalized_host
     and site_id = p_site_id
     and tombstoned_at is null;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'host_not_owned_or_already_tombstoned');
  end if;
  return jsonb_build_object('ok', true, 'normalized_host', p_normalized_host, 'site_id', p_site_id);
end
$$;

-- The app creates the DB checkpoint before any insert-only object uploads.
-- An existing release_id or object prefix is never treated as an upsert.
create or replace function ghost_agency_private.stage_site_release(
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_manifest_path text,
  p_manifest_sha256 text,
  p_canonical_host text,
  p_published_generation bigint,
  p_deployment_env text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_path text := 'sites/' || p_site_id::text || '/releases/' || p_release_id::text || '/manifest.json';
  v_existing public.ghost_agency_site_releases%rowtype;
begin
  if p_manifest_path is distinct from v_expected_path then
    return jsonb_build_object('ok', false, 'reason', 'manifest_path_not_immutable_prefix');
  end if;

  -- A retry may arrive after any later valid state.  It is successful only
  -- when every immutable proof field is byte-for-byte the same; release-id
  -- reuse with a different tuple never becomes an upsert.
  select * into v_existing
    from public.ghost_agency_site_releases
   where release_id = p_release_id;
  if found then
    if v_existing.site_id = p_site_id
      and v_existing.build_hash = p_build_hash
      and v_existing.manifest_path = p_manifest_path
      and v_existing.manifest_sha256 = p_manifest_sha256
      and v_existing.canonical_host = p_canonical_host
      and v_existing.published_generation = p_published_generation
      and v_existing.deployment_env = p_deployment_env
      and v_existing.state in ('staged', 'verified', 'active', 'retired') then
      return jsonb_build_object(
        'ok', true,
        'site_id', p_site_id,
        'release_id', p_release_id,
        'state', v_existing.state,
        'idempotent', true
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'release_identity_conflict');
  end if;

  if not exists (
    select 1 from public.ghost_agency_sites
     where site_id = p_site_id
       and p_canonical_host = canonical_slug || '.wss-ai.com'
       and p_published_generation = generation + 1
  ) then
    return jsonb_build_object('ok', false, 'reason', 'release_host_or_generation_not_current');
  end if;
  insert into public.ghost_agency_site_releases(
    release_id, site_id, build_hash, manifest_path, manifest_sha256,
    canonical_host, published_generation, deployment_env, state
  ) values (
    p_release_id, p_site_id, p_build_hash, p_manifest_path, p_manifest_sha256,
    p_canonical_host, p_published_generation, p_deployment_env, 'staged'
  );
  return jsonb_build_object('ok', true, 'site_id', p_site_id, 'release_id', p_release_id, 'state', 'staged');
exception
  when unique_violation then
    select * into v_existing
      from public.ghost_agency_site_releases
     where release_id = p_release_id;
    if found
      and v_existing.site_id = p_site_id
      and v_existing.build_hash = p_build_hash
      and v_existing.manifest_path = p_manifest_path
      and v_existing.manifest_sha256 = p_manifest_sha256
      and v_existing.canonical_host = p_canonical_host
      and v_existing.published_generation = p_published_generation
      and v_existing.deployment_env = p_deployment_env
      and v_existing.state in ('staged', 'verified', 'active', 'retired') then
      return jsonb_build_object(
        'ok', true,
        'site_id', p_site_id,
        'release_id', p_release_id,
        'state', v_existing.state,
        'idempotent', true
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'release_identity_conflict');
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'site_not_registered');
  when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_release_proof');
end
$$;

-- Only the application-side hash readback path calls this CAS transition.
create or replace function ghost_agency_private.verify_site_release(
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_manifest_path text,
  p_manifest_sha256 text,
  p_canonical_host text,
  p_published_generation bigint,
  p_deployment_env text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer := 0;
  v_existing public.ghost_agency_site_releases%rowtype;
begin
  update public.ghost_agency_site_releases
     set state = 'verified', verified_at = clock_timestamp()
   where site_id = p_site_id
     and release_id = p_release_id
     and build_hash = p_build_hash
     and manifest_path = p_manifest_path
     and manifest_sha256 = p_manifest_sha256
     and canonical_host = p_canonical_host
     and published_generation = p_published_generation
     and deployment_env = p_deployment_env
     and state = 'staged';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    select * into v_existing
      from public.ghost_agency_site_releases
     where release_id = p_release_id;
    if found
      and v_existing.site_id = p_site_id
      and v_existing.build_hash = p_build_hash
      and v_existing.manifest_path = p_manifest_path
      and v_existing.manifest_sha256 = p_manifest_sha256
      and v_existing.canonical_host = p_canonical_host
      and v_existing.published_generation = p_published_generation
      and v_existing.deployment_env = p_deployment_env
      and v_existing.state in ('verified', 'active', 'retired') then
      return jsonb_build_object(
        'ok', true,
        'site_id', p_site_id,
        'release_id', p_release_id,
        'state', v_existing.state,
        'idempotent', true
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'release_verify_cas_refused');
  end if;
  return jsonb_build_object('ok', true, 'site_id', p_site_id, 'release_id', p_release_id, 'state', 'verified');
end
$$;

-- Compare-and-swap activation.  The release ownership predicate is part of
-- the SELECT, so a release_id from a different tenant is indistinguishable
-- from a missing release and can never cross the boundary.
-- Remove the pre-environment overloads on idempotent re-apply; changing a
-- PostgreSQL function signature creates an overload instead of replacing it.
drop function if exists public.activate_site_release(uuid, bigint, uuid);
drop function if exists public.rollback_site_release(uuid, bigint, uuid);
drop function if exists public.quarantine_site_release(uuid, bigint, uuid);
drop function if exists ghost_agency_private.activate_site_release(uuid, bigint, uuid);
drop function if exists ghost_agency_private.rollback_site_release(uuid, bigint, uuid);
drop function if exists ghost_agency_private.quarantine_site_release(uuid, bigint, uuid);

create or replace function ghost_agency_private.activate_site_release(
  p_site_id uuid,
  p_expected_generation bigint,
  p_release_id uuid,
  p_deployment_env text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.ghost_agency_sites%rowtype;
  v_target public.ghost_agency_site_releases%rowtype;
  v_generation bigint;
begin
  if p_expected_generation is null
    or p_expected_generation < 0
    or p_expected_generation = 9223372036854775807 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_expected_generation');
  end if;
  select * into v_site
    from public.ghost_agency_sites
   where site_id = p_site_id
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'site_not_registered'); end if;
  if not v_site.enabled or v_site.serve_mode = 'disabled' then
    return jsonb_build_object('ok', false, 'reason', 'site_disabled');
  end if;

  -- Exact retry after the commit: the requested release already owns the
  -- generation this CAS would have created.  Nothing is rewritten.
  if v_site.serve_mode = 'shared'
    and v_site.generation = p_expected_generation + 1
    and v_site.active_release_id = p_release_id then
    select * into v_target
      from public.ghost_agency_site_releases
     where site_id = p_site_id
       and release_id = p_release_id
       and deployment_env = p_deployment_env
       and published_generation = p_expected_generation + 1
       and state = 'active';
    if found and exists (
      select 1 from public.ghost_agency_site_hosts
       where normalized_host = v_target.canonical_host
         and site_id = p_site_id
         and status = 'active'
         and is_primary
         and tombstoned_at is null
    ) then
      return jsonb_build_object(
        'ok', true,
        'site_id', p_site_id,
        'release_id', p_release_id,
        'generation', v_site.generation,
        'idempotent', true
      );
    end if;
  end if;
  if v_site.generation <> p_expected_generation then
    return jsonb_build_object('ok', false, 'reason', 'generation_conflict', 'generation', v_site.generation);
  end if;
  if v_site.active_release_id is not null and not exists (
    select 1 from public.ghost_agency_site_releases
     where site_id = p_site_id
       and release_id = v_site.active_release_id
       and deployment_env = p_deployment_env
  ) then
    return jsonb_build_object('ok', false, 'reason', 'active_release_environment_conflict');
  end if;

  select * into v_target
    from public.ghost_agency_site_releases
   where site_id = p_site_id
     and release_id = p_release_id
     and deployment_env = p_deployment_env;
  if not found then return jsonb_build_object('ok', false, 'reason', 'release_not_owned_by_site'); end if;
  if v_target.state <> 'verified' then
    return jsonb_build_object('ok', false, 'reason', 'release_not_verified');
  end if;
  if v_target.published_generation <> p_expected_generation + 1 then
    return jsonb_build_object('ok', false, 'reason', 'release_published_for_different_generation');
  end if;
  if not exists (
    select 1 from public.ghost_agency_site_hosts
     where normalized_host = v_target.canonical_host
       and site_id = p_site_id
       and status in ('pending', 'active')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'release_host_not_owned_by_site');
  end if;

  if v_site.active_release_id is not null then
    update public.ghost_agency_site_releases
       set state = 'retired', retired_at = clock_timestamp()
     where site_id = p_site_id
       and release_id = v_site.active_release_id
       and state = 'active';
  end if;
  update public.ghost_agency_site_releases
     set state = 'active', activated_at = clock_timestamp(), retired_at = null
   where site_id = p_site_id and release_id = p_release_id and state = 'verified';

  update public.ghost_agency_site_hosts
     set is_primary = false
   where site_id = p_site_id
     and normalized_host <> v_target.canonical_host
     and status = 'active'
     and is_primary;
  update public.ghost_agency_site_hosts
     set status = 'active', is_primary = true
   where site_id = p_site_id
     and normalized_host = v_target.canonical_host
     and status in ('pending', 'active');

  update public.ghost_agency_sites
     set previous_release_id = active_release_id,
         active_release_id = p_release_id,
         generation = generation + 1,
         serve_mode = 'shared',
         updated_at = clock_timestamp()
   where site_id = p_site_id and generation = p_expected_generation
   returning generation into v_generation;
  if not found then raise exception 'activate_site_release_internal_cas_lost'; end if;
  return jsonb_build_object('ok', true, 'site_id', p_site_id, 'release_id', p_release_id, 'generation', v_generation);
end
$$;

-- Rollback is also a CAS and only targets the site's recorded previous slot.
-- A caller cannot nominate an arbitrary release, including another site's.
create or replace function ghost_agency_private.rollback_site_release(
  p_site_id uuid,
  p_expected_generation bigint,
  p_release_id uuid,
  p_deployment_env text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.ghost_agency_sites%rowtype;
  v_target public.ghost_agency_site_releases%rowtype;
  v_old_active uuid;
  v_generation bigint;
begin
  if p_expected_generation is null
    or p_expected_generation < 0
    or p_expected_generation = 9223372036854775807 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_expected_generation');
  end if;
  select * into v_site
    from public.ghost_agency_sites
   where site_id = p_site_id
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'site_not_registered'); end if;
  if not v_site.enabled or v_site.serve_mode <> 'shared' then
    return jsonb_build_object('ok', false, 'reason', 'site_not_shared');
  end if;

  -- A completed rollback increments generation but reactivates an older
  -- immutable release.  That exact desired state is a safe retry success;
  -- normal first-time activation is excluded by the older published generation.
  if v_site.generation = p_expected_generation + 1
    and v_site.active_release_id = p_release_id
    and v_site.previous_release_id is not null
    and v_site.previous_release_id is distinct from p_release_id then
    select * into v_target
      from public.ghost_agency_site_releases
     where site_id = p_site_id
       and release_id = p_release_id
       and deployment_env = p_deployment_env
       and published_generation < p_expected_generation + 1
       and state = 'active';
    if found and exists (
      select 1 from public.ghost_agency_site_hosts
       where normalized_host = v_target.canonical_host
         and site_id = p_site_id
         and status = 'active'
         and is_primary
         and tombstoned_at is null
    ) then
      return jsonb_build_object(
        'ok', true,
        'site_id', p_site_id,
        'release_id', p_release_id,
        'generation', v_site.generation,
        'idempotent', true
      );
    end if;
  end if;
  if v_site.generation <> p_expected_generation then
    return jsonb_build_object('ok', false, 'reason', 'generation_conflict', 'generation', v_site.generation);
  end if;
  if v_site.active_release_id is null or not exists (
    select 1 from public.ghost_agency_site_releases
     where site_id = p_site_id
       and release_id = v_site.active_release_id
       and deployment_env = p_deployment_env
  ) then
    return jsonb_build_object('ok', false, 'reason', 'active_release_environment_conflict');
  end if;
  if v_site.previous_release_id is null or v_site.previous_release_id is distinct from p_release_id then
    return jsonb_build_object('ok', false, 'reason', 'release_not_recorded_previous');
  end if;

  select * into v_target
    from public.ghost_agency_site_releases
   where site_id = p_site_id
     and release_id = p_release_id
     and deployment_env = p_deployment_env;
  if not found then return jsonb_build_object('ok', false, 'reason', 'release_not_owned_by_site'); end if;
  if v_target.state not in ('retired', 'verified') then
    return jsonb_build_object('ok', false, 'reason', 'rollback_release_not_eligible');
  end if;
  if not exists (
    select 1 from public.ghost_agency_site_hosts
     where normalized_host = v_target.canonical_host
       and site_id = p_site_id
       and status in ('pending', 'active')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'rollback_host_not_owned_by_site');
  end if;

  v_old_active := v_site.active_release_id;
  update public.ghost_agency_site_releases
     set state = 'retired', retired_at = clock_timestamp()
   where site_id = p_site_id and release_id = v_old_active and state = 'active';
  update public.ghost_agency_site_releases
     set state = 'active', activated_at = clock_timestamp(), retired_at = null
   where site_id = p_site_id and release_id = p_release_id and state in ('retired', 'verified');
  update public.ghost_agency_site_hosts
     set is_primary = false
   where site_id = p_site_id
     and normalized_host <> v_target.canonical_host
     and status = 'active'
     and is_primary;
  update public.ghost_agency_site_hosts
     set status = 'active', is_primary = true
   where site_id = p_site_id
     and normalized_host = v_target.canonical_host
     and status in ('pending', 'active');
  update public.ghost_agency_sites
     set active_release_id = p_release_id,
         previous_release_id = v_old_active,
         generation = generation + 1,
         updated_at = clock_timestamp()
   where site_id = p_site_id and generation = p_expected_generation
   returning generation into v_generation;
  if not found then raise exception 'rollback_site_release_internal_cas_lost'; end if;
  return jsonb_build_object('ok', true, 'site_id', p_site_id, 'release_id', p_release_id, 'generation', v_generation);
end
$$;

-- An activation from an inactive state has no previous release to restore. If
-- its exact public bytes cannot be proved, quarantine that failed tuple with a
-- second monotonic CAS. The site becomes non-shared with no active pointer; the
-- revoked release row remains the idempotent receipt while both mutable
-- release slots stay empty; it can never be restaged or previewed.
create or replace function ghost_agency_private.quarantine_site_release(
  p_site_id uuid,
  p_expected_generation bigint,
  p_failed_release_id uuid,
  p_deployment_env text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.ghost_agency_sites%rowtype;
  v_failed public.ghost_agency_site_releases%rowtype;
  v_generation bigint;
begin
  if p_expected_generation is null
    or p_expected_generation < 1
    or p_expected_generation = 9223372036854775807 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_expected_generation');
  end if;
  select * into v_site
    from public.ghost_agency_sites
   where site_id = p_site_id
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'site_not_registered'); end if;

  -- Exact retry after the quarantine commit. No state is rewritten and the
  -- generation remains the one created by the original compensation CAS.
  if v_site.enabled
    and v_site.serve_mode = 'legacy'
    and v_site.generation = p_expected_generation + 1
    and v_site.active_release_id is null
    and v_site.previous_release_id is null then
    select * into v_failed
      from public.ghost_agency_site_releases
     where site_id = p_site_id
       and release_id = p_failed_release_id
       and deployment_env = p_deployment_env
       and published_generation = p_expected_generation
       and state = 'revoked';
    if found and exists (
      select 1 from public.ghost_agency_site_hosts
       where normalized_host = v_failed.canonical_host
         and site_id = p_site_id
         and status = 'pending'
         and not is_primary
         and tombstoned_at is null
    ) and not exists (
      select 1 from public.ghost_agency_site_preview_grants
       where site_id = p_site_id
         and release_id = p_failed_release_id
         and build_hash = v_failed.build_hash
         and deployment_env = p_deployment_env
         and used_at is null
         and revoked_at is null
    ) then
      return jsonb_build_object(
        'ok', true,
        'site_id', p_site_id,
        'release_id', p_failed_release_id,
        'generation', v_site.generation,
        'state', 'quarantined',
        'idempotent', true
      );
    end if;
  end if;

  if v_site.generation <> p_expected_generation then
    return jsonb_build_object('ok', false, 'reason', 'generation_conflict', 'generation', v_site.generation);
  end if;
  if not v_site.enabled or v_site.serve_mode <> 'shared' then
    return jsonb_build_object('ok', false, 'reason', 'site_not_active_shared');
  end if;
  if v_site.active_release_id is distinct from p_failed_release_id then
    return jsonb_build_object('ok', false, 'reason', 'failed_release_not_active');
  end if;
  if v_site.previous_release_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'previous_release_available_use_rollback');
  end if;

  select * into v_failed
    from public.ghost_agency_site_releases
   where site_id = p_site_id
     and release_id = p_failed_release_id
     and deployment_env = p_deployment_env
     and published_generation = p_expected_generation
     and state = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'failed_release_identity_mismatch'); end if;
  if not exists (
    select 1 from public.ghost_agency_site_hosts
     where normalized_host = v_failed.canonical_host
       and site_id = p_site_id
       and status = 'active'
       and is_primary
       and tombstoned_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'failed_release_host_not_active');
  end if;

  update public.ghost_agency_site_releases
     set state = 'revoked', revoked_at = clock_timestamp(), retired_at = null
   where site_id = p_site_id
     and release_id = p_failed_release_id
     and deployment_env = p_deployment_env
     and published_generation = p_expected_generation
     and state = 'active';
  if not found then raise exception 'quarantine_site_release_internal_release_cas_lost'; end if;

  update public.ghost_agency_site_hosts
     set status = 'pending', is_primary = false
   where normalized_host = v_failed.canonical_host
     and site_id = p_site_id
     and status = 'active'
     and is_primary
     and tombstoned_at is null;
  if not found then raise exception 'quarantine_site_release_internal_host_cas_lost'; end if;

  update public.ghost_agency_site_preview_grants
     set revoked_at = clock_timestamp()
   where site_id = p_site_id
     and release_id = p_failed_release_id
     and build_hash = v_failed.build_hash
     and deployment_env = p_deployment_env
     and used_at is null
     and revoked_at is null;

  update public.ghost_agency_sites
     set previous_release_id = null,
         active_release_id = null,
         generation = generation + 1,
         serve_mode = 'legacy',
         updated_at = clock_timestamp()
   where site_id = p_site_id
     and generation = p_expected_generation
     and active_release_id = p_failed_release_id
     and previous_release_id is null
     and serve_mode = 'shared'
   returning generation into v_generation;
  if not found then raise exception 'quarantine_site_release_internal_site_cas_lost'; end if;
  return jsonb_build_object(
    'ok', true,
    'site_id', p_site_id,
    'release_id', p_failed_release_id,
    'generation', v_generation,
    'state', 'quarantined'
  );
end
$$;

-- Public serving sees one complete active snapshot or no row. Its generation
-- stays bound to the immutable release manifest even after a monotonic CAS
-- rollback advances the site registry generation.
create or replace function ghost_agency_private.resolve_shared_site(
  p_slug text default null,
  p_host text default null,
  p_deployment_env text default null
)
returns table (
  site_id uuid,
  canonical_slug text,
  canonical_host text,
  release_id uuid,
  build_hash text,
  manifest_path text,
  manifest_sha256 text,
  deployment_env text,
  generation bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.site_id, s.canonical_slug, r.canonical_host, r.release_id, r.build_hash,
         r.manifest_path, r.manifest_sha256, r.deployment_env, r.published_generation
    from public.ghost_agency_sites s
    join public.ghost_agency_site_releases r
      on r.site_id = s.site_id
     and r.release_id = s.active_release_id
     and r.state = 'active'
    join public.ghost_agency_site_hosts h
      on h.site_id = s.site_id
     and h.normalized_host = r.canonical_host
     and h.status = 'active'
   where s.enabled
     and s.serve_mode = 'shared'
     and s.generation >= 1
     and (p_slug is null or s.canonical_slug = p_slug)
     and (p_host is null or h.normalized_host = p_host)
     and p_deployment_env is not null
     and r.deployment_env = p_deployment_env
     and (p_slug is not null or p_host is not null)
   limit 1
$$;

-- A preview session is already HMAC-authenticated by the router.  This RPC
-- resolves only the complete signed tuple and environment; it never widens to
-- the site's active release and never exposes a staged/unverified release.
-- Generation 0 is the explicit pre-activation preview state. Public serving
-- still requires an active pointer and therefore starts at generation 1.
create or replace function ghost_agency_private.resolve_shared_site_preview(
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_slug text,
  p_deployment_env text
)
returns table (
  site_id uuid,
  canonical_slug text,
  canonical_host text,
  release_id uuid,
  build_hash text,
  manifest_path text,
  manifest_sha256 text,
  deployment_env text,
  generation bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.site_id, s.canonical_slug, r.canonical_host, r.release_id,
         r.build_hash, r.manifest_path, r.manifest_sha256,
         r.deployment_env, s.generation
    from public.ghost_agency_sites s
    join public.ghost_agency_site_releases r
      on r.site_id = s.site_id
     and r.release_id = p_release_id
     and r.build_hash = p_build_hash
     and r.deployment_env = p_deployment_env
     and r.state in ('verified', 'active')
    join public.ghost_agency_site_hosts h
      on h.site_id = s.site_id
     and h.normalized_host = r.canonical_host
     and h.status in ('pending', 'active')
   where s.site_id = p_site_id
     and s.canonical_slug = p_slug
     and s.enabled
     and s.serve_mode <> 'disabled'
   limit 1
$$;

create or replace function ghost_agency_private.register_site_preview_grant(
  p_jti_hash text,
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_deployment_env text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '5 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'preview_grant_ttl_refused');
  end if;
  if not exists (
    select 1
      from public.ghost_agency_site_releases
     where site_id = p_site_id
       and release_id = p_release_id
       and build_hash = p_build_hash
       and deployment_env = p_deployment_env
       and state in ('verified', 'active')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'preview_release_not_exact_or_verified');
  end if;
  insert into public.ghost_agency_site_preview_grants(
    jti_hash, site_id, release_id, build_hash, deployment_env, expires_at
  ) values (
    p_jti_hash, p_site_id, p_release_id, p_build_hash, p_deployment_env, p_expires_at
  );
  return jsonb_build_object('ok', true, 'jti_hash', p_jti_hash);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'preview_grant_jti_reused');
  when check_violation or foreign_key_violation then
    return jsonb_build_object('ok', false, 'reason', 'preview_grant_tuple_refused');
end
$$;

-- Atomic one-use exchange.  Exact tenant/release/build binding and expiry are
-- in the UPDATE predicate; a replay or cross-site token returns no grant.
create or replace function ghost_agency_private.consume_site_preview_grant(
  p_jti_hash text,
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_deployment_env text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.ghost_agency_site_preview_grants%rowtype;
  v_manifest_path text;
  v_slug text;
begin
  update public.ghost_agency_site_preview_grants
     set used_at = clock_timestamp()
   where jti_hash = p_jti_hash
     and site_id = p_site_id
     and release_id = p_release_id
     and build_hash = p_build_hash
     and deployment_env = p_deployment_env
     and used_at is null
     and revoked_at is null
     and expires_at > clock_timestamp()
   returning * into v_grant;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'preview_grant_not_found_expired_or_replayed');
  end if;

  select r.manifest_path, s.canonical_slug
    into v_manifest_path, v_slug
    from public.ghost_agency_site_releases r
    join public.ghost_agency_sites s on s.site_id = r.site_id
   where r.site_id = p_site_id
     and r.release_id = p_release_id
     and r.build_hash = p_build_hash
     and r.deployment_env = p_deployment_env
     and r.state in ('verified', 'active')
     and s.enabled;
  if not found then
    raise exception 'preview_grant_release_changed_after_registration';
  end if;
  return jsonb_build_object(
    'ok', true,
    'site_id', p_site_id,
    'release_id', p_release_id,
    'build_hash', p_build_hash,
    'deployment_env', p_deployment_env,
    'manifest_path', v_manifest_path,
    'slug', v_slug
  );
end
$$;

-- PostgREST-facing entry points stay in the exposed schema, but carry no
-- owner privilege.  Each SECURITY INVOKER wrapper delegates to one narrowly
-- granted implementation in ghost_agency_private.
create or replace function public.ensure_shared_site_identity(
  p_canonical_slug text,
  p_normalized_host text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.ensure_shared_site_identity(
    p_canonical_slug, p_normalized_host
  )
$$;

create or replace function public.read_shared_site_generation(
  p_site_id uuid,
  p_canonical_slug text,
  p_normalized_host text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select ghost_agency_private.read_shared_site_generation(
    p_site_id, p_canonical_slug, p_normalized_host
  )
$$;

create or replace function public.register_shared_site(
  p_site_id uuid,
  p_canonical_slug text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.register_shared_site(p_site_id, p_canonical_slug)
$$;

create or replace function public.register_site_host(
  p_normalized_host text,
  p_site_id uuid,
  p_status text default 'pending',
  p_is_primary boolean default false
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.register_site_host(
    p_normalized_host, p_site_id, p_status, p_is_primary
  )
$$;

create or replace function public.retire_site_host(
  p_normalized_host text,
  p_site_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.retire_site_host(p_normalized_host, p_site_id)
$$;

create or replace function public.stage_site_release(
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_manifest_path text,
  p_manifest_sha256 text,
  p_canonical_host text,
  p_published_generation bigint,
  p_deployment_env text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.stage_site_release(
    p_site_id, p_release_id, p_build_hash, p_manifest_path,
    p_manifest_sha256, p_canonical_host, p_published_generation,
    p_deployment_env
  )
$$;

create or replace function public.verify_site_release(
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_manifest_path text,
  p_manifest_sha256 text,
  p_canonical_host text,
  p_published_generation bigint,
  p_deployment_env text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.verify_site_release(
    p_site_id, p_release_id, p_build_hash, p_manifest_path,
    p_manifest_sha256, p_canonical_host, p_published_generation,
    p_deployment_env
  )
$$;

create or replace function public.activate_site_release(
  p_site_id uuid,
  p_expected_generation bigint,
  p_release_id uuid,
  p_deployment_env text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.activate_site_release(
    p_site_id, p_expected_generation, p_release_id, p_deployment_env
  )
$$;

create or replace function public.rollback_site_release(
  p_site_id uuid,
  p_expected_generation bigint,
  p_release_id uuid,
  p_deployment_env text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.rollback_site_release(
    p_site_id, p_expected_generation, p_release_id, p_deployment_env
  )
$$;

create or replace function public.quarantine_site_release(
  p_site_id uuid,
  p_expected_generation bigint,
  p_failed_release_id uuid,
  p_deployment_env text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.quarantine_site_release(
    p_site_id, p_expected_generation, p_failed_release_id, p_deployment_env
  )
$$;

create or replace function public.resolve_shared_site(
  p_slug text default null,
  p_host text default null,
  p_deployment_env text default null
)
returns table (
  site_id uuid,
  canonical_slug text,
  canonical_host text,
  release_id uuid,
  build_hash text,
  manifest_path text,
  manifest_sha256 text,
  deployment_env text,
  generation bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from ghost_agency_private.resolve_shared_site(
      p_slug, p_host, p_deployment_env
    )
$$;

create or replace function public.resolve_shared_site_preview(
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_slug text,
  p_deployment_env text
)
returns table (
  site_id uuid,
  canonical_slug text,
  canonical_host text,
  release_id uuid,
  build_hash text,
  manifest_path text,
  manifest_sha256 text,
  deployment_env text,
  generation bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from ghost_agency_private.resolve_shared_site_preview(
      p_site_id, p_release_id, p_build_hash, p_slug, p_deployment_env
    )
$$;

create or replace function public.register_site_preview_grant(
  p_jti_hash text,
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_deployment_env text,
  p_expires_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.register_site_preview_grant(
    p_jti_hash, p_site_id, p_release_id, p_build_hash,
    p_deployment_env, p_expires_at
  )
$$;

create or replace function public.consume_site_preview_grant(
  p_jti_hash text,
  p_site_id uuid,
  p_release_id uuid,
  p_build_hash text,
  p_deployment_env text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select ghost_agency_private.consume_site_preview_grant(
    p_jti_hash, p_site_id, p_release_id, p_build_hash, p_deployment_env
  )
$$;

alter table public.ghost_agency_sites enable row level security;
alter table public.ghost_agency_site_hosts enable row level security;
alter table public.ghost_agency_site_releases enable row level security;
alter table public.ghost_agency_site_preview_grants enable row level security;

revoke all on table public.ghost_agency_sites from public, anon, authenticated, service_role;
revoke all on table public.ghost_agency_site_hosts from public, anon, authenticated, service_role;
revoke all on table public.ghost_agency_site_releases from public, anon, authenticated, service_role;
revoke all on table public.ghost_agency_site_preview_grants from public, anon, authenticated, service_role;

-- Keep the release bucket private and bounded to the same 64 MiB limit as the
-- publisher/router contract. The database grants no direct reader role; the
-- backend proxy mints only exact, short-lived object URLs after HMAC auth.
insert into storage.buckets(id, name, public, file_size_limit)
values ('wss-site-releases', 'wss-site-releases', false, 67108864)
on conflict (id) do update
  set public = false,
      file_size_limit = least(
        coalesce(storage.buckets.file_size_limit, 67108864),
        67108864
      );

-- No exposed function owns table-bypassing privilege. Callers need both the
-- exact public wrapper grant and the matching private implementation grant.
revoke all on schema ghost_agency_private
  from public, anon, authenticated, service_role;
grant usage on schema ghost_agency_private to service_role;

revoke all on function ghost_agency_private.ensure_shared_site_identity(text, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.read_shared_site_generation(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.register_shared_site(uuid, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.register_site_host(text, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.retire_site_host(text, uuid) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.stage_site_release(uuid, uuid, text, text, text, text, bigint, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.verify_site_release(uuid, uuid, text, text, text, text, bigint, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.activate_site_release(uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.rollback_site_release(uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.quarantine_site_release(uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.resolve_shared_site(text, text, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.resolve_shared_site_preview(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.register_site_preview_grant(text, uuid, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function ghost_agency_private.consume_site_preview_grant(text, uuid, uuid, text, text) from public, anon, authenticated, service_role;

grant execute on function ghost_agency_private.ensure_shared_site_identity(text, text) to service_role;
grant execute on function ghost_agency_private.read_shared_site_generation(uuid, text, text) to service_role;
grant execute on function ghost_agency_private.register_shared_site(uuid, text) to service_role;
grant execute on function ghost_agency_private.register_site_host(text, uuid, text, boolean) to service_role;
grant execute on function ghost_agency_private.retire_site_host(text, uuid) to service_role;
grant execute on function ghost_agency_private.stage_site_release(uuid, uuid, text, text, text, text, bigint, text) to service_role;
grant execute on function ghost_agency_private.verify_site_release(uuid, uuid, text, text, text, text, bigint, text) to service_role;
grant execute on function ghost_agency_private.activate_site_release(uuid, bigint, uuid, text) to service_role;
grant execute on function ghost_agency_private.rollback_site_release(uuid, bigint, uuid, text) to service_role;
grant execute on function ghost_agency_private.quarantine_site_release(uuid, bigint, uuid, text) to service_role;
grant execute on function ghost_agency_private.register_site_preview_grant(text, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function ghost_agency_private.resolve_shared_site(text, text, text) to service_role;
grant execute on function ghost_agency_private.resolve_shared_site_preview(uuid, uuid, text, text, text) to service_role;
grant execute on function ghost_agency_private.consume_site_preview_grant(text, uuid, uuid, text, text) to service_role;

revoke all on function public.ensure_shared_site_identity(text, text) from public, anon, authenticated, service_role;
revoke all on function public.read_shared_site_generation(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.register_shared_site(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.guard_ghost_agency_site_host_tombstone() from public, anon, authenticated, service_role;
revoke all on function public.guard_ghost_agency_site_release_immutability() from public, anon, authenticated, service_role;
revoke all on function public.register_site_host(text, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.retire_site_host(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.stage_site_release(uuid, uuid, text, text, text, text, bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.verify_site_release(uuid, uuid, text, text, text, text, bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.activate_site_release(uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.rollback_site_release(uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.quarantine_site_release(uuid, bigint, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_shared_site(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_shared_site_preview(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.register_site_preview_grant(text, uuid, uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.consume_site_preview_grant(text, uuid, uuid, text, text) from public, anon, authenticated, service_role;

grant execute on function public.ensure_shared_site_identity(text, text) to service_role;
grant execute on function public.read_shared_site_generation(uuid, text, text) to service_role;
grant execute on function public.register_shared_site(uuid, text) to service_role;
grant execute on function public.register_site_host(text, uuid, text, boolean) to service_role;
grant execute on function public.retire_site_host(text, uuid) to service_role;
grant execute on function public.stage_site_release(uuid, uuid, text, text, text, text, bigint, text) to service_role;
grant execute on function public.verify_site_release(uuid, uuid, text, text, text, text, bigint, text) to service_role;
grant execute on function public.activate_site_release(uuid, bigint, uuid, text) to service_role;
grant execute on function public.rollback_site_release(uuid, bigint, uuid, text) to service_role;
grant execute on function public.quarantine_site_release(uuid, bigint, uuid, text) to service_role;
grant execute on function public.register_site_preview_grant(text, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.resolve_shared_site(text, text, text) to service_role;
grant execute on function public.resolve_shared_site_preview(uuid, uuid, text, text, text) to service_role;
grant execute on function public.consume_site_preview_grant(text, uuid, uuid, text, text) to service_role;

comment on table public.ghost_agency_sites is
  'Tenant registry and CAS pointer to one immutable active shared-site release.';
comment on table public.ghost_agency_site_hosts is
  'Global hostname registry. Retired rows are permanent anti-reuse tombstones.';
comment on table public.ghost_agency_site_releases is
  'Immutable release identities and manifest proofs; never mutable source archives.';
comment on table public.ghost_agency_site_preview_grants is
  'Hashed, exact-tuple, five-minute, one-use preview grants.';

commit;
