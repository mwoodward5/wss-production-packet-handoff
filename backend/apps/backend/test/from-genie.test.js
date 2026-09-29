"use strict";

// test/from-genie.test.js — the Genie-packet -> MirrorRequest pipe.
// Fixture shape mirrors intake-genie-core.mjs buildCanonicalPacket() exactly.
//
// CONTRACT CHANGE 2026-07-31 (see test/genie-fabrication.test.js for the why):
// the Genie fabricated a phone number and stamped it "operator_verified", so
// this pipe no longer carries NAP at all — phone/address/email/website must be
// supplied by the caller via `verifiedNap` from an independent source — and its
// descriptive content is quarantined behind GENIE_CONTENT_ENABLED (default
// OFF). The tests below therefore pass a verified NAP and opt content in
// explicitly; that opt-in is the whole point, not boilerplate.

const test = require("node:test");
const assert = require("node:assert/strict");
const { genieToMirrorRequest } = require("../lib/mirror-engine/from-genie");

/** NAP observed independently of the Genie (a LeadMiner row, in production). */
const VERIFIED_NAP = {
  phone: "(520) 900-1442",
  website: "https://www.lyonsroofing.com/",
  address: "895 W Grant Rd, Tucson, AZ 85705",
  source: "leadminer:place-lyons-roofing",
};

function geniePacket(over = {}) {
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
      latlng: [32.2540, -110.9742],
      hours: { mon: "7-5" },
      booking_url: null,
      services: ["Roof Replacement", "Roof Repair", "Storm Damage"],
      socials: ["https://facebook.com/lyonsroofing"],
      ...(over.facts || {}),
    },
    evidence: [{ field: "name", value: "Lyons Roofing", source_type: "website", confidence: 0.95 }],
    assets: over.assets || [
      { kind: "logo", url: "https://www.lyonsroofing.com/logo.png", approved: true, meta: { logo_evidence: "logo-markup" } },
      { kind: "photo", url: "https://www.lyonsroofing.com/job1.jpg", approved: true },
      { kind: "photo", url: "https://www.lyonsroofing.com/job2.jpg", approved: true },
      { kind: "photo", url: "https://cdn.example.com/unapproved.jpg", approved: false },
    ],
    trust: over.trust || { rating: 4.8, review_count: 412, reviews: [{ author: "Jane D.", text: "Great crew." }] },
    optimization: { seo_gaps: ["local schema"], target_queries: ["roofing tucson"], schema_types: ["LocalBusiness"] },
    ...over.top,
  };
}

test("maps a complete Genie v2 packet to a valid MirrorRequest", () => {
  const r = genieToMirrorRequest(geniePacket(), {
    slug: "wss-test-lyons-roofing-tucson",
    verifiedNap: VERIFIED_NAP,
    genieContent: true,
  });
  assert.equal(r.ok, true);
  const req = r.request;
  assert.equal(req.slug, "wss-test-lyons-roofing-tucson");
  assert.equal(req.facts.business_name, "Lyons Roofing");
  assert.equal(req.facts.industry, "Roofing");
  assert.equal(req.facts.state, "AZ");
  // NAP comes from the caller's verified source, never from the packet.
  assert.equal(req.facts.phone, VERIFIED_NAP.phone);
  assert.equal(req.facts.current_website, VERIFIED_NAP.website);
  assert.deepEqual(r.genie_nap_dropped.sort(), ["address", "phone", "website"]);
  assert.equal(req.facts.latitude, 32.254);
  assert.equal(req.facts.longitude, -110.9742);
  // TRUST NUMERALS come from the caller's verified source too — never from the
  // packet. This assertion used to read `rating === 4.8`, i.e. the Genie's own
  // number was adopted on its own say-so, which is the fabricated-phone failure
  // in a field that renders as stars and as JSON-LD aggregateRating. See
  // test/genie-fabrication.test.js section 2B.
  assert.ok(!("rating" in req.facts), "the packet's rating is not adopted");
  assert.ok(!("review_count" in req.facts), "the packet's review count is not adopted");
  assert.deepEqual(r.genie_trust_dropped.sort(), ["rating", "review_count"]);
  assert.equal(req.brand.logo, "https://www.lyonsroofing.com/logo.png");
  assert.deepEqual(req.brand.photos, ["https://www.lyonsroofing.com/job1.jpg", "https://www.lyonsroofing.com/job2.jpg"]);
  assert.ok(!req.brand.photos.includes("https://cdn.example.com/unapproved.jpg"), "unapproved assets excluded");
  // Rich content surfaced, not dropped — now in the MirrorContent shape and
  // ATTACHED to the request (see test/from-genie-content-schema.test.js).
  assert.deepEqual(r.content.services, [{ name: "Roof Replacement" }, { name: "Roof Repair" }, { name: "Storm Damage" }]);
  assert.equal(r.content.reviews.length, 1);
  assert.deepEqual(req.content, r.content);
  // optimization/evidence/socials/booking_url have no MirrorContent home and
  // live in `extra`; putting them in content is a 400 invalid_request.
  assert.ok(r.extra.optimization.target_queries.length);
  assert.ok(!("optimization" in r.content));
});

