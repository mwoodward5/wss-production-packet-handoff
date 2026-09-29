"use strict";

// lib/mirror-engine/content-inject.js — the CONTENT half of the mirror.
//
// Token hydration carries identity (name, phone, city). It cannot carry
// paragraphs, service lists, FAQs, reviews, hours or a coverage map — and
// those are exactly what makes a site read as "fully dressed" instead of a
// skinned template. A pre-compiled donor cannot be re-architected, so this
// module ADDS content as self-contained, donor-agnostic markup:
//
//   1. A styled authority block (services · coverage · FAQ · reviews · hours)
//      inserted before the donor's footer, using the donor's OWN CSS custom
//      properties (--accent) so it reads as one design, not a bolt-on.
//   2. A full JSON-LD graph (LocalBusiness/Service/FAQPage+speakable/
//      BreadcrumbList/WebSite+SearchAction/Person/ContactPoint/PostalAddress/
//      GeoCoordinates/AggregateRating/OpeningHours/areaServed).
//   3. Head completions: og:image + twitter:card when the donor lacks them.
//   4. llms.txt + sitemap.xml enrichment for AI/crawler surfaces.
//   5. Legal hygiene (applyLegalHygiene): noindex + a visible "Unofficial
//      concept by WSS Labs" line on every page — see the block above
//      buildAttributionFooter.
//
// TRUTH LAW: every section renders ONLY from verified content the caller
// supplies. No content -> no section. Nothing is invented, padded, or
// back-filled, and no reviewer name appears unless the Genie attested it.

// MARKET vs MAILING ADDRESS. `facts.service_area` is an explicit first-party
// market claim; `facts.city` is the NAP locality. The latter must never be
// promoted into "serves" copy merely because the business is located there.
// ONE trade label for the whole system. `facts.industry` is the canonical
// vertical KEY — lowercase, machine-shaped — so printing it raw ships
// "hvac in Portland, OR" in a <title> and "plumbing" where "Plumbing" belongs.
// tradeLabel is the same function the hero headline composes with, so the
// title and the h1 can never disagree about what this business does.
const { tradeLabel, composeIdentityCopy } = require("./identity-copy");
const { marketCity, isScraperArtifactEmail, stripScraperEmailArtifacts } = require("./facts");
const { buildSignupFloater } = require("./signup-floater");
const { buildLeadCapture, resolveLeadCaptureConfig } = require("./lead-capture");
const { buildChatWidget, resolveChatWidgetConfig } = require("./chat-widget");
const { coreName } = require("./social-discovery");
const { isPlausiblePlaceName, filterPlaceNames, STATE_CODES, STATE_NAMES, PLACE_TRADE_WORD } = require("./place-names");
const { carriesTemplateToken } = require("./tokens");
const { articleHeadlineReason } = require("./service-names");
const { bindServiceCards } = require("./service-cards");
// THE DONOR'S TAXONOMY, WHOLE — see lib/mirror-engine/taxonomy.js. The owner's
// 2026-09-02 video report: preserve donor-specific services and naming; never
// collapse concrete specialties into generic cards; keep genuine proof above
// generic marketing copy. The taxonomy module extracts (same bytes, same truth
// law); this file renders what it extracted.
const {
  enrichServicesFromTaxonomy,
  taxonomyServiceCards,
  contentDensityVerdict,
} = require("./taxonomy");
// THE CHAT HANDOFF (feature 11) dials Riley, never the client's front desk, so
// the line resolves through the same module every other Riley CTA answers to.
// Required, not edited — riley-line.js is the one place that knows the fields.
const { resolveRileyLine } = require("../riley-line");

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
const jsonEsc = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
// A SERVICE PHRASE IS NOT A SERVICE AREA: "General Contractor in Southwest
// Florida" (the concrete mirror's declared market, printed live as
// "…Southwest Florida, FL") is a trade claim over a region, not a town. The
// refusal needs BOTH a trade word (the same closed list place-names.js uses
// when it salvages a town out of a headline) AND a place preposition, so a
// real town can never match it — no town is named "Contractor in".
const PLACE_TRADE_WORD_RE = new RegExp(`\\b(?:${PLACE_TRADE_WORD})\\b`, "i");
const PLACE_PREPOSITION_RE = /\b(?:in|near|around|serving|throughout|across)\b/i;
// AUDIT 563 BUG D (Canyon): the first FAQ answer shipped as a wall of
// concatenated harvest fragments. 500 chars of wall is still a wall, so the
// hard cap sits inside the audit's 280–320 band and every answer — however it
// reaches a rendered surface — passes through cleanFaqAnswer below.
const MAX_FAQ_ANSWER_LENGTH = 300;

// A word said three-plus times in a row is harvest noise, not prose
// ("drain drain drain cleaning"). Measured live riding the Canyon mirror's
// first FAQ (audit 563 bug D). The run is collapsed to its first word; the
// regex keeps the surrounding copy untouched.
const SAME_WORD_RUN_RE = /(\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b)(?:\s+\1\b){2,}/giu;

// A CITY LIST PRINTED TWICE IN TWO FORMATS (fleet audit, 2026-09-02). The
// general-contractor mirror's FAQ answer carried the same towns concatenated
// twice — "…serving Sacramento, Roseville, Folsom. Sacramento, CA, Roseville,
// CA, Folsom, CA…" — and the landscaping one deduped worse still, listing
// West Des Moines twice inside ONE run. A harvest glued two lists together.
// The collapse is town-keyed (the same comparison verifiedServiceAreas makes):
// within a run each town prints once, and a LATER run whose towns were ALL
// already printed is the duplicated list-format and is removed whole. Runs of
// one item are prose and are never touched.
// NB: ", and" must be tried BEFORE a bare comma, or the item after it starts
// with a stray lowercase "and" and stops being a name.
const LIST_ITEM_SPLIT_RE = /\s*(?:,\s*and\s+|,\s*|\s+and\s+|\s*&\s*|\s*,?\s*plus\s+)/i;
// ONE ITEM = a capitalized name whose interior words are capitalized too.
// The full stop is deliberately NOT part of an item: a period ends a sentence,
// and without that rule "…Folsom, and Elk Grove. Sacramento, CA…" glued into
// one run ACROSS the sentence boundary. Genuine dotted name parts (St. George,
// Mt. Pleasant, Ft. Lauderdale) ride on a closed abbreviation prefix instead.
const PROSE_ITEM_SRC = "(?:(?:St|Mt|Ft)\\.\\s*)?[A-Z][\\p{L}'’-]*(?:\\s+(?:(?:St|Mt|Ft)\\.\\s*)?[A-Z][\\p{L}'’-]*)*";
const CAPITALIZED_ITEM_RE = new RegExp(`^(?:${PROSE_ITEM_SRC})$`, "u");
// A comma may carry its own "and" ("A, B, and C" is one run of three items).
const PROSE_RUN_RE = new RegExp(
  `${PROSE_ITEM_SRC}(?:\\s*(?:,\\s*(?:and\\s+)?|\\s+and\\s+|\\s*&\\s*)${PROSE_ITEM_SRC})+`,
  "gu",
);

function proseListItemKey(item, { foldPlurals = false } = {}) {
  // COMPARED ON THE TOWN, like verifiedServiceAreas: the same list glued
  // together in two formats prints its towns as "Sacramento" and then as
  // "Sacramento, CA" — the town is the identity, the state suffix is format.
  let key = item.split(",")[0].toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (foldPlurals) key = key.replace(/ies$/, "y").replace(/s$/, "");
  return key;
}

function collapseDuplicateListRuns(text, { foldPlurals = false } = {}) {
  const raw = String(text == null ? "" : text);
  // A RUN = 2+ capitalized items joined by commas / "and" / "&". The scanner
  // walks each candidate run, dedupes it town-keyed, and drops the whole run
  // when every town in it was already printed by an earlier run.
  const seen = new Set();
  let changed = false;
  let out = raw.replace(PROSE_RUN_RE, (run) => {
    const parts = run.split(LIST_ITEM_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
    // A bare trailing "ST" belongs to the town before it ("Des Moines, IA" is
    // ONE item) — otherwise the dedupe would eat the repeated state codes of
    // an honest "City, ST, City, ST" list.
    const items = [];
    for (const part of parts) {
      if (/^[A-Z]{2}$/.test(part) && items.length) {
        // A bare trailing "ST" belongs to the town before it ("Des Moines, IA"
        // is ONE item) — otherwise the dedupe would eat the repeated state
        // codes of an honest "City, ST, City, ST" list.
        items[items.length - 1] = `${items[items.length - 1]}, ${part}`;
      } else {
        if (!CAPITALIZED_ITEM_RE.test(part)) return run; // a non-name item: not a list we understand
        items.push(part);
      }
    }
    if (items.length < 2) return run;
    const kept = [];
    const runKeys = new Set();
    let duplicated = false;
    for (const item of items) {
      const key = proseListItemKey(item, { foldPlurals });
      if (!key) return run;
      if (seen.has(key) || runKeys.has(key)) {
        // Already printed by an earlier run, or twice inside THIS run.
        duplicated = true;
        continue;
      }
      runKeys.add(key);
      kept.push(item);
    }
    for (const key of runKeys) seen.add(key);
    if (!duplicated) return run; // nothing duplicated — byte-identical passthrough
    changed = true;
    if (!kept.length) {
      // Every town already printed: the duplicated list FORMAT. Remove the
      // run together with the connective that led into it, if one did.
      return "\u0000DROP\u0000";
    }
    return kept.join(", ");
  });
  if (changed) {
    out = out
      // A vanished list that began its own sentence takes the sentence break
      // with it, and the next word is capitalized in its place — "…and Elk
      // Grove. The surrounding communities…" never reads as ". the …".
      .replace(/([.!?])\s*\u0000DROP\u0000\s*,?\s*(?:and\s+|or\s+)?\s*([a-z])/g, (m, p, w) => `${p} ${w.toUpperCase()}`)
      // A vanished list mid-sentence takes its own connective with it: "…, and
      // the surrounding" reads correctly once the dropped run's ", and" goes
      // with the run.
      .replace(/\u0000DROP\u0000\s*,?\s*(?:and\s+|or\s+)?/g, "")
      .replace(/(?:,\s*)+(?=[.!?]|$)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([.,;!?])/g, "$1")
      .trim();
  }
  return out;
}

function cleanFaqAnswer(value) {
  // AUDIT 2026-09-02 (plumbing ×4, landscaping ×4): answers rode in with
  // "Email frame-…@mhtml.blink." — a scraper's saved-page message-id standing
  // in for the client's contact email, LIVE in the FAQPage JSON-LD Google
  // reads. The artifact is stripped before anything else looks at the text.
  let answer = stripScraperEmailArtifacts(clean(value));
  // Harvested city lists print deduped ("West Des Moines" twice in one run;
  // the same towns twice in two formats), THEN same-word runs collapse, THEN
  // the cap — so the cap always cuts the cleaned prose, never the duplication.
  answer = collapseDuplicateListRuns(answer);
  answer = answer.replace(SAME_WORD_RUN_RE, "$1");
  return capAtProseBoundary(answer, MAX_FAQ_ANSWER_LENGTH);
}

/**
 * The shared prose cap: hard limit, last sentence boundary inside it, and a
 * word-edge fallback so the cap can never manufacture a mid-word fragment.
 */
function capAtProseBoundary(text, max) {
  const answer = clean(text);
  if (answer.length <= max) return answer;
  const capped = answer.slice(0, max + 1);
  const sentenceEnd = Math.max(capped.lastIndexOf(". "), capped.lastIndexOf("? "), capped.lastIndexOf("! "));
  if (sentenceEnd >= 80) return clean(capped.slice(0, sentenceEnd + 1));
  const lastSpace = capped.lastIndexOf(" ");
  return lastSpace > 0 ? capped.slice(0, lastSpace) : capped.slice(0, max);
}

/**
 * The ONE door every FAQ list passes through before it can reach a rendered
 * surface — the injected block, the JSON-LD graph, the data island a
 * consumes_content donor renders ITSELF, llms.txt and the /faq authority page.
 *
 * The Canyon mirror (audit 563 bug D) shipped its first FAQ as a wall of
 * concatenated fragments because only the two builders here in content-inject
 * asked cleanFaqAnswer; the island, llms.txt and the authority layer read
 * `content.faqs` raw. Sanitizing at the door means a new render surface cannot
 * quietly reopen the bypass. Entries whose answer is empty after cleaning are
 * dropped — a question with no answer is the same defect uncapped.
 */
function sanitizedFaqs(faqs) {
  return (Array.isArray(faqs) ? faqs : [])
    .map((f) => {
      const entry = f && typeof f === "object" ? f : {};
      return { ...entry, q: clean(entry.q || entry.question), a: cleanFaqAnswer(entry.a || entry.answer) };
    })
    .filter((f) => f.q && f.a);
}

// THE ABOUT WALL (fleet audit, 2026-09-02). The general-contractor mirror
// shipped a 2,204-character "Who you are hiring" paragraph — the raw harvest
// dump of every service name, FAQ question and city list it had ever glued
// together — and the concrete one shipped 985 characters with near-duplicates
// ("General Contractor" / "General Contractors"). The About section is PROSE:
// each paragraph passes the same sanitizer family as the FAQ answers (scraper
// emails out, duplicated list runs collapsed with singular/plural folding so
// near-identical service names print once, cap at a prose-sane boundary that
// cuts at a sentence and never mid-word), and a paragraph that sanitizes to
// nothing is dropped rather than printed as an empty shell.
const MAX_ABOUT_PARAGRAPH = 600;

function sanitizedAbout(value, { maxParagraphChars = MAX_ABOUT_PARAGRAPH, maxParagraphs = 6 } = {}) {
  const seen = new Set();
  return (String(value == null ? "" : value))
    .split(/\n{2,}/)
    .map((para) => {
      let cleaned = stripScraperEmailArtifacts(clean(para));
      // Scraped builder declarations are code, not company copy. Match only
      // complete declarations; preserve prose before and after the CSS run.
      cleaned = cleaned.replace(/(?:--[a-z][\w-]*|\bfontSize|\bfont-size)\s*:\s*[^;{}]*;/gi, " ");
      // An interrupted HTML scrape can end halfway through a form attribute.
      // Require an attribute assignment so ordinary prose about forms survives.
      cleaned = cleaned.replace(/(?:<|&lt;)?textarea\s+(?:id|name|class)\s*=\s*[^>]*(?:>|$)/gi, " ");
      cleaned = collapseDuplicateListRuns(cleaned, { foldPlurals: true });
      const result = maxParagraphChars == null ? clean(cleaned) : capAtProseBoundary(cleaned, maxParagraphChars);
      const key = result.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seen.has(key)) return "";
      seen.add(key);
      return result;
    })
    .filter(Boolean)
    .slice(0, maxParagraphs == null ? undefined : maxParagraphs);
}

// AUDIT 563 BUG E (Nevada): a decorative masthead node printed RAW DATA — a
// coordinate pair, a hex color, an unresolved placeholder token — as if it
// were copy. The fleet CSS floor (lib/mirror-engine/fleet-polish.js) hides
// `.coordinates`-class nodes inside .masthead/header, but the live artifact
// carried neither marker, so the render pass suppresses the PATTERN itself.
//
// The rule is deliberately narrow, because this runs over whole donor pages:
// only a LEAF element (no child tags, so real heading copy can never be
// sitting inside one) whose class names a masthead/hero/decor slot and whose
// ENTIRE visible text is data-shaped junk is emptied and hidden. A real
// headline ("Las Vegas Plumbing Pros"), a note with ordinary words, or any
// container with children all fail a gate and survive untouched.
const DATA_SHAPED_TEXT_RES = [
  // A coordinate pair: "36.1989, -115.2811", "36.1989° N, 115.2811° W".
  // Three-plus decimals so a price, a year or a measurement never matches.
  /^-?\d{1,3}\.\d{3,}\s*°?\s*[NSEW]?\s*[,·]\s*-?\d{1,3}\.\d{3,}\s*°?\s*[NSEW]?\.?$/i,
  // A bare hex color: #0ea5e9, #fff, #0ea5e9ff.
  /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
];

