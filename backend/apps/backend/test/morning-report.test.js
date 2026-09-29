"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MORNING_REPORT_EVENT,
  OWNER_EMAIL,
  generateMorningReport,
  renderMorningReportEmail,
  sendMorningReport,
} = require("../lib/morning-report");

const START = "2026-08-08T14:00:00.000Z";
const END = "2026-08-09T13:00:00.000Z";
const RILEY = "riley-test-assistant";

function fixtureSelect({ markers = [], events = [], emails = [], edits = [], prospects = [], replies = [] } = {}, calls = []) {
  return async (table, query) => {
    calls.push({ table, query });
    if (table === "ghost_agency_events" && query.includes(`type=eq.${MORNING_REPORT_EVENT}`)) return { ok: true, data: markers };
    if (table === "ghost_agency_events" && query.includes("reply.draft")) return { ok: true, data: replies };
    if (table === "ghost_agency_events") return { ok: true, data: events };
    if (table === "ghost_agency_email_log") return { ok: true, data: emails };
    if (table === "ghost_agency_edit_jobs") return { ok: true, data: edits };
    if (table === "ghost_agency_prospects") return { ok: true, data: prospects };
    throw new Error(`unexpected read ${table} ${query}`);
  };
}

function lineRow({ id, name, status, history }) {
  return { prospectId: id, businessName: name, status, history };
}

function completeReport(overrides = {}) {
  return {
    ok: true,
    date: "2026-08-09",
    generatedAt: END,
    window: { start: START, end: END, halfOpen: true, basis: "explicit", hours: 23 },
    totals: { mined: 3, built: 4, sent: 4, repliesWaiting: 1 },
    leads: { known: true, mined: 3, runs: 2, losses: [], lossesKnown: true, lossesReason: "" },
    sites: { known: true, built: [], gated: [], reason: "" },
    emails: { known: true, live: 1, sandbox: 3, total: 4, reason: "" },
    replies: { known: true, waiting: 1, bounded: false, degraded: false, reason: "" },
    edits: { known: true, done: 1, failed: 1, refused: 1, reason: "" },
    riley: { known: true, calls: 1, reason: "" },
    crons: { known: true, fired: [], silent: [], notDue: [], unknown: [], reason: "" },
    deliveryPause: { known: true, active: false, reason: "" },
    sources: [],
    warnings: [],
    ...overrides,
  };
}

