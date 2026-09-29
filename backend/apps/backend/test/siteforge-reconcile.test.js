"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { CONSENT_FIRST_REASON, deliverAutosend } = require("../lib/autosend");

const CANONICAL_SITEFORGE_BUILD_URL = "https://siteforge-app-seven.vercel.app/api/ghost-agency/build-preview";

function prospectFromRow(row = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  return { ...record, ...row, record };
}

function siteForgeStubs() {
  return {
    CANONICAL_SITEFORGE_BUILD_URL,
    extractAuthoritySummary: () => null,
    extractBuildStatus: (json = {}) => ({
      ready: json.ready === true || json.status === "ready",
      pending: json.pending === true,
      blocked: Array.isArray(json.blocked) ? json.blocked : [],
      renderer: json.renderer || null,
      generation_fingerprint: json.generation_fingerprint || null,
      qc_passed: json.qc_passed === true,
      visual_qc_passed: json.visual_qc_passed === true,
      qc_contract: json.qc_contract || null,
    }),
    extractBuildUrls: (json = {}) => ({
      report_url: json.report_url || "",
      preview_url: json.preview_url || "",
    }),
    extractCompiledTruthPacket: (json = {}) => json.payload?.truth_packet || null,
    extractOptimizationManifestUrl: () => "",
    extractReleaseEvidence: (json = {}) => json.release_evidence || null,
    siteForgeBuildToken: () => "test-token",
  };
}

function loadModules() {
  const production = fs.existsSync(path.join(__dirname, "../lib/siteforge-reconcile.js"));
  if (production) {
    return {
      reconcile: require("../lib/siteforge-reconcile"),
      cron: require("../api/cron/siteforge-reconcile"),
    };
  }

  const Module = require("node:module");
  const originalLoad = Module._load;
  const libPath = path.join(__dirname, "siteforge-reconcile-lib.js");
  const cronPath = path.join(__dirname, "siteforge-reconcile.js");
  let reconcile;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (parent?.filename === libPath && request === "./prospects") {
      return { prospectFromRow, prospectId: (value) => value.prospect_id };
    }
    if (parent?.filename === libPath && request === "./siteforge") return siteForgeStubs();
    if (parent?.filename === cronPath) {
      if (request === "../../lib/siteforge-reconcile") return reconcile;
      if (request === "../../lib/prospects") return { prospectFromRow };
      if (request === "../../lib/cron-auth") return { requireCron: () => true };
      if (request === "../../lib/full-run") return { buildPreviewForProspect: async () => ({}) };
      if (request === "../../lib/http") return {
        methodGuard: () => true,
        sendJson: () => {},
      };
      if (request === "../../lib/store") return {
        event: async () => {},
        insertRow: async () => ({ mode: "not_configured" }),
        select: async () => ({ ok: true, data: [] }),
      };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    reconcile = require(libPath);
    return { reconcile, cron: require(cronPath) };
  } finally {
    Module._load = originalLoad;
  }
}

const { reconcile, cron } = loadModules();
const {
  canonicalStatusUrl,
  createExistingJobDispatchReader,
  isValidatedTerminalDispatch,
  pendingReconcileQuery,
  reconcileSiteForgeRows,
} = reconcile;
const {
  deliverPendingAutosends,
  nextSupervisedBuild,
  prepareSupervisedBuild,
  supervisedReleaseReady,
} = cron;

function statusUrl(jobId) {
  return `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`;
}

