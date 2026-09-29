"use strict";

// lib/mirror-engine/tokens.js — THE single token set for the Mirror Engine.
//
// One exported set, consumed by the hydrator, the coverage test, and the
// generated docs. Two hand-maintained lists is the failure mode this file
// exists to end: {{OWNER_NAME}} was in the substitution map but missing from
// the spec's token list, and eight other tokens shipped raw to 54 of 69 live
// previews because they existed in donors but not in the map.
//
// Rules (MIRROR_ENGINE_SPEC.md §3):
// - Token names are [A-Z_]+ only. No digits — the coverage regex is
//   /\{\{[A-Z_]+\}\}/ and a digit-bearing token would be invisible to it.
// - Every token here is substituted even when its value is "". An UNMAPPED
//   token is the only way a literal {{...}} reaches a customer.
// - OPTIONAL tokens blank out and collapse their element (donor-side
//   data-collapse-if-empty). REQUIRED tokens missing = hard fail.
// - TRUTH LAW: a blank is correct; an invented value is a defect.

// name -> { required: boolean, doc: string }
const TOKEN_DEFS = Object.freeze({
  BUSINESS_NAME: { required: true, doc: "Verified display name of the prospect business." },
  // OPTIONAL since 2026-08-01 (owner directive). Outreach is email-only — we never
  // call the prospect — so requiring their phone rejected otherwise-qualified leads
  // for a fact the campaign does not use. Phone was the second-hardest filter after
  // email, so this is a real widening of the funnel.
  //
  // It stays OPTIONAL, never invented: a business with no published number renders
  // no phone at all. The donors' collapse-if-empty contract removes the call CTAs
  // wholesale rather than leaving "Call " with nothing after it, and the lead form
  // becomes the primary conversion action — which is the honest fallback, since the
  // site still has to work for THEIR customers.
  PHONE: { required: false, doc: "Verified display-form phone number. Absent => every call CTA collapses." },
  PHONE_DIGITS: { required: false, doc: "Exactly 10 digits derived from PHONE by the boundary (extension-safe)." },
  // CITY IS THE MARKET, NOT THE MAILING ADDRESS. Every donor spends {{CITY}} on
  // marketing surfaces — <title>, og:title, the hero lede, "Serving {{CITY}}",
  // the footer service-area line. So CITY carries the market the business
  // actually sells into (facts.service_area, asserted by their own site) and
  // falls back to the NAP locality when they assert nothing. Flint Plumbing
  // shipped as "Plumbing in Buda, TX" — their registered suburb — while their
  // own site sells Austin. See lib/mirror-engine/facts.js marketCity().
  CITY: { required: true, doc: "MARKETING city: the market the business sells into (facts.service_area), else the verified NAP city." },
  ADDRESS_CITY: { required: true, doc: "NAP locality of the verified mailing address. Use in schema.org PostalAddress and any visible address block — never in marketing copy." },
  STATE: { required: true, doc: "Verified uppercase two-letter state code." },
  REGION: { required: true, doc: "Alias of STATE." },
  HERO_HEADLINE: { required: true, doc: "The client's own headline: their proven motto or their name, plus trade and verified NAP city/state. Composed by lib/mirror-engine/identity-copy.js — never the donor's sentence." },

  // THE HEADLINE, IN THE PIECES A DISPLAY TYPESETTER NEEDS.
  //
  // A donor that sets its hero across three styled lines (hvac-premier's is
  // "…/ breaks the rules, / we hold the line.") cannot use HERO_HEADLINE: it
  // needs the parts separately so line two can be italic and line three can
  // carry the gradient. Before these existed the only way to keep that design
  // was to hardcode the sentence, which is precisely how 32 HVAC mirrors came
  // to publish one identical h1.
  //
  // A and B are OPTIONAL in the token contract and NEVER blank in practice:
  // the engine composes them from BUSINESS_NAME / CITY / STATE, all of which
  // are REQUIRED, and refuses the build if either comes out empty. C is
  // genuinely optional — it only exists when a differentiator was verified —
  // so a donor must wrap it in a [[NEED:HERO_LINE_C]] phrase marker, which
  // takes its <br> and its <span> with it when there is nothing to say.
  HERO_LINE_A: { required: false, doc: "Headline line 1: the client's proven motto, else their business name. Never the donor's copy." },
  HERO_LINE_B: { required: false, doc: "Headline line 2: trade + verified NAP city/state, e.g. 'HVAC in Portland, OR.'" },
  HERO_LINE_C: { required: false, doc: "Headline line 3: ONE verified differentiator (rating+review pair, or a proven heritage line). Blank collapses — never invented." },

  OWNER_NAME: { required: false, doc: "Verified owner name. Blank collapses the 'meet the owner' block — defect #4 was the donor's owner byline." },
  EMAIL: { required: false, doc: "Verified email; sanitized. Blank collapses." },
  ADDRESS: { required: false, doc: "Verified street address." },
  COUNTY: { required: false, doc: "Verified county." },
  ZIP: { required: false, doc: "Verified postal code." },
  POSTAL: { required: false, doc: "Alias of ZIP." },
  GEO: { required: false, doc: "lat,lng pair when both verified." },
  GEO_LAT: { required: false, doc: "Verified latitude." },
  GEO_LNG: { required: false, doc: "Verified longitude." },
  PLACE_ID: { required: false, doc: "Google place_id when mined." },
  RATING: { required: false, doc: "Verified rating. Never defaulted, never invented." },
  REVIEW_COUNT: { required: false, doc: "Verified review count. Never defaulted, never invented." },
  REVIEW_TEXT: { required: false, doc: "Verified review quote only. No real reviewer content may be fabricated." },
  REVIEW_AUTHOR: { required: false, doc: "Verified reviewer name only." },
  LICENSE: { required: false, doc: "Verified credentials, joined + capped. Blank collapses." },
  PROFILE_URL: { required: false, doc: "Verified profile URL (https)." },
  LOGO_URL: { required: false, doc: "Path of the prospect's own logo asset, or the generated wordmark." },
  DOMAIN: { required: false, doc: "Prospect preview host." },
  PREVIEW_URL: { required: false, doc: "https URL of the mirror on wss-ai.com." },
  PREVIEW_DOMAIN: { required: false, doc: "Alias of DOMAIN." },
  SITE_URL: { required: false, doc: "Alias of PREVIEW_URL (canonical/og:url/sitemap)." },
  HERO_ACCENT: { required: false, doc: "Verified differentiator only. Blank collapses." },
  HERO_BADGE: { required: false, doc: "Verified badge copy only. Blank collapses." },
});

