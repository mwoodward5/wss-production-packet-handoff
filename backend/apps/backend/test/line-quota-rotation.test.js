"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_REFILL_ATTEMPTS,
  QUOTA_CONTRACT_STAGE,
  nextQuotaSource,
  replacementDeficit,
  mergeMineFunnel,
  shouldRefill,
  sourceAttempt,
  sourceExhausted,
} = require("../lib/line-quota");

function quotaBatch(rows = [], overrides = {}) {
  return {
    target: "all trades nationwide",
    requested: 10,
    status: "building",
    rows,
    mineFunnel: [{ stage: QUOTA_CONTRACT_STAGE }],
    ...overrides,
  };
}

test("bounded funnel history advances from highest durable source marker instead of repeating its count", () => {
  const diagnostics = Array.from({ length: 70 }, (_, i) => ({ stage: `diagnostic_${i}` }));
  const mineFunnel = [
    { stage: QUOTA_CONTRACT_STAGE },
    { stage: "quota_source_7_salon_in_phoenix_az" },
    ...diagnostics.slice(0, 35),
    { stage: "quota_source_8_salon_in_phoenix_az" },
    ...diagnostics.slice(35),
    { stage: "quota_source_9_tattoo_in_tucson_az" },
  ];
  assert.equal(sourceAttempt(mineFunnel), 10);
});

test("All Trades source actually moves past attempt 9", () => {
  const batch = {
    target: "all trades nationwide",
    requested: 10,
    rows: [],
    mineFunnel: [
      { stage: QUOTA_CONTRACT_STAGE },
      { stage: "quota_source_8_salon_in_phoenix_az" },
      { stage: "quota_source_9_tattoo_in_tucson_az" },
    ],
  };
  const source = nextQuotaSource(batch, {
    verticals: [
      { vertical: "plumbing" },
      { vertical: "hvac" },
      { vertical: "landscaping" },
      { vertical: "tattoo" },
    ],
    metros: ["Houston TX", "Dallas TX", "Tucson AZ", "Denver CO"],
  });
  assert.equal(source.attempt, 10);
  assert.notEqual(source.target, "tattoo in Tucson AZ");
});

test("replacement deficit counts finished and active rows so 5/1/4 refills exactly four", () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, index) => ({ prospectId: `finished-${index}`, status: "queued" })),
    { prospectId: "active-1", status: "picked" },
    ...Array.from({ length: 4 }, (_, index) => ({ prospectId: `failed-${index}`, status: "rejected" })),
  ];
  const batch = quotaBatch(rows);

  assert.equal(replacementDeficit(batch), 4);
  assert.equal(shouldRefill(batch), true, "an active row no longer blocks replacement mining");
  assert.equal(nextQuotaSource(batch).chunk, 4);
});

test("halted is absolute even while finished quota still reports one site needed", () => {
  const batch = quotaBatch([], { requested: 1, status: "halted" });
  assert.equal(replacementDeficit(batch), 1);
  assert.equal(shouldRefill(batch), false);
  assert.deepEqual(nextQuotaSource(batch), {
    target: "",
    attempt: 0,
    mode: "batch_halted",
    chunk: 0,
    unavailable: true,
    reason: "batch_halted",
  });
});

test("All Trades attempts zero and one use fresh balanced sources", () => {
  const source = nextQuotaSource(quotaBatch());

  assert.equal(source.attempt, 0);
  assert.notEqual(source.target, "leadminer");
  assert.equal(source.mode, "fresh_all_trades_balanced");
  assert.equal(source.chunk, 10);

  const retry = nextQuotaSource(quotaBatch([], {
    mineFunnel: [
      { stage: QUOTA_CONTRACT_STAGE },
      { stage: `quota_source_0_${source.target.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}` },
    ],
  }));
  assert.equal(retry.attempt, 1);
  assert.notEqual(retry.target, "leadminer");
  assert.equal(retry.mode, "fresh_all_trades_balanced");
  assert.equal(retry.chunk, 10);
});

test("GHOST_AGENCY_LINE_GAPLESS=0 restores the prior active-row wait while keeping ten-row sources", () => {
  const environment = { GHOST_AGENCY_LINE_GAPLESS: "0" };
  const activeBatch = quotaBatch([
    ...Array.from({ length: 5 }, (_, index) => ({ prospectId: `finished-${index}`, status: "queued" })),
    { prospectId: "active-1", status: "picked" },
    ...Array.from({ length: 4 }, (_, index) => ({ prospectId: `failed-${index}`, status: "rejected" })),
  ]);
  assert.equal(shouldRefill(activeBatch, environment), false);

  const verticals = [
    "plumbing", "hvac", "fencing", "concrete", "electrical",
    "general contractor", "landscaping", "roofing", "med spa", "salon",
  ].map((vertical) => ({ vertical, outreachRetired: false }));
  const source = nextQuotaSource(quotaBatch([], { requested: 50 }), {
    environment,
    verticals,
    metros: ["Metro One ST"],
  });
  assert.equal(source.chunk, 10);
});

