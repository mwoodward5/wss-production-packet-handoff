"use strict";

// Read-only, aggregate-only campaign truth for /ledger. The source rows contain
// contact and provider identifiers; those values are used only to reconcile
// events in memory and never cross this response boundary.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { select } = require("../../lib/store");

const EMAIL_TABLE = "ghost_agency_email_log";
const EVENT_TABLE = "ghost_agency_events";
const PAGE_SIZE = 1000;
const MAX_SOURCE_ROWS = 20000;
const EMPTY = "No tracked sends yet — this fills as campaigns go out.";
const EVENT_TYPES = [
  "resend.webhook",
  "reply.draft",
  "line.batch",
  "campaign.run",
  "system.run",
  "cron.run",
];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function iso(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function dayKey(value) {
  const valueIso = iso(value);
  return valueIso ? valueIso.slice(0, 10) : "";
}

function percent(part, whole) {
  if (!whole) return null;
  return Math.round((Number(part || 0) / whole) * 1000) / 10;
}

function sourceError(code = "ledger_source_unavailable", statusCode = 503) {
  const error = new Error(code === "ledger_source_limit"
    ? "The selected ledger history is too large to total safely."
    : "Campaign ledger source data is temporarily unavailable.");
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/**
 * Page a PostgREST source with a stable two-column order. Reaching the cap is
 * deliberately an error: totals are never presented as complete when the
 * source might contain another row.
 */
async function readAllRows(table, options = {}) {
  const read = options.select || select;
  const pageSize = Math.max(1, Number(options.pageSize) || PAGE_SIZE);
  const maxRows = Math.max(pageSize, Number(options.maxRows) || MAX_SOURCE_ROWS);
  const selectFields = text(options.selectFields || "id", 1000);
  const order = text(options.order || `${options.timeColumn || "created_at"}.asc,id.asc`, 200);
  const filters = Array.isArray(options.filters) ? options.filters.filter(Boolean) : [];
  const rows = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const query = [
      `select=${selectFields}`,
      ...filters,
      `order=${order}`,
      `limit=${pageSize}`,
      `offset=${offset}`,
    ].join("&");
    let result;
    try {
      result = await read(table, query);
    } catch {
      throw sourceError();
    }
    if (result?.ok !== true || !Array.isArray(result.data)) throw sourceError();
    rows.push(...result.data);
    if (rows.length >= maxRows) throw sourceError("ledger_source_limit", 413);
    if (result.data.length < pageSize) return rows;
  }
  throw sourceError("ledger_source_limit", 413);
}

function emailIdFromLog(row) {
  const value = object(row?.payload);
  return text(value.resendId || value.resend_id || value.email_id || value.emailId, 240);
}

function emailIdFromEvent(row) {
  const value = object(row?.payload);
  return text(value.email_id || value.emailId || value.resendId || value.resend_id, 240);
}

function eventName(row) {
  const value = object(row?.payload);
  return text(value.type || value.event, 80).toLowerCase();
}

function runIdFrom(value) {
  const payload = object(value?.payload || value);
  return text(payload.runId || payload.run_id || payload.campaignId || payload.campaign_id, 120);
}

function ownerOrSandboxSend(row) {
  const payload = object(row?.payload);
  const lane = text(
    payload.deliveryLane || payload.delivery_lane || payload.lane || payload.mode,
    80,
  ).toLowerCase();
  return payload.ownerProof === true
    || payload.owner_proof === true
    || payload.internalOwnerProof === true
    || payload.internal_owner_proof === true
    || payload.sandbox === true
    || payload.sandboxMode === true
    || payload.isProspectSend === false
    || payload.is_prospect_send === false
    || /owner.*proof|proof.*owner|owner[_ -]?only|sandbox|internal[_ -]?proof/.test(lane);
}

function eligibleEmail(row) {
  return text(row?.mode, 40).toLowerCase() === "sent"
    && row?.suppressed !== true
    && !ownerOrSandboxSend(row)
    && Boolean(iso(row?.sent_at));
}

function rowStatusSent(row) {
  if (text(row?.status, 40).toLowerCase() === "sent") return true;
  return Array.isArray(row?.history)
    && row.history.some((item) => text(item?.status, 40).toLowerCase() === "sent");
}

function lineCampaigns(events) {
  const campaigns = new Map();
  const prospects = new Map();
  const latest = new Map();
  for (const event of events) {
    if (event?.type !== "line.batch") continue;
    const payload = object(event.payload);
    const batch = object(payload.batch);
    const id = text(batch.batchId || payload.batchId, 120);
    if (!id) continue;
    const at = iso(event.created_at);
    const prior = latest.get(id);
    if (!prior || at >= prior.at) latest.set(id, { id, at, event, batch });
  }
  for (const snapshot of latest.values()) {
    const { id, at, event, batch } = snapshot;
    campaigns.set(id, {
      id,
      // Batch targets are operator-entered free text. Keep them behind the
      // aggregate boundary; generated batch IDs are the non-contact label.
      name: `Line batch ${id.slice(-8)}`,
      status: text(batch.status || event.status, 60) || "Recorded",
      at,
    });
    for (const row of Array.isArray(batch.rows) ? batch.rows : []) {
      const prospect = text(row?.prospectId || row?.prospect_id, 180);
      if (!prospect || !rowStatusSent(row)) continue;
      if (!prospects.has(prospect)) prospects.set(prospect, new Map());
      const sentHistory = (Array.isArray(row?.history) ? row.history : [])
        .filter((item) => text(item?.status, 40).toLowerCase() === "sent")
        .map((item) => iso(item?.at || item?.created_at))
        .filter(Boolean)
        .sort();
      prospects.get(prospect).set(id, sentHistory.at(-1) || at);
    }
  }
  return { campaigns, prospects };
}

function runCampaigns(events) {
  const out = new Map();
  for (const event of events) {
    if (!["campaign.run", "system.run", "cron.run"].includes(event?.type)) continue;
    const payload = object(event.payload);
    const id = runIdFrom(payload);
    if (!id) continue;
    const at = iso(event.created_at);
    const prior = out.get(id);
    if (prior && prior.at > at) continue;
    out.set(id, {
      id,
      // Campaign labels in stored events are free text. Use generated run IDs
      // for grouping while returning only a generic, contact-free label.
      name: /^drip_/i.test(id)
        ? "Scheduled follow-up"
        : /^fullrun_/i.test(id)
          ? "Full pipeline run"
          : `Campaign ${id.slice(-8)}`,
      status: text(event.status || payload.status, 60) || "Recorded",
      at,
    });
  }
  return out;
}

function safeStatus(value) {
  const status = text(value, 40).toLowerCase().replace(/[_-]+/g, " ");
  const known = new Map([
    ["active", "Active"], ["live", "Live"], ["running", "Running"],
    ["queued", "Queued"], ["paused", "Paused"], ["complete", "Complete"],
    ["completed", "Completed"], ["ok", "Complete"], ["failed", "Failed"],
    ["error", "Failed"], ["stopped", "Stopped"], ["recorded", "Recorded"],
  ]);
  return known.get(status) || "Recorded";
}

function aggregateLedger({ emails = [], events = [], now = () => new Date() } = {}) {
  const warnings = [];
  const seenWarnings = new Set();
  const warn = (message) => {
    if (!seenWarnings.has(message)) {
      seenWarnings.add(message);
      warnings.push(message);
    }
  };

  const line = lineCampaigns(events);
  const runMeta = runCampaigns(events);
  const campaignMeta = new Map([...line.campaigns, ...runMeta]);
  const messages = new Map();
  const campaignRows = new Map();
  const sendsByProspect = new Map();
  let missingProvider = 0;

  const ensureCampaign = (id) => {
    const key = id || "unassigned";
    if (!campaignRows.has(key)) {
      const meta = campaignMeta.get(key);
      campaignRows.set(key, {
        id: key,
        name: meta?.name || (key === "unassigned" ? "Other tracked sends" : `Campaign ${key.slice(-8)}`),
        source: campaignMeta.has(key) ? (line.campaigns.has(key) ? "line batch" : "stored run") : "recorded send",
        status: safeStatus(meta?.status),
        sent: 0,
        opens: 0,
        clicks: 0,
        replies: 0,
        activityAt: meta?.at || "",
        events: [],
      });
    }
    return campaignRows.get(key);
  };

  for (const row of emails) {
    if (!eligibleEmail(row)) continue;
    const provider = emailIdFromLog(row);
    const dedupe = provider ? `provider:${provider}` : `record:${text(row.id, 240) || `${iso(row.sent_at)}:${messages.size}`}`;
    if (messages.has(dedupe)) continue;
    if (!provider) missingProvider += 1;

    const prospect = text(row.prospect_id, 180);
    const sentAt = iso(row.sent_at);
    const explicit = runIdFrom(row.payload);
    const inferred = prospect ? line.prospects.get(prospect) : null;
    const sendTime = Date.parse(sentAt);
    const candidateBatches = inferred
      ? [...inferred.entries()].filter(([, evidenceAt]) => {
        const evidenceTime = Date.parse(evidenceAt || "");
        return Number.isFinite(evidenceTime)
          && Math.abs(sendTime - evidenceTime) <= 24 * 60 * 60 * 1000;
      }).map(([id]) => id)
      : [];
    let campaignId = explicit;
    if (!campaignId && candidateBatches.length === 1) campaignId = candidateBatches[0];
    if (!campaignId && candidateBatches.length > 1) warn("Some sends have an ambiguous line-batch match, so they remain unassigned.");
    campaignId ||= "unassigned";

    const message = {
      key: dedupe,
      provider,
      prospect,
      campaignId,
      sentAt,
      step: Number.isFinite(Number(row.step)) ? Number(row.step) : null,
      openedAt: "",
      clickedAt: "",
    };
    messages.set(dedupe, message);
    if (provider) message.providerKey = provider;

    const campaign = ensureCampaign(campaignId);
    campaign.sent += 1;
    if (sentAt > campaign.activityAt) campaign.activityAt = sentAt;
    campaign.events.push({
      stage: "sent",
      at: sentAt,
      label: message.step == null ? "Send recorded" : `Send recorded · step ${message.step}`,
    });
    if (prospect) {
      if (!sendsByProspect.has(prospect)) sendsByProspect.set(prospect, []);
      sendsByProspect.get(prospect).push(message);
    }
  }
  for (const prospectSends of sendsByProspect.values()) {
    prospectSends.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }

  if (missingProvider) {
    warn(`${missingProvider} recorded send${missingProvider === 1 ? " is" : "s are"} missing a provider message ID; engagement cannot be matched to ${missingProvider === 1 ? "it" : "them"}.`);
  }

  const byProvider = new Map();
  for (const message of messages.values()) {
    if (message.provider) byProvider.set(message.provider, message);
  }

  let unmatchedProvider = 0;
  let anonymousProvider = 0;
  const providerEvents = events
    .filter((row) => row?.type === "resend.webhook")
    .slice()
    .sort((a, b) => iso(a.created_at).localeCompare(iso(b.created_at)));
  for (const row of providerEvents) {
    const name = eventName(row);
    const stage = name === "email.opened" ? "opened" : name === "email.clicked" ? "clicked" : "";
    if (!stage) continue;
    const provider = emailIdFromEvent(row);
    if (!provider) {
      anonymousProvider += 1;
      continue;
    }
    const message = byProvider.get(provider);
    if (!message) {
      unmatchedProvider += 1;
      continue;
    }
    const field = stage === "opened" ? "openedAt" : "clickedAt";
    if (message[field]) continue;
    const at = iso(row.created_at);
    if (!at) continue;
    message[field] = at;
    const campaign = ensureCampaign(message.campaignId);
    const countField = stage === "opened" ? "opens" : "clicks";
    campaign[countField] += 1;
    if (at > campaign.activityAt) campaign.activityAt = at;
    campaign.events.push({ stage, at, label: stage === "opened" ? "Open recorded" : "Click recorded" });
  }
  if (unmatchedProvider) warn(`${unmatchedProvider} provider event${unmatchedProvider === 1 ? " has" : "s have"} no matching recorded send and were not counted.`);
  if (anonymousProvider) warn(`${anonymousProvider} engagement event${anonymousProvider === 1 ? " is" : "s are"} missing a provider message ID and were not counted.`);

  const replies = new Map();
  const seenReplyIds = new Set();
  const replyEvents = events
    .filter((row) => row?.type === "reply.draft")
    .slice()
    .sort((a, b) => iso(a.created_at).localeCompare(iso(b.created_at)));
  let ambiguousReplies = 0;
  let orphanReplies = 0;
  for (const row of replyEvents) {
    const payload = object(row.payload);
    if ([payload.trigger, payload.intent].some((value) => text(value, 80).toLowerCase() === "report_viewed")) continue;
    const replyId = text(payload.inboundId || payload.inbound_id || payload.draftId || payload.draft_id, 240);
    if (!replyId || seenReplyIds.has(replyId)) continue;
    seenReplyIds.add(replyId);
    const at = iso(row.created_at);
    if (!at) continue;
    const prospect = text(payload.prospectId || payload.prospect_id, 180);
    const priorSends = (prospect ? sendsByProspect.get(prospect) : null) || [];
    const eligiblePrior = priorSends.filter((message) => message.sentAt <= at);
    if (!prospect || !eligiblePrior.length) {
      orphanReplies += 1;
      continue;
    }
    // Conversion grain is unique sent prospects, not raw inbound messages.
    // A second reply from the same prospect remains in the protected source
    // but cannot inflate the funnel or a campaign row.
    if (replies.has(prospect)) continue;
    replies.set(prospect, { at });

    const priorCampaigns = new Set(eligiblePrior.map((message) => message.campaignId));
    // A reply may be attributed only when its prospect has one possible prior
    // campaign. Global reply truth remains visible even when that join is not.
    if (priorCampaigns.size === 1) {
      const campaign = ensureCampaign([...priorCampaigns][0]);
      campaign.replies += 1;
      if (at > campaign.activityAt) campaign.activityAt = at;
      campaign.events.push({ stage: "replied", at, label: "Reply received" });
    } else if (priorCampaigns.size > 1) {
      ambiguousReplies += 1;
    }
  }
  if (ambiguousReplies) warn(`${ambiguousReplies} repl${ambiguousReplies === 1 ? "y is" : "ies are"} ambiguous across campaigns and was not assigned to a row.`);
  if (orphanReplies) warn(`${orphanReplies} repl${orphanReplies === 1 ? "y has" : "ies have"} no prior eligible send and was not counted.`);

  const sent = messages.size;
  const opened = [...messages.values()].filter((item) => item.openedAt).length;
  const clicked = [...messages.values()].filter((item) => item.clickedAt).length;
  const replied = replies.size;
  const summary = { sent };
  if (opened) summary.opened = opened;
  if (clicked) summary.clicked = clicked;
  if (replied) summary.replied = replied;

  const funnel = [];
  if (sent) funnel.push({ stage: "sent", label: "Sent", count: sent, rate: 100 });
  if (opened) funnel.push({ stage: "opened", label: "Opened", count: opened, rate: percent(opened, sent) });
  if (clicked) funnel.push({ stage: "clicked", label: "Clicked", count: clicked, rate: percent(clicked, sent) });
  if (replied) funnel.push({ stage: "replied", label: "Replied", count: replied, rate: percent(replied, sent) });

  const seriesMap = new Map();
  const addSeries = (at, stage) => {
    const date = dayKey(at);
    if (!date) return;
    if (!seriesMap.has(date)) seriesMap.set(date, { date });
    const item = seriesMap.get(date);
    item[stage] = (item[stage] || 0) + 1;
  };
  for (const message of messages.values()) {
    addSeries(message.sentAt, "sent");
    if (message.openedAt) addSeries(message.openedAt, "opened");
    if (message.clickedAt) addSeries(message.clickedAt, "clicked");
  }
  for (const reply of replies.values()) addSeries(reply.at, "replied");
  const seriesDays = [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const observed = {
    opened: opened > 0,
    clicked: clicked > 0,
    replied: replied > 0,
  };
  const campaigns = [...campaignRows.values()]
    .filter((campaign) => campaign.sent > 0)
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      source: campaign.source,
      status: campaign.status,
      sent: campaign.sent,
      ...(observed.opened ? { opens: campaign.opens, openRate: percent(campaign.opens, campaign.sent) } : {}),
      ...(observed.clicked ? { clicks: campaign.clicks, clickRate: percent(campaign.clicks, campaign.sent) } : {}),
      replies: campaign.replies,
      activityAt: campaign.activityAt || null,
      events: campaign.events
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 100),
    }))
    .sort((a, b) => String(b.activityAt || "").localeCompare(String(a.activityAt || "")) || a.name.localeCompare(b.name));

  const activity = campaigns
    .flatMap((campaign) => campaign.events.map((item) => ({
      stage: item.stage,
      at: item.at,
      label: item.label,
      campaign: campaign.name,
    })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 24);

  const trackingTimes = [
    ...messages.values().map((item) => item.sentAt),
    ...messages.values().flatMap((item) => [item.openedAt, item.clickedAt]),
    ...replies.values().map((item) => item.at),
  ].filter(Boolean).sort();
  const trackingBegan = trackingTimes[0] || null;
  const clockValue = now();
  const generatedAt = clockValue instanceof Date ? clockValue.toISOString() : new Date(clockValue).toISOString();

  return {
    ok: true,
    generatedAt,
    empty: sent ? null : EMPTY,
    summary,
    funnel,
    series: { available: seriesDays.length > 0, days: seriesDays },
    campaigns,
    activity,
    source: {
      trackingBegan,
      trackingStatus: trackingBegan
        ? `Recorded history starts ${trackingBegan.slice(0, 10)}.`
        : "Tracking starts with the first recorded prospect send.",
      definitions: {
        sent: "Distinct recorded prospect sends; provider message IDs are used to remove duplicate records when present.",
        opened: "Distinct sent messages with a verified Resend open event.",
        clicked: "Distinct sent messages with a verified Resend click event.",
        replied: "Distinct sent prospects with at least one inbound reply; repeats and system-generated report-view drafts are excluded.",
      },
      warnings,
    },
  };
}

