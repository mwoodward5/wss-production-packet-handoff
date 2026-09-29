"use strict";

// Shared policy for the public website-chat endpoints.
//
// The browser may name a site only when starting a session. That slug is
// checked against our own access/prospect rows before it can become a routing
// key. After that, the only authority is a short-lived signed visitor token;
// thread ids or slugs sent in request bodies are deliberately ignored.

const { randomUUID } = require("node:crypto");
const { waitUntil } = require("@vercel/functions");
const { addMessage, touchThread } = require("./connect");
const { sendConnectPush } = require("./connect-push");
const {
  signVisitorToken,
  verifyVisitorToken,
  VISITOR_TOKEN_SECRET_ENV_NAME = "CONNECT_VISITOR_TOKEN_SECRET",
} = require("./connect-visitor-token");
const {
  SLUG_RE,
  clientIp,
  createRateLimiter,
  slugFromHost,
} = require("./mirror-lead");
const { insertRow, recordEvent, select } = require("./store");

const MESSAGE_CAP = 2000;
const TOKEN_CAP = 2048;
const RAW_BODY_CAP = 16 * 1024;
const CURSOR_RE = /^\d{1,20}$/;
const THREAD_ID_RE = /^[1-9]\d{0,19}$/;
const RATE_WINDOW_MS = 60_000;

const LIMITS = Object.freeze({
  start: Object.freeze({ ip: 8, slug: 20 }),
  post: Object.freeze({ ip: 20, slug: 60 }),
  // Six-second polling is ten requests/minute. Sixty leaves room for several
  // tabs on one household/NAT without weakening the per-tenant ceiling.
  poll: Object.freeze({ ip: 60, slug: 300 }),
});

function makeLimiters() {
  const result = {};
  for (const [kind, limits] of Object.entries(LIMITS)) {
    result[kind] = {
      ip: createRateLimiter({ windowMs: RATE_WINDOW_MS, max: limits.ip }),
      slug: createRateLimiter({ windowMs: RATE_WINDOW_MS, max: limits.slug }),
    };
  }
  return result;
}

let limiters = makeLimiters();

function resetRateLimits() {
  limiters = makeLimiters();
}

