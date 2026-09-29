"use strict";

const { publicServiceNames } = require("./public-data");
const { buildLocalSearchPlan } = require("./local-search-plan");

const GOLDILOCKS = {
  maxPhotos: 8,
  maxServices: 8,
  maxReviewThemes: 5,
  maxReviewQuotes: 3,
  maxSocials: 6,
  maxColors: 5,
  maxOpportunities: 6,
  maxNearMePages: 4,
};

const JUNK_PATTERNS = [
  /logo/i,
  /favicon/i,
  /sprite/i,
  /icon(s)?[-_./]/i,
  /placeholder/i,
  /avatar/i,
  /badge/i,
  /pixel/i,
  /1x1/i,
  /spacer/i,
  /blank\./i,
  /loading/i,
  /thumb(nail)?/i,
  /\.svg(\?|$)/i,
  /^data:/i,
  /gravatar/i,
  /googletagmanager|doubleclick|facebook\.com\/tr/i,
];

const CONTENT_HINTS =
  /gallery|project|portfolio|work|photo|image|upload|masonry|landscape|patio|build|before|after|hero|jobsite|install|roof|hvac|plumb|tree|service/i;

function cleanString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function firstValue(input, keys, fallback = "") {
  for (const key of keys) {
    const value = input && input[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function last10(value) {
  const d = digits(value);
  return d.length >= 10 ? d.slice(-10) : d;
}

function normalizedUrl(value) {
  return String(value || "").split("?")[0].replace(/\/$/, "").toLowerCase();
}

function confidence(value, score) {
  return value ? { value, confidence: score } : null;
}

function curatePhotos(urls = [], max = GOLDILOCKS.maxPhotos) {
  const seen = new Set();
  const scored = [];
  for (const raw of asArray(urls)) {
    if (!raw || typeof raw !== "string") continue;
    if (JUNK_PATTERNS.some((pattern) => pattern.test(raw))) continue;
    const key = normalizedUrl(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let score = 0;
    if (CONTENT_HINTS.test(raw)) score += 3;
    if (/\.(jpe?g|webp|png)(\?|$)/i.test(raw)) score += 1;
    if (/\d{3,4}x\d{3,4}/.test(raw)) score += 1;
    if (/-\d{2,4}x\d{2,4}\./.test(raw)) score -= 1;
    scored.push({ url: raw, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((item) => item.url);
}

function napConsistency({ site = {}, gbp = {}, profile = {} } = {}) {
  const out = { checks: [], mismatches: [], consistent: true };
  const compare = (field, siteValue, otherValue, normalize) => {
    if (!siteValue || !otherValue) return;
    const siteNormalized = normalize(siteValue);
    const otherNormalized = normalize(otherValue);
    const match = siteNormalized === otherNormalized;
    out.checks.push({ field, match, site: siteValue, other: otherValue });
    if (!match) {
      out.consistent = false;
      out.mismatches.push({ field, site: siteValue, other: otherValue });
    }
  };

  compare("phone", site.phone, gbp.phone || profile.phone, last10);
  compare("address", site.address, gbp.address || profile.address, (value) => digits(value).slice(0, 6));
  compare("name", site.name, gbp.name || profile.business_name, (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
  );
  return out;
}

function reviewThemes(reviews = []) {
  const texts = asArray(reviews)
    .map((review) => (typeof review === "string" ? review : review && review.text) || "")
    .filter(Boolean);
  const stop = new Set(
    "the a an and or but for with was were is are our your you they we he she it to of in on at from this that very had have has their them then just so as be been great good".split(
      " ",
    ),
  );
  const freq = {};
  for (const text of texts) {
    for (const word of text.toLowerCase().match(/[a-z]{4,}/g) || []) {
      if (stop.has(word)) continue;
      freq[word] = (freq[word] || 0) + 1;
    }
  }
  const themes = Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, GOLDILOCKS.maxReviewThemes)
    .map(([theme, mentions]) => ({ theme, mentions }));
  const quotes = texts
    .filter((text) => text.length > 30 && text.length < 180)
    .slice(0, GOLDILOCKS.maxReviewQuotes);
  return { count: texts.length, themes, quotes };
}

function opportunityRank(item) {
  return { high: 0, med: 1, low: 2 }[item.severity] ?? 3;
}

function buildOpportunities({ nap = {}, found = {}, copyLen = 0 } = {}) {
  const opportunities = [];
  if (found.missingWebsite) {
    opportunities.push({
      type: "missing_website",
      severity: "high",
      headline: "No website is attached to the local profile",
      detail: "Buyers can find the business listing, but there is no owned site to turn search attention into calls.",
    });
  }
  for (const mismatch of nap.mismatches || []) {
    opportunities.push({
      type: "nap_mismatch",
      severity: "high",
      headline: `Your ${mismatch.field} does not match between your website and Google`,
      detail: `Site shows "${mismatch.site}", Google/profile shows "${mismatch.other}". Inconsistent ${mismatch.field} splits local-search trust and costs calls.`,
    });
  }
  const gaps = asArray(found.seo_gaps);
  if (gaps.includes("no structured data detected")) {
    opportunities.push({
      type: "no_schema",
      severity: "med",
      headline: "Search engines cannot read the business as structured data",
      detail: "No schema or JSON-LD signal is present for rich results and AI answer engines.",
    });
  }
  if (gaps.includes("no FAQ surface for AI answer engines")) {
    opportunities.push({
      type: "no_faq",
      severity: "med",
      headline: "AI search has no clear questions and answers to quote",
      detail: "No FAQ content means ChatGPT-style search has less specific material to cite.",
    });
  }
  if (gaps.includes("no visible review proof")) {
    opportunities.push({
      type: "no_reviews",
      severity: "med",
      headline: "Review proof is not doing enough selling",
      detail: "Prospects do not see social proof at the decision moment.",
    });
  }
  if (copyLen && copyLen < 1500) {
    opportunities.push({
      type: "thin_copy",
      severity: "low",
      headline: "Thin page content",
      detail: "There is not enough focused service copy to compete for local service terms.",
    });
  }
  if (asArray(found.photos).length < 3) {
    opportunities.push({
      type: "few_photos",
      severity: "low",
      headline: "Not enough proof of the work",
      detail: "A stronger preview should show real finished work before asking for the call.",
    });
  }
  return opportunities
    .sort((a, b) => opportunityRank(a) - opportunityRank(b))
    .slice(0, GOLDILOCKS.maxOpportunities);
}

function buildBusinessTruthPacket({ profile = {}, found = {}, gbp = {}, localMarketData = {}, source = "unknown" } = {}) {
  const site = {
    name: profile.business_name,
    phone: found.contact && found.contact.phone,
    address: found.contact && found.contact.address,
  };
  const nap = napConsistency({ site, gbp, profile });
  const photos = curatePhotos(found.photos || []);
  const themes = reviewThemes(gbp.reviews || found.reviews || []);
  const services = publicServiceNames(asArray(found.services), profile.industry).slice(0, GOLDILOCKS.maxServices);
  const copyLen = cleanString(found.copy).length;
  const localSearchPlan = buildLocalSearchPlan({
    profile,
    found,
    gbp,
    nap,
    services,
    evidence: localMarketData,
  });
  return {
    meta: {
      version: "goldilocks.v1",
      source,
      generated_at: new Date().toISOString(),
      bounded: true,
    },
    identity: {
      name: confidence(cleanString(profile.business_name), 0.95),
      phone: confidence(site.phone || gbp.phone || profile.phone, site.phone ? 0.9 : 0.6),
      address: confidence(site.address || gbp.address || profile.address, 0.7),
      city: confidence(cleanString(profile.city), 0.95),
      state: confidence(cleanString(profile.state), 0.95),
      category: confidence(cleanString(profile.industry), 0.9),
    },
    latlng: gbp.latlng || localMarketData.latlng || localMarketData.coordinates || null,
    napConsistency: nap,
    logo: found.logo || null,
    colors: asArray(found.colors).slice(0, GOLDILOCKS.maxColors),
    photos,
    services,
    reviewThemes: themes,
    socials: asArray(found.socials).slice(0, GOLDILOCKS.maxSocials),
    opportunities: buildOpportunities({ nap, found, copyLen }),
    localSearchPlan,
    counts: {
      photos: photos.length,
      services: asArray(found.services).length,
      reviews: themes.count,
    },
  };
}

function profileFromProspect(prospect = {}) {
  return {
    business_name: firstValue(prospect, ["business_name", "businessName", "company", "name"]),
    industry: firstValue(prospect, ["industry", "category", "primary_type"]),
    city: firstValue(prospect, ["city", "market"]),
    state: firstValue(prospect, ["state", "region"]),
    phone: firstValue(prospect, ["phone", "phoneNumber", "nationalPhoneNumber"]),
    address: firstValue(prospect, ["address", "formattedAddress"]),
  };
}

function foundFromProspect(prospect = {}) {
  const services = publicServiceNames([
    ...asArray(prospect.services),
    ...asArray(prospect.primary_services),
    ...asArray(prospect.types),
    firstValue(prospect, ["primary_type", "industry", "category"]),
  ], firstValue(prospect, ["industry", "category", "primary_type"]));
  const seoGaps = asArray(prospect.seo_gaps);
  if (!firstValue(prospect, ["current_website", "currentWebsite", "website", "url"])) {
    seoGaps.push("no structured data detected", "no FAQ surface for AI answer engines");
  }
  if (!asArray(prospect.reviews).length && !asArray(prospect.review_quotes).length) {
    seoGaps.push("no visible review proof");
  }
  return {
    logo: prospect.logo || prospect.logo_url || null,
    colors: prospect.colors || prospect.brand_colors || [],
    photos: prospect.photos || prospect.photo_urls || [],
    reviews: prospect.reviews || prospect.review_quotes || [],
    socials: prospect.socials || prospect.social_urls || [],
    services,
    copy: prospect.copy || prospect.site_copy || "",
    contact: {
      phone: firstValue(prospect, ["site_phone", "phone", "phoneNumber", "nationalPhoneNumber"]),
      address: firstValue(prospect, ["site_address", "address", "formattedAddress"]),
    },
    seo_gaps: [...new Set(seoGaps)],
    missingWebsite: !firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]),
  };
}

function gbpFromProspect(prospect = {}) {
  const lat = Number(prospect.latlng?.lat ?? prospect.location?.latitude ?? prospect.latitude);
  const lng = Number(prospect.latlng?.lng ?? prospect.location?.longitude ?? prospect.longitude);
  return {
    name: firstValue(prospect, ["gbp_name", "business_name", "businessName", "company", "name"]),
    phone: firstValue(prospect, ["gbp_phone", "phone", "phoneNumber", "nationalPhoneNumber"]),
    address: firstValue(prospect, ["gbp_address", "address", "formattedAddress"]),
    rating: prospect.rating || null,
    review_count: prospect.review_count || prospect.userRatingCount || null,
    reviews: prospect.gbp_reviews || prospect.reviews || [],
    latlng: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
  };
}

function businessTruthFromProspect(prospect = {}, options = {}) {
  if (prospect.truth_packet && typeof prospect.truth_packet === "object") return prospect.truth_packet;
  return buildBusinessTruthPacket({
    profile: profileFromProspect(prospect),
    found: foundFromProspect(prospect),
    gbp: gbpFromProspect(prospect),
    localMarketData:
      prospect.local_market_data ||
      prospect.localMarketData ||
      prospect.search_plan_evidence ||
      {},
    source: options.source || prospect.truth_packet_source || prospect.source || "ghost_agency_prospect",
  });
}

module.exports = {
  GOLDILOCKS,
  buildBusinessTruthPacket,
  buildOpportunities,
  businessTruthFromProspect,
  curatePhotos,
  foundFromProspect,
  gbpFromProspect,
  napConsistency,
  profileFromProspect,
  reviewThemes,
};
