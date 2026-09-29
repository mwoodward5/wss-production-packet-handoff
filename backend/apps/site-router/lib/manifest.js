"use strict";

const crypto = require("node:crypto");
const {
  MANIFEST_SCHEMA,
  MAX_ASSET_BYTES,
  MAX_MANIFEST_BYTES
} = require("./constants");
const { canonicalFilePath, canonicalRoutePath } = require("./path");
const { unavailable } = require("./errors");

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:; ?charset=[a-z0-9_-]+)?$/i;

function validReleaseRef(value, expectedHost, { allowZeroGeneration = false } = {}) {
  if (!value || typeof value !== "object") return null;
  const ref = {
    siteId: value.siteId,
    releaseId: value.releaseId,
    buildHash: value.buildHash,
    canonicalHost: value.canonicalHost,
    routeGeneration: value.routeGeneration,
    manifestKey: value.manifestKey,
    manifestSha256: value.manifestSha256
  };
  if (!SAFE_ID.test(ref.siteId || "") || !SAFE_ID.test(ref.releaseId || "")) return null;
  if (!SHA256.test(ref.buildHash || "") || !SHA256.test(ref.manifestSha256 || "")) return null;
  if (ref.canonicalHost !== expectedHost) return null;
  if (!Number.isSafeInteger(ref.routeGeneration)
      || ref.routeGeneration < (allowZeroGeneration ? 0 : 1)) return null;
  const expectedManifestKey = `sites/${ref.siteId}/releases/${ref.releaseId}/manifest.json`;
  if (ref.manifestKey !== expectedManifestKey) return null;
  // Production object reads go through the backend HMAC proxy. Preserve only
  // the locally-attested resolver context needed for that proxy to re-resolve
  // the same tuple before issuing a short-lived object URL. Test adapters may
  // omit it; the production store then fails closed if asked to read bytes.
  if (value.accessMode !== undefined || value.resolverHost !== undefined || value.resolverSlug !== undefined) {
    if (value.accessMode === "public"
        && value.resolverHost === expectedHost
        && value.resolverSlug === undefined) {
      ref.accessMode = "public";
      ref.resolverHost = value.resolverHost;
    } else if (value.accessMode === "preview"
        && typeof value.resolverSlug === "string"
        && `${value.resolverSlug}.wss-ai.com` === expectedHost
        && value.resolverHost === undefined) {
      ref.accessMode = "preview";
      ref.resolverSlug = value.resolverSlug;
    } else {
      return null;
    }
  }
  return Object.freeze(ref);
}

function manifestBytes(result) {
  const body = result && Object.prototype.hasOwnProperty.call(result, "body") ? result.body : result;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return null;
}

function parseAndValidateManifest(result, release) {
  const bytes = manifestBytes(result);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_MANIFEST_BYTES) {
    throw unavailable("invalid_release_manifest");
  }
  const actualSha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (actualSha !== release.manifestSha256) throw unavailable("manifest_integrity_mismatch");

  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw unavailable("invalid_release_manifest");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw unavailable("invalid_release_manifest");
  }
  if (manifest.schema !== MANIFEST_SCHEMA
      || manifest.site_id !== release.siteId
      || manifest.release_id !== release.releaseId
      || manifest.build_hash !== release.buildHash
      || manifest.canonical_host !== release.canonicalHost
      // This is immutable release history, not the mutable resolver pointer.
      // Rollback A -> B -> A must keep A's manifest intact while the response
      // header reports the resolver's new generation.
      || !Number.isSafeInteger(manifest.route_generation)
      || manifest.route_generation < 1) {
    throw unavailable("manifest_identity_mismatch");
  }
  if (!plainRecord(manifest.routes) || !plainRecord(manifest.files)) {
    throw unavailable("invalid_release_manifest");
  }

  const files = Object.create(null);
  const fileEntries = Object.entries(manifest.files);
  const routeEntries = Object.entries(manifest.routes);
  if (fileEntries.length === 0 || fileEntries.length > 10000 || routeEntries.length === 0 || routeEntries.length > 10000) {
    throw unavailable("invalid_release_manifest");
  }

  for (const [filePath, metadata] of fileEntries) {
    const canonical = canonicalFilePath(filePath);
    if (canonical !== filePath || !plainRecord(metadata)) throw unavailable("invalid_release_manifest");
    const expectedKey = `sites/${release.siteId}/releases/${release.releaseId}/files/${filePath}`;
    if (metadata.key !== expectedKey
        || !SHA256.test(metadata.sha256 || "")
        || !Number.isSafeInteger(metadata.bytes)
        || metadata.bytes < 0
        || metadata.bytes > MAX_ASSET_BYTES
        || typeof metadata.mime !== "string"
        || metadata.mime.length > 128
        || !MIME.test(metadata.mime)) {
      throw unavailable("invalid_release_manifest");
    }
    files[filePath] = Object.freeze({
      filePath,
      key: metadata.key,
      sha256: metadata.sha256,
      bytes: metadata.bytes,
      mime: metadata.mime
    });
  }

  const routes = Object.create(null);
  for (const [routePath, filePath] of routeEntries) {
    if (canonicalRoutePath(routePath) !== routePath
        || canonicalFilePath(filePath) !== filePath
        || !Object.prototype.hasOwnProperty.call(files, filePath)) {
      throw unavailable("invalid_release_manifest");
    }
    routes[routePath] = filePath;
  }

  return Object.freeze({ files: Object.freeze(files), routes: Object.freeze(routes) });
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = { parseAndValidateManifest, validReleaseRef };