function setCors(req, res) {
  const origin = String(req && req.headers && req.headers.origin || "").trim();
  if (originSiteSlug(req)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (typeof res.removeHeader === "function") {
    // vercel.json supplies a broad API default. Remove it explicitly when the
    // request is not from a mirror so an invalid Origin cannot inherit `*`.
    res.removeHeader("Access-Control-Allow-Origin");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-visitor-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function originSiteSlug(req) {
  const origin = String(req && req.headers && req.headers.origin || "").trim();
  const match = origin.match(/^https:\/\/([a-z0-9][a-z0-9-]{2,79})\.wss-ai\.com$/);
  return match ? normalizeSiteSlug(match[1]) : "";
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

function bodyTooLarge() {
  const error = new Error("request body too large");
  error.code = "request_body_too_large";
  return error;
}

function parseJsonObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Bounded JSON reader for public endpoints; never accumulates past 16 KiB. */
async function readPublicBody(req, maxBytes = RAW_BODY_CAP) {
  const supplied = req && req.body;
  if (supplied && typeof supplied === "object" && !Buffer.isBuffer(supplied) && !Array.isArray(supplied)) {
    let encoded;
    try { encoded = JSON.stringify(supplied); } catch { return {}; }
    if (Buffer.byteLength(encoded, "utf8") > maxBytes) throw bodyTooLarge();
    return supplied;
  }
  if (typeof supplied === "string" || Buffer.isBuffer(supplied)) {
    if (Buffer.byteLength(supplied) > maxBytes) throw bodyTooLarge();
    return parseJsonObject(supplied);
  }
  // A platform adapter may have parsed valid JSON into null, an array, or a
  // primitive. That still means the request stream has already been consumed;
  // never attach listeners and wait forever. Bound the supplied value, then
  // treat every non-object JSON shape as an empty input.
  if (supplied !== undefined) {
    let encoded;
    try { encoded = JSON.stringify(supplied); } catch { return {}; }
    if (Buffer.byteLength(String(encoded || ""), "utf8") > maxBytes) throw bodyTooLarge();
    return {};
  }

  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let oversized = false;
    req.on("data", (chunk) => {
      if (oversized) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      total += bytes.length;
      if (total > maxBytes) {
        oversized = true;
        chunks.length = 0;
        return;
      }
      chunks.push(bytes);
    });
    req.on("end", () => {
      if (oversized) return reject(bodyTooLarge());
      return resolve(Buffer.concat(chunks).toString("utf8") || "{}");
    });
    req.on("error", reject);
  });
  return parseJsonObject(raw);
}

function normalizeSiteSlug(value) {
  const slug = String(value == null ? "" : value).trim().toLowerCase().slice(0, 80);
  return SLUG_RE.test(slug) ? slug : "";
}

function normalizeMessage(value) {
  return String(value == null ? "" : value).trim().slice(0, MESSAGE_CAP);
}

function honeypotFilled(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return Boolean(String(body.website || body.company_website || "").trim().slice(0, 10));
}

function visitorToken(req) {
  const value = String(req && req.headers && req.headers["x-connect-visitor-token"] || "").trim();
  return value.length > TOKEN_CAP ? "" : value;
}

function visitorClaims(req) {
  const token = visitorToken(req);
  if (!token) return null;
  const verified = verifyVisitorToken(token);
  if (!verified || verified.ok !== true) return null;
  const threadId = String(verified.threadId == null ? "" : verified.threadId).trim();
  const siteSlug = normalizeSiteSlug(verified.siteSlug);
  if (!THREAD_ID_RE.test(threadId) || !siteSlug) return null;
  return { threadId, siteSlug };
}

function visitorSigningReady(env = process.env) {
  const secret = String(env && env[VISITOR_TOKEN_SECRET_ENV_NAME] || "").trim();
  return Buffer.byteLength(secret, "utf8") >= 32;
}

function normalizeCursor(value) {
  const raw = String(value == null || value === "" ? "0" : value).trim();
  return CURSOR_RE.test(raw) ? raw.replace(/^0+(?=\d)/, "") : null;
}

function ipRateLimited(kind, req) {
  const limiter = limiters[kind] && limiters[kind].ip;
  if (!limiter) return true;
  return limiter.hit(String(clientIp(req)).slice(0, 80));
}

function slugRateLimited(kind, siteSlug) {
  const limiter = limiters[kind] && limiters[kind].slug;
  if (!limiter) return true;
  return limiter.hit(normalizeSiteSlug(siteSlug) || "invalid");
}

function readRows(result) {
  if (Array.isArray(result)) return { ok: true, rows: result };
  if (result && result.ok === true && Array.isArray(result.data)) {
    return { ok: true, rows: result.data };
  }
  if (result && result.mode === "live_select" && Array.isArray(result.rows)) {
    return { ok: true, rows: result.rows };
  }
  return { ok: false, rows: [] };
}

function rowPreviewUrl(row) {
  return String(row && row.preview_url || "").trim();
}

/**
 * A public caller may use a slug only when it resolves to a site in our own
 * data. The exact match after the broad preview-url query prevents a slug from
 * routing to a different business that merely contains the same text.
 */
async function knownSite(siteSlug, selectRows = select) {
  const slug = normalizeSiteSlug(siteSlug);
  if (!slug) return { ok: false, unavailable: false };

  const [accessRaw, prospectRaw] = await Promise.all([
    Promise.resolve().then(() => selectRows(
      "ghost_agency_dashboard_access",
      `select=job_id,site_slug&site_slug=eq.${encodeURIComponent(slug)}&limit=5`,
    )).catch(() => null),
    Promise.resolve().then(() => selectRows(
      "ghost_agency_prospects",
      `select=prospect_id,status,preview_url&preview_url=ilike.*${encodeURIComponent(slug)}*&limit=25`,
    )).catch(() => null),
  ]);

  const access = readRows(accessRaw);
  if (access.ok && access.rows.some((row) => (
    normalizeSiteSlug(row && row.site_slug) === slug
    && !String(row && row.job_id || "").toLowerCase().startsWith("prospect-")
  ))) {
    return { ok: true, source: "access" };
  }

  const prospects = readRows(prospectRaw);
  if (prospects.ok) {
    const exact = prospects.rows.filter((row) => {
      const status = String(row && row.status || "").toLowerCase();
      return status !== "archived_legacy" && slugFromHost(rowPreviewUrl(row)) === slug;
    });
    if (exact.length === 1) return { ok: true, source: "prospect" };
    // Ambiguous ownership is a hard refusal, not a coin flip.
    if (exact.length > 1) return { ok: false, unavailable: false };
  }

  return { ok: false, unavailable: !access.ok || !prospects.ok };
}

function normalizeThreadId(value) {
  const id = String(value == null ? "" : value).trim();
  return THREAD_ID_RE.test(id) ? id : "";
}

async function createVisitorMessage({ siteSlug, body }) {
  // Refuse before the first write when this deployment cannot mint the
  // credential needed to reopen the conversation.
  if (!visitorSigningReady()) throw new Error("visitor session signing is unavailable");

  const inserted = await insertRow("connect_threads", {
    thread_key: `${siteSlug}:site_widget:${randomUUID()}`.slice(0, 300),
    site_slug: siteSlug,
    channel: "chat",
    contact_name: "Website visitor",
    contact_info: null,
    subject: "Website chat",
    meta: { source: "site_widget" },
  });
  if (!inserted || inserted.mode !== "live_write") throw new Error("chat thread was not created");
  const thread = Array.isArray(inserted.row) ? inserted.row[0] : inserted.row;
  const threadId = normalizeThreadId(thread && thread.id);
  if (!threadId) throw new Error("chat thread was not created");

  try {
    // Mint before writing the first message. If either step fails, remove the
    // exact empty thread created above so Connect never gains a ghost card.
    const token = signVisitorToken({ threadId, siteSlug });
    if (!token) throw new Error("visitor session signing is unavailable");
    const message = await addMessage(threadId, "inbound", body, { source: "site_widget" });
    // The message is already durable and `unread` defaults true on creation;
    // a best-effort timestamp touch must not turn that success into a retry.
    await Promise.resolve(touchThread(threadId, { unread: true })).catch(() => {});
    return { threadId, messageId: normalizeThreadId(message && message.id), token };
  } catch (error) {
    await removeFailedStartThread(threadId).catch(() => {});
    throw error;
  }
}

async function removeFailedStartThread(threadId, env = process.env) {
  const base = String(env && env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env && env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!base || !key || !normalizeThreadId(threadId)) return false;
  const url = new URL(`${base}/rest/v1/connect_threads`);
  url.searchParams.set("id", `eq.${threadId}`);
  url.searchParams.set("meta->>source", "eq.site_widget");
  const response = await fetch(url, {
    method: "DELETE",
    redirect: "manual",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal",
    },
  });
  return response.ok;
}

async function ownedThread({ threadId, siteSlug }, selectRows = select) {
  const found = readRows(await selectRows(
    "connect_threads",
    [
      "select=id,site_slug,channel,meta",
      `id=eq.${encodeURIComponent(threadId)}`,
      `site_slug=eq.${encodeURIComponent(siteSlug)}`,
      "channel=eq.chat",
      "meta->>source=eq.site_widget",
      "limit=1",
    ].join("&"),
  ));
  if (!found.ok) {
    const error = new Error("chat store unavailable");
    error.code = "chat_store_unavailable";
    throw error;
  }
  const row = found.rows[0];
  if (!row
    || normalizeThreadId(row.id) !== threadId
    || normalizeSiteSlug(row.site_slug) !== siteSlug
    || String(row.channel || "") !== "chat"
    || !row.meta
    || String(row.meta.source || "") !== "site_widget") return null;
  return row;
}

async function addVisitorMessage({ threadId, siteSlug, body }, selectRows = select) {
  const thread = await ownedThread({ threadId, siteSlug }, selectRows);
  if (!thread) return null;
  const message = await addMessage(threadId, "inbound", body, { source: "site_widget" });
  await Promise.resolve(touchThread(threadId, { unread: true })).catch(() => {});
  return { messageId: normalizeThreadId(message && message.id) };
}

function safeMessage(row) {
  const direction = String(row && row.direction || "");
  if (direction !== "inbound" && direction !== "outbound") return null;
  const id = normalizeThreadId(row && row.id);
  if (!id) return null;
  return {
    id,
    direction,
    body: String(row && row.body || "").slice(0, 5000),
    createdAt: String(row && row.created_at || "").slice(0, 40),
  };
}

async function readVisitorMessages({ threadId, siteSlug, after }, selectRows = select) {
  const thread = await ownedThread({ threadId, siteSlug }, selectRows);
  if (!thread) return null;
  const query = [
    "select=id,direction,body,created_at",
    `thread_id=eq.${encodeURIComponent(threadId)}`,
    ...(after !== "0" ? [`id=gt.${encodeURIComponent(after)}`] : []),
    "order=id.asc",
    "limit=200",
  ].join("&");
  const found = readRows(await selectRows("connect_messages", query));
  if (!found.ok) {
    const error = new Error("chat store unavailable");
    error.code = "chat_store_unavailable";
    throw error;
  }
  const messages = found.rows.map(safeMessage).filter(Boolean);
  const lastRawId = found.rows.length
    ? normalizeThreadId(found.rows[found.rows.length - 1] && found.rows[found.rows.length - 1].id)
    : "";
  // The thread row rides along so a caller that needs it — the AI takeover
  // evaluated inside chat-poll — does not re-read a row this call already
  // fetched and already proved belongs to this visitor's tenant.
  return { messages, cursor: lastRawId || after, thread };
}

function safePushErrorCode(error) {
  return String(error && (error.code || error.name) || "push_error")
    .toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80) || "push_error";
}

