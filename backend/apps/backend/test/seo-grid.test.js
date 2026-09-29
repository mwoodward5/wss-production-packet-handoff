"use strict";

// test/seo-grid.test.js — locks the "seo-grid" edit kind (feature 9): the
// bounded service×town page grid built by lib/seo-grid.js on top of the
// single-page builder's contract in lib/seo-page-edit.js.
//
// What is held, in order: the classification that separates a GRID request
// from a single-page request; towns read ONLY from the site's own published
// service area; the planner's cap / skip-existing / dedupe / remainder
// mechanics; the end-to-end run (nav + sitemap presence, canonical
// self-reference, the claim gate on EVERY page, certified-fact enrichment);
// the resumable second run; queueing the remainder; and the refusals — a
// service the gate cannot back, geography nobody published, a nav that cannot
// take the links.

const assert = require("node:assert/strict");
const test = require("node:test");

// ---------------------------------------------------------------------------
// The stub archive. seo-grid binds listAll/download/upload (site-editor) and
// vercelDeploy (forge) at require time, so the stubs go into require.cache
// BEFORE the module is loaded. `store` models persistence: an upload IS
// visible to the next listAll, which is what makes the second-run test prove
// skip-existing rather than fake it.
// ---------------------------------------------------------------------------
const uploads = [];
const deploys = { count: 0 };
const store = {};

function seedArchive(files) {
  for (const [k, v] of Object.entries(files)) store[k] = Buffer.from(v, "utf8");
}
function resetArchive(files) {
  for (const k of Object.keys(store)) delete store[k];
  uploads.length = 0;
  deploys.count = 0;
  seedArchive(files);
}

function stubIn(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}
stubIn(require.resolve("../lib/site-editor"), {
  listAll: async () => Object.keys(store),
  download: async (_slug, rel) => Buffer.from(store[rel] || ""),
  upload: async (_slug, rel, buf) => {
    store[rel] = Buffer.from(buf);
    uploads.push(rel);
  },
  runSiteEdit: async () => { throw new Error("the retired whole-file editor must never run"); },
});
stubIn(require.resolve("../lib/forge"), {
  vercelDeploy: async () => {
    deploys.count += 1;
    return { url: "https://concord-plumbing.vercel.app", alias: "https://wss-test-concord-plumbing.wss-ai.com" };
  },
});

const grid = require("../lib/seo-grid");
const seo = require("../lib/seo-page-edit");

const ORIGIN = "https://wss-test-concord-plumbing.wss-ai.com";

const LLMS = `# Concord Plumbing Works
> plumbing serving Concord, CA.
- Business: Concord Plumbing Works
- Trade: plumbing
- Serves: Concord, CA
- Located in: Concord, CA
- Address: 2210 Willow Pass Rd, Concord, CA 94520
- Phone: (925) 555-0177
- Rating: 4.8 from 92 reviews
- Website: ${ORIGIN}/
## Services
- Water Heaters
- Drains
- Gas Leaks
## Service area
- Brentwood, CA
- Oakley
- Antioch, CA
- Clayton
- Martinez, CA
`;

const INDEX = `<!doctype html><html><head><style>:root{--ink:#12262a;--aqua:#4fb3ac;--aqua-bright:#80d2cb}</style></head>
<body data-city="Concord" data-region="CA" data-postal="94520" data-address-city="Concord">
  <header class="site-header"><div class="shell nav">
    <nav class="nav-links" aria-label="Primary navigation">
      <a href="#services">Services</a>
      <a href="#area">Service area</a>
      <a class="button button--aqua call-link" href="tel:(925) 555-0177">Call (925) 555-0177</a>
    </nav>
  </div></header>
</body></html>`;

