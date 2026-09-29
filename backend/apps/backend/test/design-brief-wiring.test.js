"use strict";

// test/design-brief-wiring.test.js — the designer starts doing its job.
//
// lib/design-brief.js ran on 8 real sites and fed NOTHING. These tests pin the
// wiring: the brief's slogan becomes the h1's first line (the Farr Better
// rule), its surface fills client_surface, its action colour rides as the
// accent FALLBACK (the logo still outranks the page), its verified fonts
// attach, and its DOM-verified loud trust signals land in the pride block —
// while an unverified claim can never reach a request.
//
// The step itself is skipped under the test runner unless a test opts in with
// `designBrief: true` and stubs `deps.buildDesignBrief` — no unit test may
// launch Chromium or call a vision model. The first test pins that default.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMirrorForProspect,
  withLocalResearch,
  factualKeywords,
  withBriefTrust,
  briefClientSurface,
} = require("../lib/mirror-lane-build");
const { composeIdentityCopy } = require("../lib/mirror-engine/identity-copy");

const PROSPECT = {
  prospect_id: "place-farr",
  business_name: "Farr Better Plumbing",
  industry: "plumbing",
  site: "https://farrbetterplumbing.com/",
  logo: "https://farrbetterplumbing.com/wp-content/uploads/logo.png",
  marketing_city: "Springfield",
  marketing_city_state: "MO",
  place_id: "ChIJfarr",
};

function laneDeps({ brief = null } = {}) {
  const captured = {};
  return {
    captured,
    resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
    resolveVerifiedFacts: async () => ({
      ok: true,
      facts: {
        business_name: "Farr Better Plumbing", city: "Republic", state: "MO",
        phone: "(417) 555-0123", current_website: "https://farrbetterplumbing.com/",
        rating: 4.9, review_count: 120,
      },
      content: {
        services: ["Drain cleaning", "Water heater repair", "Toilet repair"],
        reviews: [{ text: "Great crew.", author: "Sam T." }],
        hours: ["Mon 8-5"],
      },
      coverage: {},
    }),
    harvestClientPhotos: async () => ({ ok: true, photos: [{ url: "https://farrbetterplumbing.com/p1.jpg", sha256: "s1", ext: "jpg", bytes: 5000 }] }),
    readFleetIdentities: async () => ({ ok: true, identities: [] }),
    ...(brief ? { buildDesignBrief: async () => ({ ok: true, brief }) } : {}),
    mirror: async (req) => {
      Object.assign(captured, { req });
      const sections = req.content && Object.keys(req.content).length ? 3 : 0;
      return {
        status: 200,
        body: { ok: true, revealable: true, preview_url: `https://${req.slug}.wss-ai.com/`, checks: { content: { status: sections ? "injected" : "none", sections } } },
      };
    },
  };
}

/** A brief shaped exactly as buildDesignBrief emits one — the Farr case. */
function farrBrief(overrides = {}) {
  return {
    version: "design-brief-v1",
    url: "https://farrbetterplumbing.com/",
    finalUrl: "https://farrbetterplumbing.com/",
    capturedAt: "2026-08-12T00:00:00.000Z",
    title: "Farr Better Plumbing",
    mode: "light",
    surface: "#FFFFFF",
    text: "#1A1A1A",
    accent: "#C53F34",
    accentText: "#C53F34",
    accentHover: "#A83229",
    fontDisplay: "Oswald",
    fontBody: "Inter",
    fontHref: "https://fonts.googleapis.com/css2?family=Oswald:wght@600&family=Inter:wght@400",
    heroSlogan: { text: "BIG CITY SERVICE. SMALL TOWN VALUE", display: "Big City Service. Small Town Value", fontSize: 44, index: 0, source: "measured" },
    heroImage: null,
    identityImages: [],
    loudElements: [
      { kind: "certification", text: "BBB A+ Accredited", textVerified: true, isClaim: true, rect: { x: 0, y: 60, width: 200, height: 40 }, crop: {}, viewport: "desktop", confidence: 0.8 },
      { kind: "emergency_line", text: "24/7 Emergency Service", textVerified: true, isClaim: false, rect: { x: 0, y: 0, width: 1280, height: 44 }, crop: {}, viewport: "desktop", confidence: 0.8 },
      // Vision read this off a JPEG; the DOM never carried it. It must not ship.
      { kind: "award", text: "Best Plumber Award 2020", textVerified: false, isClaim: true, rect: null, crop: { band: "middle" }, viewport: "desktop", confidence: 0.5 },
    ],
    carryOver: [{ what: "BBB accreditation", why: "trust", anchor: null, anchored: false, confidence: 0.6 }],
    colorAdjustments: [],
    refusals: [],
    provenance: {
      accent: { source: "measured", confidence: 0.9, note: "chosen from measured candidates by vision" },
      surface: { source: "measured", confidence: 0.9, note: "" },
    },
    measurements: { visibleTextChars: 1400, pixelShare: 0.72 },
    vision: { attempted: true, ok: true, provider: "anthropic", model: "test", reason: "" },
    durationMs: 100,
    ...overrides,
  };
}

