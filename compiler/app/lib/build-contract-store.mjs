import { createHash } from "node:crypto";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PREFIX = "sf/contract-builds";
const TERMINAL_STATES = new Set(["ready", "failed", "cancelled"]);

export class BuildContractStoreError extends Error {
  constructor(message, { code = "BUILD_CONTRACT_STORE_UNAVAILABLE", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "BuildContractStoreError";
    this.code = code;
    this.status = 503;
  }
}

export function createMemoryBuildContractStore({ now = () => new Date() } = {}) {
  const leases = new Map();
  const records = new Map();

  return {
    assertAvailable() {},
    async claim(input) {
      const key = leaseIdentity(input.ownerId, input.idempotencyKey);
      const existing = leases.get(key);
      if (existing && isFresh(existing.accepted_at, now())) {
        return { owner: false, lease: clone(existing), envelope: clone(records.get(existing.build_id) || existing.envelope) };
      }
      const lease = createLease(input);
      leases.set(key, lease);
      records.set(input.buildId, input.envelope);
      return { owner: true, lease: clone(lease), envelope: clone(input.envelope) };
    },
    async get(buildId) {
      return clone(records.get(buildId) || null);
    },
    async saveTerminal(buildId, response) {
      const existing = records.get(buildId);
      if (!existing) throw new BuildContractStoreError("Build record is unavailable", { code: "BUILD_RECORD_MISSING" });
      if (isTerminal(existing.response)) return clone(existing);
      if (!isTerminal(response)) throw new TypeError("saveTerminal requires a terminal response");
      const next = { ...existing, response: clone(response), terminal_at: terminalAt(response) };
      records.set(buildId, next);
      return clone(next);
    },
    size() { return records.size; },
    clear() { leases.clear(); records.clear(); },
  };
}

export function createBlobBuildContractStore(options = {}) {
  const env = options.env ?? process.env;
  const token = options.token ?? env.BLOB_READ_WRITE_TOKEN ?? null;
  const prefix = normalizePrefix(options.prefix ?? DEFAULT_PREFIX);
  const now = options.now ?? (() => new Date());
  let clientPromise;

  function assertAvailable() {
    if (!token && !options.blobClient) {
      throw new BuildContractStoreError("Durable build storage is not configured");
    }
  }

  async function client() {
    assertAvailable();
    if (!clientPromise) {
      clientPromise = Promise.resolve(options.blobClient ?? (options.sdkLoader ? options.sdkLoader() : import("@vercel/blob")))
        .then((value) => {
          if (typeof value?.put !== "function" || typeof value?.get !== "function") {
            throw new BuildContractStoreError("Blob client is missing put() or get()", { code: "BUILD_CONTRACT_BLOB_CLIENT_INVALID" });
          }
          return value;
        });
    }
    return clientPromise;
  }

  async function getJson(pathname) {
    const blob = await client();
    let result;
    try {
      result = await blob.get(pathname, { access: "public", ...(token ? { token } : {}) });
    } catch (cause) {
      if (isMissing(cause)) return null;
      throw new BuildContractStoreError("Build storage read failed", { code: "BUILD_CONTRACT_BLOB_READ_FAILED", cause });
    }
    if (!result || result.statusCode === 404) return null;
    if (result.statusCode !== 200 || !result.stream) {
      throw new BuildContractStoreError("Build storage returned an invalid read", { code: "BUILD_CONTRACT_BLOB_READ_INVALID" });
    }
    try {
      return JSON.parse(await new Response(result.stream).text());
    } catch (cause) {
      throw new BuildContractStoreError("Build storage record is invalid", { code: "BUILD_CONTRACT_BLOB_RECORD_INVALID", cause });
    }
  }

  async function putJson(pathname, value, { allowOverwrite }) {
    const blob = await client();
    try {
      const result = await blob.put(pathname, JSON.stringify(value), {
        access: "public",
        ...(token ? { token } : {}),
        addRandomSuffix: false,
        allowOverwrite,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      if (result?.pathname !== pathname || !isHttpUrl(result?.url)) {
        throw new BuildContractStoreError("Build storage write was not confirmed", { code: "BUILD_CONTRACT_BLOB_WRITE_UNCONFIRMED" });
      }
      return result;
    } catch (cause) {
      if (cause instanceof BuildContractStoreError) throw cause;
      if (!allowOverwrite && isConflict(cause)) return null;
      throw new BuildContractStoreError("Build storage write failed", { code: "BUILD_CONTRACT_BLOB_WRITE_FAILED", cause });
    }
  }

  async function readFreshLease(ownerId, idempotencyKey) {
    const identity = leaseIdentity(ownerId, idempotencyKey);
    const date = now();
    const candidates = await Promise.all([
      getJson(leasePath(prefix, identity, date)),
      getJson(leasePath(prefix, identity, new Date(date.getTime() - 24 * 60 * 60 * 1000))),
    ]);
    return candidates.filter((value) => value && isFresh(value.accepted_at, date))
      .sort((a, b) => Date.parse(b.accepted_at) - Date.parse(a.accepted_at))[0] || null;
  }

  return {
    assertAvailable,
    async claim(input) {
      const existing = await readFreshLease(input.ownerId, input.idempotencyKey);
      if (existing) return { owner: false, lease: existing, envelope: await getJson(recordPath(prefix, existing.build_id)) || existing.envelope };

      const identity = leaseIdentity(input.ownerId, input.idempotencyKey);
      const pathname = leasePath(prefix, identity, now());
      const lease = createLease(input);
      const acquired = await putJson(pathname, lease, { allowOverwrite: false });
      if (!acquired) {
        const winner = await getJson(pathname);
        if (!winner) throw new BuildContractStoreError("Build lease winner is unavailable", { code: "BUILD_CONTRACT_LEASE_UNAVAILABLE" });
        return { owner: false, lease: winner, envelope: await getJson(recordPath(prefix, winner.build_id)) || winner.envelope };
      }
      await putJson(recordPath(prefix, input.buildId), input.envelope, { allowOverwrite: false });
      return { owner: true, lease, envelope: input.envelope };
    },
    get(buildId) {
      return getJson(recordPath(prefix, buildId));
    },
    async saveTerminal(buildId, response) {
      const pathname = recordPath(prefix, buildId);
      const existing = await getJson(pathname);
      if (!existing) throw new BuildContractStoreError("Build record is unavailable", { code: "BUILD_RECORD_MISSING" });
      if (isTerminal(existing.response)) return existing;
      if (!isTerminal(response)) throw new TypeError("saveTerminal requires a terminal response");
      const next = { ...existing, response, terminal_at: terminalAt(response) };
      await putJson(pathname, next, { allowOverwrite: true });
      return next;
    },
  };
}

function createLease({ ownerId, idempotencyKey, payloadHash, buildId, acceptedAt, envelope }) {
  return {
    version: 1,
    owner_id: ownerId,
    idempotency_key: idempotencyKey,
    payload_hash: payloadHash,
    build_id: buildId,
    accepted_at: acceptedAt,
    envelope,
  };
}

function leaseIdentity(ownerId, idempotencyKey) {
  return createHash("sha256").update(`${ownerId}\0${idempotencyKey}`).digest("hex");
}

function leasePath(prefix, identity, date) {
  return `${prefix}/leases/${identity}/${date.toISOString().slice(0, 10)}.json`;
}

function recordPath(prefix, buildId) {
  const safe = String(buildId).replace(/[^A-Za-z0-9_-]/g, "_");
  return `${prefix}/records/${safe}.json`;
}

function isFresh(acceptedAt, date) {
  const age = date.getTime() - Date.parse(acceptedAt);
  return Number.isFinite(age) && age >= 0 && age < IDEMPOTENCY_TTL_MS;
}

function isTerminal(response) {
  return TERMINAL_STATES.has(response?.status || response?.state)
    || response?.schema_version === "siteforge-build-failure-v1";
}

function terminalAt(response) {
  return response.completed_at || response.failed_at || response.emitted_at || new Date().toISOString();
}

function normalizePrefix(value) {
  const prefix = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..")) throw new TypeError("Invalid build contract Blob prefix");
  return prefix;
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function isConflict(error) {
  return [error?.status, error?.statusCode].includes(409)
    || /already exists|conflict|overwrite|409/i.test(String(error?.code || error?.message || ""));
}

function isMissing(error) {
  return [error?.status, error?.statusCode].includes(404) || /not found|404/i.test(String(error?.code || error?.message || ""));
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}
