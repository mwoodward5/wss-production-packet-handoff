"use strict";

// RECAPTURE_PROOFS — the evidence-only repair for gate_passed rows stuck on
// no_before_after_visuals (2026-09-02).
//
// Production: 5 rows in line_mti8u213_c1644b9064 were built BEFORE the
// render-gate capture fixes (#583/#584) went Ready, so their proof-shot pairs
// never completed and every send dies at the email's visual gate. There was no
// way to repair a BUILT row — admin actions were start/halt/approve/send/
// clear_stuck/drain_emails/quarantine_sport_fencing, and none re-captures.
// These tests pin the new action: it re-runs the EXISTING capture machinery
// (captureLineEmailAssets — never a reimplementation), writes the completed
// record back to the row + prospect through the SAME durable claim/checkpoint
// law drain_emails uses, and NEVER SENDS ANYTHING.

const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");

const lineState = require("../lib/line-state");
const runner = require("../lib/line-runner");
const { createLineHandler } = require("../api/admin/line");

const priorAdminToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
process.env.GHOST_AGENCY_ADMIN_TOKEN = "recapture-proofs-test-token";

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
    headers: { "x-admin-token": "recapture-proofs-test-token" },
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

const BUILD_HASH = "a".repeat(64);
const PROOF_IDENTITY = {
  site_id: "11111111-1111-4111-8111-111111111111",
  release_id: "22222222-2222-4222-8222-222222222222",
  build_hash: BUILD_HASH,
};

/** A gate_passed row with everything a repair needs — but NO proof_shots: the
 * stuck shape the five production rows are in. */
function gatePassedRow(index, overrides = {}) {
  let row = lineState.newRow({
    prospectId: `recapture-${index + 1}`,
    businessName: `Recapture Business ${index + 1}`,
    email: `owner${index + 1}@example.test`,
    now: "2026-09-01T22:40:00.000Z",
  });
  row = lineState.advanceRow(row, "qualified", { now: "2026-09-01T22:40:01.000Z" }).row;
  row = lineState.advanceRow(row, "mirrored", {
    previewUrl: `https://recapture-${index + 1}.wss-ai.com/`,
    now: "2026-09-01T22:40:02.000Z",
  }).row;
  row = lineState.applyGate(row, {
    pass: true,
    failed: [],
    checks: [{ fact: "logo_own_and_unique", pass: true, evidence: { sha256: `${index}${"b".repeat(63)}` } }],
  }, { now: "2026-09-01T22:40:03.000Z" }).row;
  return {
    ...row,
    rowId: `line_recapture_test:${index}`,
    rowIndex: index,
    version: 4,
    buildHash: BUILD_HASH,
    proofIdentity: { ...PROOF_IDENTITY },
    currentWebsite: `https://old-${index + 1}.example.test/`,
    ...overrides,
  };
}

function batch(overrides = {}) {
  return {
    batchId: "line_recapture_test",
    lane: "sandbox",
    target: "Tulsa plumbers",
    requested: 3,
    status: "building",
    pickState: "complete",
    version: 2,
    haltReason: "",
    startedAt: "2026-09-01T22:00:00.000Z",
    settledAt: null,
    approval: null,
    rows: [],
    ...overrides,
  };
}

/** In-memory durable row store with the exact CAS semantics the action relies
 * on (same shape as the drain suite's fake): claimRows leases by
 * rowId+version+status, checkpointRow advances by version with the lease. */
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

/** Durable prospect table fake: records keyed by prospect_id (the way the real
 * table is), records every upsert, and honors the select query's id filter so
 * one row's repair cannot bleed into the next row's preflight. */
function prospectStore(initial = {}) {
  const rows = new Map(Object.entries(initial));
  const calls = { upserts: [], reads: 0 };
  return {
    calls,
    prospect: (id) => structuredClone(rows.get(id)),
    select: async (_table, query) => {
      calls.reads += 1;
      const match = /prospect_id=eq\.([^&]+)/.exec(String(query || ""));
      const id = match ? decodeURIComponent(match[1]) : "";
      const row = rows.get(id);
      return row ? { ok: true, data: [structuredClone(row)] } : { ok: true, data: [] };
    },
    upsertRow: async (_table, patch, idField) => {
      calls.upserts.push({ patch: structuredClone(patch), idField });
      const id = patch[idField || "prospect_id"];
      rows.set(id, { ...(rows.get(id) || {}), ...structuredClone(patch) });
      return { ok: true, updated: true };
    },
  };
}

