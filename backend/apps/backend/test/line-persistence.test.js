"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  BATCH_TABLE,
  ROW_TABLE,
  createLinePersistence,
  sanitizeRowPayload,
} = require("../lib/line-persistence");
const {
  EVIDENCE_SCHEMA,
  QC_CONTRACT,
  RENDERER,
  signEvidence,
} = require("../lib/mirror-engine/engine");

const NOW = "2026-08-14T12:00:00.000Z";
const LOGO_A = "a".repeat(64);
const PHONE_LIKE_LEASE_UUID = "12345678-1234-4abc-8abc-abcdefabcdef";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferredBarrier(parties) {
  let arrived = 0;
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    await promise;
  };
}

function parseFilter(filter = "") {
  const output = {};
  for (const clause of String(filter).split("&")) {
    const at = clause.indexOf("=");
    if (at < 1) continue;
    output[clause.slice(0, at)] = decodeURIComponent(clause.slice(at + 1));
  }
  return output;
}

function equalFilter(actual, filter) {
  if (filter === "is.null") return actual === null || actual === undefined;
  if (filter.startsWith("eq.")) return String(actual) === filter.slice(3);
  if (filter.startsWith("gt.")) return new Date(actual).getTime() > new Date(filter.slice(3)).getTime();
  if (filter.startsWith("lte.")) return new Date(actual).getTime() <= new Date(filter.slice(4)).getTime();
  return true;
}

/** Mirrors the lease-eligibility or-expression claimRows emits:
 *  `(lease_token.is.null,lease_expires_at.lte.NOW,updated_at.lte.STALE)`.
 *  No lease at all, an expired lease, or a holder that has not moved the row
 *  past the staleness stamp — any of the three makes the row claimable. */
function eligibleLease(row, expression) {
  for (const clause of String(expression).replace(/^\(/, "").replace(/\)$/, "").split(",")) {
    if (clause === "lease_token.is.null" && row.lease_token === null) return true;
    const lte = clause.match(/^(lease_expires_at|updated_at)\.lte\.(.+)$/);
    if (lte) {
      const value = row[lte[1]];
      if (value !== null && value !== undefined
        && new Date(value).getTime() <= new Date(lte[2]).getTime()) return true;
    }
  }
  return false;
}

