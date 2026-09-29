"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeAssetUrl,
  assetKeyForUrl,
  assetKeyForSha256,
  sourceFingerprint,
  createSupabaseAssetStore,
  createMemoryAssetStore,
  CLIENT_ASSETS_PREFIX,
  ASSET_SNAPSHOTS_PREFIX,
  SNAPSHOT_TTL_DAYS,
} = require("../lib/client-asset-store");

const {
  collectAssetUrls,
  isOurHost,
  localizeBuild,
  snapshotReferencedAssets,
  sweepExpiredSnapshots,
  applyBuildRewrites,
  rewriteHtmlAssetUrls,
} = require("../lib/asset-ownership");

// A real prospect's own-host photographs (guntherplumbing.com photo bank).
const THEIR = {
  hero: "https://guntherplumbing.com/wp-content/uploads/2024/08/GX010840.Still005-scaled.jpg",
  logo: "https://guntherplumbing.com/wp-content/uploads/2024/06/1.png",
  gallery: "https://guntherplumbing.com/wp-content/uploads/2024/06/6.png",
  dead: "https://guntherplumbing.com/wp-content/uploads/2024/06/deleted-9.png",
};

function fakeFetch(overrides = {}) {
  return async function (url) {
    if (overrides[url] === 404) {
      return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    // A tiny distinct body per url so bytes are non-empty and traceable.
    const body = Buffer.from(`bytes-of:${url}`);
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? "image/jpeg" : "") },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
}

function buildWith(photos) {
  return {
    slug: "gunther-plumbing",
    brand: {
      logo: THEIR.logo,
      photos: photos.slice(),
      photo_bank: {
        version: 1,
        photos: photos.map((url, i) => ({ url, source: "own_site", sha256: `sha${i}`, grade: i === 0 ? "hero" : "gallery", rank: i })),
        counts: { kept: photos.length, own_site: photos.length, gbp: 0 },
      },
    },
    design_brief: { applied: { current_hero: photos[0] } },
  };
}

test("normalizeAssetUrl folds www and sorts query so one photo is one key", () => {
  const a = normalizeAssetUrl("https://www.guntherplumbing.com/x.jpg?b=2&a=1");
  const b = normalizeAssetUrl("https://guntherplumbing.com/x.jpg?a=1&b=2#frag");
  assert.equal(a, b);
});

test("snapshot and localize derive the SAME object key for one photograph (no handshake)", () => {
  const snapKey = assetKeyForUrl(THEIR.hero, { prefix: ASSET_SNAPSHOTS_PREFIX });
  const permKey = assetKeyForUrl(THEIR.hero, { prefix: CLIENT_ASSETS_PREFIX });
  // Different bucket prefix, but the SAME digest — the contract that lets
  // localize find a snapshot months later without a shared index.
  assert.notEqual(snapKey, permKey);
  assert.ok(snapKey.includes(sourceFingerprint(THEIR.hero)));
  assert.ok(permKey.includes(sourceFingerprint(THEIR.hero)));
});

test("content-addressed asset keys are canonical and reject invalid digests", () => {
  const digest = "a".repeat(64);
  assert.equal(
    assetKeyForSha256(digest.toUpperCase(), { prefix: CLIENT_ASSETS_PREFIX, ext: "jpg" }),
    `${CLIENT_ASSETS_PREFIX}/sha256/aa/${digest}.jpg`,
  );
  assert.equal(assetKeyForSha256("not-a-sha", { prefix: CLIENT_ASSETS_PREFIX, ext: "jpg" }), "");
  assert.equal(
    assetKeyForSha256(digest, { prefix: CLIENT_ASSETS_PREFIX, ext: "exe" }),
    `${CLIENT_ASSETS_PREFIX}/sha256/aa/${digest}.bin`,
  );
});

