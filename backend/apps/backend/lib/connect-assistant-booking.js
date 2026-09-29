"use strict";

/**
 * A narrow, flag-gated booking seam in front of the existing AI takeover.
 *
 * The old assistant remains the fallback authority. This module only takes a
 * turn when all of the following are true: the feature flag is on, this exact
 * tenant has an active Google Calendar connector, its site publishes hours we
 * can parse without guessing, and the visitor is explicitly booking or choosing
 * a slot we previously offered. Every other path delegates with the caller's
 * original object unchanged.
 */

const { createHash } = require("node:crypto");
const { createGoogleCalendarClient } = require("./connect-calendar");
const { scheduleAiTakeover: defaultScheduleAiTakeover } = require("./connect-ai-takeover");
const { siteKb: defaultSiteKb } = require("./connect-site-kb");
const { conditionalUpdate: defaultConditionalUpdate, insertRow: defaultInsertRow, select: defaultSelect } = require("./store");

const CALENDAR_PLATFORM = "google_calendar";
const CALENDAR_SOURCE = "google_calendar_booking";
const AI_SOURCE = "ai_assistant";
const MAX_MESSAGES = 80;
const SLOT_LIMIT = 6;
const OFFER_TTL_MS = 15 * 60 * 1000;
const TERMINAL_BOOKING_STATES = new Set(["confirmed", "not_confirmed"]);
const DAY_INDEX = Object.freeze({
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
});

const clean = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function enabled(env = process.env) {
  return Boolean(env && env.CONNECT_CALENDAR_BOOKING_ENABLED === "true");
}

function readRows(result) {
  if (result && result.ok === true && Array.isArray(result.data)) return result.data;
  if (result && result.mode === "live_select" && Array.isArray(result.rows)) return result.rows;
  return null;
}

