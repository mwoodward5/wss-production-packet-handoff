"use strict";

// test/taxonomy-fidelity.test.js
//
// THE OWNER'S VIDEO REPORT (2026-09-02), pinned:
//
//   "Preserve donor-specific services and naming. Avoid collapsing concrete
//    specialties into generic 'services' cards if the donor has a meaningful
//    taxonomy."
//   "Donor pages surface customer reviews and project evidence prominently.
//    WSS should not demote genuine proof below generic marketing copy."
//
// Four fixtures, four laws:
//
//   1. HURRICANE FENCE (the committed capture of hurricanefenceinc.com) — the
//      donor's ACTUAL services extract under their OWN names, with their own
//      categories, their own descriptions, and their own declared proof
//      (4.8 stars / 605 reviews / a licence credential).
//   2. MULTI-SERVICE — a donor listing nine concrete specialties renders NINE
//      cards with THOSE names and the donor's own copy, not a generic fixed
//      grid with closest-match labels.
//   3. PROOF-VISIBLE — a donor with a 4.8★/43-review badge in its header gets
//      the same badge in the generated trust rail (donor-declared score fills
//      the absent GBP fact; a verified fact still wins), and the reviews
//      section rides ABOVE the generic marketing copy.
//   4. DENSITY — the generated page keeps the donor's content density: a rich
//      taxonomy never collapses to a sparse one-pager, and the build report
//      names the verdict when a build still goes thin.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  extractServiceTaxonomy,
  extractProofSignals,
  enrichServicesFromTaxonomy,
  taxonomyServiceCards,
  contentDensityVerdict,
} = require("../lib/mirror-engine/taxonomy");
const { inject, buildContentHtml } = require("../lib/mirror-engine/content-inject");

// The JSON-LD node list, flattened the way verified-facts flattens it.
function ldNodesOf(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed["@graph"]) nodes.push(...parsed["@graph"]);
      else nodes.push(parsed);
    } catch { /* a malformed block is not the taxonomy's problem */ }
  }
  return nodes;
}

// ===========================================================================
// 1. HURRICANE FENCE — the real capture, the real taxonomy
// ===========================================================================

const HURRICANE_HTML = fs.readFileSync(path.join(__dirname, "fixtures", "hurricane-fence.html"), "utf8");
const HURRICANE_ORIGIN = "https://www.hurricanefenceinc.com/";

function hurricaneTaxonomy() {
  return extractServiceTaxonomy({
    html: HURRICANE_HTML,
    ldNodes: ldNodesOf(HURRICANE_HTML),
    origin: HURRICANE_ORIGIN,
    businessName: "Hurricane Fence",
    city: "Richmond",
    state: "VA",
  });
}

test("hurricane: the schema OfferCatalog services extract under the donor's own names, in their own category", () => {
  const taxonomy = hurricaneTaxonomy();
  const names = taxonomy.services.map((s) => s.name);
  assert.ok(names.includes("Vinyl Fence"), `schema leaf missing: ${JSON.stringify(names.slice(0, 8))}`);
  assert.ok(names.includes("Wood Fence"));
  const vinyl = taxonomy.services.find((s) => s.name === "Vinyl Fence");
  assert.equal(vinyl.source, "schema_offer");
  assert.equal(vinyl.category, "Residential Fencing", "the nested OfferCatalog IS the donor's category");
  const residential = taxonomy.categories.find((c) => c.name === "Residential Fencing");
  assert.ok(residential, "Residential Fencing is reported as a category group");
  assert.ok(residential.services.includes("Wood Fence"));
});

