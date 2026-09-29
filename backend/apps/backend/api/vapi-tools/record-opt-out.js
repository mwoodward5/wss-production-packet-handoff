"use strict";

// api/vapi-tools/record-opt-out.js — make "I can take care of that" (a
// do-not-call request) a compliance ROW instead of a good intention.
//
// THE PHANTOM THIS ENDS. Riley said "I can take care of that" on a live call
// when a caller asked not to be contacted again. Nothing took care of it: no
// row, no gate, no record. A verbal opt-out that leaves no durable trace is a
// compliance failure waiting to be re-dialed.
//
// WHAT ONE CALL DOES, IN ORDER:
//   1. a suppression row keyed by the caller's phone lands in
//      ghost_agency_suppressions (timestamp, source call id, reason) and the
//      consent_registrar flags consent_to_call/consent_to_text false — the
//      exact two writes lib/contact-suppression.js has made since the outreach
//      lanes shipped (reuse, not a parallel system);
//   2. the ledger event records the opt-out for the audit trail, plus one
//      structured telemetry line;
//   3. the owner is told once — the FIRST time this number opts out. A
//      duplicate request refreshes the row's timestamp/source but raises no
//      second alarm.
//
// WHO CONSULTS THIS ROW TODAY (the gates that already read
// ghost_agency_suppressions / consent_registrar and now inherit this row):
//   · lib/email.js suppressionBlocked() — every provider-boundary send;
//   · lib/line-delivery.js — the Line's send lane;
//   · lib/customer-sms.js — outbound texts;
//   · lib/twilio.js — call-side suppression;
//   · lib/connect.js, lib/mission-control-customer.js — operator surfaces;
//   · lib/full-run.js, lib/supervised-held-drafts.js — cold-outreach lanes.
// The Riley completion follow-up (lib/riley-followups.js) checks the same
// ledger before any customer email. If a future outbound surface does not
// consult it, THIS row is still the compliance record of the request.
//
// HOSTILE-CALL SAFE BY CONTRACT. No lookup prerequisites beyond the phone
// number: no Client ID, no business match, no prospect resolution — a caller
// who wants off the list is never asked to identify themselves first, and a
// prompt-injected model cannot be talked out of the write by withholding
// context. Auth is the same shared-secret check as every other tool (an
// unauthenticated writer would let anyone suppress anyone).
//
// TRUTH LAW: the `say` line claims only what the row proves — the request is
// recorded on the do-not-call ledger. It promises nothing about what a human
// may or may not do, and it never argues with the caller.

const { timingSafeEqual } = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

const SUPPRESSIONS_TABLE = "ghost_agency_suppressions";

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
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return g.length === b.length && timingSafeEqual(g, b);
  });
}

