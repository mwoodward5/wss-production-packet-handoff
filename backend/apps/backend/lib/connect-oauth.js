"use strict";
// lib/connect-oauth.js — real OAuth token exchange for WSS Connect platform
// connectors. Ported from the proven Ad Alchemy `facebook-oauth` Supabase
// function (ad-alchemy-studio-43/supabase/functions/facebook-oauth), adapted
// from Deno/Supabase-Auth to this Vercel/Node backend's own connectAuthorized
// gate and `connect_connectors` table (site-scoped, not per-Supabase-user).
//
// Flow (matches the "instant gratification" popup UX):
//   1. GET  /api/connect/meta/start?platform=facebook|instagram&site=<slug>
//      -> mints a random CSRF state, stores it server-side against the site,
//         302s the browser straight into Meta's real consent dialog.
//   2. Meta redirects back to /api/connect/meta/callback?code=...&state=...
//      -> verifies state, exchanges code for a short-lived token, upgrades it
//         to a long-lived (~60 day) token, discovers the user's Facebook Page
//         (and linked Instagram Business account for the instagram platform),
//         and stores everything in `connect_connectors`.
//      -> redirects the browser back to the WSS Connect app with
//         #connected=<platform> so the UI can show the green checkmark.
//
// Tokens are NEVER returned to the browser — only a redirect with a platform
// name in the hash. Same fail-closed instincts as lib/site-editor.js and
// api/launch.js: every branch either succeeds cleanly or degrades to a plain
// error redirect, never a silent false-positive "connected" state.

const { randomBytes, timingSafeEqual } = require("node:crypto");
const { select, insertRow, upsertRow } = require("./store");

const META_GRAPH_VERSION = "v19.0";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getMetaAppId() {
  return process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || "";
}
function getMetaAppSecret() {
  return process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "";
}

function metaScope(platform) {
  return platform === "instagram"
    ? "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,pages_messaging,instagram_manage_messages"
    : "pages_show_list,pages_manage_posts,pages_read_engagement,pages_messaging";
}

function randomState() {
  return randomBytes(32).toString("hex");
}

// --- CSRF state store -------------------------------------------------
// Stored in Supabase (connect_oauth_states) rather than in-memory so it
// survives across serverless cold starts / multiple function instances.
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
  // Best-effort delete so a state can't be replayed; failure here is not fatal.
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

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  return A.length === B.length && A.length > 0 && timingSafeEqual(A, B);
}