/** Capture spy wired over the REAL seam (overrides.captureEmailAssets — the
 * same function the render gate's hook and the light-verification law call in
 * production). The default returns the COMPLETE pair a working capture does. */
function captureSpy(impl) {
  const calls = [];
  return {
    calls,
    capture: async (input) => {
      calls.push(structuredClone(input));
      if (!impl) {
        return {
          ok: true,
          shots: {
            ...PROOF_IDENTITY,
            old_captured_url: String(input.currentWebsite || ""),
            old_shot_sha: "1".repeat(64),
            new_captured_url: String(input.previewUrl || ""),
            new_shot_sha: "2".repeat(64),
            captured_at: "2026-09-02T00:39:00.000Z",
            captured_by: "render-gate",
          },
          results: [],
          ms: 1000,
        };
      }
      return impl(input);
    },
  };
}

/** LIVE probe override: previews answer 200 unless the test says otherwise. */
const liveOk = async () => ({ ok: true, status: 200, reason: "", cached: false });

/** THE NO-SEND GUARANTEE SPY. The action must never construct a sender and
 * never publish a queue message; either call is a failure. */
function noSendGuards() {
  const senderConstructions = [];
  const enqueues = [];
  return {
    senderConstructions,
    enqueues,
    createLineSender: (...args) => {
      senderConstructions.push(args);
      return async () => ({ ok: true });
    },
    enqueueLineMessage: async (message) => {
      enqueues.push(message);
      return { accepted: true };
    },
  };
}

function recaptureHandler({ persistence, prospects, capture, live, guards } = {}) {
  const noSend = guards || noSendGuards();
  const handler = createLineHandler({
    readiness: async () => readiness(),
    persistence,
    ...(prospects ? { select: prospects.select, upsertRow: prospects.upsertRow } : {}),
    ...(capture ? { captureEmailAssets: capture.capture } : {}),
    ...(live ? { checkPreviewLive: live } : { checkPreviewLive: liveOk }),
    createLineSender: noSend.createLineSender,
    enqueueLineMessage: noSend.enqueueLineMessage,
  });
  return { handler, noSend };
}

// ---------------------------------------------------------------------------
// the repair success path
// ---------------------------------------------------------------------------

