"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const path = require("node:path");
const { generateMorningReport: realGenerateMorningReport } = require("../lib/morning-report");

const {
  MARKER_TYPE,
  createMorningReportCronHandler,
  isUniqueConflict,
  markerId,
  markerSvixId,
} = require("../api/cron/morning-report");

const NOW = "2026-08-09T13:00:00.000Z";
const DAY = "2026-08-09";
const REPORT = Object.freeze({
  ok: true,
  date: DAY,
  generatedAt: NOW,
  window: {
    start: "2026-08-08T13:00:00.000Z",
    end: NOW,
    halfOpen: true,
    basis: "max_24h",
    hours: 24,
  },
  totals: { mined: 4, built: 2, sent: 1, repliesWaiting: 3 },
});

function responseCapture() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(body = "") { this.body = String(body); },
  };
}

function body(res) {
  return JSON.parse(res.body || "null");
}

function request(method = "GET") {
  return { method, headers: {} };
}

function baseDependencies(overrides = {}) {
  return {
    now: () => NOW,
    requireCron: () => true,
    select: async () => ({ ok: true, data: [] }),
    insertRow: async () => ({ mode: "live_write", row: [] }),
    conditionalUpdate: async () => ({ ok: true, mode: "live_update", updated: true }),
    generateMorningReport: async () => REPORT,
    sendMorningReport: async () => ({ mode: "sent", id: "email-owner-1" }),
    ...overrides,
  };
}

async function invoke(handler, method = "GET") {
  const res = responseCapture();
  await handler(request(method), res);
  return { res, payload: body(res) };
}

test("morning report cron accepts only cron methods and checks auth before work", async () => {
  let authChecks = 0;
  let generations = 0;
  const handler = createMorningReportCronHandler(baseDependencies({
    requireCron: (_req, res) => {
      authChecks += 1;
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return false;
    },
    generateMorningReport: async () => {
      generations += 1;
      return REPORT;
    },
  }));

  const put = await invoke(handler, "PUT");
  assert.equal(put.res.statusCode, 405);
  assert.equal(put.payload.error, "method_not_allowed");
  assert.deepEqual(put.payload.allowed, ["GET", "POST"]);
  assert.equal(authChecks, 0);

  const get = await invoke(handler, "GET");
  assert.equal(get.res.statusCode, 401);
  assert.equal(get.payload.error, "unauthorized");
  assert.equal(authChecks, 1);
  assert.equal(generations, 0);
});

test("existing current-day marker returns already-ran before report generation", async () => {
  let generations = 0;
  let sends = 0;
  const id = markerId(DAY);
  const handler = createMorningReportCronHandler(baseDependencies({
    select: async (table, query) => {
      assert.equal(table, "ghost_agency_events");
      assert.match(query, new RegExp(id));
      return { ok: true, data: [{ id, type: MARKER_TYPE, payload: { date: DAY, status: "sent" } }] };
    },
    generateMorningReport: async () => { generations += 1; return REPORT; },
    sendMorningReport: async () => { sends += 1; return { mode: "sent" }; },
  }));

  const result = await invoke(handler);
  assert.equal(result.res.statusCode, 200);
  assert.deepEqual(result.payload, {
    ok: true,
    job: "morning-report",
    day: DAY,
    alreadyRan: true,
    sent: false,
  });
  assert.equal(generations, 0);
  assert.equal(sends, 0);
});