test("generator uses one explicit half-open window and reconciles durable sources without double counting", async () => {
  const calls = [];
  const markers = [{
    id: "previous",
    type: MORNING_REPORT_EVENT,
    created_at: "2026-08-08T14:05:00.000Z",
    payload: {
      date: "2026-08-08",
      status: "sent",
      report: { window: { end: START } },
    },
  }];
  const historyOne = [
    { status: "picked", at: "2026-08-08T17:00:00.000Z" },
    { status: "mirrored", at: "2026-08-08T17:01:00.000Z" },
    { status: "gate_passed", at: "2026-08-08T17:02:00.000Z" },
    { status: "sent", at: "2026-08-08T17:05:00.000Z" },
  ];
  const events = [{
    id: "mine-ok",
    type: "mine.run",
    created_at: "2026-08-08T15:00:00.000Z",
    payload: { status: "ok", created: 3, rejects: { groups: [{ stage: "5_email", reason: "no_email", count: 2 }] } },
  }, {
    id: "mine-refused",
    type: "mine.run",
    created_at: "2026-08-08T16:00:00.000Z",
    payload: { status: "refused", funnel: [{ stage: "1_discovery", rejected: { provider_down: 2 } }] },
  }, {
    id: "line-old",
    type: "line.batch",
    created_at: "2026-08-08T17:10:00.000Z",
    payload: { batchId: "batch-1", batch: { batchId: "batch-1", lane: "sandbox", rows: [lineRow({ id: "p1", name: "Alpha Plumbing", status: "sent", history: historyOne })] } },
  }, {
    id: "line-latest",
    type: "line.batch",
    created_at: "2026-08-08T18:00:00.000Z",
    payload: {
      batchId: "batch-1",
      batch: {
        batchId: "batch-1",
        lane: "sandbox",
        rows: [
          lineRow({ id: "p1", name: "Alpha Plumbing", status: "sent", history: historyOne }),
          lineRow({ id: "p2", name: "Beta Roofing", status: "gate_failed", history: [
            { status: "picked", at: "2026-08-08T17:00:00.000Z" },
            { status: "mirrored", at: "2026-08-08T17:03:00.000Z" },
            { status: "gate_failed", at: "2026-08-08T17:04:00.000Z" },
          ] }),
        ],
      },
    },
  }, {
    id: "system-build",
    type: "system.run",
    created_at: "2026-08-08T19:00:00.000Z",
    payload: { runId: "build-p3", stage: "built", status: "ok", ready: true, qcPassed: true, prospectId: "p3", businessName: "Gamma Electric" },
  }, {
    id: "callback-same-build",
    type: "siteforge.callback",
    created_at: "2026-08-08T19:01:00.000Z",
    payload: { prospectId: "p3", previewUrlReady: true, qcPassed: true },
  }, {
    id: "callback-four",
    type: "siteforge.callback",
    created_at: "2026-08-08T19:02:00.000Z",
    payload: { prospectId: "p4", previewUrlReady: true, qcPassed: false },
  }, {
    id: "sandbox-sent-old",
    type: "system.run",
    created_at: "2026-08-08T20:00:00.000Z",
    payload: { runId: "sandbox-1", stage: "sent", sandboxMode: true, dryRun: false, sent: 2, sentProspectIds: ["p3", "p4"] },
  }, {
    id: "sandbox-sent-latest",
    type: "system.run",
    created_at: "2026-08-08T20:01:00.000Z",
    payload: { runId: "sandbox-1", stage: "sent", sandboxMode: true, dryRun: false, sent: 2, sentProspectIds: ["p3", "p4", "p4"] },
  }, {
    id: "cron-one-a",
    type: "cron.run",
    created_at: "2026-08-08T16:30:05.000Z",
    payload: { job: "nightly-pipeline", runId: "nightly-1", status: "failed" },
  }, {
    id: "cron-one-b",
    type: "cron.run",
    created_at: "2026-08-08T16:31:00.000Z",
    payload: { job: "nightly-pipeline", runId: "nightly-1", status: "ok" },
  }, {
    id: "riley-call",
    type: "vapi_webhook",
    created_at: "2026-08-08T21:00:00.000Z",
    payload: { type: "end-of-call-report", callId: "call-1", body: { message: { call: { id: "call-1", assistantId: RILEY } } } },
  }, {
    id: "other-call",
    type: "vapi_webhook",
    created_at: "2026-08-08T21:05:00.000Z",
    payload: { type: "call.completed", callId: "call-2", body: { call: { id: "call-2", assistantId: "other" } } },
  }];
  const emails = [{ id: "e1", prospect_id: "p1", sent_at: "2026-08-08T22:00:00.000Z", mode: "sent", suppressed: false, payload: { resendId: "re-1" } },
    { id: "e1-copy", prospect_id: "p1", sent_at: "2026-08-08T22:01:00.000Z", mode: "sent", suppressed: false, payload: { resendId: "re-1" } },
    { id: "owner-proof", prospect_id: "p2", sent_at: "2026-08-08T22:02:00.000Z", mode: "sent", suppressed: false, owner_proof: true, payload: {} },
    { id: "sandbox-log", prospect_id: "p3", sent_at: "2026-08-08T22:03:00.000Z", mode: "sent", suppressed: false, payload: { delivery_lane: "sandbox" } }];
  const edits = [
    { job_id: "j1", status: "done", updated_at: "2026-08-08T23:00:00.000Z" },
    { job_id: "j2", status: "failed", updated_at: "2026-08-08T23:01:00.000Z" },
    { job_id: "j3", status: "refused", updated_at: "2026-08-08T23:02:00.000Z" },
  ];
  const replies = [
    { id: "d1", type: "reply.draft", created_at: "2026-08-08T10:00:00.000Z", payload: { draftId: "d1", approval: "pending" } },
    { id: "d2", type: "reply.draft", created_at: "2026-08-08T11:00:00.000Z", payload: { draftId: "d2", approval: "pending" } },
    { id: "s1", type: "reply.sent", created_at: "2026-08-08T12:00:00.000Z", payload: { draftId: "d1" } },
  ];
  const report = await generateMorningReport({ until: END, preferStored: false }, {
    select: fixtureSelect({ markers, events, emails, edits, replies, prospects: [{ prospect_id: "p4", business_name: "Delta HVAC" }] }, calls),
    deliveryPauseStatus: async () => ({ known: true, active: false, reason: "" }),
    env: { VAPI_RILEY_ASSISTANT_ID: RILEY },
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.window, { start: START, end: END, halfOpen: true, basis: "previous_success", hours: 23 });
  assert.deepEqual(report.totals, { mined: 3, built: 4, sent: 4, repliesWaiting: 1 });
  assert.equal(report.sites.gated.length, 2);
  assert.deepEqual(report.sites.built.map((row) => row.name).sort(), ["Alpha Plumbing", "Beta Roofing", "Delta HVAC", "Gamma Electric"]);
  assert.deepEqual(report.emails, { known: true, reason: "", live: 1, sandbox: 3, total: 4 });
  assert.deepEqual({ done: report.edits.done, failed: report.edits.failed, refused: report.edits.refused }, { done: 1, failed: 1, refused: 1 });
  assert.deepEqual({ known: report.riley.known, calls: report.riley.calls }, { known: true, calls: 1 });
  assert.equal(report.leads.losses.find((row) => row.stage === "5_email").count, 2);
  assert.equal(report.crons.fired.find((row) => row.job === "nightly-pipeline").observed, 1, "two receipts for one runId are one invocation");

  for (const { query } of calls.filter((call) => /(?:created_at|sent_at|updated_at)=gte/.test(call.query))) {
    assert.match(query, /=gte\./);
    assert.match(query, /=lt\./);
    assert.doesNotMatch(query, /=lte\./);
  }
});

test("a same-day canonical marker replays its stored report exactly and performs no other reads", async () => {
  const stored = completeReport({ totals: { mined: 9, built: 8, sent: 7, repliesWaiting: 6 } });
  const calls = [];
  const marker = {
    id: "today-claim",
    type: MORNING_REPORT_EVENT,
    created_at: "2026-08-09T13:00:01.000Z",
    payload: { date: "2026-08-09", status: "claimed", report: stored },
  };
  const report = await generateMorningReport({}, {
    now: "2026-08-09T14:00:00.000Z",
    select: fixtureSelect({ markers: [marker] }, calls),
  });
  assert.deepEqual(report, stored);
  assert.notEqual(report, stored, "stored report is deep cloned");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "ghost_agency_events");
});

