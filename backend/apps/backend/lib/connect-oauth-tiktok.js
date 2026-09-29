"use strict";
// lib/connect-oauth-tiktok.js — real OAuth token exchange for WSS Connect's
// TikTok connector. Ported from the proven Ad Alchemy `tiktok-oauth`
// Supabase function (ad-alchemy-studio-43/supabase/functions/tiktok-oauth),
// adapted from Deno/Supabase-Auth + client-driven PKCE to this Vercel/Node
// backend's own connectAuthorized gate and `connect_connectors` table.
//
// TikTok's Login Kit requires PKCE, same as X. The verifier/challenge pair
// is generated server-side and stored alongside the CSRF state in
// `connect_oauth_states.code_verifier`, then reused at the callback — same
// pattern as connect-oauth-twitter.js.
//
// Flow:
//   1. GET  /api/connect/tiktok/start?site=<slug>
//      -> mints state + PKCE pair, stores both server-side, 302s into
//         TikTok's real consent dialog.
//   2. TikTok redirects back to /api/connect/tiktok/callback?code=...&state=...
//      -> verifies state, exchanges code (+ stored verifier) for a token,
//         fetches the account via /v2/user/info/, stores it in
//         `connect_connectors`.
//      -> redirects back to the WSS Connect app with #connected=tiktok.
//
// Tokens are NEVER returned to the browser.
//
// Known open issue (unrelated to this code): the TikTok developer console's
// "Configure for Web" toggle for the Login Kit redirect URI has a UI bug
// that hasn't been resolved yet (see DEPLOY-INSTRUCTIONS.md history) — the
// redirect_uri below must actually be registered and toggled live in
// TikTok's app settings before /start will produce a working consent screen.
// Also, TikTok requires the domain behind the Terms/Privacy URLs to pass a
// separate "Verify URL properties" step before app review will accept them.

const { randomBytes, createHash } = require("node:crypto");
const { select, insertRow, upsertRow } = require("./store");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const TIKTOK_SCOPE = "user.info.basic,video.publish";

function getTikTokClientKey() {
  return process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID || "";
}
function getTikTokClientSecret() {
  return process.env.TIKTOK_CLIENT_SECRET || "";
}

function randomState() {
  return `tiktok_${randomBytes(24).toString("hex")}`;
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

function buildTikTokAuthUrl({ redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    client_key: getTikTokClientKey(),
    scope: TIKTOK_SCOPE,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

async function startTikTokOAuth({ siteSlug, redirectUri }) {
  if (!getTikTokClientKey()) throw new Error("TIKTOK_CLIENT_KEY not configured");
  const state = randomState();
  const { codeVerifier, codeChallenge } = generatePkcePair();
  await saveState({ state, platform: "tiktok", siteSlug, redirectUri, codeVerifier });
  return buildTikTokAuthUrl({ redirectUri, state, codeChallenge });
}

function tiktokErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  const nested = payload.error && typeof payload.error === "object" ? payload.error : null;
  return payload.error_description || nested?.message || (typeof payload.error === "string" ? payload.error : null) || fallback;
}

async function exchangeTikTokCode({ code, redirectUri, codeVerifier }) {
  const clientKey = getTikTokClientKey();
  const clientSecret = getTikTokClientSecret();
  if (!clientSecret) {
    const err = new Error("TIKTOK_CLIENT_SECRET not configured");
    err.setupRequired = true;
    throw err;
  }

  const tokenRes = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || tokenData.error) {
    throw new Error(tiktokErrorMessage(tokenData, "TikTok token exchange failed"));
  }
  if (!tokenData.access_token) throw new Error("TikTok did not return an access token");

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    openId: tokenData.open_id || null,
    expiresIn: typeof tokenData.expires_in === "number" ? tokenData.expires_in : 86400,
  };
}

async function fetchTikTokIdentity(accessToken) {
  const fields = ["open_id", "union_id", "avatar_url", "display_name"].join(",");
  const res = await fetch(`${TIKTOK_USER_INFO_URL}?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await res.json().catch(() => ({}));
  const errorCode = payload?.error?.code;
  if (!res.ok || (errorCode && errorCode !== "ok")) return null;
  return payload?.data?.user && typeof payload.data.user === "object" ? payload.data.user : null;
}

async function saveConnector({ siteSlug, accessToken, refreshToken, expiresIn, openId, identity }) {
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const resolvedOpenId = identity?.open_id || openId;
  const row = {
    site_slug: siteSlug,
    platform: "tiktok",
    is_active: true,
    connected_at: new Date().toISOString(),
    token_expires_at: expiresAt,
    account_name: identity?.display_name || "TikTok account",
    platform_user_id: resolvedOpenId,
    metadata: {
      union_id: identity?.union_id || null,
      avatar_url: identity?.avatar_url || null,
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

async function completeTikTokOAuth({ code, state, redirectUri }) {
  const stateRow = await consumeState(state);
  if (!stateRow) return { ok: false, error: "This connection link expired or was already used. Please try connecting again." };
  if (!stateRow.code_verifier) return { ok: false, error: "Missing PKCE verifier for this connection attempt. Please try connecting again." };

  const { accessToken, refreshToken, openId, expiresIn } = await exchangeTikTokCode({
    code,
    redirectUri,
    codeVerifier: stateRow.code_verifier,
  });
  const identity = await fetchTikTokIdentity(accessToken);

  await saveConnector({ siteSlug: stateRow.site_slug, accessToken, refreshToken, expiresIn, openId, identity });

  return { ok: true, platform: "tiktok", accountName: identity?.display_name || "TikTok account" };
}

module.exports = {
  startTikTokOAuth,
  completeTikTokOAuth,
};
