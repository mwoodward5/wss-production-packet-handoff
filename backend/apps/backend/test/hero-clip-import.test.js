"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const validation = require("../lib/hero-clip-validation");
const heroImport = require("../api/admin/hero-clip-import");

function box(type, payload) {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, "ascii");
  payload.copy(output, 8);
  return output;
}

function validHeroMp4({ codec = "avc1", seconds = 5 } = {}) {
  const ftyp = box("ftyp", Buffer.from("isom\x00\x00\x02\x00isomiso2", "binary"));
  const mvhd = Buffer.alloc(24);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(24);
  tkhd.writeUInt32BE(1920 * 65536, 16);
  tkhd.writeUInt32BE(1080 * 65536, 20);
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8, 4, "ascii");
  const stsdHead = Buffer.alloc(8);
  stsdHead.writeUInt32BE(1, 4);
  const stsd = box("stsd", Buffer.concat([stsdHead, box(codec, Buffer.alloc(8))]));
  const minf = box("minf", box("stbl", stsd));
  const mdia = box("mdia", Buffer.concat([box("hdlr", hdlr), minf]));
  const trak = box("trak", Buffer.concat([box("tkhd", tkhd), mdia]));
  return Buffer.concat([
    ftyp,
    box("moov", Buffer.concat([box("mvhd", mvhd), trak])),
    box("mdat", Buffer.from([1, 2, 3, 4])),
  ]);
}

const SOURCE_SHA = "a".repeat(64);
const SOURCE_URL = "https://client.example.com/work/real-job.jpg?id=7";
const OPTIMIZED_SHA = "b".repeat(64);
const PROMPT_SHA = "c".repeat(64);
const APPROVED_AT = "2026-08-22T07:59:00.000Z";

function fields(overrides = {}) {
  return {
    prospect_id: "wss-test-acme",
    source_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    approved: "true",
    approved_by: "Mark",
    approved_at: APPROVED_AT,
    optimized_sha256: OPTIMIZED_SHA,
    prompt_sha256: PROMPT_SHA,
    ...overrides,
  };
}

function row() {
  return {
    prospect_id: "wss-test-acme",
    preview_url: "https://wss-test-acme.wss-ai.com",
    record: {
      business_name: "Acme",
      build_ready: {
        photo_bank: {
          photos: [{ sha256: SOURCE_SHA, url: SOURCE_URL, source: "own_site" }],
        },
      },
    },
  };
}

function responseHarness() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(body));
    },
  };
}

function requestHarness() {
  return { method: "POST", headers: {} };
}

function lane(overrides = {}) {
  const clip = overrides.clip || validHeroMp4();
  const calls = { reads: [], storage: [], events: [], patches: [], rebuilds: [], kicks: [] };
  const handler = heroImport.createHeroClipImportHandler({
    requireAdmin: overrides.requireAdmin || (() => true),
    now: () => new Date("2026-08-22T08:00:00.000Z"),
    readMultipart: overrides.readMultipart || (async () => ({
      ok: true,
      fields: overrides.fields || fields(),
      file: { fieldName: "clip", name: "hero.mp4", contentType: "video/mp4", bytes: clip },
    })),
    select: overrides.select || (async (table, query) => {
      calls.reads.push({ table, query });
      return { ok: true, data: [row()] };
    }),
    uploadProofShot: overrides.uploadProofShot || (async (objectPath, bytes, options) => {
      calls.storage.push({ objectPath, bytes: bytes.length, options });
      return { ok: true, publicUrl: `https://assets.example.com/${objectPath}` };
    }),
    recordEvent: overrides.recordEvent || (async (type, payload) => {
      calls.events.push({ type, payload });
      return { ok: true, mode: "live_write", event_id: "audit-1" };
    }),
    patchHeroReel: overrides.patchHeroReel || (async (prospectId, reel) => {
      calls.patches.push({ prospectId, reel });
      return { ok: true, write_id: "record-1" };
    }),
    enqueueRebuildJob: overrides.enqueueRebuildJob || (async (input) => {
      calls.rebuilds.push(input);
      return { ok: true, job_id: "rebuild-1" };
    }),
    kickRebuildJob: overrides.kickRebuildJob || ((jobId) => { calls.kicks.push(jobId); }),
  });
  return { handler, calls, clip };
}

async function invoke(laneState) {
  const res = responseHarness();
  await laneState.handler(requestHarness(), res);
  return res.captured;
}

