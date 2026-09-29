"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { sendablePreflight } = require("../../lib/sendable-preflight");

// Read-only reality check for the console: "N requested" versus how many of
// those N would actually clear every send gate right now. Defaults to the
// current supervised_10_review_pending held batch; pass prospectIds or a
// category/location to preview a different candidate set (e.g. before
// kicking off a full-run). Never stages, approves, or sends anything.
module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = req.method === "POST" ? await readJson(req).catch(() => ({})) : {};
    const query = req.query || {};
    const prospectIds = Array.isArray(body.prospectIds)
      ? body.prospectIds
      : typeof query.prospectIds === "string" && query.prospectIds.trim()
        ? query.prospectIds.split(",").map((id) => id.trim()).filter(Boolean)
        : undefined;
    const input = {
      prospectIds,
      category: body.category || query.category,
      location: body.location || query.location,
      limit: body.limit || query.limit,
    };
    const result = await sendablePreflight(input);
    sendJson(res, result.ok ? 200 : 422, result);
  } catch (error) {
    handleError(res, error);
  }
};
