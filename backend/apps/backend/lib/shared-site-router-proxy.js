"use strict";

// Private, HMAC-authenticated bridge between the public site router and the
// service-role-only shared-release RPC/storage surface. Keep this module
// deliberately small and closed: callers select one named operation, never a
// table, RPC, bucket, URL, or storage method.

const { createHmac, timingSafeEqual } = require("node:crypto");
const { TextDecoder } = require("node:util");

const MAX_BODY_BYTES = 8 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 60;
const SIGNED_URL_TTL_SECONDS = 120;
const RELEASE_BUCKET = "wss-site-releases";
const PROXY_SECRET_ENV = "WSS_SHARED_SITE_ROUTER_PROXY_SECRET";
const SHARED_SERVING_FLAG_ENV = "WSS_SHARED_SERVING_ENABLED";
const SHARED_ALLOWLIST_ENV = "WSS_SHARED_SITE_ALLOWLIST";
const SHARED_ENV_ENV = "WSS_SHARED_SITE_ENV";
const ROUTER_ENV_COMPAT_ENV = "WSS_SITE_ROUTER_ENV";
const ENABLED_VALUES = new Set(["1", "true", "on", "yes", "enabled"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ENV_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._~@()+,=-]+$/;

class ProxyError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "ProxyError";
    this.status = status;
    this.code = code;
  }
}

function refuse(status, code) {
  throw new ProxyError(status, code);
}

function exactString(value) {
  return typeof value === "string" && value === value.trim() ? value : "";
}

function exactUuid(value) {
  const text = exactString(value);
  return UUID_RE.test(text) ? text : "";
}

function exactSha256(value) {
  const text = exactString(value);
  return SHA256_RE.test(text) ? text : "";
}

function exactSlug(value) {
  const text = exactString(value);
  return SLUG_RE.test(text) ? text : "";
}

function exactEnvironment(value) {
  const text = exactString(value);
  return ENV_RE.test(text) ? text : "";
}

function exactSharedHost(value) {
  const host = exactString(value);
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.wss-ai\.com$/.exec(host);
  return match && exactSlug(match[1]) ? { host, slug: match[1] } : null;
}

function canonicalRelativePath(value) {
  const path = exactString(value);
  if (!path || path.length > 512 || path.startsWith("/") || path.endsWith("/") || path.includes("//")) return "";
  if (path.includes("\\") || path.includes("%") || /[?#:\x00-\x1f\x7f]/.test(path)) return "";
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.length > 128 || !SAFE_SEGMENT_RE.test(part))) {
    return "";
  }
  return parts.join("/");
}

function expectedManifestPath(siteId, releaseId) {
  return `sites/${siteId}/releases/${releaseId}/manifest.json`;
}

function releaseFilesPrefix(siteId, releaseId) {
  return `sites/${siteId}/releases/${releaseId}/files/`;
}

function isReleaseObjectPath(path, siteId, releaseId, manifestPath) {
  const canonical = canonicalRelativePath(path);
  if (!canonical || canonical !== path) return false;
  if (canonical === manifestPath) return true;
  const prefix = releaseFilesPrefix(siteId, releaseId);
  return canonical.startsWith(prefix) && canonical.length > prefix.length;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required) {
  if (!isPlainObject(value)) refuse(400, "invalid_request");
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    refuse(400, "invalid_request_shape");
  }
  return value;
}

/**
 * JSON.parse keeps the last duplicate object key. That is unsafe for a signed
 * command envelope because different parsers/proxies can disagree about what
 * was signed. This compact parser rejects duplicates at every nesting level.
 */
