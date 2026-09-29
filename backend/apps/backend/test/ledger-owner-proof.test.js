"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  aggregateLedger,
  createLedgerDataHandler,
  readAllRows,
} = require("../api/admin/ledger-data");

const EMPTY = "No tracked sends yet — this fills as campaigns go out.";

function loadPage() {
  return require("../lib/ledger-page");
}

function inlineScripts(html = loadPage()) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function fakeRes({ json = true } = {}) {
  return {
    statusCode: 0,
    headers: {},
    raw: "",
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(payload = "") {
      this.raw = String(payload || "");
      this.body = json && this.raw ? JSON.parse(this.raw) : this.raw;
    },
  };
}

function request(method = "GET", token = "") {
  return {
    method,
    url: "/api/admin/ledger-data",
    headers: token ? { "x-admin-token": token } : {},
  };
}

function payloadKeys(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => payloadKeys(item, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      payloadKeys(item, out);
    }
  }
  return out;
}

function byStage(snapshot, name) {
  return (snapshot.funnel || []).find((row) => String(row.stage || row.key || row.label || "").toLowerCase() === name);
}

function day(snapshot, date) {
  return (snapshot.series?.days || []).find((row) => row.date === date || row.day === date);
}

function campaign(snapshot, id) {
  return (snapshot.campaigns || []).find((row) => (
    row.id === id || row.campaignId === id || row.runId === id || row.batchId === id
  ));
}

function email(overrides = {}) {
  return {
    id: "log-1",
    prospect_id: "prospect-1",
    sequence: "initial",
    step: 1,
    sent_at: "2026-08-01T23:58:00.000Z",
    mode: "sent",
    suppressed: false,
    payload: { resendId: "re-1", runId: "run-a" },
    ...overrides,
  };
}

function event(type, at, payload = {}, id = `${type}-${at}`) {
  return { id, type, created_at: at, payload };
}

