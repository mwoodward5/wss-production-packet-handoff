"use strict";
// lib/seo-grid.js — the "seo-grid" edit kind: a BOUNDED grid of service×town
// pages, built by the same deterministic machinery as the single "seo-page"
// kind in lib/seo-page-edit.js.
//
// WHY A GRID, AND WHY IT IS NOT JUST A LOOP
// The single-page builder refuses to ship a page for a service the business
// does not list, assembles every sentence from the site's own published facts
// (llms.txt + the index.html data-* block), and runs assertNoInventedClaims
// before a byte is uploaded. A grid multiplies that page by services × towns,
// and multiplication multiplies consequences: 25 services × 20 towns "built"
// naively mints 500 near-identical pages in one deploy. So the grid is
// bounded and honest by construction:
//
//   · TOWNS ARE THE BUSINESS'S OWN. They come from the "## Service area"
//     section of llms.txt — the verified service-area list the mirror engine
//     wrote from the business's own claims. A town the business does not list
//     is never guessed into a page.
//   · EVERY PAGE IS THE EXISTING GATE. renderSeoPage renders it and
//     assertNoInventedClaims scans it; where no deep TOPIC_COPY entry exists,
//     the generic template is enriched ONLY with the business's own certified
//     facts (its service list, its published rating, its service area).
//   · THE CAP IS THE LAW. Default 10 pages per run, configurable, hard ceiling
//     25. The un-built remainder is returned as `remaining` (and optionally
//     handed to an `enqueue` callback), so the next run — which skips existing
//     pages first — continues the grid without minting duplicates.
//   · NO ORPHANS. Every page lands in sitemap.xml via insertSitemapEntry and
//     in the homepage primary nav via insertNavLink, with presence — not
//     "wrote it this run" — as the gate, exactly like the single-page kind.
//   · CANONICAL SELF-REFERENCE. Each page's <link rel=canonical> is its own
//     origin+route (renderSeoPage does this), so a grid page can never
//     canonicalise to the homepage or to a sibling.

const { listAll, download, upload } = require("./site-editor");
const { vercelDeploy } = require("./forge");
const {
  parseSiteFacts,
  assertFactsComplete,
  slugify,
  renderSeoPage,
  assertNoInventedClaims,
  insertNavLink,
  insertSitemapEntry,
  verifyLive,
  TOPIC_COPY,
  genericCopy,
  classifySeoGridRequest,
} = require("./seo-page-edit");

const DEFAULT_CAP = 10;
const HARD_CAP = 25;
const DEFAULT_MAX_SERVICES = 12;

const esc = (value) => String(value == null ? "" : value)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------------------
// Towns — read off the site's own published service area
// ---------------------------------------------------------------------------
/**
 * The "## Service area" section of llms.txt, one "- Town" entry per line.
 * Empty when the site publishes no list — the grid then refuses rather than
 * guessing geography.
 */
