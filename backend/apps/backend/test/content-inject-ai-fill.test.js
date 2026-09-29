"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildContentHtml,
  buildJsonLd,
  buildTeamBand,
  cleanFaqAnswer,
  inject,
  sanitizedAbout,
  seoDescription,
  seoTitle,
  verifiedServiceAreas,
  withUsableServices,
} = require("../lib/mirror-engine/content-inject");

test("about copy removes builder declarations and interrupted form tags without losing prose", () => {
  const first = "Our crew builds homes in Albuquerque.";
  const last = "We also remodel kitchens.";
  assert.deepEqual(sanitizedAbout(`${first} FontSize: 14; --mobileScheduleDetailsFontSize: 14; --bodyServiceTitleFont: normal normal normal 60px/1.4em anton; ${last}`), [`${first} ${last}`]);
  assert.deepEqual(sanitizedAbout(`${first} textarea id="Message" nam`), [first]);
  assert.deepEqual(sanitizedAbout(`${first}\n\n${first}\n\n${last}`), [first, last]);
  assert.deepEqual(sanitizedAbout("Our process includes a textarea discussion and a 14:30 appointment."), ["Our process includes a textarea discussion and a 14:30 appointment."]);
});

test("navigation headings cannot become donor services while real service names survive", () => {
  const result = withUsableServices({ services: ["Hiring", "Our Process", "Services Categories", "scheduling a consultation", "Let’s Build Something Together", "Built for New Mexico’s Climate", "Kitchen Remodeling", "Process Piping", "Climate Control Installation"] });
  assert.deepEqual(result.services.map((s) => typeof s === "string" ? s : s.name), ["Kitchen Remodeling", "Process Piping", "Climate Control Installation"]);
});

const facts = {
  business_name: "Anchor Plumbing Co",
  industry: "plumbing",
  city: "Wasilla",
  state: "AK",
};

const graphNodes = (graph, type) => graph["@graph"].filter((node) => {
  const kinds = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return kinds.includes(type);
});

test("generated service markers are refused instead of laundered", () => {
  const raw = { services: [{ name: "Emergency Plumbing", generated: true }] };
  assert.deepEqual(withUsableServices(raw, facts.business_name).services, []);

  const html = buildContentHtml({ content: raw, facts });
  assert.equal(html, "", "generated copy is not enough to create a content section");

  const graph = buildJsonLd({ content: raw, facts, siteUrl: "https://anchor.wss-ai.com/" });
  assert.equal(graphNodes(graph, "Service").length, 0);
  assert.doesNotMatch(JSON.stringify(graph), /Emergency Plumbing/);
});

test("a NAP city stays location data and never becomes a service-area claim", () => {
  const content = { services: [{ name: "Drain Cleaning" }] };
  const html = buildContentHtml({ content, facts });
  assert.match(html, /<h2 id="wss-services-h">Services<\/h2>/);
  assert.doesNotMatch(html, /Services in Wasilla|Serving Wasilla|areas does Anchor Plumbing Co serve|nearby/i);

  const graph = buildJsonLd({ content, facts, siteUrl: "https://anchor.wss-ai.com/" });
  const business = graphNodes(graph, "LocalBusiness")[0];
  const org = graphNodes(graph, "Organization")[0];
  const service = graphNodes(graph, "Service")[0];
  assert.equal(business.areaServed, undefined);
  assert.equal(org.areaServed, undefined);
  assert.equal(service.areaServed, undefined);
  assert.match(business.description, /located in Wasilla, AK/);
  assert.doesNotMatch(JSON.stringify(graph), /availableLanguage|"areaServed"/);
});

test("contact FAQ states only the verified call and email methods", () => {
  const html = buildContentHtml({
    content: { services: [{ name: "Drain Cleaning" }] },
    facts: { ...facts, phone: "+19075550123", email: "hello@anchor.example" },
    phoneDigits: "9075550123",
  });
  assert.match(html, /Call \(907\) 555-0123 or email hello@anchor\.example\./);
  assert.doesNotMatch(html, /call or text|leave a message|get back to you|available around the clock/i);
});

