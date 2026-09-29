"use strict";

// EVERY MIRROR MUST SOUND LIKE ITS OWN BUSINESS.
//
// MEASURED 2026-08-11 across the 80 built-and-unsent mirrors:
//   · 32/32 HVAC mirrors rendered the byte-identical h1
//     "When the summer heat / breaks the rules, / we hold the line."
//     — hvac-premier's own sentence, hardcoded in its compiled JSX with no
//     token slot anywhere near it;
//   · 32/32 SERVED the byte-identical <title> AND og:title
//     "HVAC Contractor | AC & Heating Services" — the card a prospect sees in
//     the email that delivered the link;
//   · 15/48 plumbing mirrors shared an h1 verbatim, because "Plumbing in
//     {City}." is true of every plumber in that city.
//
// These tests pin all three halves of the fix:
//   1. the COMPOSER names the business (or their proven motto) and never
//      invents a claim — lib/mirror-engine/identity-copy.js;
//   2. the DONORS all have somewhere to put it, and hvac-premier no longer
//      publishes its own sentence or its own anonymous title;
//   3. the GATE refuses a duplicate instead of leaving it to the gallery —
//      lib/mirror-engine/sameness.js, wired into REQUIRED_CHECKS.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-headline-"));

const { composeIdentityCopy, tradeLabel, usableTagline } = require("../lib/mirror-engine/identity-copy");
const { samenessCheck, donorHeadlineSlots, servedIdentity } = require("../lib/mirror-engine/sameness");
const { mirror, REQUIRED_CHECKS } = require("../lib/mirror-engine/engine");
const { createRegistry } = require("../lib/mirror-engine/build-hash");
const { loadDonor, listDonors, donorRoot } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

// ---------------------------------------------------------------------------
// 1. THE COMPOSER
// ---------------------------------------------------------------------------
const ROSE = {
  business_name: "Rose City Heating and Air",
  industry: "hvac",
  city: "Portland",
  state: "OR",
  rating: 4.9,
  review_count: 212,
};

test("the vertical KEY is never printed raw — 'hvac' is HVAC, not Hvac", () => {
  assert.equal(tradeLabel("hvac"), "HVAC");
  assert.equal(tradeLabel("plumbing"), "Plumbing");
  assert.equal(tradeLabel("med spa"), "Med spa");
  // An unmapped vertical still reads like a word, and never like a database key.
  assert.equal(tradeLabel("gutter cleaning"), "Gutter Cleaning");
  assert.equal(tradeLabel(""), "");
});

test("the headline names the BUSINESS, the trade and the market city", () => {
  const c = composeIdentityCopy({ facts: ROSE, marketCity: "Portland" });
  assert.equal(c.lines.a, "Rose City Heating and Air.");
  assert.equal(c.lines.b, "HVAC in Portland, OR.");
  assert.equal(c.headline, "Rose City Heating and Air. HVAC in Portland, OR.");
  assert.equal(c.title, "Rose City Heating and Air | HVAC in Portland, OR");
});

test("the differentiator line is a VERIFIED pair or nothing at all", () => {
  const withProof = composeIdentityCopy({ facts: ROSE, marketCity: "Portland" });
  assert.equal(withProof.lines.c, "4.9 stars across 212 reviews.");
  assert.equal(withProof.source, "verified_facts");

  // A rating with no count, a count with no rating, and neither: all silent.
  // TRUTH LAW — there is no "trusted local experts" fallback and never will be.
  for (const facts of [
    { ...ROSE, review_count: undefined },
    { ...ROSE, rating: undefined },
    { ...ROSE, rating: undefined, review_count: undefined },
  ]) {
    const c = composeIdentityCopy({ facts, marketCity: "Portland" });
    assert.equal(c.lines.c, "", JSON.stringify(facts));
    assert.equal(c.source, "trade_and_city");
    // …and the two lines that ARE true still carry their identity.
    assert.match(c.headline, /^Rose City Heating and Air\./);
  }
});

