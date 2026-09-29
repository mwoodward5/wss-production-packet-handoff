"use strict";

// Immutable release publisher for the shared *.wss-ai.com serving lane.
//
// This module intentionally has no Supabase, Blob, Vercel, or fetch client.
// Every write/read is supplied by the caller so a release can be proven in
// memory before the production adapters are connected.  Most importantly, a
// refusal here is terminal for the shared lane: callers must not quietly fall
// back to the mutable wss-site-sources archive or to a legacy deploy.

const { createHash } = require("node:crypto");

const SHARED_RELEASE_BUCKET = "wss-site-releases";
const SHARED_PUBLISH_FLAG = "WSS_SHARED_PUBLISH_ENABLED";
const SHARED_SITE_ALLOWLIST = "WSS_SHARED_SITE_ALLOWLIST";
const SHARED_SITE_ENV = "WSS_SHARED_SITE_ENV";
const ROUTER_ENV_COMPAT_ENV = "WSS_SITE_ROUTER_ENV";
const MANIFEST_VERSION = 1;
const MANIFEST_SCHEMA = "wss-site-release/v1";
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_FILE_COUNT = 10_000;
const MAX_ROUTE_COUNT = 10_000;
const OBJECT_ROOT = "sites";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const ENV_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._~@()+,=-]+$/;
const ENABLED_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactUuid(value) {
  const text = String(value == null ? "" : value);
  return text === text.trim() && UUID_RE.test(text) ? text : "";
}

function exactSha256(value) {
  const text = String(value == null ? "" : value);
  return SHA256_RE.test(text) ? text : "";
}

function exactSlug(value) {
  const text = String(value == null ? "" : value);
  return SLUG_RE.test(text) ? text : "";
}

function exactHost(value) {
  const text = String(value == null ? "" : value);
  return text === text.trim()
    && text.length <= 253
    && HOST_RE.test(text)
    && text.split(".").every((label) => label.length <= 63)
    ? text
    : "";
}

function releaseEnvironment(value, env = process.env) {
  const configured = String((env && env[SHARED_SITE_ENV]) || "");
  const duplicate = String((env && env[ROUTER_ENV_COMPAT_ENV]) || "");
  if (duplicate && duplicate !== configured) return "";
  const text = value === undefined
    ? configured
    : String(value == null ? "" : value);
  if (!text || text !== text.trim() || !ENV_RE.test(text)) return "";
  if (configured && text !== configured) return "";
  return text;
}

function configuredReleaseEnvironment(value, env = process.env) {
  const configured = String((env && env[SHARED_SITE_ENV]) || "");
  const duplicate = String((env && env[ROUTER_ENV_COMPAT_ENV]) || "");
  // I/O entry points require an explicit canonical environment. The pure
  // manifest builder remains usable without process configuration.
  if (!configured || configured !== configured.trim() || !ENV_RE.test(configured)) return "";
  if (duplicate && duplicate !== configured) return "";
  const text = value === undefined
    ? configured
    : String(value == null ? "" : value);
  return text === configured ? configured : "";
}

function isSharedPublishEnabled(env = process.env) {
  const value = String((env && env[SHARED_PUBLISH_FLAG]) || "").trim().toLowerCase();
  return ENABLED_VALUES.has(value);
}

// --- Local preview seam -----------------------------------------------------
//
// The local Docker stack (apps/site-router behind the compose TLS gateway)
// runs the whole serving lane on this machine under
// WSS_SHARED_SITE_ENV=local. Exactly one constant per lane is seamed — the
// gateway origin — and it must never change production bytes: every helper
// here returns ""/false for any other environment.

const LOCAL_ENVIRONMENT = "local";
const LOCAL_SITE_BASE_DOMAIN = "local.wss-ai.test";
const LOCAL_SITE_GATEWAY_PORT = 5444;

/** Exact, fail-closed local-environment test. An explicit WSS_SHARED_SITE_ENV
 * must be the literal "local" — the same strictness releaseEnvironment applies
 * to the variable.
 *
 * LOCAL-BY-DEFAULT (independence): with NO explicit environment configured,
 * the deployment is local unless production Vercel credentials are present.
 * A stack that cannot reach Vercel (the whole point of the local-first
 * platform) must serve locally without being told to via an env var someone
 * forgot to copy. Production sets WSS_SHARED_SITE_ENV=production on Vercel,
 * so an explicitly configured environment always wins and behavior there is
 * unchanged; a non-Vercel host that DOES carry VERCEL_TOKEN/VERCEL_TEAM_ID
 * must set WSS_SHARED_SITE_ENV explicitly. */
