"use strict";

// lib/riley-uploads.js — "put that photo I sent on the site", from a phone call.
//
// WHAT WAS MISSING. api/connect/upload.js already takes a file and returns an
// https link, and api/connect/edit.js already accepts that link back and
// composes it into the instruction (lib/customer-uploads.js). The whole chain
// works — for a BROWSER, which is holding the link it just got back.
//
// A phone call is not holding anything. The customer uploaded a photo from the
// dashboard on Tuesday and on Thursday says "use that picture I sent you".
// There was no way to turn those words into a file, so the request died as
// "send it to us again" — for a file we already had, in a bucket, under their
// own slug.
//
// ── THE ONE RULE THAT SHAPES THIS WHOLE FILE ────────────────────────────────
//
// WE NEVER TAKE A URL FROM THE CALLER. Not read out, not spelled, not "it's on
// my Dropbox". A voice agent that fetches a URL a caller dictates is a
// server-side request forgery and an identity leak in one motion: it will fetch
// an internal address if asked, and it will host somebody else's copyrighted or
// mislabelled image on a real business's live website. lib/customer-uploads.js
// isOwnUploadUrl already refuses anything outside this tenant's own prefix on
// the browser path; this module never even accepts the string.
//
// So the ONLY candidates are objects that already exist under
// `uploads/<siteSlug>/` in the customer-uploads bucket — files that arrived
// through the authenticated upload endpoint, bound to a slug taken from the
// caller's own signed token, and content-addressed by their bytes. Selection is
// then a question about OUR list ("the last one", "the second one"), never
// about an address.
//
// ── AND ONE CARRIER ────────────────────────────────────────────────────────
// The chosen file reaches the planner exactly as a browser upload does:
// composeEditInstruction() from lib/customer-uploads.js. Not a second format,
// not a new column. Whatever hashes and confirms an attachment-bearing chat
// edit hashes and confirms this one, because it IS that string.

const {
  UPLOAD_PREFIX,
  MAX_ATTACHMENTS,
  composeEditInstruction,
  isOwnUploadUrl,
  publicUploadUrl,
  safeDisplayName,
} = require("./customer-uploads");

const UPLOAD_BUCKET = "wss-customer-uploads";

/** How many of a tenant's files we will ever consider. Ordered newest first. */
const LIST_LIMIT = 40;

/** Slug shape, identical to every other tenant-scoped surface. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

/** Anything that looks like an address a caller read out. */
const URL_LIKE = /(https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|dev|app|photo|jpg|png)\b|\bdot com\b|\bdropbox\b|\bgoogle drive\b|\bimgur\b)/i;

/**
 * Words that mean "the file I ALREADY SENT YOU".
 *
 * Deliberately narrow: it requires the customer to say they handed something
 * over. An earlier, looser version matched any demonstrative plus a noun —
 * "the photo", "that image", "the logo" — and swallowed "make the logo bigger",
 * a pure style change with no file in it anywhere, sending it down the upload
 * path to be refused for want of an attachment nobody had asked for.
 *
 * Under-triggering is the safe direction. A request that needs a picture and
 * does not say one was sent reaches the planner, which refuses it for a missing
 * source — honest, and recoverable in one sentence. Over-triggering breaks
 * changes that were never about a file at all.
 */
const REFERS_TO_UPLOAD =
  /\b(?:i|we)\s+(?:just\s+|already\s+)*(?:sent|uploaded|emailed|texted|attached|gave)\b|\bthe attachment\b/i;

/** "the newest" / "the first" / "the second one". */
const WANTS_NEWEST = /\b(last|latest|newest|most recent|just sent|just uploaded|the one i just)\b/i;
const WANTS_OLDEST = /\b(first|earliest|oldest|original)\b/i;
const ORDINALS = Object.freeze([
  [/\b(second|2nd)\b/i, 1],
  [/\b(third|3rd)\b/i, 2],
  [/\b(fourth|4th)\b/i, 3],
]);

const IMAGE_MIME = /^image\/(jpeg|png|gif|webp)$/i;

function supabaseBase() {
  const url = process.env.SUPABASE_URL || process.env.CALLPREP_SUPABASE_URL || "";
  return String(url).replace(/\/+$/, "");
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "";
}

function normalizeSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return SLUG_RE.test(slug) ? slug : "";
}

