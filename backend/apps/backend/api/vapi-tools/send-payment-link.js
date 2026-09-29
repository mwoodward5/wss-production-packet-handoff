"use strict";

/**
 * api/vapi-tools/send-payment-link.js — Riley's IN-CALL checkout link.
 *
 * WHAT IT IS FOR
 * A caller on the line says "let's do it", "sign me up", "how do I pay?".
 * Riley calls this tool; it mints THAT caller's own checkout link (the same
 * signed 45-day redirect link api/admin/mint-checkout-links.js mints, via the
 * same lib/checkout-links.js prospectCheckoutUrl()) and emails it to the
 * email address already on the prospect's verified record — through the same
 * Resend rail and the same Riley email shell a note goes out in.
 *
 * THE CONSENT LAW (enforced here, in code, on every request)
 * Sending to a prospect's address is allowed ONLY when the caller on this
 * line just asked for it. Two independent facts must both be true:
 *
 *   1. THEY ASKED. The function-call arguments must carry an explicit
 *      `theyAsked: true`, which the model sets only from the caller's own
 *      request in this conversation. Anything else — missing, false, a
 *      string "true" — is refused with a sentence Riley speaks, and the
 *      refusal is recorded.
 *
 *   2. WE KNOW WHO THEY ARE. The prospect is resolved the way every tool in
 *      this directory resolves a caller (lib/site-edit-targets.js
 *      resolveCaller, plus call memory), and the address is read off THAT
 *      row. The caller never supplies an address, so a stranger on the line
 *      cannot aim our domain at an arbitrary mailbox. An ambiguous match is
 *      a read-back, never a pick.
 *
 * NO PAYMENT DATA, EVER. The tool accepts no card number, no bank detail,
 * no billing anything — an argument that looks like card data is refused,
 * and the payload it emails is a LINK to a hosted checkout and nothing else.
 *
 * THE LINK IS NOT READ OUT. It is a long signed URL (token + signature);
 * there is no shortener on this system and a mis-spoken signature is a dead
 * link, so the email is the delivery and the spoken sentence says so. If a
 * short-link lane ever lands, that is the moment to revisit this.
 *
 * EVERY OUTCOME IS A SPOKEN OUTCOME. Refusals come back HTTP 200 with
 * ok:false, a machine-readable `refused` code and a `say` line — a non-2xx
 * makes the model improvise about why it failed, and an improvised
 * explanation of a security refusal is worse than none.
 */

const { timingSafeEqual } = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select, recordEvent } = require("../../lib/store");
const { prospectCheckoutUrl, checkoutLinkStatus } = require("../../lib/checkout-links");
const { resolveCaller } = require("../../lib/site-edit-targets");
const {
  callIdFromBody,
  rememberCaller,
  recallCaller,
  recallCallerHot,
} = require("../../lib/riley-call-memory");
const { renderRileyEmail } = require("../../lib/riley-email-shell");

// A small cap on the whole lane, not per caller — the same reasoning as
// send-note's cap: a stuck agent loop retries with whatever caller id it
// carries, so what needs protecting is the lane itself.
const MAX_SENDS_PER_HOUR = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const sendTimestamps = [];

function rateLimitState(now = Date.now()) {
  while (sendTimestamps.length && now - sendTimestamps[0] > RATE_WINDOW_MS) sendTimestamps.shift();
  return {
    limit: MAX_SENDS_PER_HOUR,
    used: sendTimestamps.length,
    remaining: Math.max(0, MAX_SENDS_PER_HOUR - sendTimestamps.length),
    windowMs: RATE_WINDOW_MS,
  };
}
function reserveSendSlot(now = Date.now()) { sendTimestamps.push(now); }
function releaseSendSlot() { sendTimestamps.pop(); }