function isLocalSharedSiteEnvironment(env = process.env) {
  const configured = env && env[SHARED_SITE_ENV];
  // An explicitly set variable (any value, including "") decides, exactly as
  // before: only the literal "local" is local.
  if (typeof configured === "string") return configured === LOCAL_ENVIRONMENT;
  // Otherwise: any Vercel credential present means the deployment intends to
  // reach production and must be fully configured (the historic fail-closed
  // contract for partial credentials is preserved). Only a deployment with
  // NO Vercel signal at all serves locally by default. The Vercel platform
  // sets VERCEL=1 itself and the production project carries VERCEL_TOKEN +
  // VERCEL_TEAM_ID (verified in the env pulls), so a genuine Vercel
  // deployment never falls through to the local default.
  const vercelSignal = ["VERCEL", "VERCEL_TOKEN", "VERCEL_TEAM_ID"]
    .some((name) => String((env && env[name]) || "").trim() !== "");
  return !vercelSignal;
}

/** The one local-router origin for a slug, or "" outside the local
 * environment. Shape: https://<slug>.local.wss-ai.test:5444 — the compose
 * gateway terminates TLS for the *.local.wss-ai.test wildcard and rewrites
 * the Host to <slug>.wss-ai.com before proxying to the local router. */
function localSiteGatewayOrigin(slug, env = process.env) {
  if (!isLocalSharedSiteEnvironment(env)) return "";
  const localSlug = exactSlug(slug);
  return localSlug
    ? `https://${localSlug}.${LOCAL_SITE_BASE_DOMAIN}:${LOCAL_SITE_GATEWAY_PORT}`
    : "";
}

function parseSharedSiteAllowlist(env = process.env) {
  const raw = String((env && env[SHARED_SITE_ALLOWLIST]) || "");
  return new Set(raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean));
}

function refusal(reason, detail) {
  return {
    ok: false,
    refused: true,
    reason,
    fallback: false,
    ...(detail ? { detail } : {}),
  };
}

function sharedSiteIdentity({ siteId, slug } = {}) {
  const id = exactUuid(siteId);
  const canonicalSlug = exactSlug(slug);
  if (!id || !canonicalSlug) return refusal("invalid_site_identity");
  return { ok: true, siteId: id, slug: canonicalSlug, fallback: false };
}

function sharedAllowlistDecision({ siteId, slug, env = process.env } = {}) {
  const identity = sharedSiteIdentity({ siteId, slug });
  if (!identity.ok) return identity;
  const allowlist = parseSharedSiteAllowlist(env);
  if (!allowlist.has("*") && !allowlist.has(identity.siteId) && !allowlist.has(identity.slug)) {
    return refusal("shared_site_not_allowlisted");
  }
  return identity;
}

function sharedPublishDecision(input = {}) {
  if (!isSharedPublishEnabled(input.env)) return refusal("shared_publish_disabled");
  return sharedAllowlistDecision(input);
}

/**
 * Accept only one already-canonical, relative object path.
 *
 * Percent escapes are rejected instead of decoded because a second decoder in
 * a CDN or storage proxy can turn %2f/%2e into a traversal after validation.
 * Backslashes, duplicate separators, dot segments, controls, and Unicode are
 * rejected for the same reason.  The allowlist still covers normal generated
 * assets, including .well-known/security.txt and hashed bundle names.
 */
