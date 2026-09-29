"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { scheduleAssistantBooking, _test } = require("../lib/connect-assistant-booking");

const ARGS = Object.freeze({ threadId: "41", siteSlug: "acme-plumbing", thread: null });
const NOW = new Date("2026-08-17T15:00:00.000Z");
const SLOT = Object.freeze({
  start: "2026-08-18T16:00:00.000Z",
  end: "2026-08-18T16:30:00.000Z",
  timeZone: "America/Los_Angeles",
});

function connector() {
  return {
    id: 9,
    site_slug: ARGS.siteSlug,
    platform: "google_calendar",
    is_active: true,
    platform_user_id: "primary",
    access_token: "server-only-token",
    token_expires_at: "2026-08-17T20:00:00.000Z",
    metadata: {
      refresh_token: "server-only-refresh",
      calendar_id: "primary",
      time_zone: "America/Los_Angeles",
    },
  };
}

function kb(bookingUrl = "") {
  return {
    ok: true,
    business: {
      name: { value: "Acme Plumbing" },
      bookingUrl: bookingUrl ? { value: bookingUrl } : null,
    },
    hours: [
      { day: "monday", text: "9:00 AM - 5:00 PM" },
      { day: "tuesday", text: "9:00 AM - 5:00 PM" },
    ],
  };
}

function selectFor({ messages, connected = true }) {
  return async (table) => {
    if (table === "connect_threads") {
      return { ok: true, data: [{ id: 41, site_slug: ARGS.siteSlug, channel: "chat", contact_name: "Website visitor", contact_info: null, meta: { source: "site_widget" } }] };
    }
    if (table === "connect_messages") return { ok: true, data: messages };
    if (table === "connect_connectors") return { ok: true, data: connected ? [connector()] : [] };
    throw new Error(`unexpected table ${table}`);
  };
}

test("flag OFF delegates once with the exact original object and makes zero calendar/store calls", async () => {
  const args = { threadId: "41", siteSlug: "acme-plumbing", thread: { id: 41 } };
  const calls = [];
  const result = await scheduleAssistantBooking(args, {
    env: { CONNECT_CALENDAR_BOOKING_ENABLED: "false" },
    scheduleAiTakeover: async (received) => { calls.push(received); return { generate: false, reason: "legacy" }; },
    select: async () => { throw new Error("store must not be read"); },
    insertRow: async () => { throw new Error("store must not be written"); },
    conditionalUpdate: async () => { throw new Error("store must not be written"); },
    siteKb: async () => { throw new Error("KB must not be read"); },
    createCalendarClient: () => { throw new Error("calendar must not be created"); },
  });

  assert.deepEqual(result, { generate: false, reason: "legacy" });
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0], args);
});

test("connected Google Calendar offers only real returned slots and does not call legacy takeover", async () => {
  const writes = [];
  const legacy = [];
  let availabilityInput;
  const result = await scheduleAssistantBooking(ARGS, {
    env: { CONNECT_CALENDAR_BOOKING_ENABLED: "true" },
    now: () => new Date(NOW),
    select: selectFor({ messages: [{ id: 100, direction: "inbound", body: "Can I book Tuesday?" }] }),
    siteKb: async () => kb("https://calendly.com/acme/estimate"),
    createCalendarClient: () => ({
      findAvailableSlots: async (input) => { availabilityInput = input; return { ok: true, slots: [SLOT] }; },
      createEvent: async () => { throw new Error("no slot was chosen"); },
    }),
    insertRow: async (table, row) => { writes.push({ table, row }); return { mode: "live_write", row: [{ id: 200 }] }; },
    conditionalUpdate: async () => { throw new Error("offering slots must not update lead truth"); },
    scheduleAiTakeover: async (args) => { legacy.push(args); return { reason: "legacy" }; },
  });

  assert.equal(result.reason, "calendar_slots_offered");
  assert.deepEqual(result.slots, [SLOT]);
  assert.equal(legacy.length, 0);
  assert.equal(availabilityInput.timeZone, "America/Los_Angeles");
  assert.deepEqual(availabilityInput.workHours.tuesday, [{ start: "09:00", end: "17:00" }]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].row.direction, "outbound");
  assert.match(writes[0].row.body, /live calendar/i);
  assert.match(writes[0].row.body, /Nothing is booked until I confirm it here\./);
  assert.equal(writes[0].row.meta.calendar_booking.state, "slots_offered");
  assert.deepEqual(writes[0].row.meta.calendar_booking.slots, [SLOT]);
});

