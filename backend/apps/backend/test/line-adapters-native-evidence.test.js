"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { mirrorProspect, writePreviewUrl, rowToLineRow } = require("../lib/line-adapters");
const { processRowPhase } = require("../lib/line-runner");
const lineState = require("../lib/line-state");
const { outreachBuildQuality } = require("../lib/email");
const { sanitizeRowPayload } = require("../lib/line-persistence");
const { signEvidence } = require("../lib/mirror-engine/engine");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/siteforge");

const PREVIEW = "https://native-evidence.wss-ai.com/";
const VERSION = "2026-08-14T12:00:00.000Z";

function manifest(buildHash = "build-native-1") {
  const value = {
    ok: true,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: buildHash,
    preview_url: PREVIEW,
    checks: { render: { status: "passed" }, route_render: { status: "passed" } },
    revealable: true,
  };
  value.evidence_sha = signEvidence(value);
  return value;
}

function prospectRow() {
  return {
    prospect_id: "native-proof-1",
    business_name: "Native Proof Plumbing",
    email: "recipient@example.test",
    status: "held",
    updated_at: VERSION,
    preview_url: null,
    record: {
      build_ready: {
        proof: { build_hash: "source-contract-1" },
        qualification: {
          website_axis: { score: 20 },
          composite_signal: { score: 25 },
        },
        brand_evidence: {},
        mirror_request: {
          facts: {
            business_name: "Native Proof Plumbing",
            industry: "plumbing",
            city: "Tulsa",
            state: "OK",
            current_website: "https://native-proof.example/",
          },
        },
      },
      build_dispatch: {
        mode: "existing_job_status_read",
        renderer: "05-build-v8",
        qc_contract: "public-surface-v2",
        job_id: "legacy-siteforge-job",
      },
    },
  };
}

function dispatchFor(releaseEvidence) {
  return {
    mode: "mirror_lane",
    pending: false,
    urls: { preview_url: PREVIEW },
    build_hash: releaseEvidence.build_hash,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: releaseEvidence.evidence_sha,
    release_evidence: releaseEvidence,
    content_source: "verified_contract",
    buildStatus: {
      ready: true,
      pending: false,
      renderer: MIRROR_ENGINE_RENDERER,
      qc_contract: MIRROR_ENGINE_QC_CONTRACT,
      evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
      evidence_sha: releaseEvidence.evidence_sha,
      qc_passed: true,
      visual_qc_passed: true,
      generation_fingerprint: `mirror-engine:${releaseEvidence.build_hash}`,
      release_evidence: releaseEvidence,
    },
  };
}

