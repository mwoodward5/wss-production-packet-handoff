import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFixedBlobGhostPreviewStore,
  createGhostPreviewIdempotencyCore,
} from "../lib/ghost-preview-idempotency.mjs";

function assertStatusIsNotCacheable(response) {
  assert.match(response.headers.get("cache-control") || "", /\bno-store\b/i);
  assert.match(response.headers.get("cdn-cache-control") || "", /\bno-store\b/i);
  assert.match(response.headers.get("vercel-cdn-cache-control") || "", /\bno-store\b/i);
}

function memoryClaimStore() {
  const leases = new Map();
  return {
    assertAvailable() {},
    async claim(input) {
      const key = `${input.ownerId}\0${input.idempotencyKey}`;
      const existing = leases.get(key);
      if (existing) return { owner: false, lease: structuredClone(existing), envelope: structuredClone(existing.envelope) };
      const lease = {
        owner_id: input.ownerId,
        idempotency_key: input.idempotencyKey,
        payload_hash: input.payloadHash,
        build_id: input.buildId,
        accepted_at: input.acceptedAt,
        envelope: input.envelope,
      };
      leases.set(key, lease);
      return { owner: true, lease: structuredClone(lease), envelope: structuredClone(lease.envelope) };
    },
  };
}

test("Ghost preview HTTP route claims once, replays one durable job, and fails closed", async () => {
  process.env.NODE_ENV = "test";
  process.env.SITEFORGE_NO_LISTEN = "1";
  process.env.SITEFORGE_SERVERLESS = "0";
  delete process.env.VERCEL;
  process.env.SITEFORGE_GHOST_AGENCY_TOKEN = "ghost-route-test-token";
  process.env.SITEFORGE_DATA_DIR = mkdtempSync(path.join(tmpdir(), "sf-ghost-idempotency-"));

  const {
    server,
    configureGhostPreviewCompilerForTests,
    configureGhostPreviewIdempotencyForTests,
  } = await import("../server.mjs");
  const DB = await import("../lib/store.mjs");
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = (body, { key, correlationId } = {}) => fetch(`${baseUrl}/api/ghost-agency/build-preview`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.SITEFORGE_GHOST_AGENCY_TOKEN}`,
      "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
      ...(correlationId ? { "x-correlation-id": correlationId } : {}),
    },
    body: JSON.stringify(body),
  });

  try {
    let compileCount = 0;
    let releaseCompiler;
    let compilerEntered;
    const entered = new Promise((resolve) => { compilerEntered = resolve; });
    const compilerGate = new Promise((resolve) => { releaseCompiler = resolve; });
    configureGhostPreviewCompilerForTests(async () => {
      compileCount += 1;
      compilerEntered();
      await compilerGate;
      return {
        ok: false,
        status: "blocked",
        code: "fixture_source_blocked",
        error: "Fixture compiler blocked safely.",
        version: "fixture-v1",
        cache: { hit: false },
      };
    });

    const core = createGhostPreviewIdempotencyCore({ store: memoryClaimStore() });
    configureGhostPreviewIdempotencyForTests(core);
    const correlationId = "ghost-route-correlation-001";
    const key = "ghost-route-idempotency-001";
    const body = {
      job: { id: correlationId },
      prospect: { business_name: "Idempotent Fixture" },
      packets: { truth: {} },
    };

    const ownerPromise = post(body, { key, correlationId });
    await entered;
    const concurrentReplay = await post(body, { key, correlationId });
    const concurrentBody = await concurrentReplay.json();
    assert.equal(concurrentReplay.status, 202);
    assert.equal(concurrentBody.pending, true);
    assert.equal(concurrentBody.correlation_id, correlationId);

    releaseCompiler();
    const ownerResponse = await ownerPromise;
    const ownerBody = await ownerResponse.json();
    assert.equal(ownerResponse.status, 422);
    assert.equal(ownerBody.job_id, concurrentBody.job_id);
    assert.equal(ownerBody.correlation_id, correlationId);
    assert.equal(ownerBody.code, "fixture_source_blocked");

    const statusResponse = await fetch(`${baseUrl}/api/ghost-agency/build-preview/${ownerBody.job_id}`, {
      headers: { authorization: `Bearer ${process.env.SITEFORGE_GHOST_AGENCY_TOKEN}` },
    });
    assert.equal(statusResponse.status, 422);
    assertStatusIsNotCacheable(statusResponse);
    assert.equal((await statusResponse.json()).job_id, ownerBody.job_id);

    const unauthorizedStatus = await fetch(`${baseUrl}/api/ghost-agency/build-preview/${ownerBody.job_id}`);
    assert.equal(unauthorizedStatus.status, 401);
    assertStatusIsNotCacheable(unauthorizedStatus);

    const completedReplay = await post(body, { key, correlationId });
    const completedBody = await completedReplay.json();
    assert.equal(completedReplay.status, 422);
    assert.equal(completedBody.job_id, ownerBody.job_id);
    assert.equal(completedBody.correlation_id, ownerBody.correlation_id);
    assert.equal(completedBody.code, ownerBody.code);
    assert.equal(completedBody.error, ownerBody.error);
    assert.equal(compileCount, 1);
    const winnerJobs = DB.all("jobs").filter((job) => job.error_code !== "ghost_preview_idempotency_replay_superseded");
    assert.equal(winnerJobs.filter((job) => job.id === ownerBody.job_id).length, 1);
    assert.equal(winnerJobs.filter((job) => job.status !== "blocked").length, 0);

    const changed = await post({
      ...body,
      prospect: { ...body.prospect, city: "Changed City" },
    }, { key, correlationId });
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error_code, "GHOST_PREVIEW_IDEMPOTENCY_KEY_CONFLICT");
    assert.equal(compileCount, 1);

    const missingStableKey = await post({ prospect: {} });
    assert.equal(missingStableKey.status, 400);
    assert.equal((await missingStableKey.json()).error_code, "GHOST_PREVIEW_IDEMPOTENCY_KEY_REQUIRED");

    const missingCorrelation = await post({ prospect: {} }, { key: "ghost-route-idempotency-missing-correlation" });
    assert.equal(missingCorrelation.status, 400);
    assert.equal((await missingCorrelation.json()).error_code, "GHOST_PREVIEW_CORRELATION_ID_REQUIRED");

    const mismatch = await post(body, { key: "ghost-route-idempotency-mismatch", correlationId: "different-correlation" });
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).error_code, "GHOST_PREVIEW_CORRELATION_ID_MISMATCH");

    configureGhostPreviewIdempotencyForTests(createGhostPreviewIdempotencyCore({
      store: createFixedBlobGhostPreviewStore({ env: {} }),
    }));
    const unavailable = await post({
      job: { id: "ghost-route-store-unavailable" },
      prospect: {},
    }, {
      key: "ghost-route-store-unavailable",
      correlationId: "ghost-route-store-unavailable",
    });
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error_code, "GHOST_PREVIEW_IDEMPOTENCY_STORE_UNAVAILABLE");
    assert.equal(compileCount, 1);

    configureGhostPreviewIdempotencyForTests(createGhostPreviewIdempotencyCore({ store: memoryClaimStore() }));
    configureGhostPreviewCompilerForTests(async () => ({
      ok: false,
      status: "blocked",
      code: "legacy_fixture_blocked",
      error: "Legacy fixture blocked safely.",
    }));
    const legacyBody = {
      job: { id: "ghost-route-legacy-body-key" },
      prospect: {},
    };
    const legacy = await post(legacyBody, { correlationId: legacyBody.job.id });
    assert.equal(legacy.status, 422);
    assert.equal((await legacy.json()).correlation_id, legacyBody.job.id);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    DB.flush();
    const dataDir = path.resolve(process.env.SITEFORGE_DATA_DIR);
    assert.ok(dataDir.startsWith(path.resolve(tmpdir())));
    process.env.SITEFORGE_SERVERLESS = "1";
    rmSync(dataDir, { recursive: true, force: true });
  }
});
