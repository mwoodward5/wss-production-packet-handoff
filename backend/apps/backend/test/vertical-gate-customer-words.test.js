"use strict";

// ---------------------------------------------------------------------------
// THE TRADE-SWAP GATE MUST JUDGE OUR WORDS, NOT THE CUSTOMER'S
// ---------------------------------------------------------------------------
// A real ten-lead run mirrored 10/10 and queued 4. Four of the six refusals
// convicted a plumber of being the wrong trade using that plumber's own
// published words. Every fixture in this file is the REAL rendered text of
// those live mirrors, captured by lib/render-gate.js's own reader — not a
// paraphrase of it. See test/fixtures/vertical-gate-real-mirrors.json.
//
// The other half of the file is the part that matters more: the gate still has
// to refuse a genuinely wrong-trade donor, which has happened and burned a
// build. Every loosening here is paired with the proof that it did not open
// that door.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  checkVertical,
  donorSurfaceText,
  evaluateRenderGate,
  assertGateIntegrity,
  DONOR_SURFACE_FLOOR,
  FACTS,
} = require("../lib/render-gate");
const { inferTrade } = require("../lib/trade-inference");

const REAL = require("./fixtures/vertical-gate-real-mirrors.json");

function realDom(host) {
  const f = REAL.hosts[host];
  assert.ok(f, `fixture missing for ${host}`);
  return { ok: true, url: `https://${host}.wss-ai.com/`, status: 200, ...f };
}

/** The same DOM as the gate saw it BEFORE this change: no donor surface, so
 *  the scan falls back to the whole page — reviews, service list and all. */
function asBeforeThisChange(dom) {
  return { ...dom, donorText: "" };
}

// The four casualties, each with the exact word that refused it and the source
// of that word on the live page.
const CASUALTIES = [
  {
    host: "wss-test-tn-plumbing-solutions-murfreesboro",
    name: "TN Plumbing Solutions",
    convictedBy: /concrete:concrete/,
    // Google review: "Two days of cutting through concrete in the heat"
    customerWord: "concrete",
    where: "third-party review",
  },
  {
    host: "wss-test-fix-it-all-plumbing-llc-green-hill",
    name: "Fix It All Plumbing LLC",
    convictedBy: /concrete:driveway/,
    // Google review: "options for our driveway repair"
    customerWord: "driveway",
    where: "third-party review",
  },
  {
    host: "wss-test-america-s-plumbing-company-sacramento",
    name: "America's Plumbing Company",
    convictedBy: /landscaping:irrigation/,
    // Their OWN service list, card 07: "Drip Irrigation". NOT a verbatim block —
    // which is why excluding [data-wss-verbatim] alone would not have saved it.
    customerWord: "irrigation",
    where: "the client's own service list",
  },
  {
    host: "wss-test-platero-parada-plumbing-llc-sacramento",
    name: "Platero Parada Plumbing LLC",
    convictedBy: /hvac:heat pump/,
    // Google review: "replace it to heat pump electric"
    customerWord: "heat pump",
    where: "third-party review",
  },
];

for (const c of CASUALTIES) {
  test(`${c.name}: "${c.customerWord}" in ${c.where} no longer convicts the mirror`, () => {
    const dom = realDom(c.host);
    const source = { vertical: "plumbing", business_name: c.name };

    // 1. The refusal was real. Reproduce it on the same bytes.
    const before = checkVertical(asBeforeThisChange(dom), source);
    assert.equal(before.pass, false, "fixture no longer reproduces the original refusal");
    assert.match(before.reason, c.convictedBy);

    // 2. The customer's word is genuinely on the page — this is not a fix that
    //    works by the word having gone away. It is still rendered, still read
    //    by a visitor, still counted by every other fact.
    assert.ok(
      dom.innerText.toLowerCase().includes(c.customerWord),
      "the customer's own word must still be rendered on the page",
    );

    // 3. And it is NOT in the donor surface, because the customer wrote it.
    assert.ok(
      !dom.donorText.toLowerCase().includes(c.customerWord),
      "the customer's word must not appear in the copy WE wrote",
    );

    // 4. So the gate passes.
    const after = checkVertical(dom, source);
    assert.equal(after.pass, true, after.reason);
    assert.equal(after.evidence.judged, "donor_surface");
  });
}

