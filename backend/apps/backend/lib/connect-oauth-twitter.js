"use strict";
// lib/connect-oauth-twitter.js — real OAuth token exchange for WSS Connect's
// X (Twitter) connector. Ported from the proven Ad Alchemy `twitter-oauth`
// Supabase function (ad-alchemy-studio-43/supabase/functions/twitter-oauth),
// adapted from Deno/Supabase-Auth + client-driven PKCE to this Vercel/Node
// backend's own connectAuthorized gate and `connect_connectors` table.
//
// X's OAuth 2.0 requires PKCE. The original Ad Alchemy function expected the
// browser to generate the code_verifier/code_challenge pair and pass it in;
// this backend's connect flow is a plain server-side redirect (no client JS
// driving the dance, same as the Meta connector), so the verifier is
// generated here and stored server-side alongside the CSRF state in
// `connect_oauth_states.code_verifier`, then reused at the callback.
//
// Flow:
//   1. GET  /api/connect/twitter/start?site=<slug>
//      -> mints state + PKCE pair, stores both server-side, 302s into X's
//         real consent dialog.
//   2. X redirects back to /api/connect/twitter/callback?code=...&state=...
//      -> verifies state, exchanges code (+ stored verifier) for a token,
//         fetches the account via /2/users/me, stores it in
//         `connect_connectors`.
//      -> redirects back to the WSS Connect app with #connected=x.
//
// Tokens are NEVER returned to the browser.
//
// Caveat: the `dm.read` scope requested below only functions on X's paid API
// tiers (the free tier does not include Direct Message endpoints as of this
// writing). Until the X developer account is on a paid tier, this connector
// will authenticate the account and store the token (so "Connected" shows
// correctly) but message sync will fail with a 403 from X, not a bug in this
// code.

const { randomBytes, createHash } = require("node:crypto");
const { select, insertRow, upsertRow } = require("./store");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TWITTER_SCOPE = "tweet.read tweet.write users.read dm.read offline.access";

function getTwitterClientId() {
  return process.env.TWITTER_CLIENT_ID || process.env.X_CLIENT_ID || "";
}
function getTwitterClientSecret() {
  return process.env.TWITTER_CLIENT_SECRET || process.env.X_CLIENT_SECRET || "";
}

function randomState() {
  return randomBytes(32).toString("hex");
}

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkcePair() {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

async function saveState({ state, platform, siteSlug, redirectUri, codeVerifier }) {
  const res = await insertRow("connect_oauth_states", {
    state,
    platform,
    site_slug: siteSlug,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
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

function buildTwitterAuthUrl({ redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getTwitterClientId(),
    redirect_uri: redirectUri,
    scope: TWITTER_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

async function startTwitterOAuth({ siteSlug, redirectUri }) {
  if (!getTwitterClientId()) throw new Error("TWITTER_CLIENT_ID not configured");
  const state = randomState();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  await saveState({ state, platform: "twitter", siteSlug, redirectUri, codeVerifier });
  return buildTwitterAuthUrl({ redirectUri, state, codeChallenge });
}

async function exchangeTwitterCode({ code, redirectUri, codeVerifier }) {
  const clientId = getTwitterClientId();
  const clientSecret = getTwitterClientSecret();
  if (!clientSecret) {
    const err = new Error("TWITTER_CLIENT_SECRET not configured");
    err.setupRequired = true;
    throw err;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) {
    throw new Error(tokenData?.error_description || tokenData?.error || "X token exchange failed");
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    expiresIn: tokenData.expires_in || null,
  };
}

async function fetchTwitterIdentity(accessToken) {
  const res = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(data?.errors?.[0]?.message || data?.title || "X profile fetch failed");
  return data.data || {};
}

async function saveConnector({ siteSlug, accessToken, refreshToken, expiresIn, identity }) {
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const row = {
    site_slug: siteSlug,
    platform: "twitter",
    is_active: true,
    connected_at: new Date().toISOString(),
    token_expires_at: expiresAt,
    account_name: identity.name || (identity.username ? `@${identity.username}` : "X account"),
    platform_user_id: identity.id || null,
    metadata: {
      username: identity.username || null,
      refresh_token: refreshToken,
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

async function completeTwitterOAuth({ code, state, redirectUri }) {
  const stateRow = await consumeState(state);
  if (!stateRow) return { ok: false, error: "This connection link expired or was already used. Please try connecting again." };
  if (!stateRow.code_verifier) return { ok: false, error: "Missing PKCE verifier for this connection attempt. Please try connecting again." };

  const { accessToken, refreshToken, expiresIn } = await exchangeTwitterCode({
    code,
    redirectUri,
    codeVerifier: stateRow.code_verifier,
  });
  const identity = await fetchTwitterIdentity(accessToken);

  await saveConnector({ siteSlug: stateRow.site_slug, accessToken, refreshToken, expiresIn, identity });

  return { ok: true, platform: "twitter", accountName: identity.name || (identity.username ? `@${identity.username}` : "X account") };
}

module.exports = {
  startTwitterOAuth,
  completeTwitterOAuth,
};
