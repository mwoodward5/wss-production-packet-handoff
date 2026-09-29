/**
 * ┌── MIRROR:TEMPLATE-CODE ──────────────────────────────────────────────────
 * │ WHAT THIS FILE HOLDS: all structured data Google reads — LocalBusiness,
 * │ AggregateRating, Review, GeoCoordinates, hasMap, areaServed, OpeningHours,
 * │ Service/Offer, FAQPage, Speakable.
 * │ WHO WRITES IT: nobody — byte-identical in every mirrored client.
 * │ WHAT THE ENGINE FEEDS IT (schema field <- config key <- source):
 * │   @type            <- trustConfig.business.schemaType <- pick per trade (Plumber, HVACBusiness…)
 * │   aggregateRating  <- proof.ratings[0]                <- Places rating + userRatingCount
 * │   review[]         <- proof.reviews[]                 <- Places reviews[]
 * │   geo / hasMap     <- location.primary.geo / mapUrl   <- Places location + googleMapsUri
 * │   openingHours     <- hours.weekly[]                  <- Places regularOpeningHours
 * │   areaServed       <- location.serviceAreas[]         <- Firecrawl service-area scrape
 * │   makesOffer       <- services[]                      <- Firecrawl /services/* scrape
 * │ HARD RULE: never publish a rating you did not read from a live platform —
 * │ fabricated AggregateRating is a manual-action risk. Omit instead.
 * │ FULL SPEC: MIRRORING-ENGINE.md §Structured data
 * └──────────────────────────────────────────────────────────────────────────
 */
import type { TrustConfig, LocationEntry, PlatformRating } from "../trust.config";
import { allLocations } from "./geo";

const DAY_URL = (d: string) => `https://schema.org/${d}`;

function addressOf(l: LocationEntry) {
  return {
    "@type": "PostalAddress",
    streetAddress: l.street, addressLocality: l.city,
    addressRegion: l.region, postalCode: l.postal, addressCountry: l.country || "US",
  };
}

function hoursOf(cfg: TrustConfig) {
  if (cfg.hours?.open24) {
    return [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(DAY_URL), opens: "00:00", closes: "23:59" }];
  }
  return (cfg.hours?.weekly ?? [])
    .filter((h) => h.open && h.close)
    .map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DAY_URL(h.day), opens: h.open, closes: h.close }));
}

/** Only emitted when a real, verified rating exists. Never fabricated. */
export function aggregateRatingOf(cfg: TrustConfig) {
  const ratings = (cfg.proof?.ratings ?? []).filter((r) => r.ratingValue > 0 && r.reviewCount > 0);
  if (!ratings.length) return undefined;
  const count = ratings.reduce((n, r) => n + r.reviewCount, 0);
  const weighted = ratings.reduce((n, r) => n + r.ratingValue * r.reviewCount, 0) / count;
  return {
    "@type": "AggregateRating",
    ratingValue: Math.round(weighted * 10) / 10,
    reviewCount: count,
    bestRating: Math.max(...ratings.map((r: PlatformRating) => r.bestRating ?? 5)),
  };
}

export function sameAs(cfg: TrustConfig): string[] {
  return (cfg.social?.accounts ?? []).map((a) => a.url).filter(Boolean);
}

export function localBusinessSchema(cfg: TrustConfig) {
  const primary = cfg.location?.primary ?? allLocations(cfg)[0];
  if (!cfg.business?.name || !cfg.business?.url) return undefined;
  const agg = aggregateRatingOf(cfg);
  const areas = [
    ...(cfg.location?.serviceAreas ?? []).map((a) => ({ "@type": "City", name: a })),
    ...(primary?.geo && cfg.location?.serviceRadiusKm
      ? [{
          "@type": "GeoCircle",
          geoMidpoint: { "@type": "GeoCoordinates", latitude: primary.geo.lat, longitude: primary.geo.lng },
          geoRadius: Math.round(cfg.location.serviceRadiusKm * 1000),
        }]
      : []),
  ];
  return {
    "@context": "https://schema.org",
    "@type": [cfg.business.schemaType || "LocalBusiness", "LocalBusiness"],
    "@id": `${cfg.business.url}#business`,
    name: cfg.business.name,
    ...(cfg.business.legalName ? { legalName: cfg.business.legalName } : {}),
    ...(cfg.business.description ? { description: cfg.business.description } : {}),
    url: cfg.business.url,
    ...(cfg.business.logo ? { logo: cfg.business.logo } : {}),
    ...(cfg.business.image ? { image: cfg.business.image } : {}),
    ...(cfg.contact?.phone ? { telephone: cfg.contact.phone } : {}),
    ...(cfg.contact?.email ? { email: cfg.contact.email } : {}),
    ...(cfg.business.priceRange ? { priceRange: cfg.business.priceRange } : {}),
    ...(cfg.business.foundingYear ? { foundingDate: cfg.business.foundingYear } : {}),
    ...(primary ? { address: addressOf(primary) } : {}),
    ...(primary?.geo ? { geo: { "@type": "GeoCoordinates", latitude: primary.geo.lat, longitude: primary.geo.lng } } : {}),
    ...(hoursOf(cfg).length ? { openingHoursSpecification: hoursOf(cfg) } : {}),
    ...(areas.length ? { areaServed: areas } : {}),
    ...(sameAs(cfg).length ? { sameAs: sameAs(cfg) } : {}),
    ...(agg ? { aggregateRating: agg } : {}),
    ...(cfg.services?.length ? { hasOfferCatalog: offerCatalog(cfg) } : {}),
    ...(potentialActions(cfg).length ? { potentialAction: potentialActions(cfg) } : {}),
  };
}

