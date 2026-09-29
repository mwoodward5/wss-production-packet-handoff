"use strict";

// lib/mirror-engine/local-research.js — the BrightData research layer.
//
// Points 90-94 of the 108 stack (neighborhood mentions, local landmarks, a
// NAP citation pack, GBP description copy in three lengths, suggested GBP
// categories) plus 12/31 (outbound authoritative links + citations) are the
// "research" class: they need local + generative search data, which is
// exactly what the intake packet's BRIGHTDATA-SERP-AUDIT documents.
//
// TRUTH LAW, applied to research: a neighborhood or landmark is used ONLY if
// it appears in search results tied to the prospect's own city — never
// invented, never borrowed from a different metro. Everything returned here
// is either (a) an observed string from a SERP result about that city, or
// (b) copy generated from the prospect's OWN verified facts. Nothing asserts
// anything new about the business.

const { serp } = require("./trust-brightdata");

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
const titleish = (s) => clean(s).replace(/\s*[-–|:].*$/, "").slice(0, 60);

/** Pull people-also-ask questions for the trade+city — real searcher language. */
function paaFrom(json) {
  const out = [];
  for (const q of (json && json.people_also_ask) || []) {
    const question = clean(q.question || q.title || q);
    if (question && /\?$/.test(question)) out.push(question);
  }
  return [...new Set(out)].slice(0, 12);
}

/** Related searches = the long-tail vocabulary Google itself associates. */
function relatedFrom(json) {
  const out = [];
  for (const r of (json && json.related) || []) {
    const t = clean(r.text || r.query || r);
    if (t) out.push(t);
  }
  return [...new Set(out)].slice(0, 12);
}

/**
 * Neighborhoods + landmarks for a city, observed from search results.
 * We query for them explicitly and keep only capitalized multi-word names
 * that appear in titles/snippets AND are not the city itself.
 */