function createLedgerDataHandler(overrides = {}) {
  const guard = overrides.methodGuard || methodGuard;
  const auth = overrides.requireAdmin || requireAdmin;
  const read = overrides.select || select;
  const clock = overrides.now || (() => new Date());

  return async function ledgerDataHandler(req, res) {
    if (!guard(req, res, ["GET"])) return;
    if (!(await auth(req, res))) return;
    try {
      const [emails, events] = await Promise.all([
        readAllRows(EMAIL_TABLE, {
          select: read,
          selectFields: "id,prospect_id,sequence,step,sent_at,suppressed,mode,payload",
          order: "sent_at.asc,id.asc",
          timeColumn: "sent_at",
          filters: ["mode=eq.sent", "suppressed=not.is.true"],
        }),
        readAllRows(EVENT_TABLE, {
          select: read,
          // ghost_agency_events is (id, type, payload, created_at, svix_id).
          // It has never had a `status` column, so asking for one made
          // PostgREST answer 42703 on EVERY request — which readAllRows turns
          // into ledger_source_unavailable, which is why /ledger has been
          // answering 503 and refusing to open. A run's status lives in the
          // payload; `event.status` in campaignSnapshots was always undefined
          // and falls through to `batch.status` exactly as before.
          selectFields: "id,type,created_at,payload",
          order: "created_at.asc,id.asc",
          timeColumn: "created_at",
          filters: [`type=in.(${EVENT_TYPES.join(",")})`],
        }),
      ]);
      sendJson(res, 200, aggregateLedger({ emails, events, now: clock }));
    } catch (error) {
      if (error?.code === "ledger_source_limit" || error?.code === "ledger_source_unavailable") {
        sendJson(res, error.statusCode || 503, { ok: false, error: error.code });
        return;
      }
      handleError(res, error);
    }
  };
}

module.exports = createLedgerDataHandler();
module.exports.aggregateLedger = aggregateLedger;
module.exports.createLedgerDataHandler = createLedgerDataHandler;
module.exports.readAllRows = readAllRows;
module.exports.EMPTY = EMPTY;
