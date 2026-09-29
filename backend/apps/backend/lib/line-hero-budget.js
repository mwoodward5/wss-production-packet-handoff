"use strict";

const { createHash, timingSafeEqual } = require("node:crypto");

const HERO_START_CHECKPOINT_SCHEMA = "wss.line.hero_start_checkpoint.v1";
const DISPOSITIONS = new Set(["qualified", "job_bound", "no_provider_job"]);
const CHECKPOINT_KEYS = Object.freeze([
  "schema",
  "disposition",
  "batchId",
  "rowId",
  "prospectId",
  "jobId",
  "generationRevision",
  "bindingSha256",
]);

function text(value) {
  return String(value || "").trim();
}

function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
}

function canonical(input = {}) {
  const jobId = text(input.jobId || input.job_id);
  const rawRevision = input.generationRevision ?? input.generation_revision;
  const generationRevision = rawRevision === undefined || rawRevision === null || rawRevision === ""
    ? (jobId ? -1 : 0)
    : integer(rawRevision);
  const disposition = text(input.disposition) || (jobId ? "job_bound" : "qualified");
  return {
    schema: HERO_START_CHECKPOINT_SCHEMA,
    disposition,
    batchId: text(input.batchId || input.batch_id),
    rowId: text(input.rowId || input.row_id),
    prospectId: text(input.prospectId || input.prospect_id),
    jobId,
    generationRevision,
  };
}

function bindingSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function make(input = {}) {
  const value = canonical(input);
  if (!value.batchId || !value.rowId || !value.prospectId || !DISPOSITIONS.has(value.disposition)) return null;
  if (value.disposition === "job_bound") {
    if (!value.jobId || value.generationRevision < 1) return null;
  } else if (value.jobId || value.generationRevision !== 0) {
    return null;
  }
  return { ...value, bindingSha256: bindingSha256(value) };
}

function validate(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "hero_start_checkpoint_missing" };
  }
  const keys = Object.keys(value);
  if (keys.length !== CHECKPOINT_KEYS.length
    || CHECKPOINT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return { ok: false, reason: "hero_start_checkpoint_malformed" };
  }
  const normalized = make(value);
  if (!normalized || CHECKPOINT_KEYS.slice(0, -1).some((key) => value[key] !== normalized[key])) {
    return { ok: false, reason: "hero_start_checkpoint_malformed" };
  }
  const actualSha = text(value.bindingSha256);
  const expectedSha = normalized.bindingSha256;
  if (!/^[a-f0-9]{64}$/.test(actualSha)
    || !timingSafeEqual(Buffer.from(actualSha, "hex"), Buffer.from(expectedSha, "hex"))) {
    return { ok: false, reason: "hero_start_checkpoint_sha_mismatch" };
  }
  const expectedFields = canonical({ ...normalized, ...expected });
  for (const key of ["batchId", "rowId", "prospectId", "jobId", "generationRevision", "disposition"]) {
    if (Object.prototype.hasOwnProperty.call(expected, key)
      || Object.prototype.hasOwnProperty.call(expected, key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))) {
      if (normalized[key] !== expectedFields[key]) {
        return { ok: false, reason: `hero_start_checkpoint_${key}_mismatch` };
      }
    }
  }
  return {
    ok: true,
    checkpoint: normalized,
    bound: normalized.disposition === "job_bound",
    finalized: normalized.disposition !== "qualified",
  };
}

function rowCheckpoint(batch, row) {
  if (!row || row.heroStartCheckpointed !== true) return null;
  const checked = validate(row.heroStartCheckpoint, {
    batchId: text(batch?.batchId || batch?.batch_id),
    rowId: text(row.rowId || row.row_id),
    prospectId: text(row.prospectId || row.prospect_id),
  });
  return checked.ok ? checked.checkpoint : null;
}

function checkpointedRows(batch = {}) {
  return (Array.isArray(batch.rows) ? batch.rows : []).filter((row) => rowCheckpoint(batch, row));
}

function invalidCheckpointRows(batch = {}) {
  return (Array.isArray(batch.rows) ? batch.rows : []).filter((row) => (
    row?.heroStartCheckpointed === true && !rowCheckpoint(batch, row)
  ));
}

// Once the durable boolean has crossed a row CAS, malformed evidence closes
// the budget rather than reopening a second paid slot. Validation still blocks
// provider work; this function is only the conservative spend counter.
function budgetConsumedRows(batch = {}) {
  return (Array.isArray(batch.rows) ? batch.rows : []).filter((row) => row?.heroStartCheckpointed === true);
}

function count(batch = {}) {
  return budgetConsumedRows(batch).length;
}

function normalizedLimit(limit) {
  const parsed = Number(limit);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function remaining(batch = {}, limit = 1) {
  return Math.max(0, normalizedLimit(limit) - count(batch));
}

function exhausted(batch = {}, limit = 1) {
  return remaining(batch, limit) === 0;
}

module.exports = {
  HERO_START_CHECKPOINT_SCHEMA,
  schema: HERO_START_CHECKPOINT_SCHEMA,
  make,
  validate,
  checkpointedRows,
  invalidCheckpointRows,
  budgetConsumedRows,
  count,
  remaining,
  exhausted,
};
