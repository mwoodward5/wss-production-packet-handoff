"use strict";

// lib/asset-ownership.js — the two moments a prospect's photographs stop being
// hotlinks and start being OURS to keep.
//
//   snapshotReferencedAssets(...)  at QUALIFY (only when we email a prospect):
//     a private, TTL-bounded copy of the exact bytes we referenced, so a
//     customer who cancels their old host the day before they call still has
//     their photographs. Non-converters expire and delete themselves.
//
//   localizeBuild(...)             at SIGNUP (checkout/fulfillment):
//     download every referenced photograph (prefer the snapshot — free, and it
//     survives the old site going dark), upload to OUR permanent public bucket,
//     and REWRITE the build so every image points at our host. Cuts the
//     dependency on the old site that dies when they cancel it.
//
// FAIL-SAFE is absolute: if a photograph cannot be fetched and was never
// snapshotted, its slot is DROPPED so the renderer falls back to the client's
// accent/pattern (mirror-engine's empty-slot behaviour) — never a broken image,
// never a stock substitution. That is the SWAN DOCTRINE and the TRUTH LAW: a
// published image is this client's own or it is absent.
//
// Storage lives in client-asset-store.js; this file is pure orchestration and
// takes its stores + fetch injected, so the whole thing runs hermetically in a
// test with an in-memory store and a fake fetch.

const { normalizeAssetUrl, extFromUrl, extFromContentType } = require("./client-asset-store");

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|avif|gif|svg|bmp|ico|mp4|webm|mov|m4v)(?:$|[?#])/i;

// Hosts that are ALREADY ours — never localize (or snapshot) these; they are the
// idempotency guard that makes localize a no-op on a build that already ran.
const DEFAULT_OUR_HOSTS = [
  "wss-ai.com",
  "supabase.co",
  "supabase.in",
];

function hostOf(url) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(url)) ? String(url) : `https://${url}`)
      .hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isOurHost(url, ourHosts = DEFAULT_OUR_HOSTS) {
  const h = hostOf(url);
  if (!h) return false;
  return ourHosts.some((own) => h === own || h.endsWith(`.${own}`));
}

