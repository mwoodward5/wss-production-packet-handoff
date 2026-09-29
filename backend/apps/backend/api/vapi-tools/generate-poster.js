/**
 * api/vapi-tools/generate-poster.js — Riley tool: generate_poster.
 * "Make me a poster for my AC tune-up special" → Z.ai GLM slide agent
 * (lib/zai-agents.js) → image URLs spoken/emailed/ledgered.
 * Transport shell only; the tool itself lives in lib/riley-poster-core.js so
 * the ONE proxy door (api/vapi-tools/riley.js) dispatches the same function.
 * Auth: VAPI server secret family (same check every tool route uses).
 */
"use strict";

const { timingSafeEqual } = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { posterCore } = require("../../lib/riley-poster-core");

function authorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim()).filter(Boolean);
  const got = String(req.headers["x-vapi-secret"] || req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => { const b = Buffer.from(s); return g.length === b.length && timingSafeEqual(g, b); });
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
  try {
    const body = await readJson(req).catch(() => ({}));
    const out = await posterCore(body);
    return sendJson(res, out.status, out.payload);
  } catch (e) { handleError(res, e); }
};
