"use strict";

/**
 * test/hero-reel-ads-lane.test.js — producer-aware admin route shared by
 * Ads and WAN.
 *
 * FULLY STUBBED: no browser, no Supabase, no ffmpeg, no child process.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createHeroReelHandler } = require("../api/admin/hero-reel");


// ---------------------------------------------------------------------------
// THE ROUTE
// ---------------------------------------------------------------------------

const PROSPECT = "wss-test-ramon-roofing";
const LEGACY = "https://ramonroofing.example.com/";

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

function req({ method = "POST", token = "test-admin-token", body = {}, url = "/api/admin/hero-reel" } = {}) {
  const text = JSON.stringify(body);
  return {
    method,
    url,
    headers: { authorization: token ? `Bearer ${token}` : "", "content-type": "application/json" },
    on(event, cb) {
      if (event === "data") cb(Buffer.from(text));
      if (event === "end") cb();
      return this;
    },
    setEncoding() { return this; },
  };
}

const ROW = {
  ok: true,
  data: [{ prospect_id: PROSPECT, business_name: "Ramon Roofing", industry: "roofing", record: {} }],
};

function routeWith(overrides = {}) {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  return createHeroReelHandler({
    env: overrides.env || {},
    select: overrides.select || (async () => ROW),
    ensureHeroReel: overrides.ensureHeroReel || (async () => { throw new Error("the slideshow must not be reachable by default"); }),
    patchHeroReel: async () => ({ ok: true }),
    startHeroReel: overrides.startHeroReel || (async () => ({
      ok: true,
      job_id: "hrj_abc",
      prospect_id: PROSPECT,
      status: "queued",
      source_url: LEGACY,
      source_from: "mirror_request.facts.current_website",
      poll: { method: "GET", path: "/api/admin/hero-reel?job_id=hrj_abc" },
    })),
    getHeroReelJob: overrides.getHeroReelJob || (async () => ({ ok: false, error: "unknown_job" })),
  });
}

test("a supported bare POST defaults to Seedance and passes the producer into the durable queue", async () => {
  const seen = [];
  const handler = routeWith({
    startHeroReel: async (r, opts) => {
      seen.push({ prospect: r.prospect_id, opts });
      return {
        ok: true, job_id: "hrj_abc", status: "queued", source_url: LEGACY,
        poll: { method: "GET", path: "/api/admin/hero-reel?job_id=hrj_abc" },
      };
    },
  });
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT } }), r);
  assert.equal(r.captured.status, 202);
  assert.equal(r.captured.body.ok, true);
  assert.equal(r.captured.body.producer, "openrouter_seedance");
  assert.equal(r.captured.body.job_id, "hrj_abc");
  assert.equal(r.captured.body.business_name, "Ramon Roofing");
  assert.equal(r.captured.body.poll.path, "/api/admin/hero-reel?job_id=hrj_abc");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].prospect, PROSPECT, "the coordinator receives the ROW, not just an id");
  assert.equal(seen[0].opts.producer, "openrouter_seedance");
});

test("the Seedance kill switch lets an explicit WAN opt-in select WAN", async () => {
  const seen = [];
  const handler = routeWith({
    env: { GHOST_AGENCY_SEEDANCE_PRIMARY: "0", GHOST_AGENCY_WAN_PRIMARY: "1" },
    select: async () => ({
      ok: true,
      data: [{
        prospect_id: PROSPECT,
        business_name: "Ramon Roofing",
        record: { build_ready: { mirror_request: { facts: { industry: "roofing" } } } },
      }],
    }),
    startHeroReel: async (_row, opts) => {
      seen.push(opts);
      return { ok: true, job_id: "hrj_wan", status: "queued" };
    },
  });
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT } }), r);
  assert.equal(r.captured.body.producer, "wan2_i2v_local");
  assert.equal(seen[0].producer, "wan2_i2v_local");
});

test("the Seedance kill switch and GHOST_AGENCY_WAN_PRIMARY=0 route a supported bare POST to Ads", async () => {
  const seen = [];
  const handler = routeWith({
    env: { GHOST_AGENCY_SEEDANCE_PRIMARY: "0", GHOST_AGENCY_WAN_PRIMARY: "0" },
    startHeroReel: async (_row, opts) => {
      seen.push(opts);
      return { ok: true, job_id: "hrj_ads", status: "queued" };
    },
  });
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT } }), r);
  assert.equal(r.captured.status, 202);
  assert.equal(r.captured.body.producer, "ads_image_to_video");
  assert.equal(seen[0].producer, "ads_image_to_video");
});

test("an unsupported bare row still defaults to Seedance instead of entering the WAN pack", async () => {
  const seen = [];
  const handler = routeWith({
    select: async () => ({
      ok: true,
      data: [{ prospect_id: PROSPECT, business_name: "Ramon Dental", industry: "dentistry", record: {} }],
    }),
    startHeroReel: async (_row, opts) => {
      seen.push(opts);
      return { ok: true, job_id: "hrj_ads", status: "queued" };
    },
  });
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT } }), r);
  assert.equal(r.captured.body.producer, "openrouter_seedance");
  assert.equal(seen[0].producer, "openrouter_seedance");
});

test("a bare row with a missing or blank vertical defaults to Ads", async () => {
  for (const row of [
    { prospect_id: PROSPECT, business_name: "Ramon Unknown", record: {} },
    { prospect_id: PROSPECT, business_name: "Ramon Unknown", industry: "   ", record: {} },
  ]) {
    const seen = [];
    const handler = routeWith({
      select: async () => ({ ok: true, data: [row] }),
      startHeroReel: async (_selected, opts) => {
        seen.push(opts);
        return { ok: true, job_id: "hrj_ads", status: "queued" };
      },
    });
    const r = res();
    await handler(req({ body: { prospect_id: PROSPECT } }), r);
    assert.equal(r.captured.body.producer, "ads_image_to_video");
    assert.equal(seen[0].producer, "ads_image_to_video");
  }
});

test("each durable producer can be selected explicitly", async () => {
  for (const producer of ["wan2_i2v_local", "ads_image_to_video", "openrouter_seedance"]) {
    const seen = [];
    const handler = routeWith({
      env: { GHOST_AGENCY_WAN_PRIMARY: "0" },
      select: async () => ({
        ok: true,
        data: [{ prospect_id: PROSPECT, business_name: "Ramon Dental", industry: "dentistry", record: {} }],
      }),
      startHeroReel: async (_row, opts) => {
        seen.push(opts);
        return { ok: true, job_id: `hrj_${producer}`, status: "queued" };
      },
    });
    const r = res();
    await handler(req({ body: { prospect_id: PROSPECT, producer } }), r);
    assert.equal(r.captured.status, 202);
    assert.equal(r.captured.body.producer, producer);
    assert.equal(seen[0].producer, producer);
  }
});

test("the coordinator's refusal rides verbatim and nothing is queued", async () => {
  const handler = routeWith({
    startHeroReel: async () => ({ ok: false, reason: "no_legacy_site_url", detail: "current_website=our_own_mirror" }),
  });
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.ok, false);
  assert.equal(r.captured.body.reason, "no_legacy_site_url");
  assert.equal(r.captured.body.detail, "current_website=our_own_mirror");
  assert.equal(r.captured.body.job_id, undefined);
});

test("a claimed prospect tells the operator which job holds it", async () => {
  const handler = routeWith({
    startHeroReel: async () => ({ ok: false, reason: "prospect_already_claimed", job_id: "hrj_older" }),
  });
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT } }), r);
  assert.equal(r.captured.body.reason, "prospect_already_claimed");
  assert.equal(r.captured.body.job_id, "hrj_older");
});

test("GET ?job_id= is the poll; an unknown job is a 404", async () => {
  const handler = routeWith({
    getHeroReelJob: async (id) => (id === "hrj_abc"
      ? { ok: true, job_id: id, status: "done", result: { url: "https://x/hero-reel.mp4" } }
      : { ok: false, error: "unknown_job" }),
  });

  const denied = res();
  await handler(req({ method: "GET", token: "", url: "/api/admin/hero-reel?job_id=hrj_abc" }), denied);
  assert.equal(denied.captured.status, 401);

  const found = res();
  await handler(req({ method: "GET", url: "/api/admin/hero-reel?job_id=hrj_abc" }), found);
  assert.equal(found.captured.status, 200);
  assert.equal(found.captured.body.status, "done");

  const gone = res();
  await handler(req({ method: "GET", url: "/api/admin/hero-reel?job_id=hrj_nope" }), gone);
  assert.equal(gone.captured.status, 404);
  assert.equal(gone.captured.body.error, "unknown_job");
});

test("an unknown producer is a 400 that names what IS allowed", async () => {
  const handler = routeWith();
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT, producer: "veo_vibes" } }), r);
  assert.equal(r.captured.status, 400);
  assert.equal(r.captured.body.error, "unknown_producer");
  assert.deepEqual(r.captured.body.allowed, [
    "wan2_i2v_local",
    "ads_image_to_video",
    "openrouter_seedance",
    "hero_compose_local",
  ]);
});

test("the retired slideshow is still reachable — but only by asking for it by name", async () => {
  let composed = 0;
  const handler = routeWith({
    ensureHeroReel: async () => { composed += 1; return { ok: false, reason: "ffmpeg_unavailable" }; },
    startHeroReel: async () => { throw new Error("the durable lane must not run for an explicit compose request"); },
  });
  const r = res();
  await handler(req({ body: { prospect_id: PROSPECT, producer: "hero_compose_local" } }), r);
  assert.equal(composed, 1);
  assert.equal(r.captured.body.reason, "ffmpeg_unavailable");
  assert.equal(r.captured.body.producer, "hero_compose_local");
});
