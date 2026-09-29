"use strict";

// SEEDANCE AUTOLANE AT THE SEND BOUNDARY (owner directive 2026-09-03).
//
// Production evidence: every campaign mirror deployed on the donor's static
// fallback clip (fleet-audit-campaign9: heroVideo.clientClip false on every
// site) while the desktop worker polled idle — no hero job rows were ever
// written. The chain: a bank-less campaign prospect is refused
// `photo_bank_stale_or_missing` by the Seedance enqueue gate, that refusal is
// "definitive" (a permanent fallback marker), the hero boundary is then
// satisfied by the fallback rung, and the row finishes gate_passed -> queued
// -> sent with the hero question closed forever.
//
// These tests pin the fix: the gate_passed phase asks the hero question one
// last time through `ensureGatePassedHeroAutoline` —
//   (a) a fallback-boundary row enqueues the autoline job (normal path),
//   (b) the drain_emails force path rides the same phase machinery,
//   (c) the producer resolves Seedance by default and Ads when Seedance is
//       explicitly off,
//   (d) the enqueue carries the line-handle + record provenance binding the
//       worker's completion/verify machinery (shared release, sha256 receipt)
//       already owns, and a provenance refusal is a NAMED degrade,
//   (e) the send NEVER blocks on hero generation — success, refusal, and a
//       thrown ensure all still queue and send the row.

const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");

const lineState = require("../lib/line-state");
const runner = require("../lib/line-runner");
const adapters = require("../lib/line-adapters");
const { ensureGatePassedHeroAutoline } = adapters;
const { enqueueHeroRemasterForBuild } = require("../lib/full-run");
const { createLineHandler } = require("../api/admin/line");

const BUILD_HASH = "a".repeat(64);
const PREVIEW = "https://wss-test-autoline-ensure.wss-ai.com/";
const SOURCE = "https://www.goodlifeconstruction.com/";
const BATCH_ID = "line_autoline_test";
const NOW = "2026-09-03T00:00:00.000Z";

const priorAdminToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
process.env.GHOST_AGENCY_ADMIN_TOKEN = "autoline-test-token";

after(() => {
  if (priorAdminToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorAdminToken;
  runner.resetBatches();
});

beforeEach(() => {
  runner.resetBatches();
});

/** The exact marker a bank-less Seedance refusal leaves on a campaign row. */
function definitiveFallbackMarker() {
  return {
    required: false,
    ready: true,
    pending: false,
    hold: false,
    fallback: true,
    applied: false,
    status: "skipped",
    jobId: "",
    rebuildStatus: "",
    rebuildJobId: "",
    buildHash: BUILD_HASH,
    reelUrl: "",
    reason: "photo_bank_stale_or_missing",
  };
}

function gatePassedRow(overrides = {}) {
  let row = lineState.newRow({
    prospectId: "autoline-1",
    businessName: "Autoline Business",
    email: "owner@example.test",
    now: NOW,
  });
  row = lineState.advanceRow(row, "qualified", { now: NOW }).row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: PREVIEW, now: NOW }).row;
  row = lineState.applyGate(row, {
    pass: true,
    failed: [],
    checks: [{ fact: "logo_own_and_unique", pass: true, evidence: { sha256: "b".repeat(64) } }],
  }, { now: NOW }).row;
  return {
    ...row,
    rowId: `${BATCH_ID}:0`,
    rowIndex: 0,
    version: 4,
    buildHash: BUILD_HASH,
    currentWebsite: SOURCE,
    heroRemaster: definitiveFallbackMarker(),
    ...overrides,
  };
}

function durableProspect(recordOverrides = {}) {
  return {
    prospect_id: "autoline-1",
    business_name: "Autoline Business",
    current_website: SOURCE,
    status: "line_queued",
    updated_at: NOW,
    record: {
      current_website: SOURCE,
      industry: "general contractor",
      ...recordOverrides,
    },
  };
}

