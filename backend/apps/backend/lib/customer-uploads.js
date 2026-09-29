"use strict";

// lib/customer-uploads.js — the file a customer hands us, and how it reaches
// the edit engine.
//
// WHY THIS FILE EXISTS. The owner's words: "our chat as the main way to upload
// files or PDFs or samples, pictures, so Riley can directly use them versus on
// a phone call you cannot." Before this, the only action a customer could take
// anywhere in the product was a tel: link. There was no path for a photo, a PDF
// or a logo to reach us at all — not a poor path, none. A phone call cannot
// carry a file, so every "put my new truck on there" ended in Riley asking the
// customer to send something to an address nobody had given them.
//
// TWO THINGS THIS MODULE REFUSES TO DO.
//
// 1. IT NEVER TRUSTS THE CLIENT'S NAME OR PATH. The storage key is derived from
//    the BYTES (sha256) under a prefix derived from the site slug the caller's
//    own token is bound to. A filename arrives as a label to show the customer
//    and nothing else — sanitised, length-capped, and never concatenated into a
//    path. "../../" in a filename cannot escape anything because the filename
//    is not part of the key.
//
// 2. IT NEVER TRUSTS THE DECLARED TYPE. Content-Type is a claim; magic bytes
//    are evidence. The same sniff the site editor already uses on fetched
//    images (lib/site-change-plan.js sniffImage) decides what a file is, and
//    the extension we store follows the bytes. SVG is refused for the reason
//    recorded there: it is a document format that can carry script, and "it is
//    an image" is not true of it in the sense that matters.
//
// HOW AN UPLOAD REACHES THE ENGINE, WITHOUT A SECOND EDIT PATH.
// ghost_agency_edit_jobs has exactly eight columns — id, job_id, site_slug,
// instruction, status, result, created_at, updated_at (verified against
// production 2026-08-08) — and none of them is an attachments column. Rather
// than migrate the table or smuggle input into `result` (which executeEditJob
// overwrites on every state transition), the attachment links are composed INTO
// the instruction string by composeEditInstruction below.
//
// That is not a workaround, it is the shortest correct path: the planner's only
// route for a new picture is `swap_image` with an https link the CUSTOMER
// supplied (lib/site-change-plan.js PLAN_CONTRACT op 9), and the planner reads
// the instruction. Carrying the links in the instruction means they survive the
// queue, a cold lambda, the every-two-minutes sweeper and the owner
// notification email, all of which already read that one field.
// parseEditInstruction() splits the customer's own words back out so the chat
// transcript shows what they typed rather than the composed blob.

const { createHash } = require("node:crypto");
const { sniffImage } = require("./site-change-plan");

const UPLOAD_BUCKET = "wss-customer-uploads";
const UPLOAD_PREFIX = "uploads";

/**
 * THE SIZE CAP IS A PLATFORM FACT, NOT A PREFERENCE. A Vercel serverless
 * function rejects a request body over 4.5 MB before our handler ever runs, and
 * base64 inflates by 4/3, so a 3.2 MB file is ~4.27 MB on the wire and a 3.5 MB
 * one is not deliverable at all. Picking the number that fits means an
 * oversized photo gets an honest sentence from us instead of an opaque 413 from
 * the platform. The browser downscales images past this before sending (see the
 * dashboard's shrinkImage), so in practice the cap is only ever met by a
 * document.
 */
const MAX_UPLOAD_BYTES = 3_200_000;

/** Per message. Four covers "here are photos of the job" without turning one chat turn into a bulk import. */
const MAX_ATTACHMENTS = 4;

/** Longest label we will echo back. A filename is display text, never a path. */
const MAX_NAME_LENGTH = 80;

// Documents we accept. A PDF cannot be placed on a site by any op the planner
// has — it reaches a human through the owner notification instead, and the chat
// says exactly that rather than implying it will appear.
const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/**
 * sniffUpload(buf) -> { ext, type, kind } | null
 * kind: "photo" (can go on the site) | "document" (goes to a person).
 */
function sniffUpload(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const image = sniffImage(buf);
  if (image) return { ext: image.ext, type: image.type, kind: "photo" };
  if (buf.subarray(0, 5).equals(PDF_MAGIC)) return { ext: "pdf", type: "application/pdf", kind: "document" };
  return null;
}

/**
 * A filename fit to show a human. Path separators, control characters and
 * anything that could be read as markup are removed. The result is never used
 * to build a storage key or a URL.
 */
