#!/usr/bin/env node
// scripts/golden-proof/owner-local-golden-proof.mjs
//
// Owner-local, evidence-only golden-proof runner.
// Runs one full LeadMiner -> Ghost -> CallPrep -> SiteForge -> email-preview
// -> Stripe test proof against the REAL deployed services using the owner's
// local credentials, and emits one complete evidence bundle to disk.
//
// Hard constraints:
//   * Reads credentials from environment variables by NAME only. Never
//     accepts them as CLI arguments or writes them to the bundle.
//   * Never sends email. Renders the compliant MIME/HTML via the existing
//     sendSequenceStep({ dryRun: true }) path.
//   * Stripe is limited to test mode. If STRIPE_SECRET_KEY does not start
//     with "sk_test_" the runner refuses to open a checkout session.
//   * Never runs `vercel --prod`, never performs a `git push --force`, never
//     places a call, never charges a card, never contacts a prospect.
//   * On any missing capability or evidence gap, records the gap honestly
//     in the bundle rather than fabricating a value.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(HERE, "..", "..");
const START_TS = Date.now();

// --- Environment contract ------------------------------------------------
// Read a strict, documented list of environment variable NAMES. Any missing
// value is recorded, not requested from stdin, and not printed as anything
// other than "present" / "absent".

const ENV_CONTRACT = Object.freeze({
  required: [
    "GHOST_AGENCY_ADMIN_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GHOST_AGENCY_SITEFORGE_BUILD_URL",
    "GHOST_AGENCY_SITEFORGE_BUILD_TOKEN",
    "GHOST_AGENCY_INTAKE_GENIE_URL",
    "GHOST_AGENCY_INTAKE_GENIE_TOKEN",
    "STRIPE_SECRET_KEY",
    "STRIPE_LOCAL_GROWTH_PRICE_ID",
    "GHOST_AGENCY_OWNER_ONE_PROSPECT_ID",
  ],
  optional: [
    "CALLPREP_REPORT_BASE_URL",
    "CALLPREP_TENANT_TOKEN",
    "GOOGLE_MAPS_API_KEY",
    "RESEND_API_KEY",
    "GHOST_AGENCY_OUTREACH_FROM",
    "GHOST_AGENCY_SUPPORT_FROM",
    "OWNER_EMAIL",
    "STRIPE_LOCAL_GROWTH_SUCCESS_URL",
    "STRIPE_LOCAL_GROWTH_CANCEL_URL",
    "GHOST_AGENCY_SITEFORGE_CALLBACK_URL",
    "GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN",
    "ANTHROPIC_API_KEY",
  ],
});

const REDACTED_MARK = "[present:redacted]";

function inspectEnv() {
  const report = { required: {}, optional: {} };
  for (const name of ENV_CONTRACT.required) {
    report.required[name] = process.env[name] ? REDACTED_MARK : "[missing]";
  }
  for (const name of ENV_CONTRACT.optional) {
    report.optional[name] = process.env[name] ? REDACTED_MARK : "[absent]";
  }
  const missing = ENV_CONTRACT.required.filter((name) => !process.env[name]);
  return { report, missing };
}

function assertStripeTestMode() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) return { ok: false, reason: "missing_STRIPE_SECRET_KEY" };
  if (!key.startsWith("sk_test_")) {
    return {
      ok: false,
      reason: "STRIPE_SECRET_KEY must start with 'sk_test_' — this runner refuses live-mode keys",
    };
  }
  return { ok: true };
}

// --- CLI ------------------------------------------------------------------
function parseArgs(argv) {
  const out = { outputDir: "./golden-proof-artifacts", offline: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--out" || a === "--output-dir") out.outputDir = argv[++i];
    else if (a === "--offline") out.offline = true;
    else if (a.startsWith("--out=")) out.outputDir = a.slice("--out=".length);
  }
  return out;
}

function printHelp() {
  console.log(`Owner-local golden proof runner\n\n\
Usage:\n  node scripts/golden-proof/owner-local-golden-proof.mjs --out ./golden-proof-artifacts\n\n\
Environment variable names are documented in REQUIRED_CREDENTIALS.md.\n\
This runner never accepts credentials as arguments and never writes them\n\
to the artifacts.\n`);
}

// --- Helpers --------------------------------------------------------------
function nowIso() { return new Date().toISOString(); }

