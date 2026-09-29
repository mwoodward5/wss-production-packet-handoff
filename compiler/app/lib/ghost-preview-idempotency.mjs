import { createHash } from "node:crypto";

const OWNER_ID = "ghost-agency";
const DEFAULT_PREFIX = "sf/ghost-agency/build-preview-idempotency-v1";

export class GhostPreviewIdempotencyError extends Error {
  constructor(message, { status = 400, code = "GHOST_PREVIEW_IDEMPOTENCY_INVALID", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GhostPreviewIdempotencyError";
    this.status = status;
    this.code = code;
  }
}

// Parsed request bodies are JSON values. Rejecting non-JSON values keeps the
// request fingerprint stable instead of silently changing what is hashed.
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function ghostPreviewPayloadHash(payload) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/**
 * Claims one durable Ghost build-preview slot. The owner id is intentionally
 * fixed: Ghost idempotency keys must never collide with SiteForge user builds.
 *
 * The default store uses an immutable Blob pathname rather than the generic
 * daily build-contract lease, so a valid replay remains available after 24h.
 * A compatible store with claim()/assertAvailable() may be injected for tests
 * or for a platform-owned durable store.
 */
export function createGhostPreviewIdempotencyCore({
  store = createFixedBlobGhostPreviewStore(),
  now = () => new Date(),
} = {}) {
  if (!store || typeof store.claim !== "function") throw new TypeError("A durable Ghost preview idempotency store is required");

  return {
    async claim({ idempotencyKey, correlationId, jobId = correlationId, payload }) {
      const key = validateIdempotencyKey(idempotencyKey);
      const requestedCorrelationId = validateCorrelationId(correlationId);
      const requestedJobId = validateJobId(jobId);
      let payloadHash;
      try {
        // Hash only fields the build route consumes. Ghost adds transport
        // metadata such as requestedAt on every HTTP attempt; including those
        // volatile fields would turn a safe retry into a false 409.
        payloadHash = ghostPreviewPayloadHash(buildRelevantPayload(payload));
      } catch (cause) {
        throw new GhostPreviewIdempotencyError("Ghost build-preview payload must be JSON", {
          code: "GHOST_PREVIEW_PAYLOAD_INVALID",
          cause,
        });
      }

      const acceptedAt = now().toISOString();
      const envelope = {
        version: 1,
        owner_id: OWNER_ID,
        accepted_at: acceptedAt,
        correlation_id: requestedCorrelationId,
        job_id: requestedJobId,
      };

      let result;
      try {
        // Do this before any work starts. A production request must not fall
        // back to process memory when Blob is absent or unhealthy.
        store.assertAvailable?.();
        result = await store.claim({
          ownerId: OWNER_ID,
          idempotencyKey: key,
          payloadHash,
          buildId: requestedJobId,
          acceptedAt,
          envelope,
        });
      } catch (cause) {
        if (cause instanceof GhostPreviewIdempotencyError) throw cause;
        throw unavailable(cause);
      }

      const lease = result?.lease;
      if (!lease || typeof lease.build_id !== "string" || typeof lease.payload_hash !== "string") throw unavailable();
      if (lease.owner_id !== OWNER_ID || lease.idempotency_key !== key) throw unavailable();
      if (lease.payload_hash !== payloadHash) {
        throw new GhostPreviewIdempotencyError("Idempotency key was already used for a different payload", {
          status: 409,
          code: "GHOST_PREVIEW_IDEMPOTENCY_KEY_CONFLICT",
        });
      }

      const winnerCorrelationId = String(lease.build_id);
      const storedEnvelope = result.envelope || lease.envelope || null;
      if (storedEnvelope?.job_id && String(storedEnvelope.job_id) !== winnerCorrelationId) throw unavailable();
      const persistedCorrelationId = typeof storedEnvelope?.correlation_id === "string"
        ? storedEnvelope.correlation_id
          : winnerCorrelationId;
      return {
        owner: result.owner === true,
        replay: result.owner !== true,
        idempotencyKey: key,
        payloadHash,
        jobId: winnerCorrelationId,
        buildId: winnerCorrelationId,
        correlationId: persistedCorrelationId,
        acceptedAt: lease.accepted_at || acceptedAt,
        envelope: storedEnvelope,
      };
    },
  };
}

/**
 * Immutable-path implementation of the build-contract claim protocol. It is
 * deliberately small because the Ghost preview route only needs a claim, not
 * the generic contract store's terminal-response persistence.
 */
export function createFixedBlobGhostPreviewStore(options = {}) {
  const env = options.env ?? process.env;
  const token = options.token ?? env.BLOB_READ_WRITE_TOKEN ?? null;
  const prefix = normalizePrefix(options.prefix ?? DEFAULT_PREFIX);
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  let clientPromise;

  function assertAvailable() {
    if (!token && !options.blobClient) {
      throw new GhostPreviewIdempotencyError("Durable Ghost build-preview storage is not configured", {
        status: 503,
        code: "GHOST_PREVIEW_IDEMPOTENCY_STORE_UNAVAILABLE",
      });
    }
  }

  async function client() {
    assertAvailable();
    if (!clientPromise) {
      clientPromise = Promise.resolve(options.blobClient ?? (options.sdkLoader ? options.sdkLoader() : import("@vercel/blob")))
        .then((value) => {
          if (typeof value?.put !== "function" || typeof value?.head !== "function") {
            throw new GhostPreviewIdempotencyError("Durable Ghost build-preview storage is invalid", {
              status: 503,
              code: "GHOST_PREVIEW_IDEMPOTENCY_STORE_UNAVAILABLE",
            });
          }
          return value;
        });
    }
    return clientPromise;
  }

  async function getJson(pathname) {
    let metadata;
    try {
      metadata = await (await client()).head(pathname, token ? { token } : undefined);
    } catch (cause) {
      if (isMissing(cause)) return null;
      throw unavailable(cause);
    }
    if (metadata?.pathname !== pathname || !isHttpUrl(metadata?.url) || !metadata?.etag) throw unavailable();

    // SiteForge's existing Blob store is public. Public `get()` reads can be
    // served from CDN cache, including a stale 404 observed just before an
    // immutable winner write. `head()` is the authenticated metadata/origin
    // lookup; the winner's ETag makes this content URL impossible to have been
    // cached before that write.
    const contentUrl = new URL(metadata.url);
    contentUrl.searchParams.set("__sf_claim_etag", String(metadata.etag));
    let response;
    try {
      response = await fetchFn(contentUrl, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (!response?.ok) throw unavailable();
      return JSON.parse(await response.text());
    } catch (cause) {
      if (cause instanceof GhostPreviewIdempotencyError) throw cause;
      throw unavailable(cause);
    }
  }

  async function putJson(pathname, value) {
    try {
      const response = await (await client()).put(pathname, JSON.stringify(value), {
        access: "public",
        ...(token ? { token } : {}),
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      if (response?.pathname !== pathname || !isHttpUrl(response?.url)) throw unavailable();
      return true;
    } catch (cause) {
      if (cause instanceof GhostPreviewIdempotencyError) throw cause;
      if (isConflict(cause)) return false;
      throw unavailable(cause);
    }
  }

  return {
    assertAvailable,
    async claim(input) {
      const pathname = leasePath(prefix, input.ownerId, input.idempotencyKey);
      const existing = await getJson(pathname);
      if (existing) return { owner: false, lease: existing, envelope: existing.envelope || null };

      const lease = {
        version: 1,
        owner_id: input.ownerId,
        idempotency_key: input.idempotencyKey,
        payload_hash: input.payloadHash,
        build_id: input.buildId,
        accepted_at: input.acceptedAt,
        envelope: input.envelope,
      };
      if (await putJson(pathname, lease)) return { owner: true, lease, envelope: input.envelope };

      let winner = null;
      // A successful immutable write can become visible a few milliseconds
      // before an uncached read in another region. Retry only the winner read;
      // never retry the write or elect a second owner.
      for (let attempt = 0; attempt < 4 && !winner; attempt += 1) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 25));
        winner = await getJson(pathname);
      }
      if (!winner) throw unavailable();
      return { owner: false, lease: winner, envelope: winner.envelope || null };
    },
  };
}

function validateIdempotencyKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) throw new GhostPreviewIdempotencyError("Idempotency-Key is required", { code: "GHOST_PREVIEW_IDEMPOTENCY_KEY_REQUIRED" });
  if (key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new GhostPreviewIdempotencyError("Idempotency-Key is invalid", { code: "GHOST_PREVIEW_IDEMPOTENCY_KEY_INVALID" });
  }
  return key;
}

