"use strict";

// Locks the "seo-page" edit kind: the dispatch that routes a page request away
// from the generic LLM editor, the refusal to publish a page for a service the
// business does not list, the claim scanner, the idempotent nav/sitemap
// inserts, and the rule that a deploy which does not render is a FAILURE.
//
// Proven live once against wss-test-flint-plumbing-s5.wss-ai.com (route
// /water-heaters-austin-tx went 404 -> 200, nav 4 links -> 5, sitemap 2 locs
// -> 3). These tests exist so it stays proven without redeploying a customer
// site to find out.

const assert = require("node:assert/strict");
const test = require("node:test");

const seo = require("../lib/seo-page-edit");

const LLMS = `# Flint Plumbing LLC
> plumbing serving Austin, TX.
- Business: Flint Plumbing LLC
- Trade: plumbing
- Serves: Austin, TX
- Located in: Buda, TX
- Address: 1132 Oyster Creek, Buda, TX 78610
- Phone: (512) 971-2445
- Rating: 4.9 from 106 reviews
- Website: https://wss-test-flint-plumbing-s5.wss-ai.com/
## Services
- Residential Services
- Water Heaters
- Water Leaks & Slab
- Sewer Lines
- Drains
- Gas Leaks
`;

const INDEX = `<!doctype html><html><head><style>:root{--ink:#12262a;--aqua:#4fb3ac;--aqua-bright:#80d2cb}</style></head>
<body data-city="Austin" data-region="TX" data-postal="78610" data-address-city="Buda">
  <header class="site-header"><div class="shell nav">
    <nav class="nav-links" aria-label="Primary navigation">
      <a href="#services">Services</a>
      <a href="#area">Service area</a>
      <a class="button button--aqua call-link" href="tel:(512) 971-2445">Call (512) 971-2445</a>
    </nav>
  </div></header>
</body></html>`;

const ABOUT = `<!doctype html><html><head><title>About</title>
<style>.wss-c{--wss-a:var(--accent,199 89% 48%)}body{background:#0d0d0c}</style></head>
<body><header class="wss-p__bar"><nav><a href="/">Home</a><a href="/about">About</a><a href="tel:5129712445">(512) 971-2445</a></nav></header></body></html>`;

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://wss-test-flint-plumbing-s5.wss-ai.com/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`;

function buildPage(overrides = {}) {
  const facts = seo.parseSiteFacts({ llms: LLMS, index: INDEX });
  facts.__style = ABOUT;
  facts.__index = INDEX;
  const html = seo.renderSeoPage({
    facts,
    topic: "Water Heaters",
    route: "/water-heaters-austin-tx",
    copy: seo.TOPIC_COPY["water heaters"],
    today: "2026-08-01",
    ...overrides,
  });
  delete facts.__style;
  delete facts.__index;
  return { facts, html };
}

// ---------------------------------------------------------------------------
test("a page request is classified as seo-page; other edits keep the old path", () => {
  for (const yes of [
    "Add an SEO page for water heaters, link it in the nav, and add it to the sitemap.",
    "can you build a landing page about drains",
    "I want a new page for sewer lines",
  ]) {
    assert.equal(seo.classifyEditKind(yes), "seo-page", yes);
  }
  // The generic editor is the pre-existing behaviour and must not be hijacked.
  for (const no of [
    "Make the logo in the top navigation twice as big as it is now.",
    "change the hero headline to something shorter",
    "our phone number is wrong, fix it",
  ]) {
    assert.equal(seo.classifyEditKind(no), "generic", no);
  }
});

test("site facts come off the site's own published files", () => {
  const f = seo.parseSiteFacts({ llms: LLMS, index: INDEX });
  assert.equal(f.businessName, "Flint Plumbing LLC");
  assert.equal(f.city, "Austin");
  assert.equal(f.state, "TX");
  assert.equal(f.phone, "(512) 971-2445");
  assert.equal(f.origin, "https://wss-test-flint-plumbing-s5.wss-ai.com");
  assert.ok(f.services.includes("Water Heaters"));
});