function buildMetaAuthUrl({ redirectUri, platform, state }) {
  const appId = getMetaAppId();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: metaScope(platform),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

async function startMetaOAuth({ platform, siteSlug, redirectUri }) {
  if (!getMetaAppId()) throw new Error("META_APP_ID not configured");
  const state = randomState();
  await saveState({ state, platform, siteSlug, redirectUri });
  return buildMetaAuthUrl({ redirectUri, platform, state });
}

async function exchangeMetaCode({ code, redirectUri }) {
  const appId = getMetaAppId();
  const appSecret = getMetaAppSecret();
  if (!appSecret) {
    const err = new Error("META_APP_SECRET not configured");
    err.setupRequired = true;
    throw err;
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const tokenRes = await fetch(tokenUrl.toString());
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) {
    throw new Error(tokenData?.error?.message || "Meta token exchange failed");
  }

  let { access_token: accessToken, expires_in: expiresIn } = tokenData;

  // Upgrade to a long-lived (~60 day) user token.
  try {
    const longLivedUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
    longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
    longLivedUrl.searchParams.set("client_id", appId);
    longLivedUrl.searchParams.set("client_secret", appSecret);
    longLivedUrl.searchParams.set("fb_exchange_token", accessToken);
    const longLivedRes = await fetch(longLivedUrl.toString());
    const longLivedData = await longLivedRes.json();
    if (longLivedRes.ok && longLivedData.access_token) {
      accessToken = longLivedData.access_token;
      expiresIn = longLivedData.expires_in || 5184000;
    }
  } catch {
    /* fall back to short-lived token */
  }

  return { accessToken, expiresIn };
}

async function fetchMetaIdentity(accessToken) {
  const profileUrl = new URL("https://graph.facebook.com/me");
  profileUrl.searchParams.set("fields", "id,name,email");
  profileUrl.searchParams.set("access_token", accessToken);

  const pagesUrl =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts` +
    `?fields=id,name,access_token,instagram_business_account{id,username}` +
    `&access_token=${encodeURIComponent(accessToken)}`;

  const [profileRes, pagesRes] = await Promise.all([fetch(profileUrl.toString()), fetch(pagesUrl)]);
  const profile = await profileRes.json();
  const pagesData = await pagesRes.json();
  if (!profileRes.ok || profile.error) throw new Error(profile?.error?.message || "Meta profile fetch failed");

  const pages = Array.isArray(pagesData?.data) ? pagesData.data : [];
  return { profile, pages };
}

async function saveConnector({ siteSlug, platform, accessToken, expiresIn, identity }) {
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const row = {
    site_slug: siteSlug,
    platform,
    is_active: true,
    connected_at: new Date().toISOString(),
    token_expires_at: expiresAt,
    account_name: identity.accountName,
    platform_user_id: identity.platformUserId,
    metadata: identity.metadata,
    // Page/user access token — never sent to the browser, only used server-side.
    access_token: identity.pageAccessToken || accessToken,
  };
  const res = await upsertRow("connect_connectors", row, "site_slug,platform");
  // upsertRow's success mode is "live_upsert" (insertRow's is "live_write") --
  // checking for "live_write" here was a copy-paste bug that made this throw
  // on every successful save. Fixed 2026-07-18.
  if (res?.mode !== "live_upsert" && res?.mode !== "dry_run") {
    throw new Error(`connector upsert failed: ${JSON.stringify(res).slice(0, 200)}`);
  }
  return res;
}

/**
 * Full callback handler logic (platform-agnostic entry, Meta-specific body).
 * Returns { ok, platform, accountName, error, setupRequired }.
 */
async function completeMetaOAuth({ code, state, redirectUri }) {
  const stateRow = await consumeState(state);
  if (!stateRow) return { ok: false, error: "This connection link expired or was already used. Please try connecting again." };

  const platform = stateRow.platform === "instagram" ? "instagram" : "facebook";
  const { accessToken, expiresIn } = await exchangeMetaCode({ code, redirectUri });
  const { profile, pages } = await fetchMetaIdentity(accessToken);

  const pageWithInstagram = pages.find((p) => p.instagram_business_account?.id);
  const selectedPage = platform === "instagram" ? pageWithInstagram : pages[0];
  const selectedInstagram = selectedPage?.instagram_business_account || null;

  if (platform === "instagram" && !selectedInstagram?.id) {
    return { ok: false, error: "No Instagram Business account found. Connect Instagram to a Facebook Page first, then try again." };
  }
  if (platform === "facebook" && !selectedPage?.id) {
    return { ok: false, error: "No Facebook Page found for this account. WSS Connect publishes and messages through Facebook Pages — connect a Page and grant posting permissions." };
  }

  const accountName = platform === "instagram" ? selectedInstagram?.username || selectedPage?.name : selectedPage?.name || profile.name;

  await saveConnector({
    siteSlug: stateRow.site_slug,
    platform,
    accessToken,
    expiresIn,
    identity: {
      accountName,
      platformUserId: platform === "instagram" ? selectedInstagram.id : selectedPage?.id || profile.id,
      pageAccessToken: selectedPage?.access_token || null,
      metadata: {
        metaUserId: profile.id,
        metaUserName: profile.name,
        pageId: selectedPage?.id || null,
        pageName: selectedPage?.name || null,
        instagramBusinessAccountId: selectedInstagram?.id || null,
        instagramUsername: selectedInstagram?.username || null,
      },
    },
  });

  return { ok: true, platform, accountName };
}

module.exports = {
  safeEqual,
  startMetaOAuth,
  completeMetaOAuth,
};
