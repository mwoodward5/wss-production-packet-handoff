"use strict";

const BLOCKER_COPY = {
  intake_genie_blocked: ["Business intake", "The business research service could not finish.", "Confirm the submitted URL is public and the intake service is configured, then retry."],
  siteforge_public_surface_not_release_ready: ["Preview quality review", "The preview did not pass every public-site release check.", "Open the failed SiteForge checks, correct the missing evidence, and run quality review again."],
  supervised_10_review_pending: ["Owner review", "The supervised ten-client batch is waiting for owner review.", "Review the held batch. Keep delivery paused until the owner explicitly approves it."],
  report_required: ["Visibility report", "The GetFound report is not ready yet.", "Generate and verify the report before composing outreach."],
  preview_required: ["Preview build", "The public preview is not ready yet.", "Finish the V8/WSS Launch preview and pass its release checks."],
};

function text(value) { return String(value == null ? "" : value).trim(); }
function codeFrom(payload = {}) {
  return text(payload.code || payload.blockedCode || payload.blocked_code || payload.blocked || payload.reason_code || payload.reason);
}
function prospectIdFrom(event = {}, payload = {}) {
  return text(payload.prospectId || payload.prospect_id || event.prospect_id);
}
function isBlocked(event = {}, payload = {}) {
  const haystack = `${event.type || ""} ${payload.status || ""} ${payload.result || ""} ${codeFrom(payload)}`.toLowerCase();
  return /block|fail|error|not_release_ready|review_pending/.test(haystack);
}

function blockerFromEvent(event, names = {}) {
  const payload = event && event.payload && typeof event.payload === "object" ? event.payload : {};
  if (!isBlocked(event, payload)) return null;
  const code = codeFrom(payload) || text(event.type) || "unknown_blocker";
  const known = BLOCKER_COPY[code];
  const prospectId = prospectIdFrom(event, payload);
  const stage = text(payload.stage || payload.failedStage || payload.failed_stage || (known && known[0]) || event.type || "Pipeline");
  const reason = text(payload.userMessage || payload.user_message || (known && known[1]) || payload.message || payload.reason || "This job needs attention before it can continue.");
  const safeNextAction = text(payload.safeNextAction || payload.safe_next_action || (known && known[2]) || "Inspect the failed requirement, correct it, then run the stage again.");
  const requirementSatisfied = payload.requirementSatisfied === true || payload.requirement_satisfied === true;
  return {
    id: text(event.id) || `${text(event.type) || "event"}:${prospectId || "system"}:${text(event.created_at) || "unknown"}`,
    prospectId: prospectId || null,
    prospect: names[prospectId] || text(payload.businessName || payload.business_name) || "System",
    failedStage: stage,
    reason,
    code,
    timestamp: event.created_at || payload.timestamp || null,
    retryEligible: requirementSatisfied,
    safeNextAction,
  };
}

function actionableBlockers({ events = [], hardStops = [], names = {} } = {}) {
  const result = events.map((event) => blockerFromEvent(event, names)).filter(Boolean);
  hardStops.forEach((stop, index) => result.push({
    id: `system:${index}:${text(stop).slice(0, 60)}`,
    prospectId: null,
    prospect: "System",
    failedStage: "System readiness",
    reason: text(stop),
    code: "system_requirement_missing",
    timestamp: null,
    retryEligible: false,
    safeNextAction: "Correct the named system requirement. Retry is unavailable until the readiness check passes.",
  }));
  const seen = new Set();
  return result.filter((item) => {
    const key = `${item.prospectId || "system"}|${item.failedStage}|${item.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { BLOCKER_COPY, actionableBlockers, blockerFromEvent };
