"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalWebsiteEvidence, summarize } = require("../api/admin/enrich-prospects");
const { highConfidenceSource } = require("../api/admin/held-drafts");

test("canonical website evidence remains held without reachability verification", () => {
  const row = {
    prospect_id: "p1",
    email: "hello@example.com",
    current_website: "https://example.com/contact",
    source: "places-live-mine",
  };
  assert.equal(canonicalWebsiteEvidence(row).length, 1);
  const report = summarize([row]);
  assert.equal(report.after.highConfidenceCount, 1);
  assert.equal(report.after.verifiedReachableCount, 0);
  assert.equal(report.after.sendableCount, 0);
  assert.equal(report.after.heldCount, 1);
});

test("unknown imported email is not promoted to public-source evidence", () => {
  const row = { email: "hello@example.com", current_website: "https://example.com" };
  assert.deepEqual(canonicalWebsiteEvidence(row), []);
  const report = summarize([row]);
  assert.equal(report.sourceBreakdown.unknownUnverified, 1);
});

test("review candidates require canonical public provenance", () => {
  assert.equal(highConfidenceSource({ email: "a@example.com", current_website: "https://example.com" }), false);
  assert.equal(highConfidenceSource({
    email: "a@example.com",
    current_website: "https://example.com",
    record: { truth_packet_source: "places_basic" },
  }), true);
});
