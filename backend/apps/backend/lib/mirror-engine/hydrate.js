"use strict";

// lib/mirror-engine/hydrate.js — donor dist -> hydrated file tree, in memory.
//
// Context-safe substitution: split(token).join(value), NEVER String.replace —
// replace() interprets $& / $$ in the replacement, and a business name like
// "Roofing $ave" silently corrupts a minified bundle. Values are additionally
// boundary-normalized (facts.js): straight apostrophes become U+2019 so
// "Mike's" can never terminate a '…' JS literal, and <>"`\$ are rejected
// outright before this module ever runs.
//
// After hydration, a parse gate re-parses every text artifact the customer
// will receive (acorn for JS, JSON.parse for JSON/webmanifest, tag-balance for
// HTML). A white screen that passes every listed check is exactly the failure
// class this ~50ms buys out.

const path = require("node:path");
const acorn = require("acorn");
const {
  ALLOWED_TOKENS,
  REQUIRED_TOKENS,
  OPTIONAL_TOKENS,
  TOKEN_RE,
  HYDRATE_EXTS,
  unknownTokensIn,
} = require("./tokens");
const { collapsePhrases, unguardedSlots, PHRASE_RESIDUE_RE } = require("./prose");

const MANIFEST_FILES = new Set(["BOILERPLATE.json", "DONOR_PROFILE.json"]);

function extOf(rel) {
  return path.extname(String(rel)).toLowerCase();
}

function isTextFile(rel) {
  return HYDRATE_EXTS.has(extOf(rel));
}

// ---------------------------------------------------------------------------
// OPTIONAL collapse — donor-side guarantee via data-collapse-if-empty
// ---------------------------------------------------------------------------
// "OPTIONAL collapses its element" cannot be done by string replace on a
// compiled bundle (a blank RATING in a minified data array renders an empty
// star row or NaN). The donor marks collapsible markup with
// data-collapse-if-empty="RATING,REVIEW_COUNT"; when EVERY listed token is
// blank, the whole element is removed before substitution. This only works in
// real markup (.html/.svg), which is where donors must put collapsible blocks.

const COLLAPSE_ATTR_RE = /data-collapse-if-empty="([A-Z_,\s]+)"/;

