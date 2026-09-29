"use strict";

/**
 * lib/mirror-engine/service-harvest.js — what the business says it SELLS, read
 * off the page itself rather than off the menu bar.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Until now the mirror engine had exactly one source of services: the anchor
 * text of links in the client's own navigation (verified-facts.js). A menu is a
 * list of PLACES TO CLICK, and the fleet audit of 2026-08-11 measured what that
 * costs — 18 of 100 live mirrors published a navigation item, a button or a
 * membership club in a schema.org `Service` node, and because seoDescription()
 * leads with `services[0]`, eighteen Google snippets opened with one:
 *
 *     "Photo Gallery in Portland, OR. Rated 4.9 from 608 Google reviews."
 *
 * lib/mirror-engine/service-names.js now refuses those labels wherever they
 * appear. But refusing junk only ever SHORTENS a list; it cannot supply the real
 * services the junk was standing in for. That is what this module is for, and it
 * is the owner's instruction in his own words: "real services harvested from the
 * client's own page content, never nav labels."
 *
 * TWO SOURCES, BOTH THE CLIENT'S OWN WORDS, RANKED
 * ---------------------------------------------------------------------------
 *   schema_offer  — schema.org `hasOfferCatalog` / `makesOffer` / `Service`
 *                   nodes. The business (or its CMS) DECLARED these, in
 *                   machine-readable form, as the things it offers. There is no
 *                   stronger first-party evidence on a website, and no guessing
 *                   involved in reading it.
 *   page_heading  — the headings inside the page's own services section, found
 *                   by its heading or its id/class. These are the words the
 *                   business chose to put on the cards a visitor actually reads.
 *
 * A caller merges these AHEAD of the navigation harvest, so nav becomes what it
 * should always have been: the fallback, not the primary.
 *
 * TRUTH LAW. Nothing here composes, expands, translates or infers a service
 * name. Every string returned is a contiguous run of characters the client
 * published on their own site, with markup and HTML entities resolved and
 * decorative glyphs trimmed. Where nothing qualifies, the answer is an empty
 * list — never a generated one.
 *
 * NO CYCLE. This module requires only leaf modules. `stripTrailingLocality`
 * lives in verified-facts.js, which requires this file's callers, so it is
 * passed IN as `normalize` rather than imported — see the `normalize` option.
 */

const { decodeEntitiesOnce } = require("./html-entities");
const { carriesTemplateToken } = require("./tokens");
const { articleHeadlineReason } = require("./service-names");

const fold = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const stripTags = (v) => String(v == null ? "" : v).replace(/<[^>]+>/g, " ");

/**
 * Source precedence. Lower sorts first, and a duplicate name keeps the
 * strongest source it was ever seen under — so a service that appears both in a
 * declared OfferCatalog and in the nav is credited to the catalogue.
 */
const SOURCE_RANK = Object.freeze({ schema_offer: 0, page_heading: 1, nav_anchor: 2, place_category: 3 });

/** A service name is a short noun phrase. These bounds match verified-facts's nav harvest. */
const MIN_LEN = 3;
const MAX_LEN = 60;
const MAX_WORDS = 8;

function typesOf(node) {
  const t = node && node["@type"];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x) => String(x).toLowerCase());
}

/**
 * Every name reachable from a declared offer, however the CMS nested it.
 *
 * Real sites nest this four different ways and all four are in the wild:
 *   Organization.hasOfferCatalog.itemListElement[] -> Offer.itemOffered.name
 *   Organization.hasOfferCatalog.itemListElement[] -> OfferCatalog (nested)
 *   Organization.makesOffer[]                     -> Offer.itemOffered.name
 *   a bare Service node with a name / serviceType
 *
 * Depth-limited, because a malformed graph can be self-referential and a
 * scraper that hangs on one prospect stalls the whole run.
 */
