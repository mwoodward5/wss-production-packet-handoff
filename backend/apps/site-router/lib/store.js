"use strict";

const crypto = require("node:crypto");
const { unavailable } = require("./errors");
const { MAX_ASSET_BYTES, MAX_MANIFEST_BYTES } = require("./constants");
const { sharedSiteEnvironment } = require("./environment");
const { canonicalFilePath } = require("./path");

const PROXY_BODY_LIMIT = 8192;
const PROXY_RESPONSE_LIMIT = 64 * 1024;
const SIGNED_URL_MAX_SECONDS = 120;
const DIRECT_PROVIDER_ENV_NAMES = Object.freeze([
  "WSS_SITE_ROUTER_SUPABASE_URL",
  "WSS_SITE_ROUTER_API_KEY",
  "WSS_SITE_ROUTER_RPC_TOKEN",
  "WSS_SITE_ROUTER_STORAGE_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY"
]);
const RISKY_SUPABASE_ENV_KIND = /(?:^|_)(?:URL|URI|DSN|KEY|TOKEN|SECRET|PASSWORD|PASS|DB|DATABASE|CONNECTION|CREDENTIALS?)(?:_|$)/;

function directProviderConfiguration(env = {}) {
  const configured = new Set(DIRECT_PROVIDER_ENV_NAMES.filter(
    (name) => typeof env[name] === "string" && env[name] !== ""
  ));
  for (const name of Object.keys(env || {})) {
    const upper = String(name).toUpperCase();
    if (upper.includes("SUPABASE")
        && RISKY_SUPABASE_ENV_KIND.test(upper)
        && typeof env[name] === "string"
        && env[name] !== "") {
      configured.add(name);
    }
  }
  return [...configured];
}

const REQUIRED_METHODS = Object.freeze([
  "resolvePublicHost",
  "resolvePreviewRelease",
  "readManifest",
  "openAsset",
  "consumePreviewGrant"
]);

/*
Router adapter contract (all calls receive an AbortSignal):

resolvePublicHost(host, { signal }) -> releaseRef | null
resolvePreviewRelease(sessionClaims, { signal }) -> releaseRef | null
readManifest(releaseRef, { signal }) -> { body: complete Buffer }
openAsset(releaseRef, file, { signal }) ->
  { body: complete Buffer | ReadableStream, size?, contentType? }
consumePreviewGrant(grantClaims, { signal }) -> true | false

Production uses one backend HMAC proxy. The router holds no Supabase URL, API
key, database JWT, storage token, or service-role credential. Each proxy POST
is JSON `{operation,input}` and is authenticated by:

  x-wss-timestamp: <integer Unix seconds>
  x-wss-signature: HMAC-SHA256(secret, `${timestamp}.${rawBody}`)

The backend returns `{ok:true,operation,data}`. Resolver data is the exact
snake_case immutable row. sign_object returns an HTTPS private-object URL that
expires in at most 120 seconds. The router fetches the complete object without
Range, buffers at most 64 MiB, then site-handler proves manifest length/SHA-256
before emitting any representation metadata or bytes.
*/

function assertStore(store) {
  if (!store || typeof store !== "object") throw unavailable("store_not_configured");
  for (const method of REQUIRED_METHODS) {
    if (typeof store[method] !== "function") throw unavailable("store_not_configured");
  }
  return store;
}

function createUnavailableStore() {
  const fail = async () => {
    throw unavailable("store_not_configured");
  };
  return Object.freeze({
    isReady: () => false,
    resolvePublicHost: fail,
    resolvePreviewRelease: fail,
    readManifest: fail,
    openAsset: fail,
    consumePreviewGrant: fail
  });
}