// ---------------------------------------------------------------------------
// auth — identical to every other tool in this directory
// ---------------------------------------------------------------------------
function authorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const got = String(
    req.headers["x-vapi-secret"]
    || req.headers["x-admin-token"]
    || req.headers.authorization?.replace(/^Bearer\s+/i, "")
    || "",
  ).trim();
  // No secret configured => nobody is authorized. A voice-triggered payment
  // email sender on a public URL fails closed.
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return g.length === b.length && timingSafeEqual(g, b);
  });
}

// ---------------------------------------------------------------------------
// body plumbing — same shapes every sibling accepts
// ---------------------------------------------------------------------------
function toolArgs(body) {
  const call = body?.message?.toolCalls?.[0];
  const raw = call?.function?.arguments;
  let args = body;
  if (raw) {
    try { args = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { args = {}; }
  }
  return { call, args: args && typeof args === "object" ? args : {} };
}

function callerOf(body, args) {
  return String(
    body?.message?.call?.customer?.number
    || body?.message?.customer?.number
    || body?.call?.customer?.number
    || args?.caller_phone
    || args?.caller
    || "",
  ).trim() || "unknown";
}

/** The one field every Riley tool already uses: whatever the caller gave. */
function identityFrom(args) {
  const ref = String(args.client_ref || args.clientRef || "").trim();
  const refDigits = ref.replace(/\D/g, "");
  const looksLikeCode = /^(?:wss-)?[a-z0-9]{4,12}$/i.test(ref) && /\d/.test(ref) && refDigits.length < 10;
  return {
    reference: args.reference || args.reference_code || args.client_id || args.code || (looksLikeCode ? ref : ""),
    phone: args.phone || args.caller_phone || args.from || (refDigits.length >= 10 ? ref : ""),
    businessName: args.business_name || args.businessName || args.name
      || (ref && !looksLikeCode && refDigits.length < 10 ? ref : ""),
    prospectId: args.prospect_id || args.prospectId || "",
  };
}

// A PAN-shaped run is 13–19 digits; a caller reading a card number down the
// line is refused before anything else happens — we never take payment data,
// and the sentence tells them why rather than failing strangely.
const CARD_SHAPED = /\b(?:\d[ -]?){13,19}\b/;

/**
 * The prospect's own address, from the verified row and nowhere else.
 * Same fields lib/riley-context.js treats as the tenant's addresses.
 */
function prospectEmail(row = {}) {
  const record = row && typeof row.record === "object" && row.record ? row.record : {};
  const found = [row.email, row.owner_email, record.email, record.owner_email]
    .map((v) => String(v || "").trim().toLowerCase())
    .find((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
  return found || "";
}

// ---------------------------------------------------------------------------
// THE TOOL DESCRIPTION — the model's whole operating contract. Shipped from
// the module so an operator attaching the tool to the assistant pastes this
// exact text (the send_note precedent: the description is the instruction,
// and the system prompt is never touched).
// ---------------------------------------------------------------------------
const TOOL_DESCRIPTION = [
  "Send the caller their own secure checkout link so they can sign up, mid-call.",
  "Use it the moment the caller asks to go ahead — 'sign me up', 'let's do it', 'send me the link', 'how do I pay'. That request IS the consent: set theyAsked to true only because they just asked you, on this call, for the link.",
  "NEVER set theyAsked to true on your own — not to be helpful, not because the call is going well, not because they asked about pricing earlier. No request in this conversation, no send. The tool refuses and says so out loud.",
  "NEVER take card details, bank details or any payment information. If the caller starts reading a card number, stop them kindly: the link takes care of payment securely, and nothing is charged on this call.",
  "The link goes to the email address on their business record — you never choose or type an address. Say the sentence the tool gives you, including the address it names.",
  "The link is a long signed web address; do not read it out and do not try to shorten or retype it. The email is the delivery.",
  "If the tool refuses, say its `say` line and do not retry with different arguments.",
].join(" ");

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

  try {
    const body = await readJson(req).catch(() => ({}));
    const { call, args } = toolArgs(body);
    const caller = callerOf(body, args);
    const callId = callIdFromBody(body);

    const respond = (payload) => {
      if (call?.id) {
        return sendJson(res, 200, {
          ...payload,
          results: [{ toolCallId: call.id, result: JSON.stringify(payload) }],
        });
      }
      return sendJson(res, 200, payload);
    };

    const refuse = async (code, say, extra = {}) => {
      // Refusals are recorded too: a run of them is the signal that somebody
      // is probing the line, and it is invisible if only successes are logged.
      await recordEvent("riley.payment_link_refused", {
        caller,
        refused: code,
        ...extra,
      }).catch(() => {});
      return respond({ ok: false, sent: false, status: "refused", refused: code, say, ...extra });
    };

    // ---- THE CONSENT LAW, checked before anything else ------------------
    // Strict boolean true. A string "true", a 1, or a missing field is not
    // consent — it is a model guessing, and the tool says so out loud.
    if (args.theyAsked !== true) {
      return refuse(
        "consent_missing",
        "I can only send that across when you've just asked me for it on this call — say the word and I'll get it straight over to you.",
      );
    }

    // ---- NO PAYMENT DATA, EVER ------------------------------------------
    const cardish = Object.entries(args)
      .filter(([k, v]) => typeof v === "string" && (/card|pan|cvv|cvc|csc|expiry|billing/i.test(k) || CARD_SHAPED.test(v)))
      .map(([k]) => k);
    if (cardish.length) {
      return refuse(
        "payment_data_refused",
        "I can't take card details over the phone — nothing gets charged on this call. The link I send you handles payment securely; let me email it across and you can finish there.",
        { refused_fields: cardish.slice(0, 4) },
      );
    }

    // ---- WHO IS ON THE LINE ---------------------------------------------
    const identity = identityFrom(args);
    const hasIdentity = Boolean(identity.reference || identity.phone || identity.businessName || identity.prospectId);
    // "Send it to me again" must not turn into "and who are you?". If the call
    // already established an identity, use it rather than a repetition.
    let memory = callId ? recallCallerHot(callId) : null;
    if (!memory && callId && !hasIdentity) memory = await recallCaller(callId);
    if (!hasIdentity && memory && memory.prospect_id) identity.prospectId = memory.prospect_id;

    if (!hasIdentity && !memory) {
      return refuse(
        "identity_missing",
        "I want to get this to the right account — could you read me the Client ID from your email? It starts with W S S.",
      );
    }

    const who = await resolveCaller(identity);
    if (who.status === "ambiguous") {
      // NAMES ONLY, never the candidate Client IDs — the same discipline
      // api/riley/context.js applies: until the caller proves which business
      // is theirs, none of those rows is "their" record, and an ID is the
      // credential that unlocks history. No send happens on ambiguity.
      const candidates = (Array.isArray(who.candidates) ? who.candidates : [])
        .map((c) => ({ business_name: c && c.business_name, city: c && c.city, state: c && c.state }));
      return refuse("identity_ambiguous", who.say, { candidates });
    }
    if (who.status !== "ok") {
      return refuse("identity_not_found", who.say || "I couldn't find that account. Could you read me the Client ID from your email — it starts with W S S?");
    }

    // ---- THE VERIFIED ROW, AND THE ADDRESS ON IT -------------------------
    const unwrap = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);
    const rows = unwrap(await select(
      "ghost_agency_prospects",
      `?select=*&prospect_id=eq.${encodeURIComponent(who.prospect_id)}&limit=1`,
    ).catch(() => []));
    const row = rows[0] || null;
    if (!row) {
      return refuse("record_unreadable", "I found the account but I can't pull the record up this second — give me a moment and ask me again.");
    }
    if (callId) {
      await rememberCaller(callId, {
        prospect_id: who.prospect_id,
        business_name: who.business_name,
        client_id: who.client_id,
        matched_by: who.matched_by,
      }).catch(() => {});
    }
    const to = prospectEmail(row);
    if (!to) {
      return refuse(
        "no_email_on_file",
        `I have your account, ${who.business_name || "your business"}, but no email address on file for it — I'll have the team send your sign-up link across directly rather than guess at an address.`,
        { prospect_id: who.prospect_id },
      );
    }

    // ---- MINT: the exact link mint-checkout-links mints ------------------
    const link = prospectCheckoutUrl({ prospect: row });
    if (!link) {
      // Fail closed in both directions (no signing secret, or no prospect) —
      // see lib/checkout-links.js prospectCheckoutUrl. A link that would 401
      // on click is worse than no link.
      return refuse(
        "checkout_not_configured",
        "I can't get a sign-up link out this second — the secure checkout side of it isn't switched on for this line yet. Someone on our team will follow up with it, and nothing has been sent.",
        { ...checkoutLinkStatus(), prospect_id: who.prospect_id },
      );
    }

    // ---- SEND: the same rail, the same shell -----------------------------
    const gate = rateLimitState();
    if (gate.remaining <= 0) {
      return refuse("rate_limited", "I've already sent the most links I'm allowed to send in an hour, so I'll hold off on this one — someone on our team will follow up.", {
        limit: gate.limit,
        used: gate.used,
      });
    }

    const businessName = String(row.business_name || who.business_name || "").trim();
    const rendered = renderRileyEmail({
      subject: "Your secure sign-up link",
      recipientName: "",
      answer: [
        "As promised on the call, here is your secure sign-up link. It opens a private checkout page for your website plan — nothing is charged until you complete it there, and payment details never come through the phone line.",
        "The link is signed to your account and stays valid for several weeks.",
      ].join(" "),
      context: caller && caller !== "unknown"
        ? `Sent by Riley during a live call with ${caller}.`
        : "Sent by Riley during a live call.",
      link: {
        url: link,
        label: "Finish signing up",
        note: "Or copy this link into your browser:",
      },
    });

    reserveSendSlot();
    const { sendResendEmail } = require("../../lib/email");
    let result;
    try {
      result = await sendResendEmail({
        to,
        cc: [],
        bcc: [],
        senderKind: "transactional",
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    } catch (error) {
      releaseSendSlot();
      throw error;
    }
    // A dry run never left this process, so it must not consume the cap.
    if (result?.mode === "dry_run") releaseSendSlot();

    const sent = result?.mode === "sent";
    await recordEvent("riley.payment_link_sent", {
      caller,
      prospect_id: who.prospect_id,
      business_name: businessName || null,
      matched_by: who.matched_by,
      to,
      mode: result?.mode || "unknown",
      message_id: result?.id || null,
      sent,
      // THE CONSENT FACT, ON THE RECORD. Every send is auditable against the
      // one thing that authorised it: the caller on this line asked for it.
      consent: "theyAsked_on_call",
      expires_days: 45,
    }).catch(() => {});

    if (!sent) {
      return respond({
        ok: false,
        sent: false,
        status: result?.mode || "send_failed",
        to,
        say: "I wasn't able to get that email out just now — nothing was sent, and nothing has been charged. I'll flag it for the team.",
      });
    }

    return respond({
      ok: true,
      sent: true,
      status: "sent",
      to,
      prospect_id: who.prospect_id,
      // THE SENTENCE. It names the address so the caller can catch a wrong
      // one, refuses to read the long signed URL aloud, and promises exactly
      // one thing the system just did — the send. No charge, no timing.
      say: `Done — I've just emailed your secure sign-up link to ${to}. It's a long signed web address, so the email is the reliable way to it — open it whenever you're ready, and nothing gets charged until you finish signing up there.`,
      rate: rateLimitState(),
      // No raw link in the tool response: the model never needs it, and a
      // link a voice model tries to read out loud is a dead link.
    });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.TOOL_NAME = "send_payment_link";
module.exports.TOOL_DESCRIPTION = TOOL_DESCRIPTION;
module.exports.MAX_SENDS_PER_HOUR = MAX_SENDS_PER_HOUR;
module.exports.rateLimitState = rateLimitState;
module.exports.prospectEmail = prospectEmail;
