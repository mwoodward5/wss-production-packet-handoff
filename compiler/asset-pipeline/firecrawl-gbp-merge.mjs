// Firecrawl + GBP merger. Reads discover-stage outputs and produces a normalized
// enrichment map with per-field source and confidence. Missing fields get a
// documented fallback marker. Verified structured facts always stay ahead of
// weaker markdown extraction.
import { parseGbpDeep } from "./gbp-deep.mjs";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PARSED_SOURCE = "gbp-markdown";
const PARSED_CONFIDENCE = 0.85;
const VERIFIED_CITY_FALLBACK_CONFIDENCE = 0.7;

export function mergeEnrichment(packet) {
  if (!packet || typeof packet !== "object") return packet;

  const src = isRecord(packet.enrichment_sources) ? packet.enrichment_sources : {};
  const parsed = parseGbpMarkdown(src.gbp_raw?.value ?? src.gbp_raw ?? "");
  const next = { ...src };
  const branding = asRecord(factValue(src.branding));

  // Existing structured facts are authoritative. These fallback fields are
  // only populated when the packet has no usable value yet.
  putIfMissing(next, "logo", branding.logo, { source: "firecrawl-branding" });
  putIfMissing(next, "colors", branding.colors, { source: "firecrawl-branding" });
  putIfMissing(next, "services", packet.services, { source: "intake" });
  if (!hasValue(next.services)) putIfMissing(next, "services", extractServices(factValue(src.copy)));

  mergeHours(next, parsed);
  mergeReviews(next, parsed.reviews);
  mergePhotos(next, parsed.photos);
  mergeNap(next, packet, parsed.nap);
  mergeServiceAreas(next, parsed.service_areas, packet.business);

  packet.enrichment_sources = next;
  mergeMediaCatalog(packet, parsed.photos);
  return packet;
}

// Exported for focused tests and for callers that need the same safe parser.
// It accepts either raw markdown or a Firecrawl/deep-parser result object.
export function parseGbpMarkdown(raw) {
  const input = normalizeRawInput(raw);
  const structured = { ...(isRecord(input.data) ? input.data : {}), ...(isRecord(input.value) ? input.value : {}) };
  const markdown = input.markdown;
  let deep = {};

  try {
    deep = parseGbpDeep({ markdown, links: input.links, url: input.url }) || {};
  } catch {
    // Firecrawl responses are untrusted input. A malformed payload means no
    // parsed fact, not a failed build.
    deep = {};
  }

  const hours = normalizeHours(factValue(structured.hours) ?? deep.hours ?? parseHoursFallback(markdown));
  const reviewValue = hasValue(structured.reviews_attributed)
    ? factValue(structured.reviews_attributed)
    : hasValue(structured.reviews)
      ? factValue(structured.reviews)
      : hasValue(deep.reviews)
        ? deep.reviews
        : parseReviewsFallback(markdown);
  const reviews = normalizeReviews(reviewValue);
  const normalizedReviews = reviews.length ? reviews : normalizeReviews(parseReviewsFallback(markdown));
  const photos = normalizePhotoUrls(factValue(structured.photos) ?? factValue(structured.gbp_photos) ?? deep.photos);
  const nap = normalizeNap({
    ...(isRecord(factValue(structured.nap)) ? factValue(structured.nap) : {}),
    name: factValue(structured.nap)?.name ?? structured.name,
    address: factValue(structured.nap)?.address ?? factValue(structured.address) ?? deep.address,
    phone: factValue(structured.nap)?.phone ?? factValue(structured.phone) ?? parsePhone(markdown),
  });
  const serviceAreas = normalizeStrings(factValue(structured.service_areas) ?? parseServiceAreas(markdown));
  const hoursSpec = factValue(structured.hours_spec) ?? factValue(structured.hoursSpec) ?? deep.hoursSpec ?? deriveHoursSpec(hours);

  return {
    hours,
    hours_spec: hoursSpec,
    reviews: normalizedReviews,
    photos,
    nap,
    service_areas: serviceAreas,
  };
}

function mergeHours(src, parsed) {
  const existing = src.hours;
  const existingHours = normalizeHours(factValue(existing));
  const parsedHours = normalizeHours(parsed.hours);
  const hours = dedupeHours([...existingHours, ...parsedHours]);

  if (hours.length) {
    const fact = hasValue(existing) ? cloneFact(existing, hours) : makeFact(hours, parsed.hours_spec);
    if (!hasValue(fact.hours_spec)) fact.hours_spec = parsed.hours_spec ?? deriveHoursSpec(hours);
    src.hours = fact;
  } else if (!existing) {
    src.hours = fallbackFact("hours");
  }
}