test("/ledger is a public, GET-only, no-store, data-free shell and the old raw diagnostic endpoint is gone", async () => {
  const page = loadPage();
  const ledgerPageHandler = require("../api/admin/ledger");
  const res = fakeRes({ json: false });
  await ledgerPageHandler({ method: "GET", url: "/ledger", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["Content-Type"], /text\/html/);
  assert.match(res.headers["Cache-Control"], /no-store/);
  assert.equal(res.body, page);
  assert.match(res.body, /type=["']password["']/);
  assert.doesNotMatch(res.body, /process\.env|GHOST_AGENCY_[A-Z_]+|SUPABASE_(?:URL|KEY)|RESEND_API_KEY/,
    "the public shell must not contain environment configuration or source data");

  const rejected = fakeRes();
  await ledgerPageHandler({ method: "POST", url: "/ledger", headers: {} }, rejected);
  assert.equal(rejected.statusCode, 405);

  const routeSource = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "ledger.js"), "utf8");
  for (const oldField of ["providerStatus", "proofGates", "supportTickets", "checkoutSessions", "entitlements", "delivery_queue"]) {
    assert.doesNotMatch(routeSource, new RegExp(oldField), `old raw diagnostic field remains: ${oldField}`);
  }

  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(config.rewrites.some((rule) => (
    rule.source === "/ledger" && rule.destination === "/api/admin/ledger"
  )), "vercel.json must expose the Campaign Ledger at /ledger");
});

test("ledger-data is GET-only and authenticates before either source is read", async (t) => {
  const prior = process.env.GHOST_AGENCY_ADMIN_TOKEN;
  const priorSecondary = process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "ledger-owner-proof";
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
  t.after(() => {
    if (prior === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN = prior;
    if (priorSecondary === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
    else process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY = priorSecondary;
  });

  const reads = [];
  const handler = createLedgerDataHandler({
    select: async (table, query) => {
      reads.push({ table, query });
      return { ok: true, data: [] };
    },
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });

  const post = fakeRes();
  await handler(request("POST", "ledger-owner-proof"), post);
  assert.equal(post.statusCode, 405);
  assert.equal(reads.length, 0, "a rejected write method reached the store");

  const options = fakeRes();
  await handler(request("OPTIONS"), options);
  assert.equal(options.statusCode, 204);
  assert.equal(reads.length, 0, "CORS preflight must not authenticate or read the store");

  const missing = fakeRes();
  await handler(request("GET"), missing);
  assert.equal(missing.statusCode, 401);
  assert.equal(reads.length, 0, "authentication must happen before either store read");

  const wrong = fakeRes();
  await handler(request("GET", "wrong-token"), wrong);
  assert.equal(wrong.statusCode, 401);
  assert.equal(reads.length, 0, "wrong-token requests must not disclose whether a source exists");

  const ok = fakeRes();
  await handler(request("GET", "ledger-owner-proof"), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.generatedAt, "2026-08-11T12:00:00.000Z");
  assert.equal(ok.body.empty, EMPTY);
  assert.deepEqual(reads.map(({ table }) => table).sort(), ["ghost_agency_email_log", "ghost_agency_events"]);
  assert.ok(reads.every(({ query }) => !/(?:^|[?&])select=\*/.test(query)), "source queries must project fields, never select=*");
  const eventRead = reads.find(({ table }) => table === "ghost_agency_events");
  assert.match(eventRead.query, /resend\.webhook/);
  assert.match(eventRead.query, /reply\.draft/);
  assert.match(eventRead.query, /line\.batch/);
  assert.match(eventRead.query, /campaign\.run/);
});

test("ledger-data keeps legacy null suppression rows in the measured source", async () => {
  const queries = [];
  const handler = createLedgerDataHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async (table, query) => {
      queries.push({ table, query });
      return {
        ok: true,
        data: table === "ghost_agency_email_log"
          ? [email({ id: "legacy-null", suppressed: null })]
          : [],
      };
    },
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.sent, 1);
  const emailRead = queries.find((item) => item.table === "ghost_agency_email_log");
  assert.match(emailRead.query, /suppressed=not\.is\.true/);
});

test("source failures return 503 and never masquerade as an empty or partial ledger", async () => {
  const handler = createLedgerDataHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async (table) => (table === "ghost_agency_email_log"
      ? { ok: true, data: [] }
      : { ok: false, data: [], error: { code: "provider_unavailable" } }),
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, "ledger_source_unavailable");
  assert.equal(Object.hasOwn(res.body, "summary"), false);
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(EMPTY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const select of [
    async (table) => (table === "ghost_agency_email_log"
      ? { ok: false, data: [] }
      : { ok: true, data: [] }),
    async () => { throw new Error("store socket closed"); },
  ]) {
    const failed = fakeRes();
    await createLedgerDataHandler({
      methodGuard: () => true,
      requireAdmin: () => true,
      select,
    })(request(), failed);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.error, "ledger_source_unavailable");
    assert.equal(Object.hasOwn(failed.body, "summary"), false);
  }
});

test("readAllRows fails closed at its hard cap instead of returning partial totals", async () => {
  let reads = 0;
  await assert.rejects(
    readAllRows("ghost_agency_email_log", {
      select: async () => {
        reads += 1;
        return {
          ok: true,
          data: Array.from({ length: 2 }, (_, index) => ({
            id: `row-${reads}-${index}`,
            sent_at: `2026-08-${String(reads).padStart(2, "0")}T00:00:0${index}.000Z`,
          })),
        };
      },
      order: "sent_at.asc,id.asc",
      timeColumn: "sent_at",
      selectFields: "id,sent_at",
      pageSize: 2,
      maxRows: 4,
    }),
    (error) => error?.statusCode === 413 && error?.code === "ledger_source_limit",
  );
  assert.equal(reads, 2, "the cap must trip as soon as it is full, without a probe that can hide more rows");
});

