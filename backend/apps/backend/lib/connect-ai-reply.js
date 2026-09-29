"use strict";

/**
 * lib/connect-ai-reply.js — the thing that finally answers the bubble.
 *
 * ===========================================================================
 * THE LAW, AND WHY IT IS ENFORCED IN CODE RATHER THAN IN THE PROMPT
 * ===========================================================================
 * A bot speaking AS a business to that business's customer is the fabrication
 * risk with a megaphone, and this system has a documented history of exactly
 * that: an injection model that invented services and reviews, and a live
 * mirror that shipped fake "A. Client" testimonials to a real company. So:
 *
 *       THE ASSISTANT MAY ONLY SAY WHAT THE SITE ALREADY PUBLISHES.
 *
 * lib/connect-site-kb.js makes that corpus checkable. This file makes the
 * SPEAKING checkable, and it does not trust the model to hold the line:
 *
 *   · The AI disclosure on the first message is PREPENDED IN CODE. The model
 *     is told not to write one. A law whose compliance depends on a
 *     temperature-0.2 sampler is not a law, it is a hope — and California
 *     SB 243 has been in force since January 2026 at $500-1500 per violation.
 *
 *   · That disclosure is prepended IN THE VISITOR'S LANGUAGE, from the
 *     authored catalogue in lib/connect-language.js. Live on the Sears mirror
 *     a Spanish speaker got a Spanish answer behind an English preamble: the
 *     model followed the visitor and the code did not. A disclosure the reader
 *     cannot read is not a disclosure, so the code learned the languages
 *     rather than the model being asked to translate the law.
 *
 *   · The claim guard checks EVERY supported language's vocabulary on EVERY
 *     reply, whatever language was selected. Refusal behaviour is therefore
 *     identical across languages by construction rather than by routing:
 *     "garantizamos" is refused exactly as "we guarantee" is.
 *
 *   · Every reply passes claimGuard() before anybody sees it. Prices, dated
 *     commitments ("we can be out today") and guarantee/warranty language are
 *     the three ways a chat bubble creates a liability the business never
 *     agreed to. Each is allowed ONLY when the grounding block already
 *     contains it verbatim; a same-day commitment is never allowed, because a
 *     published website cannot possibly support one.
 *
 *   · A reply that fails the guard is REPLACED, not sent and not swallowed:
 *     the visitor gets the deterministic handoff, which is the better sales
 *     move anyway. A guess closes nothing; a callback closes.
 *
 *   · Captured contact details are checked against the visitor's own words.
 *     A phone number the model reports that the visitor never typed is
 *     discarded. Same rule as everything else: no source, no claim.
 *
 * ===========================================================================
 * WHICH CREDENTIAL, AND HOW THAT WAS DECIDED
 * ===========================================================================
 * Measured 2026-08-11, one real call to each key in the LOCAL breadcrumb env
 * (C:/Users/Main/Documents/New project 2/.fable-proof.env):
 *
 *   ANTHROPIC_API_KEY   -> HTTP 401, {"type":"authentication_error",
 *                          "message":"API key is invalid."} in 187ms.
 *   OPENROUTER_API_KEY  -> HTTP 200, model anthropic/claude-haiku-4.5
 *                          answered in 1118ms.
 *
 * THE BREADCRUMB FILE IS NOT PRODUCTION, AND THE FIRST LIVE REPLY PROVED IT.
 * Thread 10 on the Rose City mirror was served by provider "anthropic",
 * model claude-haiku-4-5-20251001, with no fallback event recorded. Checked
 * against the Vercel project rather than assumed: production has a WORKING
 * ANTHROPIC_API_KEY (a different key from the dead breadcrumb one) and has no
 * OPENROUTER_API_KEY at all. So the ladder resolves differently per
 * environment, which is the point of it being a ladder — locally OpenRouter,
 * in production Anthropic first-party at $1/$5 per MTok with no reseller
 * margin. Neither environment needed a code change to get the right answer.
 *
 * Worth flagging for someone else's session: the comment at
 * lib/site-change-plan.js:2209 says production's Anthropic key 401s. That was
 * measured 2026-08-07 and is no longer true, so its planner may be falling
 * back to Gemini for a reason that has since been fixed.
 *
 * A provider that fails authentication is marked dead FOR THE PROCESS and is
 * not tried again, so a dead key costs one 187ms probe per lambda rather than
 * one per visitor message. The fallback is never silent: it records
 * connect_ai_provider_fallback, because lib/site-change-plan.js already paid
 * the price of a silent auth fallback nobody noticed for weeks.
 *
 * Haiku-class on purpose. A reply that may only restate a supplied corpus does
 * not need a frontier model, and this runs on every unanswered chat.
 *
 * ===========================================================================
 * WHAT IT COSTS, MEASURED
 * ===========================================================================
 * Measured 2026-08-11 by replaying a real six-turn HVAC conversation through
 * the prompts this file actually builds, against the live Sears KB (a 3,967
 * char grounding block — a rich one, so this is a pessimistic case):
 *
 *   input   12,278 tokens   $0.0123      (83% of the bill)
 *   output     501 tokens   $0.0025
 *   ---------------------------------
 *   per 6-turn conversation $0.0148
 *
 * At claude-haiku-4-5's $1/$5 per MTok, that is $0.74 per client per month at
 * 50 conversations and $2.96 at 200 — 0.5% and 2.0% of a $149 seat. The
 * assistant is not a cost centre at any plausible volume; the bill is bounded
 * anyway by MAX_AI_REPLIES_PER_THREAD.
 *
 * WHY NOT PROMPT-CACHE THE GROUNDING BLOCK. Input dominates because the whole
 * system prompt (~1,700 tokens) is re-sent every turn, so caching is the
 * obvious lever — and it would silently do nothing. Haiku 4.5's minimum
 * cacheable prefix is 4,096 tokens; this prompt is well under it, so a
 * cache_control breakpoint would be accepted and never produce a hit. It only
 * becomes worth revisiting if the grounding block roughly doubles.
 */

const { hasUnresolvedToken } = require("./connect-site-settings");
const language = require("./connect-language");
const { STATE_CODES } = require("./mirror-engine/place-names");

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const PROVIDERS = Object.freeze({
  openrouter: Object.freeze({ name: "openrouter", envKey: "OPENROUTER_API_KEY", model: "anthropic/claude-haiku-4.5" }),
  anthropic: Object.freeze({ name: "anthropic", envKey: "ANTHROPIC_API_KEY", model: "claude-haiku-4-5-20251001" }),
});

const PROVIDER_ORDER = Object.freeze(["openrouter", "anthropic"]);

const LIMITS = Object.freeze({
  maxTokens: 400,
  replyChars: 900,
  transcriptMessages: 20,
  transcriptChars: 4000,
  timeoutMs: 20000,
  temperature: 0.2,
});

/** Providers whose credential this process has already watched fail auth. */
const deadProviders = new Set();

function resetProviderHealth() {
  deadProviders.clear();
}

const trim = (v) => String(v == null ? "" : v).trim();

/**
 * providerLadder(env) -> [config]
 *
 * CONNECT_AI_PROVIDER pins one provider (and then a dead key is a hard
 * failure, not a silent downgrade — an operator who pinned a provider wants to
 * know it is broken). Otherwise: measured-working first.
 */
function providerLadder(env = process.env) {
  const pinned = trim(env.CONNECT_AI_PROVIDER).toLowerCase();
  const names = pinned ? [pinned] : PROVIDER_ORDER;
  return names
    .map((name) => PROVIDERS[name])
    .filter((config) => config && trim(env[config.envKey]) && !deadProviders.has(config.name));
}

function aiReplyConfigured(env = process.env) {
  return providerLadder(env).length > 0;
}

function abortSignal(timeoutMs) {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return undefined;
  return AbortSignal.timeout(timeoutMs);
}

async function callOpenRouter({ system, user, env, fetchImpl, timeoutMs }) {
  const response = await fetchImpl(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${trim(env.OPENROUTER_API_KEY)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: PROVIDERS.openrouter.model,
      max_tokens: LIMITS.maxTokens,
      temperature: LIMITS.temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: abortSignal(timeoutMs),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status, reason: modelErrorReason(response.status, json) };
  }
  const text = trim(json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content);
  return text ? { ok: true, text } : { ok: false, status: 200, reason: "empty_completion" };
}