test("a topic is only accepted when the business already lists that service", () => {
  const f = seo.parseSiteFacts({ llms: LLMS, index: INDEX });
  assert.equal(seo.chooseTopic("add an seo page for water heaters", f.services), "Water Heaters");
  assert.equal(seo.chooseTopic("new page about sewer lines", f.services), "Sewer Lines");
  // Real plumbing work this business does not list, and an unrelated trade.
  assert.equal(seo.chooseTopic("add a page for septic tank pumping", f.services), null);
  assert.equal(seo.chooseTopic("add a page for roof replacement", f.services), null);
});

test("the rendered page carries the real NAP, canonical, and schema", () => {
  const { html } = buildPage();
  assert.match(html, /<h1>Water Heaters in Austin, TX<\/h1>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/wss-test-flint-plumbing-s5\.wss-ai\.com\/water-heaters-austin-tx"/);
  assert.match(html, /content="index,follow"/);
  assert.ok(html.includes("Flint Plumbing LLC"));
  assert.ok(html.includes("(512) 971-2445"));
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const types = ld["@graph"].map((n) => n["@type"]);
  assert.deepEqual(types, ["BreadcrumbList", "Service"]);
  const service = ld["@graph"][1];
  assert.equal(service.provider.telephone, "(512) 971-2445");
  // A rating the business did not publish on this page must not appear in
  // schema either — self-serving aggregateRating is exactly the kind of thing
  // that gets added "because we have the number".
  assert.equal(JSON.stringify(ld).includes("aggregateRating"), false);
});

test("the page inherits the site's own accent, not the stylesheet's generic blue", () => {
  const { html } = buildPage();
  // #80d2cb (the site's --aqua-bright, used by its own primary button).
  assert.match(html, /--accent:175 48% 66%/);
  assert.match(html, /--accent-ink:190 40% 12%/);
});

test("the claim scanner refuses anything the archive cannot substantiate", () => {
  const { facts, html } = buildPage();
  assert.equal(seo.assertNoInventedClaims(html, facts), true);

  const cases = [
    ["<p>Licensed and insured plumbers.</p>", /licensing claim/],
    ["<p>Available 24/7 for emergencies.</p>", /availability claim/],
    ["<p>Free estimates on every job.</p>", /pricing claim/],
    ["<p>All work guaranteed.</p>", /guarantee claim/],
    ["<p>A family-owned plumbing shop.</p>", /ownership claim/],
    ["<p>Serving the area since 1998.</p>", /tenure claim/],
    ["<p>Repairs from $89.</p>", /price figure/],
    ["<p>We replace water heaters fast.</p>", /first-person claim/],
    ['<p>Call (512) 555-0000 now.</p>', /phone number that is not the business/],
  ];
  for (const [injected, expected] of cases) {
    const bad = html.replace("</main>", `${injected}</main>`);
    assert.throws(() => seo.assertNoInventedClaims(bad, facts), expected, injected);
  }
});

test("a citation is not a first-person claim", () => {
  // The banned-phrase list is case-sensitive on purpose: "US Department of
  // Energy" must survive while "us" as a pronoun does not.
  const { facts, html } = buildPage();
  assert.ok(html.includes("US Department of Energy"));
  assert.equal(seo.assertNoInventedClaims(html, facts), true);
});

test("nav and sitemap inserts land once and stay landed", () => {
  const route = "/water-heaters-austin-tx";
  const first = seo.insertNavLink(INDEX, { route, label: "Water Heaters" });
  assert.equal(first.changed, true);
  assert.equal(first.present, true);
  // The CTA must stay last in the nav.
  const nav = first.html.match(/<nav class="nav-links"[\s\S]*?<\/nav>/)[0];
  assert.ok(nav.indexOf(`href="${route}"`) < nav.indexOf('class="button'));

  const second = seo.insertNavLink(first.html, { route, label: "Water Heaters" });
  assert.equal(second.changed, false, "a repeat request must not duplicate the link");
  assert.equal(second.present, true, "but it must still report the link is there");
  assert.equal((second.html.match(new RegExp(`href="${route}"`, "g")) || []).length, 1);

  const loc = `https://wss-test-flint-plumbing-s5.wss-ai.com${route}`;
  const map1 = seo.insertSitemapEntry(SITEMAP, { loc });
  assert.equal(map1.changed, true);
  assert.ok(map1.xml.includes(`<loc>${loc}</loc>`));
  const map2 = seo.insertSitemapEntry(map1.xml, { loc });
  assert.equal(map2.changed, false);
  assert.equal(map2.present, true);
  assert.equal((map2.xml.match(new RegExp(`<loc>${loc}</loc>`, "g")) || []).length, 1);
});

test("a nav with no CTA still gets the link, and a missing nav is reported, never faked", () => {
  const plain = '<nav class="nav-links"><a href="#a">A</a></nav>';
  const ok = seo.insertNavLink(plain, { route: "/x", label: "X" });
  assert.equal(ok.changed, true);
  assert.ok(ok.html.includes('href="/x"'));

  const none = seo.insertNavLink("<div>no nav here</div>", { route: "/x", label: "X" });
  assert.equal(none.changed, false);
  assert.equal(none.present, false);
  assert.match(none.reason, /no primary nav/);
});

test("live verification fails a page that does not render, whatever the deploy said", async () => {
  const route = "/water-heaters-austin-tx";
  const loc = `https://host${route}`;

  const notFound = await seo.verifyLive({
    origin: "https://host",
    route,
    expectH1: "Water Heaters in Austin, TX",
    expectLoc: loc,
    attempts: 2,
    waitMs: 0,
    sleep: async () => {},
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }),
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);

  // 200 but the page is the SPA shell / wrong content -> still a failure.
  const wrongBody = await seo.verifyLive({
    origin: "https://host",
    route,
    expectH1: "Water Heaters in Austin, TX",
    expectLoc: loc,
    attempts: 2,
    waitMs: 0,
    sleep: async () => {},
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<h1>Something else</h1>" }),
  });
  assert.equal(wrongBody.ok, false);
  assert.equal(wrongBody.hasH1, false);

  const good = await seo.verifyLive({
    origin: "https://host",
    route,
    expectH1: "Water Heaters in Austin, TX",
    expectLoc: loc,
    attempts: 1,
    sleep: async () => {},
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      text: async () => (String(url).endsWith("sitemap.xml")
        ? `<urlset><url><loc>${loc}</loc></url></urlset>`
        : "<h1>Water Heaters in Austin, TX</h1>"),
    }),
  });
  assert.equal(good.ok, true);
});

