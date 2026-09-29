"use strict";

// test/from-genie-content-schema.test.js — the regression that keeps the
// content pipe open.
//
// ROOT DEFECT (reproduced live, 2026-07-30): from-genie emitted
//   { services, hours, booking_url, socials, reviews, optimization, evidence }
// MirrorContent is `additionalProperties: false` and declares none of
// booking_url / socials / optimization / evidence, so a caller that attached
// this to request.content got 400 invalid_request. Nobody attached it, so
// engine.js:275 never ran and EVERY mirror shipped `content: "none"`.
//
// These tests validate the mapper's real output against the REAL schema (the
// same Ajv instance the engine uses, via checkMirrorRequest) — including
// against the live intake-genie-v2 packet captured from
// jacksonvilleroofingusa.com on 2026-07-31. If the shape ever drifts back, the
// 400 shows up here instead of in production silence.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const {
  genieToMirrorRequest,
  packetToMirrorContent,
  packetToExtra,
} = require("../lib/mirror-engine/from-genie");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const schema = require("../lib/mirror-engine/mirror-request.schema.json");

const LIVE_PACKET = require("./fixtures/genie-packet-jacksonville-roofing-usa.json");

// CONTRACT CHANGE 2026-07-31: this same live packet also fabricated a phone
// number (test/genie-fabrication.test.js). Content is now quarantined behind
// GENIE_CONTENT_ENABLED and NAP never crosses the boundary, so the tests that
// build a whole request opt content in explicitly and supply a verified NAP.
// The mapping tests below still call packetToMirrorContent directly, because
// the mapper's job — shape the content correctly — is unchanged.
const VERIFIED_NAP = {
  phone: "(520) 900-1442",
  source: "leadminer:place-lyons-roofing",
};
const VERIFIED_NAP_JAX = {
  phone: "(904) 516-4279",
  source: "operator:site-check-2026-07-31",
};

// A standalone MirrorContent validator built from the REAL schema file, so a
// content object can be checked on its own as well as inside a request.
const ajv = new Ajv2020({ allErrors: true, strict: true, removeAdditional: false, useDefaults: false, coerceTypes: false });
addFormats(ajv);
const validateContent = ajv.compile({
  $schema: schema.$schema,
  $ref: "#/$defs/MirrorContent",
  $defs: schema.$defs,
});

function contentErrors(content) {
  return validateContent(content) ? [] : (validateContent.errors || []).map((e) => `${e.instancePath || "/"} ${e.keyword}: ${e.message}`);
}

/** A packet carrying every content field the mapper knows how to home. */
function richPacket(over = {}) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    scope: { supported: true, category: "roofing", message: "" },
    facts: {
      name: "Lyons Roofing",
      city: "Tucson",
      state: "AZ",
      category: "roofing",
      phone: "(520) 900-1442",
      email: "",
      website: "https://www.lyonsroofing.com/",
      address: "895 W Grant Rd, Tucson, AZ 85705",
      latlng: [32.254, -110.9742],
      hours: { mon: "7-5", tue: "7-5" },
      booking_url: "https://www.lyonsroofing.com/book",
      services: [
        "Roof Replacement",
        { name: "Roof Repair", description: "Leak tracing and shingle repair." },
        "Storm Damage",
      ],
      socials: ["https://facebook.com/lyonsroofing"],
      faqs: [{ question: "Do you offer financing?", answer: "Yes, through approved lenders." }],
      about: "Lyons Roofing has served southern Arizona since 1993.",
      areas_served: ["Tucson", "Oro Valley", "Marana"],
      mission: "Do the job once, do it right.",
      founded: 1993,
      team: [{ name: "Kevin Lyons", title: "Owner", bio: "Third-generation roofer." }],
      certifications: ["GAF Master Elite"],
      press: [{ title: "Best of Tucson", url: "https://tucsonweekly.com/best" }],
      ...(over.facts || {}),
    },
    evidence: [{ field: "name", value: "Lyons Roofing", source_type: "website", confidence: 0.95 }],
    assets: [{ kind: "logo", url: "https://www.lyonsroofing.com/logo.png", approved: true, meta: {} }],
    trust: { rating: 4.8, review_count: 412, reviews: [{ author: "Jane D.", text: "Great crew.", rating: 5 }] },
    optimization: { seo_gaps: ["local schema"], target_queries: ["roofing tucson"], schema_types: ["LocalBusiness"] },
    ...over.top,
  };
}