test("their own motto wins, verbatim, and only when it is proven", () => {
  const pride = {
    sections: {
      tagline: { value: "Creating comfort for your family!", proof: { source: "https://x.example/", quote: "…" } },
    },
  };
  const c = composeIdentityCopy({ facts: ROSE, marketCity: "Portland", pride });
  assert.equal(c.lines.a, "Creating comfort for your family!", "verbatim — not paraphrased, not re-punctuated");
  assert.equal(c.source, "client_tagline");
  assert.match(c.lines.b, /^HVAC in Portland, OR\./, "the trade and the town are still stated");
  assert.match(c.headline, /Rose City Heating and Air/, "a proven motto still carries the exact business identity");

  // No pride block, no motto. The name is the fallback, never a slogan.
  const bare = composeIdentityCopy({ facts: ROSE, marketCity: "Portland" });
  assert.equal(bare.lines.a, "Rose City Heating and Air.");
  assert.equal(bare.source, "verified_facts");
});

test("scraped machinery is not a motto", () => {
  for (const bad of [
    "${child.title}",                       // the Cooper Perry defect, verbatim
    "{{HERO_HEADLINE}}",                    // one of our own tokens, round-tripped
    "https://example.com/about",            // a URL
    "Call us at 918-328-0009",              // a phone number
    "hello@example.com",                    // an email
    "Rose City Heating and Air",            // the name alone is not a tagline
    "Hi",                                   // too short to be a sentence
    "x".repeat(120),                        // too long for a headline line
    "",
  ]) {
    assert.equal(usableTagline(bad, { businessName: "Rose City Heating and Air" }), "", JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(
    usableTagline("Creating comfort for your family!", { businessName: "Rose City Heating and Air" }),
    "Creating comfort for your family!",
  );
});

test("an owner's run-on slogan is too long for a headline — the name takes over", () => {
  // MEASURED 2026-08-12: Family Heating's own site slogan shipped verbatim as
  // the h1 of their live mirror. It is their real copy — honest, not invented —
  // but a ten-word run-on across two clauses, and the owner flagged it ("too
  // long and run on"). It is 55 characters, comfortably under the char cap, so
  // only a WORD ceiling can see it. Refusing it here falls the composer back to
  // the name and the trade-and-city; nothing is fabricated to replace it.
  const RUNON = "HVAC Company in Indianapolis, IN, Is Ready to Serve You!";
  assert.equal(usableTagline(RUNON, { businessName: "Family Heating & Air Conditioning" }), "");

  const c = composeIdentityCopy({
    facts: {
      business_name: "Family Heating & Air Conditioning",
      industry: "hvac", city: "Lawrence", state: "IN", rating: 4.9, review_count: 1212,
    },
    marketCity: "Indianapolis",
    hero: { tagline: RUNON },
  });
  assert.equal(c.lines.a, "Family Heating & Air Conditioning.", "the name is line A, never the run-on");
  assert.doesNotMatch(c.headline, /Ready to Serve/, "the run-on never reaches the headline");
  assert.equal(c.headline, "Family Heating & Air Conditioning. HVAC in Indianapolis, IN.");
  assert.equal(c.lines.c, "4.9 stars across 1212 reviews.", "the verified pair still rides underneath");

  // The fix narrows to run-ons — a six-word motto the wiring already ships
  // (design-brief-wiring.test.js) still survives, verbatim.
  assert.equal(
    usableTagline("Big City Service. Small Town Value", { businessName: "Acme HVAC" }),
    "Big City Service. Small Town Value",
  );
});

test("a business name that already ends in a full stop does not get a second one", () => {
  const c = composeIdentityCopy({
    facts: { business_name: "Smith Plumbing Inc.", industry: "plumbing", city: "Tulsa", state: "OK" },
    marketCity: "Tulsa",
  });
  assert.equal(c.lines.a, "Smith Plumbing Inc.");
  assert.doesNotMatch(c.headline, /\.\./);
});

// ---------------------------------------------------------------------------
// 2. THE DONORS
// ---------------------------------------------------------------------------
test("every donor in the library has somewhere to put the client's headline", () => {
  const missing = [];
  for (const d of listDonors()) {
    const { files } = loadDonor(path.join(donorRoot(), d.name));
    if (!donorHeadlineSlots(files).length) missing.push(d.name);
  }
  assert.deepEqual(
    missing, [],
    "a donor with no headline token can only ever publish its OWN sentence — that is the 32-HVAC-mirror defect",
  );
});

test("hvac-premier no longer publishes its own sentence or its own anonymous title", () => {
  const { files } = loadDonor(path.join(donorRoot(), "hvac-premier"));
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Rose City Heating and Air",
    CITY: "Portland",
    ADDRESS_CITY: "Portland",
    STATE: "OR",
    REGION: "OR",
    HERO_HEADLINE: "Rose City Heating and Air. HVAC in Portland, OR.",
    HERO_LINE_A: "Rose City Heating and Air.",
    HERO_LINE_B: "HVAC in Portland, OR.",
    HERO_LINE_C: "4.9 stars across 212 reviews.",
    SITE_URL: "https://wss-test-rose.wss-ai.com/",
    PREVIEW_URL: "https://wss-test-rose.wss-ai.com/",
    LOGO_URL: "/assets/brand-logo.svg",
  });
  const h = hydrate({ donorFiles: files, tokenValues: tv });
  assert.equal(h.ok, true, JSON.stringify(h.detail));

  const bundle = Object.entries(h.files).find(([rel]) => /^assets\/index-.*\.js$/.test(rel));
  const js = bundle[1].toString("utf8");
  assert.doesNotMatch(js, /we hold the line/, "the donor's hardcoded hero sentence is still in the bytes");
  assert.match(js, /Rose City Heating and Air\./, "the client's own line never reached the hero");

  const served = servedIdentity(h.files);
  assert.match(served.title, /Rose City Heating and Air/, "the served title names nobody");
  assert.match(served.title, /Portland, OR/);
  assert.match(served.og_title, /Rose City Heating and Air/, "the link-preview card names nobody");
  assert.match(served.description, /Rose City Heating and Air/);
});

