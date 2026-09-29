"use strict";

// test/photo-uri-sanitize.test.js — a malformed photo URL can never again kill
// a real business at request validation.
//
// THE INCIDENT (campaign line_mtifkuok, plumbing nationwide, 2026-08-31): TDT
// Plumbing, Abacus Plumbing, Apollo Home, Archie's Plumbing, Fancher Services
// and Cloverdale Plumbing all died `build_retry_exhausted`. The underlying
// cause was visible on Belknap Plumbing: "invalid_request (status 400) —
// /brand/photos/14: must match format uri". The assembly paths gated photo
// lists on the ^https:// PREFIX only, but the mirror-request schema types
// every brand URI as format "uri" + ^https://, and ajv's uri format fails any
// URL carrying a single space or control character anywhere inside. A business
// with >=14 harvested photos, some malformed, 400'd at REQUEST validation —
// where retrying can never help — and burned its retry budget to death.
//
// The fix is sanitation before validation (lib/mirror-engine/
// photo-uri-sanitize.js): drop what cannot be an absolute https URI, count the
// drops, build with what validates. Zero valid photos is the existing
// no-photos path (donor slots stay unfilled), never a refusal.

const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeHttpsUri, sanitizePhotoUris, SCHEMA_MAX_PHOTOS } = require("../lib/mirror-engine/photo-uri-sanitize");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { genieToMirrorRequest } = require("../lib/mirror-engine/from-genie");
const { buildMirrorForProspect } = require("../lib/mirror-lane-build");

// ---------------------------------------------------------------------------
// 1. THE SANITIZER, unit-level.
// ---------------------------------------------------------------------------

test("16 harvested photos with 3 malformed keep the 13 valid, in order, with the drop counted", () => {
  const valid = Array.from({ length: 13 }, (_, i) => `https://tdtplumbing.com/work/job-${i}.jpg`);
  const candidates = [
    valid[0], valid[1],
    "/images/gallery.jpg",                                  // relative path
    "data:image/png;base64,iVBORw0KGgo=",                   // data: URI
    valid[2], valid[3], valid[4],
    "https://tdtplumbing.com/pic (1).jpg",                  // whitespace inside
    valid[5], valid[6], valid[7], valid[8], valid[9],
    valid[10], valid[11], valid[12],
  ];
  assert.equal(candidates.length, 16);
  const { photos, droppedInvalid } = sanitizePhotoUris(candidates);
  assert.deepEqual(photos, valid, "the valid photos travel, in harvest order");
  assert.equal(droppedInvalid, 3, "the drop is counted, not silent");
});

test("an all-valid list is returned unchanged", () => {
  const valid = ["https://a.com/1.jpg", "https://b.com/2.png?w=800", "https://c.com/x/y.webp"];
  const { photos, droppedInvalid } = sanitizePhotoUris(valid);
  assert.deepEqual(photos, valid);
  assert.equal(droppedInvalid, 0);
});

test("zero valid photos is an empty list, never a refusal", () => {
  const { photos, droppedInvalid } = sanitizePhotoUris([
    "images/gallery.jpg",
    "data:image/png;base64,iVBORw0KGgo=",
    "//cdn.example.com/protocol-relative.jpg",
    "https://x.com/spaced out.jpg",
  ]);
  assert.deepEqual(photos, []);
  assert.equal(droppedInvalid, 4);
});

test("the maxItems cap applies AFTER filtering, so a capped list still validates", () => {
  const valid = Array.from({ length: 22 }, (_, i) => `https://a.com/p${i}.jpg`);
  const { photos, droppedInvalid } = sanitizePhotoUris([
    "not a url at all",
    ...valid,
    "https://a.com/late (1).jpg",
  ], { max: SCHEMA_MAX_PHOTOS });
  assert.equal(photos.length, SCHEMA_MAX_PHOTOS);
  assert.deepEqual(photos, valid.slice(0, SCHEMA_MAX_PHOTOS), "first valid photos win, order kept");
  assert.equal(droppedInvalid, 2, "the malformed two are counted; the cap truncation is not a drop");
});

test("outer whitespace is trimmed away, scheme case is normalized, duplicates counted once", () => {
  assert.deepEqual(
    sanitizePhotoUris(["  https://a.com/1.jpg\n", "HTTPS://a.com/1.jpg"]).photos,
    ["https://a.com/1.jpg"],
    "a wrapped string is the same address after trim; a second occurrence is a duplicate",
  );
  const { photos, droppedInvalid } = sanitizePhotoUris(["  https://a.com/1.jpg\n", "HTTPS://a.com/1.jpg"]);
  assert.equal(photos.length, 1);
  assert.equal(droppedInvalid, 1, "the duplicate is a drop the operator sees");
});

