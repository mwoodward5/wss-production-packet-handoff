"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPreviewForProspect: buildPreviewForProspectCore } = require("../lib/full-run");
const { prospectId } = require("../lib/prospects");
const {
  CANONICAL_SITEFORGE_BUILD_URL,
  RELEASE_EVIDENCE_SCHEMA,
  dispatchSiteForgePreview,
  extractCompiledTruthPacket,
  extractReleaseEvidence,
} = require("../lib/siteforge");

async function buildPreviewForProspect(prospect = {}, options = {}) {
  const existingSelect = options.select;
  let consentReadComplete = false;
  return buildPreviewForProspectCore(prospect, {
    ...options,
    select: async (...args) => {
      if (!consentReadComplete) {
        consentReadComplete = true;
        return {
          ok: true,
          mode: "test_fixture",
          data: [{
            ...structuredClone(prospect),
            prospect_id: prospectId(prospect),
            record: {
              ...(prospect.record && typeof prospect.record === "object"
                ? structuredClone(prospect.record)
                : {}),
              preview_build_consent: {
                status: "granted",
                recorded_at: "2026-07-29T12:00:00.000Z",
                source: "test_fixture",
              },
            },
          }],
        };
      }
      return existingSelect
        ? existingSelect(...args)
        : { ok: true, mode: "test_fixture", data: [] };
    },
  });
}

function currentReleaseEvidence(
  businessName = "Evidence Roofing",
  city = "Dallas",
  state = "TX",
  sourceWebsite = "https://evidence.example/",
) {
  return {
    schema: RELEASE_EVIDENCE_SCHEMA,
    map: { verified: true, artifact: "screenshots/desktop/map.png" },
    identity: {
      verified: true,
      expected: {
        business_name: businessName,
        city,
        state,
        source_website: sourceWebsite,
      },
      actual: {
        business_name: businessName,
        public_packet_business_name: businessName,
        city,
        public_packet_city: city,
        state,
        public_packet_state: state,
        source_website: sourceWebsite,
        public_packet_source_website: sourceWebsite,
      },
    },
    template_family: { verified: true, expected: { family: "service-map-pins" } },
  };
}

function canonicalTruthPacket({
  businessName = "Fresh Evidence Roofing",
  city = "Dallas",
  state = "TX",
  sourceWebsite = "https://evidence.example/",
  jobId = "compiled-truth-job",
  generationFingerprint = "",
  releaseEvidence = null,
} = {}) {
  return {
    version: "2026-07-28",
    job_id: jobId,
    ...(generationFingerprint ? { generation_fingerprint: generationFingerprint } : {}),
    ...(releaseEvidence ? { release_evidence: releaseEvidence } : {}),
    facts: {
      name: businessName,
      city,
      state,
      current_website: sourceWebsite,
      category: "roofing",
      phone: "214-555-0114",
      address: "100 Fresh Truth Way",
      services: ["Roof replacement", "Storm repair"],
      latlng: { lat: 32.7767, lng: -96.797 },
    },
    assets: [
      { kind: "photo", url: "https://assets.example/fresh-roof.jpg" },
      { kind: "logo", url: "https://assets.example/fresh-logo.svg" },
    ],
    evidence: [
      { field: "name", confidence: 0.99, source_url: "https://evidence.example/about" },
      { field: "services", confidence: 0.96, source_url: "https://evidence.example/services" },
    ],
    trust: {
      review_count: 27,
      reviews: [{ text: "Fresh truth, excellent roof." }],
    },
    optimization: {
      target_queries: ["roof replacement Dallas"],
      seo_gaps: ["Missing storm repair page"],
    },
  };
}

function readySiteForgeResult(releaseEvidence) {
  return {
    configured: true,
    result: { ok: true, status: 200 },
    urls: {
      report_url: "https://siteforge.example/evidence/scorecard.json",
      preview_url: "https://siteforge.example/evidence/",
    },
    payload: { prospect: {} },
    buildStatus: {
      ready: true,
      renderer: "05-build-v8",
      generation_fingerprint: "evidence-roofing-v8",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      grade: "A",
      blocked: [],
    },
    releaseEvidence,
  };
}

