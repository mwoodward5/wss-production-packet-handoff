"use strict";

// lib/zai-agents.js — the Z.ai GLM agent lane: slide/poster generation and
// video templates, as ONE module the whole factory shares.
//
// WHAT IT WRAPS (contract verified live against https://api.z.ai, 2026-09-16):
//
//   POST {base}/v1/agents              submit a task to an agent
//   POST {base}/v1/agents/async-result poll an async task by async_id
//
//   Two agents, two transports — the module handles both honestly:
//
//   - slides_glm_agent (GLM Slide/Poster): submitted with stream:false the API
//     STILL answers as a Server-Sent-Events stream of incremental chunks
//     (phases: thinking → tool → answer). There is no async_id; the result is
//     whatever the stream delivered by the time it ends. We read the stream to
//     completion under the overall budget and harvest it: the answer text, the
//     tool calls, and every image URL the agent searched for or placed.
//
//   - vidu_template_agent (video templates): the submit answers with an
//     async_id; the finished video is polled from async-result until
//     status:"success" (video_url) or "failed".
//
// THE HONEST FAILURE LAW. Every failure mode comes back as { ok:false, error,
// detail } — never a fabricated URL, never a "probably done". Callers (Riley's
// voice tool, the customer dashboard) speak these outcomes verbatim.
//
// ENV
//   ZAI_AGENTS_KEY        the agent-lane API key (falls back to ZAI_API_KEY —
//                         the same Z.ai account key the chat lane already uses)
//   ZAI_AGENTS_BASE_URL   default https://api.z.ai/api
//   ZAI_AGENTS_POLL_MS    poll cadence, default 5000 (mission law: 5s)
//   ZAI_AGENTS_TIMEOUT_MS overall budget, default 300000 (mission law: 300s)

const DEFAULT_BASE_URL = "https://api.z.ai/api";
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_BODY_BYTES = 26_214_400; // 25 MiB guard for pathological streams

const SLIDES_AGENT = "slides_glm_agent";
const VIDEO_AGENT = "vidu_template_agent";
const VIDEO_TEMPLATES = new Set(["french_kiss", "bodyshake", "sexy_me"]);

