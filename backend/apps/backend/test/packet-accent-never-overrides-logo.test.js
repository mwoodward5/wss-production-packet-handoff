"use strict";

// test/packet-accent-never-overrides-logo.test.js — THE SCRAPE MUST NOT WEAR
// THE LOGO'S SLOT.
//
// Measured 2026-08-19 on the live Texas Best Fence & Patio mirror
// (wss-test-texas-best-fence-patio-lewisville.wss-ai.com). Their logo is a
// palette PNG that measures #00427d navy at 53% share — with THIS repo's own
// measureAccent, method png-js — plus a family of reds (#a40c11 …). The donor
// fencing-sterling bakes --accent: 38 80% 55%. The shipped stylesheet serves
// --accent: 33 79% 55%, which is #E79431 exactly — the amber that appears 21
// times in texasbestfence.com's own page markup as their CTA colour.
//
// The chain: the LeadMiner truth packet's brand_colors (a SITE scrape — its
// provenance points at the client's page) was forwarded as `brand.accent`,
// the engine's caller-supplied override. resolveBrandAssets takes that branch
// and NEVER MEASURES THE LOGO (lib/mirror-engine/brand-assets.js: `else if
// (brand.accent)` comes before the measurement). No measurement means no
// palette, no second hue, no brand.primary — which is why the shipped theme's
// tint hue is 33 (amber) and the donor's own --primary: 38 80% 55% survived in
// the base sheet: the whole brand surface was derived from the scrape.
//
// The schema is explicit that `accent` is "pre-measured … from the prospect's
// own logo". A site scrape is accent_fallback material: it may fill the hole
// when this runtime cannot read the bytes (the Just Air JPEG case,
// test/mined-brand-reaches-build.test.js), and it may never outrank the mark.

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const { leadMinerMirrorInput, rescueNeedsFill } = require("../lib/mirror-lane-build");
const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");

// ---------------------------------------------------------------------------
// A minimal, honest PNG encoder (colour type 6, RGBA). decodePngToRgba skips
// chunk CRCs, so zeroed CRCs decode exactly like real ones; nothing else about
// the file is fake — real signature, real IHDR, real deflate stream.
// ---------------------------------------------------------------------------
function pngFromRows(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: truecolour + alpha
  const raw = Buffer.concat(rows.map((row) => Buffer.concat([
    Buffer.from([0]), // filter: none
    Buffer.concat(row.map(([r, g, b]) => Buffer.from([r, g, b, 255]))),
  ])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const NAVY = [0, 66, 125];    // #00427d — the dominant colour of the real mark
const RED = [164, 12, 17];    // #a40c11 — the star
const WHITE = [255, 255, 255];
const GREY = [128, 128, 128];

// 10x10: six navy rows, two red rows, two white rows — the real mark's shape
// (navy-dominant with a red second hue; the white never qualifies as a brand
// colour, exactly like the real logo's paper).
const NAVY_RED_LOGO = pngFromRows([
  ...Array.from({ length: 6 }, () => Array.from({ length: 10 }, () => NAVY)),
  ...Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => RED)),
  ...Array.from({ length: 2 }, () => Array.from({ length: 10 }, () => WHITE)),
]);

// A mark whose pixels decode fine and yield NO qualifying colour — the honest
// "unmeasurable" case that must still be rescued by the miner's fallback.
const GREY_LOGO = pngFromRows(
  Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => GREY)),
);

const SITE_AMBER = "#E79431"; // the scraped CTA colour that shipped as the accent
const SITE_PAGE = "https://www.texasbestfence.com/";
const LOGO_URL = "https://www.texasbestfence.com/wp-content/uploads/tbf-logo.png";

// ---------------------------------------------------------------------------
// The packet, in the exact shape the LeadMiner webhook stores (the Rocky's
// Plumbing anatomy — see test/line-packet-honest-failure.test.js).
// ---------------------------------------------------------------------------
function texasPacket() {
  const provenance = {};
  const stamp = (pointer, kind = "site_scrape") => {
    provenance[pointer] = {
      source: kind === "google_places_api"
        ? "https://places.googleapis.com/v1/places/ChIJtexasbestfence0000000"
        : SITE_PAGE,
      captured_at: "2026-08-19T18:00:00.000Z",
      source_kind: kind,
    };
  };
  stamp("/business_name", "google_places_api");
  stamp("/place_id", "google_places_api");
  stamp("/industry");
  stamp("/city");
  stamp("/state");
  stamp("/logo_url");
  stamp("/logo_source_url");
  stamp("/website_url");
  stamp("/photos/0/url");
  stamp("/photos/0/source");
  stamp("/services/0/name");
  stamp("/brand_colors/accent");
  return {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
    mirror_ready: {
      business_name: "Texas Best Fence & Patio",
      place_id: "ChIJtexasbestfence0000000",
      industry: "fencing",
      city: "Lewisville",
      state: "TX",
      website_url: SITE_PAGE,
      logo_url: LOGO_URL,
      logo_source_url: SITE_PAGE,
      photos: [{ url: "https://www.texasbestfence.com/wp-content/uploads/job1.jpg", source: "own_site" }],
      services: [{ name: "Fence Installation" }],
      // THE SCRAPE: their site's amber CTA colour, provenanced to their PAGE —
      // not to the logo, because it was never measured from the logo.
      brand_colors: { accent: SITE_AMBER },
      provenance,
    },
  };
}

// ---------------------------------------------------------------------------
// Door 1 — the truth-packet lane.
// ---------------------------------------------------------------------------

