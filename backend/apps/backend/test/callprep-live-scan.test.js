"use strict";

/**
 * test/callprep-live-scan.test.js
 *
 * Owner, 2026-08-05, reading a Signal report: "there's tons of stuff on this
 * page that's saying uncaptured ... if you run this directly through CallPrep,
 * all this stuff is captured."
 *
 * Cause: lib/callprep-enrich.scanBusiness() and
 * lib/callprep-client.saveScannedBusinessReport() were both built, exported,
 * and called by NOTHING. The adapter only ever posted the static packet, so
 * every report we generated rendered NOT CAPTURED for facts CallPrep measures
 * itself. These pin the scan into the path and pin the fail-soft fallback.
 */
const test = require("node:test");
const assert = require("node:assert");

const { createCallPrepReportHandler } = require("../api/adapters/callprep-report");

function res() {
  const out = { statusCode: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    get statusCode() { return out.statusCode; },
    set statusCode(v) { out.statusCode = v; },
    end(payload) { try { out.body = JSON.parse(payload); } catch { out.body = payload; } },
  };
}

function req(body) {
  const r = require("node:stream").Readable.from([JSON.stringify(body)]);
  r.method = "POST";
  r.url = "/api/adapters/callprep-report";
  r.headers = { "x-admin-token": "test-token", "content-type": "application/json" };
  return r;
}

const PROSPECT = {
  prospect: {
    id: "wss-test-scan",
    business_name: "Urban Nail Bar",
    website: "https://urbannailbar.example",
    city: "Scottsdale",
    state: "AZ",
    rating: 4.8,
    review_count: 120,
  },
};

function deps(overrides = {}) {
  return {
    toolSecretAuthorized: () => true,
    requireAdmin: () => true,
    upsertRow: async () => ({ mode: "live_upsert", configured: true }),
    saveBusinessReport: async () => ({ ok: true, report_url: "https://callprep.wss-ai.com/report/audit/static" }),
    saveScannedBusinessReport: async () => ({ ok: true, report_url: "https://callprep.wss-ai.com/report/audit/scanned" }),
    scanBusiness: async () => ({ place: { name: "Urban Nail Bar" }, categories: {}, overallScore: 72, overallGrade: "B" }),
    ...overrides,
  };
}

test("a report runs the LIVE scan and saves the scanned row", async () => {
  let scannedWith = null;
  let staticCalled = false;
  const handler = createCallPrepReportHandler(deps({
    scanBusiness: async (args) => { scannedWith = args; return { overallScore: 72, categories: {} }; },
    saveBusinessReport: async () => { staticCalled = true; return { ok: true, report_url: "static" }; },
  }));
  const r = res();
  await handler(req(PROSPECT), r);
  assert.ok(scannedWith, "scanBusiness was never called — the report is static again");
  assert.equal(staticCalled, false, "the static path must not run when a scan succeeded");
  assert.match(String(scannedWith.input), /urbannailbar/i, "the scan should key off their website");
});

test("no website falls back to name + city + state as the scan key", async () => {
  let scannedWith = null;
  const handler = createCallPrepReportHandler(deps({
    scanBusiness: async (args) => { scannedWith = args; return { categories: {} }; },
  }));
  const body = { prospect: { ...PROSPECT.prospect, website: "" } };
  await handler(req(body), res());
  assert.match(String(scannedWith.input), /Urban Nail Bar/i);
  assert.match(String(scannedWith.input), /Scottsdale/i);
});

test("a gateway failure falls back to the static packet — never loses the report", async () => {
  let staticCalled = false;
  const handler = createCallPrepReportHandler(deps({
    scanBusiness: async () => { throw new Error("gateway 503"); },
    saveBusinessReport: async () => { staticCalled = true; return { ok: true, report_url: "https://callprep.wss-ai.com/report/audit/static" }; },
  }));
  const r = res();
  await handler(req(PROSPECT), r);
  assert.equal(staticCalled, true, "a failed scan must still produce a report");
  assert.equal(r.out.statusCode, 200);
  assert.match(String(r.out.body.callprep.scan_mode || ""), /static_fallback/);
});

test("scan:false opts out explicitly (kept for cheap re-saves)", async () => {
  let scanned = false;
  const handler = createCallPrepReportHandler(deps({
    scanBusiness: async () => { scanned = true; return {}; },
  }));
  await handler(req({ ...PROSPECT, scan: false }), res());
  assert.equal(scanned, false);
});

test("the response records which mode produced the report", async () => {
  const handler = createCallPrepReportHandler(deps());
  const r = res();
  await handler(req(PROSPECT), r);
  assert.equal(r.out.body.callprep.scan_mode, "live_scan");
});
