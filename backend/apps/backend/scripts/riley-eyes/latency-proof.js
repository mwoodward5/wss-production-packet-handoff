"use strict";

// scripts/riley-eyes/latency-proof.js — how long the caller waits.
//
// A voice tool is not free. The owner's note on Riley "talking over me" turned
// out to be three-second tool calls, not eagerness, and VAPI kills a tool
// webhook at 20 seconds. So the cost of the eyes has to be MEASURED, not
// assumed — cold (first call of a call, identity unresolved) and warm (the same
// caller, already remembered).

const path = require("node:path");
const BACKEND = path.resolve(__dirname, "..", "..");
require(path.join(BACKEND, "scripts", "brightdata-edit-proof", "env.js")).loadEnv();

const handler = require(path.join(BACKEND, "api", "riley", "context.js"));
const { signScopeToken } = require(path.join(BACKEND, "lib", "dashboard-link.js"));
const { readRileyContext } = require(path.join(BACKEND, "lib", "riley-context.js"));
const { resetTimingCache, loadEditTimings } = require(path.join(BACKEND, "lib", "edit-timing.js"));

const SLUG = process.argv[2] || "wss-test-poor-john-s-plumbing-parkville";

function mockRes() {
  return { statusCode: 200, body: "", headers: {}, setHeader() {}, end(c) { if (c) this.body += String(c); return this; } };
}

async function timed(label, fn) {
  const t0 = Date.now();
  const out = await fn();
  const ms = Date.now() - t0;
  console.log(`${String(ms).padStart(6)}ms  ${label}`);
  return { ms, out };
}

(async () => {
  const secret = String(process.env.VAPI_TOOL_SECRET || process.env.VAPI_WEBHOOK_SECRET || process.env.GHOST_AGENCY_ADMIN_TOKEN || "").trim();
  const callId = `latency-proof-${Date.now()}`;

  await timed("context read alone (no identity resolution)", () =>
    readRileyContext({ scopeToken: signScopeToken(SLUG, 1) }));

  resetTimingCache();
  await timed("timing history, cold", () => loadEditTimings({}));
  await timed("timing history, cached", () => loadEditTimings({}));

  const cold = await timed("ENDPOINT cold: resolve by business name + full context", () => {
    const res = mockRes();
    return handler({
      method: "POST",
      headers: { "x-vapi-secret": secret },
      body: { message: { call: { id: callId }, toolCalls: [{ id: "t1", function: { arguments: { client_ref: "Poor John's Plumbing", instruction: "make the phone number bigger" } } }] } },
    }, res).then(() => res);
  });

  const warm = await timed("ENDPOINT warm: same call id, identity remembered", () => {
    const res = mockRes();
    return handler({
      method: "POST",
      headers: { "x-vapi-secret": secret },
      body: { message: { call: { id: callId }, toolCalls: [{ id: "t2", function: { arguments: {} } }] } },
    }, res).then(() => res);
  });

  console.log(`\ncold payload: ${cold.out.body.length} bytes, HTTP ${cold.out.statusCode}`);
  console.log(`warm payload: ${warm.out.body.length} bytes, HTTP ${warm.out.statusCode}`);
  console.log(`\nVAPI kills a tool webhook at 20000ms. Cold headroom: ${20000 - cold.ms}ms.`);
})();
