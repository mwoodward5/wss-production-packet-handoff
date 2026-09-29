"use strict";

// lib/mirror-engine/sameness.js — SAMENESS IS A BUILD FAILURE.
//
// Owner directive, 2026-08-11: "refuse to publish a mirror whose h1 or title
// is byte-identical to another live mirror's. Sameness becomes a build
// failure, not something we discover in the gallery."
//
// Three questions, three different kinds of evidence, all of them measured on
// the bytes or the DOM this build actually produces:
//
//   1. CAN the donor say the client's name at all?  A hero headline the donor
//      hardcoded has no token slot near it, so no fact we resolve can ever
//      reach it. hvac-premier had exactly this shape and all 32 HVAC mirrors
//      shipped its sentence. Measured on the donor's own bytes, before a
//      single Vercel call is spent — a refusal here costs nothing.
//
//   2. DOES the served <head> identify this business?  The title and og:title
//      are the card a prospect sees in the email, in a text message and in a
//      search result, and a scraper never runs the JS that would fix them at
//      runtime. Measured on the hydrated index.html.
//
//   3. IS IT THE SAME AS SOMEBODY ELSE'S?  The rendered h1 and the served
//      title are compared against every other mirror this engine knows about.
//      In-process first (a batch builds N mirrors in one lambda), plus any
//      durable fleet the caller supplies.
//
// Nothing here judges taste. Every problem is a fact about a collision or an
// absence, and each one names the other slug or the missing atom so an
// operator can act without re-deriving anything.

const { identityKey } = require("./identity-copy");

/** Tokens a donor can use to let a client's own headline reach the page. */
const HEADLINE_TOKENS = Object.freeze(["HERO_HEADLINE", "HERO_LINE_A"]);

const stripComments = (rel, text) =>
  (/\.html$/i.test(rel) ? String(text).replace(/<!--[\s\S]*?-->/g, "") : String(text));

/**
 * Does this donor have anywhere to PUT a client headline?
 * Counted on the donor's own bytes (pre-hydration), HTML comments removed —
 * a token mentioned in a comment is documentation, not a slot.
 */
