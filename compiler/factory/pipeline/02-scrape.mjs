// Pipeline stage 2 — scrape: normalize, verify, deduplicate, and locally mirror
// prospect media before it can become proof in a generated build.
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { imageDimensions } from "../../app/lib/image-metadata.mjs";
import {
  canonicalMediaIdentity,
  hasUsableContainedSourceDimensions,
  hasUsablePhotoDimensions,
  isBoundContainedSourceProof,
  isBannedProspectMedia,
  perceptualHashesCollide,
} from "../lib/media-intelligence.mjs";
import { emit } from "../lib/emit.mjs";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_BATCH_BYTES = 40 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_IMAGES = 30;
const MAX_REDIRECTS = 5;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 50_000_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PHOTO_CONTENT_TYPES = new Map([
  ["image/gif", { extension: ".gif", format: "gif" }],
  ["image/jpeg", { extension: ".jpg", format: "jpeg" }],
  ["image/png", { extension: ".png", format: "png" }],
  ["image/webp", { extension: ".webp", format: "webp" }],
]);
const VIDEO_CONTENT_TYPES = new Map([
  ["video/mp4", { extension: ".mp4", format: "mp4" }],
]);
const TEMP_MEDIA_PREFIX = path.resolve(tmpdir(), "siteforge-source-media-");
const EPHEMERAL_MEDIA_DIRS = new Set();

const IPV4_BLOCKLIST = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  IPV4_BLOCKLIST.addSubnet(address, prefix, "ipv4");
}

const IPV6_GLOBAL = new BlockList();
IPV6_GLOBAL.addSubnet("2000::", 3, "ipv6");
const IPV6_BLOCKLIST = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
]) {
  IPV6_BLOCKLIST.addSubnet(address, prefix, "ipv6");
}

let processCleanupRegistered = false;

export async function scrape(packet, options = {}) {
  emit("scrape", "start", {});
  const src = packet.enrichment_sources ?? {};
  const media = Array.isArray(packet.media?.catalog)
    ? packet.media.catalog.map((item) => ({ ...item }))
    : [];
  const preservedCount = media.length;
  const branding = src.branding?.value;
  if (branding?.images) {
    for (const [role, rawValues] of Object.entries(branding.images)) {
      const values = Array.isArray(rawValues) ? rawValues : [rawValues];
      for (const value of values) {
        const url = typeof value === "string" ? value : value?.url || value?.src;
        if (!url) continue;
        const kind = /logo|mark|icon/i.test(role) ? "logo" : /video/i.test(role) ? "video" : "photo";
        media.push({
          ...(typeof value === "object" ? value : {}),
          kind,
          url,
          source: value?.source || "business-site",
          role: value?.role || role,
          generated: false,
          proof_eligible: kind === "photo",
        });
      }
    }
  }

  const normalized = dedupeMediaUrls(media.filter((item) => !isBannedProspectMedia(item)));
  const mirrorRemote = options.mirrorRemote ?? !process.env.NODE_TEST_CONTEXT;
  const mediaDir = options.mediaDir
    ? path.resolve(options.mediaDir)
    : defaultMediaDirectory(packet, options.outDir);
  const mirrorResult = mirrorRemote
    ? await mirrorProspectPhotos(normalized, { ...options, mediaDir })
    : {
        catalog: normalized,
        mirrored: 0,
        rejected: 0,
        perceptualDuplicates: 0,
        mediaDir,
      };
  const cleanupRequired = options.persistentMedia !== true
    && (EPHEMERAL_MEDIA_DIRS.has(mediaDir) || path.basename(mediaDir).startsWith(".source-media"));
  packet.media = {
    ...(packet.media || {}),
    catalog: mirrorResult.catalog,
    mirror_dir: mediaDir,
    mirror_cleanup_required: cleanupRequired,
  };
  emit("scrape", "done", {
    media: mirrorResult.catalog.length,
    preserved: preservedCount,
    mirrored: mirrorResult.mirrored,
    rejected: mirrorResult.rejected,
    perceptual_duplicates: mirrorResult.perceptualDuplicates,
  });
  return packet;
}

