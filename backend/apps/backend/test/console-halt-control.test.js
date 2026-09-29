"use strict";

// THE STOP BUTTON.
//
// /api/admin/outreach-pause has existed for months. Both consoles DISPLAYED
// the pause state and neither one could set it: halting a run meant writing a
// POST by hand. These tests pin the two halves of the fix —
//
//   1. the control exists on both consoles, reads its state from the server
//      (never from this browser), needs two deliberate presses, and reports
//      the READ-BACK rather than the click; and
//   2. the pause now stops work that is ALREADY RUNNING — the build pool
//      between rows and the send pass between emails — which it never did.
//
// Both halves matter. A button that implies a full stop and delivers a partial
// one is the defect, not the fix, so the pages also have to say in plain words
// what the stop cannot recall.

const test = require("node:test");
const assert = require("node:assert/strict");

const consolePage = require("../lib/console-page");
const linePage = require("../lib/line-console-page");
const runner = require("../lib/line-runner");
const lineState = require("../lib/line-state");

const PAGES = [
  ["command center", consolePage],
  ["operator line", linePage],
];

// ---------------------------------------------------------------------------
// THE CONTROL
// ---------------------------------------------------------------------------

for (const [name, page] of PAGES) {
  test(`${name} renders a halt control wired to the real pause endpoint`, () => {
    assert.match(page, /id="haltBar"/, "no halt bar in the markup");
    assert.match(page, /<button[^>]*id="haltBtn"/, "no halt button in the markup");
    assert.match(page, /STOP ALL SENDS/, "the control does not say what it does");
    // Both directions must reach the endpoint that actually owns the flag.
    assert.match(page, /\/api\/admin\/outreach-pause/);
    assert.match(page, /active:wanted/, "the write does not carry the requested state");
  });

  test(`${name} halt state is read from the server, never remembered locally`, () => {
    // The defect this guards: controls that recorded their state in
    // localStorage and reverted on reload. A stop button that forgets it was
    // pressed is worse than none, because the operator believes it held.
    assert.match(page, /function readHaltPayload\(/);
    assert.match(page, /function refreshHalt\(/);
    // NOTHING about the halt is written to localStorage, so a reload cannot
    // resurrect a stale "stopped" (or a stale "live"). The clean-sheet console
    // (2026-08-17) also persists campaign deletions (DELETE_KEY — the owner's
    // client-side "Delete campaign" memory); the operator token (KEY) and that
    // list are the only things either console persists in this browser, and
    // neither can hold a halt state.
    const persisted = [...page.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^)]*)\)/g)]
      .map((match) => match[1].trim());
    assert.ok(persisted.length > 0, "expected the token helpers to still be here");
    for (const args of persisted) {
      assert.ok(/^(KEY|DELETE_KEY)(,|$)/.test(args), `localStorage is used for something other than the token or the campaign-delete memory: ${args}`);
    }
    // And the halt machinery itself never touches storage. Bound the slice by
    // the LAST statement of the stop-button click handler — the real end of the
    // halt block on both consoles — rather than by a comment further down the
    // page that only one of them happens to carry (when that phrase is absent
    // indexOf returns -1 and slice() silently reads to the end of the file,
    // which turns this gate into a page-wide grep on one console and a
    // no-op-shaped accident on the other).
    const haltStart = page.indexOf("var halt={");
    assert.ok(haltStart >= 0, "the halt block is gone from this page");
    const HALT_END = "disarmHalt();setHalt(true);";
    const haltEnd = page.indexOf(HALT_END, haltStart);
    assert.ok(haltEnd > haltStart, "the halt block no longer ends at the stop handler");
    const haltSources = page.slice(haltStart, haltEnd + HALT_END.length);
    assert.doesNotMatch(haltSources, /localStorage/, "the stop switch reads the server, never this browser");
    // The rendered state comes from deliveryPause.active on the response.
    assert.match(page, /pause\.active===true|p\.active===true/);
  });

  test(`${name} halt takes two deliberate presses, never one stray click`, () => {
    assert.match(page, /halt\.armed/);
    assert.match(page, /CONFIRM STOP — click again/);
    // Arming expires on its own, so a forgotten half-press cannot lie in wait —
    // but the window must be long enough for a human READING the confirm text
    // for the first time. 6s was not: the owner's second click landed after a
    // silent expiry and the control felt dead. 20s, and expiry says so.
    assert.match(page, /halt\.timer=(?:window\.)?setTimeout\(function\(\)\{/);
    assert.match(page, /\},20000\)/);
    assert.match(page, /Confirmation window expired — nothing was changed/);
    // Turning sending back ON is the dangerous direction and asks out loud too.
    assert.match(page, /CONFIRM RESUME — click again/);
    assert.match(page, /window\.confirm\("Resume sending\?/);
  });

  test(`${name} reports the read-back, including a pause it could not set`, () => {
    assert.match(page, /THE CHANGE DID NOT TAKE/);
    assert.match(page, /THE REQUEST FAILED: /);
    assert.match(page, /the pause was NOT changed/);
    // An unreadable pause is its own state, not "cleared".
    assert.match(page, /PAUSE STATE UNREADABLE/);
    assert.match(page, /THE STOP SWITCH DID NOT ANSWER/);
  });

  test(`${name} says in plain words what the stop cannot recall`, () => {
    assert.match(page, /Stop halts:/);
    assert.match(page, /Stop cannot recall:/);
    assert.match(page, /already in flight when you press it/);
    assert.match(page, /before it starts the next site/);
    assert.match(page, /before its next email/);
  });
}

test("the command center refuses to start a campaign while the switch is set", () => {
  // The browser-side guarantee: a Run pressed while the switch is set refuses
  // in plain words BEFORE anything starts, and a send halted mid-pass by the
  // server is reported, never retried blindly. (The page currently serves the
  // wave launcher, which reports the refusal through finish() rather than
  // writing launchOut directly — the copy and the guard are what matter.)
  assert.match(consolePage, /if\(halt\.active===true\)\{finish\("STOPPED — the operator stop switch is set\./);
  assert.match(consolePage, /pass&&pass\.halted===true/);
  assert.match(consolePage, /Stopped by the operator stop switch\./);
});

test("the command center adds no second poll loop for the stop switch", () => {
  // The 2026-07-29 disk-I/O incident. The halt read rides the existing data
  // poll; it never gets a timer of its own. What this pins is the ABSENCE of a
  // halt-only loop, not a particular timer count — the page has carried one
  // (data poll) and two (data poll + a no-fetch live clock) across redesigns,
  // and both are fine. A third timer, or any timer that fetches the pause
  // endpoint itself, is the regression.
  const timers = [...consolePage.matchAll(/window\.setInterval\(([\s\S]{0,400}?)\},\s*\d+\)/g)].map((m) => m[1]);
  assert.ok(timers.length >= 1, "the data poll timer is gone");
  assert.ok(timers.length <= 2, `expected at most the data poll and the clock, found ${timers.length}`);
  for (const body of timers) {
    assert.doesNotMatch(body, /refreshHalt|outreach-pause/, "the stop switch got a poll loop of its own");
  }
  // The halt read still happens inside load(), on the one authenticated poll,
  // immediately before the console's own data fetch.
  assert.match(consolePage, /refreshHalt\(\);\s*\n\s*loadInFlight=api\("\/api\/admin\/console-data"\)/);
});

// ---------------------------------------------------------------------------
// THE HALT ITSELF — what the button now actually does
// ---------------------------------------------------------------------------

function pausedReader(reason = "operator_stop_button") {
  return async () => ({ active: true, known: true, reason });
}
const clearReader = async () => ({ active: false, known: true, reason: "" });

function buildDeps(overrides = {}) {
  return {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    concurrency: 1,
    clock: () => Date.now(),
    snapshot: () => {},
    qualify: async () => ({ ok: true }),
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    mirror: async (row) => ({ ok: true, previewUrl: `https://example.test/${row.prospectId}` }),
    sourceFacts: async () => ({}),
    gate: async () => ({ pass: true, checks: [], failed: [] }),
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    ...overrides,
  };
}

const THREE = [
  { prospectId: "p1", businessName: "One", email: "one@example.test" },
  { prospectId: "p2", businessName: "Two", email: "two@example.test" },
  { prospectId: "p3", businessName: "Three", email: "three@example.test" },
];

test("a pause set mid-run stops the build pool before the next site", async () => {
  runner.resetBatches();
  const built = [];
  let paused = false;
  const result = await runner.startBatch({ count: 3, lane: "sandbox" }, buildDeps({
    pick: async () => THREE.map((row) => ({ ...row })),
    mirror: async (row) => {
      built.push(row.prospectId);
      paused = true; // the operator presses STOP while row 1 is building
      return { ok: true, previewUrl: `https://example.test/${row.prospectId}` };
    },
    haltCheck: async () => (paused
      ? { halt: true, reason: "operator_stop_button" }
      : { halt: false, reason: "" }),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.halted, true, "the run did not report itself halted");
  assert.match(result.haltReason, /operator stop switch/i);
  assert.deepEqual(built, ["p1"], "the pool kept building after the stop");
  assert.equal(result.batch.status, "halted");
  // The rows that never started are still untouched, not failed.
  assert.deepEqual(result.batch.rows.map((row) => row.status), ["queued", "picked", "picked"]);
  // And a halted batch cannot be approved, so nothing from it can be sent.
  const approved = lineState.approveBatch(result.batch, {
    typedBatchId: result.batch.batchId,
    actor: "operator",
  });
  assert.equal(approved.ok, false);
});

test("a batch started while the switch is already set builds nothing at all", async () => {
  runner.resetBatches();
  const built = [];
  const result = await runner.startBatch({ count: 3, lane: "sandbox" }, buildDeps({
    pick: async () => THREE.map((row) => ({ ...row })),
    mirror: async (row) => { built.push(row.prospectId); return { ok: true, previewUrl: "https://example.test/x" }; },
    haltCheck: async () => ({ halt: true, reason: "operator_stop_button" }),
  }));
  assert.equal(result.halted, true);
  assert.deepEqual(built, []);
});

test("a pause set mid-send stops the pass before the next email", async () => {
  runner.resetBatches();
  const built = await runner.startBatch({ count: 3, lane: "sandbox" }, buildDeps({
    pick: async () => THREE.map((row) => ({ ...row })),
    haltCheck: async () => ({ halt: false, reason: "" }),
  }));
  assert.equal(built.batch.status, "awaiting_approval");
  const approved = lineState.approveBatch(built.batch, {
    typedBatchId: built.batch.batchId,
    actor: "operator",
  });
  assert.equal(approved.ok, true);
  runner.putBatch(approved.batch);

  const sent = [];
  let paused = false;
  const out = await runner.sendApprovedBatch(approved.batch.batchId, {
    send: async (row) => { sent.push(row.prospectId); paused = true; return { ok: true }; },
    haltCheck: async () => (paused
      ? { halt: true, reason: "operator_stop_button" }
      : { halt: false, reason: "" }),
  });

  assert.equal(out.ok, true);
  assert.equal(out.halted, true);
  assert.equal(out.sent, 1);
  assert.deepEqual(sent, ["p1"], "the send pass kept going after the stop");
  assert.equal(out.remaining, 2);
  assert.match(out.haltReason, /already gone out/);
});

// ---------------------------------------------------------------------------
// THE RULE THE GATE OBEYS — and the one it must never break
// ---------------------------------------------------------------------------

test("only a positively KNOWN pause halts a build; an unreadable store does not", async () => {
  // deliveryPauseStatus() answers {active:true, known:false} when it cannot
  // READ the store. That is the right fail-closed answer for a SEND, and every
  // send gate still treats it that way. Building reaches nobody, so a
  // transient store blip must not halt the whole factory.
  const unreadable = runner.haltGate({ readPause: async () => ({ active: true, known: false, reason: "delivery_pause_status_unavailable" }) });
  assert.deepEqual(await unreadable(), { halt: false, reason: "" });

  const throwing = runner.haltGate({ readPause: async () => { throw new Error("network"); } });
  assert.deepEqual(await throwing(), { halt: false, reason: "" });

  const real = runner.haltGate({ readPause: pausedReader("owner_pressed_stop") });
  assert.deepEqual(await real(), { halt: true, reason: "owner_pressed_stop" });

  const clear = runner.haltGate({ readPause: clearReader });
  assert.deepEqual(await clear(), { halt: false, reason: "" });
});

test("the halt gate caches briefly so a pool of five is not five store reads", async () => {
  let reads = 0;
  let now = 1_000_000;
  const gate = runner.haltGate({
    clock: () => now,
    readPause: async () => { reads += 1; return { active: false, known: true, reason: "" }; },
  });
  await gate(); await gate(); await gate();
  assert.equal(reads, 1);
  now += runner.HALT_CHECK_TTL_MS + 1;
  await gate();
  assert.equal(reads, 2, "the cached verdict never expires");
});

test("the send gate in lib/email.js still fail-closes on an unreadable pause", () => {
  // The build halt deliberately ignores an unknown pause. This asserts the
  // SEND path was not softened to match: deliveryPauseStatus() returns
  // active:true when the store cannot answer, and sendSequenceStep blocks on
  // active alone.
  const pause = require("fs").readFileSync(require.resolve("../lib/delivery-pause"), "utf8");
  assert.match(pause, /return \{ active: true, known: false, reason: "delivery_pause_status_unavailable" \}/);
  const email = require("fs").readFileSync(require.resolve("../lib/email"), "utf8");
  assert.match(email, /if \(deliveryPause\.active && !canBypassDeliveryPause\(/);
});
