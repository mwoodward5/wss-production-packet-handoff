"use strict";

/**
 * test/line-telemetry.test.js — the Observability volume valve (#596).
 *
 * The Line pipeline's diagnostic oracles (#473) fire one JSON event per hot
 * path step (~11.5 events/invocation, 12.95M events last cycle). The gate is
 * a single env knob, GHOST_AGENCY_LINE_TELEMETRY:
 *
 *   full (default) — byte-identical behavior: every oracle fires.
 *   reduced        — terminal/error transitions only.
 *
 * The gate helpers are pure functions of (env, event) so this file never
 * imports the ajv-heavy pipeline modules (Windows cannot load them); the
 * production call sites simply pass process.env / their injected environment.
 */

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  lineTelemetryLevel,
  shouldLogRowPhase,
  shouldLogWorkerPass,
  shouldLogHumanState,
  shouldLogMirrorResume,
  shouldLogMirrorUploadBatch,
} = require("../lib/line-telemetry");

const HAPPY_ROW_PHASE = {
  event: "line_row_phase",
  before_status: "qualified",
  after_status: "mirrored",
  ok: true,
  retryable: false,
  error: "",
};

test("telemetry level defaults to full unless the env says reduced, exactly", () => {
  assert.equal(lineTelemetryLevel({}), "full");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: undefined }), "full");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "" }), "full");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "full" }), "full");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "FULL" }), "full");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "verbose" }), "full");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "1" }), "full");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "reduced" }), "reduced");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "REDUCED" }), "reduced");
  assert.equal(lineTelemetryLevel({ GHOST_AGENCY_LINE_TELEMETRY: "  reduced  " }), "reduced");
});

test("full telemetry keeps every oracle line, happy path included", () => {
  const env = {};
  assert.equal(shouldLogRowPhase(env, HAPPY_ROW_PHASE), true);
  assert.equal(shouldLogRowPhase(env, { after_status: "error", ok: false, error: "mirror_failed" }), true);
  assert.equal(shouldLogWorkerPass(env, { failed: 0 }), true);
  assert.equal(shouldLogWorkerPass(env, { failed: 2 }), true);
  assert.equal(shouldLogHumanState(env, { terminal_reasons: [] }), true);
  assert.equal(shouldLogHumanState(env, { terminal_reasons: [{ reason: "gate_failed", count: 1 }] }), true);
  assert.equal(shouldLogMirrorResume(env, { clean: true }), true);
  assert.equal(shouldLogMirrorResume(env, { clean: false }), true);
  assert.equal(shouldLogMirrorUploadBatch(env, { files: 102, uploaded: 100, deduped: 2 }), true);
  assert.equal(shouldLogMirrorUploadBatch(env, { files: 102, uploaded: 90, deduped: 2 }), true);
});

test("reduced telemetry keeps line_row_phase only for terminal or error transitions", () => {
  const env = { GHOST_AGENCY_LINE_TELEMETRY: "reduced" };

  // Happy-path hops are the dropped volume.
  for (const hop of ["picked", "qualified", "mirrored", "gate_passed"]) {
    assert.equal(shouldLogRowPhase(env, { before_status: "picked", after_status: hop, ok: true }), false,
      `happy-path hop to ${hop} must not emit under reduced`);
  }

  // Terminal outcomes stay observable: the row settled or terminally failed.
  for (const settled of ["ready", "queued", "sent", "rejected", "gate_failed", "error"]) {
    assert.equal(shouldLogRowPhase(env, { before_status: "mirrored", after_status: settled, ok: true }), true,
      `terminal transition to ${settled} must still emit under reduced`);
  }

  // Error-shaped signals stay observable even mid-flight.
  assert.equal(shouldLogRowPhase(env, { after_status: "mirrored", ok: false }), true, "failed phase");
  assert.equal(shouldLogRowPhase(env, { after_status: "mirrored", ok: true, error: "provider_429" }), true, "error code");
  assert.equal(shouldLogRowPhase(env, { after_status: "mirrored", ok: true, retryable: true }), true,
    "a row parking on a build retry is a failure signal, not a happy hop");
});