function canonicalFilePath(value) {
  const rel = String(value == null ? "" : value);
  if (!rel || rel !== rel.trim() || rel.length > 512) return "";
  if (rel.startsWith("/") || rel.endsWith("/") || rel.includes("//")) return "";
  if (rel.includes("\\") || rel.includes("%") || /[?#:\x00-\x1f\x7f]/.test(rel)) return "";
  const segments = rel.split("/");
  if (!segments.length || segments.some((part) => (
    !part
    || part === "."
    || part === ".."
    || part.length > 128
    || !SAFE_SEGMENT_RE.test(part)
  ))) return "";
  return segments.join("/");
}

function canonicalRoutePath(value) {
  const route = String(value == null ? "" : value);
  if (route === "/") return route;
  if (!route || route !== route.trim() || route.length > 1024 || !route.startsWith("/")) return "";
  if (route.includes("\\") || route.includes("%") || route.includes("//") || /[?#:\x00-\x1f\x7f]/.test(route)) return "";
  const trailingSlash = route.endsWith("/");
  const parts = route.slice(1, trailingSlash ? -1 : undefined).split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || part.length > 128 || !SAFE_SEGMENT_RE.test(part))) {
    return "";
  }
  return `/${parts.join("/")}${trailingSlash ? "/" : ""}`;
}

function releasePrefix(siteId, releaseId) {
  const site = exactUuid(siteId);
  const release = exactUuid(releaseId);
  if (!site || !release) throw new Error("invalid_release_identity");
  return `${OBJECT_ROOT}/${site}/releases/${release}`;
}

function releaseObjectKey(siteId, releaseId, rel) {
  const canonical = canonicalFilePath(rel);
  if (!canonical) throw new Error("invalid_release_file_path");
  return `${releasePrefix(siteId, releaseId)}/files/${canonical}`;
}

function releaseManifestKey(siteId, releaseId) {
  return `${releasePrefix(siteId, releaseId)}/manifest.json`;
}

function contentTypeFor(rel) {
  if (/\.html?$/i.test(rel)) return "text/html; charset=utf-8";
  if (/\.css$/i.test(rel)) return "text/css; charset=utf-8";
  if (/\.m?js$/i.test(rel)) return "text/javascript; charset=utf-8";
  if (/\.json$/i.test(rel)) return "application/json; charset=utf-8";
  if (/\.svg$/i.test(rel)) return "image/svg+xml";
  if (/\.png$/i.test(rel)) return "image/png";
  if (/\.jpe?g$/i.test(rel)) return "image/jpeg";
  if (/\.webp$/i.test(rel)) return "image/webp";
  if (/\.gif$/i.test(rel)) return "image/gif";
  if (/\.avif$/i.test(rel)) return "image/avif";
  if (/\.ico$/i.test(rel)) return "image/x-icon";
  if (/\.woff2$/i.test(rel)) return "font/woff2";
  if (/\.woff$/i.test(rel)) return "font/woff";
  if (/\.mp4$/i.test(rel)) return "video/mp4";
  if (/\.webm$/i.test(rel)) return "video/webm";
  if (/\.txt$/i.test(rel)) return "text/plain; charset=utf-8";
  if (/\.xml$/i.test(rel)) return "application/xml; charset=utf-8";
  return "application/octet-stream";
}

function asBuffer(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? value.byteLength
    : typeof value === "string"
      ? Buffer.byteLength(value, "utf8")
      : -1;
  if (bytes < 0) throw new Error("release_file_must_be_bytes");
  if (!isAllowedAssetSize(bytes)) throw new Error("release_file_too_large");
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new Error("release_file_must_be_bytes");
}

function isAllowedAssetSize(bytes) {
  return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_ASSET_BYTES;
}

function objectBody(result) {
  const value = result && Object.prototype.hasOwnProperty.call(result, "body") ? result.body : result;
  return asBuffer(value);
}

function adapterSucceeded(result) {
  return result === true || Boolean(result && result.ok === true);
}

function makeDefaultRoutes(paths) {
  const routes = Object.assign(Object.create(null), { "/": "index.html" });
  for (const rel of paths) routes[`/${rel}`] = rel;
  return routes;
}

function normalizeRoutes(routes, assetPaths) {
  const source = routes == null ? makeDefaultRoutes(assetPaths) : { ...routes, "/": "index.html" };
  if (Object.keys(source).length > MAX_ROUTE_COUNT) throw new Error("manifest_route_limit_exceeded");
  const known = new Set(assetPaths);
  const out = Object.create(null);
  for (const rawRoute of Object.keys(source).sort()) {
    const route = canonicalRoutePath(rawRoute);
    const target = canonicalFilePath(source[rawRoute]);
    if (!route || route !== rawRoute) throw new Error("invalid_manifest_route");
    if (!target || target !== source[rawRoute] || !known.has(target)) throw new Error("manifest_route_target_missing");
    out[route] = target;
  }
  if (out["/"] !== "index.html") throw new Error("manifest_root_must_target_index");
  return out;
}

function prepareRelease({
  siteId,
  releaseId,
  buildHash,
  slug,
  canonicalHost,
  expectedGeneration,
  environment,
  env = process.env,
  files,
  routes,
} = {}) {
  const site = exactUuid(siteId);
  const release = exactUuid(releaseId);
  const canonicalSlug = exactSlug(slug);
  const expectedHost = canonicalSlug ? `${canonicalSlug}.wss-ai.com` : "";
  const host = exactHost(canonicalHost === undefined ? expectedHost : canonicalHost);
  const deploymentEnv = releaseEnvironment(environment, env);
  if (!site || !release || !canonicalSlug || !host || !deploymentEnv) throw new Error("invalid_release_identity");
  if (host !== expectedHost) throw new Error("canonical_host_not_slug_host");
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || expectedGeneration >= Number.MAX_SAFE_INTEGER) {
    throw new Error("invalid_expected_generation");
  }
  const routeGeneration = expectedGeneration + 1;
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("release_files_missing");

  const rawPaths = Object.keys(files).sort();
  if (!rawPaths.length) throw new Error("release_files_missing");
  if (rawPaths.length > MAX_FILE_COUNT) throw new Error("manifest_file_limit_exceeded");
  const preparedFiles = new Map();
  for (const rawPath of rawPaths) {
    const rel = canonicalFilePath(rawPath);
    if (!rel || rel !== rawPath) throw new Error("invalid_release_file_path");
    if (preparedFiles.has(rel)) throw new Error("duplicate_release_file_path");
    const body = asBuffer(files[rawPath]);
    const digest = sha256(body);
    preparedFiles.set(rel, {
      body,
      sha256: digest,
      size: body.length,
      contentType: contentTypeFor(rel),
      key: releaseObjectKey(site, release, rel),
    });
  }
  if (!preparedFiles.has("index.html")) throw new Error("release_index_missing");

  const derivedBuildHash = sha256(Buffer.from(JSON.stringify([...preparedFiles].map(([rel, file]) => [rel, file.sha256, file.size]))));
  const canonicalBuildHash = buildHash == null || buildHash === "" ? derivedBuildHash : exactSha256(buildHash);
  if (!canonicalBuildHash) throw new Error("invalid_build_hash");

  const manifestFiles = Object.create(null);
  for (const [rel, file] of preparedFiles) {
    manifestFiles[rel] = {
      key: file.key,
      sha256: file.sha256,
      bytes: file.size,
      mime: file.contentType,
    };
  }

  const manifest = {
    schema: MANIFEST_SCHEMA,
    site_id: site,
    release_id: release,
    build_hash: canonicalBuildHash,
    canonical_host: host,
    route_generation: routeGeneration,
    routes: normalizeRoutes(routes, [...preparedFiles.keys()]),
    files: manifestFiles,
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest), "utf8");
  if (manifestBody.length > MAX_MANIFEST_BYTES) throw new Error("release_manifest_too_large");
  return {
    siteId: site,
    releaseId: release,
    buildHash: canonicalBuildHash,
    slug: canonicalSlug,
    canonicalHost: host,
    routeGeneration,
    environment: deploymentEnv,
    preparedFiles,
    manifest,
    manifestBody,
    manifestKey: releaseManifestKey(site, release),
    manifestSha256: sha256(manifestBody),
  };
}

