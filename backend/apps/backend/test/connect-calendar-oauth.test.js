"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GOOGLE_SCOPES, calendarOAuthEnabled, createCalendarOAuthService,
  normalizeSiteSlug, resolveScopedSiteSlug,
} = require("../lib/connect-calendar-oauth");

const NOW = new Date("2026-08-13T18:00:00.000Z");
const ENV = {
  CONNECT_CALENDAR_BOOKING_ENABLED: "true",
  GHOST_AGENCY_API_URL: "https://ghost-agency-backend.vercel.app",
  GOOGLE_CALENDAR_CLIENT_ID: "client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
};

function memoryStore() {
  const states = new Map();
  const connectors = new Map();
  let consumeCount = 0;
  return {
    async saveState(row) { states.set(row.state, row); },
    async consumeState(state) { consumeCount += 1; const row = states.get(state) || null; states.delete(state); return row; },
    async getConnector(slug) { return connectors.get(slug) || null; },
    async saveConnector(row) { connectors.set(row.site_slug, row); return row; },
    async deleteConnector(slug) { connectors.delete(slug); },
    states, connectors, get consumeCount() { return consumeCount; },
  };
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("calendar OAuth is strict default-off and scopes are exact", () => {
  assert.equal(calendarOAuthEnabled({}), false);
  assert.equal(calendarOAuthEnabled({ CONNECT_CALENDAR_BOOKING_ENABLED: "TRUE" }), false);
  assert.equal(calendarOAuthEnabled({ CONNECT_CALENDAR_BOOKING_ENABLED: "true" }), true);
  assert.deepEqual(GOOGLE_SCOPES, [
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events.freebusy",
    "https://www.googleapis.com/auth/calendar.events.owned",
  ]);
});

test("scope resolver binds tenant and makes full scope name a site", () => {
  const tenantReq = { url: "/api/connect/calendar/status", query: {} };
  assert.deepEqual(resolveScopedSiteSlug({ mode: "tenant", siteSlug: "acme-roofing" }, tenantReq), { ok: true, siteSlug: "acme-roofing" });
  assert.deepEqual(resolveScopedSiteSlug({ mode: "tenant", siteSlug: "acme-roofing" }, { url: "/?slug=other-site" }), { ok: false, status: 404, error: "not_found" });
  assert.deepEqual(resolveScopedSiteSlug({ mode: "full" }, tenantReq), { ok: false, status: 400, error: "slug_required_for_admin_scope" });
  assert.equal(resolveScopedSiteSlug({ mode: "full" }, { url: "/?slug=acme-roofing" }).siteSlug, "acme-roofing");
  assert.equal(resolveScopedSiteSlug({ mode: "full" }, tenantReq, {}, { CONNECT_CALENDAR_DEFAULT_SITE_SLUG: "default-shop" }).siteSlug, "default-shop");
  assert.equal(resolveScopedSiteSlug({ mode: "full" }, { url: "/?slug=explicit-shop" }, {}, { CONNECT_CALENDAR_DEFAULT_SITE_SLUG: "default-shop" }).siteSlug, "explicit-shop");
  assert.equal(resolveScopedSiteSlug({ mode: "tenant", siteSlug: "tenant-shop" }, tenantReq, {}, { CONNECT_CALENDAR_DEFAULT_SITE_SLUG: "default-shop" }).siteSlug, "tenant-shop");
  assert.equal(normalizeSiteSlug("../../etc/passwd"), "");
});

test("flag off status omits google_calendar and performs no reads", async () => {
  let calls = 0;
  const store = { async getConnector() { calls += 1; throw new Error("must not read"); } };
  const service = createCalendarOAuthService({ env: {}, store, fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } });
  assert.deepEqual(await service.status("acme-roofing"), { ok: true, enabled: false });
  assert.equal(calls, 0);
  await assert.rejects(service.start("acme-roofing"), { code: "calendar_disabled" });
  assert.equal(calls, 0);
});

