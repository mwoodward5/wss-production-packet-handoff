"use strict";

// This module deliberately delegates grade lookup to the existing held-drafts
// validator. That path validates report linkage, business/website identity,
// measured evidence, score/grade agreement, timestamps, and report expiry.
// A caller-supplied/stored grade alone is never proof.

function normalizeGrade(value) {
  const grade = String(value || "").trim().toUpperCase();
  return /^[A-F][+-]?$/.test(grade) ? grade : "";
}

function failed(reason, detail) {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

async function defaultLatestGrade(prospect, options) {
  // Lazy loading keeps focused validators free of route startup side effects
  // while reusing the authoritative CallPrep validation path unchanged.
  const { latestGrade } = require("../api/admin/held-drafts");
  return latestGrade(prospect, options);
}

async function verifyFreshGetFoundProof(input = {}, dependencies = {}) {
  const prospect = input.prospect && typeof input.prospect === "object" ? input.prospect : null;
  const expectedGrade = normalizeGrade(input.expectedGrade);
  const nowMs = input.nowMs === undefined ? Date.now() : Number(input.nowMs);
  const latestGrade = dependencies.latestGrade || defaultLatestGrade;

  if (!prospect) return failed("getfound_prospect_required");
  if (!expectedGrade) return failed("getfound_expected_grade_invalid");
  if (!Number.isFinite(nowMs)) return failed("getfound_proof_clock_invalid");

  let result;
  try {
    result = await latestGrade(prospect, {
      nowMs,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
  } catch {
    return failed("getfound_proof_lookup_unavailable");
  }

  if (!result || result.configured !== true) {
    return failed("getfound_proof_source_unavailable");
  }
  const actualGrade = normalizeGrade(result.grade);
  if (!actualGrade) return failed("getfound_proof_invalid_or_stale");
  if (actualGrade !== expectedGrade) {
    return failed("getfound_grade_mismatch", { expectedGrade, actualGrade });
  }

  return {
    ok: true,
    grade: actualGrade,
    source: "callprep_validated_fresh_report",
    verifiedAt: new Date(nowMs).toISOString(),
  };
}

module.exports = {
  normalizeGrade,
  verifyFreshGetFoundProof,
};
