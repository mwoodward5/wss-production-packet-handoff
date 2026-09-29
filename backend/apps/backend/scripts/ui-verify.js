"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const Module = require("node:module");
const { renderOperatorDashboard } = require("../lib/dashboard-html");
const consolePage = require("../lib/console-page");

// Prefer the project's own Playwright install in CI and normal developer
// environments. The Codex desktop runtime historically bundled Playwright in a
// Windows-only cache path, so keep that location only as a compatibility
// fallback instead of hard-wiring every verifier to one machine.
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (primaryError) {
  const bundleNodeModules =
    process.env.CODEX_BUNDLED_NODE_MODULES ||
    "C:\\Users\\Main\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
  const bundlePlaywrightCore = path.join(bundleNodeModules, ".pnpm", "playwright-core@1.61.1", "node_modules");
  process.env.NODE_PATH = [bundleNodeModules, bundlePlaywrightCore, process.env.NODE_PATH || ""].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  try {
    ({ chromium } = require(path.join(bundleNodeModules, "playwright")));
  } catch {
    throw primaryError;
  }
}

const tmpDir = path.resolve(__dirname, "..", "..", "..", ".tmp", "ui-verify");

const snapshot = {
  ok: true,
  ready: true,
  generatedAt: new Date().toISOString(),
  hardStops: [],
  providers: {
    resend: { configured: true, webhookConfigured: true, unsubscribeConfigured: true, postalAddressConfigured: true, mode: "live" },
    stripe: { configured: true, webhookConfigured: true, mode: "test" },
    supabase: { configured: true, mode: "live" },
    vapi: { configured: true, webhookConfigured: true, cleanLaneConfigured: true, mode: "live" },
    lovable: { configured: true, mode: "live" },
  },
  totals: { prospects: 42, sendable: 12, emailsSent: 120, calls: 4, emailsDryRun: 6 },
  funnel: [
    { status: "new", count: 16 },
    { status: "previewed", count: 12 },
    { status: "queued", count: 8 },
    { status: "sent", count: 6 },
  ],
  byDay: [
    { date: "2026-07-08", count: 4 },
    { date: "2026-07-09", count: 8 },
    { date: "2026-07-10", count: 12 },
    { date: "2026-07-11", count: 6 },
  ],
  recentEmails: [
    { sent_at: "2026-07-11T18:20:00Z", business_name: "Summit Roofing", subject: "Quick note on your visibility", sequence: 1, step: 1, mode: "live" },
    { sent_at: "2026-07-11T18:10:00Z", business_name: "Orange Coast HVAC", subject: "Preview ready", sequence: 1, step: 1, mode: "dry_run" },
  ],
  recentProspects: [
    { prospect_id: "lead_1", business_name: "Summit Roofing", city: "San Diego", state: "CA", status: "previewed", score: 91, preview_url: "https://lead-1.wss-ai.com/" },
    { prospect_id: "lead_2", business_name: "Orange Coast HVAC", city: "Irvine", state: "CA", status: "queued", score: 86, preview_url: "https://lead-2.wss-ai.com/" },
  ],
  feed: [
    { created_at: "2026-07-11T18:21:00Z", type: "outreach.sent", summary: "Sent to Summit Roofing" },
    { created_at: "2026-07-11T18:18:00Z", type: "build.previewed", summary: "Preview built for Orange Coast HVAC" },
  ],
  drip: { scheduleHuman: "9am and 1pm PT", batchCap: 10, fromDomain: "go.wss-ai.com", nextRun: new Date(Date.now() + 3600_000).toISOString() },
  agents: [
    { id: "agent_00_orchestrator", name: "Orchestrator", role: "routes work across the pipeline", status: "idle", lifecycle: "progress", activeJob: "ui-proof-42", lastRun: new Date(Date.now() - 30_000).toISOString(), lastType: "agent.progress" },
    { id: "agent_05_site_builder", name: "Site Builder", role: "generates the preview site", status: "healthy", lifecycle: "completed", lastRun: new Date(Date.now() - 12 * 60_000).toISOString(), lastType: "agent.completed" },
    { id: "agent_06_qc_gatekeeper", name: "QC Gatekeeper", role: "grades quality before send", status: "blocked", lifecycle: "dependency-wait", nextDependency: "visual review", lastRun: new Date(Date.now() - 2 * 60_000).toISOString(), lastType: "agent.wait" },
    { id: "agent_13_email_sequencer", name: "Email Sequencer", role: "runs the drip cadence", status: "never-invoked", lifecycle: null, lastRun: null, lastType: null },
  ],
  campaignRuns: [
    { at: "2026-07-11T18:19:00Z", dryRun: true, batch: 10, tested: 10, sent: 0, blockedBy: {} },
    { at: "2026-07-11T18:23:00Z", dryRun: false, batch: 5, tested: 5, sent: 5, blockedBy: {} },
  ],
  mineRuns: [
    { at: "2026-07-11T18:12:00Z", status: "ok", query: "roofing in San Diego", found: 16, upserted: 12, withEmail: 10 },
  ],
  systemRuns: [
    { at: "2026-07-11T18:24:00Z", runId: "run_abc123", stage: "sent", status: "ok", found: 16, built: 12, queued: 8, sent: 6, reason: "roofing in San Diego" },
  ],
  performance: {
    emailReachRate: 71,
    withEmail: 30,
    bySource: [
      { source: "places", count: 24 },
      { source: "gbp", count: 12 },
      { source: "manual", count: 6 },
    ],
  },
};

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function main() {
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await fsp.mkdir(tmpDir, { recursive: true });

  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/api/admin/console-data")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(snapshot));
      return;
    }
    if (req.url.startsWith("/api/admin/line")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, batches: [], capacity: {} }));
      return;
    }
    if (req.url.startsWith("/api/admin/outreach-pause")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, deliveryPause: { active: false, known: true, reason: "", at: new Date().toISOString() } }));
      return;
    }
    if (req.url.startsWith("/api/admin/mine")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, started: true }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(consolePage);
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  const systemChrome = process.env.CHROMIUM_BIN || (fs.existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "");
  const browser = await chromium.launch({
    ...(systemChrome ? { executablePath: systemChrome } : {}),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    // Campaign-flow pass 2026-08-16: the launcher is a wizard behind the
    // operator gate, so the verifier carries a token like a real operator
    // and walks 1 → 2 before measuring the Build-N buttons.
    await page.addInitScript(() => {
      try { localStorage.setItem("wsl_admin_token", "ui-verify-token"); } catch (_) {}
    });
    await page.goto(`${base}/console`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(500);
    const desktop = await page.evaluate(() => ({
      title: document.title,
      body: document.body.innerText,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      nav: [...document.querySelectorAll(".wssnav-link")].map((n) => n.textContent.trim()),
      hasLaunch: Boolean(document.querySelector(".launch")),
      hasWizard: Boolean(document.querySelector("#campaignWizard")),
      wizardStepsVisible: [...document.querySelectorAll(".wz-step")].filter((s) => s.offsetParent !== null).length,
    }));
    assert.equal(desktop.scrollWidth <= desktop.clientWidth + 2, true, `desktop overflow ${desktop.scrollWidth}/${desktop.clientWidth}`);
    assert.equal(desktop.hasLaunch, true);
    assert.equal(desktop.hasWizard, true, "the front door is the campaign wizard");
    assert.equal(desktop.wizardStepsVisible, 1, "exactly one wizard step is visible at a time");
    assert.ok(desktop.body.includes("Command Center"));
    assert.ok(desktop.nav.includes("Sites we built"));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(500);
    // Walk the wizard the way the owner does: pick a trade (step 1), then
    // move to step 2 where the four Build-N buttons live.
    await page.selectOption("#mineVertical", "leadminer");
    await page.click("#wzNext1");
    await page.waitForTimeout(200);
    const mobile = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      buttons: [...document.querySelectorAll(".launchBtn")]
        .filter((b) => b.offsetParent !== null)
        .map((b) => {
          const r = b.getBoundingClientRect();
          return { text: b.textContent.trim(), width: r.width, height: r.height };
        }),
    }));
    assert.equal(mobile.scrollWidth <= mobile.clientWidth + 2, true, `mobile overflow ${mobile.scrollWidth}/${mobile.clientWidth}`);
    assert.ok(mobile.buttons.length >= 4);
    assert.ok(mobile.buttons.every((b) => b.height >= 40));

    await page.screenshot({ path: path.join(tmpDir, "console-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.screenshot({ path: path.join(tmpDir, "console-desktop.png"), fullPage: true });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const html = renderOperatorDashboard(snapshot);
  assert.match(html, /Mission Control|Command Center|Operator/i);
  console.log(JSON.stringify({ ok: true, output: tmpDir }));
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
