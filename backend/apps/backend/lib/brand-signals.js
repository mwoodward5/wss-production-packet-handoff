"use strict";
// lib/brand-signals.js — DATA-DRIVEN third-party-mark detection.
//
// WHY THIS IS A CSV AND NOT A REGEX IN THE SOURCE.
//
// A hardcoded THIRD_PARTY_RE was shipped on 2026-08-06 after two live mirrors
// served Mastercool's and Google Blogger's marks as the client's identity. It
// caught those two and nothing else: the very next mine produced 17 leads of
// which 3 still carried someone else's mark — a Google Reviews badge, a partner
// carousel slide, and a national publisher's logo. None of their filenames
// contained a denylisted token, because none of their filenames named anything.
//
// So the list lives in data, where it can be extended from research without
// touching code, and — critically — where every entry can be VALIDATED against
// the client logos we already know are correct before it is allowed to load.
//
// TWO RULES THIS FILE ENFORCES, both learned the hard way:
//
// 1. A NEGATIVE SIGNAL IS EVIDENCE, NOT A VERDICT. Signal strength differs by
//    kind. An embed script or a vendor's own CDN host is conclusive — nothing
//    else serves from yelpcdn.com. Alt text naming a platform is strong. A
//    FILENAME is weak, because a filename is a guess about a string, and a
//    business may legitimately be called Carrier Plumbing or Goodman & Sons.
//    Callers get a weight, and a POSITIVE declaration by the page (a
//    class="custom-logo", an alt matching the business name) must be allowed to
//    outrank a filename hunch.
//
// 2. THE PATTERNS ARE NOT TRUSTED UNTIL THEY ARE TESTED. Research-sourced
//    regexes arrive in PCRE/Python dialect: every row of the source data began
//    with an inline `(?i)` flag, which JavaScript's RegExp does not support and
//    which throws on compile. compileSignals() strips dialect artefacts, and
//    test/brand-signals.test.js refuses any pattern that matches a logo we have
//    verified belongs to its client.

const fs = require("node:fs");
const path = require("node:path");

const CSV_PATH = path.join(__dirname, "brand-signals.negative.csv");

// How much each kind of evidence is worth. Only the conclusive kinds may refuse
// a logo on their own; the rest accumulate and are weighed against the page's
// own positive declarations.
const WEIGHT = Object.freeze({
  EMBED_SCRIPT: 100,     // the vendor's own widget loader — conclusive
  IMAGE_HOST: 100,       // served from the vendor's CDN — conclusive
  ALT_TEXT: 70,          // the page states what the image is
  CONTAINER_CLASS: 50,   // the wrapper states what the block is
  CAROUSEL_MARKER: 45,   // partner/manufacturer strips live in sliders
  FILENAME_PATTERN: 25,  // weakest: a guess about a string
});

/** Anything at or above this refuses the candidate outright. */
const CONCLUSIVE = 100;

/**
 * PCRE/Python -> JavaScript. Research output is not written for our engine.
 *
 * - `(?i)` inline flags are a parse error in JS; we lift them to the `i` flag,
 *   which every pattern here wants anyway.
 * - A trailing `$` after an extension group breaks on cache-busting query
 *   strings (`logo.svg?v=3`), so the anchor is dropped rather than silently
 *   failing to match.
 */
function toJsPattern(raw) {
  let src = String(raw || "").trim();
  let ignoreCase = false;
  src = src.replace(/^\(\?([a-z]+)\)/, (_m, flags) => {
    ignoreCase = flags.includes("i");
    return "";
  });
  return { source: src, flags: ignoreCase ? "i" : "i" };
}

/** Minimal RFC4180 reader — quoted fields may contain commas and quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 && r.some((f) => f.trim()));
}

/**
 * Load and compile the signal table.
 * -> [{ provider, type, weight, re, confidence, notes }]
 * A pattern that will not compile is DROPPED and reported, never thrown — one
 * bad research row must not take the miner down.
 */
function loadSignals({ csvPath = CSV_PATH } = {}) {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (r, name) => r[header.indexOf(name)] || "";
  const signals = [];
  const rejected = [];
  for (const r of rows) {
    const type = col(r, "detection_type").trim().toUpperCase();
    const raw = col(r, "pattern").trim();
    if (!raw || !WEIGHT[type]) { rejected.push({ raw, reason: `unknown detection_type "${type}"` }); continue; }
    const { source, flags } = toJsPattern(raw);
    let re;
    try { re = new RegExp(source, flags); }
    catch (e) { rejected.push({ raw, reason: `will not compile: ${e.message}` }); continue; }
    signals.push({
      provider: col(r, "provider").trim(),
      type,
      weight: WEIGHT[type],
      re,
      confidence: col(r, "confidence").trim().toUpperCase(),
      notes: col(r, "notes").trim(),
    });
  }
  return { signals, rejected };
}

let CACHE = null;
const signals = () => (CACHE || (CACHE = loadSignals())).signals;

/**
 * Weigh one logo candidate against the table.
 *
 * `candidate` is what we know about the image from the page:
 *   { url, alt, className, containerClass, scriptSrcs }
 *
 * -> { refuse: boolean, score, hits: [{provider, type, weight}] }
 *
 * `refuse` is true only on CONCLUSIVE evidence — a vendor CDN or the vendor's
 * own embed script. Everything else returns a score for the ranker to weigh
 * against the page's positive declarations, because a business named after a
 * fixture brand is a lead we would rather keep than lose to a filename.
 */
function weighCandidate(candidate = {}) {
  const url = String(candidate.url || "");
  let file = url;
  try { file = decodeURIComponent(new URL(url, "https://x.invalid").pathname.split("/").pop() || url); } catch { /* keep raw */ }
  const alt = String(candidate.alt || "");
  const classes = `${candidate.className || ""} ${candidate.containerClass || ""}`;
  const scripts = Array.isArray(candidate.scriptSrcs) ? candidate.scriptSrcs.join(" ") : "";

  const hits = [];
  for (const s of signals()) {
    const subject =
      s.type === "FILENAME_PATTERN" ? file
      : s.type === "ALT_TEXT" ? alt
      : s.type === "IMAGE_HOST" ? url
      : s.type === "EMBED_SCRIPT" ? scripts
      : classes;
    if (subject && s.re.test(subject)) hits.push({ provider: s.provider, type: s.type, weight: s.weight });
  }
  const score = hits.reduce((n, h) => n + h.weight, 0);
  return { refuse: hits.some((h) => h.weight >= CONCLUSIVE), score, hits };
}

module.exports = { loadSignals, weighCandidate, toJsPattern, parseCsv, WEIGHT, CONCLUSIVE, CSV_PATH };
