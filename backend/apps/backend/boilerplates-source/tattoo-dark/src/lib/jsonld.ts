import { siteConfig } from "@/config/siteConfig";

const dayMap: Record<string, string> = {
  Monday: "Mo", Tuesday: "Tu", Wednesday: "We", Thursday: "Th",
  Friday: "Fr", Saturday: "Sa", Sunday: "Su",
};

export function tattooParlorSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "TattooParlor",
    "@id": `${siteConfig.siteUrl}#business`,
    name: siteConfig.studioName,
    description: siteConfig.tagline,
    url: siteConfig.siteUrl,
    telephone: siteConfig.phone,
    email: siteConfig.email,
    image: `${siteConfig.siteUrl}/og-home.jpg`,
    priceRange: siteConfig.pricing.priceRange,
    address: {
      "@type": "PostalAddress",
      streetAddress: siteConfig.addressLine1,
      addressLocality: siteConfig.addressLocality,
      addressRegion: siteConfig.addressRegion,
      postalCode: siteConfig.postalCode,
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: siteConfig.geo.lat,
      longitude: siteConfig.geo.lng,
    },
    openingHoursSpecification: siteConfig.hours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${h.day}`,
      opens: h.open,
      closes: h.close,
    })),
    areaServed: siteConfig.areasServed.map((a) => ({ "@type": "City", name: a })),
    sameAs: [siteConfig.instagram],
  };
}

export function personSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${siteConfig.siteUrl}/artist#raven`,
    name: siteConfig.artistName,
    jobTitle: "Tattoo Artist",
    worksFor: { "@id": `${siteConfig.siteUrl}#business` },
    url: `${siteConfig.siteUrl}/artist`,
    sameAs: [siteConfig.instagram],
    description: siteConfig.bio,
  };
}

export function faqSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: siteConfig.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: [".faq-answer"],
    },
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((i, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: i.name,
      item: `${siteConfig.siteUrl}${i.path}`,
    })),
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    url: siteConfig.siteUrl,
    name: siteConfig.studioName,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteConfig.siteUrl}/portfolio?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/** Human-readable operating hours for the day markers. */
export function hoursDayCode(day: string) {
  return dayMap[day] ?? day;
}
