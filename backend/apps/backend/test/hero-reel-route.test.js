"use strict";

/**
 * test/hero-reel-route.test.js
 *
 * The operator's button for the couture hero rung: POST composes + uploads +
 * patches, GET answers "does this prospect's reel ride?". The tests pin what
 * makes the route safe to point at a live fleet:
 *
 *   · admin token required on both methods, GET/POST only;
 *   · a refusal carries the runner's own reason — "ffmpeg_unavailable" (wrong
 *     host) and "need_at_least_two_photos" (wrong lead) are different facts;
 *   · a reused reel never re-patches the record;
 *   · a composed-but-unpatched reel is reported, never silently lost;
 *   · the route's dependency list contains no send path.
 *
 * Auth/req/res harness copied from test/rebuild-mirror-route.test.js — the
 * conventions this route clones.
 *
 * 2026-08-22: bare POSTs now use the producer policy: WAN for supported row
 * verticals, Ads when WAN-primary is off or the vertical is unsupported. The
 * ffmpeg compose lane below remains explicit opt-in — hence `producer: LEGACY`
 * on every compose-path body here. Durable queue selection is pinned in
 * test/hero-reel-ads-lane.test.js.
 */

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { createHeroReelHandler } = require("../api/admin/hero-reel");

const LEGACY = "hero_compose_local";

function res() {
  const captured = { status: 0, body: null, headers: {} };
  return {
    captured,
    statusCode: 200,
    setHeader(k, v) { captured.headers[k] = v; },
    end(payload) {
      captured.status = this.statusCode;
      try { captured.body = JSON.parse(payload); } catch { captured.body = payload; }
    },
    writeHead(code) { this.statusCode = code; return this; },
  };
}

function req({
  method = "POST",
  token = "test-admin-token",
  workerToken = "",
  body = {},
  url = "/api/admin/hero-reel",
} = {}) {
  const text = JSON.stringify(body);
  return {
    method,
    url,
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": "application/json",
      ...(workerToken ? { "x-ghost-hero-worker-token": workerToken } : {}),
    },
    on(event, cb) {
      if (event === "data") cb(Buffer.from(text));
      if (event === "end") cb();
      return this;
    },
    setEncoding() { return this; },
  };
}

const REEL_OUT = {
  ok: true,
  url: "https://sb.example.co/storage/v1/object/public/wss-proof-assets/wss-test-acme/hero-reel.mp4",
  composed_from: ["sha-a", "sha-b", "sha-c"],
  generator: "hero_compose_local",
  composed_at: "2026-08-20T12:00:00Z",
  bytes: 512000,
};

const ROW = {
  ok: true,
  data: [{
    prospect_id: "wss-test-acme",
    business_name: "Acme Fencing",
    industry: "fencing",
    record: { media_bank: { hero_reel: { url: REEL_OUT.url, generator: "hero_compose_local", composed_from: ["sha-a"] } } },
  }],
};

const BARE_ROW = {
  ok: true,
  data: [{ prospect_id: "wss-test-bare", business_name: "Bare Concrete", industry: "concrete", record: {} }],
};

function handlerWith(overrides = {}) {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  process.env.GHOST_AGENCY_HERO_WORKER_TOKEN = "test-worker-token";
  return createHeroReelHandler({
    ensureHeroReel: overrides.ensureHeroReel || (async () => REEL_OUT),
    patchHeroReel: overrides.patchHeroReel || (async () => ({ ok: true })),
    select: overrides.select || (async () => ROW),
    claimNextHeroReelJob: overrides.claimNextHeroReelJob,
  });
}

test("worker claims forward the exact WAN or Ads producer to the durable queue", async () => {
  const claims = [];
  const handler = handlerWith({
    claimNextHeroReelJob: async (input) => {
      claims.push(input);
      return { ok: true, job: null };
    },
  });

  for (const [workerId, producer] of [
    ["wan-worker", "wan2_i2v_local"],
    ["ads-worker", "ads_image_to_video"],
  ]) {
    const r = res();
    await handler(req({
      method: "GET",
      token: "",
      workerToken: "test-worker-token",
      url: `/api/admin/hero-reel?next=1&worker_id=${workerId}&producer=${producer}`,
    }), r);
    assert.equal(r.captured.status, 200);
  }

  assert.deepEqual(claims, [
    { workerId: "wan-worker", producer: "wan2_i2v_local" },
    { workerId: "ads-worker", producer: "ads_image_to_video" },
  ]);
});

