"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");

function withOwnerMailHarness(run) {
  const originalStore = require.cache[storePath];
  const originalEmail = require.cache[emailPath];
  const originalFetch = global.fetch;
  const saved = {
    key: process.env.RESEND_API_KEY,
    owner: process.env.GHOST_AGENCY_OWNER_EMAIL,
    from: process.env.GHOST_AGENCY_OUTREACH_FROM,
    cc: process.env.GHOST_AGENCY_OUTREACH_CC,
  };
  const deliveries = [];
  const requests = [];
  process.env.RESEND_API_KEY = "test-key";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.test";
  process.env.GHOST_AGENCY_OUTREACH_FROM = "WSS <hello@go.wss-ai.com>";
  process.env.GHOST_AGENCY_OUTREACH_CC = "prospect-copy@example.test";
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: { recordEvent: async () => {}, select: async () => ({ ok: true, data: [] }), upsertRow: async () => ({ ok: true }) },
  };
  global.fetch = async (_url, options) => {
    requests.push(options);
    deliveries.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ id: "owner-proof-message" }) };
  };
  delete require.cache[emailPath];
  const email = require("../lib/email");
  return Promise.resolve()
    .then(() => run({ email, deliveries, requests }))
    .finally(() => {
      global.fetch = originalFetch;
      for (const [name, value] of Object.entries(saved)) {
        const envName = ({ key: "RESEND_API_KEY", owner: "GHOST_AGENCY_OWNER_EMAIL", from: "GHOST_AGENCY_OUTREACH_FROM", cc: "GHOST_AGENCY_OUTREACH_CC" })[name];
        if (value === undefined) delete process.env[envName];
        else process.env[envName] = value;
      }
      if (originalStore) require.cache[storePath] = originalStore;
      else delete require.cache[storePath];
      if (originalEmail) require.cache[emailPath] = originalEmail;
      else delete require.cache[emailPath];
    });
}

test("owner-proof send blocks any CC or BCC before the provider call", async () => {
  await withOwnerMailHarness(async ({ email, deliveries }) => {
    const result = await email.sendResendEmail({
      senderKind: "outreach",
      to: "owner@example.test",
      cc: ["prospect-copy@example.test"],
      bcc: ["hidden-prospect@example.test"],
      internalOwnerProof: true,
      subject: "Proof",
      text: "Proof",
      html: "<p>Proof</p>",
    });
    assert.equal(result.blocked, "owner_proof_recipient_gate_failed");
    assert.equal(deliveries.length, 0);
  });
});

test("owner-proof send ignores configured outreach CC and sends only to the owner", async () => {
  await withOwnerMailHarness(async ({ email, deliveries }) => {
    const result = await email.sendResendEmail({
      senderKind: "outreach",
      to: "owner@example.test",
      internalOwnerProof: true,
      subject: "Proof",
      text: "Proof",
      html: "<p>Proof</p>",
    });
    assert.equal(result.mode, "sent");
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].to, "owner@example.test");
    assert.equal(deliveries[0].cc, undefined);
    assert.equal(deliveries[0].bcc, undefined);
  });
});

test("owner-proof send makes no provider call after its request deadline", async () => {
  await withOwnerMailHarness(async ({ email, deliveries }) => {
    const result = await email.sendResendEmail({
      senderKind: "outreach",
      to: "owner@example.test",
      internalOwnerProof: true,
      deadlineAt: 10_000,
      now: () => 10_001,
      subject: "Proof",
      text: "Proof",
      html: "<p>Proof</p>",
    });
    assert.equal(result.mode, "send_blocked");
    assert.equal(result.blocked, "owner_proof_deadline_exhausted");
    assert.equal(deliveries.length, 0);
  });
});

test("owner-proof provider timeout is capped below both the remaining deadline and ten seconds", async () => {
  await withOwnerMailHarness(async ({ email, requests }) => {
    const originalTimeout = AbortSignal.timeout;
    const captured = [];
    const signal = { ownerProofTestSignal: true };
    AbortSignal.timeout = (milliseconds) => {
      captured.push(milliseconds);
      return signal;
    };
    try {
      const result = await email.sendResendEmail({
        senderKind: "outreach",
        to: "owner@example.test",
        internalOwnerProof: true,
        deadlineAt: 120_000,
        now: () => 100_000,
        subject: "Proof",
        text: "Proof",
        html: "<p>Proof</p>",
      });
      assert.equal(result.mode, "sent");
      assert.deepEqual(captured, [10_000]);
      assert.equal(requests[0].signal, signal);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  });
});

test("ordinary Resend network rejection still bubbles so autosend can retry", async () => {
  await withOwnerMailHarness(async ({ email }) => {
    global.fetch = async () => {
      throw new Error("temporary provider network failure");
    };
    await assert.rejects(
      email.sendResendEmail({
        senderKind: "outreach",
        to: "prospect@example.test",
        internalOwnerProof: false,
        subject: "Prospect",
        text: "Prospect",
        html: "<p>Prospect</p>",
      }),
      /temporary provider network failure/,
    );
  });
});

test("email module exposes no legacy outreach renderer or screenshot helpers", () => {
  const email = require("../lib/email");
  for (const name of [
    "mshotsUrl",
    "emailProofShots",
    "warmPreviewShotForSend",
    "outreachHtml",
    "deliverableSubject",
  ]) {
    assert.equal(Object.hasOwn(email, name), false, `${name} must stay retired`);
  }
});

test("owner-proof log rows cannot advance a prospect drip sequence", () => {
  const scheduler = require("../api/cron/drip-scheduler");
  const ownerProof = {
    sequence: 1,
    step: 1,
    sent_at: "2026-07-01T00:00:00.000Z",
    suppressed: false,
    payload: { ownerProof: true, sandbox: true, deliveryLane: "owner_only_proof", isProspectSend: false },
  };
  assert.equal(scheduler.isOwnerProofLog(ownerProof), true);
  assert.deepEqual(scheduler.nextStep([ownerProof]), { step: 1, dueAt: 0 });

  const realProspectSend = {
    ...ownerProof,
    payload: { ownerProof: false, sandbox: false, deliveryLane: "prospect", isProspectSend: true },
  };
  assert.equal(scheduler.isOwnerProofLog(realProspectSend), false);
  assert.equal(scheduler.nextStep([realProspectSend]).step, 2);
});