test("the four casualties all still prove they are plumbers", () => {
  for (const c of CASUALTIES) {
    const verdict = checkVertical(realDom(c.host), { vertical: "plumbing", business_name: c.name });
    assert.ok(
      verdict.evidence.ownTermsFound.includes("plumbing"),
      `${c.name} must still show its own trade language`,
    );
  }
});

// ---------------------------------------------------------------------------
// THE GATE STILL WORKS. This is the half that must never be traded away.
// ---------------------------------------------------------------------------

test("a real HVAC company on a plumbing donor is STILL refused", () => {
  // The defect this gate exists for, in the exact shape that burned a build:
  // the donor is a plumber's template, the client is an HVAC company. The
  // plumbing language is in the DONOR SURFACE — headline, nav, service tiles —
  // which is where a wrong template puts it, and where this gate still looks.
  const donorChrome = [
    "Coldfront Mechanical",
    "Bridgeport, CT · (203) 555-0148",
    "24/7 Emergency Plumbing Services",
    "Drain cleaning, sewer line repair, water heater installation and repiping.",
    "Our licensed plumbers arrive stocked and ready.",
    "Trusted plumbing contractor since 1998.",
  ].join("\n");
  const dom = {
    ok: true,
    url: "https://wss-test-coldfront-mechanical.wss-ai.com/",
    status: 200,
    title: "Coldfront Mechanical — Heating and Air Conditioning",
    // The client's own HVAC content is injected below the donor chrome.
    innerText: `${donorChrome}\nFurnace tune-ups, air conditioning repair and duct sealing for Bridgeport homes.`,
    donorText: donorChrome,
  };
  const verdict = checkVertical(dom, { vertical: "hvac", business_name: "Coldfront Mechanical" });
  assert.equal(verdict.pass, false, "a plumbing donor under an HVAC client must be refused");
  assert.match(verdict.reason, /trade swap/);
  assert.match(verdict.reason, /plumbing:/);
  assert.equal(verdict.evidence.judged, "donor_surface");
});

test("a wrong-trade donor is refused even when the client's own reviews are clean", () => {
  // The mirror image of the four casualties: the foreign language is OURS, and
  // the customer's verbatim words are innocent. Excluding the customer must not
  // launder the donor.
  const dom = {
    ok: true,
    url: "https://wss-test-swap.wss-ai.com/",
    status: 200,
    title: "Gold Standard Roofing",
    innerText: "Gold Standard Roofing\nManicure, pedicure and nail art appointments booked daily.\nGreat people, showed up on time and cleaned up after themselves.",
    donorText: "Gold Standard Roofing\nManicure, pedicure and nail art appointments booked daily.",
  };
  const verdict = checkVertical(dom, { vertical: "roofing", business_name: "Gold Standard Roofing" });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /salon:/);
});

