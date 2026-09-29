"use strict";
/**
 * VISIBLE-TEXT EXTRACTOR — the shared basis for every enrichment and
 * identity gate. Reusable across all clients; carries no client data.
 *
 * WHY THIS FILE EXISTS — two real, opposite failures in one pass:
 *   1. Matching RAW HTML produced FALSE POSITIVES: "gutters", "siding", "GAF",
 *      "Master Elite" and "1993" all appear in markup/CSS/SEO tags and in ZERO
 *      visible copy. Acting on them would have blocked services the client
 *      really offers and published a certification they never claim.
 *   2. A silently-EMPTY extraction produced FALSE NEGATIVES: a wrong key
 *      (`raw.data` instead of `raw.pages`) yielded "" and reported 0 of 7
 *      owner-verified certifications as absent — which would have shipped a
 *      mirror stripped of the client's earned authority.
 *
 * THREE-STATE RULE (never two):
 *   FOUND    → the token is in visible copy. Publishable.
 *   ABSENT   → extraction succeeded and the token genuinely is not there. Block.
 *   ERROR    → extraction yielded nothing usable. FAIL LOUD. Never "absent".
 *              `0 >= 0` must never green-light a hollow mirror.
 */

const { decodeEntitiesOnce } = require("./html-entities");

/** Minimum visible characters before an extraction is considered trustworthy. */
// Overridable so a short unit fixture can exercise the logic without tripping
// the "extraction looks empty" alarm. Production callers leave it at 500.
const MIN_VISIBLE_CHARS = Number(process.env.MIN_VISIBLE_CHARS || 500);

const STATE = Object.freeze({ FOUND: "found", ABSENT: "absent", ERROR: "extractor_error" });