test("start stores opaque ten-minute state and emits exact auth request", async () => {
  const store = memoryStore();
  const service = createCalendarOAuthService({ env: ENV, store, now: () => NOW });
  const { authorizationUrl } = await service.start("acme-roofing");
  const url = new URL(authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://ghost-agency-backend.vercel.app/api/connect/calendar/callback");
  assert.equal(url.searchParams.get("scope"), GOOGLE_SCOPES.join(" "));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  const state = url.searchParams.get("state");
  assert.match(state, /^[a-f0-9]{64}$/);
  const stored = store.states.get(state);
  assert.equal(stored.site_slug, "acme-roofing");
  assert.equal(stored.platform, "google_calendar");
  assert.equal(stored.expires_at, "2026-08-13T18:10:00.000Z");
});

test("callback consumes state once, exchanges server-side, lists calendars, and stores refresh token", async () => {
  const store = memoryStore();
  const calls = [];
  const service = createCalendarOAuthService({ env: ENV, store, now: () => NOW, fetchImpl: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      assert.equal(String(init.body).includes("client_secret=client-secret"), true);
      return jsonResponse(200, { access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600, token_type: "Bearer", scope: GOOGLE_SCOPES.join(" ") });
    }
    assert.equal(init.headers.authorization, "Bearer access-secret");
    return jsonResponse(200, { items: [
      { id: "reader@example.com", summary: "Reader", accessRole: "reader", timeZone: "UTC" },
      { id: "writer@example.com", summary: "Writer", accessRole: "writer", timeZone: "UTC" },
      { id: "secondary@example.com", summary: "Secondary", accessRole: "owner", timeZone: "UTC" },
      { id: "owner@example.com", summary: "Owner calendar", accessRole: "owner", primary: true, timeZone: "America/Los_Angeles" },
    ] });
  } });
  const { authorizationUrl } = await service.start("acme-roofing");
  const state = new URL(authorizationUrl).searchParams.get("state");
  const result = await service.complete({ code: "one-use-code", state, redirectUri: "https://ghost-agency-backend.vercel.app/api/connect/calendar/callback" });
  assert.equal(result.ok, true);
  assert.equal(result.calendarId, "owner@example.com");
  const saved = store.connectors.get("acme-roofing");
  assert.equal(saved.platform, "google_calendar");
  assert.equal(saved.access_token, "access-secret");
  assert.equal(saved.metadata.refresh_token, "refresh-secret");
  assert.equal(saved.metadata.calendar_id, "owner@example.com");
  assert.deepEqual(saved.metadata.calendars.map((calendar) => calendar.id), ["secondary@example.com", "owner@example.com"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  await assert.rejects(service.complete({ code: "replay", state, redirectUri: "https://ghost-agency-backend.vercel.app/api/connect/calendar/callback" }), { code: "calendar_state_invalid" });
  assert.equal(store.consumeCount, 2);
  assert.equal(calls.length, 2);
});

test("calendar selection is restricted to provider-returned calendars", async () => {
  const store = memoryStore();
  store.connectors.set("acme-roofing", {
    site_slug: "acme-roofing", platform: "google_calendar", is_active: true,
    account_name: "Owner", access_token: "access", token_expires_at: "2026-08-13T19:00:00Z",
    metadata: { refresh_token: "refresh", calendar_id: "one", time_zone: "UTC", calendars: [
      { id: "one", summary: "One", accessRole: "owner", primary: true, timeZone: "UTC" },
      { id: "two", summary: "Two", accessRole: "owner", primary: false, timeZone: "America/Chicago" },
      { id: "shared", summary: "Shared", accessRole: "writer", primary: false, timeZone: "UTC" },
    ] },
  });
  const service = createCalendarOAuthService({ env: ENV, store, now: () => NOW });
  const selected = await service.selectCalendar("acme-roofing", "two");
  assert.deepEqual(selected, { selectedCalendarId: "two", calendarName: "Two", timeZone: "America/Chicago" });
  await assert.rejects(service.selectCalendar("acme-roofing", "shared"), { code: "calendar_selection_invalid" });
  await assert.rejects(service.selectCalendar("acme-roofing", "attacker@example.com"), { code: "calendar_selection_invalid" });
});

test("disconnect attempts provider revoke, deletes local connector, and returns no token", async () => {
  const store = memoryStore();
  store.connectors.set("acme-roofing", { site_slug: "acme-roofing", platform: "google_calendar", is_active: true, access_token: "access", metadata: { refresh_token: "refresh" } });
  const calls = [];
  const service = createCalendarOAuthService({ env: ENV, store, fetchImpl: async (url, init) => { calls.push({ url, body: String(init.body) }); return new Response("", { status: 200 }); } });
  const result = await service.disconnect("acme-roofing");
  assert.deepEqual(result, { disconnected: true });
  assert.equal(store.connectors.has("acme-roofing"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/revoke");
  assert.match(calls[0].body, /token=refresh/);
});
