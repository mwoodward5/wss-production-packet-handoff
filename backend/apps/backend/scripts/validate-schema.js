#!/usr/bin/env node
"use strict";

// scripts/validate-schema.js — THE JSON-LD GATE.
//
// Validates the structured data on every page of a built mirror (or any
// HTML you point it at): the required types are present, the required
// fields carry real values, and none of the defect classes the 2026-09-02
// fleet audits actually shipped survives — the scraper-artifact email
// ("frame-…@mhtml.blink") that reached Google through a FAQPage graph, the
// empty string that published as a fact, the double-slash URL that 404s a
// crawler's follow.
//
// Usage (from apps/backend):
//   node scripts/validate-schema.js --file dist/index.html dist/faq.html
//   node scripts/validate-schema.js --dir dist
//   node scripts/validate-schema.js --url https://site.example/ https://site.example/faq
//   node scripts/validate-schema.js --file page.html --strict   (also fail when a
//                            page carries schema but no LocalBusiness-class node)
//
// Exit codes: 0 = every page valid, 1 = at least one violation,
// 2 = usage/IO error (unknown flag, unreadable file, failed fetch).
//
// Wire: package.json "validate:schema". Zero npm dependencies (--url uses
// Node 22 global fetch); the artifact denylist is shared with the facts
// boundary via lib/mirror-engine/facts.js isScraperArtifactEmail.

const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

let factsLib = null;
try {
  factsLib = require("../lib/mirror-engine/facts");
} catch {
  factsLib = null; // the script must run even from a stripped checkout
}

// ---------------------------------------------------------------------------
// The recognized vocabulary
// ---------------------------------------------------------------------------

// LocalBusiness and its common subtypes — the business node every mirror
// home page must carry. Matched as a @type MEMBER (the engine emits
// ["LocalBusiness", "RoofingContractor"], arrays count).
const BUSINESS_TYPES = new Set([
  "LocalBusiness",
  "HomeAndConstructionBusiness",
  "RoofingContractor",
  "Plumber",
  "HVACBusiness",
  "Electrician",
  "LandscapingBusiness",
  "GeneralContractor",
  "HousePainter",
  "Locksmith",
  "MovingCompany",
  "AutoRepair",
  "Store",
  "Restaurant",
  "ProfessionalService",
  "LegalService",
  "MedicalBusiness",
  "Dentist",
  "RealEstateAgent",
]);

// Page-specific types a legitimate non-home page may lead with. Only
// consulted under --strict, where a page that has schema but NO business
// node is asked about.
const PAGE_TYPES = new Set([
  "Service", "FAQPage", "WebPage", "WebSite", "Organization",
  "BreadcrumbList", "Place", "Product", "Article", "BlogPosting",
  "Review", "Event", "VideoObject", "ImageObject", "HowTo", "Person",
  "Offer", "ItemList", "ContactPage", "AboutPage",
]);

// The business node's required fields. Optional means may be absent; a
// PRESENT-but-empty value is always a violation (caught by the global
// empty-string walk too — these checks name the field so the fix is obvious).
const BUSINESS_REQUIRED_FIELDS = ["name", "telephone", "url", "address"];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Pull every JSON-LD script body out of an HTML document. */
function extractJsonLdBodies(html) {
  const bodies = [];
  for (const m of String(html || "").matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    bodies.push(m[1]);
  }
  return bodies;
}

/** Parse the bodies into a flat node list (@graph flattened, arrays flattened). */
function parseJsonLdNodes(bodies, parseErrors) {
  const nodes = [];
  for (let i = 0; i < bodies.length; i += 1) {
    let parsed;
    try {
      parsed = JSON.parse(bodies[i]);
    } catch (e) {
      parseErrors.push(`script #${i + 1} is not valid JSON: ${e && e.message ? e.message : "parse error"}`);
      continue;
    }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (!node || typeof node !== "object") continue;
      nodes.push(node);
      if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
    }
  }
  return nodes;
}

function nodeTypes(node) {
  const t = node && node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string");
  return [];
}

function nodePath(node, field) {
  const types = nodeTypes(node).join("|") || "node";
  return field ? `${types}.${field}` : types;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Walk every string in the value tree; report via `on(path, value)`. */
function walkStrings(value, on, path = "$") {
  if (typeof value === "string") on(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, on, `${path}[${i}]`));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkStrings(v, on, `${path}.${k}`);
  }
}