test("a chosen slot becomes booked only after Google returns a confirmed event; lead and booking truth persist", async () => {
  const messages = [
    { id: 100, direction: "inbound", body: "Can I book Tuesday?" },
    { id: 101, direction: "outbound", body: "1. Tuesday", meta: { calendar_booking: { state: "slots_offered", slots: [SLOT], offered_at: NOW.toISOString(), answering_message_id: "100" } } },
    { id: 102, direction: "inbound", body: "Option 1. My name is Sam Doe. Phone 512-555-1212. Email sam@example.com" },
  ];
  const writes = [];
  const updates = [];
  let eventInput;
  const result = await scheduleAssistantBooking(ARGS, {
    env: { CONNECT_CALENDAR_BOOKING_ENABLED: "true" },
    now: () => new Date(NOW),
    select: selectFor({ messages }),
    siteKb: async () => kb(),
    createCalendarClient: () => ({
      findAvailableSlots: async () => { throw new Error("existing offer must be reused"); },
      createEvent: async (input) => {
        eventInput = input;
        return { ok: true, confirmed: true, eventId: "google-event-1", htmlLink: "https://calendar.google.com/event?eid=1", ...SLOT };
      },
    }),
    insertRow: async (table, row) => { writes.push({ table, row }); return { mode: "live_write", row: [{ id: 202 }] }; },
    conditionalUpdate: async (...args) => { updates.push(args); return { ok: true, updated: true, rows: [{}] }; },
    scheduleAiTakeover: async () => { throw new Error("confirmed Google path must not call legacy takeover"); },
  });

  assert.equal(result.booked, true);
  assert.equal(result.confirmed, true);
  assert.equal(result.eventId, "google-event-1");
  assert.equal(eventInput.attendeeEmail, "sam@example.com");
  assert.equal(eventInput.sendUpdates, "all");
  assert.match(eventInput.idempotencyKey, /connect:acme-plumbing:41:101:/);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], "connect_threads");
  assert.equal(updates[0][4].meta.booking.state, "confirmed");
  assert.equal(updates[0][4].meta.booking.eventId, "google-event-1");
  assert.equal(updates[0][4].meta.lead.email, "sam@example.com");
  assert.match(writes[0].row.body, /^Booked and confirmed/);
  assert.match(writes[0].row.body, /created the event/i);
  assert.match(writes[0].row.body, /invitation was requested/i);
  assert.doesNotMatch(writes[0].row.body, /confirmation was sent/i);
  assert.equal(writes[0].row.meta.calendar_booking.state, "confirmed");
});

test("a non-confirmed Calendar response truthfully says not booked and never persists booking truth", async () => {
  const messages = [
    { id: 100, direction: "inbound", body: "Can I book?" },
    { id: 101, direction: "outbound", body: "1. Tuesday", meta: { calendar_booking: { state: "slots_offered", slots: [SLOT], offered_at: NOW.toISOString(), answering_message_id: "100" } } },
    { id: 102, direction: "inbound", body: "Option 1. My name is Sam Doe. Phone 512-555-1212. Email sam@example.com" },
  ];
  const writes = [];
  const result = await scheduleAssistantBooking(ARGS, {
    env: { CONNECT_CALENDAR_BOOKING_ENABLED: "true" },
    now: () => new Date(NOW),
    select: selectFor({ messages }),
    siteKb: async () => kb(),
    createCalendarClient: () => ({
      findAvailableSlots: async () => ({ ok: true, slots: [] }),
      createEvent: async () => ({ ok: true, confirmed: false }),
    }),
    insertRow: async (table, row) => { writes.push({ table, row }); return { mode: "live_write", row: [{ id: 203 }] }; },
    conditionalUpdate: async () => { throw new Error("unconfirmed event must not update thread truth"); },
    scheduleAiTakeover: async () => { throw new Error("truthful failure is handled in Calendar seam"); },
  });

  assert.equal(result.reason, "calendar_not_confirmed");
  assert.equal(result.booked, undefined);
  assert.match(writes[0].row.body, /it is not booked/i);
  assert.doesNotMatch(writes[0].row.body, /^Booked and confirmed/);
  assert.equal(writes[0].row.meta.calendar_booking.state, "not_confirmed");
});

