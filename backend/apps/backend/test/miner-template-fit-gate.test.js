"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { templateFitAdmission } = require("../lib/lead-miner");
const { ALL_TRADES_VERTICAL_ORDER } = require("../lib/line-quota");

function fit(overrides = {}) {
  return templateFitAdmission({
    trigger: "operator_line",
    targetVertical: "plumbing",
    businessName: "Precision Home Services",
    ldNodes: [{ "@type": "LocalBusiness" }],
    serviceNames: ["Drain cleaning", "Pipe leak repair"],
    html: "<main>Local service business</main>",
    ...overrides,
  });
}

test("HVAC first-party evidence cannot enter the plumbing template", () => {
  const result = fit({
    businessName: "Comfort Air Services",
    ldNodes: [{ "@type": "HVACBusiness" }],
    serviceNames: ["Air conditioning repair", "Furnace installation", "Heat pump service"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "template_family_fit_below_threshold");
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].check, "first_party_template_family_fit");
  assert.equal(result.problems[0].actual.targetFamily, "plumbing");
  assert.equal(JSON.stringify(result.problems).includes("Comfort Air Services"), false);
});

test("template-family admission pins the 79 percent fail and 80 percent pass boundary", () => {
  const plumbing = (count) => Array.from({ length: count }, (_, i) => `Drain cleaning ${i}`);
  const hvac = (count) => Array.from({ length: count }, (_, i) => `Furnace repair ${i}`);

  const below = fit({ serviceNames: [...plumbing(79), ...hvac(21)] });
  assert.equal(below.ok, false);
  assert.equal(below.problems[0].actual.share, 0.79);

  const boundary = fit({ serviceNames: [...plumbing(80), ...hvac(20)] });
  assert.equal(boundary.ok, true);
  assert.equal(boundary.share, 0.8);
  assert.equal(boundary.corroboratingServiceSignals, 80);
});

test("product nursery with Store/Product schema and checkout flow is refused", () => {
  const result = fit({
    targetVertical: "landscaping",
    businessName: "Green Valley Nursery",
    ldNodes: [{
      "@type": "Store",
      makesOffer: [{ itemOffered: { "@type": "Product", name: "Shade tree" } }],
    }],
    serviceNames: ["Garden planning"],
    html: '<main><a href="/catalog">Product catalog</a><button>Add to cart</button><a href="/checkout">Checkout</a></main>',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "product_dominant_site");
  assert.equal(result.problems[0].check, "product_vs_service_evidence");
  assert.ok(result.problems[0].actual.productEvidence > result.problems[0].actual.serviceEvidence);
});

test("plumber repair business remains eligible when it also sells fixtures", () => {
  const result = fit({
    businessName: "Reliable Plumbing",
    ldNodes: [{ "@type": "Plumber" }, { "@type": "Product", name: "Kitchen faucet" }],
    serviceNames: [
      "Drain cleaning",
      "Pipe leak repair",
      "Water heater repair",
      "Toilet installation",
      "Fixture sales",
    ],
    html: '<main><h2>Plumbing repairs</h2><a href="/cart">Add fixture to cart</a><a href="/checkout">Checkout</a></main>',
  });

  assert.equal(result.ok, true);
  assert.equal(result.targetFamily, "plumbing");
  assert.ok(result.corroboratingServiceSignals >= 2);
  assert.ok(result.serviceEvidence >= result.productEvidence);
});

test("target-identified service business with two proven services may also run a product store", () => {
  const result = fit({
    businessName: "Reliable Home Services",
    ldNodes: [
      { "@type": "Plumber" },
      { "@type": "Store" },
      { "@type": "Product", name: "Kitchen faucet" },
    ],
    serviceNames: ["Drain cleaning", "Pipe leak repair"],
    html: '<main><h2>Plumbing repairs</h2><a href="/cart">Shopping cart</a><button>Add to cart</button><a href="/checkout">Checkout</a></main>',
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.share, 1);
  assert.equal(result.corroboratingServiceSignals, 2);
  assert.ok(result.targetIdentitySignals >= 1);
  assert.ok(result.productEvidence > result.serviceEvidence);
});

test("schema-free product shop cannot pass product labels off as services", () => {
  const result = fit({
    targetVertical: "landscaping",
    businessName: "Green Valley Nursery",
    ldNodes: [{ "@type": "LocalBusiness" }],
    serviceNames: ["Garden supplies", "Lawn fertilizer"],
    html: '<main><h2>Product catalog</h2><a href="/products">Shop our products</a><a href="/cart">Shopping cart</a><button>Add to cart</button><a href="/checkout">Checkout</a></main>',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "product_dominant_site");
  assert.equal(result.problems[0].actual.productSchemaSignals, 0);
  assert.equal(result.problems[0].actual.targetIdentitySignals, 0);
  assert.equal(result.problems[0].actual.corroboratingServiceSignals, 2);
});

test("the gate is inert outside operator-line mining", () => {
  const result = fit({
    trigger: "manual_exact",
    serviceNames: [],
    ldNodes: [{ "@type": "Store" }, { "@type": "Product" }],
    html: "Add to cart. Checkout. Product catalog.",
  });
  assert.deepEqual(result, { ok: true, skipped: true, reason: "not_operator_line" });
});

test("every automatic All Trades vertical resolves to its intended template family", () => {
  const expected = {
    plumbing: ["plumbing", ["Drain cleaning", "Water heater repair"]],
    hvac: ["hvac", ["Furnace repair", "Air conditioning installation"]],
    fencing: ["fencing", ["Fence installation", "Decking installation"]],
    concrete: ["concrete", ["Concrete flatwork", "Masonry repair"]],
    electrical: ["electrical", ["Electrical rewiring", "Panel upgrade"]],
    "general contractor": ["construction", ["Custom carpentry", "Home framing"]],
    landscaping: ["landscaping", ["Tree removal", "Stump grinding"]],
    roofing: ["roofing", ["Roof repair", "Shingle installation"]],
    "med spa": ["med_spa", ["Botox treatment", "Dermal filler"]],
    salon: ["salon", ["Hair salon styling", "Haircut service"]],
    tattoo: ["tattoo", ["Custom tattoo", "Body piercing"]],
  };

  assert.deepEqual([...ALL_TRADES_VERTICAL_ORDER].sort(), Object.keys(expected).sort());
  for (const vertical of ALL_TRADES_VERTICAL_ORDER) {
    const [family, serviceNames] = expected[vertical];
    const result = fit({ targetVertical: vertical, serviceNames });
    assert.equal(result.ok, true, vertical);
    assert.equal(result.targetFamily, family, vertical);
  }
});

test("explicit real estate remains family-gated while excluded from automatic All Trades", () => {
  assert.equal(ALL_TRADES_VERTICAL_ORDER.includes("real estate agent"), false);
  const result = fit({
    targetVertical: "real estate agent",
    serviceNames: ["Property listing services", "Home sales representation"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.targetFamily, "real_estate");
});

test("deck and decking evidence belongs to the fencing template family", () => {
  const result = fit({
    targetVertical: "decking",
    serviceNames: ["Deck installation", "Fence installation"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.targetFamily, "fencing");
  assert.equal(result.share, 1);
});
