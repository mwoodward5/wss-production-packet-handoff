begin;

-- Seedance is a third durable worker lane. Existing WAN and Ads rows remain
-- valid, while the code default and the database default agree for new rows.
alter table public.ghost_agency_hero_reel_jobs
  drop constraint if exists ghost_agency_hero_reel_jobs_producer_check;

alter table public.ghost_agency_hero_reel_jobs
  add constraint ghost_agency_hero_reel_jobs_producer_check
  check (producer in (
    'wan2_i2v_local',
    'ads_image_to_video',
    'openrouter_seedance'
  )) not valid;

alter table public.ghost_agency_hero_reel_jobs
  validate constraint ghost_agency_hero_reel_jobs_producer_check;

alter table public.ghost_agency_hero_reel_jobs
  alter column producer set default 'openrouter_seedance';

commit;
