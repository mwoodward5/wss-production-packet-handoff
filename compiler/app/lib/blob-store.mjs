// Vercel Blob persistence for serverless deployments. Uses the raw Blob REST
// API (no SDK) with BLOB_READ_WRITE_TOKEN. All paths are prefixed "sf/".
const TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN || "";
export const BLOB_ENABLED = () => Boolean(TOKEN());
const API = "https://blob.vercel-storage.com";
const DELETE_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function validControlToken(token = "") {
  // Treat blank, whitespace, and obviously truncated values as disabled
  // rather than issuing an anonymous request that could hide a cleanup leak.
  // Store ids are not uniformly embedded in every valid Vercel token format.
  // Do not include token material in errors or logs.
  return /^[A-Za-z0-9._-]{8,}$/.test(String(token));
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let baseUrl = null; // https://<store>.public.blob.vercel-storage.com

export async function blobPut(pathname, body, contentType = "application/octet-stream") {
  const r = await fetch(`${API}/sf/${pathname}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${TOKEN()}`,
      "x-api-version": "7",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "content-type": contentType,
    },
    body,
  });
  if (!r.ok) throw new Error(`blob put ${pathname}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  const data = await r.json();
  if (!baseUrl) baseUrl = data.url.slice(0, data.url.indexOf("/sf/"));
  return data.url;
}

export async function blobPutIfMatch(pathname, body, contentType = "application/octet-stream", ifMatch = "") {
  if (!ifMatch) return { ok: false, conflict: true, reason: "missing_etag" };
  const token = TOKEN();
  const storeId = token.split("_")[3] || "";
  const api = process.env.VERCEL_BLOB_API_URL || "https://vercel.com/api/blob";
  const requestId = `${storeId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const url = new URL(api);
  url.searchParams.set("pathname", `sf/${pathname}`);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "12",
      "x-api-blob-request-id": requestId,
      "x-api-blob-request-attempt": "0",
      "x-vercel-blob-store-id": storeId,
      "x-vercel-blob-access": "public",
      "x-content-type": contentType,
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-if-match": ifMatch,
    },
    body,
  });
  if (response.status === 412) return { ok: false, conflict: true, reason: "etag_mismatch" };
  if (!response.ok) throw new Error(`blob conditional put ${pathname}: ${response.status} ${(await response.text()).slice(0, 120)}`);
  const data = await response.json();
  if (!baseUrl && data.url?.includes("/sf/")) baseUrl = data.url.slice(0, data.url.indexOf("/sf/"));
  return { ok: true, url: data.url || "", etag: data.etag || ifMatch };
}

export async function blobGet(pathname) {
  if (!baseUrl) {
    // discover base url via list API once
    const r = await fetch(`${API}?prefix=sf/&limit=1`, { headers: { authorization: `Bearer ${TOKEN()}`, "x-api-version": "7" } });
    if (r.ok) { const d = await r.json(); if (d.blobs?.[0]?.url) baseUrl = d.blobs[0].url.slice(0, d.blobs[0].url.indexOf("/sf/")); }
    if (!baseUrl) return null;
  }
  // Cache-bust: public blob URLs sit behind a CDN with propagation lag, and a
  // stale read of a coordination record (jobs/<id>.json) defeats lease guards
  // — pollers re-kick already-leased stages and supersede live request ids.
  // A unique query string makes every read an origin fetch.
  const bust = `_ts=${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const r = await fetch(`${baseUrl}/sf/${pathname}?${bust}`, { cache: "no-store" });
  return r.ok ? r : null;
}

// Public CDN URL for an uploaded blob (only meaningful after at least one
// put/list resolved the store base URL). Used to hand durable first-party
// artifact URLs (QC screenshots) to downstream consumers like Ghost outreach.
export function blobPublicUrl(pathname) {
  return baseUrl ? `${baseUrl}/sf/${String(pathname || "").replace(/^\/+/, "")}` : "";
}

export async function blobDelete(pathname) {
  if (!baseUrl) return { ok: false, deleted: 0, reason: "missing_base_url", attempts: 0 };
  return blobDeleteUrls([`${baseUrl}/sf/${pathname}`]);
}

export async function blobList(prefix) {
  const url = new URL(API);
  url.searchParams.set("prefix", `sf/${String(prefix || "").replace(/^\/+/, "")}`);
  url.searchParams.set("limit", "1000");
  const r = await fetch(url, { headers: { authorization: `Bearer ${TOKEN()}`, "x-api-version": "7" } });
  if (!r.ok) return [];
  const d = await r.json();
  if (d.blobs?.[0]?.url && !baseUrl) baseUrl = d.blobs[0].url.slice(0, d.blobs[0].url.indexOf("/sf/"));
  return d.blobs ?? [];
}
export async function blobDeleteUrls(urls) {
  const uniqueUrls = [...new Set((urls || []).filter((url) => typeof url === "string" && /^https:\/\//.test(url)))];
  if (!uniqueUrls.length) return { ok: true, deleted: 0, attempts: 0 };
  const token = TOKEN();
  if (!validControlToken(token)) return { ok: false, deleted: 0, reason: "invalid_blob_token", attempts: 0 };

  let lastStatus = 0;
  for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt += 1) {
    let response = null;
    try {
      response = await fetch(`${API}/delete`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "x-api-version": "7", "content-type": "application/json" },
        body: JSON.stringify({ urls: uniqueUrls }),
      });
    } catch {
      // Network failures are retryable, but we still return a verifiable
      // failure to the caller rather than silently dropping cleanup.
    }
    lastStatus = response?.status || 0;
    if (response?.ok) return { ok: true, deleted: uniqueUrls.length, attempts: attempt, status: lastStatus };
    if (attempt < DELETE_ATTEMPTS && (!response || RETRYABLE_STATUS.has(lastStatus))) {
      await pause(20 * attempt);
      continue;
    }
    break;
  }
  return { ok: false, deleted: 0, attempts: DELETE_ATTEMPTS, status: lastStatus, reason: lastStatus ? "delete_http_failed" : "delete_network_failed" };
}

// Upload a whole directory (site bundle) under a prefix.
export async function blobUploadDir(dir, prefix) {
  const { readdirSync, statSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".txt": "text/plain" };
  const walk = async (d, base = "") => {
    for (const name of readdirSync(d)) {
      const fp = path.join(d, name);
      const rel = base ? `${base}/${name}` : name;
      if (statSync(fp).isDirectory()) await walk(fp, rel);
      else await blobPut(`${prefix}/${rel}`, readFileSync(fp), MIME[path.extname(name).toLowerCase()] || "application/octet-stream");
    }
  };
  await walk(dir);
}

export async function blobDownloadDir(prefix, dir) {
  const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const path = await import("node:path");
  const cleanPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  if (!cleanPrefix) throw new Error("blobDownloadDir requires a prefix");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const blobs = await blobList(`${cleanPrefix}/`);
  for (const blob of blobs) {
    const pathname = String(blob.pathname || "");
    const marker = `/sf/${cleanPrefix}/`;
    let rel = "";
    if (pathname.includes(marker)) rel = pathname.slice(pathname.indexOf(marker) + marker.length);
    else {
      const urlPath = new URL(blob.url).pathname;
      rel = urlPath.includes(marker) ? urlPath.slice(urlPath.indexOf(marker) + marker.length) : "";
    }
    if (!rel || rel.endsWith("/")) continue;
    const separator = blob.url.includes("?") ? "&" : "?";
    const response = await fetch(`${blob.url}${separator}_ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`blob download ${rel}: HTTP ${response.status}`);
    const target = path.resolve(dir, rel);
    const root = path.resolve(dir);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
}
