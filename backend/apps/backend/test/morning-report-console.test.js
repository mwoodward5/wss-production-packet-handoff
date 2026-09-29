"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const page = require("../lib/console-page");
const { createMorningReportHandler } = require("../api/admin/morning-report");

function response() {
  return {
    headers: {},
    statusCode: 0,
    raw: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = "") { this.raw = String(value); },
    body() { return this.raw ? JSON.parse(this.raw) : null; },
  };
}

test("Morning Report admin endpoint rejects non-GET before auth or generation", async () => {
  let authCalls = 0;
  let generatorCalls = 0;
  const handler = createMorningReportHandler({
    requireAdmin: () => { authCalls += 1; return true; },
    generateMorningReport: async () => { generatorCalls += 1; return {}; },
  });
  const res = response();

  await handler({ method: "POST", headers: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body(), { ok: false, error: "method_not_allowed", allowed: ["GET"] });
  assert.equal(authCalls, 0, "auth ran before the method guard");
  assert.equal(generatorCalls, 0, "a rejected method reached the generator");
});

test("Morning Report admin endpoint requires x-admin-token before generation", async () => {
  const previous = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  const previousSecondary = process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "morning-report-owner-proof";
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
  let generatorCalls = 0;
  const handler = createMorningReportHandler({
    generateMorningReport: async () => { generatorCalls += 1; return {}; },
  });
  const res = response();
  try {
    await handler({ method: "GET", headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body().error, "unauthorized");
    assert.equal(generatorCalls, 0);
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = previous;
    if (previousSecondary === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY = previousSecondary;
  }
});

test("valid Morning Report GET calls the shared generator with empty input and injected deps", async () => {
  const previous = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "morning-report-owner-proof";
  const deps = { proof: "fixture" };
  const report = {
    totals: { mined: 0, built: 0, sent: 0, repliesWaiting: 0 },
    warnings: [],
  };
  const calls = [];
  const handler = createMorningReportHandler({
    deps,
    generateMorningReport: async (input, receivedDeps) => {
      calls.push({ input, deps: receivedDeps });
      return report;
    },
  });
  const res = response();
  try {
    await handler({
      method: "GET",
      headers: { "x-admin-token": "morning-report-owner-proof" },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body(), { ok: true, report });
    assert.deepEqual(calls, [{ input: {}, deps }]);
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = previous;
  }
});

test("Morning Report panel is first in Operations and leaves the existing iframe intact", () => {
  const panel = page.indexOf("<!-- MORNING_REPORT_PANEL_BEGIN -->");
  const frame = page.indexOf('id="opsFrameCard"');
  const operations = page.indexOf('id="tabPanelOperations"');
  const line = page.indexOf('id="tabPanelLine"');
  assert.ok(operations >= 0 && panel > operations, "panel is not inside Operations");
  assert.ok(panel < frame, "digest does not precede the Operations iframe");
  assert.ok(frame < line, "existing Operations iframe moved outside its tab");
  assert.match(page.slice(panel, frame), /id="morningReportBody"/);
});

test("Morning Report uses one authenticated GET, safe DOM rendering, and no timer", () => {
  const start = page.indexOf("// MORNING_REPORT_READ_ONLY_BEGIN");
  const end = page.indexOf("// MORNING_REPORT_READ_ONLY_END");
  assert.ok(start >= 0 && end > start, "Morning Report script markers are missing");
  const scope = page.slice(start, end);

  assert.match(scope, /api\("\/api\/admin\/morning-report"\)/);
  assert.doesNotMatch(scope, /method\s*:\s*["']POST["']/i);
  assert.doesNotMatch(scope, /\bpost\s*\(/);
  assert.doesNotMatch(scope, /setInterval|setTimeout/);
  assert.doesNotMatch(scope, /innerHTML\s*=/, "server data must not enter innerHTML");
  assert.match(scope, /textContent=/);
  assert.match(page, /opts\.headers\["x-admin-token"\]=token\(\)/);
  assert.equal((scope.match(/\/api\/admin\/morning-report/g) || []).length, 1);
});

test("Morning Report preserves measured zero and explicit unknown states", () => {
  const start = page.indexOf("// MORNING_REPORT_READ_ONLY_BEGIN");
  const end = page.indexOf("// MORNING_REPORT_READ_ONLY_END");
  const scope = page.slice(start, end);
  const finiteSource = page.match(/function finite\(value\)\{[^}]*\}/);
  const countSource = scope.match(/function mrCount\(value\)\{[^}]*\}/);
  assert.ok(finiteSource && countSource, "count helpers could not be extracted");
  const context = {};
  vm.runInNewContext(`${finiteSource[0]}\n${countSource[0]}\nresult=[mrCount(null),mrCount(undefined),mrCount(""),mrCount(0),mrCount("0")];`, context);
  assert.deepEqual(Array.from(context.result), ["Unknown", "Unknown", "Unknown", "0", "0"]);
  assert.match(scope, /pause\.known===true/);
  assert.match(scope, /riley\.known===true/);
  assert.match(scope, /sites&&sites\.known===false/);
  assert.match(scope, /leads&&leads\.known===false/);
  assert.match(scope, /leads&&leads\.lossesKnown===false/);
  assert.match(scope, /leads\.lossesReason/);
  assert.match(scope, /emails\.known===false/);
  assert.match(scope, /replies\.known===false/);
  assert.match(scope, /edits\.known===false/);
  assert.match(scope, /crons\.known===false/);
  assert.match(scope, /item\.job/);
  assert.match(scope, /item\.observed/);
  assert.match(scope, /item\.expected/);
  assert.match(scope, /item\.silentRuns/);
  assert.match(scope, /item\.manualObserved/);
  assert.match(scope, /0 funnel losses measured/);
  assert.match(scope, /0 measured/);
});

test("Morning Report inline scripts parse and its mobile grid cannot force overflow", () => {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, "no inline script found");
  for (const match of scripts) assert.doesNotThrow(() => new vm.Script(match[1]));
  assert.match(page, /\.morning-report,\.morning-report \*\{box-sizing:border-box;min-width:0\}/);
  assert.match(page, /@media\(max-width:700px\)\{\.mr-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.mr-detail-grid\{grid-template-columns:1fr\}\}/);
  assert.match(page, /overflow-wrap:anywhere/);
});