export async function mirrorProspectPhotos(items, options = {}) {
  const mediaDir = path.resolve(options.mediaDir || defaultMediaDirectory({}, options.outDir));
  const concurrency = positiveInteger(options.concurrency, DEFAULT_CONCURRENCY, 8);
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  const maxBatchBytes = positiveInteger(options.maxBatchBytes, DEFAULT_BATCH_BYTES, 64 * 1024 * 1024);
  const maxImages = positiveInteger(options.maxImages, DEFAULT_MAX_IMAGES, 100);
  const byteBudget = { remaining: maxBatchBytes };
  let remoteCount = 0;

  const loaded = await mapConcurrent(items, concurrency, async (item) => {
    if (!isRemoteProspectPhoto(item)) return { item, passthrough: true };
    remoteCount += 1;
    if (remoteCount > maxImages) return null;
    try {
      const source = await fetchRemotePhoto(item.url, {
        ...options,
        maxBytes,
        byteBudget,
        timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 60_000),
        dimensionPolicy: isBoundContainedSourceProof(item) ? "contained-source" : "photo",
      });
      if (!source) return null;
      mkdirSync(mediaDir, { recursive: true });
      const filename = `source-${source.checksum.slice(0, 20)}${source.extension}`;
      const localPath = path.join(mediaDir, filename);
      writeFileSync(localPath, source.buffer);
      return {
        item,
        passthrough: false,
        localPath,
        source: {
          checksum: source.checksum,
          contentType: source.contentType,
          extension: source.extension,
          width: source.width,
          height: source.height,
          perceptualHash: source.perceptualHash,
        },
      };
    } catch {
      return null;
    }
  });

  const catalog = [];
  const contentHashes = new Set();
  const perceptualHashes = [];
  let mirrored = 0;
  let rejected = 0;
  let perceptualDuplicates = 0;
  for (const result of loaded) {
    if (!result) {
      rejected += 1;
      continue;
    }
    if (result.passthrough) {
      catalog.push(result.item);
      continue;
    }
    if (contentHashes.has(result.source.checksum)) {
      rejected += 1;
      continue;
    }
    if (
      result.source.perceptualHash
      && perceptualHashes.some((hash) => perceptualHashesCollide(hash, result.source.perceptualHash))
    ) {
      rejected += 1;
      perceptualDuplicates += 1;
      removeCandidateFile(result.localPath);
      continue;
    }

    contentHashes.add(result.source.checksum);
    perceptualHashes.push(result.source.perceptualHash);
    catalog.push({
      ...result.item,
      local_path: result.localPath,
      width: result.source.width,
      height: result.source.height,
      meta: {
        ...(result.item.meta || {}),
        dimensions: { width: result.source.width, height: result.source.height },
        checksum_sha256: result.source.checksum,
        content_type: result.source.contentType,
        mirror_status: "owned-local",
        perceptual_hash: result.source.perceptualHash,
      },
    });
    mirrored += 1;
  }
  return { catalog, mirrored, rejected, perceptualDuplicates, mediaDir };
}

