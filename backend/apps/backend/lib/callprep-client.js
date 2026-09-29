"use strict";

const { createHmac } = require("node:crypto");
const { REPORT_UUID } = require("./report-url");

const DEFAULT_REPORT_ORIGIN = "https://callprep.wss-ai.com";
const DEFAULT_SAVE_FUNCTION = "save-business-report";
const SECURE_ADAPTER_FUNCTION = "ghost-report-adapter";
const IMMUTABLE_PACKET_ID = /^wss-genie-cert-v1:[0-9a-f]{64}$/;
const INTERNAL_BRANDING = /\b(?:rocket\s+search(?:\s+insights)?|rocket\s+serps?|reseller)\b/i;
const INTERNAL_SNAPSHOT_TERMS = /\b(?:bright\s*data|firecrawl|leadminer|pagehub|proof[-_ ]board|rocket\s+search|rocket\s+serps?|callprep|reseller|vapi|twilio|crawler|scrap(?:e|ing))\b/i;

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function customerText(value) {
  const text = cleanString(value);
  return text && !INTERNAL_BRANDING.test(text) ? text : null;
}

function customerList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(customerText).filter(Boolean);
}

function snapshotText(value) {
  const text = cleanString(value);
  if (!text || INTERNAL_SNAPSHOT_TERMS.test(text) || /[\\/]|\b(?:apps|api|lib|node_modules|supabase|functions)\b/i.test(text)) return "";
  return text;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceObjects(adapter = {}, prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const truth = prospect.truth_packet && typeof prospect.truth_packet === "object"
    ? prospect.truth_packet
    : record.truth_packet && typeof record.truth_packet === "object"
      ? record.truth_packet
      : {};
  const localPlan = truth.localSearchPlan || truth.local_search_plan || {};
  const evidence = prospect.search_plan_evidence || prospect.local_market_data || record.search_plan_evidence || {};
  const report = prospect.visibility_report || prospect.report_data || prospect.report || record.visibility_report || record.report_data || record.report || {};
  return [
    prospect.serpIntelligence,
    prospect.serp_intelligence,
    prospect.source_snapshot,
    record.serpIntelligence,
    record.serp_intelligence,
    record.source_snapshot,
    report.serpIntelligence,
    report.serp_intelligence,
    report.source_snapshot,
    adapter.serpIntelligence,
    adapter.serp_intelligence,
    adapter.source_snapshot,
    report,
    prospect.localSearchPlan,
    prospect.local_search_plan,
    record.localSearchPlan,
    record.local_search_plan,
    localPlan,
    evidence,
    adapter.packet,
  ].filter((value) => value && typeof value === "object");
}

function termRows(sources) {
  const rows = [];
  for (const source of sources) {
    for (const key of ["targetTerms", "target_terms", "keywords", "rankings", "searchTerms", "search_terms", "queries"]) {
      const values = Array.isArray(source[key]) ? source[key] : [];
      for (const value of values) {
        const term = snapshotText(typeof value === "string" ? value : value?.term || value?.keyword || value?.query || value?.search_term);
        if (!term) continue;
        const row = {
          term,
          ...(numberOrNull(value?.currentRank ?? value?.current_rank ?? value?.rank ?? value?.client_rank) !== null
            ? { currentRank: numberOrNull(value?.currentRank ?? value?.current_rank ?? value?.rank ?? value?.client_rank) }
            : {}),
          ...(numberOrNull(value?.mapsRank ?? value?.maps_rank ?? value?.local_rank) !== null
            ? { mapsRank: numberOrNull(value?.mapsRank ?? value?.maps_rank ?? value?.local_rank) }
            : {}),
          ...(numberOrNull(value?.searchVolume ?? value?.search_volume ?? value?.volume) !== null
            ? { searchVolume: numberOrNull(value?.searchVolume ?? value?.search_volume ?? value?.volume) }
            : {}),
        };
        if (typeof value === "object" && ["measured", "candidate"].includes(value.evidence)) row.evidence = value.evidence;
        if (!rows.some((item) => item.term.toLowerCase() === term.toLowerCase())) rows.push(row);
      }
    }
  }
  return rows.slice(0, 24);
}

function serpIntelligenceFor(adapter = {}, prospect = {}) {
  const sources = sourceObjects(adapter, prospect);
  const terms = termRows(sources);
  const visibility = sources.find((source) => source.currentVisibility || source.current_visibility || source.visibility);
  const rawVisibility = visibility?.currentVisibility || visibility?.current_visibility || visibility?.visibility || {};
  const measured = rawVisibility.measured === true || terms.some((term) => term.currentRank !== undefined || term.mapsRank !== undefined);
  const top10Terms = terms.filter((term) => Number(term.currentRank ?? term.mapsRank) > 0 && Number(term.currentRank ?? term.mapsRank) <= 10).length;
  const city = snapshotText(prospect.city || prospect.market || "");
  const state = snapshotText(prospect.state || prospect.region || "");
  const aiSource = sources.find((source) => source.aiVisibility || source.ai_visibility || source.answerVisibility || source.answer_visibility);
  const ai = aiSource?.aiVisibility || aiSource?.ai_visibility || aiSource?.answerVisibility || aiSource?.answer_visibility;
  return {
    status: measured ? "measured" : terms.length ? "candidate" : "not_available",
    targetTerms: terms,
    currentVisibility: {
      measured,
      termsMeasured: numberOrNull(rawVisibility.termsMeasured ?? rawVisibility.terms_measured) ?? terms.filter((term) => term.currentRank !== undefined || term.mapsRank !== undefined).length,
      top10Terms: numberOrNull(rawVisibility.top10Terms ?? rawVisibility.top10_terms) ?? top10Terms,
    },
    ...(city || state ? { location: { ...(city ? { city } : {}), ...(state ? { state } : {}) } } : {}),
    ...(ai && typeof ai === "object" ? {
      aiVisibility: {
        status: snapshotText(ai.status || ai.claimLevel || ai.claim_level) || (ai.measured === true ? "measured" : "not_available"),
        measured: ai.measured === true,
      },
    } : {}),
  };
}

function customerUrl(value) {
  const text = customerText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function adapterPacket(adapter = {}) {
  return adapter.packet && typeof adapter.packet === "object" ? adapter.packet : {};
}

function customerSafePacket(adapter = {}, prospect = {}) {
  const packet = adapterPacket(adapter);
  return {
    id: customerText(packet.id),
    businessName: customerText(packet.businessName || prospect.businessName),
    market: customerText(packet.market),
    industry: customerText(packet.industry || prospect.industry),
    requestedSignals: customerList(packet.requestedSignals),
  };
}

function isRealCallPrepReportUrl(value = "") {
  try {
    const url = new URL(String(value));
    if (url.origin !== DEFAULT_REPORT_ORIGIN || url.username || url.password || url.search || url.hash) return false;
    const match = /^\/report\/([^/]+)\/?$/.exec(url.pathname);
    return Boolean(match) && REPORT_UUID.test(decodeURIComponent(match[1]));
  } catch {
    return false;
  }
}

function canonicalCallPrepReportUrl(value = "") {
  if (!isRealCallPrepReportUrl(value)) return "";
  try {
    const match = /^\/report\/([^/]+)\/?$/.exec(new URL(String(value)).pathname);
    return match ? reportUrlForId(decodeURIComponent(match[1])) : "";
  } catch {
    return "";
  }
}

function existingCallPrepReportUrl(prospect = {}) {
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const candidates = [
    prospect.callprep_report_url,
    prospect.callprepReportUrl,
    prospect.report_url,
    prospect.reportUrl,
    record.callprep_report_url,
    record.callprepReportUrl,
    record.report_url,
    record.reportUrl,
  ];
  return candidates.map(canonicalCallPrepReportUrl).find(Boolean) || "";
}

// Faithful re-implementation of the CallPrep report app's own reputation model
// (its src/lib/scoring.ts `scoreReputationFromGoogleSignals`). We reproduce the
// SAME formula rather than invent a number, so a ghost-created report grades the
// reputation category from the real Google star rating + review volume exactly as
// the app would if it had scanned the business itself. Truth-law: this is a
// transform of measured signals, never a fabricated score.
function scoreReputationFromGoogleSignals(reviews, rating, negativeCount = 0) {
  const ratingScore = rating > 0 ? (rating / 5) * 55 : 0;
  const volumeScore = reviews > 0 ? Math.min(35, Math.round(Math.log10(reviews + 1) * 18)) : 0;
  const negativePenalty = Math.min(10, negativeCount * 2);
  let score = ratingScore + volumeScore - negativePenalty;
  if (rating >= 4.8 && reviews > 0) score = Math.max(score, 65);
  if (reviews === 0) score = Math.min(score, 20);
  return Math.min(100, Math.max(0, Math.round(score)));
}

// Mirrors the app's getGrade() thresholds so the emailed report header shows the
// same letter grade the renderer computes from the measured composite.
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

function ratingOrNull(value) {
  const n = numberOrNull(value);
  return n !== null && n > 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

function reviewCountOrNull(value) {
  const n = numberOrNull(value);
  return n !== null && n >= 0 ? Math.round(n) : null;
}

function firstDefined(objects, keys) {
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
  }
  return undefined;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return value.split(/[\n;]|(?<=[.!?])\s+(?=[A-Z])/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

// Map a customer-safe gap description to the app's issue-card category so the
// "what's holding you back" section renders with a sensible label + fix copy.
function categorizeWeakness(text) {
  const t = text.toLowerCase();
  if (/\breview|rating|reputation|star\b/.test(t)) return "Online Reputation";
  if (/\bssl|secure|security|https|padlock\b/.test(t)) return "Website Security";
  if (/\bseo|search rank|ranking|keyword|meta|schema markup\b/.test(t)) return "SEO & Schema Health";
  if (/\bgoogle (business|listing|profile|maps)|gbp|hours|photos|listing\b/.test(t)) return "Google Business Profile";
  if (/\bsocial|facebook|instagram|tiktok|linkedin\b/.test(t)) return "Social Media";
  if (/\bai\b|chatgpt|siri|voice search|answer engine|geo\b/.test(t)) return "AI Search (GEO)";
  if (/\bwebsite|site|web page|mobile|load|speed|slow|responsive|no site\b/.test(t)) return "Website Performance";
  return "Online Presence";
}

function weaknessIssues(list) {
  return toArray(list)
    .map((item) => customerText(typeof item === "string" ? item : item?.text || item?.description || item?.reason))
    .filter(Boolean)
    .slice(0, 8)
    .map((description) => ({
      category: categorizeWeakness(description),
      severity: "high",
      description,
      impact_dollars: 0,
    }));
}

function recommendationItems(list) {
  return toArray(list)
    .map((item, index) => {
      const action = customerText(typeof item === "string" ? item : item?.action || item?.text || item?.recommendation);
      if (!action) return null;
      return {
        priority: (typeof item === "object" && numberOrNull(item?.priority)) || index + 1,
        action,
        impact: (typeof item === "object" && customerText(item?.impact)) || "",
        timeline: (typeof item === "object" && customerText(item?.timeline)) || "",
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

// Only pass through REAL review samples. Never fabricate a review or a rating.
function reviewItems(list) {
  return toArray(list)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const text = customerText(item.text || item.comment || item.review || item.snippet);
      const rating = ratingOrNull(item.rating ?? item.stars);
      if (!text && rating === null) return null;
      const authorName = customerText(item.authorName || item.author || item.reviewer);
      return {
        text: text || "",
        rating: rating ?? 0,
        date: customerText(item.date || item.relativeTime || item.time) || "Recent",
        source: "Google",
        ...(authorName ? { authorName } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

// Build a customer-safe business-health row from a prospect's REAL data. Anything
// ghost genuinely did not measure (website perf, SEO, security, GBP completeness,
// social, GEO) is left null and flagged `not_provided` so the report renderer
// shows an honest "pending re-measurement" state — never a fabricated 0 or F.
// Reputation (star rating + review volume) is the one category ghost has real
// Google signals for, so it is scored + flagged `measured`.
function buildCallPrepRow({ adapter = {}, prospect = {} } = {}) {
  const packet = customerSafePacket(adapter, prospect);
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const scopes = [prospect, record];

  const rating = ratingOrNull(firstDefined(scopes, ["rating", "starRating", "avgRating"]));
  const reviewCount = reviewCountOrNull(firstDefined(scopes, ["review_count", "reviewCount", "reviews_count", "totalReviews"]));
  const hasReputation = rating !== null || reviewCount !== null;

  const reviews = reviewItems(firstDefined(scopes, ["reviews", "reviewSamples", "review_highlights"]));
  const issuesFound = weaknessIssues(firstDefined(scopes, ["weaknesses", "weaknessReasons", "weakness_reasons", "gaps"]));
  const recommendations = recommendationItems(firstDefined(scopes, ["recommendations", "recommendedActions"]));

  // current_website (snake) is read alongside currentWebsite (camel): the
  // immutable Practice projection (lib/line-report.js immutablePacketAdapter)
  // carries the receipt-signed domain as `current_website`, and missing it here
  // is how every website-bearing immutable row shipped business_url: null and
  // refused the owner-proof identity verdict at email time (#595).
  const businessUrl = customerUrl(
    prospect.currentWebsite
      || prospect.current_website
      || prospect.website
      || prospect.url
      || record.current_website
      || record.website,
  );
  const city = snapshotText(prospect.city || prospect.market || record.city || "");
  const state = snapshotText(prospect.state || prospect.region || record.state || "");

  const negativeCount = reviews.filter((review) => review.rating > 0 && review.rating <= 2).length;
  // TRUTH-LAW (2026-07-22): only GRADE reputation when BOTH halves are real.
  // Feeding `reviewCount || 0` / `rating || 0` into the formula fabricated an F
  // for a business whose missing half was merely UNKNOWN (e.g. a real 5.0 rating
  // with an unmeasured review count scored as "5.0 with zero reviews" -> F 20).
  // Partial data is surfaced truthfully (the real half shown, availability
  // "partial") but never scored from a coerced zero.
  const hasFullReputation = rating !== null && reviewCount !== null;
  const reputationScore = hasFullReputation
    ? scoreReputationFromGoogleSignals(reviewCount, rating, negativeCount)
    : null;
  // The renderer recomputes the headline grade from measured cells only; with
  // reputation as the sole measured category this equals the reputation score.
  const overallScore = reputationScore;
  const overallGrade = reputationScore !== null ? gradeForScore(reputationScore) : null;
  const reputationAvailability = hasFullReputation ? "measured" : hasReputation ? "partial" : "not_provided";

  const reputationMetrics = hasReputation
    ? {
        availability: reputationAvailability,
        score: reputationScore,
        starRating: rating,
        reviewCount,
        // Never fabricate a negative-review count — only report samples we hold.
        negativeReviewsFound: reviews.length ? negativeCount : null,
        ownerRepliesAvailability: "not_provided",
        sampleCount: reviews.length,
      }
    : {};

  const serpIntelligence = serpIntelligenceFor(adapter, prospect);

  return {
    business_name: packet.businessName,
    business_url: businessUrl,
    phone: customerText(prospect.phone || record.phone),
    address: customerText(prospect.address || prospect.formattedAddress || record.address),
    overall_score: overallScore,
    overall_grade: overallGrade,
    seo_score: null,
    // Legacy scalar the renderer reads to resolve the reputation cell + composite.
    reviews_score: reputationScore,
    social_score: null,
    website_score: null,
    google_listing_score: null,
    security_score: null,
    geo_score: null,
    technology_score: null,
    intelligence_score: null,
    issues_found: issuesFound,
    recommendations,
    reviews,
    // Self-only entry keeps the hero review badge truthful; the competitive
    // section stays hidden (renderer needs >1 entry) since we scan no rivals.
    // Only written when reputation is FULLY measured — a partial record would
    // coerce the unknown half to 0 here, fabricating a score/review count.
    competitor_data: hasFullReputation
      ? [{ name: packet.businessName || "", score: overallScore || 0, review_count: reviewCount || 0, strengths: [] }]
      : [],
    logo_url: null,
    favicon_url: null,
    brand_colors: [],
    hero_image_url: null,
    business_description: null,
    key_contacts: [],
    source_snapshot: {
      packet_id: packet.id,
      business_name: packet.businessName,
      market: packet.market,
      industry: packet.industry,
      requested_signals: packet.requestedSignals,
      serpIntelligence,
      schemaVersion: 2,
      businessName: packet.businessName,
      // The closed snapshot must carry the website the identity verdict reads
      // back: a read projection that loses the top-level business_url columns
      // still serves source_snapshot verbatim, so the signed domain survives
      // the round-trip there (lib/report-grade.js falls back to this).
      ...(businessUrl ? { resolvedWebsiteUrl: businessUrl } : {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      industryLabel: packet.industry,
      ...(overallScore !== null ? { overallScore, overallGrade } : {}),
      categories: {
        onlineReputation: {
          ...(reputationScore !== null ? { score: reputationScore } : {}),
          isLive: hasReputation,
          metrics: {
            availability: reputationAvailability,
            ...(rating !== null ? { avgRating: rating } : {}),
            ...(reviewCount !== null ? { totalReviews: reviewCount } : {}),
          },
        },
        googleBusinessProfile: {
          isLive: false,
          metrics: {
            availability: "not_provided",
            ...(rating !== null ? { starRating: rating } : {}),
            ...(reviewCount !== null ? { reviewCount } : {}),
          },
        },
      },
      dataAvailability: {
        website: "not_provided",
        seo: "not_provided",
        security: "not_provided",
        gbp: "not_provided",
        reputation: reputationAvailability,
        social: "not_provided",
        technology: "not_provided",
        businessIntelligence: "not_provided",
        geo: "not_provided",
        ownerReplies: "not_provided",
      },
      reputationMetrics,
    },
    whiteLabel: { tenantId: "wss" },
    website_metrics: {},
    google_profile_metrics: {},
    reputation_metrics: reputationMetrics,
    geo_metrics: {},
    data_availability: {
      // `scores` = the overall composite score block, which ghost never supplies.
      scores: "not_provided",
      website: "not_provided",
      seo: "not_provided",
      security: "not_provided",
      gbp: "not_provided",
      reputation: reputationAvailability,
      social: "not_provided",
      technology: "not_provided",
      businessIntelligence: "not_provided",
      geo: "not_provided",
      ownerReplies: "not_provided",
    },
  };
}

// ---------------------------------------------------------------------------
// SCANNED ROW (scan-parity path)
//
// buildCallPrepRow above assembles a row from whatever facts ghost happens to
// hold — for most prospects that is a star rating and a review count, i.e. ONE
// of nine categories, which is why those reports render mostly
// "NOT CAPTURED IN THIS REPORT VERSION". `save-business-report` persists a row;
// it never scans. The scan lives client-side in the CallPrep app.
//
// buildScannedCallPrepRow takes the output of callprep-enrich.scanBusiness()
// — which runs that same scan server-side against the same api-gateway actions
// — and shapes it into the identical row the app's own report-bridge writes
// (its `Lr`), including the source_snapshot the renderer actually reads.
//
// DIFFERENCE FROM THE APP, deliberate: the app writes `score ?? 0` for the five
// legacy scalar columns, which is the origin of the historic fake-zero F/32
// bug. We write a measured score or nothing at all. See the note on
// `assignScalar` for what the database does with that.
// ---------------------------------------------------------------------------

const SCALAR_FOR_CATEGORY = Object.freeze({
  seo_score: "seo",
  reviews_score: "onlineReputation",
  social_score: "socialMedia",
  website_score: "websitePerformance",
  google_listing_score: "googleBusinessProfile",
  security_score: "security",
  geo_score: "geo",
  technology_score: "technology",
  intelligence_score: "businessIntelligence",
});

// PROVEN BY READ-BACK (2026-07-30): `seo_score`, `reviews_score`,
// `social_score`, `website_score` and `google_listing_score` are NOT NULL
// DEFAULT 0 columns. Sending `null` and omitting the key are indistinguishable
// — both store 0. Only `security_score`, `geo_score`, `technology_score` and
// `intelligence_score` are nullable and round-trip a genuine null.
//
// So we OMIT rather than null-fill (the honest write, and correct for the four
// nullable columns), and we never let a stored 0 be read as a measurement: the
// authoritative not-measured signal is `data_availability[...]`, which the
// renderer already honours, and which any future consumer must consult before
// trusting a scalar. `scalar_availability` below is that contract made
// explicit and machine-readable on the row itself.
function assignScalar(row, key, category) {
  const availability = availabilityOf(category);
  if (availability === "measured" && typeof category.score === "number") {
    row[key] = Math.round(category.score);
  }
  return availability;
}

// app: `ne` — resolve a category's availability without ever inventing one.
function availabilityOf(category) {
  if (!category) return "not_provided";
  const declared = (category.metrics || {}).availability;
  if (["measured", "unavailable", "rate_limited", "not_provided"].includes(declared)) return declared;
  if (declared === "not_run") return "unavailable";
  return category.isLive === true ? "measured" : "unavailable";
}

function measuredScore(category) {
  return availabilityOf(category) === "measured" && typeof category.score === "number"
    ? Math.round(category.score)
    : null;
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// app: `Tr` — real Google review samples only. Never fabricated.
function scannedReviews(place) {
  const list = Array.isArray(place && place.reviews) ? place.reviews : [];
  return list.slice(0, 10).map((review) => ({
    text: String(review.text || ""),
    rating: Number(review.rating) || 3,
    date: review.relativeTime ? String(review.relativeTime) : review.date ? String(review.date) : "Recent",
    source: "Google",
    ...(review.authorName ? { authorName: String(review.authorName) } : {}),
  }));
}

// app: `qn` — competitor rows carry only figures Google returned for them.
//
// DELIBERATELY NO `score`. Google's nearby search returns a rival's name,
// rating and review volume — it does NOT audit their site, so we cannot compute
// a composite for them the way we do for the subject. Scoring rivals on a
// reputation-only scale and ranking them against the subject's full composite
// is apples-to-oranges: it ranked a 4.9★ business #9 of 9 behind peers who were
// never audited at all. `save-business-report` performs its own competitor
// enrichment on one consistent scale, so we hand it the peer identities and let
// it do the ranking. Verified by read-back: the function returns a fully scored
// peer set from a row that carried only the subject.
function scannedCompetitors(competitors) {
  return (Array.isArray(competitors) ? competitors : []).map((competitor) => {
    const rating = numOrNull(competitor.rating);
    const reviews = numOrNull(competitor.reviews);
    const strengths = [];
    if (rating !== null && rating >= 4.5 && reviews !== null && reviews >= 25) {
      strengths.push(`${rating}★ across ${reviews} reviews`);
    } else if (reviews !== null && reviews >= 100) {
      strengths.push(`${reviews}+ reviews`);
    }
    return {
      name: customerText(competitor.name) || "",
      review_count: reviews ?? 0,
      ...(rating !== null ? { rating } : {}),
      strengths,
    };
  }).filter((competitor) => competitor.name);
}

// app: `fb` (generateFindings) — every finding is gated on the category that
// produced it actually being measured, so nothing is asserted about an
// unmeasured area.
function scannedFindings(categories) {
  const findings = [];
  const measured = (key) => availabilityOf(categories[key]) === "measured" ? categories[key] : null;

  const website = measured("websitePerformance");
  if (website) {
    if (website.score < 40) findings.push({ text: "Website loads slowly — improving speed could bring in more visitors", priority: "Recommended", category: "Website Performance" });
    if (!website.metrics.hasSSL) findings.push({ text: "No secure padlock icon (SSL) — adding one builds customer trust", priority: "Recommended", category: "Website Performance" });
    const mobile = Number(website.metrics.mobileScore);
    if (mobile > 0 && mobile < 50) findings.push({ text: `Mobile speed score is ${mobile}/100 — optimizing could capture more phone searchers`, priority: "Suggested", category: "Website Performance" });
  }

  const seo = measured("seo");
  if (seo) {
    if (!seo.metrics.hasSchema) findings.push({ text: "Adding structured data could help you show up better in Google results", priority: "Suggested", category: "SEO & Schema Health" });
    if (!seo.metrics.hasMetaDesc) findings.push({ text: "Adding page descriptions could improve your click-through rate from Google", priority: "Suggested", category: "SEO & Schema Health" });
  }

  const security = measured("security");
  if (security) {
    if (["D", "F"].includes(security.metrics.sslGrade)) findings.push({ text: `Security certificate could be upgraded from ${security.metrics.sslGrade} — improves customer trust`, priority: "Recommended", category: "Website Security" });
    if (Number(security.metrics.securityHeaders) < 3) findings.push({ text: "Adding more security headers would strengthen website protection", priority: "Consider", category: "Website Security" });
  }

  const gbp = measured("googleBusinessProfile");
  if (gbp) {
    if (!gbp.metrics.verified) findings.push({ text: "Claiming your Google Business Profile gives you control over your listing", priority: "Recommended", category: "Google Business Profile" });
    if (Number(gbp.metrics.reviewCount) < 20) findings.push({ text: `Growing from ${gbp.metrics.reviewCount} to 50+ reviews would significantly boost visibility`, priority: "Recommended", category: "Google Business Profile" });
  }

  if (measured("onlineReputation")) {
    findings.push({ text: "Review replies are best verified inside Google Business Profile because Google does not expose owner-response data here", priority: "Consider", category: "Online Reputation" });
  }

  const social = measured("socialMedia");
  if (social) {
    if (!social.metrics.hasFacebook) findings.push({ text: "A Facebook page could connect you with more local customers", priority: "Consider", category: "Social Media" });
    if (!social.metrics.hasInstagram) findings.push({ text: "Instagram could help you reach younger audiences visually", priority: "Consider", category: "Social Media" });
    // Truth guard the app lacks: a stock template href is not a real profile.
    const placeholders = social.metrics.unverifiedPlaceholderLinks;
    if (Array.isArray(placeholders) && placeholders.length) {
      findings.push({ text: `Your site links to ${placeholders.join(", ")} using a template placeholder address — the link does not reach your own profile`, priority: "Recommended", category: "Social Media" });
    }
  }

  const geo = measured("geo");
  if (geo) {
    if (!geo.metrics.hasSchema) findings.push({ text: "Adding structured data (schema.org) markup helps AI assistants like ChatGPT and Google Gemini verify and recommend your business", priority: "Suggested", category: "AI Search (GEO)" });
    if (!geo.metrics.hasFAQ) findings.push({ text: "Creating an FAQ page helps AI assistants pull answers about your business", priority: "Consider", category: "AI Search (GEO)" });
    if (Number(geo.metrics.socialProofSignals) < 3) findings.push({ text: "Claiming more social profiles strengthens AI validation of your business", priority: "Consider", category: "AI Search (GEO)" });
  }

  const order = { Recommended: 0, Suggested: 1, Consider: 2 };
  return findings.sort((a, b) => order[a.priority] - order[b.priority]);
}

const SEVERITY_FOR_PRIORITY = { Recommended: "high", Suggested: "medium", Consider: "low" };

/**
 * Shape a completed callprep-enrich scan into the CallPrep report row.
 * @param {object} scan  Output of callprep-enrich.scanBusiness().
 */
function buildScannedCallPrepRow({ scan, prospect = {} } = {}) {
  const categories = (scan && scan.categories) || {};
  const place = (scan && scan.place) || {};
  const businessName = customerText(place.name || prospect.businessName || prospect.business_name);
  const gbpMetrics = (categories.googleBusinessProfile && categories.googleBusinessProfile.metrics) || {};

  const findings = scannedFindings(categories);
  const reviews = scannedReviews(place);
  const negativeReviewsFound = reviews.length ? reviews.filter((review) => review.rating <= 2).length : null;

  const websiteAvailability = availabilityOf(categories.websitePerformance);
  const gbpAvailability = availabilityOf(categories.googleBusinessProfile);
  const reputationAvailability = availabilityOf(categories.onlineReputation);
  const geoAvailability = availabilityOf(categories.geo);

  const websiteMetrics = {
    availability: websiteAvailability,
    score: measuredScore(categories.websitePerformance),
    mobileScore: websiteAvailability === "measured" ? numOrNull(categories.websitePerformance.metrics.mobileScore) : null,
    loadTime: websiteAvailability === "measured" ? numOrNull(categories.websitePerformance.metrics.loadTime) : null,
    fcp: websiteAvailability === "measured" ? numOrNull(categories.websitePerformance.metrics.fcp) : null,
    lcp: websiteAvailability === "measured" ? numOrNull(categories.websitePerformance.metrics.lcp) : null,
    cls: websiteAvailability === "measured" ? numOrNull(categories.websitePerformance.metrics.cls) : null,
    tbt: websiteAvailability === "measured" ? numOrNull(categories.websitePerformance.metrics.tbt) : null,
    hasSSL: websiteAvailability === "measured" ? Boolean(categories.websitePerformance.metrics.hasSSL) : null,
    error: null,
  };

  const googleProfileMetrics = {
    availability: gbpAvailability,
    score: measuredScore(categories.googleBusinessProfile),
    starRating: numOrNull(gbpMetrics.starRating),
    reviewCount: numOrNull(gbpMetrics.reviewCount),
    photoCount: numOrNull(gbpMetrics.photoCount),
    phone: String(gbpMetrics.phone || ""),
    internationalPhone: String(gbpMetrics.internationalPhone || ""),
    hoursListed: Boolean(gbpMetrics.hoursListed),
    hoursText: typeof gbpMetrics.hoursText === "string" ? gbpMetrics.hoursText : "[]",
    isOpenNow: typeof gbpMetrics.isOpenNow === "boolean" ? gbpMetrics.isOpenNow : null,
    gbpCompleteness: numOrNull(gbpMetrics.gbpCompleteness),
    gbpDescription: String(gbpMetrics.gbpDescription || ""),
    reviewVelocity: numOrNull(gbpMetrics.reviewVelocity),
    reviewTrend: String(gbpMetrics.reviewTrend || "flat"),
    mapsUrl: String(gbpMetrics.mapsUrl || ""),
  };

  const reputationRaw = (categories.onlineReputation && categories.onlineReputation.metrics) || {};
  const reputationMetrics = {
    availability: reputationAvailability,
    score: measuredScore(categories.onlineReputation),
    starRating: numOrNull(reputationRaw.avgRating),
    reviewCount: numOrNull(reputationRaw.totalReviews),
    negativeReviewsFound,
    // Google's public listing API does not expose owner responses. Not measured.
    ownerRepliesAvailability: "not_provided",
    sampleCount: reviews.length,
  };

  const geoRaw = (categories.geo && categories.geo.metrics) || {};
  const geoMetrics = {
    availability: geoAvailability,
    score: measuredScore(categories.geo),
    hasSchema: Boolean(geoRaw.hasSchema),
    hasFAQ: Boolean(geoRaw.hasFAQ),
    contentQuality: numOrNull(geoRaw.contentQuality),
    reviewRecency: numOrNull(geoRaw.reviewRecency),
    napConsistency: Boolean(geoRaw.napConsistency),
    socialProofSignals: numOrNull(geoRaw.socialProofSignals),
    domainAge: numOrNull(geoRaw.domainAge),
  };

  const dataAvailability = {
    scores: scan && typeof scan.overallScore === "number" ? "measured" : "not_provided",
    website: websiteAvailability,
    seo: availabilityOf(categories.seo),
    security: availabilityOf(categories.security),
    gbp: gbpAvailability,
    reputation: reputationAvailability,
    social: availabilityOf(categories.socialMedia),
    technology: availabilityOf(categories.technology),
    businessIntelligence: availabilityOf(categories.businessIntelligence),
    geo: geoAvailability,
    ownerReplies: "not_provided",
    websitePerformance: websiteAvailability,
    googleBusinessProfile: gbpAvailability,
    onlineReputation: reputationAvailability,
    socialMedia: availabilityOf(categories.socialMedia),
  };

  const businessUrl = customerUrl((scan && scan.siteUrl) || place.website || prospect.currentWebsite || prospect.website);
  const competitorRows = scannedCompetitors(scan && scan.competitors);
  const overallScore = scan && typeof scan.overallScore === "number" ? scan.overallScore : null;

  const row = {
    business_name: businessName,
    business_url: businessUrl,
    phone: customerText(place.phone || prospect.phone),
    address: customerText(place.address || prospect.address),
    overall_score: overallScore,
    overall_grade: overallScore === null ? null : gradeForScore(overallScore),
    issues_found: findings.map((finding) => ({
      category: finding.category,
      severity: SEVERITY_FOR_PRIORITY[finding.priority] || "medium",
      description: finding.text,
      impact_dollars: 0,
    })),
    recommendations: findings.slice(0, 10).map((finding, index) => ({
      priority: index + 1,
      action: finding.text,
      impact: finding.category,
      timeline: finding.priority === "Recommended" ? "1-2 weeks" : finding.priority === "Suggested" ? "2-4 weeks" : "1-3 months",
    })),
    reviews,
    // SELF ONLY — see scannedCompetitors. `save-business-report` enriches the
    // peer set itself when the row carries just the subject, and it scores
    // every peer on ONE scale. Handing it our own peer rows suppresses that
    // enrichment and leaves the rivals unscored (proved by read-back), so we
    // deliberately send only the subject. The scanned peers are still carried
    // in source_snapshot.competitors as evidence of who was found.
    competitor_data: overallScore === null
      ? []
      : [{
          name: businessName || "",
          score: overallScore,
          review_count: numOrNull(gbpMetrics.reviewCount) ?? 0,
          strengths: [],
        }],
    logo_url: null,
    favicon_url: null,
    brand_colors: [],
    hero_image_url: null,
    business_description: customerText(gbpMetrics.gbpDescription),
    key_contacts: [],
    source_snapshot: {
      schemaVersion: 2,
      businessName,
      resolvedWebsiteUrl: businessUrl,
      overallScore,
      overallGrade: overallScore === null ? null : gradeForScore(overallScore),
      city: snapshotText(place.city || prospect.city),
      industry: customerText(prospect.industry) || "Local Business",
      industryLabel: customerText(prospect.industry) || "Local Business",
      findings,
      competitors: competitorRows,
      keyContacts: [],
      categories,
      websiteMetrics,
      googleProfileMetrics,
      reputationMetrics,
      geoMetrics,
      dataAvailability,
      visualEvidence: null,
    },
    whiteLabel: { tenantId: "wss" },
    website_metrics: websiteMetrics,
    google_profile_metrics: googleProfileMetrics,
    reputation_metrics: reputationMetrics,
    geo_metrics: geoMetrics,
    data_availability: dataAvailability,
  };

  // Write ONLY measured scalars. See assignScalar for why omission is the
  // strongest honest write available and why data_availability stays
  // authoritative for the five NOT NULL columns.
  const scalarAvailability = {};
  for (const [key, categoryKey] of Object.entries(SCALAR_FOR_CATEGORY)) {
    scalarAvailability[key] = assignScalar(row, key, categories[categoryKey]);
  }
  // Explicit machine-readable contract for any future consumer of the scalars:
  // a scalar whose availability is not "measured" is NOT a measurement, whatever
  // value the column's NOT NULL DEFAULT put there.
  row.source_snapshot.scalarAvailability = scalarAvailability;

  return row;
}

async function saveScannedBusinessReport({ scan, prospect = {}, closerId: requestedCloserId = null } = {}, options = {}) {
  const row = buildScannedCallPrepRow({ scan, prospect });
  return postRow(row, requestedCloserId, options);
}

function callPrepConfig(env = process.env) {
  const anonKey = cleanString(env.CALLPREP_SUPABASE_ANON_KEY);
  const saveFunction = /^[a-z0-9_-]+$/i.test(cleanString(env.CALLPREP_SAVE_FN))
    ? cleanString(env.CALLPREP_SAVE_FN)
    : DEFAULT_SAVE_FUNCTION;
  try {
    const url = new URL(cleanString(env.CALLPREP_SUPABASE_URL));
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_url");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/functions/v1/${encodeURIComponent(saveFunction)}`;
    url.search = "";
    url.hash = "";
    return { anonKey, endpoint: url.toString() };
  } catch {
    return { anonKey, endpoint: "" };
  }
}

function secureCallPrepConfig(env = process.env) {
  const secret = typeof env.GHOST_REPORT_ADAPTER_HMAC_SECRET === "string"
    ? env.GHOST_REPORT_ADAPTER_HMAC_SECRET
    : "";
  try {
    const url = new URL(cleanString(env.CALLPREP_GHOST_ADAPTER_URL));
    const pathname = url.pathname.replace(/\/+$/, "");
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || !pathname.endsWith(`/${SECURE_ADAPTER_FUNCTION}`)
    ) {
      throw new Error("invalid_url");
    }
    url.pathname = pathname;
    return {
      configured: Buffer.byteLength(secret, "utf8") >= 32,
      endpoint: url.toString(),
      secret,
    };
  } catch {
    return { configured: false, endpoint: "", secret };
  }
}

function reportId(value) {
  const id = cleanString(value);
  return REPORT_UUID.test(id) ? id : "";
}

function reportUrlForId(value) {
  const id = reportId(value);
  return id ? `${DEFAULT_REPORT_ORIGIN}/report/${encodeURIComponent(id)}` : "";
}

function closerId(value) {
  const id = cleanString(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

async function saveBusinessReport(input = {}, options = {}) {
  const safeInput = input && typeof input === "object" ? input : {};
  const {
    adapter = {},
    prospect = {},
    closerId: requestedCloserId = null,
  } = safeInput;
  const row = buildCallPrepRow({ adapter, prospect });
  if (Object.prototype.hasOwnProperty.call(safeInput, "immutablePacketId")) {
    return postImmutableRow(row, safeInput.immutablePacketId, options);
  }
  return postRow(row, requestedCloserId, options);
}

async function postImmutableRow(
  row,
  immutablePacketId,
  {
    env = process.env,
    fetch: fetchImpl = global.fetch,
    timeoutMs = 15000,
    now = Date.now,
  } = {},
) {
  const config = secureCallPrepConfig(env);
  if (!config.configured || !config.endpoint) {
    return {
      ok: false,
      configured: false,
      mode: "not_configured",
      reason: "CallPrep secure report adapter is not configured.",
    };
  }

  const packetId = typeof immutablePacketId === "string" ? immutablePacketId : "";
  const rowPacketId = row && row.source_snapshot && typeof row.source_snapshot === "object"
    ? row.source_snapshot.packet_id
    : "";
  if (
    !row
    || !row.business_name
    || packetId !== packetId.trim()
    || !IMMUTABLE_PACKET_ID.test(packetId)
    || rowPacketId !== packetId
  ) {
    return {
      ok: false,
      configured: true,
      mode: "invalid_packet",
      reason: "The verified immutable packet id is required and must match the report row.",
    };
  }

  let rawBody;
  try {
    rawBody = JSON.stringify({
      tenantId: "wss",
      externalId: packetId,
      report: row,
    });
  } catch {
    return {
      ok: false,
      configured: true,
      mode: "invalid_packet",
      reason: "The verified CallPrep report row is not serializable.",
    };
  }

  const timestamp = Math.floor(Number(now()) / 1000).toString();
  const signature = createHmac("sha256", config.secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const controller = new AbortController();
  const duration = Number.isFinite(Number(timeoutMs))
    ? Math.max(1, Math.trunc(Number(timeoutMs)))
    : 15000;
  let timeout;
  let timedOut = false;
  try {
    const request = (async () => {
      const response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WSS-Timestamp": timestamp,
          "X-WSS-Signature": `sha256=${signature}`,
        },
        body: rawBody,
        signal: controller.signal,
      });
      const json = response.ok ? await response.json().catch(() => ({})) : {};
      return { response, json };
    })();
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error("callprep_timeout"));
      }, duration);
    });
    const { response, json } = await Promise.race([request, deadline]);
    if (!response.ok) {
      return {
        ok: false,
        configured: true,
        mode: "request_failed",
        status: response.status,
        reason: "CallPrep report could not be saved.",
      };
    }

    const id = reportId(json.reportId || json.report_id);
    const adapterMode = cleanString(json.mode).toLowerCase();
    if (json.ok !== true || !id || !["created", "updated"].includes(adapterMode)) {
      return {
        ok: false,
        configured: true,
        mode: "invalid_response",
        status: response.status,
        reason: "CallPrep did not return a valid report id.",
      };
    }

    return {
      ok: true,
      configured: true,
      mode: adapterMode === "created" ? "report_created" : "report_reused",
      report_id: id,
      // The adapter's historical response used /report/audit/<uuid>. Ghost's
      // only customer-safe route is /report/<uuid>, so derive it from the UUID.
      report_url: reportUrlForId(id),
    };
  } catch {
    return {
      ok: false,
      configured: true,
      mode: timedOut ? "timeout" : "request_failed",
      reason: timedOut
        ? "CallPrep secure report adapter timed out."
        : "CallPrep report could not be saved.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postRow(
  row,
  requestedCloserId = null,
  { env = process.env, fetch: fetchImpl = global.fetch, timeoutMs = 15000 } = {},
) {
  const config = callPrepConfig(env);
  if (!config.endpoint || !config.anonKey) {
    return {
      ok: false,
      configured: false,
      mode: "not_configured",
      reason: "CallPrep server credentials are not configured.",
    };
  }

  if (!row || !row.business_name) {
    return {
      ok: false,
      configured: true,
      mode: "invalid_packet",
      reason: "A customer-safe business name is required.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.anonKey}`,
        apikey: config.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ row, closer_id: closerId(requestedCloserId) }),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        configured: true,
        mode: "request_failed",
        status: response.status,
        reason: "CallPrep report could not be saved.",
      };
    }

    const id = reportId(json.id);
    if (!id) {
      return {
        ok: false,
        configured: true,
        mode: "invalid_response",
        status: response.status,
        reason: "CallPrep did not return a valid report id.",
      };
    }

    return {
      ok: true,
      configured: true,
      mode: "report_created",
      report_id: id,
      // A successful POST created this exact row. Never let a stale URL carried
      // on the input shadow the UUID the server just returned; callers that
      // want to reuse an existing report avoid this POST before they get here.
      report_url: reportUrlForId(id),
    };
  } catch {
    return {
      ok: false,
      configured: true,
      mode: "request_failed",
      reason: "CallPrep report could not be saved.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  buildCallPrepRow,
  buildScannedCallPrepRow,
  canonicalCallPrepReportUrl,
  customerSafePacket,
  existingCallPrepReportUrl,
  reportUrlForId,
  saveBusinessReport,
  saveScannedBusinessReport,
};