function parseJsonWithoutDuplicates(rawBody) {
  if (!Buffer.isBuffer(rawBody) && !(rawBody instanceof Uint8Array)) refuse(400, "raw_body_required");
  const bytes = Buffer.from(rawBody);
  if (!bytes.length) refuse(400, "invalid_json");
  if (bytes.length > MAX_BODY_BYTES) refuse(413, "payload_too_large");

  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    refuse(400, "invalid_json");
  }
  let index = 0;

  function whitespace() {
    while (index < source.length && /[\x20\x09\x0a\x0d]/.test(source[index])) index += 1;
  }

  function stringValue() {
    if (source[index] !== '"') refuse(400, "invalid_json");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (!escaped && source[index] === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch (_) {
          refuse(400, "invalid_json");
        }
      }
      if (!escaped && code < 0x20) refuse(400, "invalid_json");
      if (!escaped && source[index] === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    refuse(400, "invalid_json");
  }

  function numberValue() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (!match) refuse(400, "invalid_json");
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) refuse(400, "invalid_json");
    return value;
  }

  function value() {
    whitespace();
    if (source[index] === '"') return stringValue();
    if (source[index] === "{") return objectValue();
    if (source[index] === "[") return arrayValue();
    if (source.startsWith("true", index)) { index += 4; return true; }
    if (source.startsWith("false", index)) { index += 5; return false; }
    if (source.startsWith("null", index)) { index += 4; return null; }
    return numberValue();
  }

  function objectValue() {
    index += 1;
    whitespace();
    const out = Object.create(null);
    const seen = new Set();
    if (source[index] === "}") { index += 1; return out; }
    while (index < source.length) {
      whitespace();
      const key = stringValue();
      if (seen.has(key)) refuse(400, "duplicate_json_key");
      seen.add(key);
      whitespace();
      if (source[index] !== ":") refuse(400, "invalid_json");
      index += 1;
      out[key] = value();
      whitespace();
      if (source[index] === "}") { index += 1; return out; }
      if (source[index] !== ",") refuse(400, "invalid_json");
      index += 1;
    }
    refuse(400, "invalid_json");
  }

  function arrayValue() {
    index += 1;
    whitespace();
    const out = [];
    if (source[index] === "]") { index += 1; return out; }
    while (index < source.length) {
      out.push(value());
      whitespace();
      if (source[index] === "]") { index += 1; return out; }
      if (source[index] !== ",") refuse(400, "invalid_json");
      index += 1;
    }
    refuse(400, "invalid_json");
  }

  const parsed = value();
  whitespace();
  if (index !== source.length) refuse(400, "invalid_json");
  return parsed;
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  let found;
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== name) continue;
    if (found !== undefined || Array.isArray(value)) return "";
    found = value;
  }
  return typeof found === "string" ? found : "";
}

function strongSecret(env) {
  const secret = typeof env?.[PROXY_SECRET_ENV] === "string" ? env[PROXY_SECRET_ENV] : "";
  const bytes = Buffer.byteLength(secret, "utf8");
  return secret === secret.trim() && bytes >= 32 && bytes <= 4096 ? secret : "";
}

function verifyHmac({ headers, rawBody, env, nowSeconds }) {
  const secret = strongSecret(env);
  if (!secret) refuse(503, "proxy_unavailable");
  const timestamp = headerValue(headers, "x-wss-timestamp");
  const signature = headerValue(headers, "x-wss-signature");
  if (!/^[1-9]\d{9,11}$/.test(timestamp) || !SHA256_RE.test(signature)) refuse(401, "invalid_signature");
  const requestTime = Number(timestamp);
  const now = Number.isSafeInteger(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(requestTime) || Math.abs(now - requestTime) > SIGNATURE_TOLERANCE_SECONDS) {
    refuse(401, "signature_expired");
  }
  const expected = createHmac("sha256", secret)
    .update(timestamp, "utf8")
    .update(".", "utf8")
    .update(Buffer.from(rawBody))
    .digest();
  const supplied = Buffer.from(signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) refuse(401, "invalid_signature");
  return now;
}

function configuredEnvironment(env) {
  const configured = exactEnvironment(env?.[SHARED_ENV_ENV]);
  if (!configured) refuse(503, "proxy_unavailable");
  const duplicateRaw = env?.[ROUTER_ENV_COMPAT_ENV];
  if (duplicateRaw !== undefined && exactEnvironment(duplicateRaw) !== configured) {
    refuse(503, "proxy_unavailable");
  }
  return configured;
}

function allowlist(env) {
  const raw = typeof env?.[SHARED_ALLOWLIST_ENV] === "string" ? env[SHARED_ALLOWLIST_ENV] : "";
  return new Set(raw.split(/[\s,]+/).filter(Boolean));
}