function operationalFailure(reason, detail) {
  return { ok: false, refused: false, reason, fallback: false, ...(detail ? { detail } : {}) };
}

// Keep storage fan-out bounded independently of campaign/browser concurrency.
// Stop claiming on failure, but settle every in-flight operation before returning
// so a caller cannot retry while an earlier phase is still writing.
async function runReleaseFilePhase(files, operation) {
  const entries = [...files];
  const failures = [];
  let next = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && next < entries.length) {
      const index = next++;
      try {
        const failure = await operation(entries[index]);
        if (failure) { failures.push({ index, failure }); stopped = true; }
      } catch (error) {
        failures.push({ index, error });
        stopped = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  failures.sort((a, b) => a.index - b.index);
  if (!failures.length) return null;
  if (Object.prototype.hasOwnProperty.call(failures[0], "error")) throw failures[0].error;
  return failures[0].failure;
}

async function publishSharedSiteRelease(input = {}) {
  const decision = sharedPublishDecision(input);
  if (!decision.ok) return decision;
  const environment = configuredReleaseEnvironment(input.environment, input.env);
  if (!environment) return refusal("invalid_release_environment");

  let release;
  try {
    release = prepareRelease({ ...input, environment });
  } catch (error) {
    return refusal(String(error && error.message ? error.message : error));
  }

  const io = input.io || {};
  for (const name of ["insertStagedRelease", "putObjectIfAbsent", "readObject", "markReleaseVerified"]) {
    if (typeof io[name] !== "function") return operationalFailure("shared_release_adapter_missing", { adapter: name });
  }

  try {
    const staged = await io.insertStagedRelease({
      siteId: release.siteId,
      releaseId: release.releaseId,
      buildHash: release.buildHash,
      slug: release.slug,
      canonicalHost: release.canonicalHost,
      routeGeneration: release.routeGeneration,
      environment: release.environment,
      manifestPath: release.manifestKey,
      manifestSha256: release.manifestSha256,
      state: "staged",
    });
    if (!adapterSucceeded(staged)) return operationalFailure("release_stage_refused");

    const uploadFailure = await runReleaseFilePhase(release.preparedFiles, async ([rel, file]) => {
      const uploaded = await io.putObjectIfAbsent({
        bucket: SHARED_RELEASE_BUCKET,
        key: file.key,
        body: file.body,
        contentType: file.contentType,
        sha256: file.sha256,
        insertOnly: true,
      });
      if (!adapterSucceeded(uploaded)) return operationalFailure("release_object_insert_refused", { rel });
    });
    if (uploadFailure) return uploadFailure;

    const manifestUploaded = await io.putObjectIfAbsent({
      bucket: SHARED_RELEASE_BUCKET,
      key: release.manifestKey,
      body: release.manifestBody,
      contentType: "application/json; charset=utf-8",
      sha256: release.manifestSha256,
      insertOnly: true,
    });
    if (!adapterSucceeded(manifestUploaded)) return operationalFailure("release_manifest_insert_refused");

    const readFailure = await runReleaseFilePhase(release.preparedFiles, async ([rel, file]) => {
      const read = await io.readObject({ bucket: SHARED_RELEASE_BUCKET, key: file.key });
      const body = objectBody(read);
      if (body.length !== file.size || sha256(body) !== file.sha256) {
        return operationalFailure("release_object_readback_mismatch", { rel });
      }
    });
    if (readFailure) return readFailure;
    const manifestRead = objectBody(await io.readObject({ bucket: SHARED_RELEASE_BUCKET, key: release.manifestKey }));
    if (manifestRead.length !== release.manifestBody.length || sha256(manifestRead) !== release.manifestSha256) {
      return operationalFailure("release_manifest_readback_mismatch");
    }

    const verified = await io.markReleaseVerified({
      siteId: release.siteId,
      releaseId: release.releaseId,
      buildHash: release.buildHash,
      canonicalHost: release.canonicalHost,
      routeGeneration: release.routeGeneration,
      environment: release.environment,
      manifestPath: release.manifestKey,
      manifestSha256: release.manifestSha256,
      expectedState: "staged",
      state: "verified",
    });
    if (!adapterSucceeded(verified)) return operationalFailure("release_verify_cas_refused");

    return {
      ok: true,
      state: "verified",
      fallback: false,
      siteId: release.siteId,
      releaseId: release.releaseId,
      buildHash: release.buildHash,
      canonicalHost: release.canonicalHost,
      routeGeneration: release.routeGeneration,
      environment: release.environment,
      manifestPath: release.manifestKey,
      manifestSha256: release.manifestSha256,
      fileCount: release.preparedFiles.size,
      manifest: release.manifest,
    };
  } catch (error) {
    return operationalFailure("shared_release_io_failed", {
      error: String(error && error.message ? error.message : error),
    });
  }
}

function validGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function rpcPayload(result) {
  if (result && result.error) {
    return { ok: false, reason: String(result.error.code || result.error.message || "rpc_failed") };
  }
  const data = result && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" ? value : { ok: false, reason: "rpc_empty" };
}

/** Build the publisher/CAS adapter around an injected Supabase-style rpc. */
function createReleaseRegistryAdapter({ rpc } = {}) {
  if (typeof rpc !== "function") throw new TypeError("shared_release_rpc_required");
  const call = async (name, args) => rpcPayload(await rpc(name, args));
  return Object.freeze({
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
      });
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
      });
    },
    activateReleaseCas(row) {
      return call("activate_site_release", {
        p_site_id: row.siteId,
        p_expected_generation: row.expectedGeneration,
        p_release_id: row.releaseId,
        p_deployment_env: row.environment,
      });
    },
    rollbackReleaseCas(row) {
      return call("rollback_site_release", {
        p_site_id: row.siteId,
        p_expected_generation: row.expectedGeneration,
        p_release_id: row.releaseId,
        p_deployment_env: row.environment,
      });
    },
    quarantineReleaseCas(row) {
      return call("quarantine_site_release", {
        p_site_id: row.siteId,
        p_expected_generation: row.expectedGeneration,
        p_failed_release_id: row.releaseId,
        p_deployment_env: row.environment,
      });
    },
  });
}

