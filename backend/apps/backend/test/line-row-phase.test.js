"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const heroBudget = require("../lib/line-hero-budget");
const { processRowPhase, sendOnFinishEnabled, SEND_ON_FINISH_SWITCH } = require("../lib/line-runner");
const lineState = require("../lib/line-state");

const BATCH_ID = "line_checkpoint_test";
const ROW_ID = "row_checkpoint_test";
const PROSPECT_ID = "prospect_checkpoint_test";

function pickedRow() {
  return {
    rowId: ROW_ID,
    prospectId: PROSPECT_ID,
    businessName: "Checkpoint Test Co",
    status: "picked",
    history: [{ status: "picked", at: "2026-08-29T00:00:00.000Z" }],
    failedFacts: [],
    reason: "",
  };
}

function gatePassedRow(overrides = {}) {
  return {
    rowId: ROW_ID,
    prospectId: PROSPECT_ID,
    businessName: "Send On Finish Co",
    status: "gate_passed",
    previewUrl: "https://send-on-finish.wss-ai.com/",
    gate: { pass: true, failed: [], checks: [] },
    history: [{ status: "picked", at: "2026-08-30T00:00:00.000Z" }, { status: "gate_passed", at: "2026-08-30T00:01:00.000Z" }],
    failedFacts: [],
    reason: "",
    ...overrides,
  };
}

function queueDeps(overrides = {}) {
  return {
    writePreviewUrl: async () => ({ ok: true, rowPatch: {} }),
    queueEmail: async () => ({ ok: true }),
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    now: () => "2026-08-31T10:00:00.000Z",
    ...overrides,
  };
}

