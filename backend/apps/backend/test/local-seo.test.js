"use strict";

// test/local-seo.test.js — STRUCTURED DATA MUST NEVER ASSERT WHAT WE CANNOT BACK.
//
// These lock the rules that make local SEO safe rather than dangerous:
// aggregateRating only with a real rating AND count, the visible NAP matching
// the JSON-LD exactly, a review CTA that vanishes without a real Place ID, and
// a map that costs nothing until clicked.

const test = require("node:test");
const assert = require("node:assert");

const {
  normaliseFacts, localBusinessJsonLd, napBlock, lazyMap, reviewCta, localSeoBlock,
} = require("../lib/mirror-engine/local-seo");

const FULL = {
  business_name: "Sterling Fence & Deck",
  phone: "(817) 555-0142",
  address: "1420 Industrial Blvd",
  city: "Fort Worth",
  state: "TX",
  postal: "76102",
  geo_lat: 32.7555,
  geo_lng: -97.3308,
  site_url: "https://wss-test-sterling.wss-ai.com/",
  logo_url: "https://wss-test-sterling.wss-ai.com/assets/client-logo.svg",
  place_id: "ChIJcSZPRVJ0ToYRcpaC7wxJZ_g",
  rating: 4.8,
  review_count: 96,
  areas: ["Fort Worth", "Arlington", "Keller"],
  hours: ["Mo-Fr 07:00-17:00", "Sa 08:00-12:00"],
  price_range: "$$",
};

const esc = (v) => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const ld = (facts) => JSON.parse(localBusinessJsonLd(facts).replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));

test("full truth data produces a complete LocalBusiness node", () => {
  const n = ld(FULL);
  assert.strictEqual(n["@type"], "LocalBusiness");
  assert.strictEqual(n.name, "Sterling Fence & Deck");
  assert.strictEqual(n.telephone, "(817) 555-0142");
  assert.strictEqual(n.address["@type"], "PostalAddress");
  assert.strictEqual(n.address.streetAddress, "1420 Industrial Blvd");
  assert.strictEqual(n.address.addressLocality, "Fort Worth");
  assert.strictEqual(n.address.addressRegion, "TX");
  assert.strictEqual(n.address.postalCode, "76102");
  assert.strictEqual(n.geo.latitude, 32.7555);
  assert.strictEqual(n.geo.longitude, -97.3308);
  assert.deepStrictEqual(n.areaServed, ["Fort Worth", "Arlington", "Keller"]);
  assert.deepStrictEqual(n.openingHours, ["Mo-Fr 07:00-17:00", "Sa 08:00-12:00"]);
  assert.strictEqual(n.priceRange, "$$");
});

test("aggregateRating requires BOTH a real rating and a real count", () => {
  assert.ok(ld(FULL).aggregateRating, "a verified 4.8 over 96 reviews should render");
  assert.strictEqual(ld(FULL).aggregateRating.reviewCount, 96);

  // Each of these must suppress the whole block — a rating with nothing behind
  // it is the single most-abused field in local SEO.
  for (const bad of [
    { ...FULL, review_count: 0 },
    { ...FULL, review_count: null },
    { ...FULL, rating: null },
    { ...FULL, rating: 0 },
    { ...FULL, rating: 7 },          // out of range = not real data
  ]) {
    assert.strictEqual(ld(bad).aggregateRating, undefined,
      `fabricated/unbacked rating rendered: ${JSON.stringify({ r: bad.rating, c: bad.review_count })}`);
  }
});

test("missing fields are omitted, never placeholdered", () => {
  const n = ld({ business_name: "Bare Co" });
  assert.strictEqual(n.name, "Bare Co");
  for (const k of ["telephone", "address", "geo", "areaServed", "openingHours", "aggregateRating", "priceRange", "image"]) {
    assert.strictEqual(n[k], undefined, `${k} was invented for a prospect with no data`);
  }
  const s = JSON.stringify(n);
  assert.ok(!/n\/a|tbd|call for|placeholder|undefined|null/i.test(s), `placeholder leaked: ${s}`);
});

test("no business name means no markup at all", () => {
  assert.strictEqual(localBusinessJsonLd({ city: "Fort Worth", phone: "(817) 555-0142" }), "");
  assert.strictEqual(napBlock({ city: "Fort Worth" }), "");
  assert.strictEqual(lazyMap({ city: "Fort Worth" }), "");
});

test("visible NAP matches the JSON-LD exactly — no markup/DOM mismatch", () => {
  const n = ld(FULL);
  const html = napBlock(FULL);
  assert.ok(html.includes(esc(n.name)), "name differs between JSON-LD and DOM");
  assert.ok(html.includes(n.telephone), "phone differs between JSON-LD and DOM");
  assert.ok(html.includes(esc(n.address.streetAddress)), "street differs");
  assert.ok(html.includes(n.address.addressLocality), "city differs");
  assert.ok(html.includes(n.address.postalCode), "postal differs");
  assert.ok(html.includes('href="tel:+18175550142"'), "phone is not tappable");
});

