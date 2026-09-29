-- Compact, parity-preserving read models for /api/admin/console-data.
-- Additive only: source tables and rows are not changed.

begin;

create or replace function public.ghost_console_jsonb_pick(source jsonb, keys text[])
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when source is null or jsonb_typeof(source) <> 'object' then source
    else coalesce(
      (
        select jsonb_object_agg(entry.key, entry.value)
        from jsonb_each(source) as entry
        where entry.key = any(keys)
      ),
      '{}'::jsonb
    )
  end
$$;

create or replace function public.ghost_console_qc_projection(source jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  result jsonb;
  nested_name text;
  nested_value jsonb;
  direct_keys text[] := array[
    'renderer', 'runtime', 'engine', 'release_ready', 'releaseReady',
    'hero_media', 'heroMedia', 'business_identity', 'businessIdentity',
    'map', 'satellite_map', 'address_map_directions', 'brand', 'logo_colors',
    'logo_and_colors', 'photos', 'photo_evidence', 'internal_terms',
    'internal_terms_clean', 'social_meta', 'social_meta_favicon',
    'activation_rail', 'launch_rail', 'checkout', 'stripe_checkout',
    'accessibility', 'responsive', 'accessibility_responsive'
  ];
  nested_names text[] := array['qc', 'qc_evidence', 'qcEvidence', 'release_gates', 'releaseGates'];
begin
  if source is null or jsonb_typeof(source) <> 'object' then
    return source;
  end if;
  result := public.ghost_console_jsonb_pick(source, direct_keys);
  foreach nested_name in array nested_names
  loop
    if source ? nested_name then
      nested_value := source -> nested_name;
      if jsonb_typeof(nested_value) = 'object' then
        nested_value := public.ghost_console_jsonb_pick(nested_value, direct_keys);
      end if;
      result := result || jsonb_build_object(nested_name, nested_value);
    end if;
  end loop;
  return result;
end
$$;

create or replace function public.ghost_console_record_projection(source jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  result jsonb;
  value jsonb;
  projected jsonb;
  nested_name text;
  scalar_keys text[] := array[
    'place_id', 'placeId', 'website', 'url', 'site', 'business_phone',
    'telephone', 'business_name', 'businessName', 'name', 'address',
    'street_address', 'formatted_address', 'postal_code', 'zip',
    'current_website', 'city', 'state', 'phone', 'contact_enrichment',
    'outreach_hold_reasons', 'outreach_review_hold', 'batch_id', 'batchId',
    'industry', 'category', 'error', 'blocked_reason', 'error_code',
    'owner_only', 'delivery_lane', 'test_mode', 'environment', 'ref_code',
    'email', 'owner_email'
  ];
  build_names text[] := array['siteforge', 'build', 'preview_build', 'previewBuild'];
begin
  if source is null or jsonb_typeof(source) <> 'object' then
    return source;
  end if;
  result := public.ghost_console_jsonb_pick(source, scalar_keys)
    || public.ghost_console_qc_projection(source);

  if source ? 'truth_packet' then
    value := source -> 'truth_packet';
    if jsonb_typeof(value) = 'object' then
      projected := '{}'::jsonb;
      if value ? 'gbp' then
        if jsonb_typeof(value -> 'gbp') = 'object' then
          projected := jsonb_build_object(
            'gbp',
            public.ghost_console_jsonb_pick(value -> 'gbp', array['name'])
          );
        else
          projected := jsonb_build_object('gbp', value -> 'gbp');
        end if;
      end if;
      value := projected;
    end if;
    result := result || jsonb_build_object('truth_packet', value);
  end if;

  if source ? 'gbp' then
    value := source -> 'gbp';
    if jsonb_typeof(value) = 'object' then
      value := public.ghost_console_jsonb_pick(value, array['name']);
    end if;
    result := result || jsonb_build_object('gbp', value);
  end if;

  foreach nested_name in array build_names
  loop
    if source ? nested_name then
      value := source -> nested_name;
      if jsonb_typeof(value) = 'object' then
        value := public.ghost_console_qc_projection(value);
      end if;
      result := result || jsonb_build_object(nested_name, value);
    end if;
  end loop;
  return result;
end
$$;

create or replace view public.ghost_agency_console_prospects_v1
with (security_invoker = true)
as
select
  prospect.prospect_id,
  prospect.status,
  prospect.business_name,
  prospect.email,
  prospect.owner_email,
  prospect.phone,
  prospect.current_website,
  prospect.industry,
  prospect.city,
  prospect.state,
  prospect.leadminer_score,
  prospect.preview_url,
  prospect.source,
  prospect.updated_at,
  to_jsonb(prospect) ->> 'canonical_prospect_id' as canonical_prospect_id,
  to_jsonb(prospect) ->> 'merged_into_prospect_id' as merged_into_prospect_id,
  public.ghost_console_record_projection(prospect.record) as record,
  public.ghost_console_jsonb_pick(
    to_jsonb(prospect),
    array['ref_code', 'contact_enrichment', 'outreach_hold_reasons', 'outreach_review_hold']
  ) as root_extras
from public.ghost_agency_prospects as prospect;

create or replace view public.ghost_agency_console_email_log_v1
with (security_invoker = true)
as
select
  email.prospect_id,
  email.sequence,
  email.step,
  email.sent_at,
  email.suppressed,
  email.mode,
  public.ghost_console_jsonb_pick(
    email.payload,
    array['resendId', 'resend_id', 'emailId', 'email_id', 'id', 'runId', 'subject', 'to']
  ) as payload
from public.ghost_agency_email_log as email;

create or replace view public.ghost_agency_console_events_v1
with (security_invoker = true)
as
select
  event.id,
  event.type,
  event.created_at,
  event.payload ->> 'actor' as actor,
  public.ghost_console_jsonb_pick(
    event.payload,
    array[
      'type', 'metric', 'event', 'prospectId', 'prospect_id', 'email_id',
      'emailId', 'resend_id', 'resendId', 'id', 'source', 'businessName',
      'business_name', 'category', 'location', 'sent', 'queued', 'status',
      'reason', 'blocked', 'mode', 'loaded', 'code', 'blockedCode',
      'blocked_code', 'reason_code', 'result', 'stage', 'failedStage',
      'failed_stage', 'userMessage', 'user_message', 'message',
      'safeNextAction', 'safe_next_action', 'requirementSatisfied',
      'requirement_satisfied', 'timestamp', 'dryRun', 'batch', 'evaluated',
      'tested', 'blockedBy', 'textQuery', 'found', 'upserted', 'created',
      'updated', 'duplicateSkipped', 'rejected', 'withEmail', 'finalQueries',
      'runId', 'selected', 'built', 'actor', 'telemetry', 'lifecycle',
      'disabled', 'jobId', 'job_id', 'run_id', 'nextDependency',
      'next_dependency', 'dependency'
    ]
  ) as payload,
  public.ghost_console_jsonb_pick(to_jsonb(event), array['prospect_id']) as root_extras
from public.ghost_agency_events as event;

create index if not exists ghost_agency_prospects_console_updated_idx
  on public.ghost_agency_prospects (updated_at desc);

create index if not exists ghost_agency_email_log_console_sent_idx
  on public.ghost_agency_email_log (sent_at desc);

-- Plain created_at index for the unfiltered events view query:
--   SELECT ... FROM ghost_agency_console_events_v1 ORDER BY created_at DESC LIMIT 300
-- Without this the planner falls back to a seq scan as the table grows, which
-- exceeded the 8 s statement timeout on 2026-08-24 (issue #378).
create index if not exists ghost_agency_events_console_created_idx
  on public.ghost_agency_events (created_at desc);

create index if not exists ghost_agency_events_console_actor_idx
  on public.ghost_agency_events (created_at desc)
  where (payload ->> 'actor') is not null;

create index if not exists ghost_agency_events_delivery_pause_idx
  on public.ghost_agency_events (created_at desc)
  where type = 'outreach.delivery_pause';

revoke all on public.ghost_agency_console_prospects_v1 from public, anon, authenticated;
revoke all on public.ghost_agency_console_email_log_v1 from public, anon, authenticated;
revoke all on public.ghost_agency_console_events_v1 from public, anon, authenticated;
grant select on public.ghost_agency_console_prospects_v1 to service_role;
grant select on public.ghost_agency_console_email_log_v1 to service_role;
grant select on public.ghost_agency_console_events_v1 to service_role;

revoke all on function public.ghost_console_jsonb_pick(jsonb, text[]) from public;
revoke all on function public.ghost_console_qc_projection(jsonb) from public;
revoke all on function public.ghost_console_record_projection(jsonb) from public;
grant execute on function public.ghost_console_jsonb_pick(jsonb, text[]) to service_role;
grant execute on function public.ghost_console_qc_projection(jsonb) to service_role;
grant execute on function public.ghost_console_record_projection(jsonb) to service_role;

commit;

notify pgrst, 'reload schema';
