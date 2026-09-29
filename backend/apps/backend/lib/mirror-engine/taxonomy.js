"use strict";

/**
 * lib/mirror-engine/taxonomy.js — the donor's SERVICE TAXONOMY, whole.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * Owner's video report (2026-09-02), in his own words:
 *
 *   "Preserve donor-specific services and naming. Avoid collapsing concrete
 *    specialties into generic 'services' cards if the donor has a meaningful
 *    taxonomy."
 *   "Donor pages surface customer reviews and project evidence prominently.
 *    WSS should not demote genuine proof below generic marketing copy."
 *
 * Until now the pipeline read services for ONE purpose — a flat card list —
 * and every reader trimmed what it did not need. verified-facts harvests with
 * `max: 12` and keeps `{ name }` only: the CATEGORY a service sat under
 * ("Residential Fencing"), the DESCRIPTION the donor wrote beside it, the
 * PRICE the donor declared, and every service past the twelfth were all
 * dropped at the harvest door. A donor listing seventeen concrete specialties
 * rendered as a generic six-card grid with the closest-match labels, and the
 * words that made the services SPECIFIC — "stamped", "sealed", "ornamental",
 * "high-security" — never reached the page.
 *
 * This module is the extraction half of the fix: it reads the SAME bytes the
 * harvest already fetched and returns the taxonomy AS THE DONOR STRUCTURED IT:
 *
 *   services[]   — every distinct service, its EXACT name, its source rank,
 *                  its category, its own description, its pricing hint
 *   categories[] — the donor's own grouping ("Residential Fencing" with its
 *                  member services), from nested schema.org OfferCatalogs and
 *                  from directory-shaped navigation
 *   count        — how many distinct services the donor actually lists
 *                  (pre-cap: a 17-service donor counts 17 even when the
 *                  render door caps at 24)
 *   proof        — the donor's own declared proof signals (aggregateRating,
 *                  a star badge in the header, credentials, project photos)
 *                  so the render side can give them the prominence the
 *                  donor's own site gives them
 *
 * THREE SOURCES, SAME RANKS AS service-harvest.js
 * ---------------------------------------------------------------------------
 *   schema_offer  — schema.org hasOfferCatalog / makesOffer / Service nodes,
 *                   read WITH their structure: a nested OfferCatalog is the
 *                   donor's own category, an Offer's itemOffered carries the
 *                   name AND the description AND the price
 *   page_heading  — the headings inside the page's services region, each with
 *                   the paragraph the donor put under it as its description
 *   nav_anchor    — same-origin links off non-service paths; a directory a
 *                   page whose path is a bare first segment with 2+ siblings
 *                   beneath it is the donor's own category page, not a service
 *
 * TRUTH LAW (unchanged). Nothing here composes, expands, translates or infers
 * a service name, description, price or credential. Every string returned is
 * a contiguous run of characters the donor published on their own site, with
 * markup and HTML entities resolved and decorative glyphs trimmed. Where
 * nothing qualifies the answer is an empty list — never a generated one.
 *
 * NO CYCLE. Leaf modules only at require time. verified-facts' nav gates
 * (isNonServicePath / isHubLabel / stripTrailingLocality) are required LAZILY
 * inside the nav door — the same lazy pattern verified-facts itself uses for
 * place-names — so this file never loads the resolver graph at startup and no
 * require edge can close a loop.
 */

const { decodeEntitiesOnce } = require("./html-entities");
const { carriesTemplateToken } = require("./tokens");
const { articleHeadlineReason } = require("./service-names");
// servicesRegion (the bounded "where does the services section live" finder)
// is the same one the harvest reads — one definition of the region, two
// consumers, so a heading the harvest refuses is a heading this refuses too.
const { servicesRegion, serviceCandidateReason } = require("./service-harvest");

const fold = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const stripTags = (v) => String(v == null ? "" : v).replace(/<[^>]+>/g, " ");

/** Same ranks as service-harvest.js — a declared catalogue outranks a heading
 *  outranks a menu label, so a duplicate keeps the strongest source's data. */