export async function fetchRemotePhoto(value, options = {}) {
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 60_000);
  const byteBudget = options.byteBudget || { remaining: DEFAULT_BATCH_BYTES };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
  const visited = new Set();
  let current = value;

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const target = parseRemoteHttpUrl(current);
      if (!target || visited.has(target.url.href)) return null;
      visited.add(target.url.href);
      const response = await openRemoteResponse(target, {
        ...options,
        signal: controller.signal,
      });
      if (!response) return null;

      if (REDIRECT_STATUSES.has(response.status)) {
        await discardResponseBody(response.body);
        const location = response.header("location");
        if (!location || redirects === MAX_REDIRECTS) return null;
        try {
          current = new URL(location, target.url).href;
        } catch {
          return null;
        }
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        await discardResponseBody(response.body);
        return null;
      }

      const contentLength = parseContentLength(response.header("content-length"));
      if (contentLength === null || contentLength > maxBytes || contentLength > byteBudget.remaining) {
        await discardResponseBody(response.body);
        return null;
      }
      const contentType = String(response.header("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const type = PHOTO_CONTENT_TYPES.get(contentType);
      if (!type) {
        await discardResponseBody(response.body);
        return null;
      }
      const buffer = await readResponseBodyLimited(response.body, {
        maxBytes,
        byteBudget,
        signal: controller.signal,
      });
      if (!buffer.length) return null;
      const verified = await verifyAndHashPhoto(
        buffer,
        contentType,
        options.perceptualHash,
        ["logo", "contained-source"].includes(options.dimensionPolicy)
          ? options.dimensionPolicy
          : "photo",
      );
      if (!verified) return null;
      return {
        buffer,
        checksum: createHash("sha256").update(buffer).digest("hex"),
        contentType,
        extension: type.extension,
        width: verified.width,
        height: verified.height,
        perceptualHash: verified.perceptualHash,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// Reuses the prospect-photo transport so remote video receives the same URL,
// public-DNS, pinned-socket, manual-redirect, timeout, and streaming byte
// protections. Only an allowlisted video MIME with matching container bytes is
// returned; callers still decide which remote origins are trusted.
export async function fetchRemoteVideo(value, options = {}) {
  if (typeof options.allowUrl !== "function") return null;
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_VIDEO_MAX_BYTES, DEFAULT_VIDEO_MAX_BYTES);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 60_000);
  const byteBudget = options.byteBudget || { remaining: DEFAULT_BATCH_BYTES };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
  const visited = new Set();
  let current = value;

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const target = parseRemoteHttpUrl(current);
      if (
        !target
        || visited.has(target.url.href)
        || (typeof options.allowUrl === "function" && !options.allowUrl(target.url))
      ) return null;
      visited.add(target.url.href);
      const response = await openRemoteResponse(target, {
        ...options,
        accept: "video/mp4",
        signal: controller.signal,
      });
      if (!response) return null;

      if (REDIRECT_STATUSES.has(response.status)) {
        await discardResponseBody(response.body);
        const location = response.header("location");
        if (!location || redirects === MAX_REDIRECTS) return null;
        try {
          current = new URL(location, target.url).href;
        } catch {
          return null;
        }
        continue;
      }
      if (response.status !== 200) {
        await discardResponseBody(response.body);
        return null;
      }

      const contentLength = parseContentLength(response.header("content-length"));
      if (contentLength === null || contentLength > maxBytes || contentLength > byteBudget.remaining) {
        await discardResponseBody(response.body);
        return null;
      }
      const contentType = String(response.header("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const type = VIDEO_CONTENT_TYPES.get(contentType);
      if (!type) {
        await discardResponseBody(response.body);
        return null;
      }
      const contentEncoding = String(response.header("content-encoding") || "").trim().toLowerCase();
      if (contentEncoding && contentEncoding !== "identity") {
        await discardResponseBody(response.body);
        return null;
      }
      const buffer = await readResponseBodyLimited(response.body, {
        maxBytes,
        byteBudget,
        signal: controller.signal,
      });
      if (!hasMatchingVideoSignature(buffer, type.format)) return null;
      return {
        buffer,
        checksum: createHash("sha256").update(buffer).digest("hex"),
        contentType,
        extension: type.extension,
        byteLength: buffer.length,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function parseRemoteHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
      return null;
    }
    const hostname = normalizeHostname(url.hostname);
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) return null;
    if (/\.(?:home|internal|lan|local)$/.test(hostname)) return null;
    const family = isIP(hostname);
    if (!family && !hostname.includes(".")) return null;
    if (family && !isPublicIpAddress(hostname)) return null;
    url.hash = "";
    return { url, hostname, family };
  } catch {
    return null;
  }
}

export function isPublicIpAddress(value) {
  const address = stripIpv6Zone(String(value || ""));
  const family = isIP(address);
  if (family === 4) return !IPV4_BLOCKLIST.check(address, "ipv4");
  if (family === 6) {
    return IPV6_GLOBAL.check(address, "ipv6") && !IPV6_BLOCKLIST.check(address, "ipv6");
  }
  return false;
}

export async function resolvePublicMediaTarget(targetValue, options = {}) {
  const target = targetValue?.url ? targetValue : parseRemoteHttpUrl(targetValue);
  if (!target) throw destinationError("invalid media URL");
  if (target.family) {
    return { target, addresses: [{ address: target.hostname, family: target.family }] };
  }
  const lookupImpl = options.lookupImpl || dnsLookup;
  const lookupPromise = Promise.resolve(lookupImpl(target.hostname, { all: true, verbatim: true }));
  const records = await raceWithAbort(lookupPromise, options.signal);
  if (!Array.isArray(records) || !records.length) throw destinationError("media hostname has no addresses");
  const addresses = [];
  const seen = new Set();
  for (const record of records) {
    const address = stripIpv6Zone(String(record?.address || ""));
    const family = Number(record?.family);
    if (![4, 6].includes(family) || isIP(address) !== family || !isPublicIpAddress(address)) {
      throw destinationError("media hostname resolved to a non-public address");
    }
    const key = `${family}:${address}`;
    if (!seen.has(key)) addresses.push({ address, family });
    seen.add(key);
  }
  return { target, addresses };
}

export function createPinnedLookup(hostname, addresses) {
  const expected = normalizeHostname(hostname);
  const frozen = addresses.map((record) => ({ address: record.address, family: record.family }));
  return (requestedHost, rawOptions, callback) => {
    const options = typeof rawOptions === "number" ? { family: rawOptions } : (rawOptions || {});
    const requested = normalizeHostname(requestedHost);
    if (requested !== expected) {
      queueMicrotask(() => callback(destinationError("unexpected hostname in pinned lookup")));
      return;
    }
    const family = Number(options.family || 0);
    const matching = family ? frozen.filter((record) => record.family === family) : frozen;
    if (!matching.length) {
      queueMicrotask(() => callback(destinationError("pinned lookup has no matching address family")));
      return;
    }
    if (options.all) queueMicrotask(() => callback(null, matching.map((record) => ({ ...record }))));
    else queueMicrotask(() => callback(null, matching[0].address, matching[0].family));
  };
}

export function cleanupMirroredMedia(packet) {
  const media = packet?.media || {};
  if (media.mirror_cleanup_required !== true) return false;
  const mediaDir = path.resolve(String(media.mirror_dir || ""));
  const safeTemp = mediaDir.startsWith(TEMP_MEDIA_PREFIX);
  const safeBuildDir = path.basename(mediaDir).startsWith(".source-media");
  if ((!safeTemp && !safeBuildDir) || mediaDir === path.parse(mediaDir).root) return false;
  rmSync(mediaDir, { recursive: true, force: true });
  EPHEMERAL_MEDIA_DIRS.delete(mediaDir);
  media.mirror_cleanup_required = false;
  return true;
}

export async function verifyMirroredPhotoFile(filePath, expected = {}) {
  const resolved = path.resolve(String(filePath || ""));
  const checksum = String(expected.checksum_sha256 || "").trim().toLowerCase();
  const contentType = String(expected.content_type || "").trim().toLowerCase();
  const width = Number(expected.width || expected.dimensions?.width || 0);
  const height = Number(expected.height || expected.dimensions?.height || 0);
  if (!/^[a-f0-9]{64}$/.test(checksum) || !PHOTO_CONTENT_TYPES.has(contentType) || !width || !height) {
    throw new Error("Mirrored photo verification metadata is incomplete");
  }
  const stats = statSync(resolved);
  if (!stats.isFile() || stats.size <= 0 || stats.size > DEFAULT_MAX_BYTES) {
    throw new Error("Mirrored photo file is outside the byte policy");
  }
  const buffer = readFileSync(resolved);
  if (buffer.length !== stats.size || createHash("sha256").update(buffer).digest("hex") !== checksum) {
    throw new Error("Mirrored photo checksum verification failed");
  }
  const verified = await verifyAndHashPhoto(buffer, contentType);
  if (!verified || verified.width !== width || verified.height !== height) {
    throw new Error("Mirrored photo decode or dimension verification failed");
  }
  const perceptualHash = String(expected.perceptual_hash || "").trim().toLowerCase();
  if (perceptualHash && verified.perceptualHash !== perceptualHash) {
    throw new Error("Mirrored photo perceptual hash verification failed");
  }
  return {
    checksum,
    contentType,
    width,
    height,
    perceptualHash: verified.perceptualHash,
  };
}

export function verifyMirroredVideoFile(filePath, expected = {}) {
  const resolved = path.resolve(String(filePath || ""));
  const checksum = String(expected.checksum_sha256 || "").trim().toLowerCase();
  const contentType = String(expected.content_type || "").split(";", 1)[0].trim().toLowerCase();
  const byteLength = Number(expected.byte_length || 0);
  const type = VIDEO_CONTENT_TYPES.get(contentType);
  if (
    !/^[a-f0-9]{64}$/.test(checksum)
    || !type
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
  ) {
    throw new Error("Mirrored video verification metadata is incomplete");
  }
  const stats = statSync(resolved);
  if (
    !stats.isFile()
    || stats.size !== byteLength
    || stats.size > DEFAULT_VIDEO_MAX_BYTES
    || path.extname(resolved).toLowerCase() !== type.extension
  ) {
    throw new Error("Mirrored video file is outside the byte or type policy");
  }
  const buffer = readFileSync(resolved);
  if (
    buffer.length !== stats.size
    || createHash("sha256").update(buffer).digest("hex") !== checksum
    || !hasMatchingVideoSignature(buffer, type.format)
  ) {
    throw new Error("Mirrored video checksum or container verification failed");
  }
  return {
    buffer,
    checksum,
    contentType,
    extension: type.extension,
    byteLength,
  };
}

export async function downloadVerifiedMirroredPhoto(url, filePath, expected = {}, options = {}) {
  const checksum = String(expected.checksum_sha256 || "").trim().toLowerCase();
  const contentType = String(expected.content_type || "").trim().toLowerCase();
  const width = Number(expected.width || expected.dimensions?.width || 0);
  const height = Number(expected.height || expected.dimensions?.height || 0);
  if (!/^[a-f0-9]{64}$/.test(checksum) || !PHOTO_CONTENT_TYPES.has(contentType) || !width || !height) {
    throw new Error("Durable photo verification metadata is incomplete");
  }
  const source = await fetchRemotePhoto(url, options);
  if (!source) throw new Error("Durable photo failed bounded download or full decode");
  const perceptualHash = String(expected.perceptual_hash || "").trim().toLowerCase();
  if (
    source.checksum !== checksum
    || source.contentType !== contentType
    || source.width !== width
    || source.height !== height
    || (perceptualHash && source.perceptualHash !== perceptualHash)
  ) {
    throw new Error("Durable photo bytes do not match persisted verification metadata");
  }
  const resolved = path.resolve(String(filePath || ""));
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, source.buffer);
  return {
    checksum,
    contentType,
    width,
    height,
    perceptualHash: source.perceptualHash,
  };
}

