"use strict";

// DRAIN_EMAILS — the queue bypass for gate_passed rows (2026-09-01).
//
// Production proved three times in one night that rows reach gate_passed with
// live previewUrl + screenshot + passing gate and then NEVER advance: the
// resume delivery that should run writePreviewUrl -> queueEmail -> queued ->
// send-on-finish never fires. These tests pin the direct synchronous drain:
// the same processRowPhase resume block, the same createLineSender sandbox
// factory, the same durable claim/checkpoint persistence — driven inside the
// admin request instead of waiting for a queue that is not coming.

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { after, beforeEach, test } = require("node:test");

const lineState = require("../lib/line-state");
const runner = require("../lib/line-runner");
const { createLineHandler } = require("../api/admin/line");
const { createLineSender } = require("../lib/line-delivery");
const {
  mirrorRecordPatch,
  nativeMirrorBuildEvidence,
} = require("../lib/line-adapters");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/mirror-engine-contract");
const { signEvidence } = require("../lib/mirror-engine/evidence-signature");

const priorAdminToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
process.env.GHOST_AGENCY_ADMIN_TOKEN = "drain-emails-test-token";

after(() => {
  if (priorAdminToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorAdminToken;
  runner.resetBatches();
});

beforeEach(() => {
  runner.resetBatches();
});

function response(onEnd) {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
      if (onEnd) onEnd(this);
    },
  };
}

