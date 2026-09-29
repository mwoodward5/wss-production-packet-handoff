import type { MediaItem, PlatformRating, ReviewEntry } from "../trust.config";

export interface ReviewFeed {
  rating?: PlatformRating;
  reviews: ReviewEntry[];
  /** ISO timestamp the upstream API was last queried */
  fetchedAt: string;
}

export interface MediaFeed { items: MediaItem[]; fetchedAt: string }

export const emptyReviewFeed = (): ReviewFeed => ({ reviews: [], fetchedAt: new Date().toISOString() });
export const emptyMediaFeed = (): MediaFeed => ({ items: [], fetchedAt: new Date().toISOString() });

/** Simple in-memory TTL cache so adapters never hammer upstream APIs. */
export function cached<T>(ttlMs: number) {
  let value: T | undefined;
  let at = 0;
  return async (load: () => Promise<T>): Promise<T> => {
    if (value !== undefined && Date.now() - at < ttlMs) return value;
    value = await load();
    at = Date.now();
    return value;
  };
}
