"use strict";

// lib/build-qualification.js — DO NOT BUILD A SITE THAT IS NOT AN UPGRADE.
//
// Owner rule, 2026-07-30: "we shouldn't be making sites for anybody that has a
// signal report that's higher than a C+ ... skip everybody who has B- or
// better ... and I want both."
//
// The reasoning is the whole pitch. Our email is a before/after strip. If the
// "before" already looks as good as the "after", we have spent build cost to
// argue ourselves out of a sale, and the prospect is right to say no.
//
// WHY THIS IS NOT JUST `overall_grade > "C+"`.
//
// The composite Signal grade is weighted (callprep-enrich.js CATEGORY_WEIGHTS):
//
//     googleBusinessProfile 0.30   onlineReputation 0.20
//     websitePerformance    0.20   geo              0.10
//     seo                   0.08   socialMedia      0.08
//     security              0.02   technology       0.02
//
// HALF of it is reviews and Google profile. A contractor with 400 reviews at
// 4.9 stars and a complete GBP scores B+ while running a dead GoDaddy site with
// no mobile viewport — and that is our single best buyer: proven demand, real
// money, terrible website. A composite-only gate rejects them. Meanwhile a
// business with a slick modern site and eleven reviews grades C- and sails
// through, which is the lateral-move build the rule exists to stop.
//
// So we grade the WEBSITE AXIS separately: the four categories our product
// actually replaces, re-normalised to 100 on the same A+..F curve so a letter
// grade means what the owner thinks it means. `geo` is deliberately EXCLUDED
// even though it sounds site-shaped: geoReadiness() draws 40 of its 100 points
// from review count, GBP phone/hours, social signals and domain age, so
// including it would re-import the reputation bias this split exists to remove.
//
// Both axes are still checked. That is the owner's "I want both". They no
// longer share ONE ceiling — see the two constants below and why they differ.

const { gradeForScore, weightedScore, scoreReputationFromGoogleSignals } = require("./callprep-enrich");

// Worst -> best. Index IS the rank; nothing else may define grade order.
const GRADE_ORDER = Object.freeze([
  "F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+",
]);

// GRADES NO LONGER REFUSE ANYONE. Owner's decision, 2026-08-06, after the grade
// gate held up a second consecutive run: "just drop the grading if it's a hold
// up like this — maybe try to remove it or up it."
//
// I put the counter-argument to him twice (a mirror of an already-good site is
// a lateral move and a weaker pitch); he reaffirmed. It is his call, and the
// commercial logic is his: the constraint on this business is lead SUPPLY, and
// a grade is a proxy for "would they want this" that we can measure but cannot
// actually know. The customer decides that, not our scorer.
//
// WHAT DID NOT CHANGE, and must not be quietly lost with it:
//   - Both grades are still MEASURED and still stored on every packet. The
//     proof email's whole argument is a before/after, so the "before" number
//     has to exist. Dropping the GATE is not dropping the MEASUREMENT.
//   - The `modernPremium` veto in qualifyWebsiteAxis() is NOT a grade and is
//     still active by default: a modern-framework, responsive, deep, schema'd
//     site is refused whatever it scores. It is separately tunable (see
//     MODERN_PREMIUM_ENV) because the owner did not ask for it to go and it
//     almost never binds — but if it ever does, it is one env var away.
//   - "unmeasured" is still a SKIP in qualifyForBuild. Fail-closed on a
//     prospect we never looked at is not a grading rule; it is the rule that
//     stops us spending build cost blind.
const OFF_VALUES = /^(off|none|any|no|false|0|disabled)$/i;

// Composite Signal ceiling. Default OFF. Set GHOST_AGENCY_COMPOSITE_CEILING to
// a grade (e.g. "C+") to restore the old behaviour without a deploy.
const DEFAULT_MAX_COMPOSITE_GRADE = "off";
const COMPOSITE_CEILING_ENV = "GHOST_AGENCY_COMPOSITE_CEILING";

// Kept as the documented restore point and used as the fallback whenever a
// caller asks for composite gating without naming a grade.
const MAX_BUILDABLE_GRADE = "C+";