function legacyPendingProspect(prospect = {}, jobId) {
  const id = prospectId(prospect);
  const statusUrl = `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`;
  return {
    ...prospect,
    status: "new",
    updated_at: prospect.updated_at || "2026-08-29T00:00:00.000Z",
    record: {
      ...(prospect.record && typeof prospect.record === "object" ? prospect.record : {}),
      prospect_id: id,
      status: "new",
      blocked_reason: "siteforge_build_pending",
      build_dispatch: {
        mode: "http_dispatch",
        ready: false,
        pending: true,
        job_id: jobId,
        status_url: statusUrl,
      },
    },
  };
}

function terminalLegacyStatus(releaseEvidence, jobId) {
  return {
    ...readySiteForgeResult(releaseEvidence),
    mode: "existing_job_status_read",
    jobId,
    statusUrl: `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`,
  };
}

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = value; },
  };
}

test("release evidence extraction accepts only the current SiteForge schema", () => {
  const evidence = currentReleaseEvidence();
  assert.strictEqual(extractReleaseEvidence({ release_evidence: evidence }), evidence);
  assert.strictEqual(extractReleaseEvidence({ data: { releaseEvidence: evidence } }), evidence);
  assert.equal(extractReleaseEvidence({ release_evidence: { ...evidence, schema: "siteforge-release-evidence-v0" } }), null);
  assert.equal(extractReleaseEvidence({ release_evidence: { map: evidence.map } }), null);
  assert.equal(extractReleaseEvidence({ phase_one_evidence: evidence }), null);
});

test("compiled truth extraction reads payload truth and rejects malformed packets", () => {
  const packet = canonicalTruthPacket();
  assert.strictEqual(extractCompiledTruthPacket({ payload: { truth_packet: packet } }), packet);
  assert.equal(
    extractCompiledTruthPacket({ payload: { truth_packet: { facts: {}, assets: {}, evidence: [] } } }),
    null,
  );
  assert.equal(
    extractCompiledTruthPacket({ payload: { truth_packet: { facts: {}, assets: [], evidence: {} } } }),
    null,
  );
});

test("terminal SiteForge status polling surfaces current release evidence in dispatch", async (t) => {
  const evidence = currentReleaseEvidence();
  const previousFetch = global.fetch;
  const previousUrl = process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL;
  process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = "https://siteforge.example/api/ghost-agency/build-preview";
  global.fetch = async () => new Response(JSON.stringify({
    status: "ready",
    pending: false,
    renderer: "05-build-v8",
    generation_fingerprint: "evidence-roofing-v8",
    qc_passed: true,
    visual_qc_passed: true,
    qc_contract: "public-surface-v2",
    preview_url: "https://siteforge.example/evidence/",
    report_url: "https://siteforge.example/evidence/scorecard.json",
    release_evidence: evidence,
  }), { status: 200 });
  t.after(() => {
    global.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL;
    else process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL = previousUrl;
  });

  const dispatch = await dispatchSiteForgePreview({
    prospect: { prospect_id: "evidence-roofing", business_name: "Evidence Roofing", industry: "roofing" },
    job: { id: "evidence-roofing-job", packets: { site: {}, report: {} } },
    resume: {
      job_id: "evidence-roofing-job",
      status_url: "https://siteforge.example/api/ghost-agency/build-preview/evidence-roofing-job",
    },
  });

  assert.equal(dispatch.pending, false);
  assert.equal(dispatch.buildStatus.ready, true);
  assert.deepEqual(dispatch.releaseEvidence, evidence);
});

