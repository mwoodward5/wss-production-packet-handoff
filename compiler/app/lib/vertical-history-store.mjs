import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Blob is the default. Filesystem persistence is available only through an
// explicit SITEFORGE_VERTICAL_HISTORY_BACKEND=filesystem selection.
export const DEFAULT_VERTICAL_HISTORY_LIMIT = 8;
export const VERTICAL_HISTORY_BACKEND_ENV = "SITEFORGE_VERTICAL_HISTORY_BACKEND";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = path.join(APP_ROOT, "data", "vertical-history");
const DEFAULT_BLOB_PREFIX = "sf/vertical-history";
const MAX_HISTORY_LIMIT = 1000;
const MAX_LIST_PAGES = 1000;
const DEFAULT_RESERVATION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_TTL_MS = 15 * 1000;
const DEFAULT_LOCK_RETRY_MS = 250;
const DEFAULT_LOCK_MAX_WAIT_MS = 60 * 1000;
const BLOB_RATE_LIMIT_RETRY_DELAYS_MS = [250, 1000, 3000];
// Keep the full retry window below the 15s lease TTL. A longer provider hint
// must fail closed before this worker can outlive its lease.
const MAX_BLOB_RATE_LIMIT_RETRY_AFTER_MS = 3 * 1000;
const INTERNAL_BLOB_SEGMENT = "/_state/";