function isHttpImageUrl(url) {
  const s = String(url || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  // Accept anything with a known media extension in the PATH, or a bare path
  // with no extension (many CDN image URLs omit it) — the localize fetch will
  // confirm the content-type and a non-image simply fails the fetch gate.
  return IMAGE_EXT_RE.test(s) || !/\.[a-z0-9]{2,5}(?:$|[?#])/i.test(s);
}

function logoUrlOf(brand = {}) {
  const logo = brand && brand.logo;
  if (typeof logo === "string") return logo;
  if (logo && typeof logo === "object" && typeof logo.url === "string") return logo.url;
  return "";
}

/**
 * Every their-host image URL a build references, deduped by RAW spelling and
 * tagged with the role it plays so the rewrite can drop a slot correctly.
 *
 * roles: "logo" | "brand_photo" | "photo_bank" | "html"
 */
function collectAssetUrls(build = {}, { html = "", ourHosts = DEFAULT_OUR_HOSTS } = {}) {
  const out = [];
  const seen = new Set();
  const add = (url, role) => {
    const raw = String(url || "").trim();
    if (!raw || seen.has(raw)) return;
    if (!isHttpImageUrl(raw)) return;
    if (isOurHost(raw, ourHosts)) return; // already ours — nothing to take
    seen.add(raw);
    out.push({ url: raw, role, norm: normalizeAssetUrl(raw) });
  };

  const brand = build.brand || {};
  add(logoUrlOf(brand), "logo");
  for (const u of Array.isArray(brand.photos) ? brand.photos : []) add(u, "brand_photo");

  const banks = [brand.photo_bank, build.photo_bank].filter((b) => b && Array.isArray(b.photos));
  for (const bank of banks) for (const p of bank.photos) add(p && p.url, "photo_bank");

  if (html) {
    const re = /(?:src|srcset|href|content|url\()\s*=?\s*["'(]?\s*(https?:\/\/[^"')\s>]+)/gi;
    let m;
    while ((m = re.exec(html))) if (isHttpImageUrl(m[1])) add(m[1], "html");
  }
  return out;
}

function deepClone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Rewrite a build in place-of-a-clone using a raw-url -> destination map, where
 * a destination of null means DROP THE SLOT (fail-safe).
 *
 * Known slots get correct drop semantics: a dropped brand photo or photo_bank
 * row is removed from its array; a dropped logo is unset so the renderer uses
 * the monogram/accent it already falls back to. A generic deep-walk then swaps
 * any REMAINING string that equals a localized url (design-brief hero fields,
 * etc.) — but only for kept assets, since a stray metadata reference to a
 * dropped url renders nothing and is not a broken <img>.
 */
function applyBuildRewrites(build, rewrites) {
  const to = new Map();       // raw url -> destination (string) — kept only
  const dropped = new Set();  // raw urls that fell back
  for (const r of rewrites) {
    if (r.to) to.set(r.from, r.to);
    else dropped.add(r.from);
  }
  const clone = deepClone(build);
  const brand = clone.brand || (clone.brand = {});

  // logo
  const logo = logoUrlOf(brand);
  if (logo && (to.has(logo) || dropped.has(logo))) {
    if (to.has(logo)) {
      if (typeof brand.logo === "object" && brand.logo) brand.logo.url = to.get(logo);
      else brand.logo = to.get(logo);
    } else {
      delete brand.logo; // fail-safe: monogram/accent
    }
  }

  // brand.photos (array of strings)
  if (Array.isArray(brand.photos)) {
    brand.photos = brand.photos
      .map((u) => (to.has(u) ? to.get(u) : dropped.has(u) ? null : u))
      .filter((u) => typeof u === "string" && u.length > 0);
  }

  // photo_bank rows (brand + top-level)
  for (const bank of [brand.photo_bank, clone.photo_bank]) {
    if (!bank || !Array.isArray(bank.photos)) continue;
    bank.photos = bank.photos.filter((p) => !(p && dropped.has(p.url)));
    for (const p of bank.photos) if (p && to.has(p.url)) p.url = to.get(p.url);
    if (bank.counts && typeof bank.counts === "object") {
      bank.counts.kept = bank.photos.length;
      bank.counts.own_site = bank.photos.filter((p) => p && p.source === "own_site").length;
      bank.counts.gbp = bank.photos.filter((p) => p && p.source === "gbp").length;
    }
  }

  // generic deep-walk for any remaining kept-url strings (metadata heroes, etc.)
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === "string" && to.has(node[i])) node[i] = to.get(node[i]);
        else walk(node[i]);
      }
      return;
    }
    for (const k of Object.keys(node)) {
      if (typeof node[k] === "string" && to.has(node[k])) node[k] = to.get(node[k]);
      else walk(node[k]);
    }
  };
  walk(clone);
  return clone;
}

/** Swap kept urls inside an HTML/DOM string, and for a DROPPED url strip the
 *  <img>/<source> element that referenced it and neutralise any
 *  background-image url() — so the DOM fail-safe matches the build fail-safe: a
 *  dead photograph becomes ABSENT (the container's accent/pattern shows
 *  through), never a broken image. */
function rewriteHtmlAssetUrls(html, rewrites) {
  let out = String(html || "");
  const dropped = [];
  for (const r of rewrites) {
    if (r.to) out = out.split(r.from).join(r.to);
    else if (r.from) dropped.push(r.from);
  }
  for (const url of dropped) out = stripMediaReferencing(out, url);
  return out;
}

/** Remove every <img>/<source> whose tag text references `url`, and blank any
 *  CSS background-image that points at it. Conservative: only touches media
 *  elements and url() references, never surrounding markup. */
function stripMediaReferencing(html, url) {
  if (!url) return html;
  let out = String(html).replace(/<(img|source)\b[^>]*>/gi, (tag) => (tag.includes(url) ? "" : tag));
  for (const q of ["", "'", '"']) out = out.split(`url(${q}${url}${q})`).join("url()");
  return out;
}

async function fetchBytes(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 WSSLabs-asset-ownership" },
    });
    if (!res.ok) return { ok: false, status: res.status, reason: `http_${res.status}` };
    const ct = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") || "" : "";
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (!buffer.length) return { ok: false, status: res.status, reason: "empty_body" };
    return { ok: true, status: res.status, buffer, contentType: ct };
  } catch (err) {
    return { ok: false, status: 0, reason: String((err && err.message) || err).slice(0, 120) };
  }
}

