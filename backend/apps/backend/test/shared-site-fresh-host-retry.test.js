"use strict";

// Lane B regression tests: the shared mirror's fresh-host provisioning race.
// A brand-new per-site host intermittently answers 502/503/504 (or fails at
// the TLS/network layer) while Vercel finishes provisioning; the same URL
// succeeds seconds later. These tests pin the named retry budgets for preview
// probes and release confirmation, mock every fetch, and sleep zero real ms.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SHARED_PREVIEW_RETRYABLE_STATUSES,
  SHARED_PREVIEW_RETRY_DELAYS_MS,
  SHARED_RELEASE_CONFIRM_RETRY_DELAYS_MS,
  createPublicReleaseVerifier,
  createSharedSitePublisher,
  deterministicReleaseUuid,
  fetchWithSharedRetry,
  isSharedRetryableStatus,
  sharedRetryDelayMs,
} = require("../lib/shared-site-publisher");
const { mirrorReleaseUnconfirmedCause } = require("../lib/mirror-lane-build");
const { ROUTER_PROJECT_ID } = require("../lib/shared-site-host-provisioner");
const { prepareRelease } = require("../lib/shared-site-release");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const BUILD_HASH = "a".repeat(64);
const SLUG = "acme-plumbing";
const HOST = `${SLUG}.wss-ai.com`;
const OPERATION_KEY = "line:batch-one:prospect-one:build-one";
const PREVIEW_SECRET = "publisher-preview-secret-at-least-32-bytes-long";
const ENV = Object.freeze({
  WSS_SHARED_PUBLISH_ENABLED: "1",
  WSS_SHARED_SITE_ALLOWLIST: SLUG,
  WSS_SHARED_SITE_ENV: "test",
  WSS_SITE_PREVIEW_SECRET: PREVIEW_SECRET,
});

function files() {
  return {
    "index.html": Buffer.from("<!doctype html><link rel=stylesheet href=/assets/app.css>"),
    "assets/app.css": Buffer.from("body{color:#123}"),
  };
}

function publisherInput(overrides = {}) {
  return {
    slug: SLUG,
    host: HOST,
    files: files(),
    routeMap: { "/": "index.html", "/assets/app.css": "assets/app.css" },
    buildHash: BUILD_HASH,
    operationKey: OPERATION_KEY,
    ...overrides,
  };
}

function fakeRegistry() {
  const state = { generation: 0, active: null, releases: new Map(), calls: [] };
  return {
    state,
    async ensureSiteIdentity({ slug, host }) {
      state.calls.push(["ensure", slug, host]);
      return { ok: true, site_id: SITE_ID, canonical_slug: slug, canonical_host: host, generation: state.generation };
    },
    async readSiteGeneration() {
      state.calls.push(["read-generation"]);
      return {
        ok: true,
        site_id: SITE_ID,
        canonical_slug: SLUG,
        canonical_host: HOST,
        generation: state.generation,
      };
    },
    async insertStagedRelease(row) {
      state.calls.push(["stage", row.releaseId]);
      if (state.releases.has(row.releaseId)) return { ok: true, state: "staged", replay: true };
      state.releases.set(row.releaseId, { ...row, state: "staged" });
      return { ok: true, state: "staged" };
    },
    async markReleaseVerified(row) {
      state.calls.push(["verify", row.releaseId]);
      const existing = state.releases.get(row.releaseId);
      if (!existing) return { ok: false, reason: "release_missing" };
      existing.state = "verified";
      return { ok: true, state: "verified" };
    },
    async activateReleaseCas({ releaseId, expectedGeneration, environment }) {
      state.calls.push(["activate", releaseId]);
      if (expectedGeneration !== state.generation) return { ok: false, reason: "generation_conflict" };
      const release = state.releases.get(releaseId);
      if (!release || release.state !== "verified") return { ok: false, reason: "release_not_verified" };
      state.generation += 1;
      release.state = "active";
      state.active = { releaseId, environment };
      return { ok: true, generation: state.generation };
    },
    async rollbackReleaseCas() {
      state.calls.push(["rollback"]);
      return { ok: false, reason: "release_not_recorded_previous" };
    },
    async quarantineReleaseCas() {
      state.calls.push(["quarantine"]);
      return { ok: false, reason: "failed_release_identity_mismatch" };
    },
    async registerPreviewGrant() {
      state.calls.push(["register-preview"]);
      return { ok: true };
    },
  };
}

function memoryStorage() {
  const objects = new Map();
  return {
    async readObject({ key }) {
      return objects.has(key)
        ? { ok: true, found: true, body: Buffer.from(objects.get(key)) }
        : { ok: true, found: false };
    },
    async putObjectIfAbsent({ key, body, insertOnly }) {
      assert.equal(insertOnly, true);
      if (objects.has(key)) return { ok: false, exists: true, reason: "object_exists" };
      objects.set(key, Buffer.from(body));
      return { ok: true, inserted: true };
    },
  };
}

