"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function responseCapture() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    end(body = "") { this.body = body; },
  };
}

function loadDripHandler({ select, event, sendSequenceStep }) {
  const emailPath = require.resolve("../lib/email");
  const storePath = require.resolve("../lib/store");
  const pausePath = require.resolve("../lib/delivery-pause");
  const routePath = require.resolve("../api/cron/drip-scheduler");
  const store = require(storePath);
  const pause = require(pausePath);
  const originalEmailModule = require.cache[emailPath];
  const originals = {
    select: store.select,
    event: store.event,
    deliveryPauseStatus: pause.deliveryPauseStatus,
  };

  store.select = select;
  store.event = event;
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: {
      reviewHoldActive: () => false,
      sendSequenceStep,
    },
  };
  pause.deliveryPauseStatus = async () => ({ active: false });
  delete require.cache[routePath];
  const handler = require(routePath);

  store.select = originals.select;
  store.event = originals.event;
  if (originalEmailModule) require.cache[emailPath] = originalEmailModule;
  else delete require.cache[emailPath];
  pause.deliveryPauseStatus = originals.deliveryPauseStatus;
  return handler;
}

test("drip preflights all email history and sends zero when a later dedup read fails", async () => {
  process.env.CRON_SECRET = "cron-test";
  process.env.GHOST_AGENCY_DRIP_BATCH = "2";
  const prospects = [
    { prospect_id: "drip-1", business_name: "First Plumbing", email: "first@example.test", status: "packeted" },
    { prospect_id: "drip-2", business_name: "Second Plumbing", email: "second@example.test", status: "packeted" },
  ];
  const events = [];
  let historyReads = 0;
  let sendCalls = 0;

  const handler = loadDripHandler({
    select: async (table, query) => {
      if (table === "ghost_agency_email_log" && query === "?select=sequence&limit=1") {
        return { ok: true, data: [] };
      }
      if (table === "ghost_agency_prospects") return { ok: true, data: prospects };
      if (table === "ghost_agency_email_log") {
        historyReads += 1;
        return historyReads === 1
          ? { ok: true, data: [] }
          : { ok: false, status: 503, mode: "provider_error" };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    event: async (entry) => {
      events.push(entry);
      return { mode: "live_write" };
    },
    sendSequenceStep: async () => {
      sendCalls += 1;
      return { ok: true, mode: "sent" };
    },
  });
  const response = responseCapture();

  await handler({
    method: "POST",
    headers: { authorization: "Bearer cron-test" },
  }, response);

  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "dedup_blocked");
  assert.equal(payload.blocker, "ghost_agency_email_log_unavailable");
  assert.equal(payload.sent, 0);
  assert.equal(historyReads, 2);
  assert.equal(sendCalls, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "failed");
  assert.equal(events[0].payload.prospectId, "drip-2");
});

test("drip never carries retired preview, report, or checkout vars into consent outreach", async () => {
  process.env.CRON_SECRET = "cron-test";
  process.env.GHOST_AGENCY_DRIP_BATCH = "1";
  const prospect = {
    prospect_id: "drip-clean-vars",
    business_name: "Clean Vars Roofing",
    email: "clean@example.test",
    status: "packeted",
    city: "Irvine",
    services: ["roofing"],
    preview_url: "https://legacy-preview.example.test",
    report_url: "https://legacy-report.example.test",
    checkout_url: "https://legacy-checkout.example.test",
  };
  let sendInput = null;

  const handler = loadDripHandler({
    select: async (table, query) => {
      if (table === "ghost_agency_email_log" && query === "?select=sequence&limit=1") {
        return { ok: true, data: [] };
      }
      if (table === "ghost_agency_prospects") return { ok: true, data: [prospect] };
      if (table === "ghost_agency_email_log") return { ok: true, data: [] };
      throw new Error(`unexpected table: ${table}`);
    },
    event: async () => ({ mode: "live_write" }),
    sendSequenceStep: async (input) => {
      sendInput = input;
      return { ok: true, mode: "sent" };
    },
  });
  const response = responseCapture();

  await handler({
    method: "POST",
    headers: { authorization: "Bearer cron-test" },
  }, response);

  assert.equal(JSON.parse(response.body).ok, true);
  assert.ok(sendInput);
  assert.deepEqual(Object.keys(sendInput.vars).sort(), ["keyword_1", "run_id"]);
  assert.equal(sendInput.vars.keyword_1, "roofing Irvine");
  assert.equal(Object.hasOwn(sendInput.vars, "preview_url"), false);
  assert.equal(Object.hasOwn(sendInput.vars, "report_url"), false);
  assert.equal(Object.hasOwn(sendInput.vars, "checkout_url"), false);
});
