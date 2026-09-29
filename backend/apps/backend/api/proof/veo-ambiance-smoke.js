"use strict";

// Live smoke for the Veo ambiance hero: generates one short Veo clip, hosts it in
// Supabase, and returns the public URL — so we can confirm the whole
// generate -> host chain works in production before flipping the build flag on.
// Admin-gated + confirmation-gated because a Veo call costs money.

const { requireAdminOrHardeningProof } = require("../../lib/proof-auth");
const { methodGuard, readJson, sendJson } = require("../../lib/http");
const { generateAmbianceAsset, veoAmbianceEnabled } = require("../../lib/veo-ambiance");

function credState() {
  const has = (v) => Boolean(String(process.env[v] || "").trim());
  return {
    veo_flag_on: veoAmbianceEnabled(),
    gemini_key: has("GEMINI_API_KEY") || has("GOOGLE_API_KEY"),
    supabase_own: has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY"),
    supabase_callprep: has("CALLPREP_SUPABASE_URL") && has("CALLPREP_SUPABASE_SERVICE_ROLE_KEY"),
    bucket: process.env.GHOST_AGENCY_AMBIANCE_BUCKET || "wss-proof-assets",
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdminOrHardeningProof(req, res)) return;
  const creds = credState();
  // GET is a dry status probe — never spends money.
  if (req.method === "GET") {
    sendJson(res, 200, { ok: true, mode: "status", creds });
    return;
  }
  const body = await readJson(req).catch(() => ({}));
  if (body.confirm !== "GENERATE_VEO_PROOF") {
    sendJson(res, 400, { ok: false, error: "confirmation_required", hint: "POST {confirm:'GENERATE_VEO_PROOF'}", creds });
    return;
  }
  const vertical = (typeof body.vertical === "string" && body.vertical.trim()) || "auto detailing";
  const slug = (typeof body.slug === "string" && body.slug.trim()) || "veo-smoke";
  const started = Date.now();
  try {
    // Real generation. Bounded poll so it fits the function budget.
    const asset = await generateAmbianceAsset({ vertical, slug, maxPolls: 24, pollIntervalMs: 7000 });
    const elapsedMs = Date.now() - started;
    if (!asset) {
      sendJson(res, 200, { ok: false, generated: false, reason: "generateAmbianceAsset returned null (no key, host failure, or timeout)", elapsedMs, creds });
      return;
    }
    sendJson(res, 200, { ok: true, generated: true, elapsedMs, asset, creds });
  } catch (err) {
    sendJson(res, 200, { ok: false, generated: false, error: String((err && err.message) || err).slice(0, 300), creds });
  }
};