function offerNamesFrom(node, out, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) offerNamesFrom(item, out, depth + 1);
    return;
  }
  const types = typesOf(node);
  if (types.some((t) => /(?:^|\W)(?:service|product)$/.test(t) || t === "service" || t === "product")) {
    for (const key of ["name", "serviceType"]) {
      const v = node[key];
      if (typeof v === "string" && v.trim()) out.push(v);
    }
  }
  for (const key of ["hasOfferCatalog", "makesOffer", "itemListElement", "itemOffered", "offers"]) {
    if (node[key]) offerNamesFrom(node[key], out, depth + 1);
  }
}

/**
 * SOURCE A — the declared offer catalogue.
 *
 * `nodes` is the flattened JSON-LD block list the caller already parsed for the
 * phone, the address and the FAQs. Reading services off it costs nothing.
 */
function servicesFromSchema(nodes = []) {
  const raw = [];
  for (const node of Array.isArray(nodes) ? nodes : []) offerNamesFrom(node, raw, 0);
  return raw.map((v) => decodeEntitiesOnce(fold(v)));
}

/**
 * Where the services section starts.
 *
 * Two independent markers, and whichever appears FIRST in the document wins:
 *   · a heading that says so ("Our Services", "What We Do", "Services We Offer")
 *   · a container whose id or class says so (<section id="services">)
 * Returns -1 when the page has neither, in which case no headings are harvested
 * at all. Guessing at a region we cannot find is exactly how a menu bar became
 * a service list in the first place.
 */
