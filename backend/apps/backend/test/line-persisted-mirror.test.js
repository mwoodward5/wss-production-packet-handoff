"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recoverPersistedMirrorBuild,
  validatedPersistedDispatch,
} = require("../lib/line-persisted-mirror");
const { mirrorProspectResumable } = require("../lib/line-mirror-resume");
const { signEvidence } = require("../lib/mirror-engine/engine");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/siteforge");

const PREVIEW = "https://wss-test-grass-works-leander.wss-ai.com/";
const UPDATED_AT = "2026-08-18T20:42:53.694+00:00";
const BUILD_HASH = "4cf94825d93b9aba41993520def6e5e3a9174b6ea1042f72deea98560f403aa9";
const HERO_JOB_ID = "hrj_grassworks_hero";
const REBUILD_JOB_ID = "rebuild_grassworks_hero";
const HERO_CLIP_SHA256 = "6".repeat(64);
const BATCH_ID = "line_grassworks_hero";
const ROW_ID = `${BATCH_ID}:2`;
const REEL_URL = `https://blob.wss-ai.com/wss-test-grass-works-leander/hero-reels/approved/${HERO_CLIP_SHA256}.mp4`;

function fixture({
  status = "line_queued",
  jobId = "line_rebuild_grassworks_c209b23:wss-test-grass-works-leander:mirror",
  updatedAt = UPDATED_AT,
} = {}) {
  const releaseEvidence = {
    ok: true,
    dry_run: false,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: BUILD_HASH,
    donor: "landscaping-evergreen",
    donor_content_hash: "7".repeat(64),
    slug: "wss-test-grass-works-leander",
    deploy_id: "dpl_CvvQbGAgHnqFr5wkuMSQeC2mj39U",
    deploy_url: "https://wss-test-grass-works-leander-i2awtyw18-wss-labs.vercel.app",
    preview_url: PREVIEW,
    file_count: 22,
    upload_stats: { uploaded: 22, deduped: 0, reused: 0 },
    checks: {
      hydration_parse: { status: "passed" },
      token_scan: { status: "passed" },
      identity_scan: { status: "passed" },
      brand: { status: "passed" },
      asset_diff: { status: "passed" },
      deep_link: { status: "passed" },
      alias_target: { status: "passed" },
      render: { status: "passed" },
      routes: { status: "passed" },
      route_render: { status: "passed" },
      sameness: { status: "passed" },
    },
    revealable: true,
  };
  releaseEvidence.evidence_sha = signEvidence(releaseEvidence);

  const dispatch = {
    mode: "mirror_engine",
    pending: false,
    ready: true,
    preview_url: PREVIEW,
    urls: { preview_url: PREVIEW },
    renderer: MIRROR_ENGINE_RENDERER,
    required_renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    required_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: releaseEvidence.evidence_sha,
    qc_passed: true,
    visual_qc_passed: true,
    generation_fingerprint: `mirror-engine:${BUILD_HASH}`,
    build_hash: BUILD_HASH,
    content_source: "verified",
    release_evidence: releaseEvidence,
    job_id: jobId,
  };

  return {
    row: {
      prospectId: "wss-test-grass-works-leander",
      durableUpdatedAt: updatedAt,
    },
    persisted: {
      prospect_id: "wss-test-grass-works-leander",
      business_name: "Grass Works",
      status,
      preview_url: PREVIEW,
      current_website: "https://www.grassworksaustin.com/",
      updated_at: updatedAt,
      record: {
        status: "line_gate_passed",
        preview_url: PREVIEW,
        current_website: "https://www.grassworksaustin.com/",
        build_dispatch: dispatch,
        mirror_release_evidence: releaseEvidence,
      },
    },
    dispatch,
    releaseEvidence,
  };
}

