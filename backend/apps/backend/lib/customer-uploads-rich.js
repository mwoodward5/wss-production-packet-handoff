"use strict";

// Rich upload adapter for the customer dashboard. The original upload module
// remains the authority for photos/PDFs, ownership, limits and instruction
// parsing. This adapter widens only the STORAGE boundary for the file types the
// previous customer editor exposed, and deliberately returns every non-photo as
// kind=document so the existing edit contract stays unchanged.

const { createHash } = require("node:crypto");
const base = require("./customer-uploads");

const ALLOWED_NAME_EXT = new Set([
  "svg", "docx", "txt", "md", "html", "htm",
  "mp4", "mov", "webm", "mp3", "wav", "m4a", "ogg",
]);

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : "";
}

function looksText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let controls = 0;
  for (const b of sample) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) controls++;
  }
  return controls / Math.max(1, sample.length) < 0.01;
}

function richSniff(buffer, displayName) {
  const ext = extOf(displayName);
  if (!ALLOWED_NAME_EXT.has(ext)) return null;
  const head = buffer.subarray(0, 64);
  const ascii = head.toString("ascii");
  const utf8 = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("utf8").trimStart();

  if (ext === "svg" && /^<\?xml\b|^<svg\b/i.test(utf8)) {
    // Stored as a document, never as a directly placeable photo. Serving from
    // the storage origin also keeps any active SVG content away from wss-ai.com.
    return { ext: "svg", type: "image/svg+xml", kind: "document" };
  }
  if (ext === "docx" && head[0] === 0x50 && head[1] === 0x4b) {
    return { ext: "docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" };
  }
  if (["txt", "md", "html", "htm"].includes(ext) && looksText(buffer)) {
    // HTML is intentionally served as text/plain. It is reference material,
    // not executable customer code.
    return { ext, type: "text/plain; charset=utf-8", kind: "document" };
  }
  if (ext === "mp4" && ascii.slice(4, 8) === "ftyp") return { ext: "mp4", type: "video/mp4", kind: "document" };
  if (ext === "mov" && ascii.slice(4, 8) === "ftyp") return { ext: "mov", type: "video/quicktime", kind: "document" };
  if (ext === "webm" && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { ext: "webm", type: "video/webm", kind: "document" };
  if (ext === "mp3" && (ascii.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))) return { ext: "mp3", type: "audio/mpeg", kind: "document" };
  if (ext === "wav" && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return { ext: "wav", type: "audio/wav", kind: "document" };
  if (ext === "ogg" && ascii.startsWith("OggS")) return { ext: "ogg", type: "audio/ogg", kind: "document" };
  if (ext === "m4a" && ascii.slice(4, 8) === "ftyp") return { ext: "m4a", type: "audio/mp4", kind: "document" };
  return null;
}

function supabaseBase() {
  return String(process.env.SUPABASE_URL || process.env.CALLPREP_SUPABASE_URL || "").replace(/\/+$/, "");
}
function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "";
}

async function storeRichDocument({ siteSlug, buffer, displayName = "", fetchImpl = fetch } = {}) {
  const sniff = richSniff(buffer, displayName);
  if (!sniff) {
    return {
      ok: false,
      reason: "unsupported_type",
      say: "Use an image, SVG, PDF, DOCX, TXT, Markdown, HTML, MP4/MOV/WebM video, or MP3/WAV/M4A/OGG audio file.",
    };
  }
  const objectPath = base.uploadObjectPath({ siteSlug, buffer, ext: sniff.ext });
  const storage = supabaseBase();
  const key = serviceKey();
  if (!objectPath) return { ok: false, reason: "no_site_bound_to_this_login", say: "This login is not linked to a website yet." };
  if (!storage || !key) return { ok: false, reason: "storage_not_configured", say: "File storage is not reachable right now. Try again in a moment." };

  const res = await fetchImpl(`${storage}/storage/v1/object/${base.UPLOAD_BUCKET}/${objectPath}`, {
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
    return { ok: false, reason: `upload_${res.status} ${body}`.slice(0, 160), say: "We couldn't store that file just now. Try again in a moment." };
  }
  const url = base.publicUploadUrl(objectPath);
  if (!url) return { ok: false, reason: "no_public_url", say: "We stored that file but could not produce a link for it." };
  return {
    ok: true,
    attachment: {
      url,
      path: objectPath,
      name: base.safeDisplayName(displayName) || "document",
      kind: "document",
      type: sniff.type,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    },
  };
}

async function storeCustomerUpload(opts = {}) {
  const first = await base.storeCustomerUpload(opts);
  if (first.ok || !["unsupported_type", "svg_refused"].includes(first.reason)) return first;
  return storeRichDocument(opts);
}

module.exports = {
  ...base,
  richSniff,
  storeCustomerUpload,
};
