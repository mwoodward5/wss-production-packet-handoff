"use strict";

/**
 * test/name-plausibility.test.js — IDENTITY PLAUSIBILITY SCREEN
 * (audit A2 defect 2; issue #700 class).
 *
 * Production escapes this suite pins shut:
 *
 *   1. "21,030 live jobs on FOX8 Jobs" (jobs.fox8.com) passed
 *      6_first_party_identity as a PLUMBING business in Columbia SC — the job
 *      board publishes schema.org name + PostalAddress, so the structured
 *      gate had nothing to refuse — and shipped live in a SENT site's
 *      title/header/hero/contact/footer.
 *   2. "TexAgs - Texas A&M Football, Recruiting, News & Forums" (issue #700)
 *      — a fan forum admitted as a roofing prospect the same way.
 *
 * The screen is TIGHT and name-field-only: unusual-but-real names
 * ("24/7 Emergency Plumbing LLC", "411 Plumbing", "Job's Plumbing") must
 * flow. Every refusal is RECORDED on the funnel (thin-flow law: record,
 * never refuse the batch) — the funnel must reconcile and the batch must
 * continue past a gated candidate.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  businessNamePlausibility,
  ugcPlatformMarkersFromHomepage,
} = require("../lib/name-plausibility");
const { mineBuildReady } = require("../lib/lead-miner");

// ---------------------------------------------------------------------------
// Unit: the name-field screen
// ---------------------------------------------------------------------------

test("the FOX8 escape is rejected as a count phrase and the evidence is recorded", () => {
  const verdict = businessNamePlausibility({ name: "21,030 live jobs on FOX8 Jobs" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "business_name_count_phrase");
  assert.ok(verdict.signals.some((s) => /count phrase/.test(s)), JSON.stringify(verdict.signals));
  assert.ok(verdict.signals.some((s) => /platform head noun/.test(s)), JSON.stringify(verdict.signals));
});

test("plain digit counts with counting nouns are rejected (no comma grouping needed)", () => {
  assert.equal(businessNamePlausibility({ name: "4,832 job listings in Columbia" }).ok, false);
  assert.equal(businessNamePlausibility({ name: "250 results near Austin" }).ok, false);
  assert.equal(businessNamePlausibility({ name: "1320 classifieds for plumbing" }).ok, false);
});

test("the TexAgs escape (#700) is rejected as a platform head noun", () => {
  const verdict = businessNamePlausibility({ name: "TexAgs - Texas A&M Football, Recruiting, News & Forums" });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "business_name_platform_noun");
  assert.ok(verdict.signals.some((s) => /forums/.test(s)), JSON.stringify(verdict.signals));
});

test("board/directory/classifieds/news head nouns are platform pages, not entities", () => {
  assert.equal(businessNamePlausibility({ name: "FOX8 Jobs" }).ok, false);
  assert.equal(businessNamePlausibility({ name: "Columbia SC Classifieds" }).ok, false);
  assert.equal(businessNamePlausibility({ name: "Austin Roofing Directory" }).ok, false);
  assert.equal(businessNamePlausibility({ name: "Hawaii Community Board" }).ok, false);
});

test("unusual-but-real business names PASS: digits, possessives and mid-name platform words never fire alone", () => {
  for (const name of [
    "24/7 Emergency Plumbing LLC",
    "411 Plumbing & Drain",
    "2 Men And A Truck Plumbing",
    "A-1 Fence Company",
    "1000 Flushes Plumbing LLC",
    "Job's Plumbing & Repair",
    "Community Heating & Cooling",
    "The Good News Plumbing Co",
    "Tankless Water Heater Specialists of Columbia SC",
    "Sal's Heating & Cooling, Plumbing & Sewer",
    "Poor John's Plumbing",
  ]) {
    const verdict = businessNamePlausibility({ name });
    assert.equal(verdict.ok, true, `${name} must pass — got ${JSON.stringify(verdict)}`);
  }
});

test("thin real names pass and an empty name is not this screen's refusal", () => {
  assert.equal(businessNamePlausibility({ name: "Ray's Plumbing" }).ok, true);
  assert.equal(businessNamePlausibility({ name: "  " }).ok, true);
  assert.deepEqual(businessNamePlausibility({ name: "" }).signals, []);
});

// ---------------------------------------------------------------------------
// Unit: the #700 forum/board/UGC homepage markers (measured at 2_homepage_fetch)
// ---------------------------------------------------------------------------

const TEXAGS_LIKE_HTML = `<!doctype html><html><head><title>TexAgs - Texas A&amp;M Football, Recruiting, News &amp; Forums</title>
<script src="/js/xenforo/full.js"></script></head><body>
<a href="/login/">Log in</a> <a href="/register/">Register</a>
<nav><a href="/forums/football.12/">Football</a> <a href="/threads/recruiting-update.512041/">Recruiting Update</a>
<a href="/threads/depth-chart.512038/">Depth chart</a> <a href="/threads/gameday-thread.512033/">Gameday</a>
<a href="/members/">Members</a></nav>
<p>12,041 posts · 301 replies · members online</p></body></html>`;

const FOX8_LIKE_HTML = `<!doctype html><html><head><title>21,030 Live Jobs on FOX8 Jobs</title></head><body>
<h1>21,030 Live Jobs on FOX8 Jobs</h1>
<nav><a href="/jobs">Browse Jobs</a> <a href="/search">Search Jobs</a> <a href="/post">Post a Job</a></nav>
<ul><li><a href="/job/warehouse-associate/12345">Warehouse Associate</a></li></ul>
</body></html>`;

const PLUMBER_CAREERS_HTML = `<!doctype html><html><head><title>24/7 Emergency Plumbing LLC | Louisville KY</title></head><body>
<h1>24/7 Emergency Plumbing LLC</h1><p>Drain cleaning and water heater repair.</p>
<a href="/careers">Careers — search jobs</a> <a href="/community">Community sponsorships</a>
</body></html>`;

const FOOTER_FORUM_LINK_HTML = `<!doctype html><html><head><title>Rimrock Plumbing | Billings MT</title></head><body>
<h1>Rimrock Plumbing</h1><p>Plumbing repairs.</p><a href="https://neighbors.example.com/forums/plumbing-tips.9/">Neighbor tips</a>
</body></html>`;

test("a TexAgs-class forum page fires ≥2 marker families", () => {
  const verdict = ugcPlatformMarkersFromHomepage({
    html: TEXAGS_LIKE_HTML,
    title: "TexAgs - Texas A&M Football, Recruiting, News & Forums",
    h1: "Texas A&M Football",
  });
  assert.equal(verdict.measured, true);
  assert.ok(verdict.families.length >= 2, JSON.stringify(verdict));
  assert.ok(verdict.families.includes("forum_software"));
  assert.ok(verdict.families.includes("thread_urls"));
  assert.equal(verdict.platform, true);
});

test("a FOX8-class job board fires job-board UI plus the count title", () => {
  const verdict = ugcPlatformMarkersFromHomepage({
    html: FOX8_LIKE_HTML,
    title: "21,030 Live Jobs on FOX8 Jobs",
    h1: "21,030 Live Jobs on FOX8 Jobs",
  });
  assert.ok(verdict.families.includes("job_board_ui"), JSON.stringify(verdict));
  assert.ok(verdict.families.includes("count_title"), JSON.stringify(verdict));
  assert.equal(verdict.platform, true);
});

test("one weak family never refuses a real business: careers nav and footer forum links pass", () => {
  const careers = ugcPlatformMarkersFromHomepage({
    html: PLUMBER_CAREERS_HTML,
    title: "24/7 Emergency Plumbing LLC | Louisville KY",
    h1: "24/7 Emergency Plumbing LLC",
  });
  assert.equal(careers.platform, false, JSON.stringify(careers));
  const footer = ugcPlatformMarkersFromHomepage({
    html: FOOTER_FORUM_LINK_HTML,
    title: "Rimrock Plumbing | Billings MT",
    h1: "Rimrock Plumbing",
  });
  assert.equal(footer.platform, false, JSON.stringify(footer));
});

test("empty HTML is unmeasured, never a refusal", () => {
  assert.deepEqual(
    ugcPlatformMarkersFromHomepage({ html: "" }),
    { platform: false, families: [], signals: [], measured: false },
  );
});

// ---------------------------------------------------------------------------
// Funnel: the exact owner-only lane that shipped both escapes
// ---------------------------------------------------------------------------

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const FIRECRAWL_SCRAPE = "https://api.firecrawl.dev/v2/scrape";

function mirrorPass() {
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      build_hash: "build-hash",
      donor_content_hash: "donor-hash",
      file_count: 51,
      evidence_sha: "evidence-sha",
      renderer: "mirror-engine@v1",
      checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
    },
  };
}

const FOX8_SITE = "https://jobs.fox8.example/";
const FORUM_SITE = "https://forums.example/";
const ODD_NAME_SITE = "https://24-7-emergency-plumbing.example/";

// Structured first-party identity, exactly as the job board published it:
// schema.org name + PostalAddress COMPLETE — the identity gate itself had
// nothing to refuse. The screen must catch the NAME.
const FOX8_FUNNEL_HTML = `<!doctype html><html><head><title>21,030 Live Jobs on FOX8 Jobs | Columbia SC</title>
<script type="application/ld+json">{
  "@type": "LocalBusiness",
  "name": "21,030 live jobs on FOX8 Jobs",
  "telephone": "(803) 555-0100",
  "address": { "@type": "PostalAddress", "addressLocality": "Louisville", "addressRegion": "KY", "postalCode": "40202" }
}</script></head><body>
<h1>21,030 Live Jobs on FOX8 Jobs</h1>
<nav><a href="/jobs">Browse Jobs</a> <a href="/search">Search Jobs</a> <a href="/post">Post a Job</a></nav>
<a href="mailto:jobs@fox8.example">Email</a></body></html>`;

// An INNOCENT name on a forum platform: the name screen cannot fire ("hub"
// is not a platform head noun) — the homepage markers must be what refuses.
const FORUM_FUNNEL_HTML = `<!doctype html><html><head><title>Aggie Community Hub | Louisville KY</title>
<script type="application/ld+json">{
  "@type": "LocalBusiness",
  "name": "Aggie Community Hub",
  "telephone": "(502) 555-0177",
  "address": { "@type": "PostalAddress", "addressLocality": "Louisville", "addressRegion": "KY", "postalCode": "40202" }
}</script></head><body>
<h1>Aggie Community Hub</h1>
<script src="/js/xenforo/full.js"></script>
<a href="/login/">Log in</a> <a href="/register/">Register</a>
<a href="/forums/football.12/">Football</a> <a href="/threads/recruiting.512041/">Recruiting</a>
<a href="/threads/gameday.512033/">Gameday</a> <a href="/threads/parking.512030/">Parking</a>
<p>posts · replies · members online</p>
<a href="mailto:hub@forums.example">Email</a></body></html>`;

// Unusual-but-real: digits in the name, complete structured identity, and a
// single weak UGC family (the careers nav). Must FLOW to a record.
const ODD_NAME_FUNNEL_HTML = `<!doctype html><html><head><title>24/7 Emergency Plumbing LLC | Louisville KY</title>
<script type="application/ld+json">{
  "@type": "LocalBusiness",
  "name": "24/7 Emergency Plumbing LLC",
  "telephone": "(502) 555-0100",
  "address": { "@type": "PostalAddress", "addressLocality": "Louisville", "addressRegion": "KY", "postalCode": "40202" }
}</script></head><body>
<h1>24/7 Emergency Plumbing LLC</h1><p>Drain cleaning and water heater repair.</p>
<section class="services"><h2>Services</h2><h3>Drain Cleaning</h3><h3>Water Heater Repair</h3></section>
<a href="/careers">Careers — search jobs</a>
<a href="mailto:emergency@24-7-plumbing.example">Email</a></body></html>`;

function funnelFetch({ pages }) {
  return async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    const method = String(init.method || "GET").toUpperCase();
    if (href === FIRECRAWL_SEARCH && method === "POST") {
      return new Response(JSON.stringify({
        data: Object.keys(pages).map((u) => ({ url: u, title: "Fixture candidate" })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === FIRECRAWL_SCRAPE && method === "POST") {
      // Maps-discovery scrape lane: benign empty page.
      return new Response(JSON.stringify({ success: true, data: { links: [], html: "" } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (method === "GET" && (pages[href] || pages[`${href}/`])) {
      return new Response(pages[href] || pages[`${href}/`], {
        status: 200, headers: { "content-type": "text/html" },
      });
    }
    throw new Error(`unstubbed fetch: ${method} ${href}`);
  };
}

function funnelInput(pages) {
  return {
    trigger: "operator_line",
    lane: "sandbox",
    queries: [{
      industry: "plumbing",
      location: "Louisville KY",
      textQuery: "plumbing in Louisville KY",
      queryGroup: 0,
    }],
    candidatesPerQuery: 1,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "0",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
    },
    fetchImpl: funnelFetch({ pages }),
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
  };
}

async function withGlobalFetch(fetchImpl, run) {
  const real = global.fetch;
  global.fetch = fetchImpl;
  try { return await run(); } finally { global.fetch = real; }
}

function stageByName(funnel, name) {
  return funnel.find((stage) => stage.stage === name);
}

function assertFunnelReconciles(funnel) {
  for (const stage of funnel) {
    const rejected = Object.values(stage.rejected).reduce((a, b) => a + b, 0);
    assert.equal(stage.entered, stage.survived + rejected, `${stage.stage}: entered !== survived + rejected`);
  }
}

test("funnel: the FOX8 job board is refused at the identity gate with the reason recorded, and the batch reconciles", async () => {
  const input = funnelInput({ [FOX8_SITE]: FOX8_FUNNEL_HTML });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.records.length, 0, JSON.stringify(out.records || []).slice(0, 300));
  const identityStage = stageByName(out.funnel, "6_first_party_identity");
  assert.equal(identityStage.entered, 1);
  assert.equal(identityStage.survived, 0);
  assert.equal(identityStage.rejected.business_name_count_phrase, 1);

  // RECORDED, never silent: the rejects list carries candidate + reason + the
  // exact evidence. The batch itself was never refused (out.ok stays true).
  const rejection = (out.rejects || []).find((r) => r.reason === "business_name_count_phrase");
  assert.ok(rejection, JSON.stringify(out.rejects || []));
  assert.match(rejection.detail, /21,030/);
  assert.match(rejection.detail, /count phrase/);

  // Stage-2 telemetry counted the platform homepage (job-board UI + count title).
  const fetchStage = stageByName(out.funnel, "2_homepage_fetch");
  assert.equal(fetchStage.ugc_platform_markers, 1);

  assertFunnelReconciles(out.funnel);
});

test("funnel: the #700 forum class with an INNOCENT name is refused by the homepage marker families", async () => {
  const input = funnelInput({ [FORUM_SITE]: FORUM_FUNNEL_HTML });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.records.length, 0, JSON.stringify(out.records || []).slice(0, 300));
  const identityStage = stageByName(out.funnel, "6_first_party_identity");
  assert.equal(identityStage.rejected.identity_ugc_platform, 1);
  const rejection = (out.rejects || []).find((r) => r.reason === "identity_ugc_platform");
  assert.ok(rejection, JSON.stringify(out.rejects || []));
  assert.match(rejection.detail, /forum_software/);
  assert.match(rejection.detail, /thread_urls/);
  assert.equal(stageByName(out.funnel, "2_homepage_fetch").ugc_platform_markers, 1);
  assertFunnelReconciles(out.funnel);
});

test("funnel: an unusual-but-real name flows to a record carrying the screen's PASS verdict as provenance", async () => {
  const input = funnelInput({ [ODD_NAME_SITE]: ODD_NAME_FUNNEL_HTML });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  const record = out.records[0];
  assert.equal(record.mirror_request.facts.business_name, "24/7 Emergency Plumbing LLC");
  // The screen ran and its pass is on the packet, so an auditor can see it.
  assert.equal(record.qualification.name_plausibility.ok, true);
  // The careers nav is exactly one weak UGC family — measured, never a refusal.
  assert.equal(record.qualification.ugc_platform.platform, false);
  assertFunnelReconciles(out.funnel);
});