function selectReturning(prospect) {
  return async () => ({ ok: true, data: [structuredClone(prospect)] });
}

// ---------------------------------------------------------------------------
// The adapter, directly.
// ---------------------------------------------------------------------------

test("a gate_passed fallback row enqueues the autoline job and records it post-send", async () => {
  const enqueues = [];
  const out = await ensureGatePassedHeroAutoline(gatePassedRow(), {
    batchId: BATCH_ID,
    env: {},
    select: selectReturning(durableProspect()),
    enqueueHeroRemasterForBuild: async (prospect) => {
      enqueues.push(prospect);
      return { ok: true, queued: true, reused: false, job_id: "hrj_autoline_1" };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.ensured, true);
  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0].prospect_id, "autoline-1");
  assert.equal(out.rowPatch.heroPostSendAutoline.jobId, "hrj_autoline_1");
  assert.equal(out.rowPatch.heroPostSendAutoline.status, "queued");
  assert.equal(out.rowPatch.heroPostSendAutoline.reason, "");
});

test("rows that already own a hero identity are left alone (idempotent)", async () => {
  const enqueues = [];
  const enqueue = async () => { enqueues.push(1); return { ok: true, queued: true, job_id: "hrj_x" }; };
  const withJob = await ensureGatePassedHeroAutoline(gatePassedRow({
    heroRemaster: { ...definitiveFallbackMarker(), jobId: "hrj_existing" },
  }), { batchId: BATCH_ID, env: {}, select: selectReturning(durableProspect()), enqueueHeroRemasterForBuild: enqueue });
  assert.equal(withJob.reused, true);
  assert.equal(withJob.ensured, false);

  const applied = await ensureGatePassedHeroAutoline(gatePassedRow({
    heroRemaster: { ...definitiveFallbackMarker(), applied: true, fallback: false, jobId: "hrj_done" },
  }), { batchId: BATCH_ID, env: {}, select: selectReturning(durableProspect()), enqueueHeroRemasterForBuild: enqueue });
  assert.equal(applied.reused, true);
  assert.equal(applied.ensured, false);

  const prior = await ensureGatePassedHeroAutoline(gatePassedRow({
    heroPostSendAutoline: { at: NOW, jobId: "hrj_prior", status: "queued", reason: "" },
  }), { batchId: BATCH_ID, env: {}, select: selectReturning(durableProspect()), enqueueHeroRemasterForBuild: enqueue });
  assert.equal(prior.reused, true);
  assert.equal(prior.ensured, false);
  assert.equal(enqueues.length, 0, "no row that already owns a hero identity re-enqueues");
});

