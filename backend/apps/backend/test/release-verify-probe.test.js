"use strict";

// /api/admin/release-verify-probe — the endpoint that turns the immutable
// packet's single silent refusal code (`owner_proof_public_release_unavailable`)
// into a named step-by-step trace on a real row. These tests pin the two
// halves the operator depends on:
//
//   1. a publisher receipt that FAILS with detail must surface that detail
//      verbatim (stage + reason), every intermediate identity check, and the
//      final refusal named to the exact failing step — never just the code; and
//   2. a passing receipt must trace all-green end to end.
//
// The publisher is mocked at the same seam the sender uses
// (deps.verifyActiveRelease); everything upstream of it — releaseEvidenceOf,
// deliveryProofIdentity, sharedReleaseVerificationInput,
// exactActiveSharedRelease, publicReleaseMatchesIdentity — is the sender's own
// production code, not a fixture of it.

const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { afterEach, beforeEach, test } = require("node:test");

const {
  createReleaseVerifyProbeHandler,
} = require("../api/admin/release-verify-probe");

const BATCH_ID = "batch-2026-08-31-probe";
const PROSPECT_ID = "p-boilerworks-1";
const SITE_ID = "3f1c2ab4-9d5e-4f60-8a1b-2c3d4e5f6a7b";
const RELEASE_ID = "7a8b9c0d-1e2f-4a3b-8c9d-0e1f2a3b4c5d";
// 64 lowercase hex with at least one a-f letter (SHARED_BUILD_HASH_RE).
const BUILD_HASH = "4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c";
const SLUG = "boilerworks";
const PREVIEW_URL = `https://${SLUG}.wss-ai.com/`;

function sharedReleaseEvidence(overrides = {}) {
  return {
    build_hash: BUILD_HASH,
    canonical_host: `${SLUG}.wss-ai.com`,
    deployment_env: "production",
    evidence_schema: "shared-site-release-evidence-v1",
    file_count: 12,
    generation: 2,
    manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
    manifest_sha256: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c",
    release_id: RELEASE_ID,
    route_generation: 2,
    site_id: SITE_ID,
    state: "active",
    ...overrides,
  };
}

function releaseEvidence(overrides = {}) {
  return {
    build_hash: BUILD_HASH,
    preview_url: PREVIEW_URL,
    proofIdentity: { site_id: SITE_ID, release_id: RELEASE_ID, build_hash: BUILD_HASH },
    sharedReleaseEvidence: sharedReleaseEvidence(),
    ...overrides,
  };
}

function proofShots() {
  return {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    new_captured_url: PREVIEW_URL,
    new_shot_sha: "9a8b7c6d5e4f30291a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d",
  };
}

function rawLineRow(overrides = {}) {
  return {
    row_id: `${BATCH_ID}:0`,
    batch_id: BATCH_ID,
    row_index: 0,
    prospect_id: PROSPECT_ID,
    status: "queued",
    version: 4,
    attempt_count: 2,
    last_retryable_error: "owner_proof_public_release_unavailable",
    lease_token: null,
    lease_owner: null,
    lease_expires_at: null,
    mutation_token: null,
    logo_sha256: null,
    terminal_at: null,
    created_at: "2026-08-31T10:00:00.000Z",
    updated_at: "2026-08-31T11:00:00.000Z",
    payload: {
      prospectId: PROSPECT_ID,
      businessName: "Boilerworks Mechanical",
      previewUrl: PREVIEW_URL,
      buildHash: BUILD_HASH,
      status: "queued",
      proofIdentity: { site_id: SITE_ID, release_id: RELEASE_ID, build_hash: BUILD_HASH },
      proof_shots: proofShots(),
      releaseEvidence: releaseEvidence(),
    },
    ...overrides,
  };
}