test("sanitizeHttpsUri: what travels and what cannot", () => {
  assert.equal(sanitizeHttpsUri("https://a.com/logo.png"), "https://a.com/logo.png");
  assert.equal(sanitizeHttpsUri("  https://a.com/logo.png  "), "https://a.com/logo.png", "trim is a repair");
  assert.equal(sanitizeHttpsUri("HTTPS://a.com/logo.png"), "https://a.com/logo.png", "scheme case is normalized");
  assert.equal(sanitizeHttpsUri("https://a.com/a.jpg\n"), "https://a.com/a.jpg", "a trailing newline is trim-repair");
  assert.equal(sanitizeHttpsUri("http://a.com/logo.png"), "", "plain http fails the ^https:// pattern");
  assert.equal(sanitizeHttpsUri("data:image/png;base64,iVBORw0KGgo="), "");
  assert.equal(sanitizeHttpsUri("//cdn.example.com/a.jpg"), "");
  assert.equal(sanitizeHttpsUri("/images/a.jpg"), "");
  assert.equal(sanitizeHttpsUri("https://a.com/spaced out.png"), "", "internal whitespace is ajv's uri failure");
  assert.equal(sanitizeHttpsUri("https://a.com/a\u0001b.jpg"), "", "control characters fail uri");
  assert.equal(sanitizeHttpsUri(""), "");
  assert.equal(sanitizeHttpsUri(null), "");
  assert.equal(sanitizeHttpsUri(42), "");
});

// ---------------------------------------------------------------------------
// 2. THE SCHEMA PIN: the exact 400 that killed six businesses, and its absence
//    after sanitation.
// ---------------------------------------------------------------------------

function minimalRequest(photoUrls) {
  return {
    slug: "wss-test-tdt-plumbing",
    facts: { business_name: "TDT Plumbing", industry: "plumbing", city: "Tucson", state: "AZ" },
    brand: { photos: photoUrls },
  };
}

test("the production cause, pinned: one spaced URL inside 14 400s at /brand/photos/N", () => {
  const raw = [
    ...Array.from({ length: 14 }, (_, i) => `https://tdtplumbing.com/work/job-${i}.jpg`),
    "https://tdtplumbing.com/pic (1).jpg",
  ];
  const verdict = checkMirrorRequest(minimalRequest(raw));
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 400);
  assert.equal(verdict.body.error, "invalid_request");
  const photoErrors = verdict.body.detail.filter((d) => String(d.path || "").startsWith("/brand/photos/"));
  assert.ok(photoErrors.length >= 1, "the failure names the photo index");
  assert.ok(
    photoErrors.some((d) => /must match format "uri"|format uri/.test(String(d.message))),
    `the message is the format-uri one, got: ${photoErrors.map((d) => d.message).join(" | ")}`,
  );
});

test("the same list, sanitized, validates clean", () => {
  const raw = [
    ...Array.from({ length: 14 }, (_, i) => `https://tdtplumbing.com/work/job-${i}.jpg`),
    "https://tdtplumbing.com/pic (1).jpg",
  ];
  const { photos } = sanitizePhotoUris(raw);
  assert.equal(checkMirrorRequest(minimalRequest(photos)).ok, true);
});

// ---------------------------------------------------------------------------
// 3. THE RESOLVER LANE, end to end with stubbed deps: the request that leaves
//    buildMirrorForProspect is valid, the gallery is the valid set, the drop
//    is on the record.
// ---------------------------------------------------------------------------

const PROSPECT = {
  prospect_id: "place-tdt-plumbing",
  business_name: "TDT Plumbing",
  industry: "plumbing",
  services: ["Water heater replacement", "Drain cleaning"],
  site: "https://tdtplumbing.com/",
  logo: "https://tdtplumbing.com/logo.png",
  place_id: "ChIJtdtplumbing",
};

function photoRow(url, i) {
  return {
    url,
    source: "own_site",
    // 64-hex, like every real harvest sha — the schema pins the pattern.
    sha256: i.toString(16).padStart(2, "0").repeat(32),
    ext: "jpg",
    bytes: 180000,
    width: 1600,
    height: 900,
  };
}

function laneDeps({ firstPassPhotos = [] } = {}) {
  const captured = {};
  return {
    captured,
    resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
    // The fleet, hermetic: no supabase in unit tests.
    readFleetIdentities: async () => ({ ok: true, identities: [] }),
    recordFleetIdentity: async () => ({ ok: true }),
    claimSamenessRetry: async () => ({ ok: false, claimed: false }),
    resolveVerifiedFacts: async () => ({
      ok: true,
      facts: {
        business_name: "TDT Plumbing", city: "Tucson", state: "AZ",
        phone: "(520) 555-0134", current_website: "https://tdtplumbing.com/",
        rating: 4.9, review_count: 63,
      },
      content: { services: ["Water heater replacement", "Drain cleaning"] },
      coverage: {},
    }),
    // The harvest really did hand back values like these: a markup src with a
    // space inside survives the ^https:// prefix filter that used to be the
    // only gate, and reached brand.photos — and the 400.
    harvestClientPhotos: async () => ({ ok: true, photos: firstPassPhotos.map((url, i) => photoRow(url, i)) }),
    captureFonts: async () => ({ ok: false, source: "none" }),
    buildDesignBrief: async () => ({ ok: false, reason: "disabled" }),
    mirror: async (req) => {
      captured.req = req;
      return {
        status: 200,
        body: {
          ok: true,
          revealable: true,
          preview_url: `https://${req.slug}.wss-ai.com/`,
          checks: { content: { status: "none", sections: 0 } },
        },
      };
    },
  };
}