test("autoline kill switch skips the ensure entirely (no patch, no enqueue)", async () => {
  const out = await ensureGatePassedHeroAutoline(gatePassedRow(), {
    batchId: BATCH_ID,
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    select: selectReturning(durableProspect()),
    enqueueHeroRemasterForBuild: async () => {
      throw new Error("must not be called");
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.skipped, "disabled");
  assert.equal(out.rowPatch, undefined);
});

test("producer resolves to Seedance by default and Ads when Seedance is explicitly off", async () => {
  // The REAL enqueueHeroRemasterForBuild owns producer resolution; the spy
  // sits at the queue boundary where the producer lands.
  const runWith = async (env) => {
    const seen = [];
    const out = await ensureGatePassedHeroAutoline(gatePassedRow(), {
      batchId: BATCH_ID,
      env,
      select: selectReturning(durableProspect()),
      enqueueHeroRemasterForBuild: (prospect, options) => enqueueHeroRemasterForBuild(prospect, {
        ...options,
        enqueueHeroReelJob: async (p, o) => {
          seen.push({ producer: o.producer, lineHandle: o.lineHandle, reofferBuildHash: o.reofferBuildHash, record: p.record });
          return { ok: true, queued: true, reused: false, job_id: `hrj_${seen.length}` };
        },
      }),
    });
    return { out, seen };
  };

  const seedance = await runWith({});
  assert.equal(seedance.out.ensured, true, JSON.stringify(seedance.out));
  assert.equal(seedance.seen.length, 1);
  assert.equal(seedance.seen[0].producer, "openrouter_seedance",
    "Seedance is the default autoline producer (GHOST_AGENCY_SEEDANCE_PRIMARY absent)");

  const ads = await runWith({ GHOST_AGENCY_SEEDANCE_PRIMARY: "0" });
  assert.equal(ads.out.ensured, true, JSON.stringify(ads.out));
  assert.equal(ads.seen.length, 1);
  assert.equal(ads.seen[0].producer, "ads_image_to_video",
    "an explicit Seedance kill switch falls back to the Ads producer, which sources its own images");
});

test("the enqueue carries the line-handle, build hash, and record provenance binding", async () => {
  const bank = {
    version: 2,
    harvested_at: NOW,
    website: SOURCE,
    photos: [{
      url: `${SOURCE}photos/crew.webp`,
      source: "own_site",
      found_on: SOURCE,
      sha256: "c".repeat(64),
      width: 1200,
      height: 800,
    }],
  };
  const seen = [];
  const out = await ensureGatePassedHeroAutoline(gatePassedRow({
    // A bank the build harvested but never persisted rides the row; the ensure
    // must hand it to the queue so the Seedance real_scene gate can verify it.
    ownedPhotoBank: bank,
  }), {
    batchId: BATCH_ID,
    env: {},
    select: selectReturning(durableProspect()),
    enqueueHeroRemasterForBuild: (prospect, options) => enqueueHeroRemasterForBuild(prospect, {
      ...options,
      enqueueHeroReelJob: async (p, o) => {
        seen.push({ prospect: p, options: o });
        return { ok: true, queued: true, reused: false, job_id: "hrj_provenance" };
      },
    }),
  });
  assert.equal(out.ensured, true);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].options.lineHandle, { batchId: BATCH_ID, rowId: `${BATCH_ID}:0` },
    "the job is bound to this exact line row so the worker's completion receipt and shared-release swap can verify it");
  assert.equal(seen[0].options.reofferBuildHash, BUILD_HASH);
  assert.equal(seen[0].prospect.record.photo_bank.photos[0].sha256, "c".repeat(64),
    "the row's harvested bank reaches the queue's provenance gate");
  assert.equal(seen[0].options.producer, "openrouter_seedance");
});

test("a provenance refusal is a named degrade, never an error", async () => {
  const out = await ensureGatePassedHeroAutoline(gatePassedRow(), {
    batchId: BATCH_ID,
    env: {},
    select: selectReturning(durableProspect()),
    enqueueHeroRemasterForBuild: async () => ({ ok: false, queued: false, reason: "photo_bank_stale_or_missing" }),
  });
  assert.equal(out.ok, true, "a refusal degrades; it never fails the phase");
  assert.equal(out.ensured, false);
  assert.equal(
    out.rowPatch.heroPostSendAutoline.reason,
    "hero_autoline_degraded:photo_bank_stale_or_missing",
  );
});

test("a thrown ensure is caught and named, still never an error", async () => {
  const out = await ensureGatePassedHeroAutoline(gatePassedRow(), {
    batchId: BATCH_ID,
    env: {},
    select: selectReturning(durableProspect()),
    enqueueHeroRemasterForBuild: async () => { throw new Error("autoline lane exploded"); },
  });
  assert.equal(out.ok, true);
  assert.match(out.rowPatch.heroPostSendAutoline.reason, /^hero_autoline_degraded:/);
});

// ---------------------------------------------------------------------------
// The processRowPhase wiring (the normal campaign path).
// ---------------------------------------------------------------------------

