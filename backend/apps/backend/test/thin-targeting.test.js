"use strict";

// test/thin-targeting.test.js — issue #689, pinned.
//
// Owner doctrine (Sept 4): thin/un-integrated sites are the BEST converts.
// Sites WITH Google-review widgets, maps embeds, socials and booking flows are
// the polished class — harder to convert, less wow available. The last Austin
// campaign pulled LOA Roofing & Construction (a Top-100 gorgeous site), which
// is the WRONG target class.
//
// This file pins the three changes the doctrine required:
//
//   1. THE DETECTOR. integrationGapFromHomepage measures the prospect's
//      CURRENT homepage off the stage-2 fetch ALREADY in flight (no new
//      network calls): review widget/embed presence, Google Maps embed,
//      social links, booking/scheduling widgets, and site-sophistication
//      markers. A thin/un-integrated site outscores an LOA-class polished one.
//
//   2. THE RANKING, NEVER A GATE. The measured gap is a POSITIVE targeting
//      signal: it reorders survivors so the goal-sized deep-verification pool
//      reaches thin targets first, and it joins the flatness x demand ranker.
//      It refuses nothing — thin sites FLOW (the thin-flow law), and polished
//      sites still flow too; they just stop surfacing first.
//
//      (2026-09-03: the heavy-target ADMISSION CAP is now a separate dial —
//      TARGET_MAX_POLISH, default 75, pinned in target-polish-ceiling.test.js
//      — which skips the too-polished class at admission with a recorded
//      funnel reason. This file pins the dial-off ranking law exactly as
//      #694 shipped it, so both doctrines stay independently provable.)
//
//   3. THE OUTREACH LINE. The V3 email gains the owner's line — "Your Google
//      reviews never showed on your old site — they're front and center on the
//      new one." — as a SELECTABLE, fact-gated line for measured reviews-gap
//      targets only, in BOTH MIME halves, never for a site the mine saw
//      showing its reviews and never without the prospect's own review count.
//
// The ABSOLUTE protections are untouched: identity gates, the truth law, and
// the canonical-campaign-targets guard.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mineBuildReady,
  integrationGapFromHomepage,
  rankFlatSiteCandidates,
} = require("../lib/lead-miner");
const { rankCandidates } = require("../lib/mirror-engine/miner-retarget");
const { composeOutreachEmailV3 } = require("../lib/outreach-email-v3");
const { buildProofEmailInputs, PROOF_EMAIL_V3_OPTION_KEYS } = require("../lib/proof-email-inputs");

const stageRow = (out, name) => (out.funnel || []).find((stage) => stage.stage === name);

// ---------------------------------------------------------------------------
// 1. The detector — pure, off the stage-2 bytes
// ---------------------------------------------------------------------------

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

// The LOA-Roofing class: modern framework stack, responsive, real depth,
// LocalBusiness schema, a Google-review widget, a Maps embed, owned socials,
// and a booking flow. Everything the rebuild would sell, already there.
// (Same trade as the mining query, so it clears the trade-corroboration gate —
// this fixture must lose on RANKING, not be refused on identity.)
const LOA_HOME = `<!doctype html><html><head>
  <title>Apex Plumbing &amp; Water Heaters | Spokane WA</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Apex Plumbing & Water Heaters",
    telephone: "(509) 555-0188",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Spokane",
      addressRegion: "WA",
      postalCode: "99201",
    },
  })}</script>
  <script>window.__NEXT_DATA__ = {"props":{}};</script>
</head><body>
  <h1>Apex Plumbing &amp; Water Heaters</h1>
  <p>${"Plumbing repairs, water heaters, drain cleaning and repiping. Read our reviews from Spokane families. ".repeat(12)}</p>
  <div class="trustpilot-widget" data-businessunit="apex-plumbing">Trustpilot reviews</div>
  <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12" title="Find us"></iframe>
  <a href="https://www.facebook.com/apexplumbingwa">Facebook</a>
  <a href="https://www.instagram.com/apexplumbingwa">Instagram</a>
  <a href="https://calendly.com/apexplumbing/service-call">Book a service call</a>
  <a href="/services">Our services</a>
  <a href="mailto:hello@apexplumbing.example">Email us</a>
</body></html>`;