const SOURCE_RANK = Object.freeze({ schema_offer: 0, page_heading: 1, nav_anchor: 2 });

/** The extraction cap. Deliberately far above the render cap (24): count must
 *  measure what the donor ACTUALLY lists, or the density guard would compare
 *  the render against an already-truncated yardstick. */
const MAX_EXTRACTED = 48;

/** How long a card description may run before it is capped at a prose
 *  boundary. The donor's own words, trimmed to fit a card — never padded. */
const MAX_DESCRIPTION = 280;

const capAtSentence = (text, max) => {
  const v = fold(text);
  if (v.length <= max) return v;
  const cut = v.slice(0, max + 1);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop >= 60) return cut.slice(0, stop + 1).trim();
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, max)).trim();
};

function typesOf(node) {
  const t = node && node["@type"];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x) => String(x).toLowerCase());
}

// ---------------------------------------------------------------------------
// SOURCE A — the declared offer catalogue, WITH its structure
// ---------------------------------------------------------------------------

/**
 * Walk the donor's declared offers and collect LEAF services plus the
 * category each sat under. Every nesting the wild serves is walked, depth
 * limited because a malformed graph can be self-referential:
 *   Organization.hasOfferCatalog.itemListElement[] -> OfferCatalog (category)
 *   OfferCatalog.itemListElement[]                 -> Offer.itemOffered.Service
 *   Organization.makesOffer[]                      -> Offer.itemOffered
 *   a bare Service node with name / serviceType
 */
function catalogWalk(node, out, category, depth) {
  if (!node || typeof node !== "object" || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) catalogWalk(item, out, category, depth + 1);
    return;
  }
  const types = typesOf(node);
  if (types.some((t) => t === "offercatalog")) {
    // A nested OfferCatalog IS the donor's own grouping. Its name becomes the
    // category of everything beneath it ("Residential Fencing" -> "Vinyl
    // Fence"), and the catalogue itself is recorded as a category group.
    const name = fold(decodeEntitiesOnce(String(node.name == null ? "" : node.name)));
    if (name) out.categories.push({ name, source: "schema_offer", path: "" });
    for (const key of ["itemListElement", "hasOfferCatalog"]) {
      if (node[key]) catalogWalk(node[key], out, name || category, depth + 1);
    }
    return;
  }
  if (types.some((t) => t === "offer")) {
    const item = node.itemOffered && typeof node.itemOffered === "object" ? node.itemOffered : null;
    const leaf = item || node;
    const name = fold(decodeEntitiesOnce(String(
      (item && (item.name || item.serviceType)) || node.name || node.serviceType || "",
    )));
    if (name) {
      out.leaves.push({
        name,
        source: "schema_offer",
        category,
        description: fold(decodeEntitiesOnce(stripTags(String(
          (item && (item.description || node.description)) || "",
        )))),
        pricing: pricingOf(node, item),
        path: fold(String(((item && item.url) || node.url || ""))),
        sub_services: [],
      });
    }
    if (item) catalogWalk(item, out, category, depth + 1);
    return;
  }
  if (types.some((t) => /(?:^|\W)(?:service|product)$/.test(t) || t === "service" || t === "product")) {
    // A Service node that carries its own hasOfferCatalog is the donor's
    // UMBRELLA node (Hurricane's "#company-services", named "Hurricane Fence
    // Services", with the whole catalogue beneath it). It is a container, not
    // a card: walked into, never listed.
    const isContainer = Boolean(node.hasOfferCatalog || node.makesOffer);
    if (!isContainer) {
      for (const key of ["name", "serviceType"]) {
        const v = fold(decodeEntitiesOnce(String(node[key] == null ? "" : node[key])));
        if (v) {
          out.leaves.push({
            name: v,
            source: "schema_offer",
            category,
            description: fold(decodeEntitiesOnce(stripTags(String(node.description || "")))),
            pricing: pricingOf(node, null),
            path: fold(String(node.url || "")),
            sub_services: [],
          });
        }
      }
    }
  }
  for (const key of ["hasOfferCatalog", "makesOffer", "itemListElement", "itemOffered", "offers"]) {
    if (node[key]) catalogWalk(node[key], out, category, depth + 1);
  }
}

