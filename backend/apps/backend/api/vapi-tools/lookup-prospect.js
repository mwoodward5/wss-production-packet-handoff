"use strict";

// VAPI tool endpoint: agents call this MID-CALL to pull the caller's real record
// by Client ID, phone, business name or email — so Riley says "4.9 stars across
// 33 reviews", never "solid reviews". When NOTHING matches, the response asks
// for the one strongest key the caller has not given yet (see resolveCaller's
// unmatched ladder) instead of dead-ending the call. Auth: VAPI server secret
// (or admin token for testing).
//
// The resolution logic now lives in lib/riley-lookup-core.js so the ONE proxy
// door (api/vapi-tools/riley.js) can dispatch to it as a library function —
// one authentication for every tool, instead of one secret header per route to
// drift out from under a live call. This route keeps only the transport shell
// and answers exactly as before.

const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { authorized } = require("../../lib/vapi-auth");
const { lookupProspectCore } = require("../../lib/riley-lookup-core");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    const body = await readJson(req).catch(() => ({}));
    const out = await lookupProspectCore(body);
    return sendJson(res, out.status, out.payload);
  } catch (error) {
    handleError(res, error);
  }
};
