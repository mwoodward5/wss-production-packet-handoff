"use strict";

/**
 * lib/connect-assistant-activity.js — what the assistant actually DID, for the
 * owner's own eyes.
 *
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * A read-only view over rows that already exist. It invents no table and writes
 * nothing. Two sources, both already the system of record:
 *
 *   connect_threads    site_slug is on the thread, so this is the only place a
 *                      tenant boundary can be drawn. meta.lead.capturedBy tells
 *                      us the assistant — not a human — captured that lead.
 *   connect_messages   meta.source = "ai_assistant" and meta.state = "sent" is
 *                      exactly what lib/connect-ai-takeover.js stamps on a
 *                      reply it delivered. A reservation (state "reserved") or
 *                      a failure (state "failed") is NOT a reply and must never
 *                      be counted as one.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP
 * ---------------------------------------------------------------------------
 * A number the owner reads is a claim we are making to him about his own
 * business. So every outcome here is either MEASURED or ABSENT — there is no
 * third state and there is certainly no zero-as-a-guess.
 *
 * If any read fails, is truncated, or is only partially available, the whole
 * result comes back `available:false` with a named reason and EMPTY counts. The
 * dashboard then renders nothing at all. "Answered 0 questions this week" when
 * the truth is "we could not read the table" is a fabricated number wearing a
 * modest hat, and this codebase has already shipped enough of those.
 *
 * A genuine zero is different, and is reported as a zero: `available:true` with
 * `answered:0` means we looked and there was nothing. The caller can say so in
 * words.
 *
 * WHY THE CAPS FAIL CLOSED RATHER THAN TRUNCATE
 * ---------------------------------------------------------------------------
 * Same reasoning as api/connect/threads.js: one row past the cap is read on
 * purpose so a source that is exactly full can be told apart from one that was
 * cut off. A count computed over a truncated window is not a count of anything,
 * so it is refused instead of being shown low.
 */

const { SLUG_RE } = require("./mirror-lead");
const { select: defaultSelect } = require("./store");
const { AI_SOURCE } = require("./connect-ai-takeover");

const THREADS_TABLE = "connect_threads";
const MESSAGES_TABLE = "connect_messages";

const LIMITS = Object.freeze({
  threads: 400,           // threads scanned for one site
  messages: 600,          // AI replies scanned across those threads
  threadChunk: 60,        // thread ids per `in.(…)` filter
  recentReplies: 5,       // shown to the owner
  replyChars: 240,        // per reply, in the panel
  weekMs: 7 * 24 * 60 * 60 * 1000,
});

const trim = (v) => String(v == null ? "" : v).trim();
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function normalizeSlug(value) {
  const slug = trim(value).toLowerCase();
  return slug.length <= 80 && SLUG_RE.test(slug) ? slug : "";
}

function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  if (result && result.ok === true && Array.isArray(result.data)) return { ok: true, rows: result.data };
  if (result && result.mode === "live_select" && Array.isArray(result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [] };
}

function unavailable(slug, reason) {
  return {
    available: false,
    reason,
    slug,
    replies: [],
    week: null,
  };
}

/** Milliseconds for a timestamp we are willing to count, or null. */
function instant(value) {
  const at = Date.parse(trim(value));
  return Number.isFinite(at) ? at : null;
}

/**
 * The visitor's side of the conversation, for the "asked / answered" pair. Only
 * ever the thread's own display name — never a phone or an email, which are
 * lead PII and have no business being rendered in an activity ticker.
 */
function threadLabel(row) {
  const name = trim(row && row.contact_name);
  return name && name.toLowerCase() !== "website visitor" ? name.slice(0, 60) : "Website visitor";
}

/**
 * A lead the ASSISTANT captured, within the window. A lead the owner typed in
 * himself is his own work and is not claimed here.
 */
function aiLeadCapturedAt(row) {
  const meta = isObject(row && row.meta) ? row.meta : {};
  const lead = isObject(meta.lead) ? meta.lead : null;
  if (!lead || trim(lead.capturedBy) !== AI_SOURCE) return null;
  return instant(lead.capturedAt);
}

function sentAiReply(row) {
  const meta = isObject(row && row.meta) ? row.meta : {};
  if (trim(meta.source) !== AI_SOURCE) return false;
  // "sent" is the only state that means a customer read it.
  return trim(meta.state) === "sent";
}

/** One row of the ticker. `guard` is carried through honestly: a reply the guard
 * refused was still delivered — as the handoff line — and the owner is entitled
 * to see which of his answers came from the model and which did not. */