test("a packet's scraped brand colour travels as accent_fallback, never as the engine's accent override", () => {
  const input = leadMinerMirrorInput(texasPacket());
  assert.equal(input.ok, true, JSON.stringify(input));
  assert.equal(input.brand.accent, undefined, "the override slot stays empty — the logo must be measured");
  assert.equal(input.brand.accent_fallback, SITE_AMBER, "the scrape still travels, under its honest name");
  assert.equal(input.brand.accent_fallback_source, SITE_PAGE);
});

test("a scraped colour with no provenance is dropped entirely — not promoted to any slot", () => {
  const packet = texasPacket();
  delete packet.mirror_ready.provenance["/brand_colors/accent"];
  const input = leadMinerMirrorInput(packet);
  assert.equal(input.ok, true, JSON.stringify(input));
  assert.equal(input.brand.accent, undefined);
  assert.equal(input.brand.accent_fallback, undefined, "an unprovenanced colour reaches nothing");
});

// ---------------------------------------------------------------------------
// Door 2 — the stored-contract rescue (needs_fill).
// ---------------------------------------------------------------------------

function needsFillInput() {
  return {
    ok: true,
    needs_fill: true,
    missing: ["logo"],
    facts: {
      business_name: "Texas Best Fence & Patio",
      industry: "fencing",
      city: "Lewisville",
      state: "TX",
      place_id: "ChIJtexasbestfence0000000",
    },
    brand: {},
    content: {},
    photos: [],
  };
}

function prospectWithContractBrand(brand) {
  return {
    record: {
      build_ready: {
        version: 1,
        mirror_request: {
          slug: "wss-test-texas-best-fence-patio-lewisville",
          brand,
          content: { services: [{ name: "Fence Installation" }] },
        },
      },
    },
  };
}

test("the stored-contract door demotes the contract's accent to accent_fallback", async () => {
  const out = await rescueNeedsFill({
    input: needsFillInput(),
    prospect: prospectWithContractBrand({
      logo: LOGO_URL,
      accent: SITE_AMBER,
      accent_source: SITE_PAGE,
    }),
    packet: {},
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.input.brand.logo, LOGO_URL, "the contract's mark is still rescued");
  assert.equal(out.input.brand.accent, undefined, "the override slot stays empty here too");
  assert.equal(out.input.brand.accent_fallback, SITE_AMBER);
  assert.equal(out.input.brand.accent_fallback_source, SITE_PAGE);
});

test("a contract that already carries its own accent_fallback keeps it over the demoted accent", async () => {
  const out = await rescueNeedsFill({
    input: needsFillInput(),
    prospect: prospectWithContractBrand({
      logo: LOGO_URL,
      accent: SITE_AMBER,
      accent_source: SITE_PAGE,
      accent_fallback: "#0C449A",
      accent_fallback_source: LOGO_URL,
    }),
    packet: {},
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.input.brand.accent, undefined);
  assert.equal(out.input.brand.accent_fallback, "#0C449A", "the colour recorded under its correct name wins");
  assert.equal(out.input.brand.accent_fallback_source, LOGO_URL);
});

// ---------------------------------------------------------------------------
// The engine, handed the corrected shape — the paired proof.
// ---------------------------------------------------------------------------

test("the failing record shape now measures the logo's own colour; the scrape reaches nothing it can outrank", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(NAVY_RED_LOGO, { status: 200, headers: { "content-type": "image/png" } });
  try {
    const out = await resolveBrandAssets({
      logo: LOGO_URL,
      accent_fallback: SITE_AMBER,
      accent_fallback_source: SITE_PAGE,
    });
    assert.equal(out.ok, true, JSON.stringify(out.detail || ""));
    assert.equal(out.accent, "#00427d", "the accent is the logo's dominant colour, measured from the bytes");
    assert.match(out.accent_origin, /^measured_from_logo\(/);
    assert.notEqual(out.accent.toUpperCase(), SITE_AMBER, "the scraped amber can no longer ship as the accent");
    // The measurement also unlocks the SECOND logo colour, which the amber
    // override starved: no palette meant no brand.primary, which is why the
    // live sheet's tint hue was the amber's, not the logo's.
    assert.equal(out.primary, "#a40c11", "the red star becomes the second brand colour");
    assert.match(out.primary_origin, /second_hue/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a mark that decodes but carries no measurable colour is still rescued by the miner's fallback", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(GREY_LOGO, { status: 200, headers: { "content-type": "image/png" } });
  try {
    const out = await resolveBrandAssets({
      logo: LOGO_URL,
      accent_fallback: SITE_AMBER,
      accent_fallback_source: SITE_PAGE,
    });
    assert.equal(out.ok, true, JSON.stringify(out.detail || ""));
    assert.equal(out.accent, SITE_AMBER, "the Just Air rescue is intact — a hole is still filled");
    assert.equal(out.accent_origin, "measured_by_miner_from_same_logo");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a third-party mark still refuses the build — the fallback launders nothing", async () => {
  // The denylist runs BEFORE any fetch, so no stub is needed: the refusal is
  // decided on the URL alone, exactly as for a directly-supplied accent.
  const out = await resolveBrandAssets({
    logo: "https://www.texasbestfence.com/wp-content/uploads/mastercool-logo10874446.png",
    accent_fallback: SITE_AMBER,
    accent_fallback_source: SITE_PAGE,
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "brand_asset_rejected");
  assert.ok(out.detail.some((d) => d.path === "/brand/logo"), JSON.stringify(out.detail));
});
