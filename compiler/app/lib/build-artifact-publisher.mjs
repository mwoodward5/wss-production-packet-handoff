import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PREFIX = "sf/contract-builds/artifacts";
const REQUIRED_ARTIFACTS = ["index.html", "optimization-manifest.json"];
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
};

export class ArtifactPublisherUnavailableError extends Error {
  constructor(message = "Public artifact publishing is unavailable", { code = "ARTIFACT_PUBLISHER_UNAVAILABLE", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ArtifactPublisherUnavailableError";
    this.code = code;
    this.status = 503;
  }
}

export function createBuildArtifactPublisher(options = {}) {
  const env = options.env ?? process.env;
  const token = options.token ?? env.BLOB_READ_WRITE_TOKEN ?? null;
  const prefix = normalizePrefix(options.prefix ?? DEFAULT_PREFIX);
  let clientPromise;

  function assertAvailable() {
    if (!token && !options.blobClient) throw new ArtifactPublisherUnavailableError();
  }

  async function client() {
    assertAvailable();
    if (!clientPromise) {
      clientPromise = Promise.resolve(options.blobClient ?? (options.sdkLoader ? options.sdkLoader() : import("@vercel/blob")))
        .then((value) => {
          if (typeof value?.put !== "function") {
            throw new ArtifactPublisherUnavailableError("Artifact Blob client is missing put()", { code: "ARTIFACT_BLOB_CLIENT_INVALID" });
          }
          return value;
        });
    }
    return clientPromise;
  }

  return {
    assertAvailable,
    async publishBundle({ buildId, outDir }) {
      assertAvailable();
      const artifacts = await collectArtifacts(outDir);
      const blob = await client();
      const root = `${prefix}/${safeBuildId(buildId)}`;
      const files = {};
      try {
        await Promise.all(artifacts.map(async ({ absolute, relative }) => {
          const pathname = `${root}/${relative}`;
          const result = await blob.put(pathname, await readFile(absolute), {
            access: "public",
            ...(token ? { token } : {}),
            addRandomSuffix: false,
            allowOverwrite: false,
            contentType: MIME[path.extname(relative).toLowerCase()] || "application/octet-stream",
            cacheControlMaxAge: 31536000,
          });
          if (result?.pathname !== pathname || !isHttpUrl(result?.url)) {
            throw new ArtifactPublisherUnavailableError("Artifact upload was not confirmed", { code: "ARTIFACT_UPLOAD_UNCONFIRMED" });
          }
          files[relative] = new URL(result.url).href;
        }));
      } catch (cause) {
        if (cause instanceof ArtifactPublisherUnavailableError) throw cause;
        throw new ArtifactPublisherUnavailableError("Artifact bundle upload failed", { code: "ARTIFACT_UPLOAD_FAILED", cause });
      }
      return publishedResult(buildId, files);
    },
  };
}

export function createMemoryArtifactPublisher({ baseUrl = "https://artifacts.example.test/", fail = null } = {}) {
  const bundles = new Map();
  return {
    assertAvailable() {
      if (fail) throw fail;
    },
    async publishBundle({ buildId, outDir }) {
      if (fail) throw fail;
      const artifacts = await collectArtifacts(outDir);
      const files = {};
      const bodies = {};
      for (const artifact of artifacts) {
        files[artifact.relative] = new URL(`${safeBuildId(buildId)}/${artifact.relative}`, ensureTrailingSlash(baseUrl)).href;
        bodies[artifact.relative] = await readFile(artifact.absolute);
      }
      bundles.set(buildId, bodies);
      return publishedResult(buildId, files);
    },
    bundles,
  };
}

async function collectArtifacts(outDir) {
  const root = path.resolve(String(outDir || ""));
  let info;
  try { info = await stat(root); } catch (cause) {
    throw new ArtifactPublisherUnavailableError("Artifact output directory is unavailable", { code: "ARTIFACT_DIRECTORY_MISSING", cause });
  }
  if (!info.isDirectory()) throw new ArtifactPublisherUnavailableError("Artifact output directory is unavailable", { code: "ARTIFACT_DIRECTORY_MISSING" });

  const artifacts = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new ArtifactPublisherUnavailableError("Artifact bundle contains a symbolic link", { code: "ARTIFACT_SYMLINK_REJECTED" });
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) artifacts.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") });
    }
  }
  await walk(root);
  artifacts.sort((a, b) => a.relative.localeCompare(b.relative));
  const names = new Set(artifacts.map((entry) => entry.relative));
  for (const required of REQUIRED_ARTIFACTS) {
    if (!names.has(required)) throw new ArtifactPublisherUnavailableError(`Required artifact is missing: ${required}`, { code: "ARTIFACT_BUNDLE_INCOMPLETE" });
  }
  return artifacts;
}

function publishedResult(buildId, files) {
  const previewUrl = files["index.html"];
  const reportUrl = files["optimization-manifest.json"];
  if (!isHttpUrl(previewUrl) || !isHttpUrl(reportUrl)) throw new ArtifactPublisherUnavailableError("Published artifact URLs are invalid", { code: "ARTIFACT_URL_INVALID" });
  return { build_id: buildId, preview_url: previewUrl, report_url: reportUrl, files: { ...files } };
}

function safeBuildId(value) {
  const safe = String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
  if (!safe) throw new TypeError("buildId is required");
  return safe;
}

function normalizePrefix(value) {
  const prefix = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!prefix || prefix.includes("..")) throw new TypeError("Invalid artifact Blob prefix");
  return prefix;
}

function ensureTrailingSlash(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}