test("Mirror native proof survives mirror -> CAS write and passes the outreach gate", async () => {
  let stored = prospectRow();
  const oldDispatch = structuredClone(stored.record.build_dispatch);
  const releaseEvidence = manifest();
  const signal = new AbortController().signal;
  const deadlineAt = Date.now() + 30_000;
  const select = async (_table, _query, request = {}) => {
    assert.equal(request.signal, signal);
    assert.equal(request.deadlineAt, deadlineAt);
    return { ok: true, data: [structuredClone(stored)] };
  };
  let dispatchOptions = null;
  const built = await mirrorProspect(rowToLineRow(stored), {
    lane: "sandbox",
    signal,
    deadlineAt,
    operationKey: "line:native-proof-1:mirror",
    select,
    fullRun: {},
    mirrorLaneEnabled: () => true,
    dispatchMirrorLane: async (_prospect, options) => {
      dispatchOptions = options;
      return dispatchFor(releaseEvidence);
    },
  });

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.contentSource, "verified_contract");
  assert.equal(built.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(built.qcContract, MIRROR_ENGINE_QC_CONTRACT);
  assert.equal(built.evidenceSchema, MIRROR_ENGINE_EVIDENCE_SCHEMA);
  assert.equal(built.evidenceSha, releaseEvidence.evidence_sha);
  assert.deepEqual(built.releaseEvidence, releaseEvidence);
  assert.deepEqual(built.buildEvidence.release_evidence, releaseEvidence);
  assert.equal(dispatchOptions.signal, signal);
  assert.equal(dispatchOptions.deadlineAt, deadlineAt);

  const update = async (_table, _column, _id, guards, patch, request = {}) => {
    assert.deepEqual(guards, { updated_at: `eq.${VERSION}` });
    assert.equal(request.signal, signal);
    assert.equal(request.deadlineAt, deadlineAt);
    stored = { ...stored, ...structuredClone(patch) };
    return { ok: true, updated: true, rows: [structuredClone(stored)] };
  };
  const proofShots = {
    build_hash: releaseEvidence.build_hash,
    old_captured_url: "https://native-proof.example/",
    old_shot_sha: "1".repeat(64),
    new_captured_url: PREVIEW,
    new_shot_sha: "2".repeat(64),
  };
  const written = await writePreviewUrl({
    ...rowToLineRow(stored),
    ...built,
    status: "gate_passed",
    operationKey: "line:native-proof-1:mirror",
    proof_shots: proofShots,
  }, PREVIEW, { select, conditionalUpdate: update, signal, deadlineAt });

  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(stored.record.build_dispatch.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(stored.record.build_dispatch.qc_contract, MIRROR_ENGINE_QC_CONTRACT);
  assert.equal(stored.record.build_dispatch.qc_passed, true);
  assert.equal(stored.record.build_dispatch.visual_qc_passed, true);
  assert.equal(stored.record.build_dispatch.ready, true);
  assert.deepEqual(stored.record.build_dispatch.release_evidence, releaseEvidence);
  assert.deepEqual(stored.record.mirror_release_evidence, releaseEvidence);
  assert.deepEqual(stored.record.legacy_build_dispatch, oldDispatch);
  assert.deepEqual(stored.record.proof_shots, proofShots, "the passing build CAS must persist its shots before queueEmail runs");
  assert.equal(JSON.stringify(stored.record).includes("recipient@example.test"), false, "the evidence write must not copy a raw recipient into record JSON");
  assert.equal(Object.keys(stored.record.build_dispatch).some((key) => /^siteforge/i.test(key)), false);

  const quality = outreachBuildQuality(stored);
  assert.equal(quality.ok, true, JSON.stringify(quality));
  assert.equal(quality.releaseEvidencePassed, true, JSON.stringify(quality));
});

test("a hero rebuild carries the exact durable reel into the mirror request", async () => {
  const stored = prospectRow();
  const reel = {
    url: "https://assets.wss-ai.com/native-proof/hero-reels/approved/"
      + `${"a".repeat(64)}.mp4`,
    generator: "ads_animate_image",
    source_sha256: "b".repeat(64),
  };
  stored.record.media_bank = { hero_reel: reel };
  let dispatched = null;
  const releaseEvidence = manifest("hero-rebuild-native-1");
  const built = await mirrorProspect(rowToLineRow(stored), {
    lane: "live",
    heroRebuild: true,
    select: async () => ({ ok: true, data: [structuredClone(stored)] }),
    fullRun: {},
    mirrorLaneEnabled: () => true,
    dispatchMirrorLane: async (prospect) => {
      dispatched = prospect;
      return dispatchFor(releaseEvidence);
    },
  });

  assert.equal(built.ok, true, JSON.stringify(built));
  assert.deepEqual(dispatched.record.media_bank.hero_reel, reel);
  assert.deepEqual(dispatched.record, stored.record,
    "the rebuild must dispatch the exact durable record it just validated");
});

test("PII-scrubbed signed evidence rebinds every carrier and survives native preview write", async () => {
  const sourceEvidence = manifest("build-native-pii-scrub");
  sourceEvidence.checks.editable = {
    status: "archived",
    pruned: { removed: ["9185550134.html"] },
  };
  sourceEvidence.evidence_sha = signEvidence(sourceEvidence);
  const sourceSha = sourceEvidence.evidence_sha;
  const buildEvidence = {
    ...dispatchFor(sourceEvidence).buildStatus,
    build_hash: sourceEvidence.build_hash,
  };
  const durable = sanitizeRowPayload({
    ...rowToLineRow(prospectRow()),
    status: "gate_passed",
    durableUpdatedAt: VERSION,
    previewUrl: PREVIEW,
    buildHash: sourceEvidence.build_hash,
    releaseEvidence: sourceEvidence,
    buildEvidence,
  });

  assert.equal(JSON.stringify(durable).includes("9185550134"), false);
  assert.deepEqual(
    durable.releaseEvidence.checks.editable.pruned.removed,
    ["[redacted-phone].html"],
  );
  assert.notEqual(durable.releaseEvidence.evidence_sha, sourceSha);
  assert.equal(signEvidence(durable.releaseEvidence), durable.releaseEvidence.evidence_sha);
  assert.equal(durable.buildEvidence.evidence_sha, durable.releaseEvidence.evidence_sha);
  assert.equal(
    durable.buildEvidence.release_evidence.evidence_sha,
    durable.releaseEvidence.evidence_sha,
  );
  assert.equal(durable.releaseEvidenceTransform.source_evidence_sha, sourceSha);
  assert.equal(
    durable.releaseEvidenceTransform.persisted_evidence_sha,
    durable.releaseEvidence.evidence_sha,
  );

  let stored = prospectRow();
  const select = async () => ({ ok: true, data: [structuredClone(stored)] });
  const update = async (_table, _column, _id, _guards, patch) => {
    stored = { ...stored, ...structuredClone(patch) };
    return { ok: true, updated: true, rows: [structuredClone(stored)] };
  };
  const written = await writePreviewUrl(durable, PREVIEW, {
    select,
    conditionalUpdate: update,
  });

  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(
    stored.record.build_dispatch.evidence_sha,
    durable.releaseEvidence.evidence_sha,
  );
  assert.equal(
    signEvidence(stored.record.build_dispatch.release_evidence),
    stored.record.build_dispatch.evidence_sha,
  );
});

test("a lost write response reconciles only the exact signed Mirror evidence, never URL alone", async () => {
  const expectedRelease = manifest("build-expected");
  const mapped = rowToLineRow(prospectRow());
  const row = {
    ...mapped,
    previewUrl: PREVIEW,
    operationKey: "line:native-proof-1:mirror",
    contentSource: "verified_contract",
    releaseEvidence: expectedRelease,
    buildEvidence: dispatchFor(expectedRelease).buildStatus,
  };
  row.buildEvidence.release_evidence = expectedRelease;
  row.buildEvidence.content_source = "verified_contract";
  row.buildEvidence.build_hash = expectedRelease.build_hash;

  let stored = prospectRow();
  let reads = 0;
  const select = async () => {
    reads += 1;
    return { ok: true, data: [structuredClone(stored)] };
  };
  const lostResponse = async (_table, _column, _id, _guards, patch) => {
    stored = { ...stored, ...structuredClone(patch) };
    return { ok: false, updated: false, error: "network_timeout_after_commit" };
  };
  const reconciled = await writePreviewUrl(row, PREVIEW, { select, conditionalUpdate: lostResponse });
  assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
  assert.equal(reconciled.reconciled, true);
  assert.equal(reads, 2);

  const wrongRelease = manifest("build-different");
  stored.record.build_dispatch.release_evidence = wrongRelease;
  stored.record.build_dispatch.evidence_sha = wrongRelease.evidence_sha;
  stored.record.build_dispatch.build_hash = wrongRelease.build_hash;
  stored.record.build_dispatch.generation_fingerprint = `mirror-engine:${wrongRelease.build_hash}`;
  stored.record.mirror_release_evidence = wrongRelease;
  stored.updated_at = "2026-08-14T12:01:00.000Z";
  let updateCalls = 0;
  const conflict = await writePreviewUrl(row, PREVIEW, {
    select: async () => ({ ok: true, data: [structuredClone(stored)] }),
    conditionalUpdate: async () => { updateCalls += 1; return { ok: true, updated: true }; },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, "preview_url_write_conflict");
  assert.equal(updateCalls, 0, "a same-URL row with different proof must not be accepted or overwritten");
});

test("a canonical sport-fencing hold cannot be promoted even when its durable version matches", async () => {
  const canonical = {
    ...prospectRow(),
    status: "held",
    updated_at: VERSION,
    record: {
      ...prospectRow().record,
      status: "held",
      blocked_reason: "vertical_mismatch_sport_fencing",
      vertical_hold: { reason: "vertical_mismatch_sport_fencing", at: VERSION },
    },
  };
  let writes = 0;
  const result = await writePreviewUrl({
    prospectId: canonical.prospect_id,
    durableUpdatedAt: VERSION,
    status: "gate_passed",
  }, PREVIEW, {
    select: async () => ({ ok: true, data: [structuredClone(canonical)] }),
    conditionalUpdate: async () => { writes += 1; return { ok: true, updated: true }; },
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "vertical_mismatch_sport_fencing",
    code: "line_preview_write_policy_hold",
    retryable: false,
    policyHold: true,
    terminal: "rejected",
  });
  assert.equal(writes, 0, "the held canonical row is never promoted to line_gate_passed");
});

test("an ordinary outreach-held build-ready row still promotes", async () => {
  const canonical = {
    ...prospectRow(),
    status: "held",
    updated_at: VERSION,
    record: {
      ...prospectRow().record,
      status: "held",
      blocked_reason: "no_verified_business_email",
    },
  };
  let patch = null;
  const result = await writePreviewUrl({
    prospectId: canonical.prospect_id,
    durableUpdatedAt: VERSION,
    status: "gate_passed",
  }, PREVIEW, {
    select: async () => ({ ok: true, data: [structuredClone(canonical)] }),
    conditionalUpdate: async (_table, _column, _id, guards, next) => {
      assert.deepEqual(guards, { updated_at: `eq.${VERSION}` });
      patch = next;
      return { ok: true, updated: true, rows: [{ ...canonical, ...next }] };
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(patch.status, "line_gate_passed");
  assert.equal(patch.preview_url, PREVIEW);
});

test("invalid and identity-mismatched signed Mirror evidence are terminal write refusals", async (t) => {
  for (const example of [
    {
      name: "invalid signature",
      reason: "mirror_engine_release_evidence_invalid",
      prepare() {
        const releaseEvidence = manifest("invalid-signature");
        releaseEvidence.build_hash = "tampered-after-signing";
        return { releaseEvidence, buildEvidence: dispatchFor(releaseEvidence).buildStatus };
      },
    },
    {
      name: "identity mismatch",
      reason: "mirror_engine_evidence_identity_mismatch",
      prepare() {
        const releaseEvidence = manifest("identity-mismatch");
        const buildEvidence = dispatchFor(releaseEvidence).buildStatus;
        buildEvidence.evidence_sha = "f".repeat(64);
        return { releaseEvidence, buildEvidence };
      },
    },
  ]) {
    await t.test(example.name, async () => {
      const { releaseEvidence, buildEvidence } = example.prepare();
      let writes = 0;
      const result = await writePreviewUrl({
        ...rowToLineRow(prospectRow()),
        status: "gate_passed",
        buildEvidence,
        releaseEvidence,
      }, PREVIEW, {
        select: async () => ({ ok: true, data: [prospectRow()] }),
        conditionalUpdate: async () => { writes += 1; return { ok: true, updated: true }; },
      });

      assert.deepEqual(result, {
        ok: false,
        reason: example.reason,
        code: "line_preview_write_evidence_refused",
        retryable: false,
        terminal: "rejected",
      });
      assert.equal(writes, 0);
    });
  }
});

test("tampered native evidence stops mirror promotion before queue or provider work", async () => {
  const stored = prospectRow();
  const releaseEvidence = manifest("tampered-native-flow");
  releaseEvidence.checks.render.status = "failed-after-signing";

  const built = await mirrorProspect(rowToLineRow(stored), {
    lane: "live",
    operationKey: "line:native-proof-1:mirror",
    select: async () => ({ ok: true, data: [structuredClone(stored)] }),
    fullRun: {},
    mirrorLaneEnabled: () => true,
    dispatchMirrorLane: async () => dispatchFor(releaseEvidence),
  });

  assert.equal(built.ok, true, "the deployed preview is not mislabeled as a before-build failure");
  assert.equal(built.releaseEvidence, null, "invalid signed evidence is never carried forward as proof");
  assert.equal(built.buildEvidence?.unverified_evidence, true,
    "the native evidence refusal must survive the mirror-to-write handoff");
  assert.equal(Object.prototype.hasOwnProperty.call(built.buildEvidence, "release_evidence"), false,
    "the marker must not retain the invalid manifest");

  let previewWrites = 0;
  let queueCalls = 0;
  let providerCalls = 0;
  const projected = rowToLineRow(stored);
  const outcome = await processRowPhase({
    ...lineState.newRow({ ...projected, now: VERSION }),
    ...projected,
    ...built,
    status: "gate_passed",
    gate: { pass: true, failed: [], checks: [] },
    previewUrl: PREVIEW,
    durableUpdatedAt: VERSION,
  }, {
    lane: "live",
    batchId: "line_native_evidence_fail_closed",
  }, {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "false" },
    writePreviewUrl: (row, url, options) => writePreviewUrl(row, url, {
      ...options,
      select: async () => ({ ok: true, data: [structuredClone(stored)] }),
      conditionalUpdate: async () => {
        previewWrites += 1;
        return { ok: true, updated: true };
      },
    }),
    queueEmail: async () => {
      queueCalls += 1;
      providerCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.row.status, "rejected");
  assert.equal(outcome.phase, "preview_write");
  assert.equal(outcome.row.reason, "mirror_engine_release_evidence_invalid");
  assert.equal(previewWrites, 0, "invalid native evidence cannot promote the canonical preview");
  assert.equal(queueCalls, 0, "invalid native evidence cannot enter the delivery queue");
  assert.equal(providerCalls, 0, "no provider call is reachable after the native evidence refusal");
});
