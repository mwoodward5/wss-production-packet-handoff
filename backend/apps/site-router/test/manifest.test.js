"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseAndValidateManifest, validReleaseRef } = require("../lib/manifest");
const { MAX_ASSET_BYTES } = require("../lib/constants");
const { fixture, sha256 } = require("./helpers");

function encoded(manifest) {
  return Buffer.from(JSON.stringify(manifest));
}

test("release reference requires exact canonical host, immutable key, tuple, and manifest proof", () => {
  const f = fixture();
  assert.equal(validReleaseRef(f.release, f.host).manifestKey, f.release.manifestKey);
  for (const mutation of [
    { canonicalHost: "other.wss-ai.com" },
    { manifestKey: "sites/wrong/manifest.json" },
    { buildHash: "bad" },
    { manifestSha256: "bad" },
    { routeGeneration: 0 }
  ]) assert.equal(validReleaseRef({ ...f.release, ...mutation }, f.host), null);
});

test("preview release reference permits resolver generation zero only when explicit", () => {
  const f = fixture();
  const zero = { ...f.release, routeGeneration: 0 };
  assert.equal(validReleaseRef(zero, f.host), null);
  assert.equal(validReleaseRef(zero, f.host, { allowZeroGeneration: true }).routeGeneration, 0);
});

test("manifest hash and identity tuple are both mandatory", () => {
  const f = fixture();
  assert.ok(parseAndValidateManifest({ body: f.manifestBody }, f.release));
  assert.throws(
    () => parseAndValidateManifest({ body: Buffer.from(`${f.manifestBody} `) }, f.release),
    /manifest_integrity_mismatch/
  );

  const wrongIdentity = { ...f.manifest, release_id: "release_other" };
  const body = encoded(wrongIdentity);
  assert.throws(
    () => parseAndValidateManifest({ body }, { ...f.release, manifestSha256: sha256(body) }),
    /manifest_identity_mismatch/
  );
});

test("manifest rejects guessed keys, traversal, missing files, and metadata drift", () => {
  const f = fixture();
  const badManifests = [
    {
      ...f.manifest,
      routes: { "/": "missing.html" }
    },
    {
      ...f.manifest,
      routes: { "/../secret": "index.html" }
    },
    {
      ...f.manifest,
      files: {
        ...f.manifest.files,
        "index.html": { ...f.manifest.files["index.html"], key: "sites/other/file" }
      }
    },
    {
      ...f.manifest,
      files: {
        ...f.manifest.files,
        "index.html": { ...f.manifest.files["index.html"], bytes: -1 }
      }
    },
    {
      ...f.manifest,
      files: {
        ...f.manifest.files,
        "index.html": { ...f.manifest.files["index.html"], bytes: MAX_ASSET_BYTES + 1 }
      }
    }
  ];
  for (const manifest of badManifests) {
    const body = encoded(manifest);
    assert.throws(
      () => parseAndValidateManifest({ body }, { ...f.release, manifestSha256: sha256(body) }),
      /invalid_release_manifest/
    );
  }
});
