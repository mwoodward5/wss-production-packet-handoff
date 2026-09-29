"use strict";

const { createHash } = require("node:crypto");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_WINDOW_DAYS = 31;
const WEEKDAY = Object.freeze({ sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 });

class CalendarClientError extends Error {
  constructor(code, { retryable = false, status = 0 } = {}) {
    super(code);
    this.name = "CalendarClientError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function calendarBookingEnabled(env = process.env) {
  return env && env.CONNECT_CALENDAR_BOOKING_ENABLED === "true";
}

function parseInstant(value, code) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new CalendarClientError(code);
  return date;
}

function assertTimeZone(timeZone) {
  const value = clean(timeZone, 100);
  if (!value) throw new CalendarClientError("calendar_timezone_required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new CalendarClientError("calendar_timezone_invalid");
  }
  return value;
}

function boundedInteger(value, { min, max, fallback, code }) {
  const parsed = Number(value == null ? fallback : value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new CalendarClientError(code);
  return Math.floor(parsed);
}

function datePartsAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
    weekday: WEEKDAY[String(parts.weekday || "").slice(0, 3).toLowerCase()],
  };
}

function dateKey(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(clean(value, 5));
  if (!match) throw new CalendarClientError("calendar_work_hours_invalid");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new CalendarClientError("calendar_work_hours_invalid");
  return { hour, minute, total: hour * 60 + minute };
}

function zonedLocalToInstant(day, clock, timeZone) {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!dayMatch) return null;
  const target = Date.UTC(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]), clock.hour, clock.minute, 0);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = datePartsAt(new Date(guess), timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const delta = target - represented;
    guess += delta;
    if (delta === 0) break;
  }
  const check = datePartsAt(new Date(guess), timeZone);
  if (dateKey(check) !== day || check.hour !== clock.hour || check.minute !== clock.minute) return null;
  return guess;
}

function normalizeWorkHours(workHours) {
  if (!workHours || typeof workHours !== "object" || Array.isArray(workHours)) {
    throw new CalendarClientError("calendar_work_hours_required");
  }
  const normalized = new Map();
  for (const [rawDay, rawRanges] of Object.entries(workHours)) {
    const day = WEEKDAY[rawDay.toLowerCase()];
    if (!Number.isInteger(day)) throw new CalendarClientError("calendar_work_hours_invalid");
    const ranges = Array.isArray(rawRanges) ? rawRanges : [rawRanges];
    const parsed = ranges.map((range) => {
      if (!range || typeof range !== "object") throw new CalendarClientError("calendar_work_hours_invalid");
      const start = parseClock(range.start);
      const end = parseClock(range.end);
      if (end.total <= start.total) throw new CalendarClientError("calendar_work_hours_invalid");
      return { start, end };
    }).sort((a, b) => a.start.total - b.start.total);
    normalized.set(day, parsed);
  }
  if (![...normalized.values()].some((ranges) => ranges.length)) {
    throw new CalendarClientError("calendar_work_hours_required");
  }
  return normalized;
}

function localDateKeys(timeMinMs, timeMaxMs, timeZone) {
  const keys = new Set();
  const first = Math.floor((timeMinMs - 86400000) / 86400000) * 86400000;
  const last = timeMaxMs + 86400000;
  for (let cursor = first; cursor <= last; cursor += 86400000) {
    keys.add(dateKey(datePartsAt(new Date(cursor + 43200000), timeZone)));
  }
  return [...keys].sort();
}

function busyOverlaps(busy, start, end) {
  return busy.some((period) => period.start < end && period.end > start);
}