/**
 * The donor's declared price for one offer, verbatim where it is a string.
 * Only STRUCTURED price fields are read (Offer.price / priceSpecification) —
 * a number in a paragraph is prose, and prose is not a pricing hint.
 */
function pricingOf(offer, item) {
  const holders = [offer, item];
  for (const h of holders) {
    if (!h || typeof h !== "object") continue;
    const direct = h.price != null ? h.price : (h.priceSpecification && (h.priceSpecification.price != null
      ? h.priceSpecification.price
      : (h.priceSpecification.minPrice != null ? h.priceSpecification.minPrice : null)));
    if (direct != null && String(direct).trim()) {
      const currency = fold(String((h.priceSpecification && h.priceSpecification.priceCurrency) || h.priceCurrency || "USD"));
      const n = Number(direct);
      // "25" with a currency reads as money; a free-form string rides as-is.
      return Number.isFinite(n) ? `${currency === "USD" ? "$" : `${currency} `}${n}` : fold(String(direct));
    }
  }
  return "";
}

function servicesFromCatalog(nodes = []) {
  const out = { leaves: [], categories: [] };
  for (const node of Array.isArray(nodes) ? nodes : []) catalogWalk(node, out, "", 0);
  return out;
}

// ---------------------------------------------------------------------------
// SOURCE B — the services region's headings, each with the copy under it
// ---------------------------------------------------------------------------