function rawProspect(overrides = {}) {
  return {
    prospect_id: PROSPECT_ID,
    status: "line_queued",
    preview_url: PREVIEW_URL,
    current_website: "https://boilerworks-mechanical.example/",
    record: {
      build_dispatch: { build_hash: BUILD_HASH, status: "complete" },
      proof_shots: proofShots(),
    },
    ...overrides,
  };
}

function rawBatch(overrides = {}) {
  return {
    batch_id: BATCH_ID,
    lane: "sandbox",
    status: "sending",
    version: 7,
    ...overrides,
  };
}

// The store double serves the three read-only SELECTs the probe makes, in the
// sender's own shapes (row payload -> hydrateRow, prospect -> the exact
// loadCanonicalProspect row, batch for lane/switch truth).
function selectDouble({ row = rawLineRow(), prospect = rawProspect(), batch = rawBatch() } = {}) {
  const calls = [];
  const select = async (table, query) => {
    calls.push({ table, query });
    if (table === "ghost_agency_line_batch_rows") {
      return { ok: true, data: query.includes(`prospect_id=eq.${PROSPECT_ID}`) ? [row] : [] };
    }
    if (table === "ghost_agency_prospects") {
      return { ok: true, data: [prospect] };
    }
    if (table === "ghost_agency_line_batches") {
      return { ok: true, data: [batch] };
    }
    return { ok: true, data: [] };
  };
  return { select, calls };
}

// A REAL Readable: readRawBody consumes the request as a stream, so a plain
// object with an .on() shim silently yields an empty body.
function fakeReqRes(body, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = "POST";
  req.headers = {
    "x-admin-token": process.env.GHOST_AGENCY_ADMIN_TOKEN,
    "content-type": "application/json",
    ...headers,
  };
  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; },
    writeHead(code) { this.statusCode = code; return this; },
  };
  return { req, res };
}

function parseBody(res) {
  assert.ok(res.body, "handler never ended the response");
  return JSON.parse(res.body);
}

const previousToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
const previousSwitch = process.env.GHOST_AGENCY_IMMUTABLE_PACKET;

beforeEach(() => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token-release-verify-probe";
  process.env.GHOST_AGENCY_IMMUTABLE_PACKET = "1";
});