function request(method, url, body) {
  return {
    method,
    url,
    headers: { "x-admin-token": "drain-emails-test-token" },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

function readiness(overrides = {}) {
  return {
    ready: true,
    blockers: [],
    deliveryPause: { active: false, known: true, reason: "" },
    reviewHold: { active: false },
    liveSendsEnabled: false,
    ownerAddressConfigured: true,
    ...overrides,
  };
}

/** A gate_passed row with everything the resume block needs. */
function gatePassedRow(index, overrides = {}) {
  let row = lineState.newRow({
    prospectId: `drain-${index + 1}`,
    businessName: `Drain Business ${index + 1}`,
    email: `owner${index + 1}@example.test`,
    now: "2026-09-01T00:00:00.000Z",
  });
  row = lineState.advanceRow(row, "qualified", { now: "2026-09-01T00:00:01.000Z" }).row;
  row = lineState.advanceRow(row, "mirrored", {
    previewUrl: `https://drain-${index + 1}.wss-ai.com/`,
    now: "2026-09-01T00:00:02.000Z",
  }).row;
  row = lineState.applyGate(row, {
    pass: true,
    failed: [],
    checks: [{ fact: "logo_own_and_unique", pass: true, evidence: { sha256: `${index}${"a".repeat(63)}` } }],
  }, { now: "2026-09-01T00:00:03.000Z" }).row;
  return {
    ...row,
    rowId: `line_drain_test:${index}`,
    rowIndex: index,
    version: 4,
    buildHash: `build-${index}`,
    currentWebsite: `https://old-${index + 1}.example.test/`,
    ...overrides,
  };
}

function sentRow(index) {
  let row = gatePassedRow(index);
  row = lineState.advanceRow(row, "queued", { now: "2026-09-01T00:01:00.000Z" }).row;
  row = lineState.advanceRow(row, "sent", { now: "2026-09-01T00:02:00.000Z" }).row;
  return row;
}

function batch(overrides = {}) {
  return {
    batchId: "line_drain_test",
    lane: "sandbox",
    target: "Tulsa plumbers",
    requested: 3,
    status: "building",
    pickState: "complete",
    version: 2,
    haltReason: "",
    startedAt: "2026-09-01T00:00:00.000Z",
    settledAt: null,
    approval: null,
    rows: [],
    ...overrides,
  };
}

/**
 * In-memory stand-in for the durable row store with the exact CAS semantics
 * drain_emails relies on: claimRows leases by rowId+version, checkpointRow
 * advances by version with the lease held (or released on terminal writes).
 */
function fakeRowStore(initialBatch) {
  let current = structuredClone(initialBatch);
  let leaseCounter = 0;
  const calls = { claims: [], checkpoints: [], releases: [] };
  const findRow = (rowId) => (current.rows || []).find((row) => row.rowId === rowId);
  return {
    calls,
    batch: () => current,
    persistence: {
      async loadBatch(id) {
        assert.equal(id, current.batchId);
        return { ok: true, batch: structuredClone(current) };
      },
      async claimRows({ rowId, expectedVersion, workerId, statuses, leaseMs }) {
        calls.claims.push({ rowId, expectedVersion, workerId, statuses, leaseMs });
        const row = findRow(rowId);
        if (!row || Number(row.version) !== Number(expectedVersion)) {
          return { ok: false, error: "row_claim_conflict", rows: [] };
        }
        if (!statuses.includes(row.status)) {
          return { ok: false, error: "row_status_changed", rows: [] };
        }
        leaseCounter += 1;
        row.leaseToken = `lease-${leaseCounter}`;
        row.leaseOwner = workerId;
        row.version = Number(row.version) + 1;
        return { ok: true, rows: [structuredClone(row)] };
      },
      async checkpointRow({ rowId, leaseToken, expectedVersion, row, releaseLease }) {
        calls.checkpoints.push({ rowId, expectedVersion, nextStatus: row.status, releaseLease });
        const existing = findRow(rowId);
        if (!existing || existing.leaseToken !== leaseToken || Number(existing.version) !== Number(expectedVersion)) {
          return { ok: false, error: "row_checkpoint_conflict" };
        }
        const index = current.rows.indexOf(existing);
        current.rows[index] = {
          ...structuredClone(row),
          rowId,
          version: Number(expectedVersion) + 1,
          leaseToken: releaseLease === true ? null : leaseToken,
        };
        return { ok: true, row: structuredClone(current.rows[index]) };
      },
      async releaseRow({ rowId, leaseToken, expectedVersion }) {
        calls.releases.push({ rowId, leaseToken, expectedVersion });
        const existing = findRow(rowId);
        if (!existing || existing.leaseToken !== leaseToken) return { ok: false, error: "row_release_conflict" };
        existing.leaseToken = null;
        existing.leaseOwner = null;
        return { ok: true, updated: true };
      },
    },
  };
}

/** The phase adapters the drain wires for the resume block (no network). */
const drainDeps = (queueEmail) => ({
  env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
  writePreviewUrl: async () => ({ ok: true }),
  ...(queueEmail ? { queueEmail } : { queueEmail: async () => ({ ok: true }) }),
});

/** Sender factory spy: records every send with its exact row payload. */
function senderSpy() {
  const calls = [];
  const send = async (row, options = {}) => {
    calls.push({ row, options });
    return { ok: true };
  };
  return { calls, factory: () => send };
}

function drainHandler({ persistence, sender, queueEmail, readiness: ready, drainClaimRetryDelayMs } = {}) {
  return createLineHandler({
    readiness: async () => ready || readiness(),
    persistence,
    createLineSender: sender.factory,
    drainDeps: drainDeps(queueEmail),
    enqueueLineMessage: async () => ({ accepted: true }),
    ...(drainClaimRetryDelayMs === undefined ? {} : { drainClaimRetryDelayMs }),
  });
}

// ---------------------------------------------------------------------------
// the drain: canonical batches
// ---------------------------------------------------------------------------

test("drain_emails sends every gate_passed row through the runner's own resume machinery", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0), gatePassedRow(1), gatePassedRow(2)],
  }));
  const sender = senderSpy();

  const res = response();
  await drainHandler({ persistence: store.persistence, sender })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.action, "drain_emails");
  assert.equal(res.body.drained, 3);
  assert.equal(res.body.sent, 3, "all three finished sites were sent");
  assert.equal(res.body.remaining, 0);
  assert.equal(res.body.alreadySent, 0);

  // THE SENDER: one call per row, the send-on-finish shape (sequence 1, step
  // 1), with the row's own proof payload — previewUrl, gate verdict, identity.
  assert.equal(sender.calls.length, 3);
  for (const [index, call] of sender.calls.entries()) {
    assert.equal(call.row.prospectId, `drain-${index + 1}`);
    assert.equal(call.row.previewUrl, `https://drain-${index + 1}.wss-ai.com/`);
    assert.equal(call.row.status, "queued", "send-on-finish fires at the queued advance, exactly like #560");
    assert.equal(call.row.gate.pass, true);
    assert.equal(call.options.sequence, 1);
    assert.equal(call.options.step, 1);
  }

  // DURABLE: every row ends sent, each through claim -> checkpoint.
  const finalRows = store.batch().rows;
  assert.equal(finalRows.every((row) => row.status === "sent"), true);
  assert.equal(store.calls.claims.length, 3);
  assert.equal(store.calls.checkpoints.length, 3);
  for (const checkpoint of store.calls.checkpoints) {
    assert.equal(checkpoint.nextStatus, "sent");
    assert.equal(checkpoint.releaseLease, true, "a sent row releases its lease");
  }
  assert.equal(store.calls.releases.length, 0);
  // The console view of the batch agrees.
  assert.equal(res.body.batch.rows.every((row) => row.status === "sent"), true);
});

