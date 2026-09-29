"use strict";

// Twilio inbound SMS webhook (form-encoded POST).
// Compliance posture:
//   - STOP-family keywords are ALWAYS honored, even if the signature check
//     fails or Twilio auth is unconfigured. Never drop an opt-out.
//   - START/UNSTOP is recorded for owner review only. It does NOT clear the
//     suppression automatically — the consent gate has no override.
//   - HELP returns a help message. Everything else is logged.
// Phone numbers are masked (last 4 digits) in event payloads.

const { handleError, methodGuard, publicRequestUrl, readRawBody, sendJson } = require("../../lib/http");
const { suppressContact } = require("../../lib/contact-suppression");
const { validateTwilioSignature } = require("../../lib/twilio");
const { recordEvent } = require("../../lib/store");
const { persistInboundSms, resolveSmsNumberMapping } = require("../../lib/customer-sms");
const { connectThreadSeed } = require("../../lib/connect-sms-bridge");
const { ensureThread, addMessage, touchThread } = require("../../lib/connect");

// THE BRIDGE INTO THE CLIENT'S INBOX. When the tracked number's mapping names
// a WSS site (mapping.site_slug), an ordinary customer text also lands as a
// Connect thread — which is what makes the client's phone buzz and lets them
// answer from the app. Fire-and-forget: the compliance path above (STOP,
// suppression, consent recording) already ran, and a Connect hiccup must never
// break the TwiML answer Twilio is waiting on. STOP/HELP/START never reach the
// inbox; they are compliance traffic, not leads.
async function bridgeToConnectSafely(params, mapping, action) {
  try {
    const seed = connectThreadSeed(mapping, params, action);
    if (!seed) return;
    const thread = await ensureThread({
      threadKey: seed.threadKey, siteSlug: seed.siteSlug, channel: seed.channel,
      contactName: seed.contactLabel, contactInfo: seed.contactLabel,
    });
    await addMessage(thread.id, "inbound", seed.body, seed.meta);
    await touchThread(thread.id, { unread: true, meta: seed.meta });
    try {
      const { pushToTenant } = require("../../lib/connect-push");
      if (pushToTenant) await pushToTenant(seed.siteSlug, { title: "New text message", body: seed.body.slice(0, 80) });
    } catch { /* push is a courtesy, never a dependency */ }
  } catch (error) {
    await recordEvent("connect.sms_bridge_failed", {
      error: String(error.message || error).slice(0, 120),
    }).catch(() => {});
  }
}

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt-out"]);
const START_WORDS = new Set(["start", "unstop", "yes", "subscribe", "optin", "opt-in"]);
const HELP_WORDS = new Set(["help", "info"]);

function classify(bodyText) {
  const word = String(bodyText || "").trim().toLowerCase().split(/\s+/)[0] || "";
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return "message";
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  return digits ? `***${digits.slice(-4)}` : null;
}

function twiml(message) {
  const inner = message ? `<Message>${message}</Message>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function sendTwiml(res, xml) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(xml);
}

async function persistInboundSafely(params, mapping, verification, action) {
  try {
    return await persistInboundSms(params, mapping, verification, action);
  } catch (error) {
    await recordEvent("outreach.sms_persist_failed", {
      accountId: mapping?.account_id || null,
      messageSid: params.MessageSid || params.SmsSid || null,
      error: error.code || error.message,
    }).catch(() => {});
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    // Vercel's Node runtime pre-parses x-www-form-urlencoded bodies into an
    // object on req.body; fall back to raw parsing for other runtimes.
    let params;
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      params = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [k, String(v)]));
    } else {
      const raw = await readRawBody(req);
      params = Object.fromEntries(new URLSearchParams(raw || "").entries());
    }
    const verification = validateTwilioSignature(
      publicRequestUrl(req),
      params,
      req.headers["x-twilio-signature"],
    );

    const from = params.From || "";
    const bodyText = params.Body || "";
    const action = classify(bodyText);

    if (!from) {
      sendJson(res, 400, { ok: false, error: "missing_from_number" });
      return;
    }

    const masked = maskPhone(from);
    let mapping = null;
    try {
      mapping = await resolveSmsNumberMapping(params);
    } catch (mappingError) {
      await recordEvent("outreach.sms_mapping_lookup_failed", {
        phone: masked,
        error: mappingError.code || mappingError.message,
      });
    }

    if (action === "stop") {
      // Opt-outs are honored unconditionally — even unverified.
      const revoked = await suppressContact({
        phone: from,
        source: "twilio_inbound",
        reason: "sms_stop",
        channels: { text: true },
        payload: {
          verified: verification.verified,
          keyword: String(bodyText || "").trim().slice(0, 24),
          messageSid: params.MessageSid || params.SmsSid || null,
        },
      });
      await persistInboundSafely(params, mapping, verification, action);
      await recordEvent("outreach.sms_revoked", {
        phone: masked,
        verified: verification.verified,
        suppressionMode: revoked.suppression.mode,
        consentMode: revoked.consent.mode,
        hotLeadMode: revoked.hotLeads.mode,
      });
      // Twilio's Advanced Opt-Out sends its own mandatory STOP confirmation;
      // an empty response avoids a duplicate (and replies to a stopped number
      // are blocked anyway).
      sendTwiml(res, twiml(""));
      return;
    }

    // Anything that could RE-ENABLE contact requires a verified signature,
    // and even then is only recorded for owner review — never auto-applied.
    if (!verification.configured || !verification.verified) {
      await recordEvent("outreach.sms_inbound_rejected", {
        phone: masked,
        action,
        reason: "twilio_signature_invalid",
      });
      sendJson(res, 401, { ok: false, error: "twilio_signature_invalid" });
      return;
    }

    if (action === "start") {
      await persistInboundSafely(params, mapping, verification, action);
      await recordEvent("outreach.sms_start_received", {
        phone: masked,
        note: "Re-opt-in recorded for owner review. Suppression NOT cleared automatically.",
        messageSid: params.MessageSid || params.SmsSid || null,
      });
      sendTwiml(res, twiml(""));
      return;
    }

    if (action === "help") {
      await persistInboundSafely(params, mapping, verification, action);
      await recordEvent("outreach.sms_help_received", { phone: masked });
      sendTwiml(
        res,
        twiml(
          "WSS Labs: local website care and support. Reply STOP to opt out. Questions: support@woodwardsoftware.com",
        ),
      );
      return;
    }

    const persisted = await persistInboundSafely(params, mapping, verification, action);
    await bridgeToConnectSafely(params, mapping, action);
    await recordEvent("outreach.sms_inbound", {
      phone: masked,
      preview: String(bodyText || "").slice(0, 160),
      messageSid: params.MessageSid || params.SmsSid || null,
      accountId: mapping?.account_id || null,
      persisted: Boolean(persisted),
    });
    sendTwiml(res, twiml(""));
  } catch (error) {
    handleError(res, error);
  }
};