test("REGRESSION: content carries no key MirrorContent does not declare", () => {
  const declared = new Set(Object.keys(schema.$defs.MirrorContent.properties));
  const content = packetToMirrorContent(richPacket());
  for (const k of Object.keys(content)) {
    assert.ok(declared.has(k), `content.${k} is not a MirrorContent property — this is the exact 400`);
  }
  // The four keys that caused the live 400 must be gone from content...
  for (const k of ["booking_url", "socials", "optimization", "evidence"]) {
    assert.ok(!(k in content), `${k} must not be in content`);
  }
  // ...and the non-NAP remainder is still present, not dropped, in the sibling.
  const extra = packetToExtra(richPacket());
  assert.deepEqual(extra.socials, ["https://facebook.com/lyonsroofing"]);
  assert.ok(extra.optimization.target_queries.length);
  assert.ok(extra.evidence.length);
  // booking_url used to live in extra. It is website-class NAP and is now
  // dropped at the boundary with the rest of the fabricating class; only its
  // NAME survives, in the audit list.
  assert.ok(!("booking_url" in extra), "booking_url is NAP-shaped and quarantined");
  assert.ok(extra.dropped_nap.includes("booking_url"));
});

test("a rich packet maps to a schema-VALID MirrorContent", () => {
  const content = packetToMirrorContent(richPacket());
  assert.deepEqual(contentErrors(content), []);

  assert.deepEqual(content.services, [
    { name: "Roof Replacement" },
    { name: "Roof Repair", description: "Leak tracing and shingle repair." },
    { name: "Storm Damage" },
  ]);
  // The review's WORDS survive; its star NUMBER does not. A per-review rating is
  // a trust numeral the Genie cannot verify, it rides verbatim into
  // window.__WSS_CONTENT__.reviews where a `consumes_content` donor can render
  // it, and unlike text a number can be silently aggregated. Quarantined with
  // trust.rating / trust.review_count — see test/genie-fabrication.test.js §2B.
  assert.deepEqual(content.reviews, [{ text: "Great crew.", author: "Jane D." }]);
  assert.deepEqual(content.faqs, [{ q: "Do you offer financing?", a: "Yes, through approved lenders." }]);
  assert.deepEqual(content.areas, ["Tucson", "Oro Valley", "Marana"]);
  assert.deepEqual(content.hours, { mon: "7-5", tue: "7-5" });
  assert.equal(content.about, "Lyons Roofing has served southern Arizona since 1993.");
  assert.equal(content.mission, "Do the job once, do it right.");
  assert.equal(content.founded_year, 1993);
  assert.deepEqual(content.team, [{ name: "Kevin Lyons", role: "Owner", bio: "Third-generation roofer." }]);
  assert.deepEqual(content.awards, ["GAF Master Elite"]);
  assert.deepEqual(content.press, [{ label: "Best of Tucson", href: "https://tucsonweekly.com/best" }]);
});

test("the full mapped request (content attached) passes the engine's strict validator", () => {
  const r = genieToMirrorRequest(richPacket(), {
    slug: "wss-test-lyons-roofing-tucson",
    verifiedNap: VERIFIED_NAP,
    genieContent: true,
  });
  assert.equal(r.ok, true);
  assert.ok(r.request.content, "content must be ATTACHED to the request or engine.js:275 never runs");
  const structural = checkMirrorRequest(r.request);
  assert.equal(structural.ok, true, JSON.stringify(structural.body));
});

test("TRUTH LAW: a field the packet lacks is ABSENT, never blanked or invented", () => {
  const bare = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    facts: { name: "Bare Co", city: "Tucson", state: "AZ", category: "roofing", phone: "(520) 900-1442" },
    assets: [],
    trust: {},
  };
  const content = packetToMirrorContent(bare);
  assert.deepEqual(content, {}, "an empty packet produces NO content keys");
  assert.deepEqual(contentErrors(content), []);
  for (const k of ["services", "faqs", "reviews", "areas", "about", "hours", "mission", "team", "awards", "press", "founded_year"]) {
    assert.ok(!(k in content), `${k} must be absent, not empty-defaulted`);
  }
  // ...and an empty content object is NOT attached (engine reads {} as none).
  const r = genieToMirrorRequest(bare, { slug: "wss-test-bare-co", verifiedNap: VERIFIED_NAP, genieContent: true });
  assert.ok(!("content" in r.request), "empty content must not be attached");
});

