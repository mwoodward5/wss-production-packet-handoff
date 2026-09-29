#!/usr/bin/env node
"use strict";

// scripts/a11y-check.js — THE ACCESSIBILITY GATE (`npm run test:a11y`).
//
// Runs the static a11y rules (lib/mirror-engine/a11y-audit.js) over generated
// pages: missing alt attributes, empty links, unlabeled form controls, the
// page language, and heading order. No browser, no DOM library, no npm
// dependencies — the rules are attribute-and-structure checks decidable from
// the rendered HTML string itself (the "axe's static rules on HTML strings"
// lane; the repo's chromium permit pattern is deliberately NOT needed here).
//
// Usage (from apps/backend):
//   node scripts/a11y-check.js --file dist/index.html dist/faq.html
//   node scripts/a11y-check.js --dir dist
//   node scripts/a11y-check.js --url https://site.example/
//   node scripts/a11y-check.js                (no args: SELF-TEST — seeds a
//                             violation of every serious rule and proves the
//                             auditor catches each one and passes a clean page)
//   --strict   moderate findings (heading order) also fail
//   --json     machine-readable report
//
// Exit codes: 0 = clean (or self-test passed), 1 = serious violations
// (moderate under --strict), 2 = usage/IO error.

const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { auditHtml } = require("../lib/mirror-engine/a11y-audit");

function usage() {
  console.log(`a11y-check.js — static accessibility gate (no browser needed)

Serious rules (always fail): html-lang, img-alt, link-empty, input-label
Moderate rules (fail with --strict): heading-order

Usage:
  node scripts/a11y-check.js --file a.html b.html [--dir dist] [--url https://x/] [--strict] [--json]
  node scripts/a11y-check.js                # no args: built-in self-test
`);
}

// ---------------------------------------------------------------------------
// SELF-TEST — the gate proves its own teeth. A clean document must pass; a
// document seeded with one violation per serious rule must be caught per
// rule; the polish-side repair (fleet-polish.js) is exercised in
// test/a11y-schema-gates.test.js, not here.
// ---------------------------------------------------------------------------
function selfTest() {
  const clean = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Self test — clean</title></head>
<body>
<a class="wss-skip-link" href="#wss-main">Skip to main content</a>
<main id="wss-main">
  <h1>Self test</h1>
  <img src="/assets/photo-roof-replacement.jpg" alt="Smith Roofing — roof replacement in Naples, FL">
  <a href="/services">Our services</a>
  <form>
    <label for="phone">Phone number</label>
    <input type="tel" id="phone" name="phone">
    <input type="email" name="email" aria-label="Email address">
  </form>
  <h2>Details</h2>
</main>
</body>
</html>`;

  const dirty = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Self test — dirty</title></head>
<body>
<main>
  <h1>Self test</h1>
  <img src="/assets/photo.jpg">
  <a href="https://facebook.com/example"></a>
  <form>
    <input type="tel" name="phone">
  </form>
  <h3>Skipped a level</h3>
</main>
</body>
</html>`;

  const failures = [];
  const cleanReport = auditHtml(clean);
  if (!cleanReport.ok || cleanReport.violations.length) {
    failures.push(`clean document flagged: ${JSON.stringify(cleanReport.violations)}`);
  }
  const dirtyReport = auditHtml(dirty);
  for (const rule of ["html-lang", "img-alt", "link-empty", "input-label"]) {
    const hit = dirtyReport.violations.some((v) => v.rule === rule);
    if (!hit) failures.push(`seeded ${rule} violation was NOT caught`);
  }
  const headingHit = dirtyReport.violations.find((v) => v.rule === "heading-order");
  if (!headingHit) failures.push("seeded heading-order violation was NOT caught");
  else if (headingHit.severity !== "moderate") failures.push("heading-order should be moderate");

  if (failures.length) {
    console.log("a11y-check self-test FAILED:");
    for (const f of failures) console.log(`  - ${f}`);
    console.log(`dirty report: ${JSON.stringify(dirtyReport.violations, null, 2)}`);
    return 1;
  }
  console.log("a11y-check self-test OK: every serious rule caught its seeded violation; clean page passed.");
  return 0;
}

function listHtmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listHtmlFiles(full));
    else if (/\.x?html?$/i.test(entry)) out.push(full);
  }
  return out.sort();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "wss-a11y-checker/1.0" } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { text: await res.text() };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? "timed out after 20s" : String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

async function main(argv) {
  const files = [];
  const dirs = [];
  const urls = [];
  let strict = false;
  let asJson = false;
  let sawFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { usage(); return 0; }
    else if (a === "--selftest") { return selfTest(); }
    else if (a === "--file") { sawFlag = true; for (i += 1; i < argv.length && !argv[i].startsWith("--"); i += 1) files.push(argv[i]); i -= 1; }
    else if (a === "--dir") { sawFlag = true; for (i += 1; i < argv.length && !argv[i].startsWith("--"); i += 1) dirs.push(argv[i]); i -= 1; }
    else if (a === "--url") { sawFlag = true; for (i += 1; i < argv.length && !argv[i].startsWith("--"); i += 1) urls.push(argv[i]); i -= 1; }
    else if (a === "--strict") { strict = true; }
    else if (a === "--json") { asJson = true; }
    else {
      console.error(`a11y-check: unknown argument "${a}" (--help for usage)`);
      return 2;
    }
  }

  if (!sawFlag) return selfTest();

  const pages = [];
  for (const f of files) pages.push({ label: f, kind: "file", path: f });
  for (const d of dirs) {
    try {
      for (const f of listHtmlFiles(d)) pages.push({ label: f, kind: "file", path: f });
    } catch (e) {
      console.error(`a11y-check: cannot read dir ${d}: ${e && e.message ? e.message : e}`);
      return 2;
    }
  }
  for (const u of urls) pages.push({ label: u, kind: "url", path: u });
  if (!pages.length) {
    console.error("a11y-check: no pages to audit");
    return 2;
  }

  const reports = [];
  for (const page of pages) {
    if (page.kind === "file") {
      let html;
      try {
        html = readFileSync(page.path, "utf8");
      } catch (e) {
        console.error(`a11y-check: cannot read ${page.path}: ${e && e.message ? e.message : e}`);
        return 2;
      }
      reports.push({ label: page.label, ...auditHtml(html) });
    } else {
      const res = await fetchText(page.path);
      if (res.error) {
        reports.push({ label: page.label, violations: [{ rule: "fetch", severity: "serious", message: res.error }], serious: 1, moderate: 0, ok: false });
        continue;
      }
      reports.push({ label: page.label, ...auditHtml(res.text) });
    }
  }

  const failing = (r) => r.violations.filter((v) => v.severity === "serious" || (strict && v.severity === "moderate"));
  const failed = reports.filter((r) => failing(r).length);
  const total = reports.reduce((n, r) => n + r.violations.length, 0);

  if (asJson) {
    console.log(JSON.stringify({ ok: failed.length === 0, pages: reports.length, invalid: failed.length, findings: total, strict, reports }, null, 2));
  } else {
    for (const r of reports) {
      if (!r.violations.length) {
        console.log(`OK    ${r.label}`);
        continue;
      }
      const status = failing(r).length ? "FAIL" : "WARN";
      console.log(`${status}  ${r.label}`);
      for (const v of r.violations) console.log(`        [${v.severity}] ${v.rule}: ${v.message}`);
    }
    console.log(`\n${reports.length - failed.length}/${reports.length} page(s) clean, ${total} finding(s)${strict ? " (--strict)" : ""}`);
  }
  return failed.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    console.error(`a11y-check: ${e && e.stack ? e.stack : e}`);
    process.exit(2);
  });
}

module.exports = { selfTest };