export class VerticalHistoryStoreError extends Error {
  constructor(message, { code, backend, operation, vertical, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "VerticalHistoryStoreError";
    this.code = code || "VERTICAL_HISTORY_STORE_FAILED";
    this.backend = backend || null;
    this.operation = operation || null;
    this.vertical = vertical || null;
  }
}

export function safeVerticalKey(vertical) {
  return String(vertical || "default").toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

export function createVerticalHistoryStore(options = {}) {
  const env = options.env ?? process.env;
  const backend = String(options.backend ?? env[VERTICAL_HISTORY_BACKEND_ENV] ?? "blob")
    .trim()
    .toLowerCase();

  if (backend === "blob") return createBlobStore({ ...options, env });
  if (backend === "filesystem") return createFilesystemStore({ ...options, env });

  throw new VerticalHistoryStoreError(
    `${VERTICAL_HISTORY_BACKEND_ENV} must be "blob" or "filesystem"`,
    { code: "VERTICAL_HISTORY_BACKEND_INVALID", backend, operation: "configure" },
  );
}

function createBlobStore(options) {
  const access = String(
    options.blobAccess ?? options.env.SITEFORGE_VERTICAL_HISTORY_BLOB_ACCESS ?? "public",
  ).toLowerCase();
  if (access !== "public" && access !== "private") {
    throw new VerticalHistoryStoreError("Blob access must be public or private", {
      code: "VERTICAL_HISTORY_BLOB_ACCESS_INVALID",
      backend: "blob",
      operation: "configure",
    });
  }

  const prefix = normalizeBlobPrefix(options.blobPrefix ?? DEFAULT_BLOB_PREFIX);
  const token = options.blobToken
    ?? options.env.SITEFORGE_VERTICAL_HISTORY_BLOB_TOKEN
    ?? options.env.BLOB_READ_WRITE_TOKEN
    ?? null;
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const lockTtlMs = normalizeDuration(options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS, "lock ttl");
  const lockRetryMs = normalizeDuration(options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS, "lock retry", 0);
  const lockMaxWaitMs = normalizeDuration(options.lockMaxWaitMs ?? DEFAULT_LOCK_MAX_WAIT_MS, "lock max wait");
  const lockRenewIntervalMs = normalizeDuration(
    options.lockRenewIntervalMs ?? Math.max(1, Math.floor(lockTtlMs / 3)),
    "lock renew interval",
  );
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let clientPromise = null;

  async function client() {
    if (!clientPromise) {
      clientPromise = Promise.resolve(
        options.blobClient ?? (options.sdkLoader ? options.sdkLoader() : import("@vercel/blob")),
      ).then((candidate) => {
        for (const method of ["put", "get", "list", "del"]) {
          if (typeof candidate?.[method] !== "function") {
            throw new VerticalHistoryStoreError(`Blob client is missing ${method}()`, {
              code: "VERTICAL_HISTORY_BLOB_CLIENT_INVALID",
              backend: "blob",
              operation: "configure",
            });
          }
        }
        return candidate;
      });
    }
    return clientPromise;
  }

  const auth = token ? { token } : {};

  async function listItems(verticalKey) {
    const blob = await client();
    const verticalPrefix = `${prefix}/${verticalKey}/`;
    const seenCursors = new Set();
    const items = [];
    let cursor;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      let result;
      try {
        result = await blob.list({ ...auth, prefix: verticalPrefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      } catch (cause) {
        throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_FAILED", "Blob history list failed", {
          backend: "blob",
          operation: "list",
          vertical: verticalKey,
          cause,
        });
      }

      if (!result || !Array.isArray(result.blobs)) {
        throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_INVALID", "Blob history list returned an invalid response", {
          backend: "blob",
          operation: "list",
          vertical: verticalKey,
        });
      }

      for (const item of result.blobs) {
        if (!item || typeof item.pathname !== "string" || !item.pathname.startsWith(verticalPrefix)) {
          throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_INVALID", "Blob history list contained an invalid pathname", {
            backend: "blob",
            operation: "list",
            vertical: verticalKey,
          });
        }
        if (!item.pathname.includes(INTERNAL_BLOB_SEGMENT)) items.push(item);
      }

      if (!result.hasMore) return items;
      if (!result.cursor || seenCursors.has(result.cursor)) {
        throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_INVALID", "Blob history pagination did not advance", {
          backend: "blob",
          operation: "list",
          vertical: verticalKey,
        });
      }
      seenCursors.add(result.cursor);
      cursor = result.cursor;
    }

    throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_INVALID", "Blob history exceeded the pagination safety limit", {
      backend: "blob",
      operation: "list",
      vertical: verticalKey,
    });
  }

  async function readItem(item, verticalKey) {
    const blob = await client();
    let result;
    try {
      result = await blob.get(item.pathname, { access, ...auth });
    } catch (cause) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_READ_FAILED", "Blob history read failed", {
        backend: "blob",
        operation: "read",
        vertical: verticalKey,
        cause,
      });
    }

    if (!result || result.statusCode !== 200 || !result.stream) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_READ_MISSING", "A listed Blob history record could not be read", {
        backend: "blob",
        operation: "read",
        vertical: verticalKey,
      });
    }

    let raw;
    try {
      raw = await new Response(result.stream).text();
    } catch (cause) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_READ_FAILED", "Blob history body could not be read", {
        backend: "blob",
        operation: "read",
        vertical: verticalKey,
        cause,
      });
    }
    return parseRecord(raw, item.pathname, "blob", verticalKey);
  }

  async function getVerticalHistory(vertical, { limit = DEFAULT_VERTICAL_HISTORY_LIMIT } = {}) {
    const checkedLimit = validateLimit(limit);
    const key = safeVerticalKey(vertical);
    const items = sortBlobItems(await listItems(key)).slice(-checkedLimit);
    const rows = [];
    for (const item of items) rows.push(await readItem(item, key));
    return rows;
  }

  async function appendVerticalHistory(vertical, plan, {
    limit = DEFAULT_VERTICAL_HISTORY_LIMIT,
    renderedSectionOrder = null,
    reservationId = null,
    idempotencyKey = null,
    selectionMetadata = null,
    leaseGuard = null,
  } = {}) {
    const checkedLimit = validateLimit(limit);
    const key = safeVerticalKey(vertical);
    const record = createRecord(plan, now, {
      renderedSectionOrder,
      reservationId,
      idempotencyKey,
      selectionMetadata,
    });
    await getVerticalHistory(key, { limit: checkedLimit });
    const pathname = `${prefix}/${key}/${recordPathSegment(record.at, idFactory)}.json`;
    const blob = await client();
    let uploaded;

    try {
      await leaseGuard?.assertOwned();
      uploaded = await blob.put(pathname, JSON.stringify(record), {
        access,
        ...auth,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
    } catch (cause) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_WRITE_FAILED", "Blob history write failed", {
        backend: "blob",
        operation: "write",
        vertical: key,
        cause,
      });
    }

    if (uploaded?.pathname !== pathname || typeof uploaded?.etag !== "string" || !uploaded.etag) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_WRITE_UNCONFIRMED", "Blob history write was not confirmed", {
        backend: "blob",
        operation: "write",
        vertical: key,
      });
    }

    const listed = await listItems(key);
    const byPath = new Map(listed.map((item) => [item.pathname, item]));
    byPath.set(pathname, { ...uploaded, pathname, uploadedAt: record.at });
    const ordered = sortBlobItems([...byPath.values()]);
    const overflow = Math.max(0, ordered.length - checkedLimit);
    const stale = ordered.slice(0, overflow);

    if (stale.length) {
      try {
        for (let i = 0; i < stale.length; i += 1000) {
          await leaseGuard?.assertOwned();
          await blob.del(stale.slice(i, i + 1000).map((item) => item.pathname), auth);
        }
      } catch (cause) {
        throw storeFailure("VERTICAL_HISTORY_BLOB_DELETE_FAILED", "Blob history pruning failed", {
          backend: "blob",
          operation: "delete",
          vertical: key,
          cause,
        });
      }
    }

    return getVerticalHistory(key, { limit: checkedLimit });
  }

  function statePath(key, kind, id) {
    return `${prefix}/${key}/_state/${kind}/${safeRecordId(id)}.json`;
  }

  async function readBlobJsonVersioned(pathname, key, { missing = null } = {}) {
    const blob = await client();
    let result;
    try {
      result = await blob.get(pathname, { access, ...auth });
    } catch (cause) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_READ_FAILED", "Blob state read failed", {
        backend: "blob", operation: "read", vertical: key, cause,
      });
    }
    if (!result) return missing;
    if (
      result.statusCode !== 200
      || !result.stream
      || typeof result.blob?.etag !== "string"
      || !result.blob.etag
    ) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_READ_FAILED", "Blob state read returned an invalid response", {
        backend: "blob", operation: "read", vertical: key,
      });
    }
    try {
      return {
        value: JSON.parse(await new Response(result.stream).text()),
        etag: result.blob.etag,
      };
    } catch (cause) {
      throw corruptHistory(`Blob state is not valid JSON: ${pathname}`, "blob", key, cause);
    }
  }

  async function readBlobJson(pathname, key, options) {
    const versioned = await readBlobJsonVersioned(pathname, key, options);
    return versioned?.value ?? versioned;
  }

  async function putBlobJson(pathname, value, key, {
    allowOverwrite = false,
    ifMatch = null,
    conflictCode = null,
  } = {}) {
    const blob = await client();
    let result;
    const body = JSON.stringify(value);
    const rateLimitWaitBudgetMs = Math.max(0, lockTtlMs - 1);
    let rateLimitWaitedMs = 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        result = await blob.put(pathname, body, {
          access,
          ...auth,
          addRandomSuffix: false,
          allowOverwrite,
          ...(ifMatch ? { ifMatch } : {}),
          contentType: "application/json",
          cacheControlMaxAge: 60,
        });
        break;
      } catch (cause) {
        if (conflictCode && isBlobPreconditionFailure(cause)) {
          throw storeFailure(conflictCode, "Blob state changed while the lease was held", {
            backend: "blob", operation: "lock", vertical: key, cause,
          });
        }
        if (isBlobRateLimited(cause) && attempt < BLOB_RATE_LIMIT_RETRY_DELAYS_MS.length) {
          const remainingWaitMs = rateLimitWaitBudgetMs - rateLimitWaitedMs;
          if (remainingWaitMs > 0) {
            const delayMs = Math.min(blobRateLimitRetryDelayMs(cause, attempt), remainingWaitMs);
            rateLimitWaitedMs += delayMs;
            await sleep(delayMs);
            continue;
          }
        }
        throw storeFailure("VERTICAL_HISTORY_BLOB_WRITE_FAILED", "Blob state write failed", {
          backend: "blob", operation: "write", vertical: key, cause,
        });
      }
    }
    if (result?.pathname !== pathname || typeof result?.etag !== "string" || !result.etag) {
      throw storeFailure("VERTICAL_HISTORY_BLOB_WRITE_UNCONFIRMED", "Blob state write was not confirmed", {
        backend: "blob", operation: "write", vertical: key,
      });
    }
    return result;
  }

  async function deleteBlobPaths(paths, key, { ifMatch = null, conflictCode = null } = {}) {
    if (!paths.length) return;
    try {
      const target = paths.length === 1 ? paths[0] : paths;
      await (await client()).del(target, { ...auth, ...(ifMatch ? { ifMatch } : {}) });
    } catch (cause) {
      if (conflictCode && isBlobPreconditionFailure(cause)) {
        throw storeFailure(conflictCode, "Blob state changed while the lease was held", {
          backend: "blob", operation: "lock", vertical: key, cause,
        });
      }
      throw storeFailure("VERTICAL_HISTORY_BLOB_DELETE_FAILED", "Blob state delete failed", {
        backend: "blob", operation: "delete", vertical: key, cause,
      });
    }
  }

  async function listState(key, kind) {
    const blob = await client();
    const statePrefix = `${prefix}/${key}/_state/${kind}/`;
    const result = [];
    let cursor;
    const seen = new Set();
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      let listed;
      try {
        listed = await blob.list({ ...auth, prefix: statePrefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      } catch (cause) {
        throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_FAILED", "Blob state list failed", {
          backend: "blob", operation: "list", vertical: key, cause,
        });
      }
      if (!listed || !Array.isArray(listed.blobs)) {
        throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_INVALID", "Blob state list returned an invalid response", {
          backend: "blob", operation: "list", vertical: key,
        });
      }
      result.push(...listed.blobs);
      if (!listed.hasMore) return result;
      if (!listed.cursor || seen.has(listed.cursor)) {
        throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_INVALID", "Blob state pagination did not advance", {
          backend: "blob", operation: "list", vertical: key,
        });
      }
      seen.add(listed.cursor);
      cursor = listed.cursor;
    }
    throw storeFailure("VERTICAL_HISTORY_BLOB_LIST_INVALID", "Blob state exceeded the pagination safety limit", {
      backend: "blob", operation: "list", vertical: key,
    });
  }

  async function acquireBlobLock(key) {
    const pathname = statePath(key, "locks", "vertical");
    const owner = safeRecordId(idFactory());
    const fence = safeRecordId(idFactory());
    const deadline = Date.now() + lockMaxWaitMs;
    while (Date.now() <= deadline) {
      const acquiredAt = clockDate(now, "lock");
      const lease = {
        owner,
        fence,
        acquired_at: acquiredAt.toISOString(),
        expires_at: new Date(acquiredAt.getTime() + lockTtlMs).toISOString(),
      };
      try {
        const uploaded = await putBlobJson(pathname, lease, key);
        return { pathname, owner, fence, etag: uploaded.etag, value: lease };
      } catch (error) {
        if (error.code !== "VERTICAL_HISTORY_BLOB_WRITE_FAILED") throw error;
        const current = await readBlobJsonVersioned(pathname, key, { missing: null });
        if (!current) continue;
        if (Date.parse(current.value?.expires_at) <= clockDate(now, "lock").getTime()) {
          try {
            const uploaded = await putBlobJson(pathname, lease, key, {
              allowOverwrite: true,
              ifMatch: current.etag,
              conflictCode: "VERTICAL_HISTORY_LOCK_CONTENDED",
            });
            return { pathname, owner, fence, etag: uploaded.etag, value: lease };
          } catch (replaceError) {
            if (replaceError.code !== "VERTICAL_HISTORY_LOCK_CONTENDED") throw replaceError;
            if (Date.now() + lockRetryMs > deadline) break;
            await sleep(lockRetryMs);
            continue;
          }
        }
        if (Date.now() + lockRetryMs > deadline) break;
        await sleep(lockRetryMs);
      }
    }
    throw storeFailure("VERTICAL_HISTORY_LOCK_TIMEOUT", "Timed out acquiring Blob vertical history lock", {
      backend: "blob", operation: "lock", vertical: key,
    });
  }

  async function renewBlobLock(key, lease) {
    const renewedAt = clockDate(now, "lock");
    const renewed = {
      ...lease.value,
      expires_at: new Date(renewedAt.getTime() + lockTtlMs).toISOString(),
    };
    let uploaded;
    try {
      // Public Blob overwrites can be served stale by the CDN. The ETag held
      // from the last successful CAS is the lease proof; re-reading the
      // mutable lock here can make an owner reject its own renewal.
      uploaded = await putBlobJson(lease.pathname, renewed, key, {
        allowOverwrite: true,
        ifMatch: lease.etag,
        conflictCode: "VERTICAL_HISTORY_LOCK_LOST",
      });
    } catch (error) {
      if (error.code === "VERTICAL_HISTORY_LOCK_LOST") throw lostLease("blob", key, error);
      throw error;
    }
    lease.etag = uploaded.etag;
    lease.value = renewed;
  }

  async function releaseBlobLock(key, lease) {
    try {
      await deleteBlobPaths([lease.pathname], key, {
        ifMatch: lease.etag,
        conflictCode: "VERTICAL_HISTORY_LOCK_LOST",
      });
    } catch (error) {
      if (error.code !== "VERTICAL_HISTORY_LOCK_LOST") throw error;
    }
  }

  async function withBlobLock(key, action) {
    const lease = await acquireBlobLock(key);
    const leaseQueue = createAsyncQueue();
    let stopped = false;
    let renewalError = null;
    let timer = null;
    const assertOwned = async () => {
      if (renewalError) throw renewalError;
      await leaseQueue.run(() => renewBlobLock(key, lease));
      if (renewalError) throw renewalError;
    };
    const scheduleRenewal = () => {
      timer = setTimeout(async () => {
        if (stopped) return;
        try {
          await leaseQueue.run(() => renewBlobLock(key, lease));
        } catch (error) {
          renewalError = error;
          stopped = true;
        }
        if (!stopped) scheduleRenewal();
      }, lockRenewIntervalMs);
      timer.unref?.();
    };
    scheduleRenewal();
    try {
      const result = await action({ assertOwned });
      await assertOwned();
      return result;
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
      await leaseQueue.idle();
      await releaseBlobLock(key, lease);
    }
  }

  async function activeReservations(key, leaseGuard) {
    const items = await listState(key, "reservations");
    const active = [];
    const expired = [];
    const current = clockDate(now, "reservation").getTime();
    for (const item of items) {
      const reservation = await readBlobJson(item.pathname, key, { missing: null });
      if (!reservation || Date.parse(reservation.expires_at) <= current) expired.push(item.pathname);
      else active.push(reservation);
    }
    if (expired.length) {
      await leaseGuard.assertOwned();
      await deleteBlobPaths(expired, key);
    }
    return active;
  }

  async function finalizedByIdempotencyKey(key, idempotencyKey) {
    if (idempotencyKey == null) return null;
    for (const item of await listState(key, "finalized")) {
      const finalized = await readBlobJson(item.pathname, key, { missing: null });
      if (finalized?.reservation?.idempotency_key === String(idempotencyKey)) return finalized.reservation;
    }
    return null;
  }

  async function pruneFinalizedState(key, limit, leaseGuard) {
    const finalized = [];
    for (const item of await listState(key, "finalized")) {
      const value = await readBlobJson(item.pathname, key, { missing: null });
      finalized.push({
        pathname: item.pathname,
        createdAt: Date.parse(value?.reservation?.created_at ?? "") || 0,
      });
    }
    finalized.sort((left, right) => (
      left.createdAt - right.createdAt || left.pathname.localeCompare(right.pathname)
    ));
    const stale = finalized.slice(0, Math.max(0, finalized.length - limit))
      .map((item) => item.pathname);
    if (stale.length) {
      await leaseGuard.assertOwned();
      await deleteBlobPaths(stale, key);
    }
  }

  async function reserveVerticalPlan(vertical, selectPlan, {
    limit = DEFAULT_VERTICAL_HISTORY_LIMIT,
    idempotencyKey = null,
    ttlMs = DEFAULT_RESERVATION_TTL_MS,
  } = {}) {
    if (typeof selectPlan !== "function") throw new TypeError("reserveVerticalPlan selector required");
    const checkedLimit = validateLimit(limit);
    const checkedTtl = normalizeDuration(ttlMs, "reservation ttl", 1000);
    const key = safeVerticalKey(vertical);
    return withBlobLock(key, async (leaseGuard) => {
      const active = await activeReservations(key, leaseGuard);
      const existing = idempotencyKey
        ? active.find((item) => item.idempotency_key === String(idempotencyKey))
        : null;
      if (existing) return cloneJson(existing);
      const prior = await finalizedByIdempotencyKey(key, idempotencyKey);
      if (prior) return cloneJson(prior);
      const history = await getVerticalHistory(key, { limit: checkedLimit });
      const committed = idempotencyKey == null
        ? null
        : history.find((row) => row.idempotency_key === String(idempotencyKey));
      if (committed) {
        const recovered = reservationFromRecord(committed);
        await leaseGuard.assertOwned();
        await putBlobJson(statePath(key, "finalized", recovered.reservation_id), {
          reservation_id: recovered.reservation_id,
          reservation: recovered,
          rows: history,
        }, key);
        await pruneFinalizedState(key, checkedLimit, leaseGuard);
        return cloneJson(recovered);
      }
      const selection = await selectPlan([
        ...history.map((row) => row.plan),
        ...active.map((item) => item.selection.plan),
      ]);
      validateSelection(selection);
      const created = clockDate(now, "reservation");
      const reservation = {
        reservation_id: safeRecordId(idFactory()),
        idempotency_key: idempotencyKey == null ? null : String(idempotencyKey),
        created_at: created.toISOString(),
        expires_at: new Date(created.getTime() + checkedTtl).toISOString(),
        selection: cloneJson(selection),
      };
      await leaseGuard.assertOwned();
      await putBlobJson(statePath(key, "reservations", reservation.reservation_id), reservation, key);
      return cloneJson(reservation);
    });
  }

  async function renewVerticalPlan(vertical, reservationId, {
    ttlMs = DEFAULT_RESERVATION_TTL_MS,
  } = {}) {
    const checkedTtl = normalizeDuration(ttlMs, "reservation ttl", 1000);
    const key = safeVerticalKey(vertical);
    const id = safeRecordId(reservationId);
    return withBlobLock(key, async (leaseGuard) => {
      const pathname = statePath(key, "reservations", id);
      const current = await readBlobJsonVersioned(pathname, key, { missing: null });
      const renewedAt = clockDate(now, "reservation");
      if (
        !current
        || current.value?.reservation_id !== id
        || Date.parse(current.value?.expires_at) <= renewedAt.getTime()
      ) {
        throw unknownReservation(id, "blob", key);
      }
      const renewed = {
        ...current.value,
        expires_at: new Date(renewedAt.getTime() + checkedTtl).toISOString(),
      };
      await leaseGuard.assertOwned();
      try {
        await putBlobJson(pathname, renewed, key, {
          allowOverwrite: true,
          ifMatch: current.etag,
          conflictCode: "VERTICAL_HISTORY_RESERVATION_LOST",
        });
      } catch (error) {
        if (error.code === "VERTICAL_HISTORY_RESERVATION_LOST") {
          throw unknownReservation(id, "blob", key, error);
        }
        throw error;
      }
      return cloneJson(renewed);
    });
  }

  async function finalizeVerticalPlan(vertical, reservationId, {
    limit = DEFAULT_VERTICAL_HISTORY_LIMIT,
    renderedSectionOrder = null,
  } = {}) {
    const checkedLimit = validateLimit(limit);
    const key = safeVerticalKey(vertical);
    const id = safeRecordId(reservationId);
    return withBlobLock(key, async (leaseGuard) => {
      const finalizedPath = statePath(key, "finalized", id);
      const finalized = await readBlobJson(finalizedPath, key, { missing: null });
      if (finalized) {
        await leaseGuard.assertOwned();
        await deleteBlobPaths([statePath(key, "reservations", id)], key);
        return cloneJson(finalized.rows);
      }
      const history = await getVerticalHistory(key, { limit: checkedLimit });
      const prior = history.find((row) => row.reservation_id === id);
      if (prior) {
        const recoveredReservation = {
          reservation_id: id,
          idempotency_key: prior.idempotency_key ?? null,
          selection: prior.selection ?? { plan: prior.plan },
        };
        await leaseGuard.assertOwned();
        await putBlobJson(finalizedPath, {
          reservation_id: id,
          reservation: recoveredReservation,
          rows: history,
        }, key);
        await pruneFinalizedState(key, checkedLimit, leaseGuard);
        return cloneJson(history);
      }
      const reservationPath = statePath(key, "reservations", id);
      const reservation = await readBlobJson(reservationPath, key, { missing: null });
      if (!reservation) throw unknownReservation(id, "blob", key);
      assertRenderedOrderAvailable(history, renderedSectionOrder, id, key, "blob");
      const rows = await appendVerticalHistory(key, reservation.selection.plan, {
        limit: checkedLimit,
        renderedSectionOrder,
        reservationId: id,
        idempotencyKey: reservation.idempotency_key,
        selectionMetadata: reservation.selection,
        leaseGuard,
      });
      await leaseGuard.assertOwned();
      await putBlobJson(finalizedPath, { reservation_id: id, reservation, rows }, key);
      await pruneFinalizedState(key, checkedLimit, leaseGuard);
      await leaseGuard.assertOwned();
      await deleteBlobPaths([reservationPath], key);
      return cloneJson(rows);
    });
  }

  async function releaseVerticalPlan(vertical, reservationId) {
    const key = safeVerticalKey(vertical);
    const id = safeRecordId(reservationId);
    return withBlobLock(key, async (leaseGuard) => {
      const pathname = statePath(key, "reservations", id);
      const existing = await readBlobJson(pathname, key, { missing: null });
      if (!existing) return false;
      await leaseGuard.assertOwned();
      await deleteBlobPaths([pathname], key);
      return true;
    });
  }

  return {
    backend: "blob",
    getVerticalHistory,
    appendVerticalHistory,
    reserveVerticalPlan,
    renewVerticalPlan,
    finalizeVerticalPlan,
    releaseVerticalPlan,
  };
}

