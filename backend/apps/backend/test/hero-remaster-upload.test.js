"use strict";

// The upload endpoint is the publication trust boundary.  These tests prove
// that a filename/MIME claim is not enough, the source belongs to this exact
// prospect, and a failed durable write cannot trigger a rebuild.

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");

const validation = require("../lib/hero-clip-validation");

function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(out.length, 0);
  out.write(type, 4, 4, "ascii");
  payload.copy(out, 8);
  return out;
}

function validHeroMp4({ seconds = 4, width = 1920, height = 1080 } = {}) {
  const ftyp = box("ftyp", Buffer.from("isom\x00\x00\x02\x00isomiso2", "binary"));
  const mvhd = Buffer.alloc(24);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 16);
  const tkhd = Buffer.alloc(24);
  tkhd.writeUInt32BE(Math.round(width * 65536), 16);
  tkhd.writeUInt32BE(Math.round(height * 65536), 20);
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8, 4, "ascii");
  const stsdHead = Buffer.alloc(8);
  stsdHead.writeUInt32BE(1, 4);
  const stsd = box("stsd", Buffer.concat([stsdHead, box("avc1", Buffer.alloc(8))]));
  const sampleTable = box("minf", box("stbl", stsd));
  const trak = box("trak", Buffer.concat([box("tkhd", tkhd), box("mdia", Buffer.concat([box("hdlr", hdlr), sampleTable]))]));
  const moov = box("moov", Buffer.concat([box("mvhd", mvhd), trak]));
  return Buffer.concat([ftyp, moov, box("mdat", Buffer.from([1, 2, 3, 4]))]);
}

const SOURCE_SHA = "a".repeat(64);
const SOURCE_URL = "https://client.example.com/gallery/real-job.jpg?id=7";
const OPTIMIZED_SHA = "b".repeat(64);
const OPTIMIZED_FINGERPRINT = "googleusercontent.example/asset/remastered-1";
const APPROVED_AT = "2026-08-21T19:59:00.000Z";

function recordWithOwnedPhoto() {
  return {
    build_ready: {
      photo_bank: {
        photos: [{ url: SOURCE_URL, sha256: SOURCE_SHA, source: "own_site" }],
      },
    },
  };
}

function uploadFields() {
  return {
    prospect_id: "wss-test-acme",
    job_id: "hrj_upload",
    lease_token: "lease_upload",
    source_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    approved: "true",
    approved_by: "Mark",
    approved_at: APPROVED_AT,
    optimized_sha256: OPTIMIZED_SHA,
    optimized_asset_fingerprint: OPTIMIZED_FINGERPRINT,
    prompt_sha256: validation.REMASTER_PROMPT_SHA256,
  };
}

function durablePayload(clip, overrides = {}) {
  const clipSha = validation.validateHeroClip(clip).sha256;
  return {
    photo_bank: recordWithOwnedPhoto().build_ready.photo_bank,
    approved_clip: {
      approved: true,
      approved_by: "Mark",
      approved_at: APPROVED_AT,
      sha256: clipSha,
    },
    approved_artifact: {
      raw_sha256: SOURCE_SHA,
      source_url: SOURCE_URL,
      clip_sha256: clipSha,
      optimized_sha256: OPTIMIZED_SHA,
      optimized_asset_fingerprint: OPTIMIZED_FINGERPRINT,
      prompt_sha256: validation.REMASTER_PROMPT_SHA256,
    },
    ...overrides,
  };
}

function seedanceUploadContract(clip, durationSeconds = 8) {
  const clipSha = validation.validateHeroClip(clip).sha256;
  const fingerprint = `direct-source:${SOURCE_SHA}`;
  const receipt = {
    schema_version: validation.SEEDANCE_RECEIPT_SCHEMA,
    producer: "openrouter_seedance",
    generator: "openrouter_seedance",
    prospect_id: "wss-test-acme",
    domain: "client.example.com",
    source_type: "own_site",
    source_asset_type: "real_scene",
    source_sha256: SOURCE_SHA,
    raw_sha256: SOURCE_SHA,
    optimized_sha256: SOURCE_SHA,
    clip_sha256: clipSha,
    recipe_sha256: validation.DIRECT_SOURCE_RECIPE_SHA256,
    model_id: validation.SEEDANCE_MODEL_ID,
    duration_seconds: durationSeconds,
    generate_audio: false,
    wall_time_ms: 20_000,
    generation_time_ms: 18_000,
    cost_usd: 0.12,
  };
  return {
    fields: {
      ...uploadFields(),
      optimized_sha256: SOURCE_SHA,
      optimized_asset_fingerprint: fingerprint,
      prompt_sha256: validation.DIRECT_SOURCE_RECIPE_SHA256,
      image_preparation: "direct_client_photo",
    },
    payload: {
      duration_seconds: durationSeconds,
      photo_bank: { photos: [{ url: SOURCE_URL, sha256: SOURCE_SHA, source: "own_site", asset_type: "real_scene" }] },
      approved_clip: { approved: true, approved_by: "Mark", approved_at: APPROVED_AT, sha256: clipSha },
      approved_artifact: {
        raw_sha256: SOURCE_SHA,
        source_url: SOURCE_URL,
        clip_sha256: clipSha,
        optimized_sha256: SOURCE_SHA,
        optimized_asset_fingerprint: fingerprint,
        prompt_sha256: validation.DIRECT_SOURCE_RECIPE_SHA256,
        image_preparation: "direct_client_photo",
        producer: "openrouter_seedance",
        generator: "openrouter_seedance",
        generation_receipt: receipt,
      },
    },
    clipSha,
  };
}

test("legacy four-second Seedance approval stays valid and duration mismatch fails closed", () => {
  const clip = validHeroMp4({ seconds: 4 });
  const contract = seedanceUploadContract(clip, 4);
  const expected = {
    sourceSha256: SOURCE_SHA,
    sourceUrl: SOURCE_URL,
    clipSha256: contract.clipSha,
    producer: "openrouter_seedance",
    durationSeconds: 4,
    clipDurationSeconds: 4,
  };
  assert.equal(validation.validateDurableRemasterArtifact(
    contract.fields,
    contract.payload.approved_artifact,
    expected,
  ).ok, true);
  assert.equal(validation.validateDurableRemasterArtifact(
    contract.fields,
    contract.payload.approved_artifact,
    { ...expected, durationSeconds: 8 },
  ).ok, false);
});

