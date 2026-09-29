"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { verifyPassword, changePassword, issueSession } = require("../../lib/admin-password");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    const current = await verifyPassword(body.currentPassword);
    if (!current.ok) {
      sendJson(res, 401, { ok: false, error: "current_password_incorrect" });
      return;
    }
    const changed = await changePassword(body.newPassword);
    if (!changed.ok) {
      sendJson(res, changed.reason === "password_update_failed" ? 500 : 400, { ok: false, error: changed.reason });
      return;
    }
    const session = issueSession({ sessionVersion: changed.sessionVersion });
    if (!session) {
      sendJson(res, 503, { ok: false, error: "admin_session_signing_unconfigured" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      sessionVersion: session.sessionVersion,
    });
  } catch (error) {
    handleError(res, error);
  }
};