// WEBSITE-AXIS ceiling — a SEPARATE, looser number since 2026-08-05.
//
// Owner's decision, verbatim: "maybe the graded gate does not matter, and this
// is hindering us. All we need to know is that they don't have a good website
// to some extent, and our websites are so good that no one has a site as good
// as ours."
//
// The evidence behind it: across a 40-metro plumbing run, the website-axis
// ceiling was the single largest killer at qualification — refusals reading
// "website already grades B- — better than C+, so a mirror is a lateral move"
// and "website already grades B". One metro went 37 candidates -> 11 survivors
// with 26 killed on this rule alone. Those are not lateral moves: a B- on THIS
// axis is a responsive site with a title tag and no security headers, which our
// mirror still beats outright. C+ was pricing in a confidence we do not need.
//
// It was raised C+ -> B+ once and STILL held the next run up, which is what
// settled the question: the number was never going to be right, because the
// thing it was proxying for is not measurable from four HTTP checks.
//
// Default is now OFF. Set GHOST_AGENCY_WEBSITE_AXIS_CEILING to any grade in
// GRADE_ORDER ("B+", "C+", …) to reinstate a ceiling without a deploy.
const DEFAULT_MAX_WEBSITE_GRADE = "off";
const WEBSITE_CEILING_ENV = "GHOST_AGENCY_WEBSITE_AXIS_CEILING";

// The modern-premium veto is a STRUCTURAL check, not a grade, so it survives
// the grading change. Set GHOST_AGENCY_MODERN_PREMIUM_VETO=off to drop it too.
const MODERN_PREMIUM_ENV = "GHOST_AGENCY_MODERN_PREMIUM_VETO";

// The categories a Mirror Engine site actually replaces, with the app's OWN
// weights (callprep-enrich.js CATEGORY_WEIGHTS) so this axis is a
// re-normalisation of the real score rather than a second invented model.
const WEBSITE_AXIS_WEIGHTS = Object.freeze([
  { key: "websitePerformance", weight: 0.20 },
  { key: "seo", weight: 0.08 },
  { key: "security", weight: 0.02 },
  { key: "technology", weight: 0.02 },
]);

function gradeRank(grade) {
  return GRADE_ORDER.indexOf(String(grade || "").trim().toUpperCase());
}

/**
 * Resolve one ceiling setting to either a grade string or "off".
 *
 * Read from `env` at CALL time, never captured at module load, so a retune is
 * honoured by the next mine without a deploy. An unrecognised value falls back
 * to the default rather than being interpreted — a typo must not silently
 * change the rule in EITHER direction.
 */
function resolveCeiling(env, key, fallback) {
  const raw = String((env && env[key]) || "").trim();
  if (!raw) return fallback;
  if (OFF_VALUES.test(raw)) return "off";
  return gradeRank(raw.toUpperCase()) >= 0 ? raw.toUpperCase() : fallback;
}

/** The website-axis ceiling in force right now, or "off". */
function maxBuildableWebsiteGrade(env = process.env) {
  return resolveCeiling(env, WEBSITE_CEILING_ENV, DEFAULT_MAX_WEBSITE_GRADE);
}

/** The composite Signal ceiling in force right now, or "off". */
function maxBuildableCompositeGrade(env = process.env) {
  return resolveCeiling(env, COMPOSITE_CEILING_ENV, DEFAULT_MAX_COMPOSITE_GRADE);
}

/** True when the modern-premium structural veto is active (default: yes). */
function modernPremiumVetoActive(env = process.env) {
  return !OFF_VALUES.test(String((env && env[MODERN_PREMIUM_ENV]) || "").trim());
}

/** A ceiling of "off" admits every measured grade. */
const ceilingIsOff = (ceiling) => String(ceiling || "").toLowerCase() === "off";

/**
 * "B+" -> "B_plus", "B-" -> "B_minus". The funnel's rejection counters are keyed
 * by reason string and the miner names the ceiling in the key, so a counter is
 * still readable ("website_axis_above_B_plus") after the env var is retuned —
 * a bucket that lies about which rule refused the lead is worse than no bucket.
 */
function gradeSlug(grade) {
  return String(grade || "").trim().toUpperCase().replace(/\+/g, "_plus").replace(/-/g, "_minus");
}

