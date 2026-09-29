"use strict";

// api/vapi-tools/schedule-callback.js — make "should I call you back when
// it's live?" a durable request instead of a vanishing sentence.
//
// THE PHANTOM THIS ENDS. Riley asked that question on live calls; nothing
// recorded the yes, so nobody called anybody. The durable row below is what
// the team actually sees (in the owner email and the flag digest lane), keyed
// by caller phone with the requested window carried VERBATIM.
//
// NO AUTO-DIALER, ON PURPOSE. Nothing here places a call, and the `say` line
// never claims a specific time is booked — the requested window is free text
// ("sometime tomorrow morning", "after 4") stored exactly as spoken. Parsing
// it into a timestamp we cannot honour would be the same fabricated promise
// class this file exists to end. Truth law: the request is logged and visible
// now; when the callback happens is a human decision off this row.
//
// DUPLICATES. A caller who asks twice (or Riley double-firing the tool) must
// not open two rows: an OPEN callback for the same caller phone with the same
 // topic inside 24h returns the existing row with duplicate:true and sends no
// second owner email. The first request still stands, so `say` stays honest.
//
// AUTH: identical to every other tool in this directory.

const { timingSafeEqual } = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

const TABLE = "ghost_agency_callbacks";
const MAX_WINDOW_CHARS = 120;
const MAX_TOPIC_CHARS = 300;
const DUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

function authorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const got = String(
    req.headers["x-vapi-secret"]
      || req.headers["x-admin-token"]
      || req.headers.authorization?.replace(/^Bearer\s+/i, "")
      || "",
  ).trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return g.length === b.length && timingSafeEqual(g, b);
  });
}