test("owner import stores, audits, patches, queues, and kicks one H.264 clip in the same tick", async () => {
  const state = lane();
  const result = await invoke(state);
  const clip = validation.validateHeroClip(state.clip);

  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.equal(result.body.ok, true);
  assert.equal(result.body.terminal, true);
  assert.equal(result.body.rebuild_kick_started, true);
  assert.equal(result.body.clip_sha256, clip.sha256);
  assert.equal(result.body.generator, "ads_image_to_video");
  assert.equal(result.body.actual_generator, "ads_animate_image");
  assert.deepEqual(result.body.composed_from, [SOURCE_SHA]);

  assert.deepEqual(state.calls.reads, [{
    table: "ghost_agency_prospects",
    query: "select=*&prospect_id=eq.wss-test-acme&limit=1",
  }]);
  assert.equal(state.calls.storage.length, 1);
  assert.equal(state.calls.storage[0].objectPath, `wss-test-acme/hero-reels/approved/${clip.sha256}.mp4`);
  assert.deepEqual(state.calls.storage[0].options, {
    contentType: "video/mp4",
    cacheControl: "public, max-age=31536000, immutable",
  });
  assert.equal(state.calls.events[0].type, "hero_clip.asset_stored");
  assert.equal(state.calls.events[0].payload.actual_generator, "ads_animate_image");
  assert.equal(state.calls.events[0].payload.optimized_sha256, OPTIMIZED_SHA);
  assert.equal(state.calls.events[0].payload.prompt_sha256, PROMPT_SHA);
  assert.deepEqual(state.calls.patches, [{
    prospectId: "wss-test-acme",
    reel: {
      url: `https://assets.example.com/wss-test-acme/hero-reels/approved/${clip.sha256}.mp4`,
      generator: "ads_image_to_video",
      composed_from: [SOURCE_SHA],
      composed_at: "2026-08-22T08:00:00.000Z",
    },
  }]);
  assert.deepEqual(state.calls.rebuilds, [{
    prospectId: "wss-test-acme",
    actor: "hero_clip_import",
    heroJobId: `manual_import_${clip.sha256}`,
    heroClipSha256: clip.sha256,
  }]);
  assert.deepEqual(state.calls.kicks, ["rebuild-1"]);
});

test("the route is owner-admin only and rejects before reading multipart bytes", async () => {
  let reads = 0;
  const state = lane({
    requireAdmin: (_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return false;
    },
    readMultipart: async () => { reads += 1; return { ok: false }; },
  });
  const result = await invoke(state);
  assert.equal(result.status, 401);
  assert.equal(result.body.error, "unauthorized");
  assert.equal(reads, 0);
});

test("missing, false, or malformed owner approval fails closed before storage", async (t) => {
  for (const [name, badFields, error] of [
    ["missing", fields({ approved: "" }), "owner_approval_required"],
    ["false", fields({ approved: "false" }), "owner_approval_required"],
    ["unnamed", fields({ approved_by: "" }), "approved_by_required"],
    ["bad time", fields({ approved_at: "tomorrow" }), "approved_at_invalid"],
  ]) {
    await t.test(name, async () => {
      const state = lane({ fields: badFields });
      const result = await invoke(state);
      assert.equal(result.status, 403);
      assert.equal(result.body.error, error);
      assert.deepEqual(state.calls.storage, []);
    });
  }
});

test("source SHA and URL must exactly identify one photo in the canonical prospect bank", async (t) => {
  for (const [name, badFields, error] of [
    ["unknown SHA", fields({ source_sha256: "d".repeat(64) }), "source_sha256_not_owned"],
    ["foreign URL", fields({ source_url: "https://other.example.com/copied.jpg" }), "source_url_not_owned"],
  ]) {
    await t.test(name, async () => {
      const state = lane({ fields: badFields });
      const result = await invoke(state);
      assert.equal(result.status, 409);
      assert.equal(result.body.error, error);
      assert.deepEqual(state.calls.storage, []);
      assert.deepEqual(state.calls.patches, []);
    });
  }
});

test("unreadable, oversized, and non-H.264 clips never reach storage", async (t) => {
  for (const [name, clip, status, error] of [
    ["unreadable", Buffer.from("not an mp4"), 422, "clip_not_mp4"],
    ["oversized", Buffer.alloc(validation.MAX_CLIP_BYTES + 1), 413, "clip_too_large"],
    ["AV1", validHeroMp4({ codec: "av01" }), 422, "h264_required"],
  ]) {
    await t.test(name, async () => {
      const state = lane({ clip });
      const result = await invoke(state);
      assert.equal(result.status, status, JSON.stringify(result.body));
      assert.equal(result.body.error, error);
      assert.deepEqual(state.calls.storage, []);
    });
  }
});

test("optional derivative hashes are not required, but supplied invalid hashes are refused", async () => {
  const absent = lane({ fields: fields({ optimized_sha256: "", prompt_sha256: "" }) });
  const accepted = await invoke(absent);
  assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
  assert.equal(Object.hasOwn(absent.calls.events[0].payload, "optimized_sha256"), false);
  assert.equal(Object.hasOwn(absent.calls.events[0].payload, "prompt_sha256"), false);

  const invalid = lane({ fields: fields({ optimized_sha256: "not-a-sha" }) });
  const refused = await invoke(invalid);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "optimized_sha256_invalid");
  assert.deepEqual(invalid.calls.storage, []);
});

test("audit persistence failure stops before record patch and rebuild", async () => {
  const state = lane({ recordEvent: async () => ({ ok: false, mode: "live_write_failed" }) });
  const result = await invoke(state);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "asset_audit_persist_failed");
  assert.deepEqual(state.calls.patches, []);
  assert.deepEqual(state.calls.rebuilds, []);
  assert.deepEqual(state.calls.kicks, []);
});

test("record patch failure prevents rebuild and never returns accepted", async () => {
  const state = lane({ patchHeroReel: async () => ({ ok: false, reason: "persist_failed" }) });
  const result = await invoke(state);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "hero_reel_persist_failed");
  assert.deepEqual(state.calls.rebuilds, []);
  assert.deepEqual(state.calls.kicks, []);
});

test("rebuild enqueue failure prevents the same-tick kick and never returns accepted", async () => {
  const state = lane({ enqueueRebuildJob: async () => ({ ok: false, error: "rebuild_queue_unavailable" }) });
  const result = await invoke(state);
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "rebuild_enqueue_failed");
  assert.equal(result.body.persisted, true);
  assert.deepEqual(state.calls.kicks, []);
});