/**
 * True when `grade` is at or below the buildable ceiling.
 *
 * An UNMEASURED grade is still false — that is the fail-closed rule about not
 * spending on a prospect we never looked at, and it is deliberately NOT part of
 * what "drop the grading" removed. A ceiling of "off" admits anything we did
 * manage to measure.
 */
function isBuildableGrade(grade, ceiling = MAX_BUILDABLE_GRADE) {
  const rank = gradeRank(grade);
  if (rank < 0) return false;
  if (ceilingIsOff(ceiling)) return true;
  return rank <= gradeRank(ceiling);
}

/**
 * Grade the website axis only.
 *
 * Unmeasured categories are dropped from BOTH numerator and denominator, the
 * same way calculateWeightedScore does — a category we could not measure must
 * never drag the score toward F, because a false F would QUALIFY a prospect we
 * should have skipped. Returns null when nothing on the axis was measured.
 */
function websiteAxisScore(categories = {}) {
  let total = 0;
  let totalWeight = 0;
  const measured = [];
  const missing = [];
  for (const { key, weight } of WEBSITE_AXIS_WEIGHTS) {
    const category = categories && categories[key];
    const score = category && Number(category.score);
    if (!category || !Number.isFinite(score)) { missing.push(key); continue; }
    total += score * weight;
    totalWeight += weight;
    measured.push(key);
  }
  if (!totalWeight) return null;
  const score = Math.round(total / totalWeight);
  return { score, grade: gradeForScore(score), measured, missing };
}

/**
 * qualifyForBuild({ categories, overallScore, overallGrade, probe })
 *
 * `probe` is lib/site-weakness.js analyzeWebsite() output when available.
 * Returns { ok, decision, reasons[], website, composite, ceiling, website_ceiling }.
 *
 * FAIL-CLOSED. An unmeasured prospect is a SKIP, not a build: the entire point
 * is to stop spending build cost on sites we never looked at. The one exception
 * is the prospect with NO website at all, who needs no grade to prove the
 * upgrade and is the strongest opening we have.
 *
 * BOTH halves read the same env-tunable ceilings the miner uses, and both are
 * OFF by default. They have to match: the operator line re-runs this over rows
 * the miner already admitted, so a stricter number here would silently
 * re-impose a ceiling one stage later — the double-gate api/admin/line.js
 * warns about.
 */
