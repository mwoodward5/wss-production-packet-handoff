export interface Review {
  author: string; initial: string; rating: 1|2|3|4|5;
  date: string; body: string;
  source?: "google"|"yelp"|"bbb"|"facebook"|"trustpilot"|"other";
  verified?: boolean;
}

// No reviews were provided by the client. Do not invent.
// The site links out to the Google Business Profile slideshow + write-a-review CTA instead.
export const REVIEWS: Review[] = [];

export const REVIEWS_AGGREGATE = {
  ratingValue: 0,
  reviewCount: 0,
} as const;
