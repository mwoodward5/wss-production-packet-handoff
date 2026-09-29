"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const quota = require("../lib/line-quota");
const { REGION_TOKENS, ZIP_MARKETS, marketTokenLocation } = require("../lib/market-tokens");
const { metroOfPlan } = require("../lib/lead-miner");

// Every target the quota source emits must stay parseable by the Line's
// frozen pick contract: "<approved trade> in <market>".
const TARGET_SHAPE = /^(.+?)\s+in\s+(.+)$/;

function batchWithAttempts(attempt, overrides = {}) {
  const mineFunnel = [{ stage: quota.QUOTA_CONTRACT_STAGE, entered: 10, survived: 0, rejected: {} }];
  for (let index = 0; index < attempt; index += 1) {
    mineFunnel.push({ stage: `quota_source_${index}_plumbing_in_houston_tx`, entered: 10, survived: 0, rejected: {} });
  }
  return {
    batchId: "batch-shape-rotation",
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    rows: [],
    mineFunnel,
    ...overrides,
  };
}

test("region ladder holds ~20 unique single-state region tokens", () => {
  assert.ok(REGION_TOKENS.length >= 20, `expected at least 20 region tokens, found ${REGION_TOKENS.length}`);
  const tokens = new Set();
  for (const entry of REGION_TOKENS) {
    assert.match(entry.token, /^[A-Z][A-Za-z ]+ [A-Z][A-Za-z]+$/, `region token must be words: ${entry.token}`);
    assert.match(entry.state, /^[A-Z]{2}$/, `region state must be a 2-letter code: ${entry.token} -> ${entry.state}`);
    assert.ok(!tokens.has(entry.token), `duplicate region token: ${entry.token}`);
    tokens.add(entry.token);
  }
  // The directive's canonical examples must be present.
  for (const expected of ["West Texas", "East Tennessee", "North Florida"]) {
    assert.ok(tokens.has(expected), `region ladder is missing ${expected}`);
  }
});

test("zip ladder holds ~100 unique real 5-digit zips spanning many states", () => {
  assert.ok(ZIP_MARKETS.length >= 100, `expected at least 100 zips, found ${ZIP_MARKETS.length}`);
  const zips = new Set();
  const states = new Set();
  for (const entry of ZIP_MARKETS) {
    assert.match(entry.zip, /^\d{5}$/, `zip must be 5 digits: ${JSON.stringify(entry)}`);
    assert.match(entry.state, /^[A-Z]{2}$/, `zip state must be a 2-letter code: ${JSON.stringify(entry)}`);
    assert.ok(String(entry.city || "").trim().length >= 2, `zip needs a real city name: ${JSON.stringify(entry)}`);
    assert.ok(!zips.has(entry.zip), `duplicate zip: ${entry.zip}`);
    zips.add(entry.zip);
    states.add(entry.state);
  }
  assert.ok(states.size >= 40, `expected the starter ladder to span 40+ states, found ${states.size}`);
  // The directive's West Texas starter set must be present with true cities.
  const byZip = new Map(ZIP_MARKETS.map((entry) => [entry.zip, entry]));
  assert.deepEqual(
    ["79401", "79109", "79901", "76903"].map((zip) => byZip.get(zip)),
    [
      { zip: "79401", city: "Lubbock", state: "TX" },
      { zip: "79109", city: "Amarillo", state: "TX" },
      { zip: "79901", city: "El Paso", state: "TX" },
      { zip: "76903", city: "San Angelo", state: "TX" },
    ],
  );
});

test("market token resolution answers only for exact ladder tokens", () => {
  assert.deepEqual(marketTokenLocation("West Texas"), { city: "West Texas", state: "TX" });
  assert.deepEqual(marketTokenLocation("west  texas"), { city: "West Texas", state: "TX" });
  assert.deepEqual(marketTokenLocation("79401"), { city: "79401", state: "TX" });
  assert.equal(marketTokenLocation("Lubbock TX"), null, "an ordinary metro is not a ladder token");
  assert.equal(marketTokenLocation("7940"), null, "a 4-digit string is not a zip");
  assert.equal(marketTokenLocation("12345"), null, "a zip outside the starter ladder resolves to nothing");
});