function qualifyForBuild({ categories = {}, overallScore = null, overallGrade = null, probe = null, env = process.env } = {}) {
  const reasons = [];
  const websiteCeiling = maxBuildableWebsiteGrade(env);
  const compositeCeiling = maxBuildableCompositeGrade(env);

  // No website at all — nothing to grade, and the best lead in the pool.
  if (probe && probe.exists === false) {
    return {
      ok: true,
      decision: "build",
      reasons: ["no website on their Google profile — every mirror is an upgrade"],
      website: null,
      composite: null,
      ceiling: compositeCeiling,
      website_ceiling: websiteCeiling,
    };
  }

  // The measured veto. site-weakness.js already computes this and nothing has
  // ever enforced it: "already has a modern, well-built site — not our buyer."
  if (probe && probe.modernPremium === true && modernPremiumVetoActive(env)) {
    return {
      ok: false,
      decision: "skip",
      reasons: ["already has a modern, responsive, well-built site — not our buyer"],
      website: null,
      composite: null,
      ceiling: compositeCeiling,
      website_ceiling: websiteCeiling,
    };
  }

  const website = websiteAxisScore(categories);
  // Number(null) is 0 and Number("") is 0, and Number.isFinite(0) is true — so
  // the old test turned "we never measured this business" into a composite
  // score of 0, grade F. Under the C+ ceiling an F sailed through, so it never
  // surfaced as a bug; it surfaced as a FACT, because the proof email prints
  // the "before" grade. Telling a prospect their business grades F when we
  // never scored them is a fabricated claim about them, which is the one thing
  // this system may not do. Only a real number counts as a measurement.
  const compositeScore = overallScore === null || overallScore === undefined || overallScore === ""
    || !Number.isFinite(Number(overallScore))
    ? null
    : Number(overallScore);
  const compositeGrade = overallGrade || (compositeScore === null ? null : gradeForScore(compositeScore));
  const composite = compositeGrade ? { score: compositeScore, grade: compositeGrade } : null;

  // An unmeasured axis blocks only where its own ceiling is still enforced —
  // the operator line re-runs this over rows the miner already admitted, so any
  // rule stricter here silently re-imposes a gate one stage later.
  const websiteBlocked = !website && !ceilingIsOff(websiteCeiling);
  const compositeBlocked = !composite && !ceilingIsOff(compositeCeiling);
  if (websiteBlocked) reasons.push(`website axis unmeasured — cannot prove it sits under the ${websiteCeiling} ceiling`);
  if (compositeBlocked) reasons.push(`composite Signal grade unmeasured — cannot prove it sits under the ${compositeCeiling} ceiling`);
  if (!website && !websiteBlocked) reasons.push("website axis unmeasured — recorded, and the grade gate is off");
  if (!composite && !compositeBlocked) reasons.push("composite Signal grade unmeasured — recorded, and the grade gate is off");
  if (websiteBlocked || compositeBlocked) {
    return { ok: false, decision: "skip", reasons, website, composite, ceiling: compositeCeiling, website_ceiling: websiteCeiling };
  }
  if (!website || !composite) {
    // Nothing left to compare, and nothing left blocking. Proceed on the facts.
    return { ok: true, decision: "build", reasons, website, composite, unmeasured: true, ceiling: compositeCeiling, website_ceiling: websiteCeiling };
  }

  const websiteOk = isBuildableGrade(website.grade, websiteCeiling);
  const compositeOk = isBuildableGrade(composite.grade, compositeCeiling);

  if (!websiteOk) reasons.push(`website already grades ${website.grade} — better than the ${websiteCeiling} ceiling, so there is no upgrade to prove`);
  if (!compositeOk) reasons.push(`Signal report already grades ${composite.grade} — better than the ${compositeCeiling} ceiling`);
  if (websiteOk && compositeOk) {
    // Grades are still MEASURED and still reported; they simply no longer
    // refuse. Saying so plainly keeps the funnel honest about why a lead
    // passed — "graded X, gate off" is a different fact from "graded X, and X
    // was under the bar".
    const gate = (c) => (ceilingIsOff(c) ? "gate off" : `at or under ${c}`);
    reasons.push(`website ${website.grade} (${gate(websiteCeiling)}), Signal ${composite.grade} (${gate(compositeCeiling)})`);
  }

  const ok = websiteOk && compositeOk;
  return { ok, decision: ok ? "build" : "skip", reasons, website, composite, ceiling: compositeCeiling, website_ceiling: websiteCeiling };
}

// ===========================================================================
// MINE-TIME MEASUREMENT — both axes, from bytes the miner has already paid for.
// ===========================================================================
//
// WHY THIS EXISTS. qualifyForBuild() is fail-closed on an unmeasured axis, and
// the miner holds no CallPrep report: it therefore skipped 100% of candidates,
// which is the same as not running. The fix is not to relax the gate, it is to
// MEASURE the axes at mine time from evidence we already hold:
//
//   website axis  <- the ONE homepage GET the miner already performs
//                    (lib/site-weakness.js probe + response headers + parsed
//                    <head>). Free. Runs BEFORE any paid call.
//   composite     <- those four categories PLUS the Google Places record
//                    (profile completeness, rating, review count) and the
//                    social links the homepage itself publishes, run through
//                    callprep-enrich's OWN weightedScore(). Runs AFTER the
//                    Places call, on survivors only.
//
// HONESTY BOUNDARY. These are NOT the CallPrep instrument. CallPrep's website
// categories draw half their points from a Lighthouse run and an SSL Labs
// grade, and we buy neither at mine time. So every category below is built
// from named, observed booleans with published weights, is stamped
// `measured_by: "site_probe"` / `"google_places"` / `"first_party_html"`, and
// carries a `signals[]` list naming every point it awarded and why. A reader
// can recompute any score by hand. Nothing here is modelled, inferred or
// defaulted — an unobserved input scores ZERO and is listed in `unmeasured[]`.
//
// DIRECTION OF ERROR. The gate admits a lead when the grade is at or UNDER its
// ceiling, so an under-measured category biases toward admitting. Every category therefore
// reports what it could not observe, and minedComposite() surfaces the whole
// list as `conservative_by[]` so a low composite can never be mistaken for a
// measured one.

