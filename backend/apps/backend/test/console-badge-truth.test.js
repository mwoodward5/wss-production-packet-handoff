"use strict";

// BADGE TRUTH (owner, 2026-09-02): the Command Center "Live production" panel
// showed stage badges that disagreed with the per-row list rendered in the
// same panel — "Sourcing the first qualified prospects · 0%" while six rows
// below were qualified or gate-passed, and an ETA computed from rejected
// attempts that had already elapsed. These tests render the real controller
// against tonight's exact drain mix (4 qualified, 2 gate_passed, 7 rejected,
// 1 error on a 10-finished-site goal) and pin the law: the badges, the
// headline, the pace and the ETA all derive from the SAME rows array the
// factory feed lists; rejected/error attempts never consume a slot.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const page = require("../lib/operator-workspace-page-final");

const MIN = 60_000;

function controller() {
  return page.split("<script>").slice(1)
    .map((part) => part.split("</script>")[0])
    .find((script) => script.includes("var KEY='wsl_admin_token'"));
}

async function harness(snapshot) {
  const elements = new Map();
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const child = { textContent: "" };
    const value = {
      id,
      hidden: false,
      value: "",
      disabled: false,
      textContent: "",
      className: "",
      innerHTML: "",
      classList: { toggle() {} },
      addEventListener() {},
      setAttribute() {},
      getAttribute() { return ""; },
      querySelector() { return child; },
      focus() {},
      scrollIntoView() {},
      closest() { return null; },
    };
    elements.set(id, value);
    return value;
  }
  const response = (body) => ({ ok: true, status: 200, json: async () => body });
  const context = {
    URLSearchParams,
    localStorage: { getItem() { return "signed-session"; }, setItem() {}, removeItem() {} },
    location: { search: "", reload() {} },
    document: {
      hidden: false,
      getElementById: element,
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    confirm() { return true; },
    clearInterval() {},
    setInterval() { return 1; },
    setTimeout() { return 1; },
    fetch(url) {
      if (url === "/api/admin/line") return Promise.resolve(response(snapshot));
      return Promise.resolve(response({}));
    },
  };
  vm.runInNewContext(controller(), context);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return {
    html: () => element("currentWork").innerHTML,
    side: () => element("sideLiveSub").textContent,
  };
}

function row(status, index, updatedAt, reason) {
  return {
    businessName: "Business " + index,
    status,
    updatedAt: new Date(updatedAt).toISOString(),
    telemetry: {},
    ...(reason ? { reason } : {}),
  };
}

// Tonight's mix, from the drain_emails JSON: 4 qualified, 2 gate_passed,
// 7 rejected, 1 error — 14 rows on a 10-finished-site goal, replacements
// still being picked. The server performance block carries the stale lie the
// owner saw (pace 0.64/min, ETA 8 min) so the test proves the client no
// longer repeats it.
function tonightSnapshot() {
  const now = Date.now();
  const working = [];
  for (let i = 0; i < 4; i += 1) working.push(row("qualified", i, now - 2 * MIN));
  for (let i = 4; i < 6; i += 1) working.push(row("gate_passed", i, now - 1 * MIN));
  const rejected = [];
  for (let i = 6; i < 13; i += 1) rejected.push(row("rejected", i, now - 30 * MIN, "multi_trade_business"));
  const errored = [row("error", 13, now - 40 * MIN, "worker_timed_out")];
  return {
    ok: true,
    capacity: {},
    batches: [{
      batchId: "tonight",
      status: "running",
      lane: "live",
      requested: 10,
      target: "all trades nationwide",
      pickState: "picking",
      startedAt: new Date(now - 15 * MIN).toISOString(),
      campaignTiming: {
        stage: "line_campaign_timing_v1",
        startedAt: new Date(now - 15 * MIN).toISOString(),
        firstQualifiedAt: new Date(now - 12 * MIN).toISOString(),
        firstBuiltAt: new Date(now - 9 * MIN).toISOString(),
        firstGateAt: new Date(now - 6 * MIN).toISOString(),
        firstSentAt: null,
      },
      performance: {
        target: 14,
        processed: 8,
        remaining: 6,
        elapsedMs: 15 * MIN,
        throughputPerMinute: 0.64,
        etaMinutes: 8,
        bottleneck: null,
        phases: {},
      },
      rows: working.concat(rejected, errored),
    }],
  };
}

