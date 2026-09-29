"use strict";

// scripts/riley-eyes/endpoint-proof.js — drive api/riley/context.js in process,
// with real production data behind it and a real VAPI-shaped body in front.
//
// This is the join the unit tests cannot cover: auth, the toolCall envelope,
// caller resolution, the internally-signed scope token, and the sentence Riley
// would actually read out. Run:  node scripts/riley-eyes/endpoint-proof.js

const path = require("node:path");
const BACKEND = path.resolve(__dirname, "..", "..");
require(path.join(BACKEND, "scripts", "brightdata-edit-proof", "env.js")).loadEnv();

const handler = require(path.join(BACKEND, "api", "riley", "context.js"));

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += String(chunk); return this; },
  };
}

async function call(label, { secret, args, toolCallId }) {
  const res = mockRes();
  const body = toolCallId
    ? { message: { toolCalls: [{ id: toolCallId, function: { arguments: args } }], call: { id: `proof-${Date.now()}` } } }
    : args;
  await handler({ method: "POST", headers: { "x-vapi-secret": secret }, body }, res);
  console.log(`\n--- ${label} --- HTTP ${res.statusCode}`);
  let parsed;
  try { parsed = JSON.parse(res.body); } catch { parsed = null; }
  if (parsed && Array.isArray(parsed.results)) {
    console.log(`  envelope: results[0].toolCallId = ${parsed.results[0].toolCallId}`);
    parsed = JSON.parse(parsed.results[0].result);
  }
  return { statusCode: res.statusCode, payload: parsed, raw: res.body };
}

(async () => {
  const secret = String(process.env.VAPI_TOOL_SECRET || process.env.VAPI_WEBHOOK_SECRET || process.env.GHOST_AGENCY_ADMIN_TOKEN || "").trim();
  console.log(`secret present: ${secret ? `yes (${secret.length} chars)` : "NO"}`);

  const bad = await call("wrong secret is refused", { secret: "nope", args: { client_ref: "Poor John's Plumbing" } });
  console.log(`  ${bad.raw}`);

  const none = await call("no identity is asked for, not guessed", { secret, args: {} });
  console.log(`  say: ${none.payload && none.payload.say}`);

  const named = await call("resolved by business name, with a change in flight", {
    secret,
    toolCallId: "toolcall-proof-1",
    args: { client_ref: "Poor John's Plumbing", instruction: "put that photo I sent on the home page" },
  });
  if (named.payload && named.payload.ok) {
    const p = named.payload;
    console.log(`  business: ${p.business_name}`);
    console.log(`  sections: ${Object.entries(p.context.sections).map(([k, v]) => `${k}=${v.ok ? v.items.length : "UNREADABLE"}`).join(" ")}`);
    console.log(`  capability: supported=${p.capability && p.capability.supported} op=${(p.capability && p.capability.op) || "-"}`);
    console.log(`  timing.say: ${p.timing && p.timing.say}`);
    console.log(`  SAY >> ${p.say}`);
    console.log(`  verbs: ${p.can_do.verbs.length}`);
    console.log(`  bytes on the wire: ${named.raw.length}`);
  } else {
    console.log(`  ${named.raw.slice(0, 600)}`);
  }

  const unsupported = await call("a request with no verb behind it", {
    secret,
    args: { client_ref: "Poor John's Plumbing", instruction: "can you run my Facebook ads for me" },
  });
  if (unsupported.payload && unsupported.payload.ok) {
    console.log(`  capability.supported = ${unsupported.payload.capability.supported}`);
    console.log(`  REFUSAL >> ${unsupported.payload.capability.say}`);
    console.log(`  timing present: ${Boolean(unsupported.payload.timing)}`);
  }

  const unknown = await call("an account that does not exist", {
    secret,
    args: { client_ref: "Nobody's Plumbing Of Nowhere" },
  });
  console.log(`  ${unknown.raw.slice(0, 300)}`);
})();