const HEADER_POINTS = Object.freeze([
  ["strict-transport-security", 15],
  ["content-security-policy", 15],
  ["x-frame-options", 10],
  ["x-content-type-options", 10],
  ["referrer-policy", 5],
  ["permissions-policy", 5],
]);

function clamp100(value) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** A scored category with its own audit trail. `points` always sums to `score`. */
function category(measuredBy, signals, unmeasured = [], metrics = {}) {
  const kept = signals.filter((s) => s && Number.isFinite(s.points));
  const score = clamp100(kept.reduce((sum, s) => sum + s.points, 0));
  return {
    score,
    grade: gradeForScore(score),
    isLive: true,
    measured_by: measuredBy,
    signals: kept,
    ...(unmeasured.length ? { unmeasured } : {}),
    metrics: { availability: "measured", ...metrics },
  };
}

const sig = (name, points, observed) => ({ name, points, observed });

function headerLookup(headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[String(k).toLowerCase()] = v;
  return (name) => lower[name] != null && String(lower[name]).trim() !== "";
}

/**
 * The four website-axis categories, from the miner's single homepage GET.
 *
 * @param probe   lib/site-weakness.js analyzeWebsite() output (measured).
 * @param headers the response headers of that same GET.
 * @param page    parsed <head>/<body> facts: {title, metaDescription, h1,
 *                jsonLd, openGraph, canonical, bytes, legacyScript}.
 */
function minedWebsiteCategories({ probe = null, headers = {}, page = {} } = {}) {
  if (!probe || probe.analyzed !== true) return null;
  const has = headerLookup(headers);
  const loadMs = Number.isFinite(Number(probe.loadMs)) ? Number(probe.loadMs) : null;
  const bytes = Number.isFinite(Number(page.bytes)) ? Number(page.bytes) : null;
  const words = Number.isFinite(Number(probe.wordCount)) ? Number(probe.wordCount) : null;

  const websitePerformance = category("site_probe", [
    sig("https", probe.https ? 25 : 0, probe.https === true),
    sig("responsive_viewport", probe.mobile ? 25 : 0, probe.mobile === true),
    sig("http_200", probe.status === 200 ? 15 : 0, probe.status),
    loadMs === null ? null
      : sig("response_time", loadMs < 1000 ? 25 : loadMs < 2500 ? 20 : loadMs < 4000 ? 12 : loadMs < 7000 ? 6 : 0, `${loadMs}ms`),
    bytes === null ? null
      : sig("document_weight", bytes < 150000 ? 10 : bytes < 400000 ? 6 : 0, `${bytes}B`),
  ], [
    ...(loadMs === null ? ["response_time"] : []),
    ...(bytes === null ? ["document_weight"] : []),
  ], { loadTime: loadMs === null ? null : loadMs / 1000, hasSSL: probe.https === true, hasViewport: probe.mobile === true });

  const seo = category("first_party_html", [
    sig("title", page.title ? 18 : 0, Boolean(page.title)),
    sig("meta_description", page.metaDescription ? 15 : 0, Boolean(page.metaDescription)),
    sig("h1", page.h1 ? 12 : 0, Boolean(page.h1)),
    sig("json_ld", probe.hasSchema ? 20 : 0, probe.hasSchema === true),
    sig("open_graph", page.openGraph ? 10 : 0, Boolean(page.openGraph)),
    sig("canonical", page.canonical ? 10 : 0, Boolean(page.canonical)),
    words === null ? null : sig("content_depth", words >= 350 ? 15 : words >= 150 ? 7 : 0, `${words} words`),
  ], words === null ? ["content_depth"] : [], {
    hasH1: Boolean(page.h1),
    hasMetaDesc: Boolean(page.metaDescription),
    hasSchema: probe.hasSchema === true,
    hasOpenGraph: Boolean(page.openGraph),
  });

  const security = category("response_headers", [
    sig("https", probe.https ? 40 : 0, probe.https === true),
    ...HEADER_POINTS.map(([name, points]) => sig(name, has(name) ? points : 0, has(name))),
  ], ["ssl_labs_grade"], {
    sslGrade: "not_measured",
    securityHeaders: HEADER_POINTS.filter(([n]) => has(n)).length,
    totalHeaders: HEADER_POINTS.length,
  });

  const technology = category("site_probe", [
    sig("baseline", 50, "every reachable site"),
    sig("modern_framework", page.modernStack ? 30 : 0, Boolean(page.modernStack)),
    sig("diy_site_builder", probe.builder ? -25 : 0, probe.builder || "none"),
    sig("https", probe.https ? 10 : 0, probe.https === true),
    sig("no_legacy_script", page.legacyScript ? 0 : 10, page.legacyScript ? page.legacyScript : "none observed"),
  ], ["cms_fingerprint"], { cms: probe.builder || "Unknown", hosting: "not_measured" });

  return { websitePerformance, seo, security, technology };
}

