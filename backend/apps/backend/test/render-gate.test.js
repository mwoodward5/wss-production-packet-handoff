"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FACTS,
  evaluateRenderGate,
  runRenderGate,
  assertGateIntegrity,
  schemaTypeFor,
} = require("../lib/render-gate");

// A clean Flint-shaped mirror: the client's own NAP, own vertical, own logo
// bytes, correct schema, no donor residue, no unbacked rating.
function goodDom(overrides = {}) {
  return {
    ok: true,
    url: "https://wss-test-flint.wss-ai.com/",
    status: 200,
    title: "Flint Plumbing — Buda, TX",
    innerText:
      "Flint Plumbing\nServing Austin and the surrounding area\n" +
      "Call (512) 555-0147\n123 Main St, Buda, TX 78610\n" +
      "Drain cleaning, water heater replacement and sewer repair.\n" +
      "Licensed plumbing contractor.",
    hrefs: ["/services", "tel:+15125550147"],
    imgs: [],
    logos: [{ src: "https://cdn/flint.png", sha256: "a".repeat(64), width: 120, height: 40, bytes: 4096 }],
    jsonld: [{ "@type": "Plumber", name: "Flint Plumbing" }],
    ...overrides,
  };
}

function goodSource(overrides = {}) {
  return {
    prospect_id: "flint_1",
    business_name: "Flint Plumbing",
    vertical: "plumbing",
    phone: "512-555-0147",
    postal_city: "Buda",
    logo_sha256: "a".repeat(64),
    donor_strings: ["Premier Plumbing Co", "(214) 555-9900", "premierplumbing.example"],
    ...overrides,
  };
}

test("a clean mirror passes all eight facts", () => {
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource() });
  assert.equal(verdict.pass, true, verdict.blockedBy);
  assert.equal(verdict.checks.length, FACTS.length);
  assert.deepEqual(verdict.failed, []);
});

test("an unrenderable page fails every fact — unverifiable is never verified", () => {
  for (const dom of [null, { ok: false, reason: "chromium_launch_failed" }, { ok: false, reason: "http_404" }]) {
    const verdict = evaluateRenderGate({ dom, source: goodSource() });
    assert.equal(verdict.pass, false);
    assert.equal(verdict.failed.length, FACTS.length, "a blind gate must fail all eight facts");
    assert.match(verdict.blockedBy, /render_unavailable/);
  }
});

test("NAP mismatch blocks and names the missing field", () => {
  const dom = goodDom({ title: "Flint Plumbing — Kyle, TX", innerText: goodDom().innerText.replace("Buda", "Kyle") });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failed.includes("nap_match"));
  const check = verdict.checks.find((c) => c.fact === "nap_match");
  assert.match(check.reason, /postal_city:Buda/);
});

test("marketing city can never stand in for the postal city", () => {
  // Flint markets as Austin and is postally in Buda. A page that renders only
  // the marketing city has NOT proven the postal address.
  const dom = goodDom({
    title: "Flint Plumbing — Austin, TX",
    innerText: "Flint Plumbing\nServing Austin\nCall (512) 555-0147\nDrain cleaning and sewer repair.",
  });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "nap_match").reason, /postal_city/);
});

test("a trade swap is caught: a fencing client shipping roofing copy", () => {
  const dom = goodDom({
    title: "Sterling Fence Co",
    innerText: "Sterling Fence Co\nBuda, TX\n(512) 555-0147\nCedar fence and gate installation.\nWe also install shingle roofing systems.",
    jsonld: [{ "@type": "HomeAndConstructionBusiness" }],
  });
  const verdict = evaluateRenderGate({
    dom,
    source: goodSource({ business_name: "Sterling Fence Co", vertical: "fencing" }),
  });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failed.includes("vertical_match"));
  assert.match(verdict.checks.find((c) => c.fact === "vertical_match").reason, /trade swap/);
});

test("vertical matching does not treat ink, slab, or detail inside other words as trades", () => {
  const dom = goodDom({
    title: "Slabaugh Fence Company",
    innerText: "Slabaugh Fence Company\nBuda, TX\n(512) 555-0147\nFence installation project details and service links.",
    jsonld: [{ "@type": "HomeAndConstructionBusiness" }],
  });
  const verdict = evaluateRenderGate({
    dom,
    source: goodSource({ business_name: "Slabaugh Fence Company", vertical: "fencing" }),
  });
  const vertical = verdict.checks.find((check) => check.fact === "vertical_match");
  assert.equal(vertical.pass, true, vertical.reason);
  assert.doesNotMatch(vertical.reason, /concrete:slab|auto detailing:detail|tattoo:ink/);
});

