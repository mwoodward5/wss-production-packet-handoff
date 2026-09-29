"use strict";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");
const {
  fetchCallPrepRows,
  latestGrade,
  validateGradeRecord,
  websiteInputVariants,
} = require("../api/admin/held-drafts");

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const REPORT_ID = "1ea11b00-c8d5-4091-a5f8-5bc42eab8268";
const previousUrl = process.env.CALLPREP_SUPABASE_URL;
const previousKey = process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  process.env.CALLPREP_SUPABASE_URL = "https://callprep-project.supabase.co";
  process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

afterEach(() => {
  if (previousUrl === undefined) delete process.env.CALLPREP_SUPABASE_URL;
  else process.env.CALLPREP_SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY;
  else process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

function prospect(overrides = {}) {
  return {
    business_name: "Acme & Sons Roofing",
    current_website: "https://www.acme-roofing.example/services/?utm_source=places",
    ...overrides,
  };
}

function validRow() {
  return {
    id: "fa37be05-e3ff-49b6-8af9-0f02ca523078",
    business_report_id: REPORT_ID,
    business_name: "Acme and Sons Roofing",
    input_value: "https://acme-roofing.example/services/",
    overall_score: 62,
    overall_grade: "D",
    data_mode: "blended",
    created_at: "2026-07-19T10:00:01.000Z",
    report_data: {
      businessName: "Acme & Sons Roofing",
      inputValue: "https://acme-roofing.example/services/",
      resolvedWebsiteUrl: "https://www.acme-roofing.example/",
      overallScore: 62,
      overallGrade: "D",
      dataMode: "blended",
      entityMismatch: false,
      lowConfidenceMatch: false,
    },
    report: {
      id: REPORT_ID,
      business_name: "Acme & Sons Roofing",
      business_url: "https://acme-roofing.example/",
      overall_score: 62,
      overall_grade: "D",
      report_generated_at: "2026-07-19T10:00:00.000Z",
      expires_at: "2026-07-26T10:00:00.000Z",
      created_at: "2026-07-19T10:00:00.000Z",
      data_availability: { website: "measured", websitePerformance: "measured" },
      website_metrics: { availability: "measured", score: 58, lcp: 4200 },
    },
  };
}

function jsonResponse(rows) {
  return { ok: true, json: async () => rows };
}

test("queries a stored business_report_id first and accepts only its linked measured report", async () => {
  let requestedUrl = "";
  const result = await latestGrade(prospect({ record: { business_report_id: REPORT_ID } }), {
    nowMs: NOW_MS,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse([validRow()]);
    },
  });
  const query = new URL(requestedUrl).searchParams;
  assert.equal(query.get("business_report_id"), `eq.${REPORT_ID}`);
  assert.equal(query.has("input_value"), false);
  assert.match(
    query.get("select"),
    /^id,business_report_id,business_name,input_value,overall_score,overall_grade,data_mode,report_data,created_at,report:business_reports!scan_history_business_report_id_fkey\(id,/,
  );
  assert.deepEqual(result, { configured: true, grade: "D" });
});

test("otherwise queries exact canonical website variants and never the business name", async () => {
  let requestedUrl = "";
  const result = await latestGrade(prospect(), {
    nowMs: NOW_MS,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse([validRow()]);
    },
  });
  const exactFilter = new URL(requestedUrl).searchParams.get("input_value");
  assert.match(exactFilter, /^in\.\(/);
  assert.match(exactFilter, /"https:\/\/acme-roofing\.example\/services\/"/);
  assert.match(exactFilter, /"http:\/\/www\.acme-roofing\.example\/"/);
  assert.equal(exactFilter.toLowerCase().includes("acme & sons roofing"), false);
  assert.deepEqual(result, { configured: true, grade: "D" });
});

test("website variants remove tracking data while preserving exact host and path forms", () => {
  const variants = websiteInputVariants("https://www.acme-roofing.example/services/?utm_source=places#hero");
  assert.ok(variants.includes("https://acme-roofing.example/services/"));
  assert.ok(variants.includes("http://www.acme-roofing.example/"));
  assert.ok(variants.every((value) => !value.includes("utm_source") && !value.includes("#")));
});

test("refuses non-website fallback input and malformed stored report IDs without querying", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse([validRow()]); };
  assert.deepEqual(await fetchCallPrepRows({ website: "Acme & Sons Roofing", fetchImpl }), { configured: true, rows: [] });
  assert.deepEqual(await latestGrade(prospect({ business_report_id: "not-a-uuid" }), { nowMs: NOW_MS, fetchImpl }), { configured: true, grade: "" });
  assert.equal(calls, 0);
});

test("fails closed on every grade-provenance or identity break", async (t) => {
  const cases = [
    ["unlinked report", (row) => { row.report = null; }],
    ["wrong hostname", (row) => { row.report.business_url = "https://other.example/"; }],
    ["wrong business identity", (row) => { row.report.business_name = "Different Roofing"; }],
    ["fallback data mode", (row) => { row.data_mode = "fallback"; row.report_data.dataMode = "fallback"; }],
    ["unmeasured evidence", (row) => { row.report.data_availability.website = "unavailable"; row.report.data_availability.websitePerformance = "unavailable"; }],
    ["mismatched grade", (row) => { row.report.overall_grade = "C"; }],
    ["mismatched score", (row) => { row.report_data.overallScore = 99; }],
    ["entity mismatch", (row) => { row.report_data.entityMismatch = true; }],
    ["low-confidence match", (row) => { row.report_data.lowConfidenceMatch = true; }],
    ["expired report", (row) => { row.report.expires_at = "2026-07-19T11:59:59.000Z"; }],
    ["unrelated scan time", (row) => { row.created_at = "2026-07-17T10:00:00.000Z"; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const row = structuredClone(validRow());
      mutate(row);
      assert.equal(validateGradeRecord(row, prospect(), { nowMs: NOW_MS }), null);
    });
  }
});
