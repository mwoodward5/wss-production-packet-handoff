"use strict";

const { handleError, methodGuard, readJson, sendJson } = require("../lib/http");
const { sendResendEmail } = require("../lib/email");
const { recordEvent } = require("../lib/store");
const { ensureThread, addMessage, touchThread } = require("../lib/connect");

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

// Per-instance rate limit: this is a public, unauthenticated endpoint that sends
// an email to the owner, so cap bursts to blunt spam/abuse. (Serverless
// instances reset this naturally.) Mirrors api/discover.js.
const hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = hits.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  hits.set(key, entry);
  return entry.count > 6;
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function maskedContact(value) {
  const raw = clean(value, 240);
  if (!raw) return "";
  if (raw.includes("@")) {
    const [name, domain] = raw.split("@");
    return `${name.slice(0, 2)}***@${domain || ""}`;
  }
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (rateLimited(clientIp(req))) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
    return;
  }
  try {
    const body = await readJson(req);
    if (clean(body.website || body.company_website, 200)) {
      sendJson(res, 200, { ok: true, accepted: true });
      return;
    }

    const name = clean(body.name || body.contact_name, 160);
    const contact = clean(body.email_or_phone || body.email || body.phone, 240);
    const message = clean(body.message || body.notes || body.project, 2000);
    const business = clean(body.business_name || body.business, 180);
    const prospectId = clean(body.prospect_id || body.prospectId, 160);
    if (!name || !contact || !message) {
      sendJson(res, 400, {
        ok: false,
        error: "missing_required_fields",
        required: ["name", "email_or_phone", "message"],
      });
      return;
    }

    const ownerEmail = clean(process.env.GHOST_AGENCY_OWNER_EMAIL || process.env.LOCAL_GROWTH_OWNER_EMAIL, 240);
    await recordEvent("preview.contact_received", {
      prospectId: prospectId || null,
      business: business || null,
      name,
      contact: maskedContact(contact),
      source: "preview_contact_form",
    });

    const email = ownerEmail
      ? await sendResendEmail({
          senderKind: "transactional",
          to: ownerEmail,
          replyTo: contact.includes("@") ? contact : undefined,
          subject: `Preview inquiry${business ? ` - ${business}` : ""}`,
          text: [
            `Name: ${name}`,
            `Contact: ${contact}`,
            `Business: ${business || "Not supplied"}`,
            `Prospect ID: ${prospectId || "Not supplied"}`,
            "",
            message,
          ].join("\n"),
          html: `<p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Contact:</strong> ${escapeHtml(contact)}</p><p><strong>Business:</strong> ${escapeHtml(business || "Not supplied")}</p><p>${escapeHtml(message)}</p>`,
        })
      : { mode: "event_only", reason: "owner_email_not_configured" };

    sendJson(res, email.mode === "send_failed" ? 502 : 200, {
      ok: email.mode !== "send_failed",
      accepted: email.mode !== "send_failed",
      delivery: email.mode,
      fallback: email.mode === "event_only" ? "mailto" : null,
    });
  } catch (error) {
    handleError(res, error);
  }
};
