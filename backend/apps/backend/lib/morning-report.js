"use strict";

// One read-only truth packet powers both the owner email and the Operations
// panel. Every count below comes from a durable row inside an explicit
// half-open window: start <= timestamp < end. An unavailable source is `null`,
// never a reassuring-looking zero.

const { deliveryPauseStatus: defaultDeliveryPauseStatus } = require("./delivery-pause");
const { sendResendEmail: defaultSendResendEmail } = require("./email");
const { select: defaultSelect } = require("./store");
const {
  FONT_STACK,
  PALETTE,
  WSS_MARK_URL,
  cardStyle,
} = require("./wss-email-design");
const { pendingDraftsFromEvents } = require("../api/admin/reply-queue");

const OWNER_EMAIL = "woodwardsoftware@gmail.com";
const MORNING_REPORT_EVENT = "morning_report.run";
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;
const REPLY_EVENT_LIMIT = 5000;
const PROSPECT_NAME_LIMIT = 1000;
// Vercel cron handlers can run for 300 seconds. Six minutes covers that plus
// ordinary trigger lag without reaching the next siteforge 10-minute slot.
const CRON_POST_SLOT_TOLERANCE_MS = 6 * 60 * 1000;
const RILEY_ASSISTANT_FALLBACK = "5b5e73a3-2bd7-4777-8233-077bf7ffddc6";

// `evidence` names the only durable signal that can prove a run fired. Jobs
// without one are UNKNOWN when due, not silently accused of missing a run.
const CRON_ROSTER = Object.freeze([
  Object.freeze({ job: "daily-mining", schedule: "0 */4 * * *", evidence: "scheduled_mine_run" }),
  Object.freeze({ job: "nightly-pipeline", schedule: "30 */2 * * *", evidence: "cron.run" }),
  Object.freeze({ job: "drip-scheduler", schedule: "0 16,20 * * 1-5", evidence: "cron.run" }),
  Object.freeze({ job: "retention-monthly", schedule: "0 15 1 * *", evidence: "cron.run" }),
  Object.freeze({ job: "customer-call-artifact-retention", schedule: "15 3 * * *", evidence: null }),
  Object.freeze({ job: "siteforge-reconcile", schedule: "*/10 * * * *", evidence: "cron.run" }),
  Object.freeze({ job: "run-edit-jobs", schedule: "*/2 * * * *", evidence: null }),
]);

const EVENT_TYPES = Object.freeze([
  "mine.run",
  "line.batch",
  "system.run",
  "cron.run",
  "vapi_webhook",
  "vapi_customer_webhook",
  "siteforge.callback",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 180) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

function count(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function measuredCount(value) {
  return value != null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function asDate(value, fallback) {
  const raw = typeof value === "function" ? value() : value;
  const date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw == null ? fallback : raw);
  if (Number.isNaN(date.getTime())) throw new TypeError("morning_report_invalid_date");
  return date;
}

function inWindow(value, startMs, endMs) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) && at >= startMs && at < endMs;
}

function queryWindow(column, start, end) {
  return `${column}=gte.${encodeURIComponent(start)}&${column}=lt.${encodeURIComponent(end)}`;
}

function normalizeRead(result) {
  if (Array.isArray(result)) return { known: true, rows: result, reason: "" };
  if (result && result.ok === true && Array.isArray(result.data)) {
    return { known: true, rows: result.data, reason: "" };
  }
  if (result && result.mode === "live_select" && Array.isArray(result.rows)) {
    return { known: true, rows: result.rows, reason: "" };
  }
  return {
    known: false,
    rows: [],
    reason: text(result?.skipped || result?.error?.code || result?.error || result?.mode || "source_unavailable", 120),
  };
}

async function selectRows(table, query, selectFn) {
  try {
    return normalizeRead(await selectFn(table, query));
  } catch (error) {
    return { known: false, rows: [], reason: text(error?.code || error?.message || error, 120) || "source_unavailable" };
  }
}

async function selectAllRows(table, baseQuery, { order, idColumn }, selectFn) {
  const rows = [];
  let offset = 0;
  let previousPage = "";
  for (;;) {
    const query = `${baseQuery}&order=${order},${idColumn}.${order.endsWith(".desc") ? "desc" : "asc"}`
      + `&limit=${PAGE_SIZE}&offset=${offset}`;
    const page = await selectRows(table, query, selectFn);
    if (!page.known) return { known: false, rows, bounded: false, exhausted: false, reason: page.reason };
    if (page.rows.length > PAGE_SIZE) {
      return { known: false, rows, bounded: true, exhausted: false, reason: "provider returned more rows than the requested page" };
    }
    const signature = page.rows.length
      ? `${text(page.rows[0]?.[idColumn], 160)}:${text(page.rows.at(-1)?.[idColumn], 160)}:${page.rows.length}`
      : "empty";
    if (offset > 0 && signature !== "empty" && signature === previousPage) {
      return { known: false, rows, bounded: true, exhausted: false, reason: "provider pagination did not advance" };
    }
    rows.push(...page.rows);
    if (page.rows.length < PAGE_SIZE) return { known: true, rows, bounded: false, exhausted: true, reason: "" };
    previousPage = signature;
    offset += page.rows.length;
  }
}

function successfulMarker(row) {
  if (!row || row.type !== MORNING_REPORT_EVENT) return false;
  const payload = object(row.payload);
  const status = text(payload.status || payload.result || payload.mode, 40).toLowerCase();
  const providerMode = text(payload.providerMode || payload.sendMode || payload.send?.mode, 40).toLowerCase();
  return payload.sent === true
    || ["sent", "ok", "success", "succeeded", "complete", "completed"].includes(status)
    || providerMode === "sent";
}

async function readMorningMarkers(end, selectFn) {
  const query = `?select=id,type,payload,created_at&type=eq.${encodeURIComponent(MORNING_REPORT_EVENT)}`
    + `&created_at=lt.${encodeURIComponent(end.toISOString())}&order=created_at.desc&limit=30`;
  const read = await selectRows("ghost_agency_events", query, selectFn);
  return { ...read, marker: null };
}

