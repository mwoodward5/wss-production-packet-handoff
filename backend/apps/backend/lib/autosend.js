"use strict";

// Legacy SiteForge autosend state.
//
// Consent-first outreach no longer couples "build finished" to "email sent".
// This module remains so the reconciler can find old pending rows, settle them
// durably as abandoned, and prove that no provider call occurred.

const AUTOSEND_KEY = "autosend";

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordOf(row = {}) {
  return isObject(row.record) ? row.record : {};
}

function autosendIntent(row = {}) {
  const intent = recordOf(row)[AUTOSEND_KEY];
  return isObject(intent) ? intent : null;
}

const CONSENT_FIRST_REASON = "consent_first_requires_explicit_post_reply_send";

function settleIntent(intent, status, extra = {}) {
  return { ...(intent || {}), ...extra, status, settled_at: new Date().toISOString() };
}

function abandonPendingAutosend(intent, reason = CONSENT_FIRST_REASON) {
  if (!isObject(intent) || intent.status !== "pending") return intent || null;
  return settleIntent(intent, "abandoned", { reason });
}

// Kept for compatibility with old callers. It intentionally creates a settled
// marker, never a deliverable pending intent.
function newAutosendIntent({ runId = "", sandboxMode = false, now = new Date().toISOString() } = {}) {
  return {
    run_id: String(runId || ""),
    sandbox_mode: sandboxMode === true,
    requested_at: now,
    status: "abandoned",
    reason: CONSENT_FIRST_REASON,
    settled_at: now,
  };
}

// Only deliver an intent that is still pending. Anything already delivered,
// abandoned, or missing is skipped — this is what makes the cron idempotent, so
// a prospect can never be emailed twice by repeated reconcile passes.
function isAutosendPending(row = {}) {
  const intent = autosendIntent(row);
  return Boolean(intent && intent.status === "pending");
}

// Retire one legacy pending intent. This function deliberately never calls the
// email generator or provider, even for a completed SiteForge build.
async function deliverAutosend(row = {}) {
  const intent = autosendIntent(row);
  if (!intent || intent.status !== "pending") {
    return { sent: false, skipped: "not_pending", intent };
  }
  return {
    sent: false,
    skipped: CONSENT_FIRST_REASON,
    intent: abandonPendingAutosend(intent),
  };
}

module.exports = {
  AUTOSEND_KEY,
  CONSENT_FIRST_REASON,
  abandonPendingAutosend,
  autosendIntent,
  newAutosendIntent,
  isAutosendPending,
  deliverAutosend,
};
