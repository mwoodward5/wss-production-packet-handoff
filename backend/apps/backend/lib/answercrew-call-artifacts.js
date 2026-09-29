"use strict";

const ACTIVE_PAID_STATUSES = new Set(["active", "trialing"]);
const PAID_PLANS = new Set(["solo", "crew", "front_office", "agency", "starter", "growth"]);
const RETENTION_DAYS = 14;

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function transcriptText(value, max = 30000) {
  if (Array.isArray(value)) {
    return clean(value.slice(0, 500).map((entry) => {
      const speaker = clean(entry?.role || entry?.speaker || entry?.name || "Speaker", 80) || "Speaker";
      const text = clean(entry?.message ?? entry?.text ?? entry?.content, 2000);
      return text ? `${speaker}: ${text}` : "";
    }).filter(Boolean).join("\n"), max);
  }
  if (value && typeof value === "object") {
    return transcriptText(value.transcript || value.messages || [], max);
  }
  return clean(value, max);
}

function normalizedPlan(value) {
  const raw = clean(value || "", 40).toLowerCase();
  return { starter: "solo", growth: "crew", "front-office": "front_office", frontoffice: "front_office" }[raw] || raw;
}

function activePaidPlan(subscription) {
  const plan = normalizedPlan(subscription?.plan);
  const status = clean(subscription?.status, 60).toLowerCase();
  return Boolean(subscription && ACTIVE_PAID_STATUSES.has(status) && PAID_PLANS.has(plan));
}

function retentionExpiresAt(call = {}) {
  const source = call.ended_at || call.started_at || call.created_at;
  const time = Date.parse(source || "");
  if (!Number.isFinite(time)) return null;
  return new Date(time + RETENTION_DAYS * 86400000).toISOString();
}

function isExpired(expiresAt, now = Date.now()) {
  return Boolean(expiresAt && Date.parse(expiresAt) <= now);
}

function artifactEntitlement(subscription, recordingConsentEnabled = false) {
  const paidActive = activePaidPlan(subscription);
  return {
    included: paidActive,
    plan: normalizedPlan(subscription?.plan) || null,
    subscription_status: clean(subscription?.status, 60).toLowerCase() || null,
    recording_consent_enabled: recordingConsentEnabled === true,
    recording_included: paidActive && recordingConsentEnabled === true,
    transcript_included: paidActive,
    summary_included: paidActive,
    action_items_included: paidActive,
    retention_days: RETENTION_DAYS,
    retention_policy: "fixed_14_day_vapi_build_retention",
    extended_retention_available: false,
  };
}

function mapCallArtifacts(call = {}, subscription, recordingConsentEnabled = false) {
  const entitlement = artifactEntitlement(subscription, recordingConsentEnabled);
  const retention_expires_at = call.artifact_retention_expires_at || retentionExpiresAt(call);
  const expired = isExpired(retention_expires_at);
  const recordingValue = clean(call.recording_url, 2000);
  const hasRecording = Boolean(recordingValue);
  const hasTranscript = Boolean(clean(call.transcript, 30000));
  const hasSummary = Boolean(clean(call.summary, 4000) || call.payload?.analysis?.summary);
  const structured = call.payload?.analysis?.structuredData;
  const hasActionItems = Boolean(
    Array.isArray(structured?.action_items) && structured.action_items.length,
  );
  const canExposeArtifact = entitlement.included && !expired;
  const canExposeRecording = entitlement.recording_included && !expired && hasRecording;
  return {
    entitlement,
    artifact_present: hasRecording || hasTranscript || hasSummary || hasActionItems,
    retention_expires_at,
    expired,
    recording: {
      present: hasRecording,
      available: canExposeRecording,
      playback_url: canExposeRecording ? recordingValue : null,
      reason: !hasRecording
        ? "recording_artifact_not_present"
        : !entitlement.recording_consent_enabled
          ? "recording_consent_not_configured"
          : !entitlement.included
            ? "active_paid_plan_required"
            : expired
              ? "retention_expired"
              : null,
    },
    transcript: {
      present: hasTranscript,
      available: canExposeArtifact && hasTranscript,
      value: canExposeArtifact && hasTranscript ? call.transcript : null,
    },
    summary: {
      present: hasSummary,
      available: canExposeArtifact && hasSummary,
      value: canExposeArtifact ? call.summary || call.payload?.analysis?.summary || null : null,
    },
    action_items: {
      present: hasActionItems,
      available: canExposeArtifact && hasActionItems,
      value: canExposeArtifact ? structured?.action_items || [] : null,
    },
  };
}

module.exports = {
  RETENTION_DAYS,
  activePaidPlan,
  artifactEntitlement,
  isExpired,
  mapCallArtifacts,
  normalizedPlan,
  retentionExpiresAt,
  transcriptText,
};