test("hurricane: the donor's concrete specialties survive verbatim — nothing is genericized", () => {
  const taxonomy = hurricaneTaxonomy();
  const names = taxonomy.services.map((s) => s.name);
  // EXACT donor labels, measured off the capture — the words that make the
  // services SPECIFIC ("Commercial", "Bollards", "Sports Facility…Netting"),
  // not "Fencing Services" six times.
  for (const expected of [
    "Commercial Bollards",
    "Sports Facility Fencing & Netting",
    "Temporary Fencing Solutions",
    "Picket Fence",
    "Chain Link Fence",
    "Composite Fence",
  ]) {
    assert.ok(names.includes(expected), `${expected} must extract under the donor's own name`);
  }
  // And the count is the donor's OWN list size — dozens of specialties, not a
  // template's six.
  assert.ok(taxonomy.count >= 20, `the donor lists 20+ services; counted ${taxonomy.count}`);
});

test("hurricane: nav furniture never becomes a service card", () => {
  const names = hurricaneTaxonomy().services.map((s) => s.name);
  for (const furniture of ["Make a Payment", "Referral Program", "Credentials", "Northern Virginia / DC / MD"]) {
    assert.ok(!names.includes(furniture), `${furniture} is site furniture, not a service`);
  }
});

test("hurricane: the services region's headings carry the donor's own descriptions", () => {
  const taxonomy = hurricaneTaxonomy();
  const bollards = taxonomy.services.find((s) => s.name === "Bollards");
  assert.ok(bollards, "the Bollards heading extract is present");
  assert.match(bollards.description, /fixed, removable, and retractable bollards/i);
  // The words that make the specialty concrete ride through, unsummarized away.
  const highSecurity = taxonomy.services.find((s) => s.name === "High Security Fence Solutions");
  assert.match(highSecurity.description, /K-rated/i);
});

test("hurricane: the donor's own declared proof extracts — 4.8 stars, 605 reviews, the licence credential", () => {
  const taxonomy = hurricaneTaxonomy();
  assert.equal(taxonomy.proof.rating, 4.8, "the aggregateRating the donor declared in its own JSON-LD");
  assert.equal(taxonomy.proof.review_count, 605);
  assert.ok(
    taxonomy.proof.certifications.some((c) => /virginia contractor license/i.test(c)),
    `the hasCredential string rides verbatim: ${JSON.stringify(taxonomy.proof.certifications)}`,
  );
});

test("hurricane: enrichment fills a name-only card with the copy the donor wrote for that same service", () => {
  const taxonomy = hurricaneTaxonomy();
  const enriched = enrichServicesFromTaxonomy([{ name: "Commercial Bollards" }], taxonomy);
  assert.match(enriched[0].description, /bollards that protect storefronts/i);
  // Supplied copy is never overwritten — fill-only.
  const kept = enrichServicesFromTaxonomy([{ name: "Bollards", description: "Our own words." }], taxonomy);
  assert.equal(kept[0].description, "Our own words.");
});

// ===========================================================================
// 2. MULTI-SERVICE — nine concrete specialties, nine cards, their names
// ===========================================================================

// A concrete contractor's shape: a declared OfferCatalog with descriptions
// that carry the technique words ("stamped", "sealed", "polished") the owner
// named, plus a nav directory, plus a services section with copy.
const CONCRETE_SERVICES = [
  { name: "Stamped Concrete", description: "Decorative stamped concrete poured and pressed with slate and cobblestone patterns, sealed on completion." },
  { name: "Driveway Repair", description: "Cracked, sunken and spalled driveways cut out, re-based and finished to grade." },
  { name: "Polished Concrete Floors", description: "Interior slabs ground and polished to a 3000-grit sheen with a densifier seal." },
  { name: "Sealed Patios", description: "Existing patios pressure-washed, re-pointed and sealed against freeze-thaw." },
  { name: "Exposed Aggregate", description: "Aggregate-finish walks and aprons with the cream washed off and the stone exposed." },
  { name: "Retaining Walls", description: "Poured and block retaining walls engineered for the slope, drained behind." },
  { name: "Concrete Slabs", description: "Shed, garage and addition slabs formed, meshed and poured to spec." },
  { name: "Pool Decks", description: "Pool decks poured non-salt-finished, sloped to drains and sealed barefoot-safe." },
  { name: "Colored Concrete", description: "Integrally colored and release-stamped concrete matched to your sample." },
];

