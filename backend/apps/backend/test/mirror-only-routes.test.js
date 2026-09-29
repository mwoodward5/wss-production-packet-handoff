"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    end(value = "") { this.body = value; },
  };
}

function responseJson(res) {
  return res.body ? JSON.parse(res.body) : {};
}

function restoreCached(path, prior) {
  if (prior) require.cache[path] = prior;
  else delete require.cache[path];
}

test("Forge route is read-only for fresh work and names Mirror Engine as the replacement", async (t) => {
  const priorToken = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "mirror-only-route-test";
  t.after(() => {
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = priorToken;
  });

  const handler = require("../api/admin/forge-jobs");
  const res = mockRes();
  await handler({
    method: "POST",
    headers: { "x-admin-token": "mirror-only-route-test" },
    body: {
      action: "start",
      prospect_id: "must-not-be-created",
      business_name: "Fresh Build",
      phone: "555-0100",
      city: "Dallas",
      state: "TX",
      boilerplate: "roofing-riseabove",
      project_name: "must-not-be-created",
    },
  }, res);

  assert.equal(res.statusCode, 410);
  assert.deepEqual(responseJson(res), {
    ok: false,
    error: "fresh_forge_builds_disabled_mirror_engine_only",
    replacement_lane: "mirror-engine",
  });

  const readRes = mockRes();
  await handler({
    method: "GET",
    headers: { "x-admin-token": "mirror-only-route-test" },
    query: {},
  }, readRes);
  assert.equal(readRes.statusCode, 200);
  assert.equal(responseJson(readRes).mode, "legacy_drain_read_only");
  assert.equal(responseJson(readRes).fresh_builds_enabled, false);
});

test("Forge advance recognizes only complete persisted legacy envelopes", () => {
  const { isLegacyDrainJob } = require("../api/admin/forge-jobs");
  assert.equal(isLegacyDrainJob(null), false);
  assert.equal(isLegacyDrainJob({ stage: "dossier", input: {} }), false);
  assert.equal(isLegacyDrainJob({
    stage: "dossier",
    startedAt: "2026-08-01T12:00:00.000Z",
    input: { project_name: "known-legacy" },
  }), true);
  assert.equal(isLegacyDrainJob({
    stage: "invented",
    startedAt: "2026-08-01T12:00:00.000Z",
    input: { project_name: "not-a-real-stage" },
  }), false);
});

test("SiteForge cron drains durable pending jobs but starts zero fresh jobs", async () => {
  const cron = require("../api/cron/siteforge-reconcile");
  const { CANONICAL_SITEFORGE_BUILD_URL } = require("../lib/siteforge");
  const calls = { build: [], insert: 0, selects: [] };
  const pendingRow = {
    prospect_id: "legacy-pending-one",
    status: "new",
    record: {
      prospect_id: "legacy-pending-one",
      status: "new",
      blocked_reason: "siteforge_build_pending",
      build_dispatch: {
        pending: true,
        job_id: "legacy-job-one",
        status_url: `${CANONICAL_SITEFORGE_BUILD_URL}/legacy-job-one`,
      },
    },
  };

  const handler = cron.createSiteForgeReconcileHandler({
    requireCron: () => true,
    select: async (table, query = "") => {
      calls.selects.push({ table, query });
      if (table !== "ghost_agency_prospects") {
        throw new Error(`fresh side-door table read: ${table}`);
      }
      if (String(query).includes("record->build_dispatch->>pending=eq.true")) {
        return { ok: true, data: [pendingRow] };
      }
      if (String(query).includes("status=eq.previewed")) return { ok: true, data: [] };
      throw new Error(`unexpected query: ${query}`);
    },
    insertRow: async () => {
      calls.insert += 1;
      throw new Error("fresh claim must never be inserted");
    },
    event: async () => ({ ok: true }),
    buildPreviewForProspect: async (prospect, options) => {
      calls.build.push({ prospect, options });
      return {
        ok: false,
        pending: true,
        status: "new",
        prospect_id: prospect.prospect_id,
        blocked: "siteforge_build_pending",
        persistence: "live_upsert",
      };
    },
    dispatchSiteForgePreview: async () => ({ pending: true }),
  });

  const res = mockRes();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  const body = responseJson(res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.build.length, 1, "only the stored pending job is drained");
  assert.equal(calls.build[0].prospect.prospect_id, "legacy-pending-one");
  assert.equal(calls.build[0].options.source, "siteforge_reconcile");
  assert.equal(calls.insert, 0, "no supervised fresh-build claim is created");
  assert.equal(calls.selects.some((call) => call.table === "ghost_agency_supervision_holds"), false);
  assert.deepEqual(body.supervised, {
    started: false,
    skipped: "fresh_siteforge_builds_disabled_mirror_engine_only",
  });
});