function donorHeadlineSlots(donorFiles = {}) {
  const found = [];
  for (const [rel, buf] of Object.entries(donorFiles)) {
    if (!/\.(html|js|mjs)$/i.test(rel)) continue;
    const text = stripComments(rel, buf.toString("utf8"));
    for (const token of HEADLINE_TOKENS) {
      const n = text.split(`{{${token}}}`).length - 1;
      if (n > 0) found.push({ file: rel, token, count: n });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The served <head>
// ---------------------------------------------------------------------------
function decodeBasicEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html, attr, value) {
  const re = new RegExp(`<meta[^>]*\\b${attr}=["']${value}["'][^>]*>`, "i");
  const tag = re.exec(html);
  if (!tag) return "";
  const content = /content=["']([\s\S]*?)["']/i.exec(tag[0]);
  return content ? decodeBasicEntities(content[1]).trim() : "";
}

/** { title, og_title, description } from the hydrated index.html. */
function servedIdentity(files = {}) {
  const buf = files["index.html"];
  if (!buf) return { title: "", og_title: "", description: "", present: false };
  const html = buf.toString("utf8");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return {
    present: true,
    title: title ? decodeBasicEntities(title[1]).replace(/\s+/g, " ").trim() : "",
    og_title: metaContent(html, "property", "og:title"),
    description: metaContent(html, "name", "description"),
  };
}

// ---------------------------------------------------------------------------
// Identity atoms — does this string actually name THIS business?
// ---------------------------------------------------------------------------
// Substring, not equality: a title is "Rose City Heating and Air | HVAC in
// Portland, OR" and the atom is "Rose City Heating and Air". Comparison is
// case-insensitive and punctuation-insensitive so "M & M" matches "M &amp; M"
// once decoded and "O'Brien" matches "O’Brien" after the apostrophe
// normalisation the fact boundary already applied.
function loose(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contains(haystack, needle) {
  const h = loose(haystack);
  const n = loose(needle);
  if (!h || !n) return false;
  return h.includes(n);
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------
/**
 * samenessCheck({ slug, facts, marketCity, copy, donorFiles, files,
 *                 renderedH1, fleet })
 *
 *   copy       — the composeIdentityCopy() result this build hydrated with.
 *   donorFiles — the donor's bytes, BEFORE hydration (slot detection).
 *   files      — the hydrated tree (served <head>).
 *   renderedH1 — the h1 read out of the real DOM by renderAudit, or null when
 *                no render has happened yet (dry run) or the audit did not
 *                report one.
 *   fleet      — [{ slug, h1, title }] for every OTHER mirror we know of.
 *
 * Returns a check object. `status` is "passed" or "failed"; every failure
 * carries the evidence that produced it.
 */
function samenessCheck({
  slug = "",
  facts = {},
  marketCity = "",
  copy = null,
  donorFiles = {},
  files = {},
  renderedH1 = null,
  fleet = [],
} = {}) {
  const problems = [];
  const businessName = String(facts.business_name || "").trim();
  const city = String(marketCity || facts.city || "").trim();

  // 1. The donor must have somewhere to put the client's own headline.
  const slots = donorHeadlineSlots(donorFiles);
  if (!slots.length) {
    problems.push(
      "donor_has_no_headline_slot: the donor hardcodes its hero headline, so no fact about this business can reach it"
      + " — every mirror built from it would publish the same sentence",
    );
  }

  // 2. The served head must identify this business.
  const served = servedIdentity(files);
  if (!served.present) {
    problems.push("served_head_missing: no index.html in the built tree");
  } else {
    if (!served.title) problems.push("served_title_missing");
    else {
      if (businessName && !contains(served.title, businessName)) {
        problems.push(`served_title_missing_business_name: ${JSON.stringify(served.title)}`);
      }
      if (city && !contains(served.title, city)) {
        problems.push(`served_title_missing_city: ${JSON.stringify(served.title)}`);
      }
    }
    if (served.og_title && businessName && !contains(served.og_title, businessName)) {
      problems.push(`served_og_title_missing_business_name: ${JSON.stringify(served.og_title)}`);
    }
  }

  // 3. The rendered h1 must be the client's own line — when we have one to read.
  //
  //    "QC PASS is never proof, render the DOM." A donor CAN carry a headline
  //    token and still paint its own sentence over the top (a second h1, a
  //    hero that ignores the slot). The only way to know is to read what the
  //    browser produced, which is why this is measured after the render and
  //    not inferred from the slot count above.
  const lineA = copy && copy.lines ? String(copy.lines.a || "") : "";
  const h1 = renderedH1 == null ? null : String(renderedH1).replace(/\s+/g, " ").trim();
  let h1Verdict = "not_measured";
  if (h1 !== null) {
    if (!h1) {
      h1Verdict = "empty";
      problems.push("rendered_h1_empty: the page's first heading has no text");
    } else if (businessName && contains(h1, businessName)) {
      h1Verdict = "client_derived";
    } else {
      h1Verdict = "donor_copy";
      problems.push(
        `rendered_h1_not_client_derived: ${JSON.stringify(h1.slice(0, 140))}`
        + ` carries neither ${JSON.stringify(businessName)} nor the composed headline`,
      );
    }
  }

  // 4. Collisions with every other mirror we know about.
  const myH1 = identityKey(h1 || (copy && copy.headline) || "");
  const myTitle = identityKey(served.title);
  const collisions = [];
  for (const other of Array.isArray(fleet) ? fleet : []) {
    if (!other || !other.slug || other.slug === slug) continue;
    if (myH1 && identityKey(other.h1) === myH1) {
      collisions.push({ field: "h1", slug: other.slug, value: myH1.slice(0, 160) });
    }
    if (myTitle && identityKey(other.title) === myTitle) {
      collisions.push({ field: "title", slug: other.slug, value: myTitle.slice(0, 160) });
    }
  }
  for (const c of collisions.slice(0, 6)) {
    problems.push(`duplicate_${c.field}_with_${c.slug}: ${JSON.stringify(c.value)}`);
  }

  return {
    status: problems.length ? "failed" : "passed",
    problems,
    headline: copy ? copy.headline : "",
    headline_source: copy ? copy.source : "",
    headline_basis: copy ? copy.basis : [],
    lines: copy ? copy.lines : null,
    donor_headline_slots: slots.slice(0, 6),
    served_title: served.title,
    served_og_title: served.og_title,
    rendered_h1: h1,
    rendered_h1_verdict: h1Verdict,
    fleet_compared: Array.isArray(fleet) ? fleet.length : 0,
    ...(collisions.length ? { collisions: collisions.slice(0, 12) } : {}),
  };
}

/** The row this build contributes to the fleet, for the next build to check. */
function identityRow({ slug, copy, files, renderedH1 }) {
  const served = servedIdentity(files || {});
  return {
    slug,
    h1: identityKey(renderedH1 || (copy && copy.headline) || ""),
    title: identityKey(served.title),
  };
}

module.exports = {
  samenessCheck,
  servedIdentity,
  donorHeadlineSlots,
  identityRow,
  HEADLINE_TOKENS,
};