test("only structurally verified horizontal MP4 bytes pass", () => {
  const valid = validation.validateHeroClip(validHeroMp4());
  assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.equal(valid.durationSec, 4);
  assert.equal(valid.width, 1920);
  assert.equal(valid.height, 1080);
  assert.match(valid.sha256, /^[a-f0-9]{64}$/);

  for (const bytes of [
    Buffer.from("<html>Google sign-in</html>"),
    Buffer.from("RIFF\x00\x00\x00\x00WEBP", "binary"),
    Buffer.from("video/mp4"),
  ]) assert.equal(validation.validateHeroClip(bytes).ok, false);

  assert.equal(validation.validateHeroClip(validHeroMp4({ seconds: 30 })).reason, "clip_duration_out_of_range");
  assert.equal(validation.validateHeroClip(validHeroMp4({ width: 1080, height: 1920 })).reason, "clip_dimensions_out_of_range");
});

test("source SHA and exact HTTPS URL must identify the same prospect-owned photo", () => {
  const record = recordWithOwnedPhoto();
  assert.equal(validation.findOwnedSource(record, { sha256: SOURCE_SHA, url: SOURCE_URL }).ok, true);
  assert.equal(
    validation.findOwnedSource(record, { sha256: SOURCE_SHA, url: "https://other.example.com/copied.jpg" }).reason,
    "source_url_not_owned",
    "a correct SHA cannot lend ownership to another URL",
  );
  assert.equal(
    validation.findOwnedSource(record, { sha256: "b".repeat(64), url: SOURCE_URL }).reason,
    "source_sha256_not_owned",
  );
  assert.equal(
    validation.findOwnedSource(record, { sha256: SOURCE_SHA, url: "http://client.example.com/gallery/real-job.jpg?id=7" }).reason,
    "source_url_invalid",
  );
});

test("approval is explicit, named, timestamped, and cannot come from the future", () => {
  const now = () => Date.parse("2026-08-21T20:00:00.000Z");
  assert.equal(validation.validateApproval({}, { now }).reason, "owner_approval_required");
  assert.equal(validation.validateApproval({ approved: "true" }, { now }).reason, "approved_by_required");
  assert.equal(validation.validateApproval({
    approved: "true", approved_by: "Mark", approved_at: "not-a-date",
  }, { now }).reason, "approved_at_invalid");
  assert.equal(validation.validateApproval({
    approved: "true", approved_by: "Mark", approved_at: "2026-08-22T20:00:00.000Z",
  }, { now }).reason, "approved_at_invalid");
  assert.equal(validation.validateApproval({
    approved: "true", approved_by: "Mark", approved_at: "2026-08-21T19:59:00.000Z",
  }, { now }).ok, true);
});

test("multipart parsing is binary-safe and bounded before allocation", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  assert.ok(upload.MAX_MULTIPART_BYTES < 4.5 * 1024 * 1024,
    "the complete request must fit through Vercel's 4.5 MB function envelope");
  const boundary = "wss-boundary-7f2b";
  const clip = validHeroMp4();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prospect_id"\r\n\r\nwss-test-acme\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="clip"; filename="hero.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
    clip,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = Readable.from([body]);
  req.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length),
  };
  const parsed = await upload.readMultipart(req, { maxBytes: body.length + 1 });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.fields.prospect_id, "wss-test-acme");
  assert.equal(parsed.file.fieldName, "clip");
  assert.deepEqual(parsed.file.bytes, clip);

  const refused = Readable.from([Buffer.alloc(1)]);
  refused.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(upload.MAX_MULTIPART_BYTES + 1),
  };
  assert.deepEqual(
    await upload.readMultipart(refused),
    { ok: false, error: "request_too_large", status: 413 },
  );
});

test("the canonical reel shape uses the engine field, accepted generator, and source SHA", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  assert.equal(typeof upload.createHeroClipUploadHandler, "function", "route must expose an injected test seam");

  const calls = { storage: [], patch: [], rebuild: [], kicks: [], events: [], terminal: [] };
  const clip = validHeroMp4();
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [{
      prospect_id: "wss-test-acme",
      record: { ...recordWithOwnedPhoto(), existing: "kept" },
    }] }),
    readMultipart: async () => ({
      ok: true,
      fields: uploadFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobLease: async (lease) => {
      assert.deepEqual(lease, { jobId: "hrj_upload", leaseToken: "lease_upload", prospectId: "wss-test-acme" });
      return { ok: true, job: { payload: {
        ...durablePayload(clip),
        line_handle: { batchId: "line_client", rowId: "line_client:0" },
      } } };
    },
    uploadProofShot: async (objectPath, bytes, options) => {
      calls.storage.push({ objectPath, bytes: bytes.length, options });
      return { ok: true, publicUrl: `https://assets.example.com/${objectPath}` };
    },
    patchHeroReel: async (prospectId, reel) => {
      calls.patch.push({ prospectId, reel });
      return { ok: true };
    },
    enqueueRebuildJob: async (input) => {
      calls.rebuild.push(input);
      return { ok: true, job_id: "rebuild-1" };
    },
    kickRebuildJob: (jobId) => { calls.kicks.push(jobId); },
    completeHeroReelJobAfterUpload: async (input) => {
      calls.terminal.push(input);
      return { ok: true, reused: false, job: { status: "done" } };
    },
    recordEvent: async (type, payload) => {
      calls.events.push({ type, payload });
      return { ok: true, mode: "live_write" };
    },
  });
  const res = responseHarness();
  await handler(requestHarness(), res);

  assert.equal(res.captured.status, 202, JSON.stringify(res.captured.body));
  assert.equal(calls.storage.length, 1);
  assert.match(calls.storage[0].objectPath, /^wss-test-acme\/hero-reels\/approved\/[a-f0-9]{64}\.mp4$/);
  assert.equal(calls.patch.length, 1);
  assert.deepEqual(calls.patch[0].reel, {
    url: calls.patch[0].reel.url,
    generator: "ads_image_to_video",
    composed_from: [SOURCE_SHA],
    composed_at: "2026-08-21T20:00:00.000Z",
  });
  assert.deepEqual(calls.rebuild, [{
    prospectId: "wss-test-acme",
    actor: "hero_clip_upload",
    heroJobId: "hrj_upload",
    heroClipSha256: validation.validateHeroClip(clip).sha256,
    lineHandle: { batchId: "line_client", rowId: "line_client:0" },
  }],
    "one durable write earns exactly one rebuild");
  assert.equal(calls.terminal.length, 1);
  assert.equal(calls.terminal[0].leaseToken, "lease_upload");
  assert.equal(calls.terminal[0].receipt.clip_sha256, validation.validateHeroClip(clip).sha256);
  assert.deepEqual(calls.terminal[0].receipt.rebuild.line_handle, {
    batchId: "line_client",
    rowId: "line_client:0",
  });
  assert.deepEqual(calls.kicks, ["rebuild-1"], "verified upload directly starts the durable rebuild");
  assert.equal(upload.heroRebuildKickEnabled({}), true);
  assert.equal(upload.heroRebuildKickEnabled({ GHOST_AGENCY_HERO_REBUILD_KICK: "0" }), false);
  assert.equal(res.captured.body.terminal, true);
  const assetEvent = calls.events.find((event) => event.type === "hero_clip.asset_stored");
  assert.equal(assetEvent.payload.source, "asset_studio_manual");
  assert.equal(assetEvent.payload.verified, true);
  assert.equal(assetEvent.payload.optimized_sha256, OPTIMIZED_SHA);
  assert.equal(assetEvent.payload.optimized_asset_fingerprint, OPTIMIZED_FINGERPRINT);
  assert.equal(assetEvent.payload.prompt_sha256, validation.REMASTER_PROMPT_SHA256);
  assert.deepEqual(assetEvent.payload.retention, { class: "approved_durable", expires_at: null });
});

