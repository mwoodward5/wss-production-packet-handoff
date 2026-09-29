"use strict";

// api/vapi-tools/flag-for-team.js — make "I flagged it for the team" TRUE.
//
// THE PHANTOM THIS ENDS. On live calls Riley said "I've flagged it for the
// team" and "I can escalate" — and nothing was flagged, because no machinery
// existed. The status tool (site-edit-status.js) even detects the sentence
// shape and refuses to SAY it for Riley; the promise needed a tool that makes
// it a fact instead of a lie. This is that tool.
//
// WHAT ACTUALLY HAPPENS on one call, in order:
//   1. a durable row lands in ghost_agency_team_flags (client_ref, reason,
//      job id, call id) — the flag survives the hang-up;
//   2. the owner's inbox gets the flag NOW (the same Resend rail
//      notifyOwner uses in lib/edit-job-runner.js) — "the team has it in
//      front of them" is true the moment the `say` line is spoken;
//   3. an event lands on the ledger for the audit trail and the telemetry
//      log prints one structured line.
//
// THE TRUTH LAW. The `say` line promises exactly two things — the flag is
// recorded, and it is in front of the team now — and never an ETA. No "Marcus
// or Ava will pick it up": the roster hallucination is already refused by name
// in api/vapi-tools/riley-tools.js, and this tool does not reintroduce it.
//
// AUTH: identical to every other tool in this directory. VOICE SHAPE: small
// JSON, `say` always present on authenticated outcomes, Vapi toolCallId
// envelope applied when the caller is Vapi.

const { timingSafeEqual } = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

const MAX_REASON_CHARS = 400;
const MAX_DETAIL_CHARS = 800;

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
  // No secret configured => nobody is authorized. Fails closed.
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

/** The VAPI call id, from the envelope shapes the platform actually sends. */
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

    const reason = clean(args.reason || args.issue || args.problem, MAX_REASON_CHARS);
    const clientRef = clean(args.client_ref || args.clientRef || args.client_id || args.reference, 40);
    const siteSlug = clean(args.site_slug || args.siteSlug || args.site, 160);
    const jobId = clean(args.job_id || args.jobId, 160);
    const details = clean(args.details || args.notes || args.note, MAX_DETAIL_CHARS);

    // No lookup prerequisites: a caller mid-sentence about anything can be
    // flagged with nothing but the reason. Identity enriches the row; it never
    // gates the write.
    if (!reason) {
      return respond({
        ok: false,
        flagged: false,
        status: "refused",
        refused: "reason_missing",
        say: "I can flag that for the team — tell me in a sentence what the issue is and I'll log it.",
      });
    }

    const { insertRow, recordEvent } = require("../../lib/store");
    const flagId = `flag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const written = await insertRow("ghost_agency_team_flags", {
      flag_id: flagId,
      client_ref: clientRef || null,
      site_slug: siteSlug || null,
      job_id: jobId || null,
      reason,
      details: details || null,
      call_id: callId || null,
      status: "open",
      created_at: now,
      updated_at: now,
    });
    // TRUTH LAW AT THE STORE: anything but a confirmed live write (dry run,
    // store hiccup) means the row does not exist — so the tool refuses to say
    // "flagged", exactly the discipline of riley-tools' own schedule_callback.
    if (!written || written.mode !== "live_write") {
      return respond({
        ok: false,
        flagged: false,
        status: "unavailable",
        say: "I couldn't get the flag to save just now, so I'm not going to claim I logged it. Can I take the details as a message instead?",
      });
    }

    await recordEvent("ghost_agency_team_flag_created", {
      flag_id: flagId,
      client_ref: clientRef || null,
      site_slug: siteSlug || null,
      job_id: jobId || null,
      reason,
      has_details: Boolean(details),
      call_id: callId || null,
    }).catch(() => {});
    console.log(JSON.stringify({
      event: "riley_team_flag_created",
      flag_id: flagId,
      client_ref: clientRef || null,
      site_slug: siteSlug || null,
      job_id: jobId || null,
      call_id: callId || null,
    }));

    // THE OWNER EMAIL, NOW. This is what makes the past tense honest: the flag
    // is in a human's inbox before the `say` line finishes leaving the call.
    // A missing or failed mailer never un-flags the row — the row is the flag.
    let ownerNotified = false;
    try {
      const apiKey = String(process.env.RESEND_API_KEY || "").trim();
      const to = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "woodwardsoftware@gmail.com").trim();
      if (apiKey && to) {
        const { sendResendEmail } = require("../../lib/email");
        const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const rows = [
          ["Client ref", clientRef],
          ["Site", siteSlug],
          ["Job", jobId],
          ["Call", callId],
          ["Raised", now],
        ].filter(([, v]) => v);
        const result = await sendResendEmail({
          to,
          cc: [],
          bcc: [],
          senderKind: "transactional",
          subject: `Team flag from Riley's line — ${reason.slice(0, 80)}`,
          html: `<div style="max-width:560px;font-family:-apple-system,Segoe UI,sans-serif">
<h2 style="font-size:17px">Team flag — ${esc(reason)}</h2>
<p style="font-size:14px;color:#33332c">${details ? esc(details) : "Riley flagged this on a live call; no extra notes were taken."}</p>
<table style="font-size:13px;color:#55554d;margin-top:10px">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;font-weight:700">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p style="color:#8a8a80;font-size:12px;margin-top:16px">Flag ${esc(flagId)} · recorded by Riley's flag_for_team tool.</p>
</div>`,
          text: `Team flag — ${reason}\n\n${details || "Riley flagged this on a live call; no extra notes were taken."}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nFlag ${flagId} · recorded by Riley's flag_for_team tool.`,
          idempotencyKey: `flag:${flagId}`,
        });
        ownerNotified = Boolean(result && result.mode === "sent");
      }
    } catch {
      ownerNotified = false;
    }

    return respond({
      ok: true,
      flagged: true,
      status: "flagged",
      flag_id: flagId,
      owner_notified: ownerNotified,
      // Truth law: two claims only — recorded, and in front of the team now.
      // No ETA, no named teammate, no "someone will call you back" (that is
      // schedule_callback's promise to make, with its own row).
      say: "Done — that's flagged for the team, and it's in front of them now with everything I noted attached.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
