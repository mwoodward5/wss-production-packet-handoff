/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: the merge rule between LIVE reviews (database, kept
 * │ fresh nightly) and STATIC reviews (src/trust.config.ts, written by you).
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ RULE: live rows win when present; static rows are the cold-start fallback,
 * │ so a brand-new mirror still shows real faces before the first refresh runs.
 * │ THEREFORE: the engine must still write reviews into trust.config.ts even
 * │ though the refresh job exists.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Live refresh
 * └──────────────────────────────────────────────────────────────────────────
 */
import type { PlatformRating, ReviewEntry } from "@/trust-widgets/trust.config";

/** Client-safe shapes + merge logic. No server imports live in this file. */
export interface LiveProof {
  reviews: ReviewEntry[];
  ratings: PlatformRating[];
  refreshedAt?: string;
}

export const emptyLiveProof: LiveProof = { reviews: [], ratings: [] };

/**
 * Live data wins per platform, static config fills every gap.
 * A cold database therefore still renders the researched baseline.
 */
export function mergeProof<
  T extends { proof: { reviews?: ReviewEntry[]; ratings?: PlatformRating[] } },
>(config: T, live: LiveProof): T {
  const livePlatforms = new Set(live.ratings.map((r) => r.platform));
  const liveReviewPlatforms = new Set(live.reviews.map((r) => r.platform).filter(Boolean));

  const ratings = [
    ...live.ratings,
    ...(config.proof.ratings ?? []).filter((r) => !livePlatforms.has(r.platform)),
  ];

  const seenIds = new Set(live.reviews.map((r) => r.id));
  const reviews = [
    ...live.reviews,
    ...(config.proof.reviews ?? []).filter(
      (r) => !seenIds.has(r.id) && !(r.platform && liveReviewPlatforms.has(r.platform)),
    ),
  ];

  return {
    ...config,
    proof: {
      ...config.proof,
      ...(ratings.length ? { ratings } : {}),
      ...(reviews.length ? { reviews } : {}),
    },
  };
}