/** Strip non-visible regions from HTML, then tags, then entities. */
function htmlToVisibleText(html) {
  if (typeof html !== "string" || !html) return "";
  const stripped = html
    // Regions that never render as copy — the false-positive sources.
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Explicitly hidden elements.
    .replace(/<[^>]+\bhidden\b[^>]*>[\s\S]*?<\/[^>]+>/gi, " ")
    .replace(/<[^>]+style="[^"]*display\s*:\s*none[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  // Six hand-listed entities used to live here, all named. A donor phone
  // written "&#40;520&#41; 555-0142" therefore read as literal entity text to
  // every leak scan and slipped every gate. One shared decoder, one pass —
  // tags first, so authored "&lt;div&gt;" text is not turned into a tag and
  // then deleted.
  return decodeEntitiesOnce(stripped).replace(/\s+/g, " ").trim();
}

/**
 * Pull visible text out of a Firecrawl crawl artifact.
 * Tolerates the several shapes the API returns; NEVER silently yields "".
 * @returns {{ text, pages, perPage, source, state, reason? }}
 */
function visibleTextFromCrawl(raw) {
  if (!raw || typeof raw !== "object") {
    return { text: "", pages: 0, perPage: [], source: null, state: STATE.ERROR, reason: "crawl artifact is not an object" };
  }
  // The array has lived at .pages, .data and the root across API versions. Take
  // the first array of page-ish objects rather than assuming one key — the
  // wrong-key assumption is precisely what caused the empty extraction.
  const candidates = [raw.pages, raw.data, raw.results, Array.isArray(raw) ? raw : null]
    .concat(Object.values(raw).filter(Array.isArray));
  const pages = candidates.find((a) => Array.isArray(a) && a.length) || [];
  if (!pages.length) {
    return { text: "", pages: 0, perPage: [], source: null, state: STATE.ERROR, reason: "no page array found in the crawl artifact" };
  }

  const perPage = [];
  let usedMarkdown = 0, usedHtml = 0;
  for (const p of pages) {
    if (!p) continue;
    const d = (p.data && typeof p.data === "object" ? p.data : p) || {};
    const inner = d.data && typeof d.data === "object" ? d.data : d;
    let text = "", via = null;
    if (typeof inner.markdown === "string" && inner.markdown.trim()) {
      // Markdown is Firecrawl's rendered-text view: already visible-only.
      text = inner.markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      via = "markdown"; usedMarkdown++;
    } else if (typeof inner.html === "string" && inner.html.trim()) {
      text = htmlToVisibleText(inner.html); via = "html_stripped"; usedHtml++;
    } else if (typeof inner.content === "string" && inner.content.trim()) {
      text = String(inner.content).replace(/\s+/g, " ").trim(); via = "content";
    }
    perPage.push({ url: p.url || (inner.metadata && inner.metadata.sourceURL) || null, chars: text.length, via, text });
  }

  const text = perPage.map((x) => x.text).join("\n");
  if (text.length < MIN_VISIBLE_CHARS) {
    return { text, pages: pages.length, perPage, source: null, state: STATE.ERROR,
      reason: `extracted only ${text.length} visible chars from ${pages.length} pages (min ${MIN_VISIBLE_CHARS}) — treat as EXTRACTOR ERROR, never as "absent"` };
  }
  return { text, pages: pages.length, perPage, source: usedMarkdown >= usedHtml ? "markdown" : "html_stripped", state: "ok" };
}

/**
 * Look a token up in visible text. Returns FOUND / ABSENT / ERROR — never a
 * bare boolean, so a caller cannot mistake an error for an absence.
 */
function findInVisible(extraction, pattern) {
  if (!extraction || extraction.state === STATE.ERROR) {
    return { state: STATE.ERROR, reason: (extraction && extraction.reason) || "no extraction" };
  }
  const re = pattern instanceof RegExp ? pattern : new RegExp(`(?<![A-Za-z0-9])${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
  const page = extraction.perPage.find((p) => p.text && re.test(p.text));
  return page ? { state: STATE.FOUND, source_url: page.url } : { state: STATE.ABSENT };
}

/* ---------------------------------------------------------------------------
 * PAGE-TYPE WEIGHTING (owner-set 2026-07-30) — the axis that stops BOTH failure
 * modes. Proven necessary by the Ramon reconciliation:
 *   · "GAF Authorized Roofer" is a HEADING on 8 service pages  -> CREDENTIAL.
 *   · "gutters" sits in copper-roofing body copy               -> COMPONENT
 *     mention, NOT a standalone service line (no nav, no page).
 *   · "siding" reads "may be installed as roofing or siding"   -> capability
 *     note on the wood-shingle page only.
 *   · "1993" is one blog line                                  -> INCIDENTAL.
 * A token's page type and position decide whether it is a claim, copy or noise.
 * ------------------------------------------------------------------------- */
const PAGE_TYPE = Object.freeze({
  SERVICE: "service_page", BLOG: "blog", TESTIMONIAL: "testimonial",
  AWARDS: "awards", ABOUT: "about", OTHER: "other",
});
const CLAIM_LEVEL = Object.freeze({
  SERVICE_LINE: "service_line",     // gets nav + its own page
  CREDENTIAL: "credential",         // badge / certification block
  COMPONENT: "component_mention",   // copy only, inside another service
  INCIDENTAL: "incidental",         // blog/testimonial aside — never published
});

function classifyPage(url) {
  const u = String(url || "").toLowerCase();
  if (/\/blog/.test(u)) return PAGE_TYPE.BLOG;
  if (/testimonial/.test(u)) return PAGE_TYPE.TESTIMONIAL;
  if (/award/.test(u)) return PAGE_TYPE.AWARDS;
  if (/about/.test(u)) return PAGE_TYPE.ABOUT;
  if (/roofing|roof-|shingle|tile|copper|metal|slate|commercial|repair|historic|storm|sheet-metal/.test(u)) return PAGE_TYPE.SERVICE;
  return PAGE_TYPE.OTHER;
}

/** Markdown heading lines carry claim weight; body sentences do not. */
function inHeading(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  return /^\s{0,3}#{1,6}\s/.test(text.slice(start, index + 1));
}

/**
 * Weight a token by WHERE it appears, which is what it MEANS.
 * Returns claim level plus publishableAsService / publishableAsCopy so a caller
 * cannot conflate "this word exists" with "they sell this".
 */
function weightToken(extraction, pattern) {
  if (!extraction || extraction.state === STATE.ERROR) {
    return { state: STATE.ERROR, reason: (extraction && extraction.reason) || "no extraction" };
  }
  const src = pattern instanceof RegExp ? pattern.source : String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(src, "gi");
  const occurrences = [];
  for (const p of extraction.perPage) {
    if (!p.text) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(p.text)) && occurrences.length <= 200) {
      occurrences.push({
        url: p.url,
        pageType: classifyPage(p.url),
        heading: inHeading(p.text, m.index),
        context: p.text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ").trim(),
      });
    }
  }
  if (!occurrences.length) return { state: STATE.ABSENT };

  const svcHeading = occurrences.some((o) => o.pageType === PAGE_TYPE.SERVICE && o.heading);
  const anyHeading = occurrences.some((o) => o.heading);
  const svcBody = occurrences.some((o) => o.pageType === PAGE_TYPE.SERVICE);
  const onlyIncidental = occurrences.every((o) => o.pageType === PAGE_TYPE.BLOG || o.pageType === PAGE_TYPE.TESTIMONIAL);

  const claim = svcHeading ? CLAIM_LEVEL.SERVICE_LINE
    : anyHeading ? CLAIM_LEVEL.CREDENTIAL
    : onlyIncidental ? CLAIM_LEVEL.INCIDENTAL
    : svcBody ? CLAIM_LEVEL.COMPONENT
    : CLAIM_LEVEL.INCIDENTAL;

  return {
    state: STATE.FOUND, claim, pages: occurrences.length,
    pageTypes: [...new Set(occurrences.map((o) => o.pageType))],
    occurrences: occurrences.slice(0, 8),
    publishableAsService: claim === CLAIM_LEVEL.SERVICE_LINE,
    publishableAsCopy: claim !== CLAIM_LEVEL.INCIDENTAL,
  };
}

/* ---------------------------------------------------------------------------
 * SEGMENTED EXTRACTION — headings and nav must survive into the weighting.
 *
 * Firecrawl's markdown view flattens HTML headings, so "GAF Authorized Roofer"
 * (an <h3> on 8 service pages) looked like body copy and misclassified as a
 * component mention instead of a credential. Reading the HTML preserves both
 * signals we need: heading-ness and nav-ness.
 *
 * NAV RULE (owner guardrail): strip nav / header-menu / footer-menu / repeated
 * site chrome, THEN weight what remains. Do NOT discount a token merely for
 * appearing on many pages — a real service like Clay Tile legitimately appears
 * in body copy site-wide. A token surviving ONLY in nav is navigation, not a claim.
 * ------------------------------------------------------------------------- */
const NAV_BLOCK_RE = /<(nav|header|footer)\b[\s\S]*?<\/\1>/gi;
const NAV_ATTR_RE = /<([a-z]+)\b[^>]*(?:role="navigation"|class="[^"]*\b(?:nav|navbar|menu|breadcrumb|site-header|site-footer)\b[^"]*")[^>]*>[\s\S]*?<\/\1>/gi;
const HEADING_RE = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<([a-z]+)\b[^>]*role="heading"[^>]*>([\s\S]*?)<\/\3>/gi;

/** Split one page's HTML into {text, heading, nav} segments. */
function htmlToSegments(html) {
  if (typeof html !== "string" || !html) return [];
  // 1. drop never-rendered regions (the raw-markup false-positive source)
  let doc = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const segments = [];
  // 2. lift nav/chrome out FIRST, tagged nav:true so it is weighted separately
  const lift = (re) => {
    doc = doc.replace(re, (block) => {
      const t = htmlToVisibleText(block);
      if (t) segments.push({ text: t, heading: false, nav: true });
      return " ";
    });
  };
  lift(NAV_BLOCK_RE);
  lift(NAV_ATTR_RE);

  // 3. lift headings, tagged heading:true — markdown # OR html <h1>-<h6> counts
  doc = doc.replace(HEADING_RE, (m, _t1, inner1, _t2, inner2) => {
    const t = htmlToVisibleText(inner1 || inner2 || "");
    if (t) segments.push({ text: t, heading: true, nav: false });
    return " ";
  });

  // 4. whatever remains is body copy
  const body = htmlToVisibleText(doc);
  if (body) segments.push({ text: body, heading: false, nav: false });
  return segments;
}

/** Markdown headings, for pages where only markdown is available. */
function markdownToSegments(md) {
  if (typeof md !== "string" || !md) return [];
  return md.split(/\n/).filter((l) => l.trim()).map((line) => ({
    text: line.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/^\s{0,3}#{1,6}\s*/, "").trim(),
    heading: /^\s{0,3}#{1,6}\s/.test(line),
    nav: false,
  })).filter((s) => s.text);
}

/** Attach segments to an extraction produced by visibleTextFromCrawl. */
function segmentCrawl(raw) {
  const ex = visibleTextFromCrawl(raw);
  if (ex.state === STATE.ERROR) return ex;
  const arr = [raw.pages, raw.data, raw.results, Array.isArray(raw) ? raw : null]
    .concat(Object.values(raw).filter(Array.isArray))
    .find((a) => Array.isArray(a) && a.length) || [];
  ex.perPage = ex.perPage.map((p, i) => {
    const src = arr[i] || {};
    const d = (src.data && typeof src.data === "object" ? src.data : src) || {};
    const inner = d.data && typeof d.data === "object" ? d.data : d;
    const segs = typeof inner.html === "string" && inner.html.trim()
      ? htmlToSegments(inner.html)
      : markdownToSegments(inner.markdown);
    return { ...p, segments: segs };
  });
  return ex;
}

/**
 * Weight a token using segments: nav is stripped, then heading-ness on a
 * service page decides service_line vs credential vs component vs incidental.
 */
function weightTokenSegmented(extraction, pattern) {
  if (!extraction || extraction.state === STATE.ERROR) {
    return { state: STATE.ERROR, reason: (extraction && extraction.reason) || "no extraction" };
  }
  const src = pattern instanceof RegExp ? pattern.source : String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(src, "i");
  const body = [], navOnly = [];
  for (const p of extraction.perPage) {
    for (const s of p.segments || []) {
      if (!s.text || !re.test(s.text)) continue;
      const hit = { url: p.url, pageType: classifyPage(p.url), heading: s.heading,
        context: s.text.slice(0, 140).replace(/\s+/g, " ").trim() };
      (s.nav ? navOnly : body).push(hit);
    }
  }
  if (!body.length) {
    return navOnly.length
      ? { state: STATE.FOUND, claim: CLAIM_LEVEL.INCIDENTAL, navOnly: true, pages: navOnly.length,
          publishableAsService: false, publishableAsCopy: false,
          reason: "appears only in navigation/site chrome — navigation is not a claim" }
      : { state: STATE.ABSENT };
  }
  // A CREDENTIAL is identified by its own wording, not merely by sitting in a
  // heading. "GAF Authorized Roofer" is an <h3> on a service page — heading
  // position alone made it look like a service line, and "gutters" appearing in
  // an awards heading made it look like a credential. Both were wrong.
  const CREDENTIAL_MARKER = /\b(authoriz|certifi|accredit|member|institute|association|bureau|licensed)\w*\b/i;
  const credentialWorded = body.some((o) => CREDENTIAL_MARKER.test(o.context));

  const svcHeading = body.some((o) => o.pageType === PAGE_TYPE.SERVICE && o.heading);
  const svcBody = body.some((o) => o.pageType === PAGE_TYPE.SERVICE);
  const onlyIncidental = body.every((o) => o.pageType === PAGE_TYPE.BLOG || o.pageType === PAGE_TYPE.TESTIMONIAL);

  const claim = credentialWorded ? CLAIM_LEVEL.CREDENTIAL
    : svcHeading ? CLAIM_LEVEL.SERVICE_LINE
    : onlyIncidental ? CLAIM_LEVEL.INCIDENTAL
    : svcBody ? CLAIM_LEVEL.COMPONENT
    : CLAIM_LEVEL.INCIDENTAL;

  return {
    state: STATE.FOUND, claim, pages: body.length, navStripped: navOnly.length,
    pageTypes: [...new Set(body.map((o) => o.pageType))],
    headingPages: body.filter((o) => o.heading).slice(0, 4),
    occurrences: body.slice(0, 6),
    publishableAsService: claim === CLAIM_LEVEL.SERVICE_LINE,
    publishableAsCopy: claim !== CLAIM_LEVEL.INCIDENTAL,
  };
}

module.exports = {
  visibleTextFromCrawl, htmlToVisibleText, findInVisible, weightToken,
  segmentCrawl, htmlToSegments, markdownToSegments, weightTokenSegmented,
  classifyPage, inHeading, STATE, PAGE_TYPE, CLAIM_LEVEL, MIN_VISIBLE_CHARS,
};
