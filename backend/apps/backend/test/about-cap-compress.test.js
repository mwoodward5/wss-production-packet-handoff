"use strict";

// test/about-cap-compress.test.js — over-cap /content/about PORTIONS, never refuses.
//
// Production refusal, batch line_mtmat6q5_1250c77fbf: a roofing candidate died
// at the intake-genie authority-packet stage with `invalid_request (status 400)
// — /content/about: must NOT have more than 4000 characters`. The packet's own
// schema cap on about let one verbose homepage refuse an ENTIRE business,
// which inverts the factory doctrine: rich source copy is an ASSET (thin-in
// rich-out), so the cap portions it — at the last sentence boundary that fits,
// in the business's own words — and the build proceeds with a note.
//
// These tests lock both halves of that law: the compression happens before the
// engine's validator can see an over-cap string, and the cap itself stays
// intact for genuinely invalid packets.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ABOUT_MAX_LENGTH,
  mergeIntoContent,
  sentenceBoundedCut,
} = require("../lib/intake-packet");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const {
  CERTIFIED_GENIE_CONTENT_MARKER,
  leadMinerMirrorInput,
} = require("../lib/mirror-lane-build");

const SENTENCE = "We have served the Tulsa metro with honest roofing and gutter work for over twenty years. ";
const OVER_CAP_ABOUT = SENTENCE.repeat(60); // 5160 chars of the business's own prose

function certifiedPacket(about) {
  return { ok: true, about, faqs: [], serviceCopy: {}, keywords: [], seo: { title: "", description: "" } };
}

// A verified LeadMiner envelope plus the receipt-backed certified content whose
// canonical packet carries one `about`. Same shape mirror-lane-build.test.js's
// control fixture uses.
function leadMinerFixture(about) {
  const site = "https://fixture-plumbing.example/";
  const places = "https://places.googleapis.com/v1/places/ChIJMirrorControl";
  const proof = (source, source_kind = "website") => ({
    source,
    source_kind,
    captured_at: "2026-08-14T12:00:00.000Z",
  });
  const packet = {
    meta: { source: "leadminer_mirror_ready", build_ready: true, missing_build_evidence: [] },
    mirror_ready: {
      business_name: "Mirror Control Plumbing",
      place_id: "ChIJMirrorControl",
      industry: "plumber",
      city: "Tulsa",
      state: "OK",
      logo_url: `${site}logo.svg`,
      logo_source_url: site,
      photos: [{ url: `${site}truck.jpg`, source: "own_site" }],
      services: [{ name: "Drain cleaning" }],
      provenance: {
        "/business_name": proof(places, "google_places_api"),
        "/place_id": proof(places, "google_places_api"),
        "/industry": proof("leadminer:project-trade:plumber", "leadminer_derived"),
        "/city": proof(places, "google_places_api"),
        "/state": proof(places, "google_places_api"),
        "/logo_url": proof(site),
        "/logo_source_url": proof(site),
        "/photos/0/url": proof(site),
        "/photos/0/source": proof(site),
        "/services/0/name": proof(`${site}services`),
      },
    },
  };
  const certifiedContent = {
    [CERTIFIED_GENIE_CONTENT_MARKER]: true,
    verified: true,
    status: "verified",
    scope: "content_completeness_only",
    services: [{ name: "Drain cleaning" }],
    canonical_packet: certifiedPacket(about),
  };
  return { packet, certifiedContent };
}

// The minimal valid MirrorRequest, per the schema's own required list
// (slug + facts.business_name/industry/city/state) — same door badge-strip
// and brand-extractor knock on.
function validRequest(overrides = {}) {
  return {
    slug: "wss-test-cap-compress",
    donor: "roofing-falcon-clean",
    facts: {
      business_name: "Cap Compress Roofing",
      industry: "roofing",
      city: "Tulsa",
      state: "OK",
    },
    content: {},
    ...overrides,
  };
}

test("about cap mirrors the schema: 4000", () => {
  assert.equal(ABOUT_MAX_LENGTH, 4000);
});

test("an over-cap about compresses at a sentence boundary instead of refusing", () => {
  const notes = [];
  const out = mergeIntoContent({}, certifiedPacket(OVER_CAP_ABOUT), { notes });

  assert.ok(out.about.length <= ABOUT_MAX_LENGTH, `kept ${out.about.length} under the cap`);
  assert.ok(out.about.length >= Math.floor(ABOUT_MAX_LENGTH * 0.6), "the portion keeps most of the prose");
  assert.ok(/[.!?]$/.test(out.about), "the kept text ends on a whole sentence");
  assert.ok(OVER_CAP_ABOUT.startsWith(out.about), "the kept text is a prefix of the original — portioned, never reworded");
  assert.equal(out.about.length, sentenceBoundedCut(OVER_CAP_ABOUT, ABOUT_MAX_LENGTH).length);
});

