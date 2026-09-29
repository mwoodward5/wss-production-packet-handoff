"use strict";
// The owner-pride block: only what the sources prove, verbatim, or nothing.
// Born from the owner-behind audit (docs/owner-behind/): both rebuilds FAILED
// for dropping the owner's motto, plans, Daikin relationship, promos and
// footprint. This module is the bridge from extraction to renderable — and
// these tests pin the refusals as hard as the acceptances.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { prideFromExtraction, plausiblePlaceName } = require("../lib/owner-pride");

const AIR = require(path.join(__dirname, "..", "..", "..", "docs", "owner-behind", "air-creation-extraction.json"));

function entry(value, over = {}) {
  return {
    status: "FOUND", value, confidence: "high",
    evidence: [{ source_url: "https://client.example.com/about", quote: "q" }],
    ...over,
  };
}

test("the real Air Creation extraction yields the audited pride points", () => {
  const p = prideFromExtraction(AIR, { clientDomain: "aircreationheatingandcooling.com" });
  assert.ok(p, "extraction produced nothing");
  assert.equal(p.sections.tagline.value, "Creating comfort for your family!");
  const plans = p.sections.plans.map((x) => `${x.name} ${x.price}`);
  assert.ok(plans.some((s) => /Silver Plan \$22\.95/.test(s)), plans.join("|"));
  assert.ok(plans.some((s) => /Gold Plan \$29\.95/.test(s)));
  const creds = p.sections.credentials.map((c) => c.label);
  assert.ok(creds.some((c) => /Daikin/.test(c)), "the Daikin relationship is the flagship credential");
  assert.ok(creds.includes("License #56179"));
  assert.equal(p.sections.footprint.cities.length, 12, "the audited 12-city footprint");
  assert.equal(p.sections.footprint.regions.length, 3, "the three parishes");
});

test("NOT_FOUND, low confidence, and evidence-free entries are refused", () => {
  const x = {
    A_identity_brand_equity: {
      tagline_or_motto: entry("A motto", { status: "NOT_FOUND" }),
      years_in_business_or_since: entry("since 2011", { confidence: "low" }),
      family_or_veteran_or_woman_owned: entry("family-owned", { evidence: [] }),
    },
  };
  assert.equal(prideFromExtraction(x, {}), null, "nothing provable means no block at all");
});

test("auditor commentary can never render as a credential", () => {
  // THE BACKSPACE BUG, pinned. The commentary filter regex was written through
  // a shell heredoc that turned \b into a literal 0x08, so the filter matched
  // nothing and "…no explicit written warranty terms found." shipped as a
  // trust badge. The third escape-mangling incident on this machine — this
  // test fails if the filter ever goes dead again, however it dies.
  const x = {
    B_credentials_and_trust: {
      guarantee_or_warranty: entry("Goal of 100% satisfaction; no explicit written warranty terms found."),
      bbb_rating: entry("Company details not found on BBB"),
    },
  };
  assert.equal(prideFromExtraction(x, {}), null);
});

test("booleans become claims in words, never the datum", () => {
  const x = {
    B_credentials_and_trust: {
      licensed_and_insured: entry(true),
      factory_trained_technicians: entry(true),
      license_number: entry("56179"),
    },
  };
  const labels = prideFromExtraction(x, {}).sections.credentials.map((c) => c.label);
  assert.deepEqual(labels.sort(), ["Factory-Trained Technicians", "License #56179", "Licensed & Insured"]);
  assert.ok(!labels.includes("true"), "a bare boolean is not a badge");
});

test("a credential image renders only from the client's own domain", () => {
  const x = {
    B_credentials_and_trust: {
      authorized_manufacturer_relationships: [
        entry({ name: "Authorized Daikin Dealer", badge_url: "https://daikin.com/badge.png" }),
        entry({ name: "Authorized Trane Dealer", badge_url: "https://client.example.com/img/trane.png" }),
      ],
    },
  };
  const creds = prideFromExtraction(x, { clientDomain: "client.example.com" }).sections.credentials;
  const daikin = creds.find((c) => /Daikin/.test(c.label));
  const trane = creds.find((c) => /Trane/.test(c.label));
  assert.equal(daikin.image, "", "a third-party-hosted mark stays text-only — the manufacturer-badge trap");
  assert.equal(trane.image, "https://client.example.com/img/trane.png", "the client's own asset may render");
  assert.ok(creds.every((c) => c.kind === "credential"), "never the identity path");
});

test("numeric and token towns are refused — the 9, LA rule", () => {
  assert.equal(plausiblePlaceName("9, LA"), false);
  assert.equal(plausiblePlaceName("13"), false);
  assert.equal(plausiblePlaceName("LA"), false);
  assert.equal(plausiblePlaceName("{city}"), false);
  assert.equal(plausiblePlaceName(""), false);
  assert.equal(plausiblePlaceName("Baton Rouge"), true);
  assert.equal(plausiblePlaceName("Prairieville"), true);
  const x = {
    G_service_area_and_locations: {
      cities: entry(["Gonzales", "9, LA", "Baton Rouge", "{city}", "4, LA"]),
    },
  };
  const p = prideFromExtraction(x, {});
  assert.deepEqual(p.sections.footprint.cities, ["Gonzales", "Baton Rouge"]);
});

test("a plan without its real price is not printed", () => {
  const x = {
    E_productized_offers_and_pricing: {
      maintenance_plans: [
        entry({ name: "Silver Plan" }),                       // no price -> refused
        entry({ name: "Gold Plan", price: "$29.95/mo" }),
      ],
    },
  };
  const plans = prideFromExtraction(x, {}).sections.plans;
  assert.equal(plans.length, 1);
  assert.equal(plans[0].name, "Gold Plan");
});

test("every rendered item carries its proof", () => {
  const p = prideFromExtraction(AIR, { clientDomain: "aircreationheatingandcooling.com" });
  for (const plan of p.sections.plans) {
    assert.ok(plan.proof.source.startsWith("https://"), "a plan without a source is unprovable");
  }
  assert.ok(p.sections.tagline.proof.source.includes("aircreationheatingandcooling.com"));
});