test("known empty durable sources produce honest zeros while an unavailable source produces null and blocks send", async () => {
  const zero = await generateMorningReport({ since: START, until: END }, {
    select: async () => ({ ok: true, data: [] }),
    deliveryPauseStatus: async () => ({ known: false, active: true, reason: "pause source unavailable" }),
  });
  assert.equal(zero.ok, true);
  assert.deepEqual(zero.totals, { mined: 0, built: 0, sent: 0, repliesWaiting: 0 });
  assert.equal(zero.deliveryPause.known, false);
  assert.equal(zero.deliveryPause.active, true, "fail-closed active state is preserved, not rewritten as known");

  const unavailable = await generateMorningReport({ since: START, until: END }, {
    select: async () => ({ ok: false, mode: "live_select_failed", error: { code: "read_timeout" }, data: [] }),
    deliveryPauseStatus: async () => ({ known: false, active: true, reason: "read_timeout" }),
  });
  assert.equal(unavailable.ok, false);
  assert.deepEqual(unavailable.totals, { mined: null, built: null, sent: null, repliesWaiting: null });
  assert.equal(unavailable.leads.known, false);
  assert.equal(unavailable.sites.known, false);
  assert.equal(unavailable.emails.known, false);
  assert.equal(unavailable.replies.known, false);
  assert.match(renderMorningReportEmail(unavailable).subject, /unknown mined, unknown built, unknown sent, unknown replies waiting/);
  let providerCalls = 0;
  await assert.rejects(
    sendMorningReport(unavailable, { sendResendEmail: async () => { providerCalls += 1; return { mode: "sent" }; } }),
    (error) => error.code === "morning_report_incomplete",
  );
  assert.equal(providerCalls, 0);
});

