export const AUTHORITY_SCHEMA_VERSION = "authority-schema-v1";

const clean = (value) => String(value ?? "").trim();
const validUrl = (value) => /^https?:\/\//i.test(clean(value));
const normalizedTaxonomy = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const verifiedRow = (packet, key) => {
  const row = packet?.enrichment_sources?.[key];
  if (!row || row.value == null || row.value === "") return null;
  if (/recipe|fallback|generated|inferred|placeholder/i.test(clean(row.source))) return null;
  if (row.confidence != null && Number(row.confidence) < 0.6) return null;
  return row;
};

export function localBusinessSubtype(category = "") {
  const value = clean(category).toLowerCase();
  if (/roof/.test(value)) return "RoofingContractor";
  if (/electric/.test(value)) return "Electrician";
  if (/plumb/.test(value)) return "Plumber";
  if (/hvac|heating|air condition/.test(value)) return "HVACBusiness";
  if (/paint/.test(value)) return "HousePainter";
  if (/locksmith|lock service/.test(value)) return "Locksmith";
  if (/moving|mover/.test(value)) return "MovingCompany";
  if (/general contractor|construction/.test(value)) return "GeneralContractor";
  if (/landscap|lawn|tree|arbor|fenc|excavat|grading|concrete|mason|hardscap|remodel|carpent|floor|window|door|gutter/.test(value)) return "HomeAndConstructionBusiness";
  return "LocalBusiness";
}

export function parseVerifiedPostalAddress(value, fallback = {}) {
  const raw = clean(value);
  if (!raw) return null;
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const regionZip = parts.at(-1)?.match(/^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/i);
  if (parts.length >= 3 && regionZip) {
    return {
      "@type": "PostalAddress",
      streetAddress: parts.slice(0, -2).join(", "),
      addressLocality: parts.at(-2),
      addressRegion: regionZip[1].toUpperCase(),
      ...(regionZip[2] ? { postalCode: regionZip[2] } : {}),
      addressCountry: "US",
    };
  }
  return {
    "@type": "PostalAddress",
    streetAddress: raw,
    ...(fallback.city ? { addressLocality: clean(fallback.city) } : {}),
    ...(fallback.state ? { addressRegion: clean(fallback.state).toUpperCase() } : {}),
    addressCountry: "US",
  };
}

const nodeId = (base, fragment) => `${base === "/" ? "" : base.replace(/\/$/, "")}/#${fragment}` || `/#${fragment}`;
const pageUrl = (base, pathValue) => {
  const route = clean(pathValue) || "/";
  if (validUrl(route)) return route;
  if (!validUrl(base)) return route.startsWith("/") ? route : `/${route}`;
  return new URL(route, base.endsWith("/") ? base : `${base}/`).toString();
};

export function schemaTypesFromGraph(graph) {
  const types = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value["@type"]) types.push(...(Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]]));
    Object.values(value).forEach(visit);
  };
  visit(graph);
  return [...new Set(types)];
}