test("review CTA renders ONLY with a real Place ID, and is policy-compliant", () => {
  const on = reviewCta(FULL);
  assert.ok(on.includes(`https://search.google.com/local/writereview?placeid=${FULL.place_id}`));
  assert.ok(on.includes("Leave us a Google review"));
  assert.ok(on.includes("4.8★") && on.includes("96 Google reviews"), "real trust signals should show");

  // Compliance: no pre-filled text, no star pre-selection, no incentive, no gating.
  assert.ok(!/review_text|prefill|rating=|stars?=\d|&text=/i.test(on), "review link pre-fills content");
  assert.ok(!/discount|free |gift card|reward|incentiv|in exchange/i.test(on), "incentive language present");
  assert.ok(!/was your experience|only if you|if you were happy/i.test(on), "review gating present");

  // No Place ID -> nothing. Never a guessed or broken link.
  for (const bad of [{ ...FULL, place_id: "" }, { ...FULL, place_id: null }, { business_name: "X" }]) {
    assert.strictEqual(reviewCta(bad), "", "a review CTA rendered without a verified Place ID");
  }
});

test("map is a click-to-load facade — zero third-party bytes on first paint", () => {
  const html = lazyMap(FULL);
  assert.ok(!/<iframe/i.test(html), "an iframe shipped in the initial HTML and will block LCP");
  assert.ok(html.includes('loading="lazy"') || html.includes('f.loading="lazy"'), "injected iframe is not lazy");
  assert.ok(html.includes("maps/search/?api=1&amp;query="), "missing documented Open-in-Maps form");
  assert.ok(html.includes("query_place_id="+FULL.place_id), "verified Place ID should pin the map");
  assert.ok(/<noscript>/.test(html), "no non-JS fallback");

  // Without a Place ID the map must still work, degrading to a name+address search.
  const noId = lazyMap({ ...FULL, place_id: "" });
  assert.ok(noId.includes("maps/search/?api=1&amp;query="));
  assert.ok(!noId.includes("query_place_id="), "fabricated a place id");
});

test("the composed block is vertical-agnostic", () => {
  // Same code path, five different trades: nothing may be roofing-specific.
  for (const industry of ["roofing", "fencing", "concrete", "tree service", "pest control"]) {
    const html = localSeoBlock({ ...FULL, industry });
    assert.ok(html.includes("application/ld+json"), `${industry}: no JSON-LD`);
    assert.ok(html.includes("Sterling Fence & Deck"), `${industry}: no NAP`);
    assert.ok(html.includes("writereview?placeid="), `${industry}: no review CTA`);
    assert.ok(!/roof/i.test(html.replace(/Sterling Fence & Deck/g, "")), `${industry}: roofing-specific copy leaked`);
  }
});

test("HTML is escaped — a business name cannot inject markup", () => {
  const evil = { ...FULL, business_name: 'Ace <script>alert(1)</script> Fence & "Co"' };
  const html = napBlock(evil);
  assert.ok(!html.includes("<script>alert(1)</script>"), "unescaped script tag in NAP");
  assert.ok(html.includes("&lt;script&gt;"), "name was not escaped");
  // JSON.stringify handles the JSON-LD side; confirm it stays parseable.
  assert.strictEqual(ld(evil).name, 'Ace <script>alert(1)</script> Fence & "Co"');
});

test("normaliseFacts accepts the upstream spellings the pipeline actually emits", () => {
  const a = normaliseFacts({ business_name: "A", geo_lat: 1, geo_lng: 2, review_count: 5, rating: 4 });
  const b = normaliseFacts({ businessName: "A", lat: 1, lng: 2, reviewCount: 5, google_rating: 4 });
  assert.deepStrictEqual([a.name, a.lat, a.lng, a.reviewCount, a.rating], ["A", 1, 2, 5, 4]);
  assert.deepStrictEqual([b.name, b.lat, b.lng, b.reviewCount, b.rating], ["A", 1, 2, 5, 4]);
});

test("a full formattedAddress is not duplicated with city/state in the NAP", () => {
  // Real prospect shape: Google's formattedAddress already carries locality,
  // region, postal and country, and city/state arrive separately too.
  const html = napBlock({
    business_name: "Fort Tex Metals & Roofing",
    address: "4200 S Hulen St #654, Fort Worth, TX 76109, USA",
    city: "Fort Worth", state: "TX", phone: "(682) 313-4066",
  });
  const line = (html.match(/nap-address[^>]*>([^<]+)</) || [])[1] || "";
  assert.strictEqual((line.match(/Fort Worth/g) || []).length, 1, `locality repeated: ${line}`);
  assert.ok(!/USA|United States/.test(line), `country left on the NAP: ${line}`);

  // The split-field case must still compose normally.
  const split = napBlock({
    business_name: "Split Co", address: "12 Mill Rd", city: "Keller", state: "TX", postal: "76248",
  });
  const sline = (split.match(/nap-address[^>]*>([^<]+)</) || [])[1] || "";
  assert.ok(sline.includes("12 Mill Rd") && sline.includes("Keller") && sline.includes("76248"), sline);
});