// The probe shape lib/site-weakness.js produces for each fixture.
const THIN_PROBE = { hasSchema: true, hasReviews: false, modernPremium: false };
const LOA_PROBE = { hasSchema: true, hasReviews: true, modernPremium: true };

test("integrationGapFromHomepage: a thin/un-integrated homepage measures a positive gap", () => {
  const gap = integrationGapFromHomepage({ html: THIN_HOME, probe: THIN_PROBE, parsed: {}, social: {}, ownedProfiles: [] });
  assert.equal(gap.measured, true);
  assert.equal(gap.gap, true);
  assert.ok(gap.gaps.includes("reviews"), "the headline gap is the reviews gap");
  assert.ok(gap.gaps.includes("maps"));
  assert.ok(gap.gaps.includes("socials"));
  assert.ok(gap.gaps.includes("booking"));
  assert.ok(gap.score >= 80, `a fully un-integrated homepage scores high (got ${gap.score})`);
  assert.ok(gap.signals.length >= 4, "every gap carries its human-readable signal");
});

test("integrationGapFromHomepage: an LOA-class polished homepage is measured, not guessed, and scores near zero", () => {
  const gap = integrationGapFromHomepage({ html: LOA_HOME, probe: LOA_PROBE, parsed: { modernStack: true }, social: { facebook: "https://www.facebook.com/apexroofingwa" }, ownedProfiles: [] });
  assert.equal(gap.measured, true);
  assert.equal(gap.gap, false, "a fully integrated homepage has no measured gap");
  assert.deepEqual(gap.gaps, []);
  assert.equal(gap.score, 0);
});

test("integrationGapFromHomepage: the thin homepage outscores the LOA-class polished homepage", () => {
  const thin = integrationGapFromHomepage({ html: THIN_HOME, probe: THIN_PROBE, parsed: {}, social: {}, ownedProfiles: [] });
  const polished = integrationGapFromHomepage({ html: LOA_HOME, probe: LOA_PROBE, parsed: { modernStack: true }, social: { facebook: "x" }, ownedProfiles: [] });
  assert.ok(thin.score > polished.score, "the whole doctrine in one assertion");
});

test("integrationGapFromHomepage: sophistication markers downweight the upside and never invent gaps", () => {
  // A modern-stack site that is missing only its review widget: the gap is
  // measured (reviews), but the polish penalty halves the score.
  const half = integrationGapFromHomepage({
    html: "<html><body>Call us. <script>window.__NEXT_DATA__={};</script></body></html>",
    probe: { hasSchema: false, hasReviews: false, modernPremium: false },
    parsed: { modernStack: true },
    social: {},
    ownedProfiles: [],
  });
  assert.ok(half.gaps.includes("reviews"));
  assert.ok(half.score < 70, `polish halves the upside (got ${half.score})`);

  // A measured modern-premium site caps the upside at a token even with every
  // gap present.
  const capped = integrationGapFromHomepage({
    html: THIN_HOME,
    probe: { hasSchema: true, hasReviews: false, modernPremium: true },
    parsed: {},
    social: {},
    ownedProfiles: [],
  });
  assert.equal(capped.score, 10, "modern-premium caps the thin-target score");

  // No homepage bytes at all: unmeasured, zero, never a fabricated gap.
  const empty = integrationGapFromHomepage({ html: "", probe: null, parsed: null });
  assert.deepEqual(empty, { gap: false, gaps: [], score: 0, signals: [], measured: false });
});

// ---------------------------------------------------------------------------
// 2. The ranking — ordering only, never a gate
// ---------------------------------------------------------------------------

test("rankCandidates: a measured integration gap outranks an LOA-class polished twin", () => {
  const ranked = rankCandidates([
    { id: "polished", rating: 4.9, reviewCount: 400, flatness: { score: 0 }, integrationGap: 0 },
    { id: "thin-gap", rating: 4.9, reviewCount: 400, flatness: { score: 0 }, integrationGap: 85 },
    { id: "legacy", rating: 4.7, reviewCount: 200, flatness: { score: 60 } },
  ]);
  assert.equal(ranked.length, 3, "the ranker drops nobody");
  assert.equal(ranked[0].id, "thin-gap", "the thin target surfaces first");
  assert.ok(ranked.findIndex((c) => c.id === "thin-gap") < ranked.findIndex((c) => c.id === "polished"),
    "the polished LOA-class site ranks below the thin target");
});