test("shared release upload injects and activates in place with zero legacy rebuild calls", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4();
  const clipSha = validation.validateHeroClip(clip).sha256;
  const siteId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const nextReleaseId = "33333333-3333-4333-8333-333333333333";
  const buildHash = "c".repeat(64);
  const nextBuildHash = "d".repeat(64);
  const proofIdentity = { site_id: siteId, release_id: releaseId, build_hash: buildHash };
  const sharedReleaseEvidence = {
    evidence_schema: "shared-site-release-evidence-v1",
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
    canonical_host: "acme-plumbing.wss-ai.com",
    manifest_path: `sites/${siteId}/releases/${releaseId}/manifest.json`,
    manifest_sha256: "e".repeat(64),
    deployment_env: "production",
    generation: 4,
    route_generation: 4,
    state: "active",
    hero_video_path: "assets/hero-fallback.mp4",
    hero_video_sha256: "f".repeat(64),
  };
  const nativeEvidence = {
    ok: true,
    renderer: "mirror-engine@v1",
    qc_contract: "mirror-engine-qc-v1",
    evidence_schema: "mirror-engine-release-evidence-v1",
    build_hash: buildHash,
    slug: "acme-plumbing",
    deploy_id: releaseId,
    deploy_url: "https://acme-plumbing.wss-ai.com",
    preview_url: "https://acme-plumbing.wss-ai.com/",
    shared_publish: true,
    proofIdentity,
    sharedReleaseEvidence,
    checks: { render: { status: "passed" } },
    revealable: true,
  };
  nativeEvidence.evidence_sha = upload.signMirrorEvidence(nativeEvidence);
  const generationFingerprint = `mirror-engine:${buildHash}`;
  let durableRow = {
    prospect_id: "wss-test-acme",
    preview_url: "https://acme-plumbing.wss-ai.com/",
    status: "line_gate_passed",
    updated_at: "2026-08-21T19:59:30.000Z",
    record: {
      ...recordWithOwnedPhoto(),
      preview_url: "https://acme-plumbing.wss-ai.com/",
      status: "line_gate_passed",
      build_dispatch: {
        renderer: "mirror-engine@v1",
        qc_contract: "mirror-engine-qc-v1",
        evidence_schema: "mirror-engine-release-evidence-v1",
        evidence_sha: nativeEvidence.evidence_sha,
        build_hash: buildHash,
        generation_fingerprint: generationFingerprint,
        release_evidence: nativeEvidence,
      },
      release_evidence: nativeEvidence,
      mirror_release_evidence: nativeEvidence,
      siteforge_generation_fingerprint: generationFingerprint,
      siteforge_callback: {
        generation_fingerprint: generationFingerprint,
        release_evidence: nativeEvidence,
      },
    },
  };
  const sharedRow = durableRow;
  let injectInput;
  let injections = 0;
  let rebuilds = 0;
  let terminalReceipt;
  let doneJob = null;
  let proofCas;
  let proofWrites = 0;
  const wakes = [];
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    environment: {},
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [durableRow] }),
    readMultipart: async () => ({
      ok: true,
      fields: uploadFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobLease: async () => ({ ok: true, job: { payload: durablePayload(clip, {
      line_handle: { batchId: "line_client", rowId: "line_client:0" },
    }) } }),
    getHeroReelJob: async () => doneJob ? { ok: true, job: doneJob } : { ok: false },
    uploadProofShot: async (objectPath) => ({ ok: true, publicUrl: `https://assets.example.com/${objectPath}` }),
    patchHeroReel: async () => {
      durableRow = {
        ...durableRow,
        updated_at: "2026-08-21T19:59:45.000Z",
        record: {
          ...durableRow.record,
          media_bank: { hero_reel: { url: "https://assets.example.com/approved.mp4" } },
        },
      };
      return { ok: true, write_id: "record-write" };
    },
    conditionalUpdate: async (table, idColumn, idValue, guards, patch) => {
      proofWrites += 1;
      proofCas = { table, idColumn, idValue, guards, patch };
      durableRow = { ...durableRow, ...patch };
      // Simulate PostgREST losing its response after the exact CAS committed.
      return { ok: false, updated: false, error: "network_response_lost" };
    },
    enqueueRebuildJob: async () => { rebuilds += 1; return { ok: true, job_id: "must-not-run" }; },
    injectSharedSiteHero: async (input) => {
      injections += 1;
      injectInput = input;
      return {
        ok: true,
        previewUrl: "https://acme-plumbing.wss-ai.com/",
        proofIdentity: { site_id: siteId, release_id: nextReleaseId, build_hash: nextBuildHash },
        previousProofIdentity: { site_id: siteId, release_id: releaseId, build_hash: buildHash },
        releaseEvidence: {
          evidence_schema: "shared-site-release-evidence-v1",
          site_id: siteId,
          release_id: nextReleaseId,
          build_hash: nextBuildHash,
          canonical_host: "acme-plumbing.wss-ai.com",
          manifest_path: `sites/${siteId}/releases/${nextReleaseId}/manifest.json`,
          manifest_sha256: "a".repeat(64),
          deployment_env: "production",
          state: "active",
          generation: 5,
          route_generation: 5,
          hero_video_path: "assets/hero-fallback.mp4",
          hero_video_sha256: clipSha,
        },
        heroVideoPath: "assets/hero-fallback.mp4",
        heroVideoSha256: clipSha,
      };
    },
    completeHeroReelJobAfterUpload: async ({ jobId, leaseToken, receipt }) => {
      assert.deepEqual(wakes, [], "shared Line wake cannot happen before terminal settlement");
      terminalReceipt = receipt;
      doneJob = {
        jobId,
        prospectId: "wss-test-acme",
        status: "done",
        payload: {
          ...durablePayload(clip),
          line_handle: { batchId: "line_client", rowId: "line_client:0" },
        },
        result: {
          clip_sha256: receipt.clip_sha256,
          url: receipt.url,
          upload_receipt: receipt,
          completed_by: "verified_upload",
          settled_by_lease: leaseToken,
          action: "complete",
        },
      };
      return { ok: true };
    },
    wakeLineForCompletedHero: async (prospectId, lineHandle) => {
      wakes.push({ prospectId, lineHandle });
      return { accepted: true };
    },
    recordEvent: async () => ({ ok: true, mode: "live_write" }),
  });
  const res = responseHarness();
  await handler(requestHarness(), res);

  assert.equal(res.captured.status, 202, JSON.stringify(res.captured.body));
  assert.equal(rebuilds, 0, "shared selection never enters the legacy rebuild lane");
  assert.equal(injectInput.row, sharedRow);
  assert.equal(injectInput.asset.sha256, clipSha);
  assert.equal(injectInput.asset.approved, true);
  assert.equal(injectInput.asset.verified, true);
  assert.equal(injectInput.asset.source_sha256, SOURCE_SHA);
  assert.equal(proofCas.table, "ghost_agency_prospects");
  assert.equal(proofCas.idValue, "wss-test-acme");
  assert.equal(
    proofCas.guards["record->build_dispatch->release_evidence->proofIdentity->>release_id"],
    `eq.${releaseId}`,
  );
  assert.equal(
    proofCas.guards["record->build_dispatch->release_evidence->sharedReleaseEvidence->>generation"],
    "eq.4",
  );
  const durableEvidence = durableRow.record.build_dispatch.release_evidence;
  assert.deepEqual(durableEvidence.proofIdentity, {
    site_id: siteId, release_id: nextReleaseId, build_hash: nextBuildHash,
  });
  assert.equal(durableEvidence.sharedReleaseEvidence.generation, 5);
  assert.equal(durableEvidence.sharedReleaseEvidence.hero_video_sha256, clipSha);
  assert.equal(durableRow.record.build_dispatch.build_hash, nextBuildHash);
  assert.equal(durableRow.record.build_dispatch.generation_fingerprint, `mirror-engine:${nextBuildHash}`);
  assert.equal(durableRow.record.siteforge_generation_fingerprint, `mirror-engine:${nextBuildHash}`);
  assert.deepEqual(durableRow.record.release_evidence, durableEvidence);
  assert.deepEqual(durableRow.record.mirror_release_evidence, durableEvidence);
  assert.deepEqual(durableRow.record.siteforge_callback.release_evidence, durableEvidence);
  assert.equal(upload.signMirrorEvidence(durableEvidence), durableEvidence.evidence_sha,
    "the updated canonical release evidence remains engine-verifiable");
  assert.equal(proofWrites, 1, "a lost CAS response is reconciled from the durable row without a second write");
  assert.deepEqual(terminalReceipt.shared_release.proof_identity, {
    site_id: siteId, release_id: nextReleaseId, build_hash: nextBuildHash,
  });
  assert.equal(terminalReceipt.shared_release.record_write_id, durableRow.updated_at);
  assert.deepEqual(terminalReceipt.shared_release.line_handle, {
    batchId: "line_client", rowId: "line_client:0",
  });
  assert.equal(terminalReceipt.record.write_id, durableRow.updated_at);
  assert.equal(Object.hasOwn(terminalReceipt, "rebuild"), false);
  assert.equal(res.captured.body.queued, false);
  assert.equal(res.captured.body.shared_release_activated, true);
  assert.equal(res.captured.body.rebuild_queued, undefined);
  assert.equal(res.captured.body.preview_url, "https://acme-plumbing.wss-ai.com/");
  assert.deepEqual(wakes, [{
    prospectId: "wss-test-acme",
    lineHandle: { batchId: "line_client", rowId: "line_client:0" },
  }]);

  const retry = responseHarness();
  await handler(requestHarness(), retry);
  assert.equal(retry.captured.status, 202, JSON.stringify(retry.captured.body));
  assert.equal(retry.captured.body.reused, true);
  assert.equal(retry.captured.body.shared_release_activated, true);
  assert.equal(retry.captured.body.proof_identity.release_id, nextReleaseId);
  assert.equal(injections, 1, "lost response retry does not republish the immutable release");
  assert.equal(proofWrites, 1, "terminal retry does not rewrite the proof tuple");
  assert.equal(rebuilds, 0);
  assert.deepEqual(wakes, [
    { prospectId: "wss-test-acme", lineHandle: { batchId: "line_client", rowId: "line_client:0" } },
    { prospectId: "wss-test-acme", lineHandle: { batchId: "line_client", rowId: "line_client:0" } },
  ], "a lost shared response re-wakes the same exact row without republishing");

  const durablePayloadSnapshot = structuredClone(doneJob.payload);
  for (const mutate of [
    (payload) => { payload.line_handle.rowId = "line_client:9"; },
    (payload) => { delete payload.line_handle; },
  ]) {
    doneJob.payload = structuredClone(durablePayloadSnapshot);
    mutate(doneJob.payload);
    const hostileRetry = responseHarness();
    await handler(requestHarness(), hostileRetry);
    assert.equal(hostileRetry.captured.status, 409, JSON.stringify(hostileRetry.captured.body));
    assert.equal(hostileRetry.captured.body.error, "completed_upload_retry_mismatch");
    assert.equal(wakes.length, 2, "an unbound retry cannot wake any Line row");
  }
});