const ABOUT = `<!doctype html><html><head><title>About</title>
<style>.wss-c{--wss-a:var(--accent,199 89% 48%)}body{background:#0d0d0c}</style></head>
<body><header class="wss-p__bar"><nav><a href="/">Home</a><a href="/about">About</a><a href="tel:9255550177">(925) 555-0177</a></nav></header></body></html>`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGIN}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`;

function freshSite(overrides = {}) {
  resetArchive({
    "index.html": overrides.index ?? INDEX,
    "about.html": ABOUT,
    "llms.txt": overrides.llms ?? LLMS,
    "sitemap.xml": overrides.sitemap ?? SITEMAP,
  });
}

const RUN = {
  siteSlug: "wss-test-concord-plumbing",
  projectName: "wss-test-concord-plumbing",
  aliasHost: "wss-test-concord-plumbing.wss-ai.com",
  now: new Date("2026-09-01T12:00:00Z"),
  verifyLiveImpl: async () => ({ ok: true, attempts: 1, status: 200, hasH1: true, inSitemap: true }),
};

// ---------------------------------------------------------------------------
test("a grid request is classified apart from a single page or a generic edit", () => {
  for (const yes of [
    "Build out pages for every town we serve.",
    "add service pages for all the cities in our area",
    "can you make pages for each town in my service area",
    "build a grid of seo pages",
    "generate pages for all my services, up to 12",
  ]) {
    assert.equal(seo.classifyEditKind(yes), "seo-grid", yes);
    const parsed = seo.classifySeoGridRequest(yes);
    assert.equal(parsed.grid, true, yes);
  }
  // The caller's own cap is read, and re-capped server-side regardless.
  assert.equal(seo.classifySeoGridRequest("generate pages for all my services, up to 12").cap, 12);
  assert.equal(seo.classifySeoGridRequest("make pages for every town, max 99").cap, grid.HARD_CAP);
  assert.equal(seo.classifySeoGridRequest("make pages for every town, up to 0").cap, 1);

  // A SINGLE page request is not a grid — the existing seo-page contract
  // must not be hijacked.
  for (const single of [
    "Add an SEO page for water heaters, link it in the nav, and add it to the sitemap.",
    "can you build a landing page about drains",
    "I want a new page for sewer lines",
  ]) {
    assert.notEqual(seo.classifyEditKind(single), "seo-grid", single);
    assert.equal(seo.classifySeoGridRequest(single).grid, false, single);
  }
  // And a non-page edit stays generic.
  assert.equal(seo.classifyEditKind("make the logo twice as big"), "generic");
});

test("towns come off the site's own published service area, never a guess", () => {
  const towns = grid.parseTowns({ llms: LLMS, index: INDEX });
  assert.deepEqual(towns, [
    { name: "Brentwood", state: "CA" },
    { name: "Oakley", state: "CA" },
    { name: "Antioch", state: "CA" },
    { name: "Clayton", state: "CA" },
    { name: "Martinez", state: "CA" },
  ]);
  // The business's own town never grids against itself.
  assert.ok(!towns.some((t) => t.name === "Concord"));
  // No published list -> no towns -> the grid refuses instead of inventing.
  const bare = LLMS.split("## Service area")[0];
  assert.deepEqual(grid.parseTowns({ llms: bare, index: INDEX }), []);
});

test("planGrid caps, orders, dedupes, and skips what already exists", () => {
  const services = ["Water Heaters", "Drains", "Gas Leaks"];
  const duplicateServices = ["Water Heaters", "Drains", "Drains"]; // duplicate on purpose
  const towns = grid.parseTowns({ llms: LLMS, index: INDEX });

  const full = grid.planGrid({ services, towns });
  assert.equal(full.cap, grid.DEFAULT_CAP);
  assert.equal(full.planned.length, grid.DEFAULT_CAP);
  assert.equal(full.remaining.length, 15 - grid.DEFAULT_CAP); // 3 services x 5 towns, capped
  // Deterministic order: services in list order, towns in published order.
  assert.equal(full.planned[0].route, "/water-heaters-brentwood-ca");
  assert.equal(full.planned[1].route, "/water-heaters-oakley-ca");
  assert.equal(full.planned[5].route, "/drains-brentwood-ca");

  // A tighter cap leaves more for the next run — in the same order.
  const tight = grid.planGrid({ services, towns, cap: 3 });
  assert.equal(tight.planned.length, 3);
  assert.equal(tight.remaining.length, 12);
  assert.deepEqual(
    tight.remaining.map((p) => p.route),
    full.planned.slice(3).concat(full.remaining).map((p) => p.route),
  );

  // A page that already exists is skipped, not rebuilt or duplicated.
  const exists = grid.planGrid({
    services: duplicateServices, towns,
    existingFiles: new Set(["water-heaters-brentwood-ca.html"]),
  });
  assert.equal(exists.planned[0].route, "/water-heaters-oakley-ca");
  assert.ok(exists.skipped.some((s) => s.route === "/water-heaters-brentwood-ca" && s.reason === "page already exists"));

  // A route already listed in the sitemap is likewise skipped.
  const listed = grid.planGrid({
    services, towns,
    existingLocs: new Set(["/drains-brentwood-ca"]),
  });
  assert.ok(listed.skipped.some((s) => s.route === "/drains-brentwood-ca" && s.reason === "already in sitemap"));

  // Two services that slug to the same route are ONE page.
  const dupe = grid.planGrid({ services: duplicateServices, towns });
  assert.equal(dupe.skipped.filter((s) => s.reason === "duplicate route this run").length, 5,
    "each duplicate Drains×town pair is reported as skipped, once per town");
});

test("runSeoGridEdit builds the capped batch with nav + sitemap presence and the gate on every page", async () => {
  freshSite();
  const result = await grid.runSeoGridEdit(RUN);

  assert.equal(result.kind, "seo-grid");
  assert.equal(result.built.length, grid.DEFAULT_CAP);
  assert.equal(result.remaining.length, 15 - grid.DEFAULT_CAP);
  assert.equal(deploys.count, 1, "one bounded batch is one deploy");
  assert.equal(uploads.length, result.changedFiles.length);

  // Every built page landed in the archive, in the nav, and in the sitemap.
  const indexHtml = store["index.html"].toString("utf8");
  const sitemapXml = store["sitemap.xml"].toString("utf8");
  const nav = indexHtml.match(/<nav class="nav-links"[\s\S]*?<\/nav>/)[0];
  const facts = seo.parseSiteFacts({ llms: LLMS, index: INDEX });

  for (const built of result.built) {
    const html = store[built.rel].toString("utf8");
    assert.ok(html, `${built.rel} uploaded`);
    assert.ok(nav.includes(`href="${built.route}"`), `${built.route} linked from the primary nav`);
    assert.equal((sitemapXml.match(new RegExp(`<loc>${ORIGIN}${built.route}</loc>`, "g")) || []).length, 1,
      `${built.route} listed in the sitemap exactly once`);
    // Canonical self-reference — a grid page never canonicalises elsewhere.
    assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}${built.route}" />`), built.route);
    // THE SAME GATE, EVERY PAGE: the claim scanner passes it as published.
    assert.equal(seo.assertNoInventedClaims(html, { ...facts, city: built.town.name, state: built.town.state }), true, built.route);
  }
  // The CTA stays last in the nav no matter how many grid links went in.
  for (const built of result.built) {
    assert.ok(nav.indexOf(`href="${built.route}"`) < nav.indexOf('class="button'), built.route);
  }
  // Links went in order and once each.
  for (const built of result.built) {
    assert.equal((nav.match(new RegExp(`href="${built.route}"`, "g")) || []).length, 1, built.route);
  }

  // Certified-fact enrichment: the town grounding names the business's own
  // published rating, and the topic with a deep TOPIC_COPY entry got it.
  const brentwood = store["water-heaters-brentwood-ca.html"].toString("utf8");
  assert.match(brentwood, /<h1>Water Heaters in Brentwood, CA<\/h1>/);
  assert.ok(brentwood.includes("4.8 from 92 reviews"), "the site's own published rating enriches the page");
  assert.ok(brentwood.includes("How a water heater ages"), "deep TOPIC_COPY entry reused where it exists");
  const oakley = store["drains-oakley-ca.html"].toString("utf8");
  assert.match(oakley, /<h1>Drains in Oakley, CA<\/h1>/);
  assert.ok(oakley.includes("lists Oakley among the areas it serves"), "generic template enriched with the town fact");
  assert.ok(oakley.includes("How drains fail"), "the extended topic table covers drains");

  // Internal grid links: same town and same service siblings, and only to
  // pages that actually exist after this run.
  assert.ok(brentwood.includes('href="/water-heaters-oakley-ca"'), "same-service sibling linked");
  assert.ok(brentwood.includes('href="/drains-brentwood-ca"'), "same-town sibling linked");
  assert.ok(!brentwood.includes('href="/gas-leaks-clayton-ca"'), "a page past the cap is not linked (it does not exist)");
});

