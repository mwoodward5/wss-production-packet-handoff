"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const Module = require("node:module");
const candidate = process.env.WSS_INTAKE_PACKET_CANDIDATE;
if (candidate) {
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (parent?.filename === candidate && request.startsWith("./")) {
      return resolve.call(this, `../lib/${request.slice(2)}`, module, ...rest);
    }
    return resolve.call(this, request, parent, ...rest);
  };
}
const { intakePacketFromCanonical, mergeIntoContent } = require(candidate || "../lib/intake-packet");

const URL = "https://example.test/our-work";
const rows = {
  reviews: [{ quote: "The team arrived on time.", author: "Alex", source_url: URL, evidence: "The team arrived on time. Alex" }],
  hours: [{ value: "Monday: 9 AM - 5 PM", source_url: URL, evidence: "Monday: 9 AM - 5 PM" }],
  areas: [{ value: "Serving North City", source_url: URL, evidence: "Serving North City" }],
};
const files = {
  "content/home.md": "# Example Business\n",
  "content/reviews.md": "# Reviews\n\n> The team arrived on time.\n— Alex\n",
  "content/hours.md": "# Hours\n\n- Monday: 9 AM - 5 PM\n",
  "content/service-areas.md": "# Service Areas\n\n- Serving North City\n",
};

function packet({ depth = rows, pages = [URL], changedFiles = files } = {}) {
  return {
    discovery: { sources: pages, found: { depth_channels: depth } },
    content: { content_contract: {
      schema: "CertifiedPracticePacket/v1", kind: "certified_practice_packet", version: 1,
      facts: { category: "landscaping" }, builder_instructions: { public: false },
      visitor_copy: { kind: "visitor_copy", files: changedFiles,
        file_hashes: Object.fromEntries(Object.entries(changedFiles).map(([name, body]) =>
          [name, createHash("sha256").update(body).digest("hex")])),
        safety: { pass: true, violations: [] },
      },
    } },
  };
}

test("receipt-hashed, observed depth reaches MirrorContent without replacing prior verified channels", () => {
  const projected = intakePacketFromCanonical(packet());
  assert.equal(projected.ok, true);
  assert.deepEqual(projected.reviews, [{ text: "The team arrived on time.", author: "Alex" }]);
  assert.deepEqual(projected.hours, ["Monday: 9 AM - 5 PM"]);
  assert.deepEqual(projected.areas, ["Serving North City"]);
  const merged = mergeIntoContent({}, projected);
  assert.deepEqual(merged.reviews, projected.reviews);
  assert.deepEqual(merged.hours, projected.hours);
  assert.deepEqual(merged.areas, projected.areas);
  const prior = { reviews: [{ text: "Google review" }], hours: ["Tuesday: 10 AM"], areas: ["South City"] };
  assert.deepEqual(mergeIntoContent(prior, projected), prior);
});

test("missing or mismatched source evidence, observed page, or file bytes omits only that channel", () => {
  const unobserved = intakePacketFromCanonical(packet({ pages: [] }));
  assert.deepEqual([unobserved.reviews, unobserved.hours, unobserved.areas], [[], [], []]);
  const missingEvidence = structuredClone(rows);
  missingEvidence.reviews[0].evidence = "other words";
  const noReview = intakePacketFromCanonical(packet({ depth: missingEvidence }));
  assert.deepEqual(noReview.reviews, []);
  assert.equal(noReview.hours.length, 1);
  const bytesChanged = { ...files, "content/hours.md": "# Hours\n\n- Tuesday: 9 AM - 5 PM\n" };
  assert.deepEqual(intakePacketFromCanonical(packet({ changedFiles: bytesChanged })).hours, []);
  const badHash = packet();
  badHash.content.content_contract.visitor_copy.file_hashes["content/reviews.md"] = "0".repeat(64);
  assert.equal(intakePacketFromCanonical(badHash).ok, false);
});

test("absent depth channels stay absent", () => {
  const projected = intakePacketFromCanonical(packet({ depth: {}, changedFiles: { "content/home.md": files["content/home.md"] } }));
  assert.deepEqual(mergeIntoContent({}, projected), {});
});