test("metroOfPlan fences region and zip ladder tokens at their true state line", () => {
  assert.deepEqual(metroOfPlan("West Texas"), { city: "West Texas", state: "TX" });
  assert.deepEqual(metroOfPlan("East Tennessee"), { city: "East Tennessee", state: "TN" });
  assert.deepEqual(metroOfPlan("79401"), { city: "79401", state: "TX" });
  // Ordinary metros keep their exact historical behavior.
  assert.deepEqual(metroOfPlan("Lubbock TX"), { city: "Lubbock", state: "TX" });
  assert.deepEqual(metroOfPlan("Washington DC"), { city: "Washington", state: "DC" });
  assert.deepEqual(metroOfPlan("Springfield"), { city: "Springfield", state: "" });
});

test("query shape rotates metro -> region -> zip deterministically per attempt", () => {
  const seen = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const source = quota.nextQuotaSource(batchWithAttempts(attempt), {
      verticals: [{ vertical: "plumbing" }, { vertical: "roofing" }],
    });
    assert.equal(source.mode, "fresh_all_trades_balanced");
    assert.match(source.target, TARGET_SHAPE, `attempt ${attempt} target must stay parseable: ${source.target}`);
    seen.push(source.queryShape);
  }
  assert.deepEqual(seen, ["metro", "region", "zip", "metro", "region", "zip", "metro"]);
});

test("one campaign's rotation is deterministic and retries repeat exactly", () => {
  const options = { verticals: [{ vertical: "plumbing" }] };
  const first = quota.nextQuotaSource(batchWithAttempts(1), options);
  const retry = quota.nextQuotaSource(batchWithAttempts(1), options);
  assert.deepEqual(retry, first, "the same batch and attempt must produce the same source");
  // Attempt 1 is a region token drawn from the region ladder.
  assert.equal(first.queryShape, "region");
  assert.ok(REGION_TOKENS.some((entry) => first.target.endsWith(`in ${entry.token}`)), first.target);
});

test("different campaigns start the region and zip ladders at different offsets", () => {
  const regionTargets = new Set();
  const zipTargets = new Set();
  for (let index = 0; index < 12; index += 1) {
    const batch = batchWithAttempts(1, { batchId: `batch-shape-${index}` });
    regionTargets.add(quota.nextQuotaSource(batch, { verticals: [{ vertical: "plumbing" }] }).target);
    const zipBatch = batchWithAttempts(2, { batchId: `batch-shape-${index}` });
    zipTargets.add(quota.nextQuotaSource(zipBatch, { verticals: [{ vertical: "plumbing" }] }).target);
  }
  assert.ok(regionTargets.size > 1, `region ladder offsets must spread across campaigns, saw ${regionTargets.size}`);
  assert.ok(zipTargets.size > 1, `zip ladder offsets must spread across campaigns, saw ${zipTargets.size}`);
  for (const target of zipTargets) {
    assert.match(target, / in \d{5}$/, `attempt-2 targets must be zip shapes: ${target}`);
  }
});

test("nationwide vertical targets rotate shapes too, attempt 0 unchanged on the first metro", () => {
  const batchId = "batch-nationwide-shapes";
  const sources = [0, 1, 2, 3].map((attempt) => quota.nextQuotaSource(
    batchWithAttempts(attempt, { target: "plumbing nationwide", batchId }),
  ));
  assert.equal(sources[0].target, `plumbing in ${quota.NATIONWIDE_METROS[0]}`, "attempt 0 keeps the historical first metro");
  assert.equal(sources[0].mode, "fresh_nationwide");
  assert.deepEqual(
    sources.map((source) => source.queryShape),
    ["metro", "region", "zip", "metro"],
  );
  for (const source of sources) {
    assert.match(source.target, TARGET_SHAPE, source.target);
  }
});
