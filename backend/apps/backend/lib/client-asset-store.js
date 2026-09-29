"use strict";

// lib/client-asset-store.js — where a CLIENT'S OWN photographs live once we take
// responsibility for them.
//
// THE STRATEGY THIS SERVES (owner's words, do not redesign):
//   CAPTURE EVERYTHING -> HOTLINK FOR THE PITCH -> SNAPSHOT THE EMAILED ONES ->
//   LOCALIZE ON SIGNUP.
//
// Most mirrors never convert, so on the pitch path we point the <img> straight
// at the prospect's own hosted URL and pay nothing to download, process or store
// their bytes. Two moments change that, and this file is the storage for both:
//
//   SNAPSHOT (at qualify, only for the ~1-in-12 we actually EMAIL): a cheap,
//   PRIVATE, time-boxed copy of the exact bytes we referenced, so that if the
//   prospect cancels their old provider the day before they call Riley we still
//   have the photograph to promote. Non-converters TTL-delete themselves.
//
//   LOCALIZE (at signup): the permanent, PUBLIC home for a paying customer's
//   photographs. They will cancel the old provider, that site dies, and every
//   hotlinked URL 404s — taking our customer's site down with it — unless the
//   bytes already live here and their build points at OUR host.
//
// THE CONTRACT that lets the two halves cooperate without talking to each other
// is the OBJECT KEY: both derive it as sha256(normalized source URL). So the
// localize step, months later, can look for a snapshot of a given photograph
// WITHOUT any shared index — exactly the content-addressed discipline
// proof-storage.js uses for shots. Same idea, different buckets.

const { createHash } = require("node:crypto");

// Permanent home for a paying customer's assets. PUBLIC, because the customer's
// live site serves these images to the world.
const CLIENT_ASSETS_BUCKET = "wss-client-assets";
const CLIENT_ASSETS_PREFIX = "assets";

// Insurance copies of a prospect's referenced bytes. PRIVATE, because these are
// another business's photographs held only so a future customer's site does not
// break; they are never served to anyone and never a public URL.
const ASSET_SNAPSHOTS_BUCKET = "wss-asset-snapshots";
const ASSET_SNAPSHOTS_PREFIX = "snapshots";

// How long an un-converted snapshot lives. The owner's window is 30-60 days;
// 45 sits in the middle. A prospect who converts is localized (permanent) long
// before this, and the sweeper deletes anything past it that never converted.
const SNAPSHOT_TTL_DAYS = 45;

const KNOWN_EXTS = new Set([
  "jpg", "jpeg", "png", "webp", "avif", "gif", "svg", "bmp", "ico",
  "mp4", "webm", "mov", "m4v",
]);

const CONTENT_TYPE_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  avif: "image/avif", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp",
  ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  m4v: "video/x-m4v",
};

/**
 * Canonical form of a source URL, so the snapshot writer and the localize reader
 * derive the SAME object key from the same photograph.
 *
 * Deliberately conservative — it folds only what cannot change which bytes a
 * host returns. Query is KEPT (many image CDNs encode the real variant there,
 * e.g. `?w=1600`), only sorted so ordering cannot fork the key. Fragment is
 * dropped (never sent to a server). Host is lower-cased; the leading `www.` is
 * folded because it never changes the image.
 */
function normalizeAssetUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return "";
  }
  if (!/^https?:$/i.test(u.protocol)) return "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  u.hash = "";
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) u.port = "";
  const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  return u.toString();
}

/** File extension implied by the URL path (not the query), lower-cased. */
function extFromUrl(raw) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(raw)) ? String(raw) : `https://${raw}`);
    const m = u.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    const ext = m ? m[1] : "";
    return KNOWN_EXTS.has(ext) ? ext : "";
  } catch {
    return "";
  }
}

function extFromContentType(contentType) {
  const ct = String(contentType || "").toLowerCase().split(";")[0].trim();
  for (const [ext, type] of Object.entries(CONTENT_TYPE_BY_EXT)) {
    if (type === ct) return ext;
  }
  return "";
}

function contentTypeForExt(ext) {
  return CONTENT_TYPE_BY_EXT[String(ext || "").toLowerCase()] || "application/octet-stream";
}