test("a build with no verified differentiator drops the third line and its markup", () => {
  const { files } = loadDonor(path.join(donorRoot(), "hvac-premier"));
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "M & M Heating",
    CITY: "Bridgeport",
    ADDRESS_CITY: "Bridgeport",
    STATE: "CT",
    REGION: "CT",
    HERO_HEADLINE: "M & M Heating. HVAC in Bridgeport, CT.",
    HERO_LINE_A: "M & M Heating.",
    HERO_LINE_B: "HVAC in Bridgeport, CT.",
    HERO_LINE_C: "",
    SITE_URL: "https://wss-test-mm.wss-ai.com/",
    PREVIEW_URL: "https://wss-test-mm.wss-ai.com/",
    LOGO_URL: "/assets/brand-logo.svg",
  });
  const h = hydrate({ donorFiles: files, tokenValues: tv });
  assert.equal(h.ok, true, JSON.stringify(h.detail));
  const js = Object.entries(h.files).find(([rel]) => /^assets\/index-.*\.js$/.test(rel))[1].toString("utf8");
  assert.doesNotMatch(js, /text-gradient-warm/, "the empty third line kept its span and its <br>");
});

// ---------------------------------------------------------------------------
// 3. THE GATE
// ---------------------------------------------------------------------------
test("sameness is a gate, not a note — it blocks revealable", () => {
  assert.ok(REQUIRED_CHECKS.includes("sameness"));
});

const HTML = (title, og) => ({
  "index.html": Buffer.from(
    `<!doctype html><html><head><title>${title}</title>`
    + `<meta property="og:title" content="${og || title}" /></head><body></body></html>`,
  ),
});
const SLOTTED = { "index.html": Buffer.from("<h1>{{HERO_LINE_A}}</h1>") };
const COPY = {
  lines: { a: "Rose City Heating and Air.", b: "HVAC in Portland, OR.", c: "" },
  headline: "Rose City Heating and Air. HVAC in Portland, OR.",
  source: "verified_facts",
  basis: [],
};

