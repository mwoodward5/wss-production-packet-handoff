"use strict";

const POSITIVE_STATUSES = new Set([
  "approved",
  "confirmed",
  "granted",
  "interested",
  "opted_in",
  "yes",
]);

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validRecordedAt(value) {
  const timestamp = String(value || "").trim();
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : "";
}

function consentObject(source = {}) {
  for (const key of [
    "preview_build_consent",
    "previewBuildConsent",
    "custom_preview_consent",
    "customPreviewConsent",
  ]) {
    if (isObject(source[key])) return source[key];
  }
  const nested = isObject(source.consent) ? source.consent : {};
  return isObject(nested.preview_build)
    ? nested.preview_build
    : isObject(nested.previewBuild)
      ? nested.previewBuild
      : {};
}

function recordedPositivePreviewConsent(prospect = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  for (const source of [prospect, record]) {
    const consent = consentObject(source);
    const status = String(
      consent.status
      || consent.state
      || source.preview_build_consent_status
      || source.previewBuildConsentStatus
      || "",
    ).trim().toLowerCase();
    const recordedAt = validRecordedAt(
      consent.recorded_at
      || consent.recordedAt
      || consent.granted_at
      || consent.grantedAt
      || source.preview_build_consent_at
      || source.previewBuildConsentAt,
    );
    const positive = consent.granted === true
      || consent.approved === true
      || POSITIVE_STATUSES.has(status);

    // A boolean or an LLM intent alone is not durable consent. Require both a
    // positive decision and a stored timestamp so build automation fails closed.
    if (positive && recordedAt) {
      return {
        ok: true,
        status: status || "granted",
        recordedAt,
        source: String(consent.source || source.preview_build_consent_source || "").trim() || "recorded_prospect_state",
      };
    }
  }

  return {
    ok: false,
    status: "missing",
    recordedAt: "",
    source: "",
    reason: "recorded_positive_preview_consent_required",
  };
}

function hasRecordedPositivePreviewConsent(prospect = {}) {
  return recordedPositivePreviewConsent(prospect).ok;
}

module.exports = {
  hasRecordedPositivePreviewConsent,
  recordedPositivePreviewConsent,
};