function exactProxyUrl(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname === "/" || url.pathname.endsWith("/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function strongProxySecret(value) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const bytes = Buffer.byteLength(value, "utf8");
  return bytes >= 32 && bytes <= 512 ? value : null;
}

async function responseBytes(response, limit, signal) {
  const rawLength = response.headers && response.headers.get("content-length");
  if (rawLength != null) {
    const length = Number(rawLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > limit) {
      throw unavailable("upstream_body_size_refused");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw unavailable("upstream_body_size_refused");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let seen = 0;
  try {
    while (true) {
      if (signal && signal.aborted) throw unavailable("upstream_read_aborted");
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      seen += bytes.length;
      if (seen > limit) {
        await reader.cancel();
        throw unavailable("upstream_body_size_refused");
      }
      chunks.push(bytes);
    }
  } finally {
    if (typeof reader.releaseLock === "function") reader.releaseLock();
  }
  return Buffer.concat(chunks, seen);
}

function releaseFromProxy(value, environment, access = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.deployment_env !== environment) return null;
  const routeGeneration = typeof value.generation === "string" ? Number(value.generation) : value.generation;
  const base = {
    siteId: value.site_id,
    releaseId: value.release_id,
    buildHash: value.build_hash,
    canonicalHost: value.canonical_host,
    routeGeneration,
    manifestKey: value.manifest_path,
    manifestSha256: value.manifest_sha256
  };
  if (access.mode === "public") {
    return { ...base, accessMode: "public", resolverHost: access.host };
  }
  if (access.mode === "preview") {
    return { ...base, accessMode: "preview", resolverSlug: access.slug };
  }
  return base;
}

function signedObjectUrl(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!Number.isSafeInteger(value.expires_at)
      || value.expires_at <= now
      || value.expires_at > now + SIGNED_URL_MAX_SECONDS) return null;
  if (typeof value.signed_url !== "string" || value.signed_url !== value.signed_url.trim()) return null;
  try {
    const url = new URL(value.signed_url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function exactObjectAccess(release, objectPath, environment) {
  if (!release || typeof release !== "object") return null;
  const prefix = `sites/${release.siteId}/releases/${release.releaseId}/`;
  const manifest = `${prefix}manifest.json`;
  const filePrefix = `${prefix}files/`;
  const filePath = String(objectPath).startsWith(filePrefix)
    ? String(objectPath).slice(filePrefix.length)
    : "";
  if (objectPath !== manifest && (!filePath || canonicalFilePath(filePath) !== filePath)) return null;
  const base = {
    site_id: release.siteId,
    release_id: release.releaseId,
    build_hash: release.buildHash,
    deployment_env: environment,
    mode: release.accessMode,
    object_path: objectPath
  };
  if (release.accessMode === "public" && release.resolverHost === release.canonicalHost) {
    return { ...base, host: release.resolverHost };
  }
  if (release.accessMode === "preview"
      && typeof release.resolverSlug === "string"
      && `${release.resolverSlug}.wss-ai.com` === release.canonicalHost) {
    return { ...base, slug: release.resolverSlug };
  }
  return null;
}

function createProductionStore({
  env = process.env,
  fetchImpl = globalThis.fetch,
  nowSeconds = () => Math.floor(Date.now() / 1000)
} = {}) {
  const environment = sharedSiteEnvironment(env);
  const proxyUrlValue = env.WSS_SHARED_SITE_PROXY_URL;
  const proxySecretValue = env.WSS_SHARED_SITE_ROUTER_PROXY_SECRET;
  const proxyConfigured = [proxyUrlValue, proxySecretValue]
    .filter((value) => typeof value === "string" && value !== "").length;
  const directConfigured = directProviderConfiguration(env);

  if (directConfigured.length) throw new Error("site_router_direct_provider_credentials_refused");
  if (proxyConfigured === 0) return createUnavailableStore();
  if (proxyConfigured !== 2) throw new Error("site_router_proxy_configuration_incomplete");
  if (!environment) throw new Error("shared_site_environment_missing");
  if (typeof fetchImpl !== "function") throw new Error("site_router_fetch_missing");

  const proxyUrl = exactProxyUrl(proxyUrlValue);
  if (!proxyUrl) throw new Error("site_router_proxy_url_invalid");
  const proxySecret = strongProxySecret(proxySecretValue);
  if (!proxySecret) throw new Error("site_router_proxy_secret_weak");

  async function proxy(operation, input, signal) {
    const rawBody = JSON.stringify({ operation, input });
    if (Buffer.byteLength(rawBody, "utf8") > PROXY_BODY_LIMIT) {
      throw unavailable("proxy_request_size_refused");
    }
    const timestamp = nowSeconds();
    if (!Number.isSafeInteger(timestamp) || timestamp < 1) throw unavailable("proxy_clock_invalid");
    const signature = crypto.createHmac("sha256", proxySecret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");
    const response = await fetchImpl(proxyUrl, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-wss-signature": signature,
        "x-wss-timestamp": String(timestamp)
      },
      body: rawBody
    });
    const bytes = await responseBytes(response, PROXY_RESPONSE_LIMIT, signal);
    if (response.status !== 200) throw unavailable("shared_site_proxy_failed");
    let envelope;
    try {
      envelope = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw unavailable("shared_site_proxy_invalid_json");
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
        || envelope.ok !== true || envelope.operation !== operation
        || !Object.prototype.hasOwnProperty.call(envelope, "data")) {
      throw unavailable("shared_site_proxy_invalid_response");
    }
    return envelope.data;
  }

  async function objectResponse(release, key, signal) {
    const input = exactObjectAccess(release, key, environment);
    if (!input) throw unavailable("immutable_object_access_refused");
    const signed = await proxy("sign_object", input, signal);
    const url = signedObjectUrl(signed, nowSeconds());
    if (!url) throw unavailable("signed_object_url_invalid");
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { "accept-encoding": "identity" }
    });
    if (response.status !== 200) throw unavailable("immutable_object_read_failed");
    return response;
  }

  return Object.freeze({
    // This is a local configuration readiness signal. It deliberately does
    // not call the backend proxy, so a public health probe cannot create an
    // unbounded resolver workload. The one-site canary proves the complete
    // proxy, registry, storage, and response-identity path before rollout.
    isReady: () => true,
    async resolvePublicHost(host, { signal } = {}) {
      const data = await proxy("resolve_public", {
        host,
        deployment_env: environment
      }, signal);
      if (data == null) return null;
      return releaseFromProxy(data, environment, { mode: "public", host });
    },
    async resolvePreviewRelease(session, { signal } = {}) {
      const data = await proxy("resolve_preview", {
        site_id: session.site_id,
        release_id: session.release_id,
        build_hash: session.build_hash,
        slug: session.slug,
        deployment_env: environment
      }, signal);
      if (data == null) return null;
      return releaseFromProxy(data, environment, { mode: "preview", slug: session.slug });
    },
    async readManifest(release, { signal } = {}) {
      const response = await objectResponse(release, release.manifestKey, signal);
      return { body: await responseBytes(response, MAX_MANIFEST_BYTES, signal) };
    },
    async openAsset(release, file, { signal } = {}) {
      const response = await objectResponse(release, file.key, signal);
      const rawLength = response.headers.get("content-length");
      const size = rawLength == null ? undefined : Number(rawLength);
      if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > MAX_ASSET_BYTES)) {
        throw unavailable("asset_size_refused");
      }
      return {
        body: response.body || await responseBytes(response, MAX_ASSET_BYTES, signal),
        size,
        contentType: response.headers.get("content-type") || undefined
      };
    },
    async consumePreviewGrant(grant, { signal } = {}) {
      const jtiHash = crypto.createHash("sha256").update(grant.jti, "utf8").digest("hex");
      const data = await proxy("consume_preview", {
        jti_hash: jtiHash,
        site_id: grant.site_id,
        release_id: grant.release_id,
        build_hash: grant.build_hash,
        slug: grant.slug,
        deployment_env: environment
      }, signal);
      return Boolean(data && typeof data === "object" && !Array.isArray(data)
        && data.ok === true
        && data.site_id === grant.site_id
        && data.release_id === grant.release_id
        && data.build_hash === grant.build_hash
        && data.slug === grant.slug
        && data.deployment_env === environment);
    }
  });
}

module.exports = {
  DIRECT_PROVIDER_ENV_NAMES,
  PROXY_BODY_LIMIT,
  REQUIRED_METHODS,
  SIGNED_URL_MAX_SECONDS,
  assertStore,
  createProductionStore,
  createUnavailableStore,
  exactObjectAccess,
  exactProxyUrl,
  releaseFromProxy,
  responseBytes,
  signedObjectUrl,
  strongProxySecret
};
