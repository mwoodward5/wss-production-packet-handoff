"use strict";

// WORKSTREAM B — extraction/serialization defects confirmed on live sandbox
// builds, 2026-08-20, each locked here:
//
//   1. SERVICE-CARD JUNK: footer-nav headings ("Socials", "Our Address",
//      "Union Office", "Member Resources", "Nothing Found", "Company",
//      "Business Hours", "Stay Connected"), coupon fragments ("$99 (New
//      Customers Only)", "15%OFF", "1/2 Priced With A/C Purchase") and RAW
//      URLS shipped as services on 4/5 sites — into the quote-form dropdown,
//      footers and generated routes.
//   2. FEATURED REVIEW TRUTH: carousels promoted 1-2 star complaints.
//   3. HOURS: "[object Object]" rendered literally in contact block + footer.
//   4. STAT COUNTERS: "0.0 ★ / 0 GOOGLE REVIEWS" beside a hero saying 4.8/144.
//   5. BOILERPLATE LEAK: forge placeholder prose shipped as the About section.
const test = require("node:test");
const assert = require("node:assert/strict");
const { articleHeadlineReason } = require("../lib/mirror-engine/service-names");
const contentInject = require("../lib/mirror-engine/content-inject");
const { stripForgePlaceholders } = require("../lib/mirror-engine/engine");
const { tokenScan } = require("../lib/mirror-engine/scan");

// ---------------------------------------------------------------------------
// 1. service plausibility
// ---------------------------------------------------------------------------

test("every junk label measured on the live sandbox fleet is refused, with a named reason", () => {
  const refused = {
    "Socials": "navigation_label",
    "Our Address": "navigation_label",
    "Union Office": "navigation_label",
    "Member Resources": "navigation_label",
    "Nothing Found": "navigation_label",
    "Company": "navigation_label",
    "Business Hours": "navigation_label",
    "Stay Connected": "navigation_label",
    "$99 (New Customers Only)": "price_fragment",
    "15%OFF": "coupon_fragment",
    "1/2 Priced With A/C Purchase": "coupon_fragment",
    "https://abetterfencecompany.com/lewisville-fence-companies/": "bare_url",
    "www.example.com/services": "bare_url",
  };
  for (const [label, reason] of Object.entries(refused)) {
    assert.equal(articleHeadlineReason(label), reason, `"${label}" must be refused as ${reason}`);
  }
});

test("process-step cards and real services survive the new rules untouched", () => {
  // The WCAG audit flagged the concrete sites' process steps as a mismatch;
  // that was a FALSE POSITIVE and the filter must never eat them. Nor any real
  // service that merely contains a nav word or opens with a number.
  const kept = [
    "Site Visit", "Written Quote", "Permits & Prep", "Pour & Finish", "Walkthrough",
    "Office Cleaning", "Water Heater Repair", "24/7 Emergency Service",
    "1 Day Bath Remodel", "Fence Staining", "Hydro Jetting",
    "Stamped Concrete", "Address Numbering", "Social Media Marketing Consultation",
  ];
  for (const label of kept) {
    assert.equal(articleHeadlineReason(label), "", `"${label}" is a real service and must survive`);
  }
});

test("the publish door drops duplicates — first occurrence wins", () => {
  const content = contentInject.withUsableServices({
    services: [
      { name: "Fence Installation", description: "from the resolver" },
      { name: "Gate Repair" },
      { name: "fence installation", description: "same thing, second door" },
      "Fence Installation",
    ],
  }, "A Better Fence Co");
  assert.deepStrictEqual(
    content.services.map((s) => (typeof s === "string" ? s : s.name)),
    ["Fence Installation", "Gate Repair"],
  );
});

// ---------------------------------------------------------------------------
// 2. review display order
// ---------------------------------------------------------------------------

test("featured reviews keep praise and omit complaints without changing their order", () => {
  const supplied = [
    { text: "Never showed up.", author: "A", rating: 1, publishedAt: "2026-05-01" },
    { text: "Sloppy work.", author: "B", rating: 2, publishedAt: "2026-07-01" },
    { text: "Fantastic crew.", author: "C", rating: 5, publishedAt: "2025-01-01" },
    { text: "Solid job.", author: "D", rating: 4, publishedAt: "2026-01-01" },
  ];
  const out = contentInject.orderReviewsForDisplay({ reviews: supplied }).reviews;
  assert.equal(out.length, 2);
  // The aggregate score remains on facts; this array is page furniture. Its
  // supplied praise order (including faces-first upstream ranking) survives.
  assert.deepStrictEqual(out.map((r) => r.author), ["C", "D"]);
});