test("disconnected Google falls through unchanged so existing Calendly or capture-only behavior remains authoritative", async () => {
  for (const fallback of ["calendly", "capture-only"]) {
    const args = { ...ARGS, fallback };
    const calls = [];
    const result = await scheduleAssistantBooking(args, {
      env: { CONNECT_CALENDAR_BOOKING_ENABLED: "true" },
      select: selectFor({ connected: false, messages: [{ id: 100, direction: "inbound", body: "I want to book" }] }),
      siteKb: async () => { throw new Error("disconnected path must leave bookingUrl/capture lookup to legacy assistant"); },
      createCalendarClient: () => { throw new Error("disconnected path must make zero Google calls"); },
      insertRow: async () => { throw new Error("disconnected path must make zero new writes"); },
      conditionalUpdate: async () => { throw new Error("disconnected path must make zero new writes"); },
      scheduleAiTakeover: async (received) => { calls.push(received); return { generate: false, reason: fallback }; },
    });
    assert.equal(result.reason, fallback);
    assert.equal(calls.length, 1);
    assert.strictEqual(calls[0], args);
  }
});

test("published hours parser rejects guesses and keeps only literal day ranges", () => {
  assert.deepEqual(_test.publishedWorkHours([
    { day: "monday", text: "9:00 AM - 5:00 PM" },
    { day: "tuesday", text: "Closed" },
    { day: "", text: "Usually mornings" },
  ]), { monday: [{ start: "09:00", end: "17:00" }] });
  assert.equal(_test.publishedWorkHours([{ day: "monday", text: "By appointment" }]), null);
});

test("offers expire after 15 minutes and a later terminal state cannot reopen old slots", async () => {
  const stale = { id: 101, direction: "outbound", meta: { calendar_booking: { state: "slots_offered", slots: [SLOT], offered_at: new Date(NOW.getTime() - _test.OFFER_TTL_MS - 1).toISOString(), answering_message_id: "100" } } };
  assert.equal(_test.lastCalendarOffer([stale], NOW.getTime()), null);
  const fresh = { ...stale, meta: { calendar_booking: { ...stale.meta.calendar_booking, offered_at: NOW.toISOString() } } };
  const terminal = { id: 102, direction: "outbound", meta: { calendar_booking: { state: "not_confirmed" } } };
  assert.strictEqual(_test.lastCalendarOffer([fresh], NOW.getTime()), fresh);
  assert.equal(_test.lastCalendarOffer([fresh, terminal], NOW.getTime()), null);

  let created = 0;
  let delegated = 0;
  await scheduleAssistantBooking(ARGS, {
    env: { CONNECT_CALENDAR_BOOKING_ENABLED: "true" }, now: () => new Date(NOW),
    select: selectFor({ messages: [{ id: 100, direction: "inbound", body: "Can I book?" }, stale, { id: 103, direction: "inbound", body: "Option 1" }] }),
    siteKb: async () => kb(),
    createCalendarClient: () => ({ createEvent: async () => { created += 1; }, findAvailableSlots: async () => ({ ok: true, slots: [] }) }),
    insertRow: async () => { throw new Error("expired option must not write"); },
    conditionalUpdate: async () => { throw new Error("expired option must not update"); },
    scheduleAiTakeover: async () => { delegated += 1; return { reason: "legacy" }; },
  });
  assert.equal(created, 0);
  assert.equal(delegated, 1);
});

