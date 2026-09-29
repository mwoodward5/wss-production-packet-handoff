/**
 * JSON-LD schema components driven by config.
 * Generic enough to work for any LocalBusiness vertical.
 */
import { CLIENT, BRAND, SEO, absoluteUrl, socialSameAs } from "@/config";
import { DATA } from "@/wss/bridge";
import { verifiedGeo } from "./NativeMapLinks";

function ld(obj: unknown) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(obj).replace(/</g, "\\u003c") }} />;
}

function dayCode(d: string): string {
  const map: Record<string, string> = {
    monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th",
    friday: "Fr", saturday: "Sa", sunday: "Su",
  };
  return map[d] ?? d;
}

function buildOpeningHours() {
  const entries = Object.entries(CLIENT.hours);
  const out: { dayOfWeek: string; opens: string; closes: string }[] = [];
  for (const [day, h] of entries) {
    if (h === "closed") continue;
    const opens = h === "24h" ? "00:00" : h.open;
    const closes = h === "24h" ? "23:59" : h.close;
    out.push({ dayOfWeek: dayCode(day), opens, closes });
  }
  return out;
}

export function LocalBusinessSchema() {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": CLIENT.schemaType || "LocalBusiness",
    "@id": absoluteUrl("/#business"),
    name: CLIENT.businessName,
    description: CLIENT.shortDescription,
    url: SEO.baseUrl,
    telephone: CLIENT.phoneE164,
    email: CLIENT.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: CLIENT.street,
      addressLocality: CLIENT.city,
      addressRegion: CLIENT.region,
      postalCode: CLIENT.postalCode,
      addressCountry: CLIENT.country,
    },
    ...(verifiedGeo?.schemaAllowed === true ? { geo: { "@type": "GeoCoordinates", latitude: verifiedGeo.lat, longitude: verifiedGeo.lng } } : {}),
    areaServed: CLIENT.serviceAreaCities.map((c) => ({ "@type": "City", name: c.name })),
    openingHoursSpecification: buildOpeningHours().map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.dayOfWeek,
      opens: h.opens,
      closes: h.closes,
    })),
    sameAs: socialSameAs(),
  };
  if (DATA.trust.aggregate?.rating != null && DATA.trust.aggregate?.count != null) {
    data.aggregateRating = { "@type": "AggregateRating", ratingValue: DATA.trust.aggregate.rating, reviewCount: DATA.trust.aggregate.count };
  }
  return ld(data);
}

export function OrganizationSchema() {
  return ld({
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: CLIENT.businessName,
    url: SEO.baseUrl,
    logo: absoluteUrl(BRAND.logoLight),
    sameAs: socialSameAs(),
    contactPoint: [{
      "@type": "ContactPoint",
      telephone: CLIENT.phoneE164,
      contactType: "customer service",
      email: CLIENT.email,
      areaServed: CLIENT.country,

    }],
  });
}

export function WebSiteSchema() {
  return ld({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    url: SEO.baseUrl,
    name: SEO.siteName,
    description: SEO.defaultDescription,
    inLanguage: SEO.locale.replace("_", "-"),
  });
}

export function BreadcrumbSchema({ items }: { items: { name: string; url: string }[] }) {
  return ld({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  });
}

export function FAQSchema({ items }: { items: { q: string; a: string }[] }) {
  if (!items.length) return null;
  return ld({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  });
}

export function SpeakableSchema({ url, qa = [] }: { url: string; qa?: { q: string; a: string }[] }) {
  return ld({
    "@context": "https://schema.org",
    "@type": "WebPage",
    url,
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["h1", "h2", ".speakable", "article p:first-of-type"],
    },
    ...(qa.length > 0 ? {
      mainEntity: qa.map((i) => ({
        "@type": "Question",
        name: i.q,
        acceptedAnswer: { "@type": "Answer", text: i.a },
      })),
    } : {}),
  });
}


