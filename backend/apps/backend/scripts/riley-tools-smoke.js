"use strict";

// scripts/riley-tools-smoke.js — DEPLOY SMOKE for Riley's ONE authenticated
// tool proxy (api/vapi-tools/riley.js).
//
// The production incident this answers: each Vapi tool carried its own secret
// header inside the assistant config, and after a deploy/rotation the SAME
// live call got lookup OK and site-edit-status 401 — site_edit_status ran
// 0-for-3 on auth (calls 7 ×2, call 11), answering the bare string
// "unauthorized" while request_site_change succeeded on the SAME account
// seconds apart. The status route's secret/header was the broken one, and
// nothing failed at deploy time because nothing probed the voice lane at
// deploy time.
//
// This script is that probe. For EACH tool behind the proxy it POSTs a benign,
// non-mutating probe to the deployed base URL — the exact wrapped shape Vapi
// sends — with the ONE secret, and asserts the answer proves the whole chain:
// authentication accepted, the right sub-tool dispatched, a well-formed
// response returned. The proven repeat offender gets TWO named checks:
//
//   status-auth         site_edit_status through the proxy — auth + dispatch
//                       + store round-trip in one probe;
//   status-auth-legacy  the legacy /api/vapi-tools/site-edit-status route
//                       directly, with the one secret — because until the
//                       ops step repoints the assistant, that route is still
//                       the one taking live traffic, and its 401 is exactly
//                       the drift that has already happened.
//
// A wrong-secret negative control also runs (the proxy MUST refuse it), so a
// proxy that somehow stopped checking secrets fails here too.
//
// Exit code 0 = every probe healthy. Non-zero on ANY auth failure (401/403
// with the real secret) or any response that is not the probe's expected
// healthy answer — wire it into your deploy checklist and secret drift is
// caught at deploy, not on a live customer call.
//
// Usage:
//   node scripts/riley-tools-smoke.js [base-url]
//
// Environment:
//   SMOKE_BASE_URL            deployed base (default GHOST_AGENCY_API_URL,
//                             then https://ghost.wss-ai.com)
//   SMOKE_RILEY_PROXY_URL     full proxy URL override (default
//                             <base>/api/vapi-tools/riley)
//   SMOKE_TIMEOUT_MS          per-request timeout (default 20000)
//   + one of VAPI_TOOL_SECRET | VAPI_WEBHOOK_SECRET | GHOST_AGENCY_ADMIN_TOKEN
//     (the same family api/vapi-tools/riley.js accepts — the ONE secret the
//     assistant's tools should all carry)
//
// Run locally:  npm run smoke:riley
// (Documented only — deliberately NOT wired into the deploy pipeline.)

const PROBE_NAME = "riley-deploy-smoke";

function argBaseUrl() {
  const a = process.argv.slice(2).find((v) => !v.startsWith("-"));
  return a ? String(a).replace(/\/+$/, "") : "";
}

const BASE = (
  argBaseUrl()
  || String(process.env.SMOKE_BASE_URL || "").replace(/\/+$/, "")
  || String(process.env.GHOST_AGENCY_API_URL || "").replace(/\/+$/, "")
  || "https://ghost.wss-ai.com"
);
const PROXY_URL = String(process.env.SMOKE_RILEY_PROXY_URL || `${BASE}/api/vapi-tools/riley`);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 20000;
const SECRET = String(
  process.env.VAPI_TOOL_SECRET
  || process.env.VAPI_WEBHOOK_SECRET
  || process.env.GHOST_AGENCY_ADMIN_TOKEN
  || "",
).trim();

/** The exact wrapped shape Vapi puts on the wire. */
function vapiBody(functionName, args) {
  return {
    message: {
      type: "tool-calls",
      toolCalls: [{
        id: `${PROBE_NAME}-${Math.random().toString(36).slice(2, 8)}`,
        type: "function",
        function: { name: functionName, arguments: JSON.stringify(args) },
      }],
      call: { id: `${PROBE_NAME}-${Date.now()}` },
    },
  };
}

async function post(url, body, secret) {
  const started = Date.now();
  let res, text;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-vapi-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await res.text();
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: String(error.message || error) };
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON is a finding, not a crash */ }
  return { ok: true, status: res.status, ms: Date.now() - started, json, text };
}

/** Pull the sub-tool's own payload out of either the Vapi envelope or a flat body. */
function innerPayload(json) {
  if (json && Array.isArray(json.results) && json.results[0]) {
    const r = json.results[0].result;
    try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; }
  }
  return json;
}