/** True for a URL-shaped string (what the URL checks are entitled to judge). */
function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * URL checks — the double-slash class the audits shipped:
 *   https://site.example//page   (host-adjacent double slash — a path that
 *                                 404s or, on some hosts, a different route)
 *   https:///site.example        (empty authority — host is gone)
 *   https:/site.example          (malformed separator)
 * Applied to every http(s) string in the graph, not just .url fields: a bad
 * URL in image/sameAs/hasMap is the same dead end for a crawler.
 */
function checkUrl(u, violations) {
  // "https:///host" — the separator collapsed (three+ slashes after the
  // scheme); the authority is gone before the URL parser ever sees it.
  if (/^https?:\/{3,}/i.test(u)) {
    violations.push({ code: "url_malformed_separator", detail: u.slice(0, 120) });
    return;
  }
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    violations.push({ code: "url_unparseable", detail: u.slice(0, 120) });
    return;
  }
  if (!parsed.hostname) {
    violations.push({ code: "url_no_host", detail: u.slice(0, 120) });
    return;
  }
  if (/\/\//.test(parsed.pathname)) {
    // Host-adjacent "//page" or a doubled segment deeper in the path — the
    // same artifact class, named the same, so one fix pass removes it.
    violations.push({ code: "url_double_slash", detail: u.slice(0, 120) });
  }
}

/**
 * Validate one page's parsed nodes.
 * Returns violations[] of {code, detail}.
 */
function validateNodes({ nodes, parseErrors, hasScript, strict }) {
  const violations = [];
  if (!hasScript) {
    violations.push({ code: "no_json_ld", detail: "no <script type=\"application/ld+json\"> block on the page" });
    return violations;
  }
  for (const err of parseErrors) violations.push({ code: "json_ld_unparseable", detail: err });
  if (!nodes.length) {
    violations.push({ code: "no_schema_nodes", detail: "JSON-LD block(s) parsed to zero nodes" });
    return violations;
  }

  // 1. REQUIRED TYPES — a business node (LocalBusiness or subtype), or, when
  //    absent, at least a page-specific type. Nothing recognizable at all is
  //    a violation.
  const businessNodes = nodes.filter((n) => nodeTypes(n).some((t) => BUSINESS_TYPES.has(t)));
  const pageNodes = nodes.filter((n) => nodeTypes(n).some((t) => PAGE_TYPES.has(t)));
  if (!businessNodes.length && !pageNodes.length) {
    violations.push({
      code: "no_required_type",
      detail: `types found: [${[...new Set(nodes.flatMap((n) => nodeTypes(n)))].join(", ") || "none"}]`,
    });
  }
  if (strict && !businessNodes.length && pageNodes.length) {
    violations.push({
      code: "missing_business_node",
      detail: "--strict: page has schema but no LocalBusiness-class node",
    });
  }

  // 2. REQUIRED FIELDS on the business node — name, telephone, url, address,
  //    non-empty when present.
  for (const biz of businessNodes) {
    for (const field of BUSINESS_REQUIRED_FIELDS) {
      const v = biz[field];
      if (v === undefined || v === null) {
        violations.push({ code: "missing_required_field", detail: `${nodePath(biz, field)}: absent` });
        continue;
      }
      if (typeof v === "string" && !v.trim()) {
        violations.push({ code: "empty_required_field", detail: `${nodePath(biz, field)}: empty string` });
        continue;
      }
      if (typeof v === "object") {
        // address: PostalAddress — needs a locality-bearing component.
        const addr = v;
        const hasComponent = ["streetAddress", "addressLocality", "addressRegion", "postalCode"]
          .some((k) => typeof addr[k] === "string" && addr[k].trim());
        if (!hasComponent) {
          violations.push({ code: "empty_required_field", detail: `${nodePath(biz, field)}: object with no address component` });
        }
      }
    }
  }

  // 3/4/5. Every string in every node: no empty strings, no scraper
  //     artifacts, no malformed URLs.
  const artifactHost = /(?:^|\.)mhtml\.blink$/i;
  const artifactText = /\bframe-[0-9a-f]{6,}@mhtml\.blink\b/i;
  for (const node of nodes) {
    walkStrings(node, (path, value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        violations.push({ code: "empty_string", detail: `${nodePath(node)} at ${path}: empty string` });
        return;
      }
      if (artifactHost.test(trimmed) || artifactText.test(trimmed)
        || (factsLib && typeof factsLib.isScraperArtifactEmail === "function" && factsLib.isScraperArtifactEmail(trimmed))) {
        violations.push({ code: "scraper_artifact", detail: `${nodePath(node)} at ${path}: "${trimmed.slice(0, 80)}"` });
        return;
      }
      if (isHttpUrl(trimmed)) checkUrl(trimmed, violations);
    });
  }

  return violations;
}

