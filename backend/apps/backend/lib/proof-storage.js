"use strict";

// lib/proof-storage.js — the ONE place that decides where a proof shot lives.
//
// Why this file exists at all:
//
//   The email's before/after images used to be captured INLINE inside
//   /api/media/preview-shot. That can never work. The capture needs Playwright's
//   Chromium, and that browser lives in a machine-level cache (~1.4 GB) that is
//   never inside node_modules — so it is never in the deployment bundle, so the
//   lambda always fell through to the 42-byte spacer GIF. Every "before/after"
//   image in every email was an invisible pixel.
//
//   The split is: capture happens OFF the request path (scripts/capture-proof-shots.js,
//   on a machine that actually has Chromium) and uploads to the public
//   'wss-proof-assets' Supabase bucket. The route becomes a signature-gated
//   read-through proxy that only ever does an HTTP GET. No browser, no bundle.
//
// The contract that makes this work is the OBJECT KEY: the writer and the
// reader must derive the same path from the same inputs without talking to each
// other. That is what normalizeProofUrl + proofObjectPath are, and why they live
// here instead of being duplicated on both sides.

const { createHash } = require("node:crypto");

const PROOF_BUCKET = "wss-proof-assets";
const PROOF_PREFIX = "preview-shots";

// Variants are APPEND-ONLY. The object key is sha256(url|variant), so renaming
// or reordering an existing entry orphans every shot already in the bucket and
// silently puts the 42-byte spacer back into live emails.
//
// The "-mobile" pair exists because a phone frame is a DIFFERENT PICTURE of the
// same URL, not a resize of the desktop one: a responsive site reflows, and the
// whole point of showing the owner a mobile shot is to prove the reflow happened.
// Keying it as its own variant is what stops it overwriting the desktop shot.
const VARIANTS = ["old", "new", "gif", "old-mobile", "new-mobile", "face-0", "face-1"];

/**
 * Canonical form of a captured URL.
 *
 * Two spellings of the same page ("https://Example.com" vs
 * "https://www.example.com/") must produce ONE stored object, otherwise the
 * writer uploads to one key and the reader misses on another and the email
 * silently shows a spacer again. Deliberately conservative: it folds only the
 * differences that cannot change which page is served.
 */
function normalizeProofUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return "";
  }
  if (!/^https?:$/i.test(u.protocol)) return "";

  // http and https of the same host are the same page for our purposes (and the
  // capture always follows the upgrade anyway).
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  u.port = "";
  u.hash = "";

  // Query order is not meaningful to a server; sort it so it cannot fork the key.
  const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);

  let path = u.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (path === "/") path = "";
  u.pathname = path;

  return `${u.protocol}//${u.hostname}${path}${u.search}`;
}

function normalizeVariant(v) {
  const s = String(v || "").trim().toLowerCase();
  return VARIANTS.includes(s) ? s : "new";
}

/**
 * Normalize the immutable identity of a shared-router release.
 *
 * The legacy proof contract has no site_id/release_id. That is a real mode,
 * not an incomplete shared identity, and callers must keep deriving the old
 * URL+variant key in that case. Once either shared identifier is present,
 * however, all three values are mandatory: silently falling back would let a
 * capture for one release overwrite another release at the same public URL.
 *
 * Accept the nested `proofIdentity` used by line-proof-shots and direct fields
 * for low-level callers. Values are trimmed but otherwise remain exact and
 * case-sensitive.
 */
function normalizeProofIdentity(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const nested = source.proofIdentity && typeof source.proofIdentity === "object"
    ? source.proofIdentity
    : source;
  const siteId = String(nested.site_id ?? nested.siteId ?? "").trim();
  const releaseId = String(nested.release_id ?? nested.releaseId ?? "").trim();
  const buildHash = String(nested.build_hash ?? nested.buildHash ?? "").trim();
  const requested = Boolean(siteId || releaseId);
  if (!requested) return { active: false, valid: true };
  if (!siteId || !releaseId || !buildHash) {
    return {
      active: true,
      valid: false,
      reason: "shared_proof_identity_incomplete",
      site_id: siteId,
      release_id: releaseId,
      build_hash: buildHash,
    };
  }
  return {
    active: true,
    valid: true,
    site_id: siteId,
    release_id: releaseId,
    build_hash: buildHash,
  };
}

