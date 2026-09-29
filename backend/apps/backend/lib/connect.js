"use strict";
// lib/connect.js — WSS Connect: unified lead inbox (threads + messages).
// Channels: chat | sms | email | voicemail | call | system.
// v1 replies: email via Resend (review-hold rules apply upstream); other
// channels store the outbound message and mark it queued for the channel
// worker — nothing is silently pretended to be delivered.

const { randomUUID, timingSafeEqual } = require("node:crypto");
const { conditionalUpdate, insertRow, select } = require("./store");
const { sendResendEmail } = require("./email");
const { verifyScopeToken } = require("./dashboard-link");

// A Connect reply normally finishes in seconds. Holding a short lease keeps a
// browser retry from racing the still-running first request, while a crashed
// serverless invocation becomes recoverable without making the owner wait all
// day. Resend only guarantees provider idempotency for 24 hours; stop one hour
// early so clock/queue skew can never carry an ambiguous email past that edge.
const CONNECT_OUTBOUND_LEASE_MS = 2 * 60 * 1000;
const RESEND_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
const CLIENT_MESSAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function connectAuthorized(req) {
  const secrets = [process.env.CONNECT_APP_TOKEN, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim()).filter(Boolean);
  const got = String(req.headers["x-connect-token"] || req.headers["x-admin-token"] || "").trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => { const b = Buffer.from(s); return g.length === b.length && timingSafeEqual(g, b); });
}

// Resolves what the caller is allowed to see:
//   { mode: "full" }               -> shared/admin token: every tenant (Connect app, admin)
//   { mode: "tenant", siteSlug }   -> a per-customer scoped token: just their data
//   null                            -> unauthorized
// This is what lets one dashboard endpoint safely serve many customers without
// leaking one business's leads to another.
function resolveConnectScope(req) {
  if (connectAuthorized(req)) return { mode: "full" };
  const got = String(req.headers["x-connect-token"] || "").trim();
  const scoped = verifyScopeToken(got);
  if (scoped.ok) return { mode: "tenant", siteSlug: scoped.siteSlug };
  return null;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d || "{}")); });
  try { return JSON.parse(raw); } catch { return {}; }
}

async function ensureThread({ threadKey, siteSlug, channel, contactName, contactInfo, subject, meta }) {
  const found = await select("connect_threads", `thread_key=eq.${encodeURIComponent(threadKey)}&limit=1`);
  const existing = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (existing) return existing;
  const created = await insertRow("connect_threads", {
    thread_key: threadKey,
    site_slug: siteSlug,
    channel,
    contact_name: contactName || null,
    contact_info: contactInfo || null,
    subject: subject || null,
    meta: meta || null,
  });
  if (created?.mode !== "live_write") throw new Error(`thread insert failed: ${JSON.stringify(created).slice(0, 200)}`);
  return Array.isArray(created.row) ? created.row[0] : created.row;
}

async function addMessage(threadId, direction, body, meta) {
  const res = await insertRow("connect_messages", { thread_id: threadId, direction, body, meta: meta || null });
  if (res?.mode !== "live_write") throw new Error(`message insert failed: ${JSON.stringify(res).slice(0, 200)}`);
  return Array.isArray(res.row) ? res.row[0] : res.row;
}

function normalizeClientMessageId(value) {
  if (value === undefined || value === null || value === "") return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false, error: "client_message_id_invalid" };
  const normalized = value.trim().toLowerCase();
  if (!CLIENT_MESSAGE_ID_RE.test(normalized)) return { ok: false, error: "client_message_id_invalid" };
  return { ok: true, value: normalized };
}

function resultRow(result) {
  if (!result || !Array.isArray(result.row)) return result?.row || null;
  return result.row[0] || null;
}

function messageWriteError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function confirmedMessageIdConflict(result) {
  const detail = JSON.stringify(result?.error || {});
  return result?.mode === "live_write_failed"
    && String(result?.error?.code || "") === "23505"
    && (/connect_messages_thread_client_message_uidx/i.test(detail)
      || /key\s*\(thread_id,\s*client_message_id\)\s*=/i.test(detail));
}

async function findOutboundMessage(threadId, clientMessageId) {
  const found = await select(
    "connect_messages",
    `thread_id=eq.${Number(threadId)}&client_message_id=eq.${encodeURIComponent(clientMessageId)}&limit=1`,
  );
  if (!found?.ok || !Array.isArray(found.data)) throw messageWriteError("connect_message_reservation_read_failed");
  return found.data[0] || null;
}

function ageMs(value, nowMs) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : Number.POSITIVE_INFINITY;
}

function storedDelivery(row) {
  const delivery = row?.meta?.delivery;
  return delivery && typeof delivery === "object" && !Array.isArray(delivery) ? delivery : {};
}