test("a donor that hardcodes its hero is refused before a deploy is spent", () => {
  const c = samenessCheck({
    slug: "wss-test-a",
    facts: ROSE,
    marketCity: "Portland",
    copy: COPY,
    donorFiles: { "index.html": Buffer.from("<h1>When the summer heat breaks the rules</h1>") },
    files: HTML("Rose City Heating and Air | HVAC in Portland, OR"),
  });
  assert.equal(c.status, "failed");
  assert.ok(c.problems.some((p) => p.startsWith("donor_has_no_headline_slot")), JSON.stringify(c.problems));
});

test("a token named only inside an HTML comment is documentation, not a slot", () => {
  const slots = donorHeadlineSlots({
    "index.html": Buffer.from("<!-- this donor could use {{HERO_HEADLINE}} one day --><h1>Hardcoded</h1>"),
  });
  assert.deepEqual(slots, []);
});

test("a served title that names nobody is refused", () => {
  const c = samenessCheck({
    slug: "wss-test-a",
    facts: ROSE,
    marketCity: "Portland",
    copy: COPY,
    donorFiles: SLOTTED,
    files: HTML("HVAC Contractor | AC &amp; Heating Services"),
  });
  assert.equal(c.status, "failed");
  assert.ok(c.problems.some((p) => p.startsWith("served_title_missing_business_name")));
  assert.ok(c.problems.some((p) => p.startsWith("served_title_missing_city")));
});

test("an h1 the browser actually rendered from DONOR copy is refused", () => {
  const c = samenessCheck({
    slug: "wss-test-a",
    facts: ROSE,
    marketCity: "Portland",
    copy: COPY,
    donorFiles: SLOTTED,
    files: HTML("Rose City Heating and Air | HVAC in Portland, OR"),
    // The donor carried a slot and painted over it anyway. Only the DOM says so.
    renderedH1: "When the summer heat breaks the rules, we hold the line.",
  });
  assert.equal(c.status, "failed");
  assert.equal(c.rendered_h1_verdict, "donor_copy");
  assert.ok(c.problems.some((p) => p.startsWith("rendered_h1_not_client_derived")));
});

test("the client's own h1 passes, and its line breaks do not matter", () => {
  const c = samenessCheck({
    slug: "wss-test-a",
    facts: ROSE,
    marketCity: "Portland",
    copy: COPY,
    donorFiles: SLOTTED,
    files: HTML("Rose City Heating and Air | HVAC in Portland, OR"),
    renderedH1: "Rose City Heating and Air.\nHVAC in Portland, OR.",
  });
  assert.equal(c.status, "passed", JSON.stringify(c.problems));
  assert.equal(c.rendered_h1_verdict, "client_derived");
});

test("a headline another live mirror already publishes is refused, and it is named", () => {
  const c = samenessCheck({
    slug: "wss-test-a",
    facts: ROSE,
    marketCity: "Portland",
    copy: COPY,
    donorFiles: SLOTTED,
    files: HTML("Rose City Heating and Air | HVAC in Portland, OR"),
    renderedH1: "Rose City Heating and Air. HVAC in Portland, OR.",
    fleet: [
      { slug: "wss-test-harris-air-west-sacramento", h1: "Rose City Heating and Air. HVAC in Portland, OR.", title: "something else" },
    ],
  });
  assert.equal(c.status, "failed");
  assert.ok(
    c.problems.some((p) => p.includes("duplicate_h1_with_wss-test-harris-air-west-sacramento")),
    JSON.stringify(c.problems),
  );
  assert.equal(c.fleet_compared, 1);
});

