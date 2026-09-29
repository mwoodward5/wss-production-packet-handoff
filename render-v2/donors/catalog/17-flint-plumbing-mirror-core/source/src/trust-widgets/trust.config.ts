/**
 * WSS Trust Widgets — single source of truth.
 * Swap this file (or spread a vertical preset) and every widget retargets.
 * RULE: no widget ever invents a fact. Empty data => the widget renders null.
 */

export type WidgetId =
  | "ReviewMarquee" | "ReviewSpotlight" | "RatingBadgeCluster" | "StarSummaryBar"
  | "ReviewWall" | "VideoTestimonialStrip" | "RecentActivityToasts"
  | "LivePresenceTicker" | "CapacityMeter" | "CounterStatBand" | "SocialFollowerBar"
  | "InstagramGridEmbed" | "UGCCarousel" | "HashtagFeedRail"
  | "TrustBadgeRail" | "PressLogoStrip" | "AwardsTimeline" | "GuaranteePanel"
  | "BeforeAfterSlider" | "CredentialModal" | "LicenseVerifyBadge" | "InsuranceProofPanel"
  | "PortfolioLightbox" | "ProofStickyBar" | "ExitProofModal" | "ProofInlineCallout"
  | "SeoProofBlock" | "VoiceAnswerBlock" | "SpeakableSchema" | "ServiceAreaBanner"
  | "MultiLocationMap" | "OpenNowStatus" | "WaitTimeBadge" | "BookNowSticky"
  | "EmergencyCTABand" | "ResponseTimePromise" | "ServiceMenuGrid" | "MenuSchemaBlock";

export type WidgetCategory =
  | "TRUST_CREDENTIALS" | "VISUAL_TRANSFORM" | "BOOKING_AVAIL" | "EMERGENCY_URGENCY"
  | "LOCAL_GEO" | "REVIEWS_REP" | "CATALOG_PRICED" | "SOCIAL_UGC";

export interface WidgetProfile {
  /** rendered in priority slots by the layout engine */
  promoted: WidgetId[];
  /** rendered only when explicitly requested */
  available: WidgetId[];
  /** never mounted, even if data exists */
  suppressed: WidgetId[];
}

export interface Geo { lat: number; lng: number }

export interface LocationEntry {
  id: string;
  label: string;
  street: string;
  city: string;
  region: string;
  postal: string;
  country: string;
  geo?: Geo;
  phone?: string;
  mapUrl?: string;
}

export interface HoursEntry {
  /** Monday | Tuesday | ... */
  day: string;
  /** 24h "09:00" — omit both for a closed day */
  open?: string;
  close?: string;
}

export interface PlatformRating {
  platform: string;          // "Google" | "Yelp" | "Facebook" | ...
  ratingValue: number;       // 4.9
  reviewCount: number;       // 412
  bestRating?: number;       // default 5
  profileUrl?: string;
  verifiedAt?: string;       // ISO date the number was last confirmed
}

export interface ReviewEntry {
  id: string;
  author: string;
  rating: number;
  body: string;
  platform?: string;
  date?: string;
  avatarUrl?: string;
  sourceUrl?: string;
  serviceTag?: string;
  location?: string;
}

export interface VideoTestimonial {
  id: string; author: string; posterUrl: string; videoUrl: string;
  caption?: string; durationSec?: number;
}

export interface MediaItem {
  id: string; src: string; alt: string;
  width?: number; height?: number;
  tags?: string[]; caption?: string; credit?: string; sourceUrl?: string;
}

export interface BeforeAfterPair {
  id: string; beforeSrc: string; afterSrc: string; alt: string;
  label?: string; durationLabel?: string; serviceTag?: string;
}

export interface Credential {
  id: string; name: string; issuer: string;
  number?: string; issuedAt?: string; expiresAt?: string;
  verifyUrl?: string; logoUrl?: string;
  kind?: "license" | "insurance" | "certification" | "membership" | "bond";
}

export interface BadgeEntry { id: string; label: string; logoUrl?: string; url?: string; detail?: string }
export interface PressEntry { id: string; outlet: string; logoUrl?: string; url?: string; quote?: string; date?: string }
export interface AwardEntry { id: string; title: string; year: string; issuer?: string; url?: string }
export interface GuaranteeEntry { id: string; title: string; detail: string; icon?: string }

export interface StatEntry { id: string; value: number; label: string; suffix?: string; prefix?: string }

export interface SocialAccount {
  platform: "instagram" | "tiktok" | "facebook" | "x" | "youtube" | "linkedin" | "pinterest" | "nextdoor";
  handle: string;
  url: string;
  followers?: number;
  verifiedAt?: string;
}