test("terminal polling persistence keeps release evidence at both durable record paths", async () => {
  const evidence = currentReleaseEvidence();
  const jobId = "poll-persist-evidence-job";
  const writes = [];
  const prospect = legacyPendingProspect({
    prospect_id: "poll-persist-evidence",
    business_name: "Evidence Roofing",
    industry: "roofing",
    city: "Dallas",
    state: "TX",
  }, jobId);
  const result = await buildPreviewForProspect(prospect, {
    source: "siteforge_reconcile",
    truthPacketWithLocalPlan: async () => ({ meta: { source: "intake_genie" } }),
    dispatchSiteForgePreview: async ({ resume }) => {
      assert.deepEqual(resume, {
        job_id: jobId,
        status_url: `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`,
      });
      return terminalLegacyStatus(evidence, jobId);
    },
    conditionalUpdate: async (_table, _key, id, _guards, patch) => {
      const row = { prospect_id: id, ...patch };
      writes.push(row);
      return { mode: "live_update", updated: true, rows: [row] };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.legacy_siteforge_drained, true);
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(result.dispatch.mode, "existing_job_status_read");
  assert.strictEqual(result.release_evidence, evidence);
  assert.strictEqual(result.dispatch.release_evidence, evidence);
  assert.strictEqual(writes[0].record.release_evidence, evidence);
  assert.strictEqual(writes[0].record.siteforge_callback.release_evidence, evidence);
});

test("a terminal legacy job result without evidence clears stale release evidence", async () => {
  const staleEvidence = currentReleaseEvidence();
  const jobId = "fresh-terminal-without-evidence-job";
  const writes = [];
  const prospect = legacyPendingProspect({
    prospect_id: "fresh-build-without-evidence",
    business_name: "Evidence Roofing",
    industry: "roofing",
    city: "Dallas",
    state: "TX",
    release_evidence: staleEvidence,
    record: {
      release_evidence: staleEvidence,
      siteforge_callback: { release_evidence: staleEvidence },
    },
  }, jobId);
  const result = await buildPreviewForProspect(prospect, {
    source: "siteforge_reconcile",
    truthPacketWithLocalPlan: async () => ({ meta: { source: "intake_genie" } }),
    dispatchSiteForgePreview: async ({ resume }) => {
      assert.deepEqual(resume, {
        job_id: jobId,
        status_url: `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`,
      });
      const terminal = terminalLegacyStatus(null, jobId);
      return {
        ...terminal,
        releaseEvidence: null,
        buildStatus: {
          ...terminal.buildStatus,
          generation_fingerprint: "fresh-build-fingerprint",
        },
      };
    },
    conditionalUpdate: async (_table, _key, id, _guards, patch) => {
      const row = { prospect_id: id, ...patch };
      writes.push(row);
      return { mode: "live_update", updated: true, rows: [row] };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.legacy_siteforge_drained, true);
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(result.dispatch.mode, "existing_job_status_read");
  assert.equal(result.release_evidence, null);
  assert.equal(result.prospect.release_evidence, null);
  assert.equal(result.prospect.siteforge_callback.release_evidence, null);
  assert.equal(writes[0].record.release_evidence, null);
  assert.equal(writes[0].record.siteforge_callback.release_evidence, null);
});

test("SiteForge callback persists current release evidence at both durable record paths", async (t) => {
  const evidence = currentReleaseEvidence();
  let writtenRow = null;
  const storePath = require.resolve("../lib/store");
  const webhookPath = require.resolve("../api/webhooks/siteforge");
  const originalStore = require.cache[storePath];
  const originalWebhook = require.cache[webhookPath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      event: async () => ({ ok: true }),
      select: async () => ({
        ok: true,
        data: [{
          prospect_id: "callback-evidence",
          status: "new",
          record: {
            business_name: "Evidence Roofing",
            city: "Dallas",
            state: "TX",
            current_website: "https://evidence.example/",
            build_dispatch: {
              job_id: "callback-evidence-job",
              generation_fingerprint: "callback-evidence-v8",
            },
          },
        }],
      }),
      upsertRow: async (_table, row) => {
        writtenRow = row;
        return { mode: "live_upsert" };
      },
    },
  };
  delete require.cache[webhookPath];
  const webhook = require(webhookPath);
  if (originalStore) require.cache[storePath] = originalStore;
  else delete require.cache[storePath];
  if (originalWebhook) require.cache[webhookPath] = originalWebhook;
  else delete require.cache[webhookPath];

  const previousToken = process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
  process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = "callback-release-evidence-test";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
    else process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = previousToken;
  });

  const res = mockRes();
  await webhook({
    method: "POST",
    headers: { authorization: "Bearer callback-release-evidence-test" },
    body: {
      prospect_id: "callback-evidence",
      job_id: "callback-evidence-job",
      renderer: "05-build-v8",
      generation_fingerprint: "callback-evidence-v8",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      preview_url: "https://siteforge.example/callback-evidence/",
      report_url: "https://siteforge.example/callback-evidence/scorecard.json",
      release_evidence: evidence,
      prospect: {
        business_name: "Evidence Roofing",
        city: "Dallas",
        state: "TX",
        current_website: "https://evidence.example/",
        generation_fingerprint: "callback-evidence-v8",
      },
      payload: {
        truth_packet: canonicalTruthPacket({
          businessName: "Evidence Roofing",
          jobId: "callback-evidence-job",
          generationFingerprint: "callback-evidence-v8",
          releaseEvidence: evidence,
        }),
      },
    },
  }, res);

  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ready, true);
  assert.deepEqual(body.release_evidence, evidence);
  assert.deepEqual(writtenRow.record.release_evidence, evidence);
  assert.deepEqual(writtenRow.record.siteforge_callback.release_evidence, evidence);
});

