"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { Writable } = require("node:stream");

const SITE_ID = "site_01HQTEST";
const RELEASE_ID = "release_01HQTEST";
const BUILD_HASH = "b".repeat(64);
const HOST = "honest-fence.wss-ai.com";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = new Map();
    this.chunks = [];
    this.headersSent = false;
    this.on("error", () => {});
  }

  _write(chunk, _encoding, callback) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  end(chunk, encoding, callback) {
    this.headersSent = true;
    return super.end(chunk, encoding, callback);
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value);
  }

  getHeader(name) {
    return this.headers.get(String(name).toLowerCase());
  }

  hasHeader(name) {
    return this.headers.has(String(name).toLowerCase());
  }

  removeHeader(name) {
    this.headers.delete(String(name).toLowerCase());
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function request({
  body,
  cookie,
  headers = {},
  host = HOST,
  method = "GET",
  path = "/",
  rewrittenPath
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = path;
  req.headers = { host, ...headers };
  if (cookie !== undefined) req.headers.cookie = cookie;
  req.query = rewrittenPath === undefined ? {} : { __wss_path: rewrittenPath };
  if (body !== undefined) req.body = body;
  return req;
}

function fixture({
  routes,
  bodies,
  host = HOST,
  siteId = SITE_ID,
  releaseId = RELEASE_ID,
  buildHash = BUILD_HASH,
  routeGeneration = 7,
  manifestRouteGeneration = routeGeneration
} = {}) {
  const assetBodies = bodies || {
    "index.html": Buffer.from("<!doctype html><h1>Honest Fence</h1>"),
    "assets/app.css": Buffer.from("body{color:#123}")
  };
  const files = {};
  for (const [filePath, body] of Object.entries(assetBodies)) {
    files[filePath] = {
      key: `sites/${siteId}/releases/${releaseId}/files/${filePath}`,
      sha256: sha256(body),
      bytes: body.length,
      mime: filePath.endsWith(".html") ? "text/html; charset=utf-8" : "text/css; charset=utf-8"
    };
  }
  const manifest = {
    schema: "wss-site-release/v1",
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
    canonical_host: host,
    route_generation: manifestRouteGeneration,
    routes: routes || {
      "/": "index.html",
      "/assets/app.css": "assets/app.css"
    },
    files
  };
  const manifestBody = Buffer.from(JSON.stringify(manifest));
  const release = {
    siteId,
    releaseId,
    buildHash,
    canonicalHost: host,
    routeGeneration,
    manifestKey: `sites/${siteId}/releases/${releaseId}/manifest.json`,
    manifestSha256: sha256(manifestBody)
  };
  const calls = {
    consumePreviewGrant: 0,
    openAsset: 0,
    readManifest: 0,
    resolvePreviewRelease: 0,
    resolvePublicHost: 0
  };
  const store = {
    async resolvePublicHost(requestHost) {
      calls.resolvePublicHost += 1;
      return requestHost === host ? release : null;
    },
    async resolvePreviewRelease() {
      calls.resolvePreviewRelease += 1;
      return release;
    },
    async readManifest() {
      calls.readManifest += 1;
      return { body: manifestBody };
    },
    async openAsset(_release, file, options) {
      calls.openAsset += 1;
      const whole = assetBodies[file.filePath];
      const body = options.start === undefined
        ? whole
        : whole.subarray(options.start, options.end + 1);
      return {
        body,
        size: file.bytes,
        contentType: file.mime,
        sha256: file.sha256
      };
    },
    async consumePreviewGrant() {
      calls.consumePreviewGrant += 1;
      return true;
    }
  };
  return { assetBodies, calls, files, host, manifest, manifestBody, release, store };
}

module.exports = {
  BUILD_HASH,
  HOST,
  MockResponse,
  RELEASE_ID,
  SITE_ID,
  fixture,
  request,
  sha256
};
