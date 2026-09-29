"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CalendarClientError, calendarBookingEnabled, computeAvailableSlots, createGoogleCalendarClient, googleEventId } = require("../lib/connect-calendar");

const NOW = new Date("2026-08-17T15:00:00.000Z"); // Monday 8 AM PDT
const ENV = {
  CONNECT_CALENDAR_BOOKING_ENABLED: "true",
  GOOGLE_CALENDAR_ID: "primary",
  GOOGLE_CALENDAR_TIMEZONE: "America/Los_Angeles",
  GOOGLE_CALENDAR_CLIENT_ID: "client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
  GOOGLE_CALENDAR_REFRESH_TOKEN: "refresh-token",
};
const HOURS = { monday: { start: "09:00", end: "17:00" } };

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function memoryStore() {
  const bookings = new Map();
  let token = null;
  return {
    async getToken() { return token; },
    async saveToken(next) { token = next; },
    async claimBooking(row) {
      const record = bookings.get(row.key) || null;
      if (!record) bookings.set(row.key, { ...row, status: "pending" });
      return { claimed: !record, record };
    },
    async completeBooking(row) { bookings.set(row.key, { ...row, status: "confirmed" }); },
    bookings,
  };
}

test("flag is strict and defaults off", async () => {
  assert.equal(calendarBookingEnabled({}), false);
  assert.equal(calendarBookingEnabled({ CONNECT_CALENDAR_BOOKING_ENABLED: "TRUE" }), false);
  assert.equal(calendarBookingEnabled({ CONNECT_CALENDAR_BOOKING_ENABLED: "true" }), true);
  let calls = 0;
  const client = createGoogleCalendarClient({ env: {}, fetchImpl: async () => { calls += 1; throw new Error("must not call"); } });
  assert.deepEqual(await client.findAvailableSlots({}), { ok: false, enabled: false, reason: "calendar_disabled", slots: [] });
  assert.deepEqual(await client.createEvent({}), { ok: false, enabled: false, confirmed: false, reason: "calendar_disabled" });
  assert.equal(calls, 0);
});

test("slot computation honors timezone, duration, work hours, now, and busy ranges", () => {
  const slots = computeAvailableSlots({
    timeMin: "2026-08-17T15:00:00.000Z", timeMax: "2026-08-18T00:00:00.000Z",
    timeZone: "America/Los_Angeles", durationMinutes: 60, slotStepMinutes: 30,
    workHours: HOURS, now: NOW,
    busy: [{ start: "2026-08-17T17:00:00.000Z", end: "2026-08-17T18:00:00.000Z" }],
  });
  assert.deepEqual(slots.slice(0, 3).map((slot) => slot.start), [
    "2026-08-17T16:00:00.000Z", "2026-08-17T18:00:00.000Z", "2026-08-17T18:30:00.000Z",
  ]);
  assert.equal(slots.every((slot) => slot.timeZone === "America/Los_Angeles"), true);
});

test("slot computation handles DST using the named timezone", () => {
  const slots = computeAvailableSlots({
    timeMin: "2026-11-02T00:00:00.000Z", timeMax: "2026-11-03T08:00:00.000Z",
    timeZone: "America/Los_Angeles", durationMinutes: 60,
    workHours: HOURS, now: new Date("2026-11-01T00:00:00.000Z"), busy: [], limit: 1,
  });
  assert.equal(slots[0].start, "2026-11-02T17:00:00.000Z", "9 AM PST is 17:00Z after DST ends");
});

test("OAuth refresh is form encoded, saved, and reused for freebusy", async () => {
  const calls = [];
  const store = memoryStore();
  const client = createGoogleCalendarClient({ env: ENV, store, now: () => NOW, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "fresh-access", expires_in: 3600 });
    assert.equal(init.headers.authorization, "Bearer fresh-access");
    return jsonResponse(200, { calendars: { primary: { busy: [] } } });
  } });
  const result = await client.findAvailableSlots({ timeMin: "2026-08-17T15:00:00Z", timeMax: "2026-08-18T00:00:00Z", durationMinutes: 30, workHours: HOURS });
  assert.equal(result.ok, true);
  assert.match(String(calls[0].init.body), /grant_type=refresh_token/);
  assert.equal(String(calls[0].init.body).includes("client_secret=client-secret"), true);
  assert.equal(calls.length, 2);
});