const ENSURE_HOST_OK = async ({ host }) => Object.freeze({
  ok: true,
  host,
  projectId: ROUTER_PROJECT_ID,
});

function sleepRecorder() {
  const calls = [];
  const sleep = async (ms) => { calls.push(ms); };
  return { calls, sleep };
}

function statusResponse(status, url) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get() { return null; } },
    async arrayBuffer() { return Buffer.alloc(0); },
  };
}

function previewExchangeResponse(url, cookie = "preview_payload.preview_signature") {
  return {
    ok: true,
    status: 204,
    url,
    headers: {
      getSetCookie() {
        return [`__Host-wss-site-preview=${cookie}; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Strict`];
      },
    },
  };
}

function publicResponse(url, body, identity, overrides = {}) {
  const headers = {
    "x-wss-site-id": identity.siteId,
    "x-wss-release-id": identity.releaseId,
    "x-wss-build-hash": identity.buildHash,
    "x-wss-route-generation": String(identity.generation),
    ...overrides,
  };
  return {
    ok: true,
    status: 200,
    url,
    headers: { get(name) { return headers[name.toLowerCase()] || null; } },
    async arrayBuffer() { return Buffer.from(body); },
  };
}

function preparedRelease() {
  const releaseId = deterministicReleaseUuid({ siteId: SITE_ID, operationKey: OPERATION_KEY, buildHash: BUILD_HASH });
  const prepared = prepareRelease({
    siteId: SITE_ID,
    releaseId,
    buildHash: BUILD_HASH,
    slug: SLUG,
    canonicalHost: HOST,
    expectedGeneration: 0,
    environment: "test",
    env: ENV,
    files: files(),
    routes: publisherInput().routeMap,
  });
  const identity = { siteId: SITE_ID, releaseId, buildHash: BUILD_HASH, generation: 1 };
  return {
    prepared,
    identity,
    verifyInput: {
      previewUrl: `https://${HOST}/`,
      ...identity,
      manifest: prepared.manifest,
      preparedFiles: prepared.preparedFiles,
    },
  };
}

// --- Named retry policy -----------------------------------------------------

test("fresh-host retry policy: budgets are named, ordered, and cover 502/503/504 only", () => {
  assert.deepEqual([...SHARED_PREVIEW_RETRY_DELAYS_MS], [3000, 8000, 15000]);
  assert.deepEqual([...SHARED_RELEASE_CONFIRM_RETRY_DELAYS_MS], [2000, 5000, 8000, 12000]);
  assert.deepEqual([...SHARED_PREVIEW_RETRYABLE_STATUSES].sort(), [502, 503, 504]);
  assert.equal(isSharedRetryableStatus(502), true);
  assert.equal(isSharedRetryableStatus("503"), true);
  assert.equal(isSharedRetryableStatus(504), true);
  // Transient-but-not-provisioning statuses keep their existing handling.
  assert.equal(isSharedRetryableStatus(429), false);
  assert.equal(isSharedRetryableStatus(500), false);
  assert.equal(isSharedRetryableStatus(404), false);
  assert.equal(isSharedRetryableStatus(200), false);
  assert.equal(isSharedRetryableStatus(undefined), false);
});

test("sharedRetryDelayMs walks the backoff and reports exhaustion as zero", () => {
  assert.equal(sharedRetryDelayMs(SHARED_PREVIEW_RETRY_DELAYS_MS, 1), 3000);
  assert.equal(sharedRetryDelayMs(SHARED_PREVIEW_RETRY_DELAYS_MS, 2), 8000);
  assert.equal(sharedRetryDelayMs(SHARED_PREVIEW_RETRY_DELAYS_MS, 3), 15000);
  assert.equal(sharedRetryDelayMs(SHARED_PREVIEW_RETRY_DELAYS_MS, 4), 0);
  assert.equal(sharedRetryDelayMs(SHARED_PREVIEW_RETRY_DELAYS_MS, 0), 0);
  assert.equal(sharedRetryDelayMs(SHARED_RELEASE_CONFIRM_RETRY_DELAYS_MS, 4), 12000);
});

// --- fetchWithSharedRetry ---------------------------------------------------

test("fetchWithSharedRetry: 502-then-200 succeeds on the same URL without failing", async () => {
  const { calls, sleep } = sleepRecorder();
  const urls = [];
  let n = 0;
  const outcome = await fetchWithSharedRetry(
    async (url) => {
      urls.push(url);
      n += 1;
      return n < 3 ? statusResponse(502, url) : statusResponse(200, url);
    },
    `https://${HOST}/`,
    {},
    { sleep },
  );
  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.response.status, 200);
  assert.equal(new URL(urls[0]).host, HOST);
  assert.deepEqual(urls, [`https://${HOST}/`, `https://${HOST}/`, `https://${HOST}/`], "retries hit the SAME URL");
  assert.deepEqual(calls, [3000, 8000], "preview budget backoff 3s then 8s");
});