function deterministicUuid(namespace, value) {
  const hex = createHash("sha256").update(`${namespace}:${value}`).digest("hex");
  const variant = "89ab"[parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function bookingIntent(body) {
  return /\b(?:book|booking|schedule|appointment|available|availability|open slots?|reserve|set up (?:a )?(?:visit|call|estimate))\b/i.test(clean(body, 5000));
}

function dayRequested(body) {
  const text = clean(body, 5000).toLowerCase();
  if (/\btomorrow\b/.test(text)) return { relativeDays: 1 };
  for (const [day, index] of Object.entries(DAY_INDEX)) {
    if (new RegExp(`\\b${day}(?:s)?\\b|\\b${day.slice(0, 3)}\\b`, "i").test(text)) return { weekday: index };
  }
  return null;
}

function slotSelection(body, slots) {
  const text = clean(body, 5000).toLowerCase();
  const ordinal = /\b(?:option|slot|time)?\s*(1|2|3|4|5|6)\b/.exec(text);
  const words = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5 };
  let index = ordinal ? Number(ordinal[1]) - 1 : -1;
  if (index < 0) {
    for (const [word, value] of Object.entries(words)) {
      if (new RegExp(`\\b${word}(?: one| option| slot)?\\b`).test(text)) { index = value; break; }
    }
  }
  if (index >= 0 && index < slots.length) return slots[index];
  return null;
}

function parseClock(text) {
  const match = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(clean(text, 100));
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (hour === 12) hour = 0;
  if (match[3].toLowerCase() === "pm") hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function publishedWorkHours(hours) {
  const out = {};
  for (const row of Array.isArray(hours) ? hours : []) {
    const day = clean(row && row.day, 20).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(DAY_INDEX, day)) continue;
    const text = clean(row && row.text, 100);
    if (!text || /\bclosed\b/i.test(text) || /\b24\s*hours?\b/i.test(text)) continue;
    const ranges = text.split(/\s*(?:,|;|\band\b)\s*/i).flatMap((part) => {
      const pair = part.split(/\s*(?:-|–|—|to)\s*/i);
      if (pair.length !== 2) return [];
      const start = parseClock(pair[0]);
      const end = parseClock(pair[1]);
      return start && end ? [{ start, end }] : [];
    });
    if (ranges.length) out[day] = ranges;
  }
  return Object.keys(out).length ? out : null;
}

function contactFrom(messages, thread) {
  const transcript = (Array.isArray(messages) ? messages : [])
    .filter((row) => row && row.direction === "inbound")
    .map((row) => clean(row.body, 5000)).join("\n");
  const emails = transcript.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  const phones = transcript.match(/(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g) || [];
  const explicitlyLabeled = /\b(?:my name is|name\s*[:=-])\s*([a-z][a-z'\-]+(?:\s+[a-z][a-z'\-]+){0,2})\b/i.exec(transcript);
  const conversational = /\b(?:I am|I'm|i am|i'm|This is|this is)\s+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){0,1})\b/.exec(transcript);
  const storedName = clean(thread && thread.contact_name, 100);
  const storedContact = clean(thread && thread.contact_info, 320);
  const email = clean(emails.pop() || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(storedContact) ? storedContact : ""), 320).toLowerCase();
  const phone = clean(phones.pop() || (!storedContact.includes("@") ? storedContact : ""), 40);
  const plausibleName = (value, explicit = false) => {
    const candidate = clean(value, 100).replace(/[.,;:]+$/, "");
    const words = candidate.toLowerCase().split(/\s+/).filter(Boolean);
    const refused = new Set([
      "available", "free", "ready", "looking", "want", "need", "booking", "book", "schedule",
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
      "today", "tomorrow", "phone", "email", "calling", "interested",
    ]);
    if (!words.length || words.length > 3 || words.some((word) => refused.has(word))) return "";
    if (!words.every((word) => /^[a-z][a-z'\-]{0,39}$/i.test(word))) return "";
    return explicit || words.length <= 2 ? candidate : "";
  };
  const parsedName = explicitlyLabeled
    ? plausibleName(explicitlyLabeled[1], true)
    : plausibleName(conversational && conversational[1], false);
  const name = clean(parsedName || (storedName.toLowerCase() !== "website visitor" ? storedName : ""), 100);
  return { name, phone, email };
}

function requestedSlotFilter(requested, now, timeZone) {
  if (!requested) return () => true;
  const wantedDate = requested.relativeDays
    ? new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(now.getTime() + requested.relativeDays * 86400000))
    : "";
  return (slot) => {
    const date = new Date(slot.start);
    if (wantedDate) {
      const actual = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      return actual === wantedDate;
    }
    if (Number.isInteger(requested.weekday)) {
      const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date).toLowerCase();
      return DAY_INDEX[label] === requested.weekday;
    }
    return true;
  };
}

function slotLabel(slot, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(slot.start));
}

function connectorConfiguration(row) {
  const metadata = isObject(row && row.metadata) ? row.metadata : {};
  const calendarId = clean(metadata.calendar_id || row && row.platform_user_id, 500);
  const timeZone = clean(metadata.time_zone, 100);
  if (!calendarId || !timeZone) return null;
  return { calendarId, timeZone, metadata };
}

async function readThreadAndMessages({ threadId, siteSlug, thread }, select) {
  let row = thread;
  if (!row || clean(row.site_slug, 80) !== clean(siteSlug, 80)) {
    const rows = readRows(await select("connect_threads", [
      "select=id,site_slug,channel,contact_name,contact_info,meta",
      `id=eq.${encodeURIComponent(clean(threadId, 40))}`,
      `site_slug=eq.${encodeURIComponent(clean(siteSlug, 80))}`,
      "channel=eq.chat",
      "limit=1",
    ].join("&")));
    if (!rows) throw new Error("calendar_thread_unavailable");
    row = rows[0] || null;
  }
  if (!row || clean(row.site_slug, 80) !== clean(siteSlug, 80)) return null;
  const messages = readRows(await select("connect_messages", [
    "select=id,thread_id,direction,body,meta,client_message_id,created_at",
    `thread_id=eq.${encodeURIComponent(clean(threadId, 40))}`,
    "order=id.asc",
    `limit=${MAX_MESSAGES}`,
  ].join("&")));
  if (!messages) throw new Error("calendar_messages_unavailable");
  return { thread: row, messages };
}

