"use strict";

// Canonical provider-backed email tracking truth. Keep this pure so the
// console, webhook handling, and tests use the same definitions.
const STAGES = Object.freeze([
  "sent",
  "accepted",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "unsubscribed",
]);

const METRIC_DEFINITIONS = Object.freeze({
  sent: "Distinct Resend message IDs recorded in ghost_agency_email_log with mode=sent and suppressed=false.",
  delivered: "Distinct sent Resend message IDs with a verified Resend email.delivered webhook.",
  opened: "Distinct sent Resend message IDs with a verified Resend email.opened webhook; provider privacy controls can undercount this.",
  clicked: "Distinct sent Resend message IDs with a verified Resend email.clicked webhook.",
  bounced: "Distinct sent Resend message IDs with a verified Resend email.bounced webhook.",
});

const EVENT_METRICS = Object.freeze({
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanId(value) {
  const id = String(value || "").trim();
  return id || "";
}

function emailIdFromLog(row = {}) {
  const payload = object(row.payload);
  return cleanId(payload.resendId || payload.resend_id || payload.email_id || payload.emailId || payload.id);
}

function emailIdFromEvent(row = {}) {
  const payload = object(row.payload);
  const data = object(payload.data);
  return cleanId(
    payload.email_id
      || payload.emailId
      || payload.resendId
      || payload.resend_id
      || payload.id
      || data.email_id
      || data.emailId
      || data.resendId
      || data.resend_id
      || data.id,
  );
}

function eventName(row = {}) {
  const payload = object(row.payload);
  const data = object(payload.data);
  return String(payload.type || payload.event || data.type || data.event || "").trim().toLowerCase();
}

function canonicalStage(type = "", payload = {}) {
  const raw = String(payload.type || type || "").toLowerCase();
  if (/unsubscribe|suppression.*unsubscribe/.test(raw)) return "unsubscribed";
  if (/complain|spam/.test(raw)) return "complained";
  if (/bounce/.test(raw)) return "bounced";
  if (/click/.test(raw)) return "clicked";
  if (/open/.test(raw)) return "opened";
  if (/deliver/.test(raw)) return "delivered";
  if (/accept|queued/.test(raw)) return "accepted";
  if (/send|sent/.test(raw)) return "sent";
  return null;
}

function identity(row = {}) {
  const payload = object(row.payload);
  return cleanId(
    payload.email_id
      || payload.resend_id
      || payload.resendId
      || payload.providerId
      || row.provider_id
      || row.id,
  );
}

function reconcileTracking({ emailLogs = [], events = [], env = process.env } = {}) {
  const sets = Object.fromEntries(STAGES.map((stage) => [stage, new Set()]));
  let anonymous = 0;
  for (const row of emailLogs) {
    const stage = canonicalStage(row.mode || row.status || "sent", row.payload || {});
    if (!stage) continue;
    const id = identity(row);
    id ? sets[stage].add(id) : anonymous++;
  }
  for (const row of events) {
    const stage = canonicalStage(row.type, row.payload || {});
    if (!stage) continue;
    const id = identity(row);
    id ? sets[stage].add(id) : anonymous++;
  }
  const counts = Object.fromEntries(STAGES.map((stage) => [stage, sets[stage].size]));
  const webhookConfigured = Boolean(String(env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET || env.RESEND_WEBHOOK_SECRET || "").trim());
  const sendingDomain = String(env.GHOST_AGENCY_OUTREACH_FROM || env.GHOST_AGENCY_RESEND_FROM || env.RESEND_FROM_EMAIL || "")
    .replace(/^.*@/, "")
    .replace(/[>\s]/g, "");
  const pixelRouteAvailable = true;
  const pixelConfigured = /^(1|true|yes|on)$/i.test(String(env.GHOST_AGENCY_TRACKING_PIXEL_ENABLED || "").trim());
  const linkRewriteConfigured = /^(1|true|yes|on)$/i.test(
    String(env.RESEND_CLICK_TRACKING_ENABLED || env.GHOST_AGENCY_CLICK_TRACKING_ENABLED || "").trim(),
  );
  const linkTrackingObserved = counts.clicked > 0;
  const openTrackingObserved = counts.opened > 0;
  const zeroOpenMeaning = counts.opened > 0
    ? "observed"
    : webhookConfigured && pixelConfigured
      ? "tracked_zero"
      : "untracked";
  return {
    definitions: Object.fromEntries(STAGES.map((stage) => [stage, `unique provider message ids with canonical ${stage} evidence`])),
    counts,
    configuration: {
      webhookConfigured,
      sendingDomain: sendingDomain || null,
      pixelRouteAvailable,
      pixelConfigured,
      linkRewriteConfigured,
      linkTrackingObserved,
      openTrackingObserved,
    },
    zeroOpenMeaning,
    anonymousEvents: anonymous,
    warnings: [
      ...(!webhookConfigured ? ["resend_webhook_unconfigured"] : []),
      ...(!sendingDomain ? ["sending_domain_unknown"] : []),
      ...(!pixelConfigured && !openTrackingObserved ? ["open_tracking_unverified"] : []),
      ...(!linkRewriteConfigured && !linkTrackingObserved ? ["click_tracking_unverified"] : []),
      ...(anonymous ? ["events_missing_provider_message_id"] : []),
    ],
  };
}

function reconcileTrackingTruth({ emails = [], events = [] } = {}) {
  const messages = new Map();
  let sentWithoutProviderId = 0;
  for (const row of emails) {
    if (row?.mode !== "sent" || row?.suppressed) continue;
    const emailId = emailIdFromLog(row);
    if (!emailId) {
      sentWithoutProviderId += 1;
      continue;
    }
    if (!messages.has(emailId)) {
      messages.set(emailId, {
        emailId,
        prospectId: row.prospect_id || null,
        runId: object(row.payload).runId || null,
        metrics: new Set(["sent"]),
      });
    }
  }
  for (const row of events) {
    if (row?.type !== "resend.webhook") continue;
    const metric = EVENT_METRICS[eventName(row)];
    const emailId = emailIdFromEvent(row);
    // Provider events without a matching local send never affect campaign truth.
    if (metric && emailId && messages.has(emailId)) messages.get(emailId).metrics.add(metric);
  }
  const counts = { sent: messages.size, delivered: 0, opened: 0, clicked: 0, bounced: 0 };
  const prospectMetrics = new Map();
  for (const message of messages.values()) {
    for (const metric of Object.keys(counts)) {
      if (metric !== "sent" && message.metrics.has(metric)) counts[metric] += 1;
    }
    if (message.prospectId) {
      if (!prospectMetrics.has(message.prospectId)) prospectMetrics.set(message.prospectId, new Set());
      for (const metric of message.metrics) prospectMetrics.get(message.prospectId).add(metric);
    }
  }
  return {
    counts,
    definitions: METRIC_DEFINITIONS,
    sentWithoutProviderId,
    messages: [...messages.values()].map((message) => ({ ...message, metrics: [...message.metrics] })),
    prospectMetrics,
  };
}

function metricDictionary() {
  return {
    source: "Resend verified webhooks reconciled to ghost_agency_email_log.payload.resendId",
    definitions: METRIC_DEFINITIONS,
    canonicalStages: STAGES,
    canonicalDefinitions: Object.fromEntries(
      STAGES.map((stage) => [stage, `unique provider message ids with canonical ${stage} evidence`]),
    ),
  };
}

module.exports = {
  STAGES,
  canonicalStage,
  emailIdFromEvent,
  emailIdFromLog,
  metricDictionary,
  reconcileTracking,
  reconcileTrackingTruth,
};