function createFilesystemStore(options) {
  const dataDir = path.resolve(
    options.dataDir
      ?? options.env.SITEFORGE_VERTICAL_HISTORY_DATA_DIR
      ?? (options.env.SITEFORGE_DATA_DIR
        ? path.join(options.env.SITEFORGE_DATA_DIR, "vertical-history")
        : DEFAULT_DATA_DIR),
  );
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const locks = new Map();
  const lockTtlMs = normalizeDuration(options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS, "lock ttl");
  const lockRetryMs = normalizeDuration(options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS, "lock retry", 0);
  const lockMaxWaitMs = normalizeDuration(options.lockMaxWaitMs ?? DEFAULT_LOCK_MAX_WAIT_MS, "lock max wait");
  const lockRenewIntervalMs = normalizeDuration(
    options.lockRenewIntervalMs ?? Math.max(1, Math.floor(lockTtlMs / 3)),
    "lock renew interval",
  );
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  async function readRows(key, limit) {
    const file = path.join(dataDir, `${key}.json`);
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch (cause) {
      if (cause?.code === "ENOENT") return [];
      throw storeFailure("VERTICAL_HISTORY_FILESYSTEM_READ_FAILED", "Filesystem history read failed", {
        backend: "filesystem",
        operation: "read",
        vertical: key,
        cause,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw corruptHistory("Filesystem history is not valid JSON", "filesystem", key, cause);
    }
    if (!Array.isArray(parsed)) {
      throw corruptHistory("Filesystem history must contain an array", "filesystem", key);
    }
    return parsed.map((row, index) => validateRecord(row, `${file}#${index}`, "filesystem", key)).slice(-limit);
  }

  async function getVerticalHistory(vertical, { limit = DEFAULT_VERTICAL_HISTORY_LIMIT } = {}) {
    const checkedLimit = validateLimit(limit);
    return readRows(safeVerticalKey(vertical), checkedLimit);
  }

  async function appendVerticalHistory(vertical, plan, {
    limit = DEFAULT_VERTICAL_HISTORY_LIMIT,
    renderedSectionOrder = null,
    reservationId = null,
    idempotencyKey = null,
    selectionMetadata = null,
  } = {}) {
    const checkedLimit = validateLimit(limit);
    const key = safeVerticalKey(vertical);
    const record = createRecord(plan, now, {
      renderedSectionOrder,
      reservationId,
      idempotencyKey,
      selectionMetadata,
    });
    return withFilesystemLock(key, async (leaseGuard) => {
      const existing = await readRows(key, checkedLimit);
      const next = [...existing, record].slice(-checkedLimit);
      await leaseGuard.assertOwned();
      await writeJsonAtomic(path.join(dataDir, `${key}.json`), next, key);
      return next;
    });
  }

  async function writeJsonAtomic(file, value, key) {
    const temp = `${file}.${process.pid}.${safeRecordId(idFactory())}.tmp`;
    try {
      await mkdir(dataDir, { recursive: true });
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temp, file);
    } catch (cause) {
      await rm(temp, { force: true }).catch(() => {});
      throw storeFailure("VERTICAL_HISTORY_FILESYSTEM_WRITE_FAILED", "Filesystem history write failed", {
        backend: "filesystem", operation: "write", vertical: key, cause,
      });
    }
  }

  function stateFile(key) {
    return path.join(dataDir, `${key}.reservations.json`);
  }

  async function readState(key) {
    let raw;
    try {
      raw = await readFile(stateFile(key), "utf8");
    } catch (cause) {
      if (cause?.code === "ENOENT") return { reservations: [], finalized: [] };
      throw storeFailure("VERTICAL_HISTORY_FILESYSTEM_READ_FAILED", "Filesystem reservation state read failed", {
        backend: "filesystem", operation: "read", vertical: key, cause,
      });
    }
    try {
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed) || !Array.isArray(parsed.reservations) || !Array.isArray(parsed.finalized)) {
        throw new TypeError("invalid reservation state");
      }
      return cloneJson(parsed);
    } catch (cause) {
      throw corruptHistory("Filesystem reservation state is invalid", "filesystem", key, cause);
    }
  }

  async function acquireFilesystemLock(key) {
    await mkdir(dataDir, { recursive: true });
    const pathname = path.join(dataDir, `${key}.lock`);
    const leasePath = path.join(pathname, "lease.json");
    const owner = safeRecordId(idFactory());
    const fence = safeRecordId(idFactory());
    const deadline = Date.now() + lockMaxWaitMs;
    while (Date.now() <= deadline) {
      const acquiredAt = clockDate(now, "lock");
      const lease = {
        owner,
        fence,
        acquired_at: acquiredAt.toISOString(),
        expires_at: new Date(acquiredAt.getTime() + lockTtlMs).toISOString(),
      };
      let handle;
      try {
        await mkdir(pathname);
        handle = await open(leasePath, "wx");
        await writeLeaseHandle(handle, lease);
        return { pathname, leasePath, owner, fence, handle, value: lease };
      } catch (cause) {
        await handle?.close().catch(() => {});
        if (cause?.code !== "EEXIST") {
          await rm(pathname, { recursive: true, force: true }).catch(() => {});
        }
        if (cause?.code !== "EEXIST" && cause?.code !== "EPERM") {
          throw storeFailure("VERTICAL_HISTORY_FILESYSTEM_LOCK_FAILED", "Filesystem lock acquisition failed", {
            backend: "filesystem", operation: "lock", vertical: key, cause,
          });
        }
        let current = null;
        try {
          current = JSON.parse(await readFile(leasePath, "utf8"));
        } catch (readError) {
          if (readError?.code === "ENOTDIR") {
            try {
              current = JSON.parse(await readFile(pathname, "utf8"));
            } catch {
              current = null;
            }
          } else if (readError?.code === "ENOENT") {
            continue;
          }
        }
        if (Date.now() + lockRetryMs > deadline) break;
        await sleep(lockRetryMs);
      }
    }
    throw storeFailure("VERTICAL_HISTORY_LOCK_TIMEOUT", "Timed out acquiring filesystem vertical history lock", {
      backend: "filesystem", operation: "lock", vertical: key,
    });
  }

  async function readFilesystemLease(lease) {
    try {
      return JSON.parse(await readFile(lease.leasePath, "utf8"));
    } catch (cause) {
      if (cause?.code === "ENOENT" || cause?.code === "ENOTDIR") return null;
      throw storeFailure("VERTICAL_HISTORY_FILESYSTEM_LOCK_FAILED", "Filesystem lock read failed", {
        backend: "filesystem", operation: "lock", cause,
      });
    }
  }

  async function assertFilesystemLockOwned(key, lease) {
    const current = await readFilesystemLease(lease);
    if (
      current?.owner !== lease.owner
      || current?.fence !== lease.fence
      || Date.parse(current?.expires_at) <= clockDate(now, "lock").getTime()
    ) {
      throw lostLease("filesystem", key);
    }
    return current;
  }

  async function renewFilesystemLock(key, lease) {
    const current = await assertFilesystemLockOwned(key, lease);
    const renewedAt = clockDate(now, "lock");
    const renewed = {
      ...current,
      expires_at: new Date(renewedAt.getTime() + lockTtlMs).toISOString(),
    };
    await writeLeaseHandle(lease.handle, renewed);
    const confirmed = await readFilesystemLease(lease);
    if (confirmed?.owner !== lease.owner || confirmed?.fence !== lease.fence) {
      throw lostLease("filesystem", key);
    }
    lease.value = renewed;
  }

  async function releaseFilesystemLock(key, lease) {
    let owned = false;
    try {
      await assertFilesystemLockOwned(key, lease);
      owned = true;
    } catch (error) {
      if (error.code !== "VERTICAL_HISTORY_LOCK_LOST") throw error;
    }
    await lease.handle?.close().catch(() => {});
    if (owned) {
      try {
        await rm(lease.pathname, { recursive: true });
      } catch (cause) {
        if (!["ENOENT", "EPERM"].includes(cause?.code)) {
          throw storeFailure("VERTICAL_HISTORY_FILESYSTEM_LOCK_FAILED", "Filesystem lock release failed", {
            backend: "filesystem", operation: "unlock", vertical: key, cause,
          });
        }
      }
    }
  }

  async function withFilesystemLock(key, action) {
    return withKeyLock(locks, key, async () => {
      const lease = await acquireFilesystemLock(key);
      const leaseQueue = createAsyncQueue();
      let stopped = false;
      let renewalError = null;
      let timer = null;
      const assertOwned = async () => {
        if (renewalError) throw renewalError;
        await leaseQueue.run(() => assertFilesystemLockOwned(key, lease));
        if (renewalError) throw renewalError;
      };
      const scheduleRenewal = () => {
        timer = setTimeout(async () => {
          if (stopped) return;
          try {
            await leaseQueue.run(() => renewFilesystemLock(key, lease));
          } catch (error) {
            renewalError = error;
            stopped = true;
          }
          if (!stopped) scheduleRenewal();
        }, lockRenewIntervalMs);
        timer.unref?.();
      };
      scheduleRenewal();
      try {
        const result = await action({ assertOwned });
        await assertOwned();
        return result;
      } finally {
        stopped = true;
        if (timer) clearTimeout(timer);
        await leaseQueue.idle();
        await releaseFilesystemLock(key, lease);
      }
    });
  }

  function pruneState(state, finalizedLimit = MAX_HISTORY_LIMIT) {
    const current = clockDate(now, "reservation").getTime();
    state.reservations = state.reservations.filter((item) => Date.parse(item.expires_at) > current);
    state.finalized = state.finalized.slice(-finalizedLimit);
    return state;
  }

  async function reserveVerticalPlan(vertical, selectPlan, {
    limit = DEFAULT_VERTICAL_HISTORY_LIMIT,
    idempotencyKey = null,
    ttlMs = DEFAULT_RESERVATION_TTL_MS,
  } = {}) {
    if (typeof selectPlan !== "function") throw new TypeError("reserveVerticalPlan selector required");
    const checkedLimit = validateLimit(limit);
    const checkedTtl = normalizeDuration(ttlMs, "reservation ttl", 1000);
    const key = safeVerticalKey(vertical);
    return withFilesystemLock(key, async (leaseGuard) => {
      const state = pruneState(await readState(key), checkedLimit);
      const idempotency = idempotencyKey == null ? null : String(idempotencyKey);
      const existing = idempotency
        ? state.reservations.find((item) => item.idempotency_key === idempotency)
          ?? state.finalized.find((item) => item.reservation.idempotency_key === idempotency)?.reservation
        : null;
      if (existing) {
        await leaseGuard.assertOwned();
        await writeJsonAtomic(stateFile(key), state, key);
        return cloneJson(existing);
      }
      const history = await readRows(key, checkedLimit);
      const committed = idempotency
        ? history.find((row) => row.idempotency_key === idempotency)
        : null;
      if (committed) {
        const recovered = reservationFromRecord(committed);
        state.finalized.push({ reservation: recovered, rows: history });
        state.finalized = state.finalized.slice(-checkedLimit);
        await leaseGuard.assertOwned();
        await writeJsonAtomic(stateFile(key), state, key);
        return cloneJson(recovered);
      }
      const selection = await selectPlan([
        ...history.map((row) => row.plan),
        ...state.reservations.map((item) => item.selection.plan),
      ]);
      validateSelection(selection);
      const created = clockDate(now, "reservation");
      const reservation = {
        reservation_id: safeRecordId(idFactory()),
        idempotency_key: idempotency,
        created_at: created.toISOString(),
        expires_at: new Date(created.getTime() + checkedTtl).toISOString(),
        selection: cloneJson(selection),
      };
      state.reservations.push(reservation);
      await leaseGuard.assertOwned();
      await writeJsonAtomic(stateFile(key), state, key);
      return cloneJson(reservation);
    });
  }

  async function renewVerticalPlan(vertical, reservationId, {
    ttlMs = DEFAULT_RESERVATION_TTL_MS,
  } = {}) {
    const checkedTtl = normalizeDuration(ttlMs, "reservation ttl", 1000);
    const key = safeVerticalKey(vertical);
    const id = safeRecordId(reservationId);
    return withFilesystemLock(key, async (leaseGuard) => {
      const state = await readState(key);
      const renewedAt = clockDate(now, "reservation");
      const reservation = state.reservations.find((item) => item.reservation_id === id);
      if (!reservation || Date.parse(reservation.expires_at) <= renewedAt.getTime()) {
        throw unknownReservation(id, "filesystem", key);
      }
      reservation.expires_at = new Date(renewedAt.getTime() + checkedTtl).toISOString();
      await leaseGuard.assertOwned();
      await writeJsonAtomic(stateFile(key), state, key);
      return cloneJson(reservation);
    });
  }

  async function finalizeVerticalPlan(vertical, reservationId, {
    limit = DEFAULT_VERTICAL_HISTORY_LIMIT,
    renderedSectionOrder = null,
  } = {}) {
    const checkedLimit = validateLimit(limit);
    const key = safeVerticalKey(vertical);
    const id = safeRecordId(reservationId);
    return withFilesystemLock(key, async (leaseGuard) => {
      const state = pruneState(await readState(key), checkedLimit);
      const finalized = state.finalized.find((item) => item.reservation.reservation_id === id);
      if (finalized) return cloneJson(finalized.rows);
      const history = await readRows(key, checkedLimit);
      const prior = history.find((row) => row.reservation_id === id);
      if (prior) {
        state.finalized.push({ reservation: reservationFromRecord(prior), rows: history });
        state.finalized = state.finalized.slice(-checkedLimit);
        await leaseGuard.assertOwned();
        await writeJsonAtomic(stateFile(key), state, key);
        return cloneJson(history);
      }
      const reservation = state.reservations.find((item) => item.reservation_id === id);
      if (!reservation) throw unknownReservation(id, "filesystem", key);
      assertRenderedOrderAvailable(history, renderedSectionOrder, id, key, "filesystem");
      const record = createRecord(reservation.selection.plan, now, {
        renderedSectionOrder,
        reservationId: id,
        idempotencyKey: reservation.idempotency_key,
        selectionMetadata: reservation.selection,
      });
      const rows = [...history, record].slice(-checkedLimit);
      await leaseGuard.assertOwned();
      await writeJsonAtomic(path.join(dataDir, `${key}.json`), rows, key);
      state.reservations = state.reservations.filter((item) => item.reservation_id !== id);
      state.finalized.push({ reservation, rows });
      state.finalized = state.finalized.slice(-checkedLimit);
      await leaseGuard.assertOwned();
      await writeJsonAtomic(stateFile(key), state, key);
      return cloneJson(rows);
    });
  }

  async function releaseVerticalPlan(vertical, reservationId) {
    const key = safeVerticalKey(vertical);
    const id = safeRecordId(reservationId);
    return withFilesystemLock(key, async (leaseGuard) => {
      const state = pruneState(await readState(key));
      if (state.finalized.some((item) => item.reservation.reservation_id === id)) return false;
      const before = state.reservations.length;
      state.reservations = state.reservations.filter((item) => item.reservation_id !== id);
      await leaseGuard.assertOwned();
      await writeJsonAtomic(stateFile(key), state, key);
      return state.reservations.length !== before;
    });
  }

  return {
    backend: "filesystem",
    dataDir,
    getVerticalHistory,
    appendVerticalHistory,
    reserveVerticalPlan,
    renewVerticalPlan,
    finalizeVerticalPlan,
    releaseVerticalPlan,
  };
}

