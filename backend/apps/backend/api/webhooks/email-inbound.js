"use strict";

// Inbound prospect reply intake. The public Resend/Svix lane is verified and
// routed here by api/webhooks/resend.js. This route itself is the admin-token
// lane for a manual forward from the support inbox.
// Flow: match prospect by sender email -> opt-out intent writes suppression +
// do_not_contact -> otherwise the reply agent drafts a response into the reply
// queue (events ledger). Provider delivery always requires explicit approval
// through /api/admin/reply-queue; the retired autopilot env is ignored.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { recordEvent, select, upsertRow } = require("../../lib/store");
const { draftReply } = require("../../lib/reply-agent");

function isAdmin(req) {
  const token = String(process.env.GHOST_AGENCY_ADMIN_TOKEN || "").trim();
  return token && String(req.headers["x-admin-token"] || "").trim() === token;
}

function requireDurableOptOutWrite(kind, result) {
  if (result && ["live_write", "live_upsert"].includes(result.mode)) return result;
  const error = new Error(`Could not durably persist the ${kind} opt-out state. No reply was drafted or sent.`);
  error.code = "reply_opt_out_persistence_failed";
  error.statusCode = 503;
  throw error;
}

function requireDurableConsentWrite(result) {
  if (result && ["live_write", "live_upsert"].includes(result.mode)) return result;
  const error = new Error("Could not durably record permission to build a custom preview. No reply was drafted or sent.");
  error.code = "reply_consent_persistence_failed";
  error.statusCode = 503;
  throw error;
}

function emailAddress(value = "") {
  const match = String(value || "").match(/<([^<>@\s]+@[^<>@\s]+)>/);
  const email = String(match?.[1] || value || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "";
}

// Reply clients commonly append the original email, whose compliance footer
// contains the word STOP. Classify only the newest human-written portion so a
// normal "yes" reply is never mistaken for an opt-out.
function latestReplyText(value = "") {
  let text = String(value || "").replace(/\r\n?/g, "\n").replace(/\0/g, "").trim();
  const cutPatterns = [
    /\nOn .{1,500}\bwrote:\s*$/im,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nFrom:\s*[^\n]+\n(?:Sent|Date):/i,
    /\n_{5,}\s*$/m,
    /\n>{1,}\s?/,
  ];
  let cutAt = text.length;
  for (const pattern of cutPatterns) {
    const match = pattern.exec(text);
    if (match && match.index < cutAt) cutAt = match.index;
  }
  text = text.slice(0, cutAt).trim();
  return text.slice(0, 10_000);
}

function inboundFailure(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function processInboundReply({
  from = "",
  text = "",
  subject = "",
  inboundId = "",
} = {}) {
  const fromEmail = emailAddress(from);
  const currentReply = latestReplyText(text);
  const cleanSubject = String(subject || "").slice(0, 200);
  if (!fromEmail || !currentReply) throw inboundFailure("missing_from_or_text");

  const found = await select(
    "ghost_agency_prospects",
    `?select=*&or=(email.eq.${encodeURIComponent(fromEmail)},owner_email.eq.${encodeURIComponent(fromEmail)})&limit=1`,
  );
  if (!found?.ok) throw inboundFailure("prospect_lookup_unavailable", 503);
  const row = Array.isArray(found.data) && found.data[0] ? found.data[0] : null;
  const prospect = row ? { ...(row.record || {}), ...row } : { email: fromEmail };
  const prospectId = row ? row.prospect_id : `unknown-${fromEmail}`;
  const { intent, draft } = await draftReply({ prospect, inboundText: currentReply });

  await recordEvent("reply.received", {
    prospectId,
    fromEmail,
    subject: cleanSubject,
    intent,
    inboundId: inboundId || null,
    preview: currentReply.slice(0, 500),
  });

  if (intent === "opt_out") {
    const now = new Date().toISOString();
    requireDurableOptOutWrite("suppression", await upsertRow("ghost_agency_suppressions", {
      suppression_key: prospectId,
      email: fromEmail,
      prospect_id: prospectId,
      reason: "reply_opt_out",
      source: "email_inbound",
      updated_at: now,
    }, "suppression_key"));
    if (row) {
      requireDurableOptOutWrite("prospect", await upsertRow(
        "ghost_agency_prospects",
        { prospect_id: prospectId, status: "do_not_contact", updated_at: now },
        "prospect_id",
      ));
    }
    await recordEvent("reply.opt_out", { prospectId, fromEmail, inboundId: inboundId || null });
    return { ok: true, intent, action: "suppressed" };
  }

  if (intent === "interested" && row) {
    const now = new Date().toISOString();
    const currentRecord = row.record && typeof row.record === "object" && !Array.isArray(row.record)
      ? row.record
      : {};
    requireDurableConsentWrite(await upsertRow(
      "ghost_agency_prospects",
      {
        prospect_id: prospectId,
        status: "engaged",
        record: {
          ...currentRecord,
          preview_build_consent: {
            status: "granted",
            recorded_at: now,
            source: "email_reply",
          },
        },
        updated_at: now,
      },
      "prospect_id",
    ));
  }

  const stableId = String(inboundId || "").replace(/[^a-z0-9-]/gi, "").slice(0, 80);
  const draftId = stableId
    ? `draft-inbound-${stableId}`
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await recordEvent("reply.draft", {
    draftId,
    prospectId,
    fromEmail,
    subject: cleanSubject ? `Re: ${cleanSubject.replace(/^re:\s*/i, "")}` : "Re: your custom website preview",
    intent,
    mode: draft.mode,
    body: draft.text,
    approval: "pending",
    inboundId: inboundId || null,
  });
  return {
    ok: true,
    intent,
    action: "draft_queued",
    draftId,
    note: "Approve via /api/admin/reply-queue",
  };
}

async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    if (!isAdmin(req) && !requireAdmin(req, res)) return;
    const body = await readJson(req);
    const data = body.data && typeof body.data === "object" ? body.data : body;
    const result = await processInboundReply({
      from: data.from_email || data.from || "",
      text: data.text || data.body || data.reply || "",
      subject: data.subject || "",
      inboundId: data.email_id || data.id || "",
    });
    sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
}

module.exports = handler;
module.exports.emailAddress = emailAddress;
module.exports.latestReplyText = latestReplyText;
module.exports.processInboundReply = processInboundReply;
