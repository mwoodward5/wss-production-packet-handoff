/**
 * api/vapi-tools/brand-assets.js — Riley tool: generate logo variations + email them.
 * "Make me 3 logos like mine and email them over" → Gemini image gen → Resend email.
 * Auth: VAPI server secret or admin token.
 */
"use strict";

const { timingSafeEqual } = require("node:crypto");
const { select } = require("../../lib/store");
const { sendResendEmail } = require("../../lib/email");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

function authorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim()).filter(Boolean);
  const got = String(req.headers["x-vapi-secret"] || req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => { const b = Buffer.from(s); return g.length === b.length && timingSafeEqual(g, b); });
}

async function generateLogoVariations({ businessName, vertical, primaryColor, count = 3 }) {
  const key = process.env.GEMINI_API_KEY || "";
  if (!key) return { ok: false, error: "gemini_key_missing" };
  const prompt = `Professional logo for '${businessName}', a ${vertical} company. Design: iconic mark, flat vector style, brand colors ${primaryColor || "dark blue"} and white on white background. No text, no letters — just the iconic mark.`;
  const variations = [];
  for (let i = 0; i < count; i++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      const d = await r.json();
      const img = d?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (img) variations.push(img);
    } catch { /* one variation failed */ }
  }
  return variations.length ? { ok: true, variations } : { ok: false, error: "generation_failed" };
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
    const email = String(args.email || "").trim();
    const businessName = String(args.business_name || "").trim();
    const vertical = String(args.vertical || "local business").trim();
    const primaryColor = String(args.primary_color || "").trim();
    const count = Math.min(5, Math.max(1, Number(args.count) || 3));

    // resolve the prospect for brand context
    let prospect = {};
    if (clientId) {
      const found = await select("ghost_agency_prospects", `?select=*&record->>reference=eq.${encodeURIComponent(clientId)}&limit=1`).catch(() => []);
      const rows = found?.ok && Array.isArray(found.data) ? found.data : (Array.isArray(found) ? found : []);
      if (rows.length) prospect = rows[0];
    }
    const name = businessName || prospect.business_name || "Your Business";
    const color = primaryColor || (prospect.record && prospect.record.brand_color) || "";

    const result = await generateLogoVariations({ businessName: name, vertical, primaryColor: color, count });
    if (!result.ok) return sendJson(res, 200, { ok: false, error: result.error });

    // email the variations
    const to = email || (prospect.record && prospect.record.email) || prospect.email;
    if (to) {
      const imgs = result.variations.map((b64, i) => `<img src="data:image/png;base64,${b64}" width="200" alt="Logo variation ${i + 1}" style="margin:8px;border:1px solid #ddd">`).join("<br>");
      await sendResendEmail({
        to,
        subject: `Your ${name} logo variations`,
        html: `<p>Here are ${result.variations.length} logo variations for ${name}:</p>${imgs}<p>Reply to this email or call (949) 298-5562 to pick one.</p>`,
      });
    }

    return sendJson(res, 200, {
      ok: true,
      variations: result.variations.length,
      emailed: Boolean(to),
      message: `Generated ${result.variations.length} logo variations for ${name}${to ? ` and emailed them to ${to}` : ""}.`,
    });
  } catch (e) { handleError(res, e); }
};
