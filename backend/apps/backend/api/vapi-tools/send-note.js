"use strict";

/**
 * api/vapi-tools/send-note.js — Riley's ONE outbound-email capability.
 *
 * The tool itself lives in lib/riley-send-note-core.js (the allowlist, the
 * leak scan, the rate limit and the answer) so the ONE proxy door
 * (api/vapi-tools/riley.js) can dispatch to it as a library function — one
 * authentication for every tool, instead of one secret header per route to
 * drift out from under a live call. This route keeps only the transport shell
 * and answers exactly as before; every security property the core enforces is
 * documented there, at the code that enforces it.
 */

const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { authorized } = require("../../lib/vapi-auth");
const core = require("../../lib/riley-send-note-core");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

  try {
    const body = await readJson(req).catch(() => ({}));
    const out = await core.sendNoteCore(body);
    return sendJson(res, out.status, out.payload);
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.ALLOWED_RECIPIENTS = core.ALLOWED_RECIPIENTS;
module.exports.MAX_SENDS_PER_HOUR = core.MAX_SENDS_PER_HOUR;
module.exports.MAX_BODY_CHARS = core.MAX_BODY_CHARS;
module.exports.normalizeSpokenEmail = core.normalizeSpokenEmail;
module.exports.recipientAllowed = core.recipientAllowed;
module.exports.secretShapedContent = core.secretShapedContent;
module.exports.rateLimitState = core.rateLimitState;