async function readConnector(siteSlug, select) {
  const rows = readRows(await select("connect_connectors", [
    "select=id,site_slug,platform,is_active,account_name,platform_user_id,access_token,token_expires_at,metadata",
    `site_slug=eq.${encodeURIComponent(siteSlug)}`,
    `platform=eq.${CALENDAR_PLATFORM}`,
    "is_active=eq.true",
    "limit=1",
  ].join("&")));
  if (!rows) throw new Error("calendar_connector_unavailable");
  return rows[0] || null;
}

function bookingRecord(meta) {
  const booking = isObject(meta && meta.calendar_booking) ? meta.calendar_booking : {};
  return {
    fingerprint: clean(booking.fingerprint, 100), eventId: clean(booking.event_id, 100),
    status: clean(booking.status, 30), htmlLink: clean(booking.html_link, 2000) || null,
    start: clean(booking.start, 50), end: clean(booking.end, 50),
  };
}

function createTenantCalendarStore({ connector, threadId, select, insertRow, conditionalUpdate, reconciliation }) {
  const metadata = isObject(connector.metadata) ? connector.metadata : {};
  return {
    async getToken() {
      return {
        accessToken: clean(connector.access_token, 4096),
        refreshToken: clean(metadata.refresh_token, 4096),
        expiresAt: clean(connector.token_expires_at, 50),
      };
    },
    async saveToken(token) {
      const result = await conditionalUpdate("connect_connectors", "id", connector.id, {
        site_slug: `eq.${connector.site_slug}`,
        platform: `eq.${CALENDAR_PLATFORM}`,
      }, {
        access_token: token.accessToken,
        token_expires_at: token.expiresAt,
        metadata: { ...metadata, refresh_token: token.refreshToken || metadata.refresh_token || null },
        updated_at: new Date().toISOString(),
      });
      if (!result || result.ok !== true || result.updated !== true) throw new Error("calendar_token_save_failed");
    },
    async claimBooking({ key, fingerprint, eventId, startedAt }) {
      const clientMessageId = deterministicUuid("connect-calendar-event", key);
      const inserted = await insertRow("connect_messages", {
        thread_id: threadId,
        direction: "system",
        body: "[calendar booking pending]",
        client_message_id: clientMessageId,
        meta: { source: CALENDAR_SOURCE, state: "pending", calendar_booking: { state: "pending", key_hash: createHash("sha256").update(key).digest("hex"), fingerprint, event_id: eventId, status: "pending", started_at: startedAt } },
      });
      if (inserted && inserted.mode === "live_write") return { record: null };
      const rows = readRows(await select("connect_messages", `select=id,meta&thread_id=eq.${threadId}&client_message_id=eq.${clientMessageId}&limit=1`));
      if (!rows || !rows[0]) throw new Error("calendar_booking_claim_failed");
      return { record: bookingRecord(rows[0].meta) };
    },
    async completeBooking({ key, fingerprint, eventId, status, htmlLink, start, end, timeZone, completedAt }) {
      const clientMessageId = deterministicUuid("connect-calendar-event", key);
      const rows = readRows(await select("connect_messages", `select=id,meta&thread_id=eq.${threadId}&client_message_id=eq.${clientMessageId}&limit=1`));
      if (!rows || !rows[0]) throw new Error("calendar_booking_claim_missing");
      const current = rows[0];
      let result = null;
      try {
        result = await conditionalUpdate("connect_messages", "id", current.id, {
          direction: "eq.system",
          "meta->>source": `eq.${CALENDAR_SOURCE}`,
        }, {
          meta: { source: CALENDAR_SOURCE, state: "confirmed", calendar_booking: { state: "confirmed", fingerprint, event_id: eventId, status, html_link: htmlLink || null, start, end, time_zone: timeZone, completed_at: completedAt } },
        });
      } catch {
        result = null;
      }
      if (!result || result.ok !== true || result.updated !== true) {
        // Google has already returned a confirmed event at this point. Do not
        // throw back into a path that could tell the visitor it was unbooked.
        // The pending claim carries eventId + fingerprint for reconciliation;
        // add a second terminal marker when the store still accepts inserts.
        reconciliation.syncPending = true;
        await Promise.resolve(insertRow("connect_messages", {
          thread_id: threadId,
          direction: "system",
          body: "[calendar booking confirmed; Connect sync pending]",
          client_message_id: deterministicUuid("connect-calendar-reconcile", key),
          meta: { source: CALENDAR_SOURCE, state: "confirmed", calendar_booking: { state: "confirmed", fingerprint, event_id: eventId, status, html_link: htmlLink || null, start, end, time_zone: timeZone, completed_at: completedAt, sync_pending: true } },
        })).catch(() => {});
      }
    },
  };
}