const CONCRETE_HTML = `<!doctype html><html><head><title>Vega Concrete — stamped, sealed, polished</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HomeAndConstructionBusiness",
  name: "Vega Concrete Co",
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Concrete Services",
    itemListElement: CONCRETE_SERVICES.map((s, i) => ({
      "@type": "Offer",
      position: i + 1,
      itemOffered: { "@type": "Service", name: s.name, description: s.description },
    })),
  },
})}</script>
</head><body>
<header><nav>
<a href="/residential/">Residential Concrete</a>
<a href="/residential/stamped-concrete/">Stamped Concrete</a>
<a href="/residential/patios/">Sealed Patios</a>
<a href="/commercial/">Commercial Concrete</a>
<a href="/commercial/slabs/">Concrete Slabs</a>
</nav></header>
<main>
<section id="services">
<h2>Our Services</h2>
<h3>Stamped Concrete</h3><p>Decorative stamped concrete poured and pressed with slate and cobblestone patterns, sealed on completion.</p>
<h3>Driveway Repair</h3><p>Cracked, sunken and spalled driveways cut out, re-based and finished to grade.</p>
<h3>Polished Concrete Floors</h3><p>Interior slabs ground and polished to a 3000-grit sheen with a densifier seal.</p>
<h3>Sealed Patios</h3><p>Existing patios pressure-washed, re-pointed and sealed against freeze-thaw.</p>
<h3>Exposed Aggregate</h3><p>Aggregate-finish walks and aprons with the cream washed off and the stone exposed.</p>
<h3>Retaining Walls</h3><p>Poured and block retaining walls engineered for the slope, drained behind.</p>
<h3>Concrete Slabs</h3><p>Shed, garage and addition slabs formed, meshed and poured to spec.</p>
<h3>Pool Decks</h3><p>Pool decks poured non-salt-finished, sloped to drains and sealed barefoot-safe.</p>
<h3>Colored Concrete</h3><p>Integrally colored and release-stamped concrete matched to your sample.</p>
</section>
</main></body></html>`;

const CONCRETE_TAXONOMY = extractServiceTaxonomy({
  html: CONCRETE_HTML,
  ldNodes: ldNodesOf(CONCRETE_HTML),
  origin: "https://vegaconcrete.example.com/",
  businessName: "Vega Concrete Co",
});

test("multi-service: nine declared services extract — nine, with their exact names", () => {
  assert.equal(CONCRETE_TAXONOMY.count, 9, `counted ${CONCRETE_TAXONOMY.count}`);
  const names = CONCRETE_TAXONOMY.services.map((s) => s.name).sort();
  assert.deepEqual(names, CONCRETE_SERVICES.map((s) => s.name).sort(), "the donor's exact names, nothing invented");
  assert.equal(CONCRETE_TAXONOMY.bySource.schema_offer, 9, "the whole OfferCatalog extract is credited");
});

test("multi-service: taxonomy names are never genericized", () => {
  const names = CONCRETE_TAXONOMY.services.map((s) => s.name);
  assert.ok(!names.includes("Concrete Services"), "the OfferCatalog's container name is not a card");
  assert.ok(!names.includes("Concrete"));
  // "Stamped Concrete", not "Concrete Services"; "Driveway Repair", not
  // "Driveway Services" — the owner's exact example.
  assert.ok(names.includes("Stamped Concrete"));
  assert.ok(names.includes("Driveway Repair"));
});