test("shared publish cannot answer success or wake Line before proof CAS and terminal settlement", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4();
  const clipSha = validation.validateHeroClip(clip).sha256;
  const siteId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const nextReleaseId = "33333333-3333-4333-8333-333333333333";
  const buildHash = "c".repeat(64);
  const nextBuildHash = "d".repeat(64);
  const sharedEvidence = {
    evidence_schema: "shared-site-release-evidence-v1",
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
    canonical_host: "acme-plumbing.wss-ai.com",
    manifest_path: `sites/${siteId}/releases/${releaseId}/manifest.json`,
    manifest_sha256: "e".repeat(64),
    deployment_env: "production",
    generation: 4,
    route_generation: 4,
    state: "active",
    hero_video_path: "assets/hero-fallback.mp4",
    hero_video_sha256: "f".repeat(64),
  };
  let completes = 0;
  let rebuilds = 0;
  let proofPersists = false;
  let wakes = 0;
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [{
      prospect_id: "wss-test-acme",
      preview_url: "https://acme-plumbing.wss-ai.com/",
      proofIdentity: { site_id: siteId, release_id: releaseId, build_hash: buildHash },
      sharedReleaseEvidence: sharedEvidence,
      record: recordWithOwnedPhoto(),
    }] }),
    readMultipart: async () => ({
      ok: true,
      fields: uploadFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobLease: async () => ({ ok: true, job: { payload: durablePayload(clip, {
      line_handle: { batchId: "line_client", rowId: "line_client:0" },
    }) } }),
    uploadProofShot: async () => ({ ok: true, publicUrl: "https://assets.example.com/approved.mp4" }),
    patchHeroReel: async () => ({ ok: true, write_id: "media-write" }),
    injectSharedSiteHero: async () => ({
      ok: true,
      previewUrl: "https://acme-plumbing.wss-ai.com/",
      proofIdentity: { site_id: siteId, release_id: nextReleaseId, build_hash: nextBuildHash },
      previousProofIdentity: { site_id: siteId, release_id: releaseId, build_hash: buildHash },
      releaseEvidence: { ...sharedEvidence, release_id: nextReleaseId, build_hash: nextBuildHash,
        generation: 5, route_generation: 5, hero_video_sha256: clipSha },
      heroVideoPath: "assets/hero-fallback.mp4",
      heroVideoSha256: clipSha,
    }),
    persistSharedHeroRelease: async () => proofPersists
      ? ({ ok: true, write_id: "shared-record-write" })
      : ({ ok: false, reason: "stale_previous_generation" }),
    enqueueRebuildJob: async () => { rebuilds += 1; return { ok: true }; },
    completeHeroReelJobAfterUpload: async () => { completes += 1; return { ok: false, error: "lease_conflict" }; },
    wakeLineForCompletedHero: async () => { wakes += 1; return { accepted: true }; },
    recordEvent: async () => ({ ok: true, mode: "live_write" }),
  });
  const res = responseHarness();
  await handler(requestHarness(), res);
  assert.equal(res.captured.status, 503);
  assert.equal(res.captured.body.error, "shared_hero_proof_persist_failed");
  assert.equal(res.captured.body.legacy_rebuild_queued, false);
  assert.equal(completes, 0, "the terminal lease cannot close before canonical proof persistence");
  assert.equal(rebuilds, 0, "proof persistence failure never falls into the legacy deployment lane");
  assert.equal(wakes, 0, "proof persistence failure cannot wake Line");

  proofPersists = true;
  const settleFailure = responseHarness();
  await handler(requestHarness(), settleFailure);
  assert.equal(settleFailure.captured.status, 503);
  assert.equal(settleFailure.captured.body.error, "terminal_settle_failed");
  assert.equal(settleFailure.captured.body.shared_release_activated, true);
  assert.equal(completes, 1);
  assert.equal(rebuilds, 0);
  assert.equal(wakes, 0, "a shared release cannot wake Line until terminal settlement succeeds");
});