function heroFixture() {
  const value = fixture({ status: "held" });
  const photoBank = {
    status: "verified",
    source_from: "own_site",
    photos: [{ url: "https://www.grassworksaustin.com/crew.jpg", sha256: "8".repeat(64) }],
  };
  value.row.rowId = ROW_ID;
  value.row.heroRemaster = {
    required: true,
    pending: true,
    jobId: HERO_JOB_ID,
    rebuildJobId: REBUILD_JOB_ID,
  };
  // The hero rebuild is not allowed to reveal/promote the site. The normal
  // Line gate does that after exact recovery, so these canonical fields remain
  // empty while the signed receipt carries the candidate URL.
  value.persisted.preview_url = "";
  value.persisted.record.preview_url = "";
  value.releaseEvidence.checks.brand.media_mode = "housed";
  value.releaseEvidence.checks.brand.hero_video = { supplied: true, usable: true, placed: 1 };
  value.releaseEvidence.evidence_sha = signEvidence(value.releaseEvidence);
  value.dispatch.evidence_sha = value.releaseEvidence.evidence_sha;
  value.dispatch.job_id = REBUILD_JOB_ID;
  value.persisted.record.media_bank = { hero_reel: { url: REEL_URL } };
  value.persisted.record.photo_bank = photoBank;
  value.persisted.record.line_hero_rebuild = {
    schema: "line_hero_rebuild/v1",
    prospect_id: value.persisted.prospect_id,
    line_handle: { batchId: BATCH_ID, rowId: ROW_ID },
    hero_job_id: HERO_JOB_ID,
    hero_clip_sha256: HERO_CLIP_SHA256,
    rebuild_job_id: REBUILD_JOB_ID,
    reel_url: REEL_URL,
    preview_url: PREVIEW,
    build_hash: BUILD_HASH,
    build_dispatch: value.dispatch,
    release_evidence: value.releaseEvidence,
    photo_bank: photoBank,
    completed_at: "2026-08-21T18:00:00.000Z",
  };
  return { ...value, photoBank };
}

test("sandbox reconnects the exact selected prospect version to its signed finished mirror", async () => {
  const { row, persisted, releaseEvidence } = fixture();
  const result = await recoverPersistedMirrorBuild(row, {
    lane: "sandbox",
    operationKey: "line_msz34crq_40582b7927:wss-test-grass-works-leander:mirror",
    persistedProspect: persisted,
  });

  assert.equal(result.recovered, true);
  assert.equal(result.build.ok, true);
  assert.equal(result.build.recovered, true);
  assert.equal(result.build.previewUrl, PREVIEW);
  assert.equal(result.build.buildHash, BUILD_HASH);
  assert.equal(result.build.currentWebsite, "https://www.grassworksaustin.com/");
  assert.deepEqual(result.build.releaseEvidence, releaseEvidence);
});

test("the production Line returns the recovered artifact before calling the builder", async () => {
  const { row } = fixture();
  let dispatcherCalls = 0;
  const recoveredBuild = {
    ok: true,
    recovered: true,
    previewUrl: PREVIEW,
    buildHash: BUILD_HASH,
  };

  const result = await mirrorProspectResumable(row, {
    lane: "sandbox",
    operationKey: "new-operation",
    recoverPersistedMirrorBuild: async () => ({ recovered: true, build: recoveredBuild }),
    dispatchMirrorLane: async () => {
      dispatcherCalls += 1;
      throw new Error("builder must not run for a recovered artifact");
    },
  });

  assert.equal(dispatcherCalls, 0);
  assert.deepEqual(result, recoveredBuild);
});

test("transient persisted reads park a signed hero build without another Mirror dispatch", async () => {
  const value = fixture();
  const row = {
    ...value.row,
    rowId: "line_transient:0",
    previewUrl: PREVIEW,
    buildHash: BUILD_HASH,
    releaseEvidence: value.releaseEvidence,
    buildEvidence: { release_evidence: value.releaseEvidence },
    heroRemaster: {
      required: true,
      ready: false,
      pending: true,
      jobId: HERO_JOB_ID,
      attemptId: "hero_attempt:3",
      status: "queued",
    },
  };

  for (const [name, recoverPersistedMirrorBuild] of [
    ["classified", async () => ({ recovered: false, reason: "persisted_prospect_unavailable" })],
    ["thrown", async () => { throw new Error("temporary Supabase read outage"); }],
  ]) {
    let dispatches = 0;
    const out = await mirrorProspectResumable(structuredClone(row), {
      lane: "sandbox",
      recoverPersistedMirrorBuild,
      dispatchMirrorLane: async () => {
        dispatches += 1;
        throw new Error("transient recovery must never rebuild Mirror");
      },
    });

    assert.equal(dispatches, 0, name);
    assert.equal(out.ok, true, name);
    assert.equal(out.revealable, false, name);
    assert.equal(out.heroRemasterPending, true, name);
    assert.equal(out.reason, "hero_recheck_read_unavailable", name);
    assert.equal(out.previewUrl, PREVIEW, name);
    assert.equal(out.buildHash, BUILD_HASH, name);
    assert.deepEqual(out.releaseEvidence, value.releaseEvidence, name);
    assert.equal(out.heroRemaster.pending, true, name);
    assert.equal(out.heroRemaster.ready, false, name);
    assert.equal(out.heroRemaster.jobId, HERO_JOB_ID, name);
    assert.equal(out.heroRemaster.attemptId, "hero_attempt:3", name);
  }
});

