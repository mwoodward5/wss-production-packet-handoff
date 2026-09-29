"use strict";

// CallPrep/Signal SCAN PARITY.
//
// The `save-business-report` edge function only PERSISTS an already-assembled
// row — it does not scan. The 30-second scan that populates the nine category
// scores runs CLIENT-SIDE inside the CallPrep app, which calls a small set of
// `api-gateway` actions and then folds the responses into category scores.
//
// This module performs that same scan server-side. Every score below is a
// verbatim re-implementation of the app's own builder (bundled chunk
// `index-*.js`, functions Rj/Oj/Ij/Mj/Dj/$j/Uj/Yt + weighted composite `mc`),
// so a ghost-created report grades identically to one the customer would get by
// typing their own URL into callprep.wss-ai.com. Truth-law: every number is a
// transform of a measured signal. An action that fails or is unconfigured
// yields `null` for that category and `not_provided` in data_availability —
// never a fabricated 0.
//
// All actions used here authenticate with the PUBLIC ANON KEY exactly as the
// app's own unauthenticated report client does. Admin-only actions (`config`,
// `test_key`) are deliberately not used.

const GATEWAY_ACTIONS = Object.freeze({
  lookup: "lookup",
  pagespeed: "pagespeed",
  ssl: "ssl",
  securityHeaders: "security_headers",
  whatcms: "whatcms",
  company: "company",
  domainAge: "domain_age",
  competitors: "competitors",
});

function gradeForScore(score) {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 67) return "D+";
  if (score >= 63) return "D";
  if (score >= 60) return "D-";
  return "F";
}

function clamp100(value) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function gatewayBase(env = process.env) {
  const raw = String(env.CALLPREP_SUPABASE_URL || "").trim();
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_supabase_url");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/functions/v1/api-gateway`;
}

// A gateway response that is missing/garbled is TRANSIENT and worth one retry
// (the app's own `callEdge` retries twice for the same reason). A well-formed
// `{error}` envelope — e.g. `no_whatcms_key` — is a settled answer: the upstream
// key is not configured, so retrying only burns time.
function isRetryable(outcome) {
  return outcome === "transport" || outcome === "bad_response";
}

async function gatewayOnce(endpoint, key, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json) return { outcome: "bad_response", status: response.status, json: null };
    if (json.error) return { outcome: "declined", status: response.status, json: null, error: String(json.error) };
    return { outcome: "ok", status: response.status, json };
  } catch (error) {
    return { outcome: "transport", status: 0, json: null, error: error.name };
  } finally {
    clearTimeout(timer);
  }
}

// One api-gateway action. Returns null (never a guess) when the signal cannot
// be obtained, so the caller marks the category not_provided instead of
// scoring it from nothing.
async function callGateway(params, { env = process.env, fetchImpl = global.fetch, timeoutMs = 70000, attempts = 2, log = () => {} } = {}) {
  const key = String(env.CALLPREP_SUPABASE_ANON_KEY || "").trim();
  if (!key) return null;
  let endpoint;
  try {
    endpoint = `${gatewayBase(env)}?${new URLSearchParams(params)}`;
  } catch {
    return null;
  }
  const started = Date.now();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await gatewayOnce(endpoint, key, timeoutMs, fetchImpl);
    const label = `[callprep-scan] ${params.action} ${result.status} ${Date.now() - started}ms attempt ${attempt}/${attempts}`;
    if (result.outcome === "ok") {
      log(`${label} ok`);
      return result.json;
    }
    log(`${label} ${result.outcome}${result.error ? `(${result.error})` : ""}`);
    if (!isRetryable(result.outcome) || attempt === attempts) return null;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ""; }
}

function domainOf(url) {
  return hostOf(url).replace(/^www\./i, "");
}

// --- category builders: verbatim ports of the app's own formulas ------------