test("the gate_passed phase enqueues the hero job and still writes, queues, and sends", async () => {
  const order = [];
  const ensuredRows = [];
  const phase = await runner.processRowPhase(gatePassedRow(), {
    batchId: BATCH_ID,
    lane: "sandbox",
  }, {
    env: {},
    now: () => NOW,
    ensureHeroAutoline: async (row) => {
      ensuredRows.push(row.prospectId);
      return {
        ok: true,
        ensured: true,
        rowPatch: { heroPostSendAutoline: { at: NOW, jobId: "hrj_phase", status: "queued", reason: "" } },
      };
    },
    writePreviewUrl: async () => { order.push("write"); return { ok: true }; },
    queueEmail: async () => { order.push("email"); return { ok: true }; },
    sendOnFinish: async () => { order.push("send"); return { ok: true }; },
  });
  assert.equal(phase.ok, true, JSON.stringify(phase));
  assert.deepEqual(order, ["write", "email", "send"], "the send chain is exactly the pre-fix sequence");
  assert.deepEqual(ensuredRows, ["autoline-1"], "the ensure ran once, inside the gate_passed phase");
  assert.equal(phase.row.status, "sent");
  assert.equal(phase.row.heroPostSendAutoline.jobId, "hrj_phase",
    "the post-send upgrade marker rides the durable row");
  assert.equal(phase.row.heroRemaster.reason, "photo_bank_stale_or_missing",
    "the boundary marker is untouched — the already-deployed fallback rung stays verified");
});

test("a ensure that throws never blocks the send", async () => {
  const order = [];
  const phase = await runner.processRowPhase(gatePassedRow(), {
    batchId: BATCH_ID,
    lane: "sandbox",
  }, {
    env: {},
    now: () => NOW,
    ensureHeroAutoline: async () => { throw new Error("autoline lane exploded"); },
    writePreviewUrl: async () => { order.push("write"); return { ok: true }; },
    queueEmail: async () => { order.push("email"); return { ok: true }; },
    sendOnFinish: async () => { order.push("send"); return { ok: true }; },
  });
  assert.equal(phase.ok, true, JSON.stringify(phase));
  assert.deepEqual(order, ["write", "email", "send"]);
  assert.equal(phase.row.status, "sent");
  assert.equal(phase.row.heroPostSendAutoline.reason, "hero_autoline_degraded:ensure_failed");
});

test("the default adapter binding degrades (not blocks) when the store is unavailable", async () => {
  const order = [];
  const phase = await runner.processRowPhase(gatePassedRow(), {
    batchId: BATCH_ID,
    lane: "sandbox",
  }, {
    env: {}, // autoline ON; no ensureHeroAutoline injected — the real default runs
    now: () => NOW,
    writePreviewUrl: async () => { order.push("write"); return { ok: true }; },
    queueEmail: async () => { order.push("email"); return { ok: true }; },
    sendOnFinish: async () => { order.push("send"); return { ok: true }; },
  });
  assert.equal(phase.ok, true, JSON.stringify(phase));
  assert.deepEqual(order, ["write", "email", "send"]);
  assert.equal(phase.row.status, "sent");
  assert.match(
    String(phase.row.heroPostSendAutoline?.reason || ""),
    /^hero_autoline_degraded:/,
    "an unconfigured store names the degrade and the send proceeds",
  );
});

// ---------------------------------------------------------------------------
// The drain_emails force path (it reuses processRowPhase; the enqueue must
// ride along through the same buildDeps default).
// ---------------------------------------------------------------------------

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
    headers: { "x-admin-token": "autoline-test-token" },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

