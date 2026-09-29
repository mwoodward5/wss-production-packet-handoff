-- Atomically deduplicate Resend/Svix deliveries without changing other event types.
ALTER TABLE public.ghost_agency_events
  ADD COLUMN IF NOT EXISTS svix_id text;

-- Preserve one historical event per Svix delivery if a prior concurrent write
-- produced duplicates; later duplicates remain in the ledger but are not given
-- a unique key retroactively.
WITH ranked_svix_ids AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY svix_id ORDER BY created_at ASC, id ASC) AS position
  FROM public.ghost_agency_events
  WHERE svix_id IS NOT NULL
)
UPDATE public.ghost_agency_events AS event
SET svix_id = NULL
FROM ranked_svix_ids AS ranked
WHERE event.id = ranked.id
  AND ranked.position > 1;

-- Promote legacy JSONB-only keys where they do not collide with an already
-- promoted key. This keeps sequential duplicate detection working after the
-- rollout without forcing a rewrite of old duplicate ledger rows.
WITH legacy_svix_ids AS (
  SELECT
    id,
    NULLIF(payload ->> 'svix_id', '') AS svix_id,
    row_number() OVER (
      PARTITION BY NULLIF(payload ->> 'svix_id', '')
      ORDER BY created_at ASC, id ASC
    ) AS position
  FROM public.ghost_agency_events
  WHERE svix_id IS NULL
    AND NULLIF(payload ->> 'svix_id', '') IS NOT NULL
),
available_legacy_svix_ids AS (
  SELECT legacy.id, legacy.svix_id
  FROM legacy_svix_ids AS legacy
  WHERE legacy.position = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.ghost_agency_events AS existing
      WHERE existing.svix_id = legacy.svix_id
    )
)
UPDATE public.ghost_agency_events AS event
SET svix_id = legacy.svix_id
FROM available_legacy_svix_ids AS legacy
WHERE event.id = legacy.id;

CREATE UNIQUE INDEX IF NOT EXISTS ghost_agency_events_svix_id_unique_idx
  ON public.ghost_agency_events (svix_id)
  WHERE svix_id IS NOT NULL;
