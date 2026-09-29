"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { sendResendEmail } = require("../lib/email");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("sendResendEmail forwards a stable provider idempotency key", async () => {
  process.env.RESEND_API_KEY = "resend-test";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  process.env.GHOST_AGENCY_RESEND_FROM = "WSS Labs <hello@example.test>";
  let providerRequest = null;
  global.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    providerRequest = init;
    return response(200, { id: "provider-idempotent-1" });
  };

  const result = await sendResendEmail({
    internalOwnerProof: true,
    to: "owner@example.test",
    subject: "Proof",
    text: "Owner-only proof",
    idempotencyKey: "ghost-outreach-test-key",
  });

  assert.equal(result.mode, "sent");
  assert.equal(providerRequest.headers["Idempotency-Key"], "ghost-outreach-test-key");
  assert.equal(result.idempotencyKey, "ghost-outreach-test-key");
});

test("outreach uses the dedicated Resend receiving mailbox for replies", async () => {
  process.env.RESEND_API_KEY = "resend-test";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  process.env.GHOST_AGENCY_OUTREACH_FROM = "WSS Labs <hello@example.test>";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  process.env.GHOST_AGENCY_OUTREACH_REPLY_TO = "replies@go.wss-ai.com";
  let providerBody = null;
  global.fetch = async (_url, init = {}) => {
    providerBody = JSON.parse(init.body);
    return response(200, { id: "provider-reply-to-1" });
  };

  const result = await sendResendEmail({
    senderKind: "outreach",
    internalOwnerProof: true,
    to: "owner@example.test",
    subject: "Proof",
    text: "Owner-only proof",
  });

  assert.equal(result.mode, "sent");
  assert.equal(providerBody.reply_to, "replies@go.wss-ai.com");
});

test("an oversized idempotency key fails before the provider", async () => {
  process.env.RESEND_API_KEY = "resend-test";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  process.env.GHOST_AGENCY_RESEND_FROM = "WSS Labs <hello@example.test>";
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  };

  const result = await sendResendEmail({
    internalOwnerProof: true,
    to: "owner@example.test",
    subject: "Proof",
    text: "Owner-only proof",
    idempotencyKey: "x".repeat(257),
  });

  assert.equal(result.mode, "send_blocked");
  assert.equal(result.blocked, "invalid_idempotency_key");
  assert.equal(providerCalls, 0);
});