test("deterministic primary-key claim permits exactly one send under concurrency", async () => {
  let claimed = false;
  let sendCalls = 0;
  const generatorInputs = [];
  const inserted = [];
  const updates = [];
  const dependencies = baseDependencies({
    generateMorningReport: async (input) => {
      generatorInputs.push(input);
      return REPORT;
    },
    insertRow: async (table, row) => {
      inserted.push({ table, row });
      if (claimed) {
        return {
          mode: "live_write_failed",
          status: 409,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      claimed = true;
      await Promise.resolve();
      return { mode: "live_write", row: [row] };
    },
    sendMorningReport: async () => {
      sendCalls += 1;
      await Promise.resolve();
      return { mode: "sent", id: "email-owner-only" };
    },
    conditionalUpdate: async (...args) => {
      updates.push(args);
      return { ok: true, mode: "live_update", updated: true };
    },
  });

  const [first, second] = await Promise.all([
    invoke(createMorningReportCronHandler(dependencies)),
    invoke(createMorningReportCronHandler(dependencies)),
  ]);

  assert.equal(sendCalls, 1);
  assert.deepEqual(generatorInputs, [
    { until: NOW, preferStored: false },
    { until: NOW, preferStored: false },
  ]);
  assert.equal([first, second].filter((item) => item.payload.sent === true).length, 1);
  assert.equal([first, second].filter((item) => item.payload.alreadyRan === true).length, 1);
  assert.equal(inserted.length, 2);
  assert.equal(inserted[0].table, "ghost_agency_events");
  assert.equal(inserted[0].row.id, inserted[1].row.id);
  assert.match(inserted[0].row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(inserted[0].row.type, "morning_report.run");
  assert.equal(inserted[0].row.svix_id, markerSvixId(DAY));
  assert.deepEqual(inserted[0].row.payload.window, REPORT.window);
  assert.deepEqual(inserted[0].row.payload.report, REPORT);
  assert.equal(inserted[0].row.payload.state, "claimed");
  assert.equal(inserted[0].row.payload.status, "claimed");
  assert.equal(updates.length, 1);
  assert.equal(updates[0][4].payload.state, "sent");
  assert.equal(updates[0][4].payload.status, "sent");
  assert.deepEqual(updates[0][4].payload.report, REPORT);
});

test("marker read and non-unique claim failures fail closed with zero sends", async () => {
  let generations = 0;
  let sends = 0;
  const unreadable = createMorningReportCronHandler(baseDependencies({
    select: async () => ({ ok: false, mode: "live_select_failed", status: 503, data: [] }),
    generateMorningReport: async () => { generations += 1; return REPORT; },
    sendMorningReport: async () => { sends += 1; return { mode: "sent" }; },
  }));
  const readResult = await invoke(unreadable);
  assert.equal(readResult.res.statusCode, 503);
  assert.equal(readResult.payload.error, "morning_report_marker_read_failed");
  assert.equal(generations, 0);
  assert.equal(sends, 0);

  const claimFailure = createMorningReportCronHandler(baseDependencies({
    insertRow: async () => ({
      mode: "live_write_failed",
      status: 503,
      error: { code: "XX000" },
    }),
    sendMorningReport: async () => { sends += 1; return { mode: "sent" }; },
  }));
  const claimResult = await invoke(claimFailure);
  assert.equal(claimResult.res.statusCode, 503);
  assert.equal(claimResult.payload.error, "morning_report_claim_failed");
  assert.equal(sends, 0);

  assert.equal(isUniqueConflict({ mode: "live_write_failed", status: 409, error: {} }), true);
  assert.equal(isUniqueConflict({ mode: "live_write_failed", status: 400, error: { code: "23505" } }), true);
  assert.equal(isUniqueConflict({ mode: "live_write_failed", status: 503, error: { code: "XX000" } }), false);
});

test("an incomplete measured report fails before claim so a source outage can retry", async () => {
  let claims = 0;
  let sends = 0;
  const handler = createMorningReportCronHandler(baseDependencies({
    generateMorningReport: async () => ({ ...REPORT, ok: false, warnings: ["events unavailable"] }),
    insertRow: async () => { claims += 1; return { mode: "live_write" }; },
    sendMorningReport: async () => { sends += 1; return { mode: "sent" }; },
  }));

  const result = await invoke(handler);
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.payload.error, "morning_report_incomplete");
  assert.equal(result.payload.sent, false);
  assert.equal(claims, 0);
  assert.equal(sends, 0);
});

test("cron pins the real generator window to its claim clock", async () => {
  let claimed = null;
  let delivered = null;
  const handler = createMorningReportCronHandler(baseDependencies({
    select: async () => ({ ok: true, data: [] }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false, reason: "" }),
    generateMorningReport: realGenerateMorningReport,
    insertRow: async (_table, row) => {
      claimed = row;
      return { mode: "live_write", row: [row] };
    },
    sendMorningReport: async (report) => {
      delivered = report;
      return { mode: "sent", id: "real-generator-window" };
    },
  }));

  const result = await invoke(handler);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.payload.sent, true);
  assert.equal(delivered.window.end, NOW);
  assert.equal(delivered.window.start, "2026-08-08T13:00:00.000Z");
  assert.equal(delivered.window.halfOpen, true);
  assert.deepEqual(delivered.totals, { mined: 0, built: 0, sent: 0, repliesWaiting: 0 });
  assert.equal(claimed.created_at, NOW);
  assert.equal(claimed.payload.window.end, NOW);
  assert.deepEqual(claimed.payload.report, delivered);
});

