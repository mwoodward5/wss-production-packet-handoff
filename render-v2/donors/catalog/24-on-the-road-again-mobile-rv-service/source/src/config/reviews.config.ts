/**
 * REVIEWS.CONFIG.TS — Verified customer reviews.
 * GOLD MASTER TEMPLATE: Replace with real, verified reviews only.
 */

export interface Review {
  author: string;
  initial: string;
  rating: 1 | 2 | 3 | 4 | 5;
  /** ISO date. */
  date: string;
  body: string;
  source?: "google" | "yelp" | "bbb" | "facebook" | "trustpilot" | "other";
  verified?: boolean;
}

export const REVIEWS: Review[] = [];

export const REVIEWS_AGGREGATE = {
  ratingValue: 0,
  reviewCount: 0,
} as const;