test("the mapped request is accepted by the engine's strict validator", () => {
  const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
  const { validateFacts } = require("../lib/mirror-engine/facts");
  const r = genieToMirrorRequest(geniePacket(), {
    slug: "wss-test-lyons-roofing-tucson",
    verifiedNap: VERIFIED_NAP,
    genieContent: true,
  });
  const structural = checkMirrorRequest(r.request);
  assert.equal(structural.ok, true, JSON.stringify(structural.body));
  const semantic = validateFacts(r.request);
  assert.equal(semantic.ok, true, JSON.stringify(semantic.detail));
  assert.equal(semantic.phoneDigits, "5209001442");
});

test("TRUTH LAW: blank trust never becomes a rating; unapproved logo not used", () => {
  const r = genieToMirrorRequest(geniePacket({ trust: { rating: null, review_count: null, reviews: [] }, assets: [
    { kind: "logo", url: "https://x/logo.png", approved: false },
    { kind: "photo", url: "https://x/p.jpg", approved: true },
  ] }), { slug: "wss-test-no-trust", verifiedNap: VERIFIED_NAP });
  assert.equal(r.ok, true);
  assert.ok(!("rating" in r.request.facts), "no rating invented");
  assert.ok(!("review_count" in r.request.facts));
  assert.ok(!r.request.brand.logo, "unapproved logo not adopted");
  assert.deepEqual(r.request.brand.photos, ["https://x/p.jpg"]);
});

test("accent passed only when caller pre-measured it (else engine measures)", () => {
  const withAccent = genieToMirrorRequest(geniePacket(), { slug: "wss-test-a", accent: "#c82f33", verifiedNap: VERIFIED_NAP });
  assert.equal(withAccent.request.brand.accent, "#c82f33");
  assert.equal(withAccent.request.brand.accent_source, "https://www.lyonsroofing.com/logo.png");
  const without = genieToMirrorRequest(geniePacket(), { slug: "wss-test-b", verifiedNap: VERIFIED_NAP });
  assert.ok(!("accent" in without.request.brand), "no accent => engine measures from logo");
});

test("out_of_scope / needs_input packets are rejected with a precise reason", () => {
  assert.equal(genieToMirrorRequest({ ok: false, status: "out_of_scope" }, { slug: "wss-test-x" }).error, "genie_packet_unusable");
});

