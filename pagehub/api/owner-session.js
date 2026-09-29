"use strict";

const {
  clearOwnerSessionCookie,
  hasValidOwnerSession,
  ownerSessionCookie,
  secureTokenEqual,
  OWNER_SESSION_TTL_SECONDS,
} = require("./lib/provider-route-auth");

module.exports = async function ownerSessionHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      authenticated: hasValidOwnerSession(req),
    });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearOwnerSessionCookie());
    return res.status(200).json({ ok: true, authenticated: false });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    return res.status(405).json({ ok: false, error: "Use GET, POST, or DELETE." });
  }

  const expectedToken = String(process.env.PAGEHUB_OWNER_TOKEN || "").trim();
  if (!expectedToken) {
    return res.status(503).json({ ok: false, error: "PageHub owner login is not configured." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return res.status(400).json({ ok: false, error: "Request body must be valid JSON." });
  }

  const suppliedToken = typeof body?.token === "string" && body.token.length <= 4096
    ? body.token.trim()
    : "";
  if (!secureTokenEqual(suppliedToken, expectedToken)) {
    return res.status(401).json({ ok: false, error: "Unauthorized." });
  }

  res.setHeader("Set-Cookie", ownerSessionCookie(expectedToken));
  return res.status(200).json({
    ok: true,
    authenticated: true,
    expires_in_seconds: OWNER_SESSION_TTL_SECONDS,
  });
};
