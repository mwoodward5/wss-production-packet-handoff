-- WSS Connect visitor chat metadata and tenant read path.
--
-- The widget writes through authenticated server functions only. Browser
-- roles never read these tables directly; service_role remains the sole data
-- plane used by apps/backend/lib/store.js.

alter table public.connect_threads
  add column if not exists meta jsonb;

create index if not exists connect_threads_site_slug_last_message_idx
  on public.connect_threads (site_slug, last_message_at desc);

create index if not exists connect_messages_thread_id_idx
  on public.connect_messages (thread_id, id);

alter table public.connect_threads enable row level security;
alter table public.connect_messages enable row level security;

revoke all on table public.connect_threads, public.connect_messages
  from anon, authenticated;
revoke all on sequence public.connect_threads_id_seq, public.connect_messages_id_seq
  from anon, authenticated;

grant select, insert, update, delete on table public.connect_threads, public.connect_messages
  to service_role;
grant usage, select on sequence public.connect_threads_id_seq, public.connect_messages_id_seq
  to service_role;