function countFor(html, label) {
  const match = html.match(new RegExp('<b class="mile-count">(\\d+/(?:\\d+))</b></div><div class="mile-label">' + label + "</div>"));
  assert.ok(match, "milestone badge for " + label + " renders");
  return match[1];
}

test("badges equal the rows the factory feed lists — tonight's mix", async () => {
  const view = await harness(tonightSnapshot());
  const html = view.html();

  // Same rows the feed lists: 6 working (4 qualified + 2 gate_passed).
  assert.equal(countFor(html, "Prospect packets"), "6/10");
  assert.equal(countFor(html, "Qualified"), "6/10");
  assert.equal(countFor(html, "Builds cleared"), "2/10");
  assert.equal(countFor(html, "Live inspection"), "2/10");
  assert.equal(countFor(html, "Ready"), "0/10");

  // The feed in the same panel lists those same six live rows.
  const feed = html.slice(html.indexOf("What the factory is doing now"));
  for (let i = 0; i < 6; i += 1) assert.ok(feed.includes("Business " + i), "feed lists working row " + i);
  for (let i = 6; i < 14; i += 1) assert.ok(!feed.includes("Business " + i), "feed skips settled row " + i);
});

test("rejected and error attempts never consume a slot", async () => {
  const view = await harness(tonightSnapshot());
  const html = view.html();

  assert.ok(html.includes("<span>Finished</span><b>0 / 10</b>"), "finished stays 0 of 10");
  assert.ok(html.includes("<span>Rejected attempts</span><b>8</b>"), "7 rejected + 1 error are attempts");
  assert.ok(html.includes("did not consume quota"));
  assert.ok(html.includes("0 of 10 finished slots are complete. 8 replacement candidates have been rejected without consuming the 10-site goal."));
  assert.ok(html.includes('<div class="overall-num">0%</div>'));
});

test("headline cannot say sourcing when qualified rows exist", async () => {
  const view = await harness(tonightSnapshot());
  const html = view.html();

  assert.ok(!html.includes("Sourcing the first qualified prospects"), "six qualified rows contradict that headline");
  assert.ok(html.includes("Finished website progress"));
});

test("sourcing headline returns only when no row has qualified yet", async () => {
  const now = Date.now();
  const snapshot = {
    ok: true,
    capacity: {},
    batches: [{
      batchId: "fresh",
      status: "building",
      lane: "sandbox",
      requested: 10,
      target: "hvac nationwide",
      pickState: "picking",
      startedAt: new Date(now - 3 * MIN).toISOString(),
      performance: { target: 10, processed: 0, remaining: 10, elapsedMs: 3 * MIN, throughputPerMinute: 0, etaMinutes: 0, bottleneck: null, phases: {} },
      rows: [row("picked", 0, now - 1 * MIN), row("picked", 1, now - 2 * MIN)],
    }],
  };
  const view = await harness(snapshot);
  assert.ok(view.html().includes("Sourcing the first qualified prospects"));
});

test("ETA is never promised from rejected-attempt pace — no past ETAs", async () => {
  const view = await harness(tonightSnapshot());
  const html = view.html();

  // The server block still says pace 0.64/min, ETA 8 min (already elapsed):
  // the card must derive its own numbers from the same rows instead.
  assert.ok(!/<span>ETA<\/span><b>8 min<\/b>/.test(html), "stale server ETA must not be echoed");
  assert.ok(html.includes("<span>ETA</span><b>Measuring</b>"), "zero finished websites means no ETA at all");
  assert.ok(html.includes("<small>from finished sites only</small>"));
  // Pace counts real processed candidates: 8 attempts over 15 minutes.
  assert.ok(/<span>Pace<\/span><b>0\.5\d\/min<\/b>/.test(html), "pace derived from the rows, got: " + (html.match(/<span>Pace<\/span><b>[^<]*<\/b>/) || [""])[0]);
});

