"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeGrade, verifyFreshGetFoundProof } = require("../lib/getfound-proof");

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const prospect = {
  prospect_id: "prospect-1",
  business_name: "Business 1",
  current_website: "https://business-1.example",
};

test("accepts only the exact grade returned by the existing fresh-proof lookup", async () => {
  const fetchImpl = async () => { throw new Error("lookup owns fetch use"); };
  let received;
  const result = await verifyFreshGetFoundProof({
    prospect,
    expectedGrade: "c+",
    nowMs: NOW_MS,
    fetchImpl,
  }, {
    latestGrade: async (candidate, options) => {
      received = { candidate, options };
      return { configured: true, grade: "C+" };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    grade: "C+",
    source: "callprep_validated_fresh_report",
    verifiedAt: "2026-07-19T12:00:00.000Z",
  });
  assert.strictEqual(received.candidate, prospect);
  assert.equal(received.options.nowMs, NOW_MS);
  assert.strictEqual(received.options.fetchImpl, fetchImpl);
});

test("the default path reuses the hardened CallPrep row validator", async () => {
  const priorUrl = process.env.CALLPREP_SUPABASE_URL;
  const priorKey = process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY;
  process.env.CALLPREP_SUPABASE_URL = "https://callprep-project.supabase.co";
  process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const businessReportId = "1ea11b00-c8d5-4091-a5f8-5bc42eab8268";
  const candidate = {
    business_name: "Acme & Sons Roofing",
    current_website: "https://acme-roofing.example/",
    record: { business_report_id: businessReportId },
  };
  const row = {
    id: "fa37be05-e3ff-49b6-8af9-0f02ca523078",
    business_report_id: businessReportId,
    business_name: "Acme and Sons Roofing",
    input_value: "https://acme-roofing.example/",
    overall_score: 62,
    overall_grade: "D",
    data_mode: "blended",
    created_at: "2026-07-19T10:00:01.000Z",
    report_data: {
      businessName: "Acme & Sons Roofing",
      inputValue: "https://acme-roofing.example/",
      resolvedWebsiteUrl: "https://www.acme-roofing.example/",
      overallScore: 62,
      overallGrade: "D",
      dataMode: "blended",
      entityMismatch: false,
      lowConfidenceMatch: false,
    },
    report: {
      id: businessReportId,
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

  try {
    const result = await verifyFreshGetFoundProof({
      prospect: candidate,
      expectedGrade: "D",
      nowMs: NOW_MS,
      fetchImpl: async () => ({ ok: true, json: async () => [row] }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.grade, "D");
  } finally {
    if (priorUrl === undefined) delete process.env.CALLPREP_SUPABASE_URL;
    else process.env.CALLPREP_SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY;
    else process.env.CALLPREP_SUPABASE_SERVICE_ROLE_KEY = priorKey;
  }
});

test("fails closed when the proof source is absent, invalid, stale, mismatched, or unreachable", async () => {
  const cases = [
    ["source unavailable", async () => ({ configured: false, grade: "C" }), "getfound_proof_source_unavailable"],
    ["no valid fresh record", async () => ({ configured: true, grade: "" }), "getfound_proof_invalid_or_stale"],
    ["different live grade", async () => ({ configured: true, grade: "B" }), "getfound_grade_mismatch"],
    ["lookup error", async () => { throw new Error("offline"); }, "getfound_proof_lookup_unavailable"],
  ];
  for (const [label, latestGrade, reason] of cases) {
    const result = await verifyFreshGetFoundProof({ prospect, expectedGrade: "C", nowMs: NOW_MS }, { latestGrade });
    assert.equal(result.ok, false, label);
    assert.equal(result.reason, reason, label);
  }
});

test("never treats an unvalidated stored value as GetFound proof", async () => {
  let lookups = 0;
  const result = await verifyFreshGetFoundProof({
    prospect: { ...prospect, getfound_grade: "A" },
    expectedGrade: "A",
    nowMs: NOW_MS,
  }, {
    latestGrade: async () => { lookups += 1; return { configured: true, grade: "" }; },
  });
  assert.equal(lookups, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "getfound_proof_invalid_or_stale");
});

test("rejects malformed inputs before lookup", async () => {
  let lookups = 0;
  const latestGrade = async () => { lookups += 1; return { configured: true, grade: "A" }; };
  assert.equal((await verifyFreshGetFoundProof({ expectedGrade: "A", nowMs: NOW_MS }, { latestGrade })).reason, "getfound_prospect_required");
  assert.equal((await verifyFreshGetFoundProof({ prospect, expectedGrade: "excellent", nowMs: NOW_MS }, { latestGrade })).reason, "getfound_expected_grade_invalid");
  assert.equal((await verifyFreshGetFoundProof({ prospect, expectedGrade: "A", nowMs: "bad" }, { latestGrade })).reason, "getfound_proof_clock_invalid");
  assert.equal(lookups, 0);
  assert.equal(normalizeGrade(" b- "), "B-");
  assert.equal(normalizeGrade("A++"), "");
});
