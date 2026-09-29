const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { sendTwilioMessage } = require("../../lib/twilio");
const { requireAdmin } = require("../../lib/admin-auth");

module.exports = async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const body = await readJson(req);
    const message = await sendTwilioMessage(body);
    sendJson(res, message.mode === "send_failed" ? 502 : 200, {
      ok: message.mode !== "send_failed",
      message,
    });
  } catch (error) {
    handleError(res, error);
  }
};