test("multi-service: the render emits one card per donor service, with the donor's own copy", () => {
  // The harvest supplied the NAMES ONLY (verified-facts emits { name }), the
  // taxonomy carries the descriptions — the cards must come out dressed.
  const html = buildContentHtml({
    content: {
      services: CONCRETE_SERVICES.map((s) => ({ name: s.name })),
      taxonomy: CONCRETE_TAXONOMY,
    },
    facts: { business_name: "Vega Concrete Co", city: "Vega", state: "TX", service_area: "Vega" },
    phoneDigits: "",
  });
  const cards = [...html.matchAll(/<article class="wss-c__card"><h3><span class="wss-c__num"[^>]*>(\d+)<\/span>([^<]+)<\/h3>(?:<p>([\s\S]*?)<\/p>)?/g)];
  assert.equal(cards.length, 9, `nine donor services must render nine cards; got ${cards.length}`);
  // Sequential numbering across the full set — no template cycling, no resets.
  assert.deepEqual(cards.map((c) => c[1]), Array.from({ length: 9 }, (_, i) => String(i + 1).padStart(2, "0")));
  // The numbers are decorative ghost numerals (aria-hidden), never bare inline crumbs.
  assert.match(html, /\.wss-c__num\{position:absolute[^}]*font-size:clamp\(2\.2rem/, "card numbers must carry the large decorative ghost-numeral treatment");
  const cardNames = cards.map((c) => c[2]);
  assert.deepEqual([...cardNames].sort(), CONCRETE_SERVICES.map((s) => s.name).sort());
  // The donor's technique words ride through on the cards that carry them.
  assert.match(cards[cardNames.indexOf("Stamped Concrete")][3], /stamped/i);
  assert.match(cards[cardNames.indexOf("Stamped Concrete")][3], /sealed/i);
  assert.match(cards[cardNames.indexOf("Polished Concrete Floors")][3], /3000-grit/i);
  assert.ok(html.includes('data-wss-donor-services="9"'), "the donor count is auditable on the section itself");
});

test("multi-service: an eight-service donor renders EIGHT cards — never a fixed six-card template grid", () => {
  const eight = CONCRETE_SERVICES.slice(0, 8);
  const taxonomy = extractServiceTaxonomy({
    html: CONCRETE_HTML.replace(/<h3>Colored Concrete<\/h3><p>[^<]*<\/p>/, ""),
    ldNodes: [{
      "@type": "HomeAndConstructionBusiness",
      name: "Vega Concrete Co",
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Concrete Services",
        itemListElement: eight.map((s, i) => ({
          "@type": "Offer",
          position: i + 1,
          itemOffered: { "@type": "Service", name: s.name, description: s.description },
        })),
      },
    }],
    origin: "https://vegaconcrete.example.com/",
    businessName: "Vega Concrete Co",
  });
  const html = buildContentHtml({
    content: { services: eight.map((s) => ({ name: s.name })), taxonomy },
    facts: { business_name: "Vega Concrete Co", city: "Vega", state: "TX" },
    phoneDigits: "",
  });
  const cards = (html.match(/<article class="wss-c__card">/g) || []).length;
  assert.equal(cards, 8, `eight donor services render eight cards; got ${cards}`);
});

// ===========================================================================
// 3. PROOF-VISIBLE — the donor's badge renders, and proof rides high
// ===========================================================================

// A donor whose HEADER carries the 4.8★/43-review badge, whose JSON-LD
// declares it, and whose page carries real review words.
const PROOF_HTML = `<!doctype html><html><head><title>Harbor Roofing</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "RoofingContractor",
  name: "Harbor Roofing",
  telephone: "+15550142",
  aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", reviewCount: "43" },
  hasCredential: "GAF Master Elite Certified",
})}</script>
</head><body>
<header>
<a href="/"><img src="/logo.png" alt="Harbor Roofing"></a>
<div class="header-rating"><span class="stars" aria-label="4.8 out of 5">★★★★★</span> 4.8 &middot; 43 Google reviews</div>
<nav><a href="/roof-replacement/">Roof Replacement</a><a href="/storm-repair/">Storm Repair</a></nav>
</header>
<main><h1>Roofs that hold the harbor wind</h1>
<img class="project-gallery" src="/projects/ashley-st-after.jpg" alt="Ashley St full replacement, after">
<img class="project-gallery" src="/projects/elm-ridge-after.jpg" alt="Elm Ridge ridge repair, after">
</main></body></html>`;

