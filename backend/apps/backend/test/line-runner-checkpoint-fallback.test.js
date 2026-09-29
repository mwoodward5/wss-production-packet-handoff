"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const lineState = require("../lib/line-state");
const adapters = require("../lib/line-adapters");
const { processRowPhase } = require("../lib/line-runner");
const { signEvidence } = require("../lib/mirror-engine/engine");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/siteforge");

const NOW = "2026-08-28T14:00:00.000Z";
const BATCH_ID = "line_checkpoint";
const ROW_ID = `${BATCH_ID}:0`;
const PROSPECT_ID = "checkpoint-hero-1";
const PREVIEW = "https://checkpoint-hero.wss-ai.com/";
const SOURCE = "https://checkpoint-hero.example.com/";
const BUILD_HASH = "e".repeat(64);
const PHOTO_SHA = "a".repeat(64);

function fixture() {
  const rawBank = {
    version: 1,
    fresh: true,
    harvested_at: NOW,
    website: SOURCE,
    photos: [{
      url: `${SOURCE}crew.jpg`,
      source: "own_site",
      found_on: SOURCE,
      sha256: PHOTO_SHA,
      width: 1600,
      height: 900,
      bytes: 240000,
      grade: "hero",
      rank: 0,
      current_hero: true,
    }],
  };
  const ownedPhotoBank = adapters.completedLineHeroBank(
    { currentWebsite: SOURCE, ownedPhotoBank: rawBank },
    { current_website: SOURCE, record: { current_website: SOURCE } },
    new Date(NOW),
  );
  assert.ok(ownedPhotoBank);

  const releaseEvidence = {
    ok: true,
    dry_run: false,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: BUILD_HASH,
    preview_url: PREVIEW,
    revealable: true,
    checks: {
      brand: {
        media_mode: "origin",
        photos: { supplied: 1, usable: 1, placed: 1, unplaced: 0 },
        hero_video: { supplied: false, usable: false, placed: 0 },
        hero_wash: {
          applied: true,
          reason: null,
          worst_case_contrast: 5.1,
          ink_floor_contrast: 4.7,
          photo_source: "client_current_hero",
          photo_sha: PHOTO_SHA,
          photo_url: `${SOURCE}crew.jpg`,
          selector: "main > section:first-child",
          pages_verified: ["/"],
        },
      },
    },
  };
  releaseEvidence.evidence_sha = signEvidence(releaseEvidence);
  const buildEvidence = {
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: releaseEvidence.evidence_sha,
    ready: true,
    pending: false,
    qc_passed: true,
    visual_qc_passed: true,
    generation_fingerprint: `mirror-engine:${BUILD_HASH}`,
    build_hash: BUILD_HASH,
    content_source: "verified_mined_contract",
    release_evidence: releaseEvidence,
  };

  let row = lineState.newRow({
    prospectId: PROSPECT_ID,
    businessName: "Checkpoint Heating",
    city: "Colorado Springs",
    state: "CO",
    vertical: "hvac",
    email: "owner@example.test",
    now: NOW,
  });
  row = lineState.advanceRow(row, "qualified", { now: NOW }).row;
  row = { ...row, rowId: ROW_ID, batchId: BATCH_ID, currentWebsite: SOURCE };

  const marker = {
    required: false,
    ready: true,
    pending: false,
    hold: false,
    fallback: true,
    applied: false,
    status: "skipped",
    reason: "sandbox_foreign_submit_rejected_static_hero_verified",
    job_id: "hrj_checkpoint",
    build_hash: BUILD_HASH,
    hero_attempt_id: "hero_attempt:1",
    producer: "openrouter_seedance",
    static_hero_verified: true,
    static_hero_source: "client_current_hero",
    static_hero_photo_sha256: PHOTO_SHA,
    static_hero_photo_url: `${SOURCE}crew.jpg`,
    static_hero_bank_fingerprint: ownedPhotoBank.fingerprint,
    base_evidence_sha: releaseEvidence.evidence_sha,
    line_batch_id: BATCH_ID,
    line_row_id: ROW_ID,
    video_failure_reason: "openrouter_submit_failed",
    video_terminal_reason: "openrouter_submit_failed",
    video_attempts: 1,
    video_attempt_cap: 3,
    foreign_job_consumption_reason: "foreign_submit_rejection_observed_read_only",
    foreign_job_binding_schema: "wss.line.static_hero_foreign_checkpoint_job.v1",
    foreign_job_prospect_id: PROSPECT_ID,
    foreign_job_generation_revision: 1,
    foreign_job_line_batch_id: "line_original",
    foreign_job_line_row_id: "line_original:0",
    foreign_job_build_hash: BUILD_HASH,
    foreign_job_snapshot_sha256: "b".repeat(64),
    foreign_job_checkpoint_sha256: "c".repeat(64),
    foreign_job_status: "failed",
    foreign_job_result_reason: "openrouter_submit_failed",
    foreign_job_updated_at: "2026-08-28T19:59:00.000Z",
    foreign_job_finished_at: "2026-08-28T19:59:00.000Z",
  };
  marker.foreign_job_binding_sha256 = adapters.foreignStaticHeroJobBindingSha(marker);
  const build = {
    ok: true,
    previewUrl: PREVIEW,
    buildHash: BUILD_HASH,
    currentWebsite: SOURCE,
    contentSource: "verified_mined_contract",
    buildEvidence,
    releaseEvidence,
    ownedPhotoBank,
  };
  return { row, marker, build };
}

