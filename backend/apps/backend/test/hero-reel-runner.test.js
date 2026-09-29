"use strict";

// hero-reel-runner.test.js — the PRODUCER for the couture hero rung, proven
// without ffmpeg and without a network.
//
// The consume side (heroReelBlock → engine slot → 13 donor ladders) has its
// own tests; what was never tested — because it never existed — is the thing
// that WRITES media_bank.hero_reel. These tests pin the producer's contract:
//
//   · the ffmpeg probe runs FIRST and its refusal is the exact sentence the
//     lambda needs ("ffmpeg_unavailable"), with zero compose/upload work spent;
//   · photo selection prefers the bank's own judgment (hero grade, rank) and
//     refuses honestly below the composer's two-photo floor;
//   · a success emits precisely what the ride gates demand: https URL, known
//     generator, non-empty composed_from;
//   · the record patch copies the proven upsertRow call-site pattern —
//     (table, ROW, "prospect_id") — and merges the WHOLE record, because the
//     arg-order/merge mistakes here have each silently no-opped writes before.
//
// Every collaborator is stubbed: no real ffmpeg, no fetch to anything, no
// Supabase. The one file written is the stub composer's own output in a temp
// dir the runner cleans up.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ensureHeroReel,
  patchHeroReel,
  pickReelPhotos,
  reelEarnsTheRide,
  reelSlug,
} = require("../lib/hero-reel-runner");

// ---------------------------------------------------------------------------
// fixtures + stub kit
// ---------------------------------------------------------------------------

function bankPhoto(overrides = {}) {
  return {
    url: "https://client.example.com/work/a.jpg",
    source: "own_site",
    width: 1600,
    height: 1200,
    bytes: 250000,
    ext: "jpg",
    sha256: "sha-a",
    grade: "gallery",
    rank: 10,
    ...overrides,
  };
}

function rowWithBank(photos, extras = {}) {
  return {
    prospect_id: "wss-test-acme-fencing",
    record: {
      preview_url: "https://wss-test-acme-fencing.wss-ai.com/",
      build_ready: {
        photo_bank: { version: 3, harvested_at: "2026-08-19T00:00:00Z", photos },
        brand_evidence: { logo_url: "https://client.example.com/logo.png" },
      },
      ...extras,
    },
  };
}

/** A deps kit where everything succeeds, every call is recorded, and the
 * composer stub writes real bytes so the runner's readFileSync is honest. */
function stubs(overrides = {}) {
  const calls = { probe: 0, compose: [], upload: [], fetched: [] };
  const kit = {
    calls,
    probe: async () => { calls.probe += 1; return { ok: true, bin: "ffmpeg" }; },
    compose: async (args) => {
      calls.compose.push(args);
      fs.writeFileSync(args.outPath, Buffer.from("mp4-bytes-from-stub"));
      return { ok: true, path: args.outPath, durationSec: 12, photosUsed: args.photos.length, logo: Boolean(args.logoPath), encodeMs: 5 };
    },
    upload: async (objectPath, buffer, opts) => {
      calls.upload.push({ objectPath, bytes: buffer.length, opts });
      return { ok: true, bytes: buffer.length, publicUrl: `https://sb.example.co/storage/v1/object/public/wss-proof-assets/${objectPath}` };
    },
    fetchImpl: async (url) => {
      calls.fetched.push(url);
      // TextEncoder, not Buffer.from(x).buffer: a small Buffer's .buffer is
      // Node's 8KB pool slab, and handing that to the runner would "download"
      // eight kilobytes of pool garbage per photo.
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(`bytes-of:${url}`).buffer };
    },
    now: () => "2026-08-20T12:00:00Z",
    tmpRoot: os.tmpdir(),
    ...overrides,
  };
  return kit;
}

