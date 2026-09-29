"use strict";

// test/mirror-lane-brief-photos.test.js — the client's OWN photographs stop
// being discarded, and the resolver lane finally captures their typeface.
//
// THE DEFECT (owner's #1 fidelity complaint): a built mirror ships the donor's
// generic stock (/images/service-wood.jpg) while ~10 real fence-install photos
// sit un-harvested on metrofence.net. The design brief ALREADY measures the
// client's own pictures in a real browser — brief.heroImage and
// brief.identityImages, each already refused if it is logo-like, a third-party
// mark, or below the photo floor — but on the resolver lane the harvest runs
// BEFORE the brief exists, and briefFlaggedBank can only decorate rows a bank
// already holds. So on a thin harvest every measured photograph was thrown
// away. Test 1 pins that discard; test 2 proves the second pass recovers them
// THROUGH the harvester, so every ownership/stock/byte gate still runs.
//
// The second half pins FIX 2B: captureFonts ran only on the packet path, so a
// resolver-lane mirror whose brief carried no verified Google stylesheet
// shipped in the DONOR's type. The brief still leads; captureFonts fills behind
// it; a guessed font is still never used.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMirrorForProspect,
  briefFlaggedBank,
  briefMeasuredPhotoUrls,
} = require("../lib/mirror-lane-build");

const PROSPECT = {
  prospect_id: "place-metrofence",
  business_name: "Metro Fence",
  industry: "fencing",
  services: ["Wood fence installation", "Chain-link fence installation", "Automatic gate installation"],
  site: "https://metrofence.net/",
  logo: "https://metrofence.net/wp-content/uploads/logo.png",
  marketing_city: "Nashville",
  marketing_city_state: "TN",
  place_id: "ChIJmetrofence",
};

// The three real files the owner named, plus one the gates must still refuse.
const HERO = "https://metrofence.net/wp-content/uploads/WRC-6x6-post-crossbuck-130.jpg";
const CREW = "https://metrofence.net/wp-content/uploads/IMG_0468.jpg";
const GATE = "https://metrofence.net/wp-content/uploads/Montage-3R-Majestic-151.jpg";

function metroBrief(overrides = {}) {
  return {
    version: "design-brief-v1",
    url: "https://metrofence.net/",
    finalUrl: "https://metrofence.net/",
    capturedAt: "2026-08-19T00:00:00.000Z",
    title: "Metro Fence",
    mode: "light",
    surface: "#FFFFFF",
    text: "#1A1A1A",
    accent: "#1F6F43",
    // No fontHref on purpose: this is the brief that used to leave the mirror
    // wearing the donor's type.
    fontDisplay: "",
    fontBody: "",
    fontHref: "",
    heroSlogan: null,
    heroImage: { url: HERO, width: 1600, height: 900, alt: "cedar crossbuck fence", kind: "img" },
    identityImages: [
      { url: CREW, width: 1200, height: 800, alt: "our crew", what: "crew", identityCritical: true, criticalWhy: "the owner and his installers" },
      { url: GATE, width: 1200, height: 900, alt: "majestic gate", what: "finished work" },
    ],
    loudElements: [],
    carryOver: [],
    colorAdjustments: [],
    refusals: [],
    provenance: {},
    measurements: { visibleTextChars: 1400, pixelShare: 0.7 },
    vision: { attempted: true, ok: true, provider: "test", model: "test", reason: "" },
    durationMs: 10,
    ...overrides,
  };
}

/**
 * Lane deps with a STUBBED harvester that behaves like the real one in the way
 * that matters here: pass one crawls the site (and here comes back thin — the
 * JS-rendered gallery case), pass two is handed extraUrls and echoes back the
 * ones on the client's own domain, exactly as harvestClientPhotos does after
 * `registrable(host) === ownDomain` passes.
 */