async function runReleaseCas(kind, input = {}) {
  // The publisher flag gates new activation, but emergency rollback must stay
  // available for an already-active shared site when new publishing is off.
  // First-release quarantine is the same fail-closed compensation class.
  const decision = kind === "activate" ? sharedPublishDecision(input) : sharedAllowlistDecision(input);
  if (!decision.ok) return decision;
  const releaseId = exactUuid(input.releaseId);
  const environment = configuredReleaseEnvironment(input.environment, input.env);
  if (!environment) return refusal("invalid_release_environment");
  if (!releaseId || !validGeneration(input.expectedGeneration)) {
    return refusal("invalid_release_cas_input");
  }
  const method = kind === "activate"
    ? "activateReleaseCas"
    : kind === "rollback" ? "rollbackReleaseCas" : "quarantineReleaseCas";
  const io = input.io || {};
  if (typeof io[method] !== "function") return operationalFailure("shared_release_adapter_missing", { adapter: method });
  try {
    const result = await io[method]({
      siteId: decision.siteId,
      releaseId,
      expectedGeneration: input.expectedGeneration,
      environment,
    });
    if (!adapterSucceeded(result)) {
      return operationalFailure(`${kind}_release_cas_refused`, {
        reason: String((result && result.reason) || "cas_conflict"),
      });
    }
    return {
      ok: true,
      fallback: false,
      siteId: decision.siteId,
      releaseId,
      generation: Number(result.generation),
      state: kind === "quarantine" ? "quarantined" : "active",
    };
  } catch (error) {
    return operationalFailure(`${kind}_release_cas_failed`, {
      error: String(error && error.message ? error.message : error),
    });
  }
}