/**
 * The Google-side categories, from the Places record we buy at the LAST stage.
 * Formulas are callprep-enrich's own (gbpFromPlace / reputationFromPlace); the
 * two terms Places(New) does not give us are scored ZERO and declared.
 */
function minedGoogleCategories(place = {}) {
  if (!place || !place.id) return null;
  const rating = Number(place.rating) || 0;
  const reviewCount = Number(place.userRatingCount) || 0;
  const photoCount = Array.isArray(place.photos) ? place.photos.length : 0;
  const hasHours = Boolean(place.regularOpeningHours && Array.isArray(place.regularOpeningHours.weekdayDescriptions) && place.regularOpeningHours.weekdayDescriptions.length);
  const description = (place.editorialSummary && place.editorialSummary.text) || "";

  const gbpSignals = [
    sig("star_rating", Math.min(25, rating * 5), rating),
    sig("review_volume", Math.min(20, reviewCount * 0.4), reviewCount),
    sig("photos", photoCount > 10 ? 15 : photoCount > 0 ? 10 : 0, photoCount),
    sig("hours_listed", hasHours ? 10 : 0, hasHours),
    sig("operational", place.businessStatus === "OPERATIONAL" ? 10 : 0, place.businessStatus || "unknown"),
    sig("phone_on_profile", place.nationalPhoneNumber ? 5 : 0, Boolean(place.nationalPhoneNumber)),
    sig("profile_description", description ? 5 : 0, Boolean(description)),
  ];
  const googleBusinessProfile = category("google_places", gbpSignals, ["gbp_completeness_percentage"], {
    starRating: rating, reviewCount, photoCount, hoursListed: hasHours,
    phone: place.nationalPhoneNumber || "",
  });
  // callprep's own cap: a profile with no website can never read as complete.
  if (!place.websiteUri && googleBusinessProfile.score > 65) {
    googleBusinessProfile.score = 65;
    googleBusinessProfile.grade = gradeForScore(65);
    googleBusinessProfile.signals.push(sig("no_website_cap", 0, "capped at 65 — no website on the profile"));
  }

  // Verbatim reuse of the app's exported reputation formula. Owner-response
  // data is not in the public API, so `negatives` is 0 and declared.
  const repScore = scoreReputationFromGoogleSignals(reviewCount, rating, 0);
  const onlineReputation = {
    score: repScore,
    grade: gradeForScore(repScore),
    isLive: true,
    measured_by: "google_places",
    signals: [sig("scoreReputationFromGoogleSignals", repScore, `${reviewCount} reviews @ ${rating}`)],
    unmeasured: ["owner_response_rate", "negative_review_triage"],
    metrics: { availability: "measured", totalReviews: reviewCount, avgRating: rating, responseRate: null },
  };
  return { googleBusinessProfile, onlineReputation };
}

const SOCIAL_POINTS = Object.freeze([
  ["facebook", 20], ["instagram", 20], ["linkedin", 15],
  ["youtube", 10], ["tiktok", 10], ["twitter", 5], ["yelp", 5],
]);

