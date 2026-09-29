#!/usr/bin/env node
/**
 * Crawls every route on the local dev server, extracts every
 * <script type="application/ld+json"> block, JSON.parse()s it,
 * and checks for the required structured-data types and properties
 * that Google Rich Results validates.
 *
 * Usage: node scripts/schema-audit.mjs [base-url]
 *   default base-url: http://localhost:8080
 */


const BASE = process.argv[2] || "http://localhost:8080";

const pages = [
  { path: "/",              expect: ["LocalBusiness", "WebSite"] },
  { path: "/about",         expect: ["LocalBusiness", "BreadcrumbList"] },
  { path: "/services",      expect: ["LocalBusiness", "BreadcrumbList"] },
  { path: "/services/kitchen-remodeling",  expect: ["LocalBusiness", "Service", "BreadcrumbList", "FAQPage"] },
  { path: "/services/basement-remodeling", expect: ["LocalBusiness", "Service", "BreadcrumbList", "FAQPage"] },
  { path: "/services/decks-porches",       expect: ["LocalBusiness", "Service", "BreadcrumbList", "FAQPage"] },
  { path: "/services/home-additions",      expect: ["LocalBusiness", "Service", "BreadcrumbList", "FAQPage"] },
  { path: "/services/custom-greenhouses",  expect: ["LocalBusiness", "Service", "BreadcrumbList", "FAQPage"] },
  { path: "/services/general-contracting", expect: ["LocalBusiness", "Service", "BreadcrumbList", "FAQPage"] },
  { path: "/service-area",  expect: ["LocalBusiness", "BreadcrumbList", "FAQPage"] },
  { path: "/reviews",       expect: ["LocalBusiness", "BreadcrumbList", "Review", "AggregateRating"] },
  { path: "/contact",       expect: ["LocalBusiness", "BreadcrumbList", "ContactPage"] },
  { path: "/faq",           expect: ["LocalBusiness", "BreadcrumbList", "FAQPage"] },
  { path: "/gallery",       expect: ["LocalBusiness", "BreadcrumbList"] },
];

const RESET = "\x1b[0m", RED = "\x1b[31m", GRN = "\x1b[32m", YEL = "\x1b[33m", DIM = "\x1b[2m", BLD = "\x1b[1m", CYN = "\x1b[36m";

let warnings = 0, failures = 0;
function fail(msg) { failures++; console.log(`  ${RED}✗${RESET} ${msg}`); }
function warn(msg) { warnings++; console.log(`  ${YEL}!${RESET} ${msg}`); }
function ok(msg)   { console.log(`  ${GRN}✓${RESET} ${msg}`); }

/** Walk a JSON-LD value and yield every node that has an @type. */
function* walkTypes(v) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) yield* walkTypes(x); return; }
  if (v["@type"]) {
    const types = Array.isArray(v["@type"]) ? v["@type"] : [v["@type"]];
    for (const t of types) yield { type: t, node: v };
  }
  if (Array.isArray(v["@graph"])) for (const g of v["@graph"]) yield* walkTypes(g);
  for (const k of Object.keys(v)) {
    if (k === "@graph" || k === "@type") continue;
    yield* walkTypes(v[k]);
  }
}

function extractBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    try { blocks.push(JSON.parse(raw)); }
    catch (e) { fail(`JSON.parse failed: ${e.message}\n     payload starts: ${raw.slice(0, 120)}…`); }
  }
  return blocks;
}