test("recapture_proofs repairs stuck rows through the capture machinery and writes row + record — without sending", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0), gatePassedRow(1)],
  }));
  const prospects = prospectStore({
    "recapture-1": {
      prospect_id: "recapture-1",
      current_website: "https://old-1.example.test/",
      preview_url: "https://recapture-1.wss-ai.com/",
      record: { build_dispatch: { build_hash: BUILD_HASH } },
    },
    "recapture-2": {
      prospect_id: "recapture-2",
      current_website: "https://old-2.example.test/",
      preview_url: "https://recapture-2.wss-ai.com/",
      record: { build_dispatch: { build_hash: BUILD_HASH } },
    },
  });
  const capture = captureSpy();
  const { handler, noSend } = recaptureHandler({ persistence: store.persistence, prospects, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.action, "recapture_proofs");
  assert.equal(res.body.recaptured, 2);
  assert.equal(res.body.repaired, 2);
  assert.equal(res.body.perRow.every((entry) => entry.outcome === "repaired"), true);

  // THE CAPTURE: the existing machinery ran once per row with the EXACT inputs
  // a re-capture needs — preview (after), current_website (before), the build
  // hash, and the shared proof identity tuple. Motion extras stay off.
  assert.equal(capture.calls.length, 2);
  assert.deepEqual(Object.keys(capture.calls[0]).sort(), ["budgetMs", "buildHash", "currentWebsite", "motion", "previewUrl", "proofIdentity"]);
  assert.equal(capture.calls[0].previewUrl, "https://recapture-1.wss-ai.com/");
  assert.equal(capture.calls[0].currentWebsite, "https://old-1.example.test/");
  assert.equal(capture.calls[1].currentWebsite, "https://old-2.example.test/");
  assert.equal(capture.calls[0].buildHash, BUILD_HASH);
  assert.deepEqual(capture.calls[0].proofIdentity, PROOF_IDENTITY);
  assert.equal(capture.calls[0].motion, false);

  // DURABLE ROW: claimed, checkpointed, lease released, and STILL gate_passed
  // — a repair is not an advance; the normal queue/drain sends next.
  assert.equal(store.calls.claims.length, 2);
  assert.equal(store.calls.checkpoints.length, 2);
  for (const checkpoint of store.calls.checkpoints) {
    assert.equal(checkpoint.nextStatus, "gate_passed");
    assert.equal(checkpoint.releaseLease, true, "the lease is released in the same CAS");
  }
  assert.equal(store.calls.releases.length, 0);
  const rows = store.batch().rows;
  for (const [index, row] of rows.entries()) {
    assert.equal(row.status, "gate_passed");
    assert.equal(row.leaseToken, null);
    assert.equal(String(row.proof_shots.old_captured_url || ""), `https://old-${index + 1}.example.test/`);
    assert.equal(String(row.proof_shots.new_captured_url || ""), `https://recapture-${index + 1}.wss-ai.com/`);
    assert.equal(row.proof_shots.old_shot_sha, "1".repeat(64));
    assert.equal(row.proof_shots.new_shot_sha, "2".repeat(64));
    assert.equal(row.proof_shots.build_hash, BUILD_HASH);
    assert.equal(row.proof_shots.site_id, PROOF_IDENTITY.site_id);
    assert.equal(row.proofRecapture.repaired, true);
  }

  // THE PROSPECT RECORD: the same write defaultSend persists proof through.
  assert.equal(prospects.calls.upserts.length, 2);
  assert.equal(prospects.prospect("recapture-1").record.proof_shots.build_hash, BUILD_HASH);
  assert.equal(prospects.prospect("recapture-2").record.proof_shots.old_captured_url, "https://old-2.example.test/");

  // THE NO-SEND GUARANTEE: no sender was ever constructed, no queue message
  // was ever published, and the rows never left gate_passed.
  assert.equal(noSend.senderConstructions.length, 0);
  assert.equal(noSend.enqueues.length, 0);
  assert.equal(res.body.sendsAttempted, 0);
  assert.equal(rows.every((row) => row.status === "gate_passed"), true);
});

// ---------------------------------------------------------------------------
// the refusal paths
// ---------------------------------------------------------------------------

test("a preview that is not a LIVE https wss-ai.com URL is refused before any browser exists", async () => {
  const foreignRow = gatePassedRow(0, { previewUrl: "https://someone-else.vercel.app/" });
  const deadRow = gatePassedRow(1);
  const healthyRow = gatePassedRow(2);
  const store = fakeRowStore(batch({ rows: [foreignRow, deadRow, healthyRow] }));
  const capture = captureSpy();
  const live = async ({ url }) => (String(url).includes("recapture-2")
    ? { ok: false, status: 404, reason: "storage_404" }
    : { ok: true, status: 200 });

  const { handler } = recaptureHandler({ persistence: store.persistence, capture, live });
  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.repaired, 1);
  const [foreign, dead, healthy] = res.body.perRow;
  assert.equal(foreign.outcome, "refused");
  assert.equal(foreign.reason, "preview_host_not_approved");
  assert.equal(dead.outcome, "refused");
  assert.match(dead.reason, /^preview_not_live:storage_404$/);
  assert.equal(healthy.outcome, "repaired", "cheap refusals never consume the repair cap");
  // THE POINT OF THE GUARD: a dead or foreign mirror never reaches the camera.
  assert.equal(capture.calls.length, 1);
  assert.equal(capture.calls[0].previewUrl, "https://recapture-3.wss-ai.com/");
  assert.equal(store.calls.claims.length, 1, "refusals are read-only — no lease is ever taken for them");
  assert.equal(store.calls.checkpoints.length, 1);
});