async function callAnthropic({ system, user, env, fetchImpl, timeoutMs }) {
  const response = await fetchImpl(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": trim(env.ANTHROPIC_API_KEY),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: PROVIDERS.anthropic.model,
      max_tokens: LIMITS.maxTokens,
      temperature: LIMITS.temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: abortSignal(timeoutMs),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status, reason: modelErrorReason(response.status, json) };
  }
  const text = trim((Array.isArray(json.content) ? json.content : []).map((block) => trim(block && block.text)).join(""));
  return text ? { ok: true, text } : { ok: false, status: 200, reason: "empty_completion" };
}

/** A code an operator can act on, never a provider message pasted through. */
function modelErrorReason(status, json) {
  const type = trim(json && json.error && json.error.type).toLowerCase();
  if (status === 401 || status === 403 || type === "authentication_error") return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return `provider_${status}`;
  return `provider_${status || 0}`;
}

/**
 * callModel({ system, user }) -> { ok, text, provider } | { ok:false, reason }
 *
 * Walks the ladder. An auth failure retires that provider for the process; any
 * other failure is per-request and the next provider is tried immediately.
 */
async function callModel({
  system,
  user,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = LIMITS.timeoutMs,
  recordEvent = null,
} = {}) {
  if (typeof fetchImpl !== "function") return { ok: false, reason: "no_fetch_available", attempts: [] };
  const ladder = providerLadder(env);
  if (!ladder.length) return { ok: false, reason: "no_model_credential", attempts: [] };

  const attempts = [];
  for (const config of ladder) {
    const startedAt = Date.now();
    let result;
    try {
      result = config.name === "anthropic"
        ? await callAnthropic({ system, user, env, fetchImpl, timeoutMs })
        : await callOpenRouter({ system, user, env, fetchImpl, timeoutMs });
    } catch (error) {
      result = { ok: false, reason: `transport_${trim(error && error.name).toLowerCase() || "error"}` };
    }
    attempts.push({ provider: config.name, ok: result.ok === true, reason: result.reason || "", ms: Date.now() - startedAt });
    if (result.ok) {
      return { ok: true, text: result.text, provider: config.name, model: config.model, attempts };
    }
    if (result.reason === "auth_failed") {
      // A DEAD KEY MUST NOT LOOK LIKE NORMAL OPERATION. It is retired for the
      // process so it costs one probe, and it is announced where an operator
      // looks, because the silent version of this fallback already cost this
      // codebase weeks of customer edits planned by the wrong model.
      deadProviders.add(config.name);
      if (typeof recordEvent === "function") {
        await Promise.resolve(recordEvent("connect_ai_provider_fallback", {
          provider: config.name,
          reason: "auth_failed",
        })).catch(() => {});
      }
    }
  }
  return { ok: false, reason: attempts[attempts.length - 1].reason || "model_unavailable", attempts };
}

// ---------------------------------------------------------------------------
// what the assistant is told
// ---------------------------------------------------------------------------

const MAX_AI_REPLIES_PER_THREAD = 12;

/**
 * The disclosure. Warm, because a warm disclosure converts BETTER than a bot
 * pretending — the visitor stops wondering whether they are being handled and
 * starts asking the question they came with.
 *
 * California SB 243 (in force since January 2026) requires this wherever a
 * reasonable person might think they are talking to a human; Washington
 * follows in 2027. Prepended in code, so the requirement cannot be sampled
 * away, and so a test can assert it rather than infer it.
 */
function disclosureLine(kb, lang = language.DEFAULT_LANGUAGE) {
  const business = trim(kb && kb.business && kb.business.name && kb.business.name.value);
  return language.disclosureFor(lang, { business });
}

/**
 * "Wait — am I talking to a real person right now?"
 *
 * The one question that must never be answered by a sampler, and never met
 * with silence. Caught in the live run: the loop suppression correctly stopped
 * a repeated handoff, and in doing so stonewalled the single question the
 * disclosure law exists to protect. So this question short-circuits the model
 * entirely and is answered from the deterministic disclosure — which is
 * already the truthful answer, already guard-safe, and free.
 *
 * "person" alone is deliberately not a trigger: "are you the person who does
 * installs" is a different question and deserves a real answer.
 *
 * Asked in any supported language, it gets the same short-circuit — and the
 * answer comes back in THAT language, because "¿eres un bot?" answered in
 * English is the original defect in miniature.
 */
const IDENTITY_QUESTION_RE = /\b(?:are you|is this|am i (?:talking|speaking|chatting)|talking to|speaking (?:to|with))\b[^?.!]{0,50}\b(?:a\s+|an\s+)?(?:bot|robot|ai|a\.i\.|human|real person|machine|computer|chatbot)\b/i;

function isIdentityQuestion(value) {
  const text = String(value || "");
  return IDENTITY_QUESTION_RE.test(text) || language.isIdentityQuestion(text);
}

/**
 * The reply the assistant falls back to whenever it does not know, or whenever
 * claimGuard() refuses what the model produced. Built only from KB facts, so
 * it is safe by construction — and it is written as a SALES move, because a
 * handoff genuinely closes better than a guess.
 */
function safeHandoffReply(kb, lang = language.DEFAULT_LANGUAGE) {
  const business = trim(kb && kb.business && kb.business.name && kb.business.name.value);
  const phone = trim(kb && kb.business && kb.business.phone && kb.business.phone.value);
  const booking = trim(kb && kb.business && kb.business.bookingUrl && kb.business.bookingUrl.value);
  return language.handoffFor(lang, { business, phone, booking });
}

/**
 * The close. When the visitor has just handed over a number, the one thing the
 * assistant must not do is ask for it again — or say nothing at all, which is
 * what the loop suppression did in the live run when a customer typed
 * "This is Dana, my number is ... Call me." and got silence.
 *
 * Deterministic, so it is safe by construction and cannot be refused: an
 * acknowledgement makes no claim about price, availability or warranty.
 */
function leadAckReply(kb, lead, lang = language.DEFAULT_LANGUAGE) {
  const business = trim(kb && kb.business && kb.business.name && kb.business.name.value);
  return language.leadAckFor(lang, {
    business,
    name: trim(lead && lead.name),
    hasPhone: Boolean(trim(lead && lead.phone)),
  });
}

function systemPrompt({ kb, grounding, businessName, bookingUrl, lang, langConfident = true }) {
  const team = businessName || "this business";
  return [
    `You are the website chat assistant for ${team}. You are an AI. You are not a human and you never imply otherwise.`,
    "",
    "=== THE ONLY THING YOU MAY SAY ===",
    "Everything below the line is what this business's own website publishes. You may state it, quote it, and summarise it.",
    "You may NOT state anything else about this business. Not services, not hours, not prices, not availability, not guarantees,",
    "not 'yes we do that'. If the answer is not below, you do not know it, and saying so is the correct answer — not a failure.",
    "",
    "=== HOW TO HANDLE WHAT YOU DON'T KNOW ===",
    "Say plainly that you'd rather not guess, then capture the lead: ask for their name and the best number to call back on.",
    bookingUrl ? `If they want to book, send them to ${bookingUrl}.` : "If they want to book, offer a callback.",
    "A handoff is a good outcome. A guess is not.",
    "",
    "=== ABSOLUTE RULES ===",
    "1. Never invent or estimate a price, quote, or range. Only repeat a price that appears verbatim below.",
    "2. Never promise availability, a slot, a same-day/next-day visit, or a response time. You cannot see a calendar.",
    "2b. You do not know what day or time it is where the visitor is. Never attach opening hours to 'today', 'tonight' or 'tomorrow' —",
    "    name the weekday instead: 'we're open Saturdays until 3 PM', never 'we're open today until 4'.",
    "3. Never offer a guarantee, warranty, or discount unless it appears verbatim below.",
    "4. Never claim to be a person, and never claim a person is reading this chat. Do not say you'll 'check with the team' as if in the room.",
    "5. Never repeat the reviewers' words as the business's own claims. A review is what one customer said.",
    "6. Do not write a greeting or introduce yourself — that is handled for you. Start with the answer.",
    "7. Answer every part of a multi-part question that the published facts support. If one part is unknown, answer the known part first, then hand off only the unknown part.",
    "8. A town under NEARBY TOWNS is only a town the page prints for directions. Say that truthfully; do not turn it into a service-area promise.",
    "",
    "=== STYLE ===",
    "Warm, plain, and short: 2-4 sentences, under 80 words. Ask at most one question per reply. No emoji, no bullet lists, no markdown.",
    "",
    language.languageDirective(lang, { confident: langConfident }),
    "Service labels are ordinary phrases, not protected names. Translate them fully into the visitor's language too; never leave an English label such as 'Faucet Repair' inside an otherwise Spanish reply.",
    "",
    "=== RETURN FORMAT ===",
    'Return ONLY a JSON object, no prose around it: {"reply": "...", "name": "...", "phone": "...", "email": ""}',
    "reply is what the visitor sees. name/phone/email are ONLY details the visitor typed themselves in this conversation —",
    "copy them exactly as typed, and leave them as empty strings if they were not given. Never fill them from the business's own details.",
    "",
    "==================== WHAT THE SITE PUBLISHES ====================",
    grounding,
  ].join("\n");
}