function ensureLaneEnabled(env) {
  // Serving is a separate operational boundary from publishing. Turning off
  // new release publication/activation must never take an already-active site
  // offline, while a missing serving flag must keep this privileged proxy
  // dormant by default.
  const flag = String(env?.[SHARED_SERVING_FLAG_ENV] || "").trim().toLowerCase();
  if (!ENABLED_VALUES.has(flag)) refuse(503, "proxy_unavailable");
  const allowed = allowlist(env);
  if (!allowed.size) refuse(503, "proxy_unavailable");
  return allowed;
}

function ensureAllowed(allowed, ...identities) {
  if (allowed.has("*") || identities.some((identity) => identity && allowed.has(identity))) return;
  refuse(403, "site_not_allowed");
}

function validateInput(operation, input, env, allowed) {
  const configuredEnv = configuredEnvironment(env);
  if (operation === "resolve_public") {
    exactKeys(input, ["host", "deployment_env"]);
    const identity = exactSharedHost(input.host);
    if (!identity || input.deployment_env !== configuredEnv) refuse(400, "invalid_request");
    // A public host carries only its slug. A UUID-only allowlist cannot prove
    // that host locally and must not turn arbitrary wildcard traffic into a
    // provider lookup. Exact site IDs remain valid for tuple-bound operations.
    if (!allowed.has("*") && !allowed.has(identity.slug)) {
      refuse(403, "site_not_allowed");
    }
    return { host: identity.host, slug: identity.slug, deployment_env: configuredEnv };
  }

  if (operation === "resolve_preview") {
    exactKeys(input, ["site_id", "release_id", "build_hash", "slug", "deployment_env"]);
    const normalized = {
      site_id: exactUuid(input.site_id),
      release_id: exactUuid(input.release_id),
      build_hash: exactSha256(input.build_hash),
      slug: exactSlug(input.slug),
      deployment_env: exactEnvironment(input.deployment_env),
    };
    if (Object.values(normalized).some((value) => !value) || normalized.deployment_env !== configuredEnv) {
      refuse(400, "invalid_request");
    }
    ensureAllowed(allowed, normalized.site_id, normalized.slug);
    return normalized;
  }

  if (operation === "consume_preview") {
    exactKeys(input, ["jti_hash", "site_id", "release_id", "build_hash", "slug", "deployment_env"]);
    const normalized = {
      jti_hash: exactSha256(input.jti_hash),
      site_id: exactUuid(input.site_id),
      release_id: exactUuid(input.release_id),
      build_hash: exactSha256(input.build_hash),
      slug: exactSlug(input.slug),
      deployment_env: exactEnvironment(input.deployment_env),
    };
    if (Object.values(normalized).some((value) => !value) || normalized.deployment_env !== configuredEnv) {
      refuse(400, "invalid_request");
    }
    ensureAllowed(allowed, normalized.site_id, normalized.slug);
    return normalized;
  }

  if (operation === "sign_object") {
    if (!isPlainObject(input) || (input.mode !== "public" && input.mode !== "preview")) refuse(400, "invalid_request");
    const identityKey = input.mode === "public" ? "host" : "slug";
    exactKeys(input, ["site_id", "release_id", "build_hash", "deployment_env", "mode", "object_path", identityKey]);
    const normalized = {
      site_id: exactUuid(input.site_id),
      release_id: exactUuid(input.release_id),
      build_hash: exactSha256(input.build_hash),
      deployment_env: exactEnvironment(input.deployment_env),
      mode: input.mode,
      object_path: canonicalRelativePath(input.object_path),
    };
    if (Object.values(normalized).some((value) => !value) || normalized.deployment_env !== configuredEnv) {
      refuse(400, "invalid_request");
    }
    if (input.mode === "public") {
      const host = exactSharedHost(input.host);
      if (!host) refuse(400, "invalid_request");
      normalized.host = host.host;
      normalized.slug = host.slug;
    } else {
      normalized.slug = exactSlug(input.slug);
      if (!normalized.slug) refuse(400, "invalid_request");
    }
    ensureAllowed(allowed, normalized.site_id, normalized.slug);
    const manifestPath = expectedManifestPath(normalized.site_id, normalized.release_id);
    if (!isReleaseObjectPath(normalized.object_path, normalized.site_id, normalized.release_id, manifestPath)) {
      refuse(403, "object_path_mismatch");
    }
    return normalized;
  }

  refuse(400, "unknown_operation");
}