function dedupeMediaUrls(items) {
  const chosen = new Map();
  for (const item of items) {
    const key = canonicalMediaIdentity(item?.url || item?.local_path);
    if (!key) continue;
    const prior = chosen.get(key);
    if (!prior || mediaCandidateScore(item) > mediaCandidateScore(prior)) chosen.set(key, item);
  }
  return [...chosen.values()];
}

function mediaCandidateScore(item) {
  const width = Number(item?.width || item?.meta?.width || item?.meta?.dimensions?.width || 0);
  const height = Number(item?.height || item?.meta?.height || item?.meta?.dimensions?.height || 0);
  const transformedWidth = [...String(item?.url || "").matchAll(/(?:^|[^a-z])(?:w|width)[:=](\d{1,4})(?:\D|$)/gi)]
    .map((match) => Number(match[1]))
    .sort((left, right) => right - left)[0] || 0;
  return width * height || transformedWidth || (item?.local_path ? 10_000 : 1);
}

function isRemoteProspectPhoto(item) {
  const source = String(item?.source || "").toLowerCase();
  return item?.kind === "photo"
    && source !== "stock-ambiance"
    && Boolean(parseRemoteHttpUrl(item?.url));
}

async function openRemoteResponse(target, options) {
  if (typeof options.fetchImpl === "function") {
    const response = await options.fetchImpl(target.url.href, {
      headers: requestHeaders(options.accept),
      redirect: "manual",
      signal: options.signal,
    });
    const finalTarget = response.url ? parseRemoteHttpUrl(response.url) : target;
    if (
      !finalTarget
      || (typeof options.allowUrl === "function" && !options.allowUrl(finalTarget.url))
    ) return null;
    return {
      status: Number(response.status || 0),
      body: response.body,
      header: (name) => response.headers?.get?.(name) ?? null,
    };
  }

  const resolved = await resolvePublicMediaTarget(target, {
    lookupImpl: options.lookupImpl,
    signal: options.signal,
  });
  const pinnedLookup = createPinnedLookup(target.hostname, resolved.addresses);
  const requestImpl = options.requestImpl || coreRequest;
  return requestImpl(resolved.target, {
    addresses: resolved.addresses,
    accept: options.accept,
    lookup: pinnedLookup,
    signal: options.signal,
  });
}