function dependencies(marker, build, counters) {
  return {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "1", GHOST_AGENCY_HERO_LEASE_MAX_ATTEMPTS: "3" },
    mirror: async () => structuredClone(build),
    prepareHero: async () => ({
      ok: true,
      heroRemaster: structuredClone(marker),
      rowPatch: {
        heroRemaster: adapters.compactHeroRemaster(marker),
        ownedPhotoBank: structuredClone(build.ownedPhotoBank),
      },
    }),
    verifyHeroFallbackReceipt: async () => ({ ok: true, required: true, verified: true }),
    sourceFacts: async () => ({}),
    gate: async () => {
      counters.gates += 1;
      return {
        pass: true,
        failed: [],
        checks: [],
        capture: {
          ok: true,
          shots: {
            build_hash: BUILD_HASH,
            old_captured_url: SOURCE,
            old_shot_sha: "d".repeat(64),
            new_captured_url: PREVIEW,
            new_shot_sha: "f".repeat(64),
          },
          results: [],
        },
      };
    },
    writePreviewUrl: async () => { counters.writes += 1; return { ok: true }; },
    queueEmail: async () => { counters.emails += 1; return { ok: true }; },
    recordEvent: async () => ({ ok: true }),
    now: () => NOW,
  };
}

test("checkpoint rejection static receipt crosses processRowPhase only in exact Practice form", async () => {
  const { row, marker, build } = fixture();
  const counters = { gates: 0, writes: 0, emails: 0 };
  const deps = dependencies(marker, build, counters);

  let phase = await processRowPhase(row, { batchId: BATCH_ID, lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "mirrored");
  assert.equal(phase.row.heroRemaster.reason, marker.reason);
  assert.equal(phase.row.heroRemaster.foreignJobSnapshotSha256, marker.foreign_job_snapshot_sha256);
  assert.equal(phase.row.heroRemaster.foreignJobCheckpointSha256, marker.foreign_job_checkpoint_sha256);
  const binding = adapters.foreignStaticHeroJobBinding(phase.row.heroRemaster);
  assert.equal(binding.valid, true);
  assert.equal(binding.sha256, adapters.foreignStaticHeroJobBindingSha(phase.row.heroRemaster));

  const mirrored = structuredClone(phase.row);
  phase = await processRowPhase(phase.row, { batchId: BATCH_ID, lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "gate_passed", JSON.stringify(phase));
  phase = await processRowPhase(phase.row, { batchId: BATCH_ID, lane: "sandbox" }, deps);
  assert.equal(phase.row.status, "queued", JSON.stringify(phase));
  assert.deepEqual(counters, { gates: 1, writes: 1, emails: 1 });

  for (const [name, mutate] of [
    ["binding hash", (candidate) => { candidate.heroRemaster.foreignJobBindingSha256 = "0".repeat(64); }],
    ["checkpoint snapshot", (candidate) => { candidate.heroRemaster.foreignJobSnapshotSha256 = "0".repeat(64); }],
    ["observation reason", (candidate) => { candidate.heroRemaster.foreignJobConsumptionReason = "foreign_terminal_job_consumed"; }],
  ]) {
    const tampered = structuredClone(mirrored);
    mutate(tampered);
    const refused = await processRowPhase(tampered, { batchId: BATCH_ID, lane: "sandbox" }, deps);
    assert.equal(refused.row.status, "rejected", name);
    assert.equal(refused.row.reason, "hero_media_requires_fresh_mirror", name);
  }

  const live = await processRowPhase(structuredClone(mirrored), { batchId: BATCH_ID, lane: "live" }, deps);
  assert.equal(live.row.status, "rejected");
  assert.equal(live.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(counters.gates, 1, "tampered and live receipts never reach inspection");
});
