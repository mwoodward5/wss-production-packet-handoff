"use strict";
// lib/connect-sms-bridge.js — the LeadConnector loop, on our stack.
//
// A customer texts the business's tracked number → the text becomes a WSS
// Connect thread → the client's phone buzzes (push shipped 2026-08-09) → the
// client answers in the app → the answer goes back out as a real SMS. The
// pieces all existed (the Twilio inbound webhook, the consent-recording
// conversation store, the sender with suppression, Connect threads with an
// "sms" channel whose delivery read "worker not yet live") — this module is
// the missing 10% that joins them.
//
// THE COMPLIANCE SHAPE IS THE ARCHITECTURE. Cited research (2026-08-11,
// docs-level: TCPA has no B2B exemption; cold outbound SMS risks $1,500/text;
// carriers approve inbound-triggered conversational messaging): so this bridge
// makes cold SMS STRUCTURALLY impossible rather than policy-forbidden —
//
//   1. A Connect SMS thread can only be BORN from an inbound text (the
//      webhook is the sole writer of the meta this module requires).
//   2. An outbound reply requires: channel "sms" + the thread's stored
//      customer_phone + at least one INBOUND message already on the thread +
//      the conversation's consent row (consent_to_text true, recorded by
//      persistInboundSms with the inbound SID as proof) + no suppression.
//   3. There is no function in this file that sends to an arbitrary number.
//
// STOP handling stays upstream in the webhook and is always honored; a
// suppressed contact fails the consent read here as well — belt and braces.

const { recordEvent } = require("./store");

function phoneKey(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

/**
 * connectThreadSeed(mapping, params) — what the inbound webhook hands to
 * Connect's ingest for a customer text. Pure; the webhook supplies the store.
 * Returns null when the mapping carries no site_slug (an AnswerCrew-only
 * number) or the action is not an ordinary message — STOP/HELP/START traffic
 * belongs to the compliance path, never to the client's inbox.
 */
function connectThreadSeed(mapping, params = {}, action = "message") {
  if (!mapping || !mapping.site_slug) return null;
  if (action !== "message") return null;
  const from = String(params.From || "").trim();
  const to = String(params.To || "").trim();
  const body = String(params.Body || "").trim();
  if (!from || !body) return null;
  return {
    siteSlug: String(mapping.site_slug),
    channel: "sms",
    threadKey: `${mapping.site_slug}:sms:${phoneKey(from)}`,
    // The visible sender is masked; the full number lives in meta for the
    // reply path only, and the tenant token scoping already proven on
    // /api/connect keeps it inside this tenant.
    contactLabel: `***${phoneKey(from).slice(-4)}`,
    body: body.slice(0, 1600),
    meta: {
      source: "sms_inbound",
      customer_phone: from,
      business_number: to,
      account_id: mapping.account_id || null,
      inbound_sid: String(params.MessageSid || params.SmsSid || "") || null,
    },
  };
}

/**
 * smsReplyAuthorized({ thread, messages, conversation, suppressed }) — the
 * structural gate. Every condition is a fact already recorded by the inbound
 * path; nothing here can be satisfied by an outbound-only history.
 */
function smsReplyAuthorized({ thread, messages = [], conversation = null, suppressed = false } = {}) {
  if (!thread || thread.channel !== "sms") {
    return { ok: false, reason: "not_an_sms_thread" };
  }
  const to = thread.meta && thread.meta.customer_phone;
  if (!to) return { ok: false, reason: "no_customer_phone_on_thread" };
  const hasInbound = messages.some((m) => m && (m.direction === "inbound" || m.sender === "visitor" || m.sender === "customer"));
  if (!hasInbound) {
    // The thread exists but the customer has never actually texted on it —
    // replying here would be an outbound-initiated SMS wearing a reply's
    // clothes. Refuse.
    return { ok: false, reason: "no_inbound_message_on_thread" };
  }
  if (suppressed) return { ok: false, reason: "contact_suppressed" };
  if (!conversation || conversation.consent_to_text !== true) {
    return { ok: false, reason: "no_recorded_consent" };
  }
  return { ok: true, to, from: thread.meta.business_number || null };
}

/**
 * deliverSmsReply(deps, { thread, messages, body }) -> delivery result.
 * deps: { sendTwilioMessage, readConversation, isSuppressed } — injected so
 * the gate is testable without Twilio and so the caller (lib/connect.js)
 * controls the store access it already owns.
 */
async function deliverSmsReply(deps, { thread, messages, body } = {}) {
  const text = String(body || "").trim();
  if (!text) return { channel: "sms", delivered: false, reason: "empty_body" };
  const to = thread && thread.meta && thread.meta.customer_phone;
  const conversation = to && deps.readConversation ? await deps.readConversation(to, thread.meta.account_id || null) : null;
  const suppressed = to && deps.isSuppressed ? await deps.isSuppressed(to) : false;
  const verdict = smsReplyAuthorized({ thread, messages, conversation, suppressed });
  if (!verdict.ok) {
    await recordEvent("connect.sms_reply_refused", {
      threadId: thread && thread.id, reason: verdict.reason,
    }).catch(() => {});
    return { channel: "sms", delivered: false, reason: verdict.reason };
  }
  try {
    const sent = await deps.sendTwilioMessage({
      to: verdict.to,
      from: verdict.from || undefined,
      body: text.slice(0, 1600),
    });
    return { channel: "sms", delivered: true, sid: sent && (sent.sid || sent.messageSid) || null };
  } catch (error) {
    return { channel: "sms", delivered: false, reason: `twilio_send_failed: ${String(error.message || error).slice(0, 120)}` };
  }
}

module.exports = { connectThreadSeed, smsReplyAuthorized, deliverSmsReply, phoneKey };