test("standalone foreign trade terms still fail the vertical gate", () => {
  const dom = goodDom({
    innerText: `${goodDom().innerText}\nConcrete slab, auto detailing, and tattoo ink services.`,
  });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  const vertical = verdict.checks.find((check) => check.fact === "vertical_match");
  assert.equal(vertical.pass, false);
  assert.match(vertical.reason, /concrete:concrete/);
  assert.match(vertical.reason, /auto detailing:auto detailing/);
  assert.ok(vertical.evidence.foreign.includes("tattoo:ink"));
});

test("a known shared concrete term is not a trade swap on a roofing page", () => {
  const dom = goodDom({
    title: "Ramon Roofing",
    innerText: "Ramon Roofing\nFort Worth\n(512) 555-0147\nConcrete tile and slate roofing systems.",
    jsonld: [{ "@type": "RoofingContractor" }],
  });
  const verdict = evaluateRenderGate({
    dom,
    source: goodSource({ business_name: "Ramon Roofing", postal_city: "Fort Worth", vertical: "roofing" }),
  });
  assert.equal(verdict.checks.find((check) => check.fact === "vertical_match").pass, true);
});

test("a known shared slab term is not a trade swap on a plumbing page", () => {
  const dom = goodDom({ innerText: `${goodDom().innerText}\nSlab leak detection and repair.` });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  assert.equal(verdict.checks.find((check) => check.fact === "vertical_match").pass, true);
});

test("a real client logo that is not rendered is still a FAIL", () => {
  const verdict = evaluateRenderGate({ dom: goodDom({ logos: [] }), source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "logo_own_and_unique").reason, /logoImgs=0/);
});

test("zero rendered fallback bytes fail closed even with the deliberate wordmark ladder rung", () => {
  // "No client logo" means no SOURCE logo is required — it never means the
  // engine may skip rendering the fallback mark. The engine always emits
  // /assets/brand-logo.svg, so a page with zero fetchable logo bytes is an
  // unverified build, not honest absence.
  const verdict = evaluateRenderGate({
    dom: goodDom({ logos: [] }),
    source: goodSource({
      logo_sha256: undefined,
      brand_mark: {
        rung: "wordmark",
        value: { type: "wordmark", text: "Flint Plumbing", color: "#123456" },
        reason: "no usable image fell to wordmark",
      },
    }),
  });
  const logo = verdict.checks.find((c) => c.fact === "logo_own_and_unique");
  assert.equal(logo.pass, false);
  assert.match(logo.reason, /unrendered is not verified/);
  assert.equal(verdict.pass, false);
});

test("the engine-owned wordmark SVG is the rendered fallback, not an unverified client logo", () => {
  const verdict = evaluateRenderGate({
    dom: goodDom({
      logos: [{ src: "https://wss-test-flint.wss-ai.com/assets/brand-logo.svg", sha256: "b".repeat(64) }],
    }),
    source: goodSource({
      logo_sha256: undefined,
      brand_mark: {
        rung: "wordmark",
        value: { type: "wordmark", text: "Flint Plumbing", color: "#123456" },
        reason: "no usable image fell to wordmark",
      },
    }),
  });
  const logo = verdict.checks.find((c) => c.fact === "logo_own_and_unique");
  assert.equal(logo.pass, true, logo.reason);
  assert.deepEqual(logo.evidence, { fallback: true, rung: "wordmark", sha256: "b".repeat(64) });
  assert.equal(verdict.pass, true, verdict.blockedBy);
});

test("a foreign host cannot spoof the engine-owned fallback pathname", () => {
  const verdict = evaluateRenderGate({
    dom: goodDom({
      logos: [{ src: "https://attacker.example/assets/brand-logo.svg", sha256: "b".repeat(64) }],
    }),
    source: goodSource({
      logo_sha256: undefined,
      brand_mark: {
        rung: "wordmark",
        value: { type: "wordmark", text: "Flint Plumbing", color: "#123456" },
        reason: "no usable image fell to wordmark",
      },
    }),
  });
  assert.equal(verdict.checks.find((c) => c.fact === "logo_own_and_unique").pass, false);
  assert.equal(verdict.pass, false);
});

test("a fallback mark never excuses an unverified rendered logo", () => {
  const verdict = evaluateRenderGate({
    dom: goodDom({ logos: [{ src: "https://cdn/other.png", sha256: "b".repeat(64) }] }),
    source: goodSource({
      logo_sha256: undefined,
      brand_mark: {
        rung: "wordmark",
        value: { type: "wordmark", text: "Flint Plumbing", color: "#123456" },
        reason: "no usable image fell to wordmark",
      },
    }),
  });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "logo_own_and_unique").reason, /no verified client logo hash/);
});

test("a rendered logo whose bytes are not this client's logo is a FAIL", () => {
  const dom = goodDom({ logos: [{ src: "https://cdn/other.png", sha256: "b".repeat(64), width: 120, height: 40 }] });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "logo_own_and_unique").reason, /not this client's logo/);
});