test("a title another live mirror already publishes is refused too", () => {
  const c = samenessCheck({
    slug: "wss-test-a",
    facts: ROSE,
    marketCity: "Portland",
    copy: COPY,
    donorFiles: SLOTTED,
    files: HTML("HVAC Contractor | AC &amp; Heating Services in Portland for Rose City Heating and Air"),
    renderedH1: "Rose City Heating and Air. HVAC in Portland, OR.",
    fleet: [
      { slug: "wss-test-other", h1: "different", title: "HVAC Contractor | AC & Heating Services in Portland for Rose City Heating and Air" },
    ],
  });
  assert.equal(c.status, "failed");
  assert.ok(c.problems.some((p) => p.includes("duplicate_title_with_wss-test-other")), JSON.stringify(c.problems));
});

test("a mirror is never compared against itself", () => {
  const c = samenessCheck({
    slug: "wss-test-a",
    facts: ROSE,
    marketCity: "Portland",
    copy: COPY,
    donorFiles: SLOTTED,
    files: HTML("Rose City Heating and Air | HVAC in Portland, OR"),
    renderedH1: "Rose City Heating and Air. HVAC in Portland, OR.",
    fleet: [{ slug: "wss-test-a", h1: "Rose City Heating and Air. HVAC in Portland, OR.", title: "Rose City Heating and Air | HVAC in Portland, OR" }],
  });
  assert.equal(c.status, "passed", "a rebuild of the same slug is not a collision");
});

// ---------------------------------------------------------------------------
// 4. END TO END — two HVAC businesses in one city
// ---------------------------------------------------------------------------
function hvacRequest(slug, name, city, state, extra = {}) {
  return {
    slug,
    donor: "hvac-premier",
    facts: {
      business_name: name,
      industry: "hvac",
      city,
      state,
      phone: extra.phone || "(503) 555-0143",
      ...(extra.facts || {}),
    },
  };
}

test("two HVAC businesses in the SAME city do not share a headline or a title", async () => {
  const registry = createRegistry();
  const a = await mirror(hvacRequest("wss-test-hh-rose-city-hvac-portland", "Rose City Heating and Air", "Portland", "OR",
    { phone: "(503) 555-0143", facts: { rating: 4.9, review_count: 212 } }), { dryRun: true, registry });
  const b = await mirror(hvacRequest("wss-test-hh-cascade-comfort-portland", "Cascade Comfort Systems", "Portland", "OR",
    { phone: "(503) 555-0199" }), { dryRun: true, registry });

  assert.equal(a.status, 200, JSON.stringify(a.body).slice(0, 300));
  assert.equal(b.status, 200, JSON.stringify(b.body).slice(0, 300));

  const sa = a.body.checks.sameness;
  const sb = b.body.checks.sameness;
  assert.equal(sa.status, "passed", JSON.stringify(sa.problems));
  assert.equal(sb.status, "passed", JSON.stringify(sb.problems));

  assert.notEqual(sa.headline, sb.headline, "same city, same trade, one sentence — the measured defect");
  assert.notEqual(sa.served_title, sb.served_title);
  assert.notEqual(sa.served_og_title, sb.served_og_title);

  // …and each one is about the business it belongs to.
  assert.match(sa.headline, /^Rose City Heating and Air\./);
  assert.match(sb.headline, /^Cascade Comfort Systems\./);
  assert.equal(sa.lines.c, "4.9 stars across 212 reviews.");
  assert.equal(sb.lines.c, "", "no verified pair, no claim");
});

test("the fleet is read through an injected seam, and a collision refuses the build", async () => {
  const registry = createRegistry();
  const req = hvacRequest("wss-test-hh-summit-air-boise", "Summit Air", "Boise", "ID", { phone: "(208) 555-0111" });
  const clean = await mirror(req, { dryRun: true, registry: createRegistry() });
  const headline = clean.body.checks.sameness.headline;

  const collided = await mirror(req, {
    dryRun: true,
    registry,
    deps: { fleetIdentities: async () => [{ slug: "wss-test-someone-else", h1: headline, title: "unrelated" }] },
  });
  assert.equal(collided.body.checks.sameness.status, "failed");
  assert.ok(
    collided.body.checks.sameness.problems.some((p) => p.includes("duplicate_h1_with_wss-test-someone-else")),
    JSON.stringify(collided.body.checks.sameness.problems),
  );
});