test("exact shared hero kill switch preserves the legacy rebuild route", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4();
  let injections = 0;
  let rebuilds = 0;
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    environment: { GHOST_AGENCY_SHARED_HERO_INJECTION: "0", GHOST_AGENCY_HERO_REBUILD_KICK: "0" },
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [{
      prospect_id: "wss-test-acme",
      proofIdentity: { site_id: "partial-marker" },
      record: recordWithOwnedPhoto(),
    }] }),
    readMultipart: async () => ({
      ok: true,
      fields: uploadFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobLease: async () => ({ ok: true, job: { payload: durablePayload(clip) } }),
    uploadProofShot: async () => ({ ok: true, publicUrl: "https://assets.example.com/approved.mp4" }),
    patchHeroReel: async () => ({ ok: true }),
    injectSharedSiteHero: async () => { injections += 1; return { ok: true }; },
    enqueueRebuildJob: async () => { rebuilds += 1; return { ok: true, job_id: "legacy-rebuild" }; },
    completeHeroReelJobAfterUpload: async () => ({ ok: true }),
    recordEvent: async () => ({ ok: true, mode: "live_write" }),
  });
  const res = responseHarness();
  await handler(requestHarness(), res);
  assert.equal(res.captured.status, 202, JSON.stringify(res.captured.body));
  assert.equal(injections, 0);
  assert.equal(rebuilds, 1);
  assert.equal(res.captured.body.rebuild_queued, true);
});

