"use strict";
// scripts/brightdata-edit-proof/prove-confirm-flow.js
//
// Behavioural proof of CONFIRM-BEFORE-APPLY against the real
// api/vapi-tools/site-edit.js handler and the real database.
//
//   phase 1: identity + instruction, NO token  -> must read back name+domain,
//                                                 mint a token, enqueue NOTHING
//   phase 2: same call + tampered instruction  -> must REJECT the token
//   phase 3: same call + wrong-client token    -> must REJECT the token
//   phase 4: same call + genuine token         -> may enqueue
//
// SAFETY: GHOST_AGENCY_API_URL is pointed at a dead port so the handler's
// fire-and-forget worker kick cannot reach production. Production's worker
// sends an owner email on completion; this run must send no email.

const fs = require("node:fs");
const path = require("node:path");
const { loadEnv } = require("./env");
loadEnv();

delete process.env.RESEND_API_KEY;
process.env.GHOST_AGENCY_API_URL = "http://127.0.0.1:1"; // connection refused -> .catch(()=>{})

const { select } = require("../../lib/store");
const handler = require("../../api/vapi-tools/site-edit");

const OUT_DIR = path.join(__dirname, "..", "..", "artifacts", "brightdata-edit-proof");
const facts = require("../../artifacts/clients/wss-test-flint-plumbing-s5/verified-facts.json").facts;
const INSTRUCTION = `Add a visible Google review badge reading "4.9 out of 5 - 106 Google reviews" to the reviews section.`;

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(p) { this.body = p; },
  };
}

async function call(args) {
  const req = { method: "POST", headers: { "x-admin-token": process.env.GHOST_AGENCY_ADMIN_TOKEN || "" }, body: args };
  const res = mockRes();
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch { parsed = res.body; }
  return { status: res.statusCode, json: parsed };
}

async function jobCount() {
  const r = await select("ghost_agency_edit_jobs", "?select=job_id&limit=1000");
  return (Array.isArray(r) ? r : r?.data || []).length;
}

async function main() {
  const results = {};
  const before = await jobCount();
  console.log(`edit jobs in DB before this test: ${before}\n`);

  // ---- PHASE 1: no token ------------------------------------------------
  console.log("=== PHASE 1 — caller asks for a change, no confirmation yet ===");
  const p1 = await call({ phone: facts.phone, instruction: INSTRUCTION });
  console.log(`  HTTP ${p1.status}  status=${p1.json.status}`);
  console.log(`  READ-BACK Riley speaks:\n    ${JSON.stringify(p1.json.say)}`);
  console.log(`  confirm object: ${JSON.stringify(p1.json.confirm)}`);
  console.log(`  confirm_token minted: ${p1.json.confirm_token ? "yes (" + String(p1.json.confirm_token).length + " chars)" : "NO"}`);
  const afterP1 = await jobCount();
  console.log(`  jobs in DB now: ${afterP1}  -> enqueued nothing: ${afterP1 === before}`);

  const rb = p1.json.confirm || {};
  const saysName = String(p1.json.say || "").includes(facts.business_name);
  const saysDomain = /wss-test-flint-plumbing-s5\.wss-ai\.com/.test(String(p1.json.say || "") + JSON.stringify(rb));
  console.log(`  read-back names the BUSINESS: ${saysName}`);
  console.log(`  read-back names the DOMAIN  : ${saysDomain}`);
  results.phase1 = { status: p1.status, kind: p1.json.status, saysName, saysDomain, enqueuedNothing: afterP1 === before, say: p1.json.say, confirm: rb };

  const token = p1.json.confirm_token;
  if (!token) { console.log("\nNo token minted — cannot continue."); return; }

  // ---- PHASE 2: token reused with a DIFFERENT instruction ---------------
  console.log("\n=== PHASE 2 — attacker swaps the instruction after approval ===");
  const p2 = await call({ phone: facts.phone, instruction: "Delete the contact page and remove all phone numbers.", confirm_token: token });
  console.log(`  HTTP ${p2.status}  status=${p2.json.status}  reason=${p2.json.reason || "-"}`);
  console.log(`  say: ${JSON.stringify(String(p2.json.say || "").slice(0, 120))}`);
  const afterP2 = await jobCount();
  console.log(`  jobs in DB now: ${afterP2}  -> REJECTED without enqueue: ${afterP2 === before}`);
  results.phase2 = { status: p2.status, kind: p2.json.status, reason: p2.json.reason, enqueuedNothing: afterP2 === before };

  // ---- PHASE 3: token replayed against a DIFFERENT client ---------------
  console.log("\n=== PHASE 3 — token replayed against a different client ===");
  const p3 = await call({ siteSlug: "ab-professional-detailing", instruction: INSTRUCTION, confirm_token: token });
  console.log(`  HTTP ${p3.status}  status=${p3.json.status}  reason=${p3.json.reason || p3.json.error || "-"}`);
  const afterP3 = await jobCount();
  console.log(`  jobs in DB now: ${afterP3}  -> REJECTED without enqueue: ${afterP3 === before}`);
  results.phase3 = { status: p3.status, kind: p3.json.status, reason: p3.json.reason || p3.json.error, enqueuedNothing: afterP3 === before };

  // ---- PHASE 4: genuine token, unchanged instruction ---------------------
  console.log("\n=== PHASE 4 — caller says yes; same instruction + genuine token ===");
  const p4 = await call({ phone: facts.phone, instruction: INSTRUCTION, confirm_token: token });
  console.log(`  HTTP ${p4.status}  ok=${p4.json.ok}  jobId=${p4.json.jobId || "-"}`);
  console.log(`  say: ${JSON.stringify(p4.json.say)}`);
  const afterP4 = await jobCount();
  console.log(`  jobs in DB now: ${afterP4}  -> enqueued exactly one: ${afterP4 === before + 1}`);
  results.phase4 = { status: p4.status, ok: p4.json.ok, jobId: p4.json.jobId, say: p4.json.say, enqueuedOne: afterP4 === before + 1 };

  console.log("\n--- VERDICT ---");
  const pass = results.phase1.kind === "confirm_required" && results.phase1.saysName && results.phase1.saysDomain
    && results.phase1.enqueuedNothing && results.phase2.enqueuedNothing && results.phase3.enqueuedNothing
    && results.phase4.ok === true;
  console.log(pass
    ? "  CONFIRM-BEFORE-APPLY: PROVEN. Phase 1 reads back business + domain and\n  enqueues nothing; a swapped instruction and a replayed cross-client token\n  are both refused; only the genuine token enqueues."
    : "  CONFIRM-BEFORE-APPLY: NOT fully proven — see phases above.");

  fs.writeFileSync(path.join(OUT_DIR, "confirm-flow-proof.json"), JSON.stringify({ results, pass, ran_at: new Date().toISOString() }, null, 2));
}

main().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