test("SiteForge callback ignores an older durable job before any prospect write", async (t) => {
  let writtenRow = null;
  const events = [];
  const storePath = require.resolve("../lib/store");
  const webhookPath = require.resolve("../api/webhooks/siteforge");
  const originalStore = require.cache[storePath];
  const originalWebhook = require.cache[webhookPath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      event: async (entry) => {
        events.push(entry);
        return { ok: true };
      },
      select: async () => ({
        ok: true,
        data: [{
          prospect_id: "callback-stale-job",
          status: "new",
          record: {
            build_dispatch: {
              job_id: "siteforge-current-job",
              status_url: "https://siteforge.example/api/ghost-agency/build-preview/siteforge-current-job",
            },
          },
        }],
      }),
      upsertRow: async (_table, row) => {
        writtenRow = row;
        return { mode: "live_upsert" };
      },
    },
  };
  delete require.cache[webhookPath];
  const webhook = require(webhookPath);
  if (originalStore) require.cache[storePath] = originalStore;
  else delete require.cache[storePath];
  if (originalWebhook) require.cache[webhookPath] = originalWebhook;
  else delete require.cache[webhookPath];

  const previousToken = process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
  process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = "callback-stale-job-test";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
    else process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = previousToken;
  });

  const res = mockRes();
  await webhook({
    method: "POST",
    headers: { authorization: "Bearer callback-stale-job-test" },
    body: {
      prospect_id: "callback-stale-job",
      job_id: "siteforge-older-job",
      renderer: "05-build-v8",
      generation_fingerprint: "older-job-fingerprint",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      preview_url: "https://siteforge.example/stale-preview/",
      release_evidence: currentReleaseEvidence(),
      payload: { truth_packet: canonicalTruthPacket() },
    },
  }, res);

  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ignored, true);
  assert.equal(body.reason, "stale_siteforge_job");
  assert.equal(writtenRow, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "siteforge.callback_ignored");
  assert.equal(events[0].payload.reason, "job_id_mismatch");
});

