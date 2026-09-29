import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCanonicalPacket, normalizeInput } from "../lib/intake-genie-core.mjs";

const url = "https://lawn.example/about";
const input = normalizeInput({ name: "Lawn Works", city: "Reno", state: "NV", category: "landscaping", website_url: "https://lawn.example/" });
const facts = { name: "Lawn Works", city: "Reno", state: "NV", category: "landscaping", services: ["Lawn Care"] };

test("source-linked depth channels become sparse byte-hashed visitor files and evidence", () => {
  const packet = buildCanonicalPacket({ input, facts,
    discovery: { sources: [url], found: { services: ["Lawn Care"], depth_channels: {
      reviews: [{ quote: "They cared for our lawn all season.", author: "Pat R.", source_url: url, evidence: "> They cared for our lawn all season.\n— Pat R." }],
      hours: [{ value: "Monday 9am–5pm", source_url: url, evidence: "Monday 9am–5pm" }],
      faqs: [{ question: "Do you offer lawn care?", answer: "Yes, for residential lawns.", source_url: url, evidence: "Do you offer lawn care?\nYes, for residential lawns." }],
      areas: [{ value: "Reno", source_url: url, evidence: "- Reno" }],
    } } },
  });
  const visitor = packet.content.content_contract.visitor_copy;
  for (const path of ["content/reviews.md", "content/hours.md", "content/faq.md", "content/service-areas.md"]) {
    assert.equal(visitor.file_hashes[path], createHash("sha256").update(visitor.files[path]).digest("hex"));
  }
  assert.deepEqual(Object.keys(packet.facts.discovery.found.depth_channels).sort(), ["areas", "faqs", "hours", "reviews"]);
  assert.deepEqual(packet.evidence.filter((row) => ["areas", "faqs", "hours", "reviews"].includes(row.field)).map((row) => row.field).sort(), ["areas", "faqs", "hours", "reviews"]);
});

test("unlisted source URLs and unsupported values are omitted rather than invented", () => {
  const packet = buildCanonicalPacket({ input, facts,
    discovery: { sources: [url], found: { depth_channels: {
      reviews: [{ quote: "Great work", author: "Someone", source_url: "https://foreign.example/", evidence: "Great work Someone" }],
      hours: [{ value: "Open every day", source_url: url, evidence: "Other words" }],
    } } },
  });
  const files = packet.content.content_contract.visitor_copy.files;
  assert.equal(Object.hasOwn(files, "content/reviews.md"), false);
  assert.equal(Object.hasOwn(files, "content/hours.md"), false);
  assert.deepEqual(packet.facts.discovery.found.depth_channels, {});
});
