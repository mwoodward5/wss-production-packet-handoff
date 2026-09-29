"use strict";

// scripts/time-campaign.cjs tests — the campaign stopwatch harness. Every test
// runs against a stubbed fetch: no network, no token, no campaign. The pins:
//   - phantom-accept detection (ok:true with no durable batchId) errors LOUDLY
//   - a poll 404 after an accepted start is a phantom batch, also loud
//   - timing extraction prefers the server timing record, falls back to rows
//   - the final table is stable and defensible

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const stopwatch = require("../scripts/time-campaign.cjs");
const {
  PhantomAcceptError,
  assertStartAccepted,
  assertBatchReadable,
  formatDuration,
  formatTable,
  funnelStages,
  parseArgs,
  resolveToken,
  runCampaign,
  timingFromBatch,
} = stopwatch;

function jsonResponse(status, body) {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

test("phantom-accept detection: ok:true without a batchId errors loudly", () => {
  // The exact shape of tonight's phantom-start bug: the endpoint answers
  // ok:true / accepted:true but never names a durable batch.
  const phantomShapes = [
    { ok: true, accepted: true },
    { ok: true, accepted: true, batchId: "" },
    { ok: true, accepted: true, batch: null },
    { ok: true, accepted: true, batch: { status: "building" } },
    { ok: true },
  ];
  for (const body of phantomShapes) {
    assert.throws(
      () => assertStartAccepted({ status: 202, json: body }),
      (error) => error instanceof PhantomAcceptError && /PHANTOM ACCEPT/.test(error.message),
      `must reject ${JSON.stringify(body)}`,
    );
  }
  // An honest refusal (ok:false) is still a phantom for this harness — the
  // campaign was NOT durably accepted, so there is nothing to time.
  assert.throws(
    () => assertStartAccepted({ status: 400, json: { ok: false, error: "count_required" } }),
    PhantomAcceptError,
  );
});

test("an honest start with a durable batch id passes", () => {
  const batchId = assertStartAccepted({
    status: 202,
    json: { ok: true, accepted: true, batch: { batchId: "line_honest_1", status: "building" } },
  });
  assert.equal(batchId, "line_honest_1");
  const topLevelId = assertStartAccepted({
    status: 202,
    json: { ok: true, batchId: "line_honest_2", batch: null },
  });
  assert.equal(topLevelId, "line_honest_2");
});

test("a poll 404 after an accepted start is a loud phantom batch", () => {
  assert.throws(
    () => assertBatchReadable({ status: 404, json: { ok: false, error: "unknown_batch" } }, "line_gone"),
    (error) => error instanceof PhantomAcceptError && /PHANTOM BATCH/.test(error.message),
  );
  const batch = assertBatchReadable({ status: 200, json: { ok: true, batch: { batchId: "line_ok" } } }, "line_ok");
  assert.equal(batch.batchId, "line_ok");
});

test("timingFromBatch prefers the server timing record over row approximations", () => {
  const timing = timingFromBatch({
    startedAt: "2026-09-02T12:00:00.000Z",
    campaignTiming: {
      startedAt: "2026-09-02T12:00:00.000Z",
      firstQualifiedAt: "2026-09-02T12:02:00.000Z",
      firstBuiltAt: "2026-09-02T12:09:00.000Z",
      firstGateAt: "2026-09-02T12:17:00.000Z",
      firstSentAt: "",
    },
    rows: [{ status: "sent", reached: ["picked", "qualified"], updatedAt: "2026-09-02T13:00:00.000Z" }],
  });
  assert.equal(timing.firstQualifiedAt, "2026-09-02T12:02:00.000Z");
  assert.equal(timing.firstBuiltAt, "2026-09-02T12:09:00.000Z");
  assert.equal(timing.firstGateAt, "2026-09-02T12:17:00.000Z");
  assert.equal(timing.firstSentAt, "");
});

test("timingFromBatch falls back to row reached/updatedAt when no timing record exists", () => {
  const timing = timingFromBatch({
    startedAt: "2026-09-02T12:00:00.000Z",
    rows: [
      { status: "mirrored", reached: ["picked", "qualified", "mirrored"], updatedAt: "2026-09-02T12:09:30.000Z" },
      { status: "qualified", reached: ["picked", "qualified"], updatedAt: "2026-09-02T12:03:00.000Z" },
    ],
  });
  assert.equal(timing.firstQualifiedAt, "2026-09-02T12:03:00.000Z");
  assert.equal(timing.firstBuiltAt, "2026-09-02T12:09:30.000Z");
  assert.equal(timing.firstGateAt, "");
});

test("funnelStages surfaces stamped stages and hides bookkeeping rows", () => {
  const stages = funnelStages({
    mineFunnel: [
      { stage: "quota_contract_finished_sites_v1", entered: 10, survived: 0, elapsedMs: 0 },
      { stage: "mined_raw", entered: 40, survived: 12, elapsedMs: 240_000 },
      { stage: "line_start_watch_v1", claimed_at: "2026-09-02T12:00:05.000Z" },
      { stage: "line_campaign_timing_v1", startedAt: "2026-09-02T12:00:00.000Z" },
    ],
  });
  assert.deepEqual(stages.map((stage) => stage.stage), [
    "quota_contract_finished_sites_v1",
    "mined_raw",
  ]);
  assert.equal(stages[1].elapsedMs, 240_000);
  assert.equal(stages[1].entered, 40);
  assert.equal(stages[1].survived, 12);
});

test("formatDuration renders proof-grade minute:second.tenth values", () => {
  assert.equal(formatDuration(0), "00:00.0");
  assert.equal(formatDuration(59_940), "00:59.9");
  assert.equal(formatDuration(60_000), "01:00.0");
  assert.equal(formatDuration(15 * 60_000 + 42_300), "15:42.3");
  assert.equal(formatDuration(25 * 60_000), "25:00.0");
  assert.equal(formatDuration(Number.NaN), "—");
  assert.equal(formatDuration(-5), "—");
});

test("formatTable prints the full fire→sent table with per-stage funnel timings", () => {
  const table = formatTable({
    batchId: "line_table_1",
    url: "https://ghost.example.test",
    finalStatus: "done",
    haltReason: "",
    counts: { total: 10, sent: 10, queued: 0, failed: 0, working: 0 },
    firedAt: "2026-09-02T12:00:00.000Z",
    lastSentAt: "2026-09-02T12:21:12.500Z",
    observedAt: "2026-09-02T12:21:15.000Z",
    finalTiming: {
      startedAt: "2026-09-02T12:00:00.000Z",
      firstQualifiedAt: "2026-09-02T12:02:14.000Z",
      firstBuiltAt: "2026-09-02T12:09:01.000Z",
      firstGateAt: "2026-09-02T12:17:44.000Z",
      firstSentAt: "2026-09-02T12:19:58.000Z",
    },
    stages: [
      { stage: "quota_contract_finished_sites_v1", elapsedMs: 0, entered: 10, survived: 10 },
      { stage: "mined_raw", elapsedMs: 134_000, entered: 40, survived: 12 },
    ],
  });
  assert.match(table, /batch\s+line_table_1/);
  assert.match(table, /status\s+done/);
  assert.match(table, /sent\s+10\/10/);
  assert.match(table, /first qualified\s+02:14\.0/);
  assert.match(table, /first build done \(mirrored\)\s+09:01\.0/);
  assert.match(table, /first gate passed\s+17:44\.0/);
  assert.match(table, /first email sent\s+19:58\.0/);
  assert.match(table, /all sent\s+21:12\.5/);
  assert.match(table, /total\s+21:12\.5/);
  assert.match(table, /funnel stage 1\s+00:00\.0\s+quota_contract_finished_sites_v1/);
  assert.match(table, /funnel stage 2\s+02:14\.0\s+mined_raw\s+in:40 ok:12/);
});

test("formatTable marks unreached milestones instead of lying", () => {
  const table = formatTable({
    batchId: "line_partial",
    url: "https://ghost.example.test",
    finalStatus: "building",
    haltReason: "",
    counts: { total: 10, sent: 0, queued: 2, failed: 1, working: 7 },
    firedAt: "2026-09-02T12:00:00.000Z",
    lastSentAt: "",
    observedAt: "2026-09-02T12:11:00.000Z",
    finalTiming: {
      startedAt: "2026-09-02T12:00:00.000Z",
      firstQualifiedAt: "2026-09-02T12:02:00.000Z",
      firstBuiltAt: "",
      firstGateAt: "",
      firstSentAt: "",
    },
    stages: [],
  });
  assert.match(table, /first qualified\s+02:00\.0/);
  assert.match(table, /first build done \(mirrored\)\s+—\s+\(not reached\)/);
  assert.match(table, /first email sent\s+—\s+\(not reached\)/);
  assert.match(table, /none recorded/);
});

function batchResponse(batch) {
  return jsonResponse(200, { ok: true, batch });
}

test("runCampaign drives a full campaign through a stubbed fetch and stops at done", async () => {
  const calls = [];
  const startBody = { ok: true, accepted: true, batch: { batchId: "line_live_1", status: "building" } };
  const polls = [
    batchResponse({
      batchId: "line_live_1",
      status: "building",
      startedAt: "2026-09-02T12:00:00.000Z",
      campaignTiming: { startedAt: "2026-09-02T12:00:00.000Z", firstQualifiedAt: "2026-09-02T12:02:00.000Z" },
      mineFunnel: [{ stage: "mined_raw", elapsedMs: 60_000, entered: 30, survived: 10 }],
      rows: [{ status: "qualified", reached: ["picked", "qualified"], updatedAt: "2026-09-02T12:02:00.000Z" }],
    }),
    batchResponse({
      batchId: "line_live_1",
      status: "done",
      startedAt: "2026-09-02T12:00:00.000Z",
      campaignTiming: {
        startedAt: "2026-09-02T12:00:00.000Z",
        firstQualifiedAt: "2026-09-02T12:02:00.000Z",
        firstBuiltAt: "2026-09-02T12:09:00.000Z",
        firstGateAt: "2026-09-02T12:17:00.000Z",
        firstSentAt: "2026-09-02T12:20:00.000Z",
      },
      mineFunnel: [{ stage: "mined_raw", elapsedMs: 60_000, entered: 30, survived: 10 }],
      rows: [
        { status: "sent", reached: ["picked", "qualified", "mirrored", "gate_passed", "queued", "sent"], updatedAt: "2026-09-02T12:20:30.000Z" },
      ],
    }),
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init && init.method });
    if (String(url).endsWith("/api/admin/line") && init && init.method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.action, "start");
      assert.equal(init.headers["x-admin-token"], "secret-token");
      return jsonResponse(202, startBody);
    }
    if (String(url).includes("/api/admin/line?batchId=line_live_1")) {
      const next = polls.shift();
      return next || pollsFallback();
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  function pollsFallback() {
    throw new Error("polled past completion");
  }
  const sleeps = [];
  const record = await runCampaign({
    url: "https://ghost.example.test",
    count: 10,
    lane: "sandbox",
    pollMs: 15_000,
    timeoutMs: 60_000,
    fetchImpl,
    sleep: async (ms) => sleeps.push(ms),
    log: () => {},
  }, "secret-token");
  assert.equal(record.batchId, "line_live_1");
  assert.equal(record.finalStatus, "done");
  assert.equal(record.counts.sent, 1);
  assert.equal(record.finalTiming.firstSentAt, "2026-09-02T12:20:00.000Z");
  assert.equal(record.stages.length, 1);
  assert.equal(record.polls.length, 2, "stops polling once terminal");
  assert.deepEqual(sleeps, [15_000], "sleeps between polls only");
  const post = calls.find((call) => call.method === "POST");
  assert.ok(post, "start POST recorded");
  const table = formatTable(record);
  assert.match(table, /first email sent\s+20:00\.0/);
  assert.match(table, /total\s+20:30\.0/);
});