function coreRequest(target, options) {
  const transport = target.url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(target.url, {
      agent: false,
      autoSelectFamily: true,
      headers: requestHeaders(options.accept),
      lookup: options.lookup,
      method: "GET",
      signal: options.signal,
    }, (response) => {
      resolve({
        status: Number(response.statusCode || 0),
        body: response,
        header: (name) => response.headers[String(name).toLowerCase()] ?? null,
      });
    });
    request.once("socket", (socket) => {
      const verifyPeer = () => {
        if (socket.remoteAddress && !isPublicIpAddress(socket.remoteAddress)) {
          request.destroy(destinationError("media socket connected to a non-public address"));
        }
      };
      socket.once("connect", verifyPeer);
      socket.once("secureConnect", verifyPeer);
    });
    request.once("error", reject);
    request.end();
  });
}

async function readResponseBodyLimited(body, { maxBytes, byteBudget, signal }) {
  if (!body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  const accept = (value) => {
    if (signal?.aborted) throw signal.reason || timeoutError();
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (total + chunk.length > maxBytes || chunk.length > byteBudget.remaining) {
      throw new Error("media response exceeded byte budget");
    }
    total += chunk.length;
    byteBudget.remaining -= chunk.length;
    chunks.push(chunk);
  };

  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accept(value);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    for await (const chunk of body) accept(chunk);
  }
  return Buffer.concat(chunks, total);
}

