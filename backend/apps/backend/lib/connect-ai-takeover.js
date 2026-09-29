"use strict";

/**
 * lib/connect-ai-takeover.js — the 30-second handover, without a timer.
 *
 * ===========================================================================
 * WHY THERE IS NO SCHEDULER HERE
 * ===========================================================================
 * "Answer 30 seconds after the visitor, if nobody human did" sounds like a job
 * for a timer. Serverless has no timers that survive a response, and Vercel
 * cron floors at one minute — which is both too slow to feel like a reply and
 * a fixed cost paid whether or not anyone is on the site.
 *
 * The widget already polls every 6 seconds while it is open. That poll is a
 * clock somebody else is already paying for. So the takeover is EVALUATED
 * INSIDE THE POLL: on each tick we ask whether the newest message is still the
 * visitor's, whether it has gone unanswered past the owner's window, and
 * whether a human has stepped in. If it is time, we speak.
 *
 * Consequences worth stating plainly, because they are the design:
 *   · Nobody watching costs nothing. No queue, no cron, no worker.
 *   · A visitor who closes the tab is not answered into the void — the widget
 *     drops to a 30s poll and stops at 10 minutes idle, and an unanswered
 *     thread is still a lead in the owner's inbox.
 *   · Delivery needs no new transport at all. lib/connect.js already treats a
 *     site-widget outbound row as delivered by the visitor's own poll, so an
 *     AI reply written as an outbound message IS the delivery.
 *
 * ===========================================================================
 * OWNER FIRST. THAT IS THE PRODUCT, NOT A COURTESY.
 * ===========================================================================
 * The owner gets takeover_seconds (default 30) to answer from the app before
 * the assistant says a word. And if the owner EVER replies in a thread, the
 * assistant stands down for the rest of that conversation — permanently, not
 * for one turn. A human and a bot alternating in the same chat is worse than
 * either alone, and the customer can tell.
 *
 * ===========================================================================
 * ONE REPLY, UNDER CONCURRENT POLLS
 * ===========================================================================
 * Two open tabs poll on independent 6-second timers, so the race is ordinary,
 * not exotic. The gate is the one already proven in api/connect/send.js: a
 * durable reservation row keyed by a client_message_id that carries a UNIQUE
 * index, claimed before the work starts and completed after.
 *
 * Two deliberate differences from send.js, both forced by the fact that the
 * text does not exist until after the model has answered:
 *
 *   1. The id is DERIVED, not random — sha256(thread + the visitor message
 *      being answered). Concurrent polls compute the same id, so the unique
 *      index decides the winner. A random id would let both through.
 *   2. The reservation is written with direction "system", and only becomes
 *      "outbound" once real text exists. This is not decoration: safeMessage()
 *      in lib/connect-chat.js already drops any row that is not inbound or
 *      outbound, so a half-finished reply is invisible to the visitor by the
 *      contract that is already there. No placeholder is ever rendered to a
 *      customer, and no shared read path had to change to guarantee it.
 *
 * A crashed generation leaves a stale lease, which the next poll re-claims;
 * attempts are capped, after which the reservation goes terminal and the
 * thread stays a human lead rather than becoming a retry loop.
 */

const { createHash, randomUUID } = require("node:crypto");

const AI_SOURCE = "ai_assistant";
const RESERVED_BODY = "[ai reply pending]";
const AI_LEASE_MS = 45000;
const MAX_ATTEMPTS = 3;
const MESSAGE_WINDOW = 60;

/**
 * The owner-first window for a plain factual lookup — hours, address, services,
 * service area. Zero, on purpose: the answer is something the site already
 * publishes, so making the visitor wait 30 seconds for the owner to type back
 * what the page already says adds nothing, and a crisp question deserves a crisp
 * answer. Everything that is NOT a lookup — a described job, "can someone come
 * out", a request for a quote — keeps the full takeover_seconds, because that is
 * where owner-first earns its keep: a human wants first crack at a real lead.
 *
 * Applied as a CAP, never a floor: an owner who set a window shorter than this
 * still gets his, and the assistant is never made to wait LONGER for a lookup.
 *
 * The classifier that decides "lookup vs lead" is isSimpleFactualQuestion, and
 * it only changes how SOON the assistant may speak — never WHAT it may say. The
 * KB grounding and the claim guard are untouched, so a factual-shaped question
 * the site cannot answer simply reaches its honest callback offer a little
 * sooner, which is the better outcome anyway.
 */
