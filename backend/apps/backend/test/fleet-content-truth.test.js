"use strict";

// test/fleet-content-truth.test.js
//
// Pins the five content-truth defect classes from the 2026-09-02 live-site
// fleet audit (fresh Sept 1–2 builds). Every fixture below is the exact
// string the audit found on a live, paying customer's mirror — not a
// synthesis.
//
//   D1 — STATE-PREPEND / COVERAGE GARBAGE IN SERVICE AREAS. The roofing
//        mirror printed "FL Marco Island, FL Estero, FL Bonita Springs, …"
//        with ZIP-prefixed towns ("FL 34104 Golden Gate"), coverage glue
//        ("FL and surrounding areas Alva"), a welded regional qualifier
//        ("FL Southwest Florida Buckingham"), a trailing bare code, and —
//        because a trailing period defeated the suffix test — the NAP state
//        appended twice: "Cape Coral, FL., FL". The concrete mirror published
//        a trade phrase as a place: "General Contractor in Southwest
//        Florida, FL".
//   D2 — FAQ ANSWER WALLS. All nine roofing answers rendered 498–549 chars;
//        the general mirror concatenated the same city list twice in two
//        formats. #600's cap is pinned again here on the live strings, plus
//        the duplicated-list collapse.
//   D3 — SCRAPER ARTIFACT AS CLIENT EMAIL. Landscaping ×4, plumbing ×4, LIVE
//        in the FAQPage JSON-LD Google reads:
//        "Email frame-A013717F96D5CBAEFCD26EB58FD1540F@mhtml.blink." — the
//        message-id of a frame in a saved MHTML file, harvested as if it were
//        the client's contact address.
//   D4 — ABOUT-WALL DUMPS. The general mirror shipped a 2,204-char "Who you
//        are hiring" paragraph (raw service-name dump); the concrete one 985
//        chars with near-duplicates; the landscaping one glued FAQ questions
//        and four formats of the same city list into one 946-char paragraph.
//   D5 — HERO HEADLINE FRAGMENT STACKS. The roofing bundle shipped the h1
//        "Roofers. Roofing in Naples, FL. Absolute Roofing of Southwest
//        Florida." (a one-word stub motto, then trade-and-city, then the
//        name); the general mirror carried the client's own casing garble
//        "General Contractor In Sacramento, Ca." verbatim.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildJsonLd,
  cleanFaqAnswer,
  inject,
  sanitizedAbout,
  sanitizedFaqs,
  verifiedServiceAreas,
} = require("../lib/mirror-engine/content-inject");
const { composeIdentityCopy, usableTagline } = require("../lib/mirror-engine/identity-copy");
const { stripScraperEmailArtifacts, isScraperArtifactEmail, validateFacts } = require("../lib/mirror-engine/facts");

// ---- D1 fixtures — verbatim from the live roofing/concrete mirrors --------

const ROOFING_FACTS = {
  business_name: "Absolute Roofing of Southwest Florida",
  industry: "roofing",
  city: "Naples",
  state: "FL",
};

// The run-on the audit pulled off the live roofing JSON-LD description, down
// to the ZIP-prefixed towns, the glue phrases and the final dotted code.
const ROOFING_RUN_ON = "FL Marco Island, FL Estero, FL Bonita Springs, FL Berkshire Lakes, "
  + "FL 34104 Golden Gate, FL 34116 Naples Manor, FL 34113 Lely, FL 34113 Verona Walk, "
  + "FL 34114 Vineyards, FL Pelican Marsh, FL Pine Ridge, FL and surrounding areas Alva, "
  + "FL Ave Maria, FL Southwest Florida Buckingham, FL Captiva, FL Charlotte Harbor, "
  + "FL Cape Coral, FL.";

const ROOFING_AREAS = [
  "FL Marco Island", "FL Estero", "FL Bonita Springs", "FL Berkshire Lakes",
  "FL 34104 Golden Gate", "FL 34116 Naples Manor", "FL 34113 Lely", "FL 34113 Verona Walk",
  "FL 34114 Vineyards", "FL Pelican Marsh", "FL Pine Ridge", "FL and surrounding areas Alva",
  "FL Ave Maria", "FL Southwest Florida Buckingham", "FL Captiva", "FL Charlotte Harbor",
  "FL Cape Coral, FL.",
];