function mergeReviews(src, parsedReviews) {
  const existingFact = hasValue(src.reviews_attributed) ? src.reviews_attributed : src.reviews;
  const reviews = dedupeReviews([
    ...normalizeReviews(factValue(existingFact)),
    ...normalizeReviews(parsedReviews),
  ]);

  if (reviews.length) {
    const fact = hasValue(existingFact) ? cloneFact(existingFact, reviews) : makeFact(reviews);
    src.reviews_attributed = fact;
    // Keep the legacy key populated for older consumers while v8 reads the
    // attributed shape above.
    src.reviews = src.reviews ? cloneFact(src.reviews, reviews) : { ...fact };
  } else if (!src.reviews_attributed && !src.reviews) {
    const fallback = fallbackFact("reviews");
    src.reviews_attributed = fallback;
    src.reviews = { ...fallback };
  }
}

function mergePhotos(src, parsedPhotos) {
  const existingKey = hasValue(src.photos) ? "photos" : hasValue(src.gbp_photos) ? "gbp_photos" : null;
  const existingFact = existingKey ? src[existingKey] : null;
  const existingPhotos = normalizePhotoUrls(factValue(existingFact));
  const photos = dedupeUrls([...existingPhotos, ...normalizePhotoUrls(parsedPhotos)]);

  if (photos.length) {
    const fact = hasValue(existingFact) ? cloneFact(existingFact, mergePhotoValueShape(factValue(existingFact), photos)) : makeFact(photos);
    if (existingKey) src[existingKey] = fact;
    else src.photos = fact;
  } else if (!src.photos && !src.gbp_photos) {
    src.photos = fallbackFact("photos");
  }
}

function mergeNap(src, packet, parsedNap) {
  const existingFact = src.nap;
  const existingNap = normalizeNap(factValue(existingFact));
  const packetNap = {
    name: packet.business?.name,
    address: factValue(src.address),
    phone: factValue(src.phone),
  };
  const nap = mergeRecords(existingNap, mergeRecords(packetNap, parsedNap));

  if (hasValue(nap)) {
    src.nap = hasValue(existingFact) ? cloneFact(existingFact, nap) : makeFact(nap);
  } else if (!existingFact) {
    src.nap = fallbackFact("nap", { name: packet.business?.name || null, address: null, phone: null });
  }

  // v8 reads address and phone as first-class facts. Fill only missing facts;
  // never copy weaker parsed values over an existing source record.
  if (!hasValue(src.address) && nap.address) src.address = makeFact(nap.address);
  if (!hasValue(src.phone) && nap.phone) src.phone = makeFact(nap.phone);
}

function mergeServiceAreas(src, parsedAreas, business) {
  const existing = normalizeStrings(factValue(src.service_areas));
  const parsed = normalizeStrings(parsedAreas);
  const areas = dedupeStrings([...existing, ...parsed]);
  if (areas.length) {
    src.service_areas = hasValue(src.service_areas) ? cloneFact(src.service_areas, areas) : makeFact(areas);
    return;
  }

  const verifiedCity = verifiedCityServiceArea(business);
  src.service_areas = verifiedCity ?? fallbackFact("service_areas");
}

function verifiedCityServiceArea(business) {
  const city = cleanText(business?.city);
  const state = cleanText(business?.state);
  if (!city || !state) return null;

  return {
    source: "verified-business-location",
    confidence: VERIFIED_CITY_FALLBACK_CONFIDENCE,
    provenance: "business.city+business.state",
    derived: true,
    scope: "verified-city-only",
    value: [`${city}, ${state}`],
    fallback: "verified city only; no separate service-area evidence",
  };
}

function mergeMediaCatalog(packet, parsedPhotos) {
  const existing = Array.isArray(packet.media?.catalog) ? packet.media.catalog : [];
  const sourcePhotos = [packet.enrichment_sources?.photos, packet.enrichment_sources?.gbp_photos]
    .filter(Boolean)
    .flatMap((fact) => {
      const factSource = fact.source === PARSED_SOURCE ? "gbp" : fact.source;
      return normalizePhotoEntries(factValue(fact)).map((item) => ({
        ...item,
        source: item.source || factSource,
        provenance: item.provenance || (factSource === "gbp" ? "firecrawl-gbp-markdown" : fact.provenance),
      }));
    });
  const parsed = normalizePhotoEntries(parsedPhotos).map((item) => ({
    ...item,
    source: item.source || "gbp",
    provenance: item.provenance || "firecrawl-gbp-markdown",
    proof_eligible: item.proof_eligible !== false,
    hero_eligible: item.hero_eligible !== false,
  }));
  const catalog = dedupeMedia([...existing, ...sourcePhotos, ...parsed]);
  if (catalog.length) packet.media = { ...(packet.media || {}), catalog };
}

