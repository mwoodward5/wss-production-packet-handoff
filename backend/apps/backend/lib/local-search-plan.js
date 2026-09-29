"use strict";

const LIMITS = Object.freeze({
  maxTargetTerms: 6,
  maxServicePages: 4,
  maxServiceAreaPages: 12,
  maxFaqQuestions: 6,
  maxTrustSignals: 8,
  maxCitations: 12,
});

const SEARCH_OPTIMIZATION_FOCUS = Object.freeze({
  source: "premier-108-search-focus.v1",
  seoAndCrawl: Object.freeze([1,2,3,4,5,6,7,8,9,10,11,12,13,14,19,20,32,36,37,39,41,42,45,46,47,48,49,50,51,54,55,56,57,59,60]),
  mobileAndVitals: Object.freeze([52,53,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85]),
  localGeoNearMe: Object.freeze([46,48,86,87,88,89,90,91,92,93,94,95]),
  voiceAndGenerative: Object.freeze([7,40,42,96,97,98,99,100,101,102,103,104]),
  conversionEssentials: Object.freeze([105,106,108]),
  intakeInputs: Object.freeze([
    "verified business name/category/NAP",
    "Place ID plus verified latitude/longitude",
    "verified service list and service areas",
    "measured nearby towns/landmarks and local questions",
    "verified hours, reviews, photos and public profiles",
    "first-party source URLs/provenance for every publishable claim",
  ]),
});

function clean(value, fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function valueOf(field) {
  if (!field) return "";
  if (typeof field === "string") return clean(field);
  return clean(field.value);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configuredLimit(name, fallback, hardMax) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(hardMax, Math.round(value)));
}