test("the compression note names the field and carries the original length", () => {
  const notes = [];
  const out = mergeIntoContent({}, certifiedPacket(OVER_CAP_ABOUT), { notes });

  assert.deepEqual(notes, [{
    note: "about_compressed_to_cap",
    original_length: OVER_CAP_ABOUT.length,
    kept_length: out.about.length,
    cap: ABOUT_MAX_LENGTH,
  }]);
});

test("an under-cap about travels verbatim and logs no note", () => {
  const about = "Family owned since 1998. Two crews, one standard.";
  const notes = [];
  const out = mergeIntoContent({}, certifiedPacket(about), { notes });

  assert.equal(out.about, about);
  assert.deepEqual(notes, []);
});

test("the packet's about never overwrites verified content (gap law unchanged)", () => {
  const notes = [];
  const out = mergeIntoContent(
    { about: "The resolver's own verified narrative." },
    certifiedPacket(OVER_CAP_ABOUT),
    { notes },
  );
  assert.equal(out.about, "The resolver's own verified narrative.");
  assert.deepEqual(notes, []);
});

test("sentenceBoundedCut keeps whole words when no sentence boundary fits", () => {
  const noSentences = "word ".repeat(1200); // one unending run, no . ! ?
  const cut = sentenceBoundedCut(noSentences, ABOUT_MAX_LENGTH);

  assert.ok(cut.length <= ABOUT_MAX_LENGTH, "still under the cap");
  assert.ok(!/\s$/.test(cut), "never beheads into a trailing space");
  assert.ok(noSentences.trim().startsWith(cut.trim()), "still the business's own words");
});

test("sentenceBoundedCut returns short text untouched", () => {
  const about = "Short and true.";
  assert.equal(sentenceBoundedCut(about, ABOUT_MAX_LENGTH), about);
});

test("the schema cap itself is untouched — a raw over-cap about still refuses", () => {
  const got = checkMirrorRequest(validRequest({
    content: { about: "a".repeat(ABOUT_MAX_LENGTH + 1) },
  }));

  assert.equal(got.ok, false);
  const aboutError = (got.body.detail || []).find((row) => row.path === "/content/about");
  assert.ok(aboutError, "the refusal names /content/about");
  assert.equal(aboutError.keyword, "maxLength");
});

test("the compressed about passes the validator the packet used to die at", () => {
  const compressed = sentenceBoundedCut(OVER_CAP_ABOUT, ABOUT_MAX_LENGTH);
  const got = checkMirrorRequest(validRequest({ content: { about: compressed } }));

  assert.equal(got.ok, true, JSON.stringify(got.body || {}).slice(0, 400));
});

test("a genuinely invalid packet still refuses — compression is not an amnesty", () => {
  const wrongType = checkMirrorRequest(validRequest({ content: { about: 12345 } }));
  assert.equal(wrongType.ok, false);

  const unknownKey = checkMirrorRequest(validRequest({
    content: { about: "Fine prose.", invented_section: "never admitted" },
  }));
  assert.equal(unknownKey.ok, false);
});

test("the LeadMiner packet lane portions an over-cap canonical about and says so", () => {
  const { packet, certifiedContent } = leadMinerFixture(OVER_CAP_ABOUT);
  const out = leadMinerMirrorInput(packet, { certifiedContent });

  assert.equal(out.ok, true);
  assert.ok(out.content.about.length <= ABOUT_MAX_LENGTH, "the lane's about rides under the cap");
  assert.deepEqual(out.about_compressed_to_cap, {
    note: "about_compressed_to_cap",
    original_length: OVER_CAP_ABOUT.length,
    kept_length: out.content.about.length,
    cap: ABOUT_MAX_LENGTH,
  });
});

test("the packet lane records no note when the canonical about is under the cap", () => {
  const { packet, certifiedContent } = leadMinerFixture("Family owned since 1998.");
  const out = leadMinerMirrorInput(packet, { certifiedContent });

  assert.equal(out.ok, true);
  assert.equal(out.content.about, "Family owned since 1998.");
  assert.equal(out.about_compressed_to_cap, undefined);
});