function createRecord(plan, now, {
  renderedSectionOrder = null,
  reservationId = null,
  idempotencyKey = null,
  selectionMetadata = null,
} = {}) {
  const clonedPlan = clonePlan(plan);
  const date = clockDate(now, "append");
  const order = normalizedSectionOrder(renderedSectionOrder);
  return {
    at: date.toISOString(),
    plan: clonedPlan,
    ...(order.length ? { rendered_section_order: order } : {}),
    ...(reservationId ? { reservation_id: String(reservationId) } : {}),
    ...(idempotencyKey != null ? { idempotency_key: String(idempotencyKey) } : {}),
    ...(selectionMetadata ? { selection: cloneJson(selectionMetadata) } : {}),
  };
}

function clonePlan(plan) {
  if (!isPlainObject(plan)) {
    throw storeFailure("VERTICAL_HISTORY_PLAN_INVALID", "Vertical history plan must be an object", {
      operation: "append",
    });
  }
  assertJsonValue(plan, new Set());
  return JSON.parse(JSON.stringify(plan));
}

function assertJsonValue(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw storeFailure("VERTICAL_HISTORY_PLAN_INVALID", "Vertical history plan contains a non-finite number", {
      operation: "append",
    });
  }
  if (typeof value !== "object") {
    throw storeFailure("VERTICAL_HISTORY_PLAN_INVALID", "Vertical history plan must contain only JSON values", {
      operation: "append",
    });
  }
  if (seen.has(value)) {
    throw storeFailure("VERTICAL_HISTORY_PLAN_INVALID", "Vertical history plan contains a cycle", {
      operation: "append",
    });
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw storeFailure("VERTICAL_HISTORY_PLAN_INVALID", "Vertical history plan contains a non-JSON object", {
      operation: "append",
    });
  }
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) assertJsonValue(item, seen);
  seen.delete(value);
}