async function writeAssistantMessage({ thread, answeringMessageId, kind, body, meta = {} }, deps) {
  const clientMessageId = deterministicUuid(`connect-calendar-reply:${kind}`, `${thread.id}:${answeringMessageId}`);
  const inserted = await deps.insertRow("connect_messages", {
    thread_id: thread.id,
    direction: "outbound",
    body,
    client_message_id: clientMessageId,
    delivery_status: "completed",
    delivery_attempts: 1,
    delivery_first_attempt_at: deps.now().toISOString(),
    delivery_last_attempt_at: deps.now().toISOString(),
    delivery_completed_at: deps.now().toISOString(),
    meta: { source: AI_SOURCE, state: "sent", delivered: "deterministic_calendar", calendar_booking: meta },
  });
  if (inserted && inserted.mode === "live_write") return { written: true, idempotent: false };
  const rows = readRows(await deps.select("connect_messages", `select=id,body,meta&thread_id=eq.${thread.id}&client_message_id=eq.${clientMessageId}&limit=1`));
  if (rows && rows[0] && clean(rows[0].body, 5000) === body) return { written: false, idempotent: true };
  throw new Error("calendar_reply_write_failed");
}

function lastCalendarOffer(messages, nowMs) {
  for (const row of [...(Array.isArray(messages) ? messages : [])].reverse()) {
    const booking = isObject(row && row.meta) && isObject(row.meta.calendar_booking)
      ? row.meta.calendar_booking : null;
    if (!booking) continue;
    const state = clean(booking.state, 40);
    if (TERMINAL_BOOKING_STATES.has(state)) return null;
    if (row.direction !== "outbound" || !["slots_offered", "contact_required"].includes(state)) continue;
    if (!Array.isArray(booking.slots) || !clean(booking.answering_message_id, 40)) return null;
    const offeredAt = Date.parse(clean(booking.offered_at, 50));
    if (!Number.isFinite(offeredAt) || nowMs - offeredAt < 0 || nowMs - offeredAt > OFFER_TTL_MS) return null;
    return row;
  }
  return null;
}

async function updateConfirmedThread(thread, contact, booking, deps) {
  const previous = isObject(thread.meta) ? thread.meta : {};
  const result = await deps.conditionalUpdate("connect_threads", "id", thread.id, {
    site_slug: `eq.${thread.site_slug}`,
  }, {
    contact_name: contact.name,
    contact_info: contact.email || contact.phone,
    meta: {
      ...previous,
      lead: { ...(isObject(previous.lead) ? previous.lead : {}), capturedBy: AI_SOURCE, capturedAt: deps.now().toISOString(), name: contact.name, phone: contact.phone, email: contact.email },
      booking: { source: CALENDAR_SOURCE, state: "confirmed", eventId: booking.eventId, start: booking.start, end: booking.end, timeZone: booking.timeZone, confirmedAt: deps.now().toISOString() },
    },
  });
  if (!result || result.ok !== true || result.updated !== true) throw new Error("calendar_thread_truth_write_failed");
}