test("SiteForge callback ignores a stored job after it is no longer pending", async (t) => {
  const storePath = require.resolve("../lib/store");
  const webhookPath = require.resolve("../api/webhooks/siteforge");
  const priorStore = require.cache[storePath];
  const priorWebhook = require.cache[webhookPath];
  const priorToken = process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
  const writes = [];
  const events = [];

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      event: async (entry) => { events.push(entry); return { ok: true }; },
      select: async () => ({
        ok: true,
        data: [{
          prospect_id: "settled-legacy",
          status: "previewed",
          record: {
            prospect_id: "settled-legacy",
            build_dispatch: {
              pending: false,
              ready: true,
              job_id: "settled-job",
              status_url: "https://siteforge.example/api/ghost-agency/build-preview/settled-job",
            },
          },
        }],
      }),
      upsertRow: async (...args) => { writes.push(args); return { mode: "live_upsert" }; },
    },
  };
  delete require.cache[webhookPath];
  process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = "settled-callback-test";
  t.after(() => {
    restoreCached(storePath, priorStore);
    restoreCached(webhookPath, priorWebhook);
    if (priorToken === undefined) delete process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN;
    else process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = priorToken;
  });

  const webhook = require(webhookPath);
  const res = mockRes();
  await webhook({
    method: "POST",
    headers: { authorization: "Bearer settled-callback-test" },
    body: { prospect_id: "settled-legacy", job_id: "settled-job" },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(responseJson(res).ignored, true);
  assert.equal(responseJson(res).reason, "siteforge_job_not_pending");
  assert.equal(writes.length, 0);
  assert.equal(events[0].type, "siteforge.callback_ignored");
  assert.equal(events[0].payload.reason, "active_job_not_pending");
});

test("known pending callback identity requires an HTTPS status handle bound to the same job", () => {
  const { isKnownPendingLegacyJob } = require("../api/webhooks/siteforge");
  assert.equal(isKnownPendingLegacyJob({
    build_dispatch: {
      pending: true,
      job_id: "legacy-bound-job",
      status_url: "https://siteforge.example/api/build/legacy-bound-job",
    },
  }), true);
  assert.equal(isKnownPendingLegacyJob({
    build_dispatch: {
      pending: false,
      job_id: "legacy-bound-job",
      status_url: "https://siteforge.example/api/build/legacy-bound-job",
    },
  }), false);
  assert.equal(isKnownPendingLegacyJob({
    status: "new",
    build_dispatch: {
      job_id: "legacy-pre-pending-field",
      generation_fingerprint: "legacy-pre-pending-fingerprint",
    },
  }), true);
  assert.equal(isKnownPendingLegacyJob({
    status: "previewed",
    build_dispatch: {
      job_id: "legacy-already-finished",
      generation_fingerprint: "legacy-finished-fingerprint",
    },
  }), false);
  assert.equal(isKnownPendingLegacyJob({
    build_dispatch: {
      pending: true,
      job_id: "legacy-bound-job",
      status_url: "https://siteforge.example/api/build/another-job",
    },
  }), false);
  assert.equal(isKnownPendingLegacyJob({
    build_dispatch: {
      pending: true,
      job_id: "legacy-bound-job",
      status_url: "http://siteforge.example/api/build/legacy-bound-job",
    },
  }), false);
});
