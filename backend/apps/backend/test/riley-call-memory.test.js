"use strict";
// What this pins down, and why each one is here:
//
//  1. A caller identifies himself ONCE per call. Call 019fd91d made a real
//     customer read his Client ID out twice ("Sorry. I need to confirm that
//     again" -> "Could you please read me your client ID from your email?").
//     The prompt already forbade that; only state stops it.
//  2. A tool that can never authenticate must not be shippable. The live
//     site_edit_status carried the literal string YOUR_VAPI_WEBHOOK_SECRET_HERE
//     as its x-vapi-secret header and returned "unauthorized" on all four of
//     its real invocations, while Riley was telling callers she'd check on
//     their change.
//  3. The answer deadline is measured from when VAPI started waiting. A flat
//     12s budget ignored the work done before it and let call 019fdbad run
//     20.05s into VAPI's 20s cap — the caller got dead air.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {
  callIdFromBody,
  rememberCaller,
  recallCallerHot,
  __resetCallMemory,
} = require("../lib/riley-call-memory");

const src = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test.beforeEach(() => __resetCallMemory());

/* ------------------------------------------------ 1. the caller is remembered */

test("the call id is found in the shape VAPI actually sends", () => {
  assert.equal(callIdFromBody({ message: { call: { id: "019fd91d-e6fc-7dd7" } } }), "019fd91d-e6fc-7dd7");
  assert.equal(callIdFromBody({ call: { id: "flat-form" } }), "flat-form");
  assert.equal(callIdFromBody({ callId: "probe-form" }), "probe-form");
  assert.equal(callIdFromBody({}), "");
});

test("a call id that is not an identifier is refused rather than used as a key", () => {
  // A key is only ever an opaque handle; anything that could carry a filter or
  // a path separator into a PostgREST query is not one.
  assert.equal(callIdFromBody({ callId: "abc&type=eq.x" }), "");
  assert.equal(callIdFromBody({ callId: "../../etc" }), "");
  assert.equal(callIdFromBody({ callId: "ok-id_1:2.3" }), "ok-id_1:2.3");
});

test("who the caller is survives from one tool call to the next", async () => {
  await rememberCaller("call-1", {
    site_slug: "wss-test-rimrock-plumbing",
    business_name: "Rimrock Plumbing",
    client_id: "WSS-F350D9",
    prospect_id: "p_123",
    matched_by: "reference",
  });
  const back = recallCallerHot("call-1");
  assert.equal(back.site_slug, "wss-test-rimrock-plumbing");
  assert.equal(back.business_name, "Rimrock Plumbing");
  assert.equal(back.client_id, "WSS-F350D9");
});

test("a memory belongs to ONE call and never leaks into another", async () => {
  await rememberCaller("call-A", { site_slug: "slug-a", business_name: "A Co" });
  assert.equal(recallCallerHot("call-B"), null, "a different call must start from nothing");
  assert.equal(recallCallerHot("call-A").site_slug, "slug-a");
});

test("nothing worth remembering is not remembered", async () => {
  assert.equal(await rememberCaller("call-2", {}), false);
  assert.equal(await rememberCaller("", { site_slug: "x" }), false);
  assert.equal(recallCallerHot("call-2"), null);
});

test("a later fact adds to the memory instead of blanking it", async () => {
  await rememberCaller("call-3", { site_slug: "slug-3", client_id: "WSS-AAA111" });
  await rememberCaller("call-3", { business_name: "Third Co", domain: "third.wss-ai.com" });
  const back = recallCallerHot("call-3");
  assert.equal(back.site_slug, "slug-3", "the earlier identity must not be lost");
  assert.equal(back.client_id, "WSS-AAA111");
  assert.equal(back.business_name, "Third Co");
});

/* -------------------------------------------- 2. the voice tools consult it */

test("site-edit asks what it already knows before it asks the caller again", () => {
  const s = src("lib", "site-edit-core.js");
  assert.match(s, /recallCallerHot|recallCaller/, "the handler must consult call memory");
  assert.match(s, /rememberCaller\(/, "and must write to it once the caller is resolved");
  // The memory is only usable when it belongs to THIS caller — a caller who
  // corrects himself mid-call has to land on the corrected account.
  assert.match(s, /memoryIsThisCaller/);
  const needsId = s.indexOf("need a siteSlug, or a Client ID");
  const consults = s.indexOf("recallCaller(callId)");
  assert.ok(consults !== -1 && consults < needsId, "memory must be consulted BEFORE giving up and asking for an ID");
});

test("looking a caller up hands the identity to the rest of the call", () => {
  const s = src("lib", "riley-lookup-core.js");
  assert.match(s, /rememberCaller\(/, "a successful lookup must seed the call memory");
  assert.match(s, /recallCaller\(/, "'pull my record up again' must not become 'who are you?'");
});

/* ------------------------------------------------------- 3. the deadline */

test("the tool never waits on the build — the answer is immediate, the run is kicked", () => {
  const s = src("lib", "site-edit-core.js");
  // The race this replaced (RUN_BUDGET_MS / ANSWER_BY_MS / t0) tuned the wait,
  // and the 2026-08-17 call log killed the whole idea: "call ended due to
  // exceeding maximum duration while the AI was processing the requested
  // website change", five businesses, one change each. No budget can be tuned
  // small enough — ANY inline wait is silence on a line where silence ends
  // the call. So the pins invert: there is no budget to measure, because
  // there is no wait.
  assert.doesNotMatch(s, /RUN_BUDGET_MS/, "a run budget means the tool waits on the build — it must not");
  assert.doesNotMatch(s, /Promise\.race\(\[/, "racing the build still holds the caller while it runs");
  assert.doesNotMatch(s, /await executeEditJob/, "the runner must be kicked detached, never awaited");
  // The kick itself must still exist — fast-ack is not fire-and-forget-QA:
  // the job starts now, and the 2-minute sweeper owns its durability.
  assert.match(s, /executeEditJob\(jobId\)\.catch/, "the confirmed job must be kicked the moment it is queued");
  assert.match(s, /site_edit_status/, "and where it stands is the status tool's to say");
});

/* ------------------------------- 4. a tool that cannot authenticate is a bug */

test("no provisioned voice tool carries a placeholder where its secret belongs", () => {
  const s = src("api", "admin", "vapi-assistants.js");
  assert.doesNotMatch(
    s,
    /YOUR_[A-Z_]*(SECRET|TOKEN|KEY)[A-Z_]*_HERE/,
    "a placeholder secret ships a tool that 401s on every call — site_edit_status did exactly this in production",
  );
  // Every tool server block in the provisioner must carry a real secret. The
  // urls are template literals containing `${base}`, so the block is read by
  // scanning forward from each `server: {` rather than by a brace-free regex.
  const starts = [...s.matchAll(/server:\s*\{/g)].map((m) => m.index);
  assert.ok(starts.length > 0, "expected tool server blocks");
  for (const i of starts) {
    const block = s.slice(i, i + 200);
    assert.match(
      block,
      /secret:\s*vapiToolSecret\(/,
      `tool server block without a resolved secret: ${block.split("\n")[0]}`,
    );
  }
});

test("site_edit_status is described against a tool that actually exists", () => {
  // The live description told Riley to use "the jobId returned by site_edit",
  // and no site_edit tool is attached to her. The one that returns a jobId is
  // request_site_change.
  const s = src("api", "admin", "vapi-assistants.js");
  const statusDef = s.slice(s.indexOf('name: "site_edit_status"'));
  assert.ok(statusDef, "site_edit_status definition not found");
});