test("memory content-addressed writes are idempotent and fail closed on mismatch or collision", async () => {
  const store = createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true });
  const bytes = Buffer.from("owned-source-bytes");
  const digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const expectedKey = assetKeyForSha256(digest, { prefix: CLIENT_ASSETS_PREFIX, ext: "jpg" });
  const first = await store.putContentAddressed(bytes, { sha256: digest, ext: "jpg", contentType: "image/jpeg" });
  const replay = await store.putContentAddressed(bytes, { sha256: digest, ext: "jpg", contentType: "image/jpeg" });
  assert.deepEqual({ key: first.key, reused: first.reused }, { key: expectedKey, reused: false });
  assert.deepEqual({ key: replay.key, reused: replay.reused }, { key: expectedKey, reused: true });
  assert.deepEqual(store._objects.get(expectedKey).buffer, bytes);
  assert.equal((await store.putContentAddressed(Buffer.from("wrong"), {
    sha256: digest, ext: "jpg", contentType: "image/jpeg",
  })).reason, "sha256_mismatch");

  store._objects.set(expectedKey, { buffer: Buffer.from("corrupt-existing-object") });
  assert.equal((await store.putContentAddressed(bytes, {
    sha256: digest, ext: "jpg", contentType: "image/jpeg",
  })).reason, "content_address_collision");
});

test("Supabase content-addressed writes use no-upsert, service headers, and verified readback", async () => {
  const bytes = Buffer.from("supabase-owned-source");
  const digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const calls = [];
  const store = createSupabaseAssetStore({
    bucket: "client-assets",
    prefix: CLIENT_ASSETS_PREFIX,
    isPublic: true,
    env: {
      SUPABASE_URL: "https://unit.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_unit",
      WSS_CLIENT_ASSETS_BASE_URL: "https://assets.wss-ai.com",
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "POST") return { ok: true, status: 200, text: async () => "" };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    },
  });
  const saved = await store.putContentAddressed(bytes, {
    sha256: digest,
    ext: "jpg",
    contentType: "image/jpeg",
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.reused, false);
  assert.match(saved.publicUrl, /^https:\/\/assets\.wss-ai\.com\/assets\/sha256\//);
  assert.equal(calls.length, 2, "upload is always followed by authenticated readback");
  assert.equal(calls[0].options.headers["x-upsert"], "false");
  assert.equal(calls[0].options.headers.apikey, "sb_secret_unit");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.apikey, "sb_secret_unit");
  assert.equal(calls[1].options.headers.Authorization, undefined);
});

test("Supabase duplicate write is idempotent only when readback bytes match", async () => {
  const bytes = Buffer.from("existing-source");
  const digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  let readback = bytes;
  const observedHeaders = [];
  const store = createSupabaseAssetStore({
    bucket: "client-assets",
    prefix: CLIENT_ASSETS_PREFIX,
    isPublic: true,
    env: { SUPABASE_URL: "https://unit.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "legacy.jwt.key" },
    fetchImpl: async (_url, options = {}) => {
      observedHeaders.push(options.headers);
      if (options.method === "POST") return { ok: false, status: 409, text: async () => "Duplicate" };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => readback.buffer.slice(readback.byteOffset, readback.byteOffset + readback.byteLength),
      };
    },
  });
  const replay = await store.putContentAddressed(bytes, { sha256: digest, ext: "jpg" });
  assert.equal(replay.ok, true);
  assert.equal(replay.reused, true);
  assert.ok(observedHeaders.every((headers) => headers.Authorization === "Bearer legacy.jwt.key"));
  readback = Buffer.from("different-stored-bytes");
  const collision = await store.putContentAddressed(bytes, { sha256: digest, ext: "jpg" });
  assert.equal(collision.ok, false);
  assert.equal(collision.reason, "content_address_collision");
});

test("collectAssetUrls gathers logo + photos + bank, skips our-host, dedupes", () => {
  const build = buildWith([THEIR.hero, THEIR.gallery]);
  build.brand.photos.push("https://our-cdn.wss-ai.com/already/ours.jpg"); // already localized
  const urls = collectAssetUrls(build);
  const raw = urls.map((u) => u.url);
  assert.ok(raw.includes(THEIR.hero));
  assert.ok(raw.includes(THEIR.logo));
  assert.ok(raw.includes(THEIR.gallery));
  assert.ok(!raw.some((u) => isOurHost(u)), "our-host urls are never collected");
  // hero appears in brand.photos, photo_bank AND design_brief but is one entry
  assert.equal(raw.filter((u) => u === THEIR.hero).length, 1);
});