function userPrompt({ transcript, isFirstAiMessage }) {
  return [
    isFirstAiMessage
      ? "This is your first reply in this conversation. A greeting has already been added above your text, so answer directly."
      : "You have already introduced yourself earlier in this conversation. Do not introduce yourself again.",
    "",
    "Conversation so far:",
    transcript,
    "",
    "Write the next reply.",
  ].join("\n");
}

/** The visitor's and assistant's turns, oldest first, bounded. */
function renderTranscript(messages) {
  const rows = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.direction === "inbound" || m.direction === "outbound"))
    .slice(-LIMITS.transcriptMessages)
    .map((m) => `${m.direction === "inbound" ? "Visitor" : "Assistant"}: ${String(m.body || "").replace(/\s+/g, " ").trim()}`)
    .filter((line) => line.length > 9);
  const joined = rows.join("\n");
  return joined.length > LIMITS.transcriptChars ? joined.slice(-LIMITS.transcriptChars) : joined;
}

/** Only what the VISITOR typed. The corroboration corpus for captured details. */
function visitorText(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.direction === "inbound")
    .map((m) => String(m.body || ""))
    .join("\n");
}

// ---------------------------------------------------------------------------
// reading the model's output
// ---------------------------------------------------------------------------

function stripFences(raw) {
  return String(raw || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

/**
 * parseModelOutput(raw) -> { reply, name, phone, email, parsed }
 *
 * A small model will occasionally answer in prose instead of JSON. That is not
 * a reason to drop a good reply on the floor: fall back to treating the whole
 * output as the reply text and capture nothing. The claim guard runs either
 * way, so the fallback path is no less safe.
 */
function parseModelOutput(raw) {
  const text = stripFences(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const reply = trim(parsed.reply || parsed.message || parsed.text);
        if (reply) {
          return {
            reply,
            name: trim(parsed.name),
            phone: trim(parsed.phone),
            email: trim(parsed.email),
            parsed: true,
          };
        }
      }
    } catch { /* fall through to prose */ }
  }
  return { reply: text, name: "", phone: "", email: "", parsed: false };
}

/** Trim to a sentence boundary rather than cutting a customer off mid-word. */
function boundReply(value, maxChars = LIMITS.replyChars) {
  const text = trim(value).replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim();
}

// ---------------------------------------------------------------------------
// DETERMINISTIC COMPLETENESS + LANGUAGE ENFORCEMENT
// ---------------------------------------------------------------------------

