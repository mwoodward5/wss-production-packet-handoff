const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { createVapiCall } = require("../../lib/vapi");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  // Security (2026-07-11): this endpoint could place calls unauthenticated.
  // Outbound dialing is operator-only; consent gating still applies below.
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req);
    const call = await createVapiCall(body);
    sendJson(res, call.mode === "call_failed" ? 502 : 200, {
      ok: call.mode !== "call_failed",
      call,
    });
  } catch (error) {
    handleError(res, error);
  }
};