// ---------------------------------------------------------------------------
// The wiring. Without this the handler exists and is never reached.
// ---------------------------------------------------------------------------
const stubPaths = {
  adminAuth: require.resolve("../lib/admin-auth"),
  store: require.resolve("../lib/store"),
  siteEditor: require.resolve("../lib/site-editor"),
  seoPage: require.resolve("../lib/seo-page-edit"),
  sitePlan: require.resolve("../lib/site-change-plan"),
  targets: require.resolve("../lib/site-edit-targets"),
  // The execution moved from the handler into lib/edit-job-runner (so the cron
  // sweeper and Riley's post-queue kick share one implementation). The runner
  // must be evicted alongside the handler, or it keeps the REAL modules it
  // bound at first require and every stub above is invisible to it.
  runner: require.resolve("../lib/edit-job-runner"),
  handler: require.resolve("../api/admin/run-edit-job"),
};

async function runJobWithStubs(instruction) {
  const saved = Object.fromEntries(Object.values(stubPaths).map((p) => [p, require.cache[p]]));
  const savedResend = process.env.RESEND_API_KEY;
  const calls = { generic: 0, seoPage: 0, plan: 0, planInstructions: [], kindsStored: [] };
  try {
    delete process.env.RESEND_API_KEY; // no mail from a test, ever
    process.env.GHOST_AGENCY_ADMIN_TOKEN = process.env.GHOST_AGENCY_ADMIN_TOKEN || "test-admin-token";
    const stub = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub(stubPaths.adminAuth, { requireAdmin: () => true, adminAllowed: () => ({ allowed: true, configured: true }) });
    stub(stubPaths.store, {
      select: async () => ({ ok: true, data: [{ job_id: "job1", site_slug: "wss-test-x", instruction, status: "queued" }] }),
      upsertRow: async (_t, row) => { if (row.status === "done" || row.status === "failed") calls.kindsStored.push(row.result && row.result.kind); return { ok: true }; },
      recordEvent: async () => ({ ok: true }),
    });
    stub(stubPaths.siteEditor, {
      runSiteEdit: async () => { calls.generic += 1; return { changedFiles: ["index.html"] }; },
      listAll: async () => [], download: async () => Buffer.from(""), upload: async () => {},
    });
    stub(stubPaths.seoPage, {
      ...seo,
      runSeoPageEdit: async () => { calls.seoPage += 1; return { route: "/r", changedFiles: ["r.html"], verified: { ok: true } }; },
    });
    stub(stubPaths.sitePlan, {
      runSiteChange: async ({ instruction: got }) => {
        calls.plan += 1;
        calls.planInstructions.push(got);
        return { kind: seo.classifyEditKind(got), changedFiles: ["index.html"], verified: { ok: true } };
      },
    });
    stub(stubPaths.targets, { resolveSiteEditTarget: async () => ({ projectName: "wss-test-x", aliasHost: "wss-test-x.wss-ai.com" }) });
    delete require.cache[stubPaths.runner];
    delete require.cache[stubPaths.handler];
    const handler = require(stubPaths.handler);

    const res = {
      statusCode: 200, headers: {}, body: null,
      setHeader(k, v) { this.headers[k] = v; },
      end(p) { this.body = p; this._done(); },
    };
    const settled = new Promise((r) => { res._done = () => r(); });
    await handler({ method: "POST", headers: { "x-admin-token": process.env.GHOST_AGENCY_ADMIN_TOKEN }, body: { jobId: "job1" } }, res);
    await settled;
    return { calls, json: JSON.parse(res.body) };
  } finally {
    delete require.cache[stubPaths.handler];
    for (const [p, mod] of Object.entries(saved)) {
      if (mod) require.cache[p] = mod;
      else delete require.cache[p];
    }
    if (savedResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedResend;
  }
}

// 2026-08-01 CONTRACT MIGRATION. These two tests used to assert a dispatch
// that picked a CODE PATH per edit kind: page requests to runSeoPageEdit,
// everything else to the whole-file LLM editor. That editor was structurally
// unable to edit a real mirror (58,909-byte index.html vs a 16,000-token
// output cap — replies truncated mid-file, measured, byte-identical DOM either
// side), and the owner asked for one universal capability instead of a path
// per feature. run-edit-job now sends EVERY instruction through
// lib/site-change-plan runSiteChange(), which absorbs seo-page as a verb;
// classifyEditKind survives for auditing only. The invariants preserved from
// the old tests: the kind is still classified, still reported, and still
// persisted on the job row; and the retired whole-file editor is never called.
test("run-edit-job sends a page request through the universal plan, kind recorded", async () => {
  const { calls, json } = await runJobWithStubs("Add an SEO page for water heaters and put it in the nav and sitemap.");
  assert.equal(calls.plan, 1, "the universal plan path must run");
  assert.equal(calls.generic, 0, "the retired whole-file editor must never be called");
  assert.equal(calls.seoPage, 0, "seo-page is a verb inside the plan, not a separate code path");
  assert.equal(json.kind, "seo-page");
  assert.equal(json.status, "done");
  assert.deepEqual(calls.kindsStored, ["seo-page"], "the kind is persisted on the job for audit");
  assert.match(calls.planInstructions[0], /water heaters/, "the caller's own words reach the planner");
});

test("run-edit-job sends every other edit through the same universal plan", async () => {
  const { calls, json } = await runJobWithStubs("Make the logo in the top navigation twice as big as it is now.");
  assert.equal(calls.plan, 1);
  assert.equal(calls.generic, 0, "the retired whole-file editor must never be called");
  assert.equal(calls.seoPage, 0);
  assert.equal(json.kind, "generic");
  assert.deepEqual(calls.kindsStored, ["generic"]);
});
