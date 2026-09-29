/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: the server read of the `reviews` /
 * │ `ratings_snapshots` tables for this siteKey.
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE FEEDS IT: clientConfig.siteKey (row scope) and the env
 * │ vars SUPABASE URL + publishable key on your own server.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Live refresh
 * └──────────────────────────────────────────────────────────────────────────
 */
import { createClient } from "@supabase/supabase-js";

import type { PlatformRating, ReviewEntry } from "@/trust-widgets/trust.config";
import { emptyLiveProof, type LiveProof } from "./live-proof";

export { emptyLiveProof };
export type { LiveProof };

/** Publishable-key client: public read only, no session. */
export function publicSupabase() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return undefined;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/** Everything the homepage needs from the live tables, as plain DTOs. */
export async function loadLiveProof(siteKey: string): Promise<LiveProof> {
  const supabase = publicSupabase();
  if (!supabase) return emptyLiveProof;

  const [reviewsRes, ratingsRes] = await Promise.all([
    supabase
      .from("reviews")
      .select(
        "external_id, author, avatar_url, rating, body, platform, service_tag, location, source_url, published_at",
      )
      .eq("site_key", siteKey)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(60),
    supabase
      .from("ratings_snapshots")
      .select("platform, rating_value, review_count, best_rating, profile_url, verified_at, created_at")
      .eq("site_key", siteKey)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const reviews: ReviewEntry[] = (reviewsRes.data ?? [])
    .map((r, i) => ({
      id: r.external_id ?? `live-${i}`,
      author: r.author ?? "Verified customer",
      rating: r.rating ?? 5,
      body: (r.body ?? "") as string,
      platform: r.platform ?? undefined,
      date: r.published_at ?? undefined,
      avatarUrl: r.avatar_url ?? undefined,
      sourceUrl: r.source_url ?? undefined,
      serviceTag: r.service_tag ?? undefined,
      location: r.location ?? undefined,
    }))
    .filter((r) => r.body.trim().length > 0);

  const seen = new Set<string>();
  const ratings: PlatformRating[] = [];
  for (const row of ratingsRes.data ?? []) {
    const platform = row.platform as string;
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    ratings.push({
      platform,
      ratingValue: Number(row.rating_value),
      reviewCount: row.review_count ?? 0,
      bestRating: row.best_rating ? Number(row.best_rating) : 5,
      profileUrl: row.profile_url ?? undefined,
      verifiedAt: row.verified_at ?? undefined,
    });
  }

  return {
    reviews,
    ratings,
    refreshedAt: (ratingsRes.data?.[0]?.created_at as string | undefined) ?? undefined,
  };
}
