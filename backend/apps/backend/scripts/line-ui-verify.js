"use strict";

/**
 * scripts/line-ui-verify.js — drive the operator line console headlessly and
 * PROVE, from the rendered DOM, that each step did what the UI claims.
 *
 * "QC PASS is never proof, always render the DOM." A screenshot of a button is
 * not evidence that pressing it runs anything, so every assertion below reads
 * text out of the live page after the click, and the DOM is dumped to
 * artifacts/line-ui-proof/ at each step so a human can check the claim.
 *
 * The server is real: the same api/admin/line handler and the same
 * lib/line-console-page that production serves. Only the four leaf adapters
 * (pick / mirror / gate reader / send) are stubbed, because this run must not
 * mine, must not spend, and must never reach a prospect address.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const PAGE = require("../lib/line-console-page");
const runner = require("../lib/line-runner");
const { evaluateRenderGate } = require("../lib/render-gate");
const { createLineHandler } = require("../api/admin/line");

const TOKEN = "line-ui-verify-token";
const outDir = path.resolve(__dirname, "..", "artifacts", "line-ui-proof");

// --- the fixture: three prospects, one of which will fail the render gate ---
const PROSPECTS = [
  { prospectId: "flint_plumbing", businessName: "Flint Plumbing", city: "Buda", state: "TX", vertical: "plumbing", email: "owner1@example.test" },
  { prospectId: "sterling_fence", businessName: "Sterling Fence Co", city: "Kyle", state: "TX", vertical: "fencing", email: "owner2@example.test" },
  { prospectId: "obrien_roofing", businessName: "O'Brien and Sons Roofing", city: "Austin", state: "TX", vertical: "roofing", email: "owner3@example.test" },
];

const SOURCE = {
  flint_plumbing: { business_name: "Flint Plumbing", vertical: "plumbing", phone: "512-555-0147", postal_city: "Buda", logo_sha256: "a".repeat(64), donor_strings: ["Premier Plumbing Co", "(214) 555-9900"] },
  // Sterling's mirror will render roofing copy — a trade swap that must block.
  sterling_fence: { business_name: "Sterling Fence Co", vertical: "fencing", phone: "512-555-0188", postal_city: "Kyle", logo_sha256: "b".repeat(64), donor_strings: ["Falcon Roof Craft", "(469) 555-1200"] },
  obrien_roofing: { business_name: "O'Brien and Sons Roofing", vertical: "roofing", phone: "512-555-0199", postal_city: "Austin", logo_sha256: "c".repeat(64), donor_strings: ["Falcon Roof Craft", "(469) 555-1200"] },
};

// Rendered DOMs the fake browser returns. These stand in for real pages.
const RENDERED = {
  flint_plumbing: {
    ok: true, status: 200, url: "https://wss-test-flint-plumbing.wss-ai.com/",
    title: "Flint Plumbing — Buda, TX",
    innerText: "Flint Plumbing\nServing Austin and the surrounding area\nCall (512) 555-0147\n123 Main St, Buda, TX 78610\nDrain cleaning, water heater replacement and sewer repair.",
    hrefs: ["/services"], imgs: [],
    logos: [{ src: "https://cdn/flint.png", sha256: "a".repeat(64), width: 140, height: 44 }],
    jsonld: [{ "@type": "Plumber", name: "Flint Plumbing" }],
  },
  sterling_fence: {
    ok: true, status: 200, url: "https://wss-test-sterling-fence.wss-ai.com/",
    title: "Sterling Fence Co — Kyle, TX",
    // TRADE SWAP: shingle roofing copy on a fencing client's mirror.
    innerText: "Sterling Fence Co\nKyle, TX 78640\nCall (512) 555-0188\nCedar fence and gate installation.\nWe also install shingle roofing systems and gutters.",
    hrefs: ["/services"], imgs: [],
    logos: [{ src: "https://cdn/sterling.png", sha256: "b".repeat(64), width: 140, height: 44 }],
    jsonld: [{ "@type": "FenceContractor", name: "Sterling Fence Co" }],
  },
  obrien_roofing: {
    ok: true, status: 200, url: "https://wss-test-obrien-and-sons-roofing.wss-ai.com/",
    title: "O'Brien and Sons Roofing — Austin, TX",
    innerText: "O'Brien and Sons Roofing\nAustin, TX 78704\nCall (512) 555-0199\nShingle roof replacement, roof repair and gutter work.",
    hrefs: ["/services"], imgs: [],
    logos: [{ src: "https://cdn/obrien.png", sha256: "c".repeat(64), width: 140, height: 44 }],
    jsonld: [{ "@type": "RoofingContractor", name: "O'Brien and Sons Roofing" }],
  },
};

const sends = [];

// Readiness is INJECTED here for one reason only: with no Supabase configured,
// the production reader cannot learn the delivery-pause state and therefore
// reports PAUSED (fail-closed), which correctly refuses every send. Step 4b
// below proves that refusal against the real reader before this clear state is
// used to exercise the rest of the flow.
let readinessMode = "clear";
const clearReadiness = async () => ({
  ready: true,
  blockers: [],
  deliveryPause: { active: false, known: true, reason: "" },
  reviewHold: { active: false },
  liveSendsEnabled: false,
  ownerAddressConfigured: true,
});

const handler = createLineHandler({
  readiness: async () => (readinessMode === "clear" ? clearReadiness() : require("../api/admin/line").readinessState()),
  pick: async ({ count }) => PROSPECTS.slice(0, count),
  qualify: async () => ({ ok: true }),
  mirror: async (row) => ({ ok: true, previewUrl: RENDERED[row.prospectId].url }),
  sourceFacts: async (row) => SOURCE[row.prospectId],
  // The REAL gate evaluator, over a stubbed rendered DOM. The judgement under
  // test is production code; only the browser is substituted.
  gate: async ({ url, source, seenLogoShas }) => {
    const dom = Object.values(RENDERED).find((d) => d.url === url) || null;
    return evaluateRenderGate({ dom, source, seenLogoShas });
  },
  writePreviewUrl: async () => ({ ok: true }),
  queueEmail: async () => ({ ok: true }),
  send: async (row) => { sends.push(row.prospectId); return { ok: true }; },
});

function serve(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/line") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (url.pathname === "/api/admin/line") {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { req.body = raw; handler(req, res); });
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

const steps = [];
async function record(page, name, note) {
  const dom = await page.evaluate(() => ({
    chips: [...document.querySelectorAll("#readyChips .chip, #stateChips .chip")].map((n) => n.textContent.trim()),
    batchLine: (document.getElementById("batchLine") || {}).textContent || "",
    stages: [...document.querySelectorAll("#stages .stage")].map((n) => n.textContent.trim().replace(/\s+/g, " ")),
    rows: [...document.querySelectorAll(".rows tbody tr")].map((tr) => ({
      status: tr.getAttribute("data-status"),
      text: tr.innerText.replace(/\s+/g, " ").slice(0, 260),
      verdict: (tr.querySelector(".verdict") || {}).textContent || "",
      facts: [...tr.querySelectorAll(".fact")].map((f) => f.innerText.replace(/\s+/g, " ")),
    })),
    approveHint: (document.getElementById("approveHint") || {}).textContent || "",
    approveDisabled: (document.getElementById("approveBtn") || {}).disabled,
    sendDisabled: (document.getElementById("sendBtn") || {}).disabled,
    sendOut: (document.getElementById("sendOut") || {}).textContent || "",
    launchOut: (document.getElementById("launchOut") || {}).textContent || "",
    spend: [...document.querySelectorAll("#spend .stage")].map((n) => n.textContent.trim().replace(/\s+/g, " ")),
  }));
  steps.push({ step: name, note, dom });
  await fsp.writeFile(path.join(outDir, `${name}.json`), JSON.stringify(dom, null, 2));
  await fsp.writeFile(path.join(outDir, `${name}.html`), await page.content());
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
  console.log(`\n=== ${name} — ${note} ===`);
  console.log(JSON.stringify(dom, null, 2).slice(0, 2600));
  return dom;
}

async function main() {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = TOKEN;
  process.env.GHOST_AGENCY_OWNER_EMAIL = process.env.GHOST_AGENCY_OWNER_EMAIL || "woodwardsoftware@gmail.com";
  delete process.env.GHOST_AGENCY_LINE_LIVE_SENDS; // live lane stays off
  runner.resetBatches();
  fs.mkdirSync(outDir, { recursive: true });

  const server = http.createServer(serve);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1500 } });
  // An UNCAUGHT exception is fatal: it is the failure that leaves a console
  // rendered but dead. A 4xx logged by the browser is NOT one — three of this
  // run's steps deliberately provoke a refusal (403 unapproved send, 409
  // readiness block, 400 mismatched approval echo) and those must appear.
  const pageErrors = [];
  const refusalNoise = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/Failed to load resource.*(400|403|409)/.test(text)) refusalNoise.push(text);
    else pageErrors.push(`console: ${text}`);
  });
  await page.addInitScript((t) => localStorage.setItem("wsl_admin_token", t), TOKEN);

  // ---- STEP 1: the console loads and reports real readiness -----------------
  await page.goto(`${base}/line`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#readyChips .chip").length > 0, null, { timeout: 10000 });
  const s1 = await record(page, "01-loaded", "console open, readiness read from /api/admin/line");
  assert.ok(s1.chips.some((c) => /delivery/.test(c)), "readiness chips did not render");
  assert.ok(s1.chips.some((c) => /live lane disabled/.test(c)), "live-lane state is not shown");
  assert.equal(s1.sendDisabled, true, "send was armed before any batch existed");

  // ---- STEP 2: press Mine 50 — the whole line runs --------------------------
  await page.click("#mine50");
  await page.waitForFunction(() => document.querySelectorAll(".rows tbody tr").length === 3, null, { timeout: 20000 });
  const s2 = await record(page, "02-after-mine-50", "Mine 50 pressed: rows ran pick→qualify→mirror→gate→queue");
  assert.equal(s2.rows.length, 3, "the launch button did not produce rows");
  const queued = s2.rows.filter((r) => r.status === "queued");
  const blocked = s2.rows.filter((r) => r.status === "gate_failed");
  assert.equal(queued.length, 2, `expected 2 queued, got ${queued.length}`);
  assert.equal(blocked.length, 1, `expected 1 gate_failed, got ${blocked.length}`);
  assert.match(s2.batchLine, /2 queued \/ 1 blocked \/ 3 rows/);
  // The progress strip must agree with the row count beneath it: all three
  // rows were picked, qualified and mirrored; only two cleared the gate.
  const stage = (name) => (s2.stages.find((t) => t.replace(/\s+/g, " ").trim().endsWith(name)) || "").trim();
  assert.match(stage("picked"), /^3/, `picked count disagrees with 3 rows: ${s2.stages.join(" | ")}`);
  assert.match(stage("mirrored"), /^3/, `mirrored count is wrong: ${s2.stages.join(" | ")}`);
  assert.match(stage("gate passed"), /^2/, `gate-passed count is wrong: ${s2.stages.join(" | ")}`);
  assert.match(stage("blocked"), /^1/, `blocked count is wrong: ${s2.stages.join(" | ")}`);

  // ---- STEP 3: the blocked row names the FACT that failed -------------------
  await page.click('.rows tbody tr[data-status="gate_failed"] [data-facts]');
  const s3 = await record(page, "03-gate-failure-facts", "per-fact PASS/FAIL opened on the blocked row");
  const failedRow = s3.rows.find((r) => r.status === "gate_failed");
  assert.ok(/Sterling Fence/.test(failedRow.text), "the wrong row was blocked");
  assert.ok(/vertical_match/.test(failedRow.text), "the failing fact is not named in the row");
  assert.ok(/trade swap/.test(failedRow.text), "the reason does not explain the trade swap");
  const factLines = failedRow.facts.join(" | ");
  assert.match(factLines, /nap_match PASS/, "passing facts are not itemised");
  assert.match(factLines, /vertical_match FAIL/, "the failing fact is not itemised");
  assert.equal(failedRow.facts.length, 8, `expected all eight facts listed, got ${failedRow.facts.length}`);

  // ---- STEP 4: send is refused before approval ------------------------------
  const s4 = await record(page, "04-before-approval", "batch settled, awaiting operator approval");
  assert.equal(s4.sendDisabled, true, "the send button was armed without an approval");
  assert.match(s4.approveHint, /Type the batch id to approve/);
  const preSendResponse = await page.evaluate(async () => {
    const batchId = document.getElementById("approveBatchId").textContent.trim();
    const r = await fetch("/api/admin/line", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": localStorage.getItem("wsl_admin_token") },
      body: JSON.stringify({ action: "send", batchId }),
    });
    return { status: r.status, body: await r.json() };
  });
  assert.ok([403, 409].includes(preSendResponse.status), `an unapproved send returned ${preSendResponse.status}`);
  assert.equal(sends.length, 0, "an unapproved send reached the sender");
  console.log("\nunapproved send refused:", JSON.stringify(preSendResponse.body).slice(0, 240));

  // ---- STEP 4b: the REAL readiness reader refuses when it cannot see --------
  // With no Supabase configured the delivery-pause state is unknowable. The
  // production reader reports PAUSED and the send is refused. This is the
  // fail-closed behaviour, proven against the real reader, not the stub.
  readinessMode = "real";
  const blindSend = await page.evaluate(async () => {
    const batchId = document.getElementById("approveBatchId").textContent.trim();
    const r = await fetch("/api/admin/line", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": localStorage.getItem("wsl_admin_token") },
      body: JSON.stringify({ action: "send", batchId }),
    });
    return { status: r.status, body: await r.json() };
  });
  assert.equal(blindSend.status, 409, `an unknowable pause state returned ${blindSend.status}`);
  assert.equal(blindSend.body.error, "blocked_by_readiness");
  assert.ok(
    blindSend.body.blockers.some((b) => b.code === "delivery_paused"),
    "an unknown delivery-pause state did not count as paused",
  );
  assert.equal(sends.length, 0, "a readiness-blocked send reached the sender");
  console.log("real readiness reader refuses when blind:", JSON.stringify(blindSend.body.blockers));
  readinessMode = "clear";

  // ---- STEP 5: a WRONG typed batch id is refused ----------------------------
  await page.fill("#typedBatchId", "line_not_this_batch");
  await page.click("#approveBtn");
  await page.waitForFunction(() => (document.getElementById("sendOut").textContent || "").length > 0, null, { timeout: 8000 });
  const s5 = await record(page, "05-wrong-approval-echo", "approval with the wrong batch id");
  assert.match(s5.sendOut, /approval_confirmation_mismatch/, "a mismatched approval echo was accepted");
  assert.equal(s5.sendDisabled, true, "send armed after a refused approval");

  // ---- STEP 6: correct approval arms the send ------------------------------
  const batchId = await page.locator("#approveBatchId").textContent();
  await page.fill("#typedBatchId", batchId.trim());
  await page.click("#approveBtn");
  await page.waitForFunction(() => document.getElementById("sendBtn").disabled === false, null, { timeout: 8000 });
  const s6 = await record(page, "06-approved", "operator typed the batch id; send is armed");
  assert.equal(s6.sendDisabled, false, "approval did not arm the send");
  assert.match(s6.approveHint, /Approved by operator/);
  assert.match(s6.approveHint, /2 row\(s\) cleared to send/);
  assert.equal(sends.length, 0, "approval alone sent something");

  // ---- STEP 7: send delivers ONLY the gate-passing rows ---------------------
  page.once("dialog", (d) => d.accept());
  await page.click("#sendBtn");
  await page.waitForFunction(() => /Sent \d+ of \d+/.test(document.getElementById("sendOut").textContent || ""), null, { timeout: 15000 });
  const s7 = await record(page, "07-sent", "approved batch sent");
  assert.match(s7.sendOut, /Sent 2 of 2/, `send output was: ${s7.sendOut}`);
  assert.deepEqual(sends.sort(), ["flint_plumbing", "obrien_roofing"], "the blocked row was sent, or a row was missed");
  assert.ok(!sends.includes("sterling_fence"), "a gate-failed row reached the sender");
  assert.ok(s7.spend.some((t) => /^2\s*sent$/.test(t.trim())), `spend counters did not update: ${s7.spend.join(" / ")}`);
  assert.ok(s7.spend.some((t) => /^1\s*gate failed$/.test(t.trim())), `gate-failure counter is wrong: ${s7.spend.join(" / ")}`);

  assert.deepEqual(pageErrors, [], `the console threw in the browser: ${pageErrors.join(" | ")}`);
  assert.equal(refusalNoise.length, 3, `expected exactly three provoked refusals, saw ${refusalNoise.length}: ${refusalNoise.join(" | ")}`);

  await fsp.writeFile(path.join(outDir, "proof.json"), JSON.stringify({ generatedAt: new Date().toISOString(), sends, steps }, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));

  console.log("\nline-ui-verify: PASSED");
  console.log(`  rows queued        2 (flint_plumbing, obrien_roofing)`);
  console.log(`  rows blocked       1 (sterling_fence — vertical_match: trade swap)`);
  console.log(`  unapproved send    refused (${preSendResponse.status})`);
  console.log(`  wrong-id approval  refused`);
  console.log(`  sent after approve ${sends.join(", ")}`);
  console.log(`  DOM proof written  ${outDir}`);
}

main().catch((e) => {
  console.error("line-ui-verify FAILED:", e && e.stack ? e.stack : e);
  process.exitCode = 1;
  // A failed assertion must not leave chromium and the http server holding the
  // event loop open: a hung "verification" that never reports is worse than a
  // red one, because it looks like it is still working.
  process.exit(1);
});