// ---------------------------------------------------------------------------
// THE ONE WAY TO PHOTOGRAPH OUR OWN MIRROR
// ---------------------------------------------------------------------------
// A proof shot is a picture of the CLIENT'S site. Our sign-up panel, our chat
// widget and our lead-capture hook all check for this flag and take themselves
// off the page when they see it (mirror-engine/signup-floater.js,
// chat-widget.js, lead-capture.js).
//
// It lives HERE because the contract had three copies of the writer and only
// two of them were right. line-proof-shots.js and line-motion-shot.js each
// carried their own five-line builder; preview-visuals.js — the capture half
// scripts/capture-proof-shots.js runs, uploading to these very object keys —
// had NONE, so every shot it took included our upsell. That was survivable only
// while the panel was collapsed to a pill. The moment the panel opens by
// default (2026-08-10) the same hole photographs the client's ID card and mails
// it to the prospect. One writer, so a fourth camera cannot be built wrong.
//
// THE FLAG NEVER TOUCHES AN OBJECT KEY. normalizeProofUrl keeps query params
// (sorted) precisely so two different pages cannot collide — so a key derived
// from the flagged URL would fork away from every shot already stored. Keys are
// always derived from the clean URL; this string exists only on the navigation.
const PANEL_SUPPRESSION_FLAG = "wssthumb";

/**
 * The URL to NAVIGATE to when photographing one of our own mirrors.
 *
 * Only ever applied to OUR pages. A prospect's own website is fetched exactly
 * as it is — we do not add query parameters to a stranger's site.
 */
function suppressOurPanelsUrl(raw) {
  const input = String(raw || "");
  try {
    const u = new URL(input);
    u.searchParams.set(PANEL_SUPPRESSION_FLAG, "1");
    return u.toString();
  } catch {
    return input;
  }
}

// ---------------------------------------------------------------------------
// WHOSE SITE IS THIS A PICTURE OF?
//
// Byte-verifying a proof shot proves it is a JPEG. It does not prove it is the
// RIGHT business's website — and a "YOUR SITE TODAY" panel showing somebody
// else's homepage is the same defect class as a stale preview from a different
// business: an artifact attached to an email without checking that it belongs
// to the prospect.
//
// The gap is real and mundane. The object key is derived from the URL we MEANT
// to shoot; the bytes come from wherever the browser actually LANDED. A parked
// domain, an expired-and-resold domain, a redirect to a franchise portal, a
// hosting placeholder — all of them return a perfectly valid screenshot of a
// page that is not the prospect's. So the capture records where it landed, and
// the check compares that landing against the prospect's own domain.
// ---------------------------------------------------------------------------

// Multi-label public suffixes we actually meet. Deliberately short: a wrong
// entry here can only make the check STRICTER (two hosts stop matching), never
// looser, because an unknown suffix falls back to the last two labels.
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk", "co.nz", "co.za", "co.jp",
  "com.au", "net.au", "org.au", "com.br", "com.mx", "com.sg", "co.in", "com.tr",
]);

/**
 * eTLD+1 of a URL or bare host. "https://www.Flint-Plumb.com/austin" ->
 * "flint-plumb.com". Subdomains are folded deliberately: a prospect's shot may
 * legitimately land on www., on a locale subdomain, or on their booking
 * subdomain, and none of those make it somebody else's site.
 */
function registrableDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let host;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return "";
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function sameRegistrableDomain(a, b) {
  const x = registrableDomain(a);
  const y = registrableDomain(b);
  return Boolean(x) && x === y;
}

/**
 * FAIL CLOSED. A before-image may be attached only when we can SHOW that its
 * captured page belongs to this prospect. "We never recorded where it landed"
 * is not evidence of a match — it is the absence of evidence, and it is exactly
 * the state every shot captured before this check existed was in.
 *
 * @returns {{ok:boolean, reason?:string, captured?:string, expected?:string}}
 */
function capturedShotBelongsTo({ capturedUrl = "", expectedWebsite = "" } = {}) {
  const expected = registrableDomain(expectedWebsite);
  if (!expected) return { ok: false, reason: "prospect_has_no_current_website" };
  const captured = registrableDomain(capturedUrl);
  if (!captured) return { ok: false, reason: "capture_source_unrecorded", expected };
  if (captured !== expected) {
    return { ok: false, reason: "capture_domain_mismatch", captured, expected };
  }
  return { ok: true, captured, expected };
}

/**
 * The sidecar that makes the check above possible: a small JSON object stored
 * NEXT TO the image, at the same content-addressed key, recording the URL the
 * browser actually landed on. Same key derivation as the image, so the writer
 * and the reader still never have to talk to each other.
 */