function validateLocalBusiness(node) {
  // Skip back-reference nodes: any node referencing the canonical LocalBusiness
  // by @id without redeclaring the full body (e.g. provider: { "@id": "...#localbusiness" }
  // inside Service / ServiceArea / Reviews / Contact graphs).
  if (node["@id"] && /#localbusiness$/.test(node["@id"]) && !node.address) return;
  // Also skip minimal provider-style references that only carry name/telephone/address.
  if (!node.description && !node.openingHoursSpecification && !node.aggregateRating && !node.makesOffer) return;
  const required = ["name", "address", "telephone", "areaServed"];
  for (const k of required) if (!node[k]) fail(`LocalBusiness missing "${k}"`);
  if (node.address && (!node.address.addressLocality || !node.address.postalCode))
    fail(`LocalBusiness.address missing locality/postalCode`);
  if (node.geo && (typeof node.geo.latitude !== "number" || typeof node.geo.longitude !== "number"))
    fail(`LocalBusiness.geo lat/lng must be numbers`);
  if (node.priceRange && !/^\$+$/.test(node.priceRange) && !/^\$+\s*-\s*\$+$/.test(node.priceRange))
    warn(`priceRange "${node.priceRange}" is non-standard (Google prefers "$", "$$", "$$$", or "$$ - $$$")`);
  if (node.aggregateRating) {
    const ar = node.aggregateRating;
    if (!ar.ratingValue || !ar.reviewCount) fail(`AggregateRating missing ratingValue/reviewCount`);
  }
}

function validateService(node) {
  // Skip nested mini-Service references inside Offer.itemOffered (no url/no @id).
  if (!node.url && !node["@id"]) return;
  for (const k of ["name", "provider", "areaServed", "serviceType"])
    if (!node[k]) fail(`Service missing "${k}"`);
  if (node.provider && !node.provider["@id"] && !node.provider.name)
    fail(`Service.provider needs @id or name`);
}

function validateBreadcrumb(node) {
  if (!Array.isArray(node.itemListElement) || node.itemListElement.length < 2)
    fail(`BreadcrumbList must have at least 2 itemListElement entries`);
  let lastPos = 0;
  for (const item of node.itemListElement || []) {
    if (item["@type"] !== "ListItem") fail(`Breadcrumb element @type must be ListItem`);
    if (typeof item.position !== "number" || item.position !== lastPos + 1)
      fail(`Breadcrumb position must be sequential starting at 1 (got ${item.position}, expected ${lastPos + 1})`);
    lastPos = item.position;
    if (!item.name) fail(`Breadcrumb item missing name`);
  }
  // Last item should NOT have item URL OR may have one. Both legal. (Google rich-results allows either.)
}

function validateFAQ(node) {
  if (!Array.isArray(node.mainEntity) || node.mainEntity.length === 0)
    fail(`FAQPage.mainEntity must be a non-empty array`);
  for (const q of node.mainEntity || []) {
    if (q["@type"] !== "Question") fail(`FAQ entry @type must be Question`);
    if (!q.name) fail(`FAQ Question missing name`);
    if (!q.acceptedAnswer || q.acceptedAnswer["@type"] !== "Answer" || !q.acceptedAnswer.text)
      fail(`FAQ Question.acceptedAnswer missing text`);
  }
}

function validateReview(node) {
  if (!node.author || !node.author.name) fail(`Review missing author.name`);
  if (!node.reviewRating || !node.reviewRating.ratingValue) fail(`Review missing reviewRating.ratingValue`);
  if (!node.reviewBody && !node.description) warn(`Review missing reviewBody (allowed but discouraged)`);
}

function validateContactPage(node) {
  if (!node.url) fail(`ContactPage missing url`);
  if (!node.mainEntity) warn(`ContactPage missing mainEntity (recommended)`);
}

function validateNode(type, node) {
  if (/LocalBusiness|GeneralContractor|HomeAndConstructionBusiness/.test(type)) validateLocalBusiness(node);
  if (type === "Service") validateService(node);
  if (type === "BreadcrumbList") validateBreadcrumb(node);
  if (type === "FAQPage") validateFAQ(node);
  if (type === "Review") validateReview(node);
  if (type === "ContactPage") validateContactPage(node);
}

async function auditPage({ path, expect }) {
  console.log(`\n${BLD}${CYN}— ${path}${RESET}`);
  let res;
  try { res = await fetch(`${BASE}${path}`); }
  catch (e) { fail(`Fetch failed: ${e.message}`); return; }
  if (!res.ok) { fail(`HTTP ${res.status}`); return; }
  const html = await res.text();
  const blocks = extractBlocks(html);
  if (blocks.length === 0) { fail(`No JSON-LD blocks found`); return; }
  ok(`${blocks.length} JSON-LD block(s) parsed`);

  // Collect all types present across all blocks (incl. @graph)
  const seenTypes = new Set();
  for (const b of blocks) {
    for (const { type, node } of walkTypes(b)) {
      seenTypes.add(type);
      validateNode(type, node);
    }
  }

  for (const t of expect) {
    // LocalBusiness matches our umbrella type set
    const matches = t === "LocalBusiness"
      ? [...seenTypes].some((x) => /LocalBusiness|GeneralContractor|HomeAndConstructionBusiness/.test(x))
      : seenTypes.has(t);
    if (matches) ok(`${t} present`);
    else fail(`${t} missing (saw: ${[...seenTypes].join(", ") || "—"})`);
  }
}

(async () => {
  console.log(`${BLD}Schema audit · ${BASE}${RESET}`);
  for (const p of pages) await auditPage(p);
  console.log(
    `\n${BLD}Summary${RESET}  ${YEL}${warnings} warnings${RESET}  ${RED}${failures} failures${RESET}`,
  );
  if (failures > 0) {
    console.log(`${RED}${BLD}Schema audit FAILED.${RESET}`);
    process.exit(1);
  }
  console.log(`${GRN}${BLD}Schema audit clean.${RESET}`);
})();