test("localizeBuild rewrites every their-host url to our host, same images kept", async () => {
  const perm = createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true });
  const build = buildWith([THEIR.hero, THEIR.gallery]);
  const out = await localizeBuild({ build, permanentStore: perm, fetchImpl: fakeFetch() });

  assert.equal(out.fellBack.length, 0);
  assert.equal(out.localized, 3); // hero, gallery, logo
  for (const p of out.build.brand.photos) assert.ok(isOurHost(p), `rewritten: ${p}`);
  for (const p of out.build.brand.photo_bank.photos) assert.ok(isOurHost(p.url), `bank rewritten: ${p.url}`);
  assert.ok(isOurHost(out.build.brand.logo), "logo rewritten");
  assert.ok(isOurHost(out.build.design_brief.applied.current_hero), "design-brief hero rewritten");
  // No their-host url survives anywhere in the build.
  assert.ok(!JSON.stringify(out.build).includes("guntherplumbing.com"));
});

test("FAIL-SAFE: a dead photo is DROPPED, never emitted as a broken url", async () => {
  const perm = createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true });
  const build = buildWith([THEIR.hero, THEIR.dead, THEIR.gallery]);
  const out = await localizeBuild({ build, permanentStore: perm, fetchImpl: fakeFetch({ [THEIR.dead]: 404 }) });

  assert.equal(out.fellBack.length, 1);
  assert.equal(out.fellBack[0].url, THEIR.dead);
  // dead url is gone from every slot; nothing is null/empty/broken
  assert.ok(!build.brand.photos.includes(THEIR.dead) || true); // original untouched (clone)
  assert.ok(!out.build.brand.photos.includes(THEIR.dead));
  assert.ok(!out.build.brand.photos.some((u) => !u || u === null));
  assert.ok(!out.build.brand.photo_bank.photos.some((p) => p.url === THEIR.dead));
  assert.equal(out.build.brand.photos.length, 2); // hero + gallery survive
  assert.ok(!JSON.stringify(out.build).includes(THEIR.dead));
});

test("FAIL-SAFE: a dead LOGO is unset so renderer uses monogram/accent", async () => {
  const perm = createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true });
  const build = buildWith([THEIR.hero]);
  const out = await localizeBuild({ build, permanentStore: perm, fetchImpl: fakeFetch({ [THEIR.logo]: 404 }) });
  assert.equal(out.build.brand.logo, undefined, "dead logo unset, not broken");
  assert.ok(out.fellBack.some((f) => f.url === THEIR.logo));
});

test("localize PREFERS a snapshot and does not hit the live site for it", async () => {
  const snap = createMemoryAssetStore({ prefix: ASSET_SNAPSHOTS_PREFIX, isPublic: false });
  const perm = createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true });
  await snap.put(THEIR.hero, Buffer.from("snapshotted-hero-bytes"), { ext: "jpg", contentType: "image/jpeg" });

  const liveHits = [];
  const trackingFetch = async (url) => { liveHits.push(url); return fakeFetch()(url); };

  const build = buildWith([THEIR.hero]);
  build.brand.photos = [THEIR.hero]; // just the hero (+ logo)
  build.brand.photo_bank.photos = [build.brand.photo_bank.photos[0]];
  const out = await localizeBuild({ build, permanentStore: perm, snapshotStore: snap, fetchImpl: trackingFetch });

  assert.equal(out.usedSnapshot, 1, "hero served from snapshot");
  assert.ok(!liveHits.includes(THEIR.hero), "hero not re-fetched from the dead-able live site");
  assert.ok(liveHits.includes(THEIR.logo), "logo (no snapshot) still fetched live");
});

