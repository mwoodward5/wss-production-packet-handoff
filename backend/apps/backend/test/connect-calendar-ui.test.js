"use strict";

// Google Calendar in the welded Connect v2 page.
//
// The v1 page carried a full calendar-management surface (calendar picker,
// save, per-slug admin paths). The v2 redesign reduced Connections to a
// connect/disconnect row per provider, served by the CONNECT_DATA adapter, so
// this file re-pins the SAFETY invariants that survive the redesign:
//
//   1. the calendar row exists only when the authenticated status advertises
//      it under .connectors — an injected top-level value cannot conjure it;
//   2. OAuth starts through the authenticated API and the popup can only be
//      steered to Google's own HTTPS consent host;
//   3. disconnect is the authenticated POST /calendar/disconnect;
//   4. no OAuth secrets ever appear in the page.
//
// RETIRED with the redesign (documented regressions, not silent drops): the
// calendar PICKER (choose which calendar receives bookings) and the admin
// calendarPath/calendarBody slug plumbing — v2's Connections UI has no
// surface for either, so their assertions pinned removed v1 internals.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const {
  bootAdapter,
  functionSource,
  readPage,
} = require("./fixtures/connect-v2-adapter-harness.js");

test("Google Calendar is absent unless the authenticated status advertises it", async () => {
  const statuses = [
    {},
    { ok: true, connectors: {} },
    // The legacy/injected top-level shape: the status route only ever places
    // google_calendar under .connectors, so a top-level value is untrusted.
    { ok: true, google_calendar: { connected: true } },
    { ok: true, connectors: { google_calendar: { available: false, connected: true } } },
  ];
  for (const status of statuses) {
    const page = await bootAdapter({
      routes: { "/connectors/status": (_url, _init, answer) => answer(status) },
    });
    const list = await page.adapter.listConnections();
    assert.equal(
      list.some((row) => /calendar/i.test(row.label)),
      false,
      `status ${JSON.stringify(status)} must not advertise a calendar row`,
    );
  }

  const advertised = await bootAdapter({
    routes: {
      "/connectors/status": (_url, _init, answer) =>
        answer({ ok: true, connectors: { google_calendar: { available: true, connected: false } } }),
    },
  });
  const rows = await advertised.adapter.listConnections();
  const calendar = rows.find((row) => /calendar/i.test(row.label));
  assert.ok(calendar, "an advertised calendar renders a row");
  assert.equal(calendar.connected, false);
});

test("Calendar OAuth starts through the authenticated API and accepts only Google's HTTPS authorize host", async () => {
  const { adapterSource } = readPage();
  const safeUrl = new vm.Script(`(${functionSource(adapterSource, "safeGoogleAuthorizationUrl")})`).runInNewContext({ URL });

  assert.equal(safeUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=redacted").startsWith("https://accounts.google.com/"), true);
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://accounts.google.com.evil.example/oauth"), "");

  // The popup opens synchronously (popup-blocker rules) and is steered to the
  // server-provided authorize URL only after the safe-host check passes.
  const replaced = [];
  const popup = {
    closed: false,
    close() { this.closed = true; },
    location: {
      hash: "",
      replace(url) { replaced.push(url); },
      set href(url) { replaced.push(url); },
    },
  };
  const good = await bootAdapter({
    openResult: popup,
    routes: {
      "/calendar/start": (_url, init, answer) => {
        assert.ok(init.headers["x-connect-token"], "calendar OAuth start is an authenticated call");
        return answer({ ok: true, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=ok" });
      },
    },
  });
  const pending = good.adapter.connectAccount("google");
  pending.catch(() => {}); // resolves only when the popup round-trip finishes
  await good.settle();
  assert.deepEqual(replaced, ["https://accounts.google.com/o/oauth2/v2/auth?state=ok"]);
  const startCall = good.calls.find((call) => call.url.includes("/calendar/start"));
  assert.ok(startCall, "the authorize URL comes from the authenticated API, never from the client");
  assert.doesNotMatch(startCall.url, /[?&](slug|site)=/, "calendar tenant identity comes from the token, not a query string");

  // Complete the popup round-trip through the adapter's own poll: the
  // callback route parks "#connected=..." on the popup, the poll reads it.
  popup.location.hash = "#connected=google_calendar";
  const poll = good.intervals.find((entry) => entry.ms === 700);
  assert.ok(poll, "the popup is watched for its callback hash");
  poll.fn();
  await good.settle();
  await pending; // resolves without throwing
  assert.equal(popup.closed, true);

  // A non-Google URL must never reach the popup.
  const evilReplaced = [];
  const evilPopup = {
    closed: false,
    close() { this.closed = true; },
    location: { hash: "", replace(url) { evilReplaced.push(url); }, set href(url) { evilReplaced.push(url); } },
  };
  const evil = await bootAdapter({
    openResult: evilPopup,
    routes: {
      "/calendar/start": (_url, _init, answer) =>
        answer({ ok: true, authorizationUrl: "https://accounts.google.com.evil.example/oauth" }),
    },
  });
  await assert.rejects(() => evil.adapter.connectAccount("google"), /not ready yet/i);
  assert.deepEqual(evilReplaced, [], "a hostile authorize URL never navigates the popup");
  assert.equal(evilPopup.closed, true, "the refused popup does not linger");
});

test("Calendar disconnect is the authenticated POST, and social rows refuse disconnect honestly", async () => {
  const page = await bootAdapter({
    routes: {
      "/calendar/disconnect": (_url, init, answer) => {
        assert.equal(String(init.method).toUpperCase(), "POST");
        assert.ok(init.headers["x-connect-token"], "disconnect is an authenticated call");
        return answer({ ok: true });
      },
    },
  });
  await page.adapter.disconnectAccount("google");
  assert.ok(page.calls.some((call) => call.url.endsWith("/calendar/disconnect")));

  // The backend has no social-disconnect route (v1 never offered one either);
  // the adapter must refuse with plain words rather than pretend.
  const before = page.calls.length;
  await assert.rejects(() => page.adapter.disconnectAccount("facebook"), /isn't available yet/i);
  assert.equal(page.calls.length, before, "a refused disconnect makes no network write");
});

test("the page never receives or stores OAuth secrets and keeps the OAuth channels wired", async () => {
  const { adapterSource } = readPage();
  assert.doesNotMatch(adapterSource, /access_token|refresh_token|client_secret/i);

  // The five OAuth providers plus calendar survive the redesign. The v1
  // informational catalog rows (gmail, google_voice, google_chat,
  // google_business, craigslist — display-only "request" entries with no
  // OAuth) have no v2 surface; that regression is reported, not hidden here.
  const page = await bootAdapter({
    routes: {
      "/connectors/status": (_url, _init, answer) =>
        answer({
          ok: true,
          connectors: {
            facebook_messenger: { connected: true, accountName: "Alpha Plumbing Page" },
            instagram_dm: { connected: false },
            google_calendar: { available: true, connected: true },
          },
        }),
    },
  });
  const rows = await page.adapter.listConnections();
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  assert.deepEqual(Object.keys(byKey).sort(), ["facebook", "google", "instagram", "linkedin", "tiktok", "twitter"]);
  assert.equal(byKey.facebook.connected, true);
  assert.equal(byKey.facebook.detail, "Alpha Plumbing Page", "a connected account shows its real name");
  assert.equal(byKey.instagram.connected, false);
  assert.equal(byKey.google.connected, true);
  assert.doesNotMatch(JSON.stringify(rows), /token|secret/i);
});