test("readAllRows returns every sub-cap page under a stable time-and-id order", async () => {
  const queries = [];
  const pages = [
    [
      { id: "a", sent_at: "2026-08-01T00:00:00.000Z" },
      { id: "b", sent_at: "2026-08-01T00:00:00.000Z" },
    ],
    [{ id: "c", sent_at: "2026-08-02T00:00:00.000Z" }],
  ];
  const rows = await readAllRows("ghost_agency_email_log", {
    select: async (_table, query) => {
      queries.push(query);
      return { ok: true, data: pages.shift() || [] };
    },
    order: "sent_at.asc,id.asc",
    timeColumn: "sent_at",
    selectFields: "id,sent_at",
    pageSize: 2,
    maxRows: 10,
  });
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c"]);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => /order=sent_at\.asc%2Cid\.asc|order=sent_at\.asc,id\.asc/.test(query)));
});

test("aggregateLedger counts only eligible prospect sends and warns without dropping sends that lack provider IDs", () => {
  const snapshot = aggregateLedger({
    now: () => new Date("2026-08-11T12:00:00.000Z"),
    emails: [
      email(),
      email({ id: "log-duplicate", prospect_id: "prospect-alias", payload: { resendId: "re-1", runId: "run-a" } }),
      email({ id: "log-no-provider", prospect_id: "prospect-2", sent_at: "2026-08-02T00:01:00.000Z", payload: { runId: "run-b" } }),
      email({ id: "dry", mode: "dry_run", payload: { resendId: "re-dry", runId: "run-a" } }),
      email({ id: "suppressed", suppressed: true, payload: { resendId: "re-suppressed", runId: "run-a" } }),
      email({ id: "owner", payload: { resendId: "re-owner", ownerProof: true, runId: "run-a" } }),
      email({ id: "sandbox", payload: { resendId: "re-sandbox", deliveryLane: "sandbox", runId: "run-a" } }),
      email({ id: "not-prospect", payload: { resendId: "re-not-prospect", isProspectSend: false, runId: "run-a" } }),
      email({ id: "not-prospect-snake", payload: { resendId: "re-not-prospect-snake", is_prospect_send: false, runId: "run-a" } }),
    ],
    events: [],
  });

  assert.equal(snapshot.summary.sent, 2, "duplicate provider IDs collapse but a durable send row without one still counts");
  assert.equal(byStage(snapshot, "sent").count, 2);
  assert.ok(snapshot.source.warnings.some((warning) => /provider/i.test(String(warning))),
    "missing provider IDs need an honest warning");
  assert.equal(snapshot.empty, null);
});

test("provider events reconcile exactly, deduplicate by message and stage, and keep orphans out", () => {
  const snapshot = aggregateLedger({
    emails: [email()],
    events: [
      event("resend.webhook", "2026-08-02T01:00:00.000Z", { type: "email.opened", email_id: "re-1" }, "open-1"),
      event("resend.webhook", "2026-08-02T02:00:00.000Z", { type: "email.opened", email_id: "re-1" }, "open-duplicate"),
      event("resend.webhook", "2026-08-03T03:00:00.000Z", { type: "email.clicked", email_id: "re-1" }, "click-1"),
      event("resend.webhook", "2026-08-03T04:00:00.000Z", { type: "email.opened", email_id: "re-orphan" }, "orphan"),
      event("resend.webhook", "2026-08-03T05:00:00.000Z", { type: "email.clicked" }, "anonymous"),
    ],
  });

  assert.equal(snapshot.summary.sent, 1);
  assert.equal(snapshot.summary.opened, 1);
  assert.equal(snapshot.summary.clicked, 1);
  assert.equal(byStage(snapshot, "opened").count, 1);
  assert.equal(byStage(snapshot, "clicked").count, 1);
  assert.ok(snapshot.source.warnings.some((warning) => /orphan|matching.*send|unmatched/i.test(String(warning))));
  assert.ok(snapshot.source.warnings.some((warning) => /missing.*(?:provider|message)|provider.*missing/i.test(String(warning))));

  const genericIdOnly = aggregateLedger({
    emails: [email({ payload: { id: "not-a-provider-id", runId: "run-a" } })],
    events: [event("resend.webhook", "2026-08-03T06:00:00.000Z", {
      type: "email.opened",
      email_id: "not-a-provider-id",
    })],
  });
  assert.equal(genericIdOnly.summary.sent, 1);
  assert.equal(genericIdOnly.summary.opened, undefined,
    "generic payload.id values must never create a provider reconciliation join");
});

