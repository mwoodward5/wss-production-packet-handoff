"use strict";

// lib/mirror-engine/identity-copy.js — the words that say WHOSE site this is.
//
// FLEET AUDIT 2026-09-02: the roofing mirror shipped the h1
//   "Roofers. Roofing in Naples, FL. Absolute Roofing of Southwest Florida."
// — three fragments stacked into one headline (a one-word stub motto, the
// trade-and-city line, then the name the postcondition appended), and the
// general-contractor mirror shipped the client's own sloppy casing verbatim:
// "General Contractor In Sacramento, Ca.". The composer below therefore
// publishes under three hygiene rules, on top of the truth rules it always
// had: a motto is at least two words (one word is a fragment, not a slogan),
// a motto's CASE and STATE-CODE FORMAT are normalized at publish time (case
// is presentation, not a word changed — "In" → "in", ", Ca." → ", CA"), and
// a REPEATED-fragment stack — the trade word appearing in both the
// trade-and-city line and the business name across three or more clipped
// sentences — is rebuilt from the factual atoms (name, trade-and-city).
//
// MEASURED 2026-08-11, on the 80 built-and-unsent mirrors:
//
//   · all 32 HVAC mirrors render the byte-identical h1
//       "When the summer heat / breaks the rules, / we hold the line."
//     — a sentence hvac-premier's donor wrote, hardcoded in its compiled JSX
//     with no token slot anywhere near it;
//   · all 32 SERVE the byte-identical <title> and og:title
//       "HVAC Contractor | AC & Heating Services"
//     which is the card a prospect sees in the email that delivered the link;
//   · the 48 plumbing mirrors share one h1 template, "Plumbing in {City}.",
//     so the 15 of them that sit in a shared city are byte-identical too.
//
// Two businesses in the same town opened their own new websites and read the
// same first sentence. That is the defect this module exists to end.
//
// THE HARD PART IS DOING IT WITHOUT FABRICATING. A headline is the loudest
// text on the page and the easiest place to assert something nobody checked.
// So there is no adjective here that we did not measure. The order of
// preference is fixed and every branch is traceable:
//
//   1. THEIR OWN WORDS. A tagline/motto their own site publishes, carried
//      verbatim, and only when lib/owner-pride.js has already proven it
//      (status FOUND + confidence not low + at least one evidence quote).
//      Never paraphrased, never "improved".
//   2. A CONSTRUCTION FROM VERIFIED FACTS. Their name, their trade, their
//      market city, and — when the pair is verified — their real rating and
//      review count. Every atom is one the boundary already vouched for.
//   3. A NEUTRAL FACTUAL LINE. Name, trade, city. Nothing else.
//
// Every branch names the BUSINESS (or their own motto), which is what makes
// two mirrors structurally unable to share a headline: the differentiating
// atom is the one fact that is unique to the client by definition. The city
// alone was not enough — that is exactly how 15 plumbers collided.
//
// This module is pure: no I/O, no clock, no randomness. Same facts in, same
// words out, so the build hash stays deterministic and the sameness gate can
// re-derive what should have shipped.

const { STATE_CODES } = require("./place-names");

// ---------------------------------------------------------------------------
// Trade labels
// ---------------------------------------------------------------------------
// forge.heroHeadline title-cased the raw vertical, which turns "hvac" into
// "Hvac" — a headline we would have shipped ten feet tall on 32 sites the
// moment the donor's hardcoded sentence was replaced. Acronyms and multi-word
// verticals get a written label; anything unmapped falls back to title case
// with the acronym list applied, so a new vertical reads correctly on day one.
const TRADE_LABELS = Object.freeze({
  hvac: "HVAC",
  "heating and air": "HVAC",
  "heating & cooling": "HVAC",
  "heating and cooling": "HVAC",
  "air conditioning": "HVAC",
  plumbing: "Plumbing",
  plumber: "Plumbing",
  roofing: "Roofing",
  concrete: "Concrete",
  masonry: "Masonry",
  fencing: "Fencing",
  landscaping: "Landscaping",
  "med spa": "Med spa",
  medspa: "Med spa",
  salon: "Salon",
  "nail salon": "Nail salon",
  tattoo: "Tattoo studio",
  electrical: "Electrical",
  electrician: "Electrical",
  "auto detailing": "Auto detailing",
  "pest control": "Pest control",
});