const ALLOWED_TOKENS = Object.freeze(new Set(Object.keys(TOKEN_DEFS)));
const REQUIRED_TOKENS = Object.freeze(
  new Set(Object.keys(TOKEN_DEFS).filter((k) => TOKEN_DEFS[k].required)),
);
const OPTIONAL_TOKENS = Object.freeze(
  new Set(Object.keys(TOKEN_DEFS).filter((k) => !TOKEN_DEFS[k].required)),
);

// The one coverage regex. [A-Z_]+ only, by design — see header.
const TOKEN_RE = /\{\{([A-Z_]+)\}\}/g;

// Extensions the hydrator substitutes into. `.js` is not optional (GOTCHA-2:
// hero URLs and donor copy live in router chunks as template literals).
const HYDRATE_EXTS = Object.freeze(
  new Set([".html", ".js", ".css", ".json", ".txt", ".svg", ".xml", ".webmanifest"]),
);

/** Every {{TOKEN}} name appearing in a text blob. */
function tokensIn(text) {
  const found = new Set();
  for (const m of String(text).matchAll(TOKEN_RE)) found.add(m[1]);
  return found;
}

/**
 * Tokens in `text` that are not in ALLOWED_TOKENS. An unknown token is an
 * engine/donor defect and must HARD-FAIL the build (422 unmapped_token) —
 * substituting around it would ship a literal {{...}} to a customer.
 */
function unknownTokensIn(text) {
  return [...tokensIn(text)].filter((t) => !ALLOWED_TOKENS.has(t));
}

/**
 * SOMEBODY ELSE'S UNRESOLVED TEMPLATE, ARRIVING AS CONTENT.
 * ---------------------------------------------------------------------------
 * Everything above is about OUR tokens. This is about theirs.
 *
 * Cooper Perry Plumbing (Tulsa) and Goodson Plumbing (Boise) both publish a
 * navigation menu whose own template never rendered, so their live HTML
 * literally contains:
 *
 *     <a href="...">${child.title}</a>
 *     <a href="...">06 ${parent.title}</a>
 *
 * The resolver harvests service names from anchor TEXT — which is right, it is
 * how a business names its own work — and on 2026-08-11 both mirrors shipped
 * "${child.title}" and "${parent.title}" as service cards AND as schema.org
 * Service entries that Google was invited to parse. Their broken markup became
 * our broken website.
 *
 * `{{...}}` is checked alongside `${...}` because the same class arrives from
 * Handlebars, Liquid and Mustache sites, and because a donor token that somehow
 * reached a content field must never be printed as the customer's own words.
 */
const FOREIGN_TEMPLATE_TOKEN = /\$\{[^}]*\}|\{\{[^}]*\}\}|<%[-=]?[\s\S]*?%>/;

/** Does this string still carry an unresolved template token of any flavour? */
function carriesTemplateToken(value) {
  return FOREIGN_TEMPLATE_TOKEN.test(String(value == null ? "" : value));
}

/** Markdown token table, generated from the same defs the hydrator uses. */
function generatedDocs() {
  const rows = Object.entries(TOKEN_DEFS).map(
    ([name, d]) => `| \`{{${name}}}\` | ${d.required ? "REQUIRED" : "optional"} | ${d.doc} |`,
  );
  return [
    "# Mirror Engine token contract (generated — do not hand-edit)",
    "",
    "| Token | Class | Meaning |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

module.exports = {
  TOKEN_DEFS,
  ALLOWED_TOKENS,
  REQUIRED_TOKENS,
  OPTIONAL_TOKENS,
  TOKEN_RE,
  HYDRATE_EXTS,
  FOREIGN_TEMPLATE_TOKEN,
  carriesTemplateToken,
  tokensIn,
  unknownTokensIn,
  generatedDocs,
};
