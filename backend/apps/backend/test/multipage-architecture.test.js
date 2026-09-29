"use strict";

// test/multipage-architecture.test.js — WAVE 4: the multi-page authority
// architecture from the 108-point gap report (docs/standards/
// optimization-gap-report.md §3.1, §4).
//
// Three pieces of finished-but-unwired machinery became production paths:
//   1. lib/local-search-plan.js buildLocalSearchPlan() had ZERO production
//      callers. It now runs inside the engine after content injection, ships
//      as local-search-plan.json, and its contentPlan bounds the page set.
//   2. lib/mirror-engine/measure-runtime.js was called only by
//      scripts/ship-four.js. Its lightweight collectVitals() probe now runs in
//      the render gate's OWN Chromium pass, so gate evidence carries real
//      LCP/INP/CLS/TTFB numbers.
//   3. authority-pages.js stopped at about/service-areas/faq/team. It now
//      emits one page per verified service and one bounded chapter per
//      verified locality — every page linked from the index, so no orphan.
//
// The engine-level tests run against the real engine with deploy stubs and a
// fake Chromium that the REAL verify.js renderCheckOnce/renderAuditOnce drive,
// so the vitals path under test is the production one.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-"));

const { mirror, signEvidence } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { slugPolicy } = require("../lib/mirror-engine/deploy");
const { renderCheckOnce, renderAuditOnce } = require("../lib/mirror-engine/verify");
const authorityPages = require("../lib/mirror-engine/authority-pages");
const { buildLocalSearchPlan } = require("../lib/local-search-plan");
const { collectVitals } = require("../lib/mirror-engine/measure-runtime");
const { sanitizeRowPayload } = require("../lib/line-persistence");

// ---------------------------------------------------------------------------
// A fake Chromium that the REAL render gate drives
// ---------------------------------------------------------------------------
// renderCheckOnce/renderAuditOnce accept an injectable `launch`, so the
// production verify code runs unmodified against this page. evaluate() is
// dispatched by MARKERS in the probe source (__wssCwv, __wssInp, video,
// prose_text, rootChildren) rather than call order, so the stub survives
// reordering of the gate's probes.
function fakeChromium({ lcp = 1876.4, cls = 0.012, ttfb = 143.2, inp = 91.3 } = {}) {
  const current = { path: "/" };
  const page = {
    on: () => {},
    goto: async (url) => {
      current.path = String(url).replace(/^https?:\/\/[^/]+/, "") || "/";
      return { status: () => 200 };
    },
    evaluate: async (fn) => {
      const src = String(fn);
      if (src.includes('querySelector("video")')) return { present: false };
      if (src.includes("__wssCwv")) {
        return { __wssCwv: true, lcp, cls, ttfb, protocol: "h2", encoded: 12000, decoded: 48000 };
      }
      if (src.includes("__wssInp")) return { __wssInp: inp };
      if (src.includes("prose_text")) {
        return {
          text: `Rendered body of ${current.path} — O'Brien & Sons Roofing provides roof repair in Tucson with complete sentences and no holes.`,
          prose_text: "",
          verbatim_blocks: 0,
          injected_sections: 3,
          injected_sections_in_markup: 3,
          title: `O'Brien & Sons Roofing ${current.path}`,
          h1: `O'Brien & Sons Roofing — roofing in Tucson ${current.path}`,
          h1_count: 1,
          found: [],
        };
      }
      if (src.includes("rootChildren")) {
        return { bodyChars: 812, rootChildren: 2, h1Visible: true, interactiveCount: 6 };
      }
      if (src.includes("innerText")) {
        return "O'Brien & Sons Roofing provides roof repair in Tucson. Full rendered body with ordinary words.";
      }
      throw new Error(`fake page evaluate: unexpected probe\n${src.slice(0, 160)}`);
    },
    keyboard: { press: async () => {} },
    close: async () => {},
  };
  const browser = { newPage: async () => page, close: async () => {} };
  return { launch: async () => browser, page };
}

/** Deploy stubs (mirror-engine.test.js shape) with render gates wired to the
 *  REAL verify.js code over the fake Chromium, so web_vitals in the manifest
 *  is collected by the production probe. */
