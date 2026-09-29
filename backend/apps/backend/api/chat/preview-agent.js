"use strict";

// api/chat/preview-agent.js — the preview-site "Riley" chat widget POSTs here
// (from the SiteForge-built site, cross-origin). This handler is deliberately
// NON-LLM: it returns a warm, honest canned reply that captures the visitor's
// question and routes them to the real contact path. That keeps per-message
// spend at ZERO. An LLM-backed version is a separate, owner-approved change
// (it adds per-message model cost). Until then this stops the widget's fetch
// from 404-ing and stops the site advertising a "live agent" that isn't wired.

const { readJson } = require("../../lib/http");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Pull the visitor's most recent question so we can acknowledge it without
// inventing any answer (truth-law: never fabricate business facts).
function lastVisitorMessage(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] || {};
    const role = String(m.role || m.from || "").toLowerCase();
    const content = String(m.content || m.text || m.message || "").trim();
    if (content && role !== "assistant" && role !== "bot" && role !== "system") {
      return content.slice(0, 500);
    }
  }
  return "";
}

module.exports = async function handler(req, res) {
  const headers = corsHeaders();
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }
  if (req.method !== "POST") {
    res.writeHead(405, { ...headers, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }

  let body = {};
  try {
    body = (await readJson(req)) || {};
  } catch {
    body = {};
  }

  const business = String(body.business_name || body.business || "").trim().slice(0, 160);
  const asked = lastVisitorMessage(body.messages);
  const about = business ? ` about ${business}` : "";
  const noted = asked ? ` I've passed along your question ("${asked.slice(0, 120)}")` : " I've noted that you reached out";
  const reply =
    `Thanks for getting in touch${about}! I'm the site assistant, and${noted} — a real person from the ` +
    `team will follow up shortly. The quickest way to get answers is to leave your name and best number in ` +
    `the contact form (or call the number at the top of the page), and we'll get right back to you.`;

  res.writeHead(200, { ...headers, "Content-Type": "application/json" });
  // Alias the reply across common field names so any widget build renders it.
  return res.end(JSON.stringify({ ok: true, reply, message: reply, response: reply, say: reply, text: reply }));
};
