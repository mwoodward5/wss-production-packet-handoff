"use strict";

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function transactionalFrom() {
  return firstEnv("GHOST_AGENCY_RESEND_FROM", "RESEND_FROM_EMAIL", "RESEND_FROM");
}

function outreachFrom() {
  return firstEnv("GHOST_AGENCY_OUTREACH_FROM");
}

function emailFrom(kind = "transactional") {
  return kind === "outreach" ? outreachFrom() : transactionalFrom();
}

function extractEmailDomain(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/<([^>]+)>/) || raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const email = match ? (match[1] || match[0]) : raw;
  const domain = String(email || "").split("@").pop();
  return domain ? domain.replace(/[>\s]/g, "").toLowerCase() : "";
}

function outreachFromStatus() {
  const from = outreachFrom();
  const domain = extractEmailDomain(from);
  if (!from) {
    return {
      ok: false,
      reason: "GHOST_AGENCY_OUTREACH_FROM missing",
      expectedDomain: "go.wss-ai.com",
    };
  }
  if (!domain) {
    return {
      ok: false,
      from,
      reason: "GHOST_AGENCY_OUTREACH_FROM is not a valid sender address",
      expectedDomain: "go.wss-ai.com",
    };
  }
  if (domain !== "go.wss-ai.com") {
    return {
      ok: false,
      from,
      domain,
      reason: "Cold outreach sender must be on go.wss-ai.com, never wss-ai.com",
      expectedDomain: "go.wss-ai.com",
    };
  }
  return { ok: true, from, domain };
}

function publicAppUrl() {
  return firstEnv("PUBLIC_APP_URL", "GHOST_AGENCY_PUBLIC_APP_URL") || "https://woodward-ghost-agency-vercel.vercel.app";
}

function apiUrl() {
  // Branded canonical host. The raw ghost-agency-backend.vercel.app deployment
  // still serves these routes, but customer-facing links (report/reveal/checkout/
  // unsubscribe/pixel) should carry the branded domain. GHOST_AGENCY_API_URL wins
  // when set; this fallback keeps links branded even if the env var is missing.
  return firstEnv("GHOST_AGENCY_API_URL", "API_URL") || "https://ghost.wss-ai.com";
}

module.exports = {
  apiUrl,
  emailFrom,
  extractEmailDomain,
  firstEnv,
  outreachFrom,
  outreachFromStatus,
  publicAppUrl,
  transactionalFrom,
};
