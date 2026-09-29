begin;

alter table if exists public.mission_control_agents
  drop constraint if exists mission_control_agents_status_check;

alter table if exists public.mission_control_agents
  add constraint mission_control_agents_status_check
  check (status in ('draft', 'provisioning', 'paused', 'active', 'error', 'disabled'))
  not valid;

alter table if exists public.mission_control_agents
  validate constraint mission_control_agents_status_check;

commit;