test("fetchWithSharedRetry: fails only after the full budget, then reports last status", async () => {
  const { calls, sleep } = sleepRecorder();
  let attempts = 0;
  const outcome = await fetchWithSharedRetry(
    async (url) => {
      attempts += 1;
      return statusResponse(503, url);
    },
    `https://${HOST}/`,
    {},
    { sleep },
  );
  assert.equal(attempts, 4, "one initial attempt plus three retries");
  assert.equal(outcome.attempts, 4);
  assert.equal(outcome.response.status, 503);
  assert.deepEqual(calls, [3000, 8000, 15000]);
});

test("fetchWithSharedRetry: non-retryable 4xx fails fast with a single attempt", async () => {
  const { calls, sleep } = sleepRecorder();
  let attempts = 0;
  const outcome = await fetchWithSharedRetry(
    async (url) => {
      attempts += 1;
      return statusResponse(404, url);
    },
    `https://${HOST}/`,
    {},
    { sleep },
  );
  assert.equal(attempts, 1);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.response.status, 404);
  assert.deepEqual(calls, [], "no retry delays spent on a deterministic 404");
});

test("fetchWithSharedRetry: network-level TLS failure retries then reports the last error", async () => {
  const { calls, sleep } = sleepRecorder();
  let attempts = 0;
  const outcome = await fetchWithSharedRetry(
    async () => {
      attempts += 1;
      throw new Error("unable to verify the first certificate");
    },
    `https://${HOST}/`,
    {},
    { sleep },
  );
  assert.equal(attempts, 4);
  assert.equal("response" in outcome, false, "no response exists when every attempt threw");
  assert.match(outcome.error, /unable to verify the first certificate/);
  assert.deepEqual(calls, [3000, 8000, 15000]);
});

test("fetchWithSharedRetry: caller cancellation (AbortError) is never retried", async () => {
  const { calls, sleep } = sleepRecorder();
  let attempts = 0;
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  await assert.rejects(
    () => fetchWithSharedRetry(async () => {
      attempts += 1;
      throw abort;
    }, `https://${HOST}/`, {}, { sleep }),
    (error) => error.name === "AbortError",
  );
  assert.equal(attempts, 1);
  assert.deepEqual(calls, []);
});

test("fetchWithSharedRetry: stops before a delay that would cross the deadline", async () => {
  const { calls, sleep } = sleepRecorder();
  const nowAt = { value: 1000 };
  let attempts = 0;
  const outcome = await fetchWithSharedRetry(
    async () => {
      attempts += 1;
      nowAt.value += 100;
      return statusResponse(502, `https://${HOST}/`);
    },
    `https://${HOST}/`,
    {},
    { sleep, now: () => nowAt.value, deadlineAt: 1000 + 100 + 500 },
  );
  assert.equal(attempts, 1, "a 1000ms wait would cross the 600ms remaining window");
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.response.status, 502);
  assert.deepEqual(calls, []);
});

// --- Release confirmation (createPublicReleaseVerifier) ----------------------

test("release confirmation polls through fresh-host 502s to success", async () => {
  const { prepared, identity, verifyInput } = preparedRelease();
  const { calls, sleep } = sleepRecorder();
  let n = 0;
  const verifier = createPublicReleaseVerifier({
    now: () => 0,
    sleep,
    async fetchImpl(url) {
      n += 1;
      if (n <= 2) return statusResponse(502, url);
      const route = new URL(url).pathname;
      const target = prepared.manifest.routes[route];
      return publicResponse(url, prepared.preparedFiles.get(target).body, identity);
    },
  });
  const result = await verifier(verifyInput);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.routes, ["/", "/assets/app.css"]);
  assert.deepEqual(calls, [2000, 5000], "confirmation budget polls 2s then 5s until the host settles");
});

test("release confirmation fails closed only after the poll budget, naming host, status and attempts", async () => {
  const { verifyInput } = preparedRelease();
  const { calls, sleep } = sleepRecorder();
  let attempts = 0;
  const verifier = createPublicReleaseVerifier({
    now: () => 0,
    sleep,
    async fetchImpl(url) {
      attempts += 1;
      return statusResponse(502, url);
    },
  });
  const result = await verifier(verifyInput);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "shared_public_status_mismatch");
  assert.equal(result.detail.host, HOST);
  assert.equal(result.detail.status, 502);
  assert.equal(result.detail.attempts, 5, "initial attempt plus four confirmation polls");
  assert.equal(attempts, 5);
  assert.deepEqual(calls, [2000, 5000, 8000, 12000]);
});

