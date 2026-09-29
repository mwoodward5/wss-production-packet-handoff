import test from "node:test";
import assert from "node:assert/strict";
import { AUTHORITY_STANDARD, AUTHORITY_STANDARD_VERSION, evaluateAuthorityStandard } from "../../factory/authority/authority-standard.mjs";
import { buildAuthoritySchema, localBusinessSubtype, schemaTypesFromGraph } from "../../factory/authority/schema-engine.mjs";

const context = ({ verified = true, ratingEligible = false } = {}) => ({
  packet: {
    business: {
      name: "Cedar Line Landscaping",
      category: "landscaping",
      city: "Sacramento",
      state: "CA",
      current_website: "https://www.cedarline.example/projects",
    },
    enrichment_sources: verified ? {
      website: { source: "source-intake", confidence: 0.95, value: "https://www.cedarline.example/" },
      phone: { source: "source-intake", confidence: 0.95, value: "(916) 555-0198" },
      address: { source: "site", confidence: 0.9, value: "2805 Wah Ave, Sacramento, CA 95822" },
      latlng: { source: "gbp", confidence: 0.9, value: { lat: 38.53, lng: -121.48 } },
      hours: { source: "gbp", confidence: 0.9, value: "Mon-Fri", hours_spec: true },
      founder: { source: "site", confidence: 0.8, value: { name: "Jamie Cedar", jobTitle: "Owner" } },
      rating: { source: "gbp", confidence: 0.9, schema_eligible: ratingEligible, value: { value: 4.8, count: 42 } },
    } : {},
    media: { catalog: [] },
    forge: { demo: true },
    canonical_truth: { version: "v1" },
  },
  biz: { name: "Cedar Line Landscaping", category: "landscaping", city: "Sacramento", state: "CA" },
  trade: { key: "landscaping" },
  services: ["Lawn care", "Sprinkler checks"],
  phone: verified ? "(916) 555-0198" : null,
  gbp: {
    latlng: verified ? { lat: 38.53, lng: -121.48 } : null,
    hoursSpec: verified ? [{ "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "08:00", closes: "17:00" }] : null,
  },
  intro: "Cedar Line Landscaping provides source-verified lawn care in Sacramento.",
  faqs: [["What work is available?", "Contact the business to confirm current services."]],
  photos: [],
  snippets: [],
});

test("authority catalog contains exactly 108 stable, unique checks", () => {
  assert.equal(AUTHORITY_STANDARD_VERSION, "authority-108-v1");
  assert.equal(AUTHORITY_STANDARD.length, 108);
  assert.deepEqual(AUTHORITY_STANDARD.map((item) => item.id), Array.from({ length: 108 }, (_, index) => index + 1));
  assert.equal(new Set(AUTHORITY_STANDARD.map((item) => item.key)).size, 108);
});

test("schema engine uses valid vertical types and omits obsolete SearchAction", () => {
  const ctx = context();
  const graph = buildAuthoritySchema({ ctx, pageName: "Cedar Line Landscaping", canonicalPath: "/" });
  const types = schemaTypesFromGraph(graph);
  assert.equal(localBusinessSubtype("landscaping"), "HomeAndConstructionBusiness");
  assert.ok(types.includes("HomeAndConstructionBusiness"));
  assert.ok(types.includes("LocalBusiness"));
  assert.ok(types.includes("Organization"));
  assert.ok(types.includes("Service"));
  assert.ok(types.includes("FAQPage"));
  assert.ok(types.includes("Person"));
  assert.ok(types.includes("PostalAddress"));
  assert.ok(types.includes("GeoCoordinates"));
  assert.ok(types.includes("ContactPoint"));
  assert.ok(!types.includes("SearchAction"));
  assert.doesNotMatch(JSON.stringify(graph), /potentialAction|search_term_string/);
  const localBusiness = graph["@graph"].find((node) =>
    (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).includes("LocalBusiness"));
  assert.deepEqual(localBusiness.sameAs, ["https://www.cedarline.example/projects"]);
});

test("schema engine omits unsourced address, geo, person, and ratings", () => {
  const ctx = context({ verified: false });
  const graph = buildAuthoritySchema({ ctx, pageName: "Cedar Line Landscaping" });
  const types = schemaTypesFromGraph(graph);
  assert.ok(!types.includes("PostalAddress"));
  assert.ok(!types.includes("GeoCoordinates"));
  assert.ok(!types.includes("Person"));
  assert.ok(!types.includes("AggregateRating"));
  const localBusiness = graph["@graph"].find((node) =>
    (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).includes("LocalBusiness"));
  assert.equal(localBusiness.sameAs, undefined);
});

test("schema engine uses an exact verified category when false scraped services were removed", () => {
  const ctx = context();
  ctx.services = [];
  ctx.packet.enrichment_sources.category = {
    source: "intake_form",
    confidence: 0.95,
    value: "landscaping",
  };

  const graph = buildAuthoritySchema({ ctx, pageName: "Cedar Line Landscaping" });
  const service = graph["@graph"].find((node) => node["@type"] === "Service");

  assert.equal(service?.name, "landscaping");
  assert.equal(service?.serviceType, "landscaping");
  assert.deepEqual(service?.provider, { "@id": "/#localbusiness" });
});

test("schema category fallback fails closed without exact trustworthy evidence", () => {
  for (const category of [
    null,
    { source: "generated-fallback", confidence: 0.95, value: "landscaping" },
    { source: "intake_form", confidence: 0.59, value: "landscaping" },
    { source: "intake_form", confidence: 0.95, value: "roofing" },
  ]) {
    const ctx = context();
    ctx.services = [];
    if (category) ctx.packet.enrichment_sources.category = category;

    const graph = buildAuthoritySchema({ ctx, pageName: "Cedar Line Landscaping" });
    assert.ok(
      !schemaTypesFromGraph(graph).includes("Service"),
      `unsafe category evidence created Service: ${JSON.stringify(category)}`,
    );
  }
});

test("aggregate rating requires explicit schema eligibility", () => {
  const blocked = buildAuthoritySchema({ ctx: context({ ratingEligible: false }) });
  const allowed = buildAuthoritySchema({ ctx: context({ ratingEligible: true }) });
  assert.ok(!schemaTypesFromGraph(blocked).includes("AggregateRating"));
  assert.ok(schemaTypesFromGraph(allowed).includes("AggregateRating"));
});

test("authority manifest is honest and email-ready", () => {
  const ctx = context();
  const schemaGraph = buildAuthoritySchema({ ctx });
  const html = `<!doctype html><html lang="en"><head><title>Cedar Line Landscaping - Sacramento CA</title><meta name="description" content="Landscaping in Sacramento."><meta name="robots" content="noindex"><link rel="canonical" href="/"><meta name="twitter:card" content="summary_large_image"><meta property="og:image" content="media/og.svg"><script type="application/ld+json">${JSON.stringify(schemaGraph)}</script></head><body><a class="skip-link" href="#main">Skip</a><header><a href="#services">Services</a><a href="#faq">FAQ</a><a href="#quote">Quote</a></header><main id="main"><h1>Landscaping for Sacramento.</h1><section id="services"><h2>What work is available?</h2><p class="intro speakable">Source-verified lawn care in Sacramento, CA.</p></section><section id="area" data-map><a href="https://maps.google.com/">Directions</a></section><section id="faq"></section><form><label>Name<input name="name"></label><p role="status"></p></form><div data-sticky-cta></div><img src="media/og.svg" alt="Cedar Line Landscaping"></main><footer>Sacramento, CA (916) 555-0198</footer></body></html>`;
  const result = evaluateAuthorityStandard({ packet: ctx.packet, ctx, pages: [{ path: "/", title: "Cedar Line Landscaping - Sacramento CA", desc: "Landscaping in Sacramento.", html }], schemaGraph });
  assert.equal(result.total, 108);
  assert.equal(result.checks.length, 108);
  assert.match(result.public_claim, /108-Point Local Authority Standard/);
  assert.match(result.email_summary, /visibility, trust, speed, accessibility, and conversion/i);
  assert.match(result.disclaimer, /not a promise of rankings/i);
  assert.ok(result.runtime_verification > 0);
  assert.ok(result.needs_owner_input > 0);
});