test("401 refreshes once and retries without exposing credentials", async () => {
  const store = memoryStore();
  await store.saveToken({ accessToken: "stale", refreshToken: "refresh-token", expiresAt: "2026-08-17T17:00:00Z" });
  const calls = [];
  const client = createGoogleCalendarClient({ env: ENV, store, now: () => NOW, fetchImpl: async (url, init) => {
    calls.push({ url, auth: init.headers && init.headers.authorization });
    if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "fresh", expires_in: 3600 });
    if (calls.filter((call) => call.url.includes("freeBusy")).length === 1) return jsonResponse(401, { error: { message: "sensitive" } });
    return jsonResponse(200, { calendars: { primary: { busy: [] } } });
  } });
  const result = await client.findAvailableSlots({ timeMin: "2026-08-17T15:00:00Z", timeMax: "2026-08-18T00:00:00Z", durationMinutes: 30, workHours: HOURS });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.auth).filter(Boolean), ["Bearer stale", "Bearer fresh"]);
});

test("event creation rechecks freebusy, uses deterministic Google ID, and records only confirmed truth", async () => {
  const store = memoryStore();
  const idempotencyKey = "booking/thread-42/slot-1";
  let inserts = 0;
  const client = createGoogleCalendarClient({ env: ENV, store, now: () => NOW, fetchImpl: async (url, init) => {
    if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "access", expires_in: 3600 });
    if (/\/events\/[^?]+$/.test(url)) return jsonResponse(404, { error: { code: 404 } });
    if (url.endsWith("/freeBusy")) return jsonResponse(200, { calendars: { primary: { busy: [] } } });
    if (url.includes("/events?")) {
      inserts += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.id, googleEventId(idempotencyKey));
      assert.equal(body.extendedProperties.private.wssPayloadHash.length, 64);
      return jsonResponse(200, { id: body.id, status: "confirmed", htmlLink: "https://calendar.google.com/event?eid=safe", start: body.start, end: body.end, extendedProperties: body.extendedProperties });
    }
    throw new Error(`unexpected ${url}`);
  } });
  const input = { idempotencyKey, summary: "Service consultation", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, sendUpdates: "none" };
  const first = await client.createEvent(input);
  const replay = await client.createEvent(input);
  assert.equal(first.confirmed, true);
  assert.equal(first.idempotent, false);
  assert.equal(replay.idempotent, true);
  assert.equal(inserts, 1);
});

