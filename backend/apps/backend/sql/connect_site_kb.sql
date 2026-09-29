-- Grounding layer for the website chat bubble: a real slug index on prospects,
-- and per-site owner preferences for the assistant that answers in it.
--
-- Everything here is ADDITIVE and re-runnable. Nothing is dropped, no row is
-- rewritten by an UPDATE, and no existing column changes type.
--
-- See apps/backend/lib/connect-site-kb.js (the knowledge base) and
-- apps/backend/lib/connect-site-settings.js (these preferences).


-- ---------------------------------------------------------------------------
-- 1. ghost_agency_prospects.site_slug — the routing key, as a real column.
-- ---------------------------------------------------------------------------
--
-- WHY. Every public lookup that turns a browser's slug into a business does the
-- same thing today: `preview_url=ilike.*<slug>*&limit=25`, then an exact
-- slugFromHost() match in JavaScript over whatever came back. Two defects, and
-- they were measured on production (2026-08-11) rather than assumed:
--
--   · REAL NOW. Unindexed sequential scan. `explain analyze` reports "Rows
--     Removed by Filter: 1332" at 0.797ms, per lookup, on a public
--     unauthenticated endpoint, growing with the funnel. The indexed equality
--     below plans as a Bitmap Index Scan at 0.039ms and stays flat.
--   · LATENT. `limit=25` is applied BEFORE the exact match, so a slug appearing
--     as a substring of 25 other preview URLs would push its own row out of the
--     window and resolve to "unknown site". Checked: the worst substring
--     fan-out across every live slug is 1, so nothing can hit this today. It is
--     a trap for a future fleet with shorter, more-shared slugs — the shortest
--     live slug is already `salon-icon` — not a live bug.
--
-- A GENERATED column rather than a trigger, deliberately:
--   · it is computed for all 1,333 existing rows by this ALTER, so there is no
--     backfill UPDATE — which matters because an UPDATE would touch every
--     prospect row and any updated_at maintenance hanging off it, and the
--     pipeline orders work by updated_at;
--   · it cannot drift from preview_url, ever, by any write path;
--   · there is no trigger function for a later migration to forget.
--
-- The parser below mirrors slugFromHost() in apps/backend/lib/mirror-lead.js
-- step for step: strip the scheme, cut at the first / ? #, drop any userinfo and
-- port, lowercase, REQUIRE the .wss-ai.com suffix (endsWith, not "contains" —
-- `evil.wss-ai.com.attacker.example` must resolve to nothing), then take the
-- last label before the suffix. It is written with split_part rather than a
-- regex so it depends on nothing about Postgres' regex flavour. Shape
-- validation (SLUG_RE) stays in JavaScript, which is the only place that
-- decides whether a slug may be used as a routing key.
--
-- IMMUTABLE is a promise, and a generated column banks on it: if this body is
-- ever changed with CREATE OR REPLACE, Postgres will NOT recompute the stored
-- values. Changing the parse rule means dropping and re-adding the column.
create or replace function public.wss_mirror_slug(url text)
returns text
language sql
immutable
parallel safe
as $$
  with host as (
    select split_part(
             reverse(split_part(reverse(
               split_part(split_part(split_part(
                 lower(regexp_replace(coalesce(url, ''), '^[A-Za-z][A-Za-z0-9+.-]*://', '')),
               '/', 1), '?', 1), '#', 1)
             ), '@', 1)),
           ':', 1) as h
  )
  select case
    when right(h, 11) <> '.wss-ai.com' then null
    else nullif(reverse(split_part(reverse(left(h, length(h) - 11)), '.', 1)), '')
  end
  from host;
$$;

comment on function public.wss_mirror_slug(text) is
  'Mirror host label from a preview URL. Mirrors slugFromHost() in apps/backend/lib/mirror-lead.js. IMMUTABLE: changing it does not recompute generated columns built on it.';

alter table public.ghost_agency_prospects
  add column if not exists site_slug text
  generated always as (public.wss_mirror_slug(preview_url)) stored;

comment on column public.ghost_agency_prospects.site_slug is
  'Mirror host label parsed from preview_url (https://<site_slug>.wss-ai.com/). Generated; mirrors slugFromHost() in lib/mirror-lead.js.';

-- Partial: only ~158 of 1,333 rows have a preview_url at all, so the index is
-- the size of the deployed fleet rather than the size of the funnel.
create index if not exists ghost_agency_prospects_site_slug_idx
  on public.ghost_agency_prospects (site_slug)
  where site_slug is not null;


-- ---------------------------------------------------------------------------
-- 2. connect_site_settings — per-site preferences for the chat assistant.
-- ---------------------------------------------------------------------------
--
-- Keyed on the site slug, which is the only identity the widget and the public
-- chat endpoints ever hold. One row per mirror; absence of a row is a valid,
-- fully-specified state (every column has a default), so no site needs to be
-- provisioned before its bubble works.
--
-- ai_chat_enabled defaults TRUE on purpose: the owner opts a site OUT, never in.
-- A site that has never been configured behaves like every other site.
--
-- custom_qa is the one source that may exceed the published site, because a
-- human wrote it. Shape: [{"question": "...", "answer": "..."}]. Validated in
-- lib/connect-site-settings.js before it is written; the CHECK below only
-- guarantees the container is an array so a malformed write cannot land.
create table if not exists public.connect_site_settings (
  site_slug text primary key,
  ai_chat_enabled boolean not null default true,
  takeover_seconds integer not null default 30,
  custom_qa jsonb not null default '[]'::jsonb,
  booking_url text,
  greeting text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Additive for any environment where the table already exists.
alter table public.connect_site_settings add column if not exists ai_chat_enabled boolean not null default true;
alter table public.connect_site_settings add column if not exists takeover_seconds integer not null default 30;
alter table public.connect_site_settings add column if not exists custom_qa jsonb not null default '[]'::jsonb;
alter table public.connect_site_settings add column if not exists booking_url text;
alter table public.connect_site_settings add column if not exists greeting text;
alter table public.connect_site_settings add column if not exists created_at timestamptz not null default now();
alter table public.connect_site_settings add column if not exists updated_at timestamptz not null default now();

alter table public.connect_site_settings
  drop constraint if exists connect_site_settings_custom_qa_is_array;
alter table public.connect_site_settings
  add constraint connect_site_settings_custom_qa_is_array
  check (jsonb_typeof(custom_qa) = 'array');

alter table public.connect_site_settings
  drop constraint if exists connect_site_settings_takeover_seconds_sane;
alter table public.connect_site_settings
  add constraint connect_site_settings_takeover_seconds_sane
  check (takeover_seconds >= 0 and takeover_seconds <= 600);

-- Same RLS posture as ghost_agency_dashboard_access and the connect_* tables:
-- browser roles hold no capability at all, service_role (server-side only, in
-- lib/store.js) is the whole data plane.
alter table public.connect_site_settings enable row level security;

revoke all on table public.connect_site_settings from anon, authenticated;
grant select, insert, update, delete on table public.connect_site_settings to service_role;

drop policy if exists connect_site_settings_browser_deny on public.connect_site_settings;
create policy connect_site_settings_browser_deny
  on public.connect_site_settings
  for all
  using (false)
  with check (false);
-- Service-role key bypasses RLS as usual.
