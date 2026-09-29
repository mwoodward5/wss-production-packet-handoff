"use strict";

// lib/edit-confirm.js — CONFIRM BEFORE APPLY, shared by every door into the
// edit engine.
//
// WHY THIS FILE EXISTS. There are two ways a customer asks for a change to
// their website: they call Riley (api/vapi-tools/site-edit.js) or they type it
// into the chat panel on their dashboard (api/connect/edit.js). Editing a
// stranger's live site is the one failure in this system with no undo from the
// customer's side, so BOTH doors must read the change back and stop before
// they touch anything — and they must do it with the SAME credential, verified
// by the SAME code. Two copies of a security check drift; the copy that drifts
// is the one nobody is watching.
//
// The first call to an edit endpoint NEVER edits. It resolves the site, reads
// back the business name and domain, and returns a signed confirmation. Only a
// second call carrying that confirmation enqueues anything.
//
// Why a signed token and not a `confirmed: true` boolean: one caller of this
// contract is a language model in a live phone call. A boolean it can set
// itself is not a confirmation — it is the model asserting that it asked. The
// token can only have come from a phase-1 response, and it is bound to
// (slug, business name, domain, instruction), so:
//   - a "confirmed" edit for a DIFFERENT client fails signature/target check,
//   - a "confirmed" edit with a DIFFERENT instruction than the one read back
//     fails the instruction hash — you cannot get "make the header blue"
//     approved and then apply "delete the contact section",
//   - a token cannot be replayed a day later (TTL).

const { createHash, createHmac, timingSafeEqual } = require("node:crypto");

const CONFIRM_TTL_MS = 15 * 60 * 1000;

function confirmSecret() {
  return [
    process.env.GHOST_AGENCY_EDIT_CONFIRM_SECRET,
    process.env.VAPI_TOOL_SECRET,
    process.env.VAPI_WEBHOOK_SECRET,
    process.env.GHOST_AGENCY_ADMIN_TOKEN,
  ].map((s) => String(s || "").trim()).find(Boolean) || "";
}

const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const instructionHash = (s) => createHash("sha256").update(String(s || "").trim()).digest("hex").slice(0, 16);

function mintConfirmToken({ siteSlug, businessName, domain, instruction }) {
  const secret = confirmSecret();
  if (!secret) return "";
  const payload = b64u(JSON.stringify({
    s: siteSlug,
    b: businessName,
    d: domain,
    i: instructionHash(instruction),
    e: Date.now() + CONFIRM_TTL_MS,
  }));
  return `${payload}.${b64u(createHmac("sha256", secret).update(payload).digest())}`;
}

/**
 * A SPOKEN confirmation code — six characters a voice model can carry.
 *
 * THE INCIDENT (2026-08-06, call 019fd8d1). The owner asked Riley to double the
 * logo size. The server minted a correct ~200-character confirm_token; Riley
 * then re-typed it from his own context on the confirming call and mangled it.
 * The slug inside those attempts degraded on each retry:
 *     issued      wss-test-rimrock-plumbing-billings
 *     attempt 1   wss-test-rimrock-plumbing-billing-billings
 *     attempt 2   wss-test-rimbing-plumbing-billing-billings
 * Both came back bad_signature, and the caller was told "the confirmation token
 * system glitched" for a change that was authorised and correct.
 *
 * Asking a language model to echo 200 opaque base64 characters verbatim is the
 * defect. It is not a prompt problem and no amount of instruction fixes it.
 * The SHORT code is what Riley carries; the long token still works unchanged for
 * callers that can copy bytes exactly — which now includes the dashboard chat
 * panel, where the customer taps a button and a browser holds the string.
 *
 * The code is derived, not stored, so it survives a cold lambda — the same
 * lesson as the batch snapshot. It is bound to the same four facts as the long
 * token, so a code minted for one business or one instruction cannot confirm
 * another, and it expires on the same clock.
 */
function mintConfirmCode({ siteSlug, businessName, domain, instruction, at = Date.now() }) {
  const secret = confirmSecret();
  if (!secret) return "";
  // Bucketed to the TTL so the code is stable for the length of one call
  // instead of changing between the two halves of the same conversation.
  const bucket = Math.floor(at / CONFIRM_TTL_MS);
  const mac = createHmac("sha256", secret)
    .update([siteSlug, businessName, domain, instructionHash(instruction), bucket].join("|"))
    .digest("hex");
  // Ambiguity-free alphabet: no O/0, I/1, S/5 — this gets read down a phone.
  const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[parseInt(mac.slice(i * 2, i * 2 + 2), 16) % ALPHABET.length];
  return code;
}

/** True when the caller supplied the short code for THIS exact change. */
function confirmCodeValid(supplied, facts) {
  const given = String(supplied || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (given.length !== 6) return false;
  // Accept the current bucket and the previous one, so a confirmation that
  // lands a second after a bucket boundary is not rejected mid-call.
  const now = Date.now();
  return [now, now - CONFIRM_TTL_MS].some((at) => {
    const want = mintConfirmCode({ ...facts, at });
    return want && want === given;
  });
}

/** -> { ok: true, payload } | { ok: false, reason } */
function verifyConfirmToken(token, { siteSlug, businessName, domain, instruction }) {
  const secret = confirmSecret();
  if (!secret) return { ok: false, reason: "no_confirm_secret" };
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return { ok: false, reason: "malformed_token" };
  const want = Buffer.from(b64u(createHmac("sha256", secret).update(payload).digest()));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad_signature" };
  let data;
  try {
    data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch { return { ok: false, reason: "malformed_payload" }; }
  if (!data || Date.now() > Number(data.e || 0)) return { ok: false, reason: "expired" };
  // Re-check against what we resolved on THIS request, not what phase 1 said.
  if (String(data.s || "") !== String(siteSlug || "")) return { ok: false, reason: "slug_mismatch" };
  if (String(data.b || "") !== String(businessName || "")) return { ok: false, reason: "business_mismatch" };
  if (String(data.d || "") !== String(domain || "")) return { ok: false, reason: "domain_mismatch" };
  if (String(data.i || "") !== instructionHash(instruction)) return { ok: false, reason: "instruction_mismatch" };
  return { ok: true, payload: data };
}

/**
 * The one place a confirmation is checked. Accepts EITHER proof of a real
 * phase-1 read-back: the long signed token (for callers that copy bytes
 * exactly) or the six-character code (for the voice model, which demonstrably
 * cannot). Both are bound to the same four facts, so neither can confirm a
 * different business or a different instruction, and both expire on the same
 * clock.
 *
 * The rejection must name the credential that ACTUALLY failed. A bad code
 * falling through to the token verifier reports "malformed_token" for a request
 * that carried no token at all — the same species of misleading diagnostic as
 * the "mirror_build_not_revealable" that hid an http:// URL. Whoever debugs the
 * next failed change should not be sent to the wrong half.
 */
function verifyEditConfirmation({ confirmToken = "", confirmCode = "", facts }) {
  if (confirmCodeValid(confirmCode, facts)) return { ok: true, payload: { via: "confirm_code" } };
  if (confirmCode && !confirmToken) return { ok: false, reason: "confirm_code_invalid" };
  return verifyConfirmToken(confirmToken, facts);
}

module.exports = {
  CONFIRM_TTL_MS,
  confirmSecret,
  instructionHash,
  mintConfirmToken,
  mintConfirmCode,
  confirmCodeValid,
  verifyConfirmToken,
  verifyEditConfirmation,
};