const GOOD_REEL = Object.freeze({
  url: "https://sb.example.co/storage/v1/object/public/wss-proof-assets/wss-test-x/hero-reel.mp4",
  generator: "hero_compose_local",
  composed_from: ["sha-a", "sha-b"],
  composed_at: "2026-08-20T09:00:00Z",
});

// ---------------------------------------------------------------------------
// the ride gates — must agree with heroReelBlock (mirror-lane-build.js:619-622)
// ---------------------------------------------------------------------------

test("reelEarnsTheRide applies exactly heroReelBlock's three gates", () => {
  assert.equal(reelEarnsTheRide(GOOD_REEL), true);
  assert.equal(reelEarnsTheRide({ ...GOOD_REEL, generator: "ads_image_to_video" }), false,
    "a durable generator label alone is not provenance");
  assert.equal(reelEarnsTheRide({
    ...GOOD_REEL,
    generator: "ads_image_to_video",
    provenance: { kind: "client_derived_reel", generator: "ads_image_to_video", hero_job_id: "hero_1" },
  }), true);
  assert.equal(reelEarnsTheRide(null), false, "no reel, no ride");
  assert.equal(reelEarnsTheRide({ ...GOOD_REEL, url: "http://sb.example.co/x.mp4" }), false, "http never rides");
  assert.equal(reelEarnsTheRide({ ...GOOD_REEL, generator: "mystery_tool" }), false);
  assert.equal(reelEarnsTheRide({ ...GOOD_REEL, composed_from: [] }), false);
});

// ---------------------------------------------------------------------------
// THE HARD CONSTRAINT: no ffmpeg, no reel, no work, no throw
// ---------------------------------------------------------------------------

test("an absent ffmpeg refuses as ffmpeg_unavailable before any photo is touched", async () => {
  const kit = stubs({ probe: async () => ({ ok: false, reason: "ffmpeg_unavailable" }) });
  const out = await ensureHeroReel(rowWithBank([bankPhoto(), bankPhoto({ url: "https://client.example.com/b.jpg", sha256: "sha-b" })]), kit);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "ffmpeg_unavailable");
  assert.equal(kit.calls.fetched.length, 0, "no download may be spent on a host that cannot encode");
  assert.equal(kit.calls.compose.length, 0);
  assert.equal(kit.calls.upload.length, 0);
});

test("a probe that THROWS still resolves fail-soft — nothing here throws into a build", async () => {
  const kit = stubs({ probe: async () => { throw new Error("spawn exploded"); } });
  const out = await ensureHeroReel(rowWithBank([bankPhoto()]), kit);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "unexpected_error");
});

// ---------------------------------------------------------------------------
// photo selection
// ---------------------------------------------------------------------------

test("selection prefers hero grade, then bank rank, sinks stock suspects, refuses http, caps at six", () => {
  const bank = {
    photos: [
      bankPhoto({ url: "https://c.example/g1.jpg", sha256: "g1", grade: "gallery", rank: 5 }),
      bankPhoto({ url: "https://c.example/h1.jpg", sha256: "h1", grade: "hero", rank: 9 }),
      bankPhoto({ url: "http://c.example/insecure.jpg", sha256: "no", grade: "hero", rank: 1 }),
      bankPhoto({ url: "https://c.example/sus.jpg", sha256: "sus", grade: "hero", rank: 2, stock_caption_suspect: true }),
      bankPhoto({ url: "https://c.example/h2.jpg", sha256: "h2", grade: "hero", rank: 3 }),
      bankPhoto({ url: "https://c.example/g2.jpg", sha256: "g2", grade: "gallery", rank: 7 }),
      bankPhoto({ url: "https://c.example/g3.jpg", sha256: "g3", grade: "gallery", rank: 8 }),
      bankPhoto({ url: "https://c.example/g4.jpg", sha256: "g4", grade: "gallery", rank: 12 }),
    ],
  };
  const picked = pickReelPhotos(bank, { maxPhotos: 6 });
  assert.equal(picked.length, 6, "capped at the composer's six-photo ceiling");
  assert.deepEqual(picked.map((p) => p.sha256), ["h2", "h1", "g1", "g2", "g3", "g4"],
    "hero grade outranks gallery, rank breaks ties, the http row is gone, and the suspect fell off the end");
});