test("reply.draft uses inbound identity, excludes hot views, and refuses ambiguous campaign attribution", () => {
  const snapshot = aggregateLedger({
    emails: [
      email({ id: "a", prospect_id: "prospect-a", payload: { resendId: "re-a", runId: "run-a" } }),
      email({ id: "b1", prospect_id: "prospect-b", payload: { resendId: "re-b1", runId: "run-b" } }),
      email({ id: "b2", prospect_id: "prospect-b", payload: { resendId: "re-b2", runId: "run-c" } }),
    ],
    events: [
      event("reply.draft", "2026-08-04T10:00:00.000Z", { inboundId: "in-a", draftId: "draft-a", prospectId: "prospect-a" }, "reply-a"),
      event("reply.draft", "2026-08-04T10:01:00.000Z", { inboundId: "in-a", draftId: "draft-a-retry", prospectId: "prospect-a" }, "reply-a-retry"),
      event("reply.draft", "2026-08-04T10:02:00.000Z", { draftId: "draft-only", prospectId: "prospect-a" }, "reply-draft-only"),
      event("reply.draft", "2026-08-04T10:03:00.000Z", { draftId: "draft-only", prospectId: "prospect-a" }, "reply-draft-only-retry"),
      event("reply.draft", "2026-08-04T11:00:00.000Z", { inboundId: "in-b", draftId: "draft-b", prospectId: "prospect-b" }, "reply-b"),
      event("reply.draft", "2026-08-04T11:30:00.000Z", {
        draftId: "hot-system-draft",
        prospectId: "prospect-a",
        trigger: "report_viewed",
        intent: "report_viewed",
      }, "hot-draft"),
      event("reply.draft", "2026-08-04T11:31:00.000Z", {
        draftId: "legacy-hot-system-draft",
        prospectId: "prospect-a",
        intent: "report_viewed",
      }, "legacy-hot-draft"),
      event("reply.draft", "2026-08-04T11:40:00.000Z", {
        inboundId: "in-orphan",
        draftId: "draft-orphan",
        prospectId: "prospect-with-no-send",
      }, "orphan-reply"),
      event("reply.draft", "2026-08-04T11:41:00.000Z", {
        inboundId: "in-no-prospect",
        draftId: "draft-no-prospect",
      }, "unattributed-reply"),
      event("report.viewed", "2026-08-04T12:00:00.000Z", { prospectId: "prospect-a", source: "hot_view_pixel" }, "hot-view"),
    ],
  });

  assert.equal(snapshot.summary.replied, 2,
    "reply conversion counts unique sent prospects, not retries, repeat messages, hot views, or orphans");
  assert.equal(byStage(snapshot, "replied").count, 2);
  assert.equal(campaign(snapshot, "run-a").replies, 1, "one replying prospect increments a campaign once");
  assert.equal(campaign(snapshot, "run-b").replies, 0);
  assert.equal(campaign(snapshot, "run-c").replies, 0);
  assert.ok(snapshot.source.warnings.some((warning) => /ambiguous.*repl|repl.*ambiguous/i.test(String(warning))));
  assert.ok(snapshot.source.warnings.some((warning) => /no prior eligible send/i.test(String(warning))));
});

