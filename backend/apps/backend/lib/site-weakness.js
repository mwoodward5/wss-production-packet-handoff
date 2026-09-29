"use strict";

// lib/site-weakness.js — MEASURE how bad a prospect's current website is.
//
// asset-pipeline/opportunity-score.mjs already implements the right thesis:
// score = sqrt(demand * weakness) * affordability, so a business with real
// money AND a bad site rises to the top. But the weakness axis was being fed
// fabricated inputs — lead-miner's opportunityInputFromRow hardcoded
// `status: 200` and `runningAds: false` and never looked at mobile, speed,
// thinness or age. With weakness pinned near its 20-point floor, the geometric
// mean flattened and the ranking degenerated into "who has the fewest
// reviews", which is the opposite of the target buyer.
//
// This module turns the HTML the miner ALREADY fetches (for email extraction)
// into the real signals. No extra network cost for the common path.
//
// Every signal is an observation with a reason string, so a lead's score can
// always be explained to the owner: "400 reviews, 4.8 stars, GoDaddy site with
// no mobile viewport and 6s load" is a pitch, not a number.

const BUILDER_HOST = /wix\.com|wixsite|godaddysites|secureserver|weebly|squarespace|site123|business\.site|wordpress\.com|webnode|jimdo|homestead|networksolutions|yolasite|tripod|angelfire/i;
const BUILDER_MARKUP = /wix-?(?:code|dropdown|image)|_wixCss|godaddy|weebly|squarespace|site123|duda|bandzoogle|elementor|divi|wpbakery|visual composer/i;
const MODERN_STACK = /__NEXT_DATA__|__NUXT__|astro-island|data-svelte|data-reactroot|_app-|\/_next\/|gatsby|remix-|vite/i;

/**
 * analyzeWebsite({ url, status, html, elapsedMs, ok, failure })
 * -> the exact shape asset-pipeline/opportunity-score.mjs weaknessScore()
 *    consumes, plus `signals[]` explaining each finding in words.
 *
 * A site we could not fetch is NOT treated as a good site: a dead or blocked
 * site is a strong opening (that is the point of the pitch), so status>=400 or
 * a hard failure reports high weakness rather than defaulting to healthy.
 */
function analyzeWebsite({ url = "", status = null, html = "", elapsedMs = null, ok = null, failure = null } = {}) {
  const signals = [];
  const site = String(url || "").trim();

  if (!site) {
    return {
      exists: false, status: null, https: false, mobile: null, thin: null,
      hasSchema: null, hasReviews: null, builder: "", loadMs: null,
      ageYears: null, modernPremium: false,
      signals: ["no website on their Google profile"],
      analyzed: false,
    };
  }

  const httpsOk = /^https:\/\//i.test(site);
  if (!httpsOk) signals.push("no HTTPS — browsers warn visitors");

  // A fetch that failed is evidence, not an absence of evidence.
  const httpStatus = Number.isFinite(Number(status)) ? Number(status) : (ok === false ? 599 : null);
  if (httpStatus && httpStatus >= 400) signals.push(`site returns HTTP ${httpStatus} — broken or gone`);
  else if (ok === false && failure) signals.push(`site unreachable (${failure})`);

  const body = String(html || "");
  const analyzed = body.length > 0;

  // Mobile: a missing viewport meta is the classic pre-responsive tell.
  let mobile = null;
  if (analyzed) {
    mobile = /<meta[^>]+name=["']viewport["'][^>]*content=["'][^"']*width\s*=\s*device-width/i.test(body);
    if (!mobile) signals.push("no mobile viewport — the site does not adapt to phones");
  }

  // Thin: strip tags/scripts and count real words. Most weak local sites are
  // a hero image and a phone number.
  let thin = null;
  let wordCount = null;
  if (analyzed) {
    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ");
    wordCount = (text.match(/\b[a-z']{2,}\b/gi) || []).length;
    thin = wordCount < 350;
    if (thin) signals.push(`thin content — about ${wordCount} words on the homepage`);
  }

  // Structured data + review proof: both are ranking/AEO gaps we can close.
  let hasSchema = null;
  let hasReviews = null;
  if (analyzed) {
    hasSchema = /application\/ld\+json/i.test(body) || /itemtype=["']https?:\/\/schema\.org/i.test(body);
    if (!hasSchema) signals.push("no structured data — invisible to AI answers and rich results");
    hasReviews = /\breview|testimonial|★|stars?\b/i.test(body);
    if (!hasReviews) signals.push("no reviews or testimonials shown on the site");
  }

  // Builder: from the URL host first (cheap, reliable), then from markup.
  let builder = "";
  const hostMatch = site.match(BUILDER_HOST);
  if (hostMatch) builder = hostMatch[0].toLowerCase();
  else if (analyzed) {
    const markupMatch = body.match(BUILDER_MARKUP);
    if (markupMatch) builder = markupMatch[0].toLowerCase();
  }
  if (builder) signals.push(`built on ${builder} — DIY template, upgradeable`);

  // Ad-tracking on the page = they demonstrably pay to be found (affordability
  // signal). Google Ads / gtag conversion, Meta pixel, or UTM plumbing.
  let runningAds = null;
  if (analyzed) {
    runningAds = /googleadservices|goog.*conversion|gtag\/js|AW-\d|fbevents\.js|fbq\(|utm_source|utm_campaign|doubleclick/i.test(body);
    if (runningAds) signals.push("runs paid ads — already pays to be found, but the site underdelivers");
  }

  const loadMs = Number.isFinite(Number(elapsedMs)) ? Number(elapsedMs) : null;
  if (loadMs && loadMs > 4000) signals.push(`slow — homepage took ${(loadMs / 1000).toFixed(1)}s to respond`);

  // Copyright year is a decent proxy for "nobody has touched this in years".
  let ageYears = null;
  if (analyzed) {
    const years = [...body.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,12}((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
    if (years.length) {
      const newest = Math.max(...years);
      const nowYear = new Date().getUTCFullYear();
      if (newest >= 1990 && newest <= nowYear) {
        ageYears = nowYear - newest;
        if (ageYears >= 4) signals.push(`copyright still says ${newest} — stale for ${ageYears} years`);
      }
    }
  }

  // modernPremium caps weakness so we do not pitch someone who already has a
  // great site. Requires a modern framework AND responsive AND real depth.
  const modernPremium = Boolean(analyzed && mobile && !thin && hasSchema && MODERN_STACK.test(body) && !builder);
  if (modernPremium) signals.push("already has a modern, well-built site — not our buyer");

  return {
    exists: true,
    status: httpStatus,
    https: httpsOk,
    mobile,
    thin,
    hasSchema,
    hasReviews,
    builder,
    loadMs,
    ageYears,
    modernPremium,
    runningAds,
    wordCount,
    signals,
    analyzed,
  };
}

/**
 * Days since the most recent Google review, from the Places `reviews` array.
 * Feeds demandScore's recency factor — "are they earning business NOW".
 */
function reviewRecencyDays(reviews = []) {
  const times = (Array.isArray(reviews) ? reviews : [])
    .map((r) => Date.parse((r && (r.publishTime || r.relativePublishTimeDescription)) || ""))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return Math.max(0, Math.round((Date.now() - Math.max(...times)) / 86400000));
}

module.exports = { analyzeWebsite, reviewRecencyDays, BUILDER_HOST, MODERN_STACK };