test("D1: the live roofing run-on prints every town once as City, ST — nothing else", () => {
  const areas = verifiedServiceAreas({ ...ROOFING_FACTS, service_area: ROOFING_RUN_ON }, []);
  assert.ok(areas.length >= 15, `the real towns survive, got ${JSON.stringify(areas)}`);
  for (const area of areas) {
    assert.doesNotMatch(area, /^FL /, `no leading state code: ${area}`);
    assert.doesNotMatch(area, /\d/, `no ZIP in a service area: ${area}`);
    assert.doesNotMatch(area, /surrounding/i, `no coverage glue: ${area}`);
    assert.doesNotMatch(area, /,\.|,\s*,|FL\.,/, `no punctuation garble: ${area}`);
    assert.match(area, /, FL$/, `each town carries its own state exactly once: ${area}`);
  }
  assert.equal(areas.filter((a) => a === "Golden Gate, FL").length, 1, "FL 34104 Golden Gate is Golden Gate, FL");
  assert.equal(areas.filter((a) => a === "Cape Coral, FL").length, 1, "FL Cape Coral, FL. is Cape Coral, FL — never 'FL., FL'");
  assert.equal(areas.filter((a) => a === "Alva, FL").length, 1, "'FL and surrounding areas Alva' is Alva, FL");
  assert.equal(areas.filter((a) => a === "Buckingham, FL").length, 1, "'FL Southwest Florida Buckingham' is Buckingham, FL");
  assert.ok(!areas.includes("FL"), "a bare state code is not a service area");
});

test("D1: the same garble entering as the harvested areas array is repaired identically", () => {
  const areas = verifiedServiceAreas(ROOFING_FACTS, ROOFING_AREAS);
  assert.equal(areas.filter((a) => a === "Golden Gate, FL").length, 1);
  assert.equal(areas.filter((a) => a === "Cape Coral, FL").length, 1);
  assert.equal(areas.filter((a) => a === "Alva, FL").length, 1);
  for (const area of areas) {
    assert.doesNotMatch(area, /^FL |FL\.,|\d/, `clean entry only: ${area}`);
  }
});

test("D1: a trade phrase is never published as a service area (concrete, live)", () => {
  // The live concrete mirror printed "General Contractor in Southwest
  // Florida, FL" — a trade claim over a region wearing a town's punctuation.
  const declared = verifiedServiceAreas(
    { ...ROOFING_FACTS, city: "Fort Myers", service_area: "General Contractor in Southwest Florida" },
    [],
  );
  assert.deepEqual(declared, [], "the phrase asserts services, not coverage");
  // The same phrase arriving in the harvested areas list is refused too.
  const fromArray = verifiedServiceAreas({ ...ROOFING_FACTS, city: "Fort Myers" }, ["General Contractor in Southwest Florida"]);
  assert.deepEqual(fromArray, []);
  // Real coverage still prints: the refusal needs a trade word AND a
  // preposition, which no town name carries.
  const real = verifiedServiceAreas({ ...ROOFING_FACTS, service_area: "Naples" }, ["Marco Island"]);
  assert.deepEqual(real, ["Naples, FL", "Marco Island"], "real coverage prints; a name-only entry carries no implied state");
});

// ---- D2 fixtures — verbatim live walls ------------------------------------

const ROOFING_LONGEST_ANSWER = "Our expertise spans a wide range of materials to suit the diverse architectural "
  + "styles found in Southwest Florida, from classic asphalt shingle and standing seam metal to clay tile, cedar "
  + "shake and modern TPO flat-roof systems. We walk every homeowner through the options that fit their home and "
  + "budget, and our in-house crews are factory-trained on every system we install, so whatever roof you choose you "
  + "are never dealing with a subcontractor who learned on the job, and every installation is backed by our workmanship "
  + "warranty and the manufacturer's own material coverage for complete peace of mind here in Naples and the "
  + "surrounding communities.";

test("D2: the live 549-char roofing answer is capped at 300 on a sentence edge", () => {
  const answer = cleanFaqAnswer(ROOFING_LONGEST_ANSWER);
  assert.ok(answer.length <= 300, `capped, got ${answer.length}`);
  assert.match(answer, /\.$/, "the cap lands on a sentence end");
  assert.ok(answer.startsWith("Our expertise spans"), "the answer's own prose leads");
});

test("D2: the same city list concatenated in two formats prints once (general, live)", () => {
  const answer = cleanFaqAnswer(
    "We serve homeowners across the region, including Sacramento, Roseville, Folsom, and Elk Grove. "
    + "Sacramento, CA, Roseville, CA, Folsom, CA, Elk Grove, CA, and the surrounding communities can book same-week visits.",
  );
  assert.ok(!/\bSacramento, CA\b.*\bSacramento, CA\b/s.test(answer), "the second-format list is gone");
  assert.ok(answer.includes("Sacramento"), "the first-format list survives");
  assert.match(answer, /same-week visits\./, "prose after the dropped list survives");
});