function computeAvailableSlots({ timeMin, timeMax, timeZone, durationMinutes, slotStepMinutes, workHours, busy, now = new Date(), limit = 50 }) {
  const zone = assertTimeZone(timeZone);
  const startWindow = parseInstant(timeMin, "calendar_time_min_invalid").getTime();
  const endWindow = parseInstant(timeMax, "calendar_time_max_invalid").getTime();
  if (endWindow <= startWindow || endWindow - startWindow > MAX_WINDOW_DAYS * 86400000) {
    throw new CalendarClientError("calendar_window_invalid");
  }
  const duration = boundedInteger(durationMinutes, { min: 5, max: 480, code: "calendar_duration_invalid" });
  const step = boundedInteger(slotStepMinutes, { min: 5, max: 240, fallback: duration, code: "calendar_slot_step_invalid" });
  const maxSlots = boundedInteger(limit, { min: 1, max: 100, fallback: 50, code: "calendar_slot_limit_invalid" });
  const hours = normalizeWorkHours(workHours);
  const nowMs = parseInstant(now, "calendar_now_invalid").getTime();
  const durationMs = duration * 60000;
  const stepMs = step * 60000;
  const periods = (Array.isArray(busy) ? busy : []).flatMap((period) => {
    try {
      const start = parseInstant(period && period.start, "calendar_busy_invalid").getTime();
      const end = parseInstant(period && period.end, "calendar_busy_invalid").getTime();
      return end > start ? [{ start, end }] : [];
    } catch {
      throw new CalendarClientError("calendar_busy_invalid");
    }
  });
  const slots = [];
  for (const day of localDateKeys(startWindow, endWindow, zone)) {
    const noon = zonedLocalToInstant(day, { hour: 12, minute: 0 }, zone);
    if (noon == null) continue;
    const weekday = datePartsAt(new Date(noon), zone).weekday;
    for (const range of hours.get(weekday) || []) {
      const rangeStart = zonedLocalToInstant(day, range.start, zone);
      const rangeEnd = zonedLocalToInstant(day, range.end, zone);
      if (rangeStart == null || rangeEnd == null) continue;
      const lower = Math.max(rangeStart, startWindow, nowMs);
      let cursor = rangeStart + Math.ceil(Math.max(0, lower - rangeStart) / stepMs) * stepMs;
      const upper = Math.min(rangeEnd, endWindow);
      for (; cursor + durationMs <= upper; cursor += stepMs) {
        if (!busyOverlaps(periods, cursor, cursor + durationMs)) {
          slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + durationMs).toISOString(), timeZone: zone });
          if (slots.length >= maxSlots) return slots;
        }
      }
    }
  }
  return slots;
}

function withinWorkHours({ start, end, timeZone, workHours }) {
  const zone = assertTimeZone(timeZone);
  const startDate = parseInstant(start, "calendar_event_start_invalid");
  const endDate = parseInstant(end, "calendar_event_end_invalid");
  if (endDate <= startDate) return false;
  const localStart = datePartsAt(startDate, zone);
  const localEnd = datePartsAt(endDate, zone);
  if (dateKey(localStart) !== dateKey(localEnd)) return false;
  const hours = normalizeWorkHours(workHours);
  return (hours.get(localStart.weekday) || []).some((range) => {
    const open = zonedLocalToInstant(dateKey(localStart), range.start, zone);
    const close = zonedLocalToInstant(dateKey(localStart), range.end, zone);
    return open != null && close != null && startDate.getTime() >= open && endDate.getTime() <= close;
  });
}

