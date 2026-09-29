"use strict";

const { randomBytes } = require("node:crypto");
const { insertRow, select, upsertRow } = require("./store");
const { createGoogleCalendarClient } = require("./connect-calendar");

const PLATFORM = "google_calendar";
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned",
]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

class CalendarOAuthError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "CalendarOAuthError";
    this.code = code;
    this.status = status;
  }
}

function clean(value, max = 1000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function calendarOAuthEnabled(env = process.env) {
  return env.CONNECT_CALENDAR_BOOKING_ENABLED === "true";
}

function normalizeSiteSlug(value) {
  const slug = clean(value, 81).toLowerCase();
  return SLUG_RE.test(slug) ? slug : "";
}

function requestedSiteSlug(req, body = {}) {
  let querySlug = "";
  try { querySlug = new URL(req.url || "", "https://connect.wss-labs.com").searchParams.get("slug") || ""; } catch { /* empty */ }
  return normalizeSiteSlug(querySlug || req.query?.slug || body.slug);
}

function resolveScopedSiteSlug(scope, req, body = {}, env = process.env) {
  const requested = requestedSiteSlug(req, body);
  if (scope?.mode === "tenant") {
    const own = normalizeSiteSlug(scope.siteSlug);
    if (!own || (requested && requested !== own)) return { ok: false, status: 404, error: "not_found" };
    return { ok: true, siteSlug: own };
  }
  if (scope?.mode === "full") {
    const fallback = normalizeSiteSlug(env.CONNECT_CALENDAR_DEFAULT_SITE_SLUG);
    const siteSlug = requested || fallback;
    return siteSlug
      ? { ok: true, siteSlug }
      : { ok: false, status: 400, error: "slug_required_for_admin_scope" };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

async function readJsonBody(req, maxBytes = 64 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new CalendarOAuthError("request_body_too_large", 413);
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new CalendarOAuthError("invalid_json", 400); }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

function calendarCors(req, res, methods) {
  const origin = clean(req.headers?.origin, 300);
  const allowed = ["https://connect.wss-labs.com", "https://wss-ai.com", "https://www.wss-ai.com"];
  if (allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", `${methods.join(",")},OPTIONS`);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

function callbackUri(env = process.env) {
  const base = clean(env.GHOST_AGENCY_API_URL || "https://ghost-agency-backend.vercel.app", 1000).replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(base); } catch { throw new CalendarOAuthError("calendar_api_url_invalid", 500); }
  if (parsed.protocol !== "https:") throw new CalendarOAuthError("calendar_api_url_invalid", 500);
  return `${parsed.origin}/api/connect/calendar/callback`;
}

function appRedirectUrl(env = process.env) {
  const raw = clean(env.CONNECT_APP_URL || "https://connect.wss-labs.com/", 1000);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("protocol");
    return `${url.origin}/`;
  } catch {
    return "https://connect.wss-labs.com/";
  }
}

async function boundedJson(response) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new CalendarOAuthError("calendar_oauth_response_too_large", 502);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new CalendarOAuthError("calendar_oauth_response_too_large", 502);
  try { return text ? JSON.parse(text) : {}; } catch { throw new CalendarOAuthError("calendar_oauth_response_invalid", 502); }
}

async function timedFetch(fetchImpl, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetchImpl(url, { ...init, signal: controller.signal }); }
  catch { throw new CalendarOAuthError("calendar_oauth_network_error", 502); }
  finally { clearTimeout(timer); }
}

function supabaseHeaders(env, prefer = "return=representation") {
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY, 5000);
  if (!key) throw new CalendarOAuthError("calendar_store_not_configured", 500);
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: prefer };
}

function supabaseTableUrl(env, table) {
  const base = clean(env.SUPABASE_URL, 2000).replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(base); } catch { throw new CalendarOAuthError("calendar_store_not_configured", 500); }
  if (parsed.protocol !== "https:") throw new CalendarOAuthError("calendar_store_not_configured", 500);
  return `${parsed.origin}/rest/v1/${table}`;
}