test("explicit LeadMiner remains on the packet shelf", () => {
  const first = nextQuotaSource(quotaBatch([], { target: "leadminer", requested: 25 }));
  assert.equal(first.target, "leadminer");
  assert.equal(first.mode, "packet_shelf_balanced_seed");
  assert.equal(first.chunk, 10);

  const retry = nextQuotaSource(quotaBatch([], {
    target: "leadminer",
    requested: 25,
    mineFunnel: [
      { stage: QUOTA_CONTRACT_STAGE },
      { stage: "quota_source_0_leadminer" },
    ],
  }));
  assert.equal(retry.target, "leadminer");
  assert.equal(retry.mode, "packet_shelf_retry");
  assert.equal(retry.chunk, 10);
});

test("All Trades fails closed when fresh verticals are unavailable", () => {
  const source = nextQuotaSource(quotaBatch([], { requested: 25 }), { verticals: [] });
  assert.equal(source.target, "");
  assert.equal(source.mode, "fresh_source_unavailable");
  assert.equal(source.chunk, 0);
  assert.equal(source.unavailable, true);
  assert.equal(source.reason, "fresh_source_unavailable");
});

test("explicit LeadMiner remains available when the All Trades donor roster is empty", () => {
  const source = nextQuotaSource(quotaBatch([], { target: "leadminer", requested: 25 }), { verticals: [] });
  assert.equal(source.target, "leadminer");
  assert.equal(source.mode, "packet_shelf_balanced_seed");
  assert.equal(source.chunk, 10);
});

test("fresh all-trades quota stays in ten-row waves with only the final remainder smaller", () => {
  function chunksFor(requested) {
    const chunks = [];
    const rows = [];
    const mineFunnel = [{ stage: QUOTA_CONTRACT_STAGE }];
    while (rows.length < requested) {
      const source = nextQuotaSource(quotaBatch(rows, { requested, mineFunnel }));
      chunks.push(source.chunk);
      for (let index = 0; index < source.chunk; index += 1) {
        rows.push({ prospectId: `finished-${rows.length + 1}`, vertical: source.target.split(" in ")[0], status: "queued" });
      }
      mineFunnel.push({ stage: `quota_source_${source.attempt}_fresh` });
    }
    return chunks;
  }

  assert.deepEqual(chunksFor(25), [10, 10, 5]);
  assert.deepEqual(chunksFor(50), [10, 10, 10, 10, 10]);
});

test("failed attempts never satisfy quota and the bounded source cap becomes an honest halt", () => {
  const rows = [
    { prospectId: "success-1", status: "queued" },
    { prospectId: "success-2", status: "sent" },
    ...Array.from({ length: 17 }, (_, index) => ({
      prospectId: `failed-${index + 1}`,
      status: index % 3 === 0 ? "gate_failed" : index % 3 === 1 ? "rejected" : "error",
    })),
  ];
  const mineFunnel = [
    { stage: QUOTA_CONTRACT_STAGE },
    ...Array.from({ length: MAX_REFILL_ATTEMPTS + 1 }, (_, attempt) => ({
      stage: `quota_source_${attempt}_bounded_source`,
    })),
  ];
  const batch = quotaBatch(rows, { mineFunnel });

  assert.equal(sourceAttempt(batch.mineFunnel), MAX_REFILL_ATTEMPTS + 1);
  assert.equal(replacementDeficit(batch), 8);
  assert.equal(shouldRefill(batch), false);
  assert.equal(sourceExhausted(batch), true);

  batch.rows.push({ prospectId: "still-building", status: "qualified" });
  assert.equal(sourceExhausted(batch), false, "an active final candidate gets its honest chance to finish");
  batch.rows.at(-1).status = "gate_failed";
  assert.equal(sourceExhausted(batch), true);
});

test("quota contract stage logs quota state and a rejection reason when a candidate does not survive", () => {
  const merged = mergeMineFunnel(
    [{ stage: QUOTA_CONTRACT_STAGE, entered: 1, survived: 0, rejected: {} }],
    [],
    {
      attempt: 0,
      sourceTarget: "leadminer",
      mode: "packet_shelf_balanced_seed",
      requested: 1,
      selected: 0,
      contractEntered: 1,
      quotaState: {
        requested: 1,
        finished: 0,
        active: 0,
        remaining_finished: 1,
        replacement_deficit: 1,
        source_attempt: 0,
        source_target: "leadminer",
        source_mode: "packet_shelf_balanced_seed",
      },
    },
  );
  const contract = merged.find((row) => row.stage === QUOTA_CONTRACT_STAGE);
  assert.ok(contract, "contract stage is always preserved");
  assert.equal(contract.survived, 0);
  assert.equal(Object.values(contract.rejected).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(contract.quota_state.remaining_finished, 1);
});

test("quota contract stage marks survivors without inventing rejection reasons", () => {
  const merged = mergeMineFunnel(
    [{ stage: QUOTA_CONTRACT_STAGE, entered: 1, survived: 0, rejected: {} }],
    [],
    {
      attempt: 0,
      sourceTarget: "leadminer",
      mode: "packet_shelf_balanced_seed",
      requested: 1,
      selected: 1,
      contractEntered: 1,
    },
  );
  const contract = merged.find((row) => row.stage === QUOTA_CONTRACT_STAGE);
  assert.equal(contract.survived, 1);
  assert.deepEqual(contract.rejected, {});
});