const CLEAN_13 = Array.from({ length: 13 }, (_, i) => `https://tdtplumbing.com/work/job-${i}.jpg`);
const MALFORMED_3 = [
  "https://tdtplumbing.com/pic (1).jpg",
  "https://tdtplumbing.com/photo final.jpg",
  "https://tdtplumbing.com/big picture/wall.jpg",
];

test("a 16-photo harvest with 3 malformed ships 13 valid photos and a valid request", async () => {
  const d = laneDeps({ firstPassPhotos: [...CLEAN_13, ...MALFORMED_3] });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d });
  assert.equal(out.ok, true, "the build proceeds — sanitation, not gating");

  const shipped = d.captured.req.brand.photos || [];
  assert.deepEqual(shipped, CLEAN_13, "the valid photos travel in order; the malformed three are gone");

  // THE ACTUAL FIX: the request the lane dispatches passes the schema the
  // engine validates it with — no 400, so no retry budget can burn on it.
  assert.equal(checkMirrorRequest(d.captured.req).ok, true);

  assert.equal(out.brand_photos_dropped_invalid, 3, "the drop is reported on the build result");
});

test("a harvest where nothing is usable takes the no-photos path: no brand.photos, build proceeds", async () => {
  const d = laneDeps({ firstPassPhotos: MALFORMED_3 });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d });
  assert.equal(out.ok, true, "zero valid photos is the donor-stock path, never a refusal");
  assert.equal(d.captured.req.brand.photos, undefined, "no photos key: the donor's declared slots stay unfilled");
  assert.equal(out.brand_photos_dropped_invalid, 3);
  assert.equal(checkMirrorRequest(d.captured.req).ok, true);
});

test("an all-valid harvest ships unchanged and reports no drops", async () => {
  const d = laneDeps({ firstPassPhotos: CLEAN_13.slice(0, 3) });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d });
  assert.equal(out.ok, true);
  assert.deepEqual(d.captured.req.brand.photos, CLEAN_13.slice(0, 3));
  assert.equal(out.brand_photos_dropped_invalid, undefined, "nothing to report");
});

// ---------------------------------------------------------------------------
// 4. THE GENIE PACKET PIPE: same sanitation on from-genie's brand assembly.
// ---------------------------------------------------------------------------

const VERIFIED_NAP = {
  phone: "(520) 900-1442",
  website: "https://www.lyonsroofing.com/",
  address: "895 W Grant Rd, Tucson, AZ 85705",
  source: "leadminer:place-lyons-roofing",
};

function geniePacket(assets) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    facts: {
      name: "Lyons Roofing",
      category: "Roofing",
      city: "Tucson",
      state: "AZ",
      service_areas: [],
      brands: [],
    },
    evidence: [],
    assets,
    trust: { rating: null, review_count: null, reviews: [] },
    optimization: { seo_gaps: [], target_queries: [], schema_types: [] },
  };
}

test("from-genie drops malformed photo assets with a count and 400-proof brand fields", () => {
  const r = genieToMirrorRequest(geniePacket([
    { kind: "logo", url: "https://www.lyonsroofing.com/logo.png", approved: true, meta: {} },
    { kind: "photo", url: "https://www.lyonsroofing.com/job1.jpg", approved: true },
    { kind: "photo", url: "https://www.lyonsroofing.com/job 2.jpg", approved: true },
    { kind: "photo", url: "data:image/png;base64,iVBORw0KGgo=", approved: true },
    { kind: "photo", url: "/uploads/job3.jpg", approved: true },
  ]), { slug: "wss-test-lyons-roofing-tucson", verifiedNap: VERIFIED_NAP });
  assert.equal(r.ok, true);
  assert.deepEqual(r.request.brand.photos, ["https://www.lyonsroofing.com/job1.jpg"]);
  assert.equal(r.brand_photos_dropped_invalid, 3);
  assert.equal(checkMirrorRequest(r.request).ok, true, "the assembled request validates");
});

test("from-genie: an un-URI-able logo falls to the photos rung instead of 400ing", () => {
  const r = genieToMirrorRequest(geniePacket([
    { kind: "logo", url: "https://www.lyonsroofing.com/big logo.png", approved: true, meta: {} },
    { kind: "photo", url: "https://www.lyonsroofing.com/job1.jpg", approved: true },
  ]), { slug: "wss-test-lyons-roofing-tucson", verifiedNap: VERIFIED_NAP });
  assert.equal(r.ok, true);
  assert.equal(r.request.brand.logo, undefined, "a logo the schema would 400 on is no logo");
  assert.deepEqual(r.request.brand.photos, ["https://www.lyonsroofing.com/job1.jpg"]);
  assert.equal(checkMirrorRequest(r.request).ok, true);
});