test("upload route rejects the admin credential and accepts only the worker header", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const savedWorker = process.env.GHOST_AGENCY_HERO_WORKER_TOKEN;
  const savedAdmin = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  try {
    process.env.GHOST_AGENCY_HERO_WORKER_TOKEN = "route-worker-token";
    process.env.GHOST_AGENCY_ADMIN_TOKEN = "route-owner-token";
    const handler = upload.createHeroClipUploadHandler({
      readMultipart: async () => ({ ok: false, status: 400, error: "stopped_after_auth" }),
    });

    const adminRes = responseHarness();
    await handler({ method: "POST", headers: { authorization: "Bearer route-owner-token" } }, adminRes);
    assert.equal(adminRes.captured.status, 401);
    assert.equal(adminRes.captured.body.error, "unauthorized");

    const workerRes = responseHarness();
    await handler({ method: "POST", headers: { "x-ghost-hero-worker-token": "route-worker-token" } }, workerRes);
    assert.equal(workerRes.captured.status, 400);
    assert.equal(workerRes.captured.body.error, "stopped_after_auth");
  } finally {
    if (savedWorker === undefined) delete process.env.GHOST_AGENCY_HERO_WORKER_TOKEN;
    else process.env.GHOST_AGENCY_HERO_WORKER_TOKEN = savedWorker;
    if (savedAdmin === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = savedAdmin;
  }
});

test("upload cannot answer success until the server closes the lease", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4();
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] }),
    readMultipart: async () => ({
      ok: true,
      fields: uploadFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobLease: async () => ({ ok: true, job: { payload: durablePayload(clip) } }),
    uploadProofShot: async () => ({ ok: true, publicUrl: "https://assets.example.com/hero.mp4" }),
    patchHeroReel: async () => ({ ok: true, write_id: "record-write" }),
    enqueueRebuildJob: async () => ({ ok: true, job_id: "rebuild-1" }),
    recordEvent: async () => ({ ok: true, mode: "live_write", event_id: "audit-write" }),
    completeHeroReelJobAfterUpload: async () => ({ ok: false, error: "lease_conflict" }),
  });
  const res = responseHarness();
  await handler(requestHarness(), res);
  assert.equal(res.captured.status, 503);
  assert.equal(res.captured.body.error, "terminal_settle_failed");
  assert.equal(res.captured.body.persisted, true);
  assert.equal(res.captured.body.rebuild_queued, true);
});

test("a persistence failure prevents rebuild and can never answer accepted", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const rebuilds = [];
  const clip = validHeroMp4();
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] }),
    readMultipart: async () => ({
      ok: true,
      fields: uploadFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobLease: async () => ({
      ok: true,
      job: { payload: durablePayload(clip) },
    }),
    uploadProofShot: async () => ({ ok: true, publicUrl: "https://assets.example.com/x.mp4" }),
    patchHeroReel: async () => ({ ok: false, reason: "persist_failed" }),
    enqueueRebuildJob: async (input) => { rebuilds.push(input); return { ok: true }; },
    recordEvent: async () => ({ ok: true, mode: "live_write" }),
  });
  const res = responseHarness();
  await handler(requestHarness(), res);
  assert.notEqual(res.captured.status, 202);
  assert.equal(res.captured.body.ok, false);
  assert.deepEqual(rebuilds, []);
});

test("invalid lease rejects before storage, audit, record patch, or rebuild", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const writes = [];
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] }),
    readMultipart: async () => ({
      ok: true,
      fields: { ...uploadFields(), lease_token: "zombie" },
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: validHeroMp4() },
    }),
    validateHeroReelJobLease: async () => ({ ok: false, error: "lease_conflict" }),
    uploadProofShot: async () => { writes.push("storage"); return { ok: true }; },
    patchHeroReel: async () => { writes.push("patch"); return { ok: true }; },
    enqueueRebuildJob: async () => { writes.push("rebuild"); return { ok: true }; },
    recordEvent: async () => { writes.push("event"); return { ok: true, mode: "live_write" }; },
  });
  const res = responseHarness();
  await handler(requestHarness(), res);
  assert.equal(res.captured.status, 409);
  assert.equal(res.captured.body.error, "lease_conflict");
  assert.deepEqual(writes, []);
});

test("a valid lease cannot swap in a source absent from its originally claimed photo bank", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const writes = [];
  const clip = validHeroMp4();
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    select: async () => ({ ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] }),
    readMultipart: async () => ({
      ok: true,
      fields: uploadFields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobLease: async () => ({
      ok: true,
      job: { payload: durablePayload(clip, { photo_bank: { photos: [{
          url: "https://acme.example.com/work/a-different-job.jpg",
          sha256: "c".repeat(64),
        }] } }) },
    }),
    uploadProofShot: async () => { writes.push("storage"); return { ok: true }; },
    patchHeroReel: async () => { writes.push("patch"); return { ok: true }; },
    enqueueRebuildJob: async () => { writes.push("rebuild"); return { ok: true }; },
    recordEvent: async () => { writes.push("event"); return { ok: true, mode: "live_write" }; },
  });
  const res = responseHarness();
  await handler(requestHarness(), res);
  assert.equal(res.captured.status, 409);
  assert.equal(res.captured.body.error, "source_not_in_claimed_job");
  assert.deepEqual(writes, []);
});

test("worker approval fields cannot replace an exact durable owner receipt", async (t) => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4();
  for (const [name, approvedClip] of [
    ["missing receipt", undefined],
    ["different clip SHA", { approved: true, approved_by: "Mark", approved_at: APPROVED_AT, sha256: "f".repeat(64) }],
    ["different approver", { approved: true, approved_by: "Someone else", approved_at: APPROVED_AT, sha256: validation.validateHeroClip(clip).sha256 }],
  ]) {
    await t.test(name, async () => {
      const writes = [];
      const handler = upload.createHeroClipUploadHandler({
        requireHeroWorker: () => true,
        now: () => new Date("2026-08-21T20:00:00.000Z"),
        select: async () => ({ ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] }),
        readMultipart: async () => ({
          ok: true,
          fields: uploadFields(),
          file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
        }),
        validateHeroReelJobLease: async () => ({
          ok: true,
          job: { payload: durablePayload(clip, { approved_clip: approvedClip }) },
        }),
        uploadProofShot: async () => { writes.push("storage"); return { ok: true }; },
        patchHeroReel: async () => { writes.push("patch"); return { ok: true }; },
        enqueueRebuildJob: async () => { writes.push("rebuild"); return { ok: true }; },
        recordEvent: async () => { writes.push("event"); return { ok: true, mode: "live_write" }; },
      });
      const res = responseHarness();
      await handler(requestHarness(), res);
      assert.equal(res.captured.status, 409);
      assert.equal(res.captured.body.error, "durable_owner_approval_required");
      assert.deepEqual(writes, []);
    });
  }
});

