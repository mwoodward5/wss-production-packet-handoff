"use strict";
// scripts/brightdata-edit-proof/run-edit.js
//
// Executes ONE edit job through the REAL api/admin/run-edit-job.js handler.
// Nothing is hand-edited: the handler is required and invoked with a mock
// req/res, so the exercised path is exactly production's —
//   requireAdmin -> select(job) -> resolveSiteEditTarget -> runSiteEdit
//   (Supabase source pull -> LLM edit -> Supabase upload -> vercelDeploy)
//   -> upsert(status)
//
// SAFETY: RESEND_API_KEY is deliberately removed from the environment before
// the handler is required, so notifyOwner() short-circuits on its
// `if (!apiKey) return;` guard and NO EMAIL IS SENT. That is the only
// deviation from production, and it is a hard gate for this run.
//
//   node scripts/brightdata-edit-proof/run-edit.js

const fs = require("node:fs");
const path = require("node:path");
const { loadEnv } = require("./env");

loadEnv();

// --- ABSOLUTE GATE: no email may leave this process. ---------------------
delete process.env.RESEND_API_KEY;
if (process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY still set — refusing to run");
console.log("gate: RESEND_API_KEY cleared -> notifyOwner() will no-op (no email)\n");

const { insertRow, select } = require("../../lib/store");
const { download } = require("../../lib/site-editor");
const handler = require("../../api/admin/run-edit-job");

const SLUG = "wss-test-flint-plumbing-s5";
const OUT_DIR = path.join(__dirname, "..", "..", "artifacts", "brightdata-edit-proof");

// The instruction carries the numbers the REAL BrightData lookup attested
// (see brightdata-call.json: name+city+phone all matched Google's panel).
// The marker makes the DOM diff unambiguous — it cannot appear by accident.
const TRUST = require(path.join(OUT_DIR, "brightdata-call.json"));

function buildInstruction() {
  const t = TRUST.trust;
  if (!t || !t.ok) throw new Error("refusing to build an instruction from an unattested trust result");
  return [
    `Add a visible Google review badge to the top of the reviews section (the section with the heading "What customers say") in index.html.`,
    `The badge must read exactly: "${t.rating} out of 5 - ${t.review_count} Google reviews".`,
    `These figures are attested from Google's own knowledge panel (name, city and phone all matched this business) - do not alter, round, or invent them.`,
    `Immediately before the badge element, insert this exact HTML comment on its own line: <!-- BRIGHTDATA-TRUST-PROOF ${t.observed_at} -->`,
    `Style the badge to match the existing page design using the site's own CSS custom properties. Change nothing else.`,
  ].join(" ");
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload; this._done = true; },
  };
  return res;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Rollback safety: snapshot the archived source before it is mutated.
  const backupPath = path.join(OUT_DIR, "index.html.before.bak");
  if (!fs.existsSync(backupPath)) {
    const buf = await download(SLUG, "index.html");
    fs.writeFileSync(backupPath, buf);
    console.log(`backup: archived index.html saved (${buf.length} bytes) -> ${backupPath}\n`);
  }

  const instruction = buildInstruction();
  const jobId = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log("instruction:\n  " + instruction + "\n");

  await insertRow("ghost_agency_edit_jobs", {
    job_id: jobId,
    site_slug: SLUG,
    instruction,
    status: "queued",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  console.log(`enqueued ${jobId} (status=queued)\n`);

  const req = {
    method: "POST",
    headers: { "x-admin-token": process.env.GHOST_AGENCY_ADMIN_TOKEN || "" },
    body: { jobId },
  };
  const res = mockRes();

  console.log("--- invoking api/admin/run-edit-job.js handler ---");
  const started = Date.now();
  await handler(req, res);
  const elapsed = Date.now() - started;

  console.log(`handler returned HTTP ${res.statusCode} in ${elapsed} ms`);
  console.log("response body:");
  console.log(res.body);

  // Read the row back from the DB — the handler's own return value is not proof.
  const back = await select("ghost_agency_edit_jobs", `?job_id=eq.${encodeURIComponent(jobId)}&limit=1`);
  const row = (Array.isArray(back) ? back : back?.data || [])[0] || null;
  console.log("\n--- DB row after run ---");
  console.log(JSON.stringify(row, null, 2));

  fs.writeFileSync(path.join(OUT_DIR, "run-edit-result.json"), JSON.stringify({
    jobId, instruction, elapsed_ms: elapsed,
    handler_status: res.statusCode,
    handler_body: (() => { try { return JSON.parse(res.body); } catch { return res.body; } })(),
    db_row: row,
    ran_at: new Date().toISOString(),
  }, null, 2));
  console.log(`\nwrote ${path.join(OUT_DIR, "run-edit-result.json")}`);
}

main().catch((e) => { console.error("RUN FAILED:", e.stack || e.message); process.exit(1); });