test("under the test runner the brief is OFF by default, and says so", async () => {
  const d = laneDeps();
  const out = await buildMirrorForProspect(PROSPECT, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(out.design_brief.status, "disabled");
  assert.equal(out.design_brief.reason, "test_context");
  assert.equal(d.captured.req.hero, undefined, "no slogan, no pride tagline: no hero block at all");
});

test("THE SLOGAN RULE: their hero sentence leads the h1, above name+city", async () => {
  const d = laneDeps({ brief: farrBrief() });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, designBrief: true });
  assert.equal(out.ok, true);
  const req = d.captured.req;
  assert.equal(req.hero.tagline, "Big City Service. Small Town Value");
  assert.equal(out.design_brief.status, "ok");
  assert.equal(out.design_brief.applied.tagline, true);
  assert.equal(out.design_brief.slogan, "Big City Service. Small Town Value");

  // And the identity composer puts it ABOVE the trade+city line — the exact
  // Farr Better h1 the owner asked for.
  const copy = composeIdentityCopy({
    facts: { business_name: "Farr Better Plumbing", industry: "plumbing", city: "Republic", state: "MO", rating: 4.9, review_count: 120 },
    marketCity: "Springfield",
    hero: { tagline: req.hero.tagline },
  });
  assert.equal(copy.lines.a, "Big City Service. Small Town Value.");
  assert.match(copy.lines.b, /^Plumbing in Springfield, MO\./);
  assert.match(copy.headline, /Farr Better Plumbing/);
  assert.equal(copy.source, "client_tagline");
});

test("a slogan already carrying trade+city puts the NAME on line B, not the city again", () => {
  // Diamond State's real hero: "Trusted Plumber in Little Rock, AR".
  const copy = composeIdentityCopy({
    facts: { business_name: "Diamond State Plumbing", industry: "plumbing", city: "Little Rock", state: "AR" },
    marketCity: "Little Rock",
    hero: { tagline: "Trusted Plumber in Little Rock, AR" },
  });
  assert.equal(copy.lines.a, "Trusted Plumber in Little Rock, AR.");
  assert.equal(copy.lines.b, "Diamond State Plumbing.", "no city stutter; the name still identifies the page");
  // And a slogan that merely contains the WORD city keeps the trade+city line.
  const farr = composeIdentityCopy({
    facts: { business_name: "Farr Better Plumbing", industry: "plumbing", city: "Republic", state: "MO" },
    marketCity: "Springfield",
    hero: { tagline: "Big City Service. Small Town Values." },
  });
  assert.match(farr.lines.b, /^Plumbing in Springfield, MO\./);
  assert.match(farr.headline, /Farr Better Plumbing/);
});

