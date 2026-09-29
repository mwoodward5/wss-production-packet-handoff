"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { Readable } = require("node:stream");
const test = require("node:test");

const route = require("../api/admin/hero-source-asset");
const {
  CLIENT_ASSETS_PREFIX,
  assetKeyForSha256,
  createMemoryAssetStore,
} = require("../lib/client-asset-store");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");
const JOB_ID = "hrj_source_proxy";
const PROSPECT_ID = "wss-test-source-proxy";
const LEASE = "lease_source_proxy";

function jobWithPhoto(sha256 = PNG_SHA) {
  return {
    jobId: JOB_ID,
    prospectId: PROSPECT_ID,
    producer: "openrouter_seedance",
    status: "running",
    payload: {
      photo_bank: {
        photos: [{
          url: "https://client.example.com/work/photo.png",
          sha256,
          source: "website",
        }],
      },
    },
  };
}

function headers(overrides = {}) {
  return {
    "content-type": "application/octet-stream",
    "content-length": String(PNG.length),
    "x-ghost-hero-job-id": JOB_ID,
    "x-ghost-prospect-id": PROSPECT_ID,
    "x-ghost-source-sha256": PNG_SHA,
    "x-ghost-hero-job-lease": LEASE,
    ...overrides,
  };
}

function request(bytes = PNG, headerOverrides = {}) {
  const req = Readable.from([bytes]);
  req.method = "POST";
  req.headers = headers(headerOverrides);
  return req;
}

function response() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    end(value) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(value));
    },
  };
}

function validHandler(overrides = {}) {
  return route.createHeroSourceAssetHandler({
    validateHeroReelJobCapabilityLease: async (input) => ({
      ok: true,
      job: jobWithPhoto(),
      input,
    }),
    sourceAssetStore: createMemoryAssetStore({
      prefix: CLIENT_ASSETS_PREFIX,
      host: "source-assets.wss-ai.com",
    }),
    ...overrides,
  });
}

test("an invalid generate lease is rejected before the raw body is read", async () => {
  let bodyReads = 0;
  const req = {
    method: "POST",
    headers: headers(),
    get body() {
      bodyReads += 1;
      throw new Error("body_must_not_be_read");
    },
  };
  const handler = validHandler({
    validateHeroReelJobCapabilityLease: async () => ({ ok: false, error: "capability_lease_conflict" }),
  });
  const res = response();
  await handler(req, res);
  assert.equal(res.captured.status, 409);
  assert.equal(res.captured.body.error, "capability_lease_conflict");
  assert.equal(bodyReads, 0);
});

test("job, prospect, and frozen-photo mismatch are rejected before body or storage", async (t) => {
  for (const [name, reqHeaders, validatedJob] of [
    ["job", {}, { ...jobWithPhoto(), jobId: "hrj_other" }],
    ["prospect", {}, { ...jobWithPhoto(), prospectId: "wss-test-other" }],
    ["source SHA", { "x-ghost-source-sha256": "f".repeat(64) }, jobWithPhoto()],
  ]) {
    await t.test(name, async () => {
      const calls = { body: 0, bucket: 0, put: 0 };
      const req = {
        method: "POST",
        headers: headers(reqHeaders),
        get body() {
          calls.body += 1;
          throw new Error("body_must_not_be_read");
        },
      };
      const handler = route.createHeroSourceAssetHandler({
        validateHeroReelJobCapabilityLease: async () => ({ ok: true, job: validatedJob }),
        sourceAssetStore: {
          async ensureBucket() { calls.bucket += 1; return { ok: true }; },
          async putContentAddressed() { calls.put += 1; return { ok: true }; },
        },
      });
      const res = response();
      await handler(req, res);
      assert.equal(res.captured.status, 409);
      assert.match(res.captured.body.error, /source_asset_target_conflict|source_not_in_claimed_job/);
      assert.deepEqual(calls, { body: 0, bucket: 0, put: 0 });
    });
  }
});