/**
 * Nice spoken label for a content-addressed object: nobody wants to hear a
 * sha256.
 *
 * IT IS POSITION-FIRST, NOT DATE-FIRST, and that is not a style choice. The
 * first version said "the photo you sent on August 8" and, run against the real
 * bucket, produced three files with that identical label — so the ambiguity
 * question came out as "is it the photo you sent on August 8, or an older
 * one?", which the customer cannot answer. Position always distinguishes; the
 * date is the reminder that goes with it.
 */
function spokenLabel(entry, index) {
  const type = /gif/i.test(entry.mimetype) ? "animation" : /^image\//i.test(entry.mimetype) ? "photo" : "file";
  const place = index === 0 ? `the last ${type} you sent` : index === 1 ? "the one before that" : `the ${["", "", "", "third", "fourth", "fifth"][index + 1] || `${index + 1}th`} one back`;
  const when = Date.parse(String(entry.at || ""));
  if (!Number.isFinite(when)) return place;
  const d = new Date(when);
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()];
  return `${place}, from ${month} ${d.getUTCDate()}`;
}

/**
 * listTenantUploads({ siteSlug }) -> { ok, uploads } | { ok:false, reason }
 *
 * The tenant's own objects, newest first. Every returned url is re-checked with
 * isOwnUploadUrl — the same predicate the browser path uses — so even a
 * mis-shaped listing response cannot produce a link outside this prefix.
 */
async function listTenantUploads({ siteSlug, fetchImpl = fetch, limit = LIST_LIMIT } = {}) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return { ok: false, reason: "no_site_bound_to_this_login", uploads: [] };
  const base = supabaseBase();
  const key = serviceKey();
  if (!base || !key) return { ok: false, reason: "storage_not_configured", uploads: [] };

  let listing;
  try {
    const res = await fetchImpl(`${base}/storage/v1/object/list/${UPLOAD_BUCKET}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix: `${UPLOAD_PREFIX}/${slug}`,
        limit: Math.max(1, Math.min(100, limit)),
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      }),
    });
    if (!res.ok) return { ok: false, reason: `list_${res.status}`, uploads: [] };
    listing = await res.json();
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).slice(0, 120), uploads: [] };
  }
  if (!Array.isArray(listing)) return { ok: false, reason: "list_malformed", uploads: [] };

  const uploads = [];
  for (const entry of listing) {
    const name = String((entry && entry.name) || "").trim();
    // A folder placeholder has no metadata; a real object always does.
    const meta = entry && typeof entry.metadata === "object" && entry.metadata ? entry.metadata : null;
    if (!name || !meta) continue;
    const url = publicUploadUrl(`${UPLOAD_PREFIX}/${slug}/${name}`);
    if (!isOwnUploadUrl({ url, siteSlug: slug })) continue;
    const mimetype = String(meta.mimetype || "");
    uploads.push({
      url,
      path: `${UPLOAD_PREFIX}/${slug}/${name}`,
      mimetype,
      bytes: Number(meta.size || meta.contentLength || 0) || 0,
      at: String(entry.created_at || entry.updated_at || ""),
      kind: IMAGE_MIME.test(mimetype) ? "photo" : "document",
    });
  }
  uploads.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  uploads.forEach((u, i) => { u.name = spokenLabel(u, i); });
  return { ok: true, uploads };
}

/** Does this request want a file the customer already sent us? */
function referencesAnUpload(message) {
  return REFERS_TO_UPLOAD.test(String(message || ""));
}

/** Did the caller read out an address? */
function containsDictatedUrl(message) {
  return URL_LIKE.test(String(message || ""));
}

/**
 * pickUpload({ uploads, message }) -> { ok, upload, why } | { ok:false, reason, say }
 *
 * Deterministic, and it refuses rather than guesses in the one case where a
 * guess is expensive: several files and no way to tell which. Putting the wrong
 * photograph on a live business's home page is not a small mistake.
 */
function pickUpload({ uploads = [], message = "" } = {}) {
  const photos = (Array.isArray(uploads) ? uploads : []).filter((u) => u && u.kind === "photo");
  if (!photos.length) {
    const hadDocs = (Array.isArray(uploads) ? uploads : []).length > 0;
    return {
      ok: false,
      reason: hadDocs ? "only_documents" : "no_uploads",
      say: hadDocs
        ? "The only thing I've got from you is a document, and a document can't go on a website. Send a photo through your dashboard and I'll put it up."
        : "I don't have a photo from you yet. Open your dashboard, send it through the chat there, and then tell me where you want it — it takes a second.",
    };
  }

  const text = String(message || "");
  if (WANTS_OLDEST.test(text)) return { ok: true, upload: photos[photos.length - 1], why: "oldest" };
  for (const [re, index] of ORDINALS) {
    if (re.test(text)) {
      if (index < photos.length) return { ok: true, upload: photos[index], why: `ordinal_${index + 1}` };
      return {
        ok: false,
        reason: "ordinal_out_of_range",
        say: `I've only got ${photos.length === 1 ? "one photo" : `${photos.length} photos`} from you, so I can't pick that one. Tell me if it's the most recent one and I'll use that.`,
      };
    }
  }
  if (WANTS_NEWEST.test(text) || photos.length === 1) {
    return { ok: true, upload: photos[0], why: photos.length === 1 ? "only_one" : "newest" };
  }

  // Several photos and nothing distinguishing in the words. The list is short
  // and ours, so ASK — with the choice spoken in dates, never in filenames.
  return {
    ok: false,
    reason: "ambiguous",
    say: `I've got ${photos.length} photos from you — is it ${photos[0].name}, or an older one?`,
    choices: photos.slice(0, 3).map((p) => p.name),
  };
}

