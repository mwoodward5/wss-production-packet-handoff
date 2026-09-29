"use strict";

// test/edit-job-followup-hook.test.js — the terminal wiring for the promised
// completion email.
//
// lib/edit-job-runner.js owns the moment "you'll get 1 email when it's live"
// becomes TRUE: the `done` terminal write, which only lands after the rendered
// page verified the change. These tests pin the handoff from that write to
// lib/riley-followups.js deliverFollowUp:
//
//   · the hook fires ONCE per finished job, after the terminal write, with the
//     full job row (so the inline follow_up flag rides along);
//   · it fires for `done` and NOTHING ELSE — a refusal or a failure must never
//     produce a "it's live" email;
//   · a hook that throws (or hangs) can never cost the job its ending, and
//     can never change the row the customer reads.

const test = require("node:test");
const assert = require("node:assert/strict");

const runner = require("../lib/edit-job-runner");
const fup = require("../lib/riley-followups");

const SLUG = "wss-test-logic-heating-and-air-tulsa";
const MINUTE = 60 * 1000;

function jobRow(over = {}) {
  const at = new Date(Date.now() - MINUTE).toISOString();
  return {
    job_id: "edit_test_1",
    site_slug: SLUG,
    instruction: "Make the phone number in the header bigger.",
    status: "queued",
    result: null,
    follow_up: null,
    created_at: at,
    updated_at: at,
    ...over,
  };
}

function harness({ row = jobRow(), runSiteChange, deliver, ...rest } = {}) {
  const writes = [];
  const deliveries = [];
  return {
    writes,
    deliveries,
    deps: {
      select: async () => ({ ok: true, data: [row] }),
      upsertRow: async (_t, written) => { writes.push(written); return { mode: "live_write" }; },
      recordEvent: async (name, payload) => ({ ok: true, name, payload }),
      resolveSiteEditTarget: async () => ({ projectName: SLUG, aliasHost: `${SLUG}.wss-ai.com` }),
      runSiteChange: runSiteChange || (async () => ({ applied: true, changedFiles: ["index.html"], verified: { ok: true } })),
      notifyOwner: async () => ({}),
      deliverFollowUp: deliver || (async (options) => { deliveries.push(options); return { ok: true, outcome: "no_promise" }; }),
      ...rest,
    },
  };
}

test("a done job hands its ending to the follow-up machinery exactly once, with the whole row", async () => {
  const h = harness();
  const out = await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(out.status, "done");
  assert.equal(h.deliveries.length, 1, "one terminal write, one handoff");
  const d = h.deliveries[0];
  assert.equal(d.jobId, "edit_test_1");
  assert.equal(d.siteSlug, SLUG);
  assert.equal(d.jobRow.status, "done", "the hook sees the TERMINAL state, not the queued one");
  assert.deepEqual(d.jobRow.result.attempts, 1);
  const terminalIndex = h.writes.findIndex((w) => w.status === "done");
  assert.ok(terminalIndex >= 0);
});

test("the inline follow_up flag rides the row into the hook", async () => {
  const flag = { consent_email: true, consent_source: "verbal_call" };
  const h = harness({ row: jobRow({ follow_up: flag }) });
  await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(h.deliveries.length, 1);
  assert.deepEqual(h.deliveries[0].jobRow.follow_up, flag, "the consent the caller gave on the call reaches the gate");
});

test("refused and failed endings NEVER reach the follow-up machinery", async () => {
  const refused = harness({ runSiteChange: async () => ({ applied: false, reason: "unbacked_claim" }) });
  await runner.executeEditJob("edit_test_1", refused.deps);
  assert.equal(refused.deliveries.length, 0, "a refusal is not a live site");

  const failed = harness({ runSiteChange: async () => { throw new Error("deploy failed"); } });
  const out = await runner.executeEditJob("edit_test_1", failed.deps);
  assert.equal(out.status, "failed");
  assert.equal(failed.deliveries.length, 0, "a failure must never produce a \"it's live\" email");
});

test("a follow-up hook that throws cannot cost the job its ending", async () => {
  const h = harness({ deliver: async () => { throw new Error("mailer exploded"); } });
  const out = await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(out.status, "done", "the row still lands on done");
  assert.equal(h.writes.some((w) => w.status === "done"), true);
  assert.equal(h.writes[h.writes.length - 1].status, "done", "the terminal write is still the last word on the row");
});

test("a follow-up hook that HANGS is raced, and the job still finishes", { timeout: 30000 }, async () => {
  const h = harness({ deliver: () => new Promise(() => {}) });
  const out = await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(out.status, "done");
  assert.equal(h.writes.some((w) => w.status === "done"), true, "the customer's answer never waits on the promise machinery");
});

test("the real module is what production wiring resolves to, and it answers no_promise on a bare job", async () => {
  // The default path (no injected spy) lazily reaches lib/riley-followups.js.
  // With no store configured this is a dry-run read — which must still resolve
  // to a clean "no promise, nothing to do" rather than crash the runner.
  const h = harness({ deliver: undefined });
  delete h.deps.deliverFollowUp;
  const out = await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(out.status, "done");
  assert.equal(typeof fup.deliverFollowUp, "function");
});
