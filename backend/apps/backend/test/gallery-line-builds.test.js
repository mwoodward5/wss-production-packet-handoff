"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { safeLineGalleryRow, mergeBuildRows } = require("../api/admin/gallery-data");
const { signEvidence } = require("../lib/mirror-engine/evidence-signature");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/mirror-engine-contract");

const sign = ({ previewUrl }) => `/api/admin/preview-shot?url=${encodeURIComponent(previewUrl)}`;

function releasedPayload({ prospectId, previewUrl, fill = "a" }) {
  const buildHash = fill.repeat(64);
  const proofIdentity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: `${fill.repeat(8)}-${fill.repeat(4)}-4${fill.repeat(3)}-8${fill.repeat(3)}-${fill.repeat(12)}`,
    build_hash: buildHash,
  };
  const releaseEvidence = {
    ok: true,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: buildHash,
    preview_url: previewUrl,
    proofIdentity,
    sharedReleaseEvidence: {
      evidence_schema: "shared-site-release-evidence-v1",
      state: "active",
      ...proofIdentity,
      canonical_host: new URL(previewUrl).hostname,
    },
    checks: { render: { status: "passed" }, route_render: { status: "passed" } },
    revealable: true,
  };
  releaseEvidence.evidence_sha = signEvidence(releaseEvidence);
  return {
    prospectId,
    businessName: "Ready Site",
    previewUrl,
    buildHash,
    proofIdentity,
    releaseEvidence,
    buildEvidence: {
      ready: true,
      pending: false,
      renderer: MIRROR_ENGINE_RENDERER,
      qc_contract: MIRROR_ENGINE_QC_CONTRACT,
      evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
      evidence_sha: releaseEvidence.evidence_sha,
      build_hash: buildHash,
      qc_passed: true,
      visual_qc_passed: true,
      release_evidence: releaseEvidence,
    },
  };
}

test("a Line-only deployed mirror appears in Gallery before prospect preview write", () => {
  const row = safeLineGalleryRow({
    row_id: "line_1:40",
    batch_id: "line_1",
    status: "mirrored",
    updated_at: "2026-08-19T01:00:00Z",
    payload: {
      prospectId: "p40",
      businessName: "Example Tattoo",
      city: "Houston",
      state: "TX",
      vertical: "tattoo",
      previewUrl: "https://example-tattoo.wss-ai.com/",
    },
  }, sign, new Map());
  assert.ok(row);
  assert.equal(row.previewUrl, "https://example-tattoo.wss-ai.com/");
  assert.equal(row.lineOnly, true);
  assert.equal(row.sendable, false, "built-before-inspection is visible but cannot be emailed");
});

test("failed inspection remains visible and non-sendable", () => {
  const row = safeLineGalleryRow({
    row_id: "line_1:41",
    batch_id: "line_1",
    status: "gate_failed",
    payload: {
      prospectId: "p41",
      businessName: "Needs Attention",
      previewUrl: "https://needs-attention.wss-ai.com/",
      gate: { pass: false },
    },
  }, sign, new Map());
  assert.ok(row);
  assert.equal(row.sendable, false);
  assert.equal(row.status, "gate_failed");
});

test("ready/queued Line mirrors may expose owner-proof action", () => {
  for (const [index, status] of ["ready", "queued", "sent"].entries()) {
    const previewUrl = `https://ready-${status}.wss-ai.com/`;
    const row = safeLineGalleryRow({
      row_id: `line_1:${status}`,
      batch_id: "line_1",
      status,
      payload: releasedPayload({ prospectId: `p-${status}`, previewUrl, fill: ["a", "b", "c"][index] }),
    }, sign, new Map());
    assert.equal(row.sendable, true, status);
  }
});

