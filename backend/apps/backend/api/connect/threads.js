"use strict";

const { resolveConnectScope } = require("../../lib/connect");
const { select } = require("../../lib/store");

const THREAD_PAGE_SIZE = 200;
const THREAD_HARD_CAP = 1000;
const MESSAGE_PAGE_SIZE = 500;
const MESSAGE_HARD_CAP = 10000;
const MESSAGE_THREAD_CHUNK_SIZE = 100;
const RECENT_LEAD_LIMIT = 8;
const TENANT_THREAD_FIELDS = [
  "id",
  "site_slug",
  "channel",
  "contact_name",
  "contact_info",
  "subject",
  "unread",
  "last_message_at",
  "created_at",
  // meta carries the captured lead (meta.lead.{name,phone,email}) written by
  // the assistant's promoteLead. Read here, distilled into contact fields, and
  // STRIPPED before the response — the wire shape stays flat.
  "meta",
].join(",");

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://connect.wss-labs.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

function fail(res, statusCode, error) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify({ ok: false, error }));
}

function sourceFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function appendQuery(base, name, value) {
  return `${base}${base ? "&" : ""}${name}=${value}`;
}

async function readPaged(table, baseQuery, { pageSize, cap }) {
  const rows = [];
  let offset = 0;
  while (true) {
    // Read one row beyond the cap so an exactly-full source can be
    // distinguished from a truncated source. A truncated metric is not a
    // measured metric, so it fails closed instead of being shown as a total.
    const limit = Math.min(pageSize, Math.max(1, cap - rows.length + 1));
    let query = appendQuery(baseQuery, "limit", limit);
    query = appendQuery(query, "offset", offset);
    const found = await select(table, query);
    if (found?.ok !== true || !Array.isArray(found.data)) {
      throw sourceFailure(`${table}_read_failed`);
    }
    const page = found.data;
    rows.push(...page);
    if (rows.length > cap) throw sourceFailure(`${table}_cap_exceeded`);
    if (page.length < limit) return rows;
    offset += page.length;
  }
}

function canonicalThreadId(value) {
  const raw = String(value ?? "").trim();
  return /^(?:[1-9]\d*)$/.test(raw) ? raw : "";
}

function utcWeekStart(nowMs) {
  const now = new Date(nowMs);
  if (!Number.isFinite(now.getTime())) throw sourceFailure("invalid_summary_clock");
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = new Date(midnight).getUTCDay();
  return midnight - ((day + 6) % 7) * 24 * 60 * 60 * 1000;
}

function timeMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function safePlainText(value, fallback, maxLength) {
  const normalized = String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, maxLength).trim();
}

// ---------------------------------------------------------------------------
// THE CAPTURED CONTACT, DISTILLED. The walkthrough asked, verbatim, "where's
// the phone number extraction... where's the phone number information going".
// It was going into connect_threads.contact_info and meta.lead — columns this
// endpoint read and never surfaced. A lead card needs a NAME, a TAPPABLE
// PHONE, WHAT THEY ASKED, and WHEN; these helpers produce the first two from
// what the assistant actually captured, never from guesses.
// ---------------------------------------------------------------------------

function threadMetaLead(thread) {
  const meta = thread && typeof thread.meta === "object" && !Array.isArray(thread.meta) ? thread.meta : null;
  const lead = meta && typeof meta.lead === "object" && !Array.isArray(meta.lead) ? meta.lead : null;
  return lead || {};
}