function safeDisplayName(raw) {
  const cleaned = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/]+/g, " ")
    .replace(/[<>"'`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, MAX_NAME_LENGTH);
}

function supabaseBase() {
  const url = process.env.SUPABASE_URL || process.env.CALLPREP_SUPABASE_URL || "";
  return String(url).replace(/\/+$/, "");
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "";
}

/**
 * Content-addressed key: uploads/<slug>/<sha256 of the bytes>.<sniffed ext>.
 * Re-uploading the same picture lands on the same object rather than piling up
 * a copy per attempt, and no part of the path comes from the client.
 */
function uploadObjectPath({ siteSlug, buffer, ext } = {}) {
  const slug = String(siteSlug || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) return "";
  if (!Buffer.isBuffer(buffer) || !buffer.length) return "";
  const safeExt = String(ext || "").replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase();
  if (!safeExt) return "";
  const digest = createHash("sha256").update(buffer).digest("hex");
  return `${UPLOAD_PREFIX}/${slug}/${digest}.${safeExt}`;
}

function publicUploadUrl(objectPath) {
  const override = String(process.env.WSS_CUSTOMER_UPLOADS_BASE_URL || "").replace(/\/+$/, "");
  if (override) return objectPath ? `${override}/${objectPath}` : "";
  const base = supabaseBase();
  if (!base || !objectPath) return "";
  return `${base}/storage/v1/object/public/${UPLOAD_BUCKET}/${objectPath}`;
}

/** Best-effort create of the bucket. Idempotent; "already exists" is success. */
async function ensureUploadBucket({ fetchImpl = fetch } = {}) {
  const base = supabaseBase();
  const key = serviceKey();
  if (!base || !key) return { ok: false, reason: "storage_not_configured" };
  try {
    const res = await fetchImpl(`${base}/storage/v1/bucket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ id: UPLOAD_BUCKET, name: UPLOAD_BUCKET, public: true, file_size_limit: MAX_UPLOAD_BYTES }),
    });
    const body = await res.text().catch(() => "");
    if (res.ok) return { ok: true, created: true };
    if (/already exists|Duplicate/i.test(body)) return { ok: true, created: false };
    return { ok: false, reason: `${res.status} ${body}`.slice(0, 160) };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).slice(0, 120) };
  }
}

/**
 * storeCustomerUpload -> { ok, attachment } | { ok: false, reason, say }
 *
 * `say` is the sentence the chat shows the customer. Every rejection has one,
 * for the same reason Riley's refusals do: a customer who sent the wrong thing
 * needs to know what to send instead, not an error code.
 */
async function storeCustomerUpload({ siteSlug, buffer, displayName = "", fetchImpl = fetch } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { ok: false, reason: "empty_upload", say: "That file came through empty. Try attaching it once more." };
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      say: `That file is ${(buffer.length / 1e6).toFixed(1)} MB and we can take up to ${(MAX_UPLOAD_BYTES / 1e6).toFixed(1)} MB. A smaller copy will go straight through.`,
    };
  }
  const sniff = sniffUpload(buffer);
  if (!sniff) {
    const head = buffer.subarray(0, 1024).toString("utf8");
    const isSvg = /<svg[\s>]/i.test(head);
    return {
      ok: false,
      reason: isSvg ? "svg_refused" : "unsupported_type",
      say: isSvg
        ? "That's a vector graphic, and we don't put those straight onto a live site. A PNG or a JPEG of the same artwork goes up in a minute."
        : "We can take photos (JPEG, PNG, GIF or WebP) and PDFs. That file isn't one of those.",
    };
  }
  const objectPath = uploadObjectPath({ siteSlug, buffer, ext: sniff.ext });
  if (!objectPath) {
    return {
      ok: false,
      reason: "no_site_bound_to_this_login",
      say: "We couldn't work out which website this belongs to, so we're not storing it. Call Riley and we'll sort it out.",
    };
  }
  const base = supabaseBase();
  const key = serviceKey();
  if (!base || !key) {
    return {
      ok: false,
      reason: "storage_not_configured",
      say: "File storage isn't reachable right now. Send your request without the file and we'll come back for it.",
    };
  }

  try {
    const res = await fetchImpl(`${base}/storage/v1/object/${UPLOAD_BUCKET}/${objectPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": sniff.type,
        "Cache-Control": "public, max-age=604800",
        "x-upsert": "true",
      },
      body: buffer,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: `upload_${res.status} ${body}`.slice(0, 160),
        say: "We couldn't store that file just now. Try again in a moment.",
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: String((err && err.message) || err).slice(0, 120),
      say: "We couldn't store that file just now. Try again in a moment.",
    };
  }

  const url = publicUploadUrl(objectPath);
  if (!url) {
    return { ok: false, reason: "no_public_url", say: "We stored that file but couldn't produce a link for it. Call Riley and we'll pick it up." };
  }
  return {
    ok: true,
    attachment: {
      url,
      path: objectPath,
      name: safeDisplayName(displayName) || (sniff.kind === "photo" ? "photo" : "document"),
      kind: sniff.kind,
      type: sniff.type,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    },
  };
}

/**
 * isOwnUploadUrl({ url, siteSlug }) — is this a link WE issued, for THIS site?
 *
 * THE GATE THAT MATTERS ON THE WAY BACK IN. The chat posts an attachment list
 * to /api/connect/edit, and a list is client-supplied data no matter how it got
 * into the page. Without this check a customer (or anything that got hold of
 * their token) could name any https URL and the planner would dutifully fetch
 * it and host the bytes on the live site — an open fetch-and-publish proxy
 * wearing a login. lib/site-change-plan.js already refuses private hosts and
 * non-images, which stops the worst of it, but "not obviously an attack" is not
 * the same as "a file this customer uploaded".
 *
 * So an attachment is only ever a link under this site's own upload prefix.
 * Comparison is on the exact origin + path prefix, not a substring: a URL like
 * https://evil.com/?x=https://…/uploads/slug/ contains the prefix and is not it.
 */
function isOwnUploadUrl({ url, siteSlug } = {}) {
  const slug = String(siteSlug || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) return false;
  const expected = publicUploadUrl(`${UPLOAD_PREFIX}/${slug}/`);
  if (!expected) return false;
  const raw = String(url || "").trim();
  if (!/^https:\/\//i.test(raw)) return false;
  let candidate;
  let base;
  try {
    candidate = new URL(raw);
    base = new URL(expected);
  } catch {
    return false;
  }
  if (candidate.origin !== base.origin) return false;
  if (candidate.username || candidate.password || candidate.search || candidate.hash) return false;
  return candidate.pathname.startsWith(base.pathname) && candidate.pathname.length > base.pathname.length;
}

// ---------------------------------------------------------------------------
// THE INSTRUCTION CARRIER
// ---------------------------------------------------------------------------

// The line that separates the customer's own words from the material we append.
// Deliberately free of every word that routes an instruction somewhere else:
// lib/site-change-plan.js short-circuits on /\b(undo|revert|put it back|change
// it back|roll ?back)\b/ before a planner ever sees the text, and
// lib/seo-page-edit.js classifies anything matching /\bnew page\b/ and friends
// as a build request. A block appended to EVERY attachment-bearing instruction
// must not be able to change what the instruction means.
const ATTACHMENT_MARKER = "--- FILES THE CUSTOMER ATTACHED ---";
const ATTACHMENT_LINE = /^\[(\d+)\]\s+(photo|document)\s+"([^"]*)"\s+-\s+(https:\/\/\S+)$/;

