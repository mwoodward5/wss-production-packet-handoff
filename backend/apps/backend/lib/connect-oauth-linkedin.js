"use strict";
// lib/connect-oauth-linkedin.js — real OAuth token exchange for WSS Connect's
// LinkedIn connector. Ported from the proven Ad Alchemy `linkedin-oauth`
// Supabase function (ad-alchemy-studio-43/supabase/functions/linkedin-oauth),
// adapted from Deno/Supabase-Auth to this Vercel/Node backend's own
// connectAuthorized gate and `connect_connectors` table (site-scoped, not
// per-Supabase-user) — same shape as lib/connect-oauth.js (Meta).
//
// Flow:
//   1. GET  /api/connect/linkedin/start?site=<slug>
//      -> mints a random CSRF state, stores it server-side against the site,
//         302s the browser straight into LinkedIn's consent dialog.
//   2. LinkedIn redirects back to /api/connect/linkedin/callback?code=...&state=...
//      -> verifies state, exchanges code for an access token, fetches the
//         member's profile via /v2/userinfo, and stores it in
//         `connect_connectors`.
//      -> redirects the browser back to the WSS Connect app with
//         #connected=linkedin so the UI can show the green checkmark.
//
// Caveat (same limitation as the source Ad Alchemy connector): LinkedIn's
// public API does not grant third-party apps read/send access to a member's
// personal messages. This scope (`w_member_social`) authenticates the member
// and allows posting on their behalf — it does not pull LinkedIn DMs into the
// inbox. That would require LinkedIn's invite-only Marketing/Messaging
// partner APIs. Treat this connector as "LinkedIn account connected for
// posting/identity", not full DM sync, until/unless that partner access is
// granted.
//
// Tokens are NEVER returned to the browser — only a redirect with a platform
// name in the hash.

const { randomBytes } = require("node:crypto");
const { select, insertRow, upsertRow } = require("./store");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LINKEDIN_SCOPE = "openid profile email w_member_social";

function getLinkedInClientId() {
  return process.env.LINKEDIN_CLIENT_ID || "";
}
function getLinkedInClientSecret() {
  return process.env.LINKEDIN_CLIENT_SECRET || "";
}

function randomState() {
  return randomBytes(32).toString("hex");
}

async function saveState({ state, platform, siteSlug, redirectUri }) {
  const res = await insertRow("connect_oauth_states", {
    state,
    platform,
    site_slug: siteSlug,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (res?.mode !== "live_write" && res?.mode !== "dry_run") {
    throw new Error(`state insert failed: ${JSON.stringify(res).slice(0, 200)}`);
  }
}

async function consumeState(state) {
  const found = await select("connect_oauth_states", `state=eq.${encodeURIComponent(state)}&limit=1`);
  const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  try {
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/connect_oauth_states?state=eq.${encodeURIComponent(state)}`,
      {
        method: "DELETE",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
  } catch {
    /* non-fatal */
  }
  return row;
}

function buildLinkedInAuthUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getLinkedInClientId(),
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPE,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

async function startLinkedInOAuth({ siteSlug, redirectUri }) {
  if (!getLinkedInClientId()) throw new Error("LINKEDIN_CLIENT_ID not configured");
  const state = randomState();
  await saveState({ state, platform: "linkedin", siteSlug, redirectUri });
  return buildLinkedInAuthUrl({ redirectUri, state });
}

async function exchangeLinkedInCode({ code, redirectUri }) {
  const clientId = getLinkedInClientId();
  const clientSecret = getLinkedInClientSecret();
  if (!clientSecret) {
    const err = new Error("LINKEDIN_CLIENT_SECRET not configured");
    err.setupRequired = true;
    throw err;
  }

  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) {
    throw new Error(tokenData?.error_description || tokenData?.error || "LinkedIn token exchange failed");
  }

  return {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in || 5184000,
  };
}

async function fetchLinkedInIdentity(accessToken) {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await res.json();
  if (!res.ok || profile.error) throw new Error(profile?.error_description || profile?.error || "LinkedIn profile fetch failed");
  return profile;
}

async function saveConnector({ siteSlug, accessToken, expiresIn, identity }) {
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const displayName = identity.name || [identity.given_name, identity.family_name].filter(Boolean).join(" ") || "LinkedIn member";
  const row = {
    site_slug: siteSlug,
    platform: "linkedin",
    is_active: true,
    connected_at: new Date().toISOString(),
    token_expires_at: expiresAt,
    account_name: displayName,
    platform_user_id: identity.sub,
    metadata: {
      email: identity.email || null,
      picture: identity.picture || null,
      note: "LinkedIn's public API does not expose personal DMs to third-party apps; this connection authenticates the account for posting/identity only.",
    },
    access_token: accessToken,
  };
  const res = await upsertRow("connect_connectors", row, "site_slug,platform");
  // upsertRow's success mode is "live_upsert" (insertRow's is "live_write").
  if (res?.mode !== "live_upsert" && res?.mode !== "dry_run") {
    throw new Error(`connector upsert failed: ${JSON.stringify(res).slice(0, 200)}`);
  }
  return res;
}

async function completeLinkedInOAuth({ code, state, redirectUri }) {
  const stateRow = await consumeState(state);
  if (!stateRow) return { ok: false, error: "This connection link expired or was already used. Please try connecting again." };

  const { accessToken, expiresIn } = await exchangeLinkedInCode({ code, redirectUri });
  const identity = await fetchLinkedInIdentity(accessToken);

  await saveConnector({ siteSlug: stateRow.site_slug, accessToken, expiresIn, identity });

  return { ok: true, platform: "linkedin", accountName: identity.name || identity.email || "LinkedIn account" };
}

module.exports = {
  startLinkedInOAuth,
  completeLinkedInOAuth,
};
