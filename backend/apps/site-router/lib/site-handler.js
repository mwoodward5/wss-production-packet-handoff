"use strict";

const { notFound, unavailable } = require("./errors");
const { siteHostFromRequest } = require("./host");
const { canonicalRoutePath, requestRoutePath } = require("./path");
const { parseSingleRange } = require("./range");
const { parseAndValidateManifest, validReleaseRef } = require("./manifest");
const { previewCookieState } = require("./cookies");
const { signingSecret, verifyPreviewSession } = require("./token");
const { sharedSiteEnvironment } = require("./environment");
const { setIdentityHeaders, setNoStore } = require("./headers");
const { requestAbortScope } = require("./abort");
const { fail, methodNotAllowed } = require("./response");
const { verifiedBody, writeVerifiedResponse } = require("./stream");
const { assertStore } = require("./store");

function etagMatches(header, etag) {
  if (typeof header !== "string") return false;
  return header.split(",").some((part) => {
    const candidate = part.trim();
    return candidate === "*" || candidate === etag || candidate === `W/${etag}`;
  });
}

function exactAssetIntegrityMetadata(result, file) {
  if (!result || typeof result !== "object" || result.body == null) return false;
  if (result.size !== undefined && result.size !== file.bytes) return false;
  // Storage transport MIME may be rewritten or normalized. The SHA-256-
  // attested manifest controls response MIME.
  if (result.sha256 !== undefined && result.sha256 !== file.sha256) return false;
  return true;
}

function setRepresentationHeaders(res, release, file, etag) {
  setIdentityHeaders(res, release);
  res.setHeader("ETag", etag);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", file.mime);
}

function createSiteHandler({
  store,
  env = process.env,
  nowSeconds = () => Math.floor(Date.now() / 1000)
}) {
  // A conflicting legacy environment is a startup error, not a per-request
  // fallback. Missing canonical environment only disables preview operations.
  const deploymentEnv = sharedSiteEnvironment(env);
  return async function siteHandler(req, res) {
    setNoStore(res);
    const abortScope = requestAbortScope(req, res);
    let preview = false;
    try {
      const siteHost = siteHostFromRequest(req);
      if (!siteHost) throw notFound();

      const rawRoute = requestRoutePath(req);
      const routePath = canonicalRoutePath(rawRoute);
      if (!routePath) throw notFound();

      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        methodNotAllowed(res, ["GET", "HEAD"]);
        return;
      }

      const checkedStore = assertStore(store);
      const cookie = previewCookieState(req);
      let releaseCandidate;
      let session = null;
      if (cookie.present) {
        const secret = signingSecret(env);
        if (!secret || !deploymentEnv) throw unavailable("preview_not_configured");
        session = cookie.value && verifyPreviewSession(cookie.value, {
          env: deploymentEnv,
          nowSeconds: nowSeconds(),
          secret
        });
        if (!session || session.slug !== siteHost.slug) throw notFound();
        preview = true;
        setNoStore(res, { preview: true });
        releaseCandidate = await checkedStore.resolvePreviewRelease(session, {
          signal: abortScope.signal
        });
      } else {
        releaseCandidate = await checkedStore.resolvePublicHost(siteHost.host, {
          signal: abortScope.signal
        });
      }
      if (!releaseCandidate) throw notFound();

      const release = validReleaseRef(releaseCandidate, siteHost.host, {
        allowZeroGeneration: preview
      });
      if (!release) throw unavailable("invalid_release_reference");
      if (session && (session.site_id !== release.siteId
          || session.release_id !== release.releaseId
          || session.build_hash !== release.buildHash)) {
        throw notFound();
      }

      const manifestResult = await checkedStore.readManifest(release, {
        signal: abortScope.signal
      });
      const manifest = parseAndValidateManifest(manifestResult, release);
      const filePath = manifest.routes[routePath];
      if (!filePath) throw notFound();
      const file = manifest.files[filePath];
      const etag = `"${file.sha256}"`;
      const notModified = etagMatches(req.headers && req.headers["if-none-match"], etag);

      const rangeHeader = req.headers && req.headers.range;
      let range = null;
      let rangeInvalid = false;
      // RFC 9110 defines Range for GET. HEAD must describe the complete GET
      // representation, and extension range units we do not implement are
      // ignored rather than mislabeled as an unsatisfied byte range.
      const byteRangeRequested = typeof rangeHeader === "string"
        && /^bytes=/i.test(rangeHeader.trim());
      if (!notModified && method === "GET" && byteRangeRequested) {
        const ifRange = req.headers && req.headers["if-range"];
        if (!ifRange || ifRange === etag) {
          range = parseSingleRange(rangeHeader, file.bytes);
          rangeInvalid = !range;
        }
      }

      // Always fetch the complete immutable object. A range request is sliced
      // only after the full length and SHA-256 are proven in memory. No body or
      // identity, conditional, range, or representation header is emitted
      // before this proof succeeds. HEAD/304/416 prove the same bytes as GET;
      // v1 chooses correctness over the extra object read.
      const assetResult = await checkedStore.openAsset(release, file, {
        signal: abortScope.signal
      });
      if (!exactAssetIntegrityMetadata(assetResult, file)) throw unavailable("asset_metadata_mismatch");
      const wholeBody = await verifiedBody(assetResult.body, {
        expectedLength: file.bytes,
        expectedSha256: file.sha256,
        signal: abortScope.signal
      });

      if (notModified) {
        setRepresentationHeaders(res, release, file, etag);
        res.statusCode = 304;
        res.removeHeader("Content-Type");
        res.removeHeader("Content-Length");
        res.end();
        return;
      }

      if (rangeInvalid) {
        setRepresentationHeaders(res, release, file, etag);
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${file.bytes}`);
        res.setHeader("Content-Length", "0");
        res.end();
        return;
      }

      if (method === "HEAD") {
        setRepresentationHeaders(res, release, file, etag);
        const expectedLength = range ? range.length : file.bytes;
        res.statusCode = range ? 206 : 200;
        res.setHeader("Content-Length", String(expectedLength));
        if (range) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.bytes}`);
        res.end();
        return;
      }

      const responseBody = range
        ? wholeBody.subarray(range.start, range.end + 1)
        : wholeBody;

      setRepresentationHeaders(res, release, file, etag);
      res.statusCode = range ? 206 : 200;
      res.setHeader("Content-Length", String(responseBody.length));
      if (range) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.bytes}`);
      await writeVerifiedResponse(res, responseBody, { signal: abortScope.signal });
    } catch (error) {
      fail(res, error, { preview });
    } finally {
      abortScope.cleanup();
    }
  };
}

module.exports = { createSiteHandler, etagMatches };
