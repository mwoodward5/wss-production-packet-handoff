// test/golden-proof/validate-bundle.test.mjs
// Pure offline tests for the golden-proof-bundle validator. No network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.resolve(TEST_DIR, "..", "..", "scripts", "golden-proof", "validate-bundle.mjs");

function scaffoldBundle({ previewUrl, reportUrl, renderer, qcContract, htmlExtra = "", forbidden = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "gpb-"));
  const html = `<!doctype html><html><body>
    <a href="${previewUrl}">Preview</a>
    <a href="${reportUrl}">Branded Report</a>
    <p>List-Unsubscribe: &lt;mailto:unsub@go.wss-ai.com&gt;</p>
    ${forbidden ? "<p>Powered by IntakeGenie internal only</p>" : ""}
    ${htmlExtra}
  </body></html>`;
  writeFileSync(path.join(dir, "04-email-preview.html"), html);
  writeFileSync(path.join(dir, "06-truth-packet.json"), JSON.stringify({
    schema_version: "siteforge-truth-packet-v1",
    prospect_id: "prosp_test",
    business_name: "Test Business",
  }));
  const emailBuf = Buffer.from(html);
  const truthBuf = Buffer.from(JSON.stringify({ schema_version: "siteforge-truth-packet-v1", prospect_id: "prosp_test", business_name: "Test Business" }, null, 2));
  const bundle = {
    schema: "wss.golden-proof-bundle.v1",
    generated_at: new Date().toISOString(),
    runner: "owner-local-golden-proof-v1",
    prospect_id: "prosp_test",
    preview_url: previewUrl,
    report_url: reportUrl,
    qc: {
      renderer,
      required_renderer: "05-build-v8",
      qc_contract: qcContract,
      required_qc_contract: "public-surface-v2",
      generation_fingerprint: "d".repeat(64),
      qc_passed: true,
      visual_qc_passed: true,
    },
    artifacts: [
      { file: "04-email-preview.html", sha256: crypto.createHash("sha256").update(emailBuf).digest("hex") },
    ],
  };
  writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle, null, 2));
  return dir;
}

function run(dir) {
  const r = spawnSync("node", [VALIDATOR, dir], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("validator passes a well-formed bundle", () => {
  const dir = scaffoldBundle({
    previewUrl: "https://siteforge-app-seven.vercel.app/preview/abc",
    reportUrl: "https://callprep.wss-ai.com/r/abc",
    renderer: "05-build-v8",
    qcContract: "siteforge-qc-v2-authority-108-plus-contamination",
  });
  const r = run(dir);
  assert.equal(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.ok, true);
});

test("validator passes the v8 snowflake renderer and authority-108 contract", () => {
  const dir = scaffoldBundle({
    previewUrl: "https://siteforge-app-seven.vercel.app/preview/abc",
    reportUrl: "https://callprep.wss-ai.com/r/abc",
    renderer: "siteforge-renderer-v8-snowflake@8.2.0",
    qcContract: "siteforge-qc-v2-authority-108-plus-contamination",
  });
  const r = run(dir);
  assert.equal(r.code, 0, r.out + r.err);
});

test("validator rejects scorecard.json as report_url", () => {
  const dir = scaffoldBundle({
    previewUrl: "https://siteforge-app-seven.vercel.app/preview/abc",
    reportUrl: "https://callprep.wss-ai.com/scorecard.json?id=abc",
    renderer: "05-build-v8",
    qcContract: "siteforge-qc-v2-authority-108-plus-contamination",
  });
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /scorecard\.json/);
});

test("validator rejects a non-http preview_url", () => {
  const dir = scaffoldBundle({
    previewUrl: "file:///tmp/nope",
    reportUrl: "https://callprep.wss-ai.com/r/abc",
    renderer: "05-build-v8",
    qcContract: "siteforge-qc-v2-authority-108-plus-contamination",
  });
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /preview_url must be http/);
});

test("validator rejects wrong renderer name", () => {
  const dir = scaffoldBundle({
    previewUrl: "https://siteforge-app-seven.vercel.app/preview/abc",
    reportUrl: "https://callprep.wss-ai.com/r/abc",
    renderer: "05-build-v6-old",
    qcContract: "siteforge-qc-v2-authority-108-plus-contamination",
  });
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /renderer is not accepted/);
});

test("validator rejects forbidden internal terms in the email HTML", () => {
  const dir = scaffoldBundle({
    previewUrl: "https://siteforge-app-seven.vercel.app/preview/abc",
    reportUrl: "https://callprep.wss-ai.com/r/abc",
    renderer: "05-build-v8",
    qcContract: "siteforge-qc-v2-authority-108-plus-contamination",
    forbidden: true,
  });
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /forbidden public term/);
});

test("validator rejects sk_live secret leaks in artifacts", () => {
  const dir = scaffoldBundle({
    previewUrl: "https://siteforge-app-seven.vercel.app/preview/abc",
    reportUrl: "https://callprep.wss-ai.com/r/abc",
    renderer: "05-build-v8",
    qcContract: "siteforge-qc-v2-authority-108-plus-contamination",
    htmlExtra: "<!-- accidental leak: sk_live_ABCDEFGHIJKLMNOPQRSTUVWX -->",
  });
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /possible secret leaked/);
});