test("explicit first-party service areas appear exactly; the NAP city does not", () => {
  const declaredFacts = { ...facts, service_area: "Anchorage" };
  const content = { services: [{ name: "Drain Cleaning" }], areas: ["Eagle River"] };
  const html = buildContentHtml({ content, facts: declaredFacts });
  assert.match(html, /Services in Anchorage, AK/);
  assert.match(html, /Serving Anchorage, AK/);
  assert.match(html, /lists Anchorage, AK, Eagle River as service areas/);
  assert.doesNotMatch(html, /Serving Wasilla|and nearby|surrounding area/);

  const graph = buildJsonLd({ content, facts: declaredFacts, siteUrl: "https://anchor.wss-ai.com/" });
  const served = graphNodes(graph, "LocalBusiness")[0].areaServed.map((area) => area.name);
  assert.deepEqual(served, ["Anchorage, AK", "Eagle River"]);
  assert.equal(served.includes("Wasilla"), false);
});

test("service areas move a prepended state code after every city", () => {
  assert.deepEqual(
    require("../lib/mirror-engine/content-inject").verifiedServiceAreas(
      { state: "UT", service_area: "UT St. George, UT Washington, UT Las Vegas, NV" }
    ),
    ["St. George, UT", "Washington, UT", "Las Vegas, NV"]
  );
});

test("the Canyon coverage pairs print City, ST exactly once, however they arrived", () => {
  // Issue #563, bug A: the mirror's own coverage list ships {city, state}
  // pairs as well as strings and pre-corrupted "UT Washington" strings. Every
  // shape lands on one entry per town, state after the city, duplicates gone.
  assert.deepEqual(
    verifiedServiceAreas(
      { state: "UT" },
      [
        { city: "St. George", state: "UT" },
        { city: "Washington", state: "UT" },
        { name: "Las Vegas", state: "NV" },
        { city: "St. George", state: "UT" },
        "St. George, UT",
      ],
    ),
    ["St. George, UT", "Washington, UT", "Las Vegas, NV"],
  );
});

test("only a state vouched for by the facts may lead a city out of its first word", () => {
  // "LA" and "DE" are states AND the spacey first syllables of real towns. A
  // case-blind two-letter prefix test published "La Quinta" as "Quinta, LA"
  // and "De Soto, TX" as "Soto, TX" — the same garbled-string class as bug A.
  assert.deepEqual(
    verifiedServiceAreas({ state: "TX", service_area: "El Paso" }, ["La Quinta", "De Soto, TX", "St George, UT"]),
    ["El Paso, TX", "La Quinta", "De Soto, TX", "St George, UT"],
  );
});

test("a state-suffixed coverage string becomes one City, ST entry per city", () => {
  assert.deepEqual(
    verifiedServiceAreas({ state: "UT", service_area: "St. George, UT, Washington, UT, Las Vegas, NV" }),
    ["St. George, UT", "Washington, UT", "Las Vegas, NV"],
  );
});

test("the quote-form dropdown reads certified services only — the audit junk never reaches the island", () => {
  // Bugs B + C. The donors' request-form <select> is built by the donor bundle
  // from the island's services array, so the island IS the options builder's
  // source. Every label measured live in a dropdown (Pure, Rumsey, Precision)
  // is refused at the withUsableServices door, and the areas the same donor
  // prints come out of the same verifiedServiceAreas builder the HTML block
  // uses — never raw.
  const output = inject({
    files: { "index.html": Buffer.from("<html><head></head><body></body></html>") },
    content: {
      services: [
        { name: "Water Heater Repair" },
        { name: "Expert Care from Local Plumbing & HVAC Pros" },
        { name: "Ongoing Training" },
        { name: "Our Commercial" },
        { name: "General" },
        { name: "Contracting…" },
        { name: "Las Vegas Plumbing Customers!" },
      ],
      areas: [{ city: "St. George", state: "UT" }, "UT Washington"],
    },
    facts: { ...facts, state: "UT", service_area: "UT St. George, UT Washington, UT Las Vegas, NV" },
    slug: "canyon-services",
  });
  const island = JSON.parse(
    /<script id="wss-content" type="application\/json">([\s\S]*?)<\/script>/.exec(output.files["index.html"].toString())[1],
  );
  assert.deepEqual(island.services, [{ name: "Water Heater Repair", card_no: "01", points: [
    "Water Heater Repair assessed on site with a clear, upfront quote",
    "Scheduling built around your timeline for Water Heater Repair",
    "A follow-up after every Water Heater Repair visit",
  ] }]);
  assert.deepEqual(island.areas, ["St. George, UT", "Washington, UT", "Las Vegas, NV"]);
});

test("service dropdown data and FAQ answers exclude audit garbage", () => {
  const content = withUsableServices({
    services: [
      { name: "Drain Cleaning" },
      { name: "Expert Care from Local Plumbing & HVAC Pros" },
      { name: "Ongoing Training" },
      { name: "Our Commercial" },
      { name: "Las Vegas Plumbing Customers!" },
    ],
  });
  assert.deepEqual(content.services, [{ name: "Drain Cleaning" }]);
  const answer = cleanFaqAnswer(`${"Verified answer. ".repeat(50)}trailing concatenated fragment`);
  assert.ok(answer.length <= 500);
  assert.match(answer, /\.$/);
});

