"use strict";

// lib/riley-telemetry.js — the one structured log line per proxied call for
// api/vapi-tools/riley.js, gated like the Line pipeline's observability valve
// (lib/line-telemetry.js, #596/#597).
//
// The proxy collapses five separately-authenticated Vapi tool endpoints into
// one door. When a secret header drifts again, the failure must be visible at
// the deploy that caused it — one line per call, with the tool, the outcome
// and the wall-clock ms, is the smallest feed that proves the door works end
// to end and names the exact tool when it does not.
//
// GHOST_AGENCY_RILEY_TELEMETRY selects the level:
//   full    (default, and any unrecognized value) — one line per proxied call.
//   reduced — only calls that did NOT answer with a clean 2xx dispatch
//             (unauthorized, unknown tool, 4xx/5xx from the tool core,
//             dispatch errors). The drift signal, without the volume.
//   off     — no lines at all.
//
// Every helper is a PURE function of (env, event) so the gate is unit-testable
// without the proxy module, and the proxy simply passes `process.env`.

const LEVEL_REDUCED = "reduced";
const LEVEL_OFF = "off";
const LEVEL_FULL = "full";

/** "reduced"/"off" only when the env says so exactly; anything else is full. */
function rileyTelemetryLevel(env = process.env) {
  const raw = String((env && env.GHOST_AGENCY_RILEY_TELEMETRY) || "").trim().toLowerCase();
  if (raw === LEVEL_REDUCED) return LEVEL_REDUCED;
  if (raw === LEVEL_OFF) return LEVEL_OFF;
  return LEVEL_FULL;
}

/**
 * Under `reduced`, keep a line only when the call did not settle cleanly:
 * anything outside 200–299, or a dispatch that never produced a status at all.
 * A healthy proxied call is the happy path the durable tool events already
 * record; the auth drift and the routing drift are the reason to pay an event.
 */
function shouldLogRileyToolCall(env = process.env, event = {}) {
  const level = rileyTelemetryLevel(env);
  if (level === LEVEL_OFF) return false;
  if (level === LEVEL_FULL) return true;
  const status = Number(event.status) || 0;
  return !(status >= 200 && status < 300);
}

/** The one line, shaped once so dashboards can rely on it. */
function rileyToolCallEvent({ tool, status, outcome, ms } = {}) {
  const n = Number(status) || 0;
  return {
    event: "riley_tool_call",
    tool: String(tool || "(none)").slice(0, 60),
    outcome: String(outcome || (n >= 200 && n < 300 ? "ok" : `http_${n}`)).slice(0, 40),
    status: n,
    ms: Math.max(0, Math.round(Number(ms) || 0)),
    at: new Date().toISOString(),
  };
}

/** Emit the line when the gate allows it. Returns whether it emitted. */
function emitRileyToolCall(env = process.env, event = {}, log = console.log) {
  if (!shouldLogRileyToolCall(env, event)) return false;
  log(JSON.stringify(rileyToolCallEvent(event)));
  return true;
}

module.exports = { rileyTelemetryLevel, shouldLogRileyToolCall, rileyToolCallEvent, emitRileyToolCall };
