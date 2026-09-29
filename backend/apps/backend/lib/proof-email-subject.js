"use strict";
// lib/proof-email-subject.js — the ONE builder for proof-email subject lines.
//
// Owner's rendered-DOM audit (Flint Plumbing proof, msg 57d0a6ee): the BODY
// number was fixed to a measured value, but the SUBJECT was never touched and
// shipped:
//
//   "PROOF: Flint Plumbing LLC site is live — before/after, 0 errors, 0.2s load [INTERNAL TEST]"
//
// Two separate defects lived in that one string:
//
//   · "0 errors" was a hardcoded literal. What was actually observed was zero
//     console errors on ONE render of ONE page. "0 errors" as written is a
//     blanket property of the whole site — a claim nobody measured. It is gone,
//     and there is no argument or flag that puts it back.
//
//   · the load figure was interpolated from a real measurement, but the same
//     template also carried the literal fallback "measured" when the timing run
//     failed — a perf claim with no number behind it. A load figure now appears
//     ONLY when the caller hands in the measured value for THIS build. No
//     measurement -> the subject carries no performance claim at all, not a
//     softened one.
//
// The rule this file enforces: a performance claim in a subject line is DATA or
// it is ABSENT.

/**
 * The shapes a perf claim takes in a subject line. Exported so the tripwire and
 * the tests read from one list instead of drifting apart.
 *   · /\b0 errors\b/i        — the exact claim that shipped
 *   · /\d+(\.\d+)?\s*s\b/i   — any "0.2s" / "1.4 s" style timing
 *   · /fast|instant|blazing/i — the adjectives that mean the same thing with no
 *                               number attached, which is worse, not better
 */
const PERF_CLAIM_PATTERNS = [/\b0 errors\b/i, /\d+(\.\d+)?\s*s\b/i, /fast|instant|blazing/i];

/**
 * A measured seconds value -> the exact string that goes in the subject.
 * Renders what was measured (0.42 -> "0.42s"), never a rounded-to-look-good
 * version. Anything that is not a real positive measurement returns null so the
 * caller drops the claim instead of printing "0s" or "NaNs".
 */
function formatLoadSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.round(seconds * 100) / 100;
  if (!(rounded > 0)) return null; // sub-10ms "measurement" is not a load time
  return `${String(rounded)}s`;
}

/**
 * Accepts the measurement in whatever shape the caller already has:
 *   proofEmailSubject({ measured: 0.42 })                  // seconds
 *   proofEmailSubject({ measured: { loadSeconds: 0.42 } })
 *   proofEmailSubject({ measured: { loadMs: 420 } })
 *   proofEmailSubject({ measured: speed })                 // { medianMs, samples }
 * Anything else — null, undefined, {}, a string — is NO MEASUREMENT.
 */
function measuredLoadLabel(measured) {
  if (measured == null) return null;
  if (typeof measured === "number") return formatLoadSeconds(measured);
  if (typeof measured !== "object") return null;
  if (Number.isFinite(measured.loadSeconds)) return formatLoadSeconds(measured.loadSeconds);
  const ms = [measured.loadMs, measured.medianMs].find((n) => Number.isFinite(n));
  return ms == null ? null : formatLoadSeconds(ms / 1000);
}

/**
 * The tripwire. Checks only the words WE authored: the business name and the
 * measured figure are removed first, so a client legitimately called
 * "Fast Eddie's Plumbing" cannot trip a guard about our own copy.
 * Returns the offending pattern's match, or null when the subject is clean.
 */
function unsupportedPerfClaim(subject, { businessName = "", measuredLabel = "" } = {}) {
  let rest = String(subject || "");
  for (const literal of [businessName, measuredLabel]) {
    const s = String(literal || "");
    if (s) rest = rest.split(s).join(" ");
  }
  for (const re of PERF_CLAIM_PATTERNS) {
    const m = re.exec(rest);
    if (m) return m[0];
  }
  return null;
}

/**
 * Build a proof-email subject.
 *
 * @param {string} businessName  the client's name, verbatim.
 * @param {number|object|null} measured  the MEASURED load for this build, or
 *        null/omitted when no measurement exists. There is no default.
 * @param {boolean} internalTest  append the internal-test marker.
 * @returns {{subject: string, measuredLabel: string|null, perfClaim: string|null}}
 */
function buildProofEmailSubject({ businessName = "", measured = null, internalTest = false } = {}) {
  const name = String(businessName || "").trim();
  const measuredLabel = measuredLoadLabel(measured);

  const head = name ? `PROOF: ${name} site is live` : "PROOF: your site is live";
  const claims = ["before/after"];
  if (measuredLabel) claims.push(`${measuredLabel} load`);

  let subject = `${head} — ${claims.join(", ")}`;
  if (internalTest) subject += " [INTERNAL TEST]";

  // Fail closed at the source: if no measurement was supplied, nothing we wrote
  // may read as a perf claim. This can only fire on a future edit to the copy
  // above, which is exactly when it should.
  const perfClaim = unsupportedPerfClaim(subject, { businessName: name, measuredLabel: measuredLabel || "" });
  if (!measuredLabel && perfClaim) {
    throw new Error(`proof subject carries an unmeasured performance claim: ${JSON.stringify(perfClaim)}`);
  }

  return { subject, measuredLabel, perfClaim };
}

/** Convenience: the string only. */
function proofEmailSubject(args = {}) {
  return buildProofEmailSubject(args).subject;
}

module.exports = {
  buildProofEmailSubject,
  formatLoadSeconds,
  measuredLoadLabel,
  PERF_CLAIM_PATTERNS,
  proofEmailSubject,
  unsupportedPerfClaim,
};
