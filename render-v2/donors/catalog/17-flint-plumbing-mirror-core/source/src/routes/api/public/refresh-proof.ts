import { createFileRoute } from "@tanstack/react-router";

/**
 * ┌── MIRROR:TEMPLATE-CODE — POST /api/public/refresh-proof ─────────────────
 * │ Body: { siteKey, placeId, scrapeUrls[] } — the only per-client values.
 * │ SOURCES IT CALLS: Google Places Details (reviews + rating) and Firecrawl
 * │ /v2/scrape for non-Google platforms. Schedule it with pg_cron nightly.
 * └──────────────────────────────────────────────────────────────────────────
 * POST /api/public/refresh-proof
 *
 * The mirroring engine's heartbeat. Pulls fresh reviews + aggregate ratings and
 * upserts them into the `reviews` / `ratings_snapshots` tables that the
 * homepage reads. Idempotent: reviews are keyed on (site_key, external_id).
 *
 * Sources, in order of authority:
 *   1. Google Business Profile via Places API (New) through the Maps connector
 *   2. Firecrawl JSON extraction on any additional profile URL (Yelp, BBB, FB)
 *
 * Auth: send the Supabase publishable key as `apikey`. Scheduled by pg_cron.
 *
 *   select cron.schedule('refresh-proof-daily','20 4 * * *', $$
 *     select net.http_post(
 *       url := 'https://project--<id>.lovable.app/api/public/refresh-proof',
 *       headers := '{"Content-Type":"application/json","apikey":"<publishable key>"}'::jsonb,
 *       body := '{"siteKey":"flint-plumbing"}'::jsonb) $$);
 */

interface Body {
  siteKey?: string;
  placeId?: string;
  /** extra profile pages to scrape, e.g. Yelp / BBB / Facebook */
  scrapeUrls?: { platform: string; url: string }[];
}

interface NormalizedReview {
  external_id: string;
  author: string;
  avatar_url?: string;
  rating: number;
  body: string;
  platform: string;
  published_at?: string;
  source_url?: string;
  service_tag?: string;
  location?: string;
}

interface NormalizedRating {
  platform: string;
  rating_value: number;
  review_count: number;
  best_rating?: number;
  profile_url?: string;
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    ratingValue: { type: "number" },
    reviewCount: { type: "number" },
    reviews: {
      type: "array",
      items: {
        type: "object",
        properties: {
          author: { type: "string" },
          rating: { type: "number" },
          body: { type: "string" },
          date: { type: "string" },
          avatarUrl: { type: "string" },
          serviceTag: { type: "string" },
          location: { type: "string" },
        },
      },
    },
  },
};

