"use strict";

// Organic per-prospect email composition. This lane is consent-first: it may
// offer to create a free custom preview after a reply, but it must never claim
// that a site has already been built, published, or put behind a payment link.
//
// Guardrails (all hard):
//  - Facts come only from the prospect record; the model is told to invent nothing.
//  - Output contains no URLs, payment CTA, pre-built preview, or urgency device.
//  - The recipient must reply before any custom preview is built.
//  - Banned internal terms and marketing clichés are scanned post-generation.
//  - Any failure → caller falls back to the proven template. Compliance footer,
//    suppression, dedupe, and send gates are untouched either way.

const BANNED = /ghost agency|leadminer|firecrawl|brightlocal|pagehub|scrape|scraper|crawl|packet|pipeline|proof|vapi|twilio|AI agent|world-class|cutting-edge|state-of-the-art|hassle-free|look no further|game.?changer|unlock|elevate your|seamless/i;
const FORBIDDEN_MECHANICS = /\{\{(?:PREVIEW_LINK|REPORT_LINK)\}\}|https?:\/\/|\b(?:checkout|stripe|countdown|sunset|expiration)\b|\bexpir(?:e|es|ed|ing)\b|\b(?:rebuilt|reimagined)\b|\b(?:already|previously)\s+(?:built|finished|published|live)\b|\blive\s+(?:until|through)\b|\b(?:delete|remove)\s+(?:it|the preview)\b|\breport\s+(?:link|url)\b/i;

const ANGLES = [
  "a neighborly, plainspoken note from one California business owner to another",
  "Riley making routine website edits live by call",
  "the lower studio cost made possible by careful use of AI",
  "the free custom preview offered only after the business replies",
  "keeping the recipient's current website completely untouched",
];
const SHAPES = [
  "Open with a one-line hook on its own line, then two short paragraphs.",
  "Three short paragraphs, each 1-2 sentences, generous spacing.",
  "One direct question as the opener, then a single tight paragraph, then a one-line close.",
  "A warm introduction, one short Riley example, then the reply-to-build offer.",
  "Lead with the reply-to-build offer, explain Riley briefly, then close with no pressure.",
];

function consentSubject({ businessName = "your business", city = "your area" } = {}) {
  return `talk to your website and it changes — for ${businessName} in ${city}`;
}

function safeFact(value = "", max = 400) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "[link omitted]")
    .replace(/\{\{[A-Z_]+\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function factsFor(prospect = {}, vars = {}) {
  const facts = [];
  const name = prospect.business_name || prospect.businessName || "";
  if (name) facts.push(`Business: ${name}`);
  if (prospect.city) facts.push(`City: ${prospect.city}, ${prospect.state || ""}`.trim());
  if (prospect.industry) facts.push(`Trade: ${prospect.industry}`);
  const rating = Number(prospect.rating || prospect.record?.rating || 0);
  const reviews = Number(prospect.review_count || prospect.record?.review_count || 0);
  if (rating) facts.push(`Google rating: ${rating}★ across ${reviews || "several"} reviews`);
  const weaknesses = prospect.weaknesses || prospect.record?.weaknesses || prospect.record?.weaknessReasons || [];
  if (Array.isArray(weaknesses) && weaknesses.length) facts.push(`Observed gaps: ${weaknesses.slice(0, 3).join("; ")}`);
  if (prospect.current_website) facts.push("Current website on file: yes");
  else facts.push("Current website: none found");
  if (vars.findings_text) facts.push(`Public-record context: ${safeFact(vars.findings_text)}`);
  return facts.join("\n");
}

// Provider-agnostic LLM call: Anthropic -> OpenAI -> Gemini, first configured
// + working provider wins. All three read the same system/user prompt.
async function llmComplete(system, user) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.GHOST_AGENCY_COMPOSE_MODEL || "claude-haiku-4-5-20251001", max_tokens: 600, temperature: 1, system, messages: [{ role: "user", content: user }] }),
    });
    if (r.ok) { const j = await r.json().catch(() => null); const t = j?.content?.map((c) => c.text || "").join("").trim(); if (t) return { text: t, provider: "anthropic" }; }
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.GHOST_AGENCY_COMPOSE_MODEL_OPENAI || "gpt-4o-mini", max_tokens: 600, temperature: 1, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (r.ok) { const j = await r.json().catch(() => null); const t = j?.choices?.[0]?.message?.content?.trim(); if (t) return { text: t, provider: "openai" }; }
  }
  // Accept the Gemini key under any of the names actually used across this
  // project — GEMINI_API_KEY is the one set for Veo/media and confirmed working,
  // so the organic composer should fall back to it instead of a name mismatch.
  const geminiKey = (process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  if (geminiKey) {
    const model = process.env.GHOST_AGENCY_COMPOSE_MODEL_GEMINI || "gemini-2.0-flash";
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: 600, temperature: 1 } }),
    });
    if (r.ok) { const j = await r.json().catch(() => null); const t = j?.candidates?.[0]?.content?.parts?.map((p2) => p2.text || "").join("").trim(); if (t) return { text: t, provider: "gemini" }; }
  }
  return null;
}