test("campaigns prefer explicit run IDs, infer one unique sent line batch, and leave ambiguous batches ungrouped", () => {
  const sentHistory = (at) => [{ status: "sent", at }];
  const snapshot = aggregateLedger({
    emails: [
      email({ id: "explicit", prospect_id: "prospect-explicit", payload: { resendId: "re-explicit", runId: "run-explicit" } }),
      email({ id: "unique", prospect_id: "prospect-unique", payload: { resendId: "re-unique" } }),
      email({ id: "ambiguous", prospect_id: "prospect-ambiguous", payload: { resendId: "re-ambiguous" } }),
      email({ id: "superseded", prospect_id: "prospect-superseded", payload: { resendId: "re-superseded" } }),
      email({
        id: "historical",
        prospect_id: "prospect-historical",
        sent_at: "2026-08-01T23:58:00.000Z",
        payload: { resendId: "re-historical" },
      }),
    ],
    events: [
      event("line.batch", "2026-08-01T20:00:00.000Z", {
        batchId: "batch-unique",
        batch: { batchId: "batch-unique", target: "Tulsa plumbers", status: "complete", rows: [
          { prospectId: "prospect-unique", status: "sent", history: sentHistory("2026-08-01T19:59:00.000Z") },
        ] },
      }, "batch-unique-snapshot"),
      event("line.batch", "2026-08-01T21:00:00.000Z", {
        batchId: "batch-one",
        batch: { batchId: "batch-one", status: "complete", rows: [
          { prospectId: "prospect-ambiguous", status: "sent", history: sentHistory("2026-08-01T20:59:00.000Z") },
        ] },
      }, "batch-one-snapshot"),
      event("line.batch", "2026-08-01T22:00:00.000Z", {
        batchId: "batch-two",
        batch: { batchId: "batch-two", status: "complete", rows: [
          { prospectId: "prospect-ambiguous", status: "sent", history: sentHistory("2026-08-01T21:59:00.000Z") },
        ] },
      }, "batch-two-snapshot"),
      event("line.batch", "2026-07-01T22:00:00.000Z", {
        batchId: "batch-historical",
        batch: { batchId: "batch-historical", status: "complete", rows: [
          { prospectId: "prospect-historical", status: "sent", history: sentHistory("2026-07-01T21:59:00.000Z") },
        ] },
      }, "batch-historical-snapshot"),
      event("line.batch", "2026-08-01T22:30:00.000Z", {
        batchId: "batch-superseded",
        batch: { batchId: "batch-superseded", status: "running", rows: [
          { prospectId: "prospect-superseded", status: "sent", history: sentHistory("2026-08-01T22:29:00.000Z") },
        ] },
      }, "batch-superseded-old"),
      event("line.batch", "2026-08-01T23:00:00.000Z", {
        batchId: "batch-superseded",
        batch: { batchId: "batch-superseded", status: "failed", rows: [] },
      }, "batch-superseded-latest"),
    ],
  });

  assert.equal(campaign(snapshot, "run-explicit").sent, 1);
  assert.equal(campaign(snapshot, "batch-unique").sent, 1);
  assert.equal(campaign(snapshot, "batch-one"), undefined);
  assert.equal(campaign(snapshot, "batch-two"), undefined);
  assert.equal(campaign(snapshot, "batch-historical"), undefined,
    "identity alone cannot attach a new send to an unrelated historical batch");
  assert.equal(campaign(snapshot, "batch-superseded"), undefined,
    "only the latest batch snapshot may provide send evidence");
  assert.ok(snapshot.source.warnings.some((warning) => /ambiguous.*batch|batch.*ambiguous/i.test(String(warning))));
});

