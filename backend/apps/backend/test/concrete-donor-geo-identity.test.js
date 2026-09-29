"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { identityScan } = require("../lib/mirror-engine/scan");

const baseManifest = {
  name: "concrete-elconstruction",
  donor_business_name: "EL Construction",
  donor_phone: "(480) 256-2343",
  donor_email: "elconstructionaz@gmail.com",
  donor_city: "Tempe",
  donor_county: "Maricopa County",
  donor_domain: "elconstructionaz.com",
  persons: [],
  socials: ["Phoenix", "Scottsdale", "Arizona", "elconstructionaz"],
  zips: ["85281"],
  geo: ["33.4255", "-111.9400"],
  account_ids: [],
  asset_md5: {},
};

test("concrete donor service-market geography does not reject a legitimate Arizona prospect", () => {
  const files = {
    "index.html": Buffer.from("<html><body><h1>Concrete in Phoenix, Arizona</h1></body></html>"),
  };
  const result = identityScan(files, baseManifest);
  assert.equal(result.clean, true, JSON.stringify(result.hits));
});

test("concrete donor actual identity still fails closed", () => {
  const files = {
    "index.html": Buffer.from("<html><body><p>EL Construction</p></body></html>"),
  };
  const result = identityScan(files, baseManifest);
  assert.equal(result.clean, false);
  assert.ok(result.hits.some((hit) => String(hit.token).toLowerCase().includes("el construction")));
});

test("other donors still treat their declared Phoenix atom as identity", () => {
  const files = {
    "index.html": Buffer.from("<html><body><h1>Phoenix</h1></body></html>"),
  };
  const result = identityScan(files, { ...baseManifest, name: "another-donor" });
  assert.equal(result.clean, false);
  assert.ok(result.hits.some((hit) => String(hit.token).toLowerCase() === "phoenix"));
});