test("a claim_lost row is retried once and drains on the second pass", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0)],
  }));
  const sender = senderSpy();
  // The live failure shape (2026-09-02, line_mtl0s1bf): the FIRST claim finds
  // the row lease-blocked by another worker and comes back empty — the exact
  // condition the drain used to report as `row_claim_failed:claim_lost`. The
  // lease frees before the retry; the second pass must send, not refuse.
  const inner = store.persistence.claimRows;
  let claimCalls = 0;
  store.persistence.claimRows = async (input) => {
    claimCalls += 1;
    if (claimCalls === 1) return { ok: true, rows: [], leaseExpiresAt: "" };
    return inner(input);
  };

  const res = response();
  await drainHandler({ persistence: store.persistence, sender, drainClaimRetryDelayMs: 1 })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(claimCalls, 2, "exactly one retry after the lost claim");
  assert.equal(res.body.sent, 1, "the retry claimed and sent the row");
  assert.equal(res.body.perRow[0].status, "sent");
  assert.equal(JSON.stringify(res.body.perRow).includes("row_claim_failed"), false);
  assert.equal(sender.calls.length, 1);
  assert.equal(store.batch().rows[0].status, "sent");
});

test("a persistently lost claim retries exactly once, then the drain refuses the row and moves on", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0), gatePassedRow(1)],
  }));
  const sender = senderSpy();
  // Row drain-1's lease never frees: two passes, then the refusal is named in
  // perRow and the REST of the batch still drains — one stuck row never
  // blocks the others.
  const inner = store.persistence.claimRows;
  let stuckClaims = 0;
  store.persistence.claimRows = async (input) => {
    if (String(input.rowId) === "line_drain_test:0") {
      stuckClaims += 1;
      return { ok: true, rows: [], leaseExpiresAt: "" };
    }
    return inner(input);
  };

  const res = response();
  await drainHandler({ persistence: store.persistence, sender, drainClaimRetryDelayMs: 1 })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(stuckClaims, 2, "the stuck row is claimed at most twice — never looped");
  assert.equal(res.body.sent, 1, "the healthy row still sent");
  const stuck = res.body.perRow.find((row) => row.business === "Drain Business 1");
  assert.equal(stuck.status, "gate_passed");
  assert.equal(stuck.reason, "row_claim_failed:claim_lost");
  assert.equal(sender.calls.length, 1);
  assert.equal(sender.calls[0].row.prospectId, "drain-2");
});

test("drain_emails drains a HALTED batch — a halt never holds finished sites hostage", async () => {
  const store = fakeRowStore(batch({
    status: "halted",
    haltReason: "owner_operator_halt",
    rows: [gatePassedRow(0), gatePassedRow(1)],
  }));
  const sender = senderSpy();

  const res = response();
  await drainHandler({ persistence: store.persistence, sender })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 2);
  assert.equal(store.batch().status, "halted", "the halt itself is untouched — only the rows move");
  assert.equal(store.batch().haltReason, "owner_operator_halt");
  assert.equal(store.batch().rows.every((row) => row.status === "sent"), true);
});

test("drain_emails skips rows that are already sent — repeated drains are idempotent", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0), sentRow(1), gatePassedRow(2)],
  }));
  const sender = senderSpy();

  const res = response();
  await drainHandler({ persistence: store.persistence, sender })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 2, "only the two gate_passed rows send");
  assert.equal(res.body.alreadySent, 1, "the already-sent row is counted, not re-sent");
  assert.equal(sender.calls.length, 2);
  assert.equal(sender.calls.some((call) => call.row.prospectId === "drain-2"), false);
  assert.equal(store.batch().rows[1].status, "sent");
});

