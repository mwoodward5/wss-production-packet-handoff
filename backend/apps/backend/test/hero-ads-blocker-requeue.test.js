"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const workerModule = require("../scripts/ads-station/hero-forge-worker.cjs");
const lineState = require("../lib/line-state");
const { processRowPhase } = require("../lib/line-runner");

const originalLoad = Module._load;
Module._load = function loadWithLeadMinerStub(request, parent, isMain) {
  if (request === "./lead-miner" && /[\\/]lib[\\/]line-adapters\.js$/.test(parent?.filename || "")) {
    return {
      mineLeads: async () => [],
      resolveBuildableDonor: () => null,
      isPlaceholderEmail: () => false,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { enqueueCompletedLineHero, compactHeroRemaster } = require("../lib/line-adapters");
Module._load = originalLoad;

const SOURCE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const SOURCE_SHA = workerModule.sha256Hex(SOURCE);

test("Google's ad-blocker overlay fails the durable job once for explicit operator retry", async () => {
  const settled = [];
  const uploads = [];
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-ad-blocker-requeue-"));
  const worker = workerModule.createWorker({
    env: {},
    config: { workerToken: "worker-test-token", reviewDir: os.tmpdir() },
    apiImpl: async (pathname, request = {}) => {
      assert.equal(pathname, "/api/admin/hero-reel");
      const body = JSON.parse(request.body);
      settled.push(body);
      return { ok: true, status: 200, body: { ok: true } };
    },
    selector: (candidates) => ({ best: candidates[0] || null }),
    makeWorkDir: async () => workDir,
    downloadImpl: async (candidate, dir) => {
      const filePath = path.join(dir, "source.jpg");
      fs.writeFileSync(filePath, SOURCE);
      return { filePath, bytes: SOURCE.length, sha256: candidate.sha256, ext: ".jpg" };
    },
    renewImpl: async () => ({ ok: true, lease_expires_at: "2099-01-01T00:00:00.000Z" }),
    runnerImpl: async () => ({ verdict: { ok: false, reason: "ads_blocked_by_extension" } }),
    uploadImpl: async (...args) => { uploads.push(args); },
    cleanupImpl: async (dir) => fs.rmSync(dir, { recursive: true, force: true }),
  });

  const result = await worker.processJob({
    job_id: "hrj_ad_blocker",
    lease_token: "lease_ad_blocker",
    producer: "ads_image_to_video",
    prospect_id: "wss-test-ad-blocker",
    source_url: "https://client.example/",
    photo_bank: {
      photos: [{
        url: "https://client.example/work.jpg",
        sha256: SOURCE_SHA,
        source: "own_site",
        found_on: "https://client.example/gallery",
        width: 1920,
        height: 1080,
        bytes: SOURCE.length,
        grade: "hero",
        // This fixture tests the ad-blocker branch, not pixel classification.
        // Give it explicit truth evidence so production remains fail-closed.
        no_people: true,
      }],
    },
  });

  assert.deepEqual(result, {
    status: "failed",
    reason: "ads_blocked_by_extension",
  });
  assert.equal(settled.length, 1);
  assert.deepEqual(settled[0], {
    job_id: "hrj_ad_blocker",
    action: "fail",
    lease_token: "lease_ad_blocker",
    verdict: { ok: false, reason: "ads_blocked_by_extension" },
  });
  assert.equal(uploads.length, 0, "a blocked page never uploads a clip");
  assert.equal(fs.existsSync(workDir), false, "temporary source bytes are cleaned up");
});

test("the exact Ads blocker failure becomes a safe pending Line hold with no email or hot loop", async () => {
  const current = {
    business_name: "Client Plumbing",
    current_website: "https://client.example/",
  };
  const record = {
    business_name: current.business_name,
    current_website: current.current_website,
    photo_bank: {
      photos: [{
        url: "https://client.example/work.jpg",
        sha256: SOURCE_SHA,
        source: "own_site",
        found_on: "https://client.example/gallery",
      }],
    },
  };
  let row = lineState.newRow({
    prospectId: "wss-test-ad-blocker",
    businessName: current.business_name,
    city: "Tulsa",
    state: "OK",
    vertical: "plumbing",
    email: "owner@client.example",
    now: "2026-08-22T20:00:00.000Z",
  });
  row = lineState.advanceRow(row, "qualified", { now: "2026-08-22T20:00:01.000Z" }).row;
  row = { ...row, rowId: "line_ads_blocker:0", batchId: "line_ads_blocker" };

  const observed = await enqueueCompletedLineHero(row, current, record, {
    env: {},
    batchId: row.batchId,
    enqueueHeroRemasterForBuild: async () => ({
      ok: true,
      queued: false,
      job_id: "hrj_ad_blocker",
      producer: "ads_image_to_video",
    }),
    getHeroReelJobForProspect: async () => ({
      ok: true,
      job: {
        jobId: "hrj_ad_blocker",
        status: "failed",
        producer: "ads_image_to_video",
        result: { reason: "ads_blocked_by_extension" },
      },
    }),
  });
  const marker = compactHeroRemaster(observed);

  assert.equal(observed.pending, true);
  assert.equal(observed.hold, undefined);
  assert.equal(observed.status, "operator_action_required");
  assert.equal(observed.reason, "ads_blocked_by_extension");
  assert.equal(observed.producer, "ads_image_to_video");
  assert.equal(marker.pending, true);
  assert.equal(marker.hold, false);
  assert.equal(marker.status, "operator_action_required");
  assert.equal(marker.producer, "ads_image_to_video");

  let emails = 0;
  const out = await processRowPhase(row, { batchId: row.batchId }, {
    mirror: async () => ({
      ok: false,
      heroRemasterPending: true,
      reason: observed.reason,
      heroRemaster: marker,
    }),
    queueEmail: async () => { emails += 1; return { ok: true }; },
    now: () => "2026-08-22T20:00:02.000Z",
  });

  assert.equal(out.ok, true);
  assert.equal(out.complete, true, "this invocation stops instead of retrying the failed job");
  assert.equal(out.phase, "hero_remaster");
  assert.equal(out.row.status, "qualified");
  assert.equal(out.row.reason, "");
  assert.equal(out.row.heroRemaster.status, "operator_action_required");
  assert.equal(out.row.heroRemaster.pending, true);
  assert.match(out.row.buildRetryAfter, /^2026-08-22T20:/);
  assert.equal(emails, 0);
});

test("other provider failures remain terminal holds", async () => {
  const observed = await enqueueCompletedLineHero({
    prospectId: "wss-test-provider-failure",
    businessName: "Client Plumbing",
    rowId: "line_provider_failure:0",
    batchId: "line_provider_failure",
  }, { business_name: "Client Plumbing" }, {
    business_name: "Client Plumbing",
    photo_bank: { photos: [{ url: "https://client.example/work.jpg" }] },
  }, {
    env: {},
    enqueueHeroRemasterForBuild: async () => ({ ok: true, job_id: "hrj_provider_failure" }),
    getHeroReelJobForProspect: async () => ({
      ok: true,
      job: {
        jobId: "hrj_provider_failure",
        status: "failed",
        producer: "viddo",
        result: { reason: "provider_timeout" },
      },
    }),
  });

  assert.equal(observed.pending, undefined);
  assert.equal(observed.hold, true);
  assert.equal(observed.status, "failed");
  assert.equal(observed.reason, "provider_timeout");
});

test("a retired-Ads producer failure ships the donor rung (nothing will ever retry it)", async () => {
  // 2026-08-28 reconcile with #463: the ads_image_to_video producer is retired,
  // so even a non-refusal failure on it is a definitive dead lane. The owner's
  // 2026-08-23 decree — a missing hero video is a missing garnish, not a
  // broken plate — ships the mirror on the donor rung instead of parking the
  // row on a hold no operator lane can ever clear.
  const observed = await enqueueCompletedLineHero({
    prospectId: "wss-test-provider-failure",
    businessName: "Client Plumbing",
    rowId: "line_provider_failure:0",
    batchId: "line_provider_failure",
  }, { business_name: "Client Plumbing" }, {
    business_name: "Client Plumbing",
    photo_bank: { photos: [{ url: "https://client.example/work.jpg" }] },
  }, {
    env: {},
    enqueueHeroRemasterForBuild: async () => ({ ok: true, job_id: "hrj_provider_failure" }),
    getHeroReelJobForProspect: async () => ({
      ok: true,
      job: {
        jobId: "hrj_provider_failure",
        status: "failed",
        producer: "ads_image_to_video",
        result: { reason: "provider_timeout" },
      },
    }),
  });

  assert.equal(observed.pending, undefined);
  assert.equal(observed.hold, undefined);
  assert.equal(observed.required, false);
  assert.equal(observed.ready, true);
  assert.equal(observed.fallback, true);
  assert.equal(observed.producer, "ads_image_to_video");
});