function defaultStore({ env, fetchImpl, now }) {
  return {
    async saveState(row) {
      const result = await insertRow("connect_oauth_states", row);
      if (result?.mode !== "live_write") throw new CalendarOAuthError("calendar_state_write_failed", 502);
    },
    async consumeState(state) {
      const url = new URL(supabaseTableUrl(env, "connect_oauth_states"));
      url.searchParams.set("state", `eq.${state}`);
      url.searchParams.set("platform", `eq.${PLATFORM}`);
      url.searchParams.set("expires_at", `gt.${now().toISOString()}`);
      url.searchParams.set("select", "state,platform,site_slug,redirect_uri,expires_at");
      const response = await timedFetch(fetchImpl, url, { method: "DELETE", headers: supabaseHeaders(env) });
      const rows = await boundedJson(response);
      if (!response.ok) throw new CalendarOAuthError("calendar_state_consume_failed", 502);
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async getConnector(siteSlug) {
      const result = await select("connect_connectors", `site_slug=eq.${encodeURIComponent(siteSlug)}&platform=eq.${PLATFORM}&limit=1`);
      return result?.ok && Array.isArray(result.data) ? result.data[0] || null : null;
    },
    async saveConnector(row) {
      const result = await upsertRow("connect_connectors", row, "site_slug,platform");
      if (result?.mode !== "live_upsert") throw new CalendarOAuthError("calendar_connector_write_failed", 502);
      return row;
    },
    async deleteConnector(siteSlug) {
      const url = new URL(supabaseTableUrl(env, "connect_connectors"));
      url.searchParams.set("site_slug", `eq.${siteSlug}`);
      url.searchParams.set("platform", `eq.${PLATFORM}`);
      const response = await timedFetch(fetchImpl, url, { method: "DELETE", headers: supabaseHeaders(env, "return=minimal") });
      if (!response.ok) throw new CalendarOAuthError("calendar_disconnect_failed", 502);
    },
  };
}

function safeCalendar(calendar) {
  const id = clean(calendar?.id, 500);
  if (!id) return null;
  return {
    id,
    summary: clean(calendar.summary || calendar.summaryOverride || id, 500),
    primary: calendar.primary === true,
    accessRole: clean(calendar.accessRole, 30),
    timeZone: clean(calendar.timeZone, 100) || "UTC",
  };
}

function connectorView(row) {
  if (!row || row.is_active !== true) return { connected: false };
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const calendars = (Array.isArray(metadata.calendars) ? metadata.calendars : [])
    .map(safeCalendar).filter((calendar) => calendar && calendar.accessRole === "owner");
  const calendarId = clean(metadata.calendar_id, 500);
  const selected = calendars.find((item) => item.id === calendarId);
  return {
    connected: true,
    accountName: clean(row.account_name, 500) || undefined,
    calendarId: calendarId || undefined,
    calendarName: clean(selected?.summary, 500) || undefined,
    timeZone: clean(metadata.time_zone, 100) || selected?.timeZone || undefined,
    calendars,
  };
}

function tenantCalendarStore({ siteSlug, store }) {
  const bookingMemory = new Map();
  return {
    async getToken() {
      const row = await store.getConnector(siteSlug);
      if (!row || row.is_active !== true) return null;
      const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      return { accessToken: row.access_token, refreshToken: meta.refresh_token, expiresAt: row.token_expires_at };
    },
    async saveToken(token) {
      const row = await store.getConnector(siteSlug);
      if (!row) throw new CalendarOAuthError("calendar_not_connected", 409);
      const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      await store.saveConnector({ ...row, access_token: token.accessToken, token_expires_at: token.expiresAt, metadata: { ...meta, refresh_token: token.refreshToken || meta.refresh_token }, updated_at: new Date().toISOString() });
    },
    async claimBooking(claim) {
      const record = bookingMemory.get(claim.key) || null;
      if (!record) bookingMemory.set(claim.key, { ...claim, status: "pending" });
      return { claimed: !record, record };
    },
    async completeBooking(record) { bookingMemory.set(record.key, { ...record, status: "confirmed" }); },
  };
}

function createCalendarOAuthService({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date(), store: suppliedStore } = {}) {
  const store = suppliedStore || defaultStore({ env, fetchImpl, now });
  const enabled = calendarOAuthEnabled(env);

  function requireEnabled() {
    if (!enabled) throw new CalendarOAuthError("calendar_disabled", 404);
  }

  function requireClient() {
    const clientId = clean(env.GOOGLE_CALENDAR_CLIENT_ID, 1000);
    const clientSecret = clean(env.GOOGLE_CALENDAR_CLIENT_SECRET, 2000);
    if (!clientId || !clientSecret) throw new CalendarOAuthError("calendar_oauth_not_configured", 503);
    return { clientId, clientSecret };
  }

  async function start(siteSlug) {
    requireEnabled();
    const slug = normalizeSiteSlug(siteSlug);
    if (!slug) throw new CalendarOAuthError("calendar_site_invalid");
    const { clientId } = requireClient();
    const state = randomBytes(32).toString("hex");
    const redirectUri = callbackUri(env);
    await store.saveState({ state, platform: PLATFORM, site_slug: slug, redirect_uri: redirectUri, expires_at: new Date(now().getTime() + STATE_TTL_MS).toISOString() });
    const url = new URL(GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "false", scope: GOOGLE_SCOPES.join(" "), state }).toString();
    return { authorizationUrl: url.toString() };
  }

  async function exchange(code, redirectUri) {
    const { clientId, clientSecret } = requireClient();
    const response = await timedFetch(fetchImpl, GOOGLE_TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
    });
    const json = await boundedJson(response);
    if (!response.ok || !clean(json.access_token) || !clean(json.refresh_token)) throw new CalendarOAuthError("calendar_token_exchange_failed", 502);
    const granted = new Set(clean(json.scope, 4000).split(/\s+/).filter(Boolean));
    if (!GOOGLE_SCOPES.every((scope) => granted.has(scope))) throw new CalendarOAuthError("calendar_required_scopes_missing", 409);
    return json;
  }

  async function fetchCalendars(accessToken) {
    const response = await timedFetch(fetchImpl, GOOGLE_CALENDAR_LIST_URL, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    const json = await boundedJson(response);
    if (!response.ok) throw new CalendarOAuthError("calendar_list_failed", 502);
    return (Array.isArray(json.items) ? json.items : [])
      .map(safeCalendar).filter((calendar) => calendar && calendar.accessRole === "owner").slice(0, 100);
  }

  async function complete({ code, state, redirectUri }) {
    requireEnabled();
    const stateRow = await store.consumeState(clean(state, 128));
    if (!stateRow || stateRow.platform !== PLATFORM) throw new CalendarOAuthError("calendar_state_invalid", 400);
    if (stateRow.redirect_uri !== redirectUri) throw new CalendarOAuthError("calendar_redirect_mismatch", 400);
    const token = await exchange(clean(code, 4096), redirectUri);
    const calendars = await fetchCalendars(token.access_token);
    const selected = calendars.find((item) => item.primary) || calendars[0];
    if (!selected) throw new CalendarOAuthError("calendar_none_available", 409);
    const nowIso = now().toISOString();
    await store.saveConnector({
      site_slug: stateRow.site_slug, platform: PLATFORM, is_active: true,
      account_name: selected.summary || "Google Calendar", platform_user_id: selected.id,
      access_token: clean(token.access_token, 4096), token_expires_at: new Date(now().getTime() + Math.max(60, Number(token.expires_in) || 3600) * 1000).toISOString(),
      metadata: { refresh_token: clean(token.refresh_token, 4096), token_type: clean(token.token_type, 40), granted_scope: clean(token.scope, 4000), calendars, calendar_id: selected.id, time_zone: selected.timeZone },
      connected_at: nowIso, updated_at: nowIso,
    });
    return { ok: true, siteSlug: stateRow.site_slug, accountName: selected.summary || "Google Calendar", calendarId: selected.id };
  }

  async function status(siteSlug) {
    if (!enabled) return { ok: true, enabled: false };
    const row = await store.getConnector(normalizeSiteSlug(siteSlug));
    return { ok: true, enabled: true, google_calendar: connectorView(row) };
  }

  async function calendars(siteSlug) {
    requireEnabled();
    const row = await store.getConnector(normalizeSiteSlug(siteSlug));
    const view = connectorView(row);
    if (!view.connected) throw new CalendarOAuthError("calendar_not_connected", 409);
    return { calendars: view.calendars, selectedCalendarId: view.calendarId || "" };
  }

  async function selectCalendar(siteSlug, calendarId) {
    requireEnabled();
    const slug = normalizeSiteSlug(siteSlug);
    const row = await store.getConnector(slug);
    const view = connectorView(row);
    const selected = view.calendars.find((item) => item.id === clean(calendarId, 500));
    if (!row || !selected) throw new CalendarOAuthError("calendar_selection_invalid", 400);
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    await store.saveConnector({ ...row, metadata: { ...metadata, calendar_id: selected.id, time_zone: selected.timeZone }, platform_user_id: selected.id, account_name: selected.summary, updated_at: now().toISOString() });
    return { selectedCalendarId: selected.id, calendarName: selected.summary, timeZone: selected.timeZone };
  }

  async function disconnect(siteSlug) {
    requireEnabled();
    const slug = normalizeSiteSlug(siteSlug);
    const row = await store.getConnector(slug);
    if (row) {
      const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const token = clean(meta.refresh_token || row.access_token, 4096);
      if (token) await timedFetch(fetchImpl, GOOGLE_REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString() }).catch(() => null);
    }
    await store.deleteConnector(slug);
    return { disconnected: true };
  }

  async function calendarClient(siteSlug) {
    requireEnabled();
    const slug = normalizeSiteSlug(siteSlug);
    const row = await store.getConnector(slug);
    const view = connectorView(row);
    if (!row || !view.connected || !view.calendarId || !view.timeZone) throw new CalendarOAuthError("calendar_not_connected", 409);
    const tenantStore = tenantCalendarStore({ siteSlug: slug, store });
    return createGoogleCalendarClient({ env: { ...env, GOOGLE_CALENDAR_ID: view.calendarId, GOOGLE_CALENDAR_TIMEZONE: view.timeZone }, fetchImpl, store: tenantStore, now });
  }

  return Object.freeze({ enabled, start, complete, status, calendars, selectCalendar, disconnect, calendarClient });
}

module.exports = {
  CalendarOAuthError, GOOGLE_SCOPES, PLATFORM, appRedirectUrl, callbackUri,
  calendarCors, calendarOAuthEnabled, createCalendarOAuthService, normalizeSiteSlug,
  readJsonBody, requestedSiteSlug, resolveScopedSiteSlug, sendJson,
};