function parseServiceAreas(llms) {
  const block = String(llms || "").split(/^##\s*Service area\s*$/im)[1] || "";
  return block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

const normPlace = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * -> [{ name, state }] for the published service area, the business's own
 * town excluded (the homepage and the single-page kind already own it).
 * An entry may carry its own state ("Brentwood, CA"); otherwise the site's
 * own state is used — never a guessed one.
 */
function parseTowns({ llms = "", index = "", state = "" } = {}) {
  const facts = parseSiteFacts({ llms, index });
  const siteState = facts.state || state || "";
  const self = new Set([normPlace(facts.city), normPlace(facts.addressCity)].filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const raw of parseServiceAreas(llms)) {
    const m = raw.match(/^(.*?),\s*([A-Za-z]{2})$/);
    const name = (m ? m[1] : raw).trim();
    const st = (m ? m[2] : siteState).toUpperCase();
    if (!name || !st) continue;
    const key = normPlace(name);
    if (!key || seen.has(key) || self.has(key)) continue;
    seen.add(key);
    out.push({ name, state: st });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Copy — the existing table where it exists, the business's own facts where it
// does not
// ---------------------------------------------------------------------------
/**
 * The rating line the site publishes about itself, verbatim ("4.9 from 106
 * reviews"), or "". Quoting the business's own published rating is the archive
 * speaking; inventing one is what the gate refuses.
 */
function publishedRating(llms) {
  const m = String(llms || "").match(/^-\s*Rating:\s*(.+)$/im);
  return m ? m[1].trim() : "";
}

/**
 * The town-grounded enrichment appended to every grid page. Everything in it
 * is a fact the site already publishes: the business's name, that it lists
 * this town in its own service area, where it is based, its published rating.
 * Third person throughout — the claim scanner refuses a page that speaks as
 * the business, and this section is scanned with the rest of the page.
 */
function townGroundedSections({ topic, town, facts, rating }) {
  const based = facts.locatedIn || facts.addressCity || facts.city;
  const parts = [
    `${facts.businessName} lists ${town.name} among the areas it serves${based && normPlace(based) !== normPlace(town.name) ? `, working from ${based}` : ""}. The services named on this page are the business's own published list — this page adds no offer, price or promise to it.`,
  ];
  if (rating) parts.push(`The business's own site publishes a rating of ${rating}.`);
  return [
    {
      h: `${topic} in ${town.name}`,
      p: parts,
    },
  ];
}

/** Deep copy where the topic has one; the generic template otherwise. */
function baseCopyFor(topic) {
  return TOPIC_COPY[topic.toLowerCase()] || genericCopy(topic);
}

/** Deterministic route for a service×town pair, canonical to itself. */
function gridRoute({ service, town }) {
  return `/${slugify(service)}-${slugify(town.name)}-${slugify(town.state)}`;
}

/**
 * planGrid — the pure planner. No I/O, fully testable: given the site's own
 * services and towns it decides what to build THIS run, what to skip and why,
 * and what remains for the next run.
 *
 * Deterministic order: services in the order the business lists them, towns in
 * the order the site publishes them. The cap takes the FIRST N pairs, so run
 * after run walks the grid in the same order and the skip-existing pass makes
 * each run resume exactly where the last stopped.
 */
function planGrid({
  services = [],
  towns = [],
  cap = DEFAULT_CAP,
  existingFiles = new Set(),
  existingLocs = new Set(),
} = {}) {
  const limit = Math.max(0, Math.min(HARD_CAP, Number.isFinite(cap) ? Math.floor(cap) : DEFAULT_CAP));
  const planned = [];
  const skipped = [];
  const seenRoutes = new Set();
  const plannedRoutes = new Set();

  for (const service of services) {
    for (const town of towns) {
      const route = gridRoute({ service, town });
      const rel = `${route.slice(1)}.html`;
      if (seenRoutes.has(route)) {
        skipped.push({ service, town, route, reason: "duplicate route this run" });
        continue;
      }
      seenRoutes.add(route);
      if (existingFiles.has(rel)) {
        skipped.push({ service, town, route, reason: "page already exists" });
        continue;
      }
      if (existingLocs.has(route)) {
        skipped.push({ service, town, route, reason: "already in sitemap" });
        continue;
      }
      if (planned.length >= limit) continue; // past the cap: recorded as remaining, not skipped
      plannedRoutes.add(route);
      planned.push({ service, town, route, rel });
    }
  }

  // remaining = every buildable pair the cap pushed out, in the same
  // deterministic order, so the next run (or the enqueue lane) walks it
  // exactly as this one would have.
  const skippedRoutes = new Set(skipped.map((s) => s.route));
  const remaining = [];
  for (const service of services) {
    for (const town of towns) {
      const route = gridRoute({ service, town });
      if (plannedRoutes.has(route) || skippedRoutes.has(route)) continue;
      remaining.push({ service, town, route });
    }
  }

  return { planned, skipped, remaining, cap: limit };
}

/** Sibling links: same town (other services) and same service (other towns). */
function siblingLinks(pair, index) {
  const out = [];
  for (const other of index) {
    if (other.route === pair.route) continue;
    if (other.town.name === pair.town.name && other.town.state === pair.town.state) {
      out.push({ route: other.route, label: other.service });
    } else if (other.service === pair.service) {
      out.push({ route: other.route, label: `${other.town.name}, ${other.town.state}` });
    }
  }
  return out.slice(0, 8);
}

/** Cross-links into a rendered page, before the Contact block. Internal only. */
function insertSiblingLinks(html, links) {
  if (!links.length || !html.includes("<h2>Contact</h2>")) return html;
  const block = `<h2>More in this service area</h2>\n<ul class="wss-c__areas">${links
    .map((l) => `<li><a href="${esc(l.route)}">${esc(l.label)}</a></li>`)
    .join("")}</ul>`;
  return html.replace("<h2>Contact</h2>", `${block}\n<h2>Contact</h2>`);
}

/** Nav label: a single-service run labels links with the town; otherwise the
 * service is kept so the labels stay distinguishable. */
function navLabelFor({ service, town }, singleService) {
  if (singleService) return town.name;
  const full = `${service} in ${town.name}`;
  if (full.length <= 28) return full;
  return `${service.split(/\s+/)[0]} in ${town.name}`;
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------
/**
 * Build the bounded service×town grid for an archived site, end to end.
 * Returns { kind:"seo-grid", built, skipped, remaining, changedFiles,
 * deployUrl, alias, verified } — and continues cleanly on the next run,
 * because every already-built page is skipped before anything is rendered.
 */
async function runSeoGridEdit({
  siteSlug,
  projectName,
  aliasHost,
  now = new Date(),
  cap = DEFAULT_CAP,
  maxServices = DEFAULT_MAX_SERVICES,
  enqueue = null,
  verifyLiveImpl = verifyLive,
} = {}) {
  const rels = await listAll(siteSlug);
  if (!rels.length) throw new Error(`no archived source for site '${siteSlug}'`);

  const files = {};
  for (const rel of rels) files[rel] = await download(siteSlug, rel);
  const text = (rel) => (files[rel] ? files[rel].toString("utf8") : "");

  const facts = parseSiteFacts({ llms: text("llms.txt"), index: text("index.html") });
  assertFactsComplete(facts);

  const towns = parseTowns({ llms: text("llms.txt"), index: text("index.html") });
  if (!towns.length) {
    throw new Error("seo-grid refused: the site publishes no service-area towns to grid against "
      + "(expected a '## Service area' list in llms.txt). Refusing to guess geography.");
  }

  const rating = publishedRating(text("llms.txt"));
  const services = facts.services.slice(0, Math.max(1, maxServices));

  // Dedupe / skip-existing is read off the archive and the live sitemap BEFORE
  // anything is rendered: a page that exists is a page this run must not mint.
  const existingFiles = new Set(rels.filter((r) => /\.html?$/i.test(r)));
  const sitemapXml = text("sitemap.xml");
  const originBase = facts.origin;
  const existingLocs = new Set(
    [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1].replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, ""))
      .filter(Boolean),
  );

  const { planned, skipped, remaining, cap: appliedCap } = planGrid({
    services,
    towns,
    cap,
    existingFiles,
    existingLocs,
  });

  const result = {
    kind: "seo-grid",
    cap: appliedCap,
    built: [],
    skipped,
    remaining,
    changedFiles: [],
    deployUrl: null,
    alias: null,
    verified: { ok: true, pages: 0 },
  };
  if (!planned.length) {
    // Nothing new to build is a finished grid, not a failure: the caller gets
    // the skip ledger and whatever (if anything) still sits past the cap.
    return result;
  }

  // The link index every page cross-links from: this run's pages plus the
  // pages that already exist (so a resumed grid stays one connected web).
  const linkIndex = planned.concat(
    skipped.filter((s) => s.reason === "page already exists").map((s) => ({ ...s })),
  );

  facts.__style = text("about.html") || text("index.html");
  facts.__index = text("index.html");
  const today = now.toISOString().slice(0, 10);

  const newPages = {};
  for (const pair of planned) {
    // The page speaks about THIS town: the per-page facts carry it, and the
    // claim scanner's required-fact check (city present) runs against it.
    const pageFacts = { ...facts, city: pair.town.name, state: pair.town.state };
    // A FRESH COPY OBJECT per page — baseCopyFor returns the SHARED
    // TOPIC_COPY entry, and mutating its sections would grow the table itself
    // page over page.
    const base = baseCopyFor(pair.service);
    const copy = { ...base, sections: (base.sections || []).concat(
      townGroundedSections({ topic: pair.service, town: pair.town, facts, rating }),
    ) };
    let html = renderSeoPage({ facts: pageFacts, topic: pair.service, route: pair.route, copy, today });
    html = insertSiblingLinks(html, siblingLinks(pair, linkIndex));
    // THE SAME GATE, EVERY PAGE. A grid cannot publish what the archive
    // cannot substantiate any more than a single page can.
    assertNoInventedClaims(html, pageFacts);
    newPages[pair.rel] = { html, pair, pageFacts };
  }

  // Nav + sitemap, idempotently, with PRESENCE as the gate — the exact
  // contract the single-page kind is judged on.
  const singleService = new Set(planned.map((p) => p.service)).size === 1;
  let indexHtml = text("index.html");
  let indexChanged = false;
  let sitemap = sitemapXml;
  let sitemapChanged = false;

  for (const pair of planned) {
    const nav = insertNavLink(indexHtml, {
      route: pair.route,
      label: navLabelFor(pair, singleService),
    });
    if (!nav.present) throw new Error(`seo-grid refused: could not add ${pair.route} to the nav (${nav.reason})`);
    if (nav.changed) { indexHtml = nav.html; indexChanged = true; }

    const map = insertSitemapEntry(sitemap, { loc: `${originBase}${pair.route}` });
    if (!map.present) throw new Error(`seo-grid refused: could not add ${pair.route} to sitemap.xml (${map.reason})`);
    if (map.changed) { sitemap = map.xml; sitemapChanged = true; }
  }

  const changedFiles = [];
  for (const [rel, page] of Object.entries(newPages)) {
    files[rel] = Buffer.from(page.html, "utf8");
    changedFiles.push(rel);
  }
  if (indexChanged) {
    files["index.html"] = Buffer.from(indexHtml, "utf8");
    changedFiles.push("index.html");
  }
  if (sitemapChanged) {
    files["sitemap.xml"] = Buffer.from(sitemap, "utf8");
    changedFiles.push("sitemap.xml");
  }

  for (const rel of changedFiles) {
    await upload(siteSlug, rel, files[rel],
      rel.endsWith(".html") ? "text/html" : rel.endsWith(".xml") ? "application/xml" : undefined);
  }

  const deployed = await vercelDeploy({ files, projectName, aliasHost });
  const origin = String(deployed.alias || deployed.deployUrl || deployed.url).replace(/\/+$/, "");
  result.deployUrl = deployed.url;
  result.alias = deployed.alias;

  // Every built route must render, and must be listed. One unverified page
  // fails the run loudly — a half-deployed grid is worse than none.
  for (const pair of planned) {
    const page = newPages[pair.rel];
    const verified = await verifyLiveImpl({
      origin,
      route: pair.route,
      expectH1: `${pair.service} in ${pair.town.name}, ${pair.town.state}`,
      expectLoc: `${originBase}${pair.route}`,
    });
    if (!verified.ok) {
      throw new Error(`seo-grid deployed but ${pair.route} did not verify live: ${JSON.stringify(verified)}`);
    }
    result.built.push({ service: pair.service, town: pair.town, route: pair.route, rel: pair.rel, verified });
  }

  result.verified = { ok: true, pages: result.built.length };
  result.changedFiles = changedFiles;

  // Queue the rest through the caller's own lane when one is wired: the
  // runner that has an edit-jobs store passes `enqueue`, and the remainder
  // becomes queued work. Without one, `remaining` rides the result and the
  // NEXT grid run picks the pairs up — skip-existing makes that safe.
  if (enqueue && remaining.length) {
    result.enqueued = await enqueue({ siteSlug, pairs: remaining, cap: appliedCap });
  }

  return result;
}

module.exports = {
  runSeoGridEdit,
  // The request classifier, re-exported from seo-page-edit so callers of this
  // module (site-change-plan's grid lane) need only one require.
  classifySeoGridRequest,
  // exported for tests and for the site-change-plan verb wiring
  planGrid,
  parseTowns,
  parseServiceAreas,
  publishedRating,
  gridRoute,
  townGroundedSections,
  baseCopyFor,
  siblingLinks,
  insertSiblingLinks,
  navLabelFor,
  DEFAULT_CAP,
  HARD_CAP,
};