test("ETA from finished-site rate when finishes exist", async () => {
  const now = Date.now();
  const rows = [
    row("queued", 0, now - 1 * MIN),
    row("queued", 1, now - 2 * MIN),
    row("gate_passed", 2, now - 3 * MIN),
    row("qualified", 3, now - 4 * MIN),
    row("rejected", 4, now - 20 * MIN, "multi_trade_business"),
    row("rejected", 5, now - 21 * MIN, "multi_trade_business"),
    row("rejected", 6, now - 22 * MIN, "multi_trade_business"),
  ];
  const snapshot = {
    ok: true,
    capacity: {},
    batches: [{
      batchId: "rolling",
      status: "running",
      lane: "live",
      requested: 10,
      target: "roofing nationwide",
      pickState: "picking",
      startedAt: new Date(now - 10 * MIN).toISOString(),
      campaignTiming: { stage: "line_campaign_timing_v1", startedAt: new Date(now - 10 * MIN).toISOString() },
      performance: { target: 10, processed: 5, remaining: 5, elapsedMs: 10 * MIN, throughputPerMinute: 0.5, etaMinutes: 10, bottleneck: null, phases: {} },
      rows,
    }],
  };
  const view = await harness(snapshot);
  const html = view.html();
  // 2 finished over ~10 minutes, 8 slots left -> ~40 minutes, never less than 1.
  assert.ok(/<span>ETA<\/span><b>4[01] min<\/b>/.test(html), "ETA from finished rate, got: " + (html.match(/<span>ETA<\/span><b>[^<]*<\/b>/) || [""])[0]);
  assert.equal(countFor(html, "Ready"), "2/10");
});

test("missing campaignTiming degrades gracefully to the batch start", async () => {
  const now = Date.now();
  const snapshot = tonightSnapshot();
  const batch = snapshot.batches[0];
  delete batch.campaignTiming;
  batch.startedAt = new Date(now - 20 * MIN).toISOString();
  const view = await harness(snapshot);
  const html = view.html();

  // Pace still computes from the batch start (8 attempts over 20 minutes).
  assert.ok(/<span>Pace<\/span><b>0\.4\d\/min<\/b>/.test(html), "pace falls back to batch start, got: " + (html.match(/<span>Pace<\/span><b>[^<]*<\/b>/) || [""])[0]);
  // And with zero finishes the ETA stays absent instead of lying.
  assert.ok(html.includes("<span>ETA</span><b>Measuring</b>"));
  assert.equal(countFor(html, "Builds cleared"), "2/10");
});

test("a finished campaign never shows a past-due ETA", async () => {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 10; i += 1) rows.push(row("sent", i, now - i * MIN));
  const snapshot = {
    ok: true,
    capacity: {},
    batches: [{
      batchId: "done",
      status: "running",
      lane: "sandbox",
      requested: 10,
      target: "salon in Phoenix, AZ",
      pickState: "complete",
      startedAt: new Date(now - 90 * MIN).toISOString(),
      campaignTiming: { stage: "line_campaign_timing_v1", startedAt: new Date(now - 90 * MIN).toISOString(), firstSentAt: new Date(now - 5 * MIN).toISOString() },
      performance: { target: 10, processed: 10, remaining: 0, elapsedMs: 90 * MIN, throughputPerMinute: 0.11, etaMinutes: 0, bottleneck: null, phases: {} },
      rows,
    }],
  };
  const view = await harness(snapshot);
  const html = view.html();
  assert.ok(html.includes("<span>Finished</span><b>10 / 10</b>"));
  assert.equal(countFor(html, "Ready"), "10/10");
  assert.ok(html.includes("<span>ETA</span><b>Measuring</b>"), "no slots left means no ETA, not a past one");
  assert.ok(view.side().includes("10 / 10 ready"));
});
