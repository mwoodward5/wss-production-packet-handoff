"use strict";

// Production adapter for the immutable shared *.wss-ai.com release lane.
//
// Once this publisher is selected, every failure is terminal for this build:
// callers receive fallback:false and must never reinterpret the result as
// permission to deploy a legacy per-site Vercel project.

const { createHash } = require("node:crypto");
const {
  SHARED_RELEASE_BUCKET,
  MANIFEST_SCHEMA,
  canonicalFilePath,
  isSharedPublishEnabled,
  isLocalSharedSiteEnvironment,
  localSiteGatewayOrigin,
  prepareRelease,
  publishSharedSiteRelease,
  activateSharedSiteRelease,
  rollbackSharedSiteRelease,
  quarantineSharedSiteRelease,
  releaseEnvironment,
} = require("./shared-site-release");
const { mintPreviewGrant } = require("./shared-site-preview");
const {
  LOCAL_DOMAIN_ATTACH,
  ROUTER_PROJECT_ID,
  createVercelSharedSiteHostProvisioner,
} = require("./shared-site-host-provisioner");

const SHARED_RELEASE_EVIDENCE_SCHEMA = "shared-site-release-evidence-v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const MAX_OPERATION_KEY_BYTES = 2048;
// A brand-new shared host needs its TLS/axis provisioning to settle before
// the public release confirms; production (2026-08-31, Andersen Construction)
// showed fresh hosts taking 15-30s while the old 10s window burned every
// confirm attempt. 45s still bounds the invocation well inside the line
// consumer's 230s build budget.
const POST_ACTIVATION_SAFETY_TIMEOUT_MS = 45_000;
const ROLLBACK_COMPENSATION_RESERVE_MS = 1_500;
const PREFLIGHT_SITE_ID = "00000000-0000-4000-8000-000000000001";
const PREFLIGHT_RELEASE_ID = "00000000-0000-4000-8000-000000000002";

// --- Fresh-host retry policy -----------------------------------------------
//
// A brand-new per-site host on the shared mirror domain intermittently returns
// 502/503/504 (or fails at the network/TLS layer) while Vercel finishes
// provisioning the hostname; the same URL succeeds seconds later. Every
// preview, probe, and release-confirmation fetch therefore retries the SAME
// URL on a named budget before the build is declared failed. Budgets are
// exported and injectable so tests can run without real delays.

const SHARED_PREVIEW_RETRYABLE_STATUSES = Object.freeze(new Set([502, 503, 504]));
// Preview/probe fetches: the worker re-probes the same deployment on its own
// bounded retry, so the in-fetch budget stays at three extra attempts with an
// increasing backoff (~26s of waiting across the worst case).
const SHARED_PREVIEW_RETRY_DELAYS_MS = Object.freeze([3000, 8000, 15000]);
// Release confirmation (post-activation verification and verifyActiveRelease)
// polls inside the post-activation window, which now spans fresh-host TLS
// provisioning: four extra attempts with backoff, ~27s of waiting worst case.
const SHARED_RELEASE_CONFIRM_RETRY_DELAYS_MS = Object.freeze([2000, 5000, 8000, 12000]);

function isSharedRetryableStatus(status) {
  return SHARED_PREVIEW_RETRYABLE_STATUSES.has(Number(status));
}

/** Delay to wait after `attemptsMade` failed attempts; 0 once the budget is
 *  exhausted (no further attempt may be made). */
function sharedRetryDelayMs(delays, attemptsMade) {
  if (!Array.isArray(delays)) return 0;
  return Number.isSafeInteger(attemptsMade) && attemptsMade >= 1 && attemptsMade <= delays.length
    ? delays[attemptsMade - 1]
    : 0;
}

function defaultSharedRetrySleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Fetch one URL with the fresh-host retry budget. Retries only what the
 * provisioning race produces: network-level errors (TLS/DNS resets) and
 * 502/503/504 responses. Any other response — including every 4xx — returns
 * immediately. Never retries caller cancellation (AbortError) and stops
 * before a delay that would run past `deadlineAt`.
 */
async function fetchWithSharedRetry(fetchImpl, url, options, {
  delays = SHARED_PREVIEW_RETRY_DELAYS_MS,
  sleep = defaultSharedRetrySleep,
  now = Date.now,
  deadlineAt = 0,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("shared_site_fetch_required");
  const maxAttempts = delays.length + 1;
  const signalAborted = () => Boolean(options && options.signal && options.signal.aborted === true);
  let attempts = 0;
  let response = null;
  let lastError = "";
  for (;;) {
    attempts += 1;
    response = null;
    lastError = "";
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      lastError = String(error && error.message || error);
    }
    if (response && !isSharedRetryableStatus(response.status)) {
      return { response, attempts };
    }
    if (attempts >= maxAttempts || signalAborted()) break;
    const delay = sharedRetryDelayMs(delays, attempts);
    const deadline = Number(deadlineAt);
    if (!delay || (Number.isFinite(deadline) && deadline > 0 && Number(now()) + delay >= deadline)) break;
    await sleep(delay);
  }
  return {
    attempts,
    ...(response ? { response } : { error: lastError }),
  };
}

function failure(reason, detail) {
  return {
    ok: false,
    fallback: false,
    reason,
    ...(detail ? { detail } : {}),
  };
}

function exactString(value) {
  return typeof value === "string" && value === value.trim() ? value : "";
}

function exactUuid(value) {
  const text = exactString(value);
  return UUID_RE.test(text) ? text : "";
}

function exactSha(value) {
  const text = exactString(value);
  return SHA256_RE.test(text) ? text : "";
}

function exactGeneration(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return -1;
}

function exactOperationKey(value) {
  const text = exactString(value);
  const bytes = Buffer.byteLength(text, "utf8");
  return bytes > 0 && bytes <= MAX_OPERATION_KEY_BYTES && !/[\x00-\x1f\x7f]/.test(text)
    ? text
    : "";
}

function exactHost(value) {
  const text = exactString(value);
  return text.length <= 253
    && HOST_RE.test(text)
    && text.split(".").every((label) => label.length <= 63)
    ? text
    : "";
}

function optionalReleaseBinding(input, prepared) {
  const hasParent = input.parentReleaseId !== undefined || input.expectedGeneration !== undefined;
  const hasHero = input.heroVideoPath !== undefined || input.heroVideoSha256 !== undefined;
  let parentReleaseId = "";
  let expectedGeneration = -1;
  let heroVideoPath = "";
  let heroVideoSha256 = "";

  if (hasParent) {
    parentReleaseId = exactUuid(input.parentReleaseId);
    expectedGeneration = exactGeneration(input.expectedGeneration);
    if (!parentReleaseId || expectedGeneration < 1) throw new Error("shared_release_parent_binding_invalid");
  }
  if (hasHero) {
    heroVideoPath = canonicalFilePath(input.heroVideoPath);
    heroVideoSha256 = exactSha(input.heroVideoSha256);
    const file = heroVideoPath && prepared && prepared.preparedFiles.get(heroVideoPath);
    if (!heroVideoPath || heroVideoPath !== input.heroVideoPath || !heroVideoSha256
      || !file || file.sha256 !== heroVideoSha256) {
      throw new Error("shared_release_hero_binding_invalid");
    }
  }
  return Object.freeze({
    hasParent,
    hasHero,
    parentReleaseId,
    expectedGeneration,
    heroVideoPath,
    heroVideoSha256,
  });
}

