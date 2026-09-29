import test from "node:test";
import assert from "node:assert/strict";
import { BlobNotFoundError } from "@vercel/blob";
import {
  canonicalJson,
  createFixedBlobGhostPreviewStore,
  createGhostPreviewIdempotencyCore,
  GhostPreviewIdempotencyError,
  ghostPreviewPayloadHash,
} from "../lib/ghost-preview-idempotency.mjs";

function memoryClaimStore() {
  const leases = new Map();
  const calls = [];
  return {
    calls,
    assertAvailable() {},
    async claim(input) {
      calls.push(input);
      const existing = leases.get(`${input.ownerId}\0${input.idempotencyKey}`);
      if (existing) return { owner: false, lease: structuredClone(existing), envelope: structuredClone(existing.envelope) };
      const lease = {
        owner_id: input.ownerId,
        idempotency_key: input.idempotencyKey,
        payload_hash: input.payloadHash,
        build_id: input.buildId,
        accepted_at: input.acceptedAt,
        envelope: input.envelope,
      };
      leases.set(`${input.ownerId}\0${input.idempotencyKey}`, lease);
      return { owner: true, lease: structuredClone(lease), envelope: structuredClone(lease.envelope) };
    },
  };
}

function input(overrides = {}) {
  return {
    idempotencyKey: "ghost-preview-20260727-001",
    correlationId: "ghost-job-001",
    payload: { prospect: { name: "Atlas", city: "Austin" }, packets: { truth: { services: ["Roof repair"] } } },
    ...overrides,
  };
}

test("canonical hashing recursively sorts object keys while preserving array order", () => {
  const left = { z: [{ b: 2, a: 1 }], a: { d: "x", c: true } };
  const right = { a: { c: true, d: "x" }, z: [{ a: 1, b: 2 }] };
  assert.equal(canonicalJson(left), '{"a":{"c":true,"d":"x"},"z":[{"a":1,"b":2}]}');
  assert.equal(ghostPreviewPayloadHash(left), ghostPreviewPayloadHash(right));
  assert.notEqual(ghostPreviewPayloadHash(left), ghostPreviewPayloadHash({ ...right, z: [{ a: 2, b: 1 }] }));
});

test("claim requires an explicit idempotency key and caller correlation ID", async () => {
  const core = createGhostPreviewIdempotencyCore({ store: memoryClaimStore() });
  await assert.rejects(core.claim(input({ idempotencyKey: "" })), (error) => error instanceof GhostPreviewIdempotencyError && error.code === "GHOST_PREVIEW_IDEMPOTENCY_KEY_REQUIRED");
  await assert.rejects(core.claim(input({ correlationId: "" })), (error) => error instanceof GhostPreviewIdempotencyError && error.code === "GHOST_PREVIEW_CORRELATION_ID_REQUIRED");
});

test("same Ghost key and payload selects one owner and replays its job ID", async () => {
  const store = memoryClaimStore();
  const core = createGhostPreviewIdempotencyCore({ store });
  const owner = await core.claim(input());
  const follower = await core.claim(input({ correlationId: "a-different-caller-correlation" }));

  assert.equal(owner.owner, true);
  assert.equal(owner.replay, false);
  assert.equal(follower.owner, false);
  assert.equal(follower.replay, true);
  assert.equal(follower.jobId, "ghost-job-001");
  assert.equal(follower.correlationId, "ghost-job-001");
  assert.equal(store.calls.length, 2);
  assert.equal(store.calls[0].ownerId, "ghost-agency");
});

test("transport timestamps and caller job metadata do not break a safe retry", async () => {
  const core = createGhostPreviewIdempotencyCore({ store: memoryClaimStore() });
  const owner = await core.claim(input({
    payload: {
      ...input().payload,
      requestedAt: "2026-07-27T12:00:00.000Z",
      job: { id: "ghost-job-001", product: "Preview" },
    },
  }));
  const retry = await core.claim(input({
    payload: {
      ...input().payload,
      requestedAt: "2026-07-27T12:01:00.000Z",
      job: { id: "ghost-job-001", product: "Preview retry" },
    },
  }));

  assert.equal(owner.owner, true);
  assert.equal(retry.replay, true);
  assert.equal(retry.jobId, owner.jobId);
});

test("a caller correlation can be bound to a distinct durable job ID", async () => {
  const core = createGhostPreviewIdempotencyCore({ store: memoryClaimStore() });
  const owner = await core.claim(input({ correlationId: "ghost-correlation-001", jobId: "siteforge-job-001" }));
  const follower = await core.claim(input({ correlationId: "ghost-correlation-001", jobId: "siteforge-job-002" }));
  assert.equal(owner.jobId, "siteforge-job-001");
  assert.equal(follower.jobId, "siteforge-job-001");
  assert.equal(follower.correlationId, "ghost-correlation-001");
});

test("concurrent same-key requests have one owner", async () => {
  const core = createGhostPreviewIdempotencyCore({ store: memoryClaimStore() });
  const [first, second] = await Promise.all([
    core.claim(input()),
    core.claim(input({ correlationId: "ghost-job-002" })),
  ]);
  assert.equal([first.owner, second.owner].filter(Boolean).length, 1);
  assert.equal(first.jobId, second.jobId);
});