test("an unrated review is not treated as a complaint", () => {
  const out = contentInject.orderReviewsForDisplay({
    reviews: [
      { text: "words", author: "unrated" },
      { text: "bad", author: "one-star", rating: 1 },
    ],
  }).reviews;
  assert.equal(out[0].author, "unrated");
});

test("all-complaint corpora render no featured quote, including a singleton", () => {
  const praise = [
    { text: "a", rating: 5 }, { text: "b", rating: 4 },
  ];
  assert.deepStrictEqual(contentInject.orderReviewsForDisplay({ reviews: praise }).reviews, praise);
  const complaints = { reviews: [{ text: "a", rating: 1 }, { text: "b", rating: 2 }] };
  assert.deepStrictEqual(contentInject.orderReviewsForDisplay(complaints).reviews, []);
  assert.deepStrictEqual(contentInject.orderReviewsForDisplay({ reviews: [{ text: "singleton", rating: 1 }] }).reviews, []);
});

test("the rendered carousel and schema graph contain praise but no complaint", () => {
  const args = {
    content: {
      reviews: [
        { text: "One star. Avoid.", author: "Angry", rating: 1, publishedAt: "2026-06-01" },
        { text: "Best fence in town.", author: "Happy", rating: 5, publishedAt: "2026-05-01" },
      ],
    },
    facts: { business_name: "A Better Fence Co", city: "Lewisville", state: "TX", industry: "Fencing" },
    phoneDigits: "9725550188",
  };
  const html = contentInject.buildContentHtml(args);
  const firstQuote = /<blockquote[^>]*>[\s\S]*?<p>([^<]+)<\/p>/.exec(html.slice(html.indexOf("wss-rv__track")));
  assert.ok(firstQuote, "the carousel renders");
  assert.equal(firstQuote[1], "Best fence in town.");
  assert.doesNotMatch(html, /One star\. Avoid\./);
  const ld = contentInject.buildJsonLd({ ...args, siteUrl: "https://x.wss-ai.com/" });
  const reviewNodes = (ld["@graph"] || []).filter((n) => n["@type"] === "Review");
  if (reviewNodes.length) {
    assert.match(reviewNodes[0].reviewBody || "", /Best fence in town/);
  }
  assert.doesNotMatch(JSON.stringify(ld), /One star\. Avoid\./);
});

test("an all-poor singleton reaches no HTML, JSON-LD, or content-island quote while aggregate stays exact", () => {
  const content = { reviews: [{ text: "One star. Avoid.", author: "Angry", rating: 1 }] };
  const facts = {
    business_name: "A Better Fence Co", city: "Lewisville", state: "TX", industry: "Fencing",
    rating: 4.8, review_count: 144,
  };

  const block = contentInject.buildContentHtml({ content, facts, phoneDigits: "9725550188" });
  assert.doesNotMatch(block, /One star\. Avoid\./);
  assert.doesNotMatch(block, /id="reviews"/);

  const ld = contentInject.buildJsonLd({ content, facts, phoneDigits: "9725550188", siteUrl: "https://x.wss-ai.com/" });
  assert.doesNotMatch(JSON.stringify(ld), /One star\. Avoid\./);
  assert.equal((ld["@graph"] || []).filter((n) => n["@type"] === "Review").length, 0);
  const business = (ld["@graph"] || []).find((n) => Array.isArray(n["@type"]) && n["@type"].includes("LocalBusiness"));
  assert.deepStrictEqual(business.aggregateRating, {
    "@type": "AggregateRating", ratingValue: 4.8, reviewCount: 144, bestRating: 5,
  });

  const injected = contentInject.inject({
    files: { "index.html": Buffer.from('<html><head></head><body><div id="root"></div></body></html>') },
    content,
    facts,
    phoneDigits: "9725550188",
    slug: "wss-test-poor-review",
    logoUrl: "/assets/brand-logo.svg",
    manifest: { consumes_content: true, renders: ["reviews"] },
  });
  const html = injected.files["index.html"].toString("utf8");
  const island = /<script id="wss-content" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(island, "the content island renders");
  assert.deepStrictEqual(JSON.parse(island[1]).reviews, []);
  assert.doesNotMatch(html, /One star\. Avoid\./);
});

// ---------------------------------------------------------------------------
// 3. hours serialization
// ---------------------------------------------------------------------------

