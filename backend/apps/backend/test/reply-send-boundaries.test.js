"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { onReportViewed } = require("../lib/hot-view");
const emailInbound = require("../api/webhooks/email-inbound");
const replyQueue = require("../api/admin/reply-queue");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restore() {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

afterEach(restore);

function jsonResponse(status, json = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => json,
  };
}

function responseCapture() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    end(body = "") { this.body = body; },
  };
}

function configureProviderHarness(fetchImpl) {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "admin-test";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.RESEND_API_KEY = "resend-test";
  process.env.GHOST_AGENCY_RESEND_FROM = "WSS Labs <hello@example.test>";
  process.env.GHOST_AGENCY_EMAIL_FROM = "WSS Labs <hello@example.test>";
  process.env.GHOST_AGENCY_REPLY_AUTOPILOT = "true";
  delete process.env.ANTHROPIC_API_KEY;
  global.fetch = fetchImpl;
}

test("hot-view always queues a pending owner-review draft even with legacy autopilot enabled", async () => {
  const writes = [];
  let providerCalls = 0;
  configureProviderHarness(async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.resend.com/")) {
      providerCalls += 1;
      return jsonResponse(200, { id: "must-not-send" });
    }
    const parsed = new URL(target);
    const table = parsed.pathname.split("/").pop();
    if ((!init.method || init.method === "GET") && table === "ghost_agency_prospects") {
      return jsonResponse(200, [{
        prospect_id: "prospect-hot-1",
        business_name: "Hot View Roofing",
        email: "owner@hot-view.example",
        status: "previewed",
        record: {},
      }]);
    }
    if ((!init.method || init.method === "GET") && table === "ghost_agency_events") {
      return jsonResponse(200, []);
    }
    if (init.method === "POST" && table === "ghost_agency_events") {
      const body = JSON.parse(init.body);
      writes.push(body);
      return jsonResponse(201, [body]);
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${target}`);
  });

  const result = await onReportViewed({ prospectId: "prospect-hot-1" });

  assert.equal(result.action, "draft_queued");
  assert.equal(providerCalls, 0);
  const draft = writes.find((row) => row.type === "reply.draft");
  assert.ok(draft);
  assert.equal(draft.payload.approval, "pending");
  assert.equal(writes.some((row) => row.type === "reply.sent"), false);
});

test("inbound replies always queue approval even with legacy autopilot enabled", async () => {
  const writes = [];
  let providerCalls = 0;
  configureProviderHarness(async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.resend.com/")) {
      providerCalls += 1;
      return jsonResponse(200, { id: "must-not-send" });
    }
    const parsed = new URL(target);
    const table = parsed.pathname.split("/").pop();
    if ((!init.method || init.method === "GET") && table === "ghost_agency_prospects") {
      return jsonResponse(200, [{
        prospect_id: "prospect-reply-1",
        business_name: "Reply Roofing",
        email: "owner@reply.example",
        status: "previewed",
        record: { existing: true },
      }]);
    }
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      writes.push({ table, body });
      return jsonResponse(201, [body]);
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${target}`);
  });
  const response = responseCapture();

  await emailInbound({
    method: "POST",
    headers: { "x-admin-token": "admin-test" },
    body: {
      from: "Owner@Reply.example",
      text: "Yes, please build the custom preview",
      subject: "Re: website",
    },
  }, response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.action, "draft_queued");
  assert.equal(providerCalls, 0);
  const draft = writes.find((write) => write.table === "ghost_agency_events" && write.body.type === "reply.draft");
  assert.ok(draft);
  assert.equal(draft.body.payload.approval, "pending");
  assert.equal(
    writes.some((write) => write.table === "ghost_agency_events" && write.body.type === "reply.sent"),
    false,
  );
});