const FAST_LANE_SECONDS = 0;

const trim = (v) => String(v == null ? "" : v).trim();
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * The unique index on (thread_id, client_message_id) is the whole concurrency
 * story, so the id must be a pure function of what is being answered. The
 * column also carries a CHECK constraint requiring UUID shape with version
 * 1-5 and variant 8/9/a/b, so the digest is dressed as a v4.
 */
function aiClientMessageId(threadId, answeringMessageId) {
  const hex = createHash("sha256")
    .update(`connect-ai-reply:v1:${trim(threadId)}:${trim(answeringMessageId)}`)
    .digest("hex");
  const variant = "89ab"[parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function messageMeta(row) {
  return isObject(row && row.meta) ? row.meta : {};
}

function isAiMessage(row) {
  return trim(messageMeta(row).source) === AI_SOURCE;
}

/** An outbound row that the assistant did not write was written by a human. */
function isOwnerMessage(row) {
  return trim(row && row.direction) === "outbound" && !isAiMessage(row);
}

function isReservation(row) {
  return trim(row && row.direction) === "system" && isAiMessage(row);
}

function ageMs(value, nowMs) {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : Number.POSITIVE_INFINITY;
}

// ---------------------------------------------------------------------------
// THE DECISION — pure, so it can be tested without a database
// ---------------------------------------------------------------------------

/**
 * decideTakeover({ thread, messages, settings, nowMs }) -> { generate, reason }
 *
 * `messages` is every row on the thread in ascending id order, INCLUDING the
 * direction:"system" reservations — they are how a second poll learns that a
 * first poll is already working.
 *
 * Every refusal is named. A bot that is quiet for a reason an operator can
 * read is debuggable; a bot that is quiet is not.
 */
function decideTakeover({ thread, messages = [], settings = null, nowMs = Date.now(), maxReplies = 12, factualLookup = false } = {}) {
  if (!thread) return { generate: false, reason: "thread_not_found" };
  if (!settings || settings.aiChatEnabled !== true) {
    return { generate: false, reason: settings && settings.reason ? `ai_chat_disabled:${settings.reason}` : "ai_chat_disabled" };
  }

  const rows = Array.isArray(messages) ? messages : [];
  const visible = rows.filter((row) => row && (row.direction === "inbound" || row.direction === "outbound"));
  if (!visible.length) return { generate: false, reason: "no_messages" };

  // A human in the thread ends the assistant's involvement for good.
  if (rows.some(isOwnerMessage)) return { generate: false, reason: "owner_handling" };

  const newest = visible[visible.length - 1];
  if (trim(newest.direction) !== "inbound") return { generate: false, reason: "awaiting_visitor" };

  const aiReplies = visible.filter((row) => row.direction === "outbound" && isAiMessage(row)).length;
  if (aiReplies >= maxReplies) return { generate: false, reason: "reply_cap_reached" };

  const answeringMessageId = trim(newest.id);
  const reservation = rows.find(
    (row) => isReservation(row) && trim(messageMeta(row).answering_message_id) === answeringMessageId,
  );
  if (reservation) {
    const status = trim(reservation.delivery_status);
    if (status !== "pending") return { generate: false, reason: "reply_abandoned" };
    const attempts = Number(reservation.delivery_attempts) || 0;
    if (attempts >= MAX_ATTEMPTS) return { generate: false, reason: "reply_attempts_exhausted" };
    const leaseAge = ageMs(reservation.delivery_last_attempt_at || reservation.created_at, nowMs);
    if (leaseAge < AI_LEASE_MS) return { generate: false, reason: "reply_in_flight" };
    return {
      generate: true,
      reason: "reclaim_stale_lease",
      answeringMessageId,
      isFirstAiMessage: aiReplies === 0,
      reservation,
    };
  }

  const configuredSeconds = Number.isFinite(Number(settings.takeoverSeconds)) ? Number(settings.takeoverSeconds) : 30;
  // A plain factual lookup takes the fast lane; a described job keeps the full
  // owner-first window so the human gets first crack at the lead.
  const takeoverSeconds = factualLookup ? Math.min(configuredSeconds, FAST_LANE_SECONDS) : configuredSeconds;
  const waited = ageMs(newest.created_at, nowMs);
  if (waited < takeoverSeconds * 1000) {
    return { generate: false, reason: "within_owner_window", waitedMs: waited, takeoverSeconds, factualLookup };
  }

  return {
    generate: true,
    reason: "owner_window_elapsed",
    answeringMessageId,
    isFirstAiMessage: aiReplies === 0,
    reservation: null,
    waitedMs: waited,
    takeoverSeconds,
    factualLookup,
  };
}

// ---------------------------------------------------------------------------
// reservation lifecycle
// ---------------------------------------------------------------------------

function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  if (result && result.ok === true && Array.isArray(result.data)) return { ok: true, rows: result.data };
  if (result && result.mode === "live_select" && Array.isArray(result.rows)) return { ok: true, rows: result.rows };
  return { ok: false, rows: [] };
}

/** PostgREST's dialect for "that client_message_id is already taken". */
function uniqueConflict(result) {
  const detail = JSON.stringify((result && result.error) || {});
  return result && result.mode === "live_write_failed"
    && String((result.error || {}).code || "") === "23505"
    && /connect_messages_thread_client_message_uidx|\(thread_id,\s*client_message_id\)/i.test(detail);
}

function resultRow(result) {
  if (!result) return null;
  return Array.isArray(result.row) ? result.row[0] || null : result.row || null;
}

async function readThreadMessages(threadId, { select }) {
  const found = readRows(await select(
    "connect_messages",
    [
      "select=id,direction,body,meta,created_at,delivery_status,delivery_attempts,delivery_last_attempt_at,client_message_id",
      `thread_id=eq.${encodeURIComponent(trim(threadId))}`,
      "order=id.desc",
      `limit=${MESSAGE_WINDOW}`,
    ].join("&"),
  ));
  if (!found.ok) return { ok: false, rows: [] };
  // Read newest-first so a long thread cannot push the current turn out of the
  // window, then hand back oldest-first because that is how a conversation reads.
  return { ok: true, rows: found.rows.slice().reverse() };
}

/**
 * reserveAiReply -> { state, row, leaseToken }
 *
 * state: "reserved" (this caller owns the work) | "taken" (somebody else does)
 *      | "failed" (the store would not answer)
 */
async function reserveAiReply({ threadId, answeringMessageId, existing, nowMs }, { insertRow, conditionalUpdate }) {
  const clientMessageId = aiClientMessageId(threadId, answeringMessageId);
  const leaseToken = randomUUID();
  const now = new Date(nowMs).toISOString();

  if (!existing) {
    const inserted = await insertRow("connect_messages", {
      thread_id: Number(threadId),
      direction: "system",
      body: RESERVED_BODY,
      meta: { source: AI_SOURCE, state: "reserved", answering_message_id: trim(answeringMessageId) },
      client_message_id: clientMessageId,
      delivery_status: "pending",
      delivery_lease_token: leaseToken,
      delivery_attempts: 1,
      delivery_first_attempt_at: now,
      delivery_last_attempt_at: now,
    });
    if (inserted && inserted.mode === "live_write") {
      const row = resultRow(inserted);
      return row ? { state: "reserved", row, leaseToken } : { state: "failed", reason: "reservation_row_missing" };
    }
    // Losing the unique index is the SUCCESS case for everyone but this caller:
    // it means another poll got there first and exactly one reply will exist.
    if (uniqueConflict(inserted)) return { state: "taken", reason: "reserved_by_concurrent_poll" };
    return { state: "failed", reason: "reservation_write_failed" };
  }

  // Re-claiming a lease abandoned by a crashed invocation. The guard on the
  // OLD lease token is what makes this safe: two pollers racing to re-claim,
  // only one PATCH matches.
  const claimed = await conditionalUpdate(
    "connect_messages",
    "id",
    existing.id,
    { delivery_status: "eq.pending", delivery_lease_token: `eq.${trim(existing.delivery_lease_token)}` },
    {
      delivery_lease_token: leaseToken,
      delivery_last_attempt_at: now,
      delivery_attempts: (Number(existing.delivery_attempts) || 1) + 1,
    },
  );
  if (!claimed || claimed.ok !== true) return { state: "failed", reason: "reservation_reclaim_failed" };
  if (!claimed.updated) return { state: "taken", reason: "reclaimed_by_concurrent_poll" };
  const row = Array.isArray(claimed.rows) ? claimed.rows[0] || existing : existing;
  return { state: "reserved", row: { ...row, id: existing.id }, leaseToken };
}

/** Turn the reservation into the real, visible reply. */
async function completeAiReply({ row, leaseToken, reply, meta, nowMs }, { conditionalUpdate }) {
  const updated = await conditionalUpdate(
    "connect_messages",
    "id",
    row.id,
    { delivery_status: "eq.pending", delivery_lease_token: `eq.${leaseToken}` },
    {
      direction: "outbound",
      body: reply,
      delivery_status: "completed",
      delivery_completed_at: new Date(nowMs).toISOString(),
      meta: { ...messageMeta(row), source: AI_SOURCE, state: "sent", ...meta },
    },
  );
  return Boolean(updated && updated.ok === true && updated.updated);
}

/**
 * Release or retire a reservation whose generation did not produce a reply.
 *
 * retryable: age the lease so the very next 6-second poll re-claims it instead
 * of the visitor waiting out a 45-second lease for a transient blip.
 * terminal: mark it delivery_unknown so decideTakeover stops on it forever.
 */
async function releaseAiReply({ row, leaseToken, reason, retryable, nowMs }, { conditionalUpdate }) {
  const patch = retryable
    ? {
      delivery_last_attempt_at: new Date(nowMs - AI_LEASE_MS - 1000).toISOString(),
      meta: { ...messageMeta(row), source: AI_SOURCE, state: "retry", reason },
    }
    : {
      delivery_status: "delivery_unknown",
      meta: { ...messageMeta(row), source: AI_SOURCE, state: "failed", reason },
    };
  const updated = await conditionalUpdate(
    "connect_messages",
    "id",
    row.id,
    { delivery_status: "eq.pending", delivery_lease_token: `eq.${leaseToken}` },
    patch,
  );
  return Boolean(updated && updated.ok === true && updated.updated);
}

// ---------------------------------------------------------------------------
// the lead
// ---------------------------------------------------------------------------

function leadContactInfo(lead) {
  return trim(lead && lead.phone) || trim(lead && lead.email) || "";
}

/**
 * The owner opens Connect to work leads, not to read transcripts. A captured
 * name and number belong ON THE THREAD, where the inbox renders them, not
 * buried in the middle of a conversation nobody scrolls.
 *
 * Only ever fills a field in; never overwrites a detail already on the thread,
 * because the owner may have corrected it by hand. The row is re-read here
 * rather than reused from the poll: a model call is seconds long, and this is
 * the one write that could otherwise stamp on an owner's correction made in
 * the meantime.
 */
async function promoteLead({ threadId, lead, nowMs }, { select, conditionalUpdate }) {
  if (!lead || !lead.captured) return { promoted: false, reason: "nothing_captured" };
  const found = readRows(await select(
    "connect_threads",
    `select=id,contact_name,contact_info,meta&id=eq.${encodeURIComponent(trim(threadId))}&limit=1`,
  ));
  const thread = found.ok ? found.rows[0] : null;
  if (!thread) return { promoted: false, reason: "thread_unreadable" };

  const patch = {};
  const contact = leadContactInfo(lead);
  const existingName = trim(thread.contact_name);
  if (lead.name && (!existingName || existingName === "Website visitor")) patch.contact_name = lead.name.slice(0, 120);
  if (contact && !trim(thread.contact_info)) patch.contact_info = contact.slice(0, 160);
  const meta = isObject(thread.meta) ? thread.meta : {};
  patch.meta = {
    ...meta,
    lead: {
      ...(isObject(meta.lead) ? meta.lead : {}),
      ...(lead.name ? { name: lead.name.slice(0, 120) } : {}),
      ...(lead.phone ? { phone: lead.phone } : {}),
      ...(lead.email ? { email: lead.email } : {}),
      sources: lead.sources || {},
      capturedBy: AI_SOURCE,
      capturedAt: new Date(nowMs).toISOString(),
    },
  };
  const updated = await conditionalUpdate("connect_threads", "id", thread.id, {}, patch);
  return { promoted: Boolean(updated && updated.ok === true && updated.updated), fields: Object.keys(patch) };
}

function leadPushText(lead) {
  const bits = [lead.phone, lead.email].filter(Boolean);
  return bits.length ? `Lead captured: ${bits.join(" · ")}` : "Lead captured on your website chat";
}

/** Promote onto the thread, then tell the owner a LEAD came in — not a message. */
async function deliverLead({ thread, siteSlug, lead, deps }) {
  const promotion = await promoteLead({ threadId: thread.id, lead, nowMs: deps.now() }, deps)
    .catch(() => ({ promoted: false }));
  await Promise.resolve(deps.sendConnectPush({
    siteSlug,
    sender: lead.name ? `New lead: ${lead.name}` : "New lead",
    snippet: leadPushText(lead),
    threadId: String(thread.id),
    kind: "site_widget",
  })).catch(() => {});
  return promotion.promoted === true;
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

/**
 * The settings row is read on every poll, changes almost never, and every open
 * bubble on the fleet polls every six seconds. A 30-second per-process memo
 * takes that query back out of the hot path; the cost is that switching a site
 * off takes up to 30 seconds to be obeyed by an already-warm lambda, which is
 * the right trade for a toggle nobody flips twice a minute.
 *
 * Bypassed entirely when a caller injects its own reader, so a test never sees
 * another test's settings.
 */
const settingsCache = new Map();
const SETTINGS_TTL_MS = 30000;

function resetTakeoverCache() {
  settingsCache.clear();
}

async function cachedSettings(slug, reader, nowMs) {
  const hit = settingsCache.get(slug);
  if (hit && hit.expiresAt > nowMs) return hit.settings;
  const settings = await reader(slug);
  if (settingsCache.size >= 200) {
    const oldest = settingsCache.keys().next();
    if (!oldest.done) settingsCache.delete(oldest.value);
  }
  // Never cache a failure. "The store blinked" must not become "this site is
  // switched off" for the next half minute.
  if (settings && settings.ok === true) settingsCache.set(slug, { settings, expiresAt: nowMs + SETTINGS_TTL_MS });
  return settings;
}

function defaultDeps() {
  const store = require("./store");
  const { readSiteSettings } = require("./connect-site-settings");
  const { siteKb, kbGroundingBlock } = require("./connect-site-kb");
  // Required lazily (not at module load) on purpose: pulling connect-ai-reply —
  // and through it connect-site-settings and store — into the load graph at the
  // top of this file would bind those modules before a caller (a test, a boot
  // sequence) has installed its own store, which is the kind of load-order
  // coupling this deps seam exists to avoid.
  const { generateAiReply, isSimpleFactualQuestion, MAX_AI_REPLIES_PER_THREAD } = require("./connect-ai-reply");
  const { sendConnectPush } = require("./connect-push");
  const { touchThread } = require("./connect");
  return {
    select: store.select,
    insertRow: store.insertRow,
    conditionalUpdate: store.conditionalUpdate,
    recordEvent: store.recordEvent,
    readSiteSettings,
    siteKb,
    kbGroundingBlock,
    generateAiReply,
    isSimpleFactualQuestion,
    sendConnectPush,
    touchThread,
    maxReplies: MAX_AI_REPLIES_PER_THREAD,
    now: () => Date.now(),
  };
}

/**
 * runAiReply — everything after the reservation is won.
 *
 * Deliberately the slow half, and deliberately not on the poll's critical
 * path: the caller schedules it. A knowledge-base read plus a model call is
 * one to three seconds, and the poll that triggered it must stay fast because
 * every open bubble on the fleet hits it every six seconds. The visitor sees
 * the reply on the next tick, which is still faster than any human.
 */
async function runAiReply({ thread, siteSlug, messages, decision, reservation, nowMs }, deps) {
  const finish = async (reason, retryable, lead = null) => {
    await releaseAiReply({ row: reservation.row, leaseToken: reservation.leaseToken, reason, retryable, nowMs: deps.now() }, deps).catch(() => {});
    // A turn that produced no reply may still have produced a LEAD — the
    // visitor who types their number and then asks one more question the
    // assistant declines has still handed the owner a customer. Losing that
    // because the message was suppressed would be the expensive kind of quiet.
    let leadPromoted = false;
    if (lead && lead.captured) leadPromoted = await deliverLead({ thread, siteSlug, lead, deps });
    await Promise.resolve(deps.recordEvent("connect_ai_reply_skipped", { siteSlug, threadId: String(thread.id), reason, leadPromoted })).catch(() => {});
    return { ok: false, reason, leadPromoted };
  };

  let kb;
  try {
    kb = await deps.siteKb(siteSlug);
  } catch {
    return finish("kb_unavailable", true);
  }
  if (!kb || kb.ok !== true) return finish(`kb_${trim(kb && kb.reason) || "unavailable"}`, false);

  const grounding = deps.kbGroundingBlock(kb);
  // Whether the assistant's last word was the generic handoff. Two of those in
  // a row is the loop signal. Note this keys on what was actually DELIVERED,
  // not on the guard verdict: a refused turn that still closed with a lead
  // acknowledgement said something new and does not count as repeating itself.
  const lastAiReply = messages.filter((row) => row.direction === "outbound" && isAiMessage(row)).pop();
  const previousRefused = trim(messageMeta(lastAiReply).delivered) === "handoff";

  // WHICH LANGUAGES THIS VISITOR HAS ALREADY BEEN DISCLOSED TO.
  //
  // Read off the messages already on the thread, so a visitor who opens in
  // English and switches to Spanish gets the disclosure a second time, in
  // Spanish. Replies written before this field existed carry no language and
  // were English by construction.
  const disclosedLanguages = messages
    .filter((row) => row.direction === "outbound" && isAiMessage(row) && messageMeta(row).disclosed === true)
    .map((row) => trim(messageMeta(row).language) || "en");

  const generated = await deps.generateAiReply({
    kb,
    grounding,
    messages,
    isFirstAiMessage: decision.isFirstAiMessage === true,
    previousRefused,
    disclosedLanguages,
    recordEvent: deps.recordEvent,
  }).catch((error) => ({ ok: false, reason: `generate_threw_${trim(error && error.name).toLowerCase() || "error"}` }));

  if (!generated || generated.ok !== true) {
    const reason = trim(generated && generated.reason) || "generate_failed";
    // A missing corpus or a missing credential will not fix itself on the next
    // poll; a rate limit or a 5xx will. Only the second kind is retried.
    const retryable = /rate_limited|provider_5|transport_|kb_unavailable|timeout/i.test(reason);
    return finish(reason, retryable, generated && generated.lead);
  }

  const completed = await completeAiReply({
    row: reservation.row,
    leaseToken: reservation.leaseToken,
    reply: generated.reply,
    meta: {
      provider: generated.provider,
      model: generated.model,
      disclosed: generated.disclosed === true,
      // The language this reply was written in, and therefore the language the
      // disclosure was made in. The next turn reads it back to decide whether
      // this visitor has been disclosed to in the language they are now using.
      language: trim(generated.language) || "en",
      // Both recorded, deliberately: `guard` is the honest verdict on what the
      // model produced, `delivered` is what the customer actually received.
      // Collapsing them would hide a refusal behind a good outcome.
      guard: generated.guard && generated.guard.ok === true ? "pass" : `refused:${trim(generated.guard && generated.guard.reason)}`,
      delivered: trim(generated.delivered) || "model",
      answering_message_id: trim(decision.answeringMessageId),
    },
    nowMs: deps.now(),
  }, deps);
  if (!completed) return finish("completion_lost", false);

  // last_message_at only. `unread` is deliberately untouched: the assistant
  // answering does not mean the owner has seen the lead, and marking it read
  // here would bury a live customer at the bottom of the inbox.
  await Promise.resolve(deps.touchThread(thread.id, {})).catch(() => {});

  const lead = generated.lead || { captured: false };
  const promotion = { promoted: lead.captured ? await deliverLead({ thread, siteSlug, lead, deps }) : false };

  await Promise.resolve(deps.recordEvent("connect_ai_reply_sent", {
    siteSlug,
    threadId: String(thread.id),
    provider: generated.provider || "",
    guard: generated.guard && generated.guard.ok === true ? "pass" : trim(generated.guard && generated.guard.reason),
    disclosed: generated.disclosed === true,
    language: trim(generated.language) || "en",
    leadCaptured: lead.captured === true,
    leadPromoted: promotion.promoted === true,
  })).catch(() => {});

  return { ok: true, reason: "sent", leadCaptured: lead.captured === true, guard: generated.guard };
}

/**
 * evaluateAiTakeover({ threadId, siteSlug }) -> { generate, reason, run? }
 *
 * The synchronous half, called from api/connect/chat-poll.js. It reads state,
 * decides, and CLAIMS — all cheap. When it claims, it hands back `run`, a
 * promise-returning function the caller schedules with waitUntil.
 *
 * Never throws. A chat that will not load because the assistant had an opinion
 * about it is a worse product than a chat with no assistant.
 */
async function evaluateAiTakeover({ threadId, siteSlug, thread = null }, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    const nowMs = deps.now();
    let threadRow = thread;
    if (!threadRow) {
      const found = readRows(await deps.select(
        "connect_threads",
        `select=id,site_slug,channel,meta,contact_name,contact_info,unread&id=eq.${encodeURIComponent(trim(threadId))}&limit=1`,
      ));
      threadRow = found.ok ? found.rows[0] || null : null;
    }
    if (!threadRow) return { generate: false, reason: "thread_not_found" };
    // The caller's token already proved this pairing; re-assert it anyway,
    // because this is the last place a mismatch could put site A's assistant
    // in site B's conversation.
    if (trim(threadRow.site_slug) !== trim(siteSlug)) return { generate: false, reason: "thread_slug_mismatch" };

    const settings = overrides.readSiteSettings
      ? await deps.readSiteSettings(siteSlug)
      : await cachedSettings(trim(siteSlug), deps.readSiteSettings, nowMs);
    if (!settings || settings.aiChatEnabled !== true) {
      return { generate: false, reason: settings && settings.reason ? `ai_chat_disabled:${settings.reason}` : "ai_chat_disabled" };
    }

    const read = await readThreadMessages(threadRow.id, deps);
    if (!read.ok) return { generate: false, reason: "messages_unavailable" };

    // Is the visitor's latest message a plain factual lookup? If so the
    // owner-first window collapses to the fast lane, so hours/address/services/
    // area questions are answered in seconds instead of after a 30-second wait.
    const lastInbound = read.rows.filter((row) => row && row.direction === "inbound").pop();
    const factualLookup = deps.isSimpleFactualQuestion(lastInbound && lastInbound.body);

    const decision = decideTakeover({
      thread: threadRow,
      messages: read.rows,
      settings,
      nowMs,
      maxReplies: deps.maxReplies,
      factualLookup,
    });
    if (!decision.generate) return decision;

    const reservation = await reserveAiReply({
      threadId: threadRow.id,
      answeringMessageId: decision.answeringMessageId,
      existing: decision.reservation,
      nowMs,
    }, deps);
    if (reservation.state !== "reserved") {
      return { generate: false, reason: reservation.reason || reservation.state };
    }

    return {
      generate: true,
      reason: decision.reason,
      answeringMessageId: decision.answeringMessageId,
      run: () => runAiReply({
        thread: threadRow,
        siteSlug: trim(siteSlug),
        messages: read.rows,
        decision,
        reservation,
        nowMs,
      }, deps),
    };
  } catch (error) {
    return { generate: false, reason: `takeover_error_${trim(error && error.name).toLowerCase() || "error"}` };
  }
}

/**
 * scheduleAiTakeover — decide and claim now, generate after the response.
 *
 * The shared entry point for every endpoint that should give the assistant a
 * chance to answer: the widget poll (api/connect/chat-poll.js) AND the two
 * places a visitor SENDS a message (chat-start, chat-post). Triggering on the
 * send — not only on the next six-second poll tick — is what lets a fast-lane
 * factual answer be generated the instant it is asked, so the visitor sees it
 * in a couple of seconds instead of waiting for a poll to even look. A message
 * that is NOT a fast-lane lookup evaluates to within_owner_window here and does
 * nothing; the poll picks it up later exactly as before.
 *
 * Wrapped so nothing in here can change what the caller serves the visitor: a
 * chat that will not send because the assistant had a problem is a worse product
 * than a chat with no assistant. The model call is handed to waitUntil so it
 * runs AFTER the response; where there is no request context (local, tests) the
 * task runs inline and owns its own rejection.
 */
let cachedWaitUntil;
function resolveWaitUntil() {
  if (cachedWaitUntil !== undefined) return cachedWaitUntil;
  try {
    cachedWaitUntil = require("@vercel/functions").waitUntil;
  } catch {
    cachedWaitUntil = null;
  }
  return cachedWaitUntil;
}

async function scheduleAiTakeover({ threadId, siteSlug, thread = null } = {}, overrides = {}) {
  try {
    const verdict = await evaluateAiTakeover({ threadId, siteSlug, thread }, overrides);
    if (!verdict || verdict.generate !== true || typeof verdict.run !== "function") {
      return verdict || { generate: false, reason: "no_verdict" };
    }
    const task = Promise.resolve().then(verdict.run).catch(() => {});
    const waitUntil = resolveWaitUntil();
    if (typeof waitUntil === "function") {
      try { waitUntil(task); } catch { task.catch(() => {}); }
    } else {
      task.catch(() => {});
    }
    return verdict;
  } catch {
    // The send's or poll's answer is never contingent on this.
    return { generate: false, reason: "schedule_error" };
  }
}

module.exports = {
  AI_LEASE_MS,
  AI_SOURCE,
  FAST_LANE_SECONDS,
  MAX_ATTEMPTS,
  RESERVED_BODY,
  aiClientMessageId,
  decideTakeover,
  evaluateAiTakeover,
  promoteLead,
  resetTakeoverCache,
  runAiReply,
  scheduleAiTakeover,
  _test: {
    MESSAGE_WINDOW,
    SETTINGS_TTL_MS,
    cachedSettings,
    settingsCache,
    completeAiReply,
    isAiMessage,
    isOwnerMessage,
    isReservation,
    leadPushText,
    readThreadMessages,
    releaseAiReply,
    reserveAiReply,
    uniqueConflict,
  },
};