function hasMatchingVideoSignature(buffer, format) {
  if (format !== "mp4" || !Buffer.isBuffer(buffer) || buffer.length < 24) return false;
  const firstBoxSize = buffer.readUInt32BE(0);
  if (
    firstBoxSize < 16
    || firstBoxSize > buffer.length
    || buffer.toString("ascii", 4, 8) !== "ftyp"
  ) return false;

  let offset = 0;
  let hasMovieBox = false;
  let hasMediaData = false;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (size < 8 || offset + size > buffer.length) return false;
    if (type === "moov") hasMovieBox = true;
    if (type === "mdat") hasMediaData = true;
    offset += size;
  }
  return offset === buffer.length && hasMovieBox && hasMediaData;
}

async function verifyAndHashPhoto(buffer, contentType, provider, dimensionPolicy = "photo") {
  const trustedHeaderFixture = process.env.NODE_TEST_CONTEXT && typeof provider === "function";
  if (trustedHeaderFixture) {
    const dimensions = imageDimensions(buffer, contentType);
    if (!dimensions || !dimensionsWithinPolicy(dimensions.width, dimensions.height, dimensionPolicy)) return null;
    const supplied = String(await provider(buffer) || "").trim().toLowerCase();
    if (!/^[a-f0-9]{16}$/.test(supplied)) return null;
    return { ...dimensions, perceptualHash: supplied };
  }

  try {
    const type = PHOTO_CONTENT_TYPES.get(contentType);
    const input = sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    });
    const metadata = await input.metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (metadata.format !== type?.format || Number(metadata.pages || 1) !== 1) return null;
    if (!dimensionsWithinPolicy(width, height, dimensionPolicy)) return null;
    const pixels = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .resize(9, 8, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    if (pixels.length !== 72) return null;
    return { width, height, perceptualHash: differenceHash(pixels) };
  } catch {
    return null;
  }
}