const PROOF_LD = ldNodesOf(PROOF_HTML);

test("proof: the donor's header badge and declared rating extract", () => {
  const proof = extractProofSignals({ html: PROOF_HTML, ldNodes: PROOF_LD });
  assert.equal(proof.rating, 4.8);
  assert.equal(proof.review_count, 43);
  assert.equal(proof.header_badge, true, "the star badge inside the donor's <header> is seen");
  assert.deepEqual(proof.certifications, ["GAF Master Elite Certified"]);
  assert.equal(proof.project_photos, 2, "the donor's project/after photos are counted");
});

test("proof: a donor with no header badge reports header_badge false, not a guess", () => {
  const badgeless = PROOF_HTML.replace(/<div class="header-rating">[\s\S]*?<\/div>/, "");
  const proof = extractProofSignals({ html: badgeless, ldNodes: PROOF_LD });
  assert.equal(proof.header_badge, false);
  // The declared rating still extracts — the badge's absence is not the score's.
  assert.equal(proof.rating, 4.8);
});

test("proof: the generated page shows the donor's 4.8/43 badge when the GBP fact did not resolve", () => {
  const taxonomy = extractServiceTaxonomy({
    html: PROOF_HTML,
    ldNodes: PROOF_LD,
    origin: "https://harborroofing.example.com/",
    businessName: "Harbor Roofing",
  });
  assert.equal(taxonomy.proof.rating, 4.8);
  assert.equal(taxonomy.proof.review_count, 43);
  const html = buildContentHtml({
    content: {
      services: [{ name: "Roof Replacement" }, { name: "Storm Repair" }],
      taxonomy,
      reviews: [{ author: "Dana W.", text: "Patched the ridge same day and matched the shingles.", rating: 5 }],
    },
    facts: { business_name: "Harbor Roofing", city: "Rockport", state: "ME" }, // NO rating/review_count
    phoneDigits: "+15550142",
  });
  // The owner's exact instruction: "If the donor shows a 4.8★/43-review badge
  // in their header, the generated site should too."
  assert.match(html, /wss-t__num">4\.8</);
  assert.match(html, /43 Google reviews/);
});

test("proof: a VERIFIED rating still wins over the donor's declared one", () => {
  const taxonomy = extractServiceTaxonomy({
    html: PROOF_HTML,
    ldNodes: PROOF_LD,
    origin: "https://harborroofing.example.com/",
    businessName: "Harbor Roofing",
  });
  const html = buildContentHtml({
    content: { services: [{ name: "Roof Replacement" }], taxonomy },
    facts: { business_name: "Harbor Roofing", city: "Rockport", state: "ME", rating: 4.5, review_count: 31 },
    phoneDigits: "",
  });
  assert.match(html, /wss-t__num">4\.5</);
  assert.ok(!/wss-t__num">4\.8</.test(html), "the donor-declared fallback must not override the verified fact");
});

test("proof: reviews ride ABOVE the generic marketing copy, not buried below it", () => {
  const html = buildContentHtml({
    content: {
      services: [{ name: "Roof Replacement" }],
      about: "Family roofing since the eighties.",
      areas: ["Rockport"],
      reviews: [
        { author: "Dana W.", text: "Patched the ridge same day.", rating: 5 },
        { author: "Luis R.", text: "Clean crew, honest quote.", rating: 5 },
      ],
    },
    facts: { business_name: "Harbor Roofing", city: "Rockport", state: "ME" },
    phoneDigits: "",
  });
  const reviewsAt = html.indexOf('id="reviews"');
  const aboutAt = html.indexOf('id="about-detail"');
  const coverageAt = html.indexOf('id="coverage"');
  assert.ok(reviewsAt > -1, "the reviews section renders");
  assert.ok(aboutAt > -1, "the about section renders");
  assert.ok(coverageAt > -1, "the coverage section renders");
  assert.ok(reviewsAt < aboutAt, "customer reviews must precede the generic about copy");
  assert.ok(reviewsAt < coverageAt, "customer reviews must precede the coverage/map copy");
  // And the reviews ride after the services grid — proof follows what they do,
  // ahead of what we say about ourselves.
  assert.ok(reviewsAt > html.indexOf('id="services-detail"'));
});

test("proof: the injected page carries the same donor badge through the full inject() door", () => {
  const taxonomy = extractServiceTaxonomy({
    html: PROOF_HTML,
    ldNodes: PROOF_LD,
    origin: "https://harborroofing.example.com/",
    businessName: "Harbor Roofing",
  });
  const files = { "index.html": Buffer.from('<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>') };
  const out = inject({
    files,
    content: {
      services: [{ name: "Roof Replacement" }, { name: "Storm Repair" }],
      taxonomy,
      reviews: [{ author: "Dana W.", text: "Patched the ridge same day.", rating: 5 }],
    },
    facts: { business_name: "Harbor Roofing", city: "Rockport", state: "ME" },
    phoneDigits: "",
    slug: "taxonomy-proof-visible",
  });
  const html = out.files["index.html"].toString("utf8");
  assert.match(html, /wss-t__num">4\.8</);
  assert.match(html, /43 Google reviews/);
  assert.ok(html.indexOf('id="reviews"') < html.indexOf('id="about-detail"') || html.indexOf('id="about-detail"') === -1,
    "reviews are not demoted below marketing copy in the injected page");
});

// ===========================================================================
// 4. CONTENT DENSITY — a rich donor never collapses to a sparse one-pager
// ===========================================================================

test("density: a donor whose harvest came up EMPTY still renders its own taxonomy, not a bare one-pager", () => {
  // The failure mode the owner described: the donor has a real, rich site, the
  // harvest supplied nothing, and the generated page shipped as a template
  // demo. The donor's own declared catalogue is first-party content.
  const html = buildContentHtml({
    content: { taxonomy: CONCRETE_TAXONOMY }, // NO services from the harvest
    facts: { business_name: "Vega Concrete Co", city: "Vega", state: "TX" },
    phoneDigits: "",
  });
  const cards = (html.match(/<article class="wss-c__card">/g) || []).length;
  assert.equal(cards, 9, "all nine donor services render from the taxonomy alone");
  assert.match(html, /Stamped Concrete/);
  assert.match(html, /3000-grit/);
  assert.ok(html.includes('data-wss-donor-services="9"'));
});

test("density: the taxonomy fallback flows to the schema graph too — page and JSON-LD agree", () => {
  const { buildJsonLd } = require("../lib/mirror-engine/content-inject");
  const ld = buildJsonLd({
    content: { taxonomy: CONCRETE_TAXONOMY },
    facts: { business_name: "Vega Concrete Co", city: "Vega", state: "TX" },
    phoneDigits: "",
    siteUrl: "https://vega.wss-ai.com/",
  });
  const serviceNames = (ld["@graph"] || []).filter((n) => n["@type"] === "Service").map((n) => n.name).sort();
  assert.deepEqual(serviceNames, CONCRETE_SERVICES.map((s) => s.name).sort());
});

test("density: the verdict names a collapsed build, a sparse build, and a faithful one", () => {
  const collapsed = contentDensityVerdict({ taxonomy: CONCRETE_TAXONOMY, renderedServices: [] });
  assert.equal(collapsed.verdict, "collapsed");
  assert.equal(collapsed.collapsed, true);

  const sparse = contentDensityVerdict({ taxonomy: CONCRETE_TAXONOMY, renderedServices: CONCRETE_SERVICES.slice(0, 4).map((s) => ({ name: s.name })) });
  assert.equal(sparse.verdict, "sparse");
  assert.equal(sparse.sparse, true);
  assert.equal(sparse.card_ratio, 0.44);

  const ok = contentDensityVerdict({ taxonomy: CONCRETE_TAXONOMY, renderedServices: CONCRETE_SERVICES.map((s) => ({ name: s.name, description: s.description })) });
  assert.equal(ok.verdict, "ok");
  assert.equal(ok.copy_thin, false);

  assert.equal(contentDensityVerdict({ renderedServices: [{ name: "x" }] }).verdict, "no_taxonomy");
});

test("density: copy_thin flags a build that kept the cards but dropped the donor's words", () => {
  const thin = contentDensityVerdict({
    taxonomy: CONCRETE_TAXONOMY,
    renderedServices: CONCRETE_SERVICES.map((s) => ({ name: s.name })), // names, no bodies
  });
  assert.equal(thin.copy_thin, true, "nine described donor services rendered as nine bare labels");
  assert.equal(thin.verdict, "copy_thin");
});

test("density: a small honest list is not flagged — two services is two cards, not a sparse bug", () => {
  const small = contentDensityVerdict({
    taxonomy: { count: 2, services: [{ name: "A" }, { name: "B" }] },
    renderedServices: [{ name: "A" }, { name: "B" }],
  });
  assert.equal(small.verdict, "ok");
});

test("density: the build report carries the verdict — and reports null when no taxonomy was supplied", () => {
  const files = { "index.html": Buffer.from('<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>') };
  const out = inject({
    files,
    content: { services: CONCRETE_SERVICES.map((s) => ({ name: s.name })), taxonomy: CONCRETE_TAXONOMY },
    facts: { business_name: "Vega Concrete Co", city: "Vega", state: "TX" },
    phoneDigits: "",
    slug: "taxonomy-density-report",
  });
  assert.equal(out.report.taxonomy.verdict, "ok");
  assert.equal(out.report.taxonomy.donor_services, 9);
  assert.equal(out.report.taxonomy.rendered_cards, 9);
  // Enrichment happened at the render door, so the reported copy is not thin.
  assert.equal(out.report.taxonomy.copy_thin, false);

  const plain = inject({
    files,
    content: { services: CONCRETE_SERVICES.map((s) => ({ name: s.name })) },
    facts: { business_name: "Vega Concrete Co", city: "Vega", state: "TX" },
    phoneDigits: "",
    slug: "taxonomy-density-report-plain",
  });
  assert.equal(plain.report.taxonomy, null, "no taxonomy supplied: null, never a fabricated verdict");
});

// ===========================================================================
// PAIRED BOUNDS — the fidelity laws do not loosen the truth law
// ===========================================================================

test("bounds: a donor with no taxonomy markup yields an EMPTY taxonomy, never a generated one", () => {
  const taxonomy = extractServiceTaxonomy({
    html: "<!doctype html><html><body><h1>Bare site</h1><p>No services listed.</p></body></html>",
    ldNodes: [],
    origin: "https://bare.example.com/",
    businessName: "Bare Site",
  });
  assert.deepEqual(taxonomy.services, []);
  assert.equal(taxonomy.count, 0);
  assert.equal(taxonomy.proof.rating, null);
});

test("bounds: taxonomyServiceCards re-applies the render gates — a template token never becomes a card", () => {
  const cards = taxonomyServiceCards({
    services: [
      { name: "Stamped Concrete", description: "Real copy." },
      { name: "${child.title}" },
      { name: "9 Benefits of Prompt Driveway Repairs" },
      { name: "Stamped Concrete" },
    ],
  });
  assert.deepEqual(cards, [{ name: "Stamped Concrete", description: "Real copy." }]);
});

test("bounds: absence of a taxonomy changes nothing — byte-identical render", () => {
  const content = { services: [{ name: "Roof Replacement" }], reviews: [{ author: "A", text: "t", rating: 5 }] };
  const facts = { business_name: "Harbor Roofing", city: "Rockport", state: "ME" };
  const before = buildContentHtml({ content: { ...content }, facts, phoneDigits: "" });
  const after = buildContentHtml({ content: { ...content, taxonomy: null }, facts, phoneDigits: "" });
  assert.equal(before, after, "a null taxonomy is a passthrough, not a behaviour change");
});
