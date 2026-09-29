import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalPacket } from "../lib/intake-genie-core.mjs";

const site = "https://example.com/";
const page = "https://example.com/services";
const description = "We clear stubborn kitchen and bathroom drains with source-observed methods.";

function baseDiscovery() {
  return {
    sources: [page],
    facts: { website: site, name: "Example Plumbing" },
    found: {
      copy: `Drain Cleaning\n${description}`,
      services: ["Drain Cleaning"],
      service_observations: [{
        name: "Drain Cleaning",
        source_url: page,
        name_excerpt: "Drain Cleaning",
        description,
        description_excerpt: description,
      }],
    },
  };
}

function build(discovery) {
  return buildCanonicalPacket({
    input: { request_id: "depth-contract", sources: { website_url: site }, prospect_hints: {} },
    facts: { name: "Example Plumbing", city: "Irvine", state: "CA", category: "plumbing",
      website: site, services: ["Drain Cleaning"] },
    discovery,
    evidence: [{ field: "name", value: "Example Plumbing" }],
  });
}

test("certifies byte-bound service markdown and genuine depth channels", () => {
  const discovery = baseDiscovery();
  discovery.found.depth_channels = {
    reviews: [{ quote: "Fast and careful.", author: "A. Customer", source_url: page,
      evidence: "Fast and careful. — A. Customer",
      quote_excerpt: "Fast and careful.", author_excerpt: "A. Customer" }],
    hours: [{ value: "Mon-Fri 8am-5pm", source_url: page,
      evidence: "Mon-Fri 8am-5pm", value_excerpt: "Mon-Fri 8am-5pm" }],
    faqs: [{ question: "Do you clear kitchen drains?", answer: "Yes, when source conditions allow.",
      source_url: page, evidence: "Do you clear kitchen drains? Yes, when source conditions allow.",
      question_excerpt: "Do you clear kitchen drains?", answer_excerpt: "Yes, when source conditions allow." }],
    areas: [{ value: "Irvine, CA", source_url: page,
      evidence: "Irvine, CA", value_excerpt: "Irvine, CA" }],
  };
  const packet = build(discovery);
  const files = packet.content.content_contract.visitor_copy.files;

  assert.equal(packet.facts.services_source, "source_bound");
  assert.equal(files["content/services/drain-cleaning.md"], `# Drain Cleaning\n\n${description}\n`);
  assert.equal(files["content/services/drain-cleaning.md"].split("\n\n")[1].slice(0, -1), description);
  assert.match(files["content/reviews.md"], /Fast and careful\./);
  assert.match(files["content/hours.md"], /Mon-Fri 8am-5pm/);
  assert.match(files["content/faq.md"], /Do you clear kitchen drains\?/);
  assert.match(files["content/service-areas.md"], /Irvine, CA/);
  assert.deepEqual(Object.keys(packet.discovery.found.depth_channels).sort(),
    ["areas", "faqs", "hours", "reviews"]);
});

test("omits unavailable depth channels instead of inventing content", () => {
  const packet = build(baseDiscovery());
  const files = packet.content.content_contract.visitor_copy.files;

  assert.equal(packet.facts.services_source, "source_bound");
  assert.ok(!("content/reviews.md" in files));
  assert.ok(!("content/hours.md" in files));
  assert.ok(!("content/faq.md" in files));
  assert.ok(!("content/service-areas.md" in files));
  assert.ok(!packet.discovery.found.depth_channels
    || Object.keys(packet.discovery.found.depth_channels).length === 0);
});

test("refuses unverified service/depth inputs from certified output", () => {
  const discovery = baseDiscovery();
  discovery.found.service_observations[0].description_excerpt = "Different source text.";
  discovery.found.depth_channels = {
    reviews: [{ quote: "Invented review", author: "Nobody", source_url: "https://other.example/reviews",
      evidence: "Invented review", quote_excerpt: "Invented review", author_excerpt: "Nobody" }],
    hours: [{ value: "Open 24/7", source_url: page,
      evidence: "Hours differ", value_excerpt: "Hours differ" }],
  };

  const packet = build(discovery);
  const files = packet.content.content_contract.visitor_copy.files;
  assert.notEqual(packet.facts.services_source, "source_bound");
  assert.equal(Object.keys(files).filter((name) => name.startsWith("content/services/")).length, 0);
  assert.ok(!("content/reviews.md" in files));
  assert.ok(!("content/hours.md" in files));
});
