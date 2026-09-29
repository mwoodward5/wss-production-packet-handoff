/**
 * Compat shim. Reviews live in src/config/reviews.config.ts.
 */
import { REVIEWS, REVIEWS_AGGREGATE } from "@/config/reviews.config";
export type { Review } from "@/config/reviews.config";

export const VERIFIED_REVIEWS = REVIEWS;
export { REVIEWS_AGGREGATE };
