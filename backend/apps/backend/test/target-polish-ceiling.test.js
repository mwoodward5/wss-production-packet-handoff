"use strict";

// test/target-polish-ceiling.test.js — the heavy-target admission cap, pinned.
//
// Owner directive (2026-09-03, the #689 targeting-tighten): the heavy,
// polished roofing prospect site was ruled "not a good site for rebuilding —
// too heavy of a site." PR #694's integration-gap scoring RANKS thin sites
// first, but ranking only orders: when a market's thin pool exhausts, the
// build pool still admitted heavy sites to fill the requested count. This cap
// is the admission ceiling on original-site polish:
//
//   TARGET_MAX_POLISH (lib/line-quota.js, default 75, literal 0 = disabled)
//   polish = 100 - the measured #694 integration-gap score; unmeasured = 0.
//   A candidate whose polish EXCEEDS the ceiling is skipped at stage 2 with
//   the recorded reason `target_too_polished:skip` — never silent.
//
// The zone-flood "record never refuse" law governs OUR build quality
// ceilings; TARGET SELECTION may skip with a recorded reason. So:
//
//   a) while thinner candidates exist, only they flow (ranking already seats
//      them first; the cap removes the heavyweight class entirely);
//   b) an ALL-heavy window UNDER-FILLS — fewer rows, honest halt/wait for
//      refill — never force-fills with the class the owner rejected.
//
// The dial-off ranking law (#694 exactly as shipped) stays pinned in
// thin-targeting.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mineBuildReady,
  integrationGapFromHomepage,
  targetPolishScore,
  polishAdmissionVerdict,
  TARGET_POLISH_SKIP_REASON,
} = require("../lib/lead-miner");
const {
  targetMaxPolish,
  TARGET_MAX_POLISH_DEFAULT,
  TARGET_MAX_POLISH_ENV,
} = require("../lib/line-quota");

const stageRow = (out, name) => (out.funnel || []).find((stage) => stage.stage === name);

// ---------------------------------------------------------------------------
// Fixtures — the thin contractor and the LOA class, off the #694 file
// ---------------------------------------------------------------------------

// A basic contractor homepage: real schema identity, an email, and nothing a
// rebuild would sell. Every integration is missing — the BEST target class.
const THIN_HOME = `<!doctype html><html><head>
  <title>Duke Plumbing | Spokane WA</title>
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Duke Plumbing",
    telephone: "(509) 555-0142",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Spokane",
      addressRegion: "WA",
      postalCode: "99201",
    },
  })}</script>
</head><body>
  <h1>Duke Plumbing</h1>
  <p>Plumbing repairs and water heaters in Spokane.</p>
  <a href="mailto:hello@dukeplumbing.example">Email us</a>
</body></html>`;

// The LOA-Roofing class the owner rejected: modern framework stack, real
// depth, LocalBusiness schema, a third-party review widget, a Maps embed,
// owned socials, and a booking flow. Everything the rebuild would sell is
// already there — polish 100.
const loaHome = (name, domain, phone) => `<!doctype html><html><head>
  <title>${name} | Spokane WA</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name,
    telephone: phone,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Spokane",
      addressRegion: "WA",
      postalCode: "99201",
    },
  })}</script>
  <script>window.__NEXT_DATA__ = {"props":{}};</script>
</head><body>
  <h1>${name}</h1>
  <p>${"Repairs, replacements and maintenance. Read our reviews from Spokane families. ".repeat(12)}</p>
  <div class="trustpilot-widget" data-businessunit="apex-plumbing">Trustpilot reviews</div>
  <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12" title="Find us"></iframe>
  <a href="https://www.facebook.com/apexplumbingwa">Facebook</a>
  <a href="https://www.instagram.com/apexplumbingwa">Instagram</a>
  <a href="https://calendly.com/apexplumbing/service-call">Book a service call</a>
  <a href="/services">Our services</a>
  <a href="mailto:hello@${domain}">Email us</a>
</body></html>`;

const LOA_HOME = loaHome("Apex Plumbing & Water Heaters", "apexplumbing.example", "(509) 555-0188");
const LOA2_HOME = loaHome("Pinnacle Plumbing & Drain", "pinnacleplumbing.example", "(509) 555-0177");

const THIN_PROBE = { hasSchema: true, hasReviews: false, modernPremium: false };
const LOA_PROBE = { hasSchema: true, hasReviews: true, modernPremium: true };

