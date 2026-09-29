"use strict";

// lib/section-reorder.js — MOVING A WHOLE SECTION, made real.
//
// =====================================================================
// WHY THIS FILE EXISTS (the field log, 2026-08-17)
// =====================================================================
// The owner's 50-call field log is full of this shape:
//   "can you move the reviews section above the gallery?" ->
//   either a bigger-build sentence or a style plan that changed nothing.
//
// The bigger-build answer was honest when it was written: no verb existed
// that could move a rendered section, and the capability tier said so
// (lib/riley-capabilities.js STRUCTURAL_CUES / BIGGER_BUILD_SENTENCE). But
// "bigger build" was doing duty for TWO different facts:
//
//   1. On sites whose sections are plain HTML in the page itself — the
//      engine's STATIC donors, e.g. donors-clean/fencing-sterling, where
//      index.html carries <section><h2>Our work</h2>…</section> as literal
//      bytes — moving a section is a byte move. Cut the element, paste it
//      somewhere else, deploy. The whole existing edit pipeline (snapshot,
//      upload, deploy, read-back, undo, replay-on-rebuild) already knows
//      how to do every one of those things.
//
//   2. On sites whose sections are CREATED AT RUNTIME by a compiled
//      assets/index-*.js bundle, the section order lives inside minified
//      component calls. Reordering those safely means rebuilding the
//      bundle, which this wave does not attempt.
//
// So this module makes (1) real and leaves (2) the honest bigger-build
// sentence. It lives in its OWN file, required from both
// lib/site-change-plan.js (which applies it) and
// lib/riley-capabilities.js (which classifies it), because those two must
// never disagree about which sentences are reorders — a capability layer
// that promised a verb the executor refused, or refused one it had, is the
// exact defect the tiered model was built to end.
//
// =====================================================================
// THE DISCIPLINE (same as every other op in this system)
// =====================================================================
// NEVER GUESS WHERE A SECTION GOES. A section is found by its heading, and
// a spoken name ("the reviews bit") is matched to a heading generously but
// resolved strictly: two sections scoring alike is a refusal that names
// what IS on the page, never a silent pick. This is the same law as
// resolveCaller's collision guard and buildAnchorCatalog's
// ambiguous-anchors-are-dropped rule.
//
// NEVER MOVE BYTES A CALLER DID NOT NAME. The parse extracts the section
// and the landmark from the instruction; an unmatched name reads the real
// section headings back rather than asking the caller to spell selectors,
// and a sentence about a NON-section thing ("move the logo above the phone
// button") does not parse at all — that one is a style_override and stays
// one.
//
// THE MOVE IS MARKED like every other edit (`<!-- wss-edit <jobId> -->`),
// so undo, the live-page probe and the rebuild replay all recognise it.

// ---------------------------------------------------------------------------
// Parsing the instruction
// ---------------------------------------------------------------------------
// "move the reviews above the gallery"
//   -> { verb: "reorder_section", section: "reviews", before: "gallery" }
// "put the gallery below the reviews"
//   -> { verb: "reorder_section", section: "gallery", after: "reviews" }
// "move the contact section to the top"
//   -> { verb: "reorder_section", section: "contact", edge: "top" }
//
// Returns null for anything it cannot resolve to ONE named section and at
// most one landmark — including the generic forms ("reorder the sections",
// "change the order around"), which carry no names and stay in the
// bigger-build tier where they belong.

const SECTION_NAME_STOP = new Set([
  "section", "sections", "block", "blocks", "the", "a", "an", "please",
  "and", "on", "of", "our", "page", "site", "up", "down", "over", "onto",
  "it", "that", "this", "to", "at", "in", "sit", "sits", "go", "goes",
]);

/**
 * The nouns that name a SECTION on this system's pages. A reorder only
 * parses when the moving thing or the landmark is section-shaped — this is
 * the vocabulary STRUCTURAL_CUES already uses (gallery, reviews, services,
 * testimonials, hero, footer, about, contact, pricing, faq) plus the
 * synonyms callers actually say. Without this gate "move the logo above
 * the phone button" would parse as a reorder and die at the catalog; it is
 * a style_override and must fall through to the model as one.
 */
const SECTION_NOUNS = new Set([
  "section", "sections", "block", "blocks",
  "gallery", "galleries", "reviews", "review", "testimonials", "testimonial",
  "services", "service", "pricing", "prices", "rates",
  "faq", "faqs", "questions", "about", "contact", "contacts",
  "hero", "banner", "footer", "team", "crew", "portfolio",
  "photos", "pictures", "images", "work", "projects", "story", "owner",
]);

