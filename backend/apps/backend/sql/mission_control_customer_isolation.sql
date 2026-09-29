create extension if not exists pgcrypto;

create table if not exists public.answercrew_customer_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'AnswerCrew Account',
  type text not null default 'business' check (type in ('business', 'agency')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id)
);

create table if not exists public.answercrew_customer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.answercrew_customer_accounts(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'solo'
    check (plan in ('solo', 'crew', 'front_office', 'agency', 'starter', 'growth')),
  status text not null default 'incomplete',
  current_period_end timestamptz,
  minutes_included integer not null default 0,
  minutes_used numeric not null default 0,
  agent_quota integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id)
);

create unique index if not exists answercrew_customer_subscriptions_stripe_customer_id_key
  on public.answercrew_customer_subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists answercrew_customer_subscriptions_stripe_subscription_id_key
  on public.answercrew_customer_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.mission_control_agents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.answercrew_customer_accounts(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  slot_key text not null,
  display_name text not null,
  business_name text,
  role_template text not null default 'receptionist',
  voice_id text not null default '21m00Tcm4TlvDq8ikWAM',
  prompt text not null,
  custom_instructions text not null default '',
  business_profile jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  vapi_assistant_id text,
  phone_number_id text,
  phone_number text,
  status text not null default 'draft'
    check (status in ('draft', 'provisioning', 'active', 'error', 'disabled')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, slot_key)
);

create unique index if not exists mission_control_agents_vapi_assistant_id_key
  on public.mission_control_agents(vapi_assistant_id)
  where vapi_assistant_id is not null;

create index if not exists mission_control_agents_account_id_idx
  on public.mission_control_agents(account_id, updated_at desc);

create index if not exists mission_control_agents_owner_user_id_idx
  on public.mission_control_agents(owner_user_id);

create table if not exists public.mission_control_customer_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.answercrew_customer_accounts(id) on delete cascade,
  agent_id uuid not null references public.mission_control_agents(id) on delete cascade,
  vapi_call_id text not null,
  direction text not null default 'outbound'
    check (direction in ('inbound', 'outbound')),
  customer_number text,
  status text not null default 'queued',
  duration_seconds numeric not null default 0,
  summary text,
  transcript text,
  recording_url text,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, vapi_call_id)
);

create index if not exists mission_control_customer_calls_account_id_idx
  on public.mission_control_customer_calls(account_id, created_at desc);

create index if not exists mission_control_customer_calls_agent_id_idx
  on public.mission_control_customer_calls(agent_id);

alter table public.answercrew_customer_accounts enable row level security;
alter table public.answercrew_customer_subscriptions enable row level security;
alter table public.mission_control_agents enable row level security;
alter table public.mission_control_customer_calls enable row level security;

create policy answercrew_customer_accounts_owner_select on public.answercrew_customer_accounts
for select to authenticated using (owner_user_id = (select auth.uid()));

create policy answercrew_customer_subscriptions_owner_select on public.answercrew_customer_subscriptions
for select to authenticated using (
  exists (
    select 1 from public.answercrew_customer_accounts account
    where account.id = answercrew_customer_subscriptions.account_id
      and account.owner_user_id = (select auth.uid())
  )
);

create policy mission_control_agents_owner_select on public.mission_control_agents
for select to authenticated using (
  owner_user_id = (select auth.uid())
  and exists (
    select 1 from public.answercrew_customer_accounts account
    where account.id = mission_control_agents.account_id
      and account.owner_user_id = (select auth.uid())
  )
);

create policy mission_control_customer_calls_owner_select on public.mission_control_customer_calls
for select to authenticated using (
  exists (
    select 1 from public.answercrew_customer_accounts account
    where account.id = mission_control_customer_calls.account_id
      and account.owner_user_id = (select auth.uid())
  )
);

revoke all on public.answercrew_customer_accounts from anon, authenticated;
revoke all on public.answercrew_customer_subscriptions from anon, authenticated;
revoke all on public.mission_control_agents from anon, authenticated;
revoke all on public.mission_control_customer_calls from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.answercrew_customer_accounts to authenticated;
grant select on public.answercrew_customer_subscriptions to authenticated;
grant select on public.mission_control_agents to authenticated;
grant select on public.mission_control_customer_calls to authenticated;
