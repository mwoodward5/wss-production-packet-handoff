"use strict";

// test/seo-grid-lane.test.js — locks the DISPATCH, not the builder: a plural
// page request routes to the bounded grid lane in lib/site-change-plan.js
// before the planner is ever called, a single-page request still routes to the
// seo-page lane, and both report their kind on the result. The builder's own
// mechanics are held in test/seo-grid.test.js.

const assert = require("node:assert/strict");
const test = require("node:test");

// Same stub archive as test/seo-grid.test.js: listAll/download/upload and
// vercelDeploy bound at require time, so the stubs land before any lib loads.
const uploads = [];
const deploys = { count: 0 };
const store = {};

function seedArchive(files) {
  for (const [k, v] of Object.entries(files)) store[k] = Buffer.from(v, "utf8");
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

// The REAL grid module, with live verification folded to an instant pass —
// the lane must reach and execute it, and this test does not open sockets.
const realGrid = require("../lib/seo-grid");
stubIn(require.resolve("../lib/seo-grid"), {
  ...realGrid,
  runSeoGridEdit: (opts) => realGrid.runSeoGridEdit({
    ...opts,
    verifyLiveImpl: async () => ({ ok: true, attempts: 1, status: 200, hasH1: true, inSitemap: true }),
  }),
});
const plan = require("../lib/site-change-plan");

// runSiteChange reads its archive through downloadFresh(), which is a
// cache-busted FETCH against Supabase Storage — so the stub storage lane here
// is a fake fetch that serves `store` bytes, and live-verification URLs with
// real-looking answers. No sockets open.
process.env.SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";

function installFakeFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/storage/v1/object/wss-site-sources/")) {
      const m = u.match(/wss-site-sources\/[^/]+\/([^?]+)\?/);
      const rel = m ? decodeURIComponent(m[1]) : "";
      const buf = store[rel];
      if (!buf) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" };
      return {
        ok: true, status: 200,
        arrayBuffer: async () => Uint8Array.from(buf).buffer,
        text: async () => buf.toString("utf8"),
      };
    }
    // Live verification (the single-page lane's verifyLive).
    if (u.endsWith("/sitemap.xml")) {
      const sitemap = store["sitemap.xml"] ? store["sitemap.xml"].toString("utf8") : "<urlset></urlset>";
      return { ok: true, status: 200, text: async () => sitemap };
    }
    if (u.includes("/water-heaters-concord-ca")) {
      return { ok: true, status: 200, text: async () => "<html><body><h1>Water Heaters in Concord, CA</h1></body></html>" };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
  return () => { globalThis.fetch = real; };
}

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
## Service area
- Brentwood, CA
- Oakley
- Antioch, CA
`;
const INDEX = `<!doctype html><html><head><style>:root{--aqua:#4fb3ac}</style></head>
<body data-city="Concord" data-region="CA" data-postal="94520" data-address-city="Concord">
  <nav class="nav-links" aria-label="Primary navigation">
    <a href="#services">Services</a>
    <a class="button button--aqua call-link" href="tel:(925) 555-0177">Call (925) 555-0177</a>
  </nav>
</body></html>`;
const ABOUT = `<!doctype html><html><head><style>.wss-c{}</style></head>
<body><header class="wss-p__bar"><nav><a href="/">Home</a><a href="tel:9255550177">call</a></nav></header></body></html>`;
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGIN}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
</urlset>
`;

function freshSite() {
  for (const k of Object.keys(store)) delete store[k];
  uploads.length = 0;
  deploys.count = 0;
  seedArchive({
    "index.html": INDEX,
    "about.html": ABOUT,
    "llms.txt": LLMS,
    "sitemap.xml": SITEMAP,
  });
}

const CALL = {
  siteSlug: "wss-test-concord-plumbing",
  projectName: "wss-test-concord-plumbing",
  aliasHost: "wss-test-concord-plumbing.wss-ai.com",
  now: new Date("2026-09-01T12:00:00Z"),
  // The planner is the LLM. Neither deterministic lane may reach it.
  planner: async () => { throw new Error("the planner must not run for a page/grid request"); },
  verifyEditLive: async () => { throw new Error("rendered verification is the plan lane's, not the page lanes'"); },
};

test("a plural page request takes the grid lane and never reaches the planner", async () => {
  freshSite();
  const restore = installFakeFetch();
  try {
    const result = await plan.runSiteChange({
      ...CALL,
      instruction: "Please build out pages for every town we serve.",
      jobId: "job_grid",
    });
    assert.equal(result.applied, true);
    assert.equal(result.via, "seo-grid");
    assert.equal(result.kind, "seo-grid");
    // 2 services x 3 towns, capped at the default 10 -> the whole grid fits.
    assert.equal(result.built.length, 6);
    assert.equal(result.remainingCount, 0);
    assert.equal(result.skippedCount, 0);
    assert.equal(deploys.count, 1);
    assert.match(result.say, /6 new service-area pages are live/);
    assert.ok(result.verified && result.verified.ok === true);
    // The builder's gates ran for real: nav links and sitemap entries exist.
    const indexHtml = store["index.html"].toString("utf8");
    const sitemapXml = store["sitemap.xml"].toString("utf8");
    assert.ok(indexHtml.includes('href="/water-heaters-brentwood-ca"'));
    assert.ok(sitemapXml.includes(`<loc>${ORIGIN}/water-heaters-brentwood-ca</loc>`));
  } finally {
    restore();
  }
});

test("the grid lane honours a cap the caller asked for in plain words", async () => {
  freshSite();
  const restore = installFakeFetch();
  try {
    const result = await plan.runSiteChange({
      ...CALL,
      instruction: "make pages for all the towns, up to 2",
      jobId: "job_grid_capped",
    });
    assert.equal(result.via, "seo-grid");
    assert.equal(result.built.length, 2);
    assert.equal(result.remainingCount, 4);
    assert.match(result.say, /next batch of 4/);
  } finally {
    restore();
  }
});

test("a single-page request still takes the seo-page lane, not the grid", async () => {
  freshSite();
  const restore = installFakeFetch();
  try {
    const result = await plan.runSiteChange({
      ...CALL,
      instruction: "Add an SEO page for water heaters, link it in the nav, and add it to the sitemap.",
      jobId: "job_single",
    });
    assert.equal(result.applied, true);
    assert.equal(result.via, "seo-page");
    assert.equal(result.route, "/water-heaters-concord-ca");
    assert.ok(store["water-heaters-concord-ca.html"], "the single page shipped");
    assert.equal(deploys.count, 1);
    assert.ok(!store["drains-brentwood-ca.html"], "no grid pages were minted");
  } finally {
    restore();
  }
});
