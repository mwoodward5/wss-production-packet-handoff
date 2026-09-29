"use strict";

// lib/mirror-engine/trust-layer.js — THE TRUST LAYER PLANNERS (VERBATIM-PARITY).
//
// The owner doctrine this layer ships: "Google-reviews SCROLLING CAROUSEL on
// every site + trust signals shown off better." The CLONE lane already renders
// it (lib/clone-sections.js buildCloneReviews/Trust + fleet-polish's
// cloneInteractionCss: a seamless marquee, wssStarPop stars, floating trust
// tiles). This module brings the same treatment to TEMPLATE sites — the
// builds with no clone manifest — through three honest modes and one band:
//
//   · marqueePlan(reviews)   — the scrolling reviews carousel. Only reviews the
//     caller already proved (per-review provenance is gated UPSTREAM at the
//     intake seams — validProvenance "google_places_api" in mirror-lane-build,
//     verifiedReviews in from-genie) may reach here; this module adds nothing,
//     rewords nothing, and invents no star.
//   · ratingStripPlan(facts) — reviews absent but the verified GBP aggregate
//     known: ONE rating badge strip, never a fabricated quote to fill the gap.
//   · (neither)              — null. NO SECTION. Absence is the honest render.
//   · trustFloatItems(...)   — the floating chip band, from the same gated
//     facts the clone trust band reads (license / insured / associations /
//     founded year).
//   · socialRowItems(facts)  — the provenance-checked socials (request.facts
//     schema requires own_site_link / named_match provenance upstream).
//
// EVERYTHING HERE IS PURE AND DETERMINISTIC: the same inputs produce byte-
// identical plans — the marquee speed is a function of the card count, the
// item order is the caller's order — so two builds of one packet ship the
// same bytes. These are PLANNERS, not renderers: they return data, the
// content-inject seam renders it with the page's own escaping and glyphs.

const MAX_MARQUEE_REVIEWS = 12;
const FOUNDED_MIN_YEAR = 1800;
const MAX_ASSOCIATIONS = 12;

function clean(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
}

/**
 * marqueePlan(reviews) -> { cards, speedSeconds } | null
 *
 * cards: [{ text, author?, rating? }] — text required; a review with no text
 * is not a review. rating is rounded into the 1..5 star count only when the
 * caller carried one (star count if carried — never invented, never averaged).
 * speedSeconds = 18 + 6·cards: one pure function of the plan, so the loop is
 * slower as the strip gets longer and two identical packets animate alike.
 */
function marqueePlan(reviews = []) {
  const list = Array.isArray(reviews) ? reviews : [];
  const cards = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const text = clean(r.text);
    if (!text) continue;
    const author = clean(r.author);
    const raw = Number(r.rating);
    const rating = Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.min(5, Math.round(raw))) : 0;
    cards.push({ text, ...(author ? { author } : {}), ...(rating ? { rating } : {}) });
    if (cards.length >= MAX_MARQUEE_REVIEWS) break;
  }
  if (!cards.length) return null;
  return { cards, speedSeconds: 18 + cards.length * 6 };
}

/**
 * ratingStripPlan(facts) -> { rating, count } | null
 *
 * THE MIDDLE HONEST MODE. Both numerals, or neither — the same bar
 * from-genie's verifiedReviews gate and local-seo's aggregateRating gate
 * enforce, kept identical on purpose so the three cannot drift. A rating with
 * no count behind it is not evidence; neither is a count with no rating.
 */
function ratingStripPlan(facts = {}) {
  const f = facts && typeof facts === "object" ? facts : {};
  const rating = Number(f.rating);
  const count = Number(f.review_count);
  const ok = Number.isFinite(rating) && rating > 0 && rating <= 5
    && Number.isFinite(count) && count > 0;
  return ok ? { rating, count: Math.trunc(count) } : null;
}

/**
 * trustFloatItems(facts, content) -> [{ kind, value? }]
 *
 * The floating chip band's contents, from the SAME gated inputs the clone
 * trust band reads (buildCloneTrust): a verified licence number, the insured
 * flag (true only — "false" renders nothing, an unproven claim is absent),
 * association names, and the founded year when the caller carried one.
 * Deduped and order-stable; [] means NO BAND.
 */
function trustFloatItems(facts = {}, content = {}) {
  const f = facts && typeof facts === "object" ? facts : {};
  const c = content && typeof content === "object" ? content : {};
  const items = [];
  const seen = new Set();
  const push = (kind, value) => {
    const key = `${kind}|${clean(value).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ kind, ...(value !== undefined ? { value } : {}) });
  };
  const license = clean(f.license_number);
  if (license) push("license", license);
  if (f.insured === true) push("insured");
  for (const a of Array.isArray(f.associations) ? f.associations : []) {
    const name = clean(typeof a === "string" ? a : (a && a.name));
    if (!name) continue;
    push("association", name);
    if (items.length - (license ? 1 : 0) - (f.insured === true ? 1 : 0) >= MAX_ASSOCIATIONS) break;
  }
  const founded = Number(c.founded_year);
  const currentYear = new Date().getUTCFullYear();
  if (Number.isInteger(founded) && founded >= FOUNDED_MIN_YEAR && founded <= currentYear) {
    push("founded", String(founded));
  }
  return items;
}

/**
 * socialRowItems(facts) -> [{ network, url, label, handle? }]
 *
 * The socials row's contents. facts.socials reached the request only through
 * the schema's provenance gate (own_site_link / named_match upstream); here a
 * profile needs a network key and an https URL — an http profile would be a
 * mixed-content downgrade handed to the visitor, so it is dropped, and one
 * row per network wins in the caller's order.
 */
function socialRowItems(facts = {}) {
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(facts && facts.socials) ? facts.socials : []) {
    const network = clean(raw && raw.network).toLowerCase();
    const url = clean(raw && raw.url);
    if (!network || !url || !/^https:\/\//i.test(url)) continue;
    if (seen.has(network)) continue;
    seen.add(network);
    const label = clean(raw && raw.label) || network.charAt(0).toUpperCase() + network.slice(1);
    const handle = clean(raw && raw.handle);
    items.push({ network, url, label, ...(handle ? { handle } : {}) });
  }
  return items;
}

module.exports = {
  MAX_MARQUEE_REVIEWS,
  marqueePlan,
  ratingStripPlan,
  trustFloatItems,
  socialRowItems,
};