// app: Rj (buildWebsitePerformanceFromPSI)
function websitePerformanceFromPsi(psi) {
  if (!psi) return null;
  const mobileScore = num(psi.performanceScore);
  const loadTime = num(psi.loadTime);
  const https = psi.isHttps === true;
  const score = clamp100(
    mobileScore * 0.5 +
    (https ? 15 : 0) +
    (loadTime < 3 ? 20 : loadTime < 5 ? 15 : loadTime < 7 ? 10 : 5) +
    (psi.hasViewport ? 10 : 0) +
    (num(psi.cls) < 0.1 ? 5 : 0),
  );
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      loadTime,
      mobileScore,
      hasSSL: https,
      fcp: num(psi.fcp),
      lcp: num(psi.lcp),
      tbt: num(psi.tbt),
      cls: num(psi.cls),
    },
  };
}

// app: Oj (buildSeoFromPSI)
function seoFromPsi(psi, secHeaders) {
  if (!psi) return null;
  const schema = (secHeaders && secHeaders.schema) || {};
  const hasSchema = schema.jsonLd === true;
  const hasOpenGraph = schema.openGraph === true;
  const score = clamp100(num(psi.seoScore) * 0.7 + (hasSchema ? 15 : 0) + (hasOpenGraph ? 10 : 0) + (psi.hasViewport ? 5 : 0));
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      hasH1: secHeaders ? secHeaders.hasH1 === true : null,
      hasMetaDesc: secHeaders ? secHeaders.hasMetaDesc === true : null,
      hasSchema,
      hasOpenGraph,
      hasTwitterCards: schema.twitterCards === true,
      seoScore: num(psi.seoScore),
      accessibilityScore: num(psi.accessibilityScore),
    },
  };
}

// app: Ij (buildSecurityFromChecks)
function securityFromChecks(ssl, secHeaders) {
  if (!ssl && !secHeaders) return null;
  const grade = (ssl && ssl.grade) || null;
  const status = (ssl && ssl.status) || "UNKNOWN";
  const headerCount = num(secHeaders && secHeaders.headerCount);
  const totalHeaders = num(secHeaders && secHeaders.totalHeaders) || 6;
  let score = 0;
  if (grade === "A+" || grade === "A") score += 50;
  else if (grade === "B") score += 35;
  else if (grade === "C") score += 20;
  else if (grade === "D" || grade === "F") score += 5;
  else if (status === "UNKNOWN" || status === "DNS" || status === "IN_PROGRESS") score += 30;
  else score += 25;
  score = clamp100(score + Math.round((headerCount / totalHeaders) * 50));
  const headers = (secHeaders && secHeaders.headers) || {};
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      sslGrade: grade || "N/A",
      sslStatus: status,
      securityHeaders: headerCount,
      totalHeaders,
      hasHSTS: headers.hsts === true,
      hasCSP: headers.csp === true,
      hasXFrameOptions: headers.xFrameOptions === true,
      hasXContentTypeOptions: headers.xContentTypeOptions === true,
    },
  };
}

// app: Lj (review velocity/trend from the review sample's unix `time`s)
function reviewVelocity(reviews) {
  if (!Array.isArray(reviews) || reviews.length < 2) return { perMonth: 0, trend: "flat" };
  const sorted = [...reviews].filter((r) => Number.isFinite(Number(r && r.time))).sort((a, b) => b.time - a.time);
  if (sorted.length < 2) return { perMonth: 0, trend: "flat" };
  const span = Math.max(1, (sorted[0].time - sorted[sorted.length - 1].time) / (30 * 24 * 60 * 60));
  const perMonth = Number((reviews.length / span).toFixed(1));
  const half = Math.floor(sorted.length / 2);
  const recent = sorted.slice(0, half);
  const older = sorted.slice(half);
  if (!recent.length || !older.length) return { perMonth, trend: "flat" };
  const recentRate = recent.length / Math.max(1, recent.length > 1 ? recent[0].time - recent[recent.length - 1].time : 1);
  const olderRate = older.length / Math.max(1, older.length > 1 ? older[0].time - older[older.length - 1].time : 1);
  return { perMonth, trend: recentRate > olderRate * 1.2 ? "up" : recentRate < olderRate * 0.8 ? "down" : "flat" };
}

