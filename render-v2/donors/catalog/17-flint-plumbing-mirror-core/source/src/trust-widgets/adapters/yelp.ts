import { cached, emptyReviewFeed, type ReviewFeed } from "./types";

const cache = cached<ReviewFeed>(12 * 60 * 60 * 1000);

/** SERVER ONLY. Yelp Fusion returns 3 review excerpts + the aggregate rating. */
export async function fetchYelpReviews(opts: { businessId: string; apiKey: string }): Promise<ReviewFeed> {
  return cache(async () => {
    const headers = { Authorization: `Bearer ${opts.apiKey}` };
    const [bizRes, revRes] = await Promise.all([
      fetch(`https://api.yelp.com/v3/businesses/${encodeURIComponent(opts.businessId)}`, { headers }),
      fetch(`https://api.yelp.com/v3/businesses/${encodeURIComponent(opts.businessId)}/reviews?limit=3&sort_by=yelp_sort`, { headers }),
    ]);
    if (!bizRes.ok) return emptyReviewFeed();
    const biz = (await bizRes.json()) as { rating?: number; review_count?: number; url?: string };
    const rev = revRes.ok ? ((await revRes.json()) as { reviews?: { id: string; rating: number; text: string; time_created: string; url: string; user: { name: string; image_url?: string } }[] }) : { reviews: [] };
    return {
      fetchedAt: new Date().toISOString(),
      rating: biz.rating && biz.review_count
        ? { platform: "Yelp", ratingValue: biz.rating, reviewCount: biz.review_count, profileUrl: biz.url }
        : undefined,
      reviews: (rev.reviews ?? []).map((r) => ({
        id: r.id, author: r.user.name, avatarUrl: r.user.image_url, rating: r.rating,
        body: r.text, platform: "Yelp", date: r.time_created.slice(0, 10), sourceUrl: r.url,
      })),
    };
  });
}
