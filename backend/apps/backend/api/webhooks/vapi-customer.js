"use strict";

const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { suppressContact } = require("../../lib/contact-suppression");
const { verifyVapiWebhook } = require("../../lib/vapi");
const { event, recordEvent } = require("../../lib/store");
const { recordCustomerCallUsage } = require("../../lib/mission-control-customer");

function messagePayload(body = {}) {
  return body.message || body;
}

function eventType(body = {}) {
  return body.type || body.message?.type || body.message?.event || "unknown";
}

function isEndOfCallReport(body = {}) {
  return [
    "end-of-call-report",
    "end_of_call_report",
    "call.ended",
    "call-ended",
    "call.completed",
    "call_completed",
  ].includes(eventType(body));
}

function structuredSummary(message = {}) {
  const value = message.analysis?.structuredData || message.structuredData || message.summary || null;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isOptOut(summary) {
  const outcome = String(summary?.outcome || summary?.disposition || "").toLowerCase();
  return ["opt_out", "opt-out", "do_not_call", "do-not-call", "remove_me"].includes(outcome);
}

function callIdentity(call = {}, summary = {}) {
  return {
    phone: call.customer?.number || call.customerNumber || call.phoneNumber || summary.phone || "",
    email: call.customer?.email || summary.email || "",
    prospectId: call.metadata?.prospect_id || call.metadata?.prospectId || summary.prospect_id || "",
    reportId: call.metadata?.report_id || call.metadata?.reportId || summary.report_id || "",
    business: call.metadata?.business_name || call.metadata?.businessName || summary.business_name || "",
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const verification = verifyVapiWebhook(req);
    if (!verification.configured || !verification.verified) {
      sendJson(res, 401, {
        ok: false,
        error: verification.configured ? "vapi_signature_invalid" : "vapi_webhook_not_configured",
      });
      return;
    }

    const body = await readJson(req);
    const message = messagePayload(body);
    const type = eventType(body);
    const call = message.call || body.call || {};
    const stored = await recordEvent("vapi_customer_webhook", {
      verified: true,
      type,
      callId: call.id || body.id,
      body,
    });

    let callSummary = null;
    let optOut = null;
    let usage = null;
    if (isEndOfCallReport(body)) {
      const summary = structuredSummary(message);
      if (summary) {
        callSummary = await event({
          type: "outreach.call_completed",
          actor: "vapi.customer_voice",
          status: "ok",
          payload: {
            prospect_id: call.metadata?.prospect_id || call.metadata?.prospectId || "",
            call_id: call.id || body.id || "",
            summary,
          },
        });
        if (isOptOut(summary)) {
          const identity = callIdentity(call, summary);
          optOut = await suppressContact({
            ...identity,
            source: "vapi_voice_opt_out",
            reason: "voice_opt_out",
            channels: { call: true, text: true, email: true },
            payload: {
              callId: call.id || body.id || null,
              assistantId: call.assistantId || null,
              outcome: summary.outcome || summary.disposition || "opt_out",
            },
          });
          await recordEvent("outreach.voice_revoked", {
            callId: call.id || body.id || null,
            prospectId: identity.prospectId || null,
            suppressionMode: optOut.suppression.mode,
            consentMode: optOut.consent.mode,
            hotLeadMode: optOut.hotLeads.mode,
          });
        }
      }
      usage = await recordCustomerCallUsage(call, {
        summary,
        analysis: message.analysis || body.analysis || null,
        artifact: message.artifact || body.artifact || null,
        compliance: message.compliance || body.compliance || null,
        callId: call.id || body.id,
        durationSeconds: message.durationSeconds ?? body.durationSeconds,
        durationMinutes: message.durationMinutes ?? body.durationMinutes,
        startedAt: message.startedAt || body.startedAt,
        endedAt: message.endedAt || body.endedAt,
        endedReason: message.endedReason || body.endedReason || call.endedReason,
      });
    }

    sendJson(res, 200, { ok: true, stored, callSummary, optOut, usage });
  } catch (error) {
    handleError(res, error);
  }
};