test("the content island labels an otherwise unlabeled theme toggle", () => {
  const output = inject({
    files: { "index.html": Buffer.from("<html><head></head><body></body></html>") },
    content: { services: [{ name: "Drain Cleaning" }] },
    facts,
    slug: "anchor-plumbing",
  });
  assert.match(output.files["index.html"].toString(), /aria-label","Toggle color theme/);
});

test("AUDIT 563 #9: the content island labels an otherwise unlabeled star/favorite toggle", () => {
  const { controlA11yPatchScript } = require("../lib/mirror-engine/content-inject");
  const patch = controlA11yPatchScript();

  // The label the audit asked for, on the control classes a star toggle is.
  assert.match(patch, /setAttribute\("aria-label","Toggle favorite"\)/);
  assert.match(patch, /querySelectorAll\("button,\[role=button\],\[role=switch\],summary"\)/);
  // Only icon-only controls: a control with ANY accessible name is never touched.
  assert.match(patch, /function wssAccName\(el\)\{return el\.getAttribute\("aria-label"\)\|\|el\.getAttribute\("aria-labelledby"\)\|\|el\.getAttribute\("title"\)\|\|\(el\.textContent\|\|""\)\.trim\(\);\}/);
  assert.match(patch, /if\(wssAccName\(el\)\)continue;/);
  // Star markers: a lucide star icon class, the unicode star glyphs, or a
  // star/favorite/bookmark class or data attribute — word-bounded so
  // "restart"-style substrings can never match.
  assert.match(patch, /\(\?:\^\|\[\^a-z\]\)\(\?:star\|stars\|favorite\|favourite\|bookmark\)\(\?:\[\^a-z\]\|\$\)/);
  assert.match(patch, /\\u2605/);

  // And the injected page carries the patch next to the content island.
  const output = inject({
    files: { "index.html": Buffer.from("<html><head></head><body></body></html>") },
    content: { services: [{ name: "Drain Cleaning" }] },
    facts,
    slug: "anchor-plumbing",
  });
  const html = output.files["index.html"].toString();
  assert.match(html, /aria-label","Toggle favorite"/);
  assert.match(html, /id="wss-content"/, "the patch ships in the same boot script as the content island");
});

test("llms.txt says located-in unless a service area was explicitly verified", () => {
  const baseFiles = { "index.html": Buffer.from("<!doctype html><html><head></head><body></body></html>") };
  const local = inject({
    files: baseFiles,
    content: { services: [{ name: "Drain Cleaning" }] },
    facts,
    slug: "anchor-plumbing",
  });
  const localLlms = local.files["llms.txt"].toString("utf8");
  assert.match(localLlms, /> plumbing business located in Wasilla, AK\./);
  assert.match(localLlms, /- Located in: Wasilla, AK/);
  assert.doesNotMatch(localLlms, /serving Wasilla|- Serves: Wasilla/i);

  const serving = inject({
    files: baseFiles,
    content: { services: [{ name: "Drain Cleaning" }] },
    facts: { ...facts, service_area: "Anchorage" },
    slug: "anchor-plumbing",
  }).files["llms.txt"].toString("utf8");
  assert.match(serving, /> plumbing serving Anchorage, AK\./);
  assert.match(serving, /- Serves: Anchorage, AK/);
  assert.match(serving, /- Located in: Wasilla, AK/);
});

test("SEO does not turn the mailing city into an offer location", () => {
  const description = seoDescription({ facts, services: [{ name: "Drain Cleaning" }] });
  assert.equal(description, "Drain Cleaning offered by Anchor Plumbing Co.");
  assert.doesNotMatch(description, /in Wasilla/);

  const title = seoTitle({ facts });
  assert.match(title, /Anchor Plumbing Co/);
  assert.doesNotMatch(title, /plumbing in Wasilla/i);
});

test("identity-photo copy adds no call, doorstep, insurance, or arrival claim", () => {
  const html = buildTeamBand({
    identityPhoto: { url: "/assets/van.webp", subject: "vehicle" },
    facts,
    market: "Wasilla, AK",
    city: "Wasilla",
  });
  assert.match(html, /Anchor Plumbing Co on the road/);
  assert.doesNotMatch(html, /first call|show up at your door|call centre|insured|pull up|spot us around/i);
});