async function patchReservedMessage(row, patch) {
  const leaseToken = String(row?.delivery_lease_token || "").trim();
  if (!row?.id || !leaseToken) throw messageWriteError("connect_message_reservation_state_invalid");
  const updated = await conditionalUpdate(
    "connect_messages",
    "id",
    row.id,
    {
      delivery_status: "eq.pending",
      delivery_lease_token: `eq.${leaseToken}`,
    },
    patch,
  );
  if (!updated?.ok) throw messageWriteError("connect_message_reservation_update_failed");
  return updated.updated && Array.isArray(updated.rows) ? (updated.rows[0] || null) : null;
}

async function classifyExistingReservation({ thread, text, clientMessageId, row, nowMs }) {
  if (!row || Number(row.thread_id) !== Number(thread.id) || row.direction !== "outbound") {
    throw messageWriteError("connect_message_reservation_state_invalid");
  }
  if (String(row.body || "") !== text) {
    return { state: "conflict", retryable: false, message: row };
  }
  if (row.delivery_status === "completed") {
    return {
      state: "completed",
      retryable: false,
      idempotent: true,
      message: row,
      delivery: storedDelivery(row),
    };
  }
  if (row.delivery_status === "delivery_unknown") {
    return { state: "delivery_unknown", retryable: false, manual: true, message: row };
  }
  if (row.delivery_status !== "pending") {
    throw messageWriteError("connect_message_reservation_state_invalid");
  }

  const lastAge = ageMs(
    row.delivery_last_attempt_at || row.delivery_first_attempt_at || row.created_at,
    nowMs,
  );
  if (lastAge < CONNECT_OUTBOUND_LEASE_MS) {
    return {
      state: "in_progress",
      retryable: true,
      retryAfterMs: Math.max(1000, CONNECT_OUTBOUND_LEASE_MS - lastAge),
      message: row,
    };
  }

  const firstAge = ageMs(row.delivery_first_attempt_at || row.created_at, nowMs);
  if (thread.channel === "email" && firstAge >= RESEND_IDEMPOTENCY_WINDOW_MS) {
    const unknown = await patchReservedMessage(row, {
      delivery_status: "delivery_unknown",
      meta: {
        ...(row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {}),
        delivery: { status: "delivery_unknown", manual: true },
      },
    });
    if (unknown) return { state: "delivery_unknown", retryable: false, manual: true, message: unknown };
    const current = await findOutboundMessage(thread.id, clientMessageId);
    return classifyExistingReservation({ thread, text, clientMessageId, row: current, nowMs });
  }

  const now = new Date(nowMs).toISOString();
  const leaseToken = randomUUID();
  const claimed = await patchReservedMessage(row, {
    delivery_lease_token: leaseToken,
    delivery_last_attempt_at: now,
    delivery_attempts: Math.max(1, Number(row.delivery_attempts || 1)) + 1,
    meta: {
      ...(row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {}),
      delivery: { status: "pending" },
    },
  });
  if (claimed) {
    return { state: "reserved", retryable: false, idempotent: false, message: claimed, leaseToken };
  }
  const current = await findOutboundMessage(thread.id, clientMessageId);
  return classifyExistingReservation({ thread, text, clientMessageId, row: current, nowMs });
}

async function reserveOutboundMessage({ thread, text, clientMessageId, nowMs = Date.now() }) {
  const normalized = normalizeClientMessageId(clientMessageId);
  if (!normalized.ok || !normalized.value) throw messageWriteError("client_message_id_invalid");
  const now = new Date(nowMs).toISOString();
  const leaseToken = randomUUID();
  const inserted = await insertRow("connect_messages", {
    thread_id: thread.id,
    direction: "outbound",
    body: text,
    meta: { delivery: { status: "pending" } },
    client_message_id: normalized.value,
    delivery_status: "pending",
    delivery_lease_token: leaseToken,
    delivery_attempts: 1,
    delivery_first_attempt_at: now,
    delivery_last_attempt_at: now,
  });
  if (inserted?.mode === "live_write") {
    const message = resultRow(inserted);
    if (!message) throw messageWriteError("connect_message_reservation_failed");
    return { state: "reserved", retryable: false, idempotent: false, message, leaseToken };
  }
  if (!confirmedMessageIdConflict(inserted)) throw messageWriteError("connect_message_reservation_failed");
  const existing = await findOutboundMessage(thread.id, normalized.value);
  if (!existing) throw messageWriteError("connect_message_reservation_missing");
  return classifyExistingReservation({
    thread,
    text,
    clientMessageId: normalized.value,
    row: existing,
    nowMs,
  });
}