test("TRUTH LAW: FAQs with no source ship none; half-empty pairs are dropped", () => {
  const content = packetToMirrorContent(richPacket({ facts: { faqs: [{ question: "Cost?", answer: "" }, { question: "", answer: "Yes" }] } }));
  assert.ok(!("faqs" in content), "no complete Q/A pair => no faqs key at all");
  assert.deepEqual(contentErrors(content), []);
});

test("TRUTH LAW: a review with no text is dropped; a nameless review keeps no author", () => {
  const content = packetToMirrorContent(richPacket({
    top: { trust: { reviews: [{ author: "Anon" }, { text: "Solid work." }] } },
  }));
  assert.deepEqual(content.reviews, [{ text: "Solid work." }]);
  assert.deepEqual(contentErrors(content), []);
});

test("schema caps are respected (arrays never exceed maxItems)", () => {
  const many = Array.from({ length: 40 }, (_, i) => `Service ${i}`);
  const manyAreas = Array.from({ length: 40 }, (_, i) => `Area ${i}`);
  const manyReviews = Array.from({ length: 40 }, (_, i) => ({ text: `Review ${i}` }));
  const content = packetToMirrorContent(richPacket({
    facts: { services: many, areas_served: manyAreas },
    top: { trust: { reviews: manyReviews } },
  }));
  assert.equal(content.services.length, 24);
  assert.equal(content.areas.length, 18);
  assert.equal(content.reviews.length, 10);
  assert.deepEqual(contentErrors(content), []);
});

test("press without an https href is dropped (schema requires RequiredHttpsUri)", () => {
  const content = packetToMirrorContent(richPacket({ facts: { press: [{ title: "Local paper", url: "http://insecure.example/x" }] } }));
  assert.ok(!("press" in content));
  assert.deepEqual(contentErrors(content), []);
});

test("truth_source is only present when the caller supplies a real path", () => {
  const p = path.resolve(__dirname, "fixtures/genie-packet-jacksonville-roofing-usa.json");
  const withTs = packetToMirrorContent(richPacket(), { truthSource: p });
  assert.deepEqual(withTs.truth_source, [p]);
  assert.deepEqual(contentErrors(withTs), []);
  assert.ok(!("truth_source" in packetToMirrorContent(richPacket())), "never manufactured");
});

// --- THE LIVE PACKET ------------------------------------------------------
// Captured from POST {INTAKE_GENIE_BASE_URL}/api/intake-genie/compile for
// jacksonvilleroofingusa.com, 2026-07-31. This is the shape production
// actually returns, not a hand-written guess.

test("LIVE packet: the real Genie packet maps to schema-valid content", () => {
  const content = packetToMirrorContent(LIVE_PACKET);
  assert.deepEqual(contentErrors(content), [], "the live packet must not produce an invalid content object");
  assert.ok(content.services.length > 0, "the live packet does carry services");
  for (const s of content.services) assert.equal(typeof s.name, "string");
});

test("LIVE packet: the whole request validates and content is attached", () => {
  const r = genieToMirrorRequest(LIVE_PACKET, {
    slug: "wss-test-jacksonville-roofing-usa-genie",
    verifiedNap: VERIFIED_NAP_JAX,
    genieContent: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r.detail || r.error));
  assert.ok(r.request.content, "content attached");
  const structural = checkMirrorRequest(r.request);
  assert.equal(structural.ok, true, JSON.stringify(structural.body));
});

test("LIVE packet: fields the packet did not carry stay absent", () => {
  const content = packetToMirrorContent(LIVE_PACKET);
  // The live packet has trust.reviews = [], no faqs, no about, no areas, no
  // hours. Nothing may appear for any of them.
  for (const k of ["reviews", "faqs", "about", "areas", "hours", "team", "awards", "press", "mission", "founded_year"]) {
    assert.ok(!(k in content), `${k} must be absent — the live packet carries no source for it`);
  }
});

test("LIVE packet: markup residue is trimmed, the business name is not a service", () => {
  const raw = LIVE_PACKET.facts.services;
  assert.ok(raw.some((s) => /\\$/.test(s)), "fixture still holds the scraped residue this rule exists for");
  const content = packetToMirrorContent(LIVE_PACKET);
  for (const s of content.services) {
    assert.ok(!/[\\|/\s]$/.test(s.name), `service "${s.name}" still carries scrape residue`);
    assert.notEqual(s.name.toLowerCase(), LIVE_PACKET.facts.name.toLowerCase(), "the business name is not one of its own services");
  }
});