test("reduced telemetry drops happy-path line_worker_pass summaries only", () => {
  const env = { GHOST_AGENCY_LINE_TELEMETRY: "reduced" };
  assert.equal(shouldLogWorkerPass(env, { failed: 0, processed: 5 }), false,
    "a clean pass is the happy path the durable batch state already tells");
  assert.equal(shouldLogWorkerPass(env, { failed: 1, processed: 5 }), true,
    "a pass that failed a row stays observable");
});

test("reduced telemetry keeps line_human_state only when the census carries terminal reasons", () => {
  const env = { GHOST_AGENCY_LINE_TELEMETRY: "reduced" };
  assert.equal(shouldLogHumanState(env, { status: "awaiting_approval", terminal_reasons: [] }), false);
  assert.equal(shouldLogHumanState(env, {
    status: "awaiting_approval",
    terminal_reasons: [{ reason: "gate_failed", count: 2 }],
  }), true);
});

test("reduced telemetry keeps mirror_resume only for unclean probes", () => {
  const env = { GHOST_AGENCY_LINE_TELEMETRY: "reduced" };
  assert.equal(shouldLogMirrorResume(env, { clean: true, mismatches: [], deep_failures: [] }), false,
    "a clean resume is the happy path");
  assert.equal(shouldLogMirrorResume(env, {
    clean: false,
    mismatches: [{ file: "index.html", reason: "byte_diff_mismatch" }],
  }), true, "a refused resume keeps its why-line");
  assert.equal(shouldLogMirrorResume(env, null), false);
});

test("reduced telemetry keeps mirror_upload_batch only when files went unaccounted", () => {
  const env = { GHOST_AGENCY_LINE_TELEMETRY: "reduced" };
  assert.equal(shouldLogMirrorUploadBatch(env, { files: 102, uploaded: 100, deduped: 2 }), false,
    "uploaded + deduped covering every file is the happy path");
  assert.equal(shouldLogMirrorUploadBatch(env, { files: 102, uploaded: 98, deduped: 2 }), true,
    "a shortfall stays observable");
});

test("the production wiring drives the gate from process.env", async (t) => {
  const previous = process.env.GHOST_AGENCY_LINE_TELEMETRY;
  process.env.GHOST_AGENCY_LINE_TELEMETRY = "reduced";
  t.after(() => {
    if (previous === undefined) delete process.env.GHOST_AGENCY_LINE_TELEMETRY;
    else process.env.GHOST_AGENCY_LINE_TELEMETRY = previous;
  });

  assert.equal(lineTelemetryLevel(process.env), "reduced");
  assert.equal(shouldLogRowPhase(process.env, HAPPY_ROW_PHASE), false);
  delete process.env.GHOST_AGENCY_LINE_TELEMETRY;
  assert.equal(shouldLogRowPhase(process.env, HAPPY_ROW_PHASE), true,
    "an unset knob must fall back to full — byte-identical default");
});

test("backend deploys with the reduced observability line and its timeout pins intact", () => {
  const vercelConfig = JSON.parse(readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.equal(vercelConfig.env.GHOST_AGENCY_LINE_TELEMETRY, "reduced",
    "the Observability line must ship reduced (#596)");
  // The siteforge-timeout pins (#570 maxDuration law) must survive this change.
  for (const route of [
    "api/admin/build-preview.js",
    "api/admin/owner-smoke.js",
    "api/admin/full-run.js",
    "api/admin/line.js",
    "api/cron/nightly-pipeline.js",
  ]) {
    assert.equal(vercelConfig.functions[route]?.maxDuration, 800, `${route} keeps its 800s pin`);
  }
  assert.equal(vercelConfig.functions["api/**/*.js"].maxDuration, 300);
});