function normalizeRawInput(raw) {
  if (typeof raw === "string") return { markdown: raw, links: [], url: "", value: null, data: null };
  if (!isRecord(raw)) return { markdown: String(raw || ""), links: [], url: "", value: null, data: null };
  const data = isRecord(raw.data) ? raw.data : null;
  const markdown = String(raw.markdown ?? data?.markdown ?? "");
  const links = Array.isArray(raw.links) ? raw.links : Array.isArray(data?.links) ? data.links : [];
  return { markdown, links: links.filter((item) => typeof item === "string" || isRecord(item)), url: String(raw.url ?? data?.url ?? ""), value: raw, data };
}

function extractServices(copy) {
  if (typeof copy !== "string") return null;
  const lines = copy.split(/\n+/).filter((line) => /^\s*[-*•]\s/.test(line));
  return lines.length >= 3 ? lines.slice(0, 10).map((line) => line.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean) : null;
}

function parseHoursFallback(markdown) {
  const out = [];
  for (const day of DAYS) {
    const item = parseHoursLine(String(markdown || ""), day);
    if (item) out.push(item);
  }
  return out.length >= 3 ? out : [];
}

function parseHoursLine(value, day) {
  const re = new RegExp(`${day}\\s*[:\\u00b7|]?\\s*(Closed|Open 24 hours|\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM|am|pm)?\\s*[\\u2013\\u2014-]\\s*\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM|am|pm))`, "i");
  const match = String(value || "").match(re);
  return match ? { day, hours: normalizeHoursText(match[1]) } : null;
}

function parseReviewsFallback(markdown) {
  return [...String(markdown || "").matchAll(/(?:^|\n)★{3,5}[^\n]*\n([^\n]{40,400})/g)]
    .map((match) => ({ author: "Google review", rating: 5, text: match[1].trim(), source: "gbp" }));
}

function normalizeHours(value) {
  if (!value) return [];
  if (typeof value === "string") {
    const parsed = parseHoursFallback(value);
    if (parsed.length) return parsed;
    return DAYS.flatMap((day) => {
      const item = parseHoursLine(value, day);
      return item ? [item] : [];
    });
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return DAYS.flatMap((day) => {
        const parsed = parseHoursLine(item, day);
        return parsed ? [parsed] : [];
      });
      if (!isRecord(item)) return [];
      const day = canonicalDay(item.day ?? item.dayOfWeek ?? item.name);
      const hours = cleanText(item.hours ?? item.openingHours ?? item.value);
      return day && hours ? [{ ...item, day, hours }] : [];
    });
  }
  if (isRecord(value)) {
    return DAYS.flatMap((day) => {
      const hours = value[day] ?? value[day.toLowerCase()];
      return cleanText(hours) ? [{ day, hours: cleanText(hours) }] : [];
    });
  }
  return [];
}

function dedupeHours(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item.day).toLowerCase();
    if (!item.day || !item.hours || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReviews(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (typeof item === "string") {
      const text = cleanText(item);
      return text ? [{ author: "Google review", rating: 5, text, source: "gbp" }] : [];
    }
    if (!isRecord(item)) return [];
    const text = cleanText(item.text ?? item.quote ?? item.review ?? item.body);
    if (!text) return [];
    const author = cleanText(item.author ?? item.name ?? item.reviewer) || "Google review";
    if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+Closed)?$/i.test(author)) return [];
    const rawRating = item.rating ?? item.stars ?? null;
    const rating = rawRating == null || rawRating === "" ? null : Number(rawRating);
    return [{
      ...item,
      author,
      rating: Number.isFinite(rating) ? rating : null,
      text,
      source: cleanText(item.source) || "gbp",
    }];
  });
}

function dedupeReviews(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = cleanText(item.author).toLowerCase() + "|" + cleanText(item.text).toLowerCase().split(/\s+/).join(" ");
    if (!item.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePhotoUrls(value) {
  return normalizePhotoEntries(value).map((item) => item.url).filter(Boolean);
}

function normalizePhotoEntries(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) => {
    const raw = typeof item === "string" ? { url: item } : item;
    if (!isRecord(raw)) return [];
    const url = cleanText(raw.url ?? raw.src ?? raw.public_url ?? raw.original_url);
    return url ? [{ ...raw, kind: raw.kind || "photo", url }] : [];
  });
}

function mergePhotoValueShape(existing, urls) {
  const items = normalizePhotoEntries(existing);
  return Array.isArray(existing) && existing.some((item) => isRecord(item))
    ? dedupeMedia([...items, ...normalizePhotoEntries(urls)])
    : dedupeUrls(urls);
}

