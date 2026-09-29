"use strict";

const { select } = require("./store");
const { startMetaOAuth, completeMetaOAuth } = require("./connect-oauth");
const { startLinkedInOAuth, completeLinkedInOAuth } = require("./connect-oauth-linkedin");
const { startTwitterOAuth, completeTwitterOAuth } = require("./connect-oauth-twitter");
const { startTikTokOAuth, completeTikTokOAuth } = require("./connect-oauth-tiktok");

const PROVIDERS = Object.freeze({
  facebook: Object.freeze({ provider: "facebook", storagePlatform: "facebook", channel: "facebook_messenger", oauth: "meta" }),
  messenger: Object.freeze({ provider: "facebook", storagePlatform: "facebook", channel: "facebook_messenger", oauth: "meta" }),
  facebook_messenger: Object.freeze({ provider: "facebook", storagePlatform: "facebook", channel: "facebook_messenger", oauth: "meta" }),
  instagram: Object.freeze({ provider: "instagram", storagePlatform: "instagram", channel: "instagram_dm", oauth: "meta" }),
  instagram_dm: Object.freeze({ provider: "instagram", storagePlatform: "instagram", channel: "instagram_dm", oauth: "meta" }),
  linkedin: Object.freeze({ provider: "linkedin", storagePlatform: "linkedin", channel: "linkedin_dm", oauth: "linkedin" }),
  linkedin_dm: Object.freeze({ provider: "linkedin", storagePlatform: "linkedin", channel: "linkedin_dm", oauth: "linkedin" }),
  twitter: Object.freeze({ provider: "twitter", storagePlatform: "twitter", channel: "x_dm", oauth: "twitter" }),
  x: Object.freeze({ provider: "twitter", storagePlatform: "twitter", channel: "x_dm", oauth: "twitter" }),
  x_dm: Object.freeze({ provider: "twitter", storagePlatform: "twitter", channel: "x_dm", oauth: "twitter" }),
  tiktok: Object.freeze({ provider: "tiktok", storagePlatform: "tiktok", channel: "tiktok_dm", oauth: "tiktok" }),
  tiktok_dm: Object.freeze({ provider: "tiktok", storagePlatform: "tiktok", channel: "tiktok_dm", oauth: "tiktok" }),
});

function normalizePlatform(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 80);
}

function resolveLegacyConnector(value) {
  const requestedPlatform = normalizePlatform(value);
  const definition = PROVIDERS[requestedPlatform];
  return definition ? Object.freeze({ requestedPlatform, ...definition }) : null;
}

function configuredApiOrigin(env = process.env) {
  const raw = String(env.GHOST_AGENCY_API_URL || "https://ghost-agency-backend.vercel.app").trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(raw); } catch { throw Object.assign(new Error("connector_api_url_invalid"), { status: 500, code: "connector_api_url_invalid" }); }
  if (parsed.protocol !== "https:") throw Object.assign(new Error("connector_api_url_invalid"), { status: 500, code: "connector_api_url_invalid" });
  return parsed.origin;
}

function callbackUri(connector, env = process.env) {
  return `${configuredApiOrigin(env)}/api/connect/connectors/${encodeURIComponent(connector.requestedPlatform)}/callback`;
}

function appOrigin(env = process.env) {
  const raw = String(env.CONNECT_APP_URL || "https://connect.wss-labs.com/").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return `${parsed.origin}/`;
  } catch { /* fall back */ }
  return "https://connect.wss-labs.com/";
}

function safeConnectorView(row) {
  if (!row || row.is_active !== true) return { connected: false };
  const accountName = String(row.account_name || "").trim().slice(0, 500);
  return { connected: true, ...(accountName ? { accountName } : {}) };
}

async function readConnector(siteSlug, connector) {
  const result = await select(
    "connect_connectors",
    `select=platform,is_active,account_name&site_slug=eq.${encodeURIComponent(siteSlug)}&platform=eq.${encodeURIComponent(connector.storagePlatform)}&limit=1`,
  );
  if (!result?.ok || !Array.isArray(result.data)) {
    throw Object.assign(new Error("connector_status_read_failed"), { status: 502, code: "connector_status_read_failed" });
  }
  return result.data[0] || null;
}

async function startConnectorOAuth({ connector, siteSlug, redirectUri }) {
  switch (connector.oauth) {
    case "meta": return startMetaOAuth({ platform: connector.provider, siteSlug, redirectUri });
    case "linkedin": return startLinkedInOAuth({ siteSlug, redirectUri });
    case "twitter": return startTwitterOAuth({ siteSlug, redirectUri });
    case "tiktok": return startTikTokOAuth({ siteSlug, redirectUri });
    default: throw Object.assign(new Error("connector_not_implemented"), { status: 501, code: "connector_not_implemented" });
  }
}

async function completeConnectorOAuth({ connector, code, state, redirectUri }) {
  switch (connector.oauth) {
    case "meta": return completeMetaOAuth({ code, state, redirectUri });
    case "linkedin": return completeLinkedInOAuth({ code, state, redirectUri });
    case "twitter": return completeTwitterOAuth({ code, state, redirectUri });
    case "tiktok": return completeTikTokOAuth({ code, state, redirectUri });
    default: throw Object.assign(new Error("connector_not_implemented"), { status: 501, code: "connector_not_implemented" });
  }
}

function storeConfiguration(env = process.env) {
  const base = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  let parsed;
  try { parsed = new URL(base); } catch { return null; }
  return parsed.protocol === "https:" && key ? { origin: parsed.origin, key } : null;
}

async function deleteConnector(siteSlug, connector, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const configured = storeConfiguration(env);
  if (!configured) throw Object.assign(new Error("connector_store_not_configured"), { status: 503, code: "connector_store_not_configured" });
  const url = new URL(`${configured.origin}/rest/v1/connect_connectors`);
  url.searchParams.set("site_slug", `eq.${siteSlug}`);
  url.searchParams.set("platform", `eq.${connector.storagePlatform}`);
  const response = await fetchImpl(url, {
    method: "DELETE",
    headers: {
      apikey: configured.key,
      Authorization: `Bearer ${configured.key}`,
      Prefer: "return=representation",
      Accept: "application/json",
    },
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw Object.assign(new Error("connector_disconnect_failed"), { status: 502, code: "connector_disconnect_failed" });
  return Array.isArray(rows) ? rows.length : 0;
}

function statusPayload({ connector, siteSlug, row }) {
  const view = safeConnectorView(row);
  return {
    ok: true,
    siteSlug,
    platform: connector.requestedPlatform,
    provider: connector.storagePlatform,
    channel: connector.channel,
    ...view,
    connector: view,
    status: view,
    [connector.channel]: view,
  };
}

module.exports = {
  PROVIDERS,
  appOrigin,
  callbackUri,
  completeConnectorOAuth,
  deleteConnector,
  normalizePlatform,
  readConnector,
  resolveLegacyConnector,
  safeConnectorView,
  startConnectorOAuth,
  statusPayload,
};