async function composeOrganicEmail({ prospect = {}, vars = {}, senderName = "Mark Woodward" }) {
  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  const businessName = prospect.business_name || prospect.businessName || "their business";
  const city = prospect.city || prospect.market || "your area";
  const requiredSubject = consentSubject({ businessName, city });

  const system = `You are ${senderName}, writing a short cold email in first person. You run a small AI-powered web studio in California for local service businesses. Nothing has been built or published for this recipient. You may only OFFER to build a free custom preview after the recipient replies, with their input. Make clear that you never touch their current site. Briefly explain that Riley can make live website edits by call. Voice: warm, direct, plainspoken, and low pressure, like one small-business owner writing to another. HARD RULES: (1) Use only the supplied facts; invent nothing. (2) Include no URL, template token, payment request, checkout language, countdown, expiration, deletion threat, or claim that work is complete. (3) The body must contain a clear reply-first free-custom-preview offer and say the current site will not be touched. (4) Write 70-150 words in first person and sign off as "${senderName}". (5) The first line must be exactly "SUBJECT: ${requiredSubject}", followed by a blank line and the body.`;

  const user = `Facts about this business:\n${factsFor(prospect, vars)}\n\nAngle for THIS email: ${angle}\nStructure for THIS email: ${shape}\n\nWrite the email now.`;

  const result = await llmComplete(system, user);
  if (!result) return { fail: "all_providers_failed" };
  const text = result.text;

  const subjectMatch = text.match(/^SUBJECT:\s*(.+)$/m);
  const subject = subjectMatch ? subjectMatch[1].trim() : "";
  const body = text.replace(/^SUBJECT:.*$/m, "").trim();

  // Hard validation — fall back to the deterministic consent-first template
  // on any miss. Do not trust the model merely because the prompt was clear.
  if (!subject || subject !== requiredSubject) return { fail: "subject_framing" };
  if (BANNED.test(body) || BANNED.test(subject)) return { fail: "banned_term" };
  if (FORBIDDEN_MECHANICS.test(body) || FORBIDDEN_MECHANICS.test(subject)) {
    return { fail: "consent_mechanics_forbidden" };
  }
  const words = body.replace(/\{\{[A-Z_]+\}\}/g, "").split(/\s+/).filter(Boolean).length;
  if (words < 40 || words > 190) return { fail: `words_${words}` };
  if (!body.includes(businessName.split(" ")[0])) return { fail: "no_name" };
  if (!/\breply\b/i.test(body) || !/\bfree\s+custom\s+preview\b/i.test(body)) {
    return { fail: "reply_first_offer_missing" };
  }
  if (!/\b(?:I(?:'ll| will)|we(?:'ll| will))\s+(?:build|create|make)\b/i.test(body)) {
    return { fail: "future_build_offer_missing" };
  }
  if (!/\b(?:never|won't|will not)\s+(?:touch|change|alter)\b[\s\S]{0,60}\bcurrent\s+(?:web)?site\b/i.test(body)) {
    return { fail: "current_site_untouched_missing" };
  }

  return { subject, body };
}

module.exports = {
  composeOrganicEmail,
  consentSubject,
};