afterEach(() => {
  if (previousToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  else process.env.GHOST_AGENCY_ADMIN_TOKEN = previousToken;
  if (previousSwitch === undefined) delete process.env.GHOST_AGENCY_IMMUTABLE_PACKET;
  else process.env.GHOST_AGENCY_IMMUTABLE_PACKET = previousSwitch;
});

// ---------------------------------------------------------------------------
// FAILING DETAIL — the publisher refuses with a named stage/reason
// ---------------------------------------------------------------------------

test("a failing publisher receipt is reported step by step, not as one silent code", async () => {
  const storeDouble = selectDouble();
  let verifyInput = null;
  const handler = createReleaseVerifyProbeHandler({
    select: storeDouble.select,
    verifyActiveRelease: async (input) => {
      verifyInput = input;
      // The exact shape createDefaultSharedSitePublisher().verifyActiveRelease
      // returns when loadActiveRelease finds the registry no longer points at
      // this release (shared-site-publisher.js:1840-1845).
      return {
        ok: false,
        fallback: false,
        reason: "shared_active_public_verification_failed",
        detail: { stage: "active_release", reason: "shared_release_not_current_active" },
      };
    },
  });

  const { req, res } = fakeReqRes({ batchId: BATCH_ID, prospectId: PROSPECT_ID });
  await handler(req, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.senderPrecondition, "canonical_recipient_loaded");
  assert.equal(payload.trace.lane, "sandbox");
  assert.equal(payload.trace.immutablePacketSelected, true);

  // Sources resolved: each labeled, marked, and verbatim.
  const labels = payload.trace.sources.map((source) => source.label);
  assert.ok(labels.includes("record.proof_shots"));
  assert.ok(labels.includes("row.proofIdentity (queued snapshot)"));
  assert.ok(labels.includes("row releaseEvidenceOf(row) -> sharedReleaseEvidence"));
  for (const source of payload.trace.sources) {
    if (source.label.startsWith("record.proof_shots")
      || source.label.startsWith("row.proofIdentity")
      || source.label.startsWith("row releaseEvidenceOf")) {
      assert.equal(source.marked, true, `expected a marked shared source: ${source.label}`);
      assert.equal(source.present, true, `expected a present source: ${source.label}`);
    }
  }

  // The reconciliation itself passed — identity is fine, so the failure is
  // genuinely downstream (this is what the silent code could not say).
  assert.equal(payload.trace.proofIdentityState.ok, true);
  assert.equal(payload.trace.proofIdentityState.active, true);
  assert.deepEqual(payload.trace.proofIdentityState.proofIdentity, {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
  });

  // The shared verification input built, and every internal check is named.
  const shared = payload.trace.sharedReleaseVerificationInput;
  assert.ok(shared.result, "sharedReleaseVerificationInput returned null");
  assert.equal(shared.result.previewUrl, PREVIEW_URL);
  assert.equal(shared.result.buildHash, BUILD_HASH);
  for (const [check, passed] of Object.entries(shared.checks)) {
    assert.equal(passed, true, `expected the shared input check to pass: ${check}`);
  }

  // The exact sender gate ran the publisher and captured everything verbatim.
  const gate = payload.trace.exactActiveSharedRelease;
  assert.equal(gate.requested, true);
  assert.equal(gate.passed, false);
  assert.equal(gate.verifyActiveRelease.called, true);
  assert.equal(gate.verifyActiveRelease.input.proofIdentity.site_id, SITE_ID);
  assert.equal(gate.verifyActiveRelease.input.proofIdentity.release_id, RELEASE_ID);
  assert.equal(gate.verifyActiveRelease.input.releaseEvidence.canonical_host, `${SLUG}.wss-ai.com`);
  assert.equal(gate.verifyActiveRelease.input.previewUrl, PREVIEW_URL);
  assert.equal(typeof gate.verifyActiveRelease.input.deadlineAt, "number");
  assert.deepEqual(verifyInput.proofIdentity, {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
  });

  // The failing receipt, verbatim — stage and reason survive to the operator.
  const receipt = gate.verifyActiveRelease.receipt;
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, "shared_active_public_verification_failed");
  assert.equal(receipt.detail.stage, "active_release");
  assert.equal(receipt.detail.reason, "shared_release_not_current_active");

  // What the real publisher consults for this input, named.
  assert.equal(gate.verifyActiveRelease.queried.host, `${SLUG}.wss-ai.com`);
  assert.equal(gate.verifyActiveRelease.queried.canonical_host, `${SLUG}.wss-ai.com`);
  assert.equal(gate.verifyActiveRelease.queried.site_id, SITE_ID);
  assert.equal(gate.verifyActiveRelease.queried.manifest_path, `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`);
  assert.match(gate.verifyActiveRelease.queried.registry_lookup, /readSiteGeneration/);

  // Identity match: each of the sender's six comparisons, individually false.
  const match = gate.identityMatch;
  assert.equal(match.receipt_ok, false);
  assert.equal(match.receipt_no_fallback, true);
  assert.equal(match.preview_url_matches, false);
  assert.equal(match.site_id_matches, false);
  assert.equal(match.release_id_matches, false);
  assert.equal(match.build_hash_matches, false);
  assert.equal(match.publicReleaseMatchesIdentity, false);

  // The final refusal names the exact failing step.
  assert.equal(payload.trace.verdict.verified, false);
  assert.equal(payload.trace.verdict.refusal, "owner_proof_public_release_unavailable");
  assert.equal(payload.trace.verdict.refusalKind, "transient");
  assert.equal(payload.trace.verdict.refusalStage, "exactActiveSharedRelease");
  assert.match(payload.trace.verdict.summary, /exactActiveSharedRelease/);

  // Read-only: three SELECTs, nothing else.
  assert.ok(storeDouble.calls.every((call) => call.table.startsWith("ghost_agency_")));
  assert.equal(storeDouble.calls.length, 3);
  assert.equal(res.headers["Cache-Control"], "no-store");
});