function dimensionsWithinPolicy(width, height, dimensionPolicy = "photo") {
  const minimumsPass = dimensionPolicy === "logo"
    ? width >= 16 && height >= 16 && width * height >= 512
    : dimensionPolicy === "contained-source"
      ? hasUsableContainedSourceDimensions(width, height)
      : hasUsablePhotoDimensions(width, height);
  return minimumsPass
    && width <= MAX_IMAGE_DIMENSION
    && height <= MAX_IMAGE_DIMENSION
    && width * height <= MAX_IMAGE_PIXELS;
}

function differenceHash(pixels) {
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? "1" : "0";
    }
  }
  return Array.from(
    { length: 16 },
    (_, index) => Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16),
  ).join("");
}

async function discardResponseBody(body) {
  try {
    if (typeof body?.cancel === "function") await body.cancel();
    else if (typeof body?.destroy === "function") body.destroy();
    else if (typeof body?.resume === "function") body.resume();
  } catch {}
}

function parseContentLength(value) {
  if (value == null || value === "") return 0;
  if (!/^\d+$/.test(String(value).trim())) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

function requestHeaders(accept = "image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5") {
  return {
    Accept: accept,
    "Accept-Encoding": "identity",
    "User-Agent": "Mozilla/5.0 (compatible; SiteForgeMediaMirror/8.0)",
  };
}

function normalizeHostname(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function stripIpv6Zone(value) {
  return normalizeHostname(value).replace(/%.+$/, "");
}

function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || timeoutError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || timeoutError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function defaultMediaDirectory(packet, outDir) {
  if (outDir) return path.join(path.resolve(outDir), ".source-media");
  const directory = mkdtempSync(TEMP_MEDIA_PREFIX);
  EPHEMERAL_MEDIA_DIRS.add(directory);
  registerProcessCleanup();
  return directory;
}

function registerProcessCleanup() {
  if (processCleanupRegistered) return;
  processCleanupRegistered = true;
  process.once("exit", () => {
    for (const directory of EPHEMERAL_MEDIA_DIRS) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {}
    }
  });
}

function removeCandidateFile(filePath) {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {}
}

function destinationError(message) {
  const error = new Error(message);
  error.code = "ERR_SITEFORGE_MEDIA_DESTINATION";
  return error;
}

function timeoutError() {
  const error = new Error("media request timed out");
  error.code = "ERR_SITEFORGE_MEDIA_TIMEOUT";
  return error;
}

function positiveInteger(value, fallback, maximum) {
  const number = Math.floor(Number(value || fallback));
  return Number.isFinite(number) && number > 0 ? Math.min(number, maximum) : fallback;
}