async function fetchGoogle(placeId: string): Promise<{ reviews: NormalizedReview[]; rating?: NormalizedRating }> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovableKey || !mapsKey) return { reviews: [] };

  const res = await fetch(
    `https://connector-gateway.lovable.dev/google_maps/places/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": mapsKey,
        "X-Goog-FieldMask":
          "id,rating,userRatingCount,googleMapsUri,reviews,displayName,currentOpeningHours",
      },
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Places ${res.status}: ${detail.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    reviews?: {
      name?: string;
      rating?: number;
      text?: { text?: string };
      originalText?: { text?: string };
      authorAttribution?: { displayName?: string; photoUri?: string };
      publishTime?: string;
    }[];
  };

  const reviews: NormalizedReview[] = (data.reviews ?? [])
    .map((r, i) => ({
      external_id: r.name ?? `google-${i}`,
      author: r.authorAttribution?.displayName ?? "Google reviewer",
      avatar_url: r.authorAttribution?.photoUri,
      rating: Math.round(r.rating ?? 5),
      body: (r.text?.text ?? r.originalText?.text ?? "").trim(),
      platform: "Google",
      published_at: r.publishTime?.slice(0, 10),
      source_url: data.googleMapsUri,
    }))
    .filter((r) => r.body.length > 0);

  const rating =
    data.rating && data.userRatingCount
      ? {
          platform: "Google",
          rating_value: data.rating,
          review_count: data.userRatingCount,
          best_rating: 5,
          profile_url: data.googleMapsUri,
        }
      : undefined;

  return { reviews, rating };
}

async function fetchFirecrawl(
  platform: string,
  url: string,
): Promise<{ reviews: NormalizedReview[]; rating?: NormalizedRating }> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) return { reviews: [] };

  const gateway = !key.startsWith("fc-");
  const endpoint = gateway
    ? "https://connector-gateway.lovable.dev/firecrawl/v2/scrape"
    : "https://api.firecrawl.dev/v2/scrape";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (gateway) {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    if (!lovableKey) return { reviews: [] };
    headers["Authorization"] = `Bearer ${lovableKey}`;
    headers["X-Connection-Api-Key"] = key;
  } else {
    headers["Authorization"] = `Bearer ${key}`;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url,
      onlyMainContent: true,
      formats: [
        {
          type: "json",
          schema: REVIEW_SCHEMA,
          prompt:
            "Extract the aggregate star rating, total review count, and every visible customer review with author name, star rating, review text, ISO date, avatar image url, the service performed and the reviewer's city if shown. Never invent values; omit anything not on the page.",
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Firecrawl ${platform} ${res.status}: ${detail.slice(0, 400)}`);
  }
  const payload = (await res.json()) as {
    json?: unknown;
    data?: { json?: unknown };
  };
  const extracted = (payload.json ?? payload.data?.json ?? {}) as {
    ratingValue?: number;
    reviewCount?: number;
    reviews?: {
      author?: string;
      rating?: number;
      body?: string;
      date?: string;
      avatarUrl?: string;
      serviceTag?: string;
      location?: string;
    }[];
  };

  const slug = platform.toLowerCase();
  const reviews: NormalizedReview[] = (extracted.reviews ?? [])
    .map((r, i) => ({
      external_id: `${slug}-${(r.author ?? "anon").toLowerCase().replace(/\W+/g, "-")}-${r.date ?? i}`,
      author: r.author ?? `${platform} reviewer`,
      avatar_url: r.avatarUrl,
      rating: Math.round(r.rating ?? 5),
      body: (r.body ?? "").trim(),
      platform,
      published_at: /^\d{4}-\d{2}-\d{2}/.test(r.date ?? "") ? r.date!.slice(0, 10) : undefined,
      source_url: url,
      service_tag: r.serviceTag,
      location: r.location,
    }))
    .filter((r) => r.body.length > 0);

  const rating =
    extracted.ratingValue && extracted.reviewCount
      ? {
          platform,
          rating_value: extracted.ratingValue,
          review_count: extracted.reviewCount,
          best_rating: 5,
          profile_url: url,
        }
      : undefined;

  return { reviews, rating };
}

export const Route = createFileRoute("/api/public/refresh-proof")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;
        const siteKey = (body.siteKey ?? "").trim();
        if (!siteKey || siteKey.length > 80) {
          return new Response(JSON.stringify({ error: "siteKey required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const started = new Date().toISOString();
        const reviews: NormalizedReview[] = [];
        const ratings: NormalizedRating[] = [];
        const errors: string[] = [];

        if (body.placeId) {
          try {
            const g = await fetchGoogle(body.placeId);
            reviews.push(...g.reviews);
            if (g.rating) ratings.push(g.rating);
          } catch (e) {
            errors.push(String(e));
          }
        }

        for (const target of body.scrapeUrls ?? []) {
          if (!/^https:\/\//.test(target.url)) continue;
          try {
            const f = await fetchFirecrawl(target.platform, target.url);
            reviews.push(...f.reviews);
            if (f.rating) ratings.push(f.rating);
          } catch (e) {
            errors.push(String(e));
          }
        }

        if (reviews.length) {
          const { error } = await supabaseAdmin
            .from("reviews")
            .upsert(
              reviews.map((r) => ({ ...r, site_key: siteKey, updated_at: new Date().toISOString() })),
              { onConflict: "site_key,external_id" },
            );
          if (error) errors.push(`reviews upsert: ${error.message}`);
        }

        if (ratings.length) {
          const { error } = await supabaseAdmin.from("ratings_snapshots").insert(
            ratings.map((r) => ({
              ...r,
              site_key: siteKey,
              verified_at: new Date().toISOString().slice(0, 10),
            })),
          );
          if (error) errors.push(`ratings insert: ${error.message}`);
        }

        const status = errors.length ? (reviews.length ? "partial" : "error") : "ok";
        await supabaseAdmin.from("refresh_runs").insert({
          site_key: siteKey,
          source: body.placeId ? "google+firecrawl" : "firecrawl",
          status,
          started_at: started,
          finished_at: new Date().toISOString(),
          detail: { reviews: reviews.length, ratings: ratings.length, errors },
        });

        return new Response(
          JSON.stringify({ status, reviews: reviews.length, ratings: ratings.length, errors }),
          { status: status === "error" ? 502 : 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