const probes = [
  {
    id: "lookup-dispatch",
    tool: "lookup_business_record",
    say: "read-only lookup of a business that cannot exist",
    body: vapiBody("lookup_business_record", { business_name: "ZZ Riley Deploy Smoke No Such Business ZZ" }),
    expect: { status: 200, proof: (p) => p && typeof p === "object" && "found" in p },
    proofNote: "a flat lookup answer (found true or false both prove the dispatch)",
  },
  {
    id: "context-dispatch",
    tool: "look_up_customer",
    say: "context read with no identity, which must be asked for, not guessed",
    body: vapiBody("look_up_customer", {}),
    expect: { status: 400, proof: (p) => p && p.status === "need_identity" },
    proofNote: "the context tool's own need_identity answer",
  },
  {
    id: "edit-dispatch",
    tool: "request_site_change",
    say: "empty instruction, refused before anything is resolved or written",
    body: vapiBody("request_site_change", { instruction: "" }),
    // The edit core answers VAPI-relayable refusals with 200 + ok:false (a 4xx
    // would lose the `say` to the model), so a healthy answer is the envelope.
    expect: { status: 200, proof: (p) => p && p.ok === false && /instruction/i.test(String(p.error || "")) },
    proofNote: "the edit tool's own instruction-validation answer (relayable refusal envelope)",
  },
  {
    // THE PROVEN REPEAT OFFENDER, checked by name: site_edit_status ran
    // 0-for-3 on auth in production while its sibling answered. This check
    // exists so the next drift of this exact secret fails HERE.
    id: "status-auth",
    tool: "site_edit_status",
    say: "status of a jobId that cannot exist, through the ONE door (one read, zero writes)",
    body: vapiBody("site_edit_status", { jobId: `smoke-probe-${Math.random().toString(36).slice(2, 10)}` }),
    expect: { status: 404, proof: (p) => p && p.error === "job not found" },
    proofNote: "the status tool's own not-found answer (auth + dispatch + store round-trip)",
  },
  {
    id: "note-dispatch",
    tool: "send_note",
    say: "note to a non-allowlisted address, refused before any mail exists",
    body: vapiBody("send_note", { to: "riley-deploy-smoke@example.com", subject: "deploy smoke", body: "benign probe" }),
    expect: { status: 200, proof: (p) => p && p.ok === false && p.refused === "recipient_not_allowed" },
    proofNote: "the note tool's own allowlist refusal — nothing is sent",
  },
];

(async () => {
  console.log(`riley-tools-smoke -> proxy ${PROXY_URL}`);
  if (!SECRET) {
    console.error("FAIL — no tool secret configured. Set VAPI_TOOL_SECRET (or VAPI_WEBHOOK_SECRET / GHOST_AGENCY_ADMIN_TOKEN).");
    process.exitCode = 1;
    return;
  }

  let failures = 0;

  // NEGATIVE CONTROL first: a wrong secret MUST be refused. This is the exact
  // failure the proxy exists to contain — prove the door still locks.
  const bad = await post(PROXY_URL, vapiBody("lookup_business_record", { business_name: "should not get this far" }), "definitely-not-the-secret");
  const badOk = bad.ok && bad.status === 401;
  console.log(`${badOk ? "PASS" : "FAIL"}  [auth-negative]          wrong secret -> ${bad.status || "no response"}${badOk ? "" : ` (expected 401) ${bad.error || ""}`}`);
  if (!badOk) failures += 1;

  for (const probe of probes) {
    const r = await post(PROXY_URL, probe.body, SECRET);
    const payload = r.ok ? innerPayload(r.json) : null;
    const healthy = r.ok
      && r.status === probe.expect.status
      && probe.expect.proof(payload);
    console.log(`${healthy ? "PASS" : "FAIL"}  [${probe.id}]${" ".repeat(Math.max(1, 17 - probe.id.length))}${probe.tool.padEnd(22)} -> ${r.status || "no response"} in ${r.ms}ms  (${probe.say})`);
    if (!healthy) {
      failures += 1;
      console.log(`       expected ${probe.expect.status} with ${probe.proofNote}`);
      const detail = (r.json && !Array.isArray(r.json) && typeof r.json === "object")
        ? JSON.stringify(innerPayload(r.json)).slice(0, 400)
        : String(r.text || r.error || "").slice(0, 400);
      if (detail) console.log(`       got: ${detail}`);
      if (r.status === 401 || r.status === 403) {
        console.log("       ^ AUTH FAILURE — the deployed proxy rejected the one secret: exactly the drift this smoke exists to catch.");
        if (probe.id === "status-auth") console.log("       ^ this is the route that went 0-for-3 on a live call (calls 7 ×2, call 11) while request_site_change answered — do not deploy.");
      }
    }
  }

  // THE PROVEN REPEAT OFFENDER, second angle: the LEGACY status route. The
  // assistant keeps hitting it until the ops step repoints the tools at the
  // proxy, so a broken status secret shows up HERE first — as it did on the
  // live call, as the bare string "unauthorized".
  const legacyUrl = `${BASE}/api/vapi-tools/site-edit-status`;
  const legacy = await post(legacyUrl, { jobId: `smoke-probe-${Math.random().toString(36).slice(2, 10)}` }, SECRET);
  const legacyPayload = legacy.ok ? innerPayload(legacy.json) : null;
  const legacyHealthy = legacy.ok && legacy.status === 404 && legacyPayload && legacyPayload.error === "job not found";
  console.log(`${legacyHealthy ? "PASS" : "FAIL"}  [status-auth-legacy]     GET-less POST ${legacyUrl.replace(BASE, "")} -> ${legacy.status || "no response"} in ${legacy.ms}ms  (the legacy route the assistant still calls today)`);
  if (!legacyHealthy) {
    failures += 1;
    if (legacy.status === 401 || legacy.status === 403 || /^\s*"?\s*unauthorized\s*"?\s*$/i.test(String(legacy.text || ""))) {
      console.log(`       ^ THE PRODUCTION SIGNATURE: site_edit_status answered ${JSON.stringify(String(legacy.text || "").slice(0, 120))} with the shared secret while its siblings answer. The status secret/header has drifted again — repoint the tool at the proxy or fix the secret BEFORE deploy; this is the 0-for-3 failure from calls 7 ×2 and 11.`);
    } else {
      console.log(`       expected 404 with { error: "job not found" } — auth + dispatch + store round-trip on the legacy route`);
      const detail = String(legacy.text || legacy.error || "").slice(0, 400);
      if (detail) console.log(`       got: ${detail}`);
    }
  }

  console.log(failures === 0
    ? "PASS — all Riley voice tools answer through the one proxy with the one secret (status-auth checked by name)."
    : `FAIL — ${failures} probe(s) unhealthy. Do not point the assistant at this deploy until the table above is green.`);
  if (failures > 0) process.exitCode = 1;
})();