function removeCollapsedElements(html, isBlankToken) {
  let out = String(html);
  let guard = 0;
  for (;;) {
    if (++guard > 500) throw new Error("collapse pass did not converge");
    const openMatch = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\bdata-collapse-if-empty="([A-Z_,\s]+)"[^>]*>/.exec(out);
    if (!openMatch) break;
    const [openTag, tagName, tokenList] = openMatch;
    const tokens = tokenList.split(",").map((t) => t.trim()).filter(Boolean);
    const allBlank = tokens.length > 0 && tokens.every((t) => isBlankToken(t));
    const start = openMatch.index;

    // Find the element's end: self-closing, void, or matching close tag with
    // same-name nesting handled by depth counting.
    let end;
    if (/\/>$/.test(openTag)) {
      end = start + openTag.length;
    } else {
      const tagRe = new RegExp(`<${tagName}\\b[^>]*>|</${tagName}>`, "g");
      tagRe.lastIndex = start + openTag.length;
      let depth = 1;
      let m;
      end = -1;
      while ((m = tagRe.exec(out))) {
        if (m[0].startsWith("</")) depth--;
        else if (!/\/>$/.test(m[0])) depth++;
        if (depth === 0) { end = m.index + m[0].length; break; }
      }
      if (end === -1) throw new Error(`unbalanced <${tagName}> at data-collapse-if-empty block`);
    }

    if (allBlank) {
      out = out.slice(0, start) + out.slice(end);
    } else {
      // Keep the element; strip only the marker attribute so it cannot be
      // rediscovered next iteration (and never ships to a customer).
      const kept = openTag.replace(/\s*data-collapse-if-empty="[A-Z_,\s]+"/, "");
      out = out.slice(0, start) + kept + out.slice(start + openTag.length);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// URL + tel: normalization (post-substitution)
// ---------------------------------------------------------------------------
// Donor templates compose URLs by appending a path to {{SITE_URL}}, which the
// token map defines WITH its trailing slash ("https://host/"). Two live
// defects (2026-09-02 fleet audit) came out of that composition:
//   · fencing schema "@id": "{{SITE_URL}}/#business"  -> "…wss-ai.com//#business" ×3
//   · landscaping og:url / JSON-LD "url": "{{SITE_URL}}/" -> "…wss-ai.com//"
// Donors are data, not code this engine reviews line by line, so the builder
// contract is enforced here instead: after substitution, a double slash is
// only ever a composition accident. Collapsed to one. The scheme's own "//"
// is untouchable (the host capture stops at the first slash), protocol-
// relative "//cdn…" has no scheme and never matches, and every other single
// slash is byte-preserved.
function normalizeHydratedUrls(text) {
  return String(text || "").replace(
    /(https?:\/\/[^\s"'`<>\\/]+)\/{2,}/g,
    "$1/",
  );
}

// THE tel: URI IS A DIAL TARGET, NOT A DISPLAY STRING. The same audit caught
// a boilerplate CTA hydrating href="tel:{{PHONE}}" — the human-formatted
// token — and shipping href="tel:(614) 294-8888", which violates RFC 3966;
// dialers may refuse it while the sibling tel:6142948888 worked. Donor
// tel: hrefs are normalized to their digits here. A leading "+" is kept:
// "tel:+16142948888" is the RFC's own E.164 form and stripping the plus
// would break international dialing; every other non-digit (spaces, parens,
// dashes, dots) is removed. Runtime-built hrefs ("tel:${e.phone}") are not
// static bytes and stay out of scope.
function normalizeTelHrefValue(value) {
  const trimmed = String(value || "").trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/\D/g, "");
}
function normalizeHydratedTelHrefs(text) {
  return String(text || "")
    // Static HTML attribute form: href="tel:…" / href='tel:…'.
    .replace(/(\bhref\s*=\s*(["'])\s*tel:)([^"']*)(\2)/gi,
      (m, pre, q, value, endq) => `${pre}${normalizeTelHrefValue(value)}${endq}`)
    // Literal string form inside first-party bundles: "tel:…", 'tel:…', `tel:…`
    // (a literal must contain at least one digit so "tel:${e.phone}" never matches).
    .replace(/(["'`])tel:(\+?[\d\s().-]{6,20})\1/g,
      (m, q, value) => `${q}tel:${normalizeTelHrefValue(value)}${q}`);
}

// ---------------------------------------------------------------------------
// Parse gate
// ---------------------------------------------------------------------------
function parseGate(files) {
  const failures = [];
  for (const [rel, buf] of Object.entries(files)) {
    const ext = extOf(rel);
    const text = () => buf.toString("utf8");
    try {
      if (ext === ".json" || ext === ".webmanifest") {
        JSON.parse(text());
      } else if (ext === ".js" || ext === ".mjs") {
        const src = text();
        try {
          acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });
        } catch {
          acorn.parse(src, { ecmaVersion: "latest", sourceType: "script" });
        }
      } else if (ext === ".html") {
        const src = text();
        const opens = (src.match(/<script\b/gi) || []).length;
        const closes = (src.match(/<\/script>/gi) || []).length;
        if (opens !== closes) throw new Error(`unbalanced <script> tags (${opens} open, ${closes} close)`);
        if (!/<html[\s>]/i.test(src) && !/<!doctype/i.test(src)) throw new Error("no <html> or doctype");
      } else if (ext === ".svg" || ext === ".xml") {
        const src = text();
        if (/<[a-zA-Z][^>]*$/.test(src.trim())) throw new Error("truncated tag at EOF");
      }
    } catch (e) {
      failures.push({ file: rel, reason: String(e.message || e).slice(0, 200) });
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Hydrate
// ---------------------------------------------------------------------------
/**
 * hydrate({ donorFiles, tokenValues })
 *   donorFiles: { relPath -> Buffer } — the donor's built dist, verbatim.
 *   tokenValues: { TOKEN_NAME -> string } — every ALLOWED token, blanks included.
 *
 * Returns { ok:true, files, report } or { ok:false, error, detail }.
 * Errors are engine/donor defects (unmapped_token, hydration_parse_failed,
 * unhydrated_tokens) — the input boundary has already vouched for the facts.
 */
function hydrate({ donorFiles, tokenValues }) {
  // Every allowed token must be present in the value map, even as "".
  const missingKeys = [...ALLOWED_TOKENS].filter((t) => !(t in tokenValues));
  if (missingKeys.length) {
    return { ok: false, error: "hydrator_token_map_incomplete", detail: missingKeys };
  }
  const blankRequired = [...REQUIRED_TOKENS].filter((t) => !String(tokenValues[t] || "").trim());
  if (blankRequired.length) {
    return { ok: false, error: "missing_required_facts", detail: blankRequired.map((t) => ({ token: t })) };
  }

  // Unknown-token pre-scan across the donor (manifest included: manifest prose
  // must not carry literal double-brace examples — the coverage test scans it).
  const unknown = new Set();
  for (const [rel, buf] of Object.entries(donorFiles)) {
    if (!isTextFile(rel) && !MANIFEST_FILES.has(rel)) continue;
    for (const t of unknownTokensIn(buf.toString("utf8"))) unknown.add(`${rel}:${t}`);
  }
  if (unknown.size) {
    return { ok: false, error: "unmapped_token", detail: [...unknown].slice(0, 20) };
  }

  const isBlankToken = (t) => !String(tokenValues[t] ?? "").trim();
  const files = {};
  let collapsedCount = 0;
  let phraseFiles = 0;
  const unguarded = [];

  for (const [rel, buf] of Object.entries(donorFiles)) {
    if (MANIFEST_FILES.has(rel) || rel.endsWith(".PLACEHOLDER")) continue;
    let out = buf;
    if (isTextFile(rel)) {
      let s = buf.toString("utf8");
      if (extOf(rel) === ".html" || extOf(rel) === ".svg") {
        const before = s.length;
        s = removeCollapsedElements(s, isBlankToken);
        if (s.length !== before) collapsedCount++;
      }
      // PHRASE collapse runs on EVERY text file, not just markup: on a compiled
      // donor the sentence "Call {{OWNER_NAME}} for a free estimate." lives in a
      // minified .js template literal where there is no element to collapse.
      if (s.includes("[[NEED:") || s.includes("[[/NEED]]")) {
        const before = s.length;
        try {
          s = collapsePhrases(s, isBlankToken);
        } catch (e) {
          return { ok: false, error: "phrase_marker_malformed", detail: [{ file: rel, reason: String(e.message || e) }] };
        }
        if (s.length !== before) phraseFiles++;
      }
      // Whatever optional slot is still standing here WILL render. If literal
      // copy is welded to it, the customer gets "and ask for  to start".
      if (unguarded.length < 40) {
        for (const hit of unguardedSlots(s, { isBlankToken, tokens: OPTIONAL_TOKENS })) {
          unguarded.push({ file: rel, ...hit });
        }
      }
      for (const token of ALLOWED_TOKENS) {
        const needle = `{{${token}}}`;
        if (s.includes(needle)) s = s.split(needle).join(String(tokenValues[token] ?? ""));
      }
      // URL + tel: contracts, enforced on the emitted bytes (see the block
      // comments above). Runs after substitution so a donor's own "…//{{URL}}/"
      // composition cannot survive, and before the parse gate so a malformed
      // result still fails the build instead of shipping.
      s = normalizeHydratedUrls(s);
      s = normalizeHydratedTelHrefs(s);
      out = Buffer.from(s, "utf8");
    }
    files[rel] = out;
  }

  // Fail CLOSED. A blank is the correct value; broken prose around it is not.
  if (unguarded.length) {
    return {
      ok: false,
      error: "unguarded_optional_slot",
      detail: unguarded.slice(0, 12).map((h) => ({ file: h.file, token: h.token, excerpt: h.excerpt })),
    };
  }

  // Marker residue means some file never went through the collapse pass.
  const markerResidue = [];
  for (const [rel, buf] of Object.entries(files)) {
    if (!isTextFile(rel)) continue;
    if (PHRASE_RESIDUE_RE.test(buf.toString("utf8"))) markerResidue.push(rel);
  }
  if (markerResidue.length) {
    return { ok: false, error: "unresolved_phrase_marker", detail: markerResidue.slice(0, 10) };
  }

  // Zero raw tokens in any hydrated file (acceptance test 6). With the
  // pre-scan above this cannot fire — it stays as the fail-closed backstop.
  const leftover = [];
  for (const [rel, buf] of Object.entries(files)) {
    if (!isTextFile(rel)) continue;
    const m = buf.toString("utf8").match(TOKEN_RE);
    if (m) leftover.push(`${rel}: ${m[0]}`);
  }
  if (leftover.length) {
    return { ok: false, error: "unhydrated_tokens", detail: leftover.slice(0, 10) };
  }

  // Post-hydration parse gate (acceptance test 9).
  const parseFailures = parseGate(files);
  if (parseFailures.length) {
    return { ok: false, error: "hydration_parse_failed", detail: parseFailures };
  }

  return {
    ok: true,
    files,
    report: {
      file_count: Object.keys(files).length,
      collapsed_blocks: collapsedCount,
      collapsed_phrase_files: phraseFiles,
      parse_gate: "passed",
    },
  };
}

module.exports = { hydrate, removeCollapsedElements, parseGate, normalizeHydratedUrls, normalizeTelHrefValue, normalizeHydratedTelHrefs };