test("the same logo cannot ship for two clients", () => {
  const seen = new Map([["a".repeat(64), "someone_else"]]);
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource(), seenLogoShas: seen });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "logo_own_and_unique").reason, /already shipped for someone_else/);
});

test("entity residue a visitor can read is a FAIL", () => {
  const dom = goodDom({ innerText: goodDom().innerText.replace("and sewer repair", "&#038; Tunneling Repair") });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failed.includes("entity_residue_zero"));
});

test("the wrong schema @type blocks the row", () => {
  const verdict = evaluateRenderGate({ dom: goodDom({ jsonld: [{ "@type": "RoofingContractor" }] }), source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "schema_type").reason, /expected Plumber/);
  // schema.org has no FenceContractor type; HomeAndConstructionBusiness is the
  // schema.org-valid type a fence contractor publishes.
  assert.equal(schemaTypeFor("fencing"), "HomeAndConstructionBusiness");
});

test("no JSON-LD at all is a FAIL, not a pass by absence", () => {
  const verdict = evaluateRenderGate({ dom: goodDom({ jsonld: [] }), source: goodSource() });
  assert.ok(verdict.failed.includes("schema_type"));
});

test("a donor phone number surviving into the live page is caught", () => {
  const dom = goodDom({ innerText: `${goodDom().innerText}\nEmergency line (214) 555-9900` });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "donor_leak_zero").reason, /donor identity leaked/);
});

test("not knowing the donor fingerprint is a FAIL, not an absence of evidence", () => {
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource({ donor_strings: [] }) });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "donor_leak_zero").reason, /cannot prove/);
});

test("AggregateRating without a verified rating AND count is blocked", () => {
  const dom = goodDom({ jsonld: [{ "@type": "Plumber", aggregateRating: { "@type": "AggregateRating", ratingValue: 4.9, reviewCount: 132 } }] });
  const verdict = evaluateRenderGate({ dom, source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "aggregate_rating_backed").reason, /no verified rating AND count/);
});

test("AggregateRating that disagrees with the verified numbers is blocked", () => {
  const dom = goodDom({ jsonld: [{ "@type": "Plumber", aggregateRating: { "@type": "AggregateRating", ratingValue: 5, reviewCount: 900 } }] });
  const verdict = evaluateRenderGate({ dom, source: goodSource({ rating_value: 4.7, rating_count: 132 }) });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "aggregate_rating_backed").reason, /does not match verified/);
});

test("omitting an unverifiable rating is always allowed", () => {
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource() });
  assert.equal(verdict.checks.find((c) => c.fact === "aggregate_rating_backed").pass, true);
});

test("an unverified certification published on the page is blocked", () => {
  const dom = goodDom({ innerText: `${goodDom().innerText}\nGAF Master Elite Certified` });
  const verdict = evaluateRenderGate({ dom, source: goodSource({ unverified_claims: ["GAF Master Elite"] }) });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "unverified_claims_omitted").reason, /unverified claim published/);
});

test("runRenderGate refuses without a URL and never calls the reader", async () => {
  let called = false;
  const verdict = await runRenderGate({ url: "", source: goodSource(), reader: async () => { called = true; return goodDom(); } });
  assert.equal(called, false);
  assert.equal(verdict.pass, false);
  assert.match(verdict.blockedBy, /no_preview_url/);
});

test("the gate self-check proves it still fails closed", () => {
  assert.deepEqual(assertGateIntegrity(), { ok: true, facts: FACTS.length });
});

