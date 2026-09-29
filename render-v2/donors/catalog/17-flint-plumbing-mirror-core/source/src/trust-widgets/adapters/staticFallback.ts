import type { TrustConfig } from "../trust.config";
import type { MediaFeed, ReviewFeed } from "./types";

/**
 * Zero-key mode: every adapter can fall back to whatever is already in config.
 * The package therefore runs with no API keys at all — it just renders less.
 */
export function reviewFeedFromConfig(cfg: TrustConfig, platform?: string): ReviewFeed {
  const reviews = (cfg.proof.reviews ?? []).filter((r) => !platform || r.platform === platform);
  return {
    reviews,
    rating: (cfg.proof.ratings ?? []).find((r) => !platform || r.platform === platform),
    fetchedAt: new Date().toISOString(),
  };
}

export function mediaFeedFromConfig(cfg: TrustConfig): MediaFeed {
  return { items: cfg.proof.ugc ?? cfg.proof.gallery ?? [], fetchedAt: new Date().toISOString() };
}

export async function withFallback<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    const v = await load();
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
