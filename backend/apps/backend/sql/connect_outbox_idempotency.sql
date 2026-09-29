-- WSS Connect owner-reply idempotency.
--
-- The browser supplies one opaque UUID per queued reply. The unique pair below
-- makes the database, not serverless process memory, the concurrency boundary.
-- Public browser roles remain revoked; apps/backend writes with service_role.

alter table public.connect_messages
  add column if not exists client_message_id text,
  add column if not exists delivery_status text,
  add column if not exists delivery_lease_token uuid,
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_first_attempt_at timestamptz,
  add column if not exists delivery_last_attempt_at timestamptz,
  add column if not exists delivery_completed_at timestamptz;

do $$
begin
  alter table public.connect_messages
    add constraint connect_messages_client_message_id_format
    check (
      client_message_id is null
      or client_message_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.connect_messages
    add constraint connect_messages_delivery_status_check
    check (delivery_status is null or delivery_status in ('pending', 'completed', 'delivery_unknown')) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.connect_messages
    add constraint connect_messages_delivery_attempts_check
    check (delivery_attempts >= 0) not valid;
exception when duplicate_object then null;
end $$;

alter table public.connect_messages validate constraint connect_messages_client_message_id_format;
alter table public.connect_messages validate constraint connect_messages_delivery_status_check;
alter table public.connect_messages validate constraint connect_messages_delivery_attempts_check;

create unique index if not exists connect_messages_thread_client_message_uidx
  on public.connect_messages (thread_id, client_message_id)
  where client_message_id is not null;

alter table public.connect_messages enable row level security;
revoke all on table public.connect_messages from anon, authenticated;
revoke all on sequence public.connect_messages_id_seq from anon, authenticated;
grant select, insert, update, delete on table public.connect_messages to service_role;
grant usage, select on sequence public.connect_messages_id_seq to service_role;
