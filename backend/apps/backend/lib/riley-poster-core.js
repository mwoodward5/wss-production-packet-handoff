"use strict";

// lib/riley-poster-core.js — Riley's generate_poster capability: the core of
// api/vapi-tools/generate-poster.js, extracted so the ONE proxy door
// (api/vapi-tools/riley.js) dispatches to it as a library function — the same
// shape as riley-lookup-core / site-edit-core / riley-send-note-core.
//
// WHAT IT IS FOR
// A caller on the phone asks for marketing artwork ("make me a poster for my
// AC tune-up special"). Riley calls this tool with the request; the Z.ai GLM
// slide/poster agent (lib/zai-agents.js generatePoster) draws it and the
// finished image URLs are delivered — spoken when they arrive in time, emailed
// and ledgered when they do not.
//
// WHY THE WAIT WORKS THE WAY IT DOES (measured, 2026-09-16)
// A real poster run streams for ~290s. No voice call can hold a tool open that
// long, and the slides agent hands back NO async id — aborting the read loses
// the run. So the core does what the edit chain does: it fires the work
// DETACHED (full 300s budget, lib law) and answers the caller in milliseconds
// with only promises that are already true:
//
//   - "riley.poster_requested"  is written to the ledger the moment the run
//     starts (the caller's "the team has it" is a queryable row, not a vibe);
//   - on settle, "riley.poster_ready" (with the image URLs) or
//     "riley.poster_failed" (with the honest error) is written;
//   - on success the images are emailed — to the customer's own address on the
//     prospect record when present, else the one allowlisted owner inbox
//     (riley-send-note-core's law: a voice lane never mails an address the
//     caller dictated; the record's address was verified at intake).
//
// Callers that CAN wait (the dashboard's marketing button, admin tests) pass
// wait_for_result — then the core runs the same generatePoster inline with the
// full budget and returns the URLs in the response.
//
// EVERY AUTHENTICATED OUTCOME IS A SPOKEN OUTCOME: 200 with ok:false + refused
// code + say line, exactly like send-note. Unauthenticated stays a bare 401 at
// the route.

const { select, recordEvent } = require("./store");
const { generatePoster } = require("./zai-agents");

const MAX_POSTERS_PER_HOUR = 6;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUEST_CHARS = 600;

// The one inbox a poster may land in when the prospect record carries no
// address. Same reasoning as riley-send-note-core: the trigger is speech.
const FALLBACK_RECIPIENT = "woodwardsoftware@gmail.com";

const startTimestamps = [];

function rateLimitState(now = Date.now()) {
  while (startTimestamps.length && now - startTimestamps[0] > RATE_WINDOW_MS) startTimestamps.shift();
  return {
    limit: MAX_POSTERS_PER_HOUR,
    used: startTimestamps.length,
    remaining: Math.max(0, MAX_POSTERS_PER_HOUR - startTimestamps.length),
  };
}