test("palette + surface + fonts wiring: fallback accent, measured surface, verified typeface", async () => {
  const d = laneDeps({ brief: farrBrief() });
  await buildMirrorForProspect(PROSPECT, { deps: d, designBrief: true });
  const req = d.captured.req;
  // The logo still outranks the page: the brief's colour is only the FALLBACK.
  assert.equal(req.brand.accent, undefined);
  assert.equal(req.brand.accent_fallback, "#C53F34");
  assert.equal(req.brand.accent_fallback_source, "https://farrbetterplumbing.com/");
  // Their measured surface reaches the theme decision.
  assert.deepEqual(req.client_surface, {
    mode: "light", basis: "paper", surface: "#ffffff", measured_at: "2026-08-12T00:00:00.000Z",
  });
  // Their rendered families, with the stylesheet the brief verified.
  assert.equal(req.brand.fonts.display, "Oswald");
  assert.equal(req.brand.fonts.body, "Inter");
  assert.equal(req.brand.fonts.provider, "google");
  assert.match(req.brand.fonts.href, /^https:\/\/fonts\.googleapis\.com\//);
});

test("TRUST DENSITY: DOM-verified loud signals land in pride; an unverified claim cannot", async () => {
  const d = laneDeps({ brief: farrBrief() });
  await buildMirrorForProspect(PROSPECT, { deps: d, designBrief: true });
  const req = d.captured.req;
  const pride = req.content.pride;
  assert.ok(pride, "a pride block was composed from the brief");
  const credLabels = (pride.sections.credentials || []).map((c) => c.label);
  assert.ok(credLabels.includes("BBB A+ Accredited"), "the verified claim is a credential chip");
  const cred = pride.sections.credentials.find((c) => c.label === "BBB A+ Accredited");
  assert.equal(cred.proof.source, "https://farrbetterplumbing.com/");
  assert.equal(cred.proof.quote, "BBB A+ Accredited");
  const diffs = (pride.sections.differentiators || []).map((x) => x.text);
  assert.ok(diffs.includes("24/7 Emergency Service"), "the verified emergency line is a differentiator");
  assert.ok(!JSON.stringify(req).includes("Best Plumber Award 2020"), "an unverified claim never reaches the request");
});

test("the render gate's ban list outranks the brief", async () => {
  const d = laneDeps({ brief: farrBrief() });
  const banned = { ...PROSPECT, record: { unverified_claims: ["bbb a+"] } };
  await buildMirrorForProspect(banned, { deps: d, designBrief: true });
  const req = d.captured.req;
  const labels = ((req.content.pride && req.content.pride.sections.credentials) || []).map((c) => c.label);
  assert.ok(!labels.includes("BBB A+ Accredited"), "a claim on the ban list is dropped");
  const diffs = ((req.content.pride && req.content.pride.sections.differentiators) || []).map((x) => x.text);
  assert.ok(diffs.includes("24/7 Emergency Service"), "the rest still carries");
});

test("an abstained accent and a shaky dark reading apply nothing", async () => {
  const d = laneDeps({
    brief: farrBrief({
      accent: null,
      provenance: { accent: { source: "absent", confidence: 0, note: "below floor" } },
      mode: "dark",
      surface: "#101418",
      measurements: { visibleTextChars: 1400, pixelShare: 0.3 }, // dark hero, not a dark site
    }),
  });
  await buildMirrorForProspect(PROSPECT, { deps: d, designBrief: true });
  const req = d.captured.req;
  assert.equal(req.brand.accent_fallback, undefined, "no accent fallback from an abstention");
  assert.equal(req.client_surface, undefined, "a sub-majority dark reading is not evidence of a dark site");
});

test("briefClientSurface carries a REAL dark majority through", () => {
  const out = briefClientSurface(farrBrief({
    mode: "dark", surface: "#101418",
    measurements: { visibleTextChars: 900, pixelShare: 0.66 },
  }));
  assert.equal(out.client_surface.mode, "dark");
  assert.equal(out.client_surface.basis, "paper");
  assert.equal(out.client_surface.darkShare, 0.66);
});

// ---------------------------------------------------------------------------
// BRIGHTDATA RESEARCH — observed searcher language, factual keywords only
// ---------------------------------------------------------------------------

test("withLocalResearch attaches observed research and only FACTUAL keywords", async () => {
  const impl = async () => ({
    neighborhoods: ["La Loma", "College Area"],
    landmarks: ["Gallo Center"],
    questions: ["How much does toilet repair cost in Modesto?"],
    related: ["toilet repair modesto", "best pizza modesto", "plumber near me", "water heater repair modesto ca"],
    authoritative: [{ href: "https://www.epa.gov/watersense", title: "EPA WaterSense" }],
    gbp: { descriptions: { short_250: "x" }, categories: ["Plumber"] },
    citations_csv: "directory,name\n",
    sources: ["serp:plumbing Modesto CA"],
  });
  const facts = { business_name: "Noble Plumbing", industry: "plumbing", city: "Modesto", state: "CA", phone: "(209) 555-0100" };
  const content = await withLocalResearch(
    { services: [{ name: "Toilet Repair" }, { name: "Water Heater Repair" }] },
    facts,
    { research: true },
    impl,
  );
  assert.deepEqual(content.research.neighborhoods, ["La Loma", "College Area"]);
  assert.deepEqual(content.keywords, ["toilet repair modesto", "water heater repair modesto ca"],
    "city + service terms qualify; pizza and cityless terms never do");
  assert.ok(content.research.gbp, "the GBP pack rides along when a phone exists");
});

test("no phone: the GBP copy pack is omitted rather than reading 'Call .'", async () => {
  const impl = async () => ({ related: ["toilet repair modesto"], gbp: { descriptions: { short_250: "Call undefined." } } });
  const content = await withLocalResearch(
    { services: ["Toilet Repair"] },
    { business_name: "Noble", industry: "plumbing", city: "Modesto", state: "CA" },
    { research: true },
    impl,
  );
  assert.equal(content.research.gbp, undefined);
});

test("factualKeywords: the city alone is not enough, the trade alone is not enough", () => {
  const r = { related: ["modesto weather", "plumbing license lookup", "drain cleaning modesto"] };
  const facts = { city: "Modesto", industry: "plumbing" };
  assert.deepEqual(factualKeywords(r, facts, ["Drain Cleaning"]), ["drain cleaning modesto"]);
});

test("withBriefTrust without a brief or without verified entries changes nothing", () => {
  const content = { services: ["x"] };
  assert.equal(withBriefTrust(content, null, {}), content);
  assert.equal(withBriefTrust(content, { loudElements: [{ kind: "award", text: "X", textVerified: false }] }, {}), content);
});

// ---------------------------------------------------------------------------
// THE PHOTO BANK REACHES THE ENGINE — the barren-hero root cause.
//
// The resolver lane harvests their photography but banked nothing, so
// brand.photo_bank was absent on every cold build and the engine's hero wash
// reported "no_photo_bank" on EVERY page hero. bankFromHarvest turns the
// in-hand harvest into the bank; briefFlaggedBank marks their CURRENT hero on
// it; and it travels in the request the engine reads.
// ---------------------------------------------------------------------------

test("the inline harvest is banked, so the brief's CURRENT hero reaches brand.photo_bank", async () => {
  const heroUrl = "https://farrbetterplumbing.com/hero.jpg";
  const captured = {};
  const d = {
    resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
    resolveVerifiedFacts: async () => ({
      ok: true,
      facts: {
        business_name: "Farr Better Plumbing", city: "Republic", state: "MO",
        phone: "(417) 555-0123", current_website: "https://farrbetterplumbing.com/",
        rating: 4.9, review_count: 120,
      },
      content: { services: ["Drain cleaning", "Water heater repair"], reviews: [{ text: "Great crew.", author: "Sam T." }], hours: ["Mon 8-5"] },
      coverage: {},
    }),
    // A real harvest result: their branded van (gallery) and the picture their
    // own site leads with (hero-grade). Both are ownership-gated already.
    harvestClientPhotos: async () => ({ ok: true, photos: [
      { url: "https://farrbetterplumbing.com/van.jpg", source: "own_site", sha256: "v".repeat(64), ext: "jpg", bytes: 220000, width: 1200, height: 800, rank: -50 },
      { url: heroUrl, source: "own_site", sha256: "h".repeat(64), ext: "jpg", bytes: 300000, width: 1920, height: 1080, rank: -40 },
    ] }),
    readFleetIdentities: async () => ({ ok: true, identities: [] }),
    buildDesignBrief: async () => ({ ok: true, brief: farrBrief({ heroImage: { url: heroUrl }, identityImages: [] }) }),
    mirror: async (req) => {
      captured.req = req;
      return { status: 200, body: { ok: true, revealable: true, preview_url: `https://${req.slug}.wss-ai.com/`, checks: { content: { status: "injected", sections: 3 } } } };
    },
  };
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, designBrief: true });
  assert.equal(out.ok, true);
  const req = captured.req;
  // Previously absent on every cold build; now the bank travels.
  assert.ok(req.brand.photo_bank && Array.isArray(req.brand.photo_bank.photos), "brand.photo_bank is present");
  const heroRow = req.brand.photo_bank.photos.find((r) => r.url === heroUrl);
  assert.ok(heroRow, "their current hero is a bank row");
  assert.equal(heroRow.current_hero, true, "the brief's measured heroImage is flagged current_hero for the wash");
  assert.equal(heroRow.grade, "hero");
  // Its URL is front-loaded into brand.photos so the engine fetches its bytes —
  // a flag on bytes that never arrive would paint nothing.
  assert.equal(req.brand.photos[0], heroUrl);
});