function proofMetaPath(input = {}) {
  const object = proofObjectPath(input);
  return object ? object.replace(/\.(jpg|gif)$/, ".json") : "";
}

/**
 * Stable, cacheable storage path for one shot.
 *
 * Legacy mode remains sha256(normalizedUrl + "|" + variant), byte-for-byte.
 * A shared-router new-site shot adds its complete immutable
 * {site_id,release_id,build_hash} tuple to the digest input. The public URL may
 * stay fixed while releases change, so each release must get a distinct key.
 *
 * THE EXTENSION FOLLOWS THE BYTES. Every variant but one is a JPEG; "gif" is an
 * animated loop of our own mirror (lib/line-motion-shot). This used to hard-code
 * .jpg for all five, so the writer had to rename the key by hand on its way out
 * and the READER — api/media/preview-shot, which derives the path from this
 * function alone — looked for the loop at `…/gif/<sha>.jpg` and found nothing.
 * The digest input is unchanged, so every JPEG already in the bucket keeps its
 * key; only the name the GIF was never able to agree on moves.
 */
function proofObjectPath(input = {}) {
  const { url, variant = "new" } = input;
  const norm = normalizeProofUrl(url);
  if (!norm) return "";
  const kind = normalizeVariant(variant);
  let keyMaterial = `${norm}|${kind}`;
  if (/^new(-|$)/.test(kind)) {
    const identity = normalizeProofIdentity(input);
    if (!identity.valid) return "";
    if (identity.active) {
      // Length-prefix each exact value so embedded separators cannot make two
      // different tuples hash to the same key material.
      const field = (name, value) => `${name}:${Buffer.byteLength(value, "utf8")}:${value}`;
      keyMaterial += `|${field("site_id", identity.site_id)}|${field("release_id", identity.release_id)}|${field("build_hash", identity.build_hash)}`;
    }
  }
  const digest = createHash("sha256").update(keyMaterial).digest("hex");
  return `${PROOF_PREFIX}/${kind}/${digest}.${kind === "gif" ? "gif" : "jpg"}`;
}

/**
 * Which URL a given variant is a picture OF.
 *
 * Matches the "old" FAMILY, not the literal string: "old-mobile" is still a
 * picture of the prospect's current website. An equality check here would have
 * pointed the mobile "before" shot at the NEW site, producing a before/after
 * that shows the new site twice — the exact bug the `v` parameter comment in
 * preview-visuals.js already records once.
 */
function urlForVariant({ variant, previewUrl = "", currentWebsite = "" } = {}) {
  return /^old(-|$)/.test(normalizeVariant(variant)) ? String(currentWebsite || "") : String(previewUrl || "");
}

function supabaseBase() {
  const url = process.env.SUPABASE_URL || process.env.CALLPREP_SUPABASE_URL || "";
  return String(url).replace(/\/+$/, "");
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "";
}

/**
 * Public (unauthenticated) URL of a stored shot. The bucket is public, so the
 * READ path needs no key at all — only the project URL. That is what lets the
 * proxy run in a lambda that holds no storage credentials.
 */
function publicProofUrl(objectPath) {
  const override = String(process.env.WSS_PROOF_ASSETS_BASE_URL || "").replace(/\/+$/, "");
  if (override) return `${override}/${objectPath}`;
  const base = supabaseBase();
  if (!base || !objectPath) return "";
  return `${base}/storage/v1/object/public/${PROOF_BUCKET}/${objectPath}`;
}

/**
 * Read one stored shot. Never throws — a miss and a network failure are the
 * same thing to the caller (serve the spacer, retry later).
 *
 * `bust` IS THE WHOLE POINT OF THE PIXEL DIGEST, AND IT WAS STOPPING ONE HOP
 * SHORT. An object path is a hash of the URL, so a re-captured mirror writes new
 * bytes to the SAME path, and shots are stored with a week of Cache-Control.
 * Supabase's CDN therefore keeps answering with the PRE-REBUILD picture — the
 * same `cf-cache-status: HIT` this file already documents for sidecars. The
 * email's `c=<pixel digest>` minted a new URL for our edge and our warm cache,
 * but the lambda then fetched the identical Supabase URL underneath, so the
 * stale body came back anyway. Measured on the live bucket: ten mirrors were
 * re-captured, and eight still served the old dark hero afterwards. Carrying
 * the digest into the storage read makes it a new CDN key too, which is the
 * only hop that was missing.
 * @returns {Promise<{ok:boolean, status:number, buffer?:Buffer, contentType?:string, reason?:string}>}
 */