test("remaster provenance must exactly match the server-frozen artifact", async (t) => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4();
  const cases = [
    ["missing artifact", undefined, {}],
    ["different optimized SHA", {
      ...durablePayload(clip).approved_artifact,
      optimized_sha256: "e".repeat(64),
    }, {}],
    ["different transport fingerprint", durablePayload(clip).approved_artifact, {
      optimized_asset_fingerprint: "googleusercontent.example/asset/other",
    }],
    ["noncanonical prompt", {
      ...durablePayload(clip).approved_artifact,
      prompt_sha256: "d".repeat(64),
    }, {}],
  ];
  for (const [name, approvedArtifact, fieldOverrides] of cases) {
    await t.test(name, async () => {
      const writes = [];
      const handler = upload.createHeroClipUploadHandler({
        requireHeroWorker: () => true,
        now: () => new Date("2026-08-21T20:00:00.000Z"),
        select: async () => ({ ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] }),
        readMultipart: async () => ({
          ok: true,
          fields: { ...uploadFields(), ...fieldOverrides },
          file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
        }),
        validateHeroReelJobLease: async () => ({
          ok: true,
          job: { payload: durablePayload(clip, { approved_artifact: approvedArtifact }) },
        }),
        uploadProofShot: async () => { writes.push("storage"); return { ok: true }; },
        patchHeroReel: async () => { writes.push("patch"); return { ok: true }; },
        enqueueRebuildJob: async () => { writes.push("rebuild"); return { ok: true }; },
        recordEvent: async () => { writes.push("event"); return { ok: true, mode: "live_write" }; },
      });
      const res = responseHarness();
      await handler(requestHarness(), res);
      assert.equal(res.captured.status, 409);
      assert.equal(res.captured.body.error, "durable_remaster_artifact_required");
      assert.deepEqual(writes, []);
    });
  }
});

test("a lost terminal response retries from the exact durable receipt without duplicate writes", async (t) => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4();
  const clipSha = validation.validateHeroClip(clip).sha256;
  const payload = durablePayload(clip);
  const calls = {
    prospectReads: 0,
    leaseValidations: 0,
    storage: 0,
    audit: 0,
    patch: 0,
    rebuild: 0,
    complete: 0,
  };
  let doneJob = null;
  let nextFields = uploadFields();
  let nextClip = clip;

  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => true,
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    getHeroReelJob: async () => (doneJob
      ? { ok: true, job: doneJob }
      : { ok: false, error: "unknown_job" }),
    select: async () => {
      calls.prospectReads += 1;
      return { ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] };
    },
    readMultipart: async () => ({
      ok: true,
      fields: nextFields,
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: nextClip },
    }),
    validateHeroReelJobLease: async () => {
      calls.leaseValidations += 1;
      return { ok: true, job: { payload } };
    },
    uploadProofShot: async (objectPath) => {
      calls.storage += 1;
      return {
        ok: true,
        publicUrl: `https://assets.example.com/${objectPath}`,
        write_id: "blob-write-1",
      };
    },
    recordEvent: async (type) => {
      if (type === "hero_clip.asset_stored") calls.audit += 1;
      return { ok: true, mode: "live_write", event_id: "audit-write-1" };
    },
    patchHeroReel: async () => {
      calls.patch += 1;
      return { ok: true, write_id: "prospect-write-1" };
    },
    enqueueRebuildJob: async () => {
      calls.rebuild += 1;
      return { ok: true, job_id: "rebuild-1" };
    },
    completeHeroReelJobAfterUpload: async ({ jobId, leaseToken, receipt }) => {
      calls.complete += 1;
      doneJob = {
        jobId,
        prospectId: "wss-test-acme",
        status: "done",
        payload,
        result: {
          ok: true,
          clip_sha256: receipt.clip_sha256,
          url: receipt.url,
          upload_receipt: {
            storage: receipt.storage,
            audit: receipt.audit,
            record: receipt.record,
            rebuild: receipt.rebuild,
          },
          completed_by: "verified_upload",
          settled_by_lease: leaseToken,
          action: "complete",
          settled_at: "2026-08-21T20:00:00.000Z",
        },
      };
      return { ok: true, reused: false, job: { status: "done" } };
    },
  });

  const first = responseHarness();
  await handler(requestHarness(), first);
  assert.equal(first.captured.status, 202, JSON.stringify(first.captured.body));
  // The network/client loses this first response after the server has settled.
  const afterFirst = { ...calls };
  assert.deepEqual(afterFirst, {
    prospectReads: 1,
    leaseValidations: 1,
    storage: 1,
    audit: 1,
    patch: 1,
    rebuild: 1,
    complete: 1,
  });

  const retry = responseHarness();
  await handler(requestHarness(), retry);
  assert.equal(retry.captured.status, 202, JSON.stringify(retry.captured.body));
  assert.equal(retry.captured.body.ok, true);
  assert.equal(retry.captured.body.terminal, true);
  assert.equal(retry.captured.body.reused, true);
  assert.equal(retry.captured.body.clip_sha256, clipSha);
  assert.equal(retry.captured.body.url, first.captured.body.url);
  assert.equal(retry.captured.body.rebuild_job_id, "rebuild-1");
  assert.equal(JSON.stringify(retry.captured.body).includes("lease_upload"), false,
    "the private settling lease must never ride the recovery response");
  assert.deepEqual(calls, afterFirst, "the retry performs zero duplicate reads or writes outside the durable job read");

  const hostileCases = [
    ["wrong lease", { lease_token: "zombie-lease" }, clip],
    ["wrong clip SHA", {}, validHeroMp4({ seconds: 5 })],
    ["wrong prospect", { prospect_id: "wss-test-other" }, clip],
    ["wrong source", { source_url: "https://other.example.com/copied.jpg" }, clip],
    ["wrong artifact", { optimized_asset_fingerprint: "googleusercontent.example/asset/tampered" }, clip],
  ];
  for (const [name, fieldOverrides, bytes] of hostileCases) {
    await t.test(name, async () => {
      nextFields = { ...uploadFields(), ...fieldOverrides };
      nextClip = bytes;
      const refused = responseHarness();
      await handler(requestHarness(), refused);
      assert.equal(refused.captured.status, 409);
      assert.equal(refused.captured.body.error, "completed_upload_retry_mismatch");
      assert.deepEqual(calls, afterFirst, `${name} must perform zero duplicate side effects`);
    });
  }

  await t.test("missing durable rebuild proof", async () => {
    nextFields = uploadFields();
    nextClip = clip;
    const saved = doneJob.result.upload_receipt.rebuild;
    doneJob.result.upload_receipt.rebuild = {};
    const refused = responseHarness();
    await handler(requestHarness(), refused);
    doneJob.result.upload_receipt.rebuild = saved;
    assert.equal(refused.captured.status, 409);
    assert.equal(refused.captured.body.error, "completed_upload_retry_mismatch");
    assert.deepEqual(calls, afterFirst);
  });
});

