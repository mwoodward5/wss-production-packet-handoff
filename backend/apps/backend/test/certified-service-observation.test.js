"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { certifiedServiceObservation } = require("../lib/mirror-lane-build");

const url = "https://example.com/services/drain-cleaning";
const name = "Drain Cleaning";
const sources = { website_url: "https://example.com" };
const row = {
  field: "services", value: name, source_url: url,
  source_observations: [url], excerpt: "We offer Drain Cleaning in Reno.",
  provenance: "observed", verification_status: "source observation",
  verified: true, status: "verified",
};

test("certified service requires exact observed page and excerpt", () => {
  const packet = { evidence: [row] };
  assert.deepEqual(certifiedServiceObservation(packet, name, sources), {
    source_url: url, excerpt: row.excerpt,
  });
  for (const invalid of [
    { excerpt: "We offer HVAC repair." },
    { excerpt: "" },
    { source_url: "https://other.example/services" },
    { source_observations: ["https://other.example/services"] },
    { verified: false },
    { provenance: "estimated" },
  ]) {
    assert.equal(certifiedServiceObservation({ evidence: [{ ...row, ...invalid }] }, name, sources), null);
  }
});

test("category defaults cannot be certified as observations", () => {
  assert.equal(certifiedServiceObservation({ evidence: [{ ...row, source_url: "" }] }, name, sources), null);
});