function negativeCount(reviews) {
  return Array.isArray(reviews) ? reviews.filter((r) => Number(r && r.rating) <= 2).length : 0;
}

// app: Mj (buildGBPFromPlace)
function gbpFromPlace(place) {
  if (!place) return null;
  const rating = num(place.rating);
  const reviewCount = num(place.reviewCount);
  const photoCount = num(place.photoCount);
  const hasHours = place.hasHours === true;
  const completeness = num(place.gbpCompleteness);
  let score =
    Math.min(25, rating * 5) +
    Math.min(20, reviewCount * 0.4) +
    (photoCount > 10 ? 15 : photoCount > 0 ? 10 : 0) +
    (hasHours ? 10 : 0) +
    (place.businessStatus === "OPERATIONAL" ? 10 : 0) +
    (place.phone ? 5 : 0) +
    (place.description ? 5 : 0) +
    Math.round(completeness * 0.1);
  score = clamp100(score);
  if (!place.website) score = Math.min(score, 65);
  const velocity = reviewVelocity(place.reviews);
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      verified: true,
      starRating: rating,
      reviewCount,
      photoCount,
      hoursListed: hasHours,
      phone: place.phone || "",
      internationalPhone: place.internationalPhone || "",
      hoursText: JSON.stringify(place.hoursText || []),
      isOpenNow: place.isOpenNow === true,
      gbpCompleteness: completeness,
      gbpDescription: place.description || "",
      reviewVelocity: velocity.perMonth,
      reviewTrend: velocity.trend,
      negativeNoResponse: negativeCount(place.reviews),
      mapsUrl: place.mapsUrl || "",
      lat: num(place.lat),
      lng: num(place.lng),
      address: place.address || "",
    },
  };
}

// app: db (scoreReputationFromGoogleSignals) + Dj (buildReputationFromPlace)
function scoreReputationFromGoogleSignals(reviews, rating, negatives = 0) {
  const ratingScore = rating > 0 ? (rating / 5) * 55 : 0;
  const volumeScore = reviews > 0 ? Math.min(35, Math.round(Math.log10(reviews + 1) * 18)) : 0;
  let score = ratingScore + volumeScore - Math.min(10, negatives * 2);
  if (rating >= 4.8 && reviews > 0) score = Math.max(score, 65);
  if (reviews === 0) score = Math.min(score, 20);
  return clamp100(score);
}

function reputationFromPlace(place) {
  if (!place) return null;
  const rating = num(place.rating);
  const reviewCount = num(place.reviewCount);
  const negatives = negativeCount(place.reviews);
  const score = scoreReputationFromGoogleSignals(reviewCount, rating, negatives);
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      totalReviews: reviewCount,
      avgRating: rating,
      // Google's public listing API does not expose owner-response data.
      responseRate: null,
      responseRateStatus: "not_available",
      negativeReviewsAtRisk: negatives,
      negativeNoResponse: negatives,
    },
  };
}

// app: $j (buildSocialFromCheck). The app treats ANY href as presence; we keep
// its scoring identical but ALSO record which links are unverified template
// placeholders (e.g. facebook.com/CompanyName) so a human reading the report is
// not told a stock link is a real profile.
const PLACEHOLDER_SOCIAL = /\/(companyname|yourcompany|yourbusiness|username|profile\.php\?id=0*)\/?$/i;