export function buildAuthoritySchema({
  ctx,
  pageName = null,
  canonicalPath = "/",
  breadcrumbs = null,
  servicePage = null,
  faqs = null,
  speakableSelectors = [".speakable"],
} = {}) {
  if (!ctx?.packet || !ctx?.biz) throw new TypeError("buildAuthoritySchema requires a renderer context");
  const { packet, biz, services = [], phone, gbp = {}, intro = "" } = ctx;
  const base = clean(packet.public_url || packet.canonical_url || packet.site_url || "/") || "/";
  const url = pageUrl(base, canonicalPath);
  const organizationId = nodeId(base, "organization");
  const businessId = nodeId(base, "localbusiness");
  const websiteId = nodeId(base, "website");
  const addressRow = verifiedRow(packet, "address");
  const latlngRow = addressRow ? verifiedRow(packet, "latlng") : null;
  const hoursRow = verifiedRow(packet, "hours");
  const founderRow = verifiedRow(packet, "founder");
  const socialRow = verifiedRow(packet, "socials") || verifiedRow(packet, "social_profiles");
  const ratingRow = verifiedRow(packet, "rating");
  const websiteRow = verifiedRow(packet, "website") || verifiedRow(packet, "current_website");
  const sourceWebsite = websiteRow
    && validUrl(websiteRow.value)
    && validUrl(packet.business?.current_website)
    && new URL(websiteRow.value).hostname.replace(/^www\./i, "").toLowerCase()
      === new URL(packet.business.current_website).hostname.replace(/^www\./i, "").toLowerCase()
    ? clean(packet.business.current_website)
    : null;
  const address = addressRow ? parseVerifiedPostalAddress(addressRow.value, biz) : null;
  const latlng = latlngRow?.value || null;
  const subtype = localBusinessSubtype(biz.category || ctx.trade?.key);
  const type = subtype === "LocalBusiness" ? "LocalBusiness" : [subtype, "LocalBusiness"];
  const logoSource = packet.logo_source || {};
  const logo = !logoSource.proposed && validUrl(logoSource.chosen_url || logoSource.url)
    ? logoSource.chosen_url || logoSource.url
    : null;
  const sameAs = [
    sourceWebsite,
    ...(Array.isArray(socialRow?.value) ? socialRow.value : Object.values(socialRow?.value || {})),
  ].filter(validUrl).filter((value, index, values) => values.indexOf(value) === index);
  const cleanDescription = clean(intro).replace(/[“”]/g, "");
  const contactPoint = phone ? {
    "@type": "ContactPoint",
    telephone: clean(phone),
    contactType: "customer service",
    availableLanguage: ["English"],
  } : null;

  const organization = {
    "@type": "Organization",
    "@id": organizationId,
    name: clean(biz.name),
    url: pageUrl(base, "/"),
    ...(logo ? { logo } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };

  const localBusiness = {
    "@type": type,
    "@id": businessId,
    name: clean(biz.name),
    url: pageUrl(base, "/"),
    description: cleanDescription,
    parentOrganization: { "@id": organizationId },
    areaServed: {
      "@type": "City",
      name: [clean(biz.city), clean(biz.state)].filter(Boolean).join(", "),
    },
    ...(sourceWebsite ? { sameAs: [sourceWebsite] } : {}),
    ...(logo ? { image: logo } : {}),
    ...(phone ? { telephone: clean(phone), contactPoint } : {}),
    ...(address ? { address } : {}),
    ...(address && latlng?.lat != null && latlng?.lng != null ? {
      geo: { "@type": "GeoCoordinates", latitude: Number(latlng.lat), longitude: Number(latlng.lng) },
    } : {}),
    ...(hoursRow && Array.isArray(gbp.hoursSpec) && gbp.hoursSpec.length ? { openingHoursSpecification: gbp.hoursSpec } : {}),
  };

  const rating = ratingRow?.schema_eligible === true ? ratingRow.value : null;
  const ratingValue = rating && typeof rating === "object" ? rating.value ?? rating.rating : rating;
  const ratingCount = rating && typeof rating === "object" ? rating.count ?? rating.review_count ?? rating.reviews : ratingRow?.count;
  if (Number(ratingValue) > 0 && Number(ratingCount) > 0) {
    localBusiness.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Number(ratingValue),
      reviewCount: Number(ratingCount),
    };
  }

  const graph = [organization, localBusiness];
  if (founderRow) {
    const founder = typeof founderRow.value === "object" ? founderRow.value : { name: founderRow.value };
    if (clean(founder.name)) {
      graph.push({
        "@type": "Person",
        "@id": nodeId(base, "founder"),
        name: clean(founder.name),
        ...(clean(founder.jobTitle) ? { jobTitle: clean(founder.jobTitle) } : {}),
        worksFor: { "@id": businessId },
      });
    }
  }

  const selectedService = clean(servicePage || services[0]);
  const verifiedService = services.find((service) => clean(service).toLowerCase() === selectedService.toLowerCase());
  const categoryRow = verifiedRow(packet, "category");
  const businessCategory = clean(biz.category || ctx.trade?.key);
  const verifiedCategoryService = !servicePage
    && !verifiedService
    && categoryRow
    && normalizedTaxonomy(categoryRow.value) === normalizedTaxonomy(businessCategory)
    ? clean(categoryRow.value)
    : "";
  const schemaService = clean(verifiedService || verifiedCategoryService);
  if (schemaService) {
    graph.push({
      "@type": "Service",
      "@id": `${url.replace(/\/$/, "")}/#service`,
      name: schemaService,
      serviceType: schemaService,
      provider: { "@id": businessId },
      areaServed: { "@type": "City", name: [clean(biz.city), clean(biz.state)].filter(Boolean).join(", ") },
    });
  }

  const visibleFaqs = (faqs || ctx.faqs || []).filter((entry) => Array.isArray(entry) && clean(entry[0]) && clean(entry[1]));
  if (visibleFaqs.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url.replace(/\/$/, "")}/#faq`,
      mainEntity: visibleFaqs.map(([question, answer]) => ({
        "@type": "Question",
        name: clean(question),
        acceptedAnswer: { "@type": "Answer", text: clean(answer) },
      })),
    });
  }

  const crumbItems = (breadcrumbs || [{ name: "Home", item: "/" }]).map((item, index) => {
    if (Array.isArray(item)) return { "@type": "ListItem", position: index + 1, name: clean(item[1]), item: pageUrl(base, item[0] || "/") };
    return { "@type": "ListItem", position: index + 1, name: clean(item.name), item: pageUrl(base, item.item || "/") };
  });
  graph.push({ "@type": "BreadcrumbList", "@id": `${url.replace(/\/$/, "")}/#breadcrumb`, itemListElement: crumbItems });
  graph.push({ "@type": "WebSite", "@id": websiteId, name: clean(biz.name), url: pageUrl(base, "/"), publisher: { "@id": organizationId } });
  graph.push({
    "@type": "WebPage",
    "@id": `${url.replace(/\/$/, "")}/#webpage`,
    url,
    name: clean(pageName || biz.name),
    isPartOf: { "@id": websiteId },
    about: { "@id": businessId },
    speakable: { "@type": "SpeakableSpecification", cssSelector: speakableSelectors },
  });

  return { "@context": "https://schema.org", "@graph": graph };
}