test('hours built from object open/close can never render "[object Object]"', () => {
  // The Better Fence shape: period OBJECTS inside a mixed array, so the
  // whole-array period branch does not fire and the per-item join used to
  // stringify them.
  const rows = contentInject.normalizeHours([
    { day: "monday", open: { hour: 8, minute: 30 }, close: { hour: 17 } },
    "Tuesday: 8:30 AM - 5:00 PM",
  ]);
  assert.ok(rows.length >= 2, "both rows survive, formatted");
  for (const row of rows) {
    assert.ok(!`${row.day} ${row.text}`.includes("[object "), `no stringified object: ${JSON.stringify(row)}`);
  }
  assert.equal(rows.find((r) => r.day === "monday").text, "8:30 AM - 5:00 PM");
});

test("the object-map hours shape gets the same guard", () => {
  const rows = contentInject.normalizeHours({
    monday: { open: { hour: 7 }, close: { hour: 19, minute: 30 } },
    tuesday: "7 AM - 7 PM",
  });
  for (const row of rows) {
    assert.ok(!row.text.includes("[object "), JSON.stringify(row));
  }
  assert.equal(rows.find((r) => r.day === "monday").text, "7:00 AM - 7:30 PM");
});

test('no rendered surface ever contains "[object Object]"', () => {
  const html = contentInject.buildContentHtml({
    content: {
      hours: [{ day: "monday", open: { hour: 8 }, close: { hour: 17 } }],
      services: [{ name: "Fence Installation" }],
    },
    facts: { business_name: "A Better Fence Co", city: "Lewisville", state: "TX", industry: "Fencing" },
    phoneDigits: "9725550188",
  });
  assert.ok(!html.includes("[object Object]"), "rendered output must never stringify an object");
});

// ---------------------------------------------------------------------------
// 4. stat counters — a zero is an absence wearing a number
// ---------------------------------------------------------------------------

test("the data island omits zero-valued rating stats instead of contradicting the hero", () => {
  const build = (facts) => {
    const injected = contentInject.inject({
      files: { "index.html": Buffer.from("<html><head></head><body><div id=\"root\"></div></body></html>") },
      content: { services: [{ name: "Fence Installation" }] },
      facts,
      phoneDigits: "9725550188",
      slug: "wss-test-stat-island",
      logoUrl: "/assets/brand-logo.svg",
      manifest: {},
    });
    const html = injected.files["index.html"].toString("utf8");
    const m = /<script id="wss-content" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    assert.ok(m, "the island is present");
    return JSON.parse(m[1]).facts;
  };
  // The measured defect: rating 0 / count 0 rendered "0.0 ★ / 0 GOOGLE
  // REVIEWS" in the donor stat strip while the hero said 4.8/144.
  const zeroed = build({ business_name: "A Better Fence Co", city: "Lewisville", state: "TX", rating: 0, review_count: 0 });
  assert.equal(zeroed.rating, null);
  assert.equal(zeroed.review_count, null);
  // A real rating still travels — same field, same source the hero reads.
  const real = build({ business_name: "A Better Fence Co", city: "Lewisville", state: "TX", rating: 4.8, review_count: 144 });
  assert.equal(real.rating, 4.8);
  assert.equal(real.review_count, 144);
});

// ---------------------------------------------------------------------------
// 5. forge placeholder prose — replace-or-drop, and BLOCK on residue
// ---------------------------------------------------------------------------

test("stripForgePlaceholders blanks the literal and keeps the bundle syntactically valid", () => {
  const files = {
    "assets/index.js": Buffer.from(
      'const about={heading:"A calm approach",body:"This placeholder copy describes the practice — the forge engine replaces it with the client\'s real narrative."};window.__about=about;',
      "utf8",
    ),
    // Tailwind's placeholder utilities are CODE, not copy — untouched.
    "assets/styles.css": Buffer.from(".placeholder-color{color:red}", "utf8"),
  };
  const out = stripForgePlaceholders(files);
  assert.equal(out.blanked, 1);
  const js = files["assets/index.js"].toString("utf8");
  assert.ok(!/placeholder copy|forge engine/i.test(js));
  assert.match(js, /body:""/);
  // The blanked bundle still parses — a "" literal cannot change JS syntax.
  assert.doesNotThrow(() => new Function(js));
  assert.equal(files["assets/styles.css"].toString("utf8"), ".placeholder-color{color:red}");
});

test("the token scan BLOCKS a build whose output still carries placeholder prose", () => {
  const dirty = tokenScan({
    "index.html": Buffer.from("<p>Our licensed clinicians… this placeholder copy describes the practice.</p>", "utf8"),
  });
  assert.equal(dirty.clean, false);
  assert.equal(dirty.hits[0].kind, "forge_placeholder_prose");

  const clean = tokenScan({
    "index.html": Buffer.from('<input placeholder="Your name"><p class="placeholder-color">Real about copy.</p>', "utf8"),
  });
  assert.equal(clean.clean, true, "placeholder ATTRIBUTES and utilities are not prose residue");
});