test("the next run resumes the remainder, and a finished grid deploys nothing", async () => {
  freshSite();
  // Run 1: the capped batch.
  const first = await grid.runSeoGridEdit(RUN);
  assert.equal(first.built.length, grid.DEFAULT_CAP);
  assert.equal(deploys.count, 1);

  // Run 2: the remainder, picked up in order — skip-existing makes resuming
  // safe, so the cap walks the same grid to completion.
  const second = await grid.runSeoGridEdit(RUN);
  assert.equal(second.built.length, 15 - grid.DEFAULT_CAP);
  assert.equal(second.skipped.filter((s) => s.reason === "page already exists").length, grid.DEFAULT_CAP);
  assert.equal(second.remaining.length, 0);
  assert.equal(deploys.count, 2, "the resume run deploys its own batch");

  // Run 3: the grid is complete. Nothing to build, nothing to deploy.
  const uploadsBeforeThird = uploads.length;
  const third = await grid.runSeoGridEdit(RUN);
  assert.equal(third.built.length, 0, "nothing new to build");
  assert.equal(third.skipped.length, 15, "every pair reported as existing");
  assert.equal(third.remaining.length, 0);
  assert.equal(third.changedFiles.length, 0);
  assert.equal(deploys.count, 2, "a finished grid deploys nothing");
  assert.equal(uploads.length, uploadsBeforeThird);
});