export function offerCatalog(cfg: TrustConfig) {
  return {
    "@type": "OfferCatalog",
    name: cfg.labels?.serviceMenuTitle || "Services",
    itemListElement: cfg.services.map((s) => ({
      "@type": "Offer",
      ...(s.priceFrom ? {
        priceSpecification: {
          "@type": "PriceSpecification",
          price: s.priceFrom, priceCurrency: s.currency || "USD",
          ...(s.priceTo ? { maxPrice: s.priceTo, minPrice: s.priceFrom } : {}),
        },
      } : {}),
      itemOffered: {
        "@type": "Service",
        name: s.name,
        ...(s.description ? { description: s.description } : {}),
        provider: { "@id": `${cfg.business.url}#business` },
        ...(s.areaServed?.length ? { areaServed: s.areaServed.map((a) => ({ "@type": "City", name: a })) } : {}),
      },
    })),
  };
}

export function potentialActions(cfg: TrustConfig) {
  const out: Record<string, unknown>[] = [];
  if (cfg.contact?.bookingUrl) {
    out.push({
      "@type": "ReserveAction",
      target: { "@type": "EntryPoint", urlTemplate: cfg.contact.bookingUrl, actionPlatform: ["https://schema.org/DesktopWebPlatform","https://schema.org/MobileWebPlatform"] },
      result: { "@type": "Reservation", name: cfg.labels?.bookCta || "Booking" },
    });
  }
  if (cfg.contact?.phone) {
    out.push({ "@type": "CommunicateAction", target: { "@type": "EntryPoint", urlTemplate: `tel:${cfg.contact.phone}` } });
  }
  return out;
}

export function organizationSchema(cfg: TrustConfig) {
  const locs = allLocations(cfg);
  if (locs.length < 2) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${cfg.business.url}#org`,
    name: cfg.business.name,
    url: cfg.business.url,
    ...(sameAs(cfg).length ? { sameAs: sameAs(cfg) } : {}),
    subOrganization: locs.map((l) => ({
      "@type": cfg.business.schemaType || "LocalBusiness",
      "@id": `${cfg.business.url}#loc-${l.id}`,
      name: `${cfg.business.name} — ${l.label}`,
      address: addressOf(l),
      ...(l.phone ? { telephone: l.phone } : {}),
      ...(l.geo ? { geo: { "@type": "GeoCoordinates", latitude: l.geo.lat, longitude: l.geo.lng } } : {}),
    })),
  };
}

/** Individual reviews — only from real review entries. */
export function reviewSchema(cfg: TrustConfig) {
  const reviews = cfg.proof?.reviews ?? [];
  if (!reviews.length || !cfg.business?.url) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": cfg.business.schemaType || "LocalBusiness",
    "@id": `${cfg.business.url}#business`,
    name: cfg.business.name,
    review: reviews.slice(0, 12).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
      reviewBody: r.body,
      ...(r.date ? { datePublished: r.date } : {}),
      ...(r.platform ? { publisher: { "@type": "Organization", name: r.platform } } : {}),
    })),
  };
}

export function faqSchema(
  cfg: TrustConfig,
  selector = ".tw-voice-answer",
  answersOverride?: { id: string; question: string; answer: string }[]
) {
  const answers = answersOverride ?? cfg.voice?.answers ?? [];
  if (!answers.length) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: answers.map((a) => ({
      "@type": "Question", name: a.question,
      acceptedAnswer: { "@type": "Answer", text: a.answer },
    })),
    speakable: { "@type": "SpeakableSpecification", cssSelector: [selector] },
  };
}

export function breadcrumbSchema(cfg: TrustConfig, items: { name: string; path: string }[]) {
  if (!items.length) return undefined;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((i, idx) => ({
      "@type": "ListItem", position: idx + 1, name: i.name, item: `${cfg.business.url}${i.path}`,
    })),
  };
}
