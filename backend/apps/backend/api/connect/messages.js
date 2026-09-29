"use strict";
// GET /api/connect/messages?thread=<id> — the messages in one lead thread.
//
// Scoped exactly like threads.js/site.js/visibility.js, with the SAME asymmetry:
//   * a full/admin token (the operator Connect app) may open any thread;
//   * a per-customer scoped token may open ONLY a thread whose site_slug matches
//     the slug its token was signed for. A tenant that names a thread belonging
//     to another business gets 404 — the same answer as a thread that does not
//     exist, so thread ids are not a probe for other tenants' inboxes.
// This is what lets the customer dashboard read its own conversations without a
// second app or the shared full-access token.
const { resolveConnectScope, touchThread } = require("../../lib/connect");
const { select } = require("../../lib/store");

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = ["https://connect.wss-labs.com", "https://wss-ai.com", "https://www.wss-ai.com"];
  res.setHeader("Access-Control-Allow-Origin", allowed.includes(origin) ? origin : "https://connect.wss-labs.com");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const scope = resolveConnectScope(req);
  if (!scope) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: "unauthorized" })); }
  try {
    const threadId = parseInt(String(req.query?.thread || ""), 10);
    if (!threadId) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: "thread required" })); }

    // A tenant may only read a thread that belongs to its own site. Resolve the
    // thread first and check ownership before returning any message body or
    // clearing the unread flag. Fail closed: a mismatched or missing thread is
    // a 404 for a tenant, never someone else's conversation.
    const threadRes = await select("connect_threads", `id=eq.${threadId}&limit=1`);
    const thread = threadRes?.ok && Array.isArray(threadRes.data) ? threadRes.data[0] : null;
    if (scope.mode === "tenant") {
      if (!thread || String(thread.site_slug || "") !== String(scope.siteSlug || "")) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, error: "thread_not_found" }));
      }
    }

    const found = await select("connect_messages", `thread_id=eq.${threadId}&order=created_at.asc&limit=500`);
    // Marking read is a benign write, and by here ownership is proven for a
    // tenant (and unrestricted for the operator).
    await touchThread(threadId, { unread: false });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({ ok: true, messages: (found?.data) || [], scope: scope.mode }));
  } catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
};