test("campaign rows expose exact measured rates, status, last activity, and newest-first event detail", () => {
  const snapshot = aggregateLedger({
    emails: [
      email({
        id: "rate-1",
        prospect_id: "rate-prospect-1",
        sent_at: "2026-08-01T10:00:00.000Z",
        payload: { resendId: "rate-provider-1", runId: "run-rates" },
      }),
      email({
        id: "rate-2",
        prospect_id: "rate-prospect-2",
        sent_at: "2026-08-01T11:00:00.000Z",
        payload: { resendId: "rate-provider-2", runId: "run-rates" },
      }),
    ],
    events: [
      event("campaign.run", "2026-08-01T09:00:00.000Z", {
        runId: "run-rates",
        target: "Measured campaign",
        status: "active",
      }, "run-meta"),
      event("resend.webhook", "2026-08-02T12:00:00.000Z", {
        type: "email.opened",
        email_id: "rate-provider-1",
      }, "rate-open"),
      event("resend.webhook", "2026-08-03T13:00:00.000Z", {
        type: "email.clicked",
        email_id: "rate-provider-1",
      }, "rate-click"),
      event("reply.draft", "2026-08-04T14:00:00.000Z", {
        inboundId: "rate-inbound",
        draftId: "rate-draft",
        prospectId: "rate-prospect-2",
      }, "rate-reply"),
    ],
  });

  assert.deepEqual(snapshot.funnel.map((row) => row.stage), ["sent", "opened", "clicked", "replied"]);
  assert.equal(snapshot.source.trackingBegan, "2026-08-01T10:00:00.000Z");
  assert.equal(snapshot.campaigns.length, 1);
  const row = snapshot.campaigns[0];
  assert.deepEqual({
    id: row.id,
    name: row.name,
    status: row.status,
    sent: row.sent,
    opens: row.opens,
    openRate: row.openRate,
    clicks: row.clicks,
    clickRate: row.clickRate,
    replies: row.replies,
    activityAt: row.activityAt,
  }, {
    id: "run-rates",
    name: "Campaign un-rates",
    status: "Active",
    sent: 2,
    opens: 1,
    openRate: 50,
    clicks: 1,
    clickRate: 50,
    replies: 1,
    activityAt: "2026-08-04T14:00:00.000Z",
  });
  assert.deepEqual(row.events.map(({ stage, at }) => ({ stage, at })), [
    { stage: "replied", at: "2026-08-04T14:00:00.000Z" },
    { stage: "clicked", at: "2026-08-03T13:00:00.000Z" },
    { stage: "opened", at: "2026-08-02T12:00:00.000Z" },
    { stage: "sent", at: "2026-08-01T11:00:00.000Z" },
    { stage: "sent", at: "2026-08-01T10:00:00.000Z" },
  ]);
  assert.deepEqual(snapshot.activity.slice(0, 3).map(({ stage, at, campaign: name }) => ({ stage, at, name })), [
    { stage: "replied", at: "2026-08-04T14:00:00.000Z", name: "Campaign un-rates" },
    { stage: "clicked", at: "2026-08-03T13:00:00.000Z", name: "Campaign un-rates" },
    { stage: "opened", at: "2026-08-02T12:00:00.000Z", name: "Campaign un-rates" },
  ]);
});

test("unobserved engagement stages are omitted; observed stages use the first real UTC event", () => {
  const sendsOnly = aggregateLedger({ emails: [email()], events: [] });
  assert.ok(byStage(sendsOnly, "sent"));
  assert.equal(byStage(sendsOnly, "opened"), undefined);
  assert.equal(byStage(sendsOnly, "clicked"), undefined);
  assert.equal(byStage(sendsOnly, "replied"), undefined);

  const measured = aggregateLedger({
    emails: [email()],
    events: [
      event("resend.webhook", "2026-08-02T23:59:00.000Z", { type: "email.opened", email_id: "re-1" }, "first-open"),
      event("resend.webhook", "2026-08-03T00:01:00.000Z", { type: "email.opened", email_id: "re-1" }, "repeat-open"),
      event("resend.webhook", "2026-08-03T00:02:00.000Z", { type: "email.clicked", email_id: "re-1" }, "first-click"),
      event("reply.draft", "2026-08-04T00:03:00.000Z", { inboundId: "in-1", draftId: "draft-1", prospectId: "prospect-1" }, "first-reply"),
    ],
  });
  assert.equal(day(measured, "2026-08-01").sent, 1);
  assert.equal(day(measured, "2026-08-02").opened, 1);
  assert.equal(day(measured, "2026-08-03").opened || 0, 0, "repeat opens do not move or add to the first-event series");
  assert.equal(day(measured, "2026-08-03").clicked, 1);
  assert.equal(day(measured, "2026-08-04").replied, 1);
});

test("empty aggregation is exact and does not invent engagement coverage", () => {
  const snapshot = aggregateLedger({ emails: [], events: [] });
  assert.equal(snapshot.empty, EMPTY);
  assert.equal(snapshot.summary.sent, 0);
  assert.deepEqual(snapshot.funnel, []);
  assert.equal(snapshot.series.available, false);
  assert.deepEqual(snapshot.series.days, []);
  assert.deepEqual(snapshot.campaigns, []);
  assert.deepEqual(snapshot.activity, []);
});

