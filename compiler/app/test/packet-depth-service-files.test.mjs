import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCanonicalPacket, normalizeInput } from "../lib/intake-genie-core.mjs";

const input = normalizeInput({ name: "Allied Concrete Solutions", city: "Los Angeles", state: "CA", category: "concrete", website_url: "https://allied.example/" });

test("source observed services emit exact byte-hashed markdown; unobserved claims do not", () => {
  const packet = buildCanonicalPacket({
    input,
    facts: { name: "Allied Concrete Solutions", city: "Los Angeles", state: "CA", category: "concrete", services: ["Concrete Patios", "Concrete Driveways", "Unobserved Service"] },
    discovery: { sources: ["https://allied.example/services"], found: {
      services: ["Concrete Patios", "Concrete Driveways"], copy: "Concrete Patios and Concrete Driveways",
      service_observations: [
        { name: "Concrete Patios", source_url: "https://allied.example/services", description: "We install concrete patios for outdoor living spaces.", excerpt: "## Concrete Patios\nWe install concrete patios for outdoor living spaces." },
        { name: "Concrete Driveways", source_url: "https://allied.example/services", description: "We build concrete driveways for residential properties.", excerpt: "## Concrete Driveways\nWe build concrete driveways for residential properties." },
      ],
    } },
  });
  const visitor = packet.content.content_contract.visitor_copy;
  const servicePaths = Object.keys(visitor.files).filter((path) => path.startsWith("content/services/")).sort();
  assert.deepEqual(servicePaths, ["content/services/concrete-driveways.md", "content/services/concrete-patios.md"]);
  for (const path of servicePaths) {
    assert.equal(visitor.file_hashes[path], createHash("sha256").update(visitor.files[path]).digest("hex"));
    assert.match(visitor.files[path], /^# Concrete /);
    assert.match(visitor.files[path], /\n\n.{20,}/);
  }
  assert.equal(Object.hasOwn(visitor.files, "content/services/unobserved-service.md"), false);
  assert.deepEqual(Object.keys(visitor.files).sort(), Object.keys(visitor.file_hashes).sort());
});

test("heading-only observations never create service files", () => {
  const packet = buildCanonicalPacket({
    input,
    facts: { name: "Allied Concrete Solutions", city: "Los Angeles", state: "CA", category: "concrete", services: ["Concrete Patios"] },
    discovery: { sources: ["https://allied.example/services"], found: {
      services: ["Concrete Patios"], copy: "Concrete Patios",
      service_observations: [{ name: "Concrete Patios", source_url: "https://allied.example/services", excerpt: "## Concrete Patios" }],
    } },
  });
  assert.equal(Object.keys(packet.content.content_contract.visitor_copy.files).some((path) => path.startsWith("content/services/")), false);
});

test("category estimates and missing source URL never produce certified service files", () => {
  for (const sourceUrl of ["", undefined]) {
    const packet = buildCanonicalPacket({
      input: { ...input, sources: { website_url: sourceUrl } },
      facts: { name: "Allied Concrete Solutions", city: "Los Angeles", state: "CA", category: "concrete", services: ["Concrete Patios"] },
      discovery: { found: { services: sourceUrl ? [] : ["Concrete Patios"], copy: "" } },
    });
    assert.equal(Object.keys(packet.content.content_contract.visitor_copy.files).some((path) => path.startsWith("content/services/")), false);
  }
});
