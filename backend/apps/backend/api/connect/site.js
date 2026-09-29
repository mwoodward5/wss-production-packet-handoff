"use strict";

// GET /api/connect/site
//
// The two things the customer dashboard could not previously say: WHERE THEIR
// WEBSITE IS, and WHAT THEIR VISIBILITY REPORT SAYS. See lib/customer-site.js
// for why both were absent from a page that already held the data.
//
// AUTH IS THE SAME GATE AS THE REST OF CONNECT, WITH THE SAME ASYMMETRY. A
// per-customer scoped token carries the site slug it was signed for, and that
// slug — not the query string — is what gets resolved; a customer cannot read
// another customer's site by guessing a slug. A full/admin token (the Connect
// app, the operator) has no business bound to it, so it may name one explicitly
// with ?slug=, and when it does not it gets an honest empty surface rather than
// somebody else's.
//
// This endpoint never writes and never sends. It reads tenant-bound site,
// report, edit, lead-adjacent call-event, and retained provider facts only.

const { resolveConnectScope } = require("../../lib/connect");
const { resolveCustomerSurface } = require("../../lib/customer-site");
const { select } = require("../../lib/store");
const { loadCustomerOverview } = require("./_customer-command");
const { loadCustomerCallArtifact, proxyCustomerAudio } = require("./_customer-calls");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

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

function queryValue(value) {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0] || "") : "";
  return value == null ? "" : String(value);
}

function sendError(res, error) {
  const status = Number(error && error.statusCode);
  const statusCode = [401, 404, 405, 413, 503].includes(status) ? status : 503;
  const code = statusCode === 404
    ? String(error && error.code || "call_not_found")
    : String(error && error.code || "customer_source_unavailable");
  res.statusCode = statusCode;
  return res.end(JSON.stringify({ ok: false, error: code }));
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }
  const scope = resolveConnectScope(req);
  if (!scope) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
  }

  // A tenant is pinned to its own slug server-side. A full token may name one.
  const asked = String((req.query && req.query.slug) || "").trim().toLowerCase();
  const siteSlug = scope.mode === "tenant"
    ? String(scope.siteSlug || "")
    : (SLUG_RE.test(asked) ? asked : "");

  try {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const callId = queryValue(req.query && req.query.callId).trim();
    const wantsAudio = queryValue(req.query && req.query.audio).trim() === "1";
    if (callId || wantsAudio) {
      // Customer call artifacts are never available through the broad admin
      // scope. The tenant token must itself name the site before ownership is
      // checked again against the normalized event and the provider call.
      if (scope.mode !== "tenant" || !siteSlug || !callId) {
        const hidden = new Error("Call not found");
        hidden.statusCode = 404;
        hidden.code = "call_not_found";
        throw hidden;
      }
      const artifact = await loadCustomerCallArtifact({ callId, siteSlug, select });
      if (wantsAudio) {
        if (!artifact.response.recordingAvailable) {
          const unavailable = new Error("Recording is not available");
          unavailable.statusCode = 404;
          unavailable.code = "recording_not_available";
          throw unavailable;
        }
        await proxyCustomerAudio({ req, res, callId });
        return;
      }
      return res.end(JSON.stringify(artifact.response));
    }

    const surface = await resolveCustomerSurface({ siteSlug, select });
    if (surface?.site?.reason === "lookup_failed" || surface?.report?.reason === "lookup_failed") {
      const unavailable = new Error("Customer site details are unavailable");
      unavailable.statusCode = 503;
      unavailable.code = "customer_source_unavailable";
      throw unavailable;
    }
    const overview = await loadCustomerOverview({ siteSlug, surface, select });
    return res.end(JSON.stringify({ ok: true, ...surface, overview }));
  } catch (error) {
    if (res.headersSent) {
      if (typeof res.destroy === "function") res.destroy(error);
      return;
    }
    return sendError(res, error);
  }
};