/**
 * Content-addressed object path for a source URL. The sha is of the NORMALIZED
 * url, so two spellings of the same photograph share one object; the first two
 * hex chars shard the bucket so no single folder holds millions of keys.
 *
 * The extension is advisory (it follows the bytes when known) and never part of
 * the digest, so a photograph served as .jpg on the site and image/jpeg over the
 * wire cannot fork into two keys.
 */
function assetKeyForUrl(sourceUrl, { prefix, ext = "" } = {}) {
  const norm = normalizeAssetUrl(sourceUrl);
  if (!norm) return "";
  const digest = createHash("sha256").update(norm).digest("hex");
  const useExt = KNOWN_EXTS.has(String(ext).toLowerCase())
    ? String(ext).toLowerCase()
    : extFromUrl(sourceUrl) || "bin";
  return `${prefix}/${digest.slice(0, 2)}/${digest}.${useExt}`;
}

/**
 * Byte-addressed object path for assets that must be fetched later by a third
 * party. Unlike assetKeyForUrl, this key cannot drift when the source host
 * changes the bytes behind a URL.
 */
function assetKeyForSha256(sha256, { prefix, ext = "" } = {}) {
  const digest = String(sha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) return "";
  const useExt = KNOWN_EXTS.has(String(ext).toLowerCase())
    ? String(ext).toLowerCase()
    : "bin";
  return `${prefix}/sha256/${digest.slice(0, 2)}/${digest}.${useExt}`;
}

function sourceFingerprint(sourceUrl) {
  const norm = normalizeAssetUrl(sourceUrl);
  return norm ? createHash("sha256").update(norm).digest("hex") : "";
}

// ---------------------------------------------------------------------------
// SUPABASE-BACKED STORE
// ---------------------------------------------------------------------------
// Mirrors the fetch shapes proof-storage.js already proves against the live
// project: POST /storage/v1/bucket to create, POST /storage/v1/object/<bucket>/
// <key> with x-upsert to write, GET .../object/<bucket>/<key> (service key) to
// read a private object, DELETE to remove, POST .../object/list/<bucket> to
// enumerate for the TTL sweep. Never throws; every failure is {ok:false,reason}.

function supabaseBase(env) {
  const url = env.SUPABASE_URL || env.CALLPREP_SUPABASE_URL || "";
  return String(url).replace(/\/+$/, "");
}
function supabaseServiceKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "";
}

