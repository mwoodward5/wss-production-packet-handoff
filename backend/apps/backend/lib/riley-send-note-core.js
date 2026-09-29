"use strict";

/**
 * lib/riley-send-note-core.js — Riley's ONE outbound-email capability: the
 * core of api/vapi-tools/send-note.js, extracted so the ONE proxy door
 * (api/vapi-tools/riley.js) can dispatch to it as a library function instead
 * of an HTTP hop. The route keeps only the method/auth/body plumbing; this
 * module owns the allowlist, the leak scan, the rate limit and the answer.
 *
 * WHAT IT IS FOR
 * A caller on the phone asks Riley to email them a short note ("send me a
 * couple of lines about what you do"). Riley calls this tool with
 * { to, subject, body } and the note goes out through the same Resend lane the
 * rest of the system uses (lib/email.js sendResendEmail).
 *
 * WHY IT IS LOCKED DOWN THIS HARD
 * A voice-triggered mail sender is two dangerous things at once:
 *
 *   1. AN OPEN RELAY. The trigger is "somebody said words into a phone". If the
 *      recipient came from the caller, anyone who can reach the line can dictate
 *      any address on earth and have our domain, our reputation and our Resend
 *      account deliver it. So the recipient does NOT come from the caller. It is
 *      matched against ALLOWED_RECIPIENTS below and anything else is refused.
 *      Riley may still ASK for the address out loud — the conversation is
 *      unchanged — the backend simply refuses to honour anything off the list.
 *
 *   2. AN EXFILTRATION PATH. A language model can be talked into reading its own
 *      configuration out loud. If it can also mail, a successful prompt-injection
 *      becomes a successful data theft. So the body is scanned for
 *      secret-shaped text AND for the literal current value of any secret-named
 *      environment variable in this process, and a hit is a hard refusal.
 *
 * These are enforced here, in code, on every request. None of it is documented
 * intent that a future prompt edit can undo.
 *
 * EVERY AUTHENTICATED OUTCOME IS A SPOKEN OUTCOME. Once the tool secret checks
 * out, refusals come back as HTTP 200 with `ok:false`, a machine-readable
 * `refused` code and a `say` line. A non-2xx here makes the model improvise
 * about why it failed, and an improvised explanation of a security refusal is
 * worse than no explanation. Unauthenticated requests still get a bare 401.
 */

const { recordEvent } = require("./store");

// ---------------------------------------------------------------------------
// THE ALLOWLIST
// ---------------------------------------------------------------------------
// This single frozen constant is the entire recipient security model. Widening
// it later is one obvious edit in one obvious place — and that edit is the
// moment to re-read the two hazards in the header comment above.
const ALLOWED_RECIPIENTS = Object.freeze(["woodwardsoftware@gmail.com"]);

// A small cap on the whole mailbox, not per caller. A stuck agent loop would
// retry with whatever caller id it happens to carry, so a per-caller counter is
// no protection at all; what needs protecting is the one inbox on the list.
const MAX_SENDS_PER_HOUR = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const MAX_SUBJECT_CHARS = 160;
const MAX_BODY_CHARS = 2000;

// ---------------------------------------------------------------------------
// recipient
// ---------------------------------------------------------------------------
/**
 * Normalize an address that arrived through a speech transcriber.
 *
 * This only ever produces a CANDIDATE string, which is then checked against
 * ALLOWED_RECIPIENTS. It cannot widen the allowlist — at worst it fails to
 * recognise a spoken form and the send is refused.
 */
function normalizeSpokenEmail(value) {
  let s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^mailto:/, "").replace(/^<|>$/g, "");
  if (!s.includes("@")) {
    // "woodwardsoftware at gmail dot com" — only rewritten when there is no @,
    // so a real address is never mangled.
    s = s.replace(/\s*\(?\s*\bat\b\s*\)?\s*/g, "@").replace(/\s*\(?\s*\bdot\b\s*\)?\s*/g, ".");
  }
  return s.replace(/\s+/g, "").replace(/[.,;:!?]+$/, "");
}

function recipientAllowed(value) {
  const candidate = normalizeSpokenEmail(value);
  return ALLOWED_RECIPIENTS.some((allowed) => allowed.toLowerCase() === candidate);
}