test("release confirmation: non-retryable 4xx fails fast (single probe, still named)", async () => {
  const { verifyInput } = preparedRelease();
  const { calls, sleep } = sleepRecorder();
  let attempts = 0;
  const verifier = createPublicReleaseVerifier({
    now: () => 0,
    sleep,
    async fetchImpl(url) {
      attempts += 1;
      return statusResponse(410, url);
    },
  });
  const result = await verifier(verifyInput);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "shared_public_status_mismatch");
  assert.equal(result.detail.status, 410);
  assert.equal(result.detail.attempts, 1);
  assert.equal(result.detail.host, HOST);
  assert.equal(attempts, 1);
  assert.deepEqual(calls, []);
});

test("release confirmation: network-level failure names the host in the cause", async () => {
  const { verifyInput } = preparedRelease();
  const verifier = createPublicReleaseVerifier({
    now: () => 0,
    sleep: async () => {},
    async fetchImpl() {
      throw new Error("certificate signature failure");
    },
  });
  const result = await verifier(verifyInput);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "shared_public_fetch_failed");
  assert.equal(result.detail.host, HOST);
  assert.match(result.detail.error, /certificate signature failure/);
});

// --- Preview session (openPreview) -------------------------------------------

function retryPublisher(previewFetch, extras = {}) {
  return createSharedSitePublisher({
    registry: fakeRegistry(),
    storage: memoryStorage(),
    env: ENV,
    publicVerifier: async () => ({ ok: true, fallback: false }),
    ensureSharedSiteHost: ENSURE_HOST_OK,
    previewFetch,
    sleep: extras.sleep || (async () => {}),
    ...(extras.now ? { now: extras.now } : {}),
  });
}

test("openPreview exchanges through fresh-host 502s and preview probes retry 502-then-200", async () => {
  const { calls, sleep } = sleepRecorder();
  let exchanges = 0;
  let probes = 0;
  const publisher = retryPublisher(async (url) => {
    if (String(url).endsWith("/api/preview-session")) {
      exchanges += 1;
      return exchanges < 3 ? statusResponse(502, url) : previewExchangeResponse(url);
    }
    probes += 1;
    return probes < 2 ? statusResponse(502, url) : { ok: true, status: 200, url, headers: { get() { return null; } } };
  }, { sleep });
  const staged = await publisher.stage(publisherInput());
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const session = await staged.openPreview();
  assert.equal(session.origin, `https://${HOST}`);
  assert.equal(exchanges, 3, "exchange retried the SAME URL until the host settled");
  const probe = await session.fetch("/");
  assert.equal(probe.status, 200);
  assert.equal(probes, 2);
  assert.equal(calls.includes(3000), true, "preview budget uses the named 3s first delay");
});

test("preview probe fails only after the full budget, naming attempts and last status", async () => {
  const publisher = retryPublisher(async (url) => {
    if (String(url).endsWith("/api/preview-session")) return previewExchangeResponse(url);
    throw new Error("self-signed certificate in certificate chain");
  });
  const staged = await publisher.stage(publisherInput());
  const session = await staged.openPreview();
  let error;
  try {
    await session.fetch("/");
  } catch (caught) {
    error = caught;
  }
  assert.match(String(error), /^Error: shared_preview_fetch_failed after 4 attempts/);
  assert.match(String(error), /last_error: self-signed certificate in certificate chain/);
});

test("preview exchange refused after budget names attempts and last status", async () => {
  const publisher = retryPublisher(async (url) => statusResponse(503, url));
  const staged = await publisher.stage(publisherInput());
  await assert.rejects(
    () => staged.openPreview(),
    /shared_preview_exchange_refused after 4 attempts \(last_status=503\)/,
  );
});

// --- mirror_release_unconfirmed cause ----------------------------------------

test("mirror_release_unconfirmed cause names the host and alias status", () => {
  const cause = mirrorReleaseUnconfirmedCause("alias_target_unconfirmed", {
    preview_url: `https://${HOST}/`,
    checks: { alias_target: { status: "staged" } },
  });
  assert.equal(cause, `alias_target_unconfirmed; host=${HOST}; alias_target=staged`);
});

test("mirror_release_unconfirmed cause degrades gracefully without URLs or checks", () => {
  assert.equal(
    mirrorReleaseUnconfirmedCause("release_not_revealable", {}),
    "release_not_revealable; host=unknown; alias_target=absent",
  );
  assert.equal(
    mirrorReleaseUnconfirmedCause("", { preview_url: "not a url", checks: {} }),
    "release_not_confirmed; host=unknown; alias_target=absent",
  );
});
