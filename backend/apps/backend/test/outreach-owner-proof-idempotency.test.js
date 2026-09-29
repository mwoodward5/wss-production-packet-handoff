"use strict";

// Proves the owner-proof BATCH sender de-dups correctly (the 30-email blast fix):
//  1. STABLE prospect_id per business per run (`proof_<slug>_<runId>`), so a
//     re-run reuses the same email_log rows.
//  2. A per-business emailLogExists guard so a re-run of the same batch is a
//     no-op (skipped), never a fresh send.
//  3. prospect_id-scoped de-dup (no email arg) so N distinct businesses to the
//     one owner inbox do NOT self-block on the shared owner email-hash.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const abs = (rel) => path.join(BACKEND, rel);

// --- injected fakes -------------------------------------------------------
const state = { sentIds: new Set(), sendCalls: [], body: null, res: null };

function inject(rel, exportsObj) {
  const filename = abs(rel);
  require.cache[filename] = { id: filename, filename, loaded: true, exports: exportsObj };
}

// Stub the deps BEFORE requiring the handler so its relative requires resolve to
// these fakes (require.cache is keyed by absolute path).
inject("lib/proof-auth.js", { requireAdminOrHardeningProof: () => true });
inject("lib/http.js", {
  methodGuard: () => true,
  readJson: async () => state.body,
  sendJson: (_res, status, json) => { state.res = { status, json }; },
  handleError: (_res, err) => { state.res = { status: 500, json: { error: String(err && err.message || err) } }; },
});
inject("lib/email.js", {
  sendSequenceStep: async ({ prospect }) => {
    state.sendCalls.push(prospect.prospect_id);
    state.sentIds.add(prospect.prospect_id); // simulate the email_log write
    return { ok: true, id: `resend_${prospect.prospect_id}`, subject: "s", mode: "sent" };
  },
});
inject("lib/full-run.js", {
  emailLogExists: async ({ prospect_id }) => ({ exists: state.sentIds.has(prospect_id) }),
});

process.env.GHOST_AGENCY_OWNER_EMAIL = "woodwardsoftware@gmail.com";
const handler = require(abs("api/proof/outreach-email-smoke.js"));

async function runBatch(prospects, runId) {
  state.body = { confirm: "SEND_OUTREACH_PROOF", run_id: runId, prospects };
  state.res = null;
  await handler({ method: "POST" }, {});
  return state.res;
}

const TEN = [
  "Austin Air Conditioning", "Sierra Charlie Aviation", "Lori Fowler Luxury",
  "Urban Nail Bar", "Punchy's Detailing", "Method Aesthetics",
  "Wilson & Sons Roofing", "Scenic City Plumbing", "Sterling Landscape",
  "Redland Electric",
].map((business_name, i) => ({ business_name, city: `City${i}`, preview_url: `https://x${i}.wss-ai.com/` }));

test("batch: 10 distinct businesses each send exactly once in one run (no owner-hash self-block)", async () => {
  state.sentIds.clear(); state.sendCalls.length = 0;
  const res = await runBatch(TEN, "20260722");
  assert.equal(res.status, 200, "all ok");
  assert.equal(res.json.results.length, 10);
  assert.equal(res.json.results.filter((r) => r.ok && !r.skipped).length, 10, "all 10 actually sent");
  assert.equal(state.sendCalls.length, 10, "sendSequenceStep called once per business");
  // stable, distinct, business-derived ids
  const ids = res.json.results.map((r) => r.prospect_id);
  assert.equal(new Set(ids).size, 10, "10 distinct prospect_ids");
  assert.ok(ids.includes("proof_austin-air-conditioning-city0_20260722"), `stable id scheme: ${ids[0]}`);
});

test("batch: re-running the SAME run is a no-op (every business skipped, zero new sends)", async () => {
  const sendsBefore = state.sendCalls.length; // carries the 10 from the prior test's shared state
  const res = await runBatch(TEN, "20260722");
  assert.equal(res.status, 200);
  assert.equal(res.json.results.filter((r) => r.skipped).length, 10, "all 10 skipped on re-run");
  assert.equal(state.sendCalls.length, sendsBefore, "no additional sends fired on the re-run");
});

test("batch: a NEW runId sends again (distinct run, distinct ids)", async () => {
  const before = state.sendCalls.length;
  const res = await runBatch(TEN, "20260723");
  assert.equal(res.json.results.filter((r) => r.ok && !r.skipped).length, 10);
  assert.equal(state.sendCalls.length, before + 10);
});
