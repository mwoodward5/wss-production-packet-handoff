import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BlobServiceRateLimited } from "@vercel/blob";

import {
  createVerticalHistoryStore,
  safeVerticalKey,
} from "../lib/vertical-history-store.mjs";

function createFakeBlob({ pageSize = 2 } = {}) {
  const objects = new Map();
  const calls = { put: [], get: [], list: [], del: [] };
  const failures = { put: null, get: null, list: null, del: null };
  let etag = 0;

  const client = {
    async put(pathname, body, options) {
      calls.put.push({ pathname, options });
      if (failures.put) throw failures.put;
      const current = objects.get(pathname);
      if (options.ifMatch && current?.etag !== options.ifMatch) {
        const error = new Error("etag precondition failed");
        error.name = "BlobPreconditionFailedError";
        throw error;
      }
      if (objects.has(pathname) && !options.allowOverwrite) throw new Error("pathname already exists");
      const record = {
        pathname,
        body: String(body),
        etag: `etag-${++etag}`,
        uploadedAt: new Date(etag * 1000).toISOString(),
      };
      objects.set(pathname, record);
      return { pathname, etag: record.etag, url: `https://blob.invalid/${pathname}` };
    },
    async get(pathname, options) {
      calls.get.push({ pathname, options });
      if (failures.get) throw failures.get;
      const record = objects.get(pathname);
      if (!record) return null;
      return {
        statusCode: 200,
        stream: new Response(record.body).body,
        blob: { pathname, etag: record.etag },
      };
    },
    async list(options) {
      calls.list.push(options);
      if (failures.list) throw failures.list;
      const all = [...objects.values()]
        .filter((record) => record.pathname.startsWith(options.prefix))
        .sort((a, b) => a.pathname.localeCompare(b.pathname));
      const start = options.cursor ? Number(options.cursor) : 0;
      const size = Math.min(options.limit ?? 1000, pageSize);
      const blobs = all.slice(start, start + size).map(({ pathname, etag: itemEtag, uploadedAt }) => ({
        pathname,
        etag: itemEtag,
        uploadedAt,
      }));
      const next = start + blobs.length;
      return {
        blobs,
        hasMore: next < all.length,
        ...(next < all.length ? { cursor: String(next) } : {}),
      };
    },
    async del(pathnames, options) {
      const targets = Array.isArray(pathnames) ? pathnames : [pathnames];
      calls.del.push({ pathnames: [...targets], options });
      if (failures.del) throw failures.del;
      if (options?.ifMatch && objects.get(targets[0])?.etag !== options.ifMatch) {
        const error = new Error("etag precondition failed");
        error.name = "BlobPreconditionFailedError";
        throw error;
      }
      for (const pathname of targets) objects.delete(pathname);
    },
  };

  return {
    client,
    calls,
    failures,
    objects,
    seed(pathname, body) {
      objects.set(pathname, {
        pathname,
        body,
        etag: `etag-${++etag}`,
        uploadedAt: new Date(etag * 1000).toISOString(),
      });
    },
  };
}

function sequenceClock(start = Date.UTC(2026, 6, 15)) {
  let tick = 0;
  return () => new Date(start + tick++);
}

function sequenceIds() {
  let id = 0;
  return () => `record-${String(id++).padStart(3, "0")}`;
}

