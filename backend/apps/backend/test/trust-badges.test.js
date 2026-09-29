"use strict";

// TRUST BADGES (optional client fields) — license_number / insured /
// associations. A client-supplied trust rail renders ONLY what was supplied:
// absent fields render nothing at all, an `insured: false` renders nothing,
// and every value is escaped before it touches the page. Pinned here too: the
// facts boundary (422 on wrong shapes) and the schema gate (additionalProperties
// closed, https-only money URLs) that these new optional fields pass through.

const test = require("node:test");
const assert = require("node:assert");

const { buildContentHtml, buildTrustBadges } = require("../lib/mirror-engine/content-inject");
const { validateFacts } = require("../lib/mirror-engine/facts");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

const FACTS = {
  business_name: "Test Fence Co",
  industry: "fencing",
  city: "Denton",
  state: "TX",
  phone: "+19405550000",
};

const render = (over = {}, content = {}) => buildContentHtml({
  content: { services: ["Fence repair"], ...content },
  facts: { ...FACTS, ...over },
  phoneDigits: "9405550000",
  donorRenders: [],
});

// ---------------------------------------------------------------------------
// Conditional rendering: present
// ---------------------------------------------------------------------------

test("a full trust-badge rail renders licence number, insured, and association chips", () => {
  const html = render({ license_number: "TX-40291", insured: true, associations: ["AFA", "BBB"] });
  assert.match(html, /<section class="wss-c wss-tb" id="trust-badges" aria-labelledby="wss-tb-h"/);
  assert.match(html, /data-wss-trustbadge="license"/);
  assert.match(html, /License <span class="wss-tb__datum">TX-40291<\/span>/);
  assert.match(html, /data-wss-trustbadge="insured"/);
  assert.match(html, />Insured</);
  assert.match(html, /data-wss-trustbadge="association"/);
  assert.match(html, />AFA</);
  assert.match(html, />BBB</);
});

test("the section renders for a client whose ONLY extras are the badges (never lost to the early return)", () => {
  const html = buildContentHtml({ content: {}, facts: { ...FACTS, insured: true }, phoneDigits: "", donorRenders: [] });
  assert.ok(html.includes('id="trust-badges"'), "the badges-only client still gets the rail");
});

test("badge values are escaped, never injected", () => {
  const html = buildTrustBadges({ facts: { license_number: '<script>alert("x")</script>', associations: ["<b>Acme</b> Assn"] } });
  assert.ok(!html.includes("<script>"), "raw markup never reaches the page");
  assert.ok(html.includes("&lt;script&gt;"), "the licence value is entity-escaped");
  assert.ok(html.includes("&lt;b&gt;Acme&lt;/b&gt; Assn"), "association names are entity-escaped");
});

test("each field stands alone — one licence renders one badge, no invented copy", () => {
  const html = render({ license_number: "LIC-1" });
  assert.match(html, /data-wss-trustbadge="license"/);
  assert.doesNotMatch(html, /data-wss-trustbadge="insured"/, "no insurance claim without the fact");
  assert.doesNotMatch(html, /data-wss-trustbadge="association"/);
});

// ---------------------------------------------------------------------------
// Conditional rendering: absent
// ---------------------------------------------------------------------------

test("absent fields render no trust-badge section at all", () => {
  const html = render({});
  assert.ok(!html.includes('id="trust-badges"'));
  assert.ok(!html.includes("data-wss-trustbadge"));
  // …and the page itself is unharmed: the ordinary content still renders.
  assert.match(html, /Fence repair/);
});

test("insured:false and an empty associations array render nothing", () => {
  for (const over of [{ insured: false }, { associations: [] }, { associations: ["  "] }, { license_number: "" }]) {
    const html = render(over);
    assert.ok(!html.includes("data-wss-trustbadge"), `${JSON.stringify(over)} must render no badge`);
  }
});

// ---------------------------------------------------------------------------
// The facts boundary: optional means absent, never wrong
// ---------------------------------------------------------------------------

test("validateFacts accepts and normalizes the trust fields", () => {
  const result = validateFacts({
    facts: {
      ...FACTS,
      license_number: "  TX-40291 ",
      insured: true,
      associations: ["  AFA ", "", "BBB"],
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.facts.license_number, "TX-40291");
  assert.deepEqual(result.facts.associations, ["AFA", "BBB"], "blank rows are honest nothings");
});

test("validateFacts stores the honest absence for insured:false", () => {
  const result = validateFacts({ facts: { ...FACTS, insured: false } });
  assert.equal(result.ok, true);
  assert.equal("insured" in result.facts, false, "false is the renderer default — no row of no-ops");
});

test("validateFacts rejects wrong-shaped trust fields with named reasons", () => {
  const cases = [
    [{ license_number: 40291 }, "license_number_not_string"],
    [{ license_number: "<img src=x>" }, "forbidden_characters"],
    [{ insured: "yes" }, "insured_not_boolean"],
    [{ associations: "AFA" }, "associations_not_array"],
    [{ associations: ["AFA", 7] }, "association_not_string"],
    [{ associations: Array.from({ length: 13 }, (_, i) => `A${i}`) }, "associations_too_many"],
  ];
  for (const [over, reason] of cases) {
    const result = validateFacts({ facts: { ...FACTS, ...over } });
    assert.equal(result.ok, false, `${JSON.stringify(over)} must fail`);
    assert.equal(result.error, "invalid_facts");
    assert.equal(result.detail[0].reason, reason, `${JSON.stringify(over)} -> ${reason}`);
  }
});

// ---------------------------------------------------------------------------
// The schema gate: the new fields are accepted when valid, closed when not
// ---------------------------------------------------------------------------

const request = (facts) => ({ slug: "test-fence-co-denton", facts: { ...FACTS, ...facts } });

test("checkMirrorRequest accepts the new optional trust fields", () => {
  const result = checkMirrorRequest(request({
    license_number: "TX-40291",
    insured: true,
    associations: ["AFA", "BBB"],
  }));
  assert.equal(result.ok, true, JSON.stringify(result.body || result));
});

test("checkMirrorRequest still closes unknown facts and wrong shapes", () => {
  assert.equal(checkMirrorRequest(request({ license_number: 123 })).ok, false);
  assert.equal(checkMirrorRequest(request({ insured: "true" })).ok, false);
  assert.equal(checkMirrorRequest(request({ associations: [{ name: "AFA" }] })).ok, false,
    "association entries are strings, not objects");
  assert.equal(checkMirrorRequest(request({ associations: Array.from({ length: 13 }, () => "A") })).ok, false,
    "over-cap arrays fail the schema before facts.js ever sees them");
});