test("a foreign term in BOTH a review and our own copy still convicts", () => {
  // Being quoted by a customer is not immunity. If the word is also in the
  // donor surface, the donor surface is what answers for it.
  const dom = {
    ok: true,
    url: "https://wss-test-both.wss-ai.com/",
    status: 200,
    title: "Flint Plumbing",
    innerText: "Flint Plumbing\nWe pour concrete driveways and patios.\nDrain and sewer work too.\nThey cut through concrete to reach the line.",
    donorText: "Flint Plumbing\nWe pour concrete driveways and patios.\nDrain and sewer work too.",
  };
  const verdict = checkVertical(dom, { vertical: "plumbing", business_name: "Flint Plumbing" });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /concrete:/);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED. A carve-out that can silently swallow the page is a false PASS
// waiting to happen, and a false PASS is the one thing this file forbids.
// ---------------------------------------------------------------------------

test("no donor surface captured falls back to the whole page, not to a pass", () => {
  const dom = {
    ok: true,
    title: "Flint Plumbing",
    innerText: "Flint Plumbing\nDrain and sewer repair.\nWe also install fence and chain link gates.",
    // donorText absent entirely — an older reader, or a scrape that failed.
  };
  const scope = donorSurfaceText(dom);
  assert.equal(scope.scope, "whole_page:donor_surface_not_captured");
  const verdict = checkVertical(dom, { vertical: "plumbing" });
  assert.equal(verdict.pass, false, "an uncaptured donor surface must not become a free pass");
  assert.match(verdict.reason, /fencing:/);
});

test("a donor surface that collapsed to almost nothing falls back to the whole page", () => {
  const dom = {
    ok: true,
    title: "Flint Plumbing",
    innerText: "Flint Plumbing\nDrain and sewer repair.\nWe also install fence and chain link gates for the yard.",
    donorText: "Flint",
  };
  const scope = donorSurfaceText(dom);
  assert.equal(scope.scope, "whole_page:donor_surface_too_small");
  const verdict = checkVertical(dom, { vertical: "plumbing" });
  assert.equal(verdict.pass, false);
  assert.match(verdict.reason, /fencing:/);
  assert.equal(verdict.evidence.judged, "whole_page:donor_surface_too_small");
});

test("the fallback floor is a real threshold, and the real mirrors clear it easily", () => {
  assert.ok(DONOR_SURFACE_FLOOR >= 200, "the floor must be large enough to catch a collapsed scrape");
  for (const host of Object.keys(REAL.hosts)) {
    const donor = REAL.hosts[host].donorText;
    assert.ok(
      donor.trim().length > DONOR_SURFACE_FLOOR * 4,
      `${host} donor surface is ${donor.trim().length} chars — suspiciously close to the floor`,
    );
    // and it is a genuine subset: the exclusion removed real client content.
    assert.ok(
      donor.length < REAL.hosts[host].innerText.length,
      `${host} donor surface should be smaller than the whole page`,
    );
  }
});

test("assertGateIntegrity now proves the swap detector is still armed", () => {
  // The runtime self-check the line runs before it starts. It fails the whole
  // run if checkVertical is ever loosened into always-passing.
  assert.deepEqual(assertGateIntegrity(), { ok: true, facts: FACTS.length });
});

// ---------------------------------------------------------------------------
// THE MULTI-TRADE VERDICT IS MADE ON THE FACTS AND IS UNTOUCHED
// (Since 2026-08-20 the verdict picks the LEAD-trade donor instead of
// refusing — but the INFERENCE itself must stay sharp either way.)
// ---------------------------------------------------------------------------

test("a business whose OWN services span two trades still gets a multi-trade verdict", () => {
  // That judgement is made on the FACTS, upstream, by lib/trade-inference.js —
  // never by reading a rendered page. Nothing in this change goes near it, and
  // this test exists so that stays true.
  const verdict = inferTrade({
    business_name: "Complete Plumbing & Electric",
    services: [
      { name: "Drain cleaning" }, { name: "Water heater replacement" }, { name: "Sewer line repair" },
      { name: "Panel upgrade" }, { name: "Electrical wiring" }, { name: "Breaker replacement" },
    ],
  });
  assert.equal(verdict.multiTrade, true, `expected a multi-trade verdict, got ${JSON.stringify(verdict)}`);
  assert.deepEqual(verdict.secondary, ["plumbing"]);

  // And the four casualties are NOT multi-trade — the words that refused them
  // were a customer's, never a second trade of their own. This is the line
  // between the bug that was fixed and the rule that was kept.
  const americas = inferTrade({
    business_name: "America's Plumbing Company",
    services: [
      { name: "Emergency Plumbing" }, { name: "Bathroom Plumbing" }, { name: "Toilet Repair" },
      { name: "Faucet Repair and Replacement" }, { name: "Drip Irrigation" },
    ],
  });
  assert.equal(americas.trade, "plumbing");
  assert.equal(americas.multiTrade, false, `one irrigation line does not make a landscaper: ${JSON.stringify(americas.scores)}`);
});

test("the whole gate still refuses a mirror whose vertical is not an approved trade", () => {
  const verdict = evaluateRenderGate({
    dom: realDom("wss-test-tn-plumbing-solutions-murfreesboro"),
    source: { vertical: "wedding photography", business_name: "TN Plumbing Solutions" },
  });
  assert.equal(verdict.pass, false);
  assert.match(verdict.checks.find((c) => c.fact === "vertical_match").reason, /not an approved vertical/);
});