test("rankFlatSiteCandidates: the measured gap rides the record's qualification into the rank", () => {
  const thinRecord = {
    qualification: { integration_gap: { gap: true, gaps: ["reviews", "maps", "socials"], score: 65, measured: true } },
    website_flatness: { score: 0 },
    mirror_request: { facts: { rating: 4.8, review_count: 120 } },
  };
  const polishedRecord = {
    qualification: { integration_gap: { gap: false, gaps: [], score: 0, measured: true } },
    website_flatness: { score: 0 },
    mirror_request: { facts: { rating: 4.8, review_count: 120 } },
  };
  const ranked = rankFlatSiteCandidates([polishedRecord, thinRecord], {});
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0], thinRecord, "equal flatness and demand: the gap decides");
});

// ---------------------------------------------------------------------------
// 3. The funnel — thin targets surface first, everyone still flows
// ---------------------------------------------------------------------------

function thinTargetFetchImpl() {
  return async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      // The polished LOA-class site is discovered FIRST on purpose: without
      // the thin-target preference it would take the goal-sized proof slot.
      return new Response(JSON.stringify({
        data: [
          { url: "https://apexplumbing.example/", title: "Apex Plumbing & Water Heaters | Spokane WA" },
          { url: "https://dukeplumbing.example/", title: "Duke Plumbing | Spokane WA" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/apexplumbing\.example/.test(href)) return new Response(LOA_HOME, { status: 200, headers: { "content-type": "text/html" } });
    if (/dukeplumbing\.example/.test(href)) return new Response(THIN_HOME, { status: 200, headers: { "content-type": "text/html" } });
    throw new Error(`unstubbed fetch: ${href}`);
  };
}

function thinTargetInput(envOverrides = {}) {
  return {
    trigger: "operator_line",
    lane: "live",
    queries: [{ industry: "plumbing", location: "Spokane WA", textQuery: "plumbing in Spokane WA", queryGroup: 0 }],
    candidatesPerQuery: 1,
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
      // This file pins #694's ranking-only law, so the 2026-09-03 admission
      // cap is disabled HERE on purpose; target-polish-ceiling.test.js pins
      // the default-on ceiling and its under-fill behavior.
      TARGET_MAX_POLISH: "0",
      ...envOverrides,
    },
    fetchImpl: thinTargetFetchImpl(),
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => ({
      ok: true,
      status: 200,
      body: {
        ok: true, build_hash: "thin-hash", donor_content_hash: "donor", file_count: 51,
        evidence_sha: "sha", renderer: "mirror-engine@v1",
        checks: { brand: { status: "passed", logo_refs_in_output: 0 } },
      },
    }),
  };
}

test("the goal-sized proof pool surfaces the thin target over the LOA-class site discovered first", async () => {
  const out = await mineBuildReady(thinTargetInput());
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));

  // BOTH candidates were fetched, measured and deep-verified their identities —
  // the polished site was not refused anywhere, it lost the RANK.
  assert.equal(Number(out.cost.homepage_fetches) || 0, 2, "both homepages were measured");
  const identity = stageRow(out, "6_first_party_identity");
  assert.equal(identity.entered, 2, "both candidates entered the deep-verification pool");
  assert.equal(identity.survived, 2, "neither identity was refused");
  assert.equal(out.rejects.length, 0, JSON.stringify(out.rejects));

  // The goal-sized quota (perQuery=1) proved exactly one site: the thin one.
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  assert.equal(out.records[0].discovery.domain, "dukeplumbing.example",
    "the thin/un-integrated site takes the slot the polished site was discovered into");
  const gap = out.records[0].qualification.integration_gap;
  assert.ok(gap, "the measured gap rides the packet as provenance");
  assert.equal(gap.gap, true);
  assert.ok(gap.gaps.includes("reviews"));
  assert.ok(gap.score >= 80);

  // Additive stage telemetry, no arithmetic change.
  const s2 = stageRow(out, "2_homepage_fetch");
  assert.equal(s2.integration_gap_positive, 1,
    "exactly the thin survivor is tallied gap-positive; the polished site measured no gap");
  for (const stage of out.funnel || []) {
    const rejected = Object.values(stage.rejected || {}).reduce((sum, n) => sum + n, 0);
    assert.equal(stage.entered, stage.survived + rejected, `${stage.stage}: the funnel still reconciles`);
  }
});

