"use strict";

// Signed 1x1 tracking pixel for external report surfaces (CallPrep embeds this).
// GET /api/px?t=<base64url {p: prospectId, exp}>&s=<hmac> -> transparent gif +
// fires the max-momentum hot-view trigger. Same secret family as report links.

const { createHmac, timingSafeEqual } = require("node:crypto");
const { onReportViewed } = require("../lib/hot-view");

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function secret() {
  return String(process.env.GHOST_AGENCY_REPORT_LINK_SECRET || process.env.GHOST_AGENCY_CHECKOUT_LINK_SECRET || "").trim();
}
function sign(t) { return createHmac("sha256", secret()).update(`px:${t}`).digest("base64url"); }

function buildPixelUrl(prospectId, base) {
  if (!secret()) return "";
  const t = Buffer.from(JSON.stringify({ p: String(prospectId).slice(0, 160), exp: Date.now() + 7 * 86400e3 }), "utf8").toString("base64url");
  return `${String(base || "https://ghost.wss-ai.com").replace(/\/+$/, "")}/api/px?t=${encodeURIComponent(t)}&s=${encodeURIComponent(sign(t))}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  try {
    const { t, s } = req.query || {};
    if (secret() && t && s) {
      const expected = Buffer.from(sign(String(t)));
      const actual = Buffer.from(String(s));
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        const payload = JSON.parse(Buffer.from(String(t), "base64url").toString("utf8"));
        if (Number(payload.exp) > Date.now() && payload.p) {
          // fire-and-forget; never delay the pixel
          onReportViewed({ prospectId: payload.p, source: "pixel" }).catch(() => {});
          // stamp the email log: opened_at on first open, report_viewed_at always
          try {
            const supaUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
            const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
            if (supaUrl && supaKey) {
              const now = new Date().toISOString();
              const patchBody = { report_viewed_at: now };
              fetch(`${supaUrl}/rest/v1/ghost_agency_email_log?prospect_id=eq.${encodeURIComponent(payload.p)}&order=sent_at.desc&limit=1`, {
                method: "PATCH",
                headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
                body: JSON.stringify(patchBody),
              }).catch(() => {});
            }
          } catch { /* never block the pixel */ }
        }
      }
    }
  } catch { /* pixel always renders */ }
  res.statusCode = 200;
  res.end(GIF);
};

module.exports.buildPixelUrl = buildPixelUrl;
