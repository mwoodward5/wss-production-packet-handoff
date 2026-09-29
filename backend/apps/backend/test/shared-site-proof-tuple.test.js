"use strict";

// Shared wildcard hosts keep one public URL while immutable releases change
// behind it. These tests exercise only injected in-memory fakes: no Chromium,
// network request, Supabase read, or Supabase write is permitted.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeProofIdentity,
  proofObjectPath,
  proofMetaPath,
} = require("../lib/proof-storage");
const {
  ensureLineProofShots,
  storedShotIsCurrent,
  mainDocumentResponseIdentity,
} = require("../lib/line-proof-shots");

const PREVIEW = "https://wss-test-shared-plumber.wss-ai.com/";
const IDENTITY = Object.freeze({
  site_id: "site_01JSHARED",
  release_id: "release_0001",
  build_hash: "a".repeat(64),
});
function injectedCapture({ responseIdentity = IDENTITY, readResponseIdentity } = {}) {
  const writes = [];
  const calls = { captures: 0, reads: 0, identities: 0 };
  return {
    writes,
    calls,
    captureShot: async ({ url, variant }) => {
      calls.captures += 1;
      return {
        buffer: Buffer.from(`jpeg:${variant}`),
        landed: `${url}?wssthumb=1`,
        response: {
          headers: () => ({
            "x-wss-site-id": responseIdentity.site_id || "",
            "x-wss-release-id": responseIdentity.release_id || "",
            "x-wss-build-hash": responseIdentity.build_hash || "",
            "x-wss-route-generation": "route-generation-7",
          }),
        },
      };
    },
    readProofShot: async () => {
      calls.reads += 1;
      return { ok: false, status: 404 };
    },
    writeProofShot: async (path, buffer, options) => {
      writes.push({ path, buffer: Buffer.from(buffer), options });
      return { ok: true, bytes: buffer.length };
    },
    readResponseIdentity: readResponseIdentity || (async ({ response }) => {
      calls.identities += 1;
      return mainDocumentResponseIdentity({ response });
    }),
  };
}

test("legacy proof keys remain byte-for-byte stable when site_id/release_id are absent", async () => {
  const legacy = proofObjectPath({ url: "https://www.example.com/", variant: "new" });
  assert.equal(
    legacy,
    "preview-shots/new/ae2409cde9bb859898865344b1924322511ea1d36ff58877c18c39c54d473967.jpg",
  );
  assert.equal(
    proofObjectPath({
      url: "http://example.com",
      variant: "new",
      proofIdentity: { build_hash: "legacy-build-hash-only" },
    }),
    legacy,
    "build_hash alone is the existing legacy mode, not a partial shared tuple",
  );

  const harness = injectedCapture({
    readResponseIdentity: async () => {
      throw new Error("legacy capture must never read shared response identity");
    },
  });
  await ensureLineProofShots({
    previewUrl: PREVIEW,
    buildHash: "legacy-build",
    captureShot: harness.captureShot,
    readProofShot: harness.readProofShot,
    writeProofShot: harness.writeProofShot,
    readResponseIdentity: harness.readResponseIdentity,
  });
  const sidecar = JSON.parse(harness.writes.find(({ path }) => path === proofMetaPath({
    url: PREVIEW,
    variant: "new",
  })).buffer.toString("utf8"));
  assert.equal(sidecar.schema, "wss-proof-shot-meta-v2");
  assert.equal(sidecar.build_hash, "legacy-build");
  assert.equal(Object.hasOwn(sidecar, "site_id"), false);
  assert.equal(Object.hasOwn(sidecar, "release_id"), false);
});

test("shared proof keys bind site_id + release_id + build_hash while old keys stay unchanged", () => {
  const releaseTwo = { ...IDENTITY, release_id: "release_0002" };
  const otherSite = { ...IDENTITY, site_id: "site_02OTHER" };
  const otherBuild = { ...IDENTITY, build_hash: "b".repeat(64) };
  const one = proofObjectPath({ url: PREVIEW, variant: "new", proofIdentity: IDENTITY });
  assert.match(one, /^preview-shots\/new\/[0-9a-f]{64}\.jpg$/);
  assert.notEqual(one, proofObjectPath({ url: PREVIEW, variant: "new", proofIdentity: releaseTwo }));
  assert.notEqual(one, proofObjectPath({ url: PREVIEW, variant: "new", proofIdentity: otherSite }));
  assert.notEqual(one, proofObjectPath({ url: PREVIEW, variant: "new", proofIdentity: otherBuild }));
  assert.notEqual(
    proofObjectPath({ url: PREVIEW, variant: "new-mobile", proofIdentity: IDENTITY }),
    one,
    "desktop and phone remain different images of the same release",
  );

  const oldLegacy = proofObjectPath({ url: "https://client.example/", variant: "old" });
  assert.equal(
    proofObjectPath({ url: "https://client.example/", variant: "old", proofIdentity: IDENTITY }),
    oldLegacy,
    "the prospect's before-shot identity law and key are unchanged",
  );
});

