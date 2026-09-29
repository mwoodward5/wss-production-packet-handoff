"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// REGRESSION LOCK (2026-07-28).
//
// hydrateBoilerplate() substitutes EVERY key of its `tokens` map, even when the
// value is "". So a token that is present in a boilerplate but ABSENT from that
// map is the only way a literal "{{SOMETHING}}" can reach a customer's page.
//
// A sweep of 69 live previews found raw tokens rendering on 54 of them —
// "Serving {{COUNTY}}", "{{RATING}} · {{REVIEW_COUNT}} Google reviews",
// "FILE · TUCSON, WA / {{COUNTY}}". Thirteen tokens were used by boilerplates
// and never mapped. A prospect who sees that never pays.
//
// This test fails the moment a boilerplate introduces a token the hydrator does
// not know about — which is exactly when it is cheap to fix.

const backendRoot = path.join(__dirname, "..");
const TOKEN_RE = /\{\{[A-Z_]+\}\}/g;
const HYDRATED_EXT = /\.(html|js|css|json|txt|svg|xml|webmanifest)$/i;

function mappedTokens() {
  const src = fs.readFileSync(path.join(backendRoot, "lib", "forge.js"), "utf8");
  // Keys of the `tokens` object literal: "{{NAME}}": …
  return new Set([...src.matchAll(/"(\{\{[A-Z_]+\}\})"\s*:/g)].map((m) => m[1]));
}

function boilerplateTokens() {
  const root = path.join(backendRoot, "boilerplates");
  const used = new Map(); // token -> first file that uses it
  if (!fs.existsSync(root)) return used;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!HYDRATED_EXT.test(entry.name)) continue;
      let text = "";
      try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
      for (const m of text.matchAll(TOKEN_RE)) {
        if (!used.has(m[0])) used.set(m[0], path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return used;
}

test("every token used by a boilerplate is mapped by the hydrator", () => {
  const mapped = mappedTokens();
  const used = boilerplateTokens();
  assert.ok(used.size > 0, "expected boilerplates to contain tokens");

  const unmapped = [...used.entries()].filter(([token]) => !mapped.has(token));
  assert.deepEqual(
    unmapped.map(([t, f]) => `${t} (used in ${f})`),
    [],
    "these tokens would ship to a customer as literal text — add them to the tokens map in lib/forge.js",
  );
});

test("the hydrator substitutes blanks rather than leaving a raw token", () => {
  const src = fs.readFileSync(path.join(backendRoot, "lib", "forge.js"), "utf8");
  // Every mapped value must fall back to a string, so a missing fact renders as
  // "" (collapsing the element) instead of the literal token.
  assert.match(
    src,
    /for \(const \[tok, val\] of Object\.entries\(tokens\)\) s = s\.split\(tok\)\.join\(val\)/,
    "substitution must cover the whole token map",
  );
});

test("review fields stay optional so nothing is ever invented", () => {
  const src = fs.readFileSync(path.join(backendRoot, "lib", "forge.js"), "utf8");
  // TRUTH LAW: a missing rating/quote/author must blank out, never be filled with
  // a plausible guess. That is how "A. Client" fake testimonials shipped before.
  for (const token of ["{{RATING}}", "{{REVIEW_COUNT}}", "{{REVIEW_TEXT}}", "{{REVIEW_AUTHOR}}"]) {
    assert.ok(
      new RegExp(`OPTIONAL_TOKENS[\\s\\S]*${token.replace(/[{}]/g, "\\$&")}`).test(src),
      `${token} must be optional — a build must not hard-fail on it, and it must never be invented`,
    );
  }
});