function sameDayStoredReport(markerRead, end) {
  if (!markerRead?.known) return null;
  const reportDate = end.toISOString().slice(0, 10);
  const row = markerRead.rows.find((candidate) => {
    const payload = object(candidate?.payload);
    const markerDate = text(payload.date || candidate?.created_at, 40).slice(0, 10);
    const report = object(payload.report);
    return markerDate === reportDate
      && report.date === reportDate
      && object(report.window).halfOpen === true
      && object(report.totals);
  });
  if (!row) return null;
  // The stored packet is the email's exact content. Return an isolated copy so
  // a panel caller cannot mutate the marker object held by a test or cache.
  return JSON.parse(JSON.stringify(row.payload.report));
}

function previousSuccessfulMarker(markerRead, end) {
  if (!markerRead?.known) return null;
  const reportDate = end.toISOString().slice(0, 10);
  return markerRead.rows.find((row) => {
    const payload = object(row?.payload);
    const markerDate = text(payload.date || row?.created_at, 40).slice(0, 10);
    return markerDate < reportDate && successfulMarker(row);
  }) || null;
}

async function resolveMorningWindow(input, deps, selectFn, preloadedMarkerRead = null) {
  const defaultNow = typeof deps.now === "function" ? deps.now() : (deps.now == null ? Date.now() : deps.now);
  const end = asDate(input.until, defaultNow);
  const floor = new Date(end.getTime() - MAX_WINDOW_MS);
  if (input.since != null) {
    const requested = asDate(input.since, floor);
    const start = requested < floor ? floor : requested;
    if (start >= end) throw new RangeError("morning_report_window_must_be_positive");
    return {
      start,
      end,
      basis: requested < floor ? "explicit_capped_24h" : "explicit",
      markerRead: { known: true, rows: [], marker: null, reason: "not_needed_for_explicit_window" },
    };
  }

  const markerRead = preloadedMarkerRead || await readMorningMarkers(end, selectFn);
  const marker = previousSuccessfulMarker(markerRead, end);
  const markerPayload = object(marker?.payload);
  const previousEnd = object(markerPayload.report).window?.end || object(markerPayload.window).end || marker?.created_at;
  const markerAt = marker ? new Date(previousEnd) : null;
  const usableMarker = markerAt && !Number.isNaN(markerAt.getTime()) && markerAt < end;
  const start = usableMarker && markerAt > floor ? markerAt : floor;
  return {
    start,
    end,
    basis: usableMarker && markerAt > floor ? "previous_success" : "24h_cap",
    markerRead,
  };
}

function source(id, read, limit = 0) {
  const rows = Array.isArray(read?.rows) ? read.rows.length : 0;
  return {
    id,
    known: read?.known === true,
    rows,
    bounded: read?.bounded === true || Boolean(!read?.exhausted && limit && rows >= limit),
    reason: read?.known === true ? "" : text(read?.reason || "source_unavailable", 120),
  };
}

function lossGroups(mineRuns) {
  const byStage = new Map();
  for (const row of mineRuns) {
    const payload = object(row.payload);
    const persisted = object(payload.rejects);
    const groups = Array.isArray(persisted.groups) ? persisted.groups : [];
    const groupTotal = groups.reduce((sum, group) => sum + (count(group?.count) || 0), 0);
    const persistedTotal = count(persisted.total);
    const truncated = (count(persisted.groupsTruncated) || 0) > 0;
    const groupsComplete = groups.length
      && !truncated
      && (persistedTotal == null || groupTotal === persistedTotal);
    if (groupsComplete) {
      for (const group of groups) {
        const stage = text(group?.stage || "unknown", 90) || "unknown";
        const reason = text(group?.reason || "unstated", 120) || "unstated";
        const amount = count(group?.count);
        if (amount == null || amount === 0) continue;
        if (!byStage.has(stage)) byStage.set(stage, new Map());
        const reasons = byStage.get(stage);
        reasons.set(reason, (reasons.get(reason) || 0) + amount);
      }
      continue;
    }

    // Older durable events predate the grouped reject packet. Their funnel is
    // still exact at stage/reason level, so use it without inventing examples.
    for (const stageRow of Array.isArray(payload.funnel) ? payload.funnel : []) {
      const stage = text(stageRow?.stage || "unknown", 90) || "unknown";
      const rejected = object(stageRow?.rejected);
      for (const [rawReason, rawAmount] of Object.entries(rejected)) {
        const amount = count(rawAmount);
        if (amount == null || amount === 0) continue;
        const reason = text(rawReason || "unstated", 120) || "unstated";
        if (!byStage.has(stage)) byStage.set(stage, new Map());
        const reasons = byStage.get(stage);
        reasons.set(reason, (reasons.get(reason) || 0) + amount);
      }
    }
  }

  return [...byStage.entries()].map(([stage, reasons]) => {
    const list = [...reasons.entries()]
      .map(([reason, amount]) => ({ reason, count: amount }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
    return { stage, count: list.reduce((sum, item) => sum + item.count, 0), reasons: list };
  }).sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage));
}

function lossCoverage(mineRuns) {
  const issues = [];
  for (const row of mineRuns) {
    const payload = object(row.payload);
    const persisted = object(payload.rejects);
    const groups = Array.isArray(persisted.groups) ? persisted.groups : [];
    const funnel = Array.isArray(payload.funnel) ? payload.funnel : [];
    const groupTotal = groups.reduce((sum, group) => sum + (count(group?.count) || 0), 0);
    const funnelTotal = funnel.reduce((sum, stage) => sum + Object.values(object(stage?.rejected))
      .reduce((stageSum, value) => stageSum + (count(value) || 0), 0), 0);
    const persistedTotal = count(persisted.total);
    const legacyTotal = count(payload.rejected);
    const truncated = (count(persisted.groupsTruncated) || 0) > 0;
    const expected = persistedTotal == null ? legacyTotal : persistedTotal;
    const groupsPresent = groups.length > 0;
    const funnelPresent = funnel.length > 0;
    const hasExactGroups = groupsPresent && !truncated && (expected == null || groupTotal === expected);
    const hasExactFunnel = funnelPresent && (expected == null || funnelTotal === expected);
    const successful = text(payload.status, 40).toLowerCase() === "ok";
    if (truncated && !hasExactFunnel) issues.push("truncated reject groups lacked a reconciling funnel");
    else if (!truncated && groupsPresent && funnelPresent && groupTotal !== funnelTotal) issues.push("reject groups and funnel totals conflicted");
    else if (!truncated && expected != null && groupsPresent && !hasExactGroups) issues.push("reject groups did not reconcile to the rejected total");
    else if (expected != null && funnelPresent && !hasExactFunnel) issues.push("funnel losses did not reconcile to the rejected total");
    else if (expected > 0 && !groupsPresent && !funnelPresent) issues.push("rejected total lacked exact stage/reason detail");
    else if (successful && expected == null && !groupsPresent && !funnelPresent) issues.push("successful run lacked funnel-loss coverage");
  }
  return { known: issues.length === 0, reason: [...new Set(issues)].join("; ") };
}