function writeJson(dir, name, obj) {
  const p = path.join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function sha256File(filePath) {
  const buf = readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function timed(label, fn, telemetry) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    telemetry.stages.push({ stage: label, ms, ok: true });
    return result;
  } catch (error) {
    const ms = Date.now() - t0;
    telemetry.stages.push({ stage: label, ms, ok: false, error: error?.message || String(error) });
    throw error;
  }
}

// --- Live-call helpers ----------------------------------------------------
// These are thin, isolated fetch wrappers. Each records the wall-clock,
// the response status, and the request identifier only; response bodies
// are stored in the bundle for audit but never mutated.

async function callDeployed(url, { token, method = "POST", body, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let json = null;
    let text = "";
    try {
      text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { ok: res.ok, status: res.status, json, text_length: text.length };
  } finally {
    clearTimeout(timer);
  }
}

// --- Runner ---------------------------------------------------------------
async function run() {
  const args = parseArgs(process.argv);
  if (args.help) return printHelp();

  const outDir = path.resolve(process.cwd(), args.outputDir);
  mkdirSync(outDir, { recursive: true });

  const telemetry = {
    started_at: nowIso(),
    runner: "owner-local-golden-proof-v1",
    node_version: process.version,
    stages: [],
    warnings: [],
  };

  const envReport = inspectEnv();
  telemetry.env = envReport.report;
  telemetry.env_missing = envReport.missing;

  // Refuse to proceed if a required capability is absent AND --offline was not
  // requested. --offline still produces a bundle with real code paths but
  // marks the live-service stages as skipped and preserves the truth-packet
  // pull from Supabase as [absent].
  if (envReport.missing.length && !args.offline) {
    telemetry.blocked = {
      reason: "missing_required_credentials",
      names: envReport.missing,
      message:
        "The runner reads credentials by NAME only. See REQUIRED_CREDENTIALS.md and export the missing values in your local shell before running.",
    };
    telemetry.finished_at = nowIso();
    writeJson(outDir, "run-telemetry.json", telemetry);
    console.log(`Blocked: missing required environment variables (${envReport.missing.length}).`);
    console.log(`See ${path.join(outDir, "run-telemetry.json")}`);
    process.exit(2);
  }

  const stripeGate = assertStripeTestMode();
  if (!stripeGate.ok && !args.offline) {
    telemetry.blocked = { reason: "stripe_not_test_mode", detail: stripeGate.reason };
    telemetry.finished_at = nowIso();
    writeJson(outDir, "run-telemetry.json", telemetry);
    console.log(`Blocked: ${stripeGate.reason}`);
    process.exit(3);
  }

  const prospectId = process.env.GHOST_AGENCY_OWNER_ONE_PROSPECT_ID || "";
  const ownerEmail = process.env.OWNER_EMAIL || "";
  telemetry.prospect_id = prospectId || null;
  telemetry.owner_email_present = Boolean(ownerEmail);

  // Load the real backend modules only when live. In --offline we still
  // import them to exercise their public shape but skip the network calls.
  let modules = null;
  try {
    modules = {
      store: require(path.join(BACKEND_ROOT, "lib", "store.js")),
      prospects: require(path.join(BACKEND_ROOT, "lib", "prospects.js")),
      fullRun: require(path.join(BACKEND_ROOT, "lib", "full-run.js")),
      email: require(path.join(BACKEND_ROOT, "lib", "email.js")),
      stripe: require(path.join(BACKEND_ROOT, "lib", "stripe.js")),
      siteforge: require(path.join(BACKEND_ROOT, "lib", "siteforge.js")),
    };
  } catch (error) {
    telemetry.blocked = { reason: "backend_modules_unavailable", detail: error.message };
    telemetry.finished_at = nowIso();
    writeJson(outDir, "run-telemetry.json", telemetry);
    console.log(`Blocked: could not import backend modules (${error.message})`);
    process.exit(4);
  }

  // ---------- Stage 1: fetch prospect from real Supabase ----------------
  let prospect = null;
  if (!args.offline) {
    prospect = await timed("fetch_prospect_from_supabase", async () => {
      const result = await modules.store.select(
        "ghost_agency_prospects",
        `?prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      );
      if (!result.ok) {
        throw new Error(`Supabase select failed: ${result.mode || result.status || "unknown"}`);
      }
      const row = (result.data || [])[0];
      if (!row) throw new Error(`prospect ${prospectId} not found`);
      return modules.prospects.prospectFromRow(row);
    }, telemetry);
  } else {
    prospect = { prospect_id: prospectId || "prosp_offline_test", business_name: "OFFLINE_TEST" };
    telemetry.warnings.push("offline_mode: prospect fetched from stub");
  }
  writeJson(outDir, "01-prospect-raw.json", prospect);

  // ---------- Stage 2: build the SiteForge preview end-to-end -----------
  let buildResult = null;
  if (!args.offline) {
    buildResult = await timed("siteforge_build_preview", async () => {
      const out = await modules.fullRun.buildPreviewForProspect(prospect, {
        source: "owner_local_golden_proof",
      });
      return out;
    }, telemetry);
  } else {
    buildResult = {
      ok: false,
      offline: true,
      message: "offline mode: SiteForge live build skipped; existing preview_url from prospect used if present",
      preview_url: prospect.preview_url || null,
      report_url: prospect.report_url || null,
    };
  }
  writeJson(outDir, "02-siteforge-build-result.json", buildResult);

  const previewUrl = buildResult.preview_url || prospect.preview_url || null;
  const reportUrl = buildResult.report_url || prospect.report_url || null;

  // ---------- Stage 3: Stripe test-mode checkout session ----------------
  let checkout = null;
  if (!args.offline) {
    checkout = await timed("stripe_test_checkout_session", async () => {
      const session = await modules.stripe.createCheckoutSession({
        prospect,
        job: { id: `job_owner_local_${Date.now()}` },
      }, { ownerSandboxAuthorized: true });
      return session;
    }, telemetry);
  } else {
    checkout = { mode: "dry_run", offline: true };
  }
  writeJson(outDir, "03-stripe-checkout-session.json", checkout);

  // ---------- Stage 4: owner-only compliant email MIME preview ----------
  let emailPreview = null;
  const enrichedProspect = {
    ...prospect,
    preview_url: previewUrl,
    report_url: reportUrl,
    checkout_url: checkout?.url || checkout?.plannedSession?.url || checkout?.plannedSession?.priceId
      ? (checkout?.url || null)
      : null,
    // Owner-only recipient override — the runner never uses the prospect's real email
    email: ownerEmail || null,
    ownerEmail: ownerEmail || null,
  };
  if (!ownerEmail) telemetry.warnings.push("OWNER_EMAIL not set; email preview will report missing_recipient_email");
  emailPreview = await timed("email_dryrun_render", async () => {
    return modules.email.sendSequenceStep({
      prospect: enrichedProspect,
      sequence: 1,
      step: 1,
      dryRun: true,                            // never calls Resend, never writes email_log
      allowReviewHoldBypass: true,             // owner-local runner
      allowBuildQualityBypass: args.offline,   // offline mode may not have a real preview
      allowContactQualityBypass: true,         // owner-only recipient
    });
  }, telemetry);
  writeJson(outDir, "04-email-preview.json", emailPreview);
  if (emailPreview?.htmlPreview) {
    writeFileSync(path.join(outDir, "04-email-preview.html"), emailPreview.htmlPreview);
  }

  // ---------- Stage 5: capture QC evidence + assemble truth packet ------
  const qcEvidence = {
    renderer: buildResult?.record?.siteforge_renderer || buildResult?.renderer || null,
    required_renderer: modules.siteforge.REQUIRED_RENDERER,
    accepted_renderers: [...modules.siteforge.ACCEPTED_RENDERERS],
    qc_contract: buildResult?.record?.siteforge_qc_contract || buildResult?.qc_contract || null,
    required_qc_contract: modules.siteforge.REQUIRED_QC_CONTRACT,
    accepted_qc_contracts: [...modules.siteforge.ACCEPTED_QC_CONTRACTS],
    qc_passed: Boolean(buildResult?.record?.siteforge_qc_passed || buildResult?.qc_passed),
    visual_qc_passed: Boolean(buildResult?.record?.siteforge_visual_qc_passed || buildResult?.visual_qc_passed),
    generation_fingerprint: buildResult?.record?.siteforge_generation_fingerprint || buildResult?.generation_fingerprint || null,
  };
  writeJson(outDir, "05-qc-evidence.json", qcEvidence);

  // Truth packet: pull from the Supabase-persisted record if the pipeline
  // already wrote it there, else read from the intake-genie response.
  const truthPacket = prospect?.truth_packet || prospect?.record?.truth_packet || {
    schema_version: "siteforge-truth-packet-v1",
    prospect_id: prospectId,
    business_name: prospect?.business_name || null,
    evidence_gaps: ["truth_packet_not_persisted_yet"],
  };
  writeJson(outDir, "06-truth-packet.json", truthPacket);

  // ---------- Stage 6: screenshot instructions ---------------------------
  writeFileSync(
    path.join(outDir, "07-screenshot-instructions.md"),
    renderScreenshotInstructions({ previewUrl, reportUrl, outDir }),
  );

  // ---------- Stage 7: Playwright auto-shot if available ----------------
  if (!args.offline && previewUrl) {
    try {
      // Optional: only run if Playwright is installed locally.
      const playwright = tryRequire("playwright");
      if (playwright?.chromium) {
        await timed("playwright_screenshots", async () => {
          const browser = await playwright.chromium.launch({ headless: true });
          try {
            for (const [name, viewport] of [
              ["08-desktop-1440x900.png", { width: 1440, height: 900 }],
              ["09-mobile-390x844.png",   { width: 390,  height: 844 }],
            ]) {
              const ctx = await browser.newContext({ viewport });
              const page = await ctx.newPage();
              await page.goto(previewUrl, { waitUntil: "networkidle", timeout: 45_000 });
              await page.screenshot({ path: path.join(outDir, name), fullPage: true });
              await ctx.close();
            }
          } finally {
            await browser.close();
          }
        }, telemetry);
      } else {
        telemetry.warnings.push("playwright_not_installed_screenshots_manual");
      }
    } catch (e) {
      telemetry.warnings.push(`playwright_screenshot_error:${e.message}`);
    }
  }

  // ---------- Stage 8: assemble the bundle manifest ---------------------
  telemetry.finished_at = nowIso();
  telemetry.total_ms = Date.now() - START_TS;

  const artifacts = [
    "01-prospect-raw.json",
    "02-siteforge-build-result.json",
    "03-stripe-checkout-session.json",
    "04-email-preview.json",
    "04-email-preview.html",
    "05-qc-evidence.json",
    "06-truth-packet.json",
    "07-screenshot-instructions.md",
    "08-desktop-1440x900.png",
    "09-mobile-390x844.png",
    "run-telemetry.json",
  ]
    .filter((f) => existsSync(path.join(outDir, f)))
    .map((f) => ({ file: f, sha256: sha256File(path.join(outDir, f)) }));

  const bundle = {
    schema: "wss.golden-proof-bundle.v1",
    generated_at: telemetry.finished_at,
    runner: telemetry.runner,
    prospect_id: prospectId || null,
    preview_url: previewUrl,
    report_url: reportUrl,
    checkout_url: checkout?.url || checkout?.plannedSession?.priceId ? (checkout?.url || null) : null,
    email_preview: existsSync(path.join(outDir, "04-email-preview.html")),
    qc: qcEvidence,
    artifacts,
    telemetry,
  };
  writeJson(outDir, "bundle.json", bundle);
  writeJson(outDir, "run-telemetry.json", telemetry);

  console.log(`\nOwner-local golden proof complete.`);
  console.log(`Bundle:  ${path.join(outDir, "bundle.json")}`);
  console.log(`Preview: ${previewUrl || "[not produced]"}`);
  console.log(`Report:  ${reportUrl || "[not produced]"}`);
  console.log(`Checkout: ${bundle.checkout_url || "[not produced]"}`);
}

function tryRequire(name) {
  try { return require(name); } catch { return null; }
}

function renderScreenshotInstructions({ previewUrl, reportUrl, outDir }) {
  return `# Screenshot Instructions

Preview URL:  ${previewUrl || "[not produced]"}
Report URL:   ${reportUrl || "[not produced]"}

If Playwright is installed locally the runner captured desktop + mobile
screenshots automatically. Otherwise, from your local machine:

    npx playwright install --with-deps chromium
    node scripts/golden-proof/owner-local-golden-proof.mjs --out ${outDir}

Manual fallback (any headless-browser tool works):

    # Desktop
    npx playwright screenshot --viewport-size=1440,900 --full-page \\
        "${previewUrl}" ${path.join(outDir, "08-desktop-1440x900.png")}

    # Mobile
    npx playwright screenshot --viewport-size=390,844 --full-page \\
        "${previewUrl}" ${path.join(outDir, "09-mobile-390x844.png")}

Do not use Chrome's "capture screenshot" DevTools command — it does not
render lazy-loaded media reliably. Playwright with networkidle is the
required capture path.
`;
}

run().catch((error) => {
  console.error(`\n[owner-local-golden-proof] fatal: ${error?.message || error}`);
  process.exitCode = 1;
});