test("durable Line release owns duplicate state and sendability while prospect fills display gaps", () => {
  const line = {
    prospectId: "p1", previewUrl: "https://p1.wss-ai.com/", businessName: "P1",
    status: "queued", updatedAt: "2026-08-19T00:00:00Z", sendable: true,
    campaign: "line-batch", buildHash: "d".repeat(64), lineOnly: true,
  };
  const prospect = {
    prospectId: "p1", previewUrl: "https://p1.wss-ai.com/", businessName: "Fresh Display Name",
    city: "Tulsa", status: "archived", updatedAt: "2026-08-19T00:01:00Z", sendable: false,
  };
  const merged = mergeBuildRows([prospect], [line]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "queued");
  assert.equal(merged[0].sendable, true);
  assert.equal(merged[0].campaign, "line-batch");
  assert.equal(merged[0].buildHash, "d".repeat(64));
  assert.equal(merged[0].updatedAt, "2026-08-19T00:00:00Z");
  assert.equal(merged[0].businessName, "P1");
  assert.equal(merged[0].city, "Tulsa", "missing Line display text may come from the prospect row");
  assert.equal(merged[0].lineOnly, false);
});

test("a ready-looking Line row without signed release evidence stays non-sendable", () => {
  const row = safeLineGalleryRow({
    row_id: "line_1:unsigned",
    batch_id: "line_1",
    status: "ready",
    payload: {
      prospectId: "p-unsigned",
      businessName: "Unsigned Site",
      previewUrl: "https://unsigned.wss-ai.com/",
      buildHash: "e".repeat(64),
    },
  }, sign, new Map());
  assert.equal(row.sendable, false);
  assert.equal(row.buildHash, "");
});

test("the batch's durable state rides the Line row so the card can say why nothing emails", () => {
  const { batchStateIndex } = require("../api/admin/gallery-data");
  const batches = batchStateIndex([
    { batch_id: "line_halted", status: "halted", halt_reason: "owner_cleared_stuck_batch" },
    { batch_id: "line_superseded", status: "halted", halt_reason: "superseded_by_newer_practice_run:line_newer" },
    { batch_id: "", status: "halted" },
    { batch_id: "line_halted", status: "halted", halt_reason: "duplicate-first-wins" },
  ]);
  assert.equal(batches.size, 2, "empty ids and duplicate batch rows add nothing");

  const halted = safeLineGalleryRow({
    row_id: "line_halted:1",
    batch_id: "line_halted",
    status: "gate_passed",
    payload: {
      prospectId: "p-halted",
      businessName: "Stuck At The Send Gate",
      previewUrl: "https://stuck.wss-ai.com/",
    },
  }, sign, new Map(), batches);
  // Tonight's known pain, on the record: the site is built and cannot email
  // because its batch is parked, and both facts travel with the row.
  assert.equal(halted.batchState, "halted");
  assert.equal(halted.batchHaltReason, "owner_cleared_stuck_batch");
  assert.equal(halted.sendable, false);

  const superseded = safeLineGalleryRow({
    row_id: "line_superseded:1",
    batch_id: "line_superseded",
    status: "gate_passed",
    payload: {
      prospectId: "p-superseded",
      businessName: "Replaced Run",
      previewUrl: "https://replaced.wss-ai.com/",
    },
  }, sign, new Map(), batches);
  assert.equal(superseded.batchHaltReason, "superseded_by_newer_practice_run:line_newer");

  // A batch the index never heard of is silence, never a guess.
  const unknown = safeLineGalleryRow({
    row_id: "line_ghost:1",
    batch_id: "line_ghost",
    status: "gate_passed",
    payload: { prospectId: "p-ghost", previewUrl: "https://ghost.wss-ai.com/" },
  }, sign, new Map(), batches);
  assert.equal(unknown.batchState, "");
  assert.equal(unknown.batchHaltReason, "");

  // The durable Line row stays the authority for batch state when a prospect
  // row joins it for display.
  const merged = mergeBuildRows(
    [{ prospectId: "p-halted", previewUrl: "https://stuck.wss-ai.com/", businessName: "Display Name", status: "built", updatedAt: "2026-09-01T00:00:00Z", sendable: false }],
    [halted],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].batchState, "halted");
  assert.equal(merged[0].batchHaltReason, "owner_cleared_stuck_batch");
});