const loaGap = () => integrationGapFromHomepage({
  html: LOA_HOME,
  probe: LOA_PROBE,
  parsed: { modernStack: true },
  social: { facebook: "https://www.facebook.com/apexplumbingwa" },
  ownedProfiles: [],
});
const thinGap = () => integrationGapFromHomepage({
  html: THIN_HOME,
  probe: THIN_PROBE,
  parsed: {},
  social: {},
  ownedProfiles: [],
});

// ---------------------------------------------------------------------------
// 1. The dial — TARGET_MAX_POLISH, LINE_DEEP_BATCH_DEPTH's idiom
// ---------------------------------------------------------------------------

test("targetMaxPolish: unset/blank/non-numeric keeps the calibrated default, 0 disables, 100 is the scale ceiling", () => {
  assert.equal(TARGET_MAX_POLISH_DEFAULT, 75, "the calibrated default this file pins");
  assert.equal(targetMaxPolish({}), 75);
  assert.equal(targetMaxPolish({ [TARGET_MAX_POLISH_ENV]: "" }), 75);
  assert.equal(targetMaxPolish({ [TARGET_MAX_POLISH_ENV]: "not-a-number" }), 75);
  assert.equal(targetMaxPolish({ [TARGET_MAX_POLISH_ENV]: "-5" }), 75,
    "a negative is a typo, not the documented kill switch");
  assert.equal(targetMaxPolish({ [TARGET_MAX_POLISH_ENV]: "0" }), 0, "literal 0 = disabled");
  assert.equal(targetMaxPolish({ [TARGET_MAX_POLISH_ENV]: "60" }), 60, "the owner can loosen/tighten");
  assert.equal(targetMaxPolish({ [TARGET_MAX_POLISH_ENV]: "999" }), 100,
    "beyond the scale ceiling is a typo, not a dial");
});

// ---------------------------------------------------------------------------
// 2. The verdict — pure, off the #694 measurement
// ---------------------------------------------------------------------------

test("the LOA-class heavyweight the owner rejected is over the ceiling; the basic contractor site is under it", () => {
  const rejectedSite = loaGap();
  assert.equal(rejectedSite.score, 0, "the fixture really is the fully-integrated class");
  assert.equal(targetPolishScore(rejectedSite), 100);

  const contractor = thinGap();
  assert.ok(contractor.score >= 80, "the fixture really is the un-integrated class");
  assert.ok(targetPolishScore(contractor) <= 20);

  const skip = polishAdmissionVerdict(rejectedSite, {});
  assert.ok(skip, "the rejected site class is skipped at the default dial");
  assert.equal(skip.reason, TARGET_POLISH_SKIP_REASON);
  assert.equal(skip.polish, 100);
  assert.equal(skip.ceiling, 75);

  assert.equal(polishAdmissionVerdict(contractor, {}), null, "the basic contractor site flows");
});

test("the calibration boundary: two of four headline integrations still flow, three or more are capped", () => {
  // Reviews widget + socials present, maps and booking missing: gap 35,
  // polish 65 — the admitted boundary at the default ceiling of 75.
  const midtier = integrationGapFromHomepage({
    html: '<div class="trustpilot-widget">Reviews</div><a href="https://facebook.com/shop">Facebook</a>',
    probe: { hasSchema: true, hasReviews: true, modernPremium: false },
    parsed: {},
    social: { facebook: "https://facebook.com/shop" },
    ownedProfiles: [],
  });
  assert.equal(midtier.score, 35);
  assert.equal(targetPolishScore(midtier), 65);
  assert.equal(polishAdmissionVerdict(midtier, {}), null,
    "a reviews-widget midtier site still flows — the dial must not eat the whole market");

  // Reviews, socials and maps present, only booking missing: gap 20, polish
  // 80 — over the default ceiling; booking alone is not a rebuild pitch.
  const integrated = integrationGapFromHomepage({
    html: '<div class="trustpilot-widget">Reviews</div>'
      + '<a href="https://facebook.com/shop">Facebook</a>'
      + '<iframe src="https://www.google.com/maps/embed?pb=x"></iframe>',
    probe: { hasSchema: true, hasReviews: true, modernPremium: false },
    parsed: {},
    social: { facebook: "https://facebook.com/shop" },
    ownedProfiles: [],
  });
  assert.equal(integrated.score, 20);
  assert.ok(polishAdmissionVerdict(integrated, {}), "the >=3-integration class is too polished to rebuild");
});