test("pending replay recovers a committed event before FreeBusy rejects its own busy slot", async () => {
  const store = memoryStore();
  const idempotencyKey = "booking/lost-insert-response";
  const input = { idempotencyKey, summary: "Service consultation", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, sendUpdates: "none" };
  let committedEvent = null;
  let freeBusyCalls = 0;
  let insertCalls = 0;

  const firstClient = createGoogleCalendarClient({ env: ENV, store, now: () => NOW, fetchImpl: async (url, init) => {
    if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "access", expires_in: 3600 });
    if (/\/events\/[^?]+$/.test(url)) return jsonResponse(404, { error: { code: 404 } });
    if (url.endsWith("/freeBusy")) {
      freeBusyCalls += 1;
      return jsonResponse(200, { calendars: { primary: { busy: [] } } });
    }
    if (url.includes("/events?")) {
      insertCalls += 1;
      const body = JSON.parse(init.body);
      committedEvent = { id: body.id, status: "confirmed", htmlLink: "https://calendar.google.com/lost", start: body.start, end: body.end, extendedProperties: body.extendedProperties };
      throw new TypeError("socket closed after Google committed");
    }
    throw new Error(`unexpected ${url}`);
  } });
  await assert.rejects(firstClient.createEvent(input), { code: "calendar_network_error" });
  assert.ok(committedEvent, "fixture must simulate a committed provider event");

  const retryClient = createGoogleCalendarClient({ env: ENV, store, now: () => NOW, fetchImpl: async (url) => {
    if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "access-2", expires_in: 3600 });
    if (/\/events\/[^?]+$/.test(url)) return jsonResponse(200, committedEvent);
    if (url.endsWith("/freeBusy")) {
      freeBusyCalls += 1;
      return jsonResponse(200, { calendars: { primary: { busy: [{ start: input.start, end: input.end }] } } });
    }
    throw new Error(`unexpected ${url}`);
  } });
  const recovered = await retryClient.createEvent(input);
  assert.equal(recovered.confirmed, true);
  assert.equal(recovered.idempotent, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.eventId, committedEvent.id);
  assert.equal(insertCalls, 1);
  assert.equal(freeBusyCalls, 1, "retry must read deterministic event before FreeBusy");
  assert.equal(store.bookings.get(idempotencyKey).status, "confirmed");
});

test("a new serverless instance with an empty store recovers Google's deterministic event before FreeBusy", async () => {
  const idempotencyKey = "booking/cross-instance-lost-response";
  const input = { idempotencyKey, summary: "Service consultation", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, sendUpdates: "none" };
  const firstStore = memoryStore();
  let committedEvent = null;
  const firstClient = createGoogleCalendarClient({ env: ENV, store: firstStore, now: () => NOW, fetchImpl: async (url, init) => {
    if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "access", expires_in: 3600 });
    if (/\/events\/[^?]+$/.test(url)) return jsonResponse(404, { error: { code: 404 } });
    if (url.endsWith("/freeBusy")) return jsonResponse(200, { calendars: { primary: { busy: [] } } });
    if (url.includes("/events?")) {
      const body = JSON.parse(init.body);
      committedEvent = { id: body.id, status: "confirmed", htmlLink: "https://calendar.google.com/cross-instance", start: body.start, end: body.end, extendedProperties: body.extendedProperties };
      throw new TypeError("response lost after commit");
    }
    throw new Error(`unexpected ${url}`);
  } });
  await assert.rejects(firstClient.createEvent(input), { code: "calendar_network_error" });
  assert.ok(committedEvent);

  const secondStore = memoryStore();
  let eventReads = 0;
  let freeBusyCalls = 0;
  let insertCalls = 0;
  const secondClient = createGoogleCalendarClient({ env: ENV, store: secondStore, now: () => NOW, fetchImpl: async (url) => {
    if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "access-2", expires_in: 3600 });
    if (/\/events\/[^?]+$/.test(url)) { eventReads += 1; return jsonResponse(200, committedEvent); }
    if (url.endsWith("/freeBusy")) { freeBusyCalls += 1; return jsonResponse(200, { calendars: { primary: { busy: [{ start: input.start, end: input.end }] } } }); }
    if (url.includes("/events?")) { insertCalls += 1; throw new Error("must not insert"); }
    throw new Error(`unexpected ${url}`);
  } });
  const recovered = await secondClient.createEvent(input);
  assert.equal(recovered.confirmed, true);
  assert.equal(recovered.idempotent, true);
  assert.equal(recovered.recovered, true);
  assert.equal(eventReads, 1);
  assert.equal(freeBusyCalls, 0);
  assert.equal(insertCalls, 0);
  assert.equal(secondStore.bookings.get(idempotencyKey).status, "confirmed");
});