test("runCampaign turns a phantom start into a loud PhantomAcceptError", async () => {
  const fetchImpl = async () => jsonResponse(202, { ok: true, accepted: true, batch: null });
  await assert.rejects(
    runCampaign({
      url: "https://ghost.example.test",
      count: 10,
      lane: "sandbox",
      pollMs: 1_000,
      timeoutMs: 5_000,
      fetchImpl,
      sleep: async () => {},
      log: () => {},
    }),
    PhantomAcceptError,
  );
});

test("runCampaign turns a vanished batch mid-poll into a loud PhantomAcceptError", async () => {
  const fetchImpl = async (url, init) => {
    if (init && init.method === "POST") {
      return jsonResponse(202, { ok: true, accepted: true, batch: { batchId: "line_ghost", status: "building" } });
    }
    return jsonResponse(404, { ok: false, error: "unknown_batch", batchId: "line_ghost" });
  };
  await assert.rejects(
    runCampaign({
      url: "https://ghost.example.test",
      count: 10,
      lane: "sandbox",
      pollMs: 1_000,
      timeoutMs: 5_000,
      fetchImpl,
      sleep: async () => {},
      log: () => {},
    }),
    (error) => error instanceof PhantomAcceptError && /PHANTOM BATCH/.test(error.message),
  );
});