function socialFromLinks(links) {
  if (!links) return null;
  const flag = (value) => Boolean(value);
  const has = {
    hasFacebook: flag(links.facebook),
    hasInstagram: flag(links.instagram),
    hasLinkedin: flag(links.linkedin),
    hasYoutube: flag(links.youtube),
    hasTiktok: flag(links.tiktok),
    hasTwitter: flag(links.twitter),
    hasYelp: flag(links.yelp),
  };
  let score = 20;
  if (has.hasFacebook) score += 20;
  if (has.hasInstagram) score += 20;
  if (has.hasLinkedin) score += 15;
  if (has.hasYoutube) score += 10;
  if (has.hasTiktok) score += 10;
  if (has.hasTwitter) score += 5;
  if (has.hasYelp) score += 5;
  score = clamp100(score);
  const placeholders = Object.entries(links)
    .filter(([, value]) => typeof value === "string" && PLACEHOLDER_SOCIAL.test(value))
    .map(([key]) => key);
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      ...has,
      postingFrequency: "Not measured",
      socialLinksCount: Object.values(has).filter(Boolean).length,
      socialLinksTotal: 7,
      facebookUrl: links.facebook || "",
      instagramUrl: links.instagram || "",
      linkedinUrl: links.linkedin || "",
      youtubeUrl: links.youtube || "",
      tiktokUrl: links.tiktok || "",
      twitterUrl: links.twitter || "",
      yelpUrl: links.yelp || "",
      ...(placeholders.length ? { unverifiedPlaceholderLinks: placeholders } : {}),
    },
  };
}

// app: Fj (buildTechnologyFromWhatCMS). Requires the WhatCMS key; when the
// gateway reports `no_whatcms_key` we get null here and the category stays
// not_provided rather than being scored from an absent lookup.
function technologyFromWhatCms(whatcms) {
  if (!whatcms || !Array.isArray(whatcms.results) || !whatcms.results.length) return null;
  const cms = whatcms.results.find((r) => Array.isArray(r.categories) && r.categories.includes("CMS")) || whatcms.results[0];
  const hosting = whatcms.results.find((r) => Array.isArray(r.categories) && r.categories.includes("Hosting"));
  let score = 50;
  if (cms && cms.version) score += 20;
  if (hosting) score += 15;
  if (whatcms.results.length > 2) score += 15;
  score = clamp100(score);
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      cms: (cms && cms.name) || "Unknown",
      cmsVersion: (cms && cms.version) || "N/A",
      hosting: (hosting && hosting.name) || "Unknown",
      techCount: whatcms.results.length,
    },
  };
}

// app: Uj (buildBusinessIntelligence). The company lookup needs a key we do not
// hold; domain age alone is a real measured signal, and the app's own fallback
// branch scores exactly this way. Weight for this category is 0, so it never
// moves the composite — it only fills the card.
function businessIntelligence(company, domainAge) {
  if (!company && !domainAge) return null;
  if (!company || !company.name) {
    if (!domainAge) return null;
    const years = Number.isFinite(Number(domainAge.domainAgeYears)) ? Number(domainAge.domainAgeYears) : null;
    const score = clamp100(30 + (years && years > 5 ? 10 : 0));
    return {
      score,
      grade: gradeForScore(score),
      isLive: true,
      metrics: {
        availability: "measured",
        companyName: "Not found",
        founded: "Not found",
        industry: "Not found",
        employees: "Not found",
        hasLinkedin: false,
        domainAgeYears: years,
        domainFirstSeen: domainAge.firstSeen || null,
        // Named honestly: the firmographic lookup did not run, domain age did.
        firmographicsAvailability: "not_provided",
      },
    };
  }
  let score = 40;
  if (company.founded) score += 15;
  if (company.employees) score += 15;
  if (company.linkedin) score += 15;
  if (company.industry) score += 15;
  score = clamp100(score);
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      companyName: company.name,
      founded: company.founded || "N/A",
      industry: company.industry || "Unknown",
      employees: company.employees || "N/A",
      hasLinkedin: Boolean(company.linkedin),
      domainAgeYears: domainAge && Number.isFinite(Number(domainAge.domainAgeYears)) ? Number(domainAge.domainAgeYears) : null,
      domainFirstSeen: (domainAge && domainAge.firstSeen) || null,
    },
  };
}