function makeDeps(chromiumOpts = {}) {
  const calls = [];
  let captured = null;
  const chrome = fakeChromium(chromiumOpts);
  return {
    calls,
    files: () => captured,
    deps: {
      slugPolicy,
      withSpaRewrite: (files) => {
        const out = files["vercel.json"] ? files : { ...files, "vercel.json": Buffer.from('{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}') };
        captured = out;
        return out;
      },
      ensureProject: async (name) => { calls.push(["ensureProject", name]); return "prj_stub_123"; },
      resolveAliasDeployment: async () => ({ found: false, reason: "alias_not_found" }),
      uploadFiles: async (files) => {
        calls.push(["uploadFiles", Object.keys(files).length]);
        return { manifest: Object.keys(files).map((f) => ({ file: f })), uploaded: 3, deduped: Object.keys(files).length - 3 };
      },
      createDeployment: async () => {
        calls.push(["createDeployment"]);
        return { id: "dpl_stub_1", url: "stub-deploy.vercel.app", readyState: "QUEUED" };
      },
      waitReady: async (id) => { calls.push(["waitReady", id]); return { readyState: "READY" }; },
      byteDiff: async () => ({ clean: true, checked: 9, mismatches: [] }),
      deepLinkCheck: async () => ({ clean: true, failures: [] }),
      attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
      aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
      renderCheck: async (url, opts) => {
        calls.push(["renderCheck", url]);
        return renderCheckOnce(url, { ...opts, launch: chrome.launch });
      },
      renderAudit: async (base, opts) => {
        calls.push(["renderAudit", opts.paths]);
        return renderAuditOnce(base, { ...opts, launch: chrome.launch });
      },
    },
  };
}

const FACTS = {
  business_name: "O'Brien & Sons Roofing",
  industry: "Roofing",
  city: "Tucson",
  state: "AZ",
  phone: "(520) 555-0142",
  address: "1202 N 4th Ave",
  postal_code: "85705",
  rating: 4.8,
  review_count: 127,
  latitude: 32.2226,
  longitude: -110.9747,
};

const CONTENT = {
  about: "O'Brien & Sons Roofing has roofed Pima County homes since 1998.",
  services: [
    { name: "Roof Repair", description: "Repairs for verified roof damage, including flashing, penetrations and shingle work." },
    { name: "Storm Restoration" },
    { name: "Gutter Cleaning & Guard Installation", description: "Cleaning and guards, quoted from what is actually on the house." },
  ],
  areas: ["Tucson", "Marana", "Oro Valley", "Sahuarita"],
  faqs: [{ q: "Do you inspect roofs?", a: "Yes, by appointment." }],
};

function wave4Request() {
  return { slug: "wss-test-obrien-and-sons-roofing", donor: "mirror-donor", facts: FACTS, content: CONTENT };
}