function stripMastheadDecorArtifacts(html) {
  let suppressed = 0;
  const out = String(html || "").replace(
    /<([a-z][a-z0-9-]*)\b([^>]*)>([^<]*)<\/\1>/gi,
    (whole, tag, attrs, text) => {
      if (/data-wss-decor-suppressed/i.test(attrs)) return whole;
      if (!/\bclass=["'][^"']*(?:masthead|hero|decor|coordinat|coords)[^"']*["']/i.test(attrs)) return whole;
      const t = clean(text);
      if (!t) return whole;
      const dataShaped = carriesTemplateToken(t) || DATA_SHAPED_TEXT_RES.some((re) => re.test(t));
      if (!dataShaped) return whole;
      suppressed += 1;
      const styled = /\bstyle=["']([^"']*)["']/i.test(attrs)
        ? attrs.replace(/\bstyle=["']([^"']*)["']/i, (m, css) => `style="${/display\s*:\s*none/i.test(css) ? css : `display:none;${css}`}"`)
        : `${attrs} style="display:none"`;
      return `<${tag}${styled} aria-hidden="true" data-wss-decor-suppressed="1"></${tag}>`;
    },
  );
  return { html: out, suppressed };
}

/**
 * ONE PLACE, BEFORE ANY SURFACE READS THE LIST.
 *
 * `content.services` is read by SIX different renderers in this file — the
 * cards, the JSON-LD Service graph, the JSON-LD FAQ fallback, the meta
 * description, the sitemap prose and the markdown mirror. Filtering at the card
 * was not enough: on the Tulsa mirror "${child.title}" was refused by the card
 * and still reached Google through the FAQ questions generated FROM the same
 * list. A service whose name is the prospect's unrendered template is not a
 * service on any surface, so it is removed once, at the door.
 *
 * THE SECOND CLASS, 2026-08-11: THE CLIENT'S OWN BLOG.
 * Holt Plumbing's live mirror published seven schema.org Service nodes and
 * every one was a blog post — "9 Benefits of Prompt Water Heater Repairs",
 * "How to Prevent Your Home's Pipes From Freezing This Winter" — plus the
 * sentence fragment "and surrounding areas". Cooper Perry's published four. The
 * harvest now refuses them (verified-facts.js), and this door refuses them
 * again, because the harvest is not the only way a list reaches this function:
 * an intake packet, a cached record and an operator all supply services too.
 * See lib/mirror-engine/service-names.js for what makes a label an article.
 */
/**
 * THE THIRD CLASS, 2026-08-11: A PLACE THIS SAME PAGE ALREADY CALLS A PLACE.
 *
 * The rebuilt Rose City mirror rendered the word "Beaverton" TWICE — once as a
 * service card in `#services-detail`, and once, forty lines lower, as a town in
 * the driving-directions list. One page asserting that Beaverton is both a
 * thing you can buy and a town you can drive from.
 *
 * That contradiction is decidable HERE and nowhere else, because this is the
 * only function that holds all three lists at once: `services`, `areas` (the
 * client's own coverage claim) and `nearby` (towns measured around their
 * verified coordinates). No string test can separate "Clackamas" from
 * "Ductless" — they are the same shape — but a build that has independently
 * resolved Clackamas as a PLACE has already answered the question.
 *
 * The place lists win, and that asymmetry is deliberate: `areas` and `nearby`
 * are resolved from verified coordinates and the client's own coverage claim,
 * while a service name at this point may still have come from anchor text in a
 * menu. When the two disagree, the better-sourced list is right.
 */
function placeWordsOf(content = {}) {
  const words = new Set();
  const add = (v) => {
    const k = clean(v).toLowerCase().replace(/,.*$/, "").trim();
    if (k.length > 2) words.add(k);
  };
  for (const a of Array.isArray(content.areas) ? content.areas : []) add(typeof a === "string" ? a : (a && a.name));
  for (const n of Array.isArray(content.nearby) ? content.nearby : []) add(n && n.name);
  return words;
}

/**
 * `businessName` is passed so the predicate can refuse the company's OWN name
 * as a service tile. Buddy the Plumber (Chattanooga TN) published "Buddy the
 * Plumber, LLC" as its first service, harvested from their own services-section
 * heading — which is the company name, because that is how their page is
 * written. Without the name in hand no rule can catch that: the string is a
 * perfectly well-formed service-shaped phrase.
 */
function withUsableServices(content = {}, businessName = "") {
  const list = content.services;
  if (!Array.isArray(list) || !list.length) return content;
  const places = placeWordsOf(content);
  let scrubbedDesc = false;
  // The SAME service twice is one service and one bug. Duplicate labels were
  // measured live (2026-08-20) riding different harvest doors into one list,
  // then into the quote-form dropdown twice. First occurrence wins — it is the
  // one the better-ranked source supplied.
  const seenNames = new Set();
  const kept = list.filter((s) => {
    // A generated marker is provenance, not a harmless extra property. Never
    // strip it and let model/catalog copy masquerade as a verified service.
    if (s && typeof s === "object" && s.generated === true) return false;
    const name = typeof s === "string" ? s : (s && (s.name || s.title));
    if (!name || carriesTemplateToken(name) || articleHeadlineReason(name, { businessName })) return false;
    const key = clean(name).toLowerCase();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    // Whole-label only. "Beaverton" goes; "Beaverton Furnace Repair" stays —
    // that one names a service and merely says where.
    return !places.has(key);
  }).map((s) => {
    // A word-empty description (".", "-", whitespace) both prints literally as
    // the card body AND overrides the donor's own generated intro
    // (intro:e.description||n.intro). Drop it so the honest name/business
    // fallback shows. Keep digit-bearing copy like "24/7" (2+ alphanumerics).
    if (s && typeof s === "object" && s.description != null) {
      const alnum = (String(s.description).match(/[a-z0-9]/gi) || []).length;
      if (alnum < 2) {
        scrubbedDesc = true;
        const { description, ...rest } = s;
        return rest;
      }
    }
    return s;
  });
  return (kept.length === list.length && !scrubbedDesc) ? content : { ...content, services: kept };
}

/**
 * FEATURE PRAISE, NEVER A COMPLAINT.
 *
 * The aggregate rating remains the complete, verified Google summary. A
 * featured quote is a separate editorial choice: only 4+-star or genuinely
 * unrated words belong in promotional page furniture. Rated sub-4 reviews are
 * therefore omitted from the featured-review array, never rewritten. If no
 * eligible quote remains, the review section simply does not render.
 *
 * Applied at all three render doors (HTML block, JSON-LD, and the data island
 * a consumes_content donor reads), so a poor singleton cannot leak through a
 * short-list fast path on any surface.
 */
function orderReviewsForDisplay(content = {}) {
  const list = content.reviews;
  if (!Array.isArray(list) || !list.length) return content;
  const ratingOf = (r) => {
    const raw = r && r.rating;
    if (raw == null || (typeof raw === "string" && !raw.trim())) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const featured = list.filter((r) => {
    const rating = ratingOf(r);
    return rating === null || rating >= 4;
  });
  return featured.length === list.length ? content : { ...content, reviews: featured };
}

/**
 * TAXONOMY FIDELITY AT THE RENDER DOOR (owner's video report, 2026-09-02:
 * "Preserve donor-specific services and naming. Avoid collapsing concrete
 * specialties into generic 'services' cards if the donor has a meaningful
 * taxonomy.").
 *
 * `content.taxonomy` is the donor's extracted service taxonomy
 * (lib/mirror-engine/taxonomy.js — same bytes the harvest already fetched,
 * same truth law). Two laws, both fill-only:
 *
 *   1. CARD BODIES FROM THE DONOR'S OWN COPY. A supplied service card that
 *      arrives name-only takes the description the donor wrote for THAT
 *      service, matched by name — so the words that make a specialty specific
 *      ("stamped", "sealed", "ornamental") reach the page instead of a bare
 *      label. Supplied copy is never overwritten: enrichment only fills an
 *      empty card body.
 *   2. THE DENSITY GUARD. When the harvest supplied NOTHING but the donor's
 *      own page lists real services, the donor's list IS first-party content
 *      — it re-passes withUsableServices' gates here — and the page renders
 *      it rather than collapsing to a content-free one-pager. A site with a
 *      20-service taxonomy must not ship as an empty template demo.
 *
 * Absent taxonomy => byte-identical passthrough; nothing changes for callers
 * that do not supply one.
 */
function withTaxonomyFidelity(content = {}, businessName = "") {
  const taxonomy = content && content.taxonomy && Array.isArray(content.taxonomy.services) ? content.taxonomy : null;
  if (!taxonomy) return content;
  const supplied = Array.isArray(content.services) ? content.services : [];
  if (supplied.length) {
    const merged = enrichServicesFromTaxonomy(supplied, taxonomy);
    return merged === supplied ? content : { ...content, services: merged };
  }
  const cards = taxonomyServiceCards(taxonomy, { max: 24 });
  if (!cards.length) return content;
  return withUsableServices({ ...content, services: cards }, businessName);
}

/**
 * A phone as a HUMAN reads it. facts.phone arrives as E.164 (+19047607837) —
 * right for schema and tel: hrefs, wrong as visible text: the audit found it
 * printed raw in SEVEN places (the trust rail CTA, the coverage line, the FAQ
 * answers). Non-NANP numbers pass through untouched.
 */
function humanPhone(value) {
  const raw = clean(value);
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

/**
 * E.164 for schema and tel: surfaces, from EITHER the engine's verified
 * NANP digits or any phone-shaped fact. Defect 9 (2026-09-02 audit): the
 * concrete mirror's business JSON-LD shipped NO telephone while the client's
 * phone existed in facts — the builder keyed the field on the 10-digit NANP
 * derivation alone, so any number that derivation refuses (international
 * lines, oddly formatted records) silently dropped the strongest contact
 * signal schema has. Known phone => telephone, always.
 */
function schemaTelephone(phoneDigits, phone) {
  const digits = String(phoneDigits || "").replace(/\D/g, "");
  if (digits.length >= 10) return `+1${digits.slice(-10)}`;
  const raw = clean(phone).replace(/[^\d+]/g, "");
  return raw.startsWith("+") && raw.length >= 8 ? raw : "";
}

/** "United Contractors Inc." + the composer's own " ." => "Inc.." — so the
 *  inserted value gives up every trailing period and the composer owns the one period. */
function trimTrailingPeriod(value) {
  return String(value || "").replace(/\s*\.{1,}\s*$/, "").trim();
}

/**
 * HARVESTED SHOUTING IS NOT A SERVICE NAME (defect 7, same audit): the meta
 * composer led og:description with a service whose stored name was ALL-CAPS
 * ("PLUMBING offered by …"). Real acronyms a trade legitimately prints are
 * protected; any other 3+ letter run that arrives shouting is title-cased.
 */
const SHOUTED_ACRONYMS = new Set([
  "HVAC", "AC", "CCTV", "CBD", "EV", "HOA", "LLC", "LTD", "INC", "CO", "CORP",
  "USA", "US", "PLLC", "DBA", "PA", "PC", "GPS", "ATV", "BBQ", "SPA",
]);
function titleCaseShoutedTokens(value) {
  return String(value || "").split(/(\s+)/).map((word) => {
    const core = word.replace(/[^A-Za-z]/g, "");
    if (core.length < 3 || core !== core.toUpperCase() || SHOUTED_ACRONYMS.has(core)) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  }).join("");
}

/** Service markets the business explicitly published — never its NAP city. */
function verifiedServiceAreas(facts = {}, areas = []) {
  const out = [];
  const seen = new Set();
  const stateSuffix = /,\s*[A-Za-z]{2}\s*$/;
  // "ut" and "Utah" are both the state; anything else is not a state and must
  // never be printed as one. Reuses place-names.js's USPS tables — the same
  // list that refuses "13, LA" governs what may lead a city here.
  const stateCodeOf = (value) => {
    const raw = clean(value).toUpperCase();
    if (STATE_CODES.has(raw)) return raw;
    const fullName = raw.toLowerCase();
    for (const [code, name] of STATE_NAMES) if (name === fullName) return code;
    return "";
  };
  const add = (value, appendState = false, repeatedCodes = null) => {
    // THE CANYON SHAPE: coverage arrives as {city, state} pairs as often as as
    // bare strings, and a pair names its own state. Read both; an object that
    // carries only a name behaves exactly like the string did (the build's NAP
    // state is NOT implied onto it — see the Eagle River contract in
    // content-inject-ai-fill.test.js).
    const record = (value && typeof value === "object") ? value : null;
    let name = clean(record ? (record.name || record.city) : value);
    if (!name) return;
    const ownState = record ? stateCodeOf(record.state) : "";
    // FLEET AUDIT 2026-09-02 (roofing, "FL Marco Island, FL Estero, …"):
    // harvested coverage segments ride in with machinery glued on. All of it
    // is REMOVED here — never reinterpreted — before the entry may print:
    //   · trailing sentence punctuation ("Cape Coral, FL." — the dot defeats
    //     the suffix test below and the NAP state was appended a SECOND time,
    //     printing "Cape Coral, FL., FL");
    //   · a ZIP in the middle ("FL 34104 Golden Gate" — a stripped ZIP, not a
    //     second town);
    //   · the coverage-glue phrase ("and surrounding areas Alva");
    //   · a regional qualifier welded to a town ("Southwest Florida
    //     Buckingham" is Buckingham);
    //   · a segment that IS only a state code ("FL") — not a place at all.
    name = name.replace(/[.…]+$/, "").trim();
    if (!name) return;
    if (STATE_CODES.has(name.toUpperCase())) return;
    // A SERVICE PHRASE IS NOT A SERVICE AREA (concrete: the declared market
    // "General Contractor in Southwest Florida" printed as
    // "General Contractor in Southwest Florida, FL" — a trade and a region
    // wearing a town's punctuation). A segment with a trade word AND a place
    // preposition makes a claim about services, not a coverage assertion.
    if (PLACE_PREPOSITION_RE.test(name) && PLACE_TRADE_WORD_RE.test(name)) return;
    // THE STATE CODE MAY LEAD A CITY ONLY WHEN THE EVIDENCE AGREES IT IS ONE.
    // The Canyon mirror published its coverage "UT St. George, UT Washington,
    // …" — code prepended — so the builder moves the code after each city.
    // But "LA" and "DE" are states AND the spacey first syllables of real
    // towns: a case-blind two-letter test published "La Quinta" as "Quinta,
    // LA" and "De Soto, TX" as "Soto, TX". Three independent signals must
    // agree before a leading token is treated as a prepended state: it is
    // written ALL-UPPERCASE (scrapes print codes uppercase; "La" and "De"
    // keep their interior case), it is a USPS code, and one of the build's
    // verified facts vouches for it — the NAP state, the entry's own pair
    // state, or the same code leading another city of the same declared list.
    const leading = /^([A-Z]{2})\s+(.+)$/.exec(name);
    let leadCode = leading && STATE_CODES.has(leading[1]) ? leading[1] : "";
    const vouched = leadCode
      && (leadCode === stateCodeOf(facts.state)
        || leadCode === ownState
        || (repeatedCodes != null && repeatedCodes.has(leadCode)));
    if (leadCode && vouched) {
      name = clean(leading[2]);
    }
    // A ZIP BETWEEN THE CODE AND THE TOWN: "FL 34104 Golden Gate" (and its
    // codeless cousin "34104 Golden Gate") is one place, Golden Gate. The ZIP
    // is stripped, never reinterpreted. When the code that led the segment
    // cleared the vouch above, leadCode is already remembered and stamps the
    // town's state at the append below; when it did not, the code is
    // unverifiable and is dropped with the ZIP rather than printed as a
    // guessed state.
    const zipLead = /^(?:([A-Z]{2})\s+)?\d{5}(?:-\d{4})?\s+(.+)$/.exec(name);
    if (zipLead) {
      if (zipLead[1] && STATE_CODES.has(zipLead[1]) && !leadCode) leadCode = zipLead[1];
      name = clean(zipLead[2]);
    }
    // COVERAGE GLUE: "and surrounding areas Alva" names Alva. Stripped both
    // ways, removal-only, and only when a town remains.
    name = name
      .replace(/^(?:and\s+|&\s+)?(?:the\s+)?surrounding\s+(?:areas?|communities?|towns?|cities)\s+(?:of\s+|around\s+|near\s+)?/i, "")
      .replace(/\s*,?\s*(?:and\s+)?(?:the\s+)?surrounding\s+(?:areas?|communities?|towns?|cities)\.?\s*$/i, "")
      .trim();
    // A REGIONAL QUALIFIER IS NOT PART OF THE TOWN: "Southwest Florida
    // Buckingham" is Buckingham (Lee County, FL). Removal-only, and only
    // while something besides the qualifier remains.
    name = name.replace(/^(?:(?:south|north|east|west)(?:east|west)?\s+florida)\s+/i, "").trim();
    if (!name) return;
    if (STATE_CODES.has(name.toUpperCase())) return;
    if (PLACE_PREPOSITION_RE.test(name) && PLACE_TRADE_WORD_RE.test(name)) return;
    // AND THE STATE IS APPENDED EXACTLY ONCE: a printed suffix is never
    // doubled, the pair's own code wins, and the NAP state fills only a bare
    // entry that asked for it (the declared service_area).
    if (ownState && !stateSuffix.test(name)) name = `${name}, ${ownState}`;
    if (leadCode && vouched && !stateSuffix.test(name)) name = `${name}, ${leadCode}`;
    if (appendState && stateCodeOf(facts.state) && !stateSuffix.test(name)) name = `${name}, ${stateCodeOf(facts.state)}`;
    const key = name.toLowerCase();
    // COMPARED ON THE TOWN, LIKE THE PRIDE FOOTPRINT: "St. George, UT" from the
    // declared string and a bare "St. George" from the coverage list are one
    // place printed twice in two formats, which reads as a bug.
    const town = name.split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key) || (town && seen.has(`town:${town}`))) return;
    seen.add(key);
    if (town) seen.add(`town:${town}`);
    out.push(name);
  };
  const declared = clean(facts.service_area);
  if (/^[A-Z]{2}\s+\S/.test(declared)) {
    // ONE COMMA-JOINED STRING, EACH CITY CARRYING ITS OWN CODE. Split before
    // every code so each city leaves this builder as its own "City, ST", and
    // remember which codes lead more than one city — repetition is one of the
    // signals that vouches the token is a state, not part of the town's name.
    const segments = declared.split(/,\s*(?=[A-Z]{2}\s+)/).map((a) => a.replace(/^,\s*/, ""));
    const repeated = new Set();
    const seenLeads = new Set();
    for (const seg of segments) {
      const m = /^([A-Z]{2})\s+/.exec(seg);
      const c = m && STATE_CODES.has(m[1]) ? m[1] : "";
      if (c && seenLeads.has(c)) repeated.add(c);
      if (c) seenLeads.add(c);
    }
    for (const area of segments) add(area, false, repeated);
  } else {
    const parts = declared.split(/\s*,\s*/).filter(Boolean);
    const code = (p) => (/^[A-Za-z]{2}$/.test(p) && STATE_CODES.has(p.toUpperCase())) ? p.toUpperCase() : "";
    const stateCount = parts.filter((p) => code(p)).length;
    if (parts.length >= 4 && stateCount >= 2 && stateCount >= parts.length - stateCount) {
      // THE SUFFIXED COUSIN: "St. George, UT, Washington, UT, Las Vegas, NV".
      // A part that is a bare USPS code finishes the city before it; any other
      // part is the next city. A trailing city with no code takes the build's
      // own state, exactly like the single-declared path below.
      let city = "";
      for (const part of parts) {
        const c = code(part);
        if (c) {
          add({ name: city, state: c });
          city = "";
        } else {
          if (city) add(city, true);
          city = part;
        }
      }
      if (city) add(city, true);
    } else {
      add(declared, true);
    }
  }
  for (const area of Array.isArray(areas) ? areas : []) add(area);
  return out.slice(0, 18);
}

/** A donor-agnostic stylesheet keyed off the theme's accent, with hard fallbacks.
 *
 * --wss-a resolves in three steps: (1) --wss-accent-hsl, the bare HSL triplet
 * theme.js appends on every themed build (client colour, else the donor
 * family's own accent, else vertical research — always warm, never generic
 * blue); (2) --accent, for shadcn donors that declare a triplet themselves;
 * (3) a warm brick constant, the last resort on pages no theme sheet reached.
 * The old `199 89% 48%` default was generic blue and is banned (2026-09-02
 * owner verdict: "the page fell back to GENERIC BLUE").
 */
const CONTENT_CSS = `
.wss-c,.wss-t{--wss-a:var(--wss-accent-hsl,var(--accent,8 61% 40%));--wss-gold:42 95% 54%}
.wss-c{padding:clamp(3rem,7vw,6rem) 1.25rem;font-family:inherit}
.wss-c__inner{max-width:1160px;margin:0 auto}
.wss-c__eyebrow{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;opacity:.62;margin:0 0 .6rem}
.wss-c h2{font-size:clamp(1.6rem,3.4vw,2.5rem);line-height:1.1;margin:0 0 1.6rem;font-family:var(--font-display,inherit);letter-spacing:-.02em}
.wss-c h3{font-size:1.06rem;margin:0 0 .4rem;font-family:var(--font-display,inherit)}
.wss-c p{margin:0 0 1rem;line-height:1.65;opacity:.86}
.wss-c__grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(255px,1fr))}
.wss-c__card{position:relative;overflow:hidden;border:1px solid currentColor;border-color:color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;padding:1.15rem 1.25rem;background:color-mix(in srgb,currentColor 3%,transparent)}
/* The card number is a DECORATIVE ghost numeral — large, muted, cornered —
   never a bare inline index that reads like dev breadcrumbs (2026-09-16
   owner verdict on the MR A/C mirror: "01 Full-Service AC Specialists"
   presented as code crumbs). */
.wss-c__num{position:absolute;top:.5rem;right:.8rem;font-size:clamp(2.2rem,4.5vw,3rem);line-height:.9;font-weight:800;letter-spacing:-.03em;opacity:.12;font-family:var(--font-display,inherit);pointer-events:none;-webkit-user-select:none;user-select:none}
.wss-c__rule{height:3px;width:56px;border-radius:2px;background:hsl(var(--wss-a));margin:0 0 1.4rem}
.wss-c__areas{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;padding:0;margin:0 0 1.5rem}
.wss-c__areas li{border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:999px;padding:.3rem .85rem;font-size:.88rem}
.wss-c__faq{border-top:1px solid color-mix(in srgb,currentColor 12%,transparent)}
.wss-c__faq details{border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);padding:1rem 0}
.wss-c__faq summary{cursor:pointer;font-weight:600;font-size:1.02rem;list-style:none;display:flex;justify-content:space-between;gap:1rem}
.wss-c__faq summary::-webkit-details-marker{display:none}
.wss-c__faq summary::after{content:"+";color:hsl(var(--wss-a));font-weight:700}
.wss-c__faq details[open] summary::after{content:"\\2013"}
.wss-c__faq h2.wss-c__q{font-size:1.02rem;margin:0;font-weight:600;font-family:inherit;letter-spacing:normal}
.wss-c__faq p{margin:.7rem 0 0;max-width:70ch}
.wss-c__quote{border-left:3px solid hsl(var(--wss-a));padding:.2rem 0 .2rem 1.1rem;margin:0 0 1rem}
.wss-c__quote cite{display:block;margin-top:.5rem;font-style:normal;font-size:.85rem;opacity:.65}
.wss-c__hours{width:100%;border-collapse:collapse;max-width:420px;font-size:.94rem}
.wss-c__hours th,.wss-c__hours td{text-align:left;padding:.42rem 0;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}
.wss-c__hours th{font-weight:600;opacity:.8;white-space:nowrap;padding-right:1.25rem;vertical-align:top}
.wss-c__hours td{vertical-align:top;width:100%}
.wss-c__map{margin-top:1.4rem;border-radius:12px;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 14%,transparent)}
.wss-c__map iframe{display:block;width:100%;height:340px;border:0}
.wss-c__dir{display:inline-block;margin-top:.9rem;font-weight:600;color:hsl(var(--wss-a));text-decoration:none;border-bottom:2px solid currentColor}
.wss-c__near{margin-top:1.6rem}
.wss-c__nearlist{list-style:none;margin:.7rem 0 0;padding:0;display:grid;gap:.4rem}
.wss-c__nearlist a{display:flex;align-items:center;gap:.6rem;padding:.5rem .75rem;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:10px;text-decoration:none;color:inherit;font-size:.9rem;transition:border-color .15s,background .15s}
.wss-c__nearlist a:hover{border-color:hsl(var(--wss-a));background:color-mix(in srgb,currentColor 5%,transparent)}
.wss-c__pin{display:inline-flex;color:hsl(var(--wss-a));flex:none}
.wss-c__pin svg{width:15px;height:15px}
.wss-c__neartown{font-weight:600}
.wss-c__neardist{margin-left:auto;font-size:.82rem;opacity:.6;white-space:nowrap}
.wss-c__split{display:grid;gap:2.5rem;grid-template-columns:1fr}
@media(min-width:900px){.wss-c__split{grid-template-columns:1.05fr .95fr}}
@media(prefers-reduced-motion:reduce){.wss-c *{transition:none!important;animation:none!important}}
.wss-c__stars{color:hsl(var(--wss-gold));letter-spacing:.12em;margin:0 0 .45rem;font-size:.95rem;text-shadow:0 1px 0 rgba(0,0,0,.14)}
.wss-c__who{display:flex;align-items:center;gap:.6rem;margin-top:.75rem}
.wss-c__face{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none;border:1px solid color-mix(in srgb,currentColor 18%,transparent)}
.wss-c__who cite{margin:0;font-style:normal;font-size:.9rem;font-weight:600;opacity:.9}
.wss-c__when{font-size:.8rem;opacity:.55;margin-left:auto;white-space:nowrap}
.wss-t{padding:3rem 1.25rem 0}
.wss-t__h{font-size:clamp(1.2rem,2.4vw,1.7rem);margin:0 0 1.1rem;letter-spacing:-.01em}
.wss-t__row{display:flex;flex-wrap:wrap;align-items:center;gap:.8rem 1.1rem;padding:.95rem 1.15rem;border-radius:14px;border:1px solid color-mix(in srgb,hsl(var(--wss-a)) 30%,transparent);background:linear-gradient(180deg,color-mix(in srgb,hsl(var(--wss-a)) 9%,transparent),color-mix(in srgb,hsl(var(--wss-a)) 3%,transparent));box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 30%,transparent)}
.wss-t__faces{display:flex}
.wss-t__faces>*{width:40px;height:40px;border-radius:50%;object-fit:cover;margin-left:-10px;border:2px solid color-mix(in srgb,currentColor 22%,transparent);box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;background:color-mix(in srgb,currentColor 8%,transparent)}
.wss-t__faces>*:first-child{margin-left:0}
.wss-t__f--ini{background:hsl(var(--wss-ini,210) 42% 46%)!important;color:#fff}
.wss-t__score{display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap}
.wss-t__stars{color:hsl(var(--wss-a));letter-spacing:.1em}
.wss-t__num{font-size:1.35rem;font-weight:700}
.wss-t__sub{font-size:.86rem;opacity:.65}
.wss-t__chip{font-size:.84rem;padding:.34rem .7rem;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);opacity:.9}
.wss-t__links{display:flex;flex-wrap:wrap;gap:.6rem .9rem;margin-top:1.15rem;align-items:center}
.wss-t__cta{font-weight:700;text-decoration:none;padding:.6rem 1.1rem;border-radius:8px;background:hsl(var(--wss-a));color:#fff}
.wss-t__link{display:inline-flex;align-items:center;gap:.5rem;font-size:.88rem;font-weight:600;text-decoration:none;color:inherit;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:999px;padding:.5rem 1rem;transition:border-color .15s,background .15s}
.wss-t__link:hover{border-color:hsl(var(--wss-a));background:color-mix(in srgb,currentColor 6%,transparent)}
.wss-t__link svg{width:16px;height:16px;flex:none}
.wss-s{padding:2.25rem 1.25rem 0}
.wss-s__h{font-size:clamp(1.05rem,2vw,1.35rem);margin:0 0 .9rem;letter-spacing:-.01em;opacity:.85}
.wss-s__row{display:flex;flex-wrap:wrap;gap:.6rem .7rem;align-items:center}
.wss-s__chip{display:inline-flex;align-items:center;gap:.55rem;text-decoration:none;color:inherit;font-size:.88rem;font-weight:600;padding:.5rem .95rem .5rem .55rem;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);transition:border-color .15s,transform .15s,background .15s}
.wss-s__chip:hover{border-color:hsl(var(--wss-a));background:color-mix(in srgb,currentColor 8%,transparent);transform:translateY(-1px)}
.wss-s__mark{display:inline-flex;width:26px;height:26px;flex:none;align-items:center;justify-content:center}
.wss-s__mark svg{width:24px;height:24px;display:block}
@media (prefers-reduced-motion:reduce){.wss-s__chip{transition:none}.wss-s__chip:hover{transform:none}}
.wss-p__creds{list-style:none;margin:0 0 1.4rem;padding:0;display:flex;flex-wrap:wrap;gap:.55rem .6rem}
.wss-p__cred{display:inline-flex;align-items:center;gap:.5rem;font-size:.9rem;font-weight:600;padding:.5rem .95rem;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:color-mix(in srgb,currentColor 4%,transparent)}
.wss-p__tick{display:inline-flex;color:hsl(var(--wss-a));flex:none}
.wss-p__tick svg{width:15px;height:15px}
.wss-p__badge{width:28px;height:28px;object-fit:contain;flex:none;border-radius:5px}
.wss-p__diffs{list-style:none;margin:0;padding:0;display:grid;gap:.55rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.wss-p__diffs li{position:relative;padding-left:1.15rem;line-height:1.55;opacity:.88;font-size:.95rem}
.wss-p__diffs li::before{content:"";position:absolute;left:0;top:.62em;width:7px;height:7px;border-radius:50%;background:hsl(var(--wss-a))}
.wss-p__foot{margin-top:1.9rem}
.wss-p__regions{font-weight:600;margin:0 0 .8rem;opacity:.9}
.wss-p__plan{display:flex;flex-direction:column}
.wss-p__price{font-size:1.5rem;font-weight:700;color:hsl(var(--wss-a));margin:0 0 .75rem;opacity:1;font-family:var(--font-display,inherit);letter-spacing:-.02em}
.wss-p__lines{list-style:none;margin:0;padding:0;display:grid;gap:.35rem;font-size:.9rem;opacity:.82}
.wss-p__lines li{padding-left:1rem;position:relative}
.wss-p__lines li::before{content:"\\2713";position:absolute;left:0;color:hsl(var(--wss-a));font-size:.8rem}
.wss-p__promos{list-style:none;margin:1.5rem 0 0;padding:0;display:flex;flex-wrap:wrap;gap:.6rem}
.wss-p__promos li{font-weight:700;font-size:.94rem;padding:.6rem 1.05rem;border-radius:10px;border:1px dashed hsl(var(--wss-a));background:color-mix(in srgb,hsl(var(--wss-a)) 8%,transparent)}
.wss-p__fin{margin:1.1rem 0 0;font-size:.92rem;opacity:.78}
/* A REVIEWER'S FACE HAS TO BE A CIRCLE. This block is injected into donor
   templates we do not control, and the plumbing donor ships an img rule that
   out-specifies ours: measured on the live Cardinal mirror, the faces computed
   border-radius:0px and rendered as square photo tiles with a hairline border,
   which reads as broken thumbnails rather than as people. Everything else in
   this stylesheet wins on document order; roundness is the one property a
   donor reliably takes back, so it is forced here and nowhere else. */
.wss-t__faces>*,.wss-c__face{border-radius:50%!important}
/* the review carousel — scroll-snap does the work, arrows are a courtesy */
.wss-rv{position:relative}
.wss-rv__track{display:flex;align-items:flex-start;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding:0 0 .6rem;-webkit-overflow-scrolling:touch;scrollbar-width:thin}
/* A card must never stretch to the tallest sibling (flex default) and a long
   review must never blow the card up: align-self+min-height:0 kill a donor
   min-height, the line-clamp caps the body so the strip stays one clean row. */
.wss-rv__track>.wss-c__quote{flex:0 0 min(360px,86%);scroll-snap-align:start;align-self:flex-start;min-height:0;margin:0;display:flex;flex-direction:column}
.wss-rv__track>.wss-c__quote>p:not(.wss-c__stars){display:-webkit-box;-webkit-line-clamp:9;line-clamp:9;-webkit-box-orient:vertical;overflow:hidden}
.wss-rv__nav{display:flex;gap:.5rem;justify-content:flex-end;margin-top:.6rem}
.wss-rv__btn{width:38px;height:38px;border-radius:50%;border:1px solid color-mix(in srgb,currentColor 25%,transparent);background:transparent;color:inherit;font-size:1.15rem;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:border-color .15s,background .15s}
.wss-rv__btn:hover{border-color:hsl(var(--wss-a));background:color-mix(in srgb,currentColor 6%,transparent)}
@media(prefers-reduced-motion:reduce){.wss-rv__track{scroll-behavior:auto}}
/* Apple Maps beside Google, statically in our own sections… */
.wss-c__dir+.wss-c__dir{margin-left:1.1rem}
.wss-c__nearlist li{display:flex;gap:.45rem;align-items:stretch}
.wss-c__nearlist li>a:first-child{flex:1}
.wss-c__nearlist a.wss-c__nearapple{flex:none;width:42px;justify-content:center;padding:.5rem 0}
.wss-c__nearapple svg{width:15px;height:15px}
/* …and as a runtime twin on the donor's own Google links (APPLE_TWIN_JS) */
.wss-apple-twin{display:inline-flex;align-items:center;gap:.4rem;margin-left:.55rem;font-size:.85em;font-weight:600;text-decoration:none;color:inherit;border:1px solid currentColor;border-radius:999px;padding:.28em .7em;opacity:.85;vertical-align:middle}
.wss-apple-twin:hover{opacity:1}
.wss-apple-twin svg{width:.95em;height:.95em;flex:none}
/* THE STOP-SCROLLING SIGNALS — the gold aggregate emblem, the one-band trust
   strip, the initials fallback and the credential jewellery. All generated per
   client from verified facts; gold is deliberately NOT the site accent, because
   a blue star reads as decoration and a gold star reads as a rating. */
.wss-t__score{display:flex;align-items:center;gap:.4rem .55rem;flex-wrap:wrap}
.wss-t__emblem{height:24px;width:auto;flex:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.18))}
.wss-t__emblem .wss-t__star{transform-box:fill-box;transform-origin:center;animation:wssStarPop .5s cubic-bezier(.2,.75,.3,1.3) both;animation-delay:calc(var(--wss-st-i,0)*.09s + .12s)}
@keyframes wssStarPop{0%{opacity:0;transform:scale(.3) translateY(3px)}60%{opacity:1;transform:scale(1.14)}100%{opacity:1;transform:none}}
.wss-t__num{font-size:1.5rem;font-weight:800;line-height:1;letter-spacing:-.01em}
.wss-t__badgechip{display:inline-flex;align-items:center;gap:.4rem;background:color-mix(in srgb,hsl(var(--wss-gold)) 13%,transparent);border-color:color-mix(in srgb,hsl(var(--wss-gold)) 46%,transparent);font-weight:600}
.wss-t__gi{display:inline-flex;color:hsl(var(--wss-gold));flex:none}
.wss-t__gi svg{width:15px;height:15px;display:block}
@media(prefers-reduced-motion:reduce){.wss-t__emblem .wss-t__star{animation:none}}
.wss-c__face--ini{display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#fff;background:hsl(var(--wss-ini,210) 42% 46%)}
/* Credential badges — jewellery, not icons. Materials from layered gradients in
   the client's accent family, the datum engraved, a sheen only on hover so proof
   shots stay still. Third-party artwork never appears unless client-hosted. */
.wss-p__badges{list-style:none;margin:0 0 1.5rem;padding:0;display:grid;gap:.8rem;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.wss-badge{position:relative;overflow:hidden;display:flex;align-items:center;gap:.7rem;min-height:78px;padding:.85rem 1rem;border-radius:12px;color:#fff;background:linear-gradient(145deg,color-mix(in srgb,hsl(var(--wss-a)) 82%,#000 4%),color-mix(in srgb,hsl(var(--wss-a)) 60%,#000 24%));border:1px solid color-mix(in srgb,#fff 22%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 40%,transparent),inset 0 -2px 6px color-mix(in srgb,#000 30%,transparent),0 4px 12px color-mix(in srgb,#000 18%,transparent)}
.wss-badge--seal,.wss-badge--shield{border-radius:16px;background:linear-gradient(145deg,color-mix(in srgb,hsl(var(--wss-a)) 78%,#000 6%),color-mix(in srgb,hsl(var(--wss-a)) 52%,#000 30%))}
.wss-badge__ico{flex:none;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;color:#fff}
.wss-badge--seal .wss-badge__ico,.wss-badge--shield .wss-badge__ico{color:hsl(var(--wss-gold))}
.wss-badge__ico svg{width:34px;height:34px;display:block}
.wss-badge__txt{display:flex;flex-direction:column;line-height:1.15;min-width:0}
.wss-badge__kicker{font-size:.6rem;letter-spacing:.16em;text-transform:uppercase;opacity:.82}
.wss-badge__datum{font-weight:800;font-size:1.02rem;text-shadow:0 1px 0 rgba(0,0,0,.35);overflow-wrap:anywhere}
.wss-badge img.wss-p__badge{width:40px;height:40px;object-fit:contain;background:#fff;border-radius:7px;padding:3px;flex:none}
.wss-badge__sheen{position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 32%,color-mix(in srgb,#fff 45%,transparent) 48%,transparent 64%);transform:translateX(-120%);transition:transform .85s ease}
.wss-badge:hover .wss-badge__sheen{transform:translateX(120%)}
@media(prefers-reduced-motion:reduce){.wss-badge__sheen{transition:none}}
@media(max-width:430px){.wss-p__badges{grid-template-columns:1fr 1fr;gap:.55rem}.wss-badge{min-height:70px;padding:.7rem;gap:.5rem}.wss-badge__ico,.wss-badge__ico svg{width:28px;height:28px}.wss-badge__datum{font-size:.9rem}}
/* AWARDS & CERTIFICATIONS STRIP — the client's OWN badge artwork, evenly sized.
   Renders only when 2+ credential images cleared prideBadgeImage (https +
   client's registrable domain — the gate that exists because Mastercool's mark
   once shipped as a client's identity). Marks share one height so a wide
   ribbon and a square seal read as one shelf; the white plinth keeps
   transparent PNGs legible on dark donors. Reuses the review carousel's track
   and arrows (scroll-snap does the work; CAROUSEL_JS click delegation is
   selector-generic). VISUAL ONLY — no schema.org node is ever emitted for
   these: self-published award/rating structured data is a schema violation. */
.wss-bs__track{list-style:none;margin:0}
.wss-bs__item{flex:0 0 auto;scroll-snap-align:start;display:flex;flex-direction:column;align-items:center;gap:.55rem;min-width:118px;max-width:180px;padding:.9rem .9rem .75rem;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:12px;background:color-mix(in srgb,currentColor 3%,transparent)}
.wss-bs__item img.wss-p__badge{width:auto;height:76px;max-width:150px;object-fit:contain;background:#fff;border-radius:8px;padding:5px;box-sizing:border-box}
.wss-bs__label{font-size:.78rem;font-weight:600;line-height:1.3;text-align:center;opacity:.85;overflow-wrap:anywhere}
@media(max-width:430px){.wss-bs__item{min-width:100px;padding:.7rem .7rem .6rem}.wss-bs__item img.wss-p__badge{height:60px;max-width:120px}}
/* MEET-THE-TEAM BAND — a REAL human/crew/van photograph of theirs, shown at
   full contrast (not just washed behind the hero). Their own picture only:
   the caller passes it solely from the ownership-gated photo bank, so this
   surface structurally cannot carry a stock person or another firm's crew. */
.wss-team__inner{display:grid;gap:1.5rem 2rem;grid-template-columns:1fr;align-items:center}
@media(min-width:720px){.wss-team__inner{grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr)}}
.wss-team__fig{margin:0;position:relative;border-radius:16px;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 14%,transparent);box-shadow:0 12px 34px color-mix(in srgb,#000 22%,transparent),inset 0 1px 0 color-mix(in srgb,#fff 22%,transparent)}
.wss-team__fig::after{content:"";position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 -60px 60px -40px color-mix(in srgb,hsl(var(--wss-a)) 40%,transparent)}
.wss-team__img{display:block;width:100%;height:auto;max-height:420px;object-fit:cover;aspect-ratio:4/3;background:color-mix(in srgb,currentColor 6%,transparent)}
.wss-team__body h2{margin:.2rem 0 0}
.wss-team__lead{margin:.9rem 0 0;font-size:1rem;line-height:1.6;opacity:.86;max-width:46ch}
@media(max-width:430px){.wss-team__img{max-height:280px}}
`.trim();

// Recognisable service marks on the quick-link buttons. Plain-text labels read
// as generic filler ("Directions" next to "Write a review" looks like scaffold
// copy — owner callout 2026-08-06); the mark makes each destination legible at
// a glance. Inline SVG only: no external fetch, works on every donor, inherits
// the page's currentColor where the mark is monochrome (Apple) and carries the
// official palette where the mark IS the palette (the Google G).
const ICONS = Object.freeze({
  google: `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`,
  apple: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.05 12.54c-.03-3.05 2.49-4.51 2.6-4.58-1.42-2.07-3.62-2.35-4.4-2.38-1.87-.19-3.65 1.1-4.6 1.1-.95 0-2.41-1.07-3.97-1.04-2.04.03-3.92 1.19-4.97 3.01-2.12 3.68-.54 9.13 1.53 12.11 1.01 1.46 2.21 3.09 3.79 3.03 1.52-.06 2.1-.98 3.94-.98 1.84 0 2.36.98 3.97.95 1.64-.03 2.68-1.49 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.41-.04-.02-3.19-1.22-3.23-4.86zM14.02 3.6c.84-1.02 1.4-2.43 1.25-3.6-1.2.05-2.66.8-3.53 1.82-.77.9-1.45 2.34-1.27 3.72 1.34.1 2.71-.68 3.55-1.94z"/></svg>`,
  gmaps: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#34A853" d="M12 2C8.13 2 5 5.13 5 9c0 1.74.63 3.34 1.68 4.57L12 22l5.32-8.43C18.37 12.34 19 10.74 19 9c0-3.87-3.13-7-7-7z"/><circle fill="#fff" cx="12" cy="9" r="2.6"/></svg>`,
});

/**
 * Brand marks for the social/trust bar, keyed to social-discovery's network
 * keys. RECOGNISABLE ON SIGHT is the whole point — the owner's line is "stacks
 * them all right below their hero with beautiful visual logos", and a row of
 * grey generic globes would say nothing. Each mark carries the platform's own
 * brand colour so the bar reads at a glance; the wordmark-free networks (BBB,
 * Angi, Houzz, Nextdoor) get a lettered tile in their brand colour, which is
 * how those brands present themselves anyway.
 */
const SOCIAL_ICONS = Object.freeze({
  facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="wssIg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".65" stop-color="#D62976"/><stop offset="1" stop-color="#962FBF"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6" fill="url(#wssIg)"/><circle cx="12" cy="12" r="4.6" fill="none" stroke="#fff" stroke-width="1.9"/><circle cx="17.6" cy="6.5" r="1.3" fill="#fff"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0000" d="M23.5 6.9a3 3 0 0 0-2.1-2.1C19.5 4.3 12 4.3 12 4.3s-7.5 0-9.4.5A3 3 0 0 0 .5 6.9C0 8.8 0 12 0 12s0 3.2.5 5.1a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.1.5-5.1s0-3.2-.5-5.1z"/><path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#0A66C2"/><path fill="#fff" d="M7.2 9.5H4.6V19h2.6zM5.9 4.9a1.5 1.5 0 1 0 0 3.1 1.5 1.5 0 0 0 0-3.1zM19.4 13.4c0-2.6-1.4-3.9-3.3-3.9-1.5 0-2.2.83-2.6 1.42V9.5H11V19h2.6v-5.1c0-1.24.63-1.86 1.6-1.86s1.6.62 1.6 1.86V19h2.6z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#010101" d="M16.6 2h-3v13.1a2.6 2.6 0 1 1-2.1-2.55V9.4a5.7 5.7 0 1 0 5.1 5.67V8.6a6.7 6.7 0 0 0 3.9 1.25V6.8a3.9 3.9 0 0 1-3.9-3.9z"/><path fill="#25F4EE" d="M15.6 1h-3v13.1a2.6 2.6 0 0 1-3.5 2.43A2.6 2.6 0 0 0 13.6 15V1z" opacity=".9"/></svg>`,
  twitter: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#000" d="M18.24 2H21l-6.55 7.48L22.5 22h-6.4l-4.7-6.15L5.9 22H3.14l7-8L1.5 2h6.56l4.25 5.62zm-1.1 18h1.53L7.02 3.6H5.38z"/></svg>`,
  yelp: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF1A1A" d="M11.2 2.3v8.9c0 .8-.9 1.2-1.5.7L5.3 8.5c-.5-.4-.5-1.1-.1-1.5A11 11 0 0 1 9.9 4c.6-.2 1.3.2 1.3.9zM10.6 13.9c.5.5.2 1.4-.5 1.6l-4.4 1.2c-.6.2-1.2-.3-1.2-.9a11 11 0 0 1 .4-3.2c.2-.6.9-.9 1.4-.5zM13.6 14.4l2.6 3.8c.4.5.1 1.2-.5 1.4a11 11 0 0 1-3.1.8c-.6 0-1.1-.5-1.1-1.1v-4.5c0-.9 1.1-1.2 1.6-.5zM14.5 12l4.4-1.5c.6-.2 1.2.2 1.2.8a11 11 0 0 1-.6 3.2c-.2.6-1 .8-1.4.4l-3.5-2.1c-.5-.3-.5-.6-.1-.8zM15 9.8l3.3-3c.5-.4.4-1.2-.2-1.5a11 11 0 0 0-2.6-1c-.6-.1-1.2.3-1.2.9v3.9c0 .8.2 1.1.7.7z"/></svg>`,
  bbb: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#00539B"/><text x="12" y="16" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="9" font-weight="700" fill="#fff">BBB</text></svg>`,
  angi: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#FF6153"/><text x="12" y="17" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">A</text></svg>`,
  nextdoor: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#8ED500"/><text x="12" y="17" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">N</text></svg>`,
  houzz: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#4DBC15"/><text x="12" y="17" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">h</text></svg>`,
});

// Placement repair for compiled-SPA donors. A Vite/React donor's index.html
// carries no static <footer> (the footer is rendered into #root at runtime), so
// a block appended before </body> lands BELOW the rendered footer and its
// copyright line. This moves it to just before the real footer once the app has
// mounted, and again whenever a route change re-creates the footer. It holds a
// direct reference to the node so a React unmount cannot orphan it, and the
// no-op guard (`f.previousElementSibling === node`) stops the MutationObserver
// its own insertBefore triggers from looping. Contains no `</` sequence, so it
// cannot terminate the host <script> early, and it is silent: any failure
// leaves the block where it already renders rather than logging a console error
// (renderCheck fails a build on a single console error).
// Moving an <iframe> in the DOM makes the browser re-navigate it, which aborts
// the request already in flight — renderCheck saw exactly one failed request,
// net::ERR_ABORTED on the injected coverage map, and failed the build. So on
// this path the map ships as `data-src` and the src is assigned ONCE, after the
// block reaches its final position (or after a 3s fallback, so the map still
// loads on a donor where no footer ever appears). One load, no abort.
//
// THE MOVE IS WHAT BREAKS HYDRATION, NOT THE BLOCK — measured 2026-08-11.
// ---------------------------------------------------------------------------
// wss-test-monolith-tattoo-co-nashville failed the render gate on an uncaught
// "Minified React error #418" (hydration mismatch). Bisected against the LIVE
// page by rewriting only the main document and leaving every asset on the real
// host, one variant per hypothesis:
//
//   baseline                       418 = YES
//   remove the .wss-content block  418 = no
//   KEEP the block, remove ONLY    418 = no      <- the answer
//     this relocation script
//   remove the injected JSON-LD    418 = YES
//   remove the chat widget         418 = YES
//   remove the icon <link>s        418 = YES
//
// So a block sitting quietly before </body> is harmless even on a donor whose
// hydration container IS the body. What React cannot survive is this script
// SPLICING that block between two siblings it is about to hydrate: on a
// prerendered donor (TanStack Start, `$_TSR`) DOMContentLoaded fires before the
// deferred module bundle runs, so the tree React finds is not the tree the
// server sent, and it throws #418 and regenerates.
//
// The fix is timing, not placement — and the timing has to be a SIGNAL, not a
// delay. The first attempt waited for the first mutation inside the container
// and moved 200ms later; measured against the live page five times, #418 still
// fired 2/5, while the same page with an 8-second delay fired 0/5 and the same
// page that never moved fired 0/5. A race, not a structure.
//
// So the trigger is a fact about the DOM: React writes `__reactFiber$…` and
// `__reactProps$…` onto every host node it hydrates. When the FOOTER we are
// about to insert before carries one, React has already walked past that node
// and committed it, and a sibling inserted there cannot corrupt a hydration
// that has finished with it. Measured on the live tattoo mirror: the footer
// appears in the DOM at 56ms and carries `__reactFiber$ze6e2l1g6k` at 322ms.
//
// If that signal never comes — a donor we wrongly read as prerendered, or a
// hydration that failed — the block is REVEALED WHERE IT IS and never moved.
// Below the footer is a cosmetic cost; a torn-down page is not.
//
// A plain SPA donor (empty #root, no SSR markers) keeps exactly its old
// behaviour, because there is nothing to hydrate and nothing to race.
//
// footer() skips any <footer> INSIDE our own block. buildTrustRail renders each
// review as `blockquote > footer.wss-c__who`, so the moment the block sits above
// the site footer, `document.querySelector("footer")` returns one of OUR
// footers, `node.contains(f)` is true and every later call gives up. Measured on
// the live page: six footers, the first five ours at y≈10.8k–11.7k, the real one
// at y=12483.
const HYDRATION_POLL_MS = 50;
const HYDRATION_POLL_TRIES = 160;   // 8 seconds, then reveal in place

function relocateJs(prerendered) {
  const pre = prerendered ? "true" : "false";
  return `<script>(function(){var node=document.querySelector(".wss-content");if(!node)return;var PRE=${pre};var armed=false;function arm(){if(armed)return;armed=true;node.style.display="";var f=node.querySelector("iframe[data-src]");while(f){f.setAttribute("src",f.getAttribute("data-src"));f.removeAttribute("data-src");f=node.querySelector("iframe[data-src]");}}function footer(){var l=document.querySelectorAll("#root footer");if(!l.length)l=document.querySelectorAll("footer");for(var i=0;i<l.length;i++){var el=l[i];if(node.contains(el))continue;if(el.closest&&el.closest(".wss-c"))continue;if(String(el.className||"").indexOf("wss-")===0)continue;return el;}return null;}function place(){var f=footer();if(!f||f===node||node.contains(f))return false;if(node.isConnected&&f.previousElementSibling===node)return true;var p=f.parentNode;if(!p)return false;p.insertBefore(node,f);return true;}function run(){try{if(place())arm();}catch(e){}}function watch(){try{var pending=null;var mo=new MutationObserver(function(){if(pending)return;pending=setTimeout(function(){pending=null;run();},80);});mo.observe(document.getElementById("root")||document.body,{childList:true,subtree:true});}catch(e){}}function hydrated(){var f=footer();if(!f)return false;for(var k in f){if(k.indexOf("__react")===0)return true;}return false;}var tries=0;function poll(){try{if(hydrated()){run();arm();watch();return;}}catch(e){}if(++tries>${HYDRATION_POLL_TRIES}){arm();return;}setTimeout(poll,${HYDRATION_POLL_MS});}if(!PRE){if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",run);}else{run();}window.addEventListener("load",run);setTimeout(arm,3000);watch();}else{poll();}})();<\/script>`;
}

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_ALIAS = { mon: "monday", tue: "tuesday", tues: "tuesday", wed: "wednesday", thu: "thursday", thur: "thursday", thurs: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };
const SCHEMA_DAY = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };

const PLACES_DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "9:05" from Google's {hour, minute} period point. */
function placesClock(p) {
  const h = Number(p && p.hour), m = Number(p && p.minute);
  if (!Number.isFinite(h)) return "";
  return `${((h + 11) % 12) + 1}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Title-case a normalized day key for display: "monday" -> "Monday". */
const dayLabel = (day) => (day ? day[0].toUpperCase() + day.slice(1) : "");

/**
 * Google publishes a day's hours as ONE string — "Monday: 8:30 AM – 5:00 PM" —
 * and that string arrived here intact, so every row of the rendered table had
 * the day crammed into the VALUE cell and the literal word "Hours" as its row
 * header, seven times over:
 *
 *     Hours | Monday: 8:30 AM - 5:00 PM
 *     Hours | Tuesday: 8:30 AM - 5:00 PM
 *
 * The same empty `day` silently cost us the structured data: buildJsonLd drops
 * any row whose day it cannot name, so `openingHoursSpecification` was omitted
 * ENTIRELY on every mirror built from a Places packet. Splitting the day off
 * here fixes the markup and the schema from one place, which is the only way
 * the two can be guaranteed to agree.
 *
 * A leading word that is not a day of the week is left alone — "Hours: by
 * appointment" is not a Tuesday, and inventing one would be a fabrication.
 */
function splitDayLine(line) {
  const text = clean(line);
  const m = /^([A-Za-z]+)\s*:\s*(\S.*)$/.exec(text);
  if (!m) return { day: "", text };
  const day = DAY_ALIAS[m[1].toLowerCase()] || m[1].toLowerCase();
  if (!DAY_ORDER.includes(day)) return { day: "", text };
  return { day, text: clean(m[2]) };
}

/**
 * A clock value that is safe to PRINT. The per-item loop below used to build
 * its text as `[h.open, h.close].join(" - ")`, and when a source shipped the
 * Google period OBJECTS ({hour, minute}) inside a mixed array — so the
 * whole-array period branch above it did not fire — String() did what String()
 * does and the contact block and footer of a live sandbox build (Better Fence,
 * 2026-08-20) rendered literally "[object Object] - [object Object]" as the
 * business's opening hours. An object with an hour is formatted through the
 * same placesClock every proper period goes through; any other object prints
 * NOTHING, because "[object Object]" is never a fact about a business.
 */
function printableClock(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && Number.isFinite(Number(v.hour))) return placesClock(v);
  return "";
}

/** Normalize the Genie's loose hours shapes into [{day, text}]. */
function normalizeHours(hours) {
  if (!hours) return [];
  const out = [];
  if (Array.isArray(hours)) {
    // GOOGLE PLACES PERIOD SHAPE. A business open around the clock is expressed
    // as ONE period that opens Sunday 00:00 and never closes — the shape below
    // rendered as a bare "1-day schedule" and lost the single most valuable
    // thing a plumber can say. An open with no close means 24 hours, not
    // midnight-to-midnight-nothing.
    const periods = hours.filter((h) => h && typeof h === "object" && h.open && typeof h.open === "object");
    if (periods.length && periods.length === hours.length) {
      const alwaysOpen = periods.length === 1 && !periods[0].close
        && Number(periods[0].open.hour) === 0 && Number(periods[0].open.minute || 0) === 0;
      if (alwaysOpen) return PLACES_DAY.map((day) => ({ day, text: "Open 24 hours" }));
      for (const p of periods) {
        const day = PLACES_DAY[Number(p.open.day)] || "";
        const opens = placesClock(p.open);
        const closes = p.close ? placesClock(p.close) : "";
        const text = closes ? `${opens} - ${closes}` : opens ? "Open 24 hours" : "";
        if (text) out.push({ day, text });
      }
      if (out.length) {
        return out.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
      }
    }
    for (const h of hours) {
      if (!h) continue;
      if (typeof h === "string") { out.push(splitDayLine(h)); continue; }
      const day = String(h.day || h.name || "").toLowerCase();
      const text = clean(
        (typeof h.text !== "object" && printableClock(h.text))
        || (typeof h.hours !== "object" && printableClock(h.hours))
        || [printableClock(h.open), printableClock(h.close)].filter(Boolean).join(" - "),
      );
      // An object that names no day can still carry one inside its text — the
      // same "Monday: 8:30 AM - 5:00 PM" line, one shape further out.
      if (!day) { if (text) out.push(splitDayLine(text)); continue; }
      if (text) out.push({ day: DAY_ALIAS[day] || day, text });
    }
  } else if (typeof hours === "object") {
    for (const [k, v] of Object.entries(hours)) {
      const day = DAY_ALIAS[String(k).toLowerCase()] || String(k).toLowerCase();
      const text = typeof v === "string"
        ? clean(v)
        : clean([printableClock(v && v.open), printableClock(v && v.close)].filter(Boolean).join(" - "));
      if (text) out.push({ day, text });
    }
  }
  return out
    // The last line of defence: whatever future shape arrives, a row that
    // stringified an object never reaches a rendered page.
    .filter((h) => h.text && !h.text.includes("[object ") && !String(h.day || "").includes("[object "))
    .sort((a, b) => (DAY_ORDER.indexOf(a.day) === -1 ? 99 : DAY_ORDER.indexOf(a.day)) - (DAY_ORDER.indexOf(b.day) === -1 ? 99 : DAY_ORDER.indexOf(b.day)));
}

/** Parse "7-5"/"7:00 AM - 5:00 PM" into ISO-ish open/close for schema. */
function schemaTime(text) {
  const m = String(text).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  const to24 = (h, min, mer, assumePm) => {
    let hh = parseInt(h, 10);
    const mm = min || "00";
    const M = (mer || "").toLowerCase();
    if (M === "pm" && hh < 12) hh += 12;
    else if (M === "am" && hh === 12) hh = 0;
    else if (!M && assumePm && hh < 8) hh += 12;
    return `${String(hh).padStart(2, "0")}:${mm}`;
  };
  return { opens: to24(m[1], m[2], m[3], false), closes: to24(m[4], m[5], m[6], true) };
}

/**
 * Build the authority content block. Returns "" when there is nothing
 * verified to show — an empty promise is worse than no section.
 */
// THE KEYED EMBED API 403s WHEN THE KEY ISN'T AUTHORISED, AND A 403 IS WORSE
// THAN A PLAIN MAP. Measured 2026-08-12 on Family Heating's rebuild: the
// /maps/embed/v1/place?key=… request answered http_403, which (a) tripped the
// render gate — one failed request AND one console error — so the whole build
// came back revealable:false with every other check green, and (b) paints a
// broken Google error frame for a real visitor, not a map. An earlier note here
// preferred the keyed form because the unkeyed one once looked blank while a key
// "sat unused"; but the key that is now wired is not authorised for the Embed
// API, and authorising it is a Google Cloud console change, not a build-time
// one. The keyless classic embed needs no key and cannot 403 — it is already
// exactly what authority-pages.js and local-seo.js ship — so this standardises
// on it rather than holding a build hostage to a mis-scoped key.
function mapEmbedSrc(query) {
  return `https://www.google.com/maps?q=${query}&amp;output=embed`;
}

/**
 * FAQs BUILT FROM VERIFIED FACTS — never invented, never "typical for the trade".
 *
 * Every answer here RESTATES something already proven about this business: the
 * hours Google published, the phone on their own site, the services scraped
 * from their own pages, the address behind the map. Nothing is added that the
 * render gate could not already back, so this cannot introduce an unverified
 * claim (the boundary [[wss-genie-fabricates-and-render-proof]] exists for).
 *
 * WHY IT IS WORTH DOING: a question a customer actually types — "are they open
 * right now", "do they cover my area", "what do they charge to come out" — is
 * how voice assistants and AI answers pick a local business. The 108-point
 * audit scores five separate points on exactly this (Q-format headings,
 * conversational answers, FAQPage, speakable, question anchors), and RiverCity
 * shipped zero FAQs because nothing in the LeadMiner lane supplies any.
 *
 * Supplied FAQs always win; this only fills a vacuum.
 */
function verifiedFaqs({ facts = {}, services = [], hours = [], areas = [] }) {
  const out = [];
  const name = clean(facts.business_name);
  const declaredAreas = verifiedServiceAreas(facts, areas);
  const phone = humanPhone(facts.phone);
  // A scraper-artifact address (frame-…@mhtml.blink) must not become the
  // client's contact channel in a generated answer — absent is honest.
  const email = isScraperArtifactEmail(facts.email) ? "" : clean(facts.email);
  const allDay = hours.length > 0 && hours.every((h) => /24 hours/i.test(h.text || ""));

  if (allDay && name) {
    out.push({
      q: `Is ${name} open 24 hours?`,
      a: `Yes. ${name} is open 24 hours a day, every day${phone ? `; call ${phone} at any hour` : ""}.`,
    });
  } else if (hours.length && name) {
    out.push({
      q: `What are ${name}'s hours?`,
      a: `${hours.map((h) => (h.day ? `${dayLabel(h.day)}: ${h.text}` : h.text)).join(". ")}.`,
    });
  }

  if (declaredAreas.length && name) {
    out.push({
      q: `What areas does ${name} serve?`,
      a: `${name} lists ${declaredAreas.join(", ")} as ${declaredAreas.length === 1 ? "its service area" : "service areas"}.`,
    });
  }

  if (services.length && name) {
    const list = services.slice(0, 8).map((s) => s.name).filter(Boolean);
    if (list.length) {
      out.push({
        q: `What services does ${name} offer?`,
        a: `${list.slice(0, -1).join(", ")}${list.length > 1 ? `, and ${list[list.length - 1]}` : list[0]}.`,
      });
    }
  }

  if ((phone || email) && name) {
    const methods = [phone ? `call ${phone}` : "", email ? `email ${email}` : ""].filter(Boolean);
    out.push({
      q: `How do I contact ${name}?`,
      a: `${methods.join(" or ").replace(/^./, (c) => c.toUpperCase())}.`,
    });
  }

  const rating = Number(facts.rating);
  const count = Number(facts.review_count);
  if (name && Number.isFinite(rating) && rating > 0 && Number.isFinite(count) && count > 0) {
    out.push({
      q: `Is ${name} well reviewed?`,
      a: `${name} holds a ${rating.toFixed(1)}-star rating across ${Math.trunc(count)} Google reviews.`,
    });
  }

  return out;
}

/** "June 2026" from an ISO timestamp; "" when the date is absent or unparseable. */
function monthYear(iso) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** ★★★★★ / ★★★★☆ — drawn, never described, so it survives plain-text extraction. */
function stars(n) {
  const k = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return "★".repeat(k) + "☆".repeat(5 - k);
}

/** "1,212" — the count the owner's audit wrote by hand, grouped for the eye. */
function groupThousands(n) {
  const v = Math.trunc(Number(n) || 0);
  return v.toLocaleString("en-US");
}

/**
 * THE GOLD FIVE-STAR EMBLEM, generated from the real rating.
 *
 * The owner's audit: our 4.9 was "buried in body copy with no star icons, no
 * badge, no contrast" while a stronger site "puts a gold-star graphic in the
 * header before any scroll". This draws that graphic — inline SVG so it needs
 * no font and no fetch, GOLD so it reads as a rating not a flourish, and the
 * fifth star fills only to the FRACTION of the score (4.9 → four solid plus one
 * 90%-filled) so the emblem can never overstate the number it was built from.
 * The caller renders it ONLY when a verified rating and count are both held.
 */
function starEmblemSvg(rating) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.floor(r + 1e-9);
  const frac = r - full;
  const W = 24, GAP = 3, N = 5;
  const total = N * W + (N - 1) * GAP;
  const D = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
  let cells = "";
  for (let i = 0; i < N; i++) {
    const x = i * (W + GAP);
    const fillFrac = i < full ? 1 : (i === full ? frac : 0);
    let fill = `<path d="${D}" fill="hsl(var(--wss-gold))" opacity=".18"/>`;
    if (fillFrac >= 1) {
      fill += `<path d="${D}" fill="url(#wssGoldGrad)"/>`;
    } else if (fillFrac > 0) {
      const w = (fillFrac * W).toFixed(2);
      fill += `<clipPath id="wssStarClip${i}"><rect x="0" y="0" width="${w}" height="24"/></clipPath>`
        + `<path d="${D}" fill="url(#wssGoldGrad)" clip-path="url(#wssStarClip${i})"/>`;
    }
    fill += `<path d="${D}" fill="none" stroke="hsl(var(--wss-gold))" stroke-width="1" opacity=".5"/>`;
    cells += `<g transform="translate(${x},0)"><g class="wss-t__star" style="--wss-st-i:${i}">${fill}</g></g>`;
  }
  return `<svg class="wss-t__emblem" viewBox="0 0 ${total} 24" width="${total}" height="24" role="img" aria-label="Rated ${r.toFixed(1)} out of 5 stars">`
    + `<defs><linearGradient id="wssGoldGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD873"/><stop offset=".5" stop-color="#F5B01C"/><stop offset="1" stop-color="#DE9209"/></linearGradient></defs>${cells}</svg>`;
}

