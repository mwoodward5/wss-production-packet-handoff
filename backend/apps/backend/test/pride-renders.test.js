"use strict";
// THE PRIDE BLOCK REACHES THE PAGE.
//
// lib/owner-pride.js shipped with its renderer unwritten: the block was
// computed on every build and thrown away except for the tagline, so the
// motto, the maintenance plans with their real prices, the Daikin
// relationship, the licence number, the promotions and the twelve-city
// footprint — the exact list the owner-behind audit found missing from two
// rebuilds — never appeared on a single mirror. These tests pin the wiring and
// the refusals, and they read the EMITTED MARKUP rather than the request.

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { prideFromExtraction } = require("../lib/owner-pride");
const { buildContentHtml } = require("../lib/mirror-engine/content-inject");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { composeIdentityCopy } = require("../lib/mirror-engine/identity-copy");

const AIR = require(path.join(__dirname, "..", "..", "..", "docs", "owner-behind", "air-creation-extraction.json"));
const PRIDE = prideFromExtraction(AIR, { clientDomain: "aircreationheatingandcooling.com" });

const FACTS = {
  business_name: "Air Creation Heating & Cooling, LLC",
  industry: "hvac",
  city: "Gonzales",
  state: "LA",
  phone: "+12252220000",
  website: "https://www.aircreationheatingandcooling.com/",
};

const render = (over = {}) => buildContentHtml({
  content: { pride: PRIDE, ...over },
  facts: FACTS,
  phoneDigits: "2252220000",
  donorRenders: [],
});

test("their real plans reach the page with their real prices", () => {
  const html = render();
  assert.match(html, /Silver Plan/);
  assert.match(html, /\$22\.95 per system per month/);
  assert.match(html, /Gold Plan/);
  assert.match(html, /\$29\.95 per system per month/);
  assert.match(html, /data-wss-pride="plan"/);
});

