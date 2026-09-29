"use strict";

// The build lane may enqueue work, but it may never wait for Google, fail a
// mirror, or spend network in dry/non-persistent modes.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  heroRemasterEnabled,
  enqueueHeroRemasterForBuild,
  buildPreviewForProspect,
} = require("../lib/full-run");
const {
  WAN_PRODUCER,
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
} = require("../lib/hero-video-policy");

const PROSPECT = Object.freeze({
  prospect_id: "wss-test-acme",
  business_name: "Acme Plumbing",
  industry: "plumbing",
  record: Object.freeze({ industry: "plumbing", current_website: "https://acme.example.com/" }),
});

test("hero remaster is hard-default ON with an explicit env kill switch", () => {
  assert.equal(heroRemasterEnabled({}), true);
  for (const off of ["0", "false", "off", "no", "FALSE"]) {
    assert.equal(heroRemasterEnabled({ GHOST_AGENCY_HERO_REMASTER: off }), false, off);
  }
  assert.equal(heroRemasterEnabled({ GHOST_AGENCY_HERO_REMMASTER: "0" }), false,
    "the published work-order spelling remains a supported kill switch");
  assert.equal(heroRemasterEnabled({ GHOST_AGENCY_HERO_AUTOLINE: "0" }), false,
    "the shared autoline kill switch stops full-run enqueue too");
  assert.equal(heroRemasterEnabled({ GHOST_AGENCY_HERO_REMASTER: "1" }), true);
  assert.equal(heroRemasterEnabled({ GHOST_AGENCY_HERO_REMASTER: "true" }), true);
});

test("supported vertical uses the code-default Seedance producer for one durable enqueue", async () => {
  const calls = [];
  const out = await enqueueHeroRemasterForBuild(PROSPECT, {
    env: {},
    enqueueHeroReelJob: async (row, options) => {
      calls.push({ row, options });
      return { ok: true, queued: true, reused: false, job_id: "hrj_1" };
    },
  });
  assert.deepEqual(out, { ok: true, queued: true, reused: false, job_id: "hrj_1", generation_revision: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].row, PROSPECT);
  assert.equal(calls[0].options.actor, "full_run");
  assert.equal(calls[0].options.producer, OPENROUTER_SEEDANCE_PRODUCER);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.ok(Number.isFinite(calls[0].options.deadlineAt));
});

test("Seedance and WAN kill switches route automatic enqueue to Ads", async () => {
  let producer = "";
  const out = await enqueueHeroRemasterForBuild(PROSPECT, {
    env: { GHOST_AGENCY_SEEDANCE_PRIMARY: "0", GHOST_AGENCY_WAN_PRIMARY: "0" },
    enqueueHeroReelJob: async (_row, options) => {
      producer = options.producer;
      return { ok: true, queued: true, job_id: "hrj_ads_kill_switch" };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.queued, true);
  assert.equal(producer, ADS_PRODUCER);
});

test("Seedance accepts a truth-safe owned scene without WAN vertical restrictions", async () => {
  let producer = "";
  const out = await enqueueHeroRemasterForBuild({
    ...PROSPECT,
    industry: "dentistry",
    record: { ...PROSPECT.record, industry: "dentistry" },
  }, {
    env: {},
    enqueueHeroReelJob: async (_row, options) => {
      producer = options.producer;
      return { ok: true, queued: true, job_id: "hrj_ads_unsupported" };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.queued, true);
  assert.equal(producer, OPENROUTER_SEEDANCE_PRODUCER);
});

test("a stalled queue is aborted on a small deadline and remains fail-soft", async () => {
  let aborted = false;
  const started = Date.now();
  const out = await enqueueHeroRemasterForBuild(PROSPECT, {
    env: { GHOST_AGENCY_HERO_ENQUEUE_TIMEOUT_MS: "250" },
    enqueueHeroReelJob: (_row, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true });
    }),
  });
  assert.deepEqual(out, { ok: false, queued: false, reason: "hero_remaster_enqueue_timeout" });
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 750, "the optional hero lane cannot consume the build budget");
});

test("all autoline kill switches, dry run, and persistence-disabled modes perform zero external work", async () => {
  for (const options of [
    { env: { GHOST_AGENCY_HERO_AUTOLINE: "0" } },
    { env: { GHOST_AGENCY_HERO_REMMASTER: "0" } },
    { env: { GHOST_AGENCY_HERO_REMASTER: "0" } },
    { env: {}, dryRun: true },
    { env: {}, persist: false },
  ]) {
    let network = 0;
    const out = await enqueueHeroRemasterForBuild(PROSPECT, {
      ...options,
      enqueueHeroReelJob: async () => { network += 1; throw new Error("network was touched"); },
    });
    assert.equal(out.ok, true);
    assert.equal(out.queued, false);
    assert.equal(network, 0, JSON.stringify(options));
  }
});