/** "the reviews section" -> "reviews"; "" when nothing speakable remains. */
function cleanSectionName(raw) {
  const words = String(raw || "")
    .replace(/[^A-Za-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const kept = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (SECTION_NAME_STOP.has(lower)) continue;
    kept.push(lower);
  }
  const name = kept.join(" ").trim();
  // One word is the normal spoken form ("reviews", "gallery"); a short run is
  // fine ("frequently asked questions"). Longer than that is not a section
  // name, it is a sentence this parser is misreading.
  if (!name || name.length > 60 || kept.length > 5) return "";
  return name;
}

const isSectionNoun = (name) =>
  String(name || "").split(" ").some((w) => SECTION_NOUNS.has(w));

/**
 * parseSectionReorder(instruction) -> { verb, section, before|after|edge } | null
 *
 * Pure. Handles the verb-led, edge and bare-positional shapes heard on the
 * line. null whenever the sentence is not a section-shaped reorder.
 */
function parseSectionReorder(instruction) {
  const s = String(instruction || "").replace(/\s+/g, " ").trim();
  if (!s) return null;

  const build = (sectionRaw, position, landmarkRaw) => {
    const section = cleanSectionName(sectionRaw);
    if (!section) return null;
    if (position === "top" || position === "bottom") {
      if (!isSectionNoun(section)) return null;
      return { verb: "reorder_section", section, edge: position };
    }
    const landmark = cleanSectionName(landmarkRaw);
    if (!landmark || landmark === section) return null;
    // The section-shaped gate: at least one side of the move must name a
    // section noun, or the sentence is about an element and not ours to
    // parse.
    if (!isSectionNoun(section) && !isSectionNoun(landmark)) return null;
    return position === "before"
      ? { verb: "reorder_section", section, before: landmark }
      : { verb: "reorder_section", section, after: landmark };
  };

  // Shape A — verb-led: "move the reviews above the gallery",
  // "put the contact section below the faq", "switch the gallery section to
  // after the services". The preposition is captured, not re-derived.
  let m = s.match(
    /\b(?:move|put|place|bring|take|reorder|re-?order|rearrange|re-?arrange|switch|swap)\b\s+(?:the\s+)?(.{2,80}?)\s+\b(above|before|below|after|beneath|under)\b\s+(?:the\s+)?(.{2,60}?)(?:\s+(?:section|block))?(?:\s*(?:[.,!?;:]|$|\b(?:please|instead|now|though)\b))/i,
  );
  if (m) {
    const position = /^(above|before)$/i.test(m[2]) ? "before" : "after";
    return build(m[1], position, m[3]);
  }

  // Shape B — edge form: "move the reviews to the top",
  // "put the faq section at the bottom of the page".
  m = s.match(/\b(?:move|put|place|bring|take)\b\s+(?:the\s+)?(.{2,60}?)\s+\b(?:to|at)\s+the\s+(top|bottom)\b/i);
  if (m) return build(m[1], m[2].toLowerCase() === "top" ? "top" : "bottom", null);

  // Shape C — bare positional, only with the word section/block naming the
  // moving thing, so a styling sentence can never parse:
  // "the reviews section above the gallery".
  m = s.match(
    /^(?:i\s+(?:want|would\s+like|need)\s+)?(?:the\s+)?(.{2,60}?\s+(?:section|block))\s+\b(above|before|below|after)\b\s+(?:the\s+)?(.{2,60}?)(?:\s+(?:section|block))?(?:\s*(?:[.,!?;:]|$))/i,
  );
  if (m) {
    const position = /^(above|before)$/i.test(m[2]) ? "before" : "after";
    return build(m[1], position, m[3]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The section catalog
// ---------------------------------------------------------------------------
// A section is a <section>…</section> element that carries a heading. The
// heading is the only handle a caller has ("the reviews bit"), so a section
// with no heading is not offered — the same rule buildAnchorCatalog applies
// to anchors.

const normWords = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const plainText = (s) => String(s || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

/**
 * buildSectionCatalog(html) -> [{ heading, headingExact, start, end, bytes }]
 *
 * `headingExact` is the literal `<h2 …>Reviews</h2>` run — the stable,
 * exact-once handle the apply step and the rebuild replay both key on, the
 * same discipline as insert_html's anchorExact.
 */
function buildSectionCatalog(html) {
  const text = String(html || "");
  const out = [];
  for (const m of text.matchAll(/<section\b[^>]*>/gi)) {
    // Find the matching close, honouring nesting.
    let depth = 1;
    let end = -1;
    let closeTag = "";
    const scan = /<\/?section\b[^>]*>/gi;
    scan.lastIndex = m.index + m[0].length;
    for (const t of text.matchAll(scan)) {
      if (t.index <= m.index) continue;
      if (/^<\//.test(t[0])) depth -= 1;
      else depth += 1;
      if (depth === 0) { end = t.index + t[0].length; closeTag = t[0]; break; }
    }
    if (end < 0) continue; // unbalanced: never guess at the element's extent
    const block = text.slice(m.index, end);
    // The heading: first h1-h6 inside THIS section, searched in the section's
    // BODY (own open/close tags stripped) with any child sections blanked out,
    // so a child section's heading is never mistaken for this one's.
    const body = block.slice(m[0].length, block.length - closeTag.length);
    const inner = body.replace(/<section\b[^>]*>[\s\S]*?<\/section>/gi, (nested) => " ".repeat(nested.length));
    const h = inner.match(/<(h[1-6])\b[^>]*>([\s\S]{0,200}?)<\/\1>/i);
    if (!h) continue;
    const heading = plainText(h[2]);
    if (!heading) continue;
    const headingExact = h[0];
    // An ambiguous heading inside one file is unusable, exactly as an anchor
    // that occurs twice is dropped rather than disambiguated.
    if (text.split(headingExact).length - 1 !== 1) continue;
    out.push({ heading, headingExact, start: m.index, end, bytes: block.length });
  }
  return out;
}

// The names callers actually use, mapped to the words donors actually write.
// Small on purpose: every row is a pair seen in the field or in the donors'
// own headings. "Reviews" and "testimonials" are the same section to a
// caller; "Our work" is a gallery to anyone looking at it.
const SECTION_SYNONYMS = Object.freeze([
  ["reviews", "testimonials", "review", "testimonial"],
  ["gallery", "photos", "pictures", "images", "portfolio", "work", "projects"],
  ["services", "offerings", "pricing", "prices", "rates"],
  ["faq", "questions", "frequently asked"],
  ["contact", "contacts", "reach", "get in touch", "call"],
  ["about", "about us", "who we are", "story"],
  ["hero", "banner", "top"],
  ["team", "staff", "crew", "owner", "meet the owner"],
]);

function synonymKey(words) {
  const set = new Set(String(words || "").split(" ").filter(Boolean));
  for (let i = 0; i < SECTION_SYNONYMS.length; i += 1) {
    if (SECTION_SYNONYMS[i].some((g) => set.has(normWords(g)))) return i;
  }
  return -1;
}

/**
 * scoreName(query, heading) — how well a spoken name fits a heading.
 * 1000 exact (normalized), strong for a synonym hit, token overlap for the
 * rest. 0 means no relationship at all.
 */
function scoreName(query, heading) {
  const q = normWords(query);
  const h = normWords(heading);
  if (!q || !h) return 0;
  if (q === h) return 1000;
  const qTokens = new Set(q.split(" "));
  const hTokens = new Set(h.split(" "));
  let overlap = 0;
  for (const t of qTokens) if (hTokens.has(t)) overlap += 1;
  let score = overlap * 10;
  if (h.includes(q)) score += 40;
  const qKey = synonymKey(q);
  if (qKey >= 0 && qKey === synonymKey(h)) score += 60;
  return score;
}

/** Anything scoring at or above this has a real relationship to the heading. */
const MATCH_FLOOR = 10;

/**
 * matchSection(query, catalog) -> { section } | { ambiguous: [...] } | null
 *
 * The strict resolution: the single best-scoring section WINS only when it
 * wins alone. A tie is returned as a read-back list, never broken.
 */
function matchSection(query, catalog) {
  const scored = (catalog || [])
    .map((s) => ({ section: s, score: scoreName(query, s.heading) }))
    .filter((x) => x.score >= MATCH_FLOOR)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const top = scored[0].score;
  const tied = scored.filter((x) => x.score === top);
  if (tied.length > 1) return { ambiguous: tied.map((x) => x.section.heading) };
  return { section: scored[0].section };
}

// ---------------------------------------------------------------------------
// The refusal sentences — spoken, and specific to what actually failed
// ---------------------------------------------------------------------------
// Same law as every refusal in this system: no homework (never ask which
// file or which selector), say what IS there when that helps, and never
// claim impossibility about the whole feature when only this one section
// name failed to resolve.

/** A name that matched nothing. Offer the page's real sections by name. */
function sectionNotFoundSay(name, headings) {
  const list = (headings || []).slice(0, 6);
  const spoken = list.length > 1
    ? `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`
    : String(list[0] || "");
  return spoken
    ? `I can't find a section called "${name}" on your page. The sections I can see are: ${spoken}. Name one of those and where you want it, and I'll move it.`
    : `I can't find a section called "${name}" on your page, and I can't see the page's sections well enough to move anything safely — I'll have the team take that one on.`;
}

/** Two sections fit the name equally. Read both back; never pick. */
function sectionAmbiguousSay(name, headings) {
  const list = (headings || []).slice(0, 4);
  return `Two parts of the page could both be "${name}" — ${list.join(" and ")}. Say the one you mean by its heading and I'll move it.`;
}

/** A move that is already true. Said as a fact, not as a failure. */
const alreadyInPlaceSay = (moved, positionWord, landmark) =>
  `Good news — the ${moved} section is already ${positionWord}${landmark ? ` the ${landmark} section` : " of the page"}, so there's nothing for me to change.`;

// ---------------------------------------------------------------------------
// Resolution + apply
// ---------------------------------------------------------------------------
/**
 * planSectionReorder(fileTexts, parsed, { jobId, biggerBuildSay })
 *   -> { file, html, moved, movedExact, reference, referenceExact, position, headings }
 *
 * Synchronous resolution + byte move over the client's own HTML shell files
 * (never the compiled bundle). Throws a spoken refusal ({ planRefusal, say })
 * for every unresolvable case:
 *   - no HTML file carries ANY heading sections -> compiled donor; the
 *     caller-supplied bigger-build sentence is spoken
 *   - the named section unmatched          -> sectionNotFoundSay
 *   - a tie                                -> sectionAmbiguousSay
 *   - a before/after landmark unmatched    -> sectionNotFoundSay (landmark)
 */
function planSectionReorder(fileTexts, parsed, { jobId = "", biggerBuildSay = "" } = {}) {
  const files = Object.keys(fileTexts || {}).filter((rel) => /\.html?$/i.test(rel));
  // index.html first — the page the caller is looking at — then the rest,
  // stable.
  files.sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : 0) || a.localeCompare(b));

  let catalog = null;
  let file = null;
  for (const rel of files) {
    const found = buildSectionCatalog(fileTexts[rel]);
    if (found.length) { catalog = found; file = rel; break; }
  }
  if (!catalog) {
    const err = new Error("reorder_section: this page's sections are not plain HTML in the archive, so no safe quick-edit move exists");
    err.planRefusal = true;
    err.say = String(biggerBuildSay || "").trim() ||
      "That one's a bigger build on this site — the sections are put together by the page itself rather than written into it, so moving one means reassembling the page. I'll have the team take that on; meanwhile I can still change any words, colours, sizing or photos, add a section, or put a whole new page up.";
    throw err;
  }

  const target = matchSection(parsed.section, catalog);
  if (!target) {
    const err = new Error(`reorder_section: no section matches '${parsed.section}'`);
    err.planRefusal = true;
    err.say = sectionNotFoundSay(parsed.section, catalog.map((s) => s.heading));
    throw err;
  }
  if (target.ambiguous) {
    const err = new Error(`reorder_section: '${parsed.section}' matches ${target.ambiguous.length} sections`);
    err.planRefusal = true;
    err.say = sectionAmbiguousSay(parsed.section, target.ambiguous);
    throw err;
  }

  const position = parsed.edge === "top" ? "top" : parsed.edge === "bottom" ? "bottom" : (parsed.before ? "before" : "after");
  let referenceHeading = null;
  let referenceExact = null;
  if (parsed.before || parsed.after) {
    const landmarkName = parsed.before || parsed.after;
    const ref = matchSection(landmarkName, catalog.filter((s) => s !== target.section));
    if (!ref) {
      const err = new Error(`reorder_section: no section matches '${landmarkName}' as the landmark`);
      err.planRefusal = true;
      err.say = sectionNotFoundSay(landmarkName, catalog.map((s) => s.heading));
      throw err;
    }
    if (ref.ambiguous) {
      const err = new Error(`reorder_section: landmark '${landmarkName}' matches ${ref.ambiguous.length} sections`);
      err.planRefusal = true;
      err.say = sectionAmbiguousSay(landmarkName, ref.ambiguous);
      throw err;
    }
    referenceHeading = ref.section.heading;
    referenceExact = ref.section.headingExact;
  }

  const html = applySectionReorder(fileTexts[file], {
    headingExact: target.section.headingExact,
    position,
    referenceExact,
    jobId,
  });
  return {
    file,
    html,
    moved: target.section.heading,
    movedExact: target.section.headingExact,
    reference: referenceHeading,
    referenceExact,
    position,
    headings: catalog.map((s) => s.heading),
  };
}

/**
 * applySectionReorder(html, { headingExact, position, referenceExact, jobId })
 *   -> new html
 *
 * The deterministic byte move. `headingExact` (and the landmark's) must
 * occur EXACTLY once — the catalog guaranteed that when it found them; a
 * replay re-checks. The moved block is preceded by the standard edit marker
 * so undo, the live probe and the rebuild replay all recognise the change.
 * A section already in the requested place is a spoken refusal ("already
 * there"), never a silent no-op the pipeline would report as "changed
 * nothing".
 */
function applySectionReorder(html, { headingExact, position, referenceExact = null, jobId = "" }) {
  const text = String(html || "");
  if (text.split(headingExact).length - 1 !== 1) {
    throw new Error(`reorder_section: the section heading occurs ${text.split(headingExact).length - 1} times, refusing`);
  }
  const catalog = buildSectionCatalog(text);
  const target = catalog.find((s) => s.headingExact === headingExact);
  if (!target) throw new Error("reorder_section: the section heading is not inside a section this parser can bound, refusing");

  const inPlace = (word, landmark) => {
    const err = new Error(`reorder_section: already ${word}${landmark ? ` ${landmark}` : ""}`);
    err.planRefusal = true;
    err.alreadyInPlace = true;
    err.say = alreadyInPlaceSay(plainText(headingExact.replace(/<[^>]+>/g, " ")), word, landmark || null);
    return err;
  };

  const marker = jobId ? `<!-- wss-edit ${jobId} -->\n` : "";
  const marked = marker + text.slice(target.start, target.end);
  const without = text.slice(0, target.start) + text.slice(target.end);

  if (position === "top") {
    // Answered on the ORIGINAL order: if the section already opens the page,
    // the move is a fact, not a change.
    if (catalog[0] && catalog[0].headingExact === headingExact) throw inPlace("at the top");
    const first = buildSectionCatalog(without)[0];
    if (!first) throw inPlace("at the top");
    return without.slice(0, first.start) + marked + "\n" + without.slice(first.start);
  }
  if (position === "bottom") {
    const orig = catalog[catalog.length - 1];
    if (orig && orig.headingExact === headingExact) throw inPlace("at the bottom");
    const all = buildSectionCatalog(without);
    const last = all[all.length - 1];
    if (!last) throw inPlace("at the bottom");
    return without.slice(0, last.end) + "\n" + marked + without.slice(last.end);
  }

  if (without.split(referenceExact).length - 1 !== 1) {
    throw new Error(`reorder_section: the landmark heading occurs ${without.split(referenceExact).length - 1} times, refusing`);
  }
  const refHeading = plainText(String(referenceExact).replace(/<[^>]+>/g, " "));
  // Already directly in place? Answered on the ORIGINAL order, before the
  // section is lifted out — adjacency is a fact about the page the caller is
  // looking at, and removing the section first would hide it.
  const refAt = catalog.findIndex((s) => s.headingExact === referenceExact);
  if (refAt < 0) throw new Error("reorder_section: the landmark heading is not inside a section this parser can bound, refusing");
  const origNeighbour = position === "before" ? catalog[refAt - 1] : catalog[refAt + 1];
  if (origNeighbour && origNeighbour.headingExact === headingExact) {
    throw inPlace(position === "before" ? "above" : "below", refHeading);
  }
  const refs = buildSectionCatalog(without);
  const at = refs.findIndex((s) => s.headingExact === referenceExact);
  if (at < 0) throw new Error("reorder_section: the landmark heading is not inside a section this parser can bound, refusing");
  const cut = position === "before" ? refs[at].start : refs[at].end;
  return without.slice(0, cut) + marked + "\n" + without.slice(cut);
}

module.exports = {
  parseSectionReorder,
  buildSectionCatalog,
  applySectionReorder,
  planSectionReorder,
  matchSection,
  scoreName,
  sectionNotFoundSay,
  sectionAmbiguousSay,
  SECTION_SYNONYMS,
  SECTION_NOUNS,
};