test("redeemed upload lease publishes only its exact approved Seedance SHA", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4({ seconds: 8 });
  const contract = seedanceUploadContract(clip);
  const calls = { staticAuth: 0, capability: [], storage: 0, patch: 0, patchedReel: null, rebuild: 0, complete: 0 };
  const handler = upload.createHeroClipUploadHandler({
    requireHeroWorker: () => { calls.staticAuth += 1; return false; },
    now: () => new Date("2026-08-21T20:00:00.000Z"),
    readMultipart: async () => ({
      ok: true,
      fields: contract.fields,
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    }),
    validateHeroReelJobCapabilityLease: async (input) => {
      calls.capability.push(input);
      return {
        ok: true,
        job: {
          jobId: "hrj_upload",
          prospectId: "wss-test-acme",
          producer: "openrouter_seedance",
          generationRevision: 1,
          status: "running",
          payload: { ...contract.payload, line_handle: { batchId: "line_tulip", rowId: "row_tulip" } },
          result: { provider_checkpoint: {
            schema_version: "wss.hero.seedance_provider_checkpoint.v1",
            submission_state: "accepted",
            provider_job_id: "provider_upload",
            generation_revision: 1,
          } },
        },
      };
    },
    validateHeroReelJobLease: async () => { throw new Error("static_lease_path_must_not_run"); },
    select: async () => ({ ok: true, data: [{ prospect_id: "wss-test-acme", record: recordWithOwnedPhoto() }] }),
    uploadProofShot: async (objectPath) => {
      calls.storage += 1;
      return { ok: true, publicUrl: `https://assets.example.com/${objectPath}`, write_id: "asset-1" };
    },
    recordEvent: async () => ({ ok: true, mode: "live_write", event_id: "event-1" }),
    patchHeroReel: async (_prospectId, reel) => {
      calls.patch += 1;
      calls.patchedReel = reel;
      return { ok: true, write_id: "record-1" };
    },
    enqueueRebuildJob: async () => { calls.rebuild += 1; return { ok: true, job_id: "rebuild-1" }; },
    kickRebuildJob: () => {},
    completeHeroReelJobAfterUpload: async () => { calls.complete += 1; return { ok: true }; },
  });
  const res = responseHarness();
  await handler({
    method: "POST",
    headers: { "x-ghost-hero-job-lease": "lease_upload", host: "ghost.example.com" },
  }, res);
  assert.equal(res.captured.status, 202, JSON.stringify(res.captured.body));
  assert.equal(calls.staticAuth, 0);
  assert.deepEqual(calls.capability, [{
    jobId: "hrj_upload",
    leaseToken: "lease_upload",
    phase: "upload",
    approvedSha256: contract.clipSha,
  }]);
  assert.deepEqual({ storage: calls.storage, patch: calls.patch, rebuild: calls.rebuild, complete: calls.complete }, {
    storage: 1, patch: 1, rebuild: 1, complete: 1,
  });
  assert.equal(res.captured.body.producer, "openrouter_seedance");
  assert.equal(res.captured.body.generator, "openrouter_seedance");
  assert.equal(calls.patchedReel.provenance.kind, "seedance_generated");
  assert.equal(calls.patchedReel.provenance.checkpoint_schema, "wss.hero.seedance_provider_checkpoint.v1");
  assert.equal(calls.patchedReel.provenance.generation_receipt_schema, validation.SEEDANCE_RECEIPT_SCHEMA);
  assert.match(calls.patchedReel.provenance.generation_receipt_sha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(calls.patchedReel.provenance, "generation_receipt"), false,
    "the durable row carries only a compact receipt proof, not the full receipt");
});

test("upload lease mismatch or wrong approved SHA fails before every side effect", async () => {
  const upload = require("../api/admin/hero-clip-upload");
  const clip = validHeroMp4({ seconds: 8 });
  const contract = seedanceUploadContract(clip);
  for (const variant of ["header_mismatch", "sha_refused"]) {
    const sideEffects = [];
    const handler = upload.createHeroClipUploadHandler({
      requireHeroWorker: () => false,
      readMultipart: async () => ({
        ok: true,
        fields: contract.fields,
        file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
      }),
      validateHeroReelJobCapabilityLease: async () => variant === "sha_refused"
        ? { ok: false, error: "capability_lease_conflict" }
        : { ok: true },
      select: async () => { sideEffects.push("select"); return { ok: true, data: [] }; },
      uploadProofShot: async () => { sideEffects.push("storage"); return { ok: true }; },
      recordEvent: async () => { sideEffects.push("event"); return { ok: true }; },
      patchHeroReel: async () => { sideEffects.push("patch"); return { ok: true }; },
      enqueueRebuildJob: async () => { sideEffects.push("rebuild"); return { ok: true }; },
      completeHeroReelJobAfterUpload: async () => { sideEffects.push("complete"); return { ok: true }; },
    });
    const res = responseHarness();
    await handler({
      method: "POST",
      headers: {
        "x-ghost-hero-job-lease": variant === "header_mismatch" ? "different-lease" : "lease_upload",
      },
    }, res);
    assert.equal(res.captured.status, 409, variant);
    assert.equal(res.captured.body.error, "capability_lease_conflict");
    assert.deepEqual(sideEffects, [], variant);
  }
});

function requestHarness() {
  return { method: "POST", headers: { "x-ghost-hero-worker-token": "test-worker", host: "ghost.example.com" } };
}

function responseHarness() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    writeHead(code) { this.statusCode = code; return this; },
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(body));
    },
  };
}
