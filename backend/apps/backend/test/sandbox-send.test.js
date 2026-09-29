"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ownerSandboxAddress, forceOwnerRecipient, assertOwnerOnly } = require("../lib/sandbox-send");
const runner = require("../lib/line-runner");
const { createLineHandler } = require("../api/admin/line");

test("forceOwnerRecipient routes every recipient field to the owner and preserves identity", () => {
  const prospect = {
    prospect_id: "lead_1",
    business_name: "Acme Roofing",
    email: "real@prospect.com",
    ownerEmail: "real@prospect.com",
    owner_email: "real@prospect.com",
    preview_url: "https://preview/lead_1",
  };
  const owner = "owner@wss.test";
  const routed = forceOwnerRecipient(prospect, owner);
  assert.equal(routed.email, owner);
  assert.equal(routed.ownerEmail, owner);
  assert.equal(routed.owner_email, owner);
  // Identity fields untouched so per-business de-dup and preview identity hold.
  assert.equal(routed.prospect_id, "lead_1");
  assert.equal(routed.business_name, "Acme Roofing");
  assert.equal(routed.preview_url, "https://preview/lead_1");
});

test("assertOwnerOnly accepts an owner-routed prospect and rejects a real prospect", () => {
  const owner = "owner@wss.test";
  assert.equal(assertOwnerOnly(forceOwnerRecipient({ email: "x@y.com" }, owner), owner), true);
  assert.equal(assertOwnerOnly({ email: "real@prospect.com" }, owner), false);
  // Fail closed when the owner address is empty.
  assert.equal(assertOwnerOnly({ email: owner }, ""), false);
});

test("ownerSandboxAddress reads the configured owner and is empty when unset", () => {
  const prev = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = "  owner@wss.test  ";
  assert.equal(ownerSandboxAddress(), "owner@wss.test");
  delete process.env.GHOST_AGENCY_OWNER_EMAIL;
  assert.equal(ownerSandboxAddress(), "");
  if (prev !== undefined) process.env.GHOST_AGENCY_OWNER_EMAIL = prev;
});

test("approved console exposes only fixed sandbox starts and no legacy lane controls", () => {
  const html = String(require("../lib/console-page"));
  // "Run 10 sites" is the owner's beta cadence (2026-08-05) and is now the
  // first launch size, alongside the original three. (Renamed "Build 10" in
  // the 2026-08-16 plain-words pass.) Buttons only — the shared operator
  // nav's enterprise CSS also carries data-n selectors, which broke a raw
  // data-n count the day that layer landed.
  assert.deepEqual([...html.matchAll(/<button\b[^>]*data-n="(\d+)"[^>]*>/g)].map((match) => Number(match[1])), [10, 50, 100, 500]);
  // MODE TOGGLE (owner directive 2026-08-06). The console can now start a live
  // run, so the property being protected changes shape: it is no longer "live
  // is unreachable", it is that live is never IMPLICIT. The lane flows from
  // currentLane(), the toggle ships as sandbox, no start call hardcodes live,
  // and the server keeps the master switch (GHOST_AGENCY_LINE_LIVE_SENDS)
  // which refuses a live start regardless of what this page asks for.
  assert.match(html, /post\("\/api\/admin\/line",\{action:"start",count:quota,target:t,lane:campaignLane\}\)/);
  assert.match(html, /id="laneMode"[^>]*data-lane="sandbox"/);
  assert.match(html, /function currentLane\(\)\{return laneModeBtn&&laneModeBtn\.getAttribute\("data-lane"\)==="live"\?"live":"sandbox";\}/);
  assert.doesNotMatch(html, /lane:"live"/);
  assert.doesNotMatch(html, /id="frSandbox"/);
  assert.doesNotMatch(html, /id="cSandbox"/);

  // APPROVE AND SEND NOW LIVE HERE — the owner asked to run a batch end to end
  // from the dashboard rather than by hand. The safety property is not "the
  // console cannot send", it is that a send is IMPOSSIBLE WITHOUT A HUMAN: the
  // approve call carries a typedBatchId, which the operator must type to match
  // the batch, and the server refuses `send` for any batch lacking that
  // approval. Both halves are asserted here so the gate cannot be quietly
  // dropped from the page.
  assert.match(html, /action:"approve"/);
  assert.match(html, /typedBatchId/);
  assert.match(html, /action:"send"/);
});

