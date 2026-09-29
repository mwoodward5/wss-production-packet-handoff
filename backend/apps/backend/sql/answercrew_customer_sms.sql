create extension if not exists pgcrypto;

alter table public.answercrew_customer_subscriptions
  add column if not exists internal_access_role text;

alter table public.answercrew_customer_subscriptions
  add column if not exists internal_unlimited_minutes boolean not null default false;

alter table public.answercrew_customer_accounts
  add column if not exists owner_notification_phone text;

alter table if exists public.hot_leads
  add column if not exists account_id uuid references public.answercrew_customer_accounts(id) on delete set null;

create index if not exists hot_leads_account_id_idx
  on public.hot_leads(account_id, last_opened_at desc);

alter table if exists public.mission_control_agents
  add column if not exists recording_consent_enabled boolean not null default false;

alter table if exists public.mission_control_customer_calls
  add column if not exists recording_consent_enabled boolean not null default false;

alter table if exists public.mission_control_customer_calls
  add column if not exists recording_consent_mode text;

alter table if exists public.mission_control_customer_calls
  add column if not exists artifact_retention_expires_at timestamptz;

create table if not exists public.answercrew_sms_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.answercrew_customer_accounts(id) on delete cascade,
  customer_phone text not null,
  customer_name text,
  consent_to_text boolean not null default false,
  consent_source text,
  consent_proof text,
  consent_granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, customer_phone)
);

create index if not exists answercrew_sms_conversations_account_idx
  on public.answercrew_sms_conversations(account_id, updated_at desc);

create table if not exists public.answercrew_sms_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.answercrew_customer_accounts(id) on delete cascade,
  conversation_id uuid references public.answercrew_sms_conversations(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_phone text,
  to_phone text,
  body text not null,
  status text not null default 'pending',
  idempotency_key text,
  twilio_message_sid text unique,
  provider text not null default 'twilio',
  provider_status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, idempotency_key)
);

create index if not exists answercrew_sms_messages_account_idx
  on public.answercrew_sms_messages(account_id, created_at desc);

create index if not exists answercrew_sms_messages_conversation_idx
  on public.answercrew_sms_messages(conversation_id, created_at asc);

create table if not exists public.answercrew_sms_number_mappings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.answercrew_customer_accounts(id) on delete cascade,
  twilio_phone_number text unique,
  messaging_service_sid text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (twilio_phone_number is not null or messaging_service_sid is not null)
);

create index if not exists answercrew_sms_number_mappings_account_idx
  on public.answercrew_sms_number_mappings(account_id, active);

create table if not exists public.answercrew_sms_demo_sends (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.answercrew_customer_accounts(id) on delete cascade,
  idempotency_key text not null,
  destination text not null,
  body text not null,
  status text not null default 'pending',
  dry_run boolean not null default false,
  twilio_message_sid text,
  provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.answercrew_sms_conversations enable row level security;
alter table public.answercrew_sms_messages enable row level security;
alter table public.answercrew_sms_number_mappings enable row level security;
alter table public.answercrew_sms_demo_sends enable row level security;

drop policy if exists answercrew_sms_conversations_browser_deny on public.answercrew_sms_conversations;
create policy answercrew_sms_conversations_browser_deny on public.answercrew_sms_conversations
for all to anon, authenticated using (false) with check (false);

drop policy if exists answercrew_sms_messages_browser_deny on public.answercrew_sms_messages;
create policy answercrew_sms_messages_browser_deny on public.answercrew_sms_messages
for all to anon, authenticated using (false) with check (false);

drop policy if exists answercrew_sms_number_mappings_browser_deny on public.answercrew_sms_number_mappings;
create policy answercrew_sms_number_mappings_browser_deny on public.answercrew_sms_number_mappings
for all to anon, authenticated using (false) with check (false);

drop policy if exists answercrew_sms_demo_sends_browser_deny on public.answercrew_sms_demo_sends;
create policy answercrew_sms_demo_sends_browser_deny on public.answercrew_sms_demo_sends
for all to anon, authenticated using (false) with check (false);

revoke all on table public.answercrew_sms_conversations from anon, authenticated;
revoke all on table public.answercrew_sms_messages from anon, authenticated;
revoke all on table public.answercrew_sms_number_mappings from anon, authenticated;
revoke all on table public.answercrew_sms_demo_sends from anon, authenticated;

grant select, insert, update, delete on table public.answercrew_sms_conversations to service_role;
grant select, insert, update, delete on table public.answercrew_sms_messages to service_role;
grant select, insert, update, delete on table public.answercrew_sms_number_mappings to service_role;
grant select, insert, update, delete on table public.answercrew_sms_demo_sends to service_role;
