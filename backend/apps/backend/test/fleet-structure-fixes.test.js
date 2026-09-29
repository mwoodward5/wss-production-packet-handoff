"use strict";

// test/fleet-structure-fixes.test.js
//
// STRUCTURE/IDENTITY DEFECT CLASS — 2026-09-02 live-site fleet audit. Each
// test pins one defect with the exact live symptom as its fixture. All fixes
// live in apps/backend/lib/mirror-engine/*.

const test = require("node:test");
const assert = require("node:assert/strict");

const { polishSite, ensureSingleH1 } = require("../lib/mirror-engine/fleet-polish");
const {
  prerenderServiceSelectOptions,
  schemaTelephone,
  seoDescription,
  buildJsonLd,
  titleCaseShoutedTokens,
  trimTrailingPeriod,
} = require("../lib/mirror-engine/content-inject");
const {
  hydrate,
  normalizeHydratedUrls,
  normalizeHydratedTelHrefs,
  normalizeTelHrefValue,
} = require("../lib/mirror-engine/hydrate");
const { cleanBusinessDisplayName, validateFacts } = require("../lib/mirror-engine/facts");
const { ALLOWED_TOKENS, REQUIRED_TOKENS } = require("../lib/mirror-engine/tokens");

// -------------------------------------------------------------------------
// DEFECT 1 — polish block shipped on index.html only; interior pages
// (/faq, /services, /plumbing, /fence-guides…) had NO wss-fleet-polish block.
// -------------------------------------------------------------------------
test("defect 1: every emitted HTML page carries the wss-fleet-polish style block", () => {
  const files = {
    "index.html": "<html><head><title>Home</title></head><body><h1>Home</h1></body></html>",
    "faq.html": "<html><head><title>FAQ</title></head><body><h1>FAQ</h1></body></html>",
    "services.html": "<html><head><title>Services</title></head><body><h1>Services</h1></body></html>",
    "fence-guides/index.html": "<html><head><title>Guides</title></head><body><h1>Guides</h1></body></html>",
  };
  const result = polishSite(files, {});
  for (const rel of Object.keys(files)) {
    assert.match(result.files[rel], /id="wss-fleet-polish"/, `${rel} must carry the polish block`);
  }
  // Exactly one block per page — no duplicates.
  for (const rel of Object.keys(files)) {
    assert.equal((result.files[rel].match(/wss-fleet-polish/g) || []).length, 1, `${rel} carries exactly one block id`);
  }
  assert.equal(result.applied.tapCss, true);
  assert.equal(result.applied.contrastCss, true);
});

test("defect 1: the per-page injection is idempotent on a second pass", () => {
  const files = {
    "index.html": '<html><head></head><body><h1>A</h1></body></html>',
    "faq.html": '<html><head></head><body><h1>B</h1></body></html>',
  };
  const first = polishSite(files, {});
  const second = polishSite(first.files, {});
  for (const rel of Object.keys(files)) {
    assert.equal((second.files[rel].match(/wss-fleet-polish/g) || []).length, 1);
  }
});

// -------------------------------------------------------------------------
// DEFECT 2 — served HTML shipped <select name="service" data-wss-service-select>
// with ONLY the placeholder option; options arrived via /assets/main.js, so
// no-JS visitors and crawlers saw an empty dropdown.
// -------------------------------------------------------------------------
test("defect 2: the certified services are pre-rendered into the empty service select", () => {
  const served = '<select name="service" data-wss-service-select><option value="">Choose a verified service</option></select>';
  const result = prerenderServiceSelectOptions(served, [
    "Water Heater Repair & Replacement",
    "Drain Cleaning",
    { name: "Repiping" },
  ]);
  assert.equal(result.present, true);
  assert.equal(result.added, 3);
  assert.match(result.html, /<option value="">Choose a verified service<\/option><option value="Water Heater Repair &amp; Replacement" data-wss-service-option>Water Heater Repair &amp; Replacement<\/option>/);
  assert.match(result.html, /<option value="Drain Cleaning" data-wss-service-option>Drain Cleaning<\/option>/);
  assert.match(result.html, /<option value="Repiping" data-wss-service-option>Repiping<\/option>/);
});

