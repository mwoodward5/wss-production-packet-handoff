"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { approveHeldDrafts } = require("../../lib/approve-held-drafts");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

// Explicit approve -> send lever for the supervised_10_review_pending held
// draft queue. api/admin/held-drafts.js only ever stages review drafts
// (sendsPerformed is hardcoded 0 there, on purpose). This route is the one
// place a human's "yes, send these" turns into a real sendSequenceStep call
// - and only for the exact prospect ids they approved, only while every
// existing send gate stays intact, and only when dryRun is explicitly set to
// false with the exact confirmation phrase.
module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    const result = await approveHeldDrafts(body);
    sendJson(res, result.ok ? 200 : 422, result);
  } catch (error) {
    handleError(res, error);
  }
};