function hash(value) {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

// A deterministic custom UUID makes operation-key retries converge on one
// immutable object prefix without adding a second idempotency table. UUIDv8 is
// reserved for application-defined layouts; the remaining RFC variant bits
// are retained.
function deterministicReleaseUuid({ siteId, operationKey, buildHash } = {}) {
  const site = exactUuid(siteId);
  const operation = exactOperationKey(operationKey);
  const build = exactSha(buildHash);
  if (!site || !operation || !build) return "";
  const bytes = Buffer.from(hash(Buffer.concat([
    Buffer.from("wss-shared-release-v1\0", "utf8"),
    Buffer.from(site, "utf8"),
    Buffer.from("\0", "utf8"),
    Buffer.from(operation, "utf8"),
    Buffer.from("\0", "utf8"),
    Buffer.from(build, "utf8"),
  ])).subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function unwrapRpc(result) {
  if (result && result.error) {
    return failure("shared_registry_rpc_failed", {
      reason: String(result.error.code || result.error.message || "rpc_failed"),
    });
  }
  const data = result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  const value = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : failure("shared_registry_rpc_invalid_response");
}

function createSharedSiteRegistryAdapter({ rpc } = {}) {
  if (typeof rpc !== "function") throw new TypeError("shared_site_registry_rpc_required");
  const call = async (name, args, signal) => unwrapRpc(await rpc(name, args, { signal }));
  return Object.freeze({
    ensureSiteIdentity({ slug, host, signal }) {
      return call("ensure_shared_site_identity", {
        p_canonical_slug: slug,
        p_normalized_host: host,
      }, signal);
    },
    readSiteGeneration({ siteId, slug, host, signal }) {
      return call("read_shared_site_generation", {
        p_site_id: siteId,
        p_canonical_slug: slug,
        p_normalized_host: host,
      }, signal);
    },
    insertStagedRelease(row) {
      return call("stage_site_release", {
        p_site_id: row.siteId,
        p_release_id: row.releaseId,
        p_build_hash: row.buildHash,
        p_manifest_path: row.manifestPath,
        p_manifest_sha256: row.manifestSha256,
        p_canonical_host: row.canonicalHost,
        p_published_generation: row.routeGeneration,
        p_deployment_env: row.environment,
      }, row.signal);
    },
    markReleaseVerified(row) {
      return call("verify_site_release", {
        p_site_id: row.siteId,
        p_release_id: row.releaseId,
        p_build_hash: row.buildHash,
        p_manifest_path: row.manifestPath,
        p_manifest_sha256: row.manifestSha256,
        p_canonical_host: row.canonicalHost,
        p_published_generation: row.routeGeneration,
        p_deployment_env: row.environment,
      }, row.signal);
    },
    activateReleaseCas(row) {
      return call("activate_site_release", {
        p_site_id: row.siteId,
        p_expected_generation: row.expectedGeneration,
        p_release_id: row.releaseId,
        p_deployment_env: row.environment,
      }, row.signal);
    },
    rollbackReleaseCas(row) {
      return call("rollback_site_release", {
        p_site_id: row.siteId,
        p_expected_generation: row.expectedGeneration,
        p_release_id: row.releaseId,
        p_deployment_env: row.environment,
      }, row.signal);
    },
    quarantineReleaseCas(row) {
      return call("quarantine_site_release", {
        p_site_id: row.siteId,
        p_expected_generation: row.expectedGeneration,
        p_failed_release_id: row.releaseId,
        p_deployment_env: row.environment,
      }, row.signal);
    },
    registerPreviewGrant(row) {
      return call("register_site_preview_grant", {
        p_jti_hash: row.jtiHash,
        p_site_id: row.siteId,
        p_release_id: row.releaseId,
        p_build_hash: row.buildHash,
        p_deployment_env: row.environment,
        p_expires_at: row.expiresAt,
      }, row.signal);
    },
  });
}

async function bodyBuffer(value, context = {}) {
  return guarded({ now: Date.now, ...context }, () => {
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (value && typeof value.arrayBuffer === "function") {
      return Promise.resolve().then(() => value.arrayBuffer()).then((bytes) => Buffer.from(bytes));
    }
    throw new TypeError("shared_storage_body_missing");
  });
}

function storageError(error) {
  return String(error && (error.error || error.code || error.message || error.statusCode || error.status) || "storage_failed");
}

function duplicateStorageError(error) {
  const status = Number(error && (error.statusCode || error.status));
  const text = storageError(error).toLowerCase();
  return status === 409 || text.includes("duplicate") || text.includes("already exists");
}

/** Build the private-bucket adapter around an injected supabase-js client. */
function createSupabaseReleaseStorageAdapter({ supabase } = {}) {
  if (!supabase || typeof supabase.storage?.from !== "function") {
    throw new TypeError("shared_site_supabase_storage_required");
  }
  return Object.freeze({
    async readObject({ bucket, key, signal }) {
      const client = supabase.storage.from(bucket);
      if (typeof client.exists !== "function" || typeof client.download !== "function") {
        throw new TypeError("shared_site_supabase_storage_methods_missing");
      }
      const exists = await client.exists(key);
      if (exists && exists.error) throw new Error(`shared_storage_exists_failed:${storageError(exists.error)}`);
      if (!exists || exists.data !== true) return { ok: true, found: false };
      const downloaded = await client.download(key, {}, signal ? { signal, cache: "no-store" } : { cache: "no-store" });
      if (downloaded && downloaded.error) throw new Error(`shared_storage_download_failed:${storageError(downloaded.error)}`);
      return { ok: true, found: true, body: await bodyBuffer(downloaded && downloaded.data, { signal }) };
    },
    async putObjectIfAbsent({ bucket, key, body, contentType, insertOnly }) {
      if (insertOnly !== true) throw new Error("shared_storage_insert_only_required");
      const client = supabase.storage.from(bucket);
      if (typeof client.upload !== "function") throw new TypeError("shared_site_supabase_upload_missing");
      const uploaded = await client.upload(key, Buffer.from(body), {
        cacheControl: "31536000",
        contentType,
        upsert: false,
      });
      if (uploaded && uploaded.error) {
        if (duplicateStorageError(uploaded.error)) return { ok: false, exists: true, reason: "object_exists" };
        throw new Error(`shared_storage_upload_failed:${storageError(uploaded.error)}`);
      }
      return { ok: true, inserted: true };
    },
  });
}

function supabaseRestConfig(env) {
  const rawUrl = exactString(env && env.SUPABASE_URL);
  const key = exactString(env && env.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawUrl || !key || Buffer.byteLength(key, "utf8") < 16) {
    throw new TypeError("shared_site_supabase_configuration_required");
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    throw new TypeError("shared_site_supabase_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")) {
    throw new TypeError("shared_site_supabase_url_invalid");
  }
  return { baseUrl: url.origin, key };
}

function serviceHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function encodedPath(value) {
  return String(value).split("/").map((part) => encodeURIComponent(part)).join("/");
}

/** Production RPC adapter for this dependency-free backend. */
function createSupabaseRestRpc({ env = process.env, fetchImpl = global.fetch } = {}) {
  const config = supabaseRestConfig(env);
  if (typeof fetchImpl !== "function") throw new TypeError("shared_site_fetch_required");
  return async function rpc(name, args, { signal } = {}) {
    const response = await fetchImpl(`${config.baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: serviceHeaders(config.key, {
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(args),
      signal,
    });
    if (!response || response.ok !== true) {
      return {
        data: null,
        error: {
          status: Number(response && response.status) || 503,
          message: `rpc_${Number(response && response.status) || 503}`,
        },
      };
    }
    try {
      return { data: await response.json(), error: null };
    } catch (_) {
      return { data: null, error: { status: 502, message: "rpc_invalid_json" } };
    }
  };
}

/** Production private Storage adapter over Supabase's REST surface. */
function createSupabaseRestReleaseStorageAdapter({ env = process.env, fetchImpl = global.fetch } = {}) {
  const config = supabaseRestConfig(env);
  if (typeof fetchImpl !== "function") throw new TypeError("shared_site_fetch_required");
  return Object.freeze({
    async readObject({ bucket, key, signal }) {
      const response = await fetchImpl(
        `${config.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath(key)}`,
        {
          method: "GET",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: serviceHeaders(config.key, { Accept: "application/octet-stream" }),
        },
      );
      if (response && response.status === 404) return { ok: true, found: false };
      if (!response || response.ok !== true) {
        throw new Error(`shared_storage_download_failed:${Number(response && response.status) || 503}`);
      }
      return { ok: true, found: true, body: await bodyBuffer(response, { signal }) };
    },
    async putObjectIfAbsent({ bucket, key, body, contentType, insertOnly, signal }) {
      if (insertOnly !== true) throw new Error("shared_storage_insert_only_required");
      const response = await fetchImpl(
        `${config.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath(key)}`,
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: serviceHeaders(config.key, {
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Type": contentType,
            "x-upsert": "false",
          }),
          body: Buffer.from(body),
        },
      );
      if (response && (response.status === 409 || response.status === 400)) {
        return { ok: false, exists: true, reason: "object_exists" };
      }
      if (!response || response.ok !== true) {
        throw new Error(`shared_storage_upload_failed:${Number(response && response.status) || 503}`);
      }
      return { ok: true, inserted: true };
    },
  });
}

function responseHeader(response, name) {
  if (!response || !response.headers) return "";
  if (typeof response.headers.get === "function") return String(response.headers.get(name) || "").trim();
  for (const [key, value] of Object.entries(response.headers)) {
    if (String(key).toLowerCase() === name) return String(value || "").trim();
  }
  return "";
}

function boundedSignal({ signal, deadlineAt, now = Date.now } = {}) {
  const controller = new AbortController();
  let timer = null;
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  const deadline = Number(deadlineAt);
  if (Number.isFinite(deadline) && deadline > 0) {
    const remaining = Math.max(0, deadline - Number(now()));
    if (remaining === 0) controller.abort();
    else timer = setTimeout(abort, Math.min(remaining, 2_147_483_647));
  }
  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (signal && !signal.aborted) signal.removeEventListener("abort", abort);
    },
  };
}

/** Verify the just-activated immutable bytes through the public router.
 *  Each route fetch polls through the fresh-host confirmation budget before
 *  the release is declared unconfirmed, so a provisioning-race 502 cannot
 *  roll back (or fail to confirm) a correctly activated release. */
function createPublicReleaseVerifier({ fetchImpl = global.fetch, now = Date.now, sleep = defaultSharedRetrySleep } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("shared_site_public_fetch_required");
  if (typeof now !== "function") throw new TypeError("shared_site_public_clock_required");
  if (typeof sleep !== "function") throw new TypeError("shared_site_public_sleep_required");
  return async function verifyPublicRelease({
    previewUrl,
    siteId,
    releaseId,
    buildHash,
    generation,
    manifest,
    preparedFiles,
    signal,
    deadlineAt,
  } = {}) {
    if (typeof previewUrl !== "string" || previewUrl !== `https://${manifest && manifest.canonical_host}/`
      || !exactUuid(siteId) || !exactUuid(releaseId) || !exactSha(buildHash)
      || exactGeneration(generation) < 1 || !manifest || !(preparedFiles instanceof Map)
      || manifest.schema !== MANIFEST_SCHEMA || manifest.site_id !== siteId
      || manifest.release_id !== releaseId || manifest.build_hash !== buildHash
      || manifest.route_generation !== generation) {
      return failure("shared_public_verification_input_invalid");
    }
    const expectedHeaders = {
      "x-wss-site-id": siteId,
      "x-wss-release-id": releaseId,
      "x-wss-build-hash": buildHash,
      "x-wss-route-generation": String(generation),
    };
    const routes = [["/", manifest.routes && manifest.routes["/"]]];
    const asset = Object.entries(manifest.routes || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .find(([route, target]) => route !== "/" && target !== routes[0][1] && preparedFiles.has(target));
    if (asset) routes.push(asset);

    for (const [route, target] of routes) {
      const file = preparedFiles.get(target);
      if (!file || !Buffer.isBuffer(file.body)) return failure("shared_public_route_target_missing", { route });
      const requestUrl = new URL(route.slice(1), previewUrl).toString();
      let outcome;
      try {
        outcome = await guarded({ signal, deadlineAt, now }, (operationSignal) => fetchWithSharedRetry(
          fetchImpl,
          requestUrl,
          {
            method: "GET",
            redirect: "error",
            cache: "no-store",
            signal: operationSignal,
            headers: { Accept: file.contentType || "*/*" },
          },
          {
            delays: SHARED_RELEASE_CONFIRM_RETRY_DELAYS_MS,
            sleep,
            now,
            deadlineAt,
          },
        ));
      } catch (error) {
        return failure("shared_public_fetch_failed", {
          route,
          host: manifest.canonical_host,
          error: String(error && error.name === "AbortError" ? "aborted" : error && error.message || error),
        });
      }
      const response = outcome.response;
      if (!response) {
        return failure("shared_public_fetch_failed", {
          route,
          host: manifest.canonical_host,
          attempts: outcome.attempts,
          error: String(outcome.error || "shared_public_fetch_failed"),
        });
      }
      if (response.ok !== true || Number(response.status) !== 200) {
        return failure("shared_public_status_mismatch", {
          route,
          host: manifest.canonical_host,
          status: Number(response.status) || 0,
          attempts: outcome.attempts,
        });
      }
      if (response.url && response.url !== requestUrl) return failure("shared_public_url_mismatch", { route });
      for (const [name, expected] of Object.entries(expectedHeaders)) {
        if (responseHeader(response, name) !== expected) {
          return failure("shared_public_identity_header_mismatch", { route, header: name });
        }
      }
      let body;
      try {
        body = await bodyBuffer(response, { signal, deadlineAt, now });
      } catch (error) {
        return failure("shared_public_body_unreadable", {
          route,
          error: String(error && error.message || error),
        });
      }
      if (body.length !== file.size || sha256Hex(body) !== file.sha256) {
        return failure("shared_public_body_mismatch", { route });
      }
    }
    return { ok: true, fallback: false, routes: routes.map(([route]) => route) };
  };
}

function identityRow(value, expected) {
  if (!value || value.ok !== true) {
    return failure("shared_site_identity_refused", {
      reason: String(value && value.reason || "registry_refused"),
    });
  }
  const siteId = exactUuid(value.siteId ?? value.site_id);
  const slug = exactString(value.slug ?? value.canonicalSlug ?? value.canonical_slug);
  const host = exactHost(value.host ?? value.canonicalHost ?? value.canonical_host ?? value.normalized_host);
  const generation = exactGeneration(value.generation);
  if (!siteId || slug !== expected.slug || host !== expected.host || generation < 0) {
    return failure("shared_site_identity_mismatch");
  }

  const activeReleaseId = value.activeReleaseId ?? value.active_release_id ?? null;
  const activeBuildHash = value.activeBuildHash ?? value.active_build_hash ?? null;
  const activeManifestPath = value.activeManifestPath ?? value.active_manifest_path ?? null;
  const activeManifestSha256 = value.activeManifestSha256 ?? value.active_manifest_sha256 ?? null;
  const activePublishedGeneration = value.activePublishedGeneration ?? value.active_published_generation ?? null;
  const activeRouteGeneration = exactGeneration(activePublishedGeneration);
  const activeEnvironment = value.activeEnvironment ?? value.active_deployment_env ?? null;
  const activeValues = [
    activeReleaseId,
    activeBuildHash,
    activeManifestPath,
    activeManifestSha256,
    activePublishedGeneration,
    activeEnvironment,
  ];
  if (activeValues.some((item) => item != null && item !== "") && activeValues.some((item) => item == null || item === "")) {
    return failure("shared_site_active_identity_incomplete");
  }
  if (activeReleaseId != null && activeReleaseId !== "") {
    if (!exactUuid(activeReleaseId) || !exactSha(activeBuildHash) || !exactSha(activeManifestSha256)
      || exactString(activeManifestPath) !== activeManifestPath || exactString(activeEnvironment) !== activeEnvironment
      || activeRouteGeneration < 1 || activeRouteGeneration > generation || generation < 1) {
      return failure("shared_site_active_identity_malformed");
    }
  }
  return {
    ok: true,
    siteId,
    slug,
    host,
    generation,
    activeReleaseId: activeReleaseId || "",
    activeBuildHash: activeBuildHash || "",
    activeManifestPath: activeManifestPath || "",
    activeManifestSha256: activeManifestSha256 || "",
    activePublishedGeneration: activeReleaseId ? activeRouteGeneration : 0,
    activeEnvironment: activeEnvironment || "",
  };
}

function interrupted({ signal, deadlineAt, now }) {
  if (signal && signal.aborted) return "shared_publish_aborted";
  const deadline = Number(deadlineAt);
  if (Number.isFinite(deadline) && deadline > 0 && Number(now()) >= deadline) return "shared_publish_deadline_exceeded";
  return "";
}

async function guarded(context, operation) {
  const before = interrupted(context);
  if (before) throw new Error(before);
  const bounded = boundedSignal(context);
  let onAbort;
  const stopped = new Promise((_, reject) => {
    onAbort = () => reject(new Error(context.signal && context.signal.aborted
      ? "shared_publish_aborted"
      : "shared_publish_deadline_exceeded"));
    if (bounded.signal.aborted) onAbort();
    else bounded.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => operation(bounded.signal)),
      stopped,
    ]);
    const after = interrupted(context);
    if (after) throw new Error(after);
    return result;
  } finally {
    bounded.signal.removeEventListener("abort", onAbort);
    bounded.cleanup();
  }
}

function releaseReceipt({
  siteId,
  releaseId,
  buildHash,
  host,
  environment,
  generation,
  manifestPath,
  manifestSha256,
  fileCount,
  replay,
  binding,
}) {
  const proofIdentity = Object.freeze({
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
  });
  const releaseEvidence = Object.freeze({
    evidence_schema: SHARED_RELEASE_EVIDENCE_SCHEMA,
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
    canonical_host: host,
    manifest_path: manifestPath,
    manifest_sha256: manifestSha256,
    deployment_env: environment,
    generation,
    route_generation: generation,
    state: "active",
    file_count: fileCount,
    ...(binding && binding.hasHero ? {
      hero_video_path: binding.heroVideoPath,
      hero_video_sha256: binding.heroVideoSha256,
    } : {}),
  });
  const previewUrl = `https://${host}/`;
  return {
    ok: true,
    fallback: false,
    state: "active",
    idempotentReplay: replay === true,
    previewUrl,
    preview_url: previewUrl,
    siteId,
    releaseId,
    buildHash,
    build_hash: buildHash,
    generation,
    proofIdentity,
    releaseEvidence,
    release_evidence: releaseEvidence,
  };
}

function activeReceiptIfExact({ identity, prepared, buildHash, host, environment, fileCount, binding }) {
  if (!identity.activeReleaseId) return null;
  if (identity.activeReleaseId !== prepared.releaseId) return null;
  if (identity.activeBuildHash !== buildHash
    || identity.activeManifestPath !== prepared.manifestKey
    || identity.activeManifestSha256 !== prepared.manifestSha256
    || identity.activeEnvironment !== environment) {
    return failure("shared_site_active_release_identity_mismatch");
  }
  return releaseReceipt({
    siteId: identity.siteId,
    releaseId: prepared.releaseId,
    buildHash,
    host,
    environment,
    generation: identity.activePublishedGeneration,
    manifestPath: prepared.manifestKey,
    manifestSha256: prepared.manifestSha256,
    fileCount,
    replay: true,
    binding,
  });
}

function normalizeStorageRead(value) {
  if (value && value.found === false) return { found: false };
  if (value == null) return { found: false };
  const body = value && Object.prototype.hasOwnProperty.call(value, "body") ? value.body : value;
  return { found: true, body };
}

const PREVIEW_COOKIE_NAME = "__Host-wss-site-preview";
const PREVIEW_COOKIE_RE = /^__Host-wss-site-preview=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+); Max-Age=300; Path=\/; HttpOnly; Secure; SameSite=Strict$/;

function setCookieValues(response) {
  if (!response || !response.headers) return [];
  if (typeof response.headers.getSetCookie === "function") {
    const values = response.headers.getSetCookie();
    return Array.isArray(values) ? values : [];
  }
  if (typeof response.headers.get === "function") {
    const value = response.headers.get("set-cookie");
    return value ? [String(value)] : [];
  }
  const values = [];
  for (const [key, value] of Object.entries(response.headers)) {
    if (String(key).toLowerCase() === "set-cookie") {
      if (Array.isArray(value)) values.push(...value.map(String));
      else if (value) values.push(String(value));
    }
  }
  return values;
}

function previewCookieFrom(response) {
  const values = setCookieValues(response);
  if (values.length !== 1) return "";
  const match = PREVIEW_COOKIE_RE.exec(values[0]);
  return match ? match[1] : "";
}

function exactPreviewUrl(value, origin) {
  let url;
  try {
    url = new URL(value, `${origin}/`);
  } catch (_) {
    return null;
  }
  if (url.origin !== origin || url.username || url.password || url.hash) return null;
  return url;
}

function createSharedSitePublisher({
  registry,
  storage,
  publicVerifier,
  ensureSharedSiteHost,
  previewFetch = global.fetch,
  env = process.env,
  now = Date.now,
  releaseIdFor = deterministicReleaseUuid,
  sleep = defaultSharedRetrySleep,
} = {}) {
  if (!registry || [
    "ensureSiteIdentity",
    "readSiteGeneration",
    "insertStagedRelease",
    "markReleaseVerified",
    "activateReleaseCas",
    "rollbackReleaseCas",
    "quarantineReleaseCas",
    "registerPreviewGrant",
  ].some((name) => typeof registry[name] !== "function")) {
    throw new TypeError("shared_site_registry_adapter_required");
  }
  if (!storage || typeof storage.readObject !== "function" || typeof storage.putObjectIfAbsent !== "function") {
    throw new TypeError("shared_site_storage_adapter_required");
  }
  if (typeof publicVerifier !== "function") throw new TypeError("shared_site_public_verifier_required");
  if (typeof ensureSharedSiteHost !== "function") throw new TypeError("shared_site_host_provisioner_required");
  if (typeof previewFetch !== "function" || typeof now !== "function" || typeof releaseIdFor !== "function") {
    throw new TypeError("shared_site_publisher_dependency_invalid");
  }
  if (typeof sleep !== "function") throw new TypeError("shared_site_publisher_sleep_invalid");

  // LOCAL PREVIEW SEAM: under WSS_SHARED_SITE_ENV=local the host gate accepts
  // the recorded local skip receipt and every preview fetch resolves against
  // the local site-router gateway. Any other environment keeps the exact
  // production identity checks and canonical host.
  const localPreviewSeam = isLocalSharedSiteEnvironment(env);

  const stageContexts = new WeakMap();

  function postActivationContexts(context) {
    const startedAt = Number(now());
    const suppliedDeadline = Number(context.deadlineAt);
    const overallDeadline = Number.isFinite(suppliedDeadline) && suppliedDeadline > 0
      ? suppliedDeadline
      : startedAt + POST_ACTIVATION_SAFETY_TIMEOUT_MS;
    const remaining = Math.max(0, overallDeadline - startedAt);
    const reserve = Math.min(ROLLBACK_COMPENSATION_RESERVE_MS, Math.floor(remaining / 2));
    return {
      verification: {
        signal: context.signal,
        deadlineAt: overallDeadline - reserve,
        now,
      },
      // Once activation may have mutated durable state, caller cancellation
      // cannot cancel compensation. The original overall route deadline still
      // bounds rollback and its exact-state readback proof.
      compensation: {
        deadlineAt: overallDeadline,
        now,
      },
    };
  }

  async function ensureHostReady(privateContext, context, input = {}) {
    const receipt = await guarded(context, (operationSignal) => ensureSharedSiteHost({
      host: privateContext.host,
      signal: operationSignal,
      deadlineAt: input.deadlineAt,
    }));
    if (!receipt || receipt.ok !== true || receipt.host !== privateContext.host
        || (localPreviewSeam
          ? receipt.domainAttach !== LOCAL_DOMAIN_ATTACH
          : receipt.projectId !== ROUTER_PROJECT_ID)) {
      throw new Error("shared_site_host_identity_mismatch");
    }
    return receipt;
  }

  async function hostProvisionFailure(privateContext, context, input) {
    try {
      await ensureHostReady(privateContext, context, input);
      return null;
    } catch (error) {
      const reason = String(error && error.message || error);
      if (reason === "shared_publish_aborted" || reason === "shared_publish_deadline_exceeded") {
        return failure(reason);
      }
      return failure("shared_release_host_provision_failed", { reason });
    }
  }

  async function publiclyVerifyReceipt(receipt, prepared, context, input) {
    const verified = await guarded(context, (operationSignal) => publicVerifier({
      previewUrl: receipt.previewUrl,
      siteId: receipt.siteId,
      releaseId: receipt.releaseId,
      buildHash: receipt.buildHash,
      generation: receipt.generation,
      manifestPath: receipt.releaseEvidence.manifest_path,
      manifestSha256: receipt.releaseEvidence.manifest_sha256,
      manifest: prepared.manifest,
      preparedFiles: prepared.preparedFiles,
      signal: operationSignal,
      deadlineAt: context.deadlineAt,
    }));
    if (!verified || verified.ok !== true) {
      return failure("shared_release_public_verification_failed", {
        reason: String(verified && verified.reason || "public_verifier_refused"),
        ...(verified && verified.detail ? { publicDetail: verified.detail } : {}),
      });
    }
    return receipt;
  }

  function publicFailureWithRollback(publicFailure, rollback, reconciliationRequired = false) {
    return {
      ...publicFailure,
      ...(reconciliationRequired ? { reconciliationRequired: true } : {}),
      detail: {
        ...(publicFailure && publicFailure.detail ? publicFailure.detail : {}),
        rollback,
      },
    };
  }

  async function quarantineActivationWithoutPrior({ privateContext, receipt, publicFailure, context }) {
    let quarantined;
    try {
      quarantined = await guarded(context, (operationSignal) => quarantineSharedSiteRelease({
        siteId: privateContext.siteId,
        releaseId: receipt.releaseId,
        slug: privateContext.slug,
        expectedGeneration: receipt.generation,
        environment: privateContext.environment,
        env,
        io: {
          quarantineReleaseCas(row) {
            return registry.quarantineReleaseCas({ ...row, signal: operationSignal });
          },
        },
      }));
    } catch (error) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        action: "quarantine",
        reason: String(error && error.message || error),
      }, true);
    }
    if (!quarantined || quarantined.ok !== true
      || quarantined.state !== "quarantined"
      || quarantined.siteId !== privateContext.siteId
      || quarantined.releaseId !== receipt.releaseId
      || quarantined.generation !== receipt.generation + 1) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        action: "quarantine",
        reason: String(quarantined && quarantined.reason || "shared_release_quarantine_refused"),
        ...(quarantined && quarantined.detail ? { detail: quarantined.detail } : {}),
      }, true);
    }

    let inactive;
    try {
      const inactiveRaw = await guarded(context, (operationSignal) => registry.readSiteGeneration({
        siteId: privateContext.siteId,
        slug: privateContext.slug,
        host: privateContext.host,
        signal: operationSignal,
      }));
      inactive = identityRow(inactiveRaw, { slug: privateContext.slug, host: privateContext.host });
    } catch (error) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        action: "quarantine",
        reason: String(error && error.message || error),
      }, true);
    }
    if (!inactive.ok
      || inactive.siteId !== privateContext.siteId
      || inactive.generation !== quarantined.generation
      || inactive.activeReleaseId || inactive.activeBuildHash
      || inactive.activeManifestPath || inactive.activeManifestSha256
      || inactive.activeEnvironment) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        action: "quarantine",
        reason: "shared_release_quarantine_state_mismatch",
      }, true);
    }
    return publicFailureWithRollback(publicFailure, {
      ok: true,
      action: "quarantine",
      releaseId: receipt.releaseId,
      generation: quarantined.generation,
    });
  }

  async function rollbackAfterPublicFailure({
    privateContext,
    receipt,
    publicFailure,
    context,
    activationOwned,
  }) {
    if (activationOwned !== true) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        reason: "shared_release_activation_not_owned",
      }, true);
    }
    const previous = privateContext.previousActive;
    if (!previous || !previous.activeReleaseId) {
      return quarantineActivationWithoutPrior({ privateContext, receipt, publicFailure, context });
    }
    if (previous.generation !== privateContext.currentGeneration
      || previous.activeEnvironment !== privateContext.environment) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        reason: "shared_release_previous_active_identity_mismatch",
      }, true);
    }

    let rolledBack;
    try {
      rolledBack = await guarded(context, (operationSignal) => rollbackSharedSiteRelease({
        siteId: privateContext.siteId,
        releaseId: previous.activeReleaseId,
        slug: privateContext.slug,
        expectedGeneration: receipt.generation,
        environment: previous.activeEnvironment,
        env,
        io: {
          rollbackReleaseCas(row) {
            return registry.rollbackReleaseCas({ ...row, signal: operationSignal });
          },
        },
      }));
    } catch (error) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        reason: String(error && error.message || error),
      }, true);
    }
    if (!rolledBack || rolledBack.ok !== true
      || rolledBack.siteId !== privateContext.siteId
      || rolledBack.releaseId !== previous.activeReleaseId
      || rolledBack.generation !== receipt.generation + 1) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        reason: String(rolledBack && rolledBack.reason || "shared_release_rollback_refused"),
        ...(rolledBack && rolledBack.detail ? { detail: rolledBack.detail } : {}),
      }, true);
    }

    let restored;
    try {
      const restoredRaw = await guarded(context, (operationSignal) => registry.readSiteGeneration({
        siteId: privateContext.siteId,
        slug: privateContext.slug,
        host: privateContext.host,
        signal: operationSignal,
      }));
      restored = identityRow(restoredRaw, { slug: privateContext.slug, host: privateContext.host });
    } catch (error) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        reason: String(error && error.message || error),
      }, true);
    }
    if (!restored.ok
      || restored.siteId !== privateContext.siteId
      || restored.generation !== rolledBack.generation
      || restored.activeReleaseId !== previous.activeReleaseId
      || restored.activeBuildHash !== previous.activeBuildHash
      || restored.activeManifestPath !== previous.activeManifestPath
      || restored.activeManifestSha256 !== previous.activeManifestSha256
      || restored.activePublishedGeneration !== previous.activePublishedGeneration
      || restored.activeEnvironment !== previous.activeEnvironment) {
      return publicFailureWithRollback(publicFailure, {
        ok: false,
        reason: "shared_release_rollback_state_mismatch",
      }, true);
    }
    return publicFailureWithRollback(publicFailure, {
      ok: true,
      releaseId: previous.activeReleaseId,
      generation: rolledBack.generation,
      routeGeneration: previous.activePublishedGeneration,
    });
  }

  async function ambiguousActivationFailure(privateContext, compensation, error) {
    const reason = String(error && error.message || error);
    let observed = "unreadable";
    try {
      const afterRaw = await guarded(compensation, (operationSignal) => registry.readSiteGeneration({
        siteId: privateContext.siteId,
        slug: privateContext.slug,
        host: privateContext.host,
        signal: operationSignal,
      }));
      const after = identityRow(afterRaw, { slug: privateContext.slug, host: privateContext.host });
      if (after.ok) {
        const previous = privateContext.previousActive;
        if (after.generation === privateContext.currentGeneration + 1
          && after.activeReleaseId === privateContext.releaseId
          && after.activeBuildHash === privateContext.buildHash
          && after.activeManifestPath === privateContext.verified.manifestPath
          && after.activeManifestSha256 === privateContext.verified.manifestSha256
          && after.activePublishedGeneration === privateContext.currentGeneration + 1
          && after.activeEnvironment === privateContext.environment) {
          observed = "requested_release_active";
        } else if (previous
          && after.generation === previous.generation
          && after.activeReleaseId === previous.activeReleaseId
          && after.activeBuildHash === previous.activeBuildHash
          && after.activeManifestPath === previous.activeManifestPath
          && after.activeManifestSha256 === previous.activeManifestSha256
          && after.activePublishedGeneration === previous.activePublishedGeneration
          && after.activeEnvironment === previous.activeEnvironment) {
          observed = "prior_state_unchanged";
        } else {
          observed = "different_active_state";
        }
      }
    } catch (_) {
      observed = "unreadable";
    }
    const base = reason === "shared_publish_aborted" || reason === "shared_publish_deadline_exceeded"
      ? failure(reason)
      : failure("shared_site_activation_failed", { error: reason });
    return {
      ...base,
      reconciliationRequired: true,
      detail: {
        ...(base.detail || {}),
        activation: { outcome: observed },
      },
    };
  }

  function openPreviewFor(privateContext) {
    return async function openPreview(input = {}) {
      const context = { signal: input.signal, deadlineAt: input.deadlineAt, now };
      const stop = interrupted(context);
      if (stop) throw new Error(stop);
      try {
        await ensureHostReady(privateContext, context, input);
      } catch (error) {
        const reason = String(error && error.message || error);
        if (/^shared_(?:publish|site_host)_[a-z_]+$/.test(reason)) throw error;
        throw new Error("shared_site_host_provision_failed");
      }
      let grant;
      try {
        grant = await mintPreviewGrant({
          siteId: privateContext.siteId,
          releaseId: privateContext.releaseId,
          buildHash: privateContext.buildHash,
          slug: privateContext.slug,
          environment: privateContext.environment,
          env,
          now: now(),
          io: {
            registerPreviewGrant(row) {
              return guarded(context, (operationSignal) => registry.registerPreviewGrant({
                ...row,
                signal: operationSignal,
              }));
            },
          },
        });
      } catch (_) {
        throw new Error("shared_preview_grant_failed");
      }
      if (!grant || grant.ok !== true || typeof grant.token !== "string") {
        throw new Error("shared_preview_grant_refused");
      }

      // LOCAL PREVIEW SEAM: under WSS_SHARED_SITE_ENV=local the grant was
      // minted and registered in the local registry with the local secret, so
      // the exchange (and every cookie-bound preview fetch below) must hit the
      // local site-router gateway — the production wildcard host would
      // validate against the production secret and production grant registry
      // and refuse. Outside local this is exactly `https://<canonical host>`.
      const origin = localSiteGatewayOrigin(privateContext.slug, env)
        || `https://${privateContext.host}`;
      const exchangeUrl = `${origin}/api/preview-session`;
      let exchange;
      try {
        exchange = await guarded(context, (operationSignal) => fetchWithSharedRetry(
          previewFetch,
          exchangeUrl,
          {
            method: "POST",
            redirect: "error",
            cache: "no-store",
            signal: operationSignal,
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ grant: grant.token }),
          },
          { sleep, now },
        ));
      } catch (_) {
        throw new Error("shared_preview_exchange_failed");
      }
      grant = null;
      const response = exchange && exchange.response;
      if (!response || Number(response.status) !== 204 || response.ok !== true
        || (response.url && response.url !== exchangeUrl)) {
        throw new Error(`shared_preview_exchange_refused after ${exchange && exchange.attempts || 1} attempts`
          + ` (last_status=${Number(response && response.status) || 0})`);
      }
      const cookieValue = previewCookieFrom(response);
      if (!cookieValue) throw new Error("shared_preview_cookie_invalid");

      async function previewSessionFetch(value, options = {}) {
        const url = exactPreviewUrl(value, origin);
        if (!url) throw new Error("shared_preview_cross_origin_refused");
        let headers;
        try {
          headers = new Headers(options.headers || {});
        } catch (_) {
          throw new Error("shared_preview_headers_invalid");
        }
        if (headers.has("cookie") || headers.has("host")) throw new Error("shared_preview_headers_refused");
        headers.set("Cookie", `${PREVIEW_COOKIE_NAME}=${cookieValue}`);
        const outcome = await fetchWithSharedRetry(previewFetch, url.toString(), {
          ...options,
          redirect: "error",
          headers,
        }, { sleep, now });
        if (!outcome || !outcome.response) {
          throw new Error(`shared_preview_fetch_failed after ${outcome && outcome.attempts || 1} attempts`
            + (outcome && outcome.error ? ` (last_error: ${String(outcome.error).slice(0, 160)})` : ""));
        }
        const fetched = outcome.response;
        if (fetched && fetched.url && fetched.url !== url.toString()) {
          throw new Error("shared_preview_redirect_refused");
        }
        return fetched;
      }

      async function preparePage(page) {
        try {
          const pageContext = page && typeof page.context === "function" ? page.context() : null;
          if (!pageContext || typeof pageContext.addCookies !== "function") throw new Error("invalid_page");
          await pageContext.addCookies([{
            name: PREVIEW_COOKIE_NAME,
            value: cookieValue,
            url: `${origin}/`,
            httpOnly: true,
            secure: true,
            sameSite: "Strict",
          }]);
          return page;
        } catch (_) {
          throw new Error("shared_preview_page_prepare_failed");
        }
      }

      return Object.freeze({ origin, fetch: previewSessionFetch, preparePage });
    };
  }

  function stagedReceipt(privateContext, state) {
    const predictedGeneration = state === "active_exact"
      ? privateContext.activeReceipt.generation
      : privateContext.currentGeneration + 1;
    const receipt = Object.freeze({
      ok: true,
      fallback: false,
      state,
      previewUrl: `https://${privateContext.host}/`,
      siteId: privateContext.siteId,
      releaseId: privateContext.releaseId,
      buildHash: privateContext.buildHash,
      currentGeneration: privateContext.currentGeneration,
      expectedGeneration: privateContext.currentGeneration,
      predictedGeneration,
      proofIdentity: Object.freeze({
        site_id: privateContext.siteId,
        release_id: privateContext.releaseId,
        build_hash: privateContext.buildHash,
      }),
      openPreview: openPreviewFor(privateContext),
    });
    stageContexts.set(receipt, privateContext);
    return receipt;
  }

  async function stage(input = {}) {
    const slug = exactString(input.slug);
    const host = exactHost(input.host);
    const buildHash = exactSha(input.buildHash);
    const operationKey = exactOperationKey(input.operationKey);
    const environment = releaseEnvironment(undefined, env);
    const context = { signal: input.signal, deadlineAt: input.deadlineAt, now };
    if (!SLUG_RE.test(slug) || host !== `${slug}.wss-ai.com`) return failure("shared_site_host_mismatch");
    if (!buildHash) return failure("invalid_build_hash");
    if (!operationKey) return failure("invalid_operation_key");
    if (!environment) return failure("invalid_release_environment");
    if (!isSharedPublishEnabled(env)) return failure("shared_publish_disabled");
    const stop = interrupted(context);
    if (stop) return failure(stop);

    // Validate every byte/path/route and optional immutable hero binding before
    // the first registry write.
    let binding;
    try {
      const preflight = prepareRelease({
        siteId: PREFLIGHT_SITE_ID,
        releaseId: PREFLIGHT_RELEASE_ID,
        buildHash,
        slug,
        canonicalHost: host,
        expectedGeneration: 0,
        environment,
        env,
        files: input.files,
        routes: input.routeMap,
      });
      binding = optionalReleaseBinding(input, preflight);
    } catch (error) {
      return failure(String(error && error.message || error));
    }

    try {
      const ensuredRaw = await guarded(context, (operationSignal) => registry.ensureSiteIdentity({
        slug,
        host,
        operationKey,
        signal: operationSignal,
      }));
      const ensured = identityRow(ensuredRaw, { slug, host });
      if (!ensured.ok) return ensured;
      const currentRaw = await guarded(context, (operationSignal) => registry.readSiteGeneration({
        siteId: ensured.siteId,
        slug,
        host,
        signal: operationSignal,
      }));
      const current = identityRow(currentRaw, { slug, host });
      if (!current.ok) return current;
      if (current.siteId !== ensured.siteId) return failure("shared_site_identity_changed");

      const releaseId = exactUuid(releaseIdFor({
        siteId: current.siteId,
        operationKey,
        buildHash,
      }));
      if (!releaseId) return failure("invalid_release_id");

      // An already-active exact tuple is the durable operation receipt. Build
      // the original manifest with generation-1 so its SHA can be compared.
      if (current.activeReleaseId === releaseId) {
        if (current.generation < 1) return failure("shared_site_active_generation_invalid");
        const replayPrepared = prepareRelease({
          siteId: current.siteId,
          releaseId,
          buildHash,
          slug,
          canonicalHost: host,
          expectedGeneration: current.activePublishedGeneration - 1,
          environment,
          env,
          files: input.files,
          routes: input.routeMap,
        });
        const replay = activeReceiptIfExact({
          identity: current,
          prepared: replayPrepared,
          buildHash,
          host,
          environment,
          fileCount: replayPrepared.preparedFiles.size,
          binding,
        });
        if (replay && replay.ok === false) return replay;
        if (replay) {
          return stagedReceipt({
            siteId: current.siteId,
            releaseId,
            buildHash,
            slug,
            host,
            environment,
            currentGeneration: current.generation,
            prepared: replayPrepared,
            binding,
            verified: {
              manifestPath: replayPrepared.manifestKey,
              manifestSha256: replayPrepared.manifestSha256,
              fileCount: replayPrepared.preparedFiles.size,
            },
            activeReceipt: replay,
          }, "active_exact");
        }
      }

      // A child release may name the exact parent generation it was derived
      // from. Reject stale work before staging; the activation RPC repeats the
      // same generation CAS to close the race after this read.
      if (binding.hasParent && (current.generation !== binding.expectedGeneration
        || current.activeReleaseId !== binding.parentReleaseId)) {
        return failure("shared_release_parent_cas_mismatch");
      }


      const preparedCurrent = prepareRelease({
        siteId: current.siteId,
        releaseId,
        buildHash,
        slug,
        canonicalHost: host,
        expectedGeneration: current.generation,
        environment,
        env,
        files: input.files,
        routes: input.routeMap,
      });

      const io = {
        async insertStagedRelease(row) {
          return guarded(context, (operationSignal) => registry.insertStagedRelease({ ...row, signal: operationSignal }));
        },
        async markReleaseVerified(row) {
          return guarded(context, (operationSignal) => registry.markReleaseVerified({ ...row, signal: operationSignal }));
        },
        async readObject(args) {
          return guarded(context, async (operationSignal) => {
            const read = normalizeStorageRead(await storage.readObject({
              ...args,
              signal: operationSignal,
            }));
            if (!read.found) throw new Error("shared_release_object_missing_after_upload");
            return { ok: true, body: await bodyBuffer(read.body, { signal: operationSignal }) };
          });
        },
        async putObjectIfAbsent(object) {
          // Always attempt an insert-only write. A provider duplicate/race is
          // accepted only provisionally; the pure publisher immediately reads
          // every full object back and rejects any byte/SHA mismatch before
          // marking the release verified.
          const inserted = await guarded(context, (operationSignal) => storage.putObjectIfAbsent({
            ...object,
            insertOnly: true,
            signal: operationSignal,
          }));
          if (inserted && inserted.exists === true) return { ok: true, raced: true };
          return inserted;
        },
      };

      const verified = await publishSharedSiteRelease({
        siteId: current.siteId,
        releaseId,
        buildHash,
        slug,
        canonicalHost: host,
        expectedGeneration: current.generation,
        environment,
        env,
        files: input.files,
        routes: input.routeMap,
        io,
      });
      if (!verified || verified.ok !== true) {
        const nested = String(verified && verified.detail && verified.detail.error || "");
        if (nested === "shared_publish_aborted" || nested === "shared_publish_deadline_exceeded") {
          return failure(nested);
        }
        return failure(String(verified && verified.reason || "shared_release_publish_failed"), verified && verified.detail);
      }
      return stagedReceipt({
        siteId: current.siteId,
        releaseId,
        buildHash,
        slug,
        host,
        environment,
        currentGeneration: current.generation,
        previousActive: Object.freeze({
          generation: current.generation,
          activeReleaseId: current.activeReleaseId,
          activeBuildHash: current.activeBuildHash,
          activeManifestPath: current.activeManifestPath,
          activeManifestSha256: current.activeManifestSha256,
          activePublishedGeneration: current.activePublishedGeneration,
          activeEnvironment: current.activeEnvironment,
        }),
        prepared: preparedCurrent,
        verified,
        binding,
        activeReceipt: null,
      }, "staged");
    } catch (error) {
      const reason = String(error && error.message || error);
      if (reason === "shared_publish_aborted" || reason === "shared_publish_deadline_exceeded") return failure(reason);
      return failure("shared_site_publish_failed", { error: reason });
    }
  }

  async function activate(stageReceipt, input = {}) {
    const privateContext = stageContexts.get(stageReceipt);
    if (!privateContext) return failure("shared_release_stage_receipt_invalid");
    const context = { signal: input.signal, deadlineAt: input.deadlineAt, now };
    const stop = interrupted(context);
    if (stop) return failure(stop);
    try {
      const hostFailure = await hostProvisionFailure(privateContext, context, input);
      if (hostFailure) return hostFailure;
      if (privateContext.activeReceipt) {
        return publiclyVerifyReceipt(
          privateContext.activeReceipt,
          privateContext.prepared,
          context,
          input,
        );
      }
      const activationWindow = postActivationContexts(context);
      let rawActivation = null;
      let activation;
      try {
        activation = await guarded(activationWindow.verification, (operationSignal) => activateSharedSiteRelease({
          siteId: privateContext.siteId,
          releaseId: privateContext.releaseId,
          slug: privateContext.slug,
          expectedGeneration: privateContext.currentGeneration,
          environment: privateContext.environment,
          env,
          io: {
            async activateReleaseCas(row) {
              rawActivation = await registry.activateReleaseCas({ ...row, signal: operationSignal });
              return rawActivation;
            },
          },
        }));
      } catch (error) {
        return ambiguousActivationFailure(privateContext, activationWindow.compensation, error);
      }
      let receipt;
      let activationOwned = false;
      if (!activation || activation.ok !== true
        || activation.generation !== privateContext.currentGeneration + 1) {
        const afterRaw = await guarded(context, (operationSignal) => registry.readSiteGeneration({
          siteId: privateContext.siteId,
          slug: privateContext.slug,
          host: privateContext.host,
          signal: operationSignal,
        }));
        const after = identityRow(afterRaw, { slug: privateContext.slug, host: privateContext.host });
        if (after.ok) {
          const exact = activeReceiptIfExact({
            identity: after,
            prepared: privateContext.prepared,
            buildHash: privateContext.buildHash,
            host: privateContext.host,
            environment: privateContext.environment,
            fileCount: privateContext.verified.fileCount,
            binding: privateContext.binding,
          });
          if (exact && exact.ok === false) return exact;
          if (exact) receipt = exact;
        }
        if (!receipt) {
          return failure("shared_release_activation_refused", {
            reason: String(activation && (activation.detail?.reason || activation.reason) || "cas_conflict"),
          });
        }
      } else {
        activationOwned = !!rawActivation && rawActivation.ok === true && rawActivation.idempotent !== true;
        receipt = releaseReceipt({
          siteId: privateContext.siteId,
          releaseId: privateContext.releaseId,
          buildHash: privateContext.buildHash,
          host: privateContext.host,
          environment: privateContext.environment,
          generation: activation.generation,
          manifestPath: privateContext.verified.manifestPath,
          manifestSha256: privateContext.verified.manifestSha256,
          fileCount: privateContext.verified.fileCount,
          replay: false,
          binding: privateContext.binding,
        });
      }
      const postActivation = postActivationContexts(context);
      let publiclyVerified;
      try {
        publiclyVerified = await publiclyVerifyReceipt(
          receipt,
          privateContext.prepared,
          postActivation.verification,
          input,
        );
      } catch (error) {
        publiclyVerified = failure("shared_release_public_verification_failed", {
          reason: String(error && error.message || error),
        });
      }
      if (publiclyVerified && publiclyVerified.ok === true) {
        privateContext.activeReceipt = receipt;
        return publiclyVerified;
      }
      return rollbackAfterPublicFailure({
        privateContext,
        receipt,
        publicFailure: publiclyVerified || failure("shared_release_public_verification_failed", {
          reason: "public_verifier_refused",
        }),
        context: postActivation.compensation,
        activationOwned,
      });
    } catch (error) {
      const reason = String(error && error.message || error);
      if (reason === "shared_publish_aborted" || reason === "shared_publish_deadline_exceeded") return failure(reason);
      return failure("shared_site_activation_failed", { error: reason });
    }
  }

  async function publish(input = {}) {
    const staged = await stage(input);
    if (!staged || staged.ok !== true) return staged;
    return activate(staged, { signal: input.signal, deadlineAt: input.deadlineAt });
  }

  async function loadActiveRelease(input = {}) {
    const context = { signal: input.signal, deadlineAt: input.deadlineAt, now };
    const proof = input.proofIdentity;
    const evidence = input.releaseEvidence;
    if (!proof || typeof proof !== "object" || Array.isArray(proof)
      || !evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      return failure("shared_release_load_identity_missing");
    }
    const siteId = exactUuid(proof.site_id);
    const releaseId = exactUuid(proof.release_id);
    const buildHash = exactSha(proof.build_hash);
    const host = exactHost(evidence.canonical_host);
    const manifestPath = exactString(evidence.manifest_path);
    const manifestSha256 = exactSha(evidence.manifest_sha256);
    const environment = releaseEnvironment(undefined, env);
    const generation = exactGeneration(evidence.generation);
    const slug = host.endsWith(".wss-ai.com") ? host.slice(0, -".wss-ai.com".length) : "";
    const expectedManifestPath = siteId && releaseId
      ? `sites/${siteId}/releases/${releaseId}/manifest.json`
      : "";
    const proofKeys = ["build_hash", "release_id", "site_id"];
    const evidenceKeys = [
      "build_hash", "canonical_host", "deployment_env", "evidence_schema",
      "file_count", "generation", "manifest_path", "manifest_sha256",
      "release_id", "route_generation", "site_id", "state",
    ];
    // The Mirror Engine stamps the hero pair onto every activated release
    // (engine.js finalizeHeroArtifact): explicit nulls when the donor declares
    // no hero ladder, the exact path+sha when one exists, and — since commit
    // 7a22d00 (2026-08-28) — a hero_provenance audit annotation beside them.
    // Those are the same release tuple this verifier publishes; only the
    // path+sha binding is identity-bearing, and it is still verified exactly
    // below. A null pair means "no hero binding to verify", never a mismatch.
    const heroPairPresent = Object.hasOwn(evidence, "hero_video_path")
      || Object.hasOwn(evidence, "hero_video_sha256");
    const heroPath = heroPairPresent && evidence.hero_video_path !== null && String(evidence.hero_video_path || "") !== ""
      ? evidence.hero_video_path : null;
    const heroSha = heroPairPresent && evidence.hero_video_sha256 !== null && String(evidence.hero_video_sha256 || "") !== ""
      ? evidence.hero_video_sha256 : null;
    const hasHeroProvenance = heroPairPresent && Object.hasOwn(evidence, "hero_provenance");
    if (heroPairPresent) evidenceKeys.push("hero_video_path", "hero_video_sha256");
    if (hasHeroProvenance) evidenceKeys.push("hero_provenance");
    // A release hold without its failed comparison is not actionable. Expose
    // only field *names* to the owner-only diagnostic path; never return IDs,
    // hashes, hosts, or storage paths in this refusal.
    const identityMismatches = [
      Object.keys(proof).sort().join("\n") !== proofKeys.join("\n") && "proof_keys",
      Object.keys(evidence).sort().join("\n") !== evidenceKeys.sort().join("\n") && "evidence_keys",
      (!siteId || !releaseId || !buildHash) && "proof_identity",
      (!SLUG_RE.test(slug) || host !== `${slug}.wss-ai.com`) && "canonical_host",
      manifestPath !== expectedManifestPath && "manifest_path",
      !manifestSha256 && "manifest_sha256",
      (generation < 1 || !environment) && "generation_or_environment",
      evidence.site_id !== siteId && "site_id",
      evidence.release_id !== releaseId && "release_id",
      evidence.build_hash !== buildHash && "build_hash",
      evidence.deployment_env !== environment && "deployment_env",
      evidence.state !== "active" && "state",
      evidence.evidence_schema !== SHARED_RELEASE_EVIDENCE_SCHEMA && "evidence_schema",
      evidence.route_generation !== generation && "route_generation",
      (!Number.isSafeInteger(evidence.file_count) || evidence.file_count < 1) && "file_count",
    ].filter(Boolean);
    if (identityMismatches.length) {
      return failure("shared_release_load_identity_mismatch", { mismatches: identityMismatches });
    }
    const stop = interrupted(context);
    if (stop) return failure(stop);

    try {
      const currentRaw = await guarded(context, (operationSignal) => registry.readSiteGeneration({
        siteId,
        slug,
        host,
        signal: operationSignal,
      }));
      const current = identityRow(currentRaw, { slug, host });
      if (!current.ok) return current;
      if (current.siteId !== siteId || current.activePublishedGeneration !== generation || current.activeReleaseId !== releaseId
        || current.activeBuildHash !== buildHash || current.activeManifestPath !== manifestPath
        || current.activeManifestSha256 !== manifestSha256 || current.activeEnvironment !== environment) {
        return failure("shared_release_not_current_active");
      }

      const manifestRead = await guarded(context, async (operationSignal) => {
        const read = normalizeStorageRead(await storage.readObject({
          bucket: SHARED_RELEASE_BUCKET,
          key: manifestPath,
          signal: operationSignal,
        }));
        if (!read.found) return read;
        return { found: true, body: await bodyBuffer(read.body, { signal: operationSignal }) };
      });
      if (!manifestRead.found) return failure("shared_release_manifest_missing");
      const manifestBody = manifestRead.body;
      if (sha256Hex(manifestBody) !== manifestSha256) return failure("shared_release_manifest_readback_mismatch");
      let manifest;
      try {
        manifest = JSON.parse(manifestBody.toString("utf8"));
      } catch (_) {
        return failure("shared_release_manifest_invalid_json");
      }
      const expectedKeys = [
        "build_hash", "canonical_host", "files", "release_id",
        "route_generation", "routes", "schema", "site_id",
      ];
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
        || Object.keys(manifest).sort().join("\n") !== expectedKeys.sort().join("\n")
        || manifest.schema !== MANIFEST_SCHEMA || manifest.site_id !== siteId
        || manifest.release_id !== releaseId || manifest.build_hash !== buildHash
        || manifest.canonical_host !== host || manifest.route_generation !== generation
        || !manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)
        || !manifest.routes || typeof manifest.routes !== "object" || Array.isArray(manifest.routes)) {
        return failure("shared_release_manifest_identity_mismatch");
      }
      if (heroPath || heroSha) {
        const canonicalHeroPath = canonicalFilePath(heroPath);
        const exactHeroSha = exactSha(heroSha);
        const heroRow = canonicalHeroPath && manifest.files[canonicalHeroPath];
        if (!canonicalHeroPath || canonicalHeroPath !== heroPath || !exactHeroSha
          || !heroRow || heroRow.sha256 !== exactHeroSha) {
          return failure("shared_release_hero_binding_mismatch");
        }
      }
      if (hasHeroProvenance && evidence.hero_provenance !== null
        && (typeof evidence.hero_provenance !== "string"
          || !evidence.hero_provenance.trim()
          || evidence.hero_provenance.length > 128
          || evidence.hero_provenance !== evidence.hero_provenance.trim())) {
        return failure("shared_release_hero_binding_mismatch");
      }

      const loadedFiles = Object.create(null);
      const rels = Object.keys(manifest.files).sort();
      if (!rels.length) return failure("shared_release_files_missing");
      for (const rel of rels) {
        const row = manifest.files[rel];
        const canonical = canonicalFilePath(rel);
        const expectedKey = `sites/${siteId}/releases/${releaseId}/files/${canonical}`;
        if (!canonical || canonical !== rel || !row || typeof row !== "object" || Array.isArray(row)
          || Object.keys(row).sort().join("\n") !== ["bytes", "key", "mime", "sha256"].join("\n")
          || row.key !== expectedKey || !exactSha(row.sha256)
          || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || exactString(row.mime) !== row.mime) {
          return failure("shared_release_manifest_file_invalid", { rel });
        }
        const read = await guarded(context, async (operationSignal) => {
          const stored = normalizeStorageRead(await storage.readObject({
            bucket: SHARED_RELEASE_BUCKET,
            key: row.key,
            signal: operationSignal,
          }));
          if (!stored.found) return stored;
          return { found: true, body: await bodyBuffer(stored.body, { signal: operationSignal }) };
        });
        if (!read.found) return failure("shared_release_file_missing", { rel });
        const body = read.body;
        if (body.length !== row.bytes || sha256Hex(body) !== row.sha256) {
          return failure("shared_release_file_readback_mismatch", { rel });
        }
        loadedFiles[rel] = body;
      }

      // Rebuild the canonical manifest from the loaded bytes. This validates
      // routes, MIME declarations, all path constraints, and the exact SHA in
      // one place instead of maintaining a second release grammar here.
      const rebuilt = prepareRelease({
        siteId,
        releaseId,
        buildHash,
        slug,
        canonicalHost: host,
        expectedGeneration: generation - 1,
        environment,
        env,
        files: loadedFiles,
        routes: manifest.routes,
      });
      if (rebuilt.manifestSha256 !== manifestSha256) return failure("shared_release_manifest_rebuild_mismatch");
      return {
        ok: true,
        fallback: false,
        slug,
        host,
        files: loadedFiles,
        routeMap: { ...manifest.routes },
        buildHash,
        generation,
        proofIdentity: Object.freeze({ ...proof }),
        releaseEvidence: Object.freeze({ ...evidence }),
      };
    } catch (error) {
      const reason = String(error && error.message || error);
      if (reason === "shared_publish_aborted" || reason === "shared_publish_deadline_exceeded") return failure(reason);
      return failure("shared_release_load_failed", { error: reason });
    }
  }

  /**
   * Re-prove one durable active release through its exact public hostname.
   * This path is intentionally read-only: it reuses the active registry and
   * immutable-object loader, then the same exact-byte router verifier used at
   * activation. It never stages, activates, provisions, or repairs a host.
   */
  async function verifyActiveRelease(input = {}) {
    const loaded = await loadActiveRelease(input);
    if (!loaded || loaded.ok !== true) {
      return failure("shared_active_public_verification_failed", {
        stage: "active_release",
        reason: String(loaded && loaded.reason || "shared_release_load_refused"),
        ...(loaded && loaded.detail ? { activeDetail: loaded.detail } : {}),
      });
    }

    const previewUrl = exactString(input.previewUrl);
    const expectedPreviewUrl = `https://${loaded.host}/`;
    if (previewUrl !== expectedPreviewUrl) {
      return failure("shared_active_public_verification_failed", {
        stage: "active_release",
        reason: "shared_public_preview_identity_mismatch",
      });
    }

    let prepared;
    try {
      prepared = prepareRelease({
        siteId: loaded.proofIdentity.site_id,
        releaseId: loaded.proofIdentity.release_id,
        buildHash: loaded.buildHash,
        slug: loaded.slug,
        canonicalHost: loaded.host,
        expectedGeneration: loaded.generation - 1,
        environment: loaded.releaseEvidence.deployment_env,
        env,
        files: loaded.files,
        routes: loaded.routeMap,
      });
    } catch (error) {
      return failure("shared_active_public_verification_failed", {
        stage: "active_release",
        reason: String(error && error.message || "shared_release_prepare_failed"),
      });
    }

    const context = { signal: input.signal, deadlineAt: input.deadlineAt, now };
    let verified;
    try {
      verified = await guarded(context, (operationSignal) => publicVerifier({
        previewUrl,
        siteId: loaded.proofIdentity.site_id,
        releaseId: loaded.proofIdentity.release_id,
        buildHash: loaded.buildHash,
        generation: loaded.generation,
        manifest: prepared.manifest,
        preparedFiles: prepared.preparedFiles,
        signal: operationSignal,
        deadlineAt: input.deadlineAt,
      }));
    } catch (error) {
      return failure("shared_active_public_verification_failed", {
        stage: "public",
        reason: String(error && error.message || "shared_public_verifier_failed"),
      });
    }
    if (!verified || verified.ok !== true) {
      return failure("shared_active_public_verification_failed", {
        stage: "public",
        reason: String(verified && verified.reason || "public_verifier_refused"),
        ...(verified && verified.detail ? { publicDetail: verified.detail } : {}),
      });
    }

    return Object.freeze({
      ok: true,
      fallback: false,
      previewUrl,
      siteId: loaded.proofIdentity.site_id,
      releaseId: loaded.proofIdentity.release_id,
      buildHash: loaded.buildHash,
      generation: loaded.generation,
      routes: Object.freeze(Array.isArray(verified.routes) ? [...verified.routes] : []),
    });
  }

  return Object.freeze({
    stage,
    activate,
    publish,
    loadActiveRelease,
    verifyActiveRelease,
    supportsExpectedGenerationCas: true,
    supportsDeferredActivation: true,
    supportsTwoPhaseQc: true,
  });
}

