"use strict";
// Ingest a lead/message from any source (site chat widget, contact form,
// Riley call summary, SMS gateway, voicemail transcriber). Idempotent per
// threadKey; every source must be a REAL event — this endpoint never invents.
const { connectAuthorized, readBody, ensureThread, addMessage, touchThread } = require("../../lib/connect");
const { recordEvent } = require("../../lib/store");

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://connect.wss-labs.com");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") { res.statusCode = 405; return res.end("method not allowed"); }
  if (!connectAuthorized(req)) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: "unauthorized" })); }
  try {
    const b = await readBody(req);
    const siteSlug = String(b.siteSlug || "").trim();
    const channel = String(b.channel || "").trim();
    const text = String(b.body || "").trim().slice(0, 8000);
    if (!siteSlug || !channel || !text) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: "siteSlug, channel, body required" })); }
    const threadKey = String(b.threadKey || `${siteSlug}:${channel}:${(b.contactInfo || "anon").toLowerCase()}`).slice(0, 300);
    const thread = await ensureThread({
      threadKey, siteSlug, channel,
      contactName: b.contactName, contactInfo: b.contactInfo, subject: b.subject,
    });
    const msg = await addMessage(thread.id, b.direction === "system" ? "system" : "inbound", text, b.meta);
    await touchThread(thread.id, { unread: true });
    await recordEvent("connect_ingest", { threadKey, channel, siteSlug });
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, threadId: thread.id, messageId: msg?.id }));
  } catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
};