test("fewer than two usable https photos refuses with the composer's own sentence", async () => {
  const kit = stubs();
  const out = await ensureHeroReel(rowWithBank([
    bankPhoto(),
    bankPhoto({ url: "http://client.example.com/insecure.jpg", sha256: "sha-http" }),
  ]), kit);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "need_at_least_two_photos");
  assert.equal(out.detail, "have:1");
  assert.equal(kit.calls.compose.length, 0);
});

test("a record with no photo bank at all says so", async () => {
  const out = await ensureHeroReel({ prospect_id: "wss-test-bare", record: {} }, stubs());
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_photo_bank");
});

// ---------------------------------------------------------------------------
// the happy path — and the exact shape the ride gates demand
// ---------------------------------------------------------------------------

test("a composed reel uploads as <slug>/hero-reel.mp4 video/mp4 and satisfies every ride gate", async () => {
  const kit = stubs();
  const row = rowWithBank([
    bankPhoto({ url: "https://c.example/h1.jpg", sha256: "sha-h1", grade: "hero", rank: 1 }),
    bankPhoto({ url: "https://c.example/g1.jpg", sha256: "sha-g1", grade: "gallery", rank: 4 }),
    bankPhoto({ url: "https://c.example/g2.jpg", sha256: "sha-g2", grade: "gallery", rank: 6 }),
  ]);
  const out = await ensureHeroReel(row, kit);

  assert.equal(out.ok, true);
  assert.equal(out.generator, "hero_compose_local");
  assert.deepEqual(out.composed_from, ["sha-h1", "sha-g1", "sha-g2"],
    "provenance is the bank's content shas, in the order the reel used them");
  assert.equal(out.composed_at, "2026-08-20T12:00:00Z");
  assert.ok(out.bytes > 0);
  assert.equal(reelEarnsTheRide(out), true, "the producer's output must pass the consumer's gates by construction");

  // The upload half: slug folder from the established mirror, mp4 only.
  assert.equal(kit.calls.upload.length, 1);
  assert.equal(kit.calls.upload[0].objectPath, "wss-test-acme-fencing/hero-reel.mp4");
  assert.equal(kit.calls.upload[0].opts.contentType, "video/mp4");

  // The verified logo travelled to the composer; the composer saw local files.
  assert.equal(kit.calls.compose.length, 1);
  assert.ok(kit.calls.compose[0].logoPath, "the brand_evidence logo rides as the watermark");
  for (const p of kit.calls.compose[0].photos) assert.ok(path.isAbsolute(p), `composer eats local files, got ${p}`);
});

test("an existing provenanced reel is reused — no probe, no encode, no re-upload", async () => {
  const kit = stubs({ probe: async () => { throw new Error("must not be probed"); } });
  const row = rowWithBank([bankPhoto()], { media_bank: { hero_reel: GOOD_REEL } });
  const out = await ensureHeroReel(row, kit);
  assert.equal(out.ok, true);
  assert.equal(out.reused, true);
  assert.equal(out.url, GOOD_REEL.url);
  assert.equal(kit.calls.upload.length, 0);
});

// ---------------------------------------------------------------------------
// fail-soft on every leg
// ---------------------------------------------------------------------------