test("pending replay never accepts an unconfirmed or proof-mismatched deterministic event", async () => {
  const store = memoryStore();
  const input = { idempotencyKey: "booking/untrusted-replay", summary: "Service consultation", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, sendUpdates: "none" };
  await store.claimBooking({ key: input.idempotencyKey, fingerprint: "placeholder", eventId: googleEventId(input.idempotencyKey) });
  // Let createEvent's strict fingerprint check remain the first guard for a
  // store row that cannot belong to this exact request.
  const client = createGoogleCalendarClient({ env: ENV, store, now: () => NOW, fetchImpl: async () => { throw new Error("must not call"); } });
  await assert.rejects(client.createEvent(input), { code: "calendar_idempotency_payload_mismatch" });
});

test("event creation refuses busy, out-of-hours, mismatched replay, and unconfirmed provider output", async (t) => {
  await t.test("busy", async () => {
    const client = createGoogleCalendarClient({ env: ENV, store: memoryStore(), now: () => NOW, fetchImpl: async (url) => {
      if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "access", expires_in: 3600 });
      if (/\/events\/[^?]+$/.test(url)) return jsonResponse(404, { error: { code: 404 } });
      return jsonResponse(200, { calendars: { primary: { busy: [{ start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z" }] } } });
    } });
    await assert.rejects(client.createEvent({ idempotencyKey: "busy", summary: "Call", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, sendUpdates: "none" }), { code: "calendar_slot_no_longer_available" });
  });
  await t.test("out of hours", async () => {
    const client = createGoogleCalendarClient({ env: ENV, store: memoryStore(), now: () => NOW, fetchImpl: async () => { throw new Error("no call"); } });
    await assert.rejects(client.createEvent({ idempotencyKey: "early", summary: "Call", start: "2026-08-17T15:30:00Z", end: "2026-08-17T16:00:00Z", workHours: HOURS, sendUpdates: "none" }), { code: "calendar_event_outside_work_hours" });
  });
  await t.test("unconfirmed", async () => {
    const client = createGoogleCalendarClient({ env: ENV, store: memoryStore(), now: () => NOW, fetchImpl: async (url, init) => {
      if (url.includes("oauth2.googleapis.com")) return jsonResponse(200, { access_token: "access", expires_in: 3600 });
      if (/\/events\/[^?]+$/.test(url)) return jsonResponse(404, { error: { code: 404 } });
      if (url.endsWith("/freeBusy")) return jsonResponse(200, { calendars: { primary: { busy: [] } } });
      const body = JSON.parse(init.body);
      return jsonResponse(200, { id: body.id, status: "tentative", start: body.start, end: body.end, extendedProperties: body.extendedProperties });
    } });
    await assert.rejects(client.createEvent({ idempotencyKey: "tentative", summary: "Call", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, sendUpdates: "none" }), { code: "calendar_event_not_confirmed" });
  });
  await t.test("payload mismatch", async () => {
    const store = memoryStore();
    await store.claimBooking({ key: "same", fingerprint: "different", eventId: googleEventId("same") });
    const client = createGoogleCalendarClient({ env: ENV, store, now: () => NOW, fetchImpl: async () => { throw new Error("no call"); } });
    await assert.rejects(client.createEvent({ idempotencyKey: "same", summary: "Call", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, sendUpdates: "none" }), { code: "calendar_idempotency_payload_mismatch" });
  });
});

test("attendee booking requires an explicit notification policy", async () => {
  const client = createGoogleCalendarClient({ env: ENV, store: memoryStore(), now: () => NOW, fetchImpl: async () => { throw new Error("no call"); } });
  await assert.rejects(client.createEvent({ idempotencyKey: "guest", summary: "Call", start: "2026-08-17T16:00:00Z", end: "2026-08-17T16:30:00Z", workHours: HOURS, attendeeEmail: "guest@example.com" }), { code: "calendar_send_updates_required" });
});

test("Google event IDs are stable and API-safe", () => {
  assert.equal(googleEventId("same-key"), googleEventId("same-key"));
  assert.match(googleEventId("same-key"), /^[a-v0-9]{5,1024}$/);
  assert.throws(() => googleEventId(""), CalendarClientError);
});