// ---------------------------------------------------------------------------
// SANDBOX AUTO-SEND — the owner does not hand-approve 500 sandbox sites.
// ---------------------------------------------------------------------------
// In the sandbox lane ONLY, and only when the switch is on, a settled batch is
// auto-approved and auto-sent to the OWNER (never a prospect). The live lane
// always keeps the explicit human approve step.

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };
}
function req(method, url, body) {
  return { method, url, headers: { "x-admin-token": "test-token" }, body: body ? JSON.stringify(body) : "" };
}
const READY = {
  ready: true,
  blockers: [],
  deliveryPause: { active: false, known: true, reason: "" },
  reviewHold: { active: false },
  liveSendsEnabled: true,
  ownerAddressConfigured: true,
};
function passThroughDeps() {
  return {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    pick: async () => [{ prospectId: "sb1", businessName: "Sandbox Biz", email: "real@prospect.com", vertical: "plumbing" }],
    qualify: async () => ({ ok: true }),
    // These tests isolate sandbox recipient/send policy from the dedicated
    // default-on owned-hero preparation contract.
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    mirror: async () => ({ ok: true, previewUrl: "https://sb1.wss-ai.com/" }),
    sourceFacts: async () => ({}),
    gate: async () => ({ pass: true, failed: [], checks: [] }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    readiness: async () => READY,
  };
}

test("sandbox lane auto-approves and auto-sends to the owner when the switch is on", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss.test";
  const prevSwitch = process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
  process.env.GHOST_AGENCY_SANDBOX_AUTOSEND = "true";
  runner.resetBatches();
  try {
    const sent = [];
    const handler = createLineHandler({
      ...passThroughDeps(),
      send: async (row) => { sent.push(row.prospectId); return { ok: true }; },
    });
    const res = fakeRes();
    await handler(req("POST", "/api/admin/line", { action: "start", count: 1, lane: "sandbox" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.autoSent, true, "a settled sandbox batch must auto-send without a manual click");
    assert.equal(res.body.sent, 1);
    assert.deepEqual(sent, ["sb1"]);
    // The row shows sent, not merely queued, and nothing is left waiting.
    assert.equal(res.body.batch.counts.sent, 1);
    assert.equal(res.body.batch.counts.queued, 0);
  } finally {
    if (prevSwitch === undefined) delete process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
    else process.env.GHOST_AGENCY_SANDBOX_AUTOSEND = prevSwitch;
  }
});

test("sandbox auto-send is ON by default — set GHOST_AGENCY_SANDBOX_AUTOSEND=false to disable it", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss.test";
  process.env.GHOST_AGENCY_SANDBOX_AUTOSEND = "false";
  runner.resetBatches();
  let sends = 0;
  const handler = createLineHandler({
    ...passThroughDeps(),
    send: async () => { sends += 1; return { ok: true }; },
  });
  const res = fakeRes();
  await handler(req("POST", "/api/admin/line", { action: "start", count: 1, lane: "sandbox" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sends, 0, "with the opt-out switch set, nothing may auto-send");
  assert.equal(res.body.autoSent, undefined);
  assert.equal(res.body.batch.counts.queued, 1);
  assert.equal(res.body.batch.status, "awaiting_approval");
  delete process.env.GHOST_AGENCY_SANDBOX_AUTOSEND;
});

test("a LIVE batch CONTINUED keeps its immutable lane and waits for explicit owner approval", async () => {
  // THE AUTO-SEND SAFETY HOLE. A big live Mine cannot finish in one function,
  // so the server hands the batch back "building" and the console re-POSTs
  // {action:"start", batchId} to continue it. The continue POST does not carry
  // the lane (and even if it did, the batch's own lane is authoritative). The
  // lane MUST come from the recovered batch, never re-derived from the request:
  // a live batch resumed with a missing/"sandbox" hint must not be treated as a
  // sandbox batch and auto-sent through the sandbox path (owner-only delivery).
  // It keeps its live lane and must stop at the authenticated, typed owner gate.
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss.test";
  process.env.GHOST_AGENCY_LINE_LIVE_SENDS = "true";
  const lineState = require("../lib/line-state");
  runner.resetBatches();
  try {
    // A LIVE batch left mid-build by a prior invocation: status "building" with
    // one row still "picked" — exactly the durable state a resumed Mine finds.
    const seeded = lineState.newBatch({ batchId: "line_live_resume", lane: "live", requested: 1 });
    seeded.status = "building";
    seeded.rows = [lineState.newRow({ prospectId: "live1", businessName: "Live Biz", email: "real@prospect.com", vertical: "plumbing" })];
    runner.putBatch(seeded);

    const sent = [];
    const handler = createLineHandler({
      ...passThroughDeps(),
      // A continued batch reuses its own rows; mining fresh (which would carry
      // the request's sandbox lane) is the bug — fail loudly if pick is reached.
      pick: async () => { throw new Error("a continued batch must not re-mine"); },
      send: async (row) => { sent.push(row.prospectId); return { ok: true }; },
    });
    // The continue POST MISLABELS the lane as sandbox and omits count.
    const res = fakeRes();
    await handler(req("POST", "/api/admin/line", { action: "start", batchId: "line_live_resume", lane: "sandbox" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.batch.lane, "live", "the continued batch keeps its immutable live lane");
    assert.equal(res.body.autoSent, undefined, "campaign continuation cannot mint a live approval");
    assert.deepEqual(sent, [], "no provider send may occur before explicit authenticated owner approval");
    assert.equal(res.body.batch.status, "awaiting_approval");
    assert.equal(res.body.batch.counts.sent, 0);
    assert.equal(res.body.batch.counts.queued, 1);
  } finally {
    delete process.env.GHOST_AGENCY_LINE_LIVE_SENDS;
  }
});


test("autoApproveAndSendSandbox refuses a live batch handed to it directly", async () => {
  // Defence in depth: even if a future caller forgets the lane guard, the
  // auto-send path re-reads the batch's OWN stored lane and refuses anything
  // that is not a genuine sandbox batch, without approving or sending.
  const { autoApproveAndSendSandbox } = require("../api/admin/line");
  const lineState = require("../lib/line-state");
  let sends = 0;
  const live = lineState.newBatch({ batchId: "line_live_direct", lane: "live", requested: 1 });
  live.status = "awaiting_approval";
  const out = await autoApproveAndSendSandbox(live, { send: async () => { sends += 1; return { ok: true }; } });
  assert.equal(out.autoSent, false);
  assert.equal(out.autoSendReason, "auto_send_refused_non_sandbox_lane");
  assert.equal(sends, 0);
  assert.notEqual(live.status, "approved", "a live batch must not be approved by the sandbox auto-send path");
});

test("live lane waits for explicit authenticated owner approval even when live sends are enabled", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-token";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss.test";
  process.env.GHOST_AGENCY_LINE_LIVE_SENDS = "true";
  runner.resetBatches();
  try {
    const sent = [];
    const handler = createLineHandler({
      ...passThroughDeps(),
      send: async (row) => { sent.push(row.prospectId); return { ok: true }; },
    });
    const res = fakeRes();
    await handler(req("POST", "/api/admin/line", { action: "start", count: 1, lane: "live" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.autoSent, undefined, "starting a campaign cannot mint a live approval");
    assert.equal(res.body.sent, undefined);
    assert.deepEqual(sent, [], "the provider cannot run before the owner approves the exact batch");
    assert.equal(res.body.batch.lane, "live");
    assert.equal(res.body.batch.status, "awaiting_approval");
    assert.equal(res.body.batch.counts.sent, 0);
    assert.equal(res.body.batch.counts.queued, 1);
  } finally {
    delete process.env.GHOST_AGENCY_LINE_LIVE_SENDS;
  }
});

test("autoApproveAndSendLive refuses a sandbox batch handed to it directly", async () => {
  // Defence in depth: even if a future caller forgets the lane guard, the
  // live auto-send path re-reads the batch's OWN stored lane and refuses
  // anything that is not a genuine live batch.
  const { autoApproveAndSendLive } = require("../api/admin/line");
  const lineState = require("../lib/line-state");
  let sends = 0;
  const sandbox = lineState.newBatch({ batchId: "line_sb_direct", lane: "sandbox", requested: 1 });
  sandbox.status = "awaiting_approval";
  const out = await autoApproveAndSendLive(sandbox, { send: async () => { sends += 1; return { ok: true }; } });
  assert.equal(out.autoSent, false);
  assert.equal(out.autoSendReason, "auto_send_refused_non_live_lane");
  assert.equal(sends, 0);
  assert.notEqual(sandbox.status, "approved", "a sandbox batch must not be approved by the live auto-send path");
});
