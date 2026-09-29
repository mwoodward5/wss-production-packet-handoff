import assert from "node:assert/strict";
import test from "node:test";

import {
  getLovablePatternCatalog,
  normalizeTrade,
  pickHeroPattern,
  pickLovablePattern,
  validateLovablePatternCatalog,
} from "./lovable-pattern-catalog.mjs";

test("catalog is sanitized and represents the full newest-100 cohort", () => {
  const catalog = getLovablePatternCatalog();
  assert.equal(catalog.evidence.cohort_size, 100);
  assert.equal(catalog.evidence.mirrored_size, 100);
  assert.equal(validateLovablePatternCatalog(catalog).valid, true);
  assert.ok(catalog.patterns.every((pattern) => pattern.priority >= 1));
});

test("picker is deterministic by slug and trade", () => {
  const first = pickLovablePattern({ slug: "alpha-site", trade: "roofing" });
  assert.deepEqual(first, pickLovablePattern({ slug: "alpha-site", trade: "roofing" }));
  assert.deepEqual(first, pickHeroPattern("alpha-site", "roofing"));
});

test("picker prefers a trade-compatible family", () => {
  const pattern = pickLovablePattern({ slug: "material-site", trade: "concrete" });
  assert.ok(pattern.trades.includes("concrete"));
});

test("trade normalization is stable and empty input has a fallback", () => {
  assert.equal(normalizeTrade("  HVAC / repair "), "hvac");
  assert.equal(normalizeTrade(""), "default");
  assert.equal(normalizeTrade(null), "default");
});

test("validator rejects URLs, source paths, and client identity fields", () => {
  const result = validateLovablePatternCatalog({
    schema: "siteforge-lovable-runtime-catalog-v2",
    policy: {},
    patterns: [{ id: "bad", trades: ["default"], source: "https://example.test/client" }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("unsanitized:bad")));
});
