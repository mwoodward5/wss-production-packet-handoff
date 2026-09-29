"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { mineBuildReady, mineLeads } = require("../lib/lead-miner");
const { CircuitBreaker } = require("../lib/discovery-health");
const { pickProspects } = require("../lib/line-adapters");
const { createLineContinuation } = require("../lib/line-continuation");
const quota = require("../lib/line-quota");

const FIRECRAWL_SEARCH = "https://api.firecrawl.dev/v1/search";
const NOW = "2026-08-29T18:00:00.000Z";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function operatorInput(fetchImpl, refillRound) {
  return {
    trigger: "operator_line",
    queries: [{
      industry: "plumbing",
      location: "Spokane WA",
      textQuery: "plumbing in Spokane WA",
      queryGroup: 0,
      queryShapeIndex: 0,
      queryShapeCount: 2,
    }],
    candidatesPerQuery: 1,
    refillRound,
    sourceMode: "fixed_market",
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
    },
    fetchImpl,
    discoveryBreaker: new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 }),
  };
}

test("two operator query shapes cost two Firecrawl searches, then emit a PII-free terminal contract", async () => {
  let searchCalls = 0;
  const fetchImpl = async (url) => {
    assert.equal(String(url), FIRECRAWL_SEARCH);
    searchCalls += 1;
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const first = await mineBuildReady(operatorInput(fetchImpl, 0));
  const second = await mineBuildReady(operatorInput(fetchImpl, 1));
  const exhausted = await mineBuildReady(operatorInput(fetchImpl, 2));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(exhausted.ok, true);
  assert.equal(first.cost.firecrawl_search_calls, 1);
  assert.equal(second.cost.firecrawl_search_calls, 1);
  assert.equal(first.cost.places_calls, 0);
  assert.equal(second.cost.places_calls, 0);
  assert.equal(exhausted.cost.firecrawl_search_calls, 0);
  assert.equal(exhausted.cost.places_calls, 0);
  assert.equal(searchCalls, 2, "two website-search shapes and no Places calls");
  assert.equal(first.source_exhausted, undefined);
  assert.equal(second.source_exhausted, undefined);
  assert.deepEqual(exhausted.source_exhausted, {
    exhausted: true,
    reason: "operator_query_cycle_exhausted",
    refill_round: 2,
  });
  assert.deepEqual(Object.keys(exhausted.source_exhausted).sort(), ["exhausted", "reason", "refill_round"]);
});

test("a new nationwide market is not mistaken for a repeated fixed-market query", async () => {
  let searchCalls = 0;
  const input = operatorInput(async (url) => {
    assert.equal(String(url), FIRECRAWL_SEARCH);
    searchCalls += 1;
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }, 2);
  input.sourceMode = "fresh_nationwide";
  input.queries[0].location = "Boise ID";
  input.queries[0].textQuery = "plumbing in Boise ID";

  const out = await mineBuildReady(input);

  assert.equal(out.ok, true);
  assert.equal(out.source_exhausted, undefined);
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(out.cost.places_calls, 0);
  assert.equal(searchCalls, 1, "a new market gets its one bounded Firecrawl search");
});

test("the Line adapter allowlists only the source-exhausted primitives", async () => {
  const mineInputs = [];
  const picked = await pickProspects({
    target: "plumbing in Spokane WA",
    campaignTarget: "plumbing in Spokane WA",
    sourceMode: "fixed_market",
    count: 1,
    lane: "sandbox",
    refillRound: 2,
    operationKey: "batch-source-stop:pick:2",
  }, {
    mineLeads: async (input) => {
      mineInputs.push(clone(input));
      return {
        ok: true,
        rows: [],
        funnel: [{ stage: "1_discovery_firecrawl", entered: 0, survived: 0, rejected: {} }],
        sourceExhausted: {
          exhausted: true,
          reason: "operator_query_cycle_exhausted",
          refill_round: 2,
          query: "must-not-cross-the-boundary",
          prospect: "must-not-cross-the-boundary",
        },
      };
    },
    select: async () => { throw new Error("historical shelf must not replace proven fresh-source exhaustion"); },
  });

  assert.equal(picked.length, 0);
  assert.equal(mineInputs.length, 1);
  assert.equal(mineInputs[0].refillRound, 2);
  assert.equal(mineInputs[0].sourceMode, "fixed_market");
  assert.deepEqual(picked.sourceExhausted, {
    exhausted: true,
    reason: "operator_query_cycle_exhausted",
    refillRound: 2,
  });
});

test("the top-level miner returns exhaustion without touching the prospect index", async () => {
  let persistenceCalls = 0;
  const sourceContract = {
    exhausted: true,
    reason: "operator_query_cycle_exhausted",
    refill_round: 2,
  };
  const out = await mineLeads({
    industry: "plumbing",
    location: "Spokane WA",
    limit: 1,
    trigger: "operator_line",
    refillRound: 2,
    mineBuildReady: async () => ({
      ok: true,
      mode: "build_ready",
      funnel: [
        { stage: "0_vertical_donor_gate", entered: 1, survived: 1, rejected: {} },
        { stage: "1_discovery_firecrawl", entered: 0, survived: 0, rejected: {} },
      ],
      cost: { firecrawl_search_calls: 0, places_calls: 0 },
      records: [],
      held_rows: [],
      rejects: [],
      source_exhausted: sourceContract,
      provider_health: { mode: "skipped_zero_google" },
      buildable_verticals: ["plumbing"],
    }),
    persistMinedRows: async () => {
      persistenceCalls += 1;
      throw new Error("a rowless terminal source must not read or write the prospect index");
    },
  });

  assert.equal(out.ok, true);
  assert.equal(persistenceCalls, 0);
  assert.deepEqual(out.sourceExhausted, sourceContract);
  assert.deepEqual(out.rows, []);
});

class BatchPersistence {
  constructor() {
    this.batch = {
      batchId: "batch-source-stop",
      lane: "sandbox",
      target: "plumbing in Spokane WA",
      requested: 1,
      status: "building",
      pickState: "pending",
      mineFunnel: [{
        stage: quota.QUOTA_CONTRACT_STAGE,
        entered: 1,
        survived: 0,
        rejected: {},
      }],
      approval: null,
      haltReason: "",
      version: 0,
      startedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      settledAt: null,
      sentAt: null,
      rows: [],
    };
  }

  async loadBatch(batchId) {
    return batchId === this.batch.batchId
      ? { ok: true, batch: clone(this.batch) }
      : { ok: false, error: "batch_not_found" };
  }

  async storeBatch({ batchId, expectedVersion, expectedStatus, patch }) {
    if (batchId !== this.batch.batchId
      || expectedVersion !== this.batch.version
      || (expectedStatus && expectedStatus !== this.batch.status)) {
      return { ok: false, conflict: true, error: "batch_version_conflict" };
    }
    this.batch = {
      ...this.batch,
      ...clone(patch),
      version: this.batch.version + 1,
      updatedAt: NOW,
    };
    return { ok: true, updated: true, batch: clone(this.batch) };
  }

  async storeRows({ batchId, rows }) {
    assert.equal(batchId, this.batch.batchId);
    assert.equal(rows.length, 0, "an exhausted source cannot materialize a row");
    return { ok: true, created: 0, rows: [] };
  }
}

test("the third pass halts immediately and duplicate work cannot republish or re-mine", async (t) => {
  const priorFastRefill = process.env.GHOST_AGENCY_LINE_FAST_REFILL;
  delete process.env.GHOST_AGENCY_LINE_FAST_REFILL;
  t.after(() => {
    if (priorFastRefill === undefined) delete process.env.GHOST_AGENCY_LINE_FAST_REFILL;
    else process.env.GHOST_AGENCY_LINE_FAST_REFILL = priorFastRefill;
  });

  const persistence = new BatchPersistence();
  const pickRounds = [];
  const publications = [];
  const service = createLineContinuation({
    persistence,
    clock: () => Date.parse(NOW),
    now: () => NOW,
    workerId: () => "worker-source-stop",
    pickTimeoutMs: 1_000,
    rowFanout: false,
    inlinePickQualification: false,
    pick: async ({ refillRound }) => {
      pickRounds.push(refillRound);
      const selected = [];
      selected.funnel = [{
        stage: "1_discovery_firecrawl",
        entered: 0,
        survived: 0,
        rejected: {},
      }];
      if (refillRound === 2) {
        selected.sourceExhausted = {
          exhausted: true,
          reason: "operator_query_cycle_exhausted",
          refillRound,
        };
      }
      return selected;
    },
    enqueueLineMessage: async (message) => {
      publications.push(clone(message));
      return { accepted: true, messageId: `source-stop-${publications.length}` };
    },
  });

  const run = () => service.processLineMessage({
    batchId: persistence.batch.batchId,
    phase: "run",
    sequence: persistence.batch.version,
  });

  const first = await run();
  const second = await run();
  const third = await run();
  const duplicate = await run();

  assert.deepEqual(pickRounds, [0, 1, 2]);
  assert.equal(first.queueAccepted, true);
  assert.equal(second.queueAccepted, true);
  assert.equal(third.queueAccepted, false);
  assert.equal(third.status, "halted");
  assert.equal(duplicate.skipped, "batch_halted");
  assert.equal(persistence.batch.status, "halted");
  assert.equal(persistence.batch.pickState, "complete");
  assert.equal(persistence.batch.haltReason, "operator_query_cycle_exhausted");
  assert.equal(quota.sourceAttempt(persistence.batch.mineFunnel), 3);
  const terminalMarker = persistence.batch.mineFunnel.find((row) => (
    String(row.stage || "").startsWith(quota.QUOTA_SOURCE_PREFIX)
      && row.provider_attempted === false
  ));
  assert.ok(terminalMarker, JSON.stringify(persistence.batch.mineFunnel));
  assert.equal(terminalMarker.terminal, true);
  assert.deepEqual(terminalMarker.rejected, { operator_query_cycle_exhausted: 1 });
  assert.doesNotMatch(JSON.stringify(terminalMarker), /produced no new|rotating automatically/i);
  assert.equal(publications.length, 2, "only the first two search-shape passes publish another source");
});