function toolArgs(body) {
  const call = body?.message?.toolCalls?.[0];
  const raw = call?.function?.arguments;
  let args = body;
  if (raw) {
    try { args = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { args = {}; }
  }
  return { call, args: args && typeof args === "object" ? args : {} };
}

async function resolveProspect(clientId) {
  if (!clientId) return null;
  try {
    const found = await select("ghost_agency_prospects", `?select=*&record->>reference=eq.${encodeURIComponent(clientId)}&limit=1`);
    const rows = found?.ok && Array.isArray(found.data) ? found.data : (Array.isArray(found) ? found : []);
    return rows[0] || null;
  } catch { return null; }
}

function prospectEmail(prospect) {
  return String(
    (prospect && ((prospect.record && prospect.record.email) || prospect.email)) || "",
  ).trim() || "";
}

/** The one email the poster is mailed to, and why. Never caller-dictated. */
function deliverTo(prospect) {
  const email = prospectEmail(prospect);
  return email
    ? { to: email, because: "prospect_record" }
    : { to: FALLBACK_RECIPIENT, because: "owner_allowlist" };
}

async function emailPosterImages({ to, businessName, images, answer }) {
  const { sendResendEmail } = require("./email");
  const gallery = images
    .slice(0, 8)
    .map((url, i) => `<div style="margin:14px 0"><a href="${url}"><img src="${url}" alt="${businessName} poster asset ${i + 1}" style="max-width:560px;width:100%;border:1px solid #14213A"></a><div style="font:12px Georgia,serif;color:#3D4A66;margin-top:4px">Asset ${i + 1} — <a href="${url}">open full size</a></div></div>`)
    .join("");
  const summary = String(answer || "").slice(0, 600);
  return sendResendEmail({
    to,
    cc: [],
    bcc: [],
    senderKind: "transactional",
    subject: `Your ${businessName} marketing poster`,
    text: `Your marketing poster for ${businessName} is ready.\n\nImages:\n${images.slice(0, 8).map((u) => `- ${u}`).join("\n")}\n\n${summary}`,
    html: `<div style="font:16px/1.6 Georgia,serif;color:#14213A"><p>Your marketing poster for <b>${businessName}</b> is ready — the generated assets are below and attached as links.</p>${gallery}${summary ? `<p style="font-style:italic;color:#3D4A66">${summary}</p>` : ""}<p style="font:12px Georgia,serif;color:#3D4A66">Generated by the WSS design agent at Riley's request.</p></div>`,
  }).catch(() => null);
}

/**
 * THE CORE. Given the parsed tool-call body, return { status, payload } where
 * payload is exactly what the route sends (VAPI envelope merged when a toolCall
 * id is present). Every authenticated outcome is 200.
 */
async function posterCore(body) {
  const { call, args } = toolArgs(body);
  const caller = String(
    body?.message?.call?.customer?.number
      || body?.message?.customer?.number
      || body?.call?.customer?.number
      || args?.caller_phone
      || "",
  ).trim() || "unknown";

  const respond = (payload) => ({ status: 200, payload: call?.id
    ? { ...payload, results: [{ toolCallId: call.id, result: JSON.stringify(payload) }] }
    : payload });

  const keyConfigured = Boolean(String(process.env.ZAI_AGENTS_KEY || process.env.ZAI_API_KEY || "").trim());
  if (!keyConfigured) {
    return respond({
      ok: false,
      status: "not_configured",
      say: "I can't reach the design service just now — the poster lane isn't configured on this line. I'll leave it there rather than promise something I can't send.",
    });
  }

  const clientId = String(args.client_id || args.clientId || "").trim();
  const prospect = await resolveProspect(clientId);
  const record = (prospect && prospect.record) || {};
  const businessName = String(args.business_name || args.businessName || record.business_name || prospect?.business_name || "").trim();
  const request = String(args.request || args.description || args.details || "").trim().slice(0, MAX_REQUEST_CHARS);
  const services = args.services || record.services || undefined;
  const phone = String(args.phone || record.phone || (record.contact && record.contact.phone) || "").trim() || undefined;
  const colors = args.colors || record.brand_color || undefined;

  if (!businessName) {
    return respond({
      ok: false,
      status: "who_missing",
      say: "I can start a poster the moment I know which business it's for — which company is this for?",
    });
  }

  const gate = rateLimitState();
  if (gate.remaining <= 0) {
    return respond({
      ok: false,
      status: "rate_limited",
      say: "I've already got as many posters on the drawing board as I'm allowed this hour — let me come back to this one a bit later.",
      rate: gate,
    });
  }

  const delivery = deliverTo(prospect);
  startTimestamps.push(Date.now());

  const spec = {
    businessName,
    services,
    phone,
    colors,
    tagline: request || undefined,
    env: process.env,
  };

  await recordEvent("riley.poster_requested", {
    caller,
    client_id: clientId || null,
    business_name: businessName,
    request: request || null,
    delivery_to: delivery.to,
    delivery_basis: delivery.because,
    mode: args.wait_for_result ? "wait" : "detached",
  }).catch(() => {});

  const settle = async (result) => {
    if (result && result.ok) {
      await recordEvent("riley.poster_ready", {
        caller,
        business_name: businessName,
        images: result.posterImages.slice(0, 12),
        conversation_id: result.conversationId || null,
        request_id: result.requestId || null,
        elapsed_ms: result.elapsedMs || null,
      }).catch(() => {});
      const mailed = await emailPosterImages({
        to: delivery.to,
        businessName,
        images: result.posterImages,
        answer: result.answer,
      });
      await recordEvent("riley.poster_delivered", {
        caller,
        to: delivery.to,
        basis: delivery.because,
        mailed: Boolean(mailed && mailed.mode === "sent"),
        mode: (mailed && mailed.mode) || "not_sent",
      }).catch(() => {});
      return { result, mailed };
    }
    await recordEvent("riley.poster_failed", {
      caller,
      business_name: businessName,
      error: (result && result.error) || "unknown",
      detail: String((result && result.detail) || "").slice(0, 300),
    }).catch(() => {});
    return { result };
  };

  // Callers that can hold the line (dashboard, admin smoke) get the full
  // 300s-budget answer inline. A voice call never does — see the header.
  if (args.wait_for_result) {
    const started = Date.now();
    const outcome = await settle(await generatePoster(spec));
    if (!outcome.result.ok) {
      return respond({
        ok: false,
        status: "failed",
        error: outcome.result.error,
        say: "That poster didn't come through — nothing was sent, and the failure is logged for the team.",
      });
    }
    return respond({
      ok: true,
      status: "ready",
      business_name: businessName,
      images: outcome.result.posterImages,
      links: outcome.result.links,
      answer: outcome.result.answer,
      conversation_id: outcome.result.conversationId,
      request_id: outcome.result.requestId,
      elapsed_ms: Date.now() - started,
      emailed_to: outcome.mailed && outcome.mailed.mode === "sent" ? delivery.to : null,
      say: `Your ${businessName} poster is ready — ${outcome.result.posterImages.length} image${outcome.result.posterImages.length === 1 ? "" : "s"}${outcome.mailed && outcome.mailed.mode === "sent" ? `, sent to ${delivery.to}` : ", logged for the team"}.`,
    });
  }

  // THE DETACHED RUN: same budget, real completion, no held phone line.
  setImmediate(() => {
    generatePoster(spec)
      .then(settle, (error) => settle({ ok: false, error: "threw", detail: String((error && error.message) || error) }))
      .catch(() => {});
  });

  return respond({
    ok: true,
    status: "started",
    business_name: businessName,
    delivery: { to: delivery.to, basis: delivery.because },
    budget_ms: Number(process.env.ZAI_AGENTS_TIMEOUT_MS) || 300_000,
    say: `I've put a poster for ${businessName} in motion — a good one takes about five minutes to draw. It'll be emailed to ${delivery.to} and the team can see it in the log.`,
  });
}

module.exports = { posterCore, rateLimitState, deliverTo, MAX_POSTERS_PER_HOUR };