test("an old producer-less worker claim stays Ads-scoped", async () => {
  const claims = [];
  const handler = handlerWith({
    claimNextHeroReelJob: async (input) => {
      claims.push(input);
      return { ok: true, job: null };
    },
  });
  const r = res();
  await handler(req({
    method: "GET",
    token: "",
    workerToken: "test-worker-token",
    url: "/api/admin/hero-reel?next=1&worker_id=old-ads-worker",
  }), r);
  assert.equal(r.captured.status, 200);
  assert.deepEqual(claims, [{ workerId: "old-ads-worker", producer: "ads_image_to_video" }]);
});

test("generic static-worker GET cannot claim Seedance jobs", async () => {
  const claims = [];
  const handler = handlerWith({
    claimNextHeroReelJob: async (input) => {
      claims.push(input);
      return { ok: true, job: null };
    },
  });
  const r = res();
  await handler(req({
    method: "GET",
    token: "",
    workerToken: "test-worker-token",
    url: "/api/admin/hero-reel?next=1&worker_id=legacy-seedance&producer=openrouter_seedance",
  }), r);
  assert.equal(r.captured.status, 403);
  assert.deepEqual(r.captured.body, { ok: false, error: "seedance_capability_required" });
  assert.deepEqual(claims, [], "the broad queue claim must not run");
});

test("worker claims refuse unknown and non-durable producers before the queue", async () => {
  const claims = [];
  const handler = handlerWith({
    claimNextHeroReelJob: async (input) => {
      claims.push(input);
      return { ok: true, job: null };
    },
  });

  for (const producer of ["veo_vibes", LEGACY]) {
    const r = res();
    await handler(req({
      method: "GET",
      token: "",
      workerToken: "test-worker-token",
      url: `/api/admin/hero-reel?next=1&worker_id=wrong-worker&producer=${producer}`,
    }), r);
    assert.equal(r.captured.status, 400);
    assert.equal(r.captured.body.error, "unknown_producer");
    assert.deepEqual(r.captured.body.allowed, ["wan2_i2v_local", "ads_image_to_video", "openrouter_seedance"]);
  }
  assert.deepEqual(claims, []);
});

test("no admin token, no reel work", async () => {
  let composed = 0;
  const handler = handlerWith({ ensureHeroReel: async () => { composed += 1; return REEL_OUT; } });
  const r = res();
  await handler(req({ token: "", body: { prospect_id: "wss-test-acme" } }), r);
  assert.equal(r.captured.status, 401);
  assert.equal(composed, 0, "an unauthorised caller must never reach the composer");
});

test("PUT is refused — only the trigger and the state read exist", async () => {
  const handler = handlerWith();
  const r = res();
  await handler(req({ method: "PUT", body: { prospect_id: "wss-test-acme" } }), r);
  assert.equal(r.captured.status, 405);
});

test("POST without a prospect_id is a 400; an unknown prospect is a 404", async () => {
  const handler = handlerWith({ select: async () => ({ ok: true, data: [] }) });
  const missing = res();
  await handler(req({ body: {} }), missing);
  assert.equal(missing.captured.status, 400);
  assert.equal(missing.captured.body.error, "missing_prospect_id");

  const gone = res();
  await handler(req({ body: { prospect_id: "nobody" } }), gone);
  assert.equal(gone.captured.status, 404);
  assert.equal(gone.captured.body.error, "prospect_not_found");
});