test("the un-built remainder can be queued through the caller's own lane", async () => {
  freshSite();
  const queued = [];
  const result = await grid.runSeoGridEdit({
    ...RUN,
    cap: 4,
    enqueue: async ({ siteSlug, pairs, cap }) => {
      queued.push({ siteSlug, pairs, cap });
      return pairs.length;
    },
  });
  assert.equal(result.built.length, 4);
  assert.equal(result.enqueued, 11);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].pairs.length, 11);
  assert.equal(queued[0].cap, 4);
  assert.ok(queued[0].pairs[0].route, "the queue carries concrete pairs, not a count");
});

test("the truth gate refuses the whole grid for a service it cannot back", async () => {
  freshSite({
    llms: LLMS.replace("- Water Heaters", "- 24/7 Emergency Plumbing"),
  });
  await assert.rejects(
    () => grid.runSeoGridEdit(RUN),
    /availability claim/,
    "a service name carrying an availability claim fails the gate before a byte ships",
  );
  assert.equal(deploys.count, 0, "a refused grid deploys nothing");
  assert.equal(uploads.length, 0, "a refused grid uploads nothing");
});

test("a site with no published service-area towns is refused, not guessed", async () => {
  freshSite({ llms: LLMS.split("## Service area")[0] });
  await assert.rejects(
    () => grid.runSeoGridEdit(RUN),
    /publishes no service-area towns/,
  );
  assert.equal(deploys.count, 0);
});

test("a homepage whose nav cannot take the links refuses the grid before upload", async () => {
  freshSite({ index: "<!doctype html><html><body><p>no nav here</p></body></html>" });
  await assert.rejects(
    () => grid.runSeoGridEdit(RUN),
    /could not add .* to the nav/,
  );
  assert.equal(deploys.count, 0, "the presence gate fires before any upload");
  assert.equal(uploads.length, 0);
});

test("a site whose sitemap cannot be extended refuses cleanly", async () => {
  freshSite({ sitemap: "<xml>no urlset here</xml>" });
  await assert.rejects(
    () => grid.runSeoGridEdit(RUN),
    /could not add .* to sitemap\.xml/,
  );
  assert.equal(deploys.count, 0);
  assert.equal(uploads.length, 0);
});