// ---------------------------------------------------------------------------
// the incomplete path names its guards — never a bare no_after_shot again
// ---------------------------------------------------------------------------

test("an incomplete capture stores the named per-variant guards on the row marker and reports them", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0)],
  }));
  const prospects = prospectStore({
    "recapture-1": {
      prospect_id: "recapture-1",
      current_website: "https://old-1.example.test/",
      preview_url: "https://recapture-1.wss-ai.com/",
      record: { build_dispatch: { build_hash: BUILD_HASH } },
    },
  });
  // The exact shape the live 2026-09-02 rows hit: the after family failed on
  // the closed-page identity read, and ensureLineProofShots now names it.
  const capture = captureSpy(() => ({
    ok: false,
    reason: "no_after_shot:new=capture_identity_response_identity_unreadable,no_current_website",
    shots: {},
    results: [
      { variant: "new", ok: false, reason: "capture_identity_response_identity_unreadable" },
      { variant: "new-mobile", ok: false, reason: "capture_identity_response_identity_unreadable" },
    ],
  }));
  const { handler, noSend } = recaptureHandler({ persistence: store.persistence, prospects, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.repaired, 0);
  const [row] = res.body.perRow;
  assert.equal(row.outcome, "incomplete");
  // THE OPERATOR READS THE GUARD, NOT A FAMILY LABEL.
  assert.match(row.reason, /capture_incomplete:no_after_shot:new=capture_identity_response_identity_unreadable/);

  // THE MARKER carries the capped per-variant results for the next run.
  const marker = store.batch().rows[0].proofRecapture;
  assert.equal(marker.attempts, 1);
  assert.equal(marker.refused, undefined, "a missing after shot is retryable, not a before-refusal");
  assert.match(marker.reason, /capture_incomplete:no_after_shot:new=/);
  assert.deepEqual(marker.capture_results, [
    { variant: "new", ok: false, reason: "capture_identity_response_identity_unreadable" },
    { variant: "new-mobile", ok: false, reason: "capture_identity_response_identity_unreadable" },
  ]);

  // No record was written anywhere, and nothing was ever sent.
  assert.equal(prospects.calls.upserts.length, 0);
  assert.equal(noSend.senderConstructions.length, 0);
  assert.equal(noSend.enqueues.length, 0);
  assert.equal(store.batch().rows[0].status, "gate_passed");
});