/** Schedule only after the message is durable. Push failure never changes chat. */
function queueVisitorPush({ siteSlug, threadId, snippet }) {
  const task = Promise.resolve().then(() => sendConnectPush({
    siteSlug,
    sender: "Website visitor",
    snippet: normalizeMessage(snippet).replace(/\s+/g, " ").slice(0, 80) || "New website message",
    threadId,
    kind: "site_widget",
  })).catch((error) => Promise.resolve().then(() => recordEvent("connect_push_failed", {
    siteSlug,
    source: "site_widget",
    threadId,
    code: safePushErrorCode(error),
  })).catch(() => {}));

  try {
    waitUntil(task);
  } catch {
    // Local/test runtimes have no request context. The already-started promise
    // still owns its rejection and remains best effort.
    task.catch(() => {});
  }
}

module.exports = {
  addVisitorMessage,
  createVisitorMessage,
  honeypotFilled,
  ipRateLimited,
  knownSite,
  normalizeCursor,
  normalizeMessage,
  normalizeSiteSlug,
  originSiteSlug,
  ownedThread,
  queueVisitorPush,
  readPublicBody,
  readVisitorMessages,
  sendJson,
  setCors,
  slugRateLimited,
  visitorClaims,
  visitorSigningReady,
  _test: {
    LIMITS,
    MESSAGE_CAP,
    RAW_BODY_CAP,
    RATE_WINDOW_MS,
    readRows,
    removeFailedStartThread,
    resetRateLimits,
    safeMessage,
  },
};
