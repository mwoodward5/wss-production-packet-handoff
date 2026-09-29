import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCanonicalPacket, normalizeInput } from "../lib/intake-genie-core.mjs";

// Identities and failure modes are from line_mulzq577_gbahacaife. The batch row
// stores no crawled page excerpts. Text below is synthetic test input, never a
// claim that the named websites publish these words.
const cases = {
  contractor: {
    name: "CLE Remodeling Co", city: "Cleveland", state: "OH",
    category: "general contractor", website: "https://www.cleremodelingco.com/",
    priorFailure: "spa_v2_no_compatible_donor",
  },
  landscape: {
    name: "Custom Lawn", city: "Kansas City", state: "MO",
    category: "landscaping", website: "https://customlawn.com/",
    priorFailure: "mirror_build_acceptance_failed",
  },
};

function packetFor(subject, discovery) {
  const input = normalizeInput({ name: subject.name, city: subject.city, state: subject.state,
    category: subject.category, website_url: subject.website });
  return buildCanonicalPacket({ input,
    facts: { name: subject.name, city: subject.city, state: subject.state,
      category: subject.category, services: discovery.found.services || [] },
    discovery });
}

function assertHashes(visitor) {
  assert.deepEqual(Object.keys(visitor.files).sort(), Object.keys(visitor.file_hashes).sort());
  for (const [path, body] of Object.entries(visitor.files)) {
    assert.equal(visitor.file_hashes[path], createHash("sha256").update(body).digest("hex"));
  }
}

test("real failed contractor identity: synthetic source observation binds each service file by bytes", () => {
  const subject = cases.contractor;
  const packet = packetFor(subject, { sources: [subject.website], found: {
    services: ["Custom Homes", "Home Remodeling"],
    copy: "SYNTHETIC FIXTURE: Custom Homes and Home Remodeling.",
    service_observations: [
      { name: "Custom Homes", source_url: subject.website,
        description: "Synthetic fixture: we build custom homes for local clients.",
        excerpt: "## Custom Homes\nSynthetic fixture: we build custom homes for local clients." },
      { name: "Home Remodeling", source_url: subject.website,
        description: "Synthetic fixture: we remodel homes for local clients.",
        excerpt: "## Home Remodeling\nSynthetic fixture: we remodel homes for local clients." },
    ],
  } });
  const visitor = packet.content.content_contract.visitor_copy;
  assertHashes(visitor);
  assert.deepEqual(Object.keys(visitor.files).filter((p) => p.startsWith("content/services/")).sort(),
    ["content/services/custom-homes.md", "content/services/home-remodeling.md"]);
  assert.equal(packet.evidence.some((row) => row.field === "services" && row.source_url === subject.website), true);
});

test("real failed contractor identity: synthetic heading without prose stays unavailable", () => {
  const subject = cases.contractor;
  const packet = packetFor(subject, { sources: [subject.website], found: {
    services: ["Home Remodeling"], copy: "Home Remodeling",
    service_observations: [{ name: "Home Remodeling", source_url: subject.website, excerpt: "## Home Remodeling" }],
  } });
  assert.equal(Object.keys(packet.content.content_contract.visitor_copy.files)
    .some((path) => path.startsWith("content/services/")), false);
});

test("real failed landscaping identity: synthetic excerpt can certify sparse depth channels", () => {
  const subject = cases.landscape;
  const packet = packetFor(subject, { sources: [subject.website], found: {
    services: ["Lawn Care"], copy: "SYNTHETIC FIXTURE: Lawn Care.",
    depth_channels: {
      hours: [{ value: "Monday 9am–5pm", source_url: subject.website,
        evidence: "SYNTHETIC FIXTURE: Monday 9am–5pm" }],
      areas: [{ value: "Kansas City", source_url: subject.website,
        evidence: "SYNTHETIC FIXTURE: Kansas City" }],
    },
  } });
  const visitor = packet.content.content_contract.visitor_copy;
  assertHashes(visitor);
  assert.equal(Object.hasOwn(visitor.files, "content/hours.md"), true);
  assert.equal(Object.hasOwn(visitor.files, "content/service-areas.md"), true);
  assert.equal(Object.hasOwn(visitor.files, "content/reviews.md"), false);
  assert.equal(Object.hasOwn(visitor.files, "content/faq.md"), false);
  assert.deepEqual(Object.keys(packet.facts.discovery.found.depth_channels).sort(), ["areas", "hours"]);
});

test("real failed identities remain thin when no source excerpt exists", () => {
  for (const subject of Object.values(cases)) {
    const packet = packetFor(subject, { sources: [subject.website], found: {} });
    const visitor = packet.content.content_contract.visitor_copy;
    assertHashes(visitor);
    assert.equal(Object.keys(visitor.files).some((p) => p.startsWith("content/services/")), false);
    for (const path of ["content/reviews.md", "content/hours.md", "content/faq.md", "content/service-areas.md"]) {
      assert.equal(Object.hasOwn(visitor.files, path), false);
    }
  }
});

test("Custom Lawn operator name survives a corroborating owned SEO page title", () => {
  const subject = cases.landscape;
  const title = "Lawn Care & Landscaping in Kansas City | Custom Lawn & Landscape";
  const input = normalizeInput({ name: subject.name, city: subject.city, state: subject.state,
    category: subject.category, website_url: subject.website });
  const packet = buildCanonicalPacket({ input,
    facts: { name: title, city: subject.city, state: subject.state, category: subject.category, services: [] },
    discovery: { sources: [subject.website], facts: { name: title, website: subject.website }, found: { copy: title } },
  });
  assert.equal(packet.facts.name, "Custom Lawn");
  assert.equal(packet.remix_packet?.prospect?.name?.value, "Custom Lawn");

  const conflicting = buildCanonicalPacket({ input,
    facts: { name: "Other Lawn & Landscape", name_conflict: { supplied: "Custom Lawn", source: "Other Lawn & Landscape" },
      city: subject.city, state: subject.state, category: subject.category, services: [] },
    discovery: { sources: [subject.website], facts: { name: "Other Lawn & Landscape", website: subject.website }, found: { copy: "Other Lawn & Landscape" } },
  });
  assert.notEqual(conflicting.facts.name, "Custom Lawn");
});
