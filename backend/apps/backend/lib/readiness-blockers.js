"use strict";

// A "not ready" verdict that names no cause is the same shape as a QC gate that
// passes with zero evidence behind it: a status, not a fact. This module holds
// the one invariant every readiness surface owes its caller:
//
//     ready === false  =>  blockers.length > 0
//
// It does NOT decide what blocks launch. Callers compute their own blockers from
// their own gates; this only refuses to let a blocked verdict ship anonymously.

const UNKNOWN_BLOCKER_CODE = "readiness_blocked_reason_unavailable";

const UNKNOWN_BLOCKER = {
  code: UNKNOWN_BLOCKER_CODE,
  reason:
    "Launch readiness is blocked but the readiness computation named no cause. Treat this as blocked and fix the computation.",
};

function text(value) {
  return String(value == null ? "" : value).trim();
}

/**
 * Coerce a caller's blocker list into the reported shape: every entry carries a
 * machine `code` and a human `reason`. Entries with no reason at all are the one
 * thing we drop, because an empty reason is the bug this module exists to stop.
 */
function normalizeBlockers(blockers = []) {
  if (!Array.isArray(blockers)) return [];
  return blockers
    .map((entry) => {
      if (entry == null) return null;
      if (typeof entry === "string") {
        const reason = text(entry);
        return reason ? { code: "unspecified_blocker", reason } : null;
      }
      if (typeof entry !== "object") return null;
      const reason = text(entry.reason || entry.message);
      if (!reason) return null;
      const code = text(entry.code) || "unspecified_blocker";
      const extra = {};
      if (entry.detail !== undefined) extra.detail = entry.detail;
      return { code, reason, ...extra };
    })
    .filter(Boolean);
}

/**
 * Build the reported verdict.
 *
 * With no explicit `ready`, the verdict is derived from the blocker list, which
 * is exactly the pre-existing `hardStops.length === 0` semantics — this changes
 * reporting, never what blocks launch.
 *
 * With an explicit `ready`, a true claim still has to survive the blocker list
 * (a caller cannot declare ready while naming blockers), and a false claim that
 * names nothing gets the unknown-cause blocker attached rather than shipping an
 * empty array.
 */
function readinessVerdict({ blockers = [], ready } = {}) {
  const list = normalizeBlockers(blockers);
  const verdict = ready === undefined ? list.length === 0 : ready === true && list.length === 0;
  if (verdict === false && list.length === 0) list.push({ ...UNKNOWN_BLOCKER });
  return { ready: verdict, blockers: list };
}

module.exports = {
  UNKNOWN_BLOCKER,
  UNKNOWN_BLOCKER_CODE,
  normalizeBlockers,
  readinessVerdict,
};