function latestBatches(events) {
  const batches = new Map();
  for (const row of events) {
    if (row?.type !== "line.batch") continue;
    const payload = object(row.payload);
    const batch = object(payload.batch);
    const id = text(batch.batchId || payload.batchId, 120);
    if (!id) continue;
    const at = new Date(row.created_at).getTime();
    const existing = batches.get(id);
    if (!existing || (!Number.isNaN(at) && at >= existing.at)) batches.set(id, { at, row, batch });
  }
  return batches;
}

function historyEntry(row, status, startMs, endMs) {
  return (Array.isArray(row?.history) ? row.history : [])
    .find((entry) => entry?.status === status && inWindow(entry.at, startMs, endMs)) || null;
}

function buildProspectIds(events, batches) {
  const ids = new Set();
  for (const item of batches.values()) {
    for (const row of Array.isArray(item.batch.rows) ? item.batch.rows : []) {
      const id = text(row?.prospectId, 120);
      if (id) ids.add(id);
    }
  }
  for (const row of events) {
    const payload = object(row?.payload);
    if ((row?.type === "system.run" && payload.stage === "built") || row?.type === "siteforge.callback") {
      const id = text(payload.prospectId || payload.prospect_id, 120);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function siteActivity(events, batches, nameById, startMs, endMs, warnings) {
  const builtBySite = new Map();
  const gatedBySite = new Map();
  const save = (map, key, item) => {
    const current = map.get(key);
    if (!current || String(item.at).localeCompare(String(current.at)) >= 0) {
      map.set(key, { ...current, ...item, name: item.name || current?.name || "" });
    }
  };
  let missingHistory = 0;
  let unidentified = 0;
  for (const [batchId, item] of batches.entries()) {
    const rows = Array.isArray(item.batch.rows) ? item.batch.rows : [];
    rows.forEach((row, index) => {
      const history = Array.isArray(row?.history) ? row.history : [];
      if (!history.length) {
        missingHistory += 1;
        return;
      }
      const common = {
        name: text(row.businessName || nameById[text(row.prospectId, 120)], 120),
        prospectId: text(row.prospectId, 120),
        batchId,
        status: text(row.status, 40),
        row: index,
        source: "line.batch",
      };
      const key = common.prospectId ? `prospect:${common.prospectId}` : `line:${batchId}:${index}`;
      const mirrored = historyEntry(row, "mirrored", startMs, endMs);
      if (mirrored) save(builtBySite, key, { ...common, at: new Date(mirrored.at).toISOString() });
      const passed = historyEntry(row, "gate_passed", startMs, endMs);
      if (passed) save(gatedBySite, key, { ...common, at: new Date(passed.at).toISOString() });
    });
  }

  for (const event of events) {
    const payload = object(event?.payload);
    const prospectId = text(payload.prospectId || payload.prospect_id, 120);
    const name = text(payload.businessName || payload.business_name || nameById[prospectId], 120);
    const at = event?.created_at;
    if (!inWindow(at, startMs, endMs)) continue;

    if (event.type === "system.run" && payload.stage === "built") {
      const status = text(payload.status, 40).toLowerCase();
      const ready = payload.ready === true || payload.ready === "true";
      const aggregateBuilt = count(payload.built) || 0;
      const completed = ready || (status === "ok" && aggregateBuilt > 0);
      if (!completed) continue;
      if (!prospectId) {
        unidentified += Math.max(1, aggregateBuilt);
        continue;
      }
      const key = `prospect:${prospectId}`;
      const common = { name, prospectId, status: ready ? "built" : status, at, source: "system.run" };
      save(builtBySite, key, common);
      if (payload.qcPassed === true || payload.qc_passed === true || payload.gatePassed === true) {
        save(gatedBySite, key, { ...common, status: "gate_passed" });
      }
    }

    if (event.type === "siteforge.callback" && payload.previewUrlReady === true) {
      if (!prospectId) {
        unidentified += 1;
        continue;
      }
      const key = `prospect:${prospectId}`;
      const common = { name, prospectId, status: "built", at, source: "siteforge.callback" };
      save(builtBySite, key, common);
      if (payload.qcPassed === true || payload.qc_passed === true) {
        save(gatedBySite, key, { ...common, status: "gate_passed" });
      }
    }
  }

  if (missingHistory) warnings.push(`${missingHistory} line batch row(s) lacked durable history and were not counted as built or gated.`);
  if (unidentified) warnings.push(`${unidentified} completed build(s) lacked a prospect ID and could not be deduplicated or named.`);
  const built = [...builtBySite.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const gated = [...gatedBySite.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const unnamed = built.filter((item) => !item.name).length;
  if (unnamed) warnings.push(`${unnamed} built site(s) lacked a durable business name.`);
  return {
    built,
    gated,
    complete: missingHistory === 0 && unidentified === 0 && unnamed === 0,
    reason: missingHistory || unidentified || unnamed ? "build identity/history coverage incomplete" : "",
  };
}

function liveSends(rows, startMs, endMs) {
  const ids = new Set();
  for (const row of rows) {
    if (!inWindow(row?.sent_at, startMs, endMs)) continue;
    const payload = object(row.payload);
    if (text(row.mode, 30).toLowerCase() !== "sent" || row.suppressed === true) continue;
    const lane = text(payload.deliveryLane || payload.delivery_lane || row.deliveryLane || row.delivery_lane, 60).toLowerCase();
    const ownerProof = row.ownerProof === true
      || row.owner_proof === true
      || row.sandbox === true
      || payload.ownerProof === true
      || payload.owner_proof === true
      || payload.sandbox === true
      || payload.isProspectSend === false
      || payload.is_prospect_send === false
      || ["owner_only_proof", "owner-only", "owner_proof", "sandbox"].includes(lane);
    if (ownerProof) continue;
    const providerId = text(payload.resendId || payload.resend_id || payload.email_id || payload.emailId || payload.id, 160);
    const fallback = text(row.id, 160)
      || [row.prospect_id, row.sequence, row.step, row.sent_at].map((value) => text(value, 120)).join(":");
    ids.add(providerId ? `provider:${providerId}` : `row:${fallback}`);
  }
  return ids.size;
}

function sandboxSends(events, batches, startMs, endMs, warnings) {
  const sends = new Set();
  for (const [batchId, item] of batches.entries()) {
    if (item.batch.lane !== "sandbox") continue;
    (Array.isArray(item.batch.rows) ? item.batch.rows : []).forEach((row, index) => {
      const sent = historyEntry(row, "sent", startMs, endMs);
      if (!sent) return;
      sends.add(`line:${batchId}:${text(row.prospectId, 120) || index}`);
    });
  }

  // A run writes several system.run progress events. Only the latest durable
  // `sent` snapshot per run may contribute, otherwise a retry double counts.
  const byRun = new Map();
  for (const row of events) {
    if (row?.type !== "system.run") continue;
    const payload = object(row.payload);
    const isSandbox = (payload.sandboxMode ?? payload.sandbox_mode) === true;
    const isDryRun = (payload.dryRun ?? payload.dry_run) === true;
    if (payload.stage !== "sent" || !isSandbox || isDryRun) continue;
    const runId = text(payload.runId || payload.run_id, 120);
    if (!runId) continue;
    const at = new Date(row.created_at).getTime();
    const existing = byRun.get(runId);
    if (!existing || (!Number.isNaN(at) && at >= existing.at)) byRun.set(runId, { at, payload });
  }
  for (const [runId, item] of byRun.entries()) {
    const sentIds = item.payload.sentProspectIds || item.payload.sent_prospect_ids;
    const ids = Array.isArray(sentIds)
      ? [...new Set(sentIds.map((id) => text(id, 120)).filter(Boolean))]
      : [];
    const total = count(item.payload.sent) || 0;
    ids.forEach((id) => sends.add(`system:${runId}:${id}`));
    for (let index = ids.length; index < total; index += 1) sends.add(`system:${runId}:anonymous-${index}`);
    if (total && !ids.length) warnings.push(`Sandbox run ${runId} recorded ${total} send(s) without prospect IDs; dedupe is exact within that run only.`);
  }
  return sends.size;
}

function rawVapiCall(row) {
  if (!row || !["vapi_webhook", "vapi_customer_webhook"].includes(row.type)) return null;
  const payload = object(row.payload);
  const body = object(payload.body);
  const message = Object.keys(object(body.message)).length ? object(body.message) : body;
  const call = Object.keys(object(message.call)).length ? object(message.call) : object(body.call);
  const eventType = text(payload.type || body.type || message.type || message.event, 60).toLowerCase();
  const completed = [
    "end-of-call-report", "end_of_call_report", "call.ended", "call-ended", "call.completed", "call_completed",
  ].includes(eventType);
  if (!completed) return null;
  return {
    callId: text(call.id || payload.callId || body.id, 160),
    assistantId: text(call.assistantId || call.assistant_id || call.assistant?.id, 160),
  };
}

function rileyCalls(events, known, env) {
  if (!known) return { known: false, calls: null, identified: 0, unidentified: 0, reason: "VAPI receipts unavailable" };
  const rileyId = text(env.VAPI_RILEY_ASSISTANT_ID || env.VAPI_LOCAL_GROWTH_ASSISTANT_ID || RILEY_ASSISTANT_FALLBACK, 160);
  const receipts = new Map();
  const anonymousReceipts = [];
  let anonymous = 0;
  for (const row of events) {
    const receipt = rawVapiCall(row);
    if (!receipt) continue;
    if (receipt.callId) {
      if (!receipts.has(receipt.callId)) receipts.set(receipt.callId, { assistantIds: new Set(), missingAssistantId: false });
      const state = receipts.get(receipt.callId);
      if (receipt.assistantId) state.assistantIds.add(receipt.assistantId);
      else state.missingAssistantId = true;
    } else {
      anonymous += 1;
      anonymousReceipts.push(receipt);
    }
  }
  const unique = [...receipts.values()];
  const unidentified = unique.filter((item) => item.missingAssistantId || item.assistantIds.size === 0).length
    + anonymousReceipts.filter((item) => !item.assistantId).length;
  const conflicting = unique.filter((item) => item.assistantIds.size > 1).length;
  // Preserve observed Riley evidence even when another receipt for the same
  // call conflicts. The count is then explicitly a minimum, never an exact 0.
  const calls = unique.filter((item) => item.assistantIds.has(rileyId)).length
    + anonymousReceipts.filter((item) => item.assistantId === rileyId).length;
  const reasons = [];
  if (unidentified) reasons.push(`${unidentified} completed VAPI receipt(s) lacked assistantId`);
  if (anonymous) reasons.push(`${anonymous} completed VAPI receipt(s) lacked callId and could not be deduplicated`);
  if (conflicting) reasons.push(`${conflicting} callId(s) had conflicting assistantId receipts`);
  return {
    known: unidentified === 0 && anonymous === 0 && conflicting === 0,
    calls,
    identified: unique.length + anonymousReceipts.length - unidentified,
    unidentified,
    anonymous,
    conflicting,
    reason: reasons.length ? `${reasons.join("; ")}; Riley count is an observed minimum.` : "",
  };
}

function cronTokenMatches(token, value, { dow = false } = {}) {
  return token.split(",").some((part) => {
    const item = part.trim();
    if (item === "*") return true;
    const step = /^\*\/(\d+)$/.exec(item);
    if (step) return value % Number(step[1]) === 0;
    const range = /^(\d+)-(\d+)$/.exec(item);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    const parsed = Number(item);
    if (!Number.isInteger(parsed)) return false;
    return dow && parsed === 7 ? value === 0 : value === parsed;
  });
}

function cronMatches(schedule, date) {
  const [minute, hour, day, month, weekday] = String(schedule).trim().split(/\s+/);
  return cronTokenMatches(minute, date.getUTCMinutes())
    && cronTokenMatches(hour, date.getUTCHours())
    && cronTokenMatches(day, date.getUTCDate())
    && cronTokenMatches(month, date.getUTCMonth() + 1)
    && cronTokenMatches(weekday, date.getUTCDay(), { dow: true });
}

function expectedCronSlots(schedule, startMs, endMs) {
  let cursor = Math.ceil(startMs / 60000) * 60000;
  const slots = [];
  for (; cursor < endMs; cursor += 60000) {
    if (cronMatches(schedule, new Date(cursor))) slots.push(cursor);
  }
  return slots;
}

function cronActivity(events, eventsKnown, eventsBounded, startMs, endMs) {
  const byJob = new Map();
  for (const row of events) {
    const payload = object(row.payload);
    let job = "";
    if (row.type === "cron.run") job = text(payload.job, 100);
    if (row.type === "mine.run" && payload.trigger === "scheduled_cron") job = "daily-mining";
    if (!job || !inWindow(row.created_at, startMs, endMs)) continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push(row);
  }

  const result = {
    known: eventsKnown && !eventsBounded,
    reason: !eventsKnown ? "event ledger unavailable" : (eventsBounded ? "event read was bounded" : ""),
    fired: [],
    silent: [],
    notDue: [],
    unknown: [],
  };
  for (const cron of CRON_ROSTER) {
    const slots = expectedCronSlots(cron.schedule, startMs, endMs);
    const expected = slots.length;
    const scheduledInvocations = new Map();
    const manualInvocations = new Map();
    for (const row of byJob.get(cron.job) || []) {
      const payload = object(row.payload);
      const runId = text(payload.runId || payload.run_id, 120);
      const at = new Date(row.created_at).getTime();
      const scheduledSlot = [...slots].reverse().find((slot) => slot <= at && at - slot <= CRON_POST_SLOT_TOLERANCE_MS);
      if (scheduledSlot != null) {
        const current = scheduledInvocations.get(scheduledSlot);
        if (!current || String(row.created_at) < current) scheduledInvocations.set(scheduledSlot, row.created_at);
        continue;
      }
      const manualKey = runId ? `run:${runId}` : `manual:${String(row.created_at).slice(0, 16)}`;
      if (!manualInvocations.has(manualKey) || String(row.created_at) < manualInvocations.get(manualKey)) {
        manualInvocations.set(manualKey, row.created_at);
      }
    }
    const firedAt = [...scheduledInvocations.values()].sort();
    const manualAt = [...manualInvocations.values()].sort();
    const entry = {
      job: cron.job,
      schedule: cron.schedule,
      expected,
      observed: firedAt.length,
      firedAt,
      manualObserved: manualAt.length,
      manualAt,
      silentRuns: Math.max(0, expected - firedAt.length),
    };
    if (firedAt.length) result.fired.push(entry);
    else if (expected === 0) result.notDue.push(entry);
    else if (!cron.evidence || !eventsKnown || eventsBounded) result.unknown.push({
      ...entry,
      reason: !cron.evidence ? "job has no durable cron-run receipt" : (!eventsKnown ? "event ledger unavailable" : "event read was bounded"),
    });
    else result.silent.push(entry);
  }
  return result;
}

async function replyStatus(deps, selectFn, end) {
  // A test may inject the exported reader directly. Production uses the same
  // exported pending-draft reducer over a focused, status-aware event read;
  // loadDrafts() itself intentionally hides store failures and scans only the
  // newest 400 events, so it cannot prove an exact owner-facing zero.
  if (typeof deps.loadDrafts === "function") {
    try {
      const drafts = await deps.loadDrafts(REPLY_EVENT_LIMIT, { enrich: false });
      if (!Array.isArray(drafts)) throw new TypeError("reply_queue_reader_returned_no_array");
      return {
        waiting: drafts.length,
        known: true,
        bounded: false,
        degraded: false,
        reason: "",
        sourceRows: drafts.length,
      };
    } catch (error) {
      return {
        waiting: null,
        known: false,
        bounded: false,
        degraded: true,
        reason: text(error?.code || error?.message || error, 140) || "Reply Desk unavailable",
        sourceRows: 0,
      };
    }
  }

  const types = ["reply.draft", "reply.sent", "reply.rejected"].map(encodeURIComponent).join(",");
  const query = `?select=id,type,payload,created_at&type=in.(${types})&created_at=lt.${encodeURIComponent(end)}`;
  const read = await selectAllRows("ghost_agency_events", query, { order: "created_at.desc", idColumn: "id" }, selectFn);
  if (!read.known) {
    return {
      waiting: null,
      known: false,
      bounded: read.bounded === true,
      degraded: true,
      reason: read.reason,
      sourceRows: read.rows.length,
    };
  }
  try {
    const drafts = pendingDraftsFromEvents(read.rows, read.rows.length || 1);
    return {
      waiting: drafts.length,
      known: true,
      bounded: false,
      degraded: false,
      reason: "",
      sourceRows: read.rows.length,
    };
  } catch (error) {
    return {
      waiting: null,
      known: false,
      bounded: false,
      degraded: true,
      reason: text(error?.code || error?.message || error, 140) || "Reply Desk unavailable",
      sourceRows: read.rows.length,
    };
  }
}

async function pauseStatus(deps) {
  const read = deps.deliveryPauseStatus || defaultDeliveryPauseStatus;
  try {
    const pause = object(await read());
    return {
      known: pause.known === true,
      active: typeof pause.active === "boolean" ? pause.active : null,
      reason: text(pause.reason, 180),
      at: pause.at || null,
    };
  } catch (error) {
    return { known: false, active: null, reason: text(error?.message || error, 180) || "delivery pause status unavailable", at: null };
  }
}

async function generateMorningReport(input = {}, deps = {}) {
  const selectFn = deps.select || defaultSelect;
  const explicitWindow = input.since != null || input.until != null || input.preferStored === false;
  let preloadedMarkerRead = null;
  if (!explicitWindow) {
    const defaultNow = typeof deps.now === "function" ? deps.now() : (deps.now == null ? Date.now() : deps.now);
    const end = asDate(undefined, defaultNow);
    preloadedMarkerRead = await readMorningMarkers(end, selectFn);
    const stored = sameDayStoredReport(preloadedMarkerRead, end);
    if (stored) return stored;
  }
  const resolved = await resolveMorningWindow(input, deps, selectFn, preloadedMarkerRead);
  const start = resolved.start.toISOString();
  const end = resolved.end.toISOString();
  const startMs = resolved.start.getTime();
  const endMs = resolved.end.getTime();

  const eventTypeList = EVENT_TYPES.map((type) => encodeURIComponent(type)).join(",");
  const eventQuery = `?select=id,type,payload,created_at&type=in.(${eventTypeList})&${queryWindow("created_at", start, end)}`
    ;
  const emailQuery = `?select=id,prospect_id,sequence,step,sent_at,suppressed,mode,payload&${queryWindow("sent_at", start, end)}`
    ;
  const editQuery = `?select=job_id,site_slug,status,created_at,updated_at,result&status=in.(done,failed,refused)`
    + `&${queryWindow("updated_at", start, end)}`;

  const [eventRead, emailRead, editRead, replies, deliveryPause] = await Promise.all([
    selectAllRows("ghost_agency_events", eventQuery, { order: "created_at.asc", idColumn: "id" }, selectFn),
    selectAllRows("ghost_agency_email_log", emailQuery, { order: "sent_at.asc", idColumn: "id" }, selectFn),
    selectAllRows("ghost_agency_edit_jobs", editQuery, { order: "updated_at.asc", idColumn: "job_id" }, selectFn),
    replyStatus(deps, selectFn, end),
    pauseStatus(deps),
  ]);

  const events = eventRead.rows.filter((row) => inWindow(row?.created_at, startMs, endMs));
  const batches = latestBatches(events);
  const buildIds = buildProspectIds(events, batches);
  let nameRead = { known: true, rows: [], reason: "" };
  if (buildIds.length > PROSPECT_NAME_LIMIT) {
    nameRead = { known: false, rows: [], reason: `more than ${PROSPECT_NAME_LIMIT} build identities require names` };
  } else if (buildIds.length) {
    const quoted = buildIds.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(",");
    nameRead = await selectRows(
      "ghost_agency_prospects",
      `?select=prospect_id,business_name&prospect_id=in.(${quoted})&limit=${buildIds.length}`,
      selectFn,
    );
  }
  const nameById = Object.fromEntries(nameRead.rows.map((row) => [text(row.prospect_id, 120), text(row.business_name, 120)]));

  const warnings = [];
  const eventSource = source("events", eventRead);
  const emailSource = source("email_log", emailRead);
  const editSource = source("edit_jobs", editRead);
  const nameSource = source("prospect_names", nameRead);
  const markerSource = source("previous_morning_marker", resolved.markerRead, 30);
  const replySource = {
    id: "reply_queue",
    known: replies.known,
    rows: replies.sourceRows || 0,
    bounded: replies.bounded,
    reason: replies.reason,
  };
  const pauseSource = { id: "delivery_pause", known: deliveryPause.known, rows: deliveryPause.known ? 1 : 0, bounded: false, reason: deliveryPause.reason };
  for (const item of [eventSource, emailSource, editSource, nameSource, replySource, pauseSource]) {
    if (!item.known) warnings.push(`${item.id} unavailable: ${item.reason || "unknown"}.`);
    else if (item.bounded) warnings.push(`${item.id} reached its read cap; exact counts are unknown.`);
  }

  const mineRuns = events.filter((row) => row?.type === "mine.run");
  const eventComplete = eventRead.known && !eventSource.bounded;
  const emailComplete = emailRead.known && !emailSource.bounded;
  const editComplete = editRead.known && !editSource.bounded;
  const runsMissingCreated = mineRuns.filter((row) => object(row.payload).status === "ok" && count(object(row.payload).created) == null).length;
  const miningComplete = eventComplete && runsMissingCreated === 0;
  const lossesCoverage = eventComplete ? lossCoverage(mineRuns) : { known: false, reason: "event ledger unavailable or incomplete" };
  const mined = miningComplete
    ? mineRuns.reduce((sum, row) => sum + (count(object(row.payload).created) || 0), 0)
    : null;
  if (runsMissingCreated) warnings.push(`${runsMissingCreated} successful mining run(s) lacked an exact created count; mined total is unknown.`);
  if (!lossesCoverage.known) warnings.push(`Funnel losses are unknown: ${lossesCoverage.reason}.`);

  const observedSites = siteActivity(events, batches, nameById, startMs, endMs, warnings);
  const sitesKnown = eventComplete && observedSites.complete;
  const sites = {
    known: sitesKnown,
    built: observedSites.built,
    gated: observedSites.gated,
    reason: sitesKnown ? "" : (observedSites.reason || eventRead.reason || (eventSource.bounded ? "event read was bounded" : "build coverage incomplete")),
  };

  const live = emailComplete ? liveSends(emailRead.rows, startMs, endMs) : null;
  const sandbox = eventComplete ? sandboxSends(events, batches, startMs, endMs, warnings) : null;
  const emailTotal = live == null || sandbox == null ? null : live + sandbox;

  const terminal = { done: 0, failed: 0, refused: 0 };
  if (editComplete) {
    for (const row of editRead.rows) {
      if (!inWindow(row?.updated_at, startMs, endMs)) continue;
      const status = text(row.status, 30).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(terminal, status)) terminal[status] += 1;
    }
  }

  const env = deps.env || process.env;
  const riley = rileyCalls(events, eventComplete, env);
  if (!riley.known && riley.reason) warnings.push(riley.reason);
  const crons = cronActivity(events, eventRead.known, eventSource.bounded, startMs, endMs);

  const report = {
    ok: [mined, sites.known ? sites.built.length : null, emailTotal, replies.waiting].every(measuredCount),
    date: end.slice(0, 10),
    generatedAt: end,
    window: {
      start,
      end,
      halfOpen: true,
      basis: resolved.basis,
      hours: Math.round(((endMs - startMs) / 3600000) * 100) / 100,
    },
    totals: {
      mined,
      built: sites.known ? sites.built.length : null,
      sent: emailTotal,
      repliesWaiting: replies.waiting,
    },
    leads: {
      known: miningComplete,
      reason: miningComplete
        ? ""
        : (runsMissingCreated ? "successful run missing created count" : (eventRead.reason || "event ledger incomplete")),
      mined,
      runs: miningComplete ? mineRuns.length : null,
      losses: eventComplete ? lossGroups(mineRuns) : [],
      lossesKnown: lossesCoverage.known,
      lossesReason: lossesCoverage.known ? "" : lossesCoverage.reason,
    },
    sites: {
      ...sites,
      reason: sites.known ? "" : sites.reason,
    },
    emails: {
      known: emailComplete && eventComplete,
      reason: emailComplete && eventComplete
        ? ""
        : [emailComplete ? "" : `email log: ${emailRead.reason || "read was bounded"}`, eventComplete ? "" : `sandbox events: ${eventRead.reason || "read was bounded"}`].filter(Boolean).join("; "),
      live,
      sandbox,
      total: emailTotal,
    },
    replies,
    edits: {
      known: editComplete,
      reason: editComplete ? "" : (editRead.reason || "edit job read was bounded"),
      done: editComplete ? terminal.done : null,
      failed: editComplete ? terminal.failed : null,
      refused: editComplete ? terminal.refused : null,
    },
    riley,
    crons,
    deliveryPause,
    sources: [markerSource, eventSource, emailSource, editSource, nameSource, replySource, pauseSource],
    warnings: [...new Set(warnings)],
  };
  return report;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function visibleCount(value) {
  return measuredCount(value) ? Number(value).toLocaleString("en-US") : "Not measured";
}

function subjectCount(value) {
  return measuredCount(value) ? String(Math.max(0, Math.trunc(Number(value)))) : "unknown";
}

function morningReportSubject(report = {}) {
  const totals = object(report.totals);
  return `WSS Morning Report — ${text(report.date, 10)}: ${subjectCount(totals.mined)} mined, ${subjectCount(totals.built)} built, ${subjectCount(totals.sent)} sent, ${subjectCount(totals.repliesWaiting)} replies waiting`;
}

function metricCard(label, value, note) {
  return `<td width="25%" valign="top" style="padding:6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${cardStyle({ radius: 12 })}">
      <tr><td style="padding:16px 14px 14px">
        <p style="margin:0 0 5px;font-family:${FONT_STACK};font-size:11px;line-height:1.4;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${PALETTE.muted}">${escapeHtml(label)}</p>
        <p style="margin:0;font-family:${FONT_STACK};font-size:25px;line-height:1.1;font-weight:800;color:${PALETTE.ink}">${escapeHtml(visibleCount(value))}</p>
        ${note ? `<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.45;color:${PALETTE.muted}">${escapeHtml(note)}</p>` : ""}
      </td></tr>
    </table>
  </td>`;
}

function section(title, body) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;${cardStyle({ radius: 14 })}">
    <tr><td style="padding:20px 20px 18px">
      <h2 style="margin:0 0 12px;font-family:${FONT_STACK};font-size:18px;line-height:1.3;color:${PALETTE.ink}">${escapeHtml(title)}</h2>
      ${body}
    </td></tr>
  </table>`;
}

function listHtml(items, empty) {
  if (!items.length) return `<p style="margin:0;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:${PALETTE.muted}">${escapeHtml(empty)}</p>`;
  return `<ul style="margin:0;padding:0 0 0 20px;font-family:${FONT_STACK};font-size:14px;line-height:1.65;color:${PALETTE.muted}">${items.map((item) => `<li style="margin:0 0 5px">${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function siteNames(items, limit = 20) {
  const rows = Array.isArray(items) ? items : [];
  const names = rows.slice(0, limit).map((item) => item.name || item.prospectId || "Unnamed build");
  if (rows.length > limit) names.push(`And ${rows.length - limit} more.`);
  return names;
}

function renderMorningReportEmail(report = {}) {
  const totals = object(report.totals);
  const sites = object(report.sites);
  const emails = object(report.emails);
  const edits = object(report.edits);
  const riley = object(report.riley);
  const pause = object(report.deliveryPause);
  const crons = object(report.crons);
  const losses = Array.isArray(report.leads?.losses) ? report.leads.losses : [];
  const builtRows = Array.isArray(sites.built) ? sites.built : [];
  const gatedRows = Array.isArray(sites.gated) ? sites.gated : [];
  const builtNames = siteNames(builtRows);
  const gatedNames = siteNames(gatedRows);
  const lossLines = losses.slice(0, 12).flatMap((stage) => stage.reasons.slice(0, 3)
    .map((reason) => `${stage.stage}: ${reason.count} — ${reason.reason}`));
  const fired = Array.isArray(crons.fired) ? crons.fired : [];
  const silent = Array.isArray(crons.silent) ? crons.silent : [];
  const unknown = Array.isArray(crons.unknown) ? crons.unknown : [];
  const notDue = Array.isArray(crons.notDue) ? crons.notDue : [];
  const warningLines = Array.isArray(report.warnings) ? report.warnings : [];
  const gatedCount = sites.known === false ? null : gatedRows.length;
  const windowLabel = `${new Date(report.window?.start).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} to ${new Date(report.window?.end).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })}`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${PALETTE.page}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.page}">
    <tr><td align="center" style="padding:28px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px">
        <tr><td style="padding:0 6px 18px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td width="54" valign="middle"><img src="${WSS_MARK_URL}" width="44" height="44" alt="WSS" style="display:block;border:0;width:44px;height:44px"></td>
            <td valign="middle"><p style="margin:0;font-family:${FONT_STACK};font-size:11px;line-height:1.4;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${PALETTE.accent}">Operations</p>
              <h1 style="margin:3px 0 0;font-family:${FONT_STACK};font-size:28px;line-height:1.16;letter-spacing:-.02em;color:${PALETTE.ink}">WSS Morning Report</h1></td>
          </tr></table>
          <p style="margin:12px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${PALETTE.muted}">${escapeHtml(report.date)} · ${escapeHtml(windowLabel)} · start inclusive, end exclusive</p>
        </td></tr>
        <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${metricCard("Mined", totals.mined)}
          ${metricCard("Built", totals.built, `${visibleCount(gatedCount)} passed gate`)}
          ${metricCard("Sent", totals.sent, `${visibleCount(emails.live)} live · ${visibleCount(emails.sandbox)} sandbox`)}
          ${metricCard("Replies", totals.repliesWaiting, report.replies?.bounded ? "bounded minimum" : "waiting now")}
        </tr></table></td></tr>
        <tr><td>${section("Executive Summary", `<p style="margin:0;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:${PALETTE.ink}"><strong>${escapeHtml(visibleCount(totals.mined))} new lead(s)</strong> were recorded, <strong>${escapeHtml(visibleCount(totals.built))} site(s)</strong> reached a completed build, and <strong>${escapeHtml(visibleCount(totals.sent))} email(s)</strong> were sent. Reply Desk has <strong>${escapeHtml(visibleCount(totals.repliesWaiting))}</strong> waiting now.</p>`)}</td></tr>
        <tr><td>${section("Where leads stopped", report.leads?.lossesKnown === false
          ? `<p style="margin:0;font-family:${FONT_STACK};font-size:14px;line-height:1.6;color:${PALETTE.muted}">Unknown — ${escapeHtml(report.leads?.lossesReason || "complete funnel-loss detail was not retained")}</p>`
          : listHtml(lossLines, report.leads?.known === false ? "Mining events were not available." : "No funnel losses were recorded in this window."))}</td></tr>
        <tr><td>${section("Sites built and gated", `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;font-weight:800;color:${PALETTE.ink}">Built (${escapeHtml(visibleCount(totals.built))})</p>${listHtml(builtNames, sites.known === false ? "Build history was not available." : "No sites were built in this window.")}<p style="margin:14px 0 8px;font-family:${FONT_STACK};font-size:13px;line-height:1.5;font-weight:800;color:${PALETTE.ink}">Passed gate (${escapeHtml(visibleCount(gatedCount))})</p>${listHtml(gatedNames, sites.known === false ? "Gate history was not available." : "No sites passed the render gate in this window.")}`)}</td></tr>
        <tr><td>${section("Calls, edits, and delivery", listHtml([
          `Email split: ${visibleCount(emails.live)} live, ${visibleCount(emails.sandbox)} sandbox.`,
          `Edit jobs: ${visibleCount(edits.done)} done, ${visibleCount(edits.failed)} failed, ${visibleCount(edits.refused)} refused.`,
          riley.known ? `Riley calls: ${visibleCount(riley.calls)}.` : `Riley calls: not fully measured — ${riley.reason || "raw VAPI identity unavailable"}.`,
          pause.known ? `Delivery pause: ${pause.active ? "ON" : "off"}${pause.reason ? ` — ${pause.reason}` : ""}.` : `Delivery pause: unknown${pause.reason ? ` — ${pause.reason}` : ""}.`,
        ], "No operations activity was recorded."))}</td></tr>
        <tr><td>${section("Cron receipts", listHtml([
          ...fired.map((item) => `${item.job}: fired ${item.observed}/${item.expected} scheduled time(s)${item.silentRuns ? `; ${item.silentRuns} scheduled time(s) have no receipt` : ""}${item.manualObserved ? `; ${item.manualObserved} off-slot manual receipt(s)` : ""}.`),
          ...silent.map((item) => `${item.job}: silent — 0/${item.expected} scheduled time(s) produced a receipt${item.manualObserved ? `; ${item.manualObserved} off-slot manual receipt(s) did not satisfy the schedule` : ""}.`),
          ...unknown.map((item) => `${item.job}: unknown — ${item.reason}${item.manualObserved ? `; ${item.manualObserved} off-slot manual receipt(s)` : ""}.`),
          ...notDue.map((item) => `${item.job}: not due in this window${item.manualObserved ? `; ${item.manualObserved} off-slot manual receipt(s) observed` : ""}.`),
        ], "No cron jobs were due in this window."))}</td></tr>
        ${warningLines.length ? `<tr><td>${section("Coverage notes", listHtml(warningLines, ""))}</td></tr>` : ""}
        <tr><td style="padding:20px 6px 0;font-family:${FONT_STACK};font-size:11px;line-height:1.55;color:${PALETTE.muted}">Measured from durable WSS records. No estimates. Unknown sources stay labeled unknown.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const textBody = [
    "WSS Morning Report",
    `${report.date} | ${windowLabel} | start inclusive, end exclusive`,
    "",
    `Mined: ${visibleCount(totals.mined)}`,
    `Built: ${visibleCount(totals.built)}`,
    `Passed gate: ${visibleCount(gatedCount)}`,
    `Sent: ${visibleCount(totals.sent)} (${visibleCount(emails.live)} live, ${visibleCount(emails.sandbox)} sandbox)`,
    `Replies waiting: ${visibleCount(totals.repliesWaiting)}`,
    `Edit jobs: ${visibleCount(edits.done)} done, ${visibleCount(edits.failed)} failed, ${visibleCount(edits.refused)} refused`,
    `Riley calls: ${riley.known ? visibleCount(riley.calls) : `not fully measured — ${riley.reason || "raw VAPI identity unavailable"}`}`,
    `Delivery pause: ${pause.known ? (pause.active ? "ON" : "off") : "unknown"}${pause.reason ? ` — ${pause.reason}` : ""}`,
    "",
    "Sites built:",
    ...(builtNames.length ? builtNames.map((name) => `- ${name}`) : [sites.known === false ? "- Not measured" : "- None"]),
    "",
    "Funnel losses:",
    ...(report.leads?.lossesKnown === false
      ? [`- Unknown — ${report.leads?.lossesReason || "complete funnel-loss detail was not retained"}`]
      : (lossLines.length ? lossLines.map((line) => `- ${line}`) : [report.leads?.known === false ? "- Not measured" : "- None"])),
    ...(warningLines.length ? ["", "Coverage notes:", ...warningLines.map((line) => `- ${line}`)] : []),
  ].join("\n");

  return { subject: morningReportSubject(report), html, text: textBody };
}

async function sendMorningReport(report, deps = {}) {
  const totals = object(report?.totals);
  const headline = [totals.mined, totals.built, totals.sent, totals.repliesWaiting];
  if (report?.ok !== true || !headline.every(measuredCount)) {
    const error = new Error("morning_report_incomplete");
    error.code = "morning_report_incomplete";
    error.report = report || null;
    throw error;
  }
  const send = deps.sendResendEmail || defaultSendResendEmail;
  const rendered = renderMorningReportEmail(report);
  const result = await send({
    to: "woodwardsoftware@gmail.com",
    cc: [],
    bcc: [],
    senderKind: "transactional",
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `wss-morning-report/${text(report?.date, 10)}`,
  });
  if (!result || result.mode !== "sent") {
    const error = new Error("morning_report_send_failed");
    error.code = "morning_report_send_failed";
    error.result = result || null;
    throw error;
  }
  return result;
}

module.exports = {
  CRON_ROSTER,
  MAX_WINDOW_MS,
  MORNING_REPORT_EVENT,
  OWNER_EMAIL,
  generateMorningReport,
  morningReportSubject,
  renderMorningReportEmail,
  sendMorningReport,
};