// ---------------------------------------------------------------------------
// secret-shaped content
// ---------------------------------------------------------------------------
// Shapes, not values. Each entry is a family of credential that has a
// recognisable prefix or structure.
const SECRET_SHAPES = Object.freeze([
  ["private_key_block", /-----BEGIN[ A-Z]*PRIVATE KEY-----/],
  ["stripe_key", /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/],
  ["openai_style_key", /\bsk-[A-Za-z0-9_-]{16,}/],
  ["resend_key", /\bre_[A-Za-z0-9_-]{16,}/],
  ["aws_access_key_id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ["slack_token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["json_web_token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ["connection_string", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s/@]+:[^\s/@]+@/i],
  ["bearer_token", /\bbearer\s+[A-Za-z0-9._~+/-]{20,}/i],
  ["authorization_header", /\bauthorization\s*:\s*\S{8,}/i],
  ["credential_assignment", /\b[A-Z][A-Z0-9_]{2,}(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|DSN)\s*[:=]\s*\S{8,}/],
  ["high_entropy_hex", /\b[a-f0-9]{32,}\b/i],
]);

// Environment variables whose VALUE must never appear in an outbound note.
const SECRET_ENV_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|SIGNING|DSN|API)/i;
// ...except the ones whose name says they hold a public identifier, not a
// credential. A bare service URL or a from-address is not a secret, and
// treating one as a secret would refuse ordinary notes for no security gain.
// A URL that DOES carry credentials is still caught by "connection_string".
const PUBLIC_ENV_NAME = /_(URL|URI|HOST|FROM|EMAIL|ADDRESS|ID|IDS)$/i;
const MIN_ENV_VALUE_LENGTH = 12;

/**
 * Scan text for anything secret-shaped.
 *
 * Returns null, or { kind, detail } where `detail` is a SHAPE NAME or an
 * ENVIRONMENT VARIABLE NAME. It is never the matched text and never the
 * variable's value — a refusal must not echo the thing it refused to send.
 */
function secretShapedContent(text, env = process.env) {
  const hay = String(text == null ? "" : text);
  if (!hay.trim()) return null;
  for (const [name, pattern] of SECRET_SHAPES) {
    if (pattern.test(hay)) return { kind: "shape", detail: name };
  }
  for (const [name, value] of Object.entries(env || {})) {
    if (!SECRET_ENV_NAME.test(name) || PUBLIC_ENV_NAME.test(name)) continue;
    const v = String(value == null ? "" : value).trim();
    if (v.length < MIN_ENV_VALUE_LENGTH) continue;
    if (hay.includes(v)) return { kind: "env_value", detail: name };
  }
  return null;
}

// ---------------------------------------------------------------------------
// rate limit
// ---------------------------------------------------------------------------
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

// The slot is taken BEFORE the mailer is called, so two overlapping calls
// cannot both read "one left" and both send.
function reserveSendSlot(now = Date.now()) { sendTimestamps.push(now); }
function releaseSendSlot() { sendTimestamps.pop(); }

// ---------------------------------------------------------------------------
// body plumbing
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

// ---------------------------------------------------------------------------
// THE SHELL
// ---------------------------------------------------------------------------
// The note used to render as bare paragraphs in an unstyled <div>: no sender
// identity, no mark, no signature, no compliance footer. A caller who asked
// Riley to email them a few lines got something that read as a leaked debug
// dump, while the outreach lane from the same company sent a designed product
// email. lib/riley-email-shell.js is the one shell both halves render from; it
// wraps his answer and never alters a word of it.
//
// The shell is deliberately NOT given the note as HTML. It receives the text he
// dictated and does its own escaping, so a model that emits angle brackets
// mid-sentence cannot inject markup into a document we sign with our mark.
const { renderRileyEmail } = require("./riley-email-shell");

/**
 * Provenance for the footer of the note. This is the ONE sentence in the
 * rendered email that this file supplies, and it states a fact the recipient
 * can check: the note exists because a call happened. The caller id is included
 * when the platform gave us one — the recipient is the single allowlisted
 * address, so this discloses the caller to the account owner and to nobody else.
 */
function callContext(caller) {
  return caller && caller !== "unknown"
    ? `Sent by Riley during a live call with ${caller}.`
    : "Sent by Riley during a live call.";
}

// ---------------------------------------------------------------------------
// core
// ---------------------------------------------------------------------------
/**
 * The whole tool, minus transport: given the parsed request body, return
 * `{ status, payload }` where payload is EXACTLY what the route sends — the
 * VAPI envelope merged in exactly as the route always merged it
 * (`{ ...payload, results }`). Every authenticated outcome is 200.
 */
async function sendNoteCore(body) {
  const { call, args } = toolArgs(body);
  const caller = callerOf(body, args);

  const requestedTo = String(args.to || args.email || args.recipient || "").trim();
  const subject = String(args.subject || "").trim().slice(0, MAX_SUBJECT_CHARS);
  const note = String(args.body || args.message || args.text || args.note || "").trim();

  const respond = (payload) => ({ status: 200, payload: call?.id
    ? { ...payload, results: [{ toolCallId: call.id, result: JSON.stringify(payload) }] }
    : payload });

  const refuse = async (code, say, extra = {}) => {
    // Refusals are logged too: a run of them is the signal that somebody is
    // probing the line, and it is invisible if only successes are recorded.
    await recordEvent("riley.note_refused", {
      caller,
      requested_to: requestedTo || null,
      subject: subject || null,
      refused: code,
      body_chars: note.length,
      ...extra,
    }).catch(() => {});
    return respond({ ok: false, sent: false, status: "refused", refused: code, say, ...extra });
  };

  if (!requestedTo) {
    return refuse(
      "recipient_missing",
      "I need the email address before I can send anything — what address should I use?",
    );
  }
  if (!recipientAllowed(requestedTo)) {
    // Deliberately does NOT name the allowed address. The refusal must not
    // teach an unknown caller which mailbox is reachable.
    return refuse(
      "recipient_not_allowed",
      "I can't send to that address. Right now I'm only cleared to email one approved address on file, so I'll have to leave it there.",
    );
  }
  // Canonical form from the allowlist, never the caller's spelling.
  const to = ALLOWED_RECIPIENTS.find((allowed) => allowed.toLowerCase() === normalizeSpokenEmail(requestedTo));

  if (!subject) return refuse("subject_missing", "I need a subject line for the note — what should I call it?");
  if (!note) return refuse("empty_note", "There's nothing in the note yet. Tell me what you'd like it to say.");
  if (note.length > MAX_BODY_CHARS) {
    return refuse("note_too_long", "That note is longer than I send by phone — let me cut it down to a few lines and try again.", {
      max_chars: MAX_BODY_CHARS,
    });
  }

  const leak = secretShapedContent(`${subject}\n${note}`);
  if (leak) {
    return refuse("secret_shaped_content", "I'm not able to put keys, passwords or configuration values in an email — I'll leave that out.", {
      detector: leak.kind,
      matched: leak.detail,
    });
  }

  const gate = rateLimitState();
  if (gate.remaining <= 0) {
    return refuse("rate_limited", "I've already sent the most notes I'm allowed to send in an hour, so I'll hold off on this one.", {
      limit: gate.limit,
      used: gate.used,
    });
  }

  // Rendered BEFORE the slot is reserved: a shell that throws must not burn an
  // hour's send budget on an email that was never composed.
  const rendered = renderRileyEmail({
    subject,
    answer: note,
    context: callContext(caller),
  });

  reserveSendSlot();
  const { sendResendEmail } = require("./email");
  let result;
  try {
    result = await sendResendEmail({
      to,
      cc: [],
      bcc: [],
      senderKind: "transactional",
      subject,
      text: rendered.text,
      html: rendered.html,
    });
  } catch (error) {
    releaseSendSlot();
    throw error;
  }
  // A dry run never left this process, so it must not consume the hour's cap.
  if (result?.mode === "dry_run") releaseSendSlot();

  const sent = result?.mode === "sent";
  await recordEvent("riley.note_sent", {
    caller,
    to,
    subject,
    body_chars: note.length,
    mode: result?.mode || "unknown",
    message_id: result?.id || null,
    sent,
    // What the shell was able to render. A note that shipped with no callback
    // line or no postal address is a CONFIGURATION problem, and it is invisible
    // unless the omission is recorded at the moment it happens rather than
    // discovered later in somebody's inbox.
    shell_phone_source: rendered.meta.phoneSource,
    shell_phone_reason: rendered.meta.phoneReason,
    shell_has_postal: Boolean(rendered.meta.postal),
  }).catch(() => {});

  if (!sent) {
    return respond({
      ok: false,
      sent: false,
      status: result?.mode || "send_failed",
      to,
      subject,
      say: "I wasn't able to get that email out just now — nothing was sent. I'll flag it for the team.",
    });
  }

  return respond({
    ok: true,
    sent: true,
    status: "sent",
    to,
    subject,
    message_id: result?.id || null,
    rate: rateLimitState(),
    say: `Done — I've just sent that note to ${to}. It should land in the next few seconds.`,
  });
}

module.exports = {
  sendNoteCore,
  ALLOWED_RECIPIENTS,
  MAX_SENDS_PER_HOUR,
  MAX_BODY_CHARS,
  normalizeSpokenEmail,
  recipientAllowed,
  secretShapedContent,
  rateLimitState,
};