async function completeOutboundMessage({ reservation, delivery, nowMs = Date.now() }) {
  if (reservation?.state !== "reserved" || !reservation.message) {
    throw messageWriteError("connect_message_reservation_state_invalid");
  }
  if (!delivery || (delivery.delivered !== true && delivery.queued !== true)) {
    throw messageWriteError("connect_message_delivery_not_confirmed");
  }
  const row = reservation.message;
  const completed = await patchReservedMessage(row, {
    delivery_status: "completed",
    delivery_completed_at: new Date(nowMs).toISOString(),
    meta: {
      ...(row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta : {}),
      delivery: {
        ...delivery,
        status: delivery.queued === true ? "queued" : "sent",
      },
    },
  });
  if (completed) return { message: completed, delivery: storedDelivery(completed), idempotent: false };

  // A lost completion race is safe to replay only when another worker already
  // committed the exact reservation. Anything else remains ambiguous and must
  // return a retryable failure rather than claiming the reply was sent.
  const current = await findOutboundMessage(row.thread_id, row.client_message_id);
  if (current?.delivery_status === "completed" && String(current.body || "") === String(row.body || "")) {
    return { message: current, delivery: storedDelivery(current), idempotent: true };
  }
  throw messageWriteError("connect_message_completion_lost");
}

async function touchThread(threadId, { unread }) {
  // PATCH via PostgREST through store.select is not available; use direct fetch.
  const url = `${process.env.SUPABASE_URL}/rest/v1/connect_threads?id=eq.${threadId}`;
  await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ last_message_at: new Date().toISOString(), ...(unread === undefined ? {} : { unread }) }),
  });
}

async function deliverOutbound(thread, body, options = {}) {
  if (thread.channel === "email" && thread.contact_info) {
    const email = await sendResendEmail({
      to: thread.contact_info,
      subject: thread.subject ? `Re: ${thread.subject}` : "Reply from your website team",
      text: body,
      idempotencyKey: String(options.idempotencyKey || "").trim() || undefined,
    });
    return { channel: "email", delivered: !!email?.ok || !!email?.id, detail: email };
  }
  // A site-widget chat needs no external channel worker. `send.js` stores the
  // outbound row immediately, and the visitor's one-thread token reads that
  // same row on its next poll. Calling this "queued until chat turns on" is
  // both confusing to the client and false: this is the live delivery path.
  if (thread.channel === "chat" && thread.meta?.source === "site_widget") {
    return { channel: "chat", delivered: true, via: "visitor_poll" };
  }
  // SMS: the delivery worker, finally live (2026-08-11) — but only for threads
  // a customer STARTED by texting the business's tracked number. The bridge
  // module enforces that structurally: channel "sms" + customer_phone in the
  // thread meta (only the inbound webhook writes it) + at least one inbound
  // message + the consent row persistInboundSms recorded with the inbound SID
  // as proof + no suppression. There is no path from here to a number that
  // never texted us — cold SMS is impossible by construction, which is the
  // whole compliance posture (TCPA has no B2B exemption; $1,500/text).
  if (thread.channel === "sms") {
    const { deliverSmsReply } = require("./connect-sms-bridge");
    const { sendTwilioMessage } = require("./twilio");
    const { select } = require("./store");
    const messages = options.messages
      || (await select("connect_messages", `?select=id,direction,sender&thread_id=eq.${thread.id}&limit=50`).catch(() => ({ data: [] }))).data
      || [];
    return deliverSmsReply({
      sendTwilioMessage,
      readConversation: async (phone, accountId) => {
        const q = accountId
          ? `?select=consent_to_text,consent_source&customer_phone=eq.${encodeURIComponent(phone)}&account_id=eq.${encodeURIComponent(accountId)}&limit=1`
          : `?select=consent_to_text,consent_source&customer_phone=eq.${encodeURIComponent(phone)}&limit=1`;
        const r = await select("answercrew_sms_conversations", q).catch(() => null);
        return (r && r.data && r.data[0]) || null;
      },
      isSuppressed: async (phone) => {
        const r = await select("ghost_agency_suppressions", `?select=id&suppression_key=eq.${encodeURIComponent(phone)}&limit=1`).catch(() => null);
        return Boolean(r && r.data && r.data.length);
      },
    }, { thread, messages, body });
  }
  // chat / voicemail / call: stored + queued; delivery workers land later.
  return { channel: thread.channel, delivered: false, queued: true, note: "stored; channel delivery worker not yet live" };
}

module.exports = {
  CLIENT_MESSAGE_ID_RE,
  CONNECT_OUTBOUND_LEASE_MS,
  RESEND_IDEMPOTENCY_WINDOW_MS,
  connectAuthorized,
  resolveConnectScope,
  readBody,
  ensureThread,
  addMessage,
  normalizeClientMessageId,
  reserveOutboundMessage,
  completeOutboundMessage,
  touchThread,
  deliverOutbound,
};