const IMAGE_URL_RE = /\.(?:png|jpe?g|webp|gif|avif)(?:[?#][^\s"'<>)]*)?$/i;
const VIDEO_URL_RE = /\.(?:mp4|webm|mov)(?:[?#][^\s"'<>)]*)?$/i;
const ANY_URL_RE = /https?:\/\/[^\s"'<>\\)]+/g;

function envInt(name, fallback, env = process.env) {
  const raw = String((env && env[name]) || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function config(env = process.env) {
  const key = String(env.ZAI_AGENTS_KEY || env.ZAI_API_KEY || "").trim();
  return {
    key,
    baseUrl: String(env.ZAI_AGENTS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    pollMs: envInt("ZAI_AGENTS_POLL_MS", DEFAULT_POLL_MS, env),
    timeoutMs: envInt("ZAI_AGENTS_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, env),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// SSE + payload harvesting
// ---------------------------------------------------------------------------
/**
 * Parse an SSE text body into the JSON payloads of its data: lines.
 * Tolerates multi-line data, blank separators and a trailing [DONE].
 */
function parseSseEvents(text) {
  const events = [];
  for (const block of String(text || "").split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch { /* a malformed chunk never kills the harvest */ }
  }
  return events;
}

/**
 * The stream/doc shape drifted between `choices[].message` (docs) and
 * `choices[].messages` (live chunks); read both, always as an array.
 */
function choiceMessages(event) {
  const choice = (event && Array.isArray(event.choices) && event.choices[0]) || {};
  const list = choice.messages || choice.message || [];
  return Array.isArray(list) ? list : [];
}

/** Walk any JSON value; collect strings (and JSON-encoded strings) as URLs. */
function collectUrls(value, matches, seen, depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, matches, seen, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, matches, seen, depth + 1);
    return;
  }
  if (typeof value !== "string") return;
  let text = value;
  const trimmed = text.trim();
  // Tool outputs arrive as JSON-encoded strings ("[{\"image_url\":...}]").
  if ((trimmed.startsWith("[") || trimmed.startsWith("{")) && (trimmed.endsWith("]") || trimmed.endsWith("}"))) {
    try {
      return collectUrls(JSON.parse(trimmed), matches, seen, depth + 1);
    } catch { /* not JSON — fall through to the regex */ }
  }
  for (const m of text.matchAll(ANY_URL_RE)) {
    const url = m[0].replace(/[.,;:]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    if (matches(url)) matches.found.push(url);
  }
}

function imageUrlsFrom(value) {
  const matches = (url) => IMAGE_URL_RE.test(url);
  matches.found = [];
  collectUrls(value, matches, new Set());
  return matches.found;
}

function videoUrlsFrom(value) {
  const found = [];
  const seen = new Set();
  // Typed content parts first: { type: "video_url", video_url: "https://…mp4" }
  (function walk(node, depth = 0) {
    if (depth > 12 || node == null) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    if (typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === "video_url" || k === "url" || k === "image_url") && typeof v === "string" && VIDEO_URL_RE.test(v) && !seen.has(v)) {
        seen.add(v);
        found.push(v);
      }
      walk(v, depth + 1);
    }
  })(value);
  for (const url of imageUrlsFrom(value)) {
    if (VIDEO_URL_RE.test(url) && !seen.has(url)) { seen.add(url); found.push(url); }
  }
  return found;
}

/**
 * Harvest a completed agent response (SSE events or one JSON payload) into the
 * honest summary every caller speaks: answer text, tool call names, and the
 * URLs the agent actually produced or used.
 */
function harvest(payload) {
  const events = Array.isArray(payload) ? payload : [payload];
  let answer = "";
  const tools = [];
  let asyncId = "";
  let conversationId = "";
  let requestId = "";
  let finishReason = "";
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (event.async_id) asyncId = String(event.async_id);
    if (event.conversation_id) conversationId = String(event.conversation_id);
    if (event.id && !requestId) requestId = String(event.id);
    if (event.status === "failed") {
      const err = event.error || {};
      return {
        ok: false,
        error: `agent_failed:${err.code || "unknown"}`,
        detail: String(err.message || "the agent reported a failure"),
        requestId,
        conversationId,
        asyncId,
      };
    }
    for (const message of choiceMessages(event)) {
      if (event.choices && event.choices[0] && event.choices[0].finish_reason) {
        finishReason = String(event.choices[0].finish_reason);
      }
      const content = message && message.content;
      const parts = Array.isArray(content) ? content : [content];
      // The phase lives on the message (live) or the part (docs) — the ANSWER
      // is only the answer-phase text; thinking/tool phases never join it.
      const phase = String((message && message.phase) || "");
      for (const part of parts) {
        if (!part || typeof part !== "object") continue;
        const partPhase = String(part.phase || phase);
        if (part.type === "text" && typeof part.text === "string" && partPhase === "answer") {
          answer += part.text;
        } else if (part.type === "object" && part.object && part.object.tool_name) {
          tools.push(String(part.object.tool_name));
        }
      }
    }
  }
  const images = imageUrlsFrom(events).filter((url) => !/w3\.org|schema\.org|googleapis\.com\/(css|icons)/i.test(url));
  // The agent searches reference material (mood boards, articles) before it
  // places its OWN generated assets (hosted on the agent's file host, observed
  // live as mfile.z.ai). Both are real poster URLs, but callers render the
  // FIRST few — the agent's own artwork leads, references follow.
  const isOwnAsset = (url) => {
    try { return /(^|\.)mfile\.z\.ai$/i.test(new URL(url).hostname); } catch { return false; }
  };
  images.sort((a, b) => Number(isOwnAsset(b)) - Number(isOwnAsset(a)));
  const videos = videoUrlsFrom(events);
  // Links the agent spoke in its answer (exports, hosted decks) — not assets.
  const answerLinks = [];
  const seen = new Set();
  for (const url of String(answer).matchAll(ANY_URL_RE)) {
    const clean = url[0].replace(/[.,;:]+$/, "");
    if (!seen.has(clean)) { seen.add(clean); answerLinks.push(clean); }
  }
  return {
    ok: true,
    answer: answer.trim(),
    tools,
    images,
    videos,
    links: answerLinks,
    asyncId,
    conversationId,
    requestId,
    finishReason,
  };
}

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------
async function postJson(url, { key, body, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        // application/json ONLY — measured live: with "text/event-stream" in the
        // Accept list the slides agent keeps the SSE connection OPEN past its
        // final event and the body read hangs to whatever ceiling the caller
        // set; with application/json the server closes the stream when the run
        // ends (verified: full run completes ~289s vs ceiling-exact timeouts).
        "Accept": "application/json",
        // THE GZIP TRAP (root-caused live, 2026-09-17): Node's fetch asks for
        // gzip by default, and the agent's gzip-mode responses CRAWL — a
        // --compressed curl probe received 47,674 bytes in 480s vs 603,978
        // bytes COMPLETE in 351s with identity. Every early lib run died at
        // exactly its timeout ceiling because of this. identity = the
        // verified-working mode; explicitly pinned so no client default can
        // reintroduce it.
        "Accept-Encoding": "identity",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared > MAX_BODY_BYTES) {
      return { ok: false, status: response.status, error: "body_too_large", detail: `${declared} bytes declared` };
    }
    const text = await response.text();
    if (!response.ok) {
      let detail = String(text).slice(0, 400);
      let code = "";
      try {
        const parsed = JSON.parse(text);
        detail = String((parsed.error && (parsed.error.message || parsed.error.code)) || detail);
        code = String((parsed.error && parsed.error.code) || "");
      } catch { /* non-JSON error body */ }
      return { ok: false, status: response.status, error: code ? `http_${response.status}:${code}` : `http_${response.status}`, detail };
    }
    return { ok: true, status: response.status, text };
  } catch (error) {
    const aborted = error && (error.name === "AbortError" || /aborted/i.test(String(error.message)));
    return { ok: false, status: 0, error: aborted ? "timeout" : "network_error", detail: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submit a task to an agent and read it to completion under the budget.
 * Handles both transports: SSE (slides) and one-shot JSON (async acks).
 */
async function submitAgentTask({
  agentId,
  messages,
  customVariables,
  requestId,
  timeoutMs,
  env = process.env,
  fetchImpl = fetch,
}) {
  const cfg = config(env);
  if (!cfg.key) return { ok: false, error: "zai_key_missing", detail: "ZAI_AGENTS_KEY (or ZAI_API_KEY) is not configured" };
  const budget = Math.max(1, timeoutMs || cfg.timeoutMs);
  const body = { agent_id: agentId, stream: false, messages };
  if (customVariables) body.custom_variables = customVariables;
  if (requestId) body.request_id = String(requestId);

  const sent = await postJson(`${cfg.baseUrl}/v1/agents`, { key: cfg.key, body, timeoutMs: budget, fetchImpl });
  if (!sent.ok) return sent;

  const trimmed = sent.text.trim();
  const payload = trimmed.startsWith("data:")
    ? parseSseEvents(trimmed)
    : safeJson(trimmed);
  if (!payload) return { ok: false, error: "unparseable_response", detail: trimmed.slice(0, 200) };
  return { ok: true, payload, transport: trimmed.startsWith("data:") ? "sse" : "json" };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** One async-result poll (the mission's 5s-cadence check). */
async function fetchAsyncResult({ agentId, asyncId, timeoutMs = 30_000, env = process.env, fetchImpl = fetch }) {
  const cfg = config(env);
  if (!cfg.key) return { ok: false, error: "zai_key_missing", detail: "ZAI_AGENTS_KEY (or ZAI_API_KEY) is not configured" };
  return postJson(`${cfg.baseUrl}/v1/agents/async-result`, {
    key: cfg.key,
    body: { agent_id: agentId, async_id: asyncId },
    timeoutMs,
    fetchImpl,
  });
}

/**
 * THE POLL LOOP (mission law): check every 5s, give up at the timeout, return
 * the result or an honest failure. Works for any agent that hands back an
 * async_id (vidu today).
 */
async function pollAgentResult({
  agentId,
  asyncId,
  intervalMs,
  timeoutMs,
  env = process.env,
  fetchImpl = fetch,
}) {
  const cfg = config(env);
  const interval = Math.max(250, intervalMs || cfg.pollMs);
  const deadline = Date.now() + Math.max(interval, timeoutMs || cfg.timeoutMs);
  let last = null;
  while (Date.now() < deadline) {
    const polled = await fetchAsyncResult({ agentId, asyncId, timeoutMs: 30_000, env, fetchImpl });
    if (!polled.ok) return polled;
    const parsed = safeJson(polled.text.trim().startsWith("data:") ? null : polled.text) || parseSseEvents(polled.text)[0];
    last = parsed;
    if (parsed && typeof parsed === "object") {
      if (parsed.status === "success") return { ok: true, payload: parsed };
      if (parsed.status === "failed") {
        const err = parsed.error || {};
        return { ok: false, error: `agent_failed:${err.code || "unknown"}`, detail: String(err.message || "the agent reported a failure") };
      }
    }
    await sleep(interval);
  }
  return { ok: false, error: "timeout", detail: `no terminal status after ${Math.round((timeoutMs || cfg.timeoutMs) / 1000)}s`, last };
}

// ---------------------------------------------------------------------------
// THE TWO OPERATIONS
// ---------------------------------------------------------------------------
/**
 * generatePoster(businessName, services, phone, colors) — or the same fields
 * as one options object. Submits to slides_glm_agent, reads the stream to
 * completion under the budget, and returns the poster's image URLs (the assets
 * the agent placed) plus any export/deck links in the answer.
 */
async function generatePoster(businessName, services, phone, colors, options = {}) {
  const spec = typeof businessName === "object" && businessName !== null
    ? businessName
    : { businessName, services, phone, colors, ...options };
  const {
    businessName: name,
    services: servicesSpec,
    phone: phoneSpec,
    colors: colorsSpec,
    tagline = "",
    format = "vertical marketing poster (portrait orientation)",
    requestId,
    timeoutMs,
    env = process.env,
    fetchImpl = fetch,
  } = spec;
  if (!name) return { ok: false, error: "business_name_missing", detail: "a poster needs a business name" };

  const serviceList = Array.isArray(servicesSpec)
    ? servicesSpec.join(", ")
    : String(servicesSpec || "").trim();
  const lines = [
    `Create one professional marketing poster for "${name}".`,
    tagline ? `Tagline or headline: ${tagline}.` : "",
    serviceList ? `Services to feature: ${serviceList}.` : "",
    phoneSpec ? `Phone number, printed large and prominent: ${phoneSpec}.` : "",
    colorsSpec ? `Color palette: ${Array.isArray(colorsSpec) ? colorsSpec.join(", ") : colorsSpec}.` : "",
    `Format: ${format}. Bold headline, clean layout, strong call to action. Deliver the finished poster.`,
  ].filter(Boolean);

  const startedAt = Date.now();
  const submitted = await submitAgentTask({
    agentId: SLIDES_AGENT,
    messages: [{ role: "user", content: [{ type: "text", text: lines.join(" ") }] }],
    requestId: requestId || `wss-poster-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timeoutMs,
    env,
    fetchImpl,
  });
  if (!submitted.ok) return { ...submitted, elapsedMs: Date.now() - startedAt };
  const result = harvest(submitted.payload);
  const elapsedMs = Date.now() - startedAt;
  if (!result.ok) return { ...result, elapsedMs };
  return {
    ...result,
    elapsedMs,
    posterImages: result.images,
    // Honest: a finished poster with zero images AND zero links is a failure.
    ...(result.images.length === 0 && result.links.length === 0
      ? { ok: false, error: "no_urls_returned", detail: "the agent finished but produced no image URLs or links" }
      : {}),
  };
}

/**
 * generateVideo(template, imageUrl, prompt) — vidu_template_agent. Submit with
 * the template + source image, then poll async-result every 5s to the 300s
 * ceiling for the finished video URL.
 */
async function generateVideo(template, imageUrl, prompt, options = {}) {
  const spec = typeof template === "object" && template !== null ? template : { template, imageUrl, prompt, ...options };
  const {
    template: tpl,
    imageUrl: imageSpec,
    prompt: promptSpec,
    requestId,
    timeoutMs,
    env = process.env,
    fetchImpl = fetch,
  } = spec;
  if (!tpl || !VIDEO_TEMPLATES.has(String(tpl))) {
    return { ok: false, error: "invalid_template", detail: `template must be one of ${[...VIDEO_TEMPLATES].join(", ")}` };
  }
  if (!imageSpec) return { ok: false, error: "image_url_missing", detail: "the template agent needs a source image URL" };
  const text = String(promptSpec || `Apply the ${tpl} template to this image.`);

  const submitted = await submitAgentTask({
    agentId: VIDEO_AGENT,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: String(imageSpec) },
        { type: "text", text },
      ],
    }],
    customVariables: { template: String(tpl) },
    requestId,
    timeoutMs: Math.min(timeoutMs || 60_000, 60_000),
    env,
    fetchImpl,
  });
  if (!submitted.ok) return submitted;

  const ack = harvest(submitted.payload);
  const asyncId = ack.asyncId || (submitted.payload && submitted.payload.async_id) || "";
  if (!asyncId) {
    // No async handle: either it already finished inline or it can never be found.
    if (ack.videos && ack.videos.length) return { ...ack, videoUrl: ack.videos[0] };
    return { ok: false, error: "no_async_id", detail: "the video agent returned no task id and no finished video" };
  }

  const cfg = config(env);
  const polled = await pollAgentResult({
    agentId: VIDEO_AGENT,
    asyncId,
    intervalMs: cfg.pollMs,
    timeoutMs: timeoutMs || cfg.timeoutMs,
    env,
    fetchImpl,
  });
  if (!polled.ok) return { ...polled, asyncId, conversationId: ack.conversationId };
  const finished = harvest(polled.payload);
  if (!finished.ok) return { ...finished, asyncId };
  if (!finished.videos.length) {
    return { ok: false, error: "no_video_url", detail: "the task succeeded but carried no video URL", asyncId };
  }
  return { ...finished, videoUrl: finished.videos[0], asyncId };
}

module.exports = {
  SLIDES_AGENT,
  VIDEO_AGENT,
  VIDEO_TEMPLATES,
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  config,
  parseSseEvents,
  imageUrlsFrom,
  videoUrlsFrom,
  harvest,
  submitAgentTask,
  fetchAsyncResult,
  pollAgentResult,
  generatePoster,
  generateVideo,
};