// The section's OWN title ("Our Services", "Services We Provide") is not its
// first card. Mirrors service-harvest's SECTION_TITLE (not exported there);
// kept in sync so both consumers refuse the same line for the same reason.
const SECTION_TITLE_RE = /^(?:[\w'&,.\- ]{0,40}\b)??(?:our|the)?\s*(?:services|procedures|treatments|service\s+offerings|what\s+we\s+do|what\s+we\s+offer|services\s+we\s+(?:offer|provide)|our\s+expertise|areas\s+of\s+expertise)\s*\??$/i;

/**
 * Every h2-h4 in the services region, with the FIRST paragraph the donor put
 * between it and the next heading as that service's own description. The
 * region finder is service-harvest's; the label gates are too, so a heading
 * the flat harvest refuses never becomes a taxonomy card either.
 */
function servicesFromHeadingsWithCopy(html) {
  const region = servicesRegion(html);
  if (!region) return [];
  const out = [];
  const headingRe = /<h([2-4])\b[^>]*>([\s\S]{0,200}?)<\/h\1>/gi;
  const heads = [...region.matchAll(headingRe)].map((m) => ({ at: m.index, end: m.index + m[0].length, text: decodeEntitiesOnce(fold(stripTags(m[2]))) }));
  for (let i = 0; i < heads.length; i += 1) {
    const text = heads[i].text;
    if (!text) continue;
    if (SECTION_TITLE_RE.test(text)) continue; // the section's own title is not a card
    if (serviceCandidateReason(text)) continue; // refuses listicles, junk, over-long labels
    const from = heads[i].end; // past the closing </hN>, where the donor's own body copy begins
    const to = i + 1 < heads.length ? heads[i + 1].at : region.length;
    const body = region.slice(from, to);
    const para = body.match(/<p\b[^>]*>([\s\S]{0,600}?)<\/p>/i);
    out.push({
      name: text,
      source: "page_heading",
      category: "",
      description: para ? capAtSentence(decodeEntitiesOnce(stripTags(para[1])), MAX_DESCRIPTION) : "",
      pricing: "",
      path: "",
      sub_services: [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// SOURCE C — navigation, read as the donor's own directory
// ---------------------------------------------------------------------------

/** Nav FURNITURE, not services — the footer links every business site ships.
 *  The path blocklist cannot refuse them (/make-a-payment/, /referral-program/)
 *  because nobody names those directories in advance; the LABEL names them. */
const NAV_FURNITURE_RE = /^(?:make a payment|pay (?:your )?(?:bill|invoice|balance)|referral program|credentials|our credentials|careers|employment|apply online|join our team|meet the team|our team|our staff|about(?: us| hurricane fence)?|company background|our story|our history|reviews?|testimonials?|read (?:our )?reviews|photo gallery|gallery|portfolio|coupons?|specials?|current specials|deals?|shop|store|login|sign in|my account|client portal|financing|apply for financing|blog|news|articles|resources|downloads|brochures?|faq|faqs|help|support|contact(?: us)?|get (?:a )?quote|free (?:quote|estimate)|request (?:a )?quote|book (?:now|online)|schedule (?:now|service)|call (?:now|us|today)|email us|send us a message|directions|service areas?|areas we serve|locations?|find (?:us|a location)|home|menu|next|previous|back to top|share|print)$/i;

/** A LOCATION LIST, not a service — "Northern Virginia / DC / MD" is three
 *  places the donor serves, joined by the separators a place list uses. A
 *  label whose slash/comma segments include 2+ bare state codes (or DC) is
 *  where the donor works, not what the donor sells. */
const STATE_CODE_SEGMENT = /^(?:A[KLRZ]|C[AOT]|D[EC]|F[LM]|G[AU]|HI|I[DLN]|K[SY]|LA|M[EDAINOT]|N[EVHJMYCD]|O[HKR]|P[AWR]|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]|DC)$/i;
function isPlaceListLabel(label) {
  const segments = String(label || "").split(/\s*[/,&]\s*/).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return false;
  const codes = segments.filter((s) => STATE_CODE_SEGMENT.test(s));
  return codes.length >= 2;
}

/**
 * Same-origin anchors off non-service paths, with the SAME label gates the
 * verified harvest applies (length band, template tokens, article headlines,
 * hub labels, the business's own name). Two things this door does that the
 * flat harvest does not:
 *
 *   · CATEGORY PAGES STAY CATEGORIES. An anchor whose href is a bare FIRST
 *     path segment ("/residential/") while 2+ sibling anchors live beneath it
 *     ("/residential/wood-fence/", "/residential/vinyl-fence/") is the
 *     donor's own directory page — Hurricane Fence's "Residential" and
 *     "Commercial". It becomes the CATEGORY of its children, not a card.
 *   · THE PATH RIDES WITH THE NAME, so enrichment can tell "Vinyl Fence" the
 *     schema leaf from "Vinyl Fence" the nav label apart by provenance rank.
 */
function servicesFromNav(html, { origin = "", businessName = "", city = "", state = "" } = {}) {
  // Lazy on purpose — see the NO CYCLE note in the header.
  const { isNonServicePath, isHubLabel, stripTrailingLocality } = require("./verified-facts");
  const base = (() => { try { return new URL(origin); } catch { return null; } })();
  const found = [];
  const seen = new Set();
  const anchorRe = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]{0,600}?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(String(html || "")))) {
    const attrs = m[1];
    const href = m[2];
    if (!href || /^(?:mailto:|tel:|javascript:|#)/i.test(href)) continue;
    // Same-origin judged exactly as the harvest judges it: absolute links on
    // the origin the bytes came from, and every relative link, are the
    // donor's own; anything else is somebody else's.
    let path = "";
    try {
      const u = new URL(href, base || "https://placeholder.invalid/");
      if (base && u.origin !== base.origin) continue;
      path = u.pathname.replace(/\/+$/, "") || "/";
    } catch { continue; }
    if (path === "/" || isNonServicePath(path)) continue;
    const label = stripTrailingLocality(decodeEntitiesOnce(stripTags(m[3])));
    if (!label || label.length < 3 || label.length > 60) continue;
    if (carriesTemplateToken(label)) continue;
    if (/^(read more|learn more|click here|more|home|next|previous|\d+)$/i.test(label)) continue;
    if (NAV_FURNITURE_RE.test(label)) continue;
    if (isPlaceListLabel(label)) continue;
    if (articleHeadlineReason(label)) continue;
    if (businessName && label.toLowerCase() === fold(businessName).toLowerCase()) continue;
    if (isHubLabel(label, city, state)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ name: label, source: "nav_anchor", path });
  }
  // Which first path segments are FAMILIES (2+ children beneath them). Those
  // are the donor's directory pages: categories, not services.
  const firstSegment = (p) => String(p || "").split("/").filter(Boolean)[0] || "";
  const family = new Map();
  for (const item of found) {
    const seg = firstSegment(item.path);
    if (!seg) continue;
    family.set(seg, (family.get(seg) || 0) + 1);
  }
  const categories = [];
  const leaves = [];
  for (const item of found) {
    const seg = firstSegment(item.path);
    const isDirectoryPage = seg && item.path === `/${seg}` && (family.get(seg) || 0) >= 2;
    if (isDirectoryPage) {
      categories.push({ name: item.name, source: "nav_anchor", path: item.path });
      continue;
    }
    leaves.push({
      name: item.name,
      source: "nav_anchor",
      category: "",
      description: "",
      pricing: "",
      path: item.path,
      sub_services: [],
    });
  }
  // A leaf under a 2+-sibling directory inherits that directory's own anchor
  // LABEL as its category, VERBATIM ("/residential/wood-fence/" reads under
  // whatever the donor's own link to /residential/ said). No suffixing, no
  // composing: a category the donor did not print is not a category.
  const dirLabel = new Map();
  for (const c of categories) {
    const seg = firstSegment(c.path);
    if (seg && !dirLabel.has(seg)) dirLabel.set(seg, c.name);
  }
  for (const leaf of leaves) {
    const seg = firstSegment(leaf.path);
    if (seg && dirLabel.has(seg) && !leaf.category) leaf.category = dirLabel.get(seg);
  }
  return { leaves, categories };
}

// ---------------------------------------------------------------------------
// THE MERGE — one taxonomy, strongest source per name, structure preserved
// ---------------------------------------------------------------------------

function nameKey(name, normalize) {
  const norm = typeof normalize === "function" ? normalize : ((v) => v);
  return fold(norm(fold(name))).toLowerCase();
}

/**
 * Merge the three sources into one published taxonomy. A duplicate name keeps
 * the STRONGEST source it was ever seen under, and weaker sightings may only
 * FILL fields the stronger one lacks (a schema leaf with no description can
 * take one from a page heading; never the reverse).
 */
function mergeTaxonomy(pools, { normalize }) {
  const byKey = new Map();
  const order = [];
  const counts = {};
  const absorb = (entry) => {
    const key = nameKey(entry.name, normalize);
    if (!key) return;
    const held = byKey.get(key);
    if (!held) {
      const record = { ...entry, name: fold(entry.name) };
      byKey.set(key, record);
      order.push(key);
      counts[entry.source] = (counts[entry.source] || 0) + 1;
      return;
    }
    if ((SOURCE_RANK[entry.source] ?? 99) < (SOURCE_RANK[held.source] ?? 99)) {
      byKey.set(key, {
        ...entry,
        name: fold(entry.name),
        description: entry.description || held.description,
        category: entry.category || held.category,
        pricing: entry.pricing || held.pricing,
        path: entry.path || held.path,
      });
      return;
    }
    for (const field of ["description", "category", "pricing", "path"]) {
      if (!held[field] && entry[field]) held[field] = entry[field];
    }
  };
  for (const pool of pools) for (const entry of pool) absorb(entry);
  return { services: order.map((k) => byKey.get(k)), counts };
}

// ---------------------------------------------------------------------------
// PROOF — the donor's own declared evidence, read for its prominence value
// ---------------------------------------------------------------------------

/** The first N bytes of a page, or up to the end of its <header>, whichever
 *  is longer — the region a visitor sees before scrolling. */
const ABOVE_THE_FOLD_BYTES = 24000;
const RATING_WIDGET_RE = /(?:★|☆|star[-_ ]?rating|class=["'][^"']*\b(?:rating|stars|reviews?)\b|out of 5|google reviews)/i;

/**
 * The proof signals the DONOR declares, so the render side can give them the
 * prominence the donor's own site gives them:
 *   rating / review_count — the donor's own schema.org aggregateRating
 *   header_badge          — a star-rating widget inside the top region
 *   certifications        — hasCredential / award strings the donor declared
 *   project_photos        — gallery / project / our-work images on the page
 *
 * TRUTH LAW: nothing is inferred. A missing aggregateRating is null, never a
 * guess; a certification is the donor's own declared string, verbatim.
 */
function extractProofSignals({ html = "", ldNodes = [] } = {}) {
  const text = String(html || "");
  let rating = null;
  let review_count = null;
  const certifications = [];
  const readRating = (node) => {
    const r = Number(node.ratingValue);
    const c = Number(node.reviewCount != null ? node.reviewCount : node.ratingCount);
    if (rating == null && Number.isFinite(r) && r > 0 && r <= 5) rating = r;
    if (review_count == null && Number.isFinite(c) && c > 0) review_count = c;
  };
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    if (typesOf(node).some((t) => t === "aggregaterating")) readRating(node);
    // aggregateRating also rides as a PROPERTY of the LocalBusiness itself
    // (Hurricane's own shape: node.aggregateRating = { ratingValue: "4.8",
    // reviewCount: "605" }), not only as a standalone graph node.
    if (node.aggregateRating && typeof node.aggregateRating === "object") readRating(node.aggregateRating);
    for (const key of ["hasCredential", "award"]) {
      const v = node[key];
      for (const raw of (Array.isArray(v) ? v : (v == null ? [] : [v]))) {
        // A structured credential contributes its NAME; an object with no
        // name contributes nothing — never a stringified "[object Object]".
        const s = typeof raw === "object" && raw ? fold(decodeEntitiesOnce(stripTags(String(raw.name == null ? "" : raw.name)))) : (typeof raw === "string" ? fold(decodeEntitiesOnce(stripTags(raw))) : "");
        if (s && s.length <= 120 && !certifications.includes(s)) certifications.push(s);
      }
    }
    for (const key of ["@graph", "hasOfferCatalog", "makesOffer", "itemListElement", "itemOffered", "reviews", "review", "subjectOf", "mainEntity"]) {
      if (node[key]) walk(node[key], depth + 1);
    }
  };
  for (const node of Array.isArray(ldNodes) ? ldNodes : []) walk(node, 0);

  const headerEnd = (() => {
    const close = text.search(/<\/header\s*>/i);
    const main = text.search(/<main\b/i);
    const stops = [close + 1, main + 1, ABOVE_THE_FOLD_BYTES].filter((v) => v > 0 && v <= text.length);
    return stops.length ? Math.max(...stops) : Math.min(text.length, ABOVE_THE_FOLD_BYTES);
  })();
  const header_badge = RATING_WIDGET_RE.test(text.slice(0, headerEnd));
  const project_photos = (text.match(/<img\b[^>]*(?:class=["'][^"']*\b(?:gallery|project|our[-_ ]?work|portfolio|before[-_ ]?after)\b|src=["'][^"']*(?:\/gallery\/|\/projects?\/|our-work|before-after))/gi) || []).length;
  return { rating, review_count, header_badge, certifications, project_photos };
}

// ---------------------------------------------------------------------------
// THE ONE CALL
// ---------------------------------------------------------------------------

/**
 * The donor's whole service taxonomy from one page's bytes.
 *
 * `html`     — the donor's homepage bytes (already fetched; no request here)
 * `ldNodes`  — the flattened JSON-LD blocks the caller already parsed
 * `origin`   — the FINAL URL origin the bytes came from (www->apex safe)
 * `normalize`— optional; defaults to verified-facts.stripTrailingLocality so
 *              "Commercial Fencing in Richmond VA" and "Commercial Fencing"
 *              are one service, exactly as the flat harvest folds them
 *
 * Returns { services, count, categories, bySource, proof }. `count` is the
 * DISTINCT service count BEFORE any cap — the number the density guard
 * compares the render against.
 */
function extractServiceTaxonomy({
  html = "",
  ldNodes = [],
  origin = "",
  businessName = "",
  city = "",
  state = "",
  normalize,
  max = MAX_EXTRACTED,
} = {}) {
  const norm = normalize || require("./verified-facts").stripTrailingLocality;
  const catalog = servicesFromCatalog(ldNodes);
  const headings = servicesFromHeadingsWithCopy(html);
  const nav = servicesFromNav(html, { origin, businessName, city, state });
  const merged = mergeTaxonomy(
    [catalog.leaves, headings, nav.leaves],
    { normalize: norm },
  );
  const services = merged.services.slice(0, Math.max(1, max));
  // Category groups with their member services, donor's names, deduped. Only
  // groupings that actually carry members are reported — a schema container
  // ("Fence Installation Catalog") or a directory anchor whose children merged
  // elsewhere is plumbing, not a taxonomy row.
  const seenCat = new Set();
  const categories = [];
  for (const raw of [...catalog.categories, ...nav.categories]) {
    const name = fold(raw.name);
    const key = nameKey(name, norm);
    if (!name || seenCat.has(key)) continue;
    seenCat.add(key);
    const members = services.filter((s) => nameKey(s.category, norm) === key).map((s) => s.name);
    if (!members.length) continue;
    categories.push({ name, source: raw.source, services: members });
  }
  return {
    services,
    count: merged.services.length,
    categories,
    bySource: merged.counts,
    proof: extractProofSignals({ html, ldNodes }),
  };
}

// ---------------------------------------------------------------------------
// THE RENDER-SIDE CONTRACTS
// ---------------------------------------------------------------------------

/**
 * Fill — never overwrite — the description of every rendered service from the
 * donor's own taxonomy entry for that same service. Matching is by folded
 * name, then by containment one way (min 5 chars, word-overlap majority), so
 * "Wood Fence" takes the copy the donor wrote for "Wood Fence" and NOT the
 * copy for "Wood Fencing Panels". Specific terms ("stamped", "sealed",
 * "polished") ride through because the copy IS the donor's.
 */
function enrichServicesFromTaxonomy(services, taxonomy) {
  const list = Array.isArray(services) ? services : [];
  const entries = taxonomy && Array.isArray(taxonomy.services) ? taxonomy.services : [];
  if (!list.length || !entries.length) return services;
  const byKey = new Map();
  for (const entry of entries) {
    const key = nameKey(entry.name, null);
    if (key && !byKey.has(key)) byKey.set(key, entry);
  }
  const wordsOf = (v) => new Set(fold(v).toLowerCase().split(/\s+/).filter(Boolean));
  let changed = false;
  const out = list.map((service) => {
    if (!service || typeof service !== "object") return service;
    const name = fold(service.name || service.title);
    if (!name || fold(service.description || service.text)) return service;
    const key = nameKey(name, null);
    let hit = byKey.get(key) || null;
    // The donor may list the same service twice — "Bollards" as the section it
    // wrote copy under, "Commercial Bollards" as the nav label for the same
    // /commercial/bollards/ page. An exact-name hit with NO description is
    // that second label, so the search continues for a described sibling.
    if (!hit || !fold(hit.description)) {
      // Containment: one name inside the other, a majority of the longer
      // name's words shared, and a 5-char floor on the contained name so short
      // labels cannot snag. This is what lets the card "Commercial Bollards"
      // take the copy the donor wrote for the "Bollards" section, and "Vinyl
      // Fencing" the copy under "Vinyl Fence".
      const w = wordsOf(name);
      let best = null;
      for (const entry of entries) {
        if (!fold(entry.description)) continue;
        const e = wordsOf(entry.name);
        const longer = Math.max(w.size, e.size);
        let shared = 0;
        for (const x of w) if (e.has(x)) shared += 1;
        const a = name.toLowerCase();
        const b = fold(entry.name).toLowerCase();
        if ((a.includes(b) || b.includes(a)) && b.length >= 5 && a.length >= 5 && shared >= Math.ceil(longer / 2)) { best = entry; break; }
      }
      if (best && (!hit || fold(best.description))) hit = best;
    }
    const description = hit ? capAtSentence(hit.description, MAX_DESCRIPTION) : "";
    if (!description) return service;
    changed = true;
    return { ...service, description };
  });
  return changed ? out : services;
}

/**
 * The taxonomy AS a card list, for the density guard: when the harvest
 * supplied NOTHING but the donor's own page lists real services, the donor's
 * list IS first-party content (same truth law the harvest operates under) and
 * the build renders it rather than collapsing to a content-free one-pager.
 * Every name re-passes the same gates the render door applies, so nothing
 * enters a page here that could not have entered by the harvest.
 */
function taxonomyServiceCards(taxonomy, { max = 24 } = {}) {
  const entries = taxonomy && Array.isArray(taxonomy.services) ? taxonomy.services : [];
  const seen = new Set();
  const cards = [];
  for (const entry of entries) {
    const name = fold(entry && entry.name);
    if (!name || carriesTemplateToken(name) || articleHeadlineReason(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ name, description: capAtSentence(entry.description || "", MAX_DESCRIPTION) });
    if (cards.length >= max) break;
  }
  return cards;
}

/** A donor with fewer than this many listed services has no "meaningful
 *  taxonomy" to preserve — a two-service handyman is honestly two cards. */
const DENSE_TAXONOMY_FLOOR = 6;

/** The rendered card count must keep at least this share of the donor's
 *  listed services before the build is called sparse. */
const DENSITY_RATIO_FLOOR = 0.75;

/**
 * THE CONTENT DENSITY GUARD. Compares what the donor's page lists against
 * what the generated page renders and names every way the build went thin:
 *
 *   collapsed  — the donor lists services and the page renders NONE
 *   sparse     — the donor lists a meaningful taxonomy (6+) and the render
 *                keeps under 3/4 of it
 *   copy_thin  — the donor wrote descriptions and over half are missing
 *
 * A verdict, never a mutation: the guard reports, the render door (and the
 * operator reading the build report) decides.
 */
function contentDensityVerdict({ taxonomy, renderedServices } = {}) {
  const donor = taxonomy && Array.isArray(taxonomy.services) ? taxonomy.services : [];
  const donorCount = taxonomy && Number.isFinite(Number(taxonomy.count)) && Number(taxonomy.count) > 0
    ? Number(taxonomy.count)
    : donor.length;
  const rendered = Array.isArray(renderedServices) ? renderedServices : [];
  const donorDescribed = donor.filter((s) => fold(s && s.description)).length;
  const renderedDescribed = rendered.filter((s) => fold(typeof s === "object" ? (s.description || s.text) : "")).length;
  const collapsed = donorCount > 0 && rendered.length === 0;
  const sparse = !collapsed && donorCount >= DENSE_TAXONOMY_FLOOR && rendered.length < Math.ceil(donorCount * DENSITY_RATIO_FLOOR);
  const copy_thin = !collapsed && donorDescribed >= 4 && renderedDescribed < Math.ceil(donorDescribed / 2);
  const verdict = !taxonomy || donorCount === 0
    ? "no_taxonomy"
    : collapsed ? "collapsed" : sparse ? "sparse" : copy_thin ? "copy_thin" : "ok";
  return {
    donor_services: donorCount,
    rendered_cards: rendered.length,
    card_ratio: donorCount ? Number((rendered.length / donorCount).toFixed(2)) : null,
    donor_described: donorDescribed,
    rendered_described: renderedDescribed,
    collapsed,
    sparse,
    copy_thin,
    verdict,
  };
}

module.exports = {
  extractServiceTaxonomy,
  extractProofSignals,
  enrichServicesFromTaxonomy,
  taxonomyServiceCards,
  contentDensityVerdict,
  servicesFromCatalog,
  servicesFromHeadingsWithCopy,
  servicesFromNav,
  SOURCE_RANK,
  MAX_EXTRACTED,
  MAX_DESCRIPTION,
  DENSE_TAXONOMY_FLOOR,
  DENSITY_RATIO_FLOOR,
};