function replyView(row, threadsById) {
  const meta = isObject(row.meta) ? row.meta : {};
  const thread = threadsById.get(String(row.thread_id)) || null;
  const delivered = trim(meta.delivered) || "model";
  return {
    at: trim(row.created_at),
    who: thread ? threadLabel(thread) : "Website visitor",
    body: trim(row.body).slice(0, LIMITS.replyChars),
    // "model" -> the assistant answered. Anything else -> it handed over.
    handedOver: delivered !== "model",
  };
}

async function readThreads(slug, select) {
  const query = [
    "select=id,contact_name,meta,last_message_at,created_at",
    `site_slug=eq.${encodeURIComponent(slug)}`,
    "order=last_message_at.desc",
    `limit=${LIMITS.threads + 1}`,
  ].join("&");
  const found = readRows(await select(THREADS_TABLE, query));
  if (!found.ok) return { ok: false, reason: "threads_unreadable" };
  if (found.rows.length > LIMITS.threads) return { ok: false, reason: "threads_truncated" };
  return { ok: true, rows: found.rows };
}

async function readAiMessages(threadIds, select) {
  const rows = [];
  for (let i = 0; i < threadIds.length; i += LIMITS.threadChunk) {
    const chunk = threadIds.slice(i, i + LIMITS.threadChunk);
    const query = [
      "select=id,thread_id,body,meta,created_at",
      `thread_id=in.(${chunk.join(",")})`,
      `meta->>source=eq.${AI_SOURCE}`,
      "meta->>state=eq.sent",
      "order=created_at.desc",
      `limit=${LIMITS.messages + 1}`,
    ].join("&");
    const found = readRows(await select(MESSAGES_TABLE, query));
    if (!found.ok) return { ok: false, reason: "messages_unreadable" };
    rows.push(...found.rows);
    if (rows.length > LIMITS.messages) return { ok: false, reason: "messages_truncated" };
  }
  return { ok: true, rows };
}

/**
 * readAssistantActivity(slug) -> { available, reason, replies[], week }
 *
 * Never throws. `week` is null unless every input to it was measured.
 */
async function readAssistantActivity(siteSlug, { select = defaultSelect, now = () => Date.now() } = {}) {
  const slug = normalizeSlug(siteSlug);
  if (!slug) return unavailable(trim(siteSlug).slice(0, 80), "invalid_site_slug");

  let threads;
  try {
    threads = await readThreads(slug, select);
  } catch {
    return unavailable(slug, "threads_unreadable");
  }
  if (!threads.ok) return unavailable(slug, threads.reason);

  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) return unavailable(slug, "invalid_clock");
  const since = nowMs - LIMITS.weekMs;

  // No threads at all is a complete, measured answer: nothing has happened.
  if (!threads.rows.length) {
    return {
      available: true,
      reason: "",
      slug,
      replies: [],
      week: { answered: 0, leadsCaptured: 0, since: new Date(since).toISOString() },
    };
  }

  const threadsById = new Map();
  const threadIds = [];
  for (const row of threads.rows) {
    const id = trim(row.id);
    if (!/^\d+$/.test(id)) continue;
    threadsById.set(id, row);
    threadIds.push(id);
  }
  if (!threadIds.length) return unavailable(slug, "threads_unidentifiable");

  let messages;
  try {
    messages = await readAiMessages(threadIds, select);
  } catch {
    return unavailable(slug, "messages_unreadable");
  }
  if (!messages.ok) return unavailable(slug, messages.reason);

  const sent = messages.rows
    .filter(sentAiReply)
    .filter((row) => threadsById.has(String(row.thread_id)))
    .map((row) => ({ row, at: instant(row.created_at) }))
    .filter((entry) => entry.at !== null)
    .sort((a, b) => b.at - a.at);

  const answered = sent.filter((entry) => entry.at >= since).length;
  const leadsCaptured = threads.rows.reduce((count, row) => {
    const at = aiLeadCapturedAt(row);
    return at !== null && at >= since ? count + 1 : count;
  }, 0);

  return {
    available: true,
    reason: "",
    slug,
    replies: sent.slice(0, LIMITS.recentReplies).map((entry) => replyView(entry.row, threadsById)),
    week: { answered, leadsCaptured, since: new Date(since).toISOString() },
  };
}

module.exports = {
  LIMITS,
  MESSAGES_TABLE,
  THREADS_TABLE,
  readAssistantActivity,
  _test: { aiLeadCapturedAt, normalizeSlug, readRows, replyView, sentAiReply, threadLabel, unavailable },
};