/**
 * SNAPSHOT INSURANCE — run only when we EMAIL a prospect (~1 in 12 mined). Copy
 * the raw bytes of every referenced photograph into the private, TTL-bounded
 * snapshot bucket, and record what was captured versus what had ALREADY 404'd
 * at snapshot time (so a later localize knows that slot was dead from the start,
 * not lost between snapshot and signup).
 */
async function snapshotReferencedAssets({
  build = null,
  urls = null,
  snapshotStore,
  fetchImpl = fetch,
  ourHosts = DEFAULT_OUR_HOSTS,
  now = () => new Date().toISOString(),
} = {}) {
  if (!snapshotStore) throw new Error("snapshotReferencedAssets requires a snapshotStore");
  const refs = Array.isArray(urls)
    ? urls.filter((u) => isHttpImageUrl(u) && !isOurHost(u, ourHosts)).map((u) => ({ url: u, norm: normalizeAssetUrl(u) }))
    : collectAssetUrls(build || {}, { ourHosts });

  // one fetch per distinct photograph
  const byNorm = new Map();
  for (const r of refs) if (r.norm && !byNorm.has(r.norm)) byNorm.set(r.norm, r);

  const snapshotted = [];
  const dead = [];
  const errors = [];
  let bytes = 0;
  for (const { url } of byNorm.values()) {
    const got = await fetchBytes(url, fetchImpl);
    if (!got.ok) {
      if (got.status === 404 || got.status === 410) dead.push({ url, status: got.status });
      else errors.push({ url, reason: got.reason, status: got.status });
      continue;
    }
    const ext = extFromContentType(got.contentType) || extFromUrl(url) || "bin";
    const put = await snapshotStore.put(url, got.buffer, { ext, contentType: got.contentType });
    if (put.ok) {
      snapshotted.push({ url, key: put.key, bytes: put.bytes });
      bytes += put.bytes || 0;
    } else {
      errors.push({ url, reason: put.reason });
    }
  }
  return {
    attempted: byNorm.size,
    snapshotted,
    dead,          // already 404/410 at snapshot time — logged, not an error
    errors,        // transient/store failures — worth a retry
    bytes,
    ttlDays: snapshotStore.ttlDays || null,
    capturedAt: now(),
  };
}

/**
 * LOCALIZE ON SIGNUP — take ownership of a paying customer's photographs.
 *
 * For every their-host image the build references: fetch the bytes (a prior
 * snapshot first, then the live site), upload to our permanent public bucket,
 * and record the rewrite their-host -> our-host. Return a NEW build with every
 * resolvable url rewritten and every unresolvable slot dropped (fail-safe).
 *
 * @returns {Promise<{build, html?, rewrites, localized, fellBack, attempted, ourHost, usedSnapshot}>}
 */