test("queue refusal or throw is fail-soft and cannot become a build refusal", async () => {
  const refused = await enqueueHeroRemasterForBuild(PROSPECT, {
    env: {},
    enqueueHeroReelJob: async () => ({ ok: false, error: "queue_down" }),
  });
  assert.deepEqual(refused, { ok: false, queued: false, reason: "queue_down" });

  const crashed = await enqueueHeroRemasterForBuild(PROSPECT, {
    env: {},
    enqueueHeroReelJob: async () => { throw new Error("boom"); },
  });
  assert.deepEqual(crashed, { ok: false, queued: false, reason: "hero_remaster_enqueue_failed" });
});

test("the real preview weld enqueues once before Mirror and a queue crash leaves its verdict unchanged", async () => {
  const durable = {
    prospect_id: "wss-test-weld",
    business_name: "Weld Plumbing",
    email: "owner@weld.example.com",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    status: "new",
    updated_at: "2026-08-21T18:00:00.000Z",
    record: {
      business_name: "Weld Plumbing",
      email: "owner@weld.example.com",
      industry: "plumbing",
      status: "new",
      current_website: "https://weld.example.com/",
      photo_bank: {
        website: "https://weld.example.com/",
        photos: [{ url: "https://weld.example.com/crew.jpg", sha256: "a".repeat(64) }],
      },
      preview_build_consent: {
        status: "granted",
        recorded_at: "2026-08-21T18:00:00.000Z",
        source: "test_fixture",
      },
    },
  };
  const truthPacket = {
    meta: { source: "test_fixture", bounded: true },
    facts: {},
    identity: { category: { value: "plumbing", verified: true } },
  };

  async function run(enqueueHeroReelJob) {
    const order = [];
    const result = await buildPreviewForProspect({
      prospect_id: durable.prospect_id,
      business_name: durable.business_name,
      industry: durable.industry,
      city: durable.city,
      state: durable.state,
      record: {
        current_website: "https://attacker.example/",
        photo_bank: {
          website: "https://attacker.example/",
          photos: [{ url: "https://attacker.example/foreign.jpg", sha256: "b".repeat(64) }],
        },
      },
    }, {
      persist: true,
      env: {},
      select: async () => ({ ok: true, data: [structuredClone(durable)] }),
      conditionalUpdate: async (_table, _idColumn, id, _guards, patch) => ({
        ok: true,
        mode: "live_update",
        updated: true,
        rows: [{ prospect_id: id, ...structuredClone(patch) }],
      }),
      upsertRow: async () => { throw new Error("final Mirror state must use the guarded update"); },
      truthPacketWithLocalPlan: async () => truthPacket,
      enqueueHeroReelJob: async (...args) => {
        order.push("enqueue");
        assert.equal(args[0].record.current_website, "https://weld.example.com/");
        assert.equal(args[0].record.photo_bank.website, "https://weld.example.com/");
        assert.equal(args[0].record.photo_bank.photos[0].sha256, "a".repeat(64),
          "request/build data can never replace the durable photo bank");
        return enqueueHeroReelJob(...args);
      },
      buildMirrorForProspect: async () => {
        order.push("mirror");
        return { ok: false, reason: "fixture_mirror_hold" };
      },
    });
    return { result, order };
  }

  const normal = await run(async () => ({ ok: true, queued: true, job_id: "hrj_weld" }));
  assert.deepEqual(normal.order, ["enqueue", "mirror"]);
  assert.equal(normal.result.blocked, "fixture_mirror_hold");

  const queueCrashed = await run(async () => { throw new Error("queue unavailable"); });
  assert.deepEqual(queueCrashed.order, ["enqueue", "mirror"]);
  assert.equal(queueCrashed.result.blocked, normal.result.blocked,
    "hero queue health cannot alter the mirror verdict");
});

test("new remaster modules have no email, SMS, outreach, or send dependency", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const relative of [
    "lib/hero-reel-job-queue.js",
    "lib/hero-clip-validation.js",
    "api/admin/hero-clip-upload.js",
    "scripts/ads-station/animate-image-runner.cjs",
    "scripts/ads-station/hero-forge-worker.cjs",
  ]) {
    const file = path.join(__dirname, "..", ...relative.split("/"));
    const source = fs.readFileSync(file, "utf8");
    const imports = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);
    for (const imported of imports) {
      assert.doesNotMatch(imported, /email|resend|twilio|sms|outreach|send-sequence|line-adapters/i,
        `${relative} can reach send path ${imported}`);
    }
  }
});