/** "AB" from "Alice Baker"; "" when there is no usable name. */
function initialsOf(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const a = parts[0][0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

/** A stable hue per reviewer so the initials discs vary without a palette. */
function hueOf(s) {
  let h = 0;
  const t = String(s || "");
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * A reviewer's avatar: their real Google-served photo when we hold it, else a
 * generated initials disc — NEVER a stock face. The caller only ever passes a
 * googleusercontent avatarUrl (validated at intake), so this cannot smuggle a
 * stranger's photo onto the page; anything without one falls to initials.
 */
function avatarDisc(review, cls) {
  const url = clean(review && review.avatarUrl);
  if (url) return `<img class="${cls}" src="${esc(url)}" alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer">`;
  const ini = initialsOf(review && review.author);
  if (!ini) return "";
  return `<span class="${cls} ${cls}--ini" aria-hidden="true" style="--wss-ini:${hueOf(review && review.author)}">${esc(ini)}</span>`;
}

// Decorative glyphs for the credential badges and the strip's pride chips.
// Inline, currentColor, no fetch. They dress the fact; the fact is the text.
const GLYPH = Object.freeze({
  seal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M8.4 14.5 7 22l5-2.6L17 22l-1.4-7.5"/><path d="M12 6.4l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2L8.8 8.7l2.2-.3z" fill="currentColor" stroke="none"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5z"/><path d="m8.5 12 2.3 2.3L16 9"/></svg>`,
  plate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="6" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="6" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="17" r="1" fill="currentColor" stroke="none"/><path d="M8 11h8M8 14h5"/></svg>`,
  lozenge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 2.6 3.6-.3-.3 3.6L20.5 12l-2.6 2.5.3 3.6-3.6-.3L12 21l-2.5-2.6-3.6.3.3-3.6L3.5 12l2.6-2.5-.3-3.6 3.6.3z"/><path d="m9 12 2 2 4-4"/></svg>`,
});

/**
 * Which shape a credential wears. Purely visual — it never changes the words,
 * only the jewellery around them, so a mis-classification is a cosmetic choice
 * and never a truth error.
 */
function credentialKind(label) {
  const t = String(label || "").toLowerCase();
  if (/\b(daikin|trane|carrier|lennox|rheem|goodman|bryant|fujitsu|mitsubishi|american standard|amana|york|coleman|ruud|navien|nate|epa)\b/.test(t)
    || /dealer|authorized|factory|certified|certification/.test(t)) return "lozenge";
  if (/warrant|guarantee|money.?back|satisfaction/.test(t)) return "seal";
  if (/insur|bonded|shield|protect/.test(t)) return "shield";
  if (/licen[sc]e|permit|registration|reg\.?\s*#|#\s*\d|\bno\.?\s*\d/.test(t)) return "plate";
  return "plate";
}

/**
 * One designed credential badge. THE TRUTH LAW IS ABSOLUTE HERE: the datum is
 * printed as OUR engraved text, and a manufacturer's own artwork is refused —
 * `cred.image` is only ever populated when the asset is hosted on the client's
 * OWN domain (prideBadgeImage), which is why serving it here cannot repeat the
 * Mastercool/Blogger incident. No placeholder badge is ever fabricated: a badge
 * exists only because a verified pride fact does.
 */
function buildCredentialBadge(cred) {
  const label = clean(cred && cred.label);
  if (!label) return "";
  const image = clean(cred && cred.image);
  const kind = credentialKind(label);
  const face = image
    ? `<img class="wss-p__badge" src="${esc(image)}" alt="" width="40" height="40" loading="lazy">`
    : `<span class="wss-badge__ico" aria-hidden="true">${GLYPH[kind] || GLYPH.plate}</span>`;
  return `<li class="wss-p__cred wss-badge wss-badge--${kind}" data-wss-pride="credential">${face}`
    + `<span class="wss-badge__txt"><span class="wss-badge__datum">${esc(label)}</span></span>`
    + `<span class="wss-badge__sheen" aria-hidden="true"></span></li>`;
}

/**
 * The trust rail: what a stranger checks before phoning a plumber. Every item
 * is built from a VERIFIED fact and omitted entirely when that fact is absent —
 * no "Licensed & Insured" badge we cannot prove, which is exactly what the
 * unverified_claims_omitted gate exists to stop.
 */
function buildTrustRail({ facts = {}, reviews = [], hours = [], phoneDigits = "", trustAtoms = {} }) {
  const placeId = clean(facts.place_id);
  const rating = Number(facts.rating);
  const count = Number(facts.review_count);
  const hasScore = Number.isFinite(rating) && rating > 0 && Number.isFinite(count) && count > 0;
  const geo = Number.isFinite(Number(facts.latitude)) && Number.isFinite(Number(facts.longitude))
    ? `${Number(facts.latitude)},${Number(facts.longitude)}`
    : "";
  const addr = [clean(facts.address), clean(facts.city), clean(facts.state), clean(facts.postal_code)]
    .filter(Boolean).join(", ");
  const dest = encodeURIComponent(addr || geo);

  const chips = [];
  if (hasScore) {
    // The gold emblem, then the number, then the count — the exact order the
    // owner's audit named ("4.9 · 1,212 Google Reviews"), drawn not described.
    chips.push(`<div class="wss-t__score">${starEmblemSvg(rating)}<span class="wss-t__num">${esc(rating.toFixed(1))}</span><span class="wss-t__sub">${esc(groupThousands(count))} Google reviews</span></div>`);
  }
  // ONE BAND, NOT THREE MENTIONS. Years-in-business and Licensed & Insured are
  // pulled UP into this strip from the credentials wall so the rating, the
  // tenure and the licence sit together under the hero — the owner's 2026-08-12
  // audit item. Each atom is gated on its own proven pride fact upstream
  // (buildPrideSections); nothing here is invented, and an unproven fact is
  // simply absent. The datum leads; the glyph only dresses it.
  for (const s of (Array.isArray(trustAtoms.standing) ? trustAtoms.standing : [])) {
    if (clean(s)) chips.push(`<div class="wss-t__chip wss-t__badgechip" data-wss-pride="standing"><span class="wss-t__gi" aria-hidden="true">${GLYPH.seal}</span>${esc(s)}</div>`);
  }
  if (clean(trustAtoms.licensedInsured)) {
    chips.push(`<div class="wss-t__chip wss-t__badgechip" data-wss-pride="credential"><span class="wss-t__gi" aria-hidden="true">${GLYPH.shield}</span>${esc(trustAtoms.licensedInsured)}</div>`);
  }
  // Open 24 hours is a fact worth stating plainly — it is the single most
  // common reason someone calls a plumber at 2am instead of the next name down.
  const allDay = hours.length > 0 && hours.every((h) => /24 hours/i.test(h.text || ""));
  if (allDay) chips.push(`<div class="wss-t__chip">Open 24 hours</div>`);
  else if (hours.length) chips.push(`<div class="wss-t__chip">${esc(hours.length)}-day schedule below</div>`);
  if (clean(facts.city) && clean(facts.state)) {
    chips.push(`<div class="wss-t__chip">Located in ${esc(clean(facts.city))}, ${esc(clean(facts.state))}</div>`);
  }

  const links = [];
  if (phoneDigits) links.push(`<a class="wss-t__cta" href="tel:${esc(phoneDigits)}">Call ${esc(humanPhone(facts.phone) || phoneDigits)}</a>`);
  if (dest) {
    links.push(`<a class="wss-t__link" href="https://www.google.com/maps/dir/?api=1&amp;destination=${dest}${placeId ? `&amp;destination_place_id=${esc(placeId)}` : ""}" target="_blank" rel="noopener noreferrer">${ICONS.gmaps}Google Maps Directions</a>`);
    // Apple Maps is the default on every iPhone; a Google-only directions link
    // sends half the callers through a redirect they did not ask for.
    links.push(`<a class="wss-t__link" href="https://maps.apple.com/?daddr=${dest}" target="_blank" rel="noopener noreferrer">${ICONS.apple}Apple Maps</a>`);
  }
  if (placeId) {
    links.push(`<a class="wss-t__link" href="https://search.google.com/local/writereview?placeid=${esc(placeId)}" target="_blank" rel="noopener noreferrer">${ICONS.google}Write a Google Review</a>`);
  }
  if (clean(facts.profile_url)) {
    links.push(`<a class="wss-t__link" href="${esc(facts.profile_url)}" target="_blank" rel="noopener noreferrer">${ICONS.google}Google Business Profile</a>`);
  }

  // Faces first — a real Google photo where we hold one, initials otherwise
  // (never a stock face). Reviewers with a name but no avatar still count, so
  // the pile fills even when Google served us only some of the photos.
  const faces = reviews.filter((r) => clean(r.avatarUrl) || clean(r.author)).slice(0, 10);
  const faceRail = faces.length
    ? `<div class="wss-t__faces" aria-hidden="true">${faces.map((r) => avatarDisc(r, "wss-t__f")).join("")}</div>`
    : "";

  if (!chips.length && !links.length) return "";
  return `<section class="wss-t" id="trust" aria-labelledby="wss-trust-h">
<div class="wss-c__inner">
<h2 id="wss-trust-h" class="wss-t__h">Why people call ${esc(clean(facts.business_name) || "us")}</h2>
<div class="wss-t__row">${faceRail}${chips.join("\n")}</div>
<div class="wss-t__links">${links.join("")}</div>
</div>
</section>`;
}

// ---------------------------------------------------------------------------
// THE OWNER'S PRIDE POINTS
// ---------------------------------------------------------------------------
//
// We audited two rebuilds against the originals and both FAILED for the same
// reason: the template kept the broad service labels and dropped exactly the
// things the owner would fight for — their motto, the Silver and Gold plans
// with their real prices, the authorized-Daikin relationship, the licence
// number, the live promotions, and a twelve-city footprint collapsed to one
// town. lib/owner-pride.js was written to fix that and then never plugged in:
// its block reached Riley's call brief and the hero tagline and nothing else.
// This is the renderer it was waiting for.
//
// EVERYTHING HERE IS ALREADY PROVEN. prideFromExtraction only emits an entry
// that cleared status FOUND + confidence above low + an evidence quote with a
// source URL, and it emits the client's own words. So this function composes
// nothing, defaults nothing and rewrites nothing: it escapes the value and
// prints it, or prints no section at all.
//
// A CREDENTIAL IS NOT AN IDENTITY. Labels render as TEXT. An <img> is emitted
// only when the badge asset is hosted on the client's own registrable domain —
// a manufacturer's mark served from the manufacturer's host is the
// manufacturer's mark, and this codebase has already served Mastercool's and
// Google Blogger's marks as a client's own logo with every gate green.
// owner-pride blanks `image` for anything off-domain; this re-checks it here
// rather than trusting the request, because the request is caller input.
// ---------------------------------------------------------------------------
// TRUST BADGES (optional client-supplied fields) + FINANCING (optional module)
// ---------------------------------------------------------------------------
//
// Both are caller-supplied OPTIONAL facts: `license_number` / `insured` /
// `associations` and the `financing` object. The truth law holds as everywhere
// else on this file — a field that is absent or false renders NOTHING, and no
// line of copy is invented around what is present. These are NEW self-contained
// renderers: they read facts and return markup or "", and touch no other
// section's builder.

/**
 * The trust-badge rail. Renders only what the client supplied:
 *   · `license_number` — "License #…" engraved on the plate glyph.
 *   · `insured: true`  — an "Insured" shield. `false`/absent renders nothing;
 *     we never print an insurance claim we were not given.
 *   · `associations`   — one seal chip per name, verbatim.
 * Absent everywhere => "" (no section, no placeholder).
 */
function buildTrustBadges({ facts = {} } = {}) {
  const licenseNumber = clean(facts.license_number);
  const insured = facts.insured === true;
  const associations = (Array.isArray(facts.associations) ? facts.associations : [])
    .map((name) => clean(typeof name === "string" ? name : (name && name.name)))
    .filter(Boolean)
    .slice(0, 12);
  if (!licenseNumber && !insured && !associations.length) return "";

  const badges = [];
  if (licenseNumber) {
    badges.push(`<li class="wss-t__chip wss-t__badgechip" data-wss-trustbadge="license"><span class="wss-t__gi" aria-hidden="true">${GLYPH.plate}</span>License <span class="wss-tb__datum">${esc(licenseNumber)}</span></li>`);
  }
  if (insured) {
    badges.push(`<li class="wss-t__chip wss-t__badgechip" data-wss-trustbadge="insured"><span class="wss-t__gi" aria-hidden="true">${GLYPH.shield}</span>Insured</li>`);
  }
  for (const name of associations) {
    badges.push(`<li class="wss-t__chip wss-t__badgechip" data-wss-trustbadge="association"><span class="wss-t__gi" aria-hidden="true">${GLYPH.seal}</span>${esc(name)}</li>`);
  }

  return `<section class="wss-c wss-tb" id="trust-badges" aria-labelledby="wss-tb-h">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">Credentials</p>
<div class="wss-c__rule"></div>
<h2 id="wss-tb-h">Licensed, insured, and accountable</h2>
<ul class="wss-t__row wss-tb__rail" style="list-style:none;margin:0">${badges.join("\n")}</ul>
</div>
</section>`;
}

/**
 * The financing module. Renders ONLY when `financing.enabled === true` AND an
 * https `apply_url` is supplied — a financing claim without a working door is
 * a dead CTA, and we do not ship those. `partner` and `payment_methods` are
 * optional dressing on the same honest sentence: financing is AVAILABLE, the
 * apply link goes where the client pointed it.
 */
function buildFinancingSection({ facts = {} } = {}) {
  const financing = facts.financing;
  if (!financing || typeof financing !== "object" || Array.isArray(financing)) return "";
  if (financing.enabled !== true) return "";
  const applyUrl = clean(financing.apply_url);
  if (!/^https:\/\//i.test(applyUrl)) return "";
  const partner = clean(financing.partner);
  const methods = (Array.isArray(financing.payment_methods) ? financing.payment_methods : [])
    .map((m) => clean(typeof m === "string" ? m : (m && m.name)))
    .filter(Boolean)
    .slice(0, 8);

  const copy = partner
    ? `Spread the cost of your project with financing through ${partner}.`
    : "Spread the cost of your project — financing is available.";
  return `<section class="wss-c wss-fin" id="financing" aria-labelledby="wss-fin-h" data-wss-financing>
<div class="wss-c__inner">
<p class="wss-c__eyebrow">Financing</p>
<div class="wss-c__rule"></div>
<h2 id="wss-fin-h">Financing available</h2>
<p>${esc(copy)}</p>
${methods.length ? `<ul class="wss-fin__methods" style="list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;padding:0;margin:0 0 1.15rem">${methods.map((m) => `<li class="wss-t__chip">${esc(m)}</li>`).join("")}</ul>` : ""}
<p><a class="wss-t__cta" href="${esc(applyUrl)}" target="_blank" rel="noopener noreferrer nofollow">Apply for financing</a></p>
</div>
</section>`;
}

function clientRegistrable(facts = {}) {
  const raw = String(facts.website || facts.current_website || facts.site || "").trim();
  if (!raw) return "";
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.split(".").slice(-2).join(".");
  } catch { return ""; }
}

function prideBadgeImage(image, ownDomain) {
  const url = String(image || "").trim();
  if (!url || !ownDomain) return "";
  if (!/^https:\/\//i.test(url)) return "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.split(".").slice(-2).join(".") === ownDomain ? url : "";
  } catch { return ""; }
}

/**
 * buildPrideSections({ pride, facts, alreadyListedAreas })
 *
 * Returns { credentials, offers, trustAtoms } — the first two may be "". Two
 * sections rather than one, and named rather than positional, because they
 * belong in different places on the page: credentials are trust and sit up with
 * the rail, while the plans carry REAL PRICES and earn their own weight further
 * down. `trustAtoms` are the glance facts (tenure, licensed/insured) the trust
 * strip pulls up under the hero so they are not scattered down the page.
 * "$22.95 per system per month" is the most specific true sentence on the page
 * and the one a competitor's template cannot fake.
 */
function buildPrideSections({ pride, facts = {}, alreadyListedAreas = [] }) {
  const sections = (pride && pride.sections) || null;
  const emptyAtoms = { standing: [], licensedInsured: "" };
  if (!sections) return { credentials: "", offers: "", trustAtoms: emptyAtoms };
  const out = { credentials: "", offers: "" };
  const ownDomain = clientRegistrable(facts);
  const name = clean(facts.business_name) || "us";

  const rawCreds = (Array.isArray(sections.credentials) ? sections.credentials : [])
    .map((c) => ({ label: clean(c && c.label), image: prideBadgeImage(c && c.image, ownDomain) }))
    .filter((c) => c.label && !carriesTemplateToken(c.label));
  // LICENSED & INSURED IS A GLANCE FACT, NOT JEWELLERY. It carries no datum to
  // engrave, so it belongs in the trust strip under the hero (promoted into
  // trustAtoms below), not as a badge in the wall. A licence NUMBER — something
  // to stamp — stays a plate. So the wall keeps credentials that carry a datum
  // and the bare licensed/insured claim rides up into the strip as one chip.
  const isLicInsured = (l) => /insur/i.test(l) || (/licen[sc]/i.test(l) && !/\d/.test(l));
  // THE BADGE SHELF EARNS ITS OWN SECTION AT TWO MARKS. texasbestfence.com's
  // homepage carries a large carousel of award/certification badges (AFA Pro
  // Award, BBB A+, Best of Denton County…) — a trust surface the mirror used to
  // shrink to a 40px thumbnail inside one chip. Credentials whose artwork
  // cleared prideBadgeImage above (client-hosted, https — NEVER a
  // manufacturer's own host, and NEVER anywhere near the logo/identity path)
  // move out of the chip wall and into an evenly-sized labeled strip. ONE image
  // stays a chip thumbnail as before; ZERO images renders no strip at all.
  // THE PRIDE CAPS LIVE IN THE SCHEMA, NOT HERE. The mirror-request schema
  // bounds the pride lists (credentials 24, differentiators 24, promotions 12,
  // plans 12) and the producer truncates to those caps before the request is
  // sent — so the renderer renders EVERY item it is handed. The old hard-coded
  // 6/4/8 slices here silently re-truncated rich, verified content that had
  // already cleared the schema, which is the exact cut the owner vetoed: "If
  // they have more content than we can handle, we still dump it in."
  const stripCreds = rawCreds.filter((c) => c.image && !isLicInsured(c.label));
  const stripActive = stripCreds.length >= 2;
  const licensedInsured = (rawCreds.find((c) => isLicInsured(c.label)) || {}).label || "";
  const creds = rawCreds.filter((c) => !isLicInsured(c.label) && !(stripActive && c.image));
  const diffs = (Array.isArray(sections.differentiators) ? sections.differentiators : [])
    .map((d) => clean(d && d.text))
    .filter((t) => t && !carriesTemplateToken(t));
  // Their own heritage and ownership, each a chip of its own — promoted into
  // the trust strip (trustAtoms) rather than rendered here, so tenure sits
  // beside the rating under the hero. NOT welded into one sentence: "Since
  // 2011" and "Family-owned" are two separate proven facts with two separate
  // evidence quotes, and joining them would be us writing a claim neither
  // source made. Heritage leads so the years read first.
  const standing = [sections.heritage, sections.ownership]
    .map((e) => clean(e && e.value))
    .filter(Boolean);

  // The footprint they publish themselves. Towns already printed by the
  // coverage section are dropped here so the page never lists a place twice.
  //
  // COMPARED ON THE TOWN, NOT THE STRING. The extraction writes "Prairieville,
  // LA" and the coverage list writes "Prairieville"; a raw string compare
  // dedupes nothing and the page prints the same town twice in two different
  // formats, which reads as a bug rather than as coverage.
  const townKey = (s) => String(s || "").split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seenArea = new Set(alreadyListedAreas.map(townKey).filter(Boolean));
  const fp = sections.footprint || {};
  const cities = filterPlaceNames((Array.isArray(fp.cities) ? fp.cities : []).map(clean).filter(Boolean))
    .kept.filter((c) => !seenArea.has(townKey(c))).slice(0, 16);
  const regions = filterPlaceNames((Array.isArray(fp.regions) ? fp.regions : []).map(clean).filter(Boolean))
    .kept.slice(0, 6);

  if (creds.length || diffs.length || cities.length || regions.length) {
    out.credentials = `<section class="wss-c wss-p" id="credentials" aria-labelledby="wss-pride-h" data-wss-pride="block">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">Credentials</p>
<div class="wss-c__rule"></div>
<h2 id="wss-pride-h">What ${esc(name)} brings to the job</h2>
${creds.length ? `<ul class="wss-p__badges">
${creds.map((c) => buildCredentialBadge(c)).join("\n")}
</ul>` : ""}
${diffs.length ? `<ul class="wss-p__diffs">${diffs.map((d) => `<li data-wss-pride="differentiator">${esc(d)}</li>`).join("")}</ul>` : ""}
${cities.length || regions.length ? `<div class="wss-p__foot">
<p class="wss-c__eyebrow">Where they work</p>
${regions.length ? `<p class="wss-p__regions">${regions.map((r) => esc(r)).join(" · ")}</p>` : ""}
${cities.length ? `<ul class="wss-c__areas">${cities.map((c) => `<li class="wss-p__city" data-wss-pride="city">${esc(c)}</li>`).join("")}</ul>` : ""}
</div>` : ""}
</div>
</section>`;
  }

  // -- plans, promotions, financing ------------------------------------------
  const plans = (Array.isArray(sections.plans) ? sections.plans : [])
    .map((p) => ({
      name: clean(p && p.name),
      price: clean(p && p.price),
      details: (Array.isArray(p && p.details) ? p.details : []).map(clean).filter(Boolean).slice(0, 5),
    }))
    // A plan without its real price is not printed. owner-pride already
    // refuses one; the renderer refuses it again because half a plan on a page
    // is an invitation for the reader to invent the other half.
    .filter((p) => p.name && p.price && !carriesTemplateToken(p.name) && !carriesTemplateToken(p.price));
  const promos = (Array.isArray(sections.promotions) ? sections.promotions : [])
    .map((p) => clean(p && p.text)).filter((t) => t && !carriesTemplateToken(t));
  const financing = clean(sections.financing && sections.financing.value);

  if (plans.length || promos.length || financing) {
    out.offers = `<section class="wss-c wss-p" id="plans" aria-labelledby="wss-plans-h" data-wss-pride="offers">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">${plans.length ? "Plans &amp; pricing" : "Current offers"}</p>
<div class="wss-c__rule"></div>
<h2 id="wss-plans-h">${plans.length ? "Maintenance plans" : "Offers"}</h2>
${plans.length ? `<div class="wss-c__grid">
${plans.map((p) => `<article class="wss-c__card wss-p__plan" data-wss-pride="plan"><h3>${esc(p.name)}</h3><p class="wss-p__price">${esc(p.price)}</p>${p.details.length ? `<ul class="wss-p__lines">${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}</article>`).join("\n")}
</div>` : ""}
${promos.length ? `<ul class="wss-p__promos">${promos.map((t) => `<li data-wss-pride="promotion">${esc(t)}</li>`).join("")}</ul>` : ""}
${financing ? `<p class="wss-p__fin" data-wss-pride="financing">${esc(financing)}</p>` : ""}
</div>
</section>`;
  }

  // -- the badge strip ------------------------------------------------------
  // Their own award/certification artwork as a shelf of evenly sized marks.
  // Labels stay VERBATIM under each mark (badge artwork is often unreadable at
  // strip size, and the label is the proven fact). data-wss-pride="credential"
  // on every item keeps the emitted-markup census honest: a credential is a
  // credential wherever it renders. VISUAL ONLY — buildJsonLd never sees these,
  // because a self-published award in structured data is self-serving
  // aggregateRating territory and a schema violation.
  let badgeStrip = "";
  if (stripActive) {
    badgeStrip = `<section class="wss-c wss-bs" id="badges" aria-labelledby="wss-badges-h" data-wss-pride="badge-strip">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">Recognition</p>
<div class="wss-c__rule"></div>
<h2 id="wss-badges-h">Awards &amp; certifications</h2>
<div class="wss-bs__wrap" data-wss-carousel="badges">
<ul class="wss-rv__track wss-bs__track" tabindex="0" aria-label="Awards and certifications">
${stripCreds.map((c) => `<li class="wss-bs__item" data-wss-pride="credential"><img class="wss-p__badge" src="${esc(c.image)}" alt="" width="120" height="76" loading="lazy"><span class="wss-bs__label">${esc(c.label)}</span></li>`).join("\n")}
</ul>
${stripCreds.length > 3 ? `<div class="wss-rv__nav"><button class="wss-rv__btn" type="button" data-wss-rv="prev" aria-label="Previous badges">&#8249;</button><button class="wss-rv__btn" type="button" data-wss-rv="next" aria-label="Next badges">&#8250;</button></div>` : ""}
</div>
</div>
</section>`;
  }

  return { credentials: out.credentials, offers: out.offers, badgeStrip, trustAtoms: { standing, licensedInsured } };
}

/**
 * Hoist the TRUST STRIP and the social bar to directly under the hero — in
 * that order: score first, then where else to find them.
 *
 * The whole injected block is relocated above the donor's footer (RELOCATE_JS),
 * which put the bar 10,339px down the live Carter's mirror — measured, not
 * assumed. The owner asked for the trust facts "right below their hero... very
 * visible for them to see", and his 2026-08-12 audit named the miss precisely:
 * the trust strip (rating, review count, maps links, write-a-review) was
 * buried before the footer at y≈8,095 on the Family Heating mirror while only
 * the social bar got hoisted. A trust bar nobody scrolls to is a trust bar
 * that does not exist.
 *
 * So this moves TWO nodes: it finds the hero (the section containing the first
 * h1, else the first section under #root) and chains #trust then #social
 * directly after it. Everything else stays where RELOCATE_JS puts it. #trust
 * begins life inside the display:none .wss-content wrapper; moving it out from
 * under the wrapper is also what makes it visible, so the hoist and the reveal
 * are the same act and there is no flash of unstyled position.
 *
 * It is deliberately timid. If it cannot identify a hero it does nothing and
 * the nodes render where they already were — visible, just lower. It never
 * logs (renderCheck fails a build on a single console error), it holds direct
 * node references so a React unmount cannot orphan them, and the no-op guard
 * stops its own insertion from re-triggering the observer. Contains no `</`
 * sequence, so it cannot terminate the host <script> early.
 */
const HOIST_UNDER_HERO_JS = `<script>(function(){var ids=["trust","wss-team","reviews","social"];function nodes(){var out=[],i,n;for(i=0;i<ids.length;i++){n=document.getElementById(ids[i]);if(n)out.push(n);}return out;}function hero(ns){function clear(c){var j;for(j=0;j<ns.length;j++){if(c===ns[j]||c.contains(ns[j]))return false;}return true;}var h=document.querySelector("#root h1")||document.querySelector("h1");var s=h&&h.closest("section, header, div[class*=hero]");if(s&&s.parentNode&&clear(s))return s;var f=document.querySelector("#root > * > section, #root section");return f&&clear(f)?f:null;}function place(){var ns=nodes();if(!ns.length)return false;var s=hero(ns);if(!s)return false;var anchor=s,i,n,p;for(i=0;i<ns.length;i++){n=ns[i];if(anchor.nextElementSibling!==n){p=anchor.parentNode;if(!p)return false;p.insertBefore(n,anchor.nextSibling);}anchor=n;}return true;}function run(){try{place();}catch(e){}}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",run);}else{run();}window.addEventListener("load",run);try{var t=null;var mo=new MutationObserver(function(){if(t)return;t=setTimeout(function(){t=null;run();},80);});mo.observe(document.getElementById("root")||document.body,{childList:true,subtree:true});setTimeout(function(){mo.disconnect();},6000);}catch(e){}})();<\/script>`;

/**
 * Review carousel controls. Delegated on document so the wiring survives
 * RELOCATE_JS moving the block (moved nodes do not re-execute their scripts).
 * At the track's edges scrollBy is a natural no-op. No `</` sequence.
 */
const CAROUSEL_JS = `<script>(function(){function step(tr,d){var s=Math.max(tr.clientWidth*0.85,260);try{tr.scrollBy({left:d*s,behavior:"smooth"});}catch(err){tr.scrollLeft+=d*s;}}document.addEventListener("click",function(e){var b=e.target&&e.target.closest?e.target.closest("[data-wss-rv]"):null;if(!b)return;var w=b.closest("[data-wss-carousel]");var tr=w?w.querySelector(".wss-rv__track"):null;if(!tr)return;step(tr,b.getAttribute("data-wss-rv")==="next"?1:-1);});try{if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion:reduce)").matches)return;var W=document.querySelector("[data-wss-carousel=reviews]");var tr=W&&W.querySelector(".wss-rv__track");if(!tr)return;var paused=false;function P(){paused=true;}function R(){paused=false;}W.addEventListener("pointerenter",P);W.addEventListener("pointerleave",R);W.addEventListener("focusin",P);W.addEventListener("focusout",R);setInterval(function(){if(paused||document.hidden)return;var max=tr.scrollWidth-tr.clientWidth-4;if(tr.scrollLeft>=max){try{tr.scrollTo({left:0,behavior:"smooth"});}catch(e){tr.scrollLeft=0;}}else{step(tr,1);}},4500);}catch(e){}})();<\/script>`;

/**
 * APPLE MAPS BESIDE EVERY GOOGLE MAPS LINK — including the donor's own.
 *
 * The owner's audit line: Apple Maps sits beside Google "everywhere maps links
 * render". The engine's sections carry their Apple links statically (trust
 * rail and coverage), but the compiled donors render their OWN Google links —
 * measured live: plumbing-clean's #region ships 2, hvac-premier's contact band
 * ships 1 — and that markup is React's, not ours. So this walks the rendered
 * DOM after mount and gives each Google maps/directions anchor an Apple twin
 * derived from the same destination. Engine sections are skipped (statics
 * already there); anchors are stamped so React re-renders do not double-twin.
 * Same cadence and the same silence rules as the hoist. The SVG closer is
 * assembled from "<"+"/" so the string contains no literal </ sequence.
 */
const APPLE_TWIN_JS = `<script>(function(){var CL="<"+"/";var SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.05 12.54c-.03-3.05 2.49-4.51 2.6-4.58-1.42-2.07-3.62-2.35-4.4-2.38-1.87-.19-3.65 1.1-4.6 1.1-.95 0-2.41-1.07-3.97-1.04-2.04.03-3.92 1.19-4.97 3.01-2.12 3.68-.54 9.13 1.53 12.11 1.01 1.46 2.21 3.09 3.79 3.03 1.52-.06 2.1-.98 3.94-.98 1.84 0 2.36.98 3.97.95 1.64-.03 2.68-1.49 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.41-.04-.02-3.19-1.22-3.23-4.86zM14.02 3.6c.84-1.02 1.4-2.43 1.25-3.6-1.2.05-2.66.8-3.53 1.82-.77.9-1.45 2.34-1.27 3.72 1.34.1 2.71-.68 3.55-1.94z"/>'+CL+'svg>';function appleFor(href){try{var u=new URL(href,location.href);if(!/(^|\\.)google\\.[a-z.]+$/i.test(u.hostname)&&!/^maps\\.google\\./i.test(u.hostname))return "";if(u.pathname.indexOf("/maps")!==0&&!/^maps\\./i.test(u.hostname))return "";var sp=u.searchParams;var dest=sp.get("destination")||sp.get("daddr")||sp.get("q")||sp.get("query")||"";var org=sp.get("origin")||sp.get("saddr")||"";if(!dest){var m=u.pathname.match(/\\/maps\\/(?:place|search)\\/([^/]+)/);if(m){dest=decodeURIComponent(m[1].replace(/\\+/g," "));}}if(!dest)return "";var a="https://maps.apple.com/?daddr="+encodeURIComponent(dest);if(org)a+="&saddr="+encodeURIComponent(org);return a;}catch(e){return "";}}function run(){try{var as=document.querySelectorAll('a[href*="google.com/maps"],a[href*="maps.google."]');for(var i=0;i<as.length;i++){var a=as[i];if(a.getAttribute("data-wss-apple-done"))continue;a.setAttribute("data-wss-apple-done","1");if(a.closest("#trust")||a.closest("#coverage"))continue;var sib=a.nextElementSibling;if(sib&&sib.className&&String(sib.className).indexOf("wss-apple-twin")>-1)continue;var ap=appleFor(a.getAttribute("href")||"");if(!ap)continue;var t=document.createElement("a");t.className="wss-apple-twin";t.href=ap;t.target="_blank";t.rel="noopener noreferrer";t.setAttribute("aria-label","Open in Apple Maps");t.innerHTML=SVG+"<span>Apple Maps<"+"/span>";if(a.parentNode)a.parentNode.insertBefore(t,a.nextSibling);}}catch(e){}}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",run);}else{run();}window.addEventListener("load",run);try{var t=null;var mo=new MutationObserver(function(){if(t)return;t=setTimeout(function(){t=null;run();},120);});mo.observe(document.getElementById("root")||document.body,{childList:true,subtree:true});setTimeout(function(){mo.disconnect();},6000);}catch(e){}})();<\/script>`;

/**
 * THE SOCIAL / TRUST BAR — the owner's "secret sauce", rendered.
 *
 * "It goes through Google business, then website, then Google search, then
 *  pulls all trust signals and social sites and stacks them all right below
 *  their hero with beautiful visual logos."
 *
 * Every chip is a profile that survived lib/mirror-engine/social-discovery's
 * ownership test — linked from their own site, or unambiguously carrying their
 * name. Nothing else is renderable, because a social chip is an INVITATION to
 * leave the page: sending a visitor to a stranger's Facebook under the client's
 * banner is the manufacturer-badge failure with a bigger blast radius.
 *
 * ABSENCE COLLAPSES SILENTLY. No "Follow us on Facebook" for a business with
 * no Facebook, no greyed-out placeholder chips, no bar at all when nothing was
 * found. A missing signal is an absent section, never an invention — and never
 * a reason to refuse the build.
 */
function buildSocialBar({ facts = {} }) {
  const seen = new Set();
  const chips = [];
  for (const raw of Array.isArray(facts.socials) ? facts.socials : []) {
    const network = clean(raw && raw.network).toLowerCase();
    const url = clean(raw && raw.url);
    if (!network || !url || !SOCIAL_ICONS[network]) continue;
    // https only. An http:// profile link on an https page is a mixed-content
    // downgrade we are choosing to hand the visitor.
    if (!/^https:\/\//i.test(url)) continue;
    if (seen.has(network)) continue;
    seen.add(network);
    const label = clean(raw.label) || network.charAt(0).toUpperCase() + network.slice(1);
    const handle = clean(raw.handle);
    chips.push(`<a class="wss-s__chip" href="${esc(url)}" target="_blank" rel="noopener noreferrer me" title="${esc(label)}${handle ? ` — ${esc(handle)}` : ""}">
<span class="wss-s__mark">${SOCIAL_ICONS[network]}</span><span class="wss-s__name">${esc(label)}</span></a>`);
  }
  if (!chips.length) return "";
  // The heading uses their NAME, not their Google Business Profile string.
  // Rendered live, the raw fact gave "Find Carter's My Plumber - Plumbers
  // Indianapolis, Water Heater Repair online" — true, and it reads like a
  // keyword dump, which is one of the things we are selling them a fix for.
  const name = clean(coreName(facts.business_name)) || clean(facts.business_name) || "us";
  return `<section class="wss-s" id="social" aria-labelledby="wss-social-h">
<div class="wss-c__inner">
<h2 id="wss-social-h" class="wss-s__h">Find ${esc(name)} online</h2>
<div class="wss-s__row">${chips.join("")}</div>
</div>
</section>`;
}

// A REAL FACE, NOT AN ABSTRACT MACRO SHOT (owner, 2026-08-12): "homeowners
// want to see who is coming to their door." The hero wash already carries one
// identity photograph faintly behind the headline; this surfaces a human/crew/
// van photograph at full contrast in its own band. The subject is read only to
// caption it honestly — a van is never called a team.
//
// The tokens are the same vocabulary client-photo-bank.js ranks work photos by.
// A vehicle wins over a crowd word (a "team-van.jpg" is a van), a crew word
// wins over a lone portrait word, and identity_critical — the design brief's
// verdict that a PERSON features prominently on their own site — is the floor.
const ID_VEHICLE_RE = /(^|[/_-])(van|vans|truck|trucks|fleet|trailer|rig|vehicle|wrap)([/_.-]|$)/i;
const ID_TEAM_RE = /(^|[/_-])(team|teams|crew|crews|staff|group|family|employees?|technicians?|installers?)([/_.-]|$)/i;
const ID_PERSON_RE = /(^|[/_-])(owner|owners|founder|founders|portrait|headshot|meet|about-?us|ceo|president|people)([/_.-]|$)/i;

/**
 * identityBandSubject(url, { identityCritical }) -> "vehicle"|"team"|"person"|""
 * "" means the photograph carries no human/vehicle signal and must NOT be
 * surfaced as one — the owner's "absent if the bank has no human photo,
 * honestly". A GBP photo's URL is an opaque token, so those qualify only when
 * the design brief flagged them identity_critical.
 */
function identityBandSubject(url, { identityCritical = false } = {}) {
  const name = String(url || "").toLowerCase();
  if (ID_VEHICLE_RE.test(name)) return "vehicle";
  if (ID_TEAM_RE.test(name)) return "team";
  if (ID_PERSON_RE.test(name)) return "person";
  if (identityCritical) return "person";
  return "";
}

/**
 * pickIdentityPhoto({ bank, usablePhotos, excludeSha }) -> { row, subject } | null
 *
 * Chooses ONE of the client's own photographs to show as a face/crew/van band.
 * `row` is a fetched-bytes row (has .bytes/.ext/.sha256), so the caller can
 * write the file; `subject` captions it. Ownership is already proved upstream —
 * bank rows and usablePhotos both cleared the photo gate — so nothing pickable
 * here can be stock or another business's crew.
 *
 * `excludeSha` is the photograph already washed behind the hero: preferring a
 * DIFFERENT one means the band adds a face rather than repeating the wash. When
 * the only identity photograph IS the hero's, it is still shown here at full
 * contrast (the owner's whole point — "not only as a faint wash").
 */
function pickIdentityPhoto({ bank = null, usablePhotos = [], excludeSha = "" } = {}) {
  const usable = (Array.isArray(usablePhotos) ? usablePhotos : []).filter((p) => p && p.bytes && p.ext);
  if (!usable.length) return null;
  const bySha = new Map();
  const byUrl = new Map();
  for (const p of usable) {
    if (p.sha256) bySha.set(String(p.sha256), p);
    if (p.url) byUrl.set(String(p.url), p);
  }
  const seen = new Set();
  const candidates = [];
  const consider = (bytesRow, flags, url) => {
    if (!bytesRow) return;
    const key = String(bytesRow.sha256 || bytesRow.url || "");
    if (!key || seen.has(key)) return;
    const subject = identityBandSubject(url || bytesRow.url, flags);
    if (!subject) return;
    seen.add(key);
    candidates.push({ row: bytesRow, subject, sha: String(bytesRow.sha256 || "") });
  };
  // Bank order first: it carries the design brief's identity verdicts and the
  // work-photo ranking, joined to the bytes actually fetched for this build.
  const rows = bank && Array.isArray(bank.photos) ? bank.photos : [];
  for (const r of rows) {
    const bytesRow = (r.sha256 && bySha.get(String(r.sha256))) || (r.url && byUrl.get(String(r.url)));
    consider(bytesRow, { identityCritical: !!r.identity_critical }, r.url);
  }
  // Then any fetched photo whose own filename names people or a vehicle — the
  // packet/GBP lane, where no design brief ran to set identity_critical.
  for (const p of usable) consider(p, {}, p.url);
  if (!candidates.length) return null;
  const distinct = candidates.find((c) => c.sha && c.sha !== excludeSha)
    || candidates.find((c) => c.row.url && c.row.url !== excludeSha);
  return distinct || candidates[0];
}

/**
 * buildTeamBand({ identityPhoto, facts, market, city }) -> the section, or "".
 * `identityPhoto` is { url, subject } — url is the asset the engine already
 * wrote from an ownership-gated photograph. Copy is chosen by subject and is
 * true for that subject only: a van is captioned as a van, never as a team.
 */
function buildTeamBand({ identityPhoto = null, facts = {}, market = "", city = "" } = {}) {
  const url = clean(identityPhoto && identityPhoto.url);
  if (!url || !(/^\/?assets\//i.test(url) || /^https:\/\//i.test(url))) return "";
  const subject = clean(identityPhoto && identityPhoto.subject) || "person";
  const name = clean(coreName(facts.business_name)) || clean(facts.business_name) || "us";
  const where = clean(market || city);
  const COPY = {
    person: {
      eyebrow: "Who you're hiring",
      h2: `The people behind ${name}`,
      lead: "",
    },
    team: {
      eyebrow: "Meet the team",
      h2: `The crew at ${name}`,
      lead: "",
    },
    vehicle: {
      eyebrow: "On the road",
      h2: `${name} on the road`,
      lead: "",
    },
  };
  const c = COPY[subject] || COPY.person;
  const bn = clean(facts.business_name);
  const alt = subject === "vehicle" ? `${bn} vehicle` : `The team at ${bn}`;
  return `<section class="wss-c wss-team" id="wss-team" aria-labelledby="wss-team-h" data-wss-identity="${esc(subject)}">
<div class="wss-c__inner wss-team__inner">
<figure class="wss-team__fig"><img class="wss-team__img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async"></figure>
<div class="wss-team__body">
<p class="wss-c__eyebrow">${esc(c.eyebrow)}</p>
<div class="wss-c__rule"></div>
<h2 id="wss-team-h">${esc(c.h2)}</h2>
${c.lead ? `<p class="wss-team__lead">${esc(c.lead)}</p>` : ""}
</div>
</div>
</section>`;
}

// THE CONTACT-RAIL FEATURE FLAGS (owner, 2026-09-02): the customer contact
// rail — the sticky mobile CTA bar (2), the sms: "Text Us" action (5) and the
// chat handoff (11) — is FEATURE-FLAGGED per business off the facts:
//
//   facts.features: { sticky_cta: bool, sms_cta: bool, chat_handoff: bool }
//
// DEFAULT IS OFF, everywhere, always. Absent flag = absent feature: a flag
// that is missing, false, or not the exact boolean `true` renders nothing, and
// a component gated behind an off flag is NEVER half-rendered (no orphan CSS,
// no empty bar, no dead affordance). The flags ride the verified facts packet,
// so they are promoted per business by the same pipeline that promotes facts —
// never by a global default that would flip the whole fleet at once.
const CONTACT_RAIL_FLAGS = Object.freeze(["sticky_cta", "sms_cta", "chat_handoff"]);

/**
 * contactRailFlags(facts) -> { sticky_cta, sms_cta, chat_handoff }
 * Strict booleans. "true" (string), 1, and null are all OFF — a caller that
 * cannot send a real boolean has not verified the feature for this business.
 */
function contactRailFlags(facts = {}) {
  const bag = facts && typeof facts.features === "object" && facts.features ? facts.features : {};
  const out = {};
  for (const name of CONTACT_RAIL_FLAGS) out[name] = bag[name] === true;
  return out;
}

// THE STICKY MOBILE CTA BAR (owner, 2026-08-12: "a persistent bottom bar on
// mobile — like their old 'Text us' widget but better"), now FLAG-GATED
// (facts.features.sticky_cta, default OFF) and shaped by the 2026-09 spec:
// Call · Text Us · primary CTA.
//
// PLACEMENT DISCIPLINE. It is a full-width fixed bar at the very bottom, so it
// would sit under the sign-up floater (bottom-left) and the chat launcher
// (bottom-right). Both of those already MEASURE whatever is fixed to the bottom
// of a phone and lift above it — the --wss-floater-clear / --wss-chat-clear
// trick. The floater's measurement deliberately ignores ids that start "wss-"
// (so our own widgets never perturb it), so this bar's id is "wsscallbar" with
// no hyphen: a real bottom obstruction both heuristics dodge, exactly the
// discipline the owner asked us to reuse. Proven by render at 390.
//
// BREAKPOINT LAW: <768px ONLY. The single media test is (max-width:767.98px) —
// the .98 keeps a 767.5px viewport mobile while a 768px viewport, and every
// viewport above it, reads the base `display:none`. The desktop site must
// never grow a bar.
//
// EACH ACTION GATES ON ITS OWN DATA (absent data → absent button, never a
// broken layout):
//   · Call — only when a dialable phone exists. This is the core of the ask.
//   · Text Us — only when features.sms_cta is on AND the `sms_capable` fact is
//     true (the business's own line is verified textable) AND a textable
//     number is held. Never sms: to a line we only know as a voice number.
//     This is the BUSINESS texting ITS customers — unrelated to Riley's
//     voice-only channel, and never wired to it.
//   · Primary CTA — the business's own `primary_cta` fact { label, href };
//     href must be https://. An unparseable CTA is dropped, not guessed.
//   · Chat — the pre-existing fallback conversion action, shown only when the
//     business has NOT supplied a primary CTA. It clicks the real chat
//     launcher and removes itself when no chat widget shipped.
// Absent from proof shots (?wssthumb=1).
function buildCallBar({ phoneDigits = "", phoneHuman = "", smsDigits = "", smsAllowed = false, primaryCta = null, businessName = "", accent = "" } = {}) {
  const telDigits = String(phoneDigits || "").replace(/[^\d]/g, "");
  if (telDigits.length < 7) return "";
  const tel = /^\+/.test(String(phoneDigits).trim()) ? `+${telDigits}` : telDigits;
  const smsRaw = String(smsDigits || "").replace(/[^\d]/g, "");
  const hasSms = smsAllowed && smsRaw.length >= 7;
  const sms = /^\+/.test(String(smsDigits).trim()) ? `+${smsRaw}` : smsRaw;
  const acc = /^#[0-9a-f]{6}$/i.test(String(accent || "").trim()) ? String(accent).trim().toLowerCase() : "";
  // THE BUSINESS'S PRIMARY CTA, verbatim from the verified fact or not at all.
  const ctaLabel = clean(primaryCta && primaryCta.label).slice(0, 24);
  const ctaHref = clean(primaryCta && primaryCta.href);
  const hasCta = !!ctaLabel && /^https:\/\//i.test(ctaHref);
  const nameAttr = esc(clean(businessName) || "us");
  const telHuman = esc(clean(phoneHuman) || tel);
  const IC = {
    call: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 21A13 13 0 0 1 3 8.5 2 2 0 0 1 5 6.5h2.1a1 1 0 0 1 1 .8l.7 3a1 1 0 0 1-.28.95L8.4 12.4a11 11 0 0 0 3.2 3.2l1.15-1.12a1 1 0 0 1 .95-.28l3 .7a1 1 0 0 1 .8 1V18a2 2 0 0 1-2 2z"/></svg>`,
    text: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"/></svg>`,
    chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-1-2.6V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"/></svg>`,
  };
  const css = `#wsscallbar{display:none}
@media(max-width:767.98px){#wsscallbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:99980;gap:8px;padding:8px max(10px,env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));background:rgba(17,18,20,.94);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:2px solid var(--wss-cb-accent,#3f4550);box-shadow:0 -8px 24px rgba(0,0,0,.34);font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif}body{padding-bottom:calc(60px + env(safe-area-inset-bottom))!important}}
#wsscallbar .wss-cb__btn{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:46px;border-radius:11px;font-size:14px;font-weight:700;line-height:1;letter-spacing:.01em;text-decoration:none;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);color:#fff;cursor:pointer;-webkit-appearance:none;appearance:none;font-family:inherit}
#wsscallbar .wss-cb__btn svg{width:19px;height:19px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#wsscallbar .wss-cb__call{background:color-mix(in srgb,var(--wss-cb-accent,#3f4550) 88%,#000 12%);border-color:color-mix(in srgb,#fff 30%,transparent);box-shadow:0 4px 14px color-mix(in srgb,var(--wss-cb-accent,#3f4550) 42%,transparent)}
#wsscallbar .wss-cb__btn:active{transform:translateY(1px)}
#wsscallbar .wss-cb__lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(prefers-reduced-motion:reduce){#wsscallbar .wss-cb__btn{transition:none}}`;
  const btns = [
    `<a class="wss-cb__btn wss-cb__call" href="tel:${esc(tel)}" aria-label="Call ${telHuman}">${IC.call}<span class="wss-cb__lbl">Call</span></a>`,
    hasSms ? `<a class="wss-cb__btn wss-cb__text" href="sms:${esc(sms)}" aria-label="Text ${nameAttr}">${IC.text}<span class="wss-cb__lbl">Text Us</span></a>` : "",
    hasCta ? `<a class="wss-cb__btn wss-cb__cta" href="${esc(ctaHref)}" aria-label="${esc(ctaLabel)}">${esc(ctaLabel)}</a>` : "",
    // The Chat fallback yields when the business supplies its own primary CTA.
    hasCta ? "" : `<button class="wss-cb__btn wss-cb__chat" type="button" data-wss-cb-chat aria-label="Chat with ${nameAttr}">${IC.chat}<span class="wss-cb__lbl">Chat</span></button>`,
  ].filter(Boolean).join("");
  // The chat widget is injected AFTER this bar in the document, so wiring the
  // Chat button waits for DOMContentLoaded — otherwise the launcher is not yet
  // parsed and the button removes itself by mistake (measured at 390). The
  // proof-shot removal runs immediately so no capture ever catches the bar.
  const script = `<script>(function(){try{var b=document.getElementById("wsscallbar");if(!b)return;if(/[?&]wssthumb=1(?:&|$)/.test(location.search)){if(b.parentNode)b.parentNode.removeChild(b);return;}var c=b.querySelector("[data-wss-cb-chat]");if(!c)return;function L(){return document.getElementById("wss-chat-launcher");}function wire(){if(!L()){if(c.parentNode)c.parentNode.removeChild(c);}else{c.addEventListener("click",function(){var l=L();if(l)l.click();});}}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",wire);}else{wire();}}catch(e){}})();</script>`;
  return `<style id="wss-callbar-css">${css}</style>`
    + `<div id="wsscallbar" data-wss="callbar" role="group" aria-label="Contact ${nameAttr}"${acc ? ` style="--wss-cb-accent:${acc}"` : ""}>${btns}</div>`
    + script;
}

function buildContentHtml({ content: rawContent = {}, facts = {}, phoneDigits = "", donorRenders = [], identityPhoto = null }) {
  const content = withTaxonomyFidelity(orderReviewsForDisplay(withUsableServices(rawContent, facts.business_name)), facts.business_name);
  // The donor's extracted service taxonomy rides `content.taxonomy` (attached
  // by the caller from lib/mirror-engine/taxonomy.js). Present => fidelity
  // laws apply; absent => this function behaves exactly as it did before.
  const donorTaxonomy = content.taxonomy && Array.isArray(content.taxonomy.services) ? content.taxonomy : null;
  // A donor that already renders a section from hydrated data must NOT get a
  // second one — duplicate services/FAQ/coverage blocks read as a bolt-on
  // appendix (observed live on the roofing donor). The donor declares what it
  // covers via BOILERPLATE.json `renders`, and we fill only the gaps.
  const skip = new Set((donorRenders || []).map((s) => String(s).toLowerCase()));
  const services = (content.services || [])
    .map((s) => (typeof s === "string" ? { name: clean(s), description: "" } : { name: clean(s.name || s.title), description: clean(s.description || s.text) }))
    // A SERVICE NAMED "${child.title}" IS THE PROSPECT'S BROKEN MARKUP, NOT A
    // SERVICE. Two live mirrors printed that on a card and repeated it as a
    // schema.org Service — see tokens.js carriesTemplateToken for the two sites
    // it came off. Dropped rather than blanked: a card with an empty title is
    // the same defect with the evidence removed.
    .filter((s) => s.name && !carriesTemplateToken(s.name) && !carriesTemplateToken(s.description))
    // 24, not 12: the owner rejected the brochure contract that halved a rich
    // service menu. The page, the JSON-LD and llms.txt take the same list, so
    // the cap is lifted here everywhere at once or the surfaces disagree.
    .slice(0, 24);
  const suppliedFaqs = (content.faqs || [])
    .map((f) => ({ q: clean(f.q || f.question), a: cleanFaqAnswer(f.a || f.answer) }))
    .filter((f) => f.q && f.a)
    .slice(0, 20);
  const reviews = (content.reviews || [])
    .map((r) => ({
      author: clean(r.author || r.name),
      text: clean(r.text || r.quote || r.review),
      // The face and the score travel with the words. A quote with a name under
      // it is copy; a quote with the reviewer's own Google photo, their star
      // count and the month they wrote it is evidence.
      avatarUrl: /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(String(r.avatarUrl || "")) ? String(r.avatarUrl) : "",
      rating: Number.isFinite(Number(r.rating)) ? Math.max(0, Math.min(5, Math.round(Number(r.rating)))) : 0,
      when: monthYear(r.publishedAt),
    }))
    .filter((r) => r.text)
    // 10, not 5, for the same reason the service menu widened: these are the
    // evidence, and the trust-rail faces and the schema nodes draw from the
    // same list, so the render cap and theirs move together.
    .slice(0, 10);
  // AREAS AND TOWNS ARE PLACE NAMES, AND ONLY A PLACE NAME MAY BE PRINTED AS ONE.
  //
  // Both lists are filtered through the same predicate
  // (lib/mirror-engine/place-names), which is also asked at the source that
  // produces towns and at the render gate that decides whether a build may be
  // shown to its owner. Three chances to refuse the same string.
  //
  // DROPPING IS THE POINT. A coverage list one town shorter is a list nobody
  // counts; a coverage list containing "9, LA" is a Louisiana HVAC company being
  // told by us that it serves the town of nine. If the filter empties the list,
  // the block below simply does not render — an absent service-area section is
  // honest, and a numeric one is not.
  const areas = filterPlaceNames(verifiedServiceAreas(facts, content.areas)).kept.slice(0, 18);
  // NEARBY TOWNS — the near-me surface.
  // Each entry is a real place measured around the client's verified
  // coordinates (lib/mirror-engine/nearby-cities), carrying its own distance.
  // They are rendered as DRIVING DIRECTIONS, not as a service-area claim: we
  // know the town is 5 miles away because the Census says where it is, and we
  // do not know whether this business works there. A directions link is true
  // either way, and it is what somebody searching from the next town over
  // actually wants.
  const nearby = (content.nearby || [])
    .map((n) => ({
      name: clean(n && n.name),
      state: clean(n && n.state),
      miles: Number(n && n.miles),
    }))
    // `n.name &&` was the whole of the old guard, and "9" is truthy.
    .filter((n) => isPlausiblePlaceName(n.name) && Number.isFinite(n.miles))
    .slice(0, 8);
  const hours = normalizeHours(content.hours);
  // Split BEFORE cleaning: clean() collapses all whitespace, so splitting
  // afterwards renders multi-paragraph copy as one wall of text. Each
  // paragraph then passes the about sanitizer (scraper emails out, duplicated
  // service/city list runs collapsed, prose-sane cap) — the raw harvest dump
  // was the 2,204-character "Who you are hiring" wall, live 2026-09-02.
  const aboutParas = sanitizedAbout(content.about || content.story || "");
  const about = aboutParas.join(" ");

  // A service-area headline needs a service-area observation. The mailing city
  // remains useful for directions and "located in" copy, but never becomes a
  // market merely because the business has an address there.
  const city = clean(facts.city);
  const state = clean(facts.state);
  const napMarket = [city, state].filter(Boolean).join(", ");
  const serviceMarket = areas[0] || "";

  // A REAL FACE / CREW / VAN, shown — not only washed behind the hero. The
  // engine passes an identity photograph only from the ownership-gated photo
  // bank, so this band cannot carry a stock person or another firm's crew;
  // absent when the bank held no human/vehicle photograph.
  const teamBand = buildTeamBand({ identityPhoto, facts, market: napMarket, city });

  // Supplied FAQs win; verified ones fill a vacuum rather than leaving the page
  // with nothing to answer the questions customers actually ask.
  const faqs = suppliedFaqs.length
    ? suppliedFaqs
    : verifiedFaqs({ facts, services, hours, areas });

  // THE OWNER'S PRIDE POINTS — their motto's evidence, their credentials, their
  // real plan prices, their published footprint. Built here so the early return
  // below can count them: a client whose site yielded no service list but whose
  // Silver and Gold plans we proved is exactly the customer this block is for,
  // and returning "" on `want` alone would have thrown all of it away — the
  // same bug the social bar was already fixed for two paragraphs down.
  const prideSections = buildPrideSections({
    pride: content.pride || null,
    facts,
    alreadyListedAreas: areas,
  });

  const want = {
    services: services.length && !skip.has("services"),
    about: about && !skip.has("about"),
    coverage: (areas.length || hours.length) && !skip.has("coverage"),
    reviews: reviews.length && !skip.has("reviews"),
    faq: faqs.length && !skip.has("faq"),
  };
  // The social bar is built BEFORE the early return, because owned profiles
  // are reason enough to render the block on their own: a business whose site
  // yielded no service list but whose Facebook, Yelp and BBB pages we proved is
  // exactly the customer the owner wants blown away, and returning "" here
  // would have thrown all three away.
  const socialBar = buildSocialBar({ facts });
  // OPTIONAL TRUST BADGES + FINANCING (built before the early return, same
  // reason the social bar is: a client whose only verified extras are these
  // still gets them on the page).
  const trustBadges = buildTrustBadges({ facts });
  const financingSection = buildFinancingSection({ facts });
  const havePride = !!(prideSections.credentials || prideSections.offers || prideSections.badgeStrip);
  // The promoted trust atoms (tenure, licensed/insured) render in the strip, not
  // in `want`/`havePride`, so a client whose ONLY pride is standing would lose
  // them to the early return. Count them so the strip band is never dropped.
  const trustAtoms = prideSections.trustAtoms || { standing: [], licensedInsured: "" };
  const haveTrustAtoms = (Array.isArray(trustAtoms.standing) && trustAtoms.standing.length > 0) || !!clean(trustAtoms.licensedInsured);
  if (!Object.values(want).some(Boolean) && !socialBar && !havePride && !haveTrustAtoms && !teamBand && !trustBadges && !financingSection) return "";
  const parts = [];

  // The trust rail leads. Someone deciding whether to phone a stranger about
  // a burst pipe wants the score, the hours and the directions before they
  // want a service list.
  //
  // IT IS NOT PART OF THE SERVICES SECTION. It used to be nested inside
  // `if (want.services)`, which meant the star rating, the review count, the
  // Apple Maps link and "Write a Google Review" all disappeared whenever the
  // client's own website happened not to yield a service list — two facts with
  // nothing to do with each other. Proven on Cook Plumbing (West Des Moines):
  // real reviews and hours resolved, and the whole rail rendered nowhere.
  //
  // THE DONOR'S OWN BADGE, WHEN THE GBP SCORE DID NOT RESOLVE (owner's video
  // report 2026-09-02: "If the donor shows a 4.8★/43-review badge in their
  // header, the generated site should too"). A donor that declared an
  // aggregateRating in its own markup published that score itself; when the
  // verified GBP fact is absent, the donor's declared score renders rather
  // than no badge at all. The verified fact always wins when it exists.
  const donorProof = donorTaxonomy && donorTaxonomy.proof && typeof donorTaxonomy.proof === "object" ? donorTaxonomy.proof : null;
  const railFacts = donorProof && Number(donorProof.rating) > 0 && !(Number(facts.rating) > 0)
    ? { ...facts, rating: Number(donorProof.rating), review_count: Number(donorProof.review_count) > 0 ? Number(donorProof.review_count) : 0 }
    : facts;
  const rail = buildTrustRail({ facts: railFacts, reviews, hours, phoneDigits, trustAtoms });
  if (rail) parts.push(rail);

  // ...and the social bar sits immediately under it, which is "right below
  // their hero" once this block is relocated above the footer of a donor whose
  // hero is the first thing on the page. Score first, then where else to find
  // them — the same order a stranger checks in.
  if (socialBar) parts.push(socialBar);

  // The trust-badge rail rides with the same "can I trust these people"
  // question the rail above answers — licence number, insurance, association
  // seals — each chip rendered only because the client supplied the fact.
  if (trustBadges) parts.push(trustBadges);

  // Their credentials sit with the trust rail because that is what they are:
  // the licence number, the manufacturer relationship and the years behind the
  // name are the same question as the star rating — "can I trust these people".
  if (prideSections.credentials) parts.push(prideSections.credentials);

  // The badge shelf rides directly with the credentials it came from: their
  // own award/certification artwork, a strip only when 2+ marks cleared the
  // ownership gate, absent entirely otherwise.
  if (prideSections.badgeStrip) parts.push(prideSections.badgeStrip);

  // Their own face/crew/van, hoisted under the hero (id "wss-team" is in the
  // HOIST list) so it lands right after the trust strip — the "who is coming to
  // your door" the owner asked for, high on the page and at full contrast.
  if (teamBand) parts.push(teamBand);

  if (want.services) {
    // THE CARD GRID IS THE DONOR'S TAXONOMY, ONE CARD PER LISTED SERVICE, under
    // the donor's own names and (where the taxonomy carried it) the donor's own
    // copy. The count tracks whatever the donor actually lists — an 8-service
    // donor renders 8 cards, a 20-service donor renders 20 — never a fixed
    // generic grid. `data-wss-donor-services` prints the donor's distinct
    // service count so the density comparison is auditable on the page itself.
    parts.push(`<section class="wss-c" id="services-detail" aria-labelledby="wss-services-h"${donorTaxonomy ? ` data-wss-donor-services="${esc(Number(donorTaxonomy.count) || donorTaxonomy.services.length)}"` : ""}>
<div class="wss-c__inner">
<p class="wss-c__eyebrow">What we do</p>
<div class="wss-c__rule"></div>
<h2 id="wss-services-h">${serviceMarket ? `Services in ${esc(serviceMarket)}` : "Services"}</h2>
<div class="wss-c__grid">
${services.map((s, i) => `<article class="wss-c__card"><h3><span class="wss-c__num" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>${esc(s.name)}</h3>${s.description ? `<p>${esc(s.description)}</p>` : ""}</article>`).join("\n")}
</div>
</div>
</section>`);
  }

  // Plans and offers follow the service list — you read what they do, then what
  // it costs. This is the section the audit said was missing: the Silver and
  // Gold plans with their real monthly prices, not a "maintenance" bullet.
  if (prideSections.offers) parts.push(prideSections.offers);

  // Financing is a money answer, so it sits with the money sections — the
  // client's own financing module, rendered only when enabled with an https
  // apply link.
  if (financingSection) parts.push(financingSection);

  // PROOF ABOVE MARKETING (owner's video report, 2026-09-02: "Donor pages
  // surface customer reviews and project evidence prominently. WSS should not
  // demote genuine proof below generic marketing copy."). The reviews carousel
  // used to render BELOW about and coverage — a stranger had to scroll past
  // two sections of generic copy to reach the words of the people who already
  // paid. It now rides directly after the services/money sections, ahead of
  // about and coverage. (The runtime hoist additionally lifts #trust, #reviews
  // and #social under the hero on JS-capable browsers; the STATIC order now
  // agrees with it, so crawlers and no-JS readers see proof high too.)
  if (want.reviews) {
    // A CAROUSEL, not a flat grid — the owner's audit item. Scroll-snap does
    // the carouselling (swipe on a phone, trackpad on a desktop), the arrows
    // are for mouse users, and the markup inside each card is unchanged so
    // every scanner that reads #reviews text keeps reading the same words.
    parts.push(`<section class="wss-c" id="reviews" aria-labelledby="wss-reviews-h">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">In their words</p>
<div class="wss-c__rule"></div>
<h2 id="wss-reviews-h">What customers say</h2>
<div class="wss-rv" data-wss-carousel="reviews">
<div class="wss-rv__track" tabindex="0" aria-label="Customer reviews carousel">
${reviews.map((r) => `<blockquote class="wss-c__quote" data-wss-verbatim="third-party-review">${r.rating ? `<p class="wss-c__stars" aria-label="${esc(r.rating)} out of 5">${stars(r.rating)}</p>` : ""}<p>${esc(r.text)}</p>${r.author ? `<footer class="wss-c__who">${avatarDisc(r, "wss-c__face")}<cite>${esc(r.author)}</cite>${r.when ? `<span class="wss-c__when">${esc(r.when)}</span>` : ""}</footer>` : ""}</blockquote>`).join("\n")}
</div>
${reviews.length > 1 ? `<div class="wss-rv__nav"><button class="wss-rv__btn" type="button" data-wss-rv="prev" aria-label="Previous reviews">&#8249;</button><button class="wss-rv__btn" type="button" data-wss-rv="next" aria-label="Next reviews">&#8250;</button></div>` : ""}
</div>
</div>
</section>`);
  }

  if (want.about) {
    parts.push(`<section class="wss-c" id="about-detail" aria-labelledby="wss-about-h">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">About</p>
<div class="wss-c__rule"></div>
<h2 id="wss-about-h">Who you are hiring</h2>
${aboutParas.map((p) => `<p>${esc(p)}</p>`).join("\n")}
</div>
</section>`);
  }

  if (want.coverage) {
    const mapQuery = encodeURIComponent([facts.business_name, facts.address, napMarket].filter(Boolean).join(", "));
    const dirQuery = encodeURIComponent([facts.address, napMarket].filter(Boolean).join(", ") || napMarket);
    const destPlaceId = clean(facts.place_id);
    const geoLat = Number(facts.latitude);
    const geoLng = Number(facts.longitude);
    const hasVerifiedGeo = Number.isFinite(geoLat) && Number.isFinite(geoLng);
    const satelliteUrl = hasVerifiedGeo
      ? `https://www.google.com/maps/@?api=1&amp;map_action=map&amp;center=${encodeURIComponent(`${geoLat},${geoLng}`)}&amp;zoom=16&amp;basemap=satellite`
      : "";
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&amp;destination=${dirQuery}${destPlaceId ? `&amp;destination_place_id=${esc(destPlaceId)}` : ""}&amp;travelmode=driving`;
    parts.push(`<section class="wss-c" id="coverage" aria-labelledby="wss-coverage-h">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">Coverage</p>
<div class="wss-c__rule"></div>
<h2 id="wss-coverage-h">${serviceMarket ? `Serving ${esc(serviceMarket)}` : "Hours and location"}</h2>
<div class="wss-c__split">
<div>
${areas.length ? `<ul class="wss-c__areas">${areas.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
${hours.length ? `<table class="wss-c__hours"><caption class="wss-c__eyebrow" style="text-align:left">Hours</caption><tbody>${hours.map((h) => (h.day
  ? `<tr><th scope="row">${esc(dayLabel(h.day))}</th><td>${esc(h.text)}</td></tr>`
  // A line with no day is a note about the schedule, not a row of it. Let it
  // span the table rather than sit under a row header it does not answer to.
  : `<tr><td colspan="2">${esc(h.text)}</td></tr>`)).join("")}</tbody></table>` : ""}
${phoneDigits ? `<p style="margin-top:1.2rem"><a class="wss-c__dir" href="tel:${esc(phoneDigits)}">Call ${esc(humanPhone(facts.phone) || phoneDigits)}</a></p>` : ""}
</div>
<div>
<div class="wss-c__map"${hasVerifiedGeo ? ` data-lat="${esc(geoLat)}" data-lng="${esc(geoLng)}"` : ""}><iframe src="${mapEmbedSrc(mapQuery)}" title="Map of ${esc(facts.business_name)} in ${esc(napMarket)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>
<div class="wss-c__mapactions">
<a class="wss-c__dir" href="${directionsUrl}" target="_blank" rel="noopener noreferrer">Get driving directions</a>
${satelliteUrl ? `<a class="wss-c__dir" href="${satelliteUrl}" target="_blank" rel="noopener noreferrer">Open satellite map</a>` : ""}
<a class="wss-c__dir" href="https://maps.apple.com/?daddr=${dirQuery}" target="_blank" rel="noopener noreferrer">Apple Maps directions</a>
</div>
${nearby.length ? `<div class="wss-c__near">
<p class="wss-c__eyebrow">Driving directions from nearby towns</p>
<ul class="wss-c__nearlist">${nearby.map((n) => {
  const origin = encodeURIComponent([n.name, n.state].filter(Boolean).join(", "));
  // placeId is scoped to the trust rail; this block reads the fact directly.
  const destPlaceId = clean(facts.place_id);
  return `<li><a href="https://www.google.com/maps/dir/?api=1&amp;origin=${origin}&amp;destination=${dirQuery}${destPlaceId ? `&amp;destination_place_id=${esc(destPlaceId)}` : ""}" target="_blank" rel="noopener noreferrer"><span class="wss-c__pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 1.74.63 3.34 1.68 4.57L12 22l5.32-8.43C18.37 12.34 19 10.74 19 9c0-3.87-3.13-7-7-7z"/><circle fill="#fff" cx="12" cy="9" r="2.6"/></svg></span><span class="wss-c__neartown">${esc(n.name)}${n.state ? `, ${esc(n.state)}` : ""}</span><span class="wss-c__neardist">${esc(n.miles)} mi</span></a><a class="wss-c__nearapple" href="https://maps.apple.com/?saddr=${origin}&amp;daddr=${dirQuery}" target="_blank" rel="noopener noreferrer" aria-label="Directions from ${esc(n.name)} in Apple Maps">${ICONS.apple}</a></li>`;
}).join("")}</ul>
</div>` : ""}
</div>
</div>
</div>
</section>`);
  }

  if (want.faq) {
    // Q-format <h2> headings + <details> = AEO bait that also reads well.
    //
    // THE BUSINESS PHONE IS DIALABLE IN ANSWER PROSE TOO (2026-09-02 smoke,
    // austin-roofing: "Call 512-629-4949" rendered as plain text and the page's
    // only tel: link was the WSS widget). The answers are the client's own
    // copy and ship VERBATIM — the one permitted change is wrapping THEIR OWN
    // number, exactly as typed, in a tel: link using the build's phone digits.
    // JSON-LD answers and the KB export stay plain text: a link is markup,
    // not content, and must not leak into either.
    const faqAnswerHtml = (answer) => {
      const safe = esc(answer);
      const needle = String(facts.phone || "").trim();
      const digits = String(phoneDigits || "").replace(/[^\d]/g, "");
      if (!needle || needle.length < 7 || digits.length < 10) return safe;
      const target = esc(needle);
      if (!safe.includes(target)) return safe;
      return safe.split(target).join(`<a href="tel:${esc(digits)}">${target}</a>`);
    };
    parts.push(`<section class="wss-c" id="faq" aria-labelledby="wss-faq-h">
<div class="wss-c__inner">
<p class="wss-c__eyebrow">Answers</p>
<div class="wss-c__rule"></div>
<h2 id="wss-faq-h">Questions we hear most</h2>
<div class="wss-c__faq">
${faqs.map((f, i) => `<details id="faq-${i + 1}"${i === 0 ? " open" : ""}><summary><h2 class="wss-c__q">${esc(f.q)}</h2></summary><p>${faqAnswerHtml(f.a)}</p></details>`).join("\n")}
</div>
</div>
</section>`);
  }

  // HIDDEN UNTIL PLACED — measured, not theoretical. On an SPA donor the
  // static block is the ONLY content in the viewport until React mounts, so it
  // painted 900px tall at y=0 and then collapsed to 0 when the app took over:
  // a 1.000 CLS shift (the entire score) that also stole the LCP entry from
  // the hero image. Starting display:none costs nothing — the block belongs
  // below the fold — and RELOCATE_JS reveals it once it is in its final spot,
  // where a reveal shifts nothing inside the viewport.
  // The helper scripts ride INSIDE the wrapper: scripts execute regardless of
  // display:none, they run once (RELOCATE_JS moving the wrapper does not
  // re-execute them), and shipping them here rather than with the social bar
  // means a business with zero social profiles still gets its trust strip
  // hoisted under the hero — which is exactly the case the owner audited.
  return `<div class="wss-content" data-wss-content="v1" style="display:none">\n<style>${CONTENT_CSS}</style>\n${parts.join("\n")}\n${HOIST_UNDER_HERO_JS}${CAROUSEL_JS}${APPLE_TWIN_JS}\n</div>`;
}

/** The JSON-LD graph. Only nodes backed by verified data are emitted. */
function buildJsonLd({ content: rawContent = {}, facts = {}, phoneDigits = "", siteUrl = "", logoUrl = "" }) {
  const content = withTaxonomyFidelity(orderReviewsForDisplay(withUsableServices(rawContent, facts.business_name)), facts.business_name);
  const napCity = facts.city;
  const napMarket = [napCity, facts.state].filter(Boolean).join(", ");
  const serviceAreas = verifiedServiceAreas(facts, content.areas);
  const serviceMarket = serviceAreas[0] || "";
  const areaNodes = serviceAreas.map((name) => ({ "@type": "Place", name }));
  // The schema email is a client-contact surface: a scraper-artifact address
  // never publishes as one (fleet audit 2026-09-02 — the artifact reached
  // Google through exactly this class of graph).
  const contactEmail = isScraperArtifactEmail(facts.email) ? "" : clean(facts.email);
  const graph = [];
  const businessType = /roof/i.test(facts.industry) ? "RoofingContractor"
    : /plumb/i.test(facts.industry) ? "Plumber"
    : /hvac|heating|air/i.test(facts.industry) ? "HVACBusiness"
    : /electric/i.test(facts.industry) ? "Electrician"
    : /landscap|lawn|tree/i.test(facts.industry) ? "LandscapingBusiness"
    : "HomeAndConstructionBusiness";

  // DEFECT 9 (2026-09-02 audit): telephone dropped whenever the NANP
  // derivation had refused the number, even though facts.phone was known.
  // Known phone => telephone, from either source (see schemaTelephone).
  const bizPhone = schemaTelephone(phoneDigits, facts.phone);
  const biz = {
    "@type": ["LocalBusiness", businessType],
    "@id": `${siteUrl}#business`,
    name: facts.business_name,
    description: serviceMarket
      ? `${facts.industry} serving ${serviceMarket}.`
      : `${facts.industry} business located in ${napMarket}.`,
    url: siteUrl,
    telephone: bizPhone || undefined,
    email: contactEmail || undefined,
    image: logoUrl || undefined,
    logo: logoUrl || undefined,
    areaServed: areaNodes.length ? areaNodes : undefined,
    contactPoint: (bizPhone || contactEmail) ? {
      "@type": "ContactPoint",
      telephone: bizPhone || undefined,
      email: contactEmail || undefined,
      contactType: "customer service",
    } : undefined,
  };
  // POSTAL ADDRESS = NAP, ALWAYS. Never marketCity(): the street, the locality
  // and the ZIP have to describe one real place a letter could reach.
  if (facts.address) {
    biz.address = {
      "@type": "PostalAddress",
      streetAddress: facts.address,
      addressLocality: napCity,
      addressRegion: facts.state,
      postalCode: facts.postal_code || undefined,
      addressCountry: "US",
    };
  } else {
    biz.address = { "@type": "PostalAddress", addressLocality: napCity, addressRegion: facts.state, addressCountry: "US" };
  }
  if (facts.latitude != null && facts.longitude != null) {
    biz.geo = { "@type": "GeoCoordinates", latitude: facts.latitude, longitude: facts.longitude };
  }
  // TRUTH LAW: aggregateRating only with a verified rating AND count.
  if (facts.rating != null && facts.review_count != null) {
    biz.aggregateRating = { "@type": "AggregateRating", ratingValue: facts.rating, reviewCount: facts.review_count, bestRating: 5 };
  }
  const hours = normalizeHours(content.hours);
  const spec = hours.map((h) => {
    if (!SCHEMA_DAY[h.day]) return null;
    // "Open 24 hours" has no dash for schemaTime to split on. Schema.org's
    // convention for round-the-clock is 00:00-23:59, and omitting it entirely
    // would drop the strongest hours signal a 24/7 trade has.
    if (/24 hours/i.test(h.text)) {
      return { "@type": "OpeningHoursSpecification", dayOfWeek: SCHEMA_DAY[h.day], opens: "00:00", closes: "23:59" };
    }
    const t = schemaTime(h.text);
    if (!t) return null;
    return { "@type": "OpeningHoursSpecification", dayOfWeek: SCHEMA_DAY[h.day], opens: t.opens, closes: t.closes };
  }).filter(Boolean);
  if (spec.length) biz.openingHoursSpecification = spec;
  if (facts.license) biz.hasCredential = String(facts.license);
  // The Google Business Profile is the canonical off-site record of this
  // business. hasMap/sameAs tie the mirror to it so the two are read as one
  // entity rather than a lookalike site competing with the real listing.
  if (/^https:\/\//i.test(String(facts.profile_url || ""))) {
    biz.hasMap = String(facts.profile_url);
    biz.sameAs = [String(facts.profile_url)];
  }
  // Individual reviews, attributed. aggregateRating above is the summary; these
  // are the actual words, each tied to the person who wrote them. Emitted ONLY
  // for reviews carrying a real author — an anonymous Review node is a claim
  // with nobody behind it.
  const reviewNodes = (content.reviews || [])
    .filter((r) => clean(r.text) && clean(r.author))
    .slice(0, 10)
    .map((r) => {
      const node = {
        "@type": "Review",
        reviewBody: clean(r.text),
        author: { "@type": "Person", name: clean(r.author) },
      };
      if (Number.isFinite(Number(r.rating)) && Number(r.rating) > 0) {
        node.reviewRating = { "@type": "Rating", ratingValue: Number(r.rating), bestRating: 5 };
      }
      if (Date.parse(String(r.publishedAt || ""))) {
        node.datePublished = new Date(Date.parse(r.publishedAt)).toISOString().slice(0, 10);
      }
      return node;
    });
  if (reviewNodes.length) biz.review = reviewNodes;
  graph.push(biz);

  graph.push({
    "@type": "Organization",
    "@id": `${siteUrl}#org`,
    name: facts.business_name,
    url: siteUrl,
    logo: logoUrl || undefined,
    areaServed: areaNodes.length ? areaNodes : undefined,
  });

  graph.push({
    "@type": "WebSite",
    "@id": `${siteUrl}#website`,
    url: siteUrl,
    name: facts.business_name,
    publisher: { "@id": `${siteUrl}#org` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  });

  graph.push({
    "@type": "BreadcrumbList",
    "@id": `${siteUrl}#breadcrumbs`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
      { "@type": "ListItem", position: 2, name: serviceMarket ? `${facts.industry} in ${serviceMarket}` : `${facts.industry} services`, item: `${siteUrl}#services-detail` },
    ],
  });

  for (const [i, s] of (content.services || []).slice(0, 24).entries()) {
    const name = clean(typeof s === "string" ? s : (s.name || s.title));
    // Same refusal as the rendered card above, asked again here because these
    // are two functions over one list: the Tulsa mirror's "${child.title}"
    // reached the page AND the JSON-LD, and a gate that reads only one surface
    // would have called the other one clean.
    if (!name || carriesTemplateToken(name)) continue;
    graph.push({
      "@type": "Service",
      "@id": `${siteUrl}#service-${i + 1}`,
      name,
      // DEFECT 7: the composed fallback met the same double-period and
      // ALL-CAPS hazards as the meta composer ("PLUMBING offered by
      // United Contractors Inc.."). Same rule, same fix.
      description: clean(typeof s === "object" ? (s.description || s.text) : "") || `${trimTrailingPeriod(titleCaseShoutedTokens(name))} offered by ${trimTrailingPeriod(clean(facts.business_name))}.`,
      serviceType: name,
      provider: { "@id": `${siteUrl}#business` },
      areaServed: areaNodes.length ? areaNodes : undefined,
    });
  }

  // Same rule as the rendered block: supplied FAQs win, otherwise the ones
  // built from verified facts. The schema and the page must not disagree about
  // what this business answers.
  const suppliedSchemaFaqs = (content.faqs || []).map((f) => ({ q: clean(f.q || f.question), a: cleanFaqAnswer(f.a || f.answer) })).filter((f) => f.q && f.a).slice(0, 20);
  const faqs = suppliedSchemaFaqs.length
    ? suppliedSchemaFaqs
    : verifiedFaqs({
      facts,
      services: (content.services || []).map((s) => (typeof s === "string" ? { name: clean(s) } : { name: clean(s.name || s.title) })).filter((s) => s.name),
      hours: normalizeHours(content.hours),
      areas: content.areas || [],
    });
  if (faqs.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${siteUrl}#faq`,
      speakable: { "@type": "SpeakableSpecification", cssSelector: [".wss-c__q", ".wss-c__faq p"] },
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  if (facts.owner_name) {
    graph.push({
      "@type": "Person",
      "@id": `${siteUrl}#owner`,
      name: facts.owner_name,
      worksFor: { "@id": `${siteUrl}#org` },
      jobTitle: "Owner",
    });
  }

  // Strip undefined so the emitted JSON is clean for validators.
  const pruned = JSON.parse(JSON.stringify({ "@context": "https://schema.org", "@graph": graph }));
  return pruned;
}

/**
 * The meta description a search result actually shows.
 *
 * The donor's template produces "Plumbing in Jacksonville. Call +19047607837."
 * — true, and it wastes the one line a searcher reads before deciding. This
 * leads with what they searched for (the headline SERVICE, chosen by the
 * Compiler's keyword research when a packet supplied any, else their own first
 * service), then the proof that separates them from the next result: the rating
 * and how many people left it.
 *
 * Every clause is a VERIFIED fact. Keywords only decide the ORDER — which
 * service leads — and can never introduce a service the client does not offer.
 */
function seoDescription({ facts = {}, services = [], keywords = [] }) {
  const where = verifiedServiceAreas(facts)[0] || "";
  const names = services.map((s) => clean(typeof s === "string" ? s : s && s.name)).filter(Boolean);
  if (!names.length) return "";

  // DEFECT 7 (2026-09-02 audit): the lead service arrives as stored — an
  // ALL-CAPS harvest printed "PLUMBING offered by …" into og:description, and
  // a business_name that already ends in a period met the composer's own one
  // ("…offered by United Contractors Inc.."). The lead is de-shouted and every
  // inserted value gives up its trailing period BEFORE the clause appends its
  // own — the composer owns exactly one period per clause.
  const displayName = (n) => trimTrailingPeriod(titleCaseShoutedTokens(n));
  const leadRaw = names.find((n) => keywords.some((k) => n.toLowerCase().includes(String(k).toLowerCase().split(" ")[0])))
    || names[0];
  const lead = displayName(leadRaw);

  const parts = [where ? `${lead} in ${trimTrailingPeriod(where)}.` : `${lead} offered by ${trimTrailingPeriod(clean(facts.business_name))}.`];
  const rating = Number(facts.rating);
  const count = Number(facts.review_count);
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(count) && count > 0) {
    parts.push(`Rated ${rating.toFixed(1)} from ${Math.trunc(count)} Google reviews.`);
  }
  const others = names.filter((n) => n !== leadRaw).slice(0, 2);
  if (others.length) parts.push(`Also ${others.map((n) => displayName(n).toLowerCase()).join(", ")}.`);
  if (clean(facts.phone)) parts.push(`Call ${humanPhone(facts.phone)}.`);

  // Search engines truncate around 160 characters; a sentence cut mid-word
  // reads as broken rather than concise.
  let text = "";
  for (const part of parts) {
    if ((`${text} ${part}`).trim().length > 158) break;
    text = (`${text} ${part}`).trim();
  }
  return text;
}

/**
 * THE TITLE A LINK PREVIEW ACTUALLY READS.
 *
 * These mirrors are React SPAs and their `<title>` is written on mount by
 * react-helmet-async, so the RENDERED title has been right all along — 96 of 100
 * live hosts carry the business name. The RAW `<title>` in the shipped
 * index.html is a different string entirely, and it is the one that matters to
 * everything that does not run JavaScript: Facebook, LinkedIn, Slack, iMessage,
 * WhatsApp, and a crawler's first pass.
 *
 * Measured across the live fleet on 2026-08-11:
 *   raw title differs from rendered on            47 / 100
 *   raw title is the byte-identical donor default 33 / 100
 *   raw canonical absent on                       33 / 100  (the same 33)
 *
 * All thirty-three ship `<title>HVAC Contractor | AC & Heating Services</title>`
 * with matching `og:title` and `twitter:title`. Thirty-three different companies
 * with one identity between them, and every share of any of those links renders
 * as the same anonymous card.
 *
 * THE DONOR IS NOT AT FAULT AND IS NOT BEING "FIXED" HERE. donors-clean/
 * hvac-premier/index.html carries no `{{ }}` tokens ON PURPOSE — its head
 * comment says why, and the reasoning is right: a static file cannot collapse a
 * fact the engine could not verify, so a token there renders either a raw
 * placeholder or a hole ("HVAC in , "). The correct place to write a per-client
 * head is the place that KNOWS the facts are verified, which is here, at
 * publish, after facts have cleared MirrorRequest's minimum (name, industry,
 * city, state are all required to get this far).
 *
 * Composed the same way seoDescription composes, and for the same reason:
 * clauses are appended only while they fit, so the result is never a sentence
 * cut mid-word. Nothing is invented — every clause is a verified fact.
 */
function seoTitle({ facts = {}, pageLabel = "" }) {
  const name = clean(facts.business_name);
  if (!name) return "";
  // THE TRADE WORD IS DROPPED WHEN THE NAME ALREADY SAYS IT (owner walkthrough
  // 2026-08-12). "Diamond State Plumbing | plumbing in Little Rock" reads
  // "plumbing" twice — half the trades carry their trade in their name, and a
  // doubled word is the tell that a machine wrote the title. Word-run
  // containment on normalized text, so "Plumbing" in the name suppresses trade
  // "plumbing" while "Temperature Pros" does not suppress "hvac". The `where`
  // clause survives on its own: "Diamond State Plumbing | Little Rock, AR".
  const tradeRaw = clean(tradeLabel(facts.industry));
  const simplify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tradeWords = simplify(tradeRaw);
  const nameCarriesTrade = Boolean(tradeWords)
    && new RegExp(`(^| )${tradeWords.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(simplify(name));
  const trade = nameCarriesTrade ? "" : tradeRaw;
  const serviceMarket = verifiedServiceAreas(facts)[0] || "";
  const location = [clean(facts.city), clean(facts.state)].filter(Boolean).join(", ");
  const lead = pageLabel ? `${clean(pageLabel)} — ${name}` : name;
  // Search engines truncate the displayed title around 60 characters; the tail
  // clauses are dropped rather than cut.
  const candidates = [
    trade && serviceMarket ? `${lead} | ${trade} in ${serviceMarket}` : "",
    trade && location ? `${lead} | ${trade} | ${location}` : "",
    trade ? `${lead} | ${trade}` : "",
    location ? `${lead} | ${location}` : "",
    lead,
  ].filter(Boolean);
  return candidates.find((c) => c.length <= 62) || lead;
}

/**
 * The canonical path for ONE emitted file.
 *
 * injectHead runs over every .html in the bundle — index, about, faq,
 * service-areas, team — so a single canonical pointing at the site root would
 * tell a crawler that every page IS the home page, which is worse than having
 * none. Vercel serves this lane with cleanUrls, so `about.html` is `/about`.
 *
 * 404.html is deliberately excluded by the caller: it is noindex, and a
 * canonical on an error page points a crawler at content that is not there.
 */
function canonicalPathFor(rel) {
  const file = String(rel || "").replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!/\.html$/i.test(file)) return "";
  if (/^404\.html$/i.test(file)) return "";
  const bare = file.replace(/\.html$/i, "");
  if (bare === "index") return "/";
  if (/\/index$/.test(bare)) return `/${bare.replace(/\/index$/, "")}/`;
  return `/${bare}`;
}

/** The human name of a known route, for its own title. "" for the home page. */
const PAGE_LABELS = Object.freeze({
  about: "About",
  "service-areas": "Service Areas",
  faq: "FAQ",
  faqs: "FAQ",
  team: "Our Team",
  services: "Services",
  contact: "Contact",
});

function pageLabelFor(rel) {
  const path = canonicalPathFor(rel);
  if (!path || path === "/") return "";
  return PAGE_LABELS[path.replace(/^\/|\/$/g, "").toLowerCase()] || "";
}

function injectHead(html, { facts, logoUrl, siteUrl, heroAsset, fonts, content = {}, rel = "index.html" }) {
  let out = html;
  const add = [];
  const origin = String(siteUrl || "").replace(/\/$/, "");
  const canonicalPath = canonicalPathFor(rel);
  const canonicalUrl = origin && canonicalPath ? `${origin}${canonicalPath}` : "";

  // ---- IDENTITY IN THE RAW HEAD ------------------------------------------
  // Replace where the donor already declares one, append where it does not, so
  // a donor that ships a token-free head and a donor that ships a tokenised one
  // both end up with exactly one correct value and never two competing ones.
  // A DONOR THAT ALREADY NAMES THE CLIENT IS LEFT ALONE.
  //
  // Two mechanisms can put identity in this head and they must not fight. A
  // donor may tokenise its own `<title>` ({{BUSINESS_NAME}} … {{CITY}}), which
  // hydrate resolves BEFORE this function runs (engine.js: hydrate at stage 296,
  // content inject at 422) — and that version is better, because the donor's
  // author can phrase it for their trade. This pass is the FLOOR, for the donors
  // nobody has tokenised, and it must not overwrite a tailored title with a
  // generic one. So the test is not "does a title exist" but "does the title
  // already name this business".
  // COMPARED IN BOTH SPELLINGS. A donor writes `{{BUSINESS_NAME}}` into markup,
  // so hydrate leaves "Rose City Heating &amp; Air" in the title while
  // facts.business_name is "Rose City Heating & Air". Comparing one form only
  // made every ampersanded business look un-named, and this pass then
  // overwrote the donor's tailored title with its own floor version.
  const namesClient = (value) => {
    const v = clean(value).toLowerCase();
    const business = clean(facts.business_name).toLowerCase();
    if (!business) return false;
    return v.includes(business) || v.includes(esc(business).toLowerCase());
  };
  const existingTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(out);
  const title = seoTitle({ facts, pageLabel: pageLabelFor(rel) });
  if (title && !(existingTitle && namesClient(existingTitle[1]))) {
    const t = esc(title);
    out = existingTitle
      ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${t}</title>`)
      : out.replace(/<\/head>/i, `<title>${t}</title>\n</head>`);
    for (const [attr, key] of [["property", "og:title"], ["name", "twitter:title"]]) {
      const re = new RegExp(`(<meta[^>]+${attr}=["']${key}["'][^>]*content=["'])([^"']*)(["'])`, "i");
      const m = re.exec(out);
      if (m && !namesClient(m[2])) out = out.replace(re, `$1${t}$3`);
      else if (!m) add.push(`<meta ${attr}="${key}" content="${t}" />`);
    }
  }
  if (canonicalUrl) {
    if (/<link[^>]+rel=["']canonical["']/i.test(out)) {
      out = out.replace(/(<link[^>]+rel=["']canonical["'][^>]*href=["'])([^"']*)(["'])/i, `$1${esc(canonicalUrl)}$3`);
    } else {
      add.push(`<link rel="canonical" href="${esc(canonicalUrl)}" />`);
    }
    // og:url and og:site_name are the two per-business properties the
    // token-free donors omit by design. They are per-business facts, and here
    // the business is known.
    if (!/property=["']og:url["']/i.test(out)) add.push(`<meta property="og:url" content="${esc(canonicalUrl)}" />`);
  }
  if (clean(facts.business_name) && !/property=["']og:site_name["']/i.test(out)) {
    add.push(`<meta property="og:site_name" content="${esc(clean(facts.business_name))}" />`);
  }
  // Rewrite the description with the search-facing one when we can build a
  // better sentence than the donor's template produced.
  const desc = clean(content.seo_description)
    || seoDescription({ facts, services: content.services || [], keywords: content.keywords || [] });
  if (desc) {
    out = out.replace(/(<meta[^>]+name=["']description["'][^>]*content=["'])([^"']*)(["'])/i, `$1${esc(desc)}$3`);
    out = out.replace(/(<meta[^>]+property=["']og:description["'][^>]*content=["'])([^"']*)(["'])/i, `$1${esc(desc)}$3`);
  }
  // THE CLIENT'S WEBFONT. The CSS pass renames the donor's font variables to
  // their family, which does nothing at all unless the face is actually
  // loaded — the browser would fall straight through to the donor's fallback
  // and the mirror would look unchanged. Preconnect first: a font request that
  // waits on a fresh TLS handshake is the classic invisible-text delay.
  if (fonts && /^https:\/\/fonts\.googleapis\.com\//i.test(String(fonts.href || ""))
    && !/fonts\.googleapis\.com/i.test(out)) {
    add.push('<link rel="preconnect" href="https://fonts.googleapis.com" />');
    add.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
    add.push(`<link rel="stylesheet" href="${esc(fonts.href)}" />`);
  }
  // THE SOCIAL CARD IMAGE. Absolute, on the client's own host, or not at all.
  //
  // Two failures this closes. A RELATIVE og:image is ignored by every scraper
  // (og: URLs must be absolute), and a donor that shipped its own uploaded
  // og-image would publish ANOTHER COMPANY'S PHOTO as this client's share card —
  // the same class of defect as the Mastercool badge that passed 10/10 gates as
  // a client logo. Ownership of the bundle is not ownership of the picture.
  const cardImage = logoUrl ? (logoUrl.startsWith("http") ? logoUrl : origin + logoUrl) : "";
  const offSite = (value) => {
    const v = clean(value);
    if (!v) return false;
    if (v.startsWith("/")) return true;                       // relative: unusable in og:
    if (!origin) return false;
    return !v.startsWith(origin) && !(cardImage && v === cardImage);
  };
  for (const [attr, key] of [["property", "og:image"], ["name", "twitter:image"]]) {
    const re = new RegExp(`(<meta[^>]+${attr}=["']${key}["'][^>]*content=["'])([^"']*)(["'])`, "i");
    const m = re.exec(out);
    if (!m && cardImage) {
      add.push(`<meta ${attr}="${key}" content="${esc(cardImage)}" />`);
      if (key === "og:image") add.push(`<meta property="og:image:alt" content="${esc(facts.business_name)}" />`);
    } else if (m && offSite(m[2]) && cardImage) {
      out = out.replace(re, `$1${esc(cardImage)}$3`);
    }
  }
  if (!/name=["']twitter:card["']/i.test(out)) {
    add.push(`<meta name="twitter:card" content="summary_large_image" />`);
  } else if (!/summary_large_image/i.test(out)) {
    // A donor shipping `summary` gets UPGRADED, not skipped — a large-image
    // card is the point, and skipping silently leaves the weaker card live.
    out = out.replace(/(<meta[^>]+name=["']twitter:card["'][^>]+content=["'])[^"']*(["'])/i, `$1summary_large_image$2`);
  }
  if (!/rel=["']preconnect["']/i.test(out)) {
    add.push(`<link rel="preconnect" href="https://www.google.com" />`);
  }
  // Preload the hero medium (one only — preloading everything is worse than
  // preloading nothing). Prefer the poster image; else the hero video.
  // GOTCHA-2 applies here too: hero URLs often live only in the router chunk,
  // so the asset comes from the shipped FILE LIST, not from index.html.
  if (!/rel=["']preload["']/i.test(out) && heroAsset) {
    const as = /\.(mp4|webm)$/i.test(heroAsset) ? "video" : "image";
    add.push(`<link rel="preload" as="${as}" href="/${esc(heroAsset)}"${as === "image" ? ' fetchpriority="high"' : ""} />`);
  }
  if (!add.length) return out;
  return out.replace(/<\/head>/i, `${add.join("\n")}\n</head>`);
}

/**
 * A real 404.html. With cleanUrls, Vercel serves it with a genuine 404 status
 * for unknown paths instead of the SPA shell answering 200 to everything — a
 * soft 404 tells a crawler the page exists.
 *
 * Lives OUTSIDE inject() and is called unconditionally by the engine: it used
 * to be written only when a caller supplied `content`, so every content-free
 * build — which is every build the last gate ran — shipped no 404 page at all
 * and leaned entirely on the catch-all rewrite.
 */
function notFoundPage({ facts = {}, phoneDigits = "" }) {
  return Buffer.from(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>`
    + `<title>Page not found — ${esc(facts.business_name)}</title><meta name="robots" content="noindex"/>`
    + `<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0d0d0c;color:#f2f2ee;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;padding:2rem}`
    + `p.k{font-size:.78rem;letter-spacing:.18em;opacity:.55;margin:0 0 .6rem}h1{font-size:clamp(1.5rem,4vw,2.2rem);margin:0 0 1rem}a{color:#e8b45e;font-weight:600}</style></head>`
    + `<body><div><p class="k">404</p><h1>That page is not here.</h1><p><a href="/">Back to ${esc(facts.business_name)}</a>`
    + `${phoneDigits ? ` · <a href="tel:${esc(phoneDigits)}">Call ${esc(humanPhone(facts.phone) || phoneDigits)}</a>` : ""}</p></div></body></html>`,
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// LEGAL HYGIENE OF A CONCEPT SITE (owner-endorsed, 2026-08).
//
// Every site this engine ships is a CONCEPT until the client says otherwise: a
// proposal assembled from a donor template around a real business's verified
// facts. The difference between "who stole my site" and "who made me this" is
// two small honest signals, and they cost a build nothing:
//
//   1. `noindex, nofollow` in EVERY page's robots meta, so a search engine
//      never presents a concept as the business's live website. Idempotent by
//      contract: a page that already declares a robots meta keeps whatever
//      non-index directives it asked for and has its index-class directives
//      REPLACED (the donor library ships `index,follow` on generated pages;
//      the 404 ships bare `noindex` — both leave this pass as `noindex,
//      nofollow`, exactly once).
//   2. A small visible attribution line — "Unofficial concept by WSS Labs" —
//      anchored before </body> with the same discipline as the call bar: a
//      self-contained block, own stylesheet, no donor layout dependency, never
//      inserted inside a hydration root. The class is `wss-attr` so
//      RELOCATE_JS's footer() skips it when hunting the donor's real footer.
//
// The customer's own production sites are NOT this module's concern: the
// SiteForge lane (lib/mirror-build.js) and the edit engine (lib/seo-page-edit.
// js) assemble pages without this file, so they carry neither signal.
// ---------------------------------------------------------------------------

const NOINDEX_META = `<meta name="robots" content="noindex, nofollow" />`;
const ATTRIBUTION_MARKER = "data-wss-attribution";

/**
 * The one-line attribution. "WSS Labs" is the public brand voice (signup
 * floater, email footers); the support address is the same one every other
 * customer-facing surface resolves, env-overridable, never a dead inbox.
 */
function buildAttributionFooter({ supportEmail = "" } = {}) {
  const email = clean(supportEmail) || clean(process.env.GHOST_AGENCY_SUPPORT_EMAIL) || "support@woodwardsoftware.com";
  const css = [
    "footer.wss-attr{display:block;padding:18px 16px 22px;text-align:center;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.5;letter-spacing:.01em;color:#8a8f98}",
    "footer.wss-attr a{color:inherit;font-weight:600;text-decoration:underline;text-underline-offset:2px}",
    "footer.wss-attr a:hover{opacity:.8}",
  ].join("\n");
  return `<style id="wss-attr-css">${css}</style>`
    + `<footer class="wss-attr" ${ATTRIBUTION_MARKER}="v1">Unofficial concept by `
    + `<a href="mailto:${esc(email)}">WSS Labs</a></footer>`;
}

/**
 * The noindex meta, enforced on ONE page's markup. Returns the same string
 * when the page already carries the full directive — a second pass can never
 * stack a second meta.
 */
function noindexHtml(html) {
  const metaRe = /<meta[^>]*?\bname=["']robots["'][^>]*>/i;
  const m = metaRe.exec(html);
  if (!m) {
    if (!/<\/head>/i.test(html)) return html;
    return html.replace(/<\/head>/i, `${NOINDEX_META}\n</head>`);
  }
  const tag = m[0];
  if (/content=["'][^"']*\bnoindex\b[^"']*\bnofollow\b[^"']*["']/i.test(tag)) return html;
  const contentRe = /\bcontent=["']([^"']*)["']/i;
  const cm = contentRe.exec(tag);
  const indexClass = /^(all|none|index|noindex|follow|nofollow)$/i;
  const nextTag = cm
    // Keep what the page asked for beyond indexing (noarchive, max-image-preview
    // …); replace only the index-class directives with the honest ones.
    ? tag.replace(contentRe, () => `content="${[
      ...cm[1].split(/[\s,]+/).map((t) => t.trim()).filter((t) => t && !indexClass.test(t)),
      "noindex", "nofollow",
    ].join(", ")}"`)
    : tag.replace(/\s*\/?>$/i, ` content="noindex, nofollow"/>`);
  return html.slice(0, m.index) + nextTag + html.slice(m.index + tag.length);
}

/**
 * applyLegalHygiene({ files }) — both signals over EVERY .html in the bundle.
 * Runs as the engine's final tree pass, so generated authority pages, the 404
 * and content-empty builds receive them the same as the donor's own pages.
 * Returns { files, report }; the input map is never mutated.
 */
function applyLegalHygiene({ files = {}, supportEmail = "" } = {}) {
  const out = { ...files };
  const footer = buildAttributionFooter({ supportEmail });
  const report = { noindex_pages: 0, attribution_pages: 0, pages: 0 };
  for (const rel of Object.keys(out)) {
    if (!/\.html$/i.test(rel)) continue;
    const before = out[rel].toString("utf8");
    let html = noindexHtml(before);
    if (html !== before) report.noindex_pages += 1;
    if (footer && !html.includes(ATTRIBUTION_MARKER) && /<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${footer}\n</body>`);
      report.attribution_pages += 1;
    }
    if (html !== before) {
      out[rel] = Buffer.from(html, "utf8");
      report.pages += 1;
    }
  }
  return { files: out, report };
}

/**
 * Narrow chat-only path for builds that have no authority content to inject.
 * This is intentionally idempotent so engine callers can use it without
 * knowing whether a fuller content pass already installed the widget.
 * `pages` and `bytes` count only markup emitted by THIS call.
 */
function injectChatWidget({ files = {}, facts = {}, slug = "", brand = null } = {}) {
  const out = { ...files };
  // The trade frames Riley as an expert ("Ask Riley — free HVAC advice") on the
  // launcher. Resolved here from the verified industry, so both inject() and the
  // engine's own call get it without threading a new argument through either.
  const chatCfg = resolveChatWidgetConfig({ facts, slug, brand: brand || {}, trade: tradeLabel(facts.industry) });
  const chatWidget = chatCfg.ok ? buildChatWidget(chatCfg.config) : "";
  const report = {
    present: false,
    pages: 0,
    bytes: 0,
    reason: chatCfg.ok ? "" : chatCfg.reason,
  };
  if (!chatWidget) return { files: out, report };

  let bodyAnchors = 0;
  for (const rel of Object.keys(out)) {
    if (!/\.html$/i.test(rel)) continue;
    let html = out[rel].toString("utf8");
    if (/id=["']wss-chat-root["']/i.test(html)) {
      report.present = true;
      continue;
    }
    if (!/<\/body>/i.test(html)) continue;
    bodyAnchors += 1;
    html = html.replace(/<\/body>/i, `${chatWidget}\n</body>`);
    out[rel] = Buffer.from(html, "utf8");
    report.present = true;
    report.pages += 1;
    report.bytes += Buffer.byteLength(chatWidget, "utf8");
  }
  if (!report.present && bodyAnchors === 0) report.reason = "no_body_close_tag_to_anchor_chat";
  return { files: out, report };
}

// ---------------------------------------------------------------------------
// THE CHAT HANDOFF (feature 11, owner 2026-09-02). The Riley chat widget is a
// relay, not a dead end: when the widget is on the page AND the business
// publishes a phone, a visitor reading the panel gets one honest affordance —
// "Prefer to talk? Call Riley" — wired to the SAME tel: resolution every other
// Riley CTA answers to (lib/riley-line.js pattern: the client's own provisioned
// line first, the configured agency line otherwise). No new channel is invented
// here; the handoff renders ONLY when `features.chat_handoff` is promoted
// (default OFF), and it dials Riley — never the client's front-desk NAP phone,
// which Riley does not answer.
//
// It is a separate build-time block (chat-widget.js is not touched) that self-
// wires against #wss-chat-root at parse time, idempotent via a data marker, so
// a second pass can never stack a second affordance. Absent from proof shots.
// ---------------------------------------------------------------------------

/**
 * The tel: href the handoff dials, or "". Resolution order:
 *   1. `signup.rileyTel` — already resolved upstream through lib/riley-line by
 *      resolveSignupConfig (the one reader both build paths share);
 *   2. resolveRileyLine asked directly on these facts — the client's provisioned
 *      line fields, then the configured agency line. `phone === null` means
 *      OMIT: no line resolved, no affordance, never a guessed number.
 */
function chatHandoffTelHref({ signup = null, facts = {} } = {}) {
  const fromSignup = String((signup && signup.rileyTel) || "").trim();
  if (/^tel:/i.test(fromSignup)) return fromSignup;
  const riley = resolveRileyLine({ facts, allowAgencyLine: true });
  return (riley && riley.telHref) || "";
}

/** The handoff markup: one style, one anchor-building script. Build-time href. */
function buildChatHandoff({ telHref = "" } = {}) {
  const href = String(telHref || "").trim();
  if (!/^tel:/i.test(href)) return "";
  const css = `#wss-chat-call{display:block;margin:8px 3px 1px;padding:9px 12px;border:1px solid rgba(17,17,17,.16);border-radius:11px;background:#fff;color:#171717;text-align:center;font-family:inherit;font-size:13px;font-weight:700;line-height:1.2;text-decoration:none;cursor:pointer}
#wss-chat-call:hover{border-color:var(--wss-chat-brand,#1c1e23);color:var(--wss-chat-brand,#1c1e23)}
@media(prefers-reduced-motion:reduce){#wss-chat-call{transition:none}}`;
  // The widget's markup is parsed BEFORE this block (both anchor before
  // </body>, widget first), so the nodes exist when this script runs.
  const script = `<script>(function(){try{
var root=document.getElementById("wss-chat-root"),form=document.getElementById("wss-chat-form");
if(!root||!form||root.getAttribute("data-wss-chat-handoff")==="true")return;
if(/[?&]wssthumb=1(?:&|$)/.test(location.search))return;
root.setAttribute("data-wss-chat-handoff","true");
var a=document.createElement("a");
a.id="wss-chat-call";a.className="wss-chat__call";
a.setAttribute("href",${jsonEsc(href)});
a.textContent="Prefer to talk? Call Riley";
var status=document.getElementById("wss-chat-status");
if(status&&status.parentNode===form)form.insertBefore(a,status.nextSibling);else form.appendChild(a);
}catch(e){}})();</script>`;
  return `<style id="wss-chat-handoff-css">${css}</style>${script}`;
}

/**
 * injectChatHandoff({ files, facts, signup, flags }) -> { files, report }.
 * Flag-gated (features.chat_handoff), gated on the chat widget being present
 * AND the business publishing a phone AND a Riley line resolving. Idempotent:
 * a page already carrying the marker is counted, not restamped.
 */
function injectChatHandoff({ files = {}, facts = {}, signup = null, flags = null } = {}) {
  const rail = flags || contactRailFlags(facts);
  const report = { present: false, pages: 0, bytes: 0, tel: "", reason: "" };
  if (!rail.chat_handoff) {
    report.reason = "chat_handoff_flag_off";
    return { files, report };
  }
  if (!clean(facts.phone)) {
    report.reason = "no_business_phone_for_handoff";
    return { files, report };
  }
  const telHref = chatHandoffTelHref({ signup, facts });
  const snippet = buildChatHandoff({ telHref });
  if (!snippet) {
    report.reason = "no_riley_line_for_handoff";
    return { files, report };
  }
  const out = { ...files };
  let widgetPages = 0;
  for (const rel of Object.keys(out)) {
    if (!/\.html$/i.test(rel)) continue;
    let html = out[rel].toString("utf8");
    if (!/id=["']wss-chat-root["']/i.test(html)) continue;
    widgetPages += 1;
    // BUILD-TIME idempotency: the snippet's style id is present. (The script's
    // data-wss-chat-handoff attribute is stamped at RUNTIME on #wss-chat-root;
    // this check is for re-running the injector over already-built files.)
    if (/id=["']wss-chat-handoff-css["']/.test(html)) {
      report.present = true;
      continue;
    }
    if (!/<\/body>/i.test(html)) continue;
    html = html.replace(/<\/body>/i, `${snippet}\n</body>`);
    out[rel] = Buffer.from(html, "utf8");
    report.present = true;
    report.pages += 1;
    report.bytes += Buffer.byteLength(snippet, "utf8");
  }
  report.tel = /^tel:/i.test(telHref) ? telHref : "";
  if (!widgetPages) report.reason = "no_chat_widget_present";
  return { files: out, report };
}

/**
 * rewriteOriginMedia({ files }) — the origin-media RECORDER.
 *
 * When the engine builds in media_mode:"origin" it writes a URL manifest at
 * assets/wss-origin-media.json instead of placing photo bytes. The shipped
 * page keeps the DONOR FAMILY'S OWN bundled media in every slot — the exact
 * photographs the donor tree ships — and no reference anywhere in the built
 * HTML/JS/CSS points at the prospect's origin.
 *
 * OWNER ORDER (2026-09-04, render-regression lane): OUR mirror never
 * hotlinks the prospect's domain. The hotlink-until-pay swap (v1, owner
 * directive 2026-08-17) rewrote every slot reference to the prospect's own
 * verified URL — cheaper than housing bytes, but it made every unpaid
 * preview's galleries, before/after sliders, hero posters and hero ladders
 * depend on the prospect's hotlink protection and file hygiene, and the
 * 2026-09-04 fleet audit read exactly those swapped `<img>` tags as the
 * regression's donor-leakage marker. The economics the v1 directive wanted
 * survive intact: origin mode still houses ZERO prospect bytes, every
 * candidate is still fetched + sniffed + sha256-hashed once at build time
 * (the truth law is unchanged), and the manifest this pass validates is
 * still the record the paid migration (checkout webhook → re-mirror with
 * media_mode:"housed") houses from. What changed is only what the PAGE
 * references: bundled family media, never their origin.
 *
 * Photo entries only. A hero_video entry records the paid migration's target;
 * the donor's ladder runtime arms a rung from bytes that actually shipped, so
 * an un-housed clip stays un-armed (the WSS fallback rung plays) rather than
 * aimed at a URL the ladder never verified.
 *
 * Returns { files, report } — a copy of the map; the input is never mutated.
 * No manifest in the tree is the ordinary housed build: a no-op that says so.
 */
function rewriteOriginMedia({ files = {} } = {}) {
  const out = { ...files };
  const report = { applied: false, entries: 0, rewrites: 0, files_touched: 0, slots_rewritten: [], reason: "no_origin_media_manifest" };
  const raw = out["assets/wss-origin-media.json"];
  if (!raw) return { files: out, report };
  let manifest = null;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    report.reason = "origin_media_manifest_unparseable";
    return { files: out, report };
  }
  const entries = (Array.isArray(manifest && manifest.entries) ? manifest.entries : [])
    .filter((e) => e && e.slot && /^https:\/\//i.test(String(e.url)) && e.kind !== "hero_video");
  if (!entries.length) {
    report.reason = "origin_media_manifest_empty";
    return { files: out, report };
  }
  // RECORDED, NEVER REWRITTEN (owner order above). The manifest stays the
  // migration's source of truth — every entry names the slot the paid pass
  // will house — while the page goes on referencing the bundled slot paths
  // the donor shipped. The report says exactly that, with the ban named, so
  // evidence reads as a policy state, never as a silent no-op.
  report.applied = false;
  report.reason = "prospect_hotlinks_banned_owner_order_2026_09_04";
  report.entries = entries.length;
  report.slots_rewritten = [];
  return { files: out, report };
}


/**
 * Static hero bridge for client-rendered React donors.
 *
 * This deliberately targets ONLY an empty SPA mount node. A non-empty React
 * root is already SSR/prerendered and belongs to React hydration; injecting
 * into one recreates the #418 failure this module already guards against for
 * authority content. An empty createRoot() shell is different: these bytes are
 * the no-JS/server view, and the first client render replaces the root's
 * children atomically, so there is never a second H1 after React mounts.
 */
function heroPrerenderFamily(manifest = {}) {
  const dna = manifest && manifest.visual_dna && manifest.visual_dna.hero;
  const note = [manifest.name, manifest.label, manifest.source, manifest.hero_note, manifest.hero_wash_note, dna]
    .filter(Boolean)
    .map((value) => typeof value === "string" ? value : JSON.stringify(value))
    .join(" ");
  if (manifest.name === "plumbing-clean" || /OPS-INSTRUMENT|instrument HUD/i.test(note)) return "instrument";
  if (/full[- ]bleed|full[- ]screen|cinematic photo/i.test(note)
    || (manifest.hero_wash && String(manifest.hero_wash.selector || "").trim())) return "full-bleed";
  return "";
}

function heroPrerenderIdentity({ facts = {}, content = {}, identityCopy = null } = {}) {
  const fallback = composeIdentityCopy({
    facts,
    marketCity: marketCity(facts),
    pride: content && content.pride,
  });
  const copy = identityCopy && typeof identityCopy === "object" ? identityCopy : fallback;
  const lines = copy.lines && typeof copy.lines === "object" ? copy.lines : {};
  const a = clean(lines.a);
  const b = clean(lines.b);
  const c = clean(lines.c);
  const headline = clean(copy.headline) || [a, b].filter(Boolean).join(" ");
  return { a, b, c, headline };
}

function instrumentHeroPrerender({ facts = {}, identity = {} } = {}) {
  const business = clean(facts.business_name);
  const city = marketCity(facts);
  const state = clean(facts.state);
  const trade = tradeLabel(facts.industry) || "Plumbing";
  const place = [city, state].filter(Boolean).join(", ");
  const tradeLine = [trade, place ? `in ${place}.` : ""].filter(Boolean).join(" ");
  const sr = [business, tradeLine].filter(Boolean).join(" — ");
  const headline = identity.headline || [identity.a, identity.b].filter(Boolean).join(" ");
  if (!headline) return "";
  return `<section id="top" data-wss-ssr-hero="instrument" class="relative isolate w-full overflow-hidden bg-slurry text-bone pt-[96px] sm:pt-[112px] lg:pt-[120px]">
<div class="relative mx-auto max-w-[1760px] px-5 lg:px-10"><div class="relative w-full bg-slurry"><div class="w-full min-w-0 p-6 sm:p-10 lg:p-14"><div class="grid grid-cols-12 items-end gap-6"><div class="col-span-12 min-w-0 lg:col-span-8">
<h1 class="font-display font-black leading-[1.05] tracking-[-0.03em] text-bone animate-blur-in [overflow-wrap:anywhere]" style="animation-delay:0.08s"><span class="sr-only">${esc(sr)} </span><span aria-hidden="true" class="block text-[clamp(32px,5.5vw,96px)] text-balance">${esc(headline)}</span><span aria-hidden="true" class="mt-2 block text-[clamp(24px,3.4vw,56px)]"><span class="italic font-normal shimmer-text">Done</span> <span class="inline-block bg-gold px-3 text-slurry not-italic">right.</span></span></h1>
<p class="mt-7 max-w-2xl text-balance text-base leading-[1.55] text-bone/85 sm:text-lg animate-blur-in" style="animation-delay:0.28s"><span class="float-left mr-3 mt-1 font-display text-6xl font-black leading-[0.75] text-gold">F</span>rom one call to the final fix — plumbing for the homes and businesses of ${esc(city)} and the surrounding area, done the way it ought to be done.</p>
</div></div></div></div></div>
</section>`;
}

function fullBleedHeroPrerender({ facts = {}, identity = {}, manifest = {} } = {}) {
  const a = identity.a || identity.headline;
  const b = identity.b;
  const c = identity.c;
  if (!a && !b) return "";
  const lineB = b
    ? `<br><em class="not-italic relative inline-block text-primary-foreground text-4xl md:text-5xl lg:text-6xl"><span class="relative z-10">${esc(b)}</span></em>`
    : "";
  // The line-C node intentionally exists even when empty: the full-bleed React
  // family owns this exact third-line slot, so the server tree matches the
  // client component instead of inventing a crawler-only paragraph.
  const lineC = `<br><span class="block mt-4 text-lg md:text-xl font-normal text-primary-foreground/85">${esc(c)}</span>`;
  const business = clean(facts.business_name);
  const city = marketCity(facts);
  const landscapingDeck = manifest.name === "landscaping-evergreen"
    ? `<p class="mt-6 text-lg md:text-xl max-w-2xl text-primary-foreground/90">${esc(business)} brings thoughtful design, reliable maintenance and a real eye for detail to lawns and landscapes across the ${esc(city)} area.</p>`
    : "";
  return `<section id="top" data-wss-ssr-hero="full-bleed" class="relative pt-16 min-h-screen flex items-center overflow-hidden"><div class="relative max-w-7xl mx-auto px-4 md:px-8 py-20 md:py-28 grid lg:grid-cols-12 gap-10 items-center w-full"><div class="lg:col-span-7 text-primary-foreground animate-fade-up"><h1 class="font-display text-5xl md:text-6xl lg:text-7xl mt-6 leading-[1.02] text-balance">${esc(a)}${lineB}${lineC}</h1>${landscapingDeck}</div></div></section>`;
}

function injectHeroPrerender(html, { facts = {}, content = {}, manifest = {}, identityCopy = null } = {}) {
  const result = { html: String(html || ""), report: { present: false, family: null, reason: "" } };
  if (/<h1[\s>]/i.test(result.html)) {
    // ENGINE-REQUEST #681: an H1 the DOCUMENT itself owns — on a page with no
    // SPA mount root for a client framework to replace — is the static-donor
    // contract. The no-JS hero guarantee this bridge exists to fake already
    // holds, so the report names the family instead of refusing; the HTML is
    // returned untouched either way. An H1 on an SPA-shaped page (a #root/#app
    // mount present) is still a refusal: that H1 belongs to the app's own SSR,
    // not to this pass.
    const spaMount = /<div\b[^>]*\bid=["'](?:root|app)["'][^>]*>/i.test(result.html);
    result.report = spaMount
      ? { present: false, family: null, reason: "static_h1_already_present" }
      : { present: true, family: "static", reason: "static_h1_already_present" };
    return result;
  }
  const family = heroPrerenderFamily(manifest);
  if (!family) {
    result.report.reason = "hero_family_not_supported";
    return result;
  }
  const root = /(<div\b[^>]*\bid=["'](?:root|app)["'][^>]*>)\s*<\/div>/i.exec(result.html);
  if (!root) {
    result.report.reason = "empty_spa_root_not_found";
    return result;
  }
  const identity = heroPrerenderIdentity({ facts, content, identityCopy });
  const markup = family === "instrument"
    ? instrumentHeroPrerender({ facts, identity })
    : fullBleedHeroPrerender({ facts, identity, manifest });
  if (!markup) {
    result.report.reason = "hero_identity_empty";
    return result;
  }
  result.html = result.html.replace(root[0], `${root[1]}${markup}</div>`);
  result.report = { present: true, family, reason: "" };
  return result;
}

/**
 * THE CONTROL A11Y PATCH (audit 563 #9).
 *
 * Injected as a boot-time script next to the content island, the same lane as
 * every other DOM patch on compiled boilerplates: the fence donors are React
 * SPAs, so the star/favorite control the audit measured is rendered at runtime
 * and no static string replace can reach it. The patch runs after the donor
 * boots and gives an ACCESSIBLE NAME to icon-only toggle controls that have
 * none — the theme toggle (its own law, below) and any unlabeled button whose
 * markup marks it as a star/favorite/bookmark toggle (a lucide-star icon, a
 * ★/☆/⭐ glyph, or a star/favorite class or data attribute). It never touches
 * a control that already has an accessible name, so donor labels and the
 * engine's own labeled controls (chat, floater, theme) are untouched, and on a
 * site with no such control it is a no-op.
 */
function controlA11yPatchScript() {
  return `<script>try{var e=document.getElementById("wss-content");if(e)window.__WSS_CONTENT__=JSON.parse(e.textContent);var t=document.querySelector("[data-wss-theme-toggle],.theme-toggle");if(t&&!t.getAttribute("aria-label"))t.setAttribute("aria-label","Toggle color theme");`
    + `var STAR=/(?:^|[^a-z])(?:star|stars|favorite|favourite|bookmark)(?:[^a-z]|$)|(?:\\u2605|\\u2606|\\u2b50)/i;`
    + `function wssAccName(el){return el.getAttribute("aria-label")||el.getAttribute("aria-labelledby")||el.getAttribute("title")||(el.textContent||"").trim();}`
    + `var ctrls=document.querySelectorAll("button,[role=button],[role=switch],summary");`
    + `for(var i=0;i<ctrls.length;i++){var el=ctrls[i];`
    + `if(wssAccName(el))continue;`
    + `var mark=(el.getAttribute("class")||"")+" "+(el.getAttribute("data-favorite")||"")+" "+(el.getAttribute("data-favourite")||"")+" "+el.innerHTML;`
    + `if(!STAR.test(mark))continue;`
    + `el.setAttribute("aria-label","Toggle favorite");}`
    + `}catch(x){}</script>`;
}

/**
 * inject({ files, content, facts, phoneDigits, slug, logoUrl, brand })
 * Mutates a COPY of the file map and returns { files, report }.
 */
/**
 * NO-JS VISITORS GET A REAL DROPDOWN TOO (2026-09-02 fleet audit, defect 2).
 * The general-contractor donor ships `<select name="service"
 * data-wss-service-select>` with only the placeholder option; its bundle
 * fills the options at runtime from the content island, so the SERVED HTML —
 * what crawlers and no-JS visitors read — had an empty dropdown. The same
 * verified service list the schema and the cards use is pre-rendered into
 * the select here. Each option carries data-wss-service-option so the pass
 * is idempotent, and the tiny tidy script removes the duplicates the
 * donor's own runtime appender then adds on top (it does not check what is
 * already there), so a JS visitor still sees each service exactly once.
 */
function prerenderServiceSelectOptions(html, services = []) {
  const result = { html: String(html || ""), present: false, added: 0, tidied: false };
  const selectRe = /(<select\b[^>]*data-wss-service-select[^>]*>)([\s\S]*?)(<\/select>)/i;
  const match = selectRe.exec(result.html);
  if (!match) return result;
  result.present = true;
  if (/data-wss-service-option/i.test(match[2])) return result;

  const names = [];
  const seen = new Set();
  for (const s of (Array.isArray(services) ? services : []).slice(0, 24)) {
    const name = clean(typeof s === "string" ? s : (s && (s.name || s.title)));
    if (!name || carriesTemplateToken(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (!names.length) return result;

  const options = names
    .map((n) => `<option value="${esc(n)}" data-wss-service-option>${esc(n)}</option>`)
    .join("");
  result.html = result.html.replace(selectRe, (m, open, inner, close) => `${open}${inner}${options}${close}`);
  result.added = names.length;
  result.tidied = true;
  // The donor appends island services again on boot; keep one option per
  // service. Runs early, on load, and briefly observes the select so an app
  // that mounts late cannot re-introduce duplicates either.
  result.html = result.html.replace(/<\/body>/i, `<script>(function(){var S="[data-wss-service-select]";function t(){var s=document.querySelector(S);if(!s)return;var seen={},os=s.options;for(var i=os.length-1;i>=0;i--){var k=(os[i].value||os[i].text||"").replace(/\\s+/g," ").trim().toLowerCase();if(!k)continue;if(seen[k]){s.removeChild(os[i]);}else{seen[k]=1;}}}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",t);}else{t();}
window.addEventListener("load",t);setTimeout(t,900);
try{var mo=new MutationObserver(function(){t();});mo.observe(document.documentElement,{childList:true,subtree:true});setTimeout(function(){mo.disconnect();},6000);}catch(e){}})();<\/script>
</body>`);
  return result;
}

function inject({ files, content: rawContent = {}, facts = {}, phoneDigits = "", slug = "", logoUrl = "", manifest = {}, fonts = null, signup = null, brand = null, identityPhoto = null, smsDigits = "", identityCopy = null }) {
  // The meta description, the sitemap prose and the markdown mirror all read
  // the same list; sanitizing here means none of them can print what the two
  // builders below already refuse. Reviews are display-ordered here too, so
  // the data island a consumes_content donor's own carousel reads can never
  // lead with a complaint the HTML block would have buried. Taxonomy fidelity
  // rides the same door (card-body enrichment + the density fallback) so the
  // island, the page and the schema all read one donor-faithful list.
  const content = withTaxonomyFidelity(orderReviewsForDisplay(withUsableServices(rawContent, facts.business_name)), facts.business_name);
  // AUDIT 563 BUG D: the island's FAQ array is read and rendered BY THE DONOR
  // itself (consumes_content), so anything raw here renders raw — the exact
  // bypass that shipped Canyon's fragment-wall answer. One sanitized list
  // feeds the island and llms.txt below; the builders clean at their own doors.
  const renderFaqs = sanitizedFaqs(content.faqs);
  const out = { ...files };
  const siteUrl = `https://${slug}.wss-ai.com/`;
  // ONE CARD, ONE SERVICE, ITS OWN WORDS. The island's service array is what
  // every consumes_content donor's card grid renders, so it leaves here with
  // each service's own bullet block bound (bespoke points ride through; a
  // service without them gets points generated FROM THAT SERVICE) and the
  // duplicate-block lint's verdict lands in the build report — a warning
  // entry, never a failed build. See lib/mirror-engine/service-cards.js for
  // the 2026-09-02 fleet defect (cycled template bullet-sets) this closes.
  const serviceBinding = bindServiceCards(content.services || []);
  // THE CONTENT DENSITY GUARD, in the report a build answers with: the donor's
  // distinct service count vs the cards the page actually renders, and a named
  // verdict ("collapsed" / "sparse" / "copy_thin" / "ok") when a taxonomy was
  // supplied. A verdict, never a mutation — the render door already did what
  // it could (enrichment + fallback); this line is how an operator SEES a
  // build that still went thin. Absent taxonomy reports null, not a fake ok.
  const donorTaxonomy = content.taxonomy && Array.isArray(content.taxonomy.services) ? content.taxonomy : null;
  const report = { sections: 0, schema_nodes: 0, faqs: 0, services: 0, reviews: 0, areas: 0, hours: 0, injected_into: [], hero_ssr: { present: false, family: null, reason: "index_html_not_seen" }, decor_artifacts: { suppressed: 0, pages: [] }, service_select: { pages: 0, options: 0 }, service_cards: serviceBinding.report, taxonomy: donorTaxonomy ? contentDensityVerdict({ taxonomy: donorTaxonomy, renderedServices: content.services || [] }) : null };

  // A DATA ISLAND carries the prospect's verified content into the donor's own
  // components (window.__WSS_CONTENT__, read before the bundle boots). A donor
  // that declares `consumes_content` renders these arrays ITSELF — that is a
  // real content slot, not an appended section — and we then skip injecting a
  // duplicate block for whatever it declares in `renders`.
  const island = `<script id="wss-content" type="application/json">${jsonEsc({
    version: "wss-content-v1",
    facts: {
      // `city` is the MARKET a donor component should print; `address_city` is
      // the NAP locality a donor component must use if it builds an address.
      business_name: facts.business_name, city: facts.service_area || "", address_city: facts.city, state: facts.state,
      phone: facts.phone, phone_digits: phoneDigits, email: isScraperArtifactEmail(facts.email) ? "" : (facts.email || ""),
      address: facts.address || "", license: facts.license || "",
      // A ZERO IS NOT A STAT — it is an absence wearing a number. The donors'
      // stat strips render these fields verbatim ("0.0 ★ / 0 GOOGLE REVIEWS"
      // measured live beside a hero that correctly said 4.8/144), and every
      // donor already null-guards, so the honest shape for "no verified
      // rating" is null, which OMITS the chip rather than contradicting the
      // page. Same source the hero reads (facts.*) — only the zero is refused.
      rating: Number(facts.rating) > 0 ? facts.rating : null,
      review_count: Number(facts.review_count) > 0 ? facts.review_count : null,
      logo_url: logoUrl, site_url: siteUrl,
    },
    services: serviceBinding.services,
    faqs: renderFaqs,
    reviews: content.reviews || [],
    // THE SAME BUILDER THE HTML BLOCK AND THE SCHEMA USE. The island went out
    // raw, so a consumes_content donor's header/footer coverage read exactly
    // what verifiedServiceAreas exists to repair — Canyon's "UT St. George, UT
    // Washington…" printed whole in a donor component. Normalized here, the
    // donor's select-and-coverage surfaces read "City, ST" or nothing else.
    areas: verifiedServiceAreas(facts, content.areas),
    hours: content.hours || null,
    // The island's about is rendered BY the donor (consumes_content), so the
    // raw dump would reach the page untouched — the same bypass #600 closed
    // for the island's FAQ array. One sanitizer, every surface.
    about: sanitizedAbout(content.about || content.story || "").join("\n\n"),
  })}</script>
${controlA11yPatchScript()}`;

  // THE LEFT-SIDE SIGN-UP PANEL (owner request) — and a LOUD account of it.
  //
  // `signup ? … : ""` is correct, but for months it was also SILENT: a build
  // path that forgot the `signup` key got no panel and no complaint, and four
  // live mirrors shipped with no Client ID, no Riley CTA and no price before
  // anyone noticed. A revenue surface that can vanish without appearing in any
  // report is a revenue surface that will vanish again, so the panel now writes
  // its own line into the report whether it renders or not — counted off the
  // emitted bytes, not asserted from the config.
  const floater = signup ? buildSignupFloater(signup) : "";
  report.signup_panel = {
    present: false,
    pages: 0,
    bytes: floater.length,
    client_id: (signup && signup.clientId) || "",
    riley: Boolean(signup && signup.rileyTel),
    checkout: Boolean(signup && signup.checkoutUrl),
    reason: signup
      // buildSignupFloater returns "" when there is nothing legitimate to show
      // (no Riley line AND no checkout) rather than a card that only advertises
      // a price. That is a refusal worth naming, not an empty string to shrug at.
      ? (floater ? "" : "signup_config_supplied_but_renderer_found_nothing_to_show")
      : "no_signup_config_supplied",
  };
  // THE CONTACT RAIL — feature flags first (default OFF, absent flag = absent
  // feature), then the gated components.
  const railFlags = contactRailFlags(facts);
  // SERVER-SIDE LEAD CAPTURE. The donors' quote forms either navigate to a
  // mailto: (three of them — the lead dies on a phone and is never counted) or
  // post with no fallback at all (four of them — a failed request loses the
  // lead outright). One capture-phase listener answers both, and reports itself
  // the same way the sign-up panel does: counted off the bytes actually
  // emitted, never asserted from the config.
  const leadCfg = resolveLeadCaptureConfig({
    facts: { ...facts, phone_human: humanPhone(facts.phone) },
    slug,
  });
  const leadCapture = leadCfg.ok ? buildLeadCapture(leadCfg.config) : "";
  report.lead_capture = {
    present: false,
    pages: 0,
    bytes: leadCapture.length,
    endpoint: leadCfg.ok ? leadCfg.config.endpoint : "",
    // The mailto: fallback needs an address the client actually owns. Naming
    // its absence is the difference between "no fallback configured" and a
    // fallback that opens a draft to nobody.
    fallback: leadCfg.ok ? (leadCfg.config.email ? "mailto" : leadCfg.config.phone ? "phone" : "none") : "none",
    reason: leadCfg.ok ? "" : leadCfg.reason,
  };
  // THE STICKY MOBILE CTA BAR (feature 2) — rendered ONLY when the business's
  // `features.sticky_cta` flag is promoted (default OFF). Text Us (feature 5)
  // needs BOTH `features.sms_cta` AND the `sms_capable` fact: the business's
  // own line verified textable, sms: aimed at THAT line — an explicit textable
  // number if one is held, else the business phone itself. A voice-only number
  // never grows an sms: link, flagged or not. Counted off the bytes, like the
  // panel above.
  const smsAllowed = railFlags.sms_cta && facts.sms_capable === true;
  // Kept raw (E.164 in, E.164 out) so buildCallBar can aim sms: at the same
  // international form the tel: link dials.
  const smsTargetDigits = smsDigits || facts.sms_phone || facts.textable_phone || facts.sms || (smsAllowed ? facts.phone || "" : "");
  const callBar = railFlags.sticky_cta
    ? buildCallBar({
      phoneDigits,
      phoneHuman: humanPhone(facts.phone),
      smsDigits: smsTargetDigits,
      smsAllowed,
      primaryCta: facts.primary_cta || null,
      businessName: facts.business_name,
      accent: brand && brand.accent,
    })
    : "";
  report.call_bar = {
    present: false,
    pages: 0,
    bytes: callBar.length,
    flag_on: railFlags.sticky_cta,
    call: !!callBar,
    text: /class="wss-cb__btn wss-cb__text"/.test(callBar),
    primary_cta: /class="wss-cb__btn wss-cb__cta"/.test(callBar),
    reason: !railFlags.sticky_cta
      ? "sticky_cta_flag_off"
      : (callBar ? "" : (String(phoneDigits || "").replace(/[^\d]/g, "").length < 7 ? "no_phone_to_persist" : "")),
  };
  const donorRenders = manifest.consumes_content ? (manifest.renders || []) : [];
  const block = buildContentHtml({ content, facts, phoneDigits, donorRenders, identityPhoto });
  const ld = buildJsonLd({ content, facts, phoneDigits, siteUrl, logoUrl });
  report.schema_nodes = (ld["@graph"] || []).length;
  // Count what the page ACTUALLY renders, not what was handed in. Reporting
  // "faqs: 0" while five verified questions are on the page is the kind of
  // false negative that sends someone hunting a bug that isn't there.
  report.faqs = (block.match(/<details id="faq-/g) || []).length || (content.faqs || []).length;
  report.services = (content.services || []).length;
  report.reviews = (content.reviews || []).length;
  report.areas = (content.areas || []).length;
  report.hours = normalizeHours(content.hours).length;
  // Trust badges + financing, counted off the emitted markup like everything
  // else here — the report says what the PAGE shows, not what was sent.
  report.trust_badges = (block.match(/data-wss-trustbadge=/g) || []).length;
  report.financing = /data-wss-financing/.test(block);
  // `class="wss-c"` was an exact-quote match, so the moment a section carried a
  // second class (`wss-c wss-p`) it stopped being counted — a section that
  // renders but reports zero is how a wiring regression hides.
  report.sections = block ? (block.match(/<section class="wss-c[ "]/g) || []).length : 0;
  // THE OWNER'S PRIDE POINTS, counted off the emitted markup rather than off
  // the request, so "we sent a pride block" and "the page shows it" can never
  // be confused for each other again.
  report.pride = {
    supplied: !!(content.pride && content.pride.sections && Object.keys(content.pride.sections).length),
    credentials: (block.match(/data-wss-pride="credential"/g) || []).length,
    standing: (block.match(/data-wss-pride="standing"/g) || []).length,
    differentiators: (block.match(/data-wss-pride="differentiator"/g) || []).length,
    plans: (block.match(/data-wss-pride="plan"/g) || []).length,
    promotions: (block.match(/data-wss-pride="promotion"/g) || []).length,
    cities: (block.match(/data-wss-pride="city"/g) || []).length,
    // Anchored on quote-or-space rather than the exact closing quote, so a
    // badge <img> gaining a second class can never silently uncount itself —
    // the same fix report.sections already needed for `wss-c wss-p`.
    badges_rendered_as_image: (block.match(/class="wss-p__badge[" ]/g) || []).length,
    // The awards/certifications shelf — present only when 2+ client-hosted
    // badge images cleared the ownership gate. Counted off emitted markup.
    badge_strip: (block.match(/data-wss-pride="badge-strip"/g) || []).length > 0,
  };
  // The identity band (a REAL face/crew/van), counted off the emitted markup —
  // present only when the engine passed an ownership-gated photograph.
  const identityMatch = block.match(/data-wss-identity="([a-z]+)"/);
  report.identity_band = {
    present: !!identityMatch,
    subject: identityMatch ? identityMatch[1] : null,
    reason: identityMatch ? "" : (identityPhoto && identityPhoto.url ? "photo_supplied_but_band_not_rendered" : "no_identity_photo"),
  };
  report.data_island = true;
  report.donor_consumes_content = Boolean(manifest.consumes_content);
  report.donor_renders = donorRenders;

  const ldTag = `<script type="application/ld+json">${jsonEsc(ld)}</script>`;

  // The hero the donor actually ships: poster image first (cheaper LCP win),
  // else the hero video.
  const heroAsset = Object.keys(out).find((f) => /(hero|poster)[^/]*\.(jpg|jpeg|png|webp|avif)$/i.test(f))
    || Object.keys(out).find((f) => /(hero)[^/]*\.(mp4|webm)$/i.test(f))
    || "";
  report.hero_preload = heroAsset || null;

  for (const rel of Object.keys(out)) {
    if (!/\.html$/i.test(rel)) continue;
    let html = out[rel].toString("utf8");
    // AUDIT 563 BUG E: masthead/hero decor nodes that render raw data get
    // emptied and hidden before anything else reads the page. Runs on every
    // HTML file so the artifact cannot survive on a subpage either.
    const decor = stripMastheadDecorArtifacts(html);
    if (decor.suppressed) {
      html = decor.html;
      report.decor_artifacts.suppressed += decor.suppressed;
      if (!report.decor_artifacts.pages.includes(rel)) report.decor_artifacts.pages.push(rel);
    }
    // `rel` decides this page's own canonical and its own title. Without it
    // every emitted page would claim to BE the home page.
    html = injectHead(html, { facts, logoUrl, siteUrl, heroAsset, fonts, content, rel });
    // The service <select> a donor leaves empty in the static bytes is
    // pre-rendered from the SAME verified service list the cards and the
    // schema use — no-JS visitors and crawlers read real options. Counted off
    // the emitted bytes like every other surface in this report.
    const serviceSelect = prerenderServiceSelectOptions(html, content.services || []);
    if (serviceSelect.present) {
      html = serviceSelect.html;
      report.service_select.pages += 1;
      report.service_select.options = serviceSelect.added || report.service_select.options;
    }
    if (rel === "index.html") {
      const heroSsr = injectHeroPrerender(html, { facts, content, manifest, identityCopy });
      html = heroSsr.html;
      report.hero_ssr = heroSsr.report;
    }
    // Data island goes BEFORE the donor bundle so window.__WSS_CONTENT__ is
    // already set when the app boots (a donor reading it on mount would
    // otherwise race the parser).
    // The sign-up panel goes in LAST, straight before </body>, so it sits above
    // the app and never inside a React root that would unmount it on hydration.
    if (floater) {
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${floater}\n</body>`);
        report.signup_panel.pages += 1;
        report.signup_panel.present = true;
        report.signup_panel.reason = "";
      } else if (!report.signup_panel.present) {
        // A donor page with no </body> to anchor to. Nothing is inserted, and
        // saying so beats a report that counts pages it never touched.
        report.signup_panel.reason = "no_body_close_tag_to_anchor_panel";
      }
    }
    const firstScript = html.search(/<script[^>]+src=/i);
    if (firstScript > -1) html = html.slice(0, firstScript) + island + "\n" + html.slice(firstScript);
    else html = html.replace(/<\/head>/i, `${island}\n</head>`);

    // Content block goes before the donor's footer when there is one, else
    // before </body>. Inserting inside <main> risks breaking donor layout
    // grids; a sibling before the footer is safe on every template.
    //
    // COMPILED-SPA DONORS (2026-07-29): a Vite/React donor's index.html is just
    // `<div id="root"></div>` — there is no static <footer>, so the fallback
    // path put the whole authority block AFTER the mounted app, i.e. BELOW the
    // rendered footer and its copyright line. Verified on
    // wss-test-kingdom-plumbing-las-vegas: footer at y=10103, content at
    // y=10523. Four sections of services/about/coverage/FAQ under the
    // copyright is precisely the "reads as a bolt-on" failure this module
    // exists to avoid. So the fallback also ships RELOCATE_JS, which moves the
    // block to just before the real footer once the app has mounted (and again
    // if a route change re-creates it). No-op on static donors.
    if (block && rel === "index.html") {
      const footerIdx = html.search(/<footer[\s>]/i);
      // PRERENDERED SPA (2026-07-31): roofing-riseabove ships a PRERENDERED
      // #root — the footer is present in the static HTML, so the branch below
      // inserted our block INSIDE the tree React is about to hydrate. React
      // found markup it did not produce, threw #418, threw the server DOM away
      // and re-rendered from its own tree — deleting the whole authority block
      // from the rendered page. checks.content still said "injected, 3
      // sections" because it reads the FILES. Proven on
      // wss-test-gold-roofing-s5: raw HTML had 3 wss-c sections, the rendered
      // DOM had 0 and pageerror carried React #418.
      //
      // So a static footer only earns the static insert when it is NOT inside
      // a hydration root. Otherwise the block ships before </body> — outside
      // the root, present with JS disabled — and RELOCATE_JS moves it in front
      // of the real footer once the app has mounted.
      // roofing-riseabove has NO #root div at all: TanStack Start streams its
      // SSR output straight into <body> (marked by the React suspense comment
      // and the $_TSR bootstrap), so the hydration container IS the body and
      // there is nowhere inside it that survives. Detect the SSR markers, not
      // just a mount div.
      const rootTag = /<div[^>]+id=["'](?:root|app|__next)["'][^>]*>/i.exec(html);
      const nonEmptyRoot = !!rootTag
        && !new RegExp(`${rootTag[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</div>`, "i").test(html);
      const ssrMarker = /<!--\$-->|\$_TSR|__NEXT_DATA__|data-reactroot|self\.__next_f/.test(html);
      const prerenderedApp = nonEmptyRoot || ssrMarker;
      if (footerIdx > -1 && !prerenderedApp) {
        // buildContentHtml() ships the wrapper display:none because on a donor
        // that RELOCATES the block, an unhidden block paints at y=0 and then
        // collapses (a 1.000 CLS shift). Nothing relocates here — the block is
        // written straight into its final position — and only RELOCATE_JS ever
        // un-hides it, so on this path the hidden style is permanent. Proven on
        // wss-test-flint-plumbing-s5: .wss-content computed display:none, all
        // three sections height 0, while checks.content said "injected: 3".
        // Visible content is the whole point; strip the hide on this path.
        const visible = block.replace('<div class="wss-content" data-wss-content="v1" style="display:none">', '<div class="wss-content" data-wss-content="v1">');
        html = html.slice(0, footerIdx) + visible + "\n" + html.slice(footerIdx);
        report.placement = "before_static_footer";
        report.hidden_until_placed = false;
      } else {
        // Defer the map iframe on THIS path only: the block is about to be
        // moved, and a moved iframe reloads (net::ERR_ABORTED on the request
        // already in flight). RELOCATE_JS promotes data-src -> src once the
        // block has landed. The static-footer path above never moves anything,
        // so it keeps a plain no-JS-required src.
        const deferred = block.replace(/<iframe src="/g, '<iframe data-src="');
        html = html.replace(/<\/body>/i, `${deferred}\n${relocateJs(prerenderedApp)}\n</body>`);
        report.placement = "spa_relocated_before_footer";
        report.map_src_deferred = deferred !== block;
        report.prerendered_app = prerenderedApp;
      }
      report.injected_into.push(rel);
    }
    // Lead capture goes on EVERY page, not just index: donors put a quote form
    // in the footer, so the form on /about is the same form and loses leads the
    // same way.
    if (leadCapture) {
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${leadCapture}\n</body>`);
        report.lead_capture.pages += 1;
        report.lead_capture.present = true;
      } else if (!report.lead_capture.present) {
        report.lead_capture.reason = "no_body_close_tag_to_anchor_capture";
      }
    }
    // Sticky mobile CTA bar on every page (donors put contact CTAs in the
    // footer, so /about needs the same persistent bar the home page has).
    if (callBar) {
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${callBar}\n</body>`);
        report.call_bar.pages += 1;
        report.call_bar.present = true;
      } else if (!report.call_bar.present) {
        report.call_bar.reason = "no_body_close_tag_to_anchor_call_bar";
      }
    }
    // Schema graph on every page (replacing any donor graph is not needed —
    // multiple ld+json blocks are legal and additive).
    html = html.replace(/<\/body>/i, `${ldTag}\n</body>`);
    out[rel] = Buffer.from(html, "utf8");
  }

  // llms.txt — the AI-crawler summary. Written fresh from verified facts.
  // "Serves" and "is located at" are different sentences; an answer engine that
  // conflates them tells a searcher this business is in the wrong town.
  const serviceAreas = verifiedServiceAreas(facts, content.areas);
  const market = serviceAreas[0] || "";
  const napMarketTxt = [facts.city, facts.state].filter(Boolean).join(", ");
  const llms = [
    `# ${facts.business_name}`,
    "",
    market ? `> ${facts.industry} serving ${market}.` : `> ${facts.industry} business located in ${napMarketTxt}.`,
    "",
    `- Business: ${facts.business_name}`,
    `- Trade: ${facts.industry}`,
    market ? `- Serves: ${market}` : "",
    napMarketTxt ? `- Located in: ${napMarketTxt}` : "",
    facts.address ? `- Address: ${facts.address}` : "",
    facts.phone ? `- Phone: ${facts.phone}` : "",
    // Never publish a scraper-artifact address as the client's contact.
    facts.email && !isScraperArtifactEmail(facts.email) ? `- Email: ${facts.email}` : "",
    facts.license ? `- License: ${facts.license}` : "",
    facts.rating != null && facts.review_count != null ? `- Rating: ${facts.rating} from ${facts.review_count} reviews` : "",
    `- Website: ${siteUrl}`,
    "",
    (content.services || []).length ? "## Services" : "",
    ...(content.services || []).slice(0, 24).map((s) => `- ${clean(typeof s === "string" ? s : (s.name || s.title))}`),
    "",
    // THE SAME BUILDER EVERYWHERE ELSE. This section read `content.areas` raw,
    // so the AI-crawler summary reprinted exactly what verifiedServiceAreas
    // exists to repair ("FL Marco Island, FL Estero, …", live 2026-09-02).
    serviceAreas.length ? "## Service area" : "",
    ...serviceAreas.slice(0, 18).map((a) => `- ${a}`),
    "",
    renderFaqs.length ? "## Questions and answers" : "",
    ...renderFaqs.slice(0, 20).flatMap((f) => [`### ${f.q}`, f.a, ""]),
  ].filter((l) => l !== "").join("\n") + "\n";
  out["llms.txt"] = Buffer.from(llms, "utf8");

  // sitemap.xml — the home page plus every authority page that actually
  // shipped. Hash fragments are not URLs; listing them (and omitting the
  // real pages) is why the pages read as orphans to a crawler.
  const authorityUrls = Object.keys(out)
    .filter((f) => /^(about|service-areas|faq|team)\.html$/.test(f))
    .map((f) => siteUrl + f.replace(/\.html$/, ""));
  const sitemapUrls = [siteUrl, ...authorityUrls];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
    .map((u, i) => `  <url><loc>${u}</loc><changefreq>monthly</changefreq><priority>${i === 0 ? "1.0" : "0.8"}</priority></url>`)
    .join("\n")}\n</urlset>\n`;
  out["sitemap.xml"] = Buffer.from(sitemap, "utf8");

  out["404.html"] = notFoundPage({ facts, phoneDigits });

  out["robots.txt"] = Buffer.from(
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`,
    "utf8",
  );

  // Run last so every HTML page that exists after the full pass — including
  // generated authority/404 pages — receives the same relay widget.
  const chat = injectChatWidget({ files: out, facts, slug, brand });
  report.chat_widget = chat.report;
  // And the chat handoff (feature 11) lands after the widget, so its gates can
  // read the widget's own report: flag on + widget present + business phone +
  // a resolved Riley line, or the affordance is honestly absent.
  const handoff = injectChatHandoff({ files: chat.files, facts, signup, flags: railFlags });
  report.chat_handoff = handoff.report;
  return { files: handoff.files, report };
}

module.exports = { inject, injectHeroPrerender, injectChatWidget, injectChatHandoff, injectHead, applyLegalHygiene, noindexHtml, buildAttributionFooter, rewriteOriginMedia, buildContentHtml, buildJsonLd, buildSocialBar, buildTeamBand, buildCallBar, buildChatHandoff, contactRailFlags, chatHandoffTelHref, pickIdentityPhoto, identityBandSubject, normalizeHours, schemaTime, notFoundPage, seoTitle, seoDescription, canonicalPathFor, withUsableServices, orderReviewsForDisplay, verifiedServiceAreas, cleanFaqAnswer, sanitizedFaqs, sanitizedAbout, stripMastheadDecorArtifacts, controlA11yPatchScript, prerenderServiceSelectOptions, schemaTelephone, titleCaseShoutedTokens, trimTrailingPeriod, buildTrustBadges, buildFinancingSection, CONTENT_CSS };