function normalizedTerm(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(point of interest|establishment)\b/g, "")
    .replace(/[^a-z0-9&+ -]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordRows(evidence = {}) {
  const rows = [
    ...asArray(evidence.keywords),
    ...asArray(evidence.rankings),
    ...asArray(evidence.targetTerms),
    ...asArray(evidence.target_terms),
  ];
  return rows.map((row) => {
    if (typeof row === "string") return { term: row };
    return {
      term: row.term || row.keyword || row.query || row.search_term,
      currentRank: numberOrNull(row.currentRank ?? row.current_rank ?? row.rank ?? row.client_rank),
      mapsRank: numberOrNull(row.mapsRank ?? row.maps_rank ?? row.local_rank),
      searchVolume: numberOrNull(row.searchVolume ?? row.search_volume ?? row.volume),
      source: clean(row.source || evidence.source || "local_market_data"),
    };
  }).filter((row) => clean(row.term));
}

function citationRows(evidence = {}) {
  const rows = [
    ...asArray(evidence.citations),
    ...asArray(evidence.directories),
    ...asArray(evidence.listings),
  ];
  const seen = new Set();
  return rows.map((row) => {
    if (typeof row === "string") return { name: clean(row), consistent: null };
    return {
      name: clean(row.name || row.directory || row.site || row.domain),
      consistent: typeof row.consistent === "boolean" ? row.consistent : null,
      url: /^https?:\/\//i.test(clean(row.url)) ? clean(row.url) : null,
    };
  }).filter((row) => {
    const key = row.name.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, LIMITS.maxCitations);
}

function targetTerms({ services = [], profile = {}, evidence = {}, maxTerms = LIMITS.maxTargetTerms } = {}) {
  const city = clean(profile.city);
  const state = clean(profile.state);
  const category = clean(profile.industry || profile.category, "local service");
  const providerRows = keywordRows(evidence);
  const candidates = [
    ...providerRows,
    ...services.map((service) => ({ term: `${service} ${city}` })),
    { term: `${category} ${city}` },
    { term: `${category} near ${city} ${state}` },
  ];
  const seen = new Set();
  const output = [];
  for (const candidate of candidates) {
    const term = normalizedTerm(candidate.term);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    const measured = candidate.currentRank !== null && candidate.currentRank !== undefined
      || candidate.mapsRank !== null && candidate.mapsRank !== undefined
      || candidate.searchVolume !== null && candidate.searchVolume !== undefined;
    output.push({
      term,
      intent: /near\b|\b(city|county)\b/.test(term) ? "nearby-service" : "service-and-location",
      evidence: measured ? "measured" : "candidate",
      ...(candidate.currentRank !== null && candidate.currentRank !== undefined ? { currentRank: candidate.currentRank } : {}),
      ...(candidate.mapsRank !== null && candidate.mapsRank !== undefined ? { mapsRank: candidate.mapsRank } : {}),
      ...(candidate.searchVolume !== null && candidate.searchVolume !== undefined ? { searchVolume: candidate.searchVolume } : {}),
    });
    if (output.length >= maxTerms) break;
  }
  return output;
}

function buildTrustSignals({ found = {}, gbp = {}, nap = {}, evidence = {}, citations = [] } = {}) {
  const signals = [];
  const add = (key, label, status, detail, action) => {
    if (signals.length >= LIMITS.maxTrustSignals || signals.some((item) => item.key === key)) return;
    signals.push({ key, label, status, detail: clean(detail), action: clean(action) });
  };

  const reviewCount = numberOrNull(gbp.review_count ?? gbp.reviewCount ?? evidence.review_count);
  const rating = numberOrNull(gbp.rating ?? evidence.rating);
  const coordinates = gbp.latlng || gbp.coordinates || evidence.latlng || evidence.coordinates;
  const socialCount = asArray(found.socials).length;
  const gaps = new Set(asArray(found.seo_gaps));

  add(
    "business_profile",
    "Verified business profile",
    gbp.name || gbp.address || reviewCount !== null ? "found" : "not_verified",
    gbp.name || gbp.address || reviewCount !== null ? "A public business profile was matched to this company." : "A matching business profile still needs confirmation.",
    "Connect the verified identity, hours, location, and customer actions to the website.",
  );
  add(
    "contact_consistency",
    "Name, address, and phone consistency",
    nap.consistent === false ? "needs_attention" : (asArray(nap.checks).length ? "consistent" : "not_verified"),
    nap.consistent === false ? `${asArray(nap.mismatches).length} contact detail mismatch${asArray(nap.mismatches).length === 1 ? "" : "es"} found.` : "Available contact details are kept together as one business identity.",
    "Use one verified identity in visible contact details, maps, and structured business data.",
  );
  add(
    "reviews",
    "Review and reputation proof",
    reviewCount !== null ? "found" : "not_verified",
    reviewCount !== null ? `${reviewCount} public review${reviewCount === 1 ? "" : "s"}${rating !== null ? ` at ${rating.toFixed(1)} stars` : ""} were found.` : "No review count was verified in this intake.",
    "Use only sourced ratings, counts, themes, or quotes at decision points.",
  );
  add(
    "citations",
    "Directory and citation signals",
    citations.length ? "found" : "not_verified",
    citations.length ? `${citations.length} distinct directory or citation signal${citations.length === 1 ? " was" : "s were"} matched.` : "Directory matches are waiting for local-market enrichment.",
    "Carry verified trust references into the launch checklist without copying unsupported claims.",
  );
  add(
    "coordinates",
    "Map and nearby-search context",
    coordinates ? "found" : "not_verified",
    coordinates ? "A verified location or coordinate pair is available." : "Coordinates still need verification.",
    "Add satellite directions, geographic business markup, and bounded verified locality pages only where evidence supports them.",
  );
  add(
    "structured_data",
    "Search and AI understanding",
    gaps.has("no structured data detected") ? "missing_currently" : "not_verified",
    gaps.has("no structured data detected") ? "Structured business data was not detected on the current site." : "Current structured data coverage was not assumed.",
    "Publish matching business, service, FAQ, breadcrumb, website, and geographic markup.",
  );
  add(
    "answer_content",
    "Conversational and voice-search answers",
    gaps.has("no FAQ surface for AI answer engines") ? "missing_currently" : "not_verified",
    gaps.has("no FAQ surface for AI answer engines") ? "Clear customer questions and answers were not detected." : "Current question coverage was not assumed.",
    "Answer a short set of buying questions in visible copy that can also be read by search and voice tools.",
  );
  add(
    "social_profiles",
    "Connected public profiles",
    socialCount ? "found" : "not_verified",
    socialCount ? `${socialCount} sourced public profile${socialCount === 1 ? " was" : "s were"} found.` : "No public social profile was verified in this intake.",
    "Connect only sourced profiles to reinforce the same business identity.",
  );
  return signals;
}

function localityRows({ profile = {}, gbp = {}, evidence = {}, intakeGenie = null } = {}) {
  const rows = [
    ...asArray(evidence.localities), ...asArray(evidence.serviceAreas), ...asArray(evidence.service_areas),
    ...asArray(evidence.nearbyCities), ...asArray(evidence.nearby_cities), ...asArray(gbp.serviceAreas),
    ...asArray(gbp.service_areas), ...asArray(intakeGenie && intakeGenie.facts && intakeGenie.facts.service_areas),
  ];
  const home = clean(profile.city);
  if (home) rows.unshift({ name: home, source: "verified_primary_city", verified: true });
  const seen = new Set();
  return rows.map((row) => {
    const item = typeof row === "string" ? { name: row } : (row || {});
    const name = clean(item.name || item.city || item.locality || item.community || item.area);
    const source = clean(item.source || item.provenance || evidence.source || "locality_evidence");
    const verified = item.verified === true || item.firstParty === true || item.first_party === true
      || /verified|google|places|intake|first.party|existing.site/i.test(source);
    const lat = numberOrNull(item.lat ?? item.latitude); const lng = numberOrNull(item.lng ?? item.longitude);
    return { name, source, verified, ...(lat !== null && lng !== null ? { lat, lng } : {}) };
  }).filter((item) => {
    const key = normalizedTerm(item.name);
    if (!key || seen.has(key)) return false;
    seen.add(key); return item.verified;
  });
}

function buildLocalSearchPlan({ profile = {}, found = {}, gbp = {}, nap = {}, services = [], evidence = {}, intakeGenie = null } = {}) {
  const maxTargetTerms = configuredLimit("GHOST_AGENCY_LOCAL_PLAN_MAX_TERMS", LIMITS.maxTargetTerms, LIMITS.maxTargetTerms);
  const maxServicePages = configuredLimit("GHOST_AGENCY_LOCAL_PLAN_MAX_SERVICE_PAGES", LIMITS.maxServicePages, LIMITS.maxServicePages);
  const maxServiceAreaPages = configuredLimit("GHOST_AGENCY_LOCAL_PLAN_MAX_SERVICE_AREA_PAGES", 8, LIMITS.maxServiceAreaPages);
  const citations = citationRows(evidence);
  const terms = targetTerms({ services, profile, evidence, maxTerms: maxTargetTerms });
  const measuredTerms = terms.filter((term) => term.evidence === "measured");
  const providerVerified = measuredTerms.length > 0 || citations.length > 0 || evidence.verified === true;
  const trustSignals = buildTrustSignals({ found, gbp, nap, evidence, citations });
  const servicePages = Math.max(1, Math.min(maxServicePages, services.length || 1, terms.length || 1));
  const localities = localityRows({ profile, gbp, evidence, intakeGenie }).slice(0, maxServiceAreaPages);
  const serviceAreaPages = localities.length;

  return {
    version: "local-search-plan.v1",
    status: providerVerified ? "evidence_backed" : "candidate_only",
    claimLevel: providerVerified ? "measured" : "planned",
    location: {
      city: clean(profile.city),
      state: clean(profile.state),
      coordinatesVerified: Boolean(gbp.latlng || gbp.coordinates || evidence.latlng || evidence.coordinates),
    },
    targetTerms: terms,
    trustSignals,
    citations,
    currentVisibility: {
      measured: providerVerified,
      termsMeasured: measuredTerms.length,
      top10Terms: measuredTerms.filter((term) => Number(term.currentRank ?? term.mapsRank) <= 10).length,
    },
    contentPlan: {
      servicePages,
      serviceAreaPages,
      verifiedLocalities: localities,
      faqQuestions: LIMITS.maxFaqQuestions,
      principle: "bounded_verified_locality_chapters",
    },
    limits: {
      targetTerms: maxTargetTerms,
      servicePages: maxServicePages,
      serviceAreaPages: maxServiceAreaPages,
      faqQuestions: LIMITS.maxFaqQuestions,
    },
    optimizationFocus: SEARCH_OPTIMIZATION_FOCUS,
    launchWork: [
      "verified business identity and NAP consistency across visible copy and schema",
      "keyword + geo titles, descriptions, canonicals, crawl files, internal links, and descriptive image text",
      "LocalBusiness/Organization/Service/FAQ/Breadcrumb/WebSite/GeoCoordinates/ContactPoint/PostalAddress schema from verified facts only",
      "verified Place ID plus latitude/longitude, satellite map link, primary directions, and directions from measured nearby towns",
      "service-area/near-me copy using real cities, neighborhoods and landmarks rather than invented coverage claims",
      "Q-format headings, concise first-paragraph answers, speakable FAQ markup, parseable citations, structured comparison tables, and llms.txt",
      "mobile-first touch targets plus LCP/INP/CLS/TTFB, image/font/video and reduced-motion performance budgets",
      "tappable phone/contact actions, sticky mobile conversion surface, UTM-preserving lead capture and source attribution",
      "sourced reviews, directories, photos, hours and public profiles only — absent evidence stays absent",
    ],
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  LIMITS,
  SEARCH_OPTIMIZATION_FOCUS,
  buildLocalSearchPlan,
  citationRows,
  keywordRows,
  localityRows,
};