function serviceHeaders(key, extra = {}) {
  const headers = { apikey: key, ...extra };
  // New Supabase sb_secret_* keys are not JWTs and must not be sent as Bearer
  // tokens. Legacy service-role JWTs retain the Authorization header.
  if (!String(key).startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function createSupabaseAssetStore({
  bucket,
  prefix,
  isPublic = false,
  ttlDays = null,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const base = supabaseBase(env);
  const key = supabaseServiceKey(env);
  const configured = Boolean(base && key && bucket && prefix);

  function publicUrl(objectPath) {
    if (!isPublic || !base || !objectPath) return "";
    const override = String(env.WSS_CLIENT_ASSETS_BASE_URL || "").replace(/\/+$/, "");
    const candidate = override
      ? `${override}/${objectPath}`
      : `${base}/storage/v1/object/public/${bucket}/${objectPath}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
      return parsed.toString();
    } catch { return ""; }
  }

  async function verifyBucketVisibility() {
    try {
      const res = await fetchImpl(`${base}/storage/v1/bucket/${bucket}`, {
        headers: serviceHeaders(key),
      });
      if (!res.ok) return { ok: false, reason: `bucket_read_${res.status}` };
      const body = await res.json().catch(() => null);
      if (!body || Boolean(body.public) !== Boolean(isPublic)) {
        return { ok: false, reason: "bucket_visibility_mismatch" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
    }
  }

  async function ensureBucket() {
    if (!configured) return { ok: false, reason: "storage_not_configured" };
    try {
      const res = await fetchImpl(`${base}/storage/v1/bucket`, {
        method: "POST",
        headers: serviceHeaders(key, { "Content-Type": "application/json" }),
        body: JSON.stringify({ id: bucket, name: bucket, public: isPublic }),
      });
      const body = await res.text().catch(() => "");
      if (res.ok) {
        const verified = await verifyBucketVisibility();
        return verified.ok ? { ok: true, created: true } : verified;
      }
      if (/already exists|Duplicate/i.test(body)) {
        const verified = await verifyBucketVisibility();
        return verified.ok ? { ok: true, created: false } : verified;
      }
      return { ok: false, reason: `${res.status} ${body}`.slice(0, 160) };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
    }
  }

  // put(sourceUrl, buffer) -> { ok, key, publicUrl?, bytes } | { ok:false, reason }
  async function put(sourceUrl, buffer, { ext = "", contentType = "", cacheControl = "public, max-age=31536000, immutable" } = {}) {
    if (!configured) return { ok: false, reason: "storage_not_configured" };
    if (!buffer || !buffer.length) return { ok: false, reason: "empty_upload" };
    const useExt = KNOWN_EXTS.has(String(ext).toLowerCase()) ? String(ext).toLowerCase()
      : extFromContentType(contentType) || extFromUrl(sourceUrl) || "bin";
    const objectPath = assetKeyForUrl(sourceUrl, { prefix, ext: useExt });
    if (!objectPath) return { ok: false, reason: "unkeyable_source_url" };
    const ct = contentType || contentTypeForExt(useExt);
    try {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
        method: "POST",
        headers: serviceHeaders(key, {
          "Content-Type": ct,
          "Cache-Control": cacheControl,
          "x-upsert": "true",
        }),
        body: buffer,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, reason: `upload_${res.status} ${body}`.slice(0, 160) };
      }
      return { ok: true, key: objectPath, bytes: buffer.length, publicUrl: publicUrl(objectPath) };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
    }
  }

  // Store exact verified bytes at a non-overwritable SHA-addressed public URL.
  // A duplicate write is accepted only after the existing object is read back
  // with the service key and its bytes match the requested digest.
  async function putContentAddressed(buffer, {
    sha256 = "", ext = "", contentType = "", cacheControl = "public, max-age=31536000, immutable",
  } = {}) {
    if (!configured) return { ok: false, reason: "storage_not_configured" };
    if (!buffer || !buffer.length) return { ok: false, reason: "empty_upload" };
    const digest = String(sha256 || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) return { ok: false, reason: "sha256_invalid" };
    if (createHash("sha256").update(buffer).digest("hex") !== digest) {
      return { ok: false, reason: "sha256_mismatch" };
    }
    const useExt = KNOWN_EXTS.has(String(ext).toLowerCase()) ? String(ext).toLowerCase()
      : extFromContentType(contentType) || "bin";
    const objectPath = assetKeyForSha256(digest, { prefix, ext: useExt });
    const ct = contentType || contentTypeForExt(useExt);
    let uploadStatus = 0;
    try {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
        method: "POST",
        headers: serviceHeaders(key, {
          "Content-Type": ct,
          "Cache-Control": cacheControl,
          "x-upsert": "false",
        }),
        body: buffer,
      });
      uploadStatus = Number(res.status) || 0;
      // Always read the stored object back. This makes a duplicate idempotent
      // and proves that an existing key was never overwritten with other bytes.
      if (!res.ok) await res.text().catch(() => "");
      const read = await fetchImpl(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
        headers: serviceHeaders(key),
      });
      if (!read.ok) return { ok: false, reason: `read_${read.status}` };
      const stored = Buffer.from(await read.arrayBuffer());
      if (!stored.length || createHash("sha256").update(stored).digest("hex") !== digest) {
        return { ok: false, reason: "content_address_collision" };
      }
      return {
        ok: true,
        key: objectPath,
        bytes: stored.length,
        publicUrl: publicUrl(objectPath),
        reused: uploadStatus < 200 || uploadStatus >= 300,
      };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
    }
  }

  // get(sourceUrl) -> { ok, buffer, contentType, key } | { ok:false, reason, status? }
  async function get(sourceUrl) {
    if (!configured) return { ok: false, reason: "storage_not_configured" };
    const digest = sourceFingerprint(sourceUrl);
    if (!digest) return { ok: false, reason: "unkeyable_source_url" };
    // The extension is advisory and not part of the digest, so the read cannot
    // assume it. List the sharded folder for the one object whose name starts
    // with this digest, then GET it.
    const objectPath = await resolveKeyByDigest(digest);
    if (!objectPath) return { ok: false, reason: "not_stored", status: 404 };
    try {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
        headers: serviceHeaders(key),
      });
      if (!res.ok) return { ok: false, reason: `read_${res.status}`, status: res.status };
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      if (!buffer.length) return { ok: false, reason: "read_empty", status: res.status };
      return { ok: true, buffer, contentType: res.headers.get("content-type") || "", key: objectPath };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
    }
  }

  async function resolveKeyByDigest(digest) {
    const listed = await listPrefix(`${prefix}/${digest.slice(0, 2)}`);
    if (!listed.ok) return "";
    const hit = listed.objects.find((o) => o.name.startsWith(digest));
    return hit ? `${prefix}/${digest.slice(0, 2)}/${hit.name}` : "";
  }

  async function listPrefix(folder, { limit = 1000 } = {}) {
    if (!configured) return { ok: false, reason: "storage_not_configured", objects: [] };
    try {
      const res = await fetchImpl(`${base}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: serviceHeaders(key, { "Content-Type": "application/json" }),
        body: JSON.stringify({ prefix: `${folder}/`, limit, sortBy: { column: "created_at", order: "asc" } }),
      });
      if (!res.ok) return { ok: false, reason: `list_${res.status}`, objects: [] };
      const json = await res.json().catch(() => []);
      const objects = (Array.isArray(json) ? json : []).filter((o) => o && o.name && !/\/$/.test(o.name));
      return { ok: true, objects };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err).slice(0, 120), objects: [] };
    }
  }

  async function del(objectPath) {
    if (!configured) return { ok: false, reason: "storage_not_configured" };
    if (!objectPath) return { ok: false, reason: "no_key" };
    try {
      const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
        method: "DELETE",
        headers: serviceHeaders(key),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, reason: `delete_${res.status} ${body}`.slice(0, 160) };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
    }
  }

  // listExpired(nowMs) — objects whose created_at is older than the TTL. Only
  // meaningful for the snapshot bucket (ttlDays set); the permanent bucket never
  // expires and returns an empty list.
  async function listExpired(nowMs = Date.now()) {
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) return { ok: true, objects: [] };
    if (!configured) return { ok: false, reason: "storage_not_configured", objects: [] };
    const cutoff = nowMs - ttlDays * 86_400_000;
    const shards = "0123456789abcdef".split("").flatMap((a) => "0123456789abcdef".split("").map((b) => a + b));
    const expired = [];
    for (const shard of shards) {
      const listed = await listPrefix(`${prefix}/${shard}`);
      if (!listed.ok) continue;
      for (const o of listed.objects) {
        const created = Date.parse(o.created_at || o.updated_at || "");
        if (Number.isFinite(created) && created < cutoff) {
          expired.push({ key: `${prefix}/${shard}/${o.name}`, createdAt: o.created_at || o.updated_at || "" });
        }
      }
    }
    return { ok: true, objects: expired };
  }

  return {
    kind: "supabase",
    bucket, prefix, isPublic, ttlDays, configured,
    publicUrl, ensureBucket, put, putContentAddressed, get, del, listExpired, listPrefix,
  };
}

