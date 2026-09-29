"use strict";

// Reply agent: drafts responses to prospect replies. Draft-for-approval by
// default — drafts land in the reply queue (events ledger) and are only sent
// after operator approval via /api/admin/reply-queue, unless
// GHOST_AGENCY_REPLY_AUTOPILOT=true.

const BARE_STOP_RE = /^\s*stop(?:\s*[.!])?\s*$/i;
const OPT_OUT_RE = /\b(unsubscribe|opt.?out|stop (emailing|contacting)|remove me|not interested|no thanks|take me off|do not (contact|email))\b/i;
const POSITIVE_RE = /\b(interested|love it|looks (great|good|amazing)|how much|price|pricing|cost|call me|let'?s talk|get started|sign (me )?up|yes)\b/i;
const HUMAN_HELP_RE = /\b(human|person|manager|owner|support|callback|call me|book (a )?(call|time)|can'?t|cannot|not working|broken|refund|billing|charge|legal)\b/i;

function replyAutopilot() {
  return /^(1|true|yes|on)$/i.test(String(process.env.GHOST_AGENCY_REPLY_AUTOPILOT || "").trim());
}

function llmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function classifyIntent(text = "") {
  if (BARE_STOP_RE.test(text) || OPT_OUT_RE.test(text)) return "opt_out";
  if (POSITIVE_RE.test(text)) return "interested";
  return "question";
}

function safeHandoff({ prospect = {}, inboundText = "", reason = "request_needs_human" } = {}) {
  const email = process.env.GHOST_AGENCY_SUPPORT_EMAIL || "support@woodwardsoftware.com";
  const callbackRequested = /\b(call me|callback|call back|book (a )?(call|time))\b/i.test(inboundText);
  return {
    required: HUMAN_HELP_RE.test(inboundText),
    reason,
    status: "pending_operator_approval",
    options: [
      { type: "support_ticket", executable: true, requires_owner_approval: false },
      { type: "human_escalation", executable: true, requires_owner_approval: false, destination: email },
      { type: "callback_request", executable: callbackRequested, requires_owner_approval: true },
      { type: "secure_link", executable: Boolean(prospect.checkout_url || prospect.preview_url), requires_owner_approval: true },
    ],
    promise_policy: "Never say an action is complete until its provider or operator confirms it.",
  };
}

function agentSystemPrompt(prospect = {}) {
  const name = prospect.business_name || "the business";
  return [
    "You are the launch coordinator at WSS Labs, a small California software studio.",
    `You are replying to the owner of ${name}, a local business we offered to build a free custom website preview with their input.`,
    "Voice: warm, direct, zero pressure, zero hype, short sentences, no bullet lists, no emojis. Sound like a skilled human, not a bot — better than working with an agency.",
    "Explain that the studio can make a free custom preview after learning what they want, without touching their current site.",
    "Never claim a preview is already built, published, or live. Never claim guarantees or rankings promises. Never mention internal tools or AI.",
    "You cannot book calls, send links, change sites, issue refunds, or complete support work yourself. Offer a callback or human handoff, and say it is pending until confirmed. Never promise that an action happened without a tool/provider confirmation.",
    "If they sound annoyed or ask to stop: apologize briefly, confirm they will not hear from us again, nothing else.",
    "Keep replies under 120 words. Sign off as the WSS Labs launch team.",
  ].join(" ");
}

async function llmDraft({ prospect, inboundText, history = [] }) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const messages = [
    ...history.slice(-6),
    { role: "user", content: `The owner replied:\n\n${String(inboundText).slice(0, 4000)}\n\nProspect context: ${JSON.stringify({
      business: prospect.business_name,
      city: prospect.city,
      industry: prospect.industry || prospect.category,
    })}\n\nWrite the reply email body only (no subject).` },
  ];
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.GHOST_AGENCY_REPLY_MODEL || "claude-sonnet-5", max_tokens: 500, system: agentSystemPrompt(prospect), messages }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, reason: json?.error?.message || `anthropic_http_${response.status}` };
  const text = (json.content || []).map((b) => b.text || "").join("").trim();
  return text ? { ok: true, text, mode: "llm" } : { ok: false, reason: "empty_completion" };
}

function templateDraft({ prospect, intent }) {
  const name = prospect.business_name || "your business";
  if (intent === "interested") {
    return {
      ok: true, mode: "template",
      text: `Great to hear from you. I can build a free custom preview for ${name} with your input, so it reflects how you actually work. There is no charge or obligation, and we will not touch your current site.\n\nReply with any style, photo, or wording preferences you have. If you would rather talk it through, send a good time to call.\n\n— WSS Labs launch team`,
    };
  }
  return {
    ok: true, mode: "template",
    text: `Thanks for the reply. Happy to answer anything. If you would like, I can build a free custom preview for ${name} with your input, without touching your current site.\n\nNo rush and no pressure; if it is not for you, say the word and we will close the file.\n\n— WSS Labs launch team`,
  };
}

async function draftReply({ prospect = {}, inboundText = "", history = [] }) {
  const intent = classifyIntent(inboundText);
  const handoff = safeHandoff({ prospect, inboundText });
  if (intent === "opt_out") return { intent, draft: null, handoff: { ...handoff, required: false, reason: "opt_out_requires_suppression_not_reply" } };
  let draft = null;
  if (llmConfigured()) {
    const r = await llmDraft({ prospect, inboundText, history }).catch((e) => ({ ok: false, reason: String(e && e.message || e) }));
    if (r.ok) draft = r;
  }
  if (!draft) draft = templateDraft({ prospect, intent });
  if (handoff.required && draft?.text) {
    draft.text = `${draft.text.replace(/\n*— WSS Labs launch team\s*$/i, "").trim()}\n\nI can pass this to a person on our team. I won’t mark it complete until they confirm it.\n\n— WSS Labs launch team`;
  }
  return { intent, draft, handoff };
}

module.exports = { classifyIntent, draftReply, llmConfigured, replyAutopilot, safeHandoff };
