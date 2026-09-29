import { cached, emptyReviewFeed, type ReviewFeed } from "./types";

const cache = cached<ReviewFeed>(12 * 60 * 60 * 1000);

/** SERVER ONLY. Trustpilot Business Units API. */
export async function fetchTrustpilotReviews(opts: { businessUnitId: string; apiKey: string; limit?: number }): Promise<ReviewFeed> {
  return cache(async () => {
    const headers = { apikey: opts.apiKey };
    const [unitRes, revRes] = await Promise.all([
      fetch(`https://api.trustpilot.com/v1/business-units/${opts.businessUnitId}`, { headers }),
      fetch(`https://api.trustpilot.com/v1/business-units/${opts.businessUnitId}/reviews?perPage=${opts.limit ?? 10}`, { headers }),
    ]);
    if (!unitRes.ok) return emptyReviewFeed();
    const unit = (await unitRes.json()) as { score?: { trustScore?: number; stars?: number }; numberOfReviews?: { total?: number }; profileUrl?: string };
    const rev = revRes.ok ? ((await revRes.json()) as { reviews?: { id: string; stars: number; text: string; createdAt: string; consumer?: { displayName?: string } }[] }) : { reviews: [] };
    return {
      fetchedAt: new Date().toISOString(),
      rating: unit.score?.stars && unit.numberOfReviews?.total
        ? { platform: "Trustpilot", ratingValue: unit.score.stars, reviewCount: unit.numberOfReviews.total, profileUrl: unit.profileUrl }
        : undefined,
      reviews: (rev.reviews ?? []).map((r) => ({
        id: r.id, author: r.consumer?.displayName ?? "Trustpilot reviewer",
        rating: r.stars, body: r.text, platform: "Trustpilot", date: r.createdAt.slice(0, 10),
      })),
    };
  });
}