// app: Yt (buildGeoReadiness) — derived from the other categories, so it is
// only produced when its inputs (SEO + website + GBP) were themselves measured.
function geoReadiness(categories) {
  const seo = categories.seo;
  const website = categories.websitePerformance;
  const gbp = categories.googleBusinessProfile;
  if (!seo || !website || !gbp) return null;
  const seoMetrics = seo.metrics || {};
  const unverified = seoMetrics.signalsUnverified === true;
  const seoScore = num(seoMetrics.seoScore);
  const hasSchema = seoMetrics.hasSchema === true;
  const hasMetaDesc = seoMetrics.hasMetaDesc === true;
  let score = 0;
  if (hasSchema) score += 25;
  else if (unverified && seoScore >= 85) score += 20;
  const mobileScore = num((website.metrics || {}).mobileScore);
  score += Math.round(Math.min(20, (mobileScore / 100) * 20));
  if (hasSchema && hasMetaDesc) score += 15;
  else if (unverified && seoScore >= 90) score += 12;
  const reviewCount = num((gbp.metrics || {}).reviewCount);
  score += Math.min(15, Math.round(Math.log2(Math.max(1, reviewCount)) * 2));
  if ((gbp.metrics || {}).phone) score += 5;
  if ((gbp.metrics || {}).hoursListed) score += 5;
  const socialMetrics = (categories.socialMedia && categories.socialMedia.metrics) || {};
  const socialSignals = ["hasFacebook", "hasInstagram", "hasLinkedin", "hasYoutube", "hasTiktok", "hasTwitter", "hasYelp"]
    .filter((key) => socialMetrics[key]).length;
  score += Math.min(10, Math.round(socialSignals * 1.5));
  const domainAgeYears = num((categories.businessIntelligence && categories.businessIntelligence.metrics || {}).domainAgeYears);
  score += Math.min(5, Math.round(domainAgeYears * 0.5));
  score = clamp100(score);
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    metrics: {
      availability: "measured",
      hasSchema: hasSchema || (unverified && seoScore >= 85),
      contentQuality: mobileScore,
      hasFAQ: (hasSchema && hasMetaDesc) || (unverified && seoScore >= 90),
      reviewRecency: reviewCount,
      napConsistency: Boolean((gbp.metrics || {}).phone && (gbp.metrics || {}).hoursListed),
      socialProofSignals: socialSignals,
      domainAge: domainAgeYears,
    },
  };
}

// app: hb (CATEGORY_WEIGHTS) + mc (calculateWeightedScore). Unmeasured
// categories are dropped from BOTH numerator and denominator, so a missing
// category never drags the composite toward F.
const CATEGORY_WEIGHTS = Object.freeze([
  { key: "websitePerformance", weight: 0.2 },
  { key: "seo", weight: 0.08 },
  { key: "security", weight: 0.02 },
  { key: "googleBusinessProfile", weight: 0.3 },
  { key: "onlineReputation", weight: 0.2 },
  { key: "socialMedia", weight: 0.08 },
  { key: "technology", weight: 0.02 },
  { key: "businessIntelligence", weight: 0 },
  { key: "geo", weight: 0.1 },
]);

function weightedScore(categories) {
  let totalWeight = 0;
  let total = 0;
  for (const { key, weight } of CATEGORY_WEIGHTS) {
    const category = categories[key];
    if (!category || typeof category.score !== "number") continue;
    totalWeight += weight;
    total += category.score * weight;
  }
  return totalWeight === 0 ? null : Math.round(total / totalWeight);
}

/**
 * Run the CallPrep scan for one business and return the measured categories.
 *
 * @param {object} args
 * @param {string} args.input   Website URL, or "Business Name City ST".
 *                              A bare phone number is a poor key — the gateway
 *                              only matches an EXACT GBP phone and returns
 *                              ZERO_RESULTS otherwise.
 * @returns {Promise<{place, categories, overallScore, overallGrade, competitors, availability, sources}>}
 */