/** socialMedia, from the outbound links the prospect's OWN homepage publishes. */
function minedSocialCategory(links = null) {
  if (!links) return null;
  const signals = [sig("baseline", 20, "a reachable homepage")];
  for (const [key, points] of SOCIAL_POINTS) {
    signals.push(sig(key, links[key] ? points : 0, links[key] || false));
  }
  return category("first_party_html", signals, ["posting_frequency"], {
    socialLinksCount: SOCIAL_POINTS.filter(([k]) => links[k]).length,
    socialLinksTotal: SOCIAL_POINTS.length,
    ...Object.fromEntries(SOCIAL_POINTS.map(([k]) => [`${k}Url`, links[k] || ""])),
  });
}

/** geo, ported from callprep-enrich geoReadiness() over our measured metrics. */
function minedGeoCategory(categories = {}) {
  const { seo, websitePerformance: web, googleBusinessProfile: gbp, socialMedia } = categories;
  if (!seo || !web || !gbp) return null;
  const hasSchema = (seo.metrics || {}).hasSchema === true;
  const hasMetaDesc = (seo.metrics || {}).hasMetaDesc === true;
  const responsive = (web.metrics || {}).hasViewport === true;
  const reviewCount = Number((gbp.metrics || {}).reviewCount) || 0;
  const socialSignals = Number((socialMedia && socialMedia.metrics && socialMedia.metrics.socialLinksCount) || 0);
  return category("derived_from_measured_categories", [
    sig("structured_data", hasSchema ? 25 : 0, hasSchema),
    sig("mobile_ready", responsive ? 20 : 0, responsive),
    sig("answerable_metadata", hasSchema && hasMetaDesc ? 15 : 0, hasSchema && hasMetaDesc),
    sig("review_depth", Math.min(15, Math.round(Math.log2(Math.max(1, reviewCount)) * 2)), reviewCount),
    sig("nap_phone", (gbp.metrics || {}).phone ? 5 : 0, Boolean((gbp.metrics || {}).phone)),
    sig("nap_hours", (gbp.metrics || {}).hoursListed ? 5 : 0, (gbp.metrics || {}).hoursListed === true),
    sig("social_proof", Math.min(10, Math.round(socialSignals * 1.5)), socialSignals),
  ], ["domain_age"], {});
}

/**
 * FREE AXIS. The website-only verdict, computed before a cent is spent.
 * Returns {ok, decision, reasons[], website} — `ok:false` is a hard stop.
 */
function qualifyWebsiteAxis({ probe = null, categories = null, env = process.env } = {}) {
  // Resolved once per call and returned on EVERY branch, so the caller can put
  // the number that actually decided this lead into the funnel and the record.
  const ceiling = maxBuildableWebsiteGrade(env);
  if (probe && probe.exists === false) {
    return { ok: true, decision: "build", axis: "website", website: null, ceiling, reasons: ["no website on their profile — every mirror is an upgrade"] };
  }
  if (probe && probe.modernPremium === true && modernPremiumVetoActive(env)) {
    return { ok: false, decision: "skip", axis: "website", website: null, ceiling, reasons: ["already has a modern, responsive, well-built site — not our buyer"] };
  }
  const website = websiteAxisScore(categories || {});
  if (!website) {
    // UNMEASURED, WITH THE GATE OFF, IS NOT A REFUSAL.
    //
    // "cannot prove the mirror is an upgrade" was the right sentence while a
    // ceiling was being enforced: you cannot show a grade sits under a bar you
    // were unable to compute. With no bar there is nothing to prove, and
    // refusing here would be the gate the owner removed still quietly firing —
    // under a different name, which is worse than firing openly.
    //
    // What actually protects the spend is upstream and unchanged: stage 2
    // refuses a site we could not fetch, stage 6 refuses NAP we could not
    // verify against Google, and the brand gate refuses a logo we could not
    // resolve. A missing SCORE is a scoring gap, not blindness about the lead.
    if (ceilingIsOff(ceiling)) {
      return {
        ok: true, decision: "build", axis: "website", website: null, ceiling,
        unmeasured: true,
        reasons: ["website axis unmeasured — recorded as unmeasured, and the grade gate is off"],
      };
    }
    return { ok: false, decision: "skip", axis: "website", website: null, ceiling, unmeasured: true, reasons: [`website axis unmeasured — cannot prove it sits under the ${ceiling} ceiling`] };
  }
  const ok = isBuildableGrade(website.grade, ceiling);
  return {
    ok, decision: ok ? "build" : "skip", axis: "website", website, ceiling,
    // Both reasons name the REAL measured grade and score plus the ceiling that
    // judged it. Relaxing the number is a business preference; hiding which
    // number was applied would make the funnel unauditable.
    reasons: [ok
      ? (ceilingIsOff(ceiling)
        ? `website axis grades ${website.grade} (${website.score}) — measured, and the grade gate is off`
        : `website axis grades ${website.grade} (${website.score}) — at or under the ${ceiling} ceiling`)
      : `website axis already grades ${website.grade} (${website.score}) — better than the ${ceiling} ceiling, so there is no upgrade to prove`],
  };
}

