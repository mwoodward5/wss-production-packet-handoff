"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTOSEND_KEY,
  CONSENT_FIRST_REASON,
  abandonPendingAutosend,
  newAutosendIntent,
  isAutosendPending,
  deliverAutosend,
} = require("../lib/autosend");

// Consent-first outreach retires the former build-finished -> provider-send
// bridge. The reconciler still reads legacy pending rows only to abandon them.

function rowWith(intent, over = {}) {
  return {
    prospect_id: "place-test-1",
    preview_url: "https://acme-roofing.wss-ai.com/",
    report_url: "https://callprep.wss-ai.com/report/abc",
    record: { business_name: "Acme Roofing", email: "stranger@prospect.example", [AUTOSEND_KEY]: intent },
    ...over,
  };
}

function deps() {
  const calls = [];
  return {
    calls,
    sendSequenceStep: async (args) => {
      calls.push(args);
      return { ok: true, mode: "sent", id: "must-not-happen" };
    },
  };
}

test("new callers cannot create a pending autosend intent", () => {
  const retired = newAutosendIntent({ runId: "run_1", sandboxMode: false, now: "2026-07-29T12:00:00.000Z" });
  assert.equal(retired.status, "abandoned");
  assert.equal(retired.reason, CONSENT_FIRST_REASON);
  assert.equal(retired.settled_at, "2026-07-29T12:00:00.000Z");
  assert.equal(isAutosendPending(rowWith(retired)), false);
  assert.equal(isAutosendPending({ record: {} }), false, "no intent => nothing to deliver");
});

test("a legacy SANDBOX pending intent is abandoned without any provider call", async () => {
  const d = deps();
  const legacy = { run_id: "r", sandbox_mode: true, requested_at: "2026-07-28T00:00:00.000Z", status: "pending" };
  const out = await deliverAutosend(rowWith(legacy), d);
  assert.equal(out.sent, false);
  assert.equal(out.skipped, CONSENT_FIRST_REASON);
  assert.equal(d.calls.length, 0);
  assert.equal(out.intent.status, "abandoned");
  assert.equal(out.intent.reason, CONSENT_FIRST_REASON);
});

test("a legacy NON-sandbox pending intent is also abandoned without sending", async () => {
  const d = deps();
  const legacy = { run_id: "r", sandbox_mode: false, requested_at: "2026-07-28T00:00:00.000Z", status: "pending" };
  const out = await deliverAutosend(rowWith(legacy), d);
  assert.equal(out.sent, false);
  assert.equal(out.skipped, CONSENT_FIRST_REASON);
  assert.equal(out.intent.status, "abandoned");
  assert.equal(d.calls.length, 0);
});

test("idempotent: an already-settled intent is never re-sent", async () => {
  const d = deps();
  const settled = { run_id: "r", status: "sent", settled_at: "2026-07-28T00:00:00.000Z" };
  const out = await deliverAutosend(rowWith(settled), d);
  assert.equal(out.sent, false);
  assert.equal(out.skipped, "not_pending");
  assert.equal(d.calls.length, 0, "repeated cron passes must not double-email a prospect");
});

test("abandonPendingAutosend changes only legacy pending state", () => {
  const pending = { run_id: "r", status: "pending" };
  const abandoned = abandonPendingAutosend(pending);
  assert.equal(abandoned.status, "abandoned");
  assert.equal(abandoned.reason, CONSENT_FIRST_REASON);
  assert.equal(abandonPendingAutosend({ status: "sent" }).status, "sent");
  assert.equal(abandonPendingAutosend(null), null);
});