test("a changed payload under the same Ghost key conflicts", async () => {
  const core = createGhostPreviewIdempotencyCore({ store: memoryClaimStore() });
  await core.claim(input());
  await assert.rejects(
    core.claim(input({ payload: { prospect: { name: "Different Business" } } })),
    (error) => error instanceof GhostPreviewIdempotencyError && error.status === 409 && error.code === "GHOST_PREVIEW_IDEMPOTENCY_KEY_CONFLICT",
  );
});

test("effective checkout aliases are hashed using route precedence", async () => {
  const core = createGhostPreviewIdempotencyCore({ store: memoryClaimStore() });
  await core.claim(input({
    payload: {
      ...input().payload,
      purchase_url: "",
      purchaseUrl: "https://checkout.example.test/a",
    },
  }));
  await assert.rejects(
    core.claim(input({
      payload: {
        ...input().payload,
        purchase_url: "",
        purchaseUrl: "https://checkout.example.test/b",
      },
    })),
    (error) => error instanceof GhostPreviewIdempotencyError
      && error.code === "GHOST_PREVIEW_IDEMPOTENCY_KEY_CONFLICT",
  );
});

test("default production store fails closed without Blob configuration", async () => {
  const core = createGhostPreviewIdempotencyCore({
    store: createFixedBlobGhostPreviewStore({ env: {} }),
  });
  await assert.rejects(
    core.claim(input()),
    (error) => error instanceof GhostPreviewIdempotencyError && error.status === 503 && error.code === "GHOST_PREVIEW_IDEMPOTENCY_STORE_UNAVAILABLE",
  );
});

test("Vercel Blob missing-key error without status proceeds to immutable claim write", async () => {
  const putCalls = [];
  const blobClient = {
    async head() {
      throw new BlobNotFoundError();
    },
    async put(pathname, body, options) {
      putCalls.push({ pathname, body, options });
      return { pathname, url: `https://blob.example.test/${pathname}` };
    },
  };
  const core = createGhostPreviewIdempotencyCore({
    store: createFixedBlobGhostPreviewStore({ blobClient }),
  });

  const claim = await core.claim(input());

  assert.equal(claim.owner, true);
  assert.equal(claim.replay, false);
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].options.allowOverwrite, false);
  assert.equal(putCalls[0].options.addRandomSuffix, false);
});

test("fixed Blob claims one owner under a concurrent write race", async () => {
  const files = new Map();
  const blobClient = {
    async head(pathname) {
      if (!files.has(pathname)) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return { pathname, etag: "winner-etag", url: `https://blob.example.test/${pathname}` };
    },
    async put(pathname, body, options) {
      assert.equal(options.access, "public");
      if (files.has(pathname)) {
        const error = new Error("already exists");
        error.status = 409;
        throw error;
      }
      files.set(pathname, body);
      return { pathname, url: `https://blob.example.test/${pathname}` };
    },
  };
  const core = createGhostPreviewIdempotencyCore({
    store: createFixedBlobGhostPreviewStore({
      blobClient,
      async fetchFn(url, options) {
        assert.equal(options.cache, "no-store");
        assert.equal(url.searchParams.get("__sf_claim_etag"), "winner-etag");
        const pathname = url.pathname.replace(/^\//, "");
        return new Response(files.get(pathname), { status: files.has(pathname) ? 200 : 404 });
      },
    }),
  });
  const [first, second] = await Promise.all([
    core.claim(input({ jobId: "siteforge-job-one" })),
    core.claim(input({ jobId: "siteforge-job-two" })),
  ]);

  assert.equal([first.owner, second.owner].filter(Boolean).length, 1);
  assert.equal(first.jobId, second.jobId);
  assert.equal(files.size, 1);
});

test("fixed Blob lease remains replayable beyond a daily contract lease window", async () => {
  const files = new Map();
  const blobClient = {
    async head(pathname) {
      if (!files.has(pathname)) {
        const error = new Error("not found");
        error.status = 404;
        throw error;
      }
      return { pathname, etag: "durable-etag", url: `https://blob.example.test/${pathname}` };
    },
    async put(pathname, body, options) {
      assert.equal(options.access, "public");
      assert.equal(options.allowOverwrite, false);
      assert.equal(options.addRandomSuffix, false);
      if (files.has(pathname)) {
        const error = new Error("already exists");
        error.status = 409;
        throw error;
      }
      files.set(pathname, body);
      return { pathname, url: `https://blob.example.test/${pathname}` };
    },
  };
  let current = new Date("2026-07-30T12:00:00.000Z");
  const core = createGhostPreviewIdempotencyCore({
    store: createFixedBlobGhostPreviewStore({
      blobClient,
      async fetchFn(url, options) {
        assert.equal(options.cache, "no-store");
        assert.equal(url.searchParams.get("__sf_claim_etag"), "durable-etag");
        const pathname = url.pathname.replace(/^\//, "");
        return new Response(files.get(pathname), { status: files.has(pathname) ? 200 : 404 });
      },
    }),
    now: () => new Date(current),
  });
  const first = await core.claim(input());
  current = new Date("2026-08-02T12:00:00.000Z");
  const replay = await core.claim(input({ correlationId: "ghost-job-a-week-later" }));
  assert.equal(first.owner, true);
  assert.equal(replay.replay, true);
  assert.equal(replay.jobId, first.jobId);
  assert.equal(files.size, 1);
});