test("one dead photo URL drops one photo; all dead refuses as photo_download_failed", async () => {
  // One dead link: the reel still composes from the survivors.
  const partial = stubs({
    fetchImpl: async (url) => {
      if (url.includes("dead")) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("img").buffer };
    },
  });
  const okOut = await ensureHeroReel(rowWithBank([
    bankPhoto({ url: "https://c.example/dead.jpg", sha256: "sha-dead", rank: 1 }),
    bankPhoto({ url: "https://c.example/live-1.jpg", sha256: "sha-1", rank: 2 }),
    bankPhoto({ url: "https://c.example/live-2.jpg", sha256: "sha-2", rank: 3 }),
  ]), partial);
  assert.equal(okOut.ok, true);
  assert.deepEqual(okOut.composed_from, ["sha-1", "sha-2"], "the dead link never enters the provenance list");

  // Every link dead: an honest refusal, not a two-frame reel of nothing.
  const allDead = stubs({ fetchImpl: async () => ({ ok: false, status: 404 }) });
  const badOut = await ensureHeroReel(rowWithBank([
    bankPhoto({ url: "https://c.example/dead-1.jpg", sha256: "d1" }),
    bankPhoto({ url: "https://c.example/dead-2.jpg", sha256: "d2" }),
  ]), allDead);
  assert.equal(badOut.ok, false);
  assert.equal(badOut.reason, "photo_download_failed");
  assert.equal(allDead.calls.compose.length, 0);
});

test("a composer refusal is forwarded in the composer's own words", async () => {
  const kit = stubs({ compose: async () => ({ ok: false, reason: "over_size_budget", detail: "7000000B" }) });
  const out = await ensureHeroReel(rowWithBank([bankPhoto(), bankPhoto({ url: "https://c.example/b.jpg", sha256: "sha-b" })]), kit);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "over_size_budget");
  assert.equal(out.detail, "7000000B");
  assert.equal(kit.calls.upload.length, 0, "a refused encode never reaches storage");
});

test("an upload failure and a non-https public URL each refuse instead of shipping a reel the gate would drop", async () => {
  const uploadDown = stubs({ upload: async () => ({ ok: false, reason: "upload_503 …" }) });
  const photos = [bankPhoto(), bankPhoto({ url: "https://c.example/b.jpg", sha256: "sha-b" })];
  const out1 = await ensureHeroReel(rowWithBank(photos), uploadDown);
  assert.equal(out1.ok, false);
  assert.equal(out1.reason, "upload_failed");

  const insecure = stubs({ upload: async (objectPath, buffer) => ({ ok: true, bytes: buffer.length, publicUrl: "" }), publicUrl: () => "" });
  const out2 = await ensureHeroReel(rowWithBank(photos), insecure);
  assert.equal(out2.ok, false);
  assert.equal(out2.reason, "public_url_not_https",
    "a storage layer with no public base yields no URL — that is a refusal, not a success with an empty string");
});

test("a missing logo is never fatal — the reel ships unwatermarked", async () => {
  const kit = stubs({
    fetchImpl: async (url) => {
      if (url.endsWith("logo.png")) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode("img").buffer };
    },
  });
  const out = await ensureHeroReel(rowWithBank([bankPhoto(), bankPhoto({ url: "https://c.example/b.jpg", sha256: "sha-b" })]), kit);
  assert.equal(out.ok, true);
  assert.equal(kit.calls.compose[0].logoPath, null, "no logo file was handed to the composer");
});

