import { cached, emptyReviewFeed, type ReviewFeed } from "./types";

const cache = cached<ReviewFeed>(12 * 60 * 60 * 1000);

/** SERVER ONLY. Requires a Page access token with pages_read_engagement. */
export async function fetchFacebookRecommendations(opts: { pageId: string; accessToken: string }): Promise<ReviewFeed> {
  return cache(async () => {
    const url = `https://graph.facebook.com/v21.0/${opts.pageId}/ratings?fields=reviewer{name,picture},rating,review_text,created_time&access_token=${opts.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) return emptyReviewFeed();
    const data = (await res.json()) as { data?: { rating?: number; review_text?: string; created_time?: string; reviewer?: { name?: string; picture?: { data?: { url?: string } } } }[] };
    const rows = (data.data ?? []).filter((r) => r.review_text);
    return {
      fetchedAt: new Date().toISOString(),
      reviews: rows.map((r, i) => ({
        id: `fb-${i}`,
        author: r.reviewer?.name ?? "Facebook user",
        avatarUrl: r.reviewer?.picture?.data?.url,
        rating: r.rating ?? 5,
        body: r.review_text ?? "",
        platform: "Facebook",
        date: r.created_time?.slice(0, 10),
      })),
    };
  });
}
