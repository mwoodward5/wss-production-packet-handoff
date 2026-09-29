"use strict";

// Read-only call feed + live-listen support, AnswerCrew-style, for the
// command center's Calls tab.
//
// GET  -> recent VAPI calls mapped to an owner-friendly shape. In-progress
//         calls include monitor.listenUrl so the console can stream live
//         audio ("whisper listen") over WebSocket.
// POST {action:"enable-monitor", assistantId} -> turns on the assistant's
//         monitorPlan (listen only, no barge-in control) so FUTURE calls
//         expose a listenUrl. Mutation is admin-gated and logged.
const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { recordEvent } = require("../../lib/store");

function friendlyOutcome(call) {
  const status = String(call.status || "");
  const reason = String(call.endedReason || "");
  if (status === "in-progress") return "🔴 Live right now";
  if (status === "ringing") return "📳 Ringing";
  if (status === "queued") return "⏳ Queued";
  if (status === "forwarding") return "↪️ Being transferred";
  if (/customer-ended-call|assistant-ended-call/.test(reason)) return "✅ Completed";
  if (/no-answer|busy/.test(reason)) return "📵 No answer";
  if (/voicemail/.test(reason)) return "📼 Voicemail";
  if (/error|failed/.test(reason)) return "⚠️ Problem on the line";
  return status ? status.replace(/-/g, " ") : "call";
}

function durationSec(call) {
  const a = Date.parse(call.startedAt || "");
  const b = Date.parse(call.endedAt || "");
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) return Math.round((b - a) / 1000);
  return null;
}

function callDiagnostic(call = {}) {
  const code = String(call.endedReason || call.error?.code || call.status || "unknown").toLowerCase();
  const message = [call.error?.message, call.analysis?.error, call.transport?.error].filter(Boolean).join(" ").toLowerCase();
  const evidence = `${code} ${message}`;
  let category = "unknown";
  let stage = "unknown";
  if (/customer-ended-call|caller-disconnect/.test(evidence)) { category = "caller_disconnect"; stage = "connected_call"; }
  else if (/assistant-ended-call|completed|ended$/.test(evidence)) { category = "completed"; stage = "connected_call"; }
  else if (/no-answer|busy|voicemail|carrier|twilio|vonage|provider.*(closed|failed)|did-not-answer/.test(evidence)) { category = "carrier"; stage = "dial_or_connect"; }
  else if (/webhook|server-url|server.*unreachable|invalid.*response/.test(evidence)) { category = "webhook"; stage = "assistant_webhook"; }
  else if (/tool.*(timeout|timed-out)|function.*timeout/.test(evidence)) { category = "tool_timeout"; stage = "tool_execution"; }
  else if (/consent|recording.*(plan|required|failed)|compliance/.test(evidence)) { category = "consent"; stage = "pre_call_compliance"; }
  else if (/assistant|pipeline|llm|model|voice.*error/.test(evidence)) { category = "assistant"; stage = "assistant_runtime"; }
  return {
    category,
    stage,
    providerCode: code,
    evidence: code === "unknown" ? [] : [code],
    attributableToCaller: category === "caller_disconnect",
    diagnosed: category !== "unknown",
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const key = String(process.env.VAPI_API_KEY || "").trim();
    if (!key) return sendJson(res, 200, { ok: false, error: "VAPI_API_KEY not configured" });
    const headers = { Authorization: `Bearer ${key}` };

    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (body.action === "enable-monitor" && body.assistantId) {
        // Listen-only: controlEnabled stays false so nobody can inject
        // audio/commands into a live customer call from the console.
        const patchRes = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(body.assistantId)}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ monitorPlan: { listenEnabled: true, controlEnabled: false } }),
        });
        const patched = await patchRes.json().catch(() => ({}));
        await recordEvent("admin.monitor_enabled", {
          assistantId: body.assistantId,
          listenEnabled: true,
          controlEnabled: false,
        }).catch(() => {});
        return sendJson(res, patchRes.ok ? 200 : 502, {
          ok: patchRes.ok,
          assistantId: body.assistantId,
          monitorPlan: patched.monitorPlan || null,
          error: patchRes.ok ? undefined : patched,
        });
      }
      return sendJson(res, 400, { ok: false, error: "unknown action" });
    }

    const [callsRes, assistantsRes] = await Promise.all([
      fetch("https://api.vapi.ai/call?limit=50", { headers }),
      fetch("https://api.vapi.ai/assistant?limit=50", { headers }),
    ]);
    const callsRaw = await callsRes.json().catch(() => []);
    const assistantsRaw = await assistantsRes.json().catch(() => []);
    if (!callsRes.ok) return sendJson(res, 502, { ok: false, error: callsRaw });
    const assistants = Array.isArray(assistantsRaw) ? assistantsRaw : [];
    const nameById = {};
    const monitorById = {};
    for (const a of assistants) {
      nameById[a.id] = a.name || a.id;
      monitorById[a.id] = !!(a.monitorPlan && a.monitorPlan.listenEnabled);
    }

    const calls = (Array.isArray(callsRaw) ? callsRaw : []).map((c) => {
      const live = c.status === "in-progress" || c.status === "ringing" || c.status === "forwarding";
      return {
        id: c.id,
        status: c.status || "",
        live,
        outcome: friendlyOutcome(c),
        assistantId: c.assistantId || "",
        assistantName: nameById[c.assistantId] || "assistant",
        customerNumber: (c.customer && c.customer.number) || "",
        startedAt: c.startedAt || c.createdAt || null,
        endedAt: c.endedAt || null,
        durationSec: durationSec(c),
        endedReason: c.endedReason || "",
        summary: (c.analysis && c.analysis.summary) || "",
        transcript: c.transcript || (c.artifact && c.artifact.transcript) || "",
        recordingUrl: (c.artifact && (c.artifact.recordingUrl || c.artifact.recording?.url)) || c.recordingUrl || "",
        // live-listen websocket (only present while the call is up AND the
        // assistant's monitorPlan.listenEnabled was true when it started)
        listenUrl: live ? (c.monitor && c.monitor.listenUrl) || "" : "",
        cost: c.cost != null ? c.cost : null,
        diagnostic: callDiagnostic(c),
      };
    });

    const liveCalls = calls.filter((c) => c.live);
    return sendJson(res, 200, {
      ok: true,
      liveCalls,
      calls: calls.filter((c) => !c.live).slice(0, 30),
      monitorByAssistant: monitorById,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.callDiagnostic = callDiagnostic;