test("D2: a town printed twice inside one run prints once (landscaping, live)", () => {
  const answer = cleanFaqAnswer(
    "Brilliant Borders serves Johnston, Waukee, Cumming, West Des Moines, Ankeny, Altoona Waukee, "
    + "West Des Moines, Urbandale and the surrounding areas.",
  );
  assert.equal(answer.split("West Des Moines").length - 1, 1, "West Des Moines prints once");
  assert.ok(answer.includes("Johnston") && answer.includes("Urbandale"), "the other towns survive");
});

// ---- D3 fixtures — verbatim live artifacts --------------------------------

const PLUMBING_ARTIFACT = "frame-59F561B4979E9A5B3051855443BB8691@mhtml.blink";
const LANDSCAPING_ARTIFACT = "frame-A013717F96D5CBAEFCD26EB58FD1540F@mhtml.blink";
const ARTIFACT_ANSWER = `Call 702-253-6363. Email ${PLUMBING_ARTIFACT}. Call Us today: 702-253-6363.`;

test("D3: the live scraper-artifact email never survives an FAQ answer", () => {
  assert.equal(isScraperArtifactEmail(PLUMBING_ARTIFACT), true);
  assert.equal(isScraperArtifactEmail(LANDSCAPING_ARTIFACT), true);
  const cleaned = sanitizedFaqs([{ q: "How do I contact you?", a: ARTIFACT_ANSWER }]);
  assert.equal(cleaned.length, 1);
  assert.ok(!cleaned[0].a.includes("mhtml.blink"), `artifact gone: ${cleaned[0].a}`);
  assert.ok(cleaned[0].a.includes("Call 702-253-6363"), "the client's real phone copy survives");
});

test("D3: the fact boundary strips the artifact and builds anyway; real emails untouched", () => {
  const base = { business_name: "Precision Plumbing LLC", industry: "plumbing", city: "Las Vegas", state: "NV" };
  const artifact = validateFacts({ facts: { ...base, email: PLUMBING_ARTIFACT } });
  assert.equal(artifact.ok, true, "a harvested message-id is not a caller defect");
  assert.equal(artifact.facts.email, undefined, "the artifact is stripped to honest absence");
  const real = validateFacts({ facts: { ...base, email: "office@precisionlv.com" } });
  assert.equal(real.facts.email, "office@precisionlv.com", "a real client email passes untouched");
  assert.equal(isScraperArtifactEmail("office@frame-builders.com"), false, "a real business at a 'frame' domain is never refused");
});

test("D3: the JSON-LD graph and the generated contact answer refuse the artifact", () => {
  const facts = { ...ROOFING_FACTS, email: LANDSCAPING_ARTIFACT };
  const graph = buildJsonLd({ content: {}, facts, siteUrl: "https://x.wss-ai.com/" });
  assert.ok(!JSON.stringify(graph).includes("mhtml.blink"), "the schema email never prints the artifact");
  const out = inject({
    files: { "index.html": "<html><head></head><body><div id=\"root\"></div></body></html>" },
    content: {},
    facts,
    phoneDigits: "7022536363",
    slug: "x",
  });
  const island = out.files["index.html"].toString();
  assert.ok(!island.includes("mhtml.blink"), "the data island never carries the artifact");
  const llms = out.files["llms.txt"] ? out.files["llms.txt"].toString() : "";
  if (llms) assert.ok(!llms.includes("mhtml.blink"), "llms.txt never prints the artifact");
});

// ---- D4 fixture — the live landscaping about wall (946 chars verbatim) -----

const LANDSCAPING_ABOUT_WALL = "Brilliant Borders offers Landscape Design, Landscape Construction, Outdoor Living Spaces, "
  + "Landscape Maintenance, Pool Installation, Commercial Landscape Construction, Commercial Landscape Maintenance, "
  + "Irrigation Services, Snow Removal, Landscape Installation, Lawn Fertilization, Preventative Disease Control "
  + "Treatments, Curative Treatments, Aeration Service, Residential Landscaping, Will Adding Mulch to Your Landscape "
  + "Help Suppress Weeds?, How does mulch prevent weed growth in your landscape beds?, and Hire Pros to Add Mulch to "
  + "Your Landscape to Suppress Weed Growth in Johnston, Waukee, Cumming, West Des Moines, Ankeny, Altoona Waukee, "
  + "West Des Moines, Urbandale Waukee, IA West Des Moines Urbandale Waukee, West Des Moines, Urbandale, IA Des Moines "
  + "Metro Waukee, West Des Moines, Urbandale, and surrounding areas Waukee, West Des Moines, Urbandale, IA, and "
  + "neighboring areas Waukee, West Des Moines, Urbandale, IA, and nearby communities.";
