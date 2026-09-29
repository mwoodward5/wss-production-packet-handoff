import test from "node:test";
import assert from "node:assert/strict";
import { verifiedCitations } from "../../factory/pipeline/05-build-v8.mjs";

test("citations render only verified http(s) profiles on known platforms", () => {
  const packet = {
    enrichment_sources: {
      socials: { value: [
        "https://www.facebook.com/richarddiazlandscape",
        "https://www.yelp.com/biz/richard-diaz-fresno",
        { url: "https://maps.app.goo.gl/abc123", source: "gbp" },
        "https://unknown-directory.example/listing",
        "not-a-url",
      ] },
    },
  };
  const chips = verifiedCitations(packet);
  assert.deepEqual(chips.map((c) => c.label).sort(), ["Facebook", "Google Business Profile", "Yelp"]);
  for (const chip of chips) assert.match(chip.url, /^https:\/\//);
});

test("fabricated provenance and duplicates are rejected", () => {
  const packet = {
    trust: { citations: [
      { url: "https://www.yelp.com/biz/a", source: "ai-generated" },
      { url: "https://www.yelp.com/biz/b", source: "site" },
      { url: "https://www.yelp.com/biz/c", source: "site" },
    ] },
  };
  const chips = verifiedCitations(packet);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].url, "https://www.yelp.com/biz/b");
});

test("no citations means no strip data (never invented)", () => {
  assert.deepEqual(verifiedCitations({}), []);
  assert.deepEqual(verifiedCitations({ business: { socials: ["ftp://x", ""] } }), []);
});
