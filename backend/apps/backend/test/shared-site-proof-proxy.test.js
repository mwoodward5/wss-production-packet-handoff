"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GHOST_AGENCY_VISUAL_SECRET = "test-visual-secret";
process.env.WSS_PROOF_ASSETS_BASE_URL = "https://proof-assets.example";

const {
  signedVisualPath,
  signVisualKey,
  visualProofSignatureInput,
  verifySignedVisualRequest,
} = require("../lib/preview-visuals");
const { proofObjectPath } = require("../lib/proof-storage");
const handler = require("../api/media/preview-shot");

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const RELEASE_ID = "22222222-2222-2222-2222-222222222222";
const BUILD_HASH = "a".repeat(64);
const PROOF_IDENTITY = {
  site_id: SITE_ID,
  release_id: RELEASE_ID,
  build_hash: BUILD_HASH,
};

function queryFor(input) {
  const signed = signedVisualPath(input);
  assert.ok(signed, "expected a signed visual path");
  return Object.fromEntries(new URLSearchParams(signed.split("?")[1]).entries());
}

function mkRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body === undefined ? "" : body; },
  };
}

test("legacy visual URLs remain byte-for-byte unchanged without proofIdentity", () => {
  const common = {
    previewUrl: "https://x.wss-ai.com",
    currentWebsite: "https://old.com",
    nonce: "n1",
  };
  assert.equal(
    signedVisualPath({ ...common, kind: "new" }),
    "/api/media/preview-shot?k=new.aHR0cHM6Ly94Lndzcy1haS5jb20.aHR0cHM6Ly9vbGQuY29t.n1&s=hFHudbldwZ7NEr7R_bJfrDan&v=new",
  );
  assert.equal(
    signedVisualPath({ ...common, kind: "old" }),
    "/api/media/preview-shot?k=old.aHR0cHM6Ly94Lndzcy1haS5jb20.aHR0cHM6Ly9vbGQuY29t.n1&s=LWQov85bwBkfd4NE0qO_psKR&v=old",
  );
  assert.equal(
    signedVisualPath({ ...common, kind: "gif" }),
    "/api/media/preview-shot?k=gif.aHR0cHM6Ly94Lndzcy1haS5jb20.aHR0cHM6Ly9vbGQuY29t.n1&s=2eRKbgHC9YCNODlUrkgkWrsx&v=gif",
  );
  assert.equal(
    signedVisualPath({ ...common, kind: "face-0" }),
    "/api/media/preview-shot?k=face-0.aHR0cHM6Ly94Lndzcy1haS5jb20.aHR0cHM6Ly9vbGQuY29t.n1&s=fqbBsx6YP-4vTXZIgxn2mcqW&v=face-0",
  );
});

test("a complete proofIdentity is signed into the URL and recovered exactly", () => {
  const query = queryFor({
    kind: "new",
    previewUrl: "https://shared-proof.wss-ai.com/",
    nonce: "shared-1",
    proofIdentity: PROOF_IDENTITY,
  });
  assert.ok(query.si);
  assert.ok(query.ri);
  assert.ok(query.bh);
  assert.deepEqual(verifySignedVisualRequest(query), {
    ok: true,
    legacy: false,
    proofIdentity: {
      active: true,
      valid: true,
      ...PROOF_IDENTITY,
    },
  });
});

test("the proxy derives the release-keyed new and new-mobile object paths", async () => {
  const previewUrl = "https://shared-proof-read.wss-ai.com/";
  const jpeg = Buffer.alloc(1024, 7);
  const reads = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    reads.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
    };
  };
  try {
    for (const kind of ["new", "new-mobile"]) {
      const res = mkRes();
      await handler({
        method: "GET",
        query: queryFor({ kind, previewUrl, nonce: `shared-${kind}`, proofIdentity: PROOF_IDENTITY }),
      }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["Content-Type"], "image/jpeg");
      const expectedPath = proofObjectPath({ url: previewUrl, variant: kind, proofIdentity: PROOF_IDENTITY });
      assert.ok(reads.some((url) => url === `https://proof-assets.example/${expectedPath}`));
    }
  } finally {
    global.fetch = realFetch;
  }
});