/** Validate one HTML document. `label` names it in the report. */
function validateHtml(html, { label = "page", strict = false } = {}) {
  const parseErrors = [];
  const bodies = extractJsonLdBodies(html);
  const nodes = parseJsonLdNodes(bodies, parseErrors);
  const violations = validateNodes({ nodes, parseErrors, hasScript: bodies.length > 0, strict });
  return { label, violations, nodes: nodes.length };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

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
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "wss-schema-validator/1.0" } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { text: await res.text() };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? "timed out after 20s" : String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`validate-schema.js — JSON-LD structured data gate

Checks per page:
  - a JSON-LD block exists and parses
  - required types: a LocalBusiness-class node (LocalBusiness/HVACBusiness/
    Plumber/RoofingContractor/...) or a recognized page-specific type
    (Service/FAQPage/WebSite/...); --strict demands the business node
  - required fields on the business node: name, telephone, url, address
  - no empty strings anywhere in the graph
  - no scraper artifacts (frame-*@mhtml.blink and kin)
  - no malformed URLs (host-adjacent double slashes, empty host)

Usage:
  node scripts/validate-schema.js --file a.html b.html [--dir dist] [--url https://x/] [--strict] [--json]
`);
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
    else if (a === "--file") { sawFlag = true; for (i += 1; i < argv.length && !argv[i].startsWith("--"); i += 1) files.push(argv[i]); i -= 1; }
    else if (a === "--dir") { sawFlag = true; for (i += 1; i < argv.length && !argv[i].startsWith("--"); i += 1) dirs.push(argv[i]); i -= 1; }
    else if (a === "--url") { sawFlag = true; for (i += 1; i < argv.length && !argv[i].startsWith("--"); i += 1) urls.push(argv[i]); i -= 1; }
    else if (a === "--strict") { strict = true; }
    else if (a === "--json") { asJson = true; }
    else {
      console.error(`validate-schema: unknown argument "${a}" (--help for usage)`);
      return 2;
    }
  }
  if (!sawFlag) {
    usage();
    console.error("validate-schema: give at least one --file, --dir or --url");
    return 2;
  }

  const pages = [];
  for (const f of files) pages.push({ label: f, kind: "file", path: f });
  for (const d of dirs) {
    try {
      for (const f of listHtmlFiles(d)) pages.push({ label: f, kind: "file", path: f });
    } catch (e) {
      console.error(`validate-schema: cannot read dir ${d}: ${e && e.message ? e.message : e}`);
      return 2;
    }
  }
  for (const u of urls) pages.push({ label: u, kind: "url", path: u });

  if (!pages.length) {
    console.error("validate-schema: no pages to validate");
    return 2;
  }

  const reports = [];
  let ioError = false;
  for (const page of pages) {
    if (page.kind === "file") {
      let html;
      try {
        html = readFileSync(page.path, "utf8");
      } catch (e) {
        console.error(`validate-schema: cannot read ${page.path}: ${e && e.message ? e.message : e}`);
        ioError = true;
        break;
      }
      reports.push(validateHtml(html, { label: page.label, strict }));
    } else {
      const res = await fetchText(page.path);
      if (res.error) {
        reports.push({ label: page.label, nodes: 0, violations: [{ code: "fetch_failed", detail: res.error }] });
        continue;
      }
      reports.push(validateHtml(res.text, { label: page.label, strict }));
    }
  }
  if (ioError) return 2;

  const failed = reports.filter((r) => r.violations.length);
  const totalViolations = reports.reduce((n, r) => n + r.violations.length, 0);

  if (asJson) {
    console.log(JSON.stringify({
      ok: totalViolations === 0,
      pages: reports.length,
      invalid: failed.length,
      violations: totalViolations,
      reports,
    }, null, 2));
  } else {
    for (const r of reports) {
      if (!r.violations.length) {
        console.log(`OK    ${r.label} (${r.nodes} node${r.nodes === 1 ? "" : "s"})`);
        continue;
      }
      console.log(`FAIL  ${r.label}`);
      for (const v of r.violations) console.log(`        [${v.code}] ${v.detail}`);
    }
    console.log(`\n${reports.length - failed.length}/${reports.length} page(s) valid, ${totalViolations} violation(s)${strict ? " (--strict)" : ""}`);
  }
  return totalViolations ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    console.error(`validate-schema: ${e && e.stack ? e.stack : e}`);
    process.exit(2);
  });
}

module.exports = {
  extractJsonLdBodies,
  parseJsonLdNodes,
  validateHtml,
  validateNodes,
  BUSINESS_TYPES,
  PAGE_TYPES,
  BUSINESS_REQUIRED_FIELDS,
};