function prefixedIds(prefix) {
  let id = 0;
  return () => `${prefix}-${String(id++).padStart(3, "0")}`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("Blob is the default backend and keeps an isolated last-eight history", async () => {
  const fake = createFakeBlob({ pageSize: 2 });
  const store = createVerticalHistoryStore({
    env: {},
    blobClient: fake.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
  });

  assert.equal(store.backend, "blob");
  for (let id = 0; id < 10; id += 1) {
    await store.appendVerticalHistory("Roofing", { id, family: `family-${id}` });
  }
  await store.appendVerticalHistory("HVAC", { id: "hvac-only" });

  const roofing = await store.getVerticalHistory("roofing");
  const hvac = await store.getVerticalHistory("hvac");
  assert.deepEqual(roofing.map((row) => row.plan.id), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(hvac.map((row) => row.plan.id), ["hvac-only"]);
  assert.equal([...fake.objects.keys()].filter((key) => key.includes("/roofing/")).length, 8);
  assert.equal([...fake.objects.keys()].filter((key) => key.includes("/hvac/")).length, 1);
  assert.ok(fake.calls.list.some((call) => call.cursor), "history reads should follow Blob pagination");
  assert.ok(fake.calls.put.every((call) => call.options.allowOverwrite === false));
  assert.ok(fake.calls.put.every((call) => call.options.access === "public"));
});

test("concurrent Blob appends keep every newest record without overwrites", async () => {
  const fake = createFakeBlob({ pageSize: 100 });
  const store = createVerticalHistoryStore({
    env: {},
    blobClient: fake.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
  });

  await Promise.all(Array.from({ length: 12 }, (_, id) => (
    store.appendVerticalHistory("concrete", { id })
  )));

  const rows = await store.getVerticalHistory("concrete");
  assert.deepEqual(rows.map((row) => row.plan.id), [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(fake.objects.size, 8);
  assert.equal(new Set(fake.calls.put.map((call) => call.pathname)).size, 12);
});

test("Blob read failures fail closed without creating a filesystem fallback", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-history-fail-"));
  const localFallback = path.join(root, "history");
  const fake = createFakeBlob();
  fake.failures.list = new Error("simulated list outage");
  const store = createVerticalHistoryStore({ env: {}, blobClient: fake.client, dataDir: localFallback });

  await assert.rejects(
    store.getVerticalHistory("roofing"),
    (error) => error.code === "VERTICAL_HISTORY_BLOB_LIST_FAILED" && error.backend === "blob",
  );
  assert.equal(existsSync(localFallback), false);
  rmSync(root, { recursive: true, force: true });
});

test("Blob corruption and unconfirmed writes never become empty-history success", async () => {
  const corrupt = createFakeBlob();
  corrupt.seed("sf/vertical-history/roofing/0000000000000001-corrupt.json", "{not-json");
  const corruptStore = createVerticalHistoryStore({ env: {}, blobClient: corrupt.client });
  await assert.rejects(
    corruptStore.getVerticalHistory("roofing"),
    (error) => error.code === "VERTICAL_HISTORY_CORRUPT",
  );

  const unconfirmed = createFakeBlob();
  unconfirmed.client.put = async () => ({ pathname: "wrong/path.json", etag: "etag-1" });
  const unconfirmedStore = createVerticalHistoryStore({
    env: {},
    blobClient: unconfirmed.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
  });
  await assert.rejects(
    unconfirmedStore.appendVerticalHistory("roofing", { id: 1 }),
    (error) => error.code === "VERTICAL_HISTORY_BLOB_WRITE_UNCONFIRMED",
  );
});

test("Blob write and pruning failures reject instead of reporting success", async () => {
  const writeFailure = createFakeBlob();
  writeFailure.failures.put = new Error("simulated put outage");
  const writeStore = createVerticalHistoryStore({
    env: {},
    blobClient: writeFailure.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
  });
  await assert.rejects(
    writeStore.appendVerticalHistory("roofing", { id: 1 }),
    (error) => error.code === "VERTICAL_HISTORY_BLOB_WRITE_FAILED",
  );

  const pruneFailure = createFakeBlob();
  const pruneStore = createVerticalHistoryStore({
    env: {},
    blobClient: pruneFailure.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
  });
  await pruneStore.appendVerticalHistory("roofing", { id: 1 }, { limit: 1 });
  pruneFailure.failures.del = new Error("simulated delete outage");
  await assert.rejects(
    pruneStore.appendVerticalHistory("roofing", { id: 2 }, { limit: 1 }),
    (error) => error.code === "VERTICAL_HISTORY_BLOB_DELETE_FAILED",
  );
  assert.equal(pruneFailure.objects.size, 2, "the failed append remains visible for later repair");
});

test("Blob state writes retry only rate limits and preserve fail-closed errors", async () => {
  const rateLimited = createFakeBlob();
  const originalPut = rateLimited.client.put;
  const delays = [];
  let attempts = 0;
  rateLimited.client.put = async (...args) => {
    attempts += 1;
    if (attempts <= 2) {
      throw new BlobServiceRateLimited(attempts === 1 ? 0 : 2);
    }
    return originalPut(...args);
  };
  const retryingStore = createVerticalHistoryStore({
    env: {},
    blobClient: rateLimited.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
    sleep: async (ms) => delays.push(ms),
  });

  const reservation = await retryingStore.reserveVerticalPlan(
    "roofing",
    async () => ({ plan: { layout: "retry-safe" } }),
    { idempotencyKey: "rate-limited-build" },
  );
  assert.ok(reservation.reservation_id);
  assert.equal(attempts >= 4, true, "the lock and reservation writes both completed");
  assert.deepEqual(delays, [250, 2000]);

  const denied = createFakeBlob();
  const deniedPut = denied.client.put;
  let deniedAttempts = 0;
  denied.client.put = async (...args) => {
    deniedAttempts += 1;
    if (deniedAttempts === 2) {
      const error = new Error("forbidden");
      error.name = "BlobAccessError";
      throw error;
    }
    return deniedPut(...args);
  };
  const deniedStore = createVerticalHistoryStore({
    env: {},
    blobClient: denied.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
  });
  await assert.rejects(
    deniedStore.reserveVerticalPlan(
      "roofing",
      async () => ({ plan: { layout: "must-not-write" } }),
    ),
    (error) => error.code === "VERTICAL_HISTORY_BLOB_WRITE_FAILED",
  );
  assert.equal(deniedAttempts, 2, "access failures must not be retried");
  assert.equal(denied.objects.size, 0);

  const shortLease = createFakeBlob();
  const shortLeasePut = shortLease.client.put;
  const shortLeaseDelays = [];
  let shortLeaseAttempts = 0;
  shortLease.client.put = async (...args) => {
    shortLeaseAttempts += 1;
    if (shortLeaseAttempts >= 2) throw new BlobServiceRateLimited(10);
    return shortLeasePut(...args);
  };
  const shortLeaseStore = createVerticalHistoryStore({
    env: {},
    blobClient: shortLease.client,
    now: sequenceClock(),
    idFactory: sequenceIds(),
    lockTtlMs: 20,
    lockRenewIntervalMs: 10,
    sleep: async (ms) => shortLeaseDelays.push(ms),
  });
  await assert.rejects(
    shortLeaseStore.reserveVerticalPlan(
      "roofing",
      async () => ({ plan: { layout: "short-lease" } }),
    ),
    (error) => error.code === "VERTICAL_HISTORY_BLOB_WRITE_FAILED",
  );
  assert.equal(shortLeaseAttempts, 3);
  assert.deepEqual(shortLeaseDelays, [19]);
  assert.ok(
    shortLeaseDelays.reduce((total, delay) => total + delay, 0) < 20,
    "rate-limit retry delays must remain below the configured lease TTL",
  );
});

test("filesystem history is used only when explicitly selected", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-history-local-"));
  const store = createVerticalHistoryStore({
    backend: "filesystem",
    env: {},
    dataDir: root,
    now: sequenceClock(),
    idFactory: sequenceIds(),
  });

  await Promise.all(Array.from({ length: 12 }, (_, id) => (
    store.appendVerticalHistory("Roofing / CA", { id })
  )));

  const rows = await store.getVerticalHistory("Roofing / CA");
  assert.deepEqual(rows.map((row) => row.plan.id), [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(store.backend, "filesystem");
  assert.equal(existsSync(path.join(root, `${safeVerticalKey("Roofing / CA")}.json`)), true);
  assert.ok(readdirSync(root).every((name) => !name.endsWith(".tmp")));
  rmSync(root, { recursive: true, force: true });
});

test("filesystem corruption fails closed and invalid plans are rejected before writes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-history-corrupt-"));
  const key = safeVerticalKey("Roofing");
  writeFileSync(path.join(root, `${key}.json`), "{broken", "utf8");
  const store = createVerticalHistoryStore({ backend: "filesystem", env: {}, dataDir: root });

  await assert.rejects(
    store.getVerticalHistory("Roofing"),
    (error) => error.code === "VERTICAL_HISTORY_CORRUPT" && error.backend === "filesystem",
  );
  await assert.rejects(
    store.appendVerticalHistory("Roofing", { bad: undefined }),
    (error) => error.code === "VERTICAL_HISTORY_PLAN_INVALID",
  );
  assert.equal(readdirSync(root).length, 1, "invalid input must not create a temp write");
  rmSync(root, { recursive: true, force: true });
});

test("unknown backend selection is rejected", () => {
  assert.throws(
    () => createVerticalHistoryStore({ backend: "auto", env: {} }),
    (error) => error.code === "VERTICAL_HISTORY_BACKEND_INVALID",
  );
});

test("Blob reservations lock selection, finalize once, and release failed work", async () => {
  const fake = createFakeBlob({ pageSize: 100 });
  const store = createVerticalHistoryStore({
    env: {},
    blobClient: fake.client,
    now: () => new Date("2026-07-27T12:00:00.000Z"),
    idFactory: sequenceIds(),
  });
  const observedRecentCounts = [];
  const select = async (recentPlans) => {
    observedRecentCounts.push(recentPlans.length);
    return {
      plan: { layout: `layout-${recentPlans.length}`, palette: `palette-${recentPlans.length}`, font: `font-${recentPlans.length}` },
      min_hamming_to_recent: recentPlans.length ? 5 : 10,
    };
  };

  const [first, second] = await Promise.all([
    store.reserveVerticalPlan("roofing", select, { idempotencyKey: "build-one" }),
    store.reserveVerticalPlan("roofing", select, { idempotencyKey: "build-two" }),
  ]);

  assert.notEqual(first.reservation_id, second.reservation_id);
  assert.deepEqual(observedRecentCounts.sort((a, b) => a - b), [0, 1]);
  assert.notDeepEqual(first.selection.plan, second.selection.plan);

  const firstRows = await store.finalizeVerticalPlan("roofing", first.reservation_id);
  const repeatedRows = await store.finalizeVerticalPlan("roofing", first.reservation_id);
  await store.finalizeVerticalPlan("roofing", second.reservation_id);
  assert.equal(firstRows.length, 1);
  assert.equal(repeatedRows.length, 1);
  assert.equal((await store.getVerticalHistory("roofing")).length, 2);

  const failed = await store.reserveVerticalPlan("roofing", select, { idempotencyKey: "build-failed" });
  assert.equal(await store.releaseVerticalPlan("roofing", failed.reservation_id), true);
  assert.equal(await store.releaseVerticalPlan("roofing", failed.reservation_id), false);
  assert.equal((await store.getVerticalHistory("roofing")).length, 2);
});

test("renewed Blob lease fences a second store past the original expiry", async () => {
  const fake = createFakeBlob({ pageSize: 100 });
  let nowMs = Date.UTC(2026, 6, 27, 12);
  const firstSelectorEntered = deferred();
  const releaseFirstSelector = deferred();
  const observations = [];
  const common = {
    env: {},
    blobClient: fake.client,
    now: () => new Date(nowMs),
    lockTtlMs: 20,
    lockRenewIntervalMs: 1,
    lockRetryMs: 1,
    lockMaxWaitMs: 1000,
  };
  const firstStore = createVerticalHistoryStore({ ...common, idFactory: prefixedIds("first") });
  const secondStore = createVerticalHistoryStore({ ...common, idFactory: prefixedIds("second") });

  const first = firstStore.reserveVerticalPlan("roofing", async (recentPlans) => {
    observations.push(["first", recentPlans.length]);
    firstSelectorEntered.resolve();
    await releaseFirstSelector.promise;
    return { plan: { layout: "first" } };
  }, { idempotencyKey: "first-build" });
  await firstSelectorEntered.promise;

  const lockPath = "sf/vertical-history/roofing/_state/locks/vertical.json";
  nowMs += 10;
  await waitFor(() => {
    const lock = fake.objects.get(lockPath);
    return lock && Date.parse(JSON.parse(lock.body).expires_at) > nowMs + 10;
  }, "first store did not renew its lock");
  nowMs += 15;

  let secondSelectorEntered = false;
  const second = secondStore.reserveVerticalPlan("roofing", async (recentPlans) => {
    secondSelectorEntered = true;
    observations.push(["second", recentPlans.length]);
    return { plan: { layout: `second-after-${recentPlans.length}` } };
  }, { idempotencyKey: "second-build" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondSelectorEntered, false, "the second store must not enter after the original TTL");

  releaseFirstSelector.resolve();
  const [firstReservation, secondReservation] = await Promise.all([first, second]);
  assert.deepEqual(observations, [["first", 0], ["second", 1]]);
  assert.notDeepEqual(firstReservation.selection.plan, secondReservation.selection.plan);
  assert.equal(
    [...fake.objects.keys()].filter((pathname) => pathname.includes("/_state/reservations/")).length,
    2,
  );
});

test("Blob lease renewal ignores stale cached lock reads and keeps the CAS fence", async () => {
  const fake = createFakeBlob({ pageSize: 100 });
  const lockPath = "sf/vertical-history/roofing/_state/locks/vertical.json";
  const originalPut = fake.client.put;
  const originalGet = fake.client.get;
  let staleLock = null;
  fake.client.put = async (pathname, body, options) => {
    const prior = fake.objects.get(pathname);
    const result = await originalPut(pathname, body, options);
    if (pathname === lockPath && options.allowOverwrite && prior && !staleLock) {
      staleLock = { ...prior };
    }
    return result;
  };
  fake.client.get = async (pathname, options) => {
    if (pathname === lockPath && staleLock) {
      fake.calls.get.push({ pathname, options });
      return {
        statusCode: 200,
        stream: new Response(staleLock.body).body,
        blob: { pathname, etag: staleLock.etag },
      };
    }
    return originalGet(pathname, options);
  };

  const common = {
    env: {},
    blobClient: fake.client,
    now: () => new Date(),
    lockTtlMs: 30,
    lockRenewIntervalMs: 5,
    lockRetryMs: 5,
    lockMaxWaitMs: 1000,
  };
  const firstStore = createVerticalHistoryStore({ ...common, idFactory: prefixedIds("stale-first") });
  const secondStore = createVerticalHistoryStore({ ...common, idFactory: prefixedIds("stale-second") });
  const firstEntered = deferred();
  const releaseFirst = deferred();
  let secondEntered = false;

  const first = firstStore.reserveVerticalPlan("roofing", async () => {
    firstEntered.resolve();
    await releaseFirst.promise;
    return { plan: { layout: "first" } };
  }, { idempotencyKey: "stale-first-build" });
  await firstEntered.promise;
  await waitFor(() => Boolean(staleLock), "first store did not renew its lock");
  await new Promise((resolve) => setTimeout(resolve, 40));

  const second = secondStore.reserveVerticalPlan("roofing", async (recentPlans) => {
    secondEntered = true;
    return { plan: { layout: `second-after-${recentPlans.length}` } };
  }, { idempotencyKey: "stale-second-build" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(secondEntered, false, "stale cached lock data must not let a waiter steal the live lease");

  releaseFirst.resolve();
  const [firstReservation, secondReservation] = await Promise.all([first, second]);
  assert.notEqual(firstReservation.reservation_id, secondReservation.reservation_id);
  assert.equal(secondEntered, true);
});

test("five concurrent Blob stores serialize one reservation per vertical", async () => {
  const fake = createFakeBlob({ pageSize: 100 });
  const observations = [];
  const stores = Array.from({ length: 5 }, (_, index) => createVerticalHistoryStore({
    env: {},
    blobClient: fake.client,
    now: () => new Date(),
    idFactory: prefixedIds(`worker-${index}`),
    lockTtlMs: 100,
    lockRenewIntervalMs: 20,
    lockRetryMs: 5,
    lockMaxWaitMs: 2000,
  }));

  const reservations = await Promise.all(stores.map((store, index) => (
    store.reserveVerticalPlan("roofing", async (recentPlans) => {
      observations.push(recentPlans.length);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { plan: { layout: `worker-${index}-after-${recentPlans.length}` } };
    }, { idempotencyKey: `five-worker-build-${index}` })
  )));

  assert.equal(new Set(reservations.map((item) => item.reservation_id)).size, 5);
  assert.deepEqual(observations, [0, 1, 2, 3, 4]);
  assert.equal(
    [...fake.objects.keys()].filter((pathname) => pathname.includes("/_state/reservations/")).length,
    5,
  );
});

test("renewed filesystem lease fences a second store past the original expiry", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-history-fs-fence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let nowMs = Date.UTC(2026, 6, 27, 12);
  const firstSelectorEntered = deferred();
  const releaseFirstSelector = deferred();
  const observations = [];
  const common = {
    backend: "filesystem",
    env: {},
    dataDir: root,
    now: () => new Date(nowMs),
    lockTtlMs: 20,
    lockRenewIntervalMs: 1,
    lockRetryMs: 1,
    lockMaxWaitMs: 1000,
  };
  const firstStore = createVerticalHistoryStore({ ...common, idFactory: prefixedIds("fs-first") });
  const secondStore = createVerticalHistoryStore({ ...common, idFactory: prefixedIds("fs-second") });
  const first = firstStore.reserveVerticalPlan("roofing", async (recentPlans) => {
    observations.push(["first", recentPlans.length]);
    firstSelectorEntered.resolve();
    await releaseFirstSelector.promise;
    return { plan: { layout: "first" } };
  });
  await firstSelectorEntered.promise;

  const leasePath = path.join(root, "roofing.lock", "lease.json");
  nowMs += 10;
  await waitFor(() => {
    try {
      return Date.parse(JSON.parse(readFileSync(leasePath, "utf8")).expires_at) > nowMs + 10;
    } catch {
      return false;
    }
  }, "first filesystem store did not renew its lock");
  nowMs += 15;

  let secondSelectorEntered = false;
  const second = secondStore.reserveVerticalPlan("roofing", async (recentPlans) => {
    secondSelectorEntered = true;
    observations.push(["second", recentPlans.length]);
    return { plan: { layout: `second-after-${recentPlans.length}` } };
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(secondSelectorEntered, false, "the second filesystem store must remain fenced");

  releaseFirstSelector.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(observations, [["first", 0], ["second", 1]]);
});

test("lost Blob lease fails closed before reservation mutation and cannot delete the successor lock", async () => {
  const fake = createFakeBlob({ pageSize: 100 });
  let nowMs = Date.UTC(2026, 6, 27, 12);
  const selectorEntered = deferred();
  const releaseSelector = deferred();
  const store = createVerticalHistoryStore({
    env: {},
    blobClient: fake.client,
    now: () => new Date(nowMs),
    idFactory: prefixedIds("stale"),
    lockTtlMs: 100,
    lockRenewIntervalMs: 50,
  });
  const pending = store.reserveVerticalPlan("roofing", async () => {
    selectorEntered.resolve();
    await releaseSelector.promise;
    return { plan: { layout: "stale" } };
  });
  await selectorEntered.promise;

  const lockPath = "sf/vertical-history/roofing/_state/locks/vertical.json";
  fake.seed(lockPath, JSON.stringify({
    owner: "successor-owner",
    fence: "successor-fence",
    acquired_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + 1000).toISOString(),
  }));
  releaseSelector.resolve();

  await assert.rejects(pending, (error) => error.code === "VERTICAL_HISTORY_LOCK_LOST");
  assert.equal(
    [...fake.objects.keys()].some((pathname) => pathname.includes("/_state/reservations/")),
    false,
  );
  assert.equal(JSON.parse(fake.objects.get(lockPath).body).owner, "successor-owner");
});

test("expired filesystem lease fails closed before reservation mutation", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-history-fs-lost-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let nowMs = Date.UTC(2026, 6, 27, 12);
  const selectorEntered = deferred();
  const releaseSelector = deferred();
  const store = createVerticalHistoryStore({
    backend: "filesystem",
    env: {},
    dataDir: root,
    now: () => new Date(nowMs),
    idFactory: prefixedIds("fs-stale"),
    lockTtlMs: 20,
    lockRenewIntervalMs: 100,
  });
  const pending = store.reserveVerticalPlan("roofing", async () => {
    selectorEntered.resolve();
    await releaseSelector.promise;
    return { plan: { layout: "stale" } };
  });
  await selectorEntered.promise;
  nowMs += 25;
  releaseSelector.resolve();

  await assert.rejects(pending, (error) => error.code === "VERTICAL_HISTORY_LOCK_LOST");
  assert.equal(existsSync(path.join(root, "roofing.reservations.json")), false);
  assert.equal(existsSync(path.join(root, "roofing.lock", "lease.json")), true);
});

test("reservation renewal extends live work for Blob and filesystem backends", async (t) => {
  let nowMs = Date.UTC(2026, 6, 27, 12);
  const fake = createFakeBlob({ pageSize: 100 });
  const blobStore = createVerticalHistoryStore({
    env: {},
    blobClient: fake.client,
    now: () => new Date(nowMs),
    idFactory: prefixedIds("blob-renew"),
  });
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-history-renew-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const filesystemStore = createVerticalHistoryStore({
    backend: "filesystem",
    env: {},
    dataDir: root,
    now: () => new Date(nowMs),
    idFactory: prefixedIds("fs-renew"),
  });

  for (const store of [blobStore, filesystemStore]) {
    const reservation = await store.reserveVerticalPlan(
      "roofing",
      async () => ({ plan: { layout: store.backend } }),
      { ttlMs: 1000 },
    );
    nowMs += 500;
    const renewed = await store.renewVerticalPlan("roofing", reservation.reservation_id, { ttlMs: 1000 });
    assert.equal(Date.parse(renewed.expires_at), nowMs + 1000);
    nowMs += 700;
    const rows = await store.finalizeVerticalPlan("roofing", reservation.reservation_id);
    assert.equal(rows.at(-1).plan.layout, store.backend);
    nowMs += 1000;
  }
});