test("live refuses a mirror already queued by another campaign", async () => {
  const { row, persisted } = fixture();
  const result = await recoverPersistedMirrorBuild(row, {
    lane: "live",
    operationKey: "different-live-campaign-operation",
    persistedProspect: persisted,
  });

  assert.equal(result.recovered, false);
  assert.equal(result.terminal, true);
  assert.equal(result.reason, "prospect_already_queued_by_another_campaign");
});

test("live resumes its own queued operation", async () => {
  const { row, persisted, dispatch } = fixture();
  const result = await recoverPersistedMirrorBuild(row, {
    lane: "live",
    operationKey: dispatch.job_id,
    persistedProspect: persisted,
  });

  assert.equal(result.recovered, true);
  assert.equal(result.build.previewUrl, PREVIEW);
});

test("stale selection cannot reuse a different prospect version", async () => {
  const { row, persisted } = fixture();
  row.durableUpdatedAt = "2026-08-18T20:40:00.000+00:00";
  const result = await recoverPersistedMirrorBuild(row, {
    lane: "sandbox",
    operationKey: "different-operation",
    persistedProspect: persisted,
  });

  assert.equal(result.recovered, false);
  assert.equal(result.reason, "persisted_mirror_not_selected_version");
});

test("tampered release evidence is never recovered", async () => {
  const { row, persisted } = fixture();
  persisted.record.build_dispatch.release_evidence = {
    ...persisted.record.build_dispatch.release_evidence,
    build_hash: "f".repeat(64),
  };
  persisted.record.mirror_release_evidence = persisted.record.build_dispatch.release_evidence;

  assert.equal(validatedPersistedDispatch(persisted), null);
  const result = await recoverPersistedMirrorBuild(row, {
    lane: "sandbox",
    operationKey: "different-operation",
    persistedProspect: persisted,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.reason, "persisted_mirror_evidence_invalid");
});

test("an exact Line hero receipt recovers its signed build and photo bank without another mirror", async () => {
  const { row, persisted, photoBank } = heroFixture();
  const result = await recoverPersistedMirrorBuild(row, {
    lane: "sandbox",
    batchId: BATCH_ID,
    persistedProspect: persisted,
  });

  assert.equal(result.recovered, true);
  assert.equal(result.build.recovery, "persisted_signed_hero_rebuild");
  assert.equal(result.build.previewUrl, PREVIEW);
  assert.equal(result.build.buildHash, BUILD_HASH);
  assert.deepEqual(result.build.ownedPhotoBank, photoBank);
  assert.deepEqual(result.build.owned_photo_bank, photoBank);

  let builderCalls = 0;
  const resumed = await mirrorProspectResumable(row, {
    lane: "sandbox",
    batchId: BATCH_ID,
    persistedProspect: persisted,
    recoverPersistedMirrorBuild: (candidate, options) => recoverPersistedMirrorBuild(candidate, {
      ...options,
      persistedProspect: persisted,
    }),
    dispatchMirrorLane: async () => {
      builderCalls += 1;
      throw new Error("hero recovery must not deploy twice");
    },
  });
  assert.equal(builderCalls, 0);
  assert.equal(resumed.recovery, "persisted_signed_hero_rebuild");
});

test("generic previewed prospects remain outside persisted recovery", async () => {
  const { row, persisted } = fixture({ status: "previewed" });
  row.rowId = ROW_ID;
  row.heroRemaster = { jobId: HERO_JOB_ID };
  const result = await recoverPersistedMirrorBuild(row, {
    lane: "sandbox",
    batchId: BATCH_ID,
    persistedProspect: persisted,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.reason, "no_recoverable_persisted_mirror");
});

test("a terminal truth status cannot be overridden by an otherwise exact hero receipt", async () => {
  const value = heroFixture();
  value.persisted.status = "quarantined";
  const result = await recoverPersistedMirrorBuild(value.row, {
    lane: "sandbox",
    batchId: BATCH_ID,
    persistedProspect: value.persisted,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.reason, "no_recoverable_persisted_mirror");
});

test("signed stock-fallback hero evidence never recovers", async () => {
  const value = heroFixture();
  value.releaseEvidence.checks.brand.hero_video = {
    supplied: true,
    usable: true,
    placed: 0,
    reason: "hero_video_ext_mismatch:webm",
  };
  value.releaseEvidence.evidence_sha = signEvidence(value.releaseEvidence);
  value.dispatch.evidence_sha = value.releaseEvidence.evidence_sha;

  const result = await recoverPersistedMirrorBuild(value.row, {
    lane: "sandbox",
    batchId: BATCH_ID,
    persistedProspect: value.persisted,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.reason, "no_recoverable_persisted_mirror");
});

test("a hero receipt stamped by an earlier row of the same prospect still recovers", async (t) => {
  // 2026-08-28: a prospect re-picked by a later batch carries a new handle;
  // its own already-rebuilt mirror must remain recoverable or the row
  // re-dispatches a full build every cycle (44 min measured, live).
  const cases = [
    ["earlier batch", ({ persisted }) => { persisted.record.line_hero_rebuild.line_handle.batchId = "line_earlier_batch"; }],
    ["earlier row", ({ persisted }) => { persisted.record.line_hero_rebuild.line_handle.rowId = "line_earlier_batch:9"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const value = heroFixture();
      mutate(value);
      const result = await recoverPersistedMirrorBuild(value.row, {
        lane: "sandbox",
        batchId: BATCH_ID,
        persistedProspect: value.persisted,
      });
      assert.equal(result.recovered, true);
      assert.equal(result.build.recovery, "persisted_signed_hero_rebuild");
      assert.equal(result.build.previewUrl, PREVIEW);
      assert.equal(result.build.buildHash, BUILD_HASH);
    });
  }
});

test("a bare pending row with no job ids still recovers its stamped hero receipt", async () => {
  const value = heroFixture();
  delete value.row.heroRemaster.jobId;
  delete value.row.heroRemaster.rebuildJobId;
  const result = await recoverPersistedMirrorBuild(value.row, {
    lane: "sandbox",
    batchId: BATCH_ID,
    persistedProspect: value.persisted,
  });
  assert.equal(result.recovered, true);
  assert.equal(result.build.recovery, "persisted_signed_hero_rebuild");
});

test("a hero receipt with mismatched lineage or signed evidence never recovers", async (t) => {
  const cases = [
    ["prospect", ({ persisted }) => { persisted.record.line_hero_rebuild.prospect_id = "wss-test-other-prospect"; }],
    ["missing stamped handle", ({ persisted }) => { delete persisted.record.line_hero_rebuild.line_handle; }],
    ["hero job", ({ persisted }) => { persisted.record.line_hero_rebuild.hero_job_id = "hrj_other"; }],
    ["row names a newer hero job", ({ row }) => { row.heroRemaster.jobId = "hrj_newer"; }],
    ["row names a newer rebuild job", ({ row }) => { row.heroRemaster.rebuildJobId = "rebuild_newer"; }],
    ["missing hero clip SHA", ({ persisted }) => { delete persisted.record.line_hero_rebuild.hero_clip_sha256; }],
    ["hero clip SHA", ({ persisted }) => { persisted.record.line_hero_rebuild.hero_clip_sha256 = "5".repeat(64); }],
    ["rebuild job", ({ persisted }) => { persisted.record.line_hero_rebuild.rebuild_job_id = "rebuild_other"; }],
    ["dispatch job", ({ persisted }) => { persisted.record.line_hero_rebuild.build_dispatch.job_id = "rebuild_other"; }],
    ["hash", ({ persisted }) => { persisted.record.line_hero_rebuild.build_hash = "f".repeat(64); }],
    ["preview URL", ({ persisted }) => { persisted.record.line_hero_rebuild.preview_url = "https://wss-test-other.wss-ai.com/"; }],
    ["reel URL", ({ persisted }) => { persisted.record.line_hero_rebuild.reel_url = "https://blob.wss-ai.com/other/hero.mp4"; }],
    ["evidence", ({ persisted }) => {
      persisted.record.line_hero_rebuild.release_evidence = {
        ...persisted.record.line_hero_rebuild.release_evidence,
        build_hash: "f".repeat(64),
      };
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const value = heroFixture();
      mutate(value);
      const result = await recoverPersistedMirrorBuild(value.row, {
        lane: "sandbox",
        batchId: BATCH_ID,
        persistedProspect: value.persisted,
      });
      assert.equal(result.recovered, false);
      assert.equal(result.reason, "no_recoverable_persisted_mirror");
    });
  }
});
