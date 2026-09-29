const { handleError, methodGuard, publicRequestUrl, readRawBody, sendJson } = require("../../lib/http");
const { validateTwilioSignature } = require("../../lib/twilio");
const { recordEvent } = require("../../lib/store");

function parseForm(raw) {
  const params = new URLSearchParams(raw || "");
  return Object.fromEntries(params.entries());
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    let params;
    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      params = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [k, String(v)]));
    } else {
      params = parseForm(await readRawBody(req));
    }
    const verification = validateTwilioSignature(
      publicRequestUrl(req),
      params,
      req.headers["x-twilio-signature"],
    );
    const stored = await recordEvent("twilio_status_webhook", {
      verified: verification.verified,
      sid: params.MessageSid || params.SmsSid,
      status: params.MessageStatus || params.SmsStatus,
      params,
    });
    sendJson(res, verification.configured && !verification.verified ? 401 : 200, {
      ok: !verification.configured || verification.verified,
      verification,
      stored,
    });
  } catch (error) {
    handleError(res, error);
  }
};
