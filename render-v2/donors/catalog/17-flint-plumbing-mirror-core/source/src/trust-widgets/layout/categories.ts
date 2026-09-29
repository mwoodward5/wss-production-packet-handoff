import type { WidgetCategory, WidgetId } from "../trust.config";

/** A widget may serve several categories. */
export const CATEGORY_WIDGETS: Record<WidgetCategory, WidgetId[]> = {
  TRUST_CREDENTIALS: ["CredentialModal", "LicenseVerifyBadge", "InsuranceProofPanel", "GuaranteePanel", "TrustBadgeRail"],
  VISUAL_TRANSFORM:  ["BeforeAfterSlider", "PortfolioLightbox", "UGCCarousel", "InstagramGridEmbed", "VideoTestimonialStrip"],
  BOOKING_AVAIL:     ["CapacityMeter", "BookNowSticky", "OpenNowStatus", "WaitTimeBadge", "LivePresenceTicker"],
  EMERGENCY_URGENCY: ["EmergencyCTABand", "ResponseTimePromise", "ProofStickyBar", "ServiceAreaBanner"],
  LOCAL_GEO:         ["ServiceAreaBanner", "MultiLocationMap", "SeoProofBlock", "VoiceAnswerBlock", "SpeakableSchema"],
  REVIEWS_REP:       ["ReviewMarquee", "ReviewWall", "RatingBadgeCluster", "StarSummaryBar", "ReviewSpotlight", "RecentActivityToasts"],
  CATALOG_PRICED:    ["ServiceMenuGrid", "MenuSchemaBlock", "CounterStatBand"],
  SOCIAL_UGC:        ["SocialFollowerBar", "HashtagFeedRail", "InstagramGridEmbed", "UGCCarousel"],
};

export function widgetsForCategories(cats: WidgetCategory[]): WidgetId[] {
  const out: WidgetId[] = [];
  cats.forEach((c) => CATEGORY_WIDGETS[c].forEach((w) => { if (!out.includes(w)) out.push(w); }));
  return out;
}

export function categoriesOf(id: WidgetId): WidgetCategory[] {
  return (Object.keys(CATEGORY_WIDGETS) as WidgetCategory[]).filter((c) => CATEGORY_WIDGETS[c].includes(id));
}

/** Convenience for presets: expand categories into a WidgetProfile. */
export function profileFromCategories(opts: {
  promote: WidgetCategory[];
  suppress?: WidgetCategory[];
  alsoPromote?: WidgetId[];
  alsoSuppress?: WidgetId[];
}) {
  const suppressed = [...widgetsForCategories(opts.suppress ?? []), ...(opts.alsoSuppress ?? [])];
  const promoted = [...widgetsForCategories(opts.promote), ...(opts.alsoPromote ?? [])]
    .filter((w) => !suppressed.includes(w));
  const all = Object.values(CATEGORY_WIDGETS).flat();
  const available = Array.from(new Set(all)).filter((w) => !promoted.includes(w) && !suppressed.includes(w));
  return { promoted, available, suppressed: Array.from(new Set(suppressed)) };
}