test("partial shared identity is rejected consistently before capture or storage", async () => {
  const partial = { site_id: IDENTITY.site_id, release_id: IDENTITY.release_id };
  assert.deepEqual(normalizeProofIdentity({ proofIdentity: partial }), {
    active: true,
    valid: false,
    reason: "shared_proof_identity_incomplete",
    site_id: IDENTITY.site_id,
    release_id: IDENTITY.release_id,
    build_hash: "",
  });
  assert.equal(proofObjectPath({ url: PREVIEW, variant: "new", proofIdentity: partial }), "");

  const harness = injectedCapture();
  const out = await ensureLineProofShots({
    previewUrl: PREVIEW,
    proofIdentity: partial,
    captureShot: harness.captureShot,
    readProofShot: harness.readProofShot,
    writeProofShot: harness.writeProofShot,
    readResponseIdentity: harness.readResponseIdentity,
  });
  assert.equal(out.ok, false);
  assert.equal(harness.calls.captures, 0);
  assert.equal(harness.calls.reads, 0);
  assert.equal(harness.writes.length, 0);
  assert.ok(out.results.every(({ reason }) => reason === "shared_proof_identity_incomplete"));
});

test("matching main-document identity stores v3 sidecars bound to the exact shared tuple", async () => {
  const harness = injectedCapture();
  const out = await ensureLineProofShots({
    previewUrl: PREVIEW,
    buildHash: IDENTITY.build_hash,
    proofIdentity: IDENTITY,
    captureShot: harness.captureShot,
    readProofShot: harness.readProofShot,
    writeProofShot: harness.writeProofShot,
    readResponseIdentity: harness.readResponseIdentity,
  });
  assert.equal(harness.calls.captures, 2);
  assert.equal(harness.calls.identities, 2, "the injected response reader runs for both new-site captures");
  assert.equal(harness.writes.length, 4, "each JPEG has one adjacent sidecar");
  assert.equal(out.shots.site_id, IDENTITY.site_id);
  assert.equal(out.shots.release_id, IDENTITY.release_id);
  assert.equal(out.shots.build_hash, IDENTITY.build_hash);

  for (const variant of ["new", "new-mobile"]) {
    const objectPath = proofObjectPath({ url: PREVIEW, variant, proofIdentity: IDENTITY });
    const metaPath = proofMetaPath({ url: PREVIEW, variant, proofIdentity: IDENTITY });
    assert.ok(harness.writes.some(({ path }) => path === objectPath));
    const metaWrite = harness.writes.find(({ path }) => path === metaPath);
    assert.ok(metaWrite, `${variant} sidecar missing`);
    const meta = JSON.parse(metaWrite.buffer.toString("utf8"));
    assert.equal(meta.schema, "wss-proof-shot-meta-v3");
    assert.equal(meta.site_id, IDENTITY.site_id);
    assert.equal(meta.release_id, IDENTITY.release_id);
    assert.equal(meta.build_hash, IDENTITY.build_hash);
    assert.equal(meta.route_generation, "route-generation-7");
  }
});

test("a main-document release mismatch refuses before any image or sidecar upload", async () => {
  const harness = injectedCapture({
    responseIdentity: { ...IDENTITY, release_id: "release_WRONG" },
  });
  const out = await ensureLineProofShots({
    previewUrl: PREVIEW,
    buildHash: IDENTITY.build_hash,
    proofIdentity: IDENTITY,
    captureShot: harness.captureShot,
    readProofShot: harness.readProofShot,
    writeProofShot: harness.writeProofShot,
    readResponseIdentity: harness.readResponseIdentity,
  });
  assert.equal(out.ok, false);
  assert.equal(harness.calls.captures, 2);
  assert.equal(harness.writes.length, 0, "mismatched response bytes may never reach storage");
  assert.ok(out.results.every(({ reason }) => reason === "capture_identity_response_release_id_mismatch"));
  assert.equal(out.shots.new_captured_url, undefined);
});

test("stored shared shots are reusable only when the identity tuple and pixel digest match", () => {
  const base = {
    variant: "new",
    url: PREVIEW,
    buildHash: IDENTITY.build_hash,
    proofIdentity: IDENTITY,
  };
  const meta = {
    captured_url: `${PREVIEW}?wssthumb=1`,
    site_id: IDENTITY.site_id,
    release_id: IDENTITY.release_id,
    build_hash: IDENTITY.build_hash,
    shot_sha256: "a".repeat(64),
  };
  assert.equal(storedShotIsCurrent({ ...base, meta }).ok, true);
  assert.equal(
    storedShotIsCurrent({ ...base, meta: { ...meta, shot_sha256: "" } }).reason,
    "stored_shot_missing_sha256",
  );
  assert.equal(
    storedShotIsCurrent({ ...base, meta: { ...meta, release_id: "release_OLD" } }).reason,
    "release_id_changed",
  );
  assert.equal(
    storedShotIsCurrent({ ...base, meta: { ...meta, site_id: "site_OTHER" } }).reason,
    "site_id_changed",
  );
  assert.equal(
    storedShotIsCurrent({ ...base, meta: { ...meta, build_hash: "b".repeat(64) } }).reason,
    "build_hash_changed",
  );
});