// ---------------------------------------------------------------------------
// IN-MEMORY STORE — used by the proof script and the unit tests so the whole
// snapshot/localize/sweep logic can be exercised with no network and no creds.
// It implements the SAME interface, keyed the SAME way, so a test proves the
// exact code path the Supabase store runs in production.
// ---------------------------------------------------------------------------
function createMemoryAssetStore({ prefix = CLIENT_ASSETS_PREFIX, isPublic = true, ttlDays = null, host = "our-cdn.wss-ai.com", now = Date.now } = {}) {
  const objects = new Map(); // key -> { buffer, contentType, createdAt, sourceUrl }
  function publicUrl(objectPath) {
    return isPublic && objectPath ? `https://${host}/${objectPath}` : "";
  }
  return {
    kind: "memory",
    prefix, isPublic, ttlDays, configured: true,
    _objects: objects,
    publicUrl,
    async ensureBucket() { return { ok: true, created: false }; },
    async put(sourceUrl, buffer, { ext = "", contentType = "" } = {}) {
      if (!buffer || !buffer.length) return { ok: false, reason: "empty_upload" };
      const useExt = KNOWN_EXTS.has(String(ext).toLowerCase()) ? String(ext).toLowerCase()
        : extFromContentType(contentType) || extFromUrl(sourceUrl) || "bin";
      const objectPath = assetKeyForUrl(sourceUrl, { prefix, ext: useExt });
      if (!objectPath) return { ok: false, reason: "unkeyable_source_url" };
      objects.set(objectPath, {
        buffer: Buffer.from(buffer),
        contentType: contentType || contentTypeForExt(useExt),
        createdAt: new Date(now()).toISOString(),
        sourceUrl: normalizeAssetUrl(sourceUrl),
      });
      return { ok: true, key: objectPath, bytes: buffer.length, publicUrl: publicUrl(objectPath) };
    },
    async putContentAddressed(buffer, { sha256 = "", ext = "", contentType = "" } = {}) {
      if (!buffer || !buffer.length) return { ok: false, reason: "empty_upload" };
      const digest = String(sha256 || "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(digest)) return { ok: false, reason: "sha256_invalid" };
      if (createHash("sha256").update(buffer).digest("hex") !== digest) {
        return { ok: false, reason: "sha256_mismatch" };
      }
      const useExt = KNOWN_EXTS.has(String(ext).toLowerCase()) ? String(ext).toLowerCase()
        : extFromContentType(contentType) || "bin";
      const objectPath = assetKeyForSha256(digest, { prefix, ext: useExt });
      const existing = objects.get(objectPath);
      if (existing && createHash("sha256").update(existing.buffer).digest("hex") !== digest) {
        return { ok: false, reason: "content_address_collision" };
      }
      if (!existing) {
        objects.set(objectPath, {
          buffer: Buffer.from(buffer),
          contentType: contentType || contentTypeForExt(useExt),
          createdAt: new Date(now()).toISOString(),
          sourceUrl: "",
        });
      }
      return {
        ok: true,
        key: objectPath,
        bytes: buffer.length,
        publicUrl: publicUrl(objectPath),
        reused: Boolean(existing),
      };
    },
    async get(sourceUrl) {
      const digest = sourceFingerprint(sourceUrl);
      if (!digest) return { ok: false, reason: "unkeyable_source_url" };
      for (const [k, v] of objects) {
        if (k.includes(`/${digest.slice(0, 2)}/${digest}.`)) {
          return { ok: true, buffer: v.buffer, contentType: v.contentType, key: k };
        }
      }
      return { ok: false, reason: "not_stored", status: 404 };
    },
    async del(objectPath) {
      return objects.delete(objectPath) ? { ok: true } : { ok: false, reason: "no_key" };
    },
    async listExpired(nowMs = now()) {
      if (!Number.isFinite(ttlDays) || ttlDays <= 0) return { ok: true, objects: [] };
      const cutoff = nowMs - ttlDays * 86_400_000;
      const out = [];
      for (const [k, v] of objects) {
        const created = Date.parse(v.createdAt || "");
        if (Number.isFinite(created) && created < cutoff) out.push({ key: k, createdAt: v.createdAt });
      }
      return { ok: true, objects: out };
    },
  };
}

/**
 * The two stores a caller normally wants, wired from env. Permanent bucket is
 * public (a live customer site serves from it); snapshot bucket is private and
 * TTL-bounded.
 */
function defaultAssetStores(env = process.env, fetchImpl = fetch) {
  return {
    permanent: createSupabaseAssetStore({
      bucket: CLIENT_ASSETS_BUCKET, prefix: CLIENT_ASSETS_PREFIX,
      isPublic: true, ttlDays: null, env, fetchImpl,
    }),
    snapshot: createSupabaseAssetStore({
      bucket: ASSET_SNAPSHOTS_BUCKET, prefix: ASSET_SNAPSHOTS_PREFIX,
      isPublic: false, ttlDays: SNAPSHOT_TTL_DAYS, env, fetchImpl,
    }),
  };
}

module.exports = {
  CLIENT_ASSETS_BUCKET,
  CLIENT_ASSETS_PREFIX,
  ASSET_SNAPSHOTS_BUCKET,
  ASSET_SNAPSHOTS_PREFIX,
  SNAPSHOT_TTL_DAYS,
  KNOWN_EXTS,
  normalizeAssetUrl,
  extFromUrl,
  extFromContentType,
  contentTypeForExt,
  assetKeyForUrl,
  assetKeyForSha256,
  sourceFingerprint,
  createSupabaseAssetStore,
  createMemoryAssetStore,
  defaultAssetStores,
};
