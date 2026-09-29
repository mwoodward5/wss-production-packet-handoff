// WSS CONTENT BRIDGE — the mirror engine injects the prospect's VERIFIED
// services, faqs and reviews via window.__WSS_CONTENT__ (a JSON island placed
// ahead of this bundle's script tag). Present, a real client build renders
// only their verified content — never template defaults. Absent (the donor
// template previewing standalone), the design's own trade-generic defaults
// render exactly as built. Reviews have NO template default at all: verified
// island reviews are the only source of quotes (truth law).

import { fact } from "@/lib/facts";

export interface WssService { name: string; description?: string }
export interface WssFaq { q: string; a: string }
export interface WssReviewRaw {
  name?: unknown; author?: unknown; city?: unknown; text?: unknown;
  rating?: unknown; avatarUrl?: unknown; publishedAt?: unknown;
}
export interface WssReview {
  name: string; city: string; text: string; rating: number;
  avatarUrl: string; initials: string; fromGoogle: boolean;
}

type Bridge = { services?: WssService[]; faqs?: WssFaq[]; reviews?: WssReviewRaw[] };

export const WSSC: Bridge =
  ((typeof window !== "undefined" && (window as unknown as Record<string, unknown>).__WSS_CONTENT__) as Bridge) || {};

// VERIFIED REVIEWS ONLY (truth law). A face renders ONLY from the reviewer's
// own verified Google photo (the same googleusercontent gate the engine
// applies); anything else falls back to an initials monogram. Never a stock
// face. "Google" labels only reviews carrying fields the verified Google lane
// alone emits (a rating numeral, a verified face, or a publish date).
export const liveReviews: WssReview[] = Array.isArray(WSSC.reviews)
  ? WSSC.reviews
      .map((r0) => {
        const r = (r0 || {}) as WssReviewRaw;
        const name =
          (typeof r.name === "string" && r.name.trim()) ||
          (typeof r.author === "string" && r.author.trim()) || "";
        const avatarUrl =
          typeof r.avatarUrl === "string" && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(r.avatarUrl)
            ? r.avatarUrl
            : "";
        const rating = Math.max(0, Math.min(5, Math.round(Number(r.rating)) || 0));
        return {
          name,
          city: typeof r.city === "string" ? r.city.trim() : "",
          text: typeof r.text === "string" ? r.text.trim() : "",
          rating,
          avatarUrl,
          initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(""),
          fromGoogle: rating > 0 || Boolean(avatarUrl) || (typeof r.publishedAt === "string" && r.publishedAt.trim() !== ""),
        };
      })
      .filter((r) => r.text)
      .slice(0, 6)
  : [];

export const REVIEW_PROFILE = fact("PROFILE_URL");

// The reviews section renders verified quotes, or (with a verified profile but
// no quotes yet) the honest review-ask card; with neither it collapses — and
// the navbar link to it collapses with it.
export const showReviewsSection = liveReviews.length > 0 || Boolean(REVIEW_PROFILE);