const DAY_NAMES = Object.freeze(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const HOURS_QUESTION_RE = /\b(?:business |opening )?hours\b|\b(?:when|what time)\b[^?!.]{0,50}\b(?:open|close)\b/i;
const ENGLISH_SERVICE_ACTIONS = new Set([
  "cleaning", "conditioning", "cooling", "electrical", "heating", "installation", "install",
  "maintenance", "plumbing", "repair", "replacement", "roofing", "service",
]);

const titleCase = (value) => trim(value).replace(/^./, (letter) => letter.toUpperCase());
const scheduleKey = (value) => trim(value).toLowerCase().replace(/\s+/g, " ");

function publishedHourGroups(kb) {
  const groups = [];
  for (const entry of (kb && Array.isArray(kb.hours)) ? kb.hours : []) {
    const day = trim(entry && entry.day).toLowerCase();
    const text = trim(entry && entry.text);
    const dayIndex = DAY_NAMES.indexOf(day);
    if (!text) continue;
    // Some mirrors publish one business-wide row rather than seven day rows.
    // Keep that source text, but never reinterpret a malformed non-empty day
    // label as a business-wide schedule.
    if (!day) {
      groups.push({ days: [], text });
      continue;
    }
    if (dayIndex < 0) continue;
    const prior = groups[groups.length - 1];
    const priorDayIndex = prior && prior.days.length ? DAY_NAMES.indexOf(prior.days[prior.days.length - 1]) : -1;
    if (prior && scheduleKey(prior.text) === scheduleKey(text) && dayIndex === priorDayIndex + 1) prior.days.push(day);
    else groups.push({ days: day ? [day] : [], text });
  }
  return groups;
}

function clockTokens(value) {
  const out = new Set();
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\b/gi;
  for (let match = re.exec(String(value || "")); match; match = re.exec(String(value || ""))) {
    out.add(`${Number(match[1])}:${match[2] || "00"}${match[3].toLowerCase()}`);
  }
  return out;
}

function replyCoversPublishedHours(replyText, kb) {
  const text = String(replyText || "");
  const groups = publishedHourGroups(kb);
  if (!groups.length) return true;

  // Bind each schedule to its own day label. The old check looked for all day
  // names and all clock values anywhere in the reply, so swapping weekday and
  // weekend times still passed. Locate every published day group first, then
  // measure only the text between that group and the next one.
  const spans = groups.map((group) => {
    if (!group.days.length) return { start: 0, end: 0 };
    const first = regexEscape(group.days[0]);
    const last = regexEscape(group.days[group.days.length - 1]);
    const aliases = [];
    if (group.days.join(",") === "monday,tuesday,wednesday,thursday,friday") aliases.push("weekdays?");
    if (group.days.join(",") === "saturday,sunday") aliases.push("weekends?");
    aliases.push(group.days.length === 1
      ? first
      : `${first}\\b[^.!?;]{0,100}\\b${last}`);
    const match = new RegExp(`\\b(?:${aliases.join("|")})\\b`, "i").exec(text);
    return match ? { start: match.index, end: match.index + match[0].length } : null;
  });
  if (spans.some((span, index) => groups[index].days.length && !span)) return false;

  return groups.every((group, index) => {
    const span = spans[index];
    const nextStart = spans
      .filter((other, otherIndex) => otherIndex !== index && other && other.start >= span.end)
      .reduce((nearest, other) => Math.min(nearest, other.start), text.length);
    const window = group.days.length ? text.slice(span.start, nextStart) : text;
    const expectedTimes = clockTokens(group.text);
    const scheduleCovered = expectedTimes.size
      ? [...expectedTimes].every((token) => clockTokens(window).has(token))
      : (/\bclosed\b/i.test(group.text)
        ? /\bclosed\b/i.test(window)
        : scheduleKey(window).includes(scheduleKey(group.text)));
    return scheduleCovered;
  });
}

const SPANISH_DAYS = Object.freeze({
  monday: "lunes", tuesday: "martes", wednesday: "miércoles", thursday: "jueves",
  friday: "viernes", saturday: "sábado", sunday: "domingo",
});

const SPANISH_SCHEDULE_ENUMS = Object.freeze({
  "closed": "cerrado",
  "open 24 hours": "abierto las 24 horas",
  "24 hours": "abierto las 24 horas",
  "open": "abierto",
  "by appointment": "con cita previa",
});

function spanishScheduleText(value) {
  const text = trim(value);
  const safeEnum = SPANISH_SCHEDULE_ENUMS[scheduleKey(text)];
  if (safeEnum) return safeEnum;
  // A bare numeric range contains no English prose to leak into a Spanish
  // reply. Everything else fails closed instead of echoing source free-text.
  return /^\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?$/i.test(text)
    ? text
    : "";
}

function canonicalPublishedHours(kb, target = "en") {
  const parts = [];
  for (const group of publishedHourGroups(kb)) {
    const schedule = target === "es" ? spanishScheduleText(group.text) : group.text;
    if (!schedule) return "";
    if (!group.days.length) {
      parts.push(schedule);
      continue;
    }
    if (target === "es") {
      const first = SPANISH_DAYS[group.days[0]];
      const last = SPANISH_DAYS[group.days[group.days.length - 1]];
      const days = first === last
        ? first
        : (group.days.join(",") === "saturday,sunday" ? `${first} y ${last}` : `de ${first} a ${last}`);
      parts.push(`${days}: ${schedule}`);
      continue;
    }
    const first = titleCase(group.days[0]);
    const last = titleCase(group.days[group.days.length - 1]);
    parts.push(`${first}${first === last ? "" : `–${last}`}: ${schedule}`);
  }
  if (!parts.length) return "";
  return target === "es"
    ? `La página publica estos horarios: ${parts.join("; ")}.`
    : `The page publishes these hours: ${parts.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// DAY-SPECIFIC HOURS — answer the day that was asked, not the whole week
// ---------------------------------------------------------------------------

/**
 * The weekdays the visitor actually named, in published order. A person who
 * asks "what time do you close on Wednesday?" should hear about Wednesday, not
 * have all seven rows read back at them. "weekend" and "weekday(s)" expand to
 * the days they mean so both the plain and the shorthand forms are understood.
 */
function askedWeekdays(value) {
  const text = String(value || "");
  const named = new Set();
  for (const day of DAY_NAMES) {
    if (new RegExp(`\\b${day}s?\\b`, "i").test(text)) named.add(day);
  }
  if (/\bweekends?\b/i.test(text)) { named.add("saturday"); named.add("sunday"); }
  if (/\bweekdays?\b/i.test(text)) for (const day of DAY_NAMES.slice(0, 5)) named.add(day);
  return DAY_NAMES.filter((day) => named.has(day));
}

/**
 * Which half of a day's hours the visitor wants. "until 5?" wants the close;
 * "what time do you open?" wants the open; anything else gets the full range.
 * A closing word always wins, because "what time are you open until" contains
 * both "open" and "until" and the answer they want is the closing time.
 */
function hoursIntent(value) {
  const text = String(value || "");
  if (/\b(?:until|till|clos(?:e|es|ing))\b/i.test(text)) return "close";
  if (/\bopen(?:ing)?\b/i.test(text) && /\b(?:what time|when|how early)\b/i.test(text)) return "open";
  return "range";
}

/**
 * One day's published hours as a direct sentence. Truth-law holds: the schedule
 * text is the site's own, never converted; naming the weekday is always correct
 * (unlike "today", which the assistant cannot know — see RELATIVE_HOURS_RE).
 * A close-only or open-only answer is a true SUBSET of the published range, so
 * it invents nothing. Anything the code cannot phrase safely returns "" and the
 * caller falls back to the complete published recital.
 */
function dayHoursSentence(day, text, target, want) {
  const raw = trim(text);
  if (!raw) return "";
  if (target === "es") {
    const dia = SPANISH_DAYS[day] || day;
    const sched = spanishScheduleText(raw);
    if (!sched) return "";
    if (sched === "cerrado") return `El ${dia} está cerrado.`;
    return `El ${dia} el horario es ${sched}.`;
  }
  const label = titleCase(day);
  const key = scheduleKey(raw);
  if (key === "closed") return `On ${label}, we're closed.`;
  if (key === "open 24 hours" || key === "24 hours") return `On ${label}, we're open 24 hours.`;
  if (key === "open") return `On ${label}, we're open.`;
  if (key === "by appointment") return `On ${label}, we're open by appointment.`;
  const range = /(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s*(?:-|–|—|to|until|till)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i.exec(raw);
  if (range) {
    const open = range[1].replace(/\s+/g, " ").trim();
    const close = range[2].replace(/\s+/g, " ").trim();
    if (want === "close") return `On ${label}, we're open until ${close}.`;
    if (want === "open") return `On ${label}, we open at ${open}.`;
    return `On ${label}, we're open ${open} – ${close}.`;
  }
  return `On ${label}, our hours are ${raw}.`;
}

/**
 * The published hours for the one or two days the visitor named. Returns "" —
 * so the caller keeps the full-week recital — when any asked day cannot be
 * attributed to a published schedule, or when the target language cannot phrase
 * a day safely. A single business-wide row (no day label) is attributable to
 * any weekday, because it applies to every day the site is open.
 */
function canonicalDayHours(kb, askedDays, target, want) {
  const groups = publishedHourGroups(kb);
  if (!groups.length || !askedDays.length) return "";
  const businessWide = groups.length === 1 && !groups[0].days.length ? groups[0].text : "";
  const parts = [];
  for (const day of askedDays) {
    const group = groups.find((entry) => entry.days.includes(day));
    const text = group ? group.text : businessWide;
    const sentence = dayHoursSentence(day, text, target, want);
    if (!sentence) return "";
    parts.push(sentence);
  }
  return parts.join(" ");
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function townParts(town) {
  const match = /^(.+),\s*([A-Z]{2})$/i.exec(trim(town && town.name));
  return match ? { city: trim(match[1]), state: match[2].toUpperCase() } : null;
}

function sentenceMentionsFullTown(sentence, town) {
  const parts = townParts(town);
  if (!parts) return false;
  const fullLabel = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${regexEscape(parts.city)}(?:\\s*,\\s*|\\s+)${regexEscape(parts.state)}(?=$|[^\\p{L}\\p{N}])`,
    "iu",
  );
  return fullLabel.test(String(sentence || ""));
}

function sentenceMentionsTown(sentence, town) {
  const full = trim(town && town.name);
  const city = trim(full.split(",")[0]);
  if (!city) return false;
  // A city-only model reference is acceptable evidence only as a whole label:
  // `Riverside` matches, `Riversides` and `EastRiverside` do not.
  const cityLabel = new RegExp(`(?:^|[^\\p{L}\\p{N}])${regexEscape(city)}(?=$|[^\\p{L}\\p{N}])`, "iu");
  return cityLabel.test(String(sentence || ""));
}

function resolveNearbyTownAsked(visitorSaid, kb) {
  const text = String(visitorSaid || "");
  const towns = ((kb && Array.isArray(kb.nearbyTowns)) ? kb.nearbyTowns : [])
    .filter((town) => townParts(town));
  const exact = towns.filter((town) => sentenceMentionsFullTown(text, town));
  if (exact.length === 1) return { town: exact[0], reason: "", matches: exact };
  if (exact.length > 1) return { town: null, reason: "ambiguous", matches: exact };

  const cityMatches = towns.filter((town) => sentenceMentionsTown(text, town));
  if (!cityMatches.length) return { town: null, reason: "", matches: [] };

  // If the visitor supplied a real state code that does not match any
  // published town, never silently fall back to the same city in another
  // state (Riverside, CA must not resolve to Riverside, MO).
  const statedStates = new Set();
  for (const town of cityMatches) {
    const parts = townParts(town);
    const stateAfterCity = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${regexEscape(parts.city)}(?:\\s*,\\s*|\\s+)([A-Z]{2})(?=$|[^\\p{L}\\p{N}])`,
      "giu",
    );
    for (let match = stateAfterCity.exec(text); match; match = stateAfterCity.exec(text)) {
      const state = match[1].toUpperCase();
      if (STATE_CODES.has(state)) statedStates.add(state);
    }
  }
  if (statedStates.size) return { town: null, reason: "state_mismatch", matches: cityMatches, statedStates: [...statedStates] };
  if (cityMatches.length === 1) return { town: cityMatches[0], reason: "", matches: cityMatches };
  return { town: null, reason: "ambiguous", matches: cityMatches };
}

function nearbyTownAsked(visitorSaid, kb) {
  return resolveNearbyTownAsked(visitorSaid, kb).town;
}

function publishedServiceAreaAsked(visitorSaid, kb) {
  const text = String(visitorSaid || "");
  return ((kb && Array.isArray(kb.areas)) ? kb.areas : []).find((area) => {
    const name = trim(area && area.name);
    if (!name) return false;
    if (townParts(area)) return sentenceMentionsFullTown(text, area);
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${regexEscape(name)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
  }) || null;
}

function canonicalServiceArea(area, target = "en") {
  const name = trim(area && area.name);
  if (!name) return "";
  return target === "es"
    ? `La página incluye ${name} en su área de servicio.`
    : `The page lists ${name} as a service area.`;
}

function nearbyTownClarification(resolution, target = "en") {
  const names = [...new Set((resolution.matches || []).map((town) => trim(town && town.name)).filter(Boolean))];
  if (!names.length) return "";
  const city = trim(names[0].split(",")[0]);
  if (resolution.reason === "state_mismatch") {
    return target === "es"
      ? `Solo tengo una mención de localidad cercana para ${names.join(" y ")}. ¿A cuál se refiere?`
      : `I only have a nearby-town listing for ${names.join(" and ")}. Which location do you mean?`;
  }
  return target === "es"
    ? `La página muestra más de una localidad cercana llamada ${city}: ${names.join(" y ")}. ¿A cuál se refiere?`
    : `The page lists more than one nearby town named ${city}: ${names.join(" and ")}. Which one do you mean?`;
}

function replyCoversNearbyTown(replyText, town) {
  const text = String(replyText || "");
  const distance = /^(\d{1,3}(?:\.\d{1,2})?)\s*(mi|km)$/i.exec(trim(town && town.distance));
  if (!distance || !sentenceMentionsTown(text, town) || !/\b(?:direction|directions|nearby)\b/i.test(text)) return false;
  const units = distance[2].toLowerCase() === "mi" ? "(?:mi|miles?)" : "(?:km|kilometers?)";
  return new RegExp(`\\b${distance[1]}\\s*${units}\\b`, "i").test(text);
}

function replyContradictsNearbyTown(replyText, town) {
  return String(replyText || "").split(/(?<=[.!?])\s+/).some((sentence) => {
    if (!sentenceMentionsTown(sentence, town)) return false;
    return /\b(?:do not|does not|don't|doesn't|is not|isn't|not)\b[^.!?]{0,80}\b(?:include|included|list|listed|see|show|shown)\b/i.test(sentence);
  });
}

function nearbyTownIsPublishedServiceArea(kb, town) {
  const full = trim(town && town.name).toLowerCase();
  const city = trim(full.split(",")[0]);
  return ((kb && Array.isArray(kb.areas)) ? kb.areas : []).some((area) => {
    const name = trim(area && area.name).toLowerCase();
    return name && (name === full || name === city);
  });
}

function replyOverclaimsNearbyService(replyText, town, kb) {
  if (nearbyTownIsPublishedServiceArea(kb, town)) return false;
  const pieces = String(replyText || "").match(/[^.!?;]+[.!?;]?/g) || [];
  return pieces.some((piece) => {
    // A semicolon is a real clause boundary here. Without it, the harmless
    // sentence "We service faucets; Riverside is listed nearby" was mistaken
    // for a claim about Riverside. Contrast words are boundaries too, so an
    // unrelated "can't confirm" cannot hide a later affirmative claim.
    const clauses = String(piece).split(/\s+(?:but|however|yet|although|though)\s+/i);
    return clauses.some((clause, index) => {
      const mentionsTown = sentenceMentionsTown(clause, town);
      const priorMentionsTown = index > 0 && clauses.slice(0, index).some((part) => sentenceMentionsTown(part, town));
      if (!mentionsTown && !priorMentionsTown) return false;
      // Questions, uncertainty and explicit non-claims are allowed. Only an
      // affirmative service-area statement is replaced.
      if (clause.includes("?")
        || /\b(?:cannot|can't|do not know|don't know|does not confirm|doesn't confirm|does not say|doesn't say|not confirm|not sure|no confirmation|rather not guess|uncertain|unclear|unknown|unverified|whether|may|might)\b/i.test(clause)) return false;
      return [
        /\b(?:we|they|the business|the company)\s+(?:do\s+)?(?:serves?|services?|covers?)\b/i,
        /\b(?:we|they|the business|the company)\s+(?:provides?|offers?)\b[^;.!?]{0,60}\bservices?\b[^;.!?]{0,30}\b(?:in|to|throughout|for|across)\b/i,
        /\b(?:is|are|falls?|lies?)\s+(?:in|inside|within|part\s+of)\s+(?:our|the|their)?\s*(?:service|coverage)\s+area\b/i,
        /\b(?:is|are)\s+(?:served|serviced|covered)\b(?:\s+by\s+(?:us|the business|the company))?/i,
        /\b(?:our|the|their)\s+(?:service|coverage)\s+area\s+(?:includes?|covers?|serves?|extends?\s+to)\b/i,
        /\bservice\s+(?:is\s+)?available\s+(?:in|to|throughout)\b/i,
        // "Riverside is listed nearby, but we serve it" carries the town by
        // pronoun into the next contrast clause; keep that common form closed.
        /\b(?:we|they|the business|the company)\s+(?:do\s+)?(?:serves?|services?|covers?)\s+(?:it|there)\b/i,
      ].some((pattern) => pattern.test(clause));
    });
  });
}

function canonicalNearbyTown(town, target = "en") {
  const name = trim(town && town.name);
  const distance = trim(town && town.distance);
  if (!name || !distance) return "";
  if (target === "es") {
    const spokenDistance = distance.replace(/\bmi\b/i, "millas");
    return `La página muestra ${name} a ${spokenDistance} para obtener indicaciones; esa mención por sí sola no confirma el área de servicio.`;
  }
  return `The page lists ${name} ${distance} away for driving directions; that listing alone does not confirm the service area.`;
}

function asksPublishedHours(value, target = "en") {
  const text = String(value || "");
  if (target === "es") return /\bhorarios?\b|\b(?:a\s+qu[eé]\s+horas?|cuando|cuándo)\b[^?!.]{0,50}\b(?:abre|abren|cierra|cierran)\b/i.test(text);
  return HOURS_QUESTION_RE.test(text);
}

// ---------------------------------------------------------------------------
// THE FAST-LANE CLASSIFIER — a plain factual lookup, or an open lead?
// ---------------------------------------------------------------------------

/**
 * The crisp informational questions a visitor expects answered in seconds:
 * hours, location/address, whether a service is offered, service area, and how
 * to reach the business. Everything the site already publishes, and nothing a
 * human needs to weigh in on.
 *
 * Deliberately FALSE for problem statements and open leads — "my sink is
 * clogged", "can someone come out today", "I need a quote". Those keep the full
 * owner-first window so the human can grab the lead, and the assistant's honest
 * deflection to a callback stays exactly as correct as it was. Pricing is left
 * out on purpose: a price is a job an owner wants to quote himself, not a lookup.
 *
 * This only decides how SOON the assistant may speak, never WHAT it may say —
 * the KB grounding and the claim guard are untouched. A factual-shaped question
 * the site cannot answer simply reaches its honest "let me have someone call
 * you" a little sooner, which is the better outcome anyway.
 */
const FACTUAL_QUESTION_RES = Object.freeze([
  HOURS_QUESTION_RE,
  /\b(?:are|r)\s+(?:you|u|they|yall|y'all)\s+open\b/i,
  /\bwhat\s+time\b[^?!.]{0,40}\b(?:open|close|closing)\b/i,
  /\b(?:where\s+(?:are|is)\s+(?:you|your|it)|where.{0,20}located|your\s+location|what(?:'s| is)?\s+(?:your|the)\s+address|the\s+address|get\s+directions|directions\s+to)\b/i,
  /\bdo(?:es)?\s+(?:you|your\s+(?:company|team|business|shop|guys)|they)\b[^?!.]{0,45}\b(?:do|offer|offers|provide|handle|install|repair|service|fix|replace|clean|carry)\b/i,
  /\b(?:can|could)\s+(?:you|u|they)\b[^?!.]{0,40}\b(?:install|repair|fix|replace|service|unclog|clean|do)\b/i,
  /\bwhat\b[^?!.]{0,30}\bservices?\b/i,
  /\b(?:do|does)\s+(?:you|they)\b[^?!.]{0,40}\b(?:serve|service|cover|work\s+in|come\s+out\s+to)\b/i,
  /\b(?:service|coverage)\s+area\b/i,
  /\b(?:what(?:'s| is)?\s+your\s+(?:phone|number|email|website)|how\s+(?:do|can)\s+i\s+(?:call|contact|reach))\b/i,
  // Spanish — the proven second language: hours, location, service area.
  /\bhorarios?\b|\ba\s+qu[eé]\s+horas?\b|\b(?:abren|abre|cierran|cierra|est[aá]n?\s+abiertos?)\b/i,
  /\b(?:d[oó]nde\s+(?:est[aá]n?|queda|se\s+encuentran)|su\s+direcci[oó]n|c[oó]mo\s+llego)\b/i,
  /\b(?:atienden|dan\s+servicio|cubren|trabajan)\s+en\b/i,
]);

function isSimpleFactualQuestion(value) {
  const text = String(value || "");
  if (!text.trim()) return false;
  return FACTUAL_QUESTION_RES.some((re) => re.test(text));
}

function enforcePublishedCompleteness({ candidate, kb, visitorText: visitorSaid, target }) {
  if (target !== "en" && target !== "es") return { reply: candidate, enforced: [] };
  const snippets = [];
  const enforced = [];
  const townResolution = resolveNearbyTownAsked(visitorSaid, kb);
  const asksHours = asksPublishedHours(visitorSaid, target);
  const hasPublishedHours = publishedHourGroups(kb).length > 0;
  const deterministicHours = asksHours && hasPublishedHours;
  // One or two named days get a direct, day-specific answer; three or more (or
  // "weekday" shorthand expanding to five) fall back to the full recital, which
  // reads better than a stack of near-identical sentences.
  const askedDays = deterministicHours ? askedWeekdays(visitorSaid) : [];
  const useDaySpecific = askedDays.length >= 1 && askedDays.length <= 2;
  const serviceArea = deterministicHours ? publishedServiceAreaAsked(visitorSaid, kb) : null;
  // A true island service area outranks a duplicate directions-only row.
  // Nearby-only towns still use the narrower directions + uncertainty path.
  const town = serviceArea ? null : townResolution.town;
  const townClarification = serviceArea ? "" : (townResolution.reason ? nearbyTownClarification(townResolution, target) : "");
  const contradictsTown = target === "en" && town && replyContradictsNearbyTown(candidate, town);
  const overclaimsService = target === "en" && town && replyOverclaimsNearbyService(candidate, town, kb);
  const hoursCovered = !asksHours || (target === "en" && replyCoversPublishedHours(candidate, kb));
  const attemptsHours = /\b(?:hours|open|closed|closes?|weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(candidate)
    || clockTokens(candidate).size > 0;
  const mismatchedHours = target === "en" && asksHours && !hoursCovered && attemptsHours;
  // Nearby-town HTML never enters the model prompt. If the visitor asks about
  // one, answer from the validated fact in code and discard the model tail.
  // That closes every synonym of "we serve there", not only regex examples.
  const deterministicTown = Boolean(town);
  const replaceTail = Boolean(serviceArea || deterministicTown || townClarification || contradictsTown || overclaimsService || deterministicHours);
  if (serviceArea) {
    snippets.push(canonicalServiceArea(serviceArea, target));
    enforced.push("service_area");
  }
  if (townClarification) {
    snippets.push(townClarification);
    enforced.push("nearby_town");
  }
  if (town) {
    const nearby = canonicalNearbyTown(town, target);
    if (nearby) { snippets.push(nearby); enforced.push("nearby_town"); }
  }
  let untranslatableHours = false;
  let daySpecificHours = false;
  if (deterministicHours) {
    const dayHours = useDaySpecific ? canonicalDayHours(kb, askedDays, target, hoursIntent(visitorSaid)) : "";
    const hours = dayHours || canonicalPublishedHours(kb, target);
    if (hours) { snippets.push(hours); enforced.push("hours"); daySpecificHours = Boolean(dayHours); }
    else untranslatableHours = true;
  }
  if (!snippets.length && !untranslatableHours) return { reply: candidate, enforced: [] };
  // Source-derived facts go first, so the reply bound can never cut the
  // supported half back off after this function restored it.
  const tail = townClarification
    ? ""
    : ((deterministicTown || untranslatableHours) ? safeHandoffReply(kb, target) : "");
  let reason = "";
  if (townResolution.reason === "ambiguous") reason = "ambiguous_nearby_town";
  else if (townResolution.reason === "state_mismatch") reason = "nearby_town_state_mismatch";
  else if (contradictsTown) reason = "published_nearby_town_denied";
  else if (overclaimsService) reason = "unsupported_nearby_service_claim";
  else if (mismatchedHours) reason = "published_hours_mismatch";
  else if (deterministicTown) reason = "published_nearby_town_answer";
  else if (untranslatableHours) reason = "published_hours_untranslatable";
  else if (deterministicHours) reason = daySpecificHours ? "published_day_hours_answer" : "published_hours_answer";
  return { reply: boundReply(`${snippets.join(" ")} ${tail}`), enforced, reason };
}

function normalizedEnglishWords(value) {
  return (String(value || "").toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) || []);
}

/** Exact English service fragments must not survive in a confident non-English reply. */
function untranslatedServiceFragment(replyText, kb, target, confident) {
  if (!confident || target === "en") return "";
  const replyWords = ` ${normalizedEnglishWords(replyText).join(" ")} `;
  const fragments = new Set();
  const addFragment = (words) => {
    if (!words.length) return;
    const phrase = words.join(" ");
    fragments.add(phrase);
    const last = words[words.length - 1];
    let alternate = "";
    if (/ies$/.test(last) && last.length > 3) alternate = `${last.slice(0, -3)}y`;
    else if (/(?:ches|shes|sses|xes|zes)$/.test(last)) alternate = last.slice(0, -2);
    else if (/s$/.test(last) && !/(?:ss|us|is)$/.test(last)) alternate = last.slice(0, -1);
    else if (/^[a-z]{4,}$/.test(last) && !/(?:ing|ed)$/.test(last)) alternate = `${last}s`;
    if (alternate) fragments.add([...words.slice(0, -1), alternate].join(" "));
  };
  for (const service of (kb && Array.isArray(kb.services)) ? kb.services : []) {
    const words = normalizedEnglishWords(service && service.name);
    if (words.length >= 2) addFragment(words);
    else if (words.length === 1 && words[0].length >= 4 && !new Set(["hvac", "solar"]).has(words[0])) addFragment(words);
    for (let size = 1; size <= Math.min(4, words.length); size += 1) {
      for (let start = 0; start + size <= words.length; start += 1) {
        const window = words.slice(start, start + size);
        if (window.some((word) => ENGLISH_SERVICE_ACTIONS.has(word))) addFragment(window);
      }
    }
  }
  return [...fragments]
    .sort((a, b) => b.length - a.length)
    .find((fragment) => replyWords.includes(` ${fragment} `)) || "";
}

// ---------------------------------------------------------------------------
// THE CLAIM GUARD
// ---------------------------------------------------------------------------

/**
 * Three vocabularies, because these are the three ways a chat bubble creates an
 * obligation the business never agreed to.
 *
 *   money        A price is only speakable if the site already prints it.
 *   commitment   NEVER speakable. No published website can support "we can be
 *                out today" — there is no calendar in the knowledge base, so
 *                any such sentence is invented by definition.
 *   promise      guarantee / warranty / free / discount: speakable only if the
 *                site already uses that word (plenty of roofers do publish a
 *                warranty; the bot may repeat that, not originate it).
 *   identity     A claim to be human, or that a human is reading. Never.
 */
const COMMITMENT_RE = /\b(?:we|i)\s*(?:'|’)?(?:ll|d)?\s*(?:can|could|will|shall)?\s*(?:get|come|be|send|have)\b[^.!?]{0,70}\b(?:today|tonight|tomorrow|same[-\s]?day|right away|within the hour|this (?:morning|afternoon|evening|week))\b/i;
const BOOKING_COMMITMENT_RE = /\b(?:book|schedule|slot you|fit you|squeeze you|appointment)\b[^.!?]{0,50}\b(?:today|tonight|tomorrow|same[-\s]?day|right away|this (?:morning|afternoon|evening|week))\b/i;

/**
 * "We're open today until 4:00 PM."
 *
 * Caught live on 2026-08-11 against the real fixture, and it is subtler than
 * the others: the model read genuine published hours and then attached them to
 * a day it cannot know. There is no clock and no timezone in the corpus — the
 * business's own state is the only locality signal — so a relative day is
 * always a guess, and on a Saturday that particular sentence would have been
 * an hour wrong. Naming the weekday is always available and always correct, so
 * the relative form is simply refused.
 */
const RELATIVE_HOURS_RE = /\b(?:today|tonight|tomorrow|right now|at the moment|this (?:morning|afternoon|evening))\b[^.!?]{0,50}\b(?:open|closed|close|until|till)\b|\b(?:open|closed|close|until|till)\b[^.!?]{0,50}\b(?:today|tonight|tomorrow|right now|at the moment|this (?:morning|afternoon|evening))\b/i;

const IDENTITY_RE = /\b(?:i am|i'?m)\s+(?:a\s+)?(?:human|real person|person)\b|\bi'?m not (?:a |an )?(?:ai|bot|robot|machine)\b|\byou'?re (?:talking|speaking) (?:to|with) (?:a )?(?:real )?(?:human|person)\b|\bsomeone (?:is|'s) reading (?:this|your message)\b/i;
const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|usd|bucks)\b/gi;
const PROMISE_TERMS = Object.freeze([
  ["guarantee", /\bguarantee(?:s|d|ing)?\b/i],
  ["warranty", /\bwarrant(?:y|ies|ied)\b/i],
  ["free", /\bfree\b/i],
  ["discount", /\b(?:discount|% off|percent off)\b/i],
]);

/**
 * A sentence that negates or disclaims cannot be offering anything, so it is
 * exempt from the promise vocabulary. This is the one precision fix the live
 * run earned: "I can't tell you whether we offer a warranty" was being refused
 * as though it were "we offer a warranty".
 *
 * The exemption is deliberately narrow, and the guard is deliberately still
 * blunt everywhere else. The asymmetry is the point: over-refusing costs one
 * handoff, under-refusing invents a warranty on a stranger's behalf.
 */
const UNCERTAIN_RE = /n['’]t\b|\b(?:not|never|whether|unsure|unclear|cannot|no (?:information|pricing|details|record))\b/i;

function sentences(text) {
  return language.guard.splitSentences(text);
}

/** Negated or hedged in ANY supported language — see UNCERTAIN_RE. */
function isHedged(sentence) {
  return UNCERTAIN_RE.test(sentence) || language.guard.NEGATION_RE.test(sentence);
}

function assertsTerm(text, patterns) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return sentences(text).some((sentence) => list.some((p) => p.test(sentence)) && !isHedged(sentence));
}

function normalizeMoney(value) {
  return String(value).toLowerCase().replace(/[\s,]/g, "").replace(/^\$/, "$");
}

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'()\[\]]+/gi;

function trimPunctuation(value) {
  return trim(value).replace(/[.,;:!?)\]]+$/, "");
}

/**
 * Prices, phone numbers, links and addresses are FACTS, not phrasing. A reply
 * may be translated; these may not be. Each one must appear in the corpus the
 * site publishes, or in what the visitor themselves typed — that second source
 * matters, because reading a customer's own number back to them is not a
 * claim about the business.
 */
function verbatimFacts(text, grounding, visitorSaid) {
  const haystackRaw = `${String(grounding || "")}\n${String(visitorSaid || "")}`;
  const haystack = haystackRaw.toLowerCase();
  const haystackDigits = haystackRaw.replace(/\D+/g, "");
  const normalizedHaystack = normalizeMoney(haystack);

  const prices = new Set([...(text.match(MONEY_RE) || []), ...(text.match(language.guard.MONEY_RE) || [])]);
  for (const match of prices) {
    if (!normalizedHaystack.includes(normalizeMoney(match))) {
      return { ok: false, reason: "unsupported_price", detail: trim(match).slice(0, 40) };
    }
  }
  for (const match of text.match(PHONE_RE) || []) {
    const ten = digits(match).slice(-10);
    if (ten.length === 10 && !haystackDigits.includes(ten)) {
      return { ok: false, reason: "unsupported_phone_number", detail: trim(match).slice(0, 40) };
    }
  }
  for (const match of text.match(EMAIL_RE) || []) {
    if (!haystack.includes(trimPunctuation(match).toLowerCase())) {
      return { ok: false, reason: "unsupported_email", detail: trim(match).slice(0, 60) };
    }
  }
  for (const match of text.match(URL_RE) || []) {
    if (!haystack.includes(trimPunctuation(match).toLowerCase())) {
      return { ok: false, reason: "unsupported_link", detail: trimPunctuation(match).slice(0, 60) };
    }
  }
  // A street word standing next to a number, in a word the corpus never used,
  // is an address that was TRANSLATED — "Calle Principal 123" for "123 Main
  // Street" is a different address, and a van cannot find it.
  if (language.guard.STREET_ADDRESS_RE.test(text)) {
    for (const term of text.match(language.guard.STREET_TERM_RE) || []) {
      if (!haystack.includes(term.toLowerCase())) {
        return { ok: false, reason: "translated_address", detail: trim(term).slice(0, 40) };
      }
    }
  }
  return { ok: true, reason: "", detail: "" };
}

/**
 * claimGuard(reply, grounding, { visitorText }) -> { ok } | { ok:false, reason, detail }
 *
 * Runs on the FINAL text, which is what the customer actually receives. This
 * codebase's own law: QC PASS is never proof, check the delivered artifact.
 *
 * Every vocabulary is the union of all supported languages, so which language
 * was selected cannot change what is refused. A model that answers in Spanish
 * is held to the Spanish list AND the English one.
 */
function claimGuard(reply, grounding, { visitorText: visitorSaid = "" } = {}) {
  const text = String(reply || "");
  if (!trim(text)) return { ok: false, reason: "empty_reply", detail: "" };
  if (hasUnresolvedToken(text)) return { ok: false, reason: "unresolved_template_token", detail: "" };
  if (IDENTITY_RE.test(text) || language.guard.IDENTITY_CLAIM_RE.test(text)) {
    return { ok: false, reason: "human_identity_claim", detail: "" };
  }
  if (COMMITMENT_RE.test(text) || BOOKING_COMMITMENT_RE.test(text) || language.guard.COMMITMENT_RE.test(text)) {
    return { ok: false, reason: "unsupported_availability_commitment", detail: "" };
  }
  if (RELATIVE_HOURS_RE.test(text) || language.guard.RELATIVE_HOURS_RE.test(text)) {
    return { ok: false, reason: "relative_day_hours_claim", detail: "" };
  }

  const facts = verbatimFacts(text, grounding, visitorSaid);
  if (!facts.ok) return facts;

  const haystack = String(grounding || "").toLowerCase();
  for (const [label, pattern] of PROMISE_TERMS) {
    const translated = language.guard.PROMISE_TERMS.find(([name]) => name === label);
    const patterns = translated ? [pattern, translated[1]] : [pattern];
    // Published in ANY language counts as published: a corpus that says "we
    // guarantee all workmanship" may be repeated as "garantizamos todo el
    // trabajo". That is a translation, not a new claim.
    if (assertsTerm(text, patterns) && !patterns.some((p) => p.test(haystack))) {
      return { ok: false, reason: `unsupported_${label}`, detail: "" };
    }
  }
  return { ok: true, reason: "", detail: "" };
}

// ---------------------------------------------------------------------------
// captured contact details
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;

function digits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeCapturedPhone(value) {
  const raw = digits(value);
  if (raw.length === 11 && raw.startsWith("1")) return `+${raw}`;
  if (raw.length === 10) return `+1${raw}`;
  return "";
}

function lettersOnly(value) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * extractLead({ claimed, transcript }) -> { name, phone, email, sources }
 *
 * The model's report is a HINT, never an authority. Every field must be
 * corroborated by something the visitor literally typed, or it is dropped.
 * Same rule as the rest of this feature: no source, no claim. Without this,
 * a hallucinated phone number becomes a callback to a stranger.
 */
function extractLead({ claimed = {}, transcript = "" } = {}) {
  const said = String(transcript || "");
  const saidLower = said.toLowerCase();
  const saidDigits = digits(said);
  const sources = {};

  let email = "";
  const claimedEmail = trim(claimed.email).toLowerCase();
  if (claimedEmail && saidLower.includes(claimedEmail)) {
    email = claimedEmail;
    sources.email = "visitor_confirmed";
  } else {
    const found = said.match(EMAIL_RE);
    if (found && found.length) {
      email = trim(found[found.length - 1]).toLowerCase();
      sources.email = "visitor_text";
    }
  }

  let phone = "";
  const claimedPhone = normalizeCapturedPhone(claimed.phone);
  if (claimedPhone && saidDigits.includes(claimedPhone.replace("+1", "").slice(-10))) {
    phone = claimedPhone;
    sources.phone = "visitor_confirmed";
  } else {
    const found = said.match(PHONE_RE);
    for (let i = (found || []).length - 1; i >= 0; i -= 1) {
      const candidate = normalizeCapturedPhone(found[i]);
      if (candidate) { phone = candidate; sources.phone = "visitor_text"; break; }
    }
  }

  let name = "";
  const claimedName = trim(claimed.name).slice(0, 80);
  const spokenWords = saidLower.replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const claimedWords = claimedName.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (claimedWords.length >= 2 && lettersOnly(claimedWords).length >= 2 && spokenWords.includes(claimedWords)) {
    name = claimedName;
    sources.name = "visitor_confirmed";
  }

  return { name, phone, email, sources, captured: Boolean(name || phone || email) };
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

/**
 * hasSpeakableKnowledge(kb)
 *
 * A business name alone is not a knowledge base. If the site publishes nothing
 * the assistant could answer FROM, the assistant must not speak at all — an
 * empty corpus is precisely the condition under which a model invents one.
 */
function hasSpeakableKnowledge(kb) {
  if (!kb || kb.ok !== true || !kb.known) return false;
  if (Array.isArray(kb.customQa) && kb.customQa.length) return true;
  return ["services", "faqs", "hours", "areas", "nearby_towns", "about", "reviews", "booking_url"].some((topic) => kb.known[topic] === true);
}

/**
 * generateAiReply({ kb, grounding, messages, isFirstAiMessage }) ->
 *   { ok, reply, lead, guard, provider } | { ok:false, reason }
 *
 * `reply` is the FINAL customer-visible text: disclosure prepended when this is
 * the first AI message, guard already applied, length already bounded. Callers
 * write it verbatim — there is nothing left to assemble, so there is nothing
 * left to get wrong at the call site.
 */
async function generateAiReply({
  kb,
  grounding = "",
  messages = [],
  isFirstAiMessage = true,
  previousRefused = false,
  disclosedLanguages = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = LIMITS.timeoutMs,
  recordEvent = null,
  callModelImpl = callModel,
} = {}) {
  if (!hasSpeakableKnowledge(kb)) return { ok: false, reason: "no_knowledge_base" };
  const block = trim(grounding);
  if (!block) return { ok: false, reason: "no_grounding_block" };

  const transcript = renderTranscript(messages);
  if (!transcript) return { ok: false, reason: "no_transcript" };

  const businessName = trim(kb.business && kb.business.name && kb.business.name.value);
  const bookingUrl = trim(kb.business && kb.business.bookingUrl && kb.business.bookingUrl.value);
  const said = visitorText(messages);

  // WHAT LANGUAGE IS THIS CONVERSATION IN.
  //
  // Read off the VISITOR's own words, in code, before anything is generated —
  // so the disclosure can be prepended in that language even when the model
  // never runs (identity question, dead credential, refused reply). An
  // unconfident read stays English rather than switching on a coin flip.
  const detected = language.detectVisitorLanguage(messages);

  /**
   * Whether this language has been disclosed to this visitor yet.
   *
   * An empty list means the caller did not tell us, and absence of evidence is
   * not evidence of absence — so behaviour is exactly as it was: disclose on
   * the first AI message only. When the caller DOES pass the record, a visitor
   * who switches to Spanish mid-thread gets the disclosure again, in Spanish,
   * because a disclosure they cannot read is not one.
   */
  const alreadyDisclosed = new Set(
    (Array.isArray(disclosedLanguages) ? disclosedLanguages : [])
      .map((code) => language.resolveLanguage(code)),
  );
  const needsDisclosure = (lang) => isFirstAiMessage === true
    || (alreadyDisclosed.size > 0 && !alreadyDisclosed.has(language.resolveLanguage(lang)));

  // Answered before the model is consulted, and therefore never suppressed by
  // the loop guard and never at the mercy of a sampler.
  const lastVisitorLine = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.direction === "inbound").map((m) => trim(m.body)).pop();
  if (isIdentityQuestion(lastVisitorLine)) {
    return {
      ok: true,
      reply: disclosureLine(kb, detected.code),
      body: disclosureLine(kb, detected.code),
      lead: extractLead({ claimed: {}, transcript: said }),
      guard: { ok: true, reason: "", detail: "" },
      delivered: "identity_disclosure",
      disclosed: true,
      language: detected.code,
      languageSource: detected.method,
      parsedJson: false,
      provider: "deterministic",
      model: "identity_disclosure",
      attempts: [],
    };
  }

  const result = await callModelImpl({
    system: systemPrompt({
      kb,
      grounding: block,
      businessName,
      bookingUrl,
      lang: detected.code,
      langConfident: detected.confident === true,
    }),
    user: userPrompt({ transcript, isFirstAiMessage }),
    env,
    fetchImpl,
    timeoutMs,
    recordEvent,
  });
  if (!result || result.ok !== true) {
    return { ok: false, reason: (result && result.reason) || "model_unavailable", attempts: (result && result.attempts) || [] };
  }

  const output = parseModelOutput(result.text);
  let candidate = boundReply(output.reply);

  // THE WHOLE REPLY IS ONE LANGUAGE, OR IT IS NOT SENT.
  //
  // When the visitor's language was readable, the body has to be in it: a
  // Spanish disclosure glued to an English answer is the same defect as an
  // English disclosure glued to a Spanish answer. When it was NOT readable,
  // the model was told to follow the visitor and pick from the supported list,
  // so its own choice decides — as long as we can disclose in it.
  const bodyLanguage = language.detectLanguage(candidate);
  const target = detected.confident
    ? detected.code
    : ((bodyLanguage.confident && language.isSupported(bodyLanguage.code))
      ? bodyLanguage.code
      : language.DEFAULT_LANGUAGE);

  const completeness = enforcePublishedCompleteness({
    candidate,
    kb,
    visitorText: lastVisitorLine,
    target,
  });
  candidate = completeness.reply;

  let guard = claimGuard(candidate, block, { visitorText: said });
  if (guard.ok && bodyLanguage.confident && bodyLanguage.code !== target) {
    guard = { ok: false, reason: "reply_language_mismatch", detail: `${bodyLanguage.code}!=${target}` };
  }
  if (guard.ok) {
    const untranslated = untranslatedServiceFragment(candidate, kb, target, detected.confident === true);
    if (untranslated) guard = { ok: false, reason: "untranslated_service_label", detail: untranslated };
  }
  const lead = extractLead({ claimed: output, transcript: said });

  // THE CLOSE OUTRANKS THE REFUSAL.
  //
  // If the visitor's latest message is where they handed over a number, a
  // refused model reply must not become the generic handoff — which would ask
  // for the details they just gave — and must not become silence, which is
  // what the live run produced for "This is Dana, my number is ... Call me."
  // The acknowledgement is deterministic, so it is safe without being checked.
  const justGaveContact = lead.captured && Boolean(lastVisitorLine) && (
    (lead.phone && digits(lastVisitorLine).includes(lead.phone.replace("+1", "")))
    || (lead.email && lastVisitorLine.toLowerCase().includes(lead.email))
  );
  if (!guard.ok && justGaveContact) {
    const ack = leadAckReply(kb, lead, target);
    const discloseAck = needsDisclosure(target);
    return {
      ok: true,
      reply: discloseAck ? `${disclosureLine(kb, target)}\n\n${ack}` : ack,
      body: ack,
      lead,
      guard,
      delivered: "lead_ack",
      disclosed: discloseAck,
      language: target,
      languageSource: detected.method,
      parsedJson: output.parsed,
      provider: result.provider,
      model: result.model,
      attempts: result.attempts || [],
    };
  }

  // TWO REFUSALS IN A ROW IS THE LOOP SIGNAL — STOP TALKING.
  //
  // Found by running the real model, not by reading: once the visitor asked
  // about a warranty, the word stayed alive in the conversation, every
  // subsequent reply tripped the guard, and the customer received the same
  // canned handoff three times. That is precisely the "bot arguing in a loop"
  // failure, and it is worse than silence — the visitor has already been told
  // once that a human will call. The turn is abandoned; the lead is still
  // captured below by the caller, and the next visitor message gets a fresh
  // chance rather than a permanent mute.
  if (!guard.ok && previousRefused === true) {
    return { ok: false, reason: "consecutive_refusal", guard, lead, language: target };
  }

  // A refused reply is REPLACED, never sent and never swallowed. The visitor
  // still gets an answer — in their own language, because the replacement is
  // where a refusal would otherwise switch the conversation back to English —
  // the owner still gets the lead, and the reason is on the record so a
  // pattern of refusals is visible instead of invisible.
  const body = guard.ok ? candidate : safeHandoffReply(kb, target);
  const disclose = needsDisclosure(target);
  const reply = disclose ? `${disclosureLine(kb, target)}\n\n${body}` : body;

  return {
    ok: true,
    reply,
    body,
    lead,
    guard,
    delivered: guard.ok
      ? (completeness.reason ? "deterministic_correction" : "model")
      : "handoff",
    enforcedFacts: completeness.enforced,
    enforcementReason: completeness.reason || "",
    disclosed: disclose,
    language: target,
    languageSource: detected.method,
    parsedJson: output.parsed,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts || [],
  };
}

module.exports = {
  LIMITS,
  MAX_AI_REPLIES_PER_THREAD,
  PROVIDERS,
  aiReplyConfigured,
  callModel,
  claimGuard,
  disclosureLine,
  extractLead,
  generateAiReply,
  hasSpeakableKnowledge,
  isIdentityQuestion,
  isSimpleFactualQuestion,
  leadAckReply,
  parseModelOutput,
  providerLadder,
  resetProviderHealth,
  safeHandoffReply,
  _test: {
    BOOKING_COMMITMENT_RE,
    COMMITMENT_RE,
    IDENTITY_RE,
    MONEY_RE,
    PROMISE_TERMS,
    URL_RE,
    boundReply,
    deadProviders,
    normalizeCapturedPhone,
    askedWeekdays,
    canonicalDayHours,
    canonicalPublishedHours,
    canonicalNearbyTown,
    dayHoursSentence,
    hoursIntent,
    enforcePublishedCompleteness,
    nearbyTownAsked,
    nearbyTownClarification,
    publishedHourGroups,
    resolveNearbyTownAsked,
    renderTranscript,
    replyCoversPublishedHours,
    replyCoversNearbyTown,
    replyContradictsNearbyTown,
    replyOverclaimsNearbyService,
    sentenceMentionsTown,
    systemPrompt,
    userPrompt,
    untranslatedServiceFragment,
    verbatimFacts,
    visitorText,
  },
};