/**
 * PAID AXIS. The composite Signal verdict, over the full measured category set,
 * using callprep-enrich's OWN weightedScore(). Returns {ok, composite, ...}.
 */
function minedComposite(categories = {}) {
  const score = weightedScore(categories);
  if (score === null) return null;
  const conservative = [];
  for (const [key, cat] of Object.entries(categories)) {
    for (const miss of (cat && cat.unmeasured) || []) conservative.push(`${key}.${miss}`);
  }
  return {
    score,
    grade: gradeForScore(score),
    weighted_by: "callprep-enrich CATEGORY_WEIGHTS",
    categories_measured: Object.keys(categories),
    conservative_by: conservative,
  };
}

function qualifyCompositeAxis(composite, env = process.env) {
  const ceiling = maxBuildableCompositeGrade(env);
  if (!composite) {
    // Same rule as the website axis, and it matters more here: by the time this
    // runs we have fetched their page, verified their NAP against Google and
    // resolved their logo. We have looked at this business closely. Losing the
    // lead over a summary number we could not total would be absurd.
    if (ceilingIsOff(ceiling)) {
      return {
        ok: true, decision: "build", axis: "composite", composite: null, ceiling,
        unmeasured: true,
        reasons: ["composite Signal grade unmeasured — recorded as unmeasured, and the grade gate is off"],
      };
    }
    return { ok: false, decision: "skip", axis: "composite", composite: null, ceiling, unmeasured: true, reasons: [`composite Signal grade unmeasured — cannot prove it sits under the ${ceiling} ceiling`] };
  }
  const ok = isBuildableGrade(composite.grade, ceiling);
  return {
    ok, decision: ok ? "build" : "skip", axis: "composite", composite, ceiling,
    reasons: [ok
      ? (ceilingIsOff(ceiling)
        ? `composite Signal grades ${composite.grade} (${composite.score}) — measured, and the grade gate is off`
        : `composite Signal grades ${composite.grade} (${composite.score}) — at or under ${ceiling}`)
      : `composite Signal already grades ${composite.grade} (${composite.score}) — better than ${ceiling}`],
  };
}

module.exports = {
  GRADE_ORDER,
  MAX_BUILDABLE_GRADE,
  DEFAULT_MAX_WEBSITE_GRADE,
  DEFAULT_MAX_COMPOSITE_GRADE,
  COMPOSITE_CEILING_ENV,
  MODERN_PREMIUM_ENV,
  maxBuildableCompositeGrade,
  modernPremiumVetoActive,
  ceilingIsOff,
  WEBSITE_CEILING_ENV,
  WEBSITE_AXIS_WEIGHTS,
  gradeRank,
  gradeSlug,
  maxBuildableWebsiteGrade,
  isBuildableGrade,
  websiteAxisScore,
  qualifyForBuild,
  // mine-time measurement
  HEADER_POINTS,
  SOCIAL_POINTS,
  minedWebsiteCategories,
  minedGoogleCategories,
  minedSocialCategory,
  minedGeoCategory,
  minedComposite,
  qualifyWebsiteAxis,
  qualifyCompositeAxis,
};