function laneDeps({
  brief = null,
  firstPassPhotos = [],
  fonts = null,
  captureFontsImpl = null,
} = {}) {
  const captured = {};
  const harvestCalls = [];
  const fontCalls = [];
  return {
    captured,
    harvestCalls,
    fontCalls,
    resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
    resolveBuildableDonor: () => ({ ok: true, donor: "fencing-clean", vertical: "fencing" }),
    resolveVerifiedFacts: async () => ({
      ok: true,
      facts: {
        business_name: "Metro Fence", city: "Nashville", state: "TN",
        phone: "(615) 555-0134", current_website: "https://metrofence.net/",
        rating: 4.8, review_count: 92,
      },
      content: {
        services: ["Wood fence installation", "Ornamental aluminum fence", "Automatic gates"],
        reviews: [{ text: "Great crew.", author: "Dana R." }],
        hours: ["Mon 8-5"],
      },
      coverage: {},
    }),
    harvestClientPhotos: async (args) => {
      harvestCalls.push(args);
      const extras = Array.isArray(args.extraUrls) ? args.extraUrls : [];
      if (!extras.length) {
        return { ok: true, photos: firstPassPhotos.map((url, i) => photoRow(url, i)) };
      }
      // The ownership gate one layer down accepts registrable(host)===ownDomain
      // regardless of the source tag; anything else is refused there, so the
      // stub refuses it here too rather than pretending the gate is absent.
      const own = extras.filter((u) => {
        try { return new URL(u).hostname.replace(/^www\./, "").endsWith("metrofence.net"); }
        catch { return false; }
      });
      return { ok: true, photos: own.map((url, i) => photoRow(url, 100 + i)) };
    },
    ...(captureFontsImpl ? { captureFonts: captureFontsImpl } : {}),
    ...(fonts ? { captureFonts: async () => fonts } : {}),
    ...(brief ? { buildDesignBrief: async () => ({ ok: true, brief }) } : {}),
    mirror: async (req) => {
      Object.assign(captured, { req });
      const sections = req.content && Object.keys(req.content).length ? 3 : 0;
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: `https://${req.slug}.wss-ai.com/`,
          checks: { content: { status: sections ? "injected" : "none", sections } },
        },
      };
    },
  };
}

function photoRow(url, i) {
  return { url, source: i >= 100 ? "caller" : "own_site", sha256: `sha${i}`, ext: "jpg", bytes: 180000, width: 1600, height: 900 };
}

const OPTS = { designBrief: true };

// ---------------------------------------------------------------------------
// 1. THE DISCARD, pinned.
// ---------------------------------------------------------------------------

test("briefFlaggedBank returns {} on an empty bank — the measured photos are DISCARDED", () => {
  const brief = metroBrief();
  const ensure = [];
  assert.deepEqual(briefFlaggedBank({ photos: [] }, brief, ensure, 8), {});
  assert.deepEqual(ensure, [], "nothing was ensured either: the URLs go nowhere");
  // The brief plainly HAS them — that is what makes the discard a defect and
  // not an absence of evidence.
  assert.deepEqual(briefMeasuredPhotoUrls(brief), [HERO, CREW, GATE]);
});

// ---------------------------------------------------------------------------
// 2. THE SECOND PASS.
// ---------------------------------------------------------------------------

test("a thin harvest is topped up from the brief's measured photos, through the harvester", async () => {
  const d = laneDeps({ brief: metroBrief() });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);

  const photos = d.captured.req.brand.photos || [];
  assert.ok(photos.length > 0, "brand.photos is not empty — the donor's stock no longer fills the gallery");
  assert.equal(photos.length, 3);
  for (const url of [HERO, CREW, GATE]) assert.ok(photos.includes(url), `${url} shipped`);
  assert.equal(out.design_brief.applied.photos, 3, "the report says how many the brief rescued");

  // ROUTED THROUGH THE HARVESTER, not around it: the second call passes the
  // brief URLs as extraUrls (where every ownership/stock/byte gate runs) and
  // opens no page of its own.
  assert.equal(d.harvestCalls.length, 2);
  assert.deepEqual(d.harvestCalls[1].extraUrls, [HERO, CREW, GATE]);
  assert.equal(d.harvestCalls[1].crawl, false, "the second pass opens no page");
  assert.ok(d.harvestCalls[1].html, "a non-empty html sentinel skips the homepage GET");
  assert.equal(d.harvestCalls[1].website, "https://metrofence.net/");
});

test("the ownership gate still decides: a foreign-domain 'measured' photo never ships", async () => {
  const brief = metroBrief({
    identityImages: [
      { url: CREW, width: 1200, height: 800, what: "crew", identityCritical: true, criticalWhy: "owner" },
      { url: "https://cdn.some-other-contractor.com/hero.jpg", width: 1600, height: 900, what: "job" },
    ],
  });
  const d = laneDeps({ brief });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  const photos = d.captured.req.brand.photos || [];
  assert.ok(photos.includes(HERO) && photos.includes(CREW), "their own two still ship");
  assert.ok(
    !photos.some((u) => /some-other-contractor/.test(u)),
    "another business's picture is refused by the gate the pass routes through",
  );
  assert.equal(out.design_brief.applied.photos, 2);
});