test("there is no flag on the gate that turns a fact off", () => {
  // Read the CODE, not the prose. The file's own doc comment says the words
  // "no options.skip and no options.force", and a naive regex over the whole
  // file matched that sentence — a check that passes or fails on documentation
  // is exactly the vacuous gate this module exists to replace.
  const raw = require("node:fs").readFileSync(require.resolve("../lib/render-gate.js"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  assert.doesNotMatch(code, /options\.(skip|force|bypass)/);
  assert.doesNotMatch(code, /process\.env\.[A-Z_]*(SKIP|DISABLE|BYPASS)[A-Z_]*/);
  // And the behavioural proof, which no comment can fake: a blind gate fails
  // EVERY fact. Counted off FACTS rather than a literal, so adding a fact never
  // turns this into a chore that gets "fixed" by lowering the number.
  assert.ok(FACTS.length >= 8, "facts are only ever added, never quietly removed");
  assert.equal(evaluateRenderGate({ dom: null, source: {} }).failed.length, FACTS.length);
});

// ---------------------------------------------------------------------------
// THE CLIENT'S OWN NAME IS NOT A TRADE SWAP
// ---------------------------------------------------------------------------
// Measured on two live mirrors, 2026-08-08. "Plumbing Today HVAC" was refused
// for hvac:hvac and "Paschal Air, Plumbing & Electric" for electrical:electric;
// in both cases EVERY convicting occurrence was the business's own verified
// legal name printed in the header ticker, the socials heading, the footer and
// the quote panel. "Eyman Plumbing Heating & Air" passed and shipped on the
// identical profile, only because "Heating & Air" happens to contain no term in
// the hvac list. Whether we published was being decided by spelling.

test("a multi-word business name is not itself proof of a trade swap", () => {
  // The exact shape of the live Omaha mirror: the name in the title and printed
  // four more times in donor chrome, and nowhere else does the page say "hvac".
  const name = "Plumbing Today HVAC";
  const dom = goodDom({
    title: `${name} — Buda, TX`,
    innerText:
      `${name}\nServing Austin and the surrounding area\n` +
      "Call (512) 555-0147\n123 Main St, Buda, TX 78610\n" +
      `Drain cleaning, water heater replacement and sewer repair.\nLicensed plumbing contractor.\n${name}`,
    // Over DONOR_SURFACE_FLOOR, so the scan really reads the donor surface
    // rather than falling back to the whole page.
    donorText: `${name} ${name} ${name} Call (512) 555-0147 for same-day service across the metro area. `
      + `Licensed plumbing contractor serving homeowners and businesses since 1994. ${name}`,
  });
  const verdict = evaluateRenderGate({ dom, source: goodSource({ business_name: name }) });
  const vertical = verdict.checks.find((c) => c.fact === "vertical_match");
  assert.equal(vertical.pass, true, vertical.reason);
  assert.equal(vertical.evidence.judged, "donor_surface");
  // Consecutive copies matter: the ticker prints the name twice in a row and an
  // exemption that consumed the shared separator would only lift the first.
  // Four in the donor surface plus the one in the title.
  assert.equal(vertical.evidence.own_name_removed, 5);
});

test("the name exemption lifts the NAME, never the words in it", () => {
  // Same client, same name — but the donor surface also says "hvac" somewhere
  // that is NOT the business name. That is a real swap and must still block.
  const name = "Plumbing Today HVAC";
  const dom = goodDom({
    title: `${name} — Buda, TX`,
    innerText: `${name}\nCall (512) 555-0147\nBuda, TX\nDrain cleaning and sewer repair.\nOur hvac technicians install furnace systems.`,
    donorText: `${name} Our hvac technicians install furnace systems.`,
  });
  const verdict = evaluateRenderGate({ dom, source: goodSource({ business_name: name }) });
  const vertical = verdict.checks.find((c) => c.fact === "vertical_match");
  assert.equal(vertical.pass, false);
  assert.match(vertical.reason, /hvac:hvac/);
});

test("the exemption is EARNED: a name that never claims our trade earns nothing", () => {
  // THE HOLE A BLANKET EXEMPTION WOULD OPEN, and the reason this condition
  // exists. Redeemed HVAC and Bruce Thornton Air Conditioning were both mined
  // under a plumbing target and built on the plumbing donor with @type Plumber.
  // Their names say nothing about plumbing, so lifting the name would have let
  // an air-conditioning company ship as a plumber with the one check that
  // catches it switched off. Measured: 4 of the 31 name-collision businesses in
  // the store are in this class.
  const name = "Bruce Thornton Air Conditioning";
  const dom = goodDom({
    title: `${name} — Buda, TX`,
    innerText: `${name}\nCall (512) 555-0147\nBuda, TX\nDrain cleaning, water heater replacement and sewer repair.`,
    donorText: `${name} Call (512) 555-0147`,
  });
  const verdict = evaluateRenderGate({ dom, source: goodSource({ business_name: name }) });
  const vertical = verdict.checks.find((c) => c.fact === "vertical_match");
  assert.equal(vertical.pass, false, "a wrong-lane business must not be rescued by its own name");
  assert.match(vertical.reason, /hvac:air conditioning/);
  assert.equal(vertical.evidence.own_name_removed, undefined);
});

test("the original donor-copy swap is still caught with the client's name supplied", () => {
  // The incident the whole check exists for: a roofing donor's copy shipped on
  // a fencing page. Unchanged by the exemption.
  const dom = goodDom({
    title: "Sterling Fence Co — Buda, TX",
    innerText: "Sterling Fence Co\nBuda, TX\n(512) 555-0147\nCedar fence and gate installation.\nWe also install shingle roofing systems.",
    jsonld: [{ "@type": "HomeAndConstructionBusiness" }],
  });
  const verdict = evaluateRenderGate({
    dom,
    source: goodSource({ business_name: "Sterling Fence Co", vertical: "fencing" }),
  });
  assert.equal(verdict.checks.find((c) => c.fact === "vertical_match").pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "vertical_match").reason, /roofing:/);
});
