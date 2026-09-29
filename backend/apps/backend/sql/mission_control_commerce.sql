create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  name text not null default 'AnswerCrew Account',
  type text not null default 'business' check (type in ('business', 'agency')),
  parent_account_id uuid references public.accounts(id) on delete set null,
  white_label_json jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounts_owner_user_id_idx on public.accounts(owner_user_id);
create index if not exists accounts_parent_account_id_idx on public.accounts(parent_account_id);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'solo' check (plan in ('solo', 'crew', 'front_office', 'agency', 'starter', 'growth')),
  status text not null default 'incomplete',
  current_period_end timestamptz,
  minutes_included integer not null default 0,
  minutes_used numeric not null default 0,
  agent_quota integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_account_id_key
  on public.subscriptions(account_id)
  where account_id is not null;

create unique index if not exists subscriptions_stripe_customer_id_key
  on public.subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'subscriptions'
      and constraint_name = 'subscriptions_plan_check'
  ) then
    alter table public.subscriptions drop constraint subscriptions_plan_check;
  end if;
end $$;

alter table public.subscriptions
  alter column plan set default 'solo',
  add constraint subscriptions_plan_check
  check (plan in ('solo', 'crew', 'front_office', 'agency', 'starter', 'growth'));

create table if not exists public.mission_control_usage_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  provider text not null default 'vapi',
  external_id text,
  minutes numeric not null default 0,
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists mission_control_usage_events_external_id_key
  on public.mission_control_usage_events(provider, external_id)
  where external_id is not null;

alter table if exists public.hot_leads
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

alter table if exists public.call_logs
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

alter table if exists public.agents
  add column if not exists account_id uuid references public.accounts(id) on delete set null;

alter table public.accounts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.mission_control_usage_events enable row level security;

drop policy if exists accounts_owner_select on public.accounts;
create policy accounts_owner_select on public.accounts
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or exists (
    select 1
    from public.accounts parent
    where parent.id = accounts.parent_account_id
      and parent.owner_user_id = (select auth.uid())
  )
);

drop policy if exists accounts_owner_insert on public.accounts;
create policy accounts_owner_insert on public.accounts
for insert to authenticated
with check (owner_user_id = (select auth.uid()));

drop policy if exists accounts_owner_update on public.accounts;
create policy accounts_owner_update on public.accounts
for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

drop policy if exists subscriptions_owner_select on public.subscriptions;
create policy subscriptions_owner_select on public.subscriptions
for select to authenticated
using (
  exists (
    select 1
    from public.accounts account
    where account.id = subscriptions.account_id
      and (
        account.owner_user_id = (select auth.uid())
        or exists (
          select 1
          from public.accounts parent
          where parent.id = account.parent_account_id
            and parent.owner_user_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists usage_owner_select on public.mission_control_usage_events;
create policy usage_owner_select on public.mission_control_usage_events
for select to authenticated
using (
  exists (
    select 1
    from public.accounts account
    where account.id = mission_control_usage_events.account_id
      and (
        account.owner_user_id = (select auth.uid())
        or exists (
          select 1
          from public.accounts parent
          where parent.id = account.parent_account_id
            and parent.owner_user_id = (select auth.uid())
        )
      )
  )
);

grant usage on schema public to authenticated;
grant select, insert, update on public.accounts to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.mission_control_usage_events to authenticated;