assert.ok(LANDSCAPING_ABOUT_WALL.length >= 900, "fixture must model the live about wall");

test("D4: the live 946-char about wall is capped to a prose-sane paragraph", () => {
  const paras = sanitizedAbout(LANDSCAPING_ABOUT_WALL);
  assert.equal(paras.length, 1);
  assert.ok(paras[0].length <= 600, `prose-sane cap, got ${paras[0].length}`);
  assert.match(paras[0], /\.$|$/, "never cut mid-word");
  assert.ok(paras[0].startsWith("Brilliant Borders offers"), "the client's own copy leads");
});

test("D4: near-identical service names dedupe (general's 'Contractor/Contractors')", () => {
  const dump = "Sacramento Contracting Group offers General Contractor, General Contractors, Concrete Work, "
    + "Concrete Works, and Foundation Repair across the metro.";
  const paras = sanitizedAbout(dump);
  assert.equal(paras.length, 1);
  const lower = paras[0].toLowerCase();
  assert.equal((lower.match(/general contractors?\b/g) || []).length, 1, "Contractor/Contractors print once");
  assert.equal((lower.match(/concrete works?\b/g) || []).length, 1, "Concrete Work/Works print once");
  assert.ok(paras[0].includes("Foundation Repair"), "the distinct services survive");
});

test("D4: a scraper-artifact email never rides in the about copy", () => {
  const paras = sanitizedAbout(`We answer every message sent to ${LANDSCAPING_ARTIFACT} within one business day.`);
  assert.equal(paras.length, 1);
  assert.ok(!paras[0].includes("mhtml.blink"));
  assert.ok(paras[0].includes("within one business day"));
});

test("D4: the data island carries the sanitized about, never the raw dump", () => {
  const out = inject({
    files: { "index.html": "<html><head></head><body><div id=\"root\"></div></body></html>" },
    content: { about: LANDSCAPING_ABOUT_WALL },
    facts: { business_name: "Brilliant Borders", industry: "landscaping", city: "Johnston", state: "IA" },
    slug: "brilliant-borders",
  });
  const island = out.files["index.html"].toString();
  assert.ok(!island.includes(LANDSCAPING_ABOUT_WALL), "the raw wall does not ship");
});

// ---- D5 fixtures — verbatim live hero stacks -------------------------------

test("D5: a one-word stub motto is not a slogan (roofing's live 'Roofers.')", () => {
  assert.equal(usableTagline("Roofers.", { businessName: ROOFING_FACTS.business_name }), "");
});

test("D5: the roofing headline rebuilds as name + trade-and-city, no stub, no stack", () => {
  const copy = composeIdentityCopy({
    facts: ROOFING_FACTS,
    marketCity: "Naples",
    hero: { tagline: "Roofers." },
  });
  assert.equal(copy.headline, "Absolute Roofing of Southwest Florida. Roofing in Naples, FL.");
  const fragments = copy.headline.split(/(?<=[.!?])\s+/).filter(Boolean);
  assert.ok(fragments.length <= 2, `at most two fragments, got ${JSON.stringify(fragments)}`);
  assert.ok(!/\bRoofers\.\s/.test(copy.headline), "the stub never leads");
  assert.match(copy.headline, /Naples, FL\.$/, "the state prints as City, ST");
});

test("D5: the client's casing garble is publish-normalized, words untouched (general, live)", () => {
  const copy = composeIdentityCopy({
    facts: { business_name: "Sacramento General Contracting", industry: "general contractor", city: "Sacramento", state: "CA" },
    marketCity: "Sacramento",
    hero: { tagline: "General Contractor In Sacramento, Ca." },
  });
  assert.equal(copy.lines.a, "General Contractor in Sacramento, CA.", "interior 'In' → 'in', ', Ca.' → ', CA'");
  assert.match(copy.headline, /Sacramento General Contracting\./, "the name still identifies the page");
});

test("D5: a lowercase stored state still prints 'City, ST' on the hero line", () => {
  const copy = composeIdentityCopy({
    facts: { business_name: "Acme Roofing", industry: "roofing", city: "Naples", state: "fl" },
    marketCity: "Naples",
  });
  assert.match(copy.lines.b, /^Roofing in Naples, FL\.$/);
});