function looksLikePhone(value) {
  const raw = String(value || "").trim();
  if (!raw || /@/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function looksLikeEmail(value) {
  const raw = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw);
}

/** { phone, email } — captured lead detail first, contact_info classified second. */
function threadContactDetails(thread) {
  const lead = threadMetaLead(thread);
  const info = String(thread && thread.contact_info || "").trim();
  const phone = String(lead.phone || "").trim() || (looksLikePhone(info) ? info : "");
  const email = String(lead.email || "").trim() || (looksLikeEmail(info) ? info : "");
  return {
    phone: phone.slice(0, 40),
    email: email.slice(0, 160),
  };
}

function compareMessages(left, right) {
  const byTime = timeMs(left?.created_at) - timeMs(right?.created_at);
  if (byTime) return byTime;
  const leftId = canonicalThreadId(left?.id);
  const rightId = canonicalThreadId(right?.id);
  if (leftId && rightId) {
    try {
      const byId = BigInt(leftId) - BigInt(rightId);
      if (byId < 0n) return -1;
      if (byId > 0n) return 1;
    } catch { /* the timestamp ordering remains authoritative */ }
  }
  return 0;
}

function buildTenantSummary(threads, messages, nowMs = Date.now()) {
  const weekStartedMs = utcWeekStart(nowMs);
  const previousWeekStartedMs = weekStartedMs - 7 * 24 * 60 * 60 * 1000;
  const nextWeekStartedMs = weekStartedMs + 7 * 24 * 60 * 60 * 1000;
  const messagesByThread = new Map();

  for (const message of messages) {
    const threadId = canonicalThreadId(message?.thread_id);
    if (!threadId) continue;
    const list = messagesByThread.get(threadId) || [];
    list.push(message);
    messagesByThread.set(threadId, list);
  }

  const leads = [];
  for (const thread of threads) {
    const threadId = canonicalThreadId(thread?.id);
    if (!threadId) throw sourceFailure("connect_thread_id_invalid");
    const threadMessages = (messagesByThread.get(threadId) || []).sort(compareMessages);
    const inbound = threadMessages.filter((message) => message?.direction === "inbound");
    if (!inbound.length) continue;

    const firstInbound = inbound[0];
    const lastInbound = inbound[inbound.length - 1];
    const lastInboundIndex = threadMessages.lastIndexOf(lastInbound);
    const laterOutboundAttempt = threadMessages
      .slice(lastInboundIndex + 1)
      .some((message) => message?.direction === "outbound");
    const firstInboundMs = timeMs(firstInbound?.created_at);
    const lastMessageMs = Math.max(
      timeMs(thread?.last_message_at),
      ...threadMessages.map((message) => timeMs(message?.created_at)),
    );

    leads.push({
      threadId,
      name: safePlainText(thread?.contact_name, "Website visitor", 80),
      firstLine: safePlainText(firstInbound?.body, "New website message", 180),
      channel: String(thread?.channel || "").trim().slice(0, 24) || "other",
      firstInboundMs,
      lastMessageMs,
      needsReply: !laterOutboundAttempt,
    });
  }

  const thisWeek = leads.filter((lead) => lead.firstInboundMs >= weekStartedMs && lead.firstInboundMs < nextWeekStartedMs).length;
  const previousWeek = leads.filter((lead) => lead.firstInboundMs >= previousWeekStartedMs && lead.firstInboundMs < weekStartedMs).length;
  const recentLeads = [...leads]
    .sort((left, right) => right.lastMessageMs - left.lastMessageMs)
    .slice(0, RECENT_LEAD_LIMIT)
    .map((lead) => ({
      threadId: lead.threadId,
      name: lead.name,
      firstLine: lead.firstLine,
      channel: lead.channel,
      createdAt: Number.isFinite(lead.firstInboundMs) ? new Date(lead.firstInboundMs).toISOString() : null,
      lastMessageAt: Number.isFinite(lead.lastMessageMs) ? new Date(lead.lastMessageMs).toISOString() : null,
      needsReply: lead.needsReply,
    }));

  // What each thread's card needs, keyed by thread id, computed from the same
  // messages the counts came from — one read, one truth.
  const byThread = {};
  for (const lead of leads) {
    byThread[lead.threadId] = { firstLine: lead.firstLine, needsReply: lead.needsReply };
  }

  return {
    newLeads: {
      count: leads.length,
      thisWeek,
      previousWeek,
      changeVsPreviousWeek: thisWeek - previousWeek,
      weekStartedAt: new Date(weekStartedMs).toISOString(),
    },
    unrepliedCount: leads.filter((lead) => lead.needsReply).length,
    recentLeads,
    byThread,
  };
}

async function readTenantThreads(siteSlug) {
  const baseQuery = [
    `select=${TENANT_THREAD_FIELDS}`,
    `site_slug=eq.${encodeURIComponent(siteSlug)}`,
    "order=last_message_at.desc,id.desc",
  ].join("&");
  const returned = await readPaged("connect_threads", baseQuery, {
    pageSize: THREAD_PAGE_SIZE,
    cap: THREAD_HARD_CAP,
  });
  // The service role bypasses RLS. Keep the PostgREST predicate for efficient
  // reads, then treat it as untrusted and enforce ownership again in process.
  return returned.filter((thread) => String(thread?.site_slug || "") === siteSlug);
}

async function readTenantMessages(threads) {
  const ownedIds = threads.map((thread) => canonicalThreadId(thread?.id));
  if (ownedIds.some((id) => !id)) throw sourceFailure("connect_thread_id_invalid");
  const uniqueIds = [...new Set(ownedIds)];
  const owned = new Set(uniqueIds);
  const messages = [];
  let sourceRowsRead = 0;

  for (let index = 0; index < uniqueIds.length; index += MESSAGE_THREAD_CHUNK_SIZE) {
    const ids = uniqueIds.slice(index, index + MESSAGE_THREAD_CHUNK_SIZE);
    const remaining = MESSAGE_HARD_CAP - sourceRowsRead;
    const baseQuery = [
      "select=id,thread_id,direction,body,delivery_status,created_at",
      `thread_id=in.(${ids.join(",")})`,
      "order=created_at.asc,id.asc",
    ].join("&");
    const returned = await readPaged("connect_messages", baseQuery, {
      pageSize: MESSAGE_PAGE_SIZE,
      cap: remaining,
    });
    sourceRowsRead += returned.length;
    // Recheck the foreign key because these reads use service_role too.
    messages.push(...returned.filter((message) => owned.has(canonicalThreadId(message?.thread_id))));
  }
  return messages;
}

async function fullScopeThreads() {
  const found = await select("connect_threads", "order=last_message_at.desc&limit=200");
  if (found?.ok !== true || !Array.isArray(found.data)) throw sourceFailure("connect_threads_read_failed");
  return found.data;
}

async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") return fail(res, 405, "method_not_allowed");

  const scope = resolveConnectScope(req);
  if (!scope) return fail(res, 401, "unauthorized");

  try {
    let threads;
    let summary;
    if (scope.mode === "tenant") {
      const tenantThreads = await readTenantThreads(scope.siteSlug);
      const messages = await readTenantMessages(tenantThreads);
      summary = buildTenantSummary(tenantThreads, messages);
      // The card shape: captured contact distilled onto the thread, meta
      // stripped back off the wire. contact_phone is what makes the number
      // TAPPABLE; first_line is "what they asked for"; needs_reply drives the
      // unread dot honestly (a lead the owner answered is not "new").
      threads = tenantThreads.map((thread) => {
        const { phone, email } = threadContactDetails(thread);
        const card = summary.byThread[canonicalThreadId(thread && thread.id)] || {};
        const { meta, ...bare } = thread || {};
        return {
          ...bare,
          contact_phone: phone,
          contact_email: email,
          first_line: card.firstLine || "",
          needs_reply: card.needsReply === true,
        };
      });
    } else {
      threads = await fullScopeThreads();
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({
      ok: true,
      threads,
      scope: scope.mode,
      ...(scope.mode === "tenant" ? { summary } : {}),
    }));
  } catch {
    return fail(res, 503, "source_unavailable");
  }
}

module.exports = handler;
module.exports._private = {
  buildTenantSummary,
  canonicalThreadId,
  readPaged,
  safePlainText,
  threadContactDetails,
  utcWeekStart,
};