test("a measured modern-premium site (capped gap 10 -> polish 90) is over the ceiling; unmeasured rows never trip it", () => {
  const capped = integrationGapFromHomepage({
    html: THIN_HOME,
    probe: { hasSchema: true, hasReviews: false, modernPremium: true },
    parsed: {},
    social: {},
    ownedProfiles: [],
  });
  assert.equal(capped.score, 10, "the modern-premium cap from #694");
  const skip = polishAdmissionVerdict(capped, {});
  assert.ok(skip, "a measured modern-premium heavyweight is the wrong target class");
  assert.equal(skip.polish, 90);

  assert.equal(targetPolishScore({ measured: false, gap: false, gaps: [], score: 0, signals: [] }), 0,
    "unmeasured polish is assumed absent, never assumed present");
  assert.equal(polishAdmissionVerdict({ measured: false, gap: false, gaps: [], score: 0, signals: [] }, {}), null);
  assert.equal(polishAdmissionVerdict(null, {}), null);
});

test("TARGET_MAX_POLISH=0 disables the ceiling: even a polish-100 heavyweight returns no verdict", () => {
  assert.equal(polishAdmissionVerdict(loaGap(), { TARGET_MAX_POLISH: "0" }), null);
});

// ---------------------------------------------------------------------------
// 3. The funnel — skip recorded, thin flows, under-fill honest (e2e)
// ---------------------------------------------------------------------------

