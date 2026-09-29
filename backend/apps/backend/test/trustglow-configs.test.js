"use strict";

/**
 * test/trustglow-configs.test.js
 *
 * The trust-glow template is the best donor we have because of what it RENDERS
 * — reviewer faces, near-me pages, hours, directions, review-request. Those
 * only appear if the two config files carry the facts. This pins the packet ->
 * config mapping, and pins "deletion is a feature": an absent fact is omitted,
 * never invented.
 */
const test = require("node:test");
const assert = require("node:assert");

const { buildTrustGlowConfigs, paletteFrom, presetFor } = require("../lib/trustglow-configs");

const PACKET = {
  business_name: "RiverCity Plumbing",
  industry: "plumbing",
  city: "Jacksonville",
  state: "FL",
  zip: "32208",
  street: "4609 Trout River Boulevard",
  lat: 30.4173,
  lng: -81.719,
  phone_national: "(904) 760-7837",
  phone_e164: "+19047607837",
  email: "office@rivercityplumbingjax.com",
  website_url: "https://rivercityplumbingjax.com/",
  place_id: "ChIJSxJlZyy75YgRyO2fZgODxL8",
  gbp_url: "https://maps.google.com/?cid=13818313607309422024",
  rating: 5,
  review_count: 93,
  brand_colors: { primary: "#0A1F3C", accent: "#E67E22" },
  logo_url: "https://rivercityplumbingjax.com/logo.svg",
  photos: ["https://rivercityplumbingjax.com/a.jpg", "https://rivercityplumbingjax.com/b.jpg"],
  services: [
    { name: "Drain cleaning", description: "Clears blockages." },
    { name: "Water heaters", description: "Repair and replace." },
  ],
  reviews: [
    { author: "Thomas C", text: "Great work.", rating: 5, published_at: "2026-06-01T00:00:00Z", author_photo_url: "https://lh3.googleusercontent.com/a-/FACE1" },
    { author: "No Face", text: "Solid.", rating: 4, published_at: "2026-05-01T00:00:00Z" },
  ],
  hours: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }],
  social: [{ platform: "facebook", url: "https://facebook.com/rivercity" }],
};

test("reviewer faces survive VERBATIM — the pack's highest-value pixel", () => {
  const { trustConfig, coverage } = buildTrustGlowConfigs(PACKET, { slug: "s" });
  const r = trustConfig.proof.reviews;
  assert.equal(r[0].avatarUrl, "https://lh3.googleusercontent.com/a-/FACE1", "the Google CDN URL was altered");
  assert.equal(coverage.reviewer_faces, 1);
  assert.equal(r[1].avatarUrl, "", "a review without a face must not borrow one");
});

test("a 4-star review ships as 4 stars", () => {
  const { trustConfig } = buildTrustGlowConfigs(PACKET, { slug: "s" });
  assert.equal(trustConfig.proof.reviews[1].rating, 4);
});

test("Places period shape becomes weekly hours", () => {
  const { trustConfig } = buildTrustGlowConfigs(PACKET, { slug: "s" });
  assert.deepEqual(trustConfig.hours.weekly, [{ day: "Monday", open: "08:00", close: "17:00" }]);
});

test("an open period with no close is 24 hours, not 00:00-00:00", () => {
  const { trustConfig } = buildTrustGlowConfigs(
    { ...PACKET, hours: [{ open: { day: 0, hour: 0, minute: 0 } }] }, { slug: "s" },
  );
  assert.deepEqual(trustConfig.hours.weekly, [{ day: "Sunday", open: "00:00", close: "23:59" }]);
});

test("the palette is THEIR hue at the template's lightness", () => {
  const p = paletteFrom({ primary: "#0A1F3C", accent: "#E67E22" });
  assert.match(p.background, /^oklch\(0\.253 0\.045 25[0-9.]+\)$/, `navy hue expected, got ${p.background}`);
  assert.match(p.coral, /^oklch\(0\.702 0\.163 \d/, `accent-derived coral expected, got ${p.coral}`);
});

test("no brand colours -> no palette, never a donor default", () => {
  assert.equal(paletteFrom({}), null);
  const { palette } = buildTrustGlowConfigs({ ...PACKET, brand_colors: {} }, { slug: "s" });
  assert.equal(palette, null);
});

test("absent facts are OMITTED, not nulled or invented", () => {
  const sparse = { business_name: "Bare Co", industry: "plumbing", city: "Tulsa", state: "OK" };
  const { trustConfig, clientConfig } = buildTrustGlowConfigs(sparse, { slug: "s" });
  assert.equal("email" in trustConfig.contact, false);
  assert.equal("phone" in trustConfig.contact, false);
  assert.equal("hours" in trustConfig, false);
  assert.equal("services" in trustConfig, false);
  assert.equal("ratings" in trustConfig.proof, false);
  assert.equal("reviews" in trustConfig.proof, false);
  assert.equal("social" in trustConfig, false);
  assert.equal("logoSrc" in clientConfig.brand, false);
  assert.equal(JSON.stringify(trustConfig).includes("null"), false, "a null leaked into the config");
});

test("reviewer avatars are NOT in the re-host list — Google is their only legal source", () => {
  const { assets } = buildTrustGlowConfigs(PACKET, { slug: "s" });
  assert.equal(Object.values(assets).some((u) => u.includes("googleusercontent")), false);
  assert.ok(Object.keys(assets).includes("public/brand/logo.png"));
  assert.equal(Object.keys(assets).filter((k) => k.startsWith("public/gallery/")).length, 2);
});

test("the vertical preset drives the near-me route shape", () => {
  assert.equal(presetFor("plumbing").slug, "plumber");
  assert.equal(presetFor("roofing").noun, "Roofer");
  const unknown = presetFor("alpaca grooming");
  assert.equal(unknown.schema, "LocalBusiness", "an unknown trade must still build");
  assert.equal(unknown.slug, "alpaca-grooming");
});

test("prices appear only when the packet literally printed one", () => {
  const { trustConfig } = buildTrustGlowConfigs({
    ...PACKET,
    services: [{ name: "Repipe", description: "d", price_from: 4200 }, { name: "Snake", description: "d" }],
  }, { slug: "s" });
  assert.equal(trustConfig.services[0].priceFrom, 4200);
  assert.equal("priceFrom" in trustConfig.services[1], false);
});