// ---------------------------------------------------------------------------
// HAPPY PATH — all-pass trace
// ---------------------------------------------------------------------------

test("a passing publisher receipt traces all-green end to end", async () => {
  const handler = createReleaseVerifyProbeHandler({
    select: selectDouble().select,
    verifyActiveRelease: async (input) => ({
      ok: true,
      fallback: false,
      previewUrl: input.previewUrl,
      siteId: input.proofIdentity.site_id,
      releaseId: input.proofIdentity.release_id,
      buildHash: input.proofIdentity.build_hash,
      generation: 2,
      routes: ["/", "/index.html"],
    }),
  });

  const { req, res } = fakeReqRes({ batchId: BATCH_ID, prospectId: PROSPECT_ID });
  await handler(req, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 200);
  const gate = payload.trace.exactActiveSharedRelease;
  assert.equal(gate.passed, true);
  const match = gate.identityMatch;
  assert.equal(match.receipt_ok, true);
  assert.equal(match.receipt_no_fallback, true);
  assert.equal(match.preview_url_matches, true);
  assert.equal(match.site_id_matches, true);
  assert.equal(match.release_id_matches, true);
  assert.equal(match.build_hash_matches, true);
  assert.equal(match.publicReleaseMatchesIdentity, true);

  assert.equal(payload.trace.verdict.verified, true);
  assert.equal(payload.trace.verdict.refusal, null);
  assert.equal(payload.trace.verdict.refusalKind, null);
  assert.equal(payload.trace.verdict.refusalStage, null);
  assert.equal(payload.trace.verdict.classicRefusal, null);
  assert.match(payload.trace.verdict.summary, /verified end-to-end/);
  assert.equal(payload.lastRetryableError, "owner_proof_public_release_unavailable");
});

// ---------------------------------------------------------------------------
// IDENTITY STAGE — a conflicting source refuses BEFORE any publisher call
// ---------------------------------------------------------------------------

test("conflicting proof sources name the identity stage and never reach the publisher", async () => {
  let publisherCalls = 0;
  const conflictingRow = rawLineRow({
    payload: {
      ...rawLineRow().payload,
      proofIdentity: {
        site_id: SITE_ID,
        release_id: "0d0e0f10-1122-4333-8444-555566667777",
        build_hash: BUILD_HASH,
      },
    },
  });
  const handler = createReleaseVerifyProbeHandler({
    select: selectDouble({ row: conflictingRow }).select,
    verifyActiveRelease: async () => {
      publisherCalls += 1;
      return { ok: true, fallback: false };
    },
  });

  const { req, res } = fakeReqRes({ batchId: BATCH_ID, prospectId: PROSPECT_ID });
  await handler(req, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 200);
  assert.equal(payload.trace.proofIdentityState.ok, false);
  assert.match(String(payload.trace.proofIdentityState.reason || ""), /^shared_proof_identity_conflict:/);
  assert.equal(payload.trace.sharedReleaseVerificationInput.result, null);
  // The sender refuses at the outer reconciliation, so the shared-input call
  // is never reached — same precondition, mirrored.
  assert.equal(payload.trace.sharedReleaseVerificationInput.checks.sharedInputReached, false);
  assert.equal(payload.trace.exactActiveSharedRelease.verifyActiveRelease.called, false);
  assert.equal(publisherCalls, 0);
  assert.equal(payload.trace.verdict.refusal, "owner_proof_public_release_unavailable");
  assert.equal(payload.trace.verdict.refusalKind, "identity_invalid");
  assert.equal(payload.trace.verdict.refusalStage, "deliveryProofIdentity");
  assert.match(String(payload.trace.verdict.classicRefusal || ""), /^shared_proof_identity_conflict:/);
});