// A short prefix before the keyword is allowed (0-40 chars of plain words):
// "Houston Concrete Company Services We Provide?" defeated the old our|the-only
// form and the whole mine-time harvest saw zero services (measured 2026-08-20).
// "Procedures" and "treatments" joined for the medical verticals — "Cosmetic
// Procedures" is a services heading in every sense that matters. Every heading
// the wider region offers is still individually gated downstream.
const SERVICES_HEADING = /<h[1-6][^>]*>\s*(?:<[^>]+>\s*)*(?:[\w'&,.\- ]{0,40}\b)?(?:services|procedures|treatments|service\s+offerings|what\s+we\s+do|what\s+we\s+offer|services\s+we\s+(?:offer|provide)|our\s+expertise|areas\s+of\s+expertise)\b/i;
const SERVICES_CONTAINER = /<(?:section|div|ul|nav)[^>]+(?:id|class)=["'][^"']*\bservices?(?:-|_|\s|["'])/i;

/** How far past the marker a services section plausibly runs. 12KB was less
 *  than one Elementor widget — Keane's real service headings sat 35KB before a
 *  container that opened onto nothing but a CTA (measured 2026-08-20). Still a
 *  bounded read of bytes already fetched. */
const REGION_BYTES = 40000;

function servicesRegion(html) {
  const text = String(html || "");
  const a = SERVICES_HEADING.exec(text);
  const b = SERVICES_CONTAINER.exec(text);
  const starts = [a ? a.index : -1, b ? b.index : -1].filter((i) => i >= 0);
  if (!starts.length) return "";
  const start = Math.min(...starts);
  // Start AFTER the marker element so the section's own title ("Our Services")
  // is not harvested as its first card.
  const from = text.indexOf(">", start);
  return text.slice(from > start ? from + 1 : start, start + REGION_BYTES);
}

/**
 * SOURCE B — the headings inside that region.
 *
 * h2/h3/h4 only. h1 is the page title and h5/h6 are captions and disclaimers on
 * every template this engine has met.
 */
// Kept in sync with SERVICES_HEADING: the same short prefix and the same two
// medical nouns, so a region opened by "Houston Concrete Company Services We
// Provide?" does not then harvest that very line as its first card.
const SECTION_TITLE = /^(?:[\w'&,.\- ]{0,40}\b)??(?:our|the)?\s*(?:services|procedures|treatments|service\s+offerings|what\s+we\s+do|what\s+we\s+offer|services\s+we\s+(?:offer|provide)|our\s+expertise|areas\s+of\s+expertise)\s*\??$/i;

function servicesFromHeadings(html) {
  const region = servicesRegion(html);
  if (!region) return [];
  const out = [];
  for (const m of region.matchAll(/<h([2-4])\b[^>]*>([\s\S]{0,200}?)<\/h\1>/gi)) {
    const text = decodeEntitiesOnce(fold(stripTags(m[2])));
    // THE SECTION'S OWN TITLE IS NOT ITS FIRST CARD. When the region was found
    // by a container id (<section id="services-grid">) rather than by a
    // heading, the "Our Services" heading sits INSIDE the region and would be
    // harvested. service-names.js refuses it too, but a harvest that hands out
    // a label it knows is a title is a harvest that will hand out the next one.
    if (!text || SECTION_TITLE.test(text)) continue;
    out.push(text);
  }
  return out;
}

/**
 * THE ONE GATE EVERY CANDIDATE PASSES, whatever supplied it.
 *
 * Returns the refusal reason, or "" when the label may be published. The
 * article/nav/CTA judgement is service-names.js's, asked here so a caller cannot
 * add a source that skips it.
 */
function serviceCandidateReason(value) {
  const raw = fold(value);
  if (!raw) return "empty";
  if (raw.length < MIN_LEN) return "too_short";
  if (raw.length > MAX_LEN) return "too_long";
  if (raw.split(/\s+/).filter(Boolean).length > MAX_WORDS) return "too_many_words";
  if (carriesTemplateToken(raw)) return "template_token";
  return articleHeadlineReason(raw);
}

/**
 * Merge candidate lists from any number of sources into one published list.
 *
 * `lists` is `[{ source, names }]`. Names are normalised (the caller supplies
 * `stripTrailingLocality`), gated, deduped case-insensitively keeping the
 * strongest source, and finally ordered by source rank — so a declared
 * OfferCatalog leads the cards and a nav label can only ever fill the tail.
 *
 * Returns `{ services, dropped, counts }`. `dropped` names every casualty with
 * its reason, because a shortened list that cannot explain itself is how this
 * defect survived three fixes.
 */
function mergeServiceSources(lists = [], { normalize, max = 12 } = {}) {
  const norm = typeof normalize === "function" ? normalize : ((v) => v);
  const seen = new Map();
  const dropped = [];
  const counts = {};
  for (const entry of Array.isArray(lists) ? lists : []) {
    const source = String((entry && entry.source) || "unknown");
    const rank = SOURCE_RANK[source] === undefined ? 99 : SOURCE_RANK[source];
    for (const candidate of Array.isArray(entry && entry.names) ? entry.names : []) {
      const name = fold(norm(fold(candidate)));
      const reason = serviceCandidateReason(name);
      if (reason) {
        if (fold(candidate)) dropped.push({ value: fold(candidate), reason, source });
        continue;
      }
      const key = name.toLowerCase();
      const held = seen.get(key);
      if (held && held.rank <= rank) continue;
      seen.set(key, { name, source, rank, order: held ? held.order : seen.size });
      counts[source] = (counts[source] || 0) + (held ? 0 : 1);
    }
  }
  const services = [...seen.values()]
    .sort((a, b) => (a.rank - b.rank) || (a.order - b.order))
    .slice(0, max)
    .map((v) => ({ name: v.name, source: v.source }));
  return { services, dropped, counts };
}

/**
 * The whole content harvest for one page, in one call.
 *
 * `html`  — the client's own homepage bytes (already fetched by the caller; this
 *           module never makes a request).
 * `ldNodes` — the flattened JSON-LD blocks the caller already parsed.
 * `normalize` — pass verified-facts.stripTrailingLocality.
 *
 * Nav anchors are NOT harvested here. verified-facts.js owns that path, with its
 * own path blocklist and hub-label rules, and it hands its result to
 * mergeServiceSources as the lowest-ranked source.
 */
function harvestPageServices({ html = "", ldNodes = [], normalize, max = 12 } = {}) {
  return mergeServiceSources(
    [
      { source: "schema_offer", names: servicesFromSchema(ldNodes) },
      { source: "page_heading", names: servicesFromHeadings(html) },
    ],
    { normalize, max },
  );
}

module.exports = {
  harvestPageServices,
  mergeServiceSources,
  serviceCandidateReason,
  servicesFromSchema,
  servicesFromHeadings,
  servicesRegion,
  SOURCE_RANK,
  MAX_WORDS,
};