// Everything that is NOT a neighborhood but looks capitalized in a SERP.
// Loose filtering shipped "Read", "Texas", "Building" and even a DIFFERENT
// CITY ("Dallas" as a Fort Worth landmark) — on a customer's live page that
// reads as sloppy at best and wrong at worst, so the bar is deliberately high.
const STATE_NAMES = new Set(["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "hampshire", "jersey", "mexico", "york", "carolina", "dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode", "island", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "wisconsin", "wyoming"]);
const GENERIC_WORDS = new Set(["read", "live", "building", "buildings", "landmark", "landmarks", "guide", "map", "maps", "photo", "photos", "review", "reviews", "thing", "things", "city", "cities", "county", "state", "area", "areas", "neighborhood", "neighborhoods", "home", "homes", "house", "houses", "real", "estate", "zillow", "wikipedia", "tripadvisor", "yelp", "reddit", "apartment", "apartments", "best", "top", "near", "list", "the", "and", "for", "with", "what", "where", "when", "why", "how", "explore", "visit", "discover", "downtown", "north", "south", "east", "west", "old", "new", "great", "famous", "popular", "attraction", "attractions", "museum", "park", "tour", "tours", "hunt", "scavenger", "amazing", "history", "historic", "district", "center", "centre", "street", "avenue", "road", "drive", "school", "schools", "church", "hotel", "restaurant", "company", "service", "services", "contractor", "roofing", "plumbing", "hvac", "electrical", "repair", "install", "installation", "cost", "price", "prices", "free", "quote"]);

function extractPlaces(json, city, { minWords = 1 } = {}) {
  const cityLow = String(city || "").toLowerCase();
  const cityTokens = new Set(cityLow.split(/\s+/).filter(Boolean));
  // Only snippets that actually mention the city can contribute a place —
  // a result about another metro cannot donate its neighborhoods.
  const snippets = [
    ...((json && json.organic) || []).map((o) => `${o.title || ""} ${o.description || o.snippet || ""}`),
    ...paaFrom(json),
    ...relatedFrom(json),
  ].filter((s) => s.toLowerCase().includes(cityLow));

  const candidates = new Map();
  for (const snip of snippets) {
    for (const m of snip.matchAll(/\b([A-Z][a-z]{2,}(?:\s+(?:[A-Z][a-z]{2,}|de|del|la|las|los|von))*)\b/g)) {
      const name = clean(m[1]);
      const words = name.split(/\s+/);
      const low = name.toLowerCase();
      if (low === cityLow || low.includes(cityLow)) continue;
      if (words.length > 3) continue;
      if (words.some((w) => GENERIC_WORDS.has(w.toLowerCase()) || STATE_NAMES.has(w.toLowerCase()) || cityTokens.has(w.toLowerCase()))) continue;
      // A single-word place must be substantial (Monticello, Westcliff) and not
      // a common English word; multi-word names are inherently safer.
      if (words.length < Math.max(1, minWords)) continue;
      if (words.length === 1 && name.length < 6) continue;
      candidates.set(name, (candidates.get(name) || 0) + 1);
    }
  }
  return [...candidates.entries()]
    .filter(([, n]) => n >= 2) // must recur — a single mention is noise
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/** GBP description in the three lengths the packet specifies. */
function gbpDescriptions({ business_name, industry, city, state, services = [], license, phone }) {
  const market = [city, state].filter(Boolean).join(", ");
  const svc = services.map((s) => clean(typeof s === "string" ? s : s.name)).filter(Boolean);
  const svcShort = svc.slice(0, 3).join(", ");
  const svcLong = svc.slice(0, 6).join(", ");
  const lic = license ? ` ${license}.` : "";
  const d250 = clean(`${business_name} provides ${industry.toLowerCase()} services in ${market}.${svcShort ? ` Work includes ${svcShort}.` : ""}${lic} Call ${phone}.`).slice(0, 250);
  const d500 = clean(`${business_name} is a ${industry.toLowerCase()} company serving ${market} and the surrounding area.${svcLong ? ` Services include ${svcLong}.` : ""}${lic} To ask a question or arrange a visit, call ${phone}.`).slice(0, 500);
  const d750 = clean(`${business_name} provides ${industry.toLowerCase()} services throughout ${market} and nearby communities.${svcLong ? ` The team handles ${svcLong}.` : ""}${lic} Every job starts with a look at what is actually there, so the scope is clear before work begins. To reach ${business_name}, call ${phone}.`).slice(0, 750);
  return { short_250: d250, medium_500: d500, long_750: d750 };
}

/** Suggested GBP categories, mapped from the canonical vertical. */
const GBP_CATEGORIES = {
  roofing: ["Roofing contractor", "Roofing supply store", "Gutter cleaning service", "Siding contractor", "Construction company"],
  plumbing: ["Plumber", "Drainage service", "Water heater installation", "Septic system service", "Bathroom remodeler"],
  hvac: ["HVAC contractor", "Air conditioning contractor", "Furnace repair service", "Air duct cleaning service"],
  electrical: ["Electrician", "Electrical installation service", "Lighting contractor", "Generator shop"],
  landscaping: ["Landscaper", "Lawn care service", "Tree service", "Irrigation equipment supplier"],
};
function gbpCategories(industry) {
  const key = String(industry || "").toLowerCase();
  for (const [k, v] of Object.entries(GBP_CATEGORIES)) if (key.includes(k)) return v;
  return ["Contractor", "General contractor", "Home improvement store"];
}

/** NAP citation targets — the CSV the packet ships. Directories only; the
 *  prospect's own NAP is the payload, so nothing here is a claim. */
const CITATION_TARGETS = [
  "Google Business Profile", "Bing Places", "Apple Business Connect", "Yelp",
  "Better Business Bureau", "Angi", "Thumbtack", "HomeAdvisor", "Houzz",
  "Nextdoor", "Facebook Page", "Yellow Pages", "Manta", "Chamber of Commerce",
];
function citationPack(facts) {
  const rows = [["directory", "business_name", "phone", "city", "state", "address", "website"]];
  for (const t of CITATION_TARGETS) {
    rows.push([t, facts.business_name || "", facts.phone || "", facts.city || "", facts.state || "", facts.address || "", facts.current_website || ""]);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
}

/**
 * research(facts, { services }) -> {
 *   neighborhoods[], landmarks[], questions[], related[],
 *   gbp: { descriptions, categories }, citations_csv, sources[]
 * }
 * Any SERP failure degrades gracefully to empty arrays — the mirror then
 * simply lacks those points rather than inventing local colour.
 */
async function research(facts = {}, { services = [], opts = {} } = {}) {
  const city = facts.city || "";
  const state = facts.state || "";
  const market = [city, state].filter(Boolean).join(" ");
  const out = {
    neighborhoods: [], landmarks: [], questions: [], related: [],
    gbp: { descriptions: gbpDescriptions({ ...facts, services }), categories: gbpCategories(facts.industry) },
    citations_csv: citationPack(facts),
    sources: [],
  };
  if (!city) return out;

  const [hoods, marks, trade] = await Promise.all([
    serp(`neighborhoods in ${market}`, opts).catch(() => null),
    serp(`landmarks in ${market}`, opts).catch(() => null),
    serp(`${facts.industry || "contractor"} ${market}`, opts).catch(() => null),
  ]);
  if (hoods) { out.neighborhoods = extractPlaces(hoods, city).slice(0, 10); out.sources.push(`serp:neighborhoods in ${market}`); }
  if (marks) { out.landmarks = extractPlaces(marks, city).slice(0, 8); out.sources.push(`serp:landmarks in ${market}`); }
  if (trade) {
    out.questions = paaFrom(trade);
    out.related = relatedFrom(trade);
    out.sources.push(`serp:${facts.industry} ${market}`);
    // Authoritative outbound candidates: .gov / .edu / trade bodies only.
    out.authoritative = ((trade.organic || [])
      .map((o) => ({ href: o.link || o.url || "", title: titleish(o.title) }))
      .filter((o) => /^(https?:)?\/\//.test(o.href) && /\.(gov|edu)(\/|$)|nachi\.org|iccsafe\.org|nrca\.net|phccweb\.org|energystar\.gov/i.test(o.href))
      .slice(0, 3));
  }
  return out;
}

module.exports = { research, gbpDescriptions, gbpCategories, citationPack, extractPlaces, paaFrom, relatedFrom, CITATION_TARGETS };
