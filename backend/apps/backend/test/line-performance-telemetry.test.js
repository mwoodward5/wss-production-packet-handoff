"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const lineApi = require("../api/admin/line");
const consolePage = require("../lib/console-page");

test("row telemetry derives durable phase wall times from state history", () => {
  const row = {
    status: "queued",
    history: [
      { status: "picked", at: "2026-08-16T00:00:00.000Z" },
      { status: "qualified", at: "2026-08-16T00:00:05.000Z" },
      { status: "mirrored", at: "2026-08-16T00:01:05.000Z" },
      { status: "gate_passed", at: "2026-08-16T00:01:35.000Z" },
      { status: "queued", at: "2026-08-16T00:01:40.000Z" },
    ],
  };
  const telemetry = lineApi.rowTelemetry(row, Date.parse("2026-08-16T00:02:00.000Z"));
  assert.equal(telemetry.completed.qualification.ms, 5_000);
  assert.equal(telemetry.completed.mirror_build.ms, 60_000);
  assert.equal(telemetry.completed.render_gate.ms, 30_000);
  assert.equal(telemetry.completed.email_queue.ms, 5_000);
  assert.equal(telemetry.currentPhase, "ready");
});

test("batch performance names the measured bottleneck and computes pace", () => {
  const batch = {
    requested: 2,
    startedAt: "2026-08-16T00:00:00.000Z",
    rows: [
      {
        status: "queued",
        history: [
          { status: "picked", at: "2026-08-16T00:00:00.000Z" },
          { status: "qualified", at: "2026-08-16T00:00:05.000Z" },
          { status: "mirrored", at: "2026-08-16T00:01:05.000Z" },
          { status: "gate_passed", at: "2026-08-16T00:01:35.000Z" },
          { status: "queued", at: "2026-08-16T00:01:40.000Z" },
        ],
      },
      {
        status: "qualified",
        history: [
          { status: "picked", at: "2026-08-16T00:00:00.000Z" },
          { status: "qualified", at: "2026-08-16T00:00:04.000Z" },
        ],
      },
    ],
  };
  const performance = lineApi.batchPerformance(batch, Date.parse("2026-08-16T00:02:00.000Z"));
  assert.equal(performance.processed, 1);
  assert.equal(performance.remaining, 1);
  assert.equal(performance.bottleneck.phase, "mirror_build");
  assert.equal(performance.throughputPerMinute, 0.5);
  assert.equal(performance.etaMinutes, 2);
});

test("command center explains the finished quota and human phases in plain words", () => {
  // Campaign-flow pass 2026-08-16: the control tower keeps its quota math,
  // but the phase labels dropped the machine shout (CHECKING CONTACT and
  // friends) for the owner's words, and the factory-capacity row (website
  // builders, quality checkers) moved to the Engine room.
  assert.match(consolePage, /Campaign control tower/);
  assert.match(consolePage, /Checking the business/);
  assert.match(consolePage, /Building the website/);
  assert.match(consolePage, /Checking the website/);
  assert.match(consolePage, /Preparing the email/);
  assert.match(consolePage, /finished slots still needed/);
  assert.doesNotMatch(consolePage, /CHECKING CONTACT/);
  assert.doesNotMatch(consolePage, /BUILDING SITE/);
  assert.doesNotMatch(consolePage, /website builders/);
  assert.doesNotMatch(consolePage, /quality checkers/);
});