test("generic I'm prose is not inferred as a customer name", () => {
  assert.deepEqual(_test.contactFrom([
    { direction: "inbound", body: "I'm available Tuesday. Phone 512-555-1212. Email sam@example.com" },
  ], { contact_name: "Website visitor", contact_info: null }), {
    name: "", phone: "512-555-1212", email: "sam@example.com",
  });
  assert.equal(_test.contactFrom([{ direction: "inbound", body: "I'm Sam Doe" }], {}).name, "Sam Doe");
  assert.equal(_test.contactFrom([{ direction: "inbound", body: "My name is sam doe" }], {}).name, "sam doe");
});

test("after Google confirms, thread sync failure stays handled and never falls through to Calendly or capture", async () => {
  const messages = [
    { id: 100, direction: "inbound", body: "Can I book?" },
    { id: 101, direction: "outbound", body: "1. Tuesday", meta: { calendar_booking: { state: "slots_offered", slots: [SLOT], offered_at: NOW.toISOString(), answering_message_id: "100" } } },
    { id: 102, direction: "inbound", body: "Option 1. My name is Sam Doe. Phone 512-555-1212. Email sam@example.com" },
  ];
  const writes = [];
  let delegated = 0;
  const result = await scheduleAssistantBooking(ARGS, {
    env: { CONNECT_CALENDAR_BOOKING_ENABLED: "true" }, now: () => new Date(NOW),
    select: selectFor({ messages }), siteKb: async () => kb("https://calendly.com/acme/estimate"),
    createCalendarClient: () => ({
      findAvailableSlots: async () => ({ ok: true, slots: [] }),
      createEvent: async () => ({ ok: true, confirmed: true, eventId: "google-event-durable", ...SLOT }),
    }),
    conditionalUpdate: async () => { throw new Error("thread store temporarily unavailable"); },
    insertRow: async (table, row) => { writes.push({ table, row }); return { mode: "live_write", row: [{ id: 300 }] }; },
    scheduleAiTakeover: async () => { delegated += 1; return { reason: "legacy" }; },
  });
  assert.equal(result.booked, true);
  assert.equal(result.confirmed, true);
  assert.equal(result.syncPending, true);
  assert.equal(result.reason, "calendar_booked_sync_pending");
  assert.equal(delegated, 0);
  assert.match(writes.at(-1).row.body, /created the event/i);
  assert.match(writes.at(-1).row.body, /invitation was requested/i);
});

test("after Google confirms, reply persistence failure is handled as sync-pending without a legacy double-answer", async () => {
  const messages = [
    { id: 100, direction: "inbound", body: "Can I book?" },
    { id: 101, direction: "outbound", body: "1. Tuesday", meta: { calendar_booking: { state: "slots_offered", slots: [SLOT], offered_at: NOW.toISOString(), answering_message_id: "100" } } },
    { id: 102, direction: "inbound", body: "Option 1. My name is Sam Doe. Phone 512-555-1212. Email sam@example.com" },
  ];
  let delegated = 0;
  const result = await scheduleAssistantBooking(ARGS, {
    env: { CONNECT_CALENDAR_BOOKING_ENABLED: "true" }, now: () => new Date(NOW),
    select: selectFor({ messages }), siteKb: async () => kb(),
    createCalendarClient: () => ({
      findAvailableSlots: async () => ({ ok: true, slots: [] }),
      createEvent: async () => ({ ok: true, confirmed: true, eventId: "google-event-reply-pending", ...SLOT }),
    }),
    conditionalUpdate: async () => ({ ok: true, updated: true, rows: [{}] }),
    insertRow: async () => { throw new Error("reply store temporarily unavailable"); },
    scheduleAiTakeover: async () => { delegated += 1; return { reason: "legacy" }; },
  });
  assert.equal(result.booked, true);
  assert.equal(result.confirmed, true);
  assert.equal(result.syncPending, true);
  assert.equal(result.reason, "calendar_booked_sync_pending");
  assert.equal(delegated, 0);
});
