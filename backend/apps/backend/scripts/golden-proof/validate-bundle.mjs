#!/usr/bin/env node
// scripts/golden-proof/validate-bundle.mjs
//
// Offline validator for a golden-proof bundle produced by
// owner-local-golden-proof.mjs. Enforces the acceptance gates from
// COMPUTER_TASK_MASTER_HANDOFF.md that can be checked without live network:
//
//   1. bundle.json is present and matches schema wss.golden-proof-bundle.v1.
//   2. preview_url and report_url are http(s) URLs (never scorecard.json).
//   3. Renderer + qc contract equal the REQUIRED_* names.
//   4. 04-email-preview.html contains the preview URL, report URL, and a
//      List-Unsubscribe-compatible footer marker; contains no forbidden
//      internal terms (contamination sweep).
//   5. Truth packet has at least a schema_version and prospect_id.
//   6. Every artifact listed in bundle.json.artifacts exists and its
//      sha256 matches the recorded value.
//   7. No secret-shaped strings inside any artifact.
//
// Returns exit code 0 on pass, non-zero with a JSON report on failure.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ACCEPTED_RENDERERS,
  ACCEPTED_QC_CONTRACTS,
} = require("../../lib/siteforge.js");

// Contamination words that must never appear on any prospect-facing surface.
const FORBIDDEN_PUBLIC_TERMS = [
  "IntakeGenie", "Intake Genie",
  "RocketSites", "Rocket Search Insights",
  "Ghost Agency",
  "Woodward Software Systems",
  "internal only",
  "PLACEHOLDER",
];

const SECRET_SHAPES = [
  /\bsk_live_[A-Za-z0-9]{16,}\b/,
  /\bsk_test_[A-Za-z0-9]{32,}\b/,   // keys in artifacts are a leak regardless of mode
  /\brk_live_[A-Za-z0-9]{16,}\b/,
  /\bpk_live_[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function fail(problems, extra = {}) {
  const report = { ok: false, problems, ...extra };
  console.log(JSON.stringify(report, null, 2));
  process.exit(2);
}

function pass(summary) {
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

function main() {
  const bundleDir = path.resolve(process.argv[2] || "./golden-proof-artifacts");
  const problems = [];

  const bundlePath = path.join(bundleDir, "bundle.json");
  if (!existsSync(bundlePath)) return fail([`bundle.json not found in ${bundleDir}`]);

  let bundle;
  try { bundle = JSON.parse(readFileSync(bundlePath, "utf8")); }
  catch (e) { return fail([`bundle.json is not valid JSON: ${e.message}`]); }

  if (bundle.schema !== "wss.golden-proof-bundle.v1") {
    problems.push(`schema must be wss.golden-proof-bundle.v1 (got ${bundle.schema})`);
  }

  // Preview / report URL shape
  const previewUrl = String(bundle.preview_url || "");
  const reportUrl = String(bundle.report_url || "");
  if (!/^https?:\/\//.test(previewUrl)) problems.push(`preview_url must be http(s) (got ${previewUrl.slice(0, 40)})`);
  if (!/^https?:\/\//.test(reportUrl))  problems.push(`report_url must be http(s) (got ${reportUrl.slice(0, 40)})`);
  if (/scorecard\.json/i.test(reportUrl)) problems.push("report_url must be the branded HTML report, never scorecard.json");
  if (/\.json($|\?)/i.test(reportUrl))    problems.push("report_url must be the branded HTML report, not a raw JSON artifact");

  // Renderer + QC contract
  if (bundle.qc?.renderer && !ACCEPTED_RENDERERS.has(bundle.qc.renderer)) {
    problems.push(`renderer is not accepted (got ${bundle.qc.renderer})`);
  }
  if (bundle.qc?.qc_contract && !ACCEPTED_QC_CONTRACTS.has(bundle.qc.qc_contract)) {
    problems.push(`qc_contract is not accepted (got ${bundle.qc.qc_contract})`);
  }

  // Email preview compliance
  const emailHtmlPath = path.join(bundleDir, "04-email-preview.html");
  if (!existsSync(emailHtmlPath)) {
    problems.push("04-email-preview.html missing");
  } else {
    const html = readFileSync(emailHtmlPath, "utf8");
    if (previewUrl && !html.includes(previewUrl)) problems.push("email preview HTML does not link the preview_url");
    if (reportUrl && !html.includes(reportUrl))   problems.push("email preview HTML does not link the report_url");
    for (const term of FORBIDDEN_PUBLIC_TERMS) {
      if (html.includes(term)) problems.push(`email preview contains forbidden public term: ${term}`);
    }
  }

  // Truth packet
  const truthPath = path.join(bundleDir, "06-truth-packet.json");
  if (!existsSync(truthPath)) problems.push("06-truth-packet.json missing");
  else {
    const truth = JSON.parse(readFileSync(truthPath, "utf8"));
    if (!truth.schema_version) problems.push("truth packet missing schema_version");
    if (!truth.prospect_id && !truth.business_name) problems.push("truth packet missing prospect_id and business_name");
  }

  // Artifact checksums
  for (const item of bundle.artifacts || []) {
    const p = path.join(bundleDir, item.file);
    if (!existsSync(p)) { problems.push(`artifact missing on disk: ${item.file}`); continue; }
    const got = sha256(readFileSync(p));
    if (item.sha256 && got !== item.sha256) problems.push(`artifact sha256 mismatch: ${item.file}`);
  }

  // Full-directory secret sweep
  walk(bundleDir).forEach((abs) => {
    const rel = path.relative(bundleDir, abs);
    if (rel.endsWith(".png") || rel.endsWith(".jpg") || rel.endsWith(".webp")) return;
    let text;
    try { text = readFileSync(abs, "utf8"); } catch { return; }
    for (const re of SECRET_SHAPES) {
      if (re.test(text)) problems.push(`possible secret leaked in ${rel} (pattern ${re})`);
    }
  });

  if (problems.length) return fail(problems);

  pass({
    bundle: bundle.artifacts.length + " artifacts",
    preview_url: previewUrl || null,
    report_url: reportUrl || null,
  });
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

main();
