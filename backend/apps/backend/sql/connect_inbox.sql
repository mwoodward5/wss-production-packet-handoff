create table if not exists public.connect_threads (
  id bigint generated always as identity primary key,
  thread_key text not null unique,
  site_slug text not null,
  channel text not null check (channel in ('chat','sms','email','voicemail','call','system')),
  contact_name text,
  contact_info text,
  subject text,
  unread boolean not null default true,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  meta jsonb
);
create table if not exists public.connect_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.connect_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound','system')),
  body text not null,
  meta jsonb,
  client_message_id text
    constraint connect_messages_client_message_id_format
    check (
      client_message_id is null
      or client_message_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
  delivery_status text
    constraint connect_messages_delivery_status_check
    check (delivery_status is null or delivery_status in ('pending', 'completed', 'delivery_unknown')),
  delivery_lease_token uuid,
  delivery_attempts integer not null default 0
    constraint connect_messages_delivery_attempts_check
    check (delivery_attempts >= 0),
  delivery_first_attempt_at timestamptz,
  delivery_last_attempt_at timestamptz,
  delivery_completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists connect_messages_thread_idx on public.connect_messages(thread_id, created_at);
create index if not exists connect_messages_thread_id_idx on public.connect_messages(thread_id, id);
create unique index if not exists connect_messages_thread_client_message_uidx
  on public.connect_messages(thread_id, client_message_id)
  where client_message_id is not null;
create index if not exists connect_threads_site_slug_last_message_idx on public.connect_threads(site_slug, last_message_at desc);
alter table public.connect_threads enable row level security;
alter table public.connect_messages enable row level security;