function parseRecord(raw, source, backend, vertical) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw corruptHistory(`History record is not valid JSON: ${source}`, backend, vertical, cause);
  }
  return validateRecord(parsed, source, backend, vertical);
}

function validateRecord(record, source, backend, vertical) {
  if (!isPlainObject(record) || typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at))) {
    throw corruptHistory(`History record has an invalid envelope: ${source}`, backend, vertical);
  }
  try {
    const order = normalizedSectionOrder(record.rendered_section_order);
    return {
      at: record.at,
      plan: clonePlan(record.plan),
      ...(order.length ? { rendered_section_order: order } : {}),
      ...(record.reservation_id ? { reservation_id: String(record.reservation_id) } : {}),
      ...(record.idempotency_key != null ? { idempotency_key: String(record.idempotency_key) } : {}),
      ...(record.selection ? { selection: cloneJson(record.selection) } : {}),
    };
  } catch (cause) {
    throw corruptHistory(`History record has an invalid plan: ${source}`, backend, vertical, cause);
  }
}

function validateLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw storeFailure("VERTICAL_HISTORY_LIMIT_INVALID", `History limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}`, {
      operation: "configure",
    });
  }
  return limit;
}

function normalizeDuration(value, label, minimum = 1) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration < minimum) {
    throw storeFailure("VERTICAL_HISTORY_DURATION_INVALID", `${label} must be at least ${minimum}ms`, {
      operation: "configure",
    });
  }
  return Math.floor(duration);
}