async function buildWave4Site() {
  const harness = makeDeps();
  const res = await mirror(wave4Request(), { registry: createRegistry(), deps: harness.deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  return { out: harness.files(), manifest: res.body, calls: harness.calls };
}

// ---------------------------------------------------------------------------
// (a) local-search-plan output appears in the built files
// ---------------------------------------------------------------------------
test("the local search plan ships as a build file with bounded page counts", async () => {
  const { out, manifest } = await buildWave4Site();
  const raw = out["local-search-plan.json"];
  assert.ok(Buffer.isBuffer(raw), "local-search-plan.json must be a built file");
  const plan = JSON.parse(raw.toString("utf8"));
  assert.equal(plan.version, "local-search-plan.v1");
  assert.ok(Array.isArray(plan.targetTerms) && plan.targetTerms.length > 0, "target terms computed");
  assert.ok(plan.targetTerms.some((t) => /tucson/.test(t.term)), "geo term present");
  // TRUTH LAW, in the plan's own vocabulary: this intake carries no measured
  // keyword rankings and no citations, so the plan says candidate_only —
  // "measured" is a claim about market data, and areas alone are not that.
  assert.equal(plan.status, "candidate_only");
  assert.equal(plan.claimLevel, "planned");
  const marana = plan.contentPlan.verifiedLocalities.find((l) => /marana/i.test(l.name));
  assert.ok(marana, "Marana is a verified locality of the plan");
  assert.ok(Array.isArray(plan.trustSignals) && plan.trustSignals.length > 0, "trust signals computed");
  assert.equal(manifest.checks.content.local_search_plan.version, "local-search-plan.v1");
  assert.equal(manifest.checks.content.local_search_plan.service_pages, 3);
  assert.equal(manifest.checks.content.local_search_plan.service_area_pages, 3);
});

test("the wired local-seo layer ships map facade + NAP + LocalBusiness — and no review CTA without a Place ID", async () => {
  const { out } = await buildWave4Site();
  const serviceAreas = out["service-areas.html"].toString("utf8");
  assert.ok(serviceAreas.includes("map-facade"), "click-to-load map facade replaces the direct iframe");
  assert.ok(!/<iframe src="https:\/\/www\.google\.com\/maps\?/.test(serviceAreas), "no direct map iframe on /service-areas");
  assert.ok(serviceAreas.includes('class="nap"'), "visible NAP block");
  assert.ok(serviceAreas.includes('"@type":"LocalBusiness"'), "LocalBusiness structured data");
  assert.ok(serviceAreas.includes("Get driving directions") || serviceAreas.includes("Directions from your location"), "directions still one click away");
  // TRUTH LAW: no verified Place ID in this intake => the review CTA renders nothing.
  assert.ok(!serviceAreas.includes("writereview"), "no review CTA without a Place ID");
  const city = out["service-area/marana.html"].toString("utf8");
  assert.ok(city.includes("map-facade"), "each locality chapter carries the map embed");
});

// ---------------------------------------------------------------------------
// (b) measure-runtime metrics appear in gate evidence
// ---------------------------------------------------------------------------
test("collectVitals reports LCP/INP/CLS/TTFB from an open page and never throws", async () => {
  const { page } = fakeChromium();
  const vitals = await collectVitals(page);
  assert.equal(vitals.status, "measured");
  assert.equal(vitals.lcp_ms, 1876);
  assert.equal(vitals.cls, 0.012);
  assert.equal(vitals.inp_ms, 91);
  assert.equal(vitals.inp_kind, "synthetic");
  assert.equal(vitals.ttfb_ms, 143);
  assert.equal(vitals.protocol, "h2");
  assert.equal(vitals.compressed, true);
  assert.deepEqual(vitals.budget, { lcp: 2000, inp: 200, cls: 0.05, ttfb: 600 });
  // A page whose evaluate explodes must yield "unavailable", not an exception.
  const broken = await collectVitals({ evaluate: async () => { throw new Error("detached"); } });
  assert.equal(broken.status, "unavailable");
});

test("the render gate's Chromium pass carries Core Web Vitals in its evidence", async () => {
  const chrome = fakeChromium({ lcp: 2100.9, cls: 0.004, ttfb: 96.1, inp: 61.7 });
  const verdict = await renderCheckOnce("https://wss-test.example/", { launch: chrome.launch });
  assert.equal(verdict.status, "passed");
  assert.equal(verdict.web_vitals.status, "measured", "gate evidence includes the vitals");
  assert.equal(verdict.web_vitals.lcp_ms, 2101);
  assert.equal(verdict.web_vitals.cls, 0.004);
  assert.equal(verdict.web_vitals.inp_ms, 62);
  assert.equal(verdict.web_vitals.ttfb_ms, 96);
  // Evidence, never a verdict: an LCP over budget does not fail the gate.
  assert.ok(!JSON.stringify(verdict.problems || []).includes("lcp"), "vitals never join problems[]");
});

test("a full build's manifest carries checks.render.web_vitals from the real gate", async () => {
  const { manifest } = await buildWave4Site();
  const vitals = manifest.checks.render && manifest.checks.render.web_vitals;
  assert.ok(vitals, "checks.render.web_vitals exists in gate evidence");
  assert.equal(vitals.status, "measured");
  for (const key of ["lcp_ms", "cls", "inp_ms", "ttfb_ms", "protocol", "compressed", "budget"]) {
    assert.ok(key in vitals, `web_vitals.${key} present`);
  }
  assert.equal(vitals.lcp_ms, 1876);
});

// ---------------------------------------------------------------------------
// (c) per-service pages are generated with correct slugs and schema
// ---------------------------------------------------------------------------
test("one page per verified service: slug from the name, description as lede, Service schema", async () => {
  const { out, manifest } = await buildWave4Site();
  for (const file of ["roof-repair.html", "storm-restoration.html", "gutter-cleaning-and-guard-installation.html"]) {
    assert.ok(out[file], `${file} must be generated`);
  }
  const rr = out["roof-repair.html"].toString("utf8");
  assert.ok(rr.includes("Roof Repair in Tucson"), "service name + market in the h1");
  assert.ok(rr.includes("Repairs for verified roof damage"), "the service description is the page lede");
  const ld = JSON.parse(rr.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const service = ld["@graph"].find((n) => n["@type"] === "Service");
  assert.equal(service.name, "Roof Repair");
  assert.equal(service.serviceType, "Roof Repair");
  assert.equal(service.url, "https://wss-test-obrien-and-sons-roofing.wss-ai.com/roof-repair");
  // The engine normalizes the straight apostrophe to the typographic one.
  assert.equal(service.provider.name, "O’Brien & Sons Roofing");
  assert.equal(service.areaServed[0].name, "Tucson");
  assert.ok(ld["@graph"].some((n) => n["@type"] === "BreadcrumbList"), "breadcrumb schema per service page");
  assert.ok(ld["@graph"].some((n) => n["@type"] === "Article"), "article schema per service page");
  const pages = manifest.checks.content.authority_pages;
  for (const p of ["/roof-repair", "/storm-restoration", "/gutter-cleaning-and-guard-installation"]) {
    assert.ok(pages.includes(p), `${p} in the authority report`);
  }
});

test("direct engine callers cannot publish phone or email labels as service routes", async () => {
  const harness = makeDeps();
  const request = {
    ...wave4Request(),
    slug: "wss-test-publish-door-555",
    facts: {
      ...FACTS,
      business_name: "Publish Door Roofing",
    },
    content: {
      ...CONTENT,
      services: [
        { name: "[Call 520-555-0142](tel:+15205550142)" },
        { name: "[Email dispatch@publish-door.example](mailto:dispatch@publish-door.example)" },
        { name: "520-555-0142" },
        { name: "dispatch@publish-door.example" },
        { name: "24/7 Emergency Roof Repair", description: "Emergency roof repairs offered around the clock." },
      ],
    },
  };

  const res = await mirror(request, { registry: createRegistry(), deps: harness.deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));

  const manifest = res.body;
  const authorityRoutes = manifest.checks.content.authority_pages;
  const linkedRoutes = manifest.checks.routes.linked_paths;
  const renderedRoutes = manifest.checks.route_render.pages.map((page) => page.path);
  const forbiddenRoutes = [
    "/call-520-555-0142-tel-15205550142",
    "/email-dispatch-publish-door-example-mailto-dispatch-publish",
    "/520-555-0142",
    "/dispatch-publish-door-example",
  ];

  for (const routes of [authorityRoutes, linkedRoutes, renderedRoutes]) {
    assert.ok(routes.includes("/24-7-emergency-roof-repair"), "real numeric service route remains publishable");
    for (const forbidden of forbiddenRoutes) {
      assert.ok(!routes.includes(forbidden), `${forbidden} must not appear in signed route evidence`);
    }
    assert.ok(!routes.some((route) => /(?:555-0142|dispatch-publish-door|mailto|tel-)/i.test(route)), "contact labels never become routes");
  }

  const sanitized = sanitizeRowPayload(manifest);
  assert.equal(signEvidence(sanitized), sanitized.evidence_sha, "release evidence signature survives row sanitization");
});

test("duplicate and reserved service slugs never shadow a real route", () => {
  const localPlan = buildLocalSearchPlan({
    profile: { city: "Tucson", state: "AZ", industry: "Roofing" },
    services: ["Roof Repair", "About"],
    evidence: { source: "existing_site", serviceAreas: [], localities: [] },
  });
  const out = authorityPages.build({
    facts: FACTS,
    phoneDigits: "5205550142",
    slug: "wss-test-obrien",
    content: { services: [{ name: "Roof Repair" }, { name: "roof repair" }, { name: "About" }, { name: "Team" }] },
    research: null,
    cssHref: "",
    localPlan,
    maxServicePages: 4,
    maxServiceAreaPages: 4,
  });
  assert.deepEqual(out.report.pages, ["/about", "/roof-repair"], "dup collapses, reserved About/Team are skipped");
  assert.ok(out.report.skipped_pages.some((s) => s.page === "/about" && s.reason === "slug_reserved_or_duplicate"), "skip is recorded, not silent");
});

// ---------------------------------------------------------------------------
// (d) no orphan pages — every generated page is linked from the index
// ---------------------------------------------------------------------------
test("every authority page, service page and locality chapter is linked from the index and the sitemap", async () => {
  const { out, manifest } = await buildWave4Site();
  const index = out["index.html"].toString("utf8");
  const pages = manifest.checks.content.authority_pages;
  assert.ok(pages.length >= 8, `expected the full multi-page set, got ${pages.length}`);
  for (const p of pages) {
    assert.ok(index.includes(`href="${p}"`), `index.html does not link ${p} — orphan page`);
  }
  const sitemap = out["sitemap.xml"].toString("utf8");
  for (const p of pages) {
    assert.ok(sitemap.includes(`>${`https://wss-test-obrien-and-sons-roofing.wss-ai.com/${p.replace(/^\//, "")}`}<`), `sitemap.xml omits ${p}`);
  }
  // No page links to a page that did not ship.
  const shipped = new Set(["/", ...pages]);
  for (const [rel, buf] of Object.entries(out)) {
    if (!/\.html$/i.test(rel) || rel === "index.html" || rel === "404.html") continue;
    const html = buf.toString("utf8");
    for (const m of html.matchAll(/href="(\/[a-z0-9-]*(?:\/[a-z0-9-]*)*)"/g)) {
      assert.ok(shipped.has(m[1]), `${rel} links to ${m[1]}, which did not ship`);
    }
  }
});

test("the render audit walks the new page types, not just the old four", async () => {
  const { calls } = await buildWave4Site();
  const auditCall = calls.find(([name]) => name === "renderAudit");
  assert.ok(auditCall, "renderAudit ran");
  const paths = auditCall[1];
  for (const p of ["/about", "/roof-repair", "/service-area/marana", "/service-area/oro-valley"]) {
    assert.ok(paths.includes(p), `render audit does not walk ${p}`);
  }
});
