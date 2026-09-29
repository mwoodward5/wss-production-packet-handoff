const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { verifyVapiWebhook } = require("../../lib/vapi");
const { event, recordEvent } = require("../../lib/store");

function messagePayload(body = {}) {
  return body.message || body;
}

function eventType(body = {}) {
  return body.type || body.message?.type || body.message?.event || "unknown";
}

function isEndOfCallReport(body = {}) {
  const type = eventType(body);
  return [
    "end-of-call-report",
    "end_of_call_report",
    "call.ended",
    "call-ended",
    "call.completed",
    "call_completed",
  ].includes(type);
}

function structuredSummary(message = {}) {
  return message.analysis?.structuredData || message.structuredData || message.summary || null;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const verification = verifyVapiWebhook(req);
    if (!verification.configured) {
      sendJson(res, 503, { ok: false, error: "vapi_webhook_not_configured" });
      return;
    }
    if (!verification.verified) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJson(req);
    const message = messagePayload(body);
    const type = eventType(body);
    const call = message.call || body.call || {};
    const stored = await recordEvent("vapi_webhook", {
      verified: verification.verified,
      type,
      callId: call.id || body.id,
      body,
    });
    let callSummary = null;
    if (isEndOfCallReport(body)) {
      const summary = structuredSummary(message);
      if (summary) {
        callSummary = await event({
          type: "outreach.call_completed",
          actor: "vapi.local_growth_clean",
          status: "ok",
          payload: {
            prospect_id: call.metadata?.prospect_id || call.metadata?.prospectId || "",
            call_id: call.id || body.id || "",
            summary,
          },
        });
      }
    }
    sendJson(res, 200, {
      ok: true,
      verification,
      stored,
      callSummary,
    });
  } catch (error) {
    handleError(res, error);
  }
};