// ---------------------------------------------------------------------------
// MISSING VERIFICATION INPUT — canonical_host drift refuses at input build
// ---------------------------------------------------------------------------

test("a drifted canonical_host names the exact shared-input check that refused", async () => {
  let publisherCalls = 0;
  const driftedRow = rawLineRow({
    payload: {
      ...rawLineRow().payload,
      releaseEvidence: releaseEvidence({
        sharedReleaseEvidence: sharedReleaseEvidence({ canonical_host: "other-site.wss-ai.com" }),
      }),
    },
  });
  const handler = createReleaseVerifyProbeHandler({
    select: selectDouble({ row: driftedRow }).select,
    verifyActiveRelease: async () => {
      publisherCalls += 1;
      return { ok: true, fallback: false };
    },
  });

  const { req, res } = fakeReqRes({ batchId: BATCH_ID, prospectId: PROSPECT_ID });
  await handler(req, res);
  const payload = parseBody(res);

  assert.equal(res.statusCode, 200);
  assert.equal(payload.trace.proofIdentityState.ok, true);
  const checks = payload.trace.sharedReleaseVerificationInput.checks;
  assert.equal(checks.shared_canonical_host_matches_preview_host, false);
  for (const [check, passed] of Object.entries(checks)) {
    if (check !== "shared_canonical_host_matches_preview_host") {
      assert.equal(passed, true, `expected this check to pass: ${check}`);
    }
  }
  assert.equal(payload.trace.exactActiveSharedRelease.verifyActiveRelease.called, false);
  assert.equal(publisherCalls, 0);
  assert.equal(payload.trace.verdict.refusalStage, "sharedReleaseVerificationInput");
  assert.equal(payload.trace.verdict.refusalKind, "identity_invalid");
});

// ---------------------------------------------------------------------------
// CONTRACT — admin gate, validation, 404, module shape
// ---------------------------------------------------------------------------

test("refuses without the admin token, like every /api/admin route", async () => {
  const handler = createReleaseVerifyProbeHandler({ select: selectDouble().select });
  const { req, res } = fakeReqRes({ batchId: BATCH_ID, prospectId: PROSPECT_ID }, { "x-admin-token": "" });
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(parseBody(res), { ok: false, error: "unauthorized" });
});

test("requires both ids and reports a missing row as 404", async () => {
  const handler = createReleaseVerifyProbeHandler({ select: selectDouble().select });

  const missing = fakeReqRes({ batchId: BATCH_ID });
  await handler(missing.req, missing.res);
  assert.equal(missing.res.statusCode, 400);
  assert.equal(parseBody(missing.res).error, "batch_and_prospect_ids_required");

  const empty = fakeReqRes({ prospectId: PROSPECT_ID });
  await handler(empty.req, empty.res);
  assert.equal(empty.res.statusCode, 400);

  const notFound = fakeReqRes({ batchId: "no-such-batch", prospectId: "no-such-prospect" });
  await handler(notFound.req, notFound.res);
  assert.equal(notFound.res.statusCode, 404);
  assert.equal(parseBody(notFound.res).error, "line_row_not_found");
});

test("exports the wired handler plus the factory, POST only", async () => {
  const endpoint = require("../api/admin/release-verify-probe");
  assert.equal(typeof endpoint, "function");
  assert.equal(typeof endpoint.createReleaseVerifyProbeHandler, "function");
  assert.equal(typeof endpoint.probeReleaseVerification, "function");

  const handler = createReleaseVerifyProbeHandler({ select: selectDouble().select });
  const req = Readable.from([]);
  req.method = "GET";
  req.headers = { "x-admin-token": process.env.GHOST_AGENCY_ADMIN_TOKEN };
  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});
