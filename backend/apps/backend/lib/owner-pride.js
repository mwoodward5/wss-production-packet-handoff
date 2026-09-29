"use strict";
// lib/owner-pride.js — the owner's pride points, made renderable.
//
// WHY THIS EXISTS. We audited two rebuilds against the originals
// (docs/owner-behind/owner-behind-audit-report.md) and both FAILED: the
// template preserved broad service labels and dropped exactly the things the
// owner would fight for — "Creating comfort for your family!", the Silver and
// Gold plans with their real prices, the authorized-Daikin relationship, the
// insurance-claim niche, family-owned-since-2011, the live promotions, and a
// twelve-city footprint collapsed to one town. A beautiful shell with a
// generic business inside it. The owner's words for the fix: "make sure these
// are in the site."
//
// WHAT THIS MODULE DOES. It takes an owner-behind-v2 extraction (the schema in
// docs/owner-behind/owner-behind-v2.schema.json — every field carries status /
// confidence / evidence quotes with source URLs) and reduces it to a PRIDE
// BLOCK: only the entries a site may honestly render. The acceptance rule is
// the whole point:
//
//     status FOUND  +  confidence not "low"  +  at least one evidence entry
//     ⇒ renderable, VERBATIM.   Anything else ⇒ omitted. Never paraphrased,
//     never "improved", never defaulted.
//
// MANUFACTURER BADGES ARE A LANDMINE this codebase has already stepped on:
// live mirrors once served Mastercool's and Google's marks as the CLIENT'S
// identity with every gate green (memory: manufacturer-badge-as-logo). So a
// partnership here is emitted as a LABELED CREDENTIAL ("Authorized Daikin
// Dealer") — text first, and an image only when the badge asset is hosted on
// the client's own registrable domain. It must never enter the logo/identity
// path, and the shape emitted here (kind: "credential") makes that explicit.
//
// PLACE NAMES: the numbered-towns P0 ("9, LA" rendered as a town) is being
// fixed at the engine; this module applies the same plausibility rule on its
// own output so a bad extraction cannot re-introduce it from a second door.

const MAX_ITEMS = {
  // Raised to the mirror-request schema caps (credentials 24, differentiators
  // 24, promotions 12, plans 12) by the owner's directive: "If they have more
  // content than we can handle, we still dump it in." This reducer used to cut
  // a proud business at 6/6/4/4 BEFORE the schema ever saw the content.
  differentiators: 24,
  plans: 12,
  promos: 12,
  badges: 24,
  cities: 16,
  regions: 6,
};

