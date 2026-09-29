-- WSS Connect browser push subscriptions.
--
-- Only the backend service role may reach this table. Tenant identity is
-- resolved from the signed Connect token before a row is written; no browser
-- talks to this table directly.

create table if not exists public.connect_push_subscriptions (
  id bigint generated always as identity primary key,
  site_slug text not null check (site_slug <> '' and length(site_slug) <= 80),
  endpoint text not null check (endpoint like 'https://%' and length(endpoint) <= 4096),
  p256dh text not null check (p256dh <> '' and length(p256dh) <= 256),
  auth text not null check (auth <> '' and length(auth) <= 128),
  created_at timestamptz not null default now(),
  unique (site_slug, endpoint)
);

create index if not exists connect_push_subscriptions_site_slug_idx
  on public.connect_push_subscriptions (site_slug);

alter table public.connect_push_subscriptions enable row level security;

revoke all on table public.connect_push_subscriptions from anon, authenticated;
revoke all on sequence public.connect_push_subscriptions_id_seq from anon, authenticated;
grant select, insert, update, delete on table public.connect_push_subscriptions to service_role;
grant usage, select on sequence public.connect_push_subscriptions_id_seq to service_role;