test("a packet phone is never enough — NAP must be independently verified", () => {
  // Previously a packet that carried a phone produced a request and a packet
  // that did not was the only failure case. Both are now the same failure: the
  // packet's phone is not consulted either way.
  for (const packet of [geniePacket(), geniePacket({ facts: { phone: "" } })]) {
    const r = genieToMirrorRequest(packet, { slug: "wss-test-y" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "nap_unverified");
    assert.equal(r.detail[0].path, "/facts/phone");
    assert.equal(r.detail[0].reason, "genie_nap_quarantined");
  }
});

test("missing/invalid slug is a caller error (engine still owns naming)", () => {
  assert.equal(genieToMirrorRequest(geniePacket(), {}).error, "slug_required");
  assert.equal(genieToMirrorRequest(geniePacket(), { slug: "Bad Slug" }).error, "slug_required");
});

test("Packet 2 observed typography and palette reach brand with their first-party evidence", () => {
  const site = "https://www.lyonsroofing.com/";
  const facebook = "https://www.facebook.com/lyonsroofing";
  const instagram = "https://www.instagram.com/lyonsroofing";
  const packet = geniePacket({
    facts: {
      socials: [facebook, instagram],
      about: "Generated marketing prose must stay behind the content gate.",
    },
    top: {
      brand: {
        palette: [
          { hex: "#123456", role: "primary", source: "public_source_observation" },
          { hex: "#f47a1f", role: "cta accent", source: "public_source_observation" },
          { hex: "#ffffff", role: "background", source: "public_source_observation" },
        ],
        colors: ["#123456", "#F47A1F", "#FFFFFF"],
        fonts: {
          display: "\"Oswald\", sans-serif",
          body: "Inter",
          href: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
        },
      },
      packet2: {
        version: "2.0",
        sources: {
          urls: [facebook, site],
        },
      },
      evidence: [{
        field: "socials",
        value: [facebook, instagram],
        source: site,
        verification_status: "source_observation",
      }],
    },
  });

  const r = genieToMirrorRequest(packet, {
    slug: "wss-test-lyons-packet-two",
    verifiedNap: VERIFIED_NAP,
    genieContent: false,
  });

  assert.equal(r.ok, true);
  assert.deepEqual(r.request.brand.fonts, {
    display: "Oswald",
    body: "Inter",
    href: "https://fonts.googleapis.com/css2?family=Inter&family=Oswald",
    source: site,
    provider: "google",
  });
  assert.equal(r.request.brand.primary, "#123456");
  assert.equal(r.request.brand.site_accent, "#F47A1F");
  assert.equal(r.request.brand.site_accent_source, site);
  assert.ok(!("accent" in r.request.brand), "a scraped site colour is not promoted to a logo-measured accent");
  assert.ok(!("socials" in r.request.facts), "observed social URLs are not promoted to owned-profile business truth");
  assert.equal(r.request.facts.phone, VERIFIED_NAP.phone, "independent NAP remains the only NAP path");
  assert.ok(!("content" in r.request), "generated/descriptive content remains quarantined");

  assert.equal(r.extra.observed_brand.verification_status, "unverified_source_observation");
  assert.equal(r.extra.observed_brand.mapped_to_request, true);
  assert.deepEqual(r.extra.observed_brand.source_urls, [site]);
  assert.equal(r.extra.observed_brand.fonts.source, site);
  assert.equal(r.extra.observed_brand.palette[1].observed_on, site);
  assert.deepEqual(r.extra.social_observations, [
    { url: facebook, source: site, verification_status: "unverified_source_observation" },
    { url: instagram, source: site, verification_status: "unverified_source_observation" },
  ]);

  const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
  const structural = checkMirrorRequest(r.request);
  assert.equal(structural.ok, true, JSON.stringify(structural.body));
});

test("Packet 2 brand observations fail closed without a first-party page and unsafe fonts never become CSS", () => {
  const packet = geniePacket({
    facts: { socials: ["https://facebook.com/acme"] },
    assets: [
      { kind: "logo", url: "https://acme.example/logo.png", approved: false },
      { kind: "photo", url: "https://acme.example/work.jpg", approved: false },
      { kind: "video", url: "https://acme.example/hero.mp4", approved: false },
    ],
    top: {
      brand: {
        palette: [{ hex: "#e63323", role: "accent", source: "public_source_observation" }],
        fonts: { display: "Inter\";color:red;/*", body: "", href: "https://evil.example/font.css" },
      },
      packet2: { version: "2.0", sources: { urls: ["https://facebook.com/acme"] } },
    },
  });

  const r = genieToMirrorRequest(packet, {
    slug: "wss-test-packet-two-untrusted-brand",
    verifiedNap: VERIFIED_NAP,
    genieContent: false,
  });

  assert.equal(r.ok, true);
  assert.equal(r.request.brand, undefined, "unapproved assets and source-less brand observations never enter the request");
  assert.equal(r.extra.observed_brand.mapped_to_request, false);
  assert.deepEqual(r.extra.observed_brand.source_urls, []);
  assert.equal(r.extra.observed_brand.fonts, undefined, "unsafe font family is discarded, not escaped into CSS");
  assert.equal(r.extra.observed_brand.palette[0].observed_on, "");
  assert.ok(!("socials" in r.request.facts));
  assert.equal(r.content, null);
});

test("Packet 2 competitor brand observations cannot style the verified prospect", () => {
  const victim = "https://www.lyonsroofing.com/";
  const competitor = "https://competitor-roofing.example/";
  const packet = geniePacket({
    top: {
      brand: {
        palette: [{
          hex: "#E63323",
          role: "cta accent",
          observed_on: competitor,
          source: "public_source_observation",
        }],
        fonts: {
          display: "Competitor Display",
          body: "Competitor Body",
          source: competitor,
        },
      },
      packet2: { version: "2.0", sources: { urls: [competitor] } },
    },
  });

  const r = genieToMirrorRequest(packet, {
    slug: "wss-test-competitor-brand-refusal",
    verifiedNap: { ...VERIFIED_NAP, website: victim },
    genieContent: false,
  });

  assert.equal(r.ok, true);
  assert.equal(r.request.brand.logo, "https://www.lyonsroofing.com/logo.png");
  assert.equal(r.request.brand.fonts, undefined);
  assert.equal(r.request.brand.primary, undefined);
  assert.equal(r.request.brand.site_accent, undefined);
  assert.equal(r.extra.observed_brand.mapped_to_request, false);
  assert.deepEqual(r.extra.observed_brand.source_urls, []);
  assert.equal(r.extra.observed_brand.palette[0].observed_on, "");
});

test("explicit competitor font and palette URLs cannot borrow a first-party packet source", () => {
  const victim = "https://www.lyonsroofing.com/";
  const competitor = "https://competitor-roofing.example/";
  const packet = geniePacket({
    top: {
      brand: {
        palette: [{
          hex: "#FF3300",
          role: "cta accent",
          observed_on: competitor,
        }],
        fonts: {
          display: "Wrong Company Display",
          body: "Wrong Company Body",
          href: "https://fonts.googleapis.com/css2?family=Inter",
          source: competitor,
        },
      },
      // This valid envelope used to launder the two explicit competitor URLs:
      // the mapper rejected each URL, then silently fell back to this one.
      packet2: { version: "2.0", sources: { urls: [victim] } },
    },
  });

  const r = genieToMirrorRequest(packet, {
    slug: "wss-test-mixed-source-brand-refusal",
    verifiedNap: { ...VERIFIED_NAP, website: victim },
    genieContent: false,
  });

  assert.equal(r.ok, true);
  assert.equal(r.request.brand.logo, "https://www.lyonsroofing.com/logo.png");
  assert.equal(r.request.brand.fonts, undefined);
  assert.equal(r.request.brand.primary, undefined);
  assert.equal(r.request.brand.site_accent, undefined);
  assert.equal(r.extra.observed_brand.mapped_to_request, false);
  assert.deepEqual(r.extra.observed_brand.source_urls, [victim]);
  assert.equal(r.extra.observed_brand.fonts.source, "");
  assert.equal(r.extra.observed_brand.palette[0].observed_on, "");
});

for (const suffix of ["co.uk", "co.kr", "com.ar"]) {
  test(`Packet2 brand evidence on competitor.${suffix} cannot bind to victim.${suffix}`, () => {
    const victim = `https://victim.${suffix}/`;
    const competitor = `https://competitor.${suffix}/`;
    const packet = geniePacket({
      top: {
        brand: {
          palette: [{ hex: "#FF3300", role: "cta accent", observed_on: competitor }],
          fonts: { display: "Competitor Display", body: "Competitor Body", source: competitor },
        },
        packet2: { version: "2.0", sources: { urls: [victim] } },
      },
    });

    const r = genieToMirrorRequest(packet, {
      slug: `wss-test-packet2-${suffix.replace(/\./g, "-")}`,
      verifiedNap: { ...VERIFIED_NAP, website: victim },
      genieContent: false,
    });

    assert.equal(r.ok, true);
    assert.equal(r.request.brand.fonts, undefined);
    assert.equal(r.request.brand.primary, undefined);
    assert.equal(r.request.brand.site_accent, undefined);
    assert.equal(r.extra.observed_brand.mapped_to_request, false);
  });
}