async function localizeBuild({
  build = {},
  html = "",
  permanentStore,
  snapshotStore = null,
  fetchImpl = fetch,
  ourHosts = null,
} = {}) {
  if (!permanentStore) throw new Error("localizeBuild requires a permanentStore");
  const ourHost = hostOf(permanentStore.publicUrl ? permanentStore.publicUrl("probe") : "") || "";
  const hosts = Array.isArray(ourHosts) ? ourHosts : [...DEFAULT_OUR_HOSTS, ...(ourHost ? [ourHost] : [])];

  const refs = collectAssetUrls(build, { html, ourHosts: hosts });
  const byNorm = new Map();
  for (const r of refs) {
    if (!r.norm) continue;
    if (!byNorm.has(r.norm)) byNorm.set(r.norm, []);
    byNorm.get(r.norm).push(r);
  }

  const rewrites = [];   // { from, to|null, role, reason?, via? }
  const fellBack = [];
  let usedSnapshot = 0;
  let localized = 0;

  for (const group of byNorm.values()) {
    const primary = group[0];
    const url = primary.url;
    let via = "live";
    let got = null;

    if (snapshotStore) {
      const fromSnap = await snapshotStore.get(url);
      if (fromSnap.ok) { got = { ok: true, buffer: fromSnap.buffer, contentType: fromSnap.contentType }; via = "snapshot"; usedSnapshot++; }
    }
    if (!got || !got.ok) got = await fetchBytes(url, fetchImpl);

    if (!got.ok) {
      // FAIL-SAFE: dead source and no snapshot — drop every spelling of it.
      for (const r of group) { rewrites.push({ from: r.url, to: null, role: r.role, reason: got.reason || "unfetchable" }); }
      fellBack.push({ url, reason: got.reason || "unfetchable", roles: group.map((r) => r.role) });
      continue;
    }
    const ext = extFromContentType(got.contentType) || extFromUrl(url) || "bin";
    const put = await permanentStore.put(url, got.buffer, { ext, contentType: got.contentType });
    if (!put.ok || !put.publicUrl) {
      for (const r of group) rewrites.push({ from: r.url, to: null, role: r.role, reason: put.reason || "store_no_public_url" });
      fellBack.push({ url, reason: put.reason || "store_no_public_url", roles: group.map((r) => r.role) });
      continue;
    }
    localized++;
    for (const r of group) rewrites.push({ from: r.url, to: put.publicUrl, role: r.role, via });
  }

  const rewrittenBuild = applyBuildRewrites(build, rewrites);
  const rewrittenHtml = html ? rewriteHtmlAssetUrls(html, rewrites) : undefined;

  return {
    build: rewrittenBuild,
    ...(html ? { html: rewrittenHtml } : {}),
    rewrites,
    localized,
    fellBack,
    attempted: byNorm.size,
    usedSnapshot,
    ourHost,
  };
}

/**
 * TTL sweep — delete snapshots older than the store's TTL. A prospect who
 * converted was localized long ago, so their snapshots being swept is fine; a
 * prospect who never answered has their insurance copy quietly deleted, keeping
 * cold storage bounded. Never throws.
 */
async function sweepExpiredSnapshots({ snapshotStore, nowMs = Date.now() } = {}) {
  if (!snapshotStore) throw new Error("sweepExpiredSnapshots requires a snapshotStore");
  const listed = await snapshotStore.listExpired(nowMs);
  if (!listed.ok) return { ok: false, reason: listed.reason, deleted: 0, failed: 0 };
  let deleted = 0;
  const failures = [];
  for (const obj of listed.objects) {
    const res = await snapshotStore.del(obj.key);
    if (res.ok) deleted++;
    else failures.push({ key: obj.key, reason: res.reason });
  }
  return { ok: true, deleted, failed: failures.length, failures, examined: listed.objects.length };
}

module.exports = {
  DEFAULT_OUR_HOSTS,
  isOurHost,
  isHttpImageUrl,
  collectAssetUrls,
  applyBuildRewrites,
  rewriteHtmlAssetUrls,
  snapshotReferencedAssets,
  localizeBuild,
  sweepExpiredSnapshots,
};