async function tryCalendarBooking(args, deps) {
  const state = await readThreadAndMessages(args, deps.select);
  if (!state) return { handled: false, reason: "thread_not_found" };
  const latestInbound = [...state.messages].reverse().find((row) => row && row.direction === "inbound");
  if (!latestInbound) return { handled: false, reason: "no_inbound_message" };
  const now = deps.now();
  const priorOffer = lastCalendarOffer(state.messages, now.getTime());
  if (!priorOffer && !bookingIntent(latestInbound.body)) return { handled: false, reason: "not_booking_intent" };

  const connector = await readConnector(clean(args.siteSlug, 80), deps.select);
  const config = connectorConfiguration(connector);
  if (!connector || !config) return { handled: false, reason: "calendar_not_connected" };
  const kb = await deps.siteKb(clean(args.siteSlug, 80));
  const workHours = publishedWorkHours(kb && kb.hours);
  if (!workHours) return { handled: false, reason: "published_hours_unavailable" };

  const reconciliation = { syncPending: false };
  const calendarStore = createTenantCalendarStore({
    connector, threadId: state.thread.id, select: deps.select,
    insertRow: deps.insertRow, conditionalUpdate: deps.conditionalUpdate,
    reconciliation,
  });
  const calendar = deps.createCalendarClient({
    env: { ...deps.env, GOOGLE_CALENDAR_ID: config.calendarId, GOOGLE_CALENDAR_TIMEZONE: config.timeZone },
    store: calendarStore, now: deps.now,
  });

  if (priorOffer) {
    const offered = priorOffer.meta.calendar_booking.slots.filter((slot) => slot && slot.start && slot.end).slice(0, SLOT_LIMIT);
    const selected = priorOffer.meta.calendar_booking.state === "contact_required"
      ? priorOffer.meta.calendar_booking.selected_slot
      : slotSelection(latestInbound.body, offered);
    if (selected) {
      const contact = contactFrom(state.messages, state.thread);
      const missing = [!contact.name && "name", !contact.phone && "phone", !contact.email && "email"].filter(Boolean);
      if (missing.length) {
        const body = `I can hold that exact time after I have your ${missing.join(", ")}. Please send ${missing.length === 1 ? "it" : "them"} here.`;
        await writeAssistantMessage({ thread: state.thread, answeringMessageId: latestInbound.id, kind: "contact", body, meta: { state: "contact_required", slots: offered, selected_slot: selected, missing, offered_at: priorOffer.meta.calendar_booking.offered_at, answering_message_id: priorOffer.meta.calendar_booking.answering_message_id } }, deps);
        return { handled: true, generate: false, reason: "calendar_contact_required" };
      }
      const businessName = clean(kb && kb.business && kb.business.name && kb.business.name.value, 200) || "Service";
      const idempotencyKey = `connect:${state.thread.site_slug}:${state.thread.id}:${priorOffer.id}:${selected.start}`;
      let created;
      try {
        created = await calendar.createEvent({
          idempotencyKey,
          calendarId: config.calendarId,
          timeZone: config.timeZone,
          workHours,
          summary: `${businessName} appointment — ${contact.name}`,
          start: selected.start,
          end: selected.end,
          attendeeEmail: contact.email,
          sendUpdates: "all",
          description: `Customer: ${contact.name}\nPhone: ${contact.phone}\nEmail: ${contact.email}\nConnect thread: ${state.thread.id}`,
        });
      } catch {
        const body = "I couldn't confirm that time on the calendar, so it is not booked. Please choose another time or ask for a callback.";
        await writeAssistantMessage({ thread: state.thread, answeringMessageId: latestInbound.id, kind: "failed", body, meta: { state: "not_confirmed", selected_slot: selected } }, deps);
        return { handled: true, generate: false, reason: "calendar_not_confirmed" };
      }
      if (!created || created.confirmed !== true || !created.eventId) {
        const body = "I couldn't confirm that time on the calendar, so it is not booked. Please choose another time or ask for a callback.";
        await writeAssistantMessage({ thread: state.thread, answeringMessageId: latestInbound.id, kind: "failed", body, meta: { state: "not_confirmed", selected_slot: selected } }, deps);
        return { handled: true, generate: false, reason: "calendar_not_confirmed" };
      }
      let syncPending = reconciliation.syncPending;
      try {
        await updateConfirmedThread(state.thread, contact, created, deps);
      } catch {
        syncPending = true;
      }
      const body = `Booked and confirmed for ${slotLabel(created, config.timeZone)}. Google Calendar created the event, and an invitation was requested for ${contact.email}.`;
      try {
        await writeAssistantMessage({ thread: state.thread, answeringMessageId: latestInbound.id, kind: "confirmed", body, meta: { state: "confirmed", event_id: created.eventId, html_link: created.htmlLink || null, start: created.start, end: created.end, time_zone: created.timeZone, sync_pending: syncPending } }, deps);
      } catch {
        syncPending = true;
      }
      return { handled: true, generate: false, reason: syncPending ? "calendar_booked_sync_pending" : "calendar_booked", booked: true, confirmed: true, eventId: created.eventId, syncPending };
    }
  }

  const result = await calendar.findAvailableSlots({
    calendarId: config.calendarId,
    timeZone: config.timeZone,
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 9 * 86400000).toISOString(),
    durationMinutes: 30,
    slotStepMinutes: 30,
    workHours,
    limit: 50,
  });
  if (!result || result.ok !== true || !Array.isArray(result.slots)) return { handled: false, reason: "calendar_unavailable" };
  const requested = dayRequested(latestInbound.body);
  const offered = result.slots.filter(requestedSlotFilter(requested, now, config.timeZone)).slice(0, 3);
  if (!offered.length) return { handled: false, reason: "calendar_no_matching_slots" };
  const lines = offered.map((slot, index) => `${index + 1}. ${slotLabel(slot, config.timeZone)}`);
  const body = `These times are open on the live calendar:\n${lines.join("\n")}\nReply with the option number and your name, phone, and email. Nothing is booked until I confirm it here.`;
  await writeAssistantMessage({ thread: state.thread, answeringMessageId: latestInbound.id, kind: "offer", body, meta: { state: "slots_offered", slots: offered, time_zone: config.timeZone, offered_at: now.toISOString(), answering_message_id: clean(latestInbound.id, 40) } }, deps);
  return { handled: true, generate: false, reason: "calendar_slots_offered", slots: offered };
}