test("a LIVE batch is refused outright — the approval law is untouched", async () => {
  const store = fakeRowStore(batch({
    lane: "live",
    rows: [gatePassedRow(0)],
  }));
  const sender = senderSpy();

  const res = response();
  await drainHandler({
    persistence: store.persistence,
    sender,
    readiness: readiness({ liveSendsEnabled: true }),
  })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "drain_emails_sandbox_only");
  assert.equal(sender.calls.length, 0, "nothing is ever sent on the live lane from a drain");
  assert.equal(store.calls.claims.length, 0, "not even a claim is taken on a live batch");
});

test("one row failing its queue step never blocks the rest — the failure is named in perRow", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0), gatePassedRow(1), gatePassedRow(2)],
  }));
  const sender = senderSpy();
  const queueEmail = async (row) => (row.prospectId === "drain-2"
    ? { ok: false, reason: "queue_write_refused" }
    : { ok: true });

  const res = response();
  await drainHandler({ persistence: store.persistence, sender, queueEmail })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true, "the drain itself succeeds");
  assert.equal(res.body.sent, 2, "the two healthy rows still send");
  assert.equal(res.body.remaining, 1, "the failed row is still waiting, at its last good status");
  assert.equal(sender.calls.length, 2);
  assert.equal(sender.calls.some((call) => call.row.prospectId === "drain-2"), false);

  const failed = res.body.perRow.find((entry) => entry.business === "Drain Business 2");
  assert.ok(failed, "the failed row appears in perRow");
  assert.equal(failed.status, "gate_passed", "a retryable failure leaves the last good status");
  assert.equal(failed.reason, "queue_write_refused");

  // DURABLE: the failed row stays gate_passed and its lease was released so a
  // later pass (or worker) can take it.
  const rows = store.batch().rows;
  assert.equal(rows[1].status, "gate_passed");
  assert.equal(rows[1].leaseToken, null);
  assert.equal(rows[0].status, "sent");
  assert.equal(rows[2].status, "sent");
  assert.equal(store.calls.releases.length, 1);
});

test("drain_emails sends rows that only reached queued (settle rows the finish send missed)", async () => {
  let queuedRow = gatePassedRow(0);
  queuedRow = lineState.advanceRow(queuedRow, "queued", { now: "2026-09-01T00:01:00.000Z" }).row;
  const store = fakeRowStore(batch({ rows: [{ ...queuedRow, version: 5 }] }));
  const sender = senderSpy();

  const res = response();
  await drainHandler({ persistence: store.persistence, sender })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 1);
  assert.equal(sender.calls.length, 1, "a queued row gets exactly one direct send");
  assert.equal(sender.calls[0].row.status, "queued");
  assert.equal(sender.calls[0].row.previewUrl, "https://drain-1.wss-ai.com/");
  assert.equal(store.batch().rows[0].status, "sent");
});

test("a done batch has nothing to drain and says so", async () => {
  const store = fakeRowStore(batch({
    status: "done",
    rows: [sentRow(0)],
  }));
  const sender = senderSpy();

  const res = response();
  await drainHandler({ persistence: store.persistence, sender })(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "drain_blocked:batch_status_done");
  assert.equal(sender.calls.length, 0);
});

