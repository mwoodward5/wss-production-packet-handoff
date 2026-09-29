import test from "node:test";
import assert from "node:assert/strict";
import { design } from "../../factory/pipeline/04-design.mjs";

function fixture(slug, category = "landscaping") {
  return {
    slug,
    business: { name: "Example Business", category, city: "Sacramento", state: "CA" },
    services: ["Lawn care"],
    enrichment_sources: {},
  };
}

test("design stage selects a sanitized newest-100 premium pattern deterministically", () => {
  const first = design(fixture("premium-pattern-one"));
  const second = design(fixture("premium-pattern-one"));
  assert.deepEqual(first.hero_pattern, second.hero_pattern);
  assert.equal(first.hero_pattern.cohort, "newest-100");
  assert.ok(first.hero_pattern.id);
  assert.ok(first.hero_family);
  assert.equal(JSON.stringify(first.hero_pattern).includes("http"), false);
});

test("batch index can vary the premium pull without leaking donor identity", () => {
  const patterns = new Set();
  for (let index = 0; index < 12; index += 1) {
    const result = design(fixture("premium-batch"), { batchIndex: index });
    patterns.add(result.hero_pattern.id);
    assert.equal(/github|repository|client|https?:/i.test(JSON.stringify(result.hero_pattern)), false);
  }
  assert.ok(patterns.size > 1);
});