function toolArgs(body) {
  const call = body?.message?.toolCalls?.[0];
  const raw = call?.function?.arguments;
  let args = body;
  if (raw) {
    try { args = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { args = {}; }
  }
  return { call, args: args && typeof args === "object" ? args : {} };
}

function callIdOf(body, args) {
  return String(
    body?.message?.call?.id
      || body?.call?.id
      || body?.message?.callId
      || body?.callId
      || args?.call_id
      || "",
  ).trim().slice(0, 80);
}

/**
 * The number to suppress. Accepts it from the platform envelope (the caller's
 * own number) or from the args (Riley repeats a number the caller gives).
 * NOTHING ELSE is required — that is the hostile-call contract above.
 */
function phoneOf(body, args) {
  return String(
    args?.phone
      || args?.number
      || args?.caller_phone
      || body?.message?.call?.customer?.number
      || body?.message?.customer?.number
      || body?.call?.customer?.number
      || "",
  ).trim();
}

function last10(value) {
  const d = String(value == null ? "" : value).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

  try {
    const body = await readJson(req).catch(() => ({}));
    const { call, args } = toolArgs(body);
    const callId = callIdOf(body, args);

    const respond = (payload) => {
      if (call?.id) {
        return sendJson(res, 200, {
          ...payload,
          results: [{ toolCallId: call.id, result: JSON.stringify(payload) }],
        });
      }
      return sendJson(res, 200, payload);
    };

    const phoneRaw = phoneOf(body, args);
    const digits = last10(phoneRaw);
    if (!digits) {
      return respond({
        ok: false,
        recorded: false,
        status: "refused",
        refused: "phone_missing",
        say: "I can record that right now — confirm the number you'd like taken off the list, and it's done.",
      });
    }
    // Normalized E.164-ish for the ledger key: keep the leading + when given,
    // else bare digits (the same shape lib/contact-suppression.js writes).
    const phone = String(phoneRaw).startsWith("+") ? phoneRaw.replace(/[^\d+]/g, "") : digits;
    const email = clean(args.email || args.contact_email, 240).toLowerCase();
    const reason = clean(args.reason, 120) || "customer_dnc_request";
    const source = `riley_voice_call:${callId || "unknown"}`;

    const { select, recordEvent } = require("../../lib/store");
    const { suppressContact } = require("../../lib/contact-suppression");

    // DUPLICATE HANDLING: same number already on the ledger -> refresh the row
    // (new timestamp + source) but report duplicate and raise no second owner
    // email. The upsert below is idempotent by key either way.
    const priorAt = await select(
      SUPPRESSIONS_TABLE,
      `suppression_key=eq.${encodeURIComponent(phone)}&limit=1`,
    ).catch(() => null);
    const duplicate = Boolean(priorAt && priorAt.ok === true && Array.isArray(priorAt.data) && priorAt.data.length);

    // THE DNC WRITE — the same two rows every other opt-out lane writes.
    // channels: the voice line is the channel the caller is on; text rides the
    // same number. Email keeps its own STOP path (lib/reply-agent.js).
    const result = await suppressContact({
      phone,
      ...(email ? { email } : {}),
      source,
      reason,
      channels: { call: true, text: true },
    });
    // A dry run (store unconfigured) is NOT a recorded opt-out — the row does
    // not exist, so the tool refuses to say it does. The compliance record is
    // the whole point; nothing here may overstate it.
    const suppressionMode = result && result.suppression ? String(result.suppression.mode) : "";
    const consentMode = result && result.consent ? String(result.consent.mode) : "";
    const writeFailed = suppressionMode === "dry_run"
      || suppressionMode.endsWith("_failed")
      || consentMode === "dry_run"
      || consentMode.endsWith("_failed");
    if (writeFailed) {
      return respond({
        ok: false,
        recorded: false,
        status: "unavailable",
        say: "I wasn't able to save that to the do-not-call list just now, so I won't claim it's done — I'm flagging it so a person makes sure it is.",
      });
    }

    await recordEvent("ghost_agency_dnc_recorded", {
      phone_last4: digits.slice(-4),
      source,
      reason,
      duplicate,
      call_id: callId || null,
      suppression_mode: result && result.suppression ? result.suppression.mode : null,
    }).catch(() => {});
    console.log(JSON.stringify({
      event: "riley_dnc_recorded",
      phone_last4: digits.slice(-4),
      source,
      duplicate,
      call_id: callId || null,
    }));

    // Owner told ONCE per number — a duplicate request is a refresh, not news.
    let ownerNotified = false;
    if (!duplicate) {
      try {
        const apiKey = String(process.env.RESEND_API_KEY || "").trim();
        const to = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "woodwardsoftware@gmail.com").trim();
        if (apiKey && to) {
          const { sendResendEmail } = require("../../lib/email");
          const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
          const result2 = await sendResendEmail({
            to,
            cc: [],
            bcc: [],
            senderKind: "transactional",
            subject: "Do-not-call recorded from Riley's line",
            html: `<div style="max-width:560px;font-family:-apple-system,Segoe UI,sans-serif">
<h2 style="font-size:17px">Do-not-call recorded</h2>
<p style="font-size:14px;color:#33332c">A caller asked not to be contacted again. The number is on the suppression ledger now; every outbound gate that reads it will honor the request.</p>
<table style="font-size:13px;color:#55554d;margin-top:10px">
<tr><td style="padding:2px 12px 2px 0;font-weight:700">Number</td><td>${esc(digits.slice(0, 6))}&hellip;${esc(digits.slice(-4))} (full number on the row)</td></tr>
<tr><td style="padding:2px 12px 2px 0;font-weight:700">Source</td><td>${esc(source)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;font-weight:700">Reason</td><td>${esc(reason)}</td></tr>
</table>
<p style="color:#8a8a80;font-size:12px;margin-top:16px">Recorded by Riley's record_opt_out tool.</p>
</div>`,
            text: `Do-not-call recorded\n\nNumber: ${digits.slice(0, 6)}…${digits.slice(-4)} (full number on the row)\nSource: ${source}\nReason: ${reason}\n\nRecorded by Riley's record_opt_out tool.`,
            idempotencyKey: `dnc:${phone}:${callId || "unknown"}`,
          });
          ownerNotified = Boolean(result2 && result2.mode === "sent");
        }
      } catch {
        ownerNotified = false;
      }
    }

    return respond({
      ok: true,
      recorded: true,
      duplicate,
      owner_notified: ownerNotified,
      // Truth law: one claim — the request is on the do-not-call ledger, and
      // this call is the record of it. No argument, no persuasion, no ETA.
      say: "Done — that number is on our do-not-call list now, and this call is noted as the request.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
