import { cached, emptyReviewFeed, type ReviewFeed } from "./types";

const cache = cached<ReviewFeed>(6 * 60 * 60 * 1000); // 6h

/**
 * SERVER ONLY. Never expose the API key to the browser.
 * Google Places returns at most 5 reviews; store the rest in config for the wall.
 */
export async function fetchGooglePlaceReviews(opts: { placeId: string; apiKey: string }): Promise<ReviewFeed> {
  return cache(async () => {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(opts.placeId)}?fields=rating,userRatingCount,googleMapsUri,reviews`;
    const res = await fetch(url, { headers: { "X-Goog-Api-Key": opts.apiKey, "Content-Type": "application/json" } });
    if (!res.ok) return emptyReviewFeed();
    const data = (await res.json()) as {
      rating?: number; userRatingCount?: number; googleMapsUri?: string;
      reviews?: { name?: string; rating?: number; text?: { text?: string }; authorAttribution?: { displayName?: string; photoUri?: string }; publishTime?: string }[];
    };
    return {
      fetchedAt: new Date().toISOString(),
      rating: data.rating && data.userRatingCount
        ? { platform: "Google", ratingValue: data.rating, reviewCount: data.userRatingCount, profileUrl: data.googleMapsUri, verifiedAt: new Date().toISOString().slice(0, 10) }
        : undefined,
      reviews: (data.reviews ?? []).map((r, i) => ({
        id: r.name ?? `google-${i}`,
        author: r.authorAttribution?.displayName ?? "Google reviewer",
        avatarUrl: r.authorAttribution?.photoUri,
        rating: r.rating ?? 5,
        body: r.text?.text ?? "",
        platform: "Google",
        date: r.publishTime?.slice(0, 10),
        sourceUrl: data.googleMapsUri,
      })).filter((r) => r.body.trim().length > 0),
    };
  });
}