test("a fresh compose answers with the reel AND patches the record", async () => {
  const patches = [];
  const handler = handlerWith({
    select: async () => BARE_ROW,
    ensureHeroReel: async (row, opts) => {
      assert.equal(row.prospect_id, "wss-test-bare", "the runner receives the ROW, not just an id");
      assert.equal(opts.force, false);
      return REEL_OUT;
    },
    patchHeroReel: async (id, reel) => { patches.push({ id, reel }); return { ok: true }; },
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-bare", producer: LEGACY } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.ok, true);
  assert.equal(r.captured.body.url, REEL_OUT.url);
  assert.deepEqual(r.captured.body.composed_from, REEL_OUT.composed_from);
  assert.equal(r.captured.body.patched, true);
  assert.equal(r.captured.body.business_name, "Bare Concrete");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "wss-test-bare");
  assert.equal(patches[0].reel.url, REEL_OUT.url);
});

test("the runner's refusal rides verbatim — ffmpeg_unavailable is the lambda's honest answer", async () => {
  let patched = 0;
  const handler = handlerWith({
    ensureHeroReel: async () => ({ ok: false, reason: "ffmpeg_unavailable" }),
    patchHeroReel: async () => { patched += 1; return { ok: true }; },
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-acme", producer: LEGACY } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.ok, false);
  assert.equal(r.captured.body.reason, "ffmpeg_unavailable");
  assert.equal(patched, 0, "a refusal must never touch the record");
});

test("wrong-lead refusals keep their own sentence too", async () => {
  const handler = handlerWith({
    ensureHeroReel: async () => ({ ok: false, reason: "need_at_least_two_photos", detail: "have:1" }),
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-acme", producer: LEGACY } }), r);
  assert.equal(r.captured.body.reason, "need_at_least_two_photos");
  assert.equal(r.captured.body.detail, "have:1");
});

test("a reused reel answers ok without re-patching the record", async () => {
  let patched = 0;
  const handler = handlerWith({
    ensureHeroReel: async () => ({ ...REEL_OUT, reused: true }),
    patchHeroReel: async () => { patched += 1; return { ok: true }; },
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-acme", producer: LEGACY } }), r);
  assert.equal(r.captured.body.ok, true);
  assert.equal(r.captured.body.reused, true);
  assert.equal(r.captured.body.patched, false);
  assert.equal(patched, 0, "re-patching an unchanged reel would only churn updated_at");
});

test("a composed reel whose patch fails is reported, never silently lost", async () => {
  const handler = handlerWith({
    select: async () => BARE_ROW,
    patchHeroReel: async () => ({ ok: false, reason: "persist_failed" }),
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-bare", producer: LEGACY } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.ok, false);
  assert.equal(r.captured.body.reason, "patch_failed:persist_failed");
  assert.equal(r.captured.body.url, REEL_OUT.url, "the upload happened — the operator keeps the URL");
  assert.equal(r.captured.body.patched, false);
});

test("force is forwarded so an operator can re-compose past a stale reel", async () => {
  const forces = [];
  const handler = handlerWith({
    ensureHeroReel: async (row, opts) => { forces.push(opts.force); return REEL_OUT; },
  });
  await handler(req({ body: { prospect_id: "wss-test-acme", producer: LEGACY, force: true } }), res());
  assert.deepEqual(forces, [true]);
});

test("GET answers the one operator question: what reel, and does it ride", async () => {
  const handler = handlerWith();

  const denied = res();
  await handler(req({ method: "GET", token: "", url: "/api/admin/hero-reel?prospect_id=wss-test-acme" }), denied);
  assert.equal(denied.captured.status, 401);

  const missing = res();
  await handler(req({ method: "GET", url: "/api/admin/hero-reel" }), missing);
  assert.equal(missing.captured.status, 400);
  assert.equal(missing.captured.body.error, "prospect_id_required");

  const withReel = res();
  await handler(req({ method: "GET", url: "/api/admin/hero-reel?prospect_id=wss-test-acme" }), withReel);
  assert.equal(withReel.captured.status, 200);
  assert.equal(withReel.captured.body.ok, true);
  assert.equal(withReel.captured.body.hero_reel.url, REEL_OUT.url);
  assert.equal(withReel.captured.body.rides, true, "this reel passes heroReelBlock's three gates");

  const bare = handlerWith({ select: async () => BARE_ROW });
  const withoutReel = res();
  await bare(req({ method: "GET", url: "/api/admin/hero-reel?prospect_id=wss-test-bare" }), withoutReel);
  assert.equal(withoutReel.captured.body.hero_reel, null);
  assert.equal(withoutReel.captured.body.rides, false);
});

test("the route's dependency list contains no send path and no build lane", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "hero-reel.js"), "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const dep of requires) {
    assert.ok(
      !/email|resend|twilio|sms|autosend|outreach|line-adapters|full-run/i.test(dep),
      `the hero-reel route must not be able to reach ${dep}`,
    );
  }
  assert.deepEqual(
    requires.sort(),
    [
      "../../lib/admin-auth",
      "../../lib/hero-reel-job-queue",
      "../../lib/hero-reel-runner",
      "../../lib/hero-video-policy",
      "../../lib/hero-worker-auth",
      "../../lib/http",
      "../../lib/prospects",
      "../../lib/store",
    ],
  );
});