async function fetchProofShot(objectPath, { timeoutMs = 6000, bust = "" } = {}) {
  const base = publicProofUrl(objectPath);
  if (!base) return { ok: false, status: 0, reason: "storage_not_configured" };
  // Only a digest-shaped value is ever appended, so a caller cannot smuggle
  // arbitrary query into a storage read.
  const safeBust = /^[0-9a-f]{6,64}$/i.test(String(bust || "")) ? String(bust) : "";
  const url = safeBust ? `${base}${base.includes("?") ? "&" : "?"}c=${safeBust}` : base;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { ok: false, status: res.status, reason: `storage_${res.status}` };
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (!buffer.length) return { ok: false, status: res.status, reason: "storage_empty" };
    return {
      ok: true,
      status: res.status,
      buffer,
      contentType: res.headers.get("content-type") || "image/jpeg",
    };
  } catch (err) {
    return { ok: false, status: 0, reason: String((err && err.message) || err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort create of the public bucket. Idempotent; "already exists" is fine. */
async function ensureProofBucket() {
  const base = supabaseBase();
  const key = serviceKey();
  if (!base || !key) return { ok: false, reason: "storage_not_configured" };
  try {
    const res = await fetch(`${base}/storage/v1/bucket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ id: PROOF_BUCKET, name: PROOF_BUCKET, public: true }),
    });
    const body = await res.text().catch(() => "");
    if (res.ok) return { ok: true, created: true };
    if (/already exists|Duplicate/i.test(body)) return { ok: true, created: false };
    return { ok: false, reason: `${res.status} ${body}`.slice(0, 160) };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
  }
}

// How long the CDN may hold each kind of object.
//
// PICTURES: a week. They are effectively immutable per capture, and the email's
// <img> carries a `c=<pixel digest>` parameter that mints a new URL whenever the
// pixels change, so a long cache costs nothing and saves every re-read.
//
// SIDECARS: a minute. The little JSON beside each image is not a payload, it is
// an ANSWER — where the browser landed, what the pixels hash to, which build it
// is a picture of — and both the reuse decision and the before-shot identity
// gate read it to decide what to do NEXT. Measured on the live bucket: a sidecar
// re-uploaded seconds earlier still came back `cf-cache-status: HIT` with the
// previous body, so a week-long cache means a decision made on a stale answer.
// It is a few hundred bytes read a handful of times per prospect; there is
// nothing to save here and a correctness window to close.
const SHOT_CACHE_CONTROL = "public, max-age=604800";
const META_CACHE_CONTROL = "public, max-age=60";

/** Write one shot. Upsert, so a re-capture replaces the old picture in place. */
async function uploadProofShot(objectPath, buffer, { contentType = "image/jpeg", cacheControl = "" } = {}) {
  const base = supabaseBase();
  const key = serviceKey();
  if (!base || !key) return { ok: false, reason: "storage_not_configured" };
  if (!objectPath || !buffer || !buffer.length) return { ok: false, reason: "empty_upload" };
  // The default follows the BYTES, so a caller cannot accidentally give a
  // sidecar a week of cache by forgetting to say otherwise.
  const cache = cacheControl
    || (/\.json$/i.test(objectPath) ? META_CACHE_CONTROL : SHOT_CACHE_CONTROL);
  try {
    const res = await fetch(`${base}/storage/v1/object/${PROOF_BUCKET}/${objectPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": contentType,
        "Cache-Control": cache,
        "x-upsert": "true",
      },
      body: buffer,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `upload_${res.status} ${body}`.slice(0, 160) };
    }
    return { ok: true, bytes: buffer.length, publicUrl: publicProofUrl(objectPath) };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
  }
}

module.exports = {
  PROOF_BUCKET,
  PROOF_PREFIX,
  VARIANTS,
  SHOT_CACHE_CONTROL,
  META_CACHE_CONTROL,
  normalizeProofUrl,
  normalizeVariant,
  normalizeProofIdentity,
  PANEL_SUPPRESSION_FLAG,
  suppressOurPanelsUrl,
  proofObjectPath,
  proofMetaPath,
  registrableDomain,
  sameRegistrableDomain,
  capturedShotBelongsTo,
  urlForVariant,
  publicProofUrl,
  fetchProofShot,
  ensureProofBucket,
  uploadProofShot,
};
