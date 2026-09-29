"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const heroBudget = require("../lib/line-hero-budget");
const quota = require("../lib/line-quota");

function batch(requested, rows) {
  return {
    batchId: "batch_paid_candidate_budget",
    status: "building",
    requested,
    rows,
    mineFunnel: [{ stage: quota.QUOTA_CONTRACT_STAGE, entered: requested }],
  };
}

function row(rowIndex, status, options = {}) {
  const value = {
    rowId: `row_${rowIndex}`,
    rowIndex,
    prospectId: `prospect_${rowIndex}`,
    status,
  };
  if (options.checkpoint === true) {
    value.heroStartCheckpointed = true;
    value.heroStartCheckpoint = heroBudget.make({
      disposition: options.disposition || "qualified",
      batchId: "batch_paid_candidate_budget",
      rowId: value.rowId,
      prospectId: value.prospectId,
      ...(options.disposition === "job_bound"
        ? { jobId: `hero_job_${rowIndex}`, generationRevision: 1 }
        : { generationRevision: 0 }),
    });
  }
  return value;
}

test("a pre-qualification rejection frees one source slot", () => {
  const value = batch(1, [row(0, "rejected")]);

  assert.equal(quota.remainingHeroCandidateBudget(value), 1);
  assert.equal(quota.activeUncheckpointedHeroCandidateRows(value).length, 0);
  assert.equal(quota.sourceDeficit(value), 1);
  assert.equal(quota.shouldRefill(value), true);
  assert.equal(quota.heroPaidCandidateBudgetBlocksCompletion(value), false);
});

test("a terminal row retaining a valid qualification checkpoint consumes its slot", () => {
  const value = batch(1, [row(0, "error", { checkpoint: true })]);

  assert.equal(quota.checkpointedHeroCandidateRows(value).length, 1);
  assert.equal(quota.remainingHeroCandidateBudget(value), 0);
  assert.equal(quota.sourceDeficit(value), 0);
  assert.equal(quota.shouldRefill(value), false);
  assert.equal(quota.heroPaidCandidateBudgetBlocksCompletion(value), true);
});

test("Practice with hero generation explicitly off refills without changing Live's paid ceiling", () => {
  const environment = { GHOST_AGENCY_HERO_AUTOLINE: "0" };
  const practice = {
    ...batch(1, [row(0, "error", { checkpoint: true })]),
    lane: "sandbox",
  };
  assert.equal(quota.ownerOnlyNoVideoQuota(practice, environment), true);
  assert.equal(quota.sourceDeficit(practice, environment), 1);
  assert.equal(quota.shouldRefill(practice, environment), true);
  assert.equal(quota.heroPaidCandidateBudgetBlocksCompletion(practice, environment), false);

  const live = { ...practice, lane: "live" };
  assert.equal(quota.ownerOnlyNoVideoQuota(live, environment), false);
  assert.equal(quota.sourceDeficit(live, environment), 0);
  assert.equal(quota.shouldRefill(live, environment), false);
  assert.equal(quota.heroPaidCandidateBudgetBlocksCompletion(live, environment), true);
});

test("a malformed durable checkpoint fails closed and never reopens a paid slot", () => {
  const malformed = row(0, "error");
  malformed.heroStartCheckpointed = true;
  malformed.heroStartCheckpoint = {
    schema: heroBudget.HERO_START_CHECKPOINT_SCHEMA,
    disposition: "qualified",
    batchId: "tampered_batch",
  };
  const value = batch(1, [malformed]);

  assert.equal(quota.checkpointedHeroCandidateRows(value).length, 0);
  assert.equal(quota.invalidReservedHeroCandidateRows(value).length, 1);
  assert.equal(quota.reservedHeroCandidateRows(value).length, 1);
  assert.equal(quota.remainingHeroCandidateBudget(value), 0);
  assert.equal(quota.sourceDeficit(value), 0);
  assert.equal(quota.shouldRefill(value), false);
  assert.equal(quota.heroPaidCandidateBudgetBlocksCompletion(value), true);
});

test("active uncheckpointed candidates reserve future paid slots during refill", () => {
  const value = batch(3, [
    row(0, "error", { checkpoint: true }),
    row(1, "picked"),
  ]);

  assert.equal(quota.replacementDeficit(value), 2);
  assert.equal(quota.remainingHeroCandidateBudget(value), 2);
  assert.equal(quota.activeUncheckpointedHeroCandidateRows(value).length, 1);
  assert.equal(quota.remainingHeroCandidateSourceBudget(value), 1);
  assert.equal(quota.sourceDeficit(value), 1, "never source the unsafe second replacement");
  assert.equal(quota.nextQuotaSource(value).chunk, 1);
});

test("multi-site source allowance never exceeds checkpoint plus active candidate ceiling", () => {
  const value = batch(5, [
    row(0, "gate_failed", { checkpoint: true, disposition: "job_bound" }),
    row(1, "error", { checkpoint: true }),
    row(2, "picked"),
  ]);

  assert.equal(quota.remainingHeroCandidateBudget(value), 3);
  assert.equal(quota.remainingHeroCandidateSourceBudget(value), 2);
  assert.equal(quota.sourceDeficit(value), 2);
  assert.equal(
    quota.checkpointedHeroCandidateRows(value).length
      + quota.activeUncheckpointedHeroCandidateRows(value).length
      + quota.sourceDeficit(value),
    5,
  );
});