test("the protected payload is aggregate-only and carries no contact, copy, hash, provider, or prospect identifiers", async () => {
  const rows = {
    ghost_agency_email_log: [email({
      id: "private-email-row-id",
      prospect_id: "private-prospect-id",
      recipient_email: "owner@private.test",
      email_hash: "private-hash",
      sequence: "owner@private.test",
      payload: {
        resendId: "private-provider-id",
        runId: "safe-run-id",
        recipientEmail: "owner@private.test",
        subject: "Private subject",
        body: "Private body",
        rawPayload: "Private raw payload",
      },
    })],
    ghost_agency_events: [
      event("resend.webhook", "2026-08-02T01:00:00.000Z", {
        type: "email.opened",
        email_id: "private-provider-id",
        prospectId: "private-prospect-id",
        subject: "Private webhook subject",
        body: "Private webhook body",
      }, "private-event-id"),
      event("campaign.run", "2026-08-02T02:00:00.000Z", {
        runId: "safe-run-id",
        campaignName: "Private campaign owner@private.test",
        target: "Private target",
      }, "private-campaign-event"),
    ],
  };
  const handler = createLedgerDataHandler({
    methodGuard: () => true,
    requireAdmin: () => true,
    select: async (table) => ({ ok: true, data: rows[table] || [] }),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });
  const res = fakeRes();
  await handler(request(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), [
    "activity", "campaigns", "empty", "funnel", "generatedAt", "ok", "series", "source", "summary",
  ]);

  const forbiddenKeys = new Set([
    "email", "recipientEmail", "recipient_email", "fromEmail", "from_email",
    "body", "subject", "hash", "emailHash", "email_hash", "providerId", "provider_id",
    "resendId", "resend_id", "emailId", "email_id", "payload", "raw", "rawPayload",
    "prospectId", "prospect_id",
  ]);
  assert.deepEqual(payloadKeys(res.body).filter((key) => forbiddenKeys.has(key)), []);
  assert.doesNotMatch(JSON.stringify(res.body), /owner@private\.test|private-(?:email|prospect|provider|event|hash)|Private (?:subject|body|raw)/i);
});