test("defect 2: the pass is idempotent and skips pages without the select", () => {
  const served = '<html><body><select data-wss-service-select><option value="">Choose a verified service</option></select></body></html>';
  const once = prerenderServiceSelectOptions(served, ["Plumbing"]);
  const twice = prerenderServiceSelectOptions(once.html, ["Plumbing"]);
  assert.equal(twice.added, 0);
  assert.equal((once.html.match(/data-wss-service-option/g) || []).length, 1);
  assert.equal((once.html.match(/<script>/g) || []).length, 1, "exactly one tidy script");

  const withoutSelect = prerenderServiceSelectOptions("<html><body><form></form></body></html>", ["Plumbing"]);
  assert.equal(withoutSelect.present, false);
  assert.equal(withoutSelect.html, "<html><body><form></form></body></html>");
});

// -------------------------------------------------------------------------
// DEFECT 3 — "Brilliant Borders | Landscaping Services in Des Moines Built to
// Last": slug-derived pipe fragments leaked into the display name everywhere,
// including JSON-LD.
// -------------------------------------------------------------------------
test("defect 3: pipe marketing tails are stripped from the display name", () => {
  assert.equal(
    cleanBusinessDisplayName("Brilliant Borders | Landscaping Services in Des Moines Built to Last"),
    "Brilliant Borders",
  );
  // validateFacts applies the same clean at the boundary, so every surface
  // (tokens, schema, meta, island) reads the clean name.
  const out = validateFacts({
    facts: {
      business_name: "Brilliant Borders | Landscaping Services in Des Moines Built to Last",
      industry: "Landscaping",
      city: "Des Moines",
      state: "IA",
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.facts.business_name, "Brilliant Borders");
});

test("defect 3: a name with no pipe passes through untouched", () => {
  assert.equal(cleanBusinessDisplayName("Brilliant Borders"), "Brilliant Borders");
  assert.equal(cleanBusinessDisplayName(""), "");
});

// -------------------------------------------------------------------------
// DEFECT 4 — "True Fence Florida (North Port (primary))": internal
// multi-location labels leaked into the public display name.
// -------------------------------------------------------------------------
test("defect 4: internal location labels never appear in public display names", () => {
  assert.equal(cleanBusinessDisplayName("True Fence Florida (North Port (primary))"), "True Fence Florida");
  assert.equal(cleanBusinessDisplayName("Sun Coast Concrete (HQ)"), "Sun Coast Concrete");
  assert.equal(cleanBusinessDisplayName("Acme Fencing (Sarasota branch)"), "Acme Fencing");
  // A non-label parenthetical is branding, not routing metadata — kept.
  assert.equal(cleanBusinessDisplayName("Acme (Texas)"), "Acme (Texas)");
});

// -------------------------------------------------------------------------
// DEFECT 5 — the HVAC/United-Contractors homepage shipped 0 <h1>: the
// Vite-family hero renders client-side and the static index carries only h2s.
// -------------------------------------------------------------------------
test("defect 5: a homepage with no h1 gets exactly one, promoted from the first h2", () => {
  const served = [
    "<html><head><title>United Contractors</title></head><body>",
    '<div id="root"></div>',
    '<section class="wss-c"><h2 class="wss-c__h">Our Services</h2><p>Real content.</p></section>',
    "<footer><h2>Contact</h2></footer>",
    "</body></html>",
  ].join("");
  const result = polishSite({ "index.html": served }, {});
  const html = result.files["index.html"];
  const h1s = html.match(/<h1[\s>]/gi) || [];
  assert.equal(h1s.length, 1, "exactly one h1 after the floor");
  assert.match(html, /<h1 class="wss-c__h">Our Services<\/h1>/, "attributes preserved, first h2 promoted");
  assert.doesNotMatch(html, /<h2 class="wss-c__h">Our Services<\/h2>/);
  // The footer h2 stays an h2 — only the FIRST heading is promoted.
  assert.match(html, /<h2>Contact<\/h2>/);
});

test("defect 5: pages that already carry an h1 are left untouched by the promotion", () => {
  const served = "<html><head></head><body><h1>Real hero</h1><h2>Section</h2></body></html>";
  const promoted = ensureSingleH1(served);
  assert.equal(promoted.applied, false);
  assert.equal(promoted.html, served);
  const result = polishSite({ "index.html": served }, {});
  assert.equal(result.applied.h1Promoted, 0);
  assert.equal((result.files["index.html"].match(/<h1[\s>]/gi) || []).length, 1);
  assert.match(result.files["index.html"], /<h2>Section<\/h2>/);
  // Direct helper contract: idempotent.
  const once = ensureSingleH1("<html><body><h2>A</h2><h2>B</h2></body></html>");
  assert.equal(once.applied, true);
  const twice = ensureSingleH1(once.html);
  assert.equal(twice.applied, false);
  assert.equal((once.html.match(/<h1>/g) || []).length, 1);
});

// -------------------------------------------------------------------------
// DEFECT 6 — "https://…wss-ai.com//#business" ×3 in the fencing schema;
// tattoo og:url/og:image ended "wss-ai.com//". Donor templates append a path
// to {{SITE_URL}}, which already ends in "/".
// -------------------------------------------------------------------------
test("defect 6: double slashes after the host are normalized before paths are appended", () => {
  assert.equal(
    normalizeHydratedUrls('"@id": "https://true-fence.wss-ai.com//#business"'),
    '"@id": "https://true-fence.wss-ai.com/#business"',
  );
  assert.equal(
    normalizeHydratedUrls('<meta property="og:url" content="https://wss-test-brilliant-borders-landscaping-services-in.wss-ai.com//" />'),
    '<meta property="og:url" content="https://wss-test-brilliant-borders-landscaping-services-in.wss-ai.com/" />',
  );
  // The scheme's "//" is untouchable, single slashes are preserved, and
  // protocol-relative URLs never match. Only the host-adjacent position —
  // where the donor's "{{SITE_URL}}/" composition lands — collapses;
  // path-internal and query-string "//" belong to the donor's own URLs.
  assert.equal(
    normalizeHydratedUrls('<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap">'),
    '<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap">',
  );
  assert.equal(normalizeHydratedUrls('src="//cdn.example.com/a.png"'), 'src="//cdn.example.com/a.png"');
  assert.equal(
    normalizeHydratedUrls('"url":"https://host.test//a"'),
    '"url":"https://host.test/a"',
  );
});

test("defect 6: the full hydrate collapses the donor's {{SITE_URL}}/ composition", () => {
  const donorFiles = {
    "index.html": '<html><head><link rel="canonical" href="{{SITE_URL}}/"><meta property="og:url" content="{{SITE_URL}}/" /></head><body></body></html>',
    "schema.json": JSON.stringify({ "@id": "{{SITE_URL}}/#business", url: "{{SITE_URL}}/" }),
  };
  const tokenValues = {};
  for (const t of ALLOWED_TOKENS) tokenValues[t] = "";
  for (const t of REQUIRED_TOKENS) tokenValues[t] = "Placeholder";
  tokenValues.SITE_URL = "https://true-fence.wss-ai.com/";
  const out = hydrate({ donorFiles, tokenValues });
  assert.equal(out.ok, true, JSON.stringify(out.detail || ""));
  const indexHtml = out.files["index.html"].toString("utf8");
  assert.match(indexHtml, /href="https:\/\/true-fence\.wss-ai\.com\/"/);
  assert.match(indexHtml, /content="https:\/\/true-fence\.wss-ai\.com\/"/);
  const schema = JSON.parse(out.files["schema.json"].toString("utf8"));
  assert.equal(schema["@id"], "https://true-fence.wss-ai.com/#business");
});

// -------------------------------------------------------------------------
// DEFECT 7 — "offered by United Contractors Inc.." on 3 sites + ALL-CAPS
// service tokens ("PLUMBING offered by…") in og:description/meta.
// -------------------------------------------------------------------------
test("defect 7: the meta composer owns exactly one period and never ships shouting", () => {
  assert.equal(trimTrailingPeriod("United Contractors Inc."), "United Contractors Inc");
  const desc = seoDescription({
    facts: { business_name: "United Contractors Inc.", industry: "plumbing", city: "Columbus", state: "OH" },
    services: ["PLUMBING", "Drain Cleaning"],
  });
  assert.equal(desc, "Plumbing offered by United Contractors Inc. Also drain cleaning.");
  assert.doesNotMatch(desc, /\.\./);
  assert.doesNotMatch(desc, /PLUMBING/);
});

test("defect 7: legit trade acronyms survive; harvested caps are title-cased; schema matches", () => {
  assert.equal(titleCaseShoutedTokens("HVAC installation"), "HVAC installation");
  assert.equal(titleCaseShoutedTokens("PLUMBING"), "Plumbing");
  assert.equal(titleCaseShoutedTokens("Water Heater Repair"), "Water Heater Repair");
  const ld = buildJsonLd({
    content: { services: [{ name: "PLUMBING" }] },
    facts: { business_name: "United Contractors Inc.", industry: "plumbing", city: "Columbus", state: "OH" },
    phoneDigits: "6142948888",
    siteUrl: "https://x.wss-ai.com/",
    logoUrl: "",
  });
  const svc = ld["@graph"].find((n) => n["@type"] === "Service");
  assert.equal(svc.description, "Plumbing offered by United Contractors Inc.");
  assert.doesNotMatch(svc.description, /\.\./);
});

// -------------------------------------------------------------------------
// DEFECT 8 — tattoo shipped href="tel:(614) 294-8888" (RFC 3966 violation)
// while the sibling tel:6142948888 was correct.
// -------------------------------------------------------------------------
test("defect 8: tel: URIs always emit digits-only", () => {
  assert.equal(normalizeTelHrefValue("(614) 294-8888"), "6142948888");
  assert.equal(
    normalizeHydratedTelHrefs('<a class="call-link" href="tel:(614) 294-8888">Call (614) 294-8888</a>'),
    '<a class="call-link" href="tel:6142948888">Call (614) 294-8888</a>',
    "the href is digits-only; the visible text keeps its formatting",
  );
  // Already-correct hrefs are untouched, E.164 keeps its plus.
  assert.match(normalizeHydratedTelHrefs('href="tel:6142948888"'), /tel:6142948888/);
  assert.match(normalizeHydratedTelHrefs('href="tel:+1 (614) 294-8888"'), /tel:\+16142948888/);
  // Literal bundle strings normalize; runtime template building does not match.
  assert.match(normalizeHydratedTelHrefs('x = "tel:(614) 294-8888";'), /"tel:6142948888"/);
  assert.match(normalizeHydratedTelHrefs("href=`tel:${e.phone}`"), /tel:\$\{e\.phone\}/);
});

// -------------------------------------------------------------------------
// DEFECT 9 — the concrete mirror's business JSON-LD had NO telephone while
// the client phone existed in facts.
// -------------------------------------------------------------------------
test("defect 9: schema telephone is present whenever a client phone is known", () => {
  // NANP digits: the canonical +1 form.
  assert.equal(schemaTelephone("6142948888", "+16142948888"), "+16142948888");
  // Phone known but NO valid NANP digits (international record): still emitted.
  assert.equal(schemaTelephone("", "+442079460958"), "+442079460958");
  assert.equal(schemaTelephone("", "44 20 7946 0958"), "", "a number with no + and no NANP derivation must not be guessed into schema");
  // No phone at all: no telephone, as before.
  assert.equal(schemaTelephone("", ""), "");

  const ld = buildJsonLd({
    content: {},
    facts: { business_name: "EL Concrete", industry: "concrete", city: "Tampa", state: "FL", phone: "+442079460958" },
    phoneDigits: "",
    siteUrl: "https://x.wss-ai.com/",
    logoUrl: "",
  });
  const biz = ld["@graph"][0];
  assert.equal(biz.telephone, "+442079460958", "defect 9: known phone must never drop the schema telephone");
  assert.equal(biz.contactPoint.telephone, "+442079460958");
});