function serviceConfig(env) {
  const rawUrl = exactString(env?.SUPABASE_URL);
  const key = exactString(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawUrl || !key || Buffer.byteLength(key, "utf8") < 16) refuse(503, "service_unavailable");
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    refuse(503, "service_unavailable");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname
    || (url.pathname !== "/" && url.pathname !== "")) {
    refuse(503, "service_unavailable");
  }
  return { baseUrl: url.origin, key };
}

async function providerJson(url, options, fetchImpl) {
  if (typeof fetchImpl !== "function") refuse(503, "service_unavailable");
  let response;
  try {
    response = await fetchImpl(url, { redirect: "error", cache: "no-store", ...options });
  } catch (_) {
    refuse(503, "provider_unavailable");
  }
  if (!response || response.ok !== true) refuse(503, "provider_unavailable");
  try {
    return await response.json();
  } catch (_) {
    refuse(503, "provider_invalid_response");
  }
}

function serviceHeaders(key) {
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // Supabase's newer sb_secret_* credentials are intentionally not JWTs and
  // must not be placed in Authorization. Legacy service-role JWTs need both.
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function rpc(config, name, args, fetchImpl) {
  return providerJson(`${config.baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(config.key),
    body: JSON.stringify(args),
  }, fetchImpl);
}

function oneResolverRow(value) {
  if (!Array.isArray(value) || value.length > 1) refuse(503, "provider_invalid_response");
  if (!value.length) return null;
  const row = value[0];
  const expected = [
    "site_id", "canonical_slug", "canonical_host", "release_id", "build_hash",
    "manifest_path", "manifest_sha256", "deployment_env", "generation",
  ].sort();
  if (!isPlainObject(row)) refuse(503, "provider_invalid_response");
  const keys = Object.keys(row).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    refuse(503, "provider_invalid_response");
  }
  return row;
}

function normalizedGeneration(value) {
  if (Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  return -1;
}

function normalizeResolverRow(value, expected, mode) {
  const row = oneResolverRow(value);
  if (!row) return null;
  const normalized = {
    site_id: exactUuid(row.site_id),
    release_id: exactUuid(row.release_id),
    build_hash: exactSha256(row.build_hash),
    canonical_host: exactSharedHost(row.canonical_host)?.host || "",
    generation: normalizedGeneration(row.generation),
    manifest_path: canonicalRelativePath(row.manifest_path),
    manifest_sha256: exactSha256(row.manifest_sha256),
    deployment_env: exactEnvironment(row.deployment_env),
  };
  const slug = exactSlug(row.canonical_slug);
  const manifest = expectedManifestPath(normalized.site_id, normalized.release_id);
  const generationValid = mode === "public" ? normalized.generation >= 1 : normalized.generation >= 0;
  if (Object.values(normalized).some((value) => value === "") || !slug || !generationValid
    || normalized.canonical_host !== `${slug}.wss-ai.com`
    || normalized.manifest_path !== manifest
    || normalized.deployment_env !== expected.deployment_env
    || (expected.host && normalized.canonical_host !== expected.host)
    || (expected.slug && slug !== expected.slug)
    || (expected.site_id && normalized.site_id !== expected.site_id)
    || (expected.release_id && normalized.release_id !== expected.release_id)
    || (expected.build_hash && normalized.build_hash !== expected.build_hash)) {
    refuse(503, "provider_identity_mismatch");
  }
  return normalized;
}

async function resolvePublic(input, config, fetchImpl) {
  const raw = await rpc(config, "resolve_shared_site", {
    p_slug: null,
    p_host: input.host,
    p_deployment_env: input.deployment_env,
  }, fetchImpl);
  return normalizeResolverRow(raw, input, "public");
}

async function resolvePreview(input, config, fetchImpl) {
  const raw = await rpc(config, "resolve_shared_site_preview", {
    p_site_id: input.site_id,
    p_release_id: input.release_id,
    p_build_hash: input.build_hash,
    p_slug: input.slug,
    p_deployment_env: input.deployment_env,
  }, fetchImpl);
  return normalizeResolverRow(raw, input, "preview");
}

function publicResolverData(row) {
  if (!row) return null;
  return {
    site_id: row.site_id,
    release_id: row.release_id,
    build_hash: row.build_hash,
    canonical_host: row.canonical_host,
    generation: row.generation,
    manifest_path: row.manifest_path,
    manifest_sha256: row.manifest_sha256,
    deployment_env: row.deployment_env,
  };
}

async function consumePreview(input, config, fetchImpl) {
  const raw = await rpc(config, "consume_site_preview_grant", {
    p_jti_hash: input.jti_hash,
    p_site_id: input.site_id,
    p_release_id: input.release_id,
    p_build_hash: input.build_hash,
    p_deployment_env: input.deployment_env,
  }, fetchImpl);
  const result = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (!isPlainObject(result)) refuse(503, "provider_invalid_response");
  if (result.ok !== true) refuse(409, "preview_not_consumed");
  const expectedKeys = [
    "ok", "site_id", "release_id", "build_hash", "deployment_env", "manifest_path", "slug",
  ].sort();
  const resultKeys = Object.keys(result).sort();
  if (resultKeys.length !== expectedKeys.length || resultKeys.some((key, index) => key !== expectedKeys[index])) {
    refuse(503, "provider_invalid_response");
  }
  const expectedManifest = expectedManifestPath(input.site_id, input.release_id);
  if (result.site_id !== input.site_id || result.release_id !== input.release_id
    || result.build_hash !== input.build_hash || result.deployment_env !== input.deployment_env
    || result.manifest_path !== expectedManifest || result.slug !== input.slug) {
    refuse(503, "provider_identity_mismatch");
  }
  return {
    ok: true,
    site_id: input.site_id,
    release_id: input.release_id,
    build_hash: input.build_hash,
    slug: input.slug,
    deployment_env: input.deployment_env,
  };
}

function encodedObjectPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function exactSignedUrl(raw, config, objectPath) {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 1 || typeof raw.signedURL !== "string") {
    refuse(503, "provider_invalid_response");
  }
  const encoded = encodedObjectPath(objectPath);
  // Storage's REST response is deliberately relative to its `/storage/v1`
  // API root (`/object/sign/<bucket>/<path>?token=...`). storage-js applies
  // that prefix client-side too. Requiring the already-prefixed public path
  // here rejected every valid signed-object response in production.
  const expectedProviderPath = `/object/sign/${RELEASE_BUCKET}/${encoded}`;
  const expectedPublicPath = `/storage/v1${expectedProviderPath}`;
  const allowedRawPrefixes = [
    `${expectedProviderPath}?`,
    `${expectedPublicPath}?`,
    `${config.baseUrl}${expectedProviderPath}?`,
    `${config.baseUrl}${expectedPublicPath}?`,
  ];
  if (!allowedRawPrefixes.some((prefix) => raw.signedURL.startsWith(prefix))) {
    refuse(503, "provider_identity_mismatch");
  }
  let suppliedUrl;
  try {
    suppliedUrl = new URL(raw.signedURL, config.baseUrl);
  } catch (_) {
    refuse(503, "provider_invalid_response");
  }
  if (suppliedUrl.origin !== config.baseUrl || suppliedUrl.username || suppliedUrl.password || suppliedUrl.hash
    || (suppliedUrl.pathname !== expectedProviderPath && suppliedUrl.pathname !== expectedPublicPath)
    || !suppliedUrl.searchParams.get("token")) {
    refuse(503, "provider_identity_mismatch");
  }
  const queryKeys = [...suppliedUrl.searchParams.keys()];
  if (queryKeys.length !== 1 || queryKeys[0] !== "token") refuse(503, "provider_identity_mismatch");
  const url = new URL(`${expectedPublicPath}${suppliedUrl.search}`, config.baseUrl);
  return url.toString();
}

async function signObject(input, config, fetchImpl, nowSeconds) {
  const resolved = input.mode === "public"
    ? await resolvePublic(input, config, fetchImpl)
    : await resolvePreview(input, config, fetchImpl);
  if (!resolved) refuse(404, "release_not_found");
  if (resolved.site_id !== input.site_id || resolved.release_id !== input.release_id
    || resolved.build_hash !== input.build_hash || resolved.deployment_env !== input.deployment_env
    || !isReleaseObjectPath(input.object_path, input.site_id, input.release_id, resolved.manifest_path)) {
    refuse(403, "release_mismatch");
  }
  const encoded = encodedObjectPath(input.object_path);
  const raw = await providerJson(
    `${config.baseUrl}/storage/v1/object/sign/${RELEASE_BUCKET}/${encoded}`,
    {
      method: "POST",
      headers: serviceHeaders(config.key),
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
    },
    fetchImpl,
  );
  return {
    signed_url: exactSignedUrl(raw, config, input.object_path),
    expires_at: nowSeconds + SIGNED_URL_TTL_SECONDS,
  };
}

function publicError(error) {
  if (error instanceof ProxyError) return { status: error.status, body: { ok: false, error: error.code } };
  return { status: 500, body: { ok: false, error: "internal_error" } };
}

async function handleProxyRequest({ method, headers, rawBody, env = process.env, fetchImpl = global.fetch, nowSeconds } = {}) {
  try {
    if (method !== "POST") refuse(405, "method_not_allowed");
    if (!Buffer.isBuffer(rawBody) && !(rawBody instanceof Uint8Array)) refuse(400, "raw_body_required");
    if (rawBody.byteLength > MAX_BODY_BYTES) refuse(413, "payload_too_large");
    const now = verifyHmac({ headers, rawBody, env, nowSeconds });
    const envelope = parseJsonWithoutDuplicates(rawBody);
    exactKeys(envelope, ["operation", "input"]);
    if (typeof envelope.operation !== "string") refuse(400, "invalid_request");
    const allowed = ensureLaneEnabled(env);
    const input = validateInput(envelope.operation, envelope.input, env, allowed);
    const config = serviceConfig(env);

    let data;
    if (envelope.operation === "resolve_public") {
      const row = await resolvePublic(input, config, fetchImpl);
      if (row) ensureAllowed(allowed, row.site_id, input.slug);
      else if (!allowed.has("*") && !allowed.has(input.slug)) refuse(403, "site_not_allowed");
      data = publicResolverData(row);
    }
    else if (envelope.operation === "resolve_preview") data = publicResolverData(await resolvePreview(input, config, fetchImpl));
    else if (envelope.operation === "consume_preview") data = await consumePreview(input, config, fetchImpl);
    else if (envelope.operation === "sign_object") data = await signObject(input, config, fetchImpl, now);
    else refuse(400, "unknown_operation");
    return { status: 200, body: { ok: true, operation: envelope.operation, data } };
  } catch (error) {
    return publicError(error);
  }
}

async function readBoundedRawBody(req, maxBytes = MAX_BODY_BYTES) {
  if (typeof req?.on !== "function") {
    if (Buffer.isBuffer(req?.body) || req?.body instanceof Uint8Array) {
      const body = Buffer.from(req.body);
      if (body.length > maxBytes) refuse(413, "payload_too_large");
      return body;
    }
    refuse(400, "raw_body_required");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        fail(new ProxyError(400, "raw_body_required"));
        req.destroy?.();
        return;
      }
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        fail(new ProxyError(413, "payload_too_large"));
        req.destroy?.();
        return;
      }
      chunks.push(bytes);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", fail);
  });
}

module.exports = {
  MAX_BODY_BYTES,
  PROXY_SECRET_ENV,
  RELEASE_BUCKET,
  SIGNATURE_TOLERANCE_SECONDS,
  SIGNED_URL_TTL_SECONDS,
  ProxyError,
  handleProxyRequest,
  parseJsonWithoutDuplicates,
  publicError,
  readBoundedRawBody,
};