const ACRONYMS = Object.freeze(new Set(["HVAC", "AC", "LLC", "INC", "USA", "US", "IT", "AV", "RV"]));

function titleCaseWord(word) {
  const upper = word.toUpperCase();
  if (ACRONYMS.has(upper)) return upper;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The DISPLAY form of a vertical. "hvac" -> "HVAC", never "Hvac". */
function tradeLabel(industry) {
  const key = String(industry || "").trim().toLowerCase();
  if (!key) return "";
  if (TRADE_LABELS[key]) return TRADE_LABELS[key];
  return key.split(/\s+/).map(titleCaseWord).join(" ");
}

// ---------------------------------------------------------------------------
// Sentence hygiene
// ---------------------------------------------------------------------------
// "Smith Plumbing Inc." must not become "Smith Plumbing Inc.." and a name that
// already ends in punctuation keeps it. Deliberately conservative: this only
// adds a full stop, it never edits the client's own name.
function asSentence(value) {
  const s = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  if (!s) return "";
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/** A tagline we may print verbatim, or "" — see prideTagline for the rules. */
const MAX_TAGLINE = 90;
// A HEADLINE IS ONE PUNCH, NOT THREE CLAUSES (swan-doctrine, owner 2026-08-12).
// The character cap alone let a run-on through: Family Heating's own slogan
// "HVAC Company in Indianapolis, IN, Is Ready to Serve You!" is 55 characters —
// well under MAX_TAGLINE — yet ten words across two clauses, and it shipped
// verbatim as the h1 on their live mirror. A WORD cap catches what the char cap
// could not. Seven words is the ceiling: the real slogans the tests pin as
// usable top out at six ("Trusted Plumber in Little Rock, AR", "Big City
// Service. Small Town Value"), and above seven a line no longer reads in one
// breath — the composer then falls back to the name and the trade-and-city,
// each of which IS a single line.
const MAX_TAGLINE_WORDS = 7;

/**
 * Is this string safe to publish as a headline in the client's own voice?
 * The value has already cleared owner-pride's evidence bar; these are the
 * PUBLISHING rules on top of it. Every one of them is a shape that would read
 * as broken or leak machinery, never a judgement about the words themselves.
 */
function usableTagline(value, { businessName = "" } = {}) {
  const s = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (s.length < 6 || s.length > MAX_TAGLINE) return "";
  // A MOTTO IS AT LEAST TWO WORDS. "Roofers." — the live roofing mirror's
  // whole supplied tagline (fleet audit 2026-09-02) — is a trade noun with a
  // full stop, not a slogan; carried as line A it stacked a stub fragment on
  // top of the headline. One word can be nobody's motto.
  if (s.split(/\s+/).filter(Boolean).length < 2) return "";
  // Brevity: a headline slogan is one line. Over the word ceiling it is a
  // run-on (Family Heating's ten-word "…IN, Is Ready to Serve You!"), and the
  // name + trade-and-city read better than a slogan you take a breath through.
  if (s.split(/\s+/).filter(Boolean).length > MAX_TAGLINE_WORDS) return "";
  // Somebody else's unrendered template, a URL, an email or a phone number is
  // scraped machinery, not a motto. (Cooper Perry shipped "${child.title}" as a
  // service name from exactly this class of source.)
  if (/\$\{|\{\{|<%|<[a-z/]/i.test(s)) return "";
  if (/https?:\/\/|@[a-z0-9-]+\.[a-z]{2,}|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/i.test(s)) return "";
  if (!/[a-z]{3}/i.test(s)) return "";
  // The business name alone is not a tagline; it is already line A's fallback.
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (norm(s) === norm(businessName)) return "";
  return s;
}

/**
 * PUBLISH-READY CASE AND GEO FORMAT for a client-supplied motto.
 *
 * The verbatim rule governs WORDS — a motto is never paraphrased, expanded or
 * re-punctuated into a different sentence. Case and state-code format are
 * presentation, and the general-contractor mirror published the failure mode
 * of shipping them raw: "General Contractor In Sacramento, Ca." — a
 * title-cased sentence with an interior capital particle and a two-letter
 * state wearing a period. Two normalizations, removal/same-word only:
 *   · ", Ca." / ", ca" at the tail → the USPS uppercase form (", CA"), only
 *     when the two letters are a real state code;
 *   · an interior capitalized particle (In/Of/And/…) → lowercase, title-case
 *     style, never the first word.
 * Acronyms and words that are not on the particle list are never touched, and
 * the value that survives is still the client's own sentence.
 */
const TAGLINE_PARTICLE_RE = /(?<=\S\s)(In|On|For|And|Of|To|At|The|A|An)(?=\s\S)/g;

function normalizeTaglineCase(value) {
  let s = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  if (!s) return s;
  s = s.replace(/,\s*([A-Za-z]{2})\.?\s*$/, (m, code) => (STATE_CODES.has(code.toUpperCase()) ? `, ${code.toUpperCase()}.` : m));
  s = s.replace(TAGLINE_PARTICLE_RE, (w) => w.toLowerCase());
  return s;
}

/**
 * The client's own motto, from an owner-pride block, or "".
 * owner-pride only emits `tagline` when the extraction said FOUND, with
 * confidence above low, and carried at least one evidence quote with a source
 * URL — so this is their published sentence, not our summary of it.
 */
function prideTagline(pride, { businessName = "" } = {}) {
  const value = pride && pride.sections && pride.sections.tagline && pride.sections.tagline.value;
  return usableTagline(value, { businessName });
}

/** Their heritage line ("Family-owned since 2011"), verbatim, or "". */
function prideHeritage(pride) {
  const entry = (pride && pride.sections && (pride.sections.heritage || pride.sections.ownership)) || null;
  const value = entry && entry.value;
  const s = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  if (!s || s.length > 60) return "";
  if (/\$\{|\{\{|<%|<[a-z/]/i.test(s)) return "";
  if (!/[a-z]{3}/i.test(s)) return "";
  return s;
}

function normalizedIdentityText(value) {
  return String(value == null ? "" : value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[.'’]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsBusinessName(headline, businessName) {
  const haystack = normalizedIdentityText(headline);
  const needle = normalizedIdentityText(businessName);
  if (!haystack || !needle) return false;
  // Token boundaries prevent short names from passing inside unrelated words
  // ("Ace" inside "Space") while retaining case/punctuation insensitivity.
  return ` ${haystack} `.includes(` ${needle} `);
}

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------
/**
 * composeIdentityCopy({ facts, marketCity, hero, pride })
 *
 *   facts       — the validated MirrorFacts (business_name, industry, state,
 *                 rating, review_count …). Nothing is read that the boundary
 *                 has not already verified.
 *   marketCity  — the MARKET the business sells into (facts.service_area, else
 *                 the NAP city). Passed in rather than re-derived so this file
 *                 can never disagree with facts.js about which city is which.
 *   hero        — the request's optional hero block. `hero.headline` is an
 *                 explicit operator override and wins outright; `hero.tagline`
 *                 is the client's own motto supplied by the caller (same
 *                 evidence bar as owner-pride).
 *   pride       — an owner-pride block, when one exists for this client.
 *
 * Returns { lines:{a,b,c}, headline, source, basis[], title, description }.
 * `basis` is the provenance trail: every atom that reached the page, named.
 */
function composeIdentityCopy({ facts = {}, marketCity = "", hero = null, pride = null } = {}) {
  const businessName = String(facts.business_name || "").trim();
  const label = tradeLabel(facts.industry);
  const city = String(marketCity || facts.city || "").trim();
  const rawState = String(facts.state || "").trim();
  // "City, ST" — a two-letter state prints as its USPS uppercase form on the
  // loudest line of the page, whatever case the stored fact carries. Full
  // state names pass through untouched ("Sacramento, California" is prose).
  const state = /^[A-Za-z]{2}$/.test(rawState) ? rawState.toUpperCase() : rawState;
  const basis = [];

  // -- line B: what they do and where. Factual, and true of them by definition.
  const place = city && state ? `${city}, ${state}` : city;
  let lineB = "";
  if (label && place) lineB = asSentence(`${label} in ${place}`);
  else if (label) lineB = asSentence(label);
  else if (place) lineB = asSentence(`Serving ${place}`);
  if (lineB) basis.push(`trade+city: ${label || "(none)"} / ${place || "(none)"}`);
  // The factual fallback the fragment-stack guard below rebuilds from: at
  // most two sentences, every atom verified.
  const factualLineB = lineB;

  // -- line A: their own motto if it is proven, otherwise their own name.
  const suppliedTagline = usableTagline(hero && hero.tagline, { businessName });
  const tagline = normalizeTaglineCase(suppliedTagline || prideTagline(pride, { businessName }));
  let source;
  let lineA;
  if (tagline) {
    lineA = asSentence(tagline);
    source = "client_tagline";
    basis.push(`tagline (verbatim): ${suppliedTagline ? "request.hero.tagline" : "owner-pride.sections.tagline"}`);
    // A slogan that already says the trade and the town would print the city
    // twice — Diamond State's "Trusted Plumber in Little Rock, AR" followed by
    // "Plumbing in Little Rock, AR." reads as a stutter on the first line a
    // prospect sees. Their NAME takes line B instead, so the h1 stays theirs
    // top to bottom and every line still says something new.
    const tagNorm = lineA.toLowerCase();
    const tradeRoot = label ? label.toLowerCase().replace(/(?:ing|ers?|s)$/, "") : "";
    if (businessName && city && tradeRoot
      && tagNorm.includes(city.toLowerCase())
      && tagNorm.includes(tradeRoot)) {
      lineB = asSentence(businessName);
      basis.push("line B = business_name (slogan already carries trade+city)");
    }
  } else if (businessName) {
    lineA = asSentence(businessName);
    source = "business_name";
    basis.push("business_name (verified)");
  } else {
    lineA = lineB;
    lineB = "";
    source = "trade_and_city";
  }

  // -- line C: ONE verified differentiator, or nothing at all.
  //
  // TRUTH LAW. There is no "trusted local experts" branch and there never will
  // be. Rating and review_count are written as a PAIR by the fact boundary or
  // not at all, so a star with no count can never reach this line; heritage is
  // owner-pride's verbatim value with its own evidence quote behind it.
  let lineC = "";
  const rating = Number(facts.rating);
  const reviews = Number(facts.review_count);
  const heritage = prideHeritage(pride);
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(reviews) && reviews > 0) {
    lineC = asSentence(`${rating.toFixed(1)} stars across ${Math.trunc(reviews)} reviews`);
    basis.push(`rating+review_count (verified pair): ${rating}/${Math.trunc(reviews)}`);
    if (source === "business_name") source = "verified_facts";
  } else if (heritage) {
    lineC = asSentence(heritage);
    basis.push("heritage (owner-pride, verbatim)");
    if (source === "business_name") source = "verified_facts";
  }
  if (source === "business_name") source = "trade_and_city";

  // An explicit operator override still wins — the request schema has always
  // allowed one — but it replaces the FIRST line only, so the trade, the city
  // and the proof underneath it stay measured.
  const override = String((hero && hero.headline) || "").trim();
  if (override) {
    lineA = asSentence(override);
    source = "request_override";
    basis.unshift("request.hero.headline (operator override)");
  }

  const identityAttempt = Number(hero && hero.attempt) === 2 ? 2 : 1;
  if (identityAttempt === 2 && businessName) {
    const priorA = lineA;
    const priorB = lineB;
    // The one allowed retry permutes only already-verified atoms. Prefer the
    // factual trade/place line first, then the exact verified display name.
    if (priorB && !containsBusinessName(priorB, businessName)) {
      lineA = priorB;
      lineB = asSentence(businessName);
    } else {
      lineA = asSentence(businessName);
      lineB = priorA && !containsBusinessName(priorA, businessName) ? priorA : priorB;
    }
    source = "sameness_collision_retry";
    basis.push("attempt 2 = factual headline order differentiated");
  }

  // Identity postcondition: an operator line or client motto may lead, but a
  // revealable client-derived H1 must still contain the exact verified display
  // name. Adding that name introduces no marketing claim.
  if (businessName && !containsBusinessName([lineA, lineB].filter(Boolean).join(" "), businessName)) {
    lineB = [lineB, asSentence(businessName)].filter(Boolean).join(" ");
    basis.push("business_name appended to satisfy headline identity postcondition");
  }

  let headline = [lineA, lineB].filter(Boolean).join(" ");

  // FRAGMENT-STACK GUARD — for REPEATED fragments only. A motto line, the
  // trade-and-city line and the appended name are each doing their own job,
  // and the slogan rule pins that stack above name+city. The live roofing h1
  // ("Roofers. Roofing in Naples, FL. Absolute Roofing of Southwest Florida.")
  // was different: its trade word appeared in BOTH the trade-and-city
  // fragment and the business name, so the h1 said "roofing" twice across
  // three clipped sentences — a repeated-fragment stutter. When a
  // single-sentence motto leads such a stack — trade repeated inside the
  // name, three or more fragments — the composition is rebuilt from the
  // factual atoms (name, trade-and-city), which carry every verified atom in
  // at most two fragments. The name's own words are never rewritten.
  const fragments = headline.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const taglineFragments = tagline ? tagline.split(/(?<=[.!?…])\s+/).filter(Boolean).length : 0;
  const stemOf = (word) => word.toLowerCase().replace(/[^a-z]/g, "").replace(/(?:ing|ers?)$/, "");
  const tradeRoot = stemOf(String(label || "").split(/\s+/)[0] || "");
  const nameCarriesTradeRoot = Boolean(tradeRoot)
    && String(businessName).toLowerCase().split(/[^a-z]+/).some((w) => w && stemOf(w) === tradeRoot);
  if (taglineFragments <= 1 && fragments.length >= 3 && nameCarriesTradeRoot) {
    const nameLine = businessName ? asSentence(businessName) : "";
    lineA = nameLine || factualLineB || lineA;
    lineB = nameLine && factualLineB && lineA !== factualLineB && !containsBusinessName(factualLineB, businessName)
      ? factualLineB
      : "";
    basis.push("fragment-stack guard: trade word repeated across fragments; rebuilt from name + trade-and-city");
    headline = [lineA, lineB].filter(Boolean).join(" ");
  }

  // -- <title> and meta description ------------------------------------------
  // Both MUST carry the business name and the market city: the title is the
  // card that shows up in the email, in a text message and in a search result,
  // and "HVAC Contractor | AC & Heating Services" identifies nobody.
  const titleTrade = label && place ? `${label} in ${place}`
    : label ? label
    : place ? place : "";
  const title = (identityAttempt === 2
    ? [titleTrade, businessName]
    : [businessName, titleTrade]).filter(Boolean).join(" | ");

  const descParts = [];
  if (businessName && titleTrade) descParts.push(`${businessName} — ${titleTrade}.`);
  else if (businessName) descParts.push(asSentence(businessName));
  if (lineC) descParts.push(lineC);
  const description = descParts.join(" ");

  return {
    lines: { a: lineA, b: lineB, c: lineC },
    headline,
    source,
    basis,
    title,
    description,
    trade_label: label,
    market_city: city,
    identity_attempt: identityAttempt,
  };
}

// ---------------------------------------------------------------------------
// Comparison keys
// ---------------------------------------------------------------------------
// The gate asks "is this byte-identical to another live mirror's?". Comparing
// raw strings would miss a trailing space or a non-breaking space picked up
// from innerText, so both sides are normalised the same way — and ONLY that
// way. Case is preserved deliberately: two businesses whose headlines differ
// only in case is still two different headlines, and collapsing case would
// hide nothing we want hidden.
function identityKey(value) {
  return String(value == null ? "" : value)
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  composeIdentityCopy,
  tradeLabel,
  identityKey,
  asSentence,
  usableTagline,
  normalizeTaglineCase,
  prideTagline,
  prideHeritage,
  normalizedIdentityText,
  containsBusinessName,
  TRADE_LABELS,
};