function memoryStore(options = {}) {
  const tables = {
    [BATCH_TABLE]: new Map(),
    [ROW_TABLE]: new Map(),
  };
  const calls = { insert: [], select: [], update: [] };
  let uuidCount = 0;
  let candidateBarrier = options.candidateBarrier || null;
  let applyThenThrow = false;
  let zeroRowsAfterApply = false;

  function keyFor(table, row) {
    return table === BATCH_TABLE ? row.batch_id : row.row_id;
  }

  function uniqueConflict(table, desired, ignoreKey = null) {
    if (table !== ROW_TABLE) return false;
    for (const [key, current] of tables[ROW_TABLE]) {
      if (key === ignoreKey) continue;
      if (current.batch_id === desired.batch_id && current.row_index === desired.row_index) return true;
      if (current.batch_id === desired.batch_id && current.prospect_id === desired.prospect_id) return true;
      const guardedStates = new Set(["gate_passed", "queued", "sent"]);
      if (desired.logo_sha256 && current.logo_sha256
        && desired.batch_id === current.batch_id
        && desired.logo_sha256 === current.logo_sha256
        && guardedStates.has(desired.status)
        && guardedStates.has(current.status)) return true;
    }
    return false;
  }

  async function insertRow(table, input, requestOptions) {
    calls.insert.push({ table, input: clone(input), requestOptions });
    const rows = Array.isArray(input) ? input : [input];
    const staged = new Map();
    for (const row of rows) {
      const key = keyFor(table, row);
      if (tables[table].has(key) || staged.has(key) || uniqueConflict(table, row)) {
        return { mode: "live_write_failed", status: 409, error: { code: "23505" } };
      }
      staged.set(key, clone(row));
    }
    for (const [key, row] of staged) tables[table].set(key, row);
    return { mode: "live_write", row: clone(rows) };
  }

  async function selectRows(table, selection = {}, requestOptions) {
    const filters = parseFilter(selection.filter);
    let rows = [...tables[table].values()].filter((row) => {
      if (filters.batch_id && !equalFilter(row.batch_id, filters.batch_id)) return false;
      if (filters.row_id && !equalFilter(row.row_id, filters.row_id)) return false;
      if (filters.status?.startsWith("in.(")) {
        const allowed = filters.status.slice(4, -1).split(",");
        if (!allowed.includes(row.status)) return false;
      }
      if (filters.or && !eligibleLease(row, filters.or)) return false;
      return true;
    }).map(clone);
    if (selection.order === "row_index.asc") rows.sort((a, b) => a.row_index - b.row_index);
    if (selection.limit) rows = rows.slice(0, selection.limit);
    calls.select.push({ table, selection: clone(selection), requestOptions, rows: clone(rows) });
    if (candidateBarrier && table === ROW_TABLE && filters.status?.startsWith("in.(")) {
      await candidateBarrier();
    }
    return { mode: "live_select", rows };
  }

  async function conditionalUpdate(table, idColumn, idValue, guards, patch, requestOptions) {
    calls.update.push({ table, idColumn, idValue, guards: clone(guards), patch: clone(patch), requestOptions });
    const current = tables[table].get(idValue);
    let matches = Boolean(current);
    if (matches && current[idColumn] !== idValue) matches = false;
    for (const [column, filter] of Object.entries(guards || {})) {
      if (!matches) break;
      if (column === "or") matches = eligibleLease(current, filter);
      else matches = equalFilter(current[column], filter);
    }
    if (!matches) return { ok: true, mode: "live_update", updated: false, rows: [] };
    const desired = { ...current, ...clone(patch) };
    if (uniqueConflict(table, desired, idValue)) {
      return { ok: false, mode: "live_update_failed", status: 409, error: { code: "23505" }, updated: false };
    }
    tables[table].set(idValue, desired);
    if (applyThenThrow) {
      applyThenThrow = false;
      const error = new Error("response_lost_after_commit");
      error.code = "ECONNRESET";
      throw error;
    }
    if (zeroRowsAfterApply) {
      zeroRowsAfterApply = false;
      return { ok: true, mode: "live_update", updated: false, rows: [] };
    }
    return { ok: true, mode: "live_update", updated: true, rows: [clone(desired)] };
  }

  return {
    calls,
    tables,
    deps: {
      insertRow,
      selectRows,
      conditionalUpdate,
      now: () => new Date(NOW),
      randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, "0")}`,
    },
    setCandidateBarrier(value) { candidateBarrier = value; },
    loseNextResponse() { applyThenThrow = true; },
    hideNextRepresentation() { zeroRowsAfterApply = true; },
    seed(table, row) { tables[table].set(keyFor(table, row), clone(row)); },
    get(table, key) { return clone(tables[table].get(key)); },
  };
}

function batchFixture(overrides = {}) {
  return {
    batchId: "line_batch_1",
    lane: "sandbox",
    target: "Tulsa plumbing",
    requested: 50,
    status: "building",
    pickState: "complete",
    version: 0,
    ...overrides,
  };
}

function rowFixture(overrides = {}) {
  return {
    rowId: "line_batch_1:0",
    rowIndex: 0,
    prospectId: "prospect-1",
    businessName: "Acme Plumbing",
    city: "Tulsa",
    state: "OK",
    status: "qualified",
    history: [{ status: "qualified", at: NOW }],
    ...overrides,
  };
}

async function seededPersistence(row = rowFixture(), batch = batchFixture()) {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  assert.equal((await persistence.createBatch(batch)).ok, true);
  assert.equal((await persistence.storeRows({ batchId: batch.batchId, rows: [row] })).ok, true);
  return { memory, persistence };
}

test("schema creates service-role-only normalized line tables", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "line-batches.sql"), "utf8");
  for (const table of [BATCH_TABLE, ROW_TABLE]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
  assert.match(sql, /unique \(batch_id, prospect_id\)/);
  assert.match(sql, /unique index[\s\S]+\(batch_id, logo_sha256\)[\s\S]+status in \('gate_passed', 'ready', 'queued', 'sent'\)/);
  assert.doesNotMatch(sql, /security\s+definer/i);
  assert.doesNotMatch(sql, /recipient_email|owner_email|phone\s+text/i);
});

test("PII sanitizer removes nested contact keys and redacts contact text", () => {
  const signedDigest = `${"a".repeat(10)}1234567890${"b".repeat(44)}`;
  const logoSourceDigest = `${"c".repeat(10)}1234567890${"d".repeat(44)}`;
  const logoOutputDigest = `${"e".repeat(10)}1234567890${"f".repeat(44)}`;
  const shortTextHash = "a1234567890bcdef";
  const generationFingerprint = `mirror-engine:${signedDigest}`;
  const opaqueProspectId = `lead_${"a".repeat(8)}1234567${"b".repeat(17)}`;
  // Production shape (2026-08-31, Backlund Plumbing et al.): LeadMiner ids
  // embed source-phone digits inside the opaque tail and must survive the
  // scrub, or the later store read by the real id dies rows_0.
  const leadMinerProspectId = "lm-b5551234567fe4f8ec3c6eb412e013b2f0ae3d918d";
  const sanitized = sanitizeRowPayload({
    email: "owner@example.test",
    phone: "918-555-0134",
    businessName: "Acme Plumbing",
    notes: "Email owner@example.test or call (918) 555-0134.",
    nested: { contact_email: "ops@example.test", mobilePhone: "+1 918 555 0199" },
    evidence_sha: signedDigest,
    text_hash: shortTextHash,
    generation_fingerprint: generationFingerprint,
    general_hex_note: logoSourceDigest,
    checks: {
      brand: {
        logo_sha_source: logoSourceDigest,
        logo_sha_in_output: logoOutputDigest,
        logo_sha_note: logoSourceDigest,
        customer_sha_comment: logoOutputDigest,
      },
      malformed_brand: {
        logo_sha_source: "a1234567890bcdef",
        logo_sha_in_output: "b1234567890cdefa",
      },
    },
    signature: "a1234567890bcdeg owner@example.test",
    numeric_signature: "123456789012345",
    identities: [
      { prospectId: opaqueProspectId },
      { prospectId: "lead_9185550134" },
      { prospectId: `lead9185550134_${"c".repeat(32)}` },
      { prospectId: leadMinerProspectId },
      { batchId: "lm-04712acece10f1cd4f76ea0640d9c360ca5edf4f" },
    ],
  });
  const encoded = JSON.stringify(sanitized);
  for (const pii of ["owner@example.test", "ops@example.test", "918-555-0134", "918) 555-0134", "918 555 0199"]) {
    assert.equal(encoded.includes(pii), false);
  }
  assert.equal(sanitized.businessName, "Acme Plumbing");
  assert.match(sanitized.notes, /\[redacted-email\]/);
  assert.match(sanitized.notes, /\[redacted-phone\]/);
  assert.equal(sanitized.evidence_sha, signedDigest, "signed hexadecimal evidence must remain byte-identical");
  assert.equal(sanitized.text_hash, shortTextHash, "short Mirror text hashes must remain byte-identical");
  assert.equal(sanitized.generation_fingerprint, generationFingerprint);
  assert.match(sanitized.general_hex_note, /\[redacted-phone\]/, "non-crypto leaf keys must not preserve opaque-looking text");
  assert.equal(sanitized.checks.brand.logo_sha_source, logoSourceDigest);
  assert.equal(sanitized.checks.brand.logo_sha_in_output, logoOutputDigest);
  assert.match(sanitized.checks.brand.logo_sha_note, /\[redacted-phone\]/, "unapproved SHA note keys must fail closed");
  assert.match(sanitized.checks.brand.customer_sha_comment, /\[redacted-phone\]/, "unapproved SHA comment keys must fail closed");
  assert.match(sanitized.checks.malformed_brand.logo_sha_source, /\[redacted-phone\]/, "short source SHA must fail closed");
  assert.match(sanitized.checks.malformed_brand.logo_sha_in_output, /\[redacted-phone\]/, "short output SHA must fail closed");
  assert.match(sanitized.signature, /\[redacted-phone\]/, "malformed crypto-looking values must fail closed");
  assert.match(sanitized.signature, /\[redacted-email\]/, "malformed crypto-looking values must still scrub email PII");
  assert.match(sanitized.numeric_signature, /\[redacted-phone\]/, "a numeric-only crypto field must not gain a PII exemption");
  assert.equal(sanitized.identities[0].prospectId, opaqueProspectId, "strict namespaced-hex IDs must remain usable");
  assert.match(sanitized.identities[1].prospectId, /\[redacted-phone\]/, "a phone-shaped ID must stay redacted");
  assert.match(sanitized.identities[2].prospectId, /\[redacted-phone\]/, "a namespace containing a phone must not gain an exemption");
  assert.equal(sanitized.identities[3].prospectId, leadMinerProspectId, "LeadMiner hyphen-namespace ids with embedded phone digits must survive byte-exact");
  assert.equal(sanitized.identities[4].batchId, "lm-04712acece10f1cd4f76ea0640d9c360ca5edf4f", "clean LeadMiner ids keep passing unchanged");
});

test("PII sanitizer preserves strict nested hero line identities byte-exact", () => {
  const lineBatchId = "line_req_30e116f6451aac0d20e652d8d8210646";
  const lineRowId = `${lineBatchId}:0`;
  const sanitized = sanitizeRowPayload({
    heroRemaster: {
      lineBatchId,
      lineRowId,
      foreignJobLineBatchId: lineBatchId,
      foreignJobLineRowId: lineRowId,
      note: "Call 918-555-0134 about line_req_30e116f6451aac0d20e652d8d8210646.",
      malformed: {
        lineBatchId: "line_req_9185550134",
        lineRowId: "line_req_9185550134:0",
        foreignJobLineBatchId: "customer 918-555-0134",
        foreignJobLineRowId: `${lineBatchId}:0000`,
      },
    },
  });

  assert.equal(sanitized.heroRemaster.lineBatchId, lineBatchId);
  assert.equal(sanitized.heroRemaster.lineRowId, lineRowId);
  assert.equal(sanitized.heroRemaster.foreignJobLineBatchId, lineBatchId);
  assert.equal(sanitized.heroRemaster.foreignJobLineRowId, lineRowId);
  assert.match(sanitized.heroRemaster.note, /\[redacted-phone\]/, "phone-like prose must still be redacted");
  assert.match(sanitized.heroRemaster.malformed.lineBatchId, /\[redacted-phone\]/, "phone-shaped identity must fail closed");
  assert.match(sanitized.heroRemaster.malformed.lineRowId, /\[redacted-phone\]/, "phone-shaped row identity must fail closed");
  assert.match(sanitized.heroRemaster.malformed.foreignJobLineBatchId, /\[redacted-phone\]/, "identity prose must fail closed");
  assert.match(sanitized.heroRemaster.malformed.foreignJobLineRowId, /\[redacted-phone\]/, "malformed identity must not gain an exemption");
});

test("signed Mirror release evidence stays valid across the persistence sanitizer", async () => {
  const phoneLikeTextHash = "a1234567890bcdef";
  const phoneLikeBuildHash = `${"c".repeat(10)}1234567890${"d".repeat(44)}`;
  const phoneLikeLogoSourceSha = `${"a".repeat(10)}1234567890${"e".repeat(44)}`;
  const phoneLikeLogoOutputSha = `${"b".repeat(10)}1234567890${"f".repeat(44)}`;
  const releaseEvidence = {
    ok: true,
    dry_run: false,
    renderer: RENDERER,
    qc_contract: QC_CONTRACT,
    evidence_schema: EVIDENCE_SCHEMA,
    build_hash: phoneLikeBuildHash,
    donor: "safe-donor",
    donor_content_hash: "e".repeat(64),
    slug: "safe-build",
    deploy_id: "dpl_safe",
    deploy_url: "https://safe-build.wss-ai.com",
    preview_url: "https://safe-build.wss-ai.com/",
    file_count: 1,
    upload_stats: { uploaded: 1, deduped: 0 },
    logo_sha: null,
    checks: {
      brand: {
        status: "passed",
        logo_sha_source: phoneLikeLogoSourceSha,
        logo_sha_in_output: phoneLikeLogoOutputSha,
      },
      route_render: {
        status: "passed",
        pages: [{ path: "/", text_hash: phoneLikeTextHash }],
      },
      editable: {
        status: "archived",
        pruned: { removed: ["9185550134.html"] },
      },
    },
    revealable: true,
  };
  releaseEvidence.evidence_sha = signEvidence(releaseEvidence);

  const { persistence } = await seededPersistence(rowFixture({
    status: "gate_passed",
    releaseEvidence,
    buildEvidence: {
      renderer: RENDERER,
      qc_contract: QC_CONTRACT,
      evidence_schema: EVIDENCE_SCHEMA,
      evidence_sha: releaseEvidence.evidence_sha,
      generation_fingerprint: `mirror-engine:${phoneLikeBuildHash}`,
      release_evidence: releaseEvidence,
    },
    evidenceNote: "Email owner@example.test or call (918) 555-0134.",
  }));
  const loaded = await persistence.loadBatch("line_batch_1");
  const persisted = loaded.batch.rows[0];

  assert.equal(loaded.ok, true);
  assert.notEqual(persisted.releaseEvidence.evidence_sha, releaseEvidence.evidence_sha);
  assert.deepEqual(
    persisted.releaseEvidence.checks.editable.pruned.removed,
    ["[redacted-phone].html"],
  );
  assert.equal(JSON.stringify(persisted).includes("9185550134"), false);
  assert.equal(persisted.releaseEvidence.checks.route_render.pages[0].text_hash, phoneLikeTextHash);
  assert.equal(persisted.releaseEvidence.checks.brand.logo_sha_source, phoneLikeLogoSourceSha);
  assert.equal(persisted.releaseEvidence.checks.brand.logo_sha_in_output, phoneLikeLogoOutputSha);
  assert.equal(persisted.buildEvidence.generation_fingerprint, `mirror-engine:${phoneLikeBuildHash}`);
  assert.equal(signEvidence(persisted.releaseEvidence), persisted.releaseEvidence.evidence_sha);
  assert.equal(
    signEvidence(persisted.buildEvidence.release_evidence),
    persisted.buildEvidence.release_evidence.evidence_sha,
  );
  assert.equal(persisted.buildEvidence.evidence_sha, persisted.releaseEvidence.evidence_sha);
  assert.deepEqual(persisted.buildEvidence.release_evidence, persisted.releaseEvidence);
  assert.deepEqual(persisted.releaseEvidenceTransform, {
    schema: "line-release-evidence-pii-transform-v1",
    source_evidence_sha: releaseEvidence.evidence_sha,
    persisted_evidence_sha: persisted.releaseEvidence.evidence_sha,
    pii_scrubbed: true,
  });
  assert.equal("releaseEvidenceTransform" in persisted.releaseEvidence, false);
  assert.equal(persisted.evidenceNote.includes("owner@example.test"), false);
  assert.equal(persisted.evidenceNote.includes("918) 555-0134"), false);
  assert.match(persisted.evidenceNote, /\[redacted-email\]/);
  assert.match(persisted.evidenceNote, /\[redacted-phone\]/);
});

test("persistence never re-signs invalid release evidence while scrubbing its PII", () => {
  const evidence = {
    ok: true,
    dry_run: false,
    renderer: RENDERER,
    qc_contract: QC_CONTRACT,
    evidence_schema: EVIDENCE_SCHEMA,
    build_hash: "d".repeat(64),
    preview_url: "https://invalid-evidence.wss-ai.com/",
    checks: {
      editable: { status: "archived", pruned: { removed: ["9185550134.html"] } },
    },
    revealable: true,
  };
  evidence.evidence_sha = signEvidence(evidence);
  evidence.build_hash = "e".repeat(64);
  const sanitized = sanitizeRowPayload({ releaseEvidence: evidence });

  assert.deepEqual(
    sanitized.releaseEvidence.checks.editable.pruned.removed,
    ["[redacted-phone].html"],
  );
  assert.equal(JSON.stringify(sanitized).includes("9185550134"), false);
  assert.equal(sanitized.releaseEvidence.evidence_sha, evidence.evidence_sha);
  assert.notEqual(signEvidence(sanitized.releaseEvidence), sanitized.releaseEvidence.evidence_sha);
  assert.equal("releaseEvidenceTransform" in sanitized, false);
});

test("batch creation is awaited, deterministic, and idempotent", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  const first = await persistence.createBatch(batchFixture());
  const second = await persistence.createBatch(batchFixture());
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
  assert.equal(memory.tables[BATCH_TABLE].size, 1);

  const conflict = await persistence.createBatch(batchFixture({ requested: 10 }));
  assert.deepEqual({ ok: conflict.ok, error: conflict.error, conflict: conflict.conflict }, {
    ok: false,
    error: "batch_identity_conflict",
    conflict: true,
  });
});

test("haltBatch atomically CASes one exact batch and stamps fixed halt evidence", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture());

  const halted = await persistence.haltBatch({
    batchId: "line_batch_1",
    expectedVersion: 0,
    expectedStatus: "building",
    reason: "owner_halted_batch",
  });

  assert.equal(halted.ok, true);
  assert.equal(halted.updated, true);
  assert.equal(halted.batch.status, "halted");
  assert.equal(halted.batch.pickState, "complete");
  assert.equal(halted.batch.haltReason, "owner_halted_batch");
  assert.equal(halted.batch.settledAt, NOW);
  assert.equal(halted.batch.version, 1);
  assert.deepEqual(memory.calls.update[0].guards, { version: "eq.0", status: "eq.building" });
});

test("haltBatch retry preserves the first reason and time without a second mutation", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture());
  const first = await persistence.haltBatch({
    batchId: "line_batch_1", expectedVersion: 0, expectedStatus: "building", reason: "owner_halted_batch",
  });
  const retry = await persistence.haltBatch({
    batchId: "line_batch_1", expectedVersion: 0, expectedStatus: "building", reason: "replacement_reason",
  });

  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.alreadyApplied, true);
  assert.equal(retry.batch.haltReason, "owner_halted_batch");
  assert.equal(retry.batch.settledAt, first.batch.settledAt);
  assert.equal(retry.batch.version, 1);
  assert.equal(memory.calls.update.length, 1);
});

test("haltBatch preserves all row evidence and isolates unrelated batches", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture());
  await persistence.storeRows({ batchId: "line_batch_1", rows: [rowFixture({
    mirrorDispatch: { attemptId: "mirror_attempt:one", failure: { code: "invalid_request" } },
    gate: { pass: false, failed: ["headline"] },
  })] });
  await persistence.createBatch(batchFixture({ batchId: "line_batch_2", target: "Austin roofing" }));
  const rowBefore = memory.get(ROW_TABLE, "line_batch_1:0");
  const otherBefore = memory.get(BATCH_TABLE, "line_batch_2");

  const halted = await persistence.haltBatch({
    batchId: "line_batch_1", expectedVersion: 0, expectedStatus: "building", reason: "owner_halted_batch",
  });
  const loaded = await persistence.loadBatch("line_batch_1");

  assert.equal(halted.ok, true);
  assert.deepEqual(memory.get(ROW_TABLE, "line_batch_1:0"), rowBefore);
  assert.deepEqual(loaded.batch.rows[0].mirrorDispatch, { attemptId: "mirror_attempt:one", failure: { code: "invalid_request" } });
  assert.deepEqual(loaded.batch.rows[0].gate, { pass: false, failed: ["headline"] });
  assert.deepEqual(memory.get(BATCH_TABLE, "line_batch_2"), otherBefore);
});

test("haltBatch conflicts on done or stale CAS and rejects unsafe reasons", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture({ status: "done", version: 4 }));
  const done = await persistence.haltBatch({
    batchId: "line_batch_1", expectedVersion: 4, expectedStatus: "done", reason: "owner_halted_batch",
  });
  assert.equal(done.ok, false);
  assert.equal(done.conflict, true);
  assert.equal(done.error, "batch_already_done");
  assert.equal(memory.calls.update.length, 0);

  await persistence.createBatch(batchFixture({ batchId: "line_batch_2", version: 2 }));
  const stale = await persistence.haltBatch({
    batchId: "line_batch_2", expectedVersion: 1, expectedStatus: "building", reason: "owner_halted_batch",
  });
  assert.equal(stale.error, "batch_halt_conflict");
  const unsafe = await persistence.haltBatch({
    batchId: "line_batch_2", expectedVersion: 2, expectedStatus: "building", reason: "owner@example.test",
  });
  assert.equal(unsafe.error, "halt_reason_invalid");
  assert.equal(memory.calls.update.length, 0);
});

test("picked rows use deterministic IDs, retry without duplicates, and persist no raw contact PII", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture());
  const unsafe = rowFixture({
    rowId: undefined,
    email: "owner@example.test",
    phone: "918-555-0134",
    provider: { note: "reach owner@example.test at 918.555.0134" },
  });
  const first = await persistence.storeRows({ batchId: "line_batch_1", rows: [unsafe] });
  const second = await persistence.storeRows({ batchId: "line_batch_1", rows: [unsafe] });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, 1);
  assert.equal(memory.tables[ROW_TABLE].size, 1);
  const stored = memory.get(ROW_TABLE, "line_batch_1:0");
  assert.equal(stored.row_id, "line_batch_1:0");
  const serialized = JSON.stringify(stored);
  for (const pii of ["owner@example.test", "918-555-0134", "918.555.0134"]) {
    assert.equal(serialized.includes(pii), false);
  }
});

test("phone-like runs inside strict namespaced-hex identities survive every durable identity boundary", async () => {
  const batchId = `line_req_${"a".repeat(8)}1234567${"b".repeat(17)}`;
  const prospectId = `lead_${"c".repeat(8)}1234567${"d".repeat(17)}`;
  const rowId = `${batchId}:0`;
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);

  assert.equal((await persistence.createBatch(batchFixture({ batchId }))).ok, true);
  assert.equal((await persistence.storeRows({
    batchId,
    rows: [rowFixture({ rowId: undefined, prospectId })],
  })).ok, true);

  const stored = memory.get(ROW_TABLE, rowId);
  assert.equal(stored.batch_id, batchId);
  assert.equal(stored.row_id, rowId);
  assert.equal(stored.prospect_id, prospectId);
  assert.equal(stored.payload.prospectId, prospectId);

  const loaded = await persistence.loadBatch(batchId);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.batch.batchId, batchId);
  assert.equal(loaded.batch.rows[0].rowId, rowId);
  assert.equal(loaded.batch.rows[0].prospectId, prospectId);
});

test("two workers racing the same version produce exactly one lease", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture());
  await persistence.storeRows({ batchId: "line_batch_1", rows: [rowFixture()] });
  memory.setCandidateBarrier(deferredBarrier(2));

  const [left, right] = await Promise.all([
    persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-a", limit: 1 }),
    persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-b", limit: 1 }),
  ]);
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(left.rows.length + right.rows.length, 1);
  const stored = memory.get(ROW_TABLE, "line_batch_1:0");
  assert.equal(stored.version, 1);
  assert.equal(stored.attempt_count, 1);
  assert.ok(["worker-a", "worker-b"].includes(stored.lease_owner));
  assert.equal(stored.status, "qualified");
});

test("an exact hero row claim leases only that opaque row", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture({ batchId: "line_hero_exact" }));
  await persistence.storeRows({
    batchId: "line_hero_exact",
    rows: [0, 1, 2].map((index) => rowFixture({
      rowId: `line_hero_exact:${index}`,
      prospectId: `prospect-${index}`,
      rowIndex: index,
      status: "qualified",
    })),
  });

  const claimed = await persistence.claimRows({
    batchId: "line_hero_exact",
    rowId: "line_hero_exact:2",
    workerId: "hero-worker",
    limit: 1,
    statuses: ["qualified"],
  });
  assert.equal(claimed.ok, true);
  assert.deepEqual(claimed.rows.map((row) => row.rowId), ["line_hero_exact:2"]);
  assert.equal(memory.get(ROW_TABLE, "line_hero_exact:0").attempt_count, 0);
  assert.equal(memory.get(ROW_TABLE, "line_hero_exact:1").attempt_count, 0);
  assert.equal(memory.get(ROW_TABLE, "line_hero_exact:2").attempt_count, 1);
  const candidateRead = memory.calls.select.find((call) => call.table === ROW_TABLE
    && String(call.selection.filter || "").includes("status=in."));
  assert.match(candidateRead.selection.filter, /row_id=eq\.line_hero_exact%3A2/);
  const invalid = await persistence.claimRows({
    batchId: "line_hero_exact",
    rowId: "not a safe row id",
    workerId: "hero-worker",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "row_id_invalid");
});

test("a live lease is protected while an exactly-expired lease is reclaimable", async () => {
  const { memory, persistence } = await seededPersistence();
  const raw = memory.get(ROW_TABLE, "line_batch_1:0");
  memory.seed(ROW_TABLE, {
    ...raw,
    version: 4,
    lease_token: "00000000-0000-4000-8000-000000009999",
    lease_owner: "old-worker",
    lease_expires_at: "2026-08-14T12:00:01.000Z",
  });
  const protectedResult = await persistence.claimRows({ batchId: "line_batch_1", workerId: "new-worker" });
  assert.equal(protectedResult.rows.length, 0);
  assert.equal(memory.get(ROW_TABLE, "line_batch_1:0").version, 4);

  memory.seed(ROW_TABLE, { ...memory.get(ROW_TABLE, "line_batch_1:0"), lease_expires_at: NOW });
  const reclaimed = await persistence.claimRows({ batchId: "line_batch_1", workerId: "new-worker" });
  assert.equal(reclaimed.rows.length, 1);
  assert.equal(reclaimed.rows[0].leaseOwner, "new-worker");
  assert.equal(memory.get(ROW_TABLE, "line_batch_1:0").version, 5);
  // An EXPIRED lease is a normal reclaim, not a stale-holder takeover.
  assert.equal(reclaimed.staleLeaseReclaimed, 0);
});

test("a fresh lease is never reclaimed — no double claim inside the staleness window", async () => {
  const { memory, persistence } = await seededPersistence();
  const first = await persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-a" });
  assert.equal(first.rows.length, 1);
  assert.equal(first.staleLeaseReclaimed, 0);
  // A second worker arriving moments later finds the row lease-blocked: the
  // holder claimed it at NOW (updated_at = NOW), so the staleness law — a row
  // moved less than 10 minutes ago is presumed working — keeps the live lease
  // protected even though the second worker's eligibility window is open.
  const second = await persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-b", limit: 2 });
  assert.equal(second.ok, true);
  assert.equal(second.rows.length, 0);
  assert.equal(second.staleLeaseReclaimed, 0);
  const stored = memory.get(ROW_TABLE, "line_batch_1:0");
  assert.equal(stored.lease_owner, "worker-a");
  assert.equal(stored.version, 1);
  assert.equal(stored.attempt_count, 1);
});

test("a dead holder's UNEXPIRED lease is reclaimed and reported as stale_lease_reclaimed", async () => {
  const { memory, persistence } = await seededPersistence();
  const raw = memory.get(ROW_TABLE, "line_batch_1:0");
  // Live failure (2026-09-02, smoke batch line_mtl0s1bf): the holder died
  // mid-build, its lease still has minutes to run, and the row has not moved
  // since the claim — past the sweeper's 10-minute law the holder is dead and
  // the claim must win regardless of the held token.
  memory.seed(ROW_TABLE, {
    ...raw,
    status: "gate_passed",
    version: 7,
    lease_token: "00000000-0000-4000-8000-000000009999",
    lease_owner: "line_drain_dead",
    lease_expires_at: "2026-08-14T12:05:00.000Z", // still live five minutes AFTER now
    updated_at: "2026-08-14T11:49:59.000Z", // unmoved for 10m01s
  });
  const reclaimed = await persistence.claimRows({ batchId: "line_batch_1", workerId: "new-worker" });
  assert.equal(reclaimed.ok, true);
  assert.equal(reclaimed.rows.length, 1);
  assert.equal(reclaimed.rows[0].leaseOwner, "new-worker");
  assert.equal(reclaimed.staleLeaseReclaimed, 1);
  const stored = memory.get(ROW_TABLE, "line_batch_1:0");
  assert.equal(stored.lease_owner, "new-worker");
  assert.equal(stored.version, 8);
});

test("a lease with no expiry is reclaimed only once the holder is stale", async () => {
  const { memory, persistence } = await seededPersistence();
  const raw = memory.get(ROW_TABLE, "line_batch_1:0");
  memory.seed(ROW_TABLE, {
    ...raw,
    version: 7,
    lease_token: "00000000-0000-4000-8000-000000009999",
    lease_owner: "legacy-worker",
    lease_expires_at: null, // anomalous token-without-expiry lease
    updated_at: NOW, // claimed_at stamp: moved moments ago, presumed working
  });
  const protectedClaim = await persistence.claimRows({ batchId: "line_batch_1", workerId: "new-worker" });
  assert.equal(protectedClaim.rows.length, 0);
  assert.equal(memory.get(ROW_TABLE, "line_batch_1:0").version, 7);

  // The staleness window runs from claimed_at — the holder's last movement.
  // Ten quiet minutes later the lease is reclaimed like any dead holder's.
  memory.seed(ROW_TABLE, {
    ...memory.get(ROW_TABLE, "line_batch_1:0"),
    updated_at: "2026-08-14T11:49:59.000Z",
  });
  const reclaimed = await persistence.claimRows({ batchId: "line_batch_1", workerId: "new-worker" });
  assert.equal(reclaimed.rows.length, 1);
  assert.equal(reclaimed.staleLeaseReclaimed, 1);
  assert.equal(memory.get(ROW_TABLE, "line_batch_1:0").lease_owner, "new-worker");
});

test("stale token, stale version, and expired ownership cannot checkpoint", async () => {
  const { memory, persistence } = await seededPersistence();
  const claimed = await persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-a" });
  const lease = claimed.rows[0];
  const mirrored = { ...lease, status: "mirrored", previewUrl: "https://preview.example/acme" };

  const wrongToken = await persistence.checkpointRow({
    rowId: lease.rowId,
    leaseToken: "00000000-0000-4000-8000-000000009999",
    expectedVersion: lease.version,
    expectedStatus: "qualified",
    row: mirrored,
  });
  assert.equal(wrongToken.ok, false);
  assert.equal(wrongToken.error, "row_checkpoint_conflict");

  const staleVersion = await persistence.checkpointRow({
    rowId: lease.rowId,
    leaseToken: lease.leaseToken,
    expectedVersion: lease.version - 1,
    expectedStatus: "qualified",
    row: mirrored,
  });
  assert.equal(staleVersion.ok, false);

  memory.seed(ROW_TABLE, { ...memory.get(ROW_TABLE, lease.rowId), lease_expires_at: NOW });
  const expired = await persistence.checkpointRow({
    rowId: lease.rowId,
    leaseToken: lease.leaseToken,
    expectedVersion: lease.version,
    expectedStatus: "qualified",
    row: mirrored,
  });
  assert.equal(expired.ok, false);
  const unchanged = memory.get(ROW_TABLE, lease.rowId);
  assert.equal(unchanged.status, "qualified");
  assert.equal(unchanged.version, lease.version);
});

test("phone-like UUID leases remain byte-exact at checkpoint and release guards", async () => {
  assert.match(
    sanitizeRowPayload({ note: PHONE_LIKE_LEASE_UUID }).note,
    /\[redacted-phone\]/,
    "control: the generic PII scrubber must reproduce the live UUID corruption",
  );
  const memory = memoryStore();
  const persistence = createLinePersistence({
    ...memory.deps,
    randomUUID: () => PHONE_LIKE_LEASE_UUID,
  });
  assert.equal((await persistence.createBatch(batchFixture())).ok, true);
  assert.equal((await persistence.storeRows({ batchId: "line_batch_1", rows: [rowFixture()] })).ok, true);

  const lease = (await persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-a" })).rows[0];
  assert.equal(lease.leaseToken, PHONE_LIKE_LEASE_UUID);
  const checkpoint = await persistence.checkpointRow({
    rowId: lease.rowId,
    leaseToken: `  ${PHONE_LIKE_LEASE_UUID.toUpperCase()}  `,
    expectedVersion: lease.version,
    expectedStatus: "qualified",
    row: { ...lease, status: "mirrored", previewUrl: "https://preview.example/acme" },
  });
  assert.equal(checkpoint.ok, true);
  assert.equal(
    memory.calls.update.at(-1).guards.lease_token,
    `eq.${PHONE_LIKE_LEASE_UUID}`,
    "the UUID guard must never pass through the phone scrubber",
  );

  const current = memory.get(ROW_TABLE, lease.rowId);
  memory.seed(ROW_TABLE, {
    ...current,
    lease_token: PHONE_LIKE_LEASE_UUID,
    lease_owner: "worker-b",
    lease_expires_at: "2026-08-14T12:04:00.000Z",
  });
  const released = await persistence.releaseRow({
    rowId: lease.rowId,
    leaseToken: PHONE_LIKE_LEASE_UUID,
    expectedVersion: current.version,
    expectedStatus: "mirrored",
  });
  assert.equal(released.ok, true);
  assert.equal(memory.calls.update.at(-1).guards.lease_token, `eq.${PHONE_LIKE_LEASE_UUID}`);
});

test("checkpoint and release reject malformed or non-v4 lease tokens before writing", async () => {
  const { memory, persistence } = await seededPersistence();
  const before = memory.calls.update.length;
  const invalidTokens = [
    "12345678-1234-1abc-8abc-abcdefabcdef",
    "12345678-1234-4abc-7abc-abcdefabcdef",
    "a9185550134bcdef",
  ];
  for (const leaseToken of invalidTokens) {
    const checkpoint = await persistence.checkpointRow({
      rowId: "line_batch_1:0",
      leaseToken,
      expectedVersion: 0,
      expectedStatus: "qualified",
      row: rowFixture({ status: "mirrored", previewUrl: "https://preview.example/acme" }),
    });
    assert.equal(checkpoint.ok, false);
    assert.equal(checkpoint.error, "row_lease_identity_required");
    const released = await persistence.releaseRow({
      rowId: "line_batch_1:0",
      leaseToken,
      expectedVersion: 0,
      expectedStatus: "qualified",
    });
    assert.equal(released.ok, false);
    assert.equal(released.error, "row_lease_identity_required");
  }
  assert.equal(memory.calls.update.length, before, "invalid lease tokens must not reach the store");
});

test("checkpoint reload proves a commit after its response is lost and retry does not advance twice", async () => {
  const { memory, persistence } = await seededPersistence();
  const lease = (await persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-a" })).rows[0];
  const mirrored = {
    ...lease,
    status: "mirrored",
    previewUrl: "https://preview.example/acme",
    buildHash: "build-1",
    publishedAggregate: { rating: 4.9, review_count: 61 },
  };
  memory.loseNextResponse();
  const committed = await persistence.checkpointRow({
    rowId: lease.rowId,
    leaseToken: lease.leaseToken,
    expectedVersion: lease.version,
    expectedStatus: "qualified",
    row: mirrored,
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.idempotent, true);
  assert.equal(committed.alreadyApplied, true);
  const afterCommit = memory.get(ROW_TABLE, lease.rowId);
  assert.equal(afterCommit.version, lease.version + 1);
  assert.equal(afterCommit.status, "mirrored");
  assert.equal(afterCommit.lease_token, null);

  const retry = await persistence.checkpointRow({
    rowId: lease.rowId,
    leaseToken: lease.leaseToken,
    expectedVersion: lease.version,
    expectedStatus: "qualified",
    row: mirrored,
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.alreadyApplied, true);
  assert.equal(memory.get(ROW_TABLE, lease.rowId).version, lease.version + 1);

  const differentEvidence = await persistence.checkpointRow({
    rowId: lease.rowId,
    leaseToken: lease.leaseToken,
    expectedVersion: lease.version,
    expectedStatus: "qualified",
    row: { ...mirrored, previewUrl: "https://preview.example/different" },
  });
  assert.equal(differentEvidence.ok, false);
  assert.equal(differentEvidence.error, "row_checkpoint_conflict");
  assert.equal(memory.get(ROW_TABLE, lease.rowId).payload.previewUrl, "https://preview.example/acme");
});

test("empty PATCH representation is verified by mutation readback", async () => {
  const { memory, persistence } = await seededPersistence();
  const lease = (await persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-a" })).rows[0];
  memory.hideNextRepresentation();
  const released = await persistence.releaseRow({
    rowId: lease.rowId,
    leaseToken: lease.leaseToken,
    expectedVersion: lease.version,
    expectedStatus: "qualified",
  });
  assert.equal(released.ok, true);
  assert.equal(released.alreadyApplied, true);
  assert.equal(memory.get(ROW_TABLE, lease.rowId).lease_token, null);
});

test("database-level logo collision is surfaced without overwriting either row", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture());
  await persistence.storeRows({
    batchId: "line_batch_1",
    rows: [rowFixture(), rowFixture({ rowId: "line_batch_1:1", rowIndex: 1, prospectId: "prospect-2" })],
  });
  const firstLease = (await persistence.claimRows({ batchId: "line_batch_1", workerId: "a", limit: 1 })).rows[0];
  const first = await persistence.checkpointRow({
    rowId: firstLease.rowId,
    leaseToken: firstLease.leaseToken,
    expectedVersion: firstLease.version,
    expectedStatus: "qualified",
    row: { ...firstLease, status: "gate_passed", logoSha256: LOGO_A },
  });
  assert.equal(first.ok, true);

  const secondLease = (await persistence.claimRows({ batchId: "line_batch_1", workerId: "b", limit: 2 })).rows
    .find((row) => row.rowId === "line_batch_1:1");
  const second = await persistence.checkpointRow({
    rowId: secondLease.rowId,
    leaseToken: secondLease.leaseToken,
    expectedVersion: secondLease.version,
    expectedStatus: "qualified",
    row: { ...secondLease, status: "gate_passed", logoSha256: LOGO_A },
  });
  assert.equal(second.ok, false);
  assert.equal(second.error, "23505");
  assert.equal(memory.get(ROW_TABLE, "line_batch_1:1").status, "qualified");
});

test("approval requires exact typed ID, awaiting state, positive rows, and one version winner", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture({ status: "awaiting_approval", version: 3 }));

  const mismatch = await persistence.approveBatch({
    batchId: "line_batch_1",
    typedBatchId: "wrong",
    expectedVersion: 3,
    approvedRows: 1,
  });
  assert.equal(mismatch.error, "approval_confirmation_mismatch");

  const approved = await persistence.approveBatch({
    batchId: "line_batch_1",
    typedBatchId: "line_batch_1",
    expectedVersion: 3,
    approvedRows: 2,
    actor: "operator",
  });
  assert.equal(approved.ok, true);
  assert.equal(memory.get(BATCH_TABLE, "line_batch_1").version, 4);
  assert.equal(memory.get(BATCH_TABLE, "line_batch_1").status, "approved");

  const retry = await persistence.approveBatch({
    batchId: "line_batch_1",
    typedBatchId: "line_batch_1",
    expectedVersion: 3,
    approvedRows: 2,
    actor: "operator",
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.alreadyApplied, true);
  assert.equal(memory.get(BATCH_TABLE, "line_batch_1").version, 4);
});

test("a done sandbox batch that still owns queued rows can be re-approved by typed id", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture({ status: "done", version: 7 }));
  await persistence.storeRows({
    batchId: "line_batch_1",
    rows: [rowFixture({ status: "queued", history: [{ status: "queued", at: NOW }] })],
  });

  const refused = await persistence.approveBatch({
    batchId: "line_batch_1",
    typedBatchId: "line_batch_1",
    expectedVersion: 7,
    approvedRows: 0,
  });
  assert.equal(refused.error, "nothing_passed_the_render_gate");
  assert.equal(memory.get(BATCH_TABLE, "line_batch_1").status, "done");

  const reapproved = await persistence.approveBatch({
    batchId: "line_batch_1",
    typedBatchId: "line_batch_1",
    expectedVersion: 7,
    approvedRows: 1,
    actor: "operator",
  });
  assert.equal(reapproved.ok, true);
  assert.equal(reapproved.reapproved, true);
  const reopened = memory.get(BATCH_TABLE, "line_batch_1");
  assert.equal(reopened.status, "approved");
  assert.equal(reopened.version, 8);
  assert.equal(reopened.approval.approvedRows, 1);
  assert.equal(reopened.approval.actor, "operator");
});

test("a done live batch is never re-openable by re-approval", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  await persistence.createBatch(batchFixture({ lane: "live", status: "done", version: 2 }));
  await persistence.storeRows({
    batchId: "line_batch_1",
    rows: [rowFixture({ status: "queued", history: [{ status: "queued", at: NOW }] })],
  });

  const refused = await persistence.approveBatch({
    batchId: "line_batch_1",
    typedBatchId: "line_batch_1",
    expectedVersion: 2,
    approvedRows: 1,
    actor: "operator",
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.conflict, true);
  assert.equal(refused.error, "batch_approval_conflict");
  assert.equal(memory.get(BATCH_TABLE, "line_batch_1").status, "done");
});

test("signal and absolute deadline options reach every injected store call", async () => {
  const memory = memoryStore();
  const persistence = createLinePersistence(memory.deps);
  const controller = new AbortController();
  const requestOptions = { signal: controller.signal, deadlineAt: Date.parse(NOW) + 60_000 };
  await persistence.createBatch(batchFixture(), requestOptions);
  await persistence.storeRows({ batchId: "line_batch_1", rows: [rowFixture()] }, requestOptions);
  await persistence.loadBatch("line_batch_1", requestOptions);
  await persistence.claimRows({ batchId: "line_batch_1", workerId: "worker-a" }, requestOptions);

  for (const call of [...memory.calls.insert, ...memory.calls.select, ...memory.calls.update]) {
    assert.equal(call.requestOptions, requestOptions);
  }
});

test("release identity UUIDs with phone-like digit runs survive payload scrubbing", () => {
  const siteId = "78ac5c55-ea20-4874-8327-baaec944ee8a";
  const releaseId = "3b66954f-b1d2-8b4b-b744-8d30626aa3d3";
  const sanitized = sanitizeRowPayload({
    buildEvidence: {
      release_evidence: {
        proofIdentity: { site_id: siteId, release_id: releaseId, build_hash: "a".repeat(64) },
        sharedReleaseEvidence: { site_id: siteId, release_id: releaseId, build_hash: "a".repeat(64) },
      },
    },
  });
  const evidence = sanitized.buildEvidence.release_evidence;
  assert.equal(evidence.proofIdentity.site_id, siteId);
  assert.equal(evidence.proofIdentity.release_id, releaseId);
  assert.equal(evidence.sharedReleaseEvidence.site_id, siteId);
  assert.ok(!JSON.stringify(sanitized).includes("[redacted-phone]"));
});