test("a full harvest spends no second pass", async () => {
  const firstPassPhotos = Array.from({ length: 10 }, (_, i) => `https://metrofence.net/p${i}.jpg`);
  const d = laneDeps({ brief: metroBrief(), firstPassPhotos });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  assert.equal(d.harvestCalls.length, 1, "ten of their own photos already: nothing to rescue, nothing to spend");
  assert.equal(out.design_brief.applied.photos, 0);
  assert.equal((d.captured.req.brand.photos || []).length, 10);
});

test("no brief means no second pass and no change in behaviour", async () => {
  const d = laneDeps({ firstPassPhotos: ["https://metrofence.net/only.jpg"] });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d });
  assert.equal(out.ok, true);
  assert.equal(out.design_brief.status, "disabled");
  assert.equal(d.harvestCalls.length, 1);
  assert.deepEqual(d.captured.req.brand.photos, ["https://metrofence.net/only.jpg"]);
});

// ---------------------------------------------------------------------------
// 3. THEIR TYPEFACE ON THE RESOLVER LANE.
// ---------------------------------------------------------------------------

const CAPTURED_FONTS = {
  ok: true,
  display: "Barlow Condensed",
  body: "Source Sans 3",
  href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Source+Sans+3:wght@400;600;700;800&display=swap",
  source: "https://metrofence.net/",
  provider: "declared",
};

test("captureFonts fills the resolver lane when the brief has no verified stylesheet", async () => {
  const d = laneDeps({ brief: metroBrief(), fonts: CAPTURED_FONTS });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  const fonts = d.captured.req.brand.fonts;
  assert.ok(fonts, "brand.fonts travels — the mirror no longer wears the donor's type by default");
  assert.equal(fonts.display, "Barlow Condensed");
  assert.equal(fonts.body, "Source Sans 3");
  assert.match(fonts.href, /^https:\/\/fonts\.googleapis\.com\//, "schema pattern honoured");
  assert.equal(fonts.provider, "declared");
  assert.equal(
    out.design_brief.applied.fonts,
    false,
    "the BRIEF did not supply these; the report must not say it did",
  );
});

test("the brief's own verified families still lead; captureFonts is never asked", async () => {
  let asked = 0;
  const brief = metroBrief({
    fontDisplay: "Oswald",
    fontBody: "Inter",
    fontHref: "https://fonts.googleapis.com/css2?family=Oswald:wght@600&family=Inter:wght@400",
  });
  const d = laneDeps({ brief, captureFontsImpl: async () => { asked += 1; return CAPTURED_FONTS; } });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.brand.fonts.display, "Oswald");
  assert.equal(asked, 0, "a rendered, stylesheet-verified family outranks a scraped declaration");
  assert.equal(out.design_brief.applied.fonts, true);
});

test("a font we cannot name and serve is not used — the donor's type stays", async () => {
  const d = laneDeps({ brief: metroBrief(), fonts: { ok: false, reason: "no_font_declared" } });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.brand.fonts, undefined, "no guessed family reaches the request");
});

test("captureFonts throwing costs the font, never the build", async () => {
  const d = laneDeps({ brief: metroBrief(), captureFontsImpl: async () => { throw new Error("ETIMEDOUT"); } });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.brand.fonts, undefined);
});

test("a SYNCHRONOUS throw is fail-soft too", async () => {
  const d = laneDeps({ brief: metroBrief(), captureFontsImpl: () => { throw new Error("boom"); } });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.brand.fonts, undefined);
});

test("an href the schema cannot admit is refused rather than 400-ing the build", async () => {
  const d = laneDeps({
    brief: metroBrief(),
    fonts: { ...CAPTURED_FONTS, href: "https://use.typekit.net/abc.css" },
  });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.brand.fonts, undefined, "a family we cannot serve never travels");
});

test("under the node runner an un-stubbed captureFonts never opens a socket", async () => {
  // No deps.captureFonts at all: the lane must skip the capture entirely rather
  // than reach for metrofence.net from a unit test.
  const d = laneDeps({ brief: metroBrief() });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, ...OPTS });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.brand.fonts, undefined);
});