function isBlobPreconditionFailure(error) {
  return error?.name === "BlobPreconditionFailedError"
    || error?.status === 412
    || error?.statusCode === 412
    || error?.code === "BLOB_PRECONDITION_FAILED";
}

function isBlobRateLimited(error) {
  return error?.name === "BlobServiceRateLimited"
    || error?.constructor?.name === "BlobServiceRateLimited"
    || error?.status === 429
    || error?.statusCode === 429
    || error?.code === "BLOB_RATE_LIMITED";
}

function blobRateLimitRetryDelayMs(error, attempt) {
  const retryAfterMs = Number(error?.retryAfter) * 1000;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_BLOB_RATE_LIMIT_RETRY_AFTER_MS);
  }
  return BLOB_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
}

function lostLease(backend, vertical, cause = null) {
  return storeFailure("VERTICAL_HISTORY_LOCK_LOST", "Vertical history lease ownership was lost", {
    backend,
    operation: "lock",
    vertical,
    ...(cause ? { cause } : {}),
  });
}

function createAsyncQueue() {
  let tail = Promise.resolve();
  return {
    run(action) {
      const result = tail.then(action, action);
      tail = result.catch(() => {});
      return result;
    },
    idle() {
      return tail;
    },
  };
}

async function writeLeaseHandle(handle, lease) {
  const body = Buffer.from(`${JSON.stringify(lease)}\n`, "utf8");
  const { bytesWritten } = await handle.write(body, 0, body.length, 0);
  if (bytesWritten !== body.length) throw new Error("Short filesystem lease write");
  await handle.truncate(body.length);
  await handle.sync();
}