test("the licence number and the manufacturer relationship are published as CREDENTIALS", () => {
  const html = render();
  assert.match(html, /License #56179/);
  assert.match(html, /Daikin/);
  assert.match(html, /data-wss-pride="credential"/);
});

test("a manufacturer badge hosted by the manufacturer never becomes an image", () => {
  // The incident this guard exists for: live mirrors served Mastercool's and
  // Google Blogger's marks as the client's own identity with every gate green.
  // owner-pride blanks an off-domain badge; the renderer re-checks, because the
  // request is caller input and a caller can hand us anything.
  const forged = {
    schema: "owner-pride-v1",
    sections: {
      credentials: [
        { kind: "credential", label: "Authorized Daikin Dealer", image: "https://daikin.com/badge.png" },
        { kind: "credential", label: "Authorized Trane Dealer", image: "https://www.aircreationheatingandcooling.com/img/trane.png" },
      ],
    },
  };
  const html = buildContentHtml({
    content: { pride: forged }, facts: FACTS, phoneDigits: "2252220000", donorRenders: [],
  });
  assert.ok(!html.includes("daikin.com/badge.png"), "a manufacturer-hosted mark must stay text-only");
  assert.match(html, /Authorized Daikin Dealer/, "the credential still renders — as words");
  assert.match(html, /aircreationheatingandcooling\.com\/img\/trane\.png/, "the client's own asset may render");
});

test("the twelve-city footprint survives, and is not printed twice", () => {
  const all = render();
  assert.match(all, /Prairieville/);
  assert.match(all, /Ascension Parish/);
  const cityCount = (all.match(/data-wss-pride="city"/g) || []).length;
  assert.equal(cityCount, 12, "all twelve towns");

  // A town the coverage section already lists is dropped from the pride block.
  const deduped = buildContentHtml({
    content: { pride: PRIDE, areas: ["Prairieville", "Zachary"] },
    facts: FACTS, phoneDigits: "2252220000", donorRenders: [],
  });
  assert.equal((deduped.match(/data-wss-pride="city"/g) || []).length, 10);
  // The extraction writes "Prairieville, LA" and coverage writes
  // "Prairieville" — deduped on the TOWN, so the pride footprint does not
  // repeat it. Other truthful prose may still name the declared service area.
  assert.match(deduped, /<ul class="wss-c__areas"><li>Prairieville<\/li><li>Zachary<\/li><\/ul>/, "listed in coverage");
  assert.doesNotMatch(deduped, /data-wss-pride="city">Prairieville(?:,\s*LA)?<\/li>/, "not repeated in the pride footprint");
});

test("a page with no pride block renders exactly as before", () => {
  const withOut = buildContentHtml({
    content: { services: [{ name: "AC Repair" }, { name: "Heating" }, { name: "Ductwork" }] },
    facts: FACTS, phoneDigits: "2252220000", donorRenders: [],
  });
  assert.ok(!withOut.includes("data-wss-pride"), "no pride data, no pride markup");
  assert.match(withOut, /AC Repair/);
});

test("auditor commentary and bare booleans never reach the page", () => {
  const html = render();
  // Three of Air Creation's six differentiators arrive as the string "true"
  // and one carries "no explicit 24/7 promise" — a note about what the auditor
  // could NOT find, written in our voice about their site.
  assert.ok(!/>true</.test(html), "a bare boolean is not a differentiator");
  assert.ok(!/no explicit/i.test(html), "absence notes are not client copy");
  assert.ok(!/no lender/i.test(html), "neither is the financing footnote");
  assert.match(html, /Clear upfront pricing/, "the claim the boolean was making, in words");
});

test("the request schema accepts a real pride block and rejects a malformed one", () => {
  const base = {
    slug: "wss-test-air-creation",
    donor: "hvac-premier",
    facts: {
      business_name: FACTS.business_name, industry: "hvac", city: "Gonzales",
      state: "LA", phone: "+1 225 222 0000",
    },
    brand: { logo: "https://www.aircreationheatingandcooling.com/logo.png" },
  };
  const good = checkMirrorRequest({ ...base, content: { pride: PRIDE } });
  assert.equal(good.ok, true, JSON.stringify(good.body || {}).slice(0, 400));

  const bad = checkMirrorRequest({
    ...base,
    content: { pride: { sections: { plans: [{ name: "Silver Plan" }] } } },
  });
  assert.equal(bad.ok, false, "a plan without its price is not a plan we print");
});

test("the hero takes their motto from the pride block alone — no hero.tagline needed", () => {
  const copy = composeIdentityCopy({ facts: FACTS, marketCity: "Gonzales", pride: PRIDE });
  assert.match(copy.lines.a, /Creating comfort for your family!/);
  assert.equal(copy.source, "client_tagline");
  assert.ok(copy.basis.some((b) => /owner-pride\.sections\.tagline/.test(b)), copy.basis.join(" | "));
});

test("a bare year never becomes the heritage sentence", () => {
  // since_year: 2011 reached identity-copy's third line as the whole of the
  // heritage value and would have printed "2011." under the headline.
  assert.equal(PRIDE.sections.heritage.value, "Since 2011");
  const html = render();
  assert.ok(!/>2011\.?</.test(html), "a naked year is not a sentence");
  assert.match(html, /Since 2011/);
  assert.match(html, /Family-Owned/, "family_owned:true is the audited pride point that kept vanishing");
});

// ---------------------------------------------------------------------------
// THE RAISED CAPS — "If they have more content than we can handle, we still
// dump it in." The schema caps moved 6/6/4/4 -> 24/24/12/12 and the renderer's
// own hard-coded 6/4/8 slices were deleted, so rich verified content is KEPT,
// not silently re-truncated after it already cleared the schema.
// ---------------------------------------------------------------------------
const MAX = { credentials: 24, differentiators: 24, promotions: 12, plans: 12 };

const maximalPride = () => ({
  schema: "owner-pride-v1",
  sections: {
    credentials: Array.from({ length: MAX.credentials }, (_, i) => ({
      kind: "credential", label: `Verified Credential ${String(i + 1).padStart(2, "0")}`,
    })),
    differentiators: Array.from({ length: MAX.differentiators }, (_, i) => ({
      text: `Proven differentiator number ${i + 1} with evidence`,
    })),
    promotions: Array.from({ length: MAX.promotions }, (_, i) => ({
      text: `Real seasonal promotion ${i + 1} with real terms`,
    })),
    plans: Array.from({ length: MAX.plans }, (_, i) => ({
      name: `Service plan tier ${i + 1}`, price: `$${10 + i} per month`,
      details: [`Detail one for tier ${i + 1}`, `Detail two for tier ${i + 1}`],
    })),
  },
});

test("the schema accepts a maximal pride block — 24/24/12/12 — and still enforces the cap", () => {
  const base = {
    slug: "wss-test-air-creation",
    donor: "hvac-premier",
    facts: {
      business_name: FACTS.business_name, industry: "hvac", city: "Gonzales",
      state: "LA", phone: "+1 225 222 0000",
    },
    brand: { logo: "https://www.aircreationheatingandcooling.com/logo.png" },
  };
  const good = checkMirrorRequest({ ...base, content: { pride: maximalPride() } });
  assert.equal(good.ok, true, JSON.stringify(good.body || {}).slice(0, 400));

  const overCredentials = checkMirrorRequest({
    ...base,
    content: { pride: { sections: { credentials: maximalPride().sections.credentials.concat([{ label: "One credential too many" }]) } } },
  });
  assert.equal(overCredentials.ok, false, "a 25th credential is still over the cap");

  const overPlans = checkMirrorRequest({
    ...base,
    content: { pride: { sections: { plans: maximalPride().sections.plans.concat([{ name: "One plan too many", price: "$1" }]) } } },
  });
  assert.equal(overPlans.ok, false, "a 13th plan is still over the cap");
});

test("the renderer emits EVERY pride item — no hidden 6/4 slices", () => {
  const html = buildContentHtml({
    content: { pride: maximalPride() },
    facts: FACTS, phoneDigits: "2252220000", donorRenders: [],
  });
  const count = (mark) => (html.match(new RegExp(`data-wss-pride="${mark}"`, "g")) || []).length;
  assert.equal(count("credential"), MAX.credentials, "all 24 credentials render (the wall no longer slices at 6)");
  assert.equal(count("differentiator"), MAX.differentiators, "all 24 differentiators render");
  assert.equal(count("plan"), MAX.plans, "all 12 plans render with their real prices");
  assert.equal(count("promotion"), MAX.promotions, "all 12 promotions render");
  assert.match(html, /Service plan tier 12/, "the LAST plan is on the page");
  assert.match(html, /Verified Credential 24/, "the LAST credential is on the page");
  assert.match(html, /Proven differentiator number 24/, "the LAST differentiator is on the page");
  assert.match(html, /Real seasonal promotion 12/, "the LAST promotion is on the page");
});