async function activateSharedSiteRelease(input) {
  return runReleaseCas("activate", input);
}

async function rollbackSharedSiteRelease(input) {
  return runReleaseCas("rollback", input);
}

async function quarantineSharedSiteRelease(input) {
  return runReleaseCas("quarantine", input);
}

module.exports = {
  SHARED_RELEASE_BUCKET,
  SHARED_PUBLISH_FLAG,
  SHARED_SITE_ALLOWLIST,
  SHARED_SITE_ENV,
  ROUTER_ENV_COMPAT_ENV,
  MANIFEST_VERSION,
  MANIFEST_SCHEMA,
  MAX_MANIFEST_BYTES,
  MAX_ASSET_BYTES,
  MAX_FILE_COUNT,
  MAX_ROUTE_COUNT,
  isSharedPublishEnabled,
  parseSharedSiteAllowlist,
  sharedPublishDecision,
  LOCAL_SITE_BASE_DOMAIN,
  LOCAL_SITE_GATEWAY_PORT,
  isLocalSharedSiteEnvironment,
  localSiteGatewayOrigin,
  canonicalFilePath,
  canonicalRoutePath,
  releasePrefix,
  releaseObjectKey,
  releaseManifestKey,
  contentTypeFor,
  isAllowedAssetSize,
  releaseEnvironment,
  prepareRelease,
  createReleaseRegistryAdapter,
  publishSharedSiteRelease,
  activateSharedSiteRelease,
  rollbackSharedSiteRelease,
  quarantineSharedSiteRelease,
};