test("the temp workspace is cleaned up on success and on refusal alike", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reel-test-root-"));
  const photos = [bankPhoto(), bankPhoto({ url: "https://c.example/b.jpg", sha256: "sha-b" })];
  await ensureHeroReel(rowWithBank(photos), stubs({ tmpRoot }));
  await ensureHeroReel(rowWithBank(photos), stubs({ tmpRoot, compose: async () => ({ ok: false, reason: "ffmpeg_failed" }) }));
  assert.deepEqual(fs.readdirSync(tmpRoot), [], "no hero-reel-* work dirs left behind");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// reelSlug — where the mp4 lands
// ---------------------------------------------------------------------------

test("the reel lands under the established mirror slug, else the prospect id", () => {
  assert.equal(reelSlug(rowWithBank([])), "wss-test-acme-fencing");
  assert.equal(reelSlug({ prospect_id: "wss-test-no-mirror-yet", record: {} }), "wss-test-no-mirror-yet");
  assert.equal(reelSlug({ prospect_id: "Weird/Id With Spaces", record: {} }), "weird-id-with-spaces",
    "an object path never carries characters storage would refuse");
});

// ---------------------------------------------------------------------------
// patchHeroReel — the record write, argument order and merge both pinned
// ---------------------------------------------------------------------------

function patchDeps(overrides = {}) {
  const calls = { selects: [], upserts: [] };
  return {
    calls,
    select: overrides.select || (async (table, query) => {
      calls.selects.push({ table, query });
      return {
        ok: true,
        data: [{
          prospect_id: "wss-test-acme-fencing",
          record: { business_name: "Acme Fencing", proof_shots: { before: "x" }, media_bank: { other_asset: "kept" } },
        }],
      };
    }),
    upsertRow: overrides.upsertRow || (async (table, row, conflict) => {
      calls.upserts.push({ table, row, conflict });
      return { mode: "live_upsert", table, row };
    }),
    now: () => "2026-08-20T12:00:00Z",
    ...("mode" in overrides ? { upsertRow: async (t, r, c) => { calls.upserts.push({ table: t, row: r, conflict: c }); return { mode: overrides.mode, error: overrides.error }; } } : {}),
  };
}

test("the patch copies the proven call-site pattern: (table, ROW, 'prospect_id'), whole record merged", async () => {
  const deps = patchDeps();
  const out = await patchHeroReel("wss-test-acme-fencing", GOOD_REEL, deps);
  assert.equal(out.ok, true);

  assert.equal(deps.calls.upserts.length, 1);
  const { table, row, conflict } = deps.calls.upserts[0];
  assert.equal(table, "ghost_agency_prospects");
  assert.equal(conflict, "prospect_id", "the arg-order that silently no-opped three writes before — pinned");
  assert.equal(row.prospect_id, "wss-test-acme-fencing");
  assert.equal(row.updated_at, "2026-08-20T12:00:00Z");

  // THE MERGE IS THE POINT: upsert replaces the record COLUMN wholesale, so
  // everything the record already held must ride along or it is erased.
  assert.equal(row.record.business_name, "Acme Fencing");
  assert.deepEqual(row.record.proof_shots, { before: "x" });
  assert.equal(row.record.media_bank.other_asset, "kept");
  assert.deepEqual(row.record.media_bank.hero_reel, GOOD_REEL);
  assert.equal(reelEarnsTheRide(row.record.media_bank.hero_reel), true,
    "what lands on the record is exactly what heroReelBlock will accept");
});

test("a reel the ride gates would refuse is never written", async () => {
  const deps = patchDeps();
  const out = await patchHeroReel("wss-test-acme-fencing", { ...GOOD_REEL, composed_from: [] }, deps);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "reel_fails_ride_gates");
  assert.equal(deps.calls.upserts.length, 0, "a record must never claim a hero it cannot ship");
});

test("patch refusals name their cause: missing id, unknown prospect, failed persist, unconfigured store", async () => {
  assert.equal((await patchHeroReel("", GOOD_REEL, patchDeps())).reason, "missing_prospect_id");

  const gone = patchDeps({ select: async () => ({ ok: true, data: [] }) });
  assert.equal((await patchHeroReel("nobody", GOOD_REEL, gone)).reason, "prospect_not_found");

  const failed = patchDeps({ mode: "live_upsert_failed", error: { code: "PGRST204" } });
  const failedOut = await patchHeroReel("wss-test-acme-fencing", GOOD_REEL, failed);
  assert.equal(failedOut.ok, false);
  assert.equal(failedOut.reason, "persist_failed");

  const dry = patchDeps({ mode: "dry_run" });
  assert.equal((await patchHeroReel("wss-test-acme-fencing", GOOD_REEL, dry)).reason, "store_not_configured");
});