function replyQueueHarness({
  suppressionRows = [],
  suppressionStatus = 200,
  pauseRows = [{
    type: "outreach.delivery_pause",
    payload: { active: false, reason: "" },
    created_at: "2026-07-29T11:59:00.000Z",
  }],
  pauseStatus = 200,
} = {}) {
  const order = [];
  const writes = [];
  let providerCalls = 0;
  let providerHeaders = null;
  configureProviderHarness(async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.resend.com/")) {
      order.push("provider_send");
      providerCalls += 1;
      providerHeaders = init.headers || {};
      return jsonResponse(200, { id: "reply-provider-1" });
    }
    const parsed = new URL(target);
    const table = parsed.pathname.split("/").pop();
    if ((!init.method || init.method === "GET") && table === "ghost_agency_events") {
      if (parsed.searchParams.get("type") === "eq.outreach.delivery_pause") {
        order.push("pause_read");
        return jsonResponse(pauseStatus, pauseRows);
      }
      order.push("draft_read");
      return jsonResponse(200, [{
        id: "event-draft-1",
        type: "reply.draft",
        created_at: "2026-07-29T12:00:00.000Z",
        payload: {
          draftId: "draft-1",
          prospectId: "prospect-reply-1",
          fromEmail: "owner@reply.example",
          subject: "Re: website",
          body: "Thanks for your reply.",
          approval: "pending",
        },
      }]);
    }
    if ((!init.method || init.method === "GET") && table === "ghost_agency_suppressions") {
      order.push("suppression_read");
      return jsonResponse(suppressionStatus, suppressionRows);
    }
    if (init.method === "POST" && table === "ghost_agency_events") {
      order.push("event_write");
      const body = JSON.parse(init.body);
      writes.push(body);
      return jsonResponse(201, [body]);
    }
    throw new Error(`Unexpected request: ${init.method || "GET"} ${target}`);
  });
  return {
    order,
    writes,
    providerCalls: () => providerCalls,
    providerHeaders: () => providerHeaders,
  };
}

function approvalRequest() {
  return {
    method: "POST",
    headers: { "x-admin-token": "admin-test" },
    body: { draftId: "draft-1", action: "approve" },
  };
}

test("reply approval rechecks STOP/bounce suppression and never calls the provider", async () => {
  for (const reason of ["reply_opt_out", "email_bounced"]) {
    const harness = replyQueueHarness({
      suppressionRows: [{
        suppression_key: `suppressed-${reason}`,
        email: "owner@reply.example",
        prospect_id: "prospect-reply-1",
        reason,
      }],
    });
    const response = responseCapture();

    await replyQueue(approvalRequest(), response);

    assert.equal(response.statusCode, 409, reason);
    assert.equal(JSON.parse(response.body).error, "reply_recipient_suppressed");
    assert.equal(harness.providerCalls(), 0);
    assert.deepEqual(harness.order, ["draft_read", "suppression_read"]);
    assert.equal(harness.writes.some((row) => row.type === "reply.sent"), false);
  }
});

test("reply approval fails closed when the suppression recheck is unavailable", async () => {
  const harness = replyQueueHarness({ suppressionStatus: 503 });
  const response = responseCapture();

  await replyQueue(approvalRequest(), response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "reply_suppression_check_unavailable");
  assert.equal(harness.providerCalls(), 0);
  assert.deepEqual(harness.order, ["draft_read", "suppression_read"]);
});

test("reply approval refuses before the provider while delivery is paused", async () => {
  const harness = replyQueueHarness({
    pauseRows: [{
      type: "outreach.delivery_pause",
      payload: { active: true, reason: "owner_stop_button" },
      created_at: "2026-07-29T12:01:00.000Z",
    }],
  });
  const response = responseCapture();

  await replyQueue(approvalRequest(), response);

  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error, "owner_stop_button");
  assert.equal(harness.providerCalls(), 0);
  assert.deepEqual(harness.order, ["draft_read", "suppression_read", "pause_read"]);
  assert.equal(harness.writes.some((row) => row.type === "reply.sent"), false);
});

test("reply approval fails closed before the provider when pause state is unreadable", async () => {
  const harness = replyQueueHarness({ pauseStatus: 503, pauseRows: [] });
  const response = responseCapture();

  await replyQueue(approvalRequest(), response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "delivery_pause_status_unavailable");
  assert.equal(harness.providerCalls(), 0);
  assert.deepEqual(harness.order, ["draft_read", "suppression_read", "pause_read"]);
  assert.equal(harness.writes.some((row) => row.type === "reply.sent"), false);
});

test("a clear approval checks suppression immediately before its one provider send", async () => {
  const harness = replyQueueHarness();
  const response = responseCapture();

  await replyQueue(approvalRequest(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).action, "sent");
  assert.equal(harness.providerCalls(), 1);
  assert.deepEqual(harness.order.slice(0, 4), ["draft_read", "suppression_read", "pause_read", "provider_send"]);
  assert.equal(harness.providerHeaders()["Idempotency-Key"], "ghost-reply/draft-1");
  assert.equal(harness.writes.some((row) => row.type === "reply.sent"), true);
});
