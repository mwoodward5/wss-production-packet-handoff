"use strict";

// FINANCING MODULE (optional client field) — facts.financing { enabled, partner,
// apply_url, payment_methods }. A financing section renders ONLY when enabled
// is true AND an https apply_url is supplied; disabled, absent, or a non-https
// link renders nothing at all (a financing claim with a dead door is worse
// than none). Pinned here too: the facts boundary and the schema gate for the
// new object, and the never-lost-to-the-early-return wiring.

const test = require("node:test");
const assert = require("node:assert");

const { buildContentHtml, buildFinancingSection } = require("../lib/mirror-engine/content-inject");
const { validateFacts } = require("../lib/mirror-engine/facts");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");

const FACTS = {
  business_name: "Test Fence Co",
  industry: "fencing",
  city: "Denton",
  state: "TX",
};

const FINANCING = {
  enabled: true,
  partner: "Wisetack",
  apply_url: "https://apply.example.com/test-fence",
  payment_methods: ["Visa", "Mastercard", "Cash"],
};

const render = (over = {}, content = {}) => buildContentHtml({
  content: { services: ["Fence repair"], ...content },
  facts: { ...FACTS, ...over },
  phoneDigits: "",
  donorRenders: [],
});

// ---------------------------------------------------------------------------
// Conditional rendering: present
// ---------------------------------------------------------------------------

test("an enabled financing module with an https apply link renders the section + CTA", () => {
  const html = render({ financing: FINANCING });
  assert.match(html, /<section class="wss-c wss-fin" id="financing" aria-labelledby="wss-fin-h" data-wss-financing>/);
  assert.match(html, /<h2 id="wss-fin-h">Financing available<\/h2>/);
  assert.match(html, /financing through Wisetack/, "the partner is named in the copy");
  assert.match(html, /href="https:\/\/apply\.example\.com\/test-fence"/, "the apply CTA links the client's apply_url");
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, /Apply for financing/);
  for (const method of ["Visa", "Mastercard", "Cash"]) {
    assert.match(html, new RegExp(`>${method}</li>`), `payment method ${method} renders as a chip`);
  }
});

test("financing renders with NO partner and NO methods — the honest generic sentence", () => {
  const html = render({ financing: { enabled: true, apply_url: "https://apply.example.com/x" } });
  assert.match(html, /data-wss-financing/);
  assert.match(html, /<p>Spread the cost of your project — financing is available\.<\/p>/);
  assert.doesNotMatch(html, /wss-fin__methods/, "no empty method rail");
});

test("financing-only clients still get the section (never lost to the early return)", () => {
  const html = buildContentHtml({
    content: {},
    facts: { ...FACTS, financing: FINANCING },
    phoneDigits: "",
    donorRenders: [],
  });
  assert.ok(html.includes('id="financing"'), "a financing-only client renders the module");
});

// ---------------------------------------------------------------------------
// Conditional rendering: absent
// ---------------------------------------------------------------------------

test("absent, disabled, or doorless financing renders nothing", () => {
  const cases = [
    {},
    { financing: { ...FINANCING, enabled: false } },
    { financing: { enabled: true } }, // no apply_url
    { financing: { enabled: true, apply_url: "" } },
    { financing: { enabled: true, apply_url: "http://apply.example.com/insecure" } },
    { financing: { enabled: true, apply_url: "javascript:alert(1)" } },
    { financing: "yes" },
  ];
  for (const over of cases) {
    const html = render(over);
    assert.ok(!html.includes("data-wss-financing"), `${JSON.stringify(over)} must render no financing section`);
    assert.ok(!html.includes('id="financing"'), `${JSON.stringify(over)} must render no financing section`);
  }
});

test("payment methods are escaped and capped at eight", () => {
  const html = render({
    financing: { ...FINANCING, payment_methods: ["<script>x</script>", ...Array.from({ length: 20 }, (_, i) => `M${i}`)] },
  });
  // Scope to the financing section itself — the page legitimately carries
  // <script> tags for its own behaviour chrome.
  const start = html.indexOf('data-wss-financing');
  const section = html.slice(start, html.indexOf("</section>", start));
  assert.ok(!section.includes("<script>x"), "raw markup never reaches the method rail");
  assert.ok(section.includes("&lt;script&gt;x&lt;/script&gt;"), "method names are entity-escaped");
  assert.equal((section.match(/class="wss-t__chip"/g) || []).length, 8, "the method rail caps at eight chips");
});

// ---------------------------------------------------------------------------
// The facts boundary
// ---------------------------------------------------------------------------

test("validateFacts accepts and tidies a valid financing object", () => {
  const result = validateFacts({
    facts: { ...FACTS, financing: { enabled: true, partner: "  Wisetack ", apply_url: "https://apply.example.com/x", payment_methods: [" Visa ", ""] } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.facts.financing.partner, "Wisetack");
  assert.deepEqual(result.facts.financing.payment_methods, ["Visa"]);
});

test("validateFacts rejects wrong-shaped financing with named reasons", () => {
  const cases = [
    [{ financing: "financing" }, "financing_not_object"],
    [{ financing: ["x"] }, "financing_not_object"],
    [{ financing: { enabled: "true", apply_url: "https://x.example.com" } }, "financing_enabled_not_boolean"],
    [{ financing: { enabled: true, partner: 7, apply_url: "https://x.example.com" } }, "financing_partner_not_string"],
    [{ financing: { enabled: true, apply_url: "http://x.example.com" } }, "financing_apply_url_not_https"],
    [{ financing: { enabled: true, apply_url: "not a url" } }, "financing_apply_url_not_https"],
    [{ financing: { enabled: true, apply_url: "https://x.example.com", payment_methods: "Visa" } }, "payment_methods_not_array"],
    [{ financing: { enabled: true, apply_url: "https://x.example.com", payment_methods: [1] } }, "payment_method_not_string"],
    [{ financing: { enabled: true, apply_url: "https://x.example.com", payment_methods: Array.from({ length: 9 }, () => "M") } }, "payment_methods_too_many"],
    [{ financing: { enabled: true, apply_url: "https://x.example.com", teaser_rate: "0%" } }, "financing_unknown_field"],
  ];
  for (const [over, reason] of cases) {
    const result = validateFacts({ facts: { ...FACTS, ...over } });
    assert.equal(result.ok, false, `${JSON.stringify(over)} must fail`);
    assert.equal(result.error, "invalid_facts");
    assert.equal(result.detail[0].reason, reason, `${JSON.stringify(over)} -> ${reason}`);
  }
});

// ---------------------------------------------------------------------------
// The schema gate
// ---------------------------------------------------------------------------

test("checkMirrorRequest accepts a valid financing module", () => {
  const result = checkMirrorRequest({
    slug: "test-fence-co-denton",
    facts: { ...FACTS, financing: FINANCING },
  });
  assert.equal(result.ok, true, JSON.stringify(result.body || result));
});

test("checkMirrorRequest closes non-https apply URLs and unknown financing keys", () => {
  const base = { slug: "test-fence-co-denton", facts: { ...FACTS } };
  assert.equal(checkMirrorRequest({
    ...base,
    facts: { ...FACTS, financing: { enabled: true, apply_url: "http://apply.example.com/x" } },
  }).ok, false, "http apply links fail the schema (RequiredHttpsUri)");
  assert.equal(checkMirrorRequest({
    ...base,
    facts: { ...FACTS, financing: { enabled: true, apply_url: "https://x.example.com", nope: 1 } },
  }).ok, false, "unknown financing keys fail the closed object");
});