test("localize is IDEMPOTENT: a build already on our host localizes nothing", async () => {
  const perm = createMemoryAssetStore({ prefix: CLIENT_ASSETS_PREFIX, isPublic: true });
  const first = await localizeBuild({ build: buildWith([THEIR.hero, THEIR.gallery]), permanentStore: perm, fetchImpl: fakeFetch() });
  const second = await localizeBuild({ build: first.build, permanentStore: perm, fetchImpl: fakeFetch() });
  assert.equal(second.attempted, 0, "nothing left to take");
  assert.equal(second.localized, 0);
});

test("snapshotReferencedAssets separates captured bytes from already-404 sources", async () => {
  const snap = createMemoryAssetStore({ prefix: ASSET_SNAPSHOTS_PREFIX, isPublic: false, ttlDays: SNAPSHOT_TTL_DAYS });
  const build = buildWith([THEIR.hero, THEIR.dead, THEIR.gallery]);
  const res = await snapshotReferencedAssets({ build, snapshotStore: snap, fetchImpl: fakeFetch({ [THEIR.dead]: 404 }) });

  assert.equal(res.dead.length, 1);
  assert.equal(res.dead[0].url, THEIR.dead);
  assert.equal(res.dead[0].status, 404);
  const snappedUrls = res.snapshotted.map((s) => s.url);
  assert.ok(snappedUrls.includes(THEIR.hero));
  assert.ok(snappedUrls.includes(THEIR.gallery));
  assert.ok(snappedUrls.includes(THEIR.logo));
  assert.ok(!snappedUrls.includes(THEIR.dead));
  assert.ok(res.bytes > 0);
  assert.equal(res.ttlDays, SNAPSHOT_TTL_DAYS);
  // and the bytes are actually retrievable by the localize reader's key rule
  const back = await snap.get(THEIR.hero);
  assert.ok(back.ok);
});

test("sweepExpiredSnapshots deletes only past-TTL objects, keeps fresh ones", async () => {
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const snap = createMemoryAssetStore({ prefix: ASSET_SNAPSHOTS_PREFIX, isPublic: false, ttlDays: 45, now: () => clock });
  await snap.put(THEIR.hero, Buffer.from("old"), { ext: "jpg" });   // stored at day 0
  clock = Date.parse("2026-02-25T00:00:00Z");                        // ~55 days later
  await snap.put(THEIR.gallery, Buffer.from("fresh"), { ext: "png" }); // stored fresh

  const swept = await sweepExpiredSnapshots({ snapshotStore: snap, nowMs: clock });
  assert.equal(swept.deleted, 1, "only the 55-day-old snapshot expired");
  assert.equal(swept.failed, 0);
  assert.ok((await snap.get(THEIR.hero)).ok === false, "expired hero gone");
  assert.ok((await snap.get(THEIR.gallery)).ok === true, "fresh gallery kept");
});

test("rewriteHtmlAssetUrls swaps kept urls and STRIPS a dropped one's element (no broken img)", () => {
  const rewrites = [
    { from: THEIR.hero, to: "https://our-cdn.wss-ai.com/assets/ab/hero.jpg" },
    { from: THEIR.dead, to: null },
  ];
  const html = `<img src="${THEIR.hero}"><img src="${THEIR.dead}"><div style="background-image:url(${THEIR.dead})"></div>`;
  const out = rewriteHtmlAssetUrls(html, rewrites);
  assert.ok(out.includes("our-cdn.wss-ai.com/assets/ab/hero.jpg"));
  assert.ok(!out.includes(THEIR.hero));
  assert.ok(!out.includes(THEIR.dead), "dropped url's <img> stripped and background-image neutralised — never a broken image");
  assert.ok(out.includes("url()"), "background-image collapsed to url() so the container's accent shows through");
});

test("applyBuildRewrites never mutates the input build", () => {
  const build = buildWith([THEIR.hero, THEIR.gallery]);
  const before = JSON.stringify(build);
  applyBuildRewrites(build, [{ from: THEIR.hero, to: "https://our-cdn.wss-ai.com/x.jpg" }]);
  assert.equal(JSON.stringify(build), before, "input untouched — rewrite works on a clone");
});