test("with the deep-batch dial both sites flow and the emitted order prefers the thin target", async () => {
  const out = await mineBuildReady(thinTargetInput({ LINE_DEEP_BATCH_DEPTH: "2" }));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));
  assert.equal(out.records.length, 2, "the polished site still FLOWS — ranking never refuses");
  assert.equal(out.records[0].discovery.domain, "dukeplumbing.example", "the thin target ranks first");
  assert.equal(out.records[1].discovery.domain, "apexplumbing.example");
  const polished = out.records[1].qualification.integration_gap;
  assert.ok(polished && polished.measured === true && polished.gap === false,
    "the polished site's non-gap is recorded exactly as measured");
});

// ---------------------------------------------------------------------------
// 4. The outreach line — selectable, fact-gated, both MIME halves
// ---------------------------------------------------------------------------

const PREVIEW = "https://duke-plumbing.wss-ai.com/";
const EMAIL_BASE = {
  businessName: "Duke Plumbing",
  city: "Spokane",
  previewUrl: PREVIEW,
  brandColor: "#C0392B",
};
const EMAIL_TRUST = { rating: "4.8", reviewCount: "121" };
const PITCH_HTML = "Your Google reviews never showed on your old site";
const PITCH_TEXT = "Your Google reviews never showed on your old site — they're front and center on the new one.";

test("the thin-target line renders in BOTH halves for a measured reviews-gap target", () => {
  const { html, text } = composeOutreachEmailV3({ ...EMAIL_BASE, ...EMAIL_TRUST, integrationGap: true });
  assert.ok(html.includes(PITCH_HTML), "the HTML trust band carries the line");
  assert.ok(text.includes(PITCH_TEXT), "the plain-text half carries the same words");
});

test("the line is selectable: it never renders for a target without the gap flag", () => {
  const { html, text } = composeOutreachEmailV3({ ...EMAIL_BASE, ...EMAIL_TRUST });
  assert.ok(!html.includes(PITCH_HTML), "no flag, no line (HTML)");
  assert.ok(!text.includes(PITCH_TEXT), "no flag, no line (text)");
});

test("the line never ships without the prospect's own review numbers (truth law)", () => {
  // "Your Google reviews" is a claim about reviews we can count: the flag
  // alone, with no measured rating/review count, removes the line entirely.
  const { html, text } = composeOutreachEmailV3({ ...EMAIL_BASE, integrationGap: true });
  assert.ok(!html.includes(PITCH_HTML));
  assert.ok(!text.includes(PITCH_TEXT));
});

test("the mapper emits the flag only for a measured REVIEWS gap on the record", () => {
  assert.ok(PROOF_EMAIL_V3_OPTION_KEYS.includes("integrationGap"),
    "the option is on the boundary allowlist the composer is verified against");
  const measuredReviewsGap = { integration_gap: { measured: true, gap: true, gaps: ["reviews", "maps", "socials"], score: 65, signals: [] } };
  const mapped = buildProofEmailInputs({ prospect: {}, record: measuredReviewsGap, cta: {}, footer: {} });
  assert.equal(mapped.integrationGap, true);

  // A gap that does NOT include reviews (e.g. only booking missing on an
  // otherwise integrated site) must not earn the reviews pitch.
  const bookingOnly = { integration_gap: { measured: true, gap: true, gaps: ["booking"], score: 20, signals: [] } };
  assert.equal(buildProofEmailInputs({ prospect: {}, record: bookingOnly, cta: {}, footer: {} }).integrationGap, undefined);

  // Unmeasured / malformed shapes emit nothing at all.
  assert.equal(buildProofEmailInputs({ prospect: {}, record: { integration_gap: { gap: true, gaps: ["reviews"] } }, cta: {}, footer: {} }).integrationGap, undefined,
    "an unmeasured record never earns the claim");
  assert.equal(buildProofEmailInputs({ prospect: {}, record: {}, cta: {}, footer: {} }).integrationGap, undefined);

  // The build_ready blob carries the same provenance for stored rows.
  const viaBuildReady = { build_ready: { version: 1, qualification: { integration_gap: measuredReviewsGap.integration_gap } } };
  assert.equal(buildProofEmailInputs({ prospect: {}, record: viaBuildReady, cta: {}, footer: {} }).integrationGap, true);
});
