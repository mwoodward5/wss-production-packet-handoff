/**
 * api/vapi-tools/site-rebuild.js — Riley tool: rebuild a prospect's site with a different
 * donor or an added section, via the mirror lane. "Rebuild my site with a different template"
 * or "add a testimonials page." Auth: VAPI server secret or admin token.
 */
"use strict";

const { timingSafeEqual } = require("node:crypto");
const { select } = require("../../lib/store");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

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
  if (!authorized(req)) return sendJson(res, 401, { error: "unauthorized" });
  try {
    const body = await readJson(req).catch(() => ({}));
    const call = body?.message?.toolCalls?.[0];
    const args = call?.function?.arguments
      ? (typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments)
      : body;
    const clientId = String(args.client_id || args.clientId || "").trim();
    const action = String(args.action || "rebuild").trim(); // rebuild | add_section
    const section = String(args.section || "").trim(); // testimonials | gallery | faq | contact

    if (!clientId) return sendJson(res, 400, { ok: false, error: "client_id required" });

    // resolve the prospect
    const found = await select("ghost_agency_prospects", `?select=*&record->>reference=eq.${encodeURIComponent(clientId)}&limit=1`).catch(() => []);
    const rows = found?.ok && Array.isArray(found.data) ? found.data : (Array.isArray(found) ? found : []);
    if (!rows.length) return sendJson(res, 404, { ok: false, error: "prospect_not_found" });
    const prospect = rows[0];

    // invoke the mirror lane's build-preview (same as the dashboard)
    const { buildPreviewForProspect } = require("../../lib/full-run");
    const result = await buildPreviewForProspect(prospect, {
      runId: `riley_${Date.now()}`,
      source: "riley_voice",
      skipAmbiance: true,
      action,
      section,
    });

    return sendJson(res, 200, {
      ok: Boolean(result && result.ok),
      preview_url: result?.preview_url || prospect.preview_url || "",
      message: result?.ok
        ? `Rebuilt ${prospect.business_name}'s site${action === "add_section" ? ` with a new ${section} section` : ""}. Check it at ${result.preview_url || "your preview link"}.`
        : `Rebuild didn't complete: ${result?.blocked || "unknown"}. I'll flag this for the team.`,
    });
  } catch (e) { handleError(res, e); }
};