function dedupeMedia(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = canonicalUrl(item?.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeUrls(items) {
  const seen = new Set();
  return items.filter((item) => {
    const url = cleanText(typeof item === "string" ? item : item?.url);
    const key = canonicalUrl(url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => typeof item === "string" ? cleanText(item) : cleanText(item.url));
}

function mergeRecords(first, second) {
  const out = {};
  for (const [key, value] of Object.entries(first || {})) if (hasValue(value)) out[key] = value;
  for (const [key, value] of Object.entries(second || {})) if (!hasValue(out[key]) && hasValue(value)) out[key] = value;
  return out;
}

function putIfMissing(src, key, value, meta = {}) {
  if (hasValue(src[key]) || !hasValue(value)) return;
  src[key] = makeFact(value, null, meta);
}

function makeFact(value, hoursSpec = null, meta = {}) {
  return {
    source: meta.source || PARSED_SOURCE,
    confidence: meta.confidence == null ? PARSED_CONFIDENCE : Number(meta.confidence),
    ...meta,
    value,
    ...(hoursSpec != null ? { hours_spec: hoursSpec } : {}),
  };
}

function cloneFact(fact, value) {
  if (isRecord(fact) && Object.prototype.hasOwnProperty.call(fact, "value")) return { ...fact, value };
  return makeFact(value);
}

function fallbackFact(field, value = null) {
  return { source: "manual", confidence: 0, value, fallback: fallbackFor(field) };
}

function factValue(fact) {
  return isRecord(fact) && Object.prototype.hasOwnProperty.call(fact, "value") ? fact.value : fact;
}

function hasValue(value) {
  const raw = factValue(value);
  if (raw == null) return false;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (Array.isArray(raw)) return raw.length > 0;
  if (isRecord(raw)) return Object.values(raw).some((item) => hasValue(item));
  return true;
}

function normalizeNap(value) {
  if (typeof value === "string") return { address: cleanText(value) };
  if (!isRecord(value)) return {};
  return mergeRecords({
    name: cleanText(value.name),
    address: cleanText(value.address),
    phone: cleanText(value.phone),
  }, value);
}

function normalizeStrings(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => cleanText(item)).filter(Boolean);
}

function dedupeStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = cleanText(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalDay(value) {
  const raw = cleanText(value).toLowerCase();
  return DAYS.find((day) => day.toLowerCase() === raw || day.slice(0, 3).toLowerCase() === raw) || null;
}

function normalizeHoursText(value) {
  return cleanText(value).replace(/\s*[\u2013\u2014-]\s*/, "-").replace(/\s+/g, " ");
}

function deriveHoursSpec(hours) {
  const spec = [];
  for (const item of hours || []) {
    if (/closed/i.test(item.hours)) continue;
    if (/24 hours/i.test(item.hours)) {
      spec.push({ "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${item.day}`, opens: "00:00", closes: "23:59" });
      continue;
    }
    const match = cleanText(item.hours).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-\u2013\u2014]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) continue;
    spec.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${item.day}`,
      opens: to24(match[1], match[2], match[3] || match[6]),
      closes: to24(match[4], match[5], match[6]),
    });
  }
  return spec.length ? spec : null;
}

function to24(hour, minute, period) {
  let value = Number(hour);
  if (/pm/i.test(period || "") && value < 12) value += 12;
  if (/am/i.test(period || "") && value === 12) value = 0;
  return `${String(value).padStart(2, "0")}:${minute || "00"}`;
}

function parsePhone(markdown) {
  const match = String(markdown || "").match(/(?:\+?1[-. ]?)?(\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4})/);
  return match ? cleanText(match[1]) : null;
}

function parseServiceAreas(markdown) {
  const match = String(markdown || "").match(/(?:service areas?|areas served|serving)\s*[:-]\s*([^\n]+)/i);
  return match ? match[1].split(/[,;|·]/).map((item) => cleanText(item)).filter(Boolean).slice(0, 12) : [];
}

function asRecord(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function canonicalUrl(value) {
  const raw = cleanText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://siteforge.invalid/");
    url.hash = "";
    for (const key of ["auto", "fit", "fm", "format", "h", "height", "q", "quality", "w", "width"]) url.searchParams.delete(key);
    return `${url.hostname.toLowerCase()}${url.pathname.toLowerCase()}?${[...url.searchParams].sort().map(([key, item]) => `${key}=${item}`).join("&")}`;
  } catch {
    return raw.replace(/[?#].*$/, "").toLowerCase();
  }
}

function fallbackFor(field) {
  const map = {
    logo: "proposed-mark generation required; operator must confirm before deploy",
    hours: "omit hours strip; do not invent",
    reviews: "swap reviews section for services-process section",
    photos: "use Gemini branded still, never stock Unsplash",
    service_areas: "single-city footer, no county coverage claim",
  };
  return map[field] ?? "omit section";
}