function fakeRowStore(initialBatch) {
  let current = structuredClone(initialBatch);
  let leaseCounter = 0;
  const findRow = (rowId) => (current.rows || []).find((row) => row.rowId === rowId);
  return {
    batch: () => current,
    persistence: {
      async loadBatch(id) {
        assert.equal(id, current.batchId);
        return { ok: true, batch: structuredClone(current) };
      },
      async claimRows({ rowId, expectedVersion, workerId, statuses }) {
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
      async releaseRow({ rowId, leaseToken }) {
        const existing = findRow(rowId);
        if (!existing || existing.leaseToken !== leaseToken) return { ok: false, error: "row_release_conflict" };
        existing.leaseToken = null;
        existing.leaseOwner = null;
        return { ok: true, updated: true };
      },
    },
  };
}

function senderSpy() {
  const calls = [];
  const send = async (row, options = {}) => {
    calls.push({ row, options });
    return { ok: true };
  };
  return { calls, factory: () => send };
}

function drainBatch() {
  return {
    batchId: BATCH_ID,
    lane: "sandbox",
    target: "autoline fixture",
    requested: 1,
    status: "building",
    pickState: "complete",
    version: 2,
    haltReason: "",
    startedAt: NOW,
    settledAt: null,
    approval: null,
    rows: [gatePassedRow()],
  };
}

test("drain_emails enqueues the hero job for a fallback-boundary row and still sends it", async () => {
  const store = fakeRowStore(drainBatch());
  const sender = senderSpy();
  const ensured = [];
  const handler = createLineHandler({
    readiness: async () => ({
      ready: true,
      blockers: [],
      deliveryPause: { active: false, known: true, reason: "" },
      reviewHold: { active: false },
      liveSendsEnabled: false,
      ownerAddressConfigured: true,
    }),
    persistence: store.persistence,
    createLineSender: sender.factory,
    drainDeps: {
      env: {},
      writePreviewUrl: async () => ({ ok: true }),
      queueEmail: async () => ({ ok: true }),
      ensureHeroAutoline: async (row) => {
        ensured.push(row.prospectId);
        return {
          ok: true,
          ensured: true,
          rowPatch: { heroPostSendAutoline: { at: NOW, jobId: "hrj_drain", status: "queued", reason: "" } },
        };
      },
    },
    enqueueLineMessage: async () => ({ accepted: true }),
    drainClaimRetryDelayMs: 1,
  });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "drain_emails", batchId: BATCH_ID }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.deepEqual(ensured, ["autoline-1"],
    "the drain's processRowPhase resume block asked the hero question before queueing the email");
  assert.equal(sender.calls.length, 1, "the send fired");
  const finalRow = store.batch().rows[0];
  assert.equal(finalRow.status, "sent");
  assert.equal(finalRow.heroPostSendAutoline.jobId, "hrj_drain",
    "the enqueued job id persists on the drained row");
});

test("drain_emails without an ensure override gets the real adapter and still never blocks", async () => {
  const store = fakeRowStore(drainBatch());
  const sender = senderSpy();
  const handler = createLineHandler({
    readiness: async () => ({
      ready: true,
      blockers: [],
      deliveryPause: { active: false, known: true, reason: "" },
      reviewHold: { active: false },
      liveSendsEnabled: false,
      ownerAddressConfigured: true,
    }),
    persistence: store.persistence,
    createLineSender: sender.factory,
    // No ensureHeroAutoline override: buildDeps' default (the real adapter)
    // runs against the unconfigured store and must degrade, never block.
    drainDeps: {
      env: {},
      writePreviewUrl: async () => ({ ok: true }),
      queueEmail: async () => ({ ok: true }),
    },
    enqueueLineMessage: async () => ({ accepted: true }),
    drainClaimRetryDelayMs: 1,
  });

  const res = response();
  await handler(request("POST", "/api/admin/line", { action: "drain_emails", batchId: BATCH_ID }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.sent, 1, JSON.stringify(res.body));
  assert.equal(sender.calls.length, 1);
  const finalRow = store.batch().rows[0];
  assert.equal(finalRow.status, "sent");
  assert.match(
    String(finalRow.heroPostSendAutoline?.reason || ""),
    /^hero_autoline_degraded:/,
    "the real default adapter recorded a named degrade on the store outage",
  );
});
