"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = value; },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function releaseEvidence() {
  return {
    schema: "siteforge-release-evidence-v1",
    map: { verified: true },
    identity: {
      verified: true,
      expected: {
        business_name: "Bound Roofing",
        city: "Dallas",
        state: "TX",
        source_website: "https://bound-roofing.test/",
      },
      actual: {
        business_name: "Bound Roofing",
        public_packet_business_name: "Bound Roofing",
        city: "Dallas",
        public_packet_city: "Dallas",
        state: "TX",
        public_packet_state: "TX",
        source_website: "https://www.bound-roofing.test/about",
        public_packet_source_website: "bound-roofing.test",
      },
    },
    template_family: { verified: true },
  };
}

function truthPacket(evidence = releaseEvidence()) {
  return {
    version: "2026-07-28",
    generation_fingerprint: "bound-roofing-generation-v8",
    facts: {
      name: "Bound Roofing",
      city: "Dallas",
      state: "TX",
      current_website: "https://bound-roofing.test/",
      services: ["Roof repair"],
    },
    assets: [{ kind: "logo", url: "https://bound-roofing.test/logo.svg" }],
    evidence: [{ field: "name", source_url: "https://bound-roofing.test/about" }],
    release_evidence: evidence,
  };
}

function callbackBody() {
  const evidence = releaseEvidence();
  return {
    prospect_id: "bound-roofing",
    job_id: "siteforge-active-job",
    renderer: "05-build-v8",
    generation_fingerprint: "bound-roofing-generation-v8",
    qc_passed: true,
    visual_qc_passed: true,
    qc_contract: "public-surface-v2",
    preview_url: "https://bound-roofing.wss-ai.com/",
    report_url: "https://bound-roofing.wss-ai.com/scorecard.json",
    release_evidence: evidence,
    prospect: {
      prospect_id: "bound-roofing",
      business_name: "Bound Roofing",
      city: "Dallas",
      state: "TX",
      current_website: "https://bound-roofing.test/",
      generation_fingerprint: "bound-roofing-generation-v8",
    },
    truth_packet: truthPacket(evidence),
  };
}

function durableRecord() {
  return {
    business_name: "Bound Roofing",
    city: "Dallas",
    state: "TX",
    current_website: "https://bound-roofing.test/",
    email: "owner@bound-roofing.test",
    phone: "214-555-0100",
    preview_url: "https://known-good.wss-ai.com/",
    report_url: "https://known-good.wss-ai.com/scorecard.json",
    release_evidence: { schema: "known-good-release" },
    truth_packet: {
      meta: { generation_fingerprint: "known-good-generation" },
      identity: { name: { value: "Bound Roofing" } },
    },
    build_dispatch: {
      pending: true,
      job_id: "siteforge-active-job",
      status_url: "https://siteforge.example/api/ghost-agency/build-preview/siteforge-active-job",
    },
    siteforge_callback: {
      generation_fingerprint: "known-good-generation",
      received_at: "2026-07-27T00:00:00.000Z",
    },
    private_owner_note: "must survive rejected callbacks",
  };
}

test("SiteForge callback requires a fully bound active build before any prospect mutation", async (t) => {
  const storePath = require.resolve("../lib/store");
  const webhookPath = require.resolve("../api/webhooks/siteforge");
  const originalStore = require.cache[storePath];
  const originalWebhook = require.cache[webhookPath];
  const previousToken = process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
  let currentRecord = durableRecord();
  const writes = [];
  const events = [];

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
          prospect_id: "bound-roofing",
          status: "new",
          preview_url: currentRecord.preview_url,
          report_url: currentRecord.report_url,
          record: currentRecord,
        }],
      }),
      upsertRow: async (_table, row) => {
        writes.push(row);
        return { mode: "live_upsert" };
      },
    },
  };
  delete require.cache[webhookPath];
  const webhook = require(webhookPath);
  process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = "siteforge-binding-test-token";

  t.after(() => {
    if (originalStore) require.cache[storePath] = originalStore;
    else delete require.cache[storePath];
    if (originalWebhook) require.cache[webhookPath] = originalWebhook;
    else delete require.cache[webhookPath];
    if (previousToken === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
    else process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = previousToken;
  });

  async function invoke(body) {
    const before = clone(currentRecord);
    const res = mockRes();
    await webhook({
      method: "POST",
      headers: { authorization: "Bearer siteforge-binding-test-token" },
      body,
    }, res);
    return { before, res, response: JSON.parse(res.body) };
  }

  const noActiveJob = durableRecord();
  delete noActiveJob.build_dispatch;
  currentRecord = noActiveJob;
  const missingActive = await invoke(callbackBody());
  assert.equal(missingActive.res.statusCode, 200);
  assert.equal(missingActive.response.ignored, true);
  assert.equal(missingActive.response.reason, "missing_active_siteforge_job");
  assert.equal(writes.length, 0);
  assert.deepEqual(currentRecord, missingActive.before);

  currentRecord = durableRecord();
  const wrongIdentityBody = callbackBody();
  wrongIdentityBody.truth_packet.facts.name = "Other Roofing Company";
  const wrongIdentity = await invoke(wrongIdentityBody);
  assert.equal(wrongIdentity.response.ignored, true);
  assert.equal(wrongIdentity.response.reason, "identity_mismatch");
  assert.equal(writes.length, 0);
  assert.deepEqual(currentRecord, wrongIdentity.before);

  currentRecord = durableRecord();
  const wrongLocationBody = callbackBody();
  wrongLocationBody.truth_packet.facts.city = "Austin";
  const wrongLocation = await invoke(wrongLocationBody);
  assert.equal(wrongLocation.response.ignored, true);
  assert.equal(wrongLocation.response.reason, "location_mismatch");
  assert.equal(writes.length, 0);
  assert.deepEqual(currentRecord, wrongLocation.before);

  currentRecord = durableRecord();
  const wrongSourceBody = callbackBody();
  wrongSourceBody.truth_packet.facts.current_website = "https://unrelated-roofer.test/";
  const wrongSource = await invoke(wrongSourceBody);
  assert.equal(wrongSource.response.ignored, true);
  assert.equal(wrongSource.response.reason, "source_host_mismatch");
  assert.equal(writes.length, 0);
  assert.deepEqual(currentRecord, wrongSource.before);

  currentRecord = durableRecord();
  const wrongFingerprintBody = callbackBody();
  wrongFingerprintBody.truth_packet.generation_fingerprint = "different-generation-v9";
  const wrongFingerprint = await invoke(wrongFingerprintBody);
  assert.equal(wrongFingerprint.response.ignored, true);
  assert.equal(wrongFingerprint.response.reason, "generation_fingerprint_mismatch");
  assert.equal(writes.length, 0);
  assert.deepEqual(currentRecord, wrongFingerprint.before);

  assert.deepEqual(
    events.map((entry) => entry.payload.reason),
    [
      "active_job_missing",
      "identity_mismatch",
      "location_mismatch",
      "source_host_mismatch",
      "generation_fingerprint_mismatch",
    ],
  );

  currentRecord = durableRecord();
  const accepted = await invoke(callbackBody());
  assert.equal(accepted.response.ignored, undefined);
  assert.equal(accepted.response.ready, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].record.preview_url, "https://bound-roofing.wss-ai.com/");
  assert.equal(
    writes[0].record.truth_packet.meta.generation_fingerprint,
    "bound-roofing-generation-v8",
  );
});