function plausiblePlaceName(value) {
  const s = String(value || "").trim();
  if (!s || s.length < 3 || s.length > 40) return false;
  if (/^\d+[\s,]*/.test(s)) return false;            // "9, LA"
  if (/^[A-Z]{2}$/.test(s)) return false;            // a lone state code
  if (/[{}[\]<>]|\{\{/.test(s)) return false;        // template tokens
  if (!/[a-zA-Z]{3}/.test(s)) return false;          // must contain a real word
  return true;
}

function accepted(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (String(entry.status || "").toUpperCase() !== "FOUND") return false;
  if (String(entry.confidence || "").toLowerCase() === "low") return false;
  return Array.isArray(entry.evidence) && entry.evidence.length > 0;
}

// AUDITOR COMMENTARY IS A NOTE ABOUT ABSENCE, NOT A FACT ABOUT THE CLIENT.
// The extraction narrates what it could not find inside the value it did find
// — "…; no explicit 24/7 promise", "no lender, APR, term … found" — and every
// one of those sentences is written in OUR voice about THEIR site. Published,
// it reads as a business advertising what it does not offer. This is the same
// filter the credentials branch has always applied; it lives at module scope
// now because differentiators, financing and promotions leak the identical
// class of sentence (Air Creation shipped both examples above).
const ABSENCE_NOTE = /(not found|no explicit|no lender|unable to|none found|not stated|not disclosed)/i;

// A field whose value is the boolean TRUE is asserting the claim its NAME
// makes. "true" rendered on a page is meaningless; "Clear upfront pricing" is
// the claim, in words, with the same evidence behind it. FALSE is not a claim
// at all and is dropped. (owner-pride already did this for licensed_and_insured
// and factory_trained_technicians; three of Air Creation's six differentiators
// arrived as the bare string "true" and would have shipped that way.)
function isBooleanish(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  return s === "true" || s === "false" || s === "yes" || s === "no";
}
function isAffirmative(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  return s === "true" || s === "yes";
}

/** snake_case field name -> the claim it makes, in words. */
function humanizeKey(key) {
  const s = String(key || "").replace(/_/g, " ").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function firstProof(entry) {
  const e = (entry.evidence || [])[0] || {};
  return { source: String(e.source_url || ""), quote: String(e.quote || "") };
}

function cleanString(entry, maxLen = 160) {
  if (!accepted(entry)) return null;
  const v = String(entry.value == null ? "" : entry.value).trim();
  if (!v || v === "NOT FOUND" || v.length > maxLen) return null;
  return { value: v, proof: firstProof(entry) };
}

function registrableOf(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    const parts = host.split(".");
    return parts.slice(-2).join(".");
  } catch { return ""; }
}

/**
 * prideFromExtraction(extraction, { clientDomain }) -> pride block | null
 *
 * The returned block is what a donor may render, section by section. Every
 * item carries its proof (source URL + short quote) so downstream gates can
 * re-verify without re-crawling. `null` means the extraction offered nothing
 * renderable — a site without a pride block is honest; a site with an invented
 * one is not.
 */
function prideFromExtraction(extraction, { clientDomain = "" } = {}) {
  if (!extraction || typeof extraction !== "object") return null;
  const A = extraction.A_identity_brand_equity || {};
  const B = extraction.B_credentials_and_trust || {};
  const C = extraction.C_differentiators || {};
  const E = extraction.E_productized_offers_and_pricing || {};
  const G = extraction.G_service_area_and_locations || {};
  const ownDomain = registrableOf(`https://${clientDomain}`) || registrableOf(clientDomain);

  const out = { schema: "owner-pride-v1", sections: {} };

  // -- identity -------------------------------------------------------------
  const tagline = cleanString(A.tagline_or_motto, 120);
  if (tagline && !ABSENCE_NOTE.test(tagline.value)) out.sections.tagline = tagline;
  const since = cleanString(A.years_in_business_or_since, 80)
    || cleanString(A.since_year, 80) || cleanString(A.founded, 80);
  // A BARE YEAR IS NOT A SENTENCE. `since_year: 2011` reached identity-copy's
  // line C as the whole of the heritage line and would have printed "2011." in
  // the hero. The field states what the number means; naming it is the same
  // rule the credentials branch uses for a bare licence number.
  if (since && !ABSENCE_NOTE.test(since.value)) {
    if (/^(19|20)\d{2}$/.test(since.value)) since.value = `Since ${since.value}`;
    out.sections.heritage = since;
  }
  // `family_owned: true` is how the live extraction actually carries it — the
  // two names guessed here matched nothing, which is how "family-owned since
  // 2011" (named in the audit report as a dropped pride point) vanished twice.
  const family = cleanString(A.family_or_veteran_or_woman_owned, 80)
    || cleanString(A.ownership_identity, 80)
    || cleanString(A.family_owned, 80)
    || cleanString(A.veteran_owned, 80)
    || cleanString(A.woman_owned, 80);
  if (family && !ABSENCE_NOTE.test(family.value)) {
    if (isBooleanish(family.value)) {
      if (!isAffirmative(family.value)) {
        // not a claim
      } else {
        const key = ["family_or_veteran_or_woman_owned", "ownership_identity", "family_owned", "veteran_owned", "woman_owned"]
          .find((k) => A[k] && cleanString(A[k], 80));
        const word = key === "veteran_owned" ? "Veteran-Owned"
          : key === "woman_owned" ? "Woman-Owned" : "Family-Owned";
        out.sections.ownership = { value: word, proof: family.proof };
      }
    } else {
      out.sections.ownership = family;
    }
  }

  // -- credentials / manufacturer partnerships ------------------------------
  const badges = [];
  for (const key of [
    // the schema's real field names, learned from the live extraction —
    // "manufacturer_partnerships" was a guess and matched nothing, which is
    // how the Daikin badge (the flagship credential) silently vanished.
    "authorized_manufacturer_relationships", "manufacturer_partnerships",
    "certifications", "factory_trained_technicians", "license_number",
    "bbb_rating", "guarantee_or_warranty", "licensed_and_insured",
  ]) {
    const list = Array.isArray(B[key]) ? B[key] : (B[key] ? [B[key]] : []);
    for (const entry of list) {
      const got = cleanString(entry.value && typeof entry.value === "object"
        ? { ...entry, value: entry.value.name || entry.value.label || JSON.stringify(entry.value).slice(0, 60) }
        : entry, 80);
      if (!got) continue;
      // NAME THE FACT, don't print the datum. A raw boolean rendered "true"
      // and a bare "56179" chip on the first live run — technically sourced,
      // humanly meaningless. Each field states its claim in words; auditor
      // commentary (".. not found", "no explicit ..") is a note about absence
      // and must never render as a credential.
      if (ABSENCE_NOTE.test(got.value)) continue;
      if (key === "licensed_and_insured") got.value = "Licensed & Insured";
      else if (key === "factory_trained_technicians") got.value = "Factory-Trained Technicians";
      else if (key === "license_number") got.value = "License #" + got.value.replace(/^#/, "");
      else if (key === "bbb_rating") got.value = "BBB Rating " + got.value;
      else if (got.value === "true" || got.value === "false") continue;
      const assetUrl = String((entry.value && entry.value.badge_url) || entry.badge_url || "");
      const assetOwned = assetUrl && ownDomain && registrableOf(assetUrl) === ownDomain;
      badges.push({
        kind: "credential",           // NEVER identity. See the header comment.
        label: got.value,
        // an image only when the client hosts it; otherwise text-only chip
        image: assetOwned ? assetUrl : "",
        proof: got.proof,
      });
      if (badges.length >= MAX_ITEMS.badges) break;
    }
    if (badges.length >= MAX_ITEMS.badges) break;
  }
  if (badges.length) out.sections.credentials = badges;

  // -- differentiators ------------------------------------------------------
  const diffs = [];
  for (const [key, entry] of Object.entries(C)) {
    const got = cleanString(entry, 140);
    if (!got) continue;
    // Same two rules as the credentials branch, for the same two reasons: a
    // sentence about what the auditor could NOT find is not the client's
    // claim, and a bare boolean is not readable. Air Creation's extraction
    // carries three of each in this very section.
    if (ABSENCE_NOTE.test(got.value)) continue;
    if (isBooleanish(got.value)) {
      if (!isAffirmative(got.value)) continue;
      got.value = humanizeKey(key);
      if (!got.value) continue;
    }
    diffs.push({ key, text: got.value, proof: got.proof });
    if (diffs.length >= MAX_ITEMS.differentiators) break;
  }
  if (diffs.length) out.sections.differentiators = diffs;

  // -- plans (verbatim economics or nothing) --------------------------------
  const plans = [];
  for (const entry of Array.isArray(E.maintenance_plans) ? E.maintenance_plans : []) {
    if (!accepted(entry) || !entry.value || typeof entry.value !== "object") continue;
    const v = entry.value;
    if (!v.name || !v.price) continue; // a plan without its real price is not a plan we print
    plans.push({
      name: String(v.name).slice(0, 60),
      price: String(v.price).slice(0, 60),
      details: Object.entries(v)
        .filter(([k]) => !["name", "price"].includes(k))
        .map(([k, val]) => `${k.replace(/_/g, " ")}: ${String(val).slice(0, 60)}`)
        .slice(0, 5),
      proof: firstProof(entry),
    });
    if (plans.length >= MAX_ITEMS.plans) break;
  }
  if (plans.length) out.sections.plans = plans;

  // -- promotions (real amounts only; terms are the owner's to add) ---------
  const promos = [];
  for (const key of ["promotions", "coupons", "current_offers"]) {
    const list = Array.isArray(E[key]) ? E[key] : [];
    for (const entry of list) {
      const got = cleanString(typeof entry.value === "object"
        ? { ...entry, value: entry.value.text || entry.value.offer || entry.value.name }
        : entry, 120);
      if (got && !ABSENCE_NOTE.test(got.value) && !isBooleanish(got.value)) {
        promos.push({ text: got.value, proof: got.proof });
      }
      if (promos.length >= MAX_ITEMS.promos) break;
    }
  }
  if (promos.length) out.sections.promotions = promos;

  // -- financing ------------------------------------------------------------
  const financing = cleanString(E.financing, 120) || cleanString(C.financing, 120);
  if (financing && !ABSENCE_NOTE.test(financing.value) && !isBooleanish(financing.value)) {
    out.sections.financing = financing;
  }

  // -- footprint (plausible names only — the numbered-towns rule) -----------
  const cities = [];
  for (const key of ["cities", "named_towns", "exact_named_nearby_towns", "service_cities"]) {
    const entry = G[key];
    const list = Array.isArray(entry) ? entry
      : (accepted(entry) && Array.isArray(entry.value) ? entry.value : []);
    for (const item of list) {
      const name = typeof item === "string" ? item
        : (item && (item.value || item.name)) || "";
      if (plausiblePlaceName(name) && !cities.includes(String(name).trim())) {
        cities.push(String(name).trim());
      }
      if (cities.length >= MAX_ITEMS.cities) break;
    }
    if (cities.length) break;
  }
  const regions = [];
  for (const key of ["parishes", "counties", "regions"]) {
    const entry = G[key];
    const list = Array.isArray(entry) ? entry
      : (accepted(entry) && Array.isArray(entry.value) ? entry.value : []);
    for (const item of list) {
      const name = typeof item === "string" ? item : (item && (item.value || item.name)) || "";
      if (plausiblePlaceName(name) && !regions.includes(String(name).trim())) {
        regions.push(String(name).trim());
      }
      if (regions.length >= MAX_ITEMS.regions) break;
    }
    if (regions.length) break;
  }
  if (cities.length || regions.length) out.sections.footprint = { cities, regions };

  return Object.keys(out.sections).length ? out : null;
}

module.exports = { prideFromExtraction, plausiblePlaceName };