function validateCorrelationId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new GhostPreviewIdempotencyError("Ghost correlation ID is required", { code: "GHOST_PREVIEW_CORRELATION_ID_REQUIRED" });
  if (id.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new GhostPreviewIdempotencyError("Ghost correlation ID is invalid", { code: "GHOST_PREVIEW_CORRELATION_ID_INVALID" });
  }
  return id;
}

function validateJobId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new GhostPreviewIdempotencyError("Ghost build job ID is required", { code: "GHOST_PREVIEW_JOB_ID_REQUIRED" });
  if (id.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new GhostPreviewIdempotencyError("Ghost build job ID is invalid", { code: "GHOST_PREVIEW_JOB_ID_INVALID" });
  }
  return id;
}

function buildRelevantPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return {
    prospect: payload.prospect ?? null,
    packets: payload.packets ?? null,
    injected_media: payload.injected_media ?? null,
    composition_slot: payload.composition_slot ?? payload.compositionSlot ?? null,
    // Mirror the route's truthy alias precedence. Hashing the first merely
    // present alias would miss a later effective value when the first is "".
    checkout_url: payload.purchase_url
      || payload.purchaseUrl
      || payload.checkout_url
      || payload.checkoutUrl
      || null,
    preview_expires_at: payload.preview_expires_at || payload.previewExpiresAt || null,
  };
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("Payload must contain JSON values only");
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}

function leasePath(prefix, ownerId, idempotencyKey) {
  const identity = createHash("sha256").update(`${ownerId}\0${idempotencyKey}`).digest("hex");
  return `${prefix}/leases/${identity}.json`;
}

function normalizePrefix(value) {
  const prefix = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..")) throw new TypeError("Invalid Ghost preview Blob prefix");
  return prefix;
}

function unavailable(cause) {
  return new GhostPreviewIdempotencyError("Durable Ghost build-preview storage is unavailable", {
    status: 503,
    code: "GHOST_PREVIEW_IDEMPOTENCY_STORE_UNAVAILABLE",
    cause,
  });
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function isConflict(error) {
  return [error?.status, error?.statusCode].includes(409)
    || /already exists|conflict|overwrite|409/i.test(String(error?.code || error?.message || ""));
}

function isMissing(error) {
  return [error?.status, error?.statusCode].includes(404)
    || error?.name === "BlobNotFoundError"
    || /not found|404|Vercel Blob:\s*The requested blob does not exist/i.test(String(error?.code || error?.message || ""));
}