test("parseArgs and resolveToken follow the CLI contract", () => {
  const options = parseArgs([
    "--url", "https://ghost.example.test/",
    "--count", "10",
    "--target", "Austin, TX roofing",
    "--token-file", "X:/secrets/token.txt",
    "--poll-ms", "15000",
    "--out", "record.json",
  ]);
  assert.equal(options.url, "https://ghost.example.test", "trailing slash trimmed");
  assert.equal(options.count, 10);
  assert.equal(options.target, "Austin, TX roofing");
  assert.equal(options.lane, "sandbox", "live requires an explicit flag");
  assert.equal(options.pollMs, 15_000);
  assert.equal(options.out, "record.json");
  assert.throws(() => parseArgs(["--url"]), /missing value/);
  assert.throws(() => parseArgs(["--nope"]), /unknown argument/);

  const readFile = (file) => {
    assert.equal(file, "X:/secrets/token.txt");
    return "  file-token \n";
  };
  assert.equal(resolveToken({ token: "", tokenFile: "X:/secrets/token.txt" }, readFile, {}), "file-token");
  assert.equal(resolveToken({ token: "arg-token" }, readFile, { WSS_ADMIN_TOKEN: "env-token" }), "arg-token");
  assert.equal(resolveToken({}, readFile, { WSS_ADMIN_TOKEN: "env-token" }), "env-token");
  assert.equal(resolveToken({}, readFile, {}), "", "no token anywhere is empty, never a guess");
});