function polishCapFetchImpl() {
  return async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      // The heavyweight is discovered FIRST on purpose: without the cap the
      // #694 ranking would still seat the thin target first, but the pool
      // used to admit the heavyweight whenever the count asked for it.
      return new Response(JSON.stringify({
        data: [
          { url: "https://apexplumbing.example/", title: "Apex Plumbing & Water Heaters | Spokane WA" },
          { url: "https://dukeplumbing.example/", title: "Duke Plumbing | Spokane WA" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/apexplumbing\.example/.test(href)) return new Response(LOA_HOME, { status: 200, headers: { "content-type": "text/html" } });
    if (/pinnacleplumbing\.example/.test(href)) return new Response(LOA2_HOME, { status: 200, headers: { "content-type": "text/html" } });
    if (/dukeplumbing\.example/.test(href)) return new Response(THIN_HOME, { status: 200, headers: { "content-type": "text/html" } });
    throw new Error(`unstubbed fetch: ${href}`);
  };
}

function allHeavyFetchImpl() {
  return async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({
        data: [
          { url: "https://apexplumbing.example/", title: "Apex Plumbing & Water Heaters | Spokane WA" },
          { url: "https://pinnacleplumbing.example/", title: "Pinnacle Plumbing & Drain | Spokane WA" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/apexplumbing\.example/.test(href)) return new Response(LOA_HOME, { status: 200, headers: { "content-type": "text/html" } });
    if (/pinnacleplumbing\.example/.test(href)) return new Response(LOA2_HOME, { status: 200, headers: { "content-type": "text/html" } });
    throw new Error(`unstubbed fetch: ${href}`);
  };
}

function polishCapInput(envOverrides = {}, fetchImpl = polishCapFetchImpl()) {
  return {
    trigger: "operator_line",
    lane: "live",
    queries: [{ industry: "plumbing", location: "Spokane WA", textQuery: "plumbing in Spokane WA", queryGroup: 0 }],
    candidatesPerQuery: 2,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GOOGLE_PLACES_API_KEY: "places-key-that-must-not-be-used",
      GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "0",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "0",
      GHOST_AGENCY_MAPS_DISCOVERY: "0",
      GHOST_AGENCY_IDENTITY_TRUST: "0",
      // The default dial is ON for every run here unless overridden below.
      ...envOverrides,
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => ({
      ok: true,
      status: 200,
      body: {
        ok: true, build_hash: "polish-cap-hash", donor_content_hash: "donor", file_count: 51,
        evidence_sha: "sha", renderer: "mirror-engine@v1",
        checks: { brand: { status: "passed", logo_refs_in_output: 0 } },
      },
    }),
  };
}

test("mission (a): the heavy site is skipped with the recorded reason while the thin site flows", async () => {
  const out = await mineBuildReady(polishCapInput());
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));

  // Both homepages were FETCHED and measured — the cap decides on evidence,
  // never on a guess.
  assert.equal(Number(out.cost.homepage_fetches) || 0, 2, "both homepages were measured");

  // The thin site is the only record; the heavyweight never reached deep
  // verification, let alone a dry-run build.
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  assert.equal(out.records[0].discovery.domain, "dukeplumbing.example");
  assert.ok(out.records[0].qualification.integration_gap.gap, "the flowing record keeps its #694 provenance");

  // THE RECORDED SKIP — on the funnel stage, like every other refusal.
  const s2 = stageRow(out, "2_homepage_fetch");
  assert.equal(s2.rejected[TARGET_POLISH_SKIP_REASON], 1,
    "the skip is counted on the stage the measurement happened");
  assert.ok(out.rejects.some((item) => item.stage === "2_homepage_fetch"
    && item.reason === TARGET_POLISH_SKIP_REASON
    && /polish 100\/100 over TARGET_MAX_POLISH=75/.test(String(item.detail || ""))),
    "the reject list names the polish, the ceiling and the forgone upside");
  const identity = stageRow(out, "6_first_party_identity");
  assert.equal(identity.entered, 1, "only the thin candidate entered the deep-verification pool");
  assert.equal(Number(out.cost.dry_runs) || 0, 1, "no dry-run build was spent on the heavyweight");

  for (const stage of out.funnel || []) {
    const rejected = Object.values(stage.rejected || {}).reduce((sum, n) => sum + n, 0);
    assert.equal(stage.entered, stage.survived + rejected, `${stage.stage}: the funnel still reconciles`);
  }
});

test("mission (b): an all-heavy window UNDER-FILLS instead of force-filling with the rejected class", async () => {
  const out = await mineBuildReady(polishCapInput({}, allHeavyFetchImpl()));
  assert.equal(out.ok, true, "an honest empty mine is a supply statement, not an error");
  assert.equal(Number(out.cost.homepage_fetches) || 0, 2, "both heavyweights were measured before being refused");

  // Fewer rows than requested — never a force-fill. The quota controller
  // records the shortfall on this funnel and rotates the source; when every
  // window is heavy the batch halts honestly and waits for refill.
  assert.equal(out.records.length, 0, "no heavyweight was built to fill the count");
  const s2 = stageRow(out, "2_homepage_fetch");
  assert.equal(s2.rejected[TARGET_POLISH_SKIP_REASON], 2,
    "every skipped heavyweight is counted by name, never silent");
  const identity = stageRow(out, "6_first_party_identity");
  assert.equal(identity.entered, 0);
  assert.equal(Number(out.cost.dry_runs) || 0, 0);

  for (const stage of out.funnel || []) {
    const rejected = Object.values(stage.rejected || {}).reduce((sum, n) => sum + n, 0);
    assert.equal(stage.entered, stage.survived + rejected, `${stage.stage}: the funnel still reconciles`);
  }
});

test("mission (c): TARGET_MAX_POLISH=0 disables the ceiling — the #694 ranking-only behavior returns", async () => {
  const out = await mineBuildReady(polishCapInput({ TARGET_MAX_POLISH: "0" }));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));
  assert.equal(out.records.length, 2, "with the dial off nobody is skipped");
  assert.equal(out.records[0].discovery.domain, "dukeplumbing.example", "the thin target still ranks first");
  assert.equal(out.records[1].discovery.domain, "apexplumbing.example", "the heavyweight flows when the owner loosens the dial");
  const s2 = stageRow(out, "2_homepage_fetch");
  assert.equal(s2.rejected[TARGET_POLISH_SKIP_REASON], undefined);
  for (const stage of out.funnel || []) {
    const rejected = Object.values(stage.rejected || {}).reduce((sum, n) => sum + n, 0);
    assert.equal(stage.entered, stage.survived + rejected, `${stage.stage}: the funnel still reconciles`);
  }
});

test("the dial is honored mid-scale: TARGET_MAX_POLISH=90 admits the capped modern-premium class, keeps the full-integration class out", async () => {
  // The default rejects the modern-premium-capped class (polish 90). The
  // owner loosening the dial to exactly 90 re-admits it while the fully
  // integrated heavyweight (polish 100) stays out — the dial is a real
  // targeting control, not an on/off switch.
  const capped = integrationGapFromHomepage({
    html: THIN_HOME,
    probe: { hasSchema: true, hasReviews: false, modernPremium: true },
    parsed: {},
    social: {},
    ownedProfiles: [],
  });
  assert.equal(polishAdmissionVerdict(capped, { TARGET_MAX_POLISH: "90" }), null,
    "polish 90 flows at ceiling 90 — the skip is strictly-greater");
  const full = loaGap();
  const skip = polishAdmissionVerdict(full, { TARGET_MAX_POLISH: "90" });
  assert.ok(skip && skip.polish === 100, "the full-integration heavyweight stays skipped");
});