/**
 * resolveUploadForEdit({ siteSlug, message }) -> one of
 *   { ok:true,  attached:false, instruction }                  — no file needed
 *   { ok:true,  attached:true,  instruction, upload }          — file composed in
 *   { ok:false, reason, say }                                  — say this, change nothing
 *
 * `instruction` is what goes to request_site_change. On the attached path it is
 * composeEditInstruction() output — byte-identical in shape to what the chat
 * panel produces — so the confirm-before-apply hash, the job row, the sweeper
 * and the owner email all see the format they already handle.
 */
async function resolveUploadForEdit({ siteSlug, message, fetchImpl = fetch } = {}) {
  const words = String(message || "").trim();
  if (!words) return { ok: false, reason: "empty", say: "Tell me what you'd like changed and I'll get on it." };

  // A dictated address is refused BEFORE anything is looked up, and the refusal
  // names the path that does work. Never fetch it, never echo it back.
  if (containsDictatedUrl(words)) {
    return {
      ok: false,
      reason: "dictated_url",
      say: "I can't take a web address over the phone — I'd have no way of knowing it's yours. Send the picture through the chat on your dashboard and I'll put it straight up for you.",
    };
  }

  if (!referencesAnUpload(words)) {
    return { ok: true, attached: false, instruction: words };
  }

  const listed = await listTenantUploads({ siteSlug, fetchImpl });
  if (!listed.ok) {
    return {
      ok: false,
      reason: listed.reason,
      // An unreadable store is not an empty one, and must never be spoken as
      // "you never sent me anything" — that calls the customer a liar over an
      // outage. See the same distinction in lib/customer-edits.js readRows.
      say: "I can't get at your files this second, so I'd rather not guess at which one you mean. Give me a moment and ask me again, or send it through your dashboard chat.",
    };
  }

  const picked = pickUpload({ uploads: listed.uploads, message: words });
  if (!picked.ok) return { ok: false, reason: picked.reason, say: picked.say, choices: picked.choices || null };

  // Belt and braces: the composed instruction may only ever carry a link this
  // tenant owns. If this ever fails, something upstream is wrong and the right
  // answer is to publish nothing.
  if (!isOwnUploadUrl({ url: picked.upload.url, siteSlug })) {
    return {
      ok: false,
      reason: "not_own_upload",
      say: "Something's not lining up with that file on our side, so I'm not going to put it on your live site. I'll get someone to look at it today.",
    };
  }

  const instruction = composeEditInstruction({
    message: words,
    attachments: [{ url: picked.upload.url, name: safeDisplayName(picked.upload.name), kind: "photo" }].slice(0, MAX_ATTACHMENTS),
  });
  return { ok: true, attached: true, instruction, upload: picked.upload, why: picked.why };
}

module.exports = {
  UPLOAD_BUCKET,
  LIST_LIMIT,
  URL_LIKE,
  listTenantUploads,
  referencesAnUpload,
  containsDictatedUrl,
  pickUpload,
  resolveUploadForEdit,
  spokenLabel,
};