test("picked persists qualified plus a no-job budget checkpoint before hero enqueue", async () => {
  let starts = 0;
  const out = await processRowPhase(pickedRow(), { batchId: BATCH_ID, lane: "sandbox" }, {
    qualify: async () => ({ ok: true }),
    startHero: async () => { starts += 1; throw new Error("must_not_enqueue_from_picked"); },
    now: () => "2026-08-29T00:01:00.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.phase, "qualify");
  assert.equal(out.row.status, "qualified");
  assert.equal(starts, 0);
  assert.equal(out.row.heroStartCheckpointed, true);
  const checked = heroBudget.validate(out.row.heroStartCheckpoint, {
    batchId: BATCH_ID,
    rowId: ROW_ID,
    prospectId: PROSPECT_ID,
    disposition: "qualified",
    jobId: "",
    generationRevision: 0,
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.bound, false);
  const reordered = Object.fromEntries(Object.entries(out.row.heroStartCheckpoint).reverse());
  assert.equal(
    heroBudget.validate(reordered, { batchId: BATCH_ID, rowId: ROW_ID, prospectId: PROSPECT_ID }).ok,
    true,
    "Supabase jsonb key order cannot invalidate the deterministic checkpoint",
  );
  assert.equal(heroBudget.count({ batchId: BATCH_ID, rows: [out.row] }), 1);
  assert.equal(heroBudget.remaining({ batchId: BATCH_ID, rows: [out.row] }, 1), 0);
  assert.equal(heroBudget.exhausted({ batchId: BATCH_ID, rows: [out.row] }, 1), true);
});

test("budget checkpoints default an omitted no-job revision to zero and malformed terminal rows consume the slot", () => {
  const qualified = heroBudget.make({
    batchId: BATCH_ID,
    rowId: ROW_ID,
    prospectId: PROSPECT_ID,
  });
  assert.equal(qualified.generationRevision, 0);
  assert.equal(qualified.disposition, "qualified");

  const tampered = { ...qualified, bindingSha256: "0".repeat(64) };
  const terminal = {
    rowId: ROW_ID,
    prospectId: PROSPECT_ID,
    status: "rejected",
    heroStartCheckpointed: true,
    heroStartCheckpoint: tampered,
  };
  const batch = { batchId: BATCH_ID, rows: [terminal] };
  assert.equal(heroBudget.checkpointedRows(batch).length, 0);
  assert.equal(heroBudget.invalidCheckpointRows(batch).length, 1);
  assert.equal(heroBudget.budgetConsumedRows(batch).length, 1);
  assert.equal(heroBudget.count(batch), 1);
  assert.equal(heroBudget.exhausted(batch, 1), true, "tampering cannot reopen a second paid slot");
});

test("qualified enqueues once, checkpoints the exact job, and only the following phase may Mirror", async () => {
  const qualified = await processRowPhase(pickedRow(), { batchId: BATCH_ID, lane: "live" }, {
    qualify: async () => ({ ok: true }),
    now: () => "2026-08-29T00:01:00.000Z",
  });
  let starts = 0;
  let mirrors = 0;
  const deps = {
    startHero: async () => {
      starts += 1;
      return {
        ok: true,
        rowPatch: {
          heroRemaster: {
            required: true,
            ready: false,
            pending: true,
            jobId: "hrj_checkpoint_exact",
            attemptId: "hero_attempt:3",
          },
        },
      };
    },
    mirror: async () => {
      mirrors += 1;
      return { ok: false, reason: "test_stops_after_mirror_entry" };
    },
    now: () => "2026-08-29T00:02:00.000Z",
  };

  const bound = await processRowPhase(qualified.row, { batchId: BATCH_ID, lane: "live" }, deps);
  assert.equal(bound.ok, true);
  assert.equal(bound.phase, "hero_start_checkpoint");
  assert.equal(bound.row.status, "qualified");
  assert.equal(bound.row.heroStartCheckpointed, true);
  assert.equal(starts, 1);
  assert.equal(mirrors, 0);
  const checked = heroBudget.validate(bound.row.heroStartCheckpoint, {
    batchId: BATCH_ID,
    rowId: ROW_ID,
    prospectId: PROSPECT_ID,
    disposition: "job_bound",
    jobId: "hrj_checkpoint_exact",
    generationRevision: 3,
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.bound, true);

  const afterPersist = await processRowPhase(bound.row, { batchId: BATCH_ID, lane: "live" }, deps);
  assert.equal(afterPersist.phase, "mirror");
  assert.equal(starts, 1, "the durable exact binding makes enqueue idempotently complete");
  assert.equal(mirrors, 1);
});

test("an uncertain enqueue parks on the durable qualified checkpoint without entering Mirror", async () => {
  const qualified = await processRowPhase(pickedRow(), { batchId: BATCH_ID, lane: "live" }, {
    qualify: async () => ({ ok: true }),
  });
  let mirrors = 0;
  const out = await processRowPhase(qualified.row, { batchId: BATCH_ID, lane: "live" }, {
    startHero: async () => ({ ok: false, reason: "hero_store_uncertain", rowPatch: {} }),
    mirror: async () => { mirrors += 1; return { ok: true }; },
    now: () => "2026-08-29T00:03:00.000Z",
  });
  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.retryable, true);
  assert.equal(out.phase, "hero_start_checkpoint");
  assert.equal(out.row.heroStartCheckpointed, true);
  assert.equal(out.row.heroStartCheckpoint.disposition, "qualified");
  assert.equal(mirrors, 0);
});

test("autoline disabled bypasses hero enqueue without looping", async () => {
  const qualified = await processRowPhase(pickedRow(), { batchId: BATCH_ID, lane: "sandbox" }, {
    qualify: async () => ({ ok: true }),
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
  });
  let starts = 0;
  let mirrors = 0;
  const out = await processRowPhase(qualified.row, { batchId: BATCH_ID, lane: "sandbox" }, {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    startHero: async () => { starts += 1; return { ok: true }; },
    mirror: async () => { mirrors += 1; return { ok: false, reason: "disabled_path_reached_mirror" }; },
  });
  assert.equal(out.phase, "mirror");
  assert.equal(starts, 0);
  assert.equal(mirrors, 1);
});

test("send-on-finish switch defaults on and only \"0\" turns it off", () => {
  assert.equal(sendOnFinishEnabled({}), true, "owner directive 2026-09-01: on by default");
  assert.equal(sendOnFinishEnabled({ [SEND_ON_FINISH_SWITCH]: "1" }), true);
  assert.equal(sendOnFinishEnabled({ [SEND_ON_FINISH_SWITCH]: "" }), true);
  assert.equal(sendOnFinishEnabled({ [SEND_ON_FINISH_SWITCH]: "0" }), false);
});

test("a sandbox row that reaches email_queue sends immediately and marks sent before batch settle", async () => {
  const sends = [];
  const row = gatePassedRow();
  const out = await processRowPhase(row, { lane: "sandbox", batchId: "finish-batch" }, queueDeps({
    sendOnFinish: async (sentRow, options) => {
      sends.push({ row: sentRow, options });
      return { ok: true, providerReceipt: "receipt-1" };
    },
  }));

  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(sends.length, 1, "the same send routine fired at finish, not at settle");
  assert.equal(sends[0].row.previewUrl, row.previewUrl, "the send received the row with its proof identity");
  assert.equal(sends[0].row.gate.pass, true);
  assert.equal(sends[0].options.lane, "sandbox");
  assert.equal(sends[0].options.batchId, "finish-batch");
  assert.equal(out.row.status, "sent", "the row is sent before the batch ever settles");
  const statuses = new Set(out.row.history.map((entry) => entry.status));
  assert.ok(statuses.has("queued"), "the row passed through email_queue");
  assert.ok(statuses.has("sent"));
});

test("GHOST_AGENCY_SEND_ON_FINISH=0 restores queue-until-settle exactly", async () => {
  let sends = 0;
  const out = await processRowPhase(gatePassedRow(), { lane: "sandbox", batchId: "finish-off-batch" }, queueDeps({
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0", GHOST_AGENCY_SEND_ON_FINISH: "0" },
    sendOnFinish: async () => { sends += 1; return { ok: true }; },
  }));

  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.row.status, "queued");
  assert.equal(sends, 0, "no immediate send when the switch is 0");
});

test("live rows never send on finish — the typed-approval law is untouched", async () => {
  let sends = 0;
  const out = await processRowPhase(gatePassedRow({
    email: "owner@live-finish.example",
    hasEmail: true,
    contactReady: true,
  }), { lane: "live", batchId: "live-finish-batch" }, queueDeps({
    sendOnFinish: async () => { sends += 1; return { ok: true }; },
  }));

  assert.equal(out.ok, true);
  assert.equal(out.row.status, "queued");
  assert.equal(sends, 0, "live delivery still waits for the operator approval");
});

test("a refused or thrown send-on-finish leaves the row queued for the settle-send", async () => {
  let attempts = 0;
  const refused = await processRowPhase(gatePassedRow(), { lane: "sandbox", batchId: "refused-batch" }, queueDeps({
    sendOnFinish: async () => { attempts += 1; return { ok: false, reason: "owner_address_unset" }; },
  }));
  assert.equal(refused.ok, true);
  assert.equal(refused.row.status, "queued", "the settle-send still owns this row");
  assert.equal(attempts, 1);

  const threw = await processRowPhase(gatePassedRow(), { lane: "sandbox", batchId: "threw-batch" }, queueDeps({
    sendOnFinish: async () => { attempts += 1; throw new Error("provider down"); },
  }));
  assert.equal(threw.ok, true, "a thrown send must not fail the row phase");
  assert.equal(threw.row.status, "queued");
  assert.equal(attempts, 2);
});

test("a no-sender wiring keeps the historical queue phase", async () => {
  const out = await processRowPhase(gatePassedRow(), { lane: "sandbox", batchId: "unwired-batch" }, queueDeps());
  assert.equal(out.ok, true);
  assert.equal(out.row.status, "queued");
});

test("idempotency: a sent row is invisible to the settle-send and cannot double-send", () => {
  const queued = lineState.advanceRow(gatePassedRow(), "queued", {
    previewUrl: "https://send-on-finish.wss-ai.com/",
    now: "2026-08-31T10:00:00.000Z",
  });
  assert.equal(queued.ok, true);
  const sent = lineState.advanceRow(queued.row, "sent", { now: "2026-08-31T10:00:01.000Z" });
  assert.equal(sent.ok, true);

  // The settle-send's only entry points both refuse a sent row.
  const replay = lineState.advanceRow(sent.row, "sent", { now: "2026-08-31T10:00:02.000Z" });
  assert.equal(replay.ok, false, "sent is terminal: a second send attempt is a no-op");

  const batch = {
    batchId: "finish-batch",
    lane: "sandbox",
    status: "approved",
    approval: {
      actor: "factory_auto_after_qc",
      at: "2026-08-31T10:01:00.000Z",
      approvedRows: 1,
      typedBatchId: "finish-batch",
    },
    rows: [sent.row],
  };
  assert.deepEqual(lineState.sendableRows(batch), [], "the settle-send sees an already-sent row and skips it");
  assert.equal(lineState.batchCounts(batch).queued, 0, "a fully sent batch has nothing left to approve or send");
});