async function boundedJson(response) {
  const declared = Number(response.headers && response.headers.get && response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new CalendarClientError("calendar_response_too_large", { retryable: true });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new CalendarClientError("calendar_response_too_large", { retryable: true });
  try { return text ? JSON.parse(text) : {}; } catch { throw new CalendarClientError("calendar_response_invalid", { retryable: true }); }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new CalendarClientError(error && error.name === "AbortError" ? "calendar_timeout" : "calendar_network_error", { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function googleEventId(idempotencyKey) {
  const key = clean(idempotencyKey, 201);
  if (!key || key.length > 200 || /[\r\n]/.test(key)) throw new CalendarClientError("calendar_idempotency_key_invalid");
  return `a${digest(key).slice(0, 31)}`;
}

function createGoogleCalendarClient({ env = process.env, fetchImpl = globalThis.fetch, store = null, now = () => new Date(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const enabled = calendarBookingEnabled(env);
  const requestTimeout = boundedInteger(timeoutMs, { min: 250, max: 30000, fallback: DEFAULT_TIMEOUT_MS, code: "calendar_timeout_invalid" });
  let memoryToken = null;

  function configuration() {
    const calendarId = clean(env.GOOGLE_CALENDAR_ID, 500);
    const timeZone = assertTimeZone(env.GOOGLE_CALENDAR_TIMEZONE);
    if (!calendarId) throw new CalendarClientError("calendar_id_required");
    return { calendarId, timeZone };
  }

  async function accessToken(forceRefresh = false) {
    const stored = store && typeof store.getToken === "function" ? await store.getToken() : null;
    const token = stored || memoryToken || null;
    const expiresAt = token && Number(new Date(token.expiresAt || 0));
    if (!forceRefresh && token && clean(token.accessToken) && Number.isFinite(expiresAt) && expiresAt > now().getTime() + 60000) {
      return clean(token.accessToken, 4096);
    }
    if (!forceRefresh && clean(env.GOOGLE_CALENDAR_ACCESS_TOKEN) && Number(new Date(env.GOOGLE_CALENDAR_ACCESS_TOKEN_EXPIRES_AT || 0)) > now().getTime() + 60000) {
      return clean(env.GOOGLE_CALENDAR_ACCESS_TOKEN, 4096);
    }
    const clientId = clean(env.GOOGLE_CALENDAR_CLIENT_ID, 1000);
    const clientSecret = clean(env.GOOGLE_CALENDAR_CLIENT_SECRET, 2000);
    const refreshToken = clean((token && token.refreshToken) || env.GOOGLE_CALENDAR_REFRESH_TOKEN, 4096);
    if (!clientId || !clientSecret || !refreshToken) throw new CalendarClientError("calendar_oauth_not_configured");
    const response = await fetchWithTimeout(fetchImpl, GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
    }, requestTimeout);
    const json = await boundedJson(response);
    if (!response.ok || !clean(json.access_token)) {
      throw new CalendarClientError(response.status === 429 || response.status >= 500 ? "calendar_token_retryable" : "calendar_token_failed", { retryable: response.status === 429 || response.status >= 500, status: response.status });
    }
    const expiresIn = boundedInteger(json.expires_in, { min: 60, max: 86400, fallback: 3600, code: "calendar_token_invalid" });
    const next = { accessToken: clean(json.access_token, 4096), refreshToken, expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString() };
    memoryToken = next;
    if (store && typeof store.saveToken === "function") await store.saveToken({ ...next });
    return next.accessToken;
  }

  async function googleRequest(path, init = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await accessToken(attempt > 0);
      const response = await fetchWithTimeout(fetchImpl, `${GOOGLE_CALENDAR_API}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), authorization: `Bearer ${token}` },
      }, requestTimeout);
      if (response.status === 401 && attempt === 0) continue;
      const json = await boundedJson(response);
      if (!response.ok) {
        throw new CalendarClientError(`calendar_http_${response.status}`, { retryable: response.status === 408 || response.status === 429 || response.status >= 500, status: response.status });
      }
      return json;
    }
    throw new CalendarClientError("calendar_auth_failed");
  }

  async function queryBusy({ timeMin, timeMax, timeZone, calendarId }) {
    const body = { timeMin: parseInstant(timeMin, "calendar_time_min_invalid").toISOString(), timeMax: parseInstant(timeMax, "calendar_time_max_invalid").toISOString(), timeZone, items: [{ id: calendarId }] };
    const json = await googleRequest("/freeBusy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const calendar = json && json.calendars && json.calendars[calendarId];
    if (!calendar || (Array.isArray(calendar.errors) && calendar.errors.length)) throw new CalendarClientError("calendar_freebusy_unavailable", { retryable: true });
    return Array.isArray(calendar.busy) ? calendar.busy : [];
  }

  async function findAvailableSlots(input = {}) {
    if (!enabled) return { ok: false, enabled: false, reason: "calendar_disabled", slots: [] };
    const configured = configuration();
    const timeZone = assertTimeZone(input.timeZone || configured.timeZone);
    const calendarId = clean(input.calendarId || configured.calendarId, 500);
    const busy = await queryBusy({ timeMin: input.timeMin, timeMax: input.timeMax, timeZone, calendarId });
    const slots = computeAvailableSlots({ ...input, timeZone, busy, now: now() });
    return { ok: true, enabled: true, calendarId, timeZone, durationMinutes: Number(input.durationMinutes), slots };
  }

  async function readEvent(calendarId, eventId) {
    try { return await googleRequest(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`); }
    catch (error) { if (error instanceof CalendarClientError && error.status === 404) return null; throw error; }
  }

  function confirmedEvent(json, expected) {
    if (!json || json.id !== expected.eventId || json.status !== "confirmed") return null;
    const actualStart = json.start && json.start.dateTime;
    const actualEnd = json.end && json.end.dateTime;
    if (!actualStart || !actualEnd || parseInstant(actualStart, "calendar_event_response_invalid").getTime() !== expected.start.getTime() || parseInstant(actualEnd, "calendar_event_response_invalid").getTime() !== expected.end.getTime()) return null;
    const proof = json.extendedProperties && json.extendedProperties.private;
    if (!proof || proof.wssPayloadHash !== expected.fingerprint) return null;
    return { eventId: json.id, status: "confirmed", htmlLink: clean(json.htmlLink, 2000) || null, start: new Date(actualStart).toISOString(), end: new Date(actualEnd).toISOString() };
  }

  async function createEvent(input = {}) {
    if (!enabled) return { ok: false, enabled: false, confirmed: false, reason: "calendar_disabled" };
    const configured = configuration();
    const calendarId = clean(input.calendarId || configured.calendarId, 500);
    const timeZone = assertTimeZone(input.timeZone || configured.timeZone);
    const start = parseInstant(input.start, "calendar_event_start_invalid");
    const end = parseInstant(input.end, "calendar_event_end_invalid");
    if (end <= start || end - start > 8 * 3600000 || start <= now()) throw new CalendarClientError("calendar_event_window_invalid");
    if (!withinWorkHours({ start, end, timeZone, workHours: input.workHours })) throw new CalendarClientError("calendar_event_outside_work_hours");
    const summary = clean(input.summary, 500);
    if (!summary) throw new CalendarClientError("calendar_event_summary_required");
    const idempotencyKey = clean(input.idempotencyKey, 201);
    const eventId = googleEventId(idempotencyKey);
    const attendeeEmail = clean(input.attendeeEmail, 320).toLowerCase();
    if (attendeeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendeeEmail)) throw new CalendarClientError("calendar_attendee_invalid");
    const sendUpdates = clean(input.sendUpdates || (attendeeEmail ? "" : "none"), 20);
    if (!new Set(["all", "externalOnly", "none"]).has(sendUpdates)) throw new CalendarClientError(attendeeEmail ? "calendar_send_updates_required" : "calendar_send_updates_invalid");
    if (!store || typeof store.claimBooking !== "function" || typeof store.completeBooking !== "function") throw new CalendarClientError("calendar_idempotency_store_required");
    const eventInput = { calendarId, summary, start: start.toISOString(), end: end.toISOString(), timeZone, attendeeEmail: attendeeEmail || null, description: clean(input.description, 8000) || null, location: clean(input.location, 1000) || null, sendUpdates };
    const fingerprint = digest(stableStringify(eventInput));
    const claim = await store.claimBooking({ key: idempotencyKey, fingerprint, eventId, startedAt: now().toISOString() });
    const existing = claim && claim.record;
    if (existing && existing.fingerprint !== fingerprint) throw new CalendarClientError("calendar_idempotency_payload_mismatch");
    if (existing && existing.status === "confirmed" && existing.eventId === eventId) {
      return { ok: true, enabled: true, confirmed: true, idempotent: true, eventId, status: "confirmed", htmlLink: clean(existing.htmlLink, 2000) || null, start: existing.start, end: existing.end, timeZone };
    }
    // A prior insert may have committed in Google after our response was lost,
    // including on another serverless instance whose local store is empty.
    // Always reconcile the deterministic ID before FreeBusy sees that event as
    // a conflict. Matching ID is not enough: exact time + private payload proof
    // are required before this can ever be reported as confirmed.
    const recoveredJson = await readEvent(calendarId, eventId);
    const recovered = confirmedEvent(recoveredJson, { eventId, fingerprint, start, end });
    if (recovered) {
      await store.completeBooking({ key: idempotencyKey, fingerprint, ...recovered, timeZone, completedAt: now().toISOString() });
      return { ok: true, enabled: true, confirmed: true, idempotent: true, recovered: true, ...recovered, timeZone };
    }
    // An event at our deterministic ID with mismatched or unconfirmed proof is
    // not ours to overwrite and cannot be called a successful replay.
    if (recoveredJson) throw new CalendarClientError("calendar_event_not_confirmed", { retryable: false });
    const busy = await queryBusy({ timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone, calendarId });
    const parsedBusy = busy.map((period) => ({ start: parseInstant(period.start, "calendar_busy_invalid").getTime(), end: parseInstant(period.end, "calendar_busy_invalid").getTime() }));
    if (busyOverlaps(parsedBusy, start.getTime(), end.getTime())) throw new CalendarClientError("calendar_slot_no_longer_available");
    const privateProof = { wssIdempotencyHash: digest(idempotencyKey), wssPayloadHash: fingerprint };
    const eventBody = {
      id: eventId, summary,
      start: { dateTime: start.toISOString(), timeZone }, end: { dateTime: end.toISOString(), timeZone },
      ...(eventInput.description ? { description: eventInput.description } : {}),
      ...(eventInput.location ? { location: eventInput.location } : {}),
      ...(attendeeEmail ? { attendees: [{ email: attendeeEmail }] } : {}),
      extendedProperties: { private: privateProof },
    };
    let json;
    try {
      json = await googleRequest(`/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${encodeURIComponent(sendUpdates)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(eventBody) });
    } catch (error) {
      if (!(error instanceof CalendarClientError) || error.status !== 409) throw error;
      json = await readEvent(calendarId, eventId);
    }
    const confirmed = confirmedEvent(json, { eventId, fingerprint, start, end });
    if (!confirmed) throw new CalendarClientError("calendar_event_not_confirmed", { retryable: true });
    await store.completeBooking({ key: idempotencyKey, fingerprint, ...confirmed, timeZone, completedAt: now().toISOString() });
    return { ok: true, enabled: true, confirmed: true, idempotent: Boolean(existing), ...confirmed, timeZone };
  }

  return Object.freeze({ enabled, findAvailableSlots, createEvent });
}

module.exports = {
  CalendarClientError,
  calendarBookingEnabled,
  computeAvailableSlots,
  createGoogleCalendarClient,
  googleEventId,
  withinWorkHours,
};
