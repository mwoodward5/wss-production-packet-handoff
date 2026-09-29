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

function loadCampaignHandler({ select, event, sendSequenceStep }) {
  const emailPath = require.resolve("../lib/email");
  const storePath = require.resolve("../lib/store");
  const routePath = require.resolve("../api/admin/run-campaign");
  const store = require(storePath);
  const originalEmailModule = require.cache[emailPath];
  const originals = {
    select: store.select,
    event: store.event,
  };

  store.select = select;
  store.event = event;
  require.cache[emailPath] = {
    id: emailPath,
    filename: emailPath,
    loaded: true,
    exports: { sendSequenceStep },
  };
  delete require.cache[routePath];
  const handler = require(routePath);

  store.select = originals.select;
  store.event = originals.event;
  if (originalEmailModule) require.cache[emailPath] = originalEmailModule;
  else delete require.cache[emailPath];
  return handler;
}

test("campaign preflights all email history and sends zero when a later dedup read fails", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "admin-test";
  const prospects = [
    { prospect_id: "campaign-1", business_name: "First Roofing", email: "first@example.test", status: "packeted" },
    { prospect_id: "campaign-2", business_name: "Second Roofing", email: "second@example.test", status: "packeted" },
  ];
  const events = [];
  let historyReads = 0;
  let sendCalls = 0;

  const handler = loadCampaignHandler({
    select: async (table) => {
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
    headers: { "x-admin-token": "admin-test" },
    body: { dryRun: true, batch: 2 },
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
  assert.equal(events[0].payload.prospectId, "campaign-2");
});

test("legacy campaign route refuses live prospect delivery before reads or sends", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "admin-test";
  let reads = 0;
  let events = 0;
  let sends = 0;
  const handler = loadCampaignHandler({
    select: async () => { reads += 1; throw new Error("must not read"); },
    event: async () => { events += 1; throw new Error("must not write"); },
    sendSequenceStep: async () => { sends += 1; throw new Error("must not send"); },
  });
  const response = responseCapture();

  await handler({
    method: "POST",
    headers: { "x-admin-token": "admin-test" },
    body: { dryRun: false, sandboxMode: false, batch: 2 },
  }, response);

  const payload = JSON.parse(response.body);
  assert.equal(response.statusCode, 409);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "live_blocked");
  assert.equal(payload.blocker, "live_campaign_requires_line_approval");
  assert.equal(payload.sent, 0);
  assert.match(payload.message, /\/api\/admin\/line/);
  assert.equal(reads, 0);
  assert.equal(events, 0);
  assert.equal(sends, 0);
});