test("a scrubbed or incomplete proof identity refuses the row with the send path's own reason", async () => {
  // Scrubber-era corruption shape: site_id present, release_id destroyed.
  const scrubbed = gatePassedRow(0, {
    proofIdentity: { site_id: "11111111-1111-4111-8111-111111111111" },
  });
  const store = fakeRowStore(batch({ rows: [scrubbed] }));
  const capture = captureSpy();
  const { handler } = recaptureHandler({ persistence: store.persistence, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.perRow[0].outcome, "refused");
  assert.match(res.body.perRow[0].reason, /^shared_proof_identity_incomplete:release_id\+build_hash$/);
  assert.equal(capture.calls.length, 0, "no capture runs for evidence no sender may ever use");
});

test("a quarantined (sport-fencing hold) prospect is refused without a capture", async () => {
  const held = gatePassedRow(0);
  const store = fakeRowStore(batch({ rows: [held] }));
  const prospects = prospectStore({
    "recapture-1": {
      prospect_id: "recapture-1",
      current_website: "https://old-1.example.test/",
      status: "held",
      record: {
        build_dispatch: { build_hash: BUILD_HASH },
        status: "held",
        blocked_reason: "vertical_mismatch_sport_fencing",
      },
    },
  });
  const capture = captureSpy();
  const { handler } = recaptureHandler({ persistence: store.persistence, prospects, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.body.perRow[0].outcome, "refused");
  assert.equal(res.body.perRow[0].reason, "vertical_mismatch_sport_fencing");
  assert.equal(capture.calls.length, 0);
});

// ---------------------------------------------------------------------------
// the double-refusal law: a before-capture that refuses on identity twice is a
// fact about their domain — mark the row with the named reason, stop looping.
// ---------------------------------------------------------------------------

test("a before-capture identity refusal is retryable once, then marks the row refused", async () => {
  const refusedCapture = () => ({
    ok: true,
    shots: {
      ...PROOF_IDENTITY,
      new_captured_url: "https://recapture-1.wss-ai.com/",
      new_shot_sha: "2".repeat(64),
      before_refused: "capture_identity_capture_domain_mismatch",
    },
    results: [{ variant: "old", ok: false, reason: "capture_identity_capture_domain_mismatch" }],
  });
  const store = fakeRowStore(batch({ rows: [gatePassedRow(0)] }));
  const prospects = prospectStore({
    "recapture-1": {
      prospect_id: "recapture-1",
      current_website: "https://old-1.example.test/",
      record: { build_dispatch: { build_hash: BUILD_HASH } },
    },
  });
  const capture = captureSpy(refusedCapture);
  const { handler } = recaptureHandler({ persistence: store.persistence, prospects, capture });

  // FIRST pass: refused on identity, but the row stays repairable.
  const first = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), first);
  assert.equal(first.body.perRow[0].outcome, "before_refused_retryable");
  assert.match(first.body.perRow[0].reason, /^before:capture_identity_capture_domain_mismatch$/);
  assert.equal(store.batch().rows[0].proofRecapture.attempts, 1);
  assert.notEqual(store.batch().rows[0].proofRecapture.refused, true);
  // No partial record is persisted as evidence — the pair is not complete.
  assert.equal(store.batch().rows[0].proof_shots, undefined);
  assert.equal(prospects.calls.upserts.length, 0);

  // SECOND pass: the same refusal marks the row refused, with the named reason.
  const second = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), second);
  assert.equal(second.body.perRow[0].outcome, "before_refused");
  assert.equal(store.batch().rows[0].proofRecapture.refused, true);
  assert.equal(store.batch().rows[0].proofRecapture.attempts, 2);

  // THIRD pass: the marker refuses the row BEFORE the browser — no third
  // identical 45-second capture of a domain that will refuse us again.
  const third = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), third);
  assert.equal(third.body.perRow[0].outcome, "refused");
  assert.match(third.body.perRow[0].reason, /^before:capture_identity_capture_domain_mismatch$/);
  assert.equal(capture.calls.length, 2, "exactly two captures ever ran");
  // THE ROW IS UNCHANGED OTHERWISE: still gate_passed, nothing sent.
  assert.equal(store.batch().rows[0].status, "gate_passed");
});

// ---------------------------------------------------------------------------
// cap + idempotence
// ---------------------------------------------------------------------------

test("the action caps at 3 rows per invocation — the fourth waits for the next call", async () => {
  const store = fakeRowStore(batch({
    rows: [gatePassedRow(0), gatePassedRow(1), gatePassedRow(2), gatePassedRow(3)],
  }));
  const capture = captureSpy();
  const { handler } = recaptureHandler({ persistence: store.persistence, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.recaptured, 3, "only three rows per call");
  assert.equal(capture.calls.length, 3);
  assert.equal(store.calls.claims.length, 3);
  assert.equal(res.body.remaining, 4, "all four rows are still awaiting sends");

  // The next call skips the three repaired rows FOR FREE (they cost no repair
  // slot) and reaches the fourth — pacing, not a refusal.
  const second = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), second);
  assert.equal(second.body.recaptured, 4);
  assert.equal(second.body.alreadyCurrent, 3);
  assert.equal(second.body.repaired, 1);
  assert.equal(store.batch().rows[3].proof_shots.build_hash, BUILD_HASH);
});