test("bounded reads and successful mine rows without created counts fail closed instead of sending undercounts", async () => {
  const fillers = Array.from({ length: 5000 }, (_, index) => ({
    id: `event-${index}`,
    type: "system.run",
    created_at: new Date(new Date(START).getTime() + index * 1000).toISOString(),
    payload: { runId: `run-${index}`, stage: "started" },
  }));
  const bounded = await generateMorningReport({ since: START, until: END }, {
    select: fixtureSelect({ events: fillers }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
  });
  assert.equal(bounded.ok, false);
  assert.equal(bounded.totals.mined, null);
  assert.equal(bounded.totals.built, null);
  assert.equal(bounded.emails.sandbox, null);
  assert.equal(bounded.sources.find((item) => item.id === "events").bounded, true);

  const missingCreated = await generateMorningReport({ since: START, until: END }, {
    select: fixtureSelect({ events: [{ id: "mine", type: "mine.run", created_at: "2026-08-08T15:00:00.000Z", payload: { status: "ok" } }] }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
  });
  assert.equal(missingCreated.ok, false);
  assert.equal(missingCreated.leads.known, false);
  assert.equal(missingCreated.totals.mined, null);
  assert.match(missingCreated.warnings.join(" "), /created count; mined total is unknown/i);
});

test("reply waiting count paginates past 5,000 rows and is measured as of the report end", async () => {
  const replyRows = Array.from({ length: 5001 }, (_, index) => ({
    id: `draft-${String(index).padStart(5, "0")}`,
    type: "reply.draft",
    created_at: "2026-08-08T10:00:00.000Z",
    payload: { draftId: `draft-${index}`, approval: "pending" },
  }));
  replyRows.push({
    id: "sent-draft-0",
    type: "reply.sent",
    created_at: "2026-08-08T12:00:00.000Z",
    payload: { draftId: "draft-0" },
  });
  const replyQueries = [];
  const report = await generateMorningReport({ since: START, until: END }, {
    select: async (table, query) => {
      if (table === "ghost_agency_events" && query.includes("reply.draft")) {
        replyQueries.push(query);
        const offset = Number(/(?:^|&)offset=(\d+)/.exec(query)?.[1] || 0);
        const limit = Number(/(?:^|&)limit=(\d+)/.exec(query)?.[1] || replyRows.length);
        return { ok: true, data: replyRows.slice(offset, offset + limit) };
      }
      return { ok: true, data: [] };
    },
    deliveryPauseStatus: async () => ({ known: true, active: false, reason: "" }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.replies.known, true);
  assert.equal(report.replies.sourceRows, 5002);
  assert.equal(report.replies.waiting, 5000);
  assert.equal(report.totals.repliesWaiting, 5000);
  assert.equal(replyQueries.length, 6, "five full pages and one final partial page are exhausted");
  for (const query of replyQueries) {
    assert.match(query, new RegExp(`created_at=lt\\.${encodeURIComponent(END).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(query, /created_at=gte/);
  }
});

test("truncated reject groups use the full funnel or label only loss detail unknown without blocking delivery", async () => {
  const completeFallback = await generateMorningReport({ since: START, until: END }, {
    select: fixtureSelect({ events: [{
      id: "mine-fallback",
      type: "mine.run",
      created_at: "2026-08-08T15:00:00.000Z",
      payload: {
        status: "ok",
        created: 2,
        rejects: { total: 3, groupsTruncated: 1, groups: [{ stage: "5_email", reason: "no_email", count: 2 }] },
        funnel: [{ stage: "5_email", rejected: { no_email: 2, invalid_email: 1 } }],
      },
    }] }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
  });
  assert.equal(completeFallback.ok, true);
  assert.equal(completeFallback.leads.lossesKnown, true);
  assert.equal(completeFallback.leads.losses[0].count, 3);
  assert.deepEqual(completeFallback.leads.losses[0].reasons.map((row) => row.reason).sort(), ["invalid_email", "no_email"]);

  const missingFallback = await generateMorningReport({ since: START, until: END }, {
    select: fixtureSelect({ events: [{
      id: "mine-truncated",
      type: "mine.run",
      created_at: "2026-08-08T15:00:00.000Z",
      payload: {
        status: "ok",
        created: 2,
        rejects: { total: 3, groupsTruncated: 1, groups: [{ stage: "5_email", reason: "no_email", count: 2 }] },
      },
    }] }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
  });
  assert.equal(missingFallback.ok, true, "auxiliary reject detail cannot block an exact headline report");
  assert.equal(missingFallback.totals.mined, 2);
  assert.equal(missingFallback.leads.known, true);
  assert.equal(missingFallback.leads.lossesKnown, false);
  assert.match(missingFallback.leads.lossesReason, /truncated reject groups/i);
  assert.match(missingFallback.warnings.join(" "), /Funnel losses are unknown/i);
  assert.match(renderMorningReportEmail(missingFallback).text, /Funnel losses:\n- Unknown — truncated reject groups/i);
  let sends = 0;
  await sendMorningReport(missingFallback, {
    sendResendEmail: async () => { sends += 1; return { mode: "sent", id: "re-loss-unknown" }; },
  });
  assert.equal(sends, 1);

  const contradictoryZero = await generateMorningReport({ since: START, until: END }, {
    select: fixtureSelect({ events: [{
      id: "mine-contradictory-zero",
      type: "mine.run",
      created_at: "2026-08-08T15:00:00.000Z",
      payload: {
        status: "ok",
        created: 2,
        rejects: { total: 0, groupsTruncated: 0, groups: [{ stage: "5_email", reason: "no_email", count: 2 }] },
      },
    }] }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
  });
  assert.equal(contradictoryZero.ok, true, "loss-detail conflict remains auxiliary to exact headline counts");
  assert.equal(contradictoryZero.leads.lossesKnown, false);
  assert.match(contradictoryZero.leads.lossesReason, /did not reconcile/i);
  assert.match(renderMorningReportEmail(contradictoryZero).text, /Funnel losses:\n- Unknown/i);
});

test("Riley count becomes unknown when a completed raw receipt cannot be deduplicated", async () => {
  const report = await generateMorningReport({ since: START, until: END }, {
    select: fixtureSelect({ events: [{
      id: "anonymous-call",
      type: "vapi_webhook",
      created_at: "2026-08-08T21:00:00.000Z",
      payload: { type: "end-of-call-report", body: { call: { assistantId: RILEY } } },
    }] }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
    env: { VAPI_RILEY_ASSISTANT_ID: RILEY },
  });
  assert.equal(report.riley.known, false);
  assert.equal(report.riley.calls, 1, "observed match remains visible but is not labeled exact");
  assert.match(report.riley.reason, /lacked callId/);
});

test("conflicting assistant identities for one VAPI call are order-independent and never reported as exact", async () => {
  const rows = [
    { id: "riley", type: "vapi_webhook", created_at: "2026-08-08T21:00:00.000Z", payload: { type: "call.completed", callId: "conflict-1", body: { call: { id: "conflict-1", assistantId: RILEY } } } },
    { id: "other", type: "vapi_webhook", created_at: "2026-08-08T21:00:01.000Z", payload: { type: "call.completed", callId: "conflict-1", body: { call: { id: "conflict-1", assistantId: "other-assistant" } } } },
  ];
  const make = (events) => generateMorningReport({ since: START, until: END }, {
    select: fixtureSelect({ events }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
    env: { VAPI_RILEY_ASSISTANT_ID: RILEY },
  });
  const [forward, reverse] = await Promise.all([make(rows), make([...rows].reverse())]);
  for (const report of [forward, reverse]) {
    assert.equal(report.riley.known, false);
    assert.equal(report.riley.calls, 1, "the observed Riley receipt remains visible as a minimum");
    assert.equal(report.riley.conflicting, 1);
    assert.match(report.riley.reason, /conflicting assistantId receipts.*observed minimum/i);
  }
});

test("manual cron receipts outside the post-slot tolerance never satisfy a scheduled run", async () => {
  const start = "2026-08-08T16:00:00.000Z";
  const end = "2026-08-08T18:00:00.000Z";
  const report = await generateMorningReport({ since: start, until: end }, {
    select: fixtureSelect({ events: [{
      id: "manual-nightly",
      type: "cron.run",
      created_at: "2026-08-08T17:00:00.000Z",
      payload: { job: "nightly-pipeline", runId: "manual-1", status: "ok" },
    }] }),
    loadDrafts: async () => [],
    deliveryPauseStatus: async () => ({ known: true, active: false }),
  });
  const nightlySilent = report.crons.silent.find((row) => row.job === "nightly-pipeline");
  assert.ok(nightlySilent, "the 16:30 scheduled slot remains silent");
  assert.equal(nightlySilent.expected, 1);
  assert.equal(nightlySilent.observed, 0);
  assert.equal(nightlySilent.manualObserved, 1);
  assert.deepEqual(nightlySilent.manualAt, ["2026-08-08T17:00:00.000Z"]);
  assert.equal(report.crons.fired.some((row) => row.job === "nightly-pipeline"), false);
});

test("send envelope is locked to the literal owner with no cc/bcc and cannot be overridden", async () => {
  const envelopes = [];
  const report = completeReport({ recipient: "attacker@example.test" });
  const result = await sendMorningReport(report, {
    recipient: "other@example.test",
    sendResendEmail: async (input) => { envelopes.push(input); return { mode: "sent", id: "re-owner" }; },
  }, { recipient: "third@example.test" });
  assert.deepEqual(result, { mode: "sent", id: "re-owner" });
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0].to, "woodwardsoftware@gmail.com");
  assert.equal(envelopes[0].to, OWNER_EMAIL);
  assert.deepEqual(envelopes[0].cc, []);
  assert.deepEqual(envelopes[0].bcc, []);
  assert.equal(envelopes[0].senderKind, "transactional");
  assert.equal(Object.hasOwn(envelopes[0], "internalOwnerProof"), false, "env-driven recipient replacement stays disabled");
  assert.equal(envelopes[0].idempotencyKey, "wss-morning-report/2026-08-09");
  assert.equal(envelopes[0].subject, "WSS Morning Report — 2026-08-09: 3 mined, 4 built, 4 sent, 1 replies waiting");

  await assert.rejects(
    sendMorningReport(report, { sendResendEmail: async () => ({ mode: "dry_run" }) }),
    (error) => error.code === "morning_report_send_failed" && error.result.mode === "dry_run",
  );
});

test("email reports the full gated count while capping only the visible name list", () => {
  const gated = Array.from({ length: 25 }, (_, index) => ({ name: `Business ${index + 1}`, prospectId: `p${index + 1}` }));
  const report = completeReport({
    totals: { mined: 0, built: 25, sent: 0, repliesWaiting: 0 },
    sites: { known: true, built: gated, gated, reason: "" },
    emails: { known: true, live: 0, sandbox: 0, total: 0 },
  });
  const rendered = renderMorningReportEmail(report);
  assert.match(rendered.html, /Passed gate \(25\)/);
  assert.match(rendered.html, /25 passed gate/);
  assert.match(rendered.html, /And 5 more\./);
  assert.doesNotMatch(rendered.html, /Passed gate \(20\)/);
});
