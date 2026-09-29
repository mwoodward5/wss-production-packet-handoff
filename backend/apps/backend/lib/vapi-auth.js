"use strict";

// lib/vapi-auth.js — THE ONE shared secret check for the Vapi voice tools.
//
// WHY THIS FILE EXISTS. Every tool in api/vapi-tools/ carried its own copy of
// the same timing-safe check, and each copy listed its own accepted header
// names. That is exactly how the production incident this proxy answers got
// made: five of seventeen calls on one live call had lookup answer OK while
// site-edit-status returned 401 — the assistant's per-tool secret headers had
// drifted against the per-route copies, and nothing could see the drift until
// a customer was on the line. A security check with several copies drifts,
// and the copy that drifts is the one nobody is watching.
//
// From now on the routes and the one proxy door (api/vapi-tools/riley.js) call
// THIS function. One secret family, one accepted-header set, one place to
// change on rotation.
//
//   Secrets (any one matches): VAPI_WEBHOOK_SECRET, VAPI_TOOL_SECRET,
//   GHOST_AGENCY_ADMIN_TOKEN — the same family every route accepted.
//   Headers (first present wins): x-vapi-secret, x-admin-token, Authorization:
//   Bearer — the union every route accepted (lookup-prospect and send-note
//   already took Bearer; nothing accepted fewer than this set).
//
// No secret configured => nobody is authorized. Fails closed, exactly like
// every route did: an unauthenticated voice-tool endpoint on a public URL is
// not a configuration gap, it is an open door.

const { timingSafeEqual } = require("node:crypto");

/** The one secret family, trimmed and de-duplicated, in priority order. */
function vapiSecrets(env = process.env) {
  const seen = new Set();
  for (const raw of [env.VAPI_WEBHOOK_SECRET, env.VAPI_TOOL_SECRET, env.GHOST_AGENCY_ADMIN_TOKEN]) {
    const s = String(raw || "").trim();
    if (s) seen.add(s);
  }
  return [...seen];
}

/** The credential the caller presented, from whichever header they used. */
function presentedSecret(req) {
  return String(
    req.headers["x-vapi-secret"]
      || req.headers["x-admin-token"]
      || req.headers.authorization?.replace(/^Bearer\s+/i, "")
      || "",
  ).trim();
}

/** Timing-safe compare of the presented header against the secret family. */
function authorized(req, env = process.env) {
  const secrets = vapiSecrets(env);
  const got = presentedSecret(req);
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return g.length === b.length && timingSafeEqual(g, b);
  });
}

module.exports = { vapiSecrets, presentedSecret, authorized };