function toolArgs(body) {
  const call = body?.message?.toolCalls?.[0];
  const raw = call?.function?.arguments;
  let args = body;
  if (raw) {
    try { args = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { args = {}; }
  }
  return { call, args: args && typeof args === "object" ? args : {} };
}

function callIdOf(body, args) {
  return String(
    body?.message?.call?.id
      || body?.call?.id
      || body?.message?.callId
      || body?.callId
      || args?.call_id
      || "",
  ).trim().slice(0, 80);
}

/** The caller's number: platform envelope first, tool args second. */
function callerPhoneOf(body, args) {
  return String(
    body?.message?.call?.customer?.number
      || body?.message?.customer?.number
      || body?.call?.customer?.number
      || args?.phone
      || args?.caller_phone
      || args?.from
      || "",
  ).trim();
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function last10(value) {
  const d = String(value == null ? "" : value).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

  try {
    const body = await readJson(req).catch(() => ({}));
    const { call, args } = toolArgs(body);
    const callId = callIdOf(body, args);

    const respond = (payload) => {
      if (call?.id) {
        return sendJson(res, 200, {
          ...payload,
          results: [{ toolCallId: call.id, result: JSON.stringify(payload) }],
        });
      }
      return sendJson(res, 200, payload);
    };

    const requestedWindow = clean(args.window || args.when || args.datetime || args.time, MAX_WINDOW_CHARS);
    const topic = clean(args.topic || args.subject || args.about, MAX_TOPIC_CHARS);
    const clientRef = clean(args.client_ref || args.clientRef || args.client_id || args.reference, 40);
    const siteSlug = clean(args.site_slug || args.siteSlug || args.site, 160);
    const phone = callerPhoneOf(body, args);

    if (!requestedWindow) {
      return respond({
        ok: false,
        scheduled: false,
        status: "refused",
        refused: "window_missing",
        say: "I can set that up — when would you like me to have someone call you back?",
      });
    }
    if (!phone || !last10(phone)) {
      return respond({
        ok: false,
        scheduled: false,
        status: "refused",
        refused: "phone_missing",
        say: "I need the best number to reach you on before I can log that callback — what number should be used?",
      });
    }

    const { insertRow, select, recordEvent } = require("../../lib/store");

    // DUPLICATE CHECK — open row, same caller, same topic-ish, inside 24h.
    const digits = last10(phone);
    const topicKey = topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    let existing = null;
    const recentAt = await select(
      TABLE,
      `status=eq.open&order=created_at.desc&limit=25`,
    ).catch(() => null);
    const recent = recentAt && recentAt.ok === true && Array.isArray(recentAt.data) ? recentAt.data : [];
    const nowMs = Date.now();
    for (const row of recent) {
      if (last10(row.phone) !== digits) continue;
      const age = nowMs - Date.parse(String(row.created_at || ""));
      if (!Number.isFinite(age) || age < 0 || age > DUPE_WINDOW_MS) continue;
      const rowTopic = String(row.topic || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (topicKey && rowTopic && rowTopic !== topicKey) continue;
      existing = row;
      break;
    }

    if (existing) {
      console.log(JSON.stringify({ event: "riley_callback_duplicate", callback_id: existing.callback_id, call_id: callId || null }));
      return respond({
        ok: true,
        scheduled: true,
        duplicate: true,
        callback_id: existing.callback_id,
        requested_window: existing.requested_window || requestedWindow,
        say: "You're already on the list for that — it's logged and in front of the team, so no need to ask twice.",
      });
    }

    const callbackId = `cb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const written = await insertRow(TABLE, {
      callback_id: callbackId,
      client_ref: clientRef || null,
      phone,
      phone_digits: digits,
      topic: topic || null,
      requested_window: requestedWindow,
      call_id: callId || null,
      site_slug: siteSlug || null,
      status: "open",
      created_at: now,
      updated_at: now,
    });
    // TRUTH LAW AT THE STORE: anything but a confirmed live write (dry run,
    // store hiccup) means the row does not exist — no row, no "logged".
    if (!written || written.mode !== "live_write") {
      return respond({
        ok: false,
        scheduled: false,
        status: "unavailable",
        say: "The callback request didn't save on my end, so I won't pretend it did — can I take your number as a message instead?",
      });
    }

    await recordEvent("ghost_agency_callback_logged", {
      callback_id: callbackId,
      client_ref: clientRef || null,
      site_slug: siteSlug || null,
      requested_window: requestedWindow,
      topic: topic || null,
      call_id: callId || null,
      phone_last4: digits.slice(-4),
    }).catch(() => {});
    console.log(JSON.stringify({
      event: "riley_callback_logged",
      callback_id: callbackId,
      client_ref: clientRef || null,
      requested_window: requestedWindow,
      call_id: callId || null,
    }));

    // THE OWNER EMAIL, NOW — the team sees the request without asking the
    // caller to repeat it. A failed mailer never un-logs the row.
    let ownerNotified = false;
    try {
      const apiKey = String(process.env.RESEND_API_KEY || "").trim();
      const to = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "woodwardsoftware@gmail.com").trim();
      if (apiKey && to) {
        const { sendResendEmail } = require("../../lib/email");
        const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const rows = [
          ["Callback window", requestedWindow],
          ["Topic", topic],
          ["Client ref", clientRef],
          ["Site", siteSlug],
          ["Call", callId],
          ["Number", `${digits.slice(0, 6)}…${digits.slice(-4)} (on the row)`],
          ["Logged", now],
        ].filter(([, v]) => v);
        const result = await sendResendEmail({
          to,
          cc: [],
          bcc: [],
          senderKind: "transactional",
          subject: `Callback requested from Riley's line — ${requestedWindow.slice(0, 60)}`,
          html: `<div style="max-width:560px;font-family:-apple-system,Segoe UI,sans-serif">
<h2 style="font-size:17px">Callback requested — "${esc(requestedWindow)}"</h2>
<p style="font-size:14px;color:#33332c">${topic ? esc(topic) : "The caller asked for a callback; no topic was noted."}</p>
<table style="font-size:13px;color:#55554d;margin-top:10px">${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;font-weight:700">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p style="color:#8a8a80;font-size:12px;margin-top:16px">Callback ${esc(callbackId)} · recorded by Riley's schedule_callback tool. Nothing dials automatically — this row waits for a human.</p>
</div>`,
          text: `Callback requested — "${requestedWindow}"\n\n${topic || "The caller asked for a callback; no topic was noted."}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nCallback ${callbackId} · recorded by Riley's schedule_callback tool. Nothing dials automatically.`,
          idempotencyKey: `callback:${callbackId}`,
        });
        ownerNotified = Boolean(result && result.mode === "sent");
      }
    } catch {
      ownerNotified = false;
    }

    return respond({
      ok: true,
      scheduled: true,
      duplicate: false,
      callback_id: callbackId,
      requested_window: requestedWindow,
      owner_notified: ownerNotified,
      // Truth law: logged + visible now; the window is THEIR words, echoed
      // back as a request, never as a booked appointment time.
      say: `Done — I've logged that callback request for ${requestedWindow}, and the team can see it now.`,
    });
  } catch (error) {
    handleError(res, error);
  }
};