test("rows whose stored evidence is already current are skipped — re-runs are idempotent and browser-free", async () => {
  const repaired = {
    ...gatePassedRow(0),
    proof_shots: {
      ...PROOF_IDENTITY,
      old_captured_url: "https://old-1.example.test/",
      old_shot_sha: "1".repeat(64),
      new_captured_url: "https://recapture-1.wss-ai.com/",
      new_shot_sha: "2".repeat(64),
    },
  };
  const stuck = gatePassedRow(1);
  const store = fakeRowStore(batch({ rows: [repaired, stuck] }));
  const capture = captureSpy();
  const { handler } = recaptureHandler({ persistence: store.persistence, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.statusCode, 200);
  const [already, fixed] = res.body.perRow;
  assert.equal(already.outcome, "already_current");
  assert.equal(fixed.outcome, "repaired");
  assert.equal(capture.calls.length, 1, "the current row never reaches the camera");
  assert.equal(store.calls.claims.length, 1, "and never takes a lease");
  // The repaired row's record was not rewritten.
  assert.deepEqual(store.batch().rows[0].proof_shots, repaired.proof_shots);
});

// ---------------------------------------------------------------------------
// the no-send guarantee, explicitly, on BOTH lanes
// ---------------------------------------------------------------------------

test("a LIVE batch is repairable — the approval law governs sends, and nothing is sent", async () => {
  const store = fakeRowStore(batch({ lane: "live", rows: [gatePassedRow(0)] }));
  const prospects = prospectStore({
    "recapture-1": {
      prospect_id: "recapture-1",
      current_website: "https://old-1.example.test/",
      record: { build_dispatch: { build_hash: BUILD_HASH } },
    },
  });
  const capture = captureSpy();
  const { handler, noSend } = recaptureHandler({ persistence: store.persistence, prospects, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.repaired, 1, "evidence repair is lane-agnostic — it never sends");
  assert.equal(store.batch().rows[0].status, "gate_passed");
  assert.equal(store.batch().rows[0].proof_shots.build_hash, BUILD_HASH);
  assert.equal(noSend.senderConstructions.length, 0);
  assert.equal(noSend.enqueues.length, 0);
});

// ---------------------------------------------------------------------------
// batch-level refusals
// ---------------------------------------------------------------------------

test("a done batch has nothing to repair (409), an unknown batch 404s, a missing batchId 400s", async () => {
  const done = fakeRowStore(batch({ status: "done", rows: [{ ...gatePassedRow(0), status: "sent" }] }));
  const { handler: doneHandler } = recaptureHandler({ persistence: done.persistence });
  const doneRes = response();
  await doneHandler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_test" }), doneRes);
  assert.equal(doneRes.statusCode, 409);
  assert.equal(doneRes.body.error, "recapture_blocked:batch_status_done");

  const { handler: unknownHandler } = recaptureHandler({
    persistence: { async loadBatch() { return { ok: false, error: "batch_not_found" }; } },
  });
  const unknownRes = response();
  await unknownHandler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_nope" }), unknownRes);
  assert.equal(unknownRes.statusCode, 404);
  assert.equal(unknownRes.body.error, "unknown_batch");

  const { handler: plainHandler } = recaptureHandler({});
  const plainRes = response();
  await plainHandler(request("POST", "/api/admin/line", { action: "recapture_proofs" }), plainRes);
  assert.equal(plainRes.statusCode, 400);
  assert.equal(plainRes.body.error, "batch_id_required");
});

// ---------------------------------------------------------------------------
// legacy registry batches (in-request persistence via putBatch)
// ---------------------------------------------------------------------------

test("recapture_proofs repairs a legacy registry batch the same way", async () => {
  const legacy = batch({
    batchId: "line_recapture_legacy",
    rows: [gatePassedRow(0)],
  });
  runner.putBatch(legacy);
  const prospects = prospectStore({
    "recapture-1": {
      prospect_id: "recapture-1",
      current_website: "https://old-1.example.test/",
      record: { build_dispatch: { build_hash: BUILD_HASH } },
    },
  });
  const capture = captureSpy();
  const { handler, noSend } = recaptureHandler({ prospects, capture });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "recapture_proofs", batchId: "line_recapture_legacy" }), res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.repaired, 1);
  const persisted = runner.getBatch("line_recapture_legacy");
  assert.equal(persisted.rows[0].status, "gate_passed");
  assert.equal(persisted.rows[0].proof_shots.build_hash, BUILD_HASH);
  assert.equal(prospects.calls.upserts.length, 1);
  assert.equal(noSend.senderConstructions.length, 0);
  assert.equal(noSend.enqueues.length, 0);
});