function legacyPendingAutosend({
  runId,
  sandboxMode = false,
  now = "2026-07-28T18:00:00.000Z",
}) {
  return {
    run_id: runId,
    sandbox_mode: sandboxMode,
    requested_at: now,
    status: "pending",
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function terminalDispatch(jobId, state = "failed", overrides = {}) {
  return {
    result: {
      ok: false,
      status: 422,
      json: {
        ok: false,
        pending: false,
        status: state,
        job_id: jobId,
      },
    },
    pending: false,
    buildStatus: { ready: false, pending: false, blocked: ["capture_failed"] },
    jobId,
    statusUrl: statusUrl(jobId),
    reason: `siteforge_terminal_${state}`,
    ...overrides,
  };
}

function persistedTerminal(jobId, state = "failed") {
  return {
    status: 422,
    pending: false,
    ready: false,
    job_id: jobId,
    status_url: statusUrl(jobId),
    reason: `siteforge_terminal_${state}`,
  };
}

function candidateRow(dispatch, overrides = {}) {
  const prospectId = overrides.prospect_id || "place-chijb8urvvjamoarohonilfgjj8";
  return {
    prospect_id: prospectId,
    status: overrides.status || "new",
    preview_url: overrides.preview_url || null,
    report_url: overrides.report_url || null,
    record: {
      prospect_id: prospectId,
      business_name: "Candidate Business",
      industry: "landscaping",
      status: overrides.status || "new",
      build_dispatch: dispatch,
      ...(overrides.record || {}),
    },
  };
}

function supervisedSelect(row) {
  return async (table) => {
    if (table === "ghost_agency_supervision_holds") {
      return {
        ok: true,
        data: [{ hold_key: "supervised_10_review_pending", status: "active" }],
      };
    }
    if (table === "ghost_agency_events") return { ok: true, data: [] };
    return { ok: true, data: [row] };
  };
}

function sandboxSettlementStore(initialRow) {
  let state = structuredClone(initialRow);
  const writes = [];
  const conditionalUpdateFn = async (_table, _idColumn, idValue, guards, patch) => {
    const intent = state.record?.autosend;
    const matches = state.prospect_id === idValue
      && guards.updated_at === `eq.${state.updated_at}`
      && guards["record->autosend->>run_id"] === `eq.${intent?.run_id || ""}`
      && guards["record->autosend->>requested_at"] === `eq.${intent?.requested_at || ""}`
      && guards["record->autosend->>sandbox_mode"] === `eq.${String(intent?.sandbox_mode)}`
      && guards["record->autosend->>status"] === `eq.${intent?.status || ""}`;
    if (!matches) return { ok: true, mode: "live_update", updated: false, rows: [] };
    state = structuredClone(patch);
    writes.push(structuredClone(patch));
    return { ok: true, mode: "live_update", updated: true, rows: [structuredClone(state)] };
  };
  return {
    conditionalUpdateFn,
    get state() {
      return structuredClone(state);
    },
    replace(next) {
      state = structuredClone(next);
    },
    writes,
  };
}

test("production pending query remains targeted to durable jobs oldest-first", () => {
  assert.equal(
    pendingReconcileQuery(5),
    "?select=*&status=eq.new&record->build_dispatch->>pending=eq.true&record->>blocked_reason=eq.siteforge_build_pending&order=updated_at.asc.nullslast&limit=5",
  );
  assert.equal(canonicalStatusUrl(statusUrl("job-query")), statusUrl("job-query"));
  assert.equal(
    canonicalStatusUrl("https://example.com/api/ghost-agency/build-preview/job-query"),
    "",
  );
});

test("a stale already-read sandbox autosend row provider-sends zero and is abandoned", async () => {
  let providerCalls = 0;
  const staleRow = candidateRow({}, {
    status: "previewed",
    preview_url: "https://preview.wss-ai.com/stale-owner-proof/",
    report_url: "https://callprep.wss-ai.com/report/stale-owner-proof",
    record: {
      autosend: legacyPendingAutosend({ runId: "stale-owner-proof", sandboxMode: true }),
    },
  });
  staleRow.updated_at = "2026-07-28T18:00:00.000Z";
  const store = sandboxSettlementStore(staleRow);
  let upsertCalls = 0;

  const result = await deliverPendingAutosends({
    selectFn: async () => ({ ok: true, data: [staleRow] }),
    conditionalUpdateFn: store.conditionalUpdateFn,
    upsertRowFn: async () => {
      upsertCalls += 1;
      return { mode: "live_upsert", row: [] };
    },
    deliverFn: async (row) => deliverAutosend(row, {
      sendSequenceStep: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    }),
  });

  assert.equal(providerCalls, 0);
  assert.equal(result.considered, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.results[0].reason, CONSENT_FIRST_REASON);
  assert.equal(store.writes.length, 1);
  assert.equal(store.state.record.autosend.status, "abandoned");
  assert.equal(store.state.record.autosend.reason, CONSENT_FIRST_REASON);
  assert.equal(upsertCalls, 0);
});

test("stale sandbox settlement CAS misses when the owner claim lands after selection", async () => {
  const staleRow = candidateRow({}, {
    status: "previewed",
    preview_url: "https://preview.wss-ai.com/owner-claim-race/",
    report_url: "https://callprep.wss-ai.com/report/owner-claim-race",
    record: {
      autosend: legacyPendingAutosend({
        runId: "owner-claim-race",
        sandboxMode: true,
        now: "2026-07-28T18:00:00.000Z",
      }),
    },
  });
  staleRow.updated_at = "2026-07-28T18:00:01.000Z";
  const claimedRow = structuredClone(staleRow);
  claimedRow.updated_at = "2026-07-28T18:00:02.000Z";
  claimedRow.record.autosend = {
    ...claimedRow.record.autosend,
    status: "owner_proof_claimed",
    claim_id: "new-owner-claim",
  };
  const store = sandboxSettlementStore(staleRow);
  let upsertCalls = 0;

  await deliverPendingAutosends({
    selectFn: async () => ({ ok: true, data: [structuredClone(staleRow)] }),
    conditionalUpdateFn: store.conditionalUpdateFn,
    upsertRowFn: async () => {
      upsertCalls += 1;
      return { mode: "live_upsert", row: [] };
    },
    deliverFn: async (row) => {
      store.replace(claimedRow);
      return deliverAutosend(row);
    },
  });

  assert.equal(store.writes.length, 0);
  assert.equal(upsertCalls, 0);
  assert.equal(store.state.updated_at, claimedRow.updated_at);
  assert.equal(store.state.record.autosend.status, "owner_proof_claimed");
  assert.equal(store.state.record.autosend.claim_id, "new-owner-claim");
});

test("stale sandbox settlement CAS misses after the owner final write clears autosend", async () => {
  const staleRow = candidateRow({}, {
    status: "previewed",
    preview_url: "https://preview.wss-ai.com/owner-final-race/",
    report_url: "https://callprep.wss-ai.com/report/owner-final-race",
    record: {
      autosend: legacyPendingAutosend({
        runId: "owner-final-race",
        sandboxMode: true,
        now: "2026-07-28T18:10:00.000Z",
      }),
    },
  });
  staleRow.updated_at = "2026-07-28T18:10:01.000Z";
  const finalizedRow = structuredClone(staleRow);
  finalizedRow.updated_at = "2026-07-28T18:10:03.000Z";
  delete finalizedRow.record.autosend;
  const store = sandboxSettlementStore(staleRow);
  let upsertCalls = 0;

  await deliverPendingAutosends({
    selectFn: async () => ({ ok: true, data: [structuredClone(staleRow)] }),
    conditionalUpdateFn: store.conditionalUpdateFn,
    upsertRowFn: async () => {
      upsertCalls += 1;
      return { mode: "live_upsert", row: [] };
    },
    deliverFn: async (row) => {
      store.replace(finalizedRow);
      return deliverAutosend(row);
    },
  });

  assert.equal(store.writes.length, 0);
  assert.equal(upsertCalls, 0);
  assert.equal(store.state.updated_at, finalizedRow.updated_at);
  assert.equal(Object.hasOwn(store.state.record, "autosend"), false);
});

test("production reconciler still touches only canonical pending rows", async () => {
  const valid = candidateRow({
    pending: true,
    job_id: "job-valid",
    status_url: statusUrl("job-valid"),
  }, {
    prospect_id: "pending-valid",
    record: { blocked_reason: "siteforge_build_pending" },
  });
  valid.record.blocked_reason = "siteforge_build_pending";
  const invalid = candidateRow({ pending: false, status_url: statusUrl("job-invalid") }, {
    prospect_id: "not-pending",
    record: { blocked_reason: "siteforge_build_pending" },
  });
  invalid.record.blocked_reason = "siteforge_build_pending";
  const touched = [];
  const summary = await reconcileSiteForgeRows([valid, invalid], {
    batch: 10,
    dispatchSiteForgePreview: async () => ({ pending: true }),
    buildPreviewForProspect: async (prospect, options) => {
      touched.push({ prospect, options });
      return {
        ok: false,
        pending: true,
        prospect_id: prospect.prospect_id,
        status: "new",
        blocked: "siteforge_build_pending",
        persistence: "live_upsert",
      };
    },
  });

  assert.deepEqual(touched.map((item) => item.prospect.prospect_id), ["pending-valid"]);
  assert.equal(touched[0].options.source, "siteforge_reconcile");
  assert.equal(summary.eligible, 1);
  assert.equal(summary.skipped, 1);
});

test("reader preserves only job-matched canonical terminal 422 responses", async () => {
  for (const state of ["failed", "blocked", "timed_out"]) {
    const jobId = `job-${state}`;
    const reader = createExistingJobDispatchReader({
      tokenProvider: () => "test-token",
      fetchImpl: async () => response(422, {
        ok: false,
        pending: false,
        status: state,
        job_id: jobId,
        blocked: ["capture_failed"],
      }),
    });
    const result = await reader({
      resume: { job_id: jobId, status_url: statusUrl(jobId) },
    });

    assert.equal(result.result.ok, false);
    assert.equal(result.result.status, 422);
    assert.equal(result.result.json.status, state);
    assert.equal(result.error, undefined);
    assert.equal(result.reason, `siteforge_terminal_${state}`);
    assert.equal(isValidatedTerminalDispatch(result), true);
  }
});

test("reader fails closed on untrusted or noncanonical non-2xx responses", async () => {
  const cases = [
    ["auth", 401, { ok: false, pending: false, status: "failed", job_id: "job-test" }],
    ["server", 500, { ok: false, pending: false, status: "failed", job_id: "job-test" }],
    ["pending", 422, { ok: false, pending: true, status: "pending", job_id: "job-test" }],
    ["unknown-state", 422, { ok: false, pending: false, status: "error", job_id: "job-test" }],
    ["missing-job", 422, { ok: false, pending: false, status: "failed" }],
    ["mismatched-job", 422, { ok: false, pending: false, status: "failed", job_id: "job-other" }],
    ["malformed-json", 422, "not-json"],
  ];
  for (const [label, status, body] of cases) {
    const reader = createExistingJobDispatchReader({
      fetchImpl: async () => response(status, body),
      tokenProvider: () => "test-token",
    });
    const result = await reader({
      resume: { job_id: "job-test", status_url: statusUrl("job-test") },
    });
    assert.match(result.error, /^siteforge_status_http_/, label);
    assert.deepEqual(result.result.json, {}, label);
    assert.equal(isValidatedTerminalDispatch(result), false, label);
  }
});

test("reconciler reader keeps a 200 new job pending with the same durable handle", async () => {
  const jobId = "job-resumed-new";
  const durableStatusUrl = statusUrl(jobId);
  const reader = createExistingJobDispatchReader({
    tokenProvider: () => "test-token",
    fetchImpl: async () => response(200, {
      ok: true,
      status: "new",
      job_id: "job-response-drift",
    }),
  });

  const result = await reader({
    resume: { job_id: jobId, status_url: durableStatusUrl },
  });

  assert.equal(result.pending, true);
  assert.equal(result.jobId, jobId);
  assert.equal(result.statusUrl, durableStatusUrl);
  assert.equal(result.buildStatus.pending, true);
  assert.equal(result.buildStatus.ready, false);
  assert.deepEqual(result.buildStatus.blocked, []);
  assert.equal(result.reason, undefined);
  assert.equal(result.error, undefined);
  assert.equal(isValidatedTerminalDispatch(result), false);
});

test("reconciler reader bypasses caches without changing the durable status handle", async () => {
  const jobId = "job-cache-bypass";
  const durableStatusUrl = statusUrl(jobId);
  const reads = [];
  const reader = createExistingJobDispatchReader({
    tokenProvider: () => "test-token",
    fetchImpl: async (url, options) => {
      reads.push({ url, options });
      return response(200, {
        ok: true,
        pending: true,
        status: "building",
        job_id: jobId,
      });
    },
  });

  const first = await reader({
    resume: { job_id: jobId, status_url: durableStatusUrl },
  });
  const second = await reader({
    resume: { job_id: jobId, status_url: durableStatusUrl },
  });

  assert.equal(reads.length, 2);
  const firstReadUrl = new URL(reads[0].url);
  const secondReadUrl = new URL(reads[1].url);
  assert.equal(`${firstReadUrl.origin}${firstReadUrl.pathname}`, durableStatusUrl);
  assert.equal(`${secondReadUrl.origin}${secondReadUrl.pathname}`, durableStatusUrl);
  assert.ok(firstReadUrl.searchParams.get("_ts"));
  assert.ok(secondReadUrl.searchParams.get("_ts"));
  assert.notEqual(
    firstReadUrl.searchParams.get("_ts"),
    secondReadUrl.searchParams.get("_ts"),
  );
  for (const { options } of reads) {
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.headers["Cache-Control"], "no-cache");
    assert.equal(options.headers.Pragma, "no-cache");
  }
  assert.equal(first.statusUrl, durableStatusUrl);
  assert.equal(second.statusUrl, durableStatusUrl);
  assert.equal(first.pending, true);
  assert.equal(second.pending, true);
});

test("reconciler reader returns fresh compiled truth from the terminal build", async () => {
  const jobId = "job-fresh-terminal-truth";
  const truthPacket = {
    facts: {
      name: "Fresh Terminal Roofing",
      city: "Spokane",
      state: "WA",
    },
    assets: [],
    evidence: [],
    trust: {},
  };
  const reader = createExistingJobDispatchReader({
    tokenProvider: () => "test-token",
    fetchImpl: async () => response(200, {
      ok: true,
      pending: false,
      status: "ready",
      job_id: jobId,
      renderer: "05-build-v8",
      generation_fingerprint: "fresh-terminal-fingerprint",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      preview_url: "https://fresh-terminal-roofing.wss-ai.com/",
      payload: { truth_packet: truthPacket },
    }),
  });

  const result = await reader({
    resume: { job_id: jobId, status_url: statusUrl(jobId) },
  });

  assert.deepEqual(result.truthPacket, truthPacket);
});

test("prepare retries a validated terminal response before honoring its generic error field", async () => {
  const dispatch = terminalDispatch("job-terminal", "failed", {
    error: "siteforge_status_http_422",
  });
  const prepared = await prepareSupervisedBuild(
    candidateRow({ job_id: "job-terminal", status_url: statusUrl("job-terminal") }),
    async () => dispatch,
  );

  assert.equal(prepared.ok, true);
  assert.equal(prepared.mode, "terminal_replacement");
  assert.equal(prepared.prospect.build_dispatch, null);
  assert.equal(prepared.prospect.record.build_dispatch, null);
});

test("persisted validated terminal marker starts replacement without a second status read", async () => {
  let reads = 0;
  const prepared = await prepareSupervisedBuild(
    candidateRow(persistedTerminal("job-persisted", "blocked")),
    async () => {
      reads += 1;
      throw new Error("must not poll a durable validated terminal twice");
    },
  );

  assert.equal(prepared.ok, true);
  assert.equal(prepared.mode, "terminal_replacement");
  assert.equal(reads, 0);
});

test("stale persisted pending state is status-read instead of pre-skipped", async () => {
  let reads = 0;
  let builds = 0;
  const result = await nextSupervisedBuild({
    selectFn: supervisedSelect(candidateRow({
      pending: true,
      job_id: "job-pending",
      status_url: statusUrl("job-pending"),
    })),
    insertRowFn: async () => ({ mode: "live_write" }),
    statusReader: async () => {
      reads += 1;
      return { pending: true, buildStatus: { pending: true, ready: false } };
    },
    buildFn: async () => { builds += 1; },
  });

  assert.equal(reads, 1);
  assert.equal(builds, 0);
  assert.deepEqual(result, { started: false, skipped: "existing_job_pending" });
});

test("claim conflict stops the invocation so concurrent crons cannot advance to candidate two", async () => {
  let claimed = false;
  let builds = 0;
  const seenJobIds = [];
  const dependencies = {
    selectFn: supervisedSelect(candidateRow(persistedTerminal("job-old"))),
    statusReader: async () => { throw new Error("persisted terminal must not be polled"); },
    insertRowFn: async () => {
      if (!claimed) {
        claimed = true;
        return { mode: "live_write", status: 201 };
      }
      return { mode: "live_write_failed", status: 409 };
    },
    buildFn: async (_prospect, options) => {
      builds += 1;
      seenJobIds.push(options.jobId);
      await Promise.resolve();
      return { ok: false, pending: true, status: "new" };
    },
  };

  const results = await Promise.all([
    nextSupervisedBuild(dependencies),
    nextSupervisedBuild(dependencies),
  ]);

  assert.equal(builds, 1);
  assert.deepEqual(seenJobIds, [
    "siteforge_supervised_525841ae-31d5-4b94-915c-86e149d5b0fc",
  ]);
  assert.equal(results.filter((item) => item.started).length, 1);
  assert.equal(
    results.filter((item) => item.skipped === "candidate_already_claimed").length,
    1,
  );
});

test("old exhausted claim plus verified terminal skips to the next candidate", async () => {
  const now = Date.parse("2026-07-20T02:00:00.000Z");
  const firstProspectId = "place-chijb8urvvjamoarohonilfgjj8";
  const firstClaimId = "525841ae-31d5-4b94-915c-86e149d5b0fc";
  const secondProspectId = "place-chijuxnfocsajoarkn21wtucjze";
  const secondClaimId = "77580680-96b9-4698-9c8d-d1f835fcad7d";
  const first = candidateRow(persistedTerminal("job-first-terminal"), {
    prospect_id: firstProspectId,
  });
  const second = candidateRow(null, { prospect_id: secondProspectId });
  const claims = [];
  const builds = [];
  const selectFn = async (table, query) => {
    if (table === "ghost_agency_supervision_holds") {
      return {
        ok: true,
        data: [{ hold_key: "supervised_10_review_pending", status: "active" }],
      };
    }
    if (table === "ghost_agency_events") {
      if (query.includes(firstClaimId)) {
        return {
          ok: true,
          data: [{
            id: firstClaimId,
            type: "supervised.preview_build_claim",
            payload: { prospect_id: firstProspectId },
            created_at: new Date(now - (31 * 60 * 1000)).toISOString(),
          }],
        };
      }
      return { ok: true, data: [] };
    }
    if (query.includes(firstProspectId)) return { ok: true, data: [first] };
    if (query.includes(secondProspectId)) return { ok: true, data: [second] };
    return { ok: true, data: [] };
  };

  const result = await nextSupervisedBuild({
    selectFn,
    nowFn: () => now,
    statusReader: async () => { throw new Error("persisted terminal must not be polled"); },
    insertRowFn: async (_table, claim) => {
      claims.push(claim.id);
      return { mode: "live_write", status: 201 };
    },
    buildFn: async (prospect, options) => {
      builds.push({ prospectId: prospect.prospect_id, jobId: options.jobId });
      return { ok: false, pending: true, status: "new" };
    },
  });

  assert.equal(result.started, true);
  assert.deepEqual(claims, [secondClaimId]);
  assert.deepEqual(builds, [{
    prospectId: secondProspectId,
    jobId: `siteforge_supervised_${secondClaimId}`,
  }]);
});

test("recent pre-existing claim stops before terminal polling or candidate advancement", async () => {
  const now = Date.parse("2026-07-20T02:00:00.000Z");
  const prospectId = "place-chijb8urvvjamoarohonilfgjj8";
  const claimId = "525841ae-31d5-4b94-915c-86e149d5b0fc";
  const first = candidateRow(persistedTerminal("job-active-claim"), {
    prospect_id: prospectId,
  });
  let candidateReads = 0;
  let statusReads = 0;
  let builds = 0;
  const selectFn = async (table) => {
    if (table === "ghost_agency_supervision_holds") {
      return {
        ok: true,
        data: [{ hold_key: "supervised_10_review_pending", status: "active" }],
      };
    }
    if (table === "ghost_agency_events") {
      return {
        ok: true,
        data: [{
          id: claimId,
          type: "supervised.preview_build_claim",
          payload: { prospect_id: prospectId },
          created_at: new Date(now - 1000).toISOString(),
        }],
      };
    }
    candidateReads += 1;
    return { ok: true, data: [first] };
  };

  const result = await nextSupervisedBuild({
    selectFn,
    nowFn: () => now,
    statusReader: async () => { statusReads += 1; },
    insertRowFn: async () => { throw new Error("must not insert"); },
    buildFn: async () => { builds += 1; },
  });

  assert.deepEqual(result, { started: false, skipped: "candidate_claim_in_progress" });
  assert.equal(candidateReads, 1);
  assert.equal(statusReads, 0);
  assert.equal(builds, 0);
});

test("non-conflict claim failure fails closed without dispatch", async () => {
  let builds = 0;
  const result = await nextSupervisedBuild({
    selectFn: supervisedSelect(candidateRow(null)),
    statusReader: async () => { throw new Error("fresh row does not need status"); },
    insertRowFn: async () => ({ mode: "live_write_failed", status: 503 }),
    buildFn: async () => { builds += 1; },
  });

  assert.equal(builds, 0);
  assert.deepEqual(result, { started: false, skipped: "claim_write_failed" });
});

test("strict callback release wins over a stale pending dispatch", () => {
  const evidence = {
    schema: "siteforge-release-evidence-v1",
    map: { verified: true },
    identity: { verified: true },
    template_family: { verified: true },
  };
  const row = candidateRow(
    { pending: true, ready: false },
    {
      status: "previewed",
      preview_url: "https://siteforge-app-seven.vercel.app/try/candidate/",
      report_url: "https://siteforge-app-seven.vercel.app/try/candidate/scorecard.json",
      record: {
        siteforge_callback: {
          ready: true,
          renderer: "05-build-v8",
          generation_fingerprint: "pc1-callback",
          qc_passed: true,
          visual_qc_passed: true,
          qc_contract: "public-surface-v2",
          release_evidence: evidence,
        },
        release_evidence: evidence,
      },
    },
  );

  assert.equal(supervisedReleaseReady(row), true);
  row.record.siteforge_callback.release_evidence.map.verified = false;
  assert.equal(supervisedReleaseReady(row), false);
});