test("the same preview URL resolves to a different object for each release", async () => {
  const previewUrl = "https://shared-proof-release-change.wss-ai.com/";
  const second = { ...PROOF_IDENTITY, release_id: "33333333-3333-3333-3333-333333333333" };
  const reads = [];
  const jpeg = Buffer.alloc(512, 9);
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    reads.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
    };
  };
  try {
    for (const proofIdentity of [PROOF_IDENTITY, second]) {
      const res = mkRes();
      await handler({
        method: "GET",
        query: queryFor({ kind: "new", previewUrl, nonce: proofIdentity.release_id, proofIdentity }),
      }, res);
      assert.equal(res.statusCode, 200);
    }
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(reads.length, 2);
  assert.notEqual(reads[0], reads[1]);
});

test("partial and malformed proofIdentity inputs never mint a URL", () => {
  const base = { kind: "new", previewUrl: "https://shared-refuse.wss-ai.com/", nonce: "refuse" };
  assert.equal(signedVisualPath({ ...base, proofIdentity: { site_id: SITE_ID, release_id: RELEASE_ID } }), "");
  assert.equal(signedVisualPath({ ...base, proofIdentity: { build_hash: BUILD_HASH } }), "");
  assert.equal(signedVisualPath({ ...base, proofIdentity: { ...PROOF_IDENTITY, build_hash: BUILD_HASH.toUpperCase() } }), "");
  assert.equal(signedVisualPath({ ...base, proofIdentity: "not-an-object" }), "");
});

test("the proxy fails closed on partial, malformed, and tampered tuples", async () => {
  const base = queryFor({
    kind: "new",
    previewUrl: "https://shared-proof-refusal.wss-ai.com/",
    nonce: "shared-refusal",
    proofIdentity: PROOF_IDENTITY,
  });
  const attempts = [];

  const partial = { ...base };
  delete partial.ri;
  attempts.push(partial);

  const tampered = { ...base, bh: Buffer.from("b".repeat(64), "utf8").toString("base64url") };
  attempts.push(tampered);

  const malformed = { ...base, si: Buffer.from("not-a-uuid", "utf8").toString("base64url") };
  malformed.s = signVisualKey(visualProofSignatureInput({
    key: malformed.k,
    si: malformed.si,
    ri: malformed.ri,
    bh: malformed.bh,
  }));
  attempts.push(malformed);

  attempts.push({ ...base, si: [base.si, base.si] });

  const realFetch = global.fetch;
  let storageReads = 0;
  global.fetch = async () => { storageReads += 1; throw new Error("must not read storage"); };
  try {
    for (const query of attempts) {
      const res = mkRes();
      await handler({ method: "GET", query }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body, "bad_signature");
    }
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(storageReads, 0);
});

test("the unsigned v selector cannot change the variant carried by the signed key", async () => {
  const base = queryFor({
    kind: "new",
    previewUrl: "https://shared-proof-variant.wss-ai.com/",
    currentWebsite: "https://shared-proof-variant.example/",
    nonce: "variant-refusal",
    proofIdentity: PROOF_IDENTITY,
  });
  const realFetch = global.fetch;
  let storageReads = 0;
  global.fetch = async () => { storageReads += 1; throw new Error("must not read storage"); };
  try {
    for (const variant of ["gif", "old", "face-0", "new-mobile", "not-a-variant"]) {
      const res = mkRes();
      await handler({ method: "GET", query: { ...base, v: variant } }, res);
      assert.equal(res.statusCode, 403, variant);
      assert.equal(res.body, "bad_signature", variant);
    }
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(storageReads, 0);
});