function clockDate(now, operation) {
  let date;
  try {
    date = now();
    if (!(date instanceof Date)) date = new Date(date);
  } catch (cause) {
    throw storeFailure("VERTICAL_HISTORY_CLOCK_INVALID", "Vertical history clock failed", {
      operation, cause,
    });
  }
  if (!Number.isFinite(date.getTime())) {
    throw storeFailure("VERTICAL_HISTORY_CLOCK_INVALID", "Vertical history clock returned an invalid date", {
      operation,
    });
  }
  return date;
}

function normalizedSectionOrder(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function assertRenderedOrderAvailable(rows, order, reservationId, vertical, backend) {
  const normalized = normalizedSectionOrder(order);
  if (!normalized.length) return;
  const key = normalized.join("|");
  const collision = rows.find((row) => (
    row.reservation_id !== reservationId
    && normalizedSectionOrder(row.rendered_section_order).join("|") === key
  ));
  if (!collision) return;
  const error = storeFailure(
    "VERTICAL_HISTORY_RENDERED_ORDER_COLLISION",
    `Rendered section order already committed: ${key}`,
    { backend, operation: "finalize", vertical },
  );
  error.rendered_section_order = normalized;
  throw error;
}

function validateSelection(selection) {
  if (!isPlainObject(selection) || !isPlainObject(selection.plan)) {
    throw new TypeError("reserveVerticalPlan selection must contain a plan");
  }
  cloneJson(selection);
}

function reservationFromRecord(record) {
  return {
    reservation_id: String(record.reservation_id),
    idempotency_key: record.idempotency_key ?? null,
    created_at: record.at,
    expires_at: record.at,
    selection: cloneJson(record.selection ?? { plan: record.plan }),
  };
}

function unknownReservation(id, backend, vertical, cause = null) {
  return storeFailure("VERTICAL_HISTORY_RESERVATION_UNKNOWN", `Unknown vertical plan reservation: ${id}`, {
    backend, operation: "finalize", vertical, ...(cause ? { cause } : {}),
  });
}

function cloneJson(value) {
  assertJsonValue(value, new Set());
  return JSON.parse(JSON.stringify(value));
}

function normalizeBlobPrefix(prefix) {
  const normalized = String(prefix || "").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\\")) {
    throw new VerticalHistoryStoreError("Blob prefix is invalid", {
      code: "VERTICAL_HISTORY_BLOB_PREFIX_INVALID",
      backend: "blob",
      operation: "configure",
    });
  }
  return normalized;
}

function recordPathSegment(at, idFactory) {
  const stamp = String(new Date(at).getTime()).padStart(16, "0");
  return `${stamp}-${safeRecordId(idFactory())}`;
}

function safeRecordId(value) {
  const safe = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  if (!safe) {
    throw storeFailure("VERTICAL_HISTORY_ID_INVALID", "Vertical history record id is invalid", {
      operation: "append",
    });
  }
  return safe;
}

function sortBlobItems(items) {
  return [...items].sort((a, b) => a.pathname.localeCompare(b.pathname));
}

async function withKeyLock(locks, key, action) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function corruptHistory(message, backend, vertical, cause) {
  return storeFailure("VERTICAL_HISTORY_CORRUPT", message, {
    backend,
    operation: "read",
    vertical,
    cause,
  });
}

function storeFailure(code, message, details = {}) {
  return new VerticalHistoryStoreError(message, { code, ...details });
}