async function scheduleAssistantBooking(args = {}, overrides = {}) {
  const schedule = overrides.scheduleAiTakeover || defaultScheduleAiTakeover;
  const env = overrides.env || process.env;
  // This branch is deliberately first. It imports no calendar data, reads no
  // store row, and passes the exact original object to the old scheduler.
  if (!enabled(env)) return schedule(args);
  const deps = {
    env,
    select: overrides.select || defaultSelect,
    insertRow: overrides.insertRow || defaultInsertRow,
    conditionalUpdate: overrides.conditionalUpdate || defaultConditionalUpdate,
    siteKb: overrides.siteKb || defaultSiteKb,
    createCalendarClient: overrides.createCalendarClient || createGoogleCalendarClient,
    now: overrides.now || (() => new Date()),
  };
  try {
    const result = await tryCalendarBooking(args, deps);
    if (result && result.handled === true) return result;
  } catch {
    // Calendar cannot make the base chat unavailable. Existing Calendly or
    // capture-only behavior is the fail-closed fallback.
  }
  return schedule(args);
}

module.exports = {
  scheduleAssistantBooking,
  _test: {
    bookingIntent,
    contactFrom,
    dayRequested,
    deterministicUuid,
    enabled,
    lastCalendarOffer,
    OFFER_TTL_MS,
    publishedWorkHours,
    slotSelection,
    tryCalendarBooking,
  },
};