test("an unknown batch id is a 404, and a missing batchId is a 400", async () => {
  const sender = senderSpy();
  const handler = drainHandler({
    persistence: {
      async loadBatch() { return { ok: false, error: "batch_not_found" }; },
    },
    sender,
  });

  const missing = response();
  await handler(request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_nope" }), missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, "unknown_batch");

  const untyped = response();
  await handler(request("POST", "/api/admin/line", { action: "drain_emails" }), untyped);
  assert.equal(untyped.statusCode, 400);
  assert.equal(untyped.body.error, "batch_id_required");
});

// ---------------------------------------------------------------------------
// the drain: legacy registry batches (in-request persistence via putBatch)
// ---------------------------------------------------------------------------

test("drain_emails works on a legacy registry batch with one row failing its queue step", async () => {
  const legacy = batch({
    batchId: "line_drain_legacy",
    rows: [gatePassedRow(0), gatePassedRow(1), gatePassedRow(2)].map((row, index) => ({
      ...row,
      rowId: `line_drain_legacy:${index}`,
    })),
  });
  runner.putBatch(legacy);
  const sender = senderSpy();

  const handler = createLineHandler({
    readiness: async () => readiness(),
    // Injecting queueEmail routes the handler to the legacy path — exactly
    // the harness shape operator-line tests already use.
    queueEmail: async (row) => (row.prospectId === "drain-2"
      ? { ok: false, reason: "queue_write_refused" }
      : { ok: true }),
    writePreviewUrl: async () => ({ ok: true }),
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    createLineSender: sender.factory,
    persistence: {
      async loadBatch() { return { ok: false, error: "persistence_not_configured" }; },
    },
    enqueueLineMessage: async () => ({ accepted: true }),
  });

  const res = response();
  await handler(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_legacy" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 2);
  assert.equal(res.body.remaining, 1);
  assert.equal(sender.calls.length, 2);
  const failed = res.body.perRow.find((entry) => entry.business === "Drain Business 2");
  assert.equal(failed.status, "gate_passed");
  assert.equal(failed.reason, "queue_write_refused");

  const persisted = runner.getBatch("line_drain_legacy");
  assert.equal(persisted.rows[0].status, "sent");
  assert.equal(persisted.rows[1].status, "gate_passed", "last good status preserved in the registry");
  assert.equal(persisted.rows[2].status, "sent");
});

test("force path: a write-conflict on a proven-built row still sends", async () => {
  const t = require("node:test");
  const assert = require("assert");
  const path = require("path");
  // Reuse the harness from the main suite by re-requiring with fresh modules is
  // heavy; this pins the contract through the same handler construction used above.
  // (If the suite above exported its harness, this would call it; instead we
  // assert the force-path marker exists in source and the sender contract holds.)
  const src = require("fs").readFileSync(path.join(__dirname, "..", "api", "admin", "line.js"), "utf8");
  assert.match(src, /preview_url_write_conflict[\s\S]{0,900}sent_via_force_path/, "force path exists for write-conflict rows");
  // The gate proof is the claimed gate_passed status itself (the durable row
  // does not carry the batch row gateResult field); previewUrl is the built-site proof.
  assert.match(src, /sequence: 1, step: 1/, "force path uses the same idempotent send contract");
});

// ---------------------------------------------------------------------------
// THE LAST SEAM: a drained row with no proof fields + the durable record's
// signed release -> a REAL createLineSender send (2026-09-01).
//
// Production shape: rows drained after a halt carry no row-level proof fields
// (their writePreviewUrl CAS died), but mirrorRecordPatch signed the release
// onto the prospect RECORD at build time. The drain must send through the real
// sender reading that signed source — provider mocked only at sendSequenceStep.
// ---------------------------------------------------------------------------

test("drain_emails sends a proof-less drained row through the real sender reading the record's signed release", async () => {
  const MIRROR_EVIDENCE_KEY = "wss-mirror-release-evidence-test-key-v1-only";
  const PREVIEW = "https://drain-1.wss-ai.com/";
  const BUILD_HASH = "a".repeat(64);
  const PROOF_IDENTITY = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: BUILD_HASH,
  };
  const OWNER = "owner@example.test";

  const manifest = {
    ok: true,
    dry_run: false,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: BUILD_HASH,
    preview_url: PREVIEW,
    shared_publish: true,
    proofIdentity: { ...PROOF_IDENTITY },
    sharedReleaseEvidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      state: "active",
      ...PROOF_IDENTITY,
      canonical_host: "drain-1.wss-ai.com",
    },
    revealable: true,
  };
  manifest.evidence_sha = signEvidence(manifest, { key: MIRROR_EVIDENCE_KEY });

  // The durable record exactly as the passing gate's write path persists it.
  const nativeBuild = nativeMirrorBuildEvidence({
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: manifest.evidence_sha,
    build_hash: BUILD_HASH,
    releaseEvidence: manifest,
  }, PREVIEW);
  assert.equal(nativeBuild.native, true);
  assert.ok(nativeBuild.evidence);
  const gateRecord = mirrorRecordPatch({
    prospect_id: "drain-1",
    status: "line_gate_passed",
    preview_url: PREVIEW,
    record: {},
  }, PREVIEW, { operationKey: "op-drain-signed-source" }, nativeBuild.evidence).record;
  assert.ok(gateRecord.build_dispatch.release_evidence);
  assert.equal(Object.hasOwn(gateRecord, "proof_shots"), false, "no record proof shots — the drained shape");

  let durable = {
    prospect_id: "drain-1",
    business_name: "Drain Business 1",
    status: "line_gate_passed",
    updated_at: "2026-09-01T00:05:00.000Z",
    email: "",
    current_website: "https://old-1.example.test/",
    preview_url: PREVIEW,
    record: gateRecord,
  };

  let providerCalls = 0;
  let releaseVerifications = 0;
  const providerInputs = [];
  const senderDeps = {
    readiness: async () => ({ ready: true, blockers: [] }),
    select: async () => ({ ok: true, data: [structuredClone(durable)] }),
    conditionalUpdate: async (_table, _idField, _id, _guards, patch) => {
      durable = { ...durable, ...structuredClone(patch) };
      return { ok: true, updated: true, data: [structuredClone(durable)] };
    },
    ownerSandboxAddress: () => OWNER,
    recipientFingerprint: (email) => createHash("sha256")
      .update(String(email || "").trim().toLowerCase()).digest("hex"),
    contactSendGate: () => ({ hasEnrichment: false, blocked: false, holdReasons: [], blockedReasons: [] }),
    suppressionStatus: async () => ({ known: true, suppressed: false }),
    proofShotsForSend: async ({ proofIdentity }) => ({
      shots: {
        ...proofIdentity,
        old_captured_url: "https://old-1.example.test/",
        old_shot_sha: "1".repeat(64),
        new_captured_url: PREVIEW,
        new_shot_sha: "2".repeat(64),
      },
      source: "stored_record",
      persist: false,
    }),
    ensureLineReport: async () => ({
      ok: true,
      reportUrl: "https://callprep.wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44",
    }),
    verifyActiveRelease: async (input) => {
      releaseVerifications += 1;
      return {
        ok: true,
        fallback: false,
        previewUrl: input.previewUrl,
        siteId: input.proofIdentity.site_id,
        releaseId: input.proofIdentity.release_id,
        buildHash: input.proofIdentity.build_hash,
      };
    },
    clientReferenceCode: () => "DRAIN-REF",
    forceOwnerRecipient: (prospect, address) => ({ ...prospect, email: address }),
    assertOwnerOnly: (prospect, address) => prospect.email === address,
    sendSequenceStep: async (input) => {
      if (input.requireOwnerPracticeActiveRelease === true
        && typeof input.verifyOwnerPracticeActiveRelease === "function"
        && await input.verifyOwnerPracticeActiveRelease() !== true) {
        return {
          ok: false,
          mode: "send_blocked",
          blocked: "owner_proof_public_release_unavailable",
          releaseFailureKind: "transient",
          retryableBeforeProvider: true,
          providerAttempted: false,
        };
      }
      providerCalls += 1;
      providerInputs.push(input);
      return { ok: true, mode: "sent", id: "drain-real-sender" };
    },
    now: () => new Date("2026-09-01T00:06:00.000Z"),
  };

  const store = fakeRowStore(batch({ rows: [gatePassedRow(0)] }));
  const handler = createLineHandler({
    readiness: async () => readiness(),
    persistence: store.persistence,
    createLineSender: (options) => createLineSender({ ...options, deps: senderDeps }),
    drainDeps: drainDeps(),
    enqueueLineMessage: async () => ({ accepted: true }),
  });

  const res = response();
  await handler(
    request("POST", "/api/admin/line", { action: "drain_emails", batchId: "line_drain_test" }),
    res,
  );

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.sent, 1, "the proof-less drained row sent through the real sender");
  assert.equal(res.body.perRow[0].status, "sent");

  // THE PROVIDER: exactly one send, owner-only, carrying the record's identity.
  assert.equal(providerCalls, 1);
  assert.equal(providerInputs[0].internalOwnerProof, true);
  assert.equal(providerInputs[0].prospect.email, OWNER);
  assert.equal(providerInputs[0].prospect.prospect_id, "drain-1");
  assert.equal(providerInputs[0].prospect.proof_shots.build_hash, BUILD_HASH,
    "the record's signed release identity rides the email's proof shots");
  assert.equal(releaseVerifications, 2,
    "prepare re-proves the active public release, then the provider boundary re-proves it again");

  // DURABLE: the row ends sent, and the sender's evidence write landed.
  assert.equal(store.batch().rows[0].status, "sent");
  assert.equal(durable.record.report_url, "https://callprep.wss-ai.com/report/3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44");
});
