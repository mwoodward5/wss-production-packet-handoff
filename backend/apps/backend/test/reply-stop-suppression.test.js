"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { classifyIntent, draftReply } = require("../lib/reply-agent");
const emailInbound = require("../api/webhooks/email-inbound");

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

function configureInbound({
  failTable = "",
  autopilot = true,
  prospectRecord = { existing_field: "preserved" },
} = {}) {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "admin-test";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.GHOST_AGENCY_REPLY_AUTOPILOT = autopilot ? "true" : "false";
  process.env.RESEND_API_KEY = "resend-test";
  process.env.GHOST_AGENCY_EMAIL_FROM = "WSS Labs <hello@example.test>";
  delete process.env.ANTHROPIC_API_KEY;

  const writes = [];
  let providerCalls = 0;
  global.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://api.resend.com/")) {
      providerCalls += 1;
      throw new Error("STOP must never reach the email provider");
    }

    const parsed = new URL(target);
    const table = parsed.pathname.split("/").pop();
    if ((!init.method || init.method === "GET") && table === "ghost_agency_prospects") {
      return jsonResponse(200, [{
        prospect_id: "prospect-stop-1",
        business_name: "Stop Test Roofing",
        email: "owner@example.test",
        status: "previewed",
        record: prospectRecord,
      }]);
    }

    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      writes.push({ table, body });
      if (table === failTable) return jsonResponse(503, { code: "XX000" });
      return jsonResponse(201, [body]);
    }

    throw new Error(`Unexpected request: ${init.method || "GET"} ${target}`);
  };

  return {
    writes,
    providerCalls: () => providerCalls,
  };
}

function stopRequest(text = "STOP") {
  return {
    method: "POST",
    headers: { "x-admin-token": "admin-test" },
    body: {
      from: "Owner@Example.test",
      text,
      subject: "Re: website",
    },
  };
}

test("bare STOP is case-insensitive and existing opt-out phrases still classify as opt_out", () => {
  for (const text of [
    "STOP",
    "stop",
    " Stop! ",
    "unsubscribe",
    "opt out",
    "stop emailing",
    "stop contacting",
    "remove me",
    "not interested",
    "no thanks",
    "take me off",
    "do not contact",
    "do not email",
  ]) {
    assert.equal(classifyIntent(text), "opt_out", text);
  }
  assert.equal(classifyIntent("Can you stop by tomorrow?"), "question");
});

test("quoted compliance footer STOP is excluded from a positive latest reply", () => {
  const latest = emailInbound.latestReplyText(
    "Yes, please build the custom preview.\n\nOn Tue, Mark wrote:\nNot interested? Reply STOP and you won't hear from me again.",
  );
  assert.equal(latest, "Yes, please build the custom preview.");
  assert.equal(classifyIntent(latest), "interested");
});

test("positive reply copy offers a custom preview and never claims one is already live", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const result = await draftReply({
    prospect: {
      business_name: "Example Roofing",
      preview_url: "https://old-preview.example.test",
      checkout_url: "https://checkout.example.test",
    },
    inboundText: "Yes, I am interested",
  });

  assert.equal(result.intent, "interested");
  assert.match(result.draft.text, /build a free custom preview/i);
  assert.match(result.draft.text, /with your input/i);
  assert.doesNotMatch(result.draft.text, /already|is live|checkout|old-preview|checkout\.example/i);
});

test("inbound STOP durably suppresses and marks the matching prospect without drafting or sending", async () => {
  const state = configureInbound();
  const response = responseCapture();

  await emailInbound(stopRequest("sToP"), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    intent: "opt_out",
    action: "suppressed",
  });

  const suppression = state.writes.find((write) => write.table === "ghost_agency_suppressions");
  assert.equal(suppression.body.suppression_key, "prospect-stop-1");
  assert.equal(suppression.body.email, "owner@example.test");
  assert.equal(suppression.body.prospect_id, "prospect-stop-1");
  assert.equal(suppression.body.reason, "reply_opt_out");
  assert.equal(suppression.body.source, "email_inbound");

  const prospect = state.writes.find((write) => write.table === "ghost_agency_prospects");
  assert.equal(prospect.body.prospect_id, "prospect-stop-1");
  assert.equal(prospect.body.status, "do_not_contact");

  const eventTypes = state.writes
    .filter((write) => write.table === "ghost_agency_events")
    .map((write) => write.body.type);
  assert.deepEqual(eventTypes, ["reply.received", "reply.opt_out"]);
  assert.equal(state.providerCalls(), 0);
});

test("inbound STOP fails closed when the suppression write is not durable", async () => {
  const state = configureInbound({ failTable: "ghost_agency_suppressions" });
  const response = responseCapture();

  await emailInbound(stopRequest(), response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "reply_opt_out_persistence_failed");
  assert.equal(state.writes.some((write) => write.table === "ghost_agency_prospects"), false);
  assert.equal(
    state.writes.some((write) => ["reply.draft", "reply.sent"].includes(write.body.type)),
    false,
  );
  assert.equal(state.providerCalls(), 0);
});

test("inbound STOP fails closed when the matching prospect cannot be marked do_not_contact", async () => {
  const state = configureInbound({ failTable: "ghost_agency_prospects" });
  const response = responseCapture();

  await emailInbound(stopRequest(), response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "reply_opt_out_persistence_failed");
  assert.equal(state.writes.some((write) => write.table === "ghost_agency_suppressions"), true);
  assert.equal(
    state.writes.some((write) => ["reply.draft", "reply.sent"].includes(write.body.type)),
    false,
  );
  assert.equal(state.providerCalls(), 0);
});

test("an interested reply durably grants preview-build consent without losing existing record fields", async () => {
  const existingRecord = {
    existing_field: "keep-me",
    nested: { value: 42 },
  };
  const state = configureInbound({ autopilot: false, prospectRecord: existingRecord });
  const response = responseCapture();

  await emailInbound(stopRequest("Yes, I am interested"), response);

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.intent, "interested");
  assert.equal(payload.action, "draft_queued");

  const prospectWrites = state.writes.filter((write) => write.table === "ghost_agency_prospects");
  assert.equal(prospectWrites.length, 1);
  const updated = prospectWrites[0].body;
  assert.equal(updated.prospect_id, "prospect-stop-1");
  assert.equal(updated.status, "engaged");
  assert.equal(updated.record.existing_field, "keep-me");
  assert.deepEqual(updated.record.nested, { value: 42 });
  assert.deepEqual(updated.record.preview_build_consent, {
    status: "granted",
    recorded_at: updated.updated_at,
    source: "email_reply",
  });
  assert.equal(Number.isNaN(Date.parse(updated.record.preview_build_consent.recorded_at)), false);

  const eventTypes = state.writes
    .filter((write) => write.table === "ghost_agency_events")
    .map((write) => write.body.type);
  assert.deepEqual(eventTypes, ["reply.received", "reply.draft"]);
  assert.equal(state.providerCalls(), 0);
});

test("an interested reply fails closed before drafting when consent persistence fails", async () => {
  const state = configureInbound({
    failTable: "ghost_agency_prospects",
    autopilot: true,
  });
  const response = responseCapture();

  await emailInbound(stopRequest("Yes, please build the custom preview"), response);

  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "reply_consent_persistence_failed");
  const eventTypes = state.writes
    .filter((write) => write.table === "ghost_agency_events")
    .map((write) => write.body.type);
  assert.deepEqual(eventTypes, ["reply.received"]);
  assert.equal(state.writes.some((write) => write.table === "ghost_agency_suppressions"), false);
  assert.equal(state.providerCalls(), 0);
});