async function scanBusiness({ input, keyword = "", radius = 16000 } = {}, options = {}) {
  const log = options.log || (() => {});
  const call = (params) => callGateway(params, { ...options, log });

  const place = await call({ action: GATEWAY_ACTIONS.lookup, input: String(input || "") });
  const website = (place && place.website) || (/^https?:\/\//i.test(String(input)) ? String(input) : "");
  const siteUrl = website ? website.replace(/\?utm_campaign=gmb$/i, "") : "";
  const host = hostOf(siteUrl);
  const domain = domainOf(siteUrl);

  // Fan out exactly like the app's realtime scan does.
  const [psi, ssl, secHeaders, whatcms, company, domainAge] = await Promise.all([
    siteUrl ? call({ action: GATEWAY_ACTIONS.pagespeed, url: siteUrl }) : null,
    host ? call({ action: GATEWAY_ACTIONS.ssl, host }) : null,
    siteUrl ? call({ action: GATEWAY_ACTIONS.securityHeaders, url: siteUrl }) : null,
    siteUrl ? call({ action: GATEWAY_ACTIONS.whatcms, url: siteUrl }) : null,
    domain ? call({ action: GATEWAY_ACTIONS.company, domain }) : null,
    domain ? call({ action: GATEWAY_ACTIONS.domainAge, domain }) : null,
  ]);

  let competitorsResponse = null;
  if (place && place.lat && place.lng) {
    competitorsResponse = await call({
      action: GATEWAY_ACTIONS.competitors,
      lat: String(place.lat),
      lng: String(place.lng),
      type: (place.types || []).join(","),
      keyword: keyword || place.name || "",
      exclude: place.placeId || "",
      radius: String(radius),
      description: String(place.description || "").slice(0, 200),
      source_name: place.name || "",
      source_address: place.address || "",
    });
  }

  const categories = {};
  const set = (key, value) => { if (value) categories[key] = value; };
  set("websitePerformance", websitePerformanceFromPsi(psi));
  set("seo", seoFromPsi(psi, secHeaders));
  set("security", securityFromChecks(ssl, secHeaders));
  set("googleBusinessProfile", gbpFromPlace(place));
  set("onlineReputation", reputationFromPlace(place));
  set("socialMedia", socialFromLinks(secHeaders && secHeaders.socialLinks));
  set("technology", technologyFromWhatCms(whatcms));
  set("businessIntelligence", businessIntelligence(company, domainAge));
  set("geo", geoReadiness(categories));

  const overallScore = weightedScore(categories);

  const availabilityFor = (key) => (categories[key] ? "measured" : "not_provided");
  const availability = {
    website: availabilityFor("websitePerformance"),
    seo: availabilityFor("seo"),
    security: availabilityFor("security"),
    gbp: availabilityFor("googleBusinessProfile"),
    reputation: availabilityFor("onlineReputation"),
    social: availabilityFor("socialMedia"),
    technology: availabilityFor("technology"),
    businessIntelligence: availabilityFor("businessIntelligence"),
    geo: availabilityFor("geo"),
    ownerReplies: "not_provided",
  };

  return {
    place,
    siteUrl,
    categories,
    overallScore,
    overallGrade: overallScore === null ? null : gradeForScore(overallScore),
    competitors: (competitorsResponse && Array.isArray(competitorsResponse.competitors) ? competitorsResponse.competitors : []),
    availability,
    measuredCount: Object.keys(categories).length,
    sources: {
      lookup: Boolean(place),
      pagespeed: Boolean(psi),
      ssl: Boolean(ssl),
      security_headers: Boolean(secHeaders),
      whatcms: Boolean(whatcms),
      company: Boolean(company),
      domain_age: Boolean(domainAge),
      competitors: Boolean(competitorsResponse),
    },
  };
}

module.exports = {
  CATEGORY_WEIGHTS,
  GATEWAY_ACTIONS,
  gradeForScore,
  scanBusiness,
  scoreReputationFromGoogleSignals,
  weightedScore,
};