test("ledger page is board-shaped, accessible at 390px, reduced-motion safe, and dependency-free", () => {
  const page = loadPage();
  for (const token of ["--carbon", "--ice", "--signal", "--hair", "--mono", "--sans"]) {
    assert.match(page, new RegExp(token));
  }
  assert.match(page, /Results/);
  assert.match(page, /Every send, open, and click[^<]*tracked and reconciled/i);
  assert.match(page, /tracking began/i, "source coverage must explain when persisted engagement tracking began");
  for (const label of ["Status", "Open rate", "Click rate", "Replies", "Activity"]) {
    assert.match(page, new RegExp(label, "i"), `campaign table is missing ${label}`);
  }
  assert.match(page, new RegExp(EMPTY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /<meta\s+name=["']viewport["'][^>]*width=device-width/i);
  assert.match(page, /\*\s*\{\s*box-sizing\s*:\s*border-box/i);
  assert.match(page, /overflow-x\s*:\s*hidden/i);
  assert.match(page, /min-width\s*:\s*0/i);
  assert.match(page, /:focus-visible/i);
  assert.match(page, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i);
  const mobileBreakpoints = [...page.matchAll(/@media\s*\(max-width\s*:\s*(\d+)px\)/gi)].map((match) => Number(match[1]));
  assert.ok(mobileBreakpoints.some((width) => width >= 390 && width <= 600), "390px needs a narrow-screen breakpoint");
  assert.match(page, /grid-template-columns\s*:\s*1fr/i);
  assert.doesNotMatch(page, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(page, /<link[^>]+\bhref=["']https?:/i);
  assert.doesNotMatch(page, /Cedar & Stone|Harbor Point Dental|Ridgeway Roofing|Summit Auto Detailing/,
    "the design board's demo campaigns must not ship in the real ledger");
  assert.match(page, /role=["']dialog["'][^>]*aria-modal=["']true["']/i);
  assert.match(page, /aria-live=["']polite["']/i);
  assert.match(page, /aria-expanded/i);
  assert.match(page, /aria-controls/i);
  for (const id of [
    "ledgerShell", "accessGate", "dataState", "ledgerContent", "emptyState", "kpiGrid",
    "funnelList", "trendChart", "chartRange", "campaignRows", "activityList",
    "sourceCoverage", "refreshButton", "exportButton",
  ]) {
    assert.match(page, new RegExp(`id=["']${id}["']`), `missing ledger hook #${id}`);
  }
  assert.match(page, /id=["']ledgerShell["'][^>]*data-state=/i);
  assert.match(page, /id=["']dataState["'][^>]*role=["']status["']/i);
  assert.match(page, /id=["']chartRange["'][^>]*role=["']group["']/i);
  for (const days of [7, 30, 90]) assert.match(page, new RegExp(`data-days=["']${days}["']`));
});

test("headline metrics pass through the shared voice and say what they mean", () => {
  // Plain-words pass 2026-08-16: the page is "Results", labels ride the
  // shared explain() voice, and every headline number carries a one-line
  // "what this means" built from the definitions the page already holds.
  const page = loadPage();
  const script = inlineScripts().join("\n");
  assert.match(page, /<h1>Results<\/h1>/);
  assert.match(script, /explain\(item\.label\)/, "metric labels must pass through the shared operator voice");
  assert.match(script, /METRIC_MEANINGS/);
  assert.match(script, /What this means: /);
  for (const meaning of [
    "Every email that really went out",
    "the share that got opened",
    "the share where someone clicked a link",
    "Businesses that wrote back",
  ]) {
    assert.ok(script.includes(meaning), `missing the plain meaning: ${meaning}`);
  }
  // The numbers stay big.
  assert.match(page, /\.kpi-value\s*\{[^}]*font-size:\s*30px/);
});

test("ledger controller parses, performs one authenticated read, and never puts the token in a URL", () => {
  const page = loadPage();
  const scripts = inlineScripts();
  assert.ok(scripts.length > 0, "ledger must include an inline controller");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `ledger-inline-${index}.js` }));
  });

  const script = scripts.join("\n");
  assert.doesNotMatch(script, /Math\.random\(/, "the ledger may not fabricate measured-looking activity");
  assert.match(script, /["']wsl_admin_token["']/);
  assert.match(script, /headers\[["']x-admin-token["']\]\s*=\s*token\(\)/);
  assert.equal((script.match(/\/api\/admin\/ledger-data/g) || []).length, 1);
  assert.doesNotMatch(script, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(script, /(?:URLSearchParams|location\.(?:search|hash)|params\.get|decodeURIComponent)/);
  assert.doesNotMatch(page, /[?&#](?:t|token|admin_token)=/i);
  assert.doesNotMatch(script, /innerHTML\s*=/, "store data must enter created nodes through textContent only");
  assert.doesNotMatch(script, /outerHTML\s*=|insertAdjacentHTML|DOMParser/,
    "no alternate HTML parser may receive store data");
  assert.match(script, /textContent\s*=/);
});

test("CSV export quotes every cell, doubles quotes, and guards spreadsheet formulas", () => {
  const page = loadPage();
  const script = inlineScripts().join("\n");
  assert.match(page, /Export CSV/i);
  assert.match(script, /text\/csv/i);
  assert.match(script, /createObjectURL/);
  assert.match(script, /revokeObjectURL/);
  assert.match(script, /\.replace\([^\n]*["']["'][^\n]*["']["']["']/,
    "CSV must double embedded quotes");
  assert.match(script, /\^\\s\*\[=\+@-\]/,
    "CSV must guard formulas even when dangerous prefixes follow whitespace");
  assert.match(script, /["']'["']/,
    "dangerous spreadsheet cells must receive a leading apostrophe");
  assert.match(script, /["']"["']\s*\+[^\n]+\+\s*["']"["']/,
    "every CSV field must be enclosed in quotes");
});
