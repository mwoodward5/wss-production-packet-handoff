"use strict";

// GET /api/connect/voice-config
//
// This is the one browser-safe bridge into Vapi. It is intentionally narrower
// than the other Connect reads: only a signed tenant token may use it, and the
// tenant must still have a current dashboard-access row. The request can never
// choose a slug. Shared operator credentials are not tenant identity and are
// refused rather than allowed to mint a browser session for an arbitrary site.
//
// Only the public browser key and public assistant identifier are read. Server
// provider credentials are neither read nor imported by this module.

const { resolveConnectScope } = require("../../lib/connect");
const { resolveCustomerSurface } = require("../../lib/customer-site");
const { select } = require("../../lib/store");

const SITE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{8,240}$/;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = [
    "https://connect.wss-labs.com",
    "https://wss-ai.com",
    "https://www.wss-ai.com",
  ];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(JSON.stringify(payload));
}

function publicIdentifier(value) {
  const normalized = String(value || "").trim();
  return PUBLIC_ID_RE.test(normalized) ? normalized : "";
}

function browserVoiceConfig(env = process.env) {
  // Customer voice is an explicit release gate. Never turn it on merely
  // because a general-purpose Riley key happens to exist in the project: that
  // assistant has mutating tools and browser metadata is not a tenant lock.
  if (String(env.VAPI_DASHBOARD_VOICE_ENABLED || "").trim().toLowerCase() !== "true") return null;
  const publicKey = publicIdentifier(env.VAPI_PUBLIC_KEY);
  const assistantId = publicIdentifier(env.VAPI_PUBLIC_ASSISTANT_ID);
  if (!publicKey || !assistantId) return null;
  return Object.freeze({ publicKey, assistantId });
}

function liveRows(result) {
  if (!result || result.ok !== true || result.mode === "dry_run") return null;
  if (result.mode && result.mode !== "live_select") return null;
  return Array.isArray(result.data) ? result.data : null;
}

async function tenantIsCurrent(siteSlug, read = select) {
  const slug = String(siteSlug || "").trim().toLowerCase();
  if (!SITE_SLUG_RE.test(slug)) return { ok: false, reason: "not_found" };

  const result = await read(
    "ghost_agency_dashboard_access",
    `select=site_slug,job_id,business_name&site_slug=eq.${encodeURIComponent(slug)}&limit=5`,
  );
  const rows = liveRows(result);
  if (!rows) return { ok: false, reason: "unavailable" };

  const owned = rows.some((row) => String(row && row.site_slug || "").trim().toLowerCase() === slug);
  return { ok: owned, reason: owned ? "" : "not_found" };
}

function boundedMetadataValue(value) {
  const normalized = String(value || "").trim();
  return normalized && normalized.length <= 240 ? normalized : "";
}

async function tenantMetadata(
  siteSlug,
  read = select,
  resolveSurface = resolveCustomerSurface,
) {
  const slug = String(siteSlug || "").trim().toLowerCase();
  const current = await tenantIsCurrent(slug, read);
  if (!current.ok) return current;

  let surface;
  try {
    surface = await resolveSurface({
      siteSlug: slug,
      select: read,
      // Voice config needs identity, not a visibility-report refresh. Avoid an
      // unrelated external fetch on the browser-call critical path.
      fetchReport: async () => ({ ok: false, facts: null, reason: "not_requested" }),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (surface?.site?.reason === "lookup_failed") {
    return { ok: false, reason: "unavailable" };
  }

  const clientId = boundedMetadataValue(surface?.clientId);
  const businessName = boundedMetadataValue(surface?.businessName);
  if (surface?.site?.available !== true || !clientId || !businessName) {
    return { ok: false, reason: "metadata_incomplete" };
  }

  return {
    ok: true,
    metadata: Object.freeze({
      site_slug: slug,
      client_id: clientId,
      business_name: businessName,
    }),
  };
}

module.exports = async function handler(req, res) {
  // No response from this route, including errors, may be cached by a browser,
  // proxy, or service worker.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (cors(req, res)) return;
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  }

  const scope = resolveConnectScope(req);
  if (!scope) return sendJson(res, 401, { ok: false, error: "unauthorized" });
  if (scope.mode !== "tenant") {
    return sendJson(res, 403, { ok: false, error: "tenant_scope_required" });
  }

  let tenant;
  try {
    tenant = await tenantMetadata(scope.siteSlug);
  } catch {
    tenant = { ok: false, reason: "unavailable" };
  }
  if (!tenant.ok) {
    const unavailable = tenant.reason === "unavailable";
    const incomplete = tenant.reason === "metadata_incomplete";
    return sendJson(res, (unavailable || incomplete) ? 503 : 404, {
      ok: false,
      error: unavailable
        ? "tenant_validation_unavailable"
        : (incomplete ? "tenant_metadata_unavailable" : "site_not_found"),
    });
  }

  const config = browserVoiceConfig();
  if (!config) {
    return sendJson(res, 503, { ok: false, error: "voice_not_configured" });
  }

  // Exact browser contract: two public Vapi identifiers plus the three
  // tenant identity for the dedicated browser assistant. The objects are frozen so downstream
  // code cannot append accidental fields before serialization.
  return sendJson(res, 200, Object.freeze({
    ...config,
    metadata: tenant.metadata,
  }));
};

module.exports._test = Object.freeze({
  browserVoiceConfig,
  boundedMetadataValue,
  liveRows,
  publicIdentifier,
  tenantIsCurrent,
  tenantMetadata,
});