export interface ServiceEntry {
  id: string; name: string; description?: string;
  priceFrom?: number; priceTo?: number; priceUnit?: string; currency?: string;
  durationMin?: number; areaServed?: string[]; image?: string; popular?: boolean;
}

export interface VoiceAnswer { id: string; question: string; answer: string; updatedAt?: string }

export interface AvailabilityConfig {
  /** 0..1 — how full the book is. Omit to hide CapacityMeter. */
  bookedRatio?: number;
  slotsLeft?: number;
  nextAvailable?: string;      // human string: "Thu 2:15pm"
  waitTimeMinutes?: number;    // WaitTimeBadge
  responseTimeMinutes?: number;// ResponseTimePromise
  emergency?: { available: boolean; label?: string; phone?: string; note?: string };
}

export interface LivePresenceConfig {
  /** verified analytics figure only; omit to suppress */
  viewersNow?: number;
  recentActions?: { id: string; text: string; city?: string; minutesAgo: number }[];
}

export interface TrustConfig {
  business: {
    name: string; legalName?: string;
    /** schema.org type: Plumber, HVACBusiness, RoofingContractor, TattooParlor, ... */
    schemaType: string;
    category: string;           // human label: "Emergency Plumbing"
    tagline?: string;
    description?: string;
    url: string;
    logo?: string;
    image?: string;
    foundingYear?: string;
    priceRange?: string;
  };
  contact: {
    phone?: string;             // E.164 "+15125550137"
    phoneDisplay?: string;      // "(512) 555-0137"
    sms?: string;
    email?: string;
    bookingUrl?: string;
    quoteUrl?: string;
    checkoutUrl?: string;
  };
  location: {
    primary?: LocationEntry;
    locations?: LocationEntry[];
    serviceRadiusKm?: number;
    serviceAreas?: string[];
    timezone?: string;
  };
  hours: { weekly: HoursEntry[]; special?: { date: string; open?: string; close?: string; note?: string }[]; open24?: boolean };
  proof: {
    ratings?: PlatformRating[];
    reviews?: ReviewEntry[];
    videoTestimonials?: VideoTestimonial[];
    stats?: StatEntry[];
    badges?: BadgeEntry[];
    credentials?: Credential[];
    press?: PressEntry[];
    awards?: AwardEntry[];
    guarantees?: GuaranteeEntry[];
    beforeAfter?: BeforeAfterPair[];
    gallery?: MediaItem[];
    ugc?: MediaItem[];
    hashtag?: string;
  };
  social: { accounts?: SocialAccount[] };
  services: ServiceEntry[];
  voice: { answers?: VoiceAnswer[] };
  availability: AvailabilityConfig;
  live: LivePresenceConfig;
  /** every user-visible noun, so copy fits the trade */
  labels: {
    workNoun: string;        // "job" | "piece" | "treatment" | "project"
    workNounPlural: string;
    customerNoun: string;    // "customer" | "client" | "guest" | "patient"
    customerNounPlural: string;
    bookVerb: string;        // "Book" | "Schedule" | "Request"
    bookCta: string;         // "Book your appointment"
    quoteCta: string;        // "Get a free estimate"
    galleryTitle: string;
    reviewsTitle: string;
    credentialsTitle: string;
    serviceMenuTitle: string;
    emergencyLabel?: string;
  };
  widgetProfile: WidgetProfile;
  /** consent + privacy switches */
  options?: {
    allowGeolocationPrompt?: boolean;
    activityToastsEnabled?: boolean;
    reduceMotionOverride?: boolean;
  };
}

export const emptyWidgetProfile: WidgetProfile = { promoted: [], available: [], suppressed: [] };

/** A completely empty, valid config. Every widget renders null against it. */
export const blankTrustConfig: TrustConfig = {
  business: { name: "", schemaType: "LocalBusiness", category: "", url: "" },
  contact: {},
  location: {},
  hours: { weekly: [] },
  proof: {},
  social: {},
  services: [],
  voice: {},
  availability: {},
  live: {},
  labels: {
    workNoun: "job", workNounPlural: "jobs",
    customerNoun: "customer", customerNounPlural: "customers",
    bookVerb: "Book", bookCta: "Book now", quoteCta: "Get a quote",
    galleryTitle: "Our work", reviewsTitle: "What customers say",
    credentialsTitle: "Licensed & insured", serviceMenuTitle: "Services",
  },
  widgetProfile: emptyWidgetProfile,
};

export function defineTrustConfig(cfg: TrustConfig): TrustConfig { return cfg; }