test("provider failure retains the daily marker and suppresses a same-day retry", async () => {
  let marker = null;
  let sendCalls = 0;
  let generationCalls = 0;
  const dependencies = baseDependencies({
    select: async () => ({ ok: true, data: marker ? [marker] : [] }),
    insertRow: async (_table, row) => {
      marker = row;
      return { mode: "live_write", row: [row] };
    },
    generateMorningReport: async () => { generationCalls += 1; return REPORT; },
    sendMorningReport: async () => {
      sendCalls += 1;
      const error = new Error("provider unavailable");
      error.code = "morning_report_send_failed";
      error.result = { mode: "send_failed", status: 503 };
      throw error;
    },
    conditionalUpdate: async () => {
      throw new Error("state update unavailable");
    },
  });
  const handler = createMorningReportCronHandler(dependencies);

  const first = await invoke(handler);
  assert.equal(first.res.statusCode, 502);
  assert.equal(first.payload.error, "morning_report_send_failed");
  assert.equal(first.payload.sent, false);
  assert.equal(marker.type, MARKER_TYPE);

  const second = await invoke(handler);
  assert.equal(second.res.statusCode, 200);
  assert.equal(second.payload.alreadyRan, true);
  assert.equal(second.payload.sent, false);
  assert.equal(generationCalls, 1);
  assert.equal(sendCalls, 1);
});

test("vercel config retains all existing routing and pins the exact morning and Line rescue crons", () => {
  const configPath = path.join(__dirname, "..", "vercel.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const expectedExisting = new Map([
    ["/api/cron/hero-lease-watchdog", "*/5 * * * *"],
    ["/api/cron/daily-mining", "0 */4 * * *"],
    ["/api/cron/nightly-pipeline", "30 */2 * * *"],
    ["/api/cron/drip-scheduler", "0 16,20 * * 1-5"],
    ["/api/cron/retention-monthly", "0 15 1 * *"],
    ["/api/cron/customer-call-artifact-retention", "15 3 * * *"],
    ["/api/cron/siteforge-reconcile", "*/5 * * * *"],
    ["/api/cron/run-edit-jobs", "*/2 * * * *"],
    // The live review sync is COST-CAPPED (reviews field mask only,
    // GOOGLE_REVIEW_REFRESH_CAP calls per run, 7-day per-client throttle) and
    // answers feature_off with zero spend while GOOGLE_PLACES_API_KEY is
    // absent. Pinned here so the daily beat can never silently drift.
    ["/api/cron/refresh-reviews", "45 5 * * *"],
  ]);

  // The three runner/report crons below are pinned by name and schedule, so the
  // total is the existing set plus exactly those three. A cron added without a
  // pin lands here rather than shipping unwatched.
  assert.equal(config.crons.length, expectedExisting.size + 3);
  for (const [cronPath, schedule] of expectedExisting) {
    assert.deepEqual(
      config.crons.filter((item) => item.path === cronPath),
      [{ path: cronPath, schedule }],
    );
  }
  assert.deepEqual(
    config.crons.filter((item) => item.path === "/api/cron/run-line-batches"),
    [{ path: "/api/cron/run-line-batches", schedule: "*/5 * * * *" }],
  );
  // The rebuild-mirror drain is the fleet un-staling lane. It runs on the same
  // five-minute beat as the other queue drains: a mirror rebuild that is queued
  // and never drained looks identical to one that was never asked for.
  assert.deepEqual(
    config.crons.filter((item) => item.path === "/api/cron/run-rebuild-mirror-jobs"),
    [{ path: "/api/cron/run-rebuild-mirror-jobs", schedule: "*/5 * * * *" }],
  );
  assert.deepEqual(
    config.crons.filter((item) => item.path === "/api/cron/morning-report"),
    [{ path: "/api/cron/morning-report", schedule: "0 13 * * *" }],
  );
  // Keep the exact public operator routes. Per-page suites pin their handlers;
  // this integration check makes a newly added route explicit instead of
  // relying on a stale numeric count.
  const expectedRewrites = new Map([
    ["/console", "/api/admin/console"],
    ["/gallery", "/api/admin/gallery"],
    ["/replies", "/api/admin/replies"],
    ["/ledger", "/api/admin/ledger"],
    ["/line", "/api/admin/line-console"],
    ["/campaigns", "/api/admin/campaigns"],
  ]);
  assert.equal(config.rewrites.length, expectedRewrites.size);
  for (const [source, destination] of expectedRewrites) {
    assert.equal(config.rewrites.find((item) => item.source === source)?.destination, destination);
  }
  assert.equal(config.headers.length, 1);
  assert.equal(config.functions["api/**/*.js"].maxDuration, 300);
  // The Line batch lane runs the heavy build work, so its two entries carry the
  // raised 800s ceiling (the 2026-08-31 build-running law — the same pin the
  // siteforge-timeout suite guards for the build surfaces). The cron drain and
  // the queue consumer must not drift apart: the same job body runs under both.
  assert.equal(config.functions["api/cron/run-line-batches.js"].maxDuration, 800);
  assert.equal(config.functions["api/queues/line-batch.js"].maxDuration, 800);
});
