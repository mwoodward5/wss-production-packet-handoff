"use strict";
// GET /api/connect/visibility?business=<input_value>
// Returns a business's visibility-grade history (score + letter grade over
// time) for the WSS Labs client dashboard's "grade tracking" panel.
//
// Source of truth: the external CallPrep Supabase project's append-only
// `scan_history` table (one row per scored report). This backend holds a
// server-side read credential (CALLPREP_SUPABASE_SERVICE_ROLE_KEY) that is
// NEVER exposed to the browser — the browser only ever sees the reduced
// {date, score, grade} points this endpoint returns.
//
// Auth: same gate as the rest of the WSS Connect API. A full/admin token may
// query any business; a per-customer scoped token may only see the business
// bound to its own login (looked up server-side, never trusted from the query).

const { resolveConnectScope } = require("../../lib/connect");
const { select } = require("../../lib/store");

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = ["https://connect.wss-labs.com", "https://wss-ai.com", "https://www.wss-ai.com"];
  res.setHeader("Access-Control-Allow-Origin", allowed.includes(origin) ? origin : "https://wss-ai.com");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

function callprepRestBase() {
  const raw = String(process.env.CALLPREP_SUPABASE_URL || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "";
    return `${u.origin}/rest/v1`;
  } catch {
    return "";
  }
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, error: "method not allowed" })); }
  const scope = resolveConnectScope(req);
  if (!scope) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: "unauthorized" })); }

  const key = String(process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const base = callprepRestBase();
  if (!key || !base) {
    // Not yet wired — say so honestly rather than pretending there's no history.
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, configured: false, points: [], reason: "CallPrep read credentials not configured." }));
  }

  // A tenant token can only ever read the business bound to its own site_slug —
  // the query param is ignored for tenants so one customer can't read another's
  // grade by guessing a business string. Full/admin tokens may pass any business.
  let business = String(req.query?.business || "").trim().slice(0, 300);
  if (scope.mode === "tenant") {
    try {
      const found = await select("ghost_agency_dashboard_access", `site_slug=eq.${encodeURIComponent(scope.siteSlug)}&limit=1`);
      const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
      business = String(row?.visibility_business || "").trim().slice(0, 300);
    } catch { business = ""; }
  }
  if (!business) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: "business (input_value) required" })); }

  try {
    const url =
      `${base}/scan_history` +
      `?input_value=eq.${encodeURIComponent(business)}` +
      `&select=created_at,overall_score,overall_grade` +
      `&order=created_at.asc&limit=200`;
    const r = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!r.ok) {
      res.statusCode = 502;
      return res.end(JSON.stringify({ ok: false, error: `history read failed (${r.status})` }));
    }
    const rows = await r.json().catch(() => []);
    const points = (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.created_at != null && row.overall_score != null)
      .map((row) => ({
        date: row.created_at,
        score: Number(row.overall_score),
        grade: row.overall_grade || null,
      }))
      .filter((p) => Number.isFinite(p.score));

    const latest = points.length ? points[points.length - 1] : null;
    const first = points.length ? points[0] : null;
    const delta = latest && first ? Math.round((latest.score - first.score) * 10) / 10 : null;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, max-age=120");
    return res.end(JSON.stringify({ ok: true, configured: true, business, points, latest, delta }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
};