test("SiteForge callback persists fresh compiled truth tied to its generation fingerprint", async (t) => {
  const evidence = currentReleaseEvidence("Fresh Evidence Roofing");
  const packet = canonicalTruthPacket({
    jobId: "callback-fresh-truth-job",
    generationFingerprint: "callback-fresh-truth-v8",
    releaseEvidence: evidence,
  });
  const staleTruth = {
    meta: { source: "intake_genie", generation_fingerprint: "stale-build-v7" },
    identity: { name: { value: "Stale Roofing" } },
  };
  let writtenRow = null;
  const storePath = require.resolve("../lib/store");
  const webhookPath = require.resolve("../api/webhooks/siteforge");
  const originalStore = require.cache[storePath];
  const originalWebhook = require.cache[webhookPath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      event: async () => ({ ok: true }),
      select: async () => ({
        ok: true,
        data: [{
          prospect_id: "callback-fresh-truth",
          status: "new",
          record: {
            business_name: "Fresh Evidence Roofing",
            city: "Dallas",
            state: "TX",
            current_website: "https://evidence.example/",
            build_dispatch: {
              job_id: "callback-fresh-truth-job",
              generation_fingerprint: "callback-fresh-truth-v8",
            },
            truth_packet: staleTruth,
            siteforge_callback: {
              truth_packet_source: "intake_genie",
              truth_packet_generation_fingerprint: "stale-build-v7",
              truth_packet_received_at: "2026-07-27T00:00:00.000Z",
            },
          },
        }],
      }),
      upsertRow: async (_table, row) => {
        writtenRow = row;
        return { mode: "live_upsert" };
      },
    },
  };
  delete require.cache[webhookPath];
  const webhook = require(webhookPath);
  if (originalStore) require.cache[storePath] = originalStore;
  else delete require.cache[storePath];
  if (originalWebhook) require.cache[webhookPath] = originalWebhook;
  else delete require.cache[webhookPath];

  const previousToken = process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
  process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = "callback-fresh-truth-test";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
    else process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = previousToken;
  });

  const res = mockRes();
  await webhook({
    method: "POST",
    headers: { authorization: "Bearer callback-fresh-truth-test" },
    body: {
      prospect_id: "callback-fresh-truth",
      job_id: "callback-fresh-truth-job",
      renderer: "05-build-v8",
      generation_fingerprint: "callback-fresh-truth-v8",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      preview_url: "https://siteforge.example/callback-fresh-truth/",
      report_url: "https://siteforge.example/callback-fresh-truth/scorecard.json",
      release_evidence: evidence,
      prospect: {
        business_name: "Fresh Evidence Roofing",
        city: "Dallas",
        state: "TX",
        current_website: "https://evidence.example/",
        generation_fingerprint: "callback-fresh-truth-v8",
      },
      payload: { truth_packet: packet },
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.notStrictEqual(writtenRow.record.truth_packet, staleTruth);
  assert.deepEqual(writtenRow.record.truth_packet.intakeGenie, packet);
  assert.equal(writtenRow.record.truth_packet.identity.name.value, "Fresh Evidence Roofing");
  assert.deepEqual(writtenRow.record.truth_packet.services, ["Roof replacement", "Storm repair"]);
  assert.equal(writtenRow.record.truth_packet.meta.generation_fingerprint, "callback-fresh-truth-v8");
  assert.equal(writtenRow.record.siteforge_callback.truth_packet_source, "intake_genie");
  assert.equal(
    writtenRow.record.siteforge_callback.truth_packet_generation_fingerprint,
    "callback-fresh-truth-v8",
  );
  assert.match(writtenRow.record.siteforge_callback.truth_packet_received_at, /^\d{4}-\d{2}-\d{2}T/);

  const wrongIdentity = canonicalTruthPacket({
    businessName: "Different Roofing Company",
    jobId: "callback-fresh-truth-job",
    generationFingerprint: "callback-fresh-truth-v8",
    releaseEvidence: evidence,
  });
  writtenRow = null;
  const wrongIdentityRes = mockRes();
  await webhook({
    method: "POST",
    headers: { authorization: "Bearer callback-fresh-truth-test" },
    body: {
      prospect_id: "callback-fresh-truth",
      job_id: "callback-fresh-truth-job",
      renderer: "05-build-v8",
      generation_fingerprint: "callback-fresh-truth-v8",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      preview_url: "https://siteforge.example/callback-fresh-truth/",
      report_url: "https://siteforge.example/callback-fresh-truth/scorecard.json",
      release_evidence: evidence,
      prospect: {
        business_name: "Fresh Evidence Roofing",
        city: "Dallas",
        state: "TX",
        current_website: "https://evidence.example/",
        generation_fingerprint: "callback-fresh-truth-v8",
      },
      payload: { truth_packet: wrongIdentity },
    },
  }, wrongIdentityRes);
  const wrongIdentityBody = JSON.parse(wrongIdentityRes.body);
  assert.equal(wrongIdentityBody.ignored, true);
  assert.equal(wrongIdentityBody.reason, "identity_mismatch");
  assert.equal(writtenRow, null);

  const wrongFingerprint = canonicalTruthPacket({
    jobId: "callback-fresh-truth-job",
    generationFingerprint: "different-build-v9",
    releaseEvidence: evidence,
  });
  writtenRow = null;
  const wrongFingerprintRes = mockRes();
  await webhook({
    method: "POST",
    headers: { authorization: "Bearer callback-fresh-truth-test" },
    body: {
      prospect_id: "callback-fresh-truth",
      job_id: "callback-fresh-truth-job",
      renderer: "05-build-v8",
      generation_fingerprint: "callback-fresh-truth-v8",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      preview_url: "https://siteforge.example/callback-fresh-truth/",
      report_url: "https://siteforge.example/callback-fresh-truth/scorecard.json",
      release_evidence: evidence,
      prospect: {
        business_name: "Fresh Evidence Roofing",
        city: "Dallas",
        state: "TX",
        current_website: "https://evidence.example/",
        generation_fingerprint: "callback-fresh-truth-v8",
      },
      payload: { truth_packet: wrongFingerprint },
    },
  }, wrongFingerprintRes);
  const wrongFingerprintBody = JSON.parse(wrongFingerprintRes.body);
  assert.equal(wrongFingerprintBody.ignored, true);
  assert.equal(wrongFingerprintBody.reason, "generation_fingerprint_mismatch");
  assert.equal(writtenRow, null);
});

test("malformed callback truth preserves the existing packet and truth metadata", async (t) => {
  const evidence = currentReleaseEvidence("Known Good Roofing");
  const existingTruth = {
    meta: { source: "intake_genie", generation_fingerprint: "known-good-v8" },
    identity: { name: { value: "Known Good Roofing" } },
  };
  const existingTruthMetadata = {
    truth_packet_source: "intake_genie",
    truth_packet_generation_fingerprint: "known-good-v8",
    truth_packet_received_at: "2026-07-27T00:00:00.000Z",
  };
  let writtenRow = null;
  const storePath = require.resolve("../lib/store");
  const webhookPath = require.resolve("../api/webhooks/siteforge");
  const originalStore = require.cache[storePath];
  const originalWebhook = require.cache[webhookPath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      event: async () => ({ ok: true }),
      select: async () => ({
        ok: true,
        data: [{
          prospect_id: "callback-malformed-truth",
          status: "new",
          record: {
            business_name: "Known Good Roofing",
            city: "Dallas",
            state: "TX",
            current_website: "https://evidence.example/",
            build_dispatch: {
              job_id: "callback-malformed-truth-job",
              generation_fingerprint: "callback-malformed-truth-v9",
            },
            truth_packet: existingTruth,
            siteforge_callback: existingTruthMetadata,
          },
        }],
      }),
      upsertRow: async (_table, row) => {
        writtenRow = row;
        return { mode: "live_upsert" };
      },
    },
  };
  delete require.cache[webhookPath];
  const webhook = require(webhookPath);
  if (originalStore) require.cache[storePath] = originalStore;
  else delete require.cache[storePath];
  if (originalWebhook) require.cache[webhookPath] = originalWebhook;
  else delete require.cache[webhookPath];

  const previousToken = process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
  process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = "callback-malformed-truth-test";
  t.after(() => {
    if (previousToken === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
    else process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = previousToken;
  });

  const res = mockRes();
  await webhook({
    method: "POST",
    headers: { authorization: "Bearer callback-malformed-truth-test" },
    body: {
      prospect_id: "callback-malformed-truth",
      job_id: "callback-malformed-truth-job",
      renderer: "05-build-v8",
      generation_fingerprint: "callback-malformed-truth-v9",
      qc_passed: true,
      visual_qc_passed: true,
      qc_contract: "public-surface-v2",
      preview_url: "https://siteforge.example/callback-malformed-truth/",
      report_url: "https://siteforge.example/callback-malformed-truth/scorecard.json",
      release_evidence: evidence,
      prospect: {
        business_name: "Known Good Roofing",
        city: "Dallas",
        state: "TX",
        current_website: "https://evidence.example/",
        generation_fingerprint: "callback-malformed-truth-v9",
      },
      payload: {
        // The extractor accepts the outer contract, but conversion rejects the
        // bad asset entry. The webhook must fail closed without any write.
        truth_packet: {
          job_id: "callback-malformed-truth-job",
          generation_fingerprint: "callback-malformed-truth-v9",
          release_evidence: evidence,
          facts: {
            name: "Known Good Roofing",
            city: "Dallas",
            state: "TX",
            current_website: "https://evidence.example/",
          },
          assets: [null],
          evidence: [],
          trust: {},
        },
      },
    },
  }, res);

  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ignored, true);
  assert.equal(body.reason, "truth_packet_invalid");
  assert.equal(writtenRow, null);
});