function createSupabaseSharedSitePublisher({ supabase, env, now, releaseIdFor, fetchImpl = global.fetch, sleep } = {}) {
  if (!supabase || typeof supabase.rpc !== "function") throw new TypeError("shared_site_supabase_client_required");
  const rpc = (name, args, { signal } = {}) => {
    const query = supabase.rpc(name, args);
    return signal && query && typeof query.abortSignal === "function"
      ? query.abortSignal(signal)
      : query;
  };
  return createSharedSitePublisher({
    registry: createSharedSiteRegistryAdapter({ rpc }),
    storage: createSupabaseReleaseStorageAdapter({ supabase }),
    publicVerifier: createPublicReleaseVerifier({ fetchImpl, now, sleep }),
    ensureSharedSiteHost: createVercelSharedSiteHostProvisioner({ env, fetchImpl, now }),
    previewFetch: fetchImpl,
    env,
    now,
    releaseIdFor,
    sleep,
  });
}

function createDefaultSharedSitePublisher({
  env = process.env,
  fetchImpl = global.fetch,
  now,
  releaseIdFor,
  sleep,
} = {}) {
  const rpc = createSupabaseRestRpc({ env, fetchImpl });
  return createSharedSitePublisher({
    registry: createSharedSiteRegistryAdapter({ rpc }),
    storage: createSupabaseRestReleaseStorageAdapter({ env, fetchImpl }),
    publicVerifier: createPublicReleaseVerifier({ fetchImpl, now, sleep }),
    ensureSharedSiteHost: createVercelSharedSiteHostProvisioner({ env, fetchImpl, now }),
    previewFetch: fetchImpl,
    env,
    now,
    releaseIdFor,
    sleep,
  });
}

module.exports = {
  SHARED_RELEASE_EVIDENCE_SCHEMA,
  MAX_OPERATION_KEY_BYTES,
  SHARED_PREVIEW_RETRYABLE_STATUSES,
  SHARED_PREVIEW_RETRY_DELAYS_MS,
  SHARED_RELEASE_CONFIRM_RETRY_DELAYS_MS,
  deterministicReleaseUuid,
  isSharedRetryableStatus,
  sharedRetryDelayMs,
  fetchWithSharedRetry,
  createSharedSiteRegistryAdapter,
  createSupabaseReleaseStorageAdapter,
  createSupabaseRestRpc,
  createSupabaseRestReleaseStorageAdapter,
  createPublicReleaseVerifier,
  createSharedSitePublisher,
  createSupabaseSharedSitePublisher,
  createDefaultSharedSitePublisher,
};