test("an exact leased image is inserted at its immutable SHA key", async () => {
  const calls = [];
  const backing = createMemoryAssetStore({
    prefix: CLIENT_ASSETS_PREFIX,
    host: "source-assets.wss-ai.com",
  });
  const handler = validHandler({
    validateHeroReelJobCapabilityLease: async (input) => {
      calls.push(["lease", input]);
      return { ok: true, job: jobWithPhoto() };
    },
    sourceAssetStore: {
      ensureBucket: () => backing.ensureBucket(),
      async putContentAddressed(bytes, options) {
        calls.push(["put", Buffer.from(bytes), options]);
        return backing.putContentAddressed(bytes, options);
      },
    },
  });
  const res = response();
  await handler(request(), res);

  const expectedKey = assetKeyForSha256(PNG_SHA, { prefix: CLIENT_ASSETS_PREFIX, ext: "png" });
  assert.equal(res.captured.status, 200, JSON.stringify(res.captured.body));
  assert.deepEqual(res.captured.body, {
    ok: true,
    url: `https://source-assets.wss-ai.com/${expectedKey}`,
    key: expectedKey,
    sha256: PNG_SHA,
  });
  assert.deepEqual(calls[0], ["lease", {
    jobId: JOB_ID,
    leaseToken: LEASE,
    phase: "generate",
  }]);
  assert.equal(calls[1][0], "put");
  assert.deepEqual(calls[1][1], PNG);
  assert.deepEqual(calls[1][2], {
    sha256: PNG_SHA,
    ext: "png",
    contentType: "image/png",
  });
});

test("a duplicate exact object is accepted only through content-addressed readback", async () => {
  const store = createMemoryAssetStore({
    prefix: CLIENT_ASSETS_PREFIX,
    host: "source-assets.wss-ai.com",
  });
  const handler = validHandler({ sourceAssetStore: store });

  const first = response();
  await handler(request(), first);
  const second = response();
  await handler(request(), second);

  assert.equal(first.captured.status, 200);
  assert.equal(second.captured.status, 200);
  assert.deepEqual(second.captured.body, first.captured.body);
  assert.deepEqual(Object.keys(second.captured.body).sort(), ["key", "ok", "sha256", "url"]);
});

test("an oversized raw body is refused before storage", async () => {
  const writes = [];
  const handler = validHandler({
    maxBytes: PNG.length - 1,
    sourceAssetStore: {
      async ensureBucket() { writes.push("bucket"); return { ok: true }; },
      async putContentAddressed() { writes.push("put"); return { ok: true }; },
    },
  });
  const res = response();
  await handler(request(), res);
  assert.equal(res.captured.status, 413);
  assert.equal(res.captured.body.error, "source_image_too_large");
  assert.deepEqual(writes, []);
});

test("a matching header cannot store different bytes", async () => {
  const writes = [];
  const bytes = Buffer.concat([PNG, Buffer.from([0])]);
  const handler = validHandler({
    sourceAssetStore: {
      async ensureBucket() { writes.push("bucket"); return { ok: true }; },
      async putContentAddressed() { writes.push("put"); return { ok: true }; },
    },
  });
  const res = response();
  await handler(request(bytes, { "content-length": String(bytes.length) }), res);
  assert.equal(res.captured.status, 409);
  assert.equal(res.captured.body.error, "source_sha256_mismatch");
  assert.deepEqual(writes, []);
});

test("hash-matched unsupported bytes are refused before storage", async () => {
  const writes = [];
  const bytes = Buffer.from("not an image");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const handler = validHandler({
    validateHeroReelJobCapabilityLease: async () => ({ ok: true, job: jobWithPhoto(digest) }),
    sourceAssetStore: {
      async ensureBucket() { writes.push("bucket"); return { ok: true }; },
      async putContentAddressed() { writes.push("put"); return { ok: true }; },
    },
  });
  const res = response();
  await handler(request(bytes, {
    "content-length": String(bytes.length),
    "x-ghost-source-sha256": digest,
  }), res);
  assert.equal(res.captured.status, 415);
  assert.equal(res.captured.body.error, "source_image_type_invalid");
  assert.deepEqual(writes, []);
});