/** Strip anything from the customer's own text that could impersonate the marker. */
function sanitizeMessage(raw) {
  return String(raw == null ? "" : raw)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--- FILES THE CUSTOMER ATTACHED"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * composeEditInstruction({ message, attachments }) -> string
 *
 * THE ONE STRING both confirmation phases hash and the job row stores. Phase 1
 * mints a token bound to it and phase 2 re-composes it from the same inputs; if
 * either the words or the files change between the read-back and the tap, the
 * instruction hash no longer matches and the change is refused rather than
 * quietly applied against different material.
 */
function composeEditInstruction({ message = "", attachments = [] } = {}) {
  const text = sanitizeMessage(message);
  const files = (Array.isArray(attachments) ? attachments : [])
    .filter((a) => a && /^https:\/\//i.test(String(a.url || "")))
    .slice(0, MAX_ATTACHMENTS);
  if (!files.length) return text;
  const lines = files.map((a, i) => {
    const kind = a.kind === "document" ? "document" : "photo";
    const name = safeDisplayName(a.name).replace(/"/g, "") || kind;
    return `[${i + 1}] ${kind} "${name}" - ${String(a.url).trim()}`;
  });
  return [
    text,
    "",
    ATTACHMENT_MARKER,
    "The customer uploaded these just now. Each link is the file itself, not a viewer.",
    ...lines,
    "A photo here is what to use when this request needs a new picture on the site.",
    "A document cannot be placed on a site by any means available to you.",
  ].join("\n").trim();
}

/**
 * parseEditInstruction(stored) -> { message, attachments }
 *
 * The inverse, so the chat transcript renders what the customer typed instead
 * of the composed blob, and so a job queued days ago still shows its files.
 */
function parseEditInstruction(stored) {
  const raw = String(stored == null ? "" : stored).replace(/\r\n?/g, "\n");
  const index = raw.indexOf(ATTACHMENT_MARKER);
  if (index < 0) return { message: raw.trim(), attachments: [] };
  const message = raw.slice(0, index).trim();
  const attachments = [];
  for (const line of raw.slice(index + ATTACHMENT_MARKER.length).split("\n")) {
    const match = ATTACHMENT_LINE.exec(line.trim());
    if (!match) continue;
    attachments.push({ kind: match[2], name: match[3], url: match[4] });
  }
  return { message, attachments };
}

module.exports = {
  UPLOAD_BUCKET,
  UPLOAD_PREFIX,
  MAX_UPLOAD_BYTES,
  MAX_ATTACHMENTS,
  MAX_NAME_LENGTH,
  ATTACHMENT_MARKER,
  sniffUpload,
  safeDisplayName,
  uploadObjectPath,
  publicUploadUrl,
  isOwnUploadUrl,
  ensureUploadBucket,
  storeCustomerUpload,
  sanitizeMessage,
  composeEditInstruction,
  parseEditInstruction,
};
